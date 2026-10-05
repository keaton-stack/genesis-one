// R14 PORCHES (4 Oct 2026): real 3D porches, verandas, boardwalks and outdoor seating on the early buildings.
//   The early building models carry their porches as part of one scanned mesh: a boardwalk under a plank roof on the stores and
//   saloons, a wraparound deck on the ranch houses, two veranda wings on the hotels, a slab porch on the casitas, a pergola
//   terrace on the restaurants, a ring deck round the glamping tents, a dining patio on the villas. None of it could be stood on
//   (the building's one round collider swallowed the whole porch and the deck boards were drawn 0.2 to 0.7 m over the feet) and
//   nothing on it could be sat on. This module, for every placed building of those kinds:
//     - makes the porch a walkable floor at its drawn height (the client's walk grid, or step solids for the high decks) and
//       swaps the round collider for a box on the walls, so the deck, the posts and the door are all reachable;
//     - furnishes it with real, sittable furniture and dressing chosen per building and per bay (Old West benches, rocking
//       chairs, cracker barrel checkers, goods and barrels and hitching rails on the boardwalks; rockers and a porch swing on the
//       ranch porches; equipale chairs and serape rugs on the casitas; adirondacks on the glamping decks; bistro sets, festoon
//       lights and umbrella tables on the cafes, the diner and the restaurant terraces), lanterns that glow at night (emissive,
//       no new lights), plank steps where a deck stands high;
//     - never in a doorway: every door's corridor and the client's walk-in mat stay clear, seats keep away from the mat so E
//       still opens the door, and nothing at ground level goes on a road, a walk ribbon or another prop.
//   Drawing: one texture atlas (tex/rp_atlas.jpg: generated wood, barrel, wicker, leather, serape and painted plank sheets plus
//   procedural iron, zinc, terracotta and canvas), two materials, every prop a geometry added once per BatchedMesh (multi draw)
//   in 250 m chunks that are hidden past the cull range. Classic script, loaded before client.js; plan/porches.json holds every
//   measured porch (facade angle, wall line, deck rectangle and height, posts, door corridor) and the per-kind palettes.
//   ?porches=0 turns the module off. window.PLAN_PORCHES: n (counters), errs, cfg, stats, sample(kind, i), rebuild().
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var PP = window.PLAN_PORCHES = window.PLAN_PORCHES || {};
  PP.errs = PP.errs || []; PP.n = PP.n || {}; PP.ver = "r14";
  if (/[?&]porches=0\b/.test(location.search)) { PP.off = true; return; }
  var PI = Math.PI, TAU = PI * 2;
  function note(tag, e) { try { if (PP.errs.length < 50) PP.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (PP.errs.length <= 6) console.warn("plan_porches " + tag, e); } catch (x) {} }
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function au(u) { try { if (window.AV) return window.AV(u); } catch (e) {} return u; }
  function lowTier() { try { return ASSET.tier === "m"; } catch (e) { return false; } }

  // ───────────────────────── config: plan/porches.json ─────────────────────────
  var CFG = PP.cfg || null;
  function cfgUrl() { return au("/plan/porches.json?v=" + (window.BUILD || "dev")); }
  if (!CFG) { try { fetch(cfgUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && !CFG) CFG = PP.cfg = d; }).catch(function (e) { note("cfg fetch", e); }); } catch (e) { note("cfg", e); } }
  function cfg() { if (CFG) return CFG; try { var x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = PP.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); } return CFG; }

  // ───────────────────────── materials (shared, built once) ─────────────────────────
  var MAT = PP.mat = PP.mat || {};
  function mats() {
    if (MAT.atlas) return MAT;
    var t = new THREE.TextureLoader().load(au("/tex/rp_atlas" + (lowTier() ? "_m" : "") + ".jpg"));
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.userData.avShared = true;
    MAT.tex = t;
    MAT.atlas = new THREE.MeshStandardMaterial({ map: t, roughness: 0.86, metalness: 0.0 }); MAT.atlas.name = "rp_atlas"; MAT.atlas.userData.avShared = true;
    MAT.glow = new THREE.MeshStandardMaterial({ color: 0x3a2c18, emissive: 0xffbe6a, emissiveIntensity: 0.3, roughness: 0.4, metalness: 0 }); MAT.glow.name = "rp_glow"; MAT.glow.userData.avShared = true;
    var cv = document.createElement("canvas"); cv.width = 128; cv.height = 64; var cx = cv.getContext("2d"); [[32, 1, 0.5, 0.16, 0.04], [96, 0.32, 0.18, 0.07, 0.02]].forEach(function (q) { var gr = cx.createRadialGradient(q[0], 32, 0, q[0], 32, 31); gr.addColorStop(0, "rgba(255,255,255," + q[1] + ")"); gr.addColorStop(0.12, "rgba(255,255,255," + q[2] + ")"); gr.addColorStop(0.32, "rgba(255,255,255," + q[3] + ")"); gr.addColorStop(0.62, "rgba(255,255,255," + q[4] + ")"); gr.addColorStop(1, "rgba(255,255,255,0)"); cx.fillStyle = gr; cx.fillRect(q[0] - 32, 0, 64, 64); });
    var ht = new THREE.CanvasTexture(cv); ht.colorSpace = THREE.SRGBColorSpace; ht.userData.avShared = true; MAT.htex = ht;
    MAT.halo = new THREE.MeshBasicMaterial({ map: ht, color: 0xffb060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }); MAT.halo.name = "rp_halo"; MAT.halo.userData.avShared = true;
    return MAT;
  }

  // ───────────────────────── geometry kit: non-indexed position / normal / uv, uvs into the 4 x 4 atlas ─────────────────────────
  // tiles: 0 weathered planks, 1 oiled walnut, 2 cream paint, 3 sage paint, 4 barrel staves, 5 wicker, 6 leather, 7 serape,
  // 8 wrought iron, 9 zinc, 10 terracotta, 11 checkers (top half) / crate (bottom half), 12 red canvas, 13 green canvas,
  // 14 terracotta canvas, 15 saguaro (top half) / agave (bottom half)
  var EPS = 6 / 2048;
  function tileRect(t, half) { var c = t % 4, r = Math.floor(t / 4); var u0 = c / 4 + EPS, u1 = (c + 1) / 4 - EPS, v1 = 1 - r / 4 - EPS, v0 = 1 - (r + 1) / 4 + EPS; if (half === 1) v0 = (v0 + v1) / 2 + EPS; else if (half === 2) v1 = (v0 + v1) / 2 - EPS; return [u0, v0, u1, v1]; }
  function Bld() { this.p = []; this.n = []; this.uv = []; this.seed = 1; }
  var _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, "YXZ"), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _nm = new THREE.Matrix3();
  function xf(o) { _e.set(o.rx || 0, o.ry || 0, o.rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v.set(o.x || 0, o.y || 0, o.z || 0), _q, _v2.set(1, 1, 1)); _nm.getNormalMatrix(_m4); return _m4; }
  Bld.prototype.rnd = function () { this.seed = (this.seed * 16807) % 2147483647; return (this.seed - 1) / 2147483646; };
  // a quad a-b-c-d (counter-clockwise seen from the front) with uv corners
  Bld.prototype.quad = function (M, a, b, c, d, uv) { var P = [a, b, c, a, c, d], U = [uv[0], uv[1], uv[2], uv[0], uv[2], uv[3]];
    _v.fromArray(b).sub(_v3.fromArray(a)); _v2.fromArray(d).sub(_v3.fromArray(a)); var nx = _v.y * _v2.z - _v.z * _v2.y, ny = _v.z * _v2.x - _v.x * _v2.z, nz = _v.x * _v2.y - _v.y * _v2.x; var L = Math.hypot(nx, ny, nz) || 1; var N = new THREE.Vector3(nx / L, ny / L, nz / L).applyMatrix3(_nm).normalize();
    for (var i = 0; i < 6; i++) { _v.fromArray(P[i]).applyMatrix4(M); this.p.push(_v.x, _v.y, _v.z); this.n.push(N.x, N.y, N.z); this.uv.push(U[i][0], U[i][1]); } };
  Bld.prototype.tri = function (M, a, b, c, uv) { var P = [a, b, c]; _v.fromArray(b).sub(_v3.fromArray(a)); _v2.fromArray(c).sub(_v3.fromArray(a)); var nx = _v.y * _v2.z - _v.z * _v2.y, ny = _v.z * _v2.x - _v.x * _v2.z, nz = _v.x * _v2.y - _v.y * _v2.x; var L = Math.hypot(nx, ny, nz) || 1; var N = new THREE.Vector3(nx / L, ny / L, nz / L).applyMatrix3(_nm).normalize();
    for (var i = 0; i < 3; i++) { _v.fromArray(P[i]).applyMatrix4(M); this.p.push(_v.x, _v.y, _v.z); this.n.push(N.x, N.y, N.z); this.uv.push(uv[i][0], uv[i][1]); } };
  // the uv corners of a face A by B metres in tile t: s metres per tile; the longer side runs along the tile's u (the wood grain)
  Bld.prototype.fuv = function (A, B, t, s, half) { var R = tileRect(t, half); var rot = B > A * 1.05; var a = rot ? B : A, b = rot ? A : B; var fu = Math.min(1, a / s), fv = Math.min(1, b / (s * (half ? 0.5 : 1))); var ou = this.rnd() * (1 - fu), ov = this.rnd() * (1 - fv);
    var u0 = R[0] + (R[2] - R[0]) * ou, u1 = R[0] + (R[2] - R[0]) * (ou + fu), v0 = R[1] + (R[3] - R[1]) * ov, v1 = R[1] + (R[3] - R[1]) * (ov + fv);
    return rot ? [[u0, v0], [u0, v1], [u1, v1], [u1, v0]] : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]; };
  // a box w (x) by h (y) by d (z), centred at (x, y + h/2, z) unless o.c (centre given); o.t tile, o.s metres per tile, o.nb no bottom, o.nt no top
  Bld.prototype.box = function (w, h, d, o) { var M = o.M ? o.M : xf(o); if (o.M) _nm.getNormalMatrix(M); var t = o.t || 0, s = o.s || 1.2, x = w / 2, z = d / 2, y0 = o.c ? -h / 2 : 0, y1 = y0 + h, hf = o.half;
    if (!o.nt) this.quad(M, [-x, y1, z], [x, y1, z], [x, y1, -z], [-x, y1, -z], this.fuv(w, d, o.tt !== undefined ? o.tt : t, s, o.th !== undefined ? o.th : hf));
    if (!o.nb) this.quad(M, [-x, y0, -z], [x, y0, -z], [x, y0, z], [-x, y0, z], this.fuv(w, d, t, s, hf));
    this.quad(M, [-x, y0, z], [x, y0, z], [x, y1, z], [-x, y1, z], this.fuv(w, h, t, s, hf));
    this.quad(M, [x, y0, -z], [-x, y0, -z], [-x, y1, -z], [x, y1, -z], this.fuv(w, h, t, s, hf));
    this.quad(M, [x, y0, z], [x, y0, -z], [x, y1, -z], [x, y1, z], this.fuv(d, h, t, s, hf));
    this.quad(M, [-x, y0, -z], [-x, y0, z], [-x, y1, z], [-x, y1, -z], this.fuv(d, h, t, s, hf)); return this; };
  // a lathe: rings [[r, y], ...] bottom to top, seg sides; o.t tile, o.ur (u repeats round, <= 1), o.cap top cap tile, o.half
  Bld.prototype.lathe = function (rings, seg, o) { var M = xf(o), t = o.t || 0, R = tileRect(t, o.half), ur = o.ur || 1; var H = rings[rings.length - 1][1] - rings[0][1] || 1;
    for (var i = 0; i < seg; i++) { var a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU; var c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1); var uu0 = R[0] + (R[2] - R[0]) * (i / seg) * ur, uu1 = R[0] + (R[2] - R[0]) * ((i + 1) / seg) * ur;
      for (var j = 0; j < rings.length - 1; j++) { var ra = rings[j][0], ya = rings[j][1], rb = rings[j + 1][0], yb = rings[j + 1][1]; var va = R[1] + (R[3] - R[1]) * ((ya - rings[0][1]) / H), vb = R[1] + (R[3] - R[1]) * ((yb - rings[0][1]) / H);
        this.quad(M, [ra * s0, ya, ra * c0], [ra * s1, ya, ra * c1], [rb * s1, yb, rb * c1], [rb * s0, yb, rb * c0], [[uu0, va], [uu1, va], [uu1, vb], [uu0, vb]]); } }
    if (o.cap !== undefined) { var top = rings[rings.length - 1], C = tileRect(o.cap, o.capHalf), cu = (C[0] + C[2]) / 2, cv = (C[1] + C[3]) / 2, hu = (C[2] - C[0]) / 2, hv = (C[3] - C[1]) / 2;
      for (var k = 0; k < seg; k++) { var b0 = k / seg * TAU, b1 = (k + 1) / seg * TAU; var p0 = [top[0] * Math.sin(b0), top[1], top[0] * Math.cos(b0)], p1 = [top[0] * Math.sin(b1), top[1], top[0] * Math.cos(b1)];
        this.tri(M, [0, top[1], 0], p0, p1, [[cu, cv], [cu + hu * Math.sin(b0), cv + hv * Math.cos(b0)], [cu + hu * Math.sin(b1), cv + hv * Math.cos(b1)]]); } }
    return this; };
  // a bar between two points (square section w)
  Bld.prototype.bar = function (a, b, w, t, o) { var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1e-3; var ry = Math.atan2(dx, dz), rx = -Math.asin(Math.max(-1, Math.min(1, dy / L)));
    var B = o || {}; var base = xf(B).clone(); _e.set(rx, ry, 0, "YXZ"); _q.setFromEuler(_e); var loc = new THREE.Matrix4().compose(_v.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _v2.set(1, 1, 1));
    return this.box(w, w, L, { c: true, t: t, s: B.s || 1.2, M: base.multiply(loc) }); };
  Bld.prototype.geo = function () { if (!this.p.length) return null; var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2)); g.computeBoundingBox(); g.computeBoundingSphere(); g.userData.avShared = true; return g; };

  // ───────────────────────── the prop library (prop frame: origin on the floor, +z the front, metres) ─────────────────────────
  // each prop: { a: atlas geometry, g: glow geometry, cast, seats: [[x, z, w, d, y1]], solids: [[x, z, w, d, y0, y1]] }
  var PROPS = PP.props = PP.props || {};
  function P(name, fn) { if (PROPS[name]) return PROPS[name]; var A = new Bld(), G = new Bld(), Hh = new Bld(); A.seed = 1 + hash(name) % 100000; G.seed = A.seed; var spec = fn(A, G, Hh) || {}; var pr = { name: name, a: A.geo(), g: G.geo(), h: Hh.geo(), cast: spec.cast !== false, seats: spec.seats || [], solids: spec.solids || [], tris: (A.p.length + G.p.length) / 9 }; PROPS[name] = pr; return pr; }
  function benchBack(A, L, t, tl) { var lx = L / 2 - 0.12;
    for (var i = 0; i < 3; i++) A.box(L, 0.04, 0.13, { x: 0, y: 0.42, z: -0.13 + i * 0.145, t: t, s: 1.6 });
    [-lx, lx].forEach(function (x) { A.box(0.07, 0.42, 0.07, { x: x, y: 0, z: 0.17, t: tl, nb: true }); A.box(0.07, 0.94, 0.07, { x: x, y: 0, z: -0.2, t: tl, nb: true, rx: -0.08 }); A.box(0.06, 0.04, 0.48, { x: x + (x > 0 ? 0.04 : -0.04), y: 0.66, z: -0.0, t: tl }); A.box(0.05, 0.22, 0.05, { x: x + (x > 0 ? 0.04 : -0.04), y: 0.44, z: 0.19, t: tl }); });
    A.box(L - 0.2, 0.05, 0.04, { x: 0, y: 0.13, z: 0.17, t: tl }); A.box(L - 0.2, 0.05, 0.04, { x: 0, y: 0.13, z: -0.17, t: tl });
    for (var j = 0; j < 2; j++) A.box(L - 0.06, 0.1, 0.03, { x: 0, y: 0.6 + j * 0.2, z: -0.24 - j * 0.02, t: t, s: 1.6, rx: -0.08 });
    return { seats: [[0, 0.02, L - 0.1, 0.42, 0.46]], solids: [[0, -0.23, L, 0.1, 0.46, 0.96]] }; }
  function rocker(A, t) { var w = 0.5;
    [-1, 1].forEach(function (sd) { var x = sd * 0.25, pts = []; for (var k = 0; k <= 6; k++) { var zz = -0.42 + k * 0.14, yy = 0.04 + 0.05 * Math.pow((zz + 0.05) / 0.42, 2); pts.push([x, yy, zz]); } for (var k2 = 0; k2 < 6; k2++) A.bar(pts[k2], pts[k2 + 1], 0.04, t);
      A.bar([x, 0.07, 0.2], [x, 0.43, 0.22], 0.04, t); A.bar([x, 0.06, -0.18], [x, 0.43, -0.2], 0.04, t); A.bar([x, 0.43, -0.2], [x, 1.08, -0.42], 0.045, t); A.bar([x, 0.43, 0.22], [x, 0.66, 0.24], 0.035, t); A.bar([x + sd * 0.02, 0.66, 0.26], [x + sd * 0.02, 0.68, -0.27], 0.05, t); });
    for (var i = 0; i < 4; i++) A.box(w, 0.03, 0.1, { x: 0, y: 0.42, z: -0.15 + i * 0.12, t: t, s: 1.2 });
    for (var j = 0; j < 5; j++) { var u = -0.18 + j * 0.09; A.bar([u, 0.46, -0.22], [u, 1.0, -0.39], 0.03, t); }
    A.bar([-0.26, 1.04, -0.41], [0.26, 1.04, -0.41], 0.06, t); A.bar([-0.26, 0.5, -0.24], [0.26, 0.5, -0.24], 0.04, t);
    return { seats: [[0, 0.02, 0.52, 0.5, 0.45]] }; }
  function barrel(A, y, r) { r = r || 0.3; A.lathe([[r * 0.88, 0], [r, 0.25], [r * 1.07, 0.45], [r, 0.65], [r * 0.88, 0.9]], 12, { y: y || 0, t: 4, ur: 1, cap: 1 }); }
  function pot(A, x, z, r, h, t) { A.lathe([[r * 0.7, 0], [r, h * 0.85], [r * 1.12, h * 0.88], [r * 1.12, h], [r * 0.95, h]], 10, { x: x, z: z, t: t === undefined ? 10 : t, cap: 9 }); }
  function saguaro(A, x, z, y, h) { A.lathe([[0.07, 0], [0.08, h * 0.6], [0.065, h * 0.95], [0.02, h]], 8, { x: x, y: y, z: z, t: 15, half: 1 }); A.lathe([[0.05, 0], [0.055, 0.2], [0.02, 0.26]], 6, { x: x + 0.12, y: y + h * 0.42, z: z, t: 15, half: 1 }); A.bar([x + 0.02, y + h * 0.4, z], [x + 0.13, y + h * 0.42, z], 0.06, 15, {}); }
  function agave(A, x, z, y, s) { for (var i = 0; i < 9; i++) { var a = i / 9 * TAU + 0.3, L = (0.34 + 0.08 * Math.sin(i * 2.3)) * s, up = 0.9 - 0.25 * (i % 3) / 2; var bx = Math.sin(a), bz = Math.cos(a); var tip = [x + bx * L * Math.cos(up), y + 0.05 + L * Math.sin(up), z + bz * L * Math.cos(up)]; var w = 0.06 * s; var l0 = [x - bz * w, y + 0.04, z + bx * w], r0 = [x + bz * w, y + 0.04, z - bx * w]; var R = tileRect(15, 2), uu = [[R[0], R[1]], [R[2], R[1]], [(R[0] + R[2]) / 2, R[3]]]; var I = xf({}); A.tri(I, l0, r0, tip, uu); A.tri(I, r0, l0, tip, uu); } }
  function halo(Hh, x, y, z, s) { var h = s / 2, I = xf({}), U = [[0.004, 0], [0.496, 0], [0.496, 1], [0.004, 1]]; Hh.quad(I, [x - h, y - h, z], [x + h, y - h, z], [x + h, y + h, z], [x - h, y + h, z], U); Hh.quad(I, [x, y - h, z + h], [x, y - h, z - h], [x, y + h, z - h], [x, y + h, z + h], U); Hh.quad(I, [x - h * 0.7, y, z + h * 0.7], [x + h * 0.7, y, z + h * 0.7], [x + h * 0.7, y, z - h * 0.7], [x - h * 0.7, y, z - h * 0.7], U); }
  function lanternGeo(A, G, mount) { // mount: wall bracket from z=0 out to z=0.28; the lantern hangs at z=0.3
    if (mount) { A.box(0.08, 0.16, 0.03, { x: 0, y: -0.08, z: 0.015, t: 8 }); A.bar([0, 0.02, 0.02], [0, 0.04, 0.3], 0.025, 8); }
    A.box(0.2, 0.03, 0.2, { x: 0, y: -0.06, z: 0.3, t: 8 }); A.box(0.22, 0.04, 0.22, { x: 0, y: -0.36, z: 0.3, t: 8 }); A.lathe([[0.13, -0.06], [0.06, 0.04], [0.02, 0.07]], 4, { z: 0.3, ry: PI / 4, t: 8 });
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) { A.box(0.018, 0.27, 0.018, { x: c[0] * 0.085, y: -0.33, z: 0.3 + c[1] * 0.085, t: 8 }); });
    G.box(0.15, 0.25, 0.15, { x: 0, y: -0.33, z: 0.3, t: 9 }); }
  function bistroChair(A, t) { A.lathe([[0.2, 0.43], [0.205, 0.46]], 12, { t: t, cap: t }); [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) { A.bar([c[0] * 0.16, 0, c[1] * 0.16], [c[0] * 0.12, 0.43, c[1] * 0.12], 0.025, 8); });
    var prev = null; for (var k = 0; k <= 6; k++) { var a = PI + (k / 6 - 0.5) * 2.2; var p = [Math.sin(a) * 0.19, 0.84, Math.cos(a) * 0.19]; if (prev) A.bar(prev, p, 0.03, 8); prev = p; }
    A.bar([-0.17, 0.45, -0.1], [-0.17, 0.84, -0.13], 0.025, 8); A.bar([0.17, 0.45, -0.1], [0.17, 0.84, -0.13], 0.025, 8); A.box(0.3, 0.1, 0.02, { x: 0, y: 0.66, z: -0.19, t: t, s: 0.8 });
    return { seats: [[0, 0, 0.42, 0.42, 0.46]] }; }
  function bistroTable(A, r) { A.lathe([[r, 0.72], [r, 0.75]], 14, { t: 9, cap: 9 }); A.lathe([[0.035, 0.05], [0.03, 0.72]], 6, { t: 8 }); A.box(0.6, 0.04, 0.06, { y: 0, t: 8 }); A.box(0.06, 0.04, 0.6, { y: 0, t: 8 }); return { solids: [[0, 0, r * 2, r * 2, 0, 0.75]] }; }
  function umbrella(A, tile, R, H, half) { A.lathe([[0.022, 0], [0.022, H + 0.05]], 6, { t: 8 }); var g = 8, rim = H - 0.42;
    for (var i = 0; i < g; i++) { var a0 = i / g * TAU, a1 = (i + 1) / g * TAU; var T = tileRect(tile, half); var p0 = [Math.sin(a0) * R, rim, Math.cos(a0) * R], p1 = [Math.sin(a1) * R, rim, Math.cos(a1) * R], ap = [0, H, 0]; var uu = [[T[0], T[1]], [T[2], T[1]], [(T[0] + T[2]) / 2, T[3]]]; var I = xf({});
      A.tri(I, p0, p1, ap, uu); A.tri(I, p1, p0, ap, uu);
      var q0 = [p0[0], rim - 0.16, p0[2]], q1 = [p1[0], rim - 0.16, p1[2]]; var Iq = xf({}); A.quad(Iq, q0, q1, p1, p0, [[T[0], T[1]], [T[2], T[1]], [T[2], T[1] + 0.03], [T[0], T[1] + 0.03]]); A.quad(Iq, q1, q0, p0, p1, [[T[0], T[1]], [T[2], T[1]], [T[2], T[1] + 0.03], [T[0], T[1] + 0.03]]);
      A.bar([0, H - 0.75, 0], [Math.sin(a0) * R * 0.55, rim + 0.18, Math.cos(a0) * R * 0.55], 0.012, 8); }
    A.lathe([[0.04, H], [0.03, H + 0.12], [0.0, H + 0.16]], 6, { t: 1 }); }
  function equipale(A) { A.lathe([[0.27, 0], [0.24, 0.2], [0.27, 0.4]], 12, { t: 5, ur: 1 }); A.lathe([[0.3, 0.38], [0.31, 0.44]], 12, { t: 6, cap: 6 }); A.lathe([[0.3, 0.44], [0.32, 0.47]], 12, { t: 1 });
    var seg = 9; for (var i = 0; i < seg; i++) { var a0 = PI - 1.25 + i / seg * 2.5, a1 = PI - 1.25 + (i + 1) / seg * 2.5; var R = tileRect(6); var p0 = [Math.sin(a0) * 0.3, 0.45, Math.cos(a0) * 0.3], p1 = [Math.sin(a1) * 0.3, 0.45, Math.cos(a1) * 0.3], q0 = [Math.sin(a0) * 0.34, 0.86, Math.cos(a0) * 0.34], q1 = [Math.sin(a1) * 0.34, 0.86, Math.cos(a1) * 0.34]; var uu = [[R[0] + (R[2] - R[0]) * i / seg, R[1]], [R[0] + (R[2] - R[0]) * (i + 1) / seg, R[1]], [R[0] + (R[2] - R[0]) * (i + 1) / seg, R[3]], [R[0] + (R[2] - R[0]) * i / seg, R[3]]]; A.quad(xf({}), p1, p0, q0, q1, uu); A.quad(xf({}), p0, p1, q1, q0, uu); A.bar(q0, q1, 0.035, 1); }
    return { seats: [[0, 0.02, 0.5, 0.5, 0.47]] }; }
  function adirondack(A, t) {
    for (var s = 0; s < 5; s++) { var zz = 0.25 - s * 0.11; A.box(0.56, 0.025, 0.09, { x: 0, y: 0.4 - s * 0.02, z: zz, t: t, s: 1.0, rx: 0.18 }); }
    [-0.3, 0.3].forEach(function (x) { A.bar([x, 0, 0.3], [x, 0.62, 0.32], 0.05, t); A.bar([x, 0, -0.3], [x, 0.36, -0.28], 0.05, t); A.bar([x, 0.4, 0.34], [x, 0.36, -0.3], 0.05, t); A.box(0.13, 0.025, 0.66, { x: x * 1.08, y: 0.62, z: 0.03, t: t, s: 1.0 }); });
    for (var k = 0; k < 6; k++) { var u = -0.25 + k * 0.1; A.box(0.085, 0.82 + 0.12 * Math.cos((k - 2.5) / 2.5 * 1.2), 0.025, { x: u, y: 0.3, z: -0.3, t: t, s: 1.0, rx: -0.42 }); }
    A.bar([-0.28, 0.62, -0.36], [0.28, 0.62, -0.36], 0.04, t);
    return { seats: [[0, 0.02, 0.56, 0.52, 0.4]] }; }
  function crate(A, s, x, y, z, ry) { A.box(s, s, s, { x: x, y: y, z: z, ry: ry || 0, t: 11, half: 2, s: 0.9, tt: 0 }); A.box(s + 0.02, 0.06, s + 0.02, { x: x, y: y + s - 0.06, z: z, ry: ry || 0, t: 1 }); }
  function wagonWheel(A, r) { var seg = 14; for (var i = 0; i < seg; i++) { var a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU; A.bar([Math.sin(a0) * r, r + Math.cos(a0) * r, 0], [Math.sin(a1) * r, r + Math.cos(a1) * r, 0], 0.06, 1); }
    for (var k = 0; k < 10; k++) { var a = k / 10 * TAU; A.bar([Math.sin(a) * 0.07, r + Math.cos(a) * 0.07, 0], [Math.sin(a) * (r - 0.04), r + Math.cos(a) * (r - 0.04), 0], 0.025, 1); } A.lathe([[0.08, -0.08], [0.08, 0.08]], 8, { y: r, rx: PI / 2, t: 8 }); }
  function propsInit() {
    if (PROPS._init) return; PROPS._init = true;
    P("bench_w", function (A) { return benchBack(A, 1.7, 0, 1); });
    P("bench_c", function (A) { return benchBack(A, 1.5, 2, 1); });
    P("bench_s", function (A) { return benchBack(A, 1.6, 3, 1); });
    P("plank", function (A) { A.box(1.8, 0.06, 0.32, { y: 0.4, t: 0, s: 1.8 }); A.box(1.8, 0.05, 0.3, { y: 0.2, t: 1, s: 1.8 }); [-0.75, 0.75].forEach(function (x) { A.box(0.08, 0.4, 0.3, { x: x, t: 1, nb: true }); }); return { seats: [[0, 0, 1.7, 0.32, 0.46]] }; });
    P("rocker_o", function (A) { return rocker(A, 1); });
    P("rocker_c", function (A) { return rocker(A, 2); });
    P("rocker_s", function (A) { return rocker(A, 3); });
    P("barrel", function (A) { barrel(A); return { solids: [[0, 0, 0.62, 0.62, 0, 0.9]] }; });
    P("barrels2", function (A) { barrel(A, 0, 0.3); A.lathe([[0.26, 0], [0.3, 0.2], [0.31, 0.35], [0.3, 0.5], [0.26, 0.7]], 12, { x: 0.62, z: 0.08, t: 4, cap: 1 }); return { solids: [[0.3, 0.04, 1.25, 0.66, 0, 0.9]] }; });
    P("checkers", function (A) { barrel(A, 0, 0.3); A.box(0.52, 0.03, 0.52, { y: 0.9, t: 1, tt: 11, th: 1, s: 0.6 }); for (var i = 0; i < 6; i++) A.lathe([[0.018, 0.93], [0.018, 0.945]], 6, { x: -0.15 + (i % 3) * 0.12, z: (i < 3 ? -0.12 : 0.14), t: i < 3 ? 12 : 8, cap: i < 3 ? 12 : 8 }); return { solids: [[0, 0, 0.6, 0.6, 0, 0.93]] }; });
    P("stool", function (A) { A.lathe([[0.19, 0.42], [0.19, 0.46]], 10, { t: 1, cap: 0 }); for (var i = 0; i < 3; i++) { var a = i / 3 * TAU; A.bar([Math.sin(a) * 0.17, 0, Math.cos(a) * 0.17], [Math.sin(a) * 0.12, 0.42, Math.cos(a) * 0.12], 0.035, 1); } return { seats: [[0, 0, 0.38, 0.38, 0.46]] }; });
    P("goods", function (A) { crate(A, 0.6, -0.35, 0, 0, 0.05); crate(A, 0.5, -0.38, 0.6, 0.02, -0.12); crate(A, 0.45, 0.32, 0, 0.05, 0.3); A.lathe([[0.17, 0], [0.21, 0.15], [0.19, 0.33], [0.1, 0.42], [0.04, 0.48]], 8, { x: 0.33, y: 0.45, z: 0.05, t: 14, half: 2 }); return { solids: [[0, 0, 1.3, 0.75, 0, 1.1]] }; });
    P("hitch", function (A) { [-1.2, 1.2].forEach(function (x) { A.box(0.13, 1.08, 0.13, { x: x, t: 0, s: 1.2, nb: true }); A.box(0.16, 0.05, 0.16, { x: x, y: 1.06, t: 1 }); }); A.box(2.7, 0.1, 0.1, { y: 0.92, t: 0, s: 2.7 }); [-0.5, 0.45].forEach(function (x) { A.lathe([[0.05, -0.05], [0.05, 0.0]], 6, { x: x, y: 0.86, z: 0.06, t: 8 }); }); return { solids: [[0, 0, 2.7, 0.2, 0, 1.05]] }; });
    P("pool", function (A, G, Hh) { var w = 1.5, I = xf({}); Hh.quad(I, [-w, 0.02, w], [w, 0.02, w], [w, 0.02, -w], [-w, 0.02, -w], [[0.504, 0], [0.996, 0], [0.996, 1], [0.504, 1]]); return { cast: false }; });
    P("lantern", function (A, G, Hh) { lanternGeo(A, G, true); halo(Hh, 0, -0.33, 0.3, 1.25); return { cast: false }; });
    P("lantern_hang", function (A, G, Hh) { halo(Hh, 0, -0.33, 0.3, 1.25); A.bar([0, 0.0, 0.3], [0, -0.04, 0.3], 0.012, 8); lanternGeo(A, G, false); return { cast: false }; });
    P("side_table", function (A) { A.box(0.46, 0.04, 0.46, { y: 0.52, t: 1, s: 0.8 }); [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) { A.box(0.04, 0.52, 0.04, { x: c[0] * 0.19, z: c[1] * 0.19, t: 1, nb: true }); }); A.box(0.4, 0.03, 0.4, { y: 0.16, t: 1 }); A.lathe([[0.06, 0.56], [0.08, 0.66], [0.05, 0.78]], 8, { x: 0.05, t: 10 }); return { solids: [[0, 0, 0.46, 0.46, 0, 0.56]], cast: true }; });
    P("bistro_t", function (A) { return bistroTable(A, 0.36); });
    P("bistro_c", function (A) { return bistroChair(A, 1); });
    P("bistro_cg", function (A) { return bistroChair(A, 3); });
    P("umb_r", function (A) { umbrella(A, 12, 1.3, 2.45); return {}; });
    P("umb_g", function (A) { umbrella(A, 13, 1.3, 2.45); return {}; });
    P("umb_t", function (A) { umbrella(A, 14, 1.3, 2.45, 1); return {}; });
    P("equipale", function (A) { return equipale(A); });
    P("adk_c", function (A) { return adirondack(A, 2); });
    P("adk_s", function (A) { return adirondack(A, 3); });
    P("adk_o", function (A) { return adirondack(A, 1); });
    P("pot_saguaro", function (A) { pot(A, 0, 0, 0.2, 0.38); saguaro(A, 0, 0, 0.36, 0.62); return { solids: [[0, 0, 0.45, 0.45, 0, 0.42]], cast: false }; });
    P("pot_agave", function (A) { pot(A, 0, 0, 0.24, 0.34); agave(A, 0, 0, 0.32, 1); return { solids: [[0, 0, 0.5, 0.5, 0, 0.4]], cast: false }; });
    P("pot_pair", function (A) { pot(A, -0.22, 0, 0.17, 0.3); agave(A, -0.22, 0, 0.28, 0.75); pot(A, 0.2, 0.05, 0.14, 0.26, 10); saguaro(A, 0.2, 0.05, 0.25, 0.42); return { solids: [[0, 0, 0.8, 0.42, 0, 0.36]], cast: false }; });
    P("rug", function (A) { A.box(1.3, 0.012, 0.8, { y: 0.004, t: 7, s: 1.3, nb: true }); return { cast: false }; });
    P("rug_l", function (A) { A.box(2.2, 0.012, 1.3, { y: 0.004, t: 7, s: 2.2, nb: true }); return { cast: false }; });
    P("wheel", function (A) { wagonWheel(A, 0.52); return { cast: false }; });
    P("swing", function (A) { var L = 1.4, H = 3.1; var r = benchBack(A, L, 1, 1); [-L / 2 + 0.05, L / 2 - 0.05].forEach(function (x) { A.bar([x, 0.66, 0.2], [x, H, 0.05], 0.02, 8); A.bar([x, 0.96, -0.22], [x, H, 0.05], 0.02, 8); }); A.box(L + 0.2, 0.08, 0.1, { y: H, z: 0.05, t: 1 }); return { seats: [[0, 0.02, L - 0.12, 0.42, 0.48]], solids: [] }; });
    P("festoon", function (A, G, Hh) { A.__hh = Hh; var L = 3.6, H = 2.9; [-L / 2, L / 2].forEach(function (x) { A.box(0.08, H, 0.08, { x: x, t: 1, nb: true }); A.box(0.3, 0.03, 0.3, { x: x, y: 0, t: 8 }); }); var n = 10, prev = null; for (var i = 0; i <= n; i++) { var t = i / n, x = -L / 2 + L * t, y = H - 0.08 - 0.45 * 4 * t * (1 - t); var p = [x, y, 0]; if (prev) A.bar(prev, p, 0.01, 8); prev = p; if (i > 0 && i < n) { G.lathe([[0.0, y - 0.13], [0.04, y - 0.09], [0.035, y - 0.04], [0.012, y - 0.02]], 6, { x: x, t: 9 }); halo(A.__hh, x, y - 0.08, 0, 0.42); } } return { solids: [[-L / 2, 0, 0.15, 0.15, 0, H], [L / 2, 0, 0.15, 0.15, 0, H]], cast: false }; });
    P("planter", function (A) { A.box(1.1, 0.42, 0.42, { t: 0, s: 1.1, nt: true }); A.box(1.0, 0.02, 0.32, { y: 0.36, t: 10 }); agave(A, -0.3, 0, 0.36, 0.7); agave(A, 0.28, 0.02, 0.36, 0.6); saguaro(A, 0.0, 0, 0.36, 0.5); return { solids: [[0, 0, 1.1, 0.42, 0, 0.44]], cast: false }; });
    P("sack", function (A) { A.lathe([[0.18, 0], [0.24, 0.15], [0.22, 0.4], [0.1, 0.52], [0.04, 0.6]], 8, { t: 14, half: 2 }); A.lathe([[0.16, 0], [0.21, 0.12], [0.19, 0.33], [0.09, 0.42], [0.035, 0.49]], 8, { x: 0.36, z: 0.1, t: 14, half: 2 }); return { solids: [[0.15, 0.05, 0.8, 0.5, 0, 0.5]], cast: false }; });
  }
  // per-kind steps: n treads of rise r and depth d across width w (the top tread meets the deck); built on demand
  function stepsProp(n, rise, w) { var key = "steps_" + n + "_" + Math.round(rise * 100) + "_" + Math.round(w * 10); return P(key, function (A) { var tall = n >= 4, run = 0.32 * n, H = rise * n;
      for (var i = 0; i < n; i++) { var top = rise * (n - i); if (tall) { A.box(w, 0.05, 0.34, { z: 0.16 + i * 0.32, y: top - 0.05, t: 0, s: 1.6 }); A.box(w - 0.04, rise, 0.025, { z: 0.32 + i * 0.32 - 0.02, y: top - rise - 0.04, t: 1, s: 1.6, nb: true }); } else A.box(w, top, 0.32, { z: 0.16 + i * 0.32, t: 0, s: 1.6, nb: true }); }
      if (tall) { var L = Math.hypot(run, H), ang = Math.atan2(H, run); [-w / 2 - 0.04, w / 2 + 0.04].forEach(function (x) { A.box(0.07, 0.26, L + 0.1, { x: x, y: H / 2 - 0.12, z: run / 2, rx: ang, c: true, t: 1, s: 1.6 }); A.box(0.09, H + 1.0, 0.09, { x: x, y: 0, z: 0.05, t: 1, nb: true }); A.box(0.09, 0.95, 0.09, { x: x, y: 0, z: run - 0.06, t: 1, nb: true }); A.bar([x, H + 0.95, 0.05], [x, 0.95, run - 0.06], 0.07, 1); }); }
      else [-w / 2 - 0.03, w / 2 + 0.03].forEach(function (x) { A.box(0.06, H + 0.04, run, { x: x, z: run / 2, t: 1, nb: true }); });
      return { solids: tall ? [[-w / 2 - 0.04, run / 2, 0.12, run, 0, H + 1.0], [w / 2 + 0.04, run / 2, 0.12, run, 0, H + 1.0]] : [] }; }); }
  // a plank deck panel w by d at height h (for the new terraces), with a fascia
  function deckProp(w, d, h) { var key = "deck_" + Math.round(w * 10) + "_" + Math.round(d * 10) + "_" + Math.round(h * 100); return P(key, function (A) { var nx = Math.max(1, Math.round(w / 1.6)), nz = Math.max(1, Math.round(d / 1.2)); for (var i = 0; i < nx; i++) for (var j = 0; j < nz; j++) A.box(w / nx, 0.02, d / nz, { x: -w / 2 + (i + 0.5) * w / nx, y: h - 0.02, z: -d / 2 + (j + 0.5) * d / nz, t: 0, s: 1.6, nb: true }); A.box(w, h - 0.02, 0.04, { z: d / 2 - 0.02, t: 1, s: 1.6, nb: true, nt: true }); A.box(w, h - 0.02, 0.04, { z: -d / 2 + 0.02, t: 1, s: 1.6, nb: true, nt: true }); A.box(0.04, h - 0.02, d, { x: w / 2 - 0.02, t: 1, s: 1.6, nb: true, nt: true }); A.box(0.04, h - 0.02, d, { x: -w / 2 + 0.02, t: 1, s: 1.6, nb: true, nt: true }); return { cast: false }; }); }

  // ───────────────────────── layout: a building's porch sides in their facade frame ─────────────────────────
  // a facade frame: yaw Y (world), origin O (world x, z), base y; (u, v) -> world: x = O.x + u cos Y + v sin Y, z = O.z - u sin Y + v cos Y
  function F(e, side, s, m) { var Y = e[3] + (side.back ? PI : 0) + (side.a || 0); var c = Math.cos(Y), sn = Math.sin(Y), sc = e[4] || 1; var base = e[1] - ((m && m.sink) || 0) - (e.sink || 0);
    return { Y: Y, c: c, s: sn, sc: sc, x: e[0], z: e[2], y: base, w: function (u, v) { u *= sc; v *= sc; return [e[0] + u * c + v * sn, e[2] - u * sn + v * c]; } }; }
  // the client's walk-in mat (client.js updatePrompt: door.r * 0.86 + 0.9 in front of the origin along the yaw)
  function matPoint(kind, e) { try { var rr = MODELS[kind].radius * (e[4] || 1) * 0.86; return [e[0] + Math.sin(e[3]) * (rr + 0.9), e[2] + Math.cos(e[3]) * (rr + 0.9)]; } catch (x) { return null; } }
  function isDoorKind(kind) { try { return DOOR_KINDS.indexOf(kind) >= 0; } catch (x) { return false; } }

  // clearance for an item at ground level (not on the deck): no road, no walk ribbon, no other collider or solid, no prop
  var NEARP = null;
  function nearPropIndex() { if (NEARP) return NEARP; NEARP = new Map(); var C = 8; try { var skip = { store: 1, saloon: 1, hotel: 1, ranch: 1, casita: 1, villa: 1, diner: 1, restaurant: 1, glamp: 1, lakehouse: 1, storefront_sl: 1 }; for (var k in PLACE) { if (skip[k]) continue; var sp = MODEL_SPECS[k]; if (!sp) continue; var L = PLACE[k]; for (var i = 0; i < L.length; i++) { var e = L[i]; var key = Math.floor(e[0] / C) * 100003 + Math.floor(e[2] / C); var a = NEARP.get(key); if (!a) NEARP.set(key, a = []); a.push([e[0], e[2], k]); } } } catch (x) { note("prop index", x); } return NEARP; }
  // a road that carts and cars use (the plan's road classes; trails, promenades and plaza ribbons are walks)
  var VROADS = null;
  function vehicleRoad(x, z, extra) { try { if (!VROADS) { VROADS = []; var ids = {}; (window.PLAN && PLAN.roads || []).forEach(function (r) { if (r.class && r.class !== "trail") ids[r.id] = 1; }); ROADS.forEach(function (r) { if (r.plan && ids[r.plan]) VROADS.push(r); }); }
      for (var k = 0; k < VROADS.length; k++) { var r = VROADS[k], P0 = r.pts; for (var i = 0; i < P0.length - 1; i++) { var ax = P0[i][0], az = P0[i][1], vx = P0[i + 1][0] - ax, vz = P0[i + 1][1] - az, L2 = vx * vx + vz * vz || 1; var t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)); if (Math.hypot(x - (ax + vx * t), z - (az + vz * t)) < r.w / 2 + extra) return true; } } } catch (e) {} return false; }
  var WHY = PP.why = {};
  function no(k) { WHY[k] = (WHY[k] || 0) + 1; return false; }
  function groundClear(x, z, r, walkOk) { if (walkOk) { if (vehicleRoad(x, z, r + 0.6)) return no("vroad"); } else try { if (typeof nearRoad === "function" && nearRoad(x, z, r + 0.4)) return no("road"); } catch (e) {}
    if (!walkOk) try { var g = getH(x, z), w = (typeof walkAt === "function" && XG.walkReady) ? walkAt(x, z) : null; if (w !== null && w > g + 0.03) return no("walk"); if (roadLiftAt(x, z) > 0.03) return no("lift"); } catch (e) {}
    try { var CL = COLLIDERS, G0 = null; try { if (typeof cgFresh === "function" && typeof CGRID !== "undefined" && !CGRID.off) { cgFresh(); if (CGRID.map && !CGRID.full) { G0 = CGRID.map.get(Math.floor(x / CGRID.cell) * 100003 + Math.floor(z / CGRID.cell)) || []; } } } catch (e2) {} if (G0) CL = G0;
      for (var i = 0; i < CL.length; i++) { var c = CL[i]; if (c[2] > 3) continue; var dx = c[0] - x, dz = c[1] - z; if (dx * dx + dz * dz < (c[2] + r) * (c[2] + r)) return no("collider"); } } catch (e) {}
    try { var N = nearPropIndex(), C = 8, cx = Math.floor(x / C), cz = Math.floor(z / C); for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) { var L = N.get((cx + a) * 100003 + cz + b); if (!L) continue; for (var j = 0; j < L.length; j++) { var p = L[j]; if (Math.hypot(p[0] - x, p[1] - z) < r + 0.9) return no("prop:" + p[2]); } } } catch (e) {}
    try { if (typeof distToRunway === "function" && distToRunway(x, z) < 90) return no("runway"); } catch (e) {}
    try { var y = planGroundAt(x, z); var q = collideSolids(x, z, y, r, 1.6); if (Math.hypot(q[0] - x, q[1] - z) > 0.01) return no("solid"); } catch (e) {}
    return true; }

  // the furniture sets a bay can take: each returns items [{p, u, v, ry, y}] in the facade frame (ry 0 faces out, +v) or null
  // (bay = { u0, u1, v0 (wall), v1 (deck edge), y (floor) }; style palette from the json)
  function pk(v, R, d) { if (v === undefined || v === null) return d; return Array.isArray(v) ? v[Math.floor(R() * v.length) % v.length] : v; }
  var SETS = {
    bench: function (b, R, P0) { var W = b.u1 - b.u0; if (W < 1.95) return null; var L = W < 2.3 ? "bench_c" : pk(P0.bench, R, "bench_w"); return [{ p: L, u: (b.u0 + b.u1) / 2 + (R() - 0.5) * Math.max(0, W - 2.2) * 0.5, v: b.v0 + 0.36, ry: 0 }]; },
    rockers: function (b, R, P0) { var W = b.u1 - b.u0, D = b.v1 - b.v0; if (W < 2.1 || D < 1.5) return null; var cu = (b.u0 + b.u1) / 2, sp = Math.min(0.75, W / 2 - 0.45), rk = pk(P0.rocker, R, "rocker_o"); var out = [{ p: rk, u: cu - sp, v: b.v0 + Math.min(0.85, D * 0.45), ry: 0.25 }, { p: rk, u: cu + sp, v: b.v0 + Math.min(0.85, D * 0.45), ry: -0.25 }]; if (W > 2.5) out.push({ p: R() < 0.5 ? "side_table" : "barrel", u: cu, v: b.v0 + 0.42, ry: R() * 3 }); return out; },
    checkers: function (b, R) { var W = b.u1 - b.u0, D = b.v1 - b.v0; if (W < 2.2 || D < 1.7) return null; var cu = (b.u0 + b.u1) / 2, cv = b.v0 + Math.min(0.95, D * 0.5); return [{ p: "checkers", u: cu, v: cv, ry: R() }, { p: "stool", u: cu - 0.62, v: cv, ry: PI / 2 }, { p: "stool", u: cu + 0.62, v: cv, ry: -PI / 2 }]; },
    goods: function (b, R) { var W = b.u1 - b.u0; if (W < 1.6) return null; var left = R() < 0.5; return [{ p: "goods", u: left ? b.u0 + 0.75 : b.u1 - 0.75, v: b.v0 + 0.42, ry: (R() - 0.5) * 0.2 }, { p: R() < 0.5 ? "sack" : "barrel", u: left ? b.u0 + 1.75 : b.u1 - 1.75, v: b.v0 + 0.35, ry: R() * 3 }].filter(function (q) { return q.u > b.u0 + 0.3 && q.u < b.u1 - 0.3; }); },
    barrels: function (b, R) { var left = R() < 0.5; return [{ p: "barrels2", u: left ? b.u0 + 0.5 : b.u1 - 1.1, v: b.v0 + 0.4, ry: (R() - 0.5) * 0.4 }]; },
    swing: function (b, R, P0) { var W = b.u1 - b.u0; if (W < 2.0 || !P0.swing) return null; return [{ p: "swing", u: (b.u0 + b.u1) / 2, v: b.v0 + 0.55, ry: 0, hang: true }]; },
    bistro: function (b, R, P0) { var W = b.u1 - b.u0, D = b.v1 - b.v0; if (W < 1.9 || D < 1.6) return null; var cu = (b.u0 + b.u1) / 2, cv = b.v0 + D * 0.52, ch = pk(P0.chair, R, "bistro_c"); var out = [{ p: "bistro_t", u: cu, v: cv, ry: 0 }, { p: ch, u: cu - 0.6, v: cv, ry: PI / 2 + 0.15 }, { p: ch, u: cu + 0.6, v: cv, ry: -PI / 2 - 0.15 }]; return out; },
    equipales: function (b, R) { var W = b.u1 - b.u0, D = b.v1 - b.v0; if (W < 1.9 || D < 1.4) return null; var cu = (b.u0 + b.u1) / 2, cv = b.v0 + Math.min(0.75, D * 0.42); return [{ p: "equipale", u: cu - 0.55, v: cv, ry: 0.35 }, { p: "equipale", u: cu + 0.55, v: cv, ry: -0.35 }, { p: "side_table", u: cu, v: cv - 0.2, ry: 0 }, { p: "rug", u: cu, v: cv + 0.15, ry: 0, flat: true }]; },
    pots: function (b, R) { return [{ p: R() < 0.5 ? "pot_agave" : "pot_saguaro", u: b.u0 + 0.35, v: b.v0 + 0.32, ry: R() * 6 }, { p: R() < 0.5 ? "pot_pair" : "pot_agave", u: b.u1 - 0.45, v: b.v0 + 0.32, ry: R() * 6 }]; },
    wheel: function (b, R) { return [{ p: "wheel", u: b.u0 + 0.7 + R() * Math.max(0, b.u1 - b.u0 - 1.4), v: b.v0 + 0.1, ry: 0, lean: true }]; },
    adk: function (b, R, P0) { var W = b.u1 - b.u0; if (W < 2.0) return null; var cu = (b.u0 + b.u1) / 2, cv = b.v0 + (b.v1 - b.v0) * 0.5, a = pk(P0.adk, R, "adk_c"); return [{ p: a, u: cu - 0.55, v: cv, ry: 0.3 }, { p: a, u: cu + 0.55, v: cv, ry: -0.3 }, { p: "side_table", u: cu, v: cv - 0.15, ry: 0 }]; }
  };

  // ───────────────────────── the plan: every placed building of a configured kind ─────────────────────────
  var PLAN_LIST = PP.list = [];          // { kind, i, e, items: [...], decks: [...], solids: [...], seats: [...], mat, name }
  function bldName(kind, e) { try { var P0 = window.PLAN, bs = P0 && P0.buildings, best = null, bd = 1e9; if (!bs) return null; var kinds = kind === "storefront_sl" ? { store: 1, storefront_sl: 1 } : null; for (var i = 0; i < bs.length; i++) { var b = bs[i]; if (kinds ? !kinds[b.kind] : b.kind !== kind) continue; var d = Math.hypot(b.x - e[0], b.z - e[2]); if (d < bd) { bd = d; best = b; } } return best && bd < 8 ? best : null; } catch (x) { return null; } }
  function cafeName(n) { return /coffee|cafe|café|soda|diner|candy|bakery|ice cream|noodle|taco|deli|tavern|cider|kitchen|grill|cantina|fountain/i.test(n || ""); }
  function layoutOne(kind, K, e, i) {
    var C = cfg(), m = MODELS[kind]; if (!m) return null; var b = bldName(kind, e), name = b && b.name || ""; var seed = hash(kind + ":" + (b ? b.id : i)); var R = rng(seed);
    var out = { kind: kind, i: i, e: e, name: name, id: b ? b.id : kind + i, items: [], decks: [], walk: [], solids: [], seats: [], keep: [], bodies: [], ground: [], fixed: [] };
    var mat = isDoorKind(kind) ? matPoint(kind, e) : null; out.mat = mat;
    var pal = K.palette || {}; var cafe = K.cafe || (pal.cafeByName && cafeName(name));
    (K.sides || []).forEach(function (S, si) {
      var fr = F(e, S, null, m); var h = S.h || 0; var D = S.deck; if (!D) return;
      // the deck floor: walk grid (low decks) or step solids (high ones)
      out.decks.push({ fr: fr, u0: D[0], u1: D[1], v0: D[2], v1: D[3], h: h, round: S.round, solid: h > 0.5 || S.solidDeck, nowalk: S.nowalk });
      // posts
      (S.posts || []).forEach(function (p) { out.solids.push({ fr: fr, u: p[0], v: p[1], w: p[2] || 0.26, d: p[3] || 0.26, y0: 0, y1: S.ceil || 3, tag: "post" }); });
      // steps (high decks get plank steps where the client's mat or the door corridor meets the deck edge)
      if (S.steps) S.steps.forEach(function (st) { var n = Math.max(1, Math.round(h / 0.19)), rise = h / (n + 1); if (h < 0.24) return; out.items.push({ fr: fr, p: stepsProp(n, rise, st[1]).name, u: st[0], v: D[3], ry: 0, y: 0, step: { n: n, rise: rise, w: st[1] } }); });
      // bays between posts, minus the door corridor and the kept-out boxes
      var cuts = (S.posts || []).map(function (p) { return p[0]; }).filter(function (u) { return u > D[0] + 0.4 && u < D[1] - 0.4; }); cuts.sort(function (a, c) { return a - c; });
      var edges = [D[0]].concat(cuts, [D[1]]); var bays = [];
      if (S.bays) { S.bays.forEach(function (b0, k) { bays.push({ u0: b0[0], u1: b0[1], v0: b0[2], v1: b0[3], y: h, k: k, sets: b0[4] }); }); edges = []; }
      for (var k = 0; k < edges.length - 1; k++) { var u0 = edges[k] + (k > 0 ? 0.22 : 0.12), u1 = edges[k + 1] - (k < edges.length - 2 ? 0.22 : 0.12); var dc = S.door || []; for (var q = 0; q + 1 < dc.length; q += 2) { var a0 = dc[q] - 0.25, a1 = dc[q + 1] + 0.25; if (a1 <= u0 || a0 >= u1) continue; if (a0 - u0 > u1 - a1) u1 = Math.min(u1, a0); else u0 = Math.max(u0, a1); } (S.keep || []).forEach(function (kb) { if (kb[3] < D[2] + 0.9) return; if (kb[1] <= u0 || kb[0] >= u1) return; if (kb[0] - u0 > u1 - kb[1]) u1 = Math.min(u1, kb[0] - 0.1); else u0 = Math.max(u0, kb[1] + 0.1); }); if (u1 - u0 >= 1.1) bays.push({ u0: u0, u1: u1, v0: D[2], v1: D[3] - 0.15, y: h, k: k }); }
      // furnish: weighted choice per bay from the side's palette, never the same set twice in a row
      var sets = S.sets || pal.sets || ["bench", "pots"]; var w = S.weights || pal.weights || null; var last = "";
      bays.forEach(function (bay, bi) { var tries = 0, got = null; while (tries++ < 6 && !got) { var bs = bay.sets || sets; var pick = bs[Math.floor(R() * bs.length)]; if (w && !bay.sets) { var tot = 0, rr = R(); for (var z = 0; z < sets.length; z++) tot += w[z] || 1; rr *= tot; for (var z2 = 0; z2 < sets.length; z2++) { rr -= w[z2] || 1; if (rr <= 0) { pick = sets[z2]; break; } } } if (pick === last && tries < 5) continue; if (cafe && R() < 0.75 && SETS.bistro && (!bay.sets || bay.sets.indexOf("nocafe") < 0)) pick = "bistro"; var fn = SETS[pick]; if (!fn) continue; var it = fn(bay, R, pal); if (it && it.length) { got = it; last = pick; } } if (got) got.forEach(function (q) { q.fr = fr; q.y = q.y === undefined ? h : q.y; q.side = si; out.items.push(q); }); });
      // lanterns on the posts (or the wall) under the porch roof
      if (S.ceil && pal.lanterns !== false) { var dl = S.door || []; var ly = Math.min(S.ceil - 0.45, 2.45) ; if (dl.length >= 2) { var both = R() < 0.6; out.items.push({ fr: fr, p: "lantern", u: dl[0] - 0.3, v: S.wall + 0.02, ry: 0, y: ly }); if (both) out.items.push({ fr: fr, p: "lantern", u: dl[1] + 0.3, v: S.wall + 0.02, ry: 0, y: ly }); }
        else if (S.posts && S.posts.length) { var p0 = S.posts[Math.floor(R() * S.posts.length)]; out.items.push({ fr: fr, p: "lantern", u: p0[0], v: p0[1] + 0.13, ry: 0, y: ly }); } }
      // ground-level dressing in front of the deck: hitching rails, umbrella tables, planters (checked for clearance at build)
      var gl = S.ground || pal.ground || []; gl.forEach(function (g0) { if (R() > (g0[2] === undefined ? 0.6 : g0[2])) return; out.ground.push({ fr: fr, p: g0[0], v: D[3] + (g0[1] || 1.0), side: si, S: S }); });
      if (cafe && K.cafeGround) K.cafeGround.forEach(function (g0) { out.ground.push({ fr: fr, p: g0[0], v: D[3] + (g0[1] || 1.6), side: si, S: S, cafe: true }); });
    });
    (Array.isArray(K.body) ? K.body : K.body ? [K.body] : []).forEach(function (B) { out.bodies.push({ fr: F(e, { a: B.a !== undefined ? B.a : ((K.sides && K.sides[0] && K.sides[0].a) || 0) }, null, m), u0: B.u[0], u1: B.u[1], v0: B.v[0], v1: B.v[1], h: B.h || m.height, round: B.round }); });
    if (K.variants && K.variants.length) { var VA = K.variants[Math.floor(R() * K.variants.length)]; var fr0 = F(e, { a: K.va || 0 }, null, m); VA.forEach(function (q) { if (q[4] !== undefined && R() > q[4]) return; out.items.push({ fr: fr0, p: pk(q[0], R), u: q[1], v: q[2], ry: q[3] || 0, y: K.vy || 0 }); }); }
    if (K.extra) K.extra.forEach(function (x) { var fr = F(e, { a: x.a || 0, back: x.back }, null, m); if (x.seat) out.seatsX = (out.seatsX || []).concat([{ fr: fr, u: x.seat[0], v: x.seat[1], w: x.seat[2], d: x.seat[3], y1: x.seat[4], ry: x.ry || 0 }]); if (x.solid) out.solids.push({ fr: fr, u: x.solid[0], v: x.solid[1], w: x.solid[2], d: x.solid[3], y0: 0, y1: x.solid[4], ry: x.ry || 0, tag: "x", climb: !!x.climb }); if (x.stairs) { var q = x.stairs; out.items.push({ fr: fr, p: stepsProp(q[3], q[4], q[5]).name, u: q[0], v: q[1], ry: q[2], y: 0, step: { n: q[3], rise: q[4], w: q[5] } }); } if (x.p) out.items.push({ fr: fr, p: x.p, u: x.u, v: x.v, ry: x.ry || 0, y: x.y || 0, glow: x.glow }); });
    if (K.fixed) { var frF = F(e, { a: K.fa || 0 }, null, m); K.fixed.forEach(function (q) { if (q[4] !== undefined && R() > q[4]) return; out.fixed.push({ fr: frF, p: q[0], u: q[1], v: q[2], ry: q[3] || 0, cafe: q[0] === "cafe" }); }); }
    if (cafe && K.cafeFixed) { var frC = F(e, { a: K.fa || 0 }, null, m); K.cafeFixed.forEach(function (q) { out.fixed.push({ fr: frC, p: "cafe", u: q[0], v: q[1], ry: q[2] || 0, cafe: true }); }); }
    var fh = (K.sides && K.sides[0] && K.sides[0].h) || 0; out.items.slice().forEach(function (it) { if (it.p === "lantern") out.items.push({ fr: it.fr, p: "pool", u: it.u, v: it.v + 0.9, ry: 0, y: fh }); else if (it.p === "lantern_hang") out.items.push({ fr: it.fr, p: "pool", u: it.u, v: it.v + 0.3, ry: 0, y: K.vy || fh }); });
    if (mat) { var keepI = []; out.items.forEach(function (it) { if (it.step || it.p === "lantern" || it.p === "pool" || it.p === "lantern_hang") { keepI.push(it); return; } var pr = PROPS[it.p]; var p = it.fr.w(it.u, it.v); var d = Math.hypot(p[0] - mat[0], p[1] - mat[1]); if (d < 1.4 || (pr && pr.seats.length && d < 2.05)) { PP.n.dropMat = (PP.n.dropMat || 0) + 1; return; } keepI.push(it); }); out.items = keepI; }
    return out;
  }
  // resolve ground items: pick a free u slot along the front, skipping the door corridor, the mat and every blocked point
  function cafeSet(L, fr, u0, v0, R) { var um = ["umb_r", "umb_g", "umb_t"][Math.floor(R() * 3)], ch = R() < 0.5 ? "bistro_c" : "bistro_cg"; L.items.push({ fr: fr, p: "bistro_t", u: u0, v: v0, ry: 0, y: 0, gnd: true }, { fr: fr, p: um, u: u0, v: v0, ry: R(), y: 0, gnd: true }, { fr: fr, p: ch, u: u0 - 0.62, v: v0 + 0.1, ry: PI / 2 + 0.2, y: 0, gnd: true }, { fr: fr, p: ch, u: u0 + 0.62, v: v0 - 0.1, ry: -PI / 2 - 0.2, y: 0, gnd: true }); if (R() < 0.5) L.items.push({ fr: fr, p: ch, u: u0 + 0.05, v: v0 + 0.66, ry: PI, y: 0, gnd: true }); }
  function placeGround(L) {
    var kept = [];
    L.fixed.forEach(function (q) { var R = rng(hash(L.id + "f" + q.u + "," + q.v)); var rr = q.cafe ? 1.0 : 0.5; var ok = true; for (var t = 0; t < 5 && ok; t++) { var a = t * 1.2566, p = t === 4 ? q.fr.w(q.u, q.v) : q.fr.w(q.u + Math.cos(a) * rr * 0.8, q.v + Math.sin(a) * rr * 0.8); if (L.mat && Math.hypot(p[0] - L.mat[0], p[1] - L.mat[1]) < (q.cafe || (PROPS[q.p] && PROPS[q.p].seats.length) ? 2.1 : 1.5)) ok = no("mat"); else if (!groundClear(p[0], p[1], 0.35, true)) ok = false; } if (!ok) { PP.n.fixedSkip = (PP.n.fixedSkip || 0) + 1; return; } kept.push(q.fr.w(q.u, q.v)); if (q.cafe) cafeSet(L, q.fr, q.u, q.v, R); else L.items.push({ fr: q.fr, p: q.p, u: q.u, v: q.v, ry: q.ry, y: 0, gnd: true }); });
    L.ground.forEach(function (g0) { var S = g0.S, D = S.deck, fr = g0.fr, pr = PROPS[g0.p]; if (!pr && !g0.cafe) return; var half = g0.p === "hitch" ? 1.45 : g0.cafe ? 1.0 : 0.6; var R = rng(hash(L.id + g0.p + g0.side));
      var cands = []; for (var u = D[0] + half; u <= D[1] - half; u += 0.5) cands.push(u); cands.sort(function () { return R() - 0.5; });
      for (var c = 0; c < cands.length; c++) { var u0 = cands[c]; var bad = false; var dc = S.door || []; for (var q = 0; q + 1 < dc.length; q += 2) if (u0 + half > dc[q] - 0.6 && u0 - half < dc[q + 1] + 0.6) bad = true; if (g0.cafe && S.board && u0 + 1.35 > S.board[0] && u0 - 1.35 < S.board[1]) bad = true; if (bad) continue;
        var ok = true, sp = g0.cafe ? 0.68 : g0.p === "hitch" ? 1.25 : 0; for (var t = -1; t <= 1 && ok; t++) { var p = fr.w(u0 + t * sp, g0.v); if (L.mat && Math.hypot(p[0] - L.mat[0], p[1] - L.mat[1]) < (g0.cafe ? 2.1 : 1.5)) ok = no("mat"); else if (!groundClear(p[0], p[1], 0.5, g0.cafe)) ok = false; for (var k = 0; k < kept.length && ok; k++) if (Math.hypot(p[0] - kept[k][0], p[1] - kept[k][1]) < 2.2) ok = false; }
        if (!ok) continue; var pc = fr.w(u0, g0.v); kept.push(pc);
        if (g0.cafe) cafeSet(L, fr, u0, g0.v, R);
        else L.items.push({ fr: fr, p: g0.p, u: u0, v: g0.v, ry: g0.p === "hitch" ? 0 : R() * 6, y: 0, gnd: true });
        break; } });
  }
  function planAll() {
    PLAN_LIST.length = 0; var C = cfg(); if (!C || !C.kinds) { note("plan", "no config"); return; } propsInit();
    for (var kind in C.kinds) { var K = C.kinds[kind], L = (typeof PLACE !== "undefined" && PLACE[kind]) || []; if (!MODELS[kind] || !L.length) continue; var nk = 0;
      for (var i = 0; i < L.length; i++) { try { var o = layoutOne(kind, K, L[i], i); if (o) { PLAN_LIST.push(o); nk++; } } catch (x) { note("layout " + kind + " " + i, x); } }
      PP.n["b_" + kind] = nk; }
    PP.n.buildings = PLAN_LIST.length;
  }

  // ───────────────────────── world hook: keep the scatter (rocks, plants) off the porches and their fronts ─────────────────────────
  function worldHook() {
    var t0 = performance.now();
    try { planAll(); } catch (e) { note("plan", e); return; }
    // small circles along each deck (the deck and 1 m in front), and one per ground or fixed item spot, so nothing is planted on them
    try { var nk = 0; PLAN_LIST.forEach(function (L) { L.decks.forEach(function (D) { if (D.round) { var c = D.fr.w(0, 0); KEEPOUT.push([c[0], c[1], (D.round[1] + 0.6) * D.fr.sc]); nk++; return; } var dep = D.v1 - D.v0, n = Math.max(1, Math.ceil((D.u1 - D.u0) / 3)), r = Math.max(1.6, dep / 2 + 1.0) * D.fr.sc; for (var i = 0; i < n; i++) { var p = D.fr.w(D.u0 + (i + 0.5) * (D.u1 - D.u0) / n, (D.v0 + D.v1) / 2 + 0.4); KEEPOUT.push([p[0], p[1], r]); nk++; } }); L.fixed.forEach(function (q) { var p = q.fr.w(q.u, q.v); KEEPOUT.push([p[0], p[1], q.cafe ? 1.6 : 1.0]); nk++; }); }); PP.n.keepouts = nk; } catch (e) { note("keepouts", e); }
    PP.n.worldMs = Math.round(performance.now() - t0);
  }

  // ───────────────────────── defer hook: draw, collide, walk ─────────────────────────
  var GROUP = null, CHUNKS = PP.chunks = [], CH = 400;
  function addSolidW(fr, u, v, w, d, y0, y1, ry, seat, face) { var p = fr.w(u, v); var sd = addSolid(p[0], p[1], fr.Y + (ry || 0), w * fr.sc, d * fr.sc, fr.y + y0, fr.y + y1, "porch"); if (sd && seat) { sd.seat = true; sd.face = fr.Y + (face === undefined ? (ry || 0) : face); } return sd; }
  function tagSeat(sd, rp, L) { if (!sd) return; sd.rp = rp; sd.rk = L.kind; sd.rn = L.name || ""; }
  function walkQuad(fr, u0, u1, v0, v1, h) { var a = fr.w(u0, v0), b = fr.w(u1, v0), c = fr.w(u1, v1), d = fr.w(u0, v1), y = fr.y + h * fr.sc; var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute([a[0], y, a[1], b[0], y, b[1], c[0], y, c[1], a[0], y, a[1], c[0], y, c[1], d[0], y, d[1]], 3)); try { walkAdd(g); } catch (e) { note("walkAdd", e); } g.dispose(); }
  function walkRing(fr, r0, r1, h) { var P2 = [], y = fr.y + h * fr.sc, n = 28; for (var i = 0; i < n; i++) { var a0 = i / n * TAU, a1 = (i + 1) / n * TAU; var p0 = fr.w(Math.sin(a0) * r0, Math.cos(a0) * r0), p1 = fr.w(Math.sin(a1) * r0, Math.cos(a1) * r0), q0 = fr.w(Math.sin(a0) * r1, Math.cos(a0) * r1), q1 = fr.w(Math.sin(a1) * r1, Math.cos(a1) * r1); P2.push(p0[0], y, p0[1], q0[0], y, q0[1], q1[0], y, q1[1], p0[0], y, p0[1], q1[0], y, q1[1], p1[0], y, p1[1]); } var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P2, 3)); try { walkAdd(g); } catch (e) { note("walkRing", e); } g.dispose(); }
  // the building's round collider(s) -> an inscribed circle on the body, the walls as a box solid
  // the building's outer walls as thin solids (0.3 m, their outer face on the measured wall line), so a room built inside the walls,
  // anything that walks or looks across the inside, and plan_rooms' solid parking all see an empty interior; where two body boxes
  // meet (the villa's L plan) the shared stretch is left out
  function bodyWalls(L) { var BS = L.bodies.filter(function (B) { return !B.round; }); var T = 0.3, n = 0;
    function inOther(B, u, v) { for (var k = 0; k < BS.length; k++) { var O = BS[k]; if (O === B || Math.abs(O.fr.Y - B.fr.Y) > 1e-4) continue; if (u >= O.u0 - 0.05 && u <= O.u1 + 0.05 && v >= O.v0 - 0.05 && v <= O.v1 + 0.05) return true; } return false; }
    BS.forEach(function (B) { var fr = B.fr, H = Math.min(B.h || 6, 8);
      [[0, B.v1, -1], [0, B.v0, 1], [1, B.u0, 1], [1, B.u1, -1]].forEach(function (E) { var alongU = E[0] === 0, a0 = alongU ? B.u0 : B.v0, a1 = alongU ? B.u1 : B.v1, cuts = [a0, a1];
        BS.forEach(function (O) { if (O === B) return; (alongU ? [O.u0, O.u1] : [O.v0, O.v1]).forEach(function (c) { if (c > a0 && c < a1) cuts.push(c); }); }); cuts.sort(function (x, y) { return x - y; });
        for (var i = 0; i < cuts.length - 1; i++) { var s0 = cuts[i], s1 = cuts[i + 1]; if (s1 - s0 < 0.1) continue; var m = (s0 + s1) / 2; if (alongU ? inOther(B, m, E[1]) : inOther(B, E[1], m)) continue;
          var off = E[1] + E[2] * (T / 2 - 0.03); var sd = alongU ? addSolidW(fr, m, off, s1 - s0, T, -0.2, H, 0) : addSolidW(fr, off, m, T, s1 - s0, -0.2, H, 0); if (sd) { sd.rpWall = true; sd.rpE = L.e; n++; } } }); });
    PP.n.walls = (PP.n.walls || 0) + n; }
  // the building's round collider(s) keep their centres (other modules find them by position) and shrink to stay inside the walls;
  // the walls themselves become a box solid, so the porch in front of them is free to walk
  function fixColliders(L) { var e = L.e, n = 0; var R0 = MODELS[L.kind].radius * (e[4] || 1) + 1;
    bodyWalls(L);
    for (var i = 0; i < COLLIDERS.length; i++) { var c = COLLIDERS[i]; if (c[2] < 1.5) continue; var dx = c[0] - e[0], dz = c[1] - e[2]; if (dx * dx + dz * dz > R0 * R0) continue; var best = -1;
      L.bodies.forEach(function (B) { var fr = B.fr, sc = fr.sc; var lu = (dx * fr.c - dz * fr.s) / sc, lv = (dx * fr.s + dz * fr.c) / sc; if (B.round) { if (Math.hypot(lu, lv) < B.round) best = Math.max(best, Math.min(c[2], B.round * sc)); return; } if (lu < B.u0 || lu > B.u1 || lv < B.v0 || lv > B.v1) return; var m = Math.min(lu - B.u0, B.u1 - lu, lv - B.v0, B.v1 - lv) * sc - 0.65; best = Math.max(best, Math.max(0.8, Math.min(c[2], m))); });
      if (best < 0) continue; if (!L.saved) L.saved = []; L.saved.push([c, c[0], c[1], c[2]]); c[2] = best; n++; }
    PP.n.colliders = (PP.n.colliders || 0) + n; }
  function itemMatrix(it, out) { var fr = it.fr; var p = fr.w(it.u, it.v); var y = it.gnd ? gndY(p[0], p[1]) : fr.y + (it.y || 0) * fr.sc; _e.set(it.lean ? -0.18 : 0, fr.Y + (it.ry || 0), 0, "YXZ"); _q.setFromEuler(_e); out.compose(_v.set(p[0], y, p[1]), _q, _v2.set(1, 1, 1)); return out; }
  function gndY(x, z) { try { return planGroundAt(x, z); } catch (e) { return getH(x, z); } }
  function chunkOf(x, z) { var k = Math.floor(x / CH) + "," + Math.floor(z / CH); for (var i = 0; i < CHUNKS.length; i++) if (CHUNKS[i].k === k) return CHUNKS[i]; var c = { k: k, x0: Math.floor(x / CH) * CH, z0: Math.floor(z / CH) * CH, items: [], meshes: [], vis: true }; CHUNKS.push(c); return c; }
  // the build runs in slices (PLAN_PERF.step, a few ms a frame): eight buildings at a time, then one chunk's batches at a time
  function buildOne(L, CN) {
      try {
        fixColliders(L);
        L.decks.forEach(function (D) { if (D.nowalk) return; if (D.round) { if (D.solid) { for (var a = 0; a < 24; a++) { var an = (a + 0.5) / 24 * TAU, rm = (D.round[0] + D.round[1]) / 2, len = (D.round[1] - D.round[0]); addSolidW(D.fr, Math.sin(an) * rm, Math.cos(an) * rm, Math.max(0.6, TAU * rm / 24 + 0.15), len + 0.1, D.h - 0.45, D.h, an); } } else walkRing(D.fr, D.round[0], D.round[1], D.h); return; }
          if (D.solid) { var nu = Math.max(1, Math.round((D.u1 - D.u0) / 3)), nv = Math.max(1, Math.round((D.v1 - D.v0) / 3)); for (var i = 0; i < nu; i++) for (var j = 0; j < nv; j++) addSolidW(D.fr, D.u0 + (i + 0.5) * (D.u1 - D.u0) / nu, D.v0 + (j + 0.5) * (D.v1 - D.v0) / nv, (D.u1 - D.u0) / nu + 0.05, (D.v1 - D.v0) / nv + 0.05, D.h - 0.45, D.h, 0); }
          else if (D.h > 0.03) walkQuad(D.fr, D.u0, D.u1, D.v0, D.v1, D.h); });
        L.solids.forEach(function (s) { var s0 = addSolidW(s.fr, s.u, s.v, s.w, s.d, s.y0, s.y1, s.ry || 0); if (s0) { CN.sol++; if (!s.climb) s0.noStep = true; } });
        (L.seatsX || []).forEach(function (s) { var sd = addSolidW(s.fr, s.u, s.v, s.w, s.d, 0, s.y1, s.ry, true); if (sd) { CN.seats++; sd.noStep = true; tagSeat(sd, "patio", L); } });
        placeGround(L);
        L.items.forEach(function (it) { var pr = PROPS[it.p]; if (!pr) return; var mt = new THREE.Matrix4(); itemMatrix(it, mt); var px = mt.elements[12], pz = mt.elements[14];
          if (it.step) { var w = it.step.w, n = it.step.n, rise = it.step.rise, sr = Math.sin(it.ry || 0), cr = Math.cos(it.ry || 0); for (var k = 0; k < n; k++) { var dz = 0.16 + k * 0.32; addSolidW(it.fr, it.u + sr * dz, it.v + cr * dz, w, 0.32, -0.1, rise * (n - k), it.ry || 0); } }
          var yb = mt.elements[13] - it.fr.y; pr.seats.forEach(function (s) { var ca = Math.cos(it.ry || 0), sa = Math.sin(it.ry || 0); var du = s[0] * ca + s[1] * sa, dv = -s[0] * sa + s[1] * ca; var sd = addSolidW(it.fr, it.u + du, it.v + dv, s[2], s[3], yb, yb + s[4], it.ry || 0, true); if (sd) { CN.seats++; sd.noStep = true; tagSeat(sd, it.p, L); } });
          pr.solids.forEach(function (s) { var ca = Math.cos(it.ry || 0), sa = Math.sin(it.ry || 0); var du = s[0] * ca + s[1] * sa, dv = -s[0] * sa + s[1] * ca; var s1 = addSolidW(it.fr, it.u + du, it.v + dv, s[2], s[3], yb + s[4], yb + s[5], it.ry || 0); if (s1) { CN.sol++; s1.noStep = true; } });
          chunkOf(px, pz).items.push([pr, mt]); CN.items++; if (it.gnd) CN.ground++; });
      } catch (x) { note("build " + L.kind + " " + L.i, x); }
  }
  function* buildGen() {
    var t0 = performance.now(), CN = { seats: 0, sol: 0, items: 0, ground: 0, work: 0 }; PP.phase = "mats"; mats(); yield; PP.phase = "props"; propsInit(); yield; PP.phase = "layout";
    // the layout again: the placements' heights are final now (the world hook ran before the instancing seated them)
    PLAN_LIST.length = 0; var C = cfg(); var nl = 0; for (var kind in C.kinds) { var K = C.kinds[kind], LL = (typeof PLACE !== "undefined" && PLACE[kind]) || []; if (!MODELS[kind] || !LL.length) continue; var nk = 0;
      for (var i = 0; i < LL.length; i++) { try { var o = layoutOne(kind, K, LL[i], i); if (o) { PLAN_LIST.push(o); nk++; } } catch (x) { note("layout " + kind + " " + i, x); } if ((++nl & 31) === 0) yield; } PP.n["b_" + kind] = nk; }
    PP.n.buildings = PLAN_LIST.length;
    try { var hasP = false; for (var q0 = 0; q0 < SOLIDS.length; q0++) if (SOLIDS[q0].tag === "porch") { hasP = true; break; } if (hasP) clearSolids("porch"); } catch (e) {}   // (clearSolids always forces a full rebuild of the client's solid grid)
    yield;
    for (var bi = 0; bi < PLAN_LIST.length; bi++) { PP.phase = "b" + bi + PLAN_LIST[bi].kind; buildOne(PLAN_LIST[bi], CN); if ((bi & 3) === 3) yield; }
    PP.phase = "cg";
    try { if (typeof cgBuild === "function") cgBuild(); } catch (e) {}
    // one BatchedMesh per chunk and base: c (casts shadows), n (no shadow), g (glow)
    GROUP = new THREE.Group(); GROUP.name = "rp_porches"; GROUP.userData.noCull = true; var nb = 0, tris = 0;
    function chunkBatches(C0) { var sets = { c: [], n: [], g: [], h: [] }; C0.items.forEach(function (q) { var pr = q[0]; if (pr.a) sets[pr.cast ? "c" : "n"].push([pr.a, q[1]]); if (pr.g) sets.g.push([pr.g, q[1]]); if (pr.h) sets.h.push([pr.h, q[1]]); });
      for (var key in sets) { var L2 = sets[key]; if (!L2.length) continue; var geos = [], vc = 0; L2.forEach(function (q) { if (geos.indexOf(q[0]) < 0) { geos.push(q[0]); vc += q[0].attributes.position.count; } });
        var bm = new THREE.BatchedMesh(L2.length, vc, 0, key === "g" ? MAT.glow : key === "h" ? MAT.halo : MAT.atlas); bm.name = "rp_b_" + key + "_" + C0.k; bm.sortObjects = false; bm.perObjectFrustumCulled = true; bm.castShadow = key === "c"; bm.receiveShadow = key !== "g" && key !== "h"; if (key === "h") { bm.renderOrder = 3; bm.userData.halo = true; bm.userData.noShadow = true; } bm.userData.shSet = true; bm.userData.noShadow = !bm.castShadow;
        var gid = new Map(); geos.forEach(function (g) { gid.set(g, bm.addGeometry(g)); }); if (!C0.inst) C0.inst = []; L2.forEach(function (q) { var id = bm.addInstance(gid.get(q[0])); bm.setMatrixAt(id, q[1]); C0.inst.push([bm, id, q[1].elements[12], q[1].elements[14]]); tris += q[0].attributes.position.count / 3; });
        bm.computeBoundingBox(); bm.computeBoundingSphere(); C0.meshes.push(bm); GROUP.add(bm); nb++; } C0.items = []; }
    for (var ci = 0; ci < CHUNKS.length; ci++) { PP.phase = "chunk" + ci; chunkBatches(CHUNKS[ci]); yield; } PP.phase = "add";
    scene.add(GROUP); GROUP.updateMatrixWorld(true);
    try { var W = window.PLAN_PERF; if (W && W.warmGroup) W.warmGroup(GROUP, { name: "porches" }); } catch (e) { note("warm", e); }
    PP.n.seats = CN.seats; PP.n.solids = CN.sol; PP.n.items = CN.items; PP.n.ground = CN.ground; PP.n.batches = nb; PP.n.tris = Math.round(tris); PP.n.chunks = CHUNKS.length; PP.n.buildMs = Math.round(performance.now() - t0); PP.n.buildWorkMs = Math.round(CN.work);
    PP.ready = true; PP.building = false;
  }
  var GEN = null;
  function build() { GEN = buildGen(); PP.building = true; var W = window.PLAN_PERF; if (!(W && W.step) || PP.sync) { var r; do { r = GEN.next(); } while (!r.done); GEN = null; } }
  function buildStep() { if (!GEN) return; try { var t = performance.now(), r; do { var t1 = performance.now(); r = GEN.next(); var d1 = performance.now() - t1; if (d1 > 6) { var lg = PP.n.longSteps || (PP.n.longSteps = []); if (lg.length < 8) lg.push([PP.phase, Math.round(d1)]); } } while (!r.done && performance.now() - t < 4); PP.n.slices = (PP.n.slices || 0) + 1; var dt0 = Math.round(performance.now() - t); if (dt0 > (PP.n.sliceMax || 0)) { PP.n.sliceMax = dt0; PP.n.sliceMaxAt = PP.n.slices; } if (r.done) GEN = null; } catch (e) { note("build step", e); GEN = null; } }
  // cull range (scaled like the client's instanced props) and the lanterns' night glow
  var lastF = -99, lastX = 1e9, lastZ = 1e9, lastIn = null;
  // sitting on a porch seat: the status line names the spot, and the porch passport stamps (plan/porches.json "stamps")
  var SITW = { on: false };
  function sitWatch() { var on = false; try { on = !!(SIT && SIT.on) && !inside; } catch (e) { return; } var px = player.position.x, pz = player.position.z;
    if (!on) { SITW.on = false; return; } if (SITW.on && Math.hypot(px - SITW.x, pz - SITW.z) < 0.25) return; SITW.on = true; SITW.x = px; SITW.z = pz;
    var best = null, bd = 1.2; for (var i = 0; i < SOLIDS.length; i++) { var sd = SOLIDS[i]; if (!sd.seat || sd.tag !== "porch" || !sd.rp) continue; var d = Math.hypot(sd.x - px, sd.z - pz) - Math.max(sd.hw, sd.hd); if (d < bd) { bd = d; best = sd; } } if (!best) return;
    var C = cfg() || {}, ph = C.sitLines || {}, rp = best.rp, key = /^rocker/.test(rp) ? "rocker" : /^bench|^plank/.test(rp) ? "bench" : /^bistro/.test(rp) ? "cafe" : /^adk/.test(rp) ? "adk" : rp;
    var line = ph[key] || ph.def || "sitting on the porch"; var nm = best.rn ? String(best.rn).replace(/\s*\([^)]*\)/g, "").trim() : ""; try { setStatus(line + (nm ? " · " + nm : "") + " · any move key to stand"); } catch (e) {}
    var st = C.stamps || {}, id = null; if (key === "rocker" && best.rk === "ranch") id = st.rocker; else if (rp === "swing") id = st.swing; else if (rp === "stool") id = st.checkers; else if (key === "cafe") id = st.cafe; else if (best.rk === "glamp") id = st.glamp;
    if (id) { try { var PG = window.PLAN_PROGRESS; if (PG && PG.award) PG.award("stamp", { id: id }); } catch (e) {} PP.n.stampTry = (PP.n.stampTry || 0) + 1; PP.lastStamp = id; } }
  function frame() { buildStep(); if (!GROUP) return; sitWatch(); try { var k = nightK(); MAT.glow.emissiveIntensity = 0.25 + 2.6 * k; MAT.halo.opacity = Math.min(0.85, k * 0.95); var hv = k > 0.03; if (hv !== PP.hv) { PP.hv = hv; lastF = -99; } MAT.glow.color.setRGB(0.23 + 0.1 * (1 - k), 0.17 + 0.06 * (1 - k), 0.1);
      var inside0 = false, ins = null; try { ins = inside || null; } catch (e) {} if (ins !== PP.inRoom) roomHide(ins); inside0 = !!(ins && PP.hideAll); var cx = camera.position.x, cz = camera.position.z; if (inside0 === lastIn && FRAME_N - lastF < 20 && Math.hypot(cx - lastX, cz - lastZ) < 15) return; lastF = FRAME_N; lastX = cx; lastZ = cz; lastIn = inside0;
      var R = (cfg().cull || 240) * (QUAL && QUAL.q ? Math.max(0.6, QUAL.q.range || 1) : 1);
      CHUNKS.forEach(function (C0) { var dx = Math.max(C0.x0 - cx, 0, cx - (C0.x0 + CH)), dz = Math.max(C0.z0 - cz, 0, cz - (C0.z0 + CH)); var v = !inside0 && dx * dx + dz * dz < R * R; if (v !== C0.vis || C0.hv !== PP.hv) { C0.vis = v; C0.hv = PP.hv; C0.meshes.forEach(function (m) { m.visible = v && (!m.userData.halo || PP.hv); }); } });
    } catch (e) { note("frame", e); } }
  // inside a room built at its door (the stores, saloons, homes: a box at the building), the porch pieces that would stand inside the
  // room's walls are hidden one by one and the rest stay in view through the windows; arcade, terminal and rooms without a box hide all
  function roomHide(ins) { try { (PP.hidden || []).forEach(function (q) { q[0].setVisibleAt(q[1], true); }); PP.hidden = []; PP.inRoom = ins; PP.hideAll = false;
      // the building's own wall solids are out of the way while you are inside it (plan_rooms parks those centred in the room; the
      // facade is a few degrees off the room's square, so a corner of the back or a side wall can reach in): back on the way out
      (PP.parked || []).forEach(function (sd) { if (SOLIDS.indexOf(sd) < 0) SOLIDS.push(sd); }); PP.parked = []; if (!ins) return;
      var d = ins.door, e = d && d.e; if (e) for (var si = SOLIDS.length - 1; si >= 0; si--) { var w = SOLIDS[si]; if (w.rpWall && w.rpE === e) { PP.parked.push(w); SOLIDS.splice(si, 1); } } try { if (PP.parked.length && typeof R9SG !== "undefined") R9SG.ver++; } catch (x2) {} if (!e || !(ins.half > 0) || d.kind === "arcade" || d.kind === "terminal") { PP.hideAll = !!ins; return; }
      var c = Math.cos(e[3]), sn = Math.sin(e[3]), hf = ins.half + 0.6, R2 = (hf + 2) * (hf + 2) * 2;
      CHUNKS.forEach(function (C0) { if (C0.x0 > e[0] + hf + 2 || C0.x0 + CH < e[0] - hf - 2 || C0.z0 > e[2] + hf + 2 || C0.z0 + CH < e[2] - hf - 2) return; (C0.inst || []).forEach(function (q) { var dx = q[2] - e[0], dz = q[3] - e[2]; if (dx * dx + dz * dz > R2) return; var lx = dx * c - dz * sn, lz = dx * sn + dz * c; if (Math.abs(lx) < hf && Math.abs(lz) < hf) { q[0].setVisibleAt(q[1], false); PP.hidden.push(q); } }); });
      PP.n.roomHidden = PP.hidden.length; } catch (x) { note("room hide", x); } }
  PP.rebuild = function () { try { if (GROUP) { scene.remove(GROUP); GROUP.traverse(function (o) { if (o.isBatchedMesh) o.dispose(); }); } CHUNKS.length = 0; PLAN_LIST.forEach(function (L) { (L.saved || []).forEach(function (s) { s[0][0] = s[1]; s[0][1] = s[2]; s[0][2] = s[3]; }); L.saved = null; }); PLAN_LIST.length = 0; NEARP = null; for (var k in PROPS) { if (PROPS[k] && PROPS[k].a) PROPS[k].a.dispose(); if (PROPS[k] && PROPS[k].g) PROPS[k].g.dispose(); delete PROPS[k]; } planAll(); PP.sync = true; build(); PP.sync = false; return PP.n; } catch (e) { note("rebuild", e); return String(e); } };
  // a porch sample for the studio: the props of placement i of a kind in the model frame (no solids)
  PP.sample = function (kind, i) { propsInit(); mats(); var C = cfg(), K = C.kinds[kind]; var e0 = PLACE[kind][i || 0]; var e = [0, 0, 0, 0, e0[4] || 1]; e.sink = 0; var L = layoutOne(kind, K, e, i || 0); L.ground.forEach(function (g0) { var D = g0.S.deck; var u = (D[0] + D[1]) / 2 + (D[1] - D[0]) * 0.3; if (g0.cafe) { L.items.push({ fr: g0.fr, p: "bistro_t", u: u, v: g0.v, ry: 0, y: 0 }, { fr: g0.fr, p: "umb_r", u: u, v: g0.v, ry: 0, y: 0 }); } else L.items.push({ fr: g0.fr, p: g0.p, u: u, v: g0.v, ry: 0, y: 0 }); }); var g = new THREE.Group(); L.items.forEach(function (it) { var pr = PROPS[it.p]; if (!pr) return; var mt = new THREE.Matrix4(); itemMatrix(it, mt); if (pr.a) { var m = new THREE.Mesh(pr.a, MAT.atlas); m.matrixAutoUpdate = false; m.matrix.copy(mt); g.add(m); } if (pr.g) { var m2 = new THREE.Mesh(pr.g, MAT.glow); m2.matrixAutoUpdate = false; m2.matrix.copy(mt); g.add(m2); } }); g.userData.L = L; return g; };
  PP.dbg = { groundClear: groundClear, vehicleRoad: vehicleRoad, F: F, matPoint: matPoint, buildGen: function () { return buildGen(); } };
  PP.stats = function () { var o = { n: PP.n, errs: PP.errs.slice(), chunks: CHUNKS.map(function (c) { return [c.k, c.vis, c.meshes.map(function (m) { return m.instanceCount; })]; }) }; return o; };

  var H = window.PLAN_HOOKS;
  H.world.push({ name: "porchesWorld", fn: function () { try { worldHook(); } catch (e) { note("world", e); } } });
  H.defer.push({ name: "porchesBuild", fn: function () { try { build(); } catch (e) { note("defer", e); } } });
  H.frame.push({ name: "porchesFrame", fn: frame });
})();
