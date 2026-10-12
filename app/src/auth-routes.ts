/**
 * `/api/auth/*`: Sign-In With Solana over HTTP. The crypto lives in ./auth, the shared memory (used nonces,
 * revoked tokens, rate limits) in ./auth-store. Flow and design: docs/auth.md.
 *
 *   POST /api/auth/challenge { publicKey? }                         → { message, signInInput, expiresInSeconds }
 *   POST /api/auth/verify    { publicKey, message, signature, method } → { ok, address } + Set-Cookie
 *   GET  /api/auth/session                                          → { address | null } (+ slid cookie)
 *   POST /api/auth/logout                                           → { ok } + cleared cookie
 */

import type { Env } from "./env";
import {
  SESSION_COOKIE,
  createChallenge,
  isAddress,
  playerIdFor,
  readCookie,
  sessionCookie,
  slideSessionToken,
  verifyLogin,
  verifySessionToken,
  verifySignIn,
  type SessionClaims,
} from "./auth";
import { AUTH_STORE_NAME } from "./auth-store";
import { BALANCE_READ_SECONDS, fetchGbackBalance } from "./gback";

export const AUTH_PREFIX = "/api/auth/";

/** Per IP, per 5 minutes. Challenge is one HMAC; verify is the expensive and the guessable one. */
const LIMITS = { challenge: 100, verify: 30 } as const;
const LIMIT_WINDOW_SECONDS = 5 * 60;

/**
 * RPC reads for the balance, on top of the one-per-wallet-per-30-s gate: wallets are free, so one client could sign
 * in many of them and have each read every 30 s. Only a read that would reach the RPC counts; an answer from the
 * stored amount costs nothing. Per IP it allows what sign-in allows (several players behind one office or school
 * address still fit); across everyone it caps what a flood from many IPs can spend of the key.
 */
export const BALANCE_RPC_LIMITS = { perIp: 30, ipWindowSeconds: 5 * 60, perMinute: 60 } as const;
/** A sign-in body is a few hundred bytes; anything far larger is not one. */
const MAX_BODY_BYTES = 8 * 1024;

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function authStore(env: Env) {
  return env.ROOMS.get(env.ROOMS.idFromName(AUTH_STORE_NAME));
}

/** The revoke list stores a hash, so a leaked store never leaks a usable token. */
async function tokenKey(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The signed-in wallet behind a request, or null. Used by the session route and, later, the /ws upgrade. */
export async function sessionOf(request: Request, env: Env): Promise<{ token: string; claims: SessionClaims } | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const claims = await verifySessionToken(env, token);
  if (!claims) return null;
  if (await authStore(env).authIsRevoked(await tokenKey(token))) return null;
  return { token, claims };
}

async function readJson(request: Request): Promise<Record<string, unknown> | null | "too large" | "not json"> {
  // A cross-site form can only post text/plain, form or multipart; requiring JSON keeps those out.
  if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) return "not json";
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) return "too large";
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return "too large";
  try {
    const body: unknown = JSON.parse(text || "{}");
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function limited(request: Request, env: Env, route: keyof typeof LIMITS): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  return !(await authStore(env).authHit(`${route}:${ip}`, LIMITS[route], LIMIT_WINDOW_SECONDS));
}

/**
 * `GET /api/gback/balance`: the $GBACK amount of the SIGNED-IN wallet. There is no `?owner=`: the route only
 * ever answers for the wallet in the session cookie.
 *
 * At most one RPC read per wallet per BALANCE_READ_SECONDS. In between it answers with the amount the last read
 * stored, so `at` (when that read was made, unix seconds) may be up to that old; without a stored amount it is 429.
 */
export async function handleBalance(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ error: "not found" }, 404);
  if (!env.SIWS_JWT_SECRET || !env.APP_DOMAIN) return json({ error: "sign-in is not configured" }, 503);
  const session = await sessionOf(request, env);
  if (!session) return json({ error: "not signed in" }, 401);
  if (!env.SOLANA_RPC_URL) return json({ error: "balance is not configured (SOLANA_RPC_URL)" }, 503);
  const owner = session.claims.publicKey;
  const store = authStore(env);
  const gate = await store.balanceGate(owner, BALANCE_READ_SECONDS);
  if (!gate.read) {
    if (gate.last) return json(JSON.parse(gate.last));
    const wait = Math.max(1, BALANCE_READ_SECONDS - gate.age);
    return json({ error: "balance was just asked for; try again shortly", retryAfter: wait }, 429, { "Retry-After": String(wait) });
  }
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const allowed =
    (await store.authHit(`balance-rpc:${ip}`, BALANCE_RPC_LIMITS.perIp, BALANCE_RPC_LIMITS.ipWindowSeconds)) &&
    (await store.authHit("balance-rpc:all", BALANCE_RPC_LIMITS.perMinute, 60));
  if (!allowed) {
    // The read stays booked, so this wallet waits its 30 s like after any read.
    if (gate.last) return json(JSON.parse(gate.last));
    return json({ error: "too many balance requests; try again shortly", retryAfter: BALANCE_READ_SECONDS }, 429, {
      "Retry-After": String(BALANCE_READ_SECONDS),
    });
  }
  try {
    const balance = { ...(await fetchGbackBalance(env, owner)), at: Math.floor(Date.now() / 1000) };
    await store.balanceStore(owner, JSON.stringify(balance));
    return json(balance);
  } catch (err) {
    console.error("gback balance:", err instanceof Error ? err.message : String(err));
    return json({ error: "rpc unavailable" }, 502);
  }
}

/** null when the path is not an auth route, so the Worker falls through to its other routes. */
export async function handleAuth(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith(AUTH_PREFIX)) return null;
  const route = url.pathname.slice(AUTH_PREFIX.length);
  const method = request.method;

  if (!env.SIWS_JWT_SECRET || !env.APP_DOMAIN) return json({ error: "sign-in is not configured" }, 503);

  if (route === "session" && method === "GET") {
    const session = await sessionOf(request, env);
    if (!session) {
      // A stale or revoked cookie is cleared, so the browser stops sending it.
      const headers: Record<string, string> = readCookie(request, SESSION_COOKIE) ? { "Set-Cookie": sessionCookie(env, "", 0) } : {};
      return json({ address: null }, 200, headers);
    }
    const slid = await slideSessionToken(env, session.claims);
    const headers: Record<string, string> = slid ? { "Set-Cookie": sessionCookie(env, slid.token, slid.maxAgeSeconds) } : {};
    const address = session.claims.publicKey;
    return json({ address, playerId: await playerIdFor(env, address) }, 200, headers);
  }

  if (method !== "POST") return json({ error: "not found" }, 404);

  const body = await readJson(request);
  if (body === "not json") return json({ error: "expected application/json" }, 415);
  if (body === "too large") return json({ error: "body too large" }, 413);
  if (!body) return json({ error: "expected a json object" }, 400);

  if (route === "challenge") {
    if (await limited(request, env, "challenge")) return json({ error: "too many sign-in attempts" }, 429);
    const publicKey = body.publicKey;
    // Checked as an address because it goes into the nonce HMAC: otherwise any body gets a signed nonce.
    if (publicKey !== undefined && publicKey !== null && !isAddress(publicKey)) {
      return json({ error: "publicKey must be a base58 Solana address" }, 400);
    }
    return json(await createChallenge(env, publicKey || null));
  }

  if (route === "verify") {
    if (await limited(request, env, "verify")) return json({ error: "too many sign-in attempts" }, 429);
    const { publicKey, message, signature, method: how } = body;
    if (typeof publicKey !== "string" || typeof message !== "string" || typeof signature !== "string") {
      return json({ error: "publicKey, message and signature are required" }, 400);
    }
    if (!isAddress(publicKey)) return json({ error: "publicKey must be a base58 Solana address" }, 400);
    // `method` picks the message shape ("signIn" field by field, "signMessage" byte-exact), not trust.
    if (how !== "signIn" && how !== "signMessage") return json({ error: "method must be 'signIn' or 'signMessage'" }, 400);

    const store = authStore(env);
    const consume = (id: string, rememberSeconds: number) => store.authConsumeNonce(id, rememberSeconds);
    const verify = how === "signIn" ? verifySignIn : verifyLogin;
    const result = await verify(env, { publicKey, message, signature }, consume);
    if (!result.ok) return json({ error: result.error }, 401);
    // A sign-in over a live session (a wallet switch in the extension) replaces it: the old token is revoked, not
    // just overwritten in this browser, so a copy of it stops working too.
    const previous = await sessionOf(request, env);
    if (previous) await store.authRevoke(await tokenKey(previous.token), previous.claims.expiresAt);
    return json({ ok: true, address: publicKey, playerId: await playerIdFor(env, publicKey) }, 200, { "Set-Cookie": sessionCookie(env, result.sessionToken, result.maxAgeSeconds) });
  }

  if (route === "logout") {
    // Clearing the cookie alone would leave a copied token valid until it expires.
    const session = await sessionOf(request, env);
    if (session) await authStore(env).authRevoke(await tokenKey(session.token), session.claims.expiresAt);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(env, "", 0) });
  }

  return json({ error: "not found" }, 404);
}
