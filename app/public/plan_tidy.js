// R18 (Agent W): world tidy. Loaded after the fill modules and plan_arrivals.js, before client.js.
// Two parts:
//  1. PLAN_TIDY.audit(): an in-game checker for the five clash categories the user reported (6 Oct 2026), map-wide:
//     step     a raised walk edge (a ribbon lifted over the ground) standing on another paved surface: a plaza or another walk
//              (the "disconnected seam" and the slab-on-slab look of refs/path_disconnected.png and refs/roads_overlap.png)
//     jag      sawtooth geometry: small tilted triangles in the path dressing (courses and kerbs whose corners drop to the ground)
//     overlap  two lifted ribbons stacked on each other at a visibly different level (refs/roads_overlap.png)
//     kerb2    two raised kerbs running side by side over paving, with nothing (no bed) between them (refs/double_curbs.png)
//     rail     a railing or fence that runs through a building, a deck, a pool or a raised slab (refs/railing_intersect.png)
//     pool     a home pool (deck, rim, loungers) on a path, a plaza, a POI, a keep-out, a railing or another building
//              (refs/pool_poi_clash.png)
//     Every item is [type, x, z, source, detail]; counts are split outside / inside the Arrivals zone (Agent F2's).
//  2. The fixes, by category, at their source (?tidy=0 turns every fix off; the checker still loads):
//     see the section headers below.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
if (!window.PLAN_HOOKS.plan) window.PLAN_HOOKS.plan = [];
(function () {
  const Q = new URLSearchParams(location.search);
  const T = window.PLAN_TIDY = Object.assign(window.PLAN_TIDY || {}, { v: "r18w-1" });
  T.errs = T.errs || []; T.n = T.n || {}; T.t = T.t || {};
  T.off = Q.get("tidy") === "0";
  const note = (k, e) => { if (T.errs.length < 40) T.errs.push(k + ": " + ((e && e.stack) || e)); console.error("plan_tidy " + k + " failed:", (e && e.stack) || e); };
  const cnt = (k, d) => { T.n[k] = (T.n[k] || 0) + (d === undefined ? 1 : d); };
  const ARR = { x0: -70, x1: 270, z0: -260, z1: 75 };
  const inArr = (x, z) => x >= ARR.x0 && x <= ARR.x1 && z >= ARR.z0 && z <= ARR.z1;
  T.inArr = inArr;

  // ───────────────────────── shared geometry helpers ─────────────────────────
  function segD(x, z, a, b) { const vx = b[0] - a[0], vz = b[1] - a[1]; const L2 = vx * vx + vz * vz || 1e-9; let t = ((x - a[0]) * vx + (z - a[1]) * vz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t); }
  function polyD(pts, x, z) { let b = 1e9; for (let k = 0; k < pts.length - 1; k++) { const d = segD(x, z, pts[k], pts[k + 1]); if (d < b) b = d; } return b; }
  function polyLen(p) { let L = 0; for (let i = 0; i < p.length - 1; i++) L += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]); return L; }
  // walk a polyline every step metres: cb(x, z, ux, uz, s)
  function along(pts, step, cb) { let acc = 0, next = 0; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-4) continue; const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L; while (next <= acc + L + 1e-6) { const t = next - acc; cb(a[0] + ux * t, a[1] + uz * t, ux, uz, next); next += step; } acc += L; } }
  const RIB = { G: null, n: -1, C: 12 };
  function ribs() {   // every walkable ribbon in ROADS (not the runway or taxiways), with a segment grid
    if (RIB.G && RIB.n === ROADS.length) return RIB; const list = []; const G = new Map(); const C = RIB.C;
    for (let i = 0; i < ROADS.length; i++) { const r = ROADS[i]; if (!r || !r.pts || r.pts.length < 2 || !(r.w > 0)) continue; let mat = null; try { mat = ROAD_MAT.get(r) || null; } catch (e) {}
      const air = (typeof M !== "undefined" && mat === M.taxi) || r.w >= 29 || (!r.plan && !r.fest && !r.sp && r.w >= 11.5 && !r.dirt);
      const bed = !!(r.bed || r.e1bed || r.enrichBed || (typeof PM !== "undefined" && mat === PM.bed));
      const deck = typeof M !== "undefined" && mat === M.deck;
      const soft = !!r.dirt || (typeof M !== "undefined" && (mat === M.dirt || mat === M.track)) || (typeof PM !== "undefined" && mat === PM.redg);
      const R = { i, r, pts: r.pts, w: r.w, hw: r.w / 2, lift: r.lift || 0, air, bed, deck, soft, hard: !bed && !deck && !soft && !air, src: r.plan ? String(r.plan) : r.fest ? "fest:" + r.fest : r.sp ? "sp:" + r.sp : r.dm ? "domes" : r.landSpur ? "land" : "x", mat };
      list.push(R); const p = r.pts; const m = R.hw + 1;
      for (let k = 0; k < p.length - 1; k++) { const a = p[k], b = p[k + 1]; const x0 = Math.floor((Math.min(a[0], b[0]) - m) / C), x1 = Math.floor((Math.max(a[0], b[0]) + m) / C), z0 = Math.floor((Math.min(a[1], b[1]) - m) / C), z1 = Math.floor((Math.max(a[1], b[1]) + m) / C);
        if ((x1 - x0 + 1) * (z1 - z0 + 1) > 6000) continue; for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) { const key = gx * 100003 + gz; let c = G.get(key); if (!c) G.set(key, c = []); c.push([R, k]); } } }
    RIB.list = list; RIB.G = G; RIB.n = ROADS.length; return RIB; }
  // ribbons whose band covers (x, z) by margin m (positive = inside by m): [[R, d]]
  function ribsAt(x, z, m) { const B = ribs(); const c = B.G.get(Math.floor(x / B.C) * 100003 + Math.floor(z / B.C)); const out = []; if (!c) return out; const best = new Map();
    for (const [R, k] of c) { const d = segD(x, z, R.pts[k], R.pts[k + 1]); const o = best.get(R); if (o === undefined || d < o) best.set(R, d); }
    for (const [R, d] of best) if (d <= R.hw - (m || 0)) out.push([R, d]); return out; }
  T.ribsAt = ribsAt;
  function plazaAt(x, z, m) { for (let i = 0; i < PLAZAS.length; i++) { const p = PLAZAS[i]; if (Math.hypot(x - p[0], z - p[1]) <= p[2] + (m || 0)) return p; } return null; }
  function walk(x, z) { try { const w = walkAt(x, z); return w; } catch (e) { return null; } }
  // oriented footprints of buildings and set pieces placed through PLACE (not props or vehicles): { x, z, hx, hz, c, s, k, e }
  function footprints() { const out = []; for (const k in PLACE) { const sp = MODEL_SPECS[k]; const md = MODELS[k]; if (!sp || sp.prop || sp.vehicle || !md) continue; for (const e of PLACE[k]) { const sc = e[4] || 1; out.push({ x: e[0], z: e[2], hx: (md.sx || md.radius * 1.4) * sc / 2, hz: (md.sz || md.radius * 1.4) * sc / 2, c: Math.cos(e[3]), s: Math.sin(e[3]), k, e, y: e[1] }); } } return out; }
  // (x, z) in an oriented box of half sizes hx, hz (local x along (c, -s), local z along (s, c)), shrunk by m
  function inBox(b, x, z, m) { const dx = x - b.x, dz = z - b.z; const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c; return Math.abs(lx) < b.hx - (m || 0) && Math.abs(lz) < b.hz - (m || 0); }
  function gridOf(list, C, key) { const G = new Map(); for (const q of list) { const r = key(q); const x0 = Math.floor((r[0] - r[2]) / C), x1 = Math.floor((r[0] + r[2]) / C), z0 = Math.floor((r[1] - r[2]) / C), z1 = Math.floor((r[1] + r[2]) / C); for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) { const k2 = gx * 100003 + gz; let c = G.get(k2); if (!c) G.set(k2, c = []); c.push(q); } } return { G, C }; }
  function gridGet(GR, x, z) { return GR.G.get(Math.floor(x / GR.C) * 100003 + Math.floor(z / GR.C)) || []; }
  function poolBox(P) { return { x: P.x, z: P.z, hx: (P.w + 6) / 2, hz: (P.d + 6) / 2, c: Math.cos(P.rot), s: Math.sin(P.rot), pool: P }; }
  T.poolBox = poolBox; T.inBox = inBox; T.footprints = footprints;
  const POOL_KINDS = ["villa", "ranch", "lakehouse", "flagship", "home"];
  // the home a pool belongs to: addPools puts it behind the home, on the home's own yaw (rot)
  function homeOf(P) { let best = null, bd = 1e9; for (const k of POOL_KINDS) for (const e of PLACE[k] || []) { if (Math.abs(e[3] - P.rot) > 1e-6) continue; const d = Math.hypot(e[0] - P.x, e[2] - P.z); if (d < bd && d < 60) { bd = d; best = e; } } if (best) { for (const k of POOL_KINDS) if ((PLACE[k] || []).includes(best)) { P.kind = k; break; } } return best; }
  T.homeOf = homeOf;

  // ───────────────────────── the rails we know about (polylines with a base height) ─────────────────────────
  function railRuns() { const out = [];
    try { for (const p of (window.PLAN_ENRICH && PLAN_ENRICH.plazas) || []) { const n = p.S.length; for (const [i0, len] of p.rails || []) { const pts = []; for (let k = 0; k <= len; k++) { const q = p.S[(((i0 + k) % n) + n) % n]; pts.push([p.x + Math.cos(q.a) * p.R, p.z + Math.sin(q.a) * p.R]); } out.push({ pts, src: "plaza:" + p.id }); } } } catch (e) { note("rails enrich", e); }
    try { for (const r of (window.PLAN_PATHS && PLAN_PATHS.railRuns) || []) out.push({ pts: r.pts, src: "paths:" + r.src }); } catch (e) {}
    try { for (const k in PLACE) { if (!/rail|fence/i.test(k)) continue; const md = MODELS[k]; if (!md) continue; for (const e of PLACE[k]) { const L = (md.sx || 2) * (e[4] || 1) / 2; const c = Math.cos(e[3]), s = Math.sin(e[3]); out.push({ pts: [[e[0] - c * L, e[2] + s * L], [e[0] + c * L, e[2] - s * L]], src: "kind:" + k, e }); } } } catch (e) { note("rails kinds", e); }
    return out; }
  T.railRuns = railRuns;

  const I4 = new THREE.Matrix4();
  // ───────────────────────── the audit ─────────────────────────
  function audit(opts) {
    opts = opts || {}; const t0 = performance.now(); const items = []; const add = (type, x, z, src, detail) => items.push([type, Math.round(x * 10) / 10, Math.round(z * 10) / 10, src || "", detail || ""]);
    const B = ribs(); const FP = footprints(); const FG = gridOf(FP, 20, (b) => [b.x, b.z, Math.max(b.hx, b.hz)]);
    const site = (type) => { const S = new Map(); return { hit(x, z, src, d) { const k = Math.floor(x / 8) * 100003 + Math.floor(z / 8); let s = S.get(k); if (!s) S.set(k, s = { x, z, src, n: 0, d }); s.n++; }, flush() { for (const s of S.values()) add(type, s.x, s.z, s.src, s.n + " m" + (s.d ? " " + s.d : "")); } }; };
    // 1. step: a raised ribbon edge standing on another paved surface
    { const S = site("step"), S2 = site("step_soft"); for (const R of B.list) { if (R.air || R.bed || R.deck || R.lift < 0.08 || R.w < 1.2) continue; const own = R; const SS = R.soft ? S2 : S;
        const test = (ix, iz, ox, oz) => { const pz = plazaAt(ox, oz, -0.2); const pzOK = pz && (pz[3] || !R.soft); const other = ribsAt(ox, oz, 0.15).filter(([O]) => O !== own && O.hard && O.src !== own.src);   /* a promenade's own records (a raised median, boardwalks) are designed steps */ if (!pzOK && !other.length) return; if (polyD(own.pts, ox, oz) < own.hw + 0.05) return;
          const yi = walk(ix, iz); if (yi === null) return; if (Math.abs(yi - ownTopAt(own, ix, iz)) > 0.1) return;   /* the surface there is another one (a deck, a module slab), not this ribbon */ let yo = walk(ox, oz); const g = getH(ox, oz); if (yo === null || yo < g) yo = g; const d = yi - yo; if (d > 0.06) SS.hit(ox, oz, R.src, (pzOK ? "on plaza" : "on " + other[0][0].src)); };
        along(R.pts, 1.0, (x, z, ux, uz) => { for (const sd of [-1, 1]) { const nx = -uz * sd, nz = ux * sd; const ii = Math.min(0.6, R.hw * 0.5); test(x + nx * (R.hw - ii), z + nz * (R.hw - ii), x + nx * (R.hw + 0.3), z + nz * (R.hw + 0.3)); } });
        for (const which of [0, 1]) { const p = R.pts, n = p.length; const e = which ? p[n - 1] : p[0], f = which ? p[n - 2] : p[1]; const L = Math.hypot(e[0] - f[0], e[1] - f[1]) || 1; const ux = (e[0] - f[0]) / L, uz = (e[1] - f[1]) / L;
          for (let o = -R.hw + 0.5; o <= R.hw - 0.5; o += 1) { const bx = e[0] - uz * o, bz = e[1] + ux * o; test(bx - ux * 0.6, bz - uz * 0.6, bx + ux * 0.3, bz + uz * 0.3); } } }
      S.flush(); S2.flush(); }
    // 2. jag: small tilted triangles in the path dressing (plan_paths, plan_enrich) and the ribbons themselves
    { const S = site("jag"); scene.traverse((o) => { if (!o.isMesh || !o.geometry || !o.visible) return; const u = o.userData || {}; if (!(u.pp || u.e1 || u.planRibbons || u.planShoulders)) return; if (o.isInstancedMesh) return; const m0 = Array.isArray(o.material) ? o.material[0] : o.material; if (m0 && m0.normalScale && Math.abs(m0.normalScale.x - 1.2) < 1e-3 && m0.vertexColors) return;   /* the gravel shoulders are graded slopes by design */
        const pa = o.geometry.attributes.position; if (!pa) return; const ix = o.geometry.index; const n = ix ? ix.count : pa.count; const tag = u.pp ? "paths" : u.e1 ? "enrich" : u.planShoulders ? "shoulder" : "ribbon"; const A = [0, 0, 0], Bv = [0, 0, 0], Cv = [0, 0, 0];
        for (let t = 0; t + 2 < n; t += 3) { const a = ix ? ix.getX(t) : t, b = ix ? ix.getX(t + 1) : t + 1, c = ix ? ix.getX(t + 2) : t + 2; A[0] = pa.getX(a); A[1] = pa.getY(a); A[2] = pa.getZ(a); Bv[0] = pa.getX(b); Bv[1] = pa.getY(b); Bv[2] = pa.getZ(b); Cv[0] = pa.getX(c); Cv[1] = pa.getY(c); Cv[2] = pa.getZ(c);
          const e1x = Bv[0] - A[0], e1y = Bv[1] - A[1], e1z = Bv[2] - A[2], e2x = Cv[0] - A[0], e2y = Cv[1] - A[1], e2z = Cv[2] - A[2]; const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x; const L = Math.hypot(nx, ny, nz); if (L < 1e-6) continue; const cy = Math.abs(ny / L);
          if (cy < 0.25 || cy > 0.92) continue; const ext = Math.max(Math.hypot(e1x, e1z), Math.hypot(e2x, e2z), Math.hypot(Cv[0] - Bv[0], Cv[2] - Bv[2])); const spread = Math.max(A[1], Bv[1], Cv[1]) - Math.min(A[1], Bv[1], Cv[1]); if (ext > 1.2 || spread < 0.1) continue;
          const mx = (A[0] + Bv[0] + Cv[0]) / 3, mz = (A[2] + Bv[2] + Cv[2]) / 3; S.hit(mx, mz, tag, ""); } }); S.flush(); }
    // 3. overlap: two lifted ribbons stacked at a visibly different level
    { const pairs = new Map(); for (const R of B.list) { if (!R.hard || R.lift < 0.08) continue;
        along(R.pts, 1.5, (x, z, ux, uz) => { for (const f of [-0.6, -0.2, 0.2, 0.6]) { const px = x - uz * R.hw * f, pz = z + ux * R.hw * f; for (const [O] of ribsAt(px, pz, 0.3)) { if (O === R || O.i < R.i || !O.hard || O.lift < 0.08) continue; if (Math.abs(O.lift - R.lift) < 0.012) continue; if (T.cutAt && (T.cutAt(R.r, px, pz) || T.cutAt(O.r, px, pz))) continue;   /* one of them is not drawn here */
            if (!T.off && Math.abs(ownTopAt(R, px, pz) - ownTopAt(O, px, pz)) < 0.02) continue;   /* drawn at one level here (an eased end on the road it meets) */ const k = R.i * 100003 + O.i; let pr = pairs.get(k); if (!pr) pairs.set(k, pr = { R, O, n: 0, x: px, z: pz }); pr.n++; } } }); }
      for (const pr of pairs.values()) { const area = pr.n * 1.5 * pr.R.hw * 0.4 * 2 / 2; if (area < 6) continue; add("overlap", pr.x, pr.z, pr.R.src, "on " + pr.O.src + " " + Math.round(area) + " m2, lifts " + pr.R.lift.toFixed(3) + "/" + pr.O.lift.toFixed(3)); } }
    // 4. kerb2: raised kerb tops (narrow horizontal quads) running side by side over paving with no bed between them
    { const K = []; scene.traverse((o) => { if (!o.isMesh || !o.geometry || o.isInstancedMesh || !o.visible || o.isSkinnedMesh) return; const u = o.userData || {}; const pa = o.geometry.attributes.position; if (!pa || pa.count % 4 !== 0 || pa.count > 3000000) return; const mm = Array.isArray(o.material) ? o.material[0] : o.material; if (mm && mm.metalness > 0.4) return; o.updateMatrixWorld(); if (!o.matrixWorld.equals(I4)) return;   /* world-space merged geometry only (kerbs are built that way) */
        for (let v = 0; v + 3 < pa.count; v += 4) { const y0 = pa.getY(v), y1 = pa.getY(v + 1), y2 = pa.getY(v + 2), y3 = pa.getY(v + 3); if (Math.max(y0, y1, y2, y3) - Math.min(y0, y1, y2, y3) > 0.06) continue;
          const ax = pa.getX(v), az = pa.getZ(v), bx = pa.getX(v + 1), bz = pa.getZ(v + 1), dx = pa.getX(v + 3), dz = pa.getZ(v + 3); const L = Math.hypot(bx - ax, bz - az), W = Math.hypot(dx - ax, dz - az); if (L < 0.4 || L > 4.5 || W < 0.12 || W > 0.5) continue;
          const cx = (ax + bx + pa.getX(v + 2) + dx) / 4, cz = (az + bz + pa.getZ(v + 2) + dz) / 4, y = (y0 + y1 + y2 + y3) / 4; const ux = (bx - ax) / L, uz = (bz - az) / L;
          // raised: the surface just beside both long sides is lower by 5 cm or more
          const sd = (o2) => { const x = cx - uz * o2, z = cz + ux * o2; const w = walk(x, z); const g = getH(x, z); return w === null || w < g ? g : w; }; const s1 = sd(W / 2 + 0.25), s2 = sd(-W / 2 - 0.25); const up = y - Math.max(s1, s2); if (up < 0.04 || up > 0.7) continue;   /* a kerb, not a beam or a roof slat */
          K.push({ x: cx, z: cz, ux, uz, L, W, y, src: u.pp ? "paths" : u.e1 ? "enrich" : (o.name || (o.parent && o.parent.name) || "other").slice(0, 24) }); } });
      const TR = []; for (const k in PLACE) if (/palm|mesquite|verde|ironwood|willow|olive|oak|acacia|tree|pine|e1_.*palm/.test(k)) for (const e of PLACE[k]) TR.push(e); const TG = gridOf(TR, 8, (e) => [e[0], e[2], 0]);
      const treeNear = (x, z) => { for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) for (const e of gridGet(TG, x + gx * 8, z + gz * 8)) if (Math.hypot(e[0] - x, e[2] - z) < 2.0) return true; return false; };   /* a tree base box: its own sides are parallel kerbs */
      const DR = dressRaster(); const dressed = (x, z) => DR.has(Math.floor(x / 0.5) * 100003 + Math.floor(z / 0.5));
      const KG = gridOf(K, 6, (k) => [k.x, k.z, 0]); const S = site("kerb2"); const seen = new Set();
      for (const a of K) { for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) for (const b of gridGet(KG, a.x + gx * 6, a.z + gz * 6)) { if (b === a || seen.has(b)) continue; if (Math.abs(a.ux * b.ux + a.uz * b.uz) < 0.97) continue; const dx = b.x - a.x, dz = b.z - a.z; const lat = Math.abs(-a.uz * dx + a.ux * dz), lon = Math.abs(a.ux * dx + a.uz * dz); if (lat < 0.35 || lat > 4.6 || lon > a.L / 2 + 0.2) continue;
          const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2; const under = ribsAt(mx, mz, -0.1); if (treeNear(mx, mz)) continue; if (dressed(mx, mz) || under.some(([O]) => O.bed || Math.abs(lat - O.w) < 0.7)) continue;   /* a bed between them, or the two edges of one walk */ const wm = walk(mx, mz); const gm = getH(mx, mz); const ym = wm === null || wm < gm ? gm : wm; if (wm === null && !plazaAt(mx, mz, 0)) continue;   /* between them: a walk or a plaza (not a bed, not the open ground) */
          if (Math.min(a.y, b.y) - ym < 0.04) continue; seen.add(a); S.hit(mx, mz, a.src + "+" + b.src, "gap " + lat.toFixed(2) + " m"); } }
      S.flush(); T.kerbTops = K.length; }
    // 5. rail: a railing through a building, a set piece, a pool deck or a raised slab
    { const S = site("rail"); const PB = POOLS.map(poolBox); for (const run of railRuns()) { const p = run.pts; if (p.length < 2) continue;
        along(p, 0.5, (x, z) => { let hit = null; for (const b of gridGet(FG, x, z)) { if (run.e && b.e === run.e) continue; if (inBox(b, x, z, 0.25)) { hit = "in " + b.k; break; } }
          if (!hit) for (const b of PB) if (inBox(b, x, z, 0.2)) { hit = "in pool deck"; break; }
          if (!hit) { const g = getH(x, z); const w = walk(x, z); const ring = /^plaza:/.test(run.src); if (w !== null && w - g > 0.25 && ring) { const rs = ribsAt(x, z, 0.4).filter(([O]) => !O.bed); if (!rs.length) hit = "on a raised slab " + (w - g).toFixed(2) + " m"; } }
          if (hit) S.hit(x, z, run.src, hit); }); }
      S.flush(); }
    // 6. pool: the pool deck against paths, plazas, POIs, keep-outs, rails and other buildings
    { const places = ((window.PLAN && PLAN.places) || []).filter((q) => typeof q.x === "number"); const rails = railRuns();
      for (const P of POOLS) { if (!P.home) P.home = homeOf(P); const b = poolBox(P); const why = []; const R0 = Math.hypot(b.hx, b.hz);
        // sample the deck on a 1 m grid
        const pts = []; for (let u = -b.hx + 0.3; u <= b.hx - 0.3 + 1e-6; u += 1) for (let v = -b.hz + 0.3; v <= b.hz - 0.3 + 1e-6; v += 1) pts.push([b.x + u * b.c + v * b.s, b.z - u * b.s + v * b.c]);
        let nr = 0, np = 0, nb = 0, nk = 0, nd = 0; const bset = new Set();
        for (const [x, z] of pts) { if (ribsAt(x, z, -0.6).some(([O]) => !O.bed)) nr++; else { try { if (window.PLAN_PATHS && PLAN_PATHS.near && PLAN_PATHS.near(x, z, 0)) nd++; } catch (e) {} } if (plazaAt(x, z, 1)) np++;
          for (const fb of gridGet(FG, x, z)) { if (fb.e === P.home) continue; if (inBox(fb, x, z, 0)) { bset.add(fb.k); nb++; break; } }
          try { for (const q of PLAN_KEEP_POLY) { const bb = q.bb; if (x < bb[0] || x > bb[1] || z < bb[2] || z > bb[3]) continue; if (planInPoly(q.poly, x, z)) { nk++; break; } } } catch (e) {} }
        if (nr) why.push("on a path (" + nr + " m2)"); if (nd) why.push("on a path edge (" + nd + " m2)"); if (np) why.push("on a plaza (" + np + " m2)"); if (nb) why.push("in " + [...bset].join("/") + " (" + nb + " m2)"); if (nk) why.push("in a venue keep-out (" + nk + " m2)");
        for (const q of places) { if (q.type === "district" || !(q.r > 0) || q.r > 120) continue; const d = Math.hypot(q.x - b.x, q.z - b.z); if (d < q.r + R0 * 0.6 && !/home|house|villa|casita|estate|lot|resid/i.test((q.type || "") + " " + q.id)) { why.push("at POI " + q.id); break; } }
        for (const run of rails) { let h = false; along(run.pts, 0.5, (x, z) => { if (!h && inBox(b, x, z, 0)) h = true; }); if (h) { why.push("under rail " + run.src); break; } }
        if (why.length) add("pool", P.x, P.z, P.kind || "pool", why.join(", ")); } }
    const counts = {}, outside = {}, inside = {}; for (const it of items) { counts[it[0]] = (counts[it[0]] || 0) + 1; const o = inArr(it[1], it[2]) ? inside : outside; o[it[0]] = (o[it[0]] || 0) + 1; }
    const res = { v: T.v, off: T.off, pools: POOLS.length, counts, outside, inside, items, ms: Math.round(performance.now() - t0) }; T.last = res;
    return opts.full ? res : { v: res.v, off: res.off, pools: res.pools, counts, outside, inside, ms: res.ms };
  }
  T.audit = audit;
  // the drawn top of ribbon R at (x, z) as plan_tidy draws it (its lift eased near the plazas)
  function ownTopAt(R, x, z) { const g = lowerTop({ pts: R.pts, hw0: R.hw, lift: 0 }, x, z); let L = R.lift;   /* the drawn cross-section (linear between the two edges), as ribbonNow lays it */ try { if (!T.off && T.planOf && R.r && R.r.pts) { const pl = T.planOf(R.r); if (pl) { let best = 1e9, sb = 0, acc = 0; const p = R.pts; for (let k = 0; k < p.length - 1; k++) { const a = p[k], b = p[k + 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-9) continue; let t = ((x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])) / (l * l); t = t < 0 ? 0 : t > 1 ? 1 : t; const d = Math.hypot(x - a[0] - (b[0] - a[0]) * t, z - a[1] - (b[1] - a[1]) * t); if (d < best) { best = d; sb = acc + t * l; } acc += l; }
      const pc = pl.pieces.find((q) => sb >= q.s0 - 0.01 && sb <= q.s1 + 0.01); if (pc) L = liftAt(pl, pc, sb, x, z, R.lift, true); let y = g + L;
      for (const X of pl.strips || []) { const d = polyD(X.pts, x, z) - X.hw0; if (d >= XRAMP) continue; const yt = lowerTop(X, x, z) - 0.015;   /* just under the crossed ribbon: it wins cleanly across the crossing */ y = Math.min(y, yt + (y - yt) * smooth(Math.max(0, d) / XRAMP)); } return y; } } } catch (e) {} return g + L; }
  // cells (0.5 m) covered by a dressed surface of plan_enrich or plan_paths that is not a kerb top: bed soil, gravel, island rings,
  // tree bases, planters (two kerbs with such a surface between them are a bed, not a double kerb)
  function dressRaster() { const S = new Set(); scene.traverse((o) => { if (!o.isMesh || !o.geometry || o.isInstancedMesh) return; const u = o.userData || {}; if (!(u.e1 || u.pp)) return; const pa = o.geometry.attributes.position; if (!pa) return; const ix = o.geometry.index; const n = ix ? ix.count : pa.count;
      for (let t = 0; t + 2 < n; t += 3) { const a = ix ? ix.getX(t) : t, b = ix ? ix.getX(t + 1) : t + 1, c = ix ? ix.getX(t + 2) : t + 2; const ax = pa.getX(a), az = pa.getZ(a), bx = pa.getX(b), bz = pa.getZ(b), cx = pa.getX(c), cz = pa.getZ(c); const ay = pa.getY(a), by = pa.getY(b), cy = pa.getY(c);
        if (Math.max(ay, by, cy) - Math.min(ay, by, cy) > 0.25) continue; const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)); if (area2 < 0.5) continue;   /* skip the thin kerb tops and setts */
        const minE = Math.min(Math.hypot(bx - ax, bz - az), Math.hypot(cx - bx, cz - bz), Math.hypot(ax - cx, az - cz)); if (minE < 0.55) continue;
        const x0 = Math.floor(Math.min(ax, bx, cx) / 0.5), x1 = Math.floor(Math.max(ax, bx, cx) / 0.5), z0 = Math.floor(Math.min(az, bz, cz) / 0.5), z1 = Math.floor(Math.max(az, bz, cz) / 0.5); if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4000) continue;
        const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(den) < 1e-9) continue;
        for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) { const px = (gx + 0.5) * 0.5, pz = (gz + 0.5) * 0.5; const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den; if (l1 < -0.05 || l2 < -0.05 || 1 - l1 - l2 < -0.05) continue; S.add(gx * 100003 + gz); } } }); return S; }

  // ═════════════════════════ THE FIXES (?tidy=0 turns them all off) ═════════════════════════
  // ───────────────────────── 1. walks meet plazas at the rim (step, jag, overlap, kerb2) ─────────────────────────
  // The plan draws its walks and roads to the plaza CENTRES (builders trim their dressing by the plaza radius), and the plazas are painted
  // into the ground shader at ground level. So every walk ran on into its plaza as a slab 0.2 to 0.36 m proud of the paving, slabs from
  // several directions overlapped at the centre at different lifts, and the plan_paths courses along their edges dropped to the paving in
  // a sawtooth. Fix at the drawing: ribbonNow (runtime override, client.js is Agent LD's) draws a ribbon only outside its plazas (cut
  // radius r - 0.55, where plan_paths lays the soldier course across the kerb opening), and the last RAMP metres before every cut
  // (and every end that stops at a plaza rim) ease down to the paving. The plan data (pts) stays as it is, so every builder that measures
  // from the plaza centre is unchanged. roadLiftAt (placement before the walk grid exists) follows the same profile.
  const RAMP = 4.5, CUTIN = 0.6, FLOOR = 0.015;
  const FX = { pz: null, n: -1 };
  function fixPlazas() { if (FX.pz && FX.n === PLAZAS.length) return FX.pz; const out = []; let MAXP = 32; try { MAXP = PLAZA_MAX; } catch (e) {}
    for (let i = 0; i < PLAZAS.length; i++) { const p = PLAZAS[i]; if (inArr(p[0], p[1])) continue;   /* the Arrivals zone's plazas (Arrivals Court) are Agent F2's */
      out.push({ x: p[0], z: p[1], r: p[2], rc: p[2] - CUTIN, floor: FLOOR + (i >= MAXP ? 0.1 : 0), paved: !!p[3] }); }
    FX.pz = out; FX.n = PLAZAS.length; return out; }
  T.fixPlazas = fixPlazas;
  function cutPlazaAt(x, z) { for (const q of fixPlazas()) if (q.paved && Math.hypot(x - q.x, z - q.z) < q.rc) return q; return null; }   /* paved plazas: every walk stops at the rim */
  T.inCut = (x, z) => !T.off && !!cutPlazaAt(x, z);
  T.inPlazaAny = (x, z) => { if (T.off) return false; for (const q of fixPlazas()) if (Math.hypot(x - q.x, z - q.z) < q.rc) return true; return false; };   /* soft ribbons are cut in every plaza */
  function atArc(pts, s) { let acc = 0; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-9) continue; if (acc + l >= s || i === pts.length - 2) { const t = Math.max(0, Math.min(1, (s - acc) / l)); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; } acc += l; } const q = pts[pts.length - 1]; return [q[0], q[1]]; }
  // the drawing plan of one polyline: the pieces outside the plazas, each with its ramped ends: { pieces: [{ pts, s0, s1, r0, r1, len }], any }
  // soft (dirt, track, red gravel) ribbons are cut in every plaza; paved walks are cut in paved plazas and only eased down (to EFLOOR) where
  // they cross an earth plaza (the Old West squares: the paved walk across the dirt square stays, flush)
  const EFLOOR = 0.06;
  // crossings (section 1b): the strips of lower ribbons that cut a given ribbon, keyed by its pts array
  const XS = (T.XS = T.XS || new Map()); let XV = 0;
  function cutPlan(points, width, soft) {
    const PZ = fixPlazas(); const strips = XS.get(points) || []; if (!PZ.length && !strips.length) return null; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const q of points) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < z0) z0 = q[1]; if (q[1] > z1) z1 = q[1]; }
    const near0 = PZ.filter((q) => q.x > x0 - q.r - 6 && q.x < x1 + q.r + 6 && q.z > z0 - q.r - 6 && q.z < z1 + q.r + 6); if (!near0.length && !strips.length) return null;
    const near = near0.filter((q) => q.paved || soft), earth = near0.filter((q) => !(q.paved || soft));
    const L = polyLen(points); if (!(L > 0.5)) return null; const st = 0.25; const n = Math.max(2, Math.ceil(L / st)); const ins = new Uint8Array(n + 1), dens = new Uint8Array(n + 1);
    let any = false; for (let i = 0; i <= n; i++) { const q = atArc(points, L * i / n); for (const pz of near) if (Math.hypot(q[0] - pz.x, q[1] - pz.z) < pz.rc) { ins[i] = 1; any = true; break; }
      if (strips.length && !ins[i]) for (const X of strips) if (polyD(X.pts, q[0], q[1]) < X.hw0 + XRAMP + (width || 0) / 2 + 1) { dens[i] = 1; break; } }
    const endOf = (c) => c >= 2 ? { f: strips[c - 2].floor, R: XRAMP, x: true, X: strips[c - 2] } : { f: FLOOR, R: RAMP };
    // ends that stop at a plaza rim without entering it (up to 1.5 m outside the rim) ramp down too
    const rimEnd = (q) => near.some((pz) => { const d = Math.hypot(q[0] - pz.x, q[1] - pz.z); return d >= pz.rc && d < pz.r + 1.5; });
    const e0 = !ins[0] && rimEnd(points[0]), e1 = !ins[n] && rimEnd(points[points.length - 1]);
    let skim = false; if (!any) { const hw = (width || 0) / 2; for (let i = 0; i <= n && !skim; i += 4) { const q = atArc(points, L * i / n); for (const pz of near0) if (Math.hypot(q[0] - pz.x, q[1] - pz.z) < pz.r + hw + 0.5) { skim = true; break; } } }
    if (!any && !e0 && !e1 && !skim && !strips.length) return null;
    const pieces = []; let i = 0; while (i <= n) { if (ins[i]) { i++; continue; } let j = i; while (j < n && !ins[j + 1]) j++; const s0 = L * i / n, s1 = L * j / n;
      if (s1 - s0 > 0.3) pieces.push({ s0, s1, r0: i > 0 || e0, r1: j < n || e1, a: i > 0 ? endOf(ins[i - 1]) : e0 ? endOf(1) : null, b: j < n ? endOf(ins[j + 1]) : e1 ? endOf(1) : null }); i = j + 1; }
    for (const pc of pieces) { // the piece's centre line, densified to 0.5 m within RAMP + 1 m of a ramped end
      const pts = []; const step = (s) => ((pc.r0 && s - pc.s0 < RAMP + 1) || (pc.r1 && pc.s1 - s < RAMP + 1) || dens[Math.max(0, Math.min(n, Math.round(s / L * n)))]) ? 0.5 : 3.0; let s = pc.s0; while (s < pc.s1 - 1e-6) { pts.push(atArc(points, s)); s = Math.min(pc.s1, s + step(s)); } pts.push(atArc(points, pc.s1));
      const tp = points.taper; if (tp) { const t0 = pc.s0 < 0.01 ? tp[0] : 0, t1 = pc.s1 > L - 0.01 ? tp[1] : 0; if (t0 > 0 || t1 > 0) pts.taper = [t0, t1]; }
      pc.pts = pts; pc.len = pc.s1 - pc.s0; }
    return { pieces, L, any, near, earth, strips };
  }
  const smooth = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  // ramp factor at arc s of a piece (1 = the ribbon's own lift, 0 = flush with the paving)
  // the lift at arc s from the piece's two ramped ends (each eases to its own floor: the paving, or the crossed road's top)
  function endLiftP(pc, s, lift) { let v = lift; for (const [E, d] of [[pc.a, s - pc.s0], [pc.b, pc.s1 - s]]) { if (!E || E.x || E.f >= lift) continue; const R = Math.min(E.R, pc.len * 0.5); v = Math.min(v, E.f + (lift - E.f) * smooth(d / R)); } return v; }
  function endLift(pc, s, lift) { let v = lift; for (const [E, d] of [[pc.a, s - pc.s0], [pc.b, pc.s1 - s]]) { if (!E || E.f >= lift) continue; const R = Math.min(E.R, pc.len * 0.5); v = Math.min(v, E.f + (lift - E.f) * smooth(d / R)); } return v; }
  function lowerTop(X, x, z) { const p = X.pts; let best = 1e9, bk = 0, bt = 0; for (let k = 0; k < p.length - 1; k++) { const a = p[k], b = p[k + 1]; const vx = b[0] - a[0], vz = b[1] - a[1]; const L2 = vx * vx + vz * vz; if (L2 < 1e-9) continue; let t = ((x - a[0]) * vx + (z - a[1]) * vz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; const d = Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t); if (d < best) { best = d; bk = k; bt = t; } }
    const a = p[bk], b = p[bk + 1]; const cx = a[0] + (b[0] - a[0]) * bt, cz = a[1] + (b[1] - a[1]) * bt; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; const hw = X.hw0;
    const hc = getH(cx, cz); const hl = Math.max(getH(cx + nx * hw, cz + nz * hw), hc - 0.35), hr = Math.max(getH(cx - nx * hw, cz - nz * hw), hc - 0.35); const off = Math.max(-1, Math.min(1, ((x - cx) * nx + (z - cz) * nz) / hw)); return hl + (hr - hl) * (1 - off) / 2 + X.lift; }
  T.lowerTop = lowerTop;
  function rampK(pc, s) { const R = Math.min(RAMP, pc.len * 0.5); let k = 1; if (pc.r0) k = Math.min(k, smooth((s - pc.s0) / R)); if (pc.r1) k = Math.min(k, smooth((pc.s1 - s) / R)); return k; }
  // lower the drawn ribbon's vertices in the ramps (ribbonNow lays them in left/right pairs along the centre line)
  function radialK(near, x, z) { let k = 1; for (const q of near) { const d = Math.hypot(x - q.x, z - q.z) - q.r; if (d < RAMP) k = Math.min(k, smooth(d / RAMP)); } return k; }
  T.radialK = (x, z) => radialK(fixPlazas(), x, z);
  // the eased lift at (x, z) on piece pc at arc s
  function liftAt(plan, pc, s, x, z, lift, noX) { let v = Math.min(noX ? endLiftP(pc, s, lift) : endLift(pc, s, lift), FLOOR + (lift - FLOOR) * radialK(plan.near, x, z)); if (plan.earth.length && lift > EFLOOR) { const ke = radialK(plan.earth, x, z); v = Math.min(v, EFLOOR + (lift - EFLOOR) * ke); } return Math.min(lift, v); }
  T.liftAt = liftAt;
  function rampGeo(g, pc, lift, plan) { const pa = g.attributes.position; if (!pa || pa.count < 4) return; const drop = lift - FLOOR; if (!(drop > 0.004) && !(plan.strips && plan.strips.length)) return; let s = pc.s0, px = null, pz = null;
    for (let i = 0; i + 1 < pa.count; i += 2) { const cx = (pa.getX(i) + pa.getX(i + 1)) / 2, cz = (pa.getZ(i) + pa.getZ(i + 1)) / 2; if (px !== null) s += Math.hypot(cx - px, cz - pz); px = cx; pz = cz; 
      for (const v of [i, i + 1]) { const x = pa.getX(v), z = pa.getZ(v); const y0 = pa.getY(v); let y = y0; const L2 = liftAt(plan, pc, Math.min(s, pc.s1), x, z, lift, true); if (L2 < lift - 0.001) y = Math.max(y0 - (lift - L2), getH(x, z) + FLOOR);
        for (const X of plan.strips || []) { const d = polyD(X.pts, x, z) - X.hw0; if (d >= XRAMP) continue; const yt = lowerTop(X, x, z) - 0.015;   /* just under the crossed ribbon: it wins cleanly across the crossing */ y = Math.min(y, yt + (y0 - yt) * smooth(Math.max(0, d) / XRAMP)); }
        if (y !== y0) pa.setY(v, y); } }
    pa.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere(); }
  function emptyGeo() { const e = new THREE.BufferGeometry(); e.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3)); e.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(0), 2)); e.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(0), 3)); e.setIndex([]); return e; }
  function concatGeo(list) { let nv = 0, ni = 0; for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : 0; } const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni); let vo = 0, io = 0;
    for (const g of list) { pos.set(g.attributes.position.array, vo * 3); if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2); if (g.index) { const ia = g.index.array; for (let k = 0; k < ia.length; k++) idx[io + k] = ia[k] + vo; io += ia.length; } vo += g.attributes.position.count; g.dispose(); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals(); geo.computeBoundingSphere(); return geo; }
  function softMat(mat) { try { if (!mat) return false; if (typeof M !== "undefined" && (mat === M.dirt || mat === M.track)) return true; if (typeof PM !== "undefined" && mat === PM.redg) return true; if (typeof ROAD_MATS !== "undefined" && ROAD_MATS.get(mat) === true) return true; if (typeof EDGE_MATS !== "undefined") for (const [a, b] of EDGE_MATS) if (b === mat) return true; } catch (e) {} return false; }
  function installRibbon() {
    const orig = window.ribbonNow; if (typeof orig !== "function" || orig.__tidy) return false;
    const W = function (points, width, mat, lift, dashed) {
      let plan = null; try { if (!T.off && Array.isArray(points) && points.length >= 2 && !dashed && !(typeof M !== "undefined" && mat === M.deck) && (lift || 0) > 0.03) plan = cutPlan(points, width, softMat(mat)); } catch (e) { note("cutPlan", e); plan = null; }
      if (!plan) return orig.apply(this, arguments);
      const realAdd = window.walkAdd; const meshes = [];
      window.walkAdd = function () {};   // the walk grid keeps the highest surface, so it must only see the final (ramped) heights
      try { for (const pc of plan.pieces) { const m = orig.call(this, pc.pts, width, mat, lift, dashed); if (m && m.geometry) { rampGeo(m.geometry, pc, lift || 0, plan); meshes.push(m); } } } catch (e) { note("ribbon", e); } finally { window.walkAdd = realAdd; }
      cnt(plan.any ? "ribbonsCut" : "ribbonsRamped");
      if (meshes.length === 1) { realAdd(meshes[0].geometry); return meshes[0]; }
      const g = meshes.length ? concatGeo(meshes.map((m) => m.geometry)) : emptyGeo(); if (meshes.length) realAdd(g);
      return new THREE.Mesh(g, meshes.length ? meshes[0].material : mat); };
    W.__tidy = true; W.orig = orig; window.ribbonNow = W; return true; }
  // roadLiftAt (placement before the walk grid exists): the same profile, ribbon by ribbon, near the plazas only
  const PLANS = new WeakMap();
  function planOf(r) { const key = XV + ":" + r.pts.length + ":" + r.pts[0][0] + ":" + r.pts[r.pts.length - 1][1]; const c = PLANS.get(r); if (c && c.key === key) return c.plan; let plan = null; try { let mat = null; try { mat = ROAD_MAT.get(r); } catch (e) {} plan = cutPlan(r.pts, r.w, !!r.dirt || softMat(mat)); } catch (e) {} PLANS.set(r, { key, plan }); return plan; }
  T.cutPlan = cutPlan; T.planOf = planOf;
  function installLift() {
    const orig = window.roadLiftAt; if (typeof orig !== "function" || orig.__tidy) return false;
    const W = function (x, z) { const v = orig(x, z); if (T.off || !v) return v; let nearP = false; for (const q of fixPlazas()) if (Math.hypot(x - q.x, z - q.z) < q.r + RAMP + 2) { nearP = true; break; } if (!nearP) return v;
      try { let best = 0, hit = false; for (const r of ROADS) { if (!r || !r.lift || !r.pts || r.pts.length < 2) continue; let mat = null; try { mat = ROAD_MAT.get(r); } catch (e) {} const deck = typeof M !== "undefined" && mat === M.deck;
          let d = 1e9, s = 0, acc = 0; const p = r.pts; for (let k = 0; k < p.length - 1; k++) { const a = p[k], b = p[k + 1]; const vx = b[0] - a[0], vz = b[1] - a[1]; const L2 = vx * vx + vz * vz; const l = Math.sqrt(L2); if (l < 1e-9) continue; let t = ((x - a[0]) * vx + (z - a[1]) * vz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; const dd = Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t); if (dd < d) { d = dd; s = acc + t * l; } acc += l; }
          if (d > r.w / 2) continue; hit = true; if (deck || r.lift <= 0.03) { best = Math.max(best, r.lift); continue; }
          const plan = planOf(r); if (!plan) { best = Math.max(best, r.lift); continue; } const pc = plan.pieces.find((q) => s >= q.s0 - 0.01 && s <= q.s1 + 0.01); if (!pc) continue; best = Math.max(best, liftAt(plan, pc, s, x, z, r.lift)); }
        return hit ? best : v; } catch (e) { note("lift", e); return v; } };
    W.__tidy = true; W.orig = orig; window.roadLiftAt = W; return true; }

  // ───────────────────────── 1b. ribbons that cross or run onto a lower one (overlap) ─────────────────────────
  // A walk or road drawn across (or along) another at a different lift lay on top of it with a 3 to 10 cm lip and an open edge (the
  // ribbons have no fascia). R15 cut the boardwalks where a street crosses them; the same is done here for every other pair: the upper
  // ribbon is not drawn where its centre line is on the lower one, and its last XRAMP metres ease down to the lower one's top, so the
  // walk meets the road at grade; a soldier course goes across a hard walk at the meeting line (unless plan_paths has one there).
  const XRAMP = 2.5;
  // inside the Arrivals zone only these plan roads and walks (the Solport frontage and the Landing Boulevard joint, outside the court; F2
  // finished R18 and cleared them): terminal_drive, landside_walk and landing_blvd against arrivals_curb and gp_p_arrivals
  // (upper|lower). landside_walk over gp_p_arrivals is left as it was: the crossing is oblique and both are wide, so with ribbonNow's two
  // vertices across, the eased walk met the DG in a zigzag; the stone walk's straight edge 4 cm over the DG reads better until ribbons get
  // a centre vertex row
  const XZONE = new Set(["terminal_drive", "landing_blvd", "arrivals_curb", "gp_p_arrivals"]);
  const XZPAIR = new Set(["gp_p_arrivals|terminal_drive", "arrivals_curb|terminal_drive", "arrivals_curb|landing_blvd"]);
  function buildCrossings() { const B = ribs(); let nP = 0, nB = 0; const pairs = new Map();
    for (const R of B.list) { if (R.air || R.bed || R.deck || R.lift < 0.08) continue;
      along(R.pts, 1.0, (x, z) => { const zone = inArr(x, z); if (zone && !XZONE.has(R.src)) return; for (const [O] of ribsAt(x, z, 0.1)) { if (O === R || O.bed || O.deck || O.air || O.src === R.src) continue; if (zone && !XZPAIR.has(R.src + "|" + O.src)) continue; if (R.lift - O.lift < 0.012) continue; if (polyD(O.pts, x, z) > O.hw) continue; const k = R.i * 100003 + O.i; let pr = pairs.get(k); if (!pr) pairs.set(k, pr = { R, O, n: 0 }); pr.n++; } }); }
    for (const pr of pairs.values()) { if (pr.n < 2) continue; let a = XS.get(pr.R.pts); if (!a) XS.set(pr.R.pts, a = []); a.push({ pts: pr.O.pts, hw: pr.O.hw + 0.05, hw0: pr.O.hw, lift: pr.O.lift, floor: pr.O.lift + 0.006, src: pr.O.src }); nP++; }
    XV++; RIB.n = -1;
    try { const PP = window.PLAN_PATHS; if (PP && PP.bands) for (const R of B.list) { if (!R.hard) continue; const XL = XS.get(R.pts); if (!XL) continue; const L = polyLen(R.pts); let prev = null;
        for (let s = 0; s <= L; s += 0.25) { const q = atArc(R.pts, s); const inside = XL.some((X) => polyD(X.pts, q[0], q[1]) < X.hw0); if (prev !== null && inside !== prev) { const sb = inside ? s - 0.3 : s + 0.3; const a = atArc(R.pts, Math.max(0, sb - 0.25)), b = atArc(R.pts, Math.min(L, sb + 0.25)); const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const c = atArc(R.pts, sb);
            if (!PP.bands.some((bd) => bd.kind === "end" && Math.hypot(bd.x - c[0], bd.z - c[1]) < 2.0)) { PP.bands.push({ kind: "end", x: c[0], z: c[1], ux: (b[0] - a[0]) / l, uz: (b[1] - a[1]) / l, len: R.w + 0.3, wid: 0.5, src: R.src, soft: false, tidy: true }); nB++; } } prev = inside; } } } catch (e) { note("xbands", e); }
    cnt("crossPairs", nP); cnt("crossBands", nB); }
  // is ribbon rec r cut (not drawn) at arc s, or at the point (x, z)?
  T.cutAtArc = (r, s) => { if (T.off || !r || !r.pts) return false; const pl = planOf(r); if (!pl || !pl.any) return false; return !pl.pieces.some((q) => s >= q.s0 - 0.05 && s <= q.s1 + 0.05); };
  function arcOfPt(pts, x, z) { let best = 1e9, sb = 0, acc = 0; for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-9) continue; let t = ((x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])) / (l * l); t = t < 0 ? 0 : t > 1 ? 1 : t; const d = Math.hypot(x - a[0] - (b[0] - a[0]) * t, z - a[1] - (b[1] - a[1]) * t); if (d < best) { best = d; sb = acc + t * l; } acc += l; } return sb; }
  T.cutAt = (r, x, z) => T.cutAtArc(r, arcOfPt(r.pts, x, z));

  // ───────────────────────── 2. pools behind the homes (pool) ─────────────────────────
  // addPools (client.js) only kept pools off the roads (nearRoad 6 m) and other buildings' centres: it never looked at plazas, the plaza
  // railings, the dressed path edges, POIs or venue keep-outs, and it runs after every module has laid those out. The wrapper re-tests
  // every pool against all of them and, if it clashes, tries a smaller pool, then the home's two sides; if no spot is clean it drops it.
  function poolOK(P, home, rails, fpG, places) { const b = poolBox(P); const R0 = Math.hypot(b.hx, b.hz);
    if (typeof onLand === "function" && !onLand(P.x, P.z)) return "land"; try { if (distToRunway(P.x, P.z) < 60) return "runway"; } catch (e) {}
    for (let u = -b.hx; u <= b.hx + 1e-6; u += 1) for (let v = -b.hz; v <= b.hz + 1e-6; v += 1) { const x = b.x + u * b.c + v * b.s, z = b.z - u * b.s + v * b.c;
      if (ribsAt(x, z, -1.2).some(([O]) => !O.bed)) return "path"; try { if (window.PLAN_PATHS && PLAN_PATHS.near && PLAN_PATHS.near(x, z, 0.3)) return "path edge"; } catch (e) {}
      if (plazaAt(x, z, 2)) return "plaza"; for (const fb of gridGet(fpG, x, z)) { if (fb.e === home) continue; if (inBox(fb, x, z, -0.8)) return "building " + fb.k; }
      try { for (const q of PLAN_KEEP_POLY) { const bb = q.bb; if (x < bb[0] - 1 || x > bb[1] + 1 || z < bb[2] - 1 || z > bb[3] + 1) continue; if (planInPoly(q.poly, x, z)) return "keep-out"; } } catch (e) {}
      try { for (const s of SOLIDS) { if (!s || s.y1 - s.y0 < 0.5 || s.tag === "room") continue; if (Math.abs(s.x - x) < s.hw + 0.6 && Math.abs(s.z - z) < s.hd + 0.6 && Math.hypot(s.x - home[0], s.z - home[2]) > (MODELS_R(home) + 1)) return "solid"; } } catch (e) {} }
    for (const q of places) { const d = Math.hypot(q.x - b.x, q.z - b.z); if (d < q.r + R0 * 0.6) return "POI " + q.id; }
    for (const run of rails) { let h = false; along(run.pts, 0.5, (x, z) => { if (!h && inBox(b, x, z, -0.6)) h = true; }); if (h) return "rail"; }
    for (const q of POOLS) if (q !== P && Math.hypot(q.x - P.x, q.z - P.z) < 16) return "pool";
    return null; }
  let HOME_R = new WeakMap(); function MODELS_R(e) { return HOME_R.get(e) || 8; }
  function installPools() {
    const orig = window.addPools; if (typeof orig !== "function" || orig.__tidy) return false;
    const W = function () { const n0 = POOLS.length; orig.apply(this, arguments); if (T.off) return; const t0 = performance.now();
      try { RIB.n = -1; const FP = footprints(); const fpG = gridOf(FP, 20, (b) => [b.x, b.z, Math.max(b.hx, b.hz)]); const rails = railRuns();
        const places = ((window.PLAN && PLAN.places) || []).filter((q) => typeof q.x === "number" && q.r > 0 && q.r <= 120 && q.type !== "district" && !/home|house|villa|casita|estate|lot|resid/i.test((q.type || "") + " " + q.id));
        const list = POOLS.splice(n0); let kept = 0, moved = 0, dropped = 0; const why = {};
        for (const P of list) { const home = homeOf(P); if (!home) { POOLS.push(P); kept++; continue; } const kind = P.kind; const md = MODELS[kind]; const rr = md ? md.radius * home[4] : 8; HOME_R.set(home, rr); P.home = home;
          const tryAt = (side, w, d) => { const yaw = home[3] + side; const fx = Math.sin(yaw), fz = Math.cos(yaw); const ext = side === 0 ? rr : (md ? (side === 0 ? md.sz : md.sx) * home[4] / 2 : rr); const dist = (side === 0 ? rr : ext) + d / 2 + (side === 0 ? 4 : 3); const Q2 = { x: home[0] - fx * dist, z: home[2] - fz * dist, rot: side === 0 ? home[3] : home[3] + side, y: home[1], w, d, kind, home }; return Q2; };
          let ok = null, first = null;
          for (const [side, w, d] of [[0, P.w, P.d], [0, 5, 8], [Math.PI / 2, 5, 8], [-Math.PI / 2, 5, 8], [0, 4.2, 6.5]]) { const Q2 = side === 0 && w === P.w ? P : tryAt(side, w, d); const r = poolOK(Q2, home, rails, fpG, places); if (first === null) first = r; if (!r) { ok = Q2; break; } }
          if (ok) { POOLS.push(ok); if (ok === P) kept++; else { moved++; why[first] = (why[first] || 0) + 1; } } else { dropped++; why[first] = (why[first] || 0) + 1; } }
        T.n.pools = { kept, moved, dropped, why }; } catch (e) { note("pools", e); }
      T.t.pools = Math.round(performance.now() - t0); };
    W.__tidy = true; W.orig = orig; window.addPools = W; return true; }

  // ───────────────────────── 3. plaza railings and kerbs open round what stands on the ring (rail) ─────────────────────────
  // plan_enrich's ringScan tests the plaza ring against collider circles and solids, so a square building that straddles the ring (the
  // Crossing Plaza shade and shuttle shelter, the Garden pavilion), a raised slab across it (the golf putting green) or a pool deck got
  // the railing and the kerb run straight through it. After plan_enrich has laid the ring out (its late world hook) and before it builds
  // the meshes (DEFER), every ring sample inside a building's footprint (+0.4 m) or on a raised slab is blocked, and the kerb and rail
  // runs are cut there, with the same minimum lengths plan_enrich uses.
  function ringFix(deferPass) { const E = window.PLAN_ENRICH; if (!E || !E.plazas || !E.plazas.length) return; const FP = footprints(); const fpG = gridOf(FP, 20, (b) => [b.x, b.z, Math.max(b.hx, b.hz)]); let cutR = 0, cutK = 0;
    let greens = []; try { greens = (window.PLAN_LAND && PLAN_LAND.golf && PLAN_LAND.golf.greens) || []; } catch (e) {}
    const blocked = (x, z) => { for (const b of gridGet(fpG, x, z)) { if (/^e1_|lamp|bench|tree|palm/.test(b.k)) continue; if (inBox(b, x, z, -0.4)) return b.k; } for (const g of greens) if (Math.hypot(x - g[0], z - g[1]) < g[2] + 0.6) return "green";
      if (deferPass) { const w = walk(x, z); if (w !== null && w - getH(x, z) > 0.25 && !ribsAt(x, z, -0.6).some(([O]) => !O.bed)) return "slab"; }   /* a raised slab (a green, a deck) the walk grid already holds */
      return null; };   /* a putting green is a raised slab */
    for (const p of E.plazas) { if (inArr(p.x, p.z)) continue; const n = p.S.length; if (!n) continue; const at = (i) => p.S[((i % n) + n) % n]; const bad = new Uint8Array(n);
      for (let i = 0; i < n; i++) { const q = at(i); if (blocked(q.x, q.z)) bad[i] = 1; }
      if (!bad.some((v) => v)) continue; const arc = 6.2832 * p.R / n;
      const split = (list, minLen) => { const out = []; for (const [i0, len] of list) { let k = 0; while (k <= len) { while (k <= len && bad[(((i0 + k) % n) + n) % n]) k++; let j = k; while (j <= len && !bad[(((i0 + j) % n) + n) % n]) j++; const L = j - k - 1; if (L * arc >= minLen) out.push([i0 + k, L]); k = j; } } return out; };
      const r0 = p.rails.length, k0 = p.kerbs.length; const trim = Math.ceil(0.6 / arc);
      p.rails = split(p.rails, 2.4).map(([i0, len]) => [i0 + (bad[(((i0 - 1) % n) + n) % n] ? trim : 0), len - (bad[(((i0 - 1) % n) + n) % n] ? trim : 0) - (bad[(((i0 + len + 1) % n) + n) % n] ? trim : 0)]).filter(([, len]) => len * arc >= 2.0);
      p.kerbs = split(p.kerbs, 0.8); cutR += Math.abs(p.rails.length - r0) + 1; cutK += Math.abs(p.kerbs.length - k0) + 1; p.tidy = true; cnt("ringPlazas"); }
    cnt("ringRailRuns", cutR); }
  // posts and lamps plan_enrich stood on the ring inside such a footprint step out of it (moved to the nearest free ring spot outside)
  // ───────────────────────── 4. the Club Walk median kerbs stop where its bed stops (kerb2) ─────────────────────────
  // plan_crossing.js lays the Club Walk median kerbs (two cantera kerbs, 0.42 m high, 4.1 m apart) from 6 m after the walk's start to 3 m
  // before its end, but the walk runs on to the centres of Arrivals Court and the Crossing Plaza while the palm bed between the kerbs
  // (planMedianBed) stops 1 m outside each plaza. Inside the plazas that left two bare kerbs side by side on the paving. The kerb quads
  // (and their solids) inside a plaza outside the Arrivals zone are removed here; the Arrivals Court end is Agent F2's (see the handoff).
  function medianFix() { let n = 0, ns = 0; const PZ = fixPlazas(); if (!PZ.length) return;
    scene.traverse((o) => { if (!o.isMesh || !o.geometry || o.isInstancedMesh) return; const nm = (o.name || "") + " " + ((o.parent && o.parent.name) || ""); if (!/clubwalk_arcade|club walk arcade|club_arcade/i.test(nm)) return;
      const mat = o.material; const pa = o.geometry.attributes.position; if (!pa || pa.count % 4 !== 0) return;
      // only the kerb geometry: 0.3 m wide strips 0.42 m tall (tops) and their faces
      let hitAny = false; for (let v = 0; v + 3 < pa.count; v += 4) { const cx = (pa.getX(v) + pa.getX(v + 1) + pa.getX(v + 2) + pa.getX(v + 3)) / 4, cz = (pa.getZ(v) + pa.getZ(v + 1) + pa.getZ(v + 2) + pa.getZ(v + 3)) / 4; const pz = PZ.find((q) => Math.hypot(cx - q.x, cz - q.z) < q.r + 0.3); if (!pz) continue;
        const ys = [pa.getY(v), pa.getY(v + 1), pa.getY(v + 2), pa.getY(v + 3)]; const span = Math.max(...ys) - Math.min(...ys); const w = Math.hypot(pa.getX(v + 3) - pa.getX(v), pa.getZ(v + 3) - pa.getZ(v));
        const top = Math.abs(ys[0] - ys[3]) < 0.03 && Math.abs(ys[1] - ys[2]) < 0.03 && w > 0.25 && w < 0.35, rise = ys[3] - ys[0], face = w < 0.05 && Math.abs(rise) > 0.4 && Math.abs(rise) < 0.52; if (!top && !face) continue;   /* the kerb's top (0.3 m wide) and its faces and end caps (0.47 m tall) only */
        for (let k = 1; k < 4; k++) { pa.setXYZ(v + k, pa.getX(v), pa.getY(v), pa.getZ(v)); } n++; hitAny = true; }
      if (hitAny) { pa.needsUpdate = true; o.geometry.computeBoundingSphere(); } });
    if (n) for (let i = SOLIDS.length - 1; i >= 0; i--) { const s = SOLIDS[i]; if (!s || s.tag !== "world") continue; if (Math.abs(Math.min(s.hw, s.hd) - 0.15) > 0.02 || Math.abs((s.y1 - s.y0) - 0.72) > 0.05) continue; if (!PZ.some((q) => Math.hypot(s.x - q.x, s.z - q.z) < q.r + 0.3)) continue; const cw = window.PLAN && PLAN.promenades && PLAN.promenades.find((pr) => pr.id === "hl1_club_walk"); if (!cw || polyD(cw.pts, s.x, s.z) > 3) continue; SOLIDS.splice(i, 1); ns++; }
    cnt("medianQuads", n); cnt("medianSolids", ns);
    try { if (ns && typeof SOLIDGRID !== "undefined" && SOLIDGRID) SOLIDGRID.n = -1; } catch (e) {} }

  // ───────────────────────── 5. re-seat the props next to the eased walks (R8 style) ─────────────────────────
  // Benches, signs, lamps, bins and planters placed in the world phase on a walk that plan_tidy now eases down (plaza ramps, crossings)
  // were seated on the old height; once planSeatProps has run (after DEFER) they are re-seated on the drawn surface (planSeatEntry also
  // moves their instance and solid). Only props within the eased zones are touched.
  function reseatProps() { let n = 0, up = 0, down = 0; const PZ = fixPlazas(); const ends = [];
    try { for (const XL of XS.values()) for (const X of XL) along(X.pts, 2, (x, z) => ends.push([x, z, X.hw0 + XRAMP + 2])); } catch (e) {}   /* along the crossed ribbons: the blends */
    const EG = gridOf(ends, 10, (q) => [q[0], q[1], 0]); const nearEnd = (x, z) => { for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) for (const q of gridGet(EG, x + gx * 10, z + gz * 10)) if (Math.hypot(q[0] - x, q[1] - z) < q[2]) return true; return false; };
    const inZone = (x, z) => { if (inArr(x, z)) return nearEnd(x, z);   /* in the Arrivals zone: only next to the cleared blends */ for (const q of PZ) if (Math.hypot(x - q.x, z - q.z) < q.r + RAMP + 2) return true; return nearEnd(x, z); };
    // in the eased zones a prop follows the drawn surface up or down; anywhere else (outside the Arrivals zone) a street prop that stands
    // under a drawn walk (sunken 2 to 45 cm: a lamp or bench left on the bare ground under a ribbon) is lifted onto it
    for (const kind in PLACE) { const sp = MODEL_SPECS[kind], m = MODELS[kind]; if (!sp || !sp.prop || !m) continue; if (!/bench|seat|chair|sign|post|kiosk|board|pillar|marker|lamp|lantern|light|bollard|bin|planter|table|pot/i.test(kind) || /palm|tree|cact|shrub/i.test(kind)) continue;
      for (const e of PLACE[kind]) { if (inArr(e[0], e[2]) && !nearEnd(e[0], e[2])) continue; const zone = inZone(e[0], e[2]); let y; try { y = seatY(kind, e, m); } catch (er) { continue; } const dy = y - e[1]; if (Math.abs(dy) < 0.02 || Math.abs(dy) > 0.6) continue; if (!zone && !(dy > 0.02 && dy < 0.45 && walk(e[0], e[2]) !== null)) continue;
        try { planSeatEntry(kind, e, y); n++; if (dy > 0) up++; else down++; } catch (er) { note("reseat " + kind, er); } } }
    T.n.reseat = { n, up, down }; }
  // ───────────────────────── 6. the Crossing Plaza inlay ─────────────────────────
  // With the walks stopping at its rim the plaza is one grey disc; a flush travertine inlay (the walks' own stone) gives it a pattern: a band
  // ring near the rim, a ring round the centre and a spoke from each walk mouth to the centre ring. Drawn with the plain ribbon builder
  // (walkable, 2 cm over the paving), merged into one mesh in the plan stone material (no new program).
  const INLAY = { pz_crossing: { outer: 26.0, inner: 8.5, band: 2.2, ring: 1.6, spoke: 3.2 } };
  function plazaInlays() { const orig = window.ribbonNow && window.ribbonNow.orig; if (!orig || !window.PLAN) return; let mat = null; try { mat = planMats().stone; } catch (e) {} if (!mat) return; const list = [];
    for (const z of PLAN.plazas || []) { const cfg = INLAY[z.id]; if (!cfg || inArr(z.x, z.z)) continue;
      const ring = (R, w) => { const pts = []; const n = Math.max(48, Math.round(6.2832 * R / 1.5)); for (let i = 0; i <= n; i++) { const a = i / n * 6.2832; pts.push([z.x + Math.cos(a) * R, z.z + Math.sin(a) * R]); } return [pts, w]; };
      const parts = [ring(cfg.outer, cfg.band), ring(cfg.inner, cfg.ring)];
      // a spoke on the axis of every walk or road that arrives at this plaza
      const angs = []; for (const r of ROADS) { if (!r || !r.pts || r.pts.length < 2 || !(r.lift > 0.08)) continue; let mt = null; try { mt = ROAD_MAT.get(r); } catch (e) {} if (typeof M !== "undefined" && mt === M.deck) continue;
        for (const e of [r.pts[0], r.pts[r.pts.length - 1]]) { const d = Math.hypot(e[0] - z.x, e[1] - z.z); if (d > z.r - 1) continue; const other = e === r.pts[0] ? r.pts[1] : r.pts[r.pts.length - 2]; let ax = other[0] - z.x, az = other[1] - z.z; if (d > 3) { ax = e[0] - z.x; az = e[1] - z.z; } const a = Math.atan2(az, ax); if (!angs.some((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.25)) angs.push(a); } }
      for (const a of angs) { const c = Math.cos(a), sn = Math.sin(a); parts.push([[[z.x + c * (cfg.inner + cfg.ring / 2), z.z + sn * (cfg.inner + cfg.ring / 2)], [z.x + c * (cfg.outer - cfg.band / 2), z.z + sn * (cfg.outer - cfg.band / 2)]], cfg.spoke]); }
      for (const [pts, w] of parts) { try { const m = orig(pts, w, mat, 0.02, false); if (!m) continue; const uv = m.geometry.attributes.uv; const k = w / 4.5; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k); list.push(m); } catch (e) { note("inlay", e); } }
      cnt("inlaySpokes", angs.length); }
    if (!list.length) return; const mm = mergeMeshes(list, mat); mm.receiveShadow = true; mm.castShadow = false; mm.userData.noShadow = true; mm.userData.noCull = true; mm.userData.tidyInlay = true; mm.renderOrder = 0; scene.add(mm); cnt("inlays"); }

  // ───────────────────────── install ─────────────────────────
  // plan phase (after client.js is parsed, before the world): the drawing and lift overrides and the pool pass
  window.PLAN_HOOKS.plan.push({ name: "tidyPlan", fn: function () { if (T.off) return; try { T.inst = { ribbon: installRibbon(), lift: installLift(), pools: installPools() }; } catch (e) { note("install", e); } } });
  // world phase: a late hook after plan_enrich's late hook (it lays out the plaza rings there)
  window.PLAN_HOOKS.world.push({ name: "tidyWorld", fn: function () { if (T.off) return; window.PLAN_HOOKS.world.push({ name: "tidyLate", fn: function () { try { ringFix(); } catch (e) { note("ring", e); } try { buildCrossings(); } catch (e) { note("cross", e); } } }); } });
  // the defer front (before plan_enrich builds the ring meshes): the ring again, now that the terrain hooks have laid the putting greens
  window.PLAN_HOOKS.defer.unshift({ name: "tidyRingDefer", fn: function () { if (T.off) return; try { ringFix(true); } catch (e) { note("ring2", e); } } });
  window.PLAN_HOOKS.defer.push({ name: "tidyDefer", fn: function () { if (T.off) return; try { medianFix(); } catch (e) { note("median", e); } try { plazaInlays(); } catch (e) { note("inlays", e); } T.ready = true; } });
  // once, after planSeatProps (after DEFER): the props next to the eased walks
  window.PLAN_HOOKS.frame.push({ name: "tidyReseat", fn: function () { if (T.off || T.reseated || !T.ready) return; try { if (typeof XG === "undefined" || XG.seated === undefined) return; } catch (e) { return; } T.reseated = true; const t0 = performance.now(); try { reseatProps(); } catch (e) { note("reseat", e); } T.t.reseat = Math.round(performance.now() - t0); } });
  // metres of each category (the site counts above group samples into 8 m cells)
  T.metres = function () { const r = T.last; if (!r) return null; const m = {}; for (const it of r.items) { const v = parseFloat(it[4]) || 0; if (/ m/.test(it[4]) && it[0] !== "pool" && it[0] !== "overlap") m[it[0]] = (m[it[0]] || 0) + v; } return m; };
})();
