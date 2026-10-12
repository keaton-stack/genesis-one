import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Tests run in workerd — the real runtime — not a mock. That matters here: the
 * room's correctness lives in WebSocket hibernation, `ctx.storage` and Durable
 * Object addressing, none of which a fake reproduces faithfully.
 *
 * Bindings come from `wrangler.jsonc`, so the tests exercise the same DO class
 * and migration the local dev server does.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Test-only sign-in config; the real values are secrets on the platform and in .dev.vars.
      // SOLANA_RPC_URL is a .invalid host (RFC 2606: never resolves), so no test ever reaches a real RPC, and it fails
      // at once (a closed localhost port takes about 2 s on Windows).
      miniflare: {
        bindings: { SIWS_JWT_SECRET: "test-secret-0123456789abcdef0123456789", APP_DOMAIN: "game.test", SOLANA_RPC_URL: "http://rpc.invalid/" },
      },
    }),
  ],
});
