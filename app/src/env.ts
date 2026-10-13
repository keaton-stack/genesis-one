/**
 * The bindings the platform injects at deploy.
 *
 * These are NOT declared by this repo's `wrangler.jsonc` in production — the
 * deploy generates an authoritative config from `app.manifest.json` plus the app
 * row and ignores the committed one. Keep this interface in step with the
 * manifest: turning on `db` / `r2` / `kv` there adds `DB` / `STORAGE` / `KV`
 * here.
 */
import type { Room } from "./room";

export interface Env {
  /** Static client files (dist/client), served asset-first. */
  ASSETS: Fetcher;
  /** One Durable Object instance per room — `app.manifest.json` → durableObject. */
  ROOMS: DurableObjectNamespace<Room>;
  /** "dev" | "prod" — the CODE's environment label. Storage is shared, not split. */
  HF_ENV?: string;
  /** This app's subdomain label. */
  APP_SLUG?: string;
  /** Signs sign-in nonces, session tokens and player ids. Secret, set on the platform, never committed.
   *  Changing it signs everyone out AND changes every player id (see src/auth.ts). */
  SIWS_JWT_SECRET?: string;
  /** The host the sign-in message names ("genesis.example", "localhost:8787"). Never taken from the Host header. */
  APP_DOMAIN?: string;
  /** Solana RPC URL including the API key (Helius, QuickNode, …). Secret, never sent to the browser.
   *  Unset: no balance (`/api/gback/balance` answers 503). The public mainnet endpoint blocks Workers. */
  SOLANA_RPC_URL?: string;
}
