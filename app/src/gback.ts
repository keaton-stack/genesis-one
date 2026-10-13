/**
 * The real, on-chain $GBACK amount of a wallet. Token amount only: no price, no fiat value.
 *
 * Read through our own Worker so the RPC key (`SOLANA_RPC_URL`) never reaches the browser. Every read is a call on
 * that key, so `handleBalance` (src/auth-routes.ts) allows one per wallet per `BALANCE_READ_SECONDS` and answers
 * with the stored amount in between (src/auth-store.ts `balanceGate`): reloads, tabs and the refresh icon included.
 */

export const GBACK_MINT = "Fh7mLxtPAysdvHcMcJ37A3vc6WvBVh7JVDwxmwk6pump";
export const GBACK_DECIMALS = 6;

// No keyless fallback: the public mainnet endpoint answers 403 "Your IP or provider is blocked" to every Worker request
// (the runtime adds a CF-Worker header, local wrangler dev too), and the other free endpoints want a key as well.
const RPC_TIMEOUT_MS = 5000;
export const BALANCE_READ_SECONDS = 30;

export interface GbackEnv {
  /** Full RPC URL including the API key. Secret. Without it there is no balance (handleBalance answers 503). */
  SOLANA_RPC_URL?: string;
}

export interface GbackBalance {
  /** Base units as a decimal string (u64 does not fit a JS number exactly). */
  raw: string;
  decimals: number;
  /** For display only. */
  ui: number;
  slot: number;
}

/** Sums every token account of the mint: a wallet can hold more than one. No account means 0. */
export function parseBalance(rpc: unknown): GbackBalance {
  const r = rpc as { error?: { message?: string }; result?: { context?: { slot?: number }; value?: unknown[] } };
  if (r?.error) throw new Error(`rpc error: ${r.error.message ?? "unknown"}`);
  const value = r?.result?.value;
  if (!Array.isArray(value)) throw new Error("rpc returned no value");
  let raw = 0n;
  for (const acc of value) {
    const amount = (acc as any)?.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (typeof amount !== "string" || !/^\d+$/.test(amount)) throw new Error("unexpected token account shape");
    raw += BigInt(amount);
  }
  const whole = raw / 10n ** BigInt(GBACK_DECIMALS);
  const frac = raw % 10n ** BigInt(GBACK_DECIMALS);
  return {
    raw: raw.toString(),
    decimals: GBACK_DECIMALS,
    ui: Number(whole) + Number(frac) / 10 ** GBACK_DECIMALS,
    slot: r.result?.context?.slot ?? 0,
  };
}

/** `fetcher` is injectable for tests; the Worker passes the global fetch. Throws when the RPC fails. */
export async function fetchGbackBalance(env: GbackEnv, owner: string, fetcher: typeof fetch = fetch): Promise<GbackBalance> {
  if (!env.SOLANA_RPC_URL) throw new Error("SOLANA_RPC_URL is not set");
  const res = await fetcher(env.SOLANA_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [owner, { mint: GBACK_MINT }, { encoding: "jsonParsed", commitment: "confirmed" }],
    }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`rpc http ${res.status}`);
  return parseBalance(await res.json());
}
