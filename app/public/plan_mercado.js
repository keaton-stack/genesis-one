// R17 (5 Oct 2026, Agent X): MERCADO PLAZA, a border-heritage market square beside Main Street (S3_MAIN, on the Mesa Heights side).
//   Douglas and Agua Prieta share one plaza life. A paved square at the head of Gold Street and Nugget Lane (the town grid's two axes):
//   the Portal Norte (nine cantera arches: craft stalls and, in its three middle bays, the Casa de la Cultura with the mural of the two
//   towns), the Portal Oriente (eleven arches: the cafe de olla, the fonda, flowers, hats, chiles, candles, clay, the paleteria; its middle
//   bay is the gateway to Silver Street and Nugget Lane, under a bell gable), the corner Panaderia El Mirador with its tiled lookout tower,
//   a white cast-iron kiosco at the centre with a norteno trio, a talavera fountain on the west axis, papel picado and warm string lights,
//   fan palms, desert willows and palo verdes, a mesquite bosque with picnic tables, tiled benches, and the food row (tacos al pastor,
//   elotes, aguas frescas, churros) with cafe tables under umbrellas.
//   Buying: every food counter and the panaderia sell through the game's own coin shop (the server's coffee and meal items: a snack is
//   +40 energy, a plate is energy back to 100, at the server's prices); the sarapes stall sells the scarf and the bandana, the hat stall two hats.
//   People: vendors and the trio as idle rigs with talk cards, a few shoppers through PLAN_ROAM. Stamps 367..371 (PLAN_PROGRESS.award).
// Classic script, loaded before plan_fill_a.js and client.js; hooks PLAN_HOOKS { terrain, world, defer, frame } and wraps openNearest,
// updateZone and showTalk by bare name at run time. No new real lights (lamps are sources for the client's light pool), geometry merged per
// material, one material family. ?mercado=0 turns the module off. window.PLAN_MERCADO: n, t, errs, site, api, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var MC = window.PLAN_MERCADO = window.PLAN_MERCADO || {};
  if (MC.impl) return;
  MC.v = "r17-x1"; MC.errs = MC.errs || []; MC.n = MC.n || {}; MC.t = MC.t || {};
  if (/[?&]mercado=0\b/.test(location.search)) { MC.off = true; return; }
  var PI = Math.PI, TAU = PI * 2, HP = PI / 2, HK = window.PLAN_HOOKS;
  function note(tag, e) { try { if (MC.errs.length < 60) MC.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (MC.errs.length <= 6) console.warn("plan_mercado " + tag, e); } catch (x) {} }
  function cnt(k, n) { MC.n[k] = (MC.n[k] || 0) + (n === undefined ? 1 : n); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function nowMs() { return performance.now(); }
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function hourNow() { try { return dayT() * 24; } catch (e) { return 12; } }
  function has(k) { try { return !!(MODELS[k] && (MODELS[k].parts || MODELS[k]._pp)); } catch (e) { return false; } }
  function canPut(k) { try { return has(k) && !!MODEL_SPECS[k]; } catch (e) { return false; } }
  function $id(id) { return document.getElementById(id); }
  function V3(x, y, z) { return new THREE.Vector3(x, y, z); }
  function lowTier() { try { return ASSET.tier === "m"; } catch (e) { return false; } }
  function qual() { try { return localStorage.getItem("g1:quality") || "high"; } catch (e) { return "high"; } }
  function au(u) { try { if (window.AV) return window.AV(u); } catch (e) {} return u; }
  var AWD = MC.awarded = MC.awarded || {};
  function stamp(id) { if (!id || AWD[id]) return; try { var PP = window.PLAN_PROGRESS; if (PP && PP.award) { PP.award("stamp", { id: id }); AWD[id] = 1; cnt("stamp_" + id); } } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ───────────────────────── config: plan/mercado.json (copy, people, menus, cards, stamps) ─────────────────────────
  var CFG = MC.cfg || null;
  function cfgUrl() { return au("/plan/mercado.json?v=" + (window.BUILD || "dev")); }
  if (!CFG) { try { fetch(cfgUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && !CFG) CFG = MC.cfg = d; }).catch(function (e) { note("cfg fetch", e); }); } catch (e) { note("cfg", e); } }
  function cfg() { if (CFG) return CFG; try { var x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = MC.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); } return CFG || {}; }
  function C(path, dflt) { var o = cfg(); if (!o) return dflt; var p = path.split("."); for (var i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }

  // ───────────────────────── the site frame ─────────────────────────
  // Local frame (the Main Street town grid): x toward east-north-east along Nugget Lane (which runs on z = 0 from Silver Street at x 55.5
  // to Main Street), z toward south-south-east down Gold Street (which runs on x = 1 from Placer Lane at z 38), y up from the plaza level G.
  // Origin (620, 328), yaw 0.4424 rad (the groups' rotation.y). The square x -19..21, z -22.5..22.5 at G; the arcades' floors at G + AF.
  var SITE = MC.site = MC.site || null;
  function resolveSite() { if (SITE) return SITE; var s = C("site", {}) || {};
    var S = { ox: s.ox || 620, oz: s.oz || 328, yaw: s.yaw || 0.4424, G: s.G || 22.0, AF: 0.32 };
    S.c = Math.cos(S.yaw); S.s = Math.sin(S.yaw);
    S.sq = [-19, 21, -22.5, 22.5];                 // the paved square
    S.bld = [[-19.3, 21, -33.4, -22.4], [20.9, 32.2, -33.7, 22.6]];   // the portales, the panaderia (graded flat to G under them)
    S.pad = [-19.4, 33.6, -34.0, 24.6];            // graded to G (with a short blend behind the buildings, a long one at the open edges)
    S.lot = [-35.5, 34.2, -35.5, 27.0];            // the whole venue (the bosque included): keep-out, cleared of scatter
    S.bos = [-35.0, -19.4, -21.0, 22.0];           // the mesquite bosque (natural grade below the square, a seat wall and steps between)
    S.kio = [1, 0]; S.fnt = [-12.5, 0];
    SITE = MC.site = S; return S; }
  function l2w(x, z) { var S = SITE; return [S.ox + x * S.c + z * S.s, S.oz - x * S.s + z * S.c]; }
  function w2l(x, z) { var S = SITE, dx = x - S.ox, dz = z - S.oz; return [dx * S.c - dz * S.s, dx * S.s + dz * S.c]; }
  function inR(q, r, m) { m = m || 0; return q[0] > r[0] - m && q[0] < r[1] + m && q[1] > r[2] - m && q[1] < r[3] + m; }
  function rdist(q, r) { var dx = Math.max(r[0] - q[0], 0, q[0] - r[1]), dz = Math.max(r[2] - q[1], 0, q[1] - r[3]); return Math.hypot(dx, dz); }
  function rectPolyW(r, m) { m = m || 0; return [[r[0] - m, r[2] - m], [r[1] + m, r[2] - m], [r[1] + m, r[3] + m], [r[0] - m, r[3] + m]].map(function (q) { return l2w(q[0], q[1]); }); }
  // the venue outline (local): the bosque's north-west corner is cut back clear of Old Track Parkway
  function lotPolyL(m) { var L = SITE.lot; m = m || 0; return [[L[0] - m, -12 - m * 0.4], [-29 - m * 0.7, -24.5 - m * 0.7], [-20.5 - m * 0.6, -35.5 - m], [L[1] + m, L[2] - m], [L[1] + m, L[3] + m], [L[0] - m, L[3] + m]]; }
  function lotPolyW(m) { return lotPolyL(m).map(function (q) { return l2w(q[0], q[1]); }); }
  function inPolyL(poly, x, z) { var c = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
  function inLot(x, z, m) { var q = w2l(x, z); return inPolyL(lotPolyL(m || 0), q[0], q[1]); }
  function lotDist(x, z) { var q = w2l(x, z), P = lotPolyL(0); if (inPolyL(P, q[0], q[1])) return 0; var d = 1e9; for (var i = 0, j = P.length - 1; i < P.length; j = i++) { var ax = P[j][0], az = P[j][1], bx = P[i][0], bz = P[i][1], vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1, t = clamp(((q[0] - ax) * vx + (q[1] - az) * vz) / L2, 0, 1); d = Math.min(d, Math.hypot(q[0] - ax - vx * t, q[1] - az - vz * t)); } return d; }

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
  Kit.prototype.lathe = function (b, col, prof, x, y, z, seg, sx, sy, sz, ry) { return this.place(b, new THREE.LatheGeometry(prof.map(function (q) { return new THREE.Vector2(Math.max(0.0005, q[0]), q[1]); }), seg || 16), col, x, y, z, ry || 0, 0, 0, sx, sy, sz); };
  Kit.prototype.merge = function () { var out = {}; for (var k in this.m) { var g = mergeAll(this.m[k]); if (g) out[k] = g; } return out; };
  function mergeAll(list) {
    if (!list || !list.length) return null; var n = 0; list.forEach(function (g) { n += g.attributes.position.count; }); if (!n) return null;
    var P = new Float32Array(n * 3), N = new Float32Array(n * 3), Uu = new Float32Array(n * 2), Cc = new Float32Array(n * 3), o = 0;
    list.forEach(function (g) { var c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); Uu.set(g.attributes.uv.array, o * 2); if (g.attributes.color) Cc.set(g.attributes.color.array, o * 3); else Cc.fill(1, o * 3, (o + c) * 3); o += c; g.dispose(); });
    return weld(P, N, Uu, Cc, n); }
  // weld identical vertices (position, normal, uv, colour quantised) into an indexed geometry: about a third of the vertex memory.
  // An open-addressing hash table over the quantised integers (no string keys): a few ms for the whole venue.
  function weld(P, N, Uu, Cc, n) { var Q = new Int32Array(n * 11), K = [2000, 2000, 2000, 100, 100, 100, 4000, 4000, 255, 255, 255];
    for (var i = 0; i < n; i++) { var o = i * 11, i3 = i * 3, i2 = i * 2; Q[o] = Math.round(P[i3] * 2000); Q[o + 1] = Math.round(P[i3 + 1] * 2000); Q[o + 2] = Math.round(P[i3 + 2] * 2000); Q[o + 3] = Math.round(N[i3] * 100); Q[o + 4] = Math.round(N[i3 + 1] * 100); Q[o + 5] = Math.round(N[i3 + 2] * 100); Q[o + 6] = Math.round(Uu[i2] * 4000); Q[o + 7] = Math.round(Uu[i2 + 1] * 4000); Q[o + 8] = Math.round(Cc[i3] * 255); Q[o + 9] = Math.round(Cc[i3 + 1] * 255); Q[o + 10] = Math.round(Cc[i3 + 2] * 255); }
    var size = 1; while (size < n * 2) size <<= 1; var mask = size - 1, table = new Int32Array(size).fill(-1), first = new Int32Array(n), idx = new Uint32Array(n), out = 0;
    for (var v = 0; v < n; v++) { var o2 = v * 11, h = 0; for (var k = 0; k < 11; k++) h = Math.imul(h ^ Q[o2 + k], 0x9E3779B1) + k | 0; h = (h ^ (h >>> 15)) & mask;
      for (;;) { var t = table[h]; if (t < 0) { table[h] = out; first[out] = v; idx[v] = out; out++; break; } var o3 = first[t] * 11, same = true; for (var m = 0; m < 11; m++) if (Q[o3 + m] !== Q[o2 + m]) { same = false; break; } if (same) { idx[v] = t; break; } h = (h + 1) & mask; } }
    var P2 = new Float32Array(out * 3), N2 = new Float32Array(out * 3), U2 = new Float32Array(out * 2), C2 = new Float32Array(out * 3);
    for (var u = 0; u < out; u++) { var f = first[u]; P2[u * 3] = P[f * 3]; P2[u * 3 + 1] = P[f * 3 + 1]; P2[u * 3 + 2] = P[f * 3 + 2]; N2[u * 3] = N[f * 3]; N2[u * 3 + 1] = N[f * 3 + 1]; N2[u * 3 + 2] = N[f * 3 + 2]; U2[u * 2] = Uu[f * 2]; U2[u * 2 + 1] = Uu[f * 2 + 1]; C2[u * 3] = Cc[f * 3]; C2[u * 3 + 1] = Cc[f * 3 + 1]; C2[u * 3 + 2] = Cc[f * 3 + 2]; }
    var r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P2, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N2, 3)); r.setAttribute("uv", new THREE.BufferAttribute(U2, 2)); r.setAttribute("color", new THREE.BufferAttribute(C2, 3));
    r.setIndex(new THREE.BufferAttribute(out > 65535 ? idx : new Uint16Array(idx), 1)); r.computeBoundingBox(); r.computeBoundingSphere(); cnt("welded", n - out); return r; }
  function uvBox(g, w, h, d, t) { var uv = g.attributes.uv; var dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (var f = 0; f < 6; f++) for (var k = 0; k < 4; k++) { var i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } }
  // planar world uv for any geometry (after placement): axis "y" -> (x, z), "x" -> (z, y), "z" -> (x, y); or by the face normal ("auto")
  function uvWorld(g, t, axis, ou, ov) { var p = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv; ou = ou || 0; ov = ov || 0;
    for (var i = 0; i < p.count; i++) { var x = p.getX(i), y = p.getY(i), z = p.getZ(i), ax = axis; if (ax === "auto") { var nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i)); ax = ny >= nx && ny >= nz ? "y" : nx >= nz ? "x" : "z"; }
      if (ax === "y") uv.setXY(i, x / t + ou, z / t + ov); else if (ax === "x") uv.setXY(i, z / t + ou, y / t + ov); else uv.setXY(i, x / t + ou, y / t + ov); } uv.needsUpdate = true; return g; }
  // shade a geometry's vertex colours by height (darker toward the ground: dust and splash)
  function grime(g, y0, y1, k) { var p = g.attributes.position, c = g.attributes.color; if (!c) return g; for (var i = 0; i < p.count; i++) { var t = 1 - k * (1 - sstep(y0, y1, p.getY(i))); c.setXYZ(i, c.getX(i) * t, c.getY(i) * t * 0.99, c.getZ(i) * t * 0.97); } c.needsUpdate = true; return g; }
  function colorize(g, col) { var n = g.attributes.position.count, c = rgb(col), a = new Float32Array(n * 3); for (var i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; } g.setAttribute("color", new THREE.BufferAttribute(a, 3)); return g; }
  function mulCol(c, k) { c = rgb(c); return [c[0] * k, c[1] * k, c[2] * k]; }

  // ───────────────────────── walls: a Shape with holes, extruded, split into its outside face, inside face and reveals ─────────────────────────
  function shapeFrom(pts) { var s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; }
  function pathFrom(pts) { var s = new THREE.Path(); s.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; }
  function archHole(x0, x1, y0, ys, seg, rise) { var r = (x1 - x0) / 2, cx = (x0 + x1) / 2, pts = [[x0, y0], [x1, y0], [x1, ys]]; seg = seg || 14; var rr = rise === undefined ? r : rise;
    for (var i = 1; i < seg; i++) { var a = i / seg * PI; pts.push([cx + Math.cos(a) * r, ys + Math.sin(a) * rr]); } pts.push([x0, ys]); return pts; }
  function rectHole(x0, x1, y0, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
  function wallGeo(outline, holes, depth) {
    var sh = shapeFrom(outline); (holes || []).forEach(function (h) { sh.holes.push(pathFrom(h.slice().reverse())); });
    var g = new THREE.ExtrudeGeometry(sh, { depth: depth, bevelEnabled: false, curveSegments: 1, steps: 1 }); if (g.index) g = g.toNonIndexed(); g.computeVertexNormals();
    var p = g.attributes.position, nr = g.attributes.normal, out = [], inn = [], side = [];
    for (var t = 0; t < p.count; t += 3) { var nz = nr.getZ(t); (nz > 0.7 ? out : nz < -0.7 ? inn : side).push(t); }
    function sub(list) { if (!list.length) return null; var n = list.length * 3, P = new Float32Array(n * 3), N = new Float32Array(n * 3); var k = 0;
      list.forEach(function (t) { for (var j = 0; j < 3; j++) { P[k * 3] = p.getX(t + j); P[k * 3 + 1] = p.getY(t + j); P[k * 3 + 2] = p.getZ(t + j); N[k * 3] = nr.getX(t + j); N[k * 3 + 1] = nr.getY(t + j); N[k * 3 + 2] = nr.getZ(t + j); k++; } });
      var r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2)); return r; }
    var res = { out: sub(out), inn: sub(inn), side: sub(side) }; g.dispose(); return res; }
  // a wall in the local frame: m4 maps the wall frame (a along +x, y up, outside face at z = depth) into the venue frame
  function wallAt(K, outline, holes, depth, m4, bOut, cOut, bIn, cIn, bSide, cSide, t, grm) { var W = wallGeo(outline, holes, depth);
    [["out", bOut, cOut], ["inn", bIn, cIn], ["side", bSide || bOut, cSide || cOut]].forEach(function (q) { var g = W[q[0]]; if (!g || !q[1]) { if (g) g.dispose(); return; } g.applyMatrix4(m4); uvWorld(g, t || 2.5, "auto"); colorize(g, q[2] === undefined ? 0xffffff : q[2]); if (grm && q[0] !== "inn") grime(g, grm[0], grm[1], grm[2]); K.add(q[1], g); }); }
  // wall frames: along local +x at z = c (outside toward +z: dir 1) or along local +z at x = c (outside toward +x: dir 1)
  function m4X(c, dir, depth) { var m = new THREE.Matrix4(); if (dir > 0) m.makeTranslation(0, 0, c - depth); else { m.makeRotationY(PI); m.premultiply(new THREE.Matrix4().makeTranslation(0, 0, c + depth)); } return m; }
  function m4Z(c, dir, depth) { var m = new THREE.Matrix4(); if (dir > 0) { m.makeRotationY(HP); m.premultiply(new THREE.Matrix4().makeTranslation(c - depth, 0, 0)); } else { m.makeRotationY(-HP); m.premultiply(new THREE.Matrix4().makeTranslation(c + depth, 0, 0)); } return m; }
  function quad(K, b, col, A, B, Cc, D, uvA, uvB, uvC, uvD) { var g = new THREE.BufferGeometry(); var P = [A, B, Cc, A, Cc, D], U = [uvA, uvB, uvC, uvA, uvC, uvD]; var pa = new Float32Array(18), ua = new Float32Array(12); for (var i = 0; i < 6; i++) { pa[i * 3] = P[i][0]; pa[i * 3 + 1] = P[i][1]; pa[i * 3 + 2] = P[i][2]; ua[i * 2] = U[i][0]; ua[i * 2 + 1] = U[i][1]; } g.setAttribute("position", new THREE.BufferAttribute(pa, 3)); g.setAttribute("uv", new THREE.BufferAttribute(ua, 2)); g.computeVertexNormals(); return K.add(b, g, col); }
  // an arch ring (archivolt) in a wall plane: the face of a half annulus, extruded `depth` toward +z, at the wall's z
  function archRing(K, b, col, cx, ys, r0, r1, depth, m4, seg) { var s = new THREE.Shape(), i, a; seg = seg || 16; s.moveTo(cx + r1, ys); for (i = 0; i <= seg; i++) { a = i / seg * PI; s.lineTo(cx + Math.cos(a) * r1, ys + Math.sin(a) * r1); } for (i = seg; i >= 0; i--) { a = i / seg * PI; s.lineTo(cx + Math.cos(a) * r0, ys + Math.sin(a) * r0); } s.closePath();
    var g = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: false, curveSegments: 1 }); if (g.index) g = g.toNonIndexed(); g.computeVertexNormals(); if (m4) g.applyMatrix4(m4); uvWorld(g, 1.0, "auto"); colorize(g, col); return K.add(b, g); }
  // turn a non-indexed geometry inside out (winding and normals), for surfaces seen from inside (vaults)
  function flipGeo(g) { var p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv; for (var k = 0; k < p.count; k += 3) { [p, n, uv].forEach(function (a) { if (!a) return; for (var c = 0; c < a.itemSize; c++) { var t = a.array[(k + 1) * a.itemSize + c]; a.array[(k + 1) * a.itemSize + c] = a.array[(k + 2) * a.itemSize + c]; a.array[(k + 2) * a.itemSize + c] = t; } }); } for (var i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i)); p.needsUpdate = true; n.needsUpdate = true; return g; }

  // ───────────────────────── textures: tex/mc_* (KTX2 on the desktop tier through the client's R6 path, _m JPEGs on the low tier) ─────────────────────────
  var TX = MC.tx = MC.tx || {}; var TL = null;
  var KTXN = ["mc_stucco", "mc_stucco_n", "mc_stucco_r", "mc_cantera", "mc_cantera_n", "mc_cantera_r", "mc_paving", "mc_paving_n", "mc_paving_r", "mc_saltillo", "mc_saltillo_n", "mc_saltillo_r", "mc_paint", "mc_paint_n", "mc_paint_r", "mc_talavera", "mc_talavera_n", "mc_talavera_r", "mc_awning", "mc_goods1", "mc_goods2", "mc_mural"];
  function ktxOn() { if (MC.ktx !== undefined) return MC.ktx; MC.ktx = false; try { if (!lowTier() && !/[?&]mcktx=0\b/.test(location.search)) { var S0 = (0, eval)("R6KTX"); if (S0 && S0.add) { KTXN.forEach(function (n) { S0.add(n); }); MC.ktx = true; } } } catch (e) {} return MC.ktx; }
  function aniso() { var q = qual(); try { return Math.min(q === "ultra" ? 16 : q === "high" ? 8 : 4, MAX_ANISO || 8); } catch (e) { return 8; } }
  // own textures (mc_*): the _m copy on the low tier (albedo only; the low tier skips our normal and roughness maps); repo textures: the client picks the tier
  function tex(name, srgb, own, rep, ext) { ktxOn(); if (own !== false && lowTier() && /_(n|r)$/.test(name)) return null;
    var url = "/tex/" + name + (own !== false && lowTier() ? "_m" : "") + "." + (ext || "jpg"), k = url + (srgb ? ":s" : ":l");
    if (TX[k]) return TX[k]; TL = TL || new THREE.TextureLoader(); var t = TL.load(au(url), function () { cnt("texOk"); }, undefined, function () { note("tex", url); }); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; if (rep !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso(); t.name = "mc_" + name; t.userData.avShared = true; return (TX[k] = t); }
  function dataTex(r, g, b, srgb) { var k = "data:" + r + "," + g + "," + b + (srgb ? "s" : ""); if (TX[k]) return TX[k]; var d = new Uint8Array([r, g, b, 255]); var t = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; t.userData.avShared = true; return (TX[k] = t); }
  function cvs(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function canvasTex(key, W, H, fn, srgb, rep) { if (TX[key]) return TX[key]; var c = cvs(W, H), x = c.getContext("2d"); try { fn(x, W, H); } catch (e) { note("canvas " + key, e); } var t = new THREE.CanvasTexture(c); t.colorSpace = srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso(); t.needsUpdate = true; t.userData.avShared = true; t.userData.canvas = c; t.userData.draw = fn; return (TX[key] = t); }
  // canvases with lettering are drawn again once the web fonts are in (the first draw may have used the fallback faces)
  function redrawCanvas(t) { try { var c = t.userData.canvas, x = c.getContext("2d"); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); t.userData.draw(x, c.width, c.height); t.needsUpdate = true; } catch (e) { note("redraw", e); } }
  var FT = { serif: "Georgia, 'Times New Roman', serif", ui: "'Space Grotesk', 'Segoe UI', system-ui, sans-serif", disp: "'Fraunces', Georgia, serif", anton: "'Anton', Impact, 'Arial Narrow', sans-serif", mono: "'JetBrains Mono', Consolas, monospace" };
  function txt(x, t, px, py, font, color, ls, align, maxW) { x.font = font; x.fillStyle = color; x.textAlign = align || "center"; x.textBaseline = "middle"; try { x.letterSpacing = (ls || 0) + "px"; } catch (e) {}
    if (maxW) { var w = x.measureText(t).width; if (w > maxW) { x.save(); x.translate(px, py); x.scale(maxW / w, 1); x.fillText(t, 0, 0); x.restore(); try { x.letterSpacing = "0px"; } catch (e) {} return; } } x.fillText(t, px, py); try { x.letterSpacing = "0px"; } catch (e) {} }
  function wrapLines(x, text, maxW) { var words = String(text).split(/\s+/), lines = [], cur = ""; words.forEach(function (w) { var t = cur ? cur + " " + w : w; if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }); if (cur) lines.push(cur); return lines; }

  // ───────────────────────── one material family: standard + map + normal + roughness + vertex colours + the shared patch ─────────────────────────
  // The patch text is the Expanse Library's (plan_library.js, R17 Agent K) byte for byte, so every material here shares its programs
  // (three keys a program by the onBeforeCompile source): a detail normal layer that fades in within a few metres. uIn stays 0 (outdoors).
  var GU = MC.gu = MC.gu || { uAmb: { value: 0.34 }, uHouse: { value: 0.05 }, uNight: { value: 0 } };
  var LB_FS_HEAD = "uniform float uLbIn; uniform float uLbAmb; uniform float uLbHouse; uniform sampler2D tLbDet; uniform vec2 uLbDet;\n";
  var LB_FS_DET = "mapN.xy *= normalScale;\n{ float lbk = uLbDet.y * (1.0 - smoothstep(3.0, 16.0, length(vViewPosition))); vec3 lbn = texture2D(tLbDet, vNormalMapUv * uLbDet.x).xyz * 2.0 - 1.0; mapN.xy += lbn.xy * lbk; }\n";
  var LB_FS_IND = "{ float lbi = uLbIn; reflectedLight.indirectDiffuse *= mix(1.0, uLbAmb, lbi); reflectedLight.indirectSpecular *= mix(1.0, uLbAmb * 0.8, lbi); reflectedLight.indirectDiffuse += material.diffuseColor * vec3(1.0, 0.86, 0.7) * uLbHouse * lbi; }\n";
  function lbObc(shader) {
    var ud = this.userData || {}; shader.uniforms.uLbIn = ud.uIn || { value: 0 }; shader.uniforms.uLbAmb = GU.uAmb; shader.uniforms.uLbHouse = GU.uHouse; shader.uniforms.tLbDet = { value: ud.det || dataTex(128, 128, 255) }; shader.uniforms.uLbDet = { value: ud.detK || new THREE.Vector2(1, 0) };
    var fs = shader.fragmentShader.replace("#include <common>", "#include <common>\n" + LB_FS_HEAD);
    var nfm = THREE.ShaderChunk.normal_fragment_maps; if (nfm.indexOf("mapN.xy *= normalScale;") >= 0) fs = fs.replace("#include <normal_fragment_maps>", nfm.replace("mapN.xy *= normalScale;", LB_FS_DET));
    fs = fs.replace("#include <aomap_fragment>", LB_FS_IND + "#include <aomap_fragment>"); shader.fragmentShader = fs; }
  var MX = MC.mx = MC.mx || {};
  function famMat(key, o) {
    if (MX[key]) return MX[key];
    var p = { map: o.map || dataTex(255, 255, 255, true), normalMap: o.nmap || dataTex(128, 128, 255), roughnessMap: o.rmap || dataTex(255, 255, 255), roughness: o.r === undefined ? 0.85 : o.r, metalness: o.m || 0, vertexColors: true, color: o.color === undefined ? 0xffffff : o.color };
    if (o.emissive !== undefined) { p.emissive = new THREE.Color(o.emissive); p.emissiveIntensity = o.ei === undefined ? 1 : o.ei; }
    if (o.alphaTest) { p.alphaTest = o.alphaTest; p.side = THREE.DoubleSide; }
    if (o.emap) p.emissiveMap = o.emap; if (o.ds) p.side = THREE.DoubleSide;
    if (o.transparent) { p.transparent = true; p.opacity = o.opacity === undefined ? 0.3 : o.opacity; p.depthWrite = false; }
    var m = new THREE.MeshStandardMaterial(p); if (o.ns) m.normalScale.set(o.ns, o.ns); if (o.env !== undefined) m.envMapIntensity = o.env;
    if (o.po) { m.polygonOffset = true; m.polygonOffsetFactor = o.po; m.polygonOffsetUnits = o.po; }
    m.userData.uIn = { value: 0 }; m.userData.det = o.det || null; m.userData.detK = new THREE.Vector2(o.detS || 1, o.det ? (o.detK === undefined ? 0.5 : o.detK) : 0);
    m.onBeforeCompile = lbObc; m.userData.avShared = true; m.name = "mc " + key; return (MX[key] = m); }
  function addMat(key, o) { if (MX[key]) return MX[key]; var m = new THREE.MeshBasicMaterial({ map: o.map || null, color: o.color === undefined ? 0xffffff : o.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, opacity: o.opacity === undefined ? 1 : o.opacity, side: o.side || THREE.FrontSide, fog: true }); m.userData.avShared = true; m.name = "mc " + key; return (MX[key] = m); }
  function det(n) { return tex("rl_det_" + n, false, false, true, "png"); }
  // the papel picado: tissue flags (alpha cut-outs), lit through by the sun, swaying on the string (vertex shader; one program)
  var PAPEL = MC.papelU = MC.papelU || { uT: { value: 0 }, uWind: { value: 1 } };
  function papelObc(shader) { shader.uniforms.uMcT = PAPEL.uT; shader.uniforms.uMcWind = PAPEL.uWind;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uMcT; uniform float uMcWind; attribute vec4 mcSway;").replace("#include <begin_vertex>", "#include <begin_vertex>\n{ float ph = mcSway.x; float k = mcSway.y; float sw = sin(uMcT * (1.6 + fract(ph * 0.37) * 0.8) + ph) * 0.6 + sin(uMcT * 3.1 + ph * 1.7) * 0.25; transformed.xz += mcSway.zw * (sw * k * 0.16 * uMcWind); transformed.y += abs(sw) * k * 0.025 * uMcWind; }");
    shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.07;"); }
  function papelMat() { if (MX.papel) return MX.papel; var m = new THREE.MeshStandardMaterial({ map: tex("mc_papel", true, true, false, "png"), alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.9, metalness: 0 });
    m.onBeforeCompile = papelObc; m.userData.avShared = true; m.name = "mc papel"; return (MX.papel = m); }

  function mats() {
    if (MX._ok) return MX; MX._ok = true;
    var lo = lowTier();
    var st = { map: tex("mc_stucco", true), nmap: tex("mc_stucco_n", false), rmap: tex("mc_stucco_r", false) };
    var ca = { map: tex("mc_cantera", true), nmap: tex("mc_cantera_n", false), rmap: tex("mc_cantera_r", false) };
    var pv = { map: tex("mc_paving", true), nmap: tex("mc_paving_n", false), rmap: tex("mc_paving_r", false) };
    var sa = { map: tex("mc_saltillo", true), nmap: tex("mc_saltillo_n", false), rmap: tex("mc_saltillo_r", false) };
    var pa = { map: tex("mc_paint", true), nmap: tex("mc_paint_n", false), rmap: tex("mc_paint_r", false) };
    var ta = { map: tex("mc_talavera", true), nmap: tex("mc_talavera_n", false), rmap: tex("mc_talavera_r", false) };
    var tile = { map: tex("tile", true, false), nmap: tex("tile_n", false, false), rmap: tex("tile_r", false, false) };
    var wood = { map: tex("wood", true, false), nmap: tex("wood_n", false, false), rmap: tex("wood_r", false, false) };
    var dP = lo ? null : det("plaster"), dW = lo ? null : det("wood"), dS = lo ? null : det("stone"), dM = lo ? null : det("metal"), dF = lo ? null : det("fabric");
    famMat("stucco", { map: st.map, nmap: st.nmap, rmap: st.rmap, r: 1, ns: 0.9, det: dP, detS: 6, detK: 0.45 });
    famMat("cantera", { map: ca.map, nmap: ca.nmap, rmap: ca.rmap, r: 1, ns: 0.9, det: dS, detS: 5, detK: 0.4 });
    var dgt = { map: tex("terrazzo", true, false), nmap: tex("terrazzo_n", false, false), rmap: tex("terrazzo_r", false, false) };
    famMat("dg", { map: dgt.map, nmap: dgt.nmap, rmap: dgt.rmap, r: 1, ns: 0.9, color: 0xe2c9a4, det: dS, detS: 6, detK: 0.35 });
    famMat("paving", { map: pv.map, nmap: pv.nmap, rmap: pv.rmap, r: 1, ns: 0.9, det: dS, detS: 6, detK: 0.4 });
    famMat("saltillo", { map: sa.map, nmap: sa.nmap, rmap: sa.rmap, r: 1, ns: 0.8, det: dS, detS: 6, detK: 0.25 });
    famMat("salOv", { map: sa.map, nmap: sa.nmap, rmap: sa.rmap, r: 1, ns: 0.8, det: dS, detS: 6, detK: 0.25, po: -2 });
    famMat("paint", { map: pa.map, nmap: pa.nmap, rmap: pa.rmap, r: 1, ns: 0.8, det: dW, detS: 4, detK: 0.3 });
    famMat("talavera", { map: ta.map, nmap: ta.nmap, rmap: ta.rmap, r: 1, ns: 0.7, env: 1.2 });
    famMat("tile", { map: tile.map, nmap: tile.nmap, rmap: tile.rmap, r: 1, ns: 1.0 });
    famMat("wood", { map: wood.map, nmap: wood.nmap, rmap: wood.rmap, r: 1, ns: 0.8, det: dW, detS: 4, detK: 0.35 });
    famMat("iron", { r: 0.55, m: 0.75, color: 0xffffff, det: dM, detS: 3, detK: 0.4 });
    famMat("enamel", { r: 0.42, m: 0.2, color: 0xffffff, det: dM, detS: 3, detK: 0.25 });   // painted sheet metal: the kiosco dome, the carts, the tin
    famMat("tin", { r: 0.28, m: 0.95, color: 0xffffff, det: dM, detS: 2, detK: 0.35, emissive: 0xffb257, ei: 0 });   // punched tin lanterns (glow at night)
    famMat("cloth", { r: 0.92, det: dF, detS: 6, detK: 0.45 });
    famMat("awning", { map: tex("mc_awning", true), nmap: tex("mc_awning_n", false), r: 0.95, ns: 0.6, det: dF, detS: 6, detK: 0.35 });
    famMat("goods1", { map: tex("mc_goods1", true), r: 0.88 });
    famMat("goods2", { map: tex("mc_goods2", true), r: 0.88 });
    famMat("mural", { map: tex("mc_mural", true), r: 0.9, det: dP, detS: 6, detK: 0.35 });
    famMat("wallsign", { map: wallTex(), r: 0.95, det: dP, detS: 6, detK: 0.45 });
    famMat("signs", { map: signTex(), r: 0.6, emissive: 0xffffff, ei: 0, emap: signTex() });
    famMat("food", { r: 0.62, m: 0, color: 0xffffff });   // bread, corn, fruit, the trompo
    famMat("lamp", { r: 0.4, emissive: 0xffc06a, ei: 0.0, color: 0xfff1d8 });   // bulbs and globes (night)
    famMat("glowK", { r: 0.5, emissive: 0xff7a2a, ei: 0.0, color: 0x2a1a10 });  // the al pastor burner, the bakery oven mouth
    famMat("water", { r: 0.05, m: 0.0, color: 0x2a4a52, env: 1.7, nmap: rippleTex(), ns: 0.35 });
    famMat("glass", { r: 0.05, m: 0.0, transparent: true, opacity: 0.26, color: 0xa8bcc2, env: 1.4, ds: true });
    famMat("drink", { r: 0.08, m: 0.0, transparent: true, opacity: 0.72, color: 0xffffff, env: 1.1, ds: true });
    famMat("veil", { map: veilTex(), r: 0.12, transparent: true, opacity: 0.62, color: 0xf2f8ff, ds: true, emissive: 0xffffff, ei: 0.12, env: 1.6 });   // falling water sheets (streaks scroll down)
    papelMat();
    addMat("pool", { map: poolTex() }); addMat("halo", { map: poolTex() });
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ["signs", "wall"].forEach(function (k) { if (TX[k]) redrawCanvas(TX[k]); }); cnt("fontRedraw"); }); } catch (e) {}
    return MX; }
  // soft round pool (light on floors and walls, glows)
  function poolTex() { return canvasTex("pool", 128, 128, function (x, W, H) { var g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,0.55)"); g.addColorStop(0.7, "rgba(255,255,255,0.14)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, W, H); }); }
  // a tiling ripple normal map for the fountain basin (scrolled in the frame hook)
  function rippleTex() { return canvasTex("ripple", 256, 256, function (x, W, H) { var img = x.createImageData(W, H), d = img.data, R = rng(17), waves = []; for (var i = 0; i < 9; i++) waves.push([Math.floor(R() * 4) + 1, Math.floor(R() * 4) - 2, R() * TAU, 0.4 + R() * 0.6]);
      for (var j = 0; j < H; j++) for (var i2 = 0; i2 < W; i2++) { var dx = 0, dy = 0; for (var k = 0; k < waves.length; k++) { var w = waves[k], ph = (w[0] * i2 / W + w[1] * j / H) * TAU + w[2], c = Math.cos(ph) * w[3]; dx += c * w[0]; dy += c * w[1]; } var nx = clamp(-dx * 0.05, -1, 1), ny = clamp(-dy * 0.05, -1, 1), o = (j * W + i2) * 4; d[o] = 128 + nx * 127; d[o + 1] = 128 + ny * 127; d[o + 2] = 255; d[o + 3] = 255; }
      x.putImageData(img, 0, 0); }, false, true); }
  function veilTex() { var t = canvasTex("veil", 128, 256, function (x, W, H) { x.clearRect(0, 0, W, H); var R = rng(23); for (var i = 0; i < 70; i++) { var cx = R() * W, w = 1 + R() * 4, a = 0.12 + R() * 0.45, g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(235,245,255," + (a * 0.6).toFixed(3) + ")"); g.addColorStop(R() * 0.8 + 0.1, "rgba(255,255,255," + a.toFixed(3) + ")"); g.addColorStop(1, "rgba(225,240,250," + (a * 0.5).toFixed(3) + ")"); x.fillStyle = g; x.fillRect(cx, 0, w, H); if (cx + w > W) x.fillRect(cx - W, 0, w, H); } x.fillStyle = "rgba(255,255,255,0.03)"; x.fillRect(0, 0, W, H); }, true, true); t.repeat.set(5, 1); return t; }

  // ───────────────────────── the sign atlas: stall boards (rotulos), the gateway lettering, the food row signs, chalk menus, plaques ─────────────────────────
  var SA = { W: 2048, H: 1024, r: {} };
  (function () { for (var i = 0; i < 24; i++) SA.r["b" + i] = [(i % 4) * 512 + 16, Math.floor(i / 4) * 100 + 6, 480, 88];
    SA.r.gate = [0, 604, 1020, 150]; SA.r.casa = [1028, 604, 1020, 150];
    for (var j = 0; j < 4; j++) SA.r["food" + j] = [j * 512 + 8, 760, 496, 120];
    for (var k = 0; k < 4; k++) SA.r["menu" + k] = [k * 256 + 4, 888, 248, 130];
    SA.r.plaque = [1028, 888, 500, 130]; SA.r.kiosco = [1540, 888, 500, 130]; })();
  function sUV(k) { var r = SA.r[k]; if (!r) return [0, 0, 0.01, 0.01]; return [r[0] / SA.W, 1 - (r[1] + r[3]) / SA.H, (r[0] + r[2]) / SA.W, 1 - r[1] / SA.H]; }
  function frameIn(x, X, Y, W, H, col, lw, inset) { x.strokeStyle = col; x.lineWidth = lw; x.strokeRect(X + inset, Y + inset, W - inset * 2, H - inset * 2); }
  // a hand-painted board: style "rotulo" (bright ground, bold letters with a drop shadow), "wood" (painted plank), "tin" (enamel on tin)
  function board(x, r, title, sub, st) { var X = r[0], Y = r[1], W = r[2], H = r[3]; st = st || {}; var bg = st.bg || "#1f4f7a", fg = st.fg || "#f6e7c4", sh = st.sh || "rgba(0,0,0,0.55)";
    x.save(); x.beginPath(); x.rect(X, Y, W, H); x.clip();
    x.fillStyle = bg; x.fillRect(X, Y, W, H);
    var R = rng(X * 7 + Y * 13); for (var i = 0; i < 60; i++) { x.fillStyle = "rgba(255,255,255," + (R() * 0.05).toFixed(3) + ")"; x.fillRect(X + R() * W, Y + R() * H, 20 + R() * 80, 2 + R() * 3); }   // brush streaks
    if (st.wood) { for (var j = 0; j < 4; j++) { x.fillStyle = "rgba(0,0,0,0.18)"; x.fillRect(X, Y + (j + 1) * H / 4.2, W, 2); } }
    x.fillStyle = "rgba(0,0,0,0.12)"; x.fillRect(X, Y + H - 8, W, 8);
    frameIn(x, X, Y, W, H, st.edge || fg, 4, 6);
    var big = sub ? H * 0.5 : H * 0.62, fnt = st.font || ("700 " + Math.round(big) + "px " + FT.serif);
    x.shadowColor = sh; x.shadowOffsetX = 3; x.shadowOffsetY = 3; x.shadowBlur = 2;
    txt(x, title, X + W / 2, Y + (sub ? H * 0.4 : H * 0.53), fnt.replace(/\d+px/, Math.round(big) + "px"), fg, st.ls || 3, "center", W - 44);
    if (sub) { x.shadowOffsetX = 2; x.shadowOffsetY = 2; txt(x, sub, X + W / 2, Y + H * 0.77, "600 " + Math.round(H * 0.19) + "px " + FT.ui, st.fg2 || fg, 4, "center", W - 60); }
    x.restore(); }
  function chalkMenu(x, r, title, lines) { var X = r[0], Y = r[1], W = r[2], H = r[3]; x.save(); x.beginPath(); x.rect(X, Y, W, H); x.clip(); x.fillStyle = "#1d2622"; x.fillRect(X, Y, W, H); var R = rng(X + 31); for (var i = 0; i < 80; i++) { x.fillStyle = "rgba(255,255,255," + (R() * 0.06).toFixed(3) + ")"; x.fillRect(X + R() * W, Y + R() * H, 10 + R() * 40, 3); }
    frameIn(x, X, Y, W, H, "#7a5a36", 8, 4); txt(x, title, X + W / 2, Y + 24, "italic 700 24px " + FT.serif, "#f4ecd2", 1, "center", W - 30);
    lines.slice(0, 4).forEach(function (l, i) { txt(x, l, X + W / 2, Y + 54 + i * 19, "500 15px " + FT.ui, i % 2 ? "#f6d58a" : "#e9f0e4", 1, "center", W - 28); }); x.restore(); }
  function plaque(x, r, title, sub) { var X = r[0], Y = r[1], W = r[2], H = r[3]; var g = x.createLinearGradient(X, Y, X + W, Y + H); g.addColorStop(0, "#6b4a22"); g.addColorStop(0.5, "#a3793a"); g.addColorStop(1, "#5c3e1c"); x.fillStyle = g; x.fillRect(X, Y, W, H);
    frameIn(x, X, Y, W, H, "#d9b46a", 4, 6); frameIn(x, X, Y, W, H, "#3a2610", 2, 14); x.shadowColor = "rgba(0,0,0,0.6)"; x.shadowOffsetY = 2; txt(x, title, X + W / 2, Y + H * 0.4, "700 " + Math.round(H * 0.3) + "px " + FT.serif, "#f4dfae", 3, "center", W - 40); if (sub) txt(x, sub, X + W / 2, Y + H * 0.74, "italic 500 " + Math.round(H * 0.17) + "px " + FT.serif, "#e9cf96", 1, "center", W - 50); x.shadowColor = "transparent"; }
  // the gateway's raised letters: cream cantera on a talavera-blue ground with gold leaf lines
  function gateBoard(x, r, title, sub) { var X = r[0], Y = r[1], W = r[2], H = r[3]; x.fillStyle = "#1c3f78"; x.fillRect(X, Y, W, H); x.fillStyle = "#e9c46a"; x.fillRect(X + 10, Y + 10, W - 20, 4); x.fillRect(X + 10, Y + H - 14, W - 20, 4);
    for (var i = 0; i < 18; i++) { var cx = X + 40 + i * (W - 80) / 17; x.fillStyle = i % 2 ? "#e9c46a" : "#f3ead2"; x.beginPath(); x.arc(cx, Y + 26, 4, 0, TAU); x.fill(); x.beginPath(); x.arc(cx, Y + H - 26, 4, 0, TAU); x.fill(); }
    x.shadowColor = "rgba(0,0,0,0.65)"; x.shadowOffsetX = 4; x.shadowOffsetY = 5; x.shadowBlur = 3; txt(x, title, X + W / 2, Y + H * 0.47, "400 " + Math.round(H * 0.5) + "px " + FT.anton, "#f6eedb", 14, "center", W - 90);
    x.shadowOffsetX = 2; x.shadowOffsetY = 2; if (sub) txt(x, sub, X + W / 2, Y + H * 0.8, "600 " + Math.round(H * 0.12) + "px " + FT.ui, "#e9c46a", 10, "center", W - 120); x.shadowColor = "transparent"; }
  // painted lettering straight on the wall (ochre stucco ground, dark red letters with a cream outline), 12 x 1.76 m
  function wallBoard(x, r, title, sub) { var X = r[0], Y = r[1], W = r[2], H = r[3]; x.save(); x.beginPath(); x.rect(X, Y, W, H); x.clip(); x.fillStyle = "#d29b48"; x.fillRect(X, Y, W, H); x.lineJoin = "round";
    x.font = "400 " + Math.round(H * 0.62) + "px " + FT.anton; x.textAlign = "center"; x.textBaseline = "middle"; try { x.letterSpacing = Math.round(H * 0.12) + "px"; } catch (e) {} x.strokeStyle = "#f3e6c8"; x.lineWidth = Math.max(2, H * 0.07); x.strokeText(title, X + W / 2, Y + H * 0.4); x.fillStyle = "#7a1f1a"; x.fillText(title, X + W / 2, Y + H * 0.4);
    try { x.letterSpacing = Math.round(H * 0.05) + "px"; } catch (e) {} if (sub) { x.font = "700 " + Math.round(H * 0.15) + "px " + FT.ui; x.fillStyle = "#3a2410"; x.fillText(sub, X + W / 2, Y + H * 0.84); } try { x.letterSpacing = "0px"; } catch (e) {} x.restore(); }
  function wallTex() { var lo = lowTier(); return canvasTex("wall", lo ? 512 : 1024, lo ? 80 : 160, function (x, W, H) { wallBoard(x, [0, 0, W, H], C("names.wall", "MERCADO PLAZA"), C("names.wallSub", "")); }); }
  var SIGN_DRAW = [];
  function signTex() { return canvasTex("signs", lowTier() ? 1024 : SA.W, lowTier() ? 512 : SA.H, function (x, W, H) { var k = W / SA.W; x.scale(k, k); x.fillStyle = "#3a2a1c"; x.fillRect(0, 0, SA.W, SA.H);
      SIGN_DRAW.forEach(function (f) { try { x.save(); f(x); x.restore(); } catch (e) { note("sign", e); } }); }); }

  // ───────────────────────── colours, the stalls and the people (defaults; plan/mercado.json overrides copy) ─────────────────────────
  var COL = { cant: [1, 0.97, 0.95], cantD: [0.74, 0.66, 0.62], st: [1, 1, 1], ochre: [0.86, 0.64, 0.33], terra: [0.78, 0.4, 0.29], indigo: [0.3, 0.42, 0.7], white: [0.96, 0.95, 0.92], cream: [0.95, 0.9, 0.8],
    rosa: [0.84, 0.36, 0.5], mango: [0.95, 0.72, 0.28], verde: [0.36, 0.6, 0.44], azul: [0.28, 0.48, 0.78], lila: [0.62, 0.5, 0.74], turq: [0.3, 0.68, 0.7], cal: [0.97, 0.95, 0.9],
    iron: [0.08, 0.075, 0.07], ironW: [0.93, 0.92, 0.88], wood: [0.62, 0.45, 0.32], woodD: [0.42, 0.3, 0.21], viga: [0.55, 0.4, 0.28], soil: [0.32, 0.24, 0.18], dome: [0.6, 0.76, 0.68], gold: [0.86, 0.66, 0.3], sal: [1, 1, 1] };
  // stall rows: the Portal Norte west to east (bays 0..8, the Casa de la Cultura in 3..5), the Portal Oriente north to south (0..10, the gateway at 5)
  var NORTE = [
    { k: "panel", id: "juguetes", sheet: "goods2", panel: 2, name: "Juguetes", sub: "de madera y de trapo", wall: "azul", bd: { bg: "#c2410c", fg: "#fff3d6" }, info: "juguetes" },
    { k: "panel", id: "sarapes", sheet: "goods1", panel: 1, name: "Sarapes", sub: "de Saltillo", wall: "rosa", bd: { bg: "#7a1f3d", fg: "#ffe9b8" }, shop: "sarapes", vendor: "ramon", stacks: true },
    { k: "panel", id: "talavera", sheet: "goods1", panel: 0, name: "Talavera", sub: "loza de Puebla", wall: "cal", bd: { bg: "#1d3f7a", fg: "#f4ead4" }, info: "talavera", pots: true },
    { k: "casa" }, { k: "casa" }, { k: "casa" },
    { k: "panel", id: "hojalata", sheet: "goods1", panel: 2, name: "Hojalata", sub: "faroles y estrellas", wall: "turq", bd: { bg: "#2b2b2b", fg: "#e9e2cf" }, info: "hojalata", lanterns: true },
    { k: "panel", id: "pinatas", sheet: "goods1", panel: 3, name: "Piñatas", sub: "de siete picos", wall: "mango", bd: { bg: "#b0186e", fg: "#fff0c8" }, info: "pinatas", pinatas: true },
    { k: "panel", id: "dulces", sheet: "goods2", panel: 1, name: "Dulces Típicos", sub: "cocadas, jamoncillo, tamarindo", wall: "verde", bd: { bg: "#1f6b45", fg: "#fff3d6" }, shop: "dulces" }
  ];
  var ORIENTE = [
    { k: "coffee", id: "cafe", name: "Café de Olla", sub: "canela y piloncillo", wall: "terra", bd: { bg: "#3b2414", fg: "#f3dcae" }, shop: "cafe" },
    { k: "fonda", id: "fonda", span: 2, name: "Fonda Doña Chela", sub: "comida corrida", wall: "mango", bd: { bg: "#1d3f7a", fg: "#ffe9b8" }, shop: "fonda" }, null,
    { k: "flores", id: "flores", name: "Flores", sub: "de temporada", wall: "lila", bd: { bg: "#3f6b2a", fg: "#fff3d6" }, info: "flores" },
    { k: "hats", id: "sombreros", name: "Sombreros", sub: "texanas y de palma", wall: "cal", bd: { bg: "#5a3a1e", fg: "#f6e2b4" }, shop: "sombreros" },
    { k: "gate" },
    { k: "ristras", id: "chiles", name: "Chiles y Especias", sub: "ristras de Sonora", wall: "ochre", bd: { bg: "#9a1c1c", fg: "#ffe9b8" }, info: "chiles" },
    { k: "candles", id: "velas", name: "Velas", sub: "de cera", wall: "azul", bd: { bg: "#2c2a4a", fg: "#f4e3b0" }, info: "velas" },
    { k: "panel", id: "barro", sheet: "goods2", panel: 3, name: "Barro", sub: "cántaros y ollas", wall: "terra", bd: { bg: "#6b3a1f", fg: "#f6e2b4" }, info: "barro", pots: true },
    { k: "closed", id: "cerrado", wall: "verde" },
    { k: "paletas", id: "paletas", name: "Paletería", sub: "paletas y nieves", wall: "rosa", bd: { bg: "#e9f2f6", fg: "#c2185b", sh: "rgba(0,0,0,0.2)" }, shop: "paletas" }
  ];
  // the food row along the south edge (local x, the stall's centre), facing the square
  var FOOD = [
    { id: "tacos", x: -13.75, name: "Tacos al Pastor", sub: "Don Beto", awn: 0, bd: { bg: "#b3261e", fg: "#fff2c6" }, shop: "tacos", vendor: "beto", k: "trompo" },
    { id: "elotes", x: -9.25, name: "Elotes y Esquites", sub: "con todo", awn: 3, bd: { bg: "#e8a91c", fg: "#3a1f06", sh: "rgba(255,255,255,0.35)" }, shop: "elotes", vendor: "paty", k: "elote" },
    { id: "aguas", x: 11.25, name: "Aguas Frescas", sub: "horchata, jamaica, tamarindo", awn: 1, bd: { bg: "#1f7a4a", fg: "#fff3d6" }, shop: "aguas", vendor: "cuca", k: "aguas" },
    { id: "churros", x: 15.75, name: "Churros", sub: "con cajeta", awn: 2, bd: { bg: "#3a2a7a", fg: "#ffe2a8" }, shop: "churros", vendor: "chema", k: "churros" }
  ];
  // the shops: rows are the server's own items (coffee: +40 energy, meal: energy back to 100, a few wearables) under their mercado names
  var SHOPS_D = {
    tacos: { title: "Tacos al Pastor Don Beto", k: "Al pastor off the trompo, pineapple on top", rows: [["coffee", "Taco al pastor", "Corn tortilla, cilantro, onion, a sliver of pineapple"], ["meal", "Orden de tacos (five)", "With salsa roja, salsa verde and limes"]] },
    elotes: { title: "Elotes y Esquites Paty", k: "Roasted corn, the border way", rows: [["coffee", "Elote asado", "On the stick, mayonesa, queso, chile and lime"], ["coffee", "Esquites en vaso", "Corn off the cob in a cup, with epazote"]] },
    aguas: { title: "Aguas Frescas Doña Cuca", k: "Cold from the vitroleros", rows: [["coffee", "Horchata", "Rice, cinnamon and vanilla"], ["coffee", "Agua de jamaica", "Hibiscus flower, not too sweet"], ["coffee", "Agua de tamarindo", "Sweet and sour, over ice"]] },
    churros: { title: "Churros Chema", k: "Fried to order", rows: [["coffee", "Churros con azúcar", "Three, rolled in cinnamon sugar"], ["coffee", "Churro relleno de cajeta", "Goat milk caramel inside"]] },
    pan: { title: "Panadería El Mirador", k: "Pan dulce from the morning bake", rows: [["coffee", "Concha y café", "A pink concha and a cup of cafe de olla"], ["meal", "Caja de pan dulce", "Conchas, orejas, marranitos, cuernos and an empanada"]] },
    cafe: { title: "Café de Olla", k: "Brewed in clay with cinnamon and piloncillo", rows: [["coffee", "Café de olla", "In a clay jarrito"]] },
    fonda: { title: "Fonda Doña Chela", k: "Comida corrida, served at the tables in the portal", rows: [["meal", "Comida corrida", "Sopa, guisado of the day, beans, rice and flour tortillas"], ["coffee", "Gorditas de harina", "Two, filled with machaca"]] },
    paletas: { title: "Paletería", k: "Frozen fruit on a stick", rows: [["coffee", "Paleta de mango con chile", "Mango, chile and lime"], ["coffee", "Nieve de garrafa", "Hand-churned, lime or tuna"]] },
    dulces: { title: "Dulces Típicos", k: "Sweets by the piece", rows: [["coffee", "Bolsa de dulces", "Cocadas, jamoncillo and tamarindo"]] },
    sarapes: { title: "Sarapes de Saltillo", k: "Woven stripes and paliacates", rows: [["gear_scarf", "Sarape scarf", "Woven, sand and cream"], ["gear_bandana", "Paliacate", "The red bandana"]] },
    sombreros: { title: "Sombreros", k: "Texanas and palm hats", rows: [["hat_cowboy", "Texana", "The borderlands felt hat"], ["hat_band", "Banda del desierto", "Keeps the sun off"]] }
  };
  function shopDef(id) { var o = C("shops." + id, null) || {}, d = SHOPS_D[id] || {}; return { title: o.title || d.title, k: o.k || d.k, rows: o.rows || d.rows || [] }; }
  // canonical arcade frames: u along the arcade (to the right of someone in the square facing it), w out toward the square (w = 0 at
  // the pier line, the arcade back wall at w = -4, the stall backs at w = -10.5), y up from G
  var ARC = { D: 4, D2: 10.5, pw: 0.62, sp: 3.52, ceil: 5.62, cor: 6.0, par: 6.75 };
  var FR = { norte: { u0: -19, u1: 21, n: 9, m4: null, yaw: 0 }, oriente: { u0: -22.5, u1: 22.5, n: 11, m4: null, yaw: -HP } };
  function frames() { if (FR.norte.m4) return FR; FR.norte.m4 = new THREE.Matrix4().makeTranslation(0, 0, -22.5); var m = new THREE.Matrix4().makeRotationY(-HP); m.premultiply(new THREE.Matrix4().makeTranslation(21, 0, 0)); FR.oriente.m4 = m;
    FR.norte.c2l = function (u, w) { return [u, -22.5 + w]; }; FR.oriente.c2l = function (u, w) { return [21 - w, u]; }; return FR; }
  function bayW(f) { return (f.u1 - f.u0) / f.n; }
  function bayU(f, i) { return f.u0 + bayW(f) * (i + 0.5); }

  // ───────────────────────── small parts shared by the builders ─────────────────────────
  // solids are collected in the local frame: [x, z, w, d, y0, y1, ry, opt]; opt: { seat, face, noStep, out, tag }
  function so(list, x, z, w, d, y0, y1, ry, opt) { list.push([x, z, w, d, y0, y1, ry || 0, opt || null]); }
  // a kit that writes into another kit through a matrix (the canonical arcade frames)
  function XKit(K, m4, yaw) { this.K = K; this.M = m4; this.yaw = yaw || 0; this.m = K.m; }
  XKit.prototype.add = function (b, g, col, m4) { if (g.index) g = g.toNonIndexed(); if (m4) g.applyMatrix4(m4); g.applyMatrix4(this.M); return this.K.add(b, g, col); };
  ["place", "box", "cyl", "sph", "tube", "plane", "lathe"].forEach(function (k) { XKit.prototype[k] = function () { var self = this, K0 = this.K; var saved = K0.add; K0.add = function (b, g, col, m4) { if (g.index) g = g.toNonIndexed(); if (m4) g.applyMatrix4(m4); g.applyMatrix4(self.M); return saved.call(K0, b, g, col); }; try { return Kit.prototype[k].apply(K0, arguments); } finally { K0.add = saved; } }; });
  // solids written in a canonical frame: (u, w) -> local through c2l, the box turned by the frame's yaw
  function XSO(list, f) { return { push: function (q) { var p = f.c2l(q[0], q[1]); var o = q[7] ? Object.assign({}, q[7]) : null; if (o && typeof o.face === "number") o.face += f.yaw; list.push([p[0], p[1], q[2], q[3], q[4], q[5], (q[6] || 0) + f.yaw, o]); } }; }

  // a bench: cantera ends and seat, a talavera-tiled back (seat 0.45); the seat solid faces `face` (local yaw of the sitter)
  function bench(K, SO, x, z, ry, len, back) { var c = Math.cos(ry), s = Math.sin(ry), P = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; };
    var L = len || 2.4; [-1, 1].forEach(function (sd) { var p = P(sd * (L / 2 - 0.12), 0); K.box("cantera", COL.cant, 0.22, 0.42, 0.52, p[0], 0.21, p[1], ry, 0.8); });
    var q = P(0, 0); K.box("cantera", COL.cant, L, 0.08, 0.52, q[0], 0.45, q[1], ry, 1.0); K.box("talavera", COL.sal, L - 0.5, 0.3, 0.03, P(0, 0.27)[0], 0.25, P(0, 0.27)[1], ry, 1.2);
    if (back !== false) { var b = P(0, -0.24); K.box("cantera", COL.cant, L, 0.5, 0.12, b[0], 0.72, b[1], ry, 1.0); K.box("talavera", COL.sal, L - 0.3, 0.36, 0.02, P(0, -0.17)[0], 0.72, P(0, -0.17)[1], ry, 1.2); K.box("cantera", COL.cant, L + 0.06, 0.06, 0.18, b[0], 1.0, b[1], ry, 1.0); }
    so(SO, q[0], q[1], L, 0.52, 0, 0.49, ry, { seat: true, face: ry, noStep: true }); if (back !== false) so(SO, b[0], b[1], L, 0.14, 0.45, 1.03, ry, { noStep: true }); }
  // a cast-iron chair (seat 0.46), facing `face`
  function chair(K, SO, x, z, face, col) { var c = Math.cos(face), s = Math.sin(face), P = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; }; col = col || COL.iron;
    [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].forEach(function (q) { var p = P(q[0], q[1]); K.cyl("iron", col, 0.016, 0.016, 0.46, p[0], 0.23, p[1], 5); });
    var m = P(0, 0); K.box("iron", col, 0.44, 0.03, 0.42, m[0], 0.46, m[1], face); K.box("cloth", [0.78, 0.2, 0.22], 0.4, 0.03, 0.38, m[0], 0.485, m[1], face);
    var b = P(0, -0.2); K.box("iron", col, 0.44, 0.42, 0.025, b[0], 0.7, b[1], face); for (var i = -1; i <= 1; i++) { var bb = P(i * 0.12, -0.21); K.cyl("iron", col, 0.012, 0.012, 0.36, bb[0], 0.7, bb[1], 4); }
    so(SO, m[0], m[1], 0.46, 0.44, 0, 0.47, face, { seat: true, face: face, noStep: true }); }
  // a round iron table under a striped umbrella, four chairs round it
  function cafeTable(K, SO, x, z, rot, awn, noUmb) { K.cyl("iron", COL.iron, 0.04, 0.05, 0.72, x, 0.36, z, 8); K.cyl("iron", COL.iron, 0.22, 0.26, 0.04, x, 0.02, z, 12); K.cyl("talavera", COL.sal, 0.46, 0.46, 0.04, x, 0.74, z, 18); K.cyl("iron", COL.iron, 0.475, 0.475, 0.02, x, 0.72, z, 18, true);
    so(SO, x, z, 0.9, 0.9, 0, 0.76, rot, { noStep: true });
    for (var i = 0; i < 4; i++) { var a = rot + i * HP, px = x + Math.sin(a) * 0.78, pz = z + Math.cos(a) * 0.78; chair(K, SO, px, pz, a + PI); }
    if (noUmb) return;
    // the umbrella: pole, eight striped panels, the finial
    K.cyl("wood", COL.woodD, 0.025, 0.025, 2.35, x, 1.18, z, 6); var R = 1.45, h0 = 2.25, h1 = 2.62, n = 8; var v0 = awn * 0.25 + 0.02, v1 = v0 + 0.21;
    for (var k = 0; k < n; k++) { var a0 = k / n * TAU, a1 = (k + 1) / n * TAU; var A = [x, h1, z], B = [x + Math.cos(a0) * R, h0, z + Math.sin(a0) * R], Cc = [x + Math.cos(a1) * R, h0, z + Math.sin(a1) * R];
      var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute([A[0], A[1], A[2], Cc[0], Cc[1], Cc[2], B[0], B[1], B[2], A[0], A[1] - 0.01, A[2], B[0], B[1] - 0.01, B[2], Cc[0], Cc[1] - 0.01, Cc[2]], 3));
      var u0 = (k % 2) * 0.0625, u1 = u0 + 0.0625; g.setAttribute("uv", new THREE.Float32BufferAttribute([u0, v1, u1, v0, u0, v0, u0, v1, u0, v0, u1, v0], 2)); g.computeVertexNormals(); K.add("awning", g, COL.sal); }
    K.sph("wood", COL.woodD, 0.05, x, h1 + 0.03, z, 6); }
  // a candelabra lamp post: iron post, four arms with globes, a finial (the globes glow at night; returns the globe positions)
  function lampPost(K, SO, x, z) { K.cyl("cantera", COL.cant, 0.34, 0.4, 0.45, x, 0.225, z, 8); K.cyl("iron", COL.iron, 0.13, 0.17, 0.5, x, 0.7, z, 10); K.cyl("iron", COL.iron, 0.06, 0.085, 3.0, x, 2.4, z, 10);
    K.cyl("iron", COL.iron, 0.11, 0.07, 0.18, x, 3.0, z, 10); var out = [];
    for (var i = 0; i < 4; i++) { var a = i * HP + PI / 4, ax = x + Math.cos(a) * 0.5, az = z + Math.sin(a) * 0.5; K.tube("iron", COL.iron, V3(x, 3.25, z), V3(ax, 3.45, az), 0.025, 5); K.cyl("iron", COL.iron, 0.07, 0.05, 0.08, ax, 3.5, az, 8); K.sph("lamp", COL.cream, 0.15, ax, 3.68, az, 10); out.push([ax, 3.68, az]); }
    K.sph("lamp", COL.cream, 0.18, x, 4.12, z, 10); out.push([x, 4.12, z]); K.cyl("iron", COL.iron, 0.012, 0.03, 0.3, x, 4.42, z, 5);
    so(SO, x, z, 0.5, 0.5, 0, 3.4, 0, { noStep: true }); return out; }
  // a punched tin lantern hanging on a chain (the tin glows at night, the core is a lamp)
  function tinLantern(K, x, y, z, s) { s = s || 1; K.cyl("iron", COL.iron, 0.008, 0.008, 0.6, x, y + 0.62 * s, z, 4);
    K.lathe("tin", [0.85, 0.85, 0.82], [[0.02, 0.5], [0.08, 0.46], [0.13, 0.38], [0.14, 0.18], [0.11, 0.08], [0.15, 0.04], [0.04, 0.0]], x, y, z, 8, s, s, s);
    K.sph("lamp", COL.cream, 0.075 * s, x, y + 0.24 * s, z, 6); }
  // a square tiled planter with soil (the tree is an engine placement on top)
  function planter(K, SO, x, z, s, ry) { s = s || 1.6; ry = ry || 0; K.box("talavera", COL.sal, s, 0.42, s, x, 0.21, z, ry, 1.2); K.box("cantera", COL.cant, s + 0.1, 0.08, s + 0.1, x, 0.46, z, ry, 1.0); K.box("cloth", COL.soil, s - 0.16, 0.02, s - 0.16, x, 0.47, z, ry);
    so(SO, x, z, s + 0.1, s + 0.1, 0, 0.5, ry, { noStep: true }); }
  // a little potted plant cluster (terracotta pots, dark soil, a few round green heads) for stalls and doorways
  function pots(K, x, z, n, R, y0) { y0 = y0 || 0; for (var i = 0; i < n; i++) { var a = R() * TAU, r = 0.12 + R() * 0.12, px = x + (i - (n - 1) / 2) * 0.36 + Math.cos(a) * 0.04, pz = z + Math.sin(a) * 0.04, h = 0.25 + R() * 0.2; K.lathe("cloth", [0.66, 0.36, 0.22], [[0.0, 0], [0.11, 0], [0.15, h * 0.9], [0.17, h], [0.0, h]], px, y0, pz, 10);
      K.sph("food", [0.2 + R() * 0.15, 0.45 + R() * 0.2, 0.18], 0.16 + R() * 0.06, px, y0 + h + 0.1, pz, 7, 1, 0.8, 1); for (var fl = 0; fl < 4; fl++) { var fa = R() * TAU; K.sph("food", R() < 0.5 ? [0.86, 0.12, 0.2] : [0.95, 0.35, 0.45], 0.04, px + Math.cos(fa) * 0.11, y0 + h + 0.2 + R() * 0.06, pz + Math.sin(fa) * 0.11, 5); } } }

  // ───────────────────────── the portales: cantera arcades with stalls behind (built in the canonical frame of each row) ─────────────────────────
  // returns { lights: [[x, y, z, colour, k]], pools: [[x, z, r, colour]], lanterns: [...], spots: [...] } in the local frame
  var GLOW = MC.glow = MC.glow || { pools: [], lamps: [], halos: [] };
  function c2l3(f, u, y, w) { var p = f.c2l(u, w); return [p[0], y, p[1]]; }
  function buildPortal(K0, SO0, fkey, stalls, opt) {
    var f = frames()[fkey], K = new XKit(K0, f.m4, f.yaw), SO = XSO(SO0, f), AF = SITE.AF, W = bayW(f), D = ARC.D, D2 = ARC.D2, pw = ARC.pw, sp = ARC.sp;
    var fac = COL[opt.facade] || COL.ochre, inner = COL.cal, n = f.n, u0 = f.u0, u1 = f.u1, R = rng(fkey === "norte" ? 1928 : 1901);
    var U = function (i) { return u0 + W * i; };
    // the front wall: painted stucco spandrels and parapet, cantera reveals; arches from the arcade floor to the springing
    var holes = []; for (var i = 0; i < n; i++) holes.push(archHole(U(i) + pw / 2, U(i + 1) - pw / 2, AF + 0.002, sp, 16));
    var mF = new THREE.Matrix4().makeTranslation(0, 0, -0.25);
    wallAt(K, [[u0 - (opt.endL ? 0.45 : 0), 0], [u1 + (opt.endR ? 0.45 : 0), 0], [u1 + (opt.endR ? 0.45 : 0), ARC.par], [u0 - (opt.endL ? 0.45 : 0), ARC.par]], holes, 0.5, mF, "stucco", fac, "stucco", inner, "cantera", COL.cant, 2.5, [0, 1.2, 0.18]);
    // piers: base, shaft, impost; archivolts with keystones on the outer face; the corner and end piers are heavier
    for (var p = 0; p <= n; p++) { var u = U(p), wide = (p === 0 && opt.endL) || (p === n && opt.endR), pwx = wide ? 1.1 : pw + 0.06, ux = u + (p === 0 && wide ? -0.2 : p === n && wide ? 0.2 : 0);
      if (p === 0 && opt.skipFirst) continue;
      K.box("cantera", COL.cant, pwx, sp + 0.02, 0.62, ux, (sp + 0.02) / 2, 0, 0, 0.9); K.box("cantera", COL.cantD, pwx + 0.16, 0.26, 0.74, ux, 0.13, 0, 0, 0.9); K.box("cantera", COL.cant, pwx + 0.2, 0.18, 0.76, ux, sp - 0.02, 0, 0, 0.9); K.box("cantera", COL.cant, pwx + 0.12, 0.08, 0.7, ux, sp + 0.11, 0, 0, 0.9);
      SO.push([ux, 0, pwx + 0.1, 0.72, 0, sp + 0.2, 0, { noStep: true }]); }
    var mA = new THREE.Matrix4().makeTranslation(0, 0, 0.25);
    for (var a = 0; a < n; a++) { var c0 = (U(a) + U(a + 1)) / 2, r0 = (W - pw) / 2; archRing(K, "cantera", COL.cant, c0, sp, r0, r0 + 0.3, 0.07, mA, 18); K.box("cantera", COL.cant, 0.34, 0.5, 0.14, c0, sp + r0 + 0.12, 0.3, 0, 0.6); }
    // cornice, frieze band, parapet coping with a row of tiles, drain spouts
    K.box("cantera", COL.cant, u1 - u0 + 0.9, 0.24, 0.42, (u0 + u1) / 2, ARC.cor - 0.02, 0.36, 0, 1.0); K.box("cantera", COL.cant, u1 - u0 + 0.8, 0.1, 0.28, (u0 + u1) / 2, ARC.cor - 0.2, 0.3, 0, 1.0);
    K.box("tile", COL.sal, u1 - u0 + 0.9, 0.1, 0.62, (u0 + u1) / 2, ARC.par + 0.05, 0, 0, 0.9);
    for (var q = 1; q < n; q += 2) K.box("cantera", COL.cant, 0.2, 0.18, 0.75, U(q), ARC.cor + 0.2, 0.6, 0, 0.6);
    // the arcade: saltillo floor, the cantera step, the vigas and the board ceiling
    K.box("saltillo", COL.sal, u1 - u0, 0.12, D + 0.25, (u0 + u1) / 2, AF - 0.06, -D / 2 + 0.125, 0, 1.2);
    K.box("cantera", COL.cantD, u1 - u0 + 0.2, AF / 2 + 0.02, 0.36, (u0 + u1) / 2, (AF / 2 + 0.02) / 2, 0.43, 0, 0.9);
    for (var vg = u0 + 0.35; vg < u1 - 0.2; vg += 0.64) K.place("wood", new THREE.CylinderGeometry(0.1, 0.11, D + 0.2, 8), COL.viga, vg, ARC.ceil - 0.11, -D / 2, 0, HP);
    K.box("wood", COL.wood, u1 - u0, 0.05, D + 0.2, (u0 + u1) / 2, ARC.ceil + 0.02, -D / 2, 0, 1.4);
    SO.push([(u0 + u1) / 2, 0.42, u1 - u0, 0.36, 0, 0.18, 0, null]);   // the step (a solid you walk up)
    // the back wall of the arcade, bay by bay (each its own colour), with the stall openings; the stalls behind
    var out = { spots: [], lanterns: [], counters: [] };
    for (var b = 0; b < n; b++) {
      var st = stalls[b], uc = (U(b) + U(b + 1)) / 2, wcol = st && st.wall ? COL[st.wall] || inner : inner, kind = st ? st.k : "skip";
      if (kind === "skip") continue;
      var hl = [], bL = U(b), bR = U(b + 1);
      if (st && st.span === 2) { bR = U(b + 2); uc = (bL + bR) / 2; }
      if (kind === "casa") { if (stalls[b - 1] && stalls[b - 1].k === "casa") continue; bR = U(b + 3); uc = (bL + bR) / 2; [-1, 0, 1].forEach(function (k) { var cx = uc + k * W; hl.push(archHole(cx - 1.15, cx + 1.15, AF + 0.002, AF + 2.65, 14)); }); }
      else if (kind === "gate") hl.push(archHole(uc - 1.7, uc + 1.7, AF + 0.002, AF + 2.9, 16));
      else if (kind === "fonda") { hl.push(rectHole(uc - 3.4, uc - 0.6, AF + 0.92, AF + 2.85)); hl.push(archHole(uc + 0.2, uc + 2.4, AF + 0.002, AF + 2.4, 12)); }
      else hl.push(rectHole(uc - 1.5, uc + 1.5, AF + 0.92, AF + 2.85));
      var mB = new THREE.Matrix4().makeTranslation(0, 0, -D - 0.15);
      wallAt(K, [[bL, 0], [bR, 0], [bR, ARC.ceil + 0.04], [bL, ARC.ceil + 0.04]], hl, 0.3, mB, "stucco", wcol, "stucco", mulCol(wcol, 1.08), "stucco", wcol, 2.5, [0, 1.0, 0.2]);
      // solids of the back wall (left and right of the opening, over it, the counter under it)
      if (kind === "casa") { var seg = [[bL, uc - W - 1.15], [uc - W + 1.15, uc - 1.15], [uc + 1.15, uc + W - 1.15], [uc + W + 1.15, bR]]; seg.forEach(function (sgm) { SO.push([(sgm[0] + sgm[1]) / 2, -D, sgm[1] - sgm[0], 0.34, 0, 5.6, 0, null]); }); }
      else if (kind === "gate") { SO.push([(bL + uc - 1.7) / 2, -D, uc - 1.7 - bL, 0.34, 0, 5.6, 0, null]); SO.push([(uc + 1.7 + bR) / 2, -D, bR - uc - 1.7, 0.34, 0, 5.6, 0, null]); }
      else if (kind === "fonda") { SO.push([(bL + uc - 3.4) / 2, -D, uc - 3.4 - bL, 0.34, 0, 5.6, 0, null]); SO.push([uc - 2.0, -D, 2.8, 0.34, 0, AF + 0.95, 0, { noStep: true, counter: st.id }]); SO.push([uc - 0.2, -D, 0.8, 0.34, 0, 5.6, 0, null]); SO.push([(uc + 2.4 + bR) / 2, -D, bR - uc - 2.4, 0.34, 0, 5.6, 0, null]); }
      else { SO.push([(bL + uc - 1.5) / 2, -D, uc - 1.5 - bL, 0.34, 0, 5.6, 0, null]); SO.push([(uc + 1.5 + bR) / 2, -D, bR - uc - 1.5, 0.34, 0, 5.6, 0, null]); SO.push([uc, -D, 3.0, 0.34, 0, AF + 0.95, 0, { noStep: true, counter: st.id }]); }
      // counter boards, tile band under the counter, shutters swung open, the name board over the opening
      if (kind !== "casa" && kind !== "gate") { var cw = kind === "fonda" ? 2.8 : 3.0, cu = kind === "fonda" ? uc - 2.0 : uc;
        K.box("wood", COL.woodD, cw + 0.25, 0.08, 0.6, cu, AF + 0.96, -D + 0.08, 0, 1.0); K.box("talavera", COL.sal, cw, 0.62, 0.03, cu, AF + 0.5, -D + 0.02, 0, 1.2);
        if (kind !== "closed") { var gapL = cu - cw / 2 - bL, gapR = bR - (cu + cw / 2), shc = mulCol(COL[st.shut || "verde"] || COL.verde, 0.9), shd = mulCol(COL[st.shut || "verde"] || COL.verde, 0.72);
          // the shutters are folded back against the wall in the strip beside the opening (two leaves stacked), so they never cover a neighbour
          [[-1, gapL], [1, gapR]].forEach(function (q) { var sd = q[0], gw = Math.min(0.62, q[1] - 0.08); if (gw < 0.25) return; var hu = cu + sd * (cw / 2 + 0.04 + gw / 2); K.box("paint", shc, gw, 1.95, 0.05, hu, AF + 1.9, -D + 0.045, 0, 1.0); K.box("paint", shd, gw - 0.06, 1.85, 0.04, hu + sd * 0.02, AF + 1.9, -D + 0.085, 0, 1.0); [0.55, 1.45].forEach(function (yy) { K.box("paint", shc, gw - 0.2, 0.6, 0.02, hu + sd * 0.02, AF + 0.95 + yy, -D + 0.11, 0, 1.0); }); K.box("iron", COL.iron, 0.04, 0.04, 0.12, cu + sd * (cw / 2 + 0.04), AF + 2.3, -D + 0.06, 0); }); }
        else { K.box("paint", mulCol(COL.verde, 0.9), cw, 1.93, 0.08, cu, AF + 1.885, -D - 0.12, 0, 1.0); for (var sl = 0; sl < 7; sl++) K.box("paint", mulCol(COL.verde, 0.72), cw - 0.1, 0.05, 0.03, cu, AF + 1.05 + sl * 0.26, -D - 0.06, 0, 1.0); K.box("iron", COL.iron, 0.4, 0.12, 0.05, cu, AF + 1.2, -D - 0.04, 0); }
        if (st.name) { var bk = "b" + (opt.board0 + b); K.box("wood", COL.woodD, 2.78, 0.56, 0.06, cu, AF + 3.3, -D + 0.04, 0, 1.0); var g2 = new THREE.PlaneGeometry(2.62, 0.48); var uv = sUV(bk), UA = g2.attributes.uv; for (var ui = 0; ui < UA.count; ui++) UA.setXY(ui, uv[0] + UA.getX(ui) * (uv[2] - uv[0]), uv[1] + UA.getY(ui) * (uv[3] - uv[1])); K.place("signs", g2, COL.sal, cu, AF + 3.3, -D + 0.075, 0);
          (function (bk2, s2) { SIGN_DRAW.push(function (x) { board(x, SA.r[bk2], s2.name, s2.sub, s2.bd); }); })(bk, st); }
        out.counters.push({ id: st.id, st: st, u: cu, w: -D + 0.7, lc: c2l3(f, cu, AF, -D + 0.9) });
      }
      // the stall itself: side walls, back wall with a barred window, floor, ceiling, dressing by kind
      if (kind !== "gate" && kind !== "casa") stallInside(K, SO, st, bL, bR, uc, R, out, f); }
    // side walls between the stalls and the long back wall with its windows (the outer face in the facade colour)
    for (var sw = 0; sw <= n; sw++) { var su = U(sw); if ((sw === 0 && !opt.sideL) || (sw === n && !opt.sideR)) continue; var nb = stalls[sw - 1], na = stalls[sw];
      var inCasa = nb && na && nb.k === "casa" && na.k === "casa"; if (inCasa) continue;
      K.box("stucco", mulCol(COL.cal, 0.98), 0.22, ARC.cor - 0.1, D2 - D, su, (ARC.cor - 0.1) / 2, -(D + D2) / 2, 0, 2.5); SO.push([su, -(D + D2) / 2, 0.26, D2 - D, 0, 5.8, 0, null]); }
    var wins = []; for (var wi = 0; wi < n; wi++) { var s3 = stalls[wi]; if (s3 && (s3.k === "gate")) continue; if (s3 && s3.k === "casa") continue; var wc = (U(wi) + U(wi + 1)) / 2; wins.push(rectHole(wc - 0.45, wc + 0.45, AF + 2.0, AF + 2.8)); }
    var gate = stalls.findIndex(function (s4) { return s4 && s4.k === "gate"; }); if (gate >= 0) { var gu = (U(gate) + U(gate + 1)) / 2; wins.push(archHole(gu - 1.75, gu + 1.75, AF + 0.002, AF + 3.0, 16)); }
    var mBk = new THREE.Matrix4().makeRotationY(PI); mBk.premultiply(new THREE.Matrix4().makeTranslation(0, 0, -D2));
    // (turned round: the wall's own a runs along -u, so the outline and the holes are mirrored)
    var mir = function (pts) { return pts.map(function (q) { return [-q[0], q[1]]; }).reverse(); };
    wallAt(K, mir([[u0 - (opt.endL ? 0.45 : 0), -1.6], [u1 + (opt.endR ? 0.45 : 0), -1.6], [u1 + (opt.endR ? 0.45 : 0), ARC.par], [u0 - (opt.endL ? 0.45 : 0), ARC.par]]), wins.map(mir), 0.4, mBk, "stucco", fac, "stucco", COL.cal, "stucco", mulCol(fac, 0.95), 2.5, [-1.6, 0.6, 0.25]);
    SO.push([(u0 + u1) / 2, -D2 - 0.2, u1 - u0, 0.42, -1.6, 6.8, 0, null]);
    // window panes and iron bars, the plinth course along the outside, the roof (brick enladrillado) and the rear parapet tiles, two water tanks
    wins.forEach(function (hh, wi2) { if (hh.length > 4) return; var wc2 = (hh[0][0] + hh[1][0]) / 2; K.box("glass", COL.sal, 0.9, 0.8, 0.02, wc2, AF + 2.4, -D2 - 0.12, 0); for (var bi = -2; bi <= 2; bi++) K.cyl("iron", COL.iron, 0.014, 0.014, 0.8, wc2 + bi * 0.17, AF + 2.4, -D2 - 0.42, 4); K.box("cantera", COL.cant, 1.1, 0.08, 0.2, wc2, AF + 1.98, -D2 - 0.46, 0, 0.8); });
    K.box("cantera", COL.cantD, u1 - u0 + 0.9, 2.0, 0.1, (u0 + u1) / 2, -0.6, -D2 - 0.45, 0, 0.9);
    (opt.doors || []).forEach(function (bi) { var du = U(bi) + 0.75; K.box("paint", mulCol(COL.verde, 0.75), 1.0, 2.1, 0.06, du, AF + 0.75, -D2 - 0.43, 0, 1.0); K.box("cantera", COL.cant, 1.3, 0.16, 0.14, du, AF + 1.88, -D2 - 0.46, 0, 0.8); K.box("cantera", COL.cantD, 1.2, AF + 0.32, 0.5, du, (AF - 0.3) / 2, -D2 - 0.65, 0, 0.8); K.box("iron", COL.iron, 0.04, 0.16, 0.05, du + 0.38, AF + 0.85, -D2 - 0.48, 0); });
    K.box("saltillo", mulCol(COL.sal, 0.78), u1 - u0 + 0.9, 0.1, D2 + 0.65, (u0 + u1) / 2, ARC.cor - 0.05, -D2 / 2 + 0.1, 0, 0.9);
    K.box("tile", COL.sal, u1 - u0 + 0.9, 0.1, 0.5, (u0 + u1) / 2, ARC.par + 0.05, -D2 - 0.2, 0, 0.9);
    K.box("cantera", COL.cant, u1 - u0 + 0.9, 0.2, 0.3, (u0 + u1) / 2, ARC.cor - 0.02, -D2 - 0.52, 0, 1.0); for (var cq = 1; cq < n; cq += 2) K.box("cantera", COL.cant, 0.2, 0.18, 0.75, U(cq), ARC.cor + 0.2, -D2 - 0.6, 0, 0.6);
    if (opt.wallSign) K.place("wallsign", new THREE.PlaneGeometry(12.0, 1.88), COL.sal, opt.wallSign, 4.4, -D2 - 0.41, PI);
    [0.28, 0.72].forEach(function (t) { var tu = lerp(u0, u1, t) + 0.6, tw = -D2 + 1.6; K.cyl("cloth", [0.12, 0.12, 0.13], 0.55, 0.55, 1.1, tu, ARC.cor + 0.55, tw, 14); K.cyl("cloth", [0.16, 0.16, 0.17], 0.25, 0.25, 0.08, tu, ARC.cor + 1.14, tw, 10); K.box("iron", COL.iron, 1.0, 0.25, 1.0, tu, ARC.cor + 0.12, tw, 0); });
    // terracotta pots of geraniums against the back wall at every other pier line (not in front of a door or counter)
    for (var pp = 1; pp < n; pp += 2) { var pu = U(pp); pots(K, pu, -D + 0.35, 2, R, AF); }
    // the tin lanterns, one a bay, and their light pools on the arcade floor (night)
    for (var l = 0; l < n; l++) { var lu = (U(l) + U(l + 1)) / 2; if (opt.noLantern && opt.noLantern(l)) continue; tinLantern(K, lu, 3.9, -1.7, 1.15); var lp = c2l3(f, lu, 4.15, -1.7); out.lanterns.push(lp); GLOW.pools.push([lp[0], lp[2], 2.6, [1.0, 0.72, 0.42], AF + 0.012]); }
    return out; }

  // ───────────────────────── a stall behind the arcade: walls, floor, ceiling and the goods by kind ─────────────────────────
  function stallInside(K, SO, st, bL, bR, uc, R, out, f) { var AF = SITE.AF, D = ARC.D, D2 = ARC.D2, wcol = COL[st.wall] || COL.cal, w0 = -D - 0.3, w1 = -D2, dep = w0 - w1, wid = bR - bL - 0.24;
    K.box("saltillo", COL.sal, wid, 0.1, dep, uc, AF - 0.05, (w0 + w1) / 2, 0, 1.2);
    K.box("wood", COL.wood, wid, 0.06, dep, uc, AF + 3.45, (w0 + w1) / 2, 0, 1.2);
    for (var bm = w0 - 0.4; bm > w1 + 0.2; bm -= 0.9) K.box("wood", COL.viga, wid, 0.14, 0.12, uc, AF + 3.36, bm, 0, 1.0);
    if (st.k === "closed") return;
    // the shelves on the back wall and the goods panel behind them (photographed stock from tex/mc_goods*)
    var shelfFront = w1 + 0.62;
    if (st.k === "panel") { var pn = st.panel || 0, sh = st.sheet || "goods1", u0 = (pn % 2) * 0.5, v1 = 1 - Math.floor(pn / 2) * 0.5, g = new THREE.PlaneGeometry(wid - 0.2, 2.75); var UA = g.attributes.uv, asp = (wid - 0.2) / 2.75, uh = asp >= 1 ? 0.48 : 0.48 * asp, vh = asp >= 1 ? 0.48 / asp : 0.48; for (var i = 0; i < UA.count; i++) UA.setXY(i, u0 + 0.25 - uh / 2 + UA.getX(i) * uh, v1 - 0.25 - vh / 2 + UA.getY(i) * vh);
      K.place(sh, g, COL.sal, uc, AF + 1.62, w1 + 0.05, 0);
      for (var s = 0; s < 4; s++) K.box("wood", COL.woodD, wid - 0.1, 0.04, 0.42, uc, AF + 0.32 + s * 0.72, w1 + 0.26, 0, 1.0);
      [-1, 1].forEach(function (sd) { K.box("wood", COL.woodD, 0.06, 2.9, 0.44, uc + sd * (wid / 2 - 0.08), AF + 1.45, w1 + 0.26, 0, 1.0); }); }
    // a display table in front with the hero pieces of the trade
    var tw = Math.min(2.6, wid - 0.8), tz = w0 - 0.85;
    if (st.k !== "fonda" && st.k !== "coffee" && st.k !== "paletas") { K.box("wood", COL.wood, tw, 0.05, 0.75, uc, AF + 0.78, tz, 0, 1.0); [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sz) { K.box("wood", COL.woodD, 0.05, 0.76, 0.05, uc + sx * (tw / 2 - 0.06), AF + 0.38, tz + sz * 0.31, 0); }); }); K.box("cloth", st.cloth || [0.75, 0.2, 0.25], tw + 0.04, 0.012, 0.79, uc, AF + 0.81, tz, 0); }
    var top = AF + 0.82;
    if (st.pots) { for (var p = 0; p < 7; p++) { var px = uc - tw / 2 + 0.25 + p * (tw - 0.5) / 6, h = 0.18 + R() * 0.22, rr = 0.09 + R() * 0.07, blue = st.id === "talavera"; K.lathe(blue ? "talavera" : "cloth", blue ? COL.sal : [0.72, 0.42, 0.26], [[0.0, 0], [rr * 0.7, 0], [rr * 1.25, h * 0.45], [rr * 0.7, h * 0.85], [rr * 0.8, h], [0.0, h * 0.98]], px, top, tz + (p % 2 ? 0.14 : -0.12), 12); } }
    if (st.stacks) { for (var sk = 0; sk < 4; sk++) { var sx2 = uc - tw / 2 + 0.35 + sk * (tw - 0.7) / 3; for (var ly = 0; ly < 5; ly++) { var cols = [[0.8, 0.12, 0.3], [0.1, 0.55, 0.62], [0.95, 0.55, 0.1], [0.2, 0.2, 0.25], [0.95, 0.85, 0.2], [0.45, 0.15, 0.55]]; K.box("cloth", cols[(sk * 2 + ly) % cols.length], 0.5, 0.075, 0.46, sx2, top + 0.04 + ly * 0.076, tz, (R() - 0.5) * 0.08); } } }
    if (st.lanterns) { for (var ln = 0; ln < 6; ln++) tinLantern(K, uc - wid / 2 + 0.5 + ln * (wid - 1) / 5, AF + 2.2 + (ln % 2) * 0.35, w0 - 0.35 - (ln % 3) * 0.3, 0.8); }
    if (st.pinatas) { for (var pi2 = 0; pi2 < 3; pi2++) pinata(K, uc - 1.4 + pi2 * 1.4, AF + 4.1 - (pi2 % 2) * 0.3, -D + 1.3, R, pi2); }
    if (st.k === "hats") { for (var hr = 0; hr < 2; hr++) for (var hc = 0; hc < 5; hc++) { var hx = uc - wid / 2 + 0.55 + hc * (wid - 1.1) / 4, hy = AF + 1.5 + hr * 0.72; hat(K, hx, hy, w1 + 0.32, R, (hr * 5 + hc) % 3); K.cyl("wood", COL.woodD, 0.012, 0.012, 0.22, hx, hy - 0.05, w1 + 0.18, 4, false, 0, HP); }
      for (var ht = 0; ht < 4; ht++) hat(K, uc - tw / 2 + 0.35 + ht * (tw - 0.7) / 3, top, tz, R, ht % 3, true); }
    if (st.k === "flores") { for (var fb = 0; fb < 9; fb++) { var fx = uc - wid / 2 + 0.45 + (fb % 5) * (wid - 0.9) / 4, fz = fb < 5 ? w1 + 0.55 : tz, fy = fb < 5 ? AF : top; flowers(K, fx, fy, fz, R, fb); } }
    if (st.k === "ristras") { for (var rs = 0; rs < 7; rs++) ristra(K, uc - wid / 2 + 0.45 + rs * (wid - 0.9) / 6, AF + 3.3, w1 + 0.35 + (rs % 2) * 0.3, R); for (var sa = 0; sa < 4; sa++) { var sx3 = uc - tw / 2 + 0.3 + sa * (tw - 0.6) / 3; K.cyl("cloth", [0.82, 0.74, 0.56], 0.17, 0.2, 0.32, sx3, top + 0.16, tz, 10); K.cyl("food", [[0.7, 0.12, 0.08], [0.85, 0.55, 0.12], [0.45, 0.28, 0.12], [0.3, 0.42, 0.15]][sa], 0.16, 0.16, 0.02, sx3, top + 0.33, tz, 10); } }
    if (st.k === "candles") { for (var cd = 0; cd < 26; cd++) { var cx = uc - wid / 2 + 0.35 + (cd % 9) * (wid - 0.7) / 8, cyy = cd < 9 ? AF + 1.05 : cd < 18 ? AF + 1.77 : top, czz = cd < 18 ? w1 + 0.3 : tz + (cd % 2 ? 0.15 : -0.15), ch = 0.15 + R() * 0.25; K.cyl("food", [0.96, 0.92, 0.82], 0.035 + R() * 0.03, 0.04 + R() * 0.03, ch, cx, cyy + ch / 2, czz, 8); K.sph("lamp", COL.cream, 0.018, cx, cyy + ch + 0.03, czz, 4, 1, 1.8, 1); }
      }
    if (st.k === "coffee") { K.box("wood", COL.wood, wid - 0.6, 0.06, 0.6, uc, AF + 0.92, w1 + 0.55, 0, 1.0); K.box("stucco", mulCol(COL.terra, 0.9), wid - 0.6, 0.88, 0.55, uc, AF + 0.44, w1 + 0.55, 0, 1.0);
      for (var ol = 0; ol < 3; ol++) { var ox = uc - 1 + ol, oy = AF + 0.95; K.lathe("cloth", [0.5, 0.26, 0.16], [[0, 0], [0.16, 0.01], [0.24, 0.12], [0.24, 0.24], [0.17, 0.33], [0.19, 0.37], [0.0, 0.36]], ox, oy, w1 + 0.55, 12); K.box("glowK", [0.3, 0.2, 0.12], 0.4, 0.04, 0.4, ox, oy - 0.02, w1 + 0.55, 0); }
      for (var jr = 0; jr < 12; jr++) K.lathe("cloth", [0.62, 0.34, 0.2], [[0, 0], [0.04, 0], [0.055, 0.05], [0.045, 0.1], [0.05, 0.11], [0, 0.11]], uc - 1.3 + (jr % 6) * 0.52, AF + 1.62 + Math.floor(jr / 6) * 0.42, w1 + 0.2, 8);
      for (var sh2 = 0; sh2 < 2; sh2++) K.box("wood", COL.woodD, wid - 0.4, 0.04, 0.3, uc, AF + 1.6 + sh2 * 0.42, w1 + 0.2, 0, 1.0); }
    if (st.k === "fonda") { K.box("wood", COL.wood, wid - 0.6, 0.06, 0.65, uc, AF + 0.92, w1 + 0.6, 0, 1.0); K.box("talavera", COL.sal, wid - 0.6, 0.88, 0.6, uc, AF + 0.44, w1 + 0.6, 0, 1.2);
      for (var cz = 0; cz < 4; cz++) { var cx2 = uc - 2.2 + cz * 1.45; K.lathe("cloth", [0.48, 0.24, 0.15], [[0, 0], [0.2, 0.01], [0.27, 0.16], [0.26, 0.3], [0.2, 0.34], [0, 0.34]], cx2, AF + 0.95, w1 + 0.6, 12); K.cyl("food", [[0.55, 0.18, 0.08], [0.82, 0.62, 0.22], [0.35, 0.22, 0.1], [0.7, 0.3, 0.1]][cz], 0.19, 0.19, 0.02, cx2, AF + 1.27, w1 + 0.6, 12); }
      K.box("stucco", mulCol(COL.terra, 0.85), 1.6, 0.9, 0.7, uc + 2.2, AF + 0.45, w1 + 0.4, 0, 1.0); K.box("glowK", [0.25, 0.15, 0.1], 1.2, 0.05, 0.4, uc + 2.2, AF + 0.92, w1 + 0.4, 0); K.cyl("iron", COL.iron, 0.42, 0.42, 0.03, uc + 2.2, AF + 0.95, w1 + 0.4, 18);
      for (var pl = 0; pl < 3; pl++) for (var py = 0; py < 3; py++) K.cyl("talavera", COL.sal, 0.12, 0.1, 0.02, uc - 2.4 + pl * 0.26, AF + 1.6 + py * 0.36, w1 + 0.15, 12, false, 0, HP);
      SO.push([uc, w1 + 0.6, wid - 0.6, 0.7, 0, AF + 0.95, 0, { noStep: true }]); SO.push([uc + 2.2, w1 + 0.4, 1.6, 0.75, 0, AF + 0.95, 0, { noStep: true }]); }
    if (st.k === "paletas") { K.box("enamel", [0.93, 0.95, 0.96], 2.4, 0.9, 0.8, uc, AF + 0.45, w1 + 0.65, 0); K.box("glass", COL.sal, 2.3, 0.02, 0.7, uc, AF + 0.91, w1 + 0.65, 0); for (var pp = 0; pp < 16; pp++) { var ppx = uc - 1.05 + (pp % 8) * 0.3, ppz = w1 + 0.45 + Math.floor(pp / 8) * 0.38; K.box("food", [[0.95, 0.55, 0.12], [0.85, 0.15, 0.3], [0.95, 0.9, 0.55], [0.45, 0.75, 0.3], [0.6, 0.15, 0.45]][pp % 5], 0.07, 0.03, 0.16, ppx, AF + 0.86, ppz, 0); }
      K.box("enamel", [0.86, 0.18, 0.42], 2.4, 0.08, 0.8, uc, AF + 0.06, w1 + 0.65, 0); }
  }
  // goods in 3D: a seven-point piñata, a sombrero, a bucket of flowers, a chile ristra
  function pinata(K, x, y, z, R, k) { var cols = [[0.95, 0.3, 0.6], [0.2, 0.7, 0.75], [0.98, 0.72, 0.15]][k % 3]; K.cyl("iron", COL.iron, 0.006, 0.006, 0.7, x, y + 0.7, z, 3); K.sph("cloth", cols, 0.26, x, y, z, 10);
    for (var i = 0; i < 7; i++) { var d = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0]][i], g = new THREE.ConeGeometry(0.08, 0.42, 7); g.translate(0, 0.42, 0); var q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), V3(d[0], d[1], d[2]).normalize()); var m = new THREE.Matrix4().compose(V3(x, y, z), q, V3(1, 1, 1)); K.add("cloth", g, [[0.98, 0.8, 0.2], [0.95, 0.4, 0.15], [0.3, 0.75, 0.35], [0.85, 0.2, 0.55]][i % 4], m);
      for (var t = 0; t < 3; t++) K.box("cloth", [[0.98, 0.3, 0.55], [0.3, 0.8, 0.85], [0.98, 0.85, 0.3]][t], 0.012, 0.3, 0.03, x + d[0] * 0.66 + (t - 1) * 0.02, y + d[1] * 0.66 - 0.2, z + d[2] * 0.66, 0); } }
  function hat(K, x, y, z, R, k, flat) { var col = [[0.86, 0.76, 0.56], [0.32, 0.22, 0.14], [0.55, 0.42, 0.3]][k]; if (flat) { K.cyl("cloth", col, 0.27, 0.27, 0.015, x, y + 0.01, z, 16); K.lathe("cloth", col, [[0.0, 0.13], [0.07, 0.13], [0.1, 0.07], [0.11, 0.0], [0.0, 0.0]], x, y + 0.015, z, 12); K.cyl("cloth", mulCol(col, 0.6), 0.112, 0.112, 0.025, x, y + 0.03, z, 12, true); return; }
    K.place("cloth", new THREE.CylinderGeometry(0.27, 0.27, 0.015, 16), col, x, y, z + 0.08, 0, HP); var g = new THREE.LatheGeometry([V3(0.0, 0.13, 0), V3(0.07, 0.13, 0), V3(0.1, 0.07, 0), V3(0.11, 0, 0), V3(0.0, 0, 0)].map(function (v) { return new THREE.Vector2(Math.max(0.0005, v.x), v.y); }), 12); K.place("cloth", g, col, x, y, z + 0.09, 0, HP); }
  function flowers(K, x, y, z, R, k) { K.cyl("enamel", [0.55, 0.6, 0.62], 0.16, 0.13, 0.32, x, y + 0.16, z, 10, true); K.cyl("cloth", [0.25, 0.2, 0.14], 0.15, 0.15, 0.02, x, y + 0.3, z, 10);
    var cols = [[0.98, 0.55, 0.05], [0.95, 0.2, 0.3], [0.98, 0.95, 0.9], [0.85, 0.3, 0.7], [0.98, 0.82, 0.15]][k % 5]; for (var i = 0; i < 9; i++) { var a = R() * TAU, r = R() * 0.12, h = 0.45 + R() * 0.35; K.cyl("food", [0.25, 0.45, 0.15], 0.006, 0.006, h, x + Math.cos(a) * r * 0.6, y + 0.3 + h / 2, z + Math.sin(a) * r * 0.6, 3); K.sph("food", cols, 0.045 + R() * 0.03, x + Math.cos(a) * r, y + 0.3 + h, z + Math.sin(a) * r, 6); } }
  function ristra(K, x, y, z, R) { K.cyl("cloth", [0.7, 0.6, 0.4], 0.008, 0.008, 1.5, x, y - 0.75, z, 3); for (var i = 0; i < 16; i++) { var yy = y - 0.12 - i * 0.085, a = i * 2.4; var g = new THREE.ConeGeometry(0.028, 0.16, 6); g.rotateZ(PI); K.place("food", g, [0.62 + R() * 0.1, 0.08, 0.05], x + Math.cos(a) * 0.05, yy, z + Math.sin(a) * 0.05, a, 0.4 * Math.cos(a), 0.4 * Math.sin(a)); } }

  // ───────────────────────── the Casa de la Cultura (Portal Norte bays 3..5): the mural of the two towns ─────────────────────────
  function buildCasa(K0, SO0, out) { var f = frames().norte, K = new XKit(K0, f.m4, f.yaw), SO = XSO(SO0, f), AF = SITE.AF, W = bayW(f), uL = f.u0 + W * 3 + 0.12, uR = f.u0 + W * 6 - 0.12, uc = (uL + uR) / 2, w0 = -ARC.D - 0.3, w1 = -ARC.D2, R = rng(36);
    K.box("saltillo", COL.sal, uR - uL, 0.1, w0 - w1, uc, AF - 0.05, (w0 + w1) / 2, 0, 1.2);
    var cy = AF + 4.6; K.box("wood", COL.wood, uR - uL, 0.06, w0 - w1, uc, cy + 0.03, (w0 + w1) / 2, 0, 1.4); for (var v = uL + 0.4; v < uR - 0.2; v += 0.7) K.place("wood", new THREE.CylinderGeometry(0.1, 0.11, w0 - w1, 8), COL.viga, v, cy - 0.1, (w0 + w1) / 2, 0, HP);
    // the mural in a cantera frame, a picture-light bar over it
    var mw = 6.6, mh = 4.4, my = AF + 0.25 + mh / 2; K.place("mural", new THREE.PlaneGeometry(mw, mh), COL.sal, uc, my, w1 + 0.04, 0);
    K.box("cantera", COL.cant, mw + 0.36, 0.18, 0.12, uc, my - mh / 2 - 0.06, w1 + 0.06, 0, 0.8); K.box("cantera", COL.cant, mw + 0.36, 0.16, 0.12, uc, my + mh / 2 + 0.07, w1 + 0.06, 0, 0.8); [-1, 1].forEach(function (sd) { K.box("cantera", COL.cant, 0.18, mh + 0.3, 0.12, uc + sd * (mw / 2 + 0.09), my, w1 + 0.06, 0, 0.8); });
    K.box("iron", COL.iron, mw * 0.8, 0.06, 0.08, uc, my + mh / 2 + 0.24, w1 + 0.35, 0); K.box("lamp", COL.cream, mw * 0.78, 0.02, 0.04, uc, my + mh / 2 + 0.2, w1 + 0.38, 0);
    GLOW.halos.push({ p: c2l3(f, uc, my + 0.6, w1 + 0.1), w: mw * 1.05, h: mh * 0.9, n: [0, 0, 1], f: f, col: [1, 0.78, 0.5], k: 0.55 });
    // tiled dado on the side walls, two benches facing the mural, two vitrines with pots, a lectern with the story
    [uL + 0.02, uR - 0.02].forEach(function (u, i) { K.box("talavera", COL.sal, 0.03, 1.0, w0 - w1 - 0.3, u + (i ? -0.015 : 0.015), AF + 0.5, (w0 + w1) / 2, 0, 1.2); });
    bench(K, SO, uc - 2.2, -7.6, PI, 2.4, true); bench(K, SO, uc + 2.2, -7.6, PI, 2.4, true);
    [uL + 1.1, uR - 1.1].forEach(function (u) { K.box("cantera", COL.cant, 0.9, 0.95, 0.9, u, AF + 0.475, -6.6, 0, 0.9); K.box("glass", COL.sal, 0.84, 0.72, 0.84, u, AF + 1.31, -6.6, 0); K.box("iron", COL.iron, 0.88, 0.03, 0.88, u, AF + 1.68, -6.6, 0);
      for (var p = 0; p < 3; p++) { var h = 0.22 + R() * 0.18, r = 0.08 + R() * 0.05; K.lathe("talavera", COL.sal, [[0, 0], [r * 0.7, 0], [r * 1.3, h * 0.5], [r * 0.6, h * 0.9], [r * 0.75, h], [0, h]], u - 0.22 + p * 0.22, AF + 0.95, -6.6 + (p % 2 ? 0.15 : -0.1), 12); }
      SO.push([u, -6.6, 0.95, 0.95, 0, AF + 1.7, 0, { noStep: true }]); });
    K.box("wood", COL.woodD, 0.5, 1.05, 0.08, uL + 0.9, AF + 0.6, -4.8, 0, 1.0); K.box("wood", COL.woodD, 0.62, 0.04, 0.42, uL + 0.9, AF + 1.16, -4.86, 0, 1.0, -0.35); var g = new THREE.PlaneGeometry(0.56, 0.36); var uv = sUV("plaque"), UA = g.attributes.uv; for (var i = 0; i < UA.count; i++) UA.setXY(i, uv[0] + UA.getX(i) * (uv[2] - uv[0]), uv[1] + UA.getY(i) * (uv[3] - uv[1])); K.place("signs", g, COL.sal, uL + 0.9, AF + 1.19, -4.84, 0, -HP - 0.35 + HP);
    SO.push([uL + 0.9, -4.82, 0.6, 0.45, 0, AF + 1.2, 0, { noStep: true }]);
    // the name over the three doors, a pool light inside for the night
    K.box("cantera", COL.cant, 6.2, 0.62, 0.08, uc, AF + 4.25, -ARC.D + 0.08, 0, 1.0); var g2 = new THREE.PlaneGeometry(5.9, 0.5); var uv2 = sUV("casa"), UB = g2.attributes.uv; for (var j = 0; j < UB.count; j++) UB.setXY(j, uv2[0] + UB.getX(j) * (uv2[2] - uv2[0]), uv2[1] + UB.getY(j) * (uv2[3] - uv2[1])); K.place("signs", g2, COL.sal, uc, AF + 4.25, -ARC.D + 0.125, 0);
    SIGN_DRAW.push(function (x) { plaque(x, SA.r.casa, C("names.casa", "Casa de la Cultura"), C("names.casaSub", "Douglas y Agua Prieta, dos pueblos, una plaza")); });
    SIGN_DRAW.push(function (x) { plaque(x, SA.r.plaque, C("names.mural", "El mural"), C("names.muralSub", "Two towns under one sky")); });
    out.casa = { mural: c2l3(f, uc, AF, -7.2), lectern: c2l3(f, uL + 0.9, AF, -5.3), light: c2l3(f, uc, AF + 3.6, -7.0) }; }

  // ───────────────────────── the corner: the Panaderia El Mirador, its tiled lookout tower, the corner bay of the two arcades ─────────────────────────
  function buildPanaderia(K, SO, out) { var AF = SITE.AF, R = rng(1906), wallC = COL.indigo, trim = COL.white;
    var x0 = 21, x1 = 31.8, z0 = -33.4, zm = -26.5, z1 = -22.5, xf = 25, H1 = 7.3, cy = AF + 3.5;
    var mz = function (x, z, a) { return a; };
    // exterior walls (stucco, indigo with white trim); the north and east faces have windows, the corner bay faces have the doors
    // north wall (outside -z), along x from x0 to x1
    var mN = new THREE.Matrix4().makeRotationY(PI); mN.premultiply(new THREE.Matrix4().makeTranslation(0, 0, z0 + 0.4));
    var wN = [[-x1, -1.6], [-x0 - 0.0, -1.6], [-x0, H1], [-x1, H1]].reverse(); var hN = [rectHole(-30.2, -28.8, AF + 1.4, AF + 2.6), rectHole(-24.6, -23.2, AF + 1.4, AF + 2.6), rectHole(-30.2, -28.8, AF + 4.3, AF + 5.6), rectHole(-24.6, -23.2, AF + 4.3, AF + 5.6)].map(function (h) { return h.map(function (q) { return [q[0], q[1]]; }); });
    wallAt(K, wN, hN, 0.4, mN, "stucco", wallC, "stucco", COL.cal, "stucco", trim, 2.5, [-1.6, 0.6, 0.2]);
    // east wall (outside +x), along z from z1 down to z0 (the wall frame a runs along -z: a = -z)
    var mE = new THREE.Matrix4().makeRotationY(HP); mE.premultiply(new THREE.Matrix4().makeTranslation(x1 - 0.4, 0, 0));
    var wE = [[22.5, -1.6], [33.4, -1.6], [33.4, H1], [22.5, H1]]; var hE = [archHole(23.6, 25.4, AF + 0.9, AF + 2.4, 10), archHole(27.6, 29.4, AF + 0.9, AF + 2.4, 10), archHole(30.6, 32.4, AF + 0.9, AF + 2.4, 10), rectHole(23.8, 25.2, AF + 4.3, AF + 5.6), rectHole(27.8, 29.2, AF + 4.2, AF + 5.7), rectHole(30.8, 32.2, AF + 4.3, AF + 5.6)];
    wallAt(K, wE, hE, 0.4, mE, "stucco", wallC, "stucco", COL.cal, "stucco", trim, 2.5, [-1.6, 0.6, 0.2]);
    // the corner bay faces: the main block's south face at z = zm (x 21..25, door A) and the front room's west face at x = xf (z -26.5..-22.5, door B)
    var mS = new THREE.Matrix4().makeTranslation(0, 0, zm - 0.3); wallAt(K, [[x0, 0], [xf + 0.3, 0], [xf + 0.3, H1], [x0, H1]], [archHole(22.2, 23.8, AF + 0.002, AF + 2.35, 12), rectHole(24.25, 24.75, AF + 4.4, AF + 5.5)], 0.3, mS, "stucco", wallC, "stucco", COL.cal, "stucco", trim, 2.5, [0, 1.0, 0.15]);
    var mW = new THREE.Matrix4().makeRotationY(-HP); mW.premultiply(new THREE.Matrix4().makeTranslation(xf - 0.3 + 0.3, 0, 0));
    wallAt(K, [[zm, 0], [z1 + 0.2, 0], [z1 + 0.2, H1], [zm, H1]], [archHole(-25.3, -23.7, AF + 0.002, AF + 2.35, 12)].map(function (h) { return h; }), 0.3, mW, "stucco", wallC, "stucco", COL.cal, "stucco", trim, 2.5, [0, 1.0, 0.15]);
    // the shared walls: west (x = 21, against the last Norte stall) and south of the front room (z = -22.5, against the cafe de olla)
    K.box("stucco", COL.cal, 0.26, H1, zm - z0, x0 + 0.13, H1 / 2, (z0 + zm) / 2, 0, 2.5); K.box("stucco", COL.cal, x1 - xf, H1, 0.26, (xf + x1) / 2, H1 / 2, z1 - 0.13, 0, 2.5);
    // trim: window surrounds (white), a cornice and parapet coping, the plinth
    K.box("cantera", COL.cantD, x1 - x0 + 0.3, 2.0, 0.1, (x0 + x1) / 2, -0.6, z0 - 0.05, 0, 0.9); K.box("cantera", COL.cantD, 0.1, 2.0, z1 - z0 + 0.3, x1 + 0.05, -0.6, (z0 + z1) / 2, 0, 0.9);
    K.box("cantera", COL.cant, x1 - x0 + 0.6, 0.22, 0.4, (x0 + x1) / 2, H1 - 0.75, z0 - 0.05, 0, 1.0); K.box("cantera", COL.cant, 0.4, 0.22, z1 - z0 + 0.6, x1 + 0.05, H1 - 0.75, (z0 + z1) / 2, 0, 1.0);
    K.box("tile", COL.sal, x1 - x0 + 0.5, 0.1, 0.55, (x0 + x1) / 2, H1 + 0.05, z0 + 0.2, 0, 0.9); K.box("tile", COL.sal, 0.55, 0.1, z1 - z0 + 0.5, x1 - 0.2, H1 + 0.05, (z0 + z1) / 2, 0, 0.9);
    K.box("tile", COL.sal, xf - x0 + 0.3, 0.1, 0.45, (x0 + xf) / 2, H1 + 0.05, zm - 0.15, 0, 0.9); K.box("tile", COL.sal, 0.45, 0.1, z1 - zm + 0.3, xf - 0.15, H1 + 0.05, (zm + z1) / 2, 0, 0.9);
    [[-29.5, AF + 2.0], [-23.9, AF + 2.0], [-29.5, AF + 4.95], [-23.9, AF + 4.95]].forEach(function (q) { var x = -q[0]; K.box("stucco", trim, 1.7, 0.12, 0.12, x, q[1] - 0.66, z0 - 0.03, 0); K.box("stucco", trim, 1.7, 0.12, 0.12, x, q[1] + 0.66, z0 - 0.03, 0); K.box("glass", COL.sal, 1.4, 1.2, 0.02, x, q[1], z0 + 0.2, 0); for (var b = -3; b <= 3; b++) K.cyl("iron", COL.iron, 0.012, 0.012, 1.2, x + b * 0.19, q[1], z0 - 0.04, 4); });
    // the east face: arched shop windows with rejas, upper windows with a little iron balcony in the middle
    [24.5, 28.5, 31.5].forEach(function (zz, i) { var z = -zz; K.box("glass", COL.sal, 0.02, 1.6, 1.8, x1 - 0.2, AF + 1.75, z, 0); for (var b = -3; b <= 3; b++) K.cyl("iron", COL.iron, 0.014, 0.014, 2.3, x1 + 0.04, AF + 1.95, z + b * 0.25, 4); K.box("cantera", COL.cant, 0.22, 0.08, 2.0, x1 + 0.06, AF + 0.86, z, 0, 0.8);
      K.box("glass", COL.sal, 0.02, 1.3, 1.4, x1 - 0.2, AF + 4.95, z, 0); K.box("stucco", trim, 0.12, 0.12, 1.8, x1 + 0.03, AF + 4.25, z, 0); K.box("stucco", trim, 0.12, 0.12, 1.8, x1 + 0.03, AF + 5.65, z, 0);
      if (i === 1) { K.box("cantera", COL.cant, 0.75, 0.12, 2.1, x1 + 0.37, AF + 4.18, z, 0, 0.8); for (var bb = -5; bb <= 5; bb++) K.cyl("iron", COL.iron, 0.012, 0.012, 0.9, x1 + 0.7, AF + 4.68, z + bb * 0.19, 4); K.box("iron", COL.iron, 0.04, 0.04, 2.1, x1 + 0.7, AF + 5.14, z, 0); [-1, 1].forEach(function (sd) { K.box("iron", COL.iron, 0.7, 0.04, 0.04, x1 + 0.37, AF + 5.14, z + sd * 1.04, 0); }); } });
    // the painted name over both doors and on the east face
    [[23.0, zm + 0.02, 0, "b20"], [xf + 0.02, -24.5, HP, "b21"]].forEach(function (q, i) { var g = new THREE.PlaneGeometry(2.62, 0.48); var uv = sUV(q[3]), UA = g.attributes.uv; for (var k = 0; k < UA.count; k++) UA.setXY(k, uv[0] + UA.getX(k) * (uv[2] - uv[0]), uv[1] + UA.getY(k) * (uv[3] - uv[1])); K.place("signs", g, COL.sal, q[0] + (i ? 0.01 : 0), AF + 2.95, q[1] + (i ? 0 : 0.01), q[2]); });
    SIGN_DRAW.push(function (x) { board(x, SA.r.b20, C("names.pan", "Panadería El Mirador"), C("names.panSub", "pan dulce del día"), { bg: "#f2e3c4", fg: "#2f4f9a", sh: "rgba(0,0,0,0.25)", edge: "#c2410c" }); board(x, SA.r.b21, C("names.pan", "Panadería El Mirador"), C("names.panSub", "pan dulce del día"), { bg: "#f2e3c4", fg: "#2f4f9a", sh: "rgba(0,0,0,0.25)", edge: "#c2410c" }); });
    // solids of the shell (the doorways stay open)
    SO.push([(x0 + x1) / 2, z0 + 0.2, x1 - x0, 0.42, -1.6, H1, 0, null]); SO.push([x1 - 0.2, (z0 + z1) / 2, 0.42, z1 - z0, -1.6, H1, 0, null]);
    SO.push([(x0 + 22.2) / 2, zm - 0.15, 22.2 - x0, 0.34, 0, H1, 0, null]); SO.push([(23.8 + xf) / 2, zm - 0.15, xf - 23.8 + 0.3, 0.34, 0, H1, 0, null]);
    SO.push([xf - 0.15, (zm + -25.3) / 2, 0.34, 1.2, 0, H1, 0, null]); SO.push([xf - 0.15, (-23.7 + z1) / 2, 0.34, 1.2, 0, H1, 0, null]);
    SO.push([x0 + 0.13, (z0 + zm) / 2, 0.3, zm - z0, 0, H1, 0, null]); SO.push([(xf + x1) / 2, z1 - 0.13, x1 - xf, 0.3, 0, H1, 0, null]);
    // the interior: one L-shaped room (the shop at the front, the bakery behind with the oven, two little tables)
    K.box("saltillo", COL.sal, x1 - x0 - 0.6, 0.1, zm - z0 - 0.5, (x0 + x1) / 2, AF - 0.05, (z0 + zm) / 2, 0, 1.2); K.box("saltillo", COL.sal, x1 - xf - 0.5, 0.1, z1 - zm, (xf + x1) / 2, AF - 0.05, (zm + z1) / 2, 0, 1.2);
    K.box("wood", COL.wood, x1 - x0 - 0.6, 0.06, zm - z0 - 0.5, (x0 + x1) / 2, cy + 0.03, (z0 + zm) / 2, 0, 1.4); K.box("wood", COL.wood, x1 - xf - 0.5, 0.06, z1 - zm, (xf + x1) / 2, cy + 0.03, (zm + z1) / 2, 0, 1.4);
    for (var v = x0 + 0.6; v < x1 - 0.3; v += 0.75) K.place("wood", new THREE.CylinderGeometry(0.09, 0.1, zm - z0, 8), COL.viga, v, cy - 0.09, (z0 + zm) / 2, 0, HP);
    K.box("wood", COL.viga, x1 - xf, 0.26, 0.26, (xf + x1) / 2, cy - 0.13, zm, 0, 1.0);
    // the counter with its glass case of pan dulce, the bread racks behind, the register
    var cx = 29.4; K.box("wood", COL.woodD, 0.7, 0.92, 3.4, cx, AF + 0.46, -24.6, 0, 1.0); K.box("glass", COL.sal, 0.66, 0.5, 3.3, cx, AF + 1.18, -24.6, 0); K.box("wood", COL.wood, 0.76, 0.04, 3.46, cx, AF + 1.45, -24.6, 0, 1.0);
    for (var tr = 0; tr < 2; tr++) { K.box("enamel", [0.6, 0.6, 0.6], 0.6, 0.02, 3.2, cx, AF + 0.97 + tr * 0.25, -24.6, 0); for (var pc = 0; pc < 10; pc++) concha(K, cx - 0.15 + (pc % 2) * 0.3, AF + 0.98 + tr * 0.25, -26.0 + pc * 0.31, R); }
    K.box("iron", COL.iron, 0.3, 0.25, 0.35, cx, AF + 1.6, -23.3, 0); SO.push([cx, -24.6, 0.8, 3.5, 0, AF + 1.48, 0, { noStep: true, counter: "pan" }]);
    var g3 = new THREE.PlaneGeometry(3.3, 2.5); var U3 = g3.attributes.uv; for (var q3 = 0; q3 < U3.count; q3++) U3.setXY(q3, 0.01 + U3.getX(q3) * 0.48, 0.51 + U3.getY(q3) * 0.48); K.place("goods2", g3, COL.sal, x1 - 0.42, AF + 1.6, -24.6, -HP);
    for (var sh = 0; sh < 4; sh++) K.box("wood", COL.woodD, 0.42, 0.04, 3.4, x1 - 0.62, AF + 0.45 + sh * 0.62, -24.6, 0, 1.0);
    // the bakery: the brick oven with its glowing mouth, a work table with trays, flour sacks, the cafe corner with two tables
    var ox = 29.4, oz = -31.4; K.box("saltillo", mulCol(COL.sal, 0.62), 3.2, 1.6, 2.6, ox, AF + 0.8, oz, 0, 0.6); K.lathe("saltillo", mulCol(COL.sal, 0.6), [[0, 2.2], [0.9, 2.15], [1.4, 1.8], [1.55, 1.6], [0.0, 1.6]], ox, AF, oz, 14); K.cyl("saltillo", mulCol(COL.sal, 0.55), 0.22, 0.25, 2.6, ox + 0.9, AF + 2.9, oz - 0.6, 8);
    K.box("glowK", [0.3, 0.12, 0.05], 0.9, 0.55, 0.05, ox, AF + 1.05, oz + 1.31, 0); out.oven = [ox, AF + 1.05, oz + 1.5];
    K.box("wood", COL.wood, 2.6, 0.08, 1.1, 26.6, AF + 0.9, -30.6, 0, 1.0); [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sz) { K.box("wood", COL.woodD, 0.07, 0.86, 0.07, 26.6 + sx * 1.2, AF + 0.43, -30.6 + sz * 0.48, 0); }); });
    for (var t2 = 0; t2 < 3; t2++) { K.box("enamel", [0.62, 0.62, 0.6], 0.62, 0.02, 0.42, 25.9 + t2 * 0.7, AF + 0.95, -30.6, 0); for (var b2 = 0; b2 < 4; b2++) concha(K, 25.75 + t2 * 0.7 + (b2 % 2) * 0.3, AF + 0.96, -30.75 + Math.floor(b2 / 2) * 0.3, R); }
    for (var fs = 0; fs < 3; fs++) K.box("cloth", [0.9, 0.86, 0.76], 0.55, 0.75, 0.38, 25.5 + fs * 0.6, AF + 0.375, -32.6, (R() - 0.5) * 0.3, 0);
    SO.push([ox, oz, 3.3, 2.7, 0, AF + 2.2, 0, { noStep: true }]); SO.push([26.6, -30.6, 2.7, 1.2, 0, AF + 0.95, 0, { noStep: true }]);
    [[22.6, -29.6], [22.6, -32.0]].forEach(function (q) { K.cyl("iron", COL.iron, 0.04, 0.05, 0.72, q[0], AF + 0.36, q[1], 8); K.cyl("talavera", COL.sal, 0.4, 0.4, 0.04, q[0], AF + 0.74, q[1], 16); SO.push([q[0], q[1], 0.8, 0.8, 0, AF + 0.76, 0, { noStep: true }]); [0, PI].forEach(function (a) { chairAF(K, SO, q[0] + Math.sin(a) * 0.68, q[1] + Math.cos(a) * 0.68, a + PI, AF); }); });
    // the corner bay of the two arcades: saltillo floor, vigas, a lantern; the roof over it
    K.box("saltillo", COL.sal, xf - x0 + 0.25, 0.12, z1 - zm, (x0 + xf) / 2, AF - 0.06, (zm + z1) / 2, 0, 1.2);
    for (var vv = x0 + 0.35; vv < xf; vv += 0.64) K.place("wood", new THREE.CylinderGeometry(0.1, 0.11, z1 - zm + 0.2, 8), COL.viga, vv, ARC.ceil - 0.11, (zm + z1) / 2, 0, HP);
    K.box("wood", COL.wood, xf - x0 + 0.2, 0.05, z1 - zm + 0.2, (x0 + xf) / 2, ARC.ceil + 0.02, (zm + z1) / 2, 0, 1.4); K.box("saltillo", mulCol(COL.sal, 0.78), xf - x0 + 0.5, 0.1, z1 - zm + 0.6, (x0 + xf) / 2, ARC.cor - 0.05, (zm + z1) / 2, 0, 0.9);
    tinLantern(K, (x0 + xf) / 2, 3.9, (zm + z1) / 2, 1.2); out.lanterns.push([(x0 + xf) / 2, 4.15, (zm + z1) / 2]); GLOW.pools.push([(x0 + xf) / 2, (zm + z1) / 2, 2.6, [1, 0.72, 0.42], AF + 0.012]);
    // the roofs: the main block and the front room (brick), the mirador tower over the bakery
    K.box("saltillo", mulCol(COL.sal, 0.78), x1 - x0 + 0.2, 0.12, zm - z0 + 0.2, (x0 + x1) / 2, H1 - 0.5, (z0 + zm) / 2, 0, 0.9); K.box("saltillo", mulCol(COL.sal, 0.78), x1 - xf + 0.2, 0.12, z1 - zm + 0.2, (xf + x1) / 2, H1 - 0.5, (zm + z1) / 2, 0, 0.9);
    buildMirador(K, SO, 28.4, -29.9, H1 - 0.45, out);
    out.panCounter = [cx - 1.0, AF, -24.6]; out.panBaker = [cx + 0.75, AF, -24.4];
    out.panLight = [27.5, AF + 3.0, -27.5]; out.panIn = [[x0 + 0.3, x1 - 0.3, z0 + 0.3, zm], [xf + 0.3, x1 - 0.3, zm - 0.1, z1 - 0.2]];
  }
  function chairAF(K, SO, x, z, face, AF) { var c0 = K, saved = [], n0 = SO.length; var tmp = new Kit(); chair(tmp, SO, x, z, face); for (var b in tmp.m) tmp.m[b].forEach(function (g) { g.translate(0, AF, 0); K.add(b, g); }); for (var i = n0; i < SO.length; i++) { SO[i][4] += AF; SO[i][5] += AF; } }
  function concha(K, x, y, z, R) { var cols = [[0.95, 0.7, 0.75], [0.96, 0.86, 0.55], [0.55, 0.36, 0.24], [0.94, 0.9, 0.8]], c = cols[Math.floor(R() * cols.length)]; K.sph("food", [0.82, 0.58, 0.36], 0.11, x, y + 0.02, z, 9, 1, 0.42, 1); K.sph("food", c, 0.105, x, y + 0.045, z, 9, 1, 0.36, 1); }
  // the mirador: a square lookout over the bakery, two arches a side, a cornice, a tiled pyramid roof and a biplane weathervane
  function buildMirador(K, SO, cx, cz, y0, out) { var s = 5.2, h = 2.9, t = 0.35, R = rng(77), y1 = y0 + h;
    for (var sd = 0; sd < 4; sd++) { var ry = sd * HP, m = new THREE.Matrix4().makeRotationY(ry); m.premultiply(new THREE.Matrix4().makeTranslation(cx, 0, cz)); var off = new THREE.Matrix4().makeTranslation(0, 0, s / 2 - t); var mm = m.clone().multiply(off);
      wallAt(K, [[-s / 2, y0], [s / 2 - t, y0], [s / 2 - t, y1], [-s / 2, y1]], [archHole(-1.85, -0.55, y0 + 0.6, y0 + 1.7, 12), archHole(0.55, 1.85, y0 + 0.6, y0 + 1.7, 12)], t, mm, "stucco", COL.white, "stucco", COL.cal, "stucco", COL.white, 2.5, null);
      var bal = new THREE.Matrix4().makeTranslation(0, 0, s / 2 + 0.02); var mb = m.clone().multiply(bal); var gb = new THREE.BoxGeometry(s + 0.3, 0.22, 0.4); gb.translate(0, y0 + 0.11, -0.1); K.add("cantera", gb, COL.cant, mb); var gc = new THREE.BoxGeometry(s + 0.5, 0.25, 0.45); gc.translate(0, y1 + 0.12, -0.12); K.add("cantera", gc, COL.cant, mb);
      [-1.2, 1.2].forEach(function (ax) { for (var b = -2; b <= 2; b++) { var gi = new THREE.CylinderGeometry(0.012, 0.012, 0.75, 4); gi.translate(ax + b * 0.2, y0 + 0.98, -t / 2); K.add("iron", gi, COL.iron, mm); } }); }
    K.box("wood", COL.wood, s - 0.4, 0.06, s - 0.4, cx, y0 + 0.03, cz, 0, 1.2);
    // the pyramid roof in barrel tile (four sloped faces), the ridge caps, a lantern ball and the weathervane
    var hr = 1.9, ov = 0.45, a = s / 2 + ov, yb = y1 + 0.25;
    for (var f = 0; f < 4; f++) { var ang = f * HP, cs = Math.cos(ang), sn = Math.sin(ang), P = function (x, z) { return [cx + x * cs + z * sn, cz - x * sn + z * cs]; };
      var A = P(-a, a), B = P(a, a), T = P(0, 0); var gq = new THREE.BufferGeometry(); gq.setAttribute("position", new THREE.Float32BufferAttribute([A[0], yb, A[1], B[0], yb, B[1], T[0], yb + hr, T[1]], 3)); gq.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2 * a / 2.2, 0, a / 2.2, Math.hypot(a, hr) / 2.2], 2)); gq.computeVertexNormals(); K.add("tile", gq, COL.sal);
      var E = P(a, a); K.tube("cantera", COL.cant, V3(E[0], yb + 0.02, E[1]), V3(cx, yb + hr + 0.02, cz), 0.07, 6); }
    K.sph("tin", COL.gold, 0.16, cx, yb + hr + 0.18, cz, 10); K.cyl("iron", COL.iron, 0.02, 0.02, 0.9, cx, yb + hr + 0.62, cz, 4);
    var vy = yb + hr + 0.95; K.box("iron", COL.iron, 0.9, 0.05, 0.08, cx, vy, cz, 0.6); K.box("iron", COL.iron, 0.12, 0.06, 0.9, cx + 0.12, vy + 0.06, cz - 0.08, 0.6); K.box("iron", COL.iron, 0.1, 0.05, 0.6, cx + 0.12, vy - 0.1, cz - 0.08, 0.6); K.box("iron", COL.iron, 0.04, 0.28, 0.25, cx - 0.42, vy + 0.06, cz + 0.27, 0.6);
    [["N", 0, -1], ["S", 0, 1], ["E", 1, 0], ["W", -1, 0]].forEach(function (q) { K.box("iron", COL.iron, 0.02, 0.02, 0.5, cx + q[1] * 0.25, vy - 0.3, cz + q[2] * 0.25, Math.atan2(q[1], q[2])); });
    out.mirador = [cx, y1, cz]; }

  // ───────────────────────── the gateway (Portal Oriente bay 5): the passage to Silver Street, its cantera surround and the bell gable ─────────────────────────
  function buildGateway(K0, SO0, out) { var f = frames().oriente, K = new XKit(K0, f.m4, f.yaw), SO = XSO(SO0, f), AF = SITE.AF, W = bayW(f), uL = -W / 2 + 0.11, uR = W / 2 - 0.11, w0 = -ARC.D - 0.3, w1 = -ARC.D2;
    K.box("saltillo", COL.sal, uR - uL, 0.1, w0 - w1 + 0.4, 0, AF - 0.05, (w0 + w1) / 2 - 0.2, 0, 1.2);
    K.box("cantera", COL.cant, 3.5, AF * 0.55, 0.62, 0, AF * 0.275, w1 - 0.71, 0, 1.0);
    // the barrel vault (painted) over the passage, the lantern
    var vr = (uR - uL) / 2, vy = AF + 3.0; var gv = new THREE.CylinderGeometry(vr, vr, w0 - w1, 16, 1, true, -HP, PI).toNonIndexed(); gv.rotateX(-HP); flipGeo(gv);
    K.place("stucco", gv, COL.cal, 0, vy, (w0 + w1) / 2, 0);
    tinLantern(K, 0, vy + 0.5, (w0 + w1) / 2, 1.1); var lp = c2l3(f, 0, vy + 0.75, (w0 + w1) / 2); out.lanterns.push(lp); GLOW.pools.push([lp[0], lp[2], 2.4, [1, 0.72, 0.42], AF + 0.012]);
    // the outer surround on Silver Street side (w < -10.9): pilasters, entablature with the name, talavera spandrels, the bell gable
    var wo = w1 - 0.4, Wd = function (w) { return wo - w; };
    [-1, 1].forEach(function (sd) { K.box("cantera", COL.cant, 0.62, 5.25, 0.22, sd * 2.6, 2.625, wo - 0.11, 0, 0.9); K.box("cantera", COL.cantD, 0.8, 0.4, 0.3, sd * 2.6, 0.2, wo - 0.15, 0, 0.9); K.box("cantera", COL.cant, 0.78, 0.2, 0.32, sd * 2.6, 5.3, wo - 0.16, 0, 0.9); });
    archRing(K, "cantera", COL.cant, 0, AF + 3.0, 1.75, 2.12, 0.12, new THREE.Matrix4().makeRotationY(PI).premultiply(new THREE.Matrix4().makeTranslation(0, 0, wo)), 18);
    K.box("cantera", COL.cant, 0.42, 0.62, 0.2, 0, AF + 3.0 + 2.0, wo - 0.1, 0, 0.6);
    K.box("cantera", COL.cant, 6.0, 0.7, 0.3, 0, 5.75, wo - 0.15, 0, 1.0); var g = new THREE.PlaneGeometry(4.9, 0.62); var uv = sUV("gate"), UA = g.attributes.uv; for (var q = 0; q < UA.count; q++) UA.setXY(q, uv[0] + UA.getX(q) * (uv[2] - uv[0]), uv[1] + UA.getY(q) * (uv[3] - uv[1])); K.place("signs", g, COL.sal, 0, 5.75, wo - 0.31, PI);
    SIGN_DRAW.push(function (x) { gateBoard(x, SA.r.gate, C("names.gate", "MERCADO PLAZA"), C("names.gateSub", "DOUGLAS · AGUA PRIETA")); });
    // the bell gable (espadana) over the parapet: a curved outline with an arched opening, the bell, a finial
    var pts = [[-2.7, 6.6], [2.7, 6.6], [2.7, 7.25], [2.2, 7.4], [1.75, 7.9], [1.25, 8.6], [0.75, 9.15], [0.3, 9.4], [0, 9.48], [-0.3, 9.4], [-0.75, 9.15], [-1.25, 8.6], [-1.75, 7.9], [-2.2, 7.4], [-2.7, 7.25]];
    var mG = new THREE.Matrix4().makeRotationY(PI); mG.premultiply(new THREE.Matrix4().makeTranslation(0, 0, w1 - 0.1)); wallAt(K, pts.map(function (q) { return [-q[0], q[1]]; }).reverse(), [archHole(-0.5, 0.5, 7.5, 8.35, 12)], 0.5, mG, "stucco", COL.terra, "stucco", COL.terra, "cantera", COL.cant, 2.5, null);
    K.box("cantera", COL.cant, 5.6, 0.16, 0.62, 0, 6.62, w1 - 0.35, 0, 0.8); K.place("talavera", new THREE.PlaneGeometry(1.8, 0.55), COL.sal, 0, 7.1, w1 - 0.62, PI); K.sph("cantera", COL.cant, 0.2, 0, 9.66, w1 - 0.35, 10); K.lathe("enamel", [0.5, 0.36, 0.18], [[0, 0.55], [0.08, 0.52], [0.16, 0.38], [0.22, 0.1], [0.3, 0.0], [0.0, 0.02]], 0, 7.55, w1 - 0.35, 14); K.box("wood", COL.woodD, 1.0, 0.1, 0.12, 0, 8.2, w1 - 0.35, 0, 1.0);
    // solids: the passage is open (the stall side walls bound it), the pilasters
    [-1, 1].forEach(function (sd) { SO.push([sd * 2.6, wo - 0.11, 0.66, 0.26, 0, 5.3, 0, null]); });
    out.gate = { inner: c2l3(f, 0, AF, -ARC.D), outer: c2l3(f, 0, 0, wo - 0.8), bell: c2l3(f, 0, 7.6, w1 - 0.35) }; }

  // ───────────────────────── arcade ends: the Portal Norte's closed west end with a grille window ─────────────────────────
  function buildEnds(K, SO) { var AF = SITE.AF; K.box("stucco", COL.ochre, 0.42, ARC.par + 1.6, ARC.D2 + 0.6, -19.42, (ARC.par - 1.6) / 2, -22.5 - ARC.D2 / 2 + 0.05, 0, 2.5);
    K.box("cantera", COL.cantD, 0.1, 2.0, ARC.D2 + 0.7, -19.68, -0.6, -22.5 - ARC.D2 / 2 + 0.05, 0, 0.9);
    K.box("cloth", [0.07, 0.07, 0.08], 0.02, 1.2, 1.5, -19.645, AF + 2.1, -24.4, 0); for (var b = -3; b <= 3; b++) K.cyl("iron", COL.iron, 0.014, 0.014, 1.3, -19.7, AF + 2.1, -24.4 + b * 0.2, 4); K.box("cantera", COL.cant, 0.22, 0.08, 1.7, -19.72, AF + 1.45, -24.4, 0, 0.8);
    SO.push([-19.42, -22.5 - ARC.D2 / 2 + 0.05, 0.44, ARC.D2 + 0.6, -1.6, ARC.par, 0, null]);
    // the Portal Oriente's south end: the stall row's end wall (terracotta) and a planter in the arcade end
    K.box("stucco", COL.terra, ARC.D2 - ARC.D + 0.4, ARC.par + 1.6, 0.42, 21 + (ARC.D + ARC.D2) / 2 + 0.1, (ARC.par - 1.6) / 2, 22.5 + 0.21, 0, 2.5);
    SO.push([21 + (ARC.D + ARC.D2) / 2 + 0.1, 22.5 + 0.21, ARC.D2 - ARC.D + 0.4, 0.44, -1.6, ARC.par, 0, null]); }

  // ───────────────────────── the square: cantera paving, saltillo paths and rings, the seat wall, the tree ring, lamps ─────────────────────────
  function flatPoly(K, b, col, pts, y, t, rot) { var sh = shapeFrom(pts); var g = new THREE.ShapeGeometry(sh); g.rotateX(HP); var p = g.attributes.position; for (var i = 0; i < p.count; i++) p.setY(i, y); g = g.toNonIndexed(); var n = g.attributes.normal; for (var j = 0; j < n.count; j++) n.setXYZ(j, 0, 1, 0);
    var pp = g.attributes.position; for (var k = 0; k < pp.count; k += 3) { var ax = pp.getX(k + 1), az = pp.getZ(k + 1); pp.setXYZ(k + 1, pp.getX(k + 2), y, pp.getZ(k + 2)); pp.setXYZ(k + 2, ax, y, az); } uvWorld(g, t || 1.2, "y"); if (rot) { var uv = g.attributes.uv; for (var q = 0; q < uv.count; q++) { var u = uv.getX(q), v = uv.getY(q); uv.setXY(q, u * Math.cos(rot) - v * Math.sin(rot), u * Math.sin(rot) + v * Math.cos(rot)); } } return K.add(b, g, col); }
  function ring(K, b, col, cx, cz, r0, r1, y, seg, t) { var pts = [], hole = []; seg = seg || 48; for (var i = 0; i < seg; i++) { var a = i / seg * TAU; pts.push([cx + Math.cos(a) * r1, cz + Math.sin(a) * r1]); hole.push([cx + Math.cos(a) * r0, cz + Math.sin(a) * r0]); }
    var sh = shapeFrom(pts); if (r0 > 0) sh.holes.push(pathFrom(hole.slice().reverse())); var g = new THREE.ShapeGeometry(sh); g.rotateX(HP); var p = g.attributes.position; for (var k = 0; k < p.count; k++) p.setY(k, y); g = g.toNonIndexed(); var pp = g.attributes.position, n = g.attributes.normal;
    for (var j = 0; j < pp.count; j += 3) { var ax = pp.getX(j + 1), az = pp.getZ(j + 1); pp.setXYZ(j + 1, pp.getX(j + 2), y, pp.getZ(j + 2)); pp.setXYZ(j + 2, ax, y, az); } for (var m = 0; m < n.count; m++) n.setXYZ(m, 0, 1, 0); uvWorld(g, t || 1.2, "y"); return K.add(b, g, col); }
  function buildSquare(K, SO, out) { var S = SITE, sq = S.sq, R = rng(2026), kx = S.kio[0], kz = S.kio[1], fx = S.fnt[0], fz = S.fnt[1];
    // the field: a 1 m grid of cantera slabs (vertex tone: lighter in the middle, a little darker toward the portales)
    var nx = 40, nz = 45, g = new THREE.PlaneGeometry(sq[1] - sq[0], sq[3] - sq[2], nx, nz); g.rotateX(-HP); g.translate((sq[0] + sq[1]) / 2, 0.03, (sq[2] + sq[3]) / 2); var cl = new Float32Array(g.attributes.position.count * 3), P = g.attributes.position;
    for (var i = 0; i < P.count; i++) { var x = P.getX(i), z = P.getZ(i), e = Math.min(x - sq[0], sq[1] - x, z - sq[2], sq[3] - z), k = 0.93 + 0.07 * sstep(0, 9, e) + (R() - 0.5) * 0.025; cl[i * 3] = k; cl[i * 3 + 1] = k * 0.995; cl[i * 3 + 2] = k * 0.985; }
    g.setAttribute("color", new THREE.BufferAttribute(cl, 3)); uvWorld(g.toNonIndexed ? g : g, 2.4, "y"); K.add("paving", g);
    // the saltillo axes (3.2 m) from the kiosco ring to the edges, a dark tile border on both sides; the rings round the kiosco and the fountain
    var yo = 0.045, dark = [0.55, 0.42, 0.36];
    var axes = [[kx - 1.6, kx + 1.6, sq[2], kz - 7.0], [kx - 1.6, kx + 1.6, kz + 7.0, sq[3]], [kx + 7.0, sq[1], kz - 1.6, kz + 1.6], [fx + 4.4, kx - 7.0, kz - 1.6, kz + 1.6], [sq[0], fx - 4.4, kz - 1.6, kz + 1.6]];
    axes.forEach(function (a) { flatPoly(K, "salOv", COL.sal, [[a[0], a[2]], [a[1], a[2]], [a[1], a[3]], [a[0], a[3]]], yo, 1.2); var hz = a[1] - a[0] > a[3] - a[2]; if (hz) { flatPoly(K, "salOv", dark, [[a[0], a[2] - 0.14], [a[1], a[2] - 0.14], [a[1], a[2]], [a[0], a[2]]], yo, 0.6); flatPoly(K, "salOv", dark, [[a[0], a[3]], [a[1], a[3]], [a[1], a[3] + 0.14], [a[0], a[3] + 0.14]], yo, 0.6); } else { flatPoly(K, "salOv", dark, [[a[0] - 0.14, a[2]], [a[0], a[2]], [a[0], a[3]], [a[0] - 0.14, a[3]]], yo, 0.6); flatPoly(K, "salOv", dark, [[a[1], a[2]], [a[1] + 0.14, a[2]], [a[1] + 0.14, a[3]], [a[1], a[3]]], yo, 0.6); } });
    ring(K, "salOv", COL.sal, kx, kz, 5.25, 7.0, yo, 64, 1.2); ring(K, "salOv", dark, kx, kz, 7.0, 7.16, yo, 64, 0.6); ring(K, "salOv", COL.sal, fx, fz, 3.15, 4.4, yo, 48, 1.2); ring(K, "salOv", dark, fx, fz, 4.4, 4.56, yo, 48, 0.6);
    // a talavera rosette inlaid at the four path crossings with the kiosco ring
    [[kx, kz - 6.1], [kx, kz + 6.1], [kx + 6.1, kz], [kx - 6.1, kz]].forEach(function (q) { var gq = new THREE.PlaneGeometry(1.2, 1.2); gq.rotateX(-HP); K.place("talavera", gq, COL.sal, q[0], yo + 0.004, q[1], PI / 4); });
    // the west seat wall (cantera, a talavera face), three openings; the cantera kerb along the south edge between the food stalls
    var xw = sq[0] - 0.2, gaps = [[-16.8, -14.2], [-3.2, 3.2], [14.2, 16.8]], z0 = sq[2], segs = []; gaps.forEach(function (gp) { segs.push([z0, gp[0]]); z0 = gp[1]; }); segs.push([z0, sq[3]]);
    segs.forEach(function (sg) { var zc = (sg[0] + sg[1]) / 2, L = sg[1] - sg[0]; if (L < 0.4) return; K.box("cantera", COL.cant, 0.5, 2.0, L, xw, -0.55, zc, 0, 1.0); K.box("cantera", COL.cant, 0.62, 0.08, L + 0.04, xw, 0.49, zc, 0, 1.0); K.box("talavera", COL.sal, 0.02, 0.3, L - 0.1, xw + 0.26, 0.26, zc, 0, 1.2);
      so(SO, xw, zc, 0.6, L, -1.6, 0.53, 0, { seat: true, face: HP, noStep: true }); });
    K.box("cantera", COL.cantD, sq[1] - sq[0], 0.16, 0.22, (sq[0] + sq[1]) / 2, 0.02, sq[3] + 0.11, 0, 0.8);
    // the tree ring: eight tiled planters (mesquite) at r 10 round the kiosco, four benches on the diagonals facing it, lamp posts behind
    out.trees = []; out.lamps = [];
    for (var t = 0; t < 8; t++) { var a = (22.5 + t * 45) * PI / 180, px = kx + Math.cos(a) * 10, pz = kz + Math.sin(a) * 10; planter(K, SO, px, pz, 1.6, -a); out.trees.push([px, pz, 0.47]); }
    for (var b = 0; b < 4; b++) { var ab = (45 + b * 90) * PI / 180, bx = kx + Math.cos(ab) * 9.6, bz = kz + Math.sin(ab) * 9.6, face = Math.atan2(kx - bx, kz - bz); bench(K, SO, bx, bz, face, 2.6, true);
      var lx = kx + Math.cos(ab) * 12.4, lz = kz + Math.sin(ab) * 12.4; var gl = lampPost(K, SO, lx, lz); gl.forEach(function (q) { GLOW.lamps.push(q); }); out.lamps.push([lx, lz]); GLOW.pools.push([lx, lz, 4.8, [1, 0.8, 0.52], 0.05]); }
    // fan palms at the square's four corners in round tiled planters with seats round them
    out.palms = []; [[sq[0] + 3.4, sq[2] + 4.0], [sq[1] - 3.6, sq[2] + 4.0], [sq[0] + 3.0, 5.8], [sq[1] - 3.4, 5.8]].forEach(function (q) { K.cyl("talavera", COL.sal, 1.05, 1.05, 0.44, q[0], 0.22, q[1], 20); K.cyl("cantera", COL.cant, 1.16, 1.16, 0.08, q[0], 0.48, q[1], 20); K.cyl("cloth", COL.soil, 0.95, 0.95, 0.02, q[0], 0.5, q[1], 16);
      so(SO, q[0], q[1], 1.9, 1.9, 0, 0.52, PI / 4, { noStep: true }); so(SO, q[0], q[1], 1.9, 1.9, 0, 0.52, 0, { noStep: true }); out.palms.push([q[0], q[1], 0.5]); });
    // the kiosco and the fountain
    K.box("paving", COL.sal, 1.9, 0.06, 7.2, 33.47, 0.0, 0, 0, 2.4); K.box("cantera", COL.cantD, 0.16, 0.16, 7.4, 34.45, 0.02, 0, 0, 0.8);
    buildKiosco(K, SO, out, kx, kz); buildFountain(K, SO, out, fx, fz); }

  // ───────────────────────── the kiosco: an octagonal cast-iron bandstand on a cantera base, a bell dome, the lantern ─────────────────────────
  function buildKiosco(K, SO, out, cx, cz) { var R0 = 5.0, ap = R0 * Math.cos(PI / 8), Hb = 1.0, Hc = 4.4, rc = 4.5, a0 = PI / 8, white = COL.ironW, R = rng(3);
    var V = function (k, r) { var a = a0 + k * PI / 4; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; };
    // the base: eight cantera panels with a talavera band, the coping, the platform floor (saltillo)
    var oct = []; for (var k = 0; k < 8; k++) oct.push(V(k, R0)); flatPoly(K, "saltillo", COL.sal, oct, Hb, 1.2); var octC = []; for (var k1 = 0; k1 < 8; k1++) octC.push(V(k1, R0 + 0.12));
    for (var s = 0; s < 8; s++) { var A = V(s, R0), B = V(s + 1, R0), mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2, L = Math.hypot(B[0] - A[0], B[1] - A[1]), ry = Math.atan2(B[0] - A[0], B[1] - A[1]) + HP, nrm = (s * 45 + 45) * PI / 180;
      var stair = s === 1 || s === 5; if (stair) { var half = (L - 2.6) / 2; [-1, 1].forEach(function (sd) { var ox = mx - Math.cos(nrm) * 0.2 + Math.cos(nrm + HP) * sd * (1.3 + half / 2), oz = mz - Math.sin(nrm) * 0.2 + Math.sin(nrm + HP) * sd * (1.3 + half / 2); K.box("cantera", COL.cant, half, Hb + 0.4, 0.4, ox, (Hb - 0.4) / 2, oz, ry, 1.0); so(SO, ox, oz, half, 0.4, -0.4, Hb, ry, null); }); }
      else { K.box("cantera", COL.cant, L + 0.02, Hb + 0.4, 0.4, mx - Math.cos(nrm) * 0.2, (Hb - 0.4) / 2, mz - Math.sin(nrm) * 0.2, ry, 1.0); K.box("talavera", COL.sal, L - 0.5, 0.36, 0.02, mx + Math.cos(nrm) * 0.005, 0.5, mz + Math.sin(nrm) * 0.005, ry, 1.2); so(SO, mx - Math.cos(nrm) * 0.3, mz - Math.sin(nrm) * 0.3, L, 0.6, -0.4, Hb, ry, null); }
      K.box("cantera", COL.cant, L + 0.12, 0.08, 0.32, mx - Math.cos(nrm) * 0.1, Hb + 0.04, mz - Math.sin(nrm) * 0.1, ry, 1.0);
      // the stair on the north and south faces: five treads, cantera stringers, iron rails
      if (stair) { var dx = Math.cos(nrm), dz = Math.sin(nrm), rise = Hb / 5; for (var st = 0; st < 5; st++) { var d0 = st * 0.3, y1 = Hb - rise * st; K.box("cantera", COL.cant, 2.6, y1, 0.3, mx + dx * (d0 + 0.15), y1 / 2, mz + dz * (d0 + 0.15), ry, 0.8); }
        [-1, 1].forEach(function (sd) { var sx = mx + Math.cos(nrm + HP) * sd * 1.42, sz = mz + Math.sin(nrm + HP) * sd * 1.42; var gb = new THREE.BoxGeometry(0.24, Hb + 0.1, 1.5); gb.translate(0, (Hb + 0.1) / 2 - 0.05, 0.75); var hgt = gb.attributes.position; for (var q = 0; q < hgt.count; q++) { var zz = hgt.getZ(q); if (hgt.getY(q) > 0.2) hgt.setY(q, (Hb + 0.05) * (1 - zz / 1.5) + 0.1); } gb.computeVertexNormals(); K.place("cantera", gb, COL.cant, sx, 0, sz, Math.atan2(dx, dz)); so(SO, sx + dx * 0.75, sz + dz * 0.75, 0.26, 1.5, 0, Hb + 0.15, Math.atan2(dx, dz), { noStep: true });
          K.tube("iron", white, V3(sx, Hb + 0.95, sz), V3(sx + dx * 1.45, 0.95, sz + dz * 1.45), 0.025, 6); for (var pq = 0; pq <= 3; pq++) { var t = pq / 3, px2 = sx + dx * 1.45 * t, pz2 = sz + dz * 1.45 * t; K.cyl("iron", white, 0.02, 0.02, 0.95, px2, (Hb * (1 - t)) + 0.47, pz2, 5); } });
        out.stairs = out.stairs || []; out.stairs.push({ x: mx, z: mz, dx: dx, dz: dz, ry: ry }); } }
    // eight cast-iron columns with capitals and brackets, the railing between them (open at the stairs)
    for (var c = 0; c < 8; c++) { var p = V(c, rc); K.box("iron", white, 0.3, 0.12, 0.3, p[0], Hb + 0.06, p[1], a0 + c * PI / 4); K.cyl("iron", white, 0.085, 0.1, Hc - Hb - 0.3, p[0], Hb + (Hc - Hb - 0.3) / 2 + 0.12, p[1], 12); K.cyl("iron", white, 0.16, 0.09, 0.22, p[0], Hc - 0.18, p[1], 12); K.box("iron", white, 0.34, 0.06, 0.34, p[0], Hc - 0.04, p[1], a0 + c * PI / 4);
      so(SO, p[0], p[1], 0.24, 0.24, Hb, Hc, 0, { noStep: true });
      var q2 = V(c, rc - 0.85); K.tube("iron", white, V3(p[0], Hc - 0.7, p[1]), V3(q2[0], Hc - 0.02, q2[1]), 0.022, 5); K.tube("iron", white, V3(p[0], Hc - 0.32, p[1]), V3((p[0] + q2[0]) / 2, Hc - 0.02, (p[1] + q2[1]) / 2), 0.018, 5); }
    for (var rs = 0; rs < 8; rs++) { var A2 = V(rs, rc), B2 = V(rs + 1, rc), L2 = Math.hypot(B2[0] - A2[0], B2[1] - A2[1]), ux = (B2[0] - A2[0]) / L2, uz = (B2[1] - A2[1]) / L2, isSt = rs === 1 || rs === 5;
      var spans = isSt ? [[0.1, (L2 - 2.6) / 2], [(L2 + 2.6) / 2, L2 - 0.1]] : [[0.1, L2 - 0.1]];
      spans.forEach(function (sp2) { var a = sp2[0], b = sp2[1]; if (b - a < 0.2) return; var P0 = [A2[0] + ux * a, A2[1] + uz * a], P1 = [A2[0] + ux * b, A2[1] + uz * b]; [Hb + 0.95, Hb + 0.12].forEach(function (yy) { K.tube("iron", white, V3(P0[0], yy, P0[1]), V3(P1[0], yy, P1[1]), yy > Hb + 0.5 ? 0.03 : 0.02, 6); });
        for (var bb = a + 0.14; bb < b - 0.05; bb += 0.14) { var bxx = A2[0] + ux * bb, bzz = A2[1] + uz * bb; K.cyl("iron", white, 0.01, 0.01, 0.83, bxx, Hb + 0.535, bzz, 4); }
        for (var sc = a + 0.42; sc < b - 0.2; sc += 0.84) { var cxx = A2[0] + ux * sc, czz = A2[1] + uz * sc; K.place("iron", new THREE.TorusGeometry(0.16, 0.012, 4, 12), white, cxx, Hb + 0.55, czz, Math.atan2(ux, uz) + HP); }
        so(SO, (P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2, b - a, 0.12, Hb, Hb + 1.0, Math.atan2(ux, uz) - HP, { noStep: true }); }); }
    // the eave: the octagonal fascia with a scalloped valance, the painted sky ceiling, the bell dome, the lantern, the finial
    var Re = 5.2; for (var e = 0; e < 8; e++) { var A3 = V(e, Re), B3 = V(e + 1, Re), mx3 = (A3[0] + B3[0]) / 2, mz3 = (A3[1] + B3[1]) / 2, L3 = Math.hypot(B3[0] - A3[0], B3[1] - A3[1]), ry3 = Math.atan2(B3[0] - A3[0], B3[1] - A3[1]) + HP;
      K.box("enamel", white, L3 + 0.05, 0.3, 0.08, mx3, Hc + 0.15, mz3, ry3); var nS = 6, sw = L3 / nS; for (var v = 0; v < nS; v++) { var off = -L3 / 2 + sw * (v + 0.5), vx = mx3 + Math.cos(ry3) * off, vz = mz3 - Math.sin(ry3) * off; var gs = new THREE.CircleGeometry(sw * 0.46, 10, 0, PI); gs.rotateZ(PI); K.place("enamel", gs, white, vx, Hc + 0.0, vz, ry3); K.place("enamel", gs.clone(), white, vx, Hc + 0.0, vz, ry3 + PI); } }
    var octE = []; for (var k2 = 0; k2 < 8; k2++) octE.push(V(k2, Re)); var cg = new THREE.ShapeGeometry(shapeFrom(octE)); cg.rotateX(HP); cg.translate(0, Hc + 0.3, 0); var cgn = cg.toNonIndexed(); colorize(cgn, [0.62, 0.78, 0.9]); var nn = cgn.attributes.normal; for (var m = 0; m < nn.count; m++) nn.setXYZ(m, 0, -1, 0); uvWorld(cgn, 2.5, "y"); K.add("stucco", cgn);
    K.lathe("enamel", COL.dome, [[5.28, 0.0], [5.1, 0.12], [4.5, 0.42], [3.6, 0.8], [2.6, 1.22], [1.75, 1.6], [1.15, 1.86], [0.92, 1.95]], cx, Hc + 0.3, cz, 8, 1, 1, 1, a0 - PI / 8 + PI / 8);
    K.lathe("enamel", COL.dome, [[0.92, 1.95], [1.0, 1.9], [0.0, 1.9]].map(function (q) { return q; }), cx, Hc + 0.3, cz, 8);
    K.cyl("enamel", white, 0.72, 0.72, 0.62, cx, Hc + 2.6, cz, 8, false, PI / 8); for (var lo = 0; lo < 8; lo++) { var la = a0 + lo * PI / 4 + PI / 8, lx = cx + Math.cos(la) * 0.675, lz = cz + Math.sin(la) * 0.675; K.box("lamp", COL.cream, 0.28, 0.36, 0.02, lx, Hc + 2.6, lz, -la + HP); }
    K.lathe("enamel", COL.dome, [[0.86, 0], [0.75, 0.12], [0.45, 0.35], [0.12, 0.55], [0.0, 0.58]], cx, Hc + 2.91, cz, 8); K.sph("tin", COL.gold, 0.13, cx, Hc + 3.58, cz, 10); K.cyl("tin", COL.gold, 0.012, 0.035, 0.5, cx, Hc + 3.9, cz, 6);
    // the hanging lamp under the ceiling, the bulb ring along the eave (string lights), a music stand and a chair for the trio
    K.cyl("iron", COL.iron, 0.01, 0.01, 0.9, cx, Hc - 0.15, cz, 4); K.sph("lamp", COL.cream, 0.2, cx, Hc - 0.7, cz, 12); GLOW.lamps.push([cx, Hc - 0.7, cz]);
    out.kiosco = { c: [cx, cz], Hb: Hb, Hc: Hc, eave: Re, top: Hc + 3.9, bulbs: [] }; for (var bu = 0; bu < 32; bu++) { var ba = bu / 32 * TAU, br = Re * Math.cos(PI / 8) / Math.cos(((ba - a0) % (PI / 4) + PI / 4) % (PI / 4) - PI / 8); out.kiosco.bulbs.push([cx + Math.cos(ba) * (br + 0.06), Hc - 0.08, cz + Math.sin(ba) * (br + 0.06)]); }
    // a bronze plaque on the base beside the south stair
    { var pa = (90 + 22.5) * PI / 180, pr = ap + 0.01, pxp = cx + Math.cos(PI / 2) * pr + 1.85, pzp = cz + pr; var gp = new THREE.PlaneGeometry(0.9, 0.24); var uvp = sUV("kiosco"), UP = gp.attributes.uv; for (var ip = 0; ip < UP.count; ip++) UP.setXY(ip, uvp[0] + UP.getX(ip) * (uvp[2] - uvp[0]), uvp[1] + UP.getY(ip) * (uvp[3] - uvp[1])); K.place("signs", gp, COL.sal, pxp, 0.72, pzp, 0);
      SIGN_DRAW.push(function (x) { plaque(x, SA.r.kiosco, C("names.kiosco", "El Kiosco"), C("names.kioscoSub", "Plaza del Mercado · Douglas, Arizona")); }); }
    // a little door into the base (the store under the bandstand), on the east face
    K.box("paint", mulCol(COL.verde, 0.8), 0.9, 0.78, 0.04, cx + ap + 0.005, 0.42, cz, HP, 1.0);
    out.kiosco.platform = oct; }

  // ───────────────────────── the talavera fountain: octagonal basin, a two-bowl cantera centre, the water ─────────────────────────
  function buildFountain(K, SO, out, cx, cz) { var R0 = 3.1, ap = R0 * Math.cos(PI / 8), a0 = PI / 8, hw = 0.5, wy = 0.48;
    var V = function (k, r) { var a = a0 + k * PI / 4; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; };
    for (var s = 0; s < 8; s++) { var A = V(s, R0), B = V(s + 1, R0), mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2, L = Math.hypot(B[0] - A[0], B[1] - A[1]), ry = Math.atan2(B[0] - A[0], B[1] - A[1]) + HP, nrm = (s * 45 + 45) * PI / 180;
      K.box("talavera", COL.sal, L + 0.02, hw, 0.3, mx - Math.cos(nrm) * 0.15, hw / 2, mz - Math.sin(nrm) * 0.15, ry, 1.2); K.box("cantera", COL.cantD, L + 0.1, 0.12, 0.34, mx - Math.cos(nrm) * 0.13, 0.06, mz - Math.sin(nrm) * 0.13, ry, 0.8);
      K.box("cantera", COL.cant, L + 0.2, 0.1, 0.42, mx - Math.cos(nrm) * 0.12, hw + 0.05, mz - Math.sin(nrm) * 0.12, ry, 0.8);
      so(SO, mx - Math.cos(nrm) * 0.12, mz - Math.sin(nrm) * 0.12, L, 0.42, 0, hw + 0.11, ry, { seat: true, face: Math.atan2(Math.cos(nrm), Math.sin(nrm)), noStep: true }); }
    var oct = []; for (var k = 0; k < 8; k++) oct.push(V(k, R0 - 0.3)); flatPoly(K, "talavera", [0.55, 0.62, 0.78], oct, 0.06, 1.2); flatPoly(K, "water", COL.sal, oct, wy, 2.0);
    so(SO, cx, cz, ap * 2 - 0.5, ap * 2 - 0.5, 0, wy + 0.1, 0, { noStep: true }); so(SO, cx, cz, ap * 2 - 0.5, ap * 2 - 0.5, 0, wy + 0.1, PI / 4, { noStep: true });
    // the centre: an octagonal pedestal, the lower bowl, the column, the upper bowl, a cantera pineapple; the falling sheets and the jet
    K.cyl("cantera", COL.cant, 0.5, 0.58, 0.6, cx, 0.3, cz, 8); K.cyl("cantera", COL.cant, 0.24, 0.3, 0.5, cx, 0.85, cz, 12);
    K.lathe("cantera", COL.cant, [[0.0, 0.0], [0.32, 0.02], [0.9, 0.16], [1.28, 0.3], [1.32, 0.38], [1.2, 0.36], [0.0, 0.3]], cx, 1.05, cz, 24); flatPoly(K, "water", COL.sal, circlePts(cx, cz, 1.18, 24), 1.38, 1.5);
    K.cyl("cantera", COL.cant, 0.12, 0.16, 0.5, cx, 1.6, cz, 10); K.lathe("cantera", COL.cant, [[0.0, 0.0], [0.18, 0.02], [0.5, 0.12], [0.66, 0.22], [0.6, 0.22], [0.0, 0.18]], cx, 1.85, cz, 18); flatPoly(K, "water", COL.sal, circlePts(cx, cz, 0.56, 18), 2.05, 1.0);
    K.lathe("cantera", COL.cant, [[0.0, 0.0], [0.1, 0.02], [0.14, 0.12], [0.11, 0.24], [0.04, 0.32], [0.0, 0.34]], cx, 2.1, cz, 10);
    K.cyl("veil", COL.sal, 1.3, 1.24, 1.38 - wy, cx, (1.38 + wy) / 2 - 0.02, cz, 32, true); K.cyl("veil", COL.sal, 0.65, 0.6, 2.05 - 1.4, cx, (2.05 + 1.4) / 2, cz, 24, true);
    out.fountain = { c: [cx, cz], r: R0, wy: wy }; }
  function circlePts(cx, cz, r, n) { var p = []; for (var i = 0; i < n; i++) { var a = i / n * TAU; p.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } return p; }

  // ───────────────────────── the food row: four puestos along the south edge, two carts, cafe tables under umbrellas ─────────────────────────
  var FOODZ = { front: 16.9, back: 20.1, w: 4.3 };
  function buildFood(K, SO, out) { var R = rng(1940); out.food = [];
    FOOD.forEach(function (fd, i) { var x = fd.x, z0 = FOODZ.front, z1 = FOODZ.back, hw = FOODZ.w / 2, col = COL[["terra", "mango", "verde", "azul"][i]] || COL.terra, paint = mulCol(col, 0.95);
      // the frame: four painted posts, the back wall in boards, half-height side boards, the counter with a tiled front and a steel top
      [[-hw + 0.08, z0 + 0.08], [hw - 0.08, z0 + 0.08], [-hw + 0.08, z1 - 0.08], [hw - 0.08, z1 - 0.08]].forEach(function (q, k) { var h = k < 2 ? 2.62 : 2.98; K.box("paint", paint, 0.12, h, 0.12, x + q[0], h / 2, q[1], 0, 1.0); so(SO, x + q[0], q[1], 0.16, 0.16, 0, h, 0, { noStep: true }); });
      K.box("paint", paint, FOODZ.w, 2.7, 0.06, x, 1.35, z1 - 0.05, 0, 1.0); so(SO, x, z1 - 0.05, FOODZ.w, 0.12, 0, 2.7, 0, null);
      [-1, 1].forEach(function (sd) { K.box("paint", paint, 0.05, 1.1, z1 - z0 - 0.2, x + sd * (hw - 0.05), 0.55, (z0 + z1) / 2, 0, 1.0); so(SO, x + sd * (hw - 0.05), (z0 + z1) / 2, 0.1, z1 - z0, 0, 1.1, 0, null); });
      K.box("paint", mulCol(col, 0.8), FOODZ.w - 0.3, 0.92, 0.5, x, 0.46, z0 + 0.3, 0, 1.0); K.box("talavera", COL.sal, FOODZ.w - 0.5, 0.5, 0.02, x, 0.5, z0 + 0.045, 0, 1.2); K.box("enamel", [0.72, 0.73, 0.74], FOODZ.w - 0.2, 0.05, 0.62, x, 0.95, z0 + 0.3, 0);
      so(SO, x, z0 + 0.3, FOODZ.w - 0.2, 0.62, 0, 0.98, 0, { noStep: true, counter: fd.id });
      K.box("wood", COL.wood, FOODZ.w - 0.4, 0.05, 0.55, x, 0.92, z1 - 0.45, 0, 1.0); K.box("paint", mulCol(col, 0.7), FOODZ.w - 0.4, 0.88, 0.5, x, 0.45, z1 - 0.45, 0, 1.0);
      // the awning: striped canvas from the back to the front with a scalloped valance, its colourway by stall
      var yb = 3.02, yf = 2.6, zf = z0 - 0.45, L = Math.hypot(z1 + 0.2 - zf, yb - yf), ang = Math.atan2(yb - yf, z1 + 0.2 - zf), v0 = fd.awn * 0.25 + 0.015, v1 = v0 + 0.22;
      var ga = new THREE.BoxGeometry(FOODZ.w + 0.4, 0.03, L); var ua = ga.attributes.uv; for (var u = 0; u < ua.count; u++) ua.setXY(u, ua.getX(u) * (FOODZ.w + 0.4) / 4.0, v0 + ua.getY(u) * (v1 - v0)); K.place("awning", ga, COL.sal, x, (yb + yf) / 2, (z1 + 0.2 + zf) / 2, 0, -ang);
      for (var sc = 0; sc < 9; sc++) { var sx = x - (FOODZ.w + 0.4) / 2 + (sc + 0.5) * (FOODZ.w + 0.4) / 9, gs = new THREE.CircleGeometry(0.27, 8, PI, PI); var us = gs.attributes.uv; for (var q = 0; q < us.count; q++) us.setXY(q, ((sc % 2) * 0.0625 + 0.01) + us.getX(q) * 0.04, v0 + us.getY(q) * 0.1); K.place("awning", gs, COL.sal, sx, yf - 0.02, zf - 0.02, PI); K.place("awning", gs.clone(), COL.sal, sx, yf - 0.02, zf - 0.005, 0); }
      // the name board on top, the chalk menu on an easel beside the counter
      var bk = "food" + i; K.box("wood", COL.woodD, 3.7, 0.92, 0.08, x, yf + 0.86, zf + 0.12, 0, 1.0); [-1.6, 1.6].forEach(function (dx) { K.box("wood", COL.woodD, 0.08, 0.7, 0.08, x + dx, yf + 0.2, zf + 0.15, 0); });
      var gb = new THREE.PlaneGeometry(3.56, 0.84); var uv = sUV(bk), UA = gb.attributes.uv; for (var k2 = 0; k2 < UA.count; k2++) UA.setXY(k2, uv[0] + UA.getX(k2) * (uv[2] - uv[0]), uv[1] + UA.getY(k2) * (uv[3] - uv[1])); K.place("signs", gb, COL.sal, x, yf + 0.86, zf + 0.07, PI);
      (function (bk2, f2) { SIGN_DRAW.push(function (cx) { board(cx, SA.r[bk2], f2.name, f2.sub, f2.bd); }); })(bk, fd);
      var mx = x + (i % 2 ? hw + 0.35 : -hw - 0.35), mz = z0 - 0.15, mk = "menu" + i; K.box("wood", COL.woodD, 0.05, 1.25, 0.05, mx - 0.28, 0.6, mz - 0.12, 0, 0, -0.16); K.box("wood", COL.woodD, 0.05, 1.25, 0.05, mx + 0.28, 0.6, mz - 0.12, 0, 0, 0.16); K.box("wood", COL.woodD, 0.05, 1.2, 0.05, mx, 0.58, mz + 0.22, 0, 0.3);
      var gm = new THREE.PlaneGeometry(0.66, 0.5); var uvm = sUV(mk), UM = gm.attributes.uv; for (var k3 = 0; k3 < UM.count; k3++) UM.setXY(k3, uvm[0] + UM.getX(k3) * (uvm[2] - uvm[0]), uvm[1] + UM.getY(k3) * (uvm[3] - uvm[1])); K.place("signs", gm, COL.sal, mx, 0.92, mz - 0.16, PI, -0.16);
      (function (mk2, f2) { var rows = shopDef(f2.shop).rows || []; SIGN_DRAW.push(function (cx) { chalkMenu(cx, SA.r[mk2], f2.name, rows.map(function (r) { return r[1]; })); }); })(mk, fd);
      so(SO, mx, mz, 0.7, 0.5, 0, 1.3, 0, { noStep: true });
      // the bulbs along the awning's front edge (string lights)
      out.foodBulbs = out.foodBulbs || []; for (var bl = 0; bl < 7; bl++) out.foodBulbs.push([x - hw + 0.1 + bl * (FOODZ.w - 0.2) / 6, yf - 0.18 - 0.06 * Math.sin(bl / 6 * PI), zf - 0.05]);
      // the kind: trompo, elote cart, vitroleros, churro fryer
      var top = 0.98, bz = z1 - 0.45;
      if (fd.k === "trompo") { var tx = x + 1.0; K.box("enamel", [0.25, 0.25, 0.27], 0.5, 1.1, 0.12, tx, top + 0.75, bz + 0.12, 0); K.box("glowK", [0.4, 0.15, 0.06], 0.4, 0.95, 0.02, tx, top + 0.75, bz + 0.05, 0); K.cyl("enamel", [0.6, 0.6, 0.62], 0.02, 0.02, 1.25, tx, top + 0.68, bz - 0.2, 6);
        K.lathe("food", [0.72, 0.28, 0.12], [[0.0, 0.18], [0.1, 0.18], [0.16, 0.4], [0.2, 0.7], [0.22, 0.95], [0.0, 1.0]], tx, top, bz - 0.2, 14); K.cyl("food", [0.92, 0.75, 0.25], 0.09, 0.07, 0.16, tx, top + 1.08, bz - 0.2, 10); K.cyl("food", [0.3, 0.5, 0.2], 0.03, 0.01, 0.18, tx, top + 1.24, bz - 0.2, 6);
        K.cyl("iron", COL.iron, 0.36, 0.36, 0.03, x - 0.6, top + 0.06, bz, 18); K.cyl("glowK", [0.3, 0.12, 0.06], 0.3, 0.3, 0.06, x - 0.6, top + 0.02, bz, 14); for (var tt = 0; tt < 5; tt++) K.cyl("food", [0.93, 0.86, 0.66], 0.075, 0.075, 0.01, x - 0.75 + (tt % 3) * 0.15, top + 0.085, bz - 0.08 + Math.floor(tt / 3) * 0.16, 12);
        [[0.85, 0.12, 0.08], [0.25, 0.55, 0.15], [0.85, 0.12, 0.08]].forEach(function (c, k) { K.cyl("cloth", c, 0.04, 0.04, 0.2, x - 1.4 + k * 0.12, top + 0.1, z0 + 0.32, 8); }); K.cyl("cloth", [0.9, 0.86, 0.75], 0.12, 0.08, 0.08, x - 0.9, top + 0.04, z0 + 0.32, 12); for (var lm = 0; lm < 6; lm++) K.sph("food", [0.45, 0.72, 0.2], 0.03, x - 0.95 + (lm % 3) * 0.05, top + 0.1, z0 + 0.3 + Math.floor(lm / 3) * 0.05, 6); }
      if (fd.k === "elote") { K.cyl("enamel", [0.62, 0.62, 0.64], 0.28, 0.26, 0.5, x - 0.9, top + 0.25, bz, 16); K.cyl("enamel", [0.55, 0.55, 0.57], 0.3, 0.3, 0.03, x - 0.9, top + 0.52, bz, 16);
        K.box("iron", COL.iron, 1.1, 0.05, 0.5, x + 0.6, top + 0.12, bz, 0); K.box("glowK", [0.35, 0.12, 0.05], 1.0, 0.04, 0.42, x + 0.6, top + 0.08, bz, 0); for (var ec = 0; ec < 6; ec++) { K.place("food", new THREE.CylinderGeometry(0.045, 0.04, 0.24, 8), [0.95, 0.78, 0.22], x + 0.18 + ec * 0.17, top + 0.2, bz, 0, 0, HP); }
        for (var cu = 0; cu < 6; cu++) K.cyl("cloth", [0.95, 0.94, 0.9], 0.045, 0.035, 0.1, x - 1.5 + cu * 0.09, top + 0.05, z0 + 0.32, 8); [[0.95, 0.93, 0.85], [0.85, 0.15, 0.1], [0.98, 0.98, 0.92]].forEach(function (c, k) { K.cyl("cloth", c, 0.06, 0.06, 0.14, x + 1.1 + k * 0.16, top + 0.07, z0 + 0.32, 10); }); }
      if (fd.k === "aguas") { [[0.95, 0.93, 0.86], [0.6, 0.06, 0.14], [0.48, 0.28, 0.1], [0.98, 0.62, 0.22]].forEach(function (c, k) { var vx = x - 1.35 + k * 0.9; K.cyl("drink", c, 0.25, 0.25, 0.62, vx, top + 0.34, z0 + 0.32, 18); K.cyl("glass", COL.sal, 0.28, 0.27, 0.72, vx, top + 0.38, z0 + 0.32, 18, true); K.cyl("enamel", [0.75, 0.75, 0.76], 0.18, 0.18, 0.04, vx, top + 0.76, z0 + 0.32, 14); K.cyl("drink", [0.9, 0.95, 0.98], 0.22, 0.22, 0.12, vx, top + 0.7, z0 + 0.32, 14); });
        for (var gl = 0; gl < 8; gl++) K.cyl("glass", COL.sal, 0.05, 0.04, 0.14, x - 1.5 + gl * 0.42, top + 0.07, bz, 8); for (var fr = 0; fr < 8; fr++) K.sph("food", [[0.95, 0.75, 0.15], [0.9, 0.2, 0.2], [0.4, 0.7, 0.2], [0.95, 0.5, 0.15]][fr % 4], 0.08, x - 1.2 + fr * 0.3, top + 0.08, bz + 0.12, 8); }
      if (fd.k === "churros") { K.box("enamel", [0.68, 0.68, 0.7], 0.9, 0.35, 0.55, x + 0.9, top + 0.17, bz, 0); K.box("glowK", [0.32, 0.2, 0.08], 0.78, 0.02, 0.44, x + 0.9, top + 0.35, bz, 0);
        K.box("glass", COL.sal, 1.5, 0.45, 0.45, x - 0.7, top + 0.23, z0 + 0.32, 0); for (var ch = 0; ch < 14; ch++) K.place("food", new THREE.CylinderGeometry(0.018, 0.018, 0.34, 6), [0.75, 0.45, 0.18], x - 1.35 + ch * 0.095, top + 0.1 + (ch % 2) * 0.04, z0 + 0.32, 0, 0, HP - 0.1);
        K.cyl("cloth", [0.96, 0.93, 0.85], 0.14, 0.12, 0.1, x + 0.1, top + 0.05, z0 + 0.3, 12); }
      out.food.push({ id: fd.id, fd: fd, x: x, z: z0, counter: [x, z0 - 0.6], vend: [x - 0.2, 18.4], col: col });
      GLOW.pools.push([x, z0 - 0.9, 3.2, [1, 0.76, 0.48], 0.05]); });
    // two carts on the Gold Street axis: paletas (white, a parasol) and raspados (an ice block and syrups)
    [[-3.9, 19.0, 0], [6.1, 19.0, 1]].forEach(function (q) { var x = q[0], z = q[1], k = q[2]; K.box("enamel", k ? [0.25, 0.48, 0.8] : [0.95, 0.96, 0.97], 1.5, 0.75, 0.75, x, 0.68, z, 0); K.box("enamel", k ? [0.95, 0.75, 0.2] : [0.85, 0.18, 0.4], 1.52, 0.1, 0.77, x, 1.08, z, 0);
      [[-0.62, -0.38], [0.62, -0.38], [-0.62, 0.38], [0.62, 0.38]].forEach(function (w) { K.place("iron", new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14), COL.iron, x + w[0], 0.2, z + w[1], 0, HP); K.place("iron", new THREE.TorusGeometry(0.19, 0.025, 5, 14), COL.iron, x + w[0], 0.2, z + w[1], 0); });
      K.box("iron", COL.iron, 0.04, 0.04, 0.9, x - 0.95, 0.95, z, 0); K.box("iron", COL.iron, 0.3, 0.04, 0.04, x - 0.82, 0.95, z - 0.43, 0); K.box("iron", COL.iron, 0.3, 0.04, 0.04, x - 0.82, 0.95, z + 0.43, 0);
      if (k) { K.box("glass", COL.sal, 0.5, 0.35, 0.35, x + 0.25, 1.32, z, 0); K.box("drink", [0.9, 0.96, 1.0], 0.42, 0.28, 0.28, x + 0.25, 1.28, z, 0); [[0.9, 0.1, 0.15], [0.95, 0.6, 0.1], [0.3, 0.75, 0.25], [0.55, 0.15, 0.6]].forEach(function (c, i) { K.cyl("drink", c, 0.04, 0.04, 0.26, x - 0.45 + i * 0.12, 1.26, z - 0.18, 8); }); }
      else { for (var bel = 0; bel < 3; bel++) K.sph("tin", COL.gold, 0.04, x - 0.92, 1.0, z - 0.2 + bel * 0.2, 6); }
      K.cyl("wood", COL.woodD, 0.02, 0.02, 1.4, x + 0.55, 1.8, z, 5); var awk = k ? 2 : 0, v0 = awk * 0.25 + 0.02, v1 = v0 + 0.21; for (var p = 0; p < 8; p++) { var a0 = p / 8 * TAU, a1 = (p + 1) / 8 * TAU, A = [x + 0.55, 2.62, z], B = [x + 0.55 + Math.cos(a0) * 0.95, 2.36, z + Math.sin(a0) * 0.95], Cc = [x + 0.55 + Math.cos(a1) * 0.95, 2.36, z + Math.sin(a1) * 0.95];
        var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute([A[0], A[1], A[2], Cc[0], Cc[1], Cc[2], B[0], B[1], B[2], A[0], A[1] - 0.01, A[2], B[0], B[1] - 0.01, B[2], Cc[0], Cc[1] - 0.01, Cc[2]], 3)); var u0 = (p % 2) * 0.0625, u1 = u0 + 0.0625; g.setAttribute("uv", new THREE.Float32BufferAttribute([u0, v1, u1, v0, u0, v0, u0, v1, u0, v0, u1, v0], 2)); g.computeVertexNormals(); K.add("awning", g, COL.sal); }
      so(SO, x, z, 1.7, 0.95, 0, 1.15, 0, { noStep: true }); out.carts = out.carts || []; out.carts.push([x, z, k]); });
    // the cafe tables in front of the food row (and two in the Portal Oriente for the fonda)
    out.tables = []; [[-16.4, 10.4], [-12.9, 13.3], [-17.0, 14.6], [13.6, 10.4], [17.2, 13.0], [12.6, 14.2]].forEach(function (q, i) { cafeTable(K, SO, q[0], q[1], (i * 0.37) % HP, i % 4); out.tables.push(q); });
    var fo = frames().oriente; [[-17.0, -2.25], [-13.1, -2.25]].forEach(function (q) { var p = fo.c2l(q[0], q[1]); var n0 = SO.length, tmp = new Kit(); cafeTable(tmp, SO, p[0], p[1], 0, 1, true); for (var b in tmp.m) tmp.m[b].forEach(function (g) { g.translate(0, SITE.AF, 0); K.add(b, g); }); for (var j = n0; j < SO.length; j++) { SO[j][4] += SITE.AF; SO[j][5] += SITE.AF; } out.tables.push(p); }); }

  // ───────────────────────── the bosque furniture (on the natural grade: placed in defer, after the terrain is final) ─────────────────────────
  function gl(x, z) { var w = l2w(x, z); try { return getH(w[0], w[1]) - SITE.G; } catch (e) { return 0; } }
  function buildBosque(K, SO, out) { var R = rng(1883); out.picnic = [];
    [[-28.0, -9.5, 0.3], [-29.5, 2.5, -0.2], [-27.0, 13.0, 0.5]].forEach(function (q) { var x = q[0], z = q[1], r = q[2], y = gl(x, z), c = Math.cos(r), s = Math.sin(r), P = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; };
      var t = P(0, 0); K.box("wood", COL.wood, 2.0, 0.07, 0.86, t[0], y + 0.75, t[1], r, 1.0); [-0.8, 0.8].forEach(function (lx) { var a = P(lx, 0); K.box("wood", COL.woodD, 0.08, 0.74, 1.5, a[0], y + 0.37, a[1], r, 1.0); });
      [-0.72, 0.72].forEach(function (lz) { var b = P(0, lz); K.box("wood", COL.wood, 2.0, 0.05, 0.3, b[0], y + 0.45, b[1], r, 1.0); so(SO, b[0], b[1], 2.0, 0.32, y, y + 0.47, r, { seat: true, face: r + (lz < 0 ? 0 : PI), noStep: true }); });
      so(SO, t[0], t[1], 2.0, 0.9, y, y + 0.79, r, { noStep: true }); out.picnic.push([x, z]); });
    [[-23.8, -16.0, HP], [-23.8, 17.5, HP]].forEach(function (q) { var y = gl(q[0], q[1]); var tmp = new Kit(), n0 = SO.length; bench(tmp, SO, q[0], q[1], q[2], 2.4, true); for (var b in tmp.m) tmp.m[b].forEach(function (g) { g.translate(0, y, 0); K.add(b, g); }); for (var j = n0; j < SO.length; j++) { SO[j][4] += y; SO[j][5] += y; } });
    // the decomposed granite floor of the bosque and the strips behind the portales (follows the ground, 2 cm over it)
    out.dg = [];
    var dgRects = [[SITE.bos[0] + 0.6, SITE.bos[1] + 0.2, SITE.bos[2] + 0.5, SITE.bos[3] - 0.5], [-19.2, 33.4, 22.7, 26.4]];
    dgRects.forEach(function (r) { var nx = Math.max(2, Math.ceil((r[1] - r[0]) / 1.0)), nz = Math.max(2, Math.ceil((r[3] - r[2]) / 1.0)), g = new THREE.PlaneGeometry(r[1] - r[0], r[3] - r[2], nx, nz); g.rotateX(-HP); g.translate((r[0] + r[1]) / 2, 0, (r[2] + r[3]) / 2); var p = g.attributes.position, cl = new Float32Array(p.count * 3);
      for (var i = 0; i < p.count; i++) { var x = p.getX(i), z = p.getZ(i), inPoly = inPolyL(lotPolyL(-0.3), x, z), y = gl(x, z) + 0.02; p.setY(i, inPoly ? y : y - 0.3); var e = Math.min(x - r[0], r[1] - x, z - r[2], r[3] - z), k = 0.8 + 0.15 * sstep(0, 2.5, e) + (R() - 0.5) * 0.05; cl[i * 3] = k * 0.95; cl[i * 3 + 1] = k * 0.86; cl[i * 3 + 2] = k * 0.72; }
      g.setAttribute("color", new THREE.BufferAttribute(cl, 3)); g.computeVertexNormals(); uvWorld(g, 3.0, "y"); out.dg.push(g.clone()); K.add("dg", g); }); }

  // ───────────────────────── overhead: warm string lights radiating from the kiosco, papel picado across the square and along the portales ─────────────────────────
  function cat(A, B, sag, n) { var out = []; for (var i = 0; i <= n; i++) { var t = i / n; out.push([lerp(A[0], B[0], t), lerp(A[1], B[1], t) - 4 * sag * t * (1 - t), lerp(A[2], B[2], t)]); } return out; }
  function buildOverhead(K, SO, out) { var S = SITE, kx = S.kio[0], kz = S.kio[1], Re = (out.kiosco && out.kiosco.eave) || 5.2, ye = ((out.kiosco && out.kiosco.Hc) || 4.4) - 0.06, R = rng(505);
    // the poles along the west seat wall carry both the lights and the papel picado
    var poles = [-15, -6.5, 6.5, 15].map(function (z) { return [S.sq[0] - 0.75, z]; });
    poles.forEach(function (p) { K.cyl("iron", COL.iron, 0.07, 0.09, 5.2, p[0], 2.6, p[1], 8); K.cyl("cantera", COL.cant, 0.22, 0.26, 0.5, p[0], 0.0, p[1], 8); K.sph("tin", COL.gold, 0.09, p[0], 5.28, p[1], 8); K.box("iron", COL.iron, 0.5, 0.04, 0.04, p[0] + 0.2, 5.0, p[1], 0); so(SO, p[0], p[1], 0.3, 0.3, -0.5, 5.2, 0, { noStep: true }); });
    var targets = [];
    [-15, -7, 9, 17].forEach(function (x) { targets.push([x, 5.8, -21.95]); }); [-15, -7, 7, 15].forEach(function (z) { targets.push([20.45, 5.8, z]); });
    FOOD.forEach(function (fd) { targets.push([fd.x, 3.9, FOODZ.front - 0.45 + 0.1]); }); poles.forEach(function (p) { targets.push([p[0] + 0.4, 4.98, p[1]]); });
    out.bulbs = [];
    targets.forEach(function (T) { var dx = T[0] - kx, dz = T[2] - kz, a = Math.atan2(dz, dx), oct = Re * Math.cos(PI / 8) / Math.cos(((a - PI / 8) % (PI / 4) + PI / 4) % (PI / 4) - PI / 8); var A = [kx + Math.cos(a) * (oct + 0.08), ye, kz + Math.sin(a) * (oct + 0.08)];
      var L = Math.hypot(T[0] - A[0], T[1] - A[1], T[2] - A[2]), n = Math.max(6, Math.round(L / 0.85)), P = cat(A, T, 0.055 * L + 0.25, n);
      for (var i = 0; i < n; i++) { K.tube("iron", [0.05, 0.05, 0.05], V3(P[i][0], P[i][1], P[i][2]), V3(P[i + 1][0], P[i + 1][1], P[i + 1][2]), 0.008, 4); if (i > 0) { K.cyl("iron", [0.06, 0.06, 0.06], 0.012, 0.012, 0.07, P[i][0], P[i][1] - 0.04, P[i][2], 4); K.sph("lamp", COL.cream, 0.042, P[i][0], P[i][1] - 0.1, P[i][2], 6, 1, 1.25, 1); out.bulbs.push([P[i][0], P[i][1] - 0.1, P[i][2]]); } } });
    ((out.kiosco && out.kiosco.bulbs) || []).concat(out.foodBulbs || []).forEach(function (b) { K.sph("lamp", COL.cream, 0.042, b[0], b[1], b[2], 6, 1, 1.25, 1); out.bulbs.push(b); });
    // papel picado: four strands north to south (the Portal Norte's cornice to the food row's boards), four east to west (the poles to the Portal Oriente)
    var strands = [];
    FOOD.forEach(function (fd) { strands.push([[fd.x + 0.4, 5.5, -21.95], [fd.x + 0.4, 3.75, FOODZ.front - 0.35], 1.25]); });
    poles.forEach(function (p) { if (Math.abs(p[1]) < 10) return; strands.push([[p[0] + 0.25, 4.7, p[1] + 0.3], [20.45, 5.5, p[1] + 0.3], 1.35]); });
    // and along the arcades (attached under the vigas at every pier line) and inside the Casa de la Cultura
    var fn = frames().norte, fo = frames().oriente, an = [], ao = [];
    for (var i = 0; i <= fn.n; i++) { var p1 = fn.c2l(fn.u0 + bayW(fn) * i + (i === 0 ? 0.4 : i === fn.n ? -0.4 : 0), -2.0); an.push([p1[0], ARC.ceil - 0.95, p1[1]]); }
    for (var j = 0; j <= fo.n; j++) { var p2 = fo.c2l(fo.u0 + bayW(fo) * j + (j === 0 ? 0.6 : j === fo.n ? -0.4 : 0), -2.0); ao.push([p2[0], ARC.ceil - 0.95, p2[1]]); }
    var segs = []; [an, ao].forEach(function (arr) { for (var k = 0; k < arr.length - 1; k++) segs.push([arr[k], arr[k + 1], 0.18]); });
    var cA = fn.c2l(fn.u0 + bayW(fn) * 3 + 0.5, -5.6), cB = fn.c2l(fn.u0 + bayW(fn) * 6 - 0.5, -5.6); segs.push([[cA[0], SITE.AF + 4.0, cA[1]], [cB[0], SITE.AF + 4.0, cB[1]], 0.35]);
    var pal = [[0.86, 0.08, 0.42], [0.96, 0.42, 0.04], [0.96, 0.78, 0.06], [0.12, 0.62, 0.26], [0.04, 0.56, 0.74], [0.46, 0.16, 0.68], [0.84, 0.06, 0.1], [0.12, 0.3, 0.84]];
    var pos = [], nrm = [], uvs = [], cols = [], sway = [], ci = 0, nf = 0;
    function flags(A, B, sag, cable) { var L = Math.hypot(B[0] - A[0], B[2] - A[2]), n = Math.max(2, Math.round(L / 0.42)), P = cat(A, B, sag, n); if (cable !== false) for (var s = 0; s < n; s++) K.tube("iron", [0.1, 0.09, 0.08], V3(P[s][0], P[s][1], P[s][2]), V3(P[s + 1][0], P[s + 1][1], P[s + 1][2]), 0.006, 3);
      for (var f = 0; f < n; f++) { var a = P[f], b = P[f + 1], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2, tx = b[0] - a[0], tz = b[2] - a[2], tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl; var w = 0.18, h = 0.46, tilt = (R() - 0.5) * 0.5, nx = -tz * Math.cos(tilt), nz = tx * Math.cos(tilt), ty = Math.sin(tilt) * 0.12;
        var d = Math.floor(R() * 8), u0 = (d % 4) * 0.25 + 14 / 1024, u1 = (d % 4) * 0.25 + 242 / 1024, vt = (d < 4 ? 1 : 0.5) - 8 / 512, vb = (d < 4 ? 1 : 0.5) - 246 / 512, c = pal[ci++ % pal.length], ph = R() * TAU;
        var TL = [mx - tx * w, my, mz - tz * w], TR = [mx + tx * w, my, mz + tz * w], BL = [mx - tx * w + nx * ty, my - h, mz - tz * w + nz * ty], BR = [mx + tx * w + nx * ty, my - h, mz + tz * w + nz * ty];
        [[TL, u0, vt, 0], [BL, u0, vb, 1], [BR, u1, vb, 1], [TL, u0, vt, 0], [BR, u1, vb, 1], [TR, u1, vt, 0]].forEach(function (q) { pos.push(q[0][0], q[0][1], q[0][2]); nrm.push(nx, 0, nz); uvs.push(q[1], q[2]); cols.push(c[0], c[1], c[2]); sway.push(ph, q[3], nx, nz); }); nf++; } }
    strands.forEach(function (st) { flags(st[0], st[1], st[2]); }); segs.forEach(function (sg) { flags(sg[0], sg[1], sg[2], true); });
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3)); g.setAttribute("mcSway", new THREE.Float32BufferAttribute(sway, 4)); g.computeBoundingBox(); g.computeBoundingSphere();
    out.papel = g; out.nFlags = nf; }

  // ───────────────────────── the build state ─────────────────────────
  var B = MC.b = MC.b || { K: null, SO: null, out: null, built: false, groups: [], solids: [], lights: [], placed: [], meshes: [] };
  function buildStatic() { var t0 = nowMs(), K = new Kit(), SO = [], out = { lanterns: [], spots: [], counters: [] };
    GLOW.pools.length = 0; GLOW.lamps.length = 0; GLOW.halos.length = 0; SIGN_DRAW.length = 0;
    var nO = buildPortal(K, SO, "norte", NORTE, { facade: "ochre", endL: true, endR: true, sideL: false, sideR: false, board0: 0, wallSign: 1.0, doors: [1, 7] });
    var oO = buildPortal(K, SO, "oriente", ORIENTE, { facade: "terra", endL: false, endR: true, sideL: false, sideR: false, skipFirst: true, board0: 9, doors: [3, 8] });
    out.counters = nO.counters.concat(oO.counters); out.lanterns = nO.lanterns.concat(oO.lanterns);
    [["casa", buildCasa], ["panaderia", buildPanaderia], ["gateway", buildGateway], ["ends", buildEnds], ["square", buildSquare], ["food", buildFood], ["overhead", buildOverhead]].forEach(function (q) { try { if (q[1] === buildEnds) q[1](K, SO); else q[1](K, SO, out); } catch (e) { note("build " + q[0], e); } });
    B.K = K; B.SO = SO; B.out = out; MC.t.static = Math.round(nowMs() - t0); MC.n.tris = Math.round(K.tris); MC.n.solids = SO.length; }

  // ───────────────────────── solids, the walk grid, keep-outs, clearing, planting ─────────────────────────
  function regSolids(list) { var S = SITE; list.forEach(function (q) { var w = l2w(q[0], q[1]), o = q[7] || {}; var sd = addSolid(w[0], w[1], S.yaw + (q[6] || 0), q[2], q[3], S.G + q[4], S.G + q[5], "mercado"); if (!sd) return; if (o.noStep) sd.noStep = true; if (o.seat) { sd.seat = true; sd.face = S.yaw + (o.face || 0); } if (o.counter) sd.mcCounter = o.counter; B.solids.push(sd); }); }
  function walkQuad(pts, y) { var S = SITE, w = pts.map(function (q) { return l2w(q[0], q[1]); }), g = new THREE.BufferGeometry(), a = [];
    for (var i = 1; i < w.length - 1; i++) [0, i, i + 1].forEach(function (k) { var yy = Array.isArray(y) ? y[k === 0 ? 0 : k] : y; a.push(w[k][0], S.G + yy, w[k][1]); });
    g.setAttribute("position", new THREE.Float32BufferAttribute(a, 3)); try { walkAdd(g); } catch (e) { note("walkAdd", e); } g.dispose(); }
  function walkRect(r, y) { walkQuad([[r[0], r[2]], [r[1], r[2]], [r[1], r[3]], [r[0], r[3]]], y); }
  function walkRamp(x0, x1, z0, z1, ya, yb, alongX) { if (alongX) walkQuad([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [ya, yb, yb, ya]); else walkQuad([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [ya, ya, yb, yb]); }
  function walkGrid() { var S = SITE, AF = S.AF, sq = S.sq, o = B.out || {};
    walkRect(sq, 0.03);
    walkRect([-19.2, 21.0, -26.5, -22.25], AF); walkRamp(-19.0, 21.0, -22.25, -21.55, AF, 0.03, false);   // the Portal Norte and its step
    walkRect([21.25, 25.0, -22.5, 22.5], AF); walkRamp(21.25, 20.55, -22.5, 22.5, AF, 0.03, true);         // the Portal Oriente and its step
    walkRect([21.0, 25.0, -26.5, -22.5], AF);                                                                 // the corner bay
    walkRect([-5.55, 7.55, -32.95, -26.5], AF);                                                               // the Casa de la Cultura
    walkRect([21.3, 31.4, -33.0, -26.5], AF); walkRect([25.0, 31.4, -26.5, -22.75], AF);                     // the panaderia
    walkRect([25.0, 31.95, -1.94, 1.94], AF); walkRamp(31.95, 32.55, -1.7, 1.7, AF, 0.03, true); walkRect([32.5, 34.45, -3.6, 3.6], 0.03);   // the gateway passage, step and apron
    var fo = frames().oriente, fz0 = fo.u0 + bayW(fo) * 1, fz1 = fo.u0 + bayW(fo) * 3; walkRect([25.3, 31.2, fz0 + 0.12, fz1 - 0.12], AF);   // the fonda's kitchen
    (o.trees || []).forEach(function (t) { walkRect([t[0] - 0.7, t[0] + 0.7, t[1] - 0.7, t[1] + 0.7], t[2]); }); (o.palms || []).forEach(function (t) { walkRect([t[0] - 0.8, t[0] + 0.8, t[1] - 0.8, t[1] + 0.8], t[2]); });   // planter soil (the trees stand on it)
    if (o.kiosco && o.kiosco.platform) { walkQuad(o.kiosco.platform, o.kiosco.Hb); (o.stairs || []).forEach(function (st) { var mx = st.x, mz = st.z, dx = st.dx, dz = st.dz, px = -dz, pz = dx; walkQuad([[mx + px * 1.3, mz + pz * 1.3], [mx - px * 1.3, mz - pz * 1.3], [mx - px * 1.3 + dx * 1.55, mz - pz * 1.3 + dz * 1.55], [mx + px * 1.3 + dx * 1.55, mz + pz * 1.3 + dz * 1.55]], [o.kiosco.Hb, o.kiosco.Hb, 0.03, 0.03]); }); } }
  var VEG = /^(bush\d|mesquite|ocotillo|saguaro.*|paloverde|ironwood|desertwillow|barrel_cactus|prickly_pear|cholla|organ_pipe|agave_cluster|yucca_cluster|boulder|ph_(rock|boulder|shrub|succulent|stones|sandrocks|planter)_?\d*|e1_(canarypalm|fanpalm2?|datepalm|agave\w*|yucca\w*|shrub\w*|bench|lantern|planter)|fa_agave\d|land_(bench|lantern|ramada|firering|rock\w*|shrub\w*)|fa_\w+|fb_\w+|xrock\w*)$/;
  function clearLot(m) { var removed = 0, keys = new Set(); for (var k in PLACE) { if (!VEG.test(k)) continue; var L = PLACE[k], keep = []; for (var i = 0; i < L.length; i++) { var e = L[i]; if (!e.mc && inLot(e[0], e[2], m)) { keys.add(Math.round(e[0] * 100) + ":" + Math.round(e[2] * 100)); removed++; } else keep.push(e); } if (keep.length !== L.length) { L.length = 0; Array.prototype.push.apply(L, keep); } }
    if (keys.size) for (var j = COLLIDERS.length - 1; j >= 0; j--) { var c = COLLIDERS[j]; if (keys.has(Math.round(c[0] * 100) + ":" + Math.round(c[1] * 100))) COLLIDERS.splice(j, 1); } MC.n.cleared = (MC.n.cleared || 0) + removed; return removed; }
  function put1(k, lx, lz, sc, ry, y) { if (!canPut(k)) return null; var w = l2w(lx, lz); put(k, w[0], w[1], ry === undefined ? Math.random() * TAU : ry, sc); var L = PLACE[k], e = L && L[L.length - 1]; if (!e) return null; e.mc = 1; e.keep = true; e.mcY = y; e.mcKind = k; B.placed.push(e); return e; }
  function plantLot() { var R = rng(1914), o = B.out || {}, n0 = B.placed.length;
    var palm = canPut("e1_fanpalm2") ? "e1_fanpalm2" : "fanpalm", shade = canPut("mesquite") ? "mesquite" : "paloverde";
    (o.trees || []).forEach(function (q, i) { var k = i % 2 ? (canPut("paloverde") ? "paloverde" : shade) : shade; put1(k, q[0], q[1], (k === "paloverde" ? 0.66 : 0.72) + R() * 0.1, R() * TAU, q[2]); });
    (o.palms || []).forEach(function (q) { put1(palm, q[0], q[1], palm === "fanpalm" ? 0.72 + R() * 0.08 : 0.95 + R() * 0.1, R() * TAU, q[2]); });
    [[-4.6, 24.6], [6.6, 24.6]].forEach(function (q) { put1(palm, q[0], q[1], palm === "fanpalm" ? 0.78 : 1.0, R() * TAU); });
    [[-33.0, -9.8, shade], [-22.6, -12.6, "paloverde"], [-33.2, -4.0, shade], [-24.4, -2.6, "desertwillow"], [-32.2, 6.6, shade], [-24.4, 8.2, shade], [-32.6, 17.6, "paloverde"], [-28.8, 20.4, "desertwillow"], [-27.4, -18.6, "desertwillow"], [-34.0, 11.0, "paloverde"]].forEach(function (q) { put1(canPut(q[2]) ? q[2] : shade, q[0], q[1], 0.9 + R() * 0.25); });
    var low = ["agave_cluster", "barrel_cactus", "prickly_pear", "bush2", "agave_cluster", "yucca_cluster"].filter(canPut);
    if (low.length) { var bed = function (x0, x1, z0, z1, n, sk) { for (var i = 0; i < n; i++) { var x = lerp(x0, x1, (i + 0.5) / n + (R() - 0.5) * 0.3 / n), z = lerp(z0, z1, R()); if (Math.abs(x - 1) < 3.4 && z > 22) continue; if (Math.abs(z) < 3.0 && x > 31) continue; put1(low[(i + sk) % low.length], x, z, 0.55 + R() * 0.35); } };
      bed(-18.5, -6.5, 23.4, 26.2, 9, 0); bed(8.5, 33.0, 23.4, 26.2, 15, 2); bed(32.4, 33.9, -32.5, -4.5, 9, 1); bed(32.4, 33.9, 4.5, 21.5, 9, 3); bed(-18.0, 30.0, -35.0, -34.0, 14, 4); }
    MC.n.planted = B.placed.length - n0; }
  // plants on the decomposed granite floors (2 cm over the ground) sit 1 cm into it; elsewhere 3 cm into the ground
  function onDG(x, z) { var q = w2l(x, z), B0 = SITE.bos, R = [[B0[0] + 0.6, B0[1] + 0.2, B0[2] + 0.5, B0[3] - 0.5], [-19.2, 33.4, 22.7, 26.4]]; for (var i = 0; i < R.length; i++) if (inR(q, R[i])) return inPolyL(lotPolyL(-0.3), q[0], q[1]); return false; }
  function seatY(e) { return typeof e.mcY === "number" ? SITE.G + e.mcY : getH(e[0], e[2]) + (onDG(e[0], e[2]) ? 0.01 : -0.03); }
  function reseat() { B.placed.forEach(function (e) { e[1] = seatY(e); e.seated = true; }); }
  // after every terrain pass (other modules grade after this one): seat my plants again on the final ground, through the instanced sets
  function reseatFinal() { var n = 0; B.placed.forEach(function (e) { var y = seatY(e); if (Math.abs(y - e[1]) < 0.02) return; try { planSeatEntry(e.mcKind, e, y); } catch (x) { e[1] = y; } e.seated = true; n++; }); MC.n.reseatedFinal = n; }

  // ───────────────────────── the walks to the network: Silver Street (Nugget Lane), Placer Lane (Gold Street), the parkway, the Arroyo Trail ─────────────────────────
  function walks() { var PMm = planMats(), w = function (pts) { return pts.map(function (q) { return l2w(q[0], q[1]); }); };
    try { planRibbon(w([[34.25, 0], [42.0, 0], [52.6, -0.2]]), 4.2, { mat: PMm.stone, lift: 0.12, tile: 2.5 }, "mc_walk_nugget"); } catch (e) { note("walk nugget", e); }
    try { planRibbon(w([[1, 22.8], [1, 29.0], [1.0, 35.2]]), 4.2, { mat: PMm.stone, lift: 0.12, tile: 2.5 }, "mc_walk_gold"); } catch (e) { note("walk gold", e); }
    try { planRibbon(w([[-27.6, -11.4], [-31.0, -14.8], [-35.6, -19.4]]), 2.4, { mat: PMm.dg, lift: 0.14, tile: 3 }, "mc_walk_parkway"); } catch (e) { note("walk parkway", e); }
    try { planRibbon(w([[40.5, -1.5], [43.6, -12.0], [46.2, -21.4]]), 2.2, { mat: PMm.dg, lift: 0.14, tile: 3 }, "mc_walk_arroyo"); } catch (e) { note("walk arroyo", e); }
    try { PLAN_WALKS.push(w([[33.2, 0], [1, 0], [1, 35]])); } catch (e) {} }

  // ───────────────────────── hooks ─────────────────────────
  // the site keep-out goes in first, at the front of the world phase, so no module's world hook (plan_enrich, the fill modules) and no
  // later scatter plants inside the venue; nothing has to be deleted after instancing
  function keepHook() {
    if (MC.off || !window.PLAN || MC.keep) return; var S = resolveSite(); if (!S) return; MC.keep = true;
    try { planKeepout(lotPolyW(1.2)); var L = S.lot; for (var u = L[0]; u <= L[1]; u += 7) for (var v = L[2]; v <= L[3]; v += 7) { var p = l2w(u, v); if (inLot(p[0], p[1], 0)) KEEPOUT.push([p[0], p[1], 6.5]); } } catch (e) { note("keepouts", e); } }
  function worldHook() {
    if (MC.off || !window.PLAN) return; var S = resolveSite(); if (!S) return; var t0 = nowMs(); keepHook();
    try { buildStatic(); } catch (e) { note("static", e); }
    try { clearLot(1.0); } catch (e) { note("clear", e); }
    try { plantLot(); } catch (e) { note("plant", e); }
    try { regSolids(B.SO || []); } catch (e) { note("solids", e); }
    try { walks(); } catch (e) { note("walks", e); }
    try { walkGrid(); } catch (e) { note("walk grid", e); }
    try { addCards(); } catch (e) { note("cards", e); }
    try { var hw = l2w(1, 8.6); planAddHub(C("names.hub", "Mercado Plaza"), hw[0], hw[1]); planNavCats(); } catch (e) { note("hub", e); }
    try { var c0 = l2w(2, -2); zoneRings.push({ name: C("names.full", "Mercado Plaza"), label: C("names.short", "Mercado Plaza"), center: c0, r: 40, k: C("zone", "Border heritage market square"), poly: lotPolyW(0), col: "#c2410c55", plan: "mercado" }); } catch (e) { note("zone", e); }
    installOverrides(); MC.t.world = Math.round(nowMs() - t0); }
  function terrainHook() {
    if (MC.off || !window.PLAN || !SITE) return; var S = SITE, t0 = nowMs();
    try { if (typeof H !== "undefined" && H && T) { var cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1), cnt0 = 0;
        var open = [[S.sq[0] - 0.4, S.sq[1], S.sq[2], 24.6], [31.4, 34.6, -3.6, 3.6]], bld = S.bld, P = lotPolyW(10), bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9; P.forEach(function (q) { bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); bz0 = Math.min(bz0, q[1]); bz1 = Math.max(bz1, q[1]); });
        for (var r = Math.max(0, Math.floor((bz0 - T.zmin) / ch)); r <= Math.min(T.rows - 1, Math.ceil((bz1 - T.zmin) / ch)); r++) for (var c = Math.max(0, Math.floor((bx0 - T.xmin) / cw)); c <= Math.min(T.cols - 1, Math.ceil((bx1 - T.xmin) / cw)); c++) {
          var x = T.xmin + c * cw, z = T.zmin + r * ch, q = w2l(x, z), dO = 1e9, dB = 1e9; open.forEach(function (rr) { dO = Math.min(dO, rdist(q, rr)); }); bld.forEach(function (rr) { dB = Math.min(dB, rdist(q, rr)); });
          var k = Math.max(dO <= 1.0 ? 1 : 1 - sstep(1.0, 7.0, dO), dB <= 0.5 ? 1 : 1 - sstep(0.5, 2.2, dB)); if (k <= 0) continue; var vi = r * T.cols + c; H[vi] = H[vi] + (S.G - H[vi]) * k; cnt0++; } MC.n.graded = cnt0; } } catch (e) { note("grade", e); }
    try { var Rr = 0; for (var kk in PLACE) { var Lk = PLACE[kk]; for (var i = 0; i < Lk.length; i++) { var e = Lk[i]; if (e.mc || lotDist(e[0], e[2]) > 9) continue; var g = getH(e[0], e[2]); if (Math.abs(g - e[1]) > 0.02 && Math.abs(g - e[1]) < 3) { e[1] = g; Rr++; } } } MC.n.reseatedOther = Rr; } catch (e) { note("reseat other", e); }
    try { reseat(); } catch (e) { note("reseat", e); }
    try { clearLot(1.0); } catch (e) { note("clear2", e); }
    MC.t.terrain = Math.round(nowMs() - t0); }
  // the defer pass: materials, the terrain-dependent pieces, the meshes, the pooled lamps, the night glow, the warm-up
  var BIG = { stucco: 1, cantera: 1, tile: 1, wood: 1, paint: 1, talavera: 1, iron: 1, enamel: 1, awning: 1, cloth: 0, tin: 1 };
  function makeMeshes(K, name, cull) { var S = SITE, g = new THREE.Group(); g.name = name; g.position.set(S.ox, S.G, S.oz); g.rotation.y = S.yaw; var geos = K.merge(), n = 0;
    for (var b in geos) { var mt = MX[b]; if (!mt) { note("base", b); geos[b].dispose(); continue; } var me = new THREE.Mesh(geos[b], mt); me.name = "mc " + name + " " + b; var opaque = !mt.transparent && mt.blending === THREE.NormalBlending;
      me.castShadow = opaque && !!BIG[b]; me.receiveShadow = opaque && b !== "lamp"; me.userData.shSet = true; if (mt.transparent) me.renderOrder = 2; g.add(me); B.meshes.push(me); n++; }
    K.m = {}; scene.add(g); g.updateMatrixWorld(true); B.groups.push(g); try { A2.cull.push({ o: g, x: S.ox, z: S.oz, r: cull }); } catch (e) {} MC.n["meshes_" + name] = n; return g; }
  function glowMesh() { var S = SITE, pos = [], uv = [], col = [], add = function (A, Bp, Cc, D, c) { [A, Bp, Cc, A, Cc, D].forEach(function (p, i) { pos.push(p[0], p[1], p[2]); uv.push([0, 1, 1, 0, 1, 0][i], [0, 0, 1, 0, 1, 1][i]); col.push(c[0], c[1], c[2]); }); };
    GLOW.pools.forEach(function (p) { var x = p[0], z = p[1], r = p[2] * 0.85, c0 = p[3] || [1, 0.75, 0.45], c = [c0[0] * 0.42, c0[1] * 0.36, c0[2] * 0.26], y = p[4] === undefined ? 0.05 : p[4]; add([x - r, y, z - r], [x - r, y, z + r], [x + r, y, z + r], [x + r, y, z - r], c); });
    GLOW.halos.forEach(function (h) { var p = h.p, w = h.w / 2, hh = h.h / 2, f = h.f; var a = f.c2l(-1, 0), b0 = f.c2l(0, 0), ux = a[0] - b0[0], uz = a[1] - b0[1]; var L = Math.hypot(ux, uz) || 1; ux /= L; uz /= L; var c = h.col.map(function (v) { return v * h.k; }); add([p[0] - ux * w, p[1] - hh, p[2] - uz * w], [p[0] + ux * w, p[1] - hh, p[2] + uz * w], [p[0] + ux * w, p[1] + hh, p[2] + uz * w], [p[0] - ux * w, p[1] + hh, p[2] - uz * w], c); });
    if (!pos.length) return null; var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.computeBoundingSphere();
    var me = new THREE.Mesh(g, MX.pool); me.name = "mc glow pools"; me.renderOrder = 3; me.userData.noShadow = true; me.frustumCulled = true; return me; }
  function poolLights(g) { var S = SITE, AF = S.AF, o = B.out || {}, L = [[1, 3.7, 0, 0xffc58a, 16, 3.0], [-9, 4.2, -24.4, 0xffb978, 13, 2.2], [11, 4.2, -24.4, 0xffb978, 13, 2.2], [23, 4.2, -11, 0xffb978, 13, 2.2], [23, 4.2, 11, 0xffb978, 13, 2.2], [-11.5, 2.9, 15.6, 0xffc080, 12, 2.4], [13.5, 2.9, 15.6, 0xffc080, 12, 2.4], [-12.5, 1.4, 0, 0xffd2a0, 7, 1.2], [1, AF + 3.6, -29.6, 0xffc890, 10, 1.6], [27.0, AF + 2.9, -27.0, 0xffc080, 10, 1.8]];
    L.forEach(function (q) { var l = new THREE.PointLight(q[3], 0, q[4], 1.5); l.position.set(q[0], q[1], q[2]); l.userData.k0 = q[5]; g.add(l); B.lights.push(l); }); try { LIGHTS.dirty = true; } catch (e) {} }
  function deferHook() {
    if (MC.off || !window.PLAN || !SITE || !B.K) return; var t0 = nowMs();
    try { mats(); } catch (e) { note("mats", e); return; }
    try { MC.n.strayAfter = strays(); } catch (e) {}
    try { reseatFinal(); } catch (e) { note("reseat final", e); }
    var KT = new Kit(), SOT = []; try { buildBosque(KT, SOT, B.out); regSolids(SOT); (B.out.dg || []).forEach(function (g) { var m = new THREE.Matrix4().makeRotationY(SITE.yaw); m.setPosition(SITE.ox, SITE.G, SITE.oz); g.applyMatrix4(m); try { walkAdd(g); } catch (e) {} g.dispose(); }); B.out.dg = []; } catch (e) { note("bosque", e); }
    try { for (var b in KT.m) { B.K.m[b] = (B.K.m[b] || []).concat(KT.m[b]); } } catch (e) {}
    try { var g = makeMeshes(B.K, "mc_plaza", 900); poolLights(g); var gm = glowMesh(); if (gm) { gm.visible = false; g.add(gm); B.glow = gm; }
      if (B.out.papel) { var pm = new THREE.Mesh(B.out.papel, MX.papel); pm.name = "mc papel picado"; pm.castShadow = false; pm.receiveShadow = true; g.add(pm); B.papel = pm; MC.n.flags = B.out.nFlags; } } catch (e) { note("meshes", e); }
    try { var W = window.PLAN_PERF; if (W && W.warmGroup && B.groups[0]) W.warmGroup(B.groups[0], { name: "mc plaza" }); } catch (e) {}
    try { if (window.PLAN_ROOMS && PLAN_ROOMS.warm) PLAN_ROOMS.warm(function () { return { tx: TX, mx: MX }; }, "mercado", { decodeMB: 6 }); } catch (e) { note("warm", e); }
    try { setupRoam(); } catch (e) { note("roam", e); }
    B.built = true; MC.ready = true; MC.t.defer = Math.round(nowMs() - t0); try { LIGHTS.dirty = true; } catch (e) {} }
  // a check, never a removal: plants and rocks of other modules still standing inside the venue after instancing (should be 0)
  function strays() { var n = 0; for (var k in PLACE) { if (!VEG.test(k)) continue; var L = PLACE[k]; for (var i = 0; i < L.length; i++) { var e = L[i]; if (!e.mc && inLot(e[0], e[2], -0.5)) n++; } } return n; }
  HK.world.unshift({ name: "mercado:keepout", fn: keepHook });
  HK.terrain.push({ name: "mercado:terrain", fn: terrainHook });
  HK.world.push({ name: "mercado:world", fn: worldHook });
  HK.defer.push({ name: "mercado:defer", fn: deferHook });
  HK.frame.push({ name: "mercado:frame", fn: frameHook });

  // ───────────────────────── people: the vendors behind their counters, the trio in the kiosco (idle rigs, talk cards), shoppers (PLAN_ROAM) ─────────────────────────
  var PEOPLE_D = {
    beto: { name: "Don Beto", role: "Taquero · Tacos al Pastor", look: { skin: "c99a74", shirt: "f2efe6", pants: "2b2b33", hair: 1, body: "m" }, at: "food:tacos", shop: "tacos", face: PI, greet: ["¿Cuántos le doy?", "Al pastor, recién cortado."] },
    paty: { name: "Paty", role: "Elotera · Elotes y Esquites", look: { skin: "b98463", shirt: "e9a91c", pants: "3a3f5c", hair: 3, body: "f" }, at: "food:elotes", shop: "elotes", face: PI, greet: ["¡Elotes calientitos!", "¿Con todo?"] },
    cuca: { name: "Doña Cuca", role: "Aguas Frescas", look: { skin: "a87452", shirt: "2f7d4f", pants: "4a3426", hair: 4, body: "f" }, at: "food:aguas", shop: "aguas", face: PI, greet: ["Horchata, jamaica, tamarindo.", "Bien frías, mijo."] },
    chema: { name: "Chema", role: "Churrero", look: { skin: "d3a985", shirt: "3a2a7a", pants: "222226", hair: 2, body: "m" }, at: "food:churros", shop: "churros", face: PI, greet: ["Churros recién hechos.", "¿Con cajeta?"] },
    rosario: { name: "Doña Rosario", role: "Panadera · Panadería El Mirador", look: { skin: "c08f6a", shirt: "f4ead6", pants: "5a3a2a", hair: 4, body: "f" }, at: "pan", shop: "pan", face: -HP, greet: ["Pan dulce del día.", "Las conchas salieron a las seis."] },
    ramon: { name: "Ramón", role: "Sarapes de Saltillo", look: { skin: "b07b55", shirt: "7a1f3d", pants: "2c2c30", hair: 1, body: "m" }, at: "stall:sarapes", shop: "sarapes", face: 0, greet: ["Tejidos a mano.", "¿Un sarape para el frío?"] }
  };
  var TRIO_D = [{ id: "lalo", name: "Lalo", role: "Acordeón · Trío Los Gavilanes del Mirador", look: { skin: "c7956f", shirt: "f2efe6", pants: "1f1f24", hair: 1, body: "m" }, inst: "acc", dx: -1.25, dz: 0.2 },
    { id: "nacho", name: "Nacho", role: "Bajo sexto · Trío Los Gavilanes del Mirador", look: { skin: "b68560", shirt: "f2efe6", pants: "1f1f24", hair: 2, body: "m" }, inst: "bajo", dx: 0, dz: -0.35 },
    { id: "tono", name: "Toño", role: "Tololoche · Trío Los Gavilanes del Mirador", look: { skin: "a97650", shirt: "f2efe6", pants: "1f1f24", hair: 3, body: "m" }, inst: "bass", dx: 1.3, dz: 0.15 }];
  var PPL = MC.ppl = MC.ppl || { list: [], made: false, nextAt: 0, idx: 0 };
  function personDef(id) { var d = PEOPLE_D[id] || TRIO_D.find(function (t) { return t.id === id; }) || {}, o = C("people." + id, null) || {}; return Object.assign({}, d, o); }
  function personSpot(P) { var S = SITE, o = B.out || {}; if (!P.at) return null; var k = P.at.split(":");
    if (k[0] === "food") { var f = (o.food || []).find(function (q) { return q.id === k[1]; }); if (!f) return null; return { x: f.vend[0], z: f.vend[1], y: 0.0, face: P.face }; }
    if (k[0] === "pan") { var b = o.panBaker; return b ? { x: b[0], z: b[2], y: S.AF, face: P.face } : null; }
    if (k[0] === "stall") { var c = (o.counters || []).find(function (q) { return q.id === k[1]; }); if (!c) return null; var fr = frames().norte; var lw = fr.c2l(c.u, -ARC.D - 1.25); return { x: lw[0], z: lw[1], y: S.AF, face: P.face }; }
    return null; }
  function trioOn(h) { h = h === undefined ? hourNow() : h; return h >= 9.5 && h < 23.5; }
  function makeRig(id, P, sp) { var S = SITE, w = l2w(sp.x, sp.z); var g = avatar("mc_" + id, P.name, P.look || {}, P.hat || null, P.outfit || null); g.position.set(w[0], S.G + sp.y + 0.01, w[1]); g.rotation.y = S.yaw + (sp.face || 0);
    try { g.userData.label.scale.set(1.6, 0.4, 1); } catch (e) {} g.traverse(function (o) { if (o.isMesh) { o.castShadow = false; o.userData.shSet = true; } }); scene.add(g); return g; }
  // instruments: the accordion and the bajo sexto ride on the chest bone; the tololoche stands on the platform
  function instrumentMesh(kind) { var K = new Kit();
    if (kind === "acc") { K.box("cloth", [0.12, 0.12, 0.13], 0.36, 0.3, 0.1, 0, 0, 0); for (var i = 0; i < 6; i++) K.box("cloth", i % 2 ? [0.62, 0.08, 0.1] : [0.9, 0.86, 0.8], 0.36, 0.3, 0.018, 0, 0, -0.07 - i * 0.022); K.box("enamel", [0.75, 0.1, 0.12], 0.37, 0.31, 0.06, 0, 0, -0.22); K.box("cloth", [0.95, 0.94, 0.9], 0.05, 0.28, 0.12, 0.2, 0, 0); for (var b = 0; b < 8; b++) K.cyl("tin", COL.gold, 0.01, 0.01, 0.02, -0.19, -0.11 + b * 0.03, -0.22, 6, false, 0, 0, HP); }
    else if (kind === "bajo") { K.cyl("wood", [0.62, 0.42, 0.24], 0.19, 0.19, 0.09, 0, 0, 0, 16, false, 0, HP); K.cyl("wood", [0.62, 0.42, 0.24], 0.15, 0.15, 0.09, 0, 0.24, 0, 16, false, 0, HP); K.cyl("cloth", [0.06, 0.05, 0.04], 0.05, 0.05, 0.095, 0, 0.12, 0, 12, false, 0, HP); K.box("wood", [0.32, 0.2, 0.12], 0.055, 0.62, 0.035, 0, 0.62, 0.0); K.box("wood", [0.32, 0.2, 0.12], 0.09, 0.16, 0.035, 0, 1.0, 0.0); }
    else { K.lathe("wood", [0.5, 0.28, 0.14], [[0.0, 0.0], [0.26, 0.04], [0.33, 0.32], [0.24, 0.6], [0.27, 0.86], [0.18, 1.08], [0.0, 1.1]], 0, 0.12, 0, 16, 1, 1, 0.45); K.box("wood", [0.15, 0.1, 0.07], 0.07, 0.8, 0.05, 0, 1.55, 0.05); K.cyl("wood", [0.15, 0.1, 0.07], 0.04, 0.03, 0.16, 0, 1.98, 0.05, 6); K.cyl("iron", COL.iron, 0.012, 0.012, 0.14, 0, 0.06, 0, 4); }
    var g = new THREE.Group(), geos = K.merge(); for (var bb in geos) { var m = new THREE.Mesh(geos[bb], MX[bb]); m.castShadow = false; g.add(m); } return g; }
  function boneOf(g, name) { var b = null; try { g.traverse(function (o) { if (!b && o.isBone && o.name === name) b = o; }); } catch (e) {} return b; }
  function attachInst(T) { var g = T.g, kind = T.P.inst; if (kind === "bass") { var m = instrumentMesh("bass"), S = SITE, k = (B.out && B.out.kiosco) || { c: [1, 0], Hb: 1 }; var lp = [k.c[0] + T.P.dx - 0.05, k.c[1] + T.P.dz + 0.42], w = l2w(lp[0], lp[1]); m.position.set(w[0], S.G + k.Hb + 0.02, w[1]); m.rotation.set(-0.12, S.yaw + PI + 0.25, 0, "YXZ"); scene.add(m); T.inst = m; return; }
    var bone = boneOf(g, "Spine02") || boneOf(g, "Spine01"); var m2 = instrumentMesh(kind); g.updateMatrixWorld(true);
    var fwd = new THREE.Vector3(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y)), base = g.position.clone();
    if (kind === "acc") { m2.position.copy(base).add(new THREE.Vector3(0, 1.18, 0)).addScaledVector(fwd, 0.24); m2.rotation.set(0, g.rotation.y + HP, 0); }
    else { m2.position.copy(base).add(new THREE.Vector3(0, 1.0, 0)).addScaledVector(fwd, 0.2); m2.rotation.set(0, g.rotation.y, -0.85, "YXZ"); }
    scene.add(m2); m2.updateMatrixWorld(true); if (bone) { try { bone.attach(m2); } catch (e) { note("attach", e); } } T.inst = m2; }
  function buildPeople() { if (PPL.made || typeof avatar !== "function") return; var S = SITE, o = B.out || {}; if (nowMs() < PPL.nextAt) return;
    var ids = Object.keys(PEOPLE_D).concat(TRIO_D.map(function (t) { return t.id; })); if (PPL.idx >= ids.length) { PPL.made = true; MC.n.people = PPL.list.length; return; }
    var id = ids[PPL.idx++], P = personDef(id), trio = !!P.inst, sp; PPL.nextAt = nowMs() + 900;
    if (trio) { var k = o.kiosco || { c: [1, 0], Hb: 1 }; sp = { x: k.c[0] + P.dx, z: k.c[1] + P.dz, y: k.Hb, face: 0 }; P.hat = P.hat || "hat_cowboy"; } else sp = personSpot(P);
    if (!sp) return; try { var g = makeRig(id, P, sp); var talk = (P.talk || C("talk." + id, null) || []).map(function (q) { return { t: q.t, o: q.o || [["Thanks", null]] }; }); if (!talk.length) talk = [{ t: (P.greet && P.greet[0]) || "Buenas.", o: [["Thanks", null]] }];
      var c = { id: "mc_" + id, name: P.name, role: P.role, pos: [g.position.x, g.position.z], look: P.look, hat: P.hat || null, outfit: null, greet: P.greet || ["Buenas."], talk: talk, kw: [], g: g, rot: g.rotation.y, mcShop: P.shop || null, mcId: id };
      CAST.push(c); var T = { id: id, P: P, g: g, c: c, sp: sp, yaw0: g.rotation.y, trio: trio, said: 0 }; PPL.list.push(T);
      if (trio || !P.shop) { var hs = { x: g.position.x, z: g.position.z, r: trio ? 3.4 : 2.6, t: P.name, k: P.role + " · press E to talk", p: talk[0].t, play: "npc:" + c.id }; hotspots.push(hs); T.hs = hs; }
      if (trio) attachInst(T); } catch (e) { note("person " + id, e); } }
  function peopleFrame(dt, near) { var cam = camera.position, px = player.position.x, pz = player.position.z, on = trioOn(), inr = !!(typeof inside !== "undefined" && inside);
    for (var i = 0; i < PPL.list.length; i++) { var T = PPL.list[i], g = T.g, d = Math.hypot(g.position.x - cam.x, g.position.z - cam.z), vis = !inr && d < 85 && (!T.trio || on);
      if (g.visible !== vis) { g.visible = vis; if (T.inst) T.inst.visible = vis; if (T.hs) T.hs.r = vis ? (T.trio ? 3.4 : 2.6) : 0; } if (!vis) continue;
      // face the player when they come close (vendors), the trio faces the square and sways a little
      var dp = Math.hypot(px - g.position.x, pz - g.position.z), want = T.yaw0; if (!T.trio && dp < 4.5) want = Math.atan2(px - g.position.x, pz - g.position.z); var err = Math.atan2(Math.sin(want - g.rotation.y), Math.cos(want - g.rotation.y)); if (!T.trio) { var lim = T.P.at === "pan" ? 1.2 : 0.9; var off = Math.atan2(Math.sin(want - T.yaw0), Math.cos(want - T.yaw0)); if (Math.abs(off) > lim) want = T.yaw0 + Math.sign(off) * lim; err = Math.atan2(Math.sin(want - g.rotation.y), Math.cos(want - g.rotation.y)); g.rotation.y += clamp(err, -dt * 2.2, dt * 2.2); }
      if (d < 40 || (FRAME_N & 3) === 0) { try { animateWalk(g, 0, d < 40 ? dt : dt * 4); } catch (e) {} }
      if (T.trio && T.inst && T.P.inst === "bass") T.inst.rotation.z = Math.sin(nowMs() / 1000 * 2.1 + i) * 0.03;
      if (!T.trio && dp < 3.4 && !T.greeted) { T.greeted = true; try { if (T.P.greet && T.P.greet.length) npcSay(T.c, T.P.greet[Math.floor(Math.random() * T.P.greet.length)]); } catch (e) {} } else if (dp > 9) T.greeted = false; } }

  // ───────────────────────── the music from the kiosco (the game's own Frontera track, positional, only with sound on) ─────────────────────────
  var MUS = MC.mus = MC.mus || { a: null, vol: 0, playing: false };
  function musicFrame(dt) { var want = 0; try { var k = (B.out && B.out.kiosco) || { c: [1, 0] }, w = l2w(k.c[0], k.c[1]), d = Math.hypot(camera.position.x - w[0], camera.position.z - w[1]); var ok = typeof soundOn !== "undefined" && soundOn && typeof audioReady !== "undefined" && audioReady && trioOn() && !(typeof inside !== "undefined" && inside) && !document.hidden;
      if (ok && d < 60) { var f = clamp(1 - (d - 5) / 55, 0, 1); want = Math.pow(f, 1.7) * 0.55 * (typeof VOL !== "undefined" ? VOL.music * VOL.master : 1); } } catch (e) {}
    MUS.vol += (want - MUS.vol) * Math.min(1, dt * 2.5); if (MUS.vol < 0.004 && want === 0) { if (MUS.playing && MUS.a) { MUS.a.pause(); MUS.playing = false; } return; }
    if (!MUS.a) { MUS.a = new Audio(au("/audio/radio_tejano.m4a")); MUS.a.loop = true; MUS.a.volume = 0; MUS.a.preload = "auto"; }
    MUS.a.volume = clamp(MUS.vol, 0, 1); if (!MUS.playing) { MUS.playing = true; try { var p = MUS.a.play(); if (p && p.catch) p.catch(function () { MUS.playing = false; }); } catch (e) { MUS.playing = false; } } }

  // ───────────────────────── shoppers: a PLAN_ROAM area over the square, the portales and the bosque ─────────────────────────
  function setupRoam() { var RO = window.PLAN_ROAM; if (!RO || !RO.area || RO.off || MC.roam) return; var S = SITE, o = B.out || {}, P = lotPolyW(0), x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; P.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); });
    var W = function (lx, lz) { var w = l2w(lx, lz); return { x: w[0], z: w[1] }; }, faceW = function (a) { return S.yaw + a; };
    var ents = [Object.assign(W(33.6, 0), { face: faceW(-HP), tag: "gate" }), Object.assign(W(1, 26.4), { face: faceW(PI), tag: "gold" }), Object.assign(W(-31.6, -15.4), { face: faceW(PI * 0.75), tag: "parkway" })];
    var pois = []; var add = function (lx, lz, kind, face, line, dur, tag) { var w = W(lx, lz); pois.push({ kind: kind, x: w.x, z: w.z, face: faceW(face), line: line, dur: dur, tag: tag }); };
    (o.counters || []).forEach(function (c) { var f = c.st && NORTE.indexOf(c.st) >= 0 ? frames().norte : frames().oriente, p = f.c2l(c.u, -ARC.D + 1.3); add(p[0], p[1], "look", (f === frames().norte ? PI : HP), c.st && c.st.shop ? "food" : "crafts", [8, 20], c.id); });
    (o.food || []).forEach(function (f) { add(f.x + (Math.random() - 0.5) * 1.2, FOODZ.front - 1.0, "look", PI, "food", [10, 24], f.id); });
    add(S.fnt[0] + 3.9, S.fnt[1] + 1.5, "look", -HP - 0.3, "plaza", [6, 14], "fountain"); add(1.0, -30.4, "look", PI, "mural", [10, 22], "mural"); add(26.6, -24.6, "look", HP, "food", [8, 18], "pan");
    [[-8, -14], [12, -14], [-6, 15.2], [9, 15.4], [-27, -3], [12, 5]].forEach(function (q, i) { add(q[0], q[1], "chat", i * 1.3, "plaza", [16, 40], "chat"); });
    [[-1.5, 7.6], [1, 8.2], [3.5, 7.6], [-0.2, 9.4], [2.4, 9.6]].forEach(function (q) { add(q[0], q[1], "dance", PI, "dance", [20, 60], "dance"); });
    var names = (C("roam.names", null) || ["Alma", "Ruben", "Itzel", "Joaquín", "Marisol", "Efraín", "Luz", "Gerardo"]).map(function (n) { return { name: n }; });
    var lines = C("roam.lines", null) || { plaza: ["Qué bonita tarde.", "Let's walk the square once more.", "The trio is good tonight."], food: ["Two al pastor, please.", "The horchata here is the best."], crafts: ["Look at the blue on this one.", "My grandmother had a sarape like that."], mural: ["That's the kiosco in Agua Prieta.", "Look, the biplane."], dance: ["¡Ándale!", "One more song!"] };
    var def = { id: "mercado", max: 4, box: [x0, z0, x1, z1], people: names, lines: lines, ready: function () { return !!B.built; },
      levels: [{ base: function (x, z) { return planGroundAt(x, z); }, exact: true, block: function (x, z) { if (!inLot(x, z, -0.6)) return true; var q = w2l(x, z), k = (B.out && B.out.kiosco) || { c: [1, 0] }; return Math.hypot(q[0] - k.c[0], q[1] - k.c[1]) < 5.3; } }],
      entries: function () { return ents; }, seeds: function () { return [W(1, 12.5), W(-8, -8), W(12, -6), W(23, 6), W(4, -24.4), W(-27, 0)]; }, pois: function () { return pois; },
      seatInfo: function (sd) { return sd.tag === "mercado" && sd.seat && !sd.lie ? { kind: "sit", line: "plaza", tag: "bench" } : null; },
      weight: function (p, h) { var ev = h >= 19 && h < 23 && trioOn(h); if (p.kind === "dance") return ev ? 3.0 : 0; if (p.kind === "sit") return 2.0; if (p.kind === "chat") return 1.1; if (p.line === "food") return h >= 11 && h < 15 || h >= 18 && h < 22 ? 2.2 : 0.9; return 1.0; },
      count: function (h) { return h >= 9 && h < 19 ? 3 : h >= 19 && h < 23 ? 4 : h >= 7 && h < 24 ? 2 : 1; },
      dur: { sit: [25, 70], chat: [15, 40], look: [6, 16], dance: [20, 60] }, visible: function () { return true; }, sameZone: function () { return true; } };
    try { var A = RO.area(def); if (A) { MC.roam = def.id; cnt("roam"); } } catch (e) { note("roam area", e); } }

  // ───────────────────────── the shop card: the game's coin shop (server items coffee, meal and a few wearables) under the mercado's names ─────────────────────────
  var EFFECT = { coffee: "+40 energy", meal: "Energy back to 100" };
  var SHOP = MC.shopState = MC.shopState || { open: null, bought: {} };
  function personFor(shopId) { for (var i = 0; i < PPL.list.length; i++) if (PPL.list[i].P.shop === shopId) return PPL.list[i]; return null; }
  function openMcShop(id) { try { var d = shopDef(id); if (!d || !d.rows || !d.rows.length || typeof view === "undefined" || !view) return false; var me = view.players[ME]; if (!me) return false; var prices = (view.prices && view.prices.shop) || {}, T = personFor(id);
      $id("shop-h").textContent = d.title || "Mercado Plaza"; $id("shop-k").textContent = (T && T.P.greet ? T.P.name + ": “" + T.P.greet[0] + "” · " : "") + (d.k || ""); var list = $id("shop-list"); list.innerHTML = "";
      d.rows.forEach(function (r) { var it = r[0]; if (prices[it] === undefined) return; var row = document.createElement("div"), b = document.createElement("b"), sm = document.createElement("span"), btn = document.createElement("button"), left = document.createElement("div");
        b.textContent = r[1]; sm.textContent = (r[2] ? r[2] + " · " : "") + (EFFECT[it] ? EFFECT[it] + " · " : "") + prices[it] + " GB"; sm.style.opacity = ".7"; btn.className = "btn"; btn.style.padding = "6px 12px";
        var owned = (me.owned || []).indexOf(it) >= 0, wearing = me.hat === it || me.outfit === it;
        if (owned && it.indexOf("gear_") === 0 && typeof GEAR_SLOT !== "undefined") { var slot = GEAR_SLOT[it], on = me.gear && me.gear[slot] === it; btn.textContent = on ? "Take off" : "Wear"; btn.onclick = function () { var gr = {}; gr[slot] = on ? null : it; act({ t: "wear", gear: gr }); sfx("ui"); setTimeout(function () { openMcShop(id); }, 250); }; }
        else if (owned && (it.indexOf("hat_") === 0 || it.indexOf("outfit_") === 0)) { btn.textContent = wearing ? "Take off" : "Wear"; btn.onclick = function () { var o = {}; o[it.indexOf("hat_") === 0 ? "hat" : "outfit"] = wearing ? null : it; o.t = "wear"; act(o); sfx("ui"); setTimeout(function () { openMcShop(id); }, 250); }; }
        else { btn.textContent = "Buy"; btn.disabled = (me.coins || 0) < prices[it]; btn.onclick = function () { act({ t: "buy", item: it }); sfx("buy"); bought(id, r, T); setTimeout(function () { openMcShop(id); }, 250); }; }
        left.append(b, document.createElement("br"), sm); row.append(left, btn); list.append(row); });
      if (T) { var row2 = document.createElement("div"), l2 = document.createElement("div"), b2 = document.createElement("b"), s2 = document.createElement("span"), bt2 = document.createElement("button"); b2.textContent = T.P.name; s2.textContent = T.P.role; s2.style.opacity = ".7"; bt2.className = "btn ghost"; bt2.style.padding = "6px 12px"; bt2.textContent = "Talk"; bt2.onclick = function () { try { closeCards(); showTalk(T.c, 0); } catch (e) { note("talk", e); } }; l2.append(b2, document.createElement("br"), s2); row2.append(l2, bt2); list.append(row2); }
      $id("shop-coins").textContent = (me.coins || 0) + " GB · " + (typeof rankOf === "function" ? rankOf(me.xp || 0) : ""); $id("shop").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock(); SHOP.open = id; cnt("shopOpen"); return true; } catch (e) { note("shop", e); return false; } }
  var FOODSHOPS = { tacos: 1, elotes: 1, aguas: 1, churros: 1, pan: 1, cafe: 1, fonda: 1, paletas: 1, dulces: 1 };
  function bought(id, r, T) { SHOP.bought[id] = (SHOP.bought[id] || 0) + 1; cnt("buy_" + id); if (FOODSHOPS[id]) stamp(C("stamps.food", "p_mc_antojitos")); else { craftSeen("shop_" + id); }
    try { if (T) npcSay(T.c, (C("lines.thanks", null) || ["¡Provecho!", "Gracias, que le vaya bien.", "¡Buen provecho!"])[Math.floor(Math.random() * 3)]); } catch (e) {}
    try { setStatus(r[1] + " · " + (EFFECT[r[0]] || "yours now")); } catch (e) {} }
  // the counters you can order at (local standing point, the shop, a radius)
  function counterTargets() { var o = B.out || {}, out = []; (o.food || []).forEach(function (f) { out.push({ id: f.fd.shop, x: f.counter[0], z: f.counter[1], fx: 0, fz: 1, r: 2.4 }); });
    if (o.panCounter) out.push({ id: "pan", x: o.panCounter[0], z: o.panCounter[2], fx: 1, fz: 0, r: 2.0 });
    (o.counters || []).forEach(function (c) { if (!c.st || !c.st.shop) return; var f = NORTE.indexOf(c.st) >= 0 ? frames().norte : frames().oriente, p = f.c2l(c.u, -ARC.D + 0.9), q = f.c2l(c.u, -ARC.D - 1); out.push({ id: c.st.shop, x: p[0], z: p[1], fx: q[0] - p[0], fz: q[1] - p[1], r: 2.2 }); }); return out; }
  var CT = null; function counters() { return CT || (CT = counterTargets()); }
  function busy() { try { return !player || (typeof SIT !== "undefined" && SIT.on) || (typeof riding !== "undefined" && riding) || (typeof cartMode !== "undefined" && cartMode) || (typeof inside !== "undefined" && inside) || (typeof FLY !== "undefined" && FLY.on) || (typeof golf !== "undefined" && golf.playing); } catch (e) { return true; } }
  function nearCounter() { if (!B.built || busy()) return null; var q = w2l(player.position.x, player.position.z); if (rdist(q, SITE.lot) > 3) return null; var yaw0 = player.rotation.y - SITE.yaw, fx = Math.sin(yaw0), fz = Math.cos(yaw0), best = null, bd = 1e9;
    counters().forEach(function (c) { var dx = c.x - q[0], dz = c.z - q[1], d = Math.hypot(dx, dz); if (d > c.r || d >= bd) return; var L = Math.hypot(c.fx, c.fz) || 1, facing = (dx * fx + dz * fz) / (d || 1); if (d > 0.9 && facing < -0.1) return; bd = d; best = c; }); return best; }
  function handleE() { var c = nearCounter(); if (!c) { try { var nh = typeof nearestHotspot === "function" ? nearestHotspot() : null; if (nh && nh.mcCard) craftSeen(nh.mcCard); } catch (e) {} return false; } closeCards(); return openMcShop(c.id); }
  function promptFrame() { try { var c = nearCounter(); if (!c) return; var el = $id("prompt"), t = $id("prompt-t"); if (!el || !t) return; var d = shopDef(c.id); t.innerHTML = "<b>E</b> &nbsp;" + esc(C("prompts.order", "order at") + " " + (d.title || "the counter")); el.classList.add("on"); } catch (e) { note("prompt", e); } }
  // the info cards (client hotspots): the kiosco, the fountain, the mural, the gateway, the craft stalls, the bosque
  var CARDS = MC.cards = MC.cards || []; var CRAFT = MC.craft = MC.craft || {};
  function craftSeen(id) { if (!id || CRAFT[id]) return; if (!/^(shop_|talavera|hojalata|pinatas|juguetes|flores|chiles|velas|barro)/.test(id)) return; CRAFT[id] = 1; if (Object.keys(CRAFT).length >= 3) stamp(C("stamps.crafts", "p_mc_artesanias")); }
  function addCards() { var o = B.out || {}, I = C("info", {}) || {}, S = SITE, list = [];
    (o.counters || []).forEach(function (c) { if (!c.st || !c.st.info) return; var f = NORTE.indexOf(c.st) >= 0 ? frames().norte : frames().oriente, p = f.c2l(c.u, -ARC.D + 1.0); list.push([c.st.info, p[0], p[1], 2.2]); });
    if (o.kiosco) list.push(["kiosco", o.kiosco.c[0], o.kiosco.c[1] + 7.2, 2.6]); if (o.fountain) list.push(["fountain", o.fountain.c[0] + 3.8, o.fountain.c[1], 2.2]);
    if (o.casa) list.push(["mural", o.casa.mural[0], o.casa.mural[2], 2.8]); if (o.gate) list.push(["gateway", o.gate.inner[0] + 1.6, o.gate.inner[2], 2.2]);
    list.push(["bosque", -27.5, -2.5, 3.0]); list.push(["plaza", 1, 13.8, 2.2]);
    list.forEach(function (q) { var d = I[q[0]]; if (!d) return; var w = l2w(q[1], q[2]); var h = { x: w[0], z: w[1], r: q[3], t: d.t, k: d.k, p: d.p, mcCard: q[0] }; hotspots.push(h); CARDS.push(h); }); MC.n.cards = CARDS.length; }
  // ───────────────────────── overrides (by bare name, falling through to the client for everything else) ─────────────────────────
  var OV = MC.ov = MC.ov || {};
  function installOverrides() {
    if (!OV.openNearest && typeof openNearest === "function") { try { var on0 = openNearest; openNearest = function () { try { if (handleE()) return; } catch (e) { note("E", e); } return on0.apply(this, arguments); }; OV.openNearest = true; } catch (e) { note("ov openNearest", e); } }
    if (!OV.updateZone && typeof updateZone === "function") { try { var uz0 = updateZone; updateZone = function () { var r = uz0.apply(this, arguments); promptFrame(); return r; }; OV.updateZone = true; } catch (e) { note("ov updateZone", e); } }
    if (!OV.showTalk && typeof showTalk === "function") { try { var st0 = showTalk; showTalk = function (c, idx) { var r = st0.apply(this, arguments); try { if (c && c.mcShop && idx === 0) { var box = $id("talk-o"); if (box) { var b = document.createElement("button"); b.className = "btn"; b.textContent = C("prompts.orderBtn", "Order"); b.onclick = function () { sfx("ui"); closeCards(); openMcShop(c.mcShop); }; box.insertBefore(b, box.firstChild); } } } catch (e) { note("talk order", e); } return r; }; OV.showTalk = true; } catch (e) { note("ov showTalk", e); } } }

  // ───────────────────────── the frame: night levels, water and paper in motion, people, music, stamps ─────────────────────────
  var FRM = MC.frm = MC.frm || { k: -1, n: 0 };
  function nightLevels() { var k = clamp((nightK() - 0.1) / 0.45, 0, 1); if (Math.abs(k - FRM.k) < 0.01) return; FRM.k = k;
    if (MX.lamp) MX.lamp.emissiveIntensity = 2.8 * k; if (MX.tin) MX.tin.emissiveIntensity = 0.45 * k; if (MX.glowK) MX.glowK.emissiveIntensity = 1.4 + 1.1 * k; if (MX.signs) MX.signs.emissiveIntensity = 0.24 * k; if (MX.veil) MX.veil.emissiveIntensity = 0.12 - 0.08 * k;
    if (MX.pool) MX.pool.opacity = k; if (B.glow) B.glow.visible = k > 0.02; B.lights.forEach(function (l) { l.intensity = (l.userData.k0 || 1) * k; }); }
  function stamps() { var S = SITE, q = w2l(player.position.x, player.position.z), inSq = inR(q, S.sq, 0.5) && !(typeof FLY !== "undefined" && FLY.on); if (!inSq && !inR(q, S.lot, 0)) return;
    if (inSq) stamp(C("stamps.plaza", "p_mc_plaza")); if (inSq && nightK() > 0.55) stamp(C("stamps.night", "p_mc_noche"));
    var k = B.out && B.out.kiosco; if (k && Math.hypot(q[0] - k.c[0], q[1] - k.c[1]) < 4.5 && player.position.y > S.G + 0.8 && trioOn()) stamp(C("stamps.kiosco", "p_mc_kiosco")); }
  function frameHook(dt) { if (!B.built || typeof player === "undefined" || !player) return; var t0 = nowMs(); try { var cam = camera.position, w = l2w(1, 0), dc = Math.hypot(cam.x - w[0], cam.z - w[1]);
      if (dc < 240) { PAPEL.uT.value += dt; if (MX.water && MX.water.normalMap) { MX.water.normalMap.offset.x += dt * 0.018; MX.water.normalMap.offset.y += dt * 0.011; } if (MX.veil && MX.veil.map) MX.veil.map.offset.y = (MX.veil.map.offset.y - dt * 0.75) % 1; }
      if (FRAME_N % 20 === 7) nightLevels();
      if (dc < 190) { buildPeople(); peopleFrame(dt); } else if (PPL.list.length && FRAME_N % 30 === 0) PPL.list.forEach(function (T) { if (T.g.visible) { T.g.visible = false; if (T.inst) T.inst.visible = false; } });
      if (FRAME_N % 4 === 0) musicFrame(dt * 4);
      if (FRAME_N % 15 === 3) stamps(); } catch (e) { note("frame", e); } var ms = nowMs() - t0; if (ms > (MC.t.frameMax || 0)) MC.t.frameMax = Math.round(ms * 100) / 100; }

  // ───────────────────────── api and debug ─────────────────────────
  MC.api = { shop: openMcShop, counters: function () { return counters(); }, trioOn: trioOn, people: function () { return PPL.list.map(function (T) { return { id: T.id, name: T.P.name, vis: T.g.visible, x: Math.round(T.g.position.x * 10) / 10, z: Math.round(T.g.position.z * 10) / 10 }; }); } };
  MC.debug = { l2w: function (x, z) { return SITE ? l2w(x, z) : null; }, w2l: function (x, z) { return SITE ? w2l(x, z) : null; }, lotPolyW: function (m) { return SITE ? lotPolyW(m || 0) : null; }, inLot: function (x, z, m) { return SITE ? inLot(x, z, m) : null; }, night: function () { FRM.k = -1; nightLevels(); return FRM.k; } };
  MC.impl = true;
})();
