/**
 * Produce the two things the deploy consumes:
 *
 *   dist/worker/index.js  — the bundled Worker (entry + room + logic)
 *   dist/client/**        — the static files, served before the Worker runs
 *
 * The deploy discovers the entry itself and rewrites `wrangler.jsonc` from
 * trusted metadata, so these PATHS are the contract — not this repo's config.
 * `cloudflare:workers` stays external: it is a runtime module, not a package.
 */

import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(app, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const result = await Bun.build({
  entrypoints: [resolve(app, "src/worker.ts")],
  outdir: resolve(dist, "worker"),
  naming: "index.js",
  target: "browser",
  format: "esm",
  // Keep the runtime module unresolved; bundling it would break the DO class.
  external: ["cloudflare:workers"],
  // Readable stack traces in Workers Logs are worth more than a few saved KB for
  // a game this size.
  minify: false,
  sourcemap: "none",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("worker bundle failed");
}

await cp(resolve(app, "public"), resolve(dist, "client"), { recursive: true });
// stamp the build so browsers never serve a stale client or stale models after a deploy
{ const stamp = Date.now().toString(36); const idx = resolve(dist, "client/index.html"); let html = await Bun.file(idx).text(); html = html.replace('window.BUILD = "dev";', `window.BUILD = "${stamp}";`).replace("/client.js?v=dev", `/client.js?v=${stamp}`).replace("/arcade_games.js?v=dev", `/arcade_games.js?v=${stamp}`); await Bun.write(idx, html); console.log("build stamp", stamp); }

console.log("built dist/worker/index.js + dist/client/");
