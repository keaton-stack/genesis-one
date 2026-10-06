// R7 (2 Oct 2026): the Solport Convention Center, part A: the MAIN ARENA and its FORECOURT. Classic script, loaded before client.js;
// hooks into window.PLAN_HOOKS { terrain, world, defer, frame, interior }. All names, copy, sizes and positions: plan/convention.json.
//   - the exterior: a low, wide ellipse (about 170 x 120 m, 25 m tall) wrapped in a folded skin of weathered copper and desert
//     sandstone: long horizontal ribbons of diamond facets that sweep round the sides, a glazed band at the foot, a soffit with
//     downlights, a copper roof edge, finished service sides (sandstone podium, service doors, louvres) and, facing east over the
//     doors, a curved LED media wall (one shader material: green and gold aurora with the name, the community impact counter, the
//     night sky after dark).
//   - the forecourt (x -300..-250, z -140..-40): pale stone paving and decomposed granite, saguaros, palo verdes, agave beds, cut
//     sandstone seating blocks, white tensile shade sails on steel masts, banner poles, bollards, the glass entrance doors.
//   - inside (built near, time sliced, drawn only from inside or through the glass): the Grand Lobby (registration, wayfinding,
//     lounges, planters), the Keynote Hall (a stage with layered LED walls, a lighting truss with beams, a folded copper ceiling,
//     red sandstone side walls with saguaros, about 4,500 instanced seats on a flat floor and raked tiers with stepped aisles, a
//     speaker), two breakout rooms; sit in an aisle seat to watch, or "Watch the keynote" from the portal.
//   - R10 (3 Oct 2026): the baked seated audience is gone. The people are the roaming ones of plan_festival's PLAN_ROAM: this
//     module gives them routes into the lobby and, for the keynote, to a few front-row seats (api.roam), opens the doors for them,
//     and says which of them can be seen from where (the lobby through the glass, the hall only from inside).
// No new real lights (a few lamps through the client's light pool), shared materials with stable program keys, instancing.
// ?conv=0 turns the module off. window.PLAN_CONV: n (counters), errs, cfg, site, api, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var CV = window.PLAN_CONV = window.PLAN_CONV || {};
  var R9V = !!(window.R9 && window.R9.part("v"));   // R9 (HANDOFF_R9_HITCHES.md): ?r9v=0 turns this module's hitch fixes off (finer build steps)
  CV.errs = CV.errs || []; CV.n = CV.n || { builds: 0, disposes: 0 }; CV.ver = "r10";
  if (/[?&]conv=0\b/.test(location.search)) { CV.off = true; return; }
  var PI = Math.PI, TAU = PI * 2;
  function note(tag, e) { try { if (CV.errs.length < 50) CV.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (CV.errs.length <= 6) console.warn("plan_convention " + tag, e); } catch (x) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function nowMs() { return performance.now(); }
  function has(k) { try { return !!(MODELS[k] && (MODELS[k].parts || MODELS[k]._pp)); } catch (e) { return false; } }
  function canPut(k) { try { return has(k) && !!MODEL_SPECS[k]; } catch (e) { return false; } }
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function $id(id) { return document.getElementById(id); }
  function V3(x, y, z) { return new THREE.Vector3(x, y, z); }

  // ───────────────────────── config: plan/convention.json ─────────────────────────
  var CFG = CV.cfg || null;
  function cfgUrl() { var u = "/plan/convention.json?v=" + (window.BUILD || "dev"); try { if (window.AV) u = window.AV(u); } catch (e) {} return u; }
  if (!CFG) { try { fetch(cfgUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && !CFG) CFG = CV.cfg = d; }).catch(function (e) { note("cfg fetch", e); }); } catch (e) { note("cfg", e); } }
  function cfg() { if (CFG) return CFG; try { var x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = CV.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); } return CFG; }
  function C(path, dflt) { var o = cfg(); if (!o) return dflt; var p = path.split("."); for (var i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }
  function hex(s, d) { try { return new THREE.Color(s || d); } catch (e) { return new THREE.Color(d); } }
  function lowTier() { try { return ASSET.tier === "m"; } catch (e) { return false; } }
  function qual() { try { return localStorage.getItem("g1:quality") || "high"; } catch (e) { return "high"; } }

  // ───────────────────────── geometry kit: parts collected per base material, each with its own colour (a vertex colour) ─────────────────────────
  var _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1);
  var _cc = {};
  function rgb(c) { if (Array.isArray(c)) return c; if (typeof c === "number" || typeof c === "string") { var k = String(c); if (_cc[k]) return _cc[k]; var q = new THREE.Color(c); return (_cc[k] = [q.r, q.g, q.b]); } return [1, 1, 1]; }
  function Kit() { this.m = {}; this.tris = 0; }
  // add a geometry under base b with colour col (hex or [r, g, b]), transformed by m4 (optional)
  Kit.prototype.add = function (b, g, col, m4) {
    if (g.index) g = g.toNonIndexed(); if (m4) g.applyMatrix4(m4); if (!g.attributes.normal) g.computeVertexNormals();
    var n = g.attributes.position.count; if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.color) { var c = rgb(col === undefined ? 0xffffff : col), ca = new Float32Array(n * 3); for (var i = 0; i < n; i++) { ca[i * 3] = c[0]; ca[i * 3 + 1] = c[1]; ca[i * 3 + 2] = c[2]; } g.setAttribute("color", new THREE.BufferAttribute(ca, 3)); }
    (this.m[b] || (this.m[b] = [])).push(g); this.tris += n / 3; return g; };
  Kit.prototype.place = function (b, g, col, x, y, z, ry, rx, rz, sx, sy, sz) { _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(x || 0, y || 0, z || 0), _q, _v2.set(sx || 1, sy || 1, sz || 1)); return this.add(b, g, col, _m4); };
  Kit.prototype.box = function (b, col, w, h, d, x, y, z, ry, t, rx, rz) { var g = new THREE.BoxGeometry(w, h, d); if (t) uvBox(g, w, h, d, t); return this.place(b, g, col, x, y, z, ry, rx, rz); };
  Kit.prototype.cyl = function (b, col, r0, r1, h, x, y, z, seg, open, ry, rx, rz) { return this.place(b, new THREE.CylinderGeometry(r0, r1, h, seg || 12, 1, !!open), col, x, y, z, ry, rx, rz); };
  Kit.prototype.sph = function (b, col, r, x, y, z, seg, sx, sy, sz) { return this.place(b, new THREE.SphereGeometry(r, seg || 10, Math.max(5, (seg || 10) >> 1)), col, x, y, z, 0, 0, 0, sx, sy, sz); };
  // a round tube from A to B
  Kit.prototype.tube = function (b, col, A, B, r, seg) { var d = _v3.subVectors(B, A), L = d.length(); if (L < 1e-4) return null; var g = new THREE.CylinderGeometry(r, r, L, seg || 6, 1, true); _q.setFromUnitVectors(_v1.set(0, 1, 0), d.clone().normalize()); _m4.compose(_v2.addVectors(A, B).multiplyScalar(0.5), _q, _s1); return this.add(b, g, col, _m4); };
  // a box beam from A to B (w across, d deep), its depth axis toward nrm
  Kit.prototype.beam = function (b, col, A, B, w, d, nrm) { var dir = _v1.subVectors(B, A); var L = dir.length(); if (L < 1e-4) return null; dir.multiplyScalar(1 / L); var e2 = _v2.copy(nrm || V3(0, 1, 0)).addScaledVector(dir, -(nrm || V3(0, 1, 0)).dot(dir)); if (e2.lengthSq() < 1e-8) e2.set(dir.y, -dir.x, dir.z).cross(dir); e2.normalize(); var e1 = _v3.crossVectors(e2, dir).normalize(); var g = new THREE.BoxGeometry(w, L, d); _m4.makeBasis(e1, dir, e2); _m4.setPosition((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2); return this.add(b, g, col, _m4); };
  // a flat triangle list [[a, b, c], ...] of Vector3 with flat normals; uv by projection (t metres a repeat) or per-vertex uvs [[ua, va], ...]
  Kit.prototype.tri = function (b, col, list, t, uvs, cols) { if (!list.length) return null; var P = [], N = [], U = [], CC = []; t = t || 1; var nn = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (var i = 0; i < list.length; i++) { var tr = list[i], a = tr[0], bb = tr[1], c = tr[2]; nn.crossVectors(e1.subVectors(bb, a), e2.subVectors(c, a)).normalize(); var ax = Math.abs(nn.x), ay = Math.abs(nn.y), az = Math.abs(nn.z);
      for (var k = 0; k < 3; k++) { var v = tr[k]; P.push(v.x, v.y, v.z); N.push(nn.x, nn.y, nn.z); if (uvs) { U.push(uvs[i][k][0], uvs[i][k][1]); } else if (ay >= ax && ay >= az) U.push(v.x / t, v.z / t); else if (ax >= az) U.push(v.z / t, v.y / t); else U.push(v.x / t, v.y / t); var q = cols ? cols[i] : rgb(col); CC.push(q[0], q[1], q[2]); } }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(CC, 3)); return this.add(b, g); };
  // a quad a, b, c, d (counter-clockwise seen from its front) as two triangles; uv per corner [[u, v] x 4]
  Kit.prototype.quad = function (b, col, a, bb, c, d, uv) { uv = uv || [[0, 0], [1, 0], [1, 1], [0, 1]]; return this.tri(b, col, [[a, bb, c], [a, c, d]], 1, [[uv[0], uv[1], uv[2]], [uv[0], uv[2], uv[3]]]); };
  Kit.prototype.merge = function () { var out = {}; for (var k in this.m) { var g = mergeAll(this.m[k]); if (g) out[k] = g; } return out; };
  // one mesh per base into grp (bases: name -> material)
  Kit.prototype.build = function (grp, bases, opts) { opts = opts || {}; var out = [], geos = this.merge(); for (var b in geos) { var mt = bases[b]; if (!mt) { note("base", b); continue; } var me = new THREE.Mesh(geos[b], mt); me.name = "cv " + b; me.castShadow = !!opts.cast && !mt.transparent; me.receiveShadow = opts.receive !== false && !mt.transparent && !mt.isShaderMaterial; me.userData.shSet = true; if (mt.transparent) me.renderOrder = mt.blending === THREE.AdditiveBlending ? 3 : 2; grp.add(me); out.push(me); } return out; };
  function* buildSteps(K, grp, bases, opts, out) { var keys = Object.keys(K.m); yield 1; for (var i = 0; i < keys.length; i++) { var b = keys[i], g = mergeAll(K.m[b]); K.m[b] = null; if (!g) continue; var mt = bases[b]; if (!mt) { note("base", b); continue; } var me = new THREE.Mesh(g, mt); me.name = "cv " + b; me.castShadow = !!(opts && opts.cast) && !mt.transparent; me.receiveShadow = !mt.transparent && !mt.isShaderMaterial; me.userData.shSet = true; if (mt.transparent) me.renderOrder = mt.blending === THREE.AdditiveBlending ? 3 : 2; grp.add(me); if (out) out.push(me); yield 1; } }
  function mergeAll(list) {
    if (!list || !list.length) return null; var n = 0; list.forEach(function (g) { n += g.attributes.position.count; }); if (!n) return null; var extra = {}; list.forEach(function (g) { for (var k in g.attributes) if (k !== "position" && k !== "normal" && k !== "uv" && k !== "color") extra[k] = g.attributes[k].itemSize; });
    var P = new Float32Array(n * 3), N = new Float32Array(n * 3), Uu = new Float32Array(n * 2), Cc = new Float32Array(n * 3), X = {}, o = 0; for (var k in extra) X[k] = new Float32Array(n * extra[k]);
    list.forEach(function (g) { var c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); Uu.set(g.attributes.uv.array, o * 2); Cc.set(g.attributes.color.array, o * 3); for (var k2 in X) if (g.attributes[k2]) X[k2].set(g.attributes[k2].array, o * extra[k2]); o += c; });
    var r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(Uu, 2)); r.setAttribute("color", new THREE.BufferAttribute(Cc, 3)); for (var k3 in X) r.setAttribute(k3, new THREE.BufferAttribute(X[k3], extra[k3]));
    r.computeBoundingBox(); r.computeBoundingSphere(); return r; }
  function uvBox(g, w, h, d, t) { var uv = g.attributes.uv; var dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (var f = 0; f < 6; f++) for (var k = 0; k < 4; k++) { var i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } }
  // a rounded box (cushions, blocks): BoxGeometry subdivided and its corners pulled in to radius r
  var RBX = {};
  function rbox(w, h, d, r, seg) { var key = [w, h, d, r, seg].join(":"); if (RBX[key]) return RBX[key].clone(); seg = seg || 2; var g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2); var p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3(); var hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
    for (var i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); c.set(clamp(v.x, -hw, hw), clamp(v.y, -hh, hh), clamp(v.z, -hd, hd)); var dd = v.clone().sub(c); if (dd.lengthSq() > 1e-10) { dd.setLength(r); v.copy(c).add(dd); } p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); RBX[key] = g; return g.clone(); }
  // a turned shape from a profile [[r, y], ...] bottom to top
  function lathe(prof, seg) { return new THREE.LatheGeometry(prof.map(function (q) { return new THREE.Vector2(Math.max(0.0001, q[0]), q[1]); }), seg || 12); }

  // ───────────────────────── the site (arena frame: u east, v south from the arena centre; y up from the graded pad) ─────────────────────────
  var SITE = CV.site = CV.site || null;
  function resolveSite() {
    if (SITE) return SITE; var c = cfg(); if (!c) return null; var A = c.arena || {};
    var S = { cx: A.cx || -385, cz: A.cz || -90, a: A.a || 85, b: A.b || 60, H: A.height || 25, Hf: A.edgeFront || 25, Hs: A.edgeEnds || 13.5, Hb: A.edgeBack || 18.5, Hc: A.crown || 24, y0: A.skinBase || 6, gk: A.glassK || 0.965, phiL: A.ledHalfAngle || 0.4, ledB: A.ledBottom || 7, ledT: A.ledTop || 17.2, N: A.columns || 220, seed: A.seed || 7,
      fc: c.forecourt || { x0: -300, x1: -250, z0: -140, z1: -40 }, hub: c.hub || [-268, -90], G: 0 };
    // the interior plan (u, v in metres): the Keynote Hall, its stage and seating, the corridors, the breakout rooms, the lobby
    S.hall = { u0: -58, u1: 17, v: 33, ceil: 13.5, top: 16, stage: [-58, -46, 24, 1.3], flat0: -41, flatN: 28, flatP: 0.95, rake0: -10.5, rakeN: 24, rakeP: 1.0, rakeR: 0.3, cross: [-14.6, -11], portal: [-14.4, -11.2] };
    S.sec = [[-26.6, -14.3], [-12.3, 12.3], [14.3, 26.6]];   // seat sections across (v)
    S.corr = { v0: 33.4, v1: 36.4, u0: -15.5, u1: 40 };
    S.brk = [{ id: "breakA", v0: -32.6, v1: -1.2, u0: 17.6, u1: 39.4, door: -16 }, { id: "breakB", v0: 1.2, v1: 32.6, u0: 17.6, u1: 39.4, door: 16 }];
    S.lobby = { u0: 40, ceil: 6.0 };
    return (SITE = CV.site = S);
  }
  function w2l(x, z) { return [x - SITE.cx, z - SITE.cz]; }
  function l2w(u, v) { return [SITE.cx + u, SITE.cz + v]; }
  // the ellipse at scale k: its u at a given v (front, east), and whether (u, v) is inside
  function eK(u, v) { return Math.sqrt((u / SITE.a) * (u / SITE.a) + (v / SITE.b) * (v / SITE.b)); }
  function uAt(v, k) { var q = k * k - (v / SITE.b) * (v / SITE.b); return q > 0 ? SITE.a * Math.sqrt(q) : 0; }
  // the forecourt rectangle and the arena ellipse, for clearing, keep-outs and grading
  function inLot(x, z, m) { m = m || 0; var S = SITE; var q = w2l(x, z); if (eK(q[0], q[1]) < 1.04 + m / 60) return true; var f = S.fc; return x > f.x0 - 6 - m && x < f.x1 + m && z > f.z0 - m && z < f.z1 + m; }
  function lotDist(x, z) { var S = SITE, q = w2l(x, z); var e = eK(q[0], q[1]); var de = Math.max(0, (e - 1.04)) * Math.min(S.a, S.b); var f = S.fc; var dx = Math.max(f.x0 - 6 - x, 0, x - f.x1), dz = Math.max(f.z0 - z, 0, z - f.z1); return Math.min(de, Math.hypot(dx, dz)); }
  var VEG = /^(bush\d|mesquite|ocotillo|saguaro.*|paloverde|ironwood|desertwillow|barrel_cactus|prickly_pear|cholla|organ_pipe|agave_cluster|yucca_cluster|boulder|fanpalm.*|datepalm|canarypalm|lamp|ph_(rock|boulder|shrub|succulent|stones|sandrocks)_?\d*)$/;
  function clearLot() {
    var removed = 0, keys = new Set();
    for (var k in PLACE) { if (!VEG.test(k)) continue; var L = PLACE[k], out = []; for (var i = 0; i < L.length; i++) { var e = L[i]; if (!e.cv && inLot(e[0], e[2], 1)) { keys.add(Math.round(e[0] * 100) + ":" + Math.round(e[2] * 100)); removed++; } else out.push(e); } if (out.length !== L.length) { L.length = 0; Array.prototype.push.apply(L, out); } }
    if (keys.size) for (var j = COLLIDERS.length - 1; j >= 0; j--) { var c = COLLIDERS[j]; if (keys.has(Math.round(c[0] * 100) + ":" + Math.round(c[1] * 100))) COLLIDERS.splice(j, 1); }
    CV.n.cleared = (CV.n.cleared || 0) + removed;
  }
  // the City's west apron (site.json) lay where the arena stands (a taxiway is cut only while it still runs through the lot; the
  // main session's site.json now starts it at x -178.9, so nothing is cut) and its taxiway ran across the campus to the main taxiway: the apron
  // is reduced to nothing and the taxiway starts at x -160 (the brief's south boundary, apt_main_twy from x -160 east). Both arrays are
  // shared with the client's deferred ribbon / polygon builders and its ROADS entry, so they are edited in place. Idempotent.
  function trimAirside() {
    var S = SITE, n = 0; try {
      (clientSite().aprons || []).forEach(function (ap) { if (!ap || ap.length < 3 || ap.cvTrim) return; var cx = 0, cz = 0; ap.forEach(function (p) { cx += p[0]; cz += p[1]; }); cx /= ap.length; cz /= ap.length; if (!inLot(cx, cz, 30)) return; var q = l2w(0, 0); ap.length = 0; ap.push([q[0], q[1]], [q[0] + 0.01, q[1]], [q[0], q[1] + 0.01]); ap.cvTrim = true; n++; });
      (clientSite().taxiways || []).forEach(function (tw) { if (!tw || tw.length < 2 || tw.cvTrim) return; var x0 = -160; if (!(tw[0][0] < x0 && tw[tw.length - 1][0] > x0 && tw.some(function (p) { return inLot(p[0], p[1], 30); }))) return; var out = []; for (var i = 0; i < tw.length - 1; i++) { var a = tw[i], b = tw[i + 1]; if (a[0] < x0 && b[0] >= x0) { var t = (x0 - a[0]) / (b[0] - a[0]); out.push([x0, a[1] + (b[1] - a[1]) * t]); } if (a[0] >= x0) out.push(a); } out.push(tw[tw.length - 1]); tw.length = 0; Array.prototype.push.apply(tw, out); tw.cvTrim = true; n++; });
      if (n) { try { ROADGRID.map = null; } catch (e) {} }
    } catch (e) { note("airside", e); } CV.n.airside = n; }
  function clientSite() { try { return (0, eval)("SITE") || {}; } catch (e) { return {}; } }

  // ───────────────────────── terrain hook: one level pad under the arena and the forecourt, the planting ─────────────────────────
  function gridH(x, z) { try { return sampleGrid(H, T, x, z); } catch (e) { return getH(x, z); } }
  function terrainHook() {
    if (CV.off || !window.PLAN || !SITE) return; var S = SITE, t0 = nowMs();
    try {
      var s = 0, n = 0; for (var u = -80; u <= 80; u += 4) for (var v = -56; v <= 56; v += 4) if (eK(u, v) < 1) { var w = l2w(u, v); s += gridH(w[0], w[1]); n++; } S.G = n ? s / n : gridH(S.cx, S.cz);
      if (typeof H !== "undefined" && H && T) { var cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1), blend = 14, cnt = 0;
        var x0 = S.cx - S.a * 1.1 - blend, x1 = S.fc.x1 + blend, z0 = S.cz - S.b * 1.1 - blend, z1 = S.cz + S.b * 1.1 + blend;
        for (var r = Math.max(0, Math.floor((z0 - T.zmin) / ch)); r <= Math.min(T.rows - 1, Math.ceil((z1 - T.zmin) / ch)); r++) for (var c = Math.max(0, Math.floor((x0 - T.xmin) / cw)); c <= Math.min(T.cols - 1, Math.ceil((x1 - T.xmin) / cw)); c++) {
          var x = T.xmin + c * cw, z = T.zmin + r * ch, d = lotDist(x, z); if (d >= blend) continue; var k = 1 - sstep(0, blend, d), vi = r * T.cols + c; H[vi] = H[vi] + (S.G - H[vi]) * k; cnt++; }
        CV.n.graded = cnt; }
    } catch (e) { note("grade", e); }
    // re-seat others' placements standing on the blend
    try { var Rr = 0; for (var kk in PLACE) { var Lk = PLACE[kk]; for (var i = 0; i < Lk.length; i++) { var e = Lk[i]; if (lotDist(e[0], e[2]) > 16) continue; var g = getH(e[0], e[2]); if (Math.abs(g - e[1]) > 0.02 && Math.abs(g - e[1]) < 2) { e[1] = g; Rr++; } } } CV.n.reseated = Rr; } catch (e) { note("reseat", e); }
    try { plantForecourt(S); } catch (e) { note("plant", e); }
    CV.n.terrainMs = Math.round(nowMs() - t0);
  }
  // the forecourt planting: beds between the paths (agave, yucca, barrel cactus, prickly pear, succulents and grasses near the
  // edges, saguaros and palo verdes standing in them), a row of saguaros along the arena's foot, palo verdes for shade by the seats
  function plantForecourt(S) {
    var R = rng(S.seed * 31 + 5), n = 0; S.plants = [];
    var put1 = function (k, x, z, sc) { if (!canPut(k)) return false; if (onPath(x, z, 1.4)) return false; put(k, x, z, R() * TAU, sc); var L = PLACE[k]; if (L && L.length) L[L.length - 1].cv = 1; n++; S.plants.push([k, x, z]); return true; };
    var low = ["agave_cluster", "bush2", "yucca_cluster", "bush1", "agave_cluster", "ph_succulent_1", "bush2", "barrel_cactus"].filter(canPut);   // the lighter kinds (R6 triangle budget)
    var tall = ["saguaro", "saguaro_mid", "saguaro_young"].filter(canPut);
    (S.beds || []).forEach(function (bd, bi) { var area = (bd[2] - bd[0]) * (bd[3] - bd[1]); var nl = Math.round(area / 15), nt = Math.max(1, Math.round(area / 100));
      for (var i = 0; i < nl; i++) { var x = lerp(bd[0] + 0.8, bd[2] - 0.8, R()), z = lerp(bd[1] + 0.8, bd[3] - 0.8, R()); put1(low[Math.floor(R() * low.length)] || "agave_cluster", x, z, 0.75 + R() * 0.55); }
      for (var j = 0; j < nt; j++) { var x2 = lerp(bd[0] + 2, bd[2] - 2, R()), z2 = lerp(bd[1] + 2, bd[3] - 2, R()); if (R() < 0.45 && canPut("paloverde")) put1("paloverde", x2, z2, 0.75 + R() * 0.3); else put1(tall[Math.floor(R() * tall.length)] || "saguaro", x2, z2, 0.8 + R() * 0.35); } });
    // saguaros at the arena's foot, either side of the entrance plaza (the render's foreground giants)
    [[-303, -128, 1.05], [-299, -136, 0.85], [-306, -50, 1.0], [-301, -44, 0.8], [-252, -128, 1.1], [-252, -52, 1.0]].forEach(function (p) { put1(p[2] > 0.95 ? "saguaro" : "saguaro_mid", p[0], p[1], p[2]); });
    CV.n.planted = n;
  }
  // the forecourt's paths (paved), as segments [x0, z0, x1, z1, half width]: the promenade east from the doors, two curving arms
  function forecourtPaths(S) {
    if (S.paths) return S.paths; var P = [];
    var arm = function (pts, hw) { for (var i = 0; i < pts.length - 1; i++) P.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], hw]); };
    arm([[-300, -90], [-250, -90]], 6.5);
    arm([[-284, -98], [-276, -110], [-266, -120], [-250, -128]], 2.6);
    arm([[-284, -82], [-276, -70], [-266, -60], [-250, -52]], 2.6);
    S.paths = P;
    // the beds between them (axis-aligned boxes x0, z0, x1, z1)
    S.beds = [[-281, -136, -256, -124], [-281, -56, -256, -44], [-271, -110, -255, -99], [-271, -81, -255, -70], [-297, -138, -287, -122], [-297, -58, -287, -42]];
    return P;
  }
  function segDist(x, z, s) { var vx = s[2] - s[0], vz = s[3] - s[1], L2 = vx * vx + vz * vz || 1; var t = clamp(((x - s[0]) * vx + (z - s[1]) * vz) / L2, 0, 1); return Math.hypot(x - s[0] - vx * t, z - s[1] - vz * t); }
  function onPath(x, z, m) { var P = forecourtPaths(SITE); for (var i = 0; i < P.length; i++) if (segDist(x, z, P[i]) < P[i][4] + (m || 0)) return true; var q = w2l(x, z); if (q[0] > 60 && Math.abs(q[1]) < 36 && x < -284 + (m || 0)) return true; return false; }

  // ───────────────────────── world hook: the airside trim, clearing, keep-outs, the hub, the zone, info points ─────────────────────────
  function worldHook() {
    if (CV.off || !window.PLAN) return; var S = resolveSite(); if (!S) { note("site", "no plan/convention.json"); return; } var t0 = nowMs();
    forecourtPaths(S); trimAirside();
    try { clearLot(); } catch (e) { note("clear", e); }
    try { for (var u = -80; u <= 80; u += 16) for (var v = -56; v <= 56; v += 16) if (eK(u, v) < 1.02) { var w = l2w(u, v); KEEPOUT.push([w[0], w[1], 14]); } var f = S.fc; for (var x = f.x0; x <= f.x1; x += 12) for (var z = f.z0; z <= f.z1; z += 12) KEEPOUT.push([x, z, 9]); } catch (e) { note("keepouts", e); }
    try { planAddHub(C("names.center", "Solport Convention Center"), S.hub[0], S.hub[1]); planNavCats(); } catch (e) { note("hub", e); }
    try { var poly = []; for (var i = 0; i < 48; i++) { var a = i / 48 * TAU; var q = l2w(Math.cos(a) * S.a * 1.03, Math.sin(a) * S.b * 1.03); if (q[0] > S.fc.x0 - 4) q[0] = Math.max(q[0], S.fc.x0); poly.push(q); } poly.splice(0, 0, [S.fc.x1, S.fc.z1]); poly.push([S.fc.x1, S.fc.z0]);
      var hp = hull(poly); S.outline = hp; zoneRings.push({ name: C("names.center", "Solport Convention Center"), label: C("names.short", "Solport Convention Center"), center: [S.cx + 30, S.cz], r: 90, k: C("info.forecourt.k", ""), poly: hp, col: "#d98a4e55", plan: "convention" }); } catch (e) { note("zone", e); }
    try { var hs = function (key, x, z, r, play) { var d = C("info." + key, null); if (!d) return null; var h = { x: x, z: z, r: r, t: d.t, k: d.k, p: d.p, cv: key }; if (play) h.cvPlay = play; hotspots.push(h); (CV.hsList = CV.hsList || []).push(h); return h; };
      hs("forecourt", -262, -76, 5); var lw = l2w(47, 6); hs("lobby", lw[0], lw[1], 4); var ww = l2w(44, -6); CV.hsWatch = [hs("watch", ww[0], ww[1], 3, "watch")];
      [-1, 1].forEach(function (sd) { var pw = l2w(-9, sd * 34.9); CV.hsWatch.push(hs("watch", pw[0], pw[1], 2.2, "watch")); var hw = l2w(-12.8, sd * 30); hs("hall", hw[0], hw[1], 3); });
      S.brk.forEach(function (B) { var bw = l2w((B.u0 + B.u1) / 2, (B.v0 + B.v1) / 2); hs(B.id, bw[0], bw[1], 6); }); } catch (e) { note("hotspots", e); }
    install(); CV.n.worldMs = Math.round(nowMs() - t0);
  }
  function hull(pts) { pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }); var cr = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }; var lo = [], up = []; pts.forEach(function (p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }); for (var i = pts.length - 1; i >= 0; i--) { var p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); } up.pop(); lo.pop(); return lo.concat(up); }

  // ───────────────────────── textures: the generated PBR sets (tex/conv_*), canvas textures for text and small patterns ─────────────────────────
  var TX = CV.tx = CV.tx || {};
  var TL = null;
  // KTX2 / Basis versions (tex/conv_*.ktx2, made like R6's scripts/r6_ktx_textures.py: flipped, UASTC) on the desktop tier, through the
  // client's own path (its R6KTX set; the JPEG stays the fallback)
  var KTXN = ["conv_copperb", "conv_copperb_n", "conv_sandstone", "conv_sandstone_n", "conv_redstone", "conv_redstone_n", "conv_led"];
  function ktxOn() { if (CV.ktx !== undefined) return CV.ktx; CV.ktx = false; try { if (!lowTier() && !/[?&]convktx=0/.test(location.search)) { var S0 = (0, eval)("R6KTX"); if (S0 && S0.add) { KTXN.forEach(function (n) { S0.add(n); }); CV.ktx = true; } } } catch (e) {} return CV.ktx; }
  function ctex(name, srgb, rep) { ktxOn(); var k = name + (lowTier() ? "_m" : ""); if (TX[k]) return TX[k]; TL = TL || new THREE.TextureLoader(); var t = TL.load("/tex/" + k + ".jpg"); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; if (rep !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping; try { t.anisotropy = Math.min(8, MAX_ANISO); } catch (e) {} t.name = "cv_" + k; return (TX[k] = t); }
  function cv(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function mkTex(c, rep, lin) { var t = new THREE.CanvasTexture(c); if (!lin) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; try { t.anisotropy = Math.min(8, MAX_ANISO); } catch (e) {} t.needsUpdate = true; return t; }
  function panel(key, W, H, fn, rep, lin) { if (TX[key]) return TX[key]; var c = cv(W, H), x = c.getContext("2d"); try { fn(x, W, H); } catch (e) { note("panel " + key, e); } var t = mkTex(c, rep, lin); t.userData.canvas = c; return (TX[key] = t); }
  function noise(x, W, H, n, a, s0, s1, seed) { var R = rng(seed || 3); for (var i = 0; i < n; i++) { x.fillStyle = R() < 0.5 ? "rgba(255,255,255," + a + ")" : "rgba(0,0,0," + a + ")"; var r = s0 + R() * (s1 - s0); x.fillRect(R() * W, R() * H, r, r); } }
  var FONT = { ui: "'Space Grotesk', 'Segoe UI', system-ui, sans-serif", cond: "'Anton', 'Oswald', 'Arial Narrow', Impact, sans-serif", mono: "'JetBrains Mono', Consolas, monospace", wide: "'Space Grotesk', 'Segoe UI', system-ui, sans-serif" };
  function txt(x, t, px, py, font, color, ls, align, maxW) { x.font = font; x.fillStyle = color; x.textAlign = align || "center"; x.textBaseline = "middle"; try { x.letterSpacing = (ls || 0) + "px"; } catch (e) {} if (maxW) { var w = x.measureText(t).width; if (w > maxW) { x.save(); x.translate(px, py); x.scale(maxW / w, 1); x.fillText(t, 0, 0); x.restore(); try { x.letterSpacing = "0px"; } catch (e) {} return; } } x.fillText(t, px, py); try { x.letterSpacing = "0px"; } catch (e) {} }
  function glowTex() { return panel("glow", 128, 128, function (x, W, H) { var g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.3, "rgba(255,255,255,0.5)"); g.addColorStop(0.65, "rgba(255,255,255,0.12)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, W, H); }); }
  // the soffit: cream panels with round downlights (an emissive map: only the lamps glow)
  function soffitTex() { return panel("soffit", 256, 256, function (x, W, H) { x.fillStyle = "#e9e1d2"; x.fillRect(0, 0, W, H); noise(x, W, H, 1800, 0.025, 1, 2, 5); x.strokeStyle = "rgba(90,80,64,0.25)"; x.lineWidth = 2; x.strokeRect(1, 1, W - 2, H - 2); x.fillStyle = "#2a2622"; x.beginPath(); x.arc(W / 2, H / 2, 22, 0, TAU); x.fill(); var g = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 18); g.addColorStop(0, "#fff7e6"); g.addColorStop(1, "#ffcf8a"); x.fillStyle = g; x.beginPath(); x.arc(W / 2, H / 2, 17, 0, TAU); x.fill(); }, true); }
  function soffitEmit() { return panel("soffitE", 256, 256, function (x, W, H) { x.fillStyle = "#000"; x.fillRect(0, 0, W, H); var g = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 20); g.addColorStop(0, "#fff3dc"); g.addColorStop(0.8, "#ffbf70"); g.addColorStop(1, "#000"); x.fillStyle = g; x.beginPath(); x.arc(W / 2, H / 2, 20, 0, TAU); x.fill(); }, true); }
  // a dark looped-pile carpet with a subtle copper fleck (the hall's aisles and the breakouts)
  function carpetTex() { return panel("carpet", 256, 256, function (x, W, H) { x.fillStyle = "#3a3840"; x.fillRect(0, 0, W, H); noise(x, W, H, 9000, 0.05, 1, 2, 11); var R = rng(17); for (var i = 0; i < 260; i++) { x.fillStyle = "rgba(180,110,60," + (0.08 + R() * 0.12) + ")"; x.fillRect(R() * W, R() * H, 2, 1); } }, true); }
  // acoustic wall panels (the hall's back and the stage surround): dark fabric with fine vertical slots
  function acousticTex() { return panel("acoustic", 256, 256, function (x, W, H) { x.fillStyle = "#1c1b1f"; x.fillRect(0, 0, W, H); for (var i = 0; i < W; i += 8) { x.fillStyle = "rgba(0,0,0,0.45)"; x.fillRect(i, 0, 2, H); } noise(x, W, H, 3000, 0.03, 1, 2, 23); x.fillStyle = "rgba(0,0,0,0.5)"; x.fillRect(0, 0, W, 3); }, true); }
  function grainTex(key, base, lite, dark, seed) { return panel(key, 512, 512, function (x, W, H) { x.fillStyle = base; x.fillRect(0, 0, W, H); var R = rng(seed); for (var i = 0; i < 260; i++) { var y = R() * H, a = 0.04 + R() * 0.1; x.strokeStyle = (R() < 0.5 ? lite : dark).replace("A", a.toFixed(3)); x.lineWidth = 1 + R() * 2.5; x.beginPath(); x.moveTo(0, y); for (var k = 0; k <= 8; k++) x.lineTo(k * W / 8, y + Math.sin(k * 0.9 + i) * (2 + R() * 4)); x.stroke(); } noise(x, W, H, 2500, 0.03, 1, 2, seed + 1); }, true); }

  // ───────────────────────── materials (made in the defer hook, when the client's textures and environment exist) ─────────────────────────
  var MX = CV.mx = CV.mx || {};
  var U = CV.u = CV.u || { uNight: { value: 0 }, uTime: { value: 0 }, uGold: { value: 0 } };
  function std(o) { return new THREE.MeshStandardMaterial(o); }
  function ctx(k) { try { return TEX[k] || null; } catch (e) { return null; } }
  // the night look of the skin and stone: warm uplight from the forecourt's ground lights, strongest low on the wall (vH: height above
  // the pad), facing outward; the copper reads as a warm lantern after dark, the sandstone glows faintly
  // one program family for the exterior: every member has a map, a normal map and vertex colours and the key "cv_up"; its uplight
  // and golden-hour strength k is a uniform (R6: shared materials, stable keys)
  function uplit(m, key, k) { m.userData.uk = { value: k }; m.onBeforeCompile = function (sh) { sh.uniforms.uNight = U.uNight; sh.uniforms.uGold = U.uGold; sh.uniforms.uUk = m.userData.uk;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vCvH;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvCvH = position.y;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight; uniform float uGold; uniform float uUk; varying float vCvH;").replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n if (uUk >= 0.0) totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.66, 0.4) * uUk * (uNight * (0.05 + 0.95 * exp(-max(vCvH - 6.0, 0.0) / 3.5)) + uGold * 0.7);\n#ifdef USE_COLOR\n else totalEmissiveRadiance += vColor.rgb * -uUk;\n#endif"); };
    m.customProgramCacheKey = function () { return "cv_up"; }; return m; }
  function whiteTexX() { return panel("whiteX", 64, 64, function (x, W, H) { x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, H); noise(x, W, H, 200, 0.015, 1, 2, 7); }, true); }
  function mats() {
    if (MX.ok) return MX; MX.ok = true;
    MX.copper = uplit(std({ map: ctex("conv_copperb", true), normalMap: ctex("conv_copperb_n", false), normalScale: new THREE.Vector2(0.55, 0.55), color: 0xffffff, metalness: 0.85, roughness: 0.28, vertexColors: true, envMapIntensity: 1.35 }), "cv_copper", 0.55);
    MX.sand = uplit(std({ map: ctex("conv_sandstone", true), normalMap: ctex("conv_sandstone_n", false), normalScale: new THREE.Vector2(0.6, 0.6), color: 0xffffff, roughness: 0.84, metalness: 0.0, vertexColors: true }), "cv_sand", 0.35);
    MX.frame = uplit(std({ map: ctex("conv_sandstone", true), normalMap: ctex("conv_sandstone_n", false), normalScale: new THREE.Vector2(0.15, 0.15), color: 0x8a8580, roughness: 0.42, metalness: 0.6, vertexColors: true }), "cv_up", 0.0);
    MX.paint = std({ color: 0xffffff, roughness: 0.6, metalness: 0.05, vertexColors: true });
    MX.soffit = uplit(std({ map: soffitTex(), normalMap: ctex("conv_sandstone_n", false), normalScale: new THREE.Vector2(0.1, 0.1), color: 0xffffff, roughness: 0.8, vertexColors: true }), "cv_up", 0.25);
    // glass: a thin tinted film whose reflection and opacity rise at grazing angles; a warm glow after dark (the lobby is lit)
    MX.glass = std({ color: 0x0d1418, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6, emissive: 0xffb877, emissiveIntensity: 0 }); MX.glass.forceSinglePass = true;
    MX.glass.onBeforeCompile = function (sh) { sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n{ float fr = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 4.0); diffuseColor.a = clamp(opacity + 0.5 * fr, 0.0, 0.66); }"); };
    MX.glass.customProgramCacheKey = function () { return "cv_glass"; };
    // lamps, light lines and lenses: the same family, its colour as emission (a negative k is the emission strength)
    MX.emit = uplit(std({ map: whiteTexX(), normalMap: ctex("conv_sandstone_n", false), normalScale: new THREE.Vector2(0.01, 0.01), color: 0x15110c, roughness: 0.4, vertexColors: true }), "cv_up", -0.35);
    // white tensile fabric: double sided, soft, a faint warm glow after dark from the uplights under it
    MX.fabric = uplit(std({ map: whiteTexX(), normalMap: ctex("conv_sandstone_n", false), normalScale: new THREE.Vector2(0.05, 0.05), color: 0xffffff, roughness: 0.82, metalness: 0, vertexColors: true }), "cv_up", 0.22);
    var trav = ctx("travertine"), sandT = ctx("sand"); MX.pave = uplit(std({ map: trav, normalMap: ctx("detailN"), normalScale: new THREE.Vector2(0.3, 0.3), color: 0xffffff, roughness: 0.78, vertexColors: true }), "cv_up", 0.12);
    MX.dg = uplit(std({ map: sandT, normalMap: ctx("sandN"), color: 0xffffff, roughness: 0.97, vertexColors: true }), "cv_up", 0.08);
    MX.glow = new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xffffff, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: true });
    MX.banner = uplit(std({ map: bannerTex(), normalMap: ctex("conv_sandstone_n", false), normalScale: new THREE.Vector2(0.05, 0.05), color: 0xffffff, roughness: 0.85, vertexColors: true }), "cv_up", 1.1);
    MX.led = ledMaterial();
    for (var k in MX) { var m = MX[k]; if (m && m.isMaterial && !m.name) m.name = "cv_" + k; }
    return MX;
  }

  // ───────────────────────── interior materials: one "house light" model for every surface (no real lights) ─────────────────────────
  // Indoors the scene's sky and sun barely reach (the roof shadows the sun; a one-texel ao map cuts the sky's share). Every interior
  // surface adds its own light as emissive: a dim warm house level, the stage's spill (a broad warm-white source at the stage, falling
  // off with distance and facing), the warm uplights scalloped along the hall's sandstone walls, and a glow on the folded ceiling's
  // underside near its edges. Uniform weights per material (uK: house, stage, uplight, ceiling); one program per material.
  var IU = CV.iu = CV.iu || { uSP: { value: new THREE.Vector3() }, uSC: { value: new THREE.Color(1.0, 0.86, 0.78) }, uHall: { value: new THREE.Vector4(-58, 17, 33, 0) }, uCtr: { value: new THREE.Vector3() }, uFl: { value: 0 }, uPulse: { value: 0 } };
  var IN = CV.inm = CV.inm || {};
  function houseLit(m, key, k) { m.userData.uK = { value: new THREE.Vector4(k[0], k[1], k[2], k[3]) };
    m.userData.uRim = m.userData.uRim || { value: 0 }; m.onBeforeCompile = function (sh) { sh.uniforms.uK = m.userData.uK; sh.uniforms.uRim = m.userData.uRim; sh.uniforms.uSP = IU.uSP; sh.uniforms.uSC = IU.uSC; sh.uniforms.uHall = IU.uHall; sh.uniforms.uCtr = IU.uCtr; sh.uniforms.uFl = IU.uFl; sh.uniforms.uPulse = IU.uPulse;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vCvW; varying vec3 vCvN;").replace("#include <project_vertex>", "#include <project_vertex>\n{ vec4 cw = vec4(transformed, 1.0); vec3 cn = objectNormal;\n#ifdef USE_INSTANCING\n cw = instanceMatrix * cw; cn = mat3(instanceMatrix) * cn;\n#endif\n cw = modelMatrix * cw; vCvW = cw.xyz; vCvN = normalize(mat3(modelMatrix) * cn); }");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec4 uK; uniform float uRim; uniform vec3 uSP; uniform vec3 uSC; uniform vec4 uHall; uniform vec3 uCtr; uniform float uFl; uniform float uPulse; varying vec3 vCvW; varying vec3 vCvN;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n{ vec3 p = vCvW; vec3 n = normalize(vCvN); float lu = p.x - uCtr.x, lv = p.z - uCtr.z, h = p.y - uFl;\n float inH = step(uHall.x - 1.0, lu) * step(lu, uHall.y + 0.5) * step(abs(lv), uHall.z + 0.5);\n vec3 L = vec3(1.0, 0.78, 0.6) * uK.x * mix(1.0, 0.07, inH);\n vec3 d = uSP - p; float r2 = dot(d, d); vec3 dn = d * inversesqrt(max(r2, 1.0));\n L += uSC * uK.y * inH * (0.04 + 0.96 * max(dot(n, dn), 0.0)) * (1.0 + 0.12 * uPulse) * 1400.0 / (r2 + 700.0);\n float wall = smoothstep(uHall.z - 3.5, uHall.z - 0.3, abs(lv)) * inH; float sc = 0.55 + 0.45 * cos(lu * 1.0472);\n L += vec3(1.0, 0.56, 0.26) * uK.z * wall * sc * (0.16 + 0.84 * exp(-h / 5.2)) * (0.35 + 0.65 * clamp(0.55 - n.y, 0.0, 1.0));\n float ed = smoothstep(uHall.z - 24.0, uHall.z, abs(lv)); float gz = 0.25 + 0.75 * clamp(abs(n.z) * 1.7 + max(-n.x, 0.0) * 0.9, 0.0, 1.0); float ce = smoothstep(11.5, 13.6, h) * (0.14 + 0.86 * ed) * gz;\n L += vec3(1.0, 0.62, 0.32) * uK.w * ce;\n totalEmissiveRadiance += diffuseColor.rgb * L;\n float rim = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 3.0); totalEmissiveRadiance += vec3(0.5, 0.56, 0.95) * uRim * rim * inH * (0.4 + 0.6 * clamp(dn.y * -1.0 + 0.6, 0.0, 1.0)); }"); };
    m.customProgramCacheKey = function () { return "cv_in"; }; return m; }
  function whiteTex() { return panel("white", 64, 64, function (x, W, H) { x.fillStyle = "#f4f2ee"; x.fillRect(0, 0, W, H); noise(x, W, H, 300, 0.02, 1, 2, 5); }, true); }
  function aoTex() { if (IN.ao) return IN.ao; var t = new THREE.DataTexture(new Uint8Array([34, 34, 34, 255]), 1, 1); t.needsUpdate = true; IN.ao = t; return t; }
  function imat(key, o, k) { o = Object.assign({ map: whiteTex(), normalMap: ctx("detailN"), normalScale: new THREE.Vector2(0.12, 0.12) }, o); var m = std(Object.assign({ color: 0xffffff, vertexColors: true, aoMap: aoTex(), aoMapIntensity: 1 }, o)); m.name = "cv_in_" + key; return houseLit(m, "cv_in_" + key, k); }
  function intMats() {
    if (IN.ok) return IN; IN.ok = true; mats();
    IN.floor = imat("floor", { map: ctx("terrazzo"), roughness: 0.42, metalness: 0.0, envMapIntensity: 0.35 }, [0.5, 0.4, 0.5, 0.0]);
    IN.carpet = imat("carpet", { map: carpetTex(), roughness: 0.95 }, [0.9, 0.7, 0.5, 0.0]);
    IN.red = imat("red", { map: ctex("conv_redstone", true), normalMap: ctex("conv_redstone_n", false), normalScale: new THREE.Vector2(2.2, 2.2), roughness: 0.92 }, [0.2, 0.18, 3.4, 0.0]);
    IN.copper = imat("copper", { map: ctex("conv_copperb", true), normalMap: ctex("conv_copperb_n", false), normalScale: new THREE.Vector2(0.5, 0.5), color: 0xa07a62, roughness: 0.36, metalness: 0.72, envMapIntensity: 0.4 }, [0.55, 0.3, 0.2, 2.3]);
    IN.dark = imat("dark", { map: acousticTex(), roughness: 0.9 }, [0.3, 0.4, 0.15, 0.0]);
    IN.paint = imat("paint", { roughness: 0.6, metalness: 0.05 }, [0.6, 0.6, 0.3, 0.3]);
    IN.metal = imat("metal", { roughness: 0.38, metalness: 0.75 }, [0.4, 0.5, 0.1, 0.0]);
    IN.wood = imat("wood", { map: grainTex("walnut", "#5a3d28", "rgba(170,120,80,A)", "rgba(30,16,8,A)", 19), normalMap: ctx("woodN"), normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.5 }, [0.6, 0.5, 0.3, 0.0]);
    IN.fabric = imat("fabric", { roughness: 0.92, envMapIntensity: 0.15 }, [0.4, 0.36, 0.02, 0.0]); IN.fabric.userData.uRim = { value: 0.22 };   // seats and the audience (instanced)
    IN.sand = imat("sand", { map: ctex("conv_sandstone", true), normalMap: ctex("conv_sandstone_n", false), roughness: 0.8 }, [0.55, 0.4, 0.6, 0.0]);
    IN.beam = beamMaterial();
    return IN;
  }
  // the lighting rig's beams: additive cones, brightest at the fixture and along the cone's axis seen face on (no light of their own)
  function beamMaterial() {
    var m = new THREE.ShaderMaterial({ uniforms: { uK: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false,
      vertexShader: "varying float vV; varying float vE; varying vec3 vC; void main(){ vec4 p = vec4(position, 1.0); vec3 n = normal;\n#ifdef USE_INSTANCING\n p = instanceMatrix * p; n = mat3(instanceMatrix) * n;\n#endif\n vC = vec3(1.0);\n#ifdef USE_INSTANCING_COLOR\n vC = instanceColor;\n#endif\n vec4 mv = modelViewMatrix * p; vec3 vn = normalize(normalMatrix * n); vE = abs(dot(vn, normalize(-mv.xyz))); vV = uv.y; gl_Position = projectionMatrix * mv; }",
      fragmentShader: "uniform float uK; varying float vV; varying float vE; varying vec3 vC; void main(){ float a = pow(vV, 1.25) * pow(vE, 1.6) * uK * 1.1; if (a < 0.002) discard; gl_FragColor = vec4(vC * a, a); }" });
    m.name = "cv_beam"; return m; }

  // ───────────────────────── the LED screens: one shader material for every screen (the media wall outside and every wall inside) ─────────────────────────
  // Every screen vertex carries aScr (which content) and uv (0..1 over that screen). Content comes from one image atlas (tex/conv_led:
  // the summit backdrop, the aurora, the canyon), one static text canvas (white on clear, rows of 256 px) and one small dynamic canvas
  // (the community impact counter). The media wall outside cycles: the aurora with SOLPORT CONVENTION CENTER, the impact counter, and
  // after dark the night sky. aScr: 0 media wall, 1 keynote main, 2 canyon portrait, 3 crystal side panels, 4 ticker, 5 lobby totem,
  // 6 breakout A slide, 7 breakout B slide.
  var LED = CV.led = CV.led || { mode: 0, prev: 0, t0: 0, mix: 1, impact: -1, at: 0 };
  // the text rows (y of each 256 px row in the 2048 x 2048 text canvas)
  var TROW = { title: 0, summit: 256, night: 512, ticker: 768, slideA: 1024, slideB: 1280, lobby: 1536 };
  function sunRing(x, cx, cy, r, lw) { x.save(); x.lineWidth = lw; x.strokeStyle = "#ffffff"; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.stroke(); x.beginPath(); x.arc(cx, cy, r * 0.42, 0, TAU); x.fillStyle = "#ffffff"; x.fill(); for (var i = 0; i < 12; i++) { var a = i / 12 * TAU; x.beginPath(); x.moveTo(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6); x.lineTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78); x.lineWidth = lw * 0.55; x.stroke(); } x.restore(); }
  // a word in a wide sans with its letter O drawn as the Solport sun ring
  function ringWord(x, word, cx, cy, size, ls) { x.font = "500 " + size + "px " + FONT.wide; try { x.letterSpacing = ls + "px"; } catch (e) {} x.textBaseline = "middle"; x.fillStyle = "#ffffff"; var parts = word.split("O"); var wO = size * 0.78; var total = 0, ws = parts.map(function (p) { var w = x.measureText(p).width; total += w; return w; }); total += (parts.length - 1) * (wO + ls);
    var px = cx - total / 2; x.textAlign = "left"; for (var i = 0; i < parts.length; i++) { x.fillText(parts[i], px, cy); px += ws[i]; if (i < parts.length - 1) { sunRing(x, px + ls * 0.5 + wO / 2, cy, wO * 0.46, size * 0.075); px += wO + ls; } } try { x.letterSpacing = "0px"; } catch (e) {} }
  // every screen's geometry: aScr (the content) and aTx (its text scale: width / 8 height; for the ticker width / 16 height)
  function ledAttr(g, scr, w, h) { var n = g.attributes.position.count; g.setAttribute("aScr", new THREE.Float32BufferAttribute(new Float32Array(n).fill(scr), 1)); g.setAttribute("aTx", new THREE.Float32BufferAttribute(new Float32Array(n).fill(scr === 4 ? w / (16 * h) : w / (8 * h)), 1)); return g; }
  function textTex() { return panel("ledText", 2048, 2048, function (x, W) {
      x.clearRect(0, 0, W, 2048); var L = C("led", {});
      ringWord(x, L.title || "SOLPORT", W / 2, TROW.title + 112, 150, 22); txt(x, L.subtitle || "CONVENTION CENTER", W / 2, TROW.title + 210, "500 54px " + FONT.wide, "#ffffff", 16);
      ringWord(x, L.summit || "SOLPORT", W / 2, TROW.summit + 100, 140, 26); txt(x, L.summitSub || "SUMMIT", W / 2, TROW.summit + 200, "500 70px " + FONT.wide, "#ffffff", 22);
      txt(x, L.nightLine || "TONIGHT UNDER THE DOUGLAS DARK SKY", W / 2, TROW.night + 120, "500 74px " + FONT.wide, "#ffffff", 8, "center", 1240); txt(x, "SOLPORT CONVENTION CENTER", W / 2, TROW.night + 205, "500 40px " + FONT.wide, "#ffffff", 14);
      x.save(); x.font = "600 70px " + FONT.wide; try { x.letterSpacing = "8px"; } catch (e) {} var tk = L.ticker || "SOLPORT SUMMIT  ·  ", tw = x.measureText(tk).width || W; x.translate(0, TROW.ticker + 64); x.scale(W / tw, 1); x.fillStyle = "#ffffff"; x.textAlign = "left"; x.textBaseline = "middle"; x.fillText(tk, 0, 0); x.restore();
      [["breakA", TROW.slideA], ["breakB", TROW.slideB]].forEach(function (q) { var s = C("rooms." + q[0] + ".slide", ["SESSION", "", ""]); txt(x, s[0], W / 2, q[1] + 52, "600 44px " + FONT.mono, "#f4cd5a", 10, "center", 1000); txt(x, s[1], W / 2, q[1] + 132, "500 64px " + FONT.wide, "#ffffff", 0, "center", 1040); txt(x, s[2], W / 2, q[1] + 210, "500 36px " + FONT.wide, "#ffffff", 4, "center", 1000); });
      ringWord(x, "SOLPORT SUMMIT", W / 2, TROW.lobby + 90, 104, 14); txt(x, "KEYNOTE HALL  ·  BREAKOUT ROOMS", W / 2, 1792 + 128, "600 104px " + FONT.wide, "#ffffff", 10, "center", 1960); txt(x, "WELCOME  ·  KEYNOTE HALL STRAIGHT AHEAD", W / 2, TROW.lobby + 195, "500 46px " + FONT.wide, "#ffffff", 10);
    }, false, true); }
  // the community impact counter: label, the number, a bar to the next milestone
  function meterTex() { return panel("ledMeter", 1024, 256, function () {}, false, true); }
  function drawMeter(force) {
    var t = meterTex(), c = t.userData.canvas, x = c.getContext("2d"); var tot = 0, next = null, prev = 0;
    try { var PP = window.PLAN_PROGRESS; var st = PP && PP.state ? PP.state() : null; tot = st && st.impact ? Math.round(st.impact.total || 0) : 0; } catch (e) {}
    if (!force && tot === LED.impact) return; LED.impact = tot;
    var M = [250, 1000, 2500, 5000, 10000]; for (var i = 0; i < M.length; i++) { if (tot < M[i]) { next = M[i]; break; } prev = M[i]; }
    x.clearRect(0, 0, 1024, 256); var L = C("led", {});
    txt(x, L.impactLabel || "COMMUNITY IMPACT", 512, 34, "600 30px " + FONT.wide, "rgba(255,255,255,0.92)", 10);
    txt(x, tot.toLocaleString("en-US"), 512, 118, "500 112px " + FONT.wide, "#ffffff", 6);
    x.fillStyle = "rgba(255,255,255,0.22)"; x.fillRect(212, 186, 600, 10); var f = next ? clamp((tot - prev) / (next - prev), 0, 1) : 1; x.fillStyle = "#ffffff"; x.fillRect(212, 186, 600 * f, 10);
    txt(x, (L.impactSub || "in-game actions by everyone on the site") + (next ? "  ·  next milestone at " + next.toLocaleString("en-US") : ""), 512, 226, "500 24px " + FONT.wide, "rgba(255,255,255,0.85)", 3);
    t.needsUpdate = true; }
  function ledMaterial() {
    var A = ctex("conv_led", true, false); A.wrapS = A.wrapT = THREE.ClampToEdgeWrapping; A.minFilter = THREE.LinearMipmapLinearFilter;
    LED.uni = { tA: { value: A }, tT: { value: textTex() }, tD: { value: meterTex() }, uT: U.uTime, uNight: U.uNight, uM0: { value: 0 }, uM1: { value: 0 }, uMix: { value: 1 }, uKx: { value: 2.6 }, uKi: { value: 1.7 } };
    drawMeter(true);
    var m = new THREE.ShaderMaterial({ uniforms: LED.uni, toneMapped: false, fog: false,
      vertexShader: "attribute float aScr; attribute float aTx; varying vec2 vUv; varying float vS; varying float vTx; void main(){ vUv = uv; vS = aScr; vTx = aTx; vec4 p = vec4(position, 1.0);\n#ifdef USE_INSTANCING\n p = instanceMatrix * p;\n#endif\n gl_Position = projectionMatrix * modelViewMatrix * p; }",
      fragmentShader: [
        "uniform sampler2D tA; uniform sampler2D tT; uniform sampler2D tD; uniform float uT; uniform float uNight; uniform float uM0; uniform float uM1; uniform float uMix; uniform float uKx; uniform float uKi; varying vec2 vUv; varying float vS; varying float vTx;",
        "float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
        "float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }",
        "float fbm(vec2 p){ return vn(p) * 0.5 + vn(p * 2.03 + 1.7) * 0.28 + vn(p * 4.1 + 3.1) * 0.14 + vn(p * 8.3) * 0.08; }",
        // atlas regions (uv origin bottom-left, the atlas is 2048 square): keynote x 0..0.75, y 0.6787..1; aurora x 0..0.75, y 0.3418..0.6631; canyon x 0.7578..1, y 0.5703..1
        "vec3 atl(vec2 o, vec2 s, vec2 uv){ return texture2D(tA, o + clamp(uv, 0.002, 0.998) * s).rgb; }",
        "vec3 aurora(vec2 uv, float t){ vec2 q = uv; q.x = q.x * 0.72 + 0.14 + 0.1 * sin(t * 0.05); q += 0.018 * vec2(sin(uv.y * 7.0 + t * 0.4), cos(uv.x * 6.0 - t * 0.33)); vec3 c = atl(vec2(0.0, 0.3418), vec2(0.75, 0.3213), q);",
        " float f = fbm(vec2(uv.x * 3.0 - t * 0.07, uv.y * 2.0 + t * 0.03)); float band = smoothstep(0.42, 0.0, abs(uv.y - 0.5 - 0.22 * sin(uv.x * 4.0 + t * 0.21) - 0.1 * (f - 0.5)));",
        " c += band * mix(vec3(0.15, 0.85, 0.42), vec3(1.0, 0.78, 0.3), smoothstep(0.3, 0.8, f)) * 0.35; return c * (0.9 + 0.1 * sin(t * 0.7)); }",
        "float trow(float row, vec2 uv, float sx){ vec2 tu = vec2((uv.x - 0.5) * sx + 0.5, row + (1.0 - uv.y) * 0.125); if (tu.x < 0.0 || tu.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0; return texture2D(tT, vec2(tu.x, 1.0 - tu.y)).a; }",
        "vec3 sky(vec2 uv, float t){ vec3 c = mix(vec3(0.01, 0.02, 0.06), vec3(0.04, 0.06, 0.16), uv.y); vec2 g = floor(uv * vec2(420.0, 90.0)); float s = step(0.992, h21(g)) * (0.5 + 0.5 * sin(t * 2.0 + h21(g + 3.0) * 30.0)); c += vec3(s);",
        " float mw = exp(-pow((uv.y - 0.35 - uv.x * 0.35) * 4.2, 2.0)) * fbm(uv * vec2(9.0, 4.0) + vec2(t * 0.004, 0.0)); c += vec3(0.5, 0.48, 0.62) * mw * 0.8; return c; }",
        "vec3 ext(float m, vec2 uv, float t){ vec3 c; if (m < 0.5) { c = aurora(uv, t); float a = trow(0.0, vec2(uv.x, (uv.y - 0.12) / 0.8), vTx / 0.8); c = mix(c * 0.85, vec3(1.0), a * 0.96); }",
        " else if (m < 1.5) { c = aurora(uv * vec2(1.0, 0.8) + vec2(0.3, 0.1), t) * 0.32 + vec3(0.0, 0.05, 0.04); vec2 du = vec2((uv.x - 0.5) * 2.33 * vTx + 0.5, (uv.y - 0.08) / 0.86); float a = (du.x > 0.0 && du.x < 1.0 && du.y > 0.0 && du.y < 1.0) ? texture2D(tD, du).a : 0.0; c = mix(c, mix(vec3(1.0), vec3(1.0, 0.86, 0.45), smoothstep(0.62, 0.42, du.y)), a); }",
        " else { c = sky(uv, t); float a = trow(0.25, vec2(uv.x, (uv.y - 0.08) / 0.84), vTx / 0.84); c = mix(c, vec3(0.92, 0.95, 1.0), a * 0.9); } return c; }",
        "void main(){ vec2 uv = vUv; float t = uT; vec3 c; float k = uKi; float s = floor(vS + 0.5);",
        " if (s < 0.5) { c = mix(ext(uM0, uv, t), ext(uM1, uv, t), uMix); k = uKx * mix(1.0, 0.42, uNight); }",
        " else if (s < 1.5) { vec2 q = uv; q.x = 0.5 + (q.x - 0.5) * (0.97 + 0.03 * sin(t * 0.1)); c = atl(vec2(0.0, 0.6787), vec2(0.75, 0.3213), q); float sw = smoothstep(0.12, 0.0, abs(fract(uv.x * 0.5 - t * 0.04) - 0.5)) * 0.25; c += vec3(0.4, 0.5, 1.0) * sw * smoothstep(0.2, 1.0, uv.y); float a = trow(0.125, vec2(uv.x, (uv.y - 0.2) / 0.62), vTx / 0.62); c = mix(c, vec3(1.0), a * 0.97); }",
        " else if (s < 2.5) { vec2 q = vec2(uv.x * 0.92 + 0.04 + 0.03 * sin(t * 0.03), uv.y * 0.96 + 0.02); c = atl(vec2(0.7578, 0.5703), vec2(0.2422, 0.4297), q); }",
        " else if (s < 3.5) { vec2 q = vec2(fract(uv.x * 0.3 + 0.62 + 0.02 * sin(t * 0.08)), uv.y * 0.8 + 0.1); c = atl(vec2(0.0, 0.6787), vec2(0.75, 0.3213), q); c = mix(c, c.bgr * vec3(0.6, 1.0, 1.1), 0.35 + 0.35 * sin(t * 0.15 + uv.x * 3.0)); }",
        " else if (s < 4.5) { float qx = fract(uv.x * vTx + t * 0.025); float a = texture2D(tT, vec2(qx, 1.0 - (0.375 + (1.0 - uv.y) * 0.0625))).a; c = mix(vec3(0.02, 0.03, 0.12), vec3(0.1, 0.35, 0.9), uv.y * 0.5) + vec3(a); }",
        " else if (s < 5.5) { c = aurora(uv * vec2(0.5, 1.0) + vec2(0.1 * floor(t / 9.0), 0.0), t) * 0.7; float a = trow(0.75, vec2(uv.x, (uv.y - 0.4) / 0.5), vTx / 0.5); c = mix(c, vec3(1.0), a); }",
        " else if (s > 7.5) { c = mix(vec3(0.03, 0.04, 0.06), vec3(0.06, 0.08, 0.12), uv.y); float a = trow(0.875, vec2(uv.x, (uv.y - 0.1) / 0.8), vTx / 0.8); c = mix(c, vec3(1.0, 0.96, 0.88), a); }",
        " else { c = mix(vec3(0.02, 0.04, 0.12), vec3(0.06, 0.1, 0.3), uv.y); c += aurora(vec2(uv.x, uv.y * 0.5 + 0.1), t) * 0.45 * smoothstep(0.3, 0.0, uv.y); float a = trow(s < 6.5 ? 0.5 : 0.625, vec2(uv.x, (uv.y - 0.25) / 0.55), vTx / 0.55); c = mix(c, vec3(1.0), a); }",
        // the LED pitch, faded out where it would alias
        " vec2 px = uv * vec2(900.0, 220.0); vec2 fw = fwidth(px); float gk = clamp(1.0 - max(fw.x, fw.y) * 1.5, 0.0, 1.0); vec2 f = abs(fract(px) - 0.5); c *= 1.0 - gk * 0.35 * smoothstep(0.3, 0.5, max(f.x, f.y));",
        " gl_FragColor = vec4(c * k, 1.0); }"].join("\n") });
    m.name = "cv_led"; return m; }
  // the exterior cycle: aurora and name, the impact counter, the night sky after dark (durations from convention.json led.cycle)
  function ledFrame(dt) {
    if (!LED.uni) return; var cyc = C("led.cycle", [16, 10, 12]), n = nightK(); var t = nowMs() / 1000;
    if (!LED.t0) LED.t0 = t; var dur = cyc[LED.mode] || 12;
    if (t - LED.t0 > dur) { LED.prev = LED.mode; var nx = (LED.mode + 1) % 3; if (nx === 2 && !((CV.sunEl !== undefined ? CV.sunEl : 1) < -0.04 || n > 0.9)) nx = 0; LED.mode = nx; LED.t0 = t; LED.mix = 0; }
    LED.mix = Math.min(1, LED.mix + dt / 1.6); LED.uni.uM0.value = LED.prev; LED.uni.uM1.value = LED.mode; LED.uni.uMix.value = LED.mix * LED.mix * (3 - 2 * LED.mix);
    if (t - LED.at > 3) { LED.at = t; try { drawMeter(false); } catch (e) { note("meter", e); } } }
  // the banners: the desert art with the summit wording, three variants side by side in one canvas (512 x 768 each)
  function bannerTex() { if (TX.banner) return TX.banner; var c = cv(1536, 768), x = c.getContext("2d"); var t = mkTex(c, false); TX.banner = t; var im = new Image();
    var draw = function (ok) { var B = C("banners", [["SOLPORT SUMMIT", "INNOVATION · PEOPLE · IMPACT"]]); for (var i = 0; i < 3; i++) { var X0 = i * 512; if (ok) x.drawImage(im, X0, 0, 512, 768); else { x.fillStyle = "#14203a"; x.fillRect(X0, 0, 512, 768); } var b = B[i % B.length];
        x.fillStyle = "rgba(10,18,40,0.25)"; x.fillRect(X0, 380, 512, 388); ringWord(x, b[0].split(" ")[0], X0 + 256, 470, 62, 6); if (b[0].split(" ")[1]) txt(x, b[0].split(" ").slice(1).join(" "), X0 + 256, 545, "500 44px " + FONT.wide, "#f4cd5a", 10);
        var w = b[1].split(" · "); w.forEach(function (s, k) { txt(x, s, X0 + 256, 618 + k * 44, "500 32px " + FONT.wide, "#f5f1e6", 6, "center", 460); }); } t.needsUpdate = true; };
    draw(false); im.onload = function () { draw(true); }; im.src = (window.AV || String)("/tex/conv_banner" + (lowTier() ? "_m" : "") + ".jpg"); return t; }

  // ───────────────────────── the arena's shell (R7 polish): a long, low, sweeping form of layered copper ribbons ─────────────────────────
  // Plan: the ellipse. Elevation: the roof edge is one continuous line, lowest at the north and south ends, sweeping up over the east
  // entrance (and a little over the stage end, which keeps the keynote hall's ceiling under the roof): hEdge(phi). The wall (t = 0 at
  // the skin's foot over the recessed glass, 1 at the roof edge) leans out a little; the roof rolls up from the edge to a low crown.
  // The skin is a dark reveal (with sandstone where the middle ribbons part) under layered copper ribbons that overlap like shingles:
  // each ribbon is pushed out most at its lower edge, which shows a dark fascia; ribbons taper smoothly to nothing round the LED wall.
  // Columns round the plan follow the base ellipse's arc length (c in 0..1).
  var PRF = null;
  function prof() {
    if (PRF) return PRF; var S = SITE, m = 2048, PH = new Float64Array(m + 1), L = new Float64Array(m + 1);
    for (var j = 0; j <= m; j++) { PH[j] = -PI + TAU * j / m; if (j) L[j] = L[j - 1] + Math.hypot(S.a * (Math.cos(PH[j]) - Math.cos(PH[j - 1])), S.b * (Math.sin(PH[j]) - Math.sin(PH[j - 1]))); }
    PRF = { m: m, PH: PH, L: L, per: L[m] }; return PRF; }
  function bs(arr, n, v) { var lo = 0, hi = n; while (hi - lo > 1) { var md = (lo + hi) >> 1; if (arr[md] <= v) lo = md; else hi = md; } return lo; }
  function phiOf(c) { var P = prof(); c = c - Math.floor(c); var L = c * P.per; var j = Math.min(P.m - 1, bs(P.L, P.m, L)); var f = (L - P.L[j]) / Math.max(1e-9, P.L[j + 1] - P.L[j]); return lerp(P.PH[j], P.PH[j + 1], f); }
  function cOfPhi(phi) { var P = prof(); phi = Math.atan2(Math.sin(phi), Math.cos(phi)); var j = clamp(Math.floor((phi + PI) / TAU * P.m), 0, P.m - 1); var f = ((phi + PI) / TAU * P.m) - j; return lerp(P.L[j], P.L[j + 1], f) / P.per; }
  function hEdge(ph) { var S = SITE, cs = Math.cos(ph), f = Math.pow(0.5 + 0.5 * cs, 3), b = Math.pow(0.5 - 0.5 * cs, 3); return S.Hs + (S.Hf - S.Hs) * f + (S.Hb - S.Hs) * b; }
  function rW(t) { return 1 + 0.05 * Math.sin(0.9 * PI * t) - 0.02 * t; }
  // the wall point (t 0..1) and the roof point (q 0..1 from the edge to the crown)
  function surf(c, t, out) { var S = SITE, ph = phiOf(c), r = rW(t); out = out || new THREE.Vector3(); return out.set(S.a * r * Math.cos(ph), S.y0 + (hEdge(ph) - S.y0) * t, S.b * r * Math.sin(ph)); }
  function roofPt(c, q, out) { var S = SITE, ph = phiOf(c), r = rW(1) * (1 - q), he = hEdge(ph); out = out || new THREE.Vector3(); return out.set(S.a * r * Math.cos(ph), he + (S.Hc - he) * (1 - Math.pow(1 - q, 3)), S.b * r * Math.sin(ph)); }
  var _sa = new THREE.Vector3(), _sb = new THREE.Vector3(), _sc = new THREE.Vector3(), _sd = new THREE.Vector3();
  function snrm(c, t, out) { var e = 0.0005, et = 0.004; surf(c + e, t, _sa); surf(c - e, t, _sb); _sa.sub(_sb); surf(c, Math.min(1, t + et), _sc); surf(c, Math.max(0, t - et), _sd); _sc.sub(_sd); out = out || new THREE.Vector3(); out.crossVectors(_sc, _sa); if (out.lengthSq() < 1e-12) out.set(1, 0, 0); return out.normalize(); }
  function sp(c, t, push) { var p = surf(c, t); if (push) p.addScaledVector(snrm(c, t), push); return p; }
  // the LED wall's band on the wall (t) and its half width (phi), its sides bowed out so the opening reads carved
  function ledBand() { var S = SITE; if (S.lb) return S.lb; var tB = (S.ledB - S.y0) / (S.Hf - S.y0), tT = (S.ledT - S.y0) / (S.Hf - S.y0); return (S.lb = { tB: tB, tT: tT }); }
  function ledHalf(t) { var S = SITE, L = ledBand(), k = clamp((t - L.tB) / (L.tT - L.tB), 0, 1); return S.phiL + 0.025 * Math.sin(PI * k); }
  // the ribbons: [lo, hi] in t at |phi| (null where a ribbon has tapered away), and its push at the lower and upper edge
  function ribbons() {
    var S = SITE; if (S.rib) return S.rib; var L = ledBand(), tB = L.tB, tT = L.tT, zh = (tT - tB) / 2, R = [];
    var sw = function (ap) { return sstep(0.38, 2.1, ap); };
    // the lowest ribbon: a cantilever over the glass, thin under the LED wall, deeper round the flanks
    R.push({ k: 0, f: function (ap) { return [0, tB + 0.012 + 0.13 * sstep(0.32, 1.3, ap) - 0.05 * sstep(1.6, 2.8, ap)]; }, pb: 0.85, pt: 0.3, low: true });
    // two broad middle ribbons from behind the LED wall's edges: round the flanks the lower one dips and the upper one climbs,
    // the sandstone shows between them
    [0, 1].forEach(function (k) { R.push({ k: 1 + k, f: function (ap) { var tp = sstep(S.phiL - 0.04, S.phiL + 0.35, ap); if (tp <= 0.002) return null; var cn = tB + zh * (k + 0.5) + (k ? 0.09 : -0.06) * sw(ap) + 0.03 * Math.sin(ap * 1.7 + k * 2.1) * sw(ap); var h = zh * (0.9 - 0.32 * sw(ap)) * tp; return [cn - h / 2, cn + h / 2]; }, pb: 1.15, pt: 0.22 }); });
    // two broad upper ribbons to the roof edge, their joint sweeping down and up along the flanks
    var j1 = function (ap) { return tT + 0.5 * (1 - tT) - 0.13 * Math.sin(ap * 1.4 + 0.3) * sstep(0.35, 1.0, ap); };
    R.push({ k: 3, f: function (ap) { return [tT - 0.015, j1(ap)]; }, pb: 1.0, pt: 0.2, upper: true });
    R.push({ k: 4, f: function (ap) { return [j1(ap) - 0.02, 1.0]; }, pb: 0.95, pt: 0.15, upper: true });
    return (S.rib = R); }
  function buildSkin(K) {
    var S = SITE, N = S.N, R = rng(S.seed * 7 + 1), per = prof().per, tile = 4.0, nTri = 0, L = ledBand();
    var emit = function (base, col, P, U) { var tris = [], uvs = []; for (var i = 1; i < P.length - 1; i++) { tris.push([P[0], P[i], P[i + 1]]); uvs.push([U[0], U[i], U[i + 1]]); } K.tri(base, col, tris, 1, uvs); nTri += tris.length; };
    var orient = function (a, b, c, n) { return _sa.subVectors(b, a).cross(_sb.subVectors(c, a)).dot(n) >= 0; };
    var triDn = function (col, A, B, C) { var n = _sc.subVectors(B, A).cross(_sd.subVectors(C, A)); if (n.y > 0) K.tri("frame", col, [[A, C, B]], 1, [[[0, 0], [1, 0.1], [1, 0]]]); else K.tri("frame", col, [[A, B, C]], 1, [[[0, 0], [1, 0], [1, 0.1]]]); nTri++; };
    var tri3 = function (base, col, A, B, C, ua, ub, uc) { var n = _sd.copy(A).add(B).add(C).multiplyScalar(1 / 3).setY(0).normalize(); if (orient(A, B, C, n)) K.tri(base, col, [[A, B, C]], 1, [[ua, ub, uc]]); else K.tri(base, col, [[A, C, B]], 1, [[ua, uc, ub]]); nTri++; };
    // 1. the core: the wall surface (sandstone between the middle ribbons, a dark bronze reveal elsewhere) and the roof
    var rows = [0, L.tB]; for (var r0 = 1; r0 <= 6; r0++) rows.push(L.tB + (L.tT - L.tB) * r0 / 6); for (var r1 = 1; r1 <= 8; r1++) rows.push(L.tT + (1 - L.tT) * r1 / 8);
    var nc = N * 2;
    for (var i = 0; i < nc; i++) { var c0 = i / nc, c1 = (i + 1) / nc;
      for (var r = 0; r < rows.length - 1; r++) { var t0 = rows[r], t1 = rows[r + 1], sand = t0 >= L.tB - 1e-6 && t1 <= L.tT + 1e-6;
        var A = surf(c0, t0), B = surf(c1, t0), C = surf(c1, t1), D = surf(c0, t1), u0 = c0 * per / 3, u1 = c1 * per / 3;
        var ua = [u0, t0 * 6], ub = [u1, t0 * 6], uc = [u1, t1 * 6], ud = [u0, t1 * 6], col = sand ? [0.9, 0.86, 0.8] : [0.2, 0.15, 0.12];
        tri3(sand ? "sand" : "frame", col, A, B, C, ua, ub, uc); tri3(sand ? "sand" : "frame", col, A, C, D, ua, uc, ud); }
      // the roof: dark brushed copper in long panels, the crown
      var qs = [0, 0.08, 0.2, 0.36, 0.55, 0.75, 1.0]; for (var q = 0; q < qs.length - 1; q++) { if (i % 2) continue; var cc1 = (i + 2) / nc; var A2 = roofPt(c0, qs[q]), B2 = roofPt(cc1, qs[q]), C2 = roofPt(cc1, qs[q + 1]), D2 = roofPt(c0, qs[q + 1]); var tn = 0.42 + R() * 0.12, rc = [tn, tn * 0.9, tn * 0.85];
        var ru = function (cv, qq) { return [cv * per / 5, qq * 8]; }; if (q < qs.length - 2) { K.tri("copper", rc, [[A2, C2, B2], [A2, D2, C2]], 1, [[ru(c0, qs[q]), ru(cc1, qs[q + 1]), ru(cc1, qs[q])], [ru(c0, qs[q]), ru(c0, qs[q + 1]), ru(cc1, qs[q + 1])]]); nTri += 2; } else { K.tri("copper", rc, [[A2, D2, B2]], 1, [[ru(c0, qs[q]), ru(c0, 1), ru(cc1, qs[q])]]); nTri++; } } }
    // 2. the ribbons: one row of folded diamonds each, pushed out most at the lower edge, a dark fascia under it
    ribbons().forEach(function (rb) { var tone0 = rb.upper ? 1.0 + rb.k * 0.03 : rb.low ? 1.02 : 1.1;
      for (var i = 0; i < N; i++) { var off = (rb.k % 2) * 0.5, ci = (i + off) / N, c0 = ci - 0.5 / N, c1 = ci + 0.5 / N, cn = ci + 1 / N;
        var at = function (c) { var v = rb.f(Math.abs(phiOf(c))); return v && v[1] - v[0] > 0.0015 ? v : null; };
        var Fi = at(ci), F0 = at(c0), F1 = at(c1), Fn = at(cn); if (!Fi && !F0 && !F1) continue;
        var safe = function (F, c) { if (F) return F; var v = rb.f(Math.abs(phiOf(c))); var m = v ? (v[0] + v[1]) / 2 : (Fi || F0 || F1)[0]; return [m, m]; };
        Fi = safe(Fi, ci); F0 = safe(F0, c0); F1 = safe(F1, c1); Fn = safe(Fn, cn);
        var hs = function (F) { return sstep(0, 0.03, F[1] - F[0]); };
        var push = function (F, t) { var k = (t - F[0]) / Math.max(1e-6, F[1] - F[0]); return (rb.pt + (rb.pb - rb.pt) * (1 - k)) * hs(F); };
        var P = function (c, F, t, extra) { return sp(c, t, push(F, t) + (extra || 0)); };
        var r = R(), tone = tone0 * (0.8 + R() * 0.3), col = r < 0.05 ? [0.62 * tone, 0.78 * tone, 0.7 * tone] : r < 0.14 ? [0.62 * tone, 0.56 * tone, 0.52 * tone] : [tone, tone * (0.95 + R() * 0.05), tone * (0.9 + R() * 0.1)], fcol = [col[0] * 0.9, col[1] * 0.9, col[2] * 0.9];
        var ox = R(), oy = R(), uv = function (c, t) { return [(c - ci) * per / tile + ox, t * 19 / tile + oy]; };
        var mid = function (F) { return (F[0] + F[1]) / 2; }, pd = 0.24 * hs(Fi);
        var Ct = P(ci, Fi, mid(Fi), pd), Lt = P(c0, F0, mid(F0)), Rt = P(c1, F1, mid(F1)), Tp = P(ci, Fi, Fi[1]), Bt = P(ci, Fi, Fi[0]), Tn = P(cn, Fn, Fn[1]), Bn = P(cn, Fn, Fn[0]);
        var uC = uv(ci, mid(Fi)), uL = uv(c0, mid(F0)), uR = uv(c1, mid(F1)), uT = uv(ci, Fi[1]), uB = uv(ci, Fi[0]), uTn = uv(cn, Fn[1]), uBn = uv(cn, Fn[0]);
        tri3("copper", col, Ct, Lt, Tp, uC, uL, uT); tri3("copper", col, Ct, Tp, Rt, uC, uT, uR); tri3("copper", col, Ct, Rt, Bt, uC, uR, uB); tri3("copper", col, Ct, Bt, Lt, uC, uB, uL);
        tri3("copper", fcol, Tp, Rt, Tn, uT, uR, uTn); tri3("copper", fcol, Bt, Bn, Rt, uB, uBn, uR);
        // the fascia: from the lower edge back to the core, along this column and the next
        if (hs(Fi) > 0.01 || hs(Fn) > 0.01) { var b0 = Bt, b1 = Bn, k0 = surf(ci, Fi[0] - 0.004), k1 = surf(cn, Fn[0] - 0.004); triDn([0.16, 0.12, 0.1], b0, b1, k1); triDn([0.16, 0.12, 0.1], b0, k1, k0); }
      } });
    CV.n.skinTris = nTri;
  }
  // the roof edge: a projecting copper fin along the one flowing line where the wall meets the roof, a warm line of light under it
  function buildRim(K) {
    var n = 360, A = [], Bo = [], Lo = [];
    for (var i = 0; i <= n; i++) { var c = i / n, p = surf(c, 1), nn = snrm(c, 0.995); var hz = V3(nn.x, 0, nn.z).normalize(); A.push(p.clone().addScaledVector(hz, 0.1)); Bo.push(p.clone().addScaledVector(hz, 1.35).add(V3(0, -0.05, 0))); Lo.push(p.clone().addScaledVector(hz, 0.75).add(V3(0, -0.32, 0))); }
    for (var j = 0; j < n; j++) { K.quad("copper", [0.9, 0.82, 0.76], A[j], A[j + 1], Bo[j + 1].clone().add(V3(0, 0.2, 0)), Bo[j].clone().add(V3(0, 0.2, 0)));
      K.quad("copper", [0.7, 0.64, 0.6], Bo[j].clone().add(V3(0, 0.2, 0)), Bo[j + 1].clone().add(V3(0, 0.2, 0)), Bo[j + 1], Bo[j]);
      K.quad("frame", [0.12, 0.1, 0.09], Bo[j], Bo[j + 1], A[j + 1].clone().add(V3(0, -0.4, 0)), A[j].clone().add(V3(0, -0.4, 0)));
      K.quad("emit", [1.0, 0.72, 0.42], Lo[j], Lo[j + 1], Lo[j + 1].clone().add(V3(0, -0.06, 0)), Lo[j].clone().add(V3(0, -0.06, 0))); }
  }
  // the LED media wall: flush with the core in its carved opening (bowed sides), a thin dark bezel; the ribbons close over its edges
  function buildLed(K) {
    var L = ledBand(), nx = 96, ny = 20, P = [], tris = [], uvs = [];
    var cAt = function (t, s) { return cOfPhi(s * ledHalf(t)); };
    for (var j = 0; j <= ny; j++) { var t = lerp(L.tB, L.tT, j / ny), row = []; for (var i = 0; i <= nx; i++) row.push(sp(lerp(cAt(t, -1), cAt(t, 1), i / nx), t, 0.04)); P.push(row); }
    for (var j2 = 0; j2 < ny; j2++) for (var i2 = 0; i2 < nx; i2++) { var a = P[j2][i2], b = P[j2][i2 + 1], c2 = P[j2 + 1][i2 + 1], d = P[j2 + 1][i2]; var ua = [1 - i2 / nx, j2 / ny], ub = [1 - (i2 + 1) / nx, j2 / ny], uc = [1 - (i2 + 1) / nx, (j2 + 1) / ny], ud = [1 - i2 / nx, (j2 + 1) / ny]; tris.push([a, c2, b], [a, d, c2]); uvs.push([ua, uc, ub], [ua, ud, uc]); }
    var g = K.tri("led", [1, 1, 1], tris, 1, uvs); var na = g.attributes.position.count; var wm = 0, tm = (L.tB + L.tT) / 2; for (var k2 = 0; k2 < 40; k2++) wm += surf(lerp(cAt(tm, -1), cAt(tm, 1), k2 / 40), tm).distanceTo(surf(lerp(cAt(tm, -1), cAt(tm, 1), (k2 + 1) / 40), tm)); var hm = (SITE.Hf - SITE.y0) * (L.tT - L.tB); SITE.ledWH = [wm, hm];
    g.setAttribute("aScr", new THREE.Float32BufferAttribute(new Float32Array(na), 1)); g.setAttribute("aTx", new THREE.Float32BufferAttribute(new Float32Array(na).fill(wm / (8 * hm)), 1));
    // the bezel: a dark lip just round the opening (sides follow the bow)
    var edge = function (pts) { for (var k = 0; k < pts.length - 1; k++) { var a = pts[k], b = pts[k + 1]; K.quad("frame", [0.06, 0.06, 0.07], sp(a[0], a[1], 0.03), sp(b[0], b[1], 0.03), sp(b[0], b[1], 0.32), sp(a[0], a[1], 0.32)); K.quad("frame", [0.06, 0.06, 0.07], sp(a[0], a[1], 0.32), sp(b[0], b[1], 0.32), sp(b[0], b[1], 0.03), sp(a[0], a[1], 0.03)); } };
    [-1, 1].forEach(function (s) { var pts = []; for (var j3 = 0; j3 <= 24; j3++) { var t3 = lerp(L.tB, L.tT, j3 / 24); pts.push([cAt(t3, s) + s * 0.0006, t3]); } edge(pts); });
    [L.tB - 0.003, L.tT + 0.003].forEach(function (t4) { var pts = []; for (var i4 = 0; i4 <= 48; i4++) pts.push([lerp(cAt(t4, -1), cAt(t4, 1), i4 / 48), t4]); edge(pts); });
  }
  // the glazed band (the front sector) and the sandstone podium with its service doors and louvres (the rest), the soffit over both
  function glassPt(phi, y, k) { var S = SITE; k = k || S.gk; return V3(S.a * k * Math.cos(phi), y, S.b * k * Math.sin(phi)); }
  function buildBase(K, solids) {
    var S = SITE, per = prof().per, nSeg = Math.round(per * S.gk / 2.4), phiG = 2.05, y1 = S.y0;
    S.doorV = 8.6; var doorPhi = Math.asin(S.doorV / (S.b * S.gk));
    for (var i = 0; i < nSeg; i++) {
      var c0 = i / nSeg, c1 = (i + 1) / nSeg, p0 = phiOf(c0), p1 = phiOf(c1), pm = phiOf((c0 + c1) / 2), glazed = Math.abs(pm) < phiG;
      var a0 = glassPt(p0, 0.05), a1 = glassPt(p1, 0.05), b0 = glassPt(p0, y1), b1 = glassPt(p1, y1), len = a0.distanceTo(a1);
      if (glazed) { K.quad("glass", [1, 1, 1], a1, a0, b0, b1);
        var door = Math.abs(pm) < doorPhi + 0.004;
        // mullions (deeper at the doors), transoms, the sill and head
        K.beam("frame", [0.2, 0.19, 0.18], a0, b0, door ? 0.2 : 0.12, 0.26); [door ? 2.85 : 3.1, y1 - 0.1].forEach(function (y) { K.beam("frame", [0.2, 0.19, 0.18], glassPt(p0, y), glassPt(p1, y), 0.12, 0.24); }); K.beam("frame", [0.16, 0.15, 0.14], glassPt(p0, 0.1), glassPt(p1, 0.1), 0.18, 0.3);
        if (!door) solids.push([pm, len, 0.4]); }
      else { var n = new THREE.Vector3().subVectors(a1, a0).cross(V3(0, 1, 0)).normalize().negate(); var u0 = c0 * per / 3, u1 = c1 * per / 3;
        K.quad("sand", [0.93, 0.9, 0.86], a1, a0, b0, b1, [[u1, 0], [u0, 0], [u0, y1 / 3], [u1, y1 / 3]]);
        K.quad("sand", [0.62, 0.58, 0.54], glassPt(p1, 0.0, S.gk + 0.004), glassPt(p0, 0.0, S.gk + 0.004), glassPt(p0, 0.45, S.gk + 0.004), glassPt(p1, 0.45, S.gk + 0.004), [[u1, 0], [u0, 0], [u0, 0.15], [u1, 0.15]]);   // the plinth
        // service features: roll-up doors at the loading dock (west), exit doors along the sides, louvres high up
        var ap = Math.abs(pm), kind = ap > PI - 0.26 ? (i % 3 === 0 ? "dock" : "louvre") : (i % 7 === 0 ? "exit" : i % 4 === 1 ? "louvre" : null);
        var mid = glassPt(pm, 0, S.gk + 0.02), tng = new THREE.Vector3().subVectors(a1, a0).normalize(), ry = Math.atan2(n.x, n.z);
        if (kind === "dock") { K.box("frame", [0.32, 0.31, 0.3], Math.min(len - 0.4, 3.6), 4.2, 0.08, mid.x, 2.1, mid.z, ry); for (var r2 = 0; r2 < 14; r2++) K.box("frame", [0.42, 0.41, 0.4], Math.min(len - 0.5, 3.4), 0.05, 0.1, mid.x + n.x * 0.04, 0.3 + r2 * 0.28, mid.z + n.z * 0.04, ry); K.box("frame", [0.6, 0.45, 0.1], 0.2, 0.9, 0.2, mid.x + n.x * 0.5 - tng.x * 1.9, 0.45, mid.z + n.z * 0.5 - tng.z * 1.9, ry); K.box("frame", [0.6, 0.45, 0.1], 0.2, 0.9, 0.2, mid.x + n.x * 0.5 + tng.x * 1.9, 0.45, mid.z + n.z * 0.5 + tng.z * 1.9, ry); K.box("emit", [1.0, 0.75, 0.45], 0.5, 0.12, 0.12, mid.x + n.x * 0.2, 4.6, mid.z + n.z * 0.2, ry); }
        else if (kind === "exit") { K.box("frame", [0.24, 0.22, 0.2], 1.9, 2.5, 0.08, mid.x, 1.25, mid.z, ry); K.box("frame", [0.4, 0.38, 0.36], 2.2, 0.1, 0.25, mid.x + n.x * 0.12, 2.6, mid.z + n.z * 0.12, ry); K.box("emit", [0.3, 1.0, 0.45], 0.4, 0.16, 0.05, mid.x + n.x * 0.06, 2.9, mid.z + n.z * 0.06, ry); }
        else if (kind === "louvre") { for (var r3 = 0; r3 < 6; r3++) K.box("frame", [0.3, 0.29, 0.28], Math.min(len - 0.6, 2.2), 0.06, 0.16, mid.x + n.x * 0.05, 4.1 + r3 * 0.2, mid.z + n.z * 0.05, ry, 0, -0.5); K.box("frame", [0.15, 0.15, 0.15], Math.min(len - 0.4, 2.4), 1.4, 0.04, mid.x, 4.6, mid.z, ry); }
        solids.push([pm, len, 0.5]); }
      // the soffit (underside of the skin's foot) and its downlights
      var o0 = surf(c0, 0), o1 = surf(c1, 0); o0.y = o1.y = y1; K.quad("soffit", [1, 1, 1], b1, b0, o0, o1, [[c1 * per / 2.4, 0], [c0 * per / 2.4, 0], [c0 * per / 2.4, 1.2], [c1 * per / 2.4, 1.2]]);
      var dl = glassPt(pm, y1 - 0.02, (S.gk * 0.35 + 0.65)); K.cyl("emit", [1, 0.86, 0.62], 0.13, 0.13, 0.02, dl.x, y1 - 0.015, dl.z, 10);
      // warm pools on the ground under the overhang (after dark)
      if (glazed && i % 2 === 0) { var gp = glassPt(pm, 0.06, (S.gk + 1) / 2); var gq = new THREE.PlaneGeometry(4.2, 4.2); gq.rotateX(-PI / 2); K.place("glow", gq, [1, 0.75, 0.48], gp.x, 0.06, gp.z); }
    }
  }

  // ───────────────────────── the forecourt (built in the arena frame: u = x - cx, v = z - cz) ─────────────────────────
  function Lc(x, z) { return [x - SITE.cx, z - SITE.cz]; }
  // a flat polygon strip from a polyline (world x, z), width w, at height y, uvs in metres / t
  function ribbonK(K, base, col, pts, w, y, t) { var tris = [], uvs = [], acc = 0; for (var i = 0; i < pts.length - 1; i++) { var a = Lc(pts[i][0], pts[i][1]), b = Lc(pts[i + 1][0], pts[i + 1][1]); var dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L * w / 2, nz = dx / L * w / 2;
      var A0 = V3(a[0] - nx, y, a[1] - nz), A1 = V3(a[0] + nx, y, a[1] + nz), B0 = V3(b[0] - nx, y, b[1] - nz), B1 = V3(b[0] + nx, y, b[1] + nz); tris.push([A0, A1, B1], [A0, B1, B0]); var u0 = acc / t, u1 = (acc + L) / t; uvs.push([[0, u0], [w / t, u0], [w / t, u1]], [[0, u0], [w / t, u1], [0, u1]]); acc += L;
      // round the joint with a disc so the turns close
      var dg = new THREE.CircleGeometry(w / 2, 18); dg.rotateX(-PI / 2); var uv = dg.attributes.uv, pa = dg.attributes.position; for (var q = 0; q < uv.count; q++) uv.setXY(q, (pa.getX(q) + b[0]) / t, (pa.getZ(q) + b[1]) / t); K.place(base, dg, col, b[0], y - 0.002, b[1]); }
    K.tri(base, col, tris, 1, uvs); }
  function buildForecourt(K, sol) {
    var S = SITE, f = S.fc, G = 0; forecourtPaths(S);
    // the decomposed granite ground over the whole forecourt and round the arena's front
    var a = Lc(f.x0 - 14, f.z0 - 2), b = Lc(f.x1 + 2, f.z1 + 2); var dg = new THREE.PlaneGeometry(b[0] - a[0], b[1] - a[1], 8, 12); dg.rotateX(-PI / 2); var uv = dg.attributes.uv, pa = dg.attributes.position; for (var i = 0; i < uv.count; i++) uv.setXY(i, pa.getX(i) / 6, pa.getZ(i) / 6); K.place("dg", dg, [0.98, 0.9, 0.82], (a[0] + b[0]) / 2, 0.03, (a[1] + b[1]) / 2);
    // the entrance plaza: pale stone from the glass out to x -284, following the curve of the building
    var tris = [], uvs = [], ue = Lc(-284, 0)[0]; for (var v = -36; v < 36; v += 1.5) { var v1 = v + 1.5, u0a = uAt(v, S.gk) - 0.3, u0b = uAt(v1, S.gk) - 0.3; var A0 = V3(u0a, 0.07, v), A1 = V3(u0b, 0.07, v1), B0 = V3(ue, 0.07, v), B1 = V3(ue, 0.07, v1); tris.push([A0, A1, B1], [A0, B1, B0]); uvs.push([[u0a / 3.2, v / 3.2], [u0b / 3.2, v1 / 3.2], [ue / 3.2, v1 / 3.2]], [[u0a / 3.2, v / 3.2], [ue / 3.2, v1 / 3.2], [ue / 3.2, v / 3.2]]); }
    K.tri("pave", [1, 0.97, 0.93], tris, 1, uvs);
    // the promenade east and the two curving arms, with darker stone borders
    S.paths.forEach(function (p) { ribbonK(K, "sand", [0.62, 0.55, 0.48], [[p[0], p[1]], [p[2], p[3]]], p[4] * 2 + 0.7, 0.06, 3); ribbonK(K, "pave", [1, 0.97, 0.93], [[p[0], p[1]], [p[2], p[3]]], p[4] * 2, 0.075, 3.2); });
    // the planting beds: a low sandstone curb, a darker bed of granite mulch
    S.beds.forEach(function (bd) { var p0 = Lc(bd[0], bd[1]), p1 = Lc(bd[2], bd[3]), w = p1[0] - p0[0], d = p1[1] - p0[1], cx = (p0[0] + p1[0]) / 2, cz = (p0[1] + p1[1]) / 2;
      var bg = new THREE.PlaneGeometry(w, d); bg.rotateX(-PI / 2); var bu = bg.attributes.uv; for (var q = 0; q < bu.count; q++) bu.setXY(q, bu.getX(q) * w / 4, bu.getY(q) * d / 4); K.place("dg", bg, [0.62, 0.52, 0.44], cx, 0.09, cz);
      [[cx, p0[1], w, 0.35], [cx, p1[1], w, 0.35], [p0[0], cz, 0.35, d], [p1[0], cz, 0.35, d]].forEach(function (c) { K.box("sand", [0.82, 0.76, 0.7], c[2], 0.32, c[3], c[0], 0.16, c[1], 0, 1.5); }); });
    // cut sandstone seating blocks along the paths and round the beds (seats on top)
    var R = rng(S.seed * 13 + 3), seats = [[-279, -100, 0.3], [-276, -104.5, 0.6], [-272, -98.5, 0], [-279, -80, -0.3], [-276, -75.5, -0.6], [-272, -81.5, 0], [-262, -100.5, 0], [-258, -100.5, 0], [-262, -79.5, 0], [-258, -79.5, 0], [-294, -119, 1.57], [-294, -61, 1.57], [-266, -124, 0.4], [-268, -56, -0.4], [-286, -124, 0.2], [-286, -56, -0.2], [-253, -66, 1.2], [-253, -114, 1.9]];
    seats.forEach(function (q, i) { var p = Lc(q[0], q[1]), big = i % 3 === 0, w = big ? 2.4 : 1.6, d = big ? 0.8 : 0.9, h = 0.46, tone = 0.86 + R() * 0.14; var g = rbox(w, h, d, 0.05, 1); var gu = g.attributes.uv; for (var k = 0; k < gu.count; k++) gu.setXY(k, gu.getX(k) * w / 3 + R() * 0.0, gu.getY(k) * 0.4); K.place("sand", g, [tone, tone * 0.97, tone * 0.93], p[0], h / 2 + 0.02, p[1], q[2]); sol.push({ x: p[0], z: p[1], ry: q[2], w: w, d: d, y0: 0, y1: h, seat: true }); });
    // the banner poles along the promenade (a lamp head, two arms, a vertical banner between them) and bollards along its edges
    var bp = []; [-292, -280, -268, -256].forEach(function (x) { [-1, 1].forEach(function (sd) { bp.push([x, -90 + sd * 8.4, sd]); }); });
    bp.forEach(function (q, i) { var p = Lc(q[0], q[1]); K.cyl("frame", [0.16, 0.16, 0.17], 0.09, 0.12, 9.2, p[0], 4.6, p[1], 10); K.cyl("frame", [0.2, 0.2, 0.2], 0.3, 0.34, 0.4, p[0], 0.2, p[1], 12); K.cyl("frame", [0.12, 0.12, 0.13], 0.22, 0.12, 0.4, p[0], 9.3, p[1], 12); K.cyl("emit", [1.0, 0.82, 0.55], 0.16, 0.16, 0.12, p[0], 9.08, p[1], 12);
      [3.4, 7.9].forEach(function (y) { K.box("frame", [0.16, 0.16, 0.17], 1.6, 0.06, 0.06, p[0] - 0.8, y, p[1]); });
      var bg2 = new THREE.PlaneGeometry(1.45, 4.35); var bu2 = bg2.attributes.uv, v0 = (i % 3) / 3; for (var k = 0; k < bu2.count; k++) bu2.setXY(k, v0 + bu2.getX(k) / 3, bu2.getY(k)); K.place("banner", bg2, [1, 1, 1], p[0] - 0.85, 5.65, p[1], q[2] > 0 ? 0 : PI); var bb2 = bg2.clone(); K.place("banner", bb2, [1, 1, 1], p[0] - 0.85, 5.65, p[1], q[2] > 0 ? PI : 0);
      var gq = new THREE.PlaneGeometry(5, 5); gq.rotateX(-PI / 2); K.place("glow", gq, [1, 0.8, 0.55], p[0], 0.1, p[1]); sol.push({ x: p[0], z: p[1], ry: 0, w: 0.5, d: 0.5, y0: 0, y1: 4 }); });
    for (var x = -298; x <= -252; x += 4.6) [-1, 1].forEach(function (sd) { var p = Lc(x, -90 + sd * 6.9); K.cyl("frame", [0.1, 0.1, 0.11], 0.11, 0.12, 0.95, p[0], 0.48, p[1], 12); K.cyl("emit", [1.0, 0.8, 0.5], 0.115, 0.115, 0.05, p[0], 0.82, p[1], 12); });
    // the monument sign at the forecourt's east edge: a sandstone slab, copper letters, a lit base
    var ms = Lc(-252.5, -76); K.box("sand", [0.9, 0.85, 0.8], 0.9, 2.4, 6.4, ms[0], 1.2, ms[1], 0, 2); K.box("copper", [1.05, 0.95, 0.85], 0.06, 0.16, 6.0, ms[0] + 0.48, 2.3, ms[1]); K.box("emit", [1.0, 0.78, 0.5], 0.1, 0.06, 6.0, ms[0] + 0.5, 0.12, ms[1]);
    var sg = new THREE.PlaneGeometry(5.8, 1.6); sg.rotateY(PI / 2); S.signGeo = { g: sg, x: ms[0] + 0.47, y: 1.3, z: ms[1] }; sol.push({ x: ms[0], z: ms[1], ry: 0, w: 1, d: 6.5, y0: 0, y1: 2.4 });
    // the tensile shade sails
    [[-272, -63, 16, 11, 0.35, 7.6, 6.1, 3.3], [-262, -117, 15, 11, -0.4, 7.2, 5.8, 3.2], [-292, -126, 10, 8, 0.2, 6.2, 5.0, 3.0], [-292, -54, 10, 8, -0.2, 6.0, 5.2, 3.0]].forEach(function (q, i) { sail(K, sol, q, i); });
    // the decorative lit planter pots by the doors
    [-1, 1].forEach(function (sd) { [12, 16].forEach(function (vv) { var u = uAt(sd * vv, S.gk) + 2.4; K.place("sand", lathe([[0, 0], [0.62, 0], [0.75, 0.7], [0.7, 0.9], [0, 0.9]], 18), [0.75, 0.62, 0.52], u, 0, sd * vv); sol.push({ x: u, z: sd * vv, ry: 0, w: 1.4, d: 1.4, y0: 0, y1: 0.9 }); S.potSpots = (S.potSpots || []).concat([[u, sd * vv]]); }); });
  }
  // a tensile sail: four corners (two on tall raked masts, two low on short posts), a saddle surface with scalloped edges, edge
  // cables, mast backstays to ground anchors, a warm uplight pool under it after dark
  function sail(K, sol, q, idx) {
    var c = Lc(q[0], q[1]), w = q[2], d = q[3], ry = q[4], hA = q[5], hB = q[6], hL = q[7], cs = Math.cos(ry), sn = Math.sin(ry);
    var at = function (lx, lz, y) { return V3(c[0] + lx * cs + lz * sn, y, c[1] - lx * sn + lz * cs); };
    var P = [at(-w / 2, -d / 2, hA), at(w / 2, -d / 2, hL), at(w / 2, d / 2, hB), at(-w / 2, d / 2, hL + 0.4)];
    var C0 = P[0].clone().add(P[1]).add(P[2]).add(P[3]).multiplyScalar(0.25);
    var n = 18, g = new THREE.PlaneGeometry(1, 1, n, n), pa = g.attributes.position;
    for (var i = 0; i < pa.count; i++) { var s = pa.getX(i) + 0.5, t = pa.getY(i) + 0.5; var p = P[0].clone().multiplyScalar((1 - s) * (1 - t)).addScaledVector(P[1], s * (1 - t)).addScaledVector(P[2], s * t).addScaledVector(P[3], (1 - s) * t);
      var ps = Math.sin(PI * s), pt = Math.sin(PI * t); p.addScaledVector(C0.clone().sub(p).setY(0), 0.16 * (ps * (1 - pt) + pt * (1 - ps))); p.y -= 0.45 * ps * pt; pa.setXYZ(i, p.x, p.y, p.z); }
    g.computeVertexNormals(); var gb = g.clone(); var ix = gb.index.array; for (var t2 = 0; t2 < ix.length; t2 += 3) { var tmp = ix[t2 + 1]; ix[t2 + 1] = ix[t2 + 2]; ix[t2 + 2] = tmp; } var nb = gb.attributes.normal; for (var t3 = 0; t3 < nb.count; t3++) nb.setXYZ(t3, -nb.getX(t3), -nb.getY(t3), -nb.getZ(t3)); var gu2 = g.attributes.uv; for (var t4 = 0; t4 < gu2.count; t4++) gu2.setXY(t4, gu2.getX(t4) * 3, gu2.getY(t4) * 3); K.add("fabric", g, [0.97, 0.97, 0.95]); K.add("fabric", gb, [0.9, 0.9, 0.88]);
    // edge cables along the scalloped edges
    var edgeAt = function (s, t) { var i2 = Math.round(t * n) * (n + 1) + Math.round(s * n); return V3(pa.getX(i2), pa.getY(i2), pa.getZ(i2)); };
    for (var k = 0; k < n; k++) { var a = k / n, b = (k + 1) / n; [[a, 0, b, 0], [a, 1, b, 1], [0, a, 0, b], [1, a, 1, b]].forEach(function (e) { K.tube("frame", [0.3, 0.3, 0.32], edgeAt(e[0], e[1]), edgeAt(e[2], e[3]), 0.025, 4); }); }
    // the corners: PlaneGeometry's corners (s, t) = (0, 1) top-left... map P to the grid's corners
    var corners = [edgeAt(0, 0), edgeAt(1, 0), edgeAt(1, 1), edgeAt(0, 1)];
    corners.forEach(function (cp, j) { var out = V3(cp.x - C0.x, 0, cp.z - C0.z).normalize(); var foot = V3(cp.x + out.x * (cp.y > 5 ? 1.2 : 0.3), 0, cp.z + out.z * (cp.y > 5 ? 1.2 : 0.3)); var top = cp.clone().add(V3(out.x * 0.25, 0.25, out.z * 0.25));
      K.tube("frame", [0.82, 0.83, 0.85], foot, top, cp.y > 5 ? 0.13 : 0.08, 10); K.cyl("frame", [0.4, 0.4, 0.42], 0.3, 0.34, 0.25, foot.x, 0.12, foot.z, 10);
      if (cp.y > 5) { var anc = V3(foot.x + out.x * 4.2, 0.05, foot.z + out.z * 4.2); K.tube("frame", [0.3, 0.3, 0.32], top, anc, 0.02, 4); K.box("frame", [0.4, 0.4, 0.42], 0.5, 0.2, 0.5, anc.x, 0.1, anc.z); }
      K.tube("frame", [0.3, 0.3, 0.32], top, cp, 0.03, 4); sol.push({ x: foot.x, z: foot.z, ry: 0, w: 0.4, d: 0.4, y0: 0, y1: 3 }); });
    var gq = new THREE.PlaneGeometry(w * 0.8, d * 0.8); gq.rotateX(-PI / 2); gq.rotateY(ry); K.place("glow", gq, [1, 0.82, 0.6], C0.x, 0.12, C0.z);
    SITE.sails = (SITE.sails || []).concat([[C0.x, C0.y - 1.5, C0.z]]);
  }
  // the entrance doors: four pairs of sliding glass leaves in the door gap (instanced: glass and frames), opening as you come near
  function buildDoors(g) {
    var S = SITE, n = 4, gap = S.doorV, wpair = 2 * gap / n, M = mats(); var u = uAt(0, S.gk);
    var lw = wpair / 2 - 0.04, lg = new THREE.BoxGeometry(0.03, 2.7, lw);
    // each leaf's frame: four thin bars round the glass (one geometry), dark bronze through a vertex colour
    var fk = new Kit(); [[0, 1.39, 0, 0.07, lw + 0.06], [0, -1.39, 0, 0.09, lw + 0.06], [0, 0, lw / 2, 2.84, 0.07], [0, 0, -lw / 2, 2.84, 0.07]].forEach(function (b) { fk.box("frame", [0.12, 0.11, 0.1], 0.07, b[3], b[4], b[0], b[1], b[2]); }); var fg = fk.merge().frame;
    var glassI = { leaves: [] }, frameI = null; fg.dispose(); for (var li = 0; li < n * 2; li++) { var lm = new THREE.Mesh(lg, M.glass); lm.name = "cv door leaf"; lm.renderOrder = 2; lm.castShadow = false; lm.receiveShadow = false; g.add(lm); glassI.leaves.push(lm); }
    var D = S.doors = { pairs: [], gI: glassI, fI: frameI, open: [] };
    for (var i = 0; i < n; i++) { var vc = -gap + wpair * (i + 0.5); var uu = uAt(vc, S.gk); D.pairs.push({ u: uu, v: vc, w: wpair }); D.open.push(0); }
    doorPose(); return D; }
  var _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _dv = new THREE.Vector3(), _ds = new THREE.Vector3(1, 1, 1);
  function doorPose() { var D = SITE.doors; if (!D) return; var k = 0; D.pairs.forEach(function (p, i) { var o = D.open[i]; [-1, 1].forEach(function (sd) { var off = sd * (p.w / 4 + o * (p.w / 2 - 0.1)); D.gI.leaves[k].position.set(p.u - 0.12, 1.42, p.v + off); k++; }); }); }
  function doorFrame(dt) { var D = SITE.doors; if (!D) return; var q = w2l(player.position.x, player.position.z), ch = false, RO = window.PLAN_ROAM; D.pairs.forEach(function (p, i) { var near = Math.abs(q[0] - p.u) < 5.5 && Math.abs(q[1] - p.v) < p.w * 0.9 + 1.5; if (!near && RO && RO.near) { var dw = l2w(p.u, p.v); near = RO.near(dw[0], dw[1], 4.6); } var o = D.open[i], t = near ? 1 : 0; if (o !== t) { D.open[i] = clamp(o + (t > o ? 1 : -1) * dt * 1.8, 0, 1); ch = true; } }); if (ch) doorPose(); }

  // ───────────────────────── the walls everyone collides with (made once, at the defer hook) ─────────────────────────
  // in the arena frame: [u0, v0, u1, v1, y1, thickness]; the solids are oriented boxes along each segment
  function partitionWalls() {
    var S = SITE, Hh = S.hall, W = [], v0 = S.corr.v0, v1 = S.corr.v1;
    [-1, 1].forEach(function (sd) {
      // the hall's side walls, the portal (cross aisle) left open
      W.push([Hh.u0, sd * Hh.v, Hh.portal[0], sd * Hh.v, 13.5, 0.5], [Hh.portal[1], sd * Hh.v, Hh.u1, sd * Hh.v, 13.5, 0.5]);
      // the corridor's outer wall and its west end; the breakout rooms' outer walls (corridor side)
      W.push([S.corr.u0, sd * v1, S.corr.u1, sd * v1, 6, 0.4], [S.corr.u0, sd * v0, S.corr.u0, sd * v1, 6, 0.4], [Hh.u1, sd * 33.0, S.lobby.u0, sd * 33.0, 6, 0.4]);
    });
    // the hall's stage wall and back wall (the rake platform meets it); the breakouts' walls (west: the hall's back wall, the middle wall)
    W.push([Hh.u0, -Hh.v, Hh.u0, Hh.v, 13.5, 0.6], [Hh.u1, -Hh.v, Hh.u1, Hh.v, 13.5, 0.6], [Hh.u1, -1.2, S.lobby.u0, -1.2, 6, 0.4], [Hh.u1, 1.2, S.lobby.u0, 1.2, 6, 0.4]);
    // the lobby's west wall: closed to the back of house beyond the corridors, the corridor mouths and the breakout doors open
    var u = S.lobby.u0, vEnd = S.b * Math.sqrt(Math.max(0, S.gk * S.gk - (u / S.a) * (u / S.a))) - 0.3;
    [-1, 1].forEach(function (sd) { W.push([u, sd * v1, u, sd * vEnd, 6, 0.4], [u, sd * 1.2, u, sd * (Math.abs(S.brk[0].door) - 1.4), 6, 0.4], [u, sd * (Math.abs(S.brk[0].door) + 1.4), u, sd * v0, 6, 0.4]); });
    W.push([u, -1.2, u, 1.2, 6, 0.4]);
    // the back of house beyond the corridors and the hall, to the skin: the closed ring (the glass / podium solids close it outside)
    return (S.walls = W); }
  function wallSolids(W, list) { var S = SITE; W.forEach(function (w) { var du = w[2] - w[0], dv = w[3] - w[1], L = Math.hypot(du, dv); if (L < 0.05) return; var c = l2w((w[0] + w[2]) / 2, (w[1] + w[3]) / 2); var ry = Math.atan2(du, dv); var sd = addSolid(c[0], c[1], ry, w[5], L + w[5], S.G - 0.3, S.G + w[4], "conv"); if (sd) list.push(sd); }); }

  // ───────────────────────── the Grand Lobby (built near; seen through the glass) and the corridors ─────────────────────────
  function lobbyStrips(cb) { var S = SITE, u0 = S.lobby.u0, vm = S.b * Math.sqrt(S.gk * S.gk - (u0 / S.a) * (u0 / S.a)), n = 48; for (var i = 0; i < n; i++) { var va = -vm + 2 * vm * i / n, vb = -vm + 2 * vm * (i + 1) / n; cb(va, vb, uAt(va, S.gk), uAt(vb, S.gk)); } }
  function* buildLobbySteps(L) {
    var S = SITE, B = intMats(), M = mats(), K = new Kit(), sol = L.solids, u0 = S.lobby.u0, ce = S.lobby.ceil;
    var bases = { floor: B.floor, sand: B.sand, copper: B.copper, paint: B.paint, metal: B.metal, wood: B.wood, fabric: B.fabric, dark: B.dark, led: M.led, emit: M.emit, glass: M.glass, soffit: M.soffit, glow: M.glow };
    var so = function (u, v, w, d, y1, ry, seat, face) { var c = l2w(u, v); var s = addSolid(c[0], c[1], ry || 0, w, d, S.G + (seat ? y1 - 0.4 : -0.2), S.G + y1, "conv"); if (s) { if (seat) { s.seat = true; if (face !== undefined) s.face = face; } sol.push(s); } return s; };
    // floor (terrazzo) and ceiling (the soffit runs in through the glass), the corridors' floor and ceiling
    var ft = [], fu = [], ctr = [], cu = []; lobbyStrips(function (va, vb, ua, ub) { var a = V3(u0, 0.055, va), b = V3(ua, 0.055, va), c = V3(ub, 0.055, vb), d = V3(u0, 0.055, vb); ft.push([a, c, b], [a, d, c]); fu.push([[u0 / 4, va / 4], [ub / 4, vb / 4], [ua / 4, va / 4]], [[u0 / 4, va / 4], [u0 / 4, vb / 4], [ub / 4, vb / 4]]);
      var A = V3(u0, ce, va), Bb = V3(ua, ce, va), Cc = V3(ub, ce, vb), Dd = V3(u0, ce, vb); ctr.push([A, Bb, Cc], [A, Cc, Dd]); cu.push([[u0 / 2.4, va / 2.4], [ua / 2.4, va / 2.4], [ub / 2.4, vb / 2.4]], [[u0 / 2.4, va / 2.4], [ub / 2.4, vb / 2.4], [u0 / 2.4, vb / 2.4]]); });
    K.tri("floor", [0.82, 0.76, 0.7], ft, 1, fu);
    lobbyCeiling(K, u0, ce);
    var ic = V3(63, 0.062, 0), ring = function (r0, r1, col, y, n) { var g = new THREE.RingGeometry(r0, r1, n || 64); g.rotateX(-PI / 2); K.place("sand", g, col, ic.x, y, ic.z); }; ring(7.2, 7.6, [0.55, 0.42, 0.32], 0.064); ring(6.6, 7.2, [0.95, 0.9, 0.84], 0.063); ring(2.4, 2.9, [0.55, 0.42, 0.32], 0.064); for (var r9 = 0; r9 < 24; r9++) { var aa = r9 / 24 * TAU; K.box("copper", [1.05, 0.95, 0.88], 3.4, 0.01, 0.12, ic.x + Math.cos(aa) * 4.7, 0.066, ic.z + Math.sin(aa) * 4.7, -aa); } var dg0 = new THREE.CircleGeometry(2.4, 48); dg0.rotateX(-PI / 2); K.place("copper", dg0, [0.95, 0.85, 0.75], ic.x, 0.065, ic.z);
    [-1, 1].forEach(function (sd) { var c0 = S.corr; var g = new THREE.PlaneGeometry(c0.u1 - c0.u0 + 0.2, c0.v1 - c0.v0); g.rotateX(-PI / 2); var gu = g.attributes.uv; for (var q = 0; q < gu.count; q++) gu.setXY(q, gu.getX(q) * (c0.u1 - c0.u0) / 4, gu.getY(q) * 0.75); K.place("floor", g, [0.95, 0.95, 0.95], (c0.u0 + c0.u1) / 2, 0.055, sd * (c0.v0 + c0.v1) / 2);
      var cg = new THREE.PlaneGeometry(c0.u1 - c0.u0, c0.v1 - c0.v0); cg.rotateX(PI / 2); K.place("paint", cg, [0.86, 0.82, 0.76], (c0.u0 + c0.u1) / 2, 4.0, sd * (c0.v0 + c0.v1) / 2);
      // the corridor's light line down the middle of its ceiling, and its walls (sandstone wainscot, warm paint above)
      K.box("emit", [1, 0.86, 0.66], c0.u1 - c0.u0 - 1, 0.04, 0.22, (c0.u0 + c0.u1) / 2, 3.97, sd * (c0.v0 + c0.v1) / 2);
      [[c0.v1 - 0.21, -1, c0.u0, c0.u1], [c0.v0 + 0.01, 1, c0.u0, S.hall.portal[0]], [c0.v0 + 0.01, 1, S.hall.portal[1], S.lobby.u0]].forEach(function (w) { var vv = sd * w[0], face = sd * w[1]; var len = w[3] - w[2]; var mid = w[2] + len / 2; K.box("sand", [0.9, 0.86, 0.8], len, 1.2, 0.04, mid, 0.6, vv + face * 0.2, 0, 2); K.box("paint", [0.78, 0.72, 0.64], len, 2.8, 0.04, mid, 2.6, vv + face * 0.2); });
      K.box("paint", [0.78, 0.72, 0.64], S.hall.portal[1] - S.hall.portal[0], 0.8, 0.04, (S.hall.portal[0] + S.hall.portal[1]) / 2, 3.6, sd * (c0.v0 + 0.21)); K.box("copper", [1, 0.9, 0.82], S.hall.portal[1] - S.hall.portal[0] + 0.5, 0.2, 0.3, (S.hall.portal[0] + S.hall.portal[1]) / 2, 3.25, sd * (c0.v0 + 0.1));
      var ps = new THREE.PlaneGeometry(3.0, 0.5); ps.rotateY(sd > 0 ? PI : 0); var gps = K.place("led", ps, [1, 1, 1], (S.hall.portal[0] + S.hall.portal[1]) / 2, 3.65, sd * (c0.v0 + 0.25)); ledAttr(gps, 8, 3.0, 0.5);
      var eg = new THREE.PlaneGeometry(2.6, 1.0); eg.rotateY(PI / 2); ledAttr(K.place("led", eg, [1, 1, 1], c0.u0 + 0.25, 2.6, sd * (c0.v0 + c0.v1) / 2), 8, 2.6, 1.0); });
    yield 1;
    // the west wall of the lobby (sandstone, a copper band, the welcome LED wall in the middle), the breakout doors, the corridor mouths
    (S.walls || []).forEach(function (w) { if (Math.abs(w[0] - u0) > 0.01 || Math.abs(w[2] - u0) > 0.01) return; var vmid = (w[1] + w[3]) / 2, len = Math.abs(w[3] - w[1]); if (len < 0.1) return;
      K.box("sand", [0.94, 0.9, 0.84], 0.3, ce - 0.02, len, u0 + 0.15, ce / 2, vmid, 0, 3); K.box("copper", [1, 0.92, 0.84], 0.06, 0.5, len, u0 + 0.32, 4.6, vmid); });
    var ledW = 14; var lg = new THREE.PlaneGeometry(ledW, 4.0); lg.rotateY(PI / 2); var g0 = K.place("led", lg, [1, 1, 1], u0 + 0.4, 2.7, 0); ledAttr(g0, 5, ledW, 4.0);
    K.box("dark", [0.3, 0.3, 0.3], 0.2, 4.4, ledW + 0.4, u0 + 0.32, 2.7, 0);
    S.brk.forEach(function (Bk) { var dv = Bk.door; K.box("wood", [0.6, 0.45, 0.35], 0.12, 2.6, 2.6, u0 + 0.2, 1.3, dv); K.box("glass", [1, 1, 1], 0.05, 1.6, 0.5, u0 + 0.28, 1.5, dv - 0.6); K.box("metal", [0.75, 0.6, 0.45], 0.06, 0.04, 0.6, u0 + 0.3, 1.1, dv + 0.8);
      K.box("dark", [0.2, 0.2, 0.2], 0.08, 0.5, 2.6, u0 + 0.35, 3.2, dv); var sgn = new THREE.PlaneGeometry(2.4, 0.42); sgn.rotateY(PI / 2); var gs = K.place("led", sgn, [1, 1, 1], u0 + 0.4, 3.2, dv); ledAttr(gs, Bk.id === "breakA" ? 6 : 7, 2.4, 0.42); });
    // hanging wayfinding signs at the corridor mouths
    [-1, 1].forEach(function (sd) { var vv = sd * (S.corr.v0 + S.corr.v1) / 2; K.box("dark", [0.2, 0.2, 0.2], 0.12, 0.8, 3.6, u0 + 3, 4.6, vv); var sg = new THREE.PlaneGeometry(3.4, 0.6); sg.rotateY(PI / 2); var gq = K.place("led", sg, [1, 1, 1], u0 + 3.07, 4.6, vv); ledAttr(gq, 8, 3.4, 0.6); [-1.6, 1.6].forEach(function (o) { K.tube("metal", [0.4, 0.4, 0.42], V3(u0 + 3, 5.0, vv + o), V3(u0 + 3, ce, vv + o), 0.012, 4); }); });
    yield 1;
    // the registration desk: a long gentle arc facing the doors, copper front, pale top, screens; its backdrop
    var R0 = 9, uc = 44 + R0; for (var i = 0; i < 14; i++) { var a0 = -0.62 + 1.24 * i / 14, a1 = -0.62 + 1.24 * (i + 1) / 14, am = (a0 + a1) / 2; var pu = uc - R0 * Math.cos(am), pv = R0 * Math.sin(am), len = R0 * (a1 - a0) + 0.02;
      if (Math.abs(am) < 0.06) continue; K.box("copper", [1.0, 0.92, 0.84], 0.12, 1.0, len, pu + 0.55, 0.53, pv, am, 1.2); K.box("paint", [0.96, 0.94, 0.9], 0.85, 0.06, len + 0.02, pu + 0.25, 1.08, pv, am); K.box("dark", [0.4, 0.38, 0.36], 0.7, 0.98, len, pu + 0.1, 0.5, pv, am); if (i % 2) { K.box("dark", [0.12, 0.12, 0.13], 0.04, 0.32, 0.5, pu + 0.05, 1.32, pv, am + 0.25); K.box("emit", [0.55, 0.75, 1.0], 0.02, 0.28, 0.46, pu + 0.075, 1.32, pv, am + 0.25); }
      so(pu + 0.25, pv, 0.9, len, 1.1, am); }
    K.box("dark", [0.25, 0.25, 0.26], 0.3, 3.4, 10, 43.2, 1.7, 0); var bs = new THREE.PlaneGeometry(9.2, 2.6); bs.rotateY(PI / 2); var gb = K.place("led", bs, [1, 1, 1], 43.38, 2.0, 0); ledAttr(gb, 5, 9.2, 2.6); so(43.2, 0, 0.3, 10, 3.4);
    // slim LED totems, lounges of low sofas and cubes on rugs, round planters with saguaros and agaves, two copper-clad columns
    [[64, -22], [64, 22], [70, -6], [70, 6]].forEach(function (p) { K.box("dark", [0.15, 0.15, 0.16], 0.5, 2.4, 1.1, p[0], 1.2, p[1], 0); var tg = new THREE.PlaneGeometry(0.98, 2.1); tg.rotateY(PI / 2); var g1 = K.place("led", tg, [1, 1, 1], p[0] + 0.26, 1.25, p[1]); ledAttr(g1, 2, 0.98, 2.1); so(p[0], p[1], 0.6, 1.2, 2.4); });
    [-1, 1].forEach(function (sd) { var lu = 56, lv = sd * 30; var rg = new THREE.PlaneGeometry(7, 5); rg.rotateX(-PI / 2); K.place("fabric", rg, [0.55, 0.42, 0.32], lu, 0.065, lv);
      [[-2.2, 0, PI / 2], [2.2, 0, -PI / 2], [0, sd * 1.6, sd > 0 ? PI : 0]].forEach(function (q) { var su = lu + q[0], svv = lv + q[1]; K.place("fabric", rbox(2.4, 0.42, 0.9, 0.08, 1), [0.86, 0.8, 0.72], su, 0.32, svv, q[2]); K.place("fabric", rbox(2.4, 0.5, 0.22, 0.08, 1), [0.82, 0.76, 0.68], su + Math.sin(q[2]) * -0.4, 0.7, svv + Math.cos(q[2]) * -0.4, q[2]); so(su, svv, Math.abs(Math.sin(q[2])) > 0.5 ? 0.9 : 2.4, Math.abs(Math.sin(q[2])) > 0.5 ? 2.4 : 0.9, 0.48, 0, true, q[2]); });
      K.place("wood", lathe([[0, 0], [0.55, 0], [0.55, 0.4], [0, 0.4]], 20), [0.9, 0.9, 0.9], lu, 0.06, lv); so(lu, lv, 1.0, 1.0, 0.45); });
    S.lobbyPlants = [];
    [[72, -16], [72, 16], [58, -40], [58, 40], [48, -24], [48, 24]].forEach(function (p, i) { K.place("sand", lathe([[0, 0], [1.25, 0], [1.4, 0.75], [1.32, 0.8], [0, 0.8]], 24), [0.72, 0.6, 0.5], p[0], 0.05, p[1]); var dg = new THREE.CircleGeometry(1.3, 20); dg.rotateX(-PI / 2); K.place("paint", dg, [0.35, 0.27, 0.2], p[0], 0.8, p[1]); so(p[0], p[1], 2.6, 2.6, 0.82); S.lobbyPlants.push([p[0], p[1], i]); });
    [[64, -12], [64, 12]].forEach(function (p) { K.cyl("copper", [1, 0.92, 0.85], 0.55, 0.55, ce, p[0], ce / 2, p[1], 20); K.cyl("emit", [1, 0.8, 0.55], 0.6, 0.6, 0.05, p[0], ce - 0.4, p[1], 20); so(p[0], p[1], 1.1, 1.1, ce); });
    yield 1;
    L.meshes = []; yield* buildSteps(K, L.g, bases, {}, L.meshes); L.tris = Math.round(K.tris);
    // the saguaros and agaves in the planters: the game's own models, instanced in this group
    L.modelList = [["saguaro_mid", S.lobbyPlants.slice(0, 4).map(function (p, i) { return [p[0] + 0.2, 0.8, p[1], i * 1.7, 0.9]; })], ["agave_cluster", S.lobbyPlants.map(function (p, i) { return [p[0] + (i % 2 ? 0.5 : -0.4), 0.8, p[1] + 0.6, i, 0.75]; })], ["yucca_cluster", S.lobbyPlants.slice(4).map(function (p, i) { return [p[0], 0.8, p[1], i, 0.9]; })]]; L.models = modelSet(L.g, L.modelList, L);
    // lamps through the client's light pool: the lobby's warm downlight fill
    L.lights = []; [[60, 4.8, -16], [60, 4.8, 16], [48, 4.8, 0]].forEach(function (q) { var l = new THREE.PointLight(0xffd7a8, 0, 26, 1.3); l.position.set(q[0], q[1], q[2]); l.userData.k0 = 3.5; L.g.add(l); L.lights.push(l); });
    return L;
  }
  // the lobby ceiling: shallow folded copper panels over a 4 m grid (each cell a low pyramid), round downlights between them
  function lobbyCeiling(K, u0, ce) { var S = SITE, R = rng(91), vm = S.b * Math.sqrt(S.gk * S.gk - (u0 / S.a) * (u0 / S.a)), cell = 4.2;
    for (var u = u0; u < S.a; u += cell) for (var v = -vm; v < vm; v += cell) { var cu = u + cell / 2, cvv = v + cell / 2; if (eK(cu, cvv) > S.gk - 0.01) continue; var y0 = ce, m = V3(cu + (R() - 0.5) * 0.8, ce - 0.55 - R() * 0.25, cvv + (R() - 0.5) * 0.8), a = V3(u, y0, v), b = V3(u + cell, y0, v), c = V3(u + cell, y0, v + cell), d = V3(u, y0, v + cell);
      [[a, b, m], [b, c, m], [c, d, m], [d, a, m]].forEach(function (tr, fi) { var tn = (fi % 2 ? 0.62 : 0.92) + R() * 0.2; K.tri("copper", [tn, tn * 0.9, tn * 0.8], [tr], 4); }); K.cyl("emit", [1, 0.86, 0.66], 0.16, 0.16, 0.03, u, ce - 0.02, v, 12); }
    var bk = new THREE.PlaneGeometry(S.a - u0, 2 * vm); bk.rotateX(PI / 2); K.place("dark", bk, [0.2, 0.2, 0.2], (S.a + u0) / 2, ce + 0.05, 0); }
  // a registered model drawn as instanced meshes in a group: list of [kind, [[u, y, v, ry, scale], ...]]
  function modelSet(g, list, L) { var out = []; list.forEach(function (q) { var kind = q[0], M0 = MODELS[kind]; if (!q[1].length) return; if (!M0 || !M0.parts) { if (L) (L.pending = L.pending || []).push(q); return; } 
      M0.parts.forEach(function (part) { var im = new THREE.InstancedMesh(part.geometry, part.material, q[1].length); q[1].forEach(function (p, i) { _q.setFromEuler(_e.set(0, p[3] || 0, 0)); var s = p[4] || 1; _m4.compose(_v1.set(p[0], p[1], p[2]), _q, _v2.set(s, s, s)); im.setMatrixAt(i, _m4); }); im.name = "cv model " + kind; im.castShadow = false; im.receiveShadow = true; im.userData.noDispose = true; im.computeBoundingSphere(); g.add(im); out.push(im); }); }); return out; }

  // ───────────────────────── the Keynote Hall (built near, time sliced; drawn only from the hall and its corridors) ─────────────────────────
  // seats face the stage (-u). Rows: a flat floor of 28 rows (pitch 0.95 m) from the stage, a cross aisle at the portals, then 24
  // raked rows (1.0 m, rising 0.3 m a row) up to a landing at the back wall. Three sections across (22, 44, 22 seats at 0.56 m) with
  // two inner aisles and wide outer aisles along the walls; every aisle step has a lit nosing.
  function hallRows() { var S = SITE, Hh = S.hall; if (S.rows) return S.rows; var rows = [];
    for (var j = 0; j < Hh.flatN; j++) rows.push({ u: Hh.flat0 + j * Hh.flatP, y: 0, i: j, rake: false });
    for (var i = 0; i < Hh.rakeN; i++) rows.push({ u: Hh.rake0 + i * Hh.rakeP + 0.12, y: Hh.rakeR * (i + 1), i: Hh.flatN + i, rake: true, p0: Hh.rake0 - 0.5 + i * Hh.rakeP, p1: Hh.rake0 + 0.5 + i * Hh.rakeP });
    return (S.rows = rows); }
  function seatList() { var S = SITE; if (S.seats) return S.seats; var R = rng(S.seed * 101 + 9), out = []; hallRows().forEach(function (row) { S.sec.forEach(function (sec, si) { var n = Math.round((sec[1] - sec[0]) / 0.56); for (var k = 0; k < n; k++) { var v = sec[0] + 0.28 + k * 0.56; var end = k === 0 || k === n - 1; var watch = row.rake && row.i === SITE.hall.flatN + 4 && si === 1 && (k === 21 || k === 22); var occ = false;
        out.push({ u: row.u, v: v, y: row.y, row: row.i, sec: si, k: k, n: n, end: end, occ: occ, watch: watch, aisleV: k === 0 ? sec[0] - 0.9 : sec[1] + 0.9 }); } }); }); return (S.seats = out); }
  // the theatre seat, facing -u, origin on the floor under the seat's middle: cushion, reclined back, arm and standard (one geometry)
  function seatGeo() { var K = new Kit(), fab = [0.2, 0.22, 0.32], dk = [0.08, 0.08, 0.09]; K.box("s", fab, 0.46, 0.09, 0.5, -0.04, 0.45, 0); K.box("s", fab, 0.08, 0.62, 0.5, 0.25, 0.82, 0, 0, 0, 0, -0.16); K.box("s", dk, 0.5, 0.06, 0.06, 0.02, 0.66, 0.28); K.box("s", dk, 0.42, 0.62, 0.05, 0.08, 0.31, 0.28); return K.merge().s; }
  // the sandstone strata: ledges that stand out at their foot and recede upward, broken along the wall (metres out of the wall)
  function strata(u, y) { var k = y / 0.62 + 0.35 * Math.sin(u * 0.11 + y * 0.7) + 0.2 * Math.sin(u * 0.37); var f = k - Math.floor(k); var led = 0.13 * Math.pow(1 - f, 2.2); var bump = 0.03 * Math.sin(u * 1.7 + y * 3.1) * Math.sin(u * 0.53 - y * 1.3); return led + bump + 0.05 * Math.sin(u * 0.21 + Math.floor(k) * 1.7); }
  function trussK(K, A, B, w) { w = w || 0.42; var d = new THREE.Vector3().subVectors(B, A), L = d.length(); d.normalize(); var up = V3(0, 1, 0), sd = new THREE.Vector3().crossVectors(d, up).normalize(), u2 = new THREE.Vector3().crossVectors(sd, d).normalize();
    var co = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (q) { return sd.clone().multiplyScalar(q[0] * w / 2).addScaledVector(u2, q[1] * w / 2); });
    co.forEach(function (o) { K.tube("metal", [0.75, 0.76, 0.78], A.clone().add(o), B.clone().add(o), 0.025, 5); });
    var n = Math.max(2, Math.round(L / 0.5)); for (var i = 0; i < n; i++) { var p0 = A.clone().addScaledVector(d, L * i / n), p1 = A.clone().addScaledVector(d, L * (i + 1) / n); for (var f = 0; f < 4; f++) { var a = co[f], b = co[(f + 1) % 4]; K.tube("metal", [0.7, 0.71, 0.73], (i % 2 ? p0 : p1).clone().add(a), (i % 2 ? p1 : p0).clone().add(b), 0.012, 3); } } }
  function ledQuad(K, scr, u, y, v, w, h, yaw) { var g = new THREE.PlaneGeometry(w, h); g.rotateY(PI / 2 + (yaw || 0)); var gg = K.place("led", g, [1, 1, 1], u, y, v); ledAttr(gg, scr, w, h); return gg; }
  function* buildHallSteps(L) {
    var S = SITE, Hh = S.hall, B = intMats(), M = mats(), K = new Kit(), sol = L.solids, R = rng(S.seed * 3 + 77);
    var bases = { carpet: B.carpet, red: B.red, copper: B.copper, dark: B.dark, paint: B.paint, metal: B.metal, wood: B.wood, sand: B.sand, led: M.led, emit: M.emit, glow: CV.inGlow || (CV.inGlow = (function () { var m = M.glow.clone(); m.opacity = 0.55; m.name = "cv_inglow"; return m; })()) };
    var so = function (u, v, w, d, y0, y1, ry) { var c = l2w(u, v); var s = addSolid(c[0], c[1], ry || 0, w, d, S.G + y0, S.G + y1, "conv"); if (s) sol.push(s); return s; };
    // the floor (carpet), the raked tiers (carpet treads, dark risers, lit nosings in the aisles) and the landing
    var fl = new THREE.PlaneGeometry(Hh.rake0 - 0.5 - Hh.u0, 2 * Hh.v); fl.rotateX(-PI / 2); var fu = fl.attributes.uv; for (var q = 0; q < fu.count; q++) fu.setXY(q, fu.getX(q) * (Hh.rake0 - 0.5 - Hh.u0) / 3, fu.getY(q) * 2 * Hh.v / 3); K.place("carpet", fl, [0.6, 0.58, 0.57], (Hh.u0 + Hh.rake0 - 0.5) / 2, 0.06, 0);
    var aisles = [[-33, -26.6], [-14.3, -12.3], [12.3, 14.3], [26.6, 33]];
    hallRows().forEach(function (row) { if (!row.rake) return; var w = row.p1 - row.p0; var tg = new THREE.PlaneGeometry(w, 2 * Hh.v); tg.rotateX(-PI / 2); var tu = tg.attributes.uv; for (var q2 = 0; q2 < tu.count; q2++) tu.setXY(q2, tu.getX(q2) * w / 3 + row.p0 / 3, tu.getY(q2) * 2 * Hh.v / 3); K.place("carpet", tg, [0.58, 0.56, 0.55], (row.p0 + row.p1) / 2, row.y, 0);
      K.box("dark", [0.35, 0.33, 0.32], 0.04, Hh.rakeR, 2 * Hh.v, row.p0, row.y - Hh.rakeR / 2, 0, 0, 1);
      aisles.forEach(function (a) { K.box("emit", [0.9, 0.62, 0.36], 0.03, 0.025, a[1] - a[0] - 0.2, row.p0 - 0.02, row.y - 0.03, (a[0] + a[1]) / 2); });
      so((row.p0 + row.p1) / 2, 0, w, 2 * Hh.v, -0.5, row.y); });
    var lp0 = Hh.rake0 - 0.5 + Hh.rakeN * Hh.rakeP, ly = Hh.rakeR * (Hh.rakeN + 1); var lg = new THREE.PlaneGeometry(Hh.u1 - lp0, 2 * Hh.v); lg.rotateX(-PI / 2); K.place("carpet", lg, [0.9, 0.88, 0.86], (lp0 + Hh.u1) / 2, ly, 0); K.box("dark", [0.35, 0.33, 0.32], 0.04, Hh.rakeR, 2 * Hh.v, lp0, ly - Hh.rakeR / 2, 0); so((lp0 + Hh.u1) / 2, 0, Hh.u1 - lp0, 2 * Hh.v, -0.5, ly); S.landing = { u: (lp0 + Hh.u1) / 2, y: ly };
    yield 1;
    // the walls: red sandstone sides (portals cut), the stage wall and back wall in dark acoustic panels, copper reveals at the portals
    for (var r9s = 0; r9s < 2; r9s++) { if (R9V && r9s) yield 1; (function (sd) { var vv = sd * (Hh.v - 0.02), t = 6;
      var wall = function (u0, u1, y0, y1) { var nu = Math.max(2, Math.round((u1 - u0) / 0.6)), ny = Math.max(2, Math.round((y1 - y0) / 0.22)); var g = new THREE.PlaneGeometry(u1 - u0, y1 - y0, nu, ny); var gp = g.attributes.position; for (var q5 = 0; q5 < gp.count; q5++) { var wx = gp.getX(q5) + (u0 + u1) / 2, wy = gp.getY(q5) + (y0 + y1) / 2; gp.setZ(q5, strata(wx, wy)); } g.computeVertexNormals(); g.rotateY(sd > 0 ? PI : 0); var gu = g.attributes.uv; for (var q3 = 0; q3 < gu.count; q3++) { var lx = gu.getX(q3), ly2 = gu.getY(q3); gu.setXY(q3, ((sd > 0 ? 1 - lx : lx) * (u1 - u0) + u0) / t, (ly2 * (y1 - y0) + y0) / t); } K.place("red", g, [1, 1, 1], (u0 + u1) / 2, (y0 + y1) / 2, vv); };
      wall(Hh.u0, Hh.portal[0], 0, Hh.ceil); wall(Hh.portal[1], Hh.u1, 0, Hh.ceil); wall(Hh.portal[0], Hh.portal[1], 3.2, Hh.ceil);
      K.box("copper", [1, 0.9, 0.82], Hh.portal[1] - Hh.portal[0] + 0.5, 0.25, 0.5, (Hh.portal[0] + Hh.portal[1]) / 2, 3.3, vv); [Hh.portal[0], Hh.portal[1]].forEach(function (pu) { K.box("copper", [1, 0.9, 0.82], 0.25, 3.3, 0.5, pu, 1.65, vv); });
      K.box("emit", [0.35, 1.0, 0.5], 0.8, 0.22, 0.04, (Hh.portal[0] + Hh.portal[1]) / 2, 3.75, vv - sd * 0.06);
      // the uplight pools at the foot of the walls (scalloped, every 6 m), the saguaros' planters
      for (var u = Hh.u0 + 3; u < Hh.u1 - 2; u += 6) { var gq = new THREE.PlaneGeometry(3.4, 5.5); gq.rotateY(sd > 0 ? PI : 0); K.place("glow", gq, [1, 0.6, 0.3], u, 2.0, vv - sd * 0.05); } })(r9s ? 1 : -1); }
    var back = function (u, w, y0, y1, face) { var g = new THREE.PlaneGeometry(w, y1 - y0); g.rotateY(face); var gu = g.attributes.uv; for (var q4 = 0; q4 < gu.count; q4++) gu.setXY(q4, gu.getX(q4) * w / 2, gu.getY(q4) * (y1 - y0) / 2); K.place("dark", g, [0.55, 0.52, 0.5], u, (y0 + y1) / 2, 0); };
    back(Hh.u0 + 0.02, 2 * Hh.v, 0, Hh.ceil, PI / 2); back(Hh.u1 - 0.02, 2 * Hh.v, ly, Hh.ceil, -PI / 2);
    yield 1;
    // the folded copper ceiling: inverted pyramids on a 12 x 10 grid between 13.5 and 16 m, a dark fascia round its edge
    var nu = 12, nv = 10, cH = function (i, j) { var e = i === 0 || i === nu || j === 0 || j === nv; return e ? 15.6 : 15.7 + 0.4 * Math.sin(i * 1.7 + j * 2.3); };
    var cU = function (i) { return Hh.u0 + (Hh.u1 - Hh.u0) * i / nu; }, cV = function (j) { return -Hh.v + 2 * Hh.v * j / nv; };
    for (var i = 0; i < nu; i++) for (var j = 0; j < nv; j++) { var a = V3(cU(i), cH(i, j), cV(j)), b = V3(cU(i + 1), cH(i + 1, j), cV(j)), c = V3(cU(i + 1), cH(i + 1, j + 1), cV(j + 1)), d = V3(cU(i), cH(i, j + 1), cV(j + 1));
      var m = V3((a.x + c.x) / 2 + (R() - 0.5) * 2.2, Hh.ceil - 0.1 + R() * 0.5, (a.z + c.z) / 2 + (R() - 0.5) * 2.2); [[a, b, m], [b, c, m], [c, d, m], [d, a, m]].forEach(function (tr, fi) { var tn = (fi % 2 ? 0.55 : 0.9) + R() * 0.35; K.tri("copper", [tn, tn * 0.9, tn * 0.8], [tr], 5); }); }
    [-1, 1].forEach(function (sd) { K.box("dark", [0.2, 0.2, 0.2], Hh.u1 - Hh.u0, 2.3, 0.05, (Hh.u0 + Hh.u1) / 2, Hh.ceil + 1.15, sd * (Hh.v - 0.05)); }); [Hh.u0 + 0.05, Hh.u1 - 0.05].forEach(function (uu) { K.box("dark", [0.2, 0.2, 0.2], 0.05, 2.3, 2 * Hh.v, uu, Hh.ceil + 1.15, 0); });
    yield 1;
    // the stage: a black deck with a lit LED fascia, centre steps and side stairs; the lectern
    var st = Hh.stage, sw = st[2], sh = st[3]; K.box("paint", [0.05, 0.05, 0.06], st[1] - st[0], sh, 2 * sw, (st[0] + st[1]) / 2, sh / 2, 0); so((st[0] + st[1]) / 2, 0, st[1] - st[0], 2 * sw, -0.5, sh);
    ledQuad(K, 4, st[1] + 0.03, 0.62, -sw / 2 - 1.75, sw - 3.5, 0.8); ledQuad(K, 4, st[1] + 0.03, 0.62, sw / 2 + 1.75, sw - 3.5, 0.8);
    for (var s4 = 1; s4 <= 4; s4++) { var su = st[1] + 1.6 - s4 * 0.4, sy = sh * s4 / 4; K.box("paint", [0.08, 0.08, 0.09], 0.4, sy, 3.4, su + 0.2, sy / 2, 0); K.box("emit", [0.8, 0.85, 1.0], 0.03, 0.02, 3.2, su + 0.01, sy - 0.02, 0); so(su + 0.2, 0, 0.4, 3.4, -0.5, sy);
      [-1, 1].forEach(function (sd) { K.box("paint", [0.08, 0.08, 0.09], 1.6, sy, 0.45, st[0] + 6, sy / 2, sd * (sw + 1.8 - s4 * 0.45 + 0.225)); so(st[0] + 6, sd * (sw + 1.8 - s4 * 0.45 + 0.225), 1.6, 0.45, -0.5, sy); }); }
    var lu = st[1] - 2.6; K.box("wood", [0.9, 0.85, 0.8], 0.55, 1.12, 0.75, lu, sh + 0.56, 3.0); K.box("copper", [1.05, 0.95, 0.88], 0.02, 0.9, 0.6, lu + 0.29, sh + 0.55, 3.0); K.box("emit", [0.55, 0.7, 1.0], 0.02, 0.06, 0.6, lu + 0.3, sh + 1.0, 3.0); K.tube("metal", [0.2, 0.2, 0.2], V3(lu, sh + 1.12, 3.0), V3(lu + 0.18, sh + 1.4, 3.0), 0.006, 4); so(lu, 3.0, 0.6, 0.8, sh, sh + 1.1);
    // the layered LED walls: the main screen, landscape panels stacked and toed in either side, tall canyon portraits outside them,
    // thin light bars between; the stage surround is black
    var su0 = st[0] + 0.35; ledQuad(K, 1, su0 + 0.25, 7.2, 0, 26, 10.4); K.box("dark", [0.1, 0.1, 0.1], 0.3, 11.0, 26.6, su0, 7.2, 0);
    [-1, 1].forEach(function (sd) { ledQuad(K, 3, su0 + 1.6, 9.0, sd * 17.6, 7.2, 3.6, sd * 0.2); ledQuad(K, 3, su0 + 2.4, 4.6, sd * 17.9, 7.6, 3.8, sd * 0.2);
      K.box("dark", [0.1, 0.1, 0.1], 0.25, 3.8, 7.4, su0 + 1.45, 9.0, sd * 17.6, sd * 0.2); K.box("dark", [0.1, 0.1, 0.1], 0.25, 4.0, 7.8, su0 + 2.25, 4.6, sd * 17.9, sd * 0.2);
      ledQuad(K, 2, su0 + 3.6, 7.0, sd * 25.0, 4.4, 9.6, sd * 0.42); K.box("dark", [0.1, 0.1, 0.1], 0.25, 10.0, 4.6, su0 + 3.45, 7.0, sd * 25.0, sd * 0.42);
      [21.6, 28.6].forEach(function (vb) { K.box("emit", [0.7, 0.55, 1.0], 0.12, 9.5, 0.12, su0 + 3.4, 6.6, sd * vb); }); K.box("emit", [0.55, 0.6, 1.0], 0.12, 7.5, 0.12, su0 + 0.6, 6.5, sd * 13.6); });
    yield 1;
    // the lighting rig: two box trusses over the stage front, cross trusses, chain hoists to the ceiling, moving heads, line arrays
    var tY = 12.2, tu1 = st[1] - 1.2, tu2 = st[0] + 4.5; trussK(K, V3(tu1, tY, -27), V3(tu1, tY, 27)); if (R9V) yield 1; trussK(K, V3(tu2, tY + 0.5, -27), V3(tu2, tY + 0.5, 27)); if (R9V) yield 1; [-27, -9, 9, 27].forEach(function (vv) { trussK(K, V3(tu2, tY + 0.5, vv), V3(tu1, tY, vv), 0.32); }); if (R9V) yield 1;
    [-24, -8, 8, 24].forEach(function (vv) { [tu1, tu2].forEach(function (uu) { K.tube("metal", [0.25, 0.25, 0.26], V3(uu, tY + 0.3, vv), V3(uu, Hh.ceil + 0.5, vv), 0.012, 3); K.box("dark", [0.15, 0.15, 0.16], 0.3, 0.4, 0.3, uu, tY + 1.2, vv); }); });
    L.fix = []; [[tu1, tY - 0.32], [tu2, tY + 0.18]].forEach(function (q, li) { for (var vv = -25; vv <= 25.01; vv += 2.5) { K.box("dark", [0.12, 0.12, 0.13], 0.36, 0.12, 0.36, q[0], q[1] + 0.1, vv); K.box("dark", [0.12, 0.12, 0.13], 0.06, 0.34, 0.34, q[0], q[1] - 0.1, vv); K.cyl("dark", [0.1, 0.1, 0.11], 0.14, 0.12, 0.3, q[0], q[1] - 0.25, vv, 10); K.cyl("emit", [0.85, 0.9, 1.0], 0.1, 0.1, 0.02, q[0], q[1] - 0.41, vv, 10); L.fix.push({ u: q[0], y: q[1] - 0.41, v: vv, li: li }); } });
    [-1, 1].forEach(function (sd) { for (var b2 = 0; b2 < 9; b2++) { var ang = b2 * 0.045; K.box("dark", [0.07, 0.07, 0.08], 0.75, 0.42, 1.25, st[1] + 0.6 + b2 * b2 * 0.012, 11.2 - b2 * 0.44, sd * 26.2, 0, 0, -ang); } K.tube("metal", [0.2, 0.2, 0.2], V3(st[1] + 0.6, 11.4, sd * 26.2), V3(st[1] + 0.6, Hh.ceil + 0.4, sd * 26.2), 0.02, 4); });
    yield 1;
    // saguaros in sandstone planters along the walls (lit from below), agave at their feet
    var sag = [], ag = []; [-44, -36, -28, -20].forEach(function (u, i) { [-1, 1].forEach(function (sd) { var v = sd * (Hh.v - 1.7); K.box("sand", [0.75, 0.62, 0.52], 2.2, 0.6, 1.5, u, 0.3, v); so(u, v, 2.2, 1.5, -0.5, 0.6); sag.push([u, 0.6, v, i * 1.3 + sd, 0.85 + (i % 2) * 0.2]); ag.push([u + 0.7, 0.6, v, i, 0.6]); var gq = new THREE.PlaneGeometry(4, 4); gq.rotateX(-PI / 2); K.place("glow", gq, [1, 0.65, 0.35], u, 0.12, v - sd * 0.8); }); });
    L.meshes = []; yield* buildSteps(K, L.g, bases, {}, L.meshes); L.tris = Math.round(K.tris);
    L.models = modelSet(L.g, [["saguaro_mid", sag], ["agave_cluster", ag]], L);
    yield 1;
    // the seats (instanced; per-instance colour). R10: no seated audience; the roaming people take a few front-row seats for the keynote
    var seats = seatList(), sg = seatGeo(), sI = new THREE.InstancedMesh(sg, B.fabric, seats.length);
    var col = new THREE.Color(), mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), pp = new THREE.Vector3(), sc = new THREE.Vector3();
    seats.forEach(function (s, i) { qq.setFromEuler(_e.set(0, 0, 0)); mm.compose(pp.set(s.u, s.y, s.v), qq, sc.set(1, 1, 1)); sI.setMatrixAt(i, mm); var t = 0.85 + R() * 0.22; sI.setColorAt(i, col.setRGB(t, t, t)); });
    sI.name = "cv seats"; sI.castShadow = false; sI.receiveShadow = true; sI.computeBoundingSphere(); if (sI.computeBoundingBox) sI.computeBoundingBox(); L.g.add(sI);
    L.seatsI = sI; L.people = 0;
    // the seat blocks you cannot walk through (one per row and section), the aisle seats you can sit in (a pool near you)
    hallRows().forEach(function (row) { S.sec.forEach(function (sec) { so(row.u + 0.05, (sec[0] + sec[1]) / 2, 0.66, sec[1] - sec[0], row.y - 0.2, row.y + 0.88); }); });
    yield 1;
    // the beams (additive cones from a subset of the moving heads), animated in the frame hook
    var cg = new THREE.CylinderGeometry(0.1, 1.5, 1, 18, 1, true); cg.translate(0, -0.5, 0); var nb = 0; var bl = L.fix.slice(); var bI = new THREE.InstancedMesh(cg, B.beam, bl.length); var bc = [[0.45, 0.55, 1.0], [0.75, 0.4, 1.0], [0.85, 0.9, 1.0], [0.35, 0.95, 0.85]];
    bl.forEach(function (f, i) { var c = bc[(i + f.li) % bc.length]; bI.setColorAt(i, col.setRGB(c[0], c[1], c[2])); f.ph = R() * TAU; f.sp = 0.25 + R() * 0.3; f.aim = (i % 3 === 0) ? "stage" : "house"; nb++; }); bI.name = "cv beams"; bI.renderOrder = 4; bI.castShadow = false; bI.frustumCulled = false; L.g.add(bI); L.beams = { im: bI, list: bl };
    // lamps through the light pool: the stage wash, two side washes, the house
    L.lights = []; [[st[1] + 5, 10.5, 0, 0xfff1e0, 11, 34], [st[1] + 1, 9.5, -16, 0xd9c8ff, 6, 26], [st[1] + 1, 9.5, 16, 0xd9c8ff, 6, 26]].forEach(function (q) { var l = new THREE.PointLight(q[3], 0, q[5], 1.25); l.position.set(q[0], q[1], q[2]); l.userData.k0 = q[4]; L.g.add(l); L.lights.push(l); });
    return L;
  }
  var _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _bv = new THREE.Vector3(), _bs = new THREE.Vector3(), _bd = new THREE.Vector3(), _by = new THREE.Vector3(0, -1, 0);
  function beamFrame(L, t) { var Bm = L.beams; if (!Bm) return; var st = SITE.hall.stage; Bm.list.forEach(function (f, i) { var a = t * f.sp + f.ph, tx, ty, tz;
      if (f.aim === "stage") { tx = st[0] + 6 + Math.sin(a) * 4; ty = SITE.hall.stage[3]; tz = f.v * 0.5 + Math.cos(a * 0.8) * 5; } else { tx = f.u + 16 + Math.sin(a) * 9; ty = 0.5; tz = f.v * 0.9 + Math.cos(a * 1.1) * 8; }
      _bd.set(tx - f.u, ty - f.y, tz - f.v); var len = Math.min(26, _bd.length()); _bd.normalize(); _bq.setFromUnitVectors(_by, _bd); var w = 0.9 + 0.3 * Math.sin(a * 1.7); _bm.compose(_bv.set(f.u, f.y, f.v), _bq, _bs.set(w, len, w)); Bm.im.setMatrixAt(i, _bm); }); Bm.im.instanceMatrix.needsUpdate = true; }

  // ───────────────────────── the two breakout rooms (one group; built with the hall, drawn from inside them or by their doors) ─────────────────────────
  function chairGeo() { var K = new Kit(), f = [0.3, 0.27, 0.25], m = [0.12, 0.12, 0.13]; K.box("c", f, 0.46, 0.07, 0.46, 0, 0.46, 0); K.box("c", f, 0.06, 0.42, 0.44, 0.22, 0.72, 0, 0, 0, 0, -0.1); [[-0.2, -0.2], [-0.2, 0.2], [0.2, -0.2], [0.2, 0.2]].forEach(function (q) { K.box("c", m, 0.03, 0.44, 0.03, q[0], 0.22, q[1]); }); return K.merge().c; }
  function* buildBreakSteps(L) {
    var S = SITE, B = intMats(), M = mats(), K = new Kit(), sol = L.solids, R = rng(S.seed * 5 + 41), ce = 5.0;
    var bases = { carpet: B.carpet, paint: B.paint, wood: B.wood, sand: B.sand, dark: B.dark, metal: B.metal, copper: B.copper, led: M.led, emit: M.emit };
    var so = function (u, v, w, d, y0, y1) { var c = l2w(u, v); var s = addSolid(c[0], c[1], 0, w, d, S.G + y0, S.G + y1, "conv"); if (s) sol.push(s); return s; };
    var chairs = [], free = [];
    S.brk.forEach(function (Bk, bi) { var u0 = Bk.u0, u1 = Bk.u1, v0 = Bk.v0, v1 = Bk.v1, uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, w = u1 - u0, d = v1 - v0;
      var fg = new THREE.PlaneGeometry(w, d); fg.rotateX(-PI / 2); var fu = fg.attributes.uv; for (var q = 0; q < fu.count; q++) fu.setXY(q, fu.getX(q) * w / 3, fu.getY(q) * d / 3); K.place("carpet", fg, bi ? [1.6, 1.3, 1.1] : [1.2, 1.3, 1.6], uc, 0.06, vc);
      var cg = new THREE.PlaneGeometry(w, d); cg.rotateX(PI / 2); K.place("paint", cg, [0.62, 0.58, 0.54], uc, ce, vc);
      for (var i = 0; i < 4; i++) K.box("emit", [1, 0.9, 0.75], w - 4, 0.04, 0.18, uc, ce - 0.03, v0 + d * (i + 1) / 5);
      // the walls: warm wood slats on the long walls over a sandstone wainscot, the screen wall dark
      [[v0 + 0.02, 0], [v1 - 0.02, PI]].forEach(function (sw2) { var g = new THREE.PlaneGeometry(w, ce); g.rotateY(sw2[1]); var gu = g.attributes.uv; for (var q2 = 0; q2 < gu.count; q2++) gu.setXY(q2, gu.getX(q2) * w / 2, gu.getY(q2) * ce / 2); K.place("wood", g, [1, 0.92, 0.85], uc, ce / 2, sw2[0]);
        for (var s2 = u0 + 0.5; s2 < u1 - 0.4; s2 += 0.45) K.box("wood", [0.75, 0.62, 0.5], 0.08, ce - 1.3, 0.06, s2, 0.65 + (ce - 1.3) / 2, sw2[0] + (sw2[1] ? -0.05 : 0.05)); K.box("sand", [0.9, 0.85, 0.8], w, 1.2, 0.05, uc, 0.6, sw2[0] + (sw2[1] ? -0.04 : 0.04), 0, 2); });
      var bw = new THREE.PlaneGeometry(d, ce); bw.rotateY(PI / 2); K.place("dark", bw, [0.5, 0.48, 0.46], u0 + 0.02, ce / 2, vc); var ew = new THREE.PlaneGeometry(d, ce); ew.rotateY(-PI / 2); var eu = ew.attributes.uv; for (var q3 = 0; q3 < eu.count; q3++) eu.setXY(q3, eu.getX(q3) * d / 2, eu.getY(q3) * ce / 2); K.place("wood", ew, [0.95, 0.88, 0.8], u1 - 0.02, ce / 2, vc);
      ledQuad(K, bi ? 7 : 6, u0 + 0.14, 2.75, vc, 9.0, 3.8); K.box("dark", [0.08, 0.08, 0.08], 0.08, 4.1, 9.3, u0 + 0.05, 2.75, vc);
      // a low stage, the lectern, a side table with water, plants
      K.box("wood", [0.55, 0.42, 0.32], 3.0, 0.25, d - 2, u0 + 1.5, 0.125, vc); so(u0 + 1.5, vc, 3.0, d - 2, -0.5, 0.25);
      var lv = vc + (bi ? -4.6 : 4.6); K.box("wood", [0.9, 0.85, 0.8], 0.5, 1.1, 0.65, u0 + 1.6, 0.8, lv); K.box("copper", [1, 0.92, 0.85], 0.02, 0.85, 0.55, u0 + 1.86, 0.8, lv); so(u0 + 1.6, lv, 0.6, 0.7, 0.25, 1.35);
      // the chairs: two blocks of seven across a centre aisle, nine rows deep; about half taken
      for (var r = 0; r < 9; r++) for (var sd = -1; sd <= 1; sd += 2) for (var k = 0; k < 7; k++) { var cu = u0 + 5.2 + r * 1.05, cv0 = vc + sd * (1.0 + k * 0.62); chairs.push([cu, cv0]); if (k === 0) free.push({ u: cu - 0.02, v: cv0, y: 0, aisleV: vc, brk: Bk.id, end: true }); }
      for (var r2 = 0; r2 < 9; r2++) [-1, 1].forEach(function (sd2) { so(u0 + 5.2 + r2 * 1.05 + 0.05, vc + sd2 * (1.0 + 3 * 0.62), 0.55, 7 * 0.62, -0.2, 0.84); });
      [[u1 - 1.2, v0 + 1.2], [u1 - 1.2, v1 - 1.2], [u0 + 1.0, v0 + 1.0], [u0 + 1.0, v1 - 1.0]].forEach(function (p) { K.place("sand", lathe([[0, 0], [0.42, 0], [0.5, 0.62], [0, 0.62]], 16), [0.7, 0.6, 0.5], p[0], 0.06, p[1]); so(p[0], p[1], 1.0, 1.0, -0.2, 0.7); (L.plants = L.plants || []).push([p[0], 0.66, p[1], R() * 6, 0.65]); });
    });
    yield 1;
    L.meshes = []; yield* buildSteps(K, L.g, bases, {}, L.meshes); L.tris = Math.round(K.tris);
    var cI = new THREE.InstancedMesh(chairGeo(), B.fabric, chairs.length), mm = new THREE.Matrix4(), col = new THREE.Color(); chairs.forEach(function (c, i) { mm.makeTranslation(c[0], 0.06, c[1]); cI.setMatrixAt(i, mm); var t = 0.85 + R() * 0.2; cI.setColorAt(i, col.setRGB(t, t, t)); }); cI.name = "cv chairs"; cI.castShadow = false; cI.computeBoundingSphere(); L.g.add(cI);
    L.models = modelSet(L.g, [["yucca_cluster", L.plants || []]], L);
    S.brkFree = free;
    L.lights = []; S.brk.forEach(function (Bk) { var l = new THREE.PointLight(0xffe2c0, 0, 22, 1.3); l.position.set((Bk.u0 + Bk.u1) / 2, 4.2, (Bk.v0 + Bk.v1) / 2); l.userData.k0 = 5; L.g.add(l); L.lights.push(l); });
    return L;
  }

  // ───────────────────────── interiors: build near (time sliced), dispose far; who is drawn from where ─────────────────────────
  var IT = CV.it = CV.it || { lobby: null, hall: null, brk: null, sb: null };
  var R_LOBBY = 230, R_LOBBY_DROP = 300, R_IN = 95, R_IN_DROP = 170;
  function newL(name) { var g = new THREE.Group(); g.name = name; g.position.set(SITE.cx, SITE.G, SITE.cz); g.userData.noBatch = true; g.userData.interior = true; return { g: g, solids: [], lights: [] }; }
  function finishL(L, name) { scene.add(L.g); L.g.updateMatrixWorld(true); try { if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(L.g, { name: name }); } catch (e) {} return L; }
  function disposeL(key) { var L = IT[key]; if (!L) return; try { scene.remove(L.g); L.solids.forEach(function (sd) { var i = SOLIDS.indexOf(sd); if (i >= 0) SOLIDS.splice(i, 1); }); L.g.traverse(function (o) { if ((o.isMesh || o.isInstancedMesh) && o.geometry && !o.userData.noDispose && !o.geometry.userData.cvKeep) o.geometry.dispose(); if (o.isInstancedMesh && o.dispose) o.dispose(); }); } catch (e) { note("dispose " + key, e); } IT[key] = null; CV.n.disposes++; }
  function distArena(x, z) { var q = w2l(x, z); return Math.max(0, (eK(q[0], q[1]) - 1) * 70); }
  function interiorFrame() {
    var px = player.position.x, pz = player.position.z, d = distArena(px, pz), flying = typeof FLY !== "undefined" && FLY.on, q = w2l(px, pz);
    var dDoor = Math.hypot(q[0] - 82, q[1]), ins = eK(q[0], q[1]) < SITE.gk;
    if (!IT.sb && !flying) { var job = null;
      if (!IT.lobby && d < R_LOBBY) job = ["lobby", buildLobbySteps, "conv lobby"];
      else if (!IT.hall && (dDoor < R_IN || ins)) job = ["hall", buildHallSteps, "conv hall"];
      else if (!IT.brk && (dDoor < R_IN || ins)) job = ["brk", buildBreakSteps, "conv breakouts"];
      if (job) { var L = newL(job[2]); IT.sb = { key: job[0], L: L, it: job[1](L), name: job[2], t0: nowMs() }; } }
    if (IT.sb) { var sb = IT.sb, r; try { var hurry = ins || dDoor < 12; if (!hurry && window.PLAN_PERF && PLAN_PERF.step) r = PLAN_PERF.step(sb.it); else { do { r = sb.it.next(); } while (!r.done); } } catch (e) { note("build " + sb.key, e); IT.sb = null; return; }
      if (r && r.done) { IT[sb.key] = finishL(sb.L, sb.name); CV.n.builds++; CV.n["ms_" + sb.key] = Math.round(nowMs() - sb.t0); IT.sb = null; } }
    if (IT.lobby && d > R_LOBBY_DROP) disposeL("lobby");
    if (!SIT.on) { if (IT.hall && dDoor > R_IN_DROP && !ins) disposeL("hall"); if (IT.brk && dDoor > R_IN_DROP && !ins) disposeL("brk"); }
  }
  // the camera's place in the building: "hall", "brk", "corr", "lobby" or null (outside)
  function zoneOf(x, y, z) { var S = SITE, q = w2l(x, z), u = q[0], v = q[1], av = Math.abs(v), h = y - S.G; if (eK(u, v) > S.gk - 0.002 || h > 18 || h < -2) return null;
    if (u >= S.hall.u0 - 0.5 && u <= S.hall.u1 + 0.2 && av <= S.hall.v + 0.2) return "hall"; if (av >= S.corr.v0 - 0.2 && av <= S.corr.v1 + 0.2 && u >= S.corr.u0 - 0.3 && u <= S.lobby.u0 + 0.2) return "corr";
    if (u > S.hall.u1 && u < S.lobby.u0 + 0.2 && av > 1 && av < 33.2) return "brk"; if (u >= S.lobby.u0) return "lobby"; return "boh"; }
  function visFrame() {
    var c = camera.position, z = zoneOf(c.x, c.y, c.z), q = w2l(c.x, c.z), u = q[0], av = Math.abs(q[1]); CV.zone = z;
    var nearDoorBrk = z === "lobby" && u < SITE.lobby.u0 + 12 && av > 10 && av < 22, nearCorr = z === "lobby" && u < SITE.lobby.u0 + 14 && av > 26 && av < 44;
    if (IT.lobby) IT.lobby.g.visible = z !== "hall" && z !== "brk" || (z === "hall" && u > SITE.hall.portal[0] - 6 && av > 24);
    if (IT.hall) IT.hall.g.visible = z === "hall" || z === "corr" || nearCorr;
    if (IT.brk) IT.brk.g.visible = z === "brk" || nearDoorBrk;
    if (EX.g) EX.g.visible = true;
  }

  // ───────────────────────── the camera in the building: kept inside the walls, first person when tight; the keynote view ─────────────────────────
  var FR = CV.fr = CV.fr || { inCam: false };
  function inVol(x, y, z) { var zn = zoneOf(x, y, z), h = y - SITE.G; if (!zn || zn === "boh") return false; if (zn === "hall") return h < SITE.hall.ceil - 0.4; if (zn === "lobby") return h < SITE.lobby.ceil - 0.3; if (zn === "corr") return h < 3.7; if (zn === "brk") { var q = w2l(x, z), av = Math.abs(q[1]); return h < 4.7 && av > 1.5 && av < 32.3 && q[0] > SITE.hall.u1 + 0.8 && q[0] < SITE.lobby.u0 - 0.4; } return false; }
  function camHook(dt) {
    if (CV.off || !SITE || !CV.ready || window.__cam) return false;
    try {
      // seated in the hall: the keynote view (eye at the seat, the stage framed, a slow drift)
      if (SIT.on && CV.sitting && CV.sitting.hall) { var s = CV.sitting, w = l2w(s.u, s.v), t = nowMs() / 1000; var ey = SITE.G + s.y + 1.42; camera.position.set(w[0] + 0.05, ey, w[1]); var st = SITE.hall.stage, tw = l2w(st[0] + 2, Math.sin(t * 0.05) * 1.2); camera.lookAt(tw[0], SITE.G + 6.2 + Math.sin(t * 0.07) * 0.25, tw[1]); if (camera.fov !== 52) { camera.fov = 52; camera.updateProjectionMatrix(); FR.fov = true; } try { player.userData.walk.visible = false; } catch (e) {} FR.inCam = true; return true; }
      if (FR.fov) { FR.fov = false; try { camera.fov = typeof FOV_BASE === "function" ? FOV_BASE() : 62; camera.updateProjectionMatrix(); } catch (e) {} }
      if (SIT.on) return false;
      var px = player.position.x, py = player.position.y, pz = player.position.z; var zn = zoneOf(px, py + 1, pz);
      if (!zn || zn === "boh" || zn === "lobby" && w2l(px, pz)[0] > uAt(w2l(px, pz)[1], SITE.gk) - 6) { if (FR.inCam) { FR.inCam = false; try { player.userData.walk.visible = true; } catch (e) {} } return false; }
      FR.inCam = true; var fwd = [-Math.sin(yaw), -Math.cos(yaw)], by = typeof bobY === "number" ? bobY : 0, cy0 = py - by + 1.8, maxD = zn === "hall" ? 7.5 : zn === "lobby" ? 6 : 3.6, dist = 0;
      for (var d = 0.2; d <= maxD; d += 0.2) { var cx = px - fwd[0] * d, cz = pz - fwd[1] * d; if (!inVol(cx, cy0 + 0.35 + d * 0.12, cz)) break; dist = d; }
      if (FR.fp === undefined) FR.fp = dist < 1.3; else if (FR.fp && dist > 2.1) FR.fp = false; else if (!FR.fp && dist < 1.1) FR.fp = true;
      CAM.dist += (dist - CAM.dist) * smoothK(dt, 10); var sd = Math.min(dist, CAM.dist);
      if (FR.fp) { camera.position.set(px, py - by + 1.62, pz); CAM.init = false; camera.lookAt(px + fwd[0] * 10, camera.position.y - pitch * 6, pz + fwd[1] * 10); player.userData.walk.visible = false; }
      else { var cy = cy0 + pitch * 1.4 + sd * 0.12; camera.position.lerp(camTarget.set(px - fwd[0] * sd, cy, pz - fwd[1] * sd), smoothK(dt, 24)); camLook(px, py + 1.3, pz, dt, 30); player.userData.walk.visible = true; }
      return true; } catch (e) { note("cam", e); return false; }
  }

  // ───────────────────────── seats: a pool of sit-able seats near you (aisle seats, the breakouts' aisle chairs), the keynote view ─────────────────────────
  var SP = CV.sp = CV.sp || { list: [], at: 0 };
  function seatSolid(s, hall) { var w = l2w(s.u, s.v), y1 = SITE.G + s.y + (hall ? 0.5 : 0.53); var sd = addSolid(w[0], w[1], 0, 0.44, 0.44, y1 - 0.4, y1, "conv"); if (sd) { sd.seat = true; sd.face = -PI / 2; sd.cvSeat = s; sd.cvHall = hall; } return sd; }
  function seatPool() {
    var t = nowMs(); if (t - SP.at < 250) return; SP.at = t; var q = w2l(player.position.x, player.position.z), want = [];
    if (IT.hall && zoneOf(player.position.x, player.position.y + 1, player.position.z) === "hall") seatList().forEach(function (s) { if (s.occ || !(s.end || s.watch)) return; var d = Math.hypot(s.u - q[0], s.v - q[1]); if (d < 2.4 && Math.abs(player.position.y - SITE.G - s.y) < 1.2) want.push([d, s, true]); });
    if (IT.brk && SITE.brkFree) SITE.brkFree.forEach(function (s) { var d = Math.hypot(s.u - q[0], s.v - q[1]); if (d < 2.4) want.push([d, s, false]); });
    want.sort(function (a, b) { return a[0] - b[0]; }); want = want.slice(0, 8);
    var keep = []; SP.list.forEach(function (sd) { var inUse = SIT.on && Math.abs(player.position.x - sd.x) < 0.5 && Math.abs(player.position.z - sd.z) < 0.5; var still = want.some(function (w) { return w[1] === sd.cvSeat; }); if (inUse || still) keep.push(sd); else { var i = SOLIDS.indexOf(sd); if (i >= 0) SOLIDS.splice(i, 1); } });
    want.forEach(function (w) { if (keep.some(function (sd) { return sd.cvSeat === w[1]; })) return; var sd = seatSolid(w[1], w[2]); if (sd) keep.push(sd); }); SP.list = keep; }
  function sitFrame() {
    if (SIT.on) { if (!CV.sitting) { var p = player.position; for (var i = 0; i < SP.list.length; i++) { var sd = SP.list[i]; if (Math.abs(p.x - sd.x) < 0.5 && Math.abs(p.z - sd.z) < 0.5) { CV.sitting = { u: sd.cvSeat.u, v: sd.cvSeat.v, y: sd.cvSeat.y, aisleV: sd.cvSeat.aisleV, hall: sd.cvHall, t0: nowMs() }; break; } } }
      if (CV.sitting && CV.sitting.hall && !CV.kStamp && nowMs() - CV.sitting.t0 > 3000) { CV.kStamp = true; stamp(C("progress.keynote", "p_solport_keynote")); } return; }
    if (CV.sitting) { var s = CV.sitting; CV.sitting = null; CV.watch = false; var w = l2w(s.u - 0.1, s.aisleV); try { player.position.set(w[0], SITE.G + s.y + 0.02, w[1]); } catch (e) {} } }
  function watchKeynote() {
    if (!IT.hall) { var L = newL("conv hall"), it = buildHallSteps(L), r; do { r = it.next(); } while (!r.done); IT.hall = finishL(L, "conv hall"); }
    var s = seatList().filter(function (q) { return q.watch; })[0]; if (!s) return false; var sd = seatSolid(s, true); if (!sd) return false; SP.list.push(sd);
    try { sitDown(sd); } catch (e) { note("sit", e); return false; } CV.sitting = { u: s.u, v: s.v, y: s.y, aisleV: 13.3, hall: true, t0: nowMs() }; CV.watch = true;
    try { setStatus(C("names.summit", "Solport Summit") + " · the keynote · E to stand up"); } catch (e) {} return true; }
  function stamp(id) { try { var PP = window.PLAN_PROGRESS; if (PP && PP.award && id) PP.award("stamp", { id: id }); } catch (e) {} }

  // ───────────────────────── E and the prompt ─────────────────────────
  function handleE() {
    if (CV.off || !SITE) return false; if ((typeof riding !== "undefined" && riding) || (typeof inside !== "undefined" && inside)) return false; if (SIT.on) return false;
    var h = null; try { h = nearestHotspot(); } catch (e) {} if (h && h.cvPlay === "watch") { return watchKeynote(); }
    return false; }
  function install() {
    if (CV.installed) return; CV.installed = true; var o = CV.orig = { openNearest: openNearest };
    openNearest = function () { try { if (CV.impl.handleE()) return; } catch (e) { note("E", e); } return o.openNearest.apply(this, arguments); };
  }

  // ───────────────────────── R10: routes for the roaming people (PLAN_ROAM in plan_festival.js): the lobby and the keynote's front rows ─────────────────────────
  // Every route starts on the forecourt outside a door pair and is a list of world points [x, y, z] (y: the floor) that keeps clear of
  // the lobby's desk, totems, columns, planters and lounges, then the corridor, a side portal, the cross aisle, an inner aisle and the
  // leg room of a row. The keynote seats are in the flat rows nearest the stage (the "Watch the keynote" seat stays free).
  function roamApi() {
    if (!SITE || !CV.ready) return null; if (CV.roamApi) return CV.roamApi; var S = SITE, G = S.G, yIn = G + 0.06, ug = uAt(0, S.gk), lanes = [-6.45, -2.15, 2.15, 6.45];
    var P = function (u, v, y) { var w = l2w(u, v); return [w[0], y === undefined ? yIn : y, w[1]]; };
    var head = function (v0) { var w = l2w(ug + 6, v0), y = G; try { y = planGroundAt(w[0], w[1]); } catch (e) {} return [[w[0], y, w[1]], P(ug + 1.2, v0), P(ug - 4, v0)]; };
    var lobby = [], keynote = [];
    [[-1.6, 1], [2.4, 2]].forEach(function (q) { lobby.push({ kind: "browse", line: "lobby", lobby: true, via: head(lanes[q[1]]).concat([P(50, q[0]), P(45.7, q[0])]), face: -PI / 2, dur: [8, 16], tag: "desk" }); });
    [[-6, 0], [6, 3]].forEach(function (q) { lobby.push({ kind: "look", line: "lobby", lobby: true, via: head(lanes[q[1]]).concat([P(72.6, q[0])]), face: -PI / 2, dur: [6, 12], tag: "totem" }); });
    [-1, 1].forEach(function (sd) { var h0 = head(lanes[sd < 0 ? 0 : 3]);
      lobby.push({ kind: "sit", line: "lobby", lobby: true, via: h0.concat([P(62, sd * 19), P(55.8, sd * 27.4), P(54.95, sd * 29.2)]), sitAt: P(53.85, sd * 29.6, G + 0.48), face: PI / 2, back: 0.25, dur: [25, 50], tag: "sofa" });
      lobby.push({ kind: "sit", line: "lobby", lobby: true, via: h0.concat([P(62, sd * 19), P(57.4, sd * 27.6), P(57.5, sd * 29.2)]), sitAt: P(58.15, sd * 29.6, G + 0.48), face: -PI / 2, back: 0.25, dur: [25, 50], tag: "sofa" }); });
    var c1 = { kind: "chat", line: "lobby", lobby: true, via: head(lanes[1]).concat([P(66, -2.6)]), face: PI / 2, dur: [15, 30], tag: "lobby" }, c2 = { kind: "chat", line: "lobby", lobby: true, via: head(lanes[2]).concat([P(67.2, -2.6)]), face: -PI / 2, dur: [15, 30], tag: "lobby" }; c1.pair = c2; c2.pair = c1; lobby.push(c1, c2);
    // the flat rows nearest the stage, and a few in the first raked rows (in front of the "Watch the keynote" seat, so that view has people in it)
    var rows = hallRows(), cu = (S.hall.cross[0] + S.hall.cross[1]) / 2, Hh = S.hall, fN = Hh.flatN;
    [[1, 1, 3], [1, 1, 4], [2, 1, 20], [2, 1, 21], [3, 1, 40], [4, 1, 12], [2, 2, 1], [fN + 1, 1, 20], [fN + 2, 1, 24], [fN + 2, 1, 17], [fN + 3, 1, 26], [fN + 1, 1, 13]].forEach(function (q, i) { var row = rows[q[0]], sec = S.sec[q[1]], v = sec[0] + 0.28 + q[2] * 0.56, sd = v < 0 ? -1 : 1, av = sd * 13.3, lu = row.u - 0.46, up = [];
      if (row.rake) for (var j = 0; j <= row.i - fN; j++) up.push(P(Hh.rake0 + j * Hh.rakeP, av, G + 0.06 + Hh.rakeR * (j + 1)));
      var via = head(lanes[sd < 0 ? 1 : 2]).concat([P(62, sd * 19), P(50, sd * 31), P(42, sd * 34.9), P(cu, sd * 34.9), P(cu, sd * 31.6), P(cu, av)], up, [P(lu, av, G + 0.06 + row.y), P(lu, v, G + 0.06 + row.y)]);
      keynote.push({ kind: "keynote", ev: "keynote", quiet: true, via: via, sitAt: P(row.u - 0.02, v, G + row.y + 0.5), face: -PI / 2, back: 0.2, dur: [600, 900], tag: "seat" + i }); });
    var api = { lobby: lobby, keynote: keynote, beds: (S.beds || []).slice(), door: head(0)[0],
      inside: function (x, z) { var q = w2l(x, z); return eK(q[0], q[1]) < S.gk + 0.012; },
      zone: function (x, y, z) { return zoneOf(x, y, z); }, camZone: function () { return CV.zone || null; },
      vis: function (x, y, z) { var zn = zoneOf(x, y + 1, z); if (!zn) return true; if (zn === "lobby") return !!(IT.lobby && IT.lobby.g.visible); if (zn === "hall" || zn === "corr") return !!(IT.hall && IT.hall.g.visible); if (zn === "brk") return !!(IT.brk && IT.brk.g.visible); return false; } };
    return (CV.roamApi = api); }

  // ───────────────────────── the staff: the lobby host and the keynote speaker (client avatars in the CAST, talk cards on E) ─────────────────────────
  function buildStaff() {
    var ST = C("staff", null); if (!ST || typeof avatar !== "function") return; CV.cast = CV.cast || [];
    Object.keys(ST).forEach(function (id) { var A = ST[id]; if (CV.cast.some(function (c) { return c.id === id; }) || CAST.some(function (c) { return c.id === id; })) return;
      var at = A.at || [44, 0], w = l2w(at[0], at[1]); if (Math.hypot(w[0] - player.position.x, w[1] - player.position.z) > 160) return;
      var y = SITE.G + (A.stage ? SITE.hall.stage[3] : 0.06); var g = avatar("cast_" + id, A.name, A.look || {}, null, null); g.position.set(w[0], y, w[1]); g.rotation.y = A.face || 0; try { g.userData.label.scale.set(1.7, 0.43, 1); } catch (e) {} scene.add(g);
      var talk = (A.talk || []).map(function (q) { return { t: q.t, o: q.o }; }); var c = { id: id, name: A.name, role: A.role, pos: [w[0], w[1]], look: A.look, hat: null, outfit: null, greet: A.greet || ["Welcome."], talk: talk, kw: [], g: g, rot: g.rotation.y, cvStage: !!A.stage };
      CAST.push(c); var hs = { x: w[0], z: w[1], r: A.stage ? 3.2 : 4, t: c.name, k: c.role + " · press E to talk", p: talk[0] ? talk[0].t : "", play: "npc:" + c.id }; hotspots.push(hs); (CV.hsList = CV.hsList || []).push(hs); CV.cast.push(c); CV.n.staff = CV.cast.length; });
  }

  // ───────────────────────── defer hook: the exterior, the forecourt, the walls, warm-up ─────────────────────────
  var EX = CV.ex = CV.ex || {};
  function signTex() { return panel("monument", 1024, 288, function (x, W, H) { x.fillStyle = "#c9b59a"; x.fillRect(0, 0, W, H); noise(x, W, H, 4000, 0.04, 1, 2, 3); ringWord(x, "SOLPORT", W / 2, 118, 112, 18); txt(x, "CONVENTION CENTER", W / 2, 218, "500 46px " + FONT.wide, "#ffffff", 14); }, false); }
  function deferHook() {
    if (CV.off || !window.PLAN || !SITE) return; var S = SITE, t0 = nowMs(); var step = function (name, fn) { var t = nowMs(); try { fn(); } catch (e) { note(name, e); } CV.n["ms_" + name] = Math.round(nowMs() - t); };
    var M = mats(); var g = EX.g = new THREE.Group(); g.name = "conv_arena"; g.position.set(S.cx, S.G, S.cz); g.userData.noBatch = true;
    var K = new Kit(), solB = [], solF = [];
    step("skin", function () { buildSkin(K); buildRim(K); buildLed(K); });
    step("base", function () { buildBase(K, solB); });
    step("forecourt", function () { buildForecourt(K, solF); });
    step("mesh", function () { var bases = { copper: M.copper, sand: M.sand, frame: M.frame, paint: M.paint, soffit: M.soffit, glass: M.glass, emit: M.emit, fabric: M.fabric, pave: M.pave, dg: M.dg, glow: M.glow, banner: M.banner, led: M.led };
      EX.meshes = K.build(g, bases, { cast: false }); EX.meshes.forEach(function (m) { var b = m.name.slice(3); m.castShadow = b === "copper" || b === "sand" || b === "frame" || b === "fabric" || b === "banner"; m.receiveShadow = b !== "led" && b !== "glow" && b !== "glass"; if (b === "dg" || b === "pave") m.userData.noCull = true; }); EX.tris = Math.round(K.tris);
      if (S.signGeo) { var sm = uplit(std({ map: signTex(), normalMap: ctex("conv_sandstone_n", false), normalScale: new THREE.Vector2(0.05, 0.05), roughness: 0.85, vertexColors: true }), "cv_up", 0.9); sm.name = "cv_sign"; EX.signMat = sm; var sgg = S.signGeo.g; sgg.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(sgg.attributes.position.count * 3).fill(1), 3)); var me = new THREE.Mesh(sgg, sm); me.position.set(S.signGeo.x + 0.03, S.signGeo.y, S.signGeo.z); me.name = "cv sign"; me.receiveShadow = true; g.add(me); }
      buildDoors(g); scene.add(g); g.updateMatrixWorld(true); });
    // the solids: the glass and podium ring (the door gap open), the partition walls, the forecourt's pieces
    step("solids", function () { var list = EX.solids = [];
      solB.forEach(function (q) { var p = glassPt(q[0], 0), w = l2w(p.x, p.z), ry = Math.atan2(-S.a * Math.sin(q[0]), S.b * Math.cos(q[0])); var sd = addSolid(w[0], w[1], ry, q[2], q[1] + 0.15, S.G - 0.3, S.G + S.y0, "conv"); if (sd) list.push(sd); });
      wallSolids(partitionWalls(), list);
      solF.forEach(function (q) { var w = l2w(q.x, q.z); var sd = addSolid(w[0], w[1], q.ry || 0, q.w, q.d, S.G + (q.seat ? q.y1 - 0.4 : q.y0 - 0.2), S.G + q.y1, "conv"); if (sd) { if (q.seat) sd.seat = true; list.push(sd); } }); });
    // lamps through the client's light pool: the entrance under the overhang, the two big sails
    step("lights", function () { EX.lights = []; var add = function (col, k, dist, u, y, v) { var l = new THREE.PointLight(col, 0, dist, 1.3); l.position.set(u, y, v); l.userData.k0 = k; g.add(l); EX.lights.push(l); };
      add(0xffcf96, 9, 28, uAt(0, 1) + 1, 4.6, 0); (S.sails || []).slice(0, 2).forEach(function (p) { add(0xffd9aa, 5, 18, p[0], p[1], p[2]); }); });
    step("perf", function () { perfRooms(); warmSample(); try { if (!lowTier()) [ctex("conv_redstone", true), ctex("conv_redstone_n", false), ctex("conv_sandstone", true), ctex("conv_sandstone_n", false), ctex("conv_copper_n", false), carpetTex(), acousticTex(), whiteTex()].forEach(function (t) { if (t && t.image) renderer.initTexture(t); else if (t) t.onUpdate = null; }); } catch (e) { note("init tex", e); } var W = window.PLAN_PERF; if (W && W.warmGroup) W.warmGroup(g, { name: "conv arena" }); });
    step("near", nearBlock);
    CV.groups = [g]; CV.n.deferMs = Math.round(nowMs() - t0); CV.n.exteriorTris = EX.tris; CV.ready = true;
  }
  function nearBlock() { try { if (typeof NEAR === "undefined" || !NEAR.blocked || NEAR.blocked.cv) return; var b0 = NEAR.blocked; var f = function (x, z) { return inLot(x, z, 1) || b0(x, z); }; f.cv = true; NEAR.blocked = f; NEAR.at = [1e9, 1e9]; CV.n.nearWrap = (CV.n.nearWrap || 0) + 1; } catch (e) { note("near", e); } }
  // every interior material (plain and instanced) on a tiny geometry, compiled behind the loading screen so walking in links nothing
  function warmSample() { try { var B = intMats(), M = mats(), g = new THREE.Group(); g.name = "conv warm"; var geo = new THREE.BoxGeometry(0.1, 0.1, 0.1); var ca = new Float32Array(geo.attributes.position.count * 3).fill(1); geo.setAttribute("color", new THREE.BufferAttribute(ca, 3)); geo.setAttribute("aScr", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
      ["floor", "carpet", "red", "copper", "dark", "paint", "metal", "wood", "fabric", "sand"].forEach(function (k) { var me = new THREE.Mesh(geo, B[k]); me.receiveShadow = true; g.add(me); }); [M.copper].forEach(function (m) { var me = new THREE.Mesh(geo, m); me.receiveShadow = true; g.add(me); }); var im = new THREE.InstancedMesh(geo, B.fabric, 1); im.setColorAt(0, new THREE.Color(1, 1, 1)); im.receiveShadow = true; g.add(im); var bi = new THREE.InstancedMesh(geo, B.beam, 1); bi.setColorAt(0, new THREE.Color(1, 1, 1)); g.add(bi); g.add(new THREE.Mesh(geo, M.glass));
      var gm = M.glow.clone(); g.add(new THREE.Mesh(geo, gm)); var mi = new THREE.InstancedMesh(geo, M.glass, 1); g.add(mi);
      g.position.set(SITE.cx, SITE.G - 50, SITE.cz); if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(g, { name: "conv warm" }); CV.warm = g; } catch (e) { note("warm", e); } }
  // indoor portal culling (plan_perf): the hall is closed but for its two portals; a breakout room is closed but for its door
  function perfRooms() {
    var W = window.PLAN_PERF; if (!W) return; W.rooms = W.rooms || []; if (W.rooms.some(function (r) { return r.name === "convention"; })) return; var S = SITE;
    var frame = function () { return new THREE.Matrix4().makeTranslation(S.cx, S.G, S.cz); };
    var hallK = { perfSig: function () { return 1; }, perfRoom: function (R) { var Hh = S.hall, rects = []; [-1, 1].forEach(function (sd) { rects.push(R("x", sd * Hh.v, Hh.portal[0], Hh.portal[1], -0.2, 3.3)); }); return { kind: "convention hall", M: frame(), boxes: [[Hh.u0 - 0.3, Hh.u1 + 0.3, -1, Hh.top + 0.5, -Hh.v - 0.2, Hh.v + 0.2]], rects: rects, roots: [IT.hall && IT.hall.g, IT.lobby && IT.lobby.g, EX.g].filter(Boolean) }; } };
    var brkK = S.brk.map(function (Bk) { return { perfSig: function () { return 1; }, perfRoom: function (R) { return { kind: "convention " + Bk.id, M: frame(), boxes: [[Bk.u0 - 0.2, S.lobby.u0 - 0.2, -1, 5.5, Bk.v0 - 0.2, Bk.v1 + 0.2]], rects: [R("z", S.lobby.u0, Bk.door - 1.4, Bk.door + 1.4, -0.2, 2.7)], roots: [IT.brk && IT.brk.g, IT.lobby && IT.lobby.g, EX.g].filter(Boolean) }; } }; });
    W.rooms.push({ name: "convention", key: function () { if (!SITE || !CV.ready) return null; var c = camera.position, z = zoneOf(c.x, c.y, c.z); if (z === "hall" && IT.hall) return hallK; if (z === "brk" && IT.brk) { var v = w2l(c.x, c.z)[1]; return v < 0 ? brkK[0] : brkK[1]; } return null; } });
  }

  // ───────────────────────── every frame ─────────────────────────
  function frameHook(dt, now) {
    if (CV.off || !SITE || !CV.ready) return; dt = Math.min(dt || 0.016, 0.1);
    try {
      var n = clamp((nightK() - 0.02) * 3.2, 0, 1); U.uNight.value = n; try { var sd0 = _v1.copy(sun.position).sub(sun.target.position).normalize().y; U.uGold.value = sstep(0.42, 0.05, sd0) * sstep(-0.12, 0.0, sd0); CV.sunEl = sd0; } catch (e) {} U.uTime.value = (U.uTime.value + dt) % 3600; var M = MX;
      M.glow.opacity = 0.55 * n; M.emit.userData.uk.value = -(0.35 + 2.6 * n); M.glass.emissiveIntensity = 0.1 * n;
      var cam = camera.position, dc = distArena(cam.x, cam.z);
      (EX.lights || []).forEach(function (l) { l.intensity = dc < 160 ? l.userData.k0 * n : 0; });
      if (dc < 900) ledFrame(dt);
      var dp = distArena(player.position.x, player.position.z), close = dp < R_LOBBY_DROP;
      if (close) interiorFrame(); else { if (IT.sb) IT.sb = null; ["lobby", "hall", "brk"].forEach(function (k) { if (IT[k]) disposeL(k); }); }
      visFrame();
      var t = U.uTime.value;
      ["lobby", "hall", "brk"].forEach(function (k) { var L = IT[k]; if (!L) return; var on = L.g.visible; L.lights.forEach(function (l) { l.intensity = on ? l.userData.k0 * (k === "lobby" ? 0.55 + 0.6 * n : 1) : 0; }); });
      if (nowMs() > (FR.modAt || 0)) { FR.modAt = nowMs() + 2000; ["lobby", "hall", "brk"].forEach(function (k) { var L = IT[k]; if (L && L.pending && L.pending.length) { var p = L.pending; L.pending = []; L.models = (L.models || []).concat(modelSet(L.g, p, L)); } }); }
      if (IT.hall && IT.hall.g.visible) { beamFrame(IT.hall, t); IU.uPulse.value = Math.sin(t * 0.9) * 0.5 + Math.sin(t * 2.3) * 0.5; IT.hall.beams.im.material.uniforms.uK.value = 1; }
      if (dp < 40 || dc < 200) doorFrame(dt); if (dp < 120 && (FR.nb = (FR.nb || 0) + 1) % 60 === 0) nearBlock();
      if (close) { seatPool(); sitFrame(); }
      if (nowMs() > (FR.staffAt || 0)) { FR.staffAt = nowMs() + 2000; try { buildStaff(); } catch (e) { note("staff", e); } }
      (CV.cast || []).forEach(function (c) { var dd = Math.hypot(c.g.position.x - cam.x, c.g.position.z - cam.z); c.g.visible = c.cvStage ? !!(IT.hall && IT.hall.g.visible) && dd < 80 : dd < 60 && (!CV.zone || CV.zone === "lobby" || CV.zone === "corr"); });
      if (!FR.stamped && zoneOf(player.position.x, player.position.y + 1, player.position.z)) { FR.stamped = true; stamp(C("progress.arena", "p_solport_arena")); }
    } catch (e) { note("frame", e); }
  }
  function initIU() { var S = SITE, st = S.hall.stage; IU.uCtr.value.set(S.cx, S.G, S.cz); IU.uFl.value = S.G; var w = l2w(st[0] + 3, 0); IU.uSP.value.set(w[0], S.G + 7.5, w[1]); IU.uHall.value.set(S.hall.u0, S.hall.u1, S.hall.v, 0); }

  // ───────────────────────── hooks, API, debug ─────────────────────────
  CV.impl = { handleE: handleE, frame: frameHook, cam: camHook };
  CV.api = { resolveSite: resolveSite, l2w: l2w, w2l: w2l, zoneOf: zoneOf, watchKeynote: watchKeynote, seatList: seatList, prof: prof, surf: surf, roam: roamApi };
  CV.debug = {
    // a camera in the arena frame: eye (u, y, v) looking at (tu, ty, tv), heights above the pad
    cam: function (u, y, v, tu, ty, tv, fov) { var a = l2w(u, v), b = l2w(tu, tv); window.__cam = [a[0], SITE.G + y, a[1], b[0], SITE.G + ty, b[1], fov || 0]; try { player.visible = false; if (player.userData.label) player.userData.label.visible = false; } catch (e) {} try { updateCulling(true); } catch (e) {} return window.__cam; },
    show: function () { try { player.visible = true; player.traverse(function (o) { if (o.isSprite) o.visible = true; }); var tr = document.getElementById("tr"); if (tr) tr.style.display = ""; } catch (e) {} window.__cam = null; return true; },
    hide: function () { try { player.visible = false; player.traverse(function (o) { if (o.isSprite) o.visible = false; }); var tr = document.getElementById("tr"); if (tr) tr.style.display = "none"; } catch (e) {} return true; },
    led: function (m) { LED.mode = LED.prev = m | 0; LED.t0 = nowMs() / 1000; LED.mix = 1; return m; },
    at: function (u, v, y, yawW) { var w = l2w(u, v); player.position.set(w[0], SITE.G + (y || 0) + 0.02, w[1]); if (yawW !== undefined) yaw = yawW; return [w[0], w[1]]; },
    build: function (k) { var map = { lobby: [buildLobbySteps, "conv lobby"], hall: [buildHallSteps, "conv hall"], brk: [buildBreakSteps, "conv breakouts"] }; var q = map[k]; if (!q || IT[k]) return !!IT[k]; var L = newL(q[1]), it = q[0](L), r, ts = [], t1; do { t1 = nowMs(); r = it.next(); ts.push(+(nowMs() - t1).toFixed(1)); } while (!r.done); IT[k] = finishL(L, q[1]); return { steps: ts, tris: L.tris, meshes: L.meshes.length }; },
    drop: function (k) { disposeL(k); return true; },
    counts: function () { var o = {}; ["lobby", "hall", "brk"].forEach(function (k) { var L = IT[k]; if (!L) return; var m = 0, tr = 0; L.g.traverse(function (q) { if (q.isMesh) { m++; var gi = q.geometry; var t = gi.index ? gi.index.count / 3 : gi.attributes.position.count / 3; tr += q.isInstancedMesh ? t * q.count : t; } }); o[k] = { meshes: m, tris: Math.round(tr), solids: L.solids.length, vis: L.g.visible }; }); var em = 0, et = 0; EX.g.traverse(function (q) { if (q.isMesh) { em++; var gi = q.geometry; var t = gi.index ? gi.index.count / 3 : gi.attributes.position.count / 3; et += q.isInstancedMesh ? t * q.count : t; } }); o.exterior = { meshes: em, tris: Math.round(et), solids: (EX.solids || []).length }; o.seats = seatList().length; o.people = 0; return o; }
  };
  (function hookAll() {
    var set = function (phase, name, fn) { var list = window.PLAN_HOOKS[phase]; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name: name, fn: fn }); };
    set("world", "convWorld", function () { worldHook(); });
    set("terrain", "convTerrain", function () { terrainHook(); if (SITE) initIU(); });
    set("defer", "convDefer", function () { deferHook(); });
    set("frame", "convFrame", function (dt, now) { CV.impl.frame(dt, now); });
    set("interior", "convCam", function (dt) { return CV.impl.cam(dt); });
  })();
  // R15 (plan_roomlight.js, HANDOFF_R15_ROOMLIGHT.md): the keynote hall takes the interior light kit while the camera is in it: its own
  // pooled lights only, the look
  (window.PLAN_RLQ = window.PLAN_RLQ || []).push({ walk: true, id: "keynote", find: function (RL) {
    if (CV.off || !SITE || !CV.ready || CV.zone !== "hall" || !IT.hall || !IT.hall.g) return null; var R = IT.hall.rlRoom; if (R) return R; var H = SITE.hall;
    R = IT.hall.rlRoom = new RL.Room({ id: "keynote", type: "keynote", mod: "walk", M: new THREE.Matrix4().makeTranslation(SITE.cx, SITE.G, SITE.cz), box: [H.u0 - 1, H.u1 + 1, -1, (H.top || H.ceil) + 2, -H.v - 1, H.v + 1], capRoot: IT.hall.g, own: true, env: false }); R.noShaft = true; R.noDoorShaft = true; return R; } });
})();
