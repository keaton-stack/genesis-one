// R17 (5 Oct 2026, Agent K): THE EXPANSE LIBRARY AND THE 1928 ARCHIVE, Expanse Gate and the 1928 Strip (S3_GATE).
//   A Mission Revival civic library in the Douglas way: lime stucco on a cantera plinth, red barrel tile, a front arcade of nine arches,
//   a tall entrance pavilion under a curvilinear parapet, a clock and bell tower with a tiled dome, and the archive wing behind a vault door.
//   Inside: the grand reading room (oak floor, painted king-post trusses, wrought-iron chandeliers, study tables with green banker's lamps,
//   wall stacks of real bound books, a mezzanine gallery on the back wall with rolling ladders, freestanding stacks, the circulation desk,
//   a card catalog and a stone fireplace), and the 1928 Archive (a vaulted room: the opening-day panel and a model of the field, a wooden
//   propeller, the survey map of Douglas and Agua Prieta under glass, photographs of the era, the smelter case, a model biplane, a timeline).
//   People: the head librarian at the desk (talk card, borrow a book), a few readers through PLAN_ROAM. Sit at a study table with a book to
//   read it. Stamps 355..359 through PLAN_PROGRESS.award. Copy in plan/library.json.
// Classic script, loaded before plan_fill_a.js and client.js; hooks PLAN_HOOKS { terrain, world, defer, frame, interior } and wraps a few client
// functions by bare name at run time (openNearest, showTalk, nearestHotspot). No new real lights (lamps are sources for the client's pool),
// merged geometry per material, one shared material family. ?lib=0 turns the module off. window.PLAN_LIBRARY: n, t, errs, site, api, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var LB = window.PLAN_LIBRARY = window.PLAN_LIBRARY || {};
  LB.v = "r17"; LB.errs = LB.errs || []; LB.n = LB.n || {}; LB.t = LB.t || {};
  if (/[?&]lib=0\b/.test(location.search)) { LB.off = true; return; }
  var PI = Math.PI, TAU = PI * 2;
  function note(tag, e) { try { if (LB.errs.length < 60) LB.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (LB.errs.length <= 6) console.warn("plan_library " + tag, e); } catch (x) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function nowMs() { return performance.now(); }
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function has(k) { try { return !!(MODELS[k] && (MODELS[k].parts || MODELS[k]._pp)); } catch (e) { return false; } }
  function canPut(k) { try { return has(k) && !!MODEL_SPECS[k]; } catch (e) { return false; } }
  function $id(id) { return document.getElementById(id); }
  function V3(x, y, z) { return new THREE.Vector3(x, y, z); }
  function lowTier() { try { return ASSET.tier === "m"; } catch (e) { return false; } }
  function qual() { try { return localStorage.getItem("g1:quality") || "high"; } catch (e) { return "high"; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function au(u) { try { if (window.AV) return window.AV(u); } catch (e) {} return u; }
  function stamp(id) { try { var PP = window.PLAN_PROGRESS; if (PP && PP.award && id) PP.award("stamp", { id: id }); } catch (e) {} }

  // ───────────────────────── config: plan/library.json (copy, people, books, stamps) ─────────────────────────
  var CFG = LB.cfg || null;
  function cfgUrl() { return au("/plan/library.json?v=" + (window.BUILD || "dev")); }
  if (!CFG) { try { fetch(cfgUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && !CFG) CFG = LB.cfg = d; }).catch(function (e) { note("cfg fetch", e); }); } catch (e) { note("cfg", e); } }
  function cfg() { if (CFG) return CFG; try { var x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = LB.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); } return CFG; }
  function C(path, dflt) { var o = cfg(); if (!o) return dflt; var p = path.split("."); for (var i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }

  // ───────────────────────── the site frame ─────────────────────────
  // Local frame: x along the front (north-east, parallel to the runway), z toward the front (south-east, away from the runway), y up from the
  // graded pad G. Origin (576.8, -76.3); yaw 0.8587 rad (the group's rotation.y). The section fence runs at local z -18 behind the building.
  var SITE = LB.site = LB.site || null;
  function resolveSite() { if (SITE) return SITE; var s = C("site", {}) || {};
    var S = { ox: s.ox || 576.8, oz: s.oz || -76.3, yaw: s.yaw || 0.8587, G: s.pad || 21.6, F: 0.3 };
    S.c = Math.cos(S.yaw); S.s = Math.sin(S.yaw);
    // the lot (local rectangles): the building with its arcade and tower, the forecourt, the patio, the grounds
    S.bld = [[-25.8, 32.2, -9.2, 14.8]]; S.fore = [-15, 15, 14.6, 30.5]; S.patio = [19, 32, 8, 14.2]; S.lot = [-30, 37, -13.8, 32];
    // rooms (interior boxes, local): the reading room, the archive, the porch (between the pavilion's arch and the doors)
    S.rr = [-18.4, 18.4, -8.4, 8.4]; S.ar = [19.0, 31.3, -8.3, 7.3]; S.porch = [-4.4, 4.4, 9.0, 14.0]; S.arc = [-19, 19, 9.0, 13.0];
    S.deckY = 3.9; S.deckZ = -5.3; S.eave = 8.9; S.ridge = 12.9; S.arVault = [4.8, 6.8];
    return (SITE = LB.site = S); }
  function l2w(x, z) { var S = SITE; return [S.ox + x * S.c + z * S.s, S.oz - x * S.s + z * S.c]; }
  function w2l(x, z) { var S = SITE, dx = x - S.ox, dz = z - S.oz; return [dx * S.c - dz * S.s, dx * S.s + dz * S.c]; }
  function inR(q, r, m) { m = m || 0; return q[0] > r[0] - m && q[0] < r[1] + m && q[1] > r[2] - m && q[1] < r[3] + m; }
  function rdist(q, r) { var dx = Math.max(r[0] - q[0], 0, q[0] - r[1]), dz = Math.max(r[2] - q[1], 0, q[1] - r[3]); return Math.hypot(dx, dz); }
  function lotDist(x, z) { var q = w2l(x, z); return rdist(q, SITE.lot); }
  function bldDist(x, z) { var q = w2l(x, z); return Math.min(rdist(q, SITE.bld[0]), rdist(q, SITE.fore), rdist(q, SITE.patio)); }
  // where a world point is: "rr" reading room, "ar" archive, "porch", or null; y is world height
  function roomAt(x, y, z) { var S = SITE; if (!S) return null; var q = w2l(x, z), h = y - S.G; if (h < -1 || h > S.ridge) return null;
    if (inR(q, S.rr, -0.15)) return h < S.ridge - 0.4 ? "rr" : null; if (inR(q, S.ar, -0.15)) return h < S.arVault[1] ? "ar" : null; if (inR(q, S.porch, -0.1) && h < 6.4) return "porch"; return null; }
  function underDeck(q) { return q[1] < SITE.deckZ + 0.05 && inR(q, SITE.rr); }

  // ───────────────────────── geometry kit: parts per material base, vertex colours, merged once ─────────────────────────
  var _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1);
  var _cc = {};
  function rgb(c) { if (Array.isArray(c)) return c; if (typeof c === "number" || typeof c === "string") { var k = String(c); if (_cc[k]) return _cc[k]; var q = new THREE.Color(c); return (_cc[k] = [q.r, q.g, q.b]); } return [1, 1, 1]; }
  function Kit() { this.m = {}; this.tris = 0; }
  Kit.prototype.add = function (b, g, col, m4) {
    if (g.index) g = g.toNonIndexed(); if (m4) g.applyMatrix4(m4); if (!g.attributes.normal) g.computeVertexNormals();
    var n = g.attributes.position.count; if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.color) { var c = rgb(col === undefined ? 0xffffff : col), ca = new Float32Array(n * 3); for (var i = 0; i < n; i++) { ca[i * 3] = c[0]; ca[i * 3 + 1] = c[1]; ca[i * 3 + 2] = c[2]; } g.setAttribute("color", new THREE.BufferAttribute(ca, 3)); }
    for (var k in g.attributes) if (k !== "position" && k !== "normal" && k !== "uv" && k !== "color") g.deleteAttribute(k);
    (this.m[b] || (this.m[b] = [])).push(g); this.tris += n / 3; return g; };
  Kit.prototype.place = function (b, g, col, x, y, z, ry, rx, rz, sx, sy, sz) { _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(x || 0, y || 0, z || 0), _q, _v2.set(sx || 1, sy || 1, sz || 1)); return this.add(b, g, col, _m4); };
  // a box with world-scale uv (t metres a repeat; 0 = one repeat per face)
  Kit.prototype.box = function (b, col, w, h, d, x, y, z, ry, t, rx, rz) { var g = new THREE.BoxGeometry(w, h, d); if (t) uvBox(g, w, h, d, t); return this.place(b, g, col, x, y, z, ry, rx, rz); };
  Kit.prototype.cyl = function (b, col, r0, r1, h, x, y, z, seg, open, ry, rx, rz) { return this.place(b, new THREE.CylinderGeometry(r0, r1, h, seg || 12, 1, !!open), col, x, y, z, ry, rx, rz); };
  Kit.prototype.sph = function (b, col, r, x, y, z, seg, sx, sy, sz) { return this.place(b, new THREE.SphereGeometry(r, seg || 10, Math.max(5, (seg || 10) >> 1)), col, x, y, z, 0, 0, 0, sx, sy, sz); };
  Kit.prototype.tube = function (b, col, A, B, r, seg) { var d = _v3.subVectors(B, A), L = d.length(); if (L < 1e-4) return null; var g = new THREE.CylinderGeometry(r, r, L, seg || 8, 1, true); _q.setFromUnitVectors(_v1.set(0, 1, 0), d.clone().normalize()); _m4.compose(_v2.addVectors(A, B).multiplyScalar(0.5), _q, _s1); return this.add(b, g, col, _m4); };
  Kit.prototype.plane = function (b, col, w, h, x, y, z, ry, rx, uv) { var g = new THREE.PlaneGeometry(w, h); if (uv) { var U = g.attributes.uv; for (var i = 0; i < U.count; i++) U.setXY(i, uv[0] + U.getX(i) * (uv[2] - uv[0]), uv[1] + U.getY(i) * (uv[3] - uv[1])); } return this.place(b, g, col, x, y, z, ry, rx); };
  Kit.prototype.lathe = function (b, col, prof, x, y, z, seg, sx, sy, sz) { return this.place(b, new THREE.LatheGeometry(prof.map(function (q) { return new THREE.Vector2(Math.max(0.0005, q[0]), q[1]); }), seg || 16), col, x, y, z, 0, 0, 0, sx, sy, sz); };
  Kit.prototype.merge = function () { var out = {}; for (var k in this.m) { var g = mergeAll(this.m[k]); if (g) out[k] = g; } return out; };
  function mergeAll(list) {
    if (!list || !list.length) return null; var n = 0; list.forEach(function (g) { n += g.attributes.position.count; }); if (!n) return null;
    var P = new Float32Array(n * 3), N = new Float32Array(n * 3), Uu = new Float32Array(n * 2), Cc = new Float32Array(n * 3), o = 0;
    list.forEach(function (g) { var c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); Uu.set(g.attributes.uv.array, o * 2); if (g.attributes.color) Cc.set(g.attributes.color.array, o * 3); else Cc.fill(1, o * 3, (o + c) * 3); o += c; g.dispose(); });
    var r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(Uu, 2)); r.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
    r.computeBoundingBox(); r.computeBoundingSphere(); return r; }
  function uvBox(g, w, h, d, t) { var uv = g.attributes.uv; var dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (var f = 0; f < 6; f++) for (var k = 0; k < 4; k++) { var i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } }
  // planar world uv for any geometry (after placement): axis "y" -> (x, z), "x" -> (z, y), "z" -> (x, y); or by the face normal ("auto")
  function uvWorld(g, t, axis, ou, ov) { var p = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv; ou = ou || 0; ov = ov || 0;
    for (var i = 0; i < p.count; i++) { var x = p.getX(i), y = p.getY(i), z = p.getZ(i), ax = axis; if (ax === "auto") { var nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i)); ax = ny >= nx && ny >= nz ? "y" : nx >= nz ? "x" : "z"; }
      if (ax === "y") uv.setXY(i, x / t + ou, z / t + ov); else if (ax === "x") uv.setXY(i, z / t + ou, y / t + ov); else uv.setXY(i, x / t + ou, y / t + ov); } uv.needsUpdate = true; return g; }
  // shade a geometry's vertex colours by height (darker toward the ground: dust and splash) and by a corner falloff
  function grime(g, y0, y1, k) { var p = g.attributes.position, c = g.attributes.color; if (!c) return g; for (var i = 0; i < p.count; i++) { var t = 1 - k * (1 - sstep(y0, y1, p.getY(i))); c.setXYZ(i, c.getX(i) * t, c.getY(i) * t * 0.99, c.getZ(i) * t * 0.97); } c.needsUpdate = true; return g; }
  function colorize(g, col) { var n = g.attributes.position.count, c = rgb(col), a = new Float32Array(n * 3); for (var i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; } g.setAttribute("color", new THREE.BufferAttribute(a, 3)); return g; }

  // ───────────────────────── walls: a Shape with holes, extruded, split into its outside face, inside face and reveals ─────────────────────────
  // outline: [[a, y], ...] in the wall plane (a along the wall); holes: list of point lists. depth: thickness. Returns geometries in the wall's
  // own frame: a along +x, y up, the outside face at z = depth (normal +z), the inside face at z = 0.
  function shapeFrom(pts) { var s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; }
  function pathFrom(pts) { var s = new THREE.Path(); s.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; }
  // an arch-topped opening: x0..x1, from y0 up to the springing ys, then a semicircle (or segmental with rise)
  function archHole(x0, x1, y0, ys, seg, rise) { var r = (x1 - x0) / 2, cx = (x0 + x1) / 2, pts = [[x0, y0], [x1, y0], [x1, ys]]; seg = seg || 14; var rr = rise === undefined ? r : rise;
    for (var i = 1; i < seg; i++) { var a = i / seg * PI; pts.push([cx + Math.cos(a) * r, ys + Math.sin(a) * rr]); } pts.push([x0, ys]); return pts; }
  function rectHole(x0, x1, y0, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
  function circHole(cx, cy, r, seg) { var pts = []; seg = seg || 24; for (var i = 0; i < seg; i++) { var a = i / seg * TAU; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return pts; }
  function quatrefoil(cx, cy, r, seg) { var pts = []; seg = seg || 48; for (var i = 0; i < seg; i++) { var a = i / seg * TAU, rr = r * (0.72 + 0.28 * Math.abs(Math.cos(2 * a))); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } return pts; }
  function wallGeo(outline, holes, depth) {
    var sh = shapeFrom(outline); (holes || []).forEach(function (h) { sh.holes.push(pathFrom(h.slice().reverse())); });
    var g = new THREE.ExtrudeGeometry(sh, { depth: depth, bevelEnabled: false, curveSegments: 1, steps: 1 }); g = g.toNonIndexed(); g.computeVertexNormals();
    var p = g.attributes.position, nr = g.attributes.normal, out = [], inn = [], side = [];
    for (var t = 0; t < p.count; t += 3) { var nz = nr.getZ(t); (nz > 0.7 ? out : nz < -0.7 ? inn : side).push(t); }
    function sub(list) { if (!list.length) return null; var n = list.length * 3, P = new Float32Array(n * 3), N = new Float32Array(n * 3); var k = 0;
      list.forEach(function (t) { for (var j = 0; j < 3; j++) { P[k * 3] = p.getX(t + j); P[k * 3 + 1] = p.getY(t + j); P[k * 3 + 2] = p.getZ(t + j); N[k * 3] = nr.getX(t + j); N[k * 3 + 1] = nr.getY(t + j); N[k * 3 + 2] = nr.getZ(t + j); k++; } });
      var r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2)); return r; }
    var res = { out: sub(out), inn: sub(inn), side: sub(side) }; g.dispose(); return res; }
  // place a wall: a runs along `dir` ("x": along local +x at z = z0, outside toward +z if outward > 0; "z": along local +z at x = x0)
  // m4 maps the wall frame into the building frame
  function wallM4(axis, c0, outward) { var m = new THREE.Matrix4();
    if (axis === "x") { if (outward > 0) m.makeTranslation(0, 0, c0); else { m.makeRotationY(PI); m.premultiply(new THREE.Matrix4().makeTranslation(0, 0, c0)); } }
    else { if (outward > 0) { m.makeRotationY(PI / 2); m.premultiply(new THREE.Matrix4().makeTranslation(c0, 0, 0)); } else { m.makeRotationY(-PI / 2); m.premultiply(new THREE.Matrix4().makeTranslation(c0, 0, 0)); } }
    return m; }
  // add a wall to a kit: outside face -> base "out", inside face -> base "inn" (null: outside base), reveals -> "side" (or the outside base)
  // For axis "x" with outward < 0 the wall frame is turned round, so `a` runs along -x: pass a values as -x.
  function addWall(K, spec) { var W = wallGeo(spec.outline, spec.holes, spec.depth), m4 = wallM4(spec.axis, spec.c0, spec.out || 1), t = spec.t || 2.5;
    [["out", spec.bOut, spec.cOut], ["inn", spec.bIn, spec.cIn], ["side", spec.bSide || spec.bOut, spec.cSide || spec.cOut]].forEach(function (q) { var g = W[q[0]]; if (!g || !q[1]) { if (g) g.dispose(); return; } g.applyMatrix4(m4); uvWorld(g, t, "auto"); colorize(g, q[2] === undefined ? 0xffffff : q[2]); if (spec.grime && q[0] !== "inn") grime(g, spec.grime[0], spec.grime[1], spec.grime[2]); K.add(q[1], g); }); }

  // ───────────────────────── textures: tex/lb_* (KTX2 on the desktop tier through the client's R6 path, _m JPEGs on the low tier) ─────────────────────────
  var TX = LB.tx = LB.tx || {}; var TL = null;
  var KTXN = ["lb_books", "lb_books_n", "lb_books_r", "lb_stucco", "lb_stucco_n", "lb_stucco_r", "lb_saltillo", "lb_saltillo_n", "lb_saltillo_r", "lb_oak", "lb_oak_n", "lb_oak_r", "lb_beam", "lb_beam_n", "lb_beam_r", "lb_talavera", "lb_talavera_n", "lb_talavera_r", "lb_photos", "lb_map", "lb_leather", "lb_leather_n", "lb_leather_r", "lb_mural", "lb_painting", "lb_rugs", "conv_sandstone", "conv_sandstone_n"];
  function ktxOn() { if (LB.ktx !== undefined) return LB.ktx; LB.ktx = false; try { if (!lowTier() && !/[?&]libktx=0\b/.test(location.search)) { var S0 = (0, eval)("R6KTX"); if (S0 && S0.add) { KTXN.forEach(function (n) { S0.add(n); }); LB.ktx = true; } } } catch (e) {} return LB.ktx; }
  function aniso() { var q = qual(); try { return Math.min(q === "ultra" ? 16 : q === "high" ? 8 : 4, MAX_ANISO || 8); } catch (e) { return 8; } }
  // own textures (lb_*): the _m copy on the low tier; repo textures (tile, travertine...): the client resolves the tier itself
  // repo textures other modules already hold: on the low tier a clone of their object (same source, same sampler key: one GPU upload);
  // on the desktop tier the client's R6 path shares the source, and the owner's anisotropy keeps the sampler key equal
  function sharedTex(name) { try { var t = null; if (name === "tile") t = TEX.tileA; else if (name === "tile_n") t = TEX.tileN; else if (name === "tile_r") t = TEX.tileR; else if (name === "travertine") t = TEX.travertine; else if (name === "travertine_n") t = planMats().stone.normalMap; else if (name === "travertine_r") t = planMats().stone.roughnessMap;
      else if (/^conv_sandstone/.test(name) && window.PLAN_CONV && PLAN_CONV.tx) t = PLAN_CONV.tx[name + (lowTier() ? "_m" : "")] || null; return t && t.isTexture ? t : null; } catch (e) { return null; } }
  function ownerAniso(name) { try { if (/^conv_/.test(name)) return Math.min(8, MAX_ANISO); if (/^(tile|travertine)/.test(name)) return MAX_ANISO; } catch (e) {} return 0; }
  function tex(name, srgb, own, rep, ext) { ktxOn(); var url = "/tex/" + name + (own !== false && lowTier() ? "_m" : "") + "." + (ext || "jpg"), k = url + (srgb ? ":s" : ":l");
    if (TX[k]) return TX[k];
    if (lowTier()) { var sh = sharedTex(name); if (sh) { var c = sh.clone(); c.userData = Object.assign({}, c.userData, { avShared: true }); LB.n.sharedTex = (LB.n.sharedTex || 0) + 1; return (TX[k] = c); } }
    TL = TL || new THREE.TextureLoader(); var t = TL.load(au(url)); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; if (rep !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ownerAniso(name) || aniso(); t.name = "lb_" + name; t.userData.avShared = true; return (TX[k] = t); }
  function dataTex(r, g, b, srgb) { var k = "data:" + r + "," + g + "," + b + (srgb ? "s" : ""); if (TX[k]) return TX[k]; var d = new Uint8Array([r, g, b, 255]); var t = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; t.userData.avShared = true; return (TX[k] = t); }
  function cvs(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function canvasTex(key, W, H, fn, srgb, rep) { if (TX[key]) return TX[key]; var hs = lowTier() && W > 512 ? 0.5 : 1, c = cvs(W * hs, H * hs), x = c.getContext("2d"); if (hs !== 1) x.scale(hs, hs); try { fn(x, W, H); } catch (e) { note("canvas " + key, e); } var t = new THREE.CanvasTexture(c); t.colorSpace = srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso(); t.needsUpdate = true; t.userData.avShared = true; t.userData.canvas = c; return (TX[key] = t); }
  var FT = { serif: "Georgia, 'Times New Roman', serif", ui: "'Space Grotesk', 'Segoe UI', system-ui, sans-serif", disp: "'Fraunces', Georgia, serif", mono: "'JetBrains Mono', Consolas, monospace" };
  function txt(x, t, px, py, font, color, ls, align, maxW) { x.font = font; x.fillStyle = color; x.textAlign = align || "center"; x.textBaseline = "middle"; try { x.letterSpacing = (ls || 0) + "px"; } catch (e) {}
    if (maxW) { var w = x.measureText(t).width; if (w > maxW) { x.save(); x.translate(px, py); x.scale(maxW / w, 1); x.fillText(t, 0, 0); x.restore(); try { x.letterSpacing = "0px"; } catch (e) {} return; } } x.fillText(t, px, py); try { x.letterSpacing = "0px"; } catch (e) {} }
  function wrapLines(x, text, maxW) { var words = String(text).split(/\s+/), lines = [], cur = ""; words.forEach(function (w) { var t = cur ? cur + " " + w : w; if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }); if (cur) lines.push(cur); return lines; }

  // ───────────────────────── one material family: standard + map + normal + roughness + vertex colours + the library patch ─────────────────────────
  // The patch (the same text for every material, so they share one program): a detail normal layer that fades in within a few metres, and
  // indoors (uIn = 1) the sky's share of the light (hemisphere and environment) is cut and a warm house term added, so the room's lamps,
  // the windows and the emissive fixtures carry the light. Per material: uIn, the detail map and its scale and strength.
  var GU = LB.gu = LB.gu || { uAmb: { value: 0.34 }, uHouse: { value: 0.05 }, uNight: { value: 0 } };
  var LB_FS_HEAD = "uniform float uLbIn; uniform float uLbAmb; uniform float uLbHouse; uniform sampler2D tLbDet; uniform vec2 uLbDet;\n";
  var LB_FS_DET = "mapN.xy *= normalScale;\n{ float lbk = uLbDet.y * (1.0 - smoothstep(3.0, 16.0, length(vViewPosition))); vec3 lbn = texture2D(tLbDet, vNormalMapUv * uLbDet.x).xyz * 2.0 - 1.0; mapN.xy += lbn.xy * lbk; }\n";
  var LB_FS_IND = "{ float lbi = uLbIn; reflectedLight.indirectDiffuse *= mix(1.0, uLbAmb, lbi); reflectedLight.indirectSpecular *= mix(1.0, uLbAmb * 0.8, lbi); reflectedLight.indirectDiffuse += material.diffuseColor * vec3(1.0, 0.86, 0.7) * uLbHouse * lbi; }\n";
  function lbObc(shader) {
    var ud = this.userData || {}; shader.uniforms.uLbIn = ud.uIn || { value: 0 }; shader.uniforms.uLbAmb = GU.uAmb; shader.uniforms.uLbHouse = GU.uHouse; shader.uniforms.tLbDet = { value: ud.det || dataTex(128, 128, 255) }; shader.uniforms.uLbDet = { value: ud.detK || new THREE.Vector2(1, 0) };
    var fs = shader.fragmentShader.replace("#include <common>", "#include <common>\n" + LB_FS_HEAD);
    var nfm = THREE.ShaderChunk.normal_fragment_maps; if (nfm.indexOf("mapN.xy *= normalScale;") >= 0) fs = fs.replace("#include <normal_fragment_maps>", nfm.replace("mapN.xy *= normalScale;", LB_FS_DET));
    fs = fs.replace("#include <aomap_fragment>", LB_FS_IND + "#include <aomap_fragment>"); shader.fragmentShader = fs; }
  var MX = LB.mx = LB.mx || {};
  function famMat(key, o) {
    if (MX[key]) return MX[key];
    var p = { map: o.map || dataTex(255, 255, 255, true), normalMap: o.nmap || dataTex(128, 128, 255), roughnessMap: o.rmap || dataTex(255, 255, 255), roughness: o.r === undefined ? 0.85 : o.r, metalness: o.m || 0, vertexColors: true, color: o.color === undefined ? 0xffffff : o.color };
    if (o.emissive !== undefined) { p.emissive = new THREE.Color(o.emissive); p.emissiveIntensity = o.ei === undefined ? 1 : o.ei; }
    if (o.alphaTest) { p.alphaTest = o.alphaTest; p.side = THREE.DoubleSide; }
    if (o.emap) p.emissiveMap = o.emap; if (o.ds) p.side = THREE.DoubleSide;
    if (o.transparent) { p.transparent = true; p.opacity = o.opacity === undefined ? 0.3 : o.opacity; p.depthWrite = false; }
    var m = new THREE.MeshStandardMaterial(p); if (o.transparent) m.forceSinglePass = true; if (o.ns) m.normalScale.set(o.ns, o.ns); if (o.env !== undefined) m.envMapIntensity = o.env;
    m.userData.uIn = { value: o.inside ? 1 : 0 }; m.userData.det = o.det || null; m.userData.detK = new THREE.Vector2(o.detS || 1, o.det ? (o.detK === undefined ? 0.5 : o.detK) : 0);
    m.onBeforeCompile = lbObc; m.userData.avShared = true; m.name = "lb " + key; return (MX[key] = m); }
  function addMat(key, o) { if (MX[key]) return MX[key]; var m = new THREE.MeshBasicMaterial({ map: o.map || null, color: o.color === undefined ? 0xffffff : o.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, opacity: o.opacity === undefined ? 1 : o.opacity, side: o.side || THREE.FrontSide, fog: true }); m.userData.avShared = true; m.name = "lb " + key; return (MX[key] = m); }
  function det(n) { return tex("rl_det_" + n, false, false, true, "png"); }
  // the materials (made in the defer hook, once the renderer and the client's textures exist)
  function mats() {
    if (MX._ok) return MX; MX._ok = true;
    var lo = lowTier();
    var st = { map: tex("lb_stucco", true), nmap: tex("lb_stucco_n", false), rmap: tex("lb_stucco_r", false) };
    var tile = { map: tex("tile", true, false), nmap: tex("tile_n", false, false), rmap: tex("tile_r", false, false) };
    var cant = { map: tex("conv_sandstone", true), nmap: tex("conv_sandstone_n", false) };
    var oak = { map: tex("lb_oak", true), nmap: tex("lb_oak_n", false), rmap: tex("lb_oak_r", false) };
    var beam = { map: tex("lb_beam", true), nmap: tex("lb_beam_n", false), rmap: tex("lb_beam_r", false) };
    var sal = { map: tex("lb_saltillo", true), nmap: tex("lb_saltillo_n", false), rmap: tex("lb_saltillo_r", false) };
    var tal = { map: tex("lb_talavera", true), nmap: tex("lb_talavera_n", false), rmap: tex("lb_talavera_r", false) };
    var lea = { map: tex("lb_leather", true), nmap: tex("lb_leather_n", false), rmap: tex("lb_leather_r", false) };
    var trav = { map: tex("travertine", true, false), nmap: tex("travertine_n", false, false), rmap: tex("travertine_r", false, false) };
    var dP = lo ? null : det("plaster"), dW = lo ? null : det("wood"), dS = lo ? null : det("stone"), dL = lo ? null : det("leather"), dM = lo ? null : det("metal");
    // exterior
    famMat("stucco", { map: st.map, nmap: st.nmap, rmap: st.rmap, r: 1, ns: 0.9, det: dP, detS: 6, detK: 0.45 });
    famMat("cantera", { map: cant.map, nmap: cant.nmap, r: 0.88, ns: 0.8, det: dS, detS: 5, detK: 0.4 });
    famMat("tile", { map: tile.map, nmap: tile.nmap, rmap: tile.rmap, r: 1, ns: 1.0 });
    famMat("wood", { map: beam.map, nmap: beam.nmap, rmap: beam.rmap, r: 1, ns: 0.8, det: dW, detS: 4, detK: 0.35 });
    famMat("iron", { r: 0.55, m: 0.75, color: 0xffffff, det: dM, detS: 3, detK: 0.4 });
    famMat("bronze", { r: 0.38, m: 1.0, color: 0xffffff, det: dM, detS: 3, detK: 0.3 });
    famMat("paver", { map: sal.map, nmap: sal.nmap, rmap: sal.rmap, r: 1, ns: 0.8 });
    famMat("talavera", { map: tal.map, nmap: tal.nmap, rmap: tal.rmap, r: 1, ns: 0.6 });
    famMat("glow", { r: 0.6, emissive: 0xffd9a0, ei: 0.0, color: 0xffffff });
    famMat("lamp", { r: 0.4, emissive: 0xffc878, ei: 2.2, color: 0xfff1d8 });
    famMat("glass", { r: 0.05, m: 0.0, transparent: true, opacity: 0.32, color: 0x9fb3bb, env: 1.4, emissive: 0xffb860, ei: 0, ds: true });
    famMat("water", { r: 0.06, m: 0.0, color: 0x2e444c, env: 1.6 });
    famMat("glassD", { r: 0.08, m: 0.1, color: 0x2a2f33, env: 1.2, emissive: 0xffb45a, ei: 0 });   // opaque dark glazing seen from afar
    // interior
    famMat("plaster", { map: st.map, nmap: st.nmap, rmap: st.rmap, r: 1, ns: 0.6, inside: true, det: dP, detS: 6, detK: 0.4 });
    famMat("oakIn", { map: oak.map, nmap: oak.nmap, rmap: oak.rmap, r: 1, ns: 0.8, inside: true, det: dW, detS: 3, detK: 0.4 });
    famMat("woodIn", { map: beam.map, nmap: beam.nmap, rmap: beam.rmap, r: 1, ns: 0.7, inside: true, det: dW, detS: 4, detK: 0.35 });
    famMat("books", { map: tex("lb_books", true), nmap: tex("lb_books_n", false), rmap: tex("lb_books_r", false), r: 1, ns: 0.8, inside: true });
    famMat("salIn", { map: sal.map, nmap: sal.nmap, rmap: sal.rmap, r: 1, ns: 0.8, inside: true });
    famMat("talIn", { map: tal.map, nmap: tal.nmap, rmap: tal.rmap, r: 1, ns: 0.6, inside: true });
    famMat("travIn", { map: trav.map, nmap: trav.nmap, rmap: trav.rmap, r: 0.55, ns: 0.6, inside: true, det: dS, detS: 4, detK: 0.3 });
    famMat("leather", { map: lea.map, nmap: lea.nmap, rmap: lea.rmap, r: 1, ns: 0.8, inside: true, det: dL, detS: 4, detK: 0.4 });
    famMat("ironIn", { r: 0.55, m: 0.75, inside: true, det: dM, detS: 3, detK: 0.4 });
    famMat("brass", { r: 0.32, m: 1.0, inside: true, det: dM, detS: 3, detK: 0.25 });
    famMat("steel", { r: 0.28, m: 1.0, inside: true, det: dM, detS: 2, detK: 0.3 });
    famMat("cantIn", { map: cant.map, nmap: cant.nmap, r: 0.85, ns: 0.8, inside: true, det: dS, detS: 5, detK: 0.35 });
    famMat("cloth", { r: 0.9, inside: true, det: lo ? null : det("fabric"), detS: 6, detK: 0.4 });
    famMat("shade", { r: 0.35, emissive: 0x3fae5a, ei: 0.25, color: 0x1f6b35, inside: true });   // banker's lamp glass
    famMat("lampIn", { r: 0.4, emissive: 0xffcf8a, ei: 2.4, color: 0xfff1d8, inside: true });
    MX.glassIn = MX.glass;
    famMat("painting", { map: tex("lb_painting", true), r: 0.85, inside: true });
    famMat("photos", { map: tex("lb_photos", true), r: 0.9, inside: true });
    famMat("map", { map: tex("lb_map", true), r: 0.9, inside: true });
    famMat("mural", { map: tex("lb_mural", true), r: 0.9, inside: true });
    famMat("rugs", { map: tex("lb_rugs", true), r: 1, inside: true, det: lo ? null : det("fabric"), detS: 8, detK: 0.5 });
    famMat("signsIn", { map: signTex(), r: 0.6, inside: true, emissive: 0x000000 });
    famMat("signs", { map: signTex(), r: 0.6 });
    famMat("letters", { map: letterTex(), r: 0.35, m: 1.0, transparent: true, opacity: 1, ds: true, emissive: 0xffb050, ei: 0 });
    famMat("clock", { map: clockTex(), r: 0.5, emissive: 0xfff0d0, ei: 0 });
    addMat("pool", { map: poolTex() }); addMat("glowA", { map: poolTex() }); addMat("flame", { map: flameTex() });
    return MX; }
  // soft round pool (light on floors and walls, glows)
  function poolTex() { return canvasTex("pool", 128, 128, function (x, W, H) { var g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,0.55)"); g.addColorStop(0.7, "rgba(255,255,255,0.14)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, W, H); }); }
  function flameTex() { return canvasTex("flame", 128, 256, function (x, W, H) { var R = rng(7); for (var i = 0; i < 6; i++) { var cx = W / 2 + (R() - 0.5) * 30, g = x.createRadialGradient(cx, H * 0.72, 4, cx, H * 0.6, H * 0.5); g.addColorStop(0, "rgba(255,240,200,0.9)"); g.addColorStop(0.3, "rgba(255,170,60,0.55)"); g.addColorStop(0.7, "rgba(200,70,20,0.18)"); g.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = g; x.beginPath(); x.ellipse(cx, H * 0.62, 22 + R() * 18, 80 + R() * 40, 0, 0, TAU); x.fill(); } }); }

  // ───────────────────────── canvas textures: the sign and plaque atlas, the bronze lettering, the clock dial ─────────────────────────
  // atlas regions in px (2048 x 1024): [x, y, w, h]
  var SA = { W: 2048, H: 1024, r: {
    mono: [0, 0, 1024, 256], vault: [1024, 0, 1024, 192], mural: [1024, 192, 1024, 192],
    prop: [0, 256, 512, 192], mapL: [512, 256, 512, 192], smelt: [0, 448, 512, 192], model: [512, 448, 512, 192],
    ph0: [1024, 384, 512, 96], ph1: [1536, 384, 512, 96], ph2: [1024, 480, 512, 96], ph3: [1536, 480, 512, 96],
    tl0: [0, 640, 340, 280], tl1: [341, 640, 340, 280], tl2: [682, 640, 340, 280], tl3: [1023, 640, 340, 280], tl4: [1364, 640, 340, 280], tl5: [1705, 640, 340, 280],
    s0: [0, 920, 256, 104], s1: [256, 920, 256, 104], s2: [512, 920, 256, 104], s3: [768, 920, 256, 104], s4: [1024, 920, 256, 104], s5: [1280, 920, 256, 104], s6: [1536, 920, 256, 104], s7: [1792, 920, 256, 104],
    files: [1024, 576, 1024, 64] } };
  function sUV(k) { var r = SA.r[k]; return [r[0] / SA.W, 1 - (r[1] + r[3]) / SA.H, (r[0] + r[2]) / SA.W, 1 - r[1] / SA.H]; }
  function bronzePlate(x, r, title, sub, fs, ss) { var X = r[0], Y = r[1], W = r[2], H = r[3];
    var g = x.createLinearGradient(X, Y, X, Y + H); g.addColorStop(0, "#3a2c1e"); g.addColorStop(1, "#21180f"); x.fillStyle = g; x.fillRect(X, Y, W, H);
    x.strokeStyle = "#b8924e"; x.lineWidth = 6; x.strokeRect(X + 8, Y + 8, W - 16, H - 16); x.strokeStyle = "rgba(184,146,78,0.45)"; x.lineWidth = 2; x.strokeRect(X + 18, Y + 18, W - 36, H - 36);
    if (sub) { txt(x, title, X + W / 2, Y + H * 0.36, "700 " + (fs || 56) + "px " + FT.serif, "#e6c47e", 6, "center", W - 70);
      x.font = "400 " + (ss || 26) + "px " + FT.serif; var L = wrapLines(x, sub, W - 90); L.slice(0, 3).forEach(function (l, i) { txt(x, l, X + W / 2, Y + H * 0.62 + i * (ss || 26) * 1.2, "400 " + (ss || 26) + "px " + FT.serif, "#efe2c4", 0); }); }
    else txt(x, title, X + W / 2, Y + H / 2, "700 " + (fs || 56) + "px " + FT.serif, "#e6c47e", 6, "center", W - 70); }
  function woodBoard(x, r, t, fs) { var X = r[0], Y = r[1], W = r[2], H = r[3]; var g = x.createLinearGradient(X, Y, X, Y + H); g.addColorStop(0, "#4a3020"); g.addColorStop(1, "#2e1d12"); x.fillStyle = g; x.fillRect(X, Y, W, H);
    var R = rng(r[0] + r[1]); for (var i = 0; i < 40; i++) { x.strokeStyle = "rgba(0,0,0," + (0.05 + R() * 0.08) + ")"; x.lineWidth = 1 + R() * 2; var yy = Y + R() * H; x.beginPath(); x.moveTo(X, yy); x.lineTo(X + W, yy + (R() - 0.5) * 6); x.stroke(); }
    x.strokeStyle = "#c9a45e"; x.lineWidth = 3; x.strokeRect(X + 6, Y + 6, W - 12, H - 12); txt(x, t, X + W / 2, Y + H / 2 + 2, "700 " + (fs || 30) + "px " + FT.serif, "#e9c97f", 3, "center", W - 30); }
  function card(x, r, yr, t, s) { var X = r[0], Y = r[1], W = r[2], H = r[3]; x.fillStyle = "#e9dcc0"; x.fillRect(X, Y, W, H); var R = rng(X + 7); for (var i = 0; i < 900; i++) { x.fillStyle = "rgba(90,60,30," + (R() * 0.05) + ")"; x.fillRect(X + R() * W, Y + R() * H, 2, 2); }
    x.strokeStyle = "#6a4a2a"; x.lineWidth = 3; x.strokeRect(X + 6, Y + 6, W - 12, H - 12); txt(x, yr, X + W / 2, Y + 52, "700 54px " + FT.serif, "#7a2e1c", 2, "center", W - 30); txt(x, t, X + W / 2, Y + 104, "700 22px " + FT.serif, "#3a2716", 3, "center", W - 30);
    x.font = "400 20px " + FT.serif; var L = wrapLines(x, s, W - 44); L.slice(0, 5).forEach(function (l, i) { txt(x, l, X + W / 2, Y + 146 + i * 25, "400 20px " + FT.serif, "#3a2716", 0); }); }
  function signTex() { return canvasTex("signs", SA.W, SA.H, function (x, W, H) {
    x.fillStyle = "#20170f"; x.fillRect(0, 0, W, H);
    // the monument sign: bronze letters on a dark board
    var m = SA.r.mono; bronzePlate(x, m, "", ""); txt(x, "THE EXPANSE LIBRARY", m[0] + m[2] / 2, m[1] + 92, "700 76px " + FT.serif, "#e6c47e", 8, "center", m[2] - 80); txt(x, "AND THE 1928 ARCHIVE", m[0] + m[2] / 2, m[1] + 166, "400 46px " + FT.serif, "#efe2c4", 10, "center", m[2] - 80); txt(x, "BIBLIOTECA  ·  OPEN EVERY DAY", m[0] + m[2] / 2, m[1] + 218, "400 26px " + FT.serif, "#b8924e", 6, "center", m[2] - 80);
    bronzePlate(x, SA.r.vault, "THE 1928 ARCHIVE", null, 84);
    bronzePlate(x, SA.r.mural, "THE OLD MUNICIPAL FIELD  ·  1928", "Wheels down on the valley floor, a stone's throw from the line. An artist's impression of opening day.", 44, 25);
    bronzePlate(x, SA.r.prop, "A WOODEN PROPELLER", "Laminated hardwood and brass, from the open-cockpit years.", 34, 22);
    bronzePlate(x, SA.r.mapL, "TWO TOWNS ON THE LINE", "The valley, the line, the smelter and the field.", 32, 22);
    bronzePlate(x, SA.r.smelt, "THE SMELTER YEARS", "Copper ores from the mines up the road, smelted here for decades.", 34, 22);
    bronzePlate(x, SA.r.model, "A MODEL TRAINER", "A 1928-style open-cockpit biplane, in scale.", 34, 22);
    [["ph0", "WHEELS DOWN"], ["ph1", "THE SMELTER STACKS"], ["ph2", "A MAIN STREET ON THE LINE"], ["ph3", "OPENING DAY"]].forEach(function (q) { var r = SA.r[q[0]]; x.fillStyle = "#e9dcc0"; x.fillRect(r[0], r[1], r[2], r[3]); x.strokeStyle = "#6a4a2a"; x.lineWidth = 3; x.strokeRect(r[0] + 5, r[1] + 5, r[2] - 10, r[3] - 10); txt(x, q[1], r[0] + r[2] / 2, r[1] + r[3] / 2, "700 30px " + FT.serif, "#3a2716", 4, "center", r[2] - 30); });
    card(x, SA.r.tl0, "1900s", "A TOWN ON THE BORDER", "The town is laid out on the open flats of the wide valley, beside the border.");
    card(x, SA.r.tl1, "COPPER", "THE SMELTER YEARS", "Copper from the mines up the road is smelted here, and the young town grows fast.");
    card(x, SA.r.tl2, "RAIL", "RAILS AND RANCHES", "Trains, cattle and cotton tie the valley to the rest of the country.");
    card(x, SA.r.tl3, "1920s", "BARNSTORMERS", "Open cockpits and packed-earth strips: the first flyers land on the valley floor.");
    card(x, SA.r.tl4, "1928", "WHEELS DOWN", "The airfield opens: packed earth, a hangar, a windsock and a town in its Sunday best.");
    card(x, SA.r.tl5, "TODAY", "SUNFIELD", "The old airfield flies on as Sunfield: the same runway, the same field.");
    [["s0", "QUIET PLEASE · SILENCIO"], ["s1", "CIRCULATION"], ["s2", "REFERENCE"], ["s3", "FICTION"], ["s4", "HIGH DESERT"], ["s5", "AVIATION"], ["s6", "THE NIGHT SKY"], ["s7", "THE 1928 ARCHIVE"]].forEach(function (q) { woodBoard(x, SA.r[q[0]], q[1], q[1].length > 14 ? 24 : 32); });
    var f = SA.r.files; x.fillStyle = "#d8ccb0"; x.fillRect(f[0], f[1], f[2], f[3]); for (var i = 0; i < 8; i++) { x.strokeStyle = "#5a4630"; x.lineWidth = 2; x.strokeRect(f[0] + i * 128 + 8, f[1] + 10, 112, 44); txt(x, ["OLD MAPS", "FIELD PLANS", "THE LINE", "RAILROAD", "SMELTER", "RANCHES", "AIR MAIL", "MISC."][i], f[0] + i * 128 + 64, f[1] + 32, "700 15px " + FT.serif, "#3a2716", 1, "center", 104); }
  }); }
  // bronze lettering on transparent (alpha tested): row 0 EXPANSE LIBRARY, row 1 THE 1928 ARCHIVE
  function letterTex() { return canvasTex("letters", 2048, 256, function (x, W, H) {
    x.clearRect(0, 0, W, H); [["EXPANSE LIBRARY", 0], ["THE 1928 ARCHIVE", 128]].forEach(function (q) { var g = x.createLinearGradient(0, q[1] + 20, 0, q[1] + 110); g.addColorStop(0, "#f0d08a"); g.addColorStop(0.5, "#b07a3a"); g.addColorStop(1, "#7a5228"); x.font = "700 104px " + FT.serif; x.textAlign = "center"; x.textBaseline = "middle"; try { x.letterSpacing = "18px"; } catch (e) {} x.fillStyle = g; x.fillText(q[0], W / 2, q[1] + 66); try { x.letterSpacing = "0px"; } catch (e) {} }); }); }
  function clockTex() { return canvasTex("clock", 512, 512, function (x, W, H) { var c = W / 2; x.fillStyle = "#2a2118"; x.fillRect(0, 0, W, H);
    var g = x.createRadialGradient(c, c, 20, c, c, c); g.addColorStop(0, "#f4ecd8"); g.addColorStop(1, "#e2d3b2"); x.fillStyle = g; x.beginPath(); x.arc(c, c, c - 22, 0, TAU); x.fill();
    x.strokeStyle = "#8a6a3a"; x.lineWidth = 14; x.beginPath(); x.arc(c, c, c - 16, 0, TAU); x.stroke(); x.strokeStyle = "#2a2118"; x.lineWidth = 3; x.beginPath(); x.arc(c, c, c - 70, 0, TAU); x.stroke();
    for (var i = 0; i < 60; i++) { var a = i / 60 * TAU, r0 = c - 34, r1 = i % 5 ? c - 44 : c - 58; x.strokeStyle = "#2a2118"; x.lineWidth = i % 5 ? 3 : 7; x.beginPath(); x.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0); x.lineTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1); x.stroke(); }
    var RN = ["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"]; RN.forEach(function (n, i) { var a = i / 12 * TAU, r = c - 102; x.save(); x.translate(c + Math.sin(a) * r, c - Math.cos(a) * r); x.rotate(a); txt(x, n, 0, 0, "700 40px " + FT.serif, "#2a2118", 0); x.restore(); });
    txt(x, "SUNFIELD", c, c + 70, "400 22px " + FT.serif, "#5a4630", 6); }); }

  // ───────────────────────── the exterior (built once, merged per material, in the building frame) ─────────────────────────
  var EX = LB.ex = LB.ex || { g: null, solids: [], lights: [], anim: {} };
  var COL = { st: [0.96, 0.93, 0.87], stB: [0.9, 0.86, 0.79], cant: [0.98, 0.9, 0.82], tile: [1, 1, 1], wood: [0.62, 0.48, 0.36], woodD: [0.42, 0.31, 0.22], iron: [0.09, 0.085, 0.08], bronze: [0.62, 0.42, 0.24], plaster: [0.97, 0.95, 0.9] };
  function arcadeBays() { var out = []; [[-18.3, -5], [5, 18.3]].forEach(function (w) { var a = w[0], b = w[1], n = 4, pw = 0.7, ow = (b - a - (n - 1) * pw) / n; for (var i = 0; i < n; i++) { var o0 = a + i * (ow + pw); out.push([o0, o0 + ow]); } }); return out; }
  function piersOf(bays) { var p = []; for (var i = 0; i < bays.length - 1; i++) if (bays[i + 1][0] - bays[i][1] < 1.0) p.push([bays[i][1], bays[i + 1][0]]); return p; }
  // a wall in local terms: axis "x" (runs along x at the inner face z = c0) or "z" (runs along z at x = c0), outward +1/-1;
  // outline and holes in (s, y) with s the local coordinate along the wall. Mirrored into the wall frame where needed.
  function wallL(K, o) { if (K.dry) return; var flip = (o.axis === "x" && o.out < 0) || (o.axis === "z" && o.out > 0), f = flip ? -1 : 1;
    var mp = function (pts) { var r = pts.map(function (q) { return [q[0] * f, q[1]]; }); return flip ? r.reverse() : r; };
    addWall(K, { outline: mp(o.outline), holes: (o.holes || []).map(mp), depth: o.depth || 0.6, axis: o.axis, c0: o.c0, out: o.out, t: o.t || 2.5, bOut: o.bOut || "stucco", bIn: o.bIn === undefined ? "plaster" : o.bIn, bSide: o.bSide || "stucco", cOut: o.cOut || COL.st, cIn: o.cIn || COL.plaster, cSide: o.cSide || COL.st, grime: o.grime === undefined ? [0, 1.6, 0.16] : o.grime }); }
  // an arch-shaped outline notch (the opening runs from the bottom edge): returns the points from (o0, yb) up, over and down to (o1, yb)
  function notch(o0, o1, yb, ys, seg) { var r = (o1 - o0) / 2, cx = (o0 + o1) / 2, pts = [[o0, yb], [o0, ys]]; seg = seg || 14; for (var i = 1; i < seg; i++) { var a = PI - i / seg * PI; pts.push([cx + Math.cos(a) * r, ys + Math.sin(a) * r]); } pts.push([o1, ys]); pts.push([o1, yb]); return pts; }
  // a Mission parapet top from s = +h to -h (both ends at y0): shoulders, an ogee sweep, scrolls and a round crest
  function missionTop(h, y0, yS, top, crestR) { var R = crestR + 0.25, yB = top - 0.85 * R, yA = yB - 0.15, xA = R + 0.65, seg = 10, k, right = [[h, y0], [h, yS]];
    for (k = 1; k <= seg; k++) { var t = k / seg, e = t * t * (3 - 2 * t); right.push([lerp(h, xA, t), lerp(yS, yA, e)]); }
    right.push([R, yB]); var crest = []; for (k = 1; k < 12; k++) { var a = k / 12 * PI; crest.push([Math.cos(a) * R, yB + Math.sin(a) * R * 0.85]); }
    var left = right.map(function (q) { return [-q[0], q[1]]; }).reverse();
    return right.concat(crest).concat(left); }
  function quad(K, b, col, A, B, Cc, D, uvA, uvB, uvC, uvD) { if (K.dry) return null; var g = new THREE.BufferGeometry(); var P = [A, B, Cc, A, Cc, D], U = [uvA, uvB, uvC, uvA, uvC, uvD]; g.setAttribute("position", new THREE.Float32BufferAttribute([].concat.apply([], P), 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute([].concat.apply([], U), 2)); g.computeVertexNormals(); return K.add(b, g, col); }
  function ringShape(cx, cy, r0, r1, seg) { var s = shapeFrom(circHole(cx, cy, r1, seg)); s.holes.push(pathFrom(circHole(cx, cy, r0, seg).reverse())); return s; }
  function archRing(K, b, col, cx, ys, r0, r1, z, depth, axisRot) { if (K.dry) return null; var s = new THREE.Shape(), seg = 16, i, a; s.moveTo(cx - r1, ys); for (i = 0; i <= seg; i++) { a = PI - i / seg * PI; s.lineTo(cx + Math.cos(a) * r1, ys + Math.sin(a) * r1); } s.lineTo(cx + r0, ys); for (i = 0; i <= seg; i++) { a = i / seg * PI; s.lineTo(cx + Math.cos(a) * r0, ys + Math.sin(a) * r0); } s.closePath();
    var g = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: false, curveSegments: 1 }); g = g.toNonIndexed(); if (axisRot) g.rotateY(axisRot); g.translate(0, 0, z); g.computeVertexNormals(); uvWorld(g, 1.4, "auto"); return K.add(b, g, col); }
  // a run of barrel tile caps along a line (the eaves, copings): half cylinders lying down the slope direction dir
  function tileCaps(K, A, B, dir, step, r, len) { if (K.dry) return; var L = A.distanceTo(B), n = Math.max(1, Math.floor(L / step)), d = dir.clone().normalize(); var base = new THREE.CylinderGeometry(r, r, len, 10, 1, true, PI / 2, PI); base.rotateX(PI / 2); // axis along z, half toward +y
    var U = base.attributes.uv; for (var i = 0; i < U.count; i++) U.setXY(i, U.getX(i) * 0.14, U.getY(i) * 0.16 + 0.02);
    var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d), m = new THREE.Matrix4();
    for (var k = 0; k <= n; k++) { var p = A.clone().lerp(B, (k + 0.5) / (n + 1)); m.compose(p, q, _s1); K.add("tile", base.clone(), COL.tile, m); } base.dispose(); }
  function so(list, x, z, w, d, y0, y1, r, opt) { list.push([x, z, w, d, y0, y1, r || 0, opt || null]); }

  function* buildExteriorInto(K, SO) {
    var S = SITE, F = S.F, bays = arcadeBays(), piers = piersOf(bays), bc = bays.map(function (b) { return (b[0] + b[1]) / 2; }); EX.lampSrc = [];
    // ── the reading room shell ──
    var doorH = 3.7, winY0 = 1.25, winYs = 4.3, upY0 = 7.05, upYs = 8.0;
    var hF = [archHole(-1.3, 1.3, F, doorH)]; bc.forEach(function (c) { hF.push(archHole(c - 0.75, c + 0.75, winY0, winYs)); hF.push(archHole(c - 0.65, c + 0.65, upY0, upYs, 10, 0.25)); });
    wallL(K, { axis: "x", c0: 8.4, out: 1, outline: [[-19, 0], [19, 0], [19, S.eave], [-19, S.eave]], holes: hF });
    var cl = [-16.6, -12.5, -7.5, -2.5, 2.5, 7.5, 12.5, 16.6], hB = cl.map(function (c) { return archHole(c - 0.65, c + 0.65, 7.25, 8.15, 10, 0.25); });
    wallL(K, { axis: "x", c0: -8.4, out: -1, outline: [[-19, 0], [19, 0], [19, S.eave], [-19, S.eave]], holes: hB });
    var gTop = missionTop(9.0, S.eave, 9.55, 14.2, 1.3);
    var gable = [[-8.4, 0], [8.4, 0], [8.4, S.eave]].concat(gTop).concat([[-8.4, S.eave]]);
    wallL(K, { axis: "z", c0: -18.4, out: -1, outline: gable, holes: [circHole(0, 10.3, 1.35, 28), archHole(-7.6, -6.4, 1.1, 2.4), archHole(-7.6, -6.4, 4.6, 5.9)] });
    // the north-east gable: below the archive roof both faces are inside (the reading room and the archive)
    wallL(K, { axis: "z", c0: 18.4, out: 1, outline: [[-8.4, 0], [8.4, 0], [8.4, 7.0], [-8.4, 7.0]], holes: [rectHole(-1.3, 0.3, F, 2.9)], bOut: "plaster", cOut: COL.plaster, bSide: "plaster", cSide: COL.plaster, grime: null });
    var ng = [[-8.4, 7.0], [8.4, 7.0], [8.4, S.eave]].concat(gTop).concat([[-8.4, S.eave]]);
    wallL(K, { axis: "z", c0: 18.4, out: 1, outline: ng, holes: [circHole(0, 10.3, 1.35, 28)], grime: null });
    // plinth, cornice and rafter tails
    K.box("cantera", COL.cant, 38.16, 0.8, 0.1, 0, 0.4, -9.04, 0, 1.4); K.box("cantera", COL.cant, 0.1, 0.8, 16.1, -19.04, 0.4, -1.0, 0, 1.4);
    K.box("cantera", COL.cant, 38.5, 0.32, 0.22, 0, S.eave - 0.16, 9.08, 0, 1.4); K.box("cantera", COL.cant, 38.5, 0.32, 0.22, 0, S.eave - 0.16, -9.08, 0, 1.4);
    for (var rx = -18.3; rx <= 18.31; rx += 0.61) { [1, -1].forEach(function (sd) { K.box("wood", COL.woodD, 0.1, 0.15, 0.62, rx, 8.62, sd * 9.31, 0, 0.8); }); }
    // ── the roof: barrel tile planes, the ridge and the eave caps ──
    var rY = S.ridge, eY = S.eave - 0.15, eZ = 9.6, L1 = Math.hypot(eZ, rY - eY) / 2.2;
    quad(K, "tile", COL.tile, [-18.4, eY, eZ], [18.4, eY, eZ], [18.4, rY, 0], [-18.4, rY, 0], [-11.5, 0], [11.5, 0], [11.5, L1], [-11.5, L1]);
    quad(K, "tile", COL.tile, [18.4, eY, -eZ], [-18.4, eY, -eZ], [-18.4, rY, 0], [18.4, rY, 0], [-11.5, 0], [11.5, 0], [11.5, L1], [-11.5, L1]);
    K.box("wood", COL.woodD, 36.8, 0.12, 0.12, 0, eY - 0.06, eZ - 0.04, 0, 1); K.box("wood", COL.woodD, 36.8, 0.12, 0.12, 0, eY - 0.06, -eZ + 0.04, 0, 1);
    var ridge = new THREE.CylinderGeometry(0.17, 0.17, 36.8, 12, 1, true, 0, PI); ridge.rotateZ(PI / 2); var RU = ridge.attributes.uv; for (var ri = 0; ri < RU.count; ri++) RU.setXY(ri, RU.getX(ri) * 0.16, RU.getY(ri) * 11.5); K.place("tile", ridge, [0.92, 0.86, 0.82], 0, rY + 0.02, 0);
    var dn = new THREE.Vector3(0, -(rY - eY), eZ).normalize(); tileCaps(K, V3(-18.2, eY + 0.05, eZ - 0.12), V3(18.2, eY + 0.05, eZ - 0.12), dn, 0.24, 0.115, 0.34);
    var dnB = new THREE.Vector3(0, -(rY - eY), -eZ).normalize(); tileCaps(K, V3(-18.2, eY + 0.05, -eZ + 0.12), V3(18.2, eY + 0.05, -eZ + 0.12), dnB, 0.24, 0.115, 0.34);
    // gable copings: cantera caps along the parapet tops (short boxes following the curve)
    [-18.7, 18.7].forEach(function (gx) { for (var i = 0; i < gTop.length - 1; i++) { var a = gTop[i], b = gTop[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.05) continue; var g = new THREE.BoxGeometry(0.78, 0.12, len + 0.04); g.rotateX(-Math.atan2(b[1] - a[1], b[0] - a[0])); g.translate(gx, (a[1] + b[1]) / 2 + 0.05, (a[0] + b[0]) / 2); uvWorld(g, 1.4, "auto"); K.add("cantera", g, COL.cant); } });
    // the oculi: cantera rings and iron tracery
    [[-19.0, -1], [19.0, 1]].forEach(function (q) { var g = new THREE.ExtrudeGeometry(ringShape(0, 10.3, 1.35, 1.62, 32), { depth: 0.14, bevelEnabled: false, curveSegments: 1 }); g = g.toNonIndexed(); g.rotateY(q[1] * PI / 2); g.translate(q[0] + q[1] * 0.0, 0, 0); g.computeVertexNormals(); uvWorld(g, 1.4, "auto"); K.add("cantera", g, COL.cant);
      for (var sp = 0; sp < 8; sp++) { var a = sp / 8 * PI; K.box("iron", COL.iron, 0.05, 2.7, 0.05, q[0] - q[1] * 0.3, 10.3, 0, 0, 0, a, 0); } K.place("iron", new THREE.TorusGeometry(0.62, 0.035, 6, 32), COL.iron, q[0] - q[1] * 0.3, 10.3, 0, PI / 2);
      var gl = new THREE.CircleGeometry(1.36, 28); K.place("glass", gl, 0xffffff, q[0] - q[1] * 0.3, 10.3, 0, q[1] * PI / 2); });
    yield 1;
    // ── the arcade: nine bays (four each side of the pavilion), saltillo floor, timber ceiling, tiled shed roof ──
    [[-19, -5], [5, 19]].forEach(function (w) { var my = bays.filter(function (b) { return b[0] >= w[0] - 0.01 && b[1] <= w[1] + 0.01; }), pts = [[w[0], 5.45]];
      my.forEach(function (b, i) { var n = notch(b[0], b[1], 0.3, 3.3); if (i === 0) { if (b[0] > w[0] + 0.01) pts.push([w[0], 0.3]); else n.shift(); } if (i === my.length - 1 && !(b[1] < w[1] - 0.01)) n.pop(); pts = pts.concat(n); });
      if (my[my.length - 1][1] < w[1] - 0.01) pts.push([w[1], 0.3]); pts.push([w[1], 5.45]);
      wallL(K, { axis: "x", c0: 13.0, out: 1, outline: pts, bIn: "stucco", cIn: COL.st, grime: [0, 1.4, 0.14] }); });
    wallL(K, { axis: "z", c0: 18.4, out: 1, outline: [[9.0, 5.45], [9.0, 0.3], [9.4, 0.3]].concat(notch(9.4, 12.6, 0.3, 3.3).slice(1)).concat([[13.0, 0.3], [13.0, 5.45]]), bIn: "stucco", cIn: COL.st, grime: [0, 1.4, 0.14] });
    bays.forEach(function (b) { var c = (b[0] + b[1]) / 2, r = (b[1] - b[0]) / 2; archRing(K, "cantera", COL.cant, c, 3.3, r, r + 0.2, 13.6, 0.07); });
    piers.push([-19, -18.3]); piers.push([18.3, 19]); piers.forEach(function (p) { var c = (p[0] + p[1]) / 2; K.box("cantera", COL.cant, 0.84, 0.22, 0.74, c, 3.2, 13.3, 0, 1.4); K.box("cantera", COL.cant, 0.84, 0.5, 0.74, c, 0.55, 13.3, 0, 1.4); so(SO, c, 13.3, 0.7, 0.6, 0, 5.45, 0, { noStep: true }); });
    so(SO, 18.7, 9.2, 0.6, 0.4, 0, 5.45, 0, { noStep: true }); so(SO, 18.7, 12.8, 0.6, 0.4, 0, 5.45, 0, { noStep: true });
    K.box("cantera", COL.cant, 14.2, 0.24, 0.72, -12, 5.33, 13.3, 0, 1.4); K.box("cantera", COL.cant, 14.2, 0.24, 0.72, 12, 5.33, 13.3, 0, 1.4);
    // floor (arcade and porch) and the front step
    K.box("paver", [0.95, 0.9, 0.86], 38, 0.3, 4.6, 0, 0.15, 11.3, 0, 1.2); K.box("paver", [0.95, 0.9, 0.86], 8.8, 0.3, 1.0, 0, 0.15, 14.1, 0, 1.2);
    K.box("cantera", COL.cant, 28.2, 0.16, 0.5, -0, 0.08, 13.85, 0, 1.4); K.box("cantera", COL.cant, 9.6, 0.16, 0.55, 0, 0.08, 14.88, 0, 1.4);
    so(SO, 0, 11.3, 38, 4.6, -0.4, F, 0); so(SO, 0, 14.1, 8.8, 1.0, -0.4, F, 0); so(SO, -12.0, 13.85, 14.0, 0.5, -0.4, 0.16, 0); so(SO, 12.0, 13.85, 14.0, 0.5, -0.4, 0.16, 0); so(SO, 0, 14.88, 9.6, 0.55, -0.4, 0.16, 0);
    // the shed roofs and the timber ceilings under them
    [[-19, -5], [5, 19]].forEach(function (w) { var x0 = w[0], x1 = w[1], u0 = x0 / 1.6, u1 = x1 / 1.6, L2 = Math.hypot(4.95, 1.05) / 2.2;
      quad(K, "tile", COL.tile, [x0, 5.55, 13.95], [x1, 5.55, 13.95], [x1, 6.6, 9.0], [x0, 6.6, 9.0], [u0, 0], [u1, 0], [u1, L2], [u0, L2]);
      quad(K, "wood", [0.78, 0.62, 0.48], [x0, 5.48, 13.0], [x0, 6.48, 9.0], [x1, 6.48, 9.0], [x1, 5.48, 13.0], [x0 / 2.0, 0], [x0 / 2.0, 2.0], [x1 / 2.0, 2.0], [x1 / 2.0, 0]);
      for (var bx = x0 + 0.9; bx < x1 - 0.5; bx += 1.75) { var g = new THREE.BoxGeometry(0.16, 0.22, 4.2); g.rotateX(Math.atan2(1.0, 4.0)); g.translate(bx, 5.86, 11.0); uvWorld(g, 1.0, "auto"); K.add("wood", g, COL.woodD); }
      tileCaps(K, V3(x0 + 0.12, 5.6, 13.84), V3(x1 - 0.12, 5.6, 13.84), new THREE.Vector3(0, -1.05, 4.95).normalize(), 0.24, 0.11, 0.3); });
    // hanging lanterns in every bay and the porch; benches under the windows
    bc.forEach(function (c, i) { lantern(K, c, 4.35, 11.2, 0.9); if (i % 2 === 0) { bench(K, SO, c, 9.42, 0, 2.0); } });
    lantern(K, 0, 5.15, 11.6, 1.1);
    yield 1;
    // ── the entrance pavilion: the tall arch, the name, the quatrefoil, the curvilinear parapet ──
    var pTop = missionTop(5.0, 9.9, 10.6, 13.15, 1.0);
    var pf = [[-5, 0], [-1.9, 0]].concat(notch(-1.9, 1.9, 0, 4.3, 18).slice(1, -1)).concat([[1.9, 0], [5, 0]]).concat(pTop.slice(1, -1));
    wallL(K, { axis: "x", c0: 14.0, out: 1, outline: pf.concat([[-5, 9.9]]), holes: [quatrefoil(0, 8.3, 0.85)], bIn: "stucco", cIn: COL.st });
    [[-4.4, -1], [4.4, 1]].forEach(function (q) { wallL(K, { axis: "z", c0: q[0], out: q[1], outline: [[9.0, 9.9], [9.0, 0.3], [10.0, 0.3]].concat(notch(10.0, 12.6, 0.3, 3.3).slice(1)).concat([[14.0, 0.3], [14.0, 9.9]]), bIn: "stucco", cIn: COL.st }); so(SO, q[0] + q[1] * 0.3, 9.5, 0.6, 1.0, 0, 9.9, 0, { noStep: true }); so(SO, q[0] + q[1] * 0.3, 13.3, 0.6, 1.4, 0, 9.9, 0, { noStep: true }); });
    so(SO, -3.45, 14.3, 3.1, 0.6, 0, 9.9, 0, { noStep: true }); so(SO, 3.45, 14.3, 3.1, 0.6, 0, 9.9, 0, { noStep: true });
    archRing(K, "cantera", COL.cant, 0, 4.3, 1.9, 2.25, 14.6, 0.1); archRing(K, "cantera", COL.cant, 0, 4.3, 2.25, 2.45, 14.6, 0.05);
    [-2.08, 2.08].forEach(function (x) { K.box("cantera", COL.cant, 0.36, 4.3, 0.14, x, 2.15, 14.66, 0, 1.4); K.box("cantera", COL.cant, 0.5, 0.25, 0.2, x, 4.25, 14.7, 0, 1.4); });
    K.box("cantera", COL.cant, 10.5, 0.3, 0.3, 0, 9.75, 14.62, 0, 1.4); K.box("cantera", COL.cant, 10.2, 0.8, 0.1, -0, 0.4, 14.62, 0, 1.4);
    for (var i2 = 0; i2 < pTop.length - 1; i2++) { var a2 = pTop[i2], b2 = pTop[i2 + 1], len2 = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]); if (len2 < 0.05) continue; var g2 = new THREE.BoxGeometry(len2 + 0.04, 0.12, 0.72); g2.rotateZ(Math.atan2(b2[1] - a2[1], b2[0] - a2[0])); g2.translate((a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2 + 0.05, 14.3); uvWorld(g2, 1.4, "auto"); K.add("cantera", g2, COL.cant); }
    K.place("cantera", new THREE.CylinderGeometry(0.75, 0.75, 0.16, 32), COL.cant, 0, 11.65, 14.66, 0, PI / 2); openBook(K, 0, 11.65, 14.76);
    var qg = new THREE.ShapeGeometry(shapeFrom(quatrefoil(0, 8.3, 0.86))); K.place("glassD", qg, 0xffffff, 0, 0, 14.3); var qf = new THREE.ExtrudeGeometry((function () { var s = shapeFrom(quatrefoil(0, 8.3, 1.02)); s.holes.push(pathFrom(quatrefoil(0, 8.3, 0.85).reverse())); return s; })(), { depth: 0.1, bevelEnabled: false }); qf = qf.toNonIndexed(); qf.translate(0, 0, 14.6); qf.computeVertexNormals(); uvWorld(qf, 1.4, "auto"); K.add("cantera", qf, COL.cant);
    letters(K, 0, 0, 7.1, 14.64, 7.6, 0.6, 0);
    K.box("iron", [0.08, 0.075, 0.07], 8.8, 0.12, 5.0, 0, 9.9, 11.5, 0, 0); K.box("wood", [0.66, 0.52, 0.4], 8.8, 0.18, 5.0, 0, 6.6, 11.5, 0, 1.0);
    for (var pb = -3.6; pb <= 3.61; pb += 1.2) K.box("wood", COL.woodD, 0.18, 0.26, 5.0, pb, 6.42, 11.5, 0, 1.0);
    // the main doors, standing open into the porch: carved oak leaves with iron studs; the fanlight
    [-1, 1].forEach(function (sd) { var cx = sd * 1.98; K.box("wood", [0.55, 0.38, 0.26], 1.3, 3.4, 0.09, cx, F + 1.7, 9.14, 0, 0.9);
      for (var py = 0; py < 3; py++) K.box("wood", [0.45, 0.3, 0.2], 0.95, 0.8, 0.05, cx, F + 0.55 + py * 1.05, 9.21, 0, 0.9);
      for (var st = 0; st < 12; st++) K.sph("iron", COL.iron, 0.025, cx - 0.5 + (st % 4) * 0.33, F + 0.6 + Math.floor(st / 4) * 1.05, 9.23, 6); });
    var fan = new THREE.CircleGeometry(1.3, 20, 0, PI); K.place("glass", fan, 0xffffff, 0, doorH, 8.7); for (var fr = 0; fr < 5; fr++) K.box("iron", COL.iron, 0.04, 1.3, 0.04, Math.cos((fr + 0.5) / 5 * PI) * 0.65, doorH + Math.sin((fr + 0.5) / 5 * PI) * 0.65, 8.72, 0, 0, 0, -((fr + 0.5) / 5 * PI - PI / 2));
    yield 1;
    // windows: oak frames, muntins, glass (front lower and upper rows, back clerestories, gable windows)
    bc.forEach(function (c) { archWindow(K, c, 1.5, winY0, winYs, 8.7, 0); archWindow(K, c, 1.3, upY0, upYs, 8.7, 0.25); K.box("cantera", COL.cant, 1.8, 0.1, 0.4, c, winY0 - 0.05, 9.1, 0, 1.4); });
    cl.forEach(function (c) { archWindow(K, c, 1.3, 7.25, 8.15, -8.7, 0.25); });
    [-7.0].forEach(function (z) { var m = new THREE.Matrix4().makeRotationY(PI / 2); [[1.1, 2.4], [4.6, 5.9]].forEach(function (yy) { archWindow(K, -z, 1.2, yy[0], yy[1], -18.7, 0, m); }); });
    // ── the tower: shaft, clocks, belfry with its bell, cornices, the drum and the tiled dome, the lantern and the biplane weathervane ──
    var tx0 = -25.6, tx1 = -19.0, tz0 = 7.0, tz1 = 13.6, tcx = (tx0 + tx1) / 2, tcz = (tz0 + tz1) / 2, tw = tx1 - tx0;
    var sh = new THREE.BoxGeometry(tw, 10.3, tw); uvBox(sh, tw, 10.3, tw, 2.5); sh.translate(tcx, 5.15, tcz); var shg = sh.toNonIndexed(); sh.dispose(); colorize(shg, COL.st); grime(shg, 0, 1.8, 0.16); K.add("stucco", shg);
    so(SO, tcx, tcz, tw, tw, 0, 10.3, 0, { noStep: true });
    K.box("cantera", COL.cant, tw + 0.24, 1.0, tw + 0.24, tcx, 0.5, tcz, 0, 1.4); K.box("cantera", COL.cant, tw + 0.16, 0.24, tw + 0.16, tcx, 6.0, tcz, 0, 1.4); K.box("cantera", COL.cant, tw + 0.4, 0.36, tw + 0.4, tcx, 10.32, tcz, 0, 1.4);
    // the blind arch on the front face with a bench in it, slit windows
    archRing(K, "cantera", COL.cant, tcx, 2.6, 1.2, 1.45, tz1, 0.08); K.box("cantera", COL.cant, 0.25, 2.6, 0.08, tcx - 1.32, 1.3, tz1 + 0.04, 0, 1.4); K.box("cantera", COL.cant, 0.25, 2.6, 0.08, tcx + 1.32, 1.3, tz1 + 0.04, 0, 1.4);
    K.place("stucco", new THREE.PlaneGeometry(2.4, 2.6), COL.stB, tcx, 1.3 + 0.0, tz1 + 0.012); K.place("stucco", new THREE.CircleGeometry(1.2, 16, 0, PI), COL.stB, tcx, 2.6, tz1 + 0.012); bench(K, SO, tcx, tz1 + 0.35, 0, 2.0);
    [[tcx, tz1 + 0.01, 0], [tx0 - 0.01, tcz, -PI / 2]].forEach(function (q) { var g = new THREE.PlaneGeometry(0.34, 1.4); K.place("glassD", g, 0xffffff, q[0], 4.6, q[1], q[2]); });
    // clocks on three faces (the hands are their own meshes so they can turn)
    EX.clocks = [[tcx, tz1 + 0.06, 0], [tx0 - 0.06, tcz, -PI / 2], [tx1 + 0.06, tcz, PI / 2]];
    EX.clocks.forEach(function (q) { var g = new THREE.CircleGeometry(0.95, 40); K.place("clock", g, 0xffffff, q[0], 8.6, q[1], q[2]); var rg = new THREE.TorusGeometry(1.02, 0.09, 8, 40); K.place("cantera", rg, COL.cant, q[0], 8.6, q[1], q[2]); });
    // the belfry: four arched faces, a bell on a beam
    var bx0 = tx0 + 0.3, bx1 = tx1 - 0.3, bz0 = tz0 + 0.3, bz1 = tz1 - 0.3, bw = bx1 - bx0, bcx = (bx0 + bx1) / 2, bcz = (bz0 + bz1) / 2;
    wallL(K, { axis: "x", c0: bz1 - 0.5, out: 1, outline: [[bx0, 10.3], [bx1, 10.3], [bx1, 13.3], [bx0, 13.3]], holes: [archHole(bcx - 1.15, bcx + 1.15, 10.7, 11.85)], depth: 0.5, bIn: "stucco", cIn: COL.st, grime: null });
    wallL(K, { axis: "x", c0: bz0 + 0.5, out: -1, outline: [[bx0, 10.3], [bx1, 10.3], [bx1, 13.3], [bx0, 13.3]], holes: [archHole(bcx - 1.15, bcx + 1.15, 10.7, 11.85)], depth: 0.5, bIn: "stucco", cIn: COL.st, grime: null });
    wallL(K, { axis: "z", c0: bx0 + 0.5, out: -1, outline: [[bz0 + 0.5, 10.3], [bz1 - 0.5, 10.3], [bz1 - 0.5, 13.3], [bz0 + 0.5, 13.3]], holes: [archHole(bcz - 1.15, bcz + 1.15, 10.7, 11.85)], depth: 0.5, bIn: "stucco", cIn: COL.st, grime: null });
    wallL(K, { axis: "z", c0: bx1 - 0.5, out: 1, outline: [[bz0 + 0.5, 10.3], [bz1 - 0.5, 10.3], [bz1 - 0.5, 13.3], [bz0 + 0.5, 13.3]], holes: [archHole(bcz - 1.15, bcz + 1.15, 10.7, 11.85)], depth: 0.5, bIn: "stucco", cIn: COL.st, grime: null });
    K.box("cantera", COL.cant, bw + 0.5, 0.4, bw + 0.5, bcx, 13.5, bcz, 0, 1.4); K.box("stucco", COL.stB, bw - 0.4, 0.1, bw - 0.4, bcx, 12.95, bcz, 0, 2.5);
    K.box("wood", COL.woodD, bw - 0.9, 0.24, 0.24, bcx, 12.7, bcz, 0, 1.0); K.lathe("bronze", COL.bronze, [[0.0, 0], [0.62, 0.02], [0.6, 0.12], [0.5, 0.3], [0.42, 0.7], [0.36, 0.95], [0.18, 1.05], [0.06, 1.12], [0, 1.12]], bcx, 11.45, bcz, 20);
    [[bx0 + 0.2, bz0 + 0.2], [bx1 - 0.2, bz0 + 0.2], [bx0 + 0.2, bz1 - 0.2], [bx1 - 0.2, bz1 - 0.2]].forEach(function (p) { K.lathe("cantera", COL.cant, [[0.0, 0], [0.26, 0], [0.26, 0.1], [0.14, 0.2], [0.22, 0.45], [0.18, 0.62], [0.06, 0.7], [0.1, 0.8], [0, 0.9]], p[0], 13.7, p[1], 12); });
    K.cyl("stucco", COL.st, 2.35, 2.45, 0.95, bcx, 14.18, bcz, 8, false, PI / 8); K.cyl("cantera", COL.cant, 2.55, 2.55, 0.14, bcx, 14.7, bcz, 8, false, PI / 8);
    var dome = new THREE.LatheGeometry([[2.42, 0], [2.36, 0.4], [2.18, 0.9], [1.85, 1.35], [1.32, 1.72], [0.7, 1.95], [0.06, 2.04]].map(function (q) { return new THREE.Vector2(q[0], q[1]); }), 32); var DU = dome.attributes.uv; for (var di = 0; di < DU.count; di++) DU.setXY(di, DU.getX(di) * 9, DU.getY(di) * 1.5); K.place("tile", dome, COL.tile, bcx, 14.77, bcz);
    K.cyl("cantera", COL.cant, 0.34, 0.4, 0.5, bcx, 17.05, bcz, 12); K.cyl("cantera", COL.cant, 0.46, 0.36, 0.12, bcx, 17.36, bcz, 12); K.sph("bronze", COL.bronze, 0.14, bcx, 17.55, bcz, 10);
    K.cyl("iron", COL.iron, 0.025, 0.025, 1.1, bcx, 18.1, bcz, 6);
    (function () { var vy = 18.75, r = -0.93, c = Math.cos(r), sn = Math.sin(r), P = function (u, v) { return [bcx + u * c + v * sn, bcz - u * sn + v * c]; }, q;
      q = P(0, 0); K.box("iron", COL.iron, 1.5, 0.13, 0.13, q[0], vy, q[1], r); q = P(0.32, 0); K.box("iron", COL.iron, 0.26, 0.035, 2.0, q[0], vy + 0.2, q[1], r); K.box("iron", COL.iron, 0.24, 0.035, 1.7, q[0], vy - 0.12, q[1], r);
      [-0.55, 0.55].forEach(function (v) { var w = P(0.32, v); K.box("iron", COL.iron, 0.03, 0.32, 0.03, w[0], vy + 0.04, w[1], r); });
      q = P(-0.66, 0); K.box("iron", COL.iron, 0.2, 0.34, 0.03, q[0], vy + 0.14, q[1], r); K.box("iron", COL.iron, 0.18, 0.03, 0.56, q[0], vy + 0.02, q[1], r);
      q = P(0.77, 0); K.cyl("iron", COL.iron, 0.07, 0.07, 0.04, q[0], vy, q[1], 10, false, r, 0, PI / 2); K.box("iron", COL.iron, 0.02, 0.5, 0.05, q[0] + c * 0.02, vy, q[1] - sn * 0.02, r); })();
    yield 1;
    // ── the archive wing: vault walls, high barred windows, its own parapet with the name and a medallion ──
    var aTop = missionTop(6.5, 7.6, 7.95, 9.3, 0.7).map(function (q) { return [q[0] + 25.5, q[1]]; });
    wallL(K, { axis: "z", c0: 31.3, out: 1, outline: [[-9.0, 0], [8.0, 0], [8.0, 7.6], [-9.0, 7.6]], holes: [-5.5, -0.5, 4.5].map(function (z) { return rectHole(z - 0.5, z + 0.5, 3.7, 4.8); }), depth: 0.7 });
    wallL(K, { axis: "x", c0: -8.3, out: -1, outline: [[19.0, 0], [32.0, 0], [32.0, 7.6], [19.0, 7.6]], holes: [22.5, 28.0].map(function (x) { return rectHole(x - 0.5, x + 0.5, 3.7, 4.8); }), depth: 0.7 });
    wallL(K, { axis: "x", c0: 7.3, out: 1, outline: [[19.0, 0], [32.0, 0], [32.0, 7.6]].concat(aTop.slice(1, -1)).concat([[19.0, 7.6]]), depth: 0.7 });
    K.box("cantera", COL.cant, 13.1, 0.8, 0.1, 25.5, 0.4, 8.05, 0, 1.4); K.box("cantera", COL.cant, 0.1, 0.8, 17.1, 32.05, 0.4, -0.5, 0, 1.4); K.box("cantera", COL.cant, 13.1, 0.8, 0.1, 25.5, 0.4, -9.05, 0, 1.4);
    K.box("iron", [0.1, 0.095, 0.09], 12.6, 0.1, 16.3, 25.5, 7.0, -0.5, 0, 0);
    [[25.5, 7.7, -9.0, 13.2, 0], [32.0, 7.7, -0.5, 17.2, PI / 2]].forEach(function (q) { K.box("tile", [0.95, 0.9, 0.86], q[3], 0.14, 0.82, q[0], q[1], q[2], q[4], 1.6); });
    for (var ai = 0; ai < aTop.length - 1; ai++) { var a3 = aTop[ai], b3 = aTop[ai + 1], len3 = Math.hypot(b3[0] - a3[0], b3[1] - a3[1]); if (len3 < 0.05) continue; var g3 = new THREE.BoxGeometry(len3 + 0.04, 0.12, 0.84); g3.rotateZ(Math.atan2(b3[1] - a3[1], b3[0] - a3[0])); g3.translate((a3[0] + b3[0]) / 2, (a3[1] + b3[1]) / 2 + 0.05, 7.65); uvWorld(g3, 1.4, "auto"); K.add("cantera", g3, COL.cant); }
    letters(K, 1, 25.5, 6.35, 8.04, 7.4, 0.58, 0); K.place("cantera", new THREE.CylinderGeometry(0.62, 0.62, 0.14, 32), COL.cant, 25.5, 8.25, 8.06, 0, PI / 2); biplaneRelief(K, 25.5, 8.25, 8.15);
    // barred windows of the archive
    [-5.5, -0.5, 4.5].forEach(function (z) { barWin(K, 31.65, z, PI / 2); }); [22.5, 28.0].forEach(function (x) { barWin(K, x, -8.65, 0); });
    so(SO, 31.65, -0.5, 0.7, 17.0, 0, 7.6, 0, { noStep: true }); so(SO, 25.5, -8.65, 13.0, 0.7, 0, 7.6, 0, { noStep: true }); so(SO, 25.5, 7.65, 13.0, 0.7, 0, 7.6, 0, { noStep: true });
    // reading room wall solids (the door and the vault opening left open)
    so(SO, -10.15, 8.7, 17.7, 0.6, 0, S.eave, 0, { noStep: true }); so(SO, 10.15, 8.7, 17.7, 0.6, 0, S.eave, 0, { noStep: true }); so(SO, 0, 8.7, 2.6, 0.6, F + doorH + 1.3, S.eave, 0, { noStep: true });
    so(SO, 0, -8.7, 38, 0.6, 0, S.eave, 0, { noStep: true }); so(SO, -18.7, 0, 0.6, 16.8, 0, S.eave, 0, { noStep: true });
    so(SO, 18.7, -4.85, 0.6, 7.1, 0, S.eave, 0, { noStep: true }); so(SO, 18.7, 4.35, 0.6, 8.1, 0, S.eave, 0, { noStep: true }); so(SO, 18.7, -0.5, 0.6, 1.6, 2.9, S.eave, 0, { noStep: true });
    yield 1;
    // ── the forecourt: terracotta pavers with cantera bands, the talavera fountain, benches, palms in raised planters, lamps, the sign ──
    var fz0 = S.fore[2], fz1 = S.fore[3];
    K.box("paver", [0.9, 0.86, 0.8], 30, 0.08, fz1 - fz0, 0, 0.04, (fz0 + fz1) / 2, 0, 1.92);
    [[0, (fz0 + fz1) / 2, 1.6, fz1 - fz0], [0, fz0 + 0.25, 30, 0.5], [0, fz1 - 0.25, 30, 0.5], [-14.75, (fz0 + fz1) / 2, 0.5, fz1 - fz0], [14.75, (fz0 + fz1) / 2, 0.5, fz1 - fz0], [0, 23.0, 30, 1.0]].forEach(function (b) { K.box("cantera", COL.cant, b[2], 0.09, b[3], b[0], 0.045, b[1], 0, 1.4); });
    so(SO, 0, (fz0 + fz1) / 2, 30, fz1 - fz0, -0.4, 0.085, 0); so(SO, (S.patio[0] + S.patio[1]) / 2, (S.patio[2] + S.patio[3]) / 2, S.patio[1] - S.patio[0], S.patio[3] - S.patio[2], -0.4, 0.085, 0);
    fountain(K, SO, 0, 23.0);
    [[45, 4.4], [135, 4.4], [225, 4.4], [315, 4.4]].forEach(function (q) { var a = q[0] * PI / 180, x = Math.sin(a) * q[1], z = 23.0 + Math.cos(a) * q[1]; bench(K, SO, x, z, a + PI, 1.9); });
    [[-13.4, 1], [13.4, -1]].forEach(function (q) { K.box("stucco", COL.st, 2.2, 0.62, 12.0, q[0], 0.31, 22.5, 0, 2.5); K.box("cantera", COL.cant, 2.46, 0.1, 12.26, q[0], 0.66, 22.5, 0, 1.4); K.box("iron", [0.16, 0.12, 0.09], 1.96, 0.04, 11.76, q[0], 0.6, 22.5, 0, 0); so(SO, q[0], 22.5, 2.46, 12.26, 0, 0.7, 0, { noStep: true }); });
    [[-11.4, 15.8], [11.4, 15.8], [-11.4, 29.6], [11.4, 29.6]].forEach(function (p) { lampPost(K, SO, p[0], p[1]); });
    K.box("stucco", COL.st, 4.6, 1.25, 0.55, -9.0, 0.62, 31.6, 0, 2.5); K.box("cantera", COL.cant, 4.8, 0.14, 0.7, -9.0, 1.3, 31.6, 0, 1.4); K.plane("signs", 0xffffff, 3.9, 0.98, -9.0, 0.68, 31.885, 0, 0, sUV("mono")); so(SO, -9.0, 31.6, 4.8, 0.7, 0, 1.37, 0, { noStep: true });
    // ── the patio by the archive: pavers, low walls, the talavera wall fountain, benches ──
    var pa = S.patio; K.box("paver", [0.9, 0.86, 0.8], pa[1] - pa[0], 0.08, pa[3] - pa[2], (pa[0] + pa[1]) / 2, 0.04, (pa[2] + pa[3]) / 2, 0, 1.92);
    K.box("stucco", COL.st, 0.45, 0.95, pa[3] - pa[2], pa[1] - 0.22, 0.48, (pa[2] + pa[3]) / 2, 0, 2.5); K.box("cantera", COL.cant, 0.6, 0.09, pa[3] - pa[2] + 0.1, pa[1] - 0.22, 1.0, (pa[2] + pa[3]) / 2, 0, 1.4); so(SO, pa[1] - 0.22, (pa[2] + pa[3]) / 2, 0.6, pa[3] - pa[2], 0, 1.05, 0, { noStep: true });
    K.box("stucco", COL.st, 7.0, 0.95, 0.45, 28.5, 0.48, pa[3] - 0.22, 0, 2.5); K.box("cantera", COL.cant, 7.1, 0.09, 0.6, 28.5, 1.0, pa[3] - 0.22, 0, 1.4); so(SO, 28.5, pa[3] - 0.22, 7.1, 0.6, 0, 1.05, 0, { noStep: true });
    wallFountain(K, SO, 25.5, 8.0); bench(K, SO, 22.4, 8.5, 0, 1.8); bench(K, SO, 28.6, 8.5, 0, 1.8);
    yield 1;
    // night glows: warm pools on the arcade floor and the forecourt under the lamps, uplight washes on the pavilion and the tower
    var GL = new Kit(), pool = function (x, y, z, r, c) { var g = new THREE.PlaneGeometry(r * 2, r * 2); g.rotateX(-PI / 2); GL.place("pool", g, c, x, y, z); };
    bc.forEach(function (c) { pool(c, 0.32, 11.2, 2.4, [0.5, 0.36, 0.2]); }); pool(0, 0.32, 11.6, 3.0, [0.55, 0.4, 0.22]);
    [[-11.4, 15.8], [11.4, 15.8], [-11.4, 29.6], [11.4, 29.6]].forEach(function (p) { pool(p[0], 0.1, p[1], 3.4, [0.5, 0.36, 0.2]); });
    var wash = function (x, y, z, w, h, ry) { var g = new THREE.PlaneGeometry(w, h); var C = g.attributes.uv; for (var i = 0; i < C.count; i++) C.setXY(i, C.getX(i), 0.5 + C.getY(i) * 0.5); GL.place("glowA", g, [0.46, 0.33, 0.19], x, y, z, ry); };
    wash(0, 4.8, 14.7, 6.5, 7.0, 0); wash(tcx, 6.0, tz1 + 0.12, 5.5, 8.0, 0); wash(25.5, 4.6, 8.12, 6.0, 6.0, 0);
    EX.glow = GL;
  }
  // ── small builders shared by the exterior ──
  function lantern(K, x, y, z, s) { s = s || 1; if (K.dry) return; K.box("iron", COL.iron, 0.34 * s, 0.05, 0.34 * s, x, y + 0.36 * s, z); K.box("iron", COL.iron, 0.28 * s, 0.04, 0.28 * s, x, y - 0.3 * s, z); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { K.box("iron", COL.iron, 0.025, 0.66 * s, 0.025, x + q[0] * 0.14 * s, y, z + q[1] * 0.14 * s); });
    K.box("lamp", 0xffffff, 0.24 * s, 0.56 * s, 0.24 * s, x, y + 0.02, z); K.lathe("iron", COL.iron, [[0.2 * s, 0], [0.12 * s, 0.14 * s], [0.03, 0.22 * s], [0, 0.24 * s]], x, y + 0.38 * s, z, 8); K.cyl("iron", COL.iron, 0.012, 0.012, 0.6, x, y + 0.9 * s, z, 4); EX.lampSrc = EX.lampSrc || []; EX.lampSrc.push([x, y, z]); }
  function bench(K, SO, x, z, ry, len) { var c = Math.cos(ry), s = Math.sin(ry); var P = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; };
    [-len / 2 + 0.2, len / 2 - 0.2].forEach(function (lx) { var p = P(lx, 0); K.box("cantera", COL.cant, 0.18, 0.42, 0.42, p[0], 0.21 + 0.0, p[1], ry, 1.4); });
    for (var i = 0; i < 4; i++) { var p2 = P(0, -0.15 + i * 0.1); K.box("wood", [0.72, 0.55, 0.4], len, 0.05, 0.085, p2[0], 0.45, p2[1], ry, 0.8); }
    var pb = P(0, -0.22); K.box("wood", [0.7, 0.53, 0.38], len, 0.32, 0.05, pb[0], 0.68, pb[1], ry + 0, 0.8);
    var pc = P(0, 0.0); so(SO, pc[0], pc[1], len, 0.46, 0, 0.47, ry, { seat: true, face: ry, tag: "bench" }); }
  function lampPost(K, SO, x, z) { K.cyl("cantera", COL.cant, 0.22, 0.26, 0.5, x, 0.25, z, 8); K.cyl("iron", COL.iron, 0.06, 0.08, 3.4, x, 2.2, z, 8); K.box("iron", COL.iron, 0.5, 0.04, 0.04, x + 0.0, 3.85, z, 0); lantern(K, x, 4.1, z, 1.2); so(SO, x, z, 0.5, 0.5, 0, 3.0, 0, { noStep: true }); }
  function letters(K, row, x, y, z, w, h, ry) { var g = new THREE.PlaneGeometry(w, h); var U = g.attributes.uv; var v0 = row === 0 ? 0.5 : 0.0; for (var i = 0; i < U.count; i++) U.setXY(i, 0.04 + U.getX(i) * 0.92, v0 + U.getY(i) * 0.5); K.place("letters", g, 0xffffff, x, y, z, ry); }
  function openBook(K, x, y, z) { [-1, 1].forEach(function (sd) { K.box("cantera", [0.9, 0.84, 0.76], 0.42, 0.56, 0.06, x + sd * 0.22, y, z, -sd * 0.25, 1.0); }); K.box("cantera", [0.86, 0.8, 0.72], 0.05, 0.6, 0.08, x, y, z + 0.02); }
  function biplaneRelief(K, x, y, z) { K.box("bronze", COL.bronze, 0.62, 0.07, 0.05, x, y, z); K.box("bronze", COL.bronze, 0.09, 0.62, 0.05, x - 0.1, y + 0.02, z); K.box("bronze", COL.bronze, 0.07, 0.5, 0.05, x - 0.02, y - 0.06, z, 0, 0, 0.1); K.box("bronze", COL.bronze, 0.05, 0.24, 0.05, x + 0.28, y + 0.04, z); K.cyl("bronze", COL.bronze, 0.05, 0.05, 0.05, x - 0.33, y, z, 8, false, 0, PI / 2); }
  function archWindow(K, c, w, y0, ys, z, rise, m4) { if (K.dry) return; var hw = w / 2, r = rise || hw; var gk = new Kit();
    var gs = shapeFrom(archHole(c - hw, c + hw, y0, ys, 14, rise === 0 ? undefined : rise)); var gg = new THREE.ShapeGeometry(gs); gk.place("glass", gg, 0xffffff, 0, 0, z);
    gk.box("wood", COL.woodD, w, 0.08, 0.1, c, y0 + 0.04, z); [-1, 1].forEach(function (sd) { gk.box("wood", COL.woodD, 0.08, ys - y0, 0.1, c + sd * (hw - 0.04), (y0 + ys) / 2, z); });
    var rows = Math.max(1, Math.round((ys - y0) / 0.55)); for (var i = 1; i < rows; i++) gk.box("wood", COL.woodD, w, 0.04, 0.06, c, y0 + i * (ys - y0) / rows, z); gk.box("wood", COL.woodD, 0.04, (ys - y0), 0.06, c, (y0 + ys) / 2, z); gk.box("wood", COL.woodD, w, 0.05, 0.07, c, ys, z);
    var geos = gk.merge(); for (var b in geos) { if (m4) geos[b].applyMatrix4(m4); K.add(b, geos[b]); } }
  function barWin(K, x, z, ry) { var c = Math.cos(ry), s = Math.sin(ry); K.place("glass", new THREE.PlaneGeometry(1.0, 1.1), 0xffffff, x, 4.25, z, ry); for (var i = -2; i <= 2; i++) { K.box("iron", COL.iron, 0.03, 1.1, 0.03, x + i * 0.19 * c, 4.25, z - i * 0.19 * s, ry); } K.box("cantera", COL.cant, 1.3, 0.1, 0.22, x, 3.65, z, ry, 1.4); }
  function fountain(K, SO, x, z) { var oct = new THREE.CylinderGeometry(1.92, 1.96, 0.55, 8, 1, true, PI / 8); var U = oct.attributes.uv; for (var i = 0; i < U.count; i++) U.setXY(i, U.getX(i) * 6, U.getY(i) * 0.55); K.place("talavera", oct, 0xffffff, x, 0.32, z);
    var rim = new THREE.RingGeometry(1.6, 2.06, 8, 1, PI / 8); rim.rotateX(-PI / 2); uvWorld(rim, 1.4, "y"); K.place("cantera", rim, COL.cant, x, 0.66, z);
    K.cyl("cantera", COL.cant, 2.06, 2.06, 0.1, x, 0.61, z, 8, true, PI / 8); K.cyl("cantera", COL.cant, 1.6, 1.6, 0.24, x, 0.54, z, 8, true, PI / 8);
    var w = new THREE.CircleGeometry(1.6, 8, PI / 8); w.rotateX(-PI / 2); K.place("water", w, 0xffffff, x, 0.5, z);
    K.lathe("cantera", COL.cant, [[0.0, 0], [0.34, 0], [0.3, 0.12], [0.16, 0.24], [0.13, 0.62], [0.2, 0.7], [0.56, 0.86], [0.6, 0.94], [0.5, 0.96], [0.12, 0.84], [0, 0.84]], x, 0.5, z, 20);
    var w2 = new THREE.CircleGeometry(0.48, 16); w2.rotateX(-PI / 2); K.place("water", w2, 0xffffff, x, 1.39, z); K.lathe("cantera", COL.cant, [[0, 0], [0.07, 0], [0.05, 0.22], [0.09, 0.26], [0, 0.32]], x, 1.36, z, 10);
    so(SO, x, z, 3.9, 3.9, 0, 0.68, 0, { noStep: true }); so(SO, x, z, 3.9, 3.9, 0, 0.68, PI / 4, { noStep: true }); EX.fountainAt = [x, z]; }
  function wallFountain(K, SO, x, zw) { K.place("talavera", new THREE.PlaneGeometry(2.0, 2.4), 0xffffff, x, 1.75, zw + 0.03); K.box("cantera", COL.cant, 2.3, 0.14, 0.2, x, 3.0, zw + 0.1, 0, 1.4); [-1, 1].forEach(function (sd) { K.box("cantera", COL.cant, 0.16, 2.6, 0.12, x + sd * 1.08, 1.7, zw + 0.08, 0, 1.4); });
    K.box("cantera", COL.cant, 0.14, 0.12, 0.34, x, 2.05, zw + 0.2, 0, 1.4); var bas = new THREE.CylinderGeometry(0.95, 0.95, 0.55, 16, 1, false, -PI / 2, PI); K.place("cantera", bas, COL.cant, x, 0.28, zw + 0.0);
    var wt = new THREE.CircleGeometry(0.85, 16, PI, PI); wt.rotateX(-PI / 2); K.place("water", wt, 0xffffff, x, 0.5, zw + 0.02); K.place("water", new THREE.PlaneGeometry(0.06, 1.5), 0xffffff, x, 1.3, zw + 0.38);
    so(SO, x, zw + 0.45, 1.9, 0.95, 0, 0.56, 0, { noStep: true }); EX.wallFountainAt = [x, zw + 0.4]; }

  // ───────────────────────── the interior: the reading room and the 1928 Archive (built near, time sliced, disposed far) ─────────────────────────
  var IN = LB.in = LB.in || { L: null, sb: null, solidsDone: false };
  var R_BUILD = 130, R_DROP = 200;
  var CI = { oakF: [1.0, 0.96, 0.9], oakC: [0.5, 0.39, 0.3], oakT: [0.66, 0.52, 0.4], ceil: [0.4, 0.31, 0.24], beam: [1, 1, 1], iron: [0.08, 0.075, 0.07], brass: [0.86, 0.66, 0.36], steel: [0.62, 0.64, 0.66], pl: [0.97, 0.95, 0.9], cant: [0.98, 0.9, 0.82], leather: [1, 1, 1] };
  // books: one indexed buffer, four faces a book (spine, top, two covers), uv from the spine atlas (tex/lb_books)
  var BKS = null;
  function bookAtlas() { if (BKS) return BKS; BKS = C("bookAtlas", null); if (!BKS) { try { var x = new XMLHttpRequest(); x.open("GET", au("/plan/library_books.json"), false); x.send(null); if (x.status === 200) BKS = JSON.parse(x.responseText); } catch (e) {} } if (!BKS) BKS = { spines: [[0.1, 0.75, 0.13, 0.98, 0.15]], page: [0, 0, 1, 0.09] }; return BKS; }
  function BookBuf(cap) { this.cap = cap; this.P = new Float32Array(cap * 48); this.N = new Float32Array(cap * 48); this.U = new Float32Array(cap * 32); this.C = new Float32Array(cap * 48); this.I = new Uint32Array(cap * 24); this.nv = 0; this.ni = 0; this.n = 0; }
  BookBuf.prototype.grow = function () { var o = this, c2 = o.cap * 2; ["P", "N", "C"].forEach(function (k) { var a = new Float32Array(c2 * 48); a.set(o[k]); o[k] = a; }); var u = new Float32Array(c2 * 32); u.set(o.U); o.U = u; var ii = new Uint32Array(c2 * 24); ii.set(o.I); o.I = ii; o.cap = c2; };
  // a face from 4 local corners; T: [ox, oy, oz, cy, sy, cz, sz] (yaw about y, then lean about z, about the book's bottom centre)
  BookBuf.prototype.face = function (T, c4, nrm, uv4, col, ao) { var o = this, v0 = o.nv;
    for (var k = 0; k < 4; k++) { var x = c4[k * 3], y = c4[k * 3 + 1], z = c4[k * 3 + 2]; var x1 = x * T[5] - y * T[6], y1 = x * T[6] + y * T[5]; var xr = x1 * T[3] + z * T[4], zr = -x1 * T[4] + z * T[3]; var i3 = (v0 + k) * 3; o.P[i3] = T[0] + xr; o.P[i3 + 1] = T[1] + y1; o.P[i3 + 2] = T[2] + zr;
      var nx = nrm[0] * T[5] - nrm[1] * T[6], ny = nrm[0] * T[6] + nrm[1] * T[5]; o.N[i3] = nx * T[3] + nrm[2] * T[4]; o.N[i3 + 1] = ny; o.N[i3 + 2] = -nx * T[4] + nrm[2] * T[3];
      var a = ao ? (y < 0.02 ? 0.7 : 1) : 1; o.C[i3] = col[0] * a; o.C[i3 + 1] = col[1] * a; o.C[i3 + 2] = col[2] * a; o.U[(v0 + k) * 2] = uv4[k * 2]; o.U[(v0 + k) * 2 + 1] = uv4[k * 2 + 1]; }
    var I = o.I, j = o.ni; I[j] = v0; I[j + 1] = v0 + 1; I[j + 2] = v0 + 2; I[j + 3] = v0; I[j + 4] = v0 + 2; I[j + 5] = v0 + 3; o.ni += 6; o.nv += 4; };
  BookBuf.prototype.book = function (ox, oy, oz, ry, rz, w, h, d, sp, col) { if ((this.n + 1) * 16 > this.cap * 16 - 16) this.grow(); var T = [ox, oy, oz, Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)], hw = w / 2, hd = d / 2, A = bookAtlas(), pg = A.page;
    var u0 = sp[0], v0 = sp[1], u1 = sp[2], v1 = sp[3], uc = (u0 + u1) / 2, vc = v0 + (v1 - v0) * 0.55, e = 0.0015;
    this.face(T, [-hw, 0, hd, hw, 0, hd, hw, h, hd, -hw, h, hd], [0, 0, 1], [u0, v0, u1, v0, u1, v1, u0, v1], col, true);
    var pu = pg[0] + (ox * 7.3 % 1 + 1) % 1 * 0.8 * (pg[2] - pg[0]); this.face(T, [-hw, h, hd, hw, h, hd, hw, h, -hd, -hw, h, -hd], [0, 1, 0], [pu, pg[1], pu + 0.012, pg[1], pu + 0.012, pg[3], pu, pg[3]], [0.95, 0.92, 0.86], false);
    this.face(T, [-hw, 0, -hd, -hw, 0, hd, -hw, h, hd, -hw, h, -hd], [-1, 0, 0], [uc - e, vc - e, uc + e, vc - e, uc + e, vc + e, uc - e, vc + e], [col[0] * 0.9, col[1] * 0.9, col[2] * 0.9], true);
    this.face(T, [hw, 0, hd, hw, 0, -hd, hw, h, -hd, hw, h, hd], [1, 0, 0], [uc - e, vc - e, uc + e, vc - e, uc + e, vc + e, uc - e, vc + e], [col[0] * 0.9, col[1] * 0.9, col[2] * 0.9], true); this.n++; };
  // a flat strip of spines (upper shelves seen from afar): one quad on a row of the atlas
  BookBuf.prototype.strip = function (ox, oy, oz, ry, w, h, row, R) { if ((this.n + 1) * 16 > this.cap * 16 - 16) this.grow(); var T = [ox, oy, oz, Math.cos(ry), Math.sin(ry), 1, 0], rows = [[0.738, 0.989], [0.506, 0.72], [0.302, 0.491], [0.107, 0.287]], rv = rows[row % 4], span = Math.min(0.95, w * 0.5), u0 = R() * (1 - span);
    this.face(T, [-w / 2, 0, 0, w / 2, 0, 0, w / 2, h, 0, -w / 2, h, 0], [0, 0, 1], [u0, rv[0], u0 + span, rv[0], u0 + span, rv[1], u0, rv[1]], [0.92, 0.9, 0.88], true); this.n++; };
  BookBuf.prototype.geometry = function () { var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(this.P.slice(0, this.nv * 3), 3)); g.setAttribute("normal", new THREE.BufferAttribute(this.N.slice(0, this.nv * 3), 3)); g.setAttribute("uv", new THREE.BufferAttribute(this.U.slice(0, this.nv * 2), 2)); g.setAttribute("color", new THREE.BufferAttribute(this.C.slice(0, this.nv * 3), 3)); g.setIndex(new THREE.BufferAttribute(this.I.slice(0, this.ni), 1)); g.computeBoundingBox(); g.computeBoundingSphere(); return g; };
  // fill one shelf run along the case's u axis: from u0 to u1 at height y, front plane at depth f (the case frame: origin, yaw)
  function fillShelf(B, Rr, fr, u0, u1, y, pitch, depth) { var A = bookAtlas(), sp = A.spines, u = u0 + 0.01 + Rr() * 0.02, lean = 0;
    while (u < u1 - 0.02) { var r = Rr();
      if (r < 0.05) { u += 0.03 + Rr() * 0.07; continue; }   // a gap
      if (r < 0.09 && u1 - u > 0.32) { var n = 2 + Math.floor(Rr() * 3), yy = y, wl = 0.2 + Rr() * 0.06; for (var k = 0; k < n; k++) { var s0 = sp[Math.floor(Rr() * sp.length)], th = 0.03 + Rr() * 0.025; var p0 = fr(u + wl, 0.11); B.book(p0[0], fr.y + yy + th / 2, p0[1], fr.ry, PI / 2, th, wl, 0.16 + Rr() * 0.05, s0, tint(Rr)); yy += th; } u += wl + 0.02; continue; }   // a lying stack
      var s = sp[Math.floor(Rr() * sp.length)], h = Math.min(pitch - 0.05, 0.2 + Rr() * 0.11), t = clamp(h * s[4] * (0.85 + Rr() * 0.3), 0.018, 0.075), d = Math.min(depth - 0.04, 0.15 + Rr() * 0.07);
      if (u + t > u1 - 0.01) break;
      lean = (Rr() < 0.04 && u1 - u > 0.2) ? (0.12 + Rr() * 0.18) : 0;
      var p = fr(u + t / 2 + (lean ? h * Math.sin(lean) * 0.5 : 0), d / 2 + 0.012 + Rr() * 0.02);
      B.book(p[0], fr.y + y, p[1], fr.ry, lean ? -lean : 0, t, h, d, s, tint(Rr)); u += t + (lean ? h * Math.sin(lean) : 0.002); } }
  function tint(Rr) { var k = 0.86 + Rr() * 0.2; return [k, k * (0.97 + Rr() * 0.05), k * (0.95 + Rr() * 0.07)]; }
  // a bookcase: runs along a line from (x0, z0) to (x1, z1) with its front facing `face` (local yaw of the outward normal), depth, height, shelf pitch;
  // books on the shelves below `solidTop` metres, flat spine strips above; solids
  function bookcase(K, B, SO, o) { var dx = o.x1 - o.x0, dz = o.z1 - o.z0, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux;   // the line is the wall (the case's back); n points into the room
    var D = o.depth || 0.42, H = o.h, y0 = o.y0, pitch = o.pitch || 0.4, Rr = rng(o.seed || 1), col = o.col || CI.oakC, yaw = Math.atan2(nx, nz);
    var P = function (u, v) { return [o.x0 + ux * u + nx * (D - v), o.z0 + uz * u + nz * (D - v)]; };   // v: depth from the case's front
    var fr = function (u, v) { return P(u, v); }; fr.y = 0; fr.ry = yaw;
    var boxAt = function (b, cl, w, h, d, u, y, v) { var p = P(u, v); K.box(b, cl, w, h, d, p[0], y, p[1], yaw, 0.9); };
    if (K.box) { boxAt("oakIn", col, L, H, 0.03, L / 2, y0 + H / 2, D - 0.015);
      var nb = Math.max(1, Math.round(L / (o.bay || 0.9))), bw = L / nb;
      for (var i = 0; i <= nb; i++) boxAt("oakIn", col, 0.035, H, D, i * bw, y0 + H / 2, D / 2);
      var ns = Math.floor((H - 0.16) / pitch); for (var s = 0; s <= ns; s++) boxAt("oakIn", col, L, 0.028, D, L / 2, y0 + 0.1 + s * pitch, D / 2);
      boxAt("oakIn", [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8], L + 0.06, 0.1, D + 0.02, L / 2, y0 + 0.05, D / 2 - 0.01); boxAt("oakIn", col, L + 0.08, 0.08, D + 0.06, L / 2, y0 + H - 0.04, D / 2 - 0.02); boxAt("oakIn", col, L + 0.1, 0.05, D + 0.1, L / 2, y0 + H + 0.02, D / 2 - 0.03);
      if (B) for (var b2 = 0; b2 < nb; b2++) for (var s2 = 0; s2 < ns; s2++) { var sy = y0 + 0.114 + s2 * pitch; if (o.skip && o.skip(b2, s2)) continue;
        if (sy - y0 < (o.solidTop || 2.3)) fillShelf(B, Rr, fr, b2 * bw + 0.02, (b2 + 1) * bw - 0.02, sy, pitch, D);
        else { var pm = P((b2 + 0.5) * bw, 0.06); B.strip(pm[0], sy, pm[1], yaw, bw - 0.05, pitch - 0.04, (b2 + s2) % 4, Rr); } } }
    var cc = P(L / 2, D / 2); so(SO, cc[0], cc[1], L, D, y0 - 0.1, y0 + H, yaw - SITE_YAW0(), { noStep: true }); return { yaw: yaw }; }
  function SITE_YAW0() { return 0; }
  // a timber beam with its own uv: u along its length, v kept to the plain half of tex/lb_beam (or the painted band)
  function beamBox(K, w, h, L, x, y, z, ry, rx, painted, col) { var g = new THREE.BoxGeometry(w, h, L).toNonIndexed(), p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, t = 1.4;
    for (var i = 0; i < p.count; i++) { var px = p.getX(i), py = p.getY(i), pz = p.getZ(i), ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      if (az > 0.5) uv.setXY(i, 0.3 + (px / w) * 0.05, 0.75 + (py / h) * 0.05); else if (ax > 0.5) uv.setXY(i, (pz + L / 2) / t, (painted ? 0.01 : 0.51) + (py / h + 0.5) * 0.47); else uv.setXY(i, (pz + L / 2) / t, 0.51 + (px / w + 0.5) * 0.47); }
    return K.place("woodIn", g, col || CI.beam, x, y, z, ry || 0, rx || 0); }
  function chair(K, SO, x, z, face, seatTag) { var c = Math.cos(face), s = Math.sin(face), P = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; }, F = SITE.F, col = CI.oakT;
    [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].forEach(function (q) { var p = P(q[0], q[1]); K.box("oakIn", col, 0.045, 0.44, 0.045, p[0], F + 0.22, p[1], face, 0.9); });
    var ps = P(0, 0); K.box("oakIn", col, 0.44, 0.045, 0.44, ps[0], F + 0.455, ps[1], face, 0.9); K.box("leather", CI.leather, 0.38, 0.035, 0.38, ps[0], F + 0.495, ps[1], face, 0.5);
    [-0.19, 0.19].forEach(function (lx) { var p = P(lx, -0.2); K.box("oakIn", col, 0.045, 0.52, 0.045, p[0], F + 0.72, p[1], face, 0.9); });
    var pt = P(0, -0.2); K.box("oakIn", col, 0.42, 0.08, 0.04, pt[0], F + 0.95, pt[1], face, 0.9); for (var k = -1; k <= 1; k++) { var pk = P(k * 0.1, -0.2); K.box("oakIn", col, 0.03, 0.36, 0.02, pk[0], F + 0.72, pk[1], face, 0.9); }
    so(SO, ps[0], ps[1], 0.44, 0.44, F, F + 0.5, face, { seat: true, face: face, lb: seatTag || "chair" }); }
  function bankerLamp(K, GL, x, y, z, ry) { K.cyl("brass", CI.brass, 0.08, 0.09, 0.03, x, y + 0.015, z, 16); K.cyl("brass", CI.brass, 0.012, 0.012, 0.32, x, y + 0.18, z, 6); K.box("brass", CI.brass, 0.04, 0.04, 0.12, x, y + 0.35, z, ry);
    var sh = new THREE.CylinderGeometry(0.075, 0.075, 0.36, 14, 1, true, 0, PI); sh.rotateZ(PI / 2); K.place("shade", sh, 0xffffff, x, y + 0.4, z, ry); K.place("lampIn", new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), 0xffffff, x, y + 0.37, z, ry, 0, PI / 2);
    if (GL) { var g = new THREE.PlaneGeometry(1.3, 1.0); g.rotateX(-PI / 2); GL.place("pool", g, [0.42, 0.33, 0.18], x, y + 0.005, z, ry); } }
  function chandelier(K, GL, x, yR, z, yTop) { K.place("ironIn", new THREE.TorusGeometry(0.85, 0.035, 6, 32), CI.iron, x, yR, z, 0, PI / 2); K.place("ironIn", new THREE.TorusGeometry(0.42, 0.025, 6, 24), CI.iron, x, yR + 0.45, z, 0, PI / 2);
    for (var i = 0; i < 8; i++) { var a = i / 8 * TAU, cx = x + Math.cos(a) * 0.85, cz = z + Math.sin(a) * 0.85; K.cyl("brass", CI.brass, 0.06, 0.04, 0.03, cx, yR + 0.04, cz, 10); K.cyl("lampIn", 0xffffff, 0.022, 0.022, 0.14, cx, yR + 0.13, cz, 6); K.sph("lampIn", 0xffffff, 0.035, cx, yR + 0.23, cz, 8, 1, 1.4, 1);
      K.tube("ironIn", CI.iron, V3(cx, yR, cz), V3(x, yR + 1.0, z), 0.012, 4); }
    K.cyl("ironIn", CI.iron, 0.05, 0.08, 0.3, x, yR - 0.1, z, 10); K.sph("ironIn", CI.iron, 0.07, x, yR - 0.32, z, 8); for (var c = yR + 1.0; c < yTop - 0.1; c += 0.14) K.place("ironIn", new THREE.TorusGeometry(0.035, 0.01, 4, 8), CI.iron, x, c, z, (c * 7) % 2 ? 0 : PI / 2, 0);
    if (GL) { var g = new THREE.PlaneGeometry(6.0, 6.0); g.rotateX(-PI / 2); GL.place("pool", g, [0.26, 0.2, 0.12], x, SITE.F + 0.006, z); } }
  function ladder(K, x0, y0, z0, x1, y1, z1) { var A = V3(x0, y0, z0), B2 = V3(x1, y1, z1), d = B2.clone().sub(A), L = d.length(), side = V3(-d.z, 0, d.x).normalize().multiplyScalar(0.24);
    [1, -1].forEach(function (sd) { K.tube("oakIn", CI.oakT, A.clone().addScaledVector(side, sd), B2.clone().addScaledVector(side, sd), 0.028, 6); K.cyl("ironIn", CI.iron, 0.04, 0.04, 0.03, A.x + side.x * sd, A.y + 0.04, A.z + side.z * sd, 10, false, 0, 0, PI / 2); K.place("brass", new THREE.TorusGeometry(0.05, 0.012, 6, 12, PI), CI.brass, B2.x + side.x * sd, B2.y + 0.02, B2.z + side.z * sd, Math.atan2(d.x, d.z) + PI / 2); });
    for (var t = 0.08; t < 1; t += 0.3 / L) { var p = A.clone().lerp(B2, t); K.tube("brass", CI.brass, p.clone().sub(side), p.clone().add(side), 0.014, 6); } }

  function* buildInteriorSteps(K, B, GL, SO, dry) {
    var S = SITE, F = S.F, R = rng(355), i, k, x, z;
    var dryK = dry ? { box: null } : K;
    // ── the reading room floor, rugs ──
    if (!dry) { var fl = new THREE.BufferGeometry(); var x0 = S.rr[0], x1 = S.rr[1], z0 = S.rr[2], z1 = S.rr[3], t = 2.0;
      fl.setAttribute("position", new THREE.Float32BufferAttribute([x0, F, z1, x1, F, z1, x1, F, z0, x0, F, z1, x1, F, z0, x0, F, z0], 3)); fl.setAttribute("uv", new THREE.Float32BufferAttribute([z1 / t, x0 / t, z1 / t, x1 / t, z0 / t, x1 / t, z1 / t, x0 / t, z0 / t, x1 / t, z0 / t, x0 / t], 2)); fl.computeVertexNormals(); K.add("oakIn", fl, CI.oakF);
      var rug = function (cx, cz, w, d, ry, uvr) { K.plane("rugs", 0xffffff, w, d, cx, F + 0.006, cz, ry, -PI / 2, uvr); }; rug(0, 6.3, 2.0, 4.0, 0, [0.0, 0.0, 1.0, 0.5]); rug(0, -6.5, 3.2, 2.2, 0, [0.0, 0.0, 1.0, 0.5]); }
    so(SO, 0, 0, 36.8, 16.8, -0.4, F, 0);
    // ── the trusses, purlins, the plank ceiling ──
    if (!dry) { var cy = function (zz) { return 12.45 - Math.abs(zz) / 8.4 * 3.62; };
      quad(K, "oakIn", CI.ceil, [-18.4, cy(8.4), 8.4], [-18.4, cy(0), 0], [18.4, cy(0), 0], [18.4, cy(8.4), 8.4], [0, -9.2], [4.6, -9.2], [4.6, 9.2], [0, 9.2]);
      quad(K, "oakIn", CI.ceil, [18.4, cy(8.4), -8.4], [18.4, cy(0), 0], [-18.4, cy(0), 0], [-18.4, cy(8.4), -8.4], [0, 9.2], [4.6, 9.2], [4.6, -9.2], [0, -9.2]);
      var ang = Math.atan2(3.62, 8.4), rl = Math.hypot(8.4, 3.62);
      [-15, -10, -5, 0, 5, 10, 15].forEach(function (tx) { beamBox(K, 0.3, 0.42, 16.8, tx, 8.45, 0, 0, 0, true); [1, -1].forEach(function (sd) { beamBox(K, 0.26, 0.3, rl, tx, (8.7 + 12.25) / 2, sd * 4.2, 0, sd * ang, false); beamBox(K, 0.18, 0.2, 4.35, tx, 9.58, sd * 2.1, 0, -sd * 0.33, false); beamBox(K, 0.34, 0.3, 1.3, tx, 8.05, sd * 7.7, 0, 0, false); }); beamBox(K, 0.26, 3.5, 0.26, tx, 10.45, 0, 0, 0, false); });
      [2.8, 5.6].forEach(function (pz) { [1, -1].forEach(function (sd) { beamBox(K, 0.18, 0.22, 36.8, 0, cy(pz) - 0.13, sd * pz, PI / 2, 0, false); }); }); beamBox(K, 0.24, 0.3, 36.8, 0, 12.3, 0, PI / 2, 0, false); }
    yield 1;
    // ── the gallery: deck on posts with corbels, joists, the painted fascia, the railing with turned balusters ──
    var dY = S.deckY, dZ = S.deckZ;
    if (!dry) { K.box("oakIn", CI.oakF, 36.8, 0.05, 3.1, 0, dY - 0.025, (dZ - 8.4) / 2, 0, 2.0); K.box("oakIn", CI.oakC, 36.8, 0.2, 3.1, 0, dY - 0.15, (dZ - 8.4) / 2, 0, 2.0);
      for (x = -18.0; x <= 18.01; x += 0.9) K.box("oakIn", CI.oakC, 0.1, 0.16, 3.0, x, dY - 0.33, (dZ - 8.4) / 2, 0, 0.9);
      beamBox(K, 0.14, 0.42, 36.8, 0, dY - 0.17, dZ - 0.05, PI / 2, 0, true);
      [-15, -10, -5, 5, 10, 15].forEach(function (px) { K.box("oakIn", CI.oakC, 0.28, dY - 0.4 - F, 0.28, px, (F + dY - 0.4) / 2, dZ - 0.15, 0, 0.9); K.box("oakIn", CI.oakC, 1.4, 0.2, 0.3, px, dY - 0.5, dZ - 0.15, 0, 0.9); K.box("oakIn", CI.oakC, 0.4, 0.12, 0.4, px, F + 0.06, dZ - 0.15, 0, 0.9); });
      for (x = -16.8; x <= 18.3; x += 0.16) K.lathe("oakIn", CI.oakT, [[0.0, 0], [0.025, 0], [0.025, 0.06], [0.015, 0.12], [0.03, 0.3], [0.016, 0.55], [0.022, 0.78], [0.016, 0.84], [0, 0.84]], x, dY + 0.06, dZ - 0.06, 6);
      K.box("oakIn", CI.oakT, 35.2, 0.09, 0.11, 0.75, dY + 0.94, dZ - 0.06, 0, 0.9); K.box("oakIn", CI.oakT, 35.2, 0.06, 0.07, 0.75, dY + 0.05, dZ - 0.06, 0, 0.9);
      K.plane("signsIn", 0xffffff, 1.4, 0.57, 0, dY + 0.55, dZ + 0.01, 0, 0, sUV("s2")); }
    so(SO, 0, (dZ - 8.4) / 2, 36.8, 3.1, dY - 0.28, dY, 0); so(SO, 0.75, dZ - 0.06, 35.2, 0.14, dY, dY + 1.0, 0, { noStep: true });
    [-15, -10, -5, 5, 10, 15].forEach(function (px) { so(SO, px, dZ - 0.15, 0.3, 0.3, F, dY - 0.4, 0, { noStep: true }); });
    // ── the stair against the south-west wall: oak treads, talavera risers, the closed stringer wall, a handrail ──
    var sx0 = -18.4, sx1 = -17.0, sxc = (sx0 + sx1) / 2;
    for (k = 1; k <= 20; k++) { var tz0 = dZ + (20 - k) * 0.3, tz1 = tz0 + 0.3, ty = F + 0.18 * k;
      if (!dry) { K.box("oakIn", CI.oakT, 1.4, 0.045, 0.33, sxc, ty - 0.022, (tz0 + tz1) / 2 + 0.015, 0, 0.9); var rg = new THREE.PlaneGeometry(1.4, 0.18); var RU2 = rg.attributes.uv; for (var q = 0; q < RU2.count; q++) RU2.setXY(q, RU2.getX(q) * 2.8, 0.1 + RU2.getY(q) * 0.36); K.place("talIn", rg, 0xffffff, sxc, ty - 0.09 - 0.045, tz1 + 0.001); }
      so(SO, sxc, (tz0 + tz1) / 2, 1.4, 0.3, F - 0.2, ty, 0); }
    if (!dry) { var sw = new THREE.ExtrudeGeometry(shapeFrom([[0.7, F], [dZ, F], [dZ, dY + 0.02], [0.7, F + 0.2]]), { depth: 0.12, bevelEnabled: false }); sw = sw.toNonIndexed(); sw.rotateY(-PI / 2); sw.translate(sx1 + 0.06, 0, 0); sw.computeVertexNormals(); uvWorld(sw, 2.5, "auto"); K.add("plaster", sw, CI.pl);
      for (k = 1; k <= 20; k += 1) { var bz = dZ + (20 - k) * 0.3 + 0.15; K.box("ironIn", CI.iron, 0.025, 0.86, 0.025, sx1 + 0.02, F + 0.18 * k + 0.43, bz); }
      K.tube("oakIn", CI.oakT, V3(sx1 + 0.02, F + 0.18 + 0.9, 0.55), V3(sx1 + 0.02, dY + 0.9, dZ + 0.15), 0.035, 8);
      [[0.6, F], [dZ + 0.05, dY]].forEach(function (q) { K.lathe("oakIn", CI.oakT, [[0, 0], [0.07, 0], [0.07, 0.1], [0.05, 0.2], [0.05, 0.85], [0.07, 0.95], [0.04, 1.05], [0, 1.08]], sx1 + 0.02, q[1], q[0], 10); }); }
    so(SO, sx1 + 0.04, (dZ + 0.7) / 2, 0.12, 6.0, F, dY + 1.0, 0, { noStep: true });
    yield 1;
    // ── the stacks: the back wall below and above the gallery, the end walls, the low cases under the front windows, freestanding rows ──
    var bk = dry ? null : B, Kb = dry ? { box: null } : K;
    bookcase(Kb, bk, SO, { x0: -18.4, z0: -8.4, x1: -1.75, z1: -8.4, side: -1, h: dY - 0.42 - F, y0: F, seed: 11, solidTop: 2.0 });
    bookcase(Kb, bk, SO, { x0: 1.75, z0: -8.4, x1: 18.4, z1: -8.4, side: -1, h: dY - 0.42 - F, y0: F, seed: 12, solidTop: 2.0 });
    yield 1;
    bookcase(Kb, bk, SO, { x0: -18.4, z0: -8.4, x1: 18.4, z1: -8.4, side: -1, h: 3.05, y0: dY, seed: 13, solidTop: 1.75 });
    yield 1;
    bookcase(Kb, bk, SO, { x0: -18.4, z0: 8.4, x1: -18.4, z1: 1.4, side: -1, h: 5.9, y0: F, seed: 14, solidTop: 2.0 });
    bookcase(Kb, bk, SO, { x0: 18.4, z0: 1.3, x1: 18.4, z1: 8.4, side: -1, h: 5.9, y0: F, seed: 15, solidTop: 2.0 });
    bookcase(Kb, bk, SO, { x0: 18.4, z0: -5.25, x1: 18.4, z1: -2.35, side: -1, h: 5.9, y0: F, seed: 16, solidTop: 2.0 });
    yield 1;
    var bays = arcadeBays(); [[-17.9, -1.6], [1.6, 17.9]].forEach(function (rg, j) { bookcase(Kb, bk, SO, { x0: rg[1], z0: 8.4, x1: rg[0], z1: 8.4, side: -1, h: 0.86, y0: F, depth: 0.4, seed: 20 + j, pitch: 0.4 }); });
    [[-16.4, -13.4, 3.2, 3], [-16.4, -13.4, 6.0, 4], [13.4, 16.4, 3.2, 5], [13.4, 16.4, 6.0, 6]].forEach(function (q, j) {
      bookcase(Kb, bk, SO, { x0: q[0], z0: q[2], x1: q[1], z1: q[2], side: 1, h: 2.3, y0: F, depth: 0.3, seed: 30 + j, solidTop: 3, bay: 1.0 });
      bookcase(Kb, bk, SO, { x0: q[1], z0: q[2], x1: q[0], z1: q[2], side: 1, h: 2.3, y0: F, depth: 0.3, seed: 40 + j, solidTop: 3, bay: 1.0 });
      if (!dry) { var ex = q[0] < 0 ? q[1] + 0.02 : q[0] - 0.02; K.box("oakIn", CI.oakC, 0.05, 2.36, 0.64, ex, F + 1.18, q[2], 0, 0.9); K.plane("signsIn", 0xffffff, 0.5, 0.2, ex + (q[0] < 0 ? 0.03 : -0.03), F + 1.95, q[2], q[0] < 0 ? PI / 2 : -PI / 2, 0, sUV("s" + q[3])); } });
    // rolling ladders: the end walls and two on the gallery
    if (!dry) { LB.ladders = []; [[-17.98, 5.0, -1, 5.9], [17.98, 4.6, 1, 5.9]].forEach(function (q) { K.tube("brass", CI.brass, V3(q[0] - q[2] * 0.06, F + q[3] - 0.2, 1.5), V3(q[0] - q[2] * 0.06, F + q[3] - 0.2, 8.3), 0.018, 8); });
      K.tube("brass", CI.brass, V3(-18.3, dY + 2.85, -7.92), V3(18.3, dY + 2.85, -7.92), 0.018, 8); }
    yield 1;
    // ── the circulation desk, the card catalog, the returns cart ──
    if (!dry) { var dk = function (cx, cz, w, ry) { K.box("oakIn", CI.oakC, w, 1.0, 0.55, cx, F + 0.5, cz, ry, 0.9); K.box("oakIn", CI.oakT, w + 0.08, 0.05, 0.68, cx, F + 1.025, cz - Math.cos(ry) * 0.05, ry, 0.9); for (var p = 0; p < Math.round(w / 0.6); p++) { var lx = -w / 2 + 0.3 + p * w / Math.round(w / 0.6); K.box("oakIn", [0.42, 0.32, 0.25], 0.42, 0.6, 0.03, cx + Math.cos(ry) * lx + Math.sin(ry) * 0.28, F + 0.52, cz - Math.sin(ry) * lx + Math.cos(ry) * 0.28, ry, 0.9); } };
      dk(0, 2.75, 4.6, 0); dk(-2.75, 2.0, 1.6, -0.6); dk(2.75, 2.0, 1.6, 0.6); K.plane("signsIn", 0xffffff, 1.3, 0.53, 0, F + 0.62, 3.06, 0, 0, sUV("s1"));
      bankerLamp(K, null, -1.4, F + 1.05, 2.6, 0); K.sph("brass", CI.brass, 0.06, 0.9, F + 1.1, 2.75, 10, 1, 0.6, 1); K.box("cloth", [0.35, 0.12, 0.1], 0.36, 0.06, 0.26, 0.2, F + 1.08, 2.7, 0.2);
      for (k = 0; k < 6; k++) K.box("cloth", [[0.4, 0.15, 0.12], [0.15, 0.25, 0.4], [0.2, 0.35, 0.18], [0.5, 0.35, 0.15]][k % 4], 0.24 - k * 0.01, 0.04, 0.17, 1.6, F + 1.07 + k * 0.04, 2.7, k * 0.2);
      // card catalog: sixty drawers with brass pulls and label frames
      K.box("oakIn", CI.oakC, 3.6, 1.2, 0.6, 0, F + 0.75, -0.3, 0, 0.9); K.box("oakIn", CI.oakT, 3.7, 0.05, 0.66, 0, F + 1.375, -0.3, 0, 0.9);
      for (var r2 = 0; r2 < 6; r2++) for (var c2 = 0; c2 < 10; c2++) { var dx2 = -1.62 + c2 * 0.36, dy2 = F + 0.27 + r2 * 0.19; K.box("oakIn", [0.56, 0.44, 0.34], 0.32, 0.16, 0.02, dx2, dy2, -0.0 + 0.01); K.box("brass", CI.brass, 0.06, 0.02, 0.02, dx2, dy2 - 0.03, 0.03); K.box("cloth", [0.85, 0.82, 0.74], 0.07, 0.035, 0.005, dx2, dy2 + 0.03, 0.022); }
      [[-1.7, 0.1], [1.7, 0.1], [-1.7, -0.7], [1.7, -0.7]].forEach(function (q) { K.box("oakIn", CI.oakC, 0.06, 0.15, 0.06, q[0], F + 0.075, q[1], 0, 0.9); });
      // returns cart
      K.box("oakIn", CI.oakT, 1.0, 0.04, 0.45, 3.9, F + 0.5, 3.4, 0.3); K.box("oakIn", CI.oakT, 1.0, 0.04, 0.45, 3.9, F + 0.9, 3.4, 0.3); [[-0.48, -0.2], [0.48, -0.2], [-0.48, 0.2], [0.48, 0.2]].forEach(function (q) { var c3 = Math.cos(0.3), s3 = Math.sin(0.3); K.box("oakIn", CI.oakC, 0.03, 0.9, 0.03, 3.9 + q[0] * c3 + q[1] * s3, F + 0.48, 3.4 - q[0] * s3 + q[1] * c3, 0.3); K.cyl("ironIn", CI.iron, 0.04, 0.04, 0.03, 3.9 + q[0] * c3 + q[1] * s3, F + 0.04, 3.4 - q[0] * s3 + q[1] * c3, 8, false, 0.3, 0, PI / 2); });
      (function () { var fr = function (u, v) { var c3 = Math.cos(0.3), s3 = Math.sin(0.3), lx = u - 0.48; return [3.9 + lx * c3 + (v - 0.15) * s3, 3.4 - lx * s3 + (v - 0.15) * c3]; }; fr.y = 0; fr.ry = 0.3; var Rc = rng(77); fillShelf(B, Rc, fr, 0, 0.96, F + 0.52, 0.38, 0.4); fillShelf(B, Rc, fr, 0, 0.96, F + 0.92, 0.36, 0.4); })(); }
    so(SO, 0, 2.75, 4.7, 0.7, F, F + 1.06, 0, { noStep: true }); so(SO, -2.75, 2.0, 1.7, 0.7, F, F + 1.06, -0.6, { noStep: true }); so(SO, 2.75, 2.0, 1.7, 0.7, F, F + 1.06, 0.6, { noStep: true });
    so(SO, 0, -0.3, 3.7, 0.66, F, F + 1.4, 0, { noStep: true }); so(SO, 3.9, 3.4, 1.05, 0.5, F, F + 1.0, 0.3, { noStep: true });
    yield 1;
    // ── the fireplace on the back wall under the gallery, the painting over the mantel, two leather armchairs ──
    if (!dry) { var fz = -7.95; K.box("cantIn", CI.cant, 3.4, 2.1, 0.45, 0, F + 1.05, fz + 0.12, 0, 1.4); K.box("cantIn", CI.cant, 3.8, 0.14, 0.62, 0, F + 1.92, fz + 0.2, 0, 1.4); K.box("cantIn", [0.7, 0.62, 0.56], 1.5, 1.15, 0.5, 0, F + 0.62, fz + 0.12, 0, 1.4);
      K.box("plaster", CI.pl, 3.2, dY - 0.4 - F - 2.0, 0.3, 0, F + 2.0 + (dY - 0.4 - F - 2.0) / 2, fz + 0.05, 0, 2.5); K.box("cantIn", CI.cant, 3.2, 0.9, 1.2, 0, F + 0.04, fz + 0.9, 0, 1.4);
      K.box("cantIn", [0.12, 0.1, 0.09], 1.3, 0.95, 0.04, 0, F + 0.6, fz + 0.38, 0, 1.4);
      [[-0.3, 0.2], [0.25, -0.1], [0, 0.45]].forEach(function (q, i2) { K.cyl("oakIn", [0.32, 0.22, 0.15], 0.07, 0.07, 0.75, q[0], F + 0.2 + i2 * 0.06, fz + 0.62 + q[1] * 0.2, 8, false, q[1], 0, PI / 2); });
      var ptg = new THREE.PlaneGeometry(1.9, 1.07); K.place("painting", ptg, 0xffffff, 0, F + 2.75, fz + 0.22); K.box("oakIn", [0.3, 0.22, 0.17], 2.06, 1.23, 0.05, 0, F + 2.75, fz + 0.19, 0, 0.9);
      [[-1.05, -6.35, PI - 0.35], [1.05, -6.35, PI + 0.35]].forEach(function (q) { armchair(K, q[0], q[1], q[2]); }); K.cyl("oakIn", CI.oakC, 0.3, 0.3, 0.04, 0, F + 0.56, -6.0, 16); K.cyl("oakIn", CI.oakC, 0.04, 0.06, 0.54, 0, F + 0.27, -6.0, 8);
      var fl1 = new THREE.PlaneGeometry(1.1, 0.95), fl2 = fl1.clone(); K.place("flameK", fl1, 0xffffff, 0, F + 0.65, fz + 0.55); K.place("flameK", fl2, 0xffffff, 0, F + 0.65, fz + 0.62, 0.5);
      var eg = new THREE.PlaneGeometry(2.6, 2.2); eg.rotateX(-PI / 2); GL.place("pool", eg, [0.5, 0.3, 0.14], 0, F + 0.007, fz + 1.4); }
    so(SO, 0, -7.83, 3.8, 0.7, F - 0.1, F + 2.1, 0, { noStep: true }); so(SO, 0, -6.0, 0.6, 0.6, F, F + 0.6, 0, { noStep: true });
    [[-1.05, -6.35, PI - 0.35], [1.05, -6.35, PI + 0.35]].forEach(function (q) { so(SO, q[0], q[1], 0.7, 0.7, F, F + 0.48, q[2], { seat: true, face: q[2], lb: "arm" }); });
    yield 1;
    // ── the reading tables with banker's lamps and Mission chairs ──
    LB.tables = [];
    [-8.25, 8.25].forEach(function (tx) { [-2.6, 0.7, 4.0].forEach(function (tz) { LB.tables.push([tx, tz]);
      if (!dry) { K.box("oakIn", CI.oakT, 4.8, 0.06, 1.2, tx, F + 0.76, tz, 0, 0.9); K.box("oakIn", CI.oakC, 4.6, 0.12, 1.0, tx, F + 0.67, tz, 0, 0.9); [[-2.2, -0.45], [2.2, -0.45], [-2.2, 0.45], [2.2, 0.45], [0, -0.45], [0, 0.45]].forEach(function (q) { K.lathe("oakIn", CI.oakC, [[0, 0], [0.05, 0], [0.04, 0.1], [0.035, 0.5], [0.05, 0.62], [0.04, 0.7], [0, 0.7]], tx + q[0], F, tz + q[1], 8); });
        [-1.2, 1.2].forEach(function (lx) { bankerLamp(K, GL, tx + lx, F + 0.79, tz, 0); });
        if (R() < 0.75) { var spn = bookAtlas().spines; for (var tb = 0; tb < 1 + Math.floor(R() * 3); tb++) B.book(tx + (R() - 0.5) * 3.2, F + 0.79 + tb * 0.035, tz + (R() - 0.5) * 0.4, R() * TAU, PI / 2, 0.034, 0.24, 0.17, spn[Math.floor(R() * spn.length)], [1, 1, 1]); } }
      so(SO, tx, tz, 4.8, 1.2, F, F + 0.79, 0, { noStep: true });
      [-1.8, -0.6, 0.6, 1.8].forEach(function (lx) { if (!dry) { chair(K, SO, tx + lx, tz - 0.86, 0, "chair"); chair(K, SO, tx + lx, tz + 0.86, PI, "chair"); } else { so(SO, tx + lx, tz - 0.86, 0.44, 0.44, F, F + 0.5, 0, { seat: true, face: 0, lb: "chair" }); so(SO, tx + lx, tz + 0.86, 0.44, 0.44, F, F + 0.5, PI, { seat: true, face: PI, lb: "chair" }); } }); }); });
    yield 1;
    // ── chandeliers, sconces, signs; the vault door frame on the reading room side ──
    if (!dry) { [-12.5, -7.5, -2.5, 2.5, 7.5, 12.5].forEach(function (cx) { chandelier(K, GL, cx, 5.7, 1.4, 11.8); });
      bays.forEach(function (b, j) { if (j === 3 || j === 4) return; var px = j < 4 ? b[1] + 0.35 : b[0] - 0.35; if (px > 18 || px < -18) return; K.box("ironIn", CI.iron, 0.12, 0.3, 0.05, px, F + 2.6, 8.37); K.tube("ironIn", CI.iron, V3(px, F + 2.6, 8.35), V3(px, F + 2.75, 8.1), 0.012, 4); K.cyl("lampIn", 0xffffff, 0.05, 0.05, 0.12, px, F + 2.85, 8.1, 8); var wg = new THREE.PlaneGeometry(1.2, 1.6); GL.place("pool", wg, [0.2, 0.15, 0.09], px, F + 2.9, 8.36, PI); });
      K.plane("signsIn", 0xffffff, 1.8, 0.73, 0, F + 5.3, 8.35, PI, 0, sUV("s0"));
      var vr = new THREE.RingGeometry(1.2, 1.62, 40); K.place("steel", vr, CI.steel, 18.37, F + 1.4, -0.5, -PI / 2); K.place("steel", new THREE.TorusGeometry(1.5, 0.1, 10, 40), CI.steel, 18.35, F + 1.4, -0.5, PI / 2);
      for (k = 0; k < 20; k++) { var ra = k / 20 * TAU; K.sph("steel", CI.steel, 0.045, 18.33, F + 1.4 + Math.sin(ra) * 1.36, -0.5 + Math.cos(ra) * 1.36, 6); }
      K.plane("signsIn", 0xffffff, 2.0, 0.375, 18.36, F + 3.35, -0.5, -PI / 2, 0, sUV("vault")); }
    yield 1;
    // ── the 1928 Archive: floor, the segmental vault and its ribs, pilasters ──
    var A0 = S.ar[0], A1 = S.ar[1], AZ0 = S.ar[2], AZ1 = S.ar[3], acx = (A0 + A1) / 2, acz = (AZ0 + AZ1) / 2, half = (A1 - A0) / 2, rise = S.arVault[1] - S.arVault[0], Rv = (half * half + rise * rise) / (2 * rise), vcy = S.arVault[1] - Rv;
    var vy = function (xx) { return vcy + Math.sqrt(Math.max(0, Rv * Rv - (xx - acx) * (xx - acx))); };
    if (!dry) { K.box("travIn", [0.95, 0.92, 0.88], A1 - A0, 0.3, AZ1 - AZ0, acx, 0.15, acz, 0, 1.6); K.box("cantIn", [0.42, 0.36, 0.32], A1 - A0, 0.004, 0.4, acx, F + 0.002, AZ0 + 0.2); K.box("cantIn", [0.42, 0.36, 0.32], A1 - A0, 0.004, 0.4, acx, F + 0.002, AZ1 - 0.2);
      var NV = 28; for (i = 0; i < NV; i++) { var xa = A0 + (A1 - A0) * i / NV, xb = A0 + (A1 - A0) * (i + 1) / NV; quad(K, "plaster", CI.pl, [xb, vy(xb), AZ0], [xb, vy(xb), AZ1], [xa, vy(xa), AZ1], [xa, vy(xa), AZ0], [AZ0 / 2.5, xb / 2.5], [AZ1 / 2.5, xb / 2.5], [AZ1 / 2.5, xa / 2.5], [AZ0 / 2.5, xa / 2.5]); }
      [AZ0 + 1.3, acz - 2.6, acz + 2.6, AZ1 - 1.3].forEach(function (rz) { for (i = 0; i < NV; i++) { var xa2 = A0 + (A1 - A0) * i / NV, xb2 = A0 + (A1 - A0) * (i + 1) / NV, ya = vy(xa2) - 0.12, yb = vy(xb2) - 0.12, mx = (xa2 + xb2) / 2, my = (ya + yb) / 2, len = Math.hypot(xb2 - xa2, yb - ya); K.box("cantIn", CI.cant, len + 0.02, 0.24, 0.36, mx, my, rz, 0, 1.4, 0, Math.atan2(yb - ya, xb2 - xa2)); }
        [A0 + 0.12, A1 - 0.12].forEach(function (px) { K.box("cantIn", CI.cant, 0.24, S.arVault[0] - F, 0.4, px, (F + S.arVault[0]) / 2, rz, 0, 1.4); K.box("cantIn", CI.cant, 0.34, 0.16, 0.5, px, S.arVault[0] - 0.08, rz, 0, 1.4); }); }); }
    so(SO, acx, acz, A1 - A0, AZ1 - AZ0, -0.4, F, 0);
    yield 1;
    // ── the vault door, swung open into the archive ──
    if (!dry) { var hz = 1.0, dang = 1.75, dcx = 19.0 + Math.sin(dang) * 1.45 * 0 + 0.3, dcz = hz + 1.45; var dg = new THREE.Group();
      var door = new Kit(); door.cyl("steel", CI.steel, 1.42, 1.42, 0.48, 0, 0, 0, 40, false, 0, PI / 2); for (k = 0; k < 4; k++) door.place("steel", new THREE.TorusGeometry(0.4 + k * 0.25, 0.02, 4, 40), [0.5, 0.52, 0.55], 0, 0, -0.25, 0); for (k = 0; k < 12; k++) { var ba = k / 12 * TAU; door.cyl("steel", [0.75, 0.76, 0.78], 0.06, 0.06, 0.32, Math.cos(ba) * 1.42, Math.sin(ba) * 1.42, 0, 10, false, 0, PI / 2, 0); }
      door.place("brass", new THREE.TorusGeometry(0.42, 0.04, 8, 32), CI.brass, 0, 0, -0.32, 0); for (k = 0; k < 4; k++) door.box("brass", CI.brass, 0.84, 0.04, 0.04, 0, 0, -0.32, 0, 0, 0, k * PI / 4); door.cyl("brass", CI.brass, 0.1, 0.1, 0.1, 0, 0, -0.3, 16, false, 0, PI / 2);
      door.box("steel", CI.steel, 0.3, 0.5, 0.5, -1.5, 0.6, 0.0); door.box("steel", CI.steel, 0.3, 0.5, 0.5, -1.5, -0.6, 0.0);
      var dgeos = door.merge(), m4d = new THREE.Matrix4().makeRotationY(-PI / 2 + 0.17); m4d.setPosition(19.55, F + 1.42, 2.48); for (var bd in dgeos) { dgeos[bd].applyMatrix4(m4d); K.add(bd, dgeos[bd]); } }
    so(SO, 19.6, 2.48, 0.6, 2.95, F, F + 2.9, 0.17, { noStep: true });
    yield 1;
    // ── the exhibits: the opening-day panel and the model field, the propeller, the map table, the photo wall and timeline, the cases, the flat files, the stacks ──
    if (!dry) { // the mural and its caption, a picture light, the long case with the model field
      var mw = 5.6, mh = mw / 2.335, mz = AZ0 + 0.06; K.place("mural", new THREE.PlaneGeometry(mw, mh), 0xffffff, acx, F + 1.55 + mh / 2, mz); K.box("oakIn", [0.3, 0.22, 0.17], mw + 0.24, mh + 0.24, 0.06, acx, F + 1.55 + mh / 2, mz - 0.035, 0, 0.9);
      K.plane("signsIn", 0xffffff, 2.4, 0.45, acx, F + 1.18, mz + 0.01, 0, 0, sUV("mural")); K.box("brass", CI.brass, 1.6, 0.06, 0.1, acx, F + 1.75 + mh, mz + 0.18); K.box("lampIn", 0xffffff, 1.5, 0.02, 0.05, acx, F + 1.72 + mh, mz + 0.2); var mg = new THREE.PlaneGeometry(mw, mh * 0.9); GL.place("pool", mg, [0.16, 0.13, 0.08], acx, F + 1.55 + mh * 0.6, mz + 0.012);
      displayCase(K, acx, AZ0 + 1.25, 4.4, 0.95, 0.8, 0.45); modelField(K, acx, F + 0.82, AZ0 + 1.25);
      // the propeller on its shield board, the plaque, a case of flying gear
      var pxw = A1 - 0.06; K.box("oakIn", [0.3, 0.22, 0.17], 0.06, 0.95, 3.1, pxw - 0.03, F + 2.75, acz, 0, 0.9); propeller(K, pxw - 0.12, F + 2.75, acz); K.plane("signsIn", 0xffffff, 1.2, 0.45, pxw - 0.01, F + 1.85, acz, -PI / 2, 0, sUV("prop"));
      K.box("brass", CI.brass, 0.1, 0.06, 1.4, pxw - 0.18, F + 3.38, acz); K.box("lampIn", 0xffffff, 0.04, 0.02, 1.3, pxw - 0.2, F + 3.35, acz); var pg2 = new THREE.PlaneGeometry(3.2, 1.6); GL.place("pool", pg2, [0.15, 0.12, 0.08], pxw - 0.05, F + 2.7, acz, -PI / 2);
      displayCase(K, A1 - 0.85, acz, 0.7, 1.6, 0.8, 0.35, PI / 2); flyingGear(K, A1 - 0.85, F + 0.82, acz);
      // the map table
      K.box("oakIn", CI.oakC, 3.4, 0.12, 2.2, acx, F + 0.86, acz, 0, 0.9); K.place("map", new THREE.PlaneGeometry(3.1, 2.0), 0xffffff, acx, F + 0.925, acz, 0, -PI / 2); K.box("glassIn", 0xffffff, 3.12, 0.012, 2.02, acx, F + 0.94, acz);
      [[-1.6, -1.0], [1.6, -1.0], [-1.6, 1.0], [1.6, 1.0]].forEach(function (q) { K.lathe("oakIn", CI.oakC, [[0, 0], [0.08, 0], [0.07, 0.12], [0.05, 0.6], [0.08, 0.72], [0.06, 0.8], [0, 0.8]], acx + q[0], F, acz + q[1], 10); K.box("brass", CI.brass, 0.14, 0.03, 0.14, acx + q[0] * 0.99, F + 0.95, acz + q[1] * 0.99); });
      K.cyl("brass", CI.brass, 0.1, 0.12, 0.03, acx + 1.1, F + 0.96, acz + 0.6, 12); K.tube("brass", CI.brass, V3(acx + 1.1, F + 0.97, acz + 0.6), V3(acx + 0.8, F + 1.25, acz + 0.45), 0.012, 6); K.place("brass", new THREE.TorusGeometry(0.09, 0.012, 6, 20), CI.brass, acx + 0.78, F + 1.22, acz + 0.44, 0, PI / 2); K.place("glassIn", new THREE.CircleGeometry(0.085, 16), 0xffffff, acx + 0.78, F + 1.22, acz + 0.44, 0, -PI / 2);
      K.plane("rugs", 0xffffff, 4.4, 3.2, acx, F + 0.006, acz, 0, -PI / 2, [0.0, 0.5, 1.0, 1.0]);
      [-0.8, 0.8].forEach(function (pz) { K.lathe("brass", CI.brass, [[0.32, 0], [0.3, 0.06], [0.18, 0.2], [0.05, 0.3], [0, 0.32]], acx, F + 2.9, acz + pz, 18); K.place("lampIn", new THREE.CircleGeometry(0.28, 16), 0xffffff, acx, F + 2.905, acz + pz, 0, PI / 2); K.cyl("ironIn", CI.iron, 0.006, 0.006, vy(acx) - F - 3.2, acx, (F + 3.2 + vy(acx)) / 2, acz + pz, 4); });
      var tg = new THREE.PlaneGeometry(4.0, 3.0); tg.rotateX(-PI / 2); GL.place("pool", tg, [0.3, 0.24, 0.15], acx, F + 0.95, acz);
      // the photo wall, captions and the timeline
      var phz = AZ1 - 0.06, xs = [29.4, 26.6, 23.7, 20.9], q4 = [[0, 0.5, 0.5, 1], [0.5, 0.5, 1, 1], [0, 0, 0.5, 0.5], [0.5, 0, 1, 0.5]];
      xs.forEach(function (px, j) { var u = q4[j]; K.plane("photos", 0xffffff, 1.32, 0.99, px, F + 2.2, phz - 0.016, PI, 0, [u[0] + 0.012, u[1] + 0.016, u[2] - 0.012, u[3] - 0.016]); K.box("oakIn", [0.2, 0.15, 0.12], 1.5, 1.17, 0.05, px, F + 2.2, phz + 0.03, 0, 0.9); K.box("cloth", [0.92, 0.88, 0.8], 1.42, 1.09, 0.01, px, F + 2.2, phz + 0.002); K.plane("signsIn", 0xffffff, 1.0, 0.19, px, F + 1.48, phz - 0.005, PI, 0, sUV("ph" + j)); });
      ["tl0", "tl1", "tl2", "tl3", "tl4", "tl5"].forEach(function (key, j) { var px = 29.8 - j * 1.88; K.plane("signsIn", 0xffffff, 0.66, 0.54, px, F + 3.45, phz - 0.005, PI, 0, sUV(key)); K.box("brass", CI.brass, 0.7, 0.58, 0.02, px, F + 3.45, phz + 0.008); });
      K.box("brass", CI.brass, 10.2, 0.03, 0.03, 25.1, F + 3.12, phz - 0.02); var phg = new THREE.PlaneGeometry(10, 2.2); GL.place("pool", phg, [0.1, 0.08, 0.05], 25.1, F + 2.6, phz - 0.012, PI);
      // the smelter case and the model trainer
      displayCase(K, 21.9, 4.7, 1.5, 0.85, 0.85, 0.45); ores(K, 21.9, F + 0.88, 4.7); K.plane("signsIn", 0xffffff, 0.9, 0.34, 21.9, F + 0.52, 5.135, 0, 0, sUV("smelt"));
      K.box("cantIn", CI.cant, 0.75, 1.0, 0.75, 28.6, F + 0.5, 4.7, 0, 1.4); K.box("glassIn", 0xffffff, 0.98, 0.7, 0.74, 28.6, F + 1.36, 4.7); K.box("brass", CI.brass, 1.0, 0.03, 0.76, 28.6, F + 1.72, 4.7); K.plane("signsIn", 0xffffff, 0.66, 0.25, 28.6, F + 0.75, 5.08, 0, 0, sUV("model"));
      LB.modelAt = [28.6, F + 1.08, 4.7];
      // flat files and the archive shelving along the south-west wall
      K.box("oakIn", CI.oakC, 0.95, 1.0, 3.0, A0 + 0.5, F + 0.5, 5.75, 0, 0.9); for (k = 0; k < 8; k++) { K.box("oakIn", [0.5, 0.38, 0.3], 0.02, 0.1, 2.9, A0 + 0.985, F + 0.12 + k * 0.115, 5.75); K.box("brass", CI.brass, 0.03, 0.025, 0.3, A0 + 1.0, F + 0.12 + k * 0.115, 5.75); }
      K.plane("signsIn", 0xffffff, 2.9, 0.18, A0 + 1.0, F + 1.07, 5.75, PI / 2, 0, sUV("files")); for (k = 0; k < 6; k++) K.cyl("cloth", [0.86, 0.8, 0.66], 0.05, 0.05, 0.9 - (k % 3) * 0.12, A0 + 0.35 + (k % 3) * 0.2, F + 1.06 + Math.floor(k / 3) * 0.1, 4.8 + k * 0.32, 10, false, 0, 0, PI / 2);
      for (k = 0; k < 5; k++) { K.box("steel", [0.42, 0.44, 0.46], 0.5, 0.03, 5.6, A0 + 0.28, F + 0.12 + k * 0.48, -5.15); for (var bx3 = 0; bx3 < 14; bx3++) { var gz = -7.85 + bx3 * 0.4; K.box("cloth", [0.52 + (bx3 * 7 % 5) * 0.03, 0.5, 0.46], 0.4, 0.3, 0.36, A0 + 0.3, F + 0.29 + k * 0.48, gz); K.box("cloth", [0.92, 0.9, 0.84], 0.01, 0.06, 0.12, A0 + 0.505, F + 0.33 + k * 0.48, gz); } }
      [[A0 + 0.02, -7.98], [A0 + 0.02, -2.32], [A0 + 0.56, -7.98], [A0 + 0.56, -2.32]].forEach(function (q) { K.box("steel", [0.3, 0.31, 0.33], 0.04, 2.4, 0.04, q[0], F + 1.2, q[1]); }); }
    so(SO, acx, AZ0 + 1.25, 4.5, 1.05, F, F + 1.3, 0, { noStep: true }); so(SO, A1 - 0.85, acz, 0.8, 1.7, F, F + 1.3, 0, { noStep: true }); so(SO, acx, acz, 3.4, 2.2, F, F + 0.98, 0, { noStep: true });
    so(SO, 21.9, 4.7, 1.6, 0.95, F, F + 1.3, 0, { noStep: true }); so(SO, 28.6, 4.7, 1.0, 0.8, F, F + 1.75, 0, { noStep: true }); so(SO, A0 + 0.5, 5.75, 1.0, 3.0, F, F + 1.2, 0, { noStep: true }); so(SO, A0 + 0.3, -5.15, 0.6, 5.7, F, F + 2.4, 0, { noStep: true });
    yield 1;
    return true; }
  function armchair(K, x, z, face) { var c = Math.cos(face), s = Math.sin(face), P = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; }, F = SITE.F;
    var p = P(0, 0); K.box("leather", CI.leather, 0.74, 0.42, 0.72, p[0], F + 0.29, p[1], face, 0.6); var pb = P(0, -0.32); K.box("leather", CI.leather, 0.74, 0.62, 0.16, pb[0], F + 0.79, pb[1], face, 0.6);
    [-0.36, 0.36].forEach(function (lx) { var pa = P(lx, 0.0); K.box("leather", CI.leather, 0.14, 0.62, 0.72, pa[0], F + 0.42, pa[1], face, 0.6); var pw = P(lx, -0.26); K.box("leather", CI.leather, 0.16, 0.5, 0.26, pw[0], F + 0.95, pw[1], face, 0.6); });
    [[-0.32, 0.3], [0.32, 0.3], [-0.32, -0.3], [0.32, -0.3]].forEach(function (q) { var pl = P(q[0], q[1]); K.cyl("oakIn", CI.oakC, 0.03, 0.025, 0.08, pl[0], F + 0.04, pl[1], 6); }); }
  function displayCase(K, x, z, w, d, hb, hg, ry) { ry = ry || 0; var F = SITE.F; K.box("oakIn", CI.oakC, w, hb, d, x, F + hb / 2, z, ry, 0.9); K.box("glassIn", 0xffffff, w - 0.04, hg, d - 0.04, x, F + hb + hg / 2, z, ry); K.box("brass", CI.brass, w + 0.02, 0.025, d + 0.02, x, F + hb + hg, z, ry); K.box("cloth", [0.16, 0.2, 0.17], w - 0.08, 0.01, d - 0.08, x, F + hb + 0.005, z, ry); K.box("lampIn", 0xffffff, w - 0.1, 0.01, 0.03, x, F + hb + hg - 0.02, z, ry); }
  function modelField(K, x, y, z) { K.box("cloth", [0.7, 0.58, 0.42], 4.1, 0.03, 0.75, x, y + 0.015, z); K.box("cloth", [0.62, 0.5, 0.36], 3.2, 0.006, 0.12, x - 0.1, y + 0.033, z - 0.05, 0.08); K.box("cloth", [0.62, 0.5, 0.36], 2.0, 0.006, 0.1, x + 0.4, y + 0.033, z + 0.1, -0.6);
    K.box("oakIn", [0.6, 0.5, 0.4], 0.3, 0.12, 0.2, x - 1.5, y + 0.09, z + 0.22); K.place("ironIn", new THREE.CylinderGeometry(0.1, 0.1, 0.3, 10, 1, false, 0, PI), [0.5, 0.5, 0.52], x - 1.5, y + 0.15, z + 0.22, 0, 0, PI / 2);
    K.cyl("ironIn", CI.iron, 0.004, 0.004, 0.2, x + 1.6, y + 0.13, z - 0.25, 4); K.place("cloth", new THREE.ConeGeometry(0.015, 0.06, 8, 1, true), [0.9, 0.42, 0.12], x + 1.63, y + 0.22, z - 0.25, 0, 0, PI / 2);
    for (var i = 0; i < 9; i++) { K.sph("cloth", [0.32, 0.4, 0.24], 0.03, x - 1.9 + i * 0.45, y + 0.05, z + 0.32 - (i % 2) * 0.62, 6); } LB.fieldAt = [x, y, z]; }
  function propeller(K, x, y, z) { var blade = function (sd) { var pts = [], N = 12, i; for (i = 0; i <= N; i++) { var t = i / N, r = 0.1 + t * 1.25, w = (0.075 + 0.05 * Math.sin(Math.min(1, t * 1.6) * PI * 0.8)) * (1 - 0.35 * t * t); pts.push([r, w]); } var sh = new THREE.Shape(); sh.moveTo(0.1, -0.05); pts.forEach(function (q) { sh.lineTo(q[0], q[1]); }); sh.absarc(1.33, 0, 0.045, PI / 2, -PI / 2, true); for (i = N; i >= 0; i--) sh.lineTo(pts[i][0], -pts[i][1] * 0.8); sh.closePath();
      var g = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2, curveSegments: 6 }); g.translate(0, 0, -0.0175); var p = g.attributes.position; for (var k = 0; k < p.count; k++) { var r2 = p.getX(k), tw = 0.6 * (1 - r2 / 1.4); var yy = p.getY(k), zz = p.getZ(k); p.setY(k, yy * Math.cos(tw) - zz * Math.sin(tw)); p.setZ(k, yy * Math.sin(tw) + zz * Math.cos(tw)); }
      g.computeVertexNormals(); if (sd < 0) g.rotateZ(PI); var g2 = g.toNonIndexed(); uvWorld(g2, 0.6, "z"); var col = g2.attributes.position, ca = new Float32Array(col.count * 3); for (var j = 0; j < col.count; j++) { var rr = Math.abs(col.getX(j)), tip = rr > 1.12; var band = Math.floor((col.getY(j) + 0.2) * 40) % 2; var c = tip ? [0.85, 0.66, 0.36] : band ? [0.78, 0.6, 0.45] : [0.58, 0.42, 0.3]; ca[j * 3] = c[0]; ca[j * 3 + 1] = c[1]; ca[j * 3 + 2] = c[2]; } g2.setAttribute("color", new THREE.BufferAttribute(ca, 3)); return g2; };
    var m = new THREE.Matrix4().makeRotationY(-PI / 2); m.premultiply(new THREE.Matrix4().makeTranslation(x, y, z)); [1, -1].forEach(function (sd) { var g = blade(sd); g.applyMatrix4(m); K.add("oakIn", g); });
    K.cyl("oakIn", CI.oakC, 0.13, 0.13, 0.16, x - 0.02, y, z, 16, false, 0, 0, PI / 2); K.cyl("steel", CI.steel, 0.06, 0.06, 0.2, x - 0.04, y, z, 12, false, 0, 0, PI / 2); for (var b = 0; b < 6; b++) { var a = b / 6 * TAU; K.cyl("steel", CI.steel, 0.012, 0.012, 0.2, x - 0.03, y + Math.cos(a) * 0.09, z + Math.sin(a) * 0.09, 6, false, 0, 0, PI / 2); } }
  function flyingGear(K, x, y, z) { K.sph("leather", CI.leather, 0.11, x, y + 0.1, z - 0.4, 12, 1, 0.8, 1.15); [-0.045, 0.045].forEach(function (dz) { K.place("brass", new THREE.TorusGeometry(0.035, 0.008, 6, 14), CI.brass, x + 0.1, y + 0.14, z - 0.4 + dz, PI / 2); }); K.box("leather", [0.4, 0.25, 0.18], 0.2, 0.04, 0.28, x, y + 0.02, z + 0.05, 0.2); K.cyl("brass", CI.brass, 0.045, 0.045, 0.012, x + 0.05, y + 0.006, z + 0.5, 16); }
  function ores(K, x, y, z) { var R = rng(1904), cols = [[0.12, 0.42, 0.24], [0.1, 0.22, 0.52], [0.42, 0.2, 0.14], [0.55, 0.36, 0.2], [0.16, 0.5, 0.36]]; for (var i = 0; i < 9; i++) { var g = new THREE.IcosahedronGeometry(0.06 + R() * 0.05, 0); var p = g.attributes.position; for (var k = 0; k < p.count; k++) p.setXYZ(k, p.getX(k) * (0.8 + R() * 0.4), p.getY(k) * (0.6 + R() * 0.3), p.getZ(k) * (0.8 + R() * 0.4)); g.computeVertexNormals(); K.place("cloth", g, cols[i % cols.length], x - 0.55 + (i % 5) * 0.27, y + 0.06, z - 0.15 + Math.floor(i / 5) * 0.3, R() * 3); }
    K.cyl("brass", CI.brass, 0.05, 0.06, 0.16, x + 0.55, y + 0.08, z + 0.15, 12); K.place("brass", new THREE.CircleGeometry(0.07, 16), CI.brass, x + 0.55, y + 0.12, z + 0.21); K.box("oakIn", CI.oakC, 0.3, 0.02, 0.14, x - 0.2, y + 0.01, z + 0.25); K.cyl("brass", CI.brass, 0.005, 0.005, 0.2, x - 0.2, y + 0.12, z + 0.25, 4); K.box("brass", CI.brass, 0.26, 0.01, 0.01, x - 0.2, y + 0.22, z + 0.25); }

  // ───────────────────────── dry kits (solids only) and turning a kit into meshes ─────────────────────────
  function dryKit() { var nop = function () { return null; }; return { dry: true, m: {}, tris: 0, add: nop, place: nop, box: nop, cyl: nop, sph: nop, tube: nop, plane: nop, lathe: nop, merge: function () { return {}; } }; }
  function matFor(b) { var M = mats(); return b === "flameK" ? M.flame : M[b] || null; }
  var CAST_B = { stucco: 1, cantera: 1, tile: 1, wood: 1, plaster: 1, oakIn: 1, woodIn: 1 };   // shadow casters: walls, roof, trim, timber and the oak furniture (small metal and fabric pieces do not cast)
  function kitMeshes(K, grp, tag, cast) { var out = [], geos = K.merge(); for (var b in geos) { var mt = matFor(b); if (!mt) { note("base", b); geos[b].dispose(); continue; } var me = new THREE.Mesh(geos[b], mt); me.name = "lb " + tag + " " + b; var opaque = !mt.transparent && mt.blending === THREE.NormalBlending;
      me.castShadow = !!cast && opaque && !!CAST_B[b]; me.receiveShadow = opaque && b !== "lamp" && b !== "lampIn" && b !== "glow"; me.userData.shSet = true; if (!me.castShadow) me.userData.noShadow = true;   /* the client forces casters on groups it adds unless noShadow */ if (mt.transparent) me.renderOrder = b === "letters" ? 1 : 2; if (mt.blending === THREE.AdditiveBlending) { me.renderOrder = 3; me.userData.noShadow = true; } grp.add(me); out.push(me); } K.m = {}; return out; }
  function groupAt() { var g = new THREE.Group(); g.position.set(SITE.ox, SITE.G, SITE.oz); g.rotation.y = SITE.yaw; g.updateMatrixWorld(true); return g; }

  // ───────────────────────── solids: local boxes to the client's SOLIDS (tag "library") ─────────────────────────
  function regSolids(list, into) { var S = SITE; list.forEach(function (q) { var w = l2w(q[0], q[1]), o = q[7] || {}; var sd = addSolid(w[0], w[1], S.yaw + (q[6] || 0), q[2], q[3], S.G + q[4], S.G + q[5], "library"); if (!sd) return; if (o.noStep) sd.noStep = true; if (o.seat) { sd.seat = true; sd.face = S.yaw + (o.face || 0); } if (o.lb) sd.lb = o.lb; if (o.tag) sd.lb = sd.lb || o.tag; into.push(sd); }); }

  // ───────────────────────── the lot: keep-outs, clearing, planting, walks, the walk grid, hub, zone, cards ─────────────────────────
  var VEG = /^(bush\d|mesquite|ocotillo|saguaro.*|paloverde|ironwood|desertwillow|barrel_cactus|prickly_pear|cholla|organ_pipe|agave_cluster|yucca_cluster|boulder|lamp|ph_(rock|boulder|shrub|succulent|stones|sandrocks|planter)_?\d*|e1_(canarypalm|fanpalm2?|datepalm|agave\w*|yucca\w*|shrub\w*|bench|lantern|planter)|fa_agave\d|land_(bench|lantern|rock\w*|shrub\w*)|fa_\w+|fb_\w+)$/;
  function clearLot(m) { var removed = 0, keys = new Set(); for (var k in PLACE) { if (!VEG.test(k)) continue; var L = PLACE[k], out = []; for (var i = 0; i < L.length; i++) { var e = L[i]; if (!e.lb && lotDist(e[0], e[2]) < m) { keys.add(Math.round(e[0] * 100) + ":" + Math.round(e[2] * 100)); removed++; } else out.push(e); } if (out.length !== L.length) { L.length = 0; Array.prototype.push.apply(L, out); } }
    if (keys.size) for (var j = COLLIDERS.length - 1; j >= 0; j--) { var c = COLLIDERS[j]; if (keys.has(Math.round(c[0] * 100) + ":" + Math.round(c[1] * 100))) COLLIDERS.splice(j, 1); } LB.n.cleared = (LB.n.cleared || 0) + removed; }
  function plantLot() { var R = rng(1928), n = 0, put1 = function (k, lx, lz, sc) { if (!canPut(k)) return false; var w = l2w(lx, lz); put(k, w[0], w[1], R() * TAU, sc); var L = PLACE[k]; if (L && L.length) L[L.length - 1].lb = 1; n++; return true; };
    var palm = canPut("e1_fanpalm2") ? "e1_fanpalm2" : canPut("fanpalm2") ? "fanpalm2" : "fanpalm";
    [[-13.4, 17.6], [-13.4, 27.4], [13.4, 17.6], [13.4, 27.4]].forEach(function (q) { put1(palm, q[0], q[1], 1.05 + R() * 0.15); });
    [[-13.4, 20.2], [-13.4, 22.5], [-13.4, 24.8], [13.4, 20.2], [13.4, 22.5], [13.4, 24.8]].forEach(function (q, i) { put1(i % 3 === 1 ? "barrel_cactus" : "agave_cluster", q[0], q[1], 0.7 + R() * 0.2); });
    put1(canPut("desertwillow") ? "desertwillow" : "paloverde", 29.5, 11.6, 0.95); put1("agave_cluster", 21.0, 13.0, 0.7); put1("agave_cluster", 30.6, 9.2, 0.65);
    // the grounds round the building: palo verde and desert willow at the ends, low desert planting along the back and the tower
    [[-27.5, 2], [-27.5, 10.5], [34.5, -6], [34.5, 3], [-22, -12.0], [4, -12.4], [24, -12.2]].forEach(function (q, i) { put1(i % 2 ? "desertwillow" : "paloverde", q[0], q[1], 0.85 + R() * 0.25); });
    var low = ["agave_cluster", "yucca_cluster", "barrel_cactus", "bush2", "agave_cluster", "bush1"].filter(canPut);
    for (var i = 0; i < 34; i++) { var t = i / 34, lx, lz; if (i < 18) { lx = lerp(-26, 31, t * 1.9); lz = -10.6 - R() * 0.8; } else { var side = i % 2 ? -1 : 1; lx = side < 0 ? -27.0 - R() * 0.8 : 33.4 + R() * 0.8; lz = lerp(-9, 13, (i - 18) / 16); } if (low.length) put1(low[i % low.length], lx, lz, 0.6 + R() * 0.4); }
    [[16.5, 29.0], [-16.5, 29.0], [17.0, 15.6], [-17.0, 15.6]].forEach(function (q, i) { put1(low[(i + 1) % low.length], q[0], q[1], 0.8); });
    LB.n.planted = n; }
  function lotPolyW(m) { var L = SITE.lot; return [[L[0] - m, L[2] - m], [L[1] + m, L[2] - m], [L[1] + m, L[3] + m], [L[0] - m, L[3] + m]].map(function (q) { return l2w(q[0], q[1]); }); }
  function walks() { var S = SITE, PMm = planMats(); var w = function (pts) { return pts.map(function (q) { return l2w(q[0], q[1]); }); };
    try { planRibbon(w([[0, 31.0], [-2.6, 34.6], [-6.0, 38.2]]), 3.2, { mat: PMm.stone, lift: 0.12, tile: 2.5 }, "lb_walk_grove"); } catch (e) { note("walk1", e); }
    try { planRibbon(w([[12.5, 31.0], [24, 36.4], [39.4, 41.6]]), 3.0, { mat: PMm.stone, lift: 0.12, tile: 2.5 }, "lb_walk_road"); } catch (e) { note("walk2", e); }
    try { PLAN_WALKS.push(w([[0, 14.6], [0, 31.0], [-6.0, 38.2]])); } catch (e) {} }
  function walkGrid() { var S = SITE, add = function (r, y) { var a = l2w(r[0], r[2]), b = l2w(r[1], r[2]), c = l2w(r[1], r[3]), d = l2w(r[0], r[3]), g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute([a[0], S.G + y, a[1], b[0], S.G + y, b[1], c[0], S.G + y, c[1], a[0], S.G + y, a[1], c[0], S.G + y, c[1], d[0], S.G + y, d[1]], 3)); try { walkAdd(g); } catch (e) { note("walkAdd", e); } g.dispose(); };
    add([-18.4, 18.4, -8.4, 8.4], S.F); add([19.0, 31.3, -8.3, 7.3], S.F); add([-19, 19, 9.0, 13.6], S.F); add([-4.4, 4.4, 13.0, 14.6], S.F); add([-15, 15, 14.6, 30.5], 0.08); add([19, 32, 8, 14.2], 0.08); add([-1.3, 1.3, 8.3, 9.1], S.F); }
  var CARDS = LB.cards = LB.cards || [];
  function addCards() { var S = SITE, I = C("info", {}) || {}; var def = [["front", 0, 33.4, 3.6, 0], ["tower", -22.3, 14.6, 3.2, 0], ["fountain", 0, 23.0, 3.4, 0], ["patio", 25.5, 10.6, 3.0, 0], ["arcade", -12.0, 11.2, 2.6, 0],
      ["tables", -8.25, -1.0, 2.4, 0], ["tables", 8.25, 2.4, 2.4, 0], ["stacks", -14.9, 4.6, 1.9, 0], ["stacks", 14.9, 4.6, 1.9, 0], ["gallery", 0, -6.6, 2.2, 1], ["fire", 0, -6.9, 1.6, 0], ["catalog", 0, 0.5, 1.4, 0], ["beams", 0, 6.4, 1.6, 0],
      ["vault", 17.2, -0.5, 1.6, 0], ["mural", 25.15, -6.3, 2.2, 0], ["propeller", 29.6, -0.5, 1.9, 0], ["map", 25.15, 1.3, 1.8, 0], ["photos", 25.1, 5.8, 2.4, 0], ["smelter", 21.9, 3.5, 1.5, 0], ["model", 28.6, 3.5, 1.4, 0], ["timeline", 21.0, 6.2, 1.2, 0], ["flatfiles", 20.6, 5.8, 1.1, 0]];
    def.forEach(function (q) { var d = I[q[0]]; if (!d) return; var w = l2w(q[1], q[2]); var h = { x: w[0], z: w[1], r: q[3], t: d.t, k: d.k, p: d.p, lb: q[0], lbL: q[4] }; hotspots.push(h); CARDS.push(h); }); }
  function worldHook() {
    if (LB.off || !window.PLAN) return; var S = resolveSite(); if (!S) return; var t0 = nowMs();
    try { planKeepout(lotPolyW(2)); var L = S.lot; for (var u = L[0]; u <= L[1]; u += 7) for (var v = L[2]; v <= L[3]; v += 7) { var w = l2w(u, v); KEEPOUT.push([w[0], w[1], 6.5]); } } catch (e) { note("keepouts", e); }
    try { clearLot(1.5); } catch (e) { note("clear", e); }
    try { plantLot(); } catch (e) { note("plant", e); }
    try { var so1 = []; var itE = buildExteriorInto(dryKit(), so1), r; do { r = itE.next(); } while (!r.done); var so2 = []; var itI = buildInteriorSteps(dryKit(), null, dryKit(), so2, true); do { r = itI.next(); } while (!r.done); EX.solids = []; regSolids(so1, EX.solids); IN.solids = []; regSolids(so2, IN.solids); IN.solidsDone = true; LB.n.solids = EX.solids.length + IN.solids.length; } catch (e) { note("solids", e); }
    try { walks(); } catch (e) { note("walks", e); }
    try { walkGrid(); } catch (e) { note("walk grid", e); }
    try { addCards(); } catch (e) { note("cards", e); }
    try { var hw = l2w(0, 30.5); planAddHub(C("names.hub", "Expanse Library"), hw[0], hw[1]); planNavCats(); } catch (e) { note("hub", e); }
    try { var c0 = l2w(3, 8); zoneRings.push({ name: C("names.lib", "The Expanse Library"), label: C("names.short", "Expanse Library"), center: c0, r: 38, k: C("zone", ""), poly: lotPolyW(0), col: "#b8643a55", plan: "library" }); } catch (e) { note("zone", e); }
    installOverrides(); LB.t.world = Math.round(nowMs() - t0); }
  // ── terrain: one level pad under the lot, blended out over 4.5 m; things near the lot re-seated; the lot cleared again (the scatter ran) ──
  function gridH(x, z) { try { return getH(x, z); } catch (e) { return 0; } }
  function terrainHook() {
    if (LB.off || !window.PLAN) return; var S = resolveSite(); if (!S) return; var t0 = nowMs();
    try { if (typeof H !== "undefined" && H && T) { var cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1), blend = 4.5, cnt = 0, P = lotPolyW(blend + 2), bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9; P.forEach(function (q) { bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); bz0 = Math.min(bz0, q[1]); bz1 = Math.max(bz1, q[1]); });
        for (var r = Math.max(0, Math.floor((bz0 - T.zmin) / ch)); r <= Math.min(T.rows - 1, Math.ceil((bz1 - T.zmin) / ch)); r++) for (var c = Math.max(0, Math.floor((bx0 - T.xmin) / cw)); c <= Math.min(T.cols - 1, Math.ceil((bx1 - T.xmin) / cw)); c++) {
          var x = T.xmin + c * cw, z = T.zmin + r * ch, d = lotDist(x, z); if (d >= blend) continue; var k = d <= 0 ? 1 : 1 - sstep(0, blend, d), vi = r * T.cols + c; H[vi] = H[vi] + (S.G - H[vi]) * k; cnt++; } LB.n.graded = cnt; } } catch (e) { note("grade", e); }
    try { var Rr = 0; for (var kk in PLACE) { var Lk = PLACE[kk]; for (var i = 0; i < Lk.length; i++) { var e = Lk[i]; if (lotDist(e[0], e[2]) > 7) continue; var g = getH(e[0], e[2]); if (Math.abs(g - e[1]) > 0.02 && Math.abs(g - e[1]) < 6) { e[1] = g; Rr++; } } } LB.n.reseated = Rr; } catch (e) { note("reseat", e); }
    try { clearLot(1.5); } catch (e) { note("clear2", e); }
    LB.t.terrain = Math.round(nowMs() - t0); }

  // ───────────────────────── the defer hook: materials, the exterior, lights, warm-up, indoor culling ─────────────────────────
  function deferHook() {
    if (LB.off || !window.PLAN || !SITE) return; var t0 = nowMs();
    try { mats(); } catch (e) { note("mats", e); return; }
    try { clearLot(1.5); } catch (e) {}
    try { makeExterior(); } catch (e) { note("exterior", e); }
    try { perfRooms(); } catch (e) { note("perf rooms", e); }
    try { var W = window.PLAN_PERF; if (W && W.warmGroup && EX.g) W.warmGroup(EX.g, { name: "lb exterior" }); } catch (e) {}
    try { warmSample(); } catch (e) { note("warm", e); }
    nearBlock(); installOverrides(); LB.ready = true; LB.t.defer = Math.round(nowMs() - t0); try { LIGHTS.dirty = true; } catch (e) {} }
  function makeExterior() { var K = new Kit(), SO = []; var it = buildExteriorInto(K, SO), r; do { r = it.next(); } while (!r.done); var g = groupAt(); g.name = "lb_exterior"; EX.g = g; EX.meshes = kitMeshes(K, g, "ext", true); if (EX.glow) { EX.glowMeshes = kitMeshes(EX.glow, g, "glow", false); EX.glow = null; }
    // pooled lamps: the arcade lanterns and the forecourt posts (night)
    EX.lights = []; (EX.lampSrc || []).forEach(function (p, i) { var l = new THREE.PointLight(0xffc27a, 0, 9, 1.4); l.position.set(p[0], p[1], p[2]); l.userData.k0 = i >= 9 ? 3.2 : 2.2; g.add(l); EX.lights.push(l); });
    clockHands(g); scene.add(g); g.updateMatrixWorld(true); LB.n.extMeshes = EX.meshes.length; return g; }
  function clockHands(g) { EX.hands = []; (EX.clocks || []).forEach(function (q) { [[0.55, 0.07], [0.8, 0.045]].forEach(function (hd, j) { var geo = new THREE.BoxGeometry(hd[1], hd[0], 0.03).toNonIndexed(); geo.translate(0, hd[0] / 2 - 0.08, 0); colorize(geo, [0.06, 0.055, 0.05]); var m = new THREE.Mesh(geo, MX.iron); m.name = "lb clock hand"; m.position.set(q[0] + Math.sin(q[2]) * 0.05, 8.6, q[1] + Math.cos(q[2]) * 0.05); m.rotation.order = "YXZ"; m.rotation.y = q[2]; m.userData.hand = j; m.userData.noBatch = true; m.userData.noShadow = true; m.userData.shSet = true; m.castShadow = false; g.add(m); EX.hands.push(m); }); }); }
  // every library material on a tiny mesh, compiled behind the loading screen (so the interior's programs are ready on first entry)
  function warmSample() { var M = mats(), g = new THREE.Group(); g.name = "lb warm"; var geo = new THREE.BoxGeometry(0.1, 0.1, 0.1).toNonIndexed(); colorize(geo, 0xffffff);
    Object.keys(M).forEach(function (k) { var m = M[k]; if (m && m.isMaterial) { var me = new THREE.Mesh(geo, m); me.castShadow = !m.transparent; me.receiveShadow = true; g.add(me); } });
    g.position.set(SITE.ox, SITE.G - 30, SITE.oz); scene.add(g); LB.warm = g; if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(g, { name: "lb warm" }); setTimeout(function () { try { scene.remove(g); } catch (e) {} }, 40000); }
  // the client's near-player pebbles and rocks stay off the lot
  function nearBlock() { try { if (typeof NEAR === "undefined" || !NEAR.blocked || NEAR.blocked.lb) return; var b0 = NEAR.blocked; var f = function (x, z) { return lotDist(x, z) < 1.5 || b0(x, z); }; f.lb = true; NEAR.blocked = f; NEAR.at = [1e9, 1e9]; } catch (e) { note("near", e); } }
  // indoor culling: from inside, the world is seen only through the windows, the door, the oculi and the vault opening
  function perfRooms() { var W = window.PLAN_PERF; if (!W) return; W.rooms = W.rooms || []; if (W.rooms.some(function (r) { return r.name === "library"; })) return; var S = SITE;
    var K0 = { perfSig: function () { return 1; }, perfRoom: function (R) { var rects = [], bays = arcadeBays(); bays.forEach(function (b) { var c = (b[0] + b[1]) / 2; rects.push(R("x", 9.0, c - 0.75, c + 0.75, 1.25, 5.05)); rects.push(R("x", 9.0, c - 0.65, c + 0.65, 7.05, 8.25)); });
        [-16.6, -12.5, -7.5, -2.5, 2.5, 7.5, 12.5, 16.6].forEach(function (c) { rects.push(R("x", -9.0, c - 0.65, c + 0.65, 7.25, 8.4)); }); rects.push(R("x", 9.0, -1.3, 1.3, S.F, 5.0)); rects.push(R("z", -19.0, -1.35, 1.35, 8.95, 11.65)); rects.push(R("z", 19.0, -1.35, 1.35, 8.95, 11.65)); rects.push(R("z", -19.0, -7.6, -6.4, 1.1, 6.2));
        [-5.5, -0.5, 4.5].forEach(function (z) { rects.push(R("z", 32.0, z - 0.5, z + 0.5, 3.7, 4.8)); }); [22.5, 28.0].forEach(function (x) { rects.push(R("x", -9.0, x - 0.5, x + 0.5, 3.7, 4.8)); });
        var M = new THREE.Matrix4().makeRotationY(S.yaw); M.setPosition(S.ox, S.G, S.oz);
        return { kind: "library", M: M, boxes: [[-19.0, 19.0, -0.5, S.ridge, -9.0, 9.0], [19.0, 32.0, -0.5, 7.6, -9.0, 8.0], [-5.0, 5.0, -0.5, 6.6, 9.0, 14.6]], rects: rects, roots: [EX.g, IN.L && IN.L.g].filter(Boolean) }; } };
    W.rooms.push({ name: "library", key: function () { if (!SITE || !LB.ready) return null; var c = camera.position, rm = roomAt(c.x, c.y, c.z); return rm === "rr" || rm === "ar" ? K0 : null; } }); }

  // ───────────────────────── the interior's life cycle ─────────────────────────
  function newL() { var g = groupAt(); g.name = "lb_interior"; g.userData.noBatch = true; g.userData.interior = true; return { g: g, lights: [], ladders: [], anim: {}, tris: 0, books: 0 }; }
  function* interiorBuild(L) { var K = new Kit(), GL = new Kit(), B = new BookBuf(16000), SO = []; var it = buildInteriorSteps(K, B, GL, SO, false), r; do { r = it.next(); yield 1; } while (!r.done);
    var ms = kitMeshes(K, L.g, "in", true); yield 1; var gm = kitMeshes(GL, L.g, "inglow", false); yield 1;
    var bg = B.geometry(); var bm = new THREE.Mesh(bg, MX.books); bm.name = "lb in books"; bm.castShadow = false; bm.receiveShadow = true; bm.userData.shSet = true; L.g.add(bm); L.books = B.n; L.tris = 0; L.g.traverse(function (o) { if (o.isMesh) { var gi = o.geometry; L.tris += (gi.index ? gi.index.count : gi.attributes.position.count) / 3; } }); yield 1;
    // rolling ladders (each its own small mesh, so they can roll along their rails)
    var S = SITE, F = S.F, dY = S.deckY; [[-17.92, F + 5.7, 5.0, "z", [0.9, -5.7, 0], [2.0, 7.8]], [17.92, F + 5.7, 4.6, "z", [-0.9, -5.7, 0], [2.0, 7.8]], [-6.0, dY + 2.85, -7.92, "x", [0, -2.85, 0.85], [-16, 16]], [8.0, dY + 2.85, -7.92, "x", [0, -2.85, 0.85], [-16, 16]]].forEach(function (q, i) {
      var lk = new Kit(); ladder(lk, q[4][0], q[4][1], q[4][2], 0, 0, 0); var lg = new THREE.Group(); lg.name = "lb ladder " + i; lg.position.set(q[0], q[1], q[2]); kitMeshes(lk, lg, "ladder" + i, false); L.g.add(lg); L.ladders.push({ g: lg, axis: q[3], range: q[5], t: 0, dir: 1, moving: 0 }); }); yield 1;
    // pooled lamps: the chandeliers, the fire, the desk; the archive's pendants, the mural, the propeller and the photo wall
    var addL = function (col, k, dist, x, y, z, flick) { var l = new THREE.PointLight(col, 0, dist, 1.3); l.position.set(x, y, z); l.userData.k0 = k; l.userData.flick = !!flick; L.g.add(l); L.lights.push(l); return l; };
    [-12.5, -7.5, -2.5, 2.5, 7.5, 12.5].forEach(function (cx) { addL(0xffd6a0, 2.6, 13, cx, 5.4, 1.4); }); addL(0xff9a4a, 2.2, 7, 0, F + 0.8, -7.0, true); addL(0xffe0b0, 1.2, 5, -1.4, F + 1.6, 2.6);
    addL(0xffe2b8, 2.6, 9, 25.15, F + 2.6, -0.5); addL(0xffe2b8, 2.0, 8, 25.15, F + 3.6, -6.6); addL(0xffe2b8, 1.8, 7, 30.2, F + 3.0, -0.5); addL(0xffe2b8, 1.6, 7, 25.1, F + 3.0, 6.2);
    try { if (has("biplane") && LB.modelAt) { var mg = makeModel("biplane"); mg.scale.setScalar(0.085); mg.position.set(LB.modelAt[0], LB.modelAt[1] + 0.02, LB.modelAt[2]); mg.rotation.y = 0.6; mg.traverse(function (o) { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } }); L.g.add(mg); L.model = mg; } } catch (e) { note("model", e); }
    L.g.updateMatrixWorld(true); return true; }
  function finishL(L) { scene.add(L.g); L.g.updateMatrixWorld(true); try { if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(L.g, { name: "lb interior" }); } catch (e) {} try { LIGHTS.dirty = true; } catch (e) {}
    try { var GX = window.PLAN_GFX; if (GX && GX.addSunShaft && !L.shafts) { var S = SITE, q = []; arcadeBays().forEach(function (b) { var c = (b[0] + b[1]) / 2; q.push([[c - 0.6, 7.1, 8.8], [c + 0.6, 7.1, 8.8], [c + 0.6, 8.1, 8.8], [c - 0.6, 8.1, 8.8]]); }); var qb = []; [-16.6, -12.5, -7.5, -2.5, 2.5, 7.5, 12.5, 16.6].forEach(function (c) { qb.push([[c - 0.6, 7.3, -8.8], [c + 0.6, 7.3, -8.8], [c + 0.6, 8.3, -8.8], [c - 0.6, 8.3, -8.8]]); });
      var toW = function (list) { return list.map(function (qq) { return qq.map(function (p) { var w = l2w(p[0], p[2]); return [w[0], S.G + p[1], w[1]]; }); }); };       L.shafts = [GX.addSunShaft({ quads: toW(q), floorY: S.G + S.F, inward: [-S.s, 0, -S.c], maxLen: 22, k: 0.8, obj: L.g }), GX.addSunShaft({ quads: toW(qb), floorY: S.G + S.F, inward: [S.s, 0, S.c], maxLen: 22, k: 0.8, obj: L.g })]; } } catch (e) { note("shafts", e); }
    return L; }
  function disposeL() { var L = IN.L; if (!L) return; try { (L.shafts || []).forEach(function (h) { try { h.remove(); } catch (e) {} }); } catch (e) {} try { scene.remove(L.g); L.g.traverse(function (o) { if (o.isMesh && o.geometry) o.geometry.dispose(); }); } catch (e) { note("dispose", e); } IN.L = null; LB.n.disposes = (LB.n.disposes || 0) + 1; try { LIGHTS.dirty = true; } catch (e) {} }
  function interiorFrame() { var p = player.position, d = bldDist(p.x, p.z), flying = typeof FLY !== "undefined" && FLY.on;
    if (!IN.L && !IN.sb && d < R_BUILD && !flying) { var L = newL(); IN.sb = { L: L, it: interiorBuild(L), t0: nowMs() }; }
    if (IN.sb) { var sb = IN.sb, r; try { var hurry = !!roomAt(p.x, p.y + 1, p.z); if (!hurry && window.PLAN_PERF && PLAN_PERF.step) r = PLAN_PERF.step(sb.it); else { do { r = sb.it.next(); } while (!r.done); } } catch (e) { note("build", e); IN.sb = null; return; }
      if (r && r.done) { IN.L = finishL(sb.L); LB.n.builds = (LB.n.builds || 0) + 1; LB.t.build = Math.round(nowMs() - sb.t0); IN.sb = null; } }
    if (IN.L && d > R_DROP) disposeL(); }

  // ───────────────────────── people: the head librarian at the desk (talk, borrow), readers through PLAN_ROAM ─────────────────────────
  var STAFF = LB.staff = LB.staff || { list: [], done: false };
  function buildStaff() { var A = C("librarian", null); if (!A || typeof avatar !== "function" || STAFF.done) return; if (bldDist(player.position.x, player.position.z) > 150) return; STAFF.done = true;
    if (CAST.some(function (c) { return c.id === A.id; })) return; var w = l2w(0, 1.75), S = SITE;
    var g = avatar(A.id, A.name, A.look || {}, A.hat || null, A.outfit || null); g.position.set(w[0], S.G + S.F + 0.01, w[1]); g.rotation.y = S.yaw; try { g.userData.label.scale.set(1.7, 0.43, 1); } catch (e) {} scene.add(g);
    var talk = (A.talk || []).map(function (q) { return { t: q.t, o: (q.o || []).slice() }; }); var c = { id: A.id, name: A.name, role: A.role, pos: [w[0], w[1]], look: A.look, hat: null, outfit: null, greet: A.greet || ["Welcome."], talk: talk, kw: [], g: g, rot: g.rotation.y, lbLib: true };
    CAST.push(c); var hs = { x: w[0], z: w[1], r: 3.0, t: c.name, k: c.role + " · press E to talk", p: talk[0] ? talk[0].t : "", play: "npc:" + c.id, lb: "librarian", lbL: 0 }; hotspots.push(hs); STAFF.list.push(c); STAFF.lib = c; }
  function staffFrame(dt) { var cam = camera.position; STAFF.list.forEach(function (c) { var dd = Math.hypot(c.g.position.x - cam.x, c.g.position.z - cam.z); c.g.visible = dd < 60 && (LB.zone === "in" || dd < 30); if (c.g.visible && (FRAME_N & 1) === 0) try { animateWalk(c.g, 0, dt * 2); } catch (e) {} }); }
  function roamArea() { var RO = window.PLAN_ROAM; if (!RO || !RO.area || RO.off || LB.roamArea) return; var S = SITE, RC = C("roam", {}) || {};
    var P = function (lx, lz, kind, line, faceL, tag, dur) { var w = l2w(lx, lz); return { kind: kind, line: line, x: w[0], z: w[1], face: S.yaw + (faceL || 0), tag: tag, dur: dur }; };
    var bb = lotPolyW(1), bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9; bb.forEach(function (q) { bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); bz0 = Math.min(bz0, q[1]); bz1 = Math.max(bz1, q[1]); });
    var def = { id: "library", max: 4, box: [bx0, bz0, bx1, bz1], perCat: true, pull: 3, people: (RC.people || []).slice(), lines: RC.lines || {},
      ready: function () { return !!LB.ready && IN.solidsDone; },
      levels: [{ base: function (x, z) { var q = w2l(x, z); if (inR(q, S.rr) || inR(q, S.ar) || inR(q, [-19, 19, 9.0, 13.6]) || inR(q, [-4.4, 4.4, 13.0, 14.6])) return S.G + S.F; if (inR(q, S.fore) || inR(q, S.patio)) return S.G + 0.08; return planGroundAt(x, z); }, exact: true,
        block: function (x, z) { var q = w2l(x, z); if (!inR(q, S.lot, -1)) return true; if (underDeck(q)) return false; if (q[0] < -17.0 && q[0] > -18.5 && q[1] > S.deckZ - 0.1 && q[1] < 0.9) return true; return false; } }],
      entries: function () { return [P(-1.5, 30.2, null, null, PI, "door"), P(1.5, 30.2, null, null, PI, "door"), P(22.0, 13.6, null, null, PI, "door")]; },
      seeds: function () { return def.entries().concat([P(0, 6.0), P(0, 11.2), P(25.15, 3.0), P(0, 18.0)]); },
      pois: function () { var out = [];
        [[-15.0, 4.6, PI / 2], [-15.0, 1.9, PI / 2], [14.9, 4.6, -PI / 2], [-16.8, 6.8, -PI / 2], [16.9, 6.2, PI / 2], [-6.0, -4.6, PI], [6.0, -4.6, PI], [-12.0, -4.6, PI], [12.0, -4.6, PI], [-9.0, 7.4, 0], [9.0, 7.4, 0]].forEach(function (q, i) { out.push(P(q[0], q[1], i < 5 ? "browse" : "look", "stacks", q[2], "stack" + i, [10, 22])); });
        [[25.15, -5.2, PI, "mural"], [29.4, -0.5, PI / 2, "prop"], [25.15, 1.8, PI, "map"], [23.7, 5.9, 0, "photos"], [26.6, 5.9, 0, "photos"], [21.9, 3.4, 0, "smelter"], [28.6, 3.4, 0, "model"]].forEach(function (q) { out.push(P(q[0], q[1], "look", "archive", q[2], q[3], [9, 18])); });
        out.push(P(0, 26.0, "look", "fore", PI, "fountain", [8, 14])); out.push(P(-3.0, 4.8, "look", "stacks", PI, "desk", [6, 12]));
        return out; },
      seatInfo: function (s) { if (s.tag !== "library") return null; if (s.lb === "chair") return { kind: "sit", line: "read", tag: "chair" }; if (s.lb === "arm") return { kind: "sit", line: "fire", tag: "arm" }; if (s.lb === "bench") return { kind: "sit", line: "fore", tag: "bench" }; return null; },
      weight: function (p, h) { var k = p.kind, t = p.tag || ""; if (h < 8 || h > 21) return k === "sit" && t === "bench" ? 0.6 : 0.2; if (k === "sit" && t === "chair") return 2.4; if (t === "arm") return 0.8; if (p.line === "archive") return 1.2; if (k === "browse" || p.line === "stacks") return 1.3; return 0.7; },
      count: function (h) { return h < 8 || h > 21 ? 1 : h > 10 && h < 18 ? 4 : 3; },
      dur: { sit: [40, 90], chat: [14, 30], look: [8, 18], browse: [12, 24] },
      visible: function (c) { var p = c.g.position, rm = roomAt(p.x, p.y + 1, p.z), cam = camera.position; if (!rm) return true; return LB.zone === "in" || Math.hypot(cam.x - p.x, cam.z - p.z) < 40; },
      sameZone: function (c) { var p = c.g.position, a = !!roomAt(p.x, p.y + 1, p.z), b = LB.zone === "in"; return a === b; } };
    LB.roamArea = RO.area(def); }

  // ───────────────────────── books, reading, the archive cards ─────────────────────────
  function books() { return C("books", []) || []; }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function bookOut() { var v = lsGet("g1:lb_book", ""); if (v === "") return -1; var i = +v; return i >= 0 && i < books().length ? i : -1; }
  function fill(s, b) { return String(s || "").replace("{t}", b ? b.t : ""); }
  var CARD = LB.card = LB.card || { open: false };
  function showCard(t, k, p) { try { var h = $id("info-h"), kk = $id("info-k"), pp = $id("info-p"), go = $id("info-go"), nv = $id("info-nav"); if (!h) return false; h.textContent = t; kk.textContent = k; pp.textContent = p; if (go) { CARD.go = go.style.display; go.style.display = "none"; } if (nv) { CARD.nv = nv.style.display; nv.style.display = "none"; } $id("info").classList.add("on"); CARD.open = true; if (document.exitPointerLock) document.exitPointerLock(); return true; } catch (e) { note("card", e); return false; } }
  function cardFrame() { if (!CARD.open) return; var el = $id("info"); if (el && !el.classList.contains("on")) { CARD.open = false; var go = $id("info-go"), nv = $id("info-nav"); if (go) go.style.display = CARD.go || ""; if (nv) nv.style.display = CARD.nv || ""; } }
  var EXH = ["mural", "propeller", "map", "photos", "smelter", "model"];
  function cardRead(key) { var i = EXH.indexOf(key); if (i < 0) return; var m = +(lsGet("g1:lb_ex", "0")) | 0; m |= 1 << i; lsSet("g1:lb_ex", String(m)); if (m === (1 << EXH.length) - 1) stamp("p_lb_exhibits"); }
  var READ = LB.read = LB.read || { seat: null };
  function readFrame() { var sit = typeof SIT !== "undefined" && SIT.on; if (!sit) { READ.seat = null; return; } if (READ.seat) return; var p = player.position, best = null, bd = 0.4;
    (IN.solids || []).forEach(function (sd) { if (sd.lb !== "chair") return; var d = Math.hypot(sd.x - p.x, sd.z - p.z); if (d < bd) { bd = d; best = sd; } }); if (!best) { READ.seat = "none"; return; } READ.seat = best;
    var i = bookOut(), B = books(); if (i < 0) { try { setStatus(C("readHint", "Borrow a book from the librarian at the desk to read it here.")); } catch (e) {} return; }
    var b = B[i], pages = (b.p || []).slice(1).join("\n\n"); showCard(b.t, (b.a ? b.a + " · " : "") + (b.p && b.p[0] ? b.p[0] : ""), pages); stamp("p_lb_read"); LB.n.reads = (LB.n.reads || 0) + 1; }

  // ───────────────────────── the client functions wrapped by bare name (once) ─────────────────────────
  function installOverrides() { if (LB.ovr) return; LB.ovr = true;
    try { var st0 = showTalk; showTalk = function (c, idx) { try { if (c && c.lbLib) { var B = books();
          if (typeof idx === "string" && idx.indexOf("lb:") === 0) { var parts = idx.split(":"), L = C("librarian", {}) || {};
            if (parts[1] === "borrow") { var i = +parts[2], out = bookOut(); if (out >= 0 && out !== i) { c.talk[9] = { t: fill(L.out, B[out]), o: [["Return it", "lb:return"], ["Keep reading", -1]] }; return st0.call(this, c, 9); } lsSet("g1:lb_book", String(i)); stamp("p_lb_borrow"); LB.n.borrows = (LB.n.borrows || 0) + 1; c.talk[9] = { t: fill(L.borrowed, B[i]), o: [["Thanks", -1]] }; try { setStatus("Borrowed: " + B[i].t); } catch (e) {} return st0.call(this, c, 9); }
            if (parts[1] === "return") { var o = bookOut(); lsSet("g1:lb_book", ""); c.talk[9] = { t: fill(L.returned, B[o]), o: [["Borrow another", 1], ["Thanks", -1]] }; return st0.call(this, c, 9); } }
          if (idx === 0) { var o0 = (C("librarian.talk", [])[0] || {}).o || []; c.talk[0].o = o0.slice(); var bo = bookOut(); if (bo >= 0) c.talk[0].o.splice(1, 0, ["Return " + B[bo].t, "lb:return"]); }
          if (idx === 1) c.talk[1].o = B.map(function (b, j) { return [b.t, "lb:borrow:" + j]; }).concat([["Maybe later", -1]]); } } catch (e) { note("talk", e); } return st0.apply(this, arguments); }; } catch (e) { note("wrap talk", e); }
    try { var nh0 = nearestHotspot; nearestHotspot = function () { var h = nh0.apply(this, arguments); try { if (h && h.lb && SITE) { var lvl = player.position.y - SITE.G > SITE.deckY - 0.5 ? 1 : 0; if ((h.lbL || 0) !== lvl) { var best = null, bd = 1e9; for (var i = 0; i < hotspots.length; i++) { var q = hotspots[i]; if (q.lb && (q.lbL || 0) !== lvl) continue; var d = Math.hypot(player.position.x - q.x, player.position.z - q.z); if (d < q.r && d < bd) { bd = d; best = q; } } return best; } } } catch (e) {} return h; }; } catch (e) { note("wrap hotspot", e); }
    try { var on0 = openNearest; openNearest = function () { try { if (LB.ready && SITE && !(typeof inside !== "undefined" && inside) && !(typeof SIT !== "undefined" && SIT.on) && !(typeof riding !== "undefined" && riding)) { var p = player.position, q = w2l(p.x, p.z);
          if (rdist(q, SITE.lot) < 1 && IN.L) { var lad = nearLadder(); if (lad) { rollLadder(lad); return; } }
          var h = nearestHotspot(); if (h && h.lb && h.lb !== "librarian" && !(typeof nearestSeat === "function" && nearestSeat())) { cardRead(h.lb); } } } catch (e) { note("open", e); } return on0.apply(this, arguments); }; } catch (e) { note("wrap open", e); } }
  function nearLadder() { var L = IN.L; if (!L) return null; var p = player.position, best = null, bd = 1.5; L.ladders.forEach(function (ld) { var wp = new THREE.Vector3(); ld.g.getWorldPosition(wp); var q = w2l(p.x, p.z), lq = w2l(wp.x, wp.z); var d = ld.axis === "z" ? Math.hypot(q[0] - (lq[0] + Math.sign(-lq[0]) * 0.6), q[1] - lq[1]) : Math.hypot(q[0] - lq[0], q[1] - (lq[1] + 0.7)); if (Math.abs(p.y - wp.y) < 7 && d < bd) { bd = d; best = ld; } }); return best; }
  function rollLadder(ld) { if (ld.moving) return; var cur = ld.axis === "z" ? ld.g.position.z : ld.g.position.x, step = 1.4 * ld.dir; if (cur + step > ld.range[1] || cur + step < ld.range[0]) { ld.dir = -ld.dir; step = -step; } ld.from = cur; ld.to = cur + step; ld.moving = 1; ld.t = 0; LB.n.rolls = (LB.n.rolls || 0) + 1; if (!LB.ladderCard) { LB.ladderCard = true; var d = C("info.ladder", null); if (d) showCard(d.t, d.k, d.p); } try { sfx("ui"); } catch (e) {} }
  function ladderFrame(dt) { var L = IN.L; if (!L) return; L.ladders.forEach(function (ld) { if (!ld.moving) return; ld.t = Math.min(1, ld.t + dt / 1.1); var e = ld.t * ld.t * (3 - 2 * ld.t), v = lerp(ld.from, ld.to, e); if (ld.axis === "z") ld.g.position.z = v; else ld.g.position.x = v; if (ld.t >= 1) ld.moving = 0; }); }

  // ───────────────────────── the camera inside: kept within the walls and under the gallery, first person when tight ─────────────────────────
  var FR = LB.fr = LB.fr || { inCam: false };
  function camOK(x, y, z, py) { var S = SITE, q = w2l(x, z), h = y - S.G; var m = 0.35;
    if (inR(q, S.rr, -m)) { if (underDeck(q) && py - S.G < S.deckY - 0.3) return h < S.deckY - 0.45 - 0.05; if (q[1] > S.deckZ - m && q[1] < S.deckZ + m && Math.abs(h - S.deckY) < 0.6) return false; return h < 12.3 - Math.abs(q[1]) / 8.4 * 3.4 - 0.5; }
    if (inR(q, S.ar, -m)) return h < S.arVault[0] - 0.2; if (inR(q, [-1.1, 1.1, 8.2, 9.2])) return h < 3.6; if (inR(q, S.porch, -m)) return h < 6.2; return false; }
  function busy() { try { return (typeof riding !== "undefined" && riding) || (typeof SIT !== "undefined" && SIT.on) || (typeof inside !== "undefined" && inside) || (typeof DANCE !== "undefined" && DANCE.on) || (typeof FLY !== "undefined" && FLY.on) || (typeof golf !== "undefined" && golf.playing); } catch (e) { return false; } }
  function camHook(dt) {
    if (LB.off || !SITE || !LB.ready || window.__cam) return false;
    try { if (busy()) { FR.inCam = false; return false; } var px = player.position.x, py = player.position.y, pz = player.position.z, rm = roomAt(px, py + 1, pz);
      if (rm !== "rr" && rm !== "ar") { if (FR.inCam) { FR.inCam = false; try { player.userData.walk.visible = true; } catch (e) {} } return false; }
      FR.inCam = true; var fwd = [-Math.sin(yaw), -Math.cos(yaw)], by = typeof bobY === "number" ? bobY : 0, cy0 = py - by + 1.9, maxD = 5.5, dist = 0;
      for (var d = 0.2; d <= maxD; d += 0.2) { var cx = px - fwd[0] * d, cz = pz - fwd[1] * d; if (!camOK(cx, cy0 + pitch * 1.4 + d * 0.15, cz, py)) break; dist = d; }
      if (FR.fp === undefined) FR.fp = dist < 1.2; else if (FR.fp && dist > 2.0) FR.fp = false; else if (!FR.fp && dist < 1.0) FR.fp = true;
      CAM.dist += (dist - CAM.dist) * smoothK(dt, 10); var sd = Math.min(dist, CAM.dist);
      if (FR.fp) { camera.position.set(px, py - by + 1.62, pz); CAM.init = false; camera.lookAt(px + fwd[0] * 10, camera.position.y - pitch * 6, pz + fwd[1] * 10); player.userData.walk.visible = false; }
      else { var cy = cy0 + pitch * 1.4 + sd * 0.15; camera.position.lerp(camTarget.set(px - fwd[0] * sd, cy, pz - fwd[1] * sd), smoothK(dt, 24)); camLook(px, py + 1.3, pz, dt, 30); player.userData.walk.visible = true; }
      return true; } catch (e) { note("cam", e); return false; } }

  // ───────────────────────── every frame ─────────────────────────
  var LT = LB.lt = LB.lt || { clockAt: 0, staffAt: 0 };
  function frameHook(dt) {
    if (LB.off || !SITE || !LB.ready) return; dt = Math.min(dt || 0.016, 0.1);
    try { var n = clamp((nightK() - 0.02) * 3.0, 0, 1), cam = camera.position, dc = bldDist(cam.x, cam.z), dp = bldDist(player.position.x, player.position.z), rmC = roomAt(cam.x, cam.y, cam.z);
      LB.zone = rmC === "rr" || rmC === "ar" ? "in" : dc < 60 ? "near" : null; GU.uNight.value = n; GU.uAmb.value = 0.36 - 0.12 * n; GU.uHouse.value = 0.045 + 0.13 * n;
      var M = MX; if (M.lamp) M.lamp.emissiveIntensity = 0.5 + 2.6 * n; if (M.lampIn) M.lampIn.emissiveIntensity = 1.6 + 1.4 * n; if (M.shade) M.shade.emissiveIntensity = 0.18 + 0.35 * n; if (M.letters) M.letters.emissiveIntensity = 0.55 * n; if (M.clock) M.clock.emissiveIntensity = 0.05 + 0.9 * n;
      if (M.glass) M.glass.emissiveIntensity = (LB.zone === "in" ? 0 : dc > 45 ? 0.9 : 0.35) * n; if (M.glassD) M.glassD.emissiveIntensity = 0.9 * n; if (M.pool) M.pool.opacity = n; if (M.glowA) M.glowA.opacity = n; if (M.flame) M.flame.opacity = 0.75 + 0.25 * Math.sin(nowMs() * 0.013) * Math.sin(nowMs() * 0.0071);
      if (dp < R_DROP + 20 || IN.L || IN.sb) interiorFrame();
      if (IN.L) { var vis = LB.zone === "in" || dc < 70; IN.L.g.visible = vis; var fk = 0.85 + 0.15 * Math.sin(nowMs() * 0.011) * Math.sin(nowMs() * 0.0043);
        IN.L.lights.forEach(function (l) { l.intensity = vis && dc < 90 ? l.userData.k0 * (0.6 + 0.65 * n) * (l.userData.flick ? fk : 1) : 0; }); if (M.inPool) {} ladderFrame(dt); }
      if (EX.lights) EX.lights.forEach(function (l) { l.intensity = dc < 160 ? l.userData.k0 * n : 0; });
      if (nowMs() > LT.clockAt) { LT.clockAt = nowMs() + 1000; var hh = 0; try { hh = dayT() * 24; } catch (e) {} (EX.hands || []).forEach(function (m) { var a = m.userData.hand === 0 ? (hh % 12) / 12 * TAU : (hh % 1) * TAU; m.rotation.z = -a; }); }
      if (nowMs() > LT.staffAt) { LT.staffAt = nowMs() + 2000; try { buildStaff(); } catch (e) { note("staff", e); } try { roamArea(); } catch (e) { note("roam", e); } }
      staffFrame(dt); cardFrame(); readFrame();
      var rmP = roomAt(player.position.x, player.position.y + 1, player.position.z); if (rmP === "rr" && !LT.s1) { LT.s1 = true; stamp("p_lb_library"); } if (rmP === "ar" && !LT.s2) { LT.s2 = true; stamp("p_lb_archive"); }
    } catch (e) { note("frame", e); } }

  // ───────────────────────── API, debug, hooks ─────────────────────────
  LB.api = { resolveSite: resolveSite, l2w: l2w, w2l: w2l, roomAt: roomAt, lotDist: lotDist, books: books, bookOut: bookOut };
  LB.debug = {
    cam: function (lx, y, lz, tx, ty, tz, fov) { var a = l2w(lx, lz), b = l2w(tx, tz); window.__cam = [a[0], SITE.G + y, a[1], b[0], SITE.G + ty, b[1], fov || 0]; try { updateCulling(true); } catch (e) {} return window.__cam; },
    at: function (lx, lz, yawL, y) { var w = l2w(lx, lz); player.position.set(w[0], SITE.G + (y === undefined ? SITE.F + 0.02 : y), w[1]); if (yawL !== undefined) yaw = SITE.yaw + yawL; return [w[0], w[1]]; },
    build: function () { if (IN.L) return { tris: Math.round(IN.L.tris), books: IN.L.books }; var L = newL(), it = interiorBuild(L), r, ts = [], t1; do { t1 = nowMs(); r = it.next(); ts.push(+(nowMs() - t1).toFixed(1)); } while (!r.done); IN.L = finishL(L); return { steps: ts, tris: Math.round(L.tris), books: L.books, meshes: L.g.children.length }; },
    drop: function () { disposeL(); return true; },
    rebuild: function () { try { if (EX.g) { scene.remove(EX.g); EX.g.traverse(function (o) { if (o.isMesh && o.geometry) o.geometry.dispose(); }); EX.g = null; } } catch (e) {} disposeL(); makeExterior(); try { LIGHTS.dirty = true; } catch (e) {} return LB.debug.counts(); },
    counts: function () { var o = {}; [["exterior", EX.g], ["interior", IN.L && IN.L.g]].forEach(function (q) { if (!q[1]) return; var m = 0, tr = 0; q[1].traverse(function (x) { if (x.isMesh) { m++; var gi = x.geometry; tr += (gi.index ? gi.index.count : gi.attributes.position.count) / 3; } }); o[q[0]] = { meshes: m, tris: Math.round(tr) }; }); o.solids = (IN.solids || []).length + (EX.solids || []).length; o.mats = Object.keys(MX).length; return o; } };
  (function hookAll() {
    var set = function (phase, name, fn) { var list = window.PLAN_HOOKS[phase]; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name: name, fn: fn }); };
    set("world", "lbWorld", function () { worldHook(); });
    set("terrain", "lbTerrain", function () { terrainHook(); });
    set("defer", "lbDefer", function () { deferHook(); });
    set("frame", "lbFrame", function (dt, now) { frameHook(dt, now); });
    set("interior", "lbCam", function (dt) { return camHook(dt); });
  })();
})();
