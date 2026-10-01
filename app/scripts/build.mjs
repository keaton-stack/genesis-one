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
import { stampAssets } from "./asset_versions.mjs";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// BUILD_OUT: build into another folder (a test build while wrangler dev holds dist/)
const dist = process.env.BUILD_OUT ? resolve(process.env.BUILD_OUT) : resolve(app, "dist");

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
// stamp the build: window.BUILD (client.js notices a new deploy) and a content hash per file (scripts/asset_versions.mjs),
// so a deploy only makes browsers fetch the files whose bytes changed
{ const stamp = Date.now().toString(36); const r = await stampAssets(resolve(dist, "client"), stamp); console.log("build stamp", stamp, "asset versions", r.files, "files,", (r.bytes / 1e6).toFixed(1), "MB hashed,", r.hashed, "index.html refs, manifest", r.manifestBytes, "bytes"); }

console.log("built dist/worker/index.js + dist/client/");
