// R7 MARKET (2 Oct 2026): the Market Hall and the Weekend Market of the Solport Convention Center campus.
//   - the Market Hall (x -465..-140, z 8..46): a glass galleria 325 m long on 41 arched glulam timber ribs, the long axis east-west,
//     glazed ends toward the mountains, two walk-in levels: a ground floor of food stalls and artisans behind copper and sandstone
//     shopfronts, mezzanine restaurant terraces with railings, planter boxes and trailing plants, four stairs; big clay planters of
//     agave, ocotillo, desert grasses and small trees down the travertine nave, globe pendants, partner kiosks, a busker corner, a
//     crowd of shoppers, vendors and diners (posed people baked from the client's own rigs, instanced, two LODs) and a few live
//     vendors and walkers (client avatars). Five entrances open north onto the stalls and the festival grounds.
//   - the Weekend Market (x -465..-250, z -18..0): two rows of canopy stalls facing an aisle (produce, crafts, coffee, textiles,
//     pottery, flowers, baskets and the Giveback merch stand) under festoons of string lights, crates and baskets.
//   - night: the glass glows warm from inside (emissive, no new lights; a few lamps go through the client's light pool).
// Classic script, loaded before client.js; hooks into window.PLAN_HOOKS { terrain, world, defer, frame, interior }. Every name, line
// of copy and size: plan/market.json. ?market=0 turns the module off. window.PLAN_MARKET: n (counters), errs, cfg, site, api, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var MK = window.PLAN_MARKET = window.PLAN_MARKET || {};
  MK.errs = MK.errs || []; MK.n = MK.n || {}; MK.ver = "r7";
  if (/[?&]market=0\b/.test(location.search)) { MK.off = true; return; }
  var PI = Math.PI, TAU = PI * 2;
  function note(tag, e) { try { if (MK.errs.length < 50) MK.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (MK.errs.length <= 6) console.warn("plan_market " + tag, e); } catch (x) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function nowMs() { return performance.now(); }
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function canPut(k) { try { return !!(MODELS[k] && MODEL_SPECS[k]); } catch (e) { return false; } }
  function $id(id) { return document.getElementById(id); }

  // ───────────────────────── config: plan/market.json ─────────────────────────
  var CFG = MK.cfg || null;
  function cfgUrl() { var u = "/plan/market.json?v=" + (window.BUILD || "dev"); try { if (window.AV) u = window.AV(u); } catch (e) {} return u; }
  if (!CFG) { try { fetch(cfgUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && !CFG) CFG = MK.cfg = d; }).catch(function (e) { note("cfg fetch", e); }); } catch (e) { note("cfg", e); } }
  function cfg() {
    if (CFG) return CFG;
    try { var x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = MK.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); }
    return CFG;
  }
  function C(path, dflt) { var o = cfg(); if (!o) return dflt; var p = path.split("."); for (var i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }

  // ───────────────────────── the site: every dimension of the hall and the stalls (world metres; y from the hall floor) ─────────────────────────
  // z of a line at distance d from the nave centre line on side s (s = -1 north, +1 south); the north side is the side of the stalls
  var S = null;
  function site() {
    if (S) return S; var h = C("hall", {}), st = C("stalls", {});
    S = MK.site = { X0: h.x0 || -465, X1: h.x1 || -140, ZN: h.z0 || 8, ZS: h.z1 || 46, NB: h.bays || 40 };
    S.L = S.X1 - S.X0; S.B = S.L / S.NB; S.ZC = (S.ZN + S.ZS) / 2; S.HW = (S.ZS - S.ZN) / 2;          // half width 19
    S.DF = S.HW - (h.front || 9);          // the shopfront line, 10 m from the centre line (the nave is 20 m wide)
    S.DB = S.DF + (h.shopDepth || 5);       // the back wall of the ground shops and the front of the upper restaurants
    S.DE = S.DF - (h.cant || 1.8);          // the mezzanine edge (the cantilever past the columns)
    S.MZ = h.mezz || 5.2; S.RS = h.soffit || 10.6; S.RT = h.roof || 11.2; S.RISE = h.rise || 8.6;
    S.FL = 0.4;                              // the hall floor stands 0.4 m over the graded pad (the entrances have a low threshold)
    S.ENT = (h.entrances || [5, 13, 20, 27, 35]).slice(); S.STAIRS = (h.stairs || []).map(function (q) { return { bay: q[0], s: q[1] }; });
    S.sx0 = st.x0 || -465; S.sx1 = st.x1 || -250; S.sz0 = st.z0 || -18; S.sz1 = st.z1 || 0; S.pitch = st.pitch || 4.6; S.gaps = (st.gaps || []).slice();
    S.G = null;                              // the pad level (set by the terrain hook)
    S.zs = function (s, d) { return S.ZC + s * d; };
    S.bx = function (i) { return S.X0 + i * S.B; };                 // the rib line i (0..NB)
    S.bc = function (i) { return S.X0 + (i + 0.5) * S.B; };         // the middle of bay i
    S.bayOf = function (x) { return Math.floor((x - S.X0) / S.B); };
    S.inHall = function (x, z, m) { m = m || 0; return x > S.X0 - m && x < S.X1 + m && z > S.ZN - m && z < S.ZS + m; };
    S.inStalls = function (x, z, m) { m = m || 0; return x > S.sx0 - m && x < S.sx1 + m && z > S.sz0 - m && z < S.sz1 + m; };
    // stairs: a straight run along the mezzanine edge in the nave; bottom at x0, rising toward -x on the north (s -1) and +x on the south
    S.stairs = S.STAIRS.map(function (q) { var n = 29, run = 0.29, L = n * run, w = 2.0; var north = q.s < 0; var xb = north ? S.bx(q.bay + 1) - 0.4 : S.bx(q.bay) + 0.4; var dir = north ? -1 : 1; var zIn = S.zs(q.s, S.DE) - q.s * 0.05; return { bay: q.bay, s: q.s, n: n, run: run, L: L, w: w, xb: xb, dir: dir, zIn: zIn, zOut: zIn - q.s * w, xt: xb + dir * L, xl: xb + dir * (L + 2.1) }; });
    return S;
  }
  // the y of the hall floor (world) and of the mezzanine deck
  function YF() { return S.G + S.FL; }
  function YM() { return S.G + S.FL + S.MZ; }

  // ───────────────────────── geometry kit: parts in a frame, coloured per vertex, merged per base material ─────────────────────────
  // Every part carries its own colour as a vertex colour, so a whole prefab draws with one call per base. Textured bases get
  // world-scale planar uvs (t metres a repeat) from each face's dominant axis, so stone, earth and wood read at a true scale.
  var _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _c = new THREE.Color();
  var TILE = { trav: 1.6, floor: 2.4, earth: 3.2, wood: 1.4, plank: 1.4, wick: 0.7, leaf: 0, plain: 0, metal: 0, glass: 0, vglass: 0, glow: 0, win: 0 };
  function Kit() { this.m = {}; this.tris = 0; }
  Kit.prototype.add = function (base, g, col, keepUv) {
    if (g.index) g = g.toNonIndexed(); if (!g.attributes.normal) g.computeVertexNormals();
    var n = g.attributes.position.count, P = g.attributes.position.array, t = TILE[base];
    if (t && !keepUv) { var U = new Float32Array(n * 2); for (var f = 0; f < n; f += 3) { var ax = P[f * 3], ay = P[f * 3 + 1], az = P[f * 3 + 2]; var e1x = P[f * 3 + 3] - ax, e1y = P[f * 3 + 4] - ay, e1z = P[f * 3 + 5] - az, e2x = P[f * 3 + 6] - ax, e2y = P[f * 3 + 7] - ay, e2z = P[f * 3 + 8] - az; var nx = Math.abs(e1y * e2z - e1z * e2y), ny = Math.abs(e1z * e2x - e1x * e2z), nz = Math.abs(e1x * e2y - e1y * e2x);
        for (var k = 0; k < 3; k++) { var i = f + k, x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; if (ny >= nx && ny >= nz) { U[i * 2] = x / t; U[i * 2 + 1] = z / t; } else if (nx >= nz) { U[i * 2] = z / t; U[i * 2 + 1] = y / t; } else { U[i * 2] = x / t; U[i * 2 + 1] = y / t; } } }
      g.setAttribute("uv", new THREE.BufferAttribute(U, 2)); }
    else if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!(col === null && g.attributes.color)) { var Cc = new Float32Array(n * 3); _c.set(col === undefined || col === null ? 0xffffff : col); for (var j = 0; j < n; j++) { Cc[j * 3] = _c.r; Cc[j * 3 + 1] = _c.g; Cc[j * 3 + 2] = _c.b; } g.setAttribute("color", new THREE.BufferAttribute(Cc, 3)); } (this.m[base] || (this.m[base] = [])).push(g); this.tris += n / 3; return g;
  };
  // place a geometry: rotate (ry, then rx, rz), scale, translate
  function xf(g, x, y, z, ry, rx, rz, sx, sy, sz) { _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(x || 0, y || 0, z || 0), _q, _v2.set(sx || 1, sy || 1, sz || 1)); g.applyMatrix4(_m4); return g; }
  // a box with its base at y0 (w along x, d along z)
  Kit.prototype.box = function (base, col, w, h, d, x, y0, z, ry, rx, rz) { if (!(w > 0 && h > 0 && d > 0)) return null; var g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); return this.add(base, xf(g, x, y0, z, ry, rx, rz), col); };
  // a box between two x and z bounds (axis aligned)
  Kit.prototype.aab = function (base, col, x0, x1, y0, y1, z0, z1) { return this.box(base, col, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, Math.min(y0, y1), (z0 + z1) / 2); };
  Kit.prototype.cyl = function (base, col, r0, r1, h, x, y0, z, seg, ry, rx, rz, open) { var g = new THREE.CylinderGeometry(r0, r1, h, seg || 12, 1, !!open); g.translate(0, h / 2, 0); return this.add(base, xf(g, x, y0, z, ry, rx, rz), col); };
  Kit.prototype.sph = function (base, col, r, x, y, z, seg, sx, sy, sz) { var g = new THREE.SphereGeometry(r, seg || 10, Math.max(4, (seg || 10) >> 1)); return this.add(base, xf(g, x, y, z, 0, 0, 0, sx, sy, sz), col); };
  Kit.prototype.ico = function (base, col, r, x, y, z, sx, sy, sz, ry) { var g = new THREE.IcosahedronGeometry(r, 0); return this.add(base, xf(g, x, y, z, ry || 0, 0, 0, sx, sy, sz), col); };
  // a turned shape from a profile [[r, y], ...] bottom to top
  Kit.prototype.lathe = function (base, col, prof, x, y0, z, seg, sx, sz) { var pts = prof.map(function (p) { return new THREE.Vector2(Math.max(0.0001, p[0]), p[1]); }); var g = new THREE.LatheGeometry(pts, seg || 14); return this.add(base, xf(g, x, y0, z, 0, 0, 0, sx || 1, 1, sz || sx || 1), col); };
  // a quad (w x h) centred at (x, y, z), its face toward +z before the rotation
  Kit.prototype.quad = function (base, col, w, h, x, y, z, ry, rx, keepUv, u0, v0, u1, v1) { var g = new THREE.PlaneGeometry(w, h); if (keepUv) { var uv = g.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, lerp(u0, u1, uv.getX(i)), lerp(v0, v1, uv.getY(i))); } return this.add(base, xf(g, x, y, z, ry, rx), col, keepUv); };
  // a beam (box) from A to B with a cross section w x d (d along the up of the beam's frame)
  Kit.prototype.beam = function (base, col, A, B, w, d) { var dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L = Math.sqrt(dx * dx + dy * dy + dz * dz); if (L < 1e-4) return null; var g = new THREE.BoxGeometry(w, d, L); _v1.set(dx / L, dy / L, dz / L); _q.setFromUnitVectors(_v2.set(0, 0, 1), _v1); _m4.compose(_v3.set((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2), _q, _v2.set(1, 1, 1)); g.applyMatrix4(_m4); return this.add(base, g, col); };
  Kit.prototype.tube = function (base, col, A, B, r, seg) { var dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L = Math.sqrt(dx * dx + dy * dy + dz * dz); if (L < 1e-4) return null; var g = new THREE.CylinderGeometry(r, r, L, seg || 6, 1, true); _v1.set(dx / L, dy / L, dz / L); _q.setFromUnitVectors(_v2.set(0, 1, 0), _v1); _m4.compose(_v3.set((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2), _q, _v2.set(1, 1, 1)); g.applyMatrix4(_m4); return this.add(base, g, col); };
  // a triangle list (flat [x, y, z] triples)
  Kit.prototype.tris3 = function (base, col, pts) { var g = new THREE.BufferGeometry(); var a = new Float32Array(pts.length * 3); for (var i = 0; i < pts.length; i++) { a[i * 3] = pts[i][0]; a[i * 3 + 1] = pts[i][1]; a[i * 3 + 2] = pts[i][2]; } g.setAttribute("position", new THREE.BufferAttribute(a, 3)); g.computeVertexNormals(); return this.add(base, g, col); };
  Kit.prototype.quad4 = function (base, col, a, b, c, d) { return this.tris3(base, col, [a, b, c, a, c, d]); };
  // apply a matrix to every part added since mark (prefab pieces placed into a larger kit)
  Kit.prototype.mark = function () { var o = {}; for (var k in this.m) o[k] = this.m[k].length; return o; };
  Kit.prototype.since = function (mk, fn) { for (var k in this.m) for (var i = mk[k] || 0; i < this.m[k].length; i++) fn(this.m[k][i], k); };
  function mergeList(list) {
    var n = 0; list.forEach(function (g) { n += g.attributes.position.count; }); if (!n) return null;
    var P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), Cc = new Float32Array(n * 3), o = 0;
    list.forEach(function (g) { var c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); U.set(g.attributes.uv.array, o * 2); Cc.set(g.attributes.color.array, o * 3); o += c; g.dispose(); });
    var r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(U, 2)); r.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
    r.computeBoundingBox(); r.computeBoundingSphere(); return r;
  }
  Kit.prototype.merged = function () { var out = {}; for (var k in this.m) { var g = mergeList(this.m[k]); if (g) out[k] = g; } this.m = {}; return out; };
  // a prefab (base -> geometry) drawn as instanced meshes, one per base: every mesh in the module is an InstancedMesh, so each base
  // material only ever compiles its instanced program (fewer programs); list = [[x, y, z, ry, sx, sy, sz], ...] in the group frame
  function instGroup(name, pre, list, opt) {
    opt = opt || {}; var g = new THREE.Group(); g.name = name; g.userData.noCull = true; var n = Math.max(1, list.length);
    for (var b in pre) { var geo = pre[b]; var im = new THREE.InstancedMesh(geo, MAT[b] || MAT.plain, n); im.name = name + ":" + b;
      for (var i = 0; i < list.length; i++) { var q = list[i]; _e.set(0, q[3] || 0, 0); _q.setFromEuler(_e); _m4.compose(_v1.set(q[0], q[1], q[2]), _q, _v2.set(q[4] || 1, q[5] || q[4] || 1, q[6] || q[4] || 1)); im.setMatrixAt(i, _m4); }
      if (!list.length) im.count = 0; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      var shadow = opt.cast && (opt.cast === true || opt.cast.indexOf(b) >= 0) && b !== "glass" && b !== "glow" && b !== "win"; im.castShadow = !!shadow; im.receiveShadow = b !== "glow" && b !== "glass" && b !== "win";
      if (b === "glass") im.renderOrder = 2; g.add(im); MK.n.tris = (MK.n.tris || 0) + (geo.attributes.position.count / 3) * list.length; MK.n.meshes = (MK.n.meshes || 0) + 1; }
    return g;
  }
  function one(x, y, z, ry) { return [[x || 0, y || 0, z || 0, ry || 0]]; }

  // ───────────────────────── materials: few bases, shared by everything in the module (stable programs) ─────────────────────────
  // Textured bases (travertine, rammed earth, glulam, wicker) share one program: map + normal + roughness maps, vertex colours, and
  // the albedo as emissive map (after dark a warm fill lifts every surface inside, as if lit by the lamps: no lights of their own).
  // plain and metal share one untextured program. glass, glow (unlit bulbs, lit windows), signs and people have one each.
  var MAT = MK.mat = {}, WARM = new THREE.Color(0xffa24e);
  function texMat(name, nk, rough, metal, map0, nrm) {
    var t = function (p) { try { return tiled(p, 1, 1); } catch (e) { return null; } };
    var nb = nrm || name, map = map0 || t("/tex/" + name + ".jpg"), m = new THREE.MeshStandardMaterial({ map: map, normalMap: t("/tex/" + nb + "_n.jpg"), roughnessMap: t("/tex/" + nb + "_r.jpg"), emissiveMap: map, emissive: WARM.clone(), emissiveIntensity: 0, vertexColors: true, roughness: rough || 1, metalness: metal || 0 });
    if (m.normalScale) m.normalScale.set(nk || 0.7, nk || 0.7); m.name = "mk_" + name; return m;
  }
  // drawn textures: rammed earth (fine horizontal strata of sand, ochre and umber) and glulam (honey timber, laminations along v)
  function canvasTex(name, size, draw) { var c = document.createElement("canvas"); c.width = c.height = size; draw(c.getContext("2d"), size); var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.name = name; return t; }
  function earthTex() { return canvasTex("rammed", 1024, function (x, N) { var R = rng(1977), cols = ["#cba887", "#bb926e", "#d4b391", "#ae8765", "#c49e7b", "#dbc09f", "#b48c69"], y = 0;
      while (y < N) { var h = 10 + R() * 34, c = cols[Math.floor(R() * cols.length)], a = R() * 6, f = 1 + Math.floor(R() * 3); x.fillStyle = c; x.beginPath(); x.moveTo(0, y); for (var i = 0; i <= 32; i++) x.lineTo(i * N / 32, y + Math.sin(i / 32 * TAU * f + a) * 2.2); for (var j = 32; j >= 0; j--) x.lineTo(j * N / 32, y + h + Math.sin(j / 32 * TAU * f + a + 1) * 2.2); x.closePath(); x.fill();
        x.fillStyle = "rgba(60,35,20,0.10)"; x.fillRect(0, y + h - 1.5, N, 1.5); y += h; }
      for (var k = 0; k < 9000; k++) { var l = R(); x.fillStyle = l < 0.5 ? "rgba(70,45,28," + (0.06 + R() * 0.12) + ")" : "rgba(255,240,220," + (0.05 + R() * 0.1) + ")"; var s = 1 + R() * 2.5; x.fillRect(R() * N, R() * N, s, s * (0.6 + R())); }
      for (var p = 0; p < 160; p++) { x.fillStyle = "rgba(" + (110 + R() * 60 | 0) + "," + (85 + R() * 40 | 0) + "," + (65 + R() * 30 | 0) + ",0.55)"; x.beginPath(); x.ellipse(R() * N, R() * N, 2 + R() * 5, 1.5 + R() * 3.5, R() * 3, 0, TAU); x.fill(); } }); }
  function glulamTex() { return canvasTex("glulam", 512, function (x, N) { var R = rng(3109); x.fillStyle = "#c99e74"; x.fillRect(0, 0, N, N); var lam = 12, w = N / lam;
      for (var i = 0; i < lam; i++) { var g = x.createLinearGradient(i * w, 0, (i + 1) * w, 0), base = [204 + (R() - 0.5) * 22, 158 + (R() - 0.5) * 20, 112 + (R() - 0.5) * 16]; g.addColorStop(0, "rgb(" + (base[0] - 14 | 0) + "," + (base[1] - 14 | 0) + "," + (base[2] - 10 | 0) + ")"); g.addColorStop(0.5, "rgb(" + (base[0] | 0) + "," + (base[1] | 0) + "," + (base[2] | 0) + ")"); g.addColorStop(1, "rgb(" + (base[0] - 10 | 0) + "," + (base[1] - 10 | 0) + "," + (base[2] - 8 | 0) + ")"); x.fillStyle = g; x.fillRect(i * w, 0, w, N); x.fillStyle = "rgba(110,62,30,0.35)"; x.fillRect(i * w, 0, 1.2, N); }
      for (var k = 0; k < 900; k++) { var gx = R() * N, gy = R() * N, L = 20 + R() * 120; x.strokeStyle = "rgba(" + (R() < 0.5 ? "140,82,40" : "240,200,150") + "," + (0.06 + R() * 0.1) + ")"; x.lineWidth = 0.6 + R() * 1.2; x.beginPath(); x.moveTo(gx, gy); x.bezierCurveTo(gx + (R() - 0.5) * 4, gy + L / 3, gx + (R() - 0.5) * 4, gy + 2 * L / 3, gx + (R() - 0.5) * 3, gy + L); x.stroke(); }
      for (var q = 0; q < 14; q++) { x.fillStyle = "rgba(120,70,35,0.25)"; x.beginPath(); x.ellipse(R() * N, R() * N, 2 + R() * 3, 6 + R() * 10, 0, 0, TAU); x.fill(); } }); }
  function mats() {
    if (MAT.ready) return MAT; MAT.ready = true;
    MAT.trav = texMat("travertine", 0.45, 0.7); MAT.floor = texMat("mkt_floor", 0.32, 0.36, 0, (function () { try { return tiled("/tex/mkt_floor.jpg", 1, 1); } catch (e) { return null; } })(), "travertine"); MAT.earth = texMat("rammed", 0.5, 1, 0, earthTex(), "travertine"); MAT.wood = texMat("glulam", 0.35, 0.72, 0, glulamTex(), "travertine"); MAT.plank = texMat("wood", 0.6, 0.9); MAT.wick = texMat("wicker", 0.8, 1);
    ["trav", "earth", "wood", "plank", "wick"].forEach(function (k) { MAT[k].envMapIntensity = 0.55; }); MAT.floor.envMapIntensity = 1.0;
    var tx = function (p) { try { var t = tiled(p, 1, 1); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; } catch (e) { return null; } };
    // stocked shelves (generated): 2 x 3 tiles, pottery, textiles, produce, spices and pantry, bakery, coffee
    var stk = tx("/tex/mkt_stock.jpg"); MAT.stock = new THREE.MeshStandardMaterial({ map: stk, emissiveMap: stk, emissive: 0xffd6a8, emissiveIntensity: 0.22, roughness: 0.82, metalness: 0, envMapIntensity: 0.4 }); MAT.stock.name = "mk_stock";
    // foliage cards (generated, alpha): trailing vines, a grass clump, mixed planter greenery
    var fol = tx("/tex/mkt_foliage.png"); MAT.leaf = new THREE.MeshStandardMaterial({ map: fol, alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, roughness: 0.78, metalness: 0, envMapIntensity: 0.45 }); MAT.leaf.name = "mk_leaf";
    MAT.plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0, emissive: WARM.clone(), emissiveIntensity: 0, envMapIntensity: 0.55 }); MAT.plain.name = "mk_plain";
    MAT.metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6, emissive: WARM.clone(), emissiveIntensity: 0, envMapIntensity: 0.7 }); MAT.metal.name = "mk_metal";
    MAT.glass = new THREE.MeshStandardMaterial({ color: 0xd2e8ee, roughness: 0.05, metalness: 0.25, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, emissive: new THREE.Color(0xff8a3a), emissiveIntensity: 0, envMapIntensity: 0.7 }); MAT.glass.name = "mk_glass"; MAT.glass.forceSinglePass = true; MAT.vglass = MAT.glass.clone(); MAT.vglass.name = "mk_vglass"; MAT.vglass.emissive = new THREE.Color(0xff7a2a);
    MAT.glow = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff }); MAT.glow.name = "mk_glow"; MAT.win = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff }); MAT.win.name = "mk_win";
    MAT.sign = new THREE.MeshStandardMaterial({ map: atlas().tex, emissiveMap: atlas().tex, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.55, metalness: 0.15, transparent: false }); MAT.sign.name = "mk_sign";
    return MAT;
  }

  // ───────────────────────── the sign atlas: shop fascias, menus, kiosks, stall boards (one canvas, one texture) ─────────────────────────
  var ATL = null;
  function atlas() {
    if (ATL) return ATL; var W = 2048, H = 2560; var cv = document.createElement("canvas"); cv.width = W; cv.height = H; var x = cv.getContext("2d");
    x.fillStyle = "#3a2618"; x.fillRect(0, 0, W, H);
    var tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    ATL = MK.atlas = { cv: cv, x: x, tex: tex, W: W, H: H, cx: 0, cy: 0, rh: 0, slots: {}, draws: [] };
    return ATL;
  }
  // a rect of w x h px; returns uv [u0, v0, u1, v1] (v counted from the bottom: the canvas texture is flipped on upload)
  function slot(key, w, h, draw) {
    var A = atlas(); if (A.slots[key]) return A.slots[key]; if (A.cx + w > A.W) { A.cx = 0; A.cy += A.rh; A.rh = 0; } if (A.cy + h > A.H) { note("atlas", "full at " + key); return [0, 0, 0.01, 0.01]; }
    var px = A.cx, py = A.cy; A.cx += w; A.rh = Math.max(A.rh, h); var r = [px / A.W, 1 - (py + h) / A.H, (px + w) / A.W, 1 - py / A.H]; r.px = [px, py, w, h]; A.slots[key] = r;
    var f = function () { A.x.save(); A.x.beginPath(); A.x.rect(px, py, w, h); A.x.clip(); A.x.translate(px, py); try { draw(A.x, w, h); } catch (e) { note("sign " + key, e); } A.x.restore(); };
    A.draws.push(f); f(); A.tex.needsUpdate = true; return r;
  }
  var SERIF = "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif", SANS = "'Space Grotesk', 'Segoe UI', system-ui, sans-serif", DISP = "Anton, Impact, 'Arial Narrow', sans-serif";
  function spaced(x, s, cx, cy, font, col, sp, maxW) { x.font = font; var w = 0, ch = s.split(""); ch.forEach(function (c) { w += x.measureText(c).width + sp; }); w -= sp; var k = maxW && w > maxW ? maxW / w : 1; x.save(); x.translate(cx, cy); x.scale(k, 1); x.fillStyle = col; var p = -w / 2; ch.forEach(function (c) { x.fillText(c, p, 0); p += x.measureText(c).width + sp; }); x.restore(); }
  function copperBg(x, w, h, dark) { var g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, dark ? "#5a3420" : "#9c5a33"); g.addColorStop(0.5, dark ? "#6e4027" : "#b8703f"); g.addColorStop(1, dark ? "#4a2a1a" : "#8a4c2a"); x.fillStyle = g; x.fillRect(0, 0, w, h);
    var R = rng(w * 7 + h); for (var i = 0; i < 140; i++) { x.fillStyle = "rgba(" + (R() < 0.5 ? "40,20,10" : "255,210,170") + "," + (0.03 + R() * 0.05) + ")"; x.fillRect(R() * w, R() * h, 2 + R() * 30, 1 + R() * 3); }
    x.strokeStyle = "rgba(255,220,180,0.35)"; x.lineWidth = 2; x.strokeRect(3, 3, w - 6, h - 6); }
  function fasciaSlot(name, tag, dark) { return slot("f:" + name, 512, 80, function (x, w, h) { copperBg(x, w, h, dark); x.textBaseline = "middle"; x.shadowColor = "rgba(0,0,0,0.45)"; x.shadowBlur = 3; spaced(x, name.toUpperCase(), w / 2, h * 0.42, "600 34px " + SERIF, "#f7ead6", 3.2, w - 40); x.shadowBlur = 0; if (tag) spaced(x, tag, w / 2, h * 0.8, "600 12px " + SANS, "#f3dcc0", 2.2, w - 60); }); }
  function menuSlot(key, title, lines) { return slot("m:" + key, 192, 240, function (x, w, h) { x.fillStyle = "#1d211f"; x.fillRect(0, 0, w, h); var R = rng(title.length * 13); for (var i = 0; i < 220; i++) { x.fillStyle = "rgba(255,255,255," + (R() * 0.04) + ")"; x.fillRect(R() * w, R() * h, 1 + R() * 18, 1 + R() * 2); }
      x.strokeStyle = "#7a5535"; x.lineWidth = 10; x.strokeRect(5, 5, w - 10, h - 10); x.textBaseline = "middle"; spaced(x, "MENU", w / 2, 28, "400 24px " + DISP, "#f4e9c8", 3, w - 40); x.fillStyle = "rgba(244,233,200,0.5)"; x.fillRect(30, 46, w - 60, 2);
      (lines || []).slice(0, 6).forEach(function (l, i) { x.textAlign = "left"; x.font = "600 15px " + SANS; x.fillStyle = i % 2 ? "#f2d79a" : "#f4f1e8"; x.fillText(l, 22, 70 + i * 28); }); x.textAlign = "start"; }); }
  function kioskSlot(K) { return slot("k:" + K.id, 512, 128, function (x, w, h) { x.fillStyle = K.col || "#1d2a44"; x.fillRect(0, 0, w, h); x.fillStyle = K.acc || "#f4cd5a"; x.fillRect(0, h - 12, w, 12); x.textBaseline = "middle"; spaced(x, K.name.toUpperCase(), w / 2, h * 0.42, "600 42px " + SANS, "#ffffff", 3, w - 40); spaced(x, K.tag || "", w / 2, h * 0.76, "600 15px " + SANS, K.acc || "#f4cd5a", 3, w - 60); }); }
  function boardSlot(name, bg, fg) { return slot("b:" + name, 256, 64, function (x, w, h) { x.fillStyle = bg || "#efe4cf"; x.fillRect(0, 0, w, h); x.strokeStyle = "rgba(60,40,20,0.6)"; x.lineWidth = 4; x.strokeRect(2, 2, w - 4, h - 4); x.textBaseline = "middle"; spaced(x, name.toUpperCase(), w / 2, h / 2 + 1, "600 25px " + SERIF, fg || "#4a2c18", 1.5, w - 20); }); }
  function hallSlot() { return slot("hall", 1024, 160, function (x, w, h) { copperBg(x, w, h, true); x.textBaseline = "middle"; x.shadowColor = "rgba(0,0,0,0.5)"; x.shadowBlur = 4; spaced(x, (C("names.hall", "Market Hall")).toUpperCase(), w / 2, h * 0.42, "600 78px " + SERIF, "#f7ead6", 10, w - 80); x.shadowBlur = 0; spaced(x, (C("names.campus", "Solport Convention Center")).toUpperCase(), w / 2, h * 0.82, "600 22px " + SANS, "#f1c998", 6, w - 120); }); }
  function logoSlot() { return slot("gb", 512, 160, function (x, w, h) { x.fillStyle = "#123a22"; x.fillRect(0, 0, w, h); x.fillStyle = "#4DDE6F"; x.fillRect(0, h - 10, w, 10); x.textBaseline = "middle"; spaced(x, "MERCH", 392, h * 0.4, "400 50px " + DISP, "#f5f1e6", 5, 200); spaced(x, "FOOD DRIVE", 392, h * 0.72, "600 15px " + SANS, "#4DDE6F", 3, 200);
      var img = new Image(); img.onload = function () { try { var p = slot("gb").px; var A = atlas(); var hh = 116, ww = hh * img.width / img.height; A.x.drawImage(img, p[0] + 16, p[1] + (p[3] - 10 - hh) / 2, ww, hh); A.tex.needsUpdate = true; } catch (e) {} }; img.src = "/tex/gb_logo.png"; }); }
  // a sign quad from an atlas slot into a kit (the sign base); faces +z before the rotation
  function signQuad(K, uv, w, h, x, y, z, ry) { return K.quad("sign", 0xffffff, w, h, x, y, z, ry || 0, 0, true, uv[0], uv[1], uv[2], uv[3]); }

  // ───────────────────────── layout: every shop, terrace, planter, kiosk and stall (pure data, the same in every hook) ─────────────────────────
  var LAY = null;
  function layout() {
    if (LAY) return LAY; site(); var R = rng(7207), shops = C("shops", []), ter = C("terraces", []), kio = C("kiosks", []), st = C("stallTypes", []);
    LAY = MK.lay = { shops: [], terr: [], planters: [], small: [], kiosks: [], stalls: [], globes: [], spots: [], busker: null };
    var k = 0, isEnt = function (i) { return S.ENT.indexOf(i) >= 0; };
    // ground shops: the north row one bay each (bays with an entrance are passages), the south row two bays each
    for (var i = 0; i < S.NB; i++) { if (isEnt(i)) continue; var d = shops[k++ % shops.length]; LAY.shops.push({ s: -1, i: i, n: 1, x: S.bc(i), z: S.zs(-1, S.DF), ry: 0, def: d, type: d.type || "goods", id: "n" + i }); }
    for (var j = 0; j < S.NB; j += 2) { var d2 = shops[k++ % shops.length]; LAY.shops.push({ s: 1, i: j, n: 2, x: S.bx(j + 1), z: S.zs(1, S.DF), ry: PI, def: d2, type: d2.type || "goods", id: "s" + j }); }
    // the terraces: one module a bay on each side, a restaurant every four bays (its sign over the glazing)
    for (var s = -1; s <= 1; s += 2) for (var b = 0; b < S.NB; b++) { var land = S.stairs.some(function (q) { if (q.s !== s) return false; var a = Math.min(q.xt, q.xl) - 0.3, c = Math.max(q.xt, q.xl) + 0.3; return S.bx(b + 1) > a && S.bx(b) < c; });
      LAY.terr.push({ s: s, i: b, x: S.bc(b), z: S.zs(s, S.DB), ry: s < 0 ? 0 : PI, umb: (b + (s > 0 ? 1 : 0)) % 3 === 0, land: land, rest: b % 4 === 1 ? ter[((b >> 2) + (s > 0 ? 4 : 0)) % Math.max(1, ter.length)] : null }); }
    // the nave: big clay planters every two bays down the centre (alternately a little north and south), small ones by the shopfronts
    var kioskBays = [7, 15, 23, 33, 38], buskBay = 19;
    for (var p = 1; p < S.NB; p += 2) { if (kioskBays.indexOf(p) >= 0 || kioskBays.indexOf(p - 1) >= 0 && false) continue; var big = (p % 4) === 1; LAY.planters.push({ x: S.bx(p), z: S.ZC + ((p >> 1) % 2 ? 1.6 : -1.6), r: big ? 2.2 : 1.7, h: 0.72, tree: big, seat: (p % 6) === 3, id: "p" + p }); }
    for (var q2 = 2; q2 < S.NB; q2 += 5) for (var s2 = -1; s2 <= 1; s2 += 2) { var x2 = S.bx(q2) + (s2 > 0 ? S.B * 0.5 : 0); var z2 = S.zs(s2, S.DE - 1.5); if (S.stairs.some(function (q) { return q.s === s2 && x2 > Math.min(q.xb, q.xl) - 1.5 && x2 < Math.max(q.xb, q.xl) + 1.5; })) continue; LAY.small.push({ x: x2, z: z2, r: 0.75, h: 0.62 }); }
    kio.forEach(function (K, n) { var bb = kioskBays[n % kioskBays.length]; LAY.kiosks.push({ def: K, x: S.bc(bb), z: S.ZC + (n % 2 ? 1.2 : -1.2), ry: n % 2 ? PI : 0 }); });
    LAY.busker = { x: S.bc(buskBay), z: S.ZC + 3.2 };
    // the weekend market: two rows facing an aisle, broken where the hall's entrances line up; the Giveback stand at the east end
    var types = st.map(function (t) { return t.id; }), names = {}; st.forEach(function (t) { names[t.id] = (t.names || []).slice(); });
    var seq = ["produce", "crafts", "pottery", "produce", "textiles", "flowers", "produce", "baskets", "crafts", "pottery", "produce", "coffee", "textiles"], ni = {};
    var rowZ = [S.sz0 + 3.4, S.sz1 - 3.4], cnt = 0;
    for (var r2 = 0; r2 < 2; r2++) { var x = S.sx0 + 3; while (x + 4 < S.sx1 - 1) { var gap = S.gaps.some(function (g) { return x + 2 > g - 3.5 && x - 2 < g + 3.5; }); if (gap) { x += 1; continue; }
        var last = r2 === 1 && x + 4 + S.pitch > S.sx1 - 1; var ty = last ? "merch" : seq[(cnt + r2 * 5) % seq.length]; if (types.indexOf(ty) < 0 && ty !== "merch") ty = "produce";
        var nm = (names[ty] || ["Market"]); ni[ty] = (ni[ty] || 0); var name = nm[ni[ty]++ % nm.length];
        var wide = ty === "merch"; var cx = x + (wide ? 3.6 : 2); LAY.stalls.push({ x: cx, z: rowZ[r2], ry: r2 === 0 ? 0 : PI, type: ty, name: name, w: wide ? 7.2 : 4, id: "st" + cnt }); cnt++; x += wide ? 8 : S.pitch; } }
    return LAY;
  }

  // ───────────────────────── solids: walls, columns, decks, stairs, railings, counters, planters (SOLIDS, tag "market") ─────────────────────────
  MK.sol = MK.sol || [];
  function addS(x, z, w, d, y0, y1, ry, extra) { var sd = addSolid(x, z, ry || 0, w, d, y0, y1, "market"); if (sd) { if (extra) for (var k in extra) sd[k] = extra[k]; sd.mk = 1; MK.sol.push(sd); } return sd; }
  function aabS(x0, x1, z0, z1, y0, y1, extra) { return addS((x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(z1 - z0), y0, y1, 0, extra); }
  // a prefab's solids [lx, lz, w, d, y0, y1, extra] (local: x across, z toward the front) placed at (x, z) turned ry, y from base y
  function placeS(list, x, z, ry, y, sc) { var c = Math.cos(ry), sn = Math.sin(ry); sc = sc || 1; list.forEach(function (q) { var lx = q[0] * sc, lz = q[1] * sc; var wx = x + lx * c + lz * sn, wz = z - lx * sn + lz * c; var ex = q[6] ? Object.assign({}, q[6]) : null; if (ex && typeof ex.face === "number") ex.face = ex.face + ry; addS(wx, wz, q[2] * sc, q[3] * sc, y + q[4], y + q[5], ry, ex); }); }
  function hallSolids() {
    var yf = YF(), ym = YM(), yr = S.G + S.FL + S.RT, L = layout(), i, s;
    aabS(S.X0, S.X1, S.ZN, S.ZS, S.G - 0.8, yf);                                         // the floor slab (0.4 over the pad)
    // the outer walls: the north facade (gaps at the entrances), the south facade, the bay ends; the glazed gables with their doors
    for (i = 0; i < S.NB; i++) { var x0 = S.bx(i), x1 = S.bx(i + 1); if (S.ENT.indexOf(i) >= 0) { aabS(x0, x0 + 0.8, S.ZN, S.ZN + 0.6, yf, yr); aabS(x1 - 0.8, x1, S.ZN, S.ZN + 0.6, yf, yr); aabS(x0, x1, S.ZN, S.ZN + 0.6, yf + 4.6, yr); } else aabS(x0, x1, S.ZN, S.ZN + 0.6, yf, yr); }
    aabS(S.X0, S.X1, S.ZS - 0.6, S.ZS, yf, yr);
    [S.X0, S.X1].forEach(function (xe, e) { var xa = e ? xe - 0.6 : xe, xb = e ? xe : xe + 0.6; aabS(xa, xb, S.ZN, S.zs(-1, S.DF), yf, yr); aabS(xa, xb, S.zs(1, S.DF), S.ZS, yf, yr);
      var xg0 = e ? xe - 0.35 : xe, xg1 = e ? xe : xe + 0.35; aabS(xg0, xg1, S.zs(-1, S.DF), S.ZC - 3.75, yf, yr + S.RISE); aabS(xg0, xg1, S.ZC + 3.75, S.zs(1, S.DF), yf, yr + S.RISE); aabS(xg0, xg1, S.ZC - 3.75, S.ZC + 3.75, yf + 3.5, yr + S.RISE); });
    // every rib line: a glulam column at each shopfront, a partition from the facade to the shopfront under the mezzanine
    for (s = -1; s <= 1; s += 2) { var zf = S.zs(s, S.DF), zfac = S.zs(s, S.HW - 0.6), zb = S.zs(s, S.DB);
      for (i = 1; i < S.NB; i++) { var xi = S.bx(i); addS(xi, zf, 0.6, 0.85, yf, yr); var skip = s > 0 && (i % 2 === 1); if (!skip) aabS(xi - 0.15, xi + 0.15, Math.min(zfac, zf), Math.max(zfac, zf), yf, ym - 0.35); }
      // the back walls of the shops (not at the entrance passages), the mezzanine deck, the restaurant fronts upstairs
      for (i = 0; i < S.NB; i++) { if (s < 0 && S.ENT.indexOf(i) >= 0) continue; aabS(S.bx(i), S.bx(i + 1), Math.min(zb, zb + s * 0.3), Math.max(zb, zb + s * 0.3), yf, ym - 0.35); }
      aabS(S.X0 + 0.6, S.X1 - 0.6, Math.min(S.zs(s, S.HW - 0.6), S.zs(s, S.DE)), Math.max(S.zs(s, S.HW - 0.6), S.zs(s, S.DE)), ym - 0.35, ym);
      aabS(S.X0 + 0.6, S.X1 - 0.6, Math.min(zb, zb + s * 0.3), Math.max(zb, zb + s * 0.3), ym, S.G + S.FL + S.RS);
      // the railing along the mezzanine edge with its planter boxes (a gap where each stair lands)
      var gaps = S.stairs.filter(function (q) { return q.s === s; }).map(function (q) { return [Math.min(q.xt, q.xl), Math.max(q.xt, q.xl)]; }).sort(function (a, b) { return a[0] - b[0]; });
      var ze = S.zs(s, S.DE), zr0 = Math.min(ze, ze + s * 0.65), zr1 = Math.max(ze, ze + s * 0.65), xa2 = S.X0 + 0.6;
      gaps.forEach(function (g) { aabS(xa2, g[0], zr0, zr1, ym, ym + 1.1); xa2 = g[1]; }); aabS(xa2, S.X1 - 0.6, zr0, zr1, ym, ym + 1.1); }
    // the stairs: a solid tread each (the player climbs them), rails both sides, the landing at the deck
    S.stairs.forEach(function (q) { var rise = S.MZ / q.n; for (var k = 0; k < q.n; k++) { var xa = q.xb + q.dir * k * q.run, xb = q.xb + q.dir * (k + 1) * q.run; aabS(Math.min(xa, xb), Math.max(xa, xb), Math.min(q.zIn, q.zOut), Math.max(q.zIn, q.zOut), yf, yf + (k + 1) * rise);
        var top = yf + (k + 1) * rise; [q.zOut, q.zIn].forEach(function (zz, side) { if (side === 1 && k >= q.n - 2) return; aabS(Math.min(xa, xb), Math.max(xa, xb), zz - 0.06, zz + 0.06, top, top + 1.0); }); }
      aabS(Math.min(q.xt, q.xl), Math.max(q.xt, q.xl), Math.min(q.zIn, q.zOut), Math.max(q.zIn, q.zOut), ym - 0.35, ym);
      aabS(Math.min(q.xt, q.xl), Math.max(q.xt, q.xl), q.zOut - 0.06, q.zOut + 0.06, ym, ym + 1.1); aabS(q.xl - 0.06, q.xl + 0.06, Math.min(q.zIn, q.zOut), Math.max(q.zIn, q.zOut), ym, ym + 1.1); });
    // the shops' and terraces' own pieces (counters, tables, chairs and their seats), the nave (planters, kiosks)
    L.shops.forEach(function (P) { var list = shopSolids(P.type); if (P.n === 2) { placeS(list, P.x - S.B / 2, P.z, P.ry, yf); placeS(list, P.x + S.B / 2, P.z, P.ry, yf); } else placeS(list, P.x, P.z, P.ry, yf); });
    L.terr.forEach(function (T) { placeS(terrSolids(T), T.x, T.z, T.ry, ym); });
    L.planters.forEach(function (p) { addS(p.x, p.z, p.r * 1.75, p.r * 1.75, yf, yf + p.h); addS(p.x, p.z, p.r * 1.75, p.r * 1.75, yf, yf + p.h, PI / 4);
      if (p.seat) for (var a = 0; a < 4; a++) { var an = a * PI / 2 + PI / 4, sx = p.x + Math.sin(an) * (p.r + 0.32), sz = p.z + Math.cos(an) * (p.r + 0.32); addS(sx, sz, 0.5, 0.5, yf, yf + 0.46, an, { seat: true, face: an, mkSeat: 1 }); } });
    L.small.forEach(function (p) { addS(p.x, p.z, p.r * 1.7, p.r * 1.7, yf, yf + p.h); });
    L.kiosks.forEach(function (K) { addS(K.x, K.z, 3.4, 2.4, yf, yf + 2.9, K.ry); });
    if (L.busker) addS(L.busker.x, L.busker.z, 1.2, 1.0, yf, yf + 0.5);
  }
  function stallSolids() {
    var L = layout(), y = S.G + 0.03;
    L.stalls.forEach(function (T) { var w = T.w; placeS([[0, -0.55, w - 0.3, 0.75, 0, 0.92], [0, -2.4, w - 0.3, 0.9, 0, 1.6], [-w / 2 + 0.1, -0.1, 0.16, 0.16, 0, 2.6], [w / 2 - 0.1, -0.1, 0.16, 0.16, 0, 2.6]], T.x, T.z, T.ry, y); });
  }

  // ───────────────────────── world hook: the pad level, clearing, keep-outs, the old taxiway, solids, hubs, zones, info points ─────────────────────────
  function gridH(x, z) { try { return sampleGrid(H, T, x, z); } catch (e) { return getH(x, z); } }
  function rectDist(x, z, x0, x1, z0, z1) { var dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1); return Math.sqrt(dx * dx + dz * dz); }
  // the graded areas: the hall and the plaza in front of it, the stalls strip (x0, x1, z0, z1)
  function pads() { return [[S.X0 - 1.5, S.X1 + 1.5, S.sz0 - 4, S.ZS + 1.5]]; }
  function inPads(x, z, m) { return pads().some(function (p) { return rectDist(x, z, p[0], p[1], p[2], p[3]) <= (m || 0); }); }
  var VEG = /^(bush\d|mesquite|ocotillo|saguaro.*|paloverde|ironwood|desertwillow|barrel_cactus|prickly_pear|cholla|organ_pipe|agave_cluster|yucca_cluster|boulder|fanpalm.*|datepalm|canarypalm|ph_(rock|boulder|shrub|succulent|stones|sandrocks|moonrock)_?\d*|e1_(?!opost).*)$/;
  function clearSite() {
    var removed = 0, keys = new Set();
    for (var k in PLACE) { if (!VEG.test(k)) continue; var Lk = PLACE[k], out = []; for (var i = 0; i < Lk.length; i++) { var e = Lk[i]; if (!e.mk && inPads(e[0], e[2], 1)) { keys.add(Math.round(e[0] * 100) + ":" + Math.round(e[2] * 100)); removed++; } else out.push(e); } if (out.length !== Lk.length) { Lk.length = 0; Array.prototype.push.apply(Lk, out); } }
    if (keys.size) for (var j = COLLIDERS.length - 1; j >= 0; j--) { var c = COLLIDERS[j]; if (keys.has(Math.round(c[0] * 100) + ":" + Math.round(c[1] * 100))) COLLIDERS.splice(j, 1); }
    MK.n.cleared = removed;
  }
  function keepouts() { pads().forEach(function (p) { for (var x = p[0]; x <= p[1] + 9; x += 18) for (var z = p[2]; z <= p[3] + 9; z += 18) KEEPOUT.push([Math.min(x, p[1]), Math.min(z, p[3]), 14]); }); }
  // The City's diagonal taxiway (site.json) ran from (-316, -72) across the whole convention lot to the main taxiway. Its ribbon is
  // built later from the same array, so trimming it here (to start where it joins the main taxiway east of the hall) removes it
  // from the drawing and from the road lift together. ?mktwy=0 leaves it.
  function trimTaxiway() {
    if (/[?&]mktwy=0\b/.test(location.search) || window.PLAN_TWY_TRIM) return; var tw = (SITE && SITE.taxiways) || [];
    for (var i = 0; i < tw.length; i++) { var p = tw[i]; if (!p || p.length < 6 || Math.abs(p[0][0] + 316) > 2 || Math.abs(p[0][1] + 72.1) > 2) continue; var k = 0; while (k < p.length - 2 && p[k][0] < S.X1 - 20) k++; if (k > 0) { p.splice(0, k); window.PLAN_TWY_TRIM = { by: "market", cut: k }; MK.n.twyCut = k; } return; }
  }
  function worldHook() {
    if (MK.off || !window.PLAN) return; var t0 = nowMs(); site(); if (!cfg()) { note("cfg", "no plan/market.json"); return; }
    // the pad level: the mean of the survey over the hall and the stalls
    var sm = 0, sn = 0; for (var x = S.X0; x <= S.X1; x += 5) for (var z = S.sz0; z <= S.ZS; z += 4) { sm += gridH(x, z); sn++; } S.G = Math.round((sm / sn) * 20) / 20; MK.n.G = S.G;
    try { trimTaxiway(); } catch (e) { note("taxiway", e); }
    try { clearSite(); } catch (e) { note("clear", e); } try { keepouts(); } catch (e) { note("keepouts", e); }
    try { hallSolids(); stallSolids(); } catch (e) { note("solids", e); } MK.n.solids = MK.sol.length;
    // hubs (Places, map pills, fast travel), zone titles, info points (E)
    try { var hb = C("hub", {}), sh = C("stallsHub", {}); planAddHub(hb.name || "Market Hall", hb.x || -298.4, hb.z || 21.5); if (sh.name) planAddHub(sh.name, sh.x, sh.z); planNavCats(); } catch (e) { note("hub", e); }
    try { zoneRings.push({ name: C("names.full", "The Market Hall"), label: C("names.hall", "Market Hall"), center: [(S.X0 + S.X1) / 2, S.ZC], r: 60, k: C("names.campus", ""), poly: [[S.X0, S.ZN], [S.X1, S.ZN], [S.X1, S.ZS], [S.X0, S.ZS]], col: "#f1c99844", plan: "market", noLabel: true });
      zoneRings.push({ name: C("names.stalls", "Weekend Market"), label: C("names.stalls", "Weekend Market"), center: [(S.sx0 + S.sx1) / 2, (S.sz0 + S.sz1) / 2], r: 40, k: C("names.campus", ""), poly: [[S.sx0, S.sz0], [S.sx1, S.sz0], [S.sx1, S.sz1], [S.sx0, S.sz1]], col: "#f4cd5a33", plan: "market", noLabel: true }); } catch (e) { note("zone", e); }
    try { var hs = function (key, x, z, r) { var d = C("info." + key, null); if (!d) return null; var h = { x: x, z: z, r: r, t: d[0], k: d[1], p: d[2], mk: key }; hotspots.push(h); (MK.hsList = MK.hsList || []).push(h); return h; };
      S.ENT.forEach(function (i) { hs("hall", S.bc(i), S.ZN - 2.5, 4.5); }); hs("hall", (S.X0 + S.X1) / 2 + 4, S.ZC - 5, 5); hs("west", S.X0 + 4, S.ZC, 5); hs("east", S.X1 - 4, S.ZC, 5);
      S.gaps.forEach(function (g) { hs("stalls", g, (S.sz0 + S.sz1) / 2, 4); }); } catch (e) { note("hotspots", e); }
    install(); MK.n.worldMs = Math.round(nowMs() - t0);
  }

  // ───────────────────────── terrain hook: grade the pads level, plant the nave planters and the plaza ─────────────────────────
  function gradePad(test, bb, level, blend) {
    if (typeof H === "undefined" || !H || !T) return 0; var cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1), n = 0;
    var c0 = Math.max(0, Math.floor((bb[0] - blend - T.xmin) / cw)), c1 = Math.min(T.cols - 1, Math.ceil((bb[1] + blend - T.xmin) / cw)), r0 = Math.max(0, Math.floor((bb[2] - blend - T.zmin) / ch)), r1 = Math.min(T.rows - 1, Math.ceil((bb[3] + blend - T.zmin) / ch));
    for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) { var x = T.xmin + c * cw, z = T.zmin + r * ch; var d = test(x, z); if (d >= blend) continue; var t = clamp(d / blend, 0, 1), k = 1 - t * t * (3 - 2 * t); var v = r * T.cols + c; H[v] = H[v] + (level - H[v]) * k; n++; }
    return n;
  }
  function terrainHook() {
    if (MK.off || !window.PLAN || S === null || S.G === null) return; var t0 = nowMs(), n = 0;
    try { pads().forEach(function (p) { n += gradePad(function (x, z) { return rectDist(x, z, p[0], p[1], p[2], p[3]); }, p, S.G, 9); }); } catch (e) { note("grade", e); } MK.n.graded = n;
    try { plant(); } catch (e) { note("plant", e); }
    MK.n.terrainMs = Math.round(nowMs() - t0);
  }
  // planting through the client's instanced kinds (they sway, LOD and shadow like every other plant); y set to the soil
  function put1(k, x, z, rot, sc, y) { if (!canPut(k)) return false; var nc = COLLIDERS.length; put(k, x, z, rot, sc); if (COLLIDERS.length > nc) COLLIDERS.length = nc; var Lk = PLACE[k]; var e = Lk[Lk.length - 1]; e.mk = 1; if (y !== undefined) { e[1] = y; e.seated = true; } MK.n.planted = (MK.n.planted || 0) + 1; return true; }
  function plant() {
    var L = layout(), R = rng(4471), yf = YF(), pick = function (a) { a = a.filter(canPut); return a.length ? a[Math.floor(R() * a.length)] : null; };
    L.planters.forEach(function (p) { var ys = yf + p.h - 0.06;
      if (p.tree) { var tsel = Math.abs(Math.round(p.x / 16)) % 3, tk = pick(tsel === 0 ? ["paloverde"] : tsel === 1 ? ["mesquite", "paloverde"] : ["desertwillow", "paloverde"]); if (tk) put1(tk, p.x + (R() - 0.5) * 0.4, p.z + (R() - 0.5) * 0.4, R() * TAU, tk === "paloverde" ? 0.62 : tk === "mesquite" ? 0.5 : 0.66, ys); }
      else { var ok = pick(["ocotillo"]); if (ok && R() < 0.45) put1(ok, p.x + 0.4, p.z - 0.3, R() * TAU, 0.75, ys); }
      var nA = 2; for (var i = 0; i < nA; i++) { var a = i * TAU / nA + R(), rr = p.r * (0.45 + R() * 0.25); var ak = pick(i === 0 && (p.tree || (p.id.length % 2)) ? ["agave_cluster"] : ["bush1", "bush2"]); if (ak) put1(ak, p.x + Math.sin(a) * rr, p.z + Math.cos(a) * rr, R() * TAU, ak === "agave_cluster" ? 0.95 + R() * 0.3 : 0.42 + R() * 0.12, ys); }
      if (p.tree) { var gk = pick(["barrel_cactus"]); if (gk) put1(gk, p.x - p.r * 0.6, p.z + p.r * 0.3, R() * TAU, 1.0, ys); } });
    L.small.forEach(function (p) { var ak = pick(["bush1", "bush2"]); if (ak) put1(ak, p.x, p.z, R() * TAU, ak === "agave_cluster" ? 0.7 : 0.34, yf + p.h - 0.05); });
    // the plaza: agave beds along the north facade between the entrances, palo verdes and saguaros at the corners of the stalls
    for (var i = 0; i < S.NB; i++) { if (S.ENT.indexOf(i) >= 0 || i % 3) continue; var x = S.bc(i); var k1 = pick(i % 2 ? ["agave_cluster"] : ["bush2"]); if (k1) put1(k1, x, S.ZN - 1.6, R() * TAU, 0.8 + R() * 0.3); }
    [[S.sx0 - 3, S.sz0 - 1], [S.sx0 - 3, S.sz1 + 2], [S.sx1 + 3, S.sz0 - 1], [S.sx1 + 5, S.sz1 + 3]].forEach(function (q, j) { var tk = pick(j % 2 ? ["saguaro_young", "saguaro_mid"] : ["paloverde"]); if (tk) put1(tk, q[0], q[1], R() * TAU, tk === "paloverde" ? 0.8 : 1.0); });
    S.gaps.forEach(function (g) { [-1, 1].forEach(function (sd) { var tk = pick(["paloverde", "desertwillow"]); if (tk) put1(tk, g + sd * 4.6, S.sz0 - 1.2, R() * TAU, 0.6); }); });
  }

  // ───────────────────────── E, the prompt, seats by level, flavour bubbles ─────────────────────────
  function install() {
    if (MK.installed) return; MK.installed = true; var o = MK.orig = { openNearest: openNearest, updateZone: updateZone, nearestSeat: nearestSeat };
    openNearest = function () { try { if (MK.impl.handleE()) return; } catch (e) { note("E", e); } return o.openNearest.apply(this, arguments); };
    updateZone = function () { var r = o.updateZone.apply(this, arguments); try { MK.impl.prompt(); } catch (e) {} return r; };
    // a seat on the other level (the terraces over the shops) is never the nearest: the client's search is in plan only
    nearestSeat = function () { var r = o.nearestSeat.apply(this, arguments); try { if (r && r.mk && player && Math.abs(r.y1 - player.position.y) > 1.4) { var best = null, bd = 1.7, py = player.position.y; for (var i = 0; i < SOLIDS.length; i++) { var sd = SOLIDS[i]; if (!sd.seat) continue; if (sd.mk && Math.abs(sd.y1 - py) > 1.4) continue; var d = Math.hypot(sd.x - player.position.x, sd.z - player.position.z); if (d < bd) { bd = d; best = sd; } } return best; } } catch (e) {} return r; };
  }

  // ───────────────────────── the shell: floor, walls, bay roofs, decks, the glass vault, gables, railings, stairs (world x, z; y from the floor) ─────────────────────────
  // a quad with its face toward the side of `out` (a direction), whatever the order of its corners
  Kit.prototype.face = function (base, col, a, b, c, d, out) { var e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; var n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) return this.quad4(base, col, a, d, c, b); return this.quad4(base, col, a, b, c, d); };
  Kit.prototype.faceUV = function (base, col, a, b, c, d, out, ua, ub, uc, ud) { var e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; var n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; var flip = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0;
    var P = flip ? [a, d, c, a, c, b] : [a, b, c, a, c, d], U = flip ? [ua, ud, uc, ua, uc, ub] : [ua, ub, uc, ua, uc, ud]; var g = new THREE.BufferGeometry(), pa = new Float32Array(18), uv = new Float32Array(12); for (var i = 0; i < 6; i++) { pa[i * 3] = P[i][0]; pa[i * 3 + 1] = P[i][1]; pa[i * 3 + 2] = P[i][2]; uv[i * 2] = U[i][0]; uv[i * 2 + 1] = U[i][1]; }
    g.setAttribute("position", new THREE.BufferAttribute(pa, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); g.computeVertexNormals(); return this.add(base, g, col, true); };
  // the arch of the vault over the nave (z from the centre line): outer surface height, and the point and outward normal at angle th
  function archY(z) { var u = z / S.DF; return u * u >= 1 ? S.RT : S.RT + S.RISE * Math.sqrt(1 - u * u); }
  function archPt(th, off) { var cz = Math.cos(th), sy = Math.sin(th); var nz = cz / S.DF, ny = sy / S.RISE, L = Math.hypot(nz, ny); nz /= L; ny /= L; return [S.DF * cz + nz * (off || 0), S.RT + S.RISE * sy + ny * (off || 0), nz, ny]; }
  var COL = { trav: 0xf3e9da, travB: 0xcdb595, travC: 0xe8dcc8, earth: 0xf4eadf, earth2: 0xe8dacb, earth3: 0xfff4e8, plaster: 0x6e5038, glulam: 0xd2a27a, plank: 0xc8955f, deck: 0xb7865a, copper: 0x9c552c, copperD: 0x6a361c, steel: 0x2b2c2e, bronze: 0x5a4632, roof: 0x8f7c66, soil: 0x3e2c1f, green: 0x5f7f3c, green2: 0x7d9a4a, green3: 0x4c6b34, clay: 0xb4643c, clay2: 0xa65a36, warmWin: 0x2e1d12, warmWin2: 0x26170e, bulb: 0xfff0d2, linen: 0xefe6d4 };
  function strata(K, base, x0, x1, y0, y1, z0, z1, seed) { var R = rng(seed || 1), y = y0; var cols = [COL.earth, COL.earth2, COL.earth3, 0xeee0cf]; while (y < y1 - 0.01) { var h = Math.min(y1 - y, 0.45 + R() * 0.9); var c = new THREE.Color(cols[Math.floor(R() * cols.length)]).multiplyScalar(0.94 + R() * 0.1); K.aab(base, c.getHex(), x0, x1, y, y + h, z0, z1); y += h; } }
  // ambient occlusion baked into the floor: dark inside the shops and passages, shaded under the cantilevered deck, soft rings round
  // every planter, kiosk, column and stair, open and bright in the middle of the nave under the glass
  function aoAt(x, z) {
    var d = Math.abs(z - S.ZC), a;
    if (d > S.DF) a = 0.56 - 0.14 * clamp((d - S.DF) / 5, 0, 1); else if (d > S.DE) a = 0.62 + 0.14 * (S.DF - d) / (S.DF - S.DE); else a = 1 - 0.24 * Math.pow(clamp(1 - (S.DE - d) / 2.6, 0, 1), 1.5);
    var L = layout(), k, q, dd;
    for (k = 0; k < L.planters.length; k++) { q = L.planters[k]; dd = Math.hypot(q.x - x, q.z - z) - q.r * 1.02; if (dd < 1.6) a *= 1 - 0.5 * Math.pow(1 - Math.max(0, dd) / 1.6, 2); }
    for (k = 0; k < L.small.length; k++) { q = L.small[k]; dd = Math.hypot(q.x - x, q.z - z) - q.r; if (dd < 0.9) a *= 1 - 0.4 * Math.pow(1 - Math.max(0, dd) / 0.9, 2); }
    for (k = 0; k < L.kiosks.length; k++) { q = L.kiosks[k]; dd = Math.max(Math.abs(q.x - x) - 1.7, Math.abs(q.z - z) - 1.2); if (dd < 1.2) a *= 1 - 0.45 * Math.pow(1 - Math.max(0, dd) / 1.2, 2); }
    if (d < S.DF + 0.6 && d > S.DF - 1.2) { var xi = Math.round((x - S.X0) / S.B) * S.B + S.X0; dd = Math.hypot(xi - x, (S.DF - d) * 0.9) - 0.45; if (dd < 0.9) a *= 1 - 0.35 * Math.pow(1 - Math.max(0, dd) / 0.9, 2); }
    for (k = 0; k < S.stairs.length; k++) { q = S.stairs[k]; dd = Math.max(Math.max(Math.min(q.xb, q.xl) - x, x - Math.max(q.xb, q.xl)), Math.abs(z - (q.zIn + q.zOut) / 2) - 1.0); if (dd < 1.0) a *= 1 - 0.3 * Math.pow(1 - Math.max(0, dd), 2); }
    return a;
  }
  function floorGrid(K) {
    var dx = 1.0, nz = 76, nx = Math.round(S.L / dx), z0 = S.ZN, dz = (S.ZS - S.ZN) / nz, P = new Float32Array(nx * nz * 18), Cc = new Float32Array(nx * nz * 18), base = new THREE.Color(0xdcc39e), A = [];
    for (var j = 0; j <= nz; j++) { A.push(new Float32Array(nx + 1)); for (var i = 0; i <= nx; i++) A[j][i] = aoAt(S.X0 + i * dx, z0 + j * dz); }
    var o = 0, put = function (i, j) { var a = A[j][i]; P[o] = S.X0 + i * dx; P[o + 1] = 0; P[o + 2] = z0 + j * dz; Cc[o] = base.r * a; Cc[o + 1] = base.g * a; Cc[o + 2] = base.b * a; o += 3; };
    for (var j2 = 0; j2 < nz; j2++) for (var i2 = 0; i2 < nx; i2++) { put(i2, j2); put(i2, j2 + 1); put(i2 + 1, j2); put(i2 + 1, j2); put(i2, j2 + 1); put(i2 + 1, j2 + 1); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("color", new THREE.BufferAttribute(Cc, 3)); g.computeVertexNormals(); K.add("floor", g, null);
  }
  function buildShell() {
    var K = new Kit(), s, i, yRT = S.RT, B = S.B;
    // ── the floor: the generated travertine on a grid whose vertex colours carry the ambient occlusion (aoAt) ──
    floorGrid(K);
    // the thresholds outside the entrances and the end doors
    S.ENT.forEach(function (i) { K.aab("trav", COL.travB, S.bx(i) + 0.8, S.bx(i + 1) - 0.8, -0.42, -0.05, S.ZN - 2.2, S.ZN); });
    [S.X0, S.X1].forEach(function (xe, e) { var o = e ? 1 : -1; K.aab("trav", COL.travB, Math.min(xe, xe + o * 2.4), Math.max(xe, xe + o * 2.4), -0.42, -0.05, S.ZC - 3.6, S.ZC + 3.6); });
    for (s = -1; s <= 1; s += 2) {
      var zF = S.zs(s, S.HW), zFi = S.zs(s, S.HW - 0.6), zDF = S.zs(s, S.DF), zDB = S.zs(s, S.DB), zDE = S.zs(s, S.DE), mn = function (a, b) { return Math.min(a, b); }, mx = function (a, b) { return Math.max(a, b); };
      // ── the facade: rammed earth piers at every rib line, shop windows and the upper windows between, entrances on the north ──
      for (i = 0; i < S.NB; i++) { var x0 = S.bx(i), x1 = S.bx(i + 1), ent = s < 0 && S.ENT.indexOf(i) >= 0;
        strata(K, "earth", x0, x0 + 0.65, 0, yRT + 0.6, mn(zF, zFi) - (s < 0 ? 0.25 : 0), mx(zF, zFi) + (s > 0 ? 0.25 : 0), 11 + i * 7 + s);
        var wx0 = x0 + 0.65, wx1 = x1, g0 = ent ? 4.6 : (s < 0 ? 0.7 : 2.4), g1 = ent ? 4.6 : 4.0;
        if (!ent) strata(K, "earth", wx0, wx1, 0, g0, mn(zF, zFi), mx(zF, zFi), 31 + i * 5 + s);
        strata(K, "earth", wx0, wx1, g1, 6.0, mn(zF, zFi), mx(zF, zFi), 51 + i * 3 + s); strata(K, "earth", wx0, wx1, 9.8, yRT + 0.6, mn(zF, zFi), mx(zF, zFi), 71 + i * 9 + s);
        K.aab("metal", COL.copperD, x0 - 0.05, x1 + 0.05, yRT + 0.6, yRT + 0.78, mn(zF, zFi) - 0.12, mx(zF, zFi) + 0.12);
        var zg = S.zs(s, S.HW - 0.3), zw = S.zs(s, S.HW - 0.9);
        // the windows: glass in a dark bronze frame with the warm interior behind (glow: dim by day, lit at night)
        var win = function (y0, y1, col) { K.aab("glass", 0xffffff, wx0 + 0.05, wx1 - 0.05, y0, y1, mn(zg, zg + 0.02), mx(zg, zg + 0.02)); K.aab("win", col, wx0 + 0.1, wx1 - 0.1, y0 + 0.05, y1 - 0.05, mn(zw, zw + s * 0.05), mx(zw, zw + s * 0.05));
          K.aab("metal", COL.bronze, wx0, wx1, y0 - 0.08, y0, mn(zF, zFi), mx(zF, zFi)); K.aab("metal", COL.bronze, wx0, wx1, y1, y1 + 0.08, mn(zF, zFi), mx(zF, zFi)); for (var m = 1; m < 4; m++) { var xm = lerp(wx0, wx1, m / 4); K.aab("metal", COL.bronze, xm - 0.04, xm + 0.04, y0, y1, mn(zg, zg) - 0.05, mx(zg, zg) + 0.05); } };
        if (!ent) win(g0, g1, s < 0 ? COL.warmWin : COL.warmWin2); win(6.0, 9.8, COL.warmWin2);
        if (!ent && s < 0) { var za0 = zF + s * 0.05, za1 = zF + s * 1.5; K.quad4("metal", COL.copper, [wx0 + 0.1, 4.45, za0], [wx1 - 0.1, 4.45, za0], [wx1 - 0.1, 4.0, za1], [wx0 + 0.1, 4.0, za1]); K.quad4("metal", COL.copperD, [wx0 + 0.1, 4.45, za0], [wx0 + 0.1, 4.0, za1], [wx1 - 0.1, 4.0, za1], [wx1 - 0.1, 4.45, za0]); K.aab("metal", COL.copperD, wx0 + 0.1, wx1 - 0.1, 3.82, 4.0, Math.min(za1, za1 + s * 0.05), Math.max(za1, za1 + s * 0.05)); }
        if (ent) { // glass doors (two leaves standing open), a copper canopy, the threshold; the passage walls are the partitions
          var xc = S.bc(i); K.aab("metal", COL.bronze, wx0, wx0 + 0.15, 0, 4.6, mn(zF, zFi), mx(zF, zFi)); K.aab("metal", COL.bronze, wx1 - 0.15, wx1, 0, 4.6, mn(zF, zFi), mx(zF, zFi));
          [-1, 1].forEach(function (sd) { var hx = xc + sd * 3.2; K.box("glass", 0xffffff, 1.6, 3.2, 0.04, hx - sd * 0.55, 0, zg + s * 0.6, sd * 1.1); K.box("metal", COL.bronze, 1.6, 0.08, 0.06, hx - sd * 0.55, 3.2, zg + s * 0.6, sd * 1.1); });
          K.aab("metal", COL.copper, x0 - 0.4, x1 + 0.4, 4.7, 4.95, mn(zF, zF + s * 2.6), mx(zF, zF + s * 2.6)); K.aab("metal", COL.copperD, x0 - 0.4, x1 + 0.4, 4.45, 4.95, mn(zF + s * 2.6, zF + s * 2.75), mx(zF + s * 2.6, zF + s * 2.75));
          [x0 - 0.2, x1 + 0.2].forEach(function (xx) { K.tube("metal", COL.steel, [xx, 4.7, zF + s * 2.3], [xx, 6.0, zF], 0.04, 6); }); }
      }
      // the bay ends (east and west), rammed earth full height
      [[S.X0, S.X0 + 0.6], [S.X1 - 0.6, S.X1]].forEach(function (q, e) { strata(K, "earth", q[0], q[1], 0, yRT + 0.6, mn(zF, zDF), mx(zF, zDF), 91 + e * 13 + s); });
      // ── the bay roof (a timber soffit over the terraces), its copper fascia toward the nave ──
      K.aab("plain", COL.roof, S.X0, S.X1, S.RS, yRT, mn(zF, zDF - s * 0.35), mx(zF, zDF - s * 0.35)); K.aab("wood", 0x9c7656, S.X0 + 0.6, S.X1 - 0.6, S.RS - 0.08, S.RS, mn(zFi, zDF - s * 0.35), mx(zFi, zDF - s * 0.35));
      K.aab("metal", COL.copper, S.X0, S.X1, yRT - 0.75, yRT + 0.12, mn(zDF - s * 0.35, zDF - s * 0.5), mx(zDF - s * 0.35, zDF - s * 0.5));
      for (i = 0; i < S.NB; i++) { var xb0 = S.bx(i) + 0.4, xb1 = S.bx(i + 1) - 0.4; for (var bm = 0; bm < 3; bm++) { var xx2 = lerp(xb0, xb1, (bm + 0.5) / 3); K.aab("wood", COL.glulam, xx2 - 0.09, xx2 + 0.09, S.RS - 0.42, S.RS - 0.08, mn(zFi, zDF), mx(zFi, zDF)); } }
      // ── the mezzanine deck: timber boards, a sandstone edge, a timber soffit over the shops ──
      K.aab("wood", 0x8c6a50, S.X0 + 0.6, S.X1 - 0.6, S.MZ - 0.3, S.MZ, mn(zFi, zDE), mx(zFi, zDE)); K.aab("wood", 0x765440, S.X0 + 0.6, S.X1 - 0.6, S.MZ - 0.38, S.MZ - 0.3, mn(zFi, zDE), mx(zFi, zDE));
      K.aab("trav", 0xb08c64, S.X0 + 0.6, S.X1 - 0.6, S.MZ - 0.62, S.MZ + 0.02, mn(zDE, zDE + s * 0.16), mx(zDE, zDE + s * 0.16));
      // ── partitions at the rib lines and the back walls of the shops (warm plaster), under the deck ──
      for (i = 1; i < S.NB; i++) { if (s > 0 && i % 2 === 1) continue; K.aab("trav", COL.plaster, S.bx(i) - 0.15, S.bx(i) + 0.15, 0, S.MZ - 0.38, mn(zFi, zDF), mx(zFi, zDF)); }
      for (i = 0; i < S.NB; i++) { if (s < 0 && S.ENT.indexOf(i) >= 0) continue; K.aab("trav", (i % 3 === 0) ? 0x7a5a40 : COL.plaster, S.bx(i), S.bx(i + 1), 0, S.MZ - 0.38, mn(zDB, zDB + s * 0.3), mx(zDB, zDB + s * 0.3)); }
      // ── upstairs: the restaurant fronts (glazing in timber frames, the lit room behind) ──
      for (i = 0; i < S.NB; i++) { var r0 = S.bx(i) + 0.35, r1 = S.bx(i + 1) - 0.35, zg2 = zDB, yT = S.RS - 1.1;
        K.aab("glass", 0xffffff, r0, r1, S.MZ, yT, mn(zg2, zg2 + s * 0.02), mx(zg2, zg2 + s * 0.02)); K.aab("win", 0x2e1d12, r0, r1, S.MZ, S.RS - 0.1, mn(zDB + s * 2.2, zDB + s * 2.25), mx(zDB + s * 2.2, zDB + s * 2.25));
        K.aab("wood", COL.glulam, S.bx(i), S.bx(i + 1), yT, S.RS, mn(zg2, zg2 + s * 0.25), mx(zg2, zg2 + s * 0.25));
        for (var mm = 0; mm <= 4; mm++) { var xm2 = lerp(r0, r1, mm / 4); K.aab("wood", 0x8a5a36, xm2 - 0.05, xm2 + 0.05, S.MZ, yT, mn(zg2, zg2 + s * 0.12), mx(zg2, zg2 + s * 0.12)); } K.aab("wood", 0x8a5a36, r0, r1, S.MZ + 1.05, S.MZ + 1.12, mn(zg2, zg2 + s * 0.1), mx(zg2, zg2 + s * 0.1));
        K.aab("plain", 0x6a4630, r0 + 1.6, r0 + 3.0, S.MZ, S.MZ + 2.6, mn(zDB + s * 0.6, zDB + s * 0.65), mx(zDB + s * 0.6, zDB + s * 0.65)); }
      // ── the railing at the deck edge: bronze posts, glass, a timber handrail; planter boxes inside it (a gap where a stair lands) ──
      var gaps = S.stairs.filter(function (q) { return q.s === s; }).map(function (q) { return [Math.min(q.xt, q.xl), Math.max(q.xt, q.xl)]; });
      var runs = [], xa = S.X0 + 0.6; gaps.sort(function (a, b) { return a[0] - b[0]; }).forEach(function (g) { runs.push([xa, g[0]]); xa = g[1]; }); runs.push([xa, S.X1 - 0.6]); S["runs" + s] = runs;
      var zr = S.zs(s, S.DE + 0.08), zp0 = S.zs(s, S.DE + 0.15), zp1 = S.zs(s, S.DE + 0.7);
      runs.forEach(function (rn) { var n = Math.max(1, Math.round((rn[1] - rn[0]) / 1.6)); for (var k = 0; k <= n; k++) { var xp = lerp(rn[0], rn[1], k / n); K.aab("metal", COL.bronze, xp - 0.03, xp + 0.03, S.MZ, S.MZ + 1.1, zr - 0.03, zr + 0.03); }
        K.aab("glass", 0xffffff, rn[0], rn[1], S.MZ + 0.08, S.MZ + 1.02, zr - 0.01, zr + 0.01); K.aab("wood", COL.glulam, rn[0], rn[1], S.MZ + 1.06, S.MZ + 1.16, zr - 0.06, zr + 0.06);
        K.aab("wood", 0x9a6a40, rn[0] + 0.1, rn[1] - 0.1, S.MZ, S.MZ + 0.6, mn(zp0, zp1), mx(zp0, zp1)); K.aab("plain", COL.soil, rn[0] + 0.15, rn[1] - 0.15, S.MZ + 0.6, S.MZ + 0.62, mn(zp0, zp1) + 0.05, mx(zp0, zp1) - 0.05); });
    }
    // ── the gables at both ends: glass under the arch on bronze mullions and transoms, the doors on the axis, a copper canopy ──
    [S.X0 + 0.2, S.X1 - 0.2].forEach(function (xg, e) { var out = e ? 1 : -1, nC = 16;
      for (var c = 0; c < nC; c++) { var za = -S.DF + 2 * S.DF * c / nC, zb = -S.DF + 2 * S.DF * (c + 1) / nC, ya = archY(za), yb = archY(zb), lo = (Math.abs((za + zb) / 2) < 3.7) ? 3.5 : 0;
        K.quad4("vglass", 0xffffff, [xg, lo, S.ZC + za], [xg, lo, S.ZC + zb], [xg, yb, S.ZC + zb], [xg, ya, S.ZC + za]);
        var my0 = Math.abs(za) < 3.7 ? 3.5 : 0; K.box("metal", COL.bronze, 0.1, ya - my0 - 0.02, 0.1, xg, my0, S.ZC + za, 0); K.beam("metal", COL.bronze, [xg, ya, S.ZC + za], [xg, yb, S.ZC + zb], 0.14, 0.14); }
      [3.5, 7.0, S.RT, S.RT + 4.2].forEach(function (yy) { var zl = yy <= S.RT ? S.DF : S.DF * Math.sqrt(Math.max(0, 1 - Math.pow((yy - S.RT) / S.RISE, 2))); K.aab("metal", COL.bronze, xg - 0.05, xg + 0.05, yy - 0.05, yy + 0.05, S.ZC - zl, S.ZC + zl); });
      K.aab("metal", COL.copper, Math.min(xg, xg + out * 2.6), Math.max(xg, xg + out * 2.6), 3.75, 3.95, S.ZC - 3.8, S.ZC + 3.8); K.aab("metal", COL.copperD, Math.min(xg + out * 2.6, xg + out * 2.75), Math.max(xg + out * 2.6, xg + out * 2.75), 3.55, 3.95, S.ZC - 3.8, S.ZC + 3.8);
      [-1, 1].forEach(function (sd) { K.box("glass", 0xffffff, 0.04, 3.4, 1.5, xg + out * 0.5, 0, S.ZC + sd * 2.4, sd * out * 1.0); }); });
    // ── the glass vault: one barrel of panes on the arch, bronze purlins along it, a slim arc mullion mid-bay, the ridge cap ──
    var NA = 32, th = function (k) { return PI * k / NA; };
    for (var k = 0; k < NA; k++) { var a = archPt(th(k), 0.04), b = archPt(th(k + 1), 0.04); K.quad4("vglass", 0xffffff, [S.X0 + 0.3, a[1], S.ZC + a[0]], [S.X1 - 0.3, a[1], S.ZC + a[0]], [S.X1 - 0.3, b[1], S.ZC + b[0]], [S.X0 + 0.3, b[1], S.ZC + b[0]]); }
    for (k = 1; k < NA; k += 2) { var p = archPt(th(k), -0.05); K.aab("metal", COL.bronze, S.X0 + 0.3, S.X1 - 0.3, p[1] - 0.05, p[1] + 0.05, S.ZC + p[0] - 0.05, S.ZC + p[0] + 0.05); }
    for (i = 0; i < S.NB; i++) { var xm3 = S.bc(i); for (k = 0; k < NA; k += 1) { var a2 = archPt(th(k), -0.04), b2 = archPt(th(k + 1), -0.04); K.beam("metal", COL.bronze, [xm3, a2[1], S.ZC + a2[0]], [xm3, b2[1], S.ZC + b2[0]], 0.07, 0.09); } }
    var cr = archPt(PI / 2, 0.08); K.aab("metal", COL.copperD, S.X0 + 0.3, S.X1 - 0.3, cr[1], cr[1] + 0.22, S.ZC - 0.35, S.ZC + 0.35);
    // ── the stairs: open timber treads on glulam stringers, glass balustrades with timber rails, the landing at the deck ──
    S.stairs.forEach(function (q) { var rise = S.MZ / q.n, zi = q.zIn, zo = q.zOut, zs0 = Math.min(zi, zo), zs1 = Math.max(zi, zo);
      for (var t = 0; t < q.n; t++) { var xa3 = q.xb + q.dir * t * q.run, xb3 = q.xb + q.dir * (t + 1) * q.run, yt = (t + 1) * rise; K.aab("wood", COL.glulam, Math.min(xa3, xb3), Math.max(xa3, xb3) + 0.02, yt - 0.07, yt, zs0 + 0.05, zs1 - 0.05); }
      var top = [q.xt, S.MZ, 0], bot = [q.xb, 0, 0];
      [zi, zo].forEach(function (zz, side) { var zc2 = zz + (side ? 1 : -1) * (zo > zi ? 0.06 : -0.06) * 0; K.beam("wood", COL.glulam, [bot[0], -0.05, zz], [top[0], S.MZ - 0.1, zz], 0.14, 0.42);
        var g0 = [q.xb, 0.15, zz], g1 = [q.xt, S.MZ + 0.15, zz], h0 = [q.xb, 1.05, zz], h1 = [q.xt, S.MZ + 1.05, zz]; if (side === 0) { g1 = [q.xb + q.dir * q.run * (q.n - 2), S.MZ - 0.2, zz]; h1 = [g1[0], S.MZ + 0.7, zz]; }
        K.quad4("glass", 0xffffff, g0, g1, h1, h0); K.beam("wood", COL.glulam, h0, h1, 0.07, 0.07); });
      K.aab("wood", COL.deck, Math.min(q.xt, q.xl), Math.max(q.xt, q.xl), S.MZ - 0.32, S.MZ, zs0, zs1);
      K.aab("glass", 0xffffff, Math.min(q.xt, q.xl), Math.max(q.xt, q.xl), S.MZ + 0.08, S.MZ + 1.02, zo - 0.01, zo + 0.01); K.aab("glass", 0xffffff, q.xl - 0.01, q.xl + 0.01, S.MZ + 0.08, S.MZ + 1.02, zs0, zs1);
      K.aab("wood", COL.glulam, Math.min(q.xt, q.xl), Math.max(q.xt, q.xl), S.MZ + 1.04, S.MZ + 1.12, zo - 0.05, zo + 0.05); K.box("wood", COL.glulam, 0.25, S.MZ - 0.3, 0.25, q.xl - q.dir * 0.2, 0, zo + (zi - zo) * 0.1, 0); });
    MK.n.shellTris = Math.round(K.tris); return K.merged();
  }
  // a glulam rib with its two columns, plinths and steel shoes (one per rib line, instanced); local z from the centre line
  function buildRib() {
    var K = new Kit(), NA = 28, w = 0.5, dp = 0.9;
    var arcS = 0; for (var k = 0; k < NA; k++) { var t0 = PI * k / NA, t1 = PI * (k + 1) / NA, a = archPt(t0, 0), b = archPt(t1, 0); var ai = [a[0] - a[2] * dp, a[1] - a[3] * dp], bi = [b[0] - b[2] * dp, b[1] - b[3] * dp];
      var P = function (q, x) { return [x, q[1], q[0]]; }; var mid = archPt((t0 + t1) / 2, 0), sl = Math.hypot(b[0] - a[0], b[1] - a[1]), v0 = arcS / 1.4, v1 = (arcS + sl) / 1.4; arcS += sl; var uw = w / 1.4, ud = dp / 1.4;
      K.faceUV("wood", COL.glulam, P(a, -w / 2), P(b, -w / 2), P(b, w / 2), P(a, w / 2), [0, mid[3], mid[2]], [0, v0], [0, v1], [uw, v1], [uw, v0]); K.faceUV("wood", COL.glulam, P(ai, -w / 2), P(bi, -w / 2), P(bi, w / 2), P(ai, w / 2), [0, -mid[3], -mid[2]], [0, v0], [0, v1], [uw, v1], [uw, v0]);
      K.faceUV("wood", COL.glulam, P(a, w / 2), P(b, w / 2), P(bi, w / 2), P(ai, w / 2), [1, 0, 0], [0, v0], [0, v1], [ud, v1], [ud, v0]); K.faceUV("wood", COL.glulam, P(a, -w / 2), P(b, -w / 2), P(bi, -w / 2), P(ai, -w / 2), [-1, 0, 0], [0, v0], [0, v1], [ud, v1], [ud, v0]); }
    [-1, 1].forEach(function (sd) { var z = sd * S.DF; K.box("wood", COL.glulam, 0.56, S.RT + 0.3, 0.82, 0, 0, z); K.box("trav", 0xd9c7a8, 0.8, 0.45, 1.05, 0, 0, z); K.box("metal", COL.steel, 0.62, 0.25, 0.9, 0, S.RT - 0.1, z);
      K.beam("wood", COL.glulam, [0, S.MZ + 3.6, z], [0, S.RT - 0.2, z - sd * 1.4], 0.4, 0.5); K.beam("wood", COL.glulam, [0, S.MZ - 1.6, z], [0, S.MZ - 0.4, z - sd * 1.6], 0.36, 0.44); });
    return K.merged();
  }
  // a globe pendant (unit globe, its cord is a separate unit-length instance scaled to the drop)
  function buildGlobe() { var K = new Kit(); K.sph("glow", COL.bulb, 0.3, 0, 0, 0, 12); K.cyl("metal", COL.bronze, 0.05, 0.07, 0.08, 0, 0.27, 0, 10); return K.merged(); }
  function buildCord() { var K = new Kit(); K.cyl("metal", COL.steel, 0.012, 0.012, 1, 0, 0, 0, 5, 0, 0, 0, true); return K.merged(); }
  // greenery along 2 m of a deck planter: soft shrubs and grasses, vines trailing over the railing and down the edge (outward is +z)
  // foliage atlas regions (u0, v0, u1, v1): the three vine strands, the grass clump, the planter greenery strip
  var FOL = { vine: [[0.0, 0.25, 0.167, 1.0], [0.167, 0.25, 0.333, 1.0], [0.333, 0.25, 0.5, 1.0]], grass: [0.5, 0.5, 1.0, 1.0], green: [0.5, 0.168, 1.0, 0.5] };
  function card(K, uv, w, h, x, y, z, ry, tint, ua, ub) { var u0 = ua === undefined ? uv[0] : lerp(uv[0], uv[2], ua), u1 = ub === undefined ? uv[2] : lerp(uv[0], uv[2], ub); return K.quad("leaf", tint || 0xffffff, w, h, x, y, z, ry || 0, 0, true, u0, uv[1], u1, uv[3]); }
  // 2.4 m of a deck planter: mixed greenery along the box, a grass tuft, vines trailing over the railing and down the edge (outward is +z)
  function buildGreen(seed) {
    var K = new Kit(), R = rng(seed || 3), tints = [0xffffff, 0xe6f0d8, 0xf4f0dc, 0xd8e6c8];
    for (var i = 0; i < 3; i++) { var ua = R() * 0.5; card(K, FOL.green, 1.15, 0.62, -0.8 + i * 0.8, 0.9, -0.5 + (i % 2) * 0.16, (R() - 0.5) * 0.4, tints[i % 4], ua, ua + 0.5); }
    var gx = (R() - 0.5) * 1.2; card(K, FOL.grass, 0.7, 0.7, gx, 0.95, -0.42, 0.6, 0xf0f4e4); card(K, FOL.grass, 0.7, 0.7, gx, 0.95, -0.42, -0.9, 0xf0f4e4);
    for (var v = 0; v < 3; v++) { var len = 1.5 + R() * 1.1, w = 0.42 + R() * 0.16, vx = -0.85 + v * 0.85 + (R() - 0.5) * 0.3; card(K, FOL.vine[(v + seed) % 3], w, len, vx, 1.12 - len / 2 + 0.05, 0.16 + R() * 0.06, (R() - 0.5) * 0.3, tints[(v + 1) % 4]); }
    return K.merged();
  }
  // grass clumps round a planter (unit radius, the soil at 0.62), crossed cards
  function buildPlanterCards(n, seed, rad) {
    var K = new Kit(), R = rng(seed || 11); rad = rad || 1; for (var i = 0; i < n; i++) { var a = i * TAU / n + R() * 0.5, r = rad * (0.45 + R() * 0.35), h = 0.55 + R() * 0.4, x = Math.sin(a) * r, z = Math.cos(a) * r, ry = R() * PI; card(K, FOL.grass, h * 1.05, h, x, 0.6 + h / 2, z, ry, 0xf2f4e6); card(K, FOL.grass, h * 1.05, h, x, 0.6 + h / 2, z, ry + PI / 2, 0xe8eedc); }
    return K.merged();
  }

  // ───────────────────────── props: shopfronts and their fittings, terraces, planters, kiosks, stalls (prefabs, instanced) ─────────────────────────
  // A shop prefab's frame: x across the unit (between the columns, about 7.5 m), z = 0 at the shopfront line with the nave at +z and
  // the shop at -z (its back wall at -5), y from the floor. Every type has a sandstone and copper front, copper pendants and its own
  // fittings: food and sweets a counter with a lit case, coffee an espresso bar, artisans display tables and a textile wall, goods
  // shelving, crates and barrels.
  var POT = [[0.0, 0], [0.12, 0.0], [0.17, 0.05], [0.2, 0.16], [0.18, 0.28], [0.1, 0.36], [0.11, 0.4]];
  var VASE = [[0.0, 0], [0.08, 0], [0.13, 0.08], [0.15, 0.2], [0.09, 0.34], [0.06, 0.42], [0.08, 0.46]];
  var BOWL = [[0.0, 0], [0.07, 0], [0.16, 0.06], [0.2, 0.13]];
  var JAR = [[0.0, 0], [0.06, 0], [0.065, 0.14], [0.045, 0.16], [0.045, 0.19]];
  function pots(K, R, x0, x1, y, z, n, big) { var cols = [COL.clay, 0x2f5d7c, 0xe8dcc4, 0x2b2b2b, 0x7a8a5a, 0xc98a4a, 0x9a3b2a]; for (var i = 0; i < n; i++) { var x = lerp(x0, x1, (i + 0.5) / n), sc = (big ? 1.6 : 0.8) + R() * 0.6, pr = [POT, VASE, BOWL][Math.floor(R() * 3)]; K.lathe("plain", cols[Math.floor(R() * cols.length)], pr, x, y, z + (R() - 0.5) * 0.2, 12, sc, sc); } }
  function jars(K, R, x0, x1, y, z, n, cols) { for (var i = 0; i < n; i++) { var x = lerp(x0, x1, (i + 0.5) / n); var c = cols[Math.floor(R() * cols.length)]; if (R() < 0.6) K.lathe("plain", c, JAR, x, y, z, 8, 1 + R() * 0.3); else K.box("plain", c, 0.14 + R() * 0.08, 0.16 + R() * 0.14, 0.12, x, y, z, R() * 0.3); } }
  function rug(K, x, y0, z, w, h, cols, ry) { var n = cols.length * 3; for (var i = 0; i < n; i++) K.box("plain", cols[i % cols.length], w, h / n, 0.02, x, y0 + i * h / n, z, ry || 0); }
  function pendant(K, x, y, z) { K.lathe("metal", COL.copper, [[0.02, 0.3], [0.08, 0.28], [0.22, 0.1], [0.26, 0.0]].reverse().map(function (p) { return p; }), x, y, z, 14); K.cyl("glow", COL.bulb, 0.2, 0.2, 0.02, x, y + 0.01, z, 12); K.cyl("metal", COL.steel, 0.008, 0.008, (S.MZ - 0.38) - (y + 0.3), x, y + 0.3, z, 4); }
  function shopFront(K, W) { var h = W / 2; K.box("trav", 0xb08c66, 0.5, 3.55, 0.45, -h + 0.25, 0, -0.12); K.box("trav", 0xb08c66, 0.5, 3.55, 0.45, h - 0.25, 0, -0.12); K.box("trav", 0xa07c58, W, 0.18, 0.5, 0, 3.4, -0.12);
    K.aab("metal", COL.copperD, -h, h, 3.55, S.MZ - 0.38, -0.08, 0.22); K.aab("metal", COL.copper, -h + 0.1, h - 0.1, 3.58, 3.68, 0.22, 0.27); }
  var SHOP = {};
  function shopPrefab(type) {
    if (SHOP[type]) return SHOP[type]; var K = new Kit(), R = rng(type.length * 977 + 11), W = S.B - 0.6, h = W / 2, sol = [], spots = [], slots = [];
    shopFront(K, W); [-2.7, -0.9, 0.9, 2.7].forEach(function (x, i) { pendant(K, x, 2.75 + (i % 2) * 0.25, -1.4); }); K.aab("glow", 0xffd9a0, -h + 0.5, h - 0.5, 3.3, 3.36, -0.42, -0.36);
    var counter = function (x0, x1, dark) { K.aab("plank", dark ? 0x9a6040 : 0xc08050, x0, x1, 0, 0.98, -1.25, -0.5); K.aab("metal", COL.copper, x0, x1, 0.05, 0.25, -0.5, -0.46); K.aab("trav", 0xf2ede4, x0 - 0.05, x1 + 0.05, 0.98, 1.04, -1.3, -0.42); sol.push([(x0 + x1) / 2, -0.88, x1 - x0, 0.86, 0, 1.05]); };
    var backBar = function () { K.aab("wood", 0x5e3c22, -h + 0.3, h - 0.3, 0, 0.92, -4.95, -4.3); K.aab("trav", 0xd8ccb8, -h + 0.25, h - 0.25, 0.92, 0.97, -4.97, -4.25); sol.push([0, -4.6, W - 0.6, 0.7, 0, 0.97]); jars(K, R, -h + 0.5, h - 0.5, 0.97, -4.6, 9, [0xc0462d, 0xe8c34a, 0x6f9a3a, 0x8a4a2a, 0xf0e4c4, 0x2f5d7c]); };
    var menuFrame = function () { K.aab("wood", 0x6e4628, 1.25, 3.35, 1.45, 3.45, -4.98, -4.92); };
    if (type === "food" || type === "sweets") {
      counter(-h + 0.4, h - 0.4); K.aab("glass", 0xffffff, -h + 0.7, 0.7, 1.04, 1.52, -1.2, -0.62); K.aab("glow", 0xffe7c2, -h + 0.75, 0.65, 1.47, 1.49, -1.15, -0.67);
      var fc = type === "food" ? [0xc0462d, 0x6f9a3a, 0xf0e4c4, 0xd98a2b, 0x7a4a2a, 0xe8c34a] : [0xf3b6c8, 0xf7e6b0, 0xa8d8b0, 0x8a4a2a, 0xf4f1ea, 0xe9a35a]; for (var t = 0; t < 6; t++) K.box("plain", fc[t], 0.42, 0.06, 0.34, -h + 1.0 + t * 0.5, 1.06, -0.9);
      backBar(); menuFrame(); for (var bo = 0; bo < 8; bo++) K.lathe("plain", [0xf4f1ea, 0xc0462d, 0x2f5d7c, 0xe8c34a][bo % 4], BOWL, -h + 0.7 + bo * 0.36, 1.04, -1.45 + (bo % 2) * 0.12, 10, 0.75); for (var pl = 0; pl < 3; pl++) K.cyl("plain", 0xf4f1ea, 0.13, 0.13, 0.12, 2.5 + pl * 0.05, 1.04 + 0, -0.85, 14);
      if (type === "food") { K.aab("metal", 0x3a3a3c, -1.5, 0.6, 0.97, 1.05, -4.85, -4.35); K.tube("metal", COL.copperD, [-h + 0.5, 2.55, -3.6], [0.8, 2.55, -3.6], 0.02, 6); for (var p = 0; p < 4; p++) K.lathe("metal", COL.copper, BOWL, -h + 0.9 + p * 0.65, 2.1, -3.6, 10, 1.3); }
      else { K.cyl("plain", 0xf4f1ea, 0.22, 0.18, 0.04, 1.6, 1.04, -0.85, 14); K.cyl("plain", 0xf2c4a0, 0.17, 0.17, 0.16, 1.6, 1.08, -0.85, 14); }
      spots.push({ lx: 0, lz: 0.35, kind: "snack" }); slots.push({ lx: -1.0, lz: -2.0, ry: 0, pose: "idle", role: "vendor" }, { lx: 1.4, lz: -1.9, ry: 0, pose: "idle", role: "vendor" }, { lx: -1.6, lz: 0.45, ry: PI, pose: "idle" }, { lx: 0.9, lz: 0.6, ry: PI, pose: "idle" }, { lx: 2.6, lz: 1.6, ry: PI + 0.5, pose: "idle" });
    } else if (type === "coffee") {
      counter(-h + 0.4, h - 0.4, true); K.box("metal", 0xd8d8d8, 0.8, 0.45, 0.5, 1.2, 1.04, -0.95); K.box("metal", 0x2b2c2e, 0.8, 0.06, 0.5, 1.2, 1.49, -0.95); K.cyl("metal", 0x2b2c2e, 0.08, 0.1, 0.42, 2.2, 1.04, -0.95, 10);
      for (var c2 = 0; c2 < 8; c2++) K.cyl("plain", 0xf4f1ea, 0.045, 0.035, 0.09, 1.0 + (c2 % 4) * 0.13, 1.55, -0.85 - (c2 >> 2) * 0.13, 8);
      K.aab("glass", 0xffffff, -h + 0.7, -0.6, 1.04, 1.46, -1.2, -0.62); K.aab("glow", 0xffe7c2, -h + 0.75, -0.65, 1.42, 1.44, -1.15, -0.67); for (var t2 = 0; t2 < 5; t2++) K.sph("plain", [0xc98a4a, 0xe8c37a, 0x8a4a2a][t2 % 3], 0.1, -h + 0.95 + t2 * 0.42, 1.12, -0.9, 8, 1, 0.55, 1);
      backBar(); menuFrame(); for (var bg = 0; bg < 6; bg++) K.box("plain", bg % 3 ? 0xb08a5a : 0x3d2a1e, 0.16, 0.24, 0.1, -h + 0.9 + bg * 0.22, 1.04, -0.75);
      spots.push({ lx: 0.4, lz: 0.35, kind: "coffee" }); slots.push({ lx: 0.6, lz: -2.0, ry: 0, pose: "idle", role: "vendor" }, { lx: -0.8, lz: 0.5, ry: PI, pose: "idle" }, { lx: 0.2, lz: 1.3, ry: PI, pose: "idle" }, { lx: 0.8, lz: 2.1, ry: PI - 0.3, pose: "idle" });
    } else if (type === "artisan") {
      [-2.2, 0, 2.2].forEach(function (x, i) { K.aab("wood", 0x8c5a34, x - 0.75, x + 0.75, 0, 0.78, -1.75, -0.95); K.aab("wood", 0x6e4628, x - 0.78, x + 0.78, 0.78, 0.82, -1.78, -0.92); pots(K, R, x - 0.6, x + 0.6, 0.82, -1.35, 4, false); sol.push([x, -1.35, 1.5, 0.8, 0, 0.82]); });
      K.aab("wood", 0x5e3c22, -h + 0.3, h - 0.3, 0, 0.6, -4.95, -4.5); pots(K, R, -h + 0.4, h - 0.4, 0.6, -4.72, 9, false);
      for (var b2 = 0; b2 < 6; b2++) K.lathe("wick", 0xd9b98a, [[0, 0], [0.2, 0], [0.26, 0.12], [0.27, 0.3]], -h + 0.6 + b2 * 0.42, 0, -3.6 + (b2 % 2) * 0.3, 10, 0.9 + R() * 0.5);
      pots(K, R, -h + 0.5, -0.8, 0, -3.0, 3, true); K.aab("wood", 0x6e4628, h - 1.4, h - 0.3, 0, 0.95, -3.4, -2.6); sol.push([h - 0.85, -3.0, 1.1, 0.8, 0, 0.95]);
      spots.push({ lx: 0, lz: -0.4, kind: "look" }); slots.push({ lx: h - 0.85, lz: -3.8, ry: 0, pose: "idle", role: "vendor" }, { lx: -1.2, lz: -0.45, ry: PI, pose: "idle" }, { lx: 1.1, lz: -0.5, ry: PI + 0.3, pose: "idle" }, { lx: 0, lz: -2.6, ry: 0.6, pose: "idle" });
    } else {
      // goods: shelving on three walls, a centre table with crates and baskets, barrels by the door
      var shelf = function (x0, x1, z0, z1) { K.aab("wood", 0x6e4628, x0, x1, 0, 2.6, Math.min(z0, z1), Math.min(z0, z1) + 0.04); for (var t = 0; t < 4; t++) { K.aab("wood", 0x8c5a34, x0, x1, 0.4 + t * 0.58, 0.44 + t * 0.58, Math.min(z0, z1), Math.max(z0, z1)); jars(K, R, x0 + 0.1, x1 - 0.1, 0.44 + t * 0.58, (z0 + z1) / 2, Math.round((x1 - x0) / 0.3), [0xe8c34a, 0xc98a4a, 0x8a4a2a, 0xc0462d, 0x6f9a3a, 0xf0e4c4, 0x2f5d7c]); } sol.push([(x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, Math.abs(z1 - z0), 0, 2.6]); };
      K.aab("wood", 0x5e3c22, -h + 0.3, h - 0.3, 0, 0.92, -4.95, -4.4); sol.push([0, -4.65, W - 0.6, 0.6, 0, 0.92]); jars(K, R, -h + 0.5, h - 0.5, 0.92, -4.65, 12, [0xe8c34a, 0xc98a4a, 0x8a4a2a, 0xc0462d, 0x6f9a3a, 0xf0e4c4]);
      K.aab("wood", 0x8c5a34, -1.3, 1.3, 0, 0.82, -2.6, -1.6); sol.push([0, -2.1, 2.6, 1.0, 0, 0.85]);
      for (var cr = 0; cr < 4; cr++) { var cx = -0.95 + cr * 0.63; K.aab("plank", 0xe0bc8c, cx - 0.28, cx + 0.28, 0.82, 1.0, -2.45, -1.75); var fcol = [0xc0462d, 0xe8c34a, 0x6f9a3a, 0x8a3a6a][cr]; for (var f = 0; f < 6; f++) K.sph("plain", fcol, 0.07, cx - 0.16 + (f % 3) * 0.16, 1.02, -2.25 + (f >> 1 & 1) * 0.3, 7); }
      for (var bb = 0; bb < 2; bb++) { K.cyl("plank", 0xb07a52, 0.32, 0.36, 0.8, -h + 0.9 + bb * 0.8, 0, -0.6, 12); sol.push([-h + 0.9 + bb * 0.8, -0.6, 0.66, 0.66, 0, 0.8]); }
      for (var b3 = 0; b3 < 3; b3++) K.lathe("wick", 0xd9b98a, [[0, 0], [0.22, 0], [0.28, 0.14], [0.3, 0.32]], h - 0.7 - b3 * 0.6, 0, -0.9, 10, 1);
      spots.push({ lx: 0, lz: -0.6, kind: "look" }); slots.push({ lx: 0.4, lz: -3.6, ry: 0, pose: "idle", role: "vendor" }, { lx: -0.6, lz: -1.2, ry: PI, pose: "idle" }, { lx: 1.6, lz: -2.8, ry: -PI / 2, pose: "idle" });
    }
    SHOP[type] = { geo: K.merged(), sol: sol, spots: spots, slots: slots, tris: K.tris }; return SHOP[type];
  }
  function shopSolids(type) { return shopPrefab(type).sol; }

  // a terrace bay: bistro tables and chairs (or a long table), umbrellas on some bays, a potted plant (frame: z = 0 at the restaurant
  // front, the railing at +6.8, x across the bay)
  var TER = {};
  function chair(K, x, z, ry) { var c = Math.cos(ry), sn = Math.sin(ry), at = function (lx, lz) { return [x + lx * c + lz * sn, z - lx * sn + lz * c]; };
    var p = at(0, 0); K.box("plain", 0xc49a5e, 0.44, 0.06, 0.44, p[0], 0.44, p[1], ry); [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].forEach(function (q) { var a = at(q[0], q[1]); K.box("metal", COL.steel, 0.035, 0.44, 0.035, a[0], 0, a[1], ry); });
    var b = at(0, -0.21); K.box("plain", 0xb8894e, 0.42, 0.42, 0.04, b[0], 0.5, b[1], ry, -0.12); }
  function table(K, x, z, r) { K.cyl("wood", 0x8c5a34, r, r, 0.04, x, 0.72, z, 16); K.cyl("metal", COL.steel, 0.04, 0.04, 0.72, x, 0, z, 6); K.cyl("metal", COL.steel, 0.25, 0.25, 0.03, x, 0, z, 10); K.cyl("plain", 0xf4f1ea, 0.1, 0.1, 0.02, x + r * 0.4, 0.76, z, 10); K.cyl("glass", 0xffffff, 0.035, 0.03, 0.12, x - r * 0.3, 0.76, z + 0.1, 8); }
  function terrPrefab(umb) {
    var key = umb ? "u" : "l"; if (TER[key]) return TER[key]; var K = new Kit(), sol = [], slots = [], R = rng(umb ? 51 : 77);
    if (umb) { [[-1.9, 2.6], [1.9, 4.6]].forEach(function (t, i) { table(K, t[0], t[1], 0.42); sol.push([t[0], t[1], 0.8, 0.8, 0, 0.76]); [0, PI].forEach(function (a, j) { var cx = t[0] + Math.sin(a) * 0.7, cz = t[1] + Math.cos(a) * 0.7, face = a + PI; chair(K, cx, cz, face); sol.push([cx, cz, 0.46, 0.46, 0, 0.47, { seat: true, face: face, mkSeat: 1 }]); slots.push({ lx: cx, lz: cz, ry: face, pose: "sit" }); });
        K.cyl("metal", 0xe9e2d6, 0.025, 0.025, 2.3, t[0], 0.76, t[1], 6); K.cyl("plain", 0xf1e8d4, 0.02, 1.25, 0.42, t[0], 2.62, t[1], 16, 0, 0, 0, true); K.cyl("plain", 0xe6dcc6, 1.25, 1.27, 0.14, t[0], 2.5, t[1], 16, 0, 0, 0, true); }); }
    else { K.aab("wood", 0x8c5a34, -1.4, 1.4, 0.72, 0.77, 3.0, 3.85); [-1.1, 1.1].forEach(function (x) { K.aab("metal", COL.steel, x - 0.04, x + 0.04, 0, 0.72, 3.38, 3.47); }); sol.push([0, 3.42, 2.8, 0.85, 0, 0.77]);
      for (var c = 0; c < 3; c++) [-1, 1].forEach(function (sd) { var cx = -0.95 + c * 0.95, cz = 3.42 + sd * 0.72, face = sd > 0 ? PI : 0; chair(K, cx, cz, face); sol.push([cx, cz, 0.46, 0.46, 0, 0.47, { seat: true, face: face, mkSeat: 1 }]); slots.push({ lx: cx, lz: cz, ry: face, pose: "sit" }); });
      K.cyl("plain", 0xf4f1ea, 0.1, 0.1, 0.02, 0, 0.78, 3.42, 10); }
    K.lathe("plain", COL.clay, [[0, 0], [0.24, 0], [0.32, 0.1], [0.34, 0.55], [0.36, 0.6]], 3.5, 0, 0.8, 14); K.cyl("plain", COL.soil, 0.3, 0.3, 0.02, 3.5, 0.56, 0.8, 12); [0, 1.05, 2.1].forEach(function (a) { card(K, FOL.grass, 1.0, 0.95, 3.5, 1.02, 0.8, a, 0xf0f4e4); }); sol.push([3.5, 0.8, 0.7, 0.7, 0, 0.7]);
    slots.push({ lx: 2.2 + R(), lz: 6.1, ry: 0, pose: "idle", rail: 1 });
    TER[key] = { geo: K.merged(), sol: sol, slots: slots }; return TER[key];
  }
  function terrSolids(T) { return terrPrefab(T.umb).sol; }
  // a clay planter (unit radius and height 0.72), its soil, a timber seat ring
  function buildPlanter() { var K = new Kit(); K.lathe("plain", COL.clay, [[0.0, 0], [0.86, 0], [0.95, 0.06], [1.0, 0.5], [1.05, 0.68], [1.02, 0.72], [0.93, 0.72], [0.9, 0.62]], 0, 0, 0, 28); K.cyl("plain", COL.soil, 0.9, 0.9, 0.02, 0, 0.62, 0, 24); K.cyl("plain", 0x8c7458, 0.88, 0.88, 0.02, 0, 0.635, 0, 24); return K.merged(); }
  function buildSeatRing() { var K = new Kit(); for (var i = 0; i < 24; i++) { var a = i * TAU / 24, b = (i + 1) * TAU / 24; K.beam("wood", 0xb98a5c, [Math.sin(a) * 1.18, 0.46, Math.cos(a) * 1.18], [Math.sin(b) * 1.18, 0.46, Math.cos(b) * 1.18], 0.36, 0.06); } for (var j = 0; j < 8; j++) { var c = j * TAU / 8; K.box("metal", COL.steel, 0.06, 0.44, 0.06, Math.sin(c) * 1.18, 0, Math.cos(c) * 1.18); } return K.merged(); }

  // the nave pieces that are one of a kind: the partner kiosks, the busker corner (one merged set)
  function buildNave() {
    var K = new Kit(), L = layout(); L.kiosks.forEach(function (Kk) { var d = Kk.def, col = new THREE.Color(d.col || "#1d2a44").getHex(), acc = new THREE.Color(d.acc || "#f4cd5a").getHex(), x = Kk.x, z = Kk.z, ry = Kk.ry, c = Math.cos(ry), sn = Math.sin(ry);
      var mk = K.mark(); K.box("trav", 0xe0d2bb, 3.4, 0.12, 2.4, 0, 0, 0); K.box("plain", col, 3.0, 2.8, 0.14, 0, 0.12, -0.95); K.box("plain", acc, 3.0, 0.12, 0.16, 0, 2.92, -0.95); K.box("wood", 0x8c5a34, 2.4, 1.0, 0.6, 0, 0.12, 0.35); K.box("plain", col, 2.42, 0.6, 0.02, 0, 0.3, 0.66); K.box("trav", 0xf2ede4, 2.5, 0.05, 0.7, 0, 1.12, 0.35);
      K.box("plain", col, 3.4, 0.16, 2.0, 0, 2.92, -0.1); K.box("metal", COL.steel, 0.06, 2.8, 0.06, -1.6, 0.12, 0.8); K.box("metal", COL.steel, 0.06, 2.8, 0.06, 1.6, 0.12, 0.8); K.box("plain", 0xf4f1ea, 0.3, 0.02, 0.22, 0.6, 1.17, 0.4); K.box("plain", 0xf4f1ea, 0.3, 0.02, 0.22, -0.5, 1.17, 0.3);
      K.since(mk, function (g) { xf(g, x, 0, z, ry); }); });
    var b = L.busker; if (b) { var mk2 = K.mark(); K.cyl("plain", 0x8a3b2a, 1.1, 1.1, 0.02, 0, 0.0, 0, 20); K.cyl("wood", 0x6e4628, 0.2, 0.2, 0.5, 0, 0.02, 0, 10); K.box("plain", 0x1c1f24, 0.5, 0.55, 0.32, 0.8, 0.02, -0.3); K.box("plain", 0x2a1e18, 0.9, 0.12, 0.35, -0.7, 0.02, 0.4, 0.4); K.box("plain", 0xb03a2e, 0.82, 0.04, 0.28, -0.7, 0.13, 0.4, 0.4); K.since(mk2, function (g) { xf(g, b.x, 0, b.z, 0); }); }
    return K.merged();
  }

  // ───────────────────────── the weekend market: a stall frame, its canopy (tinted per stall), the goods of each type ─────────────────────────
  // frame: z = 0 at the front of the stall, the back at -3, x across (w 4, the Giveback stand 7.2)
  function buildStallFrame(w) { var K = new Kit(), h = w / 2; [[-h + 0.08, 0.15, 2.65], [h - 0.08, 0.15, 2.65], [-h + 0.08, -3.0, 2.85], [h - 0.08, -3.0, 2.85]].forEach(function (p) { K.box("plank", 0xd0a878, 0.09, p[2], 0.09, p[0], 0, p[1]); });
    K.aab("plank", 0xe0bc8c, -h + 0.15, h - 0.15, 0.86, 0.92, -0.95, -0.15); [-h + 0.3, h - 0.3].forEach(function (x) { K.box("plank", 0xc09868, 0.06, 0.86, 0.6, x, 0, -0.55); }); K.aab("plain", 0xf0e6d2, -h + 0.15, h - 0.15, 0.3, 0.86, -0.16, -0.13);
    K.aab("plank", 0xd0a878, -h + 0.2, h - 0.2, 0, 0.5, -2.85, -1.95); K.aab("plank", 0xe0bc8c, -h + 0.2, h - 0.2, 0.5, 1.0, -2.85, -2.45); K.aab("plank", 0xe0bc8c, -h + 0.2, h - 0.2, 1.0, 1.5, -2.85, -2.7);
    for (var c = 0; c < Math.round(w / 1.4); c++) K.box("plank", 0xe0bc8c, 0.5, 0.32, 0.4, -h + 0.6 + c * 0.9, 0, 0.45 + (c % 2) * 0.1, (c % 3) * 0.2);
    return K.merged(); }
  function buildCanopy(w) { var K = new Kit(), h = w / 2 + 0.2, fz = 0.35, bz = -3.2, rz = -1.3, yf = 2.62, yr = 3.25, yb = 2.85;
    K.face("plain", 0xffffff, [-h, yf, fz], [h, yf, fz], [h, yr, rz], [-h, yr, rz], [0, 1, 0.6]); K.face("plain", 0xffffff, [-h, yb, bz], [h, yb, bz], [h, yr, rz], [-h, yr, rz], [0, 1, -0.6]);
    K.face("plain", 0xf2ece0, [-h, yf, fz], [h, yf, fz], [h, yr, rz], [-h, yr, rz], [0, -1, -0.6]); K.face("plain", 0xf2ece0, [-h, yb, bz], [h, yb, bz], [h, yr, rz], [-h, yr, rz], [0, -1, 0.6]);
    var n = Math.round(w / 0.5); for (var i = 0; i < n; i++) { var x0 = -h + 2 * h * i / n, x1 = -h + 2 * h * (i + 1) / n, xm = (x0 + x1) / 2; K.tris3("plain", 0xe8e0d0, [[x0, yf, fz], [x1, yf, fz], [xm, yf - 0.28, fz + 0.01]]); K.tris3("plain", 0xe8e0d0, [[x1, yf, fz], [x0, yf, fz], [xm, yf - 0.28, fz + 0.01]]); }
    K.face("plain", 0xf2ece0, [-h, yf, fz], [-h, yb, bz], [-h, yr, rz], [-h, yr, rz], [-1, 0, 0]); K.face("plain", 0xf2ece0, [h, yf, fz], [h, yb, bz], [h, yr, rz], [h, yr, rz], [1, 0, 0]);
    return K.merged(); }
  var STALLG = {};
  function stallGoods(type) {
    if (STALLG[type]) return STALLG[type]; var K = new Kit(), R = rng(type.length * 31 + 7), h = 1.85, slots = [{ lx: 0, lz: -1.5, ry: 0, pose: "idle", role: "vendor" }];
    var crate = function (x, y, z, col, tilt) { K.box("plank", 0xe0bc8c, 0.55, 0.2, 0.38, x, y, z, 0, tilt || 0); for (var f = 0; f < 8; f++) K.sph("plain", col, col === 0x4f8a3a && f % 4 === 0 ? 0.11 : 0.065, x - 0.18 + (f % 4) * 0.12, y + 0.2, z - 0.08 + (f >> 2) * 0.16, 7); };
    if (type === "produce") { var cols = [0xc0362a, 0xe88a2a, 0xe8d04a, 0x6f9a3a, 0x7a2a5a, 0x4f8a3a, 0xd9b26a, 0xb84a3a]; for (var i = 0; i < 6; i++) crate(-h + 0.45 + i * 0.6, 0.92, -0.55, cols[i % cols.length], -0.12); for (var j = 0; j < 5; j++) crate(-h + 0.6 + j * 0.7, 1.0, -2.6, cols[(j + 3) % cols.length]); for (var m = 0; m < 3; m++) K.sph("plain", 0x5e8a3a, 0.2, -1.2 + m * 0.5, 0.62, -2.15, 10, 1, 0.85, 1); K.lathe("wick", 0xd9b98a, [[0, 0], [0.22, 0], [0.3, 0.16], [0.32, 0.3]], 1.5, 0, 0.45, 10); }
    else if (type === "coffee") { K.box("metal", 0xd8d8d8, 0.7, 0.42, 0.45, 0.9, 0.92, -0.6); K.box("metal", 0x2b2c2e, 0.7, 0.05, 0.45, 0.9, 1.34, -0.6); for (var c = 0; c < 10; c++) K.cyl("plain", c % 2 ? 0xf4f1ea : 0xb08a5a, 0.045, 0.035, 0.1, -1.4 + (c % 5) * 0.14, 0.92, -0.45 - (c > 4 ? 0.15 : 0), 8); K.box("plain", 0x1d211f, 0.7, 0.9, 0.04, -0.9, 0.92, -0.85, 0, -0.2); for (var b = 0; b < 8; b++) K.box("plain", b % 2 ? 0xb08a5a : 0x3d2a1e, 0.16, 0.24, 0.1, -1.6 + b * 0.42, 1.0, -2.6); }
    else if (type === "pottery" || type === "crafts") { pots(K, R, -h + 0.3, h - 0.3, 0.92, -0.55, type === "pottery" ? 7 : 5, false); pots(K, R, -h + 0.3, h - 0.3, 1.0, -2.6, 6, false); pots(K, R, -h + 0.5, -0.4, 0, 0.6, 2, true);
      if (type === "crafts") { for (var k = 0; k < 6; k++) K.box("wood", [0x8c5a34, 0xc98a4a, 0x6e4628][k % 3], 0.18, 0.22 + R() * 0.2, 0.12, -1.3 + k * 0.5, 1.5, -2.75); } }
    else if (type === "textiles") { K.aab("wood", 0x6e4628, -h + 0.1, h - 0.1, 2.35, 2.42, -2.95, -2.85); [[0xc0462d, 0xe8c34a, 0x2b2b2b], [0x2f5d7c, 0xd98a2b, 0xf0e4c4], [0x6f4a8a, 0xe8c34a, 0x2a7a3e], [0x2a7a3e, 0xe8dcc4, 0xc0462d]].forEach(function (rc, i) { rug(K, -1.4 + i * 0.95, 0.9, -2.9, 0.85, 1.42, rc, 0); }); for (var t = 0; t < 7; t++) K.box("plain", [0xc0462d, 0x2f5d7c, 0xe8c34a, 0x6f4a8a, 0xe8dcc4, 0x2a7a3e, 0xd98a2b][t], 0.42, 0.1 + R() * 0.06, 0.32, -h + 0.5 + t * 0.5, 0.92, -0.55); }
    else if (type === "flowers") { for (var f = 0; f < 9; f++) { var fx = -h + 0.4 + f * 0.42, fz = f % 2 ? -0.5 : -2.4; K.cyl("metal", 0x9aa0a4, 0.14, 0.12, 0.34, fx, f % 2 ? 0.92 : 0.5, fz, 10); var fy = (f % 2 ? 0.92 : 0.5) + 0.34; for (var q = 0; q < 5; q++) K.ico("plain", [0xe84a6a, 0xf2c94a, 0xf4f1ea, 0xc04ad8, 0xff8a3a][(f + q) % 5], 0.08, fx + (R() - 0.5) * 0.2, fy + 0.2 + R() * 0.2, fz + (R() - 0.5) * 0.2); K.ico("plain", COL.green, 0.12, fx, fy + 0.08, fz, 1, 1.5, 1); } }
    else if (type === "baskets") { for (var bs = 0; bs < 10; bs++) K.lathe("wick", [0xd9b98a, 0xc9a06a, 0xe6cfa0][bs % 3], [[0, 0], [0.16, 0], [0.22, 0.1], [0.24, 0.24]], -h + 0.35 + (bs % 5) * 0.75, bs < 5 ? 0.92 : 1.0, bs < 5 ? -0.55 : -2.6, 10, 0.9 + R() * 0.6); for (var bf = 0; bf < 4; bf++) K.lathe("wick", 0xc9a06a, [[0, 0], [0.26, 0], [0.34, 0.16], [0.36, 0.42]], -1.5 + bf * 1.0, 0, 0.55, 10, 1); }
    else if (type === "merch") { var H2 = 3.4; K.aab("metal", COL.steel, -H2 + 0.3, -0.4, 1.9, 1.94, -2.7, -2.66); for (var s2 = 0; s2 < 9; s2++) { var sx = -H2 + 0.5 + s2 * 0.32, sc = [0xf5f1e6, 0x1f7a3f, 0x141414, 0x1f6b3a, 0xf4cd5a][s2 % 5]; K.box("plain", sc, 0.5, 0.62, 0.04, sx, 1.22, -2.68, 0); K.box("plain", sc, 0.18, 0.14, 0.03, sx - 0.3, 1.66, -2.68, 0, 0, 0.6); K.box("plain", sc, 0.18, 0.14, 0.03, sx + 0.3, 1.66, -2.68, 0, 0, -0.6); }
      for (var cp = 0; cp < 8; cp++) { var cx2 = 0.4 + (cp % 4) * 0.62, cz2 = -0.6 - (cp >> 2) * 0.32; K.sph("plain", cp % 2 ? 0x1f7a3f : 0xf5f1e6, 0.11, cx2, 0.92, cz2, 10, 1, 0.6, 1); K.box("plain", cp % 2 ? 0x1f7a3f : 0xf5f1e6, 0.16, 0.02, 0.1, cx2, 0.92, cz2 + 0.12); }
      K.box("plain", 0xb08a5a, 0.7, 0.5, 0.5, -2.4, 0.92, -0.55); K.box("plain", 0x4dde6f, 0.72, 0.12, 0.52, -2.4, 1.2, -0.55); for (var cn = 0; cn < 6; cn++) K.cyl("metal", [0xc0462d, 0xe8c34a, 0x2f5d7c][cn % 3], 0.05, 0.05, 0.12, -2.6 + (cn % 3) * 0.15, 1.42, -0.62 + (cn >> 1 & 1) * 0.14, 8);
      slots = [{ lx: -1.4, lz: -1.6, ry: 0, pose: "idle", role: "vendor" }, { lx: 1.6, lz: -1.6, ry: 0, pose: "idle", role: "vendor" }, { lx: 0.8, lz: 1.1, ry: PI, pose: "idle" }, { lx: -2.0, lz: 1.3, ry: PI + 0.3, pose: "idle" }]; }
    if (type !== "merch") slots.push({ lx: (R() - 0.5) * 2, lz: 1.0 + R() * 0.6, ry: PI + (R() - 0.5), pose: "idle" });
    STALLG[type] = { geo: K.merged(), slots: slots }; return STALLG[type];
  }
  // the string lights over the aisle: poles at the stall fronts, wires sagging across, a warm bulb every 0.55 m
  function buildFestoons() {
    var K = new Kit(), L = layout(), rows = [[], []]; L.stalls.forEach(function (T) { var ri = T.ry === 0 ? 0 : 1; var fz = T.z + (ri === 0 ? 0.6 : -0.6); rows[ri].push([T.x - T.w / 2 + 0.1, fz], [T.x + T.w / 2 - 0.1, fz]); });
    var poles = [rows[0].filter(function (p, i) { return i % 3 === 0; }), rows[1].filter(function (p, i) { return i % 3 === 1; })], top = 4.3;
    poles.forEach(function (row) { row.forEach(function (p) { K.cyl("wood", 0x6e4f36, 0.06, 0.08, top + 0.2, p[0], 0, p[1], 6); }); });
    var wire = function (A, B) { var n = Math.max(3, Math.round(Math.hypot(B[0] - A[0], B[1] - A[1]) / 0.55)), prev = null; for (var i = 0; i <= n; i++) { var t = i / n, x = lerp(A[0], B[0], t), z = lerp(A[1], B[1], t), y = top - 1.1 * 4 * t * (1 - t); var p = [x, y, z]; if (prev) K.tube("metal", COL.steel, prev, p, 0.008, 3); if (i > 0 && i < n) K.ico("glow", COL.bulb, 0.055, x, y - 0.07, z, 1, 1.25, 1); prev = p; } };
    var a = poles[0], b = poles[1]; for (var i = 0; i < Math.min(a.length, b.length); i++) { wire(a[i], b[i]); if (b[i + 1]) wire(a[i], b[i + 1]); if (a[i + 1]) wire(a[i], a[i + 1]); if (b[i + 1]) wire(b[i], b[i + 1]); }
    return K.merged();
  }

  // ───────────────────────── defer hook: build every mesh at its final height ─────────────────────────
  function lw(P, lx, lz) { var c = Math.cos(P.ry || 0), sn = Math.sin(P.ry || 0); return [P.x + lx * c + lz * sn, P.z - lx * sn + lz * c]; }
  var GR = MK.groups = {};
  function signs() {
    var K = new Kit(), L = layout(), yf = 0;
    L.shops.forEach(function (P) { fasciaSlot(P.def.name, P.def.tag, P.n === 2); }); L.terr.forEach(function (T) { if (T.rest) fasciaSlot(T.rest.name, T.rest.tag, true); }); L.kiosks.forEach(function (Kk) { kioskSlot(Kk.def); }); hallSlot(); logoSlot();
    L.shops.forEach(function (P) { var d = P.def, uv = fasciaSlot(d.name, d.tag, P.n === 2); var w = P.n === 2 ? 9.4 : 6.6, hh = w / 6.4; var c = lw(P, 0, 0.3); signQuad(K, uv, w, Math.min(hh, 1.2), c[0], 4.18, c[1], P.ry);
      if (d.menu && (P.type === "food" || P.type === "coffee" || P.type === "sweets")) { var mu = menuSlot(d.name, d.name, d.menu); var xs = P.n === 2 ? [-S.B / 2, S.B / 2] : [0]; xs.forEach(function (ox) { var m = lw(P, ox + 2.3, -4.88); signQuad(K, mu, 1.6, 2.0, m[0], 2.45, m[1], P.ry); }); } });
    L.terr.forEach(function (T) { if (!T.rest) return; var uv = fasciaSlot(T.rest.name, T.rest.tag, true); var c = lw(T, 0, 0.27); signQuad(K, uv, 6.4, 1.0, c[0], S.RS - 0.55, c[1], T.ry); });
    L.kiosks.forEach(function (Kk) { var uv = kioskSlot(Kk.def); var c = lw(Kk, 0, -0.86); signQuad(K, uv, 2.8, 0.7, c[0], 2.15, c[1], Kk.ry); });
    var hu = hallSlot(); S.ENT.forEach(function (i) { signQuad(K, hu, 6.4, 1.0, S.bc(i), 5.5, S.ZN - 2.7, PI); });
    [[S.X0 + 0.05, -PI / 2], [S.X0 + 0.4, PI / 2], [S.X1 - 0.05, PI / 2], [S.X1 - 0.4, -PI / 2]].forEach(function (q) { signQuad(K, hu, 6.4, 1.0, q[0], 4.75, S.ZC, q[1]); });
    MK.n.signTris = K.tris; return K.merged();
  }
  function stallSigns() { var K = new Kit(), L = layout(); L.stalls.forEach(function (T) { if (T.type === "merch") { var g = logoSlot(); var c = lw(T, 0, 0.36); signQuad(K, g, 3.2, 1.0, c[0], 2.25, c[1], T.ry); var b = lw(T, 0, -2.92); signQuad(K, g, 3.2, 1.0, b[0], 2.2, b[1], T.ry); return; }
      var bg = { produce: "#e9dcc0", coffee: "#2d2219", crafts: "#efe4cf", pottery: "#f1d9c4", textiles: "#f1e6d0", flowers: "#f4e3e6", baskets: "#efe2c8" }[T.type], fg = T.type === "coffee" ? "#f4e9c8" : "#4a2c18"; var uv = boardSlot(T.name, bg, fg); var c2 = lw(T, 0, 0.37); signQuad(K, uv, 1.7, 0.42, c2[0], 2.32, c2[1], T.ry); });
    return K.merged(); }
  // the stocked shelves: one generated texture (2 x 3 tiles) on every shop's back wall and one side wall, and behind the stalls
  function stockTile(i) { var c = i % 2, r = Math.floor(i / 2); return [c * 0.5, 1 - (r + 1) / 3, (c + 1) * 0.5, 1 - r / 3]; }
  function stockQuad(K, i, w, h, x, y, z, ry) { var t = stockTile(i); return K.quad("stock", 0xffffff, w, h, x, y, z, ry || 0, 0, true, t[0] + 0.004, t[1] + 0.004, t[2] - 0.004, t[3] - 0.004); }
  function stockGeo() {
    var K = new Kit(), L = layout(), map = { food: [2, 3], sweets: [4, 3], coffee: [5, 4], artisan: [0, 1], goods: [3, 2] }, yg = S.G + 0.04 - YF();
    L.shops.forEach(function (P, k) { var m = (map[P.type] || [3, 2]).slice(); if (P.type === "artisan" && k % 2) m = [1, 0]; if (P.type === "food" && k % 3 === 1) m = [3, 2]; if (P.type === "goods" && k % 2) m = [2, 3];
      (P.n === 2 ? [-S.B / 2, S.B / 2] : [0]).forEach(function (ox, hi) { var c = lw(P, ox, -4.93); stockQuad(K, m[0], 6.9, 2.4, c[0], 2.15, c[1], P.ry);
        (P.n === 2 ? [hi ? 1 : -1] : [-1, 1]).forEach(function (sd, si) { var c2 = lw(P, ox + sd * 3.88, -3.15); stockQuad(K, si ? [1, 0, 4, 2, 5, 3][m[0]] : m[1], 3.2, 2.3, c2[0], 2.05, c2[1], P.ry + (sd < 0 ? PI / 2 : -PI / 2)); }); }); });
    var smap = { produce: 2, pottery: 0, crafts: 0, textiles: 1, coffee: 5 };
    L.stalls.forEach(function (T) { var i = smap[T.type]; if (i === undefined) return; var c = lw(T, 0, -2.93); stockQuad(K, i, 3.6, 1.1, c[0], yg + 1.62, c[1], T.ry); });
    return K.merged().stock;
  }
  function addGroup(key, g, y) { g.position.y = y || 0; scene.add(g); GR[key] = g; return g; }
  // Everything static of the hall and the market is drawn by BatchedMeshes: one per base material (and a second set for the few
  // bases that cast shadows), every prefab added once as a geometry and placed by instance (multi draw: one call per base, the
  // instances culled one by one against each camera, the detail switched off by distance).
  var BC = MK.bc = { e: [], sets: {}, tags: {}, meshes: [] };
  function bput(tag, pre, list, y, cast) { if (!pre || !list.length) return; BC.e.push({ tag: tag, pre: pre, list: list, y: y || 0, cast: cast || [] }); }
  function bfinish() {
    var need = {}; BC.e.forEach(function (E) { for (var b in E.pre) { var key = (E.cast.indexOf(b) >= 0 ? "c:" : "n:") + b, q = need[key] || (need[key] = { v: 0, i: 0, geos: [] }); if (q.geos.indexOf(E.pre[b]) < 0) { q.geos.push(E.pre[b]); q.v += E.pre[b].attributes.position.count; } q.i += E.list.length; } });
    var G0 = new THREE.Group(); G0.name = "mk_batch"; G0.userData.noCull = true;
    for (var key in need) { var b = key.slice(2), q = need[key]; var bm = new THREE.BatchedMesh(q.i, q.v, 0, MAT[b] || MAT.plain); bm.name = "mk_b_" + key; bm.sortObjects = b === "glass" || b === "vglass"; bm.perObjectFrustumCulled = true; bm.castShadow = key[0] === "c"; bm.receiveShadow = b !== "glow" && b !== "glass" && b !== "vglass" && b !== "win"; if (b === "glass" || b === "vglass") bm.renderOrder = 2; bm.userData.shSet = true; bm.userData.noShadow = !bm.castShadow;
      bm.userData.gid = new Map(); q.geos.forEach(function (g) { bm.userData.gid.set(g, bm.addGeometry(g)); }); BC.sets[key] = bm; G0.add(bm); BC.meshes.push(bm); }
    BC.e.forEach(function (E) { for (var b in E.pre) { var key = (E.cast.indexOf(b) >= 0 ? "c:" : "n:") + b, bm = BC.sets[key], gid = bm.userData.gid.get(E.pre[b]), T = BC.tags[E.tag] || (BC.tags[E.tag] = []);
        E.list.forEach(function (q) { var id = bm.addInstance(gid); _e.set(0, q[3] || 0, 0); _q.setFromEuler(_e); _m4.compose(_v1.set(q[0], (q[1] || 0) + E.y, q[2]), _q, _v2.set(q[4] || 1, q[5] || q[4] || 1, q[6] || q[4] || 1)); bm.setMatrixAt(id, _m4); T.push([bm, id]); MK.n.tris = (MK.n.tris || 0) + E.pre[b].attributes.position.count / 3; }); } });
    BC.meshes.forEach(function (bm) { bm.computeBoundingBox(); bm.computeBoundingSphere(); }); MK.n.batches = BC.meshes.length; MK.n.instances = BC.meshes.reduce(function (s, m) { return s + m.instanceCount; }, 0); BC.e = [];
    return G0;
  }
  // show or hide every instance of a tag (the detail far away)
  function btag(tag, on) { var T = BC.tags[tag]; if (!T || T.on === on) return; T.on = on; for (var i = 0; i < T.length; i++) T[i][0].setVisibleAt(T[i][1], on); }
  function buildAll() {
    mats(); var L = layout(), yf = YF(), ym = YM(), yg = S.G + 0.04, t0 = nowMs(), step = function (name, fn) { var t = nowMs(); try { fn(); } catch (e) { note(name, e); } MK.n["ms_" + name] = Math.round(nowMs() - t); };
    var CAST = ["earth", "wood", "plain", "metal", "plank"];
    // the hall: shell (one of a kind), ribs, globes, deck greenery, shops, terraces, planters, the nave pieces
    step("shell", function () { bput("shell", buildShell(), one(0, 0, 0), yf, CAST); });
    step("ribs", function () { var list = []; for (var i = 0; i <= S.NB; i++) list.push([i === 0 ? S.X0 + 0.65 : i === S.NB ? S.X1 - 0.65 : S.bx(i), 0, S.ZC, 0]); bput("ribs", buildRib(), list, yf, ["wood"]); });
    step("globes", function () { var gl = [], cd = []; var addG = function (x, y, z, top) { gl.push([x, y, z, 0]); cd.push([x, y + 0.3, z, 0, 1, Math.max(0.05, top - y - 0.3), 1]); };
      for (var i = 1; i < S.NB; i++) { var x = S.bx(i); [-5.6, 5.6].forEach(function (dz, j) { var y = 7.6 + ((i + j) % 3) * 0.7; addG(x + (j ? 0.4 : -0.4), y, S.ZC + dz, archY(dz) - 0.9); }); }
      for (var b = 0; b < S.NB; b++) for (var s = -1; s <= 1; s += 2) { addG(S.bc(b), S.MZ + 3.3, S.zs(s, S.DE + 0.9), S.RS - 0.1); addG(S.bc(b) + (s > 0 ? 1.5 : -1.5), S.MZ - 1.75, S.zs(s, S.DF - 0.9), S.MZ - 0.38); }
      bput("globes", buildGlobe(), gl, yf); bput("globes", buildCord(), cd, yf); MK.n.globes = gl.length; });
    step("green", function () { var list = []; for (var s = -1; s <= 1; s += 2) (S["runs" + s] || []).forEach(function (rn) { for (var x = rn[0] + 1.4; x < rn[1] - 1.2; x += 3.0) list.push([x, S.MZ, S.zs(s, S.DE), s < 0 ? 0 : PI]); });
      bput("green", buildGreen(3), list.filter(function (q, i) { return i % 2 === 0; }), yf); bput("green", buildGreen(9), list.filter(function (q, i) { return i % 2 === 1; }), yf); });
    step("shops", function () { ["food", "coffee", "sweets", "artisan", "goods"].forEach(function (ty) { var list = []; L.shops.forEach(function (P) { if (P.type !== ty) return; if (P.n === 2) { var a = lw(P, -S.B / 2, 0), b = lw(P, S.B / 2, 0); list.push([a[0], 0, a[1], P.ry], [b[0], 0, b[1], P.ry]); } else list.push([P.x, 0, P.z, P.ry]); }); bput("shops", shopPrefab(ty).geo, list, yf); }); });
    step("terraces", function () { [true, false].forEach(function (u) { bput("terr", terrPrefab(u).geo, L.terr.filter(function (T) { return T.umb === u; }).map(function (T) { return [T.x, 0, T.z, T.ry]; }), ym); }); });
    step("planters", function () { var list = L.planters.map(function (p) { return [p.x, 0, p.z, 0, p.r, p.h / 0.72, p.r]; }).concat(L.small.map(function (p) { return [p.x, 0, p.z, 0, p.r, p.h / 0.72, p.r]; })); bput("planters", buildPlanter(), list, yf);
      [2.2, 1.7].forEach(function (rr, k) { bput("planters", buildPlanterCards(rr > 2 ? 9 : 7, 5 + k, rr), L.planters.filter(function (p) { return Math.abs(p.r - rr) < 0.05; }).map(function (p) { return [p.x, (p.h - 0.72), p.z, p.x * 0.37]; }), yf); });
      bput("planters", buildPlanterCards(3, 9, 0.75), L.small.map(function (p) { return [p.x, (p.h - 0.72) - 0.1, p.z, p.z]; }), yf);
      var seats = L.planters.filter(function (p) { return p.seat; }).map(function (p) { return [p.x, 0, p.z, 0, (p.r + 0.32) / 1.18, 1, (p.r + 0.32) / 1.18]; }); bput("planters", buildSeatRing(), seats, yf); });
    step("nave", function () { bput("nave", buildNave(), one(0, 0, 0), yf); });
    // the weekend market: frames, canopies (a few tints), goods by type, the festoons over the aisle
    step("stalls", function () { var nrm = L.stalls.filter(function (T) { return T.w < 5; }), wide = L.stalls.filter(function (T) { return T.w >= 5; }); var pl = function (a) { return a.map(function (T) { return [T.x, 0, T.z, T.ry]; }); };
      bput("stallf", buildStallFrame(4), pl(nrm), yg); bput("stallf", buildStallFrame(7.2), pl(wide), yg);
      var tints = [0xf4efe4, 0xc8653e, 0x8fa57a, 0xe0b44a, 0x9cb8c8, 0xd9876a, 0xefe2c4]; tints.forEach(function (tc, ti) { var geo = buildCanopy(4); for (var b in geo) { var cc = geo[b].attributes.color, c0 = new THREE.Color(tc); for (var i = 0; i < cc.count; i++) cc.setXYZ(i, cc.getX(i) * c0.r, cc.getY(i) * c0.g, cc.getZ(i) * c0.b); } bput("canopy", geo, pl(nrm.filter(function (T, i) { return (i * 5 + (T.ry ? 3 : 0)) % tints.length === ti; })), yg, ["plain"]); });
      var gw = buildCanopy(7.2); for (var b2 in gw) { var cw = gw[b2].attributes.color, cg = new THREE.Color(0x2a7a3e); for (var j = 0; j < cw.count; j++) cw.setXYZ(j, cw.getX(j) * cg.r, cw.getY(j) * cg.g, cw.getZ(j) * cg.b); } bput("canopy", gw, pl(wide), yg, ["plain"]);
      ["produce", "coffee", "pottery", "crafts", "textiles", "flowers", "baskets", "merch"].forEach(function (ty) { bput("goods", stallGoods(ty).geo, pl(L.stalls.filter(function (T) { return T.type === ty; })), yg); });
      bput("festoons", buildFestoons(), one(0, 0, 0), yg); });
    step("batch", function () { addGroup("batch", bfinish(), 0); });
    // the signs (one atlas, one draw) and the plaza paving (the game's stone paving material)
    step("signs", function () { var K = new Kit(), a = signs(), b = stallSigns(); var g = mergeList([a.sign, b.sign].filter(Boolean).map(function (q, i) { if (i === 1) q.translate(0, yg - yf, 0); return q; })); var m = new THREE.Mesh(g, MAT.sign); m.name = "mk_signs"; m.userData.noCull = true; m.receiveShadow = true; m.userData.shSet = true; m.userData.noShadow = true; addGroup("signs", m, yf); });
    step("stock", function () { var g = stockGeo(); if (g) { var m = new THREE.Mesh(g, MAT.stock); m.name = "mk_stock"; m.userData.noCull = true; m.receiveShadow = true; m.userData.shSet = true; m.userData.noShadow = true; addGroup("stock", m, yf); } });
    step("paving", function () { var PM = null; try { PM = planMats(); } catch (e) {} var m = PM && PM.stone ? PM.stone.clone() : new THREE.MeshStandardMaterial({ color: 0xd8c6a8 }); m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; m.name = "mk_paving";
      var x0 = S.X0 - 1.5, x1 = S.X1 + 1.5, z0 = S.sz0 - 3.5, z1 = S.ZN, nx = 66, nz = 8, P = [], U = [], I = []; for (var j = 0; j <= nz; j++) for (var i = 0; i <= nx; i++) { var x = lerp(x0, x1, i / nx), z = lerp(z0, z1, j / nz); P.push(x, 0, z); U.push(x / 4.5, z / 4.5); }
      for (var j2 = 0; j2 < nz; j2++) for (var i2 = 0; i2 < nx; i2++) { var a = j2 * (nx + 1) + i2, b = a + 1, c = a + nx + 1, d = c + 1; I.push(a, c, b, b, c, d); }
      var geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); geo.setIndex(I); geo.computeVertexNormals(); var mesh = new THREE.Mesh(geo, m); mesh.receiveShadow = true; mesh.userData.shSet = true; mesh.userData.noShadow = true; mesh.name = "mk_paving"; mesh.userData.noCull = true; addGroup("paving", mesh, S.G + 0.03); });
    // warm pools at night through the client's light pool (no new shader light count: the pool shows the nearest few)
    step("lights", function () { var g = new THREE.Group(); g.name = "mk_lights"; MK.lights = []; for (var i = 1; i < S.NB; i += 2) { var l = new THREE.PointLight(0xffb36a, 0, 26, 1.5); l.position.set(S.bx(i), 6.8, S.ZC); l.userData.k0 = 26; g.add(l); MK.lights.push(l); }
      [-430, -385, -340, -295].forEach(function (x) { var l2 = new THREE.PointLight(0xffc27a, 0, 18, 1.6); l2.position.set(x, S.G - yf + 3.4, (S.sz0 + S.sz1) / 2); l2.userData.k0 = 12; l2.userData.out = true; g.add(l2); MK.lights.push(l2); }); addGroup("lights", g, yf); });
    MK.n.buildMs = Math.round(nowMs() - t0);
    try { var W = window.PLAN_PERF; if (W && W.warmGroup) for (var k in GR) W.warmGroup(GR[k], { name: "market " + k }); } catch (e) { note("warm", e); }
  }
  function deferHook() {
    if (MK.off || !window.PLAN || !S || S.G === null) return; var t0 = nowMs();
    try { buildAll(); } catch (e) { note("build", e); } try { spotsSetup(); } catch (e) { note("spots", e); } try { peopleList(); } catch (e) { note("people list", e); }
    MK.n.deferMs = Math.round(nowMs() - t0); MK.ready = true;
  }

  // ───────────────────────── the crowd: posed people baked from the client's own rigs, drawn by four BatchedMeshes ─────────────────────────
  // Each pose (two standing idles, two walk phases, a walk and a stand with a shopping bag, seated; for the m and f bodies) is the
  // rig's skinned mesh posed by one of its clips and baked to a static mesh (body, skin and hair slots on their shared atlas), then
  // simplified by a position-only clustering that keeps each kept triangle's own uvs (about 1.8k to 3.1k triangles near, 330 to 590
  // far). Shirt, trousers, skin and bag colours are recoloured per person in the shader from a small data texture read by batch id
  // (the client's own avatar tint rules). Per body one batch holds the near people (they cast shadows) and one the far ones.
  var PPL = MK.ppl = { list: [], ready: false, poses: null, at: 0, cx: 1e9, cz: 1e9, near: 24, far: 210, bat: {} };
  var POSES = [["idleA", "idle", 0.6], ["idleB", "idle", 2.4], ["walkA", "walk", 0.55], ["walkB", "walk", 2.65], ["walkBag", "walk", 1.6, 1], ["idleBag", "idle", 1.5, 1], ["sit", "sit", 2.0]];
  var SHIRTS = [0xf5f1e6, 0x2a7a3e, 0xc0462d, 0x3a6ea5, 0xe0b040, 0x1c1f24, 0x6a3a8a, 0x8a4a2a, 0x6a8fb0, 0x2f8f8a, 0x9a3b52, 0x4a6b3a, 0xd8d0f0, 0x2b3a4a, 0xe07a30, 0xb8323a, 0x1f5f8f];
  var PANTS = [0x2b3a4a, 0x1c1f24, 0x6d5a3e, 0xd9cdb5, 0x3a3d42, 0x5a4632, 0x8a8478, 0x30405a, 0x7a2a2a];
  var SKINS = [0xf3d9c0, 0xe8c19a, 0xd9a877, 0xc98f63, 0xa86f46, 0x8d5a3b, 0x6b4226];
  var BAGS = [0xc9a06a, 0x2a7a3e, 0xe8dcc4, 0x8a3a2a, 0x3a6ea5, 0xd9b26a];
  function bakePose(b, clip, t) {
    var Cc = CHAR[b]; if (!Cc || !Cc.clips || !Cc.clips[clip]) return null; var root = THREE.SkeletonUtils.clone(Cc.scene); root.scale.setScalar(Cc.scale); root.position.y = Cc.yoff;
    var sk = [], hand = null; root.traverse(function (o) { if (o.isSkinnedMesh) sk.push(o); if (o.isBone && o.name === "RightHand") hand = o; }); var mixer = new THREE.AnimationMixer(root); mixer.clipAction(Cc.clips[clip]).play(); mixer.setTime(t); root.updateMatrixWorld(true);
    var v = new THREE.Vector3(), r = new THREE.Vector3(), map = null, parts = [];
    sk.forEach(function (m) { m.skeleton.update(); map = map || m.material.map; var g = m.geometry, pos = g.attributes.position, n = pos.count, P = new Float32Array(n * 3), RY = new Float32Array(n);
      for (var i = 0; i < n; i++) { v.fromBufferAttribute(pos, i); r.copy(v).applyMatrix4(m.matrixWorld); RY[i] = r.y; m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
      parts.push({ P: P, U: new Float32Array(g.attributes.uv.array), I: g.index ? g.index.array : null, n: n, RY: RY }); });
    var nv = 0, ni = 0; parts.forEach(function (p) { nv += p.n; ni += p.I ? p.I.length : p.n; }); var P = new Float32Array(nv * 3), U = new Float32Array(nv * 2), RY = new Float32Array(nv), I = new Uint32Array(ni), ov = 0, oi = 0;
    parts.forEach(function (p) { P.set(p.P, ov * 3); U.set(p.U, ov * 2); RY.set(p.RY, ov); if (p.I) for (var k = 0; k < p.I.length; k++) I[oi + k] = p.I[k] + ov; else for (var k2 = 0; k2 < p.n; k2++) I[oi + k2] = k2 + ov; ov += p.n; oi += p.I ? p.I.length : p.n; });
    // feet on the ground (the walk clip carries the feet about 10 cm over the stance); the rest height normalised for the tint
    var miny = 1e9, maxr = -1e9, minr = 1e9; for (var j = 0; j < nv; j++) { miny = Math.min(miny, P[j * 3 + 1]); maxr = Math.max(maxr, RY[j]); minr = Math.min(minr, RY[j]); } var lift = clip === "sit" ? 0 : -miny; for (var j2 = 0; j2 < nv; j2++) { P[j2 * 3 + 1] += lift; RY[j2] = (RY[j2] - minr) / Math.max(1e-6, maxr - minr) * 1.75; }
    var hp = null; if (hand) { hand.getWorldPosition(v); hp = [v.x, v.y + lift, v.z]; }
    return { P: P, U: U, I: I, RY: RY, map: map, n: nv, hand: hp };
  }
  // vertex clustering on position only (no cracks), the output unindexed: every kept triangle keeps the uvs and rest heights of its
  // own original corners (so the atlas stays put across uv seams), smooth normals averaged per cluster, the original facing kept
  function simplify(B, cell) {
    var N = B.n, P = B.P, U = B.U, idx = B.I, F = idx.length / 3, cmap = new Map(), acc = [], cellOf = new Int32Array(N), ON = new Float32Array(N * 3), f, k;
    for (f = 0; f < F; f++) { var i0 = idx[f * 3] * 3, i1 = idx[f * 3 + 1] * 3, i2 = idx[f * 3 + 2] * 3, ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2], vx = P[i2] - P[i0], vy = P[i2 + 1] - P[i0 + 1], vz = P[i2 + 2] - P[i0 + 2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; ON[i0] += nx; ON[i0 + 1] += ny; ON[i0 + 2] += nz; ON[i1] += nx; ON[i1 + 1] += ny; ON[i1 + 2] += nz; ON[i2] += nx; ON[i2 + 1] += ny; ON[i2 + 2] += nz; }
    for (var v = 0; v < N; v++) { var key = (Math.floor(P[v * 3] / cell) + 512) * 1048576 + (Math.floor(P[v * 3 + 1] / cell) + 512) * 1024 + (Math.floor(P[v * 3 + 2] / cell) + 512); var c = cmap.get(key); if (c === undefined) { c = acc.length / 7; cmap.set(key, c); acc.push(0, 0, 0, 0, 0, 0, 0); } var o = c * 7; acc[o] += P[v * 3]; acc[o + 1] += P[v * 3 + 1]; acc[o + 2] += P[v * 3 + 2]; acc[o + 3] += ON[v * 3]; acc[o + 4] += ON[v * 3 + 1]; acc[o + 5] += ON[v * 3 + 2]; acc[o + 6]++; cellOf[v] = c; }
    var keep = [], seen = new Set(); for (f = 0; f < F; f++) { var a = cellOf[idx[f * 3]], b = cellOf[idx[f * 3 + 1]], cc = cellOf[idx[f * 3 + 2]]; if (a === b || b === cc || a === cc) continue; var s0 = Math.min(a, b, cc), s2 = Math.max(a, b, cc), kk = s0 + "," + (a + b + cc - s0 - s2) + "," + s2; if (seen.has(kk)) continue; seen.add(kk); keep.push(f); }
    var T = keep.length, BAGT = B.hand ? 24 : 0, PP = new Float32Array((T + BAGT) * 9), UU = new Float32Array((T + BAGT) * 6), NN = new Float32Array((T + BAGT) * 9), RR = new Float32Array((T + BAGT) * 3), cs = [0, 0, 0], vs = [0, 0, 0], pc = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var t = 0; t < T; t++) { f = keep[t]; for (k = 0; k < 3; k++) { vs[k] = idx[f * 3 + k]; cs[k] = cellOf[vs[k]]; var oo = cs[k] * 7, n = acc[oo + 6]; pc[k][0] = acc[oo] / n; pc[k][1] = acc[oo + 1] / n; pc[k][2] = acc[oo + 2] / n; }
      var e1x = pc[1][0] - pc[0][0], e1y = pc[1][1] - pc[0][1], e1z = pc[1][2] - pc[0][2], e2x = pc[2][0] - pc[0][0], e2y = pc[2][1] - pc[0][1], e2z = pc[2][2] - pc[0][2], qx = e1y * e2z - e1z * e2y, qy = e1z * e2x - e1x * e2z, qz = e1x * e2y - e1y * e2x;
      var j0 = vs[0] * 3, j1 = vs[1] * 3, j2 = vs[2] * 3, ox = (P[j1 + 1] - P[j0 + 1]) * (P[j2 + 2] - P[j0 + 2]) - (P[j1 + 2] - P[j0 + 2]) * (P[j2 + 1] - P[j0 + 1]), oy = (P[j1 + 2] - P[j0 + 2]) * (P[j2] - P[j0]) - (P[j1] - P[j0]) * (P[j2 + 2] - P[j0 + 2]), oz = (P[j1] - P[j0]) * (P[j2 + 1] - P[j0 + 1]) - (P[j1 + 1] - P[j0 + 1]) * (P[j2] - P[j0]);
      var order = qx * ox + qy * oy + qz * oz < 0 ? [0, 2, 1] : [0, 1, 2];
      for (var j = 0; j < 3; j++) { k = order[j]; var q = t * 3 + j, cc2 = cs[k] * 7, vv = vs[k]; PP[q * 3] = pc[k][0]; PP[q * 3 + 1] = pc[k][1]; PP[q * 3 + 2] = pc[k][2]; UU[q * 2] = U[vv * 2]; UU[q * 2 + 1] = U[vv * 2 + 1]; RR[q] = B.RY[vv]; var nx2 = acc[cc2 + 3], ny2 = acc[cc2 + 4], nz2 = acc[cc2 + 5], L = Math.sqrt(nx2 * nx2 + ny2 * ny2 + nz2 * nz2) || 1; NN[q * 3] = nx2 / L; NN[q * 3 + 1] = ny2 / L; NN[q * 3 + 2] = nz2 / L; } }
    // a shopping bag hanging from the right hand (rest height 3 marks it: the shader paints it the person's bag colour)
    if (B.hand) { var bx = B.hand[0], by = B.hand[1] - 0.05, bz = B.hand[2], bg = new THREE.BoxGeometry(0.3, 0.34, 0.13); bg.translate(bx, by - 0.2, bz); var hg = new THREE.BoxGeometry(0.02, 0.06, 0.1); hg.translate(bx, by - 0.01, bz); var parts2 = [bg.toNonIndexed(), hg.toNonIndexed()], q0 = T * 3;
      parts2.forEach(function (g) { var pa = g.attributes.position, na = g.attributes.normal; for (var i = 0; i < pa.count; i++, q0++) { PP[q0 * 3] = pa.getX(i); PP[q0 * 3 + 1] = pa.getY(i); PP[q0 * 3 + 2] = pa.getZ(i); NN[q0 * 3] = na.getX(i); NN[q0 * 3 + 1] = na.getY(i); NN[q0 * 3 + 2] = na.getZ(i); RR[q0] = 3.0; } }); }
    var g2 = new THREE.BufferGeometry(); g2.setAttribute("position", new THREE.BufferAttribute(PP, 3)); g2.setAttribute("uv", new THREE.BufferAttribute(UU, 2)); g2.setAttribute("normal", new THREE.BufferAttribute(NN, 3)); g2.setAttribute("aRestY", new THREE.BufferAttribute(RR, 1)); g2.computeBoundingSphere(); g2.computeBoundingBox(); return g2;
  }
  function peopleMat(map, data) {
    var m = new THREE.MeshStandardMaterial({ map: map, roughness: 0.86, metalness: 0, envMapIntensity: 0.6 }); m.name = "mk_people";
    m.onBeforeCompile = function (sh) { sh.uniforms.uPD = { value: data };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aRestY; uniform sampler2D uPD; varying vec3 vShirt; varying vec3 vPants; varying vec3 vSkin; varying vec3 vBag; varying float vRestY;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRestY = aRestY;\n#ifdef USE_BATCHING\n{ int pid = int(getIndirectIndex(gl_DrawID)) * 4; vShirt = texelFetch(uPD, ivec2(pid % 1024, pid / 1024), 0).rgb; vPants = texelFetch(uPD, ivec2((pid + 1) % 1024, (pid + 1) / 1024), 0).rgb; vSkin = texelFetch(uPD, ivec2((pid + 2) % 1024, (pid + 2) / 1024), 0).rgb; vBag = texelFetch(uPD, ivec2((pid + 3) % 1024, (pid + 3) / 1024), 0).rgb; }\n#else\nvShirt = vec3(0.8); vPants = vec3(0.2); vSkin = vec3(0.9, 0.76, 0.6); vBag = vec3(0.7, 0.55, 0.35);\n#endif");
      sh.fragmentShader = sh.fragmentShader.replace("uniform vec3 diffuse;", "uniform vec3 diffuse; varying vec3 vShirt; varying vec3 vPants; varying vec3 vSkin; varying vec3 vBag; varying float vRestY;").replace("#include <map_fragment>", "#include <map_fragment>\nif (vRestY > 2.5) { diffuseColor.rgb = vBag; } else { float lum = dot(diffuseColor.rgb, vec3(0.333)); float sat = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));\n float skinLike = smoothstep(0.06, 0.16, sat) * step(diffuseColor.b + 0.015, diffuseColor.r) * smoothstep(0.16, 0.32, lum) * (1.0 - smoothstep(0.86, 0.95, lum));\n vec3 skinC = diffuseColor.rgb * (vSkin / vec3(0.91, 0.76, 0.6)); float y = vRestY; float shoe = 1.0 - smoothstep(0.07, 0.12, y); float leg = (1.0 - smoothstep(0.92, 1.0, y)) * (1.0 - shoe); float torso = smoothstep(0.92, 1.0, y) * (1.0 - smoothstep(1.4, 1.46, y));\n vec3 c0 = diffuseColor.rgb; c0 = mix(c0, vPants * (0.32 + lum * 1.5), leg * (1.0 - skinLike)); c0 = mix(c0, vShirt * (0.45 + lum * 0.85), torso * (1.0 - skinLike)); c0 = mix(c0, vec3(0.92, 0.9, 0.86) * (0.4 + lum * 0.8), shoe * 0.85); diffuseColor.rgb = mix(c0, skinC, skinLike * 0.9 * (1.0 - shoe)); }");
    };
    m.customProgramCacheKey = function () { return "mk_people_b1"; }; return m;
  }
  // the people's places: shop vendors, customers and browsers, terrace diners and railing watchers, the nave (walkers, shoppers
  // with bags, groups, planter seats), the stalls (vendors and shoppers); each with a pose variant, a body, colours and a facing
  function peopleList() {
    var L = layout(), R = rng(9911), out = PPL.list = [], yf = YF(), ym = YM(), yg = S.G + 0.04;
    var vary = function (pose) { var r = R(); return pose === "walk" ? (r < 0.3 ? "walkBag" : r < 0.65 ? "walkA" : "walkB") : pose === "idle" ? (r < 0.2 ? "idleBag" : r < 0.6 ? "idleA" : "idleB") : "sit"; };
    var add = function (x, y, z, ry, pose, role) { var b = R() < 0.5 ? "m" : "f"; out.push({ x: x, y: y, z: z, ry: ry, pose: role === "vendor" ? (R() < 0.5 ? "idleA" : "idleB") : vary(pose), b: b, role: role || "", sh: SHIRTS[Math.floor(R() * SHIRTS.length)], pa: PANTS[Math.floor(R() * PANTS.length)], sk: SKINS[Math.floor(R() * SKINS.length)], bag: BAGS[Math.floor(R() * BAGS.length)] }); };
    L.shops.forEach(function (P, si) { var pre = shopPrefab(P.type), xs = P.n === 2 ? [-S.B / 2, S.B / 2] : [0]; xs.forEach(function (ox, k) { pre.slots.forEach(function (sl, j) { if (sl.role !== "vendor" && R() < 0.25) return; if (sl.role === "vendor" && j > 0 && R() < 0.5) return; var w = lw(P, sl.lx + ox, sl.lz); add(w[0], yf, w[1], (P.ry || 0) + sl.ry + (R() - 0.5) * 0.5, sl.pose, sl.role); }); }); });
    L.terr.forEach(function (T) { terrPrefab(T.umb).slots.forEach(function (sl) { if (sl.pose === "sit" && R() < 0.3) return; if (sl.rail && R() < 0.5) return; if (T.land && sl.rail) return; var w = lw(T, sl.lx, sl.lz); add(w[0], ym, w[1], T.ry + sl.ry, sl.pose); }); });
    for (var i = 0; i < 230; i++) { var x = lerp(S.X0 + 8, S.X1 - 8, R()), z = S.ZC + (R() < 0.5 ? -1 : 1) * (1.8 + R() * 6.4); if (blocked(x, z)) continue; var dir = R() < 0.5 ? -1 : 1; add(x, yf, z, dir > 0 ? PI / 2 + (R() - 0.5) * 0.5 : -PI / 2 + (R() - 0.5) * 0.5, R() < 0.8 ? "walk" : "idle"); }
    L.planters.forEach(function (p, k) { for (var gi = 0; gi < 2; gi++) { var n = 2 + Math.floor(R() * 2), a0 = R() * TAU, cx = p.x + Math.sin(a0) * (p.r + 1.8), cz = p.z + Math.cos(a0) * (p.r + 1.8); if (blocked(cx, cz)) continue; for (var j = 0; j < n; j++) { var a = j * TAU / n + R() * 0.4; add(cx + Math.sin(a) * 0.65, yf, cz + Math.cos(a) * 0.65, a + PI, "idle"); } } });
    L.planters.forEach(function (p) { if (!p.seat) return; for (var a = 0; a < 4; a++) { if (R() < 0.25) continue; var an = a * PI / 2 + PI / 4; add(p.x + Math.sin(an) * (p.r + 0.36), yf, p.z + Math.cos(an) * (p.r + 0.36), an, "sit"); } });
    L.stalls.forEach(function (T) { stallGoods(T.type).slots.forEach(function (sl, j) { if (sl.role !== "vendor" && R() < 0.2) return; var w = lw(T, sl.lx, sl.lz); add(w[0], yg, w[1], T.ry + sl.ry, sl.pose, sl.role); }); });
    for (var k2 = 0; k2 < 46; k2++) { var x2 = lerp(S.sx0 + 4, S.sx1 - 4, R()), z2 = lerp(S.sz0 + 6.0, S.sz1 - 6.0, R()); add(x2, yg, z2, (R() < 0.5 ? 1 : -1) * PI / 2 + (R() - 0.5) * 0.6, R() < 0.6 ? "walk" : "idle"); }
    MK.n.people = out.length;
  }
  function blocked(x, z) { var L = layout(); if (L.planters.some(function (p) { return Math.hypot(p.x - x, p.z - z) < p.r + 0.7; })) return true; if (L.small.some(function (p) { return Math.hypot(p.x - x, p.z - z) < p.r + 0.6; })) return true; if (L.kiosks.some(function (k) { return Math.abs(k.x - x) < 2.6 && Math.abs(k.z - z) < 2.0; })) return true; if (S.stairs.some(function (q) { return x > Math.min(q.xb, q.xl) - 0.6 && x < Math.max(q.xb, q.xl) + 0.6 && Math.abs(z - (q.zIn + q.zOut) / 2) < 1.6; })) return true; if (L.busker && Math.hypot(L.busker.x - x, L.busker.z - z) < 1.8) return true; return false; }
  // bake one pose a call (time-sliced from the frame hook while CHAR has loaded); then build the batches
  function* bakeSteps() {
    var poses = {}; for (var bi = 0; bi < 2; bi++) for (var i = 0; i < POSES.length; i++) { var b = bi ? "f" : "m", p = POSES[i], B = bakePose(b, p[1], p[2]); yield 0; if (!B) continue; if (!p[3]) B.hand = null; var near = simplify(B, 0.05); yield 0; var far = simplify(B, 0.16); poses[b + ":" + p[0]] = { near: near, far: far, map: B.map }; yield 0; }
    PPL.poses = poses; var g = new THREE.Group(); g.name = "mk_people"; g.userData.noCull = true; var tri = [];
    ["m", "f"].forEach(function (b) { var list = PPL.list.filter(function (q) { return q.b === b; }); var any = poses[b + ":idleA"]; if (!list.length || !any) return;
      var H = Math.max(1, Math.ceil(list.length * 4 / 1024)), D = new Uint8Array(1024 * H * 4), data = new THREE.DataTexture(D, 1024, H, THREE.RGBAFormat); data.needsUpdate = true;
      list.forEach(function (q, i) { [q.sh, q.pa, q.sk, q.bag].forEach(function (hx, k) { _pc.setHex(hx); var o = (i * 4 + k) * 4; D[o] = Math.round(_pc.r * 255); D[o + 1] = Math.round(_pc.g * 255); D[o + 2] = Math.round(_pc.b * 255); D[o + 3] = 255; }); });
      var mat = peopleMat(any.map, data), mk = function (lod, cast) { var vc = 0, ids = {}; POSES.forEach(function (p) { var P = poses[b + ":" + p[0]]; if (P) vc += P[lod].attributes.position.count; }); var bm = new THREE.BatchedMesh(list.length, vc, 0, mat); bm.name = "mk_people_" + b + "_" + lod; bm.castShadow = cast; bm.receiveShadow = true; bm.sortObjects = false; bm.perObjectFrustumCulled = true; bm.userData.shSet = true; bm.userData.noShadow = !cast;
        POSES.forEach(function (p) { var P = poses[b + ":" + p[0]]; if (P) { ids[p[0]] = bm.addGeometry(P[lod]); tri.push([b + p[0] + lod, P[lod].attributes.position.count / 3]); } });
        list.forEach(function (q) { var id = bm.addInstance(ids[q.pose] !== undefined ? ids[q.pose] : ids.idleA); _e.set(0, q.ry, 0); _q.setFromEuler(_e); _m4.compose(_v1.set(q.x, q.y, q.z), _q, _v2.set(1, 1, 1)); bm.setMatrixAt(id, _m4); bm.setVisibleAt(id, false); q["id_" + lod] = id; });
        bm.computeBoundingBox(); bm.computeBoundingSphere(); g.add(bm); return bm; };
      PPL.bat[b] = { near: mk("near", true), far: mk("far", false), list: list }; list.forEach(function (q) { q.st = -1; }); });
    scene.add(g); GR.people = g; PPL.ready = true; PPL.cx = 1e9; MK.n.peopleTris = tri;
    try { var W = window.PLAN_PERF; if (W && W.warmGroup) W.warmGroup(g, { name: "market people" }); } catch (e) {}
  }
  var _pc = new THREE.Color();
  // near (cast shadows) and far LODs by distance, nothing beyond PPL.far; only the changes are written
  function peopleFrame(force) {
    var cam = camera.position, mv = Math.hypot(cam.x - PPL.cx, cam.z - PPL.cz); if (!force && mv < 3 && nowMs() - PPL.at < 1500) return; PPL.cx = cam.x; PPL.cz = cam.z; PPL.at = nowMs();
    var near2 = PPL.near * PPL.near, far2 = PPL.far * PPL.far, n = 0, f = 0;
    for (var b in PPL.bat) { var B = PPL.bat[b]; for (var i = 0; i < B.list.length; i++) { var q = B.list[i], dx = q.x - cam.x, dz = q.z - cam.z, d2 = dx * dx + dz * dz, st = d2 > far2 ? 0 : d2 < near2 ? 1 : 2; if (st === 1) n++; else if (st === 2) f++; if (st === q.st && !force) continue; q.st = st; B.near.setVisibleAt(q.id_near, st === 1); B.far.setVisibleAt(q.id_far, st === 2); } }
    MK.n.peopleNear = n; MK.n.peopleFar = f;
  }

  // ───────────────────────── live vendors (talk cards) and a few walkers: client avatars, only near the hall ─────────────────────────
  MK.cast = MK.cast || []; MK.walkers = MK.walkers || [];
  function vendorSpot(V) { var L = layout(); if (V.stall !== undefined) { var T = L.stalls[V.stall | 0]; if (!T) return null; var w = lw(T, 0.6, -1.5); return { x: w[0], z: w[1], y: S.G + 0.04, ry: T.ry }; }
    var target = (C("shops", [])[V.shop | 0] || {}).name; var P = L.shops.filter(function (q) { return q.def.name === target; })[0]; if (!P) return null; var w2 = lw(P, (P.n === 2 ? -S.B / 2 : 0) + 2.9, -2.1); return { x: w2[0], z: w2[1], y: YF(), ry: P.ry + 0.2 }; }
  function buildVendors() {
    if (typeof avatar !== "function") return; var made = 0; C("vendors", []).forEach(function (V) { if (made) return; if (MK.cast.some(function (c) { return c.id === V.id; }) || CAST.some(function (c) { return c.id === V.id; })) return; var sp = vendorSpot(V); if (!sp) return; made++;
      var g = avatar("cast_" + V.id, V.name, V.look || {}, null, null); g.position.set(sp.x, sp.y, sp.z); g.rotation.y = sp.ry; try { g.userData.label.scale.set(1.6, 0.4, 1); } catch (e) {} g.traverse(function (o) { if (o.isMesh) { o.castShadow = false; o.userData.shSet = true; } }); scene.add(g);
      var c = { id: V.id, name: V.name, role: V.role, pos: [sp.x, sp.z], look: V.look, hat: null, outfit: null, greet: V.greet || ["Welcome."], talk: (V.talk || []).map(function (q) { return { t: q.t, o: q.o }; }), kw: [], g: g, rot: sp.ry };
      CAST.push(c); var hs = { x: sp.x, z: sp.z, r: 2.6, t: c.name, k: c.role + " · press E to talk", p: c.talk[0] ? c.talk[0].t : "", play: "npc:" + c.id }; hotspots.push(hs); (MK.hsList = MK.hsList || []).push(hs); MK.cast.push(c); });
    MK.n.vendors = MK.cast.length;
  }
  function buildWalkers() {
    if (typeof avatar !== "function" || MK.walkers.length >= 6) return; var R = rng(515 + MK.walkers.length * 7), looks = [{ body: "m", skin: "e8c19a", shirt: "3a6ea5", pants: "2b3a4a", hair: 1, hairc: "3a2416" }, { body: "f", skin: "c98f63", shirt: "f5f1e6", pants: "1c1f24", hair: 2, hairc: "1c1512" }, { body: "m", skin: "8d5a3b", shirt: "c0462d", pants: "6d5a3e", hair: 3 }, { body: "f", skin: "f3d9c0", shirt: "2a7a3e", pants: "d9cdb5", hair: 1, hairc: "6b4226" }, { body: "m", skin: "d9a877", shirt: "e0b040", pants: "3a3d42", hair: 0 }, { body: "f", skin: "a86f46", shirt: "9a3b52", pants: "2b3a4a", hair: 2, hairc: "1c1512" }];
    for (var i = MK.walkers.length, i1 = i + 1; i < looks.length && i < i1; i++) { var g = avatar("mk_walk_" + i, "", looks[i], i === 2 ? "hat_cap" : null, null); try { g.userData.label.visible = false; } catch (e) {} var lane = S.ZC + (i % 2 ? 5.2 : -5.0) + (R() - 0.5) * 1.2; var x0 = lerp(S.X0 + 20, S.X1 - 60, R()); g.position.set(x0, YF(), lane); scene.add(g); MK.walkers.push({ g: g, x0: S.X0 + 12, x1: S.X1 - 12, z: lane, dir: i % 2 ? 1 : -1, sp: 1.05 + R() * 0.35, pause: R() * 3 }); }
  }
  function walkersFrame(dt, near) {
    MK.walkers.forEach(function (w) { var g = w.g; g.visible = near; if (!near) return; if (w.pause > 0) { w.pause -= dt; try { animateWalk(g, 0, dt); } catch (e) {} return; }
      g.position.x += w.dir * w.sp * dt; var blockedAhead = layout().planters.some(function (p) { return Math.abs(p.x - g.position.x - w.dir * 1.2) < p.r + 0.4 && Math.abs(p.z - g.position.z) < p.r + 0.5; }) || layout().kiosks.some(function (k) { return Math.abs(k.x - g.position.x - w.dir * 1.5) < 2.2 && Math.abs(k.z - g.position.z) < 1.8; });
      if (blockedAhead) g.position.z += (g.position.z > S.ZC ? 1 : -1) * dt * 1.2; else g.position.z += (w.z - g.position.z) * Math.min(1, dt * 0.5);
      if (g.position.x < w.x0 || g.position.x > w.x1) { w.dir *= -1; w.pause = 2 + Math.random() * 3; } g.rotation.y = w.dir > 0 ? PI / 2 : -PI / 2; g.position.y = YF(); try { animateWalk(g, w.sp, dt); } catch (e) {} });
  }

  // ───────────────────────── interaction spots (E): coffee, food counters, the merch stand, kiosks, the busker ─────────────────────────
  MK.spots = [];
  function spotsSetup() {
    var L = layout(), yf = YF(), out = MK.spots = [], V = C("venues", {});
    try { if (typeof VENUE === "object") for (var k in V) VENUE["mk_" + k] = { title: V[k].title, k: V[k].k, items: (V[k].items || []).slice() }; } catch (e) { note("venues", e); }
    L.shops.forEach(function (P) { shopPrefab(P.type).spots.forEach(function (sp) { var xs = P.n === 2 ? [-S.B / 2, S.B / 2] : [0]; xs.forEach(function (ox) { var w = lw(P, sp.lx + ox, sp.lz); out.push({ x: w[0], z: w[1], y: yf, r: 1.9, kind: sp.kind === "coffee" ? "coffee" : sp.kind === "snack" ? "snack" : "look", shop: P }); }); }); });
    L.kiosks.forEach(function (Kk) { var w = lw(Kk, 0, 1.4); out.push({ x: w[0], z: w[1], y: yf, r: 2.2, kind: "kiosk", k: Kk.def }); });
    if (L.busker) out.push({ x: L.busker.x, z: L.busker.z - 2.0, y: yf, r: 2.6, kind: "busker" });
    L.stalls.forEach(function (T) { if (T.type !== "coffee" && T.type !== "merch") return; var w = lw(T, 0, 0.9); out.push({ x: w[0], z: w[1], y: S.G, r: T.type === "merch" ? 3.2 : 2.0, kind: T.type === "merch" ? "merch" : "cart", stall: T }); });
    MK.n.spots = out.length;
  }
  function nearSpot() { if (!player) return null; var px = player.position.x, pz = player.position.z, py = player.position.y, best = null, bd = 1e9; for (var i = 0; i < MK.spots.length; i++) { var o = MK.spots[i]; if (Math.abs(py - o.y) > 1.6) continue; var d = Math.hypot(o.x - px, o.z - pz); if (d < o.r && d < bd) { bd = d; best = o; } } return best; }
  function infoCard(t, k, p) { try { $id("info-h").textContent = t; $id("info-k").textContent = k || ""; $id("info-p").textContent = p || ""; var go = $id("info-go"); if (go) go.style.display = "none"; var nv = $id("info-nav"); if (nv) nv.style.display = "none"; $id("info").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock(); sfx("ui"); } catch (e) {} }
  function stamp(key) { try { var id = C("progress." + key, null); var PP = window.PLAN_PROGRESS; if (id && PP && PP.award) PP.award("stamp", { id: id }); } catch (e) {} }
  function handleE() {
    if (MK.off || !MK.ready) return false; if ((typeof riding !== "undefined" && riding) || (typeof SIT !== "undefined" && SIT.on) || (typeof inside !== "undefined" && inside)) return false;
    try { if (nearestSeat()) return false; } catch (e) {} try { var nh = nearestHotspot(); if (nh && nh.play && String(nh.play).indexOf("npc:") === 0 && Math.hypot(nh.x - player.position.x, nh.z - player.position.z) < 2.2) return false; } catch (e) {}
    var o = nearSpot(); if (!o) return false;
    if (o.kind === "coffee" || o.kind === "snack" || o.kind === "cart" || o.kind === "merch") { var key = o.kind === "coffee" ? "coffee" : o.kind === "snack" ? "snack" : o.kind; if (o.kind === "snack" && o.shop) { VENUE.mk_snack.title = o.shop.def.name; VENUE.mk_snack.k = o.shop.def.tag ? o.shop.def.tag.replace(/ · /g, ", ").toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }) : ""; }
      try { openShop("mk_" + key); } catch (e) { note("shop", e); } if (o.kind === "coffee" || o.kind === "cart") stamp("coffee"); vendorLine(o, true); return true; }
    if (o.kind === "kiosk") { var d = o.k.info || [o.k.name, "", ""]; infoCard(d[0], d[1], d[2]); return true; }
    if (o.kind === "busker") { try { act({ t: "emote", e: "cheer" }); } catch (e) {} bubbleAt(o.x, YF() + 0.1, o.z + 2.0, ["Thank you!", "This one is for the market.", "Gracias, amigos!"][Math.floor(Math.random() * 3)]); return true; }
    if (o.kind === "look") { var dd = o.shop.def; infoCard(dd.name, dd.tag ? dd.tag.replace(/ · /g, " · ") : "", lookLine(o.shop)); vendorLine(o, true); return true; }
    return false;
  }
  function lookLine(P) { var t = P.type; return t === "artisan" ? "Handmade pieces from makers across the borderlands. Each one is signed by its maker." : t === "goods" ? "Pantry goods, produce and gifts from the valley, stocked fresh for the market weekend." : "Fresh from the counter."; }
  function promptFrame() {
    try { if (MK.off || !MK.ready) return; var el = $id("prompt"), t = $id("prompt-t"); if (!el || !t) return; if ((typeof riding !== "undefined" && riding) || (typeof SIT !== "undefined" && SIT.on)) return; if (el.classList.contains("on")) return;
      var o = nearSpot(); if (!o) return; var Pm = C("prompts", {}); var msg = o.kind === "coffee" ? Pm.coffee : o.kind === "snack" ? Pm.snack : o.kind === "cart" ? Pm.cart : o.kind === "merch" ? Pm.merch : o.kind === "busker" ? Pm.busker : o.kind === "kiosk" ? "about " + o.k.name : o.kind === "look" ? "browse " + o.shop.def.name : null;
      if (msg) { t.innerHTML = "<b>E</b> &nbsp;" + msg; el.classList.add("on"); } } catch (e) { note("prompt", e); }
  }
  // flavour lines: a speech bubble over a counter now and then when you walk past (one at a time)
  var BUB = MK.bub = { list: [], at: 0, last: {} };
  function bubbleAt(x, y, z, text) { try { if (typeof makeBubble !== "function") return; var g = new THREE.Group(); g.position.set(x, y, z); var b = makeBubble(text); g.add(b); scene.add(g); BUB.list.push({ g: g, b: b, t: nowMs() + 4200 }); } catch (e) { note("bubble", e); } }
  function vendorLine(o, now) { var P = o.shop, T = o.stall, key = P ? P.id : T ? T.id : "x"; var L = C("lines." + (P ? P.type : "stall"), null); if (!L || !L.length) return; if (!now && nowMs() - (BUB.last[key] || 0) < 45000) return; BUB.last[key] = nowMs(); BUB.at = nowMs();
    var w = P ? lw(P, (P.n === 2 ? -S.B / 2 : 0) + 0.4, -1.8) : lw(T, 0, -1.4); bubbleAt(w[0], (P ? YF() : S.G) - 0.4, w[1], L[Math.floor(Math.random() * L.length)]); }
  function bubbleFrame() { var t = nowMs(); for (var i = BUB.list.length - 1; i >= 0; i--) { var q = BUB.list[i]; if (t < q.t) continue; scene.remove(q.g); try { if (q.b.material.map) q.b.material.map.dispose(); q.b.material.dispose(); } catch (e) {} BUB.list.splice(i, 1); }
    if (t - BUB.at < 7000 || !player) return; var px = player.position.x, pz = player.position.z, py = player.position.y; for (var j = 0; j < MK.spots.length; j++) { var o = MK.spots[j]; if (!(o.shop || (o.stall && o.kind === "cart")) || Math.abs(py - o.y) > 1.6) continue; var d = Math.hypot(o.x - px, o.z - pz); if (d < 6.5 && d > 1.2) { vendorLine(o, false); if (nowMs() - BUB.at < 100) return; } } }

  // ───────────────────────── every frame: the night look, near and far, the crowd, vendors, walkers, stamps ─────────────────────────
  var FR = MK.fr = { t: 0, it: null, stamped: {} };
  function frameHook(dt, now) {
    if (MK.off || !MK.ready || !S) return; dt = Math.min(dt || 0.016, 0.1);
    if (MK.hideAll) { for (var hk in GR) GR[hk].visible = false; (MK.cast || []).concat(MK.walkers || []).forEach(function (c) { c.g.visible = false; }); return; }
    try {
      var n = clamp((nightK() - 0.02) * 3.2, 0, 1), cam = camera.position, M = MAT;
      if (Math.abs(n - (FR.n === undefined ? -1 : FR.n)) > 0.004) { FR.n = n; ["trav", "earth", "wood", "wick"].forEach(function (k) { if (M[k]) M[k].emissiveIntensity = 0.16 * n; }); M.plain.emissiveIntensity = 0.05 * n; M.metal.emissiveIntensity = 0.03 * n;
        M.glass.emissiveIntensity = 0.25 * n; M.glass.opacity = 0.12;  M.glow.color.setScalar(0.9 + 1.5 * n); M.win.color.setScalar(0.95 + 1.7 * n); M.sign.emissiveIntensity = 0.12 + 0.55 * n; if (M.stock) M.stock.emissiveIntensity = 0.22 + 0.55 * n; (MK.lights || []).forEach(function (l) { l.intensity = l.userData.k0 * n; }); }
      var dh = rectDist(cam.x, cam.z, S.X0, S.X1, S.ZN, S.ZS), dst = rectDist(cam.x, cam.z, S.sx0, S.sx1, S.sz0, S.sz1);
      // the vault glows amber seen from outside; from inside it stays clear enough for the stars
      var inV = dh <= 0 && cam.y < YF() + S.RT + S.RISE; var vk = (inV ? 0.22 : 0.9) * n; if (Math.abs(M.vglass.emissiveIntensity - vk) > 0.01) { M.vglass.emissiveIntensity = vk; M.vglass.opacity = 0.16 + (inV ? 0.02 : 0.1) * n; }
      FR.near = dh < 140; var vis = function (k, v) { if (GR[k] && GR[k].visible !== v) GR[k].visible = v; };
      if (nowMs() > (FR.tagAt || 0)) { FR.tagAt = nowMs() + 250; var yf0 = YF(), inH = dh <= 0 && cam.y < yf0 + S.RT, side = dh > 0 && cam.x > S.X0 + 2 && cam.x < S.X1 - 2 && (cam.z < S.ZN || cam.z > S.ZS) && cam.y < yf0 + 9;
        // behind solid walls: the shops, terraces and deck plants face the nave (not seen from the plaza at eye level), the stall goods are not seen from inside the nave
        btag("shops", dh < 420 && !side); btag("terr", dh < 420 && !side); btag("green", dh < 360 && !side); btag("planters", dh < 420); btag("nave", dh < 360 && !side); btag("globes", dh < 900); btag("goods", dst < 360 && !inH); btag("festoons", dst < 600); btag("stallf", dst < 700); } vis("signs", dh < 520 || dst < 300); vis("stock", dh < 420 || dst < 300); vis("lights", dh < 200 || dst < 120); vis("batch", Math.min(dh, dst) < 2600);
      // the crowd: baked once the rigs have loaded, its LODs re-sorted as the camera moves
      if (!PPL.ready && !PPL.fail && typeof CHAR !== "undefined" && CHAR.m && CHAR.f && CHAR.m.clips && CHAR.m.clips.sit && (dh < 600 || dst < 600 || nowMs() - (FR.boot || (FR.boot = nowMs())) > 20000)) { if (!FR.it) FR.it = bakeSteps(); try { var r = window.PLAN_PERF && PLAN_PERF.step ? PLAN_PERF.step(FR.it, 6) : FR.it.next(); if (r && r.done) FR.it = null; } catch (e) { note("bake", e); PPL.fail = true; FR.it = null; } }
      if (PPL.ready) { var pv = Math.min(dh, dst) < 280; if (GR.people.visible !== pv) GR.people.visible = pv; if (pv) peopleFrame(false); }
      if (Math.min(dh, dst) < 160) { if (nowMs() > (FR.vAt || 0)) { FR.vAt = nowMs() + 700; FR.vk = (FR.vk || 0) + 1; if (FR.vk % 2) { try { buildVendors(); } catch (e) { note("vendors", e); } } else if (C("walkers", 0) > 0) { try { buildWalkers(); } catch (e) { note("walkers", e); } } } }
      if (FR.lock && GR[FR.lock]) GR[FR.lock].visible = false;
      walkersFrame(dt, dh < 110); (MK.cast || []).forEach(function (c) { var dd = Math.hypot(c.g.position.x - cam.x, c.g.position.z - cam.z); c.g.visible = dd < 45 && !MK.hideCast; if (c.g.visible && !c.shOff) { c.shOff = true; c.g.traverse(function (o) { if (o.isMesh) { o.castShadow = false; o.userData.shSet = true; } }); } });
      bubbleFrame();
      // stamps: inside the hall, on the mezzanine, at the market
      if (player) { var px = player.position.x, pz = player.position.z, py = player.position.y; if (S.inHall(px, pz, -1) && !FR.stamped.hall) { FR.stamped.hall = 1; stamp("hall"); } if (S.inHall(px, pz, -1) && py > YM() - 0.4 && !FR.stamped.mezz) { FR.stamped.mezz = 1; stamp("mezz"); } if (S.inStalls(px, pz, 1) && !FR.stamped.stalls) { FR.stamped.stalls = 1; stamp("stalls"); } }
    } catch (e) { note("frame", e); }
  }

  // ───────────────────────── hooks, API, debug ─────────────────────────
  MK.impl = { handleE: handleE, prompt: promptFrame, frame: frameHook };
  MK.api = { site: site, layout: layout, YF: function () { return YF(); }, YM: function () { return YM(); }, nearSpot: nearSpot, bake: bakePose, simplify: simplify };
  MK.debug = {
    // stand the player at (x, z) on the floor (or the deck with up) facing yaw
    at: function (x, z, up, yw) { player.position.set(x, (up ? YM() : YF()) + 0.02, z); if (yw !== undefined) yaw = yw; return [x, z]; },
    cam: function (px, py, pz, tx, ty, tz, fov) { window.__cam = [px, YF() + py, pz, tx, YF() + ty, tz, fov || 0]; try { updateCulling(true); } catch (e) {} return window.__cam; },
    people: function () { peopleFrame(true); return [MK.n.peopleNear, MK.n.peopleFar]; },
    counts: function () { var o = {}; for (var k in GR) { var c = 0, t = 0; GR[k].traverse(function (m) { if (m.isMesh) { c++; var g = m.geometry; var tr = (g.index ? g.index.count : g.attributes.position.count) / 3; t += m.isBatchedMesh ? 0 : tr * (m.isInstancedMesh ? m.count : 1); } }); o[k] = [c, Math.round(t)]; } o.batchTris = Math.round(MK.n.tris || 0); o.instances = MK.n.instances; return o; }
  };
  (function hookAll() {
    var set = function (phase, name, fn) { var list = window.PLAN_HOOKS[phase]; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name: name, fn: fn }); };
    set("world", "marketWorld", function () { worldHook(); });
    set("terrain", "marketTerrain", function () { terrainHook(); });
    set("defer", "marketDefer", function () { deferHook(); });
    set("frame", "marketFrame", function (dt, now) { MK.impl.frame(dt, now); });
  })();
})();

// R7 (main session): less exposure by day while the camera is under the glass vault, so midday does not wash out the nave
// (plan_gfx applies window.PLAN_EXPO_K in proportion to daylight). The hall's box is x -465..-140, z 8..46, floor plus 20 m.
(function () {
  var prev = window.PLAN_EXPO_K;
  window.PLAN_EXPO_K = function () {
    var k = typeof prev === "function" ? prev() : 1;
    try {
      var c = camera.position; if (c.x < -465 || c.x > -140 || c.z < 8 || c.z > 46) return k;
      var g = typeof planGroundAt === "function" ? planGroundAt(c.x, c.z) : (typeof getH === "function" ? getH(c.x, c.z) : 0);
      if (c.y > g + 20) return k;
      return k * 0.7;
    } catch (e) { return k; }
  };
})();
