// plan_cull.js: R21 BC culling (HANDOFF_R21_BATCH.md). Classic script, loaded after plan_perf.js and before client.js.
// Nothing here changes what is drawn on screen: a draw is skipped only when it cannot put a single pixel into the pass it belongs to.
// 1. ifr (?bcifr=0): instanced sets in the main view. Every part of an instanced kind is an InstancedMesh with frustumCulled off (the
//    client fills it with every placement in range, within 320 m in every direction), so a kind whose instances are all behind the
//    camera or off to the side was still one draw per part. A part is now skipped in the main view when none of its drawn instances'
//    bounding spheres (the union of the kind's part and LOD geometries, scaled by the instance, plus a margin for wind and morphs)
//    touches the camera frustum of that render. Census at the standard views: 25 to 32 per cent of the instanced main draws.
// 2. isf (?bcisf=0): instanced shadow casters outside the cascade's light frustum. three culls plain casters against each cascade's
//    box, but not instanced ones (frustumCulled off), so every instanced part was drawn into every cascade it reached. The same test
//    against the cascade camera of that shadow render; the box is the cascade's full caster volume (lightNear to lightFar, with the
//    CSM light margin toward the sun), so every instance that can cast into it is kept.
// Both tests run at draw time against the matrices of that very render, once per instanced set, tier and render (the parts of a
// tier share their instances), and scan at most CAP instances (a set with more is drawn). Picking, raycasts, colliders and the
// instance buffers are untouched; only the GL draw of a part that would put nothing on screen is skipped.
// ?bc=0 turns every R21 BC part off (here and in plan_batch.js). Live: PLAN_CULL.set(bool), PLAN_CULL.part(name, bool), .stats().
(function () {
  "use strict";
  var Q = location.search;
  var C = window.PLAN_CULL = { on: !/[?&]bc=0\b/.test(Q), errs: [], n: { mainSkip: 0, mainKeep: 0, shSkip: 0, shKeep: 0, tests: 0, scanned: 0, capped: 0, noSphere: 0, spheres: 0 },
    part: { ifr: !/[?&]bcifr=0\b/.test(Q), isf: !/[?&]bcisf=0\b/.test(Q) }, installed: false, CAP: 1536 };
  function note(tag, e) { try { if (C.errs.length < 20) C.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); } catch (x) {} }
  C.set = function (on) { C.on = !!on; return C.on; };
  C.setPart = function (k, on) { if (k in C.part) C.part[k] = !!on; return C.part; };
  C.stats = function () { var o = {}; for (var k in C.n) o[k] = C.n[k]; o.on = C.on; o.part = C.part; o.installed = C.installed; o.sets = SETS.length; return o; };
  if (!C.on) return;
  var GC = {};
  function G(name) { var v = GC[name]; if (v !== undefined) return v; try { v = (0, eval)(name); } catch (e) { return undefined; } if (v !== undefined && v !== null && (name === "INSTSET" || name === "renderer" || name === "scene" || name === "camera")) GC[name] = v; return v; }
  function dropped(geo) { var a = geo.attributes; for (var k in a) if (a[k] && a[k].r6free) return true; return !!(geo.index && geo.index.r6free); }
  // ── instanced sets: obj -> tier record; per set the union sphere of every part and LOD geometry, in the kind's own frame ──
  var MAP = new WeakMap(), SETS = [], seenS = new WeakSet(), SREC = new WeakMap();
  function tierArr(S, t) { return t === 0 ? S.insts : t === 1 ? S.far : S.far2; }
  function scanSets() {
    var IS = G("INSTSET"); if (!IS) return;
    for (var s = 0; s < IS.length; s++) { var S = IS[s], R = SREC.get(S); if (!R) { R = { S: S, tiers: [null, null, null], geos: new Set(), cx: 0, cy: 0, cz: 0, r: -1, bad: false, nParts: -1 }; SREC.set(S, R); SETS.push(R); }
      for (var t = 0; t < 3; t++) { var arr = tierArr(S, t); if (!arr || !arr.length) continue; var T = R.tiers[t]; if (!T || T.arr !== arr || T.len !== arr.length) { T = R.tiers[t] = { R: R, t: t, arr: arr, len: arr.length, rid: -1, v: true }; } for (var i = 0; i < arr.length; i++) if (MAP.get(arr[i]) !== T) MAP.set(arr[i], T); } }
  }
  var _s = new THREE.Sphere(), _v = new THREE.Vector3();
  function sphereOf(R) {   // union of the bounding spheres of all geometries of the set (local frame); false if any is unknown
    var S = R.S, list = [], t, i; R.geos.clear();
    for (t = 0; t < 3; t++) { var arr = tierArr(S, t); if (!arr) continue; for (i = 0; i < arr.length; i++) { var g = arr[i].geometry; if (!g || R.geos.has(g)) continue; R.geos.add(g); list.push(g); } }
    var box = new THREE.Box3(), any = false;
    for (i = 0; i < list.length; i++) { var g2 = list[i], bs = g2.boundingSphere; if (!bs) { if (dropped(g2) || !g2.attributes.position) { R.bad = true; C.n.noSphere++; return false; } g2.computeBoundingSphere(); bs = g2.boundingSphere; }
      if (!bs || !isFinite(bs.radius) || bs.radius < 0) { R.bad = true; C.n.noSphere++; return false; }
      _v.copy(bs.center).addScalar(bs.radius); box.expandByPoint(_v); _v.copy(bs.center).addScalar(-bs.radius); box.expandByPoint(_v); any = true; }
    if (!any) { R.bad = true; return false; }
    box.getBoundingSphere(_s); R.cx = _s.center.x; R.cy = _s.center.y; R.cz = _s.center.z; R.r = _s.radius * 1.15 + 1.5; R.bad = false; C.n.spheres++; return true;
  }
  // frustum planes of a camera for one render (rid), flattened for an inline test
  var _fr = new THREE.Frustum(), _pm = new THREE.Matrix4();
  function planes(cam, rid) {
    if (cam.__bcRid === rid && cam.__bcP) return cam.__bcP; var P = cam.__bcP || (cam.__bcP = new Float64Array(24));
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
    for (var i = 0; i < 6; i++) { var pl = _fr.planes[i]; P[i * 4] = pl.normal.x; P[i * 4 + 1] = pl.normal.y; P[i * 4 + 2] = pl.normal.z; P[i * 4 + 3] = pl.constant; }
    cam.__bcRid = rid; return P;
  }
  // does any of the tier's first n instances touch the frustum? (cached per tier and render)
  function anyIn(T, obj, cam, rid) {
    if (T.rid === rid) return T.v; T.rid = rid; var R = T.R; T.v = true;
    if (R.r < 0 || R.bad) { if (R.bad && R.retry && performance.now() < R.retry) return true; if (!sphereOf(R)) { R.retry = performance.now() + 5000; return true; } }
    var n = obj.count; if (!(n > 0)) { T.v = false; return false; } C.n.tests++;
    if (n > C.CAP) { C.n.capped++; return true; }
    var P = planes(cam, rid), a = obj.instanceMatrix.array, cx = R.cx, cy = R.cy, cz = R.cz, r0 = R.r;
    for (var k = 0; k < n; k++) { var b = k * 16, e0 = a[b], e1 = a[b + 1], e2 = a[b + 2], e4 = a[b + 4], e5 = a[b + 5], e6 = a[b + 6], e8 = a[b + 8], e9 = a[b + 9], e10 = a[b + 10];
      var x = e0 * cx + e4 * cy + e8 * cz + a[b + 12], y = e1 * cx + e5 * cy + e9 * cz + a[b + 13], z = e2 * cx + e6 * cy + e10 * cz + a[b + 14];
      var sc = Math.sqrt(Math.max(e0 * e0 + e1 * e1 + e2 * e2, e4 * e4 + e5 * e5 + e6 * e6, e8 * e8 + e9 * e9 + e10 * e10)), r = r0 * sc, out = false;
      for (var p = 0; p < 24; p += 4) if (P[p] * x + P[p + 1] * y + P[p + 2] * z + P[p + 3] < -r) { out = true; break; }
      if (!out) { C.n.scanned += k + 1; return true; } }
    C.n.scanned += n; T.v = false; return false;
  }
  // ── the draw wrapper (outermost: it runs before plan_perf's R6 and R19 OP wrapper, which keep their own cuts) ──
  var csmCams = new Map(), csmRef = null;
  function cascades() { var c = G("CSMX"), csm = c && c.csm; if (csm !== csmRef) { csmRef = csm; csmCams.clear(); if (csm) csm.lights.forEach(function (l, i) { csmCams.set(l.shadow.camera, i); }); } }
  function install(R) {
    if (C.installed) return; C.installed = true; var inner = R.renderBufferDirect, cam0 = G("camera"), sc0 = G("scene");
    R.renderBufferDirect = function (cam, sc, geo, mat, obj, grp) {
      if (C.on === true && obj !== null && obj !== undefined && obj.isInstancedMesh === true) { var T = MAP.get(obj);
        if (T !== undefined) {
          if (sc === null) { if (C.part.isf === true && cam.isOrthographicCamera === true) { var ci = csmCams.get(cam); if (ci !== undefined) { var rid = R.info.render.frame * 8 + ci; if (!anyIn(T, obj, cam, rid)) { C.n.shSkip++; return; } C.n.shKeep++; } } }
          else if (C.part.ifr === true && cam === cam0 && sc === sc0) { var rid2 = R.info.render.frame * 8 + 7; if (!anyIn(T, obj, cam, rid2)) { C.n.mainSkip++; return; } C.n.mainKeep++; } } }
      return inner.apply(this, arguments);
    };
  }
  var f = 0;
  var HK = window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
  HK.frame.push({ name: "bcCull", fn: function () {
    try { f++; var R = G("renderer"); if (!R || !G("camera")) return;
      if (!C.installed) { var P = window.PLAN_PERF, r6 = P && P.r6 && P.r6.d; if ((r6 && r6.installed) || !(r6 && r6.on) || f > 600) install(R); else return; }   // after R6's wrapper, so this one is outermost
      cascades(); if (f % 30 === 1) scanSets();
      // bounding spheres while the geometry arrays are still there (R6 drops them a minute after upload)
      if (f % 7 === 3) { var t0 = performance.now(); for (var i = 0; i < SETS.length && performance.now() - t0 < 1; i++) { var Rr = SETS[i]; if (Rr.r < 0 && !Rr.bad) sphereOf(Rr); else if (Rr.r >= 0 && f % 210 === 3) { var arr = Rr.S.insts; if (arr && arr.length && !Rr.geos.has(arr[0].geometry)) sphereOf(Rr); } } }
    } catch (e) { note("frame", e); } } });
  // a geometry swapped into a part (the streamer's full model replacing its proxy) gets a new sphere before its first test
  var tick = 0; setInterval(function () { if (!C.on) return; tick++; for (var i = 0; i < SETS.length; i++) { var R = SETS[i], S = R.S; if (R.r < 0) continue; for (var t = 0; t < 3; t++) { var arr = tierArr(S, t); if (!arr) continue; for (var j = 0; j < arr.length; j++) if (!R.geos.has(arr[j].geometry)) { try { sphereOf(R); } catch (e) { note("sphere", e); } t = 3; break; } } } }, 1000);
})();
