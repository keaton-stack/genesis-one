// R15: filling the empty spaces of Stage Three, The Expanse (R15 agent E2, fill B, 5 Oct 2026).
// Classic script, loaded before client.js; one IIFE, nothing at top level; client globals by bare name at call time. PLAN mode only.
// The user: too much empty space between the places, "walking in a random area not attached to anything". This module composes
// designed spaces in the gaps of the S3_* districts and the land east of x 250 (outside every district), from plan/fill_b.json:
//   world    queue the main pass after every other terrain hook (plan_land's included), so everything it must avoid already exists
//   terrain  1. an occupancy raster (1 m) of my region: buildings, roads and paths, plazas, keep-out polygons and circles, venues,
//              colliders, solids, every module mesh and instanced piece already in the scene, every engine placement, the runway
//              (44 m) and taxiways (17 m). Agent A's PLAN_PATHS.near is asked too when it exists.
//            2. each site of fill_b.json, in priority order, is composed from its program (bosque, fountain, windmill, grove,
//              hammock, stargaze, firepit, garden, sculpture, artgarden, labyrinth, waterwall, pergola, trail, lookout, stand,
//              moon, bermgrove): trees and plants as engine placements of the installed kinds (instanced, culled, LOD'd and
//              seated by the engine), furniture through plan_land's kinds (benches, lanterns, ramadas, fire rings: their beds,
//              lantern glow, seats and fire light are built by plan_land's defer pass, merged, no new draws), and my own pieces
//              (chess tables, hammocks, the dry stock tank, bleachers, the lookout deck, fountains, runnel, water wall, signs,
//              recliners, the labyrinth, corten ring) recorded for the defer pass. Every element is checked against the raster;
//              a site ties to the nearest walk with a short gravel spur. Low berms (bermgrove, lookout) are graded here, never
//              under anything built.
//   defer    my pieces at their final heights, merged per site and material (a handful of draws per site, hidden past 260 m),
//            their colliders and seats, the talk cards, the roaming people at the two hangouts (PLAN_ROAM areas).
//   frame    water ripple and night glow of the signs and the fountain lamps (no real lights).
// ?fillb=0 turns the module off. window.PLAN_FILL_B: n (counters), t (timings), errs, sites (what each site placed), debug.
(function () {
  "use strict";
  if (window.PLAN_FILL_B) return;
  window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
  const HK = window.PLAN_HOOKS;
  const FB = window.PLAN_FILL_B = { v: 1, errs: [], n: {}, t: {}, sites: [], pieces: [], spurs: [], groups: [], roam: [], off: /[?&]fillb=0\b/.test(location.search) };
  if (FB.off) return;
  const err = (where, e) => { if (FB.errs.length < 40) FB.errs.push(where + ": " + ((e && e.message) || e)); if (FB.errs.length <= 6) console.warn("plan_fill_b " + where + " failed:", (e && e.stack) || e); };
  const cnt = (k, n) => { FB.n[k] = (FB.n[k] || 0) + (n === undefined ? 1 : n); };
  const PI = Math.PI, TAU = PI * 2;

  // ───────────── config: plan/fill_b.json ─────────────
  let CFG = null;
  const au = (u) => { try { return window.AV ? window.AV(u) : u; } catch (e) { return u; } };
  const cfgUrl = () => au("/plan/fill_b.json?v=" + (window.BUILD || "dev"));
  try { fetch(cfgUrl()).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && !CFG) CFG = FB.cfg = d; }).catch((e) => err("cfg fetch", e)); } catch (e) { err("cfg", e); }
  function cfg() { if (CFG) return CFG; try { const x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = FB.cfg = JSON.parse(x.responseText); } catch (e) { err("cfg sync", e); } return CFG; }

  // ───────────── small maths ─────────────
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  let R = mulberry(20261005); const rr = (a, b) => a + R() * (b - a);
  const has = (k) => !!(typeof MODELS !== "undefined" && MODELS[k] && MODEL_SPECS[k]);
  const segD = (x, z, ax, az, bx, bz) => { const vx = bx - ax, vz = bz - az; const L2 = vx * vx + vz * vz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)); return Math.hypot(x - (ax + vx * t), z - (az + vz * t)); };
  const pick = (a) => a[Math.floor(R() * a.length)];
  const firstOf = (list) => { for (const k of list) if (has(k)) return k; return null; };

  // ───────────── the occupancy raster (1 m cells over my region) ─────────────
  const G = { X0: -380, Z0: -660, X1: 1180, Z1: 1020, C: 1 }; G.nx = Math.ceil((G.X1 - G.X0) / G.C); G.nz = Math.ceil((G.Z1 - G.Z0) / G.C);
  const HARD = 1, SOFT = 2, MINE = 4, RWY = 8, PLANT = 16, OUT = 32, PATHB = 64;
  let RA = null;
  const cI = (x) => Math.floor((x - G.X0) / G.C), cJ = (z) => Math.floor((z - G.Z0) / G.C);
  const cK = (x, z) => { const i = cI(x), j = cJ(z); if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) return -1; return j * G.nx + i; };
  const bitsAt = (x, z) => { const k = cK(x, z); return k < 0 ? OUT : RA[k]; };
  function mCircle(b, x, z, r) { const i0 = Math.max(0, cI(x - r)), i1 = Math.min(G.nx - 1, cI(x + r)), j0 = Math.max(0, cJ(z - r)), j1 = Math.min(G.nz - 1, cJ(z + r)); const r2 = r * r; for (let j = j0; j <= j1; j++) { const dz = G.Z0 + (j + 0.5) * G.C - z; for (let i = i0; i <= i1; i++) { const dx = G.X0 + (i + 0.5) * G.C - x; if (dx * dx + dz * dz <= r2) RA[j * G.nx + i] |= b; } } }
  function mSeg(b, ax, az, bx, bz, r) { const i0 = Math.max(0, cI(Math.min(ax, bx) - r)), i1 = Math.min(G.nx - 1, cI(Math.max(ax, bx) + r)), j0 = Math.max(0, cJ(Math.min(az, bz) - r)), j1 = Math.min(G.nz - 1, cJ(Math.max(az, bz) + r)); if ((i1 - i0) * (j1 - j0) > 4e6) return; for (let j = j0; j <= j1; j++) { const z = G.Z0 + (j + 0.5) * G.C; for (let i = i0; i <= i1; i++) { const x = G.X0 + (i + 0.5) * G.C; if (segD(x, z, ax, az, bx, bz) <= r) RA[j * G.nx + i] |= b; } } }
  function mObb(b, x, z, yaw, hw, hd) { const Rr = Math.hypot(hw, hd); const c = Math.cos(yaw), s = Math.sin(yaw); const i0 = Math.max(0, cI(x - Rr)), i1 = Math.min(G.nx - 1, cI(x + Rr)), j0 = Math.max(0, cJ(z - Rr)), j1 = Math.min(G.nz - 1, cJ(z + Rr)); for (let j = j0; j <= j1; j++) { const dz = G.Z0 + (j + 0.5) * G.C - z; for (let i = i0; i <= i1; i++) { const dx = G.X0 + (i + 0.5) * G.C - x; const lx = dx * c - dz * s, lz = dx * s + dz * c; if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) RA[j * G.nx + i] |= b; } } }
  function mRect(b, x0, x1, z0, z1) { const i0 = Math.max(0, cI(x0)), i1 = Math.min(G.nx - 1, cI(x1)), j0 = Math.max(0, cJ(z0)), j1 = Math.min(G.nz - 1, cJ(z1)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) RA[j * G.nx + i] |= b; }
  function mPoly(b, poly, pad) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const q of poly) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); } const i0 = Math.max(0, cI(x0 - pad)), i1 = Math.min(G.nx - 1, cI(x1 + pad)), j0 = Math.max(0, cJ(z0 - pad)), j1 = Math.min(G.nz - 1, cJ(z1 + pad)); for (let j = j0; j <= j1; j++) { const z = G.Z0 + (j + 0.5) * G.C; for (let i = i0; i <= i1; i++) { const x = G.X0 + (i + 0.5) * G.C; if (planInPoly(poly, x, z)) RA[j * G.nx + i] |= b; } } }
  const NATURAL = /^(bush\d|barrel_cactus|ocotillo|agave_cluster|prickly_pear|saguaro|saguaro_(young|mid|giant)|cholla|yucca_cluster|organ_pipe|ph_|land_(sagy|cholla|barrel|pear|organ|rock|rrock))/;
  function buildRaster() { const t0 = performance.now(); RA = new Uint8Array(G.nx * G.nz);
    // outside my region (not S3 and west of x 250, the Arrivals zone, the land's edge), every 4 m then copied to the block
    for (let j = 0; j < G.nz; j += 4) for (let i = 0; i < G.nx; i += 4) { const x = G.X0 + (i + 2) * G.C, z = G.Z0 + (j + 2) * G.C; const d = planDistrictAt(x, z); let out = d ? !/^S3_/.test(d.id) : x < 250; if (x > -74 && x < 274 && z > -264 && z < 79) out = true; if (x < T.xmin + 24 || x > T.xmax - 24 || z < T.zmin + 24 || z > T.zmax - 24) out = true; if (!out) continue; for (let dj = 0; dj < 4 && j + dj < G.nz; dj++) for (let di = 0; di < 4 && i + di < G.nx; di++) RA[(j + dj) * G.nx + i + di] |= OUT; }
    // the runway (44 m) and the taxiways (17 m)
    try { const rw = SITE.runway; for (let k = 0; k < rw.length - 1; k++) mSeg(RWY, rw[k][0], rw[k][1], rw[k + 1][0], rw[k + 1][1], 44); } catch (e) { err("raster runway", e); }
    try { for (const tw of SITE.taxiways || []) { const p = tw && tw.pts ? tw.pts : tw; if (!Array.isArray(p) || !Array.isArray(p[0])) continue; for (let k = 0; k < p.length - 1; k++) mSeg(RWY, p[k][0], p[k][1], p[k + 1][0], p[k + 1][1], 17); } } catch (e) { err("raster taxiways", e); }
    // roads, promenades, every ribbon (+0.8 m): never built on
    for (const r of ROADS) { const p = r.pts; if (!p) continue; for (let k = 0; k < p.length - 1; k++) mSeg(HARD | PATHB, p[k][0], p[k][1], p[k + 1][0], p[k + 1][1], (r.w || 4) / 2 + 0.8); }
    for (const p of PLAZAS) mCircle(HARD, p[0], p[1], p[2] + 1);
    for (const kp of PLAN_KEEP_POLY) mPoly(HARD, kp.poly, 1.5);
    { const open = (PLAN.places || []).filter((q) => /^(design_district|commons|glamping|flagship|genesis_lodge|frontier_ranches|homestead_domes|fireside|fountain_court|corral)$/.test(q.id)); for (const k of KEEPOUT) { if (open.some((q) => Math.abs(q.x - k[0]) < 0.6 && Math.abs(q.z - k[1]) < 0.6)) continue; mCircle(SOFT, k[0], k[1], k[2] * 0.92); } }
    try { for (const f of PLAN_IDX.fount.values()) mCircle(HARD, f.x, f.z, (f._r || 4) + 2.5); } catch (e) {}
    // places with a use keep their middle (landmarks, plazas, attractions): soft
    const OPEN = new Set(["design_district", "commons", "glamping", "flagship", "genesis_lodge", "frontier_ranches", "homestead_domes", "fireside", "fountain_court", "sunset_bluff", "mesa_heights", "north_mesa", "corral"]);
    for (const q of PLAN.places || []) { if (q.status === "cut" || OPEN.has(q.id)) continue; if (/^(landmark|plaza|attraction|arrival|civic)$/.test(q.type)) mCircle(SOFT, q.x, q.z, (q.r || 10) * 0.8 + 3); }
    // engine placements: buildings and their fronts are hard, props hard where they stand, natural plants their own cell
    for (const kind in PLACE) { const sp = MODEL_SPECS[kind], m = MODELS[kind]; if (!sp || !m) continue; const list = PLACE[kind];
      if (!sp.prop && !sp.vehicle) { for (const e of list) { mObb(HARD, e[0], e[2], e[3], (m.sx || m.radius * 2) * e[4] / 2 + 2, (m.sz || m.radius * 2) * e[4] / 2 + 2); mCircle(HARD, e[0] + Math.sin(e[3]) * (m.radius * e[4] + 3), e[2] + Math.cos(e[3]) * (m.radius * e[4] + 3), 4); } continue; }
      const nat = NATURAL.test(kind); for (const e of list) { if (e.hide) continue; const rad = Math.max(0.5, Math.min(nat ? 1.6 : 3.5, m.radius * e[4] * (nat ? 0.55 : 0.75))); mCircle(nat ? PLANT : HARD, e[0], e[2], rad); } }
    for (const c of COLLIDERS) { if (c[2] > 40) continue; mCircle(PLANT, c[0], c[1], c[2] + 0.3); if (c[2] >= 1.4) mCircle(HARD, c[0], c[1], c[2] + 0.5); }
    for (const s of SOLIDS) { if (/^aijet/.test(s.tag || "")) continue; if (Math.hypot(s.hw, s.hd) > 70) continue; mObb(HARD, s.x, s.z, s.ry || 0, s.hw + 0.6, s.hd + 0.6); }
    // module meshes already in the scene (venues, set pieces, signs, fences, beds...)
    scanScene(); FB.t.raster = Math.round(performance.now() - t0); }
  function scanScene() { const t0 = performance.now(); const v = new THREE.Vector3(), bb = new THREE.Box3(), mt = new THREE.Matrix4(); let n = 0;
    scene.updateMatrixWorld(true); const inBox = (x, z) => x > G.X0 && x < G.X1 && z > G.Z0 && z < G.Z1;
    const instOf = new Set(); try { for (const S of INSTSET) { for (const im of S.insts || []) instOf.add(im); for (const im of S.far || []) instOf.add(im); for (const im of S.far2 || []) instOf.add(im); } } catch (e) {}
    scene.traverse((o) => { if (o === scene || o.isLight || o.isSkinnedMesh || o.isSprite || o.isPoints || o.isLine || !o.isMesh) return; if (o.userData && (o.userData.landSkip || o.userData.fbSkip)) return; const g = o.geometry; if (!g || !g.attributes || !g.attributes.position) return;
      if (o.isInstancedMesh) { if (instOf.has(o)) return; if (!g.boundingSphere) g.computeBoundingSphere(); const r0 = g.boundingSphere.radius; const c = Math.min(o.count, 40000); for (let i = 0; i < c; i++) { o.getMatrixAt(i, mt); mt.premultiply(o.matrixWorld); v.copy(g.boundingSphere.center).applyMatrix4(mt); if (!inBox(v.x, v.z)) continue; const s = mt.getMaxScaleOnAxis(); const rad = Math.min(25, r0 * s); const gy = getH(v.x, v.z); if (v.y - rad > gy + 30) continue; mCircle(HARD, v.x, v.z, Math.max(0.6, rad * 0.85 + 0.4)); } n++; return; }
      if (!g.boundingBox) g.computeBoundingBox(); bb.copy(g.boundingBox).applyMatrix4(o.matrixWorld); if (!isFinite(bb.min.x) || !isFinite(bb.max.x)) return; const w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z; if (w > 1500 || d > 1500) return;
      if (bb.max.x < G.X0 || bb.min.x > G.X1 || bb.max.z < G.Z0 || bb.min.z > G.Z1) return; const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2; const gy = getH(cx, cz); if (bb.min.y > gy + 30 || bb.max.y < gy - 25) return; n++;
      if (w < 16 && d < 16) { mRect(HARD, bb.min.x - 0.8, bb.max.x + 0.8, bb.min.z - 0.8, bb.max.z + 0.8); return; }
      // large meshes (venue grounds, long fences): every triangle where it really is
      const p = g.attributes.position, ix = g.index ? g.index.array : null, mw = o.matrixWorld.elements; const F = (ix ? ix.length : p.count) / 3; const st = Math.max(1, Math.floor(F / 60000)); const P3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      const W = (k, o3) => { const x = p.getX(k), y = p.getY(k), z = p.getZ(k); P3[o3] = mw[0] * x + mw[4] * y + mw[8] * z + mw[12]; P3[o3 + 1] = mw[1] * x + mw[5] * y + mw[9] * z + mw[13]; P3[o3 + 2] = mw[2] * x + mw[6] * y + mw[10] * z + mw[14]; };
      for (let f = 0; f < F; f += st) { W(ix ? ix[f * 3] : f * 3, 0); W(ix ? ix[f * 3 + 1] : f * 3 + 1, 3); W(ix ? ix[f * 3 + 2] : f * 3 + 2, 6); const tx = (P3[0] + P3[3] + P3[6]) / 3, tz = (P3[2] + P3[5] + P3[8]) / 3; if (!inBox(tx, tz)) continue; const gy2 = getH(tx, tz); if (Math.min(P3[1], P3[4], P3[7]) > gy2 + 30) continue; const tr = Math.max(Math.hypot(P3[0] - tx, P3[2] - tz), Math.hypot(P3[3] - tx, P3[5] - tz), Math.hypot(P3[6] - tx, P3[8] - tz)); mCircle(HARD, tx, tz, Math.min(12, tr) + 0.8); } });
    FB.n.scanObjects = n; FB.t.scan = Math.round(performance.now() - t0); }
  // a free spot of radius r for what kind of thing: "low" plants may stand on soft ground and next to natural plants
  let CUR = null; const no = (w) => { if (CUR) CUR.why[w] = (CUR.why[w] || 0) + 1; return false; };
  const BITN = [[HARD, "built"], [MINE, "mine"], [RWY, "runway"], [OUT, "out"], [SOFT, "keepout"], [PLANT, "plant"]];
  const why = (b) => { for (const [m, n] of BITN) if (b & m) return n; return "?"; };
  function spotOK(x, z, r, lvl) { const k = cK(x, z); if (k < 0) return no("out"); const bad = HARD | MINE | RWY | OUT | (lvl === "low" || CUR ? 0 : SOFT) | (lvl === "low" ? 0 : PLANT); const c0 = RA[k] & (bad | (lvl === "low" ? PLANT : 0)); if (c0) return no(why(c0));
    const n = r > 1.5 ? 12 : 8; for (let q = 0; q < n; q++) { const a = q / n * TAU; const b = bitsAt(x + Math.cos(a) * r, z + Math.sin(a) * r); if (b & bad) return no(why(b & bad)); }
    try { if (window.PLAN_PATHS && typeof PLAN_PATHS.near === "function" && PLAN_PATHS.near(x, z, r + 0.6)) return no("paths"); } catch (e) {}
    if (lvl !== "low") { if (planNearRoad(x, z, r + 0.6)) return no("road"); if (planNearCollider(x, z, Math.max(0.2, r * 0.6))) return no("collider"); }
    return planPolyBlocked(x, z) ? no("poly") : true; }
  // a designed site replaces the random scatter inside it: the natural plants (shrubs, cacti, rocks) within its radius are taken
  // out before it is composed (their colliders too), so the composition is not dodging a hundred stray shrubs
  function clearSeg(ax, az, bx, bz, w) { const gone = new Set(); for (const kind in PLACE) { if (!NATURAL.test(kind)) continue; const L = PLACE[kind]; for (let i = L.length - 1; i >= 0; i--) { const e = L[i]; if (e.fb) continue; if (segD(e[0], e[2], ax, az, bx, bz) > w) continue; gone.add(Math.round(e[0] * 100) + "," + Math.round(e[2] * 100)); L.splice(i, 1); } }
    if (gone.size) for (let i = COLLIDERS.length - 1; i >= 0; i--) { const c = COLLIDERS[i]; if (gone.has(Math.round(c[0] * 100) + "," + Math.round(c[1] * 100))) COLLIDERS.splice(i, 1); } cnt("clearedPath", gone.size); return gone.size; }
  function clearScatter(s, r) { let n = 0; const r2 = r * r; const gone = new Set(); for (const kind in PLACE) { if (!NATURAL.test(kind)) continue; const L = PLACE[kind]; for (let i = L.length - 1; i >= 0; i--) { const e = L[i]; const dx = e[0] - s.x, dz = e[2] - s.z; if (dx * dx + dz * dz > r2) continue; if (e.fb) continue; gone.add(Math.round(e[0] * 100) + "," + Math.round(e[2] * 100)); L.splice(i, 1); n++; } }
    if (gone.size) { for (let i = COLLIDERS.length - 1; i >= 0; i--) { const c = COLLIDERS[i]; if (Math.hypot(c[0] - s.x, c[1] - s.z) > r + 0.1) continue; if (gone.has(Math.round(c[0] * 100) + "," + Math.round(c[1] * 100))) COLLIDERS.splice(i, 1); } }
    const i0 = Math.max(0, cI(s.x - r)), i1 = Math.min(G.nx - 1, cI(s.x + r)), j0 = Math.max(0, cJ(s.z - r)), j1 = Math.min(G.nz - 1, cJ(s.z + r)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const dx = G.X0 + (i + 0.5) * G.C - s.x, dz = G.Z0 + (j + 0.5) * G.C - s.z; if (dx * dx + dz * dz <= r2) RA[j * G.nx + i] &= ~PLANT; }
    s.cleared = n; cnt("cleared", n); return n; }
  const mine = (x, z, r) => mCircle(MINE, x, z, r);

  // ───────────── placing ─────────────
  function placeKind(kind, x, z, yaw, s, site, o) { o = o || {}; if (!has(kind)) return null; const m = MODELS[kind]; const rad = o.rad !== undefined ? o.rad : Math.max(0.35, Math.min(3, m.radius * s * (o.lvl === "low" ? 0.45 : 0.55)));
    if (!o.force && !spotOK(x, z, rad, o.lvl)) return null; put(kind, x, z, yaw, s); const e = PLACE[kind][PLACE[kind].length - 1]; e.keep = true; e.fb = 1; mine(x, z, Math.max(rad, o.gap || 0)); if (site) site.n++; cnt("k_" + kind); cnt("placed"); FB.placed = (FB.placed || 0) + 1; return e; }
  // species: the installed kinds, sized for a designed planting
  const TREES = { mesquite: ["mesquite", 0.85, 1.2], paloverde: ["paloverde", 0.75, 1.0], ironwood: ["ironwood", 0.7, 0.95], willow: ["desertwillow", 0.8, 1.05] };
  function tree(sp, x, z, site, o) { const t = TREES[sp]; if (!t || !has(t[0])) return null; return placeKind(t[0], x, z, R() * TAU, rr(t[1], t[2]) * ((o && o.sk) || 1), site, Object.assign({ rad: 1.6 }, o || {})); }
  function accent(sp, x, z, site, o) { o = o || {}; let k = null, s = 1;
    switch (sp) {
      case "agave": k = firstOf(["agave_cluster"]); s = rr(0.75, 1.15); break;
      case "yucca": k = firstOf(["yucca_cluster"]); s = rr(0.7, 1.0); break;
      case "barrel": k = firstOf(["barrel_cactus"]); s = rr(0.8, 1.25); break;
      case "pear": k = firstOf(["prickly_pear"]); s = rr(0.8, 1.2); break;
      case "ocotillo": k = firstOf(["ocotillo"]); s = rr(0.8, 1.2); break;
      case "grass": k = firstOf(["bush2"]); s = rr(0.45, 0.75); break;
      case "shrub": k = R() < 0.4 ? firstOf(["ph_shrub_3", "ph_shrub_1"]) : firstOf(["bush1"]); s = k === "bush1" ? rr(0.5, 0.8) : rr(0.8, 1.2); break;
      case "succ": k = firstOf(["ph_succulent_2", "ph_succulent_1"]); s = rr(0.8, 1.2); break;
      case "sag_giant": k = firstOf(["saguaro_giant", "saguaro"]); s = k === "saguaro" ? rr(1.4, 1.7) : rr(0.8, 1.05); break;
      case "sag_mid": k = firstOf(["saguaro_mid", "saguaro"]); s = rr(0.85, 1.15); break;
      case "sag_young": k = firstOf(["saguaro_young"]); s = rr(0.8, 1.2); break;
      case "organ": k = firstOf(["organ_pipe"]); s = rr(0.8, 1.15); break;
      case "quiver": k = firstOf(["ph_quiver_1", "ph_quiver_2"]); s = rr(0.9, 1.15); break;
      case "boulder": k = pick(["ph_boulder_1", "ph_boulder_2", "ph_boulder_3", "ph_boulder_5"].filter(has)) || null; s = rr(0.8, 1.3); break;
      case "moonrock": k = pick(["ph_moonrock_1", "ph_moonrock_2", "ph_moonrock_4", "ph_moonrock_5"].filter(has)) || null; s = rr(0.9, 1.5); break;
      case "palm": k = firstOf(["e1_fanpalm2", "fanpalm2", "e1_datepalm", "datepalm"]); s = rr(0.85, 1.05); break;
    }
    if (!k) return null; const tall = /saguaro|palm|ocotillo|organ/.test(k); return placeKind(k, x, z, R() * TAU, s * (o.sk || 1), site, { lvl: tall || /boulder|moonrock/.test(sp) ? undefined : "low", rad: o.rad, force: o.force }); }
  // a drift: n plants of one species along a soft arc (the way a planted bed reads designed, not scattered)
  function drift(sp, x, z, ang, n, step, site, bend) { let k = 0; const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux; const L = (n - 1) * step; for (let i = 0; i < n; i++) { const t = i * step - L / 2; const off = (bend || 0) * (t * t / Math.max(1, L * L / 4) - 0.5) * 1.2; const px = x + ux * t + vx * off + rr(-0.3, 0.3), pz = z + uz * t + vz * off + rr(-0.3, 0.3); if (accent(sp, px, pz, site)) k++; } return k; }
  const LANDOK = () => !!(window.PLAN_LAND && Array.isArray(PLAN_LAND.beds) && Array.isArray(PLAN_LAND.lights) && Array.isArray(PLAN_LAND.seats));
  function bed(x, z, r, g, site) { if (!LANDOK()) return; PLAN_LAND.beds.push({ x, z, r, g: g || "dg", seed: Math.floor(R() * 1e6), pad: 1 }); if (site) site.beds++; cnt("beds"); }
  function bench(x, z, yaw, site, o) { if (!has("land_bench")) return null; const e = placeKind("land_bench", x, z, yaw, 1, site, Object.assign({ rad: 1.0 }, o || {})); if (e && LANDOK()) { PLAN_LAND.seats.push({ kind: "bench", e }); FB.seats = (FB.seats || 0) + 1; } return e; }
  function lantern(x, z, site, dark) { if (dark || !has("land_lantern")) return null; const e = placeKind("land_lantern", x, z, R() * TAU, 1, site, { rad: 0.35 }); if (e && LANDOK()) PLAN_LAND.lights.push({ e, s: 1, pool: 4.2 }); return e; }
  function ramada(x, z, yaw, site) { if (!has("land_ramada")) return null; if (!spotOK(x, z, 3.6)) return null; const e = placeKind("land_ramada", x, z, yaw, 1, site, { rad: 3.6, force: true }); if (!e) return null; const c = Math.cos(yaw), s = Math.sin(yaw); for (const [lx, lz] of (PLAN_LAND && PLAN_LAND.ramadaPosts) || [[-2.4, -1.8], [2.4, -1.8], [-2.4, 1.8], [2.4, 1.8]]) COLLIDERS.push([x + lx * c + lz * s, z - lx * s + lz * c, 0.22]); if (LANDOK()) PLAN_LAND.seats.push({ kind: "ramada", e }); return e; }
  function fireRing(x, z, site) { if (!has("land_firering") || !spotOK(x, z, 1.6)) return null; const e = placeKind("land_firering", x, z, R() * TAU, 1, site, { rad: 1.6, force: true }); if (e) { try { const poly = []; for (let q = 0; q < 10; q++) { const a = q / 10 * TAU; poly.push([x + Math.cos(a) * 1.5, z + Math.sin(a) * 1.5]); } planKeepout(poly); } catch (e2) { err("ring keep-out", e2); } } if (e && window.PLAN_LAND && Array.isArray(PLAN_LAND.fires)) PLAN_LAND.fires.push({ x, z }); return e; }
  // my own pieces (built in the defer pass at the final heights): { type, x, z, yaw, site, ... }
  function piece(type, x, z, yaw, site, r, o) { if (!(o && o.force) && !spotOK(x, z, r)) return null; const p = Object.assign({ type, x, z, yaw, site: site.id, r }, o || {}); FB.pieces.push(p); mine(x, z, r + 0.4); site.n++; cnt("p_" + type); return p; }
  // a gravel pad levelled to its centre (only where nothing is protected), for pieces that want flat ground
  function levelPad(cx, cz, Rr, edge) { try { const y = getH(cx, cz); planGrade(cx - Rr - edge, cx + Rr + edge, cz - Rr - edge, cz + Rr + edge, (x, z, h) => { const d = Math.hypot(x - cx, z - cz); if (d > Rr + edge) return h; const b = bitsAt(x, z); if (b & (HARD | RWY)) return h; let k = d < Rr ? 1 : 1 - (d - Rr) / edge; k = k * k * (3 - 2 * k); return h + (y - h) * k; }); } catch (e) { err("level", e); } }
  // a gentle berm (raised ground with a smooth falloff), never under anything protected; returns its peak
  function berm(cx, cz, rx, rz, ang, hgt) { try { const c = Math.cos(ang), s = Math.sin(ang); const Rm = Math.max(rx, rz) + 2; planGrade(cx - Rm, cx + Rm, cz - Rm, cz + Rm, (x, z, h) => { const dx = x - cx, dz = z - cz; const lx = dx * c + dz * s, lz = -dx * s + dz * c; const q = Math.hypot(lx / rx, lz / rz); if (q >= 1) return h; const b = bitsAt(x, z); if (b & (HARD | RWY | OUT)) return h; for (const [ox, oz] of [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) { if (bitsAt(x + ox, z + oz) & (HARD | RWY)) return h; } const k = 0.5 + 0.5 * Math.cos(Math.PI * q); return h + hgt * k; }); cnt("berms"); return true; } catch (e) { err("berm", e); return false; } }

  // ───────────── the walks: where a site ties in ─────────────
  let RECS = null;
  function walkRecs() { if (RECS) return RECS; const out = []; for (const r of ROADS) { if (!r.pts || r.pts.length < 2) continue; const rd = r.plan && PLAN_IDX.road.get(r.plan); const pr = r.plan && PLAN_IDX.prom.get(r.plan); if (rd && (rd.class === "taxilane" || /asphalt/.test(rd.surface || "") || rd.class === "perimeter")) continue; if (!rd && !pr && r.w > 8) continue; if (r.fbSpur || r.bed || r.e1bed || r.enrichBed || r.landSpur === undefined && r.pushed && r.e1bed) continue; out.push(r); } return (RECS = out); }
  function walksNear(x, z, maxD) { const by = new Map(); for (const r of walkRecs()) { const p = r.pts; for (let i = 0; i < p.length - 1; i++) { const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1]; if (Math.min(ax, bx) - maxD > x || Math.max(ax, bx) + maxD < x || Math.min(az, bz) - maxD > z || Math.max(az, bz) + maxD < z) continue; const vx = bx - ax, vz = bz - az; const L2 = vx * vx + vz * vz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)); const px = ax + vx * t, pz = az + vz * t; const d = Math.hypot(x - px, z - pz) - r.w / 2; if (d >= maxD) continue; const o = by.get(r); if (!o || d < o.d) by.set(r, { d, px, pz, r, ux: vx / Math.sqrt(L2), uz: vz / Math.sqrt(L2) }); } } return [...by.values()].sort((a, b) => a.d - b.d); }
  function nearestWalk(x, z, maxD) { let best = null; for (const r of walkRecs()) { const p = r.pts; for (let i = 0; i < p.length - 1; i++) { const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1]; if (Math.min(ax, bx) - maxD > x || Math.max(ax, bx) + maxD < x || Math.min(az, bz) - maxD > z || Math.max(az, bz) + maxD < z) continue; const vx = bx - ax, vz = bz - az; const L2 = vx * vx + vz * vz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)); const px = ax + vx * t, pz = az + vz * t; const d = Math.hypot(x - px, z - pz) - r.w / 2; if (d < maxD && (!best || d < best.d)) best = { d, px, pz, r, ux: vx / Math.sqrt(L2), uz: vz / Math.sqrt(L2) }; } } return best; }
  // a short gravel spur from the site's pad to the walk: planned (and its corridor reserved) before the program composes the
  // site, so nothing is planted on it; drawn as a ribbon afterwards, its ends tucked under the pad and the walk
  function planSpur(site, padR) { const wk = site.wk; if (!wk) return null; const x = site.x, z = site.z; const dx = wk.px - x, dz = wk.pz - z, D = Math.hypot(dx, dz); if (D < padR + 1.5) return { none: true }; const ux = dx / D, uz = dz / D; const end = D - wk.r.w / 2 + 0.5;
    for (let t = padR + 0.5; t < D - wk.r.w / 2 - 1.2; t += 1) { const px = x + ux * t, pz = z + uz * t; const b = bitsAt(px, pz); if (b & (RWY | OUT | MINE)) return null; if ((b & HARD) && !(b & PATHB)) return null; }
    clearSeg(x + ux * padR, z + uz * padR, x + ux * end, z + uz * end, 1.9); for (let t = padR + 0.5; t < D - wk.r.w / 2 - 1.2; t += 1.5) { if (planNearCollider(x + ux * t, z + uz * t, 0.8)) return null; }
    const sx = x + ux * (padR - 0.8), sz = z + uz * (padR - 0.8), ex = x + ux * end, ez = z + uz * end; mSeg(HARD | PATHB, x + ux * padR, z + uz * padR, ex, ez, 1.7); return { sx, sz, ex, ez, D, ux, uz, padR }; }
  function ribbon(pts, w, id) { try { const rec = planRibbon(pts, w, { mat: planMats().dg, lift: 0.14, tile: 3 }, id); if (rec) rec.fbSpur = true; return rec; } catch (e) { err("ribbon", e); return null; } }
  function buildSpur(site) { const q = site.spurPlan; if (!q || q.none) return false; if (!ribbon([[q.sx, q.sz], [q.ex, q.ez]], 2.0, "fb_spur_" + FB.spurs.length)) return false; FB.spurs.push([+q.sx.toFixed(1), +q.sz.toFixed(1), +q.ex.toFixed(1), +q.ez.toFixed(1), site.id]); site.spur = true; cnt("spurs");
    if (!site.dark && q.D > 10) { const nl = q.D > 24 ? 2 : 1; for (let i = 1; i <= nl; i++) { const t = q.padR + (q.D - q.padR) * i / (nl + 1); lantern(site.x + q.ux * t - q.uz * 1.8, site.z + q.uz * t + q.ux * 1.8, site); } }
    return true; }
  // a trail through a site (stations of a sculpture walk, the plant trail's loop): gravel ribbons between free points, reserved first
  function reserveTrail(pts) { const ok = []; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); let free = L > 1; for (let t = 1; t < L - 1 && free; t += 1) { const x = a[0] + (b[0] - a[0]) * t / L, z = a[1] + (b[1] - a[1]) * t / L; const bb = bitsAt(x, z); if ((bb & (HARD | RWY | OUT)) && !(bb & PATHB)) free = false; } if (free) { mSeg(HARD | PATHB, a[0], a[1], b[0], b[1], 1.5); ok.push([a, b]); } } return ok; }
  function buildTrail(segs, site) { let n = 0; for (const [a, b] of segs) if (ribbon([a, b], 1.8, "fb_trail_" + site.id + "_" + n)) n++; if (n) cnt("trails", n); return n; }

  // ───────────── the programs ─────────────
  // every program gets the site s (x, z, r, ang = the direction from the site to its walk, wk), and composes around it
  const P = {};
  const polar = (s, a, d) => [s.x + Math.cos(s.ang + a) * d, s.z + Math.sin(s.ang + a) * d];
  const yawTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
  function ringOf(s, n, d, a0, fn) { for (let i = 0; i < n; i++) { const a = a0 + i / n * TAU; const [x, z] = polar(s, a, d); fn(x, z, a, i); } }
  function understory(s, r0, r1, n, mix) { let k = 0; for (let t = 0; t < n * 5 && k < n; t++) { const a = R() * TAU, d = r0 + Math.sqrt(R()) * (r1 - r0); const [x, z] = polar(s, a, d); if (accent(pick(mix), x, z, s)) k++; } return k; }
  // shade trees in a loose bosque: offset rows across the site, one species to a row
  function bosqueTrees(s, rows, cols, sp, gapR) { const ux = Math.cos(s.ang), uz = Math.sin(s.ang), vx = -uz, vz = ux; let k = 0; for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const a = (i - (rows - 1) / 2) * sp + rr(-0.6, 0.6), b = (j - (cols - 1) / 2) * sp + (i % 2 ? sp / 2 : 0) + rr(-0.6, 0.6); if (Math.hypot(a, b) < gapR) continue; const x = s.x + ux * a + vx * b, z = s.z + uz * a + vz * b; if (Math.hypot(x - s.x, z - s.z) > s.r) continue; if (tree(i % 3 === 1 ? "paloverde" : i % 3 === 2 ? "ironwood" : "mesquite", x, z, s)) k++; } return k; }
  P.bosque = (s) => { bed(s.x, s.z, 7.5, "dg", s); const yaw = s.yawW + PI / 2; ramada(s.x, s.z, yaw, s); { const [x, z] = polar(s, 0.55, 10.5); if (piece("chess", x, z, s.yawW, s, 1.7)) bed(x, z, 2.6, "dg", s); } bosqueTrees(s, 4, 5, 6.8, 9.5);
    // benches facing the ramada under the canopy, a chess table on the walk side
    for (const a of [PI * 0.75, -PI * 0.75, PI]) { const [x, z] = polar(s, a, 8.8); bench(x, z, yawTo(x, z, s.x, s.z), s); }
    // the garden along the walk: drifts of agave, grass and an ocotillo trio
    { const [x, z] = polar(s, 0, s.r - 5); drift("agave", x, z, s.ang + PI / 2, 5, 1.7, s, 1); const [x2, z2] = polar(s, 0.35, s.r - 3.5); drift("grass", x2, z2, s.ang + PI / 2, 7, 1.2, s); const [x3, z3] = polar(s, -0.4, s.r - 4); drift("ocotillo", x3, z3, s.ang + PI / 2, 3, 2.2, s); }
    understory(s, 10, s.r, 14, ["grass", "grass", "shrub", "agave", "succ"]); ringOf(s, 4, 6.2, PI / 4, (x, z) => lantern(x, z, s)); };
  P.fountain = (s) => { bed(s.x, s.z, 8.5, "dg", s); levelPad(s.x, s.z, 6, 5); piece("fountain", s.x, s.z, s.ang, s, 2.4);
    // the runnel carries the water toward the walk
    { const [x, z] = polar(s, 0.62, 6.6); piece("runnel", x, z, Math.atan2(Math.cos(s.ang + 0.62), Math.sin(s.ang + 0.62)), s, 1.0, { len: 6 }); }
    ringOf(s, 4, 5.4, PI / 4 + PI / 2, (x, z) => bench(x, z, yawTo(x, z, s.x, s.z), s));
    ringOf(s, 4, 9.5, PI / 4, (x, z) => tree("paloverde", x, z, s)); ringOf(s, 6, 13.5, 0.3, (x, z) => tree(R() < 0.5 ? "mesquite" : "willow", x, z, s));
    understory(s, 9, s.r, 16, ["agave", "grass", "grass", "yucca", "barrel", "succ"]); ringOf(s, 2, 7.2, PI / 2, (x, z) => lantern(x, z, s)); };
  P.windmill = (s) => { bed(s.x, s.z, 7, "dg", s); levelPad(s.x, s.z, 5, 5); const [wx, wz] = polar(s, PI, 2.5); if (has("windmill") && spotOK(wx, wz, 2.5)) { put("windmill", wx, wz, s.ang + 0.4, 1); const e = PLACE.windmill[PLACE.windmill.length - 1]; e.fb = 1; mine(wx, wz, 3); s.n++; cnt("k_windmill"); }
    { const [x, z] = polar(s, PI * 0.5, 7.2); piece("tank", x, z, 0, s, 2.2); } { const [x, z] = polar(s, -PI * 0.45, 6.8); piece("rail", x, z, s.ang, s, 1.2, { len: 6 }); }
    { const [x, z] = polar(s, 0.25, 5.2); bench(x, z, yawTo(x, z, wx, wz), s); } { const [x, z] = polar(s, -0.5, 6.4); piece("sign", x, z, s.yawW, s, 0.6, { text: "photo" }); }
    for (const a of [PI * 0.8, -PI * 0.8, PI * 1.15]) { const [x, z] = polar(s, a, rr(8, 11)); tree("mesquite", x, z, s); } understory(s, 6, s.r, 12, ["pear", "grass", "grass", "shrub", "barrel"]); };
  P.grove = (s) => { bed(s.x, s.z, 6.5, "dg", s); ringOf(s, 5, 7.5, 0.4, (x, z) => tree(R() < 0.45 ? "ironwood" : R() < 0.5 ? "paloverde" : "mesquite", x, z, s)); ringOf(s, 3, 3.6, PI / 3, (x, z) => bench(x, z, yawTo(x, z, s.x, s.z) + PI, s));
    { const [x, z] = polar(s, 0, s.r - 4); drift("agave", x, z, s.ang + PI / 2, 4, 1.8, s, 1); } understory(s, 9, s.r, 12, ["grass", "grass", "shrub", "barrel", "agave"]); lantern(...polar(s, 0.5, 5), s); };
  P.hammock = (s) => { bed(s.x, s.z, 9, "dg", s); for (let i = 0; i < 4; i++) { const a = s.ang + PI + (i - 1.5) * 0.95; const d = 5.6; const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d; piece("hammock", x, z, Math.atan2(-Math.cos(a), -Math.sin(a)), s, 1.3); }
    ringOf(s, 6, 9.2, 0.25, (x, z) => tree(R() < 0.6 ? "paloverde" : "willow", x, z, s)); { const [x, z] = polar(s, PI, 6.5); bench(x, z, s.ang, s); }
    understory(s, 10, s.r, 14, ["grass", "grass", "shrub", "agave", "succ"]); lantern(...polar(s, 0.4, 7), s); };
  P.stargaze = (s) => { bed(s.x, s.z, 7.5, s.dark ? "red" : "dg", s); levelPad(s.x, s.z, 5.5, 4); const face = s.faceSky !== undefined ? s.faceSky : PI;   /* face south-ish, away from the walk */
    for (let i = 0; i < 4; i++) { const b = (i - 1.5) * 2.4; const x = s.x + Math.cos(s.ang + PI / 2) * b, z = s.z + Math.sin(s.ang + PI / 2) * b; piece("recliner", x, z, s.yawW + PI, s, 1.1); }
    { const [x, z] = polar(s, 0.2, 5.5); piece("sign", x, z, s.yawW, s, 0.6, { text: "stars" }); } for (const a of [PI * 0.7, -PI * 0.7]) { const [x, z] = polar(s, a, 9); tree("mesquite", x, z, s); }
    understory(s, 8, s.r, 12, ["grass", "barrel", "shrub", "agave"]); void face; };
  P.firepit = (s) => { bed(s.x, s.z, 6.6, "dg", s); levelPad(s.x, s.z, 5, 5); fireRing(s.x, s.z, s); ringOf(s, 5, 3.7, PI / 5, (x, z) => bench(x, z, yawTo(x, z, s.x, s.z), s));
    ringOf(s, 5, 9, 0.2, (x, z) => tree("mesquite", x, z, s)); understory(s, 8, s.r, 12, ["pear", "grass", "shrub", "agave", "barrel"]); lantern(...polar(s, 0.3, 6.8), s); };
  P.garden = (s) => { bed(s.x, s.z, 6, "dg", s); const sa = s.ang + PI; const [cx, cz] = polar(s, PI, 3);   /* the saguaro stand toward the back, the bench facing it from the walk side */
    accent("sag_giant", cx, cz, s, { force: false }); accent("sag_mid", cx + Math.cos(sa + 1.2) * 2.6, cz + Math.sin(sa + 1.2) * 2.6, s); accent("sag_young", cx + Math.cos(sa - 1.0) * 2.2, cz + Math.sin(sa - 1.0) * 2.2, s); accent("sag_young", cx + Math.cos(sa + 2.4) * 3.4, cz + Math.sin(sa + 2.4) * 3.4, s);
    accent("boulder", cx + Math.cos(sa - 2.2) * 2.6, cz + Math.sin(sa - 2.2) * 2.6, s); { const [x, z] = polar(s, 0, 3.2); piece("seatwall", x, z, s.yawW + PI, s, 2.2); }
    for (let i = 0; i < 3; i++) { const [x, z] = polar(s, -0.9 + i * 0.9, 8.5 + i * 0.6); drift(["agave", "grass", "barrel"][i], x, z, s.ang + PI / 2 + i, 5, 1.5, s, 1); }
    { const [x, z] = polar(s, PI * 0.6, 9); drift("ocotillo", x, z, s.ang, 3, 2.3, s); } understory(s, 7, s.r, 10, ["grass", "succ", "yucca", "agave", "shrub"]);
    for (const a of [PI * 0.75, -PI * 0.75]) { const [x, z] = polar(s, a, s.r - 3); tree("paloverde", x, z, s); } lantern(...polar(s, 0.6, 5), s); };
  const ART = ["sculpture", "corten", "monolith", "sculpt_ribbon", "sculpt_mirror", "art1", "art2", "art3", "art4"];
  P.sculpture = (s) => { const ks = ART.filter(has); const N = 5; const st = [];
    // a gentle S-curve of stations across the field, each a gravel pad with a piece and its sign, a bench at the middle station
    for (let i = 0; i < N; i++) { const t = (i - (N - 1) / 2) / ((N - 1) / 2); const a = s.ang + PI / 2; const off = Math.sin(t * PI) * 6; const x = s.x + Math.cos(a) * t * (s.r - 5) + Math.cos(s.ang) * off, z = s.z + Math.sin(a) * t * (s.r - 5) + Math.sin(s.ang) * off; if (spotOK(x, z, 3.6)) st.push([x, z, i]); }
    if (!st.length) return; const tr = reserveTrail(st.map((q) => [q[0], q[1]]));
    for (const [x, z, i] of st) { bed(x, z, 4.6, "dg", s); levelPad(x, z, 3, 4); let ok = false;
      if (i === 2 || !ks.length) ok = !!piece("ring", x, z, s.yawW, s, 2.2, { force: true }); else { const k = ks[(i + 3) % ks.length]; ok = !!placeKind(k, x, z, s.yawW + rr(-0.4, 0.4), rr(0.75, 0.9), s, { rad: 2.4, force: true }); }
      if (!ok) ok = !!piece("cairn", x, z, s.yawW, s, 1.4, { force: true }); if (ok) piece("sign", x + Math.cos(s.ang) * 3.2, z + Math.sin(s.ang) * 3.2, s.yawW, s, 0.5, { text: "art" + i });
      if (i === 2) { const a = s.ang + PI / 2; const bx = x + Math.cos(s.ang) * 4.6 + Math.cos(a) * 2.2, bz = z + Math.sin(s.ang) * 4.6 + Math.sin(a) * 2.2; bench(bx, bz, yawTo(bx, bz, x, z), s); }
      for (let q = 0; q < 5; q++) { const aa = R() * TAU, dd = rr(4.8, 6.8); accent(pick(["agave", "grass", "grass", "barrel", "succ"]), x + Math.cos(aa) * dd, z + Math.sin(aa) * dd, s); } }
    s.trailSegs = tr; for (const a of [PI * 0.5, -PI * 0.5]) { const [x, z] = polar(s, a + 0.4, s.r - 1); tree("ironwood", x, z, s); } understory(s, 8, s.r + 2, 12, ["grass", "ocotillo", "grass", "yucca"]); };
  P.artgarden = (s) => { bed(s.x, s.z, 6.5, "dg", s); piece("ring", s.x, s.z, s.yawW, s, 2.4, { big: 1 }); for (let i = 0; i < 3; i++) { const [x, z] = polar(s, PI + (i - 1) * 0.8, 4.8); drift(i === 1 ? "agave" : "grass", x, z, s.ang + PI / 2, 4, 1.3, s, 1); }
    { const [x, z] = polar(s, 0, 5.2); bench(x, z, s.yawW + PI, s); piece("sign", ...polar(s, 0.55, 4.6), s.yawW, s, 0.5, { text: "ring" }); } understory(s, 7, s.r, 8, ["ocotillo", "grass", "succ", "barrel"]); };
  P.labyrinth = (s) => { bed(s.x, s.z, 11.5, "dg", s); levelPad(s.x, s.z, 10, 6); piece("labyrinth", s.x, s.z, s.yawW, s, 9.6); ringOf(s, 12, 12.6, 0, (x, z, a) => { if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.35) return; accent("ocotillo", x, z, s); });
    { const [x, z] = polar(s, 0.3, 12.2); bench(x, z, yawTo(x, z, s.x, s.z), s); piece("sign", ...polar(s, -0.28, 12.0), s.yawW, s, 0.5, { text: "labyrinth" }); } understory(s, 14, s.r + 2, 10, ["grass", "barrel", "agave", "shrub"]); };
  P.waterwall = (s) => { bed(s.x, s.z, 7, "dg", s); levelPad(s.x, s.z, 5, 4); piece("waterwall", ...polar(s, PI, 1.6), s.yawW, s, 2.6); ringOf(s, 2, 3.4, PI / 2, (x, z) => bench(x, z, yawTo(x, z, ...polar(s, PI, 1.6)), s));
    for (const a of [PI * 0.62, -PI * 0.62]) { const [x, z] = polar(s, a, 6.2); tree("paloverde", x, z, s); } understory(s, 7, s.r, 12, ["agave", "grass", "grass", "succ", "yucca"]); lantern(...polar(s, 0.8, 5), s); };
  P.pergola = (s) => { bed(s.x, s.z, 7, "dg", s); if (has("pergola") && spotOK(s.x, s.z, 2.8)) { put("pergola", s.x, s.z, s.ang, 1.25); const e = PLACE.pergola[PLACE.pergola.length - 1]; e.fb = 1; e.keep = true; mine(s.x, s.z, 3.4); s.n++; cnt("k_pergola"); }
    for (const a of [PI / 2, -PI / 2]) { const [x, z] = polar(s, a, 3.9); bench(x, z, yawTo(x, z, s.x, s.z), s); } ringOf(s, 4, 8.5, PI / 4, (x, z) => tree(R() < 0.5 ? "paloverde" : "willow", x, z, s));
    { const [x, z] = polar(s, 0, 6.4); drift("agave", x, z, s.ang + PI / 2, 5, 1.5, s, 1); } understory(s, 7, s.r, 14, ["grass", "grass", "succ", "yucca", "barrel"]); lantern(...polar(s, 0.7, 5.6), s); };
  const TRAIL = [["sag_giant", "saguaro"], ["ocotillo", "ocotillo"], ["agave", "agave"], ["paloverde", "paloverde"], ["mesquite", "mesquite"], ["barrel", "barrel"]];
  P.trail = (s) => { const n = TRAIL.length; const loop = []; for (let i = 0; i < n; i++) { const a = s.ang + PI + (i - (n - 1) / 2) * (TAU / (n + 1)); const d = s.r - 6; loop.push([s.x + Math.cos(a) * d, s.z + Math.sin(a) * d, a]); }
    const pts = [polar(s, 0, 3)].concat(loop.map((q) => [q[0], q[1]])).concat([polar(s, 0, 3)]); s.trailSegs = reserveTrail(pts);
    loop.forEach(([x, z, a], i) => { const [sp, sign] = TRAIL[i]; const ox = Math.cos(a) * 2.4, oz = Math.sin(a) * 2.4; const ok = TREES[sp] ? tree(sp, x + ox * 1.1, z + oz * 1.1, s) : accent(sp, x + ox, z + oz, s); if (ok) piece("sign", x + ox * 0.45, z + oz * 0.45, yawTo(x + ox * 0.45, z + oz * 0.45, s.x, s.z), s, 0.5, { text: "plant_" + sign }); for (let q = 0; q < 3; q++) accent(pick(["grass", "succ", "shrub"]), x + ox * 1.6 + rr(-2, 2), z + oz * 1.6 + rr(-2, 2), s); });
    bed(s.x, s.z, 4.5, "dg", s); { const [x, z] = polar(s, PI, 1.5); bench(x, z, s.yawW, s); } understory(s, s.r - 2, s.r + 3, 10, ["grass", "shrub", "barrel"]); };
  P.lookout = (s) => { const face = s.faceTo ? Math.atan2(s.faceTo[0] - s.x, s.faceTo[1] - s.z) : s.yawW + PI; berm(s.x, s.z, 11, 8, 0, 1.1); levelPad(s.x, s.z, 4.2, 3); piece("deck", s.x, s.z, face, s, 4.2);
    for (const a of [1.9, -1.9]) { const x = s.x + Math.sin(face + a) * 7.5, z = s.z + Math.cos(face + a) * 7.5; tree("paloverde", x, z, s); } understory(s, 6.5, s.r, 14, ["grass", "grass", "agave", "shrub", "barrel"]); };
  P.stand = (s) => { const face = s.faceTo ? Math.atan2(s.faceTo[0] - s.x, s.faceTo[1] - s.z) : s.yawW + PI; levelPad(s.x, s.z, 6, 5); piece("bleacher", s.x, s.z, face, s, 5.2);
    for (const a of [PI / 2, -PI / 2]) { const x = s.x + Math.sin(face + a) * 8.5, z = s.z + Math.cos(face + a) * 8.5; tree("mesquite", x, z, s); } { const x = s.x - Math.sin(face) * 5, z = s.z - Math.cos(face) * 5; piece("sign", x, z, face + PI, s, 0.5, { text: "stand" }); } understory(s, 7, s.r, 10, ["pear", "grass", "shrub", "grass"]); };
  P.moon = (s) => { bed(s.x, s.z, 7, "red", s); piece("moonring", s.x, s.z, s.ang, s, 3.4); ringOf(s, 7, 5.6, 0.2, (x, z) => accent(R() < 0.6 ? "moonrock" : "organ", x, z, s)); understory(s, 7, s.r, 10, ["organ", "barrel", "succ", "moonrock"]); };
  P.bermgrove = (s) => { berm(s.x, s.z, s.r * 0.95, s.r * 0.55, s.ang + PI / 2, 1.6); for (let i = 0; i < 5; i++) { const t = (i - 2) / 2; const [x, z] = [s.x + Math.cos(s.ang + PI / 2) * t * s.r * 0.7, s.z + Math.sin(s.ang + PI / 2) * t * s.r * 0.7]; tree(i % 2 ? "mesquite" : "ironwood", x + rr(-1, 1), z + rr(-1, 1), s); }
    understory(s, 2, s.r * 0.9, 14, ["grass", "grass", "shrub", "agave", "pear"]); };


  // ───────────── groves in the remaining gaps (after the designed sites) ─────────────
  // a distance field (2 m) from everything built, mine and protected; anchors 13 m or more from it and within 75 m of a walk,
  // Poisson spaced by district; each a cluster of three to five shade trees of one or two species, an understory drift and,
  // close to a walk, a bench under the trees facing it
  const GROVE = { S3_MAIN: [["mesquite", 3], ["paloverde", 2]], S3_COMMONS: [["paloverde", 3], ["willow", 1], ["mesquite", 1]], S3_DESIGN: [["ironwood", 2], ["paloverde", 2]], S3_FOUNTAIN: [["paloverde", 3], ["willow", 2]], S3_SUNSET: [["ironwood", 2], ["paloverde", 2]], S3_MESA: [["paloverde", 2], ["ironwood", 2]], S3_RANCH: [["mesquite", 4]], S3_FRONTIER: [["mesquite", 4]], S3_GATE: [["paloverde", 2], ["mesquite", 2]], S3_WORKS: [["mesquite", 3], ["paloverde", 1]], S3_SOUTH: [["paloverde", 2], ["ironwood", 1]], S3_DEPOT: [["mesquite", 3]], S3_ARROYO: [["mesquite", 3], ["willow", 2]], S3_RIDGEWASH: [["mesquite", 3], ["willow", 2]], S3_NFWASH: [["mesquite", 3]], S3_NIGHT: [["mesquite", 2]], S3_OUTPOST: [["mesquite", 1]], S3_NORTHYARD: [["mesquite", 2]], outside: [["mesquite", 2], ["paloverde", 1]] };
  const GSPACE = { S3_MAIN: 30, S3_COMMONS: 32, S3_DESIGN: 36, S3_FOUNTAIN: 34, S3_SUNSET: 34, S3_MESA: 34, S3_RANCH: 42, S3_GATE: 40, S3_WORKS: 44, outside: 55 };
  const wpick = (list) => { let t = 0; for (const q of list) t += q[1]; let u = R() * t; for (const q of list) { u -= q[1]; if (u <= 0) return q[0]; } return list[0][0]; };
  function groves() { const t0 = performance.now(); const C = 2, nx = Math.ceil(G.nx / C), nz = Math.ceil(G.nz / C), N = nx * nz; const D = new Float32Array(N), DPw = new Float32Array(N); const INF = 1e9; const BAD = HARD | MINE | RWY | OUT | SOFT;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const b = RA[(j * C) * G.nx + i * C] | RA[Math.min(G.nz - 1, j * C + 1) * G.nx + Math.min(G.nx - 1, i * C + 1)]; D[j * nx + i] = (b & BAD) ? 0 : INF; DPw[j * nx + i] = (b & PATHB) ? 0 : INF; }
    const df = (A) => { const S2 = Math.SQRT2 * C; for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; let d = A[k]; if (i > 0) d = Math.min(d, A[k - 1] + C); if (j > 0) { d = Math.min(d, A[k - nx] + C); if (i > 0) d = Math.min(d, A[k - nx - 1] + S2); if (i < nx - 1) d = Math.min(d, A[k - nx + 1] + S2); } A[k] = d; }
      for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const k = j * nx + i; let d = A[k]; if (i < nx - 1) d = Math.min(d, A[k + 1] + C); if (j < nz - 1) { d = Math.min(d, A[k + nx] + C); if (i < nx - 1) d = Math.min(d, A[k + nx + 1] + S2); if (i > 0) d = Math.min(d, A[k + nx - 1] + S2); } A[k] = d; } };
    df(D); df(DPw); const cand = []; for (let j = 1; j < nz; j += 2) for (let i = 1; i < nx; i += 2) { const k = j * nx + i; if (D[k] < 13 || DPw[k] > 75) continue; const x = G.X0 + (i + 0.5) * C * G.C, z = G.Z0 + (j + 0.5) * C * G.C; cand.push([x, z, D[k] + R() * 6 - DPw[k] * 0.05]); }
    cand.sort((a, b) => b[2] - a[2]); const anchors = []; let ng = 0; const near = (x, z, sp) => anchors.some((a) => Math.hypot(a[0] - x, a[1] - z) < Math.min(sp, a[2]));
    for (const [x, z] of cand) { if (ng >= 140) break; const d = planDistrictAt(x, z); const id = d ? d.id : "outside"; const sp = GSPACE[id] || 40; if (near(x, z, sp)) continue; const mix = GROVE[id] || GROVE.outside; const site = { id: "grove_" + ng, x, z, r: 9, n: 0, why: {} };
      const nt = 3 + Math.floor(R() * 3); const sp1 = wpick(mix), sp2 = R() < 0.35 ? wpick(mix) : sp1; let k = 0; const a0 = R() * TAU;
      for (let t = 0; t < nt * 3 && k < nt; t++) { const a = a0 + t * 2.4 + rr(-0.3, 0.3), dd = t === 0 ? rr(0, 1.5) : rr(4.2, 8.5); if (tree(t % 3 === 2 ? sp2 : sp1, x + Math.cos(a) * dd, z + Math.sin(a) * dd, site)) k++; }
      if (k < 2) continue; anchors.push([x, z, sp]); ng++; const und = id === "S3_RANCH" || id === "S3_FRONTIER" ? ["pear", "grass", "grass", "shrub"] : id === "S3_OUTPOST" ? ["barrel", "organ", "succ"] : ["grass", "grass", "agave", "shrub", "barrel", "succ"];
      const da = R() * TAU; drift(pick(und), x + Math.cos(da) * 6, z + Math.sin(da) * 6, da + PI / 2, 4 + Math.floor(R() * 3), 1.4, site, 1); for (let q = 0; q < 6; q++) { const a = R() * TAU, dd = rr(2.5, 9.5); accent(pick(und), x + Math.cos(a) * dd, z + Math.sin(a) * dd, site); }
      // a bench in the shade facing the walk, when the walk is close (so a grove is a place to stop, not just scenery)
      const k2 = cK(x, z); const dpw = DPw[Math.floor((z - G.Z0) / (C * G.C)) * nx + Math.floor((x - G.X0) / (C * G.C))]; void k2;
      if (dpw < 24 && R() < 0.7) { const wk = nearestWalk(x, z, 30); if (wk) { const ux = wk.px - x, uz = wk.pz - z, L = Math.hypot(ux, uz) || 1; const bx = x + ux / L * 4.2, bz = z + uz / L * 4.2; bench(bx, bz, Math.atan2(ux, uz), site); } }
      KEEPOUT.push([x, z, 8]); cnt("groves"); cnt("groveTrees", k); }
    FB.groves = anchors.map((a) => [Math.round(a[0]), Math.round(a[1])]); FB.t.groves = Math.round(performance.now() - t0); }

  // ───────────── the terrain pass: compose every site ─────────────
  const DARKD = new Set(["S3_OUTPOST", "S3_NORTHYARD"]);
  function terrainHook() { const t0 = performance.now(); R = mulberry(20261005); const C0 = cfg(); if (!C0 || !Array.isArray(C0.sites)) { err("cfg", "no plan/fill_b.json"); return; }
    try { buildRaster(); } catch (e) { err("raster", e); return; }
    const sites = C0.sites.slice().sort((a, b) => (a.prio || 9) - (b.prio || 9));
    for (const d of sites) { const s = Object.assign({}, d, { n: 0, beds: 0, spur: false, why: {} }); FB.sites.push(s); CUR = s;
      try { const k = cK(s.x, s.z); if (k < 0 || (RA[k] & (OUT | RWY))) { s.skip = "outside"; continue; }
        if (RA[k] & HARD) { // nudge the centre to the nearest free cell within 8 m
          let best = null; for (let rr2 = 1; rr2 <= 8 && !best; rr2++) for (let q = 0; q < 16; q++) { const a = q / 16 * TAU; const x = s.x + Math.cos(a) * rr2, z = s.z + Math.sin(a) * rr2; if (!(bitsAt(x, z) & (HARD | MINE | RWY | OUT))) { best = [x, z]; break; } } if (!best) { s.skip = "blocked"; continue; } s.x = best[0]; s.z = best[1]; s.moved = 1; }
        s.dark = DARKD.has(s.d) || s.program === "stargaze" && s.d === "S3_OUTPOST"; s.wk = nearestWalk(s.x, s.z, 70);
        const fn = P[s.program]; if (!fn) { s.skip = "program"; continue; } clearScatter(s, s.r + 2); const padR = s.program === "labyrinth" ? 11.5 : s.program === "trail" ? 4 : s.program === "sculpture" ? 3 : 6.5;
        if (s.wk && s.wk.d > s.r * 0.3) { const cands = walksNear(s.x, s.z, 70).slice(0, 4); for (const w of cands) { s.wk = w; const q = planSpur(s, padR); if (q) { s.spurPlan = q; break; } } if (!s.spurPlan && cands.length) s.wk = cands[0]; }
        s.ang = s.wk ? Math.atan2(s.wk.pz - s.z, s.wk.px - s.x) : 0; s.yawW = s.wk ? Math.atan2(s.wk.px - s.x, s.wk.pz - s.z) : 0; fn(s); if (s.n > 0) { buildSpur(s); if (s.trailSegs) buildTrail(s.trailSegs, s); KEEPOUT.push([s.x, s.z, s.r * 0.95]); }
        cnt("sites"); } catch (e) { err("site " + d.id, e); } } CUR = null;
    try { groves(); } catch (e) { err("groves", e); }
    if (!/[?&]fbdebug=1\b/.test(location.search)) RA = null;
    FB.t.terrain = Math.round(performance.now() - t0); console.log("plan_fill_b: " + (FB.n.sites || 0) + " sites, " + (FB.placed || 0) + " placements, " + FB.pieces.length + " pieces, " + FB.spurs.length + " spurs in " + FB.t.terrain + " ms"); }

  // ───────────── materials (shared, built once) ─────────────
  const MT = FB.mat = {};
  function canvasTex(w, h, fn, srgb) { const c = document.createElement("canvas"); c.width = w; c.height = h; fn(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.userData.avShared = true; return t; }
  function mats() { if (MT.wood) return MT; const sh = (m, n) => { m.name = "fb_" + n; m.userData.avShared = true; return m; };
    const rep = (t, a, b) => { if (!t) return null; const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(a, b); c.needsUpdate = true; c.userData.avShared = true; return c; };
    MT.wood = sh(new THREE.MeshStandardMaterial({ map: TEX.wood || null, normalMap: TEX.woodN || null, color: 0xc29a6c, roughness: 0.82, metalness: 0 }), "wood");
    MT.stone = sh(new THREE.MeshStandardMaterial({ map: TEX.travertine || null, color: 0xe6d6b8, roughness: 0.8, metalness: 0 }), "stone");
    MT.steel = sh(new THREE.MeshStandardMaterial({ color: 0x2c2823, roughness: 0.45, metalness: 0.6 }), "steel");
    MT.corten = sh(new THREE.MeshStandardMaterial({ map: TEX.rock || null, normalMap: TEX.rockN || null, color: 0xa65a35, roughness: 0.72, metalness: 0.25 }), "corten");
    MT.fabric = sh(new THREE.MeshStandardMaterial({ color: 0xe9dfc8, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }), "fabric");
    MT.galv = sh(new THREE.MeshStandardMaterial({ color: 0xa3abb0, roughness: 0.38, metalness: 0.75, side: THREE.DoubleSide }), "galv");
    MT.dirt = sh(new THREE.MeshStandardMaterial({ map: TEX.dirt || null, color: 0xa88d6c, roughness: 1, metalness: 0 }), "dirt");
    MT.rock = sh(new THREE.MeshStandardMaterial({ map: TEX.rock || null, normalMap: TEX.rockN || null, color: 0xc7b496, roughness: 0.95, metalness: 0 }), "rock");
    MT.red = sh(new THREE.MeshStandardMaterial({ map: TEX.rock || null, normalMap: TEX.rockN || null, color: 0x5b4036, roughness: 0.9, metalness: 0.1 }), "red");
    MT.checker = sh(new THREE.MeshStandardMaterial({ map: TEX.checker || null, color: 0xffffff, roughness: 0.35, metalness: 0 }), "checker");
    MT.cream = sh(new THREE.MeshStandardMaterial({ color: 0xf1e6cc, roughness: 0.4, metalness: 0 }), "cream");
    MT.ebony = sh(new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.4, metalness: 0 }), "ebony");
    // water: a scrolling ripple normal map (canvas), dark and glossy; never a pool, only basins, a runnel and a sheet on a wall
    const rip = canvasTex(256, 256, (x, w, h) => { const im = x.createImageData(w, h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const a = Math.sin(i / w * TAU * 3 + Math.sin(j / h * TAU * 2) * 1.3) * 0.5 + Math.sin(j / h * TAU * 5 + i / w * TAU) * 0.35; const b = Math.cos(j / h * TAU * 4 + Math.sin(i / w * TAU * 3) * 1.1) * 0.5 + Math.cos(i / w * TAU * 2 - j / h * TAU * 3) * 0.3; const k = (j * w + i) * 4; im.data[k] = 128 + a * 60; im.data[k + 1] = 128 + b * 60; im.data[k + 2] = 235; im.data[k + 3] = 255; } x.putImageData(im, 0, 0); }, false); rip.wrapS = rip.wrapT = THREE.RepeatWrapping; MT.ripple = rip;
    MT.water = sh(new THREE.MeshStandardMaterial({ color: 0x4f7a80, roughness: 0.06, metalness: 0.2, normalMap: rip, normalScale: new THREE.Vector2(0.5, 0.5) }), "water");
    const fall = rip.clone(); fall.wrapS = fall.wrapT = THREE.RepeatWrapping; fall.repeat.set(1, 3); fall.userData.avShared = true; MT.fallTex = fall;
    MT.sheet = sh(new THREE.MeshStandardMaterial({ color: 0x7fa3a8, roughness: 0.05, metalness: 0.3, normalMap: fall, normalScale: new THREE.Vector2(0.8, 0.8), transparent: true, opacity: 0.72, depthWrite: false }), "sheet");
    MT.glow = sh(new THREE.MeshStandardMaterial({ color: 0x3a2c18, emissive: 0xffc27a, emissiveIntensity: 0, roughness: 0.4 }), "glow");
    MT.sign = sh(new THREE.MeshStandardMaterial({ map: signAtlas(), roughness: 0.75, metalness: 0.05, emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0 }), "sign");
    void rep; return MT; }
  // the sign atlas: 4 x 8 cells of 256 x 128 px (corten panel, cream lettering), one cell per text
  const SIGNS = { photo: ["RANGE WINDMILL", "Photo spot. The windmill drew", "water for the stock tank below."], stars: ["STAR BENCHES", "Lie back, face the dark sky.", "Lights stay low after dusk."], labyrinth: ["DESERT LABYRINTH", "One path in, one path out.", "Walk it slowly."], ring: ["THE RING", "Corten steel, a frame", "for the mountains beyond."], stand: ["CORRAL STAND", "Rodeo nights, roping and", "the Saturday horse shows."],
    art0: ["SCULPTURE WALK  1", "Steel and stone from the", "district's own studios."], art1: ["SCULPTURE WALK  2", "Look back along the trail", "toward the Ring."], art2: ["SCULPTURE WALK  3", "The Ring: weathering steel", "that changes with the light."], art3: ["SCULPTURE WALK  4", "Made in Maker Row, set", "on the land it came from."], art4: ["SCULPTURE WALK  5", "The trail ends here. The", "fields go on."],
    plant_saguaro: ["SAGUARO", "Grows a few cm a year, first", "arm at about 70 years."], plant_ocotillo: ["OCOTILLO", "Leafs out within days of", "rain, red flowers in spring."], plant_agave: ["AGAVE", "Flowers once, after decades,", "on a stalk up to 6 m tall."], plant_paloverde: ["PALO VERDE", "Green bark that makes food", "when the leaves drop."], plant_mesquite: ["MESQUITE", "Roots can reach water", "more than 50 m down."], plant_barrel: ["BARREL CACTUS", "Leans to the south as it", "grows: the compass cactus."] };
  const SIGNKEYS = Object.keys(SIGNS);
  function signAtlas() { return canvasTex(1024, 1024, (x) => { SIGNKEYS.forEach((k, i) => { const cx = (i % 4) * 256, cy = Math.floor(i / 4) * 128; const g = x.createLinearGradient(cx, cy, cx + 256, cy + 128); g.addColorStop(0, "#6b3a22"); g.addColorStop(1, "#4e2a19"); x.fillStyle = g; x.fillRect(cx, cy, 256, 128);
      for (let q = 0; q < 140; q++) { x.fillStyle = "rgba(" + (120 + Math.random() * 60 | 0) + "," + (60 + Math.random() * 30 | 0) + ",30," + (0.08 + Math.random() * 0.12).toFixed(2) + ")"; x.fillRect(cx + Math.random() * 256, cy + Math.random() * 128, 2 + Math.random() * 10, 1 + Math.random() * 4); }
      x.strokeStyle = "rgba(244,205,90,0.65)"; x.lineWidth = 2; x.strokeRect(cx + 7, cy + 7, 242, 114); const L = SIGNS[k]; x.fillStyle = "#f5f1e6"; x.font = "700 21px 'Space Grotesk', 'Segoe UI', sans-serif"; x.textBaseline = "top"; x.fillText(L[0], cx + 18, cy + 18); x.fillStyle = "#4DDE6F"; x.fillRect(cx + 18, cy + 46, 40, 3); x.fillStyle = "#efe6d2"; x.font = "500 15px 'Space Grotesk', 'Segoe UI', sans-serif"; x.fillText(L[1] || "", cx + 18, cy + 60); x.fillText(L[2] || "", cx + 18, cy + 82); }); }); }
  const signUV = (k) => { const i = Math.max(0, SIGNKEYS.indexOf(k)); return [(i % 4) / 4, 1 - (Math.floor(i / 4) + 1) / 8, 1 / 4, 1 / 8]; };

  // ───────────── geometry: a small merger (positions, normals, uvs) per material ─────────────
  function MB() { this.p = []; this.n = []; this.u = []; this.i = []; }
  MB.prototype.add = function (geo, m4, uvx) { const g = geo.index ? geo : geo; const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv; const base = this.p.length / 3; const v = new THREE.Vector3(), nn = new THREE.Vector3(); const nm = new THREE.Matrix3().getNormalMatrix(m4);
    for (let k = 0; k < p.count; k++) { v.set(p.getX(k), p.getY(k), p.getZ(k)).applyMatrix4(m4); this.p.push(v.x, v.y, v.z); if (n) { nn.set(n.getX(k), n.getY(k), n.getZ(k)).applyMatrix3(nm).normalize(); this.n.push(nn.x, nn.y, nn.z); } else this.n.push(0, 1, 0); if (u) { if (uvx) this.u.push(uvx[0] + u.getX(k) * uvx[2], uvx[1] + u.getY(k) * uvx[3]); else this.u.push(u.getX(k), u.getY(k)); } else this.u.push(0, 0); }
    if (g.index) { const ix = g.index.array; for (let k = 0; k < ix.length; k++) this.i.push(base + ix[k]); } else for (let k = 0; k < p.count; k++) this.i.push(base + k); geo.dispose(); return this; };
  MB.prototype.geo = function () { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2)); g.setIndex(this.i); g.computeBoundingSphere(); g.computeBoundingBox(); return g; };
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
  const M4 = (x, y, z, ry, sx, sy, sz, rx, rz) => { _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _v.set(x, y, z); _s.set(sx || 1, sy || 1, sz || 1); return new THREE.Matrix4().compose(_v, _q, _s); };
  // a frame at a piece: local (lx, ly, lz) -> world matrix, y from the drawn surface under the piece's centre
  function Frame(p, y) { this.p = p; this.y = y; this.c = Math.cos(p.yaw || 0); this.s = Math.sin(p.yaw || 0); }
  Frame.prototype.w = function (lx, lz) { return [this.p.x + lx * this.c + lz * this.s, this.p.z - lx * this.s + lz * this.c]; };
  Frame.prototype.m = function (lx, ly, lz, ry, sx, sy, sz, rx, rz) { const [x, z] = this.w(lx, lz); return M4(x, this.y + ly, z, (this.p.yaw || 0) + (ry || 0), sx, sy, sz, rx, rz); };
  Frame.prototype.mg = function (lx, ly, lz, ry, sx, sy, sz, rx, rz) { const [x, z] = this.w(lx, lz); return M4(x, gy(x, z) + ly, z, (this.p.yaw || 0) + (ry || 0), sx, sy, sz, rx, rz); };   /* on the ground right under it */
  const gy = (x, z) => { try { return planGroundAt(x, z); } catch (e) { return getH(x, z); } };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, n) => new THREE.CylinderGeometry(rt, rb, h, n || 10);
  // ───────────── the pieces ─────────────
  const BUILD = {};
  BUILD.chess = (B, F, p) => { B.stone.add(cyl(0.22, 0.32, 0.7, 12), F.m(0, 0.35, 0)); B.stone.add(box(0.95, 0.07, 0.95), F.m(0, 0.72, 0)); const top = new THREE.PlaneGeometry(0.8, 0.8); top.rotateX(-PI / 2); B.checker.add(top, F.m(0, 0.757, 0));
    for (const sd of [-1, 1]) { B.stone.add(cyl(0.2, 0.24, 0.44, 10), F.m(0, 0.22, sd * 0.95)); seatSolid(F, 0, sd * 0.95, 0.44, 0.44, 0.44, sd < 0 ? 0 : PI); }
    // a game in progress: a few pieces each side (pawns and a king)
    const pawn = () => { const g = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.035, 0), new THREE.Vector2(0.03, 0.02), new THREE.Vector2(0.014, 0.05), new THREE.Vector2(0.022, 0.07), new THREE.Vector2(0, 0.085)], 8); return g; };
    for (let i = 0; i < 6; i++) { B.cream.add(pawn(), F.m(-0.35 + i * 0.1 + (i > 2 ? 0.05 : 0), 0.757, -0.25 + (i % 2) * 0.1)); B.ebony.add(pawn(), F.m(-0.3 + i * 0.1, 0.757, 0.25 - (i % 3) * 0.1)); }
    B.cream.add(cyl(0.022, 0.035, 0.14, 8), F.m(0.05, 0.827, -0.35)); B.ebony.add(cyl(0.022, 0.035, 0.14, 8), F.m(-0.05, 0.827, 0.35)); col(F, 0, 0, 0.5); };
  BUILD.hammock = (B, F, p) => { const L = 3.8; for (const sd of [-1, 1]) { B.wood.add(cyl(0.09, 0.11, 2.3, 8), F.mg(sd * L / 2, 1.1, 0, 0, 1, 1, 1, 0, sd * 0.08)); col(F, sd * L / 2, 0, 0.16); }
    // the bed of the hammock: a sagging strip between the posts (fabric), spreader bars at each end
    const seg = 12, W = 0.95; const pos = [], uv = [], idx = []; for (let i = 0; i <= seg; i++) { const t = i / seg; const x = -L / 2 + 0.35 + (L - 0.7) * t; const sag = Math.sin(t * PI); const y = 1.45 - sag * 0.78; for (const sz of [-1, 1]) { const zz = sz * W / 2 * (0.75 + 0.25 * sag); pos.push(x, y + (1 - sag) * 0.05 * (sz * sz), zz); uv.push(t, sz < 0 ? 0 : 1); } }
    for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } const hg = new THREE.BufferGeometry(); hg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); hg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); hg.setIndex(idx); hg.computeVertexNormals();
    B.fabric.add(hg, F.m(0, 0, 0)); for (const sd of [-1, 1]) { B.wood.add(cyl(0.025, 0.025, W, 6), F.m(sd * (L / 2 - 0.35), 1.48, 0, 0, 1, 1, 1, PI / 2)); B.steel.add(cyl(0.012, 0.012, 0.42, 4), F.m(sd * (L / 2 - 0.17), 1.62, 0, 0, 1, 1, 1, 0, sd * 1.1)); }
    seatSolid(F, 0, 0, 2.2, 0.8, 0.72, PI / 2, true); };
  BUILD.tank = (B, F) => { B.galv.add(new THREE.CylinderGeometry(1.9, 1.9, 0.78, 28, 1, true), F.m(0, 0.36, 0)); B.galv.add(new THREE.TorusGeometry(1.9, 0.045, 6, 28), F.m(0, 0.75, 0, 0, 1, 1, 1, PI / 2));
    for (let i = 0; i < 3; i++) B.galv.add(new THREE.TorusGeometry(1.912, 0.02, 4, 28), F.m(0, 0.14 + i * 0.2, 0, 0, 1, 1, 1, PI / 2)); const fl = new THREE.CircleGeometry(1.86, 24); fl.rotateX(-PI / 2); B.dirt.add(fl, F.m(0, 0.12, 0));
    // dry: cracked mud floor, a tumbleweed of dry grass and a rusted float valve
    B.steel.add(box(0.5, 0.06, 0.08), F.m(1.4, 0.72, 0.2, 0.4)); B.rock.add(new THREE.IcosahedronGeometry(0.25, 0), F.m(-0.6, 0.2, 0.5, 0, 1.4, 0.5, 1.1)); col(F, 0, 0, 1.95); };
  BUILD.rail = (B, F, p) => { const L = p.len || 6; const n = Math.round(L / 2.2); for (let i = 0; i <= n; i++) { const x = -L / 2 + L * i / n; B.wood.add(cyl(0.08, 0.1, 1.3, 7), F.mg(x, 0.55, 0)); col(F, x, 0, 0.12); } for (const y of [0.55, 1.0]) for (let i = 0; i < n; i++) { const x = -L / 2 + L * (i + 0.5) / n; B.wood.add(box(L / n + 0.2, 0.09, 0.07), F.m(x, y, 0, 0, 1, 1, 1, 0, (i % 2 ? 0.03 : -0.02))); } };
  BUILD.sign = (B, F, p) => { B.corten.add(box(0.08, 1.05, 0.08), F.m(-0.42, 0.52, 0)); B.corten.add(box(0.08, 1.05, 0.08), F.m(0.42, 0.52, 0)); B.corten.add(box(0.96, 0.52, 0.04), F.m(0, 1.0, -0.02, 0, 1, 1, 1, -0.32));
    const pl = new THREE.PlaneGeometry(0.9, 0.45); B.sign.add(pl, F.m(0, 1.0, 0.012, 0, 1, 1, 1, -0.32), signUV(p.text)); col(F, 0, 0, 0.45); FB.cards.push({ x: F.p.x, z: F.p.z, k: p.text }); };
  BUILD.seatwall = (B, F) => { const n = 9, R0 = 3.0; for (let i = 0; i < n; i++) { const a = (i - (n - 1) / 2) * 0.17; const x = Math.sin(a) * R0, z = R0 - Math.cos(a) * R0; B.stone.add(box(0.72, 0.45, 0.5), F.m(x, 0.22, z, a)); } seatSolid(F, 0, 0.15, 2.6, 0.5, 0.45, 0); for (const sd of [-1, 1]) col(F, sd * 0.9, 0.2, 0.3); };
  BUILD.recliner = (B, F) => { for (const sd of [-1, 1]) { B.steel.add(box(0.05, 0.42, 0.05), F.m(sd * 0.32, 0.21, 0.55)); B.steel.add(box(0.05, 0.25, 0.05), F.m(sd * 0.32, 0.12, -0.75)); }
    for (let i = 0; i < 9; i++) { const t = i / 8; const z = 0.75 - t * 1.75; const y = 0.42 + Math.max(0, t - 0.55) * 1.3 + (t < 0.2 ? (0.2 - t) * 0.8 : 0); B.wood.add(box(0.72, 0.035, 0.17), F.m(0, y, z, 0, 1, 1, 1, t > 0.55 ? 0.95 : t < 0.2 ? -0.4 : 0)); }
    seatSolid(F, 0, 0.1, 0.7, 1.1, 0.44, PI, true); };
  BUILD.fountain = (B, F) => { const n = 20, Rb = 1.75; for (let i = 0; i < n; i++) { const a = i / n * TAU; B.stone.add(box(0.62, 0.48, 0.3), F.m(Math.sin(a) * Rb, 0.24, Math.cos(a) * Rb, a)); } const fl = new THREE.CircleGeometry(Rb - 0.12, 28); fl.rotateX(-PI / 2); B.stone.add(fl.clone(), F.m(0, 0.06, 0)); B.water.add(fl, F.m(0, 0.36, 0));
    B.stone.add(cyl(0.22, 0.3, 0.75, 14), F.m(0, 0.5, 0)); B.stone.add(new THREE.CylinderGeometry(0.62, 0.3, 0.18, 18), F.m(0, 0.92, 0)); const bw = new THREE.CircleGeometry(0.55, 18); bw.rotateX(-PI / 2); B.water.add(bw, F.m(0, 1.0, 0)); B.sheet.add(new THREE.CylinderGeometry(0.06, 0.13, 0.32, 10, 1, true), F.m(0, 1.14, 0));
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + PI / 4; B.glow.add(box(0.12, 0.06, 0.12), F.m(Math.sin(a) * (Rb + 0.05), 0.5, Math.cos(a) * (Rb + 0.05), a)); } col(F, 0, 0, Rb + 0.15); FB.water.push({ x: F.p.x, z: F.p.z }); };
  BUILD.runnel = (B, F, p) => { const L = p.len || 7.5; const n = Math.ceil(L / 1.0); for (let i = 0; i < n; i++) { const z = -L / 2 + (i + 0.5) * L / n; for (const sd of [-1, 1]) B.stone.add(box(0.16, 0.14, L / n), F.mg(sd * 0.3, 0.02, z)); const w = new THREE.PlaneGeometry(0.44, L / n); w.rotateX(-PI / 2); B.water.add(w, F.mg(0, 0.045, z)); } };
  BUILD.waterwall = (B, F) => { const L = 4.4, Hh = 1.9; B.stone.add(box(L, Hh, 0.5), F.m(0, Hh / 2, -0.3)); B.corten.add(box(L + 0.2, 0.08, 0.66), F.m(0, Hh + 0.04, -0.25)); const sh2 = new THREE.PlaneGeometry(L - 0.4, Hh - 0.3); B.sheet.add(sh2, F.m(0, Hh / 2 + 0.08, 0.0));
    B.stone.add(box(L, 0.4, 0.12), F.m(0, 0.2, 0.62)); for (const sd of [-1, 1]) B.stone.add(box(0.12, 0.4, 0.62), F.m(sd * (L / 2 - 0.06), 0.2, 0.3)); const tw = new THREE.PlaneGeometry(L - 0.24, 0.55); tw.rotateX(-PI / 2); B.water.add(tw, F.m(0, 0.3, 0.3)); for (let i = -2; i <= 2; i++) col(F, i * 0.95, 0, 0.55); FB.water.push({ x: F.p.x, z: F.p.z }); };
  BUILD.deck = (B, F) => { const W = 6.4, D = 4.4, Y = 0.32; B.wood.add(box(W, 0.08, D), F.m(0, Y - 0.04, 0)); for (const [x, z] of [[-W / 2 + 0.2, -D / 2 + 0.2], [W / 2 - 0.2, -D / 2 + 0.2], [-W / 2 + 0.2, D / 2 - 0.2], [W / 2 - 0.2, D / 2 - 0.2], [0, D / 2 - 0.2], [0, -D / 2 + 0.2]]) B.wood.add(box(0.16, Y + 0.3, 0.16), F.mg(x, (Y - 0.3) / 2 - 0.1, z));
    // railing on the view side and the two ends, a bench facing the view, steps at the back
    for (const [x0, z0, x1, z1] of [[-W / 2, D / 2, W / 2, D / 2], [-W / 2, -D / 2 + 1.2, -W / 2, D / 2], [W / 2, -D / 2 + 1.2, W / 2, D / 2]]) { const L = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0); const n = Math.max(1, Math.round(L / 1.4)); for (let i = 0; i <= n; i++) { const t = i / n; B.steel.add(box(0.05, 1.0, 0.05), F.m(x0 + (x1 - x0) * t, Y + 0.5, z0 + (z1 - z0) * t)); } B.wood.add(box(0.1, 0.06, L + 0.06), F.m((x0 + x1) / 2, Y + 1.02, (z0 + z1) / 2, a)); B.steel.add(box(0.025, 0.025, L), F.m((x0 + x1) / 2, Y + 0.55, (z0 + z1) / 2, a)); }
    B.wood.add(box(2.4, 0.07, 0.45), F.m(0, Y + 0.45, 0.6)); for (const sd of [-1, 1]) B.wood.add(box(0.08, 0.42, 0.4), F.m(sd * 1.05, Y + 0.21, 0.6)); seatSolid(F, 0, 0.6, 2.4, 0.45, Y + 0.46, 0, false, Y);
    for (let i = 0; i < 2; i++) B.wood.add(box(1.6, 0.06, 0.34), F.m(0, Y - 0.12 - i * 0.12, -D / 2 - 0.2 - i * 0.32)); deckSolid(F, W, D, Y); };
  BUILD.bleacher = (B, F) => { const W = 9.5, rows = 4, rise = 0.42, run = 0.75; for (let r = 0; r < rows; r++) { const z = -r * run, y = 0.45 + r * rise; B.wood.add(box(W, 0.06, 0.32), F.m(0, y, z)); B.wood.add(box(W, 0.05, 0.22), F.m(0, y - 0.38, z - 0.3)); seatSolid(F, 0, z, W, 0.34, y, 0); }
    for (let i = 0; i <= 4; i++) { const x = -W / 2 + 0.2 + i * (W - 0.4) / 4; B.steel.add(box(0.08, 0.5, 0.08), F.mg(x, 0.25, 0.05)); B.steel.add(box(0.08, 0.5 + rows * rise, 0.08), F.mg(x, (0.5 + rows * rise) / 2, -(rows - 1) * run - 0.1)); B.steel.add(box(0.06, 0.06, rows * run + 0.2), F.m(x, 0.3 + rows * rise * 0.5, -(rows - 1) * run / 2, 0, 1, 1, 1, Math.atan(rise / run))); col(F, x, 0.05, 0.12); col(F, x, -(rows - 1) * run - 0.1, 0.12); }
    B.steel.add(box(W, 0.05, 0.05), F.m(0, 0.45 + rows * rise + 0.55, -(rows - 1) * run - 0.15)); };
  BUILD.ring = (B, F, p) => { const Rg = p.big ? 2.3 : 1.7, th = 0.16; B.corten.add(new THREE.TorusGeometry(Rg, th, 10, 48), F.m(0, Rg + 0.55, 0)); B.stone.add(box(1.4, 0.5, 0.9), F.m(0, 0.25, 0)); B.corten.add(box(0.5, 0.35, 0.4), F.m(0, 0.62, 0)); col(F, 0, 0, 0.85); };
  BUILD.cairn = (B, F) => { let y = 0; for (let i = 0; i < 6; i++) { const s = 0.62 - i * 0.07; const g = new THREE.IcosahedronGeometry(1, 1); B.rock.add(g, F.m((i % 2 ? 0.04 : -0.03), y + s * 0.38, 0, i * 0.9, s, s * 0.42, s * 0.9)); y += s * 0.66; } col(F, 0, 0, 0.6); };
  BUILD.moonring = (B, F) => { const n = 14; for (let i = 0; i < n; i++) { const a = i / n * TAU; const g = new THREE.IcosahedronGeometry(1, 1); B.red.add(g, F.mg(Math.sin(a) * 2.6, 0.12, Math.cos(a) * 2.6, a, 0.45 + (i % 3) * 0.1, 0.32 + (i % 2) * 0.12, 0.4)); } const g = new THREE.IcosahedronGeometry(1, 2); B.red.add(g, F.mg(0, 0.35, 0, 0.3, 0.9, 0.7, 0.8)); col(F, 0, 0, 1.0); };
  // the labyrinth: concentric fieldstone rings with staggered openings (a seven-circuit walk read from above), one merged mesh
  BUILD.labyrinth = (B, F) => { const rings = 7, r0 = 1.6, dr = 1.15; const rk = mulberry(4242); for (let k = 0; k < rings; k++) { const Rr = r0 + k * dr; const gapA = (k % 2 ? PI : 0) + (k % 4 >= 2 ? 0.6 : -0.6); const n = Math.max(10, Math.round(TAU * Rr / 0.42));
      for (let i = 0; i < n; i++) { const a = i / n * TAU; let d = Math.atan2(Math.sin(a - gapA), Math.cos(a - gapA)); if (Math.abs(d) < 0.55 / Rr * 1.6) continue; if (k === rings - 1 && Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.18) continue; const s = 0.17 + rk() * 0.08; const g = new THREE.IcosahedronGeometry(1, 0); const [x, z] = F.w(Math.sin(a) * Rr, Math.cos(a) * Rr); B.rock.add(g, M4(x, gy(x, z) + s * 0.25, z, rk() * TAU, s * 1.3, s * 0.65, s)); } }
    const c = new THREE.IcosahedronGeometry(1, 1); B.rock.add(c, F.mg(0, 0.2, 0, 0.4, 0.55, 0.45, 0.5)); };
  // colliders and seats for the pieces (the engine's solids: E on a seat, walk-around posts)
  function col(F, lx, lz, r) { const [x, z] = F.w(lx, lz); COLLIDERS.push([x, z, r]); }
  function seatSolid(F, lx, lz, w, d, h, face, lie, base) { try { const [x, z] = F.w(lx, lz); const y0 = F.y + (base || 0); const sd = addSolid(x, z, F.p.yaw || 0, w, d, y0 - 0.05, F.y + h, "world"); if (sd) { sd.seat = true; sd.face = (F.p.yaw || 0) + (face || 0); if (lie) sd.lie = true; sd.fb = 1; FB.nSeats = (FB.nSeats || 0) + 1; } } catch (e) { err("seat", e); } }
  function deckSolid(F, W, D, Y) { try { addSolid(F.p.x, F.p.z, F.p.yaw || 0, W, D, F.y - 0.3, F.y + Y, "world"); } catch (e) { err("deck", e); } }

  // ───────────── defer: build the pieces at their final heights, merged per site and material ─────────────
  FB.cards = []; FB.water = [];
  function buildPieces() { const t0 = performance.now(); const Mt = mats(); const bySite = new Map(); for (const p of FB.pieces) { (bySite.get(p.site) || bySite.set(p.site, []).get(p.site)).push(p); }
    for (const [sid, list] of bySite) { const B = {}; for (const k in Mt) if (Mt[k] && Mt[k].isMaterial) B[k] = new MB(); let cx = 0, cz = 0;
      for (const p of list) { cx += p.x; cz += p.z; try { const F = new Frame(p, gy(p.x, p.z)); const f = BUILD[p.type]; if (f) f(B, F, p); } catch (e) { err("piece " + p.type, e); } }
      cx = Math.round(cx / list.length * 10) / 10; cz = Math.round(cz / list.length * 10) / 10; const g = new THREE.Group(); g.name = "fb_site_" + sid; g.userData.fbSkip = true; g.userData.landSkip = true;
      for (const k in B) { if (!B[k].i.length) continue; const geo = B[k].geo(); geo.translate(-cx, 0, -cz); geo.computeBoundingSphere(); geo.computeBoundingBox(); const mesh = new THREE.Mesh(geo, Mt[k]); mesh.castShadow = !/^(water|sheet|sign|checker|glow)$/.test(k); mesh.receiveShadow = true; mesh.name = "fb_" + sid + "_" + k; if (k === "sheet") mesh.renderOrder = 2; g.add(mesh); cnt("meshes"); }
      g.position.set(cx, 0, cz); scene.add(g); g.updateMatrixWorld(true); try { DETAIL.push({ g, R: 260 }); } catch (e) {} FB.groups.push({ id: sid, g, x: cx, z: cz }); }
    FB.t.pieces = Math.round(performance.now() - t0); }
  // my engine placements: plan_land's furniture kinds were re-seated by its defer pass (heights only): rewrite their packed
  // matrices so what is drawn matches; the rest (trees, plants, rocks) are seated by the engine's post-defer pass (planSeatProps)
  function fixMatrices() { let n = 0; for (const k of ART) for (const e of PLACE[k] || []) { if (!e.fb || !MODELS[k]) continue; try { const rb = Math.min(2.5, MODELS[k].radius * e[4] * 0.45); let lo = planGroundAt(e[0], e[2]); for (let q = 0; q < 8; q++) { const a = q / 8 * TAU; lo = Math.min(lo, planGroundAt(e[0] + Math.cos(a) * rb, e[2] + Math.sin(a) * rb)); } e.seated = true; planSeatEntry(k, e, lo - 0.03); n++; } catch (e2) { err("seat art", e2); } } for (const k of ["land_bench", "land_lantern", "land_ramada", "land_firering"]) for (const e of PLACE[k] || []) { if (!e.fb) continue; try { planSeatEntry(k, e, e[1]); n++; } catch (e2) { err("seat " + k, e2); } } FB.n.refit = n; }
  // talk cards at the sites (one per site, at its centre) and at the signs
  function cardsFor() { const S3 = (d) => (d && /^S3_/.test(d) ? "Stage Three · The Expanse" : "The Expanse · the land between"); for (const s of FB.sites) { if (!s.n || s.skip || !s.card) continue; hotspots.push({ x: s.x, z: s.z, r: Math.min(9, s.r * 0.5), t: s.name, k: S3(s.d), p: s.card }); cnt("cards"); } }
  // ───────────── the roaming people at the hangouts (PLAN_ROAM, R10) ─────────────
  function roamAreas() { const RO = window.PLAN_ROAM; if (!RO || !RO.area || RO.off) return; const C0 = cfg() || {}; const L = C0.lines || {}; const names = (C0.names || []).slice();
    const groups = []; for (const s of FB.sites) { if (!s.roam || !s.n || s.skip) continue; const g = groups.find((q) => Math.hypot(q.x - s.x, q.z - s.z) < 110); if (g) g.sites.push(s); else groups.push({ x: s.x, z: s.z, sites: [s] }); }
    groups.forEach((gr, gi) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const s of gr.sites) { x0 = Math.min(x0, s.x - s.r - 10); x1 = Math.max(x1, s.x + s.r + 10); z0 = Math.min(z0, s.z - s.r - 10); z1 = Math.max(z1, s.z + s.r + 10); }
      const line = gr.sites.some((s) => s.program === "hammock") ? "hammock" : "park"; const ppl = names.splice(0, 3).map((n) => ({ name: n })); const inBox = (x, z) => x > x0 && x < x1 && z > z0 && z < z1;
      const ents = []; for (const s of gr.sites) if (s.wk) { const ex = s.wk.px, ez = s.wk.pz; if (inBox(ex, ez)) ents.push({ x: ex, z: ez, face: Math.atan2(s.x - ex, s.z - ez), tag: "walk" }); } if (!ents.length) ents.push({ x: gr.sites[0].x, z: gr.sites[0].z + gr.sites[0].r, face: PI, tag: "walk" });
      const def = { id: "fillb_" + gi, max: 3, box: [x0, z0, x1, z1], people: ppl, lines: { [line]: L[line] || ["Nice day for it."] },
        ready: () => !!FB.built, levels: [{ base: (x, z) => planGroundAt(x, z), exact: true, block: () => false }],
        entries: () => ents, seeds: () => ents.concat(gr.sites.map((s) => ({ x: s.x + Math.cos(s.ang || 0) * 4, z: s.z + Math.sin(s.ang || 0) * 4 }))),
        pois: () => { const out = []; for (const s of gr.sites) { for (let i = 0; i < 3; i++) { const a = (s.ang || 0) + PI / 2 + i * 2.1; out.push({ kind: "chat", line, x: s.x + Math.cos(a) * 5.5, z: s.z + Math.sin(a) * 5.5, face: a + PI, tag: "chat" }); } out.push({ kind: "look", line, x: s.x + Math.cos(s.ang || 0) * 3.5, z: s.z + Math.sin(s.ang || 0) * 3.5, face: (s.ang || 0) + PI, dur: [6, 14], tag: "look" }); } return out; },
        seatInfo: (sd) => (inBox(sd.x, sd.z) && !sd.lie ? { kind: "sit", line, tag: "bench" } : null),
        weight: (p) => (p.kind === "sit" ? 2.2 : p.kind === "chat" ? 1.2 : 0.7), count: (h) => (h > 7 && h < 20.5 ? 3 : h > 6 && h < 22.5 ? 2 : 1),
        dur: { sit: [25, 70], chat: [15, 40], look: [6, 14] }, visible: () => true, sameZone: () => true };
      try { const A = RO.area(def); if (A) { FB.roam.push(def.id); cnt("roamAreas"); } } catch (e) { err("roam", e); } }); }
  function deferHook() { const t0 = performance.now(); for (const [nm, fn] of [["matrices", fixMatrices], ["pieces", buildPieces], ["cards", cardsFor], ["roam", roamAreas]]) { try { fn(); } catch (e) { err("defer " + nm, e); } } FB.built = true; FB.t.defer = Math.round(performance.now() - t0); }

  // ───────────── frame: the water moves, the signs and fountain lamps glow at night (near the player only) ─────────────
  let lastK = -1;
  function frameHook(dt) { if (!MT.water || !FB.groups.length) return; if (FRAME_N % 2) return; let near = false; try { const px = camera.position.x, pz = camera.position.z; for (const w of FB.water) if (Math.abs(w.x - px) < 160 && Math.abs(w.z - pz) < 160) { near = true; break; } } catch (e) {}
    if (near) { MT.ripple.offset.x += dt * 0.05; MT.ripple.offset.y += dt * 0.08; MT.fallTex.offset.y -= dt * 0.9; }
    if (FRAME_N % 12 === 0) { const nt = typeof night === "number" ? night : 0; const k = Math.max(0, Math.min(1, (nt - 0.12) / 0.48)); if (Math.abs(k - lastK) > 0.01) { lastK = k; MT.glow.emissiveIntensity = 2.0 * k; MT.sign.emissiveIntensity = 0.0; } } }

  function worldHook() { if (!window.PLAN) return; HK.terrain.push({ name: "fillB:terrain", fn: terrainHook }); }
  HK.world.push({ name: "fillB:world", fn: worldHook });
  HK.defer.push({ name: "fillB:defer", fn: deferHook });
  HK.frame.push({ name: "fillB:frame", fn: frameHook });
  FB.debug = { G, bitsAt, spotOK: (x, z, r, l) => (RA ? spotOK(x, z, r, l) : null), raster: () => RA };
})();
