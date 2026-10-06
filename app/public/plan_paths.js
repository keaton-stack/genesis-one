// R15: path network fixes, edging, curbs and the rhythm of lamps and planting along every path.
// plan_paths.js (R15 Agent A, PLAN mode only). Three parts:
//  1. PLAN_PATHS.audit(): an in-game checker over every walkable ribbon in ROADS (plan.json roads and promenades, the R7/R8 module
//     paths, plan_enrich, plan_rides, plan_land, plan_outpost, plan_stargaze, plan_domes...). It reports open ends (a hard cut in the
//     open), dead ends, crossings and parallel overlaps of different materials, z-fight pairs, hard material seams (path into a
//     plaza or another surface with no transition), ribbons over or under the terrain, and orphan ribbons. PLAN_PATHS.mapPNG() draws
//     the network with the issues marked.
//  2. The network fixes (?paths=0 turns all of them off for A/B): plan data patches (PLAN_HOOKS.plan), feathered open ends on dirt
//     (ribbonNow points.taper), termini (a small paved node with a bench, a planter and a lantern) at the open ends of paved walks,
//     junction pads where different materials cross, soldier-course thresholds where a walk enters a plaza, and the edge treatments.
//  3. An API for the fill agents: PLAN_PATHS.near(x, z, margin), PLAN_PATHS.dist(x, z), PLAN_PATHS.edges.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
if (!window.PLAN_HOOKS.plan) window.PLAN_HOOKS.plan = [];
(function () {
  const Q = new URLSearchParams(location.search);
  const OFF = Q.get("paths") === "0";
  const PP = window.PLAN_PATHS = { off: OFF, errs: [], n: {}, t: {}, treat: new Map(), termini: [], pads: [], bands: [], last: null, ready: false, ver: "r15a-1" };
  const note = (k, e) => { if (PP.errs.length < 40) PP.errs.push(k + ": " + ((e && e.stack) || e)); console.error("plan_paths " + k + " failed:", (e && e.stack) || e); };
  const cnt = (k, d) => { PP.n[k] = (PP.n[k] || 0) + (d === undefined ? 1 : d); };
  // the Arrivals zone belongs to Agent F (x -70..270, z -260..75): paths are only fixed outside it
  const ARR = { x0: -70, x1: 270, z0: -260, z1: 75 };
  const inArr = (x, z) => x >= ARR.x0 && x <= ARR.x1 && z >= ARR.z0 && z <= ARR.z1;
  const nearArrEdge = (x, z, m) => x >= ARR.x0 - m && x <= ARR.x1 + m && z >= ARR.z0 - m && z <= ARR.z1 + m && !(x >= ARR.x0 + m && x <= ARR.x1 - m && z >= ARR.z0 + m && z <= ARR.z1 - m);
  PP.inArrivals = inArr;

  // ───────────────────────── the ribbon list ─────────────────────────
  // material keys: soft (dirt, track, redg), dg, paved (stone, chip, walk, asphalt, taxi, sp), deck, bed
  function mkOf(r) {
    let m = null; try { m = ROAD_MAT.get(r) || null; } catch (e) {}
    if (m) { try { if (m === M.dirt) return "dirt"; if (m === M.track) return "track"; if (m === M.deck) return "deck"; if (m === M.walk) return "walk"; if (m === M.asphalt) return "asphalt"; if (m === M.taxi) return "taxi"; if (m === M.apron) return "apron";
      if (m === PM.stone) return "stone"; if (m === PM.dg) return "dg"; if (m === PM.redg) return "redg"; if (m === PM.chip) return "chip"; if (m === PM.bed) return "bed"; } catch (e) {}
      return "m:" + (m.name || (m.color ? m.color.getHexString() : "x")); }
    if (r.sp) return "sp"; if (r.bed || r.e1bed || r.enrichBed) return "bed"; if (r.plan === "gp_p_overlook") return "dg";
    return r.dirt ? "dirt?" : "pave?";
  }
  const SOFT = new Set(["dirt", "track", "redg", "dirt?"]);
  const famOf = (mk, r) => SOFT.has(mk) ? "soft" : mk === "dg" ? "dg" : mk === "deck" ? "deck" : mk === "bed" ? "bed" : /^m:/.test(mk) && r && r.dirt ? "soft" : "paved";
  function srcOf(r) { return r.plan ? String(r.plan) : r.fest ? "fest:" + r.fest : r.sp ? "sp:" + r.sp : r.dm ? "domes" : r.landSpur ? "land" : r.w >= 29 ? "runway" : "x"; }
  function polyLen2(p) { let L = 0; for (let i = 0; i < p.length - 1; i++) L += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]); return L; }
  function collect() {
    const out = [];
    for (let i = 0; i < ROADS.length; i++) { const r = ROADS[i]; if (!r || !r.pts || r.pts.length < 2 || !(r.w > 0)) continue;
      const mk = mkOf(r); const src = srcOf(r); const L = polyLen2(r.pts); if (!(L > 0.3)) continue;
      const a = r.pts[0], b = r.pts[r.pts.length - 1]; const loop = Math.hypot(a[0] - b[0], a[1] - b[1]) < Math.max(1.5, r.w * 0.3);
      const air = mk === "taxi" || src === "runway" || (src === "x" && r.w >= 11.5 && !r.dirt);
      if (r.pp === "pad") continue;
      out.push({ i, r, pts: r.pts, w: r.w, lift: r.lift || 0, mk, fam: famOf(mk, r), src, L, loop, air, bed: mk === "bed" }); }
    return out;
  }

  // ───────────────────────── spatial grids ─────────────────────────
  const GC = 16;
  function segGrid(rs) { const G = new Map(); for (const R of rs) { const p = R.pts; for (let k = 0; k < p.length - 1; k++) { const a = p[k], b = p[k + 1]; const m = R.w / 2 + 2;
      const x0 = Math.floor((Math.min(a[0], b[0]) - m) / GC), x1 = Math.floor((Math.max(a[0], b[0]) + m) / GC), z0 = Math.floor((Math.min(a[1], b[1]) - m) / GC), z1 = Math.floor((Math.max(a[1], b[1]) + m) / GC);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4000) continue;
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) { const key = gx * 100003 + gz; let c = G.get(key); if (!c) G.set(key, c = []); c.push([R, k]); } } } return G; }
  function segD(x, z, a, b) { const vx = b[0] - a[0], vz = b[1] - a[1]; const L2 = vx * vx + vz * vz || 1e-9; let t = ((x - a[0]) * vx + (z - a[1]) * vz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; const px = a[0] + vx * t, pz = a[1] + vz * t; return [Math.hypot(x - px, z - pz), t, vx, vz]; }
  // the nearest centre-line distance from (x, z) to every ribbon near it: Map R -> [d, ux, uz]
  function nearRibbons(G, x, z) { const c = G.get(Math.floor(x / GC) * 100003 + Math.floor(z / GC)); const best = new Map(); if (!c) return best;
    for (const [R, k] of c) { const [d, , vx, vz] = segD(x, z, R.pts[k], R.pts[k + 1]); const o = best.get(R); if (!o || d < o[0]) { const L = Math.hypot(vx, vz) || 1; best.set(R, [d, vx / L, vz / L]); } } return best; }

  // ───────────────────────── what a path end can arrive at ─────────────────────────
  function buildingsNear() { const out = []; try { for (const k in PLACE) { const sp = MODEL_SPECS[k]; if (!sp || sp.prop || sp.vehicle || !MODELS[k]) continue; const r0 = MODELS[k].radius || 4; for (const e of PLACE[k]) out.push([e[0], e[2], r0 * (e[4] || 1), k, e[3]]); } } catch (e) { note("buildings", e); } return out; }
  function doorsNear() { const out = []; try { for (const kind of DOOR_KINDS) for (const e of PLACE[kind] || []) { if (!MODELS[kind]) continue; const rr = MODELS[kind].radius * e[4], df = doorF(kind); out.push([e[0] + Math.sin(e[3]) * rr * df, e[2] + Math.cos(e[3]) * rr * df, kind]); } } catch (e) { note("doors", e); }
    try { for (const b of PLAN_BLD) { if (b && b.door) out.push([b.door[0], b.door[1], "plan"]); } } catch (e) {} return out; }
  function ptGrid(list, C) { const G = new Map(); for (const q of list) { const key = Math.floor(q[0] / C) * 100003 + Math.floor(q[1] / C); let c = G.get(key); if (!c) G.set(key, c = []); c.push(q); } return { G, C }; }
  function ptNear(PG, x, z, R) { const C = PG.C, out = []; const r = Math.ceil(R / C); const gx = Math.floor(x / C), gz = Math.floor(z / C); for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) { const c = PG.G.get((gx + i) * 100003 + gz + j); if (c) for (const q of c) out.push(q); } return out; }
  function context() {
    const P = window.PLAN; const ctx = {};
    ctx.plazas = []; for (const z of PLAZAS) ctx.plazas.push({ x: z[0], z: z[1], r: z[2], paved: !!z[3] });
    const bl = buildingsNear(); try { for (const sd of SOLIDS) { if (!sd || sd.y1 - sd.y0 < 1.8 || Math.max(sd.hw, sd.hd) < 1.25 || sd.tag === "room") continue; bl.push([sd.x, sd.z, Math.max(sd.hw, sd.hd), "solid:" + (sd.tag || "")]); } } catch (e) {}
    ctx.bld = ptGrid(bl, 40); ctx.doors = ptGrid(doorsNear(), 30);
    const nodes = []; for (const f of P.fountains || []) nodes.push([f.x, f.z, 6, "fountain:" + f.id]); for (const h of HUBS) nodes.push([h[1], h[2], 14, "hub:" + h[0]]);
    for (const q of P.places || []) if (typeof q.x === "number") nodes.push([q.x, q.z, Math.max(8, Math.min(30, q.r || 10)), "place:" + q.id]);
    for (const h of hotspots) if (h && typeof h.x === "number") nodes.push([h.x, h.z, (h.r || 2) + 3, "hot"]);
    for (const t of PP.termini) nodes.push([t.x, t.z, t.r + 1.5, "terminus"]);
    ctx.nodes = ptGrid(nodes, 30);
    // areas a module keeps for itself (venues, fields, car parks, aprons, fountains, places): a path that ends in one arrives somewhere
    const ko = []; try { for (const k of KEEPOUT) if (k && k[2] >= 2 && k[2] < 400) ko.push([k[0], k[1], k[2]]); } catch (e) {} ctx.ko = ptGrid(ko, 60); ctx.kpoly = []; try { for (const q of PLAN_KEEP_POLY) ctx.kpoly.push(q); } catch (e) {}
    return ctx;
  }
  function plazaAt(ctx, x, z, m) { for (const p of ctx.plazas) if (Math.hypot(x - p.x, z - p.z) <= p.r + m) return p; return null; }
  function walkHere(x, z) { try { const w = walkAt(x, z); return w !== null && w > getH(x, z) - 0.05 ? w : null; } catch (e) { return null; } }
  function covered(x, z) { try { return !!(COVER.ready && coverAt(x, z)); } catch (e) { return false; } }
  const EDGE = { x0: -485, x1: 1125, z0: -625, z1: 990 };

  // classify one end of a ribbon
  function endOf(R, which, G, ctx) {
    const p = R.pts, n = p.length; const e = which ? p[n - 1] : p[0]; let j = which ? n - 2 : 1; let f = p[j];
    while (Math.hypot(e[0] - f[0], e[1] - f[1]) < 1.5 && j > 0 && j < n - 1) { j += which ? -1 : 1; f = p[j]; }
    let ux = e[0] - f[0], uz = e[1] - f[1]; const L = Math.hypot(ux, uz) || 1; ux /= L; uz /= L;
    const x = e[0], z = e[1]; const out = { R, which, x, z, ux, uz, to: [], open: false, dead: false, gap: 0 };
    // another ribbon at the end (a junction) or just past it (a gap)
    for (const [d, q] of [[0, 0], [1.2, 1], [3.0, 2]]) { const xx = x + ux * d, zz = z + uz * d; const near = nearRibbons(G, xx, zz);
      for (const [O, v] of near) { if (O === R || O.bed) continue; if (v[0] <= O.w / 2 + 0.6) { if (!q) out.to.push({ t: "ribbon", O, mk: O.mk, ang: Math.abs(ux * v[1] + uz * v[2]) }); else if (!out.to.length && !out.gap) out.gap = d; } }
      if (out.to.length) break; }
    const pz = plazaAt(ctx, x, z, 1.0); if (pz) out.to.push({ t: "plaza", P: pz });
    else { const pz2 = plazaAt(ctx, x + ux * 3, z + uz * 3, 0.5); if (pz2 && !out.to.length && !out.gap) out.gap = 3; }
    if (!out.to.length) { const w1 = walkHere(x + ux * 1.2, z + uz * 1.2); if (w1 !== null) out.to.push({ t: "surface" }); else if (covered(x + ux * 1.4, z + uz * 1.4)) out.to.push({ t: "cover" }); }
    if (!out.to.length && ctx.ko) { for (const k of ptNear(ctx.ko, x, z, 60)) { const dd = Math.hypot(k[0] - x, k[1] - z); if (dd < k[2] + 0.8 && k[2] < 120) { out.to.push({ t: "area" }); break; } }
      if (!out.to.length) for (const q of ctx.kpoly) { const b = q.bb; if (x < b[0] - 1 || x > b[1] + 1 || z < b[2] - 1 || z > b[3] + 1) continue; if (planInPoly(q.poly, x + ux * 0.8, z + uz * 0.8) || planInPoly(q.poly, x, z)) { out.to.push({ t: "area" }); break; } } }
    for (const d of ptNear(ctx.doors, x, z, 9)) if (Math.hypot(d[0] - x, d[1] - z) < 9) { out.to.push({ t: "door", k: d[2] }); break; }
    for (const b of ptNear(ctx.bld, x, z, 40)) if (Math.hypot(b[0] - x, b[1] - z) < b[2] + 3.0) { out.to.push({ t: "building", k: b[3] }); break; }
    for (const q of ptNear(ctx.nodes, x, z, 30)) if (Math.hypot(q[0] - x, q[1] - z) < q[2]) { out.to.push({ t: "node", k: q[3] }); break; }
    if (nearArrEdge(x, z, 8) && !inArr(x - ux * 4, z - uz * 4)) out.to.push({ t: "zone" });
    if (x < EDGE.x0 || x > EDGE.x1 || z < EDGE.z0 || z > EDGE.z1) out.to.push({ t: "edge" });
    const tr = PP.treat.get(R.r); const tw = tr && tr[which];
    out.treat = tw || null;
    out.open = !out.to.length;
    if (out.open) { let dest = false; for (const d of ptNear(ctx.doors, x, z, 30)) if (Math.hypot(d[0] - x, d[1] - z) < 30) { dest = true; break; }
      if (!dest) for (const b of ptNear(ctx.bld, x, z, 60)) if (Math.hypot(b[0] - x, b[1] - z) < b[2] + 18) { dest = true; break; }
      if (!dest && plazaAt(ctx, x, z, 25)) dest = true; if (!dest) for (const q of ptNear(ctx.nodes, x, z, 30)) if (Math.hypot(q[0] - x, q[1] - z) < q[2] + 18) { dest = true; break; }
      out.dead = !dest; }
    return out;
  }
  PP.endOf = endOf;

  // ───────────────────────── the audit ─────────────────────────
  // returns { counts, outside, inside, items } (items: [type, x, z, src, mk, detail]); PLAN_PATHS.last keeps the full result
  function audit(opts) {
    const t0 = performance.now(); opts = opts || {};
    const rs = collect(); const paths = rs.filter((R) => !R.air && !R.bed); const G = segGrid(rs.filter((R) => !R.bed)); const ctx = context();
    const items = []; const add = (type, x, z, R, detail) => items.push([type, Math.round(x * 10) / 10, Math.round(z * 10) / 10, R ? R.src : "", R ? R.mk : "", detail || ""]);
    const ends = [];
    // 1. ends: abrupt (open in the open, not feathered or ended in a terminus), dead ends (nothing to arrive at), seams at junctions
    for (const R of paths) { if (R.loop) continue; for (const which of [0, 1]) { const E = endOf(R, which, G, ctx); ends.push(E);
        if (E.open) { if (!E.treat) add("abrupt", E.x, E.z, R, E.gap ? "gap " + E.gap + " m" : ""); if (E.dead && !(E.treat === "terminus" || E.treat === "joined")) add("dead_end", E.x, E.z, R, ""); }
        for (const t of E.to) {
          if (t.t === "ribbon" && t.O.mk !== R.mk && t.O.fam !== R.fam && !E.treat && !isPad(E.x, E.z)) add("seam", E.x, E.z, R, R.mk + ">" + t.O.mk + " " + t.O.src);
          if (t.t === "plaza" && !E.treat && !isBand(E.x, E.z)) { const pm = t.P.paved ? "paved" : "earth"; if ((t.P.paved && R.fam !== "paved" && R.fam !== "deck") || (t.P.paved && R.mk === "stone") || (!t.P.paved && R.fam === "paved" && R.mk !== "chip")) add("seam", E.x, E.z, R, R.mk + ">plaza_" + pm); } } } }
    // 2. crossings and overlaps of different ribbons
    const pairs = new Map();
    for (const R of paths) { const p = R.pts; let acc = 0;
      for (let k = 0; k < p.length - 1; k++) { const a = p[k], b = p[k + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-3) continue; const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
        for (let t = (k ? 0 : 0.5); t < L; t += 2) { const x = a[0] + ux * t, z = a[1] + uz * t; const s = acc + t; const near = nearRibbons(G, x, z);
          for (const [O, v] of near) { if (O === R || O.i < R.i && !O.air) continue; if (O.air && R.air) continue; if (v[0] > O.w / 2 + 0.3) continue;
            const key = R.i * 100003 + O.i; let pr = pairs.get(key); if (!pr) pairs.set(key, pr = { R, O, n: 0, par: 0, xs: [], ss: [] }); pr.n++; if (Math.abs(ux * v[1] + uz * v[2]) > 0.9) pr.par++; if (pr.xs.length < 400) pr.xs.push([x, z]); pr.ss.push(s); } }
        acc += L; } }
    let nPairs = 0;
    for (const pr of pairs.values()) { const { R, O } = pr; nPairs++;
      // samples near either end of R are its end junction (seen in 1); what is left is a crossing or a run on top of the other ribbon
      const endZone = O.w / 2 + 2.5; const mid = []; for (let i = 0; i < pr.ss.length; i++) { const s = pr.ss[i]; if (!R.loop && (s < endZone || s > R.L - endZone)) continue; mid.push(i); }
      if (!mid.length) continue; const sameFam = R.mk === O.mk; const c = pr.xs[mid[Math.floor(mid.length / 2)]] || pr.xs[0];
      const runLen = mid.length * 2; const par = pr.par / Math.max(1, pr.n);
      if (O.air) { if (R.fam !== "paved" && runLen > 4 && !isPad(c[0], c[1])) add("cross", c[0], c[1], R, R.mk + " x airside " + O.src); continue; }
      if (par > 0.6 && runLen > 8) { add("overlap", c[0], c[1], R, R.mk + " on " + O.mk + " " + O.src + " " + runLen + " m"); continue; }
      if (!sameFam && !isPad(c[0], c[1])) add("cross", c[0], c[1], R, R.mk + " x " + O.mk + " " + O.src);
      else if (sameFam && Math.abs((R.r.lift || 0) - (O.r.lift || 0)) < 0.004 && R.src !== O.src && R.mk !== "sp" && O.mk !== "sp") add("zfight", c[0], c[1], R, R.mk + " " + O.src + " lift " + R.lift.toFixed(3));
    }
    // 3. over or under the terrain (shoulders, deck skirts and module drapes count as covered)
    for (const R of paths) { const shoulder = !!(R.r.plan && R.mk !== "deck" && R.mk !== "bed" && R.w >= 2 && ROAD_MAT.get(R.r)); let over = 0, under = 0, ox = 0, oz = 0, ux2 = 0, uz2 = 0, worst = 0, worstU = 0;
      planAlong(R.pts, 4, 2, (x, z, ux, uz) => { const th = getH(x, z); const wc = walkHere(x, z);
        if (wc !== null && th - wc > 0.04) { under++; if (th - wc > worstU) { worstU = th - wc; ux2 = x; uz2 = z; } }
        if (!shoulder && R.mk !== "deck") for (const sd of [-1, 1]) { const ex = x - uz * sd * R.w * 0.48, ez = z + ux * sd * R.w * 0.48; const we = walkHere(ex, ez); if (we === null) continue; const gap = we - getH(ex, ez) - R.lift; if (gap > 0.22) { over++; if (gap > worst) { worst = gap; ox = ex; oz = ez; } } } });
      if (over >= 2) add("over_terrain", ox, oz, R, over + " edge samples, worst " + worst.toFixed(2) + " m");
      if (under >= 2) add("under_terrain", ux2, uz2, R, under + " samples, worst " + worstU.toFixed(2) + " m"); }
    // 4. orphans: a ribbon that touches nothing at either end and crosses nothing
    const touched = new Set(); for (const pr of pairs.values()) { touched.add(pr.R); touched.add(pr.O); }
    const byR = new Map(); for (const E of ends) { if (!byR.has(E.R)) byR.set(E.R, []); byR.get(E.R).push(E); }
    for (const R of paths) { const es = byR.get(R) || []; const allOpen = R.loop ? false : es.length === 2 && es.every((E) => E.open && !E.treat); if (allOpen && !touched.has(R)) add("orphan", R.pts[0][0], R.pts[0][1], R, Math.round(R.L) + " m"); }
    // tally
    const counts = {}, outside = {}, inside = {};
    for (const it of items) { counts[it[0]] = (counts[it[0]] || 0) + 1; const o = inArr(it[1], it[2]) ? inside : outside; o[it[0]] = (o[it[0]] || 0) + 1; }
    const res = { ver: PP.ver, off: OFF, ribbons: rs.length, paths: paths.length, ends: ends.length, openEnds: ends.filter((E) => E.open).length, pairs: nPairs, counts, outside, inside, items, ms: Math.round(performance.now() - t0) };
    PP.last = res; return opts.full ? res : { ver: res.ver, off: OFF, ribbons: res.ribbons, paths: res.paths, ends: res.ends, openEnds: res.openEnds, pairs: res.pairs, counts, outside, inside, ms: res.ms };
  }
  function isPad(x, z) { for (const p of PP.pads) if (Math.hypot(p.x - x, p.z - z) < p.r + 1.5) return true; return false; }
  function isBand(x, z) { for (const b of PP.bands) if (Math.hypot(b.x - x, b.z - z) < b.r + 1.5) return true; return false; }
  PP.audit = audit;

  // ───────────────────────── the network map (PNG data URL) ─────────────────────────
  const MAPCOL = { dirt: "#b58a5a", track: "#c9a274", redg: "#b4553a", dg: "#e0c590", stone: "#f2e6cf", chip: "#8f8a84", deck: "#7a5634", walk: "#c8c8c8", asphalt: "#555", taxi: "#6b7078", sp: "#9aa", bed: "#3f6b2f" };
  PP.mapPNG = function (opts) { opts = opts || {}; const res = PP.last || audit(); const S = opts.size || 2600; const X0 = -520, Z0 = -660, SPAN = 1700; const k = S / SPAN;
    const c = document.createElement("canvas"); c.width = S; c.height = S + 90; const g = c.getContext("2d"); g.fillStyle = "#1b1712"; g.fillRect(0, 0, S, S + 90);
    const X = (x) => (x - X0) * k, Z = (z) => (z - Z0) * k;
    g.strokeStyle = "rgba(77,222,111,0.55)"; g.lineWidth = 2; g.setLineDash([10, 8]); g.strokeRect(X(ARR.x0), Z(ARR.z0), (ARR.x1 - ARR.x0) * k, (ARR.z1 - ARR.z0) * k); g.setLineDash([]);
    for (const p of PLAZAS) { g.fillStyle = p[3] ? "rgba(190,190,195,0.55)" : "rgba(170,130,90,0.45)"; g.beginPath(); g.arc(X(p[0]), Z(p[1]), p[2] * k, 0, 6.283); g.fill(); }
    const rs = collect(); rs.sort((a, b) => (a.air ? 0 : 1) - (b.air ? 0 : 1));
    for (const R of rs) { g.strokeStyle = MAPCOL[R.mk] || "#d0d"; g.lineWidth = Math.max(1.5, R.w * k); g.lineCap = "butt"; g.lineJoin = "round"; g.beginPath(); R.pts.forEach((q, i) => (i ? g.lineTo(X(q[0]), Z(q[1])) : g.moveTo(X(q[0]), Z(q[1])))); g.stroke(); }
    for (const t of PP.termini) { g.fillStyle = "#4DDE6F"; g.beginPath(); g.arc(X(t.x), Z(t.z), Math.max(3, t.r * k), 0, 6.283); g.fill(); }
    const IC = { abrupt: "#ff3b3b", dead_end: "#ff00c8", overlap: "#ff9f1a", cross: "#ffe14d", zfight: "#ffffff", seam: "#a46bff", over_terrain: "#33d1ff", under_terrain: "#0077ff", orphan: "#ff6f91" };
    for (const it of res.items) { const col = IC[it[0]] || "#fff"; const x = X(it[1]), z = Z(it[2]); g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.arc(x, z, it[0] === "dead_end" ? 13 : 9, 0, 6.283); g.stroke(); if (it[0] === "abrupt") { g.beginPath(); g.moveTo(x - 6, z - 6); g.lineTo(x + 6, z + 6); g.moveTo(x + 6, z - 6); g.lineTo(x - 6, z + 6); g.stroke(); } }
    g.font = "bold 26px monospace"; g.fillStyle = "#f5f1e6"; g.fillText((opts.title || "Genesis One path network") + "  " + (OFF ? "BEFORE (?paths=0)" : "AFTER") + "  " + res.paths + " paths", 20, S + 34);
    let lx = 20; g.font = "20px monospace"; for (const k2 in IC) { const n = (res.outside[k2] || 0); g.fillStyle = IC[k2]; g.fillText(k2 + " " + n, lx, S + 70); lx += g.measureText(k2 + " " + n).width + 26; }
    g.fillStyle = "rgba(245,241,230,0.7)"; g.fillText("(counts outside the Arrivals zone, dashed green)", lx, S + 70);
    return c.toDataURL("image/png"); };

  // ───────────────────────── the API for the fill agents ─────────────────────────
  // near(x, z, margin): is (x, z) on a path, its dressed edge (shoulder, kerb, planting strip) or a path node, plus margin metres
  // dist(x, z): metres from (x, z) to the nearest dressed path edge (negative inside); edges: [{ src, mk, w, dress, pts }]
  const API = { G: null, n: -1, rs: null };
  function apiGrid() { if (API.G && API.n === ROADS.length) return; API.rs = collect().filter((R) => !R.air && !R.bed); for (const R of API.rs) R.dress = dressW(R); API.G = segGrid(API.rs); API.n = ROADS.length;
    PP.edges = API.rs.map((R) => ({ src: R.src, mk: R.mk, w: R.w, dress: R.dress, pts: R.pts })); }
  function dressW(R) { return R.fam === "soft" ? (R.w >= 6 ? 1.6 : 1.1) : R.fam === "dg" ? 1.2 : R.fam === "deck" ? 0.5 : 0.9; }
  PP.dist = function (x, z) { apiGrid(); let best = 1e9; const near = nearRibbons(API.G, x, z); for (const [R, v] of near) { const d = v[0] - R.w / 2 - (R.dress || 0); if (d < best) best = d; }
    for (const t of PP.termini) best = Math.min(best, Math.hypot(t.x - x, t.z - z) - t.r - 0.6); for (const p of PP.pads) best = Math.min(best, Math.hypot(p.x - x, p.z - z) - p.r); return best; };
  PP.near = function (x, z, margin) { return PP.dist(x, z) <= (margin || 0); };
  Object.defineProperty(PP, "edgesNow", { get() { apiGrid(); return PP.edges; } });

  // ───────────────────────── network fixes (world phase; ?paths=0 skips them) ─────────────────────────
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  function setPts(arr, pts) { const tp = arr.taper; arr.length = 0; for (const q of pts) arr.push([q[0], q[1]]); if (tp) arr.taper = tp; }
  function arcAt(pts, s) { let acc = 0; for (let i = 0; i < pts.length - 1; i++) { const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); if (acc + L >= s || i === pts.length - 2) { const t = L > 0 ? Math.max(0, Math.min(1, (s - acc) / L)) : 0; const q = lerp(pts[i], pts[i + 1], t); return [q[0], q[1], (pts[i + 1][0] - pts[i][0]) / (L || 1), (pts[i + 1][1] - pts[i][1]) / (L || 1)]; } acc += L; } const q = pts[pts.length - 1]; return [q[0], q[1], 1, 0]; }
  function cutRange(pts, a, b) { const L = polyLen2(pts); a = Math.max(0, a); b = Math.min(L, b); if (b - a < 0.5) return null; const out = planTrim(pts, a, b); return out && out.length >= 2 && polyLen2(out) > 0.4 ? out.map((q) => [q[0], q[1]]) : null; }
  function setTaper(R, which, len) { const a = R.r.pts; const t = a.taper ? a.taper.slice() : [0, 0]; t[which] = Math.max(t[which], len); a.taper = t; }
  function treat(R, which, kind) { let t = PP.treat.get(R.r); if (!t) PP.treat.set(R.r, t = [null, null]); t[which] = kind; }
  function pieceOf(R) { try { for (const p of PLAN_PIECES) if (p.pts === R.r.pts) return p; } catch (e) {} return null; }
  function arcOf(R, x, z) { const p = R.pts; let acc = 0, best = 1e9, bs = 0; for (let k = 0; k < p.length - 1; k++) { const L = Math.hypot(p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1]); const [d, t] = segD(x, z, p[k], p[k + 1]); if (d < best) { best = d; bs = acc + t * L; } acc += L; } return bs; }
  // distance from (x, z) to R's centre line
  function dTo(R, x, z) { let b = 1e9; const p = R.pts; for (let k = 0; k < p.length - 1; k++) { const d = segD(x, z, p[k], p[k + 1])[0]; if (d < b) b = d; } return b; }
  // the things at an open end are plan_enrich and engine kinds (no new materials or draws)
  function kindOK(k) { return !!(MODELS[k] && MODEL_SPECS[k]); }
  function putK(k, x, z, yaw, sc) { if (!kindOK(k)) return null; put(k, x, z, yaw || 0, sc || 1); const e = PLACE[k][PLACE[k].length - 1]; e.keep = true; e.pp = true; cnt("k:" + k); return e; }
  const benchK = () => (kindOK("e1_bench") ? "e1_bench" : "bench_lux");   // the 250-triangle teak bench, not the 20k scan
  function owAt(x, z) { const d = planDistrictAt(x, z); return !!(d && /S3_MAIN|S3_GATE|S3_FRONTIER|S3_RANCH/.test(d.id)); }
  function terminus(R, E, style, bare) {
    const px = -E.uz, pz = E.ux; const yawTo = (dx, dz) => Math.atan2(dx, dz); const ow = owAt(E.x, E.z);
    if (style === "pad") { const rr = Math.max(2.6, Math.min(6, R.w / 2 + 1.6)); const cx = E.x + E.ux * rr * 0.55, cz = E.z + E.uz * rr * 0.55;
      const mat = ROAD_MAT.get(R.r) || (R.fam === "dg" ? PM.dg : PM.stone); const padMat = mat === M.deck ? PM.stone : mat;
      const T = { x: cx, z: cz, r: rr, mat: padMat, lift: Math.max(0.12, R.lift || 0.2), src: R.src, ux: E.ux, uz: E.uz, kind: "pad", mouthW: R.w }; PP.termini.push(T);
      const rec = { pts: [[cx - E.ux * 0.01, cz - E.uz * 0.01], [cx + E.ux * 0.01, cz + E.uz * 0.01]], w: rr * 2, lift: T.lift, dirt: false, pp: "pad" }; ROADS.push(rec); T.rec = rec;
      if (bare) { cnt("terminus_pad_late"); return T; }
      putK(benchK(), cx + E.ux * (rr - 0.75), cz + E.uz * (rr - 0.75), yawTo(-E.ux, -E.uz));
      putK(ow ? "e1_tpost" : "e1_lantern", cx + px * (rr - 0.45), cz + pz * (rr - 0.45), 0);
      if (kindOK("e1_planter")) putK("e1_planter", cx - px * (rr - 0.6), cz - pz * (rr - 0.6), 0); else putK("planter_lux", cx - px * (rr - 0.65), cz - pz * (rr - 0.65), 0);
      cnt("terminus_pad"); return T; }
    // a rest stop beside the feathered end of a dirt lane or trail: a bench looking out, a timber lantern post, boulders and an agave
    const sd = (Math.round(E.x + E.z) & 1) ? 1 : -1; const o = R.w / 2 + 1.5; const bx = E.x - E.ux * 2 + px * o * sd, bz = E.z - E.uz * 2 + pz * o * sd;
    const T = { x: bx, z: bz, r: 1.8, kind: "rest", src: R.src }; PP.termini.push(T);
    putK(benchK(), bx, bz, yawTo(px * sd, pz * sd));
    putK("e1_tpost", bx - E.ux * 1.6, bz - E.uz * 1.6, yawTo(-px * sd, -pz * sd));
    const bk = ["ph_boulder_1", "ph_boulder_3", "boulder"].find(kindOK); if (bk) { putK(bk, E.x + E.ux * 2.2 + px * 1.2, E.z + E.uz * 2.2 + pz * 1.2, E.x * 0.37, 0.55); putK(bk, E.x + E.ux * 2.9 - px * 0.9, E.z + E.uz * 2.9 - pz * 0.9, E.z * 0.61, 0.38); }
    const ag = ["agave_cluster", "yucca_cluster"].find(kindOK); if (ag) putK(ag, bx + E.ux * 1.7 + px * sd * 0.6, bz + E.uz * 1.7 + pz * sd * 0.6, E.x, 0.7);
    cnt("terminus_rest"); return T;
  }
  // a stone soldier course: kind "end" across a ribbon end, "edge" along both ribbon edges from s0 to s1
  function band(b) { PP.bands.push(b); cnt("band_" + b.kind); }
  const SD = (f) => f === "soft" || f === "deck";   // the course lies on a boardwalk or a dirt lane: timber ties in the Old West; on any paving (plaza, slab, granite, stone) it is always the dark stone course

  function networkFix(phase) {
    const t0 = performance.now(); const n0 = phase === "late" ? PP.nEarly || 0 : 0; PP.calls = (PP.calls || 0) + 1; PP.callLog = (PP.callLog || []).concat([[phase, ROADS.length, n0]]);
    const rs = collect().filter((R) => !R.bed); const G = segGrid(rs); const ctx = context();
    const late = phase === "defer";   // ribbons a module adds while the world is drawn: only the soldier courses can still be laid
    const mine = (R) => !R.r.ppSeen && !R.air && !(inArr(R.pts[0][0], R.pts[0][1]) && inArr(R.pts[R.pts.length - 1][0], R.pts[R.pts.length - 1][1]));
    const paths = rs.filter((R) => !R.air);
    const acts = [];
    // 1. ends
    for (const R of paths) { if (R.loop || !mine(R)) continue;
      for (const which of [0, 1]) { const E = endOf(R, which, G, ctx); if (inArr(E.x, E.z)) continue;
        if (E.open) { if (late) { if (R.w >= 1.4 && !E.gap) { terminus(R, E, "pad", true); treat(R, which, "terminus"); } continue; }
          if (E.gap) { const g = E.gap; acts.push(() => { const a = R.r.pts; const q = which ? a.length - 1 : 0; a[q] = [a[q][0] + E.ux * (g + 0.6), a[q][1] + E.uz * (g + 0.6)]; }); treat(R, which, "joined"); cnt("end_extend"); continue; }
          if (R.fam === "soft") { setTaper(R, which, Math.max(3, Math.min(10, R.w * 1.3))); treat(R, which, "taper"); cnt("end_taper"); if (E.dead && R.w >= 1.5) { terminus(R, E, "rest"); treat(R, which, "terminus"); } continue; }
          if (R.w <= 1.6) { setTaper(R, which, R.w / 2); treat(R, which, "taper"); cnt("end_round"); continue; }
          terminus(R, E, "pad"); treat(R, which, "terminus"); continue; }
        // a junction: the branch stops at the trunk's edge when it is drawn on top of a different surface (no slab laid over the street)
        const pzE = E.to.find((t) => t.t === "plaza"); const jr = pzE ? null : E.to.find((t) => t.t === "ribbon");
        if (jr) { const O = jr.O;
          if (!late && O.fam !== R.fam && R.lift > O.lift + 0.001 && R.w <= O.w * 1.6 && R.fam !== "bed") {
            const L = R.L; let s = 0; for (let k = 0; k < 60; k++) { const at = arcAt(R.pts, which ? L - s : s); if (dTo(O, at[0], at[1]) >= O.w / 2 - 0.3) break; s += 0.25; }
            if (s > 0.2 && s < Math.min(12, L * 0.4)) { const keep = which ? cutRange(R.pts, 0, L - s) : cutRange(R.pts, s, L);
              if (keep) { acts.push(() => setPts(R.r.pts, keep)); const at = arcAt(keep, which ? polyLen2(keep) : 0); band({ kind: "end", x: at[0], z: at[1], ux: at[2], uz: at[3], len: R.w + 0.3, wid: 0.55, src: R.src, soft: SD(R.fam) }); treat(R, which, "joined"); cnt("end_trim"); } } }
          else if (O.fam !== R.fam && R.lift > O.lift) { const s = Math.max(0, O.w / 2 - dTo(O, E.x, E.z)); const at = arcAt(R.pts, which ? R.L - Math.min(R.L * 0.4, s) : Math.min(R.L * 0.4, s)); band({ kind: "end", x: at[0], z: at[1], ux: at[2], uz: at[3], len: R.w + 0.3, wid: 0.55, src: R.src, soft: SD(R.fam) }); treat(R, which, "joined"); cnt("end_band"); }
          else if (O.fam !== R.fam && R.fam !== "bed") { // the branch runs under the trunk: the course lies across the branch at the trunk's edge
            const L = R.L; let s = 0; for (let k = 0; k < 80; k++) { const at = arcAt(R.pts, which ? L - s : s); if (dTo(O, at[0], at[1]) >= O.w / 2 + 0.2) break; s += 0.25; }
            if (s < Math.min(14, L * 0.5)) { const at = arcAt(R.pts, which ? L - s : s); band({ kind: "end", x: at[0], z: at[1], ux: at[2], uz: at[3], len: R.w + 0.3, wid: 0.5, src: R.src, soft: SD(R.fam) }); treat(R, which, "joined"); cnt("end_band_under"); }
            else { const at = arcAt(R.pts, which ? L : 0); band({ kind: "end", x: at[0], z: at[1], ux: at[2], uz: at[3], len: Math.max(R.w, O.w) + 0.3, wid: 0.5, src: R.src, soft: SD(R.fam) }); treat(R, which, "joined"); cnt("end_band_inline"); } } }
        // a paved plaza: a soldier course across the walk at the plaza's kerb line
        const pz = E.to.find((t) => t.t === "plaza");
        if (pz && !jr && (pz.P.paved || R.fam !== "soft")) { const C = pz.P; const Rr = C.r - 0.3; const L = R.L; let s = 0, hit = null;
          for (let k = 0; k < 200 && s < L; k++) { const at = arcAt(R.pts, which ? L - s : s); if (Math.hypot(at[0] - C.x, at[1] - C.z) >= Rr) { hit = at; break; } s += 0.5; }
          const deep = Math.hypot(E.x - C.x, E.z - C.z) < Rr - 3;   // the walk runs on into the plaza rather than stopping at its edge
          if (hit && !deep) { band({ kind: "end", x: hit[0], z: hit[1], ux: hit[2], uz: hit[3], len: R.w + 0.3, wid: 0.6, src: R.src, plaza: true, soft: SD(R.fam) }); treat(R, which, "joined"); cnt("plaza_threshold"); }
          if (R.mk === "stone" && s > 3) { band({ kind: "edge", R, s0: which ? L - s : 0, s1: which ? L : s, src: R.src, plaza: true }); treat(R, which, "joined"); cnt("plaza_inlay"); }
          else if (deep) { treat(R, which, "joined"); cnt("plaza_runs_in"); } }
      } }
    if (phase === "early") for (const C of PP.courts || []) { try { const T = { x: C.x, z: C.z, r: C.r, mat: PM.stone, lift: 0.14, src: "court", ux: 1, uz: 0, kind: "pad", mouthW: 0, court: true }; PP.termini.push(T);
        ROADS.push(T.rec = { pts: [[C.x - 0.01, C.z], [C.x + 0.01, C.z]], w: C.r * 2, lift: T.lift, dirt: false, pp: "pad" });
        const taken = []; for (const R of paths) { if (dTo(R, C.x, C.z) > C.r + R.w) continue; const p = R.pts; for (const q of [p[0], p[p.length - 1]]) if (Math.abs(Math.hypot(q[0] - C.x, q[1] - C.z) - C.r) < 3) taken.push(Math.atan2(q[1] - C.z, q[0] - C.x)); }
        let nb = 0; for (let k = 0; k < 8 && nb < 4; k++) { const a = k / 8 * 6.2832 + 0.39; if (taken.some((t) => Math.abs(Math.atan2(Math.sin(a - t), Math.cos(a - t))) < 0.6)) continue; const x = C.x + Math.cos(a) * (C.r - 2.4), z = C.z + Math.sin(a) * (C.r - 2.4); putK("e1_bench", x, z, Math.atan2(C.x - x, C.z - z)); nb++; }
        for (const t of taken.slice(0, 2)) for (const d of [-0.32, 0.32]) putK("e1_lantern", C.x + Math.cos(t + d) * (C.r - 0.5), C.z + Math.sin(t + d) * (C.r - 0.5), 0);
        cnt("court"); } catch (e) { note("court", e); } }
    // 2. crossings: a boardwalk is cut where a street crosses it (deck steps at both cut ends); a stone walk crossing a street gets a
    //    soldier course along both edges; equal lifts of one family are parted by 8 mm so they never z-fight
    const cuts = new Map(); const seen = new Set(), zseen = new Set();
    for (const R of paths) { if (!mine(R)) continue; const p = R.pts; let acc = 0;
      for (let k = 0; k < p.length - 1; k++) { const a = p[k], b = p[k + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-3) continue; const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
        for (let t = 0; t < L; t += 1.0) { const x = a[0] + ux * t, z = a[1] + uz * t; const s = acc + t; const near = nearRibbons(G, x, z);
          for (const [O, v] of near) { if (O === R || O.air || O.bed || v[0] > 0.6) continue; const key = R.i + ":" + O.i + ":" + Math.round(x / 8) + ":" + Math.round(z / 8); if (seen.has(key)) continue; seen.add(key);
            const cosA = Math.abs(ux * v[1] + uz * v[2]); if (cosA > 0.85 || inArr(x, z)) continue;
            { const zk = Math.min(R.i, O.i) + ":" + Math.max(R.i, O.i) + ":" + Math.round(x / 8) + ":" + Math.round(z / 8); if (!zseen.has(zk) && R.fam === O.fam && Math.abs(R.lift - O.lift) < 0.004 && R.mk !== "sp") { zseen.add(zk); const po = pieceOf(O), pr = pieceOf(R); const pc = po && !po.ppLift ? po : pr && !pr.ppLift ? pr : po; const X = pc === po ? O : R; if (pc) { pc.lift += pc.ppLift ? 0.004 : 0.008; pc.ppLift = true; X.r.lift = pc.lift; X.lift = pc.lift; cnt("zfight_lift"); } } }
            if (!R.loop && (s < O.w / 2 + 1 || s > R.L - O.w / 2 - 1)) continue;   // R ends here: a junction, seen in 1
            const sinA = Math.max(0.35, Math.sqrt(1 - cosA * cosA));
            if (!late && R.fam === "deck" && O.fam !== "deck" && O.w >= 4 && R.w <= 10) { const half = (O.w / 2 + 0.6) / sinA; let c = cuts.get(R); if (!c) cuts.set(R, c = []); c.push([s - half, s + half]); cnt("deck_cut"); continue; }
            if (R.fam !== O.fam && O.fam !== "deck" && R.fam !== "deck" && (R.lift > O.lift || (R.lift === O.lift && R.i < O.i))) { const W = R, Lo = O; const half = (Lo.w / 2 + 0.4) / sinA; const sw = s;
              band({ kind: "edge", R: W, s0: sw - half, s1: sw + half, src: W.src, soft: SD(W.fam) }); PP.pads.push({ x, z, r: Math.max(R.w, O.w) / 2 + 0.6, kind: "cross" }); cnt("cross_band"); }

          } }
        acc += L; } }
    for (const [R, list] of cuts) { list.sort((a, b) => a[0] - b[0]); const L = polyLen2(R.pts); const keep = []; let s = 0; for (const [a, b] of list) { if (a > s) keep.push([s, a]); s = Math.max(s, b); } if (s < L) keep.push([s, L]);
      const pieces = keep.map(([a, b]) => cutRange(R.pts, a, b)).filter((q) => q && polyLen2(q) > 2.5); if (!pieces.length) continue;
      const mat = ROAD_MAT.get(R.r) || M.deck; const pc = pieceOf(R);
      const L0 = polyLen2(R.pts); const cutA = keep[0][0] > 0.5, cutB = keep[keep.length - 1][1] < L0 - 0.5;
      acts.push(() => { setPts(R.r.pts, pieces[0]); treat(R, 1, pieces.length > 1 || cutB ? "cut" : (PP.treat.get(R.r) || [])[1]); if (cutA) treat(R, 0, "cut");
        for (let i = 1; i < pieces.length; i++) { let rec = null; if (pc) rec = planRibbon(pieces[i], R.w, { mat, lift: R.lift, tile: pc.tile || 2.5 }, R.src); else { scene.add(ribbon(pieces[i], R.w, mat, R.lift)); rec = ROADS[ROADS.length - 1]; }
          if (rec) { rec.ppSeen = "cut"; PP.treat.set(rec, ["cut", i < pieces.length - 1 || cutB ? "cut" : null]); } } }); }
    // 3. a ribbon laid along another one for a stretch at its end (a parallel duplicate): the duplicate end is cut back to where it leaves
    for (const R of paths) { if (R.loop || !mine(R) || R.L < 12) continue;
      for (const which of [0, 1]) { const L = R.L; let s = 0, on = null;
        for (let k = 0; k < 200 && s < L * 0.7; k++) { const at = arcAt(R.pts, which ? L - s : s); const near = nearRibbons(G, at[0], at[1]); let hit = null; for (const [O, v] of near) { if (O === R || O.bed || O.src === R.src) continue; if (v[0] < O.w / 2 - R.w * 0.2 && Math.abs(at[2] * v[1] + at[3] * v[2]) > 0.9) { hit = O; break; } } if (!hit) break; on = hit; s += 1; }
        if (on && s >= 8) { const keep = which ? cutRange(R.pts, 0, L - s + 1) : cutRange(R.pts, s - 1, L); if (keep) { acts.push(() => setPts(R.r.pts, keep)); cnt("overlap_trim"); } } } }
    if (!late) for (const f of acts) { try { f(); } catch (e) { note("act", e); } }
    for (const R of rs) R.r.ppSeen = phase;
    try { ROADGRID.map = null; } catch (e) {}   // roadLiftAt rebuilds its cells from the edited ribbons
    if (phase === "early") PP.nEarly = ROADS.length; else if (phase === "late") { try { rhythm(); } catch (e) { note("rhythm", e); } }
    PP.t[phase] = Math.round(performance.now() - t0);
  }

  // ───────────────────────── geometry (defer phase: after every ribbon is drawn and in the walk grid) ─────────────────────────
  // vertex-coloured merged meshes on plan_enrich's shared stone / timber / metal / gravel materials (no new shader programs)
  function newAcc() { return { p: [], n: [], u: [], c: [], i: [] }; }
  function vtx(a, x, y, z, nx, ny, nz, u, v, col) { a.p.push(x, y, z); a.n.push(nx, ny, nz); a.u.push(u, v); a.c.push(col[0], col[1], col[2]); return a.p.length / 3 - 1; }
  function quadA(a, P0, P1, P2, P3, uv, col) { const ax = P1[0] - P0[0], ay = P1[1] - P0[1], az = P1[2] - P0[2], bx = P3[0] - P0[0], by = P3[1] - P0[1], bz = P3[2] - P0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; let l = Math.hypot(nx, ny, nz); if (l < 1e-9) { nx = 0; ny = 1; nz = 0; l = 1; } nx /= l; ny /= l; nz /= l; if (ny < -0.2) { nx = -nx; ny = -ny; nz = -nz; }
    const i0 = vtx(a, P0[0], P0[1], P0[2], nx, ny, nz, uv[0], uv[1], col), i1 = vtx(a, P1[0], P1[1], P1[2], nx, ny, nz, uv[2], uv[3], col), i2 = vtx(a, P2[0], P2[1], P2[2], nx, ny, nz, uv[4], uv[5], col), i3 = vtx(a, P3[0], P3[1], P3[2], nx, ny, nz, uv[6], uv[7], col); a.i.push(i0, i2, i1, i0, i3, i2); }
  // a vertical face (normal from the across direction)
  function wallA(a, P0, P1, P2, P3, uv, col, nx, nz) { const i0 = vtx(a, P0[0], P0[1], P0[2], nx, 0, nz, uv[0], uv[1], col), i1 = vtx(a, P1[0], P1[1], P1[2], nx, 0, nz, uv[2], uv[3], col), i2 = vtx(a, P2[0], P2[1], P2[2], nx, 0, nz, uv[4], uv[5], col), i3 = vtx(a, P3[0], P3[1], P3[2], nx, 0, nz, uv[6], uv[7], col); a.i.push(i0, i1, i2, i0, i2, i3); }
  function geoOf(a) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(a.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(a.n, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(a.u, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(a.c, 3)); g.setIndex(a.i); g.computeBoundingSphere(); return g; }
  const MT = {};
  function mats() { if (MT.stone) return MT;
    const m = (k, i) => { try { const md = MODELS[k]; return md && md.parts && md.parts[i] ? md.parts[i].material : null; } catch (e) { return null; } };
    MT.stone = m("e1_planter", 0); MT.timber = m("e1_bench", 0); MT.metal = m("e1_lantern", 0);
    try { for (const c of (window.PLAN_ENRICH && PLAN_ENRICH.chunks) || []) { const mm = c.m && c.m.material; if (mm && mm.vertexColors && mm.map && mm.normalScale && Math.abs(mm.normalScale.x - 1.2) < 1e-3) { MT.gravel = mm; break; } } } catch (e) {}
    const T0 = (p) => tiled(p, 1, 1);
    if (!MT.stone) MT.stone = new THREE.MeshStandardMaterial({ map: T0("/tex/travertine.jpg"), normalMap: T0("/tex/travertine_n.jpg"), normalScale: new THREE.Vector2(0.6, 0.6), color: 0xf4e9d6, roughness: 0.86, vertexColors: true, side: THREE.DoubleSide });
    if (!MT.timber) MT.timber = new THREE.MeshStandardMaterial({ map: T0("/tex/wood.jpg"), normalMap: T0("/tex/wood_n.jpg"), color: 0xb08a63, roughness: 0.82, vertexColors: true, side: THREE.DoubleSide });
    if (!MT.metal) MT.metal = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.65, roughness: 0.42, side: THREE.DoubleSide });
    if (!MT.gravel) MT.gravel = new THREE.MeshStandardMaterial({ map: T0("/tex/terrazzo.jpg"), normalMap: T0("/tex/terrazzo_n.jpg"), normalScale: new THREE.Vector2(1.2, 1.2), color: 0xffffff, vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    return MT; }
  const COLS = { sett: [0.4, 0.4, 0.4], sett2: [0.34, 0.34, 0.35], kerb: [0.93, 0.9, 0.84], cantera: [1, 0.97, 0.92], corten: [0.42, 0.2, 0.09], steel: [0.07, 0.068, 0.065], oldtimber: [0.72, 0.62, 0.52], gravel: [0.76, 0.73, 0.68], gravelR: [0.74, 0.45, 0.34], gravelD: [0.66, 0.62, 0.57], tie2: [0.6, 0.5, 0.42] };
  // world cells: one merged mesh per material per 300 m cell (frustum culled), a handful of draws in any view
  const CELL = 800, ACC = new Map();   // a few large cells: about 30 meshes for the whole site
  function accFor(mat, x, z) { const key = mat.uuid + ":" + Math.floor(x / CELL) + ":" + Math.floor(z / CELL); let a = ACC.get(key); if (!a) { a = newAcc(); a.mat = mat; ACC.set(key, a); } return a; }
  const gy = (x, z) => { try { return planGroundAt(x, z); } catch (e) { return getH(x, z); } };
  // the soldier course (a row of dark setts with joints, flush with the surface)
  function settRow(a, x0, z0, ax, az, len, nx, nz, wid, y0, ow) { if (inArr(x0 + ax * len / 2, z0 + az * len / 2)) return; const n = Math.max(1, Math.round(len / (ow ? 0.26 : 0.34))); const sl = len / n; for (let i = 0; i < n; i++) { const s0 = i * sl + (ow ? 0.02 : 0.012), s1 = (i + 1) * sl - (ow ? 0.02 : 0.012); const c = ow ? ((i * 7 + Math.round(x0)) % 4 === 0 ? COLS.tie2 : COLS.oldtimber) : (i + Math.round(x0 * 7 + z0 * 3)) % 3 === 0 ? COLS.sett2 : COLS.sett;
      const P = (s, o) => { const x = x0 + ax * s + nx * o, z = z0 + az * s + nz * o; return [x, (y0 === undefined ? gy(x, z) : y0) + 0.018, z]; };
      quadA(a, P(s0, -wid / 2), P(s1, -wid / 2), P(s1, wid / 2), P(s0, wid / 2), [s0 / 0.9, 0, s1 / 0.9, 0, s1 / 0.9, wid / 0.9, s0 / 0.9, wid / 0.9], c); } }
  function buildBands() { const M2 = mats(); let n = 0;
    for (const b of PP.bands) { try {
      if (b.kind === "end") { const ax = -b.uz, az = b.ux; const ow = !!b.soft && districtStyle(b.x, b.z) === "ow"; const a = accFor(ow ? M2.timber : M2.stone, b.x, b.z); settRow(a, b.x - ax * b.len / 2, b.z - az * b.len / 2, ax, az, b.len, b.ux, b.uz, b.wid, undefined, ow); n++; continue; }
      if (b.kind === "edge") { const R = b.R; const pts = R.r.pts; const L = polyLen2(pts); const s0 = Math.max(0, b.s0), s1 = Math.min(L, b.s1); if (s1 - s0 < 0.6) continue; const wid = 0.45;
        for (const sd of [-1, 1]) { let s = s0; while (s < s1 - 0.05) { const e = Math.min(s1, s + 2.0); const A = arcAt(pts, (s + e) / 2); const ux = A[2], uz = A[3]; const nx = -uz * sd, nz = ux * sd; const o = R.w / 2 - wid / 2 - 0.05;
            const sa = arcAt(pts, s); const ow = !!b.soft && districtStyle(sa[0], sa[1]) === "ow"; const a = accFor(ow ? M2.timber : M2.stone, sa[0], sa[1]); settRow(a, sa[0] + nx * o, sa[1] + nz * o, ux, uz, e - s, nx, nz, wid, undefined, ow); s = e; } } n++; } } catch (e) { note("band", e); } }
    cnt("bandsBuilt", n); }
  // termini: the pads (the path's own material, merged per material and walked), a low cantera kerb round each pad but its mouth
  function buildTermini() { const M2 = mats(); const by = new Map(); const RG = segGrid(collect().filter((R) => !R.bed && !R.air));
    for (const T of PP.termini) { if (T.kind !== "pad") continue; try { const pts = []; for (let i = 0; i < 28; i++) { const a = i / 28 * 6.2832; pts.push([T.x + Math.cos(a) * T.r, T.z + Math.sin(a) * T.r]); }
        const m = polygonNow(pts, T.mat, T.lift); if (!by.has(T.mat)) by.set(T.mat, []); by.get(T.mat).push(m);
        const mouth = Math.atan2(-T.uz, -T.ux); const half = T.court ? 0 : Math.asin(Math.min(1, ((T.mouthW || 3) / 2 + 0.6) / T.r)); const a = accFor(M2.stone, T.x, T.z); const N = 36; const rows = [];
        for (let i = 0; i <= N; i++) { const ang = mouth + half + (6.2832 - 2 * half) * i / N; const x = T.x + Math.cos(ang) * (T.r - 0.11), z = T.z + Math.sin(ang) * (T.r - 0.11); rows.push([x, z, Math.cos(ang), Math.sin(ang)]); }
        const y = gy(T.x, T.z);
        for (let i = 0; i < rows.length - 1; i++) { const [x0, z0, c0, s0] = rows[i], [x1, z1, c1, s1] = rows[i + 1]; const h0 = gy(x0, z0), h1 = gy(x1, z1); const t = 0.11, H = 0.12;
          { const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2; let open = false; for (const [O, v] of nearRibbons(RG, mx, mz)) if (v[0] < O.w / 2 + 0.45) { open = true; break; } if (open) continue; }
          quadA(a, [x0 - c0 * t, h0 + H, z0 - s0 * t], [x1 - c1 * t, h1 + H, z1 - s1 * t], [x1 + c1 * t, h1 + H, z1 + s1 * t], [x0 + c0 * t, h0 + H, z0 + s0 * t], [0, 0, 1, 0, 1, 0.2, 0, 0.2], COLS.cantera);
          wallA(a, [x0 + c0 * t, getH(x0 + c0 * t, z0 + s0 * t) - 0.05, z0 + s0 * t], [x1 + c1 * t, getH(x1 + c1 * t, z1 + s1 * t) - 0.05, z1 + s1 * t], [x1 + c1 * t, h1 + H, z1 + s1 * t], [x0 + c0 * t, h0 + H, z0 + s0 * t], [0, 0, 1, 0, 1, 0.3, 0, 0.3], COLS.kerb, c0, s0);
          wallA(a, [x1 - c1 * t, h1, z1 - s1 * t], [x0 - c0 * t, h0, z0 - s0 * t], [x0 - c0 * t, h0 + H, z0 - s0 * t], [x1 - c1 * t, h1 + H, z1 - s1 * t], [0, 0, 1, 0, 1, 0.2, 0, 0.2], COLS.kerb, -c0, -s0); }
      } catch (e) { note("terminus", e); } }
    for (const [mat, list] of by) { const mm = mergeMeshes(list, mat); mm.receiveShadow = true; mm.frustumCulled = true; mm.geometry.computeBoundingSphere(); mm.userData.noCull = true; mm.userData.pp = true; scene.add(mm); cnt("padMeshes"); } }
  function flushAcc() { let tris = 0, meshes = 0; for (const a of ACC.values()) { if (!a.i.length) continue; const g = geoOf(a); const m = new THREE.Mesh(g, a.mat); m.receiveShadow = true; m.castShadow = false; m.userData.noShadow = true; m.userData.pp = true; m.userData.noCull = true; m.frustumCulled = true; scene.add(m); tris += a.i.length / 3; meshes++; } ACC.clear(); cnt("tris", Math.round(tris)); cnt("meshes", meshes); }
  function buildGeo() { const t0 = performance.now(); try { buildTermini(); } catch (e) { note("termini", e); } try { buildBands(); } catch (e) { note("bands", e); } try { buildEdges(); } catch (e) { note("edges", e); } try { flushAcc(); } catch (e) { note("flush", e); } PP.t.geo = Math.round(performance.now() - t0); }
  // ───────────────────────── the "current" along every path ─────────────────────────
  // defer phase, merged per material in 400 m cells: dirt lanes get a gravel shoulder and a steel (Old West: timber) edge, decomposed
  // granite gets a steel edge and a narrow gravel band, stone walks without a plan_enrich kerb get a cantera kerb, boardwalks and walks
  // that stand over a drop get a railing. Every edge opens where another path, a plaza, a pad or a door meets it.
  const hash1 = (x) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  function districtStyle(x, z) { const d = planDistrictAt(x, z); const id = d ? d.id : ""; if (/S3_MAIN|S3_GATE|S3_FRONTIER|S3_RANCH/.test(id)) return "ow"; if (/S3_OUTPOST|S3_NIGHT|S3_NORTHYARD/.test(id)) return "out"; if (/^gp_/.test(id)) return "gp"; return "lux"; }
  function edgeOpen(G, R, x, z, ctx) {
    if (inArr(x, z)) return true;
    const near = nearRibbons(G, x, z); for (const [O, v] of near) { if (O.r === R.r || O.bed) continue; if (v[0] < O.w / 2 + 0.35) return true; }
    for (const p of ctx.plazas) if (Math.hypot(x - p.x, z - p.z) < p.r + 0.2) return true;
    for (const T of PP.termini) if (T.kind === "pad" && Math.hypot(x - T.x, z - T.z) < T.r + 0.4) return true;
    for (const d of ptNear(ctx.doors, x, z, 6)) if (Math.hypot(d[0] - x, d[1] - z) < 3.2) return true;
    return false; }
  function buildEdges() {
    const M2 = mats(); const all = collect().filter((R) => !R.bed); const rs = all.filter((R) => !R.air && R.w >= 1.4); const G = segGrid(all); const ctx = context();
    const promIds = new Set(((window.PLAN && PLAN.promenades) || []).map((p) => p.id)); let nS = 0, nE = 0, nK = 0, nR = 0;
    for (const R of rs) { const pts = R.r.pts; const L = polyLen2(pts); if (L < 2) continue; const tp = pts.taper || [0, 0]; const st = districtStyle(pts[Math.floor(pts.length / 2)][0], pts[Math.floor(pts.length / 2)][1]);
      const soft = R.fam === "soft", dg = R.fam === "dg", stone = R.mk === "stone" && !promIds.has(R.src), deck = R.fam === "deck";
      if (!soft && !dg && !stone && !deck) continue;
      const step = 1.0; const n = Math.max(2, Math.ceil(L / step));
      for (const sd of [-1, 1]) { let run = [];
        const flushRun = () => { if (run.length >= 3) emit(R, run, sd, st, soft, dg, stone, deck); run = []; };
        for (let i = 0; i <= n; i++) { const s = Math.min(L, i * L / n); if ((tp[0] > 0 && s < tp[0] + 0.5) || (tp[1] > 0 && s > L - tp[1] - 0.5)) { flushRun(); continue; }
          const A = arcAt(pts, s); const nx = -A[3] * sd, nz = A[2] * sd; const ex = A[0] + nx * (R.w / 2 + 0.25), ez = A[1] + nz * (R.w / 2 + 0.25);
          if (edgeOpen(G, R, ex, ez, ctx)) { flushRun(); continue; } run.push({ s, x: A[0], z: A[1], nx, nz }); }
        flushRun(); } }
    function emit(R, run, sd, st, soft, dg, stone, deck) { const hw = R.w / 2; const a0 = run[0];
      if (soft || dg) { // the gravel shoulder: from under the ribbon's eroded edge out to a ragged outer line
        const inner = soft ? hw - 0.35 : hw - 0.05, outer = soft ? (R.w >= 2.5 ? hw + 0.95 : hw + 0.45) : hw + 0.6; const col = R.mk === "redg" ? COLS.gravelR : soft ? COLS.gravel : COLS.gravelD;
        const a = accFor(M2.gravel, a0.x, a0.z);
        for (let k = 0; k < run.length - 1; k++) { const p = run[k], q = run[k + 1]; const ro = (r) => outer + (hash1(r.s * 0.71 + R.i * 3.1 + sd) - 0.5) * 0.36;
          const P = (r, o, dy) => { const x = r.x + r.nx * o, z = r.z + r.nz * o; return [x, getH(x, z) + dy, z]; };
          quadA(a, P(p, inner, 0.07), P(q, inner, 0.07), P(q, ro(q), 0.035), P(p, ro(p), 0.035), [p.s / 2, 0, q.s / 2, 0, q.s / 2, 0.6, p.s / 2, 0.6], col); nS++; } }
      if ((soft && R.w >= 2.5) || dg) { // the edge: corten steel, or timber in the Old West; at the shoulder's outer line for dirt, at the walk's edge for DG
        const ow = st === "ow"; const mat = ow ? M2.timber : M2.metal; const col = ow ? COLS.oldtimber : st === "out" ? COLS.steel : COLS.corten; const t = ow ? 0.07 : 0.022, H = ow ? 0.1 : 0.065; const o = soft ? hw + 0.95 : hw + 0.03;
        const a = accFor(mat, a0.x, a0.z);
        for (let k = 0; k < run.length - 1; k++) { const p = run[k], q = run[k + 1];
          const at = (r, oo) => { const x = r.x + r.nx * oo, z = r.z + r.nz * oo; return [x, z, Math.max(getH(x, z), soft ? -1e9 : gy(x, z) - 0.01)]; };
          const pi = at(p, o - t), po = at(p, o + t), qi = at(q, o - t), qo = at(q, o + t);
          quadA(a, [pi[0], pi[2] + H, pi[1]], [qi[0], qi[2] + H, qi[1]], [qo[0], qo[2] + H, qo[1]], [po[0], po[2] + H, po[1]], [p.s, 0, q.s, 0, q.s, 0.1, p.s, 0.1], col);
          wallA(a, [po[0], po[2] - 0.05, po[1]], [qo[0], qo[2] - 0.05, qo[1]], [qo[0], qo[2] + H, qo[1]], [po[0], po[2] + H, po[1]], [p.s, 0, q.s, 0, q.s, 0.12, p.s, 0.12], col, p.nx, p.nz);
          wallA(a, [qi[0], qi[2] - 0.05, qi[1]], [pi[0], pi[2] - 0.05, pi[1]], [pi[0], pi[2] + H, pi[1]], [qi[0], qi[2] + H, qi[1]], [q.s, 0, p.s, 0, p.s, 0.12, q.s, 0.12], col, -p.nx, -p.nz); nE++; } }
      if (stone) { const a = accFor(M2.stone, a0.x, a0.z); const t = 0.11, H = 0.11;
        for (let k = 0; k < run.length - 1; k++) { const p = run[k], q = run[k + 1]; const at = (r, oo) => { const x = r.x + r.nx * oo, z = r.z + r.nz * oo; return [x, z, gy(r.x + r.nx * (hw - 0.3), r.z + r.nz * (hw - 0.3))]; };
          const pi = at(p, hw - t), po = at(p, hw + t), qi = at(q, hw - t), qo = at(q, hw + t);
          quadA(a, [pi[0], pi[2] + H, pi[1]], [qi[0], qi[2] + H, qi[1]], [qo[0], qo[2] + H, qo[1]], [po[0], po[2] + H, po[1]], [p.s / 0.9, 0, q.s / 0.9, 0, q.s / 0.9, 0.25, p.s / 0.9, 0.25], COLS.kerb);
          wallA(a, [po[0], getH(po[0], po[1]) - 0.05, po[1]], [qo[0], getH(qo[0], qo[1]) - 0.05, qo[1]], [qo[0], qo[2] + H, qo[1]], [po[0], po[2] + H, po[1]], [p.s, 0, q.s, 0, q.s, 0.3, p.s, 0.3], COLS.kerb, p.nx, p.nz); nK++; } }
      if (deck || stone || (dg && R.w >= 3)) { // a railing where the walk's edge stands over a drop (the wash bridges, the banks)
        let rr = []; const out = () => { if (rr.length >= 3) rail(R, rr, deck); rr = []; };
        for (const p of run) { const x = p.x + p.nx * (hw - 0.12), z = p.z + p.nz * (hw - 0.12); const top = gy(x, z); const down = top - Math.min(getH(p.x + p.nx * (hw + 0.8), p.z + p.nz * (hw + 0.8)), getH(p.x + p.nx * (hw + 2), p.z + p.nz * (hw + 2))); if (down > 0.62) rr.push({ x, z, y: top, s: p.s, nx: p.nx, nz: p.nz }); else out(); }
        out(); } }
    function rail(R, rr, deck) { const ow = districtStyle(rr[0].x, rr[0].z) === "ow" || deck; const mat = ow ? M2.timber : M2.metal; const col = ow ? COLS.oldtimber : COLS.steel; const a = accFor(mat, rr[0].x, rr[0].z);
      const post = (p) => { const w = ow ? 0.06 : 0.025; const h = 1.0; const ux = -p.nz, uz = p.nx; const c = [[-w, -w], [w, -w], [w, w], [-w, w]].map(([u, v]) => [p.x + ux * u + p.nx * v, p.z + uz * u + p.nz * v]);
        for (let k = 0; k < 4; k++) { const A = c[k], B = c[(k + 1) % 4]; const fx = (A[0] + B[0]) / 2 - p.x, fz = (A[1] + B[1]) / 2 - p.z; const fl = Math.hypot(fx, fz) || 1; wallA(a, [A[0], p.y - 0.02, A[1]], [B[0], p.y - 0.02, B[1]], [B[0], p.y + h, B[1]], [A[0], p.y + h, A[1]], [0, 0, 0.1, 0, 0.1, 1, 0, 1], col, fx / fl, fz / fl); } };
      for (let k = 0; k < rr.length; k++) if (k % 2 === 0 || k === rr.length - 1) post(rr[k]);
      for (const [hy, th] of [[1.0, ow ? 0.05 : 0.025], [0.55, ow ? 0.035 : 0.012]]) for (let k = 0; k < rr.length - 1; k++) { const p = rr[k], q = rr[k + 1];
        quadA(a, [p.x - p.nx * th, p.y + hy + th, p.z - p.nz * th], [q.x - q.nx * th, q.y + hy + th, q.z - q.nz * th], [q.x + q.nx * th, q.y + hy + th, q.z + q.nz * th], [p.x + p.nx * th, p.y + hy + th, p.z + p.nz * th], [p.s, 0, q.s, 0, q.s, 0.1, p.s, 0.1], col);
        wallA(a, [p.x + p.nx * th, p.y + hy - th, p.z + p.nz * th], [q.x + q.nx * th, q.y + hy - th, q.z + q.nz * th], [q.x + q.nx * th, q.y + hy + th, q.z + q.nz * th], [p.x + p.nx * th, p.y + hy + th, p.z + p.nz * th], [p.s, 0, q.s, 0, q.s, 0.1, p.s, 0.1], col, p.nx, p.nz);
        wallA(a, [q.x - q.nx * th, q.y + hy - th, q.z - q.nz * th], [p.x - p.nx * th, p.y + hy - th, p.z - p.nz * th], [p.x - p.nx * th, p.y + hy + th, p.z - p.nz * th], [q.x - q.nx * th, q.y + hy + th, q.z - q.nz * th], [q.s, 0, p.s, 0, p.s, 0.1, q.s, 0.1], col, -p.nx, -p.nz); }
      try { const p0 = rr[0], p1 = rr[rr.length - 1]; const dx = p1.x - p0.x, dz = p1.z - p0.z, Lr = Math.hypot(dx, dz); if (Lr > 0.5) addSolid((p0.x + p1.x) / 2, (p0.z + p1.z) / 2, Math.atan2(dx, dz), 0.12, Lr, p0.y, p0.y + 1.05, "world"); } catch (e) {}
      nR++; }
    cnt("edge_shoulder_m", nS); cnt("edge_edging_m", nE); cnt("edge_kerb_m", nK); cnt("edge_rails", nR);
  }

  // world phase: the rhythm along the paths the engine does not light (it puts solar bollards on 3 to 12 m streets, plan_enrich lanterns
  // on the promenades): pathway lanterns every 22 m alternating sides on trails, spurs, module walks and the wide avenues, and a bench
  // every 140 m on the walks where there is none
  function rhythm() {
    const rs = collect().filter((R) => !R.bed && !R.air); const G = segGrid(collect().filter((R) => !R.bed)); const ctx = context();
    const promIds = new Set(((window.PLAN && PLAN.promenades) || []).map((p) => p.id));
    const colG = new Map(); try { for (const c of COLLIDERS) { const key = Math.floor(c[0] / 10) * 100003 + Math.floor(c[1] / 10); let a = colG.get(key); if (!a) colG.set(key, a = []); a.push(c); } } catch (e) {}
    const lampG = ptGrid([], 20); const benchG = ptGrid([], 40);
    const addP = (PG, q) => { const key = Math.floor(q[0] / PG.C) * 100003 + Math.floor(q[1] / PG.C); let c = PG.G.get(key); if (!c) PG.G.set(key, c = []); c.push(q); };
    for (const k in PLACE) { if (!/lamp|lantern|post|bollard|pillar/.test(k)) continue; for (const e of PLACE[k]) addP(lampG, [e[0], e[2]]); }
    for (const k in PLACE) { if (!/bench|seat/.test(k)) continue; for (const e of PLACE[k]) addP(benchG, [e[0], e[2]]); }
    const near = (PG, x, z, r) => { for (const q of ptNear(PG, x, z, r)) if (Math.hypot(q[0] - x, q[1] - z) < r) return true; return false; };
    const free = (x, z, r, own) => { if (inArr(x, z)) return false; try { if (!onLand(x, z) || distToRunway(x, z) < 45) return false; } catch (e) {}
      for (const [O, v] of nearRibbons(G, x, z)) { if (own && O.r === own.r) { if (v[0] < O.w / 2 + 0.3) return false; continue; } if (!O.bed && v[0] < O.w / 2 + 0.3 + r) return false; }
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const c = colG.get((Math.floor(x / 10) + i) * 100003 + Math.floor(z / 10) + j); if (c) for (const q of c) if (Math.hypot(q[0] - x, q[1] - z) < q[2] + r + 0.2) return false; }
      for (const k of ptNear(ctx.ko, x, z, 60)) if (Math.hypot(k[0] - x, k[1] - z) < k[2] && k[2] < 120) return false;
      for (const p of ctx.plazas) if (Math.hypot(x - p.x, z - p.z) < p.r + 0.5) return false;
      for (const T of PP.termini) if (Math.hypot(x - T.x, z - T.z) < T.r + 0.8) return false; return true; };
    let nl = 0, nb = 0;
    for (const R of rs) { const pts = R.r.pts; const L = polyLen2(pts); if (L < 10) continue; const st = districtStyle(pts[0][0], pts[0][1]);
      const walkish = R.fam === "dg" || R.fam === "deck" || R.mk === "stone" || (R.fam === "soft" && R.w < 4);
      const lit = (R.w >= 3 && R.w < 12 && R.fam !== "deck") || (promIds.has(R.src) && st !== "gp");   // the engine's bollards, plan_enrich's lanterns
      if (!lit && st !== "out") { const kind = st === "ow" ? "e1_tpost" : R.w >= 12 ? "e1_lantern" : "e1_lantern"; const off = R.w / 2 + (R.fam === "soft" ? 1.35 : 0.75);
        for (let s = 9, i = 0; s < L - 6; s += 22, i++) { const sd = i % 2 ? 1 : -1; const A = arcAt(pts, s); const x = A[0] - A[3] * sd * off, z = A[1] + A[2] * sd * off; if (near(lampG, x, z, 9) || !free(x, z, 0.3, R)) continue; putK(kind, x, z, Math.atan2(A[3] * sd, -A[2] * sd)); addP(lampG, [x, z]); nl++; } }
      if (walkish && L > 60) { for (let s = 70; s < L - 30; s += 140) { const A = arcAt(pts, s); for (const sd of [1, -1]) { const off = R.w / 2 + (R.fam === "soft" ? 1.5 : 0.95); const x = A[0] - A[3] * sd * off, z = A[1] + A[2] * sd * off; if (near(benchG, x, z, 50) || !free(x, z, 0.8, R)) continue; putK("e1_bench", x, z, Math.atan2(A[3] * sd, -A[2] * sd)); addP(benchG, [x, z]); nb++; break; } } } }
    cnt("rhythm_lanterns", nl); cnt("rhythm_benches", nb);
  }


  PP._dbg = { collect, segGrid, context, endOf: (R, w, G, c) => endOf(R, w, G, c), nearRibbons };
  // ───────────────────────── hooks ─────────────────────────
  window.PLAN_HOOKS.plan.push({ name: "pathsPlan", fn: function (P) { if (OFF) return; try { planPatch(P); } catch (e) { note("plan", e); } } });
  // plan data fixes (before the plan is indexed): the user's reference spots and the network's worst seams
  function gpLifts(P) { const W = (P.promenades || []).filter((r) => /^gp_p_/.test(r.id) && Array.isArray(r.pts) && r.pts.length >= 2).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const sd = (p, a, b) => { const vx = b[0] - a[0], vz = b[1] - a[1]; const L2 = vx * vx + vz * vz || 1e-9; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / L2)); return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vz * t); };
    const touch = (A, B) => { const m = ((A.width || 8) + (B.width || 8)) / 2 + 0.6; for (const p of A.pts) for (let k = 0; k < B.pts.length - 1; k++) if (sd(p, B.pts[k], B.pts[k + 1]) < m) return true; for (const p of B.pts) for (let k = 0; k < A.pts.length - 1; k++) if (sd(p, A.pts[k], A.pts[k + 1]) < m) return true; return false; };
    const col = new Map(); for (const A of W) { const used = new Set(); for (const B of W) if (col.has(B.id) && touch(A, B)) used.add(col.get(B.id)); let c = 0; while (used.has(c)) c++; col.set(A.id, c); A.ppLift = 0.005 * c; }
    cnt("gp_lift_levels", Math.max(0, ...col.values()) + 1); }
  function planPatch(P) {
    try { gpLifts(P); } catch (e) { note("gpLifts", e); }
    const road = (id) => (P.roads || []).find((r) => r.id === id), prom = (id) => (P.promenades || []).find((r) => r.id === id);
    // Rudder Way: the taxi street's slab ended on top of Founders Lane (path_overlap_2); it now stops at the lane's edge
    { const r = road("rudder_way"); if (r && r.pts.length >= 2) { const n = r.pts.length; const b = r.pts[n - 1], a = r.pts[n - 2]; const L = Math.hypot(a[0] - b[0], a[1] - b[1]); if (L > 10 && Math.hypot(b[0] - 348, b[1] + 361.1) < 1) { r.pts[n - 1] = [b[0] + (a[0] - b[0]) / L * 4.9, b[1] + (a[1] - b[1]) / L * 4.9]; cnt("patch_rudder"); } } }
    // the Wash Walk ended in a fountain in the open (path_dead_end): the Founders Fountain gets a paved court, the boardwalk stops at its
    // rim, and a short stone walk carries on from the court to Founders Lane, so the walk arrives somewhere and leads on
    { const w = prom("wash_walk"); const f = (P.fountains || []).find((q) => q.id === "founders_f");
      if (w && f && !(P.plazas || []).some((z) => z.id === "pz_founders_f")) { const n = w.pts.length; const b = w.pts[n - 1], a = w.pts[n - 2];
        if (Math.hypot(b[0] - f.x, b[1] - f.z) < 1) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const rr = 9; w.pts[n - 1] = [f.x + (a[0] - b[0]) / L * rr, f.z + (a[1] - b[1]) / L * rr];
          (P.plazas = P.plazas || []).push({ id: "pz_founders_f", name: "Founders Fountain Court", x: f.x, z: f.z, r: rr, character: "R15: the Wash Walk's east end, a paved court round the Founders Fountain with benches, on the walk to Founders Lane" });
          PP.courts = (PP.courts || []).concat([{ x: f.x, z: f.z, r: rr - 0.4 }]);
          const ln = road("founders_ln"); if (ln) { // the nearest point of Founders Lane to the fountain
            let best = null; for (let i = 0; i < ln.pts.length - 1; i++) { const p0 = ln.pts[i], p1 = ln.pts[i + 1]; const vx = p1[0] - p0[0], vz = p1[1] - p0[1]; const L2 = vx * vx + vz * vz; const t = Math.max(0, Math.min(1, ((f.x - p0[0]) * vx + (f.z - p0[1]) * vz) / L2)); const q = [p0[0] + vx * t, p0[1] + vz * t]; const d = Math.hypot(q[0] - f.x, q[1] - f.z); if (!best || d < best.d) best = { q, d }; }
            if (best && best.d > rr + 4 && best.d < 60) { const ux = (best.q[0] - f.x) / best.d, uz = (best.q[1] - f.z) / best.d; const hw = (ln.width || 9) / 2 - 0.6;
              (P.promenades = P.promenades || []).push({ id: "founders_court_walk", name: "Founders Fountain Walk", width: 4, pts: [[f.x + ux * (rr - 1), f.z + uz * (rr - 1)], [best.q[0] - ux * hw, best.q[1] - uz * hw]], character: "R15: from the Founders Fountain Court to Founders Lane", planting: "brittlebush and desert spoon" }); cnt("patch_founders_walk"); } }
          cnt("patch_founders_court"); } } }
  }
  window.PLAN_HOOKS.world.push({ name: "pathsWorld", fn: function () { if (!OFF) { try { networkFix("early"); } catch (e) { note("fix", e); }
      window.PLAN_HOOKS.world.push({ name: "pathsLate", fn: function () { try { networkFix("late"); } catch (e) { note("fixLate", e); } try { API.n = -1; apiGrid(); } catch (e) { note("api", e); } } }); }
    try { API.n = -1; apiGrid(); } catch (e) { note("api", e); } } });
  window.PLAN_HOOKS.defer.push({ name: "pathsDefer", fn: function () { if (!OFF) { try { networkFix("defer"); } catch (e) { note("fixDefer", e); } try { buildGeo(); } catch (e) { note("geo", e); } } PP.ready = true; try { API.n = -1; apiGrid(); } catch (e) { note("api2", e); } } });
})();
