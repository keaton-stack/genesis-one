/**
 * $GBACK balance: parsing the RPC answer (src/gback.ts) and the signed-in-only route.
 * The RPC is never called for real: the fetcher is injected, and the test Worker's SOLANA_RPC_URL is a
 * .invalid host (vitest.config.ts).
 */

import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { base58Encode } from "../src/auth";
import { BALANCE_READ_SECONDS, GBACK_MINT, fetchGbackBalance, parseBalance } from "../src/gback";
import type { Env } from "../src/env";
import { BALANCE_RPC_LIMITS } from "../src/auth-routes";
import { signedInWallet } from "./signin";

const account = (amount: string) => ({ account: { data: { parsed: { info: { mint: GBACK_MINT, tokenAmount: { amount, decimals: 6 } } } } } });
const rpc = (...amounts: string[]) => ({ jsonrpc: "2.0", id: 1, result: { context: { slot: 42 }, value: amounts.map(account) } });

function randomOwner(): string {
  return base58Encode(crypto.getRandomValues(new Uint8Array(32)));
}

describe("parseBalance", () => {
  it("sums every token account of the mint", () => {
    expect(parseBalance(rpc("1500000", "2500000"))).toEqual({ raw: "4000000", decimals: 6, ui: 4, slot: 42 });
  });

  it("no token account is 0, not an error", () => {
    expect(parseBalance(rpc())).toEqual({ raw: "0", decimals: 6, ui: 0, slot: 42 });
  });

  it("keeps amounts beyond 2^53 exact in raw", () => {
    expect(parseBalance(rpc("18446744073709551615")).raw).toBe("18446744073709551615");
    expect(parseBalance(rpc("123456789")).ui).toBeCloseTo(123.456789, 6);
  });

  it("throws on an RPC error or an unexpected shape", () => {
    expect(() => parseBalance({ error: { message: "rate limited" } })).toThrow("rate limited");
    expect(() => parseBalance({ result: {} })).toThrow();
    expect(() => parseBalance(rpc("-5"))).toThrow();
  });
});

describe("fetchGbackBalance", () => {
  it("asks for this owner and this mint only", async () => {
    const owner = randomOwner();
    let calls = 0;
    let sent: any;
    const fetcher = (async (_url: string, init: RequestInit) => {
      calls++;
      sent = JSON.parse(init.body as string);
      return Response.json(rpc("7000000"));
    }) as unknown as typeof fetch;
    expect((await fetchGbackBalance({ SOLANA_RPC_URL: "https://rpc.test" }, owner, fetcher)).ui).toBe(7);
    expect(sent.method).toBe("getTokenAccountsByOwner");
    expect(sent.params[0]).toBe(owner);
    expect(sent.params[1]).toEqual({ mint: GBACK_MINT });
    expect(calls).toBe(1);
  });

  it("throws on an HTTP failure", async () => {
    const fetcher = (async () => new Response("nope", { status: 429 })) as unknown as typeof fetch;
    await expect(fetchGbackBalance({ SOLANA_RPC_URL: "https://rpc.test" }, randomOwner(), fetcher)).rejects.toThrow("rpc http 429");
  });

  it("has no keyless fallback: the public endpoint blocks Workers", async () => {
    let calls = 0;
    const fetcher = (async () => { calls++; return Response.json(rpc("1")); }) as unknown as typeof fetch;
    await expect(fetchGbackBalance({}, randomOwner(), fetcher)).rejects.toThrow("SOLANA_RPC_URL is not set");
    expect(calls).toBe(0);
  });
});

describe("GET /api/gback/balance", () => {
  it("is 401 without a session: there is no ?owner= to ask about someone else", async () => {
    const res = await SELF.fetch(`https://game.test/api/gback/balance?owner=${GBACK_MINT}`);
    expect(res.status).toBe(401);
  });

  it("is 502 for a signed-in wallet when the RPC is down", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const address = base58Encode(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer));
    const headers = { "Content-Type": "application/json", "CF-Connecting-IP": "10.9.9.9" };
    const { message } = (await (await SELF.fetch("https://game.test/api/auth/challenge", { method: "POST", headers, body: JSON.stringify({ publicKey: address }) })).json()) as { message: string };
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(message)));
    const signature = btoa(String.fromCharCode(...sig));
    const verify = await SELF.fetch("https://game.test/api/auth/verify", { method: "POST", headers, body: JSON.stringify({ publicKey: address, message, signature, method: "signMessage" }) });
    const cookie = verify.headers.get("Set-Cookie")!.split(";")[0]!;

    const res = await SELF.fetch("https://game.test/api/gback/balance", { headers: { Cookie: cookie } });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "rpc unavailable" });

    // The failed read still counts: the next ask within the window does not go to the RPC again.
    const again = await SELF.fetch("https://game.test/api/gback/balance", { headers: { Cookie: cookie } });
    expect(again.status).toBe(429);
    expect(Number(again.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

describe("RPC reads per IP and in total: many free wallets cannot drain the key", () => {
  const balance = (cookie: string, ip: string) => SELF.fetch("https://game.test/api/gback/balance", { headers: { Cookie: cookie, "CF-Connecting-IP": ip } });

  it("allows one IP its reads, then refuses the next wallet from it", async () => {
    const ip = `10.66.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < BALANCE_RPC_LIMITS.perIp; i++) {
      // each a new wallet, so the per-wallet gate never answers first; the test RPC is down, hence 502
      expect((await balance((await signedInWallet()).cookie, ip)).status).toBe(502);
    }
    const over = await balance((await signedInWallet()).cookie, ip);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "too many balance requests; try again shortly" });
    // another IP is not affected
    expect((await balance((await signedInWallet()).cookie, "10.65.0.1")).status).toBe(502);
  }, 60_000); // a sign-in per wallet

  it("caps the reads per minute across all IPs", async () => {
    let refused = 0;
    // other tests may already have spent part of this minute's budget, so look for the cap, not its exact position
    for (let i = 0; i < BALANCE_RPC_LIMITS.perMinute + 1 && !refused; i++) {
      const res = await balance((await signedInWallet()).cookie, `10.64.${i >> 8}.${i & 255}`);
      if (res.status === 429) refused = i + 1;
      else expect(res.status).toBe(502);
    }
    expect(refused).toBeGreaterThan(0);
  }, 60_000);
});

describe("balanceGate: one RPC read per wallet per window", () => {
  const rooms = (env as unknown as Env).ROOMS;
  const store = () => rooms.get(rooms.idFromName(`__gate-${crypto.randomUUID()}`));

  it("grants the first read, then answers with the stored amount until the window is over", async () => {
    const s = store();
    const owner = randomOwner();
    expect(await s.balanceGate(owner, BALANCE_READ_SECONDS)).toMatchObject({ read: true, last: null });
    // a parallel ask while the read is out: no second read, nothing to show yet
    expect(await s.balanceGate(owner, BALANCE_READ_SECONDS)).toMatchObject({ read: false, last: null });
    await s.balanceStore(owner, JSON.stringify({ ui: 7, at: 1 }));
    expect(await s.balanceGate(owner, BALANCE_READ_SECONDS)).toMatchObject({ read: false, last: JSON.stringify({ ui: 7, at: 1 }) });
    // another wallet has its own window
    expect(await s.balanceGate(randomOwner(), BALANCE_READ_SECONDS)).toMatchObject({ read: true });
  });

  it("grants a read again once the window is over, and keeps the last amount meanwhile", async () => {
    const s = store();
    const owner = randomOwner();
    await s.balanceGate(owner, 0);
    await s.balanceStore(owner, "{\"ui\":3}");
    expect(await s.balanceGate(owner, 0)).toMatchObject({ read: true, last: "{\"ui\":3}" });
  });
});
