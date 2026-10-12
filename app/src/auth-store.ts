/**
 * The shared memory sign-in needs: used nonces, revoked session tokens and rate-limit counters. Also the last
 * $GBACK amount read per wallet, which limits how often the RPC is asked (src/gback.ts).
 *
 * A Worker runs in many isolates, so this cannot be an in-memory map (the dashboard's choice, which works
 * there because it runs as one container). It lives in ONE Durable Object: a `Room` instance under the
 * reserved name `AUTH_STORE_NAME`, which the Worker never routes a WebSocket to. A Durable Object runs one
 * call at a time and SQLite calls are synchronous, so "check, then insert" below is atomic: a nonce really
 * is consumed once.
 *
 * Rows expire on their own; every write first deletes what has expired, so the tables stay small without
 * an alarm (the Room's alarm belongs to the game loop).
 */

/** Reserved Durable Object name. `worker.ts` refuses room names starting with "__". */
export const AUTH_STORE_NAME = "__auth";

function ensureTables(sql: SqlStorage): void {
  sql.exec("CREATE TABLE IF NOT EXISTS auth_nonce (id TEXT PRIMARY KEY, exp INTEGER NOT NULL)");
  sql.exec("CREATE TABLE IF NOT EXISTS auth_revoked (key TEXT PRIMARY KEY, exp INTEGER NOT NULL)");
  sql.exec("CREATE TABLE IF NOT EXISTS auth_hits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)");
  sql.exec("CREATE TABLE IF NOT EXISTS gback_read (owner TEXT PRIMARY KEY, at INTEGER NOT NULL, balance TEXT)");
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** true the first time `id` is seen within `rememberSeconds`, false on every later call. */
export function consumeNonce(sql: SqlStorage, id: string, rememberSeconds: number): boolean {
  ensureTables(sql);
  const now = nowSeconds();
  sql.exec("DELETE FROM auth_nonce WHERE exp <= ?", now);
  if (sql.exec("SELECT 1 FROM auth_nonce WHERE id = ?", id).toArray().length > 0) return false;
  sql.exec("INSERT INTO auth_nonce (id, exp) VALUES (?, ?)", id, now + rememberSeconds);
  return true;
}

/** `key` is a hash of the token, never the token itself. Remembered until the token would expire anyway. */
export function revokeKey(sql: SqlStorage, key: string, expSeconds: number): void {
  ensureTables(sql);
  sql.exec("DELETE FROM auth_revoked WHERE exp <= ?", nowSeconds());
  sql.exec("INSERT OR REPLACE INTO auth_revoked (key, exp) VALUES (?, ?)", key, expSeconds);
}

export function isKeyRevoked(sql: SqlStorage, key: string): boolean {
  ensureTables(sql);
  return sql.exec("SELECT 1 FROM auth_revoked WHERE key = ? AND exp > ?", key, nowSeconds()).toArray().length > 0;
}

/** Fixed-window counter. true while `key` has made at most `limit` calls in the current window. */
export function hit(sql: SqlStorage, key: string, limit: number, windowSeconds: number): boolean {
  ensureTables(sql);
  const now = nowSeconds();
  sql.exec("DELETE FROM auth_hits WHERE window_start <= ?", now - windowSeconds);
  const row = sql.exec<{ count: number }>("SELECT count FROM auth_hits WHERE key = ?", key).toArray()[0];
  if (!row) {
    sql.exec("INSERT INTO auth_hits (key, window_start, count) VALUES (?, ?, 1)", key, now);
    return true;
  }
  sql.exec("UPDATE auth_hits SET count = count + 1 WHERE key = ?", key);
  return row.count + 1 <= limit;
}

/** A wallet's last amount is kept this long, so a reload inside the read window still has something to show. */
const BALANCE_KEEP_SECONDS = 24 * 60 * 60;

export interface BalanceGate {
  /** true: the caller may ask the RPC now, and the read is already booked. */
  read: boolean;
  /** The amount the previous read stored (JSON), if any. */
  last: string | null;
  /** Seconds since the previous read was booked. */
  age: number;
}

/**
 * At most one RPC read per wallet per `windowSeconds`, however often it is asked for (reloads, the refresh icon,
 * several tabs). A granted read is booked at once, so parallel requests do not all go out; a failed read still
 * counts, so a broken RPC is not hammered either.
 */
export function balanceGate(sql: SqlStorage, owner: string, windowSeconds: number): BalanceGate {
  ensureTables(sql);
  const now = nowSeconds();
  sql.exec("DELETE FROM gback_read WHERE at <= ?", now - BALANCE_KEEP_SECONDS);
  const row = sql.exec<{ at: number; balance: string | null }>("SELECT at, balance FROM gback_read WHERE owner = ?", owner).toArray()[0];
  if (row && now - row.at < windowSeconds) return { read: false, last: row.balance, age: now - row.at };
  sql.exec(
    "INSERT INTO gback_read (owner, at, balance) VALUES (?, ?, NULL) ON CONFLICT(owner) DO UPDATE SET at = excluded.at",
    owner,
    now,
  );
  return { read: true, last: row?.balance ?? null, age: 0 };
}

/** Stores what a granted read returned. */
export function balanceStore(sql: SqlStorage, owner: string, balance: string): void {
  ensureTables(sql);
  sql.exec("UPDATE gback_read SET balance = ? WHERE owner = ?", balance, owner);
}
