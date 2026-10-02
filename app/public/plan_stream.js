// P2A: world streaming (window.PLAN_STREAM). Loaded before client.js; ?stream=0 turns it off (the old full boot download).
//
// Boot: every model kind that has a far LOD file starts as a PROXY built from that light file (the same file the engine draws as
// its far tier), so the skyline is complete from the first frame and every size the world build reads (radius, sx, sz, height,
// sink) exists. Kinds read directly (not only instanced) and kinds with no LOD file load in full as before. After the world is
// built, the kinds placed near the spawn are fetched in full behind the loading screen (the only part of the boot the bar shows).
// Then the rest streams in by priority: distance to the player's predicted position (speed and heading), the fast-travel
// destination first, 3 downloads at a time; parsing and the swap wait for calm moments (not in an interior entry, not mid fly-in
// shot), the materials compile through plan_perf's idle warm-up first, and a kind is swapped while none of its instances is
// near and in view (or after a short wait). The swap keeps the model object, the instanced meshes and their flags; the proxy
// geometry, moved into the full model's frame, becomes the far LOD (no second LOD download).
(function () {
  "use strict";
  var Q = null; try { Q = new URLSearchParams(location.search); } catch (e) {}
  var now = function () { return performance.now(); };
  var PS = window.PLAN_STREAM = {
    on: !(Q && Q.get("stream") === "0"), live: false, started: false, done: false,
    // conc: downloads at a time; nearB/nearP/nearS: the radius (m) round the spawn whose kinds are in the boot set (buildings,
    // props over 3.5 m, small props); swapB/swapP/swapS: a kind is swapped while none of its instances is this near and in view;
    // swapWait: or after this long (ms); look: seconds of motion the priority looks ahead; warpR: destination radius of a
    // fast travel that must be in full before the jump (props within warpR / 2); warpWait: longest veil (ms)
    K: { conc: 3, ahead: 3, nearB: 240, nearP: 130, nearS: 80, swapB: 250, swapP: 130, swapS: 70, swapWait: 8000, look: 4, warpR: 150, warpWait: 12000, bootWait: 240000 },
    n: { proxies: 0, proxyFail: 0, full: 0, boot: 0, streamed: 0, swapped: 0, failed: 0, retries: 0, bytes: 0, leaks: 0, healed: 0, warps: 0, veils: 0, clips: 0, sw: "" },
    st: {}, leaks: {}, errs: [], ms: {}, order: [], drift: {}
  };
  function note(w, e) { try { PS.errs.push(w + ": " + (e && e.message || e)); if (PS.errs.length > 40) PS.errs.shift(); console.warn("plan_stream " + w, e); } catch (x) {} }
  // P3: the meshopt decoding of every model (boot set and stream) runs in workers instead of on the main thread (one decode of a
  // large model was a 20 to 200 ms long task). The bundle's own decoder cannot start workers (it builds the worker's source from
  // function names its minifier renamed, so the workers never answer), so the unminified decoder of three r170
  // (lib/meshopt_decoder.module.js, same wasm) runs them, and the bundle's decoder hands every async decode to it once it is up
  // (until then, and if it fails, decoding stays on the main thread as before). ?pdw=0 or ?p3=0: off.
  try { var MD = window.MeshoptDecoder; if (MD && MD.decodeGltfBufferAsync && !MD.p3w && !/[?&](pdw|p3)=0\b/.test(location.search)) {
    var nw = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2)), DW = null, dec0 = MD.decodeGltfBufferAsync; MD.p3w = true;
    MD.decodeGltfBufferAsync = function (count, stride, source, mode, filter) { return DW ? DW.decodeGltfBufferAsync(count, stride, source, mode, filter) : dec0.apply(MD, arguments); };
    import((window.AV || String)("/lib/meshopt_decoder.module.js?v=" + (window.BUILD || 0))).then(function (m) { var D = m && m.MeshoptDecoder; if (!D || !D.supported || !D.useWorkers) return; return D.ready.then(function () { D.useWorkers(nw);
      // the workers must answer (a test decode resolves or rejects) before any model is handed to them
      var probe = new Promise(function (res) { D.decodeGltfBufferAsync(1, 4, new Uint8Array([0xa0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "ATTRIBUTES", "NONE").then(function () { res(true); }, function () { res(true); }); setTimeout(function () { res(false); }, 4000); });
      return probe.then(function (ok) { if (ok) { DW = D; PS.n.decodeWorkers = nw; } else note("decode workers", "no answer"); }); }); }).catch(function (e) { note("decode workers", e); });
  } } catch (e) { note("decode workers", e); }

  // kinds that something reads in full outside the instancing (makeModel, parts, the fly-in jets, rides, the boot room
  // builders): they load in full at boot. A miss is caught by the parts getter below (PS.leaks) and fetched at once.
  var EAGER = new Set(["lamp", "lux_lamp", "cart", "jet", "gbjet", "gbjet2", "jetseat", "jettable", "jetbar", "jetsofa", "jetlamp", "stone_pillar", "horse", "stellar_tug", "bush1", "bush2", "saguaro", "paloverde", "mesquite", "terminal", "gbank"]);
  PS.EAGER = EAGER;
  var H = null;   // the client's loader hooks (attach)
  var PROXY = {}, FULL = {}, BUF = {}, TRIES = {}, READYT = {}, GROUPS = {}, PRI = {}, FORCEK = {}, CTRL = {};

  function inPlan() { return !!(window.PLAN && typeof PLAN_MODE !== "undefined" && PLAN_MODE); }
  function hasLod(k) { var V = window.ASSET_V; if (!V) return true; return !!(V["/models/lod/" + k + ".glb"] || V["/models_m/lod/" + k + ".glb"]); }
  function lodUrl(k) { var mob = ASSET.tier === "m" && !(window.ASSET_V && !window.ASSET_V["/models_m/lod/" + k + ".glb"]); return (mob ? "/models_m/lod/" : "/models/lod/") + k + ".glb?v=" + (window.BUILD || 0); }

  PS.attach = function (h) { H = h; PS.live = PS.on && inPlan() && typeof THREE !== "undefined" && !!THREE.GLTFLoader; return PS.live; };
  PS.wants = function (k) {
    if (!PS.live) return false; var sp = MODEL_SPECS[k]; if (!sp || sp.vehicle || EAGER.has(k)) return false;
    if (/^(char_|acc_|hair)/.test(k)) return false; try { if (typeof NO_LOD !== "undefined" && NO_LOD.has(k)) return false; } catch (e) {}
    return hasLod(k);
  };

  // ───────────────────────── proxies ─────────────────────────
  function leak(k) { if (PS.inInst) return; if (PS.st[k] === "dormant") wake(k); if (PS.leaks[k]) return; var s = ""; try { s = (new Error().stack || "").split("\n").slice(3, 6).map(function (l) { return l.trim().replace(/^at /, "").replace(/https?:\/\/[^/]+\//, ""); }).join(" < "); } catch (e) {} PS.leaks[k] = s || "?"; PS.n.leaks++; }
  function procMat(src) {
    var nm = (src && src.name) || ""; if (nm === "glass") return { mat: glassMaterial(), glass: true }; if (nm === "winframe") return { mat: frameMaterial() };
    var m = wrapMat(src); if (!m) m = new THREE.MeshStandardMaterial({ color: 0x9a8a78 });
    // the LOD files carry 4 px colour swatches: keep the colour, drop the maps that would only add noise
    if (m.emissiveMap && m.emissive) m.emissive.setRGB(0, 0, 0);   /* R5: without its map the emissive colour lit the whole stand-in (a white block at night) */
    m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null; m.aoMap = null; m.emissiveMap = null; m.side = THREE.DoubleSide; m.transparent = false; m.depthWrite = true; m.roughness = 0.9; m.metalness = 0;
    if (m.map) m.map.colorSpace = THREE.SRGBColorSpace; m.userData.p2proxy = true; return { mat: m };
  }
  PS.loadProxy = function (k) {
    return new Promise(function (res) {
      var spec = MODEL_SPECS[k];
      H.loader.load(lodUrl(k), function (g) {
        try {
          var root = g.scene; root.updateMatrixWorld(true);
          var box = new THREE.Box3().setFromObject(root), sz = new THREE.Vector3(), c = new THREE.Vector3(); box.getSize(sz); box.getCenter(c);
          if (!(sz.x > 0 || sz.z > 0) || !(sz.y > 0)) { PS.n.proxyFail++; return res(false); }
          var s = spec.raw ? 1 : spec.height ? spec.height / sz.y : spec.size / Math.max(sz.x, sz.z);
          var norm = spec.raw ? new THREE.Matrix4() : new THREE.Matrix4().makeRotationY(spec.rot || 0).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
          var parts = [];
          root.traverse(function (o) { if (!o.isMesh) return; var geo = o.geometry.clone(); geo.applyMatrix4(new THREE.Matrix4().copy(norm).multiply(o.matrixWorld)); try { sanitizeTangents(geo); } catch (e) {} if (window.R6MEM && R6MEM.hold) R6MEM.hold(geo);   /* R6: read again at the swap */ var pm = procMat(o.material); parts.push(pm.glass ? { geometry: geo, material: pm.mat, noShadow: true, noReceive: true } : { geometry: geo, material: pm.mat }); });
          if (!parts.length) { PS.n.proxyFail++; return res(false); }
          var m = { norm: norm, bottom: box.min.y, radius: Math.max(sz.x, sz.z) * s / 2, height: sz.y * s, sx: sz.x * s, sz: sz.z * s, sink: 0, proxy: true };
          Object.defineProperty(m, "_pp", { value: parts, writable: true, enumerable: false, configurable: true });
          Object.defineProperty(m, "parts", { get: function () { leak(k); return this._pp; }, set: function (v) { this._pp = v; }, enumerable: true, configurable: true });
          m.sink = spec.prop || spec.vehicle ? 0 : baseLift(parts, Math.max(sz.x, sz.z) * s);
          MODELS[k] = m; PROXY[k] = m; PS.st[k] = "proxy"; PS.n.proxies++; res(true);
        } catch (e) { note("proxy " + k, e); PS.n.proxyFail++; res(false); }
      }, undefined, function () { PS.n.proxyFail++; res(false); });
    });
  };
  // makeModel() groups made from a proxy are upgraded in place at the swap (geometry and, where the caller kept it, material)
  PS.track = function (k, g) { PS.n.tracked = (PS.n.tracked || 0) + 1; if (PS.st[k] === "dormant") wake(k); try { (GROUPS[k] || (GROUPS[k] = [])).push(typeof WeakRef === "function" ? new WeakRef(g) : { deref: function () { return g; } }); } catch (e) {} };
  // a kind nothing placed or built at boot stays DORMANT (its light proxy only, nothing streamed); the first read, makeModel or
  // PLAN_LOAD_KINDS wakes it at the head of the queue (legacy kinds, animals and furniture nobody uses, interiors' pieces)
  function wake(k) { PS.st[k] = "proxy"; PRI[k] = 1; PS.n.woken = (PS.n.woken || 0) + 1; ORD = []; kick(); }
  // where meshes built straight from a proxy's geometry stand (the park's instanced animals, the ride vehicles)
  var LSPOTS = {};
  function leakSpots() { var gm = new Map(); for (var k in PROXY) { var pp = PROXY[k]._pp; if (pp) for (var i = 0; i < pp.length; i++) gm.set(pp[i].geometry, k); } var mine = new Set(); INSTSET.forEach(function (S) { (S.insts || []).forEach(function (x) { mine.add(x); }); });
    var v = new THREE.Vector3(), m4 = new THREE.Matrix4(); scene.traverse(function (o) { if (!o.isMesh || mine.has(o)) return; var k = gm.get(o.geometry); if (!k) return; var L = LSPOTS[k] || (LSPOTS[k] = []); if (L.length > 200) return;
      if (o.isInstancedMesh) { o.updateMatrixWorld(); var n = Math.min(o.count, 64); for (var j = 0; j < n; j++) { o.getMatrixAt(j, m4); v.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld); L.push([v.x, v.y, v.z, 0, 1]); } } else { o.getWorldPosition(v); L.push([v.x, v.y, v.z, 0, 1]); } }); }
  PS.isProxy = function (k) { var m = MODELS[k]; return !!(m && m.proxy); };

  // ───────────────────────── where each kind is placed ─────────────────────────
  var ALIASES = {};   // kind -> kinds sharing its model (palm aliases)
  function aliasesOf(k) { if (ALIASES[k]) return ALIASES[k]; var out = [k], px = PROXY[k]; if (px) { PS.inInst = true; try { for (var a in MODELS) if (a !== k && !PROXY[a] && MODELS[a] && MODELS[a].parts === px._pp) out.push(a); } finally { PS.inInst = false; } } return (ALIASES[k] = out); }
  function placesOf(k) { var L = LSPOTS[k] ? LSPOTS[k].slice() : [], as = aliasesOf(k); for (var i = 0; i < as.length; i++) { var p = PLACE[as[i]]; if (p && p.length) L = L.concat(p); } return L; }
  var _gp = null; function groupSpots(k) { var gs = GROUPS[k], out = []; if (!gs) return out; if (!_gp) _gp = new THREE.Vector3(); for (var i = 0; i < gs.length; i++) { var g = gs[i].deref(); if (!g || !g.parent) continue; g.getWorldPosition(_gp); out.push([_gp.x, _gp.y, _gp.z, 0, 1]); } return out; }
  function nearR(k, B, P, S) { var sp = MODEL_SPECS[k] || {}, m = MODELS[k]; return !sp.prop ? B : m && m.height < 3.5 ? S : P; }

  // ───────────────────────── priority ─────────────────────────
  var MOT = { x: 0, z: 0, vx: 0, vz: 0, t: 0 }, FOCUS = null;
  function pendingKinds() { var out = []; for (var k in PROXY) { var s = PS.st[k]; if (s === "proxy") out.push(k); } return out; }
  function score(k, px, pz, fx, fz) {
    if (PRI[k]) return -1e9; var L = placesOf(k).concat(groupSpots(k)); if (!L.length) return 1e8 + (k.charCodeAt(0) || 0);
    var R = nearR(k, PS.K.nearB, PS.K.nearP, PS.K.nearS), best = 1e12;
    for (var i = 0; i < L.length; i++) { var e = L[i]; var dx = e[0] - px, dz = e[2] - pz, d = Math.sqrt(dx * dx + dz * dz); if (d > 1) { var c = (dx * fx + dz * fz) / d; if (c > 0) d *= 1 - 0.3 * c; } if (FOCUS) { var d2 = Math.hypot(e[0] - FOCUS.x, e[2] - FOCUS.z) * 0.6; if (d2 < d) d = d2; } if (d < best) best = d; }
    return Math.max(0, best - R * 0.5) - R * 0.5;
  }
  function order() {
    var p = null; try { p = typeof player !== "undefined" && player ? player.position : null; } catch (e) {} var sx = 0, sz = 0; if (p) { sx = p.x; sz = p.z; } else if (typeof TERM !== "undefined") { sx = TERM.exit[0]; sz = TERM.exit[1]; }
    var look = Math.min(300, PS.K.look), px = sx + Math.max(-60, Math.min(60, MOT.vx)) * look, pz = sz + Math.max(-60, Math.min(60, MOT.vz)) * look;
    var fx = 0, fz = 1; try { var dir = new THREE.Vector3(); camera.getWorldDirection(dir); var l = Math.hypot(dir.x, dir.z) || 1; fx = dir.x / l; fz = dir.z / l; } catch (e) {}
    if (FOCUS && now() - FOCUS.t > 30000) FOCUS = null;
    var ks = pendingKinds(), sc = {}; for (var i = 0; i < ks.length; i++) sc[ks[i]] = score(ks[i], px, pz, fx, fz);
    ks.sort(function (a, b) { return sc[a] - sc[b]; }); PS.order = ks.slice(0, 12).map(function (k) { return k + ":" + Math.round(sc[k]); }); return ks;
  }

  // ───────────────────────── download, parse, warm, swap ─────────────────────────
  var DL = 0, PARSING = false, HOLD = 0, CUT = 0, PAUSE = false;
  function busy() { var t = now(); if (t < HOLD) return true; try { if (FLY.on && t - CUT > 700) return true; } catch (e) {} return false; }
  function dlHold() { var t = now(); if (t < HOLD) return true; try { if (FLY.on && t - CUT < 1500) return true; } catch (e) {} return false; }
  function download(k) {
    PS.st[k] = "dl"; DL++; var t0 = now(); var ac = typeof AbortController === "function" ? new AbortController() : null; CTRL[k] = ac;
    var url = (window.AV || String)(ASSET.models + "/" + k + ".glb?v=" + (window.BUILD || 0));
    fetch(url, ac ? { signal: ac.signal } : undefined).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.arrayBuffer(); }).then(function (buf) { delete CTRL[k]; DL--; PS.n.bytes += buf.byteLength; BUF[k] = buf; PS.ms[k] = Math.round(now() - t0); PS.st[k] = "buf"; kick(); },
      function (e) { delete CTRL[k]; DL--; if (e && e.name === "AbortError") { PS.st[k] = "proxy"; PS.n.aborted = (PS.n.aborted || 0) + 1; kick(); return; } TRIES[k] = (TRIES[k] || 0) + 1; if (TRIES[k] < 3) { PS.n.retries++; PS.st[k] = "wait"; setTimeout(function () { if (PS.st[k] === "wait") PS.st[k] = "proxy"; kick(); }, 2500 * TRIES[k]); } else { PS.st[k] = "failed"; PS.n.failed++; note("download " + k, e); } kick(); });
  }
  function parse(k) {
    var buf = BUF[k]; delete BUF[k]; PS.st[k] = "parse"; PARSING = true; var px = PROXY[k];
    H.loadOne(k, "stream", buf).then(function () {
      PARSING = false; var full = MODELS[k]; MODELS[k] = px;
      if (!full || full === px) { TRIES[k] = (TRIES[k] || 0) + 1; if (TRIES[k] < 3) { PS.st[k] = "proxy"; PS.n.retries++; } else { PS.st[k] = "failed"; PS.n.failed++; note("parse " + k, "no model"); } kick(); return; }
      FULL[k] = full; warm(k);
    }, function (e) { PARSING = false; MODELS[k] = px; PS.st[k] = "failed"; PS.n.failed++; note("parse " + k, e); kick(); });
  }
  // the full model's materials compile (instanced, as drawn) and its textures upload in idle slices before the swap uses them
  function warm(k) {
    var P = window.PLAN_PERF, full = FULL[k]; PS.st[k] = "warm";
    if (PS.force || FORCEK[k] || !P || !P.warmGroup || !P.K || !P.K.warm) { PS.st[k] = "ready"; READYT[k] = now(); kick(); return; }
    try { var g = new THREE.Group(); g.name = "stream warm " + k; g.visible = false; var mt = new THREE.Matrix4(); full.parts.forEach(function (p) { var im = new THREE.InstancedMesh(p.geometry, p.material, 1); im.setMatrixAt(0, mt); im.frustumCulled = false; g.add(im); });
      P.warmGroup(g, { detached: true, name: "stream " + k }); setTimeout(function () { if (PS.st[k] === "warm") { PS.st[k] = "ready"; READYT[k] = now(); PS.n.warmLate = (PS.n.warmLate || 0) + 1; kick(); } }, 6000); P.queue(function () { if (PS.st[k] === "warm") { PS.st[k] = "ready"; READYT[k] = now(); kick(); } g.children.forEach(function (im) { try { im.dispose(); } catch (e) {} }); return true; });
    } catch (e) { note("warm " + k, e); PS.st[k] = "ready"; READYT[k] = now(); }
  }
  var _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sp = new THREE.Sphere();
  function nearInView(k) {
    try { _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm); } catch (e) { return false; }
    var R = nearR(k, PS.K.swapB, PS.K.swapP, PS.K.swapS), cx = camera.position.x, cz = camera.position.z, L = placesOf(k).concat(groupSpots(k)), m = MODELS[k];
    for (var i = 0; i < L.length; i++) { var e = L[i], dx = e[0] - cx, dz = e[2] - cz; if (dx * dx + dz * dz > R * R) continue; var h = (m ? m.height : 5) * (e[4] || 1); _sp.center.set(e[0], e[1] + h * 0.5, e[2]); _sp.radius = (m ? m.radius : 5) * (e[4] || 1) + h * 0.5; if (_fr.intersectsSphere(_sp)) return true; }
    return false;
  }
  function canSwap(k) { if (PS.force || FORCEK[k]) return true; if (busy()) return false; if (!nearInView(k)) return true; try { if (FLY.on) return now() - CUT < 400; } catch (e) {} return now() - READYT[k] > PS.K.swapWait; }
  function lodFits(geos, m) {
    var bb = new THREE.Box3(); for (var i = 0; i < geos.length; i++) { geos[i].computeBoundingBox(); bb.union(geos[i].boundingBox); } var ls = new THREE.Vector3(), lc = new THREE.Vector3(); bb.getSize(ls); bb.getCenter(lc);
    var r = Math.max(m.sx, m.sz) / 2, ok = function (a, b) { return Math.abs(a - b) < 0.05 || (b > 0 && a / b > 0.6 && a / b < 1.6); };
    return ok(Math.max(ls.x, ls.z), Math.max(m.sx, m.sz)) && ok(Math.min(ls.x, ls.z), Math.min(m.sx, m.sz)) && ok(ls.y, m.height) && Math.abs(lc.x) < Math.max(0.6, r * 0.25) && Math.abs(lc.z) < Math.max(0.6, r * 0.25);
  }
  var _mtx = new THREE.Matrix4();
  function upgradeSet(kind, m, sinkChanged) {
    var S = null; for (var i = 0; i < INSTSET.length; i++) if (INSTSET[i].kind === kind) { S = INSTSET[i]; break; } if (!S) return;
    var spec = MODEL_SPECS[kind] || {}, ins = S.insts, mask = ins[0] ? ins[0].layers.mask : 1, list = INST[kind] || (INST[kind] = []);
    m.parts.forEach(function (part, i) { var inst = ins[i];
      if (!inst) { inst = new THREE.InstancedMesh(part.geometry, part.material, S.list.length); inst.frustumCulled = false; inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage); inst.count = 0; inst.visible = false; inst.layers.mask = mask; scene.add(inst); ins.push(inst); list.push(inst); }
      else { inst.geometry = part.geometry; inst.material = part.material; }
      inst.castShadow = !part.noShadow && (shadowAll() || !spec.prop || m.height > 3); inst.receiveShadow = !part.noReceive; });
    while (ins.length > m.parts.length) { var x = ins.pop(); scene.remove(x); var j = list.indexOf(x); if (j >= 0) list.splice(j, 1); try { x.dispose(); } catch (e) {} }
    S.rad = m.radius; S.h = m.height; S.canopy = spec.prop && spec.sway && m.height > 3.5 ? m.radius * 0.9 : 0; S.pxK = undefined;
    if (sinkChanged) for (var q = 0; q < S.list.length; q++) instMatrix(S.list[q], m, _mtx).toArray(S.mats, q * 16);
    S.n = -1; S.nf = -1; S.nf2 = -1; if (m.lodGeos && !S.far) { try { attachLod(kind); } catch (e) { note("attachLod " + kind, e); } }
  }
  function swap(k) {
    var px = PROXY[k], full = FULL[k]; if (!px || !full) return; delete FULL[k]; var t0 = now();
    var old = px._pp, oldSink = px.sink, d = PS.drift; d[k] = [+(full.sx / px.sx).toFixed(3), +(full.height / px.height).toFixed(3), +(full.sz / px.sz).toFixed(3)];
    // the proxy's geometry, moved into the full model's frame, is the far LOD (the same file loadLod would fetch)
    var lod = null; if (!(MODEL_SPECS[k] || {}).vehicle) { try { var T = new THREE.Matrix4().copy(full.norm).multiply(new THREE.Matrix4().copy(px.norm).invert()); lod = old.map(function (p) { p.geometry.applyMatrix4(T); p.geometry.computeBoundingSphere(); return p.geometry; }); if (!lodFits(lod, full)) { (window.LOD_SKIPPED = window.LOD_SKIPPED || []).push(k); lod = null; } } catch (e) { note("lod " + k, e); lod = null; } }
    // the proxy object becomes the full model (same identity for anything holding it)
    var as = aliasesOf(k);
    Object.defineProperty(px, "parts", { value: full.parts, writable: true, enumerable: true, configurable: true });
    var keep = { sink: px.sink, baseR: px.baseR, baseRect: px.baseRect }; for (var key in full) if (key !== "parts") px[key] = full[key]; delete px.proxy;
    /* the world was built with the proxy's sink, base radius and base rectangle (foundations, seat heights, solids): keep them so the full model sits exactly where the proxy stood */ d[k].push(+((full.sink || 0) - (keep.sink || 0)).toFixed(2)); px.sink = keep.sink; if (keep.baseR !== undefined) px.baseR = keep.baseR; if (keep.baseRect !== undefined) px.baseRect = keep.baseRect; if (lod) px.lodGeos = lod; else delete px.lodGeos; MODELS[k] = px;
    var sinkChanged = false;
    PS.inInst = true; try { upgradeSet(k, px, sinkChanged);
      for (var i = 1; i < as.length; i++) { var a = as[i], ma = MODELS[a]; if (!ma) continue; delete ma.proxy; ma.parts = full.parts; ["norm", "bottom", "radius", "height", "sx", "sz", "sink"].forEach(function (f) { ma[f] = px[f]; }); if (lod) ma.lodGeos = lod; else delete ma.lodGeos; upgradeSet(a, ma, sinkChanged); PS.st[a] = "full"; }
    } finally { PS.inInst = false; }
    // makeModel groups built from the proxy
    var gs = GROUPS[k] || []; delete GROUPS[k]; var roots = []; for (var g0 = 0; g0 < gs.length; g0++) { var r0 = gs[g0].deref(); if (r0) roots.push(r0); } if (PS.leaks[k]) roots.push(scene);
    var mine = new Set(); INSTSET.forEach(function (S) { if (as.indexOf(S.kind) < 0) return; [S.insts, S.far, S.far2].forEach(function (L) { (L || []).forEach(function (x) { mine.add(x); }); }); });
    for (var g = 0; g < roots.length; g++) { var grp = roots[g]; grp.traverse(function (o) { if (!o.isMesh || mine.has(o)) return; for (var q = 0; q < old.length; q++) if (o.geometry === old[q].geometry) { var fp = full.parts[q] || full.parts[full.parts.length - 1]; if (o.material === old[q].material) o.material = fp.material; o.geometry = fp.geometry; var u = o.userData; if (u && u.fullGeo === old[q].geometry) { u.fullGeo = fp.geometry; if ("lodGeo" in u && !u.lodGeo && lod) u.lodGeo = old[q].geometry; } PS.n.healed++; break; } }); }
    if (!lod) old.forEach(function (p) { if (!PS.leaks[k] && !gs.length) try { p.geometry.dispose(); } catch (e) {} });
    if (!PS.leaks[k] && !gs.length) old.forEach(function (p) { try { if (p.material.userData.p2proxy) { if (p.material.map) p.material.map.dispose(); p.material.dispose(); } } catch (e) {} });
    try { if (window.PLAN_ENRICH && PLAN_ENRICH.relod) PLAN_ENRICH.relod(); } catch (e) { note("relod", e); }
    try { if (lod && window.R6MEM && R6MEM.release) lod.forEach(function (g) { R6MEM.release(g); }); } catch (e) {}   /* R6: the stand-in is now the far LOD: its arrays may go */
    try { cullAt = 0; } catch (e) {}
    PS.st[k] = "full"; PS.n.swapped++; PS.n.full++; PS.ms[k + ":swap"] = Math.round(now() - t0);
  }
  PS.swapNow = function (k) { if (PS.st[k] === "ready") swap(k); };

  // ───────────────────────── the loop ─────────────────────────
  var ric = window.requestIdleCallback ? function (f) { return requestIdleCallback(f, { timeout: 1200 }); } : function (f) { return setTimeout(f, 30); };
  var lastOrder = 0, ORD = [], kicked = false;
  function kick() { if (kicked) return; kicked = true; setTimeout(function () { kicked = false; tick(); }, 0); }
  function loadOff() { var L = document.getElementById("load"); return !L || L.classList.contains("off"); }
  function tick() {
    if (!PS.started) return; if (!PS.force && !loadOff()) return;   // the background stream starts once the loading screen (and plan_perf's shader pass behind it) is gone
    if (!PS.tPlay && loadOff()) PS.tPlay = Math.round(now());
    try {
      var t = now(); if (t - lastOrder > 900 || !ORD.length) { ORD = order(); lastOrder = t; }
      var nb = 0; for (var kb in BUF) nb++; PS.nBuf = nb;
      if (!PAUSE && !dlHold()) for (var i = 0; i < ORD.length && DL < PS.K.conc && DL + nb < PS.K.conc + PS.K.ahead; i++) { var k = ORD[i]; if (PS.st[k] === "proxy" && (!PS.force || PRI[k])) download(k); }   // forced (boot set, fast travel): only the kinds asked for
      if (!PARSING && (PS.force || !busy())) { var best = null, bi = 1e9; for (var k2 in BUF) { if (PS.force && !PRI[k2]) continue; var ix = ORD.indexOf(k2); if (ix < 0) ix = 1e6; if (ix < bi) { bi = ix; best = k2; } } if (best) { PARSING = true; var kk = best; if (PS.force) parse(kk); else ric(function () { parse(kk); }); } }
      for (var k3 in PROXY) if (PS.st[k3] === "ready" && canSwap(k3)) swap(k3);
      var left = 0; for (var k4 in PROXY) if (PS.st[k4] !== "full" && PS.st[k4] !== "failed" && PS.st[k4] !== "dormant") left++;
      PS.left = left; if (!left && !PS.done) { PS.done = true; PS.tDone = Math.round(t); onDone(); }
      ui();
    } catch (e) { note("tick", e); }
  }
  PS.request = function (ks, force) { [].concat(ks || []).forEach(function (k) { if (!PROXY[k]) return; PRI[k] = 1; if (force) FORCEK[k] = 1; if (PS.st[k] === "wait" || PS.st[k] === "dormant") PS.st[k] = "proxy"; }); ORD = []; kick(); };
  function settled(k) { var s = PS.st[k]; return s === "full" || s === "failed"; }
  var ABORTS = {};
  function waitFull(k) { return new Promise(function (res) { if (settled(k)) return res(k); var t0 = now(), iv = setInterval(function () { if (settled(k) || now() - t0 > 120000) { clearInterval(iv); res(k); } }, 150); }); }   // R5: a waiter gives up after 2 minutes
  // window.PLAN_LOAD_KINDS: a proxy kind a module asks for is fetched first and swapped at once; it resolves when it is in full
  PS.wrapLoad = function () { var f = window.PLAN_LOAD_KINDS; if (typeof f !== "function" || f.p2) return;
    var w = function (ks) { ks = [].concat(ks || []); var px = ks.filter(function (k) { return PROXY[k] && !settled(k); }); if (!px.length) return f(ks);
      PS.request(px, true); return Promise.all([f(ks.filter(function (k) { return px.indexOf(k) < 0; })), Promise.all(px.map(waitFull))]).then(function (r) { return r[0].concat(px.filter(function (k) { return MODELS[k] && !MODELS[k].proxy; })); }); };
    w.p2 = true; w.orig = f; window.PLAN_LOAD_KINDS = w; };

  // the boot set: kinds placed near the spawn, in full before the loading screen goes
  PS.bootNear = function (setLoad) {
    if (!PS.live) return Promise.resolve(0);
    try { leakSpots(); } catch (e) { note("leakSpots", e); }
    var sx = TERM.exit[0], sz = TERM.exit[1], ks = [];
    for (var k in PROXY) { var L = placesOf(k).concat(groupSpots(k)), R = nearR(k, PS.K.nearB, PS.K.nearP, PS.K.nearS); for (var i = 0; i < L.length; i++) if (Math.hypot(L[i][0] - sx, L[i][2] - sz) < R) { ks.push(k); break; } }
    PS.n.boot = ks.length; PS.bootKinds = ks.slice(); PS.n.dormant = 0; PS.dormant = [];
    for (var k6 in PROXY) if (ks.indexOf(k6) < 0 && !placesOf(k6).length && !groupSpots(k6).length) { PS.st[k6] = "dormant"; PS.n.dormant++; PS.dormant.push(k6); } PS.started = true; PS.force = true; PS.tBoot0 = Math.round(now());
    ks.forEach(function (k) { PRI[k] = 1; });   // first in the order
    return new Promise(function (res) {
      var t0 = now(), iv = setInterval(function () { var c = 0; for (var i = 0; i < ks.length; i++) if (PS.st[ks[i]] === "full" || PS.st[ks[i]] === "failed") c++;
        try { setLoad(0.88 + 0.11 * c / Math.max(1, ks.length), "Bringing the arrivals into focus (" + c + " of " + ks.length + ")"); } catch (e) {}
        if (c >= ks.length || now() - t0 > PS.K.bootWait) { clearInterval(iv); ks.forEach(function (k) { delete PRI[k]; }); PS.force = false; PS.tBoot1 = Math.round(now()); res(c); } else tick(); }, 120);
    });
  };

  // per frame: motion (for the look-ahead), camera cuts and interior changes (the heavy moments)
  var lastIn = null, lastCam = null;
  function frameHook(dt) {
    if (!PS.started) return; var t = now();
    try { var p = player && player.position; if (p) { var ddt = Math.max(0.016, (t - (MOT.t || t)) / 1000); if (MOT.t) { var vx = (p.x - MOT.x) / ddt, vz = (p.z - MOT.z) / ddt; if (Math.abs(vx) > 200 || Math.abs(vz) > 200) { vx = 0; vz = 0; } MOT.vx += (vx - MOT.vx) * 0.1; MOT.vz += (vz - MOT.vz) * 0.1; } MOT.x = p.x; MOT.z = p.z; MOT.t = t; } } catch (e) {}
    try { var c = camera.position; if (lastCam && c.distanceTo(lastCam) > 40) CUT = t; (lastCam || (lastCam = new THREE.Vector3())).copy(c); } catch (e) {}
    try { var ins = typeof inside !== "undefined" ? inside : null; if (ins !== lastIn) { lastIn = ins; HOLD = t + 2500; } } catch (e) {}
  }

  // fast travel: the destination's kinds first; a short veil only while kinds within warpR of it are still proxies
  var VEIL = null;
  function veil(on, msg) {
    try { if (!VEIL) { VEIL = document.createElement("div"); VEIL.id = "p2veil"; VEIL.style.cssText = "position:fixed;inset:0;z-index:29;background:#0a1610;opacity:0;transition:opacity .25s;pointer-events:none;display:grid;place-items:center;font:12px 'JetBrains Mono',ui-monospace,monospace;color:rgba(245,241,230,.75);letter-spacing:.06em"; VEIL.innerHTML = "<div><div id='p2veilm'>Loading the area</div><div style='width:180px;height:3px;background:rgba(245,241,230,.15);border-radius:2px;margin:10px auto 0;overflow:hidden'><i id='p2veilb' style='display:block;height:100%;width:0;background:#4DDE6F;transition:width .2s'></i></div></div>"; document.body.appendChild(VEIL); }
      VEIL.style.opacity = on ? "1" : "0"; VEIL.style.pointerEvents = on ? "auto" : "none"; if (msg !== undefined) document.getElementById("p2veilb").style.width = Math.round(msg * 100) + "%"; } catch (e) {}
  }
  function critical(x, z) {
    var out = []; for (var k in PROXY) { var s = PS.st[k]; if (s === "full" || s === "failed" || s === "dormant") continue; var sp = MODEL_SPECS[k] || {}, mm = MODELS[k]; var R = !sp.prop ? PS.K.warpR : mm && mm.height >= 3.5 ? PS.K.warpR * 0.4 : PS.K.warpR * 0.22, L = placesOf(k);   /* buildings 150 m, tall props 60 m, anything 33 m */ for (var i = 0; i < L.length; i++) if (Math.hypot(L[i][0] - x, L[i][2] - z) < R) { out.push(k); break; } } return out;
  }
  var WARP = null;
  PS.gate = function (x, z, y) {
    if (!PS.started || PS.bypass || PS.done) return false; try { if (FLY.on || riding) return false; } catch (e) {}
    FOCUS = { x: x, z: z, t: now() }; ORD = []; PS.n.warps++;
    var crit = critical(x, z); if (!crit.length) { kick(); return false; }
    crit.forEach(function (k) { if (PS.st[k] === "wait") PS.st[k] = "proxy"; PRI[k] = 1; });
    if (WARP) { WARP.to = [x, z, y]; WARP.crit = crit; return true; }
    for (var ka in CTRL) if (crit.indexOf(ka) < 0 && CTRL[ka] && (ABORTS[ka] || 0) < 3) { ABORTS[ka] = (ABORTS[ka] || 0) + 1; try { CTRL[ka].abort(); } catch (e) {} }   /* R5: a kind is cut off by a warp at most 3 times, then left to finish */   // the bandwidth goes to the destination
    PS.n.veils++; WARP = { to: [x, z, y], crit: crit, t0: now() }; PS.force = true; veil(true, 0); PS.lastVeil = { kinds: crit.length, t0: Math.round(WARP.t0) };
    var iv = setInterval(function () { var W = WARP, c = 0; for (var i = 0; i < W.crit.length; i++) { var s = PS.st[W.crit[i]]; if (s === "full" || s === "failed") c++; } veil(true, c / W.crit.length); tick();
      if (c >= W.crit.length || now() - W.t0 > PS.K.warpWait) { clearInterval(iv); W.crit.forEach(function (k) { delete PRI[k]; }); PS.force = false; PS.bypass = true; try { warpTo(W.to[0], W.to[1], W.to[2]); } catch (e) { note("warp", e); } PS.bypass = false; WARP = null; PS.lastVeil.ms = Math.round(now() - W.t0); PS.lastVeil.got = c; setTimeout(function () { veil(false); }, 250); } }, 120);
    return true;
  };

  // ───────────────────────── rare rooms: models fetched on approach, or on entry behind the veil ─────────────────────────
  var RARE = { arcade: ["cab", "cab2", "claw", "claw2", "jackpot", "pinball", "pinball2", "prizecounter", "racer"] }, RAREK = new Set(RARE.arcade), ROOMPRE = {};
  PS.RARE = RARE;
  PS.rare = function (k) { return PS.live && RAREK.has(k); };
  function roomKinds(kind) { return (RARE[kind] || []).filter(function (k) { return MODEL_SPECS[k] && !MODELS[k]; }); }
  PS.roomPrefetch = function (kind) { if (ROOMPRE[kind] || !window.PLAN_LOAD_KINDS) return null; var miss = roomKinds(kind); ROOMPRE[kind] = now(); if (!miss.length) return null; return window.PLAN_LOAD_KINDS(miss); };
  PS.roomGate = function (door, land) {
    if (!PS.live || PS.roomBypass || !door) return false; try { var LD = document.getElementById("load"); if (LD && !LD.classList.contains("off")) return false; } catch (e) {}   /* plan_perf's shader pass behind the loading screen builds the room with what is there */
    var miss = roomKinds(door.kind); if (!miss.length) return false; if (PS.roomWait) return true;
    PS.roomWait = true; PS.n.roomVeils = (PS.n.roomVeils || 0) + 1; veil(true, 0); var t0 = now(), fin = false;
    var go = function () { if (fin) return; fin = true; PS.roomWait = false; PS.roomBypass = true; try { enterInterior(door, land); } catch (e) { note("room " + door.kind, e); } PS.roomBypass = false; PS.lastRoom = { kind: door.kind, ms: Math.round(now() - t0), got: miss.filter(function (k) { return !!MODELS[k]; }).length, of: miss.length }; setTimeout(function () { veil(false); }, 250); };
    var p = window.PLAN_LOAD_KINDS ? window.PLAN_LOAD_KINDS(miss) : Promise.resolve([]); ROOMPRE[door.kind] = ROOMPRE[door.kind] || now();
    var iv = setInterval(function () { var c = miss.filter(function (k) { return !!MODELS[k]; }).length; veil(true, c / miss.length); if (fin) clearInterval(iv); }, 150);
    p.then(go, go); setTimeout(go, PS.K.warpWait); return true;
  };
  function roomWatch() { try { if (!PS.started || !player) return; for (var kind in RARE) { if (ROOMPRE[kind]) continue; var L = PLACE[kind]; if (!L || !L.length) continue; for (var i = 0; i < L.length; i++) if (Math.hypot(L[i][0] - player.position.x, L[i][2] - player.position.z) < 180) { PS.roomPrefetch(kind); break; } } } catch (e) {} }

  // ───────────────────────── the background indicator ─────────────────────────
  var UI = null, uiT = 0;
  function ui() {
    var t = now(); if (t - uiT < 500) return; uiT = t;
    try { var L = document.getElementById("load"); if (L && !L.classList.contains("off")) return; var tot = 0, got = 0; for (var k in PROXY) { if (PS.st[k] === "dormant") continue; tot++; if (PS.st[k] === "full" || PS.st[k] === "failed") got++; }
      if (!UI) { UI = document.createElement("div"); UI.id = "p2stream"; UI.title = "The rest of the site is downloading in the background"; UI.style.cssText = "position:fixed;left:18px;bottom:104px;z-index:12;pointer-events:none;font:10px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:rgba(245,241,230,.62);background:rgba(10,22,16,.42);padding:5px 8px;border-radius:3px;transition:opacity .8s;display:flex;align-items:center;gap:7px"; UI.innerHTML = "<span id='p2streamt'></span><span style='width:46px;height:2px;background:rgba(245,241,230,.15);border-radius:1px;overflow:hidden;display:inline-block'><i id='p2streamb' style='display:block;height:100%;width:0;background:#4DDE6F'></i></span>"; document.body.appendChild(UI); }
      var f = tot ? got / tot : 1; document.getElementById("p2streamt").textContent = "SITE " + Math.round(f * 100) + "%"; document.getElementById("p2streamb").style.width = Math.round(f * 100) + "%"; var fl = false; try { fl = !!FLY.on; } catch (e) {} UI.style.opacity = PS.done || fl ? "0" : "1";   /* hidden in the fly-in cinematic */
    } catch (e) {}
  }

  // ───────────────────────── rare content: character clips on demand ─────────────────────────
  var CLIPS = { state: 0, p: null };
  PS.clips = function () {
    if (CLIPS.p) return CLIPS.p; CLIPS.state = 1;
    var loader = H && H.loader || (typeof gltfLoader === "function" ? gltfLoader() : null); var vq = "?v=" + (window.BUILD || 0);
    var one = function (u) { return new Promise(function (res) { loader.load(u, function (g) { res(g && g.animations && g.animations[0]); }, undefined, function () { res(null); }); }); };
    CLIPS.p = Promise.all(["m", "f"].map(function (b) { return Promise.all(["swim", "golf", "dance1", "dance2", "dance3", "dance4"].map(function (c) { return one("/models/char_" + b + "_" + c + ".glb" + vq).then(function (cl) { return [c, cl]; }); })).then(function (r) { return [b, r]; }); }))
      .then(function (bodies) { bodies.forEach(function (br) { var C = CHAR[br[0]]; if (!C) return; br[1].forEach(function (cc) { if (cc[1] && !C.clips[cc[0]]) { C.clips[cc[0]] = cc[1]; PS.n.clips++; } }); });
        // avatars made before the clips landed get the actions now (weight 0, as avatar() makes them)
        scene.traverse(function (o) { var u = o.userData; if (!u || !u.mixer || !u.acts || !u.body) return; var C = CHAR[u.body]; if (!C) return;
          ["swim", "dance1", "dance2", "dance3", "dance4"].forEach(function (c) { if (u.acts[c] || !C.clips[c]) return; try { var a = u.mixer.clipAction(C.clips[c]); a.play(); a.setEffectiveWeight(0); u.acts[c] = a; } catch (e) {} });
          if (!u.acts.golf && C.clips.golf) { try { var g = u.mixer.clipAction(C.clips.golf); g.setLoop(THREE.LoopOnce, 1); g.clampWhenFinished = false; g.setEffectiveWeight(0); u.acts.golf = g; } catch (e) {} } });
        CLIPS.state = 2; return true; }, function (e) { note("clips", e); CLIPS.state = 3; });
    return CLIPS.p;
  };
  PS.clipState = function () { return CLIPS.state; };
  function clipWatch() { try { if (CLIPS.state) return; if ((typeof golf !== "undefined" && golf.playing) || (typeof SWIM !== "undefined" && SWIM.on) || (player && player.userData && player.userData.emoting)) PS.clips(); } catch (e) {} }

  function onDone() { try { if (!CLIPS.state) setTimeout(PS.clips, 4000); } catch (e) {} try { setTimeout(function () { for (var kind in RARE) PS.roomPrefetch(kind); }, 9000); } catch (e) {} try { swPrune(); } catch (e) {} }

  // ───────────────────────── persistent cache (service worker) ─────────────────────────
  function swOn() { if (!("serviceWorker" in navigator)) return false; if (Q && Q.get("sw") === "0") return false; return !!window.ASSET_V || !!(Q && Q.get("sw") === "1"); }
  function swRegister() {
    if (!swOn()) { PS.n.sw = "off"; return; }
    navigator.serviceWorker.register("/sw.js").then(function (r) { PS.n.sw = "registered"; PS.swReg = r; }, function (e) { PS.n.sw = "failed"; note("sw", e); });
    try { if (navigator.storage && navigator.storage.persist && !/Firefox/.test(navigator.userAgent)) navigator.storage.persisted().then(function (p) { if (!p) return navigator.storage.persist(); return p; }).then(function (p) { PS.n.persist = !!p; }, function () {}); } catch (e) {}
  }
  function swPrune() { if (!swOn() || !window.ASSET_V || !navigator.serviceWorker.controller) return; navigator.serviceWorker.controller.postMessage({ t: "prune", keep: window.ASSET_V }); }
  PS.swPrune = swPrune;

  function boot() {
    if (!window.PLAN_HOOKS) window.PLAN_HOOKS = { terrain: [], world: [], defer: [], frame: [], interior: [] };
    PLAN_HOOKS.frame = PLAN_HOOKS.frame || []; PLAN_HOOKS.frame.push({ name: "p2stream", fn: frameHook });
    setInterval(function () { tick(); clipWatch(); roomWatch(); }, 400);
    var emo = document.getElementById("emo"); if (emo) emo.addEventListener("click", function () { try { PS.clips(); } catch (e) {} });
    if (document.readyState === "complete") swRegister(); else window.addEventListener("load", swRegister);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
