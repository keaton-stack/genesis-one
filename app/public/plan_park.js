// Genesis Park (a partnership proposal, subject to agreement with the City of Douglas).
// Loaded before client.js. Classic script: never declare top-level const/let/var here, register on window only.
//
// B2 module (master plan section 4, Genesis Park): the City's Airport Park kept and upgraded, Genesis Creek and the
// Landing Run as moving water, the Runway Overlook knoll, the farm, the stables, Windmill Green and the Hangar
// Playground. Everything is built from plan.genesis_park and the gp_* places, props, walks and landscape polygons.
//
// How the ground works: the terrain grid is 4.7 m, too coarse for a 2 m creek, a spiral ramp or a cascade. So the
// terrain hook grades the grid to a designed surface (the wash valley, the channel, the knoll) and lowers any grid
// triangle that would poke through it; the defer hook then lays fine "ground patches" with the terrain's own material
// and uv (they blend with the ground seamlessly) and registers them in the walk grid. Every Genesis Park walk is
// re-laid on that surface (A1's ribbon pieces are taken over), with the bridges and the Riffle Stones cut in, so
// nothing floats and nobody sinks. Instanced placements inside the patches are lifted onto them.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  const HOOKS = window.PLAN_HOOKS;
  const LEGAL = "Genesis Park · a partnership proposal, subject to agreement with the City of Douglas";
  const GP = window.GP_PARK = { built: false, on: 1, zones: [], stats: {}, anim: [], lights: {}, animals: [], hs: [], errs: [] };
  { const S = window.PLAN_SKIP = window.PLAN_SKIP || new Set(); if (typeof S.add === "function") S.add("gp_p_overlook"); else if (Array.isArray(S)) S.push("gp_p_overlook"); }   // the spiral ramp is built here
  { const N = window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || []; for (const k of ["grotto", "little_hangar", "biplane", "bridge_trestle", "bridge_truss", "cow", "goat", "sheep", "pig", "chicken", "dog", "agave_cluster", "bandshell", "gbarn"]) if (N.indexOf(k) < 0) N.push(k); }   // new model kinds this module places

  // ───────── small maths ─────────
  let SEED = 24092026; const rand = () => { SEED = (SEED * 1664525 + 1013904223) >>> 0; return SEED / 4294967296; };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const hyp = Math.hypot;
  // piecewise linear over sorted [s, v] knots
  function pl(k) { k = k.slice().sort((a, b) => a[0] - b[0]); for (let i = 1; i < k.length; i++) if (k[i][0] <= k[i - 1][0]) k[i][0] = k[i - 1][0] + 1e-3;
    return (s) => { if (s <= k[0][0]) return k[0][1]; for (let i = 1; i < k.length; i++) if (s <= k[i][0]) { const a = k[i - 1], b = k[i]; return a[1] + (b[1] - a[1]) * (s - a[0]) / (b[0] - a[0]); } return k[k.length - 1][1]; }; }
  function inPoly(poly, x, z) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
  function bbox(poly) { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (const q of poly) { a = Math.min(a, q[0]); b = Math.max(b, q[0]); c = Math.min(c, q[1]); d = Math.max(d, q[1]); } return [a, b, c, d]; }
  const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const circ = (cx, cz, r, n) => { const o = []; for (let i = 0; i < (n || 24); i++) { const a = i / (n || 24) * Math.PI * 2; o.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } return o; };
  const yawTo = (dx, dz) => Math.atan2(dx, dz);                                  // three.js yaw that points +Z along (dx, dz)
  const yawOfBearing = (b) => { const a = b * Math.PI / 180; return Math.atan2(Math.sin(a), -Math.cos(a)); };
  function segDist(x, z, ax, az, bx, bz) { const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1; const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1); return hyp(x - ax - vx * t, z - az - vz * t); }
  function lineDist(pts, x, z) { let b = 1e9; for (let i = 0; i < pts.length - 1; i++) b = Math.min(b, segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])); return b; }
  function polyLen(p) { let L = 0; for (let i = 0; i < p.length - 1; i++) L += hyp(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]); return L; }
  // walk a polyline every step metres: cb(x, z, ux, uz, s)
  function along(pts, step, start, cb) { let acc = 0, next = start || 0; for (let i = 0; i < pts.length - 1; i++) { const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1]; const L = hyp(bx - ax, bz - az); if (L < 1e-4) continue; const ux = (bx - ax) / L, uz = (bz - az) / L; while (next <= acc + L) { const t = next - acc; cb(ax + ux * t, az + uz * t, ux, uz, next); next += step; } acc += L; } }

  // ───────── paths: a smoothed polyline resampled by arc length, with a raster for fast nearest-point queries ─────────
  function catmull(P, sub) { const o = []; const n = P.length; for (let i = 0; i < n - 1; i++) { const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)]; for (let k = 0; k < sub; k++) { const t = k / sub, t2 = t * t, t3 = t2 * t; o.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3), 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]); } } o.push(P[n - 1].slice()); return o; }
  function mkPath(ctrl, step, smooth, maxD, res) {
    const dense = smooth ? catmull(ctrl, 12) : ctrl; const X = [dense[0][0]], Z = [dense[0][1]], S = [0]; let acc = 0, next = 0;
    for (let i = 0; i < dense.length - 1; i++) { const ax = dense[i][0], az = dense[i][1], bx = dense[i + 1][0], bz = dense[i + 1][1]; const L = hyp(bx - ax, bz - az); if (L < 1e-6) continue; while (next + step <= acc + L + 1e-9) { next += step; const t = (next - acc) / L; X.push(ax + (bx - ax) * t); Z.push(az + (bz - az) * t); S.push(next); } acc += L; }
    if (acc - next > 0.05) { X.push(dense[dense.length - 1][0]); Z.push(dense[dense.length - 1][1]); S.push(acc); }
    const n = X.length, TX = new Float32Array(n), TZ = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); let tx = X[b] - X[a], tz = Z[b] - Z[a]; const L = hyp(tx, tz) || 1; TX[i] = tx / L; TZ[i] = tz / L; }
    const P = { X, Z, S, TX, TZ, n, L: S[n - 1], step };
    // raster: nearest sample index per cell, within maxD of the path
    const [x0, x1, z0, z1] = bbox(X.map((x, i) => [x, Z[i]])); const R = { res, x0: x0 - maxD, z0: z0 - maxD }; R.nx = Math.ceil((x1 - x0 + 2 * maxD) / res) + 1; R.nz = Math.ceil((z1 - z0 + 2 * maxD) / res) + 1;
    R.idx = new Int32Array(R.nx * R.nz).fill(-1); const d2 = new Float32Array(R.nx * R.nz).fill(1e18); const cr = Math.ceil(maxD / res);
    for (let i = 0; i < n; i++) { const ci = Math.floor((X[i] - R.x0) / res), cj = Math.floor((Z[i] - R.z0) / res);
      for (let dj = -cr; dj <= cr; dj++) { const j = cj + dj; if (j < 0 || j >= R.nz) continue; const cz = R.z0 + (j + 0.5) * res; for (let di = -cr; di <= cr; di++) { const k = ci + di; if (k < 0 || k >= R.nx) continue; const cx = R.x0 + (k + 0.5) * res; const dd = (cx - X[i]) * (cx - X[i]) + (cz - Z[i]) * (cz - Z[i]); if (dd > maxD * maxD) continue; const q = j * R.nx + k; if (dd < d2[q]) { d2[q] = dd; R.idx[q] = i; } } } }
    P.rast = R; return P;
  }
  // nearest point: { s, d (signed, + to the left of travel: normal (-tz, tx)), e (overshoot past an end), px, pz, tx, tz } or null
  function proj(P, x, z) {
    const R = P.rast; const ci = Math.floor((x - R.x0) / R.res), cj = Math.floor((z - R.z0) / R.res); if (ci < 0 || cj < 0 || ci >= R.nx || cj >= R.nz) return null; const i0 = R.idx[cj * R.nx + ci]; if (i0 < 0) return null;
    let bs = P.S[i0], bd = 1e18, bx = P.X[i0], bz = P.Z[i0], bt = 0, bi = i0;
    for (let j = Math.max(0, i0 - 3); j <= Math.min(P.n - 2, i0 + 2); j++) { const ax = P.X[j], az = P.Z[j], vx = P.X[j + 1] - ax, vz = P.Z[j + 1] - az, L2 = vx * vx + vz * vz || 1e-9; const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1); const px = ax + vx * t, pz = az + vz * t; const dd = (x - px) * (x - px) + (z - pz) * (z - pz); if (dd < bd) { bd = dd; bs = P.S[j] + t * (P.S[j + 1] - P.S[j]); bx = px; bz = pz; bi = j; bt = t; } }
    const tx = lerp(P.TX[bi], P.TX[Math.min(P.n - 1, bi + 1)], bt), tz = lerp(P.TZ[bi], P.TZ[Math.min(P.n - 1, bi + 1)], bt); const tl = hyp(tx, tz) || 1;
    let e = 0; const n = P.n; if (bs <= 1e-3) e = -((x - P.X[0]) * P.TX[0] + (z - P.Z[0]) * P.TZ[0]); else if (bs >= P.L - 1e-3) e = (x - P.X[n - 1]) * P.TX[n - 1] + (z - P.Z[n - 1]) * P.TZ[n - 1];
    const ux = tx / tl, uz = tz / tl; let d = (x - bx) * (-uz) + (z - bz) * ux; if (e > 0) d = (x - bx) * (-uz) + (z - bz) * ux;
    return { s: bs, d, e: Math.max(0, e), px: bx, pz: bz, tx: ux, tz: uz };
  }
  // point and tangent at arc length s (extrapolated straight past the ends)
  function at(P, s) { const n = P.n; if (s <= 0) return { x: P.X[0] + P.TX[0] * s, z: P.Z[0] + P.TZ[0] * s, tx: P.TX[0], tz: P.TZ[0] }; if (s >= P.L) { const e = s - P.L; return { x: P.X[n - 1] + P.TX[n - 1] * e, z: P.Z[n - 1] + P.TZ[n - 1] * e, tx: P.TX[n - 1], tz: P.TZ[n - 1] }; }
    const i = Math.min(n - 2, Math.floor(s / P.step)); const t = clamp((s - P.S[i]) / (P.S[i + 1] - P.S[i]), 0, 1); const tx = lerp(P.TX[i], P.TX[i + 1], t), tz = lerp(P.TZ[i], P.TZ[i + 1], t), l = hyp(tx, tz) || 1; return { x: lerp(P.X[i], P.X[i + 1], t), z: lerp(P.Z[i], P.Z[i + 1], t), tx: tx / l, tz: tz / l }; }

  // ───────── plan data ─────────
  const gpd = () => (window.PLAN && window.PLAN.genesis_park) || null;
  const prop = (id) => { const g = gpd(); return g ? (g.props || []).find((p) => p.id === id) || null : null; };
  const land = (id) => { const g = gpd(); return g ? (g.landscape || []).find((p) => p.id === id) || null : null; };
  const place = (id) => (typeof planPlace === "function" ? planPlace(id) : null);
  const promPts = (id) => { const r = window.PLAN.promenades.find((q) => q.id === id) || window.PLAN.roads.find((q) => q.id === id); return r ? r.pts : null; };
  const has = (k) => !!(MODELS[k] && MODEL_SPECS[k]);
  const pick = (list) => { for (const k of list) if (has(k)) return k; return null; };

  // ═════════ features in plan view (world hook) ═════════
  // Genesis Creek: the basin in front of the grotto, the plan's creek line to the Sink, then the dry wash to the Loop's
  // low-water crossing, fading out before Terminal Drive. + d is the west bank (the creek runs south).
  function setupCreek() {
    const G = gpd(); const ck = G.water.find((w) => w.id === "gp_w_creek"); if (!ck) return null;
    const B0 = [-86.2, -563.3];
    const ctrl = [B0].concat(ck.pts.map((p) => [p[0], p[1]])).concat([[-121.7, -228], [-122.5, -216], [-123.6, -205], [-124.4, -197.5]]);
    const path = mkPath(ctrl, 0.5, true, 52, 2);
    const S = (x, z) => { const q = proj(path, x, z); return q ? q.s : 0; };
    const C = { path, B0, BR: 2.25, sLip: 2.3 };
    C.sSpringBr = S(-85.4, -546.4); C.sSteps = S(-85, -536.4); C.sRiffle = S(-85.7, -503.4); C.sSac0 = S(-92.5, -436); C.sWillowBr = S(-94.9, -425.4); C.sSac1 = S(-101.5, -380);
    C.sFalls = S(-104, -361); C.sConfBr = S(-105.8, -349.1); C.sConf = S(-107.7, -336); C.sMesq = S(-118, -281); C.sSplashBr = S(-120.8, -266.9); C.sSink0 = S(-122, -249.5); C.sEnd = S(-122, -233.8);
    C.sDry = path.L;
    // cascades: [s of the lip, total drop, steps]
    C.casc = [{ s: C.sSteps, drop: 0.42, n: 3, len: 3.0, name: "Spring Steps" }, { s: C.sFalls, drop: 0.55, n: 2, len: 2.2, name: "Cottonwood Falls", lit: true }, { s: C.sMesq, drop: 0.32, n: 3, len: 2.4, name: "Mesquite Steps" }];
    // water half width: fast and shallow below the Spring, braided over Willow Reach, one narrow channel through the Sacaton, fanning over the Sink
    const wwK = pl([[0, 0.8], [C.sLip, 0.78], [C.sSteps - 5, 0.95], [C.sSteps + 3, 1.0], [C.sSteps + 12, 1.35], [C.sSac0 - 8, 1.35], [C.sSac0 + 1, 0.62], [C.sSac1 - 1, 0.62], [C.sSac1 + 7, 1.0], [C.sFalls - 3, 1.12], [C.sFalls + 4, 1.3], [C.sMesq - 6, 1.1], [C.sMesq + 4, 1.25], [C.sSink0 - 3, 1.15], [C.sSink0 + 2, 1.5], [C.sEnd - 3, 3.6], [C.sEnd, 4.1]]);
    const riff = (s) => (s > C.sSteps + 6 && s < C.sSac0 - 4 ? 1 : s > C.sConf + 4 && s < C.sMesq - 4 ? 0.7 : s > C.sMesq + 3 && s < C.sSink0 - 3 ? 0.6 : 0);
    C.ww = (s) => wwK(s) + 0.22 * Math.sin(s * 0.23 + 1.1) * riff(s);
    C.bk = pl([[0, 1.6], [C.sSteps, 1.9], [C.sSac0 - 4, 2.1], [C.sSac0 + 2, 1.25], [C.sSac1, 1.25], [C.sSac1 + 6, 2.1], [C.sSink0, 2.3], [C.sEnd, 2.4], [C.sDry, 2.6]]);
    C.bw = (s) => (s > C.sEnd ? 2.3 : C.ww(s) + (s > C.sSac0 && s < C.sSac1 ? 0.18 : 0.35));
    // floodplain half widths (west, east): the Sacaton Meadow fills its floodplain, the Splash Meadow terrace sits on the west terrace
    C.fpW = pl([[0, 6], [C.sSteps, 7], [C.sSac0 - 10, 8], [C.sSac0, 13], [C.sSac1, 13], [C.sSac1 + 10, 8], [C.sMesq, 9], [C.sSplashBr - 6, 15], [C.sEnd + 4, 15], [C.sDry, 7]]);
    C.fpE = pl([[0, 6], [C.sSteps, 7], [C.sSac0 - 10, 8], [C.sSac0, 14], [C.sSac1, 12], [C.sSac1 + 10, 8], [C.sConf, 9], [C.sMesq, 9], [C.sEnd, 11], [C.sDry, 7]]);
    // the meander: a gentle sinuous low-flow channel, straight at the basin, the cascades, the bridges and the stepping stones
    const anchors = [0, C.sSpringBr, C.sSteps, C.sRiffle, C.sWillowBr, C.sFalls, C.sConfBr, C.sConf, C.sMesq, C.sSplashBr, C.sEnd];
    const ampK = pl([[0, 0], [C.sSteps + 10, 1.25], [C.sSac0 - 4, 1.25], [C.sSac0 + 3, 0.45], [C.sSac1, 0.45], [C.sSac1 + 6, 0.85], [C.sMesq, 0.9], [C.sSink0, 0.5], [C.sEnd, 0.1]]);
    C.m = (s) => { let a = ampK(s); for (const t of anchors) a *= sstep(1.5, 7, Math.abs(s - t)); if (s > C.sEnd) a = 0; return a * (0.68 * Math.sin(s * 0.2027 + 1.3) + 0.32 * Math.sin(s * 0.4833 + 0.4)); };
    // the channel centre (meander applied) and its direction
    C.cen = (s) => { const p = at(path, s), m = C.m(s), p2 = at(path, s + 0.4), m2 = C.m(s + 0.4); const x = p.x - p.tz * m, z = p.z + p.tx * m, x2 = p2.x - p2.tz * m2, z2 = p2.z + p2.tx * m2; const l = hyp(x2 - x, z2 - z) || 1; return { x, z, tx: (x2 - x) / l, tz: (z2 - z) / l, px: p.x, pz: p.z, ptx: p.tx, ptz: p.tz }; };
    C.foam = (s) => { let f = 0; for (const c of C.casc) { const a = c.s - c.len / 2, b = c.s + c.len / 2; if (s >= a - 0.2 && s <= b + 0.3) f = 1; else if (s > b && s < b + 4) f = Math.max(f, Math.exp(-(s - b) / 1.3)); }
      f = Math.max(f, riff(s) * 0.34 * (0.55 + 0.45 * Math.sin(s * 0.41))); if (s < C.sSteps - 2) f = Math.max(f, 0.22); if (Math.abs(s - C.sRiffle) < 5) f = Math.max(f, 0.42); return f; };
    C.speed = (s) => { let v = s < C.sSteps ? 0.95 : s < C.sSac0 ? 0.8 : s < C.sSac1 ? 0.35 : s < C.sSink0 ? 0.6 : 0.3; for (const c of C.casc) if (Math.abs(s - c.s) < c.len / 2 + 0.3) v = 1.7; return v; };
    return C;
  }
  // the Landing Run: a 1 m rill from the Run Spring down the storm swale to the Confluence
  function setupRun(C) {
    const G = gpd(); const rn = G.water.find((w) => w.id === "gp_w_run"); if (!rn || !C) return null;
    const mouth = C.cen(C.sConf + 1.5);
    const ctrl = rn.pts.map((p) => [p[0], p[1]]); ctrl[ctrl.length - 1] = [mouth.x + 1.2, mouth.z];
    const path = mkPath(ctrl, 0.5, true, 30, 2);
    const R = { path, sBr: proj(path, -78.3, -330).s };
    R.ww = (s) => 0.46 + 0.08 * Math.sin(s * 0.3); R.bw = (s) => R.ww(s) + 0.28; R.bk = () => 0.8;
    R.fp = pl([[0, 3.5], [30, 5], [path.L - 20, 6], [path.L, 8]]);
    R.m = (s) => { const a = sstep(4, 14, s) * (1 - sstep(path.L - 12, path.L - 2, s)) * sstep(1.5, 6, Math.abs(s - R.sBr)); return a * 0.55 * Math.sin(s * 0.26 + 0.7); };
    R.cen = (s) => { const p = at(path, s), m = R.m(s), p2 = at(path, s + 0.4), m2 = R.m(s + 0.4); const x = p.x - p.tz * m, z = p.z + p.tx * m, x2 = p2.x - p2.tz * m2, z2 = p2.z + p2.tx * m2; const l = hyp(x2 - x, z2 - z) || 1; return { x, z, tx: (x2 - x) / l, tz: (z2 - z) / l, px: p.x, pz: p.z, ptx: p.tx, ptz: p.tz }; };
    return R;
  }
  // the Runway Overlook: a 6 m knoll with the Overlook Spur benched into it
  function setupKnoll() {
    const q = place("gp_knoll"); const pts = promPts("gp_p_overlook"); if (!q || !pts) return null;
    const K = { cx: q.x, cz: q.z, rTop: 8, rFoot: 31, rToe: 34.5, rPatch: 46, rise: 6.0 };
    const path = mkPath(pts.map((p) => [p[0], p[1]]), 0.5, true, 7, 1);
    K.path = path; K.pts = pts;
    // the climb starts at the knoll foot (second vertex) and ends at the summit edge (the vertex before the centre)
    K.L1 = proj(path, pts[1][0], pts[1][1]).s; K.L2 = proj(path, pts[pts.length - 2][0], pts[pts.length - 2][1]).s;
    return K;
  }
  // ═════════ heights (terrain hook): levels read from the natural ground ═════════
  const nat = (x, z) => sampleGrid(GP.H0, T, x, z);
  function creekHeights(C) {
    const P = C.path; const n = P.n; const N = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0, w = 0; for (let k = -4; k <= 4; k++) { const a = at(P, P.S[i] + k * 2.5); const ww = 1 - Math.abs(k) / 5; s += nat(a.x, a.z) * ww; w += ww; } N[i] = s / w; }
    C.N = N; const Ns = (s) => { const f = clamp(s / P.step, 0, n - 1); const i = Math.min(n - 2, Math.floor(f)); return lerp(N[i], N[i + 1], f - i); }; C.Ns = Ns;
    const Nh = Ns(0); let Nd = 1e9; for (let s = C.sSteps; s <= C.sFalls; s += 2) Nd = Math.min(Nd, Ns(s));
    // water level knots: moving water all the way, never a still pool; each cascade is a stack of short steps
    const W0 = Nh + 0.18; const k = [[0, W0], [C.sLip, W0 - 0.01]];
    const cs = (c, top) => { const a = c.s - c.len / 2; for (let j = 0; j < c.n; j++) { const s0 = a + (j + 0.5) * c.len / c.n; const h0 = top - c.drop * j / c.n, h1 = top - c.drop * (j + 1) / c.n; k.push([s0 - 0.04, h0], [s0 + 0.08, h1]); } return top - c.drop; };
    let lv = W0 - 0.1; k.push([C.sSteps - C.casc[0].len / 2 - 0.1, lv]); lv = cs(C.casc[0], lv);
    lv = Math.min(lv - 0.05, lv); k.push([C.sSteps + C.casc[0].len / 2 + 0.2, lv]);
    const wSac = Math.min(lv - 0.3, Nd - 0.3); k.push([C.sSac0, wSac]);
    const wFt = Math.min(wSac - 0.06, Nd - 0.38); k.push([C.sFalls - C.casc[1].len / 2 - 0.1, wFt]); lv = cs(C.casc[1], wFt); k.push([C.sFalls + C.casc[1].len / 2 + 0.2, lv]);
    const wMt = lv - 0.14; k.push([C.sMesq - C.casc[2].len / 2 - 0.1, wMt]); lv = cs(C.casc[2], wMt); k.push([C.sMesq + C.casc[2].len / 2 + 0.2, lv]);
    k.push([C.sSink0, lv - 0.05], [C.sEnd, lv - 0.1]);
    C.W = pl(k); C.knots = k.map((q) => q[0]);
    C.bankH = pl([[0, 0.42], [C.sSteps, 0.48], [C.sSac0 - 6, 0.5], [C.sSac0, 0.42], [C.sSac1, 0.42], [C.sSac1 + 8, 0.62], [C.sMesq, 0.62], [C.sSink0, 0.5], [C.sEnd, 0.42]]);
    C.depth = (s) => (s < C.sLip ? 0.16 : s > C.sSink0 ? lerp(0.13, -0.05, sstep(C.sSink0, C.sEnd + 1, s)) : 0.14 + 0.05 * Math.sin(s * 0.37));
    const Gend = C.W(C.sEnd) + C.bankH(C.sEnd);
    C.G = (s) => (s <= C.sEnd ? C.W(s) + C.bankH(s) : lerp(Gend, Ns(s) - 0.05, sstep(C.sEnd, C.sDry - 2, s)));
    C.bed = (s) => (s <= C.sEnd ? C.W(s) - C.depth(s) : C.G(s) - 0.28 * (1 - sstep(C.sDry - 12, C.sDry, s)));
    // valley sides: about 1 in 11 from the terrace up to the natural ground
    const SW = new Float32Array(n); for (let i = 0; i < n; i++) SW[i] = clamp(Math.abs(N[i] - C.G(P.S[i])) * 11, 7, 26); C.SW = SW;
    C.sw = (s) => { const f = clamp(s / P.step, 0, n - 1); const i = Math.min(n - 2, Math.floor(f)); return lerp(SW[i], SW[i + 1], f - i); };
    C.W0 = W0;
  }
  function runHeights(R, C) {
    const P = R.path; const top = nat(P.X[0], P.Z[0]) - 0.28; const bot = C.W(C.sConf + 1.5) + 0.04; const L = P.L;
    R.W = (s) => lerp(top, bot, Math.pow(clamp(s / L, 0, 1), 1.12));
    R.G = (s) => R.W(s) + lerp(0.34, 0.5, clamp(s / L, 0, 1));
    R.bed = (s) => R.W(s) - 0.09;
    const n = P.n, SW = new Float32Array(n); for (let i = 0; i < n; i++) SW[i] = clamp(Math.abs(nat(P.X[i], P.Z[i]) - R.G(P.S[i])) * 11, 5, 16); R.SW = SW;
    R.sw = (s) => { const f = clamp(s / P.step, 0, n - 1); const i = Math.min(n - 2, Math.floor(f)); return lerp(SW[i], SW[i + 1], f - i); };
  }
  function knollHeights(K) {
    K.base = nat(K.cx, K.cz); K.top = K.base + K.rise; const p1 = K.pts[1]; K.y1 = nat(p1[0], p1[1]);
    K.rampY = (L) => (L <= K.L1 ? null : L >= K.L2 ? K.top : lerp(K.y1, K.top, (L - K.L1) / (K.L2 - K.L1)));
    // height by radius from the ramp itself (it spirals in monotonically), with a rounded summit edge
    const pr = []; for (let s = K.L1; s <= K.L2; s += 0.5) { const p = at(K.path, s); pr.push([hyp(p.x - K.cx, p.z - K.cz), K.rampY(Math.max(s, K.L1 + 0.01))]); } pr.sort((a, b) => a[0] - b[0]);
    const r = [], h = []; let last = -1; for (const q of pr) { if (q[0] - last < 0.25) continue; r.push(q[0]); h.push(q[1]); last = q[0]; } K.hr = { r, h };
  }
  // ═════════ the designed surface ═════════
  // polynomial smooth min / max
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
  function creekSurf(x, z, n0) {
    const C = GP.creek; if (!C || !C.W) return null; const q = proj(C.path, x, z); if (!q) return null;
    const s = q.s, d = q.d, e = q.e; const fp = d >= 0 ? C.fpW(s) : C.fpE(s), sw = C.sw(s); const ad = hyp(d, e);
    if (ad > fp + sw + 0.5) return null;
    const G = C.G(s); let h = G;
    if (e <= 0.01) { const u = Math.abs(d - C.m(s)), bw = C.bw(s), bk = C.bk(s), bed = C.bed(s) + 0.03 * Math.sin(x * 1.7 + z * 2.3) * Math.sin(z * 1.3 - x * 0.7); if (u < bw) h = bed; else if (u < bw + bk) h = lerp(bed, G, sstep(0, 1, (u - bw) / bk)); }
    // the spring basin: a shallow bowl in front of the grotto
    const rb = hyp(x - C.B0[0], z - C.B0[1]); if (rb < C.BR + 1.3) h = Math.min(h, lerp(C.W0 - 0.16, C.G(0), sstep(C.BR - 0.5, C.BR + 1.3, rb)));
    return lerp(h, n0, sstep(0, 1, (ad - fp) / sw));
  }
  function runSurf(x, z, n0) {
    const R = GP.run; if (!R || !R.W) return null; const q = proj(R.path, x, z); if (!q) return null;
    const s = q.s, d = q.d, e = q.e; const fp = R.fp(s), sw = R.sw(s); const ad = hyp(d, e); if (ad > fp + sw + 0.5) return null;
    const G = R.G(s); let h = G;
    if (e <= 0.01) { const u = Math.abs(d - R.m(s)), bw = R.bw(s), bk = R.bk(s), bed = R.bed(s); if (u < bw) h = bed; else if (u < bw + bk) h = lerp(bed, G, sstep(0, 1, (u - bw) / bk)); }
    // the stone spout at the head of the Run sits in a little bowl
    return lerp(h, n0, sstep(0, 1, (ad - fp) / sw));
  }
  function knollCone(K, r, n0) { if (r >= K.rToe) return n0; const T = K.hr; let h; if (r <= T.r[0]) h = K.top; else if (r >= T.r[T.r.length - 1]) h = T.h[T.h.length - 1]; else { let i = 1; while (T.r[i] < r) i++; const t = (r - T.r[i - 1]) / (T.r[i] - T.r[i - 1]); h = lerp(T.h[i - 1], T.h[i], t); }
    const rf = T.r[T.r.length - 1]; const w = r <= rf - 1.5 ? 1 : 1 - sstep(rf - 1.5, K.rToe, r); return lerp(n0, h, w); }
  function knollSurf(x, z, n0) {
    const K = GP.knoll; if (!K || K.top === undefined) return null; const r = hyp(x - K.cx, z - K.cz); if (r > K.rToe + 1) return null;
    let h = knollCone(K, r, n0);
    const q = proj(K.path, x, z); if (q && q.s > K.L1 - 2 && q.s < K.L2 + 1) { const ry = K.rampY(Math.max(q.s, K.L1 + 0.01)); const ad = Math.abs(q.d);
      if (ry !== null && ad < 3.6) { const k = ad < 1.65 ? 1 : 1 - sstep(1.65, 3.6, ad); h = lerp(h, ry, k * sstep(K.L1 - 2, K.L1 + 3, q.s)); } }
    return h;
  }
  // designed ground height at (x, z): the natural ground outside the park's landforms
  function surf(x, z) {
    const n0 = nat(x, z); let h = n0;
    const c = creekSurf(x, z, n0); if (c !== null) h = c;
    const r = runSurf(x, z, n0); if (r !== null) h = c !== null ? Math.min(h, r) : r;
    const k = knollSurf(x, z, h); if (k !== null) h = k;
    return h;
  }
  // is (x, z) covered by a fine ground patch? (then its walkable height is surf + PATCH_LIFT)
  const PATCH_LIFT = 0.02;
  function inPatch(x, z) {
    const C = GP.creek, R = GP.run, K = GP.knoll;
    if (K && hyp(x - K.cx, z - K.cz) < K.rPatch) return true;
    if (C && C.W) { const q = proj(C.path, x, z); if (q) { const ad = hyp(q.d, q.e); if (ad < Math.max((q.d >= 0 ? C.fpW(q.s) : C.fpE(q.s)) + C.sw(q.s) + 0.5, 17)) return true; } }
    if (R && R.W) { const q = proj(R.path, x, z); if (q) { const ad = hyp(q.d, q.e); if (ad < Math.max(R.fp(q.s) + R.sw(q.s) + 0.5, 12)) return true; } }
    return false;
  }
  // the walkable ground under anything the park builds (the patch where there is one, else the terrain)
  function ground(x, z) { return GP.ready && inPatch(x, z) ? surf(x, z) + PATCH_LIFT : getH(x, z); }
  GP.ground = ground; GP.surf = surf; GP.inPatch = inPatch;
  GP.dbgAt = (x, z) => ({ getH: getH(x, z), surf: surf(x, z), inPatch: inPatch(x, z), walk: walkAt(x, z), lift: roadLiftAt(x, z), solid: solidTop(x, z, 1e4), surfaceAt: surfaceAt(x, z, surf(x, z) + 0.4) });

  // ═════════ terrain hook: grade the grid to the designed surface, never above the patches ═════════
  function terrainHook() {
    if (!GP.creek) return; const t0 = performance.now();
    GP.H0 = H.slice();
    creekHeights(GP.creek); if (GP.run) runHeights(GP.run, GP.creek); if (GP.knoll) knollHeights(GP.knoll);
    // union bounding box of the landforms, in grid cells
    const boxes = []; { const C = GP.creek.path; const b = bbox(C.X.map((x, i) => [x, C.Z[i]])); boxes.push([b[0] - 48, b[1] + 48, b[2] - 48, b[3] + 48]); }
    if (GP.run) { const P = GP.run.path; const b = bbox(P.X.map((x, i) => [x, P.Z[i]])); boxes.push([b[0] - 26, b[1] + 26, b[2] - 26, b[3] + 26]); }
    if (GP.knoll) { const K = GP.knoll; boxes.push([K.cx - K.rPatch - 6, K.cx + K.rPatch + 6, K.cz - K.rPatch - 6, K.cz + K.rPatch + 6]); }
    const cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1); const cells = new Set(); let nv = 0;
    for (const b of boxes) { const c0 = Math.max(0, Math.floor((b[0] - T.xmin) / cw)), c1 = Math.min(T.cols - 2, Math.ceil((b[1] - T.xmin) / cw)), r0 = Math.max(0, Math.floor((b[2] - T.zmin) / ch)), r1 = Math.min(T.rows - 2, Math.ceil((b[3] - T.zmin) / ch)); for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells.add(r * T.cols + c); }
    // 1: every vertex of those cells takes the designed surface
    const done = new Set(); for (const i of cells) for (const v of [i, i + 1, i + T.cols, i + T.cols + 1]) { if (done.has(v)) continue; done.add(v); const r = Math.floor(v / T.cols), c = v % T.cols; H[v] = surf(T.xmin + c * cw, T.zmin + r * ch); nv++; }
    // 2: lower any triangle that would show through the patch (15 barycentric samples per triangle, a few passes)
    const MARGIN = 0.035; let lowered = 0, passes = 0; let todo = Array.from(cells);
    for (; passes < 5 && todo.length; passes++) { const need = new Map();
      for (const i of todo) { const r = Math.floor(i / T.cols), c = i % T.cols; const x0 = T.xmin + c * cw, z0 = T.zmin + r * ch; const v00 = i, v10 = i + 1, v01 = i + T.cols, v11 = i + T.cols + 1; const h00 = H[v00], h10 = H[v10], h01 = H[v01], h11 = H[v11];
        let e1 = 0, e2 = 0;
        for (let a = 0; a <= 4; a++) for (let b = 0; a + b <= 4; b++) { const fa = a / 4, fb = b / 4;
          { const x = x0 + fa * cw, z = z0 + fb * ch; const hi = h00 + fa * (h10 - h00) + fb * (h01 - h00); const ex = hi - (surf(x, z) - (inPatch(x, z) ? MARGIN : 0)); if (ex > e1) e1 = ex; }
          { const x = x0 + cw - fa * cw, z = z0 + ch - fb * ch; const hi = h11 + fa * (h01 - h11) + fb * (h10 - h11); const ex = hi - (surf(x, z) - (inPatch(x, z) ? MARGIN : 0)); if (ex > e2) e2 = ex; } }
        if (e1 > 0.002) for (const v of [v00, v10, v01]) need.set(v, Math.max(need.get(v) || 0, e1 + 0.004));
        if (e2 > 0.002) for (const v of [v11, v01, v10]) need.set(v, Math.max(need.get(v) || 0, e2 + 0.004)); }
      const next = new Set(); for (const [v, e] of need) { H[v] -= e; lowered++; const r = Math.floor(v / T.cols), c = v % T.cols; for (const q of [v, v - 1, v - T.cols, v - T.cols - 1]) { if (q >= 0 && cells.has(q)) next.add(q); } } todo = Array.from(next); }
    GP.ready = true; GP.stats.terrain = { vertices: nv, lowered, passes, ms: Math.round(performance.now() - t0) };
  }

  // ═════════ materials and textures ═════════
  const WU = { uT: { value: 0 }, uOn: { value: 1 }, uSun: { value: null }, uNight: { value: 0 } };
  let MT = null;
  const GLSL_NOISE = "float gpH1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat gpN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gpH1(i), gpH1(i + vec2(1.0, 0.0)), f.x), mix(gpH1(i + vec2(0.0, 1.0)), gpH1(i + vec2(1.0, 1.0)), f.x), f.y); }\n";
  function canvasTex(S, draw, srgb) { const c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d"); draw(g, S, c); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
  // river cobble: packed rounded stones, with a normal map from the same stones
  function cobbleTextures() {
    const S = 512; const col = document.createElement("canvas"), hgt = document.createElement("canvas"); col.width = col.height = hgt.width = hgt.height = S; const g = col.getContext("2d"), h = hgt.getContext("2d");
    g.fillStyle = "#5d554c"; g.fillRect(0, 0, S, S); h.fillStyle = "#000"; h.fillRect(0, 0, S, S);
    const pal = [[134, 128, 119], [112, 105, 97], [152, 140, 121], [92, 88, 84], [141, 113, 90], [121, 121, 125], [166, 154, 136], [80, 75, 71], [129, 99, 79], [104, 110, 108]];
    const rgb = (c, k) => "rgb(" + Math.min(255, c[0] * k | 0) + "," + Math.min(255, c[1] * k | 0) + "," + Math.min(255, c[2] * k | 0) + ")";
    for (let i = 0; i < 560; i++) { const x = rand() * S, y = rand() * S, rx = 7 + rand() * rand() * 26 + 4, ry = rx * (0.55 + rand() * 0.4), a = rand() * Math.PI, c = pal[(rand() * pal.length) | 0], k = 0.82 + rand() * 0.36;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { const px = x + ox * S, py = y + oy * S; if (px < -40 || px > S + 40 || py < -40 || py > S + 40) continue;
        g.save(); g.translate(px, py); g.rotate(a); const gr = g.createRadialGradient(-rx * 0.28, -ry * 0.32, 1, 0, 0, rx); gr.addColorStop(0, rgb(c, k * 1.2)); gr.addColorStop(0.72, rgb(c, k)); gr.addColorStop(1, rgb(c, k * 0.55)); g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 6.2832); g.fill(); g.restore();
        h.save(); h.translate(px, py); h.rotate(a); const hr = h.createRadialGradient(0, 0, 0, 0, 0, rx); hr.addColorStop(0, "#fff"); hr.addColorStop(0.7, "#b0b0b0"); hr.addColorStop(1, "#000"); h.fillStyle = hr; h.beginPath(); h.ellipse(0, 0, rx, ry, 0, 0, 6.2832); h.fill(); h.restore(); } }
    const hd = h.getImageData(0, 0, S, S).data; const nm = h.createImageData(S, S); const nd = nm.data; const at2 = (x, y) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const dx = (at2(x - 1, y) - at2(x + 1, y)) * 2.2, dy = (at2(x, y - 1) - at2(x, y + 1)) * 2.2; const l = Math.hypot(dx, dy, 1); const o = (y * S + x) * 4; nd[o] = (dx / l * 0.5 + 0.5) * 255; nd[o + 1] = (-dy / l * 0.5 + 0.5) * 255; nd[o + 2] = (1 / l * 0.5 + 0.5) * 255; nd[o + 3] = 255; }
    h.putImageData(nm, 0, 0);
    const tc = new THREE.CanvasTexture(col), tn = new THREE.CanvasTexture(hgt); for (const t of [tc, tn]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; } tc.colorSpace = THREE.SRGBColorSpace; tn.colorSpace = THREE.NoColorSpace; return [tc, tn];
  }
  function mats() {
    if (MT) return MT; const std = (o) => new THREE.MeshStandardMaterial(o);
    const tex = (name, rx, ry) => { try { return texRep(name, rx, ry); } catch (e) { return TEX[name] || null; } };
    MT = {
      wood: std({ map: tex("wood", 1, 1), color: 0x9a7650, roughness: 0.9 }), woodDark: std({ map: tex("wood", 1, 1), color: 0x5e4632, roughness: 0.92 }), grey: std({ map: tex("wood", 1, 1), color: 0x9a948c, roughness: 0.9 }),
      white: std({ color: 0xefebe2, roughness: 0.55, metalness: 0.15 }), steel: std({ color: 0xaab1b6, roughness: 0.38, metalness: 0.78 }), dark: std({ color: 0x2c3034, roughness: 0.5, metalness: 0.55 }),
      alu: std({ color: 0xcfd4d8, roughness: 0.3, metalness: 0.82 }), conc: std({ map: tex("apron", 1, 1), color: 0xd4cdc0, roughness: 0.95 }), block: std({ map: tex("apron", 1, 1), color: 0xcfc6b4, roughness: 0.9 }),
      red: std({ map: tex("wood", 1, 1), color: 0x93352a, roughness: 0.85 }), green: std({ color: 0x2f6e45, roughness: 0.7 }), yellow: std({ color: 0xf2c33c, roughness: 0.6 }),
      copper: std({ color: 0xb87a45, roughness: 0.32, metalness: 0.88 }), verd: std({ color: 0x6f9a86, roughness: 0.6, metalness: 0.4 }),
      stone: std({ map: tex("travertine", 1, 1), normalMap: TEX.rockN, color: 0x9d978f, roughness: 0.95 }), basalt: std({ normalMap: TEX.rockN, color: 0x4a4744, roughness: 0.85 }),
      flag: std({ map: tex("travertine", 1, 1), color: 0xd6c4a6, roughness: 0.9 }), clay: std({ map: TEX.sand, normalMap: TEX.dirtN, color: 0xc27c52, roughness: 1 }),
      soil: std({ map: TEX.dirt, color: 0x6b4d36, roughness: 1 }), sand: std({ map: TEX.sand, color: 0xcdbfa6, roughness: 1 }), footing: std({ map: TEX.sand, color: 0xb8aa92, roughness: 1 }),
      rubber: std({ color: 0xb45b3e, roughness: 0.95 }), rubber2: std({ color: 0x3f7a8a, roughness: 0.95 }), asphalt: M.asphalt, stripe: M.stripe,
      fabric: std({ color: 0xf1e8d8, roughness: 0.85, side: THREE.DoubleSide }), fabric2: std({ color: 0xc9824f, roughness: 0.85, side: THREE.DoubleSide }),
      straw: std({ map: tex("wicker", 1, 1), color: 0xe0bf74, roughness: 1 }), plant: std({ color: 0x5d7d3a, roughness: 0.9 }), corn: std({ color: 0x86a04a, roughness: 0.9, side: THREE.DoubleSide }),
      net: std({ color: 0xf2f2ee, roughness: 0.8, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
      led: std({ color: 0xe9eef5, emissive: 0xf1f5ff, emissiveIntensity: 0, roughness: 0.4 }), warm: std({ color: 0xffe0ad, emissive: 0xffb45e, emissiveIntensity: 0, roughness: 0.4 }),
      stage: std({ color: 0xfff1d8, emissive: 0xffd08a, emissiveIntensity: 0, roughness: 0.4 }), black: std({ color: 0x1b1d20, roughness: 0.7 }),
      blanket: [0xb8433a, 0x2f6e8e, 0xe2b24a, 0x5f8a3d, 0x8a4f8e, 0xd97a3a].map((c) => std({ color: c, roughness: 0.95 })),
      balloon: [0xd8452f, 0xf2c33c, 0x3f9a5f].map((c) => std({ color: c, roughness: 0.6 })),
    };
    // chain-link: a diamond wire mesh (mipmapped alpha reads as a faint veil at distance)
    MT.chain = std({ map: canvasTex(64, (g, S) => { g.clearRect(0, 0, S, S); g.strokeStyle = "rgba(214,218,222,1)"; g.lineWidth = 3; for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(k * S, 0); g.lineTo(k * S + S, S); g.stroke(); g.beginPath(); g.moveTo(k * S + S, 0); g.lineTo(k * S, S); g.stroke(); } }), color: 0xc2c8cc, metalness: 0.5, roughness: 0.45, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    MT.wind = std({ color: 0x1f4a33, roughness: 0.9, side: THREE.DoubleSide });   // outfield windscreen
    // turf with mowing stripes in world space
    const turf = (col, mode, key) => { const m = std({ map: tex("turf", 1, 1), normalMap: TEX.turfN, color: col, roughness: 1 }); m.customProgramCacheKey = () => key; m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vGpW;").replace("#include <project_vertex>", "#include <project_vertex>\nvGpW = (modelMatrix * vec4(transformed, 1.0)).xyz;"); sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vGpW;\n" + GLSL_NOISE).replace("#include <map_fragment>", "#include <map_fragment>\n{ vec2 w = vGpW.xz; float st = " + (mode === 1 ? "step(0.5, fract((w.x + w.y) / 11.0)) * 0.6 + step(0.5, fract((w.x - w.y) / 11.0)) * 0.4" : mode === 2 ? "0.5 + 0.5 * gpN(w * 0.11)" : "step(0.5, fract(w.x / 7.5))") + "; float pn = gpN(w * 0.35) * 0.5 + gpN(w * 1.7) * 0.5; diffuseColor.rgb *= (0.94 + 0.07 * st) * (0.9 + 0.16 * pn); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.33))), 0.32) * 0.94; }"); }; return m; };
    MT.turf = turf(0x5f7040, 0, "gpturf0"); MT.turf1 = turf(0x5c713f, 1, "gpturf1"); MT.meadow = turf(0x807a4e, 2, "gpturf2");
    const [cc, cn] = cobbleTextures(); GP.cobbleTex = cc;
    // cobble bed: wet and glossy under the water by day, dry and pale when the creek is drained; ragged edge into the bank
    MT.cobble = std({ map: cc, normalMap: cn, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    MT.cobble.customProgramCacheKey = () => "gpcobble";
    MT.cobble.onBeforeCompile = (sh) => { sh.uniforms.uOn = WU.uOn;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec2 aBed; varying vec2 vBed; varying vec3 vBw;").replace("#include <project_vertex>", "#include <project_vertex>\nvBed = aBed; vBw = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uOn; varying vec2 vBed; varying vec3 vBw;\n" + GLSL_NOISE)
        .replace("#include <color_fragment>", "#include <color_fragment>\nfloat gpWet = 0.0;\n{ float edge = 1.0 - abs(vBed.x); float nz = gpN(vBw.xz * 1.9) * 0.6 + gpN(vBw.xz * 5.1) * 0.4; if (edge + (nz - 0.5) * 0.34 < 0.06) discard; gpWet = uOn * (1.0 - smoothstep(vBed.y - 0.03, vBed.y + 0.05, vBw.y)); float damp = (1.0 - smoothstep(vBed.y + 0.03, vBed.y + 0.35, vBw.y)) * uOn * 0.35; diffuseColor.rgb *= mix(1.0, 0.56, max(gpWet, damp)); }")
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.26, gpWet);"); };
    // moving water: flowing ripples, white water on the cascades, sparkles in the sun, cobbles through the shallows
    WU.uSun.value = new THREE.Vector3(0.3, 0.8, 0.3);
    MT.water = std({ color: 0x33504b, roughness: 0.05, metalness: 0.0, transparent: true, depthWrite: false, envMapIntensity: 1.15 });
    MT.water.customProgramCacheKey = () => "gpcreek";
    MT.water.onBeforeCompile = (sh) => { sh.uniforms.uT = WU.uT; sh.uniforms.uOn = WU.uOn; sh.uniforms.uSun = WU.uSun; sh.uniforms.uNight = WU.uNight;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 aFlow; attribute vec4 aDir; varying vec4 vFlow; varying vec4 vDir; varying vec3 vWp;").replace("#include <project_vertex>", "#include <project_vertex>\nvFlow = aFlow; vDir = aDir; vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uT; uniform float uOn; uniform vec3 uSun; uniform float uNight; varying vec4 vFlow; varying vec4 vDir; varying vec3 vWp;\n" + GLSL_NOISE +
        "float gpWave(vec2 q, float sp) { float t = uT * sp; return gpN(vec2(q.x * 1.7, q.y * 0.9 - t * 0.9)) * 0.55 + gpN(vec2(q.x * 3.9 + 3.1, q.y * 2.3 - t * 1.45)) * 0.3 + gpN(vec2(q.x * 8.1, q.y * 5.4 - t * 2.2)) * 0.15; }\n" +
        "float gpRad(vec2 o) { float r = length(o); return 0.5 * sin(r * 6.5 - uT * 2.4) * exp(-r * 0.45) + gpN(o * 2.3 + vec2(uT * 0.3, -uT * 0.2)) * 0.4; }\n")
        .replace("#include <color_fragment>", "#include <color_fragment>\nfloat gpFoam = 0.0; vec3 gpNW = vec3(0.0, 1.0, 0.0);\n{ float fade = smoothstep(0.0, 0.42, vDir.z); if (vDir.w > 0.5 && vDir.w < 1.5) { float r = length(vFlow.xy); gpFoam = smoothstep(0.7, 0.0, r) * smoothstep(0.5, 0.85, gpN(vFlow.xy * 6.0 + vec2(uT * 0.9, uT * 0.6))) * 0.7; } else { float sp = max(0.15, vFlow.w); float f = gpN(vec2(vFlow.x * 3.0, vFlow.y * 1.1 - uT * sp * 1.7)) * 0.6 + gpN(vec2(vFlow.x * 7.0 + 5.0, vFlow.y * 2.6 - uT * sp * 2.4)) * 0.4; gpFoam = vFlow.z * smoothstep(0.64 - 0.5 * vFlow.z, 0.96 - 0.36 * vFlow.z, f); } diffuseColor.rgb = mix(vec3(0.085, 0.15, 0.14), vec3(0.93, 0.96, 0.97), gpFoam); diffuseColor.a = fade * uOn; }")
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, gpFoam);")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n{ float e = 0.06; vec3 nw; if (vDir.w > 0.5 && vDir.w < 1.5) { vec2 o = vFlow.xy; float h0 = gpRad(o); float gx = (gpRad(o + vec2(e, 0.0)) - h0) / e; float gz = (gpRad(o + vec2(0.0, e)) - h0) / e; nw = normalize(vec3(-gx * 0.16, 1.0, -gz * 0.16)); } else { vec2 q = vFlow.xy; float sp = max(0.15, vFlow.w); float h0 = gpWave(q, sp); float ga = (gpWave(q + vec2(e, 0.0), sp) - h0) / e; float gb = (gpWave(q + vec2(0.0, e), sp) - h0) / e; float amp = 0.09 + 0.2 * clamp(vFlow.w - 0.4, 0.0, 1.3) + 0.3 * vFlow.z; vec3 al = vec3(vDir.x, 0.0, vDir.y); vec3 ac = vec3(-vDir.y, 0.0, vDir.x); nw = normalize(vec3(0.0, 1.0, 0.0) - (ac * ga + al * gb) * amp); } gpNW = nw; normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz); }")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n{ vec3 V = normalize(cameraPosition - vWp); float nv = clamp(dot(gpNW, V), 0.0, 1.0); float fr = 0.03 + 0.97 * pow(1.0 - nv, 5.0); vec3 R = reflect(-V, gpNW); float sd = max(dot(R, normalize(uSun)), 0.0); float day = clamp(1.0 - uNight * 1.3, 0.0, 1.0); float spec = pow(sd, 420.0) * 7.0 + pow(sd, 70.0) * 0.3; float gl = step(0.972, gpH1(floor(vWp.xz * 21.0) + floor(uT * 7.0))) * pow(sd, 16.0) * 4.5; float spk = (spec + gl) * day * (1.0 - gpFoam); totalEmissiveRadiance += vec3(1.0, 0.95, 0.85) * spk; float lit = step(1.5, vDir.w) * uNight; totalEmissiveRadiance += vec3(1.0, 0.84, 0.6) * lit * (0.5 + 1.6 * gpFoam); float a = max(mix(0.34, 0.9, fr), gpFoam * 0.93); a = max(a, clamp(spk, 0.0, 1.0)); diffuseColor.a *= a; if (diffuseColor.a < 0.004) discard; }"); };
    // the Splash Meadow, the splash pad, the runnel and the trough use the same water, set shallow and still-looking
    return MT;
  }

  // ═════════ geometry helpers ═════════
  const UBOX = new THREE.BoxGeometry(1, 1, 1), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
  // a batch collects world-space geometry per material and merges it into one mesh per material
  class Batch {
    constructor(name) { this.name = name; this.by = new Map(); }
    geo(g, mat) { if (!g || !mat) return; if (!this.by.has(mat)) this.by.set(mat, []); this.by.get(mat).push(g); }
    put(g, mat, x, y, z, ry, sx, sy, sz, rx, rz) { const c = g.clone(); _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v.set(x, y, z), _q, _s.set(sx || 1, sy || 1, sz || 1)); c.applyMatrix4(_m4); this.geo(c, mat); }
    box(w, h, d, mat, x, y, z, ry, rx, rz) { this.put(UBOX, mat, x, y, z, ry, w, h, d, rx, rz); }
    // a box between two points (a beam, a rail, a rafter): w wide, h tall
    beam(ax, ay, az, bx, by, bz, w, h, mat) { const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz); if (L < 1e-3) return; const ry = Math.atan2(dx, dz), rx = -Math.atan2(dy, Math.hypot(dx, dz)); this.put(UBOX, mat, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, ry, w, h, L, rx, 0); }
    cyl(rt, rb, h, seg, mat, x, y, z, rx, ry, rz) { const k = "c" + rt + "_" + rb + "_" + seg; let g = CYL.get(k); if (!g) { g = new THREE.CylinderGeometry(rt, rb, 1, seg); CYL.set(k, g); } this.put(g, mat, x, y, z, ry, 1, h, 1, rx, rz); }
    pole(ax, ay, az, bx, by, bz, r, mat, seg) { const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz); if (L < 1e-3) return; const k = "p" + r + "_" + (seg || 8); let g = CYL.get(k); if (!g) { g = new THREE.CylinderGeometry(r, r, 1, seg || 8); CYL.set(k, g); } const c = g.clone(); _v.set(dx / L, dy / L, dz / L); _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v); _m4.compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s.set(1, L, 1)); c.applyMatrix4(_m4); this.geo(c, mat); }
    build(parent, opt) { const o = opt || {}; let n = 0; for (const [mat, list] of this.by) { if (!list.length) continue; const g = bake(list); const mesh = new THREE.Mesh(g, mat); mesh.castShadow = o.cast !== false && !mat.transparent; mesh.receiveShadow = true; mesh.userData.noInst = true; parent.add(mesh); n++; } this.by.clear(); return n; }
  }
  const CYL = new Map();
  // merge world-space geometries (position, normal, uv; index optional) into one indexed geometry
  function bake(list) {
    let nv = 0, ni = 0; for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = nv > 65000 ? new Uint32Array(ni) : new Uint16Array(ni); let vo = 0, io = 0;
    for (const g of list) { const c = g.attributes.position.count; pos.set(g.attributes.position.array, vo * 3); if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3); if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
      if (g.index) { const ia = g.index.array; for (let k = 0; k < ia.length; k++) idx[io + k] = ia[k] + vo; io += ia.length; } else { for (let k = 0; k < c; k++) idx[io + k] = vo + k; io += c; } vo += c; g.dispose(); }
    const out = new THREE.BufferGeometry(); out.setAttribute("position", new THREE.BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); out.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); out.setIndex(new THREE.BufferAttribute(idx, 1)); out.computeBoundingSphere(); out.computeBoundingBox(); return out;
  }
  // merge world-space meshes of one material that carry custom attributes (the water, the cobble beds)
  function bakeAttrs(meshes, names) {
    const geos = meshes.map((m) => m.geometry); let nv = 0, ni = 0; for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
    const out = new THREE.BufferGeometry(); const all = ["position", "normal", "uv"].concat(names);
    for (const k of all) { const sz = geos[0].attributes[k].itemSize; const arr = new Float32Array(nv * sz); let o = 0; for (const g of geos) { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; } out.setAttribute(k, new THREE.BufferAttribute(arr, sz)); }
    const idx = nv > 65000 ? new Uint32Array(ni) : new Uint16Array(ni); let vo = 0, io = 0; for (const g of geos) { const ia = g.index.array; for (let k = 0; k < ia.length; k++) idx[io + k] = ia[k] + vo; io += ia.length; vo += g.attributes.position.count; }
    out.setIndex(new THREE.BufferAttribute(idx, 1)); out.computeBoundingSphere(); for (const m of meshes) { if (m.parent) m.parent.remove(m); m.geometry.dispose(); } return out;
  }
  function mergeWater(zn) {
    const MAT = mats(); const water = [], beds = []; for (const z of GP.zones) z.g.traverse((o) => { if (!o.isMesh || o.isInstancedMesh) return; if (o.material === MAT.water && o !== GP.splashWater && o !== GP.pumpWater) water.push(o); else if (o.material === MAT.cobble) beds.push(o); });
    if (water.length > 1) { const m = new THREE.Mesh(bakeAttrs(water, ["aFlow", "aDir"]), MAT.water); m.renderOrder = 3; m.receiveShadow = true; m.userData.noInst = true; zn.g.add(m); GP.water = [m, GP.splashWater, GP.pumpWater].filter(Boolean); }
    if (beds.length > 1) { const m = new THREE.Mesh(bakeAttrs(beds, ["aBed"]), MAT.cobble); m.receiveShadow = true; m.userData.noInst = true; zn.g.add(m); }
  }
  // a grid of rows x cols world vertices ([x, y, z, u, v]); faces up
  function gridGeo(rows, attrs) {
    const nr = rows.length, nc = rows[0].length; const pos = new Float32Array(nr * nc * 3), uv = new Float32Array(nr * nc * 2); const idx = [];
    for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { const v = rows[i][j], o = i * nc + j; pos[o * 3] = v[0]; pos[o * 3 + 1] = v[1]; pos[o * 3 + 2] = v[2]; uv[o * 2] = v[3] || 0; uv[o * 2 + 1] = v[4] || 0; }
    for (let i = 0; i < nr - 1; i++) for (let j = 0; j < nc - 1; j++) { const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    if (attrs) for (const k in attrs) g.setAttribute(k, new THREE.BufferAttribute(attrs[k].array, attrs[k].size));
    g.setIndex(nr * nc > 65000 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : new THREE.BufferAttribute(new Uint16Array(idx), 1)); g.computeVertexNormals();
    { const n = g.attributes.normal; let up = 0; for (let i = 0; i < n.count; i += 7) up += n.getY(i); if (up < 0) { const ia = g.index.array; for (let k = 0; k < ia.length; k += 3) { const t = ia[k + 1]; ia[k + 1] = ia[k + 2]; ia[k + 2] = t; } g.computeVertexNormals(); } }
    g.computeBoundingSphere(); return g;
  }
  // a ribbon along a polyline on the park ground (A1's ribbon rules: edges never more than 0.35 m under the centre)
  function strip(pts, w, o) {
    o = o || {}; const step = o.step || 1.5, lift = o.lift || 0, hf = o.hf || null, gf = o.ground || ground; const P = [];
    for (let i = 0; i < pts.length - 1; i++) { const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1]; const L = hyp(bx - ax, bz - az), n = Math.max(1, Math.round(L / step)); for (let k = 0; k < n; k++) P.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); }
    P.push(pts[pts.length - 1]); if (P.length < 2) return null;
    const rows = []; let dist = 0; const k = o.tile ? w / o.tile : 1;
    for (let i = 0; i < P.length; i++) { const p = P[i], q = P[Math.min(i + 1, P.length - 1)], r = P[Math.max(i - 1, 0)]; if (i) dist += hyp(p[0] - P[i - 1][0], p[1] - P[i - 1][1]); let dx = q[0] - r[0], dz = q[1] - r[1]; const L = hyp(dx, dz) || 1; dx /= L; dz /= L; const nx = -dz, nz = dx, hw = w / 2;
      const extra = hf ? hf(dist, p[0], p[1]) : 0; const bank = o.bank ? o.bank(dist) : 0;
      const hc = gf(p[0], p[1]); const lx = p[0] + nx * hw, lz = p[1] + nz * hw, rx = p[0] - nx * hw, rz = p[1] - nz * hw; const hl = o.flat ? hc : Math.max(gf(lx, lz), hc - 0.35), hr = o.flat ? hc : Math.max(gf(rx, rz), hc - 0.35);
      rows.push([[lx, hl + lift + extra + bank, lz, 0, dist / w * k], [rx, hr + lift + extra - bank, rz, k, dist / w * k]]); }
    const g = gridGeo(rows); if (o.walk !== false) walkAdd(g); return g;
  }
  // a swept section along samples [{x, y, z, tx, tz}]: section [[across, up], ...] closed; flat shaded faces
  function sweep(samples, sec, batch, mat) {
    let ar = 0; for (let i = 0; i < sec.length; i++) { const p = sec[i], q = sec[(i + 1) % sec.length]; ar += p[0] * q[1] - q[0] * p[1]; } if (ar < 0) sec = sec.slice().reverse();
    const pos = [], idx = [], uv = []; const ns = sec.length; let L = 0;
    for (let e = 0; e < ns; e++) { const a = sec[e], b = sec[(e + 1) % ns]; const base = pos.length / 3; L = 0;
      for (let i = 0; i < samples.length; i++) { const s = samples[i]; if (i) L += hyp(s.x - samples[i - 1].x, s.z - samples[i - 1].z); const nx = -s.tz, nz = s.tx; for (const p of [a, b]) { pos.push(s.x + nx * p[0], s.y + p[1], s.z + nz * p[0]); uv.push(L / 1.5, p === a ? 0 : 0.3); } }
      for (let i = 0; i < samples.length - 1; i++) { const p0 = base + i * 2, p1 = p0 + 1, p2 = p0 + 2, p3 = p0 + 3; idx.push(p0, p2, p1, p1, p2, p3); } }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    // make the faces point away from the section centre
    batch.geo(g, mat);
  }
  // flat walkable area on the ground (A1's polygonNow: clipped cells, walk grid)
  function area(poly, mat, lift, batch) { try { const m = polygonNow(poly, mat, lift); if (m && m.geometry) batch.geo(m.geometry, mat); } catch (e) { GP.errs.push("area " + e.message); } }
  // a walk grid surface without a mesh (bridge decks, stepping stones)
  function walkQuad(ax, ay, az, bx, by, bz, w) { const dx = bx - ax, dz = bz - az, L = hyp(dx, dz) || 1; const nx = -dz / L * w / 2, nz = dx / L * w / 2; const rows = []; const n = Math.max(2, Math.ceil(L / 0.5)); for (let i = 0; i <= n; i++) { const t = i / n; const x = ax + dx * t, z = az + dz * t, y = ay + (by - ay) * t; rows.push([[x + nx, y, z + nz], [x - nx, y, z - nz]]); } const g = gridGeo(rows); walkAdd(g); g.dispose(); }
  // text board
  function board(lines, w, h, opt) { const t = textTexture(lines, 1024, Math.round(1024 * h / w), opt || { bg: "#1f2a22", border: "#c9824f" }); const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide }); const g = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); g.userData.noInst = true; return g; }
  // instanced copies of a model's parts (animals, stones) that the park moves or places at exact heights
  function instOf(kind, n, cast) { const m = MODELS[kind]; if (!m || !n) return null; const list = m.parts.map((p) => { const im = new THREE.InstancedMesh(p.geometry, p.material, n); im.castShadow = cast !== false; im.receiveShadow = true; im.frustumCulled = false; im.userData.noInst = true; return im; }); return list; }
  function setInst(list, i, x, y, z, ry, s, rx, rz, sy) { if (!list) return; _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v.set(x, y, z), _q, _s.set(s, sy || s, s)); for (const im of list) im.setMatrixAt(i, _m4); }
  // a cheap procedural stone for the cobble bars, the creek edges and the grotto
  let STONE = null; function stoneGeo() { if (STONE) return STONE; const g = new THREE.IcosahedronGeometry(1, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 0.82 + 0.3 * Math.abs(Math.sin(x * 3.1 + y * 2.3 + z * 1.7)); p.setXYZ(i, x * k, y * k * 0.62, z * k); } g.computeVertexNormals(); STONE = g; return g; }

  // ═════════ zones: each part of the park is a group, hidden beyond range, animated only near the player ═════════
  function zone(name, x, z, r) { const old = GP.zones.find((q) => q.name === name); if (old) return old; const g = new THREE.Group(); g.name = "gp_" + name; g.userData.noCull = true; g.userData.gpZone = true; const zn = { name, g, x, z, r, b: new Batch(name) }; GP.zones.push(zn); return zn; }
  function finishZone(zn) { const n = zn.b.build(zn.g); scene.add(zn.g); return n; }

  // ═════════ world hook ═════════
  function worldHook() {
    const G = gpd(); if (!G || typeof PLAN_PIECES === "undefined") return;
    GP.creek = setupCreek(); GP.run = setupRun(GP.creek); GP.knoll = setupKnoll();
    // every Genesis Park ribbon is re-laid in defer on the park's own ground (bridges and stepping stones cut in)
    GP.pieces = []; for (let i = PLAN_PIECES.length - 1; i >= 0; i--) { const p = PLAN_PIECES[i]; if (p && p.id && /^gp_/.test(p.id)) { GP.pieces.push(p); PLAN_PIECES.splice(i, 1); } } GP.pieces.reverse();
    // the Overlook Spur (skipped in A1) is registered for scatter and wanderers; its deck is built here
    { const sp = promPts("gp_p_overlook"); if (sp) { ROADS.push({ pts: sp, w: 3, lift: 0, dirt: false, plan: "gp_p_overlook" }); PLAN_WALKS.push(sp); } }
    crossingsSetup();
    placePlanting(); placeProps(); keepouts(); addHotspots();
  }
  // bridges and the Riffle Stones: which ribbon, where, how long
  function crossingsSetup() {
    const X = [["gp_x_spring_bridge", "gp_p_loop", "bridge_trestle", 0.55], ["gp_x_confluence_bridge", "gp_p_cotton", "bridge_truss", 1.15], ["gp_x_splash_meadow_footbridge", "gp_p_splashx", "bridge_trestle", 0.36], ["gp_x_willow_bridge", "gp_p_boardwalk", "bridge_trestle", 0.42], ["gp_x_run_footbridge", "gp_p_loop", "bridge_trestle", 0.32], ["gp_x_riffle_stones", "gp_r_riffle", null, 0]];
    GP.cross = []; for (const [pid, line, kind, sy] of X) { const p = prop(pid); if (!p) continue; GP.cross.push({ id: pid, name: p.name, line, kind, sy, x: p.x, z: p.z, L: p.length_m + (kind ? 0 : 1), W: p.width_m, heading: p.heading_deg, stones: !kind }); }
  }
  // ───────── planting: the riparian gallery, deergrass and sacaton to the water's edge, the meadows ─────────
  const TREES = [];
  function treeSpotOK(x, z, r) {
    if (x > 24) return false; for (const t of TREES) if (hyp(t[0] - x, t[1] - z) < r + t[2]) return false;
    if (planNearRoad(x, z, 1.4 + r * 0.25)) return false; if (planNearCollider(x, z, 0.6)) return false;
    for (const c of GP.cross || []) if (hyp(c.x - x, c.z - z) < c.L / 2 + 3.5) return false;
    const K = GP.knoll; if (K && hyp(x - K.cx, z - K.cz) < K.rToe + 2) return false;
    for (const pid of ["gp_x_splash_terrace", "gp_x_sink", "gp_x_grotto"]) { const p = prop(pid); if (p && inPoly(p.poly, x, z)) return false; if (p && hyp(p.x - x, p.z - z) < 8) return false; }
    return true;
  }
  function putTree(kind, x, z, sc) { put(kind, x, z, rand() * 6.283, sc); const e = PLACE[kind][PLACE[kind].length - 1]; e.keep = true; e.gp = true; TREES.push([x, z, sc * (MODELS[kind] ? MODELS[kind].radius * 0.55 : 2)]); return e; }
  function putLow(kind, x, z, sc) { if (!has(kind)) return; put(kind, x, z, rand() * 6.283, sc); const e = PLACE[kind][PLACE[kind].length - 1]; e.keep = true; e.gp = true; }
  function placePlanting() {
    const C = GP.creek, R = GP.run; let nt = 0, ng = 0;
    const cot = pick(["cottonwood", "mesquite"]), wil = pick(["willow", "desertwillow"]), syc = pick(["sycamore", "ironwood", "mesquite"]), dw = pick(["desertwillow"]), mq = pick(["mesquite"]);
    const scaleOf = (k, want) => (k === "mesquite" ? want / 6 : k === "desertwillow" ? want / 6.5 : k === "ironwood" ? want / 8.5 : 1);   // stand-ins sized to the real tree
    // the gallery: clusters of 2 to 5 trees on alternating banks, species by reach
    if (C && cot) { let s = 6, side = 1;
      while (s < C.sEnd + 6) { const reach = s < C.sSteps ? "spring" : s < C.sSac0 ? "willow" : s < C.sSac1 ? "sacaton" : s < C.sConf + 10 ? "cotton" : s < C.sSink0 ? "lower" : "sink";
        const gap = reach === "sacaton" ? 30 : reach === "cotton" ? 13 : 17; if (rand() < 0.72) side = -side;
        const nC = reach === "sacaton" ? 1 + (rand() < 0.4 ? 1 : 0) : 2 + Math.floor(rand() * 3.2);
        const c0 = C.cen(s); const ww = C.ww(s);
        for (let k = 0; k < nC; k++) { const ds = (rand() - 0.5) * 9, off = ww + 3.2 + rand() * (reach === "cotton" ? 6 : 8); const p = at(C.path, s + ds), m = C.m(s + ds); const d = m + side * off; const x = p.x - p.tz * d + (rand() - 0.5) * 1.5, z = p.z + p.tx * d + (rand() - 0.5) * 1.5;
          const r = rand(); let kind, h;
          if (reach === "willow" || reach === "sacaton" || reach === "spring") { kind = r < 0.55 ? wil : r < 0.8 ? cot : syc; h = kind === wil ? 7.5 + rand() * 2.5 : 9.5 + rand() * 3; }
          else if (reach === "cotton") { kind = r < 0.7 ? cot : r < 0.88 ? syc : wil; h = kind === cot ? 11 + rand() * 3 : 8.5 + rand() * 2.5; }
          else if (reach === "lower") { kind = r < 0.5 ? cot : r < 0.75 ? syc : dw; h = kind === dw ? 5.5 + rand() * 1.5 : 9 + rand() * 3; }
          else { kind = r < 0.5 ? mq : dw; h = 5 + rand() * 2; }
          if (!kind) continue; const sc = scaleOf(kind, h); if (!treeSpotOK(x, z, 2.6)) continue; putTree(kind, x, z, sc); nt++; }
        s += gap * (0.7 + rand() * 0.6); } }
    // the Landing Run: desert willow along the rill, alternating banks
    if (R && dw) { let side = 1; for (let s = 10; s < R.path.L - 8; s += 11 + rand() * 6) { side = -side; const p = at(R.path, s); const d = R.m(s) + side * (R.ww(s) + 2.6 + rand() * 3); const x = p.x - p.tz * d, z = p.z + p.tx * d; if (treeSpotOK(x, z, 2.2)) { putTree(dw, x, z, scaleOf(dw, 5.5 + rand() * 1.5)); nt++; } } }
    // the Overlook Gate: a clump of three Fremont cottonwoods, tall enough to be seen from Arrivals Court
    { const cl = prop("gp_x_gate_cottonwoods"); if (cl && cot) for (const [dx, dz, h] of [[-3.5, 2.5, 14.5], [2.6, -2.2, 13.2], [3.4, 3.4, 12.2]]) { putTree(cot, cl.x + dx, cl.z + dz, scaleOf(cot, h)); nt++; } }
    // deergrass and big sacaton to the water's edge on every reach (not at the crossings, the cascades or the Splash Meadow)
    const g2 = has("bush2") ? "bush2" : null;
    if (C && g2) { for (let s = C.sLip + 1.5; s < C.sEnd - 1; s += 1.35 + rand() * 0.5) { const ww = C.ww(s); let skip = false; for (const c of GP.cross) { const q = proj(C.path, c.x, c.z); if (q && Math.abs(q.s - s) < c.L / 2 + 0.6) skip = true; } for (const c of C.casc) if (Math.abs(s - c.s) < c.len / 2 + 1.2) skip = true; if (skip) continue;
        for (const side of [-1, 1]) { if (side > 0 && s > C.sSplashBr - 8 && s < C.sEnd) continue; const p = at(C.path, s), m = C.m(s); const d = m + side * (ww + 0.3 + rand() * 0.9); putLow(g2, p.x - p.tz * d, p.z + p.tx * d, 0.4 + rand() * 0.3); ng++;
          if (rand() < 0.55) { const d2 = m + side * (ww + 1.5 + rand() * 1.6); const x2 = p.x - p.tz * d2, z2 = p.z + p.tx * d2; if (!planNearRoad(x2, z2, 0.6)) { putLow(g2, x2, z2, 0.55 + rand() * 0.35); ng++; } } } } }
    // the Sacaton Meadow: drip-watered bunchgrass, no sedges and no wet ground
    { const L = land("gp_l_sacaton_meadow"); if (L && g2) { const b = bbox(L.poly); for (let x = b[0]; x < b[1]; x += 2.5) for (let z = b[2]; z < b[3]; z += 2.5) { const px = x + rand() * 2.2, pz = z + rand() * 2.2; if (!inPoly(L.poly, px, pz)) continue; const q = proj(C.path, px, pz); if (q && Math.abs(q.d - C.m(q.s)) < C.ww(q.s) + 0.4) continue; if (planNearRoad(px, pz, 0.5)) continue; putLow(g2, px, pz, 0.55 + rand() * 0.4); ng++; } } }
    // milkweed and wildflowers: the Landing Run and the Butterfly Meadow
    if (R && g2) for (let s = 3; s < R.path.L - 3; s += 1.8 + rand()) { const p = at(R.path, s); for (const side of [-1, 1]) { if (rand() < 0.35) continue; const d = R.m(s) + side * (R.ww(s) + 0.35 + rand() * 1.2); const x = p.x - p.tz * d, z = p.z + p.tx * d; if (planNearRoad(x, z, 0.4)) continue; putLow(g2, x, z, 0.35 + rand() * 0.25); ng++; } }
    { const L = land("gp_l_butterfly_meadow"); if (L) { const b = bbox(L.poly); for (let i = 0; i < 70; i++) { const x = b[0] + rand() * (b[1] - b[0]), z = b[2] + rand() * (b[3] - b[2]); if (!inPoly(L.poly, x, z) || planNearRoad(x, z, 0.5)) continue; putLow(rand() < 0.6 ? g2 : "bush1", x, z, 0.3 + rand() * 0.3); ng++; } } }
    // the Hummingbird Garden round the Spring Terrace; agave and grasses
    { const q = window.PLAN.plazas.find((p) => p.id === "gp_pz_spring"); if (q) for (let i = 0; i < 26; i++) { const a = i / 26 * 6.283 + rand() * 0.2, r = q.r + 1.2 + rand() * 2.5; const x = q.x + Math.cos(a) * r, z = q.z + Math.sin(a) * r; if (planNearRoad(x, z, 0.6) || x > -97) continue; putLow(i % 3 === 0 && has("agave_cluster") ? "agave_cluster" : i % 3 === 1 ? "bush1" : g2, x, z, 0.45 + rand() * 0.3); ng++; } }
    // the Great Lawn's north tree row, kept and gap-filled (Arizona ash: desert willow and mesquite stand in)
    { const ash = pick(["ash", "desertwillow"]); if (ash) for (let x = -452; x <= -238; x += 11) { const z = -352 + (rand() - 0.5) * 1.2; if (planNearRoad(x, z, 1.5) || planNearCollider(x, z, 1.5)) continue; if (x > -372 && x < -318) continue; putTree(ash, x + (rand() - 0.5) * 2, z, scaleOf(ash, 7.5 + rand() * 1.5)); nt++; } }
    // the Heritage Orchard: rows of apple, pomegranate, fig and pecan (orchard stand-in: desert willow, kept small)
    { const o = place("gp_orchard"); const ok = pick(["orchard", "desertwillow"]); if (o && ok) for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) { const x = o.x - 9 + j * 4.6, z = o.z - 7 + i * 4.8; if (planNearRoad(x, z, 1) || planNearCollider(x, z, 1)) continue; putTree(ok, x, z, ok === "orchard" ? 1 : scaleOf(ok, 4.2 + rand() * 0.6)); nt++; } }
    { const K = GP.knoll; const f1 = has("bush1") ? "bush1" : null; if (K && f1) for (let i = 0; i < 150; i++) { const a = rand() * 6.283, r = 9.5 + Math.sqrt(rand()) * (K.rToe - 11); const x = K.cx + Math.cos(a) * r, z = K.cz + Math.sin(a) * r; const q = proj(K.path, x, z); if (q && Math.abs(q.d) < 2.6) continue; if (planNearRoad(x, z, 0.6)) continue; putLow(rand() < 0.55 ? f1 : g2 || f1, x, z, 0.28 + rand() * 0.22); ng++; } }
    // car park islands: shade trees
    for (const [x, z] of [[-356, -411], [-344, -411], [-323.5, -389], [-308.5, -389], [-379, -623], [-365, -623]]) if (mq) { putTree(mq, x, z, scaleOf(mq, 6.5 + rand())); nt++; }
    GP.stats.planting = { trees: nt, grasses: ng };
  }
  // ───────── model props placed through the engine (instanced) ─────────
  function placeProps() {
    const P = (id) => prop(id);
    { const p = P("gp_x_grotto"); if (p) { if (has("grotto")) { put("grotto", p.x, p.z + 0.6, 0, 1.08); const e = PLACE.grotto[PLACE.grotto.length - 1]; e.keep = true; e.gp = true; }
      else if (has("boulder")) for (const [dx, dz, sc] of [[0, -1.5, 1.0], [-3.2, -0.5, 0.75], [3.1, -0.8, 0.8], [-1.6, 1.2, 0.55], [1.9, 1.0, 0.5]]) { put("boulder", p.x + dx, p.z + dz, rand() * 6.283, sc); const e = PLACE.boulder[PLACE.boulder.length - 1]; e.keep = true; e.gp = true; } } }
    { const p = P("gp_x_little_hangar"); if (p && has("little_hangar")) { put("little_hangar", p.x, p.z, 0, 1.12); const e = PLACE.little_hangar[PLACE.little_hangar.length - 1]; e.keep = true; } else if (p) GP.procHangar = true; }
    { const p = P("gp_x_biplane"); if (p) { const yaw = yawOfBearing(p.heading_deg) - Math.PI / 2; if (has("biplane")) { put("biplane", p.x, p.z, yaw, 0.95); const e = PLACE.biplane[PLACE.biplane.length - 1]; e.keep = true; } else if (typeof planPut === "function") { const r = planPut("biplane", p.x, p.z, yaw, 1); if (r && r.e) r.e.keep = true; } } }
  }
  function keepouts() {
    const C = GP.creek, R = GP.run, K = GP.knoll;
    if (C) for (let s = 0; s < C.path.L; s += 12) { const p = at(C.path, s); KEEPOUT.push([p.x, p.z, 11]); }
    if (R) for (let s = 0; s < R.path.L; s += 12) { const p = at(R.path, s); KEEPOUT.push([p.x, p.z, 8]); }
    if (K) KEEPOUT.push([K.cx, K.cz, K.rToe + 2]);
    for (const id of ["gp_l_riding_arena", "gp_l_petting_yard", "gp_l_cattle_paddock", "gp_l_sheep_goat_and_pig_paddocks", "gp_l_north_horse_paddock", "gp_l_south_horse_paddock", "gp_l_tailwind_dog_park_yards", "gp_l_pump_track"]) { const L = land(id); if (L) planKeepout(L.poly); }
  }
  // ───────── hotspots (the partnership line on every one) ─────────
  function addHotspots() {
    const add = (x, z, r, t, p) => { const h = { x, z, r, t, k: LEGAL, p }; hotspots.push(h); GP.hs.push(h); };
    const C = GP.creek; const P = (id) => prop(id);
    { const p = P("gp_x_grandstand"); if (p) add(p.x, p.z + 2, 14, "Field 1 grandstand", "Three hundred shaded seats along the first-base line, with the scorers' booth and its snack window at the east end. Friday night lights come from six LED poles with full cut-off heads, off by 10 pm."); }
    { const p = P("gp_x_field2_bleachers_east"); if (p) add(p.x, p.z, 10, "Field 2 bleachers", "Little League on Saturday mornings. Field 2's outfield and Field 1's back onto each other across the tree-lined Fields Walk, and both fields are lit."); }
    { const p = P("gp_x_steps"); if (p) add(p.x, p.z, 7, "Spring Steps", "Genesis Creek drops over three low stacked-stone ledges just below the Spring Bridge. Moving, shallow water on its own filtered and UV-treated loop, running from 7 am until the 10 pm lantern dimming."); }
    { const p = P("gp_x_falls"); if (p) add(p.x, p.z, 8, "Cottonwood Falls", "The creek's biggest drop, a basalt pour-over in two steps just above the Confluence Bridge, lit warm white until the 10 pm dimming."); }
    { const p = P("gp_x_msteps"); if (p) add(p.x, p.z, 7, "Mesquite Steps", "A stepped rock chute into the riffles above the Splash Meadow. Water to watch and listen to, never deeper than 20 cm."); }
    { const p = P("gp_x_sink"); if (p) add(p.x, p.z, 7, "The Sink", "The end of Genesis Creek. The water fans out over a cobble bar and disappears into the ground, as desert streams do, and a collection gallery under the cobbles returns it to the covered cistern. Every night the creek drains away."); }
    { const p = P("gp_x_spring_bridge"); if (p) add(p.x, p.z, 7, "Spring Bridge", "A timber trestle carrying the Genesis Park Loop over the creek just below Genesis Spring."); }
    { const p = P("gp_x_confluence_bridge"); if (p) add(p.x, p.z, 9, "Confluence Bridge", "A riveted steel truss, a nod to the 1928 hangars, carrying the Cottonwood Walk over Genesis Creek between Cottonwood Falls and the Confluence."); }
    { const p = P("gp_x_willow_bridge"); if (p) add(p.x, p.z, 7, "Willow Bridge", "The Sacaton Boardwalk crosses the creek on a low timber bridge. The meadow is drip-watered bunchgrass, kept dry beside a working runway, with the story of the San Bernardino cienegas on its rail panels."); }
    { const p = P("gp_x_splash_meadow_footbridge"); if (p) add(p.x, p.z, 5, "Splash Meadow footbridge", "A low timber footbridge from the East Bank Walk over the creek to the Splash Meadow."); }
    { const p = P("gp_x_run_footbridge"); if (p) add(p.x, p.z, 5, "Run footbridge", "The Loop crosses the Landing Run, the narrow rill that carries the line of the Stage One Landing Wash down to the Confluence."); }
    { const p = P("gp_x_little_hangar"); if (p) add(p.x, p.z, 9, "The Little Hangar", "A bow-truss climbing frame with slides and a rope net: the Hangar Playground's little airfield, with the Little Runway balance-bike loop round it."); }
    { const p = P("gp_x_biplane"); if (p) add(p.x, p.z, 6, "Climb-aboard biplane", "The master plan's 1928 biplane, re-used as a climb-aboard for the Hangar Playground."); }
    { const f = window.PLAN.fountains.find((q) => q.id === "gp_f_windmill"); if (f) add(f.x, f.z, 5, "Windmill Trough", "The windpump spills into a slotted stone trough that never fills: the water runs through its grated floor to a drain, and stops when the wind drops."); }
    { const f = window.PLAN.fountains.find((q) => q.id === "gp_f_barnyard"); if (f) add(f.x, f.z, 4, "Barnyard Pump", "A cast-iron hand pump children work themselves, spilling down a timber flume to a grated drain."); }
    { const b = window.PLAN.buildings.find((q) => q.id === "gp_b14"); if (b) add(b.x + 7, b.z, 7, "Farm Stand", "Eggs, honey, mesquite flour and the Kitchen Garden's chiles, with feed cups for the goats. On Saturdays the farm market fills the Barnyard."); }
    { const q = window.PLAN.plazas.find((p) => p.id === "gp_pz_summit"); if (q) add(q.x, q.z, 8, "Overlook Summit", "Stone seats under shade sails, turned east-north-east toward the approach. Coin binoculars, an airband speaker and an arrivals board that shows the next jet in on Runway 21."); }
    { const cl = P("gp_x_gate_cottonwoods"); if (cl) add(cl.x - 6, cl.z + 6, 6, "Copper jet totem", "Three Fremont cottonwoods and a copper jet totem mark the Overlook Gate, tall enough to be seen over the Cart and Bike Hub roof from Arrivals Court."); }
  }

  // ═════════ defer (first): the ground patches, the walks, the bridge decks, lifting placements onto the patches ═════════
  function surfacesHook() {
    if (!GP.ready) return; const t0 = performance.now(); const MAT = mats();
    GP.gmat = GROUND_MATS[0];
    const root = new THREE.Group(); root.name = "gp_ground"; root.userData.noCull = true; GP.root = root;
    const tW = T.xmax - T.xmin, tD = T.zmax - T.zmin; const guv = (x, z) => [(x - T.xmin) / tW, 1 - (z - T.zmin) / tD];
    const patchMesh = (rows) => { for (const r of rows) for (const v of r) { const u = guv(v[0], v[2]); v[3] = u[0]; v[4] = u[1]; } const g = gridGeo(rows); walkAdd(g); const m = new THREE.Mesh(g, GP.gmat); m.receiveShadow = true; m.castShadow = false; m.userData.noInst = true; m.userData.gpPatch = true; root.add(m); return g.attributes.position.count; };
    let pv = 0;
    // the creek valley patch: cross-sections every 0.8 m (denser at the cascades), fine near the channel
    { const C = GP.creek; const P = C.path; const ss = []; for (let s = -16; s <= P.L + 2; s += 0.8) ss.push(s); for (const c of C.casc) for (let s = c.s - c.len / 2 - 0.6; s <= c.s + c.len / 2 + 0.6; s += 0.12) ss.push(s); ss.sort((a, b) => a - b);
      const offs = [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.5, 3.0, 3.6, 4.3, 5.2, 6.4, 8, 10, 12.5, 15.5, 19, 23, 28, 34, 41]; const O = []; for (let i = offs.length - 1; i > 0; i--) O.push(-offs[i]); for (const o of offs) O.push(o);
      const rows = []; for (const s of ss) { const p = at(P, Math.min(P.L, Math.max(0, s))), pe = at(P, s); const m = s >= 0 && s <= C.sEnd ? C.m(s) : 0; const lim = Math.max(17, Math.max(C.fpW(s), C.fpE(s)) + C.sw(Math.max(0, Math.min(P.L, s))) + 1);
        const row = []; for (const o of O) { const d = clamp(m + o, -lim, lim); const x = pe.x - pe.tz * d, z = pe.z + pe.tx * d; row.push([x, surf(x, z) + PATCH_LIFT, z]); } rows.push(row); }
      pv += patchMesh(rows); }
    // the Landing Run's swale
    if (GP.run) { const R = GP.run, P = R.path; const rows = []; const offs = [0, 0.3, 0.6, 0.9, 1.3, 1.8, 2.4, 3.2, 4.2, 5.5, 7, 9, 11.5, 14, 17]; const O = []; for (let i = offs.length - 1; i > 0; i--) O.push(-offs[i]); for (const o of offs) O.push(o);
      for (let s = -4; s <= P.L + 1; s += 0.8) { const pe = at(P, s); const m = s >= 0 && s <= P.L ? R.m(s) : 0; const row = []; for (const o of O) { const d = m + o; const x = pe.x - pe.tz * d, z = pe.z + pe.tx * d; row.push([x, surf(x, z) + PATCH_LIFT, z]); } rows.push(row); } pv += patchMesh(rows); }
    // the knoll: a polar patch, 0.9 m rings
    if (GP.knoll) { const K = GP.knoll; const rows = []; const NA = 180; const rs = []; for (let r = 0; r <= K.rPatch; r += r < 4 ? 1 : 0.9) rs.push(r); rs.push(K.rPatch);
      for (const r of rs) { const row = []; for (let a = 0; a <= NA; a++) { const t = a / NA * Math.PI * 2; const x = K.cx + Math.cos(t) * r, z = K.cz + Math.sin(t) * r; row.push([x, surf(x, z) + PATCH_LIFT, z]); } rows.push(row); } pv += patchMesh(rows); }
    scene.add(root);
    // re-lay the Genesis Park walks on the park ground, with the crossings cut out
    const wb = new Batch("walks"); let nw = 0;
    for (const p of GP.pieces || []) { const cuts = []; for (const c of GP.cross) if (c.line === p.id) { const r = cutAt(p.pts, c.x, c.z, c.L / 2 - (c.stones ? -0.5 : 0.3)); if (r) { cuts.push(r); c.ends = c.ends || []; c.ends.push(r); c.lift = p.id === "gp_p_boardwalk" ? 0.55 : p.lift; c.w = p.w; } }
      const lift = p.id === "gp_p_boardwalk" ? 0.55 : p.id === "gp_p_bandshellwalk" ? 0.1 : p.lift; const mat = p.mat === M.dirt || p.mat === M.track ? edgeMat(p.mat) : p.mat;
      if (lift !== p.lift) { for (const rr of ROADS) if (rr.plan === p.id && Math.abs(rr.w - p.w) < 0.01 && rr.lift === p.lift) rr.lift = lift; if (typeof ROADGRID !== "undefined") ROADGRID.map = null; }   // the registered ribbon lift follows the re-laid walk (roadLiftAt, so nobody floats over the Bandshell Walk)
      for (const seg of splitLine(p.pts, cuts)) { if (polyLen(seg) < 0.3) continue; const g = strip(seg, p.w, { lift, tile: p.tile, step: 1.4 }); if (g) { wb.geo(g, mat); nw++; } } }
    // the Overlook Spur: level across, 1 in 26 up the knoll
    if (GP.knoll) spurDeck(wb);
    const walks = new THREE.Group(); walks.name = "gp_walks"; walks.userData.noCull = true; wb.build(walks, { cast: false }); for (const m of walks.children) m.castShadow = false; scene.add(walks);
    // bridge decks and the Riffle Stones in the walk grid
    for (const c of GP.cross) crossingDeck(c);
    // lift the engine's instances (trees, lamps, grasses) and drop bollards that would sink into the patches
    let fixed = 0; for (const S of INSTSET) { const m = MODELS[S.kind]; const sink = m ? m.sink || 0 : 0; for (let i = 0; i < S.list.length; i++) { const e = S.list[i]; if (!inPatch(e[0], e[2])) continue; const y = surf(e[0], e[2]) + PATCH_LIFT; if (Math.abs(y - e[1]) < 0.03) continue; e[1] = y; S.mats[i * 16 + 13] = y - sink; fixed++; } }
    const n0 = SOLAR.pts.length; const bsw = promPts("gp_p_bandshellwalk"); SOLAR.pts = SOLAR.pts.filter((q) => { if (bsw && lineDist(bsw, q[0], q[1]) < 4.5) return false; if (!inPatch(q[0], q[1])) return true; return Math.abs(surf(q[0], q[1]) + PATCH_LIFT - getH(q[0], q[1])) < 0.08; });
    if (fixed) updateCulling(true);
    GP.stats.surfaces = { patchVerts: pv, walks: nw, lifted: fixed, bollardsDropped: n0 - SOLAR.pts.length, ms: Math.round(performance.now() - t0) };
  }
  // the arc length of the nearest point on a polyline to (x, z), and the cut [s - h, s + h] with its two end points
  function cutAt(pts, x, z, h) { let best = 1e9, bs = 0, acc = 0; for (let i = 0; i < pts.length - 1; i++) { const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1]; const L = hyp(bx - ax, bz - az); if (L < 1e-6) continue; const t = clamp(((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (L * L), 0, 1); const d = hyp(x - ax - (bx - ax) * t, z - az - (bz - az) * t); if (d < best) { best = d; bs = acc + L * t; } acc += L; } if (best > 8) return null; return { a: bs - h, b: bs + h, pa: pointAt(pts, bs - h), pb: pointAt(pts, bs + h) }; }
  function pointAt(pts, s) { let acc = 0; for (let i = 0; i < pts.length - 1; i++) { const L = hyp(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); if (acc + L >= s) { const t = clamp((s - acc) / (L || 1), 0, 1); return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; } acc += L; } return pts[pts.length - 1].slice(); }
  function splitLine(pts, cuts) { if (!cuts.length) return [pts]; const out = []; let cur = []; let acc = 0; const inCut = (s) => cuts.some((c) => s > c.a && s < c.b);
    const push = (p) => { if (!cur.length || hyp(cur[cur.length - 1][0] - p[0], cur[cur.length - 1][1] - p[1]) > 1e-4) cur.push(p); };
    if (!inCut(0)) push(pts[0].slice());
    for (let i = 0; i < pts.length - 1; i++) { const L = hyp(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); const ev = []; for (const c of cuts) { if (c.a > acc && c.a < acc + L) ev.push([c.a, 0]); if (c.b > acc && c.b < acc + L) ev.push([c.b, 1]); } ev.sort((a, b) => a[0] - b[0]);
      for (const [s, kind] of ev) { const p = pointAt(pts, s); if (kind === 0) { push(p); if (cur.length > 1) out.push(cur); cur = []; } else { cur = [p]; } }
      acc += L; if (!inCut(acc)) push(pts[i + 1].slice()); }
    if (cur.length > 1) out.push(cur); return out; }
  // the Overlook Spur deck: its own ribbon, flat across, on the bench the terrain hook cut
  function spurDeck(wb) {
    const K = GP.knoll; const P = K.path; const rows = []; const k = 3 / 3; let dist = 0; GP.spurSamples = [];
    for (let s = 0; s <= K.L2 + 0.01; s += 0.7) { const p = at(P, s); const ry = K.rampY(s); const y = ry === null ? ground(p.x, p.z) + 0.26 : lerp(ground(p.x, p.z) + 0.26, ry + PATCH_LIFT + 0.12, sstep(K.L1 - 3, K.L1 + 2, s)); const nx = -p.tz * 1.5, nz = p.tx * 1.5; rows.push([[p.x + nx, y, p.z + nz, 0, dist / 3 * k], [p.x - nx, y, p.z - nz, k, dist / 3 * k]]); GP.spurSamples.push({ x: p.x, y, z: p.z, tx: p.tx, tz: p.tz, s }); dist += 0.7; }
    const g = gridGeo(rows); walkAdd(g); wb.geo(g, planMats().dg);
  }
  // a bridge deck (or the stepping-stone line) in the walk grid, plus rail solids
  function crossingDeck(c) {
    if (!c.ends || !c.ends.length) return; const e = c.ends[0]; const lift = c.lift || 0.3;
    const ya = ground(e.pa[0], e.pa[1]) + lift, yb = ground(e.pb[0], e.pb[1]) + lift; c.ya = ya; c.yb = yb;
    if (c.stones) { stoneDeck(c); return; }
    const w = Math.max(2.4, c.W - 0.2); walkQuad(e.pa[0], ya, e.pa[1], e.pb[0], yb, e.pb[1], w);
    const dx = e.pb[0] - e.pa[0], dz = e.pb[1] - e.pa[1], L = hyp(dx, dz) || 1; const ry = Math.atan2(dx, dz); const nx = -dz / L, nz = dx / L; const cx = (e.pa[0] + e.pb[0]) / 2, cz = (e.pa[1] + e.pb[1]) / 2, cy = (ya + yb) / 2;
    for (const sd of [-1, 1]) addSolid(cx + nx * sd * (w / 2 + 0.08), cz + nz * sd * (w / 2 + 0.08), ry, 0.16, L + 0.4, cy - 0.1, cy + 1.1, "world");
  }
  function stoneDeck(c) {
    const C = GP.creek; const e = c.ends[0]; const dx = e.pb[0] - e.pa[0], dz = e.pb[1] - e.pa[1], L = hyp(dx, dz) || 1; const n = Math.round(L / 1.4); c.stoneList = [];
    for (let i = 0; i <= n; i++) { const t = i / n; const x = e.pa[0] + dx * t + (rand() - 0.5) * 0.25, z = e.pa[1] + dz * t + (rand() - 0.5) * 0.25; const q = proj(C.path, x, z); const wl = q ? C.W(q.s) : ground(x, z); const top = Math.max(wl + 0.12, ground(x, z) + 0.08); c.stoneList.push([x, top, z, Math.atan2(dx, dz) + (rand() - 0.5) * 0.5]); }
    // one continuous walk surface along the stone tops, so you step across dry-shod
    for (let i = 0; i < c.stoneList.length - 1; i++) { const a = c.stoneList[i], b = c.stoneList[i + 1]; walkQuad(a[0], a[1], a[2], b[0], b[1], b[2], 1.0); }
  }

  // ═════════ defer (second): the park itself ═════════
  function dressHook() {
    if (!GP.ready) return; const t0 = performance.now(); const tm = {};
    const step = (name, fn) => { const t = performance.now(); try { fn(); } catch (e) { GP.errs.push(name + ": " + (e && e.message)); console.error("plan_park " + name + " failed:", (e && e.stack) || e); } tm[name] = Math.round(performance.now() - t); };
    step("water", buildWater); step("bridges", buildBridges); step("fields", buildFields); step("lawn", buildLawn); step("carparks", buildCarParks); step("dogpark", buildDogPark);
    step("farm", buildFarm); step("stables", buildStables); step("green", buildGreen); step("knoll", buildKnoll); step("loop", buildLoop); step("animals", buildAnimals);
    step("merge", () => mergeWater(zone("creek", -104, -400, 190)));
    for (const zn of GP.zones) finishZone(zn);
    GP.built = true; GP.stats.dress = tm; GP.stats.dressMs = Math.round(performance.now() - t0);
    console.log("plan_park: Genesis Park built", JSON.stringify(GP.stats));
  }

  // ───────── Genesis Creek, the Landing Run, the Spring, the cascades, the Sink ─────────
  function buildWater() {
    const MAT = mats(); const C = GP.creek; const zn = zone("creek", -104, -400, 190); const b = zn.b;
    // the samples along the creek: every 0.45 m, plus both sides of every water-level knot (crisp steps)
    const ss = []; for (let s = C.sLip - 0.6; s <= C.sEnd; s += 0.45) ss.push(s); for (const k of C.knots) { if (k > C.sLip && k < C.sEnd) { ss.push(k - 0.015, k + 0.015); } } ss.sort((a, b2) => a - b2);
    const U = [-1, -0.7, -0.38, 0, 0.38, 0.7, 1];
    // water surface
    { const rows = [], fl = [], dr = []; for (const s of ss) { const c = C.cen(s); const ww = C.ww(s); const y = C.W(s); const foam = C.foam(s), sp = C.speed(s), fadeEnd = 1 - sstep(C.sEnd - 7, C.sEnd, s), fadeHead = sstep(C.sLip - 0.6, C.sLip + 0.4, s); let lit = 0; for (const cc of C.casc) if (cc.lit && Math.abs(s - cc.s) < 5) lit = 2;
        const row = []; for (const u of U) { const nx = -c.tz, nz = c.tx; row.push([c.x + nx * u * ww, y, c.z + nz * u * ww, 0, 0]); fl.push(u * ww, s, foam, sp); dr.push(c.tx, c.tz, (1 - Math.abs(u)) * fadeEnd * fadeHead, lit); } rows.push(row); }
      const g = gridGeo(rows, { aFlow: { array: new Float32Array(fl), size: 4 }, aDir: { array: new Float32Array(dr), size: 4 } }); const m = new THREE.Mesh(g, MAT.water); m.renderOrder = 3; m.receiveShadow = true; m.userData.noInst = true; zn.g.add(m); GP.water = [m]; }
    // the cobble bed under it (wet under the water, dry on the bars)
    { const rows = [], bed = []; const UB = [-1, -0.66, -0.33, 0, 0.33, 0.66, 1]; let dist = 0, prev = null;
      for (const s of ss) { const c = C.cen(s); const hw = (C.bw(s) + 0.75) * (s > C.sEnd - 3.5 ? Math.sqrt(Math.max(0.12, 1 - Math.pow((s - (C.sEnd - 3.5)) / 3.6, 2))) : 1); if (prev) dist += hyp(c.x - prev.x, c.z - prev.z); prev = c; const wl = C.W(s); const row = []; for (const u of UB) { const x = c.x - c.tz * u * hw, z = c.z + c.tx * u * hw; row.push([x, surf(x, z) + PATCH_LIFT + 0.025, z, u * hw / 1.6, dist / 1.6]); bed.push(u, wl); } rows.push(row); }
      // the dry wash below the Sink: sand and gravel, no water
      const g = gridGeo(rows, { aBed: { array: new Float32Array(bed), size: 2 } }); const m = new THREE.Mesh(g, MAT.cobble); m.receiveShadow = true; m.userData.noInst = true; zn.g.add(m); }
    // the spring: water wells up in the basin in front of the grotto and spills over a stone lip
    { const rows = [], fl = [], dr = []; const cx = C.B0[0], cz = C.B0[1], y = C.W0; for (let ri = 0; ri <= 6; ri++) { const r = ri / 6 * C.BR; const row = []; for (let a = 0; a <= 28; a++) { const t = a / 28 * 6.283; const x = cx + Math.cos(t) * r, z = cz + Math.sin(t) * r; row.push([x, y + 0.004, z]); fl.push(x - cx, z - cz, 0, 0); dr.push(1, 0, (1 - ri / 6) * 1.6 + 0.02, 1); } rows.push(row); }
      const g = gridGeo(rows, { aFlow: { array: new Float32Array(fl), size: 4 }, aDir: { array: new Float32Array(dr), size: 4 } }); const m = new THREE.Mesh(g, MAT.water); m.renderOrder = 3; m.userData.noInst = true; zn.g.add(m); GP.water.push(m);
      // a ring of flat stones round the basin, open on the south where it spills into the Spring Run
      for (let i = 0; i < 17; i++) { const t = i / 17 * 6.283; if (Math.abs(Math.atan2(Math.sin(t - Math.PI / 2), Math.cos(t - Math.PI / 2))) < 0.42) continue; const x = cx + Math.cos(t) * (C.BR + 0.35), z = cz + Math.sin(t) * (C.BR + 0.35); b.put(stoneGeo(), MAT.basalt, x, ground(x, z) + 0.1, z, t, 0.45 + rand() * 0.2, 0.5 + rand() * 0.15, 0.4 + rand() * 0.15); } }
    // the Landing Run: a 1 m rill, and its stone spout at the Run Spring
    if (GP.run) { const R = GP.run; const rows = [], fl = [], dr = []; const bedRows = [], bed = []; const U2 = [-1, -0.5, 0, 0.5, 1]; let dist = 0, prev = null;
      for (let s = 0.4; s <= R.path.L - 0.2; s += 0.45) { const c = R.cen(s); const ww = R.ww(s); const y = R.W(s); if (prev) dist += hyp(c.x - prev.x, c.z - prev.z); prev = c; const row = [], brow = [];
        for (const u of U2) { row.push([c.x - c.tz * u * ww, y, c.z + c.tx * u * ww]); fl.push(u * ww, s, 0.12 + 0.12 * Math.sin(s * 0.7), 0.85); dr.push(c.tx, c.tz, (1 - Math.abs(u)) * sstep(0.4, 1.4, s), 0); const hw = R.bw(s) + 0.5, x = c.x - c.tz * u * hw, z = c.z + c.tx * u * hw; brow.push([x, surf(x, z) + PATCH_LIFT + 0.02, z, u * hw / 1.6, dist / 1.6]); bed.push(u, y); }
        rows.push(row); bedRows.push(brow); }
      const g = gridGeo(rows, { aFlow: { array: new Float32Array(fl), size: 4 }, aDir: { array: new Float32Array(dr), size: 4 } }); const m = new THREE.Mesh(g, MAT.water); m.renderOrder = 3; m.userData.noInst = true; zn.g.add(m); GP.water.push(m);
      const gb = gridGeo(bedRows, { aBed: { array: new Float32Array(bed), size: 2 } }); const mb = new THREE.Mesh(gb, MAT.cobble); mb.receiveShadow = true; mb.userData.noInst = true; zn.g.add(mb);
      // the Run Spring spout: a stone block with a lip, the water pours into the rill
      const p0 = at(R.path, 0); const gy = ground(p0.x, p0.z); const yaw = Math.atan2(p0.tx, p0.tz); b.box(1.2, 0.9, 1.0, MAT.stone, p0.x - p0.tx * 0.9, gy + 0.3, p0.z - p0.tz * 0.9, yaw); b.box(0.28, 0.1, 0.5, MAT.stone, p0.x - p0.tx * 0.25, gy + 0.62, p0.z - p0.tz * 0.25, yaw);
      GP.runSpout = [p0.x - p0.tx * 0.15, gy + 0.58, p0.z - p0.tz * 0.15, R.W(0.6)]; }
    // stones: the creek edges and riffles, the Sink's cobble bar, the grotto skirt (one instanced mesh)
    const st = []; const addSt = (x, y, z, s, sy) => st.push([x, y, z, s, sy || s * 0.62, rand() * 6.283]);
    for (let s = C.sLip + 1; s < C.sEnd; s += 0.7) { const c = C.cen(s), ww = C.ww(s); for (const side of [-1, 1]) { if (rand() > 0.42) continue; const u = side * (ww + (rand() - 0.3) * 0.5); const x = c.x - c.tz * u, z = c.z + c.tx * u; const sc = 0.12 + rand() * rand() * 0.34; addSt(x, surf(x, z) + PATCH_LIFT, z, sc); }
      const rf = C.foam(s); if (rf > 0.2 && rf < 0.9 && rand() < 0.35) { const u = (rand() - 0.5) * ww * 1.4; const x = c.x - c.tz * u, z = c.z + c.tx * u; addSt(x, C.W(s) - 0.12, z, 0.14 + rand() * 0.14); } }
    { const sk = prop("gp_x_sink"); for (let i = 0; i < 170; i++) { const s = C.sSink0 + rand() * (C.sEnd - C.sSink0 + 3), c = C.cen(s); const u = (rand() * 2 - 1) * (C.ww(s) + 0.6); const x = c.x - c.tz * u, z = c.z + c.tx * u; addSt(x, surf(x, z) + PATCH_LIFT - 0.02, z, 0.1 + rand() * 0.22); } }
    for (let i = 0; i < 26; i++) { const t = Math.PI + rand() * Math.PI, r = C.BR + 1.2 + rand() * 3.5; const x = C.B0[0] + Math.cos(t) * r * 1.3, z = C.B0[1] + Math.sin(t) * r * 0.8 - 1.5; addSt(x, ground(x, z), z, 0.35 + rand() * 0.55, 0.3 + rand() * 0.35); }
    // the cascade ledges: rows of flat-topped creek rock across the channel, boulders framing each side
    const ledges = [], bould = [];
    for (const cc of C.casc) { const a = cc.s - cc.len / 2; for (let j = 0; j < cc.n; j++) { const s0 = a + (j + 0.5) * cc.len / cc.n; const top = C.W(s0 - 0.08) - 0.025; const c = C.cen(s0); const span = C.bw(s0) * 2 + 1.1; let u = -span / 2; const yaw = Math.atan2(c.tx, c.tz);
        while (u < span / 2 - 0.2) { const w = Math.min(span / 2 - u, 0.7 + rand() * 0.7); const uc = u + w / 2; const dep = 0.55 + rand() * 0.35; const x = c.x - c.tz * uc - c.tx * (dep / 2 - 0.05), z = c.z + c.tx * uc - c.tz * (dep / 2 - 0.05); ledges.push([x, top - rand() * 0.03, z, yaw + (rand() - 0.5) * 0.12, w, dep]); u += w + 0.02; } }
      for (const side of [-1, 1]) for (let k = 0; k < 3; k++) { const s0 = cc.s + (k - 1) * 1.5; const c = C.cen(s0); const u = side * (C.bw(s0) + 0.7 + rand() * 0.8); const x = c.x - c.tz * u, z = c.z + c.tx * u; bould.push([x, ground(x, z) - 0.15, z, rand() * 6.283, 0.55 + rand() * 0.45]); } }
    GP.stones = st.length;
    { const im = new THREE.InstancedMesh(stoneGeo(), MAT.stone, st.length); im.castShadow = true; im.receiveShadow = true; im.userData.noInst = true; let i = 0;
      for (const q of st) { _e.set(0, q[5], 0); _q.setFromEuler(_e); _m4.compose(_v.set(q[0], q[1], q[2]), _q, _s.set(q[3] * (0.8 + rand() * 0.5), q[4], q[3])); im.setMatrixAt(i++, _m4); }
      im.count = i; im.computeBoundingSphere(); zn.g.add(im); }
    for (const q of ledges) b.box(q[4], 0.3, q[5], MAT.basalt, q[0], q[1] - 0.15, q[2], q[3], (rand() - 0.5) * 0.06, (rand() - 0.5) * 0.06);
    for (const q of bould) b.put(stoneGeo(), MAT.basalt, q[0], q[1] + q[4] * 0.3, q[2], q[3], q[4] * (1 + rand() * 0.4), q[4] * 0.75, q[4]);
    // spray at the falls (only near the player, only while the creek runs)
    { const cc = C.casc[1]; const c = C.cen(cc.s + cc.len / 2 + 0.2); const pts = sprayPoints(90, () => ({ p: [(rand() - 0.5) * 2.2, 0.05, (rand() - 0.5) * 0.8], v: 0.9 + rand() * 0.8, spread: 0.9, life: 0.7 + rand() * 0.5 })); pts.position.set(c.x, C.W(cc.s + cc.len / 2 + 0.3), c.z); pts.rotation.y = Math.atan2(c.tx, c.tz); zn.g.add(pts); GP.anim.push({ kind: "spray", o: pts, x: c.x, z: c.z, water: true }); GP.fallsAt = [c.x, c.z]; }
    // the Sink's warm-lit falls glow at dusk: a soft additive pool on the water
    { const cc = C.casc[1]; const c = C.cen(cc.s); const glow = new THREE.Mesh(new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })); glow.position.set(c.x, C.W(cc.s) + 0.05, c.z); glow.renderOrder = 4; zn.g.add(glow); GP.lights.falls = glow.material; }
    // the Overlook Gate Runnel: a copper-lined runnel pointing north to the creek
    { const f = window.PLAN.fountains.find((q) => q.id === "gp_f_overlookgate"); if (f) { const y = ground(f.x, f.z); const L = 7; const z0 = f.z + L / 2, z1 = f.z - L / 2; b.box(0.5, 0.12, L, MAT.copper, f.x, y + 0.06, f.z, 0); b.box(0.08, 0.16, L, MAT.copper, f.x - 0.22, y + 0.1, f.z, 0); b.box(0.08, 0.16, L, MAT.copper, f.x + 0.22, y + 0.1, f.z, 0);
      const rows = [], fl = [], dr = []; for (let i = 0; i <= 14; i++) { const z = z0 + (z1 - z0) * i / 14; rows.push([[f.x - 0.16, y + 0.135, z], [f.x, y + 0.135, z], [f.x + 0.16, y + 0.135, z]]); for (const u of [-1, 0, 1]) { fl.push(u * 0.16, i / 2, 0.05, 0.4); dr.push(0, -1, 1 - Math.abs(u) * 0.7, 0); } } const g = gridGeo(rows, { aFlow: { array: new Float32Array(fl), size: 4 }, aDir: { array: new Float32Array(dr), size: 4 } }); const m = new THREE.Mesh(g, MAT.water); m.renderOrder = 3; zn.g.add(m); GP.water.push(m); } }
    // the Splash Meadow terrace: a flat stone terrace beside the creek, ground jets and a play stream, on its own circuit
    buildSplashTerrace(zn);
  }
  let GLOW = null; function glowTex() { if (GLOW) return GLOW; GLOW = canvasTex(128, (g, S) => { const gr = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2); gr.addColorStop(0, "rgba(255,226,170,0.9)"); gr.addColorStop(0.45, "rgba(255,210,140,0.32)"); gr.addColorStop(1, "rgba(255,200,130,0)"); g.fillStyle = gr; g.fillRect(0, 0, S, S); }); GLOW.wrapS = GLOW.wrapT = THREE.ClampToEdgeWrapping; return GLOW; }
  function buildSplashTerrace(zn) {
    const MAT = mats(); const p = prop("gp_x_splash_terrace"); if (!p) return; const b = zn.b; const bb = bbox(p.poly); let top = -1e9; for (const [x, z] of [[bb[0], bb[2]], [bb[1], bb[2]], [bb[0], bb[3]], [bb[1], bb[3]], [p.x, p.z]]) top = Math.max(top, ground(x, z)); top += 0.18;
    const w = bb[1] - bb[0], d = bb[3] - bb[2]; let lo = 1e9; for (const [x, z] of [[bb[0], bb[2]], [bb[1], bb[2]], [bb[0], bb[3]], [bb[1], bb[3]]]) lo = Math.min(lo, ground(x, z));
    b.box(w, top - lo + 0.3, d, MAT.flag, p.x, (top + lo - 0.3) / 2, p.z, 0); walkQuad(p.x, top, bb[2] + 0.2, p.x, top, bb[3] - 0.2, w - 0.2);
    addSolid(p.x, p.z, 0, w, d, lo - 0.3, top, "world");
    // play stream across the terrace: hand pump at the north end, sluice gates, a grate at the south end
    const rows = [], fl = [], dr = []; const x0 = p.x + 2.8; for (let i = 0; i <= 20; i++) { const z = bb[2] + 1.2 + (d - 2.4) * i / 20; const xx = x0 + Math.sin(i * 0.6) * 0.5; rows.push([[xx - 0.22, top + 0.012, z], [xx, top + 0.012, z], [xx + 0.22, top + 0.012, z]]); for (const u of [-1, 0, 1]) { fl.push(u * 0.22, i, 0.1, 0.5); dr.push(0, 1, 1 - Math.abs(u) * 0.8, 0); } }
    const g = gridGeo(rows, { aFlow: { array: new Float32Array(fl), size: 4 }, aDir: { array: new Float32Array(dr), size: 4 } }); const m = new THREE.Mesh(g, MAT.water); m.renderOrder = 3; zn.g.add(m); GP.water.push(m); GP.splashWater = m;
    for (const zz of [bb[2] + 1.0, p.z - 1]) { b.cyl(0.07, 0.09, 1.0, 8, MAT.dark, x0, top + 0.5, zz); b.box(0.5, 0.06, 0.08, MAT.dark, x0 + 0.2, top + 0.95, zz, 0.3); }
    for (let k = 0; k < 3; k++) b.box(0.55, 0.28, 0.05, MAT.woodDark, x0 + Math.sin((4 + k * 6) * 0.6) * 0.5, top + 0.14, bb[2] + 1.2 + (d - 2.4) * (4 + k * 6) / 20, 0);
    // stepping stones set in the terrace, ground jets between them
    for (let k = 0; k < 6; k++) b.cyl(0.36, 0.38, 0.08, 14, MAT.basalt, p.x - 2.5 + (k % 2) * 1.3, top + 0.04, bb[2] + 2 + k * 3.2);
    const jets = []; for (let k = 0; k < 9; k++) jets.push([p.x - 3.2 + (k % 3) * 1.6, bb[2] + 3.5 + Math.floor(k / 3) * 5.5]);
    const pts = sprayPoints(jets.length * 26, (i) => { const j = jets[Math.floor(i / 26)]; return { p: [j[0] - p.x, 0.02, j[1] - p.z], v: 2.6 + rand() * 1.4, spread: 0.08, life: 1.0 + rand() * 0.3 }; }); pts.position.set(p.x, top, p.z); zn.g.add(pts); GP.anim.push({ kind: "spray", o: pts, x: p.x, z: p.z, splash: true });
    // a low planted bank between the terrace and the creek
    for (let k = 0; k < 8; k++) { const zz = bb[2] + 1 + k * (d - 2) / 7; putLate("bush2", bb[1] + 1.1, zz, 0.5); }
  }
  const LATE = []; function putLate(kind, x, z, sc) { LATE.push([kind, x, z, sc]); }   // low plants that need an instanced mesh after buildInstances: drawn with the stones' mesh
  // ───────── the bridges and the Riffle Stones ─────────
  function buildBridges() {
    const MAT = mats(); const zn = zone("creek", -104, -400, 190); const b = zn.b;
    const stones = [];
    for (const c of GP.cross) { if (!c.ends || !c.ends.length) continue; const e = c.ends[0]; const dx = e.pb[0] - e.pa[0], dz = e.pb[1] - e.pa[1], L = hyp(dx, dz) || 1; const yaw = Math.atan2(dx, dz); const cx = (e.pa[0] + e.pb[0]) / 2, cz = (e.pa[1] + e.pb[1]) / 2, cy = (c.ya + c.yb) / 2; const pitch = -Math.atan2(c.yb - c.ya, L);
      if (c.stones) { for (const s of c.stoneList) stones.push(s); continue; }
      const kind = has(c.kind) ? c.kind : null; const info = (window.PLAN_MODEL_INFO || {})[c.kind] || {}; const deck = info.deck || (c.kind === "bridge_truss" ? 1.71 : 3.14);
      if (kind) { const m = MODELS[kind]; const g = makeModel(kind); const sx = Math.max(c.W, 2.4) / m.sx, sz = (L + 0.6) / m.sz, sy = c.sy; g.scale.set(sx, sy, sz); g.rotation.order = "YXZ"; g.rotation.set(pitch, yaw, 0); g.position.set(cx, cy - 0.04 - deck * sy, cz); g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.noInst = true; } }); g.userData.noInst = true; zn.g.add(g); }
      else { // procedural timber deck on two beams, with rails
        const w = Math.max(c.W, 2.4); const nx = -dz / L, nz = dx / L; b.box(w, 0.14, L + 0.6, MAT.wood, cx, cy - 0.07, cz, yaw, pitch); for (const sd of [-1, 1]) { b.box(0.25, 0.4, L + 0.6, MAT.woodDark, cx + nx * sd * (w / 2 - 0.3), cy - 0.34, cz + nz * sd * (w / 2 - 0.3), yaw, pitch); b.box(0.1, 0.1, L + 0.6, MAT.woodDark, cx + nx * sd * (w / 2 - 0.05), cy + 1.0, cz + nz * sd * (w / 2 - 0.05), yaw, pitch); for (let k = 0; k <= Math.round(L / 2); k++) { const t = k / Math.round(L / 2) - 0.5; b.box(0.12, 1.05, 0.12, MAT.woodDark, cx + dx * t + nx * sd * (w / 2 - 0.05), lerp(c.ya, c.yb, t + 0.5) + 0.5, cz + dz * t + nz * sd * (w / 2 - 0.05), yaw); } } }
    }
    // the Riffle Stones: flat-topped basalt, 60 cm apart
    if (stones.length) { for (const s of stones) { b.put(new THREE.CylinderGeometry(0.42, 0.48, 0.34, 9), MAT.basalt, s[0], s[1] - 0.17, s[2], s[3], 1 + rand() * 0.25, 1, 0.85 + rand() * 0.2); b.put(stoneGeo(), MAT.basalt, s[0], s[1] - 0.3, s[2], s[3], 0.5, 0.3, 0.45); }
      for (const s of stones) addSolid(s[0], s[2], s[3], 0.75, 0.7, s[1] - 0.6, s[1], "world"); }
    // the Sacaton Boardwalk: fascia, posts on helical piers, a top rail
    { const pts = promPts("gp_p_boardwalk"); const piece = (GP.pieces || []).find((p) => p.id === "gp_p_boardwalk"); const c = GP.cross.find((q) => q.line === "gp_p_boardwalk"); if (pts && piece) { const cuts = c && c.ends ? c.ends : []; for (const seg of splitLine(pts, cuts)) { const w = piece.w; along(seg, 2.4, 0.2, (x, z, ux, uz) => { const y = ground(x, z) + 0.55; for (const sd of [-1, 1]) { const px = x - uz * sd * (w / 2 - 0.06), pz = z + ux * sd * (w / 2 - 0.06); b.box(0.1, 1.0, 0.1, MAT.woodDark, px, y + 0.5, pz, Math.atan2(ux, uz)); b.cyl(0.06, 0.06, 0.7, 6, MAT.steel, px, y - 0.4, pz); } });
        for (const sd of [-1, 1]) { const smp = []; const L = polyLen(seg); along(seg, 1.2, 0, (x, z, ux, uz) => smp.push({ x: x - uz * sd * (w / 2 - 0.06), y: ground(x, z) + 0.55, z: z + ux * sd * (w / 2 - 0.06), tx: ux, tz: uz })); const last = seg[seg.length - 1], pl2 = seg[seg.length - 2]; const lux = (last[0] - pl2[0]) / hyp(last[0] - pl2[0], last[1] - pl2[1]), luz = (last[1] - pl2[1]) / hyp(last[0] - pl2[0], last[1] - pl2[1]); smp.push({ x: last[0] - luz * sd * (w / 2 - 0.06), y: ground(last[0], last[1]) + 0.55, z: last[1] + lux * sd * (w / 2 - 0.06), tx: lux, tz: luz }); if (smp.length < 2 || L < 1) continue;
          sweep(smp, [[-0.05, 0.94], [0.05, 0.94], [0.05, 1.04], [-0.05, 1.04]], b, MAT.woodDark); sweep(smp, [[-0.03, -0.3], [0.03, -0.3], [0.03, 0.0], [-0.03, 0.0]], b, MAT.woodDark);
          for (let i = 0; i < smp.length - 1; i++) addSolid((smp[i].x + smp[i + 1].x) / 2, (smp[i].z + smp[i + 1].z) / 2, Math.atan2(smp[i + 1].x - smp[i].x, smp[i + 1].z - smp[i].z), 0.12, hyp(smp[i + 1].x - smp[i].x, smp[i + 1].z - smp[i].z) + 0.1, smp[i].y, smp[i].y + 1.05, "world"); } } } }
  }

  // ───────── Airport Park Fields: Field 1, Field 2, the North Meadow, the Pump Track ─────────
  function chainFence(b, pts, h, opt) {   // posts every 3 m, a top rail, chain-link fabric; solids along it
    const MAT = mats(); const o = opt || {}; const post = o.post || MAT.steel;
    for (let i = 0; i < pts.length - 1; i++) { const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1]; const L = hyp(bx - ax, bz - az); if (L < 0.2) continue; const n = Math.max(1, Math.ceil(L / 3)); const ya = getH(ax, az), yb = getH(bx, bz);
      const rows = []; for (let k = 0; k <= n; k++) { const t = k / n; const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = getH(x, z); rows.push([[x, y + 0.05, z, t * L / 0.3, 0], [x, y + h, z, t * L / 0.3, h / 0.3]]); if (k < n || i === pts.length - 2) { b.cyl(0.035, 0.035, h + 0.1, 6, post, x, y + (h + 0.1) / 2, z); if (o.caps) b.cyl(0.055, 0.045, 0.08, 8, MAT.copper, x, y + h + 0.12, z); } }
      const g = gridGeo(rows); b.geo(g, MAT.chain); b.pole(ax, ya + h, az, bx, yb + h, bz, 0.025, post, 6); if (o.wind) { const r2 = []; for (let k = 0; k <= n; k++) { const t = k / n; const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = getH(x, z); r2.push([[x, y + h - 0.02, z], [x, y + h - 0.02 - o.wind, z]]); } b.geo(gridGeo(r2), MAT.wind); }
      if (!o.noSolid) addSolid((ax + bx) / 2, (az + bz) / 2, Math.atan2(bx - ax, bz - az), 0.12, L, Math.min(ya, yb) - 0.2, Math.max(ya, yb) + h, "world"); }
  }
  function rails(b, pts, opt) {   // post-and-rail (timber) or pipe rail (galvanised); gaps: [[i, t0, t1]] not used; solids on each side
    const MAT = mats(); const o = opt || {}; const h = o.h || 1.3, nr = o.rails || 3, pipe = !!o.pipe, sp = o.spacing || 2.4; const pm = pipe ? MAT.steel : MAT.wood, rm = pipe ? MAT.steel : MAT.wood;
    for (let i = 0; i < pts.length - 1; i++) { const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1]; const L = hyp(bx - ax, bz - az); if (L < 0.3) continue; const n = Math.max(1, Math.round(L / sp)); const yaw = Math.atan2(bx - ax, bz - az);
      for (let k = 0; k <= n; k++) { if (k === n && i < pts.length - 2) continue; const t = k / n; const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = getH(x, z); if (pipe) b.cyl(0.05, 0.05, h + 0.05, 8, pm, x, y + h / 2, z); else b.box(0.14, h + 0.08, 0.14, pm, x, y + h / 2, z, yaw); }
      for (let r = 0; r < nr; r++) { const hh = h * (0.35 + 0.62 * (r + 1) / nr); for (let k = 0; k < n; k++) { const t0 = k / n, t1 = (k + 1) / n; const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1; const y0 = getH(x0, z0) + hh, y1 = getH(x1, z1) + hh; if (pipe) b.pole(x0, y0, z0, x1, y1, z1, 0.03, rm, 6); else b.beam(x0, y0, z0, x1, y1, z1, 0.06, 0.14, rm); } }
      if (!o.noSolid) { const ya = getH(ax, az), yb = getH(bx, bz); addSolid((ax + bx) / 2, (az + bz) / 2, yaw, 0.2, L, Math.min(ya, yb) - 0.2, Math.max(ya, yb) + h, "world"); } }
  }
  function poly2line(poly, closed) { const o = poly.map((q) => q.slice()); if (closed !== false) o.push(poly[0].slice()); return o; }
  function lightPole(b, x, z, h, aimX, aimZ, heads) {   // galvanised pole, a crossarm of LED heads aimed at the field (full cut-off, flat)
    const MAT = mats(); const y = getH(x, z); b.cyl(0.13, 0.24, h, 10, MAT.steel, x, y + h / 2, z); b.box(0.9, 0.9, 0.9, MAT.conc, x, y + 0.3, z);
    const yaw = Math.atan2(aimX - x, aimZ - z); const px = Math.cos(yaw), pz = -Math.sin(yaw); const fx = Math.sin(yaw), fz = Math.cos(yaw);
    b.box(3.6, 0.16, 0.16, MAT.steel, x + fx * 0.3, y + h - 0.2, z + fz * 0.3, yaw); const n = heads || 6;
    for (let k = 0; k < n; k++) { const row = k < n / 2 ? 0 : 1; const t = (k % (n / 2)) / (n / 2 - 1 || 1) - 0.5; const hx = x + px * t * 3.2 + fx * 0.6, hz = z + pz * t * 3.2 + fz * 0.6, hy = y + h - 0.2 - row * 0.75;
      b.box(0.62, 0.12, 0.5, MAT.dark, hx, hy + 0.08, hz, yaw, -0.28); b.box(0.56, 0.03, 0.44, MAT.led, hx, hy + 0.01, hz, yaw, -0.28); GP.ledHeads.push([hx, hy, hz]); }
    COLLIDERS.push([x, z, 0.5]); addSolid(x, z, 0, 0.5, 0.5, y, y + h, "world");
  }
  function buildFields() {
    const MAT = mats(); GP.ledHeads = [];
    const zn = zone("west", -390, -440, 240); const b = zn.b;
    { const mat = new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, color: 0xdfe8ff }); GP.fieldPool = mat; for (const [x, z, r] of [[-410, -485, 58], [-300, -472, 36]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2.4, r * 2.4).rotateX(-Math.PI / 2), mat); m.position.set(x, getH(x, z) + 0.2, z); m.renderOrder = 2; m.userData.noInst = true; zn.g.add(m); } }
    // Field 1: home plate in the south-west corner, the first-base line east, the third-base line north
    const f1 = land("gp_l_field_1_kept"); const home = [-447, -445]; const B = 27.43;
    if (f1) { area(f1.poly, MAT.turf1, 0.05, b);
      // the skinned infield: the dirt arc 29 m round the pitcher's plate, from foul line to foul line, and the mound
      const mound = [home[0] + 13, home[1] - 13]; const R0 = 29; const f1a = Math.asin(13 / R0), f2a = -Math.acos(-13 / R0);
      const arc = [[home[0] - 3, home[1] + 3]]; for (let i = 0; i <= 22; i++) { const a = f1a + (f2a - f1a) * i / 22; arc.push([mound[0] + Math.cos(a) * R0, mound[1] + Math.sin(a) * R0]); }
      area(arc, MAT.clay, 0.08, b);
      // the pitcher's mound, bases, home plate, the foul lines, batter's boxes
      { const y = getH(mound[0], mound[1]); const mg = new THREE.CylinderGeometry(1.2, 2.7, 0.25, 20); b.put(mg, MAT.clay, mound[0], y + 0.2, mound[1]); b.box(0.61, 0.03, 0.15, MAT.stripe, mound[0], y + 0.34, mound[1], Math.PI / 4); walkMound(mound[0], mound[1], y + 0.08, 2.7, 0.25); }
      for (const [bx2, bz2] of [[home[0] + B, home[1]], [home[0] + B, home[1] - B], [home[0], home[1] - B]]) b.box(0.4, 0.08, 0.4, MAT.stripe, bx2, getH(bx2, bz2) + 0.12, bz2, Math.PI / 4);
      b.box(0.43, 0.04, 0.43, MAT.stripe, home[0], getH(home[0], home[1]) + 0.1, home[1], Math.PI / 4);
      line(b, home[0], home[1], -354, home[1], 0.1, 0.08); line(b, home[0], home[1], home[0], -538, 0.1, 0.08);
      for (const sd of [-1, 1]) { const cx = home[0] + sd * 1.1 + 0.8, cz = home[1] - 0.8 + sd * 1.1; boxLines(b, cx, cz, 1.2, 1.8, Math.PI / 4); }
      // backstop behind home, low fences down the lines, the outfield fence with a windscreen, the foul poles
      const bs = []; for (let i = 0; i <= 10; i++) { const a = Math.PI / 2 + i / 10 * Math.PI / 2; bs.push([home[0] + Math.cos(a) * 12 + 1.5, home[1] + Math.sin(a) * 12 - 1.5]); } chainFence(b, bs, 6.5, { caps: true });
      chainFence(b, [[-436, -439.5], [-400, -439.5]], 1.2, {}); chainFence(b, [[-456.5, -452], [-456.5, -536]], 1.2, {});
      const of = [[-354, -445], [-354.5, -470], [-362, -494], [-386, -522], [-420, -537], [-447, -537.5]]; chainFence(b, of, 2.4, { wind: 1.2 });
      for (const [x, z] of [[-354, -445], [-447, -537.5]]) { const y = getH(x, z); b.cyl(0.09, 0.11, 9, 8, MAT.yellow, x, y + 4.5, z); }
      // dugouts: block walls, a roof slab, a bench, open to the field
      dugout(b, -452.5, -458, Math.PI / 2, 12); dugout(b, -430, -440.6, Math.PI, 11);
      // the 300-seat grandstand along the first-base line, shaded
      grandstand(b, prop("gp_x_grandstand"));
      // six LED poles, aimed at the middle of the field
      for (const [x, z] of [[-443, -427.5], [-376, -437.5], [-357.5, -500], [-461.5, -452], [-460, -505], [-404, -541.5]]) lightPole(b, x, z, 18, -405, -485, 8);
      // the batting cage ring of the scorers' booth: a menu board (no prices)
      { const bd = board([{ text: "SCORERS' BOOTH", size: 110, y: 0.38, color: "#f5f1e6" }, { text: "SNACK WINDOW · FIELD 1", size: 58, y: 0.72, color: "#d08a55", font: "'Space Grotesk', system-ui, sans-serif", weight: 600 }], 3.2, 0.9); bd.position.set(-392, getH(-392, -439.3) + 4.9, -439.4); bd.rotation.y = Math.PI; zn.g.add(bd); }
    }
    // Field 2 (Little League): home plate in the south-east corner, facing north-west; the North Meadow beyond its fence
    const f2 = land("gp_l_field_2_and_the_north_meadow");
    if (f2) { const h2 = [-276, -444]; const B2 = 18.29, R2 = 61;
      area(f2.poly, MAT.meadow, 0.04, b);
      const fair = [h2.slice()]; for (let i = 0; i <= 18; i++) { const a = i / 18 * Math.PI / 2; fair.push([h2[0] - Math.sin(a) * R2, h2[1] - Math.cos(a) * R2]); } area(fair, MAT.turf1, 0.06, b);
      const arc = [[h2[0] + 2, h2[1] + 2]]; for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI / 2; arc.push([h2[0] - Math.sin(a) * (B2 + 3.5), h2[1] - Math.cos(a) * (B2 + 3.5)]); } area(arc, MAT.clay, 0.08, b);
      const mound = [h2[0] - 9.9, h2[1] - 9.9]; { const y = getH(mound[0], mound[1]); b.put(new THREE.CylinderGeometry(0.9, 2.2, 0.2, 18), MAT.clay, mound[0], y + 0.18, mound[1]); walkMound(mound[0], mound[1], y + 0.08, 2.2, 0.2); }
      for (const [x, z] of [[h2[0], h2[1] - B2], [h2[0] - B2, h2[1] - B2], [h2[0] - B2, h2[1]]]) b.box(0.38, 0.08, 0.38, MAT.stripe, x, getH(x, z) + 0.12, z, Math.PI / 4);
      b.box(0.43, 0.04, 0.43, MAT.stripe, h2[0], getH(h2[0], h2[1]) + 0.1, h2[1], Math.PI / 4);
      line(b, h2[0], h2[1], h2[0], h2[1] - R2 + 0.5, 0.1, 0.08); line(b, h2[0], h2[1], h2[0] - R2 + 0.5, h2[1], 0.1, 0.08);
      const bs = []; for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2; bs.push([h2[0] + Math.sin(a) * 7, h2[1] + Math.cos(a) * 7]); } chainFence(b, bs, 5, { caps: true });
      const fence = []; for (let i = 0; i <= 14; i++) { const a = i / 14 * Math.PI / 2; fence.push([h2[0] - Math.sin(a) * R2, h2[1] - Math.cos(a) * R2]); } chainFence(b, fence, 1.3, { wind: 0.6 });
      bleachers(b, prop("gp_x_field2_bleachers_east"), -1); bleachers(b, prop("gp_x_field2_bleachers_south"), -1);
      for (const [x, z, ry] of [[-268.5, -480, -Math.PI / 2], [-312, -436.5, Math.PI]]) teamBench(b, x, z, ry);
      for (const [x, z] of [[-266.5, -488], [-338, -436.5], [-326, -500], [-296, -514]]) lightPole(b, x, z, 14, -300, -470, 4);
    }
    // the Pump Track: an asphalt loop of rollers and banked turns
    { const L = land("gp_l_pump_track"); if (L) { const bb = bbox(L.poly); const cx = (bb[0] + bb[1]) / 2, cz = (bb[2] + bb[3]) / 2, ax = (bb[1] - bb[0]) / 2 - 3.5, az = (bb[3] - bb[2]) / 2 - 3; const pts = []; for (let i = 0; i <= 64; i++) { const a = i / 64 * 6.283; const c = Math.cos(a), s = Math.sin(a); pts.push([cx + Math.sign(c) * Math.pow(Math.abs(c), 0.6) * ax, cz + Math.sign(s) * Math.pow(Math.abs(s), 0.6) * az]); }
      const len = polyLen(pts); const g = strip(pts, 2.6, { lift: 0.12, step: 0.6, ground: getH, hf: (d) => 0.38 * Math.pow(Math.sin(d / len * Math.PI * 22), 2) * (1 - 0.8 * Math.pow(Math.abs(Math.cos(d / len * Math.PI * 2)), 6)), bank: (d) => 0.32 * Math.pow(Math.abs(Math.cos(d / len * Math.PI * 2)), 4) }); if (g) b.geo(g, MAT.asphalt);
      area(L.poly, MAT.sand, 0.03, b); } }
  }
  function walkMound(x, z, y, r, h) { const rows = []; for (let ri = 0; ri <= 5; ri++) { const rr = ri / 5 * r; const row = []; for (let a = 0; a <= 16; a++) { const t = a / 16 * 6.283; row.push([x + Math.cos(t) * rr, y + h * (1 - sstep(0, 1, rr / r)), z + Math.sin(t) * rr]); } rows.push(row); } const g = gridGeo(rows); walkAdd(g); g.dispose(); }
  function line(b, ax, az, bx, bz, w, lift) { const g = strip([[ax, az], [bx, bz]], w, { lift: (lift || 0.1) + 0.03, step: 1.2, ground: getH, walk: false, flat: true }); if (g) b.geo(g, mats().stripe); }
  function boxLines(b, cx, cz, w, d, ry) { const c = Math.cos(ry), s = Math.sin(ry); const P = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]); for (let i = 0; i < 4; i++) line(b, P[i][0], P[i][1], P[(i + 1) % 4][0], P[(i + 1) % 4][1], 0.07, 0.1); }
  function dugout(b, x, z, ry, len) { const MAT = mats(); const y = getH(x, z); const c = Math.cos(ry), s = Math.sin(ry); const L = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    // local: +z toward the field, x along the line
    const back = L(0, -1.2); b.box(len, 2.3, 0.25, MAT.block, back[0], y + 1.15, back[1], ry); for (const sd of [-1, 1]) { const p = L(sd * len / 2, 0); b.box(0.25, 2.3, 2.6, MAT.block, p[0], y + 1.15, p[1], ry); }
    const roof = L(0, 0.1); b.box(len + 0.4, 0.18, 3.0, MAT.conc, roof[0], y + 2.4, roof[1], ry); const bench = L(0, -0.7); b.box(len - 1, 0.08, 0.45, MAT.wood, bench[0], y + 0.45, bench[1], ry); b.box(len - 1, 0.4, 0.1, MAT.dark, bench[0], y + 0.22, bench[1], ry);
    const rail = L(0, 1.25); b.box(len, 0.07, 0.07, MAT.steel, rail[0], y + 1.05, rail[1], ry); for (let k = 0; k <= 4; k++) { const p = L(-len / 2 + k * len / 4, 1.25); b.cyl(0.035, 0.035, 1.05, 6, MAT.steel, p[0], y + 0.52, p[1]); }
    addSolid(back[0], back[1], ry, len, 0.3, y, y + 2.3, "world"); for (const sd of [-1, 1]) { const p = L(sd * len / 2, 0); addSolid(p[0], p[1], ry, 0.3, 2.6, y, y + 2.3, "world"); } const sd2 = addSolid(bench[0], bench[1], ry, len - 1, 0.45, y, y + 0.49, "world"); if (sd2) sd2.seat = true; }
  function grandstand(b, p) {
    if (!p) return; const MAT = mats(); const bb = bbox(p.poly); const x0 = bb[0], x1 = bb[1], zF = bb[2], zB = bb[3]; const W = x1 - x0; let y0 = 1e9; for (let x = x0; x <= x1; x += 6) y0 = Math.min(y0, getH(x, zF), getH(x, zB)); const cx = (x0 + x1) / 2;
    // seven rows rising away from the field (south); aisles at both ends and the middle
    const rows = 7, depth = 0.8, rise = 0.42; const zStart = zF + 0.6;
    for (let r = 0; r < rows; r++) { const z = zStart + r * depth + depth / 2, top = y0 + (r + 1) * rise; b.box(W, top - y0 + 0.4, depth, MAT.conc, cx, (top + y0 - 0.4) / 2, z, 0); addSolid(cx, z, 0, W, depth, y0 - 0.4, top, "world");
      for (const [a, c] of [[x0 + 1.4, cx - 0.8], [cx + 0.8, x1 - 1.4]]) { const w = c - a; b.box(w, 0.06, 0.32, MAT.alu, (a + c) / 2, top + 0.44, z + 0.12, 0); b.box(w, 0.44, 0.05, MAT.alu, (a + c) / 2, top + 0.22, z + 0.12, 0); const sd = addSolid((a + c) / 2, z + 0.12, 0, w, 0.34, top, top + 0.47, "world"); if (sd) sd.seat = true; } }
    // the back walkway and rail, the front rail, the shade roof on posts at the back
    const zTop = zStart + rows * depth; b.box(W, rows * rise + 0.4, Math.max(0.6, zB - zTop), MAT.conc, cx, y0 + (rows * rise - 0.4) / 2, (zTop + zB) / 2, 0); addSolid(cx, (zTop + zB) / 2, 0, W, Math.max(0.6, zB - zTop), y0 - 0.4, y0 + rows * rise, "world");
    b.box(W, 0.06, 0.06, MAT.steel, cx, y0 + rows * rise + 1.05, zB - 0.1, 0); b.box(W, 0.06, 0.06, MAT.steel, cx, y0 + 1.05, zF + 0.2, 0);
    const hB = y0 + rows * rise + 3.4, hF = y0 + 5.4; for (let k = 0; k <= 4; k++) { const x = x0 + 0.5 + k * (W - 1) / 4; b.box(0.25, hB - y0, 0.25, MAT.steel, x, (hB + y0) / 2, zB - 0.2, 0); b.beam(x, hB, zB - 0.2, x, hF, zF - 0.4, 0.18, 0.3, MAT.steel); }
    b.beam(cx, hB + 0.12, zB - 0.2, cx, hF + 0.12, zF - 0.4, W + 0.4, 0.08, MAT.white);
    for (let k = 0; k < 3; k++) { const x = x0 + 0.5 + (k * 2 + 1) * (W - 1) / 6; for (let r = 0; r < rows; r++) b.box(0.9, 0.12, 0.3, MAT.conc, x, y0 + (r + 1) * rise - 0.2, zF + 0.3 + r * depth, 0); }
  }
  function bleachers(b, p, face) {
    if (!p) return; const MAT = mats(); const bb = bbox(p.poly); const alongX = bb[1] - bb[0] > bb[3] - bb[2]; const L = alongX ? bb[1] - bb[0] : bb[3] - bb[2], D = alongX ? bb[3] - bb[2] : bb[1] - bb[0]; const cx = (bb[0] + bb[1]) / 2, cz = (bb[2] + bb[3]) / 2;
    // rows rise away from the field: the east stand faces west (-x), the south stand faces north (-z)
    const ry = alongX ? 0 : Math.PI / 2; const fwd = alongX ? [0, -1] : [-1, 0]; const y0 = getH(cx, cz); const n = 5;
    for (let r = 0; r < n; r++) { const off = -D / 2 + 0.5 + r * (D - 1) / (n - 1); const x = cx - fwd[0] * off, z = cz - fwd[1] * off; const top = y0 + 0.35 + r * 0.38; const w = alongX ? L : 0.3, d = alongX ? 0.3 : L; b.box(alongX ? L : 0.3, 0.05, alongX ? 0.3 : L, MAT.alu, x, top + 0.4, z, 0); b.box(alongX ? L : 0.25, 0.04, alongX ? 0.25 : L, MAT.alu, x + fwd[0] * 0.35, top, z + fwd[1] * 0.35, 0); const sd = addSolid(x, z, 0, alongX ? L : 0.34, alongX ? 0.34 : L, y0, top + 0.43, "world"); if (sd) sd.seat = true; }
    for (let k = 0; k <= Math.round(L / 3); k++) { const t = -L / 2 + k * L / Math.round(L / 3); const fx = alongX ? cx + t : cx + fwd[0] * (D / 2), fz = alongX ? cz + fwd[1] * (D / 2) : cz + t, bx = alongX ? cx + t : cx - fwd[0] * (D / 2), bz = alongX ? cz - fwd[1] * (D / 2) : cz + t; b.beam(fx, y0 + 0.1, fz, bx, y0 + 0.35 + (n - 1) * 0.38 + 0.4, bz, 0.08, 0.1, MAT.steel); b.cyl(0.04, 0.04, 2.0, 6, MAT.steel, bx, y0 + 1.0, bz); }
  }
  function teamBench(b, x, z, ry) { const MAT = mats(); const y = getH(x, z); b.box(6, 0.07, 0.4, MAT.alu, x, y + 0.45, z, ry); for (const k of [-2.6, 0, 2.6]) { const c = Math.cos(ry), s = Math.sin(ry); b.box(0.06, 0.45, 0.35, MAT.steel, x + k * c, y + 0.22, z - k * s, ry); } b.box(6.4, 0.06, 1.8, MAT.fabric2, x, y + 2.3, z, ry); for (const k of [-3.1, 3.1]) { const c = Math.cos(ry), s = Math.sin(ry); b.cyl(0.04, 0.04, 2.3, 6, MAT.steel, x + k * c, y + 1.15, z - k * s); } const sd = addSolid(x, z, ry, 6, 0.4, y, y + 0.49, "world"); if (sd) sd.seat = true; }

  // ───────── the Great Lawn and the Bandshell ─────────
  function buildLawn() {
    const MAT = mats(); const zn = zone("west", -390, -440, 240); const b = zn.b;
    const L = land("gp_l_the_great_lawn_kept_turf"); if (L) { area(rect(-457, -345, -367, -247), MAT.turf, 0.05, b); area(rect(-323, -345, -234, -247), MAT.turf, 0.05, b); area(rect(-367, -308.5, -323, -247), MAT.turf, 0.05, b); }
    // two youth soccer pitches either side of the Bandshell Walk, with goals
    for (const cx of [-400, -289]) { const cz = -283, w = 62, d = 40; const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
      for (const [a, c2] of [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]], [[cx, z0], [cx, z1]]]) line(b, a[0], a[1], c2[0], c2[1], 0.12, 0.05);
      const cc = []; for (let i = 0; i <= 28; i++) { const a = i / 28 * 6.283; cc.push([cx + Math.cos(a) * 6, cz + Math.sin(a) * 6]); } for (let i = 0; i < cc.length - 1; i++) line(b, cc[i][0], cc[i][1], cc[i + 1][0], cc[i + 1][1], 0.12, 0.05);
      for (const sd of [-1, 1]) { const gx = cx + sd * w / 2; const pb = [[gx, cz - 9], [gx - sd * 9, cz - 9], [gx - sd * 9, cz + 9], [gx, cz + 9]]; for (let i = 0; i < 3; i++) line(b, pb[i][0], pb[i][1], pb[i + 1][0], pb[i + 1][1], 0.12, 0.05); const y = getH(gx, cz); for (const e of [-2.75, 2.75]) b.cyl(0.05, 0.05, 1.9, 8, MAT.white, gx, y + 0.95, cz + e); b.pole(gx, y + 1.9, cz - 2.75, gx, y + 1.9, cz + 2.75, 0.05, MAT.white, 8); const net = new THREE.PlaneGeometry(5.5, 1.9); b.put(net, MAT.net, gx + sd * 0.9, y + 0.95, cz, Math.PI / 2); addSolid(gx, cz - 2.75, 0, 0.12, 0.12, y, y + 1.9, "world"); addSolid(gx, cz + 2.75, 0, 0.12, 0.12, y, y + 1.9, "world"); } }
    // the Bandshell: front-of-house light towers pointing north at the stage (away from the runway), lantern bollards on the aisle
    const bs = (typeof planBuilding === "function" && planBuilding("gp_b07")) || null; const bx = bs ? bs.e[0] : -345, bz = bs ? bs.e[2] : -329;
    GP.stageHeads = [];
    for (const sd of [-1, 1]) { const x = bx + sd * 17, z = -309.5, y = getH(x, z); for (const [ox, oz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) b.cyl(0.05, 0.05, 7, 6, MAT.dark, x + ox, y + 3.5, z + oz); for (let k = 1; k < 7; k++) b.box(0.85, 0.05, 0.85, MAT.dark, x, y + k, z, 0); b.box(1.6, 0.1, 0.9, MAT.dark, x, y + 7, z, 0);
      for (let k = 0; k < 3; k++) { b.box(0.34, 0.34, 0.4, MAT.black, x - 0.5 + k * 0.5, y + 6.7, z - 0.3, Math.atan2(bx - x, bz - z)); b.box(0.28, 0.28, 0.02, MAT.stage, x - 0.5 + k * 0.5, y + 6.7, z - 0.51, Math.atan2(bx - x, bz - z)); } COLLIDERS.push([x, z, 0.8]); addSolid(x, z, 0, 1, 1, y, y + 7.1, "world"); }
    { const pts = promPts("gp_p_bandshellwalk"); if (pts) along(pts, 7, 3, (x, z, ux, uz) => { for (const sd of [-1, 1]) { const px = x - uz * sd * 2.5, pz = z + ux * sd * 2.5; const y = getH(px, pz); b.cyl(0.08, 0.1, 0.7, 8, MAT.dark, px, y + 0.35, pz); b.cyl(0.1, 0.1, 0.14, 8, MAT.stage, px, y + 0.72, pz); } }); }
    // blankets on the lawn for the evening concert
    { const g = new THREE.Group(); g.userData.noInst = true; g.userData.noCull = true; const bb2 = new Batch("blankets"); const pg = new THREE.PlaneGeometry(1.8, 1.4).rotateX(-Math.PI / 2); for (let i = 0; i < 18; i++) { const x = bx + (rand() - 0.5) * 50, z = -300 + rand() * 42; if (Math.abs(x - bx) < 3) continue; bb2.put(pg, MAT.blanket[i % MAT.blanket.length], x, getH(x, z) + 0.075, z, rand() * 3); } bb2.build(g, { cast: false }); zn.g.add(g); GP.blankets = g; }
  }
  // ───────── car parks ─────────
  function buildCarParks() {
    const MAT = mats(); const zn = zone("west", -390, -440, 240); const b = zn.b;
    const stalls = (x0, x1, zEdge, dir, depth) => { for (let x = x0; x <= x1 + 0.01; x += 2.7) line(b, x, zEdge, x, zEdge + dir * depth, 0.1, 0.23); line(b, x0, zEdge + dir * depth, x1, zEdge + dir * depth, 0.1, 0.23); };
    { const L = land("gp_l_airport_park_car_park_kept"); if (L) { area(rect(-468, -416, -292, -384), MAT.asphalt, 0.2, b); stalls(-465, -364, -406, -1, 5.4); stalls(-338, -300, -406, -1, 5.4); stalls(-462, -330, -394, 1, 5.4); stalls(-302, -296, -394, 1, 5.4);
      for (const h of L.holes || []) { const hb = bbox(h); const cx = (hb[0] + hb[1]) / 2, cz = (hb[2] + hb[3]) / 2; const y = getH(cx, cz); b.box(hb[1] - hb[0], 0.22, hb[3] - hb[2], MAT.conc, cx, y + 0.31, cz, 0); b.box(hb[1] - hb[0] - 0.4, 0.05, hb[3] - hb[2] - 0.4, MAT.soil, cx, y + 0.43, cz, 0); addSolid(cx, cz, 0, hb[1] - hb[0], hb[3] - hb[2], y, y + 0.42, "world"); } }
      const I = land("gp_l_airport_park_car_park_west_i"); if (I) for (let i = 0; i < 10; i++) putLateRandom(I.poly); }
    { const L = land("gp_l_south_car_park"); if (L) { area(rect(-418, -230, -368, -214), MAT.asphalt, 0.2, b); stalls(-416, -390, -230, 1, 5.3); stalls(-380, -370, -230, 1, 5.3); stalls(-416, -390, -214, -1, 5.3); stalls(-380, -370, -214, -1, 5.3); } }
    { const L = land("gp_l_north_car_park"); if (L) { area(rect(-400, -627, -344, -613), MAT.asphalt, 0.2, b); stalls(-398, -384, -613, -1, 5.2); stalls(-360, -346, -613, -1, 5.2); stalls(-398, -384, -627, 1, 5.2); stalls(-360, -346, -627, 1, 5.2);
      for (const [x0, x1] of [[-382, -376], [-368, -362]]) { const cx = (x0 + x1) / 2, cz = -623, y = getH(cx, cz); b.box(x1 - x0, 0.22, 8, MAT.conc, cx, y + 0.31, cz, 0); b.box(x1 - x0 - 0.4, 0.05, 7.6, MAT.soil, cx, y + 0.43, cz, 0); addSolid(cx, cz, 0, x1 - x0, 8, y, y + 0.42, "world"); } } }
  }
  function putLateRandom(poly) { const bb = bbox(poly); for (let k = 0; k < 6; k++) { const x = bb[0] + rand() * (bb[1] - bb[0]), z = bb[2] + rand() * (bb[3] - bb[2]); if (inPoly(poly, x, z) && !planNearRoad(x, z, 0.8)) { putLate(rand() < 0.5 ? "bush1" : "bush2", x, z, 0.5 + rand() * 0.4); return; } } }
  // ───────── Tailwind Dog Park ─────────
  function buildDogPark() {
    const MAT = mats(); const L = land("gp_l_tailwind_dog_park_yards"); if (!L) return; const zn = zone("west", -390, -440, 240); const b = zn.b; const bb = bbox(L.poly); const xm = (bb[0] + bb[1]) / 2;
    area(L.poly, MAT.footing, 0.04, b);
    // two yards, big dogs west and small dogs east, double gates on the Loop side, copper-capped posts
    const gate = 1.6, g1 = (bb[0] + xm) / 2, g2 = (xm + bb[1]) / 2; chainFence(b, [[g1 + gate / 2, bb[3]], [g2 - gate / 2, bb[3]]], 1.5, { caps: true }); chainFence(b, [[g2 + gate / 2, bb[3]], [bb[1], bb[3]], [bb[1], bb[2]], [bb[0], bb[2]], [bb[0], bb[3]], [g1 - gate / 2, bb[3]]], 1.5, { caps: true }); chainFence(b, [[xm, bb[2]], [xm, bb[3]]], 1.5, { caps: true });
    for (const gx of [g1, g2]) { chainFence(b, [[gx - gate / 2, bb[3]], [gx - 2.2, bb[3]], [gx - 2.2, bb[3] + 3.2], [gx - 0.8, bb[3] + 3.2]], 1.5, { caps: true }); chainFence(b, [[gx + 0.8, bb[3] + 3.2], [gx + 2.2, bb[3] + 3.2], [gx + 2.2, bb[3]], [gx + gate / 2, bb[3]]], 1.5, { caps: true }); }
    // shade sails, a dog wash, the Hydrant fountain, benches
    for (const [x, z] of [[bb[0] + 10, bb[2] + 14], [xm - 9, bb[3] - 12], [xm + 10, bb[2] + 16], [bb[1] - 9, bb[3] - 14]]) sail(b, x, z, 5.5, 3.2, 2.8 + rand() * 0.6, rand() * 3);
    { const f = window.PLAN.fountains.find((q) => q.id === "gp_f_dog"); const x = f ? f.x - 3 : bb[0] + 30, z = f ? f.z : -590, y = getH(x, z); b.cyl(0.16, 0.2, 0.7, 12, MAT.red, x, y + 0.35, z); b.cyl(0.2, 0.2, 0.12, 12, MAT.red, x, y + 0.72, z); b.cyl(0.1, 0.1, 0.36, 8, MAT.red, x + 0.18, y + 0.45, z, 0, 0, Math.PI / 2); b.cyl(0.26, 0.22, 0.08, 14, MAT.steel, x + 0.5, y + 0.04, z); COLLIDERS.push([x, z, 0.35]); }
    { const x = xm + 4, z = bb[3] - 4, y = getH(x, z); b.box(2.2, 0.8, 1.1, MAT.conc, x, y + 0.4, z, 0); b.cyl(0.04, 0.04, 1.8, 6, MAT.steel, x - 0.9, y + 0.9, z - 0.4); addSolid(x, z, 0, 2.2, 1.1, y, y + 0.8, "world"); }
    for (const [x, z, ry] of [[bb[0] + 4, bb[2] + 30, Math.PI / 2], [bb[1] - 4, bb[2] + 30, -Math.PI / 2]]) bench(b, x, z, ry);
    GP.dogYards = [[bb[0] + 1.5, xm - 1.5, bb[2] + 1.5, bb[3] - 1.5], [xm + 1.5, bb[1] - 1.5, bb[2] + 1.5, bb[3] - 1.5]];
  }
  function sail(b, x, z, w, d, h, rot) { const MAT = mats(); const c = Math.cos(rot), s = Math.sin(rot); const P = [[-w / 2, -d / 2, h + 0.5], [w / 2, -d / 2, h - 0.3], [0, d / 2, h + 0.1]].map(([lx, lz, hh]) => [x + lx * c + lz * s, z - lx * s + lz * c, hh]); const y = getH(x, z);
    for (const p of P) { const gy = getH(p[0], p[1]); b.cyl(0.06, 0.08, p[2] + 0.5, 8, MAT.steel, p[0], gy + (p[2] + 0.5) / 2, p[1]); COLLIDERS.push([p[0], p[1], 0.2]); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute([P[0][0], getH(P[0][0], P[0][1]) + P[0][2], P[0][1], P[1][0], getH(P[1][0], P[1][1]) + P[1][2], P[1][1], P[2][0], getH(P[2][0], P[2][1]) + P[2][2], P[2][1]], 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2)); g.setIndex([0, 2, 1]); g.computeVertexNormals(); b.geo(g, rand() < 0.5 ? MAT.fabric : MAT.fabric2); }
  function bench(b, x, z, ry, onY) { const MAT = mats(); const y = onY !== undefined ? onY : ground(x, z); const c = Math.cos(ry), s = Math.sin(ry); for (let k = 0; k < 3; k++) b.box(1.8, 0.04, 0.12, MAT.wood, x - s * 0 + (k - 1) * 0.14 * s, y + 0.46, z + (k - 1) * 0.14 * c, ry); b.box(1.8, 0.3, 0.04, MAT.wood, x - s * 0.22, y + 0.72, z - c * 0.22, ry); for (const e of [-0.75, 0.75]) b.box(0.06, 0.46, 0.44, MAT.dark, x + e * c, y + 0.23, z - e * s, ry); const sd = addSolid(x, z, ry, 1.8, 0.45, y, y + 0.48, "world"); if (sd) sd.seat = true; }

  // ───────── Genesis Farm ─────────
  function buildFarm() {
    const MAT = mats(); const zn = zone("farm", -205, -520, 110); const b = zn.b; GP.pens = GP.pens || {};
    // the cattle paddock, Duke's pen behind a double fence in its north-west corner, a field shelter
    { const L = land("gp_l_cattle_paddock"); if (L) { const bb = bbox(L.poly); rails(b, poly2line(L.poly), { h: 1.4, rails: 3 }); area(L.poly, MAT.footing, 0.03, b); const dk = [bb[0] + 1.6, bb[0] + 12, bb[2] + 1.6, bb[2] + 13]; rails(b, poly2line(rect(dk[0], dk[2], dk[1], dk[3])), { h: 1.6, rails: 4 }); GP.pens.duke = [dk[0] + 1, dk[1] - 1, dk[2] + 1, dk[3] - 1]; GP.pens.cattle = [dk[1] + 2, bb[1] - 1.5, bb[2] + 1.5, bb[3] - 1.5]; shelter(b, bb[1] - 4.5, bb[2] + 3.2, 0, 6, 4); trough(b, dk[1] + 3, bb[3] - 2.2); trough(b, dk[0] + 3, dk[3] - 1.4); } }
    // sheep, goat and pig paddocks along the Paddock Path, fence-top feeding troughs on the path side
    { const L = land("gp_l_sheep_goat_and_pig_paddocks"); if (L) { const bb = bbox(L.poly); rails(b, poly2line(L.poly), { h: 1.2, rails: 4 }); area(L.poly, MAT.footing, 0.03, b); const w = (bb[1] - bb[0]) / 3; for (let k = 1; k < 3; k++) rails(b, [[bb[0] + k * w, bb[2]], [bb[0] + k * w, bb[3]]], { h: 1.2, rails: 4 }); const names = ["sheep", "goat", "pig"]; for (let k = 0; k < 3; k++) { GP.pens[names[k]] = [bb[0] + k * w + 1.2, bb[0] + (k + 1) * w - 1.2, bb[2] + 1.2, bb[3] - 1.2]; shelter(b, bb[0] + k * w + w / 2, bb[2] + 2.6, 0, 4.2, 3); } for (let k = 0; k < 4; k++) { const z = bb[2] + 5 + k * 8; const y = getH(bb[0], z); b.box(0.4, 0.22, 1.4, MAT.woodDark, bb[0] - 0.1, y + 1.05, z, 0); }
      const pig = GP.pens.pig; const mc = circ((pig[0] + pig[1]) / 2, pig[3] - 5, 2.4, 14); area(mc, MAT.soil, 0.05, b); } }
    // the Petting Yard: low rails, a gate on the barnyard side, a hand-wash station
    { const L = land("gp_l_petting_yard"); if (L) { const bb = bbox(L.poly); const gz = (bb[2] + bb[3]) / 2; rails(b, [[bb[0], gz - 1], [bb[0], bb[2]], [bb[1], bb[2]], [bb[1], bb[3]], [bb[0], bb[3]], [bb[0], gz + 1]], { h: 1.05, rails: 3 }); area(L.poly, MAT.footing, 0.035, b); GP.pens.petting = [bb[0] + 1.2, bb[1] - 1.2, bb[2] + 1.2, bb[3] - 1.2]; const x = bb[0] - 1.6, z = gz + 2.6, y = getH(x, z); b.box(0.6, 0.9, 0.5, MAT.steel, x, y + 0.45, z, 0); b.cyl(0.02, 0.02, 0.3, 6, MAT.steel, x, y + 1.05, z - 0.1); addSolid(x, z, 0, 0.6, 0.5, y, y + 0.9, "world"); shelter(b, bb[1] - 3, bb[2] + 2.2, 0, 4, 2.6); } }
    // the chicken run beside the barn, a little coop
    { const x0 = -198.5, x1 = -191, z0 = -529, z1 = -515; chainFence(b, poly2line(rect(x0, z0, x1, z1)), 1.8, { post: MAT.wood }); const y = getH((x0 + x1) / 2, z0 + 2); b.box(2.4, 1.3, 1.8, MAT.red, (x0 + x1) / 2, y + 0.95, z0 + 1.6, 0); b.box(2.7, 0.08, 2.1, MAT.grey, (x0 + x1) / 2, y + 1.65, z0 + 1.6, 0, 0.12); for (const e of [-1, 1]) b.box(0.08, 0.3, 0.08, MAT.woodDark, (x0 + x1) / 2 + e * 1.1, y + 0.15, z0 + 1.6, 0); addSolid((x0 + x1) / 2, z0 + 1.6, 0, 2.4, 1.8, y, y + 1.6, "world"); area(rect(x0, z0, x1, z1), MAT.soil, 0.04, b); GP.pens.chickenRun = [x0 + 0.8, x1 - 0.8, z0 + 3.2, z1 - 0.8]; }
    // the Barnyard: hay-bale seats round its edge, the Barnyard Pump and its flume
    { const q = window.PLAN.plazas.find((p) => p.id === "gp_pz_barnyard"); if (q) { /* D2: seven two-bale benches, every bale tangent to the ring (the old yaw a + 90 degrees turned them every which way) */ for (let i = 0; i < 7; i++) { const a = 0.5 + (i + 0.5) / 7 * 5.6; const r = q.r - 1.6; const cx = q.x + Math.cos(a) * r, cz = q.z + Math.sin(a) * r; const ry = -a - Math.PI / 2, tx = -Math.sin(a), tz = Math.cos(a); for (const o of [-0.57, 0.57]) { const x = cx + tx * o, z = cz + tz * o; if (planNearRoad(x, z, 0.6)) continue; const y = getH(x, z); b.box(1.1, 0.46, 0.55, MAT.straw, x, y + 0.23, z, ry); const sd = addSolid(x, z, ry, 1.1, 0.55, y, y + 0.46, "world"); if (sd) sd.seat = true; } } GP.pens.barnyard = [q.x - 9, q.x + 9, q.z - 8, q.z + 9]; } }
    { const f = window.PLAN.fountains.find((q) => q.id === "gp_f_barnyard"); if (f) { const y = getH(f.x, f.z); b.box(0.5, 0.2, 0.5, MAT.stone, f.x, y + 0.1, f.z, 0); b.cyl(0.09, 0.11, 1.0, 10, MAT.dark, f.x, y + 0.7, f.z); b.cyl(0.06, 0.06, 0.28, 8, MAT.dark, f.x + 0.14, y + 0.98, f.z, 0, 0, Math.PI / 2); b.beam(f.x - 0.05, y + 1.2, f.z, f.x - 0.55, y + 1.45, f.z, 0.05, 0.05, MAT.dark);
      const fx1 = f.x + 3.2; for (const sd of [-1, 1]) b.beam(f.x + 0.35, y + 0.7, f.z + sd * 0.14, fx1, y + 0.35, f.z + sd * 0.14, 0.04, 0.16, MAT.wood); b.beam(f.x + 0.35, y + 0.62, f.z, fx1, y + 0.27, f.z, 0.3, 0.04, MAT.wood); for (const t of [0.4, 0.8]) b.box(0.08, lerp(0.62, 0.27, t), 0.08, MAT.woodDark, lerp(f.x + 0.35, fx1, t), y + lerp(0.62, 0.27, t) / 2, f.z + 0.2, 0); b.box(0.6, 0.03, 0.6, MAT.dark, fx1 + 0.35, y + 0.03, f.z, 0);
      const rows = [], fl = [], dr = []; for (let i = 0; i <= 12; i++) { const t = i / 12; const x = lerp(f.x + 0.35, fx1, t), yy = y + lerp(0.66, 0.31, t); rows.push([[x, yy, f.z - 0.1], [x, yy, f.z], [x, yy, f.z + 0.1]]); for (const u of [-1, 0, 1]) { fl.push(u * 0.1, i * 0.3, 0.3, 1.2); dr.push(1, 0, 1 - Math.abs(u) * 0.6, 0); } } const g = gridGeo(rows, { aFlow: { array: new Float32Array(fl), size: 4 }, aDir: { array: new Float32Array(dr), size: 4 } }); const m = new THREE.Mesh(g, MAT.water); m.renderOrder = 3; zn.g.add(m); GP.pumpWater = m; COLLIDERS.push([f.x, f.z, 0.35]); } }
    // the Farm Stand: an awning, produce crates, a board (eggs, honey, mesquite flour, chiles)
    { const r = typeof planBuilding === "function" ? planBuilding("gp_b14") : null; if (r) { const e = r.e; const fx = Math.sin(e[3]), fz = Math.cos(e[3]), px = Math.cos(e[3]), pz = -Math.sin(e[3]); const rr = (MODELS[r.kind] ? MODELS[r.kind].radius * e[4] : 5.5) * 0.86; const x = e[0] + fx * (rr + 1.4), z = e[2] + fz * (rr + 1.4), y = getH(x, z);
      for (let k = 0; k < 4; k++) { const t = -2.4 + k * 1.6; const cx = x + px * t, cz = z + pz * t; b.box(1.2, 0.5, 0.7, MAT.wood, cx, y + 0.45, cz, e[3]); b.box(1.05, 0.12, 0.55, [MAT.red, MAT.yellow, MAT.plant, MAT.straw][k], cx, y + 0.75, cz, e[3]); b.box(0.1, 0.2, 0.1, MAT.woodDark, cx, y + 0.1, cz, e[3]); addSolid(cx, cz, e[3], 1.2, 0.7, y, y + 0.8, "world"); }
      const bd = board([{ text: "GENESIS FARM STAND", size: 96, y: 0.36, color: "#f5f1e6" }, { text: "EGGS · HONEY · MESQUITE FLOUR · CHILES", size: 50, y: 0.72, color: "#e2b24a", font: "'Space Grotesk', system-ui, sans-serif", weight: 600 }], 3.6, 0.9, { bg: "#6e2a22", border: "#e2b24a", planks: true }); bd.position.set(x - fx * 0.2, y + 2.7, z - fz * 0.2); bd.rotation.y = e[3]; zn.g.add(bd); b.box(6.6, 0.08, 2.4, MAT.fabric2, x - fx * 0.4, y + 2.25, z - fz * 0.4, e[3], 0.18); for (const t of [-3.1, 3.1]) b.cyl(0.05, 0.05, 2.2, 6, MAT.wood, x + px * t + fx * 0.6, y + 1.1, z + pz * t + fz * 0.6); } }
    // the tortoise garden by the Farm Stand
    { const x0 = -250, x1 = -242, z0 = -495, z1 = -485; for (const [a, c] of [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]]) { const L = hyp(c[0] - a[0], c[1] - a[1]); const n = Math.round(L / 0.55); for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; const x = lerp(a[0], c[0], t), z = lerp(a[1], c[1], t); b.put(stoneGeo(), MAT.stone, x, getH(x, z) + 0.1, z, rand() * 6, 0.32, 0.26, 0.28); } addSolid((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, Math.atan2(c[0] - a[0], c[1] - a[1]), 0.5, L, getH(a[0], a[1]) - 0.2, getH(a[0], a[1]) + 0.4, "world"); } area(rect(x0, z0, x1, z1), MAT.sand, 0.04, b); GP.pens.tortoise = [x0 + 1, x1 - 1, z0 + 1, z1 - 1]; }
    // the Kitchen Garden: raised beds, a picket fence, the corn under netting
    { const q = place("gp_garden"); if (q) { const x0 = q.x - 11, x1 = q.x + 11, z0 = q.z - 8, z1 = q.z + 8; picket(b, [[x1, z1 - 0.5], [x1, z1], [x0, z1], [x0, z0], [x1, z0], [x1, z1 - 2.5]]); area(rect(x0, z0, x1, z1), MAT.footing, 0.03, b);
      for (let i = 0; i < 6; i++) { const cx = x0 + 3 + i * 3.3, cz = q.z; const y = getH(cx, cz); b.box(1.3, 0.45, 12, MAT.woodDark, cx, y + 0.22, cz, 0); b.box(1.15, 0.06, 11.8, MAT.soil, cx, y + 0.46, cz, 0); addSolid(cx, cz, 0, 1.3, 12, y, y + 0.46, "world");
        if (i < 4) for (let k = 0; k < 9; k++) b.put(stoneGeo(), MAT.plant, cx + (rand() - 0.5) * 0.4, y + 0.6, cz - 5.3 + k * 1.3, rand() * 6, 0.32 + rand() * 0.12, 0.28, 0.32);
        else { for (let k = 0; k < 14; k++) { const zz = cz - 5.4 + k * 0.8; b.box(0.03, 1.7, 0.03, MAT.corn, cx - 0.3, y + 1.3, zz, 0); b.box(0.03, 1.6, 0.03, MAT.corn, cx + 0.3, y + 1.25, zz + 0.4, 0); b.box(0.5, 0.02, 0.2, MAT.corn, cx - 0.3, y + 1.4, zz, rand() * 3, 0.5); } const net = new THREE.BoxGeometry(1.5, 2.2, 12.2); b.put(net, MAT.net, cx, y + 1.55, cz); } } } }
    // the hay and feed shed yard and the Farm Lane gates are the shed model and the lane; closed feed bins by the shed
    { const r = typeof planBuilding === "function" ? planBuilding("gp_b15") : null; if (r) { const e = r.e; const x = e[0] + 12, z = e[2] - 3, y = getH(x, z); for (let k = 0; k < 3; k++) { b.cyl(0.6, 0.6, 1.4, 14, MAT.steel, x, y + 0.7, z + k * 1.5); b.cyl(0.62, 0.62, 0.06, 14, MAT.dark, x, y + 1.43, z + k * 1.5); COLLIDERS.push([x, z + k * 1.5, 0.65]); } } }
  }
  function shelter(b, x, z, ry, w, d) { const MAT = mats(); const y = getH(x, z); const c = Math.cos(ry), s = Math.sin(ry); const L = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const back = L(0, -d / 2); b.box(w, 2.2, 0.12, MAT.grey, back[0], y + 1.1, back[1], ry); for (const sd of [-1, 1]) { const p = L(sd * w / 2, 0); b.box(0.12, 2.2, d, MAT.grey, p[0], y + 1.1, p[1], ry); } const rf = L(0, 0.1); b.box(w + 0.5, 0.08, d + 0.7, MAT.steel, rf[0], y + 2.45, rf[1], ry, -0.12);
    addSolid(back[0], back[1], ry, w, 0.2, y, y + 2.2, "world"); for (const sd of [-1, 1]) { const p = L(sd * w / 2, 0); addSolid(p[0], p[1], ry, 0.2, d, y, y + 2.2, "world"); } }
  function trough(b, x, z) { const MAT = mats(); const y = getH(x, z); b.box(1.0, 0.55, 0.6, MAT.steel, x, y + 0.28, z, 0); b.box(0.8, 0.02, 0.42, MAT.dark, x, y + 0.5, z, 0); }
  function picket(b, pts) { const MAT = mats(); for (let i = 0; i < pts.length - 1; i++) { const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1]; const L = hyp(bx - ax, bz - az); if (L < 0.2) continue; const yaw = Math.atan2(bx - ax, bz - az); const n = Math.round(L / 0.16); for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; const x = lerp(ax, bx, t), z = lerp(az, bz, t); b.box(0.08, 1.0, 0.025, MAT.white, x, getH(x, z) + 0.5, z, yaw + Math.PI / 2); } for (const hh of [0.3, 0.8]) b.beam(ax, getH(ax, az) + hh, az, bx, getH(bx, bz) + hh, bz, 0.04, 0.08, MAT.white); addSolid((ax + bx) / 2, (az + bz) / 2, yaw, 0.1, L, getH(ax, az) - 0.2, getH(ax, az) + 1.0, "world"); } }
  // ───────── Genesis Stables ─────────
  function buildStables() {
    const MAT = mats(); const zn = zone("stables", -10, -480, 140); const b = zn.b; GP.pens = GP.pens || {};
    { const L = land("gp_l_riding_arena"); if (L) { const bb = bbox(L.poly); rails(b, poly2line(L.poly), { pipe: true, h: 1.5, rails: 3, spacing: 3 }); area(L.poly, MAT.footing, 0.05, b); GP.pens.arena = [bb[0] + 2, bb[1] - 2, bb[2] + 2, bb[3] - 2]; for (const [x, z] of [[bb[0] + 3, bb[2] + 3], [bb[1] - 3, bb[3] - 3]]) { const y = getH(x, z); b.cyl(0.5, 0.5, 0.35, 12, MAT.white, x, y + 0.18, z); } } }
    for (const [id, key] of [["gp_l_north_horse_paddock", "horseN"], ["gp_l_south_horse_paddock", "horseS"]]) { const L = land(id); if (!L) continue; const bb = bbox(L.poly); rails(b, poly2line(L.poly), { pipe: true, h: 1.45, rails: 3, spacing: 3 }); GP.pens[key] = [bb[0] + 2, bb[1] - 2, bb[2] + 2, bb[3] - 2]; shelter(b, bb[0] + 5, bb[2] + 3.3, 0, 6.5, 4.5); trough(b, bb[1] - 3, bb[3] - 2.5); }
    // the Stable Yard north of the barn: hitching rail, mounting block, wash rack
    { const r = typeof planBuilding === "function" ? planBuilding("gp_b16") : null; const x = r ? r.e[0] : -10, z = (r ? r.e[2] : -562) - 17; area(rect(x - 12, z - 7, x + 12, z + 6), MAT.footing, 0.04, b); const y = getH(x, z);
      b.box(6, 0.12, 0.12, MAT.woodDark, x - 5, y + 1.1, z - 4, 0); for (const e of [-3, 0, 3]) b.box(0.14, 1.15, 0.14, MAT.woodDark, x - 5 + e, y + 0.57, z - 4, 0); addSolid(x - 5, z - 4, 0, 6, 0.2, y, y + 1.2, "world");
      b.box(1.2, 0.3, 0.9, MAT.stone, x + 4, y + 0.15, z - 3.5, 0); b.box(1.2, 0.6, 0.45, MAT.stone, x + 4, y + 0.3, z - 3.7, 0); const sd = addSolid(x + 4, z - 3.5, 0, 1.2, 0.9, y, y + 0.3, "world");
      for (const e of [-1.2, 1.2]) b.cyl(0.05, 0.05, 2.4, 8, MAT.steel, x + 8 + e, y + 1.2, z + 1); b.pole(x + 6.8, y + 2.4, z + 1, x + 9.2, y + 2.4, z + 1, 0.05, MAT.steel, 8); b.box(3, 0.04, 2.2, MAT.conc, x + 8, y + 0.06, z + 1, 0); }
  }
  // ───────── Windmill Green, the Mesquite Grove, the Hangar Playground, the Propeller Splash Pad ─────────
  function ramada(b, p) { const MAT = mats(); const bb = bbox(p.poly); const cx = (bb[0] + bb[1]) / 2, cz = (bb[2] + bb[3]) / 2, w = bb[1] - bb[0], d = bb[3] - bb[2], y = getH(cx, cz);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const x = cx + sx * (w / 2 - 0.4), z = cz + sz * (d / 2 - 0.4); b.cyl(0.08, 0.08, 3.0, 8, MAT.white, x, y + 1.5, z); COLLIDERS.push([x, z, 0.18]); addSolid(x, z, 0, 0.2, 0.2, y, y + 3, "world"); }
    b.box(w, 0.14, d, MAT.white, cx, y + 3.05, cz, 0); const roof = new THREE.ConeGeometry(Math.max(w, d) * 0.72, 1.2, 4, 1); roof.rotateY(Math.PI / 4); b.put(roof, MAT.green, cx, y + 3.7, cz, 0, w / Math.max(w, d), 1, d / Math.max(w, d));
    for (let k = 0; k < (w * d > 90 ? 2 : 1); k++) picnic(b, cx + (k - (w * d > 90 ? 0.5 : 0)) * 3.2, cz, 0); }
  function picnic(b, x, z, ry) { const MAT = mats(); const y = getH(x, z); const c = Math.cos(ry), s = Math.sin(ry); b.box(2.0, 0.07, 0.85, MAT.wood, x, y + 0.76, z, ry); for (const e of [-0.72, 0.72]) { b.box(2.0, 0.06, 0.3, MAT.wood, x + s * e, y + 0.45, z + c * e, ry); const sd = addSolid(x + s * e, z + c * e, ry, 2.0, 0.3, y, y + 0.48, "world"); if (sd) sd.seat = true; } for (const e of [-0.8, 0.8]) b.box(0.06, 0.74, 1.6, MAT.dark, x + e * c, y + 0.38, z - e * s, ry); addSolid(x, z, ry, 2.0, 0.85, y + 0.48, y + 0.8, "world"); }
  function buildGreen() {
    const MAT = mats(); const zn = zone("green", -230, -390, 90); const b = zn.b;
    for (const id of ["gp_x_ramada_west", "gp_x_ramada_east", "gp_x_ramada_splash"]) { const p = prop(id); if (p) ramada(b, p); }
    // the Windmill Trough: slotted stone, a grated floor, the pump pipe spilling into it (runs by day)
    { const f = window.PLAN.fountains.find((q) => q.id === "gp_f_windmill"); if (f) { const y = getH(f.x, f.z); const L = 3.2, W = 0.9; for (const sd of [-1, 1]) { b.box(L, 0.6, 0.16, MAT.stone, f.x, y + 0.3, f.z + sd * (W / 2 - 0.08), 0); b.box(0.16, 0.6, W, MAT.stone, f.x + sd * (L / 2 - 0.08), y + 0.3, f.z, 0); } b.box(L - 0.3, 0.03, W - 0.3, MAT.dark, f.x, y + 0.22, f.z, 0); addSolid(f.x, f.z, 0, L, W, y, y + 0.6, "world");
      const wm = PLACE.windmill && PLACE.windmill.find((e) => hyp(e[0] - f.x, e[2] - f.z) < 12); const px = f.x - L / 2 + 0.3; b.pole(wm ? wm[0] : px, y + 1.4, wm ? wm[2] : f.z, px, y + 1.4, f.z, 0.05, MAT.dark, 8); b.cyl(0.05, 0.05, 1.4, 8, MAT.dark, wm ? wm[0] : px, y + 0.7, wm ? wm[2] : f.z);
      const rows = [], fl = [], dr = []; for (let i = 0; i <= 8; i++) { const t = i / 8; rows.push([[px - 0.04, y + 1.38 - t * 1.1, f.z - 0.05], [px + 0.04, y + 1.38 - t * 1.1, f.z + 0.05]]); fl.push(-0.05, t * 3, 1, 1.6, 0.05, t * 3, 1, 1.6); dr.push(0, 1, 0.8, 0, 0, 1, 0.8, 0); } const g = gridGeo(rows, { aFlow: { array: new Float32Array(fl), size: 4 }, aDir: { array: new Float32Array(dr), size: 4 } }); const m = new THREE.Mesh(g, MAT.water); m.renderOrder = 3; zn.g.add(m); GP.water.push(m);
      const r2 = [], f2 = [], d2 = []; for (let i = 0; i <= 6; i++) { const x = f.x - L / 2 + 0.2 + i / 6 * (L - 0.4); r2.push([[x, y + 0.25, f.z - 0.3], [x, y + 0.25, f.z], [x, y + 0.25, f.z + 0.3]]); for (const u of [-1, 0, 1]) { f2.push(u * 0.3, i, 0.2, 0.6); d2.push(1, 0, 1 - Math.abs(u) * 0.8, 0); } } const g2 = gridGeo(r2, { aFlow: { array: new Float32Array(f2), size: 4 }, aDir: { array: new Float32Array(d2), size: 4 } }); const m2 = new THREE.Mesh(g2, MAT.water); m2.renderOrder = 3; zn.g.add(m2); GP.water.push(m2); } }
    // the Mesquite Grove: grills and horseshoe pits by the two bookable ramadas
    for (const id of ["gp_b10", "gp_b11"]) { const r = typeof planBuilding === "function" ? planBuilding(id) : null; if (!r) continue; const x = r.e[0] + 12, z = r.e[2]; for (const dz of [-4, 4]) { const y = getH(x, z + dz); b.cyl(0.05, 0.05, 0.9, 6, MAT.dark, x, y + 0.45, z + dz); b.box(0.7, 0.25, 0.5, MAT.black, x, y + 0.95, z + dz, 0); COLLIDERS.push([x, z + dz, 0.4]); }
      const hx = r.e[0] - 2, hz = r.e[2] + 14; for (const e of [-6, 6]) { const y = getH(hx, hz + e); b.box(1.0, 0.1, 1.8, MAT.sand, hx, y + 0.05, hz + e, 0); b.cyl(0.02, 0.02, 0.4, 6, MAT.steel, hx, y + 0.2, hz + e); } }
    if (GP.procHangar) { const p = prop("gp_x_little_hangar"); if (p) { const mm = mats(); const x0 = p.x, z0 = p.z, y = getH(x0, z0), L = 10, W = 7, H2 = 4.6;
      for (let k = 0; k <= 4; k++) { const x = x0 - L / 2 + k * L / 4; let prev = null; for (let i = 0; i <= 12; i++) { const a = Math.PI * i / 12; const zz = z0 - Math.cos(a) * W / 2, yy = y + Math.sin(a) * H2; if (prev) b.pole(x, prev[1], prev[0], x, yy, zz, 0.07, mm.steel, 6); prev = [zz, yy]; } addSolid(x, z0 - W / 2, 0, 0.2, 0.2, y, y + 1.5, "world"); addSolid(x, z0 + W / 2, 0, 0.2, 0.2, y, y + 1.5, "world"); }
      for (let i = 1; i < 12; i += 2) { const a = Math.PI * i / 12; b.pole(x0 - L / 2, y + Math.sin(a) * H2, z0 - Math.cos(a) * W / 2, x0 + L / 2, y + Math.sin(a) * H2, z0 - Math.cos(a) * W / 2, 0.04, mm.steel, 6); }
      b.box(4, 0.12, 3, mm.wood, x0 - 1.5, y + 2.2, z0, 0); const sd = addSolid(x0 - 1.5, z0, 0, 4, 3, y + 2.1, y + 2.28, "world"); for (const [dx, dz] of [[-3.4, -1.4], [0.4, -1.4], [-3.4, 1.4], [0.4, 1.4]]) b.box(0.12, 2.2, 0.12, mm.steel, x0 + dx, y + 1.1, z0 + dz, 0);
      b.beam(x0 + 0.5, y + 2.2, z0 + 0.6, x0 + 4.4, y + 0.3, z0 + 0.6, 0.8, 0.08, mm.yellow); b.box(3.6, 1.6, 0.05, mm.net, x0 - 1.5, y + 3.1, z0 - 1.5, 0); COLLIDERS.push([x0, z0, 1.2]); } }
    // the Hangar Playground: rubber surfacing, the Little Runway (03 and 21 painted), the propeller spinner, balloon swings
    { const hp = prop("gp_x_little_hangar"), bp = prop("gp_x_biplane"); if (hp) { const hb = bbox(hp.poly); area(rect(hb[0] - 3, hb[2] - 3, hb[1] + 3, hb[3] + 2), MAT.rubber, 0.06, b); }
      if (bp) area(circ(bp.x, bp.z, 6.5, 20), MAT.rubber2, 0.06, b);
      const cx = -240, cz = -398, a = 13, rr = 6; const pts = []; for (let i = 0; i <= 12; i++) { const t = -Math.PI / 2 + i / 12 * Math.PI; pts.push([cx + a + Math.cos(t) * rr, cz + Math.sin(t) * rr]); } for (let i = 0; i <= 12; i++) { const t = Math.PI / 2 + i / 12 * Math.PI; pts.push([cx - a + Math.cos(t) * rr, cz + Math.sin(t) * rr]); } pts.push(pts[0].slice());
      const g = strip(pts, 2.4, { lift: 0.08, step: 0.8, ground: getH }); if (g) b.geo(g, MAT.asphalt);
      for (let x = cx - a + 2; x < cx + a - 2; x += 2.2) line(b, x, cz - rr, x + 1.1, cz - rr, 0.12, 0.1);
      for (const [num, x, rot] of [["21", cx + a - 3.5, -Math.PI / 2], ["03", cx - a + 3.5, Math.PI / 2]]) { const t = textTexture([{ text: num, size: 330, y: 0.56, color: "#f2efe6" }], 512, 512, { bg: "rgba(0,0,0,0)" }); const m = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); m.position.set(x, getH(x, cz + rr) + 0.12, cz + rr); m.rotation.y = rot; m.renderOrder = 2; m.userData.noInst = true; zn.g.add(m); }
      // the propeller spinner (a playground spinner with a three-blade propeller deck)
      { const x = -259, z = -421, y = getH(x, z); const sp = new THREE.Group(); sp.position.set(x, y, z); const mm = mats(); const lb = new Batch("spinner"); lb.cyl(0.12, 0.12, 0.9, 10, mm.dark, 0, 0.45, 0); for (let k = 0; k < 3; k++) { const a2 = k * 2.094; lb.box(0.55, 0.08, 2.1, mm.yellow, Math.sin(a2) * 1.05, 0.5, Math.cos(a2) * 1.05, a2); } lb.cyl(0.35, 0.35, 0.12, 14, mm.red, 0, 0.56, 0); lb.build(sp); sp.userData.noInst = true; zn.g.add(sp); GP.anim.push({ kind: "spin", o: sp, x, z, rate: 0.9 }); addSolid(x, z, 0, 0.3, 0.3, y, y + 0.9, "world"); }
      // balloon swings
      { const x = -219, z = -414, y = getH(x, z); const mm = mats(); for (const e of [-3, 3]) { b.beam(x + e, y, z - 1.2, x + e, y + 3, z, 0.1, 0.1, mm.steel); b.beam(x + e, y, z + 1.2, x + e, y + 3, z, 0.1, 0.1, mm.steel); addSolid(x + e, z, 0, 0.3, 2.4, y, y + 3, "world"); } b.pole(x - 3, y + 3, z, x + 3, y + 3, z, 0.07, mm.steel, 8);
        for (let k = 0; k < 3; k++) { b.put(new THREE.SphereGeometry(0.5, 14, 10), mm.balloon[k], x - 2 + k * 2, y + 3.7, z); b.put(new THREE.CylinderGeometry(0.18, 0.14, 0.22, 10), mm.woodDark, x - 2 + k * 2, y + 3.12, z); }
        for (let k = 0; k < 2; k++) { const sw = new THREE.Group(); sw.position.set(x - 1 + k * 2, y + 3, z); const lb = new Batch("swing"); lb.box(0.5, 0.05, 0.25, mm.rubber, 0, -2.45, 0); for (const e of [-0.22, 0.22]) lb.cyl(0.012, 0.012, 2.45, 4, mm.dark, e, -1.22, 0); lb.build(sw); sw.userData.noInst = true; zn.g.add(sw); GP.anim.push({ kind: "swing", o: sw, x, z, ph: k * 1.7 }); } } }
    // the Propeller Splash Pad: floor jets on a flat pad and a turning propeller sprinkler
    { const f = window.PLAN.fountains.find((q) => q.id === "gp_f_splashpad"); if (f) { const y = getH(f.x, f.z); area(circ(f.x, f.z, 6.5, 28), MAT.conc, 0.07, b); for (let k = 0; k < 3; k++) { const rr2 = 2 + k * 1.6; const c2 = []; for (let i = 0; i <= 30; i++) { const t = i / 30 * 6.283; c2.push([f.x + Math.cos(t) * rr2, f.z + Math.sin(t) * rr2]); } for (let i = 0; i < 30; i++) line(b, c2[i][0], c2[i][1], c2[i + 1][0], c2[i + 1][1], 0.16, 0.09); }
      const jets = []; for (let i = 0; i < 10; i++) { const t = i / 10 * 6.283; jets.push([Math.cos(t) * 4.2, Math.sin(t) * 4.2]); } const pts = sprayPoints(jets.length * 22, (i) => { const j = jets[Math.floor(i / 22)]; return { p: [j[0], 0.05, j[1]], v: 3 + rand(), spread: 0.06, life: 1.1 }; }); pts.position.set(f.x, y + 0.08, f.z); zn.g.add(pts); GP.anim.push({ kind: "spray", o: pts, x: f.x, z: f.z, splash: true });
      const mm = mats(); b.cyl(0.14, 0.18, 2.6, 10, mm.steel, f.x, y + 1.3, f.z); COLLIDERS.push([f.x, f.z, 0.3]); addSolid(f.x, f.z, 0, 0.35, 0.35, y, y + 2.6, "world");
      const pr = new THREE.Group(); pr.position.set(f.x, y + 2.7, f.z + 0.2); const lb = new Batch("prop"); lb.put(new THREE.SphereGeometry(0.2, 12, 8), mm.red, 0, 0, 0); for (let k = 0; k < 3; k++) { const a2 = k * 2.094; lb.box(0.22, 1.5, 0.05, mm.yellow, -Math.sin(a2) * 0.8, Math.cos(a2) * 0.8, 0, 0, 0, a2); } lb.build(pr);
      const tip = sprayPoints(48, (i) => { const k = i % 3; const a = k * 2.094 + Math.PI / 2; return { p: [Math.cos(a) * 1.5, Math.sin(a) * 1.5, 0], v: 1.4 + rand(), spread: 0.5, life: 0.9 }; }); pr.add(tip); pr.userData.noInst = true; zn.g.add(pr); GP.anim.push({ kind: "prop", o: pr, x: f.x, z: f.z, rate: 1.6 }); GP.anim.push({ kind: "spray", o: tip, x: f.x, z: f.z, splash: true }); } }
  }
  function meshAt(geo, mat, x, y, z) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.userData.noInst = true; return m; }
  // ───────── the Runway Overlook ─────────
  function buildKnoll() {
    const K = GP.knoll; if (!K) return; const MAT = mats(); const zn = zone("knoll", K.cx, K.cz, 60); const b = zn.b;
    // stone curbs along the spur (a retaining edge on the uphill side), stone edge seats on every turn
    const S = (GP.spurSamples || []).filter((q) => q.s >= K.L1 - 1); if (S.length > 2) { const up = [], dn = []; for (const q of S) { const nx = -q.tz, nz = q.tx; const lx = q.x + nx * 1.62, lz = q.z + nz * 1.62, rx = q.x - nx * 1.62, rz = q.z - nz * 1.62; const lIn = hyp(lx - K.cx, lz - K.cz) < hyp(rx - K.cx, rz - K.cz); up.push({ x: q.x, y: q.y - 0.12, z: q.z, tx: q.tx, tz: q.tz, side: lIn ? 1 : -1 }); }
      const side = up[Math.floor(up.length / 2)].side; sweep(up, [[side * 1.5, -0.2], [side * 1.78, -0.2], [side * 1.78, 0.42], [side * 1.5, 0.42]], b, MAT.stone); sweep(up, [[-side * 1.5, -0.3], [-side * 1.7, -0.3], [-side * 1.7, 0.2], [-side * 1.5, 0.2]], b, MAT.stone);
      for (let i = 0; i < up.length - 1; i += 3) { const a = up[i], c = up[Math.min(up.length - 1, i + 3)]; const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2; const ry = Math.atan2(c.x - a.x, c.z - a.z); const nx = -a.tz, nz = a.tx; addSolid(mx + nx * side * 1.64, mz + nz * side * 1.64, ry, 0.28, hyp(c.x - a.x, c.z - a.z) + 0.1, a.y - 0.2, a.y + 0.42, "world"); }
      for (const f of [0.18, 0.4, 0.62, 0.84]) { const q = S[Math.floor(f * (S.length - 1))]; const nx = -q.tz, nz = q.tx; const sx = q.x - nx * side * 2.3, sz = q.z - nz * side * 2.3; const ry = Math.atan2(q.tx, q.tz); b.box(1.9, 0.45, 0.5, MAT.stone, sx, q.y - 0.05, sz, ry); const sd = addSolid(sx, sz, ry, 1.9, 0.5, q.y - 0.4, q.y + 0.17, "world"); if (sd) sd.seat = true; walkQuad(sx - Math.sin(ry) * 0.95, q.y + 0.18, sz - Math.cos(ry) * 0.95, sx + Math.sin(ry) * 0.95, q.y + 0.18, sz + Math.cos(ry) * 0.95, 0.5); } }
    // the summit: stone seats turned east-north-east toward the approach, shade sails, coin binoculars, the airband speaker, the arrivals board
    const top = K.top + PATCH_LIFT; const brg = yawOfBearing(77); const fx = Math.sin(brg), fz = Math.cos(brg), px = Math.cos(brg), pz = -Math.sin(brg);
    for (let row = 0; row < 2; row++) for (let k = -1; k <= 1; k++) { const x = K.cx - fx * (1 + row * 2.4) + px * k * 2.4, z = K.cz - fz * (1 + row * 2.4) + pz * k * 2.4; b.box(2.0, 0.45, 0.55, MAT.stone, x, top + 0.22, z, brg); const sd = addSolid(x, z, brg, 2.0, 0.55, top, top + 0.46, "world"); if (sd) sd.seat = true; }
    for (let k = 0; k < 2; k++) { const x = K.cx - fx * 2.2 + px * (k ? 2.2 : -2.2), z = K.cz - fz * 2.2 + pz * (k ? 2.2 : -2.2); sailAt(b, x, z, top, 5.2, 3.6, 3.6 + k * 0.4, brg + (k ? 0.5 : -0.5)); }
    for (const e of [-1.6, 1.6]) { const x = K.cx + fx * 6 + px * e, z = K.cz + fz * 6 + pz * e; b.cyl(0.07, 0.09, 1.1, 8, MAT.dark, x, top + 0.55, z); b.box(0.42, 0.22, 0.26, MAT.verd, x, top + 1.2, z, brg); for (const f2 of [-0.1, 0.1]) b.cyl(0.07, 0.07, 0.24, 10, MAT.dark, x + fx * 0.2 + px * f2, top + 1.24, z + fz * 0.2 + pz * f2, Math.PI / 2, brg); COLLIDERS.push([x, z, 0.2]); }
    { const x = K.cx + px * 5.2, z = K.cz + pz * 5.2; b.cyl(0.06, 0.06, 2.6, 8, MAT.dark, x, top + 1.3, z); b.box(0.5, 0.4, 0.3, MAT.dark, x, top + 2.3, z, brg); b.cyl(0.01, 0.01, 1.4, 4, MAT.steel, x, top + 3.3, z); COLLIDERS.push([x, z, 0.2]); }
    { const x = K.cx - px * 5.4 + fx * 0.8, z = K.cz - pz * 5.4 + fz * 0.8; for (const e of [-0.9, 0.9]) b.cyl(0.06, 0.06, 2.2, 8, MAT.dark, x + px * e, top + 1.1, z + pz * e); const bd = board([{ text: "ARRIVALS · RUNWAY 21", size: 84, y: 0.2, color: "#f4cd5a" }, { text: "GIVEBACK ONE  ·  ON FINAL", size: 66, y: 0.46, color: "#f5f1e6", font: "'JetBrains Mono', monospace", weight: 600 }, { text: "NEXT JET  ·  4 MIN", size: 66, y: 0.66, color: "#4DDE6F", font: "'JetBrains Mono', monospace", weight: 600 }, { text: "LEFT-HAND CIRCUIT OVER THE EXPANSE", size: 44, y: 0.86, color: "#d08a55", font: "'Space Grotesk', system-ui, sans-serif", weight: 600 }], 2.2, 1.3, { bg: "#0a1610", border: "#d08a55" }); bd.position.set(x, top + 2.05, z); bd.rotation.y = brg + Math.PI / 2; zn.g.add(bd); COLLIDERS.push([x, z, 0.8]); }
    // the copper jet totem at the Overlook Gate
    { const cl = prop("gp_x_gate_cottonwoods"); const x = cl ? cl.x - 7.5 : 9, z = cl ? cl.z + 9 : -232, y = ground(x, z); b.cyl(0.16, 0.26, 9, 12, MAT.copper, x, y + 4.5, z); b.cyl(0.55, 0.65, 0.5, 14, MAT.stone, x, y + 0.25, z); COLLIDERS.push([x, z, 0.6]); addSolid(x, z, 0, 0.8, 0.8, y, y + 9, "world");
      if (has("jet")) { const j = makeModel("jet"); j.scale.setScalar(0.15); j.position.set(x, y + 9.1, z); j.rotation.set(-0.12, yawOfBearing(215), 0.08); j.traverse((o) => { if (o.isMesh) { o.material = MAT.copper; o.castShadow = true; o.userData.noInst = true; } }); j.userData.noInst = true; zn.g.add(j); } }
  }
  function sailAt(b, x, z, y0, w, d, h, rot) { const MAT = mats(); const c = Math.cos(rot), s = Math.sin(rot); const P = [[-w / 2, -d / 2, h + 0.4], [w / 2, -d / 2, h - 0.3], [0, d / 2, h]].map(([lx, lz, hh]) => [x + lx * c + lz * s, z - lx * s + lz * c, hh]);
    for (const p of P) { b.cyl(0.06, 0.08, p[2] + 0.3, 8, MAT.steel, p[0], y0 + (p[2] + 0.3) / 2, p[1]); COLLIDERS.push([p[0], p[1], 0.2]); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute([P[0][0], y0 + P[0][2], P[0][1], P[1][0], y0 + P[1][2], P[1][1], P[2][0], y0 + P[2][2], P[2][1]], 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2)); g.setIndex([0, 2, 1]); g.computeVertexNormals(); b.geo(g, MAT.fabric); }
  // ───────── the lantern-lit Loop: lanterns every 25 m, benches every 150 m ─────────
  function buildLoop() {
    const MAT = mats(); const pts = promPts("gp_p_loop"); if (!pts) return; const own = new Set(ROADS.filter((r) => r.plan === "gp_p_loop")); const spots = [], benches = [];
    const ok = (x, z, r) => { if (planNearRoad(x, z, r, own)) return false; if (planNearCollider(x, z, r + 0.3)) return false; if (typeof planPolyBlocked === "function" && planPolyBlocked(x, z)) return false; for (const c of GP.cross) if (hyp(c.x - x, c.z - z) < c.L / 2 + 2) return false; for (const q of SOLAR.pts) if (Math.abs(q[0] - x) < 1.4 && Math.abs(q[1] - z) < 1.4) return false; return true; };
    along(pts, 25, 5, (x, z, ux, uz) => { let done = false; for (const ds of [0, 2.5, -2.5, 5, -5, 7.5]) { for (const sd of [1, -1]) { const off = 2.5 + 1.2; const px = x + ux * ds - uz * sd * off, pz = z + uz * ds + ux * sd * off; if (ok(px, pz, 0.3)) { spots.push([px, pz]); done = true; break; } } if (done) break; } });
    along(pts, 150, 60, (x, z, ux, uz) => { for (const sd of [1, -1]) { const off = 2.5 + 1.1; const px = x - uz * sd * off, pz = z + ux * sd * off; if (ok(px, pz, 1.0)) { benches.push([px, pz, Math.atan2(uz * sd, -ux * sd)]); break; } } });
    GP.lanterns = spots.length; const zn = zone("loop", -230, -410, 330);
    const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.9, 0.12), MAT.woodDark, spots.length), head = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 6), MAT.warm, spots.length), cap = new THREE.InstancedMesh(new THREE.ConeGeometry(0.17, 0.16, 6), MAT.copper, spots.length), ring = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 6), MAT.copper, spots.length);
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }), spots.length);
    spots.forEach(([x, z], i) => { const y = ground(x, z); setM(post, i, x, y + 0.95, z, 1); setM(ring, i, x, y + 1.92, z, 1); setM(head, i, x, y + 2.09, z, 1); setM(cap, i, x, y + 2.32, z, 1); _m4.compose(_v.set(x, y + 0.06, z), _q.identity(), _s.set(4.2, 1, 4.2)); pool.setMatrixAt(i, _m4); COLLIDERS.push([x, z, 0.18]); addSolid(x, z, 0, 0.16, 0.16, y, y + 2.3, "world"); });
    for (const im of [post, ring, head, cap, pool]) { im.frustumCulled = false; im.userData.noInst = true; im.castShadow = im === post; zn.g.add(im); } pool.renderOrder = 2; GP.lights.lanternPool = pool.material;
    for (const [x, z, ry] of benches) bench(zn.b, x, z, ry);
    GP.benches = benches.length;
  }
  function setM(im, i, x, y, z, s) { _m4.compose(_v.set(x, y, z), _q.identity(), _s.set(s, s, s)); im.setMatrixAt(i, _m4); }

  // ───────── the animals: instanced, wandering inside their pens, only animated near the player ─────────
  function buildAnimals() {
    const P = GP.pens || {}; const list = [];
    const A = (kind, pen, n, o) => { if (!pen) return; for (let i = 0; i < n; i++) list.push(Object.assign({ kind, pen, x: lerp(pen[0], pen[1], 0.2 + rand() * 0.6), z: lerp(pen[2], pen[3], 0.2 + rand() * 0.6), yaw: rand() * 6.283, s: 1, speed: 0.7, wait: rand() * 4, bob: rand() * 6, run: 1 }, o || {})); };
    // models, with placeholders until the new ones exist (switching automatically when MODELS has them)
    const K = (k, alts) => { if (has(k)) return { k, s: 1 }; for (const [a, s] of alts || []) if (has(a)) return { k: a, s }; return null; };
    const cow = K("cow", [["bull", 0.78]]), goat = K("goat", []), sheep = K("sheep", []), pig = K("pig", [["javelina", 1.0]]), chicken = K("chicken", [["quail", 1.5]]), dog = K("dog", [["coyote", 0.75]]), horse = K("horse", []), bull = K("bull", []), rabbit = K("jackrabbit", []), tort = K("tortoise", []);
    const add = (m, pen, n, o) => { if (m) A(m.k, pen, n, Object.assign({ s: m.s }, o || {})); };
    add(cow, P.cattle, 2, { speed: 0.55 }); if (cow) A(cow.k, P.cattle, 1, { s: cow.s * 0.6, speed: 0.8, calf: true }); add(bull, P.duke, 1, { speed: 0.5 });
    add(sheep, P.sheep, 4, { speed: 0.7, flock: true }); add(goat, P.goat, 4, { speed: 0.9, hop: 0.2 }); add(pig, P.pig, 3, { speed: 0.5 });
    add(goat, P.petting, 2, { speed: 0.8 }); add(sheep, P.petting, 1, { speed: 0.6 }); add(rabbit, P.petting, 2, { speed: 1.8, hop: 1 }); add(chicken, P.petting, 3, { speed: 0.9, peck: true });
    if (horse) A("horse", P.petting, 1, { s: 0.6, speed: 0.6, donkey: true });
    add(chicken, P.chickenRun, 5, { speed: 0.9, peck: true }); add(chicken, P.barnyard, 3, { speed: 0.9, peck: true, scatter: true }); add(dog, P.barnyard, 1, { speed: 1.6, s: dog ? dog.s * 1.05 : 1 });
    add(tort, P.tortoise, 2, { speed: 0.12 });
    add(horse, P.horseN, 2, { speed: 0.8 }); add(horse, P.horseS, 3, { speed: 0.8 }); if (horse) A("horse", P.arena, 2, { s: 0.7, speed: 1.0, circle: true });
    for (const y of GP.dogYards || []) add(dog, y, 2, { speed: 2.4, s: dog ? dog.s * (0.8 + rand() * 0.35) : 1, play: true });
    // one instanced mesh per model part per kind
    const by = {}; for (const a of list) (by[a.kind] = by[a.kind] || []).push(a);
    const zn = zone("animals", -150, -500, 330);
    for (const k in by) { const arr = by[k]; const ims = instOf(k, arr.length, true); if (!ims) continue; arr.forEach((a, i) => { a.i = i; a.ims = ims; a.y = getH(a.x, a.z); setInst(ims, i, a.x, a.y, a.z, a.yaw, a.s); }); for (const im of ims) { im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); zn.g.add(im); } }
    GP.animals = list.filter((a) => a.ims); GP.stats.animals = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length]));
    // the Genesis Park Loop's lanterns and the park's grasses planted after instancing (the terrace bank): one instanced mesh
    if (LATE.length && has("bush2")) { const ims = instOf("bush2", LATE.length, false); LATE.forEach((q, i) => setInst(ims, i, q[1], ground(q[1], q[2]), q[2], rand() * 6.283, q[3])); for (const im of ims) zn.g.add(im); }
  }
  function updateAnimals(dt, t) {
    const px = player.position.x, pz = player.position.z;
    for (const a of GP.animals) { const dp = hyp(px - a.x, pz - a.z); if (dp > 170) continue; const pen = a.pen;
      // spooked by the player: run to the far side of the pen (chickens scatter from a running player)
      if (dp < (a.scatter ? 5 : 3.2) && dp > 0.2 && !a.circle) { a.target = [clamp(a.x + (a.x - px) / dp * 8, pen[0], pen[1]), clamp(a.z + (a.z - pz) / dp * 8, pen[2], pen[3])]; a.run = a.kind === "tortoise" ? 1 : 2.4; }
      if (!a.target) { a.wait -= dt; if (a.wait > 0) { a.bob += dt * 0.6; const graze = Math.max(0, Math.sin(t * 0.5 + a.i * 1.7) - 0.3) * (a.peck ? 0.6 : 0.35); setInst(a.ims, a.i, a.x, a.y + (a.peck ? Math.abs(Math.sin(t * 7 + a.i)) * 0.01 : 0), a.z, a.yaw + Math.sin(t * 0.4 + a.i) * 0.05, a.s, graze, 0, a.s * (1 + Math.sin(t * 2.2 + a.i) * 0.015)); for (const im of a.ims) im.instanceMatrix.needsUpdate = true; continue; }
        if (a.circle) { a.ang = (a.ang || rand() * 6.283) + 0.9; a.target = [(pen[0] + pen[1]) / 2 + Math.cos(a.ang) * (pen[1] - pen[0]) * 0.38, (pen[2] + pen[3]) / 2 + Math.sin(a.ang) * (pen[3] - pen[2]) * 0.38]; }
        else a.target = [lerp(pen[0], pen[1], rand()), lerp(pen[2], pen[3], rand())]; a.run = a.play && rand() < 0.5 ? 2 : 1; }
      const dx = a.target[0] - a.x, dz = a.target[1] - a.z, d = hyp(dx, dz);
      if (d < 0.35) { a.target = null; a.wait = a.circle ? 0.1 : a.play ? 0.5 + rand() * 2 : 2 + rand() * 7; a.run = 1; continue; }
      const sp = a.speed * a.run; const step = Math.min(d, sp * dt); a.x = clamp(a.x + dx / d * step, pen[0], pen[1]); a.z = clamp(a.z + dz / d * step, pen[2], pen[3]); a.y = getH(a.x, a.z); a.bob += dt * sp * (a.hop ? 7 : 3.4);
      let dr = Math.atan2(dx, dz) - a.yaw; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); a.yaw += dr * Math.min(1, dt * 5);
      const fast = Math.min(1, sp / 3), hop = a.hop ? Math.abs(Math.sin(a.bob)) * 0.18 * a.hop : Math.abs(Math.sin(a.bob)) * 0.035 * a.s;
      setInst(a.ims, a.i, a.x, a.y + hop, a.z, a.yaw, a.s, Math.sin(a.bob * 2) * 0.05 * fast, Math.sin(a.bob) * 0.04 * fast, a.s * (1 + Math.sin(a.bob * 2) * 0.03 * fast)); for (const im of a.ims) im.instanceMatrix.needsUpdate = true; }
  }

  // ═════════ frame hook ═════════
  let FR = 0;
  function frameHook(dt, now) {
    if (!GP.built || !window.PLAN_MODE) return; FR++; const t = now / 1000; WU.uT.value = t; if (!FOUNT.list.length) { FOUNT.t.value = t; if (FOUNT.mats) FOUNT.mats.spray.uniforms.uPx.value = renderer.domElement.height / 900; }
    const dT = dayT(), hr = dT * 24; const nt = typeof night === "number" ? night : 0; WU.uNight.value = nt;
    // the creek runs from 7 am until the 10 pm lantern dimming, then drains away (the splash pads run by day)
    const want = hr >= 7 && hr < 22 ? 1 : 0; GP.on += (want - GP.on) * Math.min(1, dt * 0.25); if (Math.abs(want - GP.on) < 0.002) GP.on = want; WU.uOn.value = GP.on;
    { const el = -Math.cos(dT * 6.283), az = dT * 6.283; WU.uSun.value.set(Math.cos(az), Math.max(0.05, el), Math.sin(az) * 0.45).normalize(); }
    const vis = GP.on > 0.003; for (const m of GP.water || []) if (m.visible !== vis) m.visible = vis;
    if ((FR % 8) !== 0 && FR > 2) { if (player && GP.animals.length && !inside) updateAnimals(Math.min(0.1, dt), t); animNear(dt, t); return; }
    const cx = camera.position.x, cz = camera.position.z; const glow = Math.max(0, nt - 0.2) / 0.8;
    for (const zn of GP.zones) { const v = hyp(zn.x - cx, zn.z - cz) < zn.r + 700; if (zn.g.visible !== v) zn.g.visible = v; }
    const MAT = mats();
    // field lights: dusk to 10 pm, full cut-off; lanterns dim at 10 pm; the Bandshell's lights only for the evening concert
    const fieldsOn = hr >= 18 && hr < 22; MAT.led.emissiveIntensity = fieldsOn ? 2.4 + 1.6 * glow : 0;
    MAT.warm.emissiveIntensity = glow > 0 ? (hr >= 22 || hr < 5 ? 0.7 : 2.4) * glow : 0; if (GP.lights.lanternPool) GP.lights.lanternPool.opacity = (hr >= 22 || hr < 5 ? 0.18 : 0.5) * glow;
    const concert = hr >= 19 && hr < 22; MAT.stage.emissiveIntensity = concert ? 2.2 * Math.max(0.3, glow) : 0; if (GP.blankets) GP.blankets.visible = hr >= 17 && hr < 22.5;
    if (GP.lights.falls) GP.lights.falls.opacity = 0.95 * glow * GP.on;
    if (GP.fieldPool) GP.fieldPool.opacity = fieldsOn ? 0.42 * glow : 0;
    if (player && GP.animals.length && !inside) updateAnimals(Math.min(0.1, dt), t); animNear(dt, t);
  }
  function animNear(dt, t) {
    const cx = camera.position.x, cz = camera.position.z; const hr = dayT() * 24; const splashOn = hr >= 9 && hr < 19;
    for (const a of GP.anim) { const near = hyp(a.x - cx, a.z - cz) < 260; if (a.kind === "spray") { const v = near && (a.water ? GP.on > 0.5 : a.splash ? splashOn : true); if (a.o.visible !== v) a.o.visible = v; continue; } if (!near) continue;
      if (a.kind === "spin") a.o.rotation.y += dt * a.rate; else if (a.kind === "prop") { if (splashOn) a.o.rotation.z += dt * a.rate; } else if (a.kind === "swing") a.o.rotation.x = Math.sin(t * 1.9 + a.ph) * 0.35; }
    if (GP.splashWater) GP.splashWater.visible = splashOn && GP.on > 0.01; if (GP.pumpWater) GP.pumpWater.visible = GP.on > 0.01 && Math.sin(t * 0.35) > -0.3;
  }

  // ═════════ registration ═════════
  const wrap = (name, fn) => ({ name, fn: function () { if (!window.PLAN_MODE) return; return fn.apply(this, arguments); } });
  HOOKS.world.push(wrap("gpParkWorld", worldHook));
  HOOKS.terrain.push(wrap("gpParkTerrain", terrainHook));
  HOOKS.defer.unshift(wrap("gpParkSurfaces", surfacesHook));   // first: other modules standing things on the park's walks see its ground
  HOOKS.defer.push(wrap("gpParkDress", dressHook));
  HOOKS.frame.push(wrap("gpParkFrame", frameHook));
})();
