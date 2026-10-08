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
// 3. occ (?bcocc=1, off by default): occlusion of plain meshes by boxes proven to lie inside buildings (section 3 below).
// 4. hz (?bchz=0 off): terrain horizon culling of plain meshes behind the ground (section 4 below).
// ?bc=0 turns every R21 BC part off. Live: PLAN_CULL.set(bool), PLAN_CULL.setPart("ifr" | "isf", bool), PLAN_CULL.stats(),
// PLAN_CULL.occ.set(bool), PLAN_CULL.occ.hz.set(bool), PLAN_CULL.occ.stats().
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
    var bcSt = function (cam, sc, geo, mat, obj, grp) {   /* R21 T3 (HANDOFF_R21_DRAW.md): this wrapper as a stage of PLAN_PERF.rbd */
      if (C.on === true && obj !== null && obj !== undefined && obj.isInstancedMesh === true) { var T = MAP.get(obj);
        if (T !== undefined) {
          if (sc === null) { if (C.part.isf === true && cam.isOrthographicCamera === true) { var ci = csmCams.get(cam); if (ci !== undefined) { var rid = R.info.render.frame * 8 + ci; if (!anyIn(T, obj, cam, rid)) { C.n.shSkip++; return true; } C.n.shKeep++; } } }
          else if (C.part.ifr === true && cam === cam0 && sc === sc0) { var rid2 = R.info.render.frame * 8 + 7; if (!anyIn(T, obj, cam, rid2)) { C.n.mainSkip++; return true; } C.n.mainKeep++; } } }
      return false;
    }; var DXr = window.PLAN_PERF && PLAN_PERF.rbd; if (!(DXr && DXr.add && DXr.add(R, "bcInst", 30, bcSt))) R.renderBufferDirect = function (cam, sc, geo, mat, obj, grp) { if (bcSt(cam, sc, geo, mat, obj, grp) === true) return; return inner.apply(this, arguments); };
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

// ── 3. occ (?bcocc=1; off by default until proven): software occlusion culling for the main view ──
// Occluders are boxes that lie inside opaque geometry, found once per building: the building is drawn (only its opaque, non-alpha-
// tested meshes) into five small orthographic depth maps (from +X, -X, +Z, -Z and above, in its own frame), a voxel grid over its
// bounds keeps the cells that are behind an opaque surface in all five views, and the largest box made only of such cells is the
// occluder. Instanced building kinds get one box per LOD tier (each placement drawn this frame uses the box of the tier it is drawn
// with); static plain objects get one box each, or their large children do. A plain occluder is used only while every mesh it was
// built from is unchanged (same parent, material, visibility and world matrix version from P3's walk) and its whole ancestor chain
// is visible, so a door that opens or a part that moves or hides drops it in that very frame.
// Each main-view render: the largest occluder boxes on screen are rasterised into a 256 px wide inverse-depth buffer (a pixel
// counts only when the face covers all of it, and holds the farthest depth of the face over it), then each plain mesh about to be
// drawn is tested with its world box: it is skipped only when every buffer pixel its box touches (plus one pixel all round) holds
// a nearer occluder. The test uses the matrices of that render (no lag, so no popping). Not used indoors, in VR, or for an
// occluder whose box the camera is inside of or within 1 m of.
(function () {
  "use strict";
  var C = window.PLAN_CULL; if (!C || !C.on) return;
  var Q = location.search;
  var O = C.occ = { on: /[?&]bcocc=1\b/.test(Q), want: /[?&]bcocc=1\b/.test(Q), errs: [], n: { tests: 0, culled: 0, rasters: 0, occUsed: 0, capKinds: 0, capPlain: 0, boxes: 0, rejected: 0, invalid: 0, capMs: 0, solveMs: 0, rastMs: 0, testMs: 0 },
    W: 256, H: 144, tq: 0, buf: null, K: { maxBoxes: 16, maxOcc: 220, minPx: 16, range: 700, minFrac: 0, minDim: 1.5, solveMs: 3 }, kinds: [], plain: [], q: [], busy: false, last: null };
  function note(tag, e) { try { if (O.errs.length < 20) O.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); } catch (x) {} }
  var GC = {};
  function G(name) { var v = GC[name]; if (v !== undefined) return v; try { v = (0, eval)(name); } catch (e) { return undefined; } if (v !== undefined && v !== null && (name === "INSTSET" || name === "renderer" || name === "scene" || name === "camera" || name === "MODEL_SPECS")) GC[name] = v; return v; }
  O.set = function (on) { O.on = !!on; if (on) O.want = true; return O.on; };
  O.stats = function () { var o = {}; for (var k in O.n) o[k] = typeof O.n[k] === "number" ? Math.round(O.n[k] * 10) / 10 : O.n[k]; o.on = O.on; o.hz = { on: HZ.on, ok: HZ.ok, builds: HZ.n.builds, tests: HZ.n.tests, culled: HZ.n.culled, ms: Math.round(HZ.n.ms), nb: HZ.nb }; o.kinds = O.kinds.filter(function (k) { return k.ok; }).length; o.pendSolve = pendSolve.length; o.plain = O.plain.filter(function (p) { return p.st === 2; }).length; o.plainAll = O.plain.length; o.q = O.q.length; return o; };
  function dropped(geo) { var a = geo.attributes; for (var k in a) if (a[k] && a[k].r6free) return true; return !!(geo.index && geo.index.r6free); }
  function bbOf(g) { if (!g.boundingBox) { if (dropped(g)) { if (!g.boundingSphere) return null; g.boundingBox = new THREE.Box3(); g.boundingSphere.getBoundingBox(g.boundingBox); } else g.computeBoundingBox(); } return g.boundingBox; }

  // ── capture: five orthographic depth views of a subtree in its own frame, read back asynchronously ──
  var CAP = { rts: null, cam: null, mats: null, hide: null };
  function depthMat(side) { var m = new THREE.MeshDepthMaterial({ side: side }); m.onBeforeCompile = function (s) { s.fragmentShader = s.fragmentShader.replace(/\}\s*$/, "\tfloat bcQ = floor( clamp( fragCoordZ, 0.0, 1.0 ) * 65535.0 + 0.5 );\n\tgl_FragColor = vec4( floor( bcQ / 256.0 ) / 255.0, mod( bcQ, 256.0 ) / 255.0, 0.0, 1.0 );\n}"); }; m.customProgramCacheKey = function () { return "bcocc" + side; }; return m; }
  function capInit() { if (CAP.cam) return; CAP.rts = {};
    CAP.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10); CAP.cam.matrixAutoUpdate = false; CAP.cam.matrixWorldAutoUpdate = false; CAP.mats = [depthMat(THREE.FrontSide), depthMat(THREE.BackSide), depthMat(THREE.DoubleSide)]; CAP.hide = new THREE.MeshBasicMaterial({ visible: false }); }
  function capRT(N) { var rt = CAP.rts[N]; if (!rt) rt = CAP.rts[N] = new THREE.WebGLRenderTarget(N * 5, N, { type: THREE.UnsignedByteType, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false }); return rt; }
  // the five views: forward f, right r, up u (r x u = -f)
  var VIEWS = [[[-1, 0, 0], [0, 0, -1], [0, 1, 0]], [[1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 0, -1], [1, 0, 0], [0, 1, 0]], [[0, 0, 1], [-1, 0, 0], [0, 1, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, -1]]];
  var OBR = THREE.Object3D.prototype.onBeforeRender;
  function matOK(M) { return !!M && !Array.isArray(M) && M.visible !== false && !M.transparent && M.opacity >= 1 && M.depthWrite !== false && M.depthTest !== false && M.colorWrite !== false && !M.alphaHash && !(M.alphaTest > 0) && !M.alphaMap && !(M.transmission > 0) && (M.blending === undefined || M.blending === THREE.NormalBlending) && !(M.displacementMap && M.displacementScale !== 0) && !M.wireframe && !M.isShaderMaterial && !M.isRawShaderMaterial && !M.isPointsMaterial && !M.isLineBasicMaterial && !M.isSpriteMaterial; }
  function opaqueOK(o) {   // a plain mesh drawn opaque, writing depth, without cut-outs or per-draw callbacks
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh) return false; var g = o.geometry; if (!g || !g.attributes || !g.attributes.position) return false;
    if (o.onBeforeRender !== OBR) return false; if (o.morphTargetInfluences && o.morphTargetInfluences.length) return false; return matOK(o.material);
  }
  function sideOf(M) { return M.side === THREE.DoubleSide ? 2 : M.side === THREE.BackSide ? 1 : 0; }
  // root: what is drawn; toWorld: its frame; bmin, bmax: local bounds. Returns a Promise of the capture. 128 px views up to 40 m, 256 px above
  function capture(root, toWorld, bmin, bmax) {
    capInit(); var R = G("renderer"), cam = CAP.cam;
    var cx = (bmin.x + bmax.x) / 2, cy = (bmin.y + bmax.y) / 2, cz = (bmin.z + bmax.z) / 2, ex = (bmax.x - bmin.x) / 2 * 1.04 + 0.05, ey = (bmax.y - bmin.y) / 2 * 1.04 + 0.05, ez = (bmax.z - bmin.z) / 2 * 1.04 + 0.05;
    var N = Math.max(ex, ey, ez) > 20 ? 256 : 128, rt = capRT(N), E = [ex, ey, ez], ctr = [cx, cy, cz], meta = [];
    var prt = R.getRenderTarget(), ac = R.autoClear, su = R.shadowMap.autoUpdate, sn = R.shadowMap.needsUpdate, ar = R.info.autoReset, cc = new THREE.Color(), ca = R.getClearAlpha(); R.getClearColor(cc);
    var mau = root.matrixWorldAutoUpdate, Lm = new THREE.Matrix4(), Wm = new THREE.Matrix4();
    try { R.shadowMap.autoUpdate = false; R.shadowMap.needsUpdate = false; R.info.autoReset = false; R.autoClear = false; root.matrixWorldAutoUpdate = false; R.setClearColor(0x000000, 0);
      for (var v = 0; v < 5; v++) { var f = VIEWS[v][0], r = VIEWS[v][1], u = VIEWS[v][2];
        var hw = Math.abs(r[0]) * ex + Math.abs(r[1]) * ey + Math.abs(r[2]) * ez, hh = Math.abs(u[0]) * ex + Math.abs(u[1]) * ey + Math.abs(u[2]) * ez, hd = Math.abs(f[0]) * ex + Math.abs(f[1]) * ey + Math.abs(f[2]) * ez;
        var px = cx - f[0] * (hd + 1), py = cy - f[1] * (hd + 1), pz = cz - f[2] * (hd + 1);
        Lm.set(r[0], u[0], -f[0], px, r[1], u[1], -f[1], py, r[2], u[2], -f[2], pz, 0, 0, 0, 1); Wm.multiplyMatrices(toWorld, Lm);
        cam.matrixWorld.copy(Wm); cam.matrixWorldInverse.copy(Wm).invert(); cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh; cam.near = 0.5; cam.far = hd * 2 + 1.5; cam.updateProjectionMatrix();
        meta.push({ f: f, r: r, u: u, p: [px, py, pz], hw: hw, hh: hh, near: cam.near, far: cam.far });
        rt.viewport.set(v * N, 0, N, N); rt.scissor.set(v * N, 0, N, N); rt.scissorTest = true; R.setRenderTarget(rt); R.clear(true, true, false); R.render(root, cam); }
    } finally { rt.scissorTest = false; R.setRenderTarget(prt); R.autoClear = ac; R.shadowMap.autoUpdate = su; R.shadowMap.needsUpdate = sn; R.info.autoReset = ar; R.setClearColor(cc, ca); root.matrixWorldAutoUpdate = mau; }
    var buf = new Uint8Array(N * 5 * N * 4);
    return R.readRenderTargetPixelsAsync(rt, 0, 0, N * 5, N, buf).then(function () { return { buf: buf, meta: meta, ctr: ctr, E: E, N: N }; });
  }
  // the solve (a generator, stepped a few ms a frame): hidden voxels (behind an opaque surface in all five views), then up to
  // K.maxBoxes boxes made only of hidden voxels, each grown from the most interior voxel left (a distance transform) and taken out
  // of the set before the next
  function axisOf(a) { return a[0] !== 0 ? 0 : a[1] !== 0 ? 1 : 2; }
  function* solveGen(cap) {
    var N = cap.N, buf = cap.buf, meta = cap.meta, ctr = cap.ctr, E = cap.E, vs = Math.min(2.5, Math.max(0.4, Math.max(E[0], E[1], E[2]) * 2 / 96));
    var Mv = [Math.max(2, Math.min(128, Math.ceil(2 * E[0] / vs))), Math.max(2, Math.min(128, Math.ceil(2 * E[1] / vs))), Math.max(2, Math.min(128, Math.ceil(2 * E[2] / vs)))];
    var lo = [ctr[0] - E[0], ctr[1] - E[1], ctr[2] - E[2]], sz = [2 * E[0] / Mv[0], 2 * E[1] / Mv[1], 2 * E[2] / Mv[2]];
    // per view, a table over the voxel columns of its two plane axes: the surface position farthest from that camera among the pixels
    // overlapping the column, measured along -f (larger: nearer the camera); -Infinity where any of those pixels is a hole
    var tabs = [];
    for (var v = 0; v < 5; v++) { var m = meta[v], f = m.f, r = m.r, u = m.u, ar = axisOf(r), au = axisOf(u), af = axisOf(f), sr = r[ar], su = u[au], sf = f[af], MA = Mv[ar], MB = Mv[au];
      var T = new Float64Array(MA * MB).fill(Infinity);
      for (var j = 0; j < N; j++) { for (var i = 0; i < N; i++) { var o = (j * N * 5 + v * N + i) * 4, val;
          var xa0 = -m.hw + 2 * m.hw * i / N, xa1 = -m.hw + 2 * m.hw * (i + 1) / N, ya0 = -m.hh + 2 * m.hh * j / N, ya1 = -m.hh + 2 * m.hh * (j + 1) / N;
          var la0 = m.p[ar] + sr * (sr > 0 ? xa0 : xa1), la1 = m.p[ar] + sr * (sr > 0 ? xa1 : xa0), lu0 = m.p[au] + su * (su > 0 ? ya0 : ya1), lu1 = m.p[au] + su * (su > 0 ? ya1 : ya0);
          if (buf[o + 3] > 127) { var d = (buf[o] * 256 + buf[o + 1]) / 65535, dist = m.near + d * (m.far - m.near); val = -sf * (m.p[af] + sf * dist); } else val = -Infinity;
          var i0 = Math.max(0, Math.floor((la0 - lo[ar]) / sz[ar])), i1 = Math.min(MA - 1, Math.floor((la1 - lo[ar]) / sz[ar] - 1e-9)), k0 = Math.max(0, Math.floor((lu0 - lo[au]) / sz[au])), k1 = Math.min(MB - 1, Math.floor((lu1 - lo[au]) / sz[au] - 1e-9));
          for (var a = i0; a <= i1; a++) for (var b = k0; b <= k1; b++) { var q = a * MB + b; if (val < T[q]) T[q] = val; } }
        if ((j & 31) === 31) yield 0; }
      tabs.push({ T: T, ar: ar, au: au, af: af, sf: sf, MB: MB }); }
    var X = Mv[0], Y = Mv[1], Z = Mv[2], YZ = Y * Z, V = X * YZ, H = new Uint8Array(V), nH = 0, c = [0, 0, 0];
    for (var x = 0; x < X; x++) { for (var y = 0; y < Y; y++) for (var z = 0; z < Z; z++) { c[0] = x; c[1] = y; c[2] = z; var ok = true;
        for (var w = 0; w < 5; w++) { var tb = tabs[w], s = tb.T[c[tb.ar] * tb.MB + c[tb.au]]; if (s === -Infinity) { ok = false; break; }
          var near = tb.sf < 0 ? (lo[tb.af] + (c[tb.af] + 1) * sz[tb.af]) : -(lo[tb.af] + c[tb.af] * sz[tb.af]); if (near > s + 1e-6) { ok = false; break; } }   // the voxel's face nearest that camera, measured the same way
        if (ok) { H[x * YZ + y * Z + z] = 1; nH++; } }
      if ((x & 7) === 7) yield 0; }
    if (nH < 8) { O.n.rejHidden = (O.n.rejHidden || 0) + 1; return []; }
    var D = new Uint16Array(V), boxes = [], minVox = Math.max(1, Math.ceil(O.K.minDim / Math.max(sz[0], sz[1], sz[2]))), b0 = [0, 0, 0], b1 = [0, 0, 0];
    function slabOK(ax, at) { var A = (ax + 1) % 3, B = (ax + 2) % 3; for (var p = b0[A]; p <= b1[A]; p++) for (var q2 = b0[B]; q2 <= b1[B]; q2++) { c[ax] = at; c[A] = p; c[B] = q2; if (!H[c[0] * YZ + c[1] * Z + c[2]]) return false; } return true; }
    for (var nb = 0; nb < O.K.maxBoxes; nb++) {
      // L1 distance to the nearest non-hidden voxel (or the grid edge): a forward and a backward sweep
      var k, best = 0, seed = -1;
      for (x = 0; x < X; x++) for (y = 0; y < Y; y++) for (z = 0; z < Z; z++) { k = x * YZ + y * Z + z; if (!H[k]) { D[k] = 0; continue; } var dv = Math.min(x > 0 ? D[k - YZ] : 0, y > 0 ? D[k - Z] : 0, z > 0 ? D[k - 1] : 0) + 1; D[k] = dv; }
      yield 0;
      for (x = X - 1; x >= 0; x--) for (y = Y - 1; y >= 0; y--) for (z = Z - 1; z >= 0; z--) { k = x * YZ + y * Z + z; if (!H[k]) continue; var dw = Math.min(D[k], (x < X - 1 ? D[k + YZ] : 0) + 1, (y < Y - 1 ? D[k + Z] : 0) + 1, (z < Z - 1 ? D[k + 1] : 0) + 1); D[k] = dw; if (dw > best) { best = dw; seed = k; } }
      yield 0;
      if (seed < 0 || best * 2 - 1 < minVox) break;
      b0[0] = b1[0] = Math.floor(seed / YZ); b0[1] = b1[1] = Math.floor(seed / Z) % Y; b0[2] = b1[2] = seed % Z;
      for (var g = 0; g < X + Y + Z; g++) { var bestA = -1, bestS = 0, bestArea = -1;
        for (var ax = 0; ax < 3; ax++) { var A2 = (ax + 1) % 3, B2 = (ax + 2) % 3, area = (b1[A2] - b0[A2] + 1) * (b1[B2] - b0[B2] + 1);
          if (area > bestArea && b0[ax] > 0 && slabOK(ax, b0[ax] - 1)) { bestArea = area; bestA = ax; bestS = -1; }
          if (area > bestArea && b1[ax] < Mv[ax] - 1 && slabOK(ax, b1[ax] + 1)) { bestArea = area; bestA = ax; bestS = 1; } }
        if (bestA < 0) break; if (bestS < 0) b0[bestA]--; else b1[bestA]++; }
      for (x = b0[0]; x <= b1[0]; x++) for (y = b0[1]; y <= b1[1]; y++) for (z = b0[2]; z <= b1[2]; z++) H[x * YZ + y * Z + z] = 0;   // taken out of the set
      var mn = new THREE.Vector3(), mx = new THREE.Vector3(); for (ax = 0; ax < 3; ax++) { var l0 = lo[ax] + b0[ax] * sz[ax], l1 = lo[ax] + (b1[ax] + 1) * sz[ax], sh = (l1 - l0) * 0.02 + 0.03; mn.setComponent(ax, l0 + sh); mx.setComponent(ax, l1 - sh); }
      var dx = mx.x - mn.x, dy = mx.y - mn.y, dz = mx.z - mn.z; if (dx < O.K.minDim || dy < O.K.minDim || dz < O.K.minDim || dx * dy * dz < 20 || (dx < 3 ? 1 : 0) + (dy < 3 ? 1 : 0) + (dz < 3 ? 1 : 0) > 1) { if (!boxes.length) O.n.rejDim = (O.n.rejDim || 0) + 1; continue; }   /* each box: 1.5 m or more on every side, 3 m or more on two, 20 m3 */
      boxes.push({ min: mn, max: mx }); yield 0; }
    var full = 8 * E[0] * E[1] * E[2], vol = 0; for (k = 0; k < boxes.length; k++) { var B3 = boxes[k]; vol += (B3.max.x - B3.min.x) * (B3.max.y - B3.min.y) * (B3.max.z - B3.min.z); }
    if (!boxes.length || vol < full * O.K.minFrac) { O.n.rejFrac = (O.n.rejFrac || 0) + 1; return []; }
    boxes.frac = +(vol / full).toFixed(3); return boxes;
  }
  // ── occluder sources ──
  var _I = new THREE.Matrix4(), _bb = new THREE.Box3(), _wb = new THREE.Box3(), _v3 = new THREE.Vector3(), _m4 = new THREE.Matrix4();
  function kindOK(S) { var SP = G("MODEL_SPECS"), sp = SP && SP[S.kind]; if (!sp || sp.prop || sp.vehicle) return false; return S.h >= 3 && S.rad >= 3; }
  function tiersOf(S) { return [S.insts, S.far, S.far2]; }
  function kindCapture(S, t) {   // tier t of an instanced kind: its opaque parts, in the kind's frame
    var arr = tiersOf(S)[t]; if (!arr || !arr.length) return null; var g = new THREE.Group(), box = new THREE.Box3(), n = 0;
    for (var i = 0; i < arr.length; i++) { var im = arr[i], geo = im.geometry; if (!geo || !geo.attributes || !geo.attributes.position) continue; var gb = bbOf(geo); if (!gb) return null; box.union(gb);
      if (!matOK(im.material) || im.onBeforeRender !== OBR) continue; var me = new THREE.Mesh(geo, CAP.mats[sideOf(im.material)]); me.frustumCulled = false; g.add(me); n++; }
    if (!n || box.isEmpty()) return null; g.updateMatrixWorld(true); return { root: g, box: box, geos: arr.map(function (m) { return m.geometry; }), mats: arr.map(function (m) { return m.material; }) };
  }
  function scanKinds() { var IS = G("INSTSET"); if (!IS) return; for (var s = 0; s < IS.length; s++) { var S = IS[s]; if (S.__bcK) continue; S.__bcK = true; if (!kindOK(S)) continue; var K = { S: S, tiers: [null, null, null], ok: false }; O.kinds.push(K); for (var t = 0; t < 3; t++) O.q.push({ k: K, t: t, at: 0 }); } }
  // plain occluders: static objects of the scene (or their large children)
  var NOPL = /^(perf|player|avatar|crowd|npc|people|ride|cart|shuttle|op ism|bc )/i;   /* R6's static batches ("r6 batch") are good occluders: kept */
  function worldBox(o, out) { out.makeEmpty(); var ok = true; o.updateWorldMatrix(true, false); o.traverseVisible(function (q) { if (!ok) return; if (q.isSkinnedMesh || q.isBone) { ok = false; return; } if (!q.isMesh || q.isInstancedMesh) return; var g = q.geometry; if (!g || !g.attributes || !g.attributes.position) return; var gb = bbOf(g); if (!gb) return; _bb.copy(gb).applyMatrix4(q.matrixWorld); out.union(_bb); }); return ok && !out.isEmpty(); }
  function plainCands(o, depth, out) {
    if (!o.visible || o.isLight || o.isCamera || o.isBone || o.isSkinnedMesh || o.isPoints || o.isLine || o.isSprite || o.isInstancedMesh || NOPL.test(o.name || "")) return; var ud = o.userData || {}; if (ud.ride || ud.walk || ud.anim || ud.spin || ud.sway || ud.interior || ud.noOcc || ud.door) return;
    if (!worldBox(o, _wb)) return; var s = _wb.getSize(_v3), big = Math.max(s.x, s.z); if (s.y < 2.5 || big < 5 || Math.min(s.x, s.z) < 1.5) return;
    if (!o.isMesh && (big > 140 || o.children.length > 300) && depth < 3) { for (var i = 0; i < o.children.length; i++) plainCands(o.children[i], depth + 1, out); return; }
    if (big > 420) return;   /* the ground, the terrain and other site-wide meshes */
    if (KNOWN.has(o)) return; if (o.isMesh && !opaqueOK(o)) return; out.push(o);
  }
  // every top-level object is looked at again every few seconds (a round of at most 2 ms a frame): objects shown later (groups the
  // client shows by distance) and meshes added later (R6's static batches) become candidates then
  var KNOWN = new WeakSet(), LAST = new WeakMap(), scanI = 0;
  function addPlain(o, depth, at) { if (KNOWN.has(o)) return; KNOWN.add(o); var P = { o: o, st: 0, tries: 0, at: at, depth: depth, sig: null }; O.plain.push(P); O.q.push({ p: P }); }
  function scanPlain() { var sc = G("scene"); if (!sc) return; var ch = sc.children, now = performance.now(), t0 = now, n = 0;
    while (n < ch.length && performance.now() - t0 < 2) { if (scanI >= ch.length) scanI = 0; var o = ch[scanI++]; n++; if (o.visible !== true) continue; var ls = LAST.get(o); if (ls !== undefined && now - ls < 10000) continue; LAST.set(o, now); var L = []; try { plainCands(o, 0, L); } catch (e) { note("cands", e); } for (var j = 0; j < L.length; j++) addPlain(L[j], 0, now + 6000); } }
  function plainSig(o) {   // the meshes a plain occluder is built from, and what must stay the same
    var L = []; o.traverseVisible(function (q) { if (opaqueOK(q)) L.push(q); });
    var MW = window.PLAN_PERF && PLAN_PERF.mw, wv = new Float64Array(L.length), par = new Array(L.length), mat = new Array(L.length), geo = new Array(L.length), pv = new Float64Array(L.length);
    for (var i = 0; i < L.length; i++) { var q = L[i]; wv[i] = MW && MW.WV && q.id < MW.cap ? MW.WV[q.id] : NaN; par[i] = q.parent; mat[i] = q.material; geo[i] = q.geometry; pv[i] = q.geometry.attributes.position.version; }
    var anc = [], p = o; while (p) { anc.push(p); p = p.parent; }
    var inner = new Set(); for (i = 0; i < L.length; i++) { var a = L[i]; while (a && a !== o) { inner.add(a); a = a.parent; } }   // every object between a member mesh and the root must stay visible
    return { L: L, wv: wv, par: par, mat: mat, geo: geo, pv: pv, anc: anc, inner: Array.from(inner), rootWV: MW && MW.WV && o.id < MW.cap ? MW.WV[o.id] : NaN };
  }
  function plainValid(P, sc) {   // 0: unchanged since its capture and drawn; 1: unchanged but not drawn now (hidden); 2: changed
    var s = P.sig, MW = window.PLAN_PERF && PLAN_PERF.mw; if (!s || !MW || !MW.WV) return 2;   /* no P3 walk versions (?p3=0): no plain occluders */
    var anc = s.anc; if (anc[anc.length - 1] !== sc) return 2; var o = P.o, wv = MW.WV; if (o.id >= MW.cap || wv[o.id] !== s.rootWV) return 2;
    var L = s.L; for (var i = 0; i < L.length; i++) { var q = L[i], M = q.material; if (q.parent !== s.par[i] || M !== s.mat[i] || q.geometry !== s.geo[i] || q.geometry.attributes.position.version !== s.pv[i] || M.transparent === true || M.visible === false || M.opacity < 1) return 2; if (q.id >= MW.cap || wv[q.id] !== s.wv[i]) return 2; }
    for (var a = 0; a < anc.length; a++) if (anc[a].visible !== true) return 1;
    var IN = s.inner; for (a = 0; a < IN.length; a++) if (IN[a].visible !== true) return 1;
    return 0;
  }
  function plainCapture(P) {   // swaps every drawable of the subtree to the depth materials (or hides it) for the capture; the caller swaps back
    var o = P.o, sc = G("scene"), r = o; while (r.parent) r = r.parent; if (r !== sc || !o.visible) return null;
    o.updateWorldMatrix(true, true); var inv = new THREE.Matrix4().copy(o.matrixWorld).invert(), box = new THREE.Box3(), swaps = [], n = 0;
    o.traverse(function (q) { if (!(q.isMesh || q.isPoints || q.isLine || q.isSprite) || !q.material) return; var ok = opaqueOK(q);
      if (ok) { var gb = bbOf(q.geometry); if (gb) { _bb.copy(gb).applyMatrix4(_m4.multiplyMatrices(inv, q.matrixWorld)); box.union(_bb); n++; } else ok = false; }
      swaps.push([q, q.material]); q.material = ok ? CAP.mats[sideOf(q.material)] : CAP.hide; });
    if (!n) { for (var i = 0; i < swaps.length; i++) swaps[i][0].material = swaps[i][1]; return null; }
    return { swaps: swaps, box: box, toWorld: o.matrixWorld.clone() };
  }
  var pendSolve = [];
  function capStep() {
    if (O.busy || !O.q.length) return; var t0 = performance.now(), job = O.q[0], now = t0;
    if ((job.p && now < job.p.at) || (job.at && now < job.at)) { O.q.push(O.q.shift()); return; } O.q.shift();
    try { capInit();
      if (job.k) { var K = job.k, kc = kindCapture(K.S, job.t); if (!kc) return; O.busy = true; O.n.capKinds++;
        capture(kc.root, _I, kc.box.min, kc.box.max).then(function (cp) { pendSolve.push({ g: solveGen(cp), done: function (b) { if (b.length) { K.tiers[job.t] = { boxes: b, geos: kc.geos, mats: kc.mats }; K.ok = true; O.n.boxes += b.length; } else O.n.rejected++; } }); }, function (e) { note("read kind", e); }).then(function () { O.busy = false; }); }
      else if (job.p) { var P = job.p; if (P.st === 3) return; var pc = plainCapture(P); if (!pc) { P.st = 3; return; } var pr; O.busy = true;
        try { pr = capture(P.o, pc.toWorld, pc.box.min, pc.box.max); } catch (e) { O.busy = false; throw e; } finally { for (var i = 0; i < pc.swaps.length; i++) pc.swaps[i][0].material = pc.swaps[i][1]; }
        P.sig = plainSig(P.o); P.st = 1; O.n.capPlain++;
        pr.then(function (cp) { pendSolve.push({ g: solveGen(cp), done: function (b) { if (P.st !== 1) return; if (b.length) { P.boxes = b; P.st = 2; O.n.boxes += b.length; return; } P.st = 3; O.n.rejected++;
            var ch = P.o.children; if (ch.length && ch.length <= 300 && P.depth < 3) for (var j = 0; j < ch.length; j++) { var L = []; plainCands(ch[j], 3, L); for (var q = 0; q < L.length; q++) addPlain(L[q], P.depth + 1, 0); } } }); }, function (e) { note("read plain", e); P.st = 3; }).then(function () { O.busy = false; }); }
    } catch (e) { O.busy = false; note("capture", e); }
    O.n.capMs += performance.now() - t0;
  }
  // ── the raster ──
  var _pv = new THREE.Matrix4(), _mm = new THREE.Matrix4(), CL = new Float64Array(32), PX = new Float64Array(40);
  var FACES = [[0, 1, 3, 2, 0, -1], [4, 6, 7, 5, 0, 1], [0, 4, 5, 1, 1, -1], [2, 3, 7, 6, 1, 1], [0, 2, 6, 4, 2, -1], [1, 5, 7, 3, 2, 1]];   // corner = x*4 + y*2 + z; [a, b, c, d, axis, sign]
  function corners(mn, mx, m, out) { var e = m.elements; for (var i = 0; i < 8; i++) { var x = (i & 4) ? mx.x : mn.x, y = (i & 2) ? mx.y : mn.y, z = (i & 1) ? mx.z : mn.z, o = i * 4; out[o] = e[0] * x + e[4] * y + e[8] * z + e[12]; out[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; out[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; out[o + 3] = e[3] * x + e[7] * y + e[11] * z + e[15]; } }
  function tri(B, W, H, x0, y0, w0, x1, y1, w1, x2, y2, w2) {
    var area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0); if (area > -1e-9 && area < 1e-9) return; if (area < 0) { var t; t = x1; x1 = x2; x2 = t; t = y1; y1 = y2; y2 = t; t = w1; w1 = w2; w2 = t; area = -area; }
    var a = ((w1 - w0) * (y2 - y0) - (w2 - w0) * (y1 - y0)) / area, b = ((w2 - w0) * (x1 - x0) - (w1 - w0) * (x2 - x0)) / area, c = w0 - a * x0 - b * y0, sl = 0.5 * (Math.abs(a) + Math.abs(b));
    // edge functions, positive inside (counter-clockwise), each lowered by its largest change over half a pixel: inner coverage only
    var A0 = -(y1 - y0), B0 = x1 - x0, C0 = -(A0 * x0 + B0 * y0), A1 = -(y2 - y1), B1 = x2 - x1, C1 = -(A1 * x1 + B1 * y1), A2 = -(y0 - y2), B2 = x0 - x2, C2 = -(A2 * x2 + B2 * y2);
    var m0 = 0.5 * (Math.abs(A0) + Math.abs(B0)), m1 = 0.5 * (Math.abs(A1) + Math.abs(B1)), m2 = 0.5 * (Math.abs(A2) + Math.abs(B2));
    var xa = Math.max(0, Math.floor(Math.min(x0, x1, x2))), xb = Math.min(W - 1, Math.floor(Math.max(x0, x1, x2))), ya = Math.max(0, Math.floor(Math.min(y0, y1, y2))), yb = Math.min(H - 1, Math.floor(Math.max(y0, y1, y2)));
    for (var py = ya; py <= yb; py++) { var cy = py + 0.5, row = py * W, cx = xa + 0.5; var e0 = A0 * cx + B0 * cy + C0 - m0, e1 = A1 * cx + B1 * cy + C1 - m1, e2 = A2 * cx + B2 * cy + C2 - m2, wv = a * cx + b * cy + c - sl;
      for (var px = xa; px <= xb; px++) { if (e0 >= 0 && e1 >= 0 && e2 >= 0 && wv > B[row + px]) B[row + px] = wv; e0 += A0; e1 += A1; e2 += A2; wv += a; } }
  }
  // a whole (convex, clipped) face at once: no lost pixels along the diagonal a split into two triangles would cost with inner coverage
  var EA = new Float64Array(8), EB = new Float64Array(8), EC = new Float64Array(8), EM = new Float64Array(8);
  function poly(B, W, H, n) {
    if (n > 8) return false; var area = 0, i, j; for (i = 0; i < n; i++) { j = (i + 1) % n; area += PX[i * 3] * PX[j * 3 + 1] - PX[j * 3] * PX[i * 3 + 1]; } if (area > -1e-6 && area < 1e-6) return true; var sg = area > 0 ? 1 : -1;
    // the depth plane (1/w is affine in screen space for a planar face) from the vertex triple with the largest area
    var best = 0, ia = 0, ib = 1, ic = 2; for (i = 1; i < n - 1; i++) { var ar = (PX[i * 3] - PX[0]) * (PX[(i + 1) * 3 + 1] - PX[1]) - (PX[(i + 1) * 3] - PX[0]) * (PX[i * 3 + 1] - PX[1]); if (Math.abs(ar) > Math.abs(best)) { best = ar; ib = i; ic = i + 1; } }
    if (Math.abs(best) < 1e-6) return true; var x0 = PX[ia * 3], y0 = PX[ia * 3 + 1], w0 = PX[ia * 3 + 2], x1 = PX[ib * 3], y1 = PX[ib * 3 + 1], w1 = PX[ib * 3 + 2], x2 = PX[ic * 3], y2 = PX[ic * 3 + 1], w2 = PX[ic * 3 + 2];
    var a = ((w1 - w0) * (y2 - y0) - (w2 - w0) * (y1 - y0)) / best, b = ((w2 - w0) * (x1 - x0) - (w1 - w0) * (x2 - x0)) / best, c = w0 - a * x0 - b * y0, sl = 0.5 * (Math.abs(a) + Math.abs(b));
    var xmn = 1e9, xmx = -1e9, ymn = 1e9, ymx = -1e9;
    for (i = 0; i < n; i++) { j = (i + 1) % n; var xi = PX[i * 3], yi = PX[i * 3 + 1], xj = PX[j * 3], yj = PX[j * 3 + 1]; EA[i] = -(yj - yi) * sg; EB[i] = (xj - xi) * sg; EC[i] = -(EA[i] * xi + EB[i] * yi); EM[i] = 0.5 * (Math.abs(EA[i]) + Math.abs(EB[i]));
      if (xi < xmn) xmn = xi; if (xi > xmx) xmx = xi; if (yi < ymn) ymn = yi; if (yi > ymx) ymx = yi; }
    var xa = Math.max(0, Math.floor(xmn)), xb = Math.min(W - 1, Math.floor(xmx)), ya = Math.max(0, Math.floor(ymn)), yb = Math.min(H - 1, Math.floor(ymx));
    for (var py = ya; py <= yb; py++) { var cy = py + 0.5, row = py * W;
      for (var px = xa; px <= xb; px++) { var cx = px + 0.5, inn = true; for (i = 0; i < n; i++) if (EA[i] * cx + EB[i] * cy + EC[i] - EM[i] < 0) { inn = false; break; }
        if (inn) { var wv = a * cx + b * cy + c - sl; if (wv > B[row + px]) B[row + px] = wv; } } }
    return true;
  }
  function rastBox(B, W, H, mn, mx, mw, cl) {   // cl: the camera position in the box's frame (faces turned away are skipped)
    _mm.multiplyMatrices(_pv, mw); corners(mn, mx, _mm, CL);
    for (var f = 0; f < 6; f++) { var F = FACES[f], ax = F[4], sg = F[5], fc = sg > 0 ? (ax === 0 ? mx.x : ax === 1 ? mx.y : mx.z) : (ax === 0 ? mn.x : ax === 1 ? mn.y : mn.z), cc = cl[ax];
      if ((cc - fc) * sg <= 0) continue;
      var n = 0; for (var k = 0; k < 4; k++) { var ia = F[k] * 4, ib = F[(k + 1) & 3] * 4, da = CL[ia + 2] + CL[ia + 3], db = CL[ib + 2] + CL[ib + 3];   // clipped against the near plane (z + w >= 0)
        if (da >= 0) { PX[n * 3] = CL[ia]; PX[n * 3 + 1] = CL[ia + 1]; PX[n * 3 + 2] = CL[ia + 3]; n++; }
        if ((da >= 0) !== (db >= 0)) { var t = da / (da - db); PX[n * 3] = CL[ia] + (CL[ib] - CL[ia]) * t; PX[n * 3 + 1] = CL[ia + 1] + (CL[ib + 1] - CL[ia + 1]) * t; PX[n * 3 + 2] = CL[ia + 3] + (CL[ib + 3] - CL[ia + 3]) * t; n++; } }
      if (n < 3) continue; for (k = 0; k < n; k++) { var w = Math.max(1e-6, PX[k * 3 + 2]); PX[k * 3] = (PX[k * 3] / w * 0.5 + 0.5) * W; PX[k * 3 + 1] = (PX[k * 3 + 1] / w * 0.5 + 0.5) * H; PX[k * 3 + 2] = 1 / w; }
      if (!poly(B, W, H, n)) for (k = 1; k < n - 1; k++) tri(B, W, H, PX[0], PX[1], PX[2], PX[k * 3], PX[k * 3 + 1], PX[k * 3 + 2], PX[(k + 1) * 3], PX[(k + 1) * 3 + 1], PX[(k + 1) * 3 + 2]); }
  }
  var _inv = new THREE.Matrix4(), _cp = new THREE.Vector3(), _ctr = new THREE.Vector3(), _fw = new THREE.Vector3(), CAND = [], POOL = [];
  function addCand(mn, mx, mw, cam, K) {
    _ctr.set((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2).applyMatrix4(mw); var e = mw.elements, sc = Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
    var rad = 0.5 * Math.hypot(mx.x - mn.x, mx.y - mn.y, mx.z - mn.z) * sc, d = _ctr.distanceTo(cam.position); if (d > O.K.range + rad) return;
    var px = rad / Math.max(d, 1) * K; if (px < O.K.minPx) return;
    if ((_ctr.x - cam.position.x) * _fw.x + (_ctr.y - cam.position.y) * _fw.y + (_ctr.z - cam.position.z) * _fw.z < -rad) return;   // behind the camera
    _inv.copy(mw).invert(); _cp.copy(cam.position).applyMatrix4(_inv); var m1 = 1 / Math.max(sc, 1e-6);
    if (_cp.x > mn.x - m1 && _cp.x < mx.x + m1 && _cp.y > mn.y - m1 && _cp.y < mx.y + m1 && _cp.z > mn.z - m1 && _cp.z < mx.z + m1) return;   // the camera inside or within 1 m
    var c = POOL[CAND.length] || (POOL[CAND.length] = { px: 0, mn: null, mx: null, mw: new THREE.Matrix4(), cl: [0, 0, 0] }); c.px = px; c.mn = mn; c.mx = mx; c.mw.copy(mw); c.cl[0] = _cp.x; c.cl[1] = _cp.y; c.cl[2] = _cp.z; CAND.push(c);
  }
  var _imw = new THREE.Matrix4();
  function build(cam, R) {
    var t0 = performance.now(), asp = R.domElement.width / Math.max(1, R.domElement.height); O.H = Math.max(32, Math.min(256, Math.round(O.W / asp)));
    var n = O.W * O.H; if (!O.buf || O.buf.length !== n) O.buf = new Float32Array(n); var B = O.buf; B.fill(0);
    _pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fw.set(0, 0, -1).applyQuaternion(cam.quaternion); var K = (R.domElement.height / 2) / Math.tan(cam.fov * Math.PI / 360); CAND.length = 0; var sc = G("scene");
    for (var i = 0; i < O.kinds.length; i++) { var Kd = O.kinds[i]; if (!Kd.ok) continue; var S = Kd.S, arrs = tiersOf(S), cnts = [S.n, S.nf, S.nf2], idxs = [S.idx, S.idxF, S.idxF2];
      for (var t = 0; t < 3; t++) { var T = Kd.tiers[t], arr = arrs[t]; if (!T || !arr || !arr.length || !(cnts[t] > 0) || !idxs[t]) continue; if (arr[0].visible !== true || arr[0].parent !== sc) continue;
        var same = arr.length === T.geos.length; for (var p = 0; same && p < arr.length; p++) if (arr[p].geometry !== T.geos[p] || arr[p].material !== T.mats[p]) same = false;
        if (!same) { Kd.tiers[t] = null; O.n.invalid++; O.q.push({ k: Kd, t: t, at: performance.now() + 3000 }); continue; }
        var ix = idxs[t], Mt = S.mats, Bx = T.boxes; for (var k = 0; k < cnts[t]; k++) { _imw.fromArray(Mt, ix[k] * 16); for (var bi = 0; bi < Bx.length; bi++) addCand(Bx[bi].min, Bx[bi].max, _imw, cam, K); } } }
    for (i = 0; i < O.plain.length; i++) { var P = O.plain[i]; if (P.st !== 2) continue; var pv = plainValid(P, sc); if (pv === 1) continue; if (pv === 2) { P.st = 0; P.tries++; O.n.invalid++; if (P.tries < 4) { P.at = performance.now() + 8000; O.q.push({ p: P }); } else P.st = 3; continue; } for (var bj = 0; bj < P.boxes.length; bj++) addCand(P.boxes[bj].min, P.boxes[bj].max, P.o.matrixWorld, cam, K); }
    CAND.sort(function (a, b) { return b.px - a.px; }); var m = Math.min(CAND.length, O.K.maxOcc);
    for (i = 0; i < m; i++) { var c = CAND[i]; rastBox(B, O.W, O.H, c.mn, c.mx, c.mw, c.cl); }
    O.n.occUsed = m; O.n.rasters++; O.n.rastMs += performance.now() - t0; O.last = { m: m, cand: CAND.length, ms: +(performance.now() - t0).toFixed(2) };
  }
  // occludee test: the mesh's world box against the buffer
  var CB = new Float64Array(32);
  function occluded(obj, geo) {
    var bb = geo.boundingBox; if (!bb) { if (geo.boundingSphere) { bb = geo.__bcBB || (geo.__bcBB = new THREE.Box3()); geo.boundingSphere.getBoundingBox(bb); } else if (!dropped(geo) && geo.attributes && geo.attributes.position) { geo.computeBoundingBox(); bb = geo.boundingBox; } else return false; }
    if (!bb || bb.isEmpty()) return false;
    _mm.multiplyMatrices(_pv, obj.matrixWorld); corners(bb.min, bb.max, _mm, CB); var W = O.W, H = O.H, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, iw = 0;
    for (var i = 0; i < 8; i++) { var o = i * 4, w = CB[o + 3]; if (CB[o + 2] + w < 0 || w < 1e-3) return false; var sx = (CB[o] / w * 0.5 + 0.5) * W, sy = (CB[o + 1] / w * 0.5 + 0.5) * H; if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy; if (1 / w > iw) iw = 1 / w; }
    var xa = Math.max(0, Math.floor(x0) - 1), xb = Math.min(W - 1, Math.floor(x1) + 1), ya = Math.max(0, Math.floor(y0) - 1), yb = Math.min(H - 1, Math.floor(y1) + 1); if (xa > xb || ya > yb) return false;
    var lim = iw * 1.0005 + 1e-7, B = O.buf; for (var py = ya; py <= yb; py++) { var row = py * W; for (var px = xa; px <= xb; px++) if (B[row + px] <= lim) return false; }
    return true;
  }
  O.occluded = occluded; O.build = build; O._t = { capture: capture, solve: function (cp) { var g = solveGen(cp), r; do { r = g.next(); } while (!r.done); return r.value; }, plainCapture: plainCapture, kindCapture: kindCapture, plainValid: plainValid };   // tests
  // ── wiring: wraps the draw outside plan_cull's instanced wrapper ──
  // ── 4. hz (?bchz=0 off): terrain horizon culling for the main view ──
  // The ground is a height grid (the client's ground mesh, read from its own vertices) and the camera stands above it, so terrain
  // occlusion is a 2.5D question. For 1-degree azimuth bins across the view (plus a margin) and sample distances out to 3 km (5 per
  // cent apart): every ray of a bin crosses the bin's arc at that distance, the ground there is at least the lowest vertex of the grid
  // cells under the arc (a min-mip of the vertex heights), so (that height - eye height) / distance is an elevation at which every ray
  // of the bin is sure to meet the ground; a running maximum gives the horizon in front of each distance. Rebuilt when the camera
  // moves (about 0.7 ms), reused while it only turns. A mesh is skipped only when, in every bin its world box spans, the horizon in
  // front of the box's nearest point is above the box's highest possible elevation: every ray to every point of it meets the ground
  // first. Never culled: meshes drawn without a depth test, meshes whose bounds three does not trust either (frustumCulled off, a
  // per-draw callback, shader-placed, module shader hooks, morph targets), anything within 4 m, and nothing at all with the camera
  // below the ground, off the ground grid, in a tunnel, indoors or in VR. ?bchz=0 turns it off.
  var HZ = O.hz = { on: !/[?&]bchz=0\b/.test(Q), n: { builds: 0, tests: 0, culled: 0, ms: 0, testMs: 0 }, NB: 360, ring: null, NR: 0, Hc: null, b0: 0, nb: 0, ok: false, mesh: null, grids: [null, null], ver: 0, cam: new Float64Array(8), last: null };
  (function () { var r = [4]; while (r[r.length - 1] < 3000) r.push(r[r.length - 1] * 1.07 + 0.5); HZ.ring = new Float64Array(r); HZ.NR = r.length; })();   // sample distances (about 90)
  HZ.set = function (on) { HZ.on = !!on; return HZ.on; };
  // the height grids: the client's ground mesh (grid T) and the region ground around it (grid TR, drawn 3 m lower under and beyond it),
  // each read from its own mesh's vertices into a min-mip (rebuilt when the mesh or its positions change)
  function hzGrid(slot, Tg, mat) {
    var sc = G("scene"); if (!Tg || !mat || !sc) { HZ.grids[slot] = null; return null; } var R = HZ.grids[slot], g = R && R.mesh;
    if (!g || g.parent !== sc || g.material !== mat) { g = null; for (var i = 0; i < sc.children.length; i++) { var o = sc.children[i]; if (o.isMesh && o.material === mat && o.geometry && o.geometry.attributes.position && o.geometry.attributes.position.count === Tg.cols * Tg.rows) { g = o; break; } } R = null; }
    if (!g) { HZ.grids[slot] = null; return null; } var pa = g.geometry.attributes.position; if (R && R.ver === pa.version) return R;
    var cols = Tg.cols, rows = Tg.rows, L0 = new Float32Array(cols * rows), oy = g.position.y;
    if (pa.r6free) {   // R6 memory dropped the array: reading it would be a synchronous GPU read-back. The client's own height array is what the mesh was built from (the region mesh 3 m lower)
      var HA = G(slot === 0 ? "H" : "HR"); if (!HA || HA.length !== cols * rows) { HZ.grids[slot] = null; return null; } var off = slot === 0 ? 0 : -3; for (var k0 = 0; k0 < cols * rows; k0++) L0[k0] = HA[k0] + off + oy; HZ.n.fromH = (HZ.n.fromH || 0) + 1; }
    else for (var k = 0; k < cols * rows; k++) L0[k] = pa.getY(k) + oy;
    var mip = [{ w: cols, h: rows, a: L0 }]; while (mip[mip.length - 1].w > 2 || mip[mip.length - 1].h > 2) { var P = mip[mip.length - 1], w = Math.ceil(P.w / 2), h = Math.ceil(P.h / 2), A = new Float32Array(w * h);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var m = Infinity; for (var dy = 0; dy < 2; dy++) for (var dx = 0; dx < 2; dx++) { var xx = x * 2 + dx, yy = y * 2 + dy; if (xx < P.w && yy < P.h) { var v = P.a[yy * P.w + xx]; if (v < m) m = v; } } A[y * w + x] = m; }
      mip.push({ w: w, h: h, a: A }); }
    R = HZ.grids[slot] = { mesh: g, ver: pa.version, mip: mip, xmin: g.position.x - (Tg.xmax - Tg.xmin) / 2, zmin: g.position.z - (Tg.zmax - Tg.zmin) / 2, cw: (Tg.xmax - Tg.xmin) / (cols - 1), ch: (Tg.zmax - Tg.zmin) / (rows - 1), cols: cols, rows: rows };
    HZ.ver++; return R;
  }
  function hzGround() { var GM = G("GROUND_MATS"); if (!GM) return false; var a = hzGrid(0, G("T"), GM[0]), b = hzGrid(1, G("TR"), GM[1]); HZ.mesh = a ? a.mesh : null; return !!a; }
  function gridMin(R, x0, z0, x1, z1) {   // the lowest vertex of every cell of grid R the box touches; -Infinity when the box leaves the grid
    var u0 = (x0 - R.xmin) / R.cw, u1 = (x1 - R.xmin) / R.cw, v0 = (z0 - R.zmin) / R.ch, v1 = (z1 - R.zmin) / R.ch;
    if (u0 < 0 || v0 < 0 || u1 > R.cols - 1 || v1 > R.rows - 1) return -Infinity;
    var c0 = Math.floor(u0), c1 = Math.ceil(u1), r0 = Math.floor(v0), r1 = Math.ceil(v1), span = Math.max(c1 - c0, r1 - r0), k = 0; while ((span >> k) > 6 && k < R.mip.length - 1) k++;   // at most about 8 x 8 reads
    var M = R.mip[k], a0 = c0 >> k, a1 = c1 >> k, b0 = r0 >> k, b1 = r1 >> k, m = Infinity; for (var b = b0; b <= b1; b++) { var row = b * M.w; for (var a = a0; a <= a1; a++) { var v = M.a[row + a]; if (v < m) m = v; } } return m;
  }
  function hzMin(x0, z0, x1, z1) {   // a lower bound of the drawn ground over the box: the ground grid where it covers the box, else the region grid
    var A = HZ.grids[0], B = HZ.grids[1], m = A ? gridMin(A, x0, z0, x1, z1) : -Infinity; if (m > -Infinity) return m; return B && HZ.rv ? gridMin(B, x0, z0, x1, z1) : -Infinity;
  }
  var COSB = null, SINB = null, _hp = new THREE.Vector3(), _hq = new THREE.Quaternion();
  // per bin and per sample distance d: the arc of the bin at d (every ray of the bin crosses it) lies over the grid cells its box
  // touches, so the ground under every ray at d is at least their lowest vertex L, and (L - eye) / d is an elevation every ray of the
  // bin meets the ground at. Hc[s] keeps the running maximum over the samples up to d_s. The bins cover the view plus a margin, so a
  // turn of the camera alone reuses them.
  function hzBuild(cam) {
    var t0 = performance.now(), p = _hp.setFromMatrixPosition(cam.matrixWorld), q = _hq.setFromRotationMatrix(cam.matrixWorld), C = HZ.cam; HZ.ok = false;
    if (!hzGround()) return; var g = HZ.mesh; if (g.visible !== true) return; HZ.rv = !!(HZ.grids[1] && HZ.grids[1].mesh.visible === true && HZ.grids[1].mesh.parent === G("scene"));
    try { if (window.PLAN_FLOOR && typeof window.PLAN_FLOOR(p.x, p.z) === "number") return; } catch (e) { return; }
    var t = HZ.grids[0], u = (p.x - t.xmin) / t.cw, v = (p.z - t.zmin) / t.ch; if (!(u >= 0 && v >= 0 && u <= t.cols - 2 && v <= t.rows - 2)) return;   // the camera off the ground grid: nothing
    var M0 = t.mip[0].a, i = Math.floor(v) * t.cols + Math.floor(u), gmax = Math.max(M0[i], M0[i + 1], M0[i + t.cols], M0[i + t.cols + 1]); if (!(p.y > gmax + 0.3)) return;   // below or at the ground: no horizon
    var NB = HZ.NB, bw = Math.PI * 2 / NB; if (!COSB) { COSB = new Float64Array(NB + 1); SINB = new Float64Array(NB + 1); for (var b = 0; b <= NB; b++) { COSB[b] = Math.cos(b * bw); SINB[b] = Math.sin(b * bw); } }
    var fw = _v3.set(-cam.matrixWorld.elements[8], -cam.matrixWorld.elements[9], -cam.matrixWorld.elements[10]).normalize(), all = Math.abs(fw.y) > 0.75, lo = 0, n = NB;
    if (!all) { var ip = cam.projectionMatrixInverse, mw = cam.matrixWorld, a0 = Math.atan2(fw.z, fw.x), mn = 0, mxx = 0;
      for (var cx = -1; cx <= 1; cx += 2) for (var cy = -1; cy <= 1; cy += 2) { _ctr.set(cx, cy, 0.5).applyMatrix4(ip).applyMatrix4(mw).sub(p); var d = Math.atan2(_ctr.z, _ctr.x) - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; if (d < mn) mn = d; if (d > mxx) mxx = d; }
      if (mxx - mn > Math.PI * 1.2) all = true; else { lo = Math.floor((a0 + mn) / bw); n = Math.ceil((mxx - mn) / bw) + 2; } }
    // reuse: the same position and the view's bins inside the ones built
    if (C[0] === p.x && C[1] === p.y && C[2] === p.z && C[7] === HZ.ver && HZ.Hc) { var rel0 = ((lo - HZ.b0) % NB + NB) % NB; if (HZ.nb === NB || (rel0 + n <= HZ.nb)) { HZ.ok = true; return; } }
    if (!all) { var mg = Math.round(0.14 / bw); lo -= mg; n += 2 * mg; if (n >= NB) { lo = 0; n = NB; } }   // 8 degrees each side: a small turn reuses the horizon
    C[0] = p.x; C[1] = p.y; C[2] = p.z; C[7] = HZ.ver;
    HZ.b0 = ((lo % NB) + NB) % NB; HZ.nb = n; var NR = HZ.NR, RG = HZ.ring; if (!HZ.Hc || HZ.Hc.length < n * NR) HZ.Hc = new Float32Array(Math.max(n, 64) * NR); var Hc = HZ.Hc, ey = p.y, HM = HZ.HM || (HZ.HM = new Float32Array(NR));
    for (var bi = 0; bi < n; bi++) { var bb = (HZ.b0 + bi) % NB, c0 = COSB[bb], s0 = SINB[bb], c1 = COSB[bb + 1], s1 = SINB[bb + 1], cm = Math.cos((bb + 0.5) * bw), sm = Math.sin((bb + 0.5) * bw), run = -Infinity, base = bi * NR;
      var xa = Math.min(c0, c1, cm), xb = Math.max(c0, c1, cm), za = Math.min(s0, s1, sm), zb = Math.max(s0, s1, sm);   // the arc's box per unit distance (the arc lies inside the box of its ends and middle for bins under 90 degrees)
      for (var k = 0; k < NR; k++) { var dk = RG[k]; var L = hzMin(p.x + xa * dk, p.z + za * dk, p.x + xb * dk, p.z + zb * dk); if (L > -Infinity) { var e = (L - ey) / dk; if (e > run) run = e; } Hc[base + k] = run; if (bi === 0 || run > HM[k]) HM[k] = run; } }
    HZ.ok = true; HZ.n.builds++; HZ.n.ms += performance.now() - t0;
  }
  var _hc = new THREE.Vector3();
  var HB = new Float64Array(24);
  function hzHidden(obj, geo, mat) {
    if (mat.depthTest === false || (mat.depthFunc !== THREE.LessEqualDepth && mat.depthFunc !== THREE.LessDepth)) return false;
    var C = HZ.cam, cx0 = C[0], cy0 = C[1], cz0 = C[2], ymax = -Infinity, dmin = Infinity, dmax = 0, acx, acz, k;
    // quick exit (most meshes): the centre of its bounds is a point of it, so if the centre clears the highest horizon at its own
    // distance, the mesh is visible
    var gs = obj.isSkinnedMesh === true ? obj.boundingSphere : geo.boundingSphere;
    if (gs) { var me = obj.matrixWorld.elements, sx = gs.center.x, sy = gs.center.y, sz = gs.center.z, qx = me[0] * sx + me[4] * sy + me[8] * sz + me[12] - cx0, qy = me[1] * sx + me[5] * sy + me[9] * sz + me[13] - cy0, qz = me[2] * sx + me[6] * sy + me[10] * sz + me[14] - cz0, qd = Math.sqrt(qx * qx + qz * qz);
      if (qd < 4) return false; var RQ = HZ.ring, ql = 0, qh = HZ.NR - 1; if (RQ[0] < qd) { while (ql < qh) { var qm = (ql + qh + 1) >> 1; if (RQ[qm] < qd) ql = qm; else qh = qm - 1; } if (!(HZ.HM[ql] > qy / qd)) return false; } }
    // the mesh's box in the world (its eight corners): the highest point, the nearest and farthest horizontal distance, the azimuths
    var bb = obj.isSkinnedMesh === true ? null : geo.boundingBox;
    if (bb === null && obj.isSkinnedMesh !== true && geo.boundingSphere === null && !dropped(geo) && geo.attributes && geo.attributes.position) { geo.computeBoundingBox(); bb = geo.boundingBox; }
    if (bb !== null && bb !== undefined && !bb.isEmpty()) { var e = obj.matrixWorld.elements;
      for (k = 0; k < 8; k++) { var x = (k & 4) ? bb.max.x : bb.min.x, y = (k & 2) ? bb.max.y : bb.min.y, z = (k & 1) ? bb.max.z : bb.min.z;
        var wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14]; HB[k * 3] = wx - cx0; HB[k * 3 + 1] = wy; HB[k * 3 + 2] = wz - cz0; if (wy > ymax) ymax = wy; }
      acx = (HB[0] + HB[21]) / 2; acz = (HB[2] + HB[23]) / 2;   // the box centre (corners 0 and 7 are opposite)
      var hr = 0; for (k = 0; k < 8; k++) { var ddx = HB[k * 3] - acx, ddz = HB[k * 3 + 2] - acz, q = ddx * ddx + ddz * ddz; if (q > hr) hr = q; } hr = Math.sqrt(hr);
      var dcb = Math.sqrt(acx * acx + acz * acz); dmin = dcb - hr; dmax = dcb + hr; var rr = hr, dcc = dcb; }
    else { var bs = obj.isSkinnedMesh === true ? obj.boundingSphere : geo.boundingSphere; if (!bs || !isFinite(bs.radius) || bs.radius <= 0) return false; _hc.copy(bs.center).applyMatrix4(obj.matrixWorld); var r = bs.radius * obj.matrixWorld.getMaxScaleOnAxis();
      acx = _hc.x - cx0; acz = _hc.z - cz0; var dc = Math.sqrt(acx * acx + acz * acz); dmin = dc - r; dmax = dc + r; ymax = _hc.y + r; rr = r; dcc = dc; }
    if (!(dmin >= 4) || !isFinite(ymax)) return false;
    var ytop = ymax - cy0, amax = ytop > 0 ? ytop / dmin : ytop / dmax;
    var RG = HZ.ring, lo = 0, hi = HZ.NR - 1; if (RG[0] > dmin) return false; while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (RG[mid] < dmin) lo = mid; else hi = mid - 1; }   // the last sample strictly in front of the mesh
    if (!(HZ.HM[lo] > amax)) return false;   // above the highest horizon of any bin at that distance: visible (the common case, no trigonometry)
    var NB = HZ.NB, bw = Math.PI * 2 / NB, a = Math.atan2(acz, acx), hw = Math.asin(Math.min(1, rr / dcc)), i0 = Math.floor((a - hw) / bw), i1 = Math.floor((a + hw) / bw), NR = HZ.NR, Hc = HZ.Hc;
    for (var i = i0; i <= i1; i++) { var rel = ((i - HZ.b0) % NB + NB) % NB; if (rel >= HZ.nb) return false; if (!(Hc[rel * NR + lo] > amax + 1e-6)) return false; }
    return true;
  }
  O.hzHidden = hzHidden; O.hzBuild = hzBuild;
  // a mesh is tested only when its geometry bounds are where it is drawn: not when it opts out of three's frustum culling, has a
  // per-draw callback, is placed by
  // its own shader (shader materials, instanced buffer geometry) or has a module shader hook (which may move its vertices); the
  // client's cascaded-shadow hook (lighting only) is fine
  var MATP = THREE.Material.prototype;
  function boundsTrusted(obj, geo, mat) {
    if (obj.frustumCulled !== true || obj.onBeforeRender !== OBR || geo.isInstancedBufferGeometry === true || mat.isShaderMaterial === true || mat.isRawShaderMaterial === true) return false;   /* a per-draw callback may draw it somewhere else (the porch and market batches do) */
    if (mat._userObc) return false; if (mat._csmObc === undefined && mat.onBeforeCompile !== MATP.onBeforeCompile) return false;
    if (obj.morphTargetInfluences && obj.morphTargetInfluences.length) return false; return true;
  }
  var CR = new Int32Array(65536).fill(-1), CV = new Uint8Array(65536);   // per object id: the render it was tested in, and the verdict (no properties on the objects)
  function growC(id) { var n = CR.length; while (n <= id) n *= 2; var a = new Int32Array(n).fill(-1), b = new Uint8Array(n); a.set(CR); b.set(CV); CR = a; CV = b; }
  var inst = false, ridB = -1, act = false, cam0 = null, sc0 = null;
  function activeNow() { try { if (window.PLAN_VR && PLAN_VR.on) return false; if (window.PLAN_PERF && PLAN_PERF.ic && PLAN_PERF.ic.kind) return false; if (G("inside")) return false; } catch (e) { return false; } return true; }
  O.dbgOnly = null; O.culledNow = null;   // tests: a Set that collects the meshes culled (O.culledNow = new Set())
  function install(R) {
    inst = true; cam0 = G("camera"); sc0 = G("scene"); var inner = R.renderBufferDirect;
    var hzSt = function (cam, sc, geo, mat, obj, grp) {   /* R21 T3 (HANDOFF_R21_DRAW.md): this wrapper as a stage of PLAN_PERF.rbd */
      if ((O.on === true || HZ.on === true) && cam === cam0 && sc === sc0 && obj && obj.isMesh === true && obj.isInstancedMesh !== true && geo) {
        var rid = R.info.render.frame; if (rid !== ridB) { ridB = rid; act = activeNow(); if (act) { if (HZ.on === true) { try { hzBuild(cam); } catch (e) { note("hz build", e); HZ.ok = false; } } if (O.on === true) { try { build(cam, R); O.bok = true; } catch (e) { note("build", e); O.bok = false; } } } }
        if (act === true) { var oid = obj.id; if (oid >= CR.length) growC(oid); if (CR[oid] === rid) { if (CV[oid] === 1) return true; } else { var tm = DXr === undefined || DXr.on !== true || (++O.tq & 15) === 0, t0 = tm ? performance.now() : 0, v = false, trust = boundsTrusted(obj, geo, mat);   /* R21 T3: with the dispatcher on, the test timer samples one test in 16 */
            if (trust === true && HZ.on === true && HZ.ok === true) { try { v = hzHidden(obj, geo, mat); } catch (e) { note("hz test", e); } HZ.n.tests++; if (v) HZ.n.culled++; }
            if (trust === true && v === false && O.on === true && O.bok === true && obj.isSkinnedMesh !== true) { try { v = occluded(obj, geo); } catch (e) { note("test", e); } O.n.tests++; if (v) O.n.culled++; }
            if (v === true && O.dbgOnly !== null && !O.dbgOnly.has(obj)) v = false;   // tests: cull only the meshes of a given set
            CR[oid] = rid; CV[oid] = v ? 1 : 0; if (tm) O.n.testMs += (performance.now() - t0) * (DXr !== undefined && DXr.on === true ? 16 : 1); if (v) { if (O.culledNow) O.culledNow.add(obj); return true; } } } }
      return false;
    }; var DXr = window.PLAN_PERF && PLAN_PERF.rbd; if (!(DXr && DXr.add && DXr.add(R, "bcHz", 40, hzSt))) R.renderBufferDirect = function (cam, sc, geo, mat, obj, grp) { if (hzSt(cam, sc, geo, mat, obj, grp) === true) return; return inner.apply(this, arguments); };
  }
  var f = 0;
  window.PLAN_HOOKS.frame.push({ name: "bcOcc", fn: function () {
    if (!O.want && !HZ.on) return; f++; var R = G("renderer"); if (!R) return;
    try { if (HZ.on && (f % 30) === 7) { try { hzGround(); } catch (e) { note("hz ground", e); } }   // the height grids early, while the meshes' arrays are still in memory
      if (!inst) { if (!C.installed) return; install(R); } if (!O.want) return;
      if (f % 60 === 5) scanKinds(); if (f % 4 === 2) { var P = window.PLAN_PERF; if (P && P.readyAt) scanPlain(); }
      capStep(); if (pendSolve.length) { var t0 = performance.now(), J = pendSolve[0]; try { var r; do { r = J.g.next(); } while (!r.done && performance.now() - t0 < O.K.solveMs); if (r.done) { pendSolve.shift(); J.done(r.value || []); } } catch (e) { pendSolve.shift(); note("solve", e); } O.n.solveMs += performance.now() - t0; }
    } catch (e) { note("frame", e); } } });
})();
