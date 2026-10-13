/**
 * SIWS core (src/auth.ts), run in workerd so WebCrypto Ed25519 is the real one.
 *
 * Mirrors the dashboard's lib/auth/index.test.ts: every case here is an attack or a wallet quirk the
 * verifiers must handle.
 */

import { describe, expect, it } from "vitest";
import {
  base58Decode,
  base58Encode,
  createChallenge,
  createSessionToken,
  isAddress,
  playerIdFor,
  readCookie,
  sessionCookie,
  slideSessionToken,
  verifyLogin,
  verifySessionToken,
  verifySignIn,
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS,
  STATEMENT,
  type ConsumeNonce,
} from "../src/auth";

const env = { SIWS_JWT_SECRET: "test-secret-0123456789abcdef0123456789", APP_DOMAIN: "genesis.test" };

function memoryConsume(): ConsumeNonce {
  const used = new Set<string>();
  return async (id) => {
    if (used.has(id)) return false;
    used.add(id);
    return true;
  };
}

async function wallet() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const address = base58Encode(raw);
  const sign = async (message: string) => {
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(message)));
    let bin = "";
    for (const b of sig) bin += String.fromCharCode(b);
    return btoa(bin);
  };
  return { address, sign };
}

/** The text a compliant `solana:signIn` wallet composes from `signInInput`. */
function composeSignIn(input: Awaited<ReturnType<typeof createChallenge>>["signInInput"], address: string, extra: string[] = []) {
  return [
    `${input.domain} wants you to sign in with your Solana account:`,
    address,
    "",
    input.statement,
    "",
    `URI: ${input.uri}`,
    `Version: ${input.version}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expirationTime}`,
    ...extra,
  ].join("\n");
}

describe("encodings", () => {
  it("base58 round-trips, keeps leading zeros and refuses foreign characters", () => {
    const bytes = new Uint8Array([0, 0, 1, 2, 255, 128, 7]);
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
    expect(base58Decode("0OIl")).toBeNull();
  });

  it("isAddress accepts a 32-byte key only", async () => {
    const { address } = await wallet();
    expect(isAddress(address)).toBe(true);
    expect(isAddress("Fh7mLxtPAysdvHcMcJ37A3vc6WvBVh7JVDwxmwk6pump")).toBe(true);
    expect(isAddress("abc")).toBe(false);
    expect(isAddress(address + "1")).toBe(false);
    expect(isAddress(42)).toBe(false);
  });
});

describe("signMessage path", () => {
  it("full round-trip: challenge, sign, verify, session", async () => {
    const w = await wallet();
    const c = await createChallenge(env, w.address);
    const r = await verifyLogin(env, { publicKey: w.address, message: c.message!, signature: await w.sign(c.message!) }, memoryConsume());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await verifySessionToken(env, r.sessionToken))?.publicKey).toBe(w.address);
  });

  it("rejects a signature from a different key", async () => {
    const w = await wallet();
    const other = await wallet();
    const c = await createChallenge(env, w.address);
    const r = await verifyLogin(env, { publicKey: w.address, message: c.message!, signature: await other.sign(c.message!) }, memoryConsume());
    expect(r).toEqual({ ok: false, error: "invalid signature" });
  });

  it("rejects when the publicKey does not match the nonce", async () => {
    const w = await wallet();
    const other = await wallet();
    const c = await createChallenge(env, w.address);
    const message = c.message!.replace(w.address, other.address);
    const r = await verifyLogin(env, { publicKey: other.address, message, signature: await other.sign(message) }, memoryConsume());
    expect(r.ok).toBe(false);
  });

  it("rejects a real nonce lifted into an attacker-written message", async () => {
    const w = await wallet();
    const c = await createChallenge(env, w.address);
    const message = c.message!.replace(STATEMENT, "Verify your wallet for the airdrop.");
    const r = await verifyLogin(env, { publicKey: w.address, message, signature: await w.sign(message) }, memoryConsume());
    expect(r).toEqual({ ok: false, error: "message does not match challenge" });
  });

  it("rejects a tampered domain line even with the real nonce and a real signature", async () => {
    const w = await wallet();
    const c = await createChallenge(env, w.address);
    const message = c.message!.replace("genesis.test", "evil.test");
    const r = await verifyLogin(env, { publicKey: w.address, message, signature: await w.sign(message) }, memoryConsume());
    expect(r.ok).toBe(false);
  });

  it("rejects a malformed message", async () => {
    const w = await wallet();
    const r = await verifyLogin(env, { publicKey: w.address, message: "hello", signature: await w.sign("hello") }, memoryConsume());
    expect(r).toEqual({ ok: false, error: "malformed message" });
  });

  it("refuses an unbound nonce", async () => {
    const w = await wallet();
    const c = await createChallenge(env, null);
    expect(c.message).toBeNull();
    const message = composeSignIn(c.signInInput, w.address);
    const r = await verifyLogin(env, { publicKey: w.address, message, signature: await w.sign(message) }, memoryConsume());
    expect(r).toEqual({ ok: false, error: "challenge expired or invalid" });
  });

  it("rejects an expired challenge", async () => {
    const w = await wallet();
    const issued = Math.floor(Date.now() / 1000) - 10 * 60;
    const c = await createChallenge(env, w.address, issued);
    const r = await verifyLogin(env, { publicKey: w.address, message: c.message!, signature: await w.sign(c.message!) }, memoryConsume());
    expect(r).toEqual({ ok: false, error: "challenge expired or invalid" });
  });

  it("rejects a nonce signed with another secret", async () => {
    const w = await wallet();
    const c = await createChallenge({ ...env, SIWS_JWT_SECRET: "another-secret" }, w.address);
    const r = await verifyLogin(env, { publicKey: w.address, message: c.message!, signature: await w.sign(c.message!) }, memoryConsume());
    expect(r).toEqual({ ok: false, error: "challenge expired or invalid" });
  });
});

describe("signIn path", () => {
  it("round-trip with an unbound nonce: the wallet supplies the address", async () => {
    const w = await wallet();
    const c = await createChallenge(env, null);
    expect(c.signInInput.address).toBeUndefined();
    const message = composeSignIn(c.signInInput, w.address);
    const r = await verifySignIn(env, { publicKey: w.address, message, signature: await w.sign(message) }, memoryConsume());
    expect(r.ok).toBe(true);
  });

  it("the message a compliant wallet builds is the one we would have built", async () => {
    const w = await wallet();
    const c = await createChallenge(env, w.address);
    expect(composeSignIn(c.signInInput, w.address)).toBe(c.message);
  });

  it("rejects a swapped domain, statement or URI", async () => {
    const w = await wallet();
    for (const [from, to] of [["genesis.test wants", "evil.test wants"], [STATEMENT, "Claim your reward."], ["URI: https://genesis.test", "URI: https://evil.test"]]) {
      const c = await createChallenge(env, null);
      const message = composeSignIn(c.signInInput, w.address).replace(from!, to!);
      const r = await verifySignIn(env, { publicKey: w.address, message, signature: await w.sign(message) }, memoryConsume());
      expect(r.ok).toBe(false);
    }
  });

  it("rejects an extra field the server never sent", async () => {
    const w = await wallet();
    const c = await createChallenge(env, null);
    const message = composeSignIn(c.signInInput, w.address, ["Resources:", "- https://evil.test"]);
    const r = await verifySignIn(env, { publicKey: w.address, message, signature: await w.sign(message) }, memoryConsume());
    expect(r.ok).toBe(false);
  });

  it("rejects a widened expiration time", async () => {
    const w = await wallet();
    const c = await createChallenge(env, null);
    const later = new Date(Date.parse(c.signInInput.expirationTime) + 3600_000).toISOString();
    const message = composeSignIn({ ...c.signInInput, expirationTime: later }, w.address);
    const r = await verifySignIn(env, { publicKey: w.address, message, signature: await w.sign(message) }, memoryConsume());
    expect(r).toEqual({ ok: false, error: "message does not match challenge" });
  });

  it("rejects a nonce issued for another wallet", async () => {
    const w = await wallet();
    const other = await wallet();
    const c = await createChallenge(env, other.address);
    const message = composeSignIn(c.signInInput, w.address);
    const r = await verifySignIn(env, { publicKey: w.address, message, signature: await w.sign(message) }, memoryConsume());
    expect(r).toEqual({ ok: false, error: "challenge expired or invalid" });
  });

  it("rejects a duplicated field line", async () => {
    const w = await wallet();
    const c = await createChallenge(env, null);
    const message = composeSignIn(c.signInInput, w.address, ["Version: 1"]);
    const r = await verifySignIn(env, { publicKey: w.address, message, signature: await w.sign(message) }, memoryConsume());
    expect(r).toEqual({ ok: false, error: "malformed message" });
  });
});

describe("single use", () => {
  it("a challenge can be used once", async () => {
    const w = await wallet();
    const consume = memoryConsume();
    const c = await createChallenge(env, w.address);
    const input = { publicKey: w.address, message: c.message!, signature: await w.sign(c.message!) };
    expect((await verifyLogin(env, input, consume)).ok).toBe(true);
    expect(await verifyLogin(env, input, consume)).toEqual({ ok: false, error: "challenge already used" });
    // The other path cannot reuse it either.
    expect(await verifySignIn(env, input, consume)).toEqual({ ok: false, error: "challenge already used" });
  });

  it("a failed attempt does not burn the challenge", async () => {
    const w = await wallet();
    const other = await wallet();
    const consume = memoryConsume();
    const c = await createChallenge(env, w.address);
    const bad = await verifyLogin(env, { publicKey: w.address, message: c.message!, signature: await other.sign(c.message!) }, consume);
    expect(bad.ok).toBe(false);
    const good = await verifyLogin(env, { publicKey: w.address, message: c.message!, signature: await w.sign(c.message!) }, consume);
    expect(good.ok).toBe(true);
  });
});

describe("session token", () => {
  it("rejects garbage, a forged signature and another secret", async () => {
    const w = await wallet();
    const token = await createSessionToken(env, w.address, Math.floor(Date.now() / 1000));
    expect(await verifySessionToken(env, "garbage")).toBeNull();
    expect(await verifySessionToken(env, token.slice(0, -2) + "AA")).toBeNull();
    expect(await verifySessionToken({ ...env, SIWS_JWT_SECRET: "another-secret" }, token)).toBeNull();
    const [h, , s] = token.split(".");
    const forged = btoa(JSON.stringify({ kind: "siws-session", sub: w.address, authAt: 0, exp: 9e9 })).replace(/=+$/, "");
    expect(await verifySessionToken(env, `${h}.${forged}.${s}`)).toBeNull();
  });

  it("expires after the idle window and at the absolute cap", async () => {
    const w = await wallet();
    const t0 = 1_800_000_000;
    const token = await createSessionToken(env, w.address, t0, t0);
    expect(await verifySessionToken(env, token, t0 + 60)).not.toBeNull();
    expect(await verifySessionToken(env, token, t0 + SESSION_IDLE_TTL_SECONDS)).toBeNull();
  });

  it("slides past half the idle window, never past the absolute cap", async () => {
    const w = await wallet();
    const t0 = 1_800_000_000;
    const first = (await verifySessionToken(env, await createSessionToken(env, w.address, t0, t0), t0))!;
    expect(await slideSessionToken(env, first, t0 + 60)).toBeNull();
    const late = t0 + SESSION_IDLE_TTL_SECONDS - 60;
    const slid = await slideSessionToken(env, first, late);
    expect(slid).not.toBeNull();
    const claims = (await verifySessionToken(env, slid!.token, late))!;
    expect(claims.authAt).toBe(t0);
    expect(claims.expiresAt).toBeLessThanOrEqual(t0 + SESSION_ABSOLUTE_TTL_SECONDS);
  });
});

describe("cookie and player id", () => {
  it("sets a Secure, HttpOnly cookie on https and reads it back", () => {
    const c = sessionCookie(env, "abc", 60);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(sessionCookie({ ...env, APP_DOMAIN: "localhost:8787" }, "abc", 60)).not.toContain("Secure");
    const req = new Request("https://genesis.test/", { headers: { Cookie: "a=1; gb1_session=tok.en.x; b=2" } });
    expect(readCookie(req, "gb1_session")).toBe("tok.en.x");
  });

  it("gives a wallet the same short player id every time, not its address", async () => {
    const w = await wallet();
    const id = await playerIdFor(env, w.address);
    expect(id).toBe(await playerIdFor(env, w.address));
    expect(id).toMatch(/^w[1-9A-HJ-NP-Za-km-z]{16}$/);
    expect(id).not.toContain(w.address.slice(0, 8));
    expect(id).not.toBe(await playerIdFor(env, (await wallet()).address));
  });
});
