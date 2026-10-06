// plan_land.js (E2, round 2, 25 Sep 2026): the land between the places.
// Classic script, loaded before client.js. It declares nothing at top level (one IIFE) and reaches the client's globals
// by bare name at call time. PLAN mode only; the legacy world never runs these hooks.
//   world   snapshot the heightfield, then queue the main terrain hook LAST (after every module's own grading)
//   terrain 1. rasters of everything already built (roads, plazas, pads, keep-outs, colliders, solids, module meshes,
//              golf corridors, places, other hooks' grading) = what must not move and what must not be planted on
//           2. natural hills and mounds between the places (blended off everything above, never near the runway)
//           3. the golf course: palms and desert beds framing the holes, path lanterns, lit tee lights, clubhouse
//              festoons, all clear of the play corridors
//           4. the bare stretches (the ground before The Outpost, The Commons' wide paths and every other large empty
//              stretch of our land) filled with deliberate vignettes by district: desert gardens, cactus groves of many
//              species and sizes, rock outcrops, and features on a short spur from the nearest walk (ramadas, bench
//              groves, fire rings, sculptures, a windmill and stock tank, a parked rover)
//           5. more cactus variety everywhere (stands of mixed species and sizes)
//   defer   meshes at the final heights: gravel beds, lantern glow, light pools, festoon strings, fire flames, seats
//   frame   night lighting and fire flicker (near the player only)
// New asset kinds (IMPL2) are used as soon as MODELS[kind] exists; until then procedural placeholders (land_* kinds,
// registered as real instanced model kinds) or the current models stand in.
(function () {
  "use strict";
  if (window.PLAN_LAND) return;
  window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
  const HK = window.PLAN_HOOKS;
  { const N = window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || []; const want = ["saguaro_young", "saguaro_mid", "saguaro_giant", "barrel_cactus", "prickly_pear", "cholla", "organ_pipe", "fanpalm2", "datepalm", "canarypalm", "ph_stones", "ph_sandrocks", "bench_lux", "stagecoach", "rover", "agave_cluster", "yucca_cluster", "ph_quiver_1", "ph_quiver_2"];
    for (let i = 1; i <= 8; i++) want.push("ph_boulder_" + i, "ph_rock_" + i); for (let i = 1; i <= 8; i++) want.push("ph_moonrock_" + i, "ph_shrub_" + i); for (let i = 1; i <= 3; i++) want.push("ph_succulent_" + i);
    for (const k of want) if (N.indexOf(k) < 0) N.push(k); }
  const L = window.PLAN_LAND = { v: 1, errs: [], n: {}, t: {}, hills: [], craters: [], vign: [], feats: [], lights: [], festoons: [], beds: [], fires: [], seats: [], spurs: [], golf: {}, zones: [], uplights: [] };
  const err = (where, e) => { if (L.errs.length < 40) L.errs.push(where + ": " + ((e && e.message) || e)); if (L.errs.length <= 8) console.warn("plan_land " + where + " failed:", (e && e.stack) || e); };
  const cnt = (k, n) => { L.n[k] = (L.n[k] || 0) + (n === undefined ? 1 : n); };

  // ───────────── small maths ─────────────
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  let R = mulberry(20260925); const rr = (a, b) => a + R() * (b - a);
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function h3(x, y, z, s) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683) ^ Math.imul(s | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function vn3(x, y, z, s) { const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z); let fx = x - xi, fy = y - yi, fz = z - zi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    const l = (a, b, t) => a + (b - a) * t; const c = (i, j, k) => h3(xi + i, yi + j, zi + k, s);
    return l(l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy), l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz); }
  const fbm3 = (x, y, z, s) => vn3(x, y, z, s) * 0.55 + vn3(x * 2.13, y * 2.13, z * 2.13, s + 7) * 0.3 + vn3(x * 4.37, y * 4.37, z * 4.37, s + 13) * 0.15;
  const vn2 = (x, z, s) => vn3(x, 0.5, z, s);
  const segD = (x, z, ax, az, bx, bz) => { const vx = bx - ax, vz = bz - az; const L2 = vx * vx + vz * vz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)); return Math.hypot(x - (ax + vx * t), z - (az + vz * t)); };
  const has = (k) => !!(typeof MODELS !== "undefined" && MODELS[k] && MODEL_SPECS[k]);

  // ───────────── the raster (2.5 m cells over the section) ─────────────
  const G = { X0: -540, Z0: -680, X1: 1180, Z1: 1040, C: 2.5 }; G.nx = Math.ceil((G.X1 - G.X0) / G.C); G.nz = Math.ceil((G.Z1 - G.Z0) / G.C);
  const B_HILL = 1, B_PLANT = 2, B_GOLF = 4, B_MINE = 8, B_TALL = 16;   // bits: protect from grading, no planting, golf play, my own placements, no tall planting (view corridors)
  let RA = null, COV = null, ZN = null, DP = null, DZ = null, DC = null, DB = null, HADD = null;
  const cellI = (x) => Math.floor((x - G.X0) / G.C), cellJ = (z) => Math.floor((z - G.Z0) / G.C);
  const cellK = (x, z) => { const i = cellI(x), j = cellJ(z); if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) return -1; return j * G.nx + i; };
  const at = (A, x, z, dflt) => { const k = cellK(x, z); return k < 0 ? dflt : A[k]; };
  function markCircle(A, b, x, z, r) { const i0 = Math.max(0, cellI(x - r)), i1 = Math.min(G.nx - 1, cellI(x + r)), j0 = Math.max(0, cellJ(z - r)), j1 = Math.min(G.nz - 1, cellJ(z + r)); const r2 = (r + G.C * 0.5) * (r + G.C * 0.5);
    for (let j = j0; j <= j1; j++) { const cz = G.Z0 + (j + 0.5) * G.C - z; for (let i = i0; i <= i1; i++) { const cx = G.X0 + (i + 0.5) * G.C - x; if (cx * cx + cz * cz <= r2) A[j * G.nx + i] |= b; } } }
  function markRect(A, b, x0, x1, z0, z1) { const i0 = Math.max(0, cellI(x0)), i1 = Math.min(G.nx - 1, cellI(x1)), j0 = Math.max(0, cellJ(z0)), j1 = Math.min(G.nz - 1, cellJ(z1)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) A[j * G.nx + i] |= b; }
  function markSeg(A, b, ax, az, bx, bz, r) { const i0 = Math.max(0, cellI(Math.min(ax, bx) - r)), i1 = Math.min(G.nx - 1, cellI(Math.max(ax, bx) + r)), j0 = Math.max(0, cellJ(Math.min(az, bz) - r)), j1 = Math.min(G.nz - 1, cellJ(Math.max(az, bz) + r)); const rr2 = r + G.C * 0.5;
    for (let j = j0; j <= j1; j++) { const cz = G.Z0 + (j + 0.5) * G.C; for (let i = i0; i <= i1; i++) { const cx = G.X0 + (i + 0.5) * G.C; if (segD(cx, cz, ax, az, bx, bz) <= rr2) A[j * G.nx + i] |= b; } } }
  function markPoly(A, b, poly, pad) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const q of poly) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); } const i0 = Math.max(0, cellI(x0 - pad)), i1 = Math.min(G.nx - 1, cellI(x1 + pad)), j0 = Math.max(0, cellJ(z0 - pad)), j1 = Math.min(G.nz - 1, cellJ(z1 + pad));
    for (let j = j0; j <= j1; j++) { const cz = G.Z0 + (j + 0.5) * G.C; for (let i = i0; i <= i1; i++) { const cx = G.X0 + (i + 0.5) * G.C; let ok = planInPoly(poly, cx, cz); if (!ok && pad > 0) for (let q = 0, p = poly.length - 1; q < poly.length; p = q++) if (segD(cx, cz, poly[p][0], poly[p][1], poly[q][0], poly[q][1]) <= pad) { ok = true; break; } if (ok) A[j * G.nx + i] |= b; } } }
  function markTri(A, b, ax, az, bx, bz, cx, cz, pad) { const x0 = Math.min(ax, bx, cx) - pad, x1 = Math.max(ax, bx, cx) + pad, z0 = Math.min(az, bz, cz) - pad, z1 = Math.max(az, bz, cz) + pad; if (x1 < G.X0 || x0 > G.X1 || z1 < G.Z0 || z0 > G.Z1) return;
    const area = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)); if (area < 30 || (x1 - x0) * (z1 - z0) < 60) { markRect(A, b, x0, x1, z0, z1); return; }
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); const i0 = Math.max(0, cellI(x0)), i1 = Math.min(G.nx - 1, cellI(x1)), j0 = Math.max(0, cellJ(z0)), j1 = Math.min(G.nz - 1, cellJ(z1)); const e = (pad + G.C) / Math.sqrt(area);
    for (let j = j0; j <= j1; j++) { const pz = G.Z0 + (j + 0.5) * G.C; for (let i = i0; i <= i1; i++) { const px = G.X0 + (i + 0.5) * G.C; const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den, l3 = 1 - l1 - l2; if (l1 >= -e && l2 >= -e && l3 >= -e) A[j * G.nx + i] |= b; } } }
  // chamfer distance (metres) from every cell to the nearest cell for which src(k) is true
  function distField(src) { const { nx, nz, C } = G; const d = new Float32Array(nx * nz); const INF = 1e9, S2 = Math.SQRT2; for (let k = 0; k < nx * nz; k++) d[k] = src(k) ? 0 : INF;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; let v = d[k]; if (v === 0) continue; if (i > 0) v = Math.min(v, d[k - 1] + 1); if (j > 0) { v = Math.min(v, d[k - nx] + 1); if (i > 0) v = Math.min(v, d[k - nx - 1] + S2); if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + S2); } d[k] = v; }
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const k = j * nx + i; let v = d[k]; if (v === 0) continue; if (i < nx - 1) v = Math.min(v, d[k + 1] + 1); if (j < nz - 1) { v = Math.min(v, d[k + nx] + 1); if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + S2); if (i > 0) v = Math.min(v, d[k + nx - 1] + S2); } d[k] = v; }
    for (let k = 0; k < nx * nz; k++) d[k] = d[k] >= INF ? 9999 : d[k] * C; return d; }

  // ───────────── geometry: procedural placeholders (instanced like any model kind) ─────────────
  function weld(geo) { const p = geo.attributes.position; const map = new Map(), pos = [], idx = []; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const key = Math.round(x * 1e4) + "," + Math.round(y * 1e4) + "," + Math.round(z * 1e4); let j = map.get(key); if (j === undefined) { j = pos.length / 3; map.set(key, j); pos.push(x, y, z); } idx.push(j); } const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g; }
  // a geometry builder that collects position / normal / colour / uv and indices, for merging many small parts
  function GB() { this.p = []; this.n = []; this.c = []; this.u = []; this.i = []; }
  GB.prototype.add = function (geo, m4, col) { const g = geo.index ? geo : geo; const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, c = g.attributes.color; const base = this.p.length / 3; const v = new THREE.Vector3(), nm = new THREE.Matrix3(); if (m4) nm.getNormalMatrix(m4);
    for (let k = 0; k < p.count; k++) { v.set(p.getX(k), p.getY(k), p.getZ(k)); if (m4) v.applyMatrix4(m4); this.p.push(v.x, v.y, v.z); if (n) { v.set(n.getX(k), n.getY(k), n.getZ(k)); if (m4) v.applyMatrix3(nm).normalize(); this.n.push(v.x, v.y, v.z); } else this.n.push(0, 1, 0);
      if (c) this.c.push(c.getX(k), c.getY(k), c.getZ(k)); else if (typeof col === "function") { const q = col(this.p[this.p.length - 3], this.p[this.p.length - 2], this.p[this.p.length - 1]); this.c.push(q[0], q[1], q[2]); } else this.c.push(col ? col[0] : 1, col ? col[1] : 1, col ? col[2] : 1); if (u) this.u.push(u.getX(k), u.getY(k)); else this.u.push(0, 0); }
    if (g.index) { const ix = g.index.array; for (let k = 0; k < ix.length; k++) this.i.push(ix[k] + base); } else for (let k = 0; k < p.count; k++) this.i.push(base + k); return this; };
  GB.prototype.geo = function () { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2)); g.setIndex(this.i); g.computeBoundingBox(); g.computeBoundingSphere(); return g; };
  const m4 = (x, y, z, ry, sx, sy, sz, rx, rz) => { const m = new THREE.Matrix4(); m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, "YXZ")), new THREE.Vector3(sx === undefined ? 1 : sx, sy === undefined ? (sx === undefined ? 1 : sx) : sy, sz === undefined ? (sx === undefined ? 1 : sx) : sz)); return m; };

  const ROCK_TINT = { tan: [2.75, 2.2, 1.6], granite: [2.05, 1.95, 1.8], red: [2.25, 0.95, 0.55], dark: [1.1, 0.85, 0.66] };
  // vertex colours are linear in three.js: the cactus colours below are written as sRGB and converted once
  function linColors(g) { const c = g.attributes.color; if (!c) return g; for (let i = 0; i < c.count; i++) c.setXYZ(i, Math.pow(c.getX(i), 2.2), Math.pow(c.getY(i), 2.2), Math.pow(c.getZ(i), 2.2)); c.needsUpdate = true; return g; }
  // a weathered desert boulder: fractal-displaced sphere, two to four cleavage planes (flat fractured faces), squashed and
  // bedded, a quarter of it below ground; box-projected uvs for the rock texture; cavities, the buried base and the upper
  // faces (desert varnish) darker in the vertex colour
  function rockGeo(seed, detail, style) { const r0 = mulberry(seed * 7919 + 17); const g = weld(new THREE.IcosahedronGeometry(1, detail)); const p = g.attributes.position; const planes = [];
    const np = 3 + Math.floor(r0() * 3); for (let i = 0; i < np; i++) { const a = r0() * 6.283, e = (r0() - 0.25) * 1.3; planes.push([Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e), 0.5 + r0() * 0.28]); }
    const sx = 1.05 + r0() * 0.6, sy = (style === "red" ? 0.42 : 0.5) + r0() * 0.38, sz = 0.75 + r0() * 0.4; const disp = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) { let x = p.getX(i), y = p.getY(i), z = p.getZ(i); const n = fbm3(x * 1.5 + seed * 3.7, y * 1.5 + seed, z * 1.5, seed) - 0.5; const n2 = vn3(x * 5 + seed, y * 5, z * 5, seed + 3) - 0.5; const r = 1 + n * 0.5 + n2 * 0.11; x *= r; y *= r; z *= r;
      for (const pl of planes) { const d = x * pl[0] + y * pl[1] + z * pl[2] - pl[3]; if (d > 0) { x -= pl[0] * d * 0.92; y -= pl[1] * d * 0.92; z -= pl[2] * d * 0.92; } }
      if (y < -0.3) y = -0.3 + (y + 0.3) * 0.3; p.setXYZ(i, x * sx, y * sy, z * sz); disp[i] = n; }
    g.computeBoundingBox(); const bb = g.boundingBox; const hh = bb.max.y - bb.min.y; g.translate(0, -bb.min.y - hh * 0.26, 0); g.computeVertexNormals();
    const nr = g.attributes.normal, tint = ROCK_TINT[style] || ROCK_TINT.tan; const uv = new Float32Array(p.count * 2), col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const ax = Math.abs(nr.getX(i)), ay = Math.abs(nr.getY(i)), az = Math.abs(nr.getZ(i)); const US = 0.85; if (ay >= ax && ay >= az) { uv[i * 2] = x * US; uv[i * 2 + 1] = z * US; } else if (ax >= az) { uv[i * 2] = z * US; uv[i * 2 + 1] = y * US; } else { uv[i * 2] = x * US; uv[i * 2 + 1] = y * US; }
      const cav = 0.7 + 0.55 * Math.max(0, Math.min(1, disp[i] + 0.55)); const low = y < 0.18 ? 0.72 + 0.28 * Math.max(0, y) / 0.18 : 1; const varn = nr.getY(i) > 0.55 ? 0.9 : 1; const nz = 0.9 + 0.2 * vn3(x * 3, y * 3, z * 3, seed + 9); const strata = style === "red" || style === "tan" ? 0.93 + 0.07 * Math.sin(y * 10 + 3 * vn3(x, y, z, seed + 5)) : 1; const k = Math.min(1.15, cav * low * varn * nz * strata);
      col[i * 3] = tint[0] * k; col[i * 3 + 1] = tint[1] * k; col[i * 3 + 2] = tint[2] * k; }
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.computeBoundingSphere(); return g; }
  // a ribbed cactus column (young saguaro, organ pipe arm): alternating ridge and valley vertices, a domed woolly crown
  // lean = [angle, metres]: the stem leaves the base at that bearing and curves up to vertical (organ pipe, saguaro arms)
  function columnGeo(h, r, ribs, seed, tipCol, lod, lean) { const r0 = mulberry(seed + 101); const ns = ribs * 2; const pos = [], col = [], uv = [], idx = [];
    const crownH = Math.min(h * 0.3, r * 1.15), bodyH = h - crownH; const nb = lod ? Math.max(3, Math.round(bodyH / 0.7)) : Math.max(6, Math.round(bodyH / (ribs < 8 ? 0.33 : ribs < 11 ? 0.26 : 0.2))), nc = lod ? 3 : 7;
    const bend = (r0() - 0.5) * 0.06 * h, bendA = r0() * 6.283; const la = lean ? lean[0] : 0, lv = lean ? lean[1] : 0; const tc = tipCol || [0.62, 0.56, 0.38];
    const rows = []; for (let j = 0; j <= nb; j++) { const y = j / nb * bodyH; rows.push([y, 0.9 + 0.1 * Math.min(1, y / Math.max(0.2, h * 0.16)), j]); }
    const prT = rows[rows.length - 1][1]; for (let j = 1; j <= nc; j++) { const th = j / nc * Math.PI / 2; rows.push([bodyH + crownH * Math.sin(th), Math.max(0.004, prT * Math.cos(th)), nb + j, th / (Math.PI / 2)]); }
    for (const [yy, pr, j, cw] of rows) { const y = yy - 0.08; const t = yy / h; const off = bend * t * t, lo = lv * (1 - (1 - t) * (1 - t)); const ox = Math.cos(bendA) * off + Math.cos(la) * lo, oz = Math.sin(bendA) * off + Math.sin(la) * lo;
      for (let i = 0; i <= ns; i++) { const a = i / ns * 6.283; const ridge = i % 2 === 0; const rad = r * pr * (ridge ? 1 : 0.83); pos.push(ox + Math.cos(a) * rad, y, oz + Math.sin(a) * rad); uv.push(i / ns, t);
        const k = 0.85 + 0.15 * vn3(i * 0.7, t * 9, seed, 5); let c = ridge ? [0.32 * k, 0.41 * k, 0.26 * k] : [0.17 * k, 0.24 * k, 0.14 * k];
        if (ridge && (j % 2 === 0)) c = [c[0] + (0.56 - c[0]) * 0.4, c[1] + (0.53 - c[1]) * 0.4, c[2] + (0.42 - c[2]) * 0.4];   // areoles: grey spine clusters in rows down every rib
        if (cw !== undefined && cw > 0.35) { const w = Math.min(1, (cw - 0.35) / 0.65); c = [c[0] + (tc[0] - c[0]) * w, c[1] + (tc[1] - c[1]) * w, c[2] + (tc[2] - c[2]) * w]; }   // the woolly crown
        if (yy < 0.14) c = [c[0] * 0.78, c[1] * 0.74, c[2] * 0.68]; col.push(c[0], c[1], c[2]); } }
    for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < ns; i++) { const a = j * (ns + 1) + i, b = a + ns + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g; }
  // young saguaro: a single ribbed column, the taller one with its first arm budding out and turning up
  function sagyGeo(seed, h, r, arm, lod) { const b = new GB(); b.add(columnGeo(h, r, lod ? 7 : 12, seed, [0.64, 0.58, 0.4], lod)); if (arm) { const r0 = mulberry(seed + 7); const a = r0() * 6.283, ay = h * (0.5 + r0() * 0.12), ah = h * 0.3; b.add(columnGeo(ah, r * 0.62, lod ? 6 : 10, seed + 3, [0.64, 0.58, 0.4], lod, [a, r * 1.9]), m4(Math.cos(a) * r * 0.55, ay, Math.sin(a) * r * 0.55)); } return b.geo(); }
  // cholla (teddy bear and chain-fruit): a dark woody trunk, jointed stems branching up and out, the young joints pale gold with spines
  function chollaGeo(seed, lod) { const r0 = mulberry(seed + 131); const b = new GB(); const seg = lod ? new THREE.SphereGeometry(1, 5, 3) : new THREE.SphereGeometry(1, 8, 6); const jt = null;
    const Y = new THREE.Vector3(0, 1, 0), dv = new THREE.Vector3(), q = new THREE.Quaternion(), mt = new THREE.Matrix4(), pv = new THREE.Vector3(), sv = new THREE.Vector3(); const th = 0.5 + r0() * 0.34;
    // the trunk: dark, rough, a few dead joints still clinging to it
    b.add(new THREE.CylinderGeometry(0.07, 0.1, th + 0.1, lod ? 5 : 8, lod ? 1 : 3), m4(0, th / 2 - 0.05, 0, 0, 1, 1, 1, (r0() - 0.5) * 0.08, (r0() - 0.5) * 0.08), (x, y, z) => { const n = 0.8 + 0.4 * vn3(x * 30, y * 30, z * 30, seed); return [0.34 * n, 0.29 * n, 0.22 * n]; });
    const spine = (base, sd) => (x, y, z) => { const n = vn3(x * 42, y * 42, z * 42, sd); const w = n > 0.58 ? 0.45 : n < 0.3 ? -0.15 : 0; const k = 0.84 + 0.28 * n; const t = (c, hi) => Math.min(1, Math.max(0, (w >= 0 ? c + (hi - c) * w : c * (1 + w)) * k)); return [t(base[0], 0.96), t(base[1], 0.92), t(base[2], 0.7)]; };
    const grow = (x, y, z, ax, ay, az, len, rad, depth) => { dv.set(ax, ay, az).normalize(); q.setFromUnitVectors(Y, dv); const base = depth === 0 ? [0.36, 0.33, 0.22] : depth === 1 ? [0.56, 0.6, 0.38] : [0.7, 0.73, 0.48]; const cf = spine(base, seed + depth * 7 + Math.floor(r0() * 50));
      mt.compose(pv.set(x + dv.x * len / 2, y + dv.y * len / 2, z + dv.z * len / 2), q, sv.set(rad * 1.12, len * 0.6, rad * 1.12)); b.add(seg, mt, cf); const ex = x + dv.x * len, ey = y + dv.y * len, ez = z + dv.z * len;
      if (jt) { mt.compose(pv.set(ex, ey, ez), q, sv.set(rad * 1.04, rad * 0.85, rad * 1.04)); b.add(jt, mt, cf); } if (depth >= 3) return; const nk = depth === 0 ? 2 + Math.floor(r0() * 2) : depth === 1 ? 2 + Math.floor(r0() * 1.5) : 1 + Math.floor(r0() * 1.8);
      for (let i = 0; i < nk; i++) { const a = r0() * 6.283, el = 0.35 + r0() * 0.8; grow(ex, ey, ez, dv.x * 0.45 + Math.cos(a) * Math.cos(el), dv.y * 0.45 + Math.sin(el), dv.z * 0.45 + Math.sin(a) * Math.cos(el), len * (0.78 + r0() * 0.16), rad * 0.94, depth + 1); } };
    const n0 = 3 + Math.floor(r0() * 2); for (let i = 0; i < n0; i++) { const a = i / n0 * 6.283 + r0() * 0.6, el = 0.5 + r0() * 0.55; grow(0, th, 0, Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el), 0.2 + r0() * 0.06, 0.052, 0); }
    const nl = 1 + Math.floor(r0() * 2.5); for (let i = 0; i < nl; i++) { const a = r0() * 6.283, el = 0.2 + r0() * 0.4, y0 = th * (0.55 + r0() * 0.3); grow(Math.cos(a) * 0.06, y0, Math.sin(a) * 0.06, Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el), 0.18 + r0() * 0.05, 0.05, 1); } return b.geo(); }
  // barrel cactus: a ribbed squat ellipsoid with a crown of yellow flowers
  function barrelGeo(seed, lod) { const r0 = mulberry(seed + 55); const h = 0.62 + r0() * 0.2, r = 0.34 + r0() * 0.06, ribs = lod ? 6 : 13; const nh = lod ? 4 : 8, ns = ribs * 2; const pos = [], col = [], idx = [], uv = [];
    // the silhouette is a squat ellipse from a narrower foot (-60 degrees) to the crown (90 degrees)
    for (let j = 0; j <= nh; j++) { const t = j / nh; const th = -1.05 + t * (1.05 + Math.PI / 2); const pr = Math.cos(th), y = h * 0.5 * (1 + Math.sin(th)) - 0.06;
      for (let i = 0; i <= ns; i++) { const a = i / ns * 6.283; const ridge = i % 2 === 0; const rad = r * pr * (ridge ? 1 : 0.86); pos.push(Math.cos(a) * rad, y, Math.sin(a) * rad); uv.push(i / ns, t); const k = 0.85 + 0.2 * vn3(i, t * 6, seed, 3);
        const c = ridge ? [0.47 * k, 0.45 * k, 0.28 * k] : [0.23 * k, 0.33 * k, 0.19 * k]; col.push(Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2])); } }
    for (let j = 0; j < nh; j++) for (let i = 0; i < ns; i++) { const a = j * (ns + 1) + i, b = a + ns + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g0 = new THREE.BufferGeometry(); g0.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g0.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g0.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g0.setIndex(idx); g0.computeVertexNormals();
    // a ring of yellow flowers on the crown (at 70 degrees on the ellipse, just proud of the surface)
    const b = new GB(); b.add(g0); if (lod) return b.geo(); const fl = new THREE.IcosahedronGeometry(0.045, 0); const n = 7 + Math.floor(r0() * 5); const fr = r * Math.cos(1.22) * 1.02, fy = h * 0.5 * (1 + Math.sin(1.22)) - 0.06 + 0.012; for (let i = 0; i < n; i++) { const a = i / n * 6.283 + r0() * 0.3; b.add(fl, m4(Math.cos(a) * fr, fy, Math.sin(a) * fr, 0, 1, 0.7, 1), [0.95, 0.72, 0.16]); } return b.geo(); }
  // prickly pear: flattened pads branching from the ground (each child pad grows from its parent's top edge, in the
  // parent's plane), a few magenta fruits on the top edges
  function pearGeo(seed, lod) { const r0 = mulberry(seed + 77); const b = new GB(); const pad = lod ? new THREE.SphereGeometry(1, 5, 3) : new THREE.SphereGeometry(1, 8, 5); const fruit = new THREE.IcosahedronGeometry(0.035, 0); const q = new THREE.Quaternion(), e = new THREE.Euler(), up = new THREE.Vector3(), side = new THREE.Vector3();
    const grow = (x, y, z, yaw, tilt, s, depth) => { const w = 0.2 * s, hh = 0.25 * s; e.set(0, yaw, tilt, "YXZ"); q.setFromEuler(e); up.set(0, 1, 0).applyQuaternion(q); side.set(1, 0, 0).applyQuaternion(q); const cx = x + up.x * hh * 0.9, cy = y + up.y * hh * 0.9, cz = z + up.z * hh * 0.9; const k = 0.85 + r0() * 0.3;
      b.add(pad, m4(cx, cy, cz, yaw, w, hh, 0.045 * s, 0, tilt), (px, py, pz) => { const ee = Math.min(1, Math.hypot(px - cx, py - cy, pz - cz) / hh); return [Math.min(1, 0.4 * k + 0.12 * ee), Math.min(1, 0.53 * k - 0.08 * ee), Math.min(1, 0.3 * k + 0.12 * ee)]; });
      const tx = cx + up.x * hh * 0.85, ty = cy + up.y * hh * 0.85, tz = cz + up.z * hh * 0.85; const sx = side.x, sz = side.z, sy = side.y;
      if (depth < 2) { const nk = depth === 0 ? 2 : r0() < 0.6 ? 2 : 1; for (let k2 = 0; k2 < nk; k2++) { const off = (k2 - (nk - 1) / 2) * 0.22 * s; grow(tx + sx * off, ty + sy * off, tz + sz * off, yaw + (r0() - 0.5) * 0.9, tilt + (k2 - (nk - 1) / 2) * 0.8 + (r0() - 0.5) * 0.35, s * (0.8 + r0() * 0.12), depth + 1); } }
      else for (let k2 = 0; k2 < 3; k2++) if (r0() < 0.6) { const off = (r0() - 0.5) * 0.3 * s; b.add(fruit, m4(tx + sx * off, ty + sy * off - 0.01, tz + sz * off, 0, 1, 1.3, 1), [0.62, 0.12, 0.3]); } };
    const n0 = 3 + Math.floor(r0() * 2); for (let i = 0; i < n0; i++) { const a = i / n0 * 6.283 + r0(); grow(Math.cos(a) * 0.16, -0.05, Math.sin(a) * 0.16, a + 1.57, (r0() - 0.5) * 0.7, 1.0 + r0() * 0.25, 0); } return b.geo(); }
  // organ pipe: many ribbed columns rising from one base, each leaning out along its own radius
  function organGeo(seed, lod) { const r0 = mulberry(seed + 91); const b = new GB(); const n = 6 + Math.floor(r0() * 6); for (let i = 0; i < n; i++) { const a = i / n * 6.283 + r0() * 0.5, d = 0.12 + r0() * 0.28, h = 1.6 + r0() * 2.6, r = 0.1 + r0() * 0.05; const tilt = 0.05 + d * 0.35 + r0() * 0.08; b.add(columnGeo(h, r, lod ? 4 : 6, seed * 13 + i, [0.55, 0.5, 0.36], lod, [a, tilt * h * 0.55]), m4(Math.cos(a) * d, 0, Math.sin(a) * d)); } return b.geo(); }

  // the materials (one per placeholder family; vertex colours carry the variation)
  const MATS = {};
  function mats() { if (MATS.rock) return MATS;
    MATS.rock = new THREE.MeshStandardMaterial({ map: TEX.rock, normalMap: TEX.rockN, normalScale: new THREE.Vector2(1.1, 1.1), vertexColors: true, roughness: 0.94, metalness: 0 });
    MATS.rock.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), diffuseColor.rgb, 0.12);"); }; MATS.rock.customProgramCacheKey = () => "land_rock_desat";
    MATS.cactus = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
    MATS.bronze = new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.42, metalness: 0.65 });
    MATS.glass = new THREE.MeshStandardMaterial({ color: 0xf6ead2, emissive: 0xffc27a, emissiveIntensity: 0, roughness: 0.25, metalness: 0 });
    MATS.teak = new THREE.MeshStandardMaterial({ map: TEX.wood, color: 0xa07a52, roughness: 0.78 });
    MATS.timber = new THREE.MeshStandardMaterial({ map: TEX.wood, color: 0x7d5c3e, roughness: 0.92 });
    MATS.latilla = new THREE.MeshStandardMaterial({ map: TEX.wood, color: 0xc2a67c, roughness: 1 });
    MATS.stone = new THREE.MeshStandardMaterial({ map: TEX.travertine, color: 0xd9c7a8, roughness: 0.85 });
    MATS.steel = new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.38, metalness: 0.8, side: THREE.DoubleSide });
    MATS.water = new THREE.MeshStandardMaterial({ color: 0x3d5a58, roughness: 0.08, metalness: 0.2 });
    MATS.char = new THREE.MeshStandardMaterial({ color: 0x2a211b, roughness: 1 });
    MATS.ember = new THREE.MeshStandardMaterial({ color: 0x3a1a0a, emissive: 0xff5a1a, emissiveIntensity: 1.2, roughness: 1 });
    return MATS; }
  // register a procedural kind so put() instances, culls, shadows and collides it like any installed model
  function defKind(k, parts, spec, lodParts) { if (MODELS[k]) return true; try { const box = new THREE.Box3(); for (const p of parts) { if (!p.geometry.boundingBox) p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); } const sz = new THREE.Vector3(); box.getSize(sz);
      MODEL_SPECS[k] = Object.assign({ prop: true, solid: 0 }, spec || {}, { size: Math.max(sz.x, sz.z) || 1 }); MODELS[k] = { parts, norm: new THREE.Matrix4(), bottom: 0, radius: Math.max(sz.x, sz.z) / 2, height: Math.max(0.2, box.max.y), sx: sz.x, sz: sz.z, sink: 0 }; if (lodParts) MODELS[k].lodGeos = lodParts; cnt("kinds"); return true; } catch (e) { err("defKind " + k, e); return false; } }
  function defKinds() { const Mt = mats();
    for (let i = 0; i < 2; i++) defKind("land_rockL" + i, [{ geometry: rockGeo(11 + i * 5, 3, i === 1 ? "granite" : "tan"), material: Mt.rock }], {}, [rockGeo(11 + i * 5, 1, i === 1 ? "granite" : "tan")]);
    for (let i = 0; i < 2; i++) defKind("land_rock" + i, [{ geometry: rockGeo(21 + i * 5, 2, "tan"), material: Mt.rock }], {});
    defKind("land_rrockL", [{ geometry: rockGeo(71, 3, "red"), material: Mt.rock }], {}, [rockGeo(71, 1, "red")]); defKind("land_rrock0", [{ geometry: rockGeo(78, 2, "red"), material: Mt.rock }], {});
    for (let i = 0; i < 2; i++) { const h = i ? 3.3 : 2.3, r = i ? 0.24 : 0.2; defKind("land_sagy" + i, [{ geometry: linColors(sagyGeo(5 + i * 11, h, r, i === 1)), material: Mt.cactus }], { solid: 0.25 }, [linColors(sagyGeo(5 + i * 11, h, r, i === 1, true))]); }
    for (let i = 0; i < 2; i++) defKind("land_cholla" + i, [{ geometry: linColors(chollaGeo(9 + i * 17)), material: Mt.cactus }], { solid: 0.35 }, [linColors(chollaGeo(9 + i * 17, true))]);
    defKind("land_barrel", [{ geometry: linColors(barrelGeo(3)), material: Mt.cactus }], { solid: 0.3 }, [linColors(barrelGeo(3, true))]);
    defKind("land_pear", [{ geometry: linColors(pearGeo(4)), material: Mt.cactus }], { solid: 0.45 }, [linColors(pearGeo(4, true))]);
    defKind("land_organ", [{ geometry: linColors(organGeo(6)), material: Mt.cactus }], { solid: 0.6 }, [linColors(organGeo(6, true))]);
    // path lantern (golf, gardens): bronze post, frosted glass lantern, pyramid cap
    { const b = new GB(); b.add(new THREE.BoxGeometry(0.28, 0.16, 0.28), m4(0, 0.0, 0)).add(new THREE.BoxGeometry(0.1, 0.62, 0.1), m4(0, 0.39, 0)).add(new THREE.BoxGeometry(0.27, 0.03, 0.27), m4(0, 0.715, 0)); for (const [x, z] of [[-0.115, -0.115], [0.115, -0.115], [-0.115, 0.115], [0.115, 0.115]]) b.add(new THREE.BoxGeometry(0.028, 0.32, 0.028), m4(x, 0.87, z)); b.add(new THREE.BoxGeometry(0.27, 0.03, 0.27), m4(0, 1.03, 0)).add(new THREE.ConeGeometry(0.21, 0.13, 4), m4(0, 1.11, 0, Math.PI / 4)).add(new THREE.SphereGeometry(0.025, 6, 4), m4(0, 1.19, 0));
      defKind("land_lantern", [{ geometry: b.geo(), material: Mt.bronze }, { geometry: new THREE.BoxGeometry(0.2, 0.28, 0.2).translate(0, 0.87, 0), material: Mt.glass }], { solid: 0.18 }); L.lanternHead = 0.87; }
    // festoon post: black steel, a small cross arm at the top
    { const b = new GB(); b.add(new THREE.BoxGeometry(0.36, 0.2, 0.36), m4(0, 0.0, 0)).add(new THREE.BoxGeometry(0.11, 4.4, 0.11), m4(0, 2.15, 0)).add(new THREE.BoxGeometry(0.5, 0.06, 0.06), m4(0, 4.25, 0)).add(new THREE.SphereGeometry(0.06, 8, 6), m4(0, 4.38, 0)); defKind("land_fpost", [{ geometry: b.geo(), material: Mt.bronze }], { solid: 0.2 }); L.fpostTop = 4.2; }
    // bench: travertine pedestals, teak seat and back (faces +z)
    { const s = new GB(); for (const x of [-0.72, 0.72]) s.add(new THREE.BoxGeometry(0.16, 0.54, 0.46), m4(x, 0.15, 0)); const t = new GB(); for (let i = 0; i < 4; i++) t.add(new THREE.BoxGeometry(1.8, 0.04, 0.1), m4(0, 0.44, -0.16 + i * 0.11)); for (let i = 0; i < 3; i++) t.add(new THREE.BoxGeometry(1.8, 0.09, 0.03), m4(0, 0.62 + i * 0.12, -0.25, 0, 1, 1, 1, -0.12)); for (const x of [-0.72, 0.72]) t.add(new THREE.BoxGeometry(0.06, 0.4, 0.05), m4(x, 0.66, -0.24, 0, 1, 1, 1, -0.12));
      defKind("land_bench", [{ geometry: s.geo(), material: Mt.stone }, { geometry: t.geo(), material: Mt.teak }], { solid: 0 }); }
    // ramada: four mesquite posts, two beams, cross vigas and a latilla roof (dappled shade), a picnic table and two benches
    { const tb = new GB(), lb = new GB(); const post = new THREE.CylinderGeometry(0.11, 0.14, 3.1, 8); for (const [x, z] of [[-2.4, -1.8], [2.4, -1.8], [-2.4, 1.8], [2.4, 1.8]]) tb.add(post, m4(x, 1.35, z, 0, 1, 1, 1, (x > 0 ? 0.02 : -0.02), (z > 0 ? 0.015 : -0.015)));
      for (const z of [-1.8, 1.8]) tb.add(new THREE.BoxGeometry(5.6, 0.22, 0.26), m4(0, 2.86, z)); const viga = new THREE.CylinderGeometry(0.085, 0.085, 4.6, 7); for (let i = 0; i < 7; i++) tb.add(viga, m4(-2.55 + i * 0.85, 3.06, 0, 0, 1, 1, 1, Math.PI / 2)); const lat = new THREE.CylinderGeometry(0.032, 0.032, 5.8, 5); for (let i = 0; i < 26; i++) lb.add(lat, m4(0, 3.18, -2.0 + i * 0.16, 0, 1, 1, 1, 0, Math.PI / 2));
      tb.add(new THREE.BoxGeometry(2.2, 0.07, 0.86), m4(0, 0.76, 0)); for (const x of [-0.9, 0.9]) tb.add(new THREE.BoxGeometry(0.1, 0.72, 0.7), m4(x, 0.37, 0)); for (const z of [-0.78, 0.78]) { tb.add(new THREE.BoxGeometry(2.1, 0.06, 0.32), m4(0, 0.46, z)); for (const x of [-0.85, 0.85]) tb.add(new THREE.BoxGeometry(0.08, 0.44, 0.24), m4(x, 0.22, z)); }
      defKind("land_ramada", [{ geometry: tb.geo(), material: Mt.timber }, { geometry: lb.geo(), material: Mt.latilla }], { solid: 0 }); L.ramadaPosts = [[-2.4, -1.8], [2.4, -1.8], [-2.4, 1.8], [2.4, 1.8]]; }
    // fire ring: a ring of fieldstones, ash, crossed logs and glowing embers
    { const st = new GB(); const ring = 16; for (let i = 0; i < ring; i++) { const a = i / ring * 6.283; st.add(rockGeo(300 + i, 1, "granite"), m4(Math.cos(a) * 1.05, 0.02, Math.sin(a) * 1.05, a, 0.26, 0.24, 0.22)); } const lg = new GB(); lg.add(new THREE.CylinderGeometry(0.85, 0.85, 0.04, 20), m4(0, 0.03, 0), [0.2, 0.18, 0.16]); const log = new THREE.CylinderGeometry(0.07, 0.08, 0.95, 7); for (let i = 0; i < 5; i++) { const a = i / 5 * 6.283; lg.add(log, m4(Math.cos(a) * 0.22, 0.28, Math.sin(a) * 0.22, -a, 1, 1, 1, 0, 0.9), [0.4, 0.3, 0.22]); }
      const em = new GB(); for (let i = 0; i < 9; i++) { const a = i * 2.4, d = 0.12 + (i % 3) * 0.12; em.add(new THREE.IcosahedronGeometry(0.07, 0), m4(Math.cos(a) * d, 0.07, Math.sin(a) * d)); }
      defKind("land_firering", [{ geometry: st.geo(), material: Mt.rock }, { geometry: lg.geo(), material: Mt.char }, { geometry: em.geo(), material: Mt.ember }], { solid: 1.25 }); }
    // stock tank beside a windmill: galvanised ring, dark water
    { const b = new GB(); b.add(new THREE.CylinderGeometry(1.9, 1.9, 0.82, 28, 1, true), m4(0, 0.31, 0)); b.add(new THREE.TorusGeometry(1.9, 0.04, 6, 28), m4(0, 0.72, 0, 0, 1, 1, 1, Math.PI / 2)); for (let i = 0; i < 3; i++) b.add(new THREE.TorusGeometry(1.915, 0.02, 4, 28), m4(0, 0.15 + i * 0.2, 0, 0, 1, 1, 1, Math.PI / 2));
      defKind("land_tank", [{ geometry: b.geo(), material: Mt.steel }, { geometry: new THREE.CircleGeometry(1.86, 28).rotateX(-Math.PI / 2).translate(0, 0.6, 0), material: Mt.water }], { solid: 2.0 }); }
  }

  // ───────────── species -> kind (the new asset kinds as soon as they exist) ─────────────
  const phPick = (list) => { const ks = list.filter(has); return ks.length ? ks[Math.floor(R() * ks.length)] : null; };
  const phAny = (pre, n) => { const ks = []; for (let i = 1; i <= n; i++) if (has(pre + i)) ks.push(pre + i); return ks.length ? ks[Math.floor(R() * ks.length)] : null; };
  const fitH = (k, lo, hi) => Math.max(0.3, Math.min(6, rr(lo, hi) / Math.max(0.05, MODELS[k].height || 1)));
  const fitS = (k, lo, hi) => { const m = MODELS[k]; return Math.max(0.2, Math.min(6, rr(lo, hi) / Math.max(0.08, Math.max(m.sx || 0, m.sz || 0) || m.radius * 2 || 1))); };
  const palmKind = () => { const ks = ["fanpalm2", "datepalm", "canarypalm"].filter(has); return ks.length ? ks[Math.floor(R() * ks.length)] : "fanpalm"; };
  // -> [kind, scale, tall]: tall = over about 7 m (the runway transitional surface keeps those 150 m or more from the centreline)
  function species(sp, style) {
    switch (sp) {
      case "saguaro_giant": return has("saguaro_giant") ? ["saguaro_giant", rr(0.85, 1.15), 1] : ["saguaro", rr(1.45, 1.8), 1];
      case "saguaro_mid": return has("saguaro_mid") ? ["saguaro_mid", rr(0.85, 1.15), 1] : ["saguaro", rr(0.85, 1.25), 1];
      case "saguaro_young": return has("saguaro_young") ? ["saguaro_young", rr(0.75, 1.2), 0] : R() < 0.62 ? ["land_sagy0", rr(0.55, 1.35), 0] : ["land_sagy1", rr(0.8, 1.2), 0];
      case "barrel": return has("barrel_cactus") ? ["barrel_cactus", rr(0.7, 1.3), 0] : ["land_barrel", rr(0.5, 1.05), 0];
      case "pear": return has("prickly_pear") ? ["prickly_pear", rr(0.7, 1.3), 0] : ["land_pear", rr(0.75, 1.45), 0];
      case "cholla": return has("cholla") ? ["cholla", rr(0.7, 1.3), 0] : ["land_cholla" + Math.floor(R() * 2), rr(0.8, 1.35), 0];
      case "quiver": { const k = phPick(["ph_quiver_1"]); return k ? [k, fitH(k, 2.2, 3.6), 0] : species("organ"); }
      case "organ": return has("organ_pipe") ? ["organ_pipe", rr(0.8, 1.2), 0] : ["land_organ", rr(0.75, 1.3), 0];
      case "ocotillo": return has("ocotillo") ? ["ocotillo", rr(0.75, 1.3), 0] : null;
      case "agave": return has("agave_cluster") && R() < 0.22 ? ["agave_cluster", rr(0.7, 1.25), 0] : has("bush1") ? ["bush1", rr(0.4, 0.7), 0] : null;
      case "yucca": return has("yucca_cluster") && R() < 0.45 ? ["yucca_cluster", rr(0.6, 1.0), 0] : species("agave");
      case "shrub": { const k = R() < 0.36 ? phPick(["ph_shrub_1", "ph_shrub_2", "ph_shrub_3"]) : null; return k ? [k, fitH(k, 0.5, 1.3), 0] : has("bush2") ? ["bush2", rr(0.6, 1.1), 0] : null; }
      case "succulent": { const q = R(); const k = q < 0.3 ? phPick(["ph_succulent_1"]) : q < 0.38 ? phPick(["ph_succulent_2"]) : null; return k ? [k, MODELS[k].height > 1 ? fitH(k, 0.8, 1.5) : fitH(k, 0.22, 0.5), 0] : has("bush1") ? ["bush1", rr(0.32, 0.55), 0] : null; }
      case "grass": return has("bush2") ? ["bush2", rr(0.45, 0.85), 0] : null;
      case "paloverde": return has("paloverde") ? ["paloverde", rr(0.7, 1.05), 1] : null;
      case "ironwood": return has("ironwood") ? ["ironwood", rr(0.7, 1.0), 1] : null;
      case "mesquite": return has("mesquite") ? ["mesquite", rr(0.8, 1.25), 0] : null;
      case "willow": return has("desertwillow") ? ["desertwillow", rr(0.8, 1.1), 0] : null;
      case "palm": return [palmKind(), rr(0.85, 1.1), 1];
      case "rock_big": { if (style === "red") { const k = phAny("ph_moonrock_", 8); if (k) return [k, rr(0.8, 1.4), 0]; return ["land_rrockL", rr(1.2, 2.6), 0]; } const k = phAny("ph_boulder_", 8); if (k) return [k, fitS(k, 1.4, 3.2), 0]; return ["land_rockL" + Math.floor(R() * 2), rr(1.1, 2.2), 0]; }
      case "rock": { if (style === "red") { const k = phAny("ph_moonrock_", 8); if (k) return [k, rr(0.4, 0.8), 0]; return ["land_rrock0", rr(0.45, 1.0), 0]; } const k = phAny("ph_rock_", 8); if (k) return [k, fitS(k, 0.35, 0.95), 0]; return ["land_rock" + Math.floor(R() * 2), rr(0.4, 0.95), 0]; }
      case "stones": return has("ph_stones") ? ["ph_stones", rr(0.8, 1.2), 0] : ["land_rock" + Math.floor(R() * 2), rr(0.18, 0.32), 0];
    }
    return null; }
  // weighted choice from [[name, weight], ...]
  const wpick = (list) => { let s = 0; for (const q of list) s += q[1]; let t = R() * s; for (const q of list) { t -= q[1]; if (t <= 0) return q[0]; } return list[list.length - 1][0]; };

  // district palettes: what grows where, the rock colour, the bed gravel, the vignette mix and the features that fit
  const PAL = {
    lux: { spec: [["paloverde", 3], ["ironwood", 2], ["saguaro_giant", 1.5], ["saguaro_mid", 2], ["organ", 0.8], ["quiver", 0.5]], acc: [["agave", 3], ["yucca", 2], ["barrel", 3], ["pear", 1.2], ["saguaro_young", 1.5]], gnd: [["grass", 3], ["shrub", 3], ["succulent", 2]], rock: "tan", bed: "dg", mix: [["bed", 4], ["grove", 3], ["outcrop", 1.5], ["thicket", 1]], feats: ["benches", "ramada", "fire"], space: 22, lit: true },
    desert: { spec: [["saguaro_mid", 3], ["saguaro_giant", 2], ["saguaro_young", 2.5], ["ocotillo", 2], ["paloverde", 1]], acc: [["barrel", 3], ["pear", 2], ["cholla", 2], ["agave", 1], ["yucca", 1]], gnd: [["shrub", 3], ["grass", 2], ["succulent", 1]], rock: "tan", bed: null, mix: [["grove", 5], ["outcrop", 3], ["thicket", 1.5], ["bed", 0.6]], feats: ["ramada", "benches"], space: 26, lit: true },
    ranch: { spec: [["mesquite", 3], ["saguaro_mid", 1.5], ["ocotillo", 1.5], ["saguaro_giant", 0.8]], acc: [["pear", 4], ["cholla", 2], ["barrel", 1.2], ["yucca", 1.2]], gnd: [["grass", 3], ["shrub", 2]], rock: "tan", bed: null, mix: [["grove", 3], ["thicket", 3], ["outcrop", 2]], feats: ["windmill", "stagecoach", "fire"], space: 28, lit: true },
    outpost: { spec: [["organ", 3], ["saguaro_giant", 1.2], ["ocotillo", 2.2], ["saguaro_young", 2]], acc: [["cholla", 3], ["barrel", 3], ["agave", 1.2], ["pear", 0.8]], gnd: [["succulent", 2], ["shrub", 1.2]], rock: "red", bed: "red", mix: [["outcrop", 4], ["grove", 3], ["bed", 1]], feats: ["rover", "sculpture"], space: 24, lit: false },
    golf: { spec: [["palm", 2.5], ["paloverde", 2], ["ironwood", 1], ["saguaro_mid", 1]], acc: [["agave", 3], ["barrel", 2.5], ["yucca", 2], ["organ", 0.8]], gnd: [["grass", 3], ["succulent", 2], ["shrub", 1]], rock: "tan", bed: "dg", mix: [["bed", 4], ["grove", 2], ["outcrop", 1]], feats: ["benches"], space: 24, lit: true },
    design: { spec: [["saguaro_giant", 2], ["organ", 1.5], ["paloverde", 1.5], ["ocotillo", 1.5], ["quiver", 0.8]], acc: [["agave", 3], ["barrel", 2], ["yucca", 2], ["pear", 1]], gnd: [["grass", 2], ["succulent", 2], ["shrub", 1]], rock: "granite", bed: "dg", mix: [["bed", 3], ["grove", 3], ["outcrop", 2]], feats: ["sculpture", "benches"], space: 24, lit: true },
  };
  const DPAL = { S1_WASH: "lux", S1_ARRIVE: "lux", S1_ROW: "lux", S1_HANGARS: "desert", S1_LODGE: "lux", S1_GREEN: "lux", S1_CLUB: "lux", S2_MARKET: "desert", S2_APRON: "desert", S2_MOTOR: "desert", S2_ARROYO: "desert",
    S3_MAIN: "ranch", S3_ARROYO: "ranch", S3_RIDGEWASH: "desert", S3_NFWASH: "outpost", S3_OUTPOST: "outpost", S3_NORTHYARD: "outpost", S3_NIGHT: "outpost", S3_GATE: "desert", S3_DEPOT: "desert", S3_FRONTIER: "ranch", S3_WORKS: "desert", S3_GOLF: "golf",
    S3_SOUTH: "lux", S3_FOUNTAIN: "lux", S3_DESIGN: "design", S3_MESA: "lux", S3_SUNSET: "lux", S3_COMMONS: "lux", S3_RANCH: "ranch" };
  const DARK = new Set(["S3_OUTPOST", "S3_NORTHYARD"]);   // the dark-sky side: no lanterns (A1: bollards only)
  // the two stretches the user showed get a denser, designed treatment
  const FOCUS = [{ id: "outpost_ground", x: 962, z: 545, r: 140, space: 0.58, bare: 8 }, { id: "commons", x: 300, z: 700, r: 150, space: 0.66, bare: 7 }];
  const focusAt = (x, z) => { for (const f of FOCUS) if (Math.hypot(x - f.x, z - f.z) < f.r) return f; return null; };
  function palAt(x, z) { const d = planDistrictAt(x, z); const id = d ? d.id : null; return { id, p: PAL[DPAL[id] || "desert"], name: DPAL[id] || "desert", dark: DARK.has(id), nofeat: id === "S3_NORTHYARD" }; }

  // ───────────── placement ─────────────
  const OWN = new Map(); const OC = 6;   // my own placements in 6 m buckets: [x, z, r]
  function ownNear(x, z, r) { const i0 = Math.floor((x - r - 4) / OC), i1 = Math.floor((x + r + 4) / OC), j0 = Math.floor((z - r - 4) / OC), j1 = Math.floor((z + r + 4) / OC); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = OWN.get(i * 100003 + j); if (!a) continue; for (const q of a) if (Math.hypot(q[0] - x, q[1] - z) < q[2] + r) return true; } return false; }
  function ownAdd(x, z, r) { const k = Math.floor(x / OC) * 100003 + Math.floor(z / OC); let a = OWN.get(k); if (!a) OWN.set(k, a = []); a.push([x, z, r]); }
  // a free planting spot: our land, off the runway strip, not on anything built, not in a golf corridor, not on my own things
  function spotOK(x, z, rad, o) { o = o || {}; const k = cellK(x, z); if (k < 0) return false; if (ZN[k] !== 1 && !o.anyZone) return false; if (DB && DB[k] < 7) return false; const bits = RA[k]; if (bits & (B_PLANT | B_GOLF)) return false; if (o.tall && (bits & B_TALL)) return false;
    const dr = distToRunway(x, z); if (dr < (o.tall ? 155 : 128)) return false;
    for (const [dx, dz] of [[rad, 0], [-rad, 0], [0, rad], [0, -rad]]) { const b2 = at(RA, x + dx, z + dz, B_PLANT); if (b2 & (B_PLANT | B_GOLF)) return false; }
    if (!planSpotOK(x, z, rad)) return false; if (ownNear(x, z, rad * (o.tight ? 0.6 : 1))) return false; return true; }
  // put a species at (x, z); returns the entry or null
  function plant(sp, x, z, style, o) { o = o || {}; const q = species(sp, style); if (!q) return null; const [k, s0, tall0] = q; if (!has(k)) return null; const m = MODELS[k]; let s = s0 * (o.sk || 1); const h = m.height * s; const tall = h > 7;
    const rad = Math.max(0.35, Math.min(3.2, (o.rad !== undefined ? o.rad : m.radius * s * (sp.startsWith("rock") || sp === "stones" ? 0.8 : 0.45)))); if (!o.force && !spotOK(x, z, rad, { tall, tight: o.tight, anyZone: o.anyZone })) return null;
    put(k, x, z, o.yaw !== undefined ? o.yaw : R() * 6.283, s); const e = PLACE[k][PLACE[k].length - 1]; e.keep = true; e.land = 1;
    if (ROCKK.test(k)) { e.sy = rr(0.75, 1.15); if (m.height * s * e.sy > 0.9) { COLLIDERS.push([x, z, m.radius * s * 0.72]); e.col = 1; } } ownAdd(x, z, Math.max(rad, o.gap || 0)); markCircle(RA, B_MINE, x, z, Math.min(3, rad)); cnt(sp); cnt("plants"); return e; }

  const ROCKK = /^land_r?rock|^ph_boulder_|^ph_moonrock_|^ph_rock_|^xrock_/;
  // ───────────── the rasters ─────────────
  function buildRasters() { const t0 = performance.now(); const N = G.nx * G.nz; RA = new Uint8Array(N); COV = new Uint8Array(N); ZN = new Uint8Array(N);
    // zones at 5 m (every second cell), copied to the neighbours
    for (let j = 0; j < G.nz; j += 2) for (let i = 0; i < G.nx; i += 2) { const x = G.X0 + (i + 1) * G.C, z = G.Z0 + (j + 1) * G.C; const zn = planZone(x, z); const v = zn === "land" ? 1 : zn === "wash" ? 2 : zn === "city" ? 3 : 0; for (let dj = 0; dj < 2 && j + dj < G.nz; dj++) for (let di = 0; di < 2 && i + di < G.nx; di++) ZN[(j + dj) * G.nx + i + di] = v; }
    const both = B_HILL | B_PLANT;
    // roads, promenades, every registered ribbon (golf cart paths included)
    for (const r of ROADS) { const p = r.pts; if (!p) continue; for (let i = 0; i < p.length - 1; i++) { markSeg(RA, B_HILL, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], r.w / 2 + 2.0); markSeg(RA, B_PLANT, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], r.w / 2 + 1.4); } }
    for (const p of PLAZAS) markCircle(RA, both, p[0], p[1], p[2] + 2);
    // keep-outs: places with a use, venues, fairway points. The Commons, its glamping loop and the Design District fields
    // are open ground people walk through: they keep their hills off but can be planted (with care, the rest of the tests hold)
    const soft = []; for (const id of ["commons", "glamping", "design_district", "flagship", "genesis_lodge", "golf", "golf_clubhouse", "homestead_domes", "frontier_ranches", "fireside"]) { const q = planPlace(id); if (q) soft.push(q); }
    for (const k of KEEPOUT) { markCircle(RA, B_HILL, k[0], k[1], k[2] * 0.85); const s = soft.some((q) => Math.abs(q.x - k[0]) < 0.6 && Math.abs(q.z - k[1]) < 0.6); if (!s) markCircle(RA, B_PLANT, k[0], k[1], k[2] * 0.92); }
    for (const kp of PLAN_KEEP_POLY) markPoly(RA, both, kp.poly, 2);
    // places: no grading inside a place; landmarks (land art, arches, spirals) no planting either
    const USE = new Set(["plaza", "arrival", "attraction", "landmark", "civic"]); for (const q of PLAN.places || []) { if (/^gp_/.test(q.id) || q.status === "cut") continue; const r = q.r || 12; if (USE.has(q.type)) markCircle(RA, B_HILL, q.x, q.z, r * 0.75 + 4); if (q.type === "landmark") markCircle(RA, B_PLANT, q.x, q.z, r * 0.8 + 3); }
    // buildings and their graded pads; lamps (their bulbs were placed before this hook); big colliders; box solids
    for (const kind in PLACE) { const sp = MODEL_SPECS[kind], m = MODELS[kind]; if (!sp || !m) continue; const list = PLACE[kind];
      if (!sp.prop && !sp.vehicle) { for (const e of list) { const pr = m.radius * e[4] * 1.25 + 3; markCircle(RA, B_HILL, e[0], e[2], pr + Math.max(6, pr * 0.5) + 2); markCircle(RA, B_PLANT, e[0], e[2], m.radius * e[4] * 1.02 + 1.5); markCircle(COV, 1, e[0], e[2], m.radius * e[4]); } continue; }
      const tallK = m.height >= 1.6; const lamp = kind === "lamp" || /lamp|lantern/.test(kind);
      for (const e of list) { if (lamp) markCircle(RA, both, e[0], e[2], 1.6); else if (!e.land) markCircle(RA, both, e[0], e[2], Math.max(0.7, Math.min(4, m.radius * e[4] * 0.7 + 0.5))); if (tallK && m.height * e[4] >= 1.6) markCircle(COV, 1, e[0], e[2], Math.max(1.2, Math.min(4, m.radius * e[4] * 0.8))); } }
    for (const c of COLLIDERS) { if (c[2] >= 2.2) markCircle(RA, both, c[0], c[1], c[2] + 1); }
    // pools and lot pads keep their levels (their meshes are built later at the heights recorded now)
    try { for (const q of POOLS) markCircle(RA, both, q.x, q.z, Math.max(q.w, q.d) / 2 + 8); } catch (e) {} try { for (const l of LOTS) markCircle(RA, B_HILL, l.x, l.z, 20); } catch (e) {}
    for (const s of SOLIDS) { if (/^aijet/.test(s.tag || "")) continue; const r = Math.hypot(s.hw, s.hd); if (r > 45) continue; markCircle(RA, both, s.x, s.z, r + 1); if (s.y1 - s.y0 > 1.4) markCircle(COV, 1, s.x, s.z, r); }
    // golf: every hole's play corridor, the range and the putting green
    try { const holes = (golf && golf.holes && golf.holes.length) ? golf.holes : []; for (const h of holes) { const g = h.green; const s0 = playStart(h); markSeg(RA, B_GOLF | B_HILL, s0[0], s0[1], g[0], g[1], (h.w || 18) / 2 + 12); markSeg(RA, B_GOLF | B_HILL, h.tee[0], h.tee[1], s0[0], s0[1], 6); markCircle(RA, B_GOLF | B_HILL, g[0], g[1], g[2] + 12); markCircle(RA, B_GOLF | B_HILL, h.tee[0], h.tee[1], 4.5); markCircle(RA, B_HILL, h.tee[0], h.tee[1], 12); for (const b of h.bunkers || []) markCircle(RA, B_GOLF, b[0], b[1], b[2] + 3); }
      if (golf.range) { const Rg = golf.range; markSeg(RA, B_GOLF | B_HILL, Rg.tee[0], Rg.tee[1], Rg.end[0], Rg.end[1], (Rg.half || 30) + 8); }
      if (golf.putt) markCircle(RA, B_GOLF | B_HILL, golf.putt.x, golf.putt.z, golf.putt.r + 10); L.golf.holes = holes.length; } catch (e) { err("golf raster", e); }
    // the grading other hooks did (pads, venues, the knoll, ramps, the Ring mound): leave it exactly as it is
    if (L.H0 && L.H0.length === H.length) { const cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1); let nd = 0; for (let r = 0; r < T.rows; r++) { const z = T.zmin + r * ch; if (z < G.Z0 || z > G.Z1) continue; for (let c = 0; c < T.cols; c++) { const x = T.xmin + c * cw; if (x < G.X0 || x > G.X1) continue; const i = r * T.cols + c; if (Math.abs(H[i] - L.H0[i]) > 0.02) { markCircle(RA, B_HILL, x, z, 6); nd++; } } } L.n.gradedCells = nd; }
    scanScene(); L.t.rasters = Math.round(performance.now() - t0); }
  const playStart = (h) => [h.tee[0] + Math.sin(h.dir) * 14, h.tee[1] + Math.cos(h.dir) * 14];
  // the tight play area (fairway line, green, tee box, range, putting green): lanterns stay out of it
  function inPlay(x, z, pad) { try { for (const h of golf.holes || []) { const g = h.green, f0 = h.fw ? h.fw[0] : playStart(h); if (segD(x, z, f0[0], f0[1], g[0], g[1]) < (h.w || 18) / 2 + pad) return true; if (Math.hypot(x - g[0], z - g[1]) < g[2] + pad + 1) return true; if (Math.hypot(x - h.tee[0], z - h.tee[1]) < 3.2) return true; } if (golf.range && segD(x, z, golf.range.tee[0], golf.range.tee[1], golf.range.end[0], golf.range.end[1]) < (golf.range.half || 30) + pad) return true; if (golf.putt && Math.hypot(x - golf.putt.x, z - golf.putt.z) < golf.putt.r + pad) return true; } catch (e) {} return false; }
  // every mesh already in the scene (module set pieces, venues, signs, fences, benches, bulbs...) keeps its ground
  function scanScene() { const t0 = performance.now(); const v = new THREE.Vector3(), bb = new THREE.Box3(), mt = new THREE.Matrix4(), sph = new THREE.Sphere(); let nObj = 0, nTri = 0;
    scene.updateMatrixWorld(true);
    const inBox = (x, z) => x > G.X0 && x < G.X1 && z > G.Z0 && z < G.Z1;
    scene.traverse((o) => { if (o === scene || o.isSkinnedMesh || o.isLight || o.userData.landSkip) return;
      if (o.isSprite) { o.getWorldPosition(v); if (!inBox(v.x, v.z)) return; const gy = getH(v.x, v.z); if (v.y > gy + 45 || v.y < gy - 30) return; markCircle(RA, B_HILL | B_PLANT, v.x, v.z, Math.min(8, Math.max(o.scale.x, o.scale.z) * 0.5) + 1); nObj++; return; }
      if (!(o.isMesh || o.isPoints || o.isLine)) return; const g = o.geometry; if (!g || !g.attributes || !g.attributes.position) return;
      if (o.isInstancedMesh) { if (!g.boundingSphere) g.computeBoundingSphere(); const r0 = g.boundingSphere.radius; const n = Math.min(o.count, 20000); for (let i = 0; i < n; i++) { o.getMatrixAt(i, mt); mt.premultiply(o.matrixWorld); v.copy(g.boundingSphere.center).applyMatrix4(mt); if (!inBox(v.x, v.z)) continue; const s = mt.getMaxScaleOnAxis(); const gy = getH(v.x, v.z); if (v.y - r0 * s > gy + 45 || v.y + r0 * s < gy - 30) continue; const rad = Math.min(25, r0 * s); markCircle(RA, B_HILL | B_PLANT, v.x, v.z, rad * 0.8 + 1.2); if (r0 * s > 0.9) markCircle(COV, 1, v.x, v.z, rad * 0.7); } nObj++; return; }
      if (!g.boundingBox) g.computeBoundingBox(); bb.copy(g.boundingBox).applyMatrix4(o.matrixWorld); if (!isFinite(bb.min.x) || !isFinite(bb.max.x)) return; const w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z; if (w > 3000 || d > 3000) return;
      if (bb.max.x < G.X0 || bb.min.x > G.X1 || bb.max.z < G.Z0 || bb.min.z > G.Z1) return; const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2; const gy = getH(cx, cz); if (bb.min.y > gy + 45 || bb.max.y < gy - 30) return; nObj++;
      if (w < 60 && d < 60 && !o.isPoints && !o.isLine) { markRect(RA, B_HILL | B_PLANT, bb.min.x - 1.5, bb.max.x + 1.5, bb.min.z - 1.5, bb.max.z + 1.5); if (bb.max.y - bb.min.y > 1.4) markRect(COV, 1, bb.min.x, bb.max.x, bb.min.z, bb.max.z); return; }
      // large or scattered objects: every triangle (or vertex) where it really is
      const p = g.attributes.position, ix = g.index ? g.index.array : null; const mw = o.matrixWorld.elements; const W = (k, out) => { const x = p.getX(k), y = p.getY(k), z = p.getZ(k); out[0] = mw[0] * x + mw[4] * y + mw[8] * z + mw[12]; out[1] = mw[1] * x + mw[5] * y + mw[9] * z + mw[13]; out[2] = mw[2] * x + mw[6] * y + mw[10] * z + mw[14]; };
      const A = [0, 0, 0], Bv = [0, 0, 0], Cv = [0, 0, 0];
      if (o.isPoints || o.isLine) { const n = p.count, st = Math.max(1, Math.floor(n / 60000)); for (let k = 0; k < n; k += st) { W(k, A); if (!inBox(A[0], A[2])) continue; const gy2 = getH(A[0], A[2]); if (A[1] > gy2 + 45 || A[1] < gy2 - 30) continue; markCircle(RA, B_HILL | B_PLANT, A[0], A[2], 1.5); } return; }
      const F = (ix ? ix.length : p.count) / 3; const st = Math.max(1, Math.floor(F / 250000));
      for (let f = 0; f < F; f += st) { W(ix ? ix[f * 3] : f * 3, A); W(ix ? ix[f * 3 + 1] : f * 3 + 1, Bv); W(ix ? ix[f * 3 + 2] : f * 3 + 2, Cv); const gy2 = getH(A[0], A[2]); if (Math.min(A[1], Bv[1], Cv[1]) > gy2 + 45) continue; markTri(RA, B_HILL | B_PLANT, A[0], A[2], Bv[0], Bv[2], Cv[0], Cv[2], 1.5); nTri++; } });
    L.n.scanObjects = nObj; L.n.scanTris = nTri; L.t.scan = Math.round(performance.now() - t0); }

  // ───────────── hills and mounds ─────────────
  // view corridors to the Genesis Ring (the horizon landmark every arrival looks for): grading stays low on these lines
  function corridors() { const out = []; const ring = planPlace("genesis_ring"); if (!ring) return out; for (const id of ["arrivals_court", "crossing_plaza", "expanse_gate", "four_corners", "compass_plaza", "outpost_gate", "launch_plaza", "welcome_house"]) { const q = planPlace(id); if (q) out.push([q.x, q.z, ring.x, ring.z]); }
    try { const t = TERM; if (t && t.exit) out.push([t.exit[0], t.exit[1], ring.x, ring.z]); } catch (e) {} return out; }
  function makeHills() { const t0 = performance.now(); const N = G.nx * G.nz;
    DP = distField((k) => (RA[k] & B_HILL) !== 0); DZ = distField((k) => ZN[k] !== 1); DB = distField((k) => ZN[k] === 0 || ZN[k] === 3);
    const cors = corridors(); L.corridors = cors.length; for (const c of cors) markSeg(RA, B_TALL, c[0], c[1], c[2], c[3], 9);
    // candidate centres: every 5 m cell well inside free land, far enough from the runway
    const cand = []; for (let j = 1; j < G.nz; j += 2) for (let i = 1; i < G.nx; i += 2) { const k = j * G.nx + i; if (DP[k] < 10 || DZ[k] < 20) continue; const x = G.X0 + (i + 0.5) * G.C, z = G.Z0 + (j + 0.5) * G.C; if (distToRunway(x, z) < 165) continue; cand.push([k, DP[k] + R() * 8, x, z]); }
    cand.sort((a, b) => b[1] - a[1]); const taken = new Uint8Array(N); const hills = []; const GRAIN = 0.62;
    for (const [k, , x, z] of cand) { if (taken[k]) continue; const d = DP[k]; let Rh = Math.min(135, d * 1.2 + 9) * rr(0.85, 1.12); if (Rh < 15) continue; const big = Rh > 55;
      let h = big ? Rh * rr(0.058, 0.1) : Rh * rr(0.07, 0.13); h = Math.min(h, 13.5); const dr = distToRunway(x, z); h = Math.min(h, Math.max(0, (dr - 140) / 7)); if (h < 0.8) continue;
      const hill = { x, z, R: Rh, h, e: rr(1.0, 1.9), th: GRAIN + rr(-0.7, 0.7), ph: R() * 6.283, ph2: R() * 6.283 }; hills.push(hill);
      if (Rh > 38) { const ns = 1 + Math.floor(R() * 3); for (let s = 0; s < ns; s++) { const a = R() * 6.283, dd = Rh * rr(0.35, 0.72); hills.push({ x: x + Math.cos(a) * dd, z: z + Math.sin(a) * dd, R: Rh * rr(0.3, 0.55), h: h * rr(0.35, 0.8), e: rr(1, 1.6), th: GRAIN + rr(-1, 1), ph: R() * 6.283, ph2: R() * 6.283, sub: 1 }); } }
      const rk = Rh * 0.72; markCircle(taken, 1, x, z, rk); if (hills.length > 320) break; }
    // the field, evaluated at the terrain vertices
    const cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1); HADD = new Float32Array(H.length);
    for (const hl of hills) { const ext = hl.R * hl.e * 1.25; const c0 = Math.max(0, Math.floor((hl.x - ext - T.xmin) / cw)), c1 = Math.min(T.cols - 1, Math.ceil((hl.x + ext - T.xmin) / cw)), r0 = Math.max(0, Math.floor((hl.z - ext - T.zmin) / ch)), r1 = Math.min(T.rows - 1, Math.ceil((hl.z + ext - T.zmin) / ch)); const cs = Math.cos(hl.th), sn = Math.sin(hl.th);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const x = T.xmin + c * cw, z = T.zmin + r * ch; const dx = x - hl.x, dz = z - hl.z; const u = (dx * cs + dz * sn) / hl.e, v = -dx * sn + dz * cs; const ang = Math.atan2(v, u); const rad = hl.R * (1 + 0.16 * Math.sin(3 * ang + hl.ph) + 0.08 * Math.sin(5 * ang + hl.ph2)); const t = Math.hypot(u, v) / rad; if (t >= 1) continue; let f = 1 - t * t; f *= f; HADD[r * T.cols + c] += hl.h * f * (0.9 + 0.2 * vn2(x * 0.035, z * 0.035, 4)); } }
    // blend: nothing within 4 m of anything protected, full height 24 m out; our land only; low on the view corridors; the runway cap
    let nv = 0, maxA = 0; for (let r = 0; r < T.rows; r++) { const z = T.zmin + r * ch; if (z < G.Z0 || z > G.Z1) continue; for (let c = 0; c < T.cols; c++) { const x = T.xmin + c * cw; if (x < G.X0 || x > G.X1) continue; const i = r * T.cols + c; let a = HADD[i];
        const k = cellK(x, z); if (k < 0) { HADD[i] = 0; continue; } const dp = DP[k], dz = DZ[k]; const micro = (vn2(x * 0.021, z * 0.021, 21) - 0.5) * 1.5 * sm(6, 24, dp); a = Math.min(15, a) + micro;
        let m = sm(3, 3 + Math.max(22, Math.abs(a) * 5), dp) * sm(8, 30, dz); if (m <= 0) { HADD[i] = 0; continue; }
        for (const cc of cors) { const vx = cc[2] - cc[0], vz = cc[3] - cc[1]; const L2 = vx * vx + vz * vz; const tt = ((x - cc[0]) * vx + (z - cc[1]) * vz) / L2; if (tt < 0 || tt > 1) continue; const lat = Math.abs((x - cc[0]) * vz - (z - cc[1]) * vx) / Math.sqrt(L2); if (lat < 80) m *= 0.12 + 0.88 * sm(22, 80, lat); }
        const dr = distToRunway(x, z); a = Math.min(a * m * sm(135, 185, dr), Math.max(0, (dr - 135) / 7)); HADD[i] = a; if (Math.abs(a) > 0.005) { H[i] += a; nv++; if (a > maxA) maxA = a; } } }
    L.hills = hills.filter((q) => !q.sub).map((q) => [Math.round(q.x), Math.round(q.z), Math.round(q.R), +q.h.toFixed(1)]); L.n.hills = L.hills.length; L.n.hillBumps = hills.length; L.n.hillVerts = nv; L.n.hillMax = +maxA.toFixed(2); L.t.hills = Math.round(performance.now() - t0); }
  const hillAt = (x, z) => { if (!HADD) return 0; const u = (x - T.xmin) / (T.xmax - T.xmin) * (T.cols - 1), v = (z - T.zmin) / (T.zmax - T.zmin) * (T.rows - 1); const c = Math.max(0, Math.min(T.cols - 1, Math.round(u))), r = Math.max(0, Math.min(T.rows - 1, Math.round(v))); return HADD[r * T.cols + c]; };
  // Outpost craters: shallow bowls with a raised rim and red ejecta, on free ground only
  function makeCraters() { const out = []; const want = 4; const tries = []; for (let j = 2; j < G.nz; j += 4) for (let i = 2; i < G.nx; i += 4) { const k = j * G.nx + i; if (DP[k] < 26) continue; const x = G.X0 + (i + 0.5) * G.C, z = G.Z0 + (j + 0.5) * G.C; const d = planDistrictAt(x, z); if (!d || (d.id !== "S3_OUTPOST" && d.id !== "S3_NORTHYARD")) continue; tries.push([x, z, DP[k] + R() * 10]); }
    tries.sort((a, b) => b[2] - a[2]); const fo = FOCUS[0]; for (const [x, z] of tries) { if (out.length >= 2) break; if (Math.hypot(x - fo.x, z - fo.z) > fo.r || out.some((c) => Math.hypot(c.x - x, c.z - z) < 55)) continue; out.push({ x, z, R: rr(10, 15), d: rr(1.2, 1.8), rim: rr(0.7, 1.1), focus: 1 }); }
    for (const [x, z] of tries) { if (out.length >= want + 1) break; if (out.some((c) => Math.hypot(c.x - x, c.z - z) < (c.focus ? 80 : 150))) continue; const Rc = rr(9, 14); out.push({ x, z, R: Rc, d: rr(1.1, 1.7), rim: rr(0.6, 1.0) }); }
    for (const c of out) { const ext = c.R * 1.9; planGrade(c.x - ext, c.x + ext, c.z - ext, c.z + ext, (x, z, h) => { const t = Math.hypot(x - c.x, z - c.z) / c.R; if (t > 1.9) return h; const k = cellK(x, z); const m = k < 0 ? 0 : sm(4, 14, DP[k]); const bowl = t < 1 ? -c.d * (1 - t * t) : 0; const rim = c.rim * Math.exp(-((t - 1) * (t - 1)) / 0.09); return h + (bowl + rim) * m; }); markCircle(RA, B_PLANT, c.x, c.z, c.R * 0.95); }
    L.craters = out.map((c) => [Math.round(c.x), Math.round(c.z), +c.R.toFixed(1)]); return out; }
  function craterDress(list) { for (const c of list || []) { const n = 7 + Math.floor(R() * 5); for (let i = 0; i < n; i++) { const a = i / n * 6.283 + rr(-0.25, 0.25), d = c.R * rr(1.05, 1.6); plant(i % 3 === 0 ? "rock_big" : "rock", c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, "red", { sk: i % 3 === 0 ? 0.8 : 1 }); } scatterAround(c.x, c.z, c.R * 1.3, c.R * 2.1, 5, (px, pz) => !!plant(wpick([["organ", 2], ["barrel", 3], ["cholla", 2], ["ocotillo", 1]]), px, pz, "red")); } }

  // ───────────── vignettes: small deliberate compositions ─────────────
  function scatterAround(cx, cz, r0, r1, n, fn) { let k = 0; for (let t = 0; t < n * 6 && k < n; t++) { const a = R() * 6.283, d = r0 + Math.sqrt(R()) * (r1 - r0); if (fn(cx + Math.cos(a) * d, cz + Math.sin(a) * d, a, d)) k++; } return k; }
  function vignette(type, x, z, P, o) { o = o || {}; const style = P.rock; let n = 0; const push = (e) => { if (e) n++; return e; };
    const sp = () => wpick(P.spec), ac = () => wpick(P.acc), gn = () => wpick(P.gnd);
    if (type === "grove") { push(plant(sp(), x, z, style)); scatterAround(x, z, 2.2, 6.5, 2 + Math.floor(R() * 3), (px, pz) => push(plant(ac(), px, pz, style))); scatterAround(x, z, 1.5, 8, 2 + Math.floor(R() * 3), (px, pz) => push(plant(gn(), px, pz, style, { tight: true }))); if (R() < 0.55) scatterAround(x, z, 1.5, 5, 1 + Math.floor(R() * 2), (px, pz) => push(plant("rock", px, pz, style)));
      if (R() < 0.45) scatterAround(x, z, 3, 7, 1 + Math.floor(R() * 2), (px, pz) => push(plant(R() < 0.6 ? "saguaro_young" : "barrel", px, pz, style))); }
    else if (type === "outcrop") { const yaw = R() * 6.283; push(plant("rock_big", x, z, style, { yaw })); const nb = 2 + Math.floor(R() * 3); for (let i = 0; i < nb; i++) { const a = yaw + (i - nb / 2) * 0.9 + rr(-0.3, 0.3), d = rr(1.8, 3.6); push(plant(R() < 0.5 ? "rock_big" : "rock", x + Math.cos(a) * d, z + Math.sin(a) * d, style, { yaw: yaw + rr(-0.4, 0.4), sk: 0.75 })); }
      scatterAround(x, z, 2, 5.5, 2 + Math.floor(R() * 3), (px, pz) => push(plant(R() < 0.3 ? "stones" : "rock", px, pz, style, { sk: 0.7 }))); scatterAround(x, z, 2.5, 6.5, 1 + Math.floor(R() * 3), (px, pz) => push(plant(ac(), px, pz, style))); if (R() < 0.6) scatterAround(x, z, 3, 7, 1, (px, pz) => push(plant(R() < 0.5 ? "ocotillo" : sp(), px, pz, style))); scatterAround(x, z, 2, 7, 1 + Math.floor(R() * 3), (px, pz) => push(plant(gn(), px, pz, style, { tight: true }))); }
    else if (type === "thicket") { const tk = P === PAL.ranch ? "mesquite" : R() < 0.5 ? "paloverde" : "mesquite"; push(plant(tk, x, z, style)); scatterAround(x, z, 4, 8, 1 + Math.floor(R() * 2), (px, pz) => push(plant(R() < 0.6 ? tk : "paloverde", px, pz, style))); scatterAround(x, z, 2, 9, 3 + Math.floor(R() * 4), (px, pz) => push(plant(R() < 0.6 ? gn() : ac(), px, pz, style, { tight: true }))); }
    else if (type === "bed") { const rb = rr(4.5, 7.5); if (!spotOK(x, z, rb * 0.8, {})) return vignette("grove", x, z, P, o); const bed = { x, z, r: rb, g: P.bed || "dg", seed: Math.floor(R() * 1e6) }; const off = rr(0.8, 2.0), oa = R() * 6.283; push(plant(sp(), x + Math.cos(oa) * off, z + Math.sin(oa) * off, style));
      // accents in drifts of three, ground cover, a couple of rocks; the gravel bed only if the planting really took
      const nd = 2 + Math.floor(R() * 2); for (let d = 0; d < nd; d++) { const a = oa + Math.PI + (d - nd / 2) * 1.2 + rr(-0.3, 0.3), dd = rb * rr(0.4, 0.7); const k = ac(); for (let q = 0; q < 3; q++) push(plant(k, x + Math.cos(a) * dd + rr(-1.2, 1.2), z + Math.sin(a) * dd + rr(-1.2, 1.2), style, { tight: true })); }
      scatterAround(x, z, 1, rb * 0.95, 3 + Math.floor(R() * 4), (px, pz) => push(plant(gn(), px, pz, style, { tight: true }))); scatterAround(x, z, rb * 0.4, rb * 0.9, 1 + Math.floor(R() * 2), (px, pz) => push(plant("rock", px, pz, style, { sk: 0.8 })));
      if (n >= 5) { L.beds.push(bed); markCircle(RA, B_MINE, x, z, rb); } }
    return n; }
  // level a feature pad to its centre height; never moves ground next to anything protected (the attenuation follows DP)
  function levelPad(cx, cz, Rr, edge) { const y = getH(cx, cz); planGrade(cx - Rr - edge, cx + Rr + edge, cz - Rr - edge, cz + Rr + edge, (x, z, h) => { const d = Math.hypot(x - cx, z - cz); if (d > Rr + edge) return h; let k = d < Rr ? 1 : 1 - sm(0, 1, (d - Rr) / edge); const c = cellK(x, z); if (c >= 0 && DP) k *= sm(1.5, 6, DP[c]); return h + (y - h) * k; }); }

  // ───────────── features on a short spur from the nearest walk ─────────────
  function walkRecs() { const out = []; for (const r of ROADS) { if (!r.pts || r.pts.length < 2) continue; const rd = r.plan && PLAN_IDX.road.get(r.plan); const pr = r.plan && PLAN_IDX.prom.get(r.plan); if (rd && (rd.class === "taxilane" || /asphalt/.test(rd.surface || "") || rd.class === "perimeter")) continue; if (!rd && !pr && r.w > 8) continue; if (r.landSpur) continue; out.push(r); } return out; }
  function nearestWalk(x, z, recs, maxD) { let best = null; for (const r of recs) { const p = r.pts; for (let i = 0; i < p.length - 1; i++) { const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1]; if (Math.min(ax, bx) - maxD > x || Math.max(ax, bx) + maxD < x || Math.min(az, bz) - maxD > z || Math.max(az, bz) + maxD < z) continue; const vx = bx - ax, vz = bz - az; const L2 = vx * vx + vz * vz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)); const px = ax + vx * t, pz = az + vz * t; const d = Math.hypot(x - px, z - pz) - r.w / 2; if (d < maxD && (!best || d < best.d)) best = { d, px, pz, r, ux: vx / Math.sqrt(L2), uz: vz / Math.sqrt(L2) }; } } return best; }
  function spur(x, z, padR, wk) { const dx = wk.px - x, dz = wk.pz - z, D = Math.hypot(dx, dz); if (D < padR + 2) return true; const ux = dx / D, uz = dz / D; const end = D - wk.r.w / 2 + 0.6; const sx = x + ux * (padR - 0.5), sz = z + uz * (padR - 0.5), ex = x + ux * end, ez = z + uz * end;
    for (let t = padR + 1; t < D - wk.r.w / 2 - 2.2; t += 1.5) { const px = x + ux * t, pz = z + uz * t; const b = at(RA, px, pz, B_PLANT); if (b & (B_GOLF | B_MINE)) return false; if ((b & B_PLANT) && !planNearRoad(px, pz, 2.4)) return false; if (planNearCollider(px, pz, 1.3)) return false; }
    const rec = planRibbon([[sx, sz], [ex, ez]], 2.2, { mat: planMats().dg, lift: 0.2, tile: 3 }, "land_spur_" + L.spurs.length); if (rec) rec.landSpur = true; markSeg(RA, B_PLANT | B_MINE, sx, sz, ex, ez, 1.8); L.spurs.push([Math.round(sx), Math.round(sz), Math.round(ex), Math.round(ez)]); return true; }
  function lantern(x, z, s, yaw) { if (!has("land_lantern")) return null; if (!planSpotOK(x, z, 0.3) || ownNear(x, z, 0.4)) return null; const k = cellK(x, z); if (k < 0 || inPlay(x, z, 3)) return null; put("land_lantern", x, z, yaw || 0, s || 1); const e = PLACE.land_lantern[PLACE.land_lantern.length - 1]; e.keep = true; ownAdd(x, z, 0.4); L.lights.push({ e, s: s || 1, pool: 4.5 * (s || 1) }); cnt("lanterns"); return e; }
  function feature(type, x, z, wk, P, info) { const yawW = Math.atan2(wk.px - x, wk.pz - z); const style = P.rock; const lvl = (r) => { try { levelPad(x, z, r, 6); } catch (e) { err("level", e); } };
    const tree = (sp, d, a) => plant(sp, x + Math.cos(a) * d, z + Math.sin(a) * d, style);
    if (type === "ramada") { if (!has("land_ramada")) return false; lvl(5.5); put("land_ramada", x, z, yawW + Math.PI / 2, 1); const e = PLACE.land_ramada[PLACE.land_ramada.length - 1]; e.keep = true; const c = Math.cos(yawW + Math.PI / 2), s = Math.sin(yawW + Math.PI / 2); for (const [lx, lz] of L.ramadaPosts) COLLIDERS.push([x + lx * c + lz * s, z - lx * s + lz * c, 0.22]); L.seats.push({ kind: "ramada", e });
      ownAdd(x, z, 4.2); markCircle(RA, B_MINE | B_PLANT, x, z, 4.0); L.beds.push({ x, z, r: 5.2, g: P.bed || "dg", seed: Math.floor(R() * 1e6), pad: 1 }); tree(R() < 0.5 ? "mesquite" : "paloverde", 7.5, yawW + Math.PI + 0.7); tree("paloverde", 8, yawW + Math.PI - 0.8); scatterAround(x, z, 5.5, 8.5, 5, (px, pz) => !!plant(wpick(P.acc), px, pz, style)); if (P.lit && !info.dark) lantern(x + Math.sin(yawW) * 4.4 + Math.cos(yawW) * 1.2, z + Math.cos(yawW) * 4.4 - Math.sin(yawW) * 1.2, 1, yawW); return true; }
    if (type === "benches") { if (!has("land_bench")) return false; lvl(6); const focalA = yawW + Math.PI; const fx = x + Math.sin(focalA) * 1.6, fz = z + Math.cos(focalA) * 1.6; L.beds.push({ x, z, r: 6.2, g: P.bed || "dg", seed: Math.floor(R() * 1e6), pad: 1 });
      plant(R() < 0.5 ? "saguaro_giant" : "organ", fx, fz, style, { force: true }); for (let i = 0; i < 3; i++) { const a = focalA + Math.PI + (i - 1) * 0.95; const bx = fx + Math.sin(a) * 4.2, bz = fz + Math.cos(a) * 4.2; if (!planSpotOK(bx, bz, 1.0)) continue; put("land_bench", bx, bz, Math.atan2(fx - bx, fz - bz), 1); const e = PLACE.land_bench[PLACE.land_bench.length - 1]; e.keep = true; ownAdd(bx, bz, 1.2); L.seats.push({ kind: "bench", e }); }
      ownAdd(x, z, 5); markCircle(RA, B_MINE | B_PLANT, x, z, 5.5); tree(R() < 0.5 ? "ironwood" : "paloverde", 8.5, focalA + 2.2); tree("paloverde", 8.5, focalA - 2.2); scatterAround(fx, fz, 1.3, 2.6, 4, (px, pz) => !!plant(R() < 0.5 ? "barrel" : "agave", px, pz, style, { tight: true, force: false })); if (P.lit && !info.dark) { lantern(x + Math.sin(yawW) * 5.6 + Math.cos(yawW) * 2, z + Math.cos(yawW) * 5.6 - Math.sin(yawW) * 2, 1, yawW); } return true; }
    if (type === "fire") { if (!has("land_firering")) return false; lvl(6.5); put("land_firering", x, z, R() * 6.283, 1); PLACE.land_firering[PLACE.land_firering.length - 1].keep = true; L.fires.push({ x, z }); L.beds.push({ x, z, r: 6.4, g: "dg", seed: Math.floor(R() * 1e6), pad: 1 });
      for (let i = 0; i < 4; i++) { const a = yawW + Math.PI / 4 + i * Math.PI / 2; const bx = x + Math.sin(a) * 3.6, bz = z + Math.cos(a) * 3.6; if (!planSpotOK(bx, bz, 1.0)) continue; put("land_bench", bx, bz, Math.atan2(x - bx, z - bz), 1); const e = PLACE.land_bench[PLACE.land_bench.length - 1]; e.keep = true; L.seats.push({ kind: "bench", e }); }
      ownAdd(x, z, 5.5); markCircle(RA, B_MINE | B_PLANT, x, z, 6); scatterAround(x, z, 7.5, 10, 4, (px, pz) => !!plant(R() < 0.5 ? "mesquite" : wpick(P.acc), px, pz, style)); if (!info.dark) lantern(x + Math.sin(yawW) * 6.4, z + Math.cos(yawW) * 6.4, 1, yawW); return true; }
    if (type === "sculpture") { const ks = ["sculpture", "corten", "monolith"].filter(has); if (!ks.length) return false; const k = ks[L.feats.filter((f) => f.type === "sculpture").length % ks.length]; lvl(5); put(k, x, z, yawW, rr(0.85, 1.05)); PLACE[k][PLACE[k].length - 1].keep = true; ownAdd(x, z, 3.5); markCircle(RA, B_MINE | B_PLANT, x, z, 4.5); L.beds.push({ x, z, r: 5.0, g: P.bed || "dg", seed: Math.floor(R() * 1e6), pad: 1 });
      scatterAround(x, z, 5, 8, 5, (px, pz) => !!plant(R() < 0.6 ? wpick(P.acc) : "rock", px, pz, style)); if (!info.dark) L.lights.push({ x: x + Math.sin(yawW) * 2.4, z: z + Math.cos(yawW) * 2.4, y0: 0.06, s: 0, pool: 6, up: 1 }); return true; }
    if (type === "windmill") { if (!has("windmill") || !has("land_tank")) return false; lvl(9); put("windmill", x, z, yawW + 0.4, 1); const tx = x + Math.cos(yawW) * 6.5, tz = z - Math.sin(yawW) * 6.5; put("land_tank", tx, tz, 0, 1); PLACE.land_tank[PLACE.land_tank.length - 1].keep = true; ownAdd(x, z, 9); markCircle(RA, B_MINE | B_PLANT, x, z, 9.5); scatterAround(x, z, 10, 16, 6, (px, pz) => !!plant(R() < 0.5 ? "mesquite" : "pear", px, pz, style)); return true; }
    if (type === "stagecoach") { if (!has("stagecoach")) return false; lvl(5); put("stagecoach", x, z, Math.atan2(wk.ux, wk.uz), 1); ownAdd(x, z, 4); markCircle(RA, B_MINE | B_PLANT, x, z, 4.5); tree("mesquite", 7, yawW + Math.PI); scatterAround(x, z, 5, 8, 3, (px, pz) => !!plant("pear", px, pz, style)); return true; }
    if (type === "rover") { if (!has("rover")) return false; lvl(5); put("rover", x, z, yawW + 0.8, 1); ownAdd(x, z, 3.5); markCircle(RA, B_MINE | B_PLANT, x, z, 4.5); L.beds.push({ x, z, r: 5.5, g: "red", seed: Math.floor(R() * 1e6), pad: 1 }); vignette("outcrop", x + Math.sin(yawW + Math.PI) * 7.5, z + Math.cos(yawW + Math.PI) * 7.5, P); return true; }
    return false; }

  // ───────────── the golf course ─────────────
  function postOK(x, z) { if (inPlay(x, z, 1.5) || planNearRoad(x, z, 0.6) || planNearCollider(x, z, 0.6) || ownNear(x, z, 0.6) || planPolyBlocked(x, z)) return false; for (const f of PLAN_IDX.fount.values()) if (f._r && Math.hypot(f.x - x, f.z - z) < f._r + 2.5) return false; for (const f of (typeof PLAN_FOUNTAINS !== "undefined" ? PLAN_FOUNTAINS : [])) if (Math.hypot(f.x - x, f.z - z) < 7) return false; return true; }
  function golfDress() { const G0 = L.golf; const holes = golf && golf.holes || []; if (!holes.length) return; const P = PAL.golf; let np = 0, nl = 0;
    const palm = (x, z, sk) => { const e = plant("palm", x, z, "tan", { sk: sk || 1 }); if (e) { np++; L.uplights.push([x + 0.9, z + 0.4]); } return e; };
    holes.forEach((h, i) => { const tee = h.tee, g = h.green; const fx = Math.sin(h.dir), fz = Math.cos(h.dir), rx = Math.cos(h.dir), rz = -Math.sin(h.dir);
      // palms framing the back of every tee, two lit tee lanterns behind the box
      for (const sd of [-1, 1]) palm(tee[0] - fx * 10 + rx * 7.5 * sd, tee[1] - fz * 10 + rz * 7.5 * sd, rr(0.9, 1.05));
      for (const sd of [-1, 1]) { const e = lantern(tee[0] - fx * 4.2 + rx * 2.9 * sd, tee[1] - fz * 4.2 + rz * 2.9 * sd, 0.85, h.dir + Math.PI); if (e) nl++; }
      G0.tees = (G0.tees || 0) + 1; L.golf.teeMarks = (L.golf.teeMarks || []); L.golf.teeMarks.push([tee[0], tee[1], h.dir]);
      // a palm cluster and a desert bed behind the green (away from the approach)
      const last = h.pts[h.pts.length - 2]; const ga = Math.atan2(g[0] - last[0], g[1] - last[1]); const bx = g[0] + Math.sin(ga) * (g[2] + 22), bz = g[1] + Math.cos(ga) * (g[2] + 22);
      let got = 0; for (const [da, dd] of [[0, 0], [0.5, 5.5], [-0.5, 5.5], [0.25, -4]]) { const a = ga + da; if (palm(bx + Math.sin(a + 1.57) * dd, bz + Math.cos(a + 1.57) * dd, rr(0.85, 1.1))) got++; }
      if (got) { const bed = spotOK(bx, bz, 2, {}) || got; if (bed) { L.beds.push({ x: bx, z: bz, r: 7, g: "dg", seed: i * 31 + 7 }); scatterAround(bx, bz, 2, 7, 9, (px, pz) => !!plant(R() < 0.5 ? wpick(P.acc) : wpick(P.gnd), px, pz, "tan", { tight: true })); } }
      L.golf.greens = (L.golf.greens || []); L.golf.greens.push([g[0], g[1], g[2]]);
      // the cart path from the last green: lanterns every 17 m, palms and planting on the outer side
      if (i > 0) { const pg = holes[i - 1].green; const ax = pg[0], az = pg[1], bx2 = tee[0], bz2 = tee[1]; const Lp = Math.hypot(bx2 - ax, bz2 - az); const ux = (bx2 - ax) / Lp, uz = (bz2 - az) / Lp; let side = 1, k = 0;
        for (let t = pg[2] + 6; t < Lp - 8; t += 17) { const px = ax + ux * t, pz = az + uz * t; side = -side; const lx = px - uz * 2.1 * side, lz = pz + ux * 2.1 * side; if (lantern(lx, lz, 0.9, Math.atan2(-uz * side, ux * side))) nl++; if ((k++ % 2) === 0) { const ox = px - uz * 7 * side, oz = pz + ux * 7 * side; if (palm(ox, oz, rr(0.8, 1))) { scatterAround(ox, oz, 1.5, 3.5, 3, (qx, qz) => !!plant(wpick(P.acc), qx, qz, "tan", { tight: true })); } } } } });
    holes.forEach((h, hi) => { const s0 = playStart(h), g = h.green; const Lh = Math.hypot(g[0] - s0[0], g[1] - s0[1]); const ux = (g[0] - s0[0]) / Lh, uz = (g[1] - s0[1]) / Lh; const half = (h.w || 18) / 2 + 14.5; let k = hi;
      for (let t = 2; t < Lh + 8; t += 15) for (const sd of [-1, 1]) { const off = half + rr(0.5, 4); const x = s0[0] + ux * t - uz * off * sd, z = s0[1] + uz * t + ux * off * sd; if (!spotOK(x, z, 2.2, {})) continue;
        const slot = k++ % 3; if (slot !== 2) { let got = 0; if (palm(x, z, rr(0.85, 1.05))) got++; if (slot === 0 && palm(x + ux * 4.2 - uz * 1.5 * sd, z + uz * 4.2 + ux * 1.5 * sd, rr(0.75, 0.95))) got++; if (got) { L.beds.push({ x: x + ux * 2, z: z + uz * 2, r: 5.5, g: "dg", seed: hi * 97 + k }); scatterAround(x + ux * 2, z + uz * 2, 1.5, 5.2, 7, (px, pz) => !!plant(R() < 0.55 ? wpick(P.acc) : wpick(P.gnd), px, pz, "tan", { tight: true })); } }
        else vignette(R() < 0.6 ? "bed" : "grove", x, z, P); } });
    // the clubhouse: festoon strings over the terrace in front of it, palms either side of the door, lanterns on the approach
    try { const cb = PLAN_BLD.find((q) => /golf clubhouse/i.test((q.b && q.b.name) || "")) || PLAN_BLD.find((q) => q.kind === "clubhouse" && Math.hypot(q.e[0] - 76, q.e[2] - 896) < 40); if (cb) { const e = cb.e, yaw = e[3]; const rad = MODELS[cb.kind] ? MODELS[cb.kind].radius * e[4] : 18; const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw); const d0 = (MODELS[cb.kind] ? MODELS[cb.kind].sz / 2 * e[4] : rad * 0.6) + 3.5;
        const posts = []; for (const [d, l] of [[d0, -11], [d0, 0], [d0, 11], [d0 + 12, -11], [d0 + 12, 0], [d0 + 12, 11]]) { let x = e[0] + fx * d + rx * l, z = e[2] + fz * d + rz * l; let ok = null; for (const nudge of [0, 1.5, -1.5, 3, -3]) { const qx = x + rx * nudge, qz = z + rz * nudge; if (postOK(qx, qz)) { ok = [qx, qz]; break; } } if (ok) { put("land_fpost", ok[0], ok[1], yaw, 1); const pe = PLACE.land_fpost[PLACE.land_fpost.length - 1]; pe.keep = true; ownAdd(ok[0], ok[1], 0.6); posts.push(pe); } else posts.push(null); }
        const pairs = [[0, 3], [1, 4], [2, 5], [0, 4], [1, 3], [1, 5], [2, 4], [0, 1], [1, 2], [3, 4], [4, 5]]; for (const [a, b] of pairs) if (posts[a] && posts[b]) L.festoons.push([posts[a], posts[b]]);
        for (const sd of [-1, 1]) palm(e[0] + fx * (d0 - 1) + rx * (rad * 0.62 + 3) * sd, e[2] + fz * (d0 - 1) + rz * (rad * 0.62 + 3) * sd, 1.05);
        L.golf.clubhouse = [Math.round(e[0]), Math.round(e[2]), +yaw.toFixed(2)]; L.golf.posts = posts.filter(Boolean).length; } } catch (e) { err("clubhouse", e); }
    G0.palms = np; G0.lanterns = nl; }

  // ───────────── the bare stretches ─────────────
  function fillBare() { const t0 = performance.now(); DC = distField((k) => COV[k] !== 0 || (RA[k] & B_MINE) !== 0); const recs = walkRecs();
    // bare = plantable land, 13 m or more from anything that stands up
    const bare = []; for (let j = 1; j < G.nz; j += 2) for (let i = 1; i < G.nx; i += 2) { const k = j * G.nx + i; if (ZN[k] !== 1 || (RA[k] & (B_PLANT | B_GOLF | B_MINE))) continue; const x = G.X0 + (i + 0.5) * G.C, z = G.Z0 + (j + 0.5) * G.C; const fo = focusAt(x, z); if (DC[k] < (fo ? fo.bare : 13)) continue; if (distToRunway(x, z) < 132) continue; bare.push([k, x, z, DC[k]]); }
    L.n.bareCells = bare.length; L.n.bareArea = Math.round(bare.length * 25);
    // 0. where a district wants more buildings: the clusters take the widest stretches first
    try { infill(bare, recs); } catch (e) { err("infill", e); }
    // 1. features in the biggest stretches, near a walk, 150 m apart, at most two per district
    const byD = new Map(); const feats = L.feats; const cand = bare.filter((b) => b[3] >= 17).map((b) => [b, b[3] + R() * 6]).sort((a, b) => b[1] - a[1]);
    for (const [[k, x, z]] of cand) { if (feats.length >= 26) break; if (feats.some((f) => Math.hypot(f.x - x, f.z - z) < 150)) continue; if (RA[k] & (B_MINE | B_PLANT)) continue; const info = palAt(x, z); if (!info.id || info.nofeat) continue; const nd = byD.get(info.id) || 0; if (nd >= 2) continue;
      if (DB[k] < 30) continue; const wk = nearestWalk(x, z, recs, 42); if (!wk || wk.d < 9) continue; const P = info.p; const order = P.feats.slice().sort(() => R() - 0.5); const used = feats.filter((f) => f.d === info.id).map((f) => f.type);
      for (const ty of order) { if (used.includes(ty)) continue; if ((ty === "windmill" || ty === "stagecoach") && feats.some((f) => f.type === ty)) continue; if (ty === "fire" && feats.filter((f) => f.type === "fire").length >= 3) continue; if (ty === "stagecoach" && !has("stagecoach")) continue;
        const padR = ty === "windmill" ? 9 : ty === "fire" ? 6.4 : 5.5; if (!spotOK(x, z, padR, {})) break; if (!spur(x, z, padR, wk)) break;
        if (feature(ty, x, z, wk, P, info)) { feats.push({ type: ty, x: Math.round(x), z: Math.round(z), d: info.id }); byD.set(info.id, nd + 1); cnt("feat_" + ty); } break; } }
    // 1b. the crater rims, and garden beds along the wide paths of the two stretches the user showed
    try { craterDress(L.cr); } catch (e) { err("craters dress", e); } for (const f of FOCUS) { try { flankGardens(f); } catch (e) { err("flank " + f.id, e); } }
    // 2. vignettes: Poisson-spaced anchors over every bare cell, the mix by district and by the ground (rocks on the crests)
    const order = bare.slice(); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    const anchors = []; const AG = new Map(); const ak = (x, z) => Math.floor(x / 40) * 100003 + Math.floor(z / 40);
    for (const [k, x, z, dc] of order) { if (RA[k] & B_MINE) continue; const info = palAt(x, z); const P = info.p; const fo = focusAt(x, z); const sp = P.space * 1.12 * rr(0.85, 1.15) * (fo ? fo.space : 1); let near = false; for (let di = -1; di <= 1 && !near; di++) for (let dj = -1; dj <= 1 && !near; dj++) { const a = AG.get((Math.floor(x / 40) + di) * 100003 + Math.floor(z / 40) + dj); if (a) for (const q of a) if (Math.hypot(q[0] - x, q[1] - z) < Math.min(sp, q[2])) { near = true; break; } } if (near) continue;
      const ha = hillAt(x, z); let type = wpick(P.mix); if (ha > 2.5 && R() < 0.65) type = "outcrop"; else if (ha > 0.9 && type === "bed" && R() < 0.6) type = "grove"; if (type === "bed" && !P.bed) type = "grove";
      const n = vignette(type, x, z, P); if (n > 0) { anchors.push([x, z]); const key = ak(x, z); let a = AG.get(key); if (!a) AG.set(key, a = []); a.push([x, z, sp]); L.vign.push([Math.round(x), Math.round(z), type[0]]); cnt("v_" + type); } }
    L.n.vignettes = anchors.length; L.t.fill = Math.round(performance.now() - t0); }

  // district infill: the Outpost gets homestead domes round a red gravel court with a parked rover, The Commons glamping
  // tents and a dome round a fire ring; units on an arc, doors to the court, the open side to the walk, every pad levelled
  const INFILL = { S3_OUTPOST: { kinds: ["dome", "dome", "dome"], max: 2, centre: "rover", t: "Outpost Homesteads", p: "Homestead domes round a red gravel court on the edge of The Outpost, a rover parked at the centre. Homes for anyone who wants to stay out here." },
    S3_COMMONS: { kinds: ["glamp", "dome", "glamp"], max: 2, centre: "fire", dc: 16, walkMin: 13, ring: 15.5, step: 1.1, t: "Glamping Court", p: "Glamping tents and a dome round a shared fire ring, a short walk from The Commons." } };
  function infill(bare, recs) { const out = L.infill = []; const done = {}, tries = {}; const why = L.infillWhy = {}; const no = (d, r) => { const q = why[d] || (why[d] = {}); q[r] = (q[r] || 0) + 1; };
    const marks = []; for (const q of PLAN.places || []) if (q.type === "landmark" || q.type === "plaza") marks.push([q.x, q.z, (q.r || 10) + (q.type === "landmark" ? 34 : 18)]);
    const lines = []; for (const id of ["hl4_sculpture_ave"]) { const pr = PLAN_IDX.prom.get(id); if (pr && pr.pts) lines.push(pr.pts); }
    const clearOf = (x, z, pad) => { for (const m of marks) if (Math.hypot(x - m[0], z - m[1]) < m[2] + pad) return false; for (const pts of lines) for (let i = 0; i < pts.length - 1; i++) if (segD(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < 40 + pad) return false; return true; };
    const cand = bare.filter((b) => b[3] >= 16).map((b) => [b, b[3] + R() * 5]).sort((a, b) => b[1] - a[1]);
    for (const [[k, x, z, dc]] of cand) { const info = palAt(x, z); const W = INFILL[info.id]; if (!W || (done[info.id] || 0) >= W.max) continue; if (dc < (W.dc || 22)) { no(info.id, "small"); continue; } if (RA[k] & (B_MINE | B_PLANT | B_GOLF)) continue; if (DB[k] < 40 || distToRunway(x, z) < 230) { no(info.id, "edge"); continue; }
      if (out.some((c) => Math.hypot(c.x - x, c.z - z) < 140) || L.feats.some((f) => Math.hypot(f.x - x, f.z - z) < 60)) { no(info.id, "near"); continue; } { let lo = 1e9, hi = -1e9; for (let q = 0; q < 10; q++) { const qa = q / 10 * 6.283; const hh = getH(x + Math.cos(qa) * 9, z + Math.sin(qa) * 9); lo = Math.min(lo, hh); hi = Math.max(hi, hh); } if (hi - lo > 1.1) { no(info.id, "hill"); continue; } } if (!clearOf(x, z, 0)) { no(info.id, "landmark"); continue; }
      if ((tries[info.id] = (tries[info.id] || 0) + 1) > 140) continue; const wk = nearestWalk(x, z, recs, 56); if (!wk || wk.d < (W.walkMin || 20)) { no(info.id, "walk"); continue; } const toW = Math.atan2(wk.px - x, wk.pz - z); const ring = W.ring || 16.5; const units = [];
      let ok = true; for (let i = 0; i < W.kinds.length && ok; i++) { const kind = W.kinds[i]; const m = MODELS[kind]; if (!m) { ok = false; break; } const a = toW + Math.PI + (i - (W.kinds.length - 1) / 2) * (W.step || 1.02); const ux = x + Math.sin(a) * ring, uz = z + Math.cos(a) * ring; const kk = cellK(ux, uz); const rad = m.radius;
        if (kk < 0 || ZN[kk] !== 1 || (RA[kk] & (B_PLANT | B_GOLF | B_MINE)) || DC[kk] < rad + 3 || DP[kk] < rad + 4 || !planSpotOK(ux, uz, rad + 1) || !clearOf(ux, uz, rad)) { ok = false; no(info.id, "unit"); break; }
        let lo = 1e9, hi = -1e9; for (let q = 0; q < 8; q++) { const qa = q / 8 * 6.283; const hh = getH(ux + Math.cos(qa) * rad, uz + Math.sin(qa) * rad); lo = Math.min(lo, hh); hi = Math.max(hi, hh); } if (hi - lo > 1.3) { ok = false; no(info.id, "slope"); break; } units.push([kind, ux, uz, rad]); }
      if (!ok) continue; if (!spur(x, z, 9.5, wk)) continue;
      for (const [kind, ux, uz, rad] of units) { try { levelPad(ux, uz, rad + 1.2, 7); } catch (e) { err("infill level", e); } const yaw = Math.atan2(x - ux, z - uz); put(kind, ux, uz, yaw, 1); const e = PLACE[kind][PLACE[kind].length - 1]; e.landInfill = 1; KEEPOUT.push([ux + Math.sin(yaw) * (rad + 2.2), uz + Math.cos(yaw) * (rad + 2.2), 3.2]);
        markCircle(RA, B_MINE | B_PLANT, ux, uz, rad + 1.5); markCircle(COV, 1, ux, uz, rad); ownAdd(ux, uz, rad + 1.2); markSeg(RA, B_PLANT, ux, uz, x, z, 2.2);
        const back = yaw + Math.PI; plant(R() < 0.5 ? "paloverde" : "mesquite", ux + Math.sin(back + 0.7) * (rad + 3.2), uz + Math.cos(back + 0.7) * (rad + 3.2), info.p.rock); scatterAround(ux, uz, rad + 1.8, rad + 6, 8, (px, pz) => !!plant(R() < 0.55 ? wpick(info.p.acc) : wpick(info.p.gnd), px, pz, info.p.rock, { tight: true })); if (R() < 0.7) plant(wpick(info.p.spec), ux + Math.sin(back - 0.8) * (rad + 3.5), uz + Math.cos(back - 0.8) * (rad + 3.5), info.p.rock); cnt("infill_" + kind); }
      { const ux2 = Math.sin(toW), uz2 = Math.cos(toW); for (const sd of [-1, 1]) { const bx = x + ux2 * 12.5 + uz2 * 4.8 * sd, bz = z + uz2 * 12.5 - ux2 * 4.8 * sd; if (spotOK(bx, bz, 2.2, {})) miniBed(bx, bz, info.p, 0); } }
      L.beds.push({ x, z, r: 9.2, g: info.p.bed || "dg", seed: Math.floor(R() * 1e6), pad: 1 }); feature(W.centre, x, z, wk, info.p, info); markCircle(RA, B_MINE, x, z, ring + 3.5);
      hotspots.push({ x, z, r: 10, t: W.t, k: "Stage Three · the land between", p: W.p }); out.push({ x: Math.round(x), z: Math.round(z), d: info.id, units: units.map((u) => [u[0], Math.round(u[1]), Math.round(u[2])]) }); done[info.id] = (done[info.id] || 0) + 1; cnt("infill"); } }
  // garden beds either side of the wide paths (from 4.5 m off the edge: the path edge itself is the allee and lamp line)
  function flankGardens(f) { let n = 0; const recs = ROADS.filter((r) => r.pts && r.w >= 5.5 && !r.landSpur && r.pts.some((q) => Math.hypot(q[0] - f.x, q[1] - f.z) < f.r + 80));
    for (const r of recs) { const off = r.w / 2 + 4.6; let i = 0; planAlong(r.pts, r.w >= 10 ? 12 : 15, 6, (x, z, ux, uz) => { if (Math.hypot(x - f.x, z - f.z) > f.r) return; for (const sd of [-1, 1]) { const bx = x - uz * off * sd + rr(-0.8, 0.8), bz = z + ux * off * sd + rr(-0.8, 0.8); if (!spotOK(bx, bz, 2.4, {}) || ownNear(bx, bz, 3.2)) continue; const info = palAt(bx, bz); if (miniBed(bx, bz, info.p, i++)) n++; } }); }
    L.n["flank_" + f.id] = n; }
  function miniBed(x, z, P, i) { const rb = rr(2.8, 4.0); const bed = { x, z, r: rb, g: P.bed || "dg", seed: Math.floor(R() * 1e6) }; let m = 0; const st = P.rock;
    if (i % 2 === 0 && plant(wpick(P.spec), x + rr(-0.6, 0.6), z + rr(-0.6, 0.6), st)) m++; const k1 = wpick(P.acc), k2 = wpick(P.acc);
    for (let q = 0; q < 3; q++) { const a = R() * 6.283, d = rr(0.8, rb * 0.75); if (plant(q < 2 ? k1 : k2, x + Math.cos(a) * d, z + Math.sin(a) * d, st, { tight: true })) m++; }
    scatterAround(x, z, 0.8, rb * 0.95, 4, (px, pz) => { const e = plant(wpick(P.gnd), px, pz, st, { tight: true }); if (e) m++; return !!e; }); if (R() < 0.7 && plant("rock", x + rr(-rb, rb) * 0.6, z + rr(-rb, rb) * 0.6, st, { sk: 0.75 })) m++;
    if (m >= 3) { L.beds.push(bed); markCircle(RA, B_MINE, x, z, rb); return true; } return false; }
  // ───────────── more cactus variety everywhere (stands in the open desert of our land, washes included) ─────────────
  function cactusStands() { const t0 = performance.now(); let n = 0; const W = G.X1 - G.X0, D = G.Z1 - G.Z0; const target = 300;
    for (let t = 0; t < target * 30 && n < target; t++) { const x = G.X0 + R() * W, z = G.Z0 + R() * D; const k = cellK(x, z); if (k < 0) continue; const zn = ZN[k]; if (zn !== 1 && zn !== 2) continue; if (RA[k] & (B_PLANT | B_GOLF | B_MINE)) continue; if (zn === 2 && R() < 0.6) continue; if (DC && DC[k] < 5) continue;
      const info = palAt(x, z); const P = info.p; const style = P.rock; let got = 0; const main = wpick([["saguaro_giant", 1.2], ["saguaro_mid", 2], ["saguaro_young", 2], ["organ", info.name === "outpost" ? 2 : 0.5], ["ocotillo", 1.2]]);
      if (plant(main, x, z, style, { anyZone: zn === 2 })) got++; const m = 1 + Math.floor(R() * 4); for (let q = 0; q < m; q++) { const a = R() * 6.283, d = rr(2, 6); if (plant(wpick([["saguaro_young", 2], ["barrel", 3], ["pear", 2], ["cholla", 1.5], ["agave", 1], ["yucca", 0.8], ["succulent", 1]]), x + Math.cos(a) * d, z + Math.sin(a) * d, style, { anyZone: zn === 2 })) got++; }
      if (got) n++; }
    L.n.stands = n; L.t.stands = Math.round(performance.now() - t0); }
  // when the new saguaro kinds exist, the existing saguaros are re-homed onto them by size (variety everywhere, same spots)
  function rehomeSaguaros() { const list = PLACE.saguaro; if (!list || !list.length) return; const hasY = has("saguaro_young"), hasM = has("saguaro_mid"), hasG = has("saguaro_giant"); if (!hasY && !hasM && !hasG) return; let n = 0; const keep = [];
    for (const e of list) { if (e.keep) { keep.push(e); continue; } const s = e[4]; let k = null, ns = 1; if (s < 0.8 && hasY) { k = "saguaro_young"; ns = 0.8 + (s - 0.6) * 1.5; } else if (s > 1.25 && hasG) { k = "saguaro_giant"; ns = 0.85 + (s - 1.25) * 0.8; } else if (hasM && R() < 0.6) { k = "saguaro_mid"; ns = 0.8 + (s - 0.8) * 0.7; } if (!k) { keep.push(e); continue; } (PLACE[k] || (PLACE[k] = [])).push([e[0], e[1], e[2], e[3], Math.max(0.6, ns)]); n++; }
    PLACE.saguaro = keep; L.n.rehomed = n; }
  // the old scattered boulders (the grey low-poly lumps) move onto the realistic rocks: the Poly Haven boulders as soon as
  // they are installed, the weathered procedural boulders until then; same spots, same footprint, still solid
  function rehomeBoulders() { const list = PLACE.boulder, mb = MODELS.boulder; if (!list || !list.length || !mb) return; let n = 0; const keep = [];
    for (const e of list) { if (e.keep && !e.land) { keep.push(e); continue; } const zn = planZone(e[0], e[2]); const red = (() => { const d = planDistrictAt(e[0], e[2]); return d && DARK.has(d.id); })(); const q = species("rock_big", red ? "red" : zn === "wash" ? "tan" : "tan"); if (!q || !has(q[0])) { keep.push(e); continue; }
      const m = MODELS[q[0]]; const s2 = Math.max(0.3, e[4] * mb.radius / Math.max(0.3, m.radius)); const ne = [e[0], e[1], e[2], e[3], s2]; ne.land = 1; ne.keep = e.keep; (PLACE[q[0]] || (PLACE[q[0]] = [])).push(ne); n++; }
    PLACE.boulder = keep; L.n.boulders = n; }
  // one rock family across the land: when the engine's natural rock groups exist (XR, the Poly Haven scans or their stand-ins,
  // made while the desert is planted), my placeholder rocks move onto the same kinds (same spots and footprints; fewer draws)
  function rehomeRocks() { let K = null; try { K = XR && XR.kinds; } catch (e) { K = null; } if (!K || !K.B || !K.R || !K.MR) return; let n = 0;
    const map = { land_rockL0: K.B, land_rockL1: K.B, land_rock0: K.R, land_rock1: K.R, land_rrockL: K.MR, land_rrock0: K.MR };
    for (const k in map) { const list = PLACE[k], m0 = MODELS[k]; if (!list || !list.length || !m0) continue; const ks = map[k].filter((q) => MODELS[q] && MODEL_SPECS[q]); if (!ks.length) continue;
      for (const e of list) { const k2 = ks[Math.floor(R() * ks.length)]; const m2 = MODELS[k2]; const ne = [e[0], e[1], e[2], e[3], Math.max(0.15, e[4] * m0.radius / Math.max(0.2, m2.radius))]; for (const f of ["land", "keep", "col", "sy"]) if (e[f] !== undefined) ne[f] = e[f]; (PLACE[k2] || (PLACE[k2] = [])).push(ne); n++; }
      PLACE[k] = []; }
    L.n.rocksRehomed = n; }
  // cheaper far LODs for the dense desert props whose installed LOD is as heavy as the full model (saguaro, ocotillo,
  // agave and yucca clusters): the same vertex clustering as the far building tier, applied from 120 m (60 m for the low ones)
  function propLods() { const out = {}; if (typeof planFarGeo !== "function") return out; for (const k of ["saguaro", "ocotillo", "agave_cluster", "yucca_cluster"]) { const m = MODELS[k]; if (!m || !m.parts || !m.parts.length) continue; try { let full = 0; for (const p of m.parts) full += (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3; const src = m.parts.map((p) => p.geometry); const cell = m.height < 3.5 ? Math.max(0.16, m.height / 8) : Math.max(0.12, Math.min(0.5, m.height / 24)); const geos = src.map((g) => planFarGeo(g, cell)); if (geos.some((g) => !g)) continue; let lt = 0; for (const g of geos) lt += (g.index ? g.index.count : g.attributes.position.count) / 3; if (lt > full * 0.7) continue; m.lodGeos = geos; out[k] = [Math.round(full), Math.round(lt)]; } catch (e) { err("lod " + k, e); } } return out; }

  // ───────────── the hooks ─────────────
  function worldHook() { if (!window.PLAN_MODE && !window.PLAN) return; try { L.H0 = Float32Array.from(H); } catch (e) { err("snapshot", e); }
    // queue the main pass after every other module's terrain hook (the park knoll, the Outpost mound, the ramps)
    HK.terrain.push({ name: "land:terrain", fn: terrainHook });
    try { if (typeof planVegetation === "function" && !planVegetation.__land) { const orig = planVegetation; planVegetation = function () { const r = orig.apply(this, arguments); try { rehomeSaguaros(); } catch (e) { err("rehome", e); } try { rehomeRocks(); } catch (e) { err("rehome rocks", e); } return r; }; planVegetation.__land = true; } } catch (e) { err("wrap", e); } }
  function terrainHook() { const t0 = performance.now(); R = mulberry(20260925);
    try { defKinds(); } catch (e) { err("kinds", e); }
    try { buildRasters(); } catch (e) { err("rasters", e); return; }
    try { makeHills(); } catch (e) { err("hills", e); }
    try { L.cr = makeCraters(); } catch (e) { err("craters", e); }
    try { golfDress(); } catch (e) { err("golf", e); }
    try { fillBare(); } catch (e) { err("fill", e); }
    try { cactusStands(); } catch (e) { err("stands", e); }
    try { rehomeBoulders(); } catch (e) { err("boulders", e); }
    try { L.lods = propLods(); } catch (e) { err("lods", e); }
    try { for (const k of ["land_lantern", "land_bench", "land_fpost", "land_ramada", "land_firering", "land_tank"]) for (const e of PLACE[k] || []) { e[1] = getH(e[0], e[2]); e.seated = true; } } catch (e) { err("seat", e); }
    L.t.terrain = Math.round(performance.now() - t0); console.log("plan_land: " + (L.n.hills || 0) + " hills, " + (L.n.vignettes || 0) + " vignettes, " + L.feats.length + " features, " + (L.n.plants || 0) + " plants, " + (L.n.lanterns || 0) + " lanterns in " + L.t.terrain + " ms"); }

  // ───────────── defer: meshes at the final heights ─────────────
  function canvasTex(size, fn) { const c = document.createElement("canvas"); c.width = c.height = size; fn(c.getContext("2d"), size); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
  function glowTex() { return canvasTex(128, (x, S) => { const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); g.addColorStop(0, "rgba(255,226,170,0.95)"); g.addColorStop(0.18, "rgba(255,196,120,0.45)"); g.addColorStop(0.5, "rgba(255,170,90,0.10)"); g.addColorStop(1, "rgba(255,160,80,0)"); x.fillStyle = g; x.fillRect(0, 0, S, S); }); }
  // gravel beds: draped discs with a ragged, soft edge (vertex alpha), one merged mesh per gravel
  function buildBeds() { const by = {}; for (const b of L.beds) (by[b.g] || (by[b.g] = [])).push(b); const out = [];
    const tint = { dg: 0xc4a883, red: 0xa8664a, dark: 0x6f5a46 };
    for (const g in by) { const pos = [], uv = [], col = [], idx = []; for (const b of by[g]) { const rings = 5, segs = 22; const base = pos.length / 3; const s = b.seed;
        for (let r = 0; r <= rings; r++) for (let q = 0; q < segs; q++) { const a = q / segs * 6.283; const edge = b.pad ? 1 + 0.07 * Math.sin(a * 3 + s) : 1 + 0.2 * Math.sin(a * 2 + s) + 0.12 * Math.sin(a * 5 + s * 1.7) + 0.08 * (vn2(Math.cos(a) * 2 + s, Math.sin(a) * 2, 3) - 0.5); const rad = b.r * edge * (r / rings); const x = b.x + Math.cos(a) * rad, z = b.z + Math.sin(a) * rad;
          const y = Math.max(getH(x, z), (walkAt(x, z) || -1e9)) + 0.045 + (r / rings) * 0.01; pos.push(x, y, z); uv.push(x / 3.2, z / 3.2); const al = r < rings - 1 ? 1 : r === rings - 1 ? 0.55 : 0; col.push(1, 1, 1, al); }
        for (let r = 0; r < rings; r++) for (let q = 0; q < segs; q++) { const a = base + r * segs + q, b2 = base + r * segs + (q + 1) % segs, c = base + (r + 1) * segs + q, d = base + (r + 1) * segs + (q + 1) % segs; idx.push(a, b2, c, b2, d, c); } }
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 4)); geo.setIndex(idx); geo.computeVertexNormals();
      const tex = TEX.terrazzo; const mat = new THREE.MeshStandardMaterial({ map: tex, normalMap: TEX.detailN || null, color: tint[g] || tint.dg, roughness: 1, transparent: true, vertexColors: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 1; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.userData.noCull = true; mesh.userData.landSkip = true; mesh.name = "land_beds_" + g; scene.add(mesh); out.push(mesh); }
    L.bedMeshes = out; L.n.beds = L.beds.length; }
  // lantern glow (additive points at every lantern head) and warm light pools on the ground, both at night only
  function buildLights() { const heads = [], pools = []; for (const l of L.lights) { if (l.e) { const e = l.e; heads.push(e[0], e[1] + L.lanternHead * l.s, e[2]); pools.push([e[0], e[2], l.pool]); } else { pools.push([l.x, l.z, l.pool]); } }
    for (const t of L.golf.teeMarks || []) { const [x, z, dir] = t; for (const sd of [-1, 1]) { const px = x + Math.cos(dir) * sd * 1.6, pz = z - Math.sin(dir) * sd * 1.6; heads.push(px, getH(x, z) + 1.07, pz); } pools.push([x, z, 5.5]); }
    for (const g of L.golf.greens || []) pools.push([g[0], g[1], g[2] + 3, 0.5]);
    for (const [x, z] of L.uplights) { heads.push(x, getH(x, z) + 0.22, z); pools.push([x - 0.6, z - 0.2, 3.6]); }
    if (heads.length) { const hg = new THREE.BufferGeometry(); hg.setAttribute("position", new THREE.Float32BufferAttribute(heads, 3)); const pm = new THREE.PointsMaterial({ map: glowTex(), size: 1.9, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }); const pts = new THREE.Points(hg, pm); pts.frustumCulled = false; pts.userData.noCull = true; pts.userData.landSkip = true; scene.add(pts); L.halo = pts;
      // the tee marker caps glow too
      const n = (L.golf.teeMarks || []).length * 2; if (n) { const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 10, 8), MATS.glass, n); const mt = new THREE.Matrix4(); let k = 0; for (const t of L.golf.teeMarks) { const [x, z, dir] = t; for (const sd of [-1, 1]) { mt.makeTranslation(x + Math.cos(dir) * sd * 1.6, getH(x, z) + 1.06, z - Math.sin(dir) * sd * 1.6); im.setMatrixAt(k++, mt); } } im.count = k; im.userData.landSkip = true; scene.add(im); } }
    if (pools.length) { const pos = [], uv = [], idx = []; for (const [x0, z0, r0] of pools) { const base = pos.length / 3; const rings = 4, segs = 16; pos.push(x0, getH(x0, z0) + 0.09, z0); uv.push(0.5, 0.5); for (let r = 1; r <= rings; r++) for (let q = 0; q < segs; q++) { const a = q / segs * 6.283, rad = r0 * r / rings; const x = x0 + Math.cos(a) * rad, z = z0 + Math.sin(a) * rad; pos.push(x, Math.max(getH(x, z), walkAt(x, z) || -1e9) + 0.09, z); uv.push(0.5 + Math.cos(a) * 0.5 * r / rings, 0.5 + Math.sin(a) * 0.5 * r / rings); }
        for (let q = 0; q < segs; q++) idx.push(base, base + 1 + (q + 1) % segs, base + 1 + q); for (let r = 1; r < rings; r++) for (let q = 0; q < segs; q++) { const a = base + 1 + (r - 1) * segs + q, b = base + 1 + (r - 1) * segs + (q + 1) % segs, c = base + 1 + r * segs + q, d = base + 1 + r * segs + (q + 1) % segs; idx.push(a, b, c, b, d, c); } }
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); const mat = new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }); const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 3; mesh.frustumCulled = false; mesh.userData.noCull = true; mesh.userData.landSkip = true; scene.add(mesh); L.pools = mesh; }
    L.n.halos = heads.length / 3; L.n.pools = pools.length; }
  // festoon strings between the clubhouse posts: a dark catenary wire, warm bulbs clipped under it
  function buildFestoons() { if (!L.festoons.length) return; const wire = [], bulbs = []; for (const [a, b] of L.festoons) { const ya = a[1] + L.fpostTop * a[4], yb = b[1] + L.fpostTop * b[4]; const Lx = Math.hypot(b[0] - a[0], b[2] - a[2]); const sag = Math.min(1.1, 0.35 + Lx * 0.03); const n = Math.max(8, Math.round(Lx / 0.9)); let prev = null;
      for (let k = 0; k <= n; k++) { const t = k / n; const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, y = ya + (yb - ya) * t - Math.sin(t * Math.PI) * sag; if (prev) wire.push(prev[0], prev[1], prev[2], x, y, z); prev = [x, y, z]; if (k > 0 && k < n) bulbs.push(x, y - 0.1, z); } }
    const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(wire, 3)); const wl = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1c1712 })); wl.userData.noInst = true; wl.userData.landSkip = true; scene.add(wl);
    const bm = new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffc070, emissiveIntensity: 0, roughness: 0.4 }); MATS.bulb = bm; const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.085, 8, 6), bm, bulbs.length / 3); const mt = new THREE.Matrix4(); for (let i = 0; i < bulbs.length / 3; i++) { mt.makeTranslation(bulbs[i * 3], bulbs[i * 3 + 1], bulbs[i * 3 + 2]); im.setMatrixAt(i, mt); } im.userData.landSkip = true; scene.add(im);
    const hg = new THREE.BufferGeometry(); hg.setAttribute("position", new THREE.Float32BufferAttribute(bulbs, 3)); const pts = new THREE.Points(hg, new THREE.PointsMaterial({ map: glowTex(), size: 0.9, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); pts.frustumCulled = false; pts.userData.landSkip = true; scene.add(pts); L.festHalo = pts; L.n.festoonBulbs = bulbs.length / 3; }
  // fire rings: a flickering flame billboard and a warm light (pooled by the engine: never more lights drawn than today)
  function buildFires() { if (!L.fires.length) return; const ft = canvasTex(128, (x, S) => { const g = x.createRadialGradient(S / 2, S * 0.72, 2, S / 2, S * 0.6, S * 0.45); g.addColorStop(0, "rgba(255,240,190,1)"); g.addColorStop(0.3, "rgba(255,170,60,0.85)"); g.addColorStop(0.7, "rgba(230,80,20,0.3)"); g.addColorStop(1, "rgba(200,50,10,0)"); x.fillStyle = g; x.beginPath(); x.moveTo(S * 0.18, S); x.quadraticCurveTo(S * 0.22, S * 0.35, S * 0.5, S * 0.02); x.quadraticCurveTo(S * 0.78, S * 0.35, S * 0.82, S); x.fill(); });
    L.fireObjs = []; for (const f of L.fires) { const y = getH(f.x, f.z); const g = new THREE.Group(); g.position.set(f.x, y, f.z); g.userData.noCull = true; g.userData.landSkip = true; const mat = new THREE.MeshBasicMaterial({ map: ft, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }); for (let i = 0; i < 2; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.3), mat); m.position.y = 0.72; m.rotation.y = i * Math.PI / 2; g.add(m); }
      const l = new THREE.PointLight(0xff9a4a, 0, 14, 1.8); l.position.set(0, 1.1, 0); g.add(l); scene.add(g); L.fireObjs.push({ g, mat, l, x: f.x, z: f.z }); } }
  // seats: benches and the ramada benches are real seats (E on them), table and pedestals are solid
  function buildSeats() { let n = 0; for (const s of L.seats) { const e = s.e; const x = e[0], y = e[1], z = e[2], ry = e[3];
      if (s.kind === "bench") { const sd = addSolid(x, z, ry, 1.8, 0.46, y, y + 0.46, "world"); if (sd) { sd.seat = true; sd.face = ry; n++; } addSolid(x - Math.sin(ry) * 0.26, z - Math.cos(ry) * 0.26, ry, 1.8, 0.1, y + 0.46, y + 1.0, "world"); }
      else if (s.kind === "ramada") { const c = Math.cos(ry), sn = Math.sin(ry); const W = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c]; const t = W(0, 0); addSolid(t[0], t[1], ry, 2.2, 0.86, y, y + 0.8, "world"); for (const lz of [-0.78, 0.78]) { const p = W(0, lz); const sd = addSolid(p[0], p[1], ry, 2.1, 0.32, y, y + 0.49, "world"); if (sd) { sd.seat = true; sd.face = lz < 0 ? ry : ry + Math.PI; n++; } } } }
    L.n.seats = n; }
  function rockSolids() { let n = 0; for (const k in PLACE) { if (!ROCKK.test(k)) continue; const m = MODELS[k]; if (!m || (MODEL_SPECS[k] && MODEL_SPECS[k].box)) continue; for (const e of PLACE[k]) { if (!e.land || e.col) continue; const h = m.height * e[4] * (e.sy || 1); if (h < 0.55) continue; const sd = addSolid(e[0], e[2], e[3], m.sx * e[4] * 0.78, m.sz * e[4] * 0.78, e[1] - 0.3, e[1] + h * 0.92, "world"); if (sd) { e.sol = sd; n++; } } } L.n.rockSolids = n; }
  function hotspotsFor() { for (const f of L.feats) { let t = null, p = null; if (f.type === "ramada") { t = "Desert Ramada"; p = "A mesquite ramada with a latilla roof and a picnic table: shade, a seat and a view of the desert garden around it."; } else if (f.type === "benches") { t = "Bench Grove"; p = "Benches under palo verde shade, set round a specimen cactus. Sit a while."; } else if (f.type === "fire") { t = "Fire Ring"; p = "A fieldstone fire ring with benches round it, lit every evening."; } else if (f.type === "windmill") { t = "Range Windmill"; p = "A working windmill and stock tank, the way every ranch on this land once drew its water."; } else if (f.type === "rover") { t = "Rover Stop"; p = "A parked Outpost rover on a red gravel pad, among the rocks of the off-world frontier."; }
      if (t) hotspots.push({ x: f.x, z: f.z, r: 7, t, k: (planStageOf(planDistrictAt(f.x, f.z)) === "S1" ? "Stage One" : planStageOf(planDistrictAt(f.x, f.z)) === "S2" ? "Stage Two" : "Stage Three") + " · the land between", p }); } }
  const RANGE = { land_barrel: 115, land_pear: 135, land_cholla0: 150, land_cholla1: 150, ph_shrub_1: 130, ph_shrub_2: 110, ph_shrub_3: 140, ph_succulent_1: 90, ph_succulent_2: 140, land_bench: 170, land_lantern: 220 };
  // where the near tier hands over to the far one (the engine uses 60 m under 3.5 m and 120 m above): the placeholders and the
  // two heavy cluster models switch sooner (their far tiers are the clustered versions, indistinguishable at that size)
  const LODR = { land_organ: 45, land_pear: 30, land_sagy0: 40, land_sagy1: 50, land_cholla0: 28, land_cholla1: 28, land_barrel: 26, land_rockL0: 45, land_rockL1: 45, land_rrockL: 45, agave_cluster: 45, yucca_cluster: 50, ph_shrub_1: 32, ph_shrub_2: 28, ph_shrub_3: 34, ph_succulent_1: 24, ph_succulent_2: 34, ph_quiver_1: 60 };
  const NOSHADOW = /^land_(barrel|cholla|pear|lantern|rock)/;
  function applyRanges() { try { const q = QUAL.q ? QUAL.q.range : 1; for (const S of INSTSET) { const r = RANGE[S.kind]; if (r) { const want = r * q; if (Math.abs(S.R - want) > 1) { S.R = want; S.n = -1; } } const lr = LODR[S.kind]; if (lr && S.far && S.lodR !== lr) { S.lodR = lr; S.n = -1; } if (/^land_/.test(S.kind)) { for (const im of S.far || []) im.castShadow = false; for (const im of S.far2 || []) im.castShadow = false; if (NOSHADOW.test(S.kind)) for (const im of S.insts || []) im.castShadow = false; } } } catch (e) {} }
  // the furniture is re-seated on the final ground (the building footprints are levelled after my terrain hook), before the
  // seats, lights and festoons read its height; the instances refresh on the engine's next cull pass
  const SEATK = /^land_(lantern|bench|fpost|ramada|firering|tank)$/;
  function reseat() { let n = 0; for (const k in PLACE) { if (!SEATK.test(k)) continue; const m = MODELS[k]; for (const e of PLACE[k]) { const r = m ? Math.min(1.2, m.radius * e[4] * 0.6) : 0.3; let lo = planGroundAt(e[0], e[2]); for (let q = 0; q < 6; q++) { const a = q / 6 * 6.283 + e[3]; lo = Math.min(lo, planGroundAt(e[0] + Math.cos(a) * r, e[2] + Math.sin(a) * r)); } if (Math.abs(lo - e[1]) > 0.01) { e[1] = lo; n++; } e.seated = true; } }
    for (const S of INSTSET) if (SEATK.test(S.kind)) { S.n = -1; S.nf = -1; S.nf2 = -1; } L.n.reseated = n; }
  function deferHook() { const t0 = performance.now(); for (const [nm, fn] of [["seat", reseat], ["beds", buildBeds], ["lights", buildLights], ["festoons", buildFestoons], ["fires", buildFires], ["seats", buildSeats], ["rocks", rockSolids], ["hotspots", hotspotsFor], ["ranges", applyRanges]]) { try { fn(); } catch (e) { err("defer " + nm, e); } } L.t.defer = Math.round(performance.now() - t0); }

  // ───────────── frame: night lighting, fire flicker near the player ─────────────
  let nOld = -1;
  function frameHook(dt, now) { const nt = typeof night === "number" ? night : 0; const k = sm(0.12, 0.6, nt); if (FRAME_N % 240 === 17) applyRanges();
    if (((FRAME_N % 6) === 2 || nOld < 0) && Math.abs(k - nOld) > 0.004) { nOld = k; if (MATS.glass) MATS.glass.emissiveIntensity = 2.4 * k; if (MATS.bulb) MATS.bulb.emissiveIntensity = 2.2 * k; if (L.halo) L.halo.material.opacity = 1.0 * k; if (L.festHalo) L.festHalo.material.opacity = 0.7 * k; if (L.pools) L.pools.material.opacity = 0.55 * k; if (MATS.ember) MATS.ember.emissiveIntensity = 0.6 + 1.6 * k; }
    if (L.fireObjs && camera) { const cx = camera.position.x, cz = camera.position.z; const t = now / 1000; for (const f of L.fireObjs) { const d = Math.hypot(f.x - cx, f.z - cz); const on = d < 320; if (f.g.visible !== on) f.g.visible = on; if (!on) continue; const fl = 0.8 + 0.2 * Math.sin(t * 11 + f.x) * Math.sin(t * 7.3 + f.z); f.g.children[0].scale.set(1, 0.85 + 0.3 * fl, 1); f.g.children[1].scale.set(1, 0.9 + 0.25 * (1 - fl), 1); f.mat.opacity = 0.55 + 0.45 * k; f.l.intensity = (0.4 + 2.2 * k) * fl; } } }

  HK.world.push({ name: "land:world", fn: worldHook });
  HK.defer.push({ name: "land:defer", fn: deferHook });
  HK.frame.push({ name: "land:frame", fn: frameHook });
  L.debug = { why: (x, z, rad, tall) => { const k = cellK(x, z); if (k < 0) return "outside"; const out = []; if (ZN[k] !== 1) out.push("zone" + ZN[k]); if (RA[k] & B_PLANT) out.push("plant"); if (RA[k] & B_GOLF) out.push("golf"); if (tall && (RA[k] & B_TALL)) out.push("view"); const dr = distToRunway(x, z); if (dr < (tall ? 155 : 128)) out.push("runway" + Math.round(dr)); if (!planSpotOK(x, z, rad || 1)) out.push("spotOK"); if (ownNear(x, z, rad || 1)) out.push("own"); if (inPlay(x, z, 3)) out.push("play"); return out.join(",") || "ok"; }, G, cellK, at: (x, z) => { const k = cellK(x, z); return k < 0 ? null : { bits: RA && RA[k], zone: ZN && ZN[k], dp: DP && DP[k], dc: DC && DC[k], cov: COV && COV[k], hill: hillAt(x, z) }; }, species, palAt };
})();
