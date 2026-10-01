/**
 * Content-addressed asset versions for dist/client (called by build.mjs after the copy).
 *
 * Every static file gets a short hash of its own bytes. The map (path -> hash) ships as /asset_v.js, which sets
 * window.ASSET_V; index.html's inline AV() helper and THREE.DefaultLoadingManager's URL modifier put that hash in the
 * ?v= of every model, LOD, texture and KTX2 request. An unchanged file therefore keeps the same URL from one deploy
 * to the next and the browser reuses its cache; only files whose bytes changed are fetched again.
 *
 * index.html: window.BUILD gets the build stamp (client.js checkBuild still notices a new deploy), the /asset_v.js tag
 * goes in front of it, every local src/href that names a known file carries that file's hash, and any ?v=dev left over
 * (a file not in the map) falls back to the build stamp.
 *
 * _headers (Cloudflare static assets): the model packs are only ever requested through the hashed loader path, so they
 * are cached for a year as immutable; textures for a day (a few are drawn through a plain <img>); the rest keeps the
 * platform default (revalidate with the ETag). Dev (wrangler dev on app/public) has no _headers and no map: ?v=dev.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SKIP = new Set(["index.html", "_headers", "_redirects", "asset_v.js"]);

async function list(dir, rel = "") {
  const out = [];
  for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) out.push(...(await list(dir, r)));
    else if (e.isFile() && !SKIP.has(r)) out.push(r);
  }
  return out;
}

export const HEADERS = `# written by scripts/asset_versions.mjs: every request for these goes through the content-hashed ?v= (window.ASSET_V)
/models/*
  Cache-Control: public, max-age=31536000, immutable
/models_m/*
  Cache-Control: public, max-age=31536000, immutable
/tex/*
  Cache-Control: public, max-age=86400
/tex_m/*
  Cache-Control: public, max-age=86400
/asset_v.js
  Cache-Control: public, max-age=31536000, immutable
`;

export async function stampAssets(client, stamp) {
  const files = await list(client);
  const V = {};
  let bytes = 0;
  for (const rel of files) {
    const buf = await readFile(join(client, rel));
    bytes += buf.length;
    V["/" + rel] = createHash("sha1").update(buf).digest("hex").slice(0, 10);
  }
  const js = `window.ASSET_V=${JSON.stringify(V)};\n`;
  const mh = createHash("sha1").update(js).digest("hex").slice(0, 10);
  await writeFile(join(client, "asset_v.js"), js);
  await writeFile(join(client, "_headers"), HEADERS);

  const idx = join(client, "index.html");
  let html = await readFile(idx, "utf8");
  const tag = '<script>window.BUILD = "dev";</script>';
  if (!html.includes(tag)) throw new Error("index.html: window.BUILD tag not found");
  html = html.replace(tag, `<script src="/asset_v.js?v=${mh}"></script>\n    <script>window.BUILD = "${stamp}";</script>`);
  let hashed = 0;
  html = html.replace(/(\s(?:src|href)=")(\/[^"?#]+)(?:\?v=dev)?"/g, (all, a, p) => {
    if (p === "/asset_v.js" || !V[p]) return all;
    hashed++;
    return `${a}${p}?v=${V[p]}"`;
  });
  html = html.replace(/\?v=dev\b/g, `?v=${stamp}`);
  await writeFile(idx, html);
  return { files: files.length, bytes, hashed, manifestBytes: js.length, mh };
}
