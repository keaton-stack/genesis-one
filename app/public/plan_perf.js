// plan_perf.js: the performance pass (P1B, 30 Sep 2026). Classic script, loaded after the other plan_*.js and before client.js.
// window.PLAN_PERF:
//   - a frame clock and a toggleable overlay (F3, or ?perf=1): fps, frame-time graph, worst frame of the last 10 s, draw calls,
//     triangles, geometries, textures, programs, JS heap, load time;
//   - an anonymous session summary (avg fps, p95 frame time, long frames, load time, tier, GPU string), kept in localStorage
//     ("g1:perf", the last 10 sessions) and sent to window.PERF_ENDPOINT with sendBeacon when a deployment defines one;
//   - shader pre-compilation behind the loading screen: the whole scene plus a hidden sample of every interior (the hangar,
//     clubhouse, restaurant and hangar-home interiors, the FBO terminal and the other client rooms), with and without fog;
//   - an idle-time GPU warm-up queue (programs with compileAsync, textures with initTexture, geometry buffers with a 4 px render)
//     for interiors built ahead of the player and for lazily loaded model kinds;
//   - the per-frame budget the interior modules use for their staged (generator) builds: PLAN_PERF.step(iterator);
//   - indoor portal culling: inside the FBO, a hangar, the GBANK hall or a walk-in interior, outside objects and instances that
//     cannot be seen through the room's openings are not drawn (nor cast shadows), and the shadow map updates less often;
//   - two fixes for whole-scene shader recompiles: a spare hemisphere light keeps the light count constant when a room or the
//     fly-in cabin adds its fill light, and the key light keeps its shadow flag through the sun/moon hand-over.
// ?perf=0 turns the module off; ?pcull=0, ?pwarm=0, ?ppre=0, ?pfix=0 switch single parts off (A/B tests).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var Q = location.search;
  var P = window.PLAN_PERF = window.PLAN_PERF || {};
  P.errs = P.errs || []; P.n = P.n || {};
  P.off = /[?&]perf=0\b/.test(Q);
  P.K = { budget: 3.5, cull: !/[?&]pcull=0\b/.test(Q), warm: !/[?&]pwarm=0\b/.test(Q), pre: !/[?&]ppre=0\b/.test(Q), fix: !/[?&]pfix=0\b/.test(Q),
    preHold: 15000, longMs: 50, hitchMs: 100, shadowEveryIn: 4, cullHz: 10 };
  function note(tag, e) { try { if (P.errs.length < 40) P.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (P.errs.length <= 5) console.warn("[perf] " + tag, e); } catch (x) {} }
  P.note = note;
  if (P.off) return;
  function G(name) { try { return eval(name); } catch (e) { return undefined; } }   // a client global that may not exist yet (TDZ before client.js runs)
  var now = function () { return performance.now(); };

  // ───────────────────────── frame clock (own rAF: works with or without the plan hooks) ─────────────────────────
  var NB = 1024;
  var FT = P.ft = { dt: new Float32Array(NB), at: new Float64Array(NB), i: 0, n: 0, last: 0, hist: new Uint32Array(256), cnt: 0, sum: 0, long: 0, hitch: 0, worst: 0 };
  function tick(t) {
    requestAnimationFrame(tick);
    var dt = FT.last ? t - FT.last : 0; FT.last = t;
    try { if (!P.installed) tryInstall(); } catch (e) {}
    if (!dt || document.hidden || dt > 10000) return;   // a background tab or a debugger pause is not a frame
    FT.dt[FT.i] = dt; FT.at[FT.i] = t; FT.i = (FT.i + 1) % NB; if (FT.n < NB) FT.n++;
    if (P.readyAt && !P.paused) { FT.cnt++; FT.sum += dt; FT.hist[Math.min(255, dt | 0)]++; if (dt > P.K.longMs) FT.long++; if (dt > P.K.hitchMs) FT.hitch++; if (dt > FT.worst) FT.worst = dt; }
    if (OV.on) { try { drawOverlay(t); } catch (e) { note("overlay", e); OV.on = false; } }
    if (P.installed && (FT.cnt & 127) === 0) { try { pinPrograms(); } catch (e) {} }
    if (WQ.length && t - WQ.idleAt > 400) { try { runQueue(1.5); } catch (e) { note("queue", e); } }   // no idle time for a while: a small slice anyway
  }
  requestAnimationFrame(tick);
  function recent(ms, t) { var w = 0, s = 0, c = 0; for (var k = 0; k < FT.n; k++) { var j = (FT.i - 1 - k + NB) % NB; if (t - FT.at[j] > ms) break; var d = FT.dt[j]; if (d > w) w = d; s += d; c++; } return { worst: w, avg: c ? s / c : 0, n: c }; }
  function pct(p) { var tot = FT.cnt; if (!tot) return 0; var k = tot * p, a = 0; for (var i = 0; i < 256; i++) { a += FT.hist[i]; if (a >= k) return i + 1; } return 256; }

  // ───────────────────────── overlay (F3 or ?perf=1) ─────────────────────────
  var OV = P.ov = { on: /[?&]perf=1\b/.test(Q), el: null, cv: null, cx: null, txt: null, at: 0 };
  function mkOverlay() {
    if (OV.el || !document.body) return; var d = document.createElement("div"); d.id = "perfov";
    d.style.cssText = "position:fixed;left:8px;bottom:112px;z-index:99999;background:rgba(8,13,8,0.84);color:#e8f5ea;font:11px/1.4 'JetBrains Mono',ui-monospace,Consolas,monospace;padding:6px 8px 7px;border:1px solid rgba(77,222,111,0.45);border-radius:6px;pointer-events:none;white-space:pre;min-width:240px";
    var t = document.createElement("div"); var c = document.createElement("canvas"); c.width = 240; c.height = 56; c.style.cssText = "display:block;margin-top:5px;width:240px;height:56px";
    d.appendChild(t); d.appendChild(c); document.body.appendChild(d); OV.el = d; OV.txt = t; OV.cv = c; OV.cx = c.getContext("2d");
  }
  P.toggle = function (on) { OV.on = on === undefined ? !OV.on : !!on; if (OV.on) mkOverlay(); if (OV.el) OV.el.style.display = OV.on ? "" : "none"; return OV.on; };
  addEventListener("keydown", function (e) { if (e.code !== "F3" || e.repeat) return; var t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return; e.preventDefault(); P.toggle(); }, true);
  function fmtN(v) { return v >= 1e6 ? (v / 1e6).toFixed(2) + " M" : v >= 1e4 ? Math.round(v / 1e3) + " k" : String(v); }
  function drawOverlay(t) {
    if (!OV.el) mkOverlay(); if (!OV.el) return;
    var c = OV.cx, W = 240, H = 56, top = 50; c.clearRect(0, 0, W, H); c.fillStyle = "rgba(255,255,255,0.06)"; c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(77,222,111,0.35)"; c.fillRect(0, H - 16.7 * H / top, W, 1); c.fillStyle = "rgba(244,205,90,0.35)"; c.fillRect(0, H - 33.3 * H / top, W, 1);
    for (var k = 0; k < W && k < FT.n; k++) { var j = (FT.i - 1 - k + NB) % NB, d = FT.dt[j]; var h = Math.min(H, d * H / top); c.fillStyle = d < 18 ? "#4DDE6F" : d < 34 ? "#f4cd5a" : "#ff9180"; c.fillRect(W - 1 - k, H - h, 1, h); }
    if (t - OV.at < 250) return; OV.at = t;
    var r1 = recent(1000, t), r10 = recent(10000, t); var inf = (typeof renderer !== "undefined" && renderer) ? renderer.info : null;
    var mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + " / " + Math.round(performance.memory.jsHeapSizeLimit / 1048576) + " MB" : "n/a";
    var lines = [
      "fps " + (r1.avg ? (1000 / r1.avg).toFixed(1) : "-") + "   frame " + r1.avg.toFixed(1) + " ms",
      "worst 10 s " + Math.round(r10.worst) + " ms   long " + FT.long + "   hitch " + FT.hitch,
      "draws " + RI.calls + "   tris " + fmtN(RI.tri),
      inf ? "geo " + inf.memory.geometries + "   tex " + inf.memory.textures + "   prog " + (inf.programs ? inf.programs.length : 0) : "",
      "heap " + mem,
      "load " + (P.loadMs ? (P.loadMs / 1000).toFixed(1) + " s" : "-") + "   pre " + (P.n.preMs ? (P.n.preMs / 1000).toFixed(1) + " s" : "-") + "   tier " + (G("QUAL") ? G("QUAL").level : "?"),
      "queue " + WQ.length + (IC.kind ? "   in " + IC.kind + ": -" + IC.nObj + " obj -" + IC.nInst + " inst" : "")
    ];
    OV.txt.textContent = lines.filter(Boolean).join("\n");
  }

  // ───────────────────────── session summary (anonymous) ─────────────────────────
  var SID = Math.random().toString(36).slice(2, 10);
  function gpuName() { if (P.gpu !== undefined) return P.gpu; try { var gl = renderer.getContext(); var x = gl.getExtension("WEBGL_debug_renderer_info"); P.gpu = String(x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).slice(0, 160); } catch (e) { P.gpu = null; } return P.gpu; }
  P.summary = function () {
    var q = G("QUAL");
    return { v: 1, sid: SID, at: new Date().toISOString().slice(0, 19), build: window.BUILD || null, secs: P.readyAt ? Math.round((now() - P.readyAt) / 1000) : 0, frames: FT.cnt,
      fps: FT.sum ? +(1000 * FT.cnt / FT.sum).toFixed(1) : 0, avgMs: FT.cnt ? +(FT.sum / FT.cnt).toFixed(2) : 0, p95: pct(0.95), p99: pct(0.99), long: FT.long, hitch: FT.hitch, worst: Math.round(FT.worst),
      loadMs: P.loadMs ? Math.round(P.loadMs) : null, preMs: P.n.preMs || null, tier: q ? q.level : null, gpu: gpuName(), mobile: /Android|iPhone|iPad/i.test(navigator.userAgent), cores: navigator.hardwareConcurrency || null,
      w: innerWidth, h: innerHeight, dpr: +(devicePixelRatio || 1).toFixed(2), programs: (typeof renderer !== "undefined" && renderer.info.programs) ? renderer.info.programs.length : null };
  };
  P.sessions = function () { try { return JSON.parse(localStorage.getItem("g1:perf") || "[]"); } catch (e) { return []; } };
  function save(final) {
    if (!P.readyAt || FT.cnt < 30) return; var s = P.summary();
    try { var list = P.sessions().filter(function (o) { return o && o.sid !== SID; }); list.push(s); while (list.length > 10) list.shift(); localStorage.setItem("g1:perf", JSON.stringify(list)); } catch (e) {}
    if (final && window.PERF_ENDPOINT && navigator.sendBeacon && !P.sent) { try { P.sent = navigator.sendBeacon(window.PERF_ENDPOINT, JSON.stringify(s)); } catch (e) {} }
  }
  P.save = save;
  addEventListener("pagehide", function () { save(true); });
  document.addEventListener("visibilitychange", function () { if (document.hidden) save(true); });
  setInterval(function () { save(false); }, 60000);

  // ───────────────────────── per-frame render totals, light-count and shadow-flag stabilisers ─────────────────────────
  var RI = P.ri = { calls: 0, tri: 0 };
  function wrapRender() {
    if (P.rf || typeof renderFrame !== "function") return; var orig = renderFrame; P.rf = orig;
    renderFrame = function () {
      try { preRender(); } catch (e) { note("pre-render", e); }
      var inf = renderer.info, ar = inf.autoReset; inf.autoReset = false; inf.reset();
      try { return orig.apply(this, arguments); } finally { RI.calls = inf.render.calls; RI.tri = inf.render.triangles; inf.autoReset = ar; }
    };
  }
  // the client's rooms and the fly-in cabin each carry a fill HemisphereLight: adding one changes the scene's hemisphere light count,
  // which is part of every lit shader's program key, so every material on screen recompiled on entering the FBO (109 programs).
  // A spare (black, intensity 0) hemisphere light stands in whenever no room fill is shown: the count never changes.
  function hemiInit() { if (P.hemi || !P.K.fix || typeof scene === "undefined") return; var h = new THREE.HemisphereLight(0x000000, 0x000000, 0); h.name = "perf spare hemi"; h.userData.pooled = true; h.userData.perf = true; h.layers.enable(30); scene.add(h); P.hemi = h; }
  function countHemi(g) { var c = g.userData.perfHemi; if (c && c.n === g.children.length) return c.k; var k = 0; g.traverse(function (o) { if (o.isHemisphereLight && o.visible) k++; }); g.userData.perfHemi = { n: g.children.length, k: k }; return k; }
  function hemiFix() {
    if (!P.hemi) return; var need = 0;
    try { var ins = inside; if (ins && ins.g && ins.g.parent && ins.g.visible) need += countHemi(ins.g); } catch (e) {}
    try { var F = FLY; if (F && F.g && F.g.parent && F.g.visible) need += countHemi(F.g); } catch (e) {}
    var want = need === 0; if (P.hemi.visible !== want) P.hemi.visible = want;
  }
  P.hemiFix = hemiFix;
  // medium and low tiers (no CSM): the client turns sun.castShadow off for the moment the key light hands over from the sun to
  // the moon (and back), which recompiles every lit material twice a day. Keep the flag; the light is at zero there anyway.
  function sunFix() { if (!P.K.fix) return; try { if (CSMX.on) return; if (sun.parent && renderer.shadowMap.enabled && !sun.castShadow) sun.castShadow = true; } catch (e) {} }
  function preRender() {
    hemiFix(); sunFix();
    if (IC.kind && P.K.shadowEveryIn > 1 && !FLY.on && renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = (FRAME_N % P.K.shadowEveryIn) === 0;   // indoors: the outside's shadows at a steady quarter rate
  }

  // ───────────────────────── idle-time work queue: GPU warm-up in small slices ─────────────────────────
  // a task returns false to stay at the head of the queue (waiting, e.g. for a parallel compile), "later" to go to the back, anything else when done
  var WQ = P.wq = []; WQ.idleAt = 0; var idleOn = false;
  var ric = window.requestIdleCallback ? function (f, o) { return requestIdleCallback(f, o); } : function (f) { return setTimeout(function () { f({ timeRemaining: function () { return 4; }, didTimeout: false }); }, 30); };
  function runOne() { var f = WQ[0], r; try { r = f(); } catch (e) { note("task", e); r = true; } if (r === false) return false; WQ.shift(); if (r === "later") WQ.push(f); return true; }
  function runQueue(budget) { var t0 = now(), k = WQ.length; while (WQ.length && k-- > 0 && now() - t0 < budget) if (!runOne()) break; }
  function idleStep(dl) { var t0 = now(), k = WQ.length, ran = false; while (WQ.length && k-- > 0 && dl.timeRemaining() > 1.5 && now() - t0 < 8) { ran = true; if (!runOne()) break; } if (ran) WQ.idleAt = now(); if (WQ.length) ric(idleStep, { timeout: 1000 }); else idleOn = false; }
  function kick() { if (idleOn || !WQ.length) return; idleOn = true; ric(idleStep, { timeout: 1000 }); }
  P.queue = function (fn) { WQ.push(fn); kick(); };
  // a staged (generator) build stepped inside the per-frame budget; at least one stage per call
  P.step = function (it, ms) { var t0 = now(), r; do { r = it.next(); } while (!r.done && now() - t0 < (ms || P.K.budget)); P.n.steps = (P.n.steps || 0) + 1; return r; };
  P.drain = function (it) { var r; do { r = it.next(); } while (!r.done); return r.value; };

  function mainRT() { try { return POST.on && POST.rt && !document.body.classList.contains("photo") ? POST.rt : null; } catch (e) { return null; } }
  // compile a group's materials the way the main pass will draw them: lights from the scene (the group's own point and spot
  // lights are pooled by the client, so they never count), the post target's colour space, fog or (the room probes) no fog
  function compileGroup(g, async, noFog) {
    var hid = []; g.traverse(function (o) { if ((o.isPointLight || o.isSpotLight) && !o.userData.pooled && o.visible) { hid.push(o); o.visible = false; } });
    var fog = scene.fog, prt = renderer.getRenderTarget(), tm = renderer.toneMapping, rt = mainRT(), res;
    try { if (noFog) scene.fog = null; renderer.setRenderTarget(rt); if (!rt) renderer.toneMapping = THREE.ACESFilmicToneMapping; hemiFix(); res = async ? renderer.compileAsync(g, camera, scene) : renderer.compile(g, camera, scene); }
    finally { renderer.setRenderTarget(prt); renderer.toneMapping = tm; scene.fog = fog; for (var i = 0; i < hid.length; i++) hid[i].visible = true; }
    return res;
  }
  P.compileGroup = compileGroup;
  // a room's materials are cloned on every entry and disposed on the way out (the gfx floor probes, the FBO's model copies); three.js
  // then deletes a program nobody uses, and the next entry compiles it again. Every program gets one extra user: compiled once per session.
  function pinPrograms() { var ps = renderer.info.programs || [], n = 0; for (var i = 0; i < ps.length; i++) { var p = ps[i]; if (!p.perfPin) { p.perfPin = true; p.usedTimes++; n++; } } P.n.pinned = (P.n.pinned || 0) + n; }
  P.pinPrograms = pinPrograms;
  // programs issued by compile() link in the driver; the first use blocks until they have. Do that wait here, in slices.
  var DONEP = new WeakSet();
  function finishSome(until) { var ps = renderer.info.programs || [], left = 0; for (var i = 0; i < ps.length; i++) { var p = ps[i]; if (DONEP.has(p)) continue; if (now() > until) { left++; continue; } try { if (p.isReady && !p.isReady()) { left++; continue; } p.getUniforms(); } catch (e) {} DONEP.add(p); } return left; }
  function texturesOf(g) { var out = new Set(); g.traverse(function (o) { var ms = o.material; if (!ms) return; ms = Array.isArray(ms) ? ms : [ms]; for (var i = 0; i < ms.length; i++) { var m = ms[i]; for (var k in m) { var v = m[k]; if (v && v.isTexture && !v.isRenderTargetTexture && !v.isVideoTexture) out.add(v); } if (m.uniforms) for (var u in m.uniforms) { var w = m.uniforms[u] && m.uniforms[u].value; if (w && w.isTexture && !w.isRenderTargetTexture && !w.isVideoTexture) out.add(w); } } }); return Array.from(out); }
  function texReady(t) { var im = t.image; if (!im || t.version === 0) return false; if (t.isCompressedTexture || t.isDataTexture || t.isData3DTexture || t.isDataArrayTexture) return true; if (Array.isArray(im)) return im.length > 0 && im.every(function (x) { return x && x.complete !== false && (x.width || x.image); }); return im.complete !== false && !!(im.width || im.videoWidth || im.data); }
  function texPending(t) { try { return renderer.properties.get(t).__version !== t.version; } catch (e) { return false; } }
  // geometry buffers: a 4 px render of just these meshes (layer 30; every scene light is on layer 30 too, so the program is the main pass's)
  var GEOW = new WeakSet(), WR = { rt: null, cam: null };
  function lightsOn30() { var L = [hemi, sun, moon, P.hemi]; try { LIGHTS.pool.forEach(function (l) { L.push(l); }); LIGHTS.spool.forEach(function (l) { L.push(l); }); } catch (e) {} try { if (CSMX.csm) CSMX.csm.lights.forEach(function (l) { L.push(l); }); } catch (e) {} try { if (inside && inside.g) inside.g.traverse(function (o) { if (o.isHemisphereLight) L.push(o); }); } catch (e) {} for (var i = 0; i < L.length; i++) if (L[i] && L[i].layers) L[i].layers.enable(30); }
  function warmMeshes(list, attach) {
    var rt = mainRT(); if (!rt) { list.forEach(function (m) { GEOW.add(m.geometry); }); return; }   // no post target (low tier): a 4 px render would compile another variant
    if (!WR.rt) { WR.rt = new THREE.WebGLRenderTarget(4, 4); WR.cam = new THREE.PerspectiveCamera(60, 1, 0.1, 10); WR.cam.layers.set(30); }
    lightsOn30(); var added = false; if (attach && !attach.parent) { scene.add(attach); added = true; }
    var sv = [], anc = [];
    for (var i = 0; i < list.length; i++) { var m = list[i]; var root = m; while (root.parent) root = root.parent; if (root !== scene) continue; sv.push([m, m.layers.mask, m.frustumCulled, m.visible]); m.layers.enable(30); m.frustumCulled = false; m.visible = true; for (var p = m.parent; p && p !== scene; p = p.parent) if (!p.visible) { anc.push(p); p.visible = true; } }
    var su = renderer.shadowMap.autoUpdate, sn = renderer.shadowMap.needsUpdate, bg = scene.background, prt = renderer.getRenderTarget(), ar = renderer.info.autoReset;
    try { renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; scene.background = null; renderer.info.autoReset = true; hemiFix(); renderer.setRenderTarget(WR.rt); if (sv.length) renderer.render(scene, WR.cam); }
    finally { renderer.setRenderTarget(prt); scene.background = bg; renderer.shadowMap.autoUpdate = su; renderer.shadowMap.needsUpdate = sn; renderer.info.autoReset = ar;
      for (var j = 0; j < sv.length; j++) { var s = sv[j]; s[0].layers.mask = s[1]; s[0].frustumCulled = s[2]; s[0].visible = s[3]; } for (var k = 0; k < anc.length; k++) anc[k].visible = false; if (added) scene.remove(attach); }
    for (var q = 0; q < list.length; q++) GEOW.add(list[q].geometry); P.n.geoWarm = (P.n.geoWarm || 0) + list.length;
  }
  // warm a group built ahead of the player (hidden): programs, then textures one per slot, then geometry in ~60k-vertex batches
  P.warmGroup = function (g, opts) {
    if (!P.K.warm || !g) return; opts = opts || {}; var st = { t0: 0, done: false }; var name = opts.name || g.name || "group";
    WQ.push(function () { if (!st.t0) { st.t0 = now(); try { Promise.all([compileGroup(g, true), compileGroup(g, true, true)]).then(function () { st.done = true; }, function () { st.done = true; }); pinPrograms(); } catch (e) { note("warm compile " + name, e); st.done = true; } return false; } return st.done || now() - st.t0 > 15000; });
    WQ.push(function () { texturesOf(g).forEach(function (t) { WQ.splice(1, 0, function () { if (texReady(t) && texPending(t)) { renderer.initTexture(t); P.n.texWarm = (P.n.texWarm || 0) + 1; } return true; }); }); return true; });
    var meshes = null, mi = 0;
    WQ.push(function () { if (!meshes) { meshes = []; g.traverse(function (o) { if ((o.isMesh || o.isPoints || o.isLine) && o.geometry && !GEOW.has(o.geometry) && o.onBeforeRender === THREE.Object3D.prototype.onBeforeRender) meshes.push(o); }); }
      var t1 = now(); while (mi < meshes.length && now() - t1 < 2) { var batch = [], verts = 0; while (mi < meshes.length && verts < 60000) { var m = meshes[mi++]; if (GEOW.has(m.geometry)) continue; batch.push(m); verts += m.geometry.attributes.position ? m.geometry.attributes.position.count : 0; } if (batch.length) warmMeshes(batch, opts.detached ? g : null); }
      if (mi >= meshes.length) { P.n.warmed = (P.n.warmed || 0) + 1; P.n.lastWarm = name + " " + Math.round(now() - st.t0) + " ms"; return true; } return false; });
    kick();
  };

  // ───────────────────────── lazily loaded kinds: warmed off the critical path once they land ─────────────────────────
  var WARMED = {};
  function warmKinds(kinds) {
    (kinds || []).forEach(function (k) { if (WARMED[k] || !MODELS[k] || !MODELS[k].parts) return; WARMED[k] = 1; var m = MODELS[k]; var g = makeModel(k); g.visible = false; g.name = "perf lazy " + k;
      if (m.lodGeos && m.lodGeos.length) m.lodGeos.forEach(function (geo, i) { g.add(new THREE.Mesh(geo, (m.parts[i] || m.parts[m.parts.length - 1]).material)); });
      P.warmGroup(g, { detached: true, name: "lazy " + k }); });
    P.n.lazyWarm = Object.keys(WARMED).length;
  }
  P.warmKinds = warmKinds;
  function wrapLazy() {
    var f = window.PLAN_LOAD_KINDS; if (typeof f !== "function" || f.perf) return;
    var w = function (kinds) { var p = f.apply(this, arguments); try { if (p && p.then) p.then(function (got) { try { warmKinds(Array.isArray(got) ? got : kinds); } catch (e) { note("lazy warm", e); } }, function () {}); } catch (e) {} return p; };
    w.perf = true; w.orig = f; window.PLAN_LOAD_KINDS = w;
  }

  // ───────────────────────── shader pre-compilation behind the loading screen ─────────────────────────
  // The client hides #load when the world is built. The first time it does, we put it back (in the same task, before a paint),
  // build a hidden sample of every interior, compile the whole scene and wait for the programs to link, then let it go.
  // A new player (the fly-in starts at once) is not held: the same work runs in idle time after the flight.
  var PRE = P.pre = { state: 0 };
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function nextFrame() { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); }
  function both(g) { compileGroup(g, false); compileGroup(g, false, true); pinPrograms(); }
  // the client's own rooms (the FBO terminal, the arcade, then one of each other enterable kind, most common first): entered and
  // left again in one task, so no frame ever draws the player in there; the player, view and camera are put back afterwards
  async function sampleRooms(say, deadline) {
    if (typeof enterInterior !== "function" || inside || (FLY && FLY.on) || riding) return;
    var IN = window.PLAN_INTERIORS, H = window.PLAN_HANGARS; var skip = {}; try { for (var t in IN.api.TYPES) skip[t] = 1; } catch (e) {} try { skip.hangar_exec = 1; } catch (e) {}
    var kinds = DOOR_KINDS.filter(function (k) { return !skip[k] && PLACE[k] && PLACE[k].length && MODELS[k]; });
    kinds.sort(function (a, b) { var pa = a === "terminal" ? 1e6 : a === "arcade" ? 1e5 : PLACE[a].length, pb = b === "terminal" ? 1e6 : b === "arcade" ? 1e5 : PLACE[b].length; return pb - pa; });
    var n = 0, t0 = now();
    for (var i = 0; i < kinds.length; i++) {
      if (now() > deadline) break; var k = kinds[i], e = PLACE[k][0];
      say("Preparing the graphics: " + (k === "terminal" ? "the Stellar FBO" : k === "arcade" ? "the arcade" : "interiors " + Math.round(100 * i / kinds.length) + "%"));
      var keep = { p: player.position.clone(), yaw: yaw, pitch: pitch, ry: player.rotation.y, cp: camera.position.clone(), cq: camera.quaternion.clone() };
      try { enterInterior({ kind: k, i: 0, e: e, r: MODELS[k].radius * e[4] }); if (inside && inside.g) { try { collectLights(); } catch (x) {} both(inside.g); n++; } } catch (err) { note("pre room " + k, err); }
      if (k === "terminal" && inside && inside.g) { await nextFrame(); await nextFrame(); pinPrograms(); }   // two frames in the FBO behind the loading screen: the gfx floor probe and the hall pay their first-time costs here
      try { if (inside) leaveInterior(); } catch (err) { note("pre leave " + k, err); }
      player.position.copy(keep.p); yaw = keep.yaw; pitch = keep.pitch; player.rotation.y = keep.ry; camera.position.copy(keep.cp); camera.quaternion.copy(keep.cq);
      await nextFrame();
    }
    try { lastSent.at = 0; pushMove(true); } catch (x) {} try { updateCulling(true); } catch (x) {}
    P.n.preRooms = n; P.n.preRoomsMs = Math.round(now() - t0);
  }
  // the module interiors (hangars, clubhouse, restaurant, hangar home): one hidden sample of each, compiled with and without fog,
  // then disposed. This also pays their one-off costs (canvas surfaces, porch rasters, materials) here instead of on approach.
  function sampleModules() {
    var t0 = now(), n = 0;
    var IN = window.PLAN_INTERIORS;
    if (IN && IN.api && IN.list && IN.list.length && !IN.off) {
      var seen = {}; var act = IN.active; if (act) seen[act.kind] = 1;
      IN.list.forEach(function (h) { if (seen[h.kind] || h.L) return; seen[h.kind] = 1; try { var L = IN.api.build(h); if (L && L.g) { L.g.visible = true; both(L.g); n++; } } catch (e) { note("pre int3 " + h.kind, e); } try { IN.api.dispose(h); } catch (e) { note("pre int3 dispose", e); } IN.active = act || null; });
    }
    var H = window.PLAN_HANGARS;
    if (H && H.api && H.list && H.list.length && !H.off && !H.active) {
      var h = H.list.find(function (q) { return !q.L; });
      if (h) { try { var L2 = H.api.buildInterior(h); if (L2 && L2.g) { L2.g.visible = true; both(L2.g); n++; } } catch (e) { note("pre hangar", e); } try { H.api.disposeInterior(h); } catch (e) { note("pre hangar dispose", e); } }
    }
    try { LIGHTS.dirty = true; } catch (e) {}
    P.n.preModules = n; P.n.preModulesMs = Math.round(now() - t0);
  }
  function sampleCabin() { try { if (FLY.warm || FLY.on || typeof warmCabin !== "function") return; if (P.hemi) P.hemi.visible = false; warmCabin(); } catch (e) { note("pre cabin", e); } hemiFix(); }
  async function runPre(hold) {
    var t0 = now(), msg = document.getElementById("loadmsg"), deadline = t0 + P.K.preHold;
    var say = function (s) { if (hold && msg) msg.textContent = s; };
    var c0 = renderer.info.programs.length; say("Preparing the graphics"); await nextFrame();
    if (hold) { try { await sampleRooms(say, t0 + P.K.preHold * 0.55); } catch (e) { note("pre rooms", e); } }
    try { sampleModules(); } catch (e) { note("pre modules", e); }
    if (hold) sampleCabin();
    try { collectLights(); } catch (e) {}
    try { compileGroup(scene, false); } catch (e) { note("pre scene", e); }
    P.n.preIssued = renderer.info.programs.length - c0;
    for (;;) { var left = finishSome(now() + 40); var tot = renderer.info.programs.length; say("Preparing the graphics " + Math.round(100 * (tot - left) / Math.max(1, tot)) + "%"); if (!left || now() > deadline) break; await sleep(left ? 16 : 0); }
    P.n.preMs = Math.round(now() - t0); P.n.prePrograms = renderer.info.programs.length; pinPrograms();
    if (finishSome(0) > 0) P.queue(function () { return finishSome(now() + 3) === 0 ? true : "later"; });
  }
  P.runPre = runPre;
  function ready() { if (P.readyAt) return; P.readyAt = now(); P.loadMs = P.readyAt; try { if (PRE.mo) PRE.mo.disconnect(); } catch (e) {} try { preCands(); } catch (e) {} }
  function watchLoad() {
    var el = document.getElementById("load"); if (!el || !window.MutationObserver || PRE.mo) return;
    PRE.mo = new MutationObserver(function () {
      if (!el.classList.contains("off")) return;
      if (PRE.state === 0) {
        PRE.state = 1; P.n.clientReadyMs = Math.round(now());
        if (!P.K.pre || !window.PLAN) { PRE.state = 2; ready(); return; }
        var fly = false; try { fly = !!FLY.on; } catch (e) {}
        if (fly) {   // a new player: the fly-in has started; compile in idle time and sample the interiors once the flight is over
          ready(); P.queue(function () { try { compileGroup(scene, true); } catch (e) { note("pre scene", e); } return true; });
          P.queue(function () { try { if (FLY.on) return false; } catch (e) {} try { sampleModules(); } catch (e) { note("pre modules", e); } PRE.state = 2; return true; });
          return;
        }
        el.classList.remove("off");
        runPre(true).catch(function (e) { note("pre", e); }).then(function () { PRE.state = 2; el.classList.add("off"); });
        return;
      }
      if (PRE.state === 2) ready();
    });
    PRE.mo.observe(el, { attributes: true, attributeFilter: ["class"] });
  }

  // ───────────────────────── install (the world hook; a legacy world without hooks installs on the first frame) ─────────────────────────
  function tryInstall() { if (P.installed) return; if (typeof renderFrame !== "function" || typeof player === "undefined" || !player) return; install(); }
  function install() {
    if (P.installed) return; P.installed = true;
    try { hemiInit(); } catch (e) { note("hemi", e); }
    try { wrapRender(); } catch (e) { note("wrap render", e); }
    try { wrapLazy(); } catch (e) { note("wrap lazy", e); }
    try { wrapCulling(); } catch (e) { note("wrap culling", e); }
    try { watchLoad(); } catch (e) { note("watch load", e); }
    try { if (typeof warmCabin === "function" && !warmCabin.perf) { var wc = warmCabin; warmCabin = function () { if (P.hemi) P.hemi.visible = false; try { return wc.apply(this, arguments); } finally { hemiFix(); } }; warmCabin.perf = true; } } catch (e) { note("wrap cabin", e); }
    if (!P.readyAt) { try { if (document.getElementById("load").classList.contains("off")) ready(); } catch (e) {} }
  }
  P.install = install;
  (function hookAll() {
    var set = function (phase, name, fn) { var list = window.PLAN_HOOKS[phase]; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name: name, fn: fn }); };
    set("world", "perfWorld", function () { install(); });
    set("frame", "perfFrame", function (dt, t) { try { cullFrame(t); } catch (e) { note("cull frame", e); } });
  })();

  // ───────────────────────── indoor portal culling ─────────────────────────
  // Inside a room the outside is seen only through its openings (glass walls, windows, open doors, skylights). Each opening is a
  // rectangle in the room's frame; from the camera position it makes a pyramid (four planes through the camera and the opening's
  // edges, plus the opening's own plane). An outside object (a top-level scene object, or one instance of an instanced kind) is
  // drawn only when its bounding sphere reaches into a pyramid, or into the room's own box. The test depends on the camera's
  // position only (not its direction), so turning around never pops anything in. Hidden objects get layer mask 0 (no main pass,
  // no shadow pass) and their mask back on the way out; instances are dropped from the instance buffers the client fills.
  var IC = P.ic = { kind: null, key: null, sig: 0, quads: [], boxes: [], np: 0, all: true, at: 0, cam: new THREE.Vector3(1e9, 0, 0), M: new THREE.Matrix4(), inv: new THREE.Matrix4(), invS: 1, cands: [], nObj: 0, nInst: 0, roots: [] };
  var PL = new Float64Array(64 * 20), _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _mc = new THREE.Vector3(), _s = new THREE.Sphere(), _bx = new THREE.Box3(), _m4 = new THREE.Matrix4();
  function roomKey() { try { var ins = inside; if (ins) { if (ins.hgr) return ins.hgr; if (ins.int3) return ins.int3; if (ins.g) return ins.g; } } catch (e) {} var GB = window.PLAN_GBANK; if (GB && GB.site && (GB.zoneNow === 2 || GB.zoneNow === 3)) return GB; return null; }
  function roomSig(k) { try { if (inside && inside.hgr === k) return k.open > 0.02 ? 2 : 1; } catch (e) {} if (k && k.zoneNow) return k.zoneNow; return 0; }
  // rectangles in a room frame: ax "x" = the plane z = c (a: x, b: y), "z" = the plane x = c (a: z, b: y), "y" = the plane y = c (a: x, b: z)
  function R(ax, c, a0, a1, b0, b1) { return { ax: ax, c: c, a0: Math.min(a0, a1), a1: Math.max(a0, a1), b0: Math.min(b0, b1), b1: Math.max(b0, b1) }; }
  function mergeRects(list) { var out = []; list.forEach(function (r) { for (var i = 0; i < out.length; i++) { var o = out[i]; if (o.ax === r.ax && Math.abs(o.c - r.c) < 0.35) { o.a0 = Math.min(o.a0, r.a0); o.a1 = Math.max(o.a1, r.a1); o.b0 = Math.min(o.b0, r.b0); o.b1 = Math.max(o.b1, r.b1); return; } } out.push(R(r.ax, r.c, r.a0, r.a1, r.b0, r.b1)); }); return out; }
  function rectQuad(r, M) { var p = r.ax === "x" ? [[r.a0, r.b0, r.c], [r.a1, r.b0, r.c], [r.a1, r.b1, r.c], [r.a0, r.b1, r.c]] : r.ax === "z" ? [[r.c, r.b0, r.a0], [r.c, r.b0, r.a1], [r.c, r.b1, r.a1], [r.c, r.b1, r.a0]] : [[r.a0, r.c, r.b0], [r.a1, r.c, r.b0], [r.a1, r.c, r.b1], [r.a0, r.c, r.b1]]; return p.map(function (v) { return new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(M); }); }
  // thin transparent meshes (glass) as openings, in the room frame `inv`
  function glassRects(meshes, inv) { var out = []; meshes.forEach(function (m) { var g = m.geometry; if (!g) return; if (!g.boundingBox) g.computeBoundingBox(); _bx.copy(g.boundingBox).applyMatrix4(_m4.multiplyMatrices(inv, m.matrixWorld)); var sx = _bx.max.x - _bx.min.x, sy = _bx.max.y - _bx.min.y, sz = _bx.max.z - _bx.min.z, mn = Math.min(sx, sy, sz); if (mn > 0.6 || Math.max(sx, sy, sz) < 0.5) return;
    if (mn === sz) out.push(R("x", (_bx.min.z + _bx.max.z) / 2, _bx.min.x, _bx.max.x, _bx.min.y, _bx.max.y)); else if (mn === sx) out.push(R("z", (_bx.min.x + _bx.max.x) / 2, _bx.min.z, _bx.max.z, _bx.min.y, _bx.max.y)); else out.push(R("y", (_bx.min.y + _bx.max.y) / 2, _bx.min.x, _bx.max.x, _bx.min.z, _bx.max.z)); }); return out; }
  // the room the camera is in: its frame, its boxes (the camera must be in one of them) and its openings
  function describe(k) {
    var D = { kind: null, M: new THREE.Matrix4(), boxes: [], rects: [], roots: [] };
    if (inside && inside.hgr === k && k.L) { var L = k.L; D.kind = "hangar"; L.g.updateMatrixWorld(true); D.M.copy(L.g.matrixWorld); D.roots.push(L.g);
      D.boxes.push([L.xL - 0.3, L.xR + 0.3, -1, L.Hc + 1.5, L.zB - 0.3, L.zF + 0.6]);
      D.rects.push(R("z", L.xL, L.zB + 1, L.zF - 1, L.Hc - 0.95, L.Hc - 0.15), R("z", L.xR, L.zB + 1, L.zF - 1, L.Hc - 0.95, L.Hc - 0.15));   // the clerestory glazing
      if (k.open > 0.02) D.rects.push(R("x", L.zF, L.x0, L.x1, (L.fy || 0) - 0.5, L.dTop + 0.3));   // the hangar door
      return D; }
    if (inside && inside.int3 === k && k.L) { var L3 = k.L, T = L3.T; D.kind = "interior " + k.kind; L3.g.updateMatrixWorld(true); D.M.copy(L3.g.matrixWorld); D.roots.push(L3.g);
      (T.rooms || []).forEach(function (r) { D.boxes.push([r[0] - 0.3, r[2] + 0.3, r[4] - 1, r[5] + 0.6, r[1] - 0.3, r[3] + 0.3]); });
      if (!L3.ports || !L3.ports.length) return null;   // a module without recorded openings: no culling
      L3.ports.forEach(function (p) { D.rects.push(p[0] === "x" ? R("x", p[1], p[2], p[3], p[4], p[5]) : R("z", p[1], p[2], p[3], p[4], p[5])); });
      var Dd = T.door; if (Dd) D.rects.push(R("x", Dd.zw !== undefined ? Dd.zw : Dd.z, Dd.x0, Dd.x1, Dd.y0, Dd.y0 + Dd.h));
      return D; }
    if (inside && inside.g === k && inside.door) { var kind = inside.door.kind, half = inside.half, g = inside.g; D.kind = "room " + kind; g.updateMatrixWorld(true); D.M.copy(g.matrixWorld); D.roots.push(g);
      var isT = kind === "terminal", isA = kind === "arcade", isM = kind === "manor", isH = kind === "hangar" || kind === "hangarhome" || kind === "hangarhome2";
      var hgt = isT ? 9.5 : isA ? ((window.ARCADE_ROOM && ARCADE_ROOM.hgt) || 8) : isM ? 6.2 : 7.2;
      D.boxes.push([-half - 0.3, half + 0.3, -1, hgt + 0.6, -half - 0.3, half + 0.3]);
      if (isT || isA || isM) D.rects.push(R("x", half, -half, half, 0, hgt));   // the glass front
      else { var dw = isH ? half * 1.2 : 2.2; D.rects.push(R("x", half, -dw / 2, dw / 2, 0, 2.6)); if (!isH) [-1, 0, 1].forEach(function (kk) { [-1, 1].forEach(function (sd) { D.rects.push(R("z", sd * (half - 0.08), kk * half * 0.5 - 0.75, kk * half * 0.5 + 0.75, 1.25, 2.55)); }); }); }
      if (isT) { D.rects.push(R("y", hgt, -26.5, 26.5, -half, half)); try { if (TERM.landZ !== undefined) D.rects.push(R("z", half, TERM.landZ - 2.6, TERM.landZ + 2.6, 0, 4.2)); } catch (e) {} }   // skylights, the landside door
      return D; }
    if (k && k.site && k.zoneNow) { var S = k.site; D.kind = "gbank " + (k.zoneNow === 2 ? "hall" : "suite"); D.M.makeRotationY(Math.atan2(S.sn, S.cs)).setPosition(S.cx, S.B, S.cz);
      D.boxes.push([-17.5, 17.5, -1.5, 30, -12.6, 12.6]);
      var inv = new THREE.Matrix4().copy(D.M).invert(), gl = [];
      scene.children.forEach(function (o) { if (!/^gbank_/.test(o.name || "")) return; D.roots.push(o); o.traverse(function (q) { var mt = q.material; if (q.isMesh && mt && !Array.isArray(mt) && mt.transparent && mt.opacity < 0.5) gl.push(q); }); });
      D.rects = glassRects(gl, inv); return D; }
    return null;
  }
  function enterIndoor(k, sig) {
    var D = null; try { D = describe(k); } catch (e) { note("describe", e); }
    if (IC.kind) showAll();
    IC.key = k; IC.sig = sig; if (!D || !D.rects.length) { IC.kind = null; IC.quads = []; return; }
    IC.kind = D.kind; IC.M.copy(D.M); IC.inv.copy(D.M).invert(); IC.invS = 1 / Math.max(1e-6, D.M.getMaxScaleOnAxis()); IC.boxes = D.boxes; IC.roots = D.roots;
    var rects = mergeRects(D.rects).slice(0, 64); IC.quads = rects.map(function (r) { return rectQuad(r, D.M); }); IC.nRects = rects.length;
    collectCands(); IC.cam.set(1e9, 0, 0); IC.at = 0; P.n.indoor = (P.n.indoor || 0) + 1;
  }
  function leaveIndoor() { showAll(); IC.kind = null; IC.key = null; IC.quads = []; IC.np = 0; IC.nObj = 0; IC.nInst = 0; try { updateCulling(true); } catch (e) {} }
  // ── planes from the camera through every opening; false: the camera is outside the room boxes or standing in an opening (draw all)
  function buildPlanes(C) {
    IC.np = 0; if (!IC.quads.length) return false;
    _v.copy(C).applyMatrix4(IC.inv); var inBox = false; for (var b = 0; b < IC.boxes.length; b++) { var B = IC.boxes[b]; if (_v.x > B[0] && _v.x < B[1] && _v.y > B[2] && _v.y < B[3] && _v.z > B[4] && _v.z < B[5]) { inBox = true; break; } } if (!inBox) return false;
    for (var i = 0; i < IC.quads.length; i++) { var q = IC.quads[i], o = IC.np * 20;
      _mc.copy(q[0]).add(q[1]).add(q[2]).add(q[3]).multiplyScalar(0.25); _a.subVectors(q[1], q[0]); _b.subVectors(q[3], q[0]); _n.crossVectors(_a, _b).normalize();
      var dc = _n.dot(_mc) - _n.dot(C); if (dc < 0) { _n.negate(); dc = -dc; } if (dc < 0.08) return false;
      PL[o] = _n.x; PL[o + 1] = _n.y; PL[o + 2] = _n.z; PL[o + 3] = -_n.dot(_mc);
      for (var k = 0; k < 4; k++) { _a.subVectors(q[k], C); _b.subVectors(q[(k + 1) & 3], C); _n.crossVectors(_a, _b); var len = _n.length(); if (len < 1e-9) return false; _n.multiplyScalar(1 / len); if (_n.dot(_mc) - _n.dot(C) < 0) _n.negate(); var j = o + 4 + k * 4; PL[j] = _n.x; PL[j + 1] = _n.y; PL[j + 2] = _n.z; PL[j + 3] = -_n.dot(C); }
      IC.np++; }
    return IC.np > 0;
  }
  function inRoom(x, y, z, r) { var e = IC.inv.elements; var lx = e[0] * x + e[4] * y + e[8] * z + e[12], ly = e[1] * x + e[5] * y + e[9] * z + e[13], lz = e[2] * x + e[6] * y + e[10] * z + e[14], rl = r * IC.invS;
    for (var b = 0; b < IC.boxes.length; b++) { var B = IC.boxes[b]; if (lx > B[0] - rl && lx < B[1] + rl && ly > B[2] - rl && ly < B[3] + rl && lz > B[4] - rl && lz < B[5] + rl) return true; } return false; }
  function seen(x, y, z, r) {
    if (IC.all) return true; if (inRoom(x, y, z, r)) return true;
    for (var i = 0; i < IC.np; i++) { var o = i * 20, ok = true; for (var k = 0; k < 5; k++) { var j = o + k * 4; if (PL[j] * x + PL[j + 1] * y + PL[j + 2] * z + PL[j + 3] < -r) { ok = false; break; } } if (ok) return true; }
    return false;
  }
  P.seen = seen;
  // ── top-level scene objects: a bounding sphere in the object's own frame (moving groups carry it along), cached per object
  var CANDS = new WeakMap(), INSTM = new Set();
  function candOf(o) {
    var c = CANDS.get(o); if (c && c.nc === o.children.length) return c;
    _bx.makeEmpty(); var meshes = [], dyn = false;
    o.traverse(function (q) { if (!(q.isMesh || q.isPoints || q.isLine || q.isSprite)) return; meshes.push(q); var sp = null;
      if (q.isInstancedMesh) { if (!q.boundingSphere) q.computeBoundingSphere(); sp = q.boundingSphere; } else if (q.geometry) { if (!q.geometry.boundingSphere) q.geometry.computeBoundingSphere(); sp = q.geometry.boundingSphere; }
      if (q.isSkinnedMesh) dyn = true; if (!sp || !(sp.radius >= 0) || !isFinite(sp.radius)) return; _s.copy(sp).applyMatrix4(q.matrixWorld); _bx.expandByPoint(_v.copy(_s.center).addScalar(-_s.radius)); _bx.expandByPoint(_v.copy(_s.center).addScalar(_s.radius)); });
    if (_bx.isEmpty() || !meshes.length) c = { nc: o.children.length, empty: true, r: 0 };
    else { _bx.getBoundingSphere(_s); var lc = _s.center.clone().applyMatrix4(_m4.copy(o.matrixWorld).invert()); c = { nc: o.children.length, lc: lc, r: _s.radius * (dyn ? 1.5 : 1) + 0.5, meshes: meshes, hid: false }; }
    CANDS.set(o, c); return c;
  }
  // a candidate is a top-level object or, for a big group (the park, the site's signs), each of its children, down three levels;
  // a single object bigger than 700 m is always drawn
  function excluded(o) { return o.isLight || o.isCamera || INSTM.has(o) || (o.userData && (o.userData.noCull || o.userData.interior || o.userData.perf)); }
  function gather(o, depth, out, pend, t0) {
    if (excluded(o)) return;
    if (pend && !CANDS.has(o) && now() - t0 > 6) { pend.push([o, depth]); return; }
    var c = candOf(o); if (c.empty) return;
    if (c.r > 60 && depth < 3 && !o.isMesh && o.children.length > 1 && o.children.length <= 800) { for (var i = 0; i < o.children.length; i++) gather(o.children[i], depth + 1, out, pend, t0); return; }
    if (c.r <= 700) out.push(o);
  }
  function collectCands() {
    INSTM.clear(); try { INSTSET.forEach(function (S) { [S.insts, S.far, S.far2].forEach(function (a) { (a || []).forEach(function (m) { INSTM.add(m); }); }); }); } catch (e) {}
    var roots = new Set(IC.roots); var t0 = now(); IC.cands = []; IC.pend = [];
    for (var i = 0; i < scene.children.length; i++) { var o = scene.children[i]; if (roots.has(o) || o === player) continue; gather(o, 0, IC.cands, IC.pend, t0); }
  }
  // sphere cache filled in idle time after load, so entering a room never pays for it
  function preCands() { var st = scene.children.slice().map(function (o) { return [o, 0]; }); P.queue(function () { var t0 = now(); while (st.length && now() - t0 < 2) { var it = st.pop(), o = it[0]; if (excluded(o)) continue; try { var c = candOf(o); if (!c.empty && c.r > 60 && it[1] < 3 && !o.isMesh && o.children.length > 1 && o.children.length <= 800) for (var i = 0; i < o.children.length; i++) st.push([o.children[i], it[1] + 1]); } catch (e) {} } return st.length === 0 ? true : "later"; }); }
  P.preCands = preCands;
  function hideC(c) { var ms = c.meshes; for (var i = 0; i < ms.length; i++) { var m = ms[i]; if (m.layers.mask !== 0) { m.userData.perfMask = m.layers.mask; m.layers.mask = 0; } } c.hid = true; }
  function showC(c) { var ms = c.meshes; for (var i = 0; i < ms.length; i++) { var m = ms[i]; if (m.layers.mask === 0 && m.userData.perfMask !== undefined) { m.layers.mask = m.userData.perfMask; m.userData.perfMask = undefined; } } c.hid = false; }
  function showAll() { for (var i = 0; i < IC.cands.length; i++) { var c = CANDS.get(IC.cands[i]); if (c && c.hid) showC(c); } IC.nObj = 0; }
  function updateObjects() {
    if (IC.pend && IC.pend.length) { var t0 = now(); while (IC.pend.length && now() - t0 < 2) { var pp = IC.pend.pop(); gather(pp[0], pp[1], IC.cands, null, t0); } }
    var n = 0; for (var i = 0; i < IC.cands.length; i++) { var o2 = IC.cands[i], c = CANDS.get(o2); if (!c || c.empty) continue; if (!o2.parent) { if (c.hid) showC(c); continue; }
      _v.copy(c.lc).applyMatrix4(o2.matrixWorld); var vis = seen(_v.x, _v.y, _v.z, c.r); if (vis) { if (c.hid) showC(c); } else { if (!c.hid) hideC(c); n++; } }
    IC.nObj = n;
  }
  // ── instanced kinds: after the client's own culling, drop what no opening shows from each tier's instance buffer
  function filterTier(S, insts, idx, n) {
    if (!insts || !insts.length || !idx) return 0; var keep = S.perfKeep || (S.perfKeep = new Int32Array(S.list.length)); if (keep.length < S.list.length) keep = S.perfKeep = new Int32Array(S.list.length);
    var m = 0, h = 0; for (var k = 0; k < n; k++) { var i = idx[k], e = S.list[i], s = e[4], hh = S.h * s; if (seen(e[0], e[1] + hh * 0.5, e[2], S.rad * s * 1.4 + hh * 0.6)) { keep[m++] = i; h = (h + Math.imul(i + 1, 2654435761)) | 0; } }
    for (var q = 0; q < insts.length; q++) { var inst = insts[q], pk = inst.userData.perfPk, ver = inst.instanceMatrix.version;
      var clientWrote = !pk || pk.ver !== ver; if (clientWrote ? m === n : (pk.m === m && pk.h === h)) { if (clientWrote) inst.userData.perfPk = null; continue; }
      var arr = inst.instanceMatrix.array, src = S.mats; for (var k2 = 0; k2 < m; k2++) { var a = keep[k2] * 16, b = k2 * 16; for (var j = 0; j < 16; j++) arr[b + j] = src[a + j]; }
      inst.count = m; inst.visible = m > 0; inst.instanceMatrix.needsUpdate = true; inst.userData.perfPk = { ver: inst.instanceMatrix.version, m: m, h: h }; }
    return n - m;
  }
  function filterInst() { var c = 0; for (var s = 0; s < INSTSET.length; s++) { var S = INSTSET[s]; c += filterTier(S, S.insts, S.idx, S.n || 0); if (S.far) c += filterTier(S, S.far, S.idxF, S.nf || 0); if (S.far2) c += filterTier(S, S.far2, S.idxF2, S.nf2 || 0); } IC.nInst = c; }
  function wrapCulling() {
    if (P.uc || typeof updateCulling !== "function") return; var orig = updateCulling; P.uc = orig;
    updateCulling = function () { var r = orig.apply(this, arguments); if (IC.kind) { try { filterInst(); } catch (e) { note("cull inst", e); } } return r; };
  }
  function cullFrame(t) {
    if (!P.installed) return;
    var k = P.K.cull ? roomKey() : null;
    if (!k) { if (IC.kind || IC.key) leaveIndoor(); return; }
    var sig = roomSig(k); if (k !== IC.key || sig !== IC.sig) enterIndoor(k, sig);
    if (!IC.kind) return;
    var C = camera.position; if ((C.distanceToSquared(IC.cam) > 0.1225 && t - IC.at > 1000 / P.K.cullHz) || t - IC.at > 1000) { IC.at = t; IC.cam.copy(C); IC.all = !buildPlanes(C); updateObjects(); try { updateCulling(false); } catch (e) { note("cull update", e); } }
  }
  P.cullStats = function () { return { kind: IC.kind, rects: IC.nRects || 0, planes: IC.np, all: IC.all, cands: IC.cands.length, hiddenObjects: IC.nObj, hiddenInstances: IC.nInst }; };
})();
