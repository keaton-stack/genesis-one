/**
 * Sign-In With Solana (SIWS): challenge, both verifiers, the session token and the player id.
 *
 * Ported from the dashboard's `lib/auth/index.ts` (see docs/auth.md). Differences: no npm
 * dependencies (base58, base64url and HS256 are written out here on WebCrypto), configuration comes from
 * `env` instead of `process.env`, and single use of a nonce is the caller's job (`consume`), because a
 * Worker runs in many isolates and an in-memory map would not be shared between them.
 *
 * Nothing here trusts the request: every input is a string from a body or a cookie.
 */

export interface AuthEnv {
  /** Signs nonces, session tokens and player ids. Secret, set on the platform, never committed. */
  SIWS_JWT_SECRET?: string;
  /** The host the sign-in message names, e.g. "genesis.example" or "localhost:8787". Never the Host header. */
  APP_DOMAIN?: string;
}

const CHALLENGE_TTL_SECONDS = 5 * 60;
/** Tolerance for a client clock running ahead of ours. */
const CLOCK_SKEW_SECONDS = 60;
/** Checked verbatim on both verify paths. */
export const STATEMENT = "Sign in to Genesis One. This does not cost anything or move any tokens.";
/** Sliding idle window. */
export const SESSION_IDLE_TTL_SECONDS = 10 * 60 * 60;
/** Hard cap on session age regardless of activity. */
export const SESSION_ABSOLUTE_TTL_SECONDS = 24 * 60 * 60;
export const SESSION_COOKIE = "gb1_session";

const nowSeconds = () => Math.floor(Date.now() / 1000);
const utf8 = new TextEncoder();

function secret(env: AuthEnv): Uint8Array {
  const s = env.SIWS_JWT_SECRET;
  if (!s) throw new Error("SIWS_JWT_SECRET is not set");
  return utf8.encode(s);
}

function appDomain(env: AuthEnv): string {
  const d = env.APP_DOMAIN;
  if (!d) throw new Error("APP_DOMAIN is not set");
  return d;
}

/** Must be truthful, http on localhost too: `solana:signIn` wallets check it against the page origin. */
function appUri(env: AuthEnv): string {
  const domain = appDomain(env);
  const scheme = /^(localhost|127\.0\.0\.1)(:|$)/.test(domain) ? "http" : "https";
  return `${scheme}://${domain}`;
}

/** Whole seconds, so the value round-trips through the nonce exactly. */
function isoFromSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

// ── Encodings ──────────────────────────────────────────────────────────────────────────────────────

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_INDEX = new Map([...B58].map((c, i) => [c, i]));

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]!];
  return out;
}

/** null on any character outside the alphabet: the input comes straight from a request. */
export function base58Decode(text: string): Uint8Array | null {
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  const bytes: number[] = [];
  for (let i = zeros; i < text.length; i++) {
    const v = B58_INDEX.get(text[i]!);
    if (v === undefined) return null;
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[out.length - 1 - i] = bytes[i]!;
  return out;
}

/** A Solana address: base58 that decodes to exactly 32 bytes. Bounded first, so a huge string costs nothing. */
export function isAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  return base58Decode(value)?.length === 32;
}

function base64Decode(text: string): Uint8Array | null {
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  return base64Decode(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function hmac(env: AuthEnv, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", secret(env), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

// ── Nonce ──────────────────────────────────────────────────────────────────────────────────────────
// 33 bytes: 12 random, 4-byte issued-at, bound/unbound flag, 16-byte HMAC tag. Base58 because Phantom
// rejects a non-alphanumeric nonce (EIP-4361) and `solana:signIn` then silently falls back. The unbound
// flag serves connect-and-sign-in-at-once, where the address is not known yet.
const NONCE_RANDOM_BYTES = 12;
const NONCE_TAG_BYTES = 16;
const NONCE_FLAG_OFFSET = NONCE_RANDOM_BYTES + 4;
const NONCE_BYTES = NONCE_FLAG_OFFSET + 1 + NONCE_TAG_BYTES;

/** Domain separation: the same secret signs session tokens and player ids. Bumping it voids nonces in flight. */
const NONCE_HMAC_LABEL = utf8.encode("gb1:siws-nonce:v1");

/** HMAC over (label ‖ random ‖ issuedAt ‖ flag ‖ address if bound); covering the flag stops a downgrade. */
async function nonceTag(env: AuthEnv, random: Uint8Array, issuedAtSeconds: number, publicKey: string | null): Promise<Uint8Array> {
  const head = new Uint8Array(NONCE_FLAG_OFFSET + 1);
  head.set(random, 0);
  new DataView(head.buffer).setUint32(NONCE_RANDOM_BYTES, issuedAtSeconds, false);
  head[NONCE_FLAG_OFFSET] = publicKey ? 1 : 0;
  const sig = await hmac(env, concat(NONCE_HMAC_LABEL, head, utf8.encode(publicKey ?? "")));
  return sig.slice(0, NONCE_TAG_BYTES);
}

async function createNonce(env: AuthEnv, publicKey: string | null, issuedAtSeconds: number): Promise<string> {
  const random = crypto.getRandomValues(new Uint8Array(NONCE_RANDOM_BYTES));
  const out = new Uint8Array(NONCE_BYTES);
  out.set(random, 0);
  new DataView(out.buffer).setUint32(NONCE_RANDOM_BYTES, issuedAtSeconds, false);
  out[NONCE_FLAG_OFFSET] = publicKey ? 1 : 0;
  out.set(await nonceTag(env, random, issuedAtSeconds, publicKey), NONCE_FLAG_OFFSET + 1);
  return base58Encode(out);
}

interface CheckedNonce {
  issuedAtSeconds: number;
  bound: boolean;
  /** hex of the random part: the single-use key. */
  id: string;
}

async function verifyNonce(env: AuthEnv, nonce: string, publicKey: string, now: number): Promise<CheckedNonce | null> {
  if (nonce.length > 64) return null;
  const bytes = base58Decode(nonce);
  if (!bytes || bytes.length !== NONCE_BYTES) return null;
  const random = bytes.slice(0, NONCE_RANDOM_BYTES);
  const issuedAtSeconds = new DataView(bytes.buffer, bytes.byteOffset).getUint32(NONCE_RANDOM_BYTES, false);
  const flag = bytes[NONCE_FLAG_OFFSET];
  if (flag !== 0 && flag !== 1) return null;
  const bound = flag === 1;
  const expected = await nonceTag(env, random, issuedAtSeconds, bound ? publicKey : null);
  if (!timingSafeEqual(bytes.slice(NONCE_FLAG_OFFSET + 1), expected)) return null;
  const age = now - issuedAtSeconds;
  if (age > CHALLENGE_TTL_SECONDS || age < -CLOCK_SKEW_SECONDS) return null;
  return { issuedAtSeconds, bound, id: toHex(random) };
}

/** How long a consumed nonce must be remembered: past this it fails `verifyNonce` on its own. */
export const NONCE_REMEMBER_SECONDS = CHALLENGE_TTL_SECONDS + CLOCK_SKEW_SECONDS;

/**
 * Marks a nonce used. Resolves false when it was used before. Must be shared by every isolate (a Durable
 * Object), or one signed challenge mints sessions for five minutes.
 */
export type ConsumeNonce = (id: string, rememberSeconds: number) => Promise<boolean>;

// ── Message ────────────────────────────────────────────────────────────────────────────────────────

/** EIP-4361 / SIWS field order, the same text a `solana:signIn` wallet composes from `signInInput`. */
function buildMessage(env: AuthEnv, publicKey: string, nonce: string, issuedAtSeconds: number): string {
  return [
    `${appDomain(env)} wants you to sign in with your Solana account:`,
    publicKey,
    "",
    STATEMENT,
    "",
    `URI: ${appUri(env)}`,
    "Version: 1",
    `Nonce: ${nonce}`,
    `Issued At: ${isoFromSeconds(issuedAtSeconds)}`,
    `Expiration Time: ${isoFromSeconds(issuedAtSeconds + CHALLENGE_TTL_SECONDS)}`,
  ].join("\n");
}

function parseNonce(message: string): string | null {
  const line = message.split("\n").find((l) => l.startsWith("Nonce: "));
  return line ? line.slice("Nonce: ".length) : null;
}

/** Fields instead of text, so the wallet draws its own sign-in sheet. */
export interface SignInInput {
  domain: string;
  /** Omitted when no wallet was connected yet; the wallet fills it in. */
  address?: string;
  statement: string;
  uri: string;
  version: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

export interface Challenge {
  /** For the `signMessage` path; null without an address (then it is `signIn` only). */
  message: string | null;
  signInInput: SignInInput;
  expiresInSeconds: number;
}

/** Omit `publicKey` for connect-and-sign-in-at-once, where the address is not known yet. */
export async function createChallenge(env: AuthEnv, publicKey: string | null, now = nowSeconds()): Promise<Challenge> {
  // issuedAt lives INSIDE the nonce, so verification can rebuild the exact message it issued.
  const nonce = await createNonce(env, publicKey, now);
  return {
    message: publicKey ? buildMessage(env, publicKey, nonce, now) : null,
    signInInput: {
      domain: appDomain(env),
      ...(publicKey ? { address: publicKey } : {}),
      statement: STATEMENT,
      uri: appUri(env),
      version: "1",
      nonce,
      issuedAt: isoFromSeconds(now),
      expirationTime: isoFromSeconds(now + CHALLENGE_TTL_SECONDS),
    },
    expiresInSeconds: CHALLENGE_TTL_SECONDS,
  };
}

/** Signature base64, message utf-8, publicKey base58. */
async function verifyEd25519(publicKey: string, message: string, signatureBase64: string): Promise<boolean> {
  const pub = base58Decode(publicKey);
  const sig = base64Decode(signatureBase64);
  if (!pub || pub.length !== 32 || !sig || sig.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, utf8.encode(message));
  } catch {
    return false;
  }
}

export interface VerifyInput {
  publicKey: string;
  message: string;
  signature: string;
}

export type VerifyResult = { ok: true; sessionToken: string; maxAgeSeconds: number } | { ok: false; error: string };

/** The `signMessage` path. We issued this exact text, so the check is byte equality. */
export async function verifyLogin(env: AuthEnv, input: VerifyInput, consume: ConsumeNonce, now = nowSeconds()): Promise<VerifyResult> {
  const nonce = parseNonce(input.message);
  if (!nonce) return { ok: false, error: "malformed message" };

  // Unbound nonces are refused: this path always knows the address up front.
  const checked = await verifyNonce(env, nonce, input.publicKey, now);
  if (!checked?.bound) return { ok: false, error: "challenge expired or invalid" };

  // Bind the WHOLE message, or a real nonce wrapped in attacker text mints a session from the victim's signature.
  if (input.message !== buildMessage(env, input.publicKey, nonce, checked.issuedAtSeconds)) {
    return { ok: false, error: "message does not match challenge" };
  }
  if (!(await verifyEd25519(input.publicKey, input.message, input.signature))) {
    return { ok: false, error: "invalid signature" };
  }
  // Only after the signature: a failed attempt must not burn a challenge the real wallet still holds.
  if (!(await consume(checked.id, NONCE_REMEMBER_SECONDS))) return { ok: false, error: "challenge already used" };

  return { ok: true, sessionToken: await createSessionToken(env, input.publicKey, now, now), maxAgeSeconds: SESSION_IDLE_TTL_SECONDS };
}

/** The complete set of fields `verifySignIn` tolerates. */
const SIGN_IN_FIELDS = ["URI", "Version", "Nonce", "Issued At", "Expiration Time"];

/** Strict: an unparseable or duplicated field line rejects, since the player was shown every line. */
function parseSiwsMessage(message: string): { domain: string; address: string; statement: string; fields: Map<string, string> } | null {
  const lines = message.split("\n");
  const header = lines[0]?.match(/^(\S+) wants you to sign in with your Solana account:$/);
  if (!header || !lines[1]) return null;

  // Found by its first known key: the statement may contain colons.
  const fieldStart = lines.findIndex((l) => l.startsWith("URI: "));
  if (fieldStart < 2) return null;

  const fields = new Map<string, string>();
  for (const line of lines.slice(fieldStart)) {
    if (line === "") continue;
    const sep = line.indexOf(": ");
    if (sep <= 0) return null;
    const key = line.slice(0, sep);
    if (fields.has(key)) return null;
    fields.set(key, line.slice(sep + 2));
  }
  return { domain: header[1]!, address: lines[1], statement: lines.slice(2, fieldStart).join("\n").trim(), fields };
}

/**
 * The `solana:signIn` path. The wallet composed this message, so no byte equality: every field is checked and
 * any field we did not send rejects. `message` is the returned `signedMessage` as UTF-8.
 */
export async function verifySignIn(env: AuthEnv, input: VerifyInput, consume: ConsumeNonce, now = nowSeconds()): Promise<VerifyResult> {
  const parsed = parseSiwsMessage(input.message);
  if (!parsed) return { ok: false, error: "malformed message" };

  // The anti-phishing check: never approximate.
  if (parsed.domain !== appDomain(env)) return { ok: false, error: "message does not match challenge" };
  if (parsed.address !== input.publicKey || parsed.statement !== STATEMENT) {
    return { ok: false, error: "message does not match challenge" };
  }
  for (const key of parsed.fields.keys()) {
    if (!SIGN_IN_FIELDS.includes(key)) return { ok: false, error: "message does not match challenge" };
  }

  const nonce = parsed.fields.get("Nonce");
  if (!nonce) return { ok: false, error: "malformed message" };
  // Unbound is fine here: the address is checked above and must still produce the signature.
  const checked = await verifyNonce(env, nonce, input.publicKey, now);
  if (!checked) return { ok: false, error: "challenge expired or invalid" };

  // Pinned to the nonce, so a wallet cannot widen the window or change the origin.
  const expected: Record<string, string> = {
    URI: appUri(env),
    Version: "1",
    "Issued At": isoFromSeconds(checked.issuedAtSeconds),
    "Expiration Time": isoFromSeconds(checked.issuedAtSeconds + CHALLENGE_TTL_SECONDS),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (parsed.fields.get(key) !== value) return { ok: false, error: "message does not match challenge" };
  }

  if (!(await verifyEd25519(input.publicKey, input.message, input.signature))) {
    return { ok: false, error: "invalid signature" };
  }
  if (!(await consume(checked.id, NONCE_REMEMBER_SECONDS))) return { ok: false, error: "challenge already used" };

  return { ok: true, sessionToken: await createSessionToken(env, input.publicKey, now, now), maxAgeSeconds: SESSION_IDLE_TTL_SECONDS };
}

// ── Session token (HS256 JWT) ──────────────────────────────────────────────────────────────────────

const JWT_HEADER = base64UrlEncode(utf8.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));

/** `authAt` (unix s) is carried across slides so the absolute cap stays anchored to the first sign-in. */
export async function createSessionToken(env: AuthEnv, publicKey: string, authAt: number, now = nowSeconds()): Promise<string> {
  const exp = Math.min(now + SESSION_IDLE_TTL_SECONDS, authAt + SESSION_ABSOLUTE_TTL_SECONDS);
  const payload = base64UrlEncode(utf8.encode(JSON.stringify({ kind: "siws-session", sub: publicKey, authAt, iat: now, exp })));
  const signingInput = `${JWT_HEADER}.${payload}`;
  return `${signingInput}.${base64UrlEncode(await hmac(env, utf8.encode(signingInput)))}`;
}

export interface SessionClaims {
  publicKey: string;
  /** Original sign-in time (unix seconds). */
  authAt: number;
  /** Current token expiry (unix seconds). */
  expiresAt: number;
}

/** null for anything that is not a live token we signed. Revocation is checked by the caller. */
export async function verifySessionToken(env: AuthEnv, token: string, now = nowSeconds()): Promise<SessionClaims | null> {
  if (token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== JWT_HEADER) return null;
  const sig = base64UrlDecode(parts[2]!);
  if (!sig) return null;
  const expected = await hmac(env, utf8.encode(`${parts[0]}.${parts[1]}`));
  if (!timingSafeEqual(sig, expected)) return null;
  const raw = base64UrlDecode(parts[1]!);
  if (!raw) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (p.kind !== "siws-session" || !isAddress(p.sub)) return null;
  if (typeof p.exp !== "number" || typeof p.authAt !== "number") return null;
  if (p.exp <= now || p.authAt + SESSION_ABSOLUTE_TTL_SECONDS <= now) return null;
  return { publicKey: p.sub, authAt: p.authAt, expiresAt: p.exp };
}

/** null past the absolute cap, or while more than half the idle window is left (no cookie churn). */
export async function slideSessionToken(env: AuthEnv, session: SessionClaims, now = nowSeconds()): Promise<{ token: string; maxAgeSeconds: number } | null> {
  const capRemaining = session.authAt + SESSION_ABSOLUTE_TTL_SECONDS - now;
  if (capRemaining <= 0) return null;
  if (session.expiresAt - now > SESSION_IDLE_TTL_SECONDS / 2) return null;
  return {
    token: await createSessionToken(env, session.publicKey, session.authAt, now),
    maxAgeSeconds: Math.min(SESSION_IDLE_TTL_SECONDS, capRemaining),
  };
}

// ── Cookie ─────────────────────────────────────────────────────────────────────────────────────────

/** `Secure` everywhere but plain-http localhost, where the browser would drop a Secure cookie. */
export function sessionCookie(env: AuthEnv, token: string, maxAgeSeconds: number): string {
  const secure = appUri(env).startsWith("https:") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// ── Player id ──────────────────────────────────────────────────────────────────────────────────────

const PLAYER_ID_LABEL = utf8.encode("gb1:player:v1");

/**
 * The room identity of a wallet: stable per wallet, but not the address itself, since every player id is sent
 * to every client in the room. "w" marks a wallet player; a guest id would start with something else.
 * Changing `SIWS_JWT_SECRET` changes every player id, so treat it as permanent.
 */
export async function playerIdFor(env: AuthEnv, address: string): Promise<string> {
  return "w" + base58Encode(await hmac(env, concat(PLAYER_ID_LABEL, utf8.encode(address)))).slice(0, 16);
}

/**
 * The identity the Worker hands a room on a `/ws` upgrade (src/worker.ts), and the only one the room trusts
 * (src/room.ts). Only the Worker sets them, after checking the session cookie; whatever a client sent under
 * these names is dropped first.
 */
export const WALLET_HEADERS = { wallet: "X-GB-Wallet", player: "X-GB-Player", exp: "X-GB-Exp" } as const;
