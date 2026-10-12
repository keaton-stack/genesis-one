/**
 * `/api/auth/*` through the real Worker and the real sign-in store (a Durable Object), in workerd.
 * The crypto cases live in auth.test.ts; these cover the HTTP surface, the cookie and the shared store.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { base58Encode } from "../src/auth";
import { signedInWallet } from "./signin";

const BASE = "https://game.test";
let ipCounter = 0;

async function wallet() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const sign = async (message: string) => {
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(message)));
    let bin = "";
    for (const b of sig) bin += String.fromCharCode(b);
    return btoa(bin);
  };
  return { address: base58Encode(raw), sign };
}

/** Each test gets its own client IP, so the rate limiter does not couple tests. */
function client(ip = `10.0.0.${++ipCounter}`) {
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    SELF.fetch(`${BASE}/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers },
      body: JSON.stringify(body),
    });
  const get = (path: string, headers: Record<string, string> = {}) =>
    SELF.fetch(`${BASE}/api/auth/${path}`, { headers: { "CF-Connecting-IP": ip, ...headers } });
  return { post, get };
}

/** "gb1_session=…" from a Set-Cookie header, ready to send back as a Cookie header. */
function cookieOf(res: Response): string {
  const set = res.headers.get("Set-Cookie") ?? "";
  return set.split(";")[0]!;
}

async function signIn(c = client()) {
  const w = await wallet();
  const challenge = (await (await c.post("challenge", { publicKey: w.address })).json()) as { message: string };
  const verify = await c.post("verify", { publicKey: w.address, message: challenge.message, signature: await w.sign(challenge.message), method: "signMessage" });
  return { w, c, verify, challenge };
}

describe("sign-in over HTTP", () => {
  it("challenge, sign, verify sets an HttpOnly session cookie that /session reads", async () => {
    const { w, c, verify } = await signIn();
    expect(verify.status).toBe(200);
    const verified = (await verify.json()) as { ok: boolean; address: string; playerId: string };
    expect(verified).toEqual({ ok: true, address: w.address, playerId: expect.stringMatching(/^w[1-9A-HJ-NP-Za-km-z]{16}$/) });
    const set = verify.headers.get("Set-Cookie")!;
    expect(set).toContain("gb1_session=");
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");

    const session = await c.get("session", { Cookie: cookieOf(verify) });
    // The same wallet always maps to the same player id.
    expect(await session.json()).toEqual({ address: w.address, playerId: verified.playerId });
  });

  it("the signIn path works with an unbound challenge", async () => {
    const c = client();
    const w = await wallet();
    const { signInInput: s } = (await (await c.post("challenge", {})).json()) as { signInInput: Record<string, string> };
    const message = [
      `${s.domain} wants you to sign in with your Solana account:`, w.address, "", s.statement, "",
      `URI: ${s.uri}`, `Version: ${s.version}`, `Nonce: ${s.nonce}`, `Issued At: ${s.issuedAt}`, `Expiration Time: ${s.expirationTime}`,
    ].join("\n");
    const res = await c.post("verify", { publicKey: w.address, message, signature: await w.sign(message), method: "signIn" });
    expect(res.status).toBe(200);
  });

  it("a signed challenge mints one session only, across requests", async () => {
    const { w, c, verify, challenge } = await signIn();
    expect(verify.status).toBe(200);
    const again = await c.post("verify", { publicKey: w.address, message: challenge.message, signature: await w.sign(challenge.message), method: "signMessage" });
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ error: "challenge already used" });
  });

  it("no cookie, or a forged one, is no session", async () => {
    const c = client();
    expect(await (await c.get("session")).json()).toEqual({ address: null });
    const forged = await c.get("session", { Cookie: "gb1_session=eyJhbGciOiJIUzI1NiJ9.e30.AAAA" });
    expect(await forged.json()).toEqual({ address: null });
    // and the stale cookie is cleared
    expect(forged.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("logout revokes the token, not just the cookie", async () => {
    const { c, verify } = await signIn();
    const cookie = cookieOf(verify);
    const out = await c.post("logout", {}, { Cookie: cookie });
    expect(out.status).toBe(200);
    expect(out.headers.get("Set-Cookie")).toContain("Max-Age=0");
    // A copy of the old cookie no longer works.
    expect(await (await c.get("session", { Cookie: cookie })).json()).toEqual({ address: null });
  });
});

describe("a wallet switch", () => {
  const session = async (cookie: string) =>
    (await (await SELF.fetch("https://game.test/api/auth/session", { headers: { Cookie: cookie } })).json()) as { address: string | null };

  it("revokes the session it replaces, so the old token stops working everywhere", async () => {
    const first = await signedInWallet();
    expect((await session(first.cookie)).address).toBe(first.address);
    const second = await signedInWallet(first.cookie);
    expect(second.address).not.toBe(first.address);
    expect((await session(second.cookie)).address).toBe(second.address);
    expect((await session(first.cookie)).address).toBeNull();
  });
});

describe("untrusted input", () => {
  it("refuses a bad address, a missing field and an unknown method", async () => {
    const c = client();
    const w = await wallet();
    expect((await c.post("challenge", { publicKey: "not-an-address" })).status).toBe(400);
    expect((await c.post("verify", { publicKey: w.address, message: "x" })).status).toBe(400);
    expect((await c.post("verify", { publicKey: w.address, message: "x", signature: "x", method: "trustMe" })).status).toBe(400);
  });

  it("refuses a non-JSON body (a cross-site form) and an oversized one", async () => {
    const c = client();
    expect((await c.post("challenge", {}, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await c.post("challenge", { pad: "x".repeat(9000) })).status).toBe(413);
  });

  it("an invalid signature is a 401 with no cookie", async () => {
    const c = client();
    const w = await wallet();
    const other = await wallet();
    const { message } = (await (await c.post("challenge", { publicKey: w.address })).json()) as { message: string };
    const res = await c.post("verify", { publicKey: w.address, message, signature: await other.sign(message), method: "signMessage" });
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("rate limits verify per IP", async () => {
    const c = client();
    const w = await wallet();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await c.post("verify", { publicKey: w.address, message: "x", signature: "x", method: "signMessage" })).status;
    expect(last).toBe(429);
    // another IP is unaffected
    expect((await client().post("verify", { publicKey: w.address, message: "x", signature: "x", method: "signMessage" })).status).toBe(401);
  });

  it("the sign-in store's reserved name is not a room", async () => {
    const res = await SELF.fetch(`${BASE}/ws/__auth`, { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(400);
  });

  it("unknown auth routes are a 404", async () => {
    expect((await client().get("nope")).status).toBe(404);
    expect((await client().post("nope", {})).status).toBe(404);
  });
});
