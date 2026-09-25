// plan_enrich.js: E1 (round 2), luxury along every path and at every POI (PLAN mode only; the legacy world never runs it).
//  - every main road: a palm allee or shade trees in planted verge beds with stone kerbs (cactus and agave gardens, flowering
//    shrubs); every promenade: stone kerbs (the client skirts the timber boardwalks itself), planted beds, benches with
//    planters, pathway lanterns and string lights on posts over the walk; all instanced, spaced like a resort streetscape,
//    never on a carriageway, never in a doorway, an approach or a crossing, never blocking a walk
//  - roundabout islands kerbed and planted; Stratos Field and the Field of Light (ground art) get a basalt kerb and LED bollards
//  - every tree whose base is on or at the edge of a road, a walk or a plaza: a cast iron tree grate, a stone ring or a
//    timber planter kerb (Old West)
//  - every plaza: a real border (kerb, a low ornamental fence on posts with garden openings, entry pillars with lanterns,
//    lamps and trees framing the entries); Compass Plaza a full ring with stone posts, the fence, lamps and a palm ring
//  - the runway: a tall ornamental steel fence on a stone plinth between stone pillars along the parcel line on both sides
//    (2.9 m, under the 3 m allowed there), gated at the taxilane gates and marked where The Crossing passes under it, with
//    foliage behind it by the height rule (7:1 transitional surface from the edge of the primary surface; nothing over 7 m
//    closer than 150 m to the centreline) and palms beyond
// New models switch in by themselves as soon as MODELS[kind] exists: fanpalm2, datepalm, canarypalm, bench_lux, planter_lux,
// ph_planter_1..3, lux_lamp, fence_lux, stone_pillar, the cactus kinds and the Poly Haven shrubs and succulents.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || [];
(function () {
  const NEED = ["fanpalm2", "datepalm", "canarypalm", "bench_lux", "planter_lux", "ph_planter_1", "ph_planter_2", "ph_planter_3", "lux_lamp", "fence_lux", "stone_pillar",
    "saguaro_young", "saguaro_mid", "barrel_cactus", "prickly_pear", "cholla", "organ_pipe"];
  for (const k of NEED) if (window.PLAN_MODEL_NEEDS.indexOf(k) < 0) window.PLAN_MODEL_NEEDS.push(k);

  const E = window.PLAN_ENRICH = { n: {}, errs: [], t: {}, beds: [], bedRoads: [], raise: [], seats: [], strings: [], lanterns: [], fence: [], plazas: [], proms: [], chunks: [], mine: new Set(), done: false };
  const cnt = (k, d) => { E.n[k] = (E.n[k] || 0) + (d === undefined ? 1 : d); };
  const step = (name, fn) => { const t0 = performance.now(); try { fn(); } catch (e) { E.errs.push(name + ": " + ((e && e.stack) || e)); console.error("plan_enrich " + name + " failed:", (e && e.stack) || e); } E.t[name] = Math.round(performance.now() - t0); };
  // own seeded random: the engine's rnd() drives the desert scatter after the world hooks, so it is left untouched
  let seed = 0x5eed1e1; const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const has = (k) => !!(MODELS[k] && MODEL_SPECS[k]);
  const pick = (list) => list[Math.floor(rand() * list.length) % list.length];
  const OW = new Set(["S3_MAIN", "S3_GATE", "S3_FRONTIER", "S3_RANCH"]), DARK = new Set(["S3_OUTPOST", "S3_NORTHYARD"]);
  const distOf = (x, z) => { const d = planDistrictAt(x, z); return d ? d.id : ""; };

  // ───────────────────────── the runway frame and the height rule ─────────────────────────
  const RW = {};
  function rwInit() { const P = window.PLAN; const ne = P.runway.ne, sw = P.runway.sw; RW.L = Math.hypot(sw[0] - ne[0], sw[1] - ne[1]); RW.ux = (sw[0] - ne[0]) / RW.L; RW.uz = (sw[1] - ne[1]) / RW.L; RW.mx = (ne[0] + sw[0]) / 2; RW.mz = (ne[1] + sw[1]) / 2; RW.half = RW.L / 2; }
  const rwTS = (x, z) => [(x - RW.mx) * RW.ux + (z - RW.mz) * RW.uz, -(x - RW.mx) * RW.uz + (z - RW.mz) * RW.ux];
  const rwAt = (t, s) => [RW.mx + RW.ux * t - RW.uz * s, RW.mz + RW.uz * t + RW.ux * s];
  // may something h metres tall stand here? 7:1 transitional surface from the edge of the primary surface (76 m), nothing over
  // 7 m within 150 m of the centreline (IMPL2), and the approach surface (20:1 from 60 m past each end) beyond the ends
  function airOK(x, z, h) { const [t, s] = rwTS(x, z); const as = Math.abs(s), at = Math.abs(t); if (as > 520 || at > RW.half + 1400) return true;
    const tc = clamp(t, -RW.half, RW.half); const c = rwAt(tc, 0); const top = h + (getH(x, z) - getH(c[0], c[1]));
    if (at <= RW.half + 60) { if (h > 7 && as < 150) return false; return top <= (as - 76) / 7; }
    const d = at - RW.half - 60, hw = 76 + d * 0.15, app = d / 20; if (h > 7 && as < 150) return false; return as <= hw ? top <= app : top <= app + (as - hw) / 7; }

  // ───────────────────────── spatial tests ─────────────────────────
  // occupancy of the props already placed (plants, trees, lamps, bollards) and of everything this module places
  const OCC = { C: 6, m: new Map() };
  const occKey = (cx, cz) => cx * 100003 + cz;
  function occAdd(x, z, r, tag) { const C = OCC.C, k = occKey(Math.floor(x / C), Math.floor(z / C)); let a = OCC.m.get(k); if (!a) OCC.m.set(k, (a = [])); a.push([x, z, r, tag || 0]); }
  function occHit(x, z, r, tag) { const C = OCC.C, gx = Math.floor(x / C), gz = Math.floor(z / C); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = OCC.m.get(occKey(gx + i, gz + j)); if (!a) continue; for (const o of a) { if (tag && o[3] !== tag) continue; const dx = o[0] - x, dz = o[1] - z, rr = o[2] + r; if (dx * dx + dz * dz < rr * rr) return true; } } return false; }
  function occNear(x, z, r, tag) { const C = OCC.C, n = Math.ceil(r / C), gx = Math.floor(x / C), gz = Math.floor(z / C); for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { const a = OCC.m.get(occKey(gx + i, gz + j)); if (!a) continue; for (const o of a) { if (o[3] !== tag) continue; if (Math.hypot(o[0] - x, o[1] - z) < r) return true; } } return false; }
  function occBuild() { OCC.m.clear();
    for (const k in PLACE) { const sp = MODEL_SPECS[k], m = MODELS[k]; if (!sp || !m || !sp.prop || sp.animal || (sp.size && sp.size > 60)) continue; const tree = sp.sway && m.height > 3.5; const lamp = k === "lamp" || k === "lux_lamp";
      for (const e of PLACE[k]) occAdd(e[0], e[2], lamp ? 0.4 : tree ? 0.9 : Math.max(0.3, m.radius * e[4] * 0.62), lamp ? "lamp" : tree ? "tree" : "plant"); }
    for (const q of (SOLAR && SOLAR.pts) || []) occAdd(q[0], q[1], 0.35, "bollard"); }
  // box solids by cell
  const SG = { C: 20, m: new Map(), n: -1 };
  function solidGrid() { if (SG.n === SOLIDS.length) return; SG.m.clear(); SG.n = SOLIDS.length; const C = SG.C; for (const sd of SOLIDS) { const r = Math.hypot(sd.hw, sd.hd) + 0.5; for (let cx = Math.floor((sd.x - r) / C); cx <= Math.floor((sd.x + r) / C); cx++) for (let cz = Math.floor((sd.z - r) / C); cz <= Math.floor((sd.z + r) / C); cz++) { const k = occKey(cx, cz); let a = SG.m.get(k); if (!a) SG.m.set(k, (a = [])); a.push(sd); } } }
  function solidHit(x, z, r, minSize) { solidGrid(); const a = SG.m.get(occKey(Math.floor(x / SG.C), Math.floor(z / SG.C))); if (!a) return false; for (const sd of a) { if (minSize && Math.max(sd.hw, sd.hd) < minSize) continue; const [lx, lz] = solidLocal(sd, x, z); if (Math.abs(lx) < sd.hw + r && Math.abs(lz) < sd.hd + r) return true; } return false; }
  // colliders at least minR big (buildings, set pieces), not the lamps and trees a bed may enclose
  function bigColHit(x, z, gap, minR) { planColSync(); const a = PGRID.col.get(Math.floor(x / PGRID.C) * 100003 + Math.floor(z / PGRID.C)); if (!a) return false; for (const c of a) { if (c[2] < minR) continue; if (Math.hypot(c[0] - x, c[1] - z) < c[2] + gap) return true; } return false; }
  // the small keep-outs (signs, kiosks, markers) by cell
  const KG = { C: 20, m: new Map() };
  function keepBuild() { KG.m.clear(); for (const k of KEEPOUT) { if (k[2] >= 12) continue; const r = k[2]; for (let cx = Math.floor((k[0] - r) / KG.C); cx <= Math.floor((k[0] + r) / KG.C); cx++) for (let cz = Math.floor((k[1] - r) / KG.C); cz <= Math.floor((k[1] + r) / KG.C); cz++) { const kk = occKey(cx, cz); let a = KG.m.get(kk); if (!a) KG.m.set(kk, (a = [])); a.push(k); } } }
  function keepHit(x, z, r) { const a = KG.m.get(occKey(Math.floor(x / KG.C), Math.floor(z / KG.C))); if (!a) return false; for (const k of a) if (Math.hypot(k[0] - x, k[1] - z) < k[2] + r) return true; return false; }
  // the way into every building: a lane 2 m either side of the line from its front door 12 m out
  const DG = { C: 20, m: new Map() };
  function doorBuild() { DG.m.clear(); for (const r of PLAN_BLD || []) { const e = r.e, m = MODELS[r.kind], sp = MODEL_SPECS[r.kind]; if (!e || !m || !sp || sp.prop || sp.vehicle) continue; const fx = Math.sin(e[3]), fz = Math.cos(e[3]); const d0 = m.sz / 2 * e[4] + 0.4;
      const seg = [e[0] + fx * d0, e[2] + fz * d0, e[0] + fx * (d0 + 12), e[2] + fz * (d0 + 12)]; for (const [x, z] of [[seg[0], seg[1]], [(seg[0] + seg[2]) / 2, (seg[1] + seg[3]) / 2], [seg[2], seg[3]]]) { const k = occKey(Math.floor(x / DG.C), Math.floor(z / DG.C)); let a = DG.m.get(k); if (!a) DG.m.set(k, (a = [])); if (!a.includes(seg)) a.push(seg); } } }
  function doorHit(x, z, r) { const gx = Math.floor(x / DG.C), gz = Math.floor(z / DG.C); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = DG.m.get(occKey(gx + i, gz + j)); if (!a) continue; for (const s of a) { const vx = s[2] - s[0], vz = s[3] - s[1]; const t = clamp(((x - s[0]) * vx + (z - s[1]) * vz) / (vx * vx + vz * vz), 0, 1); if (Math.hypot(x - s[0] - vx * t, z - s[1] - vz * t) < 2.0 + r) return true; } } return false; }
  const APPR = [];
  function approachInit() { APPR.length = 0; try { const G = window.PLAN_GBANK; if (G && G.site && typeof G.site.cx === "number") APPR.push([G.site.px, G.site.pz, G.site.cx, G.site.cz, 6.5]); } catch (e) {}
    try { for (const a of window.PLAN_APPROACH || []) if (Array.isArray(a) && a.length >= 4) APPR.push([a[0], a[1], a[2], a[3], a[4] || 3]); } catch (e) {} }
  function approachHit(x, z, pad) { for (const a of APPR) { const vx = a[2] - a[0], vz = a[3] - a[1]; const L2 = vx * vx + vz * vz || 1; const t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / L2, 0, 1); if (Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t) < a[4] + (pad || 0)) return true; } return false; }
  function inPlaza(x, z, pad) { for (const p of PLAZAS) if (Math.hypot(p[0] - x, p[1] - z) < p[2] + (pad || 0)) return p; return null; }
  function fountHit(x, z, r) { for (const f of PLAN_IDX.fount.values()) if (f._r && Math.hypot(f.x - x, f.z - z) < f._r + 1.5 + r) return true; return false; }
  function inTrench(x, z) { const F = window.PLAN_FLOOR; if (typeof F !== "function") return false; try { return typeof F(x, z) === "number"; } catch (e) { return false; } }
  const inTerrain = (x, z) => x > T.xmin + 25 && x < T.xmax - 25 && z > T.zmin + 25 && z < T.zmax - 25;
  // distance from (x, z) to the edge of the nearest of the ribbons in `own` (< 0 inside), or Infinity
  function ownEdge(x, z, own) { if (!own || !own.size) return Infinity; const a = planSegGrid().get(Math.floor(x / PGRID.C) * 100003 + Math.floor(z / PGRID.C)); if (!a) return Infinity; let best = Infinity;
    for (const s of a) { if (!own.has(s[5])) continue; const vx = s[2] - s[0], vz = s[3] - s[1]; const L2 = vx * vx + vz * vz || 1; const t = clamp(((x - s[0]) * vx + (z - s[1]) * vz) / L2, 0, 1); const d = Math.hypot(x - s[0] - vx * t, z - s[1] - vz * t) - s[4]; if (d < best) best = d; } return best; }
  // a spot for a planted or placed thing of radius r: our land, off every ribbon (except own), building, solid, plaza, door lane and trench
  function spotOK(x, z, r, own, o) { o = o || {};
    if (!inTerrain(x, z)) return false; const zn = planZone(x, z); if (zn !== "land" && !(o.city && zn === "city")) return false;
    if (distToRunway(x, z) < (o.rw || 96)) return false; if (planNearRoad(x, z, r + (o.road === undefined ? 0.3 : o.road), own)) return false;
    if (own) { const ed = ownEdge(x, z, own); const er = o.edgeR === undefined ? r * 0.5 : o.edgeR; if (o.inside ? ed > -(er + 0.1) : ed < er) return false; }
    if (planNearCollider(x, z, r + 0.25)) return false; if (solidHit(x, z, r + 0.15)) return false; if (!o.plaza && inPlaza(x, z, 0.5 + r)) return false;
    if (planPolyBlocked(x, z)) return false; if (fountHit(x, z, r)) return false; if (keepHit(x, z, r + 0.2)) return false; if (!o.door && doorHit(x, z, r)) return false;
    if (occHit(x, z, r)) return false; if (inTrench(x, z)) return false; if (approachHit(x, z, r)) return false; return true; }
  // for testing: the first spot test that fails at (x, z) for radius r (null when the spot is free)
  E.why = function (x, z, r) { r = r || 1; if (!inTerrain(x, z)) return "terrain"; const zn = planZone(x, z); if (zn !== "land") return "zone:" + zn; if (distToRunway(x, z) < 96) return "runway"; if (planNearRoad(x, z, r + 0.3)) return "ribbon"; if (planNearCollider(x, z, r + 0.25)) return "collider"; if (solidHit(x, z, r + 0.15)) return "solid"; if (inPlaza(x, z, 0.5 + r)) return "plaza"; if (planPolyBlocked(x, z)) return "keepoutPoly"; if (fountHit(x, z, r)) return "fountain"; if (keepHit(x, z, r + 0.2)) return "keepout"; if (doorHit(x, z, r)) return "door"; if (occHit(x, z, r)) return "occupied"; if (inTrench(x, z)) return "trench"; if (approachHit(x, z, r)) return "approach"; return null; };
  // the Genesis Ring stays open on the horizon from the courts that frame it (D2's rule, for the trees this module adds round them)
  const VIEWS = [];
  function viewsInit() { const P = window.PLAN; const rg = planPlace("genesis_ring"); if (!rg) return; for (const id of ["pz_court", "pz_crossing", "pz_compass", "pz_gate", "pz_fcourt"]) { const z = PLAN_IDX.plaza.get(id); if (z) VIEWS.push([z.x, z.z, rg.x, rg.z]); }
    const sc = PLAN_IDX.prom.get("hl4_sculpture_ave"); if (sc) VIEWS.push([sc.pts[0][0], sc.pts[0][1], rg.x, rg.z]); const ms = window.PLAN_MAIN_PTS || (PLAN_IDX.prom.get("hl3_main_street") || {}).pts; if (ms) VIEWS.push([ms[0][0], ms[0][1], rg.x, rg.z]); }
  function blocksView(x, z) { for (const v of VIEWS) { const dx = v[2] - v[0], dz = v[3] - v[1], L2 = dx * dx + dz * dz; const t = ((x - v[0]) * dx + (z - v[1]) * dz) / L2; if (t <= 0 || t >= 1) continue; if (Math.hypot(x - v[0] - dx * t, z - v[1] - dz * t) < 7.5) return true; } return false; }

  // ───────────────────────── polylines ─────────────────────────
  function plen(pts) { let L = 0; for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return L; }
  // samples every `st` metres from a0 to a1 with smoothed tangents: { x, z, ux, uz, d }
  function samples(pts, st, a0, a1) { const L = plen(pts); a0 = a0 || 0; a1 = a1 === undefined ? L : Math.min(L, a1); const out = []; if (a1 - a0 < 0.01) return out;
    const at = (d) => { let acc = 0; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-6) continue; if (acc + l >= d || i === pts.length - 2) { const t = clamp((d - acc) / l, 0, 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; } acc += l; } return pts[pts.length - 1].slice(); };
    const n = Math.max(1, Math.round((a1 - a0) / st)); for (let k = 0; k <= n; k++) { const d = a0 + (a1 - a0) * k / n; const p = at(d), p0 = at(Math.max(0, d - 1.5)), p1 = at(Math.min(L, d + 1.5)); let ux = p1[0] - p0[0], uz = p1[1] - p0[1]; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l; out.push({ x: p[0], z: p[1], ux, uz, d }); }
    return out; }
  // side sd (-1 / +1) offset o: the same side convention as the core layout (x - uz * o * sd, z + ux * o * sd)
  const offP = (s, o) => [s.x - s.uz * o, s.z + s.ux * o];

  // ───────────────────────── materials and textures ─────────────────────────
  const MT = {};
  function canvasTex(w, h, draw, srgb) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace; return t; }
  // the fence atlas: the tall runway panel (3.0 m x 2.25 m) in the top half, the low plaza railing (2.4 m x 0.95 m) in the bottom half
  function atlasDraw(g, W, H) { g.clearRect(0, 0, W, H);
    const vbar = (x0, x1, y0, y1) => { const gr = g.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, "#4a4540"); gr.addColorStop(0.42, "#b9b0a4"); gr.addColorStop(1, "#35312d"); g.fillStyle = gr; g.fillRect(x0, y0, Math.max(1, x1 - x0), y1 - y0); };
    const hbar = (x0, x1, y0, y1) => { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, "#c2b9ad"); gr.addColorStop(0.5, "#7f776e"); gr.addColorStop(1, "#3a3531"); g.fillStyle = gr; g.fillRect(x0, y0, x1 - x0, Math.max(1, y1 - y0)); };
    const ring = (cx, cy, r, lw) => { g.strokeStyle = "#a39a8e"; g.lineWidth = lw; g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.stroke(); };
    const spear = (cx, y, w, h) => { g.fillStyle = "#aaa196"; g.beginPath(); g.moveTo(cx - w, y); g.lineTo(cx, y - h); g.lineTo(cx + w, y); g.closePath(); g.fill(); };
    { // runway panel: rows 0..511, 3.0 m across 1024 px, 2.25 m up 500 px (bottom margin 6 px)
      const X = (m) => m / 3.0 * W, Y = (m) => 506 - m / 2.25 * 490;
      hbar(0, W, Y(0.12), Y(0.04)); hbar(0, W, Y(0.3), Y(0.24)); hbar(0, W, Y(1.62), Y(1.56)); hbar(0, W, Y(1.98), Y(1.9));
      for (let i = 0; i < 24; i++) { const cx = X((i + 0.5) * 0.125), hw = X(0.011); vbar(cx - hw, cx + hw, Y(i % 2 ? 2.08 : 2.14), Y(0.04)); spear(cx, Y(i % 2 ? 2.08 : 2.14), X(0.022), X(i % 2 ? 0.06 : 0.09)); }
      for (let i = 0; i < 24; i++) { const cx = X((i + 1) * 0.125); if (i === 23) continue; ring(cx, Y(1.765), X(0.052), X(0.012)); }
      for (let i = 0; i < 12; i++) { const cx = X((i + 0.5) * 0.25); g.strokeStyle = "#a39a8e"; g.lineWidth = X(0.01); g.beginPath(); g.moveTo(cx - X(0.1), Y(0.3)); g.quadraticCurveTo(cx, Y(0.5), cx + X(0.1), Y(0.3)); g.stroke(); }
      vbar(0, X(0.04), Y(2.22), Y(0.0)); vbar(W - X(0.04), W, Y(2.22), Y(0.0)); g.fillStyle = "#b0a79b"; g.beginPath(); g.arc(0, Y(2.22), X(0.05), 0, 6.2832); g.arc(W, Y(2.22), X(0.05), 0, 6.2832); g.fill(); }
    { // plaza railing: rows 512..1023, 2.4 m across, 0.95 m up 500 px
      const X = (m) => m / 2.4 * W, Y = (m) => 1018 - m / 0.95 * 490;
      hbar(0, W, Y(0.12), Y(0.04)); hbar(0, W, Y(0.92), Y(0.83)); hbar(0, W, Y(0.68), Y(0.61));
      for (let i = 0; i < 20; i++) { const cx = X((i + 0.5) * 0.12), hw = X(0.014); vbar(cx - hw, cx + hw, Y(0.86), Y(0.04)); }
      for (let i = 0; i < 20; i++) { if (i === 19) continue; ring(X((i + 1) * 0.12), Y(0.745), X(0.042), X(0.016)); }
      vbar(0, X(0.03), Y(0.95), Y(0.0)); vbar(W - X(0.03), W, Y(0.95), Y(0.0)); } }
  function discDraw(g, W) { const gr = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.55, "rgba(255,250,240,1)"); gr.addColorStop(0.7, "rgba(255,240,220,0)"); g.fillStyle = gr; g.fillRect(0, 0, W, W); }
  function haloDraw(g, W) { const gr = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2); gr.addColorStop(0, "rgba(255,214,150,0.9)"); gr.addColorStop(0.25, "rgba(255,190,110,0.35)"); gr.addColorStop(0.6, "rgba(255,170,90,0.08)"); gr.addColorStop(1, "rgba(255,170,90,0)"); g.fillStyle = gr; g.fillRect(0, 0, W, W); }
  function mats() { if (MT.stone) return MT; const T0 = (p) => tiled(p, 1, 1);
    MT.stone = new THREE.MeshStandardMaterial({ map: T0("/tex/travertine.jpg"), normalMap: T0("/tex/travertine_n.jpg"), normalScale: new THREE.Vector2(0.6, 0.6), color: 0xf4e9d6, roughness: 0.86, vertexColors: true, side: THREE.DoubleSide });
    MT.timber = new THREE.MeshStandardMaterial({ map: T0("/tex/wood.jpg"), normalMap: T0("/tex/wood_n.jpg"), color: 0xb08a63, roughness: 0.82, vertexColors: true, side: THREE.DoubleSide });
    MT.metal = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.65, roughness: 0.42, side: THREE.DoubleSide });
    MT.bed = new THREE.MeshStandardMaterial({ map: T0("/tex/terrazzo.jpg"), normalMap: T0("/tex/terrazzo_n.jpg"), normalScale: new THREE.Vector2(1.2, 1.2), color: 0xffffff, vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    MT.alpha = new THREE.MeshStandardMaterial({ map: canvasTex(1024, 1024, atlasDraw), alphaTest: 0.38, color: 0x3a322a, metalness: 0.35, roughness: 0.5, side: THREE.DoubleSide });
    MT.glow = M.lampGlow;   // the engine's warm bulb material: it lights up at night on its own
    MT.disc = canvasTex(64, 64, discDraw); MT.halo = canvasTex(128, 128, haloDraw);
    return MT; }
  // vertex colours (linear) that tint the shared materials
  const COL = { cantera: [1, 0.97, 0.92], limestone: [0.93, 0.9, 0.84], basalt: [0.2, 0.19, 0.19], adobe: [0.86, 0.66, 0.5], iron: [0.05, 0.048, 0.045], bronze: [0.22, 0.15, 0.09], timber: [1, 1, 1], oldtimber: [0.72, 0.62, 0.52], teak: [1.15, 0.92, 0.7], mulch: [0.3, 0.2, 0.14], gravel: [0.95, 0.86, 0.72], redgravel: [0.78, 0.4, 0.27], soil: [0.26, 0.18, 0.12], white: [1, 1, 1] };

  // ───────────────────────── geometry accumulators ─────────────────────────
  function newAcc() { return { p: [], n: [], u: [], c: [], i: [] }; }
  function vtx(a, x, y, z, nx, ny, nz, u, v, col) { a.p.push(x, y, z); a.n.push(nx, ny, nz); a.u.push(u, v); a.c.push(col[0], col[1], col[2]); return a.p.length / 3 - 1; }
  // quad p0 p1 p2 p3 (in order round the face), uv per corner
  // (the normal comes from a triangle of the quad that has an area: a fan quad repeats a corner, and a zero normal turns into NaN
  // in the shader, which the bloom pass then smears into black squares across the screen)
  function quad(a, P0, P1, P2, P3, uv, col) { const cr = (A, B, C) => { const ax = B[0] - A[0], ay = B[1] - A[1], az = B[2] - A[2], bx = C[0] - A[0], by = C[1] - A[1], bz = C[2] - A[2]; return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]; };
    let [nx, ny, nz] = cr(P0, P1, P3); let l = Math.hypot(nx, ny, nz); if (l < 1e-9) { [nx, ny, nz] = cr(P0, P1, P2); l = Math.hypot(nx, ny, nz); } if (l < 1e-9) { [nx, ny, nz] = cr(P1, P2, P3); l = Math.hypot(nx, ny, nz); } if (l < 1e-9) { nx = 0; ny = 1; nz = 0; l = 1; } nx /= l; ny /= l; nz /= l;
    const i0 = vtx(a, P0[0], P0[1], P0[2], nx, ny, nz, uv[0], uv[1], col), i1 = vtx(a, P1[0], P1[1], P1[2], nx, ny, nz, uv[2], uv[3], col), i2 = vtx(a, P2[0], P2[1], P2[2], nx, ny, nz, uv[4], uv[5], col), i3 = vtx(a, P3[0], P3[1], P3[2], nx, ny, nz, uv[6], uv[7], col); a.i.push(i0, i1, i2, i0, i2, i3); }
  // an oriented box: centre (cx, cy, cz), half sizes along its local x (yaw ry), y and z; uv in metres / tile
  function boxA(a, cx, cy, cz, hx, hy, hz, ry, col, tile) { const c = Math.cos(ry || 0), s = Math.sin(ry || 0); const X = [c, 0, -s], Z = [s, 0, c]; const tl = tile || 1;
    const P = (sx, sy, sz) => [cx + X[0] * hx * sx + Z[0] * hz * sz, cy + hy * sy, cz + X[2] * hx * sx + Z[2] * hz * sz];
    const u2 = (w, h) => [0, 0, w / tl, 0, w / tl, h / tl, 0, h / tl];
    quad(a, P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), u2(2 * hx, 2 * hy), col); quad(a, P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), u2(2 * hx, 2 * hy), col);
    quad(a, P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), u2(2 * hz, 2 * hy), col); quad(a, P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), u2(2 * hz, 2 * hy), col);
    quad(a, P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1), u2(2 * hx, 2 * hz), col); quad(a, P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), u2(2 * hx, 2 * hz), col); }
  // a kerb, plinth or rail along a path: rows [{ x, z, nx, nz, y0, y1, hw, d }] (n = the across direction); top and both faces, end caps
  function prismA(a, rows, col, tile, caps) { const tl = tile || 1;
    for (let k = 0; k < rows.length - 1; k++) { const r0 = rows[k], r1 = rows[k + 1]; const L0 = [r0.x + r0.nx * r0.hw, r0.z + r0.nz * r0.hw], R0 = [r0.x - r0.nx * r0.hw, r0.z - r0.nz * r0.hw], L1 = [r1.x + r1.nx * r1.hw, r1.z + r1.nz * r1.hw], R1 = [r1.x - r1.nx * r1.hw, r1.z - r1.nz * r1.hw]; const u0 = r0.d / tl, u1 = r1.d / tl;
      quad(a, [R0[0], r0.y1, R0[1]], [R1[0], r1.y1, R1[1]], [L1[0], r1.y1, L1[1]], [L0[0], r0.y1, L0[1]], [u0, 0, u1, 0, u1, 2 * r1.hw / tl, u0, 2 * r0.hw / tl], col);
      quad(a, [L0[0], r0.y0, L0[1]], [L0[0], r0.y1, L0[1]], [L1[0], r1.y1, L1[1]], [L1[0], r1.y0, L1[1]], [u0, 0, u0, (r0.y1 - r0.y0) / tl, u1, (r1.y1 - r1.y0) / tl, u1, 0], col);
      quad(a, [R1[0], r1.y0, R1[1]], [R1[0], r1.y1, R1[1]], [R0[0], r0.y1, R0[1]], [R0[0], r0.y0, R0[1]], [u1, 0, u1, (r1.y1 - r1.y0) / tl, u0, (r0.y1 - r0.y0) / tl, u0, 0], col); }
    if (caps !== false && rows.length > 1) for (const r of [rows[0], rows[rows.length - 1]]) { const L = [r.x + r.nx * r.hw, r.z + r.nz * r.hw], R = [r.x - r.nx * r.hw, r.z - r.nz * r.hw]; quad(a, [R[0], r.y0, R[1]], [R[0], r.y1, R[1]], [L[0], r.y1, L[1]], [L[0], r.y0, L[1]], [0, 0, 0, (r.y1 - r.y0) / tl, 2 * r.hw / tl, (r.y1 - r.y0) / tl, 2 * r.hw / tl, 0], col); } }
  // a vertical textured band along a path (fence panels): rows [{ x, z, y0, y1, d }], u = d / tile, v from v0 to v1
  function bandA(a, rows, tile, v0, v1, col) { for (let k = 0; k < rows.length - 1; k++) { const r0 = rows[k], r1 = rows[k + 1]; quad(a, [r0.x, r0.y0, r0.z], [r1.x, r1.y0, r1.z], [r1.x, r1.y1, r1.z], [r0.x, r0.y1, r0.z], [r0.d / tile, v0, r1.d / tile, v0, r1.d / tile, v1, r0.d / tile, v1], col); } }
  function geoOf(a) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(a.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(a.n, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(a.u, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(a.c, 3)); g.setIndex(a.i); g.computeBoundingSphere(); g.computeBoundingBox(); return g; }
  // world meshes, merged per material in 400 m cells (a few draws for the whole network, range culled in the frame hook)
  const CHK = 4000, ACC = new Map();   // one cell for the whole section (x, z within 2 km of the origin): a handful of draws for 260k triangles
  const RANGE = () => new Map([[MT.stone, 1600], [MT.alpha, 1300], [MT.timber, 1000], [MT.bed, 800]]); let RMAP = null;
  function wacc(mat, x, z, shadow) { if (!RMAP) RMAP = RANGE(); const range = RMAP.get(mat) || 900; const cx = Math.floor((x + CHK / 2) / CHK), cz = Math.floor((z + CHK / 2) / CHK); const sh = !!shadow && mat !== MT.alpha; const key = mat.uuid + ":" + cx + ":" + cz + (sh ? ":s" : "");   /* the few shadow casters (fence pillars, plaza posts) apart from the kerbs */ let a = ACC.get(key); if (!a) { a = newAcc(); a.mat = mat; a.cx = cx; a.cz = cz; a.shadow = !!shadow; a.range = range || 0; ACC.set(key, a); } else if (shadow) a.shadow = true; return a; }
  function flush() { let tris = 0; for (const a of ACC.values()) { if (!a.i.length) continue; const g = geoOf(a); const m = new THREE.Mesh(g, a.mat); m.castShadow = a.shadow && (shadowAll() || a.mat === MT.alpha); m.receiveShadow = true; m.userData.noInst = true; m.userData.e1 = true; scene.add(m); tris += a.i.length / 3;
      cnt("tri:" + (a.mat === MT.stone ? "stone" : a.mat === MT.bed ? "bed" : a.mat === MT.alpha ? "fence" : a.mat === MT.timber ? "timber" : "other"), a.i.length / 3); const bs = g.boundingSphere; E.chunks.push({ m, x: bs.center.x, z: bs.center.z, r: bs.radius, range: a.range || 900 }); if (a.mat === MT.bed) { try { walkAdd(g); } catch (e) {} } } ACC.clear(); cnt("worldTris", Math.round(tris)); cnt("worldMeshes", E.chunks.length); }

  // ───────────────────────── instanced models of this module (the engine instances, range culls and shadows them) ─────────────────────────
  function vmodel(kind, parts, spec) { const bb = new THREE.Box3(); const ps = parts.map(([acc, mat, noShadow]) => { const g = geoOf(acc); bb.union(g.boundingBox); return { geometry: g, material: mat, noShadow: !!noShadow }; });
    const sx = bb.max.x - bb.min.x, sz = bb.max.z - bb.min.z; MODELS[kind] = { parts: ps, norm: new THREE.Matrix4(), bottom: 0, radius: Math.max(sx, sz) / 2, height: bb.max.y, sx, sz, sink: 0 };
    MODEL_SPECS[kind] = Object.assign({ height: bb.max.y, prop: true, solid: 0, e1: true }, spec || {}); }
  function buildModels() { const m = mats();
    { // e1_bench: teak slats on two cast bronze-black frames, 1.9 m, the sitter faces +z
      const wood = newAcc(), iron = newAcc();
      for (let i = 0; i < 5; i++) boxA(wood, 0, 0.445, -0.19 + i * 0.095, 0.95, 0.018, 0.04, 0, COL.teak, 0.6);
      for (let i = 0; i < 3; i++) boxA(wood, 0, 0.6 + i * 0.12, -0.265 - i * 0.018, 0.95, 0.042, 0.016, 0, COL.teak, 0.6);
      for (const sx of [-0.82, 0.82]) { boxA(iron, sx, 0.22, 0.17, 0.028, 0.22, 0.028, 0, COL.iron); boxA(iron, sx, 0.44, -0.27, 0.028, 0.44, 0.028, 0, COL.iron); boxA(iron, sx, 0.405, -0.05, 0.03, 0.022, 0.24, 0, COL.iron); boxA(iron, sx, 0.66, -0.03, 0.035, 0.02, 0.25, 0, COL.iron); boxA(iron, sx, 0.54, 0.19, 0.025, 0.12, 0.025, 0, COL.iron); boxA(iron, sx, 0.012, -0.05, 0.05, 0.012, 0.28, 0, COL.iron); }
      boxA(iron, 0, 0.36, -0.05, 0.8, 0.015, 0.02, 0, COL.iron);
      vmodel("e1_bench", [[mergeAcc(wood, iron), m.timber]], { e1range: 170 }); }
    { // e1_planter: a cast stone planter with a lip and a plinth, soil at 0.66 m
      const st = newAcc(), soil = newAcc(); boxA(st, 0, 0.36, 0, 0.52, 0.33, 0.52, 0, COL.limestone, 0.6); boxA(st, 0, 0.69, 0, 0.58, 0.035, 0.58, 0, COL.cantera, 0.6); boxA(st, 0, 0.035, 0, 0.57, 0.035, 0.57, 0, COL.cantera, 0.6);
      quad(soil, [-0.5, 0.7, 0.5], [0.5, 0.7, 0.5], [0.5, 0.7, -0.5], [-0.5, 0.7, -0.5], [0, 0, 1, 0, 1, 1, 0, 1], COL.soil);
      vmodel("e1_planter", [[mergeAcc(st, soil), m.stone]], { solid: 0.55, e1range: 170 }); }
    { // e1_lantern: a 1.15 m pathway lantern, bronze-black post, glass lantern
      const iron = newAcc(), glass = newAcc(); boxA(iron, 0, 0.02, 0, 0.13, 0.02, 0.13, 0, COL.iron); boxA(iron, 0, 0.46, 0, 0.035, 0.44, 0.035, 0, COL.iron); boxA(iron, 0, 0.91, 0, 0.1, 0.012, 0.1, 0, COL.iron);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) boxA(iron, sx * 0.085, 1.04, sz * 0.085, 0.011, 0.12, 0.011, 0, COL.iron); boxA(iron, 0, 1.18, 0, 0.12, 0.018, 0.12, 0, COL.iron); boxA(iron, 0, 1.225, 0, 0.06, 0.03, 0.06, 0, COL.iron);
      boxA(glass, 0, 1.04, 0, 0.075, 0.11, 0.075, 0, COL.white); vmodel("e1_lantern", [[iron, m.metal], [glass, m.glow, true]], { solid: 0.1, e1range: 230 }); }
    { // e1_spost: a 5.3 m black steel string-light post with a finial
      const iron = newAcc(); boxA(iron, 0, 0.12, 0, 0.14, 0.12, 0.14, 0, COL.iron); boxA(iron, 0, 2.7, 0, 0.045, 2.5, 0.045, 0, COL.iron); boxA(iron, 0, 5.22, 0, 0.07, 0.03, 0.07, 0, COL.iron); boxA(iron, 0, 5.3, 0, 0.035, 0.06, 0.035, 0, COL.iron); boxA(iron, 0.1, 5.05, 0, 0.1, 0.012, 0.012, 0, COL.iron);
      vmodel("e1_spost", [[iron, m.metal]], { solid: 0.12, e1range: 1100 }); }
    { // e1_pillar: a plaza entry pillar in cantera with a bronze lantern (1.78 m)
      const st = newAcc(), iron = newAcc(), glass = newAcc(); boxA(st, 0, 0.07, 0, 0.33, 0.07, 0.33, 0, COL.cantera, 0.6); boxA(st, 0, 0.66, 0, 0.26, 0.52, 0.26, 0, COL.limestone, 0.6); boxA(st, 0, 1.23, 0, 0.32, 0.05, 0.32, 0, COL.cantera, 0.6); boxA(st, 0, 1.3, 0, 0.26, 0.025, 0.26, 0, COL.cantera, 0.6);
      boxA(iron, 0, 1.345, 0, 0.12, 0.02, 0.12, 0, COL.bronze); for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) boxA(iron, sx * 0.095, 1.5, sz * 0.095, 0.012, 0.14, 0.012, 0, COL.bronze); boxA(iron, 0, 1.66, 0, 0.14, 0.022, 0.14, 0, COL.bronze); boxA(iron, 0, 1.72, 0, 0.07, 0.04, 0.07, 0, COL.bronze);
      boxA(glass, 0, 1.5, 0, 0.085, 0.13, 0.085, 0, COL.white); vmodel("e1_pillar", [[mergeAcc(st, iron), m.stone], [glass, m.glow, true]], { solid: 0.36, e1range: 330 }); }
    { // e1_tpost: an Old West timber gate post with a hanging lantern (2.2 m)
      const wd = newAcc(), iron = newAcc(), glass = newAcc(); boxA(wd, 0, 1.05, 0, 0.12, 1.05, 0.12, 0, COL.oldtimber, 0.8); boxA(wd, 0, 2.14, 0, 0.15, 0.04, 0.15, 0, COL.oldtimber, 0.8); boxA(wd, 0, 1.95, 0.26, 0.04, 0.04, 0.26, 0, COL.oldtimber, 0.8);
      boxA(iron, 0, 1.8, 0.44, 0.008, 0.12, 0.008, 0, COL.iron); boxA(iron, 0, 1.6, 0.44, 0.08, 0.012, 0.08, 0, COL.iron); boxA(iron, 0, 1.39, 0.44, 0.075, 0.012, 0.075, 0, COL.iron); boxA(glass, 0, 1.5, 0.44, 0.06, 0.1, 0.06, 0, COL.white);
      vmodel("e1_tpost", [[mergeAcc(wd, iron), m.timber], [glass, m.glow, true]], { solid: 0.25, e1range: 330 }); }
    { // e1_opost: an Outpost basalt bollard with a dim LED ring (0.95 m)
      const st = newAcc(), glass = newAcc(); boxA(st, 0, 0.4, 0, 0.14, 0.4, 0.14, 0, COL.basalt, 0.5); boxA(st, 0, 0.92, 0, 0.14, 0.03, 0.14, 0, COL.basalt, 0.5); boxA(glass, 0, 0.84, 0, 0.145, 0.03, 0.145, 0, COL.white);
      vmodel("e1_opost", [[st, m.stone], [glass, m.glow, true]], { solid: 0.18, e1range: 260 }); }
    // the palms this module plants are their own kind (the same model and materials) with a shorter draw range, 440 m instead of
    // 700 m (400 m), and their LOD from 42 m (aliasLod): on the high tier the near palm is 20,000 triangles, the biggest single cost
    for (const k of ["fanpalm", "fanpalm2", "datepalm", "canarypalm"]) if (has(k)) { const a = "e1_" + k; MODELS[a] = Object.assign({}, MODELS[k]); MODEL_SPECS[a] = Object.assign({}, MODEL_SPECS[k], { e1: true, e1range: 400 }); ALIAS[k] = a; }
    // the draw range of this module's kinds (the engine's rangeFor, by height, for everything else)
    if (typeof rangeFor === "function" && !rangeFor.e1) { const orig = rangeFor; rangeFor = function (kind) { const sp = MODEL_SPECS[kind]; if (sp && sp.e1range) return sp.e1range; return orig(kind); }; rangeFor.e1 = true; } }
  const ALIAS = {};
  function mergeAcc(a, b) { const o = a.p.length / 3; a.p.push(...b.p); a.n.push(...b.n); a.u.push(...b.u); a.c.push(...b.c); for (const i of b.i) a.i.push(i + o); return a; }

  // ───────────────────────── placing things ─────────────────────────
  // a model at (x, z) facing yaw, marked keep (the tidy pass leaves it), in the occupancy grid; returns its PLACE entry
  function place(kind, x, z, yaw, sc, occR, tag) { kind = ALIAS[kind] || kind; put(kind, x, z, yaw, sc); const e = PLACE[kind][PLACE[kind].length - 1]; e.keep = true; e.e1 = true; E.mine.add(e); occAdd(x, z, occR === undefined ? Math.max(0.3, MODELS[kind].radius * sc * 0.62) : occR, tag || "plant"); cnt("k:" + kind); return e; }
  const PALMS = () => ["fanpalm2", "datepalm", "canarypalm"].filter(has).concat(has("fanpalm2") || has("datepalm") || has("canarypalm") ? [] : ["fanpalm"]);
  function treeKind(t) { if (t === "palm") { const p = PALMS(); return p.length ? pick(p) : null; } return has(t) ? t : null; }
  const treeScale = (k) => (/palm/.test(k) ? 0.92 + rand() * 0.2 : k === "mesquite" ? 1.15 + rand() * 0.25 : 1.0 + rand() * 0.22);
  // plants for the beds, by planting palette (a kind listed twice is twice as likely); new models join as soon as they exist
  const PAL = {
    xeric: [["barrel_cactus", 0.9, 1.3], ["barrel_cactus", 0.9, 1.3], ["prickly_pear", 0.8, 1.2], ["prickly_pear", 0.8, 1.2], ["agave_cluster", 0.75, 1.05], ["yucca_cluster", 0.6, 0.85], ["saguaro_young", 0.8, 1.2], ["saguaro", 0.3, 0.46], ["ocotillo", 0.5, 0.7], ["bush2", 0.55, 0.8], ["bush2", 0.55, 0.8], ["cholla", 0.7, 1.0], ["organ_pipe", 0.6, 0.9]],
    bloom: [["bush1", 0.7, 1.0], ["bush1", 0.7, 1.0], ["bush2", 0.7, 1.0], ["bush2", 0.7, 1.0], ["bush2", 0.7, 1.0], ["desertwillow", 0.38, 0.48], ["agave_cluster", 0.7, 0.95]],
    outpost: [["ocotillo", 0.55, 0.8], ["ocotillo", 0.55, 0.8], ["saguaro", 0.32, 0.5], ["agave_cluster", 0.7, 1.0], ["yucca_cluster", 0.6, 0.85], ["organ_pipe", 0.7, 1.0], ["cholla", 0.7, 1.0], ["barrel_cactus", 0.9, 1.3]],
    ow: [["prickly_pear", 0.8, 1.2], ["agave_cluster", 0.75, 1.0], ["bush2", 0.6, 0.9], ["bush2", 0.6, 0.9], ["ocotillo", 0.5, 0.7], ["saguaro", 0.3, 0.45], ["barrel_cactus", 0.9, 1.2]],
    low: [["agave_cluster", 0.6, 0.8], ["bush2", 0.45, 0.6], ["barrel_cactus", 0.8, 1.1]],
  };
  // (the Poly Haven shrub and succulent scans stay out of the beds: 6,800 to 22,000 triangles for a 0.2 to 1.7 m plant, and
  // hundreds are planted; the Poly Haven planters are used beside the benches)
  function palette(name) { return (PAL[name] || PAL.xeric).filter((q) => has(q[0])); }
  function plantAt(pal, x, z, maxH) { for (let tries = 0; tries < 4; tries++) { const q = pick(pal); if (!q) return null; const sc = q[1] + rand() * (q[2] - q[1]); const h = MODELS[q[0]].height * sc; if (maxH && h > maxH) continue; if (!airOK(x, z, h)) continue; const r = Math.max(0.35, MODELS[q[0]].radius * sc * 0.55); if (occHit(x, z, r)) return null; return place(q[0], x, z, rand() * 6.283, sc, r, "plant"); } return null; }

  // ───────────────────────── beds along a walk or a verge ─────────────────────────
  // a planted bed of the band o1..o2 on side sd of a polyline; samples every metre; beds of minLen..maxLen with gaps between
  function bandOK(s, sd, o1, o2, own) { for (const o of [o1 + 0.3, (o1 + o2) / 2, o2 - 0.2]) { const [x, z] = offP(s, o * sd);
      if (!inTerrain(x, z) || planZone(x, z) !== "land") return false; if (planNearRoad(x, z, 0.25, own)) return false; if (own && ownEdge(x, z, own) < 0.1) return false; if (inPlaza(x, z, 0.8)) return false; if (bigColHit(x, z, 0.4, 1.2)) return false; if (solidHit(x, z, 0.2, 0.45)) return false;
      if (doorHit(x, z, 0.2) || approachHit(x, z, 0.2)) return false; if (planPolyBlocked(x, z)) return false; if (fountHit(x, z, 0.3)) return false; if (distToRunway(x, z) < 96) return false; if (occHit(x, z, 0.25, "bench")) return false; if (keepHit(x, z, 0.3)) return false; if (inTrench(x, z)) return false; }
    return true; }
  function layBeds(o) { // { pts, own, sd, o1, o2, pals: [names], minLen, maxLen, gap, step, tag, edge (bed touches the walk edge), maxH }
    const S = samples(o.pts, 1.0); if (S.length < 4) return 0; const ok = S.map((s) => bandOK(s, o.sd, o.o1, o.o2, o.own)); let made = 0, i = 0, pi = Math.floor(rand() * 2);
    while (i < S.length) { if (!ok[i]) { i++; continue; } let j = i; while (j + 1 < S.length && ok[j + 1]) j++;   // run i..j
      let a = i + 1; while (a < j - 1) { const len = Math.round(o.minLen + rand() * (o.maxLen - o.minLen)); let b = Math.min(j - 1, a + len); if (b - a < Math.max(3, o.minLen * 0.5)) break;
        const seg = S.slice(a, b + 1); const pal = palette(o.pals[pi++ % o.pals.length]); const bed = { seg, sd: o.sd, o1: o.o1, o2: o.o2, pal: o.pals[(pi - 1) % o.pals.length], edge: !!o.edge, own: o.own, id: o.id }; E.beds.push(bed); made++; cnt("beds");
        // plants: two staggered rows, about one every o.step metres
        const bw = o.o2 - o.o1; const n = Math.max(1, Math.round((b - a) / o.step));
        for (let k = 0; k < n; k++) { const f = (k + 0.5) / n; const si = Math.min(seg.length - 1, Math.round(f * (seg.length - 1))); const s = seg[si]; const lat = o.o1 + bw * (k % 2 ? 0.34 : 0.68) + (rand() - 0.5) * 0.25 * bw; const [x, z] = offP(s, lat * o.sd); if (pal.length) plantAt(pal, x, z, o.maxH); }
        // keep the scatter and the other modules out of the bed until DEFER (a zero-lift ribbon; removed again in DEFER)
        const mid = seg.filter((q, qi) => qi % 3 === 0 || qi === seg.length - 1).map((s) => offP(s, (o.o1 + o.o2) / 2 * o.sd)); if (mid.length >= 2) E.bedRoads.push({ pts: mid, w: bw, lift: 0, dirt: false, e1bed: true });
        a = b + Math.round(o.gap + rand() * o.gap * 0.5); }
      i = j + 1; }
    return made; }
  function flushBedRoads() { for (const r of E.bedRoads) if (!r.pushed) { ROADS.push(r); r.pushed = true; } }

  // ───────────────────────── promenades ─────────────────────────
  const PROM = {
    hl1_club_walk: { beds: false, lights: false, benches: "median", lanterns: false }, hl3_main_street: { beds: false, lights: false, benches: false, lanterns: false }, hl4_sculpture_ave: { lights: false, pals: ["xeric", "xeric"] },
    hl5_launch_walk: { style: "out", lights: false, lanterns: false, pals: ["outpost"] }, orbit_walk: { style: "out", lights: false, lanterns: false, pals: ["outpost"], benchStep: 60 }, crater_walk: { style: "out", lights: false, lanterns: false, pals: ["outpost"] },
    observatory_spur: { style: "out", lights: false, lanterns: false, beds: false, benches: false }, wash_walk: { beds: false, lights: false, lanterns: false }, apron_walk: { lights: false, pals: ["low"], maxH: 1.3 },
    sun_tunnels_spur: { beds: false, lights: false, benches: false, lanterns: false }, garden_bay_walk: { lights: false, benches: false }, sun_gate_walk: { lights: false }, night_walk: { lights: false },
    corral_walk: { style: "ow", pals: ["ow"] }, east_range_walk: { style: "ow", pals: ["ow"] }, flightline_prom: { postH: 6.3, inside: true }, heritage_strip_p: { inside: true }, link_south: { maxH: 3 },
    museum_walk: { skip: true },
  };
  function promList() { const P = window.PLAN; const out = [];
    for (const pr of P.promenades || []) { if (/^gp_/.test(pr.id) || planSkip(pr.id)) continue; const cfg = PROM[pr.id] || {}; if (cfg.skip) continue; const recs = ROADS.filter((r) => r.plan === pr.id); if (!recs.length) continue;
      const main = recs.reduce((a, b) => (b.w > a.w ? b : a)); const mid = pr.pts[Math.floor(pr.pts.length / 2)]; const did = distOf(mid[0], mid[1]);
      const style = cfg.style || (OW.has(did) ? "ow" : DARK.has(did) ? "out" : "lux"); out.push({ pr, cfg, recs, own: new Set(recs), main, w: main.w, style, pts: pr.id === "hl3_main_street" && window.PLAN_MAIN_PTS ? window.PLAN_MAIN_PTS : main.pts }); }
    return out; }
  function faceIn(s, sd) { return Math.atan2(s.uz * sd, -s.ux * sd); }   // yaw whose front (+z) points from side sd back to the centre line
  function benchAt(x, z, yaw, onWalk) { const k = has("bench_lux") ? "bench_lux" : "e1_bench"; const e = place(k, x, z, yaw, 1, 1.05, "bench"); E.seats.push({ e, yaw, onWalk: !!onWalk, k }); cnt("benches"); return e; }
  function planterAt(x, z, onWalk) { const kinds = (has("planter_lux") ? ["planter_lux"] : ["ph_planter_1", "ph_planter_2", "ph_planter_3"].filter(has).slice(0, 1));   /* one kind: every kind is two more draws */ if (kinds.length) { const e = place(pick(kinds), x, z, rand() * 6.283, 1, 0.7, "bench"); if (onWalk) E.raise.push({ e, walk: true }); cnt("planters"); return e; }
    const e = place("e1_planter", x, z, rand() * 1.5708, 1, 0.7, "bench"); if (onWalk) E.raise.push({ e, walk: true }); cnt("planters");
    const pk = pick(["agave_cluster", "bush1", "bush2", "agave_cluster"].filter(has)); if (pk) { const sc = pk === "agave_cluster" ? 0.62 : 0.5; put(pk, x, z, rand() * 6.283, sc); const pe = PLACE[pk][PLACE[pk].length - 1]; pe.keep = true; pe.e1 = true; E.raise.push({ e: pe, dy: 0.66, walk: !!onWalk }); } return e; }
  function lanternAt(x, z, onWalk) { const e = place("e1_lantern", x, z, rand() * 6.283, 1, 0.35, "lamp"); E.lanterns.push({ e, walk: !!onWalk }); if (onWalk) E.raise.push({ e, walk: true }); cnt("lanterns"); return e; }
  function promenade(q) { const { pr, cfg, own, w, style, pts } = q; const L = plen(pts); const dark = style === "out"; const inside = cfg.inside || w >= 14;
    // benches with a planter beside them, alternating sides
    if (cfg.benches !== false) {
      if (cfg.benches === "median") { const mp = planTrim(pts, 34, L - 32); for (const s of samples(mp, 24, 14, plen(mp) - 6)) for (const sd of [-1, 1]) { const [x, z] = offP(s, 2.7 * sd); if (!spotOK(x, z, 1.0, own, { inside: true, door: true, edgeR: 0.4 })) continue; benchAt(x, z, Math.atan2(-s.uz * sd, s.ux * sd), true); } }
      else { const st = cfg.benchStep || 38; for (const sd of [-1, 1]) for (const s of samples(pts, st, sd > 0 ? 14 : 14 + st / 2, L - 10)) { const o = inside ? w / 2 - 0.85 : w / 2 + 0.7; let done = false;
          for (const dd of [0, 2.5, -2.5, 5, -5]) { if (done) break; const s2 = { x: s.x + s.ux * dd, z: s.z + s.uz * dd, ux: s.ux, uz: s.uz }; const [x, z] = offP(s2, o * sd); if (!spotOK(x, z, 1.0, own, { inside, road: 0.1, edgeR: 0.4 })) continue;
            benchAt(x, z, faceIn(s2, sd), inside); done = true; const [px, pz] = offP({ x: s2.x + s2.ux * 1.75, z: s2.z + s2.uz * 1.75, ux: s2.ux, uz: s2.uz }, o * sd); if (spotOK(px, pz, 0.6, own, { inside, road: 0.1 })) planterAt(px, pz, inside);
            if (!dark && cfg.lanterns !== false) { const [lx, lz] = offP({ x: s2.x - s2.ux * 1.6, z: s2.z - s2.uz * 1.6, ux: s2.ux, uz: s2.uz }, o * sd); if (!occNear(lx, lz, 5, "lamp") && spotOK(lx, lz, 0.25, own, { inside, road: 0.1 })) lanternAt(lx, lz, inside); } } } } }
    // pathway lanterns between the lamps
    if (!dark && cfg.lanterns !== false) for (const sd of [-1, 1]) for (const s of samples(pts, 24, sd > 0 ? 8 : 20, L - 6)) { const o = inside ? w / 2 - 0.4 : w / 2 + 0.38; const [x, z] = offP(s, o * sd); if (occNear(x, z, 6, "lamp")) continue; if (!spotOK(x, z, 0.22, own, { inside, road: 0.05 })) continue; lanternAt(x, z, inside); }
    // string lights on posts over the walk (posts in pairs across the walk every 16 m; the strings are hung in DEFER)
    if (!dark && cfg.lights !== false && w >= 6 && w <= 24) { const o = inside ? w / 2 - 0.45 : w / 2 + 0.5; const H = cfg.postH || 5.3; const rows = [];
      for (const s of samples(pts, 16, 6, L - 6)) { const row = {}; for (const sd of [-1, 1]) { for (const dd of [0, 1.2, -1.2, 2.4, -2.4]) { const s2 = { x: s.x + s.ux * dd, z: s.z + s.uz * dd, ux: s.ux, uz: s.uz }; const [x, z] = offP(s2, o * sd); if (!spotOK(x, z, 0.25, own, { inside, road: 0.08 })) continue; if (bigColHit(x, z, 0.6, 1.0)) continue;
            const e = place("e1_spost", x, z, faceIn(s2, sd), H / 5.3, 0.3, "lamp"); if (inside) E.raise.push({ e, walk: true }); row[sd] = e; break; } } rows.push(row); }
      E.strings.push({ id: pr.id, rows, H }); cnt("stringRows", rows.length); }
    // planted beds with stone kerbs along both edges (the inner kerb is the walk's edge kerb)
    if (cfg.beds !== false && pr.id !== "hl3_main_street") { const pals = cfg.pals || (style === "ow" ? ["ow"] : style === "out" ? ["outpost"] : ["xeric", "bloom"]);
      for (const sd of [-1, 1]) layBeds({ pts, own, sd, o1: w / 2 + 0.16, o2: w / 2 + (w >= 14 ? 2.8 : 2.5), pals, minLen: 6, maxLen: 11, gap: 4.5, step: 4.3, edge: true, maxH: cfg.maxH, id: pr.id }); }
    flushBedRoads(); }

  // ───────────────────────── main roads: tree allees in planted verges ─────────────────────────
  const ROAD = {
    landing_blvd: { t: ["palm"], st: 20 }, arrivals_curb: { t: ["palm"], st: 20 }, flightline_rd: { t: ["palm"], st: 15 }, commons_rd: { t: ["palm", "palm", "paloverde"], st: 20 }, commons_rd_n: { t: ["palm", "palm", "paloverde"], st: 20 },
    night_field_rd: { t: ["palm", "paloverde", "paloverde"], st: 22 }, old_track: { t: ["paloverde", "desertwillow", "paloverde", "ironwood"], st: 20, ends: "palm" }, corral_rd: { t: ["mesquite"], st: 18, pals: ["ow"] }, ridge_rd: { t: ["paloverde", "desertwillow"], st: 20, ends: "palm" },
    hangar_rd: { t: ["palm", "paloverde"], st: 26 }, golf_rd: { t: ["paloverde", "palm", "paloverde"], st: 22 }, stage_rd: { t: ["mesquite"], st: 22, pals: ["ow"] }, founders_ln: { t: ["paloverde"], st: 22 }, club_loop: { t: ["paloverde", "ironwood"], st: 20 }, club_lane: { t: ["paloverde", "ironwood"], st: 20 }, motor_rd: { t: ["paloverde"], st: 24 }, lodge_lane: { t: ["paloverde"], st: 24, beds: false },
  };
  function roadVerge(r, cfg) { const recs = ROADS.filter((q) => q.plan === r.id); if (!recs.length) return; const own = new Set(recs); const w = r.width; const pts = r.pts; const L = plen(pts); const off = w / 2 + 3.2; let n = 0;
    for (const s of samples(pts, cfg.st, cfg.st / 2, L - 4)) for (const sd of [-1, 1]) { const [x, z] = offP(s, off * sd); if (DARK.has(distOf(x, z))) continue; const nearEnd = s.d < 30 || s.d > L - 30; let k = treeKind(nearEnd && cfg.ends ? cfg.ends : cfg.t[Math.floor(s.d / cfg.st) % cfg.t.length]); if (!k) continue;
      let sc = treeScale(k); if (!airOK(x, z, MODELS[k].height * sc)) { if (/palm/.test(k)) { k = has("paloverde") ? "paloverde" : null; if (!k) continue; sc = treeScale(k); } if (!airOK(x, z, MODELS[k].height * sc)) continue; }
      if (!spotOK(x, z, 1.1, own, { road: 0.6 })) continue; if (occNear(x, z, 3.0, "tree")) continue; place(k, x, z, rand() * 6.283, sc, 0.9, "tree").e1own = true; n++; }
    cnt("roadTrees", n);
    if (cfg.beds !== false) { const pals = cfg.pals || ["xeric", "bloom"]; for (const sd of [-1, 1]) layBeds({ pts, own, sd, o1: w / 2 + 2.0, o2: w / 2 + 4.5, pals, minLen: 8, maxLen: 14, gap: 9, step: 5.0, edge: false, id: r.id }); }
    flushBedRoads(); }

  // ───────────────────────── plazas: kerb, low fence on posts, entry pillars, lamps and trees ─────────────────────────
  function plazaStyle(z) { if (z.style) return z.style; if (z.id === "pz_commons") return "island"; const d = distOf(z.x, z.z); if (OW.has(d) || ["pz_four", "pz_gate", "pz_ranch", "pz_corral"].includes(z.id)) return "ow"; if (["S3_OUTPOST", "S3_NIGHT", "S3_NORTHYARD"].includes(d) || ["pz_ogate", "pz_launch", "pz_ring", "pz_night"].includes(z.id)) return "out"; return "lux"; }
  // the ring at radius R, one sample per ~0.8 m: "gap" (a ribbon or a door lane crosses), "blk" (a building, set piece, solid, fountain or trench), "ok"
  function ringScan(z, R) { const n = Math.max(24, Math.round(6.2832 * R / 0.8)); const out = [];
    for (let i = 0; i < n; i++) { const a = i / n * 6.2832; const x = z.x + Math.cos(a) * R, zz = z.z + Math.sin(a) * R; let st = "ok";
      if (planNearRoad(x, zz, 0.9)) st = "gap"; else if (doorHit(x, zz, -0.4) || approachHit(x, zz, 0)) st = "gap"; else if (bigColHit(x, zz, 0.5, 0.9) || solidHit(x, zz, 0.35, 0.2) || fountHit(x, zz, -1.0) || inTrench(x, zz) || keepHit(x, zz, 0.1) || !inTerrain(x, zz)) st = "blk";
      out.push({ a, x, z: zz, st }); }
    return out; }
  // runs of equal state round the ring (wrapping)
  function ringRuns(S) { const n = S.length; let s0 = S.findIndex((q, i) => q.st !== S[(i - 1 + n) % n].st); if (s0 < 0) return [{ st: S[0].st, i0: 0, len: n, full: true }]; const runs = []; let i = s0;
    do { const st = S[i].st; let len = 0; while (len < n && S[(i + len) % n].st === st) len++; runs.push({ st, i0: i, len }); i = (i + len) % n; } while (i !== s0); return runs; }
  function plazaBorder(z) { const style = plazaStyle(z); const R = z.r - 0.3; const S = ringScan(z, R); const n = S.length; const runs = ringRuns(S); const arc = 6.2832 * R / n;
    const rec = { id: z.id, style, R, S, runs, rails: [], kerbs: [], x: z.x, z: z.z }; E.plazas.push(rec); const at = (i) => S[((i % n) + n) % n];
    const tangentYaw = (a) => Math.atan2(-Math.sin(a), Math.cos(a));
    // kerb on every run that is not a ribbon; the rail on the ok runs, trimmed at both ends, with garden openings
    for (const r of runs) { if (r.st === "gap") continue; if (r.st === "ok") rec.kerbs.push([r.i0, r.len]); else continue;
      const trim = Math.ceil(1.1 / arc); const len = r.len - 2 * trim; if (style === "island" || style === "out" || len * arc < 3.5) continue; const segs = []; const open = z.id === "pz_compass" ? 34 : 24; let k = 0;
      while (k < len) { const m = Math.min(len - k, Math.round(open / arc)); if (m * arc >= 2.4) segs.push([r.i0 + trim + k, m]); k += m + Math.round(2.4 / arc); }
      for (const sg of segs) rec.rails.push(sg); }
    // entry pillars (or posts) either side of every ribbon gap wider than 2 m, lamps round the ring, trees framing the entries
    const pk = style === "ow" ? "e1_tpost" : style === "out" ? "e1_opost" : "e1_pillar";
    for (const r of runs) { if (r.st !== "gap" || r.full) continue; const wgap = r.len * arc; if (wgap < 2.0) continue;
      for (const [ia, dir] of [[r.i0 - 1, -1], [r.i0 + r.len, 1]]) { const q = at(ia); if (q.st !== "ok") continue; const a = q.a + dir * (0.3 / R); const x = z.x + Math.cos(a) * R, zz = z.z + Math.sin(a) * R; if (planNearRoad(x, zz, 0.35) || occHit(x, zz, 0.35)) continue; place(pk, x, zz, tangentYaw(a), 1, 0.4, "lamp"); cnt("entryPillars");
        // a tree outside the kerb at each side of the entry
        if (style !== "island" && wgap >= 3.0) { const a2 = q.a + dir * (2.2 / R); const R2 = R + 3.4; const tx = z.x + Math.cos(a2) * R2, tz = z.z + Math.sin(a2) * R2; let tk = style === "ow" ? treeKind("mesquite") : style === "out" ? (has("saguaro_mid") ? "saguaro_mid" : treeKind("saguaro")) : treeKind("palm");
          if (tk) { let sc = style === "out" && tk === "saguaro" ? 0.75 + rand() * 0.2 : treeScale(tk); if (!airOK(tx, tz, MODELS[tk].height * sc) && /palm/.test(tk)) { tk = treeKind("paloverde"); sc = tk ? treeScale(tk) : 1; } if (tk && airOK(tx, tz, MODELS[tk].height * sc) && !blocksView(tx, tz) && spotOK(tx, tz, 1.0, null, { road: 0.8, plaza: true }) && !occNear(tx, tz, 3, "tree")) { place(tk, tx, tz, rand() * 6.283, sc, 0.9, "tree"); cnt("entryTrees"); } } } } }
    // lamps round the ring on the long kerb runs (a lamp every 18 m, not within 9 m of another lamp); none on the dark-sky side
    if (style !== "out" && style !== "island") { const lk = has("lux_lamp") && style === "lux" ? "lux_lamp" : "lamp"; const every = z.id === "pz_compass" ? 15 : 18;
      for (const [i0, len] of rec.kerbs) { const m = Math.floor(len * arc / every); for (let k = 0; k < m; k++) { const i = i0 + Math.round((k + 0.5) * len / m); const q = at(i); const x = z.x + Math.cos(q.a) * (R + 1.7), zz = z.z + Math.sin(q.a) * (R + 1.7); if (occNear(x, zz, 9, "lamp")) continue; if (!spotOK(x, zz, 0.35, null, { road: 0.3, plaza: true })) continue;
          const e = place(lk, x, zz, Math.atan2(z.x - x, z.z - zz), 1, 0.4, "lamp"); cnt("plazaLamps"); } } }
    // Compass Plaza: a ring of palms outside the border, off the entries and the view down Sculpture Avenue to the Ring
    if (z.id === "pz_compass") { const m = Math.round(6.2832 * (R + 6) / 15); for (let k = 0; k < m; k++) { const a = k / m * 6.2832 + 0.13; const x = z.x + Math.cos(a) * (R + 6), zz = z.z + Math.sin(a) * (R + 6); const ia = Math.round(a / 6.2832 * n); let nearGap = false; for (let d = -8; d <= 8; d++) if (at(ia + d).st === "gap") nearGap = true; if (nearGap || blocksView(x, zz)) continue;
        const tk = treeKind("palm"); if (!tk) continue; const sc = treeScale(tk); if (!airOK(x, zz, MODELS[tk].height * sc)) continue; if (!spotOK(x, zz, 1.0, null, { road: 1.0, plaza: true }) || occNear(x, zz, 4, "tree")) continue; place(tk, x, zz, rand() * 6.283, sc, 0.9, "tree"); cnt("compassPalms"); } }
    // Outpost style: LED basalt bollards along the kerb runs, every 3 m
    if (style === "out") for (const [i0, len] of rec.kerbs) { const st = Math.max(1, Math.round(3 / arc)); for (let k = Math.round(st / 2); k < len - 1; k += st) { const q = at(i0 + k); if (occHit(q.x, q.z, 0.3)) continue; place("e1_opost", q.x, q.z, 0, 1, 0.3, "lamp"); cnt("plazaBollards"); } } }

  // ───────────────────────── roundabout islands: a stone kerb ring at the inner edge of the ring road and a planted ring ─────────────────────────
  function islands() { E.islands = []; for (const [pid, rid] of [["pz_commons", "commons_circle"], ["arcade_bay", "arcade_bay_ring"]]) { const q = PLAN_IDX.plaza.get(pid) || planPlace(pid); const r = PLAN_IDX.road.get(rid); if (!q || !r || planSkip(rid)) continue;
      let dmin = 1e9; for (let i = 0; i < r.pts.length - 1; i++) { const a = r.pts[i], b = r.pts[i + 1]; const vx = b[0] - a[0], vz = b[1] - a[1]; const L2 = vx * vx + vz * vz || 1; const t = clamp(((q.x - a[0]) * vx + (q.z - a[1]) * vz) / L2, 0, 1); dmin = Math.min(dmin, Math.hypot(q.x - a[0] - vx * t, q.z - a[1] - vz * t)); }
      const R = dmin - r.width / 2 - 0.3; if (R < 3) continue; E.islands.push({ id: pid, x: q.x, z: q.z, R }); const pal = palette("bloom"); const n = Math.round(6.2832 * (R - 0.9) / 2.6);
      for (let k = 0; k < n; k++) { const a = k / n * 6.2832; const x = q.x + Math.cos(a) * (R - 0.9), z = q.z + Math.sin(a) * (R - 0.9); if (planNearCollider(x, z, 0.4) || solidHit(x, z, 0.3) || fountHit(x, z, -1.2) || keepHit(x, z, 0)) continue; plantAt(pal, x, z, 1.8); } cnt("islands"); } }
  // ───────────────────────── the runway fence: lines, gates and the planting behind it ─────────────────────────
  function fenceLines() { const P = window.PLAN; const lines = [];
    for (const k of ["41001005F", "41001005G", "41001005H"]) { const p = P.parcels && P.parcels[k]; if (!p) continue; const r = p.ring;
      for (let i = 0; i < r.length - 1; i++) { const a = rwTS(r[i][0], r[i][1]), b = rwTS(r[i + 1][0], r[i + 1][1]); if (Math.abs(a[1]) < 115 && Math.abs(b[1]) < 115 && Math.abs(a[1] - b[1]) < 6 && Math.abs(a[0] - b[0]) > 200) {
          const L = Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]); const ux = (r[i + 1][0] - r[i][0]) / L, uz = (r[i + 1][1] - r[i][1]) / L; lines.push({ k, a: r[i], b: r[i + 1], L, ux, uz }); continue; }
        // the airside edge where one of our taxilanes leaves the parcel for the City apron (the TTF-3 gate of the Flight Line)
        const A = r[i], B = r[i + 1]; const L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 40 || Math.min(Math.abs(a[1]), Math.abs(b[1])) > 260) continue; let taxi = false;
        for (const q of P.roads || []) { if (q.class !== "taxilane" || q.ownership !== "ours" || !q.pts) continue; for (let j = 0; j < q.pts.length - 1; j++) { const p0 = q.pts[j], p1 = q.pts[j + 1]; const d0 = (p0[0] - A[0]) * (B[1] - A[1]) - (p0[1] - A[1]) * (B[0] - A[0]), d1 = (p1[0] - A[0]) * (B[1] - A[1]) - (p1[1] - A[1]) * (B[0] - A[0]); const e0 = (A[0] - p0[0]) * (p1[1] - p0[1]) - (A[1] - p0[1]) * (p1[0] - p0[0]), e1 = (B[0] - p0[0]) * (p1[1] - p0[1]) - (B[1] - p0[1]) * (p1[0] - p0[0]); if (d0 * d1 < 0 && e0 * e1 < 0) taxi = true; } }
        if (taxi) lines.push({ k: k + "_apron", a: A, b: B, L, ux: (B[0] - A[0]) / L, uz: (B[1] - A[1]) / L }); } }
    // the inside of every line is our parcel
    const ours = (x, z) => { const zn = planZone(x, z); return zn === "land" || zn === "wash"; };
    for (const ln of lines) { const nx = -ln.uz, nz = ln.ux; let v = 0; for (let k = 1; k <= 9; k++) { const x = ln.a[0] + ln.ux * ln.L * k / 10, z = ln.a[1] + ln.uz * ln.L * k / 10; v += (ours(x + nx * 6, z + nz * 6) ? 1 : 0) - (ours(x - nx * 6, z - nz * 6) ? 1 : 0); } ln.sgn = v >= 0 ? 1 : -1; ln.nrm = [nx * ln.sgn, nz * ln.sgn]; }
    return lines; }
  // along a line every 0.5 m: "road" where a ribbon crosses (a gate), "obj" where a set piece stands on the line, "ok"
  function fenceScan(ln) { const st = 0.5, n = Math.floor(ln.L / st); const S = []; const cross = PLAN_IDX.road.get("the_crossing");
    for (let i = 0; i <= n; i++) { const d = i * st; const x = ln.a[0] + ln.ux * d, z = ln.a[1] + ln.uz * d; let s = "ok"; let rid = null;
      if (planNearRoad(x, z, 1.6)) { s = "road"; } else if (bigColHit(x, z, 0.35, 0.3) || solidHit(x, z, 0.3, 0.2) || !inTerrain(x, z) || inTrench(x, z)) s = "obj";
      S.push({ d, x, z, s }); }
    // where The Crossing runs under the line (its covered box): mark it for the gate pillars
    let xc = null; if (cross && cross.pts) for (let i = 0; i < cross.pts.length - 1; i++) { const p = cross.pts[i], q = cross.pts[i + 1]; const d1 = (p[0] - ln.a[0]) * -ln.uz + (p[1] - ln.a[1]) * ln.ux, d2 = (q[0] - ln.a[0]) * -ln.uz + (q[1] - ln.a[1]) * ln.ux; if (d1 * d2 < 0) { const t = d1 / (d1 - d2); const x = p[0] + (q[0] - p[0]) * t, z = p[1] + (q[1] - p[1]) * t; const along = (x - ln.a[0]) * ln.ux + (z - ln.a[1]) * ln.uz; if (along > 0 && along < ln.L) xc = { along, hw: (cross.width || 14) / 2 }; } }
    return { S, xc }; }
  function fencePlanting(ln) { // ln.nrm: the unit normal pointing away from the runway
    const pts = [ln.a, ln.b]; const sd = ln.sgn; // offP(s, o * sd) moves into our parcel
    // taxilane side (a taxilane runs along the fence inside the parcel): only a low strip clear of the wingtips
    const S = samples(pts, 20, 10, ln.L - 10); let taxi = 0; for (const s of S) { const [x, z] = offP(s, 9 * sd); if (planNearRoad(x, z, 0)) taxi++; } ln.taxi = taxi > S.length * 0.3;
    // young palms in the fence bed where the height rule allows them (every ~16 m), then a row of short palms and desert willow
    // (under 7 m) about 30 m behind the fence; not beside a taxilane, where the wingtips need the strip clear
    let np = 0; const s0 = Math.abs(rwTS(ln.a[0], ln.a[1])[1]); if (!ln.taxi) for (const s of samples(pts, 16, 8, ln.L - 8)) { const [x, z] = offP(s, 2.6 * sd); const k = treeKind("palm"); if (!k) break; const maxH = (Math.abs(rwTS(x, z)[1]) - 76) / 7 - 0.4; const sc = Math.min(0.6, maxH / MODELS[k].height); if (sc < 0.24) continue; if (!airOK(x, z, MODELS[k].height * sc)) continue; if (occHit(x, z, 0.6) || planNearRoad(x, z, 0.5) || planNearCollider(x, z, 0.6) || solidHit(x, z, 0.4)) continue; place(k, x, z, rand() * 6.283, sc, 0.7, "tree"); np++; }
    let ns = 0; if (!/_apron$/.test(ln.k)) for (const s of samples(pts, 14, 7, ln.L - 7)) { const [x, z] = offP(s, (131 - s0) * sd); const palm = Math.round(s.d / 14) % 3 === 0; const k = palm ? treeKind("palm") : treeKind(Math.round(s.d / 14) % 3 === 1 ? "desertwillow" : "paloverde"); if (!k) continue; const sc = palm ? Math.min(0.52, 6.6 / MODELS[k].height) : Math.min(0.95, 6.5 / MODELS[k].height) * (0.88 + rand() * 0.12); if (!airOK(x, z, MODELS[k].height * sc)) continue; if (!spotOK(x, z, 1.0, null, { road: 1.2 }) || occNear(x, z, 4, "tree")) continue; place(k, x, z, rand() * 6.283, sc, 0.9, "tree"); ns++; }
    if (ln.taxi) layBeds({ pts, own: null, sd, o1: 0.5, o2: 2.1, pals: ["low"], minLen: 10, maxLen: 18, gap: 3, step: 2.8, maxH: 1.2, id: "fence_" + ln.k });
    else layBeds({ pts, own: null, sd, o1: 0.55, o2: 4.2, pals: ["bloom", "xeric"], minLen: 12, maxLen: 22, gap: 4, step: 4.2, id: "fence_" + ln.k });
    flushBedRoads(); cnt("fenceShortPalms", ns);
    // the tall palm row beyond the height line (150 m and the 7:1 slope for their height), where the land is free
    let nt = 0; for (const off of /_apron$/.test(ln.k) ? [] : [172]) { const d0 = off - s0; for (const s of samples(pts, 33, 16, ln.L - 10)) { const [x, z] = offP(s, d0 * sd); const k = treeKind("palm"); if (!k) break; const sc = treeScale(k); if (!airOK(x, z, MODELS[k].height * sc)) continue; if (!spotOK(x, z, 1.1, null, { road: 1.0 }) || occNear(x, z, 5, "tree")) continue; place(k, x, z, rand() * 6.283, sc, 0.9, "tree").e1own = true; nt++; } }
    cnt("fenceYoungPalms", np); cnt("fenceTallPalms", nt); }

  // ───────────────────────── the world hooks ─────────────────────────
  function late() { if (E.lateDone) return; E.lateDone = true;
    step("index", () => { rwInit(); occBuild(); keepBuild(); doorBuild(); viewsInit(); solidGrid(); approachInit(); });
    step("fencePlanting", () => { E.lines = fenceLines(); for (const ln of E.lines) fencePlanting(ln); });
    step("plazas", () => { for (const z of window.PLAN.plazas || []) { if (/^gp_/.test(z.id) || z.id === "pz_link" || planSkip(z.id)) continue; plazaBorder(z); }
      for (const [id, dr] of [["stratos_field", 1.8], ["field_of_light", 0.9]]) { const q = planPlace(id); if (q && q.r) { plazaBorder({ id: "poi_" + id, x: q.x, z: q.z, r: q.r + dr + 0.3, style: "out" }); cnt("poiRings"); } } });
    step("promenades", () => { E.proms = promList(); for (const q of E.proms) promenade(q); });
    step("islands", islands);
    step("roads", () => { for (const r of window.PLAN.roads || []) { const cfg = ROAD[r.id]; if (!cfg || planSkip(r.id)) continue; roadVerge(r, cfg); } });
    console.log("plan_enrich: " + JSON.stringify(E.n) + " in " + JSON.stringify(E.t)); }
  PLAN_HOOKS.world.push({ name: "enrichWorld", fn: function enrichWorld() { if (!window.PLAN) return; step("models", buildModels);
    // everything else runs as the very last world hook, after every module has placed its set pieces, solids and keep-outs
    PLAN_HOOKS.world.push({ name: "enrichLate", fn: late }); } });

  // ───────────────────────── DEFER: the surfaces, kerbs, fences, tree bases and lights ─────────────────────────
  const walkTop = (x, z) => { const w = walkAt(x, z); return w === null ? null : w; };
  const groundAt = (x, z) => Math.max(getH(x, z), walkTop(x, z) === null ? -1e9 : walkTop(x, z));
  // lift instances that stand on a walk (or in a planter) to the drawn surface: patch the engine's packed matrices
  function reseat() { const byKind = new Map(); for (const r of E.raise) { const k = kindOf(r.e); if (!k) continue; if (!byKind.has(k)) byKind.set(k, []); byKind.get(k).push(r); }
    for (const [k, list] of byKind) { const S = INSTSET.find((q) => q.kind === k); if (!S) continue; const idx = new Map(); S.list.forEach((e, i) => idx.set(e, i));
      for (const r of list) { const i = idx.get(r.e); if (i === undefined) continue; const e = r.e; let y = e[1]; if (r.walk) { const w = walkTop(e[0], e[2]); if (w !== null) y = Math.max(y, w); } y += r.dy || 0; e.seated = true; if (Math.abs(y - e[1]) < 0.002) continue; e[1] = y; S.mats[i * 16 + 13] = y - (MODELS[k].sink || 0); cnt("reseated"); } S.n = -1; } }
  const KIND_OF = new Map(); function kindOf(e) { if (KIND_OF.size === 0) for (const k in PLACE) for (const q of PLACE[k]) if (q.e1) KIND_OF.set(q, k); return KIND_OF.get(e) || null; }
  // seats and backs for the benches (the engine sits you on a solid marked seat, facing sd.face)
  function benchSolids() { for (const b of E.seats) { const e = b.e; e.seated = true; const y = e[1]; const c = Math.cos(b.yaw), s = Math.sin(b.yaw); const L = b.k === "e1_bench" ? 1.8 : Math.min(2.4, MODELS[b.k].sx * 0.9);
      const sd = addSolid(e[0] + s * 0.02, e[2] + c * 0.02, b.yaw, L, 0.46, y + 0.05, y + 0.46, "world"); if (sd) { sd.seat = true; sd.face = b.yaw; } addSolid(e[0] - s * 0.27, e[2] - c * 0.27, b.yaw, L, 0.1, y, y + 0.86, "world"); } }
  // stone kerbs along both edges of every promenade (timber fascias on the boardwalks, basalt on the red gravel), the Club Walk
  // and Sculpture Avenue medians kerbed; nothing where another ribbon joins or inside a plaza
  function promKerbs() { for (const q of E.proms) { for (const rec of q.recs) { const deck = !!(rec.lift >= 0.4 || (q.pr.id === "hl3_main_street" && rec.w <= 4) || /boardwalk/i.test(q.pr.name || "") || ["wash_walk", "corral_walk"].includes(q.pr.id));
        const med = rec.w <= 4.5 && q.pr.id === "hl4_sculpture_ave"; if (q.pr.id === "hl3_main_street" && rec.w > 10) continue;   // the Main Street carriageway meets its boardwalks
        if (deck && typeof planDeckSkirts === "function") continue;   // the client skirts every timber deck ribbon itself (X, round 2)
        const col = deck ? COL.oldtimber : q.style === "out" ? COL.basalt : COL.cantera; const mat = deck ? MT.timber : MT.stone; const hw = rec.w / 2;
        for (const sd of [-1, 1]) { const S = samples(rec.pts, 2.0); let run = [];
          const end = () => { if (run.length >= 2) prismA(wacc(mat, run[0].x, run[0].z, false, 700), run, col, deck ? 1.2 : 0.8); run = []; };
          for (const s of S) { const [ex, ez] = offP(s, hw * sd); const [ox, oz] = offP(s, (hw + 0.45) * sd); const pz = inPlaza(ex, ez, -0.6);
            const zn = inTerrain(ex, ez) ? planZone(ex, ez) : "off"; if (pz || (zn !== "land" && zn !== "wash") || planNearRoad(ox, oz, 0.05, q.own) || inTrench(ox, oz)) { end(); continue; }
            const [ix, iz] = offP(s, (hw - 0.18) * sd); const wt = walkTop(ix, iz); const top = (wt === null ? getH(ex, ez) + rec.lift : wt) + (deck ? 0.012 : med ? 0.1 : 0.055);
            const inner = deck ? hw - 0.02 : med ? hw - 0.1 : hw - 0.07, outer = deck ? hw + 0.05 : med ? hw + 0.08 : hw + 0.15; const c0 = (inner + outer) / 2; const [cx, cz] = offP(s, c0 * sd); const [gx, gz] = offP(s, outer * sd);
            run.push({ x: cx, z: cz, nx: -s.uz * sd, nz: s.ux * sd, hw: (outer - inner) / 2, y0: Math.min(getH(gx, gz), top - 0.15) - 0.1, y1: top, d: s.d }); }
          end(); cnt("kerbRuns"); } }
      // the Club Walk's palm median (planMedianBed lays the bed): a kerb on both sides of it
      if (q.pr.id === "hl1_club_walk") { const L0 = plen(q.pts), pa = planPlace("arrivals_court"), pb = planPlace("crossing_plaza"); const mp = planTrim(q.pts, ((pa && pa.r) || 32) + 1, L0 - ((pb && pb.r) || 30) - 1);
        for (const sd of [-1, 1]) { const run = []; for (const s of samples(mp, 1.5)) { const [cx, cz] = offP(s, 2.0 * sd); const g = groundAt(cx, cz); run.push({ x: cx, z: cz, nx: -s.uz * sd, nz: s.ux * sd, hw: 0.09, y0: g - 0.05, y1: g + 0.1, d: s.d }); } if (run.length >= 2) prismA(wacc(MT.stone, run[0].x, run[0].z, false, 700), run, COL.limestone, 0.8); } } } }
  // the planted beds: a soil or gravel surface a little below the kerb, kerbed on the outside and at both ends
  function bedMeshes() { for (const b of E.beds) { const seg = b.seg; if (seg.length < 2) continue; const col = b.pal === "bloom" ? COL.mulch : b.pal === "outpost" ? COL.redgravel : b.pal === "ow" ? [0.62, 0.5, 0.38] : COL.gravel;
      const kcol = b.pal === "outpost" ? COL.basalt : b.pal === "ow" ? COL.oldtimber : COL.cantera; const kmat = b.pal === "ow" ? MT.timber : MT.stone;
      const a = wacc(MT.bed, seg[0].x, seg[0].z, false); const across = [b.o1, b.o2]; const rows = []; const segS = seg.filter((q, qi) => qi % 2 === 0 || qi === seg.length - 1);
      for (const s of segS) { const row = []; for (let j = 0; j < 2; j++) { const [x, z] = offP(s, across[j] * b.sd); let y = getH(x, z) + 0.1; if (j === 0 && b.edge) { const [ix, iz] = offP(s, (b.o1 - 0.35) * b.sd); const wt = walkTop(ix, iz); if (wt !== null) y = Math.max(y, Math.min(wt - 0.03, getH(x, z) + 0.45)); }   /* on an embankment the walk kerb is the retaining edge */ row.push([x, y, z]); } rows.push(row); }
      for (let k = 0; k < rows.length - 1; k++) for (let j = 0; j < 1; j++) { const p0 = rows[k][j], p1 = rows[k][j + 1], p2 = rows[k + 1][j + 1], p3 = rows[k + 1][j]; quad(a, p0, p3, p2, p1, [p0[0] / 2.2, p0[2] / 2.2, p3[0] / 2.2, p3[2] / 2.2, p2[0] / 2.2, p2[2] / 2.2, p1[0] / 2.2, p1[2] / 2.2], col); }
      // outer kerb, the end kerbs, and (for a verge bed that does not touch a walk) the inner kerb
      const krow = (o, hw) => segS.map((s) => { const [x, z] = offP(s, o * b.sd); const g = getH(x, z); return { x, z, nx: -s.uz * b.sd, nz: s.ux * b.sd, hw, y0: g - 0.12, y1: g + 0.2, d: s.d }; });
      const ka = wacc(kmat, seg[0].x, seg[0].z, false, 600); prismA(ka, krow(b.o2 + 0.08, 0.08), kcol, 0.8); if (!b.edge) prismA(ka, krow(b.o1 - 0.08, 0.08), kcol, 0.8);
      for (const s of [seg[0], seg[seg.length - 1]]) { const rows2 = []; const o0 = b.edge ? b.o1 - 0.16 : b.o1 - 0.16; for (const [o, d] of [[o0, 0], [b.o2 + 0.16, b.o2 + 0.16 - o0]]) { const [x, z] = offP(s, o * b.sd); const g = Math.max(getH(x, z), walkTop(x, z) === null ? -1e9 : walkTop(x, z) - 0.1); rows2.push({ x, z, nx: s.ux, nz: s.uz, hw: 0.08, y0: g - 0.12, y1: g + 0.2, d }); } prismA(ka, rows2, kcol, 0.8); } } }
  // plaza borders: kerb rings, the railing between posts (with solids), Old West post-and-rail
  function plazaMeshes() { for (const p of E.plazas) { const n = p.S.length; const at = (i) => p.S[((i % n) + n) % n]; const R = p.R;
      const kmat = p.style === "ow" ? MT.timber : MT.stone, kcol = p.style === "ow" ? COL.oldtimber : p.style === "out" ? COL.basalt : COL.cantera;
      for (const [i0, len] of p.kerbs) { const rows = []; for (let k = 0; k <= len; k++) { const q = at(i0 + k); const a = q.a; const x = p.x + Math.cos(a) * R, z = p.z + Math.sin(a) * R; const g = getH(x, z); rows.push({ x, z, nx: Math.cos(a), nz: Math.sin(a), hw: p.style === "ow" ? 0.13 : 0.17, y0: g - 0.15, y1: g + (p.style === "ow" ? 0.18 : 0.22), d: a * R }); } if (rows.length >= 2) prismA(wacc(kmat, p.x, p.z, false, 700), rows, kcol, 0.8); cnt("plazaKerbs"); }
      for (const [i0, len] of p.rails) { const pts = []; for (let k = 0; k <= len; k++) { const q = at(i0 + k); const x = p.x + Math.cos(q.a) * (R + 0.02), z = p.z + Math.sin(q.a) * (R + 0.02); pts.push({ x, z, a: q.a, g: getH(x, z) }); }
        const base = p.style === "ow" ? 0 : 0.22; const top = p.style === "ow" ? 1.05 : 0.95 + base;
        if (p.style === "ow") { // timber posts every 2.4 m with two rails
          const wa = wacc(MT.timber, p.x, p.z, true, 600); const arcL = (len) * 6.2832 * R / n; const np = Math.max(1, Math.round(arcL / 2.4)); const posts = [];
          for (let k = 0; k <= np; k++) { const q = pts[Math.round(k / np * (pts.length - 1))]; boxA(wa, q.x, q.g + 0.55, q.z, 0.09, 0.62, 0.09, -q.a, COL.oldtimber, 0.8); posts.push(q); }
          for (const hy of [0.55, 0.95]) { const rows = pts.map((q, k) => ({ x: q.x, z: q.z, nx: Math.cos(q.a), nz: Math.sin(q.a), hw: 0.04, y0: q.g + hy - 0.06, y1: q.g + hy + 0.06, d: k * 6.2832 * R / n })); prismA(wa, rows, COL.oldtimber, 1.2); } }
        else { // the ornamental railing (atlas bottom half) on the kerb, a bronze cap rail, stone posts
          const band = pts.map((q, k) => ({ x: q.x, y0: q.g + base, y1: q.g + top, z: q.z, d: k * 6.2832 * R / n })); bandA(wacc(MT.alpha, p.x, p.z, true, 500), band, 2.4, 0.004, 0.482, COL.white);
          const cap = pts.map((q, k) => ({ x: q.x, z: q.z, nx: Math.cos(q.a), nz: Math.sin(q.a), hw: 0.03, y0: q.g + top - 0.02, y1: q.g + top + 0.035, d: k * 6.2832 * R / n })); prismA(wacc(MT.stone, p.x, p.z, false), cap, COL.bronze, 1);
          const every = p.id === "pz_compass" ? 6 : 7.2; const arcL = len * 6.2832 * R / n; const np = Math.max(1, Math.round(arcL / every)); const sa = wacc(MT.stone, p.x, p.z, true, 600); const big = p.id === "pz_compass" ? 1.15 : 1;
          for (let k = 0; k <= np; k++) { const q = pts[Math.round(k / np * (pts.length - 1))]; boxA(sa, q.x, q.g + 0.58 * big, q.z, 0.19 * big, 0.58 * big, 0.19 * big, -q.a, COL.limestone, 0.6); boxA(sa, q.x, q.g + 1.2 * big, q.z, 0.24 * big, 0.04, 0.24 * big, -q.a, COL.cantera, 0.6); boxA(sa, q.x, q.g + 1.27 * big, q.z, 0.12 * big, 0.035, 0.12 * big, -q.a, COL.cantera, 0.6); } }
        // solids along the rail so nobody walks through it (one per ~2 m chord)
        for (let k = 0; k < pts.length - 1; k += 3) { const q0 = pts[k], q1 = pts[Math.min(pts.length - 1, k + 3)]; const mx = (q0.x + q1.x) / 2, mz = (q0.z + q1.z) / 2; const L = Math.hypot(q1.x - q0.x, q1.z - q0.z); if (L < 0.2) continue; addSolid(mx, mz, Math.atan2(-(q1.z - q0.z), q1.x - q0.x), L + 0.1, 0.3, Math.min(q0.g, q1.g) - 0.1, Math.min(q0.g, q1.g) + top, "world"); cnt("railSolids"); } } } }
  function islandMeshes() { for (const q of E.islands || []) { const R = q.R, m = Math.max(24, Math.round(6.2832 * R / 0.8)); const rows = []; for (let k = 0; k <= m; k++) { const a = k / m * 6.2832; const x = q.x + Math.cos(a) * R, z = q.z + Math.sin(a) * R; const g = groundAt(x, z); rows.push({ x, z, nx: Math.cos(a), nz: Math.sin(a), hw: 0.16, y0: g - 0.15, y1: g + 0.24, d: a * R }); }
      prismA(wacc(MT.stone, q.x, q.z, false), rows, COL.cantera, 0.8); const bed = wacc(MT.bed, q.x, q.z, false);
      for (let k = 0; k < m; k++) { const a0 = k / m * 6.2832, a1 = (k + 1) / m * 6.2832; const P = (a, r) => { const x = q.x + Math.cos(a) * r, z = q.z + Math.sin(a) * r; return [x, groundAt(x, z) + 0.12, z]; }; const p0 = P(a0, R - 1.8), p1 = P(a1, R - 1.8), p2 = P(a1, R - 0.16), p3 = P(a0, R - 0.16); quad(bed, p0, p3, p2, p1, [p0[0] / 2.2, p0[2] / 2.2, p3[0] / 2.2, p3[2] / 2.2, p2[0] / 2.2, p2[2] / 2.2, p1[0] / 2.2, p1[2] / 2.2], COL.mulch); }
      const rin = []; for (let k = 0; k <= m; k++) { const a = k / m * 6.2832; const x = q.x + Math.cos(a) * (R - 1.88), z = q.z + Math.sin(a) * (R - 1.88); const g = groundAt(x, z); rin.push({ x, z, nx: Math.cos(a), nz: Math.sin(a), hw: 0.08, y0: g - 0.1, y1: g + 0.18, d: a * R }); } prismA(wacc(MT.stone, q.x, q.z, false), rin, COL.limestone, 0.8); } }
  // the runway fence: a stone plinth, the steel panels (atlas top half) and stone pillars every ~12 m; wide gate pillars and
  // open sliding leaves where a taxilane passes; larger pillars where The Crossing runs under the line
  function fenceMeshes() { for (const ln of E.lines || []) { const { S, xc } = fenceScan(ln); const nrm = ln.nrm || [-ln.uz, ln.ux]; const ry = Math.atan2(-ln.uz, ln.ux); const n = S.length;
      // runs of ok samples; a run shorter than 3 m next to an object is dropped
      const runs = []; let i = 0; while (i < n) { if (S[i].s !== "ok") { i++; continue; } let j = i; while (j + 1 < n && S[j + 1].s === "ok") j++; if ((j - i) * 0.5 >= 2.5) runs.push([i, j]); i = j + 1; }
      const stone = wacc(MT.stone, ln.a[0], ln.a[1], true, 1600); const pan = wacc(MT.alpha, ln.a[0], ln.a[1], true, 1300); const met = wacc(MT.stone, ln.a[0], ln.a[1], false);
      const pillar = (x, z, big) => { const g = getH(x, z); const s = big ? 0.5 : 0.36; boxA(stone, x, g + 0.1, z, s + 0.07, 0.3, s + 0.07, ry, COL.cantera, 0.6); boxA(stone, x, g + 1.4, z, s, 1.25, s, ry, COL.limestone, 0.6); boxA(stone, x, g + 2.72, z, s + 0.08, 0.07, s + 0.08, ry, COL.cantera, 0.6); boxA(stone, x, g + 2.84, z, s - 0.06, 0.05, s - 0.06, ry, COL.cantera, 0.6);
        addSolid(x, z, ry, 2 * s + 0.1, 2 * s + 0.1, g - 0.2, g + 2.9, "world"); cnt("fencePillars"); };
      const useModel = has("fence_lux") && has("stone_pillar");
      for (const [i0, i1] of runs) { const a0 = S[i0].d + 0.1, a1 = S[i1].d - 0.1; const len = a1 - a0; const nb = Math.max(1, Math.round(len / 12)); const bay = len / nb;
        const bigAt = (d) => (xc && Math.abs(d - xc.along) < xc.hw + 6) || false;
        for (let b = 0; b <= nb; b++) { const d = a0 + b * bay; const x = ln.a[0] + ln.ux * d, z = ln.a[1] + ln.uz * d; const endGate = (b === 0 && i0 > 0 && S[i0 - 1].s === "road") || (b === nb && i1 < n - 1 && S[i1 + 1].s === "road"); if (!useModel) pillar(x, z, endGate || bigAt(d)); else { place("stone_pillar", x, z, ry, 1, 0.5, "lamp"); } }
        for (let b = 0; b < nb; b++) { const p0 = a0 + b * bay + 0.37, p1 = a0 + (b + 1) * bay - 0.37; if (p1 - p0 < 0.5) continue; const rows = [], plinth = []; const m = Math.max(2, Math.ceil((p1 - p0) / 3));
          for (let k = 0; k <= m; k++) { const d = p0 + (p1 - p0) * k / m; const x = ln.a[0] + ln.ux * d, z = ln.a[1] + ln.uz * d; const g = getH(x, z); rows.push({ x, z, y0: g + 0.42, y1: g + 2.66, d: d - p0 }); plinth.push({ x, z, nx: nrm[0], nz: nrm[1], hw: 0.22, y0: g - 0.3, y1: g + 0.45, d }); }
          if (!useModel) { bandA(pan, rows, 3.0, 0.506, 0.996, COL.white); prismA(stone, plinth, COL.cantera, 0.8, false); prismA(met, rows.map((r) => ({ x: r.x, z: r.z, nx: nrm[0], nz: nrm[1], hw: 0.035, y0: r.y1 - 0.08, y1: r.y1 - 0.02, d: r.d })), COL.iron, 1, false); }
          else { const mw = MODELS.fence_lux.sx || 3; const sc = Math.min(1, 2.66 / Math.max(0.5, MODELS.fence_lux.height)); const k = Math.max(1, Math.round((p1 - p0) / (mw * sc))); for (let q = 0; q < k; q++) { const d = p0 + (p1 - p0) * (q + 0.5) / k; place("fence_lux", ln.a[0] + ln.ux * d, ln.a[1] + ln.uz * d, ry, sc, 0.3, "lamp"); } }
          const mx = ln.a[0] + ln.ux * (p0 + p1) / 2, mz = ln.a[1] + ln.uz * (p0 + p1) / 2; const g0 = getH(mx, mz); addSolid(mx, mz, ry, p1 - p0 + 0.9, 0.5, g0 - 0.4, g0 + 2.7, "world"); cnt("fenceBays"); } }
      // gates: where a ribbon crosses (the TTF gates), the two leaves slid open behind the fence
      i = 0; while (i < n) { if (S[i].s !== "road") { i++; continue; } let j = i; while (j + 1 < n && S[j + 1].s === "road") j++; const gw = (j - i) * 0.5; if (gw > 6 && i > 0 && j < n - 1 && S[i - 1].s === "ok" && S[j + 1].s === "ok") {
          const leaf = gw / 2 + 0.3; for (const [dStart, dir] of [[S[i].d - 0.6, -1], [S[j].d + 0.6, 1]]) { const rows = []; const m = Math.max(2, Math.ceil(leaf / 3)); for (let k = 0; k <= m; k++) { const d = dStart + dir * leaf * k / m; const x = ln.a[0] + ln.ux * d + nrm[0] * 0.75, z = ln.a[1] + ln.uz * d + nrm[1] * 0.75; const g = getH(x, z); rows.push({ x, z, y0: g + 0.12, y1: g + 2.5, d: leaf * k / m }); } bandA(pan, rows, 3.0, 0.506, 0.996, COL.white);
            prismA(met, rows.map((r) => ({ x: r.x, z: r.z, nx: nrm[0], nz: nrm[1], hw: 0.03, y0: r.y0 - 0.1, y1: r.y0 + 0.02, d: r.d })), COL.iron, 1); } cnt("fenceGates"); }
        i = j + 1; } } }
  // tree bases: every tree whose base is inside or within 2.2 m of a ribbon or inside a plaza gets a grate, a ring or a timber kerb
  function treeBases() { const trees = []; for (const k in PLACE) { const sp = MODEL_SPECS[k], m = MODELS[k]; if (!sp || !m || !sp.prop || !sp.sway || m.height <= 3.5 || /saguaro|ocotillo|yucca|cactus|cholla|organ|agave|pear|quiver/.test(k)) continue; for (const e of PLACE[k]) trees.push([k, e]); }
    const bedGrid = new Map(); for (const r of E.bedRoads) for (const q of r.pts) { const k = occKey(Math.floor(q[0] / 30), Math.floor(q[1] / 30)); if (!bedGrid.has(k)) bedGrid.set(k, []); bedGrid.get(k).push(r); }
    const inBed = (x, z) => { const list = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = bedGrid.get(occKey(Math.floor(x / 30) + i, Math.floor(z / 30) + j)); if (a) for (const r of a) if (!list.includes(r)) list.push(r); } for (const r of list) { const p = r.pts; for (let i = 0; i < p.length - 1; i++) { const vx = p[i + 1][0] - p[i][0], vz = p[i + 1][1] - p[i][1]; const L2 = vx * vx + vz * vz || 1; const t = clamp(((x - p[i][0]) * vx + (z - p[i][1]) * vz) / L2, 0, 1); if (Math.hypot(x - p[i][0] - vx * t, z - p[i][1] - vz * t) < r.w / 2 + 0.3) return true; } } return false; };
    const done = []; const BR = { fanpalm: 0.78, fanpalm2: 0.78, datepalm: 0.85, canarypalm: 0.95, paloverde: 0.9, ironwood: 0.9, mesquite: 1.05, desertwillow: 0.85 };
    const seg = planSegGrid();
    for (const [k, e] of trees) { const x = e[0], z = e[2]; const zn = planZone(x, z); if (zn !== "land") continue; const d = planDistrictAt(x, z); if (planStageOf(d) === "GP") continue; if (inBed(x, z)) continue;
      // the nearest ribbon: distance from its edge (< 0 inside)
      let best = null; const a = seg.get(Math.floor(x / PGRID.C) * 100003 + Math.floor(z / PGRID.C)); if (a) for (const sgm of a) { const r = sgm[5]; if (r.e1bed) continue; const vx = sgm[2] - sgm[0], vz = sgm[3] - sgm[1]; const L2 = vx * vx + vz * vz || 1; const t = clamp(((x - sgm[0]) * vx + (z - sgm[1]) * vz) / L2, 0, 1); const dd = Math.hypot(x - sgm[0] - vx * t, z - sgm[1] - vz * t) - sgm[4]; if (!best || dd < best.dd) best = { dd, r }; }
      const pz = inPlaza(x, z, -0.8); let mode = null; const lim = e.e1own ? 3.8 : 2.2;
      if (best && best.dd < -0.3) { const r = best.r; const id = r.plan || ""; if (id === "hl1_club_walk" && best.dd < -9.8) continue; if (id === "hl4_sculpture_ave" && r.w <= 4.5) continue; const md = r.dirt || (id === "hl3_main_street") || r.lift >= 0.4 || OW.has(d ? d.id : ""); mode = md ? "box" : "grate"; }
      else if (best && best.dd < lim) mode = OW.has(d ? d.id : "") ? "box" : "ring"; else if (pz) mode = pz[3] ? "grate" : "ring"; if (!mode) continue;
      if (done.some((q) => Math.hypot(q[0] - x, q[1] - z) < 1.9)) continue; done.push([x, z]); const rr = (BR[k.replace(/^e1_/, "")] || 0.85) * Math.sqrt(clamp(e[4], 0.6, 1.6));
      if (mode === "grate") { const y = groundAt(x, z) + 0.014; const h = rr * 1.02; const g = wacc(MT.stone, x, z, false), soil = wacc(MT.bed, x, z, false); quad(soil, [x - h, y - 0.004, z + h], [x + h, y - 0.004, z + h], [x + h, y - 0.004, z - h], [x - h, y - 0.004, z - h], [x / 2, z / 2, (x + 2 * h) / 2, z / 2, (x + 2 * h) / 2, (z - 2 * h) / 2, x / 2, (z - 2 * h) / 2], [0.03, 0.025, 0.02]);
        const IRON = [0.24, 0.215, 0.19], yg = y + 0.006; { const rm = 0.34 * h / 0.8 - 0.01; for (let q = 0; q < 10; q++) { const a0 = q / 10 * 6.2832, a1 = (q + 1) / 10 * 6.2832; quad(soil, [x, y - 0.001, z], [x + Math.cos(a1) * rm, y - 0.001, z + Math.sin(a1) * rm], [x + Math.cos(a0) * rm, y - 0.001, z + Math.sin(a0) * rm], [x, y - 0.001, z], [x / 2.2, z / 2.2, (x + Math.cos(a1) * rm) / 2.2, (z + Math.sin(a1) * rm) / 2.2, (x + Math.cos(a0) * rm) / 2.2, (z + Math.sin(a0) * rm) / 2.2, x / 2.2, z / 2.2], COL.mulch); } }   /* weathered cast iron over dark slots, a mulch disc at the trunk */ const flat = (x0, z0, x1, z1, x2, z2, x3, z3) => quad(g, [x0, yg, z0], [x1, yg, z1], [x2, yg, z2], [x3, yg, z3], [0, 0, 1, 0, 1, 1, 0, 1], IRON);
        flat(x - h, z + h, x + h, z + h, x + h, z + h - 0.1, x - h, z + h - 0.1); flat(x - h, z - h + 0.1, x + h, z - h + 0.1, x + h, z - h, x - h, z - h); flat(x + h - 0.1, z + h, x + h, z + h, x + h, z - h, x + h - 0.1, z - h); flat(x - h, z + h, x - h + 0.1, z + h, x - h + 0.1, z - h, x - h, z - h);
        const ri = 0.34 * h / 0.8; for (let q = 0; q < 16; q++) { const a0 = q / 16 * 6.2832; const c = Math.cos(a0), sn = Math.sin(a0); const ro = Math.min(h / Math.max(Math.abs(c), Math.abs(sn)), h) - 0.06; const tx = -sn * 0.028, tz = c * 0.028; flat(x + c * ri - tx, z + sn * ri - tz, x + c * ri + tx, z + sn * ri + tz, x + c * ro + tx, z + sn * ro + tz, x + c * ro - tx, z + sn * ro - tz); }
        for (let q = 0; q < 10; q++) { const a0 = q / 10 * 6.2832, a1 = (q + 1) / 10 * 6.2832; flat(x + Math.cos(a0) * ri, z + Math.sin(a0) * ri, x + Math.cos(a1) * ri, z + Math.sin(a1) * ri, x + Math.cos(a1) * (ri + 0.07), z + Math.sin(a1) * (ri + 0.07), x + Math.cos(a0) * (ri + 0.07), z + Math.sin(a0) * (ri + 0.07)); }
        const st = wacc(MT.stone, x, z, false); for (const [ox, oz, hx, hz] of [[0, h + 0.09, h + 0.18, 0.09], [0, -h - 0.09, h + 0.18, 0.09], [h + 0.09, 0, 0.09, h], [-h - 0.09, 0, 0.09, h]]) boxA(st, x + ox, y - 0.02, z + oz, hx, 0.035, hz, 0, COL.cantera, 0.6); cnt("treeGrates"); }
      else if (mode === "ring") { const st = wacc(MT.stone, x, z, false), soil = wacc(MT.bed, x, z, false); const m = 11; const rows = []; let gmin = 1e9, gmax = -1e9; for (let i = 0; i <= m; i++) { const a2 = i / m * 6.2832; const px = x + Math.cos(a2) * rr, pzz = z + Math.sin(a2) * rr; const g = groundAt(px, pzz); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); rows.push({ x: px, z: pzz, nx: Math.cos(a2), nz: Math.sin(a2), hw: 0.1, y0: 0, y1: 0, d: a2 * rr }); }
        for (const r of rows) { r.y0 = gmin - 0.12; r.y1 = gmax + 0.2; } prismA(st, rows, COL.cantera, 0.7, false); const ys = gmax + 0.1; for (let i = 0; i < m; i++) { const a0 = i / m * 6.2832, a1 = (i + 1) / m * 6.2832; quad(soil, [x, ys, z], [x + Math.cos(a1) * (rr - 0.08), ys, z + Math.sin(a1) * (rr - 0.08)], [x + Math.cos(a0) * (rr - 0.08), ys, z + Math.sin(a0) * (rr - 0.08)], [x, ys, z], [0.5, 0.5, 0.5 + Math.cos(a1) * 0.5, 0.5 + Math.sin(a1) * 0.5, 0.5 + Math.cos(a0) * 0.5, 0.5 + Math.sin(a0) * 0.5, 0.5, 0.5], COL.mulch); } cnt("treeRings"); }
      else { const tb = wacc(MT.timber, x, z, false, 380), soil = wacc(MT.bed, x, z, false, 300); const h = rr * 1.05; let gmax = -1e9, gmin = 1e9; for (const [ox, oz] of [[-h, -h], [h, -h], [h, h], [-h, h], [0, 0]]) { const g = groundAt(x + ox, z + oz); gmax = Math.max(gmax, g); gmin = Math.min(gmin, g); } const yc = (gmax + 0.26 + gmin - 0.1) / 2, hy = (gmax + 0.26 - (gmin - 0.1)) / 2;
        for (const [ox, oz, hx, hz] of [[0, h, h + 0.1, 0.1], [0, -h, h + 0.1, 0.1], [h, 0, 0.1, h - 0.1], [-h, 0, 0.1, h - 0.1]]) boxA(tb, x + ox, yc, z + oz, hx, hy, hz, 0, COL.oldtimber, 0.9); const ys = gmax + 0.16; quad(soil, [x - h + 0.1, ys, z + h - 0.1], [x + h - 0.1, ys, z + h - 0.1], [x + h - 0.1, ys, z - h + 0.1], [x - h + 0.1, ys, z - h + 0.1], [0, 0, 1, 0, 1, 1, 0, 1], COL.mulch); cnt("treeBoxes"); } } }
  // string lights: straight across at every pair of posts and a diagonal to the next pair (a zigzag canopy), bulbs every 0.5 m
  const BULB = { pos: [], wire: [] };
  function hang(e0, e1, H) { const a = [e0[0], e0[1] + 5.1 * e0[4], e0[2]], b = [e1[0], e1[1] + 5.1 * e1[4], e1[2]]; const L = Math.hypot(b[0] - a[0], b[2] - a[2]); if (L < 3 || L > 30) return; const sag = Math.min(1.1, 0.45 + L * 0.035);
    const m = Math.max(4, Math.round(L / 1.0)); let prev = null; for (let k = 0; k <= m; k++) { const t = k / m; const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t]; if (prev) BULB.wire.push(prev[0], prev[1], prev[2], p[0], p[1], p[2]); prev = p; }
    const nb = Math.floor(L / 0.5); for (let k = 1; k < nb; k++) { const t = k / nb; BULB.pos.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag - 0.07, a[2] + (b[2] - a[2]) * t); } cnt("strings"); }
  function stringMeshes() { for (const s of E.strings) { const R = s.rows; for (const row of R) for (const k in row) if (row[k]) row[k].seated = true; for (let i = 0; i < R.length; i++) { const L = R[i][-1], Rt = R[i][1]; if (L && Rt) hang(L, Rt, s.H); const n = R[i + 1]; if (n) { if (L && n[1]) hang(L, n[1], s.H); else if (Rt && n[-1]) hang(Rt, n[-1], s.H); } } }
    if (!BULB.pos.length) return; const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(BULB.pos, 3)); g.computeBoundingSphere();
    E.bulbs = new THREE.Points(g, new THREE.PointsMaterial({ map: MT.disc, size: 0.15, sizeAttenuation: true, alphaTest: 0.45, transparent: false, color: 0xf3ead8 })); E.bulbs.userData.e1 = true; E.bulbs.userData.noInst = true; scene.add(E.bulbs);
    E.halo = new THREE.Points(g, new THREE.PointsMaterial({ map: MT.halo, size: 1.05, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd9a0 })); E.halo.userData.e1 = true; E.halo.visible = false; scene.add(E.halo);
    const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(BULB.wire, 3)); wg.computeBoundingSphere(); E.wire = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1a1612 })); E.wire.userData.e1 = true; E.wire.userData.noInst = true; scene.add(E.wire); cnt("bulbs", BULB.pos.length / 3); }
  // warm pools of light under the lanterns and the pillar lanterns at night (one additive draw)
  function lightPools() { const spots = []; for (const l of E.lanterns) spots.push([l.e[0], l.e[2], 3.2]); for (const k of ["e1_pillar", "e1_tpost"]) for (const e of PLACE[k] || []) spots.push([e[0], e[2], 3.6]); if (!spots.length) return;
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: MT.halo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(); spots.forEach(([x, z, r], i) => { p.set(x, groundAt(x, z) + 0.04, z); s.set(r, 1, r); m.compose(p, q, s); pool.setMatrixAt(i, m); }); pool.frustumCulled = false; pool.renderOrder = 2; pool.userData.e1 = true; pool.visible = false; scene.add(pool); E.pool = pool; }
  // ───────────────────────── far props: a real LOD for the heavy props whose LOD file is the full model ─────────────────────────
  // agave, yucca, saguaro, ocotillo, the lamp, the fan palm, the boulder and the lantern ship a models/lod glb as heavy as the
  // model, so every one past the LOD switch (60 m; 120 m for the tall ones) still drew 1,800 to 6,000 triangles. D3's planFarGeo
  // clusters the LOD's vertices on a grid finer than a pixel at the switch distance, keeping every attribute, the materials, the
  // sway and the night glow; the near tier is unchanged. This pays for the planting this module adds, and more.
  // window.PLAN_ENRICH_PROPLOD = false (before load) switches it off; PLAN_ENRICH.propLodSet(false / true) toggles it live.
  const PROP_LOD = { agave_cluster: 0.07, yucca_cluster: 0.08, saguaro: 0.11, ocotillo: 0.09, lamp: 0.1, fanpalm: 0.16, e1_fanpalm: 0.16, fanpalm2: 0.16, e1_fanpalm2: 0.16, boulder: 0.1, lantern: 0.12 };
  const LODC = new Map(); E.propLod = {};
  const triOf = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  function propLod() { if (window.PLAN_ENRICH_PROPLOD === false || typeof planFarGeo !== "function") return 0; let done = 0;
    for (const k in PROP_LOD) { const m = MODELS[k]; if (!m || !m.lodGeos || E.propLod[k]) continue; const S = INSTSET.find((q) => q.kind === k); if (!S || !S.far || !S.far.length) continue;
      const full = m.parts.reduce((s, p) => s + triOf(p.geometry), 0), lod = m.lodGeos.reduce((s, g) => s + triOf(g), 0); if (lod < full * 0.7) { E.propLod[k] = "native"; continue; }
      const geos = m.lodGeos.map((g) => { if (LODC.has(g)) return LODC.get(g); let r = null; try { r = planFarGeo(g, PROP_LOD[k]); } catch (e) { r = null; } LODC.set(g, r || g); return r || g; });
      const after = geos.reduce((s, g) => s + triOf(g), 0); if (after > lod * 0.8) { E.propLod[k] = "none"; continue; }
      S.e1orig = S.far.map((inst) => inst.geometry); S.far.forEach((inst, i) => { if (geos[i]) inst.geometry = geos[i]; }); S.e1lod = geos; E.propLod[k] = [Math.round(lod), Math.round(after)]; done++; }
    // palms: their fronds only cluster at about 3.5 cm per metre of height, so they get the engine's third tier instead (as D3's
    // buildings do): the clustered crown from 270 m, where a cell is about two pixels
    for (const k of ["fanpalm", "e1_fanpalm", "fanpalm2", "e1_fanpalm2", "datepalm", "e1_datepalm", "canarypalm", "e1_canarypalm"]) { const m = MODELS[k]; if (!m || !m.lodGeos) continue; const S = INSTSET.find((q) => q.kind === k); if (!S || !S.far || S.far2 || S.e1far2) continue;
      const cell = 0.035 * m.height; const geos = m.lodGeos.map((g) => { const key = g.uuid + ":" + cell; if (LODC.has(key)) return LODC.get(key); let r = null; try { r = planFarGeo(g, cell); } catch (e) { r = null; } LODC.set(key, r); return r; });
      if (geos.some((g) => !g)) { S.e1far2 = "none"; continue; } S.lodR2 = Math.max((S.lodR || 120) + 150, 270); S.far2 = []; S.e1far2 = true;
      geos.forEach((geo, i) => { const mat = (m.parts[i] || m.parts[m.parts.length - 1]).material; const inst = new THREE.InstancedMesh(geo, mat, S.list.length); inst.castShadow = shadowAll(); inst.receiveShadow = true; inst.frustumCulled = false; inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage); inst.count = 0; scene.add(inst); S.far2.push(inst); });
      E.propLod[k + ":far"] = [Math.round(m.lodGeos.reduce((s, g) => s + triOf(g), 0)), Math.round(geos.reduce((s, g) => s + triOf(g), 0))]; done++; }
    // INT: a clustered third tier for the round 2 asset kinds: [cell in metres, start distance]; small parts keep their LOD geometry
    const FAR2 = { barrel_cactus: [0.1, 70], prickly_pear: [0.12, 80], cholla: [0.12, 80], saguaro_young: [0.12, 80], saguaro_mid: [0.2, 130], saguaro_giant: [0.3, 190], organ_pipe: [0.2, 130], bench_lux: [0.08, 55], planter_lux: [0.1, 60] };
    for (const k in FAR2) { const m = MODELS[k]; if (!m || !m.lodGeos) continue; const S = INSTSET.find((q) => q.kind === k); if (!S || !S.far || S.far2 || S.e1far2) continue; const [cell, at] = FAR2[k];
      const geos = m.lodGeos.map((g) => { const key = g.uuid + ":" + cell; if (LODC.has(key)) return LODC.get(key); let r = null; try { r = planFarGeo(g, cell); } catch (e) { r = null; } LODC.set(key, r || g); return r || g; });
      const before = m.lodGeos.reduce((s, g) => s + triOf(g), 0), after = geos.reduce((s, g) => s + triOf(g), 0); if (after > before * 0.7) { S.e1far2 = "none"; continue; } S.lodR2 = Math.max((S.lodR || 60) + 20, at); S.far2 = []; S.e1far2 = true;
      geos.forEach((geo, i) => { const mat = (m.parts[i] || m.parts[m.parts.length - 1]).material; const inst = new THREE.InstancedMesh(geo, mat, S.list.length); inst.castShadow = shadowAll(); inst.receiveShadow = true; inst.frustumCulled = false; inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage); inst.count = 0; scene.add(inst); S.far2.push(inst); });
      S.n = -1; S.nf = -1; S.nf2 = -1; E.propLod[k + ":far"] = [Math.round(before), Math.round(after)]; done++; }
    if (done) { cnt("propLodKinds", done); try { updateCulling(true); } catch (e) {} } return done; }
  E.propLodSet = function (on) { for (const S of INSTSET) { if (S.e1orig) S.far.forEach((inst, i) => { inst.geometry = on ? S.e1lod[i] || inst.geometry : S.e1orig[i] || inst.geometry; }); if (S.e1far2 === true) { if (!on) { S.e1r2 = S.e1r2 || S.lodR2; S.lodR2 = 1e9; } else if (S.e1r2) S.lodR2 = S.e1r2; } } return on; };
  // On the high tier the near models of these kinds (the path trees, the shrubs, the succulents, the palms and the lamp) are three
  // to eighteen times their LOD (the LOD is the mobile tier's own full model), and the engine keeps the near model to 60 m (120 m
  // for anything 3.5 m or taller). Past 36 to 65 m the LOD holds up, so the switch moves in; this pays for the planting this
  // module adds. Only where the near model is at least three times the LOD; on the other tiers nothing changes.
  const LOD_AT = { agave_cluster: 36, yucca_cluster: 45, saguaro: 55, ocotillo: 50, fanpalm: 55, fanpalm2: 55, datepalm: 55, canarypalm: 55, lamp: 50, ironwood: 60, mesquite: 60, desertwillow: 55, paloverde: 65, bush1: 36, bush2: 36,
    barrel_cactus: 20, prickly_pear: 24, cholla: 26, saguaro_young: 26, saguaro_mid: 50, saguaro_giant: 60, organ_pipe: 45, bench_lux: 18, planter_lux: 18, lux_lamp: 30 };   /* INT: the round 2 asset kinds */
  function lodDist() { if (window.PLAN_ENRICH_PROPLOD === false) return; for (const k in LOD_AT) { const S = INSTSET.find((q) => q.kind === k); const m = MODELS[k]; if (!S || !S.far || !m || !m.lodGeos || S.e1lodR) continue;
      const full = m.parts.reduce((s, p) => s + triOf(p.geometry), 0), lod = m.lodGeos.reduce((s, g) => s + triOf(g), 0); if (full < lod * 3) { S.e1lodR = -1; continue; } S.e1lodR = S.lodR; S.lodR = Math.min(S.lodR, LOD_AT[k]); S.n = -1; E.propLod[k + ":at"] = [S.e1lodR, S.lodR, Math.round(full), Math.round(lod)]; } }
  E.lodDistSet = function (on) { for (const k in LOD_AT) { const S = INSTSET.find((q) => q.kind === k); if (!S || !(S.e1lodR > 0)) continue; S.lodR = on ? Math.min(S.e1lodR, LOD_AT[k]) : S.e1lodR; S.n = -1; } try { updateCulling(true); } catch (e) {} return on; };
  // the palm aliases share the original's LOD geometry (it may load after the aliases were made)
  function aliasLod() { for (const k in ALIAS) { const a = ALIAS[k]; if (!MODELS[a]) continue; if (!MODELS[a].lodGeos && MODELS[k] && MODELS[k].lodGeos) MODELS[a].lodGeos = MODELS[k].lodGeos; const S = INSTSET.find((q) => q.kind === a); if (!S) continue;
      if (MODELS[a].lodGeos && !S.far) { try { attachLod(a); } catch (e) {} } if (S.far && S.lodR !== 42) { S.lodR = 42; S.n = -1; } } }
  PLAN_HOOKS.defer.push({ name: "enrichDefer", fn: function enrichDefer() { if (!window.PLAN || !E.lateDone || E.done) return; E.done = true; mats();
    step("unbed", () => { for (let i = ROADS.length - 1; i >= 0; i--) if (ROADS[i].e1bed) ROADS.splice(i, 1); });
    step("aliasLod", aliasLod); step("propLod", propLod); step("lodDist", lodDist);
    step("reseat", reseat); step("benchSolids", benchSolids); step("promKerbs", promKerbs); step("beds", bedMeshes); step("plazaMeshes", plazaMeshes); step("islandMeshes", islandMeshes); step("fence", fenceMeshes); step("treeBases", treeBases); step("strings", stringMeshes); step("pools", lightPools); step("flush", flush);
    try { updateCulling(true); } catch (e) {}
    console.log("plan_enrich defer: " + JSON.stringify(E.n) + " in " + JSON.stringify(E.t)); } });

  // ───────────────────────── every frame: night glow and range culling of the merged meshes ─────────────────────────
  let fr = 0, lastGlow = -1;
  PLAN_HOOKS.frame.push({ name: "enrichFrame", fn: function enrichFrame() { if (!E.done) return; fr++;
    const nt = typeof night === "number" ? night : 0; const glow = Math.max(0, nt - 0.2) / 0.8;
    if (Math.abs(glow - lastGlow) > 0.004) { lastGlow = glow; if (E.bulbs) E.bulbs.material.color.setRGB(0.95 + 1.6 * glow, 0.92 + 1.05 * glow, 0.85 + 0.35 * glow); if (E.halo) { E.halo.material.opacity = 0.75 * glow; E.halo.visible = glow > 0.01; } if (E.pool) { E.pool.material.opacity = 0.55 * glow; E.pool.visible = glow > 0.01; } }
    if (fr % 20 === 1) E.cull(); if (fr === 600 || fr === 1800) { aliasLod(); propLod(); lodDist(); } } });
  E.cull = function () { const cx = camera.position.x, cz = camera.position.z; const k = QUAL && QUAL.q ? Math.max(0.6, QUAL.q.range || 1) : 1;
    for (const c of E.chunks) { const d = Math.hypot(c.x - cx, c.z - cz) - c.r; const vis = d < c.range * k; if (c.m.visible !== vis) c.m.visible = vis; } };
})();
