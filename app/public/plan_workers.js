// R21 WK (HANDOFF_R21_WORKERS.md): model loading off the main thread (window.PLAN_WORKERS). Loaded before plan_stream.js and client.js.
//
// Before: every .glb was fetched on the main thread, then three's GLTFLoader copied it on the main thread several times over (the
// binary chunk, every buffer view, a Blob and a second fetch of every KTX2 image, the source of every meshopt decode): about four
// garbage copies of the 740 MB the stream brings in, which took the JS heap to 3.6 to 3.9 GB of its 4.2 GB limit.
// Now a small pool of module workers (workers/glb_worker.js, 1 to 4 by hardwareConcurrency) fetches each file, reads its JSON,
// decodes its meshopt views and cuts out every buffer view the parser will read, and hands them over as transferables. The main
// thread runs the same GLTFLoader.parse on the pre-read JSON, with a plugin that answers every buffer view from those buffers
// (no copy), and the KTX2 images go straight to KTX2Loader's transcoder workers (no Blob, no object URL, no second fetch).
// The result is the same glTF: same scene, meshes, materials, textures, skins and animations.
//
// Switches: ?wk=1 (R21 WK on; off by default), ?wkglb=1 (with ?wk=1: the worker path), ?wkclone=0 (geometry cloned as before),
// ?wktrim=0 (KTX2 levels cut in the worker), ?wkcancel=0 (far downloads cut off), ?wkswap=0 (swap slices); ?wkn=<n>, ?wkktx=<n>,
// ?wkktxp=<n> (worker counts). Runtime: PLAN_WORKERS.set(false) turns the worker path off for the loads that follow.
// Counters: PLAN_WORKERS.n; errors: PLAN_WORKERS.errs. A file the worker cannot take (another extension, an external buffer) or a
// worker that fails comes back raw or falls back to the main-thread path of before.
(function () {
  "use strict";
  var Q = location.search, hc = navigator.hardwareConcurrency || 4;
  var on = /[?&]wk=1\b/.test(Q);   // R21 WK: off by default (conservative: the frozen-code walk A/B is not conclusive, section 4); ?wk=1 on
  var W = window.PLAN_WORKERS = {
    // the worker pool itself is OFF by default (?wkglb=1): it cuts the heap peak and the hold, but frozen-code A/B walks were slower
    // with it (HANDOFF_R21_WORKERS.md section 4); ?wk=1 alone gives the rest (geometry in place, stream ordering)
    on: on, glbOn: on && /[?&]wkglb=1\b/.test(Q) && typeof Worker === "function",
    nW: Math.max(1, Math.min(4, +((Q.match(/[?&]wkn=(\d+)/) || [])[1]) || Math.floor(hc / 4))),
    n: { req: 0, done: 0, raw: 0, fail: 0, aborted: 0, fallback: 0, bytes: 0, views: 0, viewMB: 0, ktxDirect: 0, ktxMB: 0, ktxMs: 0, ktxMax: 0, trim: 0, trimLv: 0, trimMB: 0, trimTxMB: 0, trimOrm: 0, fetchMs: 0, workMs: 0, parse: 0, queuedMax: 0 },
    errs: [], pool: [], ready: false, dead: false
  };
  // KTX2Loader's transcoder workers: three's 4 unless ?wkktx=<n> (behind the loading screen) and ?wkktxp=<n> (in play) say otherwise.
  // More transcoders did not shorten the hold measurably, and every one keeps its own wasm heap alive in the renderer process.
  W.ktxN = Math.max(1, Math.min(8, +((Q.match(/[?&]wkktx=(\d+)/) || [])[1]) || 4));
  W.ktxPlay = Math.max(1, Math.min(8, +((Q.match(/[?&]wkktxp=(\d+)/) || [])[1]) || W.ktxN));
  if (on && W.ktxPlay !== W.ktxN) { var offN = 0, lim = 0; setInterval(function () { var L = document.getElementById("load"), off = !L || L.classList.contains("off"); offN = off ? offN + 1 : 0; var want = offN >= 2 ? W.ktxPlay : W.ktxN;
    if (want !== lim) { try { var k = typeof KTX2 !== "undefined" && KTX2 ? KTX2 : null;   /* client.js's loader once it exists (never ktx2Loader(): before the renderer exists it would turn KTX2 off for good) */ if (k && k.setWorkerLimit) { k.setWorkerLimit(want); lim = want; W.n.ktxLim = want; } } catch (e) {} } }, 1000); }
  function note(w, e) { try { W.errs.push(w + ": " + (e && e.message || e)); if (W.errs.length > 40) W.errs.shift(); console.warn("plan_workers " + w, e); } catch (x) {} }
  // KTX2 levels over R6's caps cut in the worker before the transcode (glb_worker.js ktxTrim)
  W.trimOn = W.glbOn && !/[?&]wktrim=0\b/.test(Q);   // needs the worker pool
  W.ktxDirect = !/[?&]wkktxd=0\b/.test(Q);   // KTX2 images straight to the transcoder (?wkktxd=0: three's Blob path)
  W.jtxt = /[?&]wkjtxt=1\b/.test(Q); W.copyBufs = /[?&]wkcopy=1\b/.test(Q);   // test switches (worker JSON as text; buffers copied on arrival)
  W.set = function (v) { W.glbOn = !!v && !W.dead && typeof Worker === "function"; return W.glbOn; };
  W.ok = function () { return W.glbOn && !W.dead; };   // the pool starts on the first job and stops when idle (see idle())
  var AV = function (u) { return (window.AV || String)(u); };

  // ───────────────────────── the pool ─────────────────────────
  var ID = 1, JOBS = {}, PEND = [], PER = 6;   // PER: jobs in flight per worker (fetches are network bound; the rest queues by priority)
  // a pool idle for 12 s is stopped (each worker's heap still holds the garbage of the files it read until its own collection, which an
  // idle worker never runs); the next job starts a new one (about 50 ms)
  var IDLE = null, lastJob = 0;
  function idle() { if (IDLE) return; IDLE = setInterval(function () { if (!W.pool.length) { clearInterval(IDLE); IDLE = null; return; } var busy = PEND.length > 0; for (var id in JOBS) { busy = true; break; } if (busy || performance.now() - lastJob < 12000) return;
    W.pool.forEach(function (S) { try { S.w.terminate(); } catch (e) {} }); W.pool = []; W.ready = false; W.n.stops = (W.n.stops || 0) + 1; clearInterval(IDLE); IDLE = null; }, 3000); }
  function start() {
    if (!W.glbOn || W.dead || W.pool.length) return; W.n.starts = (W.n.starts || 0) + 1; idle();
    var url = AV("/workers/glb_worker.js?v=" + (window.BUILD || 0)), mo = new URL(AV("/lib/meshopt_decoder.module.js?v=" + (window.BUILD || 0)), location.href).href;
    for (var i = 0; i < W.nW; i++) {
      try { var w = new Worker(url, { type: "module", name: "glb" + i }); var S = { w: w, busy: 0, ok: false, i: i };
        w.onmessage = onMsg.bind(null, S); w.onerror = onErr.bind(null, S); w.postMessage({ op: "init", meshopt: mo }); W.pool.push(S);
      } catch (e) { note("worker", e); }
    }
    if (!W.pool.length) { W.dead = true; return; }
    // a worker that does not answer its init within 6 s (module workers unsupported, file missing): the pool is off
    var P0 = W.pool; setTimeout(function () { if (W.pool === P0 && !P0.some(function (s) { return s.ok; })) { W.dead = true; note("pool", "no worker answered"); flushFail(); } }, 6000);
  }
  function onErr(S, e) { note("worker " + S.i, e && e.message || "error"); S.dead = true; if (W.pool.every(function (s) { return s.dead; })) { W.dead = true; flushFail(); } else for (var id in JOBS) if (JOBS[id].S === S) { var J = JOBS[id]; delete JOBS[id]; S.busy--; J.rej(fallbackErr("worker died")); } pump(); }
  function fallbackErr(m) { var e = new Error(m); e.wkFallback = true; return e; }
  function flushFail() { for (var id in JOBS) { var J = JOBS[id]; delete JOBS[id]; J.rej(fallbackErr("pool off")); } PEND.splice(0).forEach(function (J) { J.rej(fallbackErr("pool off")); }); }
  function onMsg(S, e) {
    var m = e.data || {}; if (m.init) { S.ok = true; W.ready = true; pump(); return; }
    var J = JOBS[m.id]; if (!J) return; delete JOBS[m.id]; S.busy--; lastJob = performance.now(); pump();
    if (J.sig && J.onAbort) try { J.sig.removeEventListener("abort", J.onAbort); } catch (x) {}
    if (!m.ok) { if (m.abort || J.aborted) { W.n.aborted++; var ae = new Error("aborted"); ae.name = "AbortError"; J.rej(ae); return; } W.n.fail++; J.rej(new Error(m.err || "worker failed")); return; }
    W.n.done++; W.n.bytes += m.bytes || 0; if (m.ms) { W.n.fetchMs += m.ms[0]; W.n.workMs += m.ms[1]; }
    if (m.raw) { W.n.raw++; if (m.err) note("worker parse " + J.url.split("/").pop(), m.err); J.res({ wkRaw: true, raw: m.raw, bytes: m.bytes }); return; }
    if (m.jtxt) m.json = JSON.parse(m.jtxt);   // ?wkjtxt=1: the JSON comes as text and is parsed here (test switch)
    if (W.copyBufs) for (var kc in m.bvs) m.bvs[kc] = m.bvs[kc].slice(0);   // ?wkcopy=1: main-thread copies of the buffers (test switch)
    var nv = 0, b = 0; for (var k in m.bvs) { nv++; b += m.bvs[k].byteLength; } W.n.views += nv; W.n.viewMB += b / 1048576;
    if (m.json && m.json.wkTrim) for (var ti in m.json.wkTrim) { var tr = m.json.wkTrim[ti]; W.n.trim++; W.n.trimLv += tr[0]; W.n.trimMB += tr[1] / 1048576; W.n.trimTxMB += tr[2] / 1048576; if (tr[3]) W.n.trimOrm++; }
    J.res({ wkPre: true, json: m.json, bvs: m.bvs, bytes: m.bytes, url: J.url });
  }
  function pump() {
    while (PEND.length) { var best = null; for (var i = 0; i < W.pool.length; i++) { var s = W.pool[i]; if (s.dead || !s.ok || s.busy >= PER) continue; if (!best || s.busy < best.busy) best = s; } if (!best) return;
      var J = PEND.shift(); if (J.aborted) continue; J.S = best; best.busy++; JOBS[J.id] = J;
      var msg = { op: "glb", id: J.id, url: J.url, buf: J.buf, ktx: J.ktx, split: J.split, jtxt: W.jtxt, caps: W.trimOn && window.R6MEM && R6MEM.on ? { ktx: R6MEM.ktxCap, orm: R6MEM.ormCap } : null }; best.w.postMessage(msg, J.buf ? [J.buf] : []); J.buf = null; }
  }
  // fetch (or take the bytes of) one .glb and pre-read it in a worker. o: { ktx: the parser has a KTX2 loader, signal, pri (lower first), buf }
  W.glb = function (url, o) {
    o = o || {}; start(); if (!W.ok()) return Promise.reject(fallbackErr("pool off"));
    return new Promise(function (res, rej) {
      var J = { id: ID++, url: new URL(url, location.href).href, buf: o.buf || null, ktx: !!o.ktx, split: o.split !== undefined ? !!o.split : W.cloneOff, pri: o.pri || 0, res: res, rej: rej, sig: o.signal || null, t: performance.now() };
      if (J.sig) { if (J.sig.aborted) { var ae = new Error("aborted"); ae.name = "AbortError"; return rej(ae); }
        J.onAbort = function () { J.aborted = true; var i = PEND.indexOf(J); if (i >= 0) { PEND.splice(i, 1); W.n.aborted++; var ae2 = new Error("aborted"); ae2.name = "AbortError"; rej(ae2); return; } if (J.S && JOBS[J.id]) try { J.S.w.postMessage({ op: "abort", id: J.id }); } catch (x) {} };
        J.sig.addEventListener("abort", J.onAbort); }
      W.n.req++; lastJob = performance.now(); var at = PEND.length; while (at > 0 && PEND[at - 1].pri > J.pri) at--; PEND.splice(at, 0, J); if (PEND.length > W.n.queuedMax) W.n.queuedMax = PEND.length;
      // until the pool has answered its init, jobs wait in the queue
      if (W.ready) pump(); else { var t0 = performance.now(), iv = setInterval(function () { if (W.ready || W.dead || performance.now() - t0 > 7000) { clearInterval(iv); if (W.ready) pump(); else { var i = PEND.indexOf(J); if (i >= 0) PEND.splice(i, 1); rej(fallbackErr("pool not ready")); } } }, 50); }
    });
  };

  // ───────────────────────── the parse on the main thread ─────────────────────────
  function plugin(pre) {
    return function (parser) {
      var json = parser.json, lis = parser.loadImageSource;
      // KTX2 images: the worker's buffer goes straight to the transcoder (KTX2Loader.load would wrap it in a Blob, make an object URL
      // and fetch it back as another ArrayBuffer). Same texture, same R6 hooks (_createTextureFrom), same userData.
      if (W.ktxDirect) parser.loadImageSource = function (src, loader) {
        var sd = json.images && json.images[src];
        if (!sd || sd.bufferView === undefined || !loader || typeof loader._createTexture !== "function" || !loader.workerConfig || !pre.bvs[sd.bufferView] || this.sourceCache[src] !== undefined || (sd.mimeType && sd.mimeType !== "image/ktx2")) return lis.apply(this, arguments);
        var t0 = 0, p = this.getDependency("bufferView", sd.bufferView).then(function (buf) { W.n.ktxDirect++; W.n.ktxMB += buf.byteLength / 1048576; t0 = performance.now(); return loader._createTexture(buf); }).then(function (t) { var d = performance.now() - t0; W.n.ktxMs += d; if (d > W.n.ktxMax) W.n.ktxMax = d;
          if (sd.extras !== undefined && typeof sd.extras === "object") Object.assign(t.userData, sd.extras); t.userData.mimeType = sd.mimeType || "image/ktx2"; return t;
        }).catch(function (e) { console.error("THREE.GLTFLoader: Couldn't load texture", sd.name || src); throw e; });
        this.sourceCache[src] = p; return p;
      };
      return { name: "WK_pre", loadBufferView: function (i) { var b = pre.bvs[i]; return b ? Promise.resolve(b) : null; } };
    };
  }
  W.parse = function (loader, parse0, pre, path, onLoad, onError) {
    W.n.parse++; var cb = plugin(pre), L = loader.pluginCallbacks; L.unshift(cb);
    try { parse0.call(loader, pre.json, path, onLoad, onError); } finally { var i = L.indexOf(cb); if (i >= 0) L.splice(i, 1); }   // the plugins are made inside parse(), synchronously
  };
  function isGlb(u) { return typeof u === "string" && /^[^?#]*\.glb(?:[?#]|$)/i.test(u) && !/^(blob|data):/i.test(u) && (!/^https?:/i.test(u) || u.indexOf(location.origin + "/") === 0); }
  // every loader from client.js's gltfLoader(): .load of a .glb goes through the pool, .parse takes the pool's results
  W.wrap = function (l) {
    if (!l || l.__wk) return l; l.__wk = true; var load0 = l.load, parse0 = l.parse;
    l.parse = function (data, path, onLoad, onError) {
      if (data && data.wkPre) return W.parse(this, parse0, data, path, onLoad, onError);
      if (data && data.wkRaw) return parse0.call(this, data.raw, path, onLoad, onError);
      return parse0.apply(this, arguments);
    };
    l.load = function (url, onLoad, onProgress, onError) {
      if (!W.ok() || !isGlb((this.path || "") + url)) return load0.apply(this, arguments);
      var scope = this, LU = THREE.LoaderUtils, rp;
      if (this.resourcePath !== "") rp = this.resourcePath; else if (this.path !== "") rp = LU.resolveURL(LU.extractUrlBase(url), this.path); else rp = LU.extractUrlBase(url);
      var full = this.manager.resolveURL((this.path || "") + url); this.manager.itemStart(url);
      var fail = function (e) { if (onError) onError(e); else console.error(e); scope.manager.itemError(url); scope.manager.itemEnd(url); };
      W.glb(full, { ktx: !!this.ktx2Loader, pri: this.wkPri || 0 }).then(function (pre) {
        try { scope.parse(pre, rp, function (g) { if (onLoad) onLoad(g); scope.manager.itemEnd(url); }, fail); } catch (e) { fail(e); }
      }, function (e) { if (e && e.wkFallback) { W.n.fallback++; scope.manager.itemEnd(url); return load0.call(scope, url, onLoad, onProgress, onError); } fail(e); });
    };
    return l;
  };
  // ───────────────────────── geometry taken as is (no clone) ─────────────────────────
  // client.js loadOne and plan_stream's proxies cloned every geometry of a fresh glTF before moving it into the model frame (a copy
  // of every vertex and index array, the original left as garbage). A geometry can be moved in place instead when nothing else can
  // see it: used by one mesh only, no attribute, interleaved buffer, index or morph attribute shared with another geometry, and
  // every plain array owning its whole buffer (so R6 can still drop it after upload). Anything else is cloned as before.
  // ?wkclone=0: always clone.
  W.cloneOff = on && !/[?&]wkclone=0\b/.test(Q);
  W.ownGeos = function (root) {
    var out = new Set(); if (!W.cloneOff || !root) return out; var use = new Map(), arr = new Map(), geos = [];
    var see = function (x) { if (x) arr.set(x, (arr.get(x) || 0) + 1); };
    var parts = function (g) { var L = []; for (var k in g.attributes) L.push(g.attributes[k]); if (g.index) L.push(g.index); for (var m in g.morphAttributes) (g.morphAttributes[m] || []).forEach(function (a) { L.push(a); }); return L; };
    root.traverse(function (o) { if (!o.isMesh || !o.geometry) return; var g = o.geometry; if (!use.has(g)) { geos.push(g); use.set(g, 0); parts(g).forEach(function (a) { see(a); if (a.isInterleavedBufferAttribute) see(a.data); }); } use.set(g, use.get(g) + 1); });
    var seenIB = new Map(); geos.forEach(function (g) { parts(g).forEach(function (a) { if (a.isInterleavedBufferAttribute) { var s = seenIB.get(a.data); if (!s) seenIB.set(a.data, s = new Set()); s.add(g); } }); });
    for (var i = 0; i < geos.length; i++) { var g = geos[i], ok = use.get(g) === 1;
      if (ok) parts(g).forEach(function (a) { if (!ok) return; if (arr.get(a) > 1) { ok = false; return; }
        if (a.isInterleavedBufferAttribute) { if (seenIB.get(a.data).size > 1) ok = false; return; }   // one geometry's interleaved attributes share their buffer: fine
        var A = a.array; if (!A || !A.buffer || A.byteOffset !== 0 || A.byteLength !== A.buffer.byteLength) ok = false; });
      if (ok) out.add(g); }
    W.n.own = (W.n.own || 0) + out.size; W.n.cloned = (W.n.cloned || 0) + geos.length - out.size; return out;
  };
  W.geo = function (own, g) { return own && own.has(g) ? g : g.clone(); };

  // ───────────────────────── R21 WK-IB: picture textures decoded off the main thread before their first upload ─────────────────────────
  // An <img> texture's first texImage2D decodes, flips and converts the picture on the main thread (a 2048 px JPEG: 25 to 37 ms,
  // with or without img.decode(), measured); an ImageBitmap made by createImageBitmap from the file's bytes is decoded on a worker
  // thread with the same flip, alpha and colour handling baked in (WebGL ignores the unpack flags for an ImageBitmap) and uploads in
  // 5 to 7 ms. PLAN_WORKERS.bitmap(t) returns true when t is ready to upload (an ImageBitmap texture, or nothing to do), false while
  // its bitmap is being made. The bitmap goes on a new Source shared by every texture of the same picture and settings (one GPU copy
  // as before); the texture's flipY becomes false because the flip is in the bitmap. Independent of ?wk; on by default, ?wkib=0: off.
  W.ibOn = !/[?&]wkib=0\b/.test(Q) && typeof createImageBitmap === "function";   // on by default; ?wkib=0: the <img> upload as before
  var IBC = new WeakMap(); W.n.ib = 0; W.n.ibFail = 0; W.n.ibMs = 0; W.n.ibImg = 0; W.n.ibErr = [];
  W.bitmap = function (t) {
    if (!W.ibOn || !t || !t.isTexture || t.isCompressedTexture || t.isDataTexture || t.isRenderTargetTexture || t.isVideoTexture || t.isCubeTexture || t.isCanvasTexture) return true;
    var im = t.image; if (!im || typeof HTMLImageElement === "undefined" || !(im instanceof HTMLImageElement) || !im.src || !im.complete || !im.naturalWidth) return true;
    var src = t.source, key = (t.flipY ? "f" : "n") + (t.premultiplyAlpha ? "p" : "s") + (t.colorSpace === THREE.NoColorSpace || !t.colorSpace ? "0" : "c"), M = IBC.get(src);
    if (!M) { M = {}; IBC.set(src, M); } var e = M[key];
    if (!e) { e = M[key] = { st: 0, s: null }; var t0 = performance.now(), url = im.currentSrc || im.src;
      var opts = { imageOrientation: key[0] === "f" ? "flipY" : "none", premultiplyAlpha: key[1] === "p" ? "premultiply" : "none", colorSpaceConversion: key[2] === "0" ? "none" : "default" };
      var done = function (bm) { if (bm.width !== im.naturalWidth || bm.height !== im.naturalHeight) { try { bm.close(); } catch (x) {} throw new Error("size " + bm.width + "x" + bm.height); } e.s = new THREE.Source(bm); e.st = 2; W.n.ib++; W.n.ibMs += performance.now() - t0; };
      var fail = function (er) { e.st = 3; W.n.ibFail++; if (W.n.ibErr.length < 8) W.n.ibErr.push(String(er && er.message || er).slice(0, 60) + " " + String(url).split("/").pop().slice(0, 40)); };
      // the file's bytes (decoded on a worker thread); a picture whose URL cannot be fetched again (a revoked blob: URL) is made from the <img> itself
      var fromImg = function () { W.n.ibImg++; return createImageBitmap(im, opts).then(done); };
      (/^blob:/i.test(url) ? fromImg() : fetch(url, { credentials: "same-origin" }).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.blob(); })
        .then(function (b) { return createImageBitmap(b, opts); }).then(done).catch(fromImg)).catch(fail); e.st = 1; }
    if (e.st === 1) return false; if (e.st !== 2) return true;   // failed: the <img> uploads as before
    if (t.source !== e.s) { t.source = e.s; t.flipY = false; t.needsUpdate = true; }
    return true;
  };

  if (W.glbOn) start();
})();
