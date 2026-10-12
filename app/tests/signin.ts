/**
 * Test helper: a fresh wallet that signs in through the real routes, for tests that need a session (a room
 * is only entered with one). The crypto and HTTP cases of the sign-in itself live in auth*.test.ts.
 */

import { SELF } from "cloudflare:test";
import { base58Encode } from "../src/auth";

let ipCounter = 0;

/**
 * Signs a new wallet in. `cookie` is ready to send back as a Cookie header. `over`: the Cookie of a session this
 * browser already has (a wallet switch).
 */
export async function signedInWallet(over?: string): Promise<{ address: string; playerId: string; cookie: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const address = base58Encode(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer));
  // Its own client IP per wallet, so the sign-in rate limit never couples tests.
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": `10.77.${(++ipCounter >> 8) & 255}.${ipCounter & 255}` };
  const challenge = await SELF.fetch("https://game.test/api/auth/challenge", { method: "POST", headers, body: JSON.stringify({ publicKey: address }) });
  const { message } = (await challenge.json()) as { message: string };
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(message)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  const verify = await SELF.fetch("https://game.test/api/auth/verify", {
    method: "POST",
    headers: over ? { ...headers, Cookie: over } : headers,
    body: JSON.stringify({ publicKey: address, message, signature: btoa(bin), method: "signMessage" }),
  });
  if (verify.status !== 200) throw new Error(`sign-in failed: ${verify.status} ${await verify.text()}`);
  const { playerId } = (await verify.json()) as { playerId: string };
  return { address, playerId, cookie: verify.headers.get("Set-Cookie")!.split(";")[0]! };
}
