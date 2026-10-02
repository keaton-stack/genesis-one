// P2A: Genesis One asset cache (registered by plan_stream.js on a deployed build, or with ?sw=1).
// A content-hashed URL (?v=<10 hex>, window.AV / asset_v.js, HANDOFF_P1A) names exactly one version of a file, so it is served
// cache first from Cache Storage, which outlives the HTTP cache's eviction (and is kept when the browser grants persistent
// storage). The page, the scripts and asset_v.js are network first: never served stale while the network answers.
// Updates: a deploy changes only the hashes of the files whose bytes changed; the page posts its manifest once the world has
// streamed and every cached entry whose hash is no longer current is dropped. A new sw.js activates at once.
const ASSETS = "g1-assets-v1", PAGES = "g1-pages-v2";   // v2: path-keyed pages (activate drops v1 with its piled-up /?b= copies)
const HASHED = /[?&]v=[0-9a-f]{10}(?:&|$)/;
const FRESH = /(?:^\/$|\.html$|\/(?:client|asset_v|sw|plan_[a-z0-9_]+|arcade_[a-z_]+)\.js$)/;

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (ev) => {
  ev.waitUntil((async () => { const keys = await caches.keys(); await Promise.all(keys.filter((k) => /^g1-/.test(k) && k !== ASSETS && k !== PAGES).map((k) => caches.delete(k))); await self.clients.claim(); })());
});

// the offline copy is keyed by path alone (R5): the build check fetches /?b=<time> every few minutes, and keying by the full URL
// stored a new copy of the page each time, never pruned
async function networkFirst(req) {
  const u = new URL(req.url), key = u.origin + u.pathname;
  try { const res = await fetch(req); if (res && res.ok && res.type === "basic") { const c = await caches.open(PAGES); c.put(key, res.clone()).catch(() => {}); } return res; }
  catch (e) { const c = await caches.open(PAGES); const hit = (await c.match(key)) || (await c.match(req)); if (hit) return hit; throw e; }
}
async function cacheFirst(ev, req) {
  const c = await caches.open(ASSETS); const hit = await c.match(req); if (hit) return hit;
  const res = await fetch(req);
  if (res && res.status === 200 && res.type === "basic") ev.waitUntil(c.put(req, res.clone()).catch(() => {}));
  return res;
}
self.addEventListener("fetch", (ev) => {
  const req = ev.request; if (req.method !== "GET" || req.headers.has("range")) return;
  let url; try { url = new URL(req.url); } catch (e) { return; } if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate" || FRESH.test(url.pathname)) { ev.respondWith(networkFirst(req)); return; }
  if (HASHED.test(url.search)) ev.respondWith(cacheFirst(ev, req));
});

// the page's manifest (path -> hash): drop cached versions that are no longer current
self.addEventListener("message", (ev) => {
  const d = ev.data || {}; if (d.t !== "prune" || !d.keep || typeof d.keep !== "object") return;
  ev.waitUntil((async () => { const c = await caches.open(ASSETS); const keys = await c.keys(); let n = 0;
    for (const r of keys) { const u = new URL(r.url), v = u.searchParams.get("v"), want = d.keep[u.pathname]; if (want !== v) { await c.delete(r); n++; } }
    if (ev.source && ev.source.postMessage) ev.source.postMessage({ t: "pruned", n, kept: keys.length - n }); })());
});
