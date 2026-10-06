// R18 S2: streetscape. Loaded after the fill modules, before client.js; client globals are reached by bare name at call time.
//  1. Palms: every old low-poly fan palm (the client's `fanpalm`, 20k triangles, one baked material: the Flight Line Market row,
//     the Fountain Court ring, the dome gardens) becomes the R2 high-quality Mexican fan palm (`fanpalm2`, the same species, the
//     palm at the Arrivals Court door). The Arrivals zone's own old palms (the Club Walk median) are Agent F2's: plan_arrivals
//     swaps them to the date palm in its world phase; anything it leaves there is left alone. Done in the last terrain hook,
//     before the engine instances anything, so no PLACE entry is removed after instancing; the entries move (same object, same
//     collider, same flags).
//  2. Allees: rows of HQ palms both sides of the main promenades and boulevards outside the Arrivals zone, one species per path,
//     every 12 m (14 m on the roads), in plan_enrich's palm kinds (its shorter draw range and LOD), skipping every spot near a
//     ribbon, a door lane, a seat, a solid, a collider, a plaza, a fountain, a keep-out or another tree.
//  3. Railings: an Arrivals-style balustrade (black iron balusters on a cantera plinth, a bronze handrail) with the plaza entry
//     pillars and their bronze lanterns every three panels, on the walk's edge where it stands over a drop; open at every path,
//     plaza, door lane, bench and pergola. One engine kind (`ss_rail`) on plan_enrich's metal and stone materials (no new program),
//     raked with the walk, with a solid per panel.
//  4. Path lamps: the lux lantern lamp between the palms where no lamp or lantern is within 9 m.
//  5. String lights: festoons hung palm to palm along each palm row ("between trees", the new allees and the existing palm rows of
//     the boulevards) and zig-zag over the walks with no string lights yet; all bulbs (these and plan_enrich's 10k festoon bulbs)
//     drawn as instanced emissive globes in the engine's lamp-glow material near the camera (one draw, refilled by 64 m cells as
//     you move), the far glow from plan_enrich's halo points. Wires share plan_enrich's wire material.
// Switches: ?ss=0 (all off), ?sspalm=0 (no palm swap), ?ssallee=0, ?ssrail=0, ?sslamp=0, ?ssstr=0 (no new festoons), ?ssbulb=0
// (plan_enrich's bulbs stay points). Tiers: low gets the swap and the railings only; medium half-density allees and lamps, no festoons;
// high and ultra everything (ultra a longer bulb range).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  const SS = (window.PLAN_STREETSCAPE = { v: "r18-s2", errs: [], n: {}, t: {}, rails: [], allees: [], spans: [], lamps: [] });
  const H = window.PLAN_HOOKS;
  const QS = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(""); } })();
  const sw = (k) => QS.get(k) !== "0";
  const OFF = !sw("ss");
  const ON = { palm: sw("sspalm"), allee: sw("ssallee"), rail: sw("ssrail"), lamp: sw("sslamp"), str: sw("ssstr"), bulb: sw("ssbulb") };
  SS.on = OFF ? {} : ON; SS.off = OFF;
  const cnt = (k, d) => { SS.n[k] = (SS.n[k] || 0) + (d === undefined ? 1 : d); };
  const note = (w, e) => { if (SS.errs.length < 40) SS.errs.push(w + ": " + ((e && e.message) || e)); if (SS.errs.length <= 4) console.error("plan_streetscape " + w + ":", (e && e.stack) || e); };
  const step = (name, fn) => { const t0 = performance.now(); try { fn(); } catch (e) { note(name, e); } SS.t[name] = Math.round(performance.now() - t0); };
  let seed = 0x5cafe18; const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const TAU = Math.PI * 2;
  const has = (k) => typeof MODELS !== "undefined" && !!(MODELS[k] && MODEL_SPECS[k]);
  const tier = () => { try { return QUAL.level || "high"; } catch (e) { return "high"; } };
  // the Arrivals zone belongs to Agent F2: nothing is placed in it (2 m margin); the palm swap is the one exception (see 1)
  const inArr = (x, z, m) => { m = m || 0; return x > -70 - m && x < 270 + m && z > -260 - m && z < 75 + m; };
  const OW = new Set(["S3_MAIN", "S3_GATE", "S3_FRONTIER", "S3_RANCH"]), DARK = new Set(["S3_OUTPOST", "S3_NORTHYARD", "S3_NIGHT"]);
  const distOf = (x, z) => { const d = planDistrictAt(x, z); return d ? d.id : ""; };

  // ───────────────────────── the runway height rule (plan_enrich's airOK) ─────────────────────────
  const RW = {};
  function rwInit() { const P = window.PLAN; const ne = P.runway.ne, s = P.runway.sw; RW.L = Math.hypot(s[0] - ne[0], s[1] - ne[1]); RW.ux = (s[0] - ne[0]) / RW.L; RW.uz = (s[1] - ne[1]) / RW.L; RW.mx = (ne[0] + s[0]) / 2; RW.mz = (ne[1] + s[1]) / 2; RW.half = RW.L / 2; }
  function airOK(x, z, h) { if (!RW.L) return true; const t = (x - RW.mx) * RW.ux + (z - RW.mz) * RW.uz, s = -(x - RW.mx) * RW.uz + (z - RW.mz) * RW.ux; const as = Math.abs(s), at = Math.abs(t); if (as > 520 || at > RW.half + 1400) return true;
    const tc = clamp(t, -RW.half, RW.half); const cx = RW.mx + RW.ux * tc, cz = RW.mz + RW.uz * tc; const top = h + (getH(x, z) - getH(cx, cz));
    if (at <= RW.half + 60) { if (h > 7 && as < 150) return false; return top <= (as - 76) / 7; }
    const d = at - RW.half - 60, hw = 76 + d * 0.15, app = d / 20; if (h > 7 && as < 150) return false; return as <= hw ? top <= app : top <= app + (as - hw) / 7; }

  // ───────────────────────── spatial tests (built once per pass) ─────────────────────────
  const key = (cx, cz) => cx * 100003 + cz;
  const OCC = { C: 6, m: new Map() };
  function occAdd(x, z, r, tag) { const k = key(Math.floor(x / OCC.C), Math.floor(z / OCC.C)); let a = OCC.m.get(k); if (!a) OCC.m.set(k, (a = [])); a.push([x, z, r, tag]); }
  function occHit(x, z, r, tag) { const n = Math.ceil((r + 2.5) / OCC.C), gx = Math.floor(x / OCC.C), gz = Math.floor(z / OCC.C); for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { const a = OCC.m.get(key(gx + i, gz + j)); if (!a) continue; for (const o of a) { if (tag && o[3] !== tag) continue; const dx = o[0] - x, dz = o[1] - z, rr = o[2] + r; if (dx * dx + dz * dz < rr * rr) return o; } } return null; }
  function occNear(x, z, r, tag) { const n = Math.ceil(r / OCC.C), gx = Math.floor(x / OCC.C), gz = Math.floor(z / OCC.C); for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { const a = OCC.m.get(key(gx + i, gz + j)); if (!a) continue; for (const o of a) { if (tag && o[3] !== tag) continue; if (Math.hypot(o[0] - x, o[1] - z) < r) return o; } } return null; }
  const TREE_RE = /palm|verde|mesquite|ironwood|willow|olive|ash|cottonwood|orchard|tree/;
  const LAMP_RE = /^(lamp|lux_lamp|e1_lux_lamp)$/, LIGHT_RE = /lantern|pillar|spost|tpost|opost|bollard|light|pole/;
  const SEAT_RE = /bench|chair|sofa|seat|table|lounger|swing|equipale|rocker/;
  function occBuild() { OCC.m.clear();
    for (const k in PLACE) { const sp = MODEL_SPECS[k], m = MODELS[k]; if (!sp || !m || !sp.prop || sp.animal || (sp.size && sp.size > 60)) continue; const tree = TREE_RE.test(k) && m.height > 3.5, lamp = LAMP_RE.test(k), light = !lamp && LIGHT_RE.test(k), seat = SEAT_RE.test(k);
      const tag = tree ? "tree" : lamp ? "lamp" : light ? "light" : seat ? "seat" : "plant"; for (const e of PLACE[k]) occAdd(e[0], e[2], lamp || light ? 0.35 : tree ? 0.9 : Math.max(0.3, m.radius * e[4] * 0.62), tag); }
    try { for (const q of (SOLAR && SOLAR.pts) || []) occAdd(q[0], q[1], 0.35, "light"); } catch (e) {} }
  const SG = { C: 20, m: new Map(), n: -1 };
  function solidGrid() { if (SG.n === SOLIDS.length) return; SG.m.clear(); SG.n = SOLIDS.length; for (const sd of SOLIDS) { if (sd.ss) continue; const r = Math.hypot(sd.hw, sd.hd) + 0.5; for (let cx = Math.floor((sd.x - r) / SG.C); cx <= Math.floor((sd.x + r) / SG.C); cx++) for (let cz = Math.floor((sd.z - r) / SG.C); cz <= Math.floor((sd.z + r) / SG.C); cz++) { const k = key(cx, cz); let a = SG.m.get(k); if (!a) SG.m.set(k, (a = [])); a.push(sd); } } }
  function solidHit(x, z, r, seatOnly) { solidGrid(); const a = SG.m.get(key(Math.floor(x / SG.C), Math.floor(z / SG.C))); if (!a) return null; for (const sd of a) { if (seatOnly && !sd.seat) continue; const c = Math.cos(sd.ry || 0), s = Math.sin(sd.ry || 0); const dx = x - sd.x, dz = z - sd.z; const lx = dx * c - dz * s, lz = dx * s + dz * c; if (Math.abs(lx) < sd.hw + r && Math.abs(lz) < sd.hd + r) return sd; } return null; }
  // the way into every building: a lane 2.2 m either side of the line from its front door 12 m out (plan buildings and door kinds)
  const DG = { C: 20, m: new Map() };
  function doorBuild() { DG.m.clear(); const segs = [];
    try { for (const r of PLAN_BLD || []) { const e = r.e, m = MODELS[r.kind], sp = MODEL_SPECS[r.kind]; if (!e || !m || !sp || sp.prop || sp.vehicle) continue; const fx = Math.sin(e[3]), fz = Math.cos(e[3]); const d0 = m.sz / 2 * e[4] + 0.4; segs.push([e[0] + fx * d0, e[2] + fz * d0, e[0] + fx * (d0 + 12), e[2] + fz * (d0 + 12)]); } } catch (e) { note("doors plan", e); }
    try { for (const kind of DOOR_KINDS) { const list = PLACE[kind]; if (!list || !MODELS[kind]) continue; const r = MODELS[kind].radius, df = doorF(kind); for (const e of list) { const fx = Math.sin(e[3]), fz = Math.cos(e[3]); const d0 = r * e[4] * df; segs.push([e[0] + fx * d0, e[2] + fz * d0, e[0] + fx * (d0 + 10), e[2] + fz * (d0 + 10)]); } } } catch (e) { note("doors kinds", e); }
    for (const s of segs) for (const [x, z] of [[s[0], s[1]], [(s[0] + s[2]) / 2, (s[1] + s[3]) / 2], [s[2], s[3]]]) { const k = key(Math.floor(x / DG.C), Math.floor(z / DG.C)); let a = DG.m.get(k); if (!a) DG.m.set(k, (a = [])); if (!a.includes(s)) a.push(s); } SS.n.doorLanes = segs.length; }
  function doorHit(x, z, r) { const gx = Math.floor(x / DG.C), gz = Math.floor(z / DG.C); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = DG.m.get(key(gx + i, gz + j)); if (!a) continue; for (const s of a) { const vx = s[2] - s[0], vz = s[3] - s[1]; const t = clamp(((x - s[0]) * vx + (z - s[1]) * vz) / (vx * vx + vz * vz || 1), 0, 1); if (Math.hypot(x - s[0] - vx * t, z - s[1] - vz * t) < 2.2 + r) return true; } } return false; }
  function inPlaza(x, z, pad) { for (const p of PLAZAS) if (Math.hypot(p[0] - x, p[1] - z) < p[2] + (pad || 0)) return p; return null; }
  function fountHit(x, z, r) { for (const f of PLAN_IDX.fount.values()) if (f._r && Math.hypot(f.x - x, f.z - z) < f._r + 1.5 + r) return true; return false; }
  function keepHit(x, z, r) { for (const k of KEEPOUT) if (k[2] < 12 && Math.hypot(k[0] - x, k[1] - z) < k[2] + r) return true; return false; }
  function colHit(x, z, r) { planColSync(); const a = PGRID.col.get(Math.floor(x / PGRID.C) * 100003 + Math.floor(z / PGRID.C)); if (!a) return false; for (const c of a) { const g = c[2] >= 0.6 ? r + 0.3 : Math.min(r, 0.45); if (Math.hypot(c[0] - x, c[1] - z) < c[2] + g) return true; } return false; }
  function trench(x, z) { const F = window.PLAN_FLOOR; if (typeof F !== "function") return false; try { return typeof F(x, z) === "number"; } catch (e) { return false; } }
  function pergHit(x, z, r) { const E = window.PLAN_ENRICH; const P = (E && E.pergolas) || []; for (const q of P) { const qx = q.x !== undefined ? q.x : q[0], qz = q.z !== undefined ? q.z : q[1]; if (typeof qx === "number" && Math.hypot(qx - x, qz - z) < 6 + r) return true; } return false; }
  const VIEWS = [];
  function viewsInit() { VIEWS.length = 0; const rg = planPlace("genesis_ring"); if (!rg) return; for (const id of ["pz_court", "pz_crossing", "pz_compass", "pz_gate", "pz_fcourt"]) { const z = PLAN_IDX.plaza.get(id); if (z) VIEWS.push([z.x, z.z, rg.x, rg.z]); }
    const sc = PLAN_IDX.prom.get("hl4_sculpture_ave"); if (sc) VIEWS.push([sc.pts[0][0], sc.pts[0][1], rg.x, rg.z]); const ms = window.PLAN_MAIN_PTS || (PLAN_IDX.prom.get("hl3_main_street") || {}).pts; if (ms) VIEWS.push([ms[0][0], ms[0][1], rg.x, rg.z]); }
  function blocksView(x, z) { for (const v of VIEWS) { const dx = v[2] - v[0], dz = v[3] - v[1], L2 = dx * dx + dz * dz; const t = ((x - v[0]) * dx + (z - v[1]) * dz) / L2; if (t <= 0 || t >= 1) continue; if (Math.hypot(x - v[0] - dx * t, z - v[1] - dz * t) < 7.5) return true; } return false; }
  const inTerrain = (x, z) => x > T.xmin + 25 && x < T.xmax - 25 && z > T.zmin + 25 && z < T.zmax - 25;
  // a free spot of radius r: our land, outside the Arrivals zone, off every ribbon (but `own`), building, solid, plaza, door lane
  function spotOK(x, z, r, own, o) { o = o || {};
    if (!inTerrain(x, z) || inArr(x, z, 2)) return "zone"; if (planZone(x, z) !== "land") return "land"; if (distToRunway(x, z) < (o.rw || 96)) return "runway";
    if (planNearRoad(x, z, r + (o.road === undefined ? 0.3 : o.road), own)) return "ribbon"; if (o.loose ? colHit(x, z, r) : planNearCollider(x, z, r + 0.25)) return "collider"; if (solidHit(x, z, r + 0.15)) return "solid";
    if (!o.plaza && inPlaza(x, z, 0.5 + r)) return "plaza"; if (planPolyBlocked(x, z)) return "keepout"; if (fountHit(x, z, r)) return "fountain"; if (keepHit(x, z, r + 0.2)) return "keep"; if (doorHit(x, z, r)) return "door";
    if (o.loose ? occHit(x, z, r, "lamp") || occHit(x, z, r, "light") || occHit(x, z, r, "seat") || occHit(x, z, Math.min(r, 0.4), "plant") : occHit(x, z, r)) return "occupied"; if (trench(x, z)) return "trench"; if (pergHit(x, z, r)) return "pergola"; return null; }

  // ───────────────────────── geometry helpers ─────────────────────────
  function plen(pts) { let L = 0; for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return L; }
  // samples every st metres from a0 to a1 with smoothed tangents { x, z, ux, uz, d }
  function samples(pts, st, a0, a1) { const L = plen(pts); a0 = a0 || 0; a1 = a1 === undefined ? L : Math.min(L, a1); const out = []; if (a1 - a0 < 0.01) return out;
    const at = (d) => { let acc = 0; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-6) continue; if (acc + l >= d || i === pts.length - 2) { const t = clamp((d - acc) / l, 0, 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; } acc += l; } return pts[pts.length - 1].slice(); };
    const n = Math.max(1, Math.round((a1 - a0) / st)); for (let k = 0; k <= n; k++) { const d = a0 + (a1 - a0) * k / n; const p = at(d), p0 = at(Math.max(0, d - 1.5)), p1 = at(Math.min(L, d + 1.5)); let ux = p1[0] - p0[0], uz = p1[1] - p0[1]; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l; out.push({ x: p[0], z: p[1], ux, uz, d }); }
    return out; }
  const offP = (s, o) => [s.x - s.uz * o, s.z + s.ux * o];   // side sd: o = offset * sd (plan_enrich's convention)
  // the surface under (x, z): before DEFER the ground plus any ribbon lift, after it the drawn walk grid (planGroundAt)
  const surf = (x, z) => planGroundAt(x, z);

  // ───────────────────────── the configuration ─────────────────────────
  // allees: path id (plan.json promenade or road) -> palm kind, step, and whether the palms stand inside the walk (wide walks)
  const ALLEE = {
    landing_walk: { k: "datepalm", st: 12 }, gallery_walk: { k: "canarypalm", st: 13 }, ridge_walk: { k: "datepalm", st: 12 }, clubhouse_walk: { k: "datepalm", st: 12 },
    bluff_walk: { k: "fanpalm2", st: 11 }, mesa_walk: { k: "fanpalm2", st: 11 }, flightline_prom: { k: "fanpalm2", st: 12 }, paddock_walk: { k: "fanpalm2", st: 12 },
    heritage_strip_p: { k: "fanpalm2", st: 12, inside: true }, night_walk: { k: "fanpalm2", st: 12, dark: true }, link_south: { k: "datepalm", st: 12 }, founders_court_walk: { k: "datepalm", st: 10 },
    terminal_drive: { k: "fanpalm2", st: 14, road: true, x1: -72 }, commons_rd_n: { k: "fanpalm2", st: 16, road: true }, golf_rd: { k: "fanpalm2", st: 16, road: true },
    commons_rd: { k: "fanpalm2", st: 16, road: true }, landing_blvd: { k: "fanpalm2", st: 15, road: true }, hangar_rd: { k: "fanpalm2", st: 16, road: true }, founders_ln: { k: "datepalm", st: 14, road: true },
  };
  // where festoons may hang over the walk (zig-zag palm to palm across it): walks with no plan_enrich string lights and no dark sky
  const ZIG = new Set(["founders_court_walk"]);
  const BULB_STEP = 0.55, STR_H = 4.6;
  const TRY = [[0, 0], [1.5, 0], [-1.5, 0], [0, 0.8], [0, -0.5], [3, 0], [-3, 0], [1.5, 0.8], [-1.5, 0.8]];   // along, across tries for a palm slot

  // ───────────────────────── the railing model: 2.2 m panel, iron balusters on a cantera plinth, a bronze handrail ─────────────────────────
  const PANEL = 2.2, PIL_W = 0.6, RAIL_H = 1.02;
  function boxInto(P, N, U, C, cx, cy, cz, hx, hy, hz, col, tile, skipBottom) { const faces = [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]]; const h = [hx, hy, hz]; const tl = tile || 1;
    for (let f = 0; f < 6; f++) { if (skipBottom && f === 3) continue; const [n, u, v] = faces[f]; const c = [cx + n[0] * hx, cy + n[1] * hy, cz + n[2] * hz]; const su = Math.abs(u[0]) * hx + Math.abs(u[1]) * hy + Math.abs(u[2]) * hz, sv = Math.abs(v[0]) * hx + Math.abs(v[1]) * hy + Math.abs(v[2]) * hz;
      const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [c[0] + u[0] * su * a + v[0] * sv * b, c[1] + u[1] * su * a + v[1] * sv * b, c[2] + u[2] * su * a + v[2] * sv * b]);
      for (const i of [0, 1, 2, 0, 2, 3]) { const p = q[i]; P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); const uu = (p[0] * u[0] + p[1] * u[1] + p[2] * u[2]) / tl, vv = (p[0] * v[0] + p[1] * v[1] + p[2] * v[2]) / tl; U.push(uu, vv); C.push(col[0], col[1], col[2]); } } void h; }
  function geo(P, N, U, C) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3)); g.computeBoundingBox(); g.computeBoundingSphere(); return g; }
  const COL = { iron: [0.05, 0.048, 0.045], bronze: [0.22, 0.15, 0.09], cantera: [1, 0.97, 0.92], limestone: [0.93, 0.9, 0.84] };
  function defRail() { if (has("ss_rail")) return true; const lan = MODELS.e1_lantern, pil = MODELS.e1_pillar; if (!lan || !pil) { note("rail", "plan_enrich kinds missing"); return false; }
    const metal = lan.parts[0].material, stone = pil.parts[0].material; const hx = PANEL / 2;
    const a = [[], [], [], []], b = [[], [], [], []];
    boxInto(...b, 0, 0.02, 0, hx + 0.012, 0.2, 0.15, COL.cantera, 0.6, true);           // plinth: 0.18 m over the walk, 0.22 m under it
    boxInto(...b, 0, 0.235, 0, hx + 0.03, 0.025, 0.17, COL.cantera, 0.6);              // its cap
    boxInto(...a, 0, 0.3, 0, hx, 0.025, 0.022, COL.iron); boxInto(...a, 0, 0.74, 0, hx, 0.018, 0.02, COL.iron);
    boxInto(...a, 0, RAIL_H - 0.03, 0, hx, 0.03, 0.045, COL.bronze);                 // the bronze handrail
    const nb = 18; for (let i = 0; i < nb; i++) { const x = -hx + (i + 0.5) * PANEL / nb; boxInto(...a, x, 0.62, 0, 0.009, 0.32, 0.009, COL.iron); if (i % 2 === 0) boxInto(...a, x, 0.5, 0, 0.018, 0.03, 0.018, COL.iron); }
    for (let i = 0; i < nb - 1; i += 2) { const x = -hx + (i + 1) * PANEL / nb; boxInto(...a, x, 0.84, 0, 0.034, 0.034, 0.008, COL.iron); }   // a cast rosette between the rails
    const parts = [{ geometry: geo(...a), material: metal }, { geometry: geo(...b), material: stone, noShadow: true }];
    MODELS.ss_rail = { parts, norm: new THREE.Matrix4(), bottom: 0, radius: hx + 0.05, height: RAIL_H, sx: PANEL + 0.06, sz: 0.34, sink: 0 };
    MODEL_SPECS.ss_rail = { height: RAIL_H, prop: true, solid: 0, e1range: 260 }; SS.n.railTris = (a[0].length + b[0].length) / 9; return true; }

  // ───────────────────────── 1. the palm swap ─────────────────────────
  function swapPalms() { const list = PLACE.fanpalm; if (!list || !list.length) return; const fan = has("fanpalm2") ? "fanpalm2" : null, date = has("datepalm") ? "datepalm" : null; if (!fan && !date) return;
    const club = (PLAN_IDX.prom.get("hl1_club_walk") || {}).pts; const onClub = (x, z) => { if (!club) return false; for (let i = 0; i < club.length - 1; i++) { const a = club[i], b = club[i + 1]; const vx = b[0] - a[0], vz = b[1] - a[1]; const t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1), 0, 1); if (Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t) < 4) return true; } return false; };
    const H0 = MODELS.fanpalm ? MODELS.fanpalm.height : 13; const keep = [];
    for (const e of list) { if (inArr(e[0], e[2])) { keep.push(e); cnt("swap:leftToArrivals"); continue; }   // the zone's palms are Agent F2's (plan_arrivals swaps them)
      const k = onClub(e[0], e[2]) && date ? date : fan || date; const kk = MODELS["e1_" + k] && !onClub(e[0], e[2]) && e.e1 ? "e1_" + k : k;   // the client's own palms keep the full draw range
      const h1 = MODELS[kk].height; e[4] = e[4] * H0 / h1 * (k === "datepalm" ? 0.85 : 1.0); e[3] = rand() * TAU; (PLACE[kk] || (PLACE[kk] = [])).push(e); cnt("swap:" + kk); if (inArr(e[0], e[2])) cnt("swapInArrivals"); }
    list.length = 0; for (const e of keep) list.push(e); }

  // ───────────────────────── 2 to 5: the layout (terrain phase, before instancing) ─────────────────────────
  function recsOf(id) { return ROADS.filter((r) => r.plan === id && r.pts && r.pts.length >= 2); }
  function palmKind(k) { const a = "e1_" + k; return has(a) ? a : has(k) ? k : null; }
  function put2(kind, x, z, yaw, sc) { put(kind, x, z, yaw, sc); const e = PLACE[kind][PLACE[kind].length - 1]; e.keep = true; e.ss = true; return e; }
  function layout() { const t = tier(); if (t === "low" && !ON.rail && !ON.lamp) return; rwInit(); viewsInit(); occBuild(); doorBuild();
    const beds = new Set(ROADS.filter((r) => r.e1bed)); const dens = t === "medium" ? 2 : 1;
    for (const id in ALLEE) { const cfg = ALLEE[id]; const recs = recsOf(id); if (!recs.length) { cnt("allee:missing"); continue; }
      const main = recs.reduce((a, b) => (b.w > a.w ? b : a)); let pts = main.pts; const w = main.w; const own = new Set(recs.concat([...beds]));
      if (cfg.x1 !== undefined) { pts = pts.filter((p) => p[0] <= cfg.x1); if (pts.length < 2) continue; }
      const mid = pts[Math.floor(pts.length / 2)]; const did = distOf(mid[0], mid[1]); if (DARK.has(did) && !cfg.dark) continue;
      const L = plen(pts); const inside = !!cfg.inside; const off = inside ? w / 2 - 1.7 : cfg.road ? w / 2 + 2.6 : w / 2 + 1.75; const kind = palmKind(cfg.k); const A = { id, kind, w, off, rows: { "-1": [], "1": [] }, pts, own, n: 0 };
      SS.allees.push(A);
      if (ON.allee && kind && t !== "low") { const ss = samples(pts, cfg.st, cfg.st / 2, L - 4); let i = 0;
        for (const s of ss) { i++; for (const sd of [-1, 1]) { let placed = null; if (dens > 1 && (i + (sd > 0 ? 1 : 0)) % dens) { A.rows[sd].push(null); continue; }
            let why0 = null; for (const [dd, oo] of TRY) { const s2 = { x: s.x + s.ux * dd, z: s.z + s.uz * dd, ux: s.ux, uz: s.uz }; const [x, z] = offP(s2, (off + (inside ? -oo : oo)) * sd); const sc = 0.95 + rand() * 0.17; const hgt = MODELS[kind].height * sc;
              if (!airOK(x, z, hgt + 1)) { why0 = "air"; continue; } if (blocksView(x, z)) { why0 = "view"; continue; }
              const why = spotOK(x, z, 0.7, own, { road: inside ? -0.3 : 0.25, plaza: false, loose: true }); if (why) { why0 = why; continue; }
              if (occNear(x, z, 5.0, "tree")) { why0 = "tree"; continue; }
              placed = put2(kind, x, z, rand() * TAU, sc); placed.ssAlong = s.d + dd; occAdd(x, z, 0.9, "tree"); A.n++; cnt("palms"); break; }
            if (!placed && why0) cnt("allee:" + why0); A.rows[sd].push(placed); } } }
      // the lux lantern lamps: midway between the palms, alternating sides, one every 2 steps a side
      if (ON.lamp && has("lux_lamp") && !cfg.dark && t !== "low") { const lo = inside ? w / 2 - 0.9 : w / 2 + 0.8; let j = 0;
        for (const s of samples(pts, cfg.st * 2, cfg.st, L - 6)) { j++; const sd = j % 2 ? 1 : -1; const [x, z] = offP(s, lo * sd); if (occNear(x, z, 16, "lamp")) { cnt("lamp:near"); continue; } if (occNear(x, z, 1.6, "light")) { cnt("lamp:light"); continue; } const why = spotOK(x, z, 0.35, own, { road: inside ? -0.25 : 0.1, plaza: false, loose: true }); if (why) { cnt("lamp:" + why); continue; }
          const e = put2("lux_lamp", x, z, rand() * TAU, 1); occAdd(x, z, 0.35, "lamp"); SS.lamps.push(e); cnt("lamps"); } } }
    if (ON.rail && defRail()) railings();
    if (ON.str && (t === "high" || t === "ultra")) planStrings(); }

  // ───────────────────────── 3. railings where a walk's edge stands over a drop ─────────────────────────
  const DROP = 0.4, RUN_MIN = 5.0, RS = 0.8;
  function railings() { const t0 = performance.now(); const beds = new Set(ROADS.filter((r) => r.e1bed));
    const cands = []; for (const pr of PLAN.promenades || []) { if (/^gp_/.test(pr.id) || planSkip(pr.id) || pr.id === "hl1_club_walk" || pr.id === "hl3_main_street" || pr.id === "hl4_sculpture_ave") continue; const recs = recsOf(pr.id); if (!recs.length) continue; const main = recs.reduce((a, b) => (b.w > a.w ? b : a)); if (main.w < 3.5) continue; cands.push({ id: pr.id, recs, main }); }
    for (const c of cands) { const own = new Set(c.recs.concat([...beds])); const R = c.main; const hw = R.w / 2; const L = plen(R.pts); if (L < 12) continue; const S = samples(R.pts, RS, 0, L);
      for (const sd of [-1, 1]) { const ok = S.map((s) => { const [x, z] = offP(s, (hw - 0.32) * sd); if (inArr(x, z, 3)) return 0;
          const top = surf(...offP(s, (hw - 0.3) * sd)); const g1 = surf(...offP(s, (hw + 1.0) * sd)), g2 = surf(...offP(s, (hw + 2.4) * sd)); if (top - Math.min(g1, g2) < DROP) return 0;
          const d = distOf(x, z); if (OW.has(d) || DARK.has(d) || /^gp_/.test(d)) return 0; if (planZone(x, z) !== "land") return 0;
          // openings: another ribbon at the edge, a plaza, a door lane, a seat or bench, a pergola, a solid, a fountain, a keep-out
          const [ox, oz] = offP(s, (hw + 0.9) * sd); if (planNearRoad(ox, oz, 0.9, own)) return 0; if (planNearRoad(x, z, 0.05, own)) return 0; if (inPlaza(x, z, 1.5)) return 0; if (doorHit(x, z, 0.4)) return 0;
          if (occNear(x, z, 2.4, "seat") || occNear(ox, oz, 2.4, "seat")) return 0; if (occHit(x, z, 0.7, "tree") || occHit(x, z, 0.05, "lamp") || occHit(x, z, 0.05, "light") || occHit(x, z, 0.05, "plant")) return 0; if (solidHit(x, z, 0.3)) return 0; if (pergHit(x, z, 0)) return 0; if (fountHit(x, z, 0.5) || planPolyBlocked(x, z) || keepHit(x, z, 0.3)) return 0;
          if (planNearCollider(x, z, 0.3)) return 0; return 1; });
        // runs of ok samples (1-sample gaps closed), each laid out as pillar, panels, pillar
        let i = 0; while (i < ok.length) { if (!ok[i]) { i++; continue; } let j = i; while (j + 1 < ok.length && (ok[j + 1] || (j + 2 < ok.length && ok[j + 2]))) j++; const len = (j - i) * RS; if (len >= RUN_MIN) layRun(c, R, S.slice(i, j + 1), sd, hw); else cnt("rail:short"); i = j + 1; } } }
    SS.t.railLayout = Math.round(performance.now() - t0); }
  function layRun(c, R, S, sd, hw) { const o = (hw - 0.32) * sd; const line = S.map((s) => offP(s, o)); const cum = [0]; for (let k = 1; k < line.length; k++) cum.push(cum[k - 1] + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]));
    const Lr = cum[cum.length - 1] - 0.4; let n = 0; const T = (m) => m * PANEL + (Math.ceil(m / 3) + 1) * PIL_W; while (T(n + 1) <= Lr) n++; if (n < 2) { cnt("rail:short"); return; }
    const at = (d) => { let k = 1; while (k < cum.length - 1 && cum[k] < d) k++; const t = clamp((d - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1), 0, 1); return [line[k - 1][0] + (line[k][0] - line[k - 1][0]) * t, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * t]; };
    let d = 0.2 + (Lr - T(n)) / 2; const run = { id: c.id, sd, pillars: [], panels: [] };
    const pillar = (dd) => { const p = at(dd), q = at(dd + 0.3); const yaw = Math.atan2(-(q[1] - p[1]), q[0] - p[0]); if (has("e1_pillar")) { const e = put2("e1_pillar", p[0], p[1], yaw, 1); run.pillars.push(e); occAdd(p[0], p[1], 0.4, "light"); cnt("railPillars"); } };
    pillar(d + PIL_W / 2); d += PIL_W; for (let m = 0; m < n; m++) { const a = at(d), b = at(d + PANEL); const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]); const e = put2("ss_rail", (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, yaw, 1); e.ssA = a; e.ssB = b; run.panels.push(e); cnt("railPanels"); d += PANEL; if ((m + 1) % 3 === 0 || m === n - 1) { pillar(d + PIL_W / 2); d += PIL_W; } }
    SS.rails.push(run); cnt("railRuns"); cnt("railM", Math.round(n * PANEL)); }

  // ───────────────────────── 5. festoons: palm to palm along the rows, zig-zag over a few walks ─────────────────────────
  function planStrings() { const E = window.PLAN_ENRICH; const posts = new Set(); for (const s of (E && E.strings) || []) posts.add(s.id);
    // the palm rows: this module's and the existing palms of the same paths (plan_enrich's road palms, the R15 boulevards), by side
    const palmKinds = Object.keys(PLACE).filter((k) => /palm/.test(k) && MODELS[k] && MODELS[k].height > 6);
    const PG = new Map(); for (const k of palmKinds) for (const e of PLACE[k]) { const kk = key(Math.floor(e[0] / 30), Math.floor(e[2] / 30)); let a = PG.get(kk); if (!a) PG.set(kk, (a = [])); a.push([k, e]); }
    for (const A of SS.allees) { const pts = A.pts; const L = plen(pts); const S = samples(pts, 2, 0, L); if (S.length < 2) continue; const hwOut = A.w / 2; const lo = A.off < hwOut ? A.off - 2 : hwOut + 0.4, hi = A.off < hwOut ? A.off + 2 : hwOut + 5.5;
      for (const sd of [-1, 1]) { const row = [];
        for (const s of S) { const [x, z] = offP(s, A.off * sd); const a = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const q = PG.get(key(Math.floor(x / 30) + i, Math.floor(z / 30) + j)); if (q) for (const it of q) a.push(it); }
          for (const [k, e] of a) { if (e.ssRow) continue; const dx = e[0] - s.x, dz = e[2] - s.z; const along = dx * s.ux + dz * s.uz, across = -dx * s.uz + dz * s.ux; const ac = across * sd; if (Math.abs(along) > 1.01 || ac < lo || ac > hi) continue; if (inArr(e[0], e[2], 2)) continue; e.ssRow = 1; row.push({ k, e, d: s.d + along }); } }
        row.sort((p, q) => p.d - q.d); for (const r of row) delete r.e.ssRow;
        for (let i = 0; i < row.length - 1; i++) { const p = row[i], q = row[i + 1]; const gap = q.d - p.d; if (gap < 7 || gap > 26) continue; SS.spans.push({ a: p, b: q, kind: "row", id: A.id }); cnt("spansRow"); }
        A.prow = A.prow || {}; A.prow[sd] = row; }
      if (ZIG.has(A.id) && !posts.has(A.id) && A.prow) { const l = A.prow[-1] || [], r = A.prow[1] || []; const all = l.map((p) => Object.assign({ sd: -1 }, p)).concat(r.map((p) => Object.assign({ sd: 1 }, p))).sort((p, q) => p.d - q.d);
        for (let i = 0; i < all.length - 1; i++) { const p = all[i], q = all[i + 1]; if (p.sd === q.sd) continue; if (q.d - p.d > 16) continue; SS.spans.push({ a: p, b: q, kind: "zig", id: A.id }); cnt("spansZig"); } } } }
  // the point on a palm's trunk at height h (world), toward (tx, tz): the trunk centre measured from the model at that height
  const TRUNK = new Map();
  function trunkLocal(kind, hl) { const kk = kind + ":" + hl.toFixed(1); if (TRUNK.has(kk)) return TRUNK.get(kk); const m = MODELS[kind]; let best = null;
    try { const part = m.parts.find((p) => /trunk/i.test(p.material && p.material.name || "")) || m.parts[0]; const pa = part.geometry.attributes.position; let sx = 0, sz = 0, n = 0, r = 0; const pts = [];
      for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); if (Math.abs(y - hl) < 0.3) { sx += pa.getX(i); sz += pa.getZ(i); n++; pts.push([pa.getX(i), pa.getZ(i)]); } }
      if (n) { sx /= n; sz /= n; for (const p of pts) r = Math.max(r, Math.hypot(p[0] - sx, p[1] - sz)); best = [sx, sz, Math.min(r, 0.45)]; } } catch (e) {}
    best = best || [0, 0, 0.2]; TRUNK.set(kk, best); return best; }
  function attach(p, tx, tz, y0) { const e = p.e; const s = e[4]; const hl = STR_H / s; const [lx, lz, r] = trunkLocal(p.k, hl); const c = Math.cos(e[3]), sn = Math.sin(e[3]); const wx = e[0] + (lx * c + lz * sn) * s, wz = e[2] + (-lx * sn + lz * c) * s;
    const dx = tx - wx, dz = tz - wz, L = Math.hypot(dx, dz) || 1; const rr = r * s + 0.03; return [wx + dx / L * rr, y0 + STR_H, wz + dz / L * rr]; }

  // ───────────────────────── DEFER: seat the railings, hang the festoons ─────────────────────────
  function seatRails() { const q = new THREE.Quaternion(), qz = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), zA = new THREE.Vector3(0, 0, 1); let n = 0;
    for (const run of SS.rails) { for (const e of run.panels) { const ya = surf(e.ssA[0], e.ssA[1]), yb = surf(e.ssB[0], e.ssB[1]); const L = Math.hypot(e.ssB[0] - e.ssA[0], e.ssB[1] - e.ssA[1]) || PANEL; const pitch = clamp(Math.atan2(yb - ya, L), -0.18, 0.18);
        q.setFromAxisAngle(up, e[3]); qz.setFromAxisAngle(zA, pitch); q.multiply(qz); e.q = [q.x, q.y, q.z, q.w]; const yc = surf(e[0], e[2]); const y = clamp((ya + yb) / 2, yc - 0.06, yc + 0.04); planSeatEntry("ss_rail", e, y); e.seated = true;
        const sd = addSolid(e[0], e[2], e[3], PANEL + 0.1, 0.3, y - 0.2, y + RAIL_H, "world"); if (sd) sd.ss = 1; n++; }
      for (const e of run.pillars) { const y = surf(e[0], e[2]); planSeatEntry("e1_pillar", e, y - 0.02); e.seated = true; } }
    SS.n.railSeated = n; }
  const BUL = { cells: new Map(), C: 64, inst: null, cap: 0, lastX: 1e9, lastZ: 1e9, n: 0, total: 0, mine: [], wire: null, halo: null };
  function hang(a, b) { const L = Math.hypot(b[0] - a[0], b[2] - a[2]); if (L < 3 || L > 28) return; const sag = Math.min(1.15, 0.4 + L * 0.036); const m = Math.max(4, Math.round(L / 1.0)); let prev = null;
    for (let k = 0; k <= m; k++) { const t = k / m; const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t]; if (prev) BUL.wire.push(prev[0], prev[1], prev[2], p[0], p[1], p[2]); prev = p; }
    const nb = Math.floor(L / BULB_STEP); for (let k = 1; k < nb; k++) { const t = k / nb; BUL.mine.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag - 0.08, a[2] + (b[2] - a[2]) * t); } cnt("spansHung"); }
  function hangAll() { BUL.wire = []; BUL.mine = [];
    for (const s of SS.spans) { try { const ea = s.a.e, eb = s.b.e; const ya = ea.seated ? ea[1] : surf(ea[0], ea[2]), yb = eb.seated ? eb[1] : surf(eb[0], eb[2]); const pa = attach(s.a, eb[0], eb[2], ya), pb = attach(s.b, ea[0], ea[2], yb); hang(pa, pb); } catch (e) { note("hang", e); } }
    const E = window.PLAN_ENRICH; if (BUL.mine.length) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(BUL.mine, 3)); g.computeBoundingSphere();
      if (E && E.halo) { BUL.halo = new THREE.Points(g, E.halo.material); } else BUL.halo = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.05, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd9a0 }));
      BUL.halo.userData.noInst = true; BUL.halo.visible = false; BUL.halo.frustumCulled = true; scene.add(BUL.halo);
      const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(BUL.wire, 3)); wg.computeBoundingSphere(); const wm = E && E.wire ? E.wire.material : new THREE.LineBasicMaterial({ color: 0x1a1612 }); const W = new THREE.LineSegments(wg, wm); W.userData.noInst = true; scene.add(W); BUL.wireMesh = W; }
    SS.n.bulbsMine = BUL.mine.length / 3; }
  // every bulb (plan_enrich's and these) into 64 m cells; the instanced globes are refilled from the cells within range
  function bulbCells() { const add = (arr) => { for (let i = 0; i < arr.length; i += 3) { const k = key(Math.floor(arr[i] / BUL.C), Math.floor(arr[i + 2] / BUL.C)); let a = BUL.cells.get(k); if (!a) BUL.cells.set(k, (a = [])); a.push(arr[i], arr[i + 1], arr[i + 2]); BUL.total++; } };
    const E = window.PLAN_ENRICH; if (ON.bulb && E && E.bulbs && E.bulbs.geometry) { add(E.bulbs.geometry.attributes.position.array); E.bulbs.visible = false; SS.n.bulbsEnrich = E.bulbs.geometry.attributes.position.count; }
    add(BUL.mine); for (const [k, a] of BUL.cells) BUL.cells.set(k, new Float32Array(a));
    if (!BUL.total) return; const t = tier(); BUL.R = t === "ultra" ? 300 : 220; BUL.cap = t === "ultra" ? 9000 : 6000;
    const g = new THREE.IcosahedronGeometry(0.06, 0); const mat = M.lampGlow; const inst = new THREE.InstancedMesh(g, mat, BUL.cap); inst.count = 0; inst.frustumCulled = false; inst.castShadow = false; inst.receiveShadow = false; inst.userData.noInst = true; inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const arr = inst.instanceMatrix.array; for (let i = 0; i < BUL.cap; i++) { const o = i * 16; arr[o] = 1; arr[o + 5] = 1; arr[o + 10] = 1; arr[o + 15] = 1; } scene.add(inst); BUL.inst = inst; }
  function bulbRefill(force) { const I = BUL.inst; if (!I) return; const cx = camera.position.x, cz = camera.position.z; if (!force && Math.hypot(cx - BUL.lastX, cz - BUL.lastZ) < 12) return; BUL.lastX = cx; BUL.lastZ = cz;
    const arr = I.instanceMatrix.array; const R = BUL.R * (QUAL && QUAL.q ? Math.max(0.6, QUAL.q.range || 1) : 1), R2 = R * R, n0 = Math.ceil(R / BUL.C); const gx = Math.floor(cx / BUL.C), gz = Math.floor(cz / BUL.C); let n = 0;
    const near = []; for (let i = -n0; i <= n0; i++) for (let j = -n0; j <= n0; j++) { const a = BUL.cells.get(key(gx + i, gz + j)); if (!a) continue; const ccx = (gx + i + 0.5) * BUL.C - cx, ccz = (gz + j + 0.5) * BUL.C - cz; const d2 = ccx * ccx + ccz * ccz; if (d2 > (R + BUL.C) * (R + BUL.C)) continue; near.push([d2, a]); }
    near.sort((p, q) => p[0] - q[0]);   // nearest cells first, so a full pool drops the far bulbs, never the near ones
    for (const [, a] of near) { if (n >= BUL.cap) break;
      for (let k = 0; k < a.length && n < BUL.cap; k += 3) { const dx = a[k] - cx, dz = a[k + 2] - cz; if (dx * dx + dz * dz > R2) continue; const o = n * 16; arr[o + 12] = a[k]; arr[o + 13] = a[k + 1]; arr[o + 14] = a[k + 2]; n++; } }
    I.count = n; I.visible = n > 0 && !(typeof inside !== "undefined" && inside); I.instanceMatrix.needsUpdate = true; if (I.instanceMatrix.updateRanges) { I.instanceMatrix.clearUpdateRanges(); I.instanceMatrix.addUpdateRange(0, n * 16); } BUL.n = n; }

  // ───────────────────────── hooks ─────────────────────────
  if (OFF) return;
  H.world.push({ name: "ssWorld", fn: function () { if (!window.PLAN) return; try { if (!PLAN_MODE) return; } catch (e) { return; }
      // the layout runs as a terrain hook queued here, after the fill modules' (they queue theirs in their world hooks); the palm swap
      // is queued from it, so it is the very last terrain hook (after plan_flora's), right before the engine instances
      H.terrain.push({ name: "ssTerrain", fn: function () { step("layout", layout); H.terrain.push({ name: "ssSwap", fn: function () { if (ON.palm) step("swap", swapPalms); } }); } }); } });
  H.defer.push({ name: "ssDefer", fn: function () { if (ON.rail) step("seatRails", seatRails); if (ON.str && SS.spans.length) step("hang", hangAll); if (tier() === "high" || tier() === "ultra") step("bulbs", bulbCells); SS.ready = true; } });
  let fr = 0; H.frame.push({ name: "ssFrame", fn: function () { if (!SS.ready || SS.abOn === false) return; fr++; if (fr % 10 !== 3) return; try { bulbRefill(fr === 3); const E = window.PLAN_ENRICH; if (BUL.halo) BUL.halo.visible = !!(E && E.halo ? E.halo.visible : night > 0.25); if (BUL.inst && typeof inside !== "undefined") BUL.inst.visible = BUL.n > 0 && !inside; } catch (e) { note("frame", e); } } });
  // debug and A/B: hide or show everything this module added (the palm swap stays: it happens before instancing)
  SS.ab = function (on) { const mt = new THREE.Matrix4(); let n = 0; for (const k in PLACE) for (const e of PLACE[k]) if (e.ss) { e.hide = !on; n++; } for (const S of INSTSET) { if (!S.list.some((e) => e.ss)) continue; S.list.forEach((e, i) => { if (e.ss) instMatrix(e, MODELS[S.kind], mt).toArray(S.mats, i * 16); }); S.n = -1; S.nf = -1; S.nf2 = -1; }
    if (BUL.wireMesh) BUL.wireMesh.visible = on; SS.abOn = on; if (!on) { if (BUL.inst) BUL.inst.visible = false; if (BUL.halo) BUL.halo.visible = false; } const E = window.PLAN_ENRICH; if (E && E.bulbs && ON.bulb) E.bulbs.visible = !on; try { updateCulling(true); } catch (e) {} return n; };
  SS.stat = function () { return { n: SS.n, t: SS.t, errs: SS.errs, bulbs: { total: BUL.total, near: BUL.n, cap: BUL.cap }, rails: SS.rails.length, spans: SS.spans.length, allees: SS.allees.map((a) => a.id + ":" + a.n) }; };
  SS._ = { BUL, spotOK, airOK, occHit, solidHit, doorHit };
})();
