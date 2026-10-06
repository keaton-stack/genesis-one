// R17 (Agent Q, 5 Oct 2026): the Crosswind Racquet Club, a desert-modern sports club on the S3_COMMONS / S3_DESIGN boundary.
// Classic script, loaded before plan_fill_a.js, plan_fill_b.js and client.js; one IIFE, client globals by bare name at call time.
// The user: "a sports club". What is here (HANDOFF_R17_SPORTS.md):
//   world    (the first world hook) the club footprint is a keep-out polygon (planKeepout) before any module plants anything.
//   terrain  the land is graded to one pad (the knoll in the middle is cut down), blended out and never under a road; a desert
//            garden of installed kinds round the edge; golf carts in the cart court.
//   world    the hub, the zone ring, the info cards, the café and pro shop venues, the entry walks (planRibbon), the overrides.
//   defer    two tennis courts, four pickleball courts and a padel court (acrylic slabs with crisp painted lines, nets, fences,
//            windscreens, the padel glass cage), tensile shade sails on raked masts, LED light masts, the clubhouse (rammed earth,
//            glass, timber soffits, a deep roof) with a walkable furnished inside (lobby, café, pro shop, lockers), the viewing
//            terrace and stand (sittable), the fitness lawn, the cart court, paving, signs; merged per material and per zone.
//   frame    night levels (the floodlit courts are an emissive term on the court material, no new lights; a few fixtures are
//            sources in the client's light pool), the rallies (rigged people playing points with a ball), the coach, the ball
//            machine challenge, stamps 379 to 383, the indoor camera, culling by distance.
// ?sc=0 turns the module off. window.PLAN_SPORTSCLUB: v, errs, n (counters), t (build ms), L (layout), api, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_SPORTSCLUB = window.PLAN_SPORTSCLUB || { v: "r17-0", errs: [], n: {} };
(function () {
  "use strict";
  const SC = window.PLAN_SPORTSCLUB; if (SC.v === "r17q-1") return; SC.v = "r17q-1"; SC.errs = SC.errs || []; SC.n = SC.n || {}; SC.t = {};
  const Q = location.search; SC.off = /[?&]sc=0\b/.test(Q);
  if (SC.off) return;
  const HK = window.PLAN_HOOKS;
  const err = (where, e) => { try { if (SC.errs.length < 40) SC.errs.push(where + ": " + ((e && e.message) || e)); if (SC.errs.length <= 6) console.warn("plan_sportsclub " + where + " failed:", (e && e.stack) || e); } catch (x) {} };
  const cnt = (k, n) => { SC.n[k] = (SC.n[k] || 0) + (n === undefined ? 1 : n); };
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hyp = Math.hypot;
  const nowMs = () => performance.now();
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const segD = (x, z, ax, az, bx, bz) => { const vx = bx - ax, vz = bz - az; const L2 = vx * vx + vz * vz || 1; const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1); return hyp(x - (ax + vx * t), z - (az + vz * t)); };
  function inPoly(poly, x, z) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
  function polyDist(poly, x, z) { let d = 1e9; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segD(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1])); return inPoly(poly, x, z) ? -d : d; }
  const has = (k) => { try { return !!(MODELS[k] && MODEL_SPECS[k]); } catch (e) { return false; } };
  const au = (u) => { try { return window.AV ? window.AV(u) : u; } catch (e) { return u; } };
  const nightK = () => { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } };
  const qual = () => { try { return localStorage.getItem("g1:quality") || "high"; } catch (e) { return "high"; } };
  const lowTier = () => { try { return ASSET.tier === "m"; } catch (e) { return false; } };
  const TIER = qual(); const ULTRA = TIER === "ultra", HIGHQ = TIER === "ultra" || TIER === "high";
  const hourNow = () => { try { return dayT() * 24; } catch (e) { return 12; } };

  // ───────────── config: plan/sportsclub.json (names, copy, people, lines) ─────────────
  let CFG = null;
  const cfgUrl = () => au("/plan/sportsclub.json?v=" + (window.BUILD || "dev"));
  try { fetch(cfgUrl()).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && !CFG) CFG = SC.cfg = d; }).catch((e) => err("cfg fetch", e)); } catch (e) { err("cfg", e); }
  function cfg() { if (CFG) return CFG; try { const x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = SC.cfg = JSON.parse(x.responseText); } catch (e) { err("cfg sync", e); } return CFG || {}; }
  function C(path, dflt) { let o = cfg(); const p = path.split("."); for (let i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }

  // ───────────── the layout (world metres, x east, z south) ─────────────
  // Two tennis courts side by side (36.6 x 33.5 m enclosure, courts north-south), four pickleball courts in a row (9.14 x 18.29 m
  // each), a padel court (10 x 20 m glass cage), the clubhouse (34 x 15 m) on the old knoll with its terrace and the viewing stand
  // facing the show court, the fitness lawn, the cart court off Gallery Lane, the desert garden and the club wall on the parkway.
  const L = SC.L = {
    pad: 21.5, F: 21.95,                                   // pad and clubhouse floor heights (set in the terrain hook)
    tennis: { x0: 464.5, x1: 498.03, z0: 573.0, z1: 609.57, cx: [473.645, 488.885], cz: 591.285 },
    pickle: { x0: 406.0, x1: 442.56, z0: 606.0, z1: 624.29, cx: [410.57, 419.71, 428.85, 437.99], cz: 615.145 },
    padel: { x0: 390.5, x1: 400.5, z0: 604.0, z1: 624.0, cx: 395.5, cz: 614.0 },
    club: { x0: 423.0, x1: 457.0, z0: 579.0, z1: 594.0 },
    terrace: { x0: 421.0, x1: 459.0, z0: 594.0, z1: 602.5 },
    stand: { x0: 458.6, x1: 463.8, z0: 585.0, z1: 603.0 },
    lawn: { x0: 452.0, x1: 492.0, z0: 612.5, z1: 624.5 },
    fore: [[430, 556], [462, 556], [462, 579], [423, 579], [419, 571], [424, 563]],
    garden: [[406.5, 579.5], [423, 579], [421, 594], [421, 602.5], [389, 602.5], [397.5, 591]],
    // the footprint (keep-out, clearing and grading): every zone plus a margin, kept 2 m or more off the parkway's dressed edge
    foot: [[429, 554], [463.5, 553.8], [464, 571], [500.5, 571], [500.5, 611], [494, 626.5], [446, 626.5], [388.2, 626.5], [388.6, 602], [397.5, 591], [406.5, 579.5], [415.5, 571], [423, 562]],
    hub: [446, 566],
    stalls: { x0: 437.0, n: 10, w: 1.75, z0: 556.4, d: 3.4 },
    masts: [], sails: [], poles: []
  };
  const T1 = { len: 23.77, wid: 10.97, sgl: 8.23, svc: 6.40, netC: 0.914, netP: 1.07, post: 0.914 };
  const PB = { len: 13.41, wid: 6.10, kit: 2.13, netC: 0.864, netP: 0.914, post: 0.3 };
  const PD = { len: 20.0, wid: 10.0, svc: 6.95, netC: 0.88, netP: 0.92 };
  const inFoot = (x, z, m) => (m ? polyDist(L.foot, x, z) < m : inPoly(L.foot, x, z));
  const inRect = (r, x, z, m) => { m = m || 0; return x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m; };
  // the clubhouse inside (walls 0.45 m), for the camera, the people and the zone
  const inLobby = (x) => x > 433.3 && x < 446.7;
  const inClub = (x, y, z) => x > L.club.x0 + 0.4 && x < L.club.x1 - 0.4 && z > L.club.z0 + 0.4 && z < L.club.z1 - 0.4 && (y === undefined || (y > L.F - 0.6 && y < L.F + (inLobby(x) ? 5.15 : 3.8)));

  // ───────────── the keep-out, at the front of the world phase ─────────────
  // The client runs every world hook (the modules' set pieces, plan_enrich's late planting pass) before the terrain hooks, so
  // the footprint is registered by a world hook unshifted to the front of the list (hookAll); nothing that tests the keep-outs
  // plants inside it. The terrain hook only calls this again in case the world hook did not run. The polygon registered is the
  // footprint grown by KEEP_M metres: the placers test a trunk's centre only, so a tree planted right on the edge would still
  // stand in the garden beds or against the padel glass.
  const KEEP_M = 0.6;
  function grow(P, m) { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += P[j][0] * P[i][1] - P[i][0] * P[j][1];
    const s = a > 0 ? 1 : -1, n = P.length, G = [];
    for (let i = 0; i < n; i++) { const p0 = P[(i + n - 1) % n], p1 = P[i], p2 = P[(i + 1) % n];
      const l1 = hyp(p1[0] - p0[0], p1[1] - p0[1]) || 1, l2 = hyp(p2[0] - p1[0], p2[1] - p1[1]) || 1;
      const n1x = s * (p1[1] - p0[1]) / l1, n1z = -s * (p1[0] - p0[0]) / l1, n2x = s * (p2[1] - p1[1]) / l2, n2z = -s * (p2[0] - p1[0]) / l2;
      let bx = n1x + n2x, bz = n1z + n2z; const bl = hyp(bx, bz); if (bl < 1e-6) { bx = n1x; bz = n1z; } else { bx /= bl; bz /= bl; }
      const k = m / Math.max(0.35, bx * n1x + bz * n1z); G.push([Math.round((p1[0] + bx * k) * 100) / 100, Math.round((p1[1] + bz * k) * 100) / 100]); }
    for (const q of P) if (!inPoly(G, q[0], q[1]) || polyDist(G, q[0], q[1]) > -m * 0.9) return null;   // a corner folded over: use the footprint itself
    return G; }
  function keepEarly() { if (SC.kept || !window.PLAN) return; try { const G = grow(L.foot, KEEP_M); if (!G) err("keepout", "grown polygon folded, the footprint is used"); L.keep = G || L.foot.map((q) => q.slice()); planKeepout(L.keep); SC.kept = true; } catch (e) { err("keepout", e); } }
  // ───────────── terrain hook: one graded pad, the desert garden, the carts ─────────────
  // Runs before plan_fill_a's and plan_fill_b's terrain passes (they are queued in the world phase, after this hook was listed);
  // the client's scatter (planVegetation, planRocks) runs after every terrain hook; all of them honour the keep-out polygon.
  const NAT = /^(bush\d|barrel_cactus|ocotillo|agave_cluster|prickly_pear|saguaro|saguaro_(young|mid|giant)|cholla|yucca_cluster|organ_pipe|ph_|land_(sagy|cholla|barrel|pear|organ|rock|rrock|bench|lantern)|paloverde|mesquite|ironwood|desertwillow|boulder|e1_(bench|tpost|lantern|planter)|lamp)/;
  function gridH(x, z) { try { return sampleGrid(H, T, x, z); } catch (e) { return getH(x, z); } }
  // A safety net, before anything is instanced: only placements made before the world hooks (the client's own street furniture
  // and allees) can still be here, and those are removed (logged in SC.cleared; nothing else holds them). A placement a module
  // keeps its own records of (plan_enrich e1, plan_fill_a fa, plan_fill_b fb, plan_flightacademy fa2) is never removed: it is
  // logged in SC.foreign for the handoff. The boot check expects both lists empty.
  const OWNED = (e) => !!(e.e1 || e.fa || e.fb || e.fa2);
  function clearFoot() { let n = 0; const gone = new Set(); const log = SC.cleared = [], fgn = SC.foreign = [];
    const tag = (kind, e) => [kind, Math.round(e[0] * 10) / 10, Math.round(e[2] * 10) / 10, e.e1 ? "enrich" : e.fa ? "fillA" : e.fb ? "fillB" : e.fa2 ? "flightAcademy" : e.keep ? "keep" : "-"];
    for (const kind in PLACE) { if (!NAT.test(kind)) continue; const Lk = PLACE[kind]; for (let i = Lk.length - 1; i >= 0; i--) { const e = Lk[i]; if (e.sc) continue; if (!inFoot(e[0], e[2], KEEP_M)) continue; if (OWNED(e)) { if (fgn.length < 60) fgn.push(tag(kind, e)); continue; } if (log.length < 60) log.push(tag(kind, e)); gone.add(Math.round(e[0] * 100) + ":" + Math.round(e[2] * 100)); Lk.splice(i, 1); n++; } }
    cnt("foreign", fgn.length);
    if (gone.size) for (let j = COLLIDERS.length - 1; j >= 0; j--) { const c = COLLIDERS[j]; if (gone.has(Math.round(c[0] * 100) + ":" + Math.round(c[1] * 100))) COLLIDERS.splice(j, 1); }
    for (let j = KEEPOUT.length - 1; j >= 0; j--) { const k = KEEPOUT[j]; if (inFoot(k[0], k[1]) && k[2] <= 9 && !k.sc) KEEPOUT.splice(j, 1); }
    cnt("cleared", n); return n; }
  // the pad: the mean of the natural ground round the footprint's edge, so the cut (the knoll) and the fill balance at the edge
  function padHeight() { const P = L.foot; let s = 0, w = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; const len = hyp(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.ceil(len / 2)); for (let k = 0; k < n; k++) { const t = k / n; s += gridH(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); w++; } } return Math.round((s / Math.max(1, w)) * 20) / 20; }
  function nearRoadCL(x, z, extra) { for (const r of ROADS) { const p = r.pts; if (!p || r.sc) continue; const hw = (r.w || 4) / 2 + extra; for (let i = 0; i < p.length - 1; i++) { const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1]; if (Math.min(ax, bx) - hw > x || Math.max(ax, bx) + hw < x || Math.min(az, bz) - hw > z || Math.max(az, bz) + hw < z) continue; if (segD(x, z, ax, az, bx, bz) < hw) return true; } } return false; }
  // the buildings near the club (casitas, the Flagship wings): their pads, porches and door mats keep the ground they were built on
  let BLD = null;
  function bldNear() { if (BLD) return BLD; BLD = []; for (const kind in PLACE) { const sp = MODEL_SPECS[kind], m = MODELS[kind]; if (!sp || !m || sp.prop || sp.vehicle) continue; for (const e of PLACE[kind]) { if (polyDist(L.foot, e[0], e[2]) > 40) continue; BLD.push({ x: e[0], z: e[2], yaw: e[3], hw: (m.sx || m.radius * 2) * e[4] / 2 + 4, hd: (m.sz || m.radius * 2) * e[4] / 2 + 4 }); } } return BLD; }
  function nearBld(x, z) { for (const b of bldNear()) { const c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = x - b.x, dz = z - b.z; const lx = dx * c - dz * s, lz = dx * s + dz * c; if (Math.abs(lx) <= b.hw && Math.abs(lz) <= b.hd) return true; } return false; }
  function grade() { if (typeof H === "undefined" || !H || !T) return 0; const cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1); const BL = 9, IN = 2.0; let n = 0;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const q of L.foot) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    const c0 = Math.max(0, Math.floor((x0 - BL - IN - 5 - T.xmin) / cw)), c1 = Math.min(T.cols - 1, Math.ceil((x1 + BL + IN + 5 - T.xmin) / cw)), r0 = Math.max(0, Math.floor((z0 - BL - IN - 5 - T.zmin) / ch)), r1 = Math.min(T.rows - 1, Math.ceil((z1 + BL + IN + 5 - T.zmin) / ch));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const x = T.xmin + c * cw, z = T.zmin + r * ch; const d = polyDist(L.foot, x, z); if (d > IN + BL) continue; let k = d <= IN ? 1 : 1 - sstep(0, BL, d - IN); if (d > IN && (nearRoadCL(x, z, 1.2) || nearBld(x, z))) k = 0; if (k <= 0) continue; const i = r * T.cols + c; H[i] = H[i] + (L.pad - H[i]) * k; n++; }
    return n; }
  function reseat() { let n = 0; for (const kind in PLACE) { if (!NAT.test(kind) && kind !== "cart") continue; const Lk = PLACE[kind]; for (const e of Lk) { if (nearBld(e[0], e[2])) continue; if (polyDist(L.foot, e[0], e[2]) > 14) continue; const g = getH(e[0], e[2]); if (Math.abs(g - e[1]) > 0.02 && Math.abs(g - e[1]) < 8) { e[1] = g; n++; } } } cnt("reseated", n); }
  // planting: installed kinds as engine placements (instanced, LOD'd, seated by the engine). Beds are bare graded ground (gravel
  // mulch drawn in the defer pass) at the club's edges, the west garden on the parkway and the forecourt islands.
  const PLANTED = SC.planted = [];
  function put1(kind, x, z, s, rot) { if (!has(kind)) return null; put(kind, x, z, rot === undefined ? R0() * TAU : rot, s); const Lk = PLACE[kind]; const e = Lk[Lk.length - 1]; e.sc = 1; e.keep = true; PLANTED.push([kind, x, z, s]); cnt("plants"); return e; }
  let R0 = mulberry(1717);
  const firstOf = (list) => { for (const k of list) if (has(k)) return k; return null; };
  function plantAll() { R0 = mulberry(1717); const rr = (a, b) => a + R0() * (b - a);
    const tree = (sp, x, z, s) => put1(firstOf(sp === "pv" ? ["paloverde"] : sp === "mq" ? ["mesquite", "paloverde"] : sp === "iw" ? ["ironwood", "paloverde"] : ["desertwillow", "paloverde"]), x, z, s);
    const acc = (sp, x, z, s) => { const k = { agave: "agave_cluster", barrel: "barrel_cactus", yucca: "yucca_cluster", oco: "ocotillo", grass: "bush2", sag: "saguaro", sagm: "saguaro_mid", sagy: "saguaro_young", sagg: "saguaro_giant", pear: "prickly_pear", succ: "ph_succulent_2", boulder: "ph_boulder_3", boulder2: "ph_boulder_1" }[sp]; return k ? put1(k, x, z, s) : null; };
    // the west garden on the parkway: a saguaro stand behind the club wall, palo verde shade, agave and grass drifts, boulders
    [[400.5, 593.5, "sagg", 0.95], [403.8, 596.5, "sagm", 1.0], [396.6, 597.8, "sag", 1.25], [413.6, 583.4, "sagy", 1.0], [409.5, 597.5, "sagm", 0.9]].forEach((q) => acc(q[2], q[0], q[1], q[3]));
    [[414.5, 590.5, "pv", 1.05], [418.5, 598.0, "iw", 0.95], [395.0, 600.2, "pv", 0.9]].forEach((q) => tree(q[2], q[0], q[1], q[3]));
    for (let i = 0; i < 26; i++) { const t = i / 26; const x = lerp(399.5, 421.5, t) + rr(-1.2, 1.2), z = lerp(600.8, 582.0, t) + rr(-1.6, 1.6); if (!inPoly(L.garden, x, z) || polyDist(L.garden, x, z) > -0.8) continue; if (hyp(x - 409.6, z - 586.6) < 6.2) continue; acc(i % 5 === 0 ? "oco" : i % 3 === 0 ? "agave" : i % 4 === 1 ? "barrel" : "grass", x, z, i % 5 === 0 ? rr(0.8, 1.1) : rr(0.6, 1.0)); }
    [[400.6, 596.4, "boulder", 1.1], [416.0, 594.5, "boulder2", 0.9], [398.8, 594.8, "boulder", 0.8]].forEach((q) => acc(q[2], q[0], q[1], q[3]));
    // the forecourt: shade trees in the islands at the west edge and behind the cart stalls, agave and grass at their feet
    // the forecourt's trees stand in raised corten rings (drawn in the defer pass); agave and grass at their feet
    SC.rings = [[427.5, 562.5, 1.6], [423.4, 570.8, 1.6], [433.0, 558.6, 1.5], [458.8, 558.8, 1.5]];
    [["pv", 1.0], ["pv", 0.95], ["mq", 0.85], ["pv", 0.9]].forEach((q, i) => { const r = SC.rings[i]; tree(q[0], r[0], r[1], q[1]); acc(i % 2 ? "agave" : "barrel", r[0] + 0.85, r[1] + 0.45, 0.7); acc("grass", r[0] - 0.8, r[1] + 0.55, 0.6); acc(i % 2 ? "barrel" : "agave", r[0] - 0.2, r[1] - 0.9, 0.65); });
    // the south walk and the lawn: a row of palo verde between the tennis block and the lawn, mesquite at the lawn's ends
    for (let i = 0; i < 3; i++) tree("pv", 455.5 + i * 10.4, 625.6, rr(0.85, 1.0));
    [[452.6, 625.4, "mq", 0.9], [490.4, 625.6, "mq", 1.0]].forEach((q) => tree(q[2], q[0], q[1], q[3]));
    // round the padel cage and the pickleball block's west end: grasses and agave in the gravel beds
    for (let i = 0; i < 9; i++) { if (i === 4) continue; const z = 605.0 + i * 2.4; acc(i % 3 === 0 ? "agave" : "grass", 402.8 + rr(-0.6, 0.6), z, rr(0.6, 0.95)); }
    [[389.4, 603.2, "sagy", 0.9], [389.0, 625.0, "agave", 0.9], [402.6, 625.6, "barrel", 1.0]].forEach((q) => acc(q[2], q[0], q[1], q[3]));
    cnt("planted", PLANTED.length); }
  function cartsAll() { const S = L.stalls; let n = 0; const used = [0, 1, 2, 4, 5, 7, 9]; for (const i of used) { const x = S.x0 + (i + 0.5) * S.w; if (!has("cart")) break; put("cart", x, S.z0 + S.d * 0.52, PI + (i % 2 ? 0.03 : -0.025), 1); const Lk = PLACE.cart; Lk[Lk.length - 1].sc = 1; Lk[Lk.length - 1].keep = true; n++; } cnt("carts", n); }
  function terrainHook() { if (!window.PLAN) return; const t0 = nowMs();
    keepEarly();
    try { L.pad = padHeight(); L.F = L.pad + 0.45; SC.n.pad = L.pad; } catch (e) { err("pad", e); }
    try { clearFoot(); } catch (e) { err("clear", e); }
    try { SC.n.graded = grade(); } catch (e) { err("grade", e); }
    try { reseat(); } catch (e) { err("reseat", e); }
    try { plantAll(); } catch (e) { err("plant", e); }
    try { cartsAll(); } catch (e) { err("carts", e); }
    SC.t.terrain = Math.round(nowMs() - t0); }

  // ───────────── world hook: the hub, the zone, the info cards, the venues, the entry walks, the overrides ─────────────
  const NAME = () => C("names.club", "Crosswind Racquet Club");
  const HS = SC.hs = [];
  function hs(key, x, z, r, extra) { const d = C("info." + key, null); if (!d) return null; const h = Object.assign({ x, z, r: r || 4, t: d.t, k: d.k, p: d.p, sc: key }, extra || {}); hotspots.push(h); HS.push(h); return h; }
  function nearestOn(id, x, z) { const r = ROADS.find((q) => q.plan === id); if (!r || !r.pts) return null; let best = null; for (let i = 0; i < r.pts.length - 1; i++) { const a = r.pts[i], b = r.pts[i + 1]; const vx = b[0] - a[0], vz = b[1] - a[1]; const L2 = vx * vx + vz * vz || 1; const t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / L2, 0, 1); const px = a[0] + vx * t, pz = a[1] + vz * t; const d = hyp(x - px, z - pz); if (!best || d < best.d) best = { x: px, z: pz, d, w: r.w || 4 }; } return best; }
  // a walk from (x, z) to the edge of road `id` (ending 0.5 m inside it, so the paths module sees a join), through `via`
  function walkTo(id, x, z, via, w, rid) { const q = nearestOn(id, x, z); if (!q) return null; const dx = x - q.x, dz = z - q.z, d = hyp(dx, dz) || 1; const e = [q.x + dx / d * (q.w / 2 - 0.5), q.z + dz / d * (q.w / 2 - 0.5)]; const pts = [e].concat(via || []).concat([[x, z]]); return ribbonSafe(pts, w || 2.6, rid); }
  function ribbonSafe(pts, w, rid) { try { const sf = { lift: 0.14, mat: planMats().dg }; const rec = planRibbon(pts, w, sf, rid); if (rec) { rec.sc = true; cnt("walks"); } return rec; } catch (e) { err("ribbon " + rid, e); return null; } }
  function worldHook() { if (!window.PLAN) return; const t0 = nowMs();
    try { planAddHub(NAME(), L.hub[0], L.hub[1]); planNavCats(); } catch (e) { err("hub", e); }
    try { zoneRings.push({ name: NAME(), label: C("names.short", "Crosswind Club"), center: [452, 592], r: 62, k: C("names.zoneK", "Tennis, pickleball and padel"), poly: L.foot.map((q) => q.slice()), col: "#4dde6f55", plan: "sportsclub" }); } catch (e) { err("zone", e); }
    try { const tc = L.tennis, pc = L.pickle;
      hs("arrival", 446, 566, 7); hs("tennis", tc.x0 - 0.8, 579.5, 3.2); hs("pickleball", 424.3, pc.z0 - 1.6, 4); hs("padel", L.padel.x1 + 1.6, 609.5, 3.2); hs("stand", 458.0, 584.2, 2.6);
      hs("lawn", 472.0, 611.2, 4); hs("lockers", 427.6, 586.5, 2.6); hs("wall", 409.6, 591.0, 4.5); hs("carts", 446.0, 561.5, 3.0); hs("sails", 481.3, 611.4, 2.4);
      SC.order = [{ x: 441.15, z: 585.15, r: 1.15, shop: "sc_cafe" }, { x: 451.2, z: 589.55, r: 1.3, shop: "sc_pro" }]; hs("cafe", 441.15, 585.15, 1.6, { play: "shop:sc_cafe" }); hs("pro", 451.2, 589.55, 1.8, { play: "shop:sc_pro" });
      SC.machine = { x: L.pickle.cx[3], z: L.pickle.z1 - 2.2 }; hs("machine", SC.machine.x, SC.machine.z, 2.2, { scGame: true }); } catch (e) { err("hotspots", e); }
    try { if (typeof VENUE === "object") { const V = C("venues", {}); VENUE.sc_cafe = { title: (V.cafe && V.cafe.title) || "The Baseline Café", k: (V.cafe && V.cafe.k) || "Coffee and lunch on the terrace", items: ["coffee", "meal"] }; VENUE.sc_pro = { title: (V.pro && V.pro.title) || "Crosswind Pro Shop", k: (V.pro && V.pro.k) || "Court gear and club wear", items: ((V.pro && V.pro.items) || ["hat_band", "hat_cap", "gear_tee_gb", "gear_shades", "gear_watch", "gear_backpack_gb", "gear_hoodie_gb"]).slice() }; } } catch (e) { err("venues", e); }
    // the walks: the cart drive to Gallery Lane, the west walk from the parkway through the garden, the south walk to the fire circle
    try { ribbonSafe([[460.6, 549.4], [459.4, 556.6]], 4.0, "sc_drive"); } catch (e) { err("drive", e); }
    try { walkTo("old_track", 409.0, 596.0, [[402.0, 590.4]], 2.6, "sc_west"); ribbonSafe([[409.0, 596.0], [415.2, 598.6], [420.4, 598.4]], 2.6, "sc_west2"); } catch (e) { err("west", e); }
    try { ribbonSafe([[421.0, 626.0], [422.4, 637.0], [426.2, 649.6]], 2.2, "sc_south"); } catch (e) { err("south", e); }
    try { installOverrides(); } catch (e) { err("overrides", e); }
    SC.t.world = Math.round(nowMs() - t0); }

  // ───────────── materials: a few shared families with stable program keys ─────────────
  // LIT family (standard + map + normal + roughness + vertex colours): courts, rammed earth, timber, pavers, travertine, turf,
  // gravel. One onBeforeCompile for all of them (one program): the per-vertex aLit is how much floodlight a surface gets at night,
  // added as emissive = albedo x uScLit x aLit (the courts read evenly floodlit; no new light). The fabric is the same patch double sided.
  const MT = SC.mat = {}; const U = SC.U = { lit: { value: 0 }, sign: { value: 0 } };
  const ANI = ULTRA ? 16 : HIGHQ ? 8 : 4;
  // the three big PBR sets (court acrylic, rammed earth, timber) are GPU-compressed on the desktop tier: tex/<name>.ktx2 through the
  // client's own R6 path (r6LoadKtx: one shared source, the JPEG as the fallback); ?sckt=0 keeps the JPEGs
  const KTXN = new Set(["sc_acrylic", "sc_acrylic_n", "sc_acrylic_r", "sc_rammed", "sc_rammed_n", "sc_rammed_r", "sc_timber", "sc_timber_n", "sc_timber_r"]);
  function ktxOk() { try { return !lowTier() && ASSET.tier === "d" && typeof r6LoadKtx === "function" && typeof ktx2Loader === "function" && !!ktx2Loader() && !/[?&]sckt=0\b/.test(Q); } catch (e) { return false; } }
  // the low tier (medium and low) skips the club's own normal and roughness maps: the colour maps only (the _m copies), so its GPU cost stays small
  function texL(name, srgb, rep, ext) { if (lowTier() && /_(n|r)$/.test(name)) return null; const url = "/tex/" + name + (lowTier() && /^sc_/.test(name) ? "_m" : "") + "." + (ext || "jpg"); let t;
    if (KTXN.has(name) && ktxOk()) { try { t = r6LoadKtx(new THREE.TextureLoader(), THREE.TextureLoader.prototype.load, au(url), au("/tex/" + name + ".ktx2"), null, null); cnt("ktx"); } catch (e) { err("ktx " + name, e); t = null; } }
    if (!t) t = new THREE.TextureLoader().load(au(url)); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANI; if (rep) t.repeat.set(rep, rep); t.userData.avShared = true; t.name = "sc_" + name; cnt("tex"); return t; }
  function repOf(t, rep) { if (!t) return null; const c = t.clone(); c.repeat.set(rep, rep); c.userData.avShared = true; return c; }
  function texC(key, srgb, rep, file) { try { if (typeof TEX !== "undefined" && TEX[key]) return repOf(TEX[key], rep); } catch (e) {} return file ? texL(file, srgb, rep) : null; }
  const LIT_VS = "#include <common>\nattribute float aLit;\nvarying float vScLit;\n#ifdef SC_SAIL\nvarying float vScNy;\n#endif";
  const LIT_FS = "#include <common>\nuniform float uScLit;\nvarying float vScLit;\n#ifdef SC_SAIL\nvarying float vScNy;\n#endif";
  function litObc(sh) { sh.uniforms.uScLit = U.lit; sh.vertexShader = sh.vertexShader.replace("#include <common>", LIT_VS).replace("#include <begin_vertex>", "#include <begin_vertex>\nvScLit = aLit;\n#ifdef SC_SAIL\nvScNy = normalize(mat3(modelMatrix) * objectNormal).y;\n#endif"); sh.fragmentShader = sh.fragmentShader.replace("#include <common>", LIT_FS).replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n#ifdef SC_SAIL\nfloat scUp = (gl_FrontFacing ? 1.0 : -1.0) * vScNy;\ntotalEmissiveRadiance += diffuseColor.rgb * (uScLit * vScLit) * mix(1.0, 0.22, smoothstep(-0.25, 0.35, scUp));\n#else\ntotalEmissiveRadiance += diffuseColor.rgb * (uScLit * vScLit);\n#endif"); }
  function sh(m, name) { m.name = name; m.userData.avShared = true; m.userData.scMat = true; return m; }
  function litMat(name, o) { const p = Object.assign({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true }, o); if (!p.normalMap) delete p.normalScale; if (!p.roughnessMap && p.roughness === 1) p.roughness = 0.82; for (const k of ["normalMap", "roughnessMap"]) if (!p[k]) delete p[k]; const m = new THREE.MeshStandardMaterial(p); m.onBeforeCompile = litObc; return sh(m, name); }
  function mats() { if (MT.court) return MT; const t0 = nowMs();
    // courts: acrylic (1.5 m tile), tinted by vertex colour; lines are the same surface in white
    MT.court = litMat("sc_court", { map: texL("sc_acrylic", true, 1 / 1.5), normalMap: texL("sc_acrylic_n", false, 1 / 1.5), roughnessMap: texL("sc_acrylic_r", false, 1 / 1.5), normalScale: new THREE.Vector2(0.95, 0.95) });
    // rammed earth (2.4 m tile): the clubhouse, the club wall, planter walls
    MT.earth = litMat("sc_earth", { map: texL("sc_rammed", true, 1 / 2.4), normalMap: texL("sc_rammed_n", false, 1 / 2.4), roughnessMap: texL("sc_rammed_r", false, 1 / 2.4), normalScale: new THREE.Vector2(0.9, 0.9) });
    // timber (the client's PBR set): soffits, slats, benches, the stand, furniture; warmed to cedar by vertex colour
    MT.wood = litMat("sc_wood", { map: texL("sc_timber", true, 1 / 1.2), normalMap: texL("sc_timber_n", false, 1 / 1.2), roughnessMap: texL("sc_timber_r", false, 1 / 1.2), normalScale: new THREE.Vector2(0.7, 0.7) });
    // concrete pavers (2 m tile): the forecourt, the walks, court aprons
    MT.pave = litMat("sc_pave", { map: texC("apron", true, 1 / 2.4, "apron"), normalMap: texC("apronN", false, 1 / 2.4, "apron_n"), roughnessMap: texC("apronR", false, 1 / 2.4, "apron_r"), normalScale: new THREE.Vector2(0.5, 0.5) });
    // travertine (3 m tile, three slabs a side): the terrace, the stand's treads, the café floor at the doors
    MT.stone = litMat("sc_stone", { map: texC("travertine", true, 1 / 2.0, "travertine"), normalMap: texL("travertine_n", false, 1 / 2.0), roughnessMap: texL("travertine_r", false, 1 / 2.0), normalScale: new THREE.Vector2(0.4, 0.4) });
    // turf (the fitness lawn) and the gravel mulch of the beds
    MT.turf = litMat("sc_turf", { map: texC("turf", true, 1 / 3.0, "turf"), normalMap: texC("turfN", false, 1 / 3.0, "turf_n"), roughnessMap: texC("turfR", false, 1 / 3.0, "turf_r"), normalScale: new THREE.Vector2(0.7, 0.7) });
    MT.gravel = litMat("sc_gravel", { map: lowTier() ? texC("dirt", true, 1 / 2.4, "dirt") : texL("gfx_gravel", true, 1 / 1.6),   // the low tier reuses the client's dirt set (already on the GPU)
      normalMap: texL("gfx_gravel_n", false, 1 / 1.6), roughnessMap: texL("sc_rammed_r", false, 1 / 3.1), normalScale: new THREE.Vector2(0.8, 0.8) });
    // terrazzo (inside): the clubhouse floor
    MT.terrazzo = litMat("sc_terrazzo", { color: 0xf0e6d6, map: texC("terrazzo", true, 1 / 2.0, "terrazzo"), normalMap: texL("terrazzo_n", false, 1 / 2.0), roughnessMap: texL("terrazzo_r", false, 1 / 2.0), normalScale: new THREE.Vector2(0.25, 0.25) });
    // tensile fabric: sails and windscreens (double sided; lit from below at night through the same patch)
    MT.fabric = litMat("sc_fabric", { map: texL("sc_fabric", true, 1 / 1.5), normalMap: texL("sc_fabric_n", false, 1 / 1.5), roughnessMap: texL("sc_fabric_r", false, 1 / 1.5), roughness: 1, side: THREE.DoubleSide, normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: 0.55 }); MT.fabric.defines = Object.assign(MT.fabric.defines || {}, { SC_SAIL: 1 });
    // painted steel (masts, posts, frames, poles, rails) and the bright metals (stainless, chrome) by vertex colour
    MT.steel = sh(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.46, metalness: 0.55 }), "sc_steel");
    MT.chrome = sh(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.12, metalness: 1.0 }), "sc_chrome_metal");
    // the soft goods: apparel, towels, cushions, rubber, balls, racquet frames (matte, no maps)
    MT.soft = sh(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.78, metalness: 0 }), "sc_soft");
    // glass (clubhouse glazing, the padel cage): thin, reflective, Fresnel through plan_bmat on high and ultra
    MT.glass = sh(new THREE.MeshStandardMaterial({ color: 0x5f7a80, transparent: true, opacity: 0.26, roughness: 0.04, metalness: 0.1, envMapIntensity: 1.5, depthWrite: false }), "sc_glass");
    MT.glass.forceSinglePass = true; MT.glass.side = THREE.DoubleSide;
    // wire meshes: chain-link fencing, the nets, the padel weld mesh (alpha blended, the mips average the wire to a haze far off)
    const wire = (name, rep) => { const m = new THREE.MeshStandardMaterial({ map: texL(name, true, rep, "png"), transparent: true, alphaTest: 0.035, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4, depthWrite: false }); m.forceSinglePass = true; return sh(m, "sc_" + name.replace("sc_", "") + "_wire"); };
    MT.chain = wire("sc_chain", 1 / 0.2); MT.net = wire("sc_net", 1 / 0.27); MT.weld = wire("sc_weld", 1 / 0.25);
    // emissive fixtures (LED lenses, bulbs, charger lights, screens): levels set every few frames from the night
    MT.emit = sh(new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }), "sc_emit");
    MT.halo = sh(new THREE.PointsMaterial({ size: 1, sizeAttenuation: true, map: haloTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true }), "sc_halo_glow");
    MT.pool = sh(new THREE.MeshBasicMaterial({ map: haloTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), "sc_pool_glow");
    // signs: one canvas atlas (club wordmark, court plaques, windscreen print, menus), cut out by alpha, backlit at night
    MT.sign = sh(new THREE.MeshStandardMaterial({ map: signTex(), alphaTest: 0.45, roughness: 0.55, metalness: 0.15, emissive: 0xffffff, emissiveMap: signTex(), emissiveIntensity: 0 }), "sc_sign_glow");
    { const at = texL("sc_art", true, 0, "jpg"); at.wrapS = at.wrapT = THREE.ClampToEdgeWrapping; MT.art = sh(new THREE.MeshStandardMaterial({ map: at, alphaTest: 0.45, roughness: 0.6, metalness: 0.0, emissive: 0xffffff, emissiveMap: at, emissiveIntensity: 0 }), "sc_art_prints"); }
    MT.ball = sh(new THREE.MeshStandardMaterial({ color: 0xd8f03c, roughness: 0.92, metalness: 0, emissive: 0x2a3008 }), "sc_ball");
    MT.shade = sh(new THREE.MeshBasicMaterial({ map: haloTex(), color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), "sc_ballshade");
    // R16 building material pass (plan_bmat, high and ultra): detail layer, grime and dust on the building surfaces
    try { const B = window.PLAN_BMAT; if (B && !B.off && typeof B.patchMat === "function") { for (const k of ["earth", "wood", "steel", "glass"]) if (B.patchMat(MT[k], k === "steel" ? { dust: false } : {})) cnt("bmat"); } } catch (e) { err("bmat", e); }
    SC.t.mats = Math.round(nowMs() - t0); return MT; }
  function haloTex() { if (MT._halo) return MT._halo; const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d"); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.18, "rgba(255,255,255,0.55)"); g.addColorStop(0.5, "rgba(255,255,255,0.14)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.userData.avShared = true; MT._halo = t; return t; }

  // ───────────── the sign atlas (2048 x 2048 canvas; rows of 256 px) ─────────────
  // row 0-1: the club wordmark (bronze letters, transparent ground) | row 2: windscreen print band | row 3: court plaques |
  // row 4: café menu board | row 5: pro shop and locker signs | row 6: the GIVEBACK mark | row 7: the scoreboard faces
  const SIGN = SC.sign = { W: 2048, H: 2048, cv: null, tex: null, logo: null };
  function signUV(x0, y0, x1, y1) { return [x0 / SIGN.W, 1 - y1 / SIGN.H, x1 / SIGN.W, 1 - y0 / SIGN.H]; }
  function font(px, w, fam) { return (w || 700) + " " + px + "px " + (fam || "'Space Grotesk', 'Segoe UI', system-ui, sans-serif"); }
  // the low tier draws the same atlas at half size (the uvs stay in the 2048 frame)
  function signTex() {
    if (SIGN.tex) return SIGN.tex;
    const cv = SIGN.cv = document.createElement("canvas");
    cv.width = cv.height = lowTier() ? 1024 : SIGN.W;
    drawSigns();
    const tx = new THREE.CanvasTexture(cv);
    tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = ANI; tx.userData.avShared = true;
    SIGN.tex = tx;
    try { const im = new Image(); im.onload = () => { try { SIGN.logo = im; drawSigns(); if (SIGN.tex) SIGN.tex.needsUpdate = true; } catch (e) { err("logo draw", e); } }; im.src = au("/tex/ar_logo.png"); } catch (e) { err("logo", e); }
    return tx;
  }
  function drawSigns() { const x = SIGN.cv.getContext("2d"); const W = SIGN.W; x.setTransform(SIGN.cv.width / W, 0, 0, SIGN.cv.height / SIGN.H, 0, 0); x.clearRect(0, 0, W, SIGN.H); const club = NAME().toUpperCase(); const word = C("names.word", "CROSSWIND"), sub = C("names.sub", "RACQUET CLUB");
    const bronze = (y0, y1) => { const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, "#d9b27a"); g.addColorStop(0.5, "#a8763f"); g.addColorStop(1, "#7a522a"); return g; };
    // rows 0-1: wordmark (letters only)
    x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = bronze(40, 330); x.font = font(250, 700); try { x.letterSpacing = "18px"; } catch (e) {} x.fillText(word, W / 2, 190); x.font = font(96, 600); try { x.letterSpacing = "30px"; } catch (e) {} x.fillText(sub, W / 2, 420); try { x.letterSpacing = "0px"; } catch (e) {}
    // row 2 (512-768): windscreen print: dark green band, the club name and the mark, light lettering
    x.fillStyle = "#1d3a2c"; x.fillRect(0, 512, W, 256); x.fillStyle = "#e9e3d2"; x.font = font(92, 700); try { x.letterSpacing = "10px"; } catch (e) {} x.fillText(club, W * 0.42, 640); try { x.letterSpacing = "0px"; } catch (e) {}
    x.fillStyle = "#4dde6f"; x.fillRect(0, 512, W, 10); x.fillRect(0, 758, W, 10);
    if (SIGN.logo) { const h = 150, w = h * 2; x.drawImage(SIGN.logo, W * 0.86 - w / 2, 640 - h / 2, w, h); }
    // row 3 (768-1024): court plaques 1 to 7 (dark steel plates, cream numerals) and PADEL
    const pl = ["1", "2", "3", "4", "5", "6", "P"]; for (let i = 0; i < 7; i++) { const cx = 128 + i * 256; x.fillStyle = "#23282a"; x.fillRect(cx - 118, 778, 236, 236); x.strokeStyle = "#a8763f"; x.lineWidth = 8; x.strokeRect(cx - 110, 786, 220, 220); x.fillStyle = "#f1ead8"; x.font = font(150, 700); x.fillText(pl[i], cx, 905); }
    // row 4 (1024-1280): café menu board (chalk on slate)
    x.fillStyle = "#202624"; x.fillRect(0, 1024, 1024, 256); x.fillStyle = "#f3eee0"; x.font = font(60, 700); x.fillText(C("venues.cafe.title", "The Baseline Café").toUpperCase(), 512, 1072); x.font = font(34, 500);
    const menu = C("menu", ["Espresso and cold brew", "Agua fresca, prickly pear", "Citrus and mint smoothie", "Green chile breakfast wrap", "Market salad, grilled corn"]); menu.forEach((m, i) => { x.textAlign = "left"; x.fillText(m, 60, 1130 + i * 30); }); x.textAlign = "center";
    x.fillStyle = "#4dde6f"; x.fillRect(60, 1094, 904, 4);
    // row 4 right (1024-2048 x): PRO SHOP and LOCKERS signs (bronze on dark), CAFE
    const tag = (txt, x0, y0, w0, h0) => { x.fillStyle = "#1f2224"; x.fillRect(x0, y0, w0, h0); x.fillStyle = bronze(y0, y0 + h0); x.font = font(Math.round(h0 * 0.48), 700); try { x.letterSpacing = "8px"; } catch (e) {} x.fillText(txt, x0 + w0 / 2, y0 + h0 / 2 + 4); try { x.letterSpacing = "0px"; } catch (e) {} };
    tag(C("names.pro", "PRO SHOP"), 1024, 1024, 1024, 128); tag(C("names.lockers", "LOCKERS"), 1024, 1152, 512, 128); tag(C("names.cafeShort", "CAFÉ"), 1536, 1152, 512, 128);
    // row 5 (1280-1536): the GIVEBACK mark on cream, and on dark
    x.fillStyle = "#14201a"; x.fillRect(1024, 1280, 1024, 256); if (SIGN.logo) x.drawImage(SIGN.logo, 1536 - 230, 1293, 460, 230);
    const blades = C("wayfinding", ["COURTS 1 · 2", "PICKLEBALL 3 TO 6", "PADEL", "FITNESS LAWN"]);
    for (let i = 0; i < 8; i++) { const y0 = 1280 + i * 32, txt = blades[i >> 1] || "", out = (i & 1) === 0; x.fillStyle = "#1d3a2c"; x.fillRect(0, y0, 1024, 32); x.fillStyle = "#a8763f"; x.fillRect(out ? 980 : 0, y0, 44, 32); x.fillStyle = "#f1ead8"; x.font = font(22, 700); try { x.letterSpacing = "4px"; } catch (e) {} x.textAlign = out ? "left" : "right"; x.fillText(out ? txt + "  \u203A" : "\u2039  " + txt, out ? 60 : 964, y0 + 17); try { x.letterSpacing = "0px"; } catch (e) {} x.textAlign = "center"; }
    // row 6 (1536-1792): scoreboard faces (dark panel, amber digits)
    for (let i = 0; i < 4; i++) { const x0 = i * 512; x.fillStyle = "#121516"; x.fillRect(x0 + 6, 1542, 500, 244); x.strokeStyle = "#3a4144"; x.lineWidth = 6; x.strokeRect(x0 + 10, 1546, 492, 236); x.fillStyle = "#ffb43a"; x.font = font(110, 700, "'JetBrains Mono', Consolas, monospace"); const sc = [["40", "30"], ["15", "0"], ["AD", "40"], ["6", "4"]][i]; x.fillText(sc[0], x0 + 150, 1670); x.fillText(sc[1], x0 + 362, 1670); x.fillStyle = "#e9e3d2"; x.font = font(30, 600); x.fillText("HOME", x0 + 150, 1580); x.fillText("GUEST", x0 + 362, 1580); }
    // row 7 (1792-2048): the court hours board and the challenge board
    x.fillStyle = "#1d3a2c"; x.fillRect(0, 1792, 1024, 256); x.fillStyle = "#f1ead8"; x.font = font(52, 700); x.fillText(C("names.hoursT", "COURTS OPEN DAWN TO 11 PM"), 512, 1860); x.font = font(34, 500); x.fillText(C("names.hoursK", "Lights on at dusk · book at the pro shop"), 512, 1930);
    x.fillStyle = "#23282a"; x.fillRect(1024, 1792, 1024, 256); x.fillStyle = "#ffb43a"; x.font = font(56, 700); x.fillText(C("names.machineT", "BALL MACHINE CHALLENGE"), 1536, 1862); x.fillStyle = "#f1ead8"; x.font = font(34, 500); x.fillText(C("names.machineK", "Ten balls · time your swing · press E"), 1536, 1932);
  }

  // ───────────── geometry kit: parts in world space per material, merged once per group ─────────────
  // Every vertex carries position, normal, uv (world metres along the part), colour and aLit (night floodlight share).
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1);
  const _cc = new Map();
  // vertex colours are authored as sRGB hex and converted to linear here (the game runs with colour management off, so
  // THREE.Color(hex) keeps the sRGB numbers; the textures are decoded from sRGB in the shader, so the two must agree)
  let CM_ON = null;   // whether THREE.Color already converts hex to linear: decided at the first use (client.js changes the setting after this module loads)
  function rgb(c) { if (Array.isArray(c)) return c; if (CM_ON === null) CM_ON = new THREE.Color(0x808080).r < 0.4; const k = c === undefined ? 0xffffff : c; let v = _cc.get(k); if (!v) { const q = new THREE.Color(k); if (!CM_ON) q.convertSRGBToLinear(); v = [q.r, q.g, q.b]; _cc.set(k, v); } return v; }
  class Kit {
    constructor(name) { this.name = name; this.m = {}; this.tris = 0; this.lit = 0; }
    // add a geometry (any, converted to non-indexed), coloured, with aLit = this.lit (or a function of the world position)
    add(mat, g, col, m4, litFn) { if (g.index) g = g.toNonIndexed(); if (m4) g.applyMatrix4(m4); if (!g.attributes.normal) g.computeVertexNormals(); const n = g.attributes.position.count; if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      if (!g.attributes.color) { const c = rgb(col), ca = new Float32Array(n * 3); for (let i = 0; i < n; i++) { ca[i * 3] = c[0]; ca[i * 3 + 1] = c[1]; ca[i * 3 + 2] = c[2]; } g.setAttribute("color", new THREE.BufferAttribute(ca, 3)); }
      if (!g.attributes.aLit) { const la = new Float32Array(n); const P = g.attributes.position.array; const f = litFn || this.litFn; for (let i = 0; i < n; i++) la[i] = f ? f(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]) : this.lit; g.setAttribute("aLit", new THREE.BufferAttribute(la, 1)); }
      (this.m[mat] || (this.m[mat] = [])).push(g); this.tris += n / 3; return g; }
    place(mat, g, col, x, y, z, ry, rx, rz, sx, sy, sz) { _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(x || 0, y || 0, z || 0), _q, _v2.set(sx || 1, sy || 1, sz || 1)); return this.add(mat, g, col, _m4); }
    // a box with world-scale uvs (t metres per texture repeat; 1 = uv in metres)
    box(mat, col, w, h, d, x, y, z, ry, t, rx, rz) { const g = new THREE.BoxGeometry(w, h, d); uvBox(g, w, h, d, t || 1); return this.place(mat, g, col, x, y, z, ry, rx, rz); }
    // an axis-aligned box from min/max corners (handy for walls and slabs)
    boxMM(mat, col, x0, y0, z0, x1, y1, z1, t) { return this.box(mat, col, x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, t); }
    cyl(mat, col, r0, r1, h, x, y, z, seg, open, ry, rx, rz) { const g = new THREE.CylinderGeometry(r0, r1, h, seg || 12, 1, !!open); uvCyl(g, r0, h); return this.place(mat, g, col, x, y, z, ry, rx, rz); }
    sph(mat, col, r, x, y, z, seg, sx, sy, sz) { return this.place(mat, new THREE.SphereGeometry(r, seg || 10, Math.max(5, (seg || 10) >> 1)), col, x, y, z, 0, 0, 0, sx, sy, sz); }
    // a round bar between two points
    tube(mat, col, A, B, r, seg, r1) { const d = _v3.subVectors(B, A), L = d.length(); if (L < 1e-4) return null; const g = new THREE.CylinderGeometry(r1 === undefined ? r : r1, r, L, seg || 8, 1, true); uvCyl(g, r, L); _q.setFromUnitVectors(_v1.set(0, 1, 0), d.clone().normalize()); _m4.compose(_v2.addVectors(A, B).multiplyScalar(0.5), _q, _s1); return this.add(mat, g, col, _m4); }
    // a square bar between two points (posts, rails, frames): w x d section, d along `up` ([0, 1, 0] by default)
    bar(mat, col, A, B, w, d, t) { const dir = _v3.subVectors(B, A), L = dir.length(); if (L < 1e-4) return null; const g = new THREE.BoxGeometry(w, L, d === undefined ? w : d); uvBox(g, w, L, d === undefined ? w : d, t || 1); _q.setFromUnitVectors(_v1.set(0, 1, 0), dir.clone().normalize()); _m4.compose(_v2.addVectors(A, B).multiplyScalar(0.5), _q, _s1); return this.add(mat, g, col, _m4); }
    // a flat quad from 4 world points (a b c d counter-clockwise seen from the front), uv in metres along ab and ad
    quad(mat, col, a, b, c, d, uvs, litFn) { const P = new Float32Array([a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]]); const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3));
      const lu = hyp(b[0] - a[0], b[1] - a[1], b[2] - a[2]), lv = hyp(d[0] - a[0], d[1] - a[1], d[2] - a[2]); const u = uvs || [0, 0, lu, lv]; g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([u[0], u[1], u[2], u[1], u[2], u[3], u[0], u[1], u[2], u[3], u[0], u[3]]), 2)); g.computeVertexNormals(); return this.add(mat, g, col, null, litFn); }
    // a horizontal grid patch over a rectangle at height y (subdivided every `step` m so per-vertex light reads smooth), uv in metres
    flat(mat, col, x0, z0, x1, z1, y, step, litFn, uvOff) { const nx = Math.max(1, Math.ceil((x1 - x0) / (step || 4))), nz = Math.max(1, Math.ceil((z1 - z0) / (step || 4))); const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz); g.rotateX(-PI / 2); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2); const P = g.attributes.position, UV = g.attributes.uv; const ou = uvOff ? uvOff[0] : 0, ov = uvOff ? uvOff[1] : 0; for (let i = 0; i < P.count; i++) UV.setXY(i, P.getX(i) + ou, -P.getZ(i) + ov); return this.add(mat, g, col, null, litFn); }
    // a horizontal polygon (fan from the centroid, convex or star-shaped), uv in metres
    poly(mat, col, pts, y, litFn) { let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; } cx /= pts.length; cz /= pts.length; const P = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const ny = (b[1] - cz) * (a[0] - cx) - (b[0] - cx) * (a[1] - cz); if (ny >= 0) P.push(cx, y, cz, b[0], y, b[1], a[0], y, a[1]); else P.push(cx, y, cz, a[0], y, a[1], b[0], y, b[1]); } const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3)); const UVa = new Float32Array(P.length / 3 * 2); for (let i = 0; i < P.length / 3; i++) { UVa[i * 2] = P[i * 3]; UVa[i * 2 + 1] = -P[i * 3 + 2]; } g.setAttribute("uv", new THREE.BufferAttribute(UVa, 2)); g.computeVertexNormals(); return this.add(mat, g, col, null, litFn); }
    merged() { const out = {}; for (const k in this.m) { const g = mergeAll(this.m[k]); if (g) out[k] = g; } return out; }
    // build meshes into a group: one mesh per material; options cast (shadow casting), receive
    build(grp, opts) { opts = opts || {}; const geos = this.merged(), out = []; for (const k in geos) { const mt = MT[k]; if (!mt) { err("kit mat", k); continue; } const me = new THREE.Mesh(geos[k], mt); me.name = "sc " + this.name + " " + k; const noCast = opts.noCast && opts.noCast.indexOf(k) >= 0; me.castShadow = opts.cast !== false && !mt.transparent && !noCast && k !== "emit"; me.receiveShadow = !mt.transparent && k !== "emit"; me.userData.shSet = true; me.userData.noSolid = true; if (mt.transparent) me.renderOrder = 2; grp.add(me); out.push(me); cnt("meshes"); cnt("tris", Math.round(geos[k].attributes.position.count / 3)); } this.m = {}; return out; }
  }
  function mergeAll(list) { if (!list || !list.length) return null; let n = 0; for (const g of list) n += g.attributes.position.count; if (!n) return null;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2), CO = new Float32Array(n * 3), LI = new Float32Array(n); let o = 0;
    for (const g of list) { const c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); UV.set(g.attributes.uv.array, o * 2); CO.set(g.attributes.color.array, o * 3); LI.set(g.attributes.aLit.array, o); o += c; g.dispose(); }
    const r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(UV, 2)); r.setAttribute("color", new THREE.BufferAttribute(CO, 3)); r.setAttribute("aLit", new THREE.BufferAttribute(LI, 1)); r.computeBoundingBox(); r.computeBoundingSphere(); return r; }
  function uvBox(g, w, h, d, t) { const uv = g.attributes.uv; const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } }
  function uvCyl(g, r, h) { const uv = g.attributes.uv; const c = TAU * Math.max(r, 0.01); for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * c, uv.getY(i) * h); }
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ───────────── courts: slabs, crisp lines, nets, fences, windscreens, the padel cage ─────────────
  // The court surface is partitioned along every line edge, so the lines are geometry of the same surface (exact edges at any
  // distance, no decal, no z-fight): each cell takes white, the playing colour or the surround colour.
  const COL = { tBlue: 0x3c638f, tGreen: 0x4f7a55, pBlue: 0x3f6c9c, pGreen: 0x557d5b, pKit: 0x5583b0, dBlue: 0x3a6ea8, line: 0xf2f1ea, conc: 0xb9b2a6, steel: 0x30373a, steelG: 0x2a3a31, wind: 0x22322b, post: 0x2a2f31, white: 0xf3f1ea, rope: 0xe8e4d8, frame: 0x161a1b };
  const FIX = SC.fix = [];   // the floodlight heads: { x, y, z, tx, tz, kind }
  // relative illuminance of the floodlights at a point (cos^3 law), normalised per block in litFor
  function illum(x, z, list) { let s = 0; for (const f of list) { const h = Math.max(1, f.y - L.pad), dx = x - f.x, dz = z - f.z; const r2 = dx * dx + dz * dz; s += h / Math.pow(h * h + r2, 1.5) * (1 + 0.6 * Math.max(0, ((f.tx - f.x) * dx + (f.tz - f.z) * dz) / (hyp(f.tx - f.x, f.tz - f.z) * Math.sqrt(r2) + 1e-6))); } return s; }
  function litFor(list, cx, cz, k) { const e0 = illum(cx, cz, list) || 1; return (x, y, z) => clamp(illum(x, z, list) / e0, 0, 1.3) * (k || 1); }
  // a partitioned rectangle surface: rect = block bounds, inner = playing area [x0, x1, z0, z1], lines = list of [x0, x1, z0, z1]
  function courtSurface(K, y, rect, inner, lines, colIn, colOut, litFn, extra) { const xs = new Set([rect.x0, rect.x1]), zs = new Set([rect.z0, rect.z1]); const add = (a, b) => { xs.add(+a.toFixed(4)); xs.add(+b.toFixed(4)); };
    for (const r of [inner].concat(lines).concat(extra || [])) { if (!r) continue; xs.add(+r[0].toFixed(4)); xs.add(+r[1].toFixed(4)); zs.add(+r[2].toFixed(4)); zs.add(+r[3].toFixed(4)); }
    // split long cells so the per-vertex light falls off smoothly
    const split = (S, a, b) => { const out = [...S].filter((v) => v >= a - 1e-6 && v <= b + 1e-6).sort((p, q) => p - q); const res = [out[0]]; for (let i = 1; i < out.length; i++) { const d = out[i] - out[i - 1]; const n = Math.ceil(d / 2.6); for (let k = 1; k < n; k++) res.push(out[i - 1] + d * k / n); res.push(out[i]); } return res; };
    const X = split(xs, rect.x0, rect.x1), Z = split(zs, rect.z0, rect.z1); let cells = 0;
    const inR = (r, x, z) => x > r[0] && x < r[1] && z > r[2] && z < r[3];
    for (let i = 0; i < X.length - 1; i++) for (let j = 0; j < Z.length - 1; j++) { const x0 = X[i], x1 = X[i + 1], z0 = Z[j], z1 = Z[j + 1]; if (x1 - x0 < 1e-4 || z1 - z0 < 1e-4) continue; const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2; let col = colOut; if (inner && inR(inner, mx, mz)) col = colIn; if (extra) for (const r of extra) if (inR(r, mx, mz)) col = r[4]; for (const r of lines) if (inR(r, mx, mz)) { col = COL.line; break; }
      K.quad("court", col, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [x0, -z1, x1, -z0], litFn); cells++; }
    return cells; }
  // the slab's edge (a concrete band round the court block) and the apron kerb
  function slabEdge(K, r, y, depth) { const c = COL.conc; K.boxMM("pave", c, r.x0 - 0.12, y - depth, r.z0 - 0.12, r.x1 + 0.12, y - 0.004, r.z0); K.boxMM("pave", c, r.x0 - 0.12, y - depth, r.z1, r.x1 + 0.12, y - 0.004, r.z1 + 0.12); K.boxMM("pave", c, r.x0 - 0.12, y - depth, r.z0, r.x0, y - 0.004, r.z1); K.boxMM("pave", c, r.x1, y - depth, r.z0, r.x1 + 0.12, y - 0.004, r.z1); }
  // tennis lines for one court centred at (cx, cz), long axis along z
  function tennisLines(cx, cz) { const w = T1.wid / 2, s = T1.sgl / 2, l = T1.len / 2, sv = T1.svc, lw = 0.05, bw = 0.10; const L0 = [];
    L0.push([cx - w, cx + w, cz - l, cz - l + bw], [cx - w, cx + w, cz + l - bw, cz + l]);            // baselines (10 cm, inside the court)
    L0.push([cx - w, cx - w + lw, cz - l, cz + l], [cx + w - lw, cx + w, cz - l, cz + l]);            // doubles sidelines
    L0.push([cx - s, cx - s + lw, cz - l, cz + l], [cx + s - lw, cx + s, cz - l, cz + l]);            // singles sidelines
    L0.push([cx - s, cx + s, cz - sv - lw / 2, cz - sv + lw / 2], [cx - s, cx + s, cz + sv - lw / 2, cz + sv + lw / 2]);   // service lines
    L0.push([cx - lw / 2, cx + lw / 2, cz - sv, cz + sv]);                                               // centre service line
    L0.push([cx - lw / 2, cx + lw / 2, cz - l + bw, cz - l + bw + 0.10], [cx - lw / 2, cx + lw / 2, cz + l - bw - 0.10, cz + l - bw]);   // centre marks
    return L0; }
  function pickleLines(cx, cz) { const w = PB.wid / 2, l = PB.len / 2, k = PB.kit, lw = 0.05; const L0 = [];
    L0.push([cx - w, cx + w, cz - l, cz - l + lw], [cx - w, cx + w, cz + l - lw, cz + l]);
    L0.push([cx - w, cx - w + lw, cz - l, cz + l], [cx + w - lw, cx + w, cz - l, cz + l]);
    L0.push([cx - w, cx + w, cz - k - lw, cz - k], [cx - w, cx + w, cz + k, cz + k + lw]);            // non-volley (kitchen) lines
    L0.push([cx - lw / 2, cx + lw / 2, cz - l, cz - k - lw], [cx - lw / 2, cx + lw / 2, cz + k + lw, cz + l]);   // centre lines
    return L0; }
  function padelLines(cx, cz) { const w = PD.wid / 2, sv = PD.svc, lw = 0.05; return [[cx - w, cx + w, cz - sv - lw / 2, cz - sv + lw / 2], [cx - w, cx + w, cz + sv - lw / 2, cz + sv + lw / 2], [cx - lw / 2, cx + lw / 2, cz - sv, cz + sv]]; }
  // a net across x from xa to xb at z, top tA at the posts sagging to tC at the centre; posts and headband
  function net(K, xa, xb, z, y, tA, tC, postR, bandH) { const n = 14; const top = (t) => tA + (tC - tA) * (1 - Math.pow(2 * t - 1, 2)); const L0 = xb - xa;
    for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n; const x0 = xa + L0 * t0, x1 = xa + L0 * t1; const y0 = y + top(t0), y1 = y + top(t1); K.quad("net", 0xffffff, [x0, y + 0.03, z], [x1, y + 0.03, z], [x1, y1 - bandH, z], [x0, y0 - bandH, z], [x0, 0, x1, Math.max(y0, y1) - y]);
      // the white headband folded over the cable (a thin strip, both faces)
      const a = V(x0, y0, z), b = V(x1, y1, z); K.bar("soft", COL.white, V(x0, y0 - bandH / 2, z), V(x1, y1 - bandH / 2, z), bandH, 0.012); }
    K.bar("soft", COL.white, V(xa + L0 / 2, y + 0.02, z), V(xa + L0 / 2, y + tC - bandH, z), 0.05, 0.008);   // centre strap
    for (const px of [xa, xb]) { K.cyl("steel", COL.post, postR, postR, tA + 0.06, px, y + (tA + 0.06) / 2, z, 12); K.cyl("steel", COL.post, postR * 1.25, postR * 1.25, 0.05, px, y + tA + 0.06, z, 12); }
    // the winder on one post
    K.box("chrome", 0xb8bcbf, 0.03, 0.12, 0.03, xb + postR + 0.02, y + 0.62, z, 0); }
  // a fence run from A to B (x, z) with posts every `bay` m, height h, chain-link, rails; windscreen from w0 to w1 m (or none)
  // print: put the club print band on the windscreen's outer face (side +1/-1 relative to the run's left normal)
  const SOL = SC.solids = [];
  function solidSeg(ax, az, bx, bz, t, y0, y1, tag, gaps) { const L0 = hyp(bx - ax, bz - az); if (L0 < 0.05) return; const ux = (bx - ax) / L0, uz = (bz - az) / L0; let segs = [[0, L0]]; if (gaps) for (const g of gaps) { const nx = []; for (const s of segs) { if (g[1] <= s[0] || g[0] >= s[1]) { nx.push(s); continue; } if (g[0] > s[0]) nx.push([s[0], g[0]]); if (g[1] < s[1]) nx.push([g[1], s[1]]); } segs = nx; }
    for (const s of segs) { const m = (s[0] + s[1]) / 2, len = s[1] - s[0]; if (len < 0.05) continue; const sd = addSolid(ax + ux * m, az + uz * m, Math.atan2(ux, uz), t, len, y0, y1, tag || "sc"); if (sd) { sd.noStep = true; SOL.push(sd); } } }
  function fenceRun(K, A, B, y, h, o) { o = o || {}; const L0 = hyp(B[0] - A[0], B[1] - A[1]); const n = Math.max(1, Math.round(L0 / (o.bay || 3.0))); const ux = (B[0] - A[0]) / L0, uz = (B[1] - A[1]) / L0; const nxL = -uz, nzL = ux;   // left normal
    const gaps = o.gates || [];   // [s0, s1] metres along the run
    const inGap = (s) => gaps.some((g) => s > g[0] + 0.02 && s < g[1] - 0.02);
    const pts = []; for (let i = 0; i <= n; i++) pts.push(L0 * i / n); for (const g of gaps) { pts.push(g[0], g[1]); } pts.sort((a, b) => a - b);
    const P = (s, yy) => [A[0] + ux * s, yy, A[1] + uz * s];
    const postC = o.postCol || COL.steel, r = o.postR || 0.032;
    for (const s of [...new Set(pts.map((v) => +v.toFixed(3)))]) { const p = P(s, y); K.cyl("steel", postC, r, r, h, p[0], y + h / 2, p[2], 8); K.sph("steel", postC, r * 1.25, p[0], y + h, p[2], 6); }
    const segs = []; let s0 = 0; for (const g of gaps.slice().sort((a, b) => a[0] - b[0])) { if (g[0] > s0) segs.push([s0, g[0]]); s0 = g[1]; } if (s0 < L0) segs.push([s0, L0]);
    for (const sg of segs) { const a = P(sg[0], y), b = P(sg[1], y); const len = sg[1] - sg[0]; if (len < 0.05) continue;
      // chain-link (both faces drawn by the double sided wire material)
      K.quad("chain", 0xffffff, [a[0], y + 0.04, a[2]], [b[0], y + 0.04, b[2]], [b[0], y + h - 0.03, b[2]], [a[0], y + h - 0.03, a[2]], [sg[0], 0, sg[1], h]);
      K.tube("steel", postC, V(a[0], y + h - 0.02, a[2]), V(b[0], y + h - 0.02, b[2]), r * 0.8, 6);   // top rail
      if (h > 2.4) K.tube("steel", postC, V(a[0], y + (o.mid || 1.9), a[2]), V(b[0], y + (o.mid || 1.9), b[2]), r * 0.7, 6);
      // windscreen on the inside face, lower w0..w1 m, dark green fabric, with an inset hem; a printed band on chosen runs
      if (o.wind) { const w0 = o.wind[0], w1 = o.wind[1], off = 0.025 * (o.windSide || 1); const q0 = [a[0] + nxL * off, y + w0, a[2] + nzL * off], q1 = [b[0] + nxL * off, y + w0, b[2] + nzL * off]; const ww = (o.windSide || 1) > 0;
        const c0 = ww ? q0 : q1, c1 = ww ? q1 : q0; K.quad("fabric", COL.wind, [c0[0], c0[1], c0[2]], [c1[0], c1[1], c1[2]], [c1[0], y + w1, c1[2]], [c0[0], y + w1, c0[2]], [0, 0, len, w1 - w0], () => 0.15);
        if (o.print) { const off2 = off * 1.6, pz = (w0 + w1) / 2, ph = Math.min(0.62, (w1 - w0) * 0.42); const uv = signUV(0, 512, 2048, 768); const reps = Math.max(1, Math.round(len / 9)); for (let k = 0; k < reps; k++) { const s1 = sg[0] + len * k / reps + 0.2, s2 = sg[0] + len * (k + 1) / reps - 0.2; const pa = P(s1, 0), pb = P(s2, 0); const sx = -nxL * off2, sz = -nzL * off2;   // outer face of the screen
            const A1 = [pa[0] + sx, y + pz - ph / 2, pa[2] + sz], B1 = [pb[0] + sx, y + pz - ph / 2, pb[2] + sz]; const out = ww ? [B1, A1] : [A1, B1]; K.quad("sign", 0xffffff, out[0], out[1], [out[1][0], y + pz + ph / 2, out[1][2]], [out[0][0], y + pz + ph / 2, out[0][2]], uv); } } }
    }
    // gate leaves: a framed panel swung open 70 degrees from the hinge end of each gap
    for (const g of gaps) { const hinge = P(g[0], y); const wdt = g[1] - g[0]; const ang = Math.atan2(ux, uz) - (o.gateIn ? -1.2 : 1.2); const ex = hinge[0] + Math.sin(ang) * wdt, ez = hinge[2] + Math.cos(ang) * wdt; const gh = Math.min(h, 2.2);
      K.quad("chain", 0xffffff, [hinge[0], y + 0.08, hinge[2]], [ex, y + 0.08, ez], [ex, y + gh, ez], [hinge[0], y + gh, hinge[2]], [0, 0, wdt, gh]);
      for (const yy of [0.08, gh]) K.tube("steel", postC, V(hinge[0], y + yy, hinge[2]), V(ex, y + yy, ez), r * 0.7, 6); K.tube("steel", postC, V(ex, y + 0.08, ez), V(ex, y + gh, ez), r * 0.7, 6);
      K.tube("steel", postC, V(hinge[0], y + gh, hinge[2]), V(P(g[1], y)[0], y + gh, P(g[1], y)[2]), r * 0.6, 6);   // header over the opening
    }
    if (o.solid !== false) solidSeg(A[0], A[1], B[0], B[1], 0.14, y - 0.2, y + h, "sc", gaps);
    cnt("fenceM", Math.round(L0)); }
  // the court blocks
  function buildCourts(K) { const y = L.pad + 0.10; const tb = L.tennis, pk = L.pickle, pd = L.padel;
    // tennis: two courts; blue playing area, green surround; slab edge
    const tFix = FIX.filter((f) => f.kind === "t"), litT = litFor(tFix, (tb.x0 + tb.x1) / 2, tb.cz, 1.0);
    const tLines = [], inner = [], cells = [];
    for (const cx of tb.cx) { tLines.push(...tennisLines(cx, tb.cz)); }
    const ext = tb.cx.map((cx) => [cx - T1.wid / 2, cx + T1.wid / 2, tb.cz - T1.len / 2, tb.cz + T1.len / 2, COL.tBlue]);
    cells.push(courtSurface(K, y, tb, null, tLines, COL.tBlue, COL.tGreen, litT, ext)); slabEdge(K, tb, y, 0.16);
    for (const cx of tb.cx) net(K, cx - T1.wid / 2 - T1.post, cx + T1.wid / 2 + T1.post, tb.cz, y, T1.netP, T1.netC, 0.04, 0.063);
    // pickleball: four courts; blue kitchens and courts, green surround
    const pFix = FIX.filter((f) => f.kind === "p"), litP = litFor(pFix, (pk.x0 + pk.x1) / 2, pk.cz, 1.0);
    const pLines = [], pExt = []; for (const cx of pk.cx) { pLines.push(...pickleLines(cx, pk.cz)); pExt.push([cx - PB.wid / 2, cx + PB.wid / 2, pk.cz - PB.len / 2, pk.cz + PB.len / 2, COL.pBlue]); pExt.push([cx - PB.wid / 2, cx + PB.wid / 2, pk.cz - PB.kit, pk.cz + PB.kit, COL.pKit]); }
    cells.push(courtSurface(K, y, pk, null, pLines, COL.pBlue, COL.pGreen, litP, pExt)); slabEdge(K, pk, y, 0.16);
    for (const cx of pk.cx) net(K, cx - PB.wid / 2 - PB.post, cx + PB.wid / 2 + PB.post, pk.cz, y, PB.netP, PB.netC, 0.035, 0.05);
    // padel: the cage floor (blue acrylic), lines
    const dFix = FIX.filter((f) => f.kind === "d"), litD = litFor(dFix, pd.cx, pd.cz, 1.0);
    const dr = { x0: pd.x0 - 0.6, x1: pd.x1 + 0.6, z0: pd.z0 - 0.6, z1: pd.z1 + 0.6 };
    cells.push(courtSurface(K, y, dr, [pd.x0, pd.x1, pd.z0, pd.z1], padelLines(pd.cx, pd.cz), COL.dBlue, COL.pGreen, litD)); slabEdge(K, dr, y, 0.16);
    net(K, pd.x0, pd.x1, pd.cz, y, PD.netP, PD.netC, 0.04, 0.05);
    // walkable surfaces: the court slabs into the walk grid
    SC.n.courtCells = cells.reduce((a, b) => a + b, 0);
    WALKS.push([tb.x0 - 0.12, tb.z0 - 0.12, tb.x1 + 0.12, tb.z1 + 0.12, y], [pk.x0 - 0.12, pk.z0 - 0.12, pk.x1 + 0.12, pk.z1 + 0.12, y], [dr.x0 - 0.12, dr.z0 - 0.12, dr.x1 + 0.12, dr.z1 + 0.12, y]);
  }
  // fences and windscreens round the blocks (gates where the walks arrive); the show court's west side stays open to the stand
  function buildFences(K) { const y = L.pad + 0.10; const tb = L.tennis, pk = L.pickle, pd = L.padel;
    const W = [0.12, 2.15];
    // tennis block (3.66 m): north and south full windscreens with the print; east windscreen; west only low (the stand looks in)
    fenceRun(K, [tb.x0, tb.z0], [tb.x1, tb.z0], y, 3.66, { wind: W, print: true, windSide: 1, gates: [[1.2, 2.4]] });
    fenceRun(K, [tb.x1, tb.z1], [tb.x0, tb.z1], y, 3.66, { wind: W, print: true, windSide: 1, gates: [[31.1, 32.3]] });
    fenceRun(K, [tb.x1, tb.z0], [tb.x1, tb.z1], y, 3.66, { wind: W, print: true, windSide: 1 });
    fenceRun(K, [tb.x0, tb.z1], [tb.x0, tb.z0], y, 3.66, { wind: [0.12, 0.95], windSide: 1, gates: [[1.4, 2.6], [34.0, 35.2]] });
    // pickleball block (3.05 m): gates in the north fence, one per court
    const pg = []; for (let i = 0; i < 4; i++) { const s = (pk.cx[i] - pk.x0) - 0.6; pg.push([s, s + 1.2]); }
    fenceRun(K, [pk.x0, pk.z0], [pk.x1, pk.z0], y, 3.05, { wind: [0.12, 0.95], windSide: 1, gates: pg });
    fenceRun(K, [pk.x1, pk.z1], [pk.x0, pk.z1], y, 3.05, { wind: [0.12, 1.85], print: true, windSide: 1 });
    fenceRun(K, [pk.x1, pk.z0], [pk.x1, pk.z1], y, 3.05, { wind: [0.12, 1.85], windSide: 1 });
    fenceRun(K, [pk.x0, pk.z1], [pk.x0, pk.z0], y, 3.05, { wind: [0.12, 1.85], windSide: 1 });
    // the low dividers between pickleball courts (1.07 m chain-link on posts), open at the net line for walking through
    for (let i = 1; i < 4; i++) { const x = (pk.cx[i - 1] + pk.cx[i]) / 2; fenceRun(K, [x, pk.z0 + 0.2], [x, pk.z1 - 0.2], y, 1.07, { bay: 3.0, postR: 0.025, gates: [[8.2, 9.7]], solid: true }); }
    buildPadelCage(K, y);
  }
  function buildPadelCage(K, y) { const pd = L.padel, fr = COL.frame; const x0 = pd.x0, x1 = pd.x1, z0 = pd.z0, z1 = pd.z1;
    const post = (x, z, h) => { K.bar("steel", fr, V(x, y, z), V(x, y + h, z), 0.08, 0.08); };
    const glass = (a, b, h0, h1) => { K.quad("glass", 0xffffff, [a[0], y + h0, a[1]], [b[0], y + h0, b[1]], [b[0], y + h1, b[1]], [a[0], y + h1, a[1]]); };
    const mesh = (a, b, h0, h1) => { K.quad("weld", 0xffffff, [a[0], y + h0, a[1]], [b[0], y + h0, b[1]], [b[0], y + h1, b[1]], [a[0], y + h1, a[1]], [0, h0, hyp(b[0] - a[0], b[1] - a[1]), h1]); };
    // back walls: four 2.5 m glass panels, 3 m high, with 1 m of mesh above (4 m)
    for (const zz of [z0, z1]) { for (let i = 0; i < 4; i++) { const a = [x0 + i * 2.5, zz], b = [x0 + (i + 1) * 2.5, zz]; glass(a, b, 0.0, 3.0); mesh(a, b, 3.0, 4.0); post(a[0], zz, 4.0); } post(x1, zz, 4.0); K.bar("steel", fr, V(x0, y + 4.0, zz), V(x1, y + 4.0, zz), 0.06, 0.06); K.bar("steel", fr, V(x0, y + 3.0, zz), V(x1, y + 3.0, zz), 0.05, 0.05); }
    // side walls: glass 2 m from each back wall (3 m high), then 2 m (2 m high glass), then mesh 3 m with the doors at the net line
    for (const xx of [x0, x1]) { const zs = [z0, z0 + 2, z0 + 4, z1 - 4, z1 - 2, z1];
      glass([xx, z0], [xx, z0 + 2], 0, 3.0); mesh([xx, z0], [xx, z0 + 2], 3.0, 4.0); glass([xx, z0 + 2], [xx, z0 + 4], 0, 2.0); mesh([xx, z0 + 2], [xx, z0 + 4], 2.0, 3.0);
      glass([xx, z1 - 2], [xx, z1], 0, 3.0); mesh([xx, z1 - 2], [xx, z1], 3.0, 4.0); glass([xx, z1 - 4], [xx, z1 - 2], 0, 2.0); mesh([xx, z1 - 4], [xx, z1 - 2], 2.0, 3.0);
      // middle: mesh panels, door openings 0.9 m either side of the net line (one per side)
      const dz0 = pd.cz + 0.9, dz1 = pd.cz + 1.8; mesh([xx, z0 + 4], [xx, dz0], 0, 3.0); mesh([xx, dz1], [xx, z1 - 4], 0, 3.0); mesh([xx, dz0], [xx, dz1], 2.2, 3.0);
      for (const zz of [z0 + 2, z0 + 4, z0 + 7, dz0, dz1, z1 - 7, z1 - 4, z1 - 2]) post(xx, zz, zz < z0 + 2.5 || zz > z1 - 2.5 ? 4.0 : 3.0);
      K.bar("steel", fr, V(xx, y + 3.0, z0), V(xx, y + 3.0, z1), 0.05, 0.05); K.bar("steel", fr, V(xx, y + 4.0, z0), V(xx, y + 4.0, z0 + 2), 0.05, 0.05); K.bar("steel", fr, V(xx, y + 4.0, z1 - 2), V(xx, y + 4.0, z1), 0.05, 0.05);
      K.bar("steel", fr, V(xx, y + 2.2, dz0), V(xx, y + 2.2, dz1), 0.05, 0.05);
      solidSeg(xx, z0, xx, z1, 0.12, y - 0.2, y + 3.0, "sc", [[pd.cz + 0.9 - z0, pd.cz + 1.8 - z0]]); }
    solidSeg(x0, z0, x1, z0, 0.12, y - 0.2, y + 4.0, "sc"); solidSeg(x0, z1, x1, z1, 0.12, y - 0.2, y + 4.0, "sc");
  }

  // ───────────── tensile shade sails on raked masts, the floodlight heads on the masts ─────────────
  // The real sun over Douglas: south-east in the morning, south at noon, west-south-west and low by 17:40. So the courts run north
  // to south, and every sail is raked low on its west edge (against the afternoon sun) and high on the east (open to the morning
  // views), with a twist between the diagonals that gives the fabric its double curvature.
  const MAST = SC.masts = [];
  const SAIL = SC.sails = [];
  function mastAt(x, z, kind) { for (const m of MAST) if (hyp(m.x - x, m.z - z) < 0.3) return m; const m = { x, z, kind, att: [], top: 0 }; MAST.push(m); return m; }
  // a rectangular sail on four masts (x0..x1, z0..z1), west corners low (hl), east corners high (hh), twist tw on the NW-SE diagonal
  function sail4(x0, z0, x1, z1, hl, hh, tw, kind, col) { const y = L.pad; const m = [mastAt(x0, z0, kind), mastAt(x1, z0, kind), mastAt(x1, z1, kind), mastAt(x0, z1, kind)];
    const hgt = [hl + tw, hh, hh + tw, hl];   // NW, NE, SE, SW (the NW-SE diagonal is raised by tw: the twist)
    const S = { kind, col: col || COL.white, mast: m, h: hgt.map((v) => y + v), pts: [] };
    for (let i = 0; i < 4; i++) { m[i].att.push(y + hgt[i]); m[i].top = Math.max(m[i].top, y + hgt[i] + 0.7); }
    SAIL.push(S); return S; }
  function sail3(A, B, Cc, h, kind) { const y = L.pad; const m = [mastAt(A[0], A[1], kind), mastAt(B[0], B[1], kind), mastAt(Cc[0], Cc[1], kind)]; const S = { kind, tri: true, col: COL.white, mast: m, h: h.map((v) => y + v) }; for (let i = 0; i < 3; i++) { m[i].att.push(y + h[i]); m[i].top = Math.max(m[i].top, y + h[i] + 0.7); } SAIL.push(S); return S; }
  function layoutSails() { if (SAIL.length) return; const tb = L.tennis, pk = L.pickle, pd = L.padel;
    const tx = [tb.x0 - 0.5, (tb.cx[0] + tb.cx[1]) / 2, tb.x1 + 0.5], tz = [tb.z0 - 0.5, tb.cz, tb.z1 + 0.5];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) sail4(tx[i], tz[j], tx[i + 1], tz[j + 1], 8.2, 11.2, 0.75, "t", (i + j) % 2 ? 0xf2efe6 : 0xece4d4);
    const px = [pk.x0 - 0.6, (pk.cx[1] + pk.cx[2]) / 2, pk.x1 + 0.6], pz = [pk.z0 - 0.6, pk.z1 + 0.6];
    for (let i = 0; i < 2; i++) sail4(px[i], pz[0], px[i + 1], pz[1], 5.9, 8.3, 0.6, "p", i ? 0xece4d4 : 0xf2efe6);
    sail4(pd.x0 - 0.6, pd.z0 - 0.6, pd.x1 + 0.6, pd.z1 + 0.6, 5.9, 8.1, 0.55, "d", 0xd9a77a);   // the padel sail in terracotta
    sail3([tx[0], tz[1]], [L.club.x1 + 0.9, L.stand.z0 - 1.0], [L.club.x1 + 0.9, L.stand.z1 + 0.4], [7.0, 4.9, 5.5], "s");   // over the stand
    sail4(479.6, 613.0, 492.6, 624.6, 3.6, 5.2, 0.4, "l", 0xd9a77a);   // the lawn's yoga corner
    // the floodlight heads: on the perimeter masts below the sails, aimed into the courts
    const head = (m, y, tx2, tz2, kind) => FIX.push({ x: m.x, y: L.pad + y, z: m.z, tx: tx2, tz: tz2, kind });
    for (const m of MAST) { if (m.kind === "t") { const cxs = m.x < tx[1] - 1 ? [tb.cx[0]] : m.x > tx[1] + 1 ? [tb.cx[1]] : tb.cx; for (const c of cxs) { if (m.z < tb.cz - 1) head(m, 7.6, c, tb.cz - 6.5, "t"); else if (m.z > tb.cz + 1) head(m, 7.6, c, tb.cz + 6.5, "t"); else { head(m, 7.6, c, tb.cz - 7, "t"); head(m, 7.6, c, tb.cz + 7, "t"); } } }
      else if (m.kind === "p") { const cxs = m.x < px[1] - 1 ? [pk.cx[0], pk.cx[1]] : m.x > px[1] + 1 ? [pk.cx[2], pk.cx[3]] : [pk.cx[1], pk.cx[2]]; for (const c of cxs) head(m, 5.3, c, pk.cz + (m.z < pk.cz ? -2.5 : 2.5), "p"); }
      else if (m.kind === "d") head(m, 5.4, pd.cx, pd.cz + (m.z < pd.cz ? -3 : 3), "d"); }
    SC.n.masts = MAST.length; SC.n.sails = SAIL.length; SC.n.fix = FIX.length; }
  // the sail surface: a Coons patch between four catenary edges (each pulled in plan toward the centre by 0.07 of its span and
  // sagging 0.12 m), inset 0.7 m from the masts (the corner links take the gap)
  function sailGeo(S) { const n = 18; const y0 = L.pad; let cx = 0, cz = 0; const M = S.mast; for (const m of M) { cx += m.x; cz += m.z; } cx /= M.length; cz /= M.length;
    const C3 = M.map((m, i) => { const dx = cx - m.x, dz = cz - m.z, d = hyp(dx, dz) || 1; return V(m.x + dx / d * 0.75, S.h[i], m.z + dz / d * 0.75); });
    S.corners = C3;
    const edge = (A, B, t) => { const p = new THREE.Vector3().lerpVectors(A, B, t); const ex = B.x - A.x, ez = B.z - A.z, el = hyp(ex, ez) || 1; let nx = -ez / el, nz = ex / el; if ((cx - p.x) * nx + (cz - p.z) * nz < 0) { nx = -nx; nz = -nz; } const s = 4 * t * (1 - t); p.x += nx * el * 0.07 * s; p.z += nz * el * 0.07 * s; p.y -= 0.12 * s; return p; };
    let P;
    if (!S.tri) { const [c00, c10, c11, c01] = C3; P = (u, v) => { const b0 = edge(c00, c10, u), b1 = edge(c01, c11, u), l0 = edge(c00, c01, v), r1 = edge(c10, c11, v); const bl = new THREE.Vector3(); bl.addScaledVector(c00, (1 - u) * (1 - v)).addScaledVector(c10, u * (1 - v)).addScaledVector(c01, (1 - u) * v).addScaledVector(c11, u * v); return new THREE.Vector3().addScaledVector(b0, 1 - v).addScaledVector(b1, v).addScaledVector(l0, 1 - u).addScaledVector(r1, u).sub(bl); }; }
    else { const [a, b, c] = C3; P = (u, v) => { const w = 1 - u - v; const q = new THREE.Vector3().addScaledVector(a, w).addScaledVector(b, u).addScaledVector(c, v); const ea = edge(b, c, u + v > 1e-6 ? v / (u + v) : 0.5), eb = edge(a, c, w + v > 1e-6 ? v / (w + v) : 0.5), ec = edge(a, b, w + u > 1e-6 ? u / (w + u) : 0.5); const la = new THREE.Vector3().lerpVectors(b, c, u + v > 1e-6 ? v / (u + v) : 0.5), lb = new THREE.Vector3().lerpVectors(a, c, w + v > 1e-6 ? v / (w + v) : 0.5), lc = new THREE.Vector3().lerpVectors(a, b, w + u > 1e-6 ? u / (w + u) : 0.5); q.addScaledVector(ea.sub(la), 1 - w).addScaledVector(eb.sub(lb), 1 - u).addScaledVector(ec.sub(lc), 1 - v); return q; }; }
    const pos = [], uv = [], idx = [];
    if (!S.tri) { for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const p = P(i / n, j / n); pos.push(p.x, p.y, p.z); uv.push(i / n * C3[0].distanceTo(C3[1]), j / n * C3[0].distanceTo(C3[3])); }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1; idx.push(a, c, b, b, c, d); } }
    else { const row = []; let k = 0; for (let j = 0; j <= n; j++) { row[j] = k; for (let i = 0; i <= n - j; i++) { const p = P(i / n, j / n); pos.push(p.x, p.y, p.z); uv.push(i / n * C3[0].distanceTo(C3[1]), j / n * C3[0].distanceTo(C3[2])); k++; } }
      for (let j = 0; j < n; j++) for (let i = 0; i < n - j; i++) { const a = row[j] + i, b = a + 1, c = row[j + 1] + i; idx.push(a, c, b); if (i < n - j - 1) { const d = c + 1; idx.push(b, c, d); } } }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    S.edgeAt = (k, t) => (S.tri ? edge(C3[k], C3[(k + 1) % 3], t) : edge(C3[[0, 1, 3, 0][k]], C3[[1, 2, 2, 3][k]], t));
    return g; }
  function buildSails(K) { const y0 = L.pad; const steel = 0x2d2924, cab = 0x3a3d3f;
    for (const S of SAIL) { const g = sailGeo(S); const lit = (x, y, z) => { let s = 0; for (const f of FIX) { if (f.y > y) continue; const d = hyp(x - f.x, y - f.y, z - f.z); s += 1 / (1 + d * d * 0.012); } return clamp(0.08 + s * 0.16, 0, 0.55); };
      K.add("fabric", g, S.col, null, lit); cnt("sailTris", g.index ? g.index.count / 3 : 0);
      // the edge webbing (a dark cable in a pocket), the corner plates and the links to the masts
      const ne = S.tri ? 3 : 4; for (let k = 0; k < ne; k++) { let prev = S.edgeAt(k, 0); for (let i = 1; i <= 14; i++) { const p = S.edgeAt(k, i / 14); K.tube("steel", cab, prev, p, 0.022, 5); prev = p; } }
      S.corners.forEach((c, i) => { const m = S.mast[i]; const top = V(m.x, S.h[i] + 0.25, m.z); K.tube("steel", cab, c, top, 0.016, 5); K.box("steel", steel, 0.22, 0.05, 0.22, c.x, c.y, c.z, Math.atan2(m.x - c.x, m.z - c.z)); }); }
    // the masts: tapered tubes raked 4 degrees out from their block's centre, base plates on footings, a cap; backstays on the
    // perimeter masts down to ground anchors
    const blockC = { t: [(L.tennis.x0 + L.tennis.x1) / 2, L.tennis.cz], p: [(L.pickle.x0 + L.pickle.x1) / 2, L.pickle.cz], d: [L.padel.cx, L.padel.cz], s: [461, 592], l: [486, 618.8] };
    for (const m of MAST) { const bc = blockC[m.kind] || [m.x + 1, m.z]; let dx = m.x - bc[0], dz = m.z - bc[1]; const dd = hyp(dx, dz); const central = dd < 2; dx = central ? 0 : dx / dd; dz = central ? 0 : dz / dd; const rk = central ? 0 : Math.tan(4 * PI / 180);
      const h = m.top - y0, top = V(m.x + dx * rk * h, m.top, m.z + dz * rk * h); m.topV = top; const base = V(m.x, y0 + 0.1, m.z);
      K.tube("steel", steel, base, top, 0.19, 14, 0.14); K.cyl("steel", steel, 0.17, 0.17, 0.06, top.x, top.y + 0.02, top.z, 14); K.box("pave", COL.conc, 0.9, 0.18, 0.9, m.x, y0 + 0.09, m.z, 0, 1); K.box("steel", steel, 0.55, 0.03, 0.55, m.x, y0 + 0.19, m.z, 0);
      for (const a of m.att) { const t = (a - y0) / h; K.cyl("steel", steel, 0.21, 0.21, 0.18, m.x + dx * rk * (a - y0), a, m.z + dz * rk * (a - y0), 14); }
      const ax = m.x + dx * 3.2, az = m.z + dz * 3.2; const anOk = !central && m.kind === "t" && !inRect(L.stand, ax, az, 0.6) && !inRect(L.club, ax, az, 1) && !inRect(L.terrace, ax, az, 0.6) && inFoot(ax, az);
      if (anOk) { const an = V(ax, y0 + 0.12, az); K.tube("steel", cab, top, an, 0.014, 5); K.box("pave", COL.conc, 0.5, 0.16, 0.5, an.x, y0 + 0.08, an.z, 0, 1); }
      { const sd = addSolid(m.x, m.z, 0, 0.5, 0.5, y0, y0 + 3, "sc"); if (sd) { sd.noStep = true; SOL.push(sd); } } }
    // floodlight heads: a bracket, a dark housing tilted at the court and an LED lens (the emissive part); the halo for the night
    const halo = []; for (const f of FIX) { const yaw = Math.atan2(f.tx - f.x, f.tz - f.z); const hx = f.x + Math.sin(yaw) * 0.55, hz = f.z + Math.cos(yaw) * 0.55; const tilt = Math.atan2(f.y - L.pad, hyp(f.tx - f.x, f.tz - f.z));
      K.bar("steel", 0x2d2924, V(f.x, f.y + 0.1, f.z), V(hx, f.y + 0.1, hz), 0.06, 0.06); K.box("steel", 0x23262a, 0.62, 0.12, 0.42, hx, f.y, hz, yaw, 1, tilt * 0.75 + 0.35);
      const lx = hx + Math.sin(yaw) * 0.02, lz = hz + Math.cos(yaw) * 0.02; K.box("emit", 0xfff6e6, 0.54, 0.02, 0.34, lx, f.y - 0.07, lz, yaw, 1, tilt * 0.75 + 0.35); halo.push(lx, f.y - 0.1, lz); }
    SC.haloPts = halo; }

  // ───────────── the clubhouse, terrace, stand, paving, lawn, cart court, the club wall ─────────────
  const WALKS = SC.walks = [];     // [x0, z0, x1, z1, y] rectangles and { poly, y } polygons for the walk grid
  const SEATS = SC.seats = [];     // seat solids (for the people and the stamps)
  const CW = { earth: 0xffffff, cedar: 0xecdccb, oak: 0xffffff, corten: 0x8a4f2c, bronze: 0x2d2924, cream: 0xefe8d8, slate: 0x2a3033, stone: 0xf3ece0, leather: 0x5a3a26, sage: 0x7f8f6e, terracotta: 0xb8643f, charcoal: 0x2b2d2f, sand: 0xd9c7a4, green: 0x2f6f4a, gold: 0xd0a24a };
  function solid(x, z, ry, w, d, y0, y1, o) { const sd = addSolid(x, z, ry, w, d, y0, y1, "sc"); if (sd) { if (o && o.seat) { sd.seat = true; sd.face = o.face; SEATS.push(sd); } if (o && o.noStep) sd.noStep = true; if (o && o.tag) sd.scTag = o.tag; SOL.push(sd); } return sd; }
  // furniture kit (local helpers; every piece is merged into its group's meshes)
  function chair(K, x, z, yaw, y, col) { const c = Math.cos(yaw), s = Math.sin(yaw); const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c]; // local z forward (the way the sitter faces)
    for (const [lx, lz] of [[-0.21, -0.19], [0.21, -0.19], [-0.21, 0.19], [0.21, 0.19]]) { const p = P(lx, lz); K.cyl("steel", CW.bronze, 0.014, 0.014, 0.45, p[0], y + 0.225, p[1], 6); }
    const sp = P(0, 0); K.box("wood", col || CW.oak, 0.46, 0.04, 0.44, sp[0], y + 0.46, sp[1], yaw, 0.5); const bp = P(0, -0.21); K.box("wood", col || CW.oak, 0.44, 0.36, 0.03, bp[0], y + 0.7, bp[1], yaw, 0.5, -0.12);
    solid(sp[0], sp[1], yaw, 0.46, 0.44, y, y + 0.48, { seat: true, face: yaw }); }
  function stool(K, x, z, yaw, y) { K.cyl("steel", CW.bronze, 0.022, 0.03, 0.74, x, y + 0.37, z, 8); K.cyl("steel", CW.bronze, 0.16, 0.16, 0.02, x, y + 0.3, z, 12, true); K.cyl("soft", CW.leather, 0.19, 0.18, 0.06, x, y + 0.77, z, 14); solid(x, z, yaw, 0.38, 0.38, y, y + 0.8, { seat: true, face: yaw }); }
  function table(K, x, z, y, r, col) { K.cyl("stone", CW.stone, r, r, 0.04, x, y + 0.74, z, 20); K.cyl("steel", CW.bronze, 0.03, 0.03, 0.72, x, y + 0.37, z, 8); K.cyl("steel", CW.bronze, 0.25, 0.27, 0.03, x, y + 0.015, z, 14); solid(x, z, 0, r * 1.4, r * 1.4, y, y + 0.76, { noStep: true }); }
  function bench(K, x, z, yaw, len, y, back) { const c = Math.cos(yaw), s = Math.sin(yaw); for (const t of [-len / 2 + 0.25, len / 2 - 0.25]) { const px = x + t * c, pz = z - t * s; K.box("steel", CW.bronze, 0.06, 0.42, 0.42, px, y + 0.21, pz, yaw); }
    for (let k = 0; k < 4; k++) { const lz = -0.15 + k * 0.1; K.box("wood", CW.cedar, len, 0.035, 0.085, x + lz * s, y + 0.44, z + lz * c, yaw, 0.6); }
    if (back) { for (let k = 0; k < 3; k++) { const lz = -0.21, yy = y + 0.58 + k * 0.11; K.box("wood", CW.cedar, len, 0.085, 0.03, x + lz * s, yy, z + lz * c, yaw, 0.6); } }
    solid(x, z, yaw, len, 0.44, y, y + 0.46, { seat: true, face: yaw }); }
  function umbrella(K, x, z, y, r, col) { K.cyl("steel", CW.bronze, 0.025, 0.025, 2.5, x, y + 1.25, z, 8); const g = new THREE.ConeGeometry(r, 0.55, 12, 1, true); g.translate(x, y + 2.55, z); K.add("fabric", g, col || CW.cream, null, () => 0.2); K.cyl("steel", CW.bronze, 0.3, 0.3, 0.04, x, y + 0.02, z, 12); }
  function planter(K, x, z, w, d, y, h) { K.box("steel", CW.corten, w, h, d, x, y + h / 2, z, 0, 1); K.box("gravel", 0xffffff, w - 0.08, 0.02, d - 0.08, x, y + h - 0.04, z, 0, 1); solid(x, z, 0, w, d, y, y + h, { noStep: true }); }
  function sofa(K, x, z, yaw, w, y, col) { const c = Math.cos(yaw), s = Math.sin(yaw); const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c]; const q = P(0, 0), b = P(0, -0.36), aL = P(-w / 2 + 0.1, 0), aR = P(w / 2 - 0.1, 0);
    K.box("soft", col, w, 0.42, 0.86, q[0], y + 0.21, q[1], yaw); K.box("soft", col, w, 0.42, 0.18, b[0], y + 0.63, b[1], yaw); K.box("soft", col, 0.2, 0.26, 0.86, aL[0], y + 0.55, aL[1], yaw); K.box("soft", col, 0.2, 0.26, 0.86, aR[0], y + 0.55, aR[1], yaw);
    solid(q[0], q[1], yaw, w - 0.3, 0.6, y, y + 0.44, { seat: true, face: yaw }); }

  // a vertical plate between plan points a and b (edging, kerbs, screens), from y0 to y1, t thick
  function plate(K, mat, col, a, b, y0, y1, t) { const dx = b[0] - a[0], dz = b[1] - a[1], d = hyp(dx, dz); if (d < 0.02) return; K.box(mat, col, d, y1 - y0, t, (a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2, Math.atan2(-dz, dx), 0.5); }
  function buildClub(K, KI) { const y = L.pad, F = L.F, c = L.club, T0 = 0.45, top = F + 4.2, rf = top + 0.36;
    // ── the floor slab and the plinth (rammed earth base, a stone step) ──
    K.boxMM("stone", CW.stone, c.x0 - 0.05, y, c.z0 - 0.05, c.x1 + 0.05, F - 0.02, c.z1 + 0.05, 1);
    KI.flat("terrazzo", 0xffffff, c.x0 + T0, c.z0 + T0, c.x1 - T0, c.z1 - T0, F, 3.0, () => 0.3);
    WALKS.push([c.x0 + T0, c.z0 + T0, c.x1 - T0, c.z1 - T0, F]);
    // ── walls: rammed earth ends and cores, glass to the courts ──
    const earth = (x0, z0, x1, z1, h0, h1) => { K.boxMM("earth", CW.earth, x0, F + (h0 || 0) - (h0 ? 0 : 0.3), z0, x1, F + (h1 === undefined ? 4.2 : h1), z1, 1); solid((x0 + x1) / 2, (z0 + z1) / 2, 0, x1 - x0, z1 - z0, F - 0.3, F + (h1 === undefined ? 4.2 : h1), { noStep: true }); };
    earth(c.x0, c.z0, c.x0 + T0, c.z1);                                    // west
    earth(c.x1 - T0, c.z0, c.x1, c.z1);                                    // east
    earth(c.x0 + T0, c.z0, 433.0, c.z0 + T0, 0, 3.15);                     // north, locker room (clerestory above)
    earth(441.4, c.z0, c.x1 - T0, c.z0 + T0, 0, 3.15);                     // north, cafe back bar and pro shop
    earth(c.x0 + T0, c.z1 - T0, 433.0, c.z1, 0, 3.15);                     // south, locker room (high window above)
    earth(432.75, c.z0 + T0, 433.25, 584.4); earth(432.75, 586.8, 433.25, c.z1 - T0);   // the locker room partition with its door
    // clerestory glass over the solid north and south walls of the wings
    for (const [x0, x1, zz] of [[c.x0 + T0, 433.0, c.z0 + 0.22], [441.4, c.x1 - T0, c.z0 + 0.22], [c.x0 + T0, 433.0, c.z1 - 0.22]]) { K.quad("glass", 0xffffff, [x0, F + 3.15, zz], [x1, F + 3.15, zz], [x1, F + 4.1, zz], [x0, F + 4.1, zz]); for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 5) K.bar("steel", CW.bronze, V(x, F + 3.15, zz), V(x, F + 4.15, zz), 0.06, 0.08); }
    // the glass fronts: north entrance (433 to 447, doors 438.6 to 441.4), south to the terrace (433 to 456.55, sliders open 436 to 442 and 449 to 451)
    const glassRun = (x0, x1, zz, gaps) => { const n = Math.round((x1 - x0) / 1.4); for (let i = 0; i < n; i++) { const a = x0 + (x1 - x0) * i / n, b = x0 + (x1 - x0) * (i + 1) / n; const m = (a + b) / 2; if (gaps.some((g) => m > g[0] && m < g[1])) continue; K.quad("glass", 0xffffff, [a, F + 0.05, zz], [b, F + 0.05, zz], [b, F + 4.12, zz], [a, F + 4.12, zz]); }
      for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; if (gaps.some((g) => x > g[0] + 0.05 && x < g[1] - 0.05)) continue; K.bar("steel", CW.bronze, V(x, F, zz), V(x, F + 4.18, zz), 0.07, 0.12); }
      K.bar("steel", CW.bronze, V(x0, F + 0.04, zz), V(x1, F + 0.04, zz), 0.1, 0.08); K.bar("steel", CW.bronze, V(x0, F + 4.15, zz), V(x1, F + 4.15, zz), 0.12, 0.1); K.bar("steel", CW.bronze, V(x0, F + 2.6, zz), V(x1, F + 2.6, zz), 0.05, 0.06);
      let s0 = x0; for (const g of gaps.slice().sort((p, q) => p[0] - q[0])) { if (g[0] > s0) solidSeg(s0, zz, g[0], zz, 0.12, F - 0.1, F + 4.1, "sc"); s0 = g[1]; } if (s0 < x1) solidSeg(s0, zz, x1, zz, 0.12, F - 0.1, F + 4.1, "sc"); };
    glassRun(433.0, 441.4, c.z0 + 0.2, [[438.6, 441.4]]);
    glassRun(433.0, c.x1 - T0, c.z1 - 0.2, [[436.0, 442.0], [449.0, 451.0]]);
    // the open sliding panels stacked beside their openings
    for (const [a, b] of [[436.0, 442.0], [449.0, 451.0]]) { const w = (b - a) / 2; K.quad("glass", 0xffffff, [b, F + 0.05, c.z1 - 0.32], [b + w, F + 0.05, c.z1 - 0.32], [b + w, F + 4.1, c.z1 - 0.32], [b, F + 4.1, c.z1 - 0.32]); }
    // ── the roof: a slab with deep overhangs (south 3.2 m over the terrace), a corten fascia, cedar soffits, columns ──
    const R = { x0: c.x0 - 1.2, x1: c.x1 + 0.4, z0: c.z0 - 1.6, z1: c.z1 + 3.2 };
    const LX0 = 433.0, LX1 = 447.0, LT = F + 5.8;   // the lobby lantern: a taller volume over the lobby and the cafe with clerestories north and south
    for (const [a, b, d0, d1] of [[R.x0, LX0, R.z0, R.z1], [LX1, R.x1, R.z0, R.z1], [LX0, LX1, R.z0, c.z0], [LX0, LX1, c.z1, R.z1]]) { K.boxMM("pave", 0xcfc9bf, a, top, d0, b, top + 0.3, d1, 2); K.boxMM("pave", 0xb9b3aa, a + 0.05, top + 0.3, d0 + 0.1, b - 0.05, top + 0.32, d1 - 0.1, 3); }
    for (const xx of [LX0, LX1]) { K.boxMM("earth", CW.earth, xx - 0.25, top, c.z0, xx + 0.25, LT, c.z1, 1); }
    K.boxMM("steel", CW.bronze, LX1 - 0.18, top - 0.32, c.z0 + T0, LX1 + 0.18, top, c.z1 - T0, 1);
    for (const zz of [c.z0 + 0.2, c.z1 - 0.2]) { const n = 10; for (let i = 0; i < n; i++) { const a = LX0 + 0.25 + (LX1 - LX0 - 0.5) * i / n, b = LX0 + 0.25 + (LX1 - LX0 - 0.5) * (i + 1) / n; K.quad("glass", 0xffffff, [a, top + 0.35, zz], [b, top + 0.35, zz], [b, LT - 0.25, zz], [a, LT - 0.25, zz]); K.bar("steel", CW.bronze, V(a, top + 0.3, zz), V(a, LT - 0.2, zz), 0.07, 0.12); } K.bar("steel", CW.bronze, V(LX0, top + 0.33, zz), V(LX1, top + 0.33, zz), 0.1, 0.1); K.bar("steel", CW.bronze, V(LX0, LT - 0.22, zz), V(LX1, LT - 0.22, zz), 0.1, 0.1); }
    const LR = { x0: LX0 - 0.6, x1: LX1 + 0.6, z0: c.z0 - 0.9, z1: c.z1 + 0.9 }; K.boxMM("pave", 0xcfc9bf, LR.x0, LT, LR.z0, LR.x1, LT + 0.28, LR.z1, 2); K.boxMM("pave", 0xb9b3aa, LR.x0 + 0.1, LT + 0.28, LR.z0 + 0.1, LR.x1 - 0.1, LT + 0.3, LR.z1 - 0.1, 3);
    for (const [a, b, d1, d2] of [[LR.x0, LR.x1, LR.z0 - 0.04, LR.z0 + 0.02], [LR.x0, LR.x1, LR.z1 - 0.02, LR.z1 + 0.04]]) K.boxMM("steel", CW.corten, a, LT - 0.1, d1, b, LT + 0.42, d2, 0.5);
    for (const [a, b] of [[LR.x0 - 0.04, LR.x0 + 0.02], [LR.x1 - 0.02, LR.x1 + 0.04]]) K.boxMM("steel", CW.corten, a, LT - 0.1, LR.z0, b, LT + 0.42, LR.z1, 0.5);
    for (let z = LR.z0 + 0.06; z < c.z0; z += 0.13) K.box("wood", CW.cedar, LR.x1 - LR.x0, 0.03, 0.085, (LR.x0 + LR.x1) / 2, LT - 0.03, z, 0, 1.2); for (let z = c.z1 + 0.06; z < LR.z1 - 0.04; z += 0.13) K.box("wood", CW.cedar, LR.x1 - LR.x0, 0.03, 0.085, (LR.x0 + LR.x1) / 2, LT - 0.03, z, 0, 1.2);
    L.lantern = { x0: LX0, x1: LX1, top: LT };
    for (const [a, b, d1, d2] of [[R.x0, R.x1, R.z0 - 0.04, R.z0 + 0.02], [R.x0, R.x1, R.z1 - 0.02, R.z1 + 0.04]]) K.boxMM("steel", CW.corten, a, top - 0.12, d1, b, rf + 0.08, d2, 0.5);
    for (const [a, b] of [[R.x0 - 0.04, R.x0 + 0.02], [R.x1 - 0.02, R.x1 + 0.04]]) K.boxMM("steel", CW.corten, a, top - 0.12, R.z0, b, rf + 0.08, R.z1, 0.5);
    // soffit slats: inside (the ceiling) and under every overhang, running east-west
    const slats = (x0, x1, z0, z1, yy, Kx) => { for (let z = z0 + 0.06; z < z1 - 0.04; z += 0.13) Kx.box("wood", CW.cedar, x1 - x0, 0.03, 0.085, (x0 + x1) / 2, yy, z, 0, 1.2); };
    slats(c.x0 + T0, LX0 - 0.25, c.z0 + T0, c.z1 - T0, F + 3.95, KI); slats(LX1 + 0.25, c.x1 - T0, c.z0 + T0, c.z1 - T0, F + 3.95, KI); slats(LX0 + 0.25, LX1 - 0.25, c.z0 + T0, c.z1 - T0, F + 5.35, KI);
    slats(R.x0, R.x1, c.z1, R.z1, top - 0.03, K); slats(R.x0, R.x1, R.z0, c.z0, top - 0.03, K); slats(R.x0, c.x0, c.z0, c.z1, top - 0.03, K);
    KI.boxMM("pave", 0x3a3634, c.x0 + T0, F + 3.98, c.z0 + T0, LX0 - 0.25, F + 4.0, c.z1 - T0, 2); KI.boxMM("pave", 0x3a3634, LX1 + 0.25, F + 3.98, c.z0 + T0, c.x1 - T0, F + 4.0, c.z1 - T0, 2); KI.boxMM("pave", 0x3a3634, LX0 + 0.25, F + 5.38, c.z0 + T0, LX1 - 0.25, F + 5.4, c.z1 - T0, 2);   // the dark plenums above the slats
    for (let x = 424.2; x <= 455.6; x += 6.28) { K.bar("steel", CW.bronze, V(x, F, R.z1 - 0.35), V(x, top, R.z1 - 0.35), 0.16, 0.16); solid(x, R.z1 - 0.35, 0, 0.2, 0.2, F, top, { noStep: true }); }
    // solar on the roof: four rows of panels tilted 10 degrees to the south
    for (let r = 0; r < 4; r++) for (let i = 0; i < 9; i++) { const px = c.x0 + 1.6 + i * 3.6, pz = c.z0 + 1.6 + r * 3.0; if (px > LX0 - 1.9 && px < LX1 + 1.9) continue; K.box("chrome", 0x9aa0a4, 3.3, 0.05, 1.75, px, top + 0.55, pz, 0, 1, 0.17); K.box("steel", 0x18222f, 3.2, 0.02, 1.65, px, top + 0.585, pz, 0, 1, 0.17); }
    // ── entrance: steps from the forecourt, a stone landing, the door frame, the name plate and the mark ──
    const yP = y + 0.12; for (let k = 0; k < 2; k++) { const h = yP + (F - yP) * (k + 1) / 2; K.boxMM("stone", CW.stone, 435.6, yP - 0.05, c.z0 - 1.4 + k * 0.7, 444.4, h, c.z0 - 0.7 + k * 0.7, 1); solid(440, c.z0 - 1.05 + k * 0.7, 0, 8.8, 0.7, yP - 0.05, h); }
    WALKS.push([435.6, c.z0 - 1.4, 444.4, c.z0 - 0.7, yP + (F - yP) / 2], [435.6, c.z0 - 0.7, 444.4, c.z0, F]);
    const uvW = signUV(0, 40, 2048, 470); K.quad("sign", 0xffffff, [444.0, F + 4.42, R.z0 - 0.07], [436.0, F + 4.42, R.z0 - 0.07], [436.0, F + 4.95, R.z0 - 0.07], [444.0, F + 4.95, R.z0 - 0.07], uvW);
    const uvL = signUV(1024, 1290, 2048, 1526); K.quad("sign", 0xffffff, [449.8, F + 1.2, c.z0 - 0.02], [447.6, F + 1.2, c.z0 - 0.02], [447.6, F + 2.3, c.z0 - 0.02], [449.8, F + 2.3, c.z0 - 0.02], uvL);
    // ── the terrace: travertine over a plinth, steps down to the walk, benches facing the courts, café tables, umbrellas ──
    const t = L.terrace; K.boxMM("stone", CW.stone, t.x0, y + 0.05, c.z1, t.x1, F - 0.01, t.z1, 1);
    K.flat("stone", CW.stone, t.x0, c.z1, t.x1, t.z1, F, 3.0, () => 0.1); WALKS.push([t.x0, c.z1, t.x1, t.z1, F]);
    solid((t.x0 + t.x1) / 2, (c.z1 + t.z1) / 2, 0, t.x1 - t.x0, t.z1 - c.z1, y, F);
    for (const [a, b] of [[427.4, 430.6], [445.4, 448.6]]) for (let k = 0; k < 2; k++) { const h = yP + (F - yP) * (k + 1) / 2 - 0.0; K.boxMM("stone", CW.stone, a, y + 0.05, t.z1 + 0.66 - k * 0.66, b, h, t.z1 + 1.32 - k * 0.66, 1); solid((a + b) / 2, t.z1 + 0.99 - k * 0.66, 0, b - a, 0.66, y, h); }
    WALKS.push([427.4, t.z1, 430.6, t.z1 + 0.66, yP + (F - yP) / 2], [445.4, t.z1, 448.6, t.z1 + 0.66, yP + (F - yP) / 2]);
    for (const x of [424.2, 435.2, 441.5, 452.0, 456.6]) bench(K, x, t.z1 - 0.45, 0, x === 456.6 ? 3.2 : 4.2, F, true);
    [[426.0, 598.2], [432.0, 599.2], [438.5, 598.6], [444.2, 599.4], [450.4, 598.4]].forEach((q, i) => { table(K, q[0], q[1], F, 0.42); const n = i % 2 ? 4 : 3; for (let k = 0; k < n; k++) { const a = k / n * TAU + 0.4; chair(K, q[0] + Math.sin(a) * 0.82, q[1] + Math.cos(a) * 0.82, a + PI, F, CW.oak); } });
    umbrella(K, 432.0, 599.2, F, 1.6, CW.cream); umbrella(K, 444.2, 599.4, F, 1.6, CW.terracotta); umbrella(K, 426.0, 598.2, F, 1.5, CW.sand);
    planter(K, 421.8, 595.4, 1.2, 1.2, F, 0.6); planter(K, 458.2, 595.0, 1.0, 1.2, F, 0.6);
    // ── the viewing stand: two sections of three tiers either side of the centre mast, facing the show court (east) ──
    const s = L.stand; for (const [z0, z1] of [[580.0, 590.4], [592.2, 602.6]]) { const tiers = [[462.2, 463.8, y + 0.45], [460.6, 462.2, y + 0.9], [459.0, 460.6, y + 1.35]];
      for (const [x0, x1, h] of tiers) { K.boxMM("stone", CW.stone, x0, y + 0.02, z0, x1, h - 0.06, z1, 1); K.boxMM("wood", CW.cedar, x0, h - 0.06, z0, x1, h, z1, 1.2); solid((x0 + x1) / 2, (z0 + z1) / 2, 0, x1 - x0, z1 - z0, y, h); WALKS.push([x0, z0, x1, z1, h]);
        // the seat edge: the front 0.5 m of each tier, facing east
        const sd = solid(x1 - 0.25, (z0 + z1) / 2, 0, 0.5, z1 - z0 - 0.4, h - 0.45, h, { seat: true, face: PI / 2 }); if (sd) sd.scStand = true; }
      K.boxMM("stone", CW.stone, 458.6, y + 0.02, z0, 459.0, y + 2.4, z1, 1); K.tube("steel", CW.bronze, V(458.8, y + 2.45, z0), V(458.8, y + 2.45, z1), 0.03, 8); solid(458.8, (z0 + z1) / 2, 0, 0.4, z1 - z0, y, y + 2.45, { noStep: true });
      for (const zz of [z0 + 0.05, z1 - 0.05]) K.boxMM("stone", CW.stone, 459.0, y + 0.02, zz - 0.05, 463.8, y + 1.45, zz + 0.05, 1); }
    // ── the paving: the forecourt, the spine walk, the walks round the courts (concrete pavers, a steel edge) ──
    const yp = y + 0.12; const litWalk = (x, yy, z) => clamp(illum(x, z, FIX) / (illum(481, 591, FIX.filter((f) => f.kind === "t")) || 1) * 0.6, 0.08, 0.5);
    K.poly("stone", 0xd9c6a8, L.fore, yp, litWalk); WALKS.push({ poly: L.fore, y: yp });
    const paveR = (x0, z0, x1, z1) => { K.flat("pave", 0xd6d0c4, x0, z0, x1, z1, yp, 3.0, litWalk); K.boxMM("steel", CW.corten, x0 - 0.04, y + 0.02, z0 - 0.04, x1 + 0.04, yp - 0.005, z0, 0.5); K.boxMM("steel", CW.corten, x0 - 0.04, y + 0.02, z1, x1 + 0.04, yp - 0.005, z1 + 0.04, 0.5); WALKS.push([x0, z0, x1, z1, yp]); };
    paveR(401.3, t.z1, 464.4, L.pickle.z0 - 0.12);           // the spine walk, west from the stand to the padel cage
    paveR(388.8, t.z1, 401.3, L.padel.z0 - 0.72);
    paveR(t.x1, c.z0 - 1.2, 464.4, 580.0);                   // round the stand's north end to the tennis gate
    paveR(463.85, 573.0 - 0.12 - 2.6, 466.0, 573.0 - 0.12);  // along the tennis block's north-west corner
    paveR(442.7, L.tennis.z1 + 0.12, 498.2, L.lawn.z0 - 0.05);  // the south walk between the tennis block and the lawn
    paveR(442.7, L.pickle.z0, 451.8, L.tennis.z1 + 0.12);    // the walk down the pickleball block's east side
    paveR(404.4, L.padel.z0, L.pickle.x0 - 0.12, L.padel.z1);   // a path between the padel bed and the pickleball block
    paveR(L.tennis.x0 - 3.2, 602.6, L.tennis.x0 - 0.12, L.tennis.z1 + 0.12);   // south of the stand, to the tennis SW gate
    // ── the gravel ground of the whole club (under everything) and the corten edge round the footprint ──
    const bedPoly = (pts) => { K.poly("gravel", 0xffffff, pts, y + 0.04, () => 0.08); for (let i = 0; i < pts.length; i++) plate(K, "steel", CW.corten, pts[i], pts[(i + 1) % pts.length], y - 0.04, y + 0.09, 0.012); };
    bedPoly(L.garden.map((q) => q.slice()));
    bedPoly([[446.0, 624.6], [494.0, 624.6], [494.0, 626.3], [446.0, 626.3]]);
    bedPoly([[401.25, 604.0], [404.3, 604.0], [404.3, 624.0], [401.25, 624.0]]);
    for (let k = 0; k < 3; k++) K.box("stone", CW.stone, 0.62, 0.06, 0.62, 401.75 + k * 0.92, y + 0.07, L.padel.cz + 1.35, 0.1 * k);
    // raised planters round the forecourt trees: an octagon of corten, gravel on top
    const ring = (x, z, r) => { const pts = []; for (let k = 0; k < 8; k++) { const a = (k + 0.5) / 8 * TAU; pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); } for (let k = 0; k < 8; k++) plate(K, "steel", CW.corten, pts[k], pts[(k + 1) % 8], yp - 0.02, yp + 0.24, 0.03); K.poly("gravel", 0xffffff, pts, yp + 0.17, () => 0.1); solid(x, z, 0, r * 1.7, r * 1.7, yp, yp + 0.24, { noStep: true }); };
    for (const q of SC.rings || []) ring(q[0], q[1], q[2]);
    // ── the fitness lawn: turf with a steel edge, a training rig, plyo boxes, kettlebells, a sprint lane, yoga mats ──
    const lw = L.lawn; K.flat("turf", 0xffffff, lw.x0, lw.z0, lw.x1, lw.z1, y + 0.05, 3.0, () => 0.18); WALKS.push([lw.x0, lw.z0, lw.x1, lw.z1, y + 0.05]);
    for (const [a, b] of [[[lw.x0, lw.z0], [lw.x1, lw.z0]], [[lw.x0, lw.z1], [lw.x1, lw.z1]], [[lw.x0, lw.z0], [lw.x0, lw.z1]], [[lw.x1, lw.z0], [lw.x1, lw.z1]]]) plate(K, "steel", CW.corten, a, b, y + 0.0, y + 0.1, 0.012);
    const rx0 = 465.5, rx1 = 476.5, rz0 = 616.6, rz1 = 619.8, rh = 3.0; for (const xx of [rx0, (rx0 + rx1) / 2, rx1]) for (const zz of [rz0, rz1]) { K.bar("steel", 0x1d2224, V(xx, y + 0.05, zz), V(xx, y + rh, zz), 0.09, 0.09); solid(xx, zz, 0, 0.12, 0.12, y, y + rh, { noStep: true }); }
    for (const zz of [rz0, rz1]) K.bar("steel", 0x1d2224, V(rx0, y + rh, zz), V(rx1, y + rh, zz), 0.08, 0.08); for (let k = 0; k <= 5; k++) { const xx = rx0 + (rx1 - rx0) * k / 5; K.tube("chrome", 0xb8bcc0, V(xx, y + rh - 0.06, rz0), V(xx, y + rh - 0.06, rz1), 0.017, 8); }
    for (const xx of [rx0 + 1.2, rx0 + 2.0]) for (const zz of [rz0 + 0.9, rz1 - 0.9]) { K.tube("steel", 0x30302c, V(xx, y + rh, zz), V(xx, y + 1.95, zz), 0.008, 4); const g = new THREE.TorusGeometry(0.12, 0.016, 6, 16); g.translate(xx, y + 1.83, zz); K.add("soft", g, 0x2a2a28); }
    [[461.2, 617.0, 0.5], [462.2, 617.6, 0.6], [463.3, 617.1, 0.75]].forEach((q) => { K.box("wood", CW.oak, 0.76, q[2], 0.6, q[0], y + 0.05 + q[2] / 2, q[1], 0.15, 0.6); solid(q[0], q[1], 0.15, 0.76, 0.6, y, y + 0.05 + q[2]); });
    K.box("steel", 0x1d2224, 1.6, 0.06, 0.45, 458.6, y + 0.45, 616.2, 0); K.box("steel", 0x1d2224, 1.6, 0.06, 0.45, 458.6, y + 0.15, 616.2, 0); for (let k = 0; k < 5; k++) { const kx = 458.0 + k * 0.32; for (const yy of [0.18, 0.48]) { K.sph("soft", 0x262829, 0.085 + k * 0.01, kx, y + yy + 0.1, 616.2, 10); const h = new THREE.TorusGeometry(0.05, 0.012, 5, 10, PI); h.translate(kx, y + yy + 0.2, 616.2); K.add("soft", h, 0x262829); } }
    solid(458.6, 616.2, 0, 1.7, 0.5, y, y + 0.6, { noStep: true });
    for (let k = 0; k < 3; k++) K.boxMM("soft", 0xf2f1ea, 453.5, y + 0.052, 613.4 + k * 1.1, 463.5, y + 0.058, 613.46 + k * 1.1, 1);
    [[482.6, 616.0, 0x6d8f7a], [485.4, 616.0, 0xb8643f], [488.2, 616.0, 0x5b6f8e], [482.6, 620.6, 0xd0a24a], [485.4, 620.6, 0x7f8f6e], [488.2, 620.6, 0xb46a5a]].forEach((q) => K.box("soft", q[2], 0.66, 0.012, 1.85, q[0], y + 0.058, q[1], 0));
    for (const x of [456.0, 478.0]) bench(K, x, lw.z0 + 0.45, 0, 2.4, y + 0.05, false);
    // ── the cart court: painted stalls, wheel stops, a charger at each stall (a green light at night) ──
    const S = L.stalls; for (let i = 0; i <= S.n; i++) { const x = S.x0 + i * S.w; K.boxMM("soft", 0xf2f1ea, x - 0.05, yp + 0.003, S.z0 + 0.15, x + 0.05, yp + 0.008, S.z0 + S.d, 1); }
    for (let i = 0; i < S.n; i++) { const x = S.x0 + (i + 0.5) * S.w; K.box("pave", 0xc9c3b8, 1.1, 0.1, 0.16, x, yp + 0.05, S.z0 + 0.45, 0, 0.5); K.box("steel", 0x23272a, 0.13, 0.92, 0.11, x + 0.66, yp + 0.46, S.z0 + 0.2, 0); K.box("emit", 0x4dde6f, 0.07, 0.04, 0.01, x + 0.66, yp + 0.8, S.z0 + 0.26, 0); solid(x + 0.66, S.z0 + 0.2, 0, 0.16, 0.14, yp, yp + 0.92, { noStep: true }); }
    // ── the club wall on the parkway: rammed earth, the wordmark in bronze, uplight pools at night ──
    const W = L.wall = { x: 405.6, z: 587.4, ux: -0.616, uz: 0.788, len: 9.6, h: 2.5, t: 0.6 }; const wyaw = Math.atan2(W.ux, W.uz) + PI / 2;
    K.box("earth", CW.earth, W.len, W.h + 0.3, W.t, W.x, y + (W.h - 0.3) / 2, W.z, Math.atan2(W.uz, -W.ux) + PI, 1); K.box("steel", CW.corten, W.len + 0.06, 0.08, W.t + 0.06, W.x, y + W.h + 0.04, W.z, Math.atan2(W.uz, -W.ux) + PI, 0.5);
    { const nx = -W.uz, nz = W.ux; const sx = W.x + nx * (W.t / 2 + 0.03), sz = W.z + nz * (W.t / 2 + 0.03); const ax = W.ux * 4.2, az = W.uz * 4.2; const uv = signUV(0, 40, 2048, 470); K.quad("sign", 0xffffff, [sx - ax, y + 0.75, sz - az], [sx + ax, y + 0.75, sz + az], [sx + ax, y + 2.3, sz + az], [sx - ax, y + 2.3, sz - az], uv); W.face = [nx, nz]; }
    solid(W.x, W.z, Math.atan2(W.uz, -W.ux) + PI, W.len, W.t, y, y + W.h, { noStep: true });
  }

  // ───────────── inside the clubhouse: the lobby and reception, the Baseline Café, the pro shop, the locker room ─────────────
  // Walkable: every counter, rack, locker bank and table is a solid; stools, chairs, sofas and benches are seats.
  function racquet(K, x, y, z, yaw, col, padel) { const c = Math.cos(yaw), s = Math.sin(yaw); const W = (lx, ly, lz) => V(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
    if (padel) { K.box("soft", col, 0.26, 0.3, 0.035, x, y + 0.27, z, yaw); K.cyl("soft", 0x1c1d1e, 0.016, 0.016, 0.16, x, y + 0.04, z, 6); return; }
    K.tube("soft", 0x1c1d1e, W(0, -0.05, 0), W(0, 0.22, 0), 0.015, 6); K.tube("soft", col, W(0, 0.22, 0), W(-0.06, 0.34, 0), 0.008, 5); K.tube("soft", col, W(0, 0.22, 0), W(0.06, 0.34, 0), 0.008, 5);
    const g = new THREE.TorusGeometry(0.125, 0.009, 5, 22); g.scale(1, 1.25, 1); g.rotateY(yaw); g.translate(x + 0 * c, y + 0.5, z); K.add("soft", g, col);
    K.quad("net", 0xffffff, [W(-0.115, 0.36, 0).x, y + 0.36, W(-0.115, 0.36, 0).z], [W(0.115, 0.36, 0).x, y + 0.36, W(0.115, 0.36, 0).z], [W(0.115, 0.64, 0).x, y + 0.64, W(0.115, 0.64, 0).z], [W(-0.115, 0.64, 0).x, y + 0.64, W(-0.115, 0.64, 0).z], [0, 0, 0.23, 0.28]); }
  // a framed print on a wall: centre (cx, cy, cz), facing (nx, nz), w x h metres, the atlas tile 0..3 (2 x 2 tiles)
  function printFramed(K, tile, cx, cy, cz, nx, nz, w, h) { const dx = nz, dz = -nx; const o = 0.03; const ax = cx - dx * w / 2 + nx * o, az = cz - dz * w / 2 + nz * o, bx = cx + dx * w / 2 + nx * o, bz = cz + dz * w / 2 + nz * o;
    const u0 = (tile % 2) * 0.5, r = Math.floor(tile / 2), v0 = 1 - (r + 1) * 0.5; K.quad("art", 0xffffff, [ax, cy - h / 2, az], [bx, cy - h / 2, bz], [bx, cy + h / 2, bz], [ax, cy + h / 2, az], [u0 + 0.004, v0 + 0.006, u0 + 0.496, v0 + 0.494]);
    const yaw = Math.atan2(-dz, dx), fw = 0.05, fx = cx + nx * 0.02, fz = cz + nz * 0.02; for (const s of [-1, 1]) { K.box("wood", 0x3a2a1e, w + fw * 2, fw, 0.05, fx, cy + s * (h / 2 + fw / 2), fz, yaw, 0.6); K.box("wood", 0x3a2a1e, fw, h, 0.05, fx + dx * s * (w / 2 + fw / 2), cy, fz + dz * s * (w / 2 + fw / 2), yaw, 0.6); } }
  function buildInterior(K) { const F = L.F, c = L.club;
    // the prints: the golden-hour court and the 1950s handshake in the lounge, the racquet still life high in the lantern, the agua fresca in the cafe
    printFramed(K, 0, 433.3, F + 2.1, 580.75, 1, 0, 1.75, 1.17); printFramed(K, 2, 433.3, F + 1.82, 590.4, 1, 0, 1.3, 0.87); printFramed(K, 1, 446.72, F + 4.76, 585.8, -1, 0, 1.45, 0.97); printFramed(K, 3, 446.65, F + 2.62, 579.5, 0, 1, 1.05, 0.7);
    // ── lobby and reception ──
    K.boxMM("wood", CW.cedar, 434.2, F, 582.6, 437.6, F + 1.02, 583.35, 0.8); K.boxMM("stone", CW.stone, 434.1, F + 1.02, 582.5, 437.7, F + 1.07, 583.5, 1.5); solid(435.9, 582.95, 0, 3.4, 0.75, F, F + 1.07, { noStep: true });
    for (let k = 0; k < 13; k++) K.box("wood", 0xb98a5e, 0.05, 0.92, 0.04, 434.35 + k * 0.26, F + 0.5, 583.38, 0, 0.8);
    K.box("steel", 0x141617, 0.5, 0.32, 0.03, 436.4, F + 1.26, 582.8, 0.2); K.box("emit", 0x9fd4ff, 0.44, 0.26, 0.005, 436.4, F + 1.26, 582.82, 0.2);
    { const uv = signUV(0, 1792, 1024, 2048); K.quad("sign", 0xffffff, [433.3, F + 1.4, 584.25], [433.3, F + 1.4, 582.0], [433.3, F + 1.97, 582.0], [433.3, F + 1.97, 584.25], uv); }   // the court hours board on the partition
    { const uv = signUV(0, 40, 2048, 470); K.quad("sign", 0xffffff, [433.3, F + 2.5, 591.6], [433.3, F + 2.5, 587.3], [433.3, F + 3.42, 587.3], [433.3, F + 3.42, 591.6], uv); }   // the wordmark over the lounge, clear of the locker room door
    // the lounge: a rug, a sofa facing the glass and the courts, two leather chairs, a low table
    K.box("soft", 0xc9b28c, 3.6, 0.012, 2.8, 435.6, F + 0.006, 589.9, 0); sofa(K, 435.6, 588.4, 0, 2.3, F, 0xd9cdb6); sofa(K, 433.95, 590.4, PI / 2, 0.95, F, CW.leather); sofa(K, 437.3, 590.4, -PI / 2, 0.95, F, CW.leather);
    K.box("wood", CW.oak, 1.2, 0.04, 0.6, 435.6, F + 0.4, 590.1, 0, 0.6); K.box("steel", CW.bronze, 1.1, 0.38, 0.5, 435.6, F + 0.19, 590.1, 0); solid(435.6, 590.1, 0, 1.2, 0.6, F, F + 0.42, { noStep: true });
    // ── the Baseline Café: the counter (cedar front, stone top), the back bar, the espresso machine, the pastry case, stools ──
    K.boxMM("wood", CW.cedar, 441.8, F, 583.65, 446.6, F + 1.0, 584.35, 0.8); K.boxMM("stone", CW.stone, 441.7, F + 1.0, 583.55, 446.7, F + 1.05, 584.45, 1.5); solid(444.2, 584.0, 0, 4.9, 0.8, F, F + 1.05, { noStep: true });
    for (let k = 0; k < 18; k++) K.box("wood", 0xb98a5e, 0.05, 0.9, 0.04, 441.95 + k * 0.27, F + 0.48, 584.38, 0, 0.8);
    K.boxMM("wood", CW.oak, 441.8, F, 579.45, 446.9, F + 0.92, 580.15, 0.8); K.boxMM("stone", CW.stone, 441.75, F + 0.92, 579.45, 446.95, F + 0.96, 580.2, 1.5); solid(444.35, 579.8, 0, 5.1, 0.75, F, F + 0.96, { noStep: true });
    for (const yy of [1.55, 2.0]) K.boxMM("wood", CW.oak, 441.9, F + yy, 579.45, 445.6, F + yy + 0.04, 579.78, 0.8);
    for (let k = 0; k < 16; k++) { const x = 442.05 + k * 0.22; K.cyl("soft", [0xf3efe6, 0x2f6f4a, 0xb8643f, 0xf3efe6][k % 4], 0.04, 0.035, 0.09, x, F + 1.64, 579.6, 10); K.cyl("chrome", 0xc8ccd0, 0.03, 0.03, 0.22, x, F + 2.15, 579.6, 8); }
    K.box("chrome", 0xc6cacd, 0.78, 0.46, 0.5, 443.0, F + 1.19, 579.85, 0); K.box("steel", 0x1b1d1f, 0.7, 0.08, 0.42, 443.0, F + 1.44, 579.85, 0); for (const dx of [-0.2, 0.2]) { K.cyl("chrome", 0xd0d4d7, 0.025, 0.025, 0.12, 443.0 + dx, F + 1.02, 580.06, 8); K.box("emit", 0xffb43a, 0.05, 0.05, 0.005, 443.0 + dx, F + 1.32, 580.11, 0); }
    K.cyl("steel", 0x1f2123, 0.08, 0.1, 0.38, 443.9, F + 1.15, 579.8, 12); K.cyl("chrome", 0xc6cacd, 0.06, 0.06, 0.14, 443.9, F + 1.4, 579.8, 10);
    K.boxMM("steel", 0x2a2d30, 446.0, F, 579.5, 446.85, F + 2.05, 580.3, 1); K.box("glass", 0xffffff, 0.75, 1.85, 0.02, 446.42, F + 1.05, 580.32, 0); K.box("emitW", 0xfff3dd, 0.7, 0.02, 0.6, 446.42, F + 1.9, 579.9, 0);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) K.box("soft", [0xd94b3d, 0x4dde6f, 0xf4cd5a, 0xf08c3a][(r + k) % 4], 0.1, 0.22, 0.1, 446.15 + k * 0.17, F + 0.25 + r * 0.45, 579.95, 0);
    { const uv = signUV(0, 1024, 1024, 1280); K.quad("sign", 0xffffff, [442.0, F + 2.12, 579.47], [445.9, F + 2.12, 579.47], [445.9, F + 3.07, 579.47], [442.0, F + 3.07, 579.47], uv); }
    // the pastry case and what is in it
    K.box("glass", 0xffffff, 1.1, 0.38, 0.45, 445.4, F + 1.24, 584.0, 0); K.box("stone", CW.stone, 1.12, 0.03, 0.47, 445.4, F + 1.07, 584.0, 0);
    for (let k = 0; k < 6; k++) { K.sph("soft", [0xc98a4a, 0xa76a3a, 0xe1b06b][k % 3], 0.05, 444.98 + k * 0.17, F + 1.13, 583.9, 8, 1, 0.7, 1); K.box("soft", [0xe9d5a6, 0x7a9a4e, 0xd8b98a][k % 3], 0.12, 0.05, 0.08, 444.98 + k * 0.17, F + 1.23, 584.12, 0); }
    // pendants over the counter
    for (const x of [442.6, 444.2, 445.8]) { K.tube("steel", 0x141617, V(x, F + 5.35, 584.0), V(x, F + 2.55, 584.0), 0.006, 4); K.cyl("steel", 0x23262a, 0.06, 0.17, 0.26, x, F + 2.42, 584.0, 16, true); K.sph("emitW", 0xffd9a0, 0.06, x, F + 2.33, 584.0, 10); }
    for (const x of [442.6, 443.8, 445.0, 446.2]) stool(K, x, 585.05, PI, F);
    // café tables by the glass (the view down to the pickleball courts)
    [[439.6, 590.6, 4], [443.2, 591.6, 2], [446.0, 589.8, 2], [441.6, 588.0, 2]].forEach((q) => { table(K, q[0], q[1], F, 0.4); for (let k = 0; k < q[2]; k++) { const a = k / q[2] * TAU + (q[2] === 2 ? PI / 2 : 0.785); chair(K, q[0] + Math.sin(a) * 0.78, q[1] + Math.cos(a) * 0.78, a + PI, F, CW.oak); } });
    // ── the pro shop: the racquet wall, the shoe wall, apparel racks, ball tubes, paddles, the counter and the stringing machine ──
    K.boxMM("wood", CW.oak, 456.35, F + 0.3, 580.4, 456.55, F + 3.3, 592.8, 0.8); for (let k = 0; k < 42; k++) K.boxMM("wood", 0xa8784c, 456.3, F + 0.32 + k * 0.071, 580.45, 456.36, F + 0.34 + k * 0.071, 592.75, 0.8);
    const rc = [0x1c1d1e, 0xc23a2e, 0x2a5d9a, 0xf3efe6, 0x2f6f4a, 0xe07a2e, 0x6a3fa0, 0xd0a24a];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 10; k++) racquet(K, 456.24, F + 0.75 + r * 0.82, 581.2 + k * 1.15, PI / 2, rc[(k + r * 3) % rc.length]);
    for (let k = 0; k < 9; k++) for (const yy of [0.7, 1.25, 1.8, 2.35]) { K.boxMM("wood", CW.oak, 447.6 + k * 0.94, F + yy - 0.03, 579.45, 448.45 + k * 0.94, F + yy, 579.82, 0.8); K.box("soft", rc[(k * 2 + Math.round(yy * 3)) % rc.length], 0.26, 0.1, 0.3, 447.82 + k * 0.94, F + yy + 0.05, 579.64, 0); K.box("soft", 0xf3efe6, 0.26, 0.1, 0.3, 448.2 + k * 0.94, F + yy + 0.05, 579.64, 0); }
    solid(452.0, 579.65, 0, 8.6, 0.42, F, F + 2.5, { noStep: true });
    { const uv = signUV(1024, 1024, 2048, 1152); K.quad("sign", 0xffffff, [449.2, F + 2.52, 579.47], [454.0, F + 2.52, 579.47], [454.0, F + 3.1, 579.47], [449.2, F + 3.1, 579.47], uv); }
    for (const [rx, rz] of [[450.0, 584.6], [453.6, 584.6]]) { K.cyl("chrome", 0xc6cacd, 0.02, 0.02, 1.4, rx, F + 0.7, rz, 8); const ring = new THREE.TorusGeometry(0.55, 0.012, 5, 28); ring.rotateX(PI / 2); ring.translate(rx, F + 1.42, rz); K.add("chrome", ring, 0xc6cacd); K.cyl("chrome", 0xc6cacd, 0.25, 0.28, 0.03, rx, F + 0.015, rz, 14);
      for (let k = 0; k < 14; k++) { const a = k / 14 * TAU; K.box("soft", rc[k % rc.length] === 0x1c1d1e ? 0x3d4a5c : rc[k % rc.length], 0.04, 0.68, 0.44, rx + Math.sin(a) * 0.55, F + 1.02, rz + Math.cos(a) * 0.55, a); }
      solid(rx, rz, 0, 1.3, 1.3, F, F + 1.5, { noStep: true }); }
    K.boxMM("wood", CW.oak, 450.8, F, 586.5, 452.8, F + 0.8, 587.5, 0.8); solid(451.8, 587.0, 0, 2.0, 1.0, F, F + 0.8, { noStep: true }); for (let k = 0; k < 6; k++) for (let h = 0; h < 4; h++) K.box("soft", rc[(k + h) % rc.length], 0.28, 0.04, 0.24, 451.0 + (k % 3) * 0.6 + 0.1, F + 0.82 + h * 0.045, 586.8 + Math.floor(k / 3) * 0.45, 0);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4 - r; k++) { K.cyl("soft", 0x2b2f33, 0.042, 0.042, 0.25, 454.6 + k * 0.1 + r * 0.05, F + 0.6 + r * 0.25, 587.6, 10); K.cyl("soft", 0xd8f03c, 0.04, 0.04, 0.02, 454.6 + k * 0.1 + r * 0.05, F + 0.735 + r * 0.25, 587.6, 10); }
    K.boxMM("stone", CW.stone, 454.3, F, 587.3, 455.3, F + 0.48, 587.9, 1); solid(454.8, 587.6, 0, 1.0, 0.6, F, F + 1.6, { noStep: true });
    K.boxMM("wood", CW.oak, 448.4, F, 587.9, 449.8, F + 0.78, 588.6, 0.8); for (let k = 0; k < 5; k++) racquet(K, 448.6 + k * 0.28, F + 0.8, 588.25, 0, rc[(k + 2) % rc.length], true); solid(449.1, 588.25, 0, 1.4, 0.7, F, F + 0.8, { noStep: true });
    K.boxMM("wood", CW.cedar, 448.8, F, 590.4, 453.6, F + 1.0, 591.15, 0.8); K.boxMM("stone", CW.stone, 448.7, F + 1.0, 590.3, 453.7, F + 1.05, 591.25, 1.5); solid(451.2, 590.78, 0, 4.9, 0.85, F, F + 1.05, { noStep: true });
    K.box("steel", 0x141617, 0.36, 0.26, 0.03, 449.6, F + 1.22, 590.85, PI + 0.2); K.box("emit", 0x9fd4ff, 0.32, 0.22, 0.005, 449.6, F + 1.22, 590.83, PI + 0.2);
    K.cyl("steel", 0x2b2f33, 0.05, 0.12, 0.95, 454.8, F + 0.47, 591.8, 10); K.box("steel", 0x3a3f43, 0.7, 0.06, 0.22, 454.8, F + 0.98, 591.8, 0); racquet(K, 454.8, F + 0.9, 591.8, 0, 0xc23a2e);
    // ── the locker room: lockers on two walls, two benches, the vanity with mirrors, towels ──
    const lockers = (x0, z0, x1, z1, along) => { const n = Math.round((along === "z" ? z1 - z0 : x1 - x0) / 0.6); for (let i = 0; i < n; i++) for (let t = 0; t < 2; t++) { const a0 = (along === "z" ? z0 : x0) + i * 0.6, a1 = a0 + 0.58; const y0 = F + 0.18 + t * 1.0, y1 = y0 + 0.96; if (along === "z") { K.boxMM("steel", 0x6f8572, x0, y0, a0, x1, y1, a1, 1); K.box("steel", 0x23272a, 0.01, 0.02, 0.12, x1 + 0.006, y0 + 0.5, a0 + 0.47, 0); for (let v = 0; v < 3; v++) K.box("steel", 0x2d3330, 0.006, 0.012, 0.3, x1 + 0.004, y0 + 0.78 + v * 0.04, (a0 + a1) / 2, 0); }
          else { K.boxMM("steel", 0x6f8572, a0, y0, z0, a1, y1, z1, 1); K.box("steel", 0x23272a, 0.12, 0.02, 0.01, a0 + 0.47, y0 + 0.5, z1 + 0.006, 0); for (let v = 0; v < 3; v++) K.box("steel", 0x2d3330, 0.3, 0.012, 0.006, (a0 + a1) / 2, y0 + 0.78 + v * 0.04, z1 + 0.004, 0); } }
      K.boxMM("wood", CW.oak, Math.min(x0, x1), F, Math.min(z0, z1), Math.max(x0, x1), F + 0.18, Math.max(z0, z1), 1); solid((x0 + x1) / 2, (z0 + z1) / 2, 0, Math.abs(x1 - x0), Math.abs(z1 - z0), F, F + 2.2, { noStep: true }); };
    lockers(c.x0 + 0.45, 580.2, c.x0 + 1.0, 592.8, "z"); lockers(424.6, c.z0 + 0.45, 432.4, c.z0 + 1.0, "x");
    bench(K, 428.4, 584.6, -PI / 2, 2.6, F, false); bench(K, 428.4, 589.4, -PI / 2, 2.6, F, false);
    K.boxMM("stone", CW.stone, 424.8, F + 0.82, 592.95, 431.6, F + 0.88, 593.55, 1.5); K.boxMM("wood", CW.cedar, 424.8, F, 593.0, 431.6, F + 0.82, 593.5, 0.8); solid(428.2, 593.25, 0, 6.8, 0.6, F, F + 0.88, { noStep: true });
    for (const x of [426.0, 428.2, 430.4]) { K.box("soft", 0xf4f2ee, 0.46, 0.1, 0.34, x, F + 0.9, 593.25, 0); K.box("chrome", 0xd9dcde, 0.9, 0.95, 0.02, x, F + 1.62, 593.53, 0); K.box("emitW", 0xfff1da, 0.9, 0.04, 0.02, x, F + 2.16, 593.5, 0); K.cyl("chrome", 0xc6cacd, 0.012, 0.012, 0.18, x, F + 0.98, 593.42, 6); }
    K.boxMM("wood", CW.oak, 431.6, F, 586.9, 432.7, F + 1.8, 588.2, 0.8); for (let k = 0; k < 4; k++) for (let m = 0; m < 3; m++) K.box("soft", [0xf3efe6, 0xe5e0d2, 0x6d8f7a][m], 0.4, 0.09, 0.32, 432.15, F + 0.32 + k * 0.4 + m * 0.095, 587.55, 0);
    solid(432.15, 587.55, 0, 1.1, 1.3, F, F + 1.8, { noStep: true });
    { const uv = signUV(1024, 1152, 1536, 1280); K.quad("sign", 0xffffff, [433.3, F + 2.45, 586.6], [433.3, F + 2.45, 584.6], [433.3, F + 2.95, 584.6], [433.3, F + 2.95, 586.6], uv); }
    // ── ceiling light: warm downlights in the slat ceiling (their glow at night is the emissive level) ──
    for (let x = 425.2; x < 456; x += 2.6) for (let z = 581.0; z < 593; z += 2.9) { if (Math.abs(x - 433) < 0.6 || Math.abs(x - 447) < 0.6) continue; const lob = x > 433.2 && x < 446.8; K.cyl("emitW", 0xffe2b8, 0.075, 0.075, 0.02, x, F + (lob ? 5.33 : 3.93), z, 12); }
    // potted plants: a fiddle-leaf corner and agaves in pots by the doors
    for (const [x, z] of [[434.0, 580.4], [447.2, 592.9], [424.4, 592.8]]) { K.cyl("earth", 0xffffff, 0.24, 0.18, 0.5, x, F + 0.25, z, 14); for (let k = 0; k < 9; k++) { const a = k * 2.399, r = 0.05 + k * 0.022; const g = new THREE.SphereGeometry(0.14, 7, 5); g.scale(1, 0.35, 0.7); g.rotateY(a); g.translate(x + Math.cos(a) * r, F + 0.7 + k * 0.1, z + Math.sin(a) * r); K.add("soft", g, 0x47693d); } solid(x, z, 0, 0.5, 0.5, F, F + 1.2, { noStep: true }); }
  }

  // ───────────── people: rallies on the show court and a pickleball court, the coach's drill, the staff, a few members ─────────────
  // The players are the client's own rigged avatars (avatar(), animateWalk(): idle, walk and jog). A swing is a two-bone IK on the
  // right arm toward a hand path (backswing, contact, follow-through) with a torso turn, applied after the mixer each frame; the
  // racket follows the hand. The ball flies on a real arc (gravity, a hard-court bounce that keeps about three quarters of its height), and
  // the receiver runs to where it will be. Points end on an error or a ball out of reach, then the next serve.
  const PP = SC.pp = { list: [], courts: [], balls: [], built: false, at: 0 };
  const G9 = 9.81;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c3 = new THREE.Vector3(), _d = new THREE.Vector3(), _qA = new THREE.Quaternion(), _qB = new THREE.Quaternion(), _qP = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
  function findBones(g) { const B = {}; g.traverse((o) => { if (!o.isBone) return; const n = o.name; if (n === "RightArm") B.arm = o; else if (n === "RightForeArm") B.fore = o; else if (n === "RightHand") B.hand = o; else if (n === "Spine01") B.spine = o; else if (n === "Spine02" && !B.spine) B.spine = o; else if (n === "LeftArm") B.larm = o; else if (n === "LeftForeArm") B.lfore = o; else if (n === "LeftHand") B.lhand = o; }); return B; }
  // aim bone `b` (world) so the direction from its joint to its child joint `cj` points at `target`
  function aimBone(b, cj, target) { b.getWorldPosition(_a); cj.getWorldPosition(_b); _c3.subVectors(_b, _a).normalize(); _d.subVectors(target, _a).normalize(); if (_c3.lengthSq() < 1e-8 || _d.lengthSq() < 1e-8) return; _qA.setFromUnitVectors(_c3, _d); b.getWorldQuaternion(_qB); _qB.premultiply(_qA); b.parent.getWorldQuaternion(_qP); _qP.invert(); b.quaternion.copy(_qP.multiply(_qB)); b.updateMatrixWorld(true); }
  function twistBone(b, ang) { if (!b || !ang) return; _qA.setFromAxisAngle(_up, ang); b.getWorldQuaternion(_qB); _qB.premultiply(_qA); b.parent.getWorldQuaternion(_qP); _qP.invert(); b.quaternion.copy(_qP.multiply(_qB)); b.updateMatrixWorld(true); }
  const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _H = new THREE.Vector3(), _T = new THREE.Vector3(), _P = new THREE.Vector3(), _dir = new THREE.Vector3(), _perp = new THREE.Vector3();
  function armIK(B, T, pole) { if (!B.arm || !B.fore || !B.hand) return; B.arm.getWorldPosition(_S); B.fore.getWorldPosition(_E); B.hand.getWorldPosition(_H); const a = _S.distanceTo(_E), b = _E.distanceTo(_H); _dir.subVectors(T, _S); let d = _dir.length(); if (d < 1e-4) return; _dir.multiplyScalar(1 / d); d = clamp(d, Math.abs(a - b) + 0.02, a + b - 0.015);
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA); _perp.copy(pole).addScaledVector(_dir, -pole.dot(_dir)); if (_perp.lengthSq() < 1e-6) _perp.set(0, -1, 0); _perp.normalize();
    _P.copy(_S).addScaledVector(_dir, a * cosA).addScaledVector(_perp, a * sinA); aimBone(B.arm, B.fore, _P); _T.copy(_S).addScaledVector(_dir, d); aimBone(B.fore, B.hand, _T); }
  // the hand path of a stroke in the player's frame (r right, f forward toward the net, y up), phase 0..1, contact at 0.5
  const FORE = [[0.32, 1.1, 0.12], [0.78, 1.28, -0.5], [0.66, 0.98, 0.38], [-0.12, 1.42, 0.42], [0.3, 1.12, 0.14]];
  const BACK = [[-0.15, 1.12, 0.18], [-0.72, 1.18, -0.45], [-0.56, 0.98, 0.42], [0.42, 1.38, 0.3], [0.2, 1.12, 0.16]];
  const FEED = [[0.3, 0.95, 0.2], [0.42, 0.62, -0.32], [0.38, 0.85, 0.42], [0.25, 1.15, 0.5], [0.3, 1.0, 0.25]];
  function pathAt(P, t) { const k = clamp(t, 0, 1) * 4, i = Math.min(3, Math.floor(k)), f = k - i; const s = f * f * (3 - 2 * f); const a = P[i], b = P[i + 1]; return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]; }
  // ── rackets, paddles and balls: one dynamic mesh each (every frame the templates are written at their matrices) ──
  function templ(kind) { const K = new Kit("tpl"); if (kind === "paddle") { K.box("soft", 0x2c5b8c, 0.2, 0.26, 0.016, 0, 0.38, 0); K.box("soft", 0x1c1d1e, 0.03, 0.14, 0.03, 0, 0.18, 0); K.box("soft", 0xf2f1ea, 0.205, 0.02, 0.018, 0, 0.51, 0); }
    else { K.cyl("soft", 0x1c1d1e, 0.016, 0.016, 0.24, 0, 0.08, 0, 6); K.tube("soft", 0xc23a2e, V(0, 0.2, 0), V(-0.055, 0.33, 0), 0.008, 5); K.tube("soft", 0xc23a2e, V(0, 0.2, 0), V(0.055, 0.33, 0), 0.008, 5); const g = new THREE.TorusGeometry(0.125, 0.01, 5, 20); g.scale(1, 1.25, 1); g.translate(0, 0.49, 0); K.add("soft", g, 0xc23a2e); K.box("soft", 0xe9e6dc, 0.22, 0.29, 0.004, 0, 0.49, 0); }
    return K.merged().soft; }
  function ballTpl(r) { const g = new THREE.IcosahedronGeometry(r, 1); const K = new Kit("ball"); K.add("soft", g, 0xd6ee3a); return K.merged().soft; }
  function shadeTpl() { const g = new THREE.PlaneGeometry(0.16, 0.16); g.rotateX(-PI / 2); const K = new Kit("bshade"); K.add("pool", g, 0x000000); return K.merged().pool; }
  class Batch {   // n slots of one template, written every frame (hidden slots collapse to a point)
    constructor(tpl, n, mat, name) { this.t = tpl; this.n = n; const vc = tpl.attributes.position.count; this.vc = vc; const g = new THREE.BufferGeometry(); for (const k of ["position", "normal", "uv", "color", "aLit"]) { const a = tpl.attributes[k]; if (!a) continue; const arr = new Float32Array(a.array.length * n); for (let i = 0; i < n; i++) arr.set(a.array, i * a.array.length); g.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize)); }
      g.attributes.position.setUsage(THREE.DynamicDrawUsage); if (g.attributes.normal) g.attributes.normal.setUsage(THREE.DynamicDrawUsage); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(445, L.pad + 2, 597), 90); this.g = g; this.m = new THREE.Mesh(g, mat); this.m.name = "sc " + name; this.m.frustumCulled = true; this.m.castShadow = false; this.m.receiveShadow = false; this.m.userData.noSolid = true; this.m.userData.noBatch = true;
      this.slot = []; this.mat4 = []; for (let i = 0; i < n; i++) { this.slot.push(new THREE.Matrix4()); this.mat4.push(null); } this.dirty = true; }
    // a slot takes a copy of m4 (null hides it); nothing is rewritten when nothing changed
    set(i, m4) { if (!m4) { if (this.mat4[i] === null) return; this.mat4[i] = null; this.dirty = true; return; } const s = this.slot[i]; if (this.mat4[i] && s.equals(m4)) return; s.copy(m4); this.mat4[i] = s; this.dirty = true; }
    write() { if (!this.dirty) return; this.dirty = false; const P = this.g.attributes.position.array, N = this.g.attributes.normal ? this.g.attributes.normal.array : null, TP = this.t.attributes.position.array, TN = this.t.attributes.normal ? this.t.attributes.normal.array : null, vc = this.vc;
      for (let i = 0; i < this.n; i++) { const m = this.mat4[i], o = i * vc * 3; if (!m) { for (let k = 0; k < vc * 3; k++) P[o + k] = 0; continue; } const e = m.elements;
        for (let k = 0; k < vc; k++) { const x = TP[k * 3], y = TP[k * 3 + 1], z = TP[k * 3 + 2]; P[o + k * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; P[o + k * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; P[o + k * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          if (N) { const nx = TN[k * 3], ny = TN[k * 3 + 1], nz = TN[k * 3 + 2]; N[o + k * 3] = e[0] * nx + e[4] * ny + e[8] * nz; N[o + k * 3 + 1] = e[1] * nx + e[5] * ny + e[9] * nz; N[o + k * 3 + 2] = e[2] * nx + e[6] * ny + e[10] * nz; } } }
      this.g.attributes.position.needsUpdate = true; if (N) this.g.attributes.normal.needsUpdate = true; } }
  const _m4b = new THREE.Matrix4(), _xA = new THREE.Vector3(), _yA = new THREE.Vector3(), _zA = new THREE.Vector3();
  // ── a person on a court ──
  function mkPlayer(def, court, end) { if (typeof avatar !== "function") return null; const g = avatar("sc_" + def.id, def.name, def.look || {}, def.hat || null, def.outfit || null); g.position.set(court.cx, court.y, court.cz); scene.add(g); g.visible = false; try { if (g.userData.label) { g.userData.label.scale.set(1.5, 0.38, 1); g.userData.label.visible = false; } } catch (e) {}
    const P = { def, g, B: findBones(g), court, end, x: court.cx, z: court.cz, yaw: 0, sp: 0, swing: null, tgt: null, rk: PP.list.length, paddle: court.kind === "p", near: false }; PP.list.push(P); cnt("players"); return P; }
  function faceTo(P, x, z) { return Math.atan2(x - P.x, z - P.z); }
  function angLerp(a, b, t) { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * t; }
  // where the receiver must stand to meet the ball at `cp` with a forehand (ball at the right) or a backhand
  // the player's right and forward (toward the net) in world x, z: avatars face their local +z, so right = forward x up
  function netFrame(P) { const yw = P.end < 0 ? 0 : PI; return { rx: -Math.cos(yw), rz: Math.sin(yw), fx: Math.sin(yw), fz: Math.cos(yw) }; }
  function sideOf(P, x, z) { const F0 = netFrame(P); return ((x - P.x) * F0.rx + (z - P.z) * F0.rz) >= -0.1 ? 1 : -1; }
  function standFor(P, cp, side) { const F0 = netFrame(P); return [cp.x - side * F0.rx * 0.82 - F0.fx * 0.18, cp.z - side * F0.rz * 0.82 - F0.fz * 0.18]; }
  // a shot from `from` (ball position) to a bounce target, with a flight time that clears the net
  function shoot(C, ball, from, tx, tz, vh, netH, apexMin) { const g = C.g1 || G9; const dx = tx - from.x, dz = tz - from.z, dist = hyp(dx, dz); let T = Math.max(0.3, dist / vh); const yb = C.r;
    for (let k = 0; k < 10; k++) { const vy = (yb - from.y + 0.5 * g * T * T) / T; const tn = Math.abs((C.cz - from.z) / (dz / T)); const yn = from.y + vy * tn - 0.5 * g * tn * tn; const apex = from.y + vy * vy / (2 * g); if (yn > netH + 0.14 && apex > (apexMin || 0)) break; T *= 1.08; }
    const vy = (yb - from.y + 0.5 * g * T * T) / T; ball.p.copy(from); ball.v.set(dx / T, vy, dz / T); ball.bounces = 0; ball.live = true; ball.t = 0; ball.on = true; return T; }
  // the receiver's contact after the bounce: time from now and the point (on the way down at hc, or at the top if lower)
  function predict(C, ball, T1, hc) { const bx = ball.p.x + ball.v.x * T1, bz = ball.p.z + ball.v.z * T1; const vyB = -(ball.v.y - (C.g1 || G9) * T1) * C.e, vh = C.fr; const vx = ball.v.x * vh, vz = ball.v.z * vh; const t2 = Math.max(0.05, vyB / G9); const y2 = C.r + vyB * t2 - 0.5 * G9 * t2 * t2; return { t: T1 + t2, x: bx + vx * t2, z: bz + vz * t2, y: y2, bx, bz }; }
  function stepBall(C, b, dt) { if (!b.on) return; b.t += dt; b.v.y -= (b.bounces === 0 ? C.g1 || G9 : G9) * dt; b.p.addScaledVector(b.v, dt); if (b.p.y < C.r && b.v.y < 0) { b.p.y = C.r; b.bounces++; b.v.y = -b.v.y * C.e; b.v.x *= C.fr; b.v.z *= C.fr; if (b.bounces > 3) { b.v.y *= 0.4; } if (b.bounces > 6) { b.v.x *= 0.92; b.v.z *= 0.92; } }
    // the fences stop it (a soft rebound)
    const R0 = C.rect; if (b.p.x < R0.x0 + 0.1 || b.p.x > R0.x1 - 0.1) { b.v.x *= -0.25; b.p.x = clamp(b.p.x, R0.x0 + 0.1, R0.x1 - 0.1); } if (b.p.z < R0.z0 + 0.1 || b.p.z > R0.z1 - 0.1) { b.v.z *= -0.25; b.p.z = clamp(b.p.z, R0.z0 + 0.1, R0.z1 - 0.1); }
    // the net: below the tape it drops dead
    if (b.live && Math.sign(b.p.z - C.cz) !== Math.sign(b.p.z - b.v.z * dt - C.cz) && b.p.y < C.netH + 0.02 && Math.abs(b.p.x - C.cx) < C.w / 2 + 0.9) { b.v.z *= -0.12; b.v.x *= 0.3; b.live = false; b.net = true; } }
  // ── a rally court: two players, one ball, a little state machine ──
  function mkCourt(kind, cx, cz, defs, rect) { const y = L.pad + 0.10; const tennis = kind === "t";
    PP.y0 = y; const C = { kind, cx, cz, y, rect, L: tennis ? T1.len : PB.len, w: tennis ? T1.sgl : PB.wid, netH: tennis ? T1.netC : PB.netC, r: tennis ? 0.034 : 0.037, e: tennis ? 0.74 : 0.62, fr: tennis ? 0.58 : 0.72, g1: tennis ? 13.0 : 11.0, vh: tennis ? [17, 22] : [9, 13], hc: tennis ? 0.95 : 0.72, st: "wait", t: 0, rally: 0, server: 0, players: [], ball: { p: new THREE.Vector3(cx, 1, cz), v: new THREE.Vector3(), on: false, bounces: 0, slot: PP.balls.length }, calls: 0 };
    PP.balls.push(C.ball); C.players = [mkPlayer(defs[0], C, -1), mkPlayer(defs[1], C, 1)].filter(Boolean); if (C.players.length < 2) return null;
    for (const P of C.players) { P.home = [cx, cz + P.end * (C.L / 2 + (tennis ? 0.9 : 0.6))]; P.x = P.home[0]; P.z = P.home[1]; P.yaw = P.end < 0 ? 0 : PI; }
    PP.courts.push(C); return C; }
  function courtFrame(C, dt) { const b = C.ball, A = C.players[0]; C.t += dt; stepBall(C, b, dt);
    const other = (P) => C.players[P === A ? 1 : 0];
    if (C.st === "wait") { if (C.t > 1.6) { const S = C.players[C.server]; C.rally = 0; C.st = "serve"; C.t = 0; S.tgt = S.home.slice(); startSwing(S, 1, 0.3); } }
    else if (C.st === "serve") { if (C.t >= 0.3) { const S = C.players[C.server], O = other(S), F0 = netFrame(S); const from = new THREE.Vector3(S.x + F0.rx * 0.62 + F0.fx * 0.3, C.hc + 0.1, S.z + F0.rz * 0.62 + F0.fz * 0.3);
        const tz = C.cz + O.end * (C.kind === "t" ? 5.5 + Math.random() * 4 : 3.5 + Math.random() * 2.2), tx = C.cx + (Math.random() * 2 - 1) * (C.w / 2 - 0.8); const T1 = shoot(C, b, from, tx, tz, C.vh[0] * 0.9, C.netH, 0); plan(C, O, T1, false); } }
    else if (C.st === "flight") { const R = C.recv; if (R && C.contactAt !== null) { const tl = C.contactAt - b.t; if (!R.swing && tl < 0.36 && tl > 0) startSwing(R, C.side, tl); if (tl <= 0) {   // contact
          C.rally++; const S = R, O = other(S); const err = C.rally > 2 && Math.random() < (C.kind === "t" ? 0.12 : 0.1); const mid = C.kind === "p" && C.rally > 2;
          const depth = mid ? 0.7 + Math.random() * 1.4 : (C.kind === "t" ? 4.0 + Math.random() * 4.0 : 3.6 + Math.random() * 2.4); const lat = (Math.random() * 2 - 1) * (C.w / 2 - 0.5);
          let tx = C.cx + lat, tz = C.cz + O.end * depth; if (err) { if (Math.random() < 0.5) tz = C.cz + O.end * (C.L / 2 + 0.6 + Math.random() * 1.8); else tx = C.cx + Math.sign(lat || 1) * (C.w / 2 + 0.4 + Math.random()); }
          const vh = mid ? 4.2 + Math.random() * 1.6 : C.vh[0] + Math.random() * (C.vh[1] - C.vh[0]); const from = b.p.clone(); const T1 = shoot(C, b, from, tx, tz, vh, C.netH, mid ? from.y + 0.25 : 0);
          if (err && Math.random() < 0.35) b.v.y *= 0.55;   // into the net
          plan(C, O, T1, err); if (C.rally > 3 && Math.random() < 0.08) say(S, "rally"); } }
      if (!b.live || b.bounces >= 2 || C.contactAt === null) { if (b.bounces >= 2 || b.net || !b.live || b.t > 4.5) { C.st = "dead"; C.t = 0; cnt("pts_" + C.kind); cnt("why_" + (b.net ? "net" : C.why || "late")); cnt("shots_" + C.kind, C.rally); if (Math.random() < 0.5) say(C.players[Math.random() < 0.5 ? 0 : 1], b.net ? "net" : "point"); } } }
    else if (C.st === "dead") { if (C.t > 2.8) { C.st = "wait"; C.t = 0; C.server = 1 - C.server; b.on = false; for (const P of C.players) P.tgt = P.home.slice(); } }
    for (const P of C.players) movePlayer(P, dt); }
  function plan(C, R, T1, err) { const b = C.ball; C.recv = R; b.net = false; C.why = err ? "err" : ""; if (err) { C.contactAt = null; R.tgt = [R.home[0] + (Math.random() - 0.5) * 1.5, R.home[1]]; C.st = "flight"; return; }
    const pr = predict(C, b, T1, C.hc); const side = sideOf(R, pr.x, pr.z); const st = standFor(R, pr, side); const tt = Math.max(0.3, pr.t); const dist = hyp(st[0] - R.x, st[1] - R.z);
    if (dist / tt > 5.2 || Math.abs(pr.z - C.cz) > C.L / 2 + 4.5) { C.why = dist / tt > 5.2 ? "reach" : "deep"; C.contactAt = null; R.tgt = [st[0], st[1]]; R.chase = true; C.st = "flight"; return; }
    C.contactAt = b.t + tt; C.side = side; R.tgt = st; R.chase = false; C.st = "flight"; const O = C.players[R === C.players[0] ? 1 : 0]; O.tgt = [O.home[0] + (pr.x - C.cx) * 0.25, O.home[1] + (C.kind === "p" && C.rally > 1 ? -O.end * (C.L / 2 - PB.kit - 0.5) : 0)]; }
  function startSwing(P, side, lead) { P.swing = { t: 0, dur: Math.max(0.55, lead * 2.0), side, kind: side > 0 ? FORE : BACK }; }
  const TWIST = [[0], [-0.6], [0.0], [0.55], [0]];
  function movePlayer(P, dt) { if (!P.tgt) P.tgt = P.home.slice(); const dx = P.tgt[0] - P.x, dz = P.tgt[1] - P.z, d = hyp(dx, dz); const maxV = P.chase ? 5.0 : 4.2; let want = d > 0.05 ? Math.min(maxV, d * 3.2) : 0; P.sp += (want - P.sp) * Math.min(1, dt * 6); const step = Math.min(d, P.sp * dt); if (d > 1e-4) { P.x += dx / d * step; P.z += dz / d * step; }
    const net = P.end < 0 ? 0 : PI; const run = d > 1.3 && P.sp > 1.6 && !P.swing; const yawT = run ? Math.atan2(dx, dz) : net; P.yaw = angLerp(P.yaw, yawT, Math.min(1, dt * 7));
    if (P.swing) { P.swing.t += dt / P.swing.dur; if (P.swing.t >= 1) P.swing = null; } }
  // pose after the mixer: torso turn, the arm on the hand path, the racket in the hand
  const _rk = new THREE.Matrix4(), _hp = new THREE.Vector3(), _ep = new THREE.Vector3(), _pole = new THREE.Vector3(), _T2 = new THREE.Vector3();
  function posePlayer(P) { const g = P.g, B = P.B; if (!B.arm || !B.hand) return; const yaw = P.yaw, c = Math.cos(yaw), s = Math.sin(yaw); const rx = -c, rz = s, fx = s, fz = c;   // right and forward in world (x, z)
    const sw = P.swing; const path = sw ? sw.kind : null; const t = sw ? sw.t : 0; const loc = sw ? pathAt(path, t) : [0.3, 1.1, 0.16];
    const turn = sw ? sw.side * pathAt(TWIST.map((q) => [q[0], 0, 0]), t)[0] * (sw.kind === FEED ? 0.3 : 1) : 0; twistBone(B.spine, turn);
    const T = _T2.set(g.position.x + rx * loc[0] + fx * loc[2], g.position.y + loc[1], g.position.z + rz * loc[0] + fz * loc[2]); _pole.set(rx * 0.4 - fx * 0.3, -1, rz * 0.4 - fz * 0.3).normalize(); armIK(B, T, _pole);
    // the racket: shaft along the forearm (with a wrist set), face toward the swing
    B.hand.getWorldPosition(_hp); B.fore.getWorldPosition(_ep); _yA.subVectors(_hp, _ep).normalize(); const wr = sw ? -0.35 : -0.9; _yA.y += wr * 0.0; _yA.addScaledVector(_up, sw ? 0.25 : 0.9).normalize();
    _zA.set(fx, 0, fz); _zA.addScaledVector(_yA, -_zA.dot(_yA)); if (_zA.lengthSq() < 1e-4) _zA.set(rx, 0, rz); _zA.normalize(); _xA.crossVectors(_yA, _zA).normalize();
    _rk.makeBasis(_xA, _yA, _zA); _rk.setPosition(_hp.x + _yA.x * 0.02, _hp.y + _yA.y * 0.02, _hp.z + _yA.z * 0.02); P.rkM = (P.rkM || new THREE.Matrix4()).copy(_rk); }
  // the racket in the hand without re-posing the arm (the frames the client skipped this player's mixer)
  function racketOnly(P) { const B = P.B; if (!B.hand || !B.fore || !P.rkM) return; B.hand.getWorldPosition(_hp); B.fore.getWorldPosition(_ep); _yA.subVectors(_hp, _ep).normalize(); _yA.addScaledVector(_up, P.swing ? 0.25 : 0.9).normalize(); const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw); _zA.set(fx, 0, fz); _zA.addScaledVector(_yA, -_zA.dot(_yA)); if (_zA.lengthSq() < 1e-4) _zA.set(-fz, 0, fx); _zA.normalize(); _xA.crossVectors(_yA, _zA).normalize(); _rk.makeBasis(_xA, _yA, _zA); _rk.setPosition(_hp.x + _yA.x * 0.02, _hp.y + _yA.y * 0.02, _hp.z + _yA.z * 0.02); P.rkM.copy(_rk); }
  function say(P, kind) { try { const lines = C("lines." + kind, null); if (!lines || !lines.length || !P || !P.near || !P.g.visible) return; const txt = lines[Math.floor(Math.random() * lines.length)]; if (typeof makeBubble !== "function") return; const g = P.g; if (g.userData.bubble) g.remove(g.userData.bubble); g.userData.bubble = makeBubble(txt); g.add(g.userData.bubble); g.userData.bubbleAt = performance.now(); cnt("said"); } catch (e) { err("say", e); } }
  // ── the coach's drill on court 2: the coach feeds from the basket at the net, the student hits from the baseline ──
  function mkDrill(cx, cz, coachDef, studentDef, rect) { const y = L.pad + 0.10; const D = { kind: "t", cx, cz, y, rect, L: T1.len, w: T1.sgl, netH: T1.netC, r: 0.034, e: 0.74, fr: 0.58, g1: 12.0, hc: 0.95, t: 0, balls: [], st: 0, n: 0 };
    D.coach = mkPlayer(coachDef, D, -1); D.student = mkPlayer(studentDef, D, 1); if (!D.coach || !D.student) return null; D.coach.home = [cx - 1.0, cz - 3.2]; D.coach.x = D.coach.home[0]; D.coach.z = D.coach.home[1]; D.student.home = [cx + 0.6, cz + T1.len / 2 + 0.6]; D.student.x = D.student.home[0]; D.student.z = D.student.home[1]; D.student.yaw = PI; D.coach.isCoach = true;
    for (let i = 0; i < 3; i++) { const b = { p: new THREE.Vector3(cx, 1, cz), v: new THREE.Vector3(), on: false, bounces: 0, slot: PP.balls.length }; PP.balls.push(b); D.balls.push(b); } PP.drill = D; return D; }
  function drillFrame(D, dt) { D.t += dt; for (const b of D.balls) { stepBall(D, b, dt); if (b.on && b.t > 6) b.on = false; }
    const Co = D.coach, St = D.student;
    if (D.t > 3.1) { D.t = 0; const b = D.balls[D.n++ % D.balls.length]; const F0 = netFrame(Co); const from = new THREE.Vector3(Co.x + F0.rx * 0.4 + F0.fx * 0.35, 0.85, Co.z + F0.rz * 0.4 + F0.fz * 0.35); const tx = D.cx + (Math.random() * 2 - 1) * 2.6, tz = D.cz + 7.8 + Math.random() * 2.6; startSwing(Co, 1, 0.25); Co.swing.kind = FEED; Co.swing.dur = 0.7; const T1 = shoot(D, b, from, tx, tz, 9.5 + Math.random() * 2.5, D.netH, 1.5); const pr = predict(D, b, T1, 0.95); const side = sideOf(St, pr.x, pr.z); St.tgt = standFor(St, pr, side); D.pending = { b, at: pr.t, side, pr }; St.chase = false; if (Math.random() < 0.18) say(Co, "coach"); }
    if (D.pending) { const p = D.pending, b = p.b; const tl = p.at - b.t; if (!St.swing && tl < 0.36 && tl > 0) startSwing(St, p.side, tl); if (tl <= 0 && b.on) { D.pending = null; const tx = D.cx + (Math.random() * 2 - 1) * 3.6, tz = D.cz - (5.5 + Math.random() * 5.5); shoot(D, b, b.p.clone(), tx, tz, 14 + Math.random() * 5, D.netH, 0); } }
    if (!D.pending && St.swing === null) St.tgt = St.home.slice();
    movePlayer(Co, dt); movePlayer(St, dt); Co.yaw = angLerp(Co.yaw, 0, Math.min(1, dt * 5)); }
  // ── the staff: talk cards (the client's CAST), standing at their counters ──
  const STAFF = PP.staff = [];
  function mkStaff(id, x, z, face) { const A = C("staff." + id, null); if (!A || typeof avatar !== "function") return null; if (CAST.some((c) => c.id === "sc_" + id)) return null; const g = avatar("sc_" + id, A.name, A.look || {}, A.hat || null, A.outfit || null); g.position.set(x, L.F + 0.02, z); g.rotation.y = face; g.visible = false; try { g.userData.label.scale.set(1.6, 0.4, 1); } catch (e) {} scene.add(g);
    const talk = (A.talk || []).map((q) => ({ t: q.t, o: q.o })); const c = { id: "sc_" + id, name: A.name, role: A.role, pos: [x, z], look: A.look, hat: A.hat || null, outfit: A.outfit || null, greet: A.greet || ["Welcome."], talk, kw: [], g, rot: face }; CAST.push(c);
    const h = { x, z, r: 3.0, t: c.name, k: c.role + " · press E to talk", p: talk[0] ? talk[0].t : "", play: "npc:" + c.id }; hotspots.push(h); HS.push(h); STAFF.push({ c, g, home: [x, z], face }); cnt("staff"); return c; }
  function buildPeople() { if (PP.built) return; PP.built = true; const T = L.tennis, Pk = L.pickle; const pd = C("players", {});
    const def = (k, dflt) => Object.assign({ id: k }, dflt, pd[k] || {});
    mkCourt("t", T.cx[0], T.cz, [def("ana", { name: "Ana", look: { body: "f", skin: "c98f63", shirt: "f3f1ea", pants: "f3f1ea", hair: 2 }, hat: "hat_band" }), def("jonah", { name: "Jonah", look: { body: "m", skin: "8d5a3b", shirt: "2f6f4a", pants: "f3f1ea", hair: 1 }, hat: "hat_cap" })], T);
    mkCourt("p", Pk.cx[1], Pk.cz, [def("ruth", { name: "Ruth", look: { body: "f", skin: "e8c19a", shirt: "4d7fa8", pants: "1c1f24", hair: 4 }, hat: "hat_band" }), def("eli", { name: "Ellis", look: { body: "m", skin: "e8c19a", shirt: "d0a24a", pants: "2b2f33", hair: 3 } })], Pk);
    mkDrill(T.cx[1], T.cz, def("coach", { name: C("staff.coach.name", "Coach Ines Calderon"), look: { body: "f", skin: "b07650", shirt: "1d3a2c", pants: "1c1f24", hair: 1 }, hat: "hat_cap" }), def("student", { name: "Theo", look: { body: "m", skin: "c98f63", shirt: "e9e2d3", pants: "2b2f33", hair: 2 } }), T);
    // the coach's talk card follows the drill's coach (a CAST entry on her own avatar)
    try { const A = C("staff.coach", null), D = PP.drill; if (A && D && D.coach && !CAST.some((c) => c.id === "sc_coach")) { const c = { id: "sc_coach", name: A.name, role: A.role, pos: [D.coach.x, D.coach.z], look: A.look, greet: A.greet || [], talk: (A.talk || []).map((q) => ({ t: q.t, o: q.o })), kw: [], g: D.coach.g, rot: 0 }; CAST.push(c); const h = { x: T.cx[1] - 3.0, z: T.cz - 3.2, r: 3.4, t: c.name, k: c.role + " · press E to talk", p: c.talk[0] ? c.talk[0].t : "", play: "npc:sc_coach" }; hotspots.push(h); HS.push(h); SC.coachCast = c; } } catch (e) { err("coach card", e); }
    mkStaff("barista", 444.2, 581.4, 0); mkStaff("pro", 451.2, 592.0, PI);
    // rackets (and paddles) and balls: three dynamic meshes
    const nR = PP.list.length; PP.rk = new Batch(templ("racket"), nR + 1, MT.soft, "rackets"); PP.pd = new Batch(templ("paddle"), nR + 1, MT.soft, "paddles"); PP.bl = new Batch(ballTpl(0.034), PP.balls.length + 1, MT.soft, "balls"); PP.sh = new Batch(shadeTpl(), PP.balls.length + 1, MT.shade, "ballshade");
    for (const Bt of [PP.rk, PP.pd, PP.bl, PP.sh]) { scene.add(Bt.m); SC.groups.push(Bt.m); }
    SC.n.people = PP.list.length + STAFF.length; }
  const _bm = new THREE.Matrix4(), _id = new THREE.Matrix4();
  function peopleFrame(dt, near, dCam) { if (!PP.built) return; const vis = near; dt = Math.min(dt, 0.05);
    for (const C2 of PP.courts) courtFrame(C2, dt); if (PP.drill) drillFrame(PP.drill, dt);
    let ri = 0; for (const P of PP.list) { const g = P.g; const dd = hyp(g.position.x - camera.position.x, g.position.z - camera.position.z); const show = vis && dd < 160; if (g.visible !== show) g.visible = show; P.near = show && dd < 32;
      g.position.set(P.x, P.court.y + 0.0, P.z); g.rotation.y = P.yaw; if (!show) { PP.rk.set(P.rk, null); PP.pd.set(P.rk, null); continue; }
      const mx = g.userData.mixer, t0 = mx ? mx.time : 0; try { animateWalk(g, P.sp, dt); } catch (e) {}
      if (P.near && mx && !g.userData.lodHidden) { g.updateMatrixWorld(true); if (mx.time !== t0 || !P.rkM) posePlayer(P); else racketOnly(P); (P.paddle ? PP.pd : PP.rk).set(P.rk, P.rkM); (P.paddle ? PP.rk : PP.pd).set(P.rk, null); }   // the client throttles far mixers: the last IK pose holds until the mixer moves again
      else if (((FRAME_N + P.rk) & 3) === 0) { g.updateMatrixWorld(true); if (P.B.hand) { P.B.hand.getWorldPosition(_hp); _bm.makeRotationFromEuler(_e.set(0.4, P.yaw, 0)); _bm.setPosition(_hp); (P.paddle ? PP.pd : PP.rk).set(P.rk, _bm); } }
      try { const lb = g.userData.label; if (lb) lb.visible = dd < 16; } catch (e) {} }
    for (const S of STAFF) { const dd = hyp(S.g.position.x - camera.position.x, S.g.position.z - camera.position.z); const show = vis && dd < 90; if (S.g.visible !== show) S.g.visible = show; if (show && (FRAME_N & 3) === 0) try { animateWalk(S.g, 0, dt * 4); } catch (e) {} try { if (S.g.userData.label) S.g.userData.label.visible = dd < 12; } catch (e) {} }
    // balls and their soft shadows
    let k = 0; for (const b of PP.balls) { if (vis && b.on) { _bm.makeTranslation(b.p.x, b.p.y + PP.y0, b.p.z); PP.bl.set(k, _bm); const hgt = Math.max(0, b.p.y); const sc = 1 + hgt * 0.35; _bm.makeScale(sc, 1, sc); _bm.setPosition(b.p.x, PP.y0 + 0.008, b.p.z); PP.sh.set(k, _bm); } else { PP.bl.set(k, null); PP.sh.set(k, null); } k++; }
    if (SC.game && SC.game.ball) { const gb = SC.game.ball; if (gb.on && vis) { _bm.makeTranslation(gb.p.x, gb.p.y + PP.y0, gb.p.z); PP.bl.set(k, _bm); _bm.makeScale(1 + gb.p.y * 0.35, 1, 1 + gb.p.y * 0.35); _bm.setPosition(gb.p.x, PP.y0 + 0.008, gb.p.z); PP.sh.set(k, _bm); } else { PP.bl.set(k, null); PP.sh.set(k, null); } }
    for (const Bt of [PP.rk, PP.pd, PP.bl, PP.sh]) Bt.m.visible = vis; }

  // ───────────── the members who roam the club (PLAN_ROAM, the R10 engine) ─────────────
  function roamArea() { const RO = window.PLAN_ROAM; if (!RO || !RO.area || RO.off || SC.roamArea) return; const RC = C("roam", {});
    const inCourts = (x, z) => inRect(L.tennis, x, z, 0.25) || inRect(L.pickle, x, z, 0.25) || (x > L.padel.x0 - 0.8 && x < L.padel.x1 + 0.8 && z > L.padel.z0 - 0.8 && z < L.padel.z1 + 0.8) || inRect(L.lawn, x, z, -0.2) && false;
    const P = (x, z, kind, line, face, tag, dur) => ({ kind, line, x, z, face, tag, dur });
    const def = { id: "sportsclub", max: 3, box: [387, 552, 502, 628], perCat: true, pull: 2, people: (RC.people || []).slice(), lines: RC.lines || {},
      ready: () => !!SC.ready,
      levels: [{ base: (x, z) => planGroundAt(x, z), exact: true, block: (x, z) => !inFoot(x, z, -0.6) || inCourts(x, z) }],
      entries: () => [{ x: 452.5, z: 558.4, face: PI, tag: "drive" }, { x: 409.5, z: 596.0, face: 2.0, tag: "west" }, { x: 421.2, z: 625.4, face: 0, tag: "south" }],
      seeds: () => def.entries().concat([P(446, 571, "look"), P(440, 604.2, "look"), P(470, 611.0, "look")]),
      pois: () => [P(446.0, 562.2, "look", "carts", PI, "carts", [6, 12]), P(431.0, 572.5, "chat", "club", 0, "fore", [12, 24]), P(439.8, 604.3, "look", "pickle", 0, "pickle", [8, 16]), P(424.0, 604.4, "look", "pickle", 0, "pickle", [8, 16]),
        P(461.8, 608.0, "look", "tennis", PI / 2, "tennis", [10, 20]), P(466.0, 611.2, "look", "lawn", PI, "rig", [8, 16]), P(484.0, 611.4, "chat", "lawn", 0, "lawn", [12, 24]), P(403.6, 613.0, "look", "padel", -PI / 2, "padel", [8, 16]),
        P(444.4, 585.3, "look", "cafe", PI, "cafe", [10, 20]), P(450.0, 585.8, "browse", "pro", 0, "pro", [10, 20]), P(455.8, 586.5, "browse", "pro", PI / 2, "racquets", [8, 16]), P(410.2, 594.4, "look", "club", -1.0, "wall", [6, 12])],
      seatInfo: (s) => (s.tag === "sc" && s.seat ? { kind: "sit", line: s.scStand ? "stand" : "terrace", tag: s.scStand ? "stand" : "seat" } : null),
      weight: (p, h) => { const t = p.tag || ""; if (p.kind === "sit") return t === "stand" ? 2.4 : 1.2; if (t === "tennis" || t === "pickle") return 1.6; if (t === "cafe" || t === "pro" || t === "racquets") return h > 7 && h < 21 ? 1.2 : 0.2; return 0.8; },
      count: (h) => (h < 6.5 || h > 23 ? 0 : h < 8 || h > 21.5 ? 1 : 3),
      dur: { sit: [30, 70], chat: [14, 30], look: [8, 18], browse: [10, 20] },
      visible: () => true, sameZone: () => true };
    try { SC.roamArea = RO.area(def); } catch (e) { err("roam", e); } }

  // ───────────── the ball machine challenge (pickleball court 6): ten balls, time your swing ─────────────
  const GM = SC.game = { on: false, n: 0, score: 0, hits: 0, streak: 0, best: 0, t: 0, phase: "", ball: { p: new THREE.Vector3(), v: new THREE.Vector3(), on: false, bounces: 0 }, ui: null };
  try { GM.best = +localStorage.getItem("g1:scBest") || 0; } catch (e) {}
  const GC = () => ({ kind: "p", cx: L.pickle.cx[3], cz: L.pickle.cz, y: L.pad + 0.10, rect: { x0: L.pickle.cx[3] - 4.5, x1: L.pickle.cx[3] + 4.5, z0: L.pickle.z0, z1: L.pickle.z1 }, L: PB.len, w: PB.wid, netH: PB.netC, r: 0.037, e: 0.62, fr: 0.72, g1: 10.5, hc: 0.82 });
  function busy() { try { return !!(inside || SIT.on || cartMode || riding || golf.playing || (typeof FLY !== "undefined" && FLY.on) || $("#talk").classList.contains("on") || $("#shop").classList.contains("on")); } catch (e) { return false; } }
  function nearMachine() { const m = SC.machine; if (!m || !player) return false; return hyp(player.position.x - m.x, player.position.z - m.z) < 2.4; }
  function gameUI() { if (GM.ui) return GM.ui; const st = document.createElement("style"); st.textContent = "#scg{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:60;font-family:'Space Grotesk',system-ui,sans-serif;color:#f5f1e6;text-align:center;pointer-events:none;display:none}#scg .b{background:rgba(10,22,16,.78);border:1px solid rgba(77,222,111,.45);border-radius:14px;padding:10px 22px;backdrop-filter:blur(6px)}#scg h3{margin:0;font:700 15px 'Space Grotesk',sans-serif;letter-spacing:.14em;color:#4DDE6F}#scg .s{font:700 30px 'JetBrains Mono',Consolas,monospace;margin:4px 0}#scg .d{letter-spacing:4px;font-size:15px}#scg .k{font-size:13px;opacity:.82}#scgf{position:fixed;left:50%;top:44%;transform:translate(-50%,-50%);z-index:60;font:800 44px 'Space Grotesk',sans-serif;letter-spacing:.06em;color:#f4cd5a;text-shadow:0 2px 18px rgba(0,0,0,.6);pointer-events:none;opacity:0;transition:opacity .25s}#scgc{position:fixed;inset:0;z-index:59;pointer-events:none;display:none}";
    document.head.appendChild(st); const d = document.createElement("div"); d.id = "scg"; d.innerHTML = "<div class='b'><h3></h3><div class='s'></div><div class='d'></div><div class='k'></div></div>"; document.body.appendChild(d); const f = document.createElement("div"); f.id = "scgf"; document.body.appendChild(f); const cv = document.createElement("canvas"); cv.id = "scgc"; document.body.appendChild(cv);
    GM.ui = { d, h: d.querySelector("h3"), s: d.querySelector(".s"), dots: d.querySelector(".d"), k: d.querySelector(".k"), f, cv, cx: cv.getContext("2d") }; return GM.ui; }
  function uiText() { const U2 = gameUI(); U2.h.textContent = C("names.machineT", "BALL MACHINE CHALLENGE"); U2.s.textContent = GM.score + " pts"; let dots = ""; for (let i = 0; i < 10; i++) dots += i < GM.n ? (GM.res && GM.res[i] ? "●" : "○") : "·"; U2.dots.textContent = dots; U2.k.textContent = GM.phase === "done" ? C("game.doneK", "E to play again · Esc to leave") : C("game.k", "Space, E or click as the ball reaches you · Esc to stop"); }
  function flash(txt, col) { const U2 = gameUI(); U2.f.textContent = txt; U2.f.style.color = col || "#f4cd5a"; U2.f.style.opacity = "1"; clearTimeout(U2.ft); U2.ft = setTimeout(() => { U2.f.style.opacity = "0"; }, 650); }
  function startGame() { if (GM.on) return; const g = GC(); GM.on = true; GM.n = 0; GM.score = 0; GM.hits = 0; GM.streak = 0; GM.res = []; GM.t = 0; GM.phase = "ready"; GM.court = g; GM.home = [g.cx, g.cz + 6.25]; GM.px = player.position.x; GM.pz = player.position.z; GM.swing = null; GM.ball.on = false; GM.pressAt = null;
    try { closeCards(); } catch (e) {} try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
    const U2 = gameUI(); U2.d.style.display = "block"; U2.cv.style.display = "block"; uiText(); flash(C("game.go", "Ready"), "#4DDE6F"); cnt("games"); }
  function endGame() { GM.on = false; GM.phase = ""; GM.ball.on = false; try { if (GM.lbHid && player.userData.label) player.userData.label.visible = true; GM.lbHid = false; } catch (e) {} const U2 = gameUI(); U2.d.style.display = "none"; U2.cv.style.display = "none"; U2.cx.clearRect(0, 0, U2.cv.width, U2.cv.height); try { if (player.userData.walk) player.userData.walk.visible = true; } catch (e) {} }
  function feed() { const g = GM.court, b = GM.ball; const from = new THREE.Vector3(g.cx + (Math.random() - 0.5) * 0.3, 0.92, g.cz - 5.55); const tx = g.cx + (Math.random() * 2 - 1) * 1.15, tz = g.cz + 3.9 + Math.random() * 1.3; const T1 = shoot(g, b, from, tx, tz, 7.2 + Math.random() * 1.8 + GM.n * 0.12, g.netH, 1.25);
    const pr = predict(g, b, T1, g.hc); GM.pr = pr; GM.contact = pr.t; GM.side = (pr.x - GM.home[0]) * 1 >= 0 ? 1 : -1; const st = [pr.x - GM.side * 0.78, Math.max(pr.z + 0.25, g.cz + 5.2)]; GM.tgt = st; GM.pressAt = null; GM.phase = "ball"; GM.hit = false; try { sfx("ui"); } catch (e) {} }
  function judge(dtc) { const a = Math.abs(dtc); if (a < 0.065) return ["perfect", 2]; if (a < 0.15) return ["good", 1]; return [dtc > 0 ? "early" : "late", 0]; }
  function gameKey() { if (!GM.on) return; if (GM.phase === "done") { endGame(); startGame(); return; } if (GM.phase !== "ball" || GM.pressAt !== null) return; GM.pressAt = GM.ball.t; const dtc = GM.contact - GM.ball.t; const [q, pts] = judge(dtc); GM.q = q;
    if (pts > 0) { GM.swing = { t: Math.max(0, 0.5 - Math.max(0, dtc) / 0.6), dur: 0.6, side: GM.side, kind: GM.side > 0 ? FORE : BACK }; GM.hitAt = GM.contact; } else { GM.swing = { t: 0.15, dur: 0.6, side: GM.side, kind: GM.side > 0 ? FORE : BACK }; } }
  function gameFrame(dt) { if (!GM.on) return; const g = GM.court, b = GM.ball; dt = Math.min(dt, 0.05); GM.t += dt;
    if (busy() || !player || hyp(player.position.x - g.cx, player.position.z - (g.cz + 4)) > 14) { endGame(); return; }
    // the player at the baseline, sliding to the ball
    const tg = GM.phase === "ball" && GM.tgt ? GM.tgt : GM.home; GM.px += clamp(tg[0] - GM.px, -2.4 * dt, 2.4 * dt); GM.pz += clamp(tg[1] - GM.pz, -2.4 * dt, 2.4 * dt); player.position.x = GM.px; player.position.z = GM.pz; player.rotation.y = PI; try { yaw = 0; } catch (e) {}
    if (GM.phase === "ready") { if (GM.t > 1.4) feed(); }
    else if (GM.phase === "ball") { stepBall(g, b, dt); const tl = GM.contact - b.t;
      if (!GM.hit && GM.q && GM.pressAt !== null && GM.hitAt !== undefined && tl <= 0 && judge(GM.contact - GM.pressAt)[1] > 0) { // the return: over the net to the far court
        GM.hit = true; const [q, pts] = judge(GM.contact - GM.pressAt); GM.score += pts + (GM.streak >= 2 ? 1 : 0); GM.hits++; GM.streak++; GM.res[GM.n] = 1; flash(q === "perfect" ? C("game.perfect", "PERFECT") : C("game.good", "GOOD"), q === "perfect" ? "#4DDE6F" : "#f4cd5a"); try { sfx("buy"); } catch (e) {}
        shoot(g, b, b.p.clone(), g.cx + (Math.random() * 2 - 1) * 2.2, g.cz - (2.4 + Math.random() * 3.6), 9 + Math.random() * 3, g.netH, 0); GM.after = 0; GM.phase = "return"; }
      else if (tl < -0.22 && !GM.hit) { GM.streak = 0; GM.res[GM.n] = 0; flash(GM.pressAt === null ? C("game.miss", "MISS") : GM.q === "early" ? C("game.early", "TOO EARLY") : C("game.late", "TOO LATE"), "#ff9180"); GM.after = 0; GM.phase = "return"; } }
    else if (GM.phase === "return") { stepBall(g, b, dt); GM.after += dt; if (GM.after > 1.05) { GM.n++; uiText(); b.on = GM.hit ? b.on : false; if (GM.n >= 10) finish(); else { GM.phase = "ball"; feed(); } } }
    else if (GM.phase === "done") { stepBall(g, b, dt); }
    if (GM.swing) { GM.swing.t += dt / GM.swing.dur; if (GM.swing.t >= 1) GM.swing = null; }
    uiText(); drawRing(); }
  function finish() { GM.phase = "done"; GM.ball.on = false; const best = Math.max(GM.best, GM.score); const nb = best > GM.best; GM.best = best; try { localStorage.setItem("g1:scBest", String(best)); } catch (e) {} const ok = GM.hits >= 7;
    flash((ok ? C("game.win", "ACE!") + " " : "") + GM.hits + " / 10", ok ? "#4DDE6F" : "#f4cd5a"); try { setStatus(C("game.result", "Ball machine") + ": " + GM.hits + " of 10 returned, " + GM.score + " points" + (nb ? " (club best)" : "")); } catch (e) {} if (ok) award("p_sc_rally"); }
  // the timing ring: drawn round the ball's contact point on screen, it closes on the ball at the moment to swing
  const _pv = new THREE.Vector3();
  function drawRing() { const U2 = gameUI(), cv = U2.cv; const W = innerWidth, Hh = innerHeight; if (cv.width !== W || cv.height !== Hh) { cv.width = W; cv.height = Hh; } const x = U2.cx; x.clearRect(0, 0, W, Hh); if (GM.phase !== "ball" || !GM.pr) return; const tl = GM.contact - GM.ball.t; if (tl > 1.1 || tl < -0.25) return;
    _pv.set(GM.pr.x, GM.pr.y + PP.y0, GM.pr.z).project(camera); if (_pv.z > 1) return; const sx = (_pv.x * 0.5 + 0.5) * W, sy = (-_pv.y * 0.5 + 0.5) * Hh; const r0 = 16, r = r0 + Math.max(0, tl) * 150;
    x.lineWidth = 4; x.strokeStyle = Math.abs(tl) < 0.065 ? "rgba(77,222,111,0.95)" : Math.abs(tl) < 0.15 ? "rgba(244,205,90,0.9)" : "rgba(245,241,230,0.75)"; x.beginPath(); x.arc(sx, sy, r, 0, TAU); x.stroke(); x.lineWidth = 2; x.strokeStyle = "rgba(77,222,111,0.55)"; x.beginPath(); x.arc(sx, sy, r0, 0, TAU); x.stroke(); }
  // the player's swing (after the client's own mixer update) and racket
  function gamePose() { if (!GM.on || !player) return; const B = PP.pB || (PP.pB = findBones(player)); if (!B.arm) return; const P = { g: player, B, yaw: PI, swing: GM.swing, end: 1 }; player.updateMatrixWorld(true); posePlayer(P); if (PP.pd && P.rkM) PP.pd.set(PP.pd.n - 1, P.rkM); }   // a paddle: the challenge is on a pickleball court
  // keys while the challenge runs never reach the game
  function keyCap(e) { if (!GM.on) return; const k = e.code; if (k === "Escape") { endGame(); e.stopImmediatePropagation(); e.preventDefault(); return; } if (k === "Space" || k === "KeyE" || k === "Enter") { if (e.type === "keydown" && !e.repeat) gameKey(); e.stopImmediatePropagation(); e.preventDefault(); return; } if (/^(Key[WASDQFCZ]|Arrow|Digit)/.test(k)) { e.stopImmediatePropagation(); e.preventDefault(); } }
  try { window.addEventListener("keydown", keyCap, true); window.addEventListener("keyup", (e) => { if (GM.on && /^(Space|KeyE|Key[WASD]|Arrow)/.test(e.code)) e.stopImmediatePropagation(); }, true); window.addEventListener("pointerdown", (e) => { if (GM.on && e.button === 0 && !(e.target && e.target.closest && e.target.closest(".card, .hud, button"))) { gameKey(); } }, true); } catch (e) { err("keys", e); }
  // the camera during the challenge: behind the baseline, looking up the court at the machine
  function gameCam(dt) { if (!GM.on || window.__cam) return false; const g = GM.court; const px = player.position.x, pz = player.position.z, py = player.position.y;   // inside the fence: just behind and to the right of the player, raised
    try { const lb = player.userData.label; if (lb && lb.visible) { lb.visible = false; GM.lbHid = true; } } catch (e) {}
    camera.position.lerp(camTarget.set(px * 0.7 + g.cx * 0.3 + 1.55, py + 3.3, Math.min(pz + 2.4, L.pickle.z1 - 0.3)), smoothK(dt, 10)); camLook(g.cx, py + 0.45, g.cz - 2.4, dt, 14); return true; }

  // ───────────── extras: the ball machine, the coach's basket, plaques and scoreboards, bollards, string lights, night pools ─────────────
  function glowPool(KN, x, y, z, r, col) { KN.flat("pool", col || 0xffb870, x - r, z - r, x + r, z + r, y, r * 2, () => 0, [-(x - r), (z - r)]); const g = KN.m.pool[KN.m.pool.length - 1]; const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / (2 * r), uv.getY(i) / (2 * r) + 1); }
  function buildExtras(K, KN) { const y = L.pad, yc = y + 0.10, yp = y + 0.12, F = L.F;
    // the ball machine at the far end of court 6 and its hopper of balls
    const mx = L.pickle.cx[3], mz = L.pickle.cz - 5.55; K.box("steel", 0x23272a, 0.55, 0.42, 0.62, mx, yc + 0.36, mz, 0); K.cyl("steel", 0x2b2f33, 0.1, 0.1, 0.06, mx - 0.3, yc + 0.1, mz - 0.2, 12, false, 0, 0, PI / 2); K.cyl("steel", 0x2b2f33, 0.1, 0.1, 0.06, mx + 0.3, yc + 0.1, mz - 0.2, 12, false, 0, 0, PI / 2);
    K.cyl("soft", 0x2b2f33, 0.3, 0.22, 0.32, mx, yc + 0.73, mz, 14, true); for (let k = 0; k < 14; k++) { const a = k * 2.4, r = 0.06 + (k % 5) * 0.04; K.sph("soft", 0xd6ee3a, 0.037, mx + Math.cos(a) * r, yc + 0.78 + (k % 3) * 0.04, mz + Math.sin(a) * r, 8); }
    K.cyl("steel", 0x1c1f21, 0.05, 0.05, 0.36, mx, yc + 0.5, mz + 0.4, 10, false, 0, PI / 2 - 0.25, 0); K.box("emit", 0x4dde6f, 0.06, 0.06, 0.01, mx + 0.15, yc + 0.5, mz + 0.315, 0);
    solid(mx, mz, 0, 0.7, 0.75, yc, yc + 0.95, { noStep: true });
    { const uv = signUV(1024, 1792, 2048, 2048); const bz = L.pickle.z1 - 0.06, x0 = mx + 1.0, x1 = mx + 3.6; K.quad("sign", 0xffffff, [x1, yc + 1.15, bz], [x0, yc + 1.15, bz], [x0, yc + 1.8, bz], [x1, yc + 1.8, bz], uv); }
    // the coach's basket at the net of court 2
    { const bx = L.tennis.cx[1] - 2.2, bz = L.tennis.cz - 2.5; for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [0.18, 0.18], [-0.18, 0.18]]) K.tube("steel", 0x2b2f33, V(bx + dx, yc, bz + dz), V(bx + dx * 0.8, yc + 0.62, bz + dz * 0.8), 0.009, 4); K.cyl("chrome", 0x9aa0a4, 0.24, 0.22, 0.32, bx, yc + 0.8, bz, 12, true); for (let k = 0; k < 18; k++) { const a = k * 2.4, r = (k % 4) * 0.055; K.sph("soft", 0xd6ee3a, 0.034, bx + Math.cos(a) * r, yc + 0.72 + Math.floor(k / 6) * 0.06, bz + Math.sin(a) * r, 8); } solid(bx, bz, 0, 0.45, 0.45, yc, yc + 0.95, { noStep: true }); }
    // court plaques on the fences (dark steel plates with the court numbers), the scoreboards on the show court and court 2
    const plq = (i, x, zz, flip) => { const uv = signUV(i * 256 + 10, 778, i * 256 + 246, 1014); const a = [x - 0.32, yc + 2.3, zz], b = [x + 0.32, yc + 2.3, zz]; const P2 = flip ? [b, a] : [a, b]; K.quad("sign", 0xffffff, P2[0], P2[1], [P2[1][0], yc + 2.94, zz], [P2[0][0], yc + 2.94, zz], uv); };
    plq(0, L.tennis.cx[0], L.tennis.z0 - 0.06, true); plq(1, L.tennis.cx[1], L.tennis.z0 - 0.06, true); for (let i = 0; i < 4; i++) plq(2 + i, L.pickle.cx[i], L.pickle.z0 - 0.06, true); plq(6, L.padel.cx, L.padel.z0 - 0.08, true);
    for (const [i, cx] of [[0, L.tennis.cx[0]], [2, L.tennis.cx[1]]]) { const uv = signUV(i * 512 + 6, 1542, i * 512 + 506, 1786); const zz = L.tennis.z1 + 0.06, x0 = cx - 1.0, x1 = cx + 1.0; K.box("steel", 0x1c1f21, 2.2, 1.1, 0.08, cx, yc + 2.55, zz + 0.05, 0); K.quad("sign", 0xffffff, [x0, yc + 2.06, zz], [x1, yc + 2.06, zz], [x1, yc + 3.04, zz], [x0, yc + 3.04, zz], uv); for (const px of [cx - 0.95, cx + 0.95]) K.cyl("steel", 0x1c1f21, 0.03, 0.03, 2.0, px, yc + 1.0, zz + 0.08, 8); }
    // bollards (0.9 m dark steel posts with a warm louvered band) along the walks, and their pools at night
    const boll = (x, z) => { K.box("steel", 0x23272a, 0.13, 0.9, 0.13, x, yp + 0.45, z, 0); K.box("emitW", 0xffe2b8, 0.135, 0.12, 0.135, x, yp + 0.74, z, 0); K.box("steel", 0x1c1f21, 0.15, 0.03, 0.15, x, yp + 0.92, z, 0); glowPool(KN, x, yp + 0.012, z, 1.6, 0xffc58a); solid(x, z, 0, 0.16, 0.16, yp, yp + 0.92, { noStep: true }); };
    for (let x = 404.5; x < 462; x += 7.2) if (x < 425 || x > 431) boll(x, 605.55); for (let x = 446.0; x < 497; x += 8.0) boll(x, 612.15); for (const [x, z] of [[424.5, 566.0], [425.0, 574.5], [461.6, 563.0], [461.6, 571.0], [452.3, 615.5], [452.3, 622.0], [403.8, 607.0], [403.8, 621.0]]) boll(x, z);
    // the soffit downlights: warm discs under the overhangs and their pools on the paving and the terrace
    for (let x = 422.4; x < 457.2; x += 2.8) { K.cyl("emitW", 0xffe2b8, 0.08, 0.08, 0.02, x, F + 4.15, L.club.z1 + 1.6, 12); glowPool(KN, x, F + 0.012, L.club.z1 + 1.6, 1.4, 0xffb870); K.cyl("emitW", 0xffe2b8, 0.08, 0.08, 0.02, x, F + 4.15, L.club.z0 - 0.8, 12); glowPool(KN, x, yp + 0.012, L.club.z0 - 0.8, 1.3, 0xffb870); }
    // string lights over the terrace: three catenaries from the roof's south fascia to the pickleball masts
    for (const [x0, x1] of [[426.0, L.pickle.x0 + 18.28], [437.0, 443.2], [449.0, 443.2]]) { const A = V(x0, F + 4.05, L.club.z1 + 3.15), B = V(x1, y + 4.6, L.pickle.z0 - 0.6); let prev = A.clone(); const n = 16; for (let i = 1; i <= n; i++) { const t = i / n; const p = new THREE.Vector3().lerpVectors(A, B, t); p.y -= Math.sin(t * PI) * 0.55; K.tube("steel", 0x1c1f21, prev, p, 0.005, 3); if (i < n) { K.sph("emitW", 0xffd59a, 0.035, p.x, p.y - 0.05, p.z, 6); } prev = p; } }
    // the club wall's uplights (two warm fans on the face) and the entrance
    if (L.wall) { const W = L.wall; for (const s of [-1, 1]) { const x = W.x + W.ux * s * 2.6 + W.face[0] * 0.9, z = W.z + W.uz * s * 2.6 + W.face[1] * 0.9; K.box("steel", 0x1c1f21, 0.18, 0.08, 0.12, x, y + 0.06, z, 0); glowPool(KN, x, y + 0.03, z, 1.2, 0xffc890); } }
    glowPool(KN, 440.0, yp + 0.014, 576.8, 2.8, 0xffc890);
    for (const [x, z] of [[433.4, 571.6], [452.6, 571.6], [432.0, 563.4], [456.0, 564.0]]) { K.cyl("steel", 0x2d2924, 0.055, 0.07, 4.6, x, yp + 2.3, z, 10); K.box("steel", 0x23262a, 0.55, 0.09, 0.2, x + 0.22, yp + 4.62, z, 0); K.box("emitW", 0xfff1dc, 0.5, 0.01, 0.16, x + 0.22, yp + 4.57, z, 0); glowPool(KN, x + 0.2, yp + 0.013, z, 3.6, 0xffd6a8); solid(x, z, 0, 0.16, 0.16, yp, yp + 4.6, { noStep: true }); }
    // players' benches at the net on both tennis courts (a cooler and a towel on each), and the wayfinding post on the forecourt
    for (const [bx, face] of [[L.tennis.x0 + 0.75, PI / 2], [L.tennis.x1 - 0.75, -PI / 2]]) for (const dz of [-1.7, 1.7]) { const bz = L.tennis.cz + dz; bench(K, bx, bz, face, 1.6, yc, true); K.box("soft", 0x2f6f4a, 0.36, 0.34, 0.26, bx, yc + 0.17, bz + Math.sign(dz) * 1.05, 0); K.box("soft", 0xf3f1ea, 0.38, 0.05, 0.28, bx, yc + 0.365, bz + Math.sign(dz) * 1.05, 0); K.box("soft", 0xf3efe6, 0.5, 0.012, 0.3, bx, yc + 0.47, bz - 0.4, face); }
    { const px = 444.2, pz = 572.4; K.box("steel", CW.corten, 0.12, 2.9, 0.12, px, yp + 1.45, pz, 0); solid(px, pz, 0, 0.14, 0.14, yp, yp + 2.9, { noStep: true });
      const tg = [[473.6, 591.3], [424.3, 615.1], [395.5, 614.0], [472.0, 618.5]]; tg.forEach((t2, i) => { const ang = Math.atan2(-(t2[1] - pz), t2[0] - px); const h = yp + 2.55 - i * 0.3; const len = 1.15; const cx = px + Math.cos(ang) * (len / 2 + 0.07), cz = pz - Math.sin(ang) * (len / 2 + 0.07);
        K.box("steel", 0x1d3a2c, len, 0.17, 0.03, cx, h, cz, ang); const ux = Math.cos(ang), uz = -Math.sin(ang), nx = -uz, nz = ux;   // the blade's length along (ux, uz), its faces along (nx, nz)
        const A0 = [px + ux * 0.07, pz + uz * 0.07], A1 = [px + ux * (len + 0.07), pz + uz * (len + 0.07)];
        for (const sd of [1, -1]) { const ox = nx * 0.017 * sd, oz = nz * 0.017 * sd; const row = i * 2 + (sd > 0 ? 0 : 1); const uv = signUV(0, 1280 + row * 32, 1024, 1280 + row * 32 + 32);
          const p0 = [A0[0] + ox, h - 0.08, A0[1] + oz], p1 = [A1[0] + ox, h - 0.08, A1[1] + oz]; const a = sd > 0 ? p0 : p1, b = sd > 0 ? p1 : p0;   // each face reads left to right from its own side
          K.quad("sign", 0xffffff, a, b, [b[0], h + 0.08, b[2]], [a[0], h + 0.08, a[2]], uv); } }); }
  }
  function buildHalos() { const P = []; const C0 = []; for (let i = 0; i < SC.haloPts.length; i += 3) { P.push(SC.haloPts[i], SC.haloPts[i + 1], SC.haloPts[i + 2]); C0.push(1, 0.96, 0.9); } const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(C0, 3)); g.computeBoundingSphere(); MT.halo.size = 2.2; const pts = new THREE.Points(g, MT.halo); pts.name = "sc halos"; pts.userData.noSolid = true; pts.userData.noBatch = true; pts.renderOrder = 3; return pts; }
  // the light pool: a few fixtures are sources for the client's pooled point lights (the nearest are drawn), lit at night only
  const LAMPS = SC.lamps = [];
  function lamps() { const y = L.pad, F = L.F; const add = (x, yy, z, d, k, col) => { const l = new THREE.PointLight(col || 0xfff3e2, 0, d, 1.4); l.position.set(x, yy, z); l.userData.k0 = k; l.userData.scLamp = true; SC.gL.add(l); LAMPS.push(l); };
    add(473.6, y + 8.2, 585.0, 28, 2.0); add(488.9, y + 8.2, 598.0, 28, 2.0); add(424.3, y + 5.6, 615.1, 24, 1.6); add(395.5, y + 5.2, 614.0, 16, 1.2); add(440.0, F + 3.7, 598.6, 14, 1.0, 0xffcf9a); add(442.0, F + 3.6, 586.4, 12, 1.1, 0xffd2a0); add(446.0, y + 3.6, 566.5, 14, 0.8, 0xffd2a0); }
  // ───────────── the defer pass: build it all, the walk grid, solids, people, warm-ups ─────────────
  function deferHook() { if (!window.PLAN) return; const t0 = nowMs(); SC.groups = SC.groups || [];
    const step = (name, fn) => { const t = nowMs(); try { fn(); } catch (e) { err(name, e); } SC.t["d_" + name] = Math.round(nowMs() - t); };
    let KX, KI, KN;
    step("mats", () => { mats(); MT.emitW = MT.emitW || sh(new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }), "sc_emit_warm"); });
    step("layout", () => layoutSails());
    step("courts", () => { KX = new Kit("ext"); KI = new Kit("int"); KN = new Kit("night"); KI.lit = 0.3; buildCourts(KX); buildFences(KX); });
    step("sails", () => buildSails(KX));
    step("club", () => buildClub(KX, KI));
    step("interior", () => buildInterior(KI));
    step("extras", () => buildExtras(KX, KN));
    step("meshes", () => { const gX = SC.gX = new THREE.Group(); gX.name = "sc_exterior"; KX.build(gX, { noCast: ["court", "pave", "gravel", "turf", "pool", "emitW", "sign", "art", "chrome", "soft", "net", "chain", "weld"] }); scene.add(gX);
      const gI = SC.gI = new THREE.Group(); gI.name = "sc_interior"; gI.userData.interior = true; KI.build(gI, { cast: false }); scene.add(gI);
      const gN = SC.gN = new THREE.Group(); gN.name = "sc_night_glow"; KN.build(gN, { cast: false }); gN.add(buildHalos()); scene.add(gN); gN.visible = false;
      const gL = SC.gL = new THREE.Group(); gL.name = "sc_lamps"; scene.add(gL); lamps(); SC.groups.push(gX, gI, gN, gL); try { LIGHTS.dirty = true; } catch (e) {} });
    step("walk", () => { let n = 0; for (const w of WALKS) { let g; if (Array.isArray(w)) { g = new THREE.PlaneGeometry(w[2] - w[0], w[3] - w[1], Math.max(1, Math.ceil((w[2] - w[0]) / 4)), Math.max(1, Math.ceil((w[3] - w[1]) / 4))); g.rotateX(-PI / 2); g.translate((w[0] + w[2]) / 2, w[4], (w[1] + w[3]) / 2); } else { const K2 = new Kit("w"); K2.poly("pave", 0xffffff, w.poly, w.y); g = K2.merged().pave; } try { walkAdd(g); n++; } catch (e) { err("walkAdd", e); } g.dispose(); } SC.n.walks = n; });
    step("people", () => buildPeople());
    step("roam", () => roamArea());
    step("warm", () => { const W = window.PLAN_PERF; if (W && W.warmGroup) for (const g of [SC.gX, SC.gI, SC.gN]) if (g) W.warmGroup(g, { name: g.name }); });
    SC.t.defer = Math.round(nowMs() - t0); SC.ready = true; console.log("plan_sportsclub: " + (SC.n.meshes || 0) + " meshes, " + (SC.n.tris || 0) + " triangles, " + SOL.length + " solids, " + SEATS.length + " seats, " + (SC.n.people || 0) + " people in " + SC.t.defer + " ms"); }
  // ───────────── every frame ─────────────
  const GOT = SC.got = new Set();
  function award(id) { if (GOT.has(id)) return; GOT.add(id); try { if (window.PLAN_PROGRESS && typeof PLAN_PROGRESS.award === "function") { PLAN_PROGRESS.award("stamp", { id }); cnt("stamps"); } } catch (e) { err("award", e); } }
  function stampFrame() { if (!player) return; const px = player.position.x, pz = player.position.z; if (!inside && inFoot(px, pz)) award("p_sc_club");
    if (SIT.on) { let st = null; for (const sd of SEATS) if (sd.scStand && Math.abs(sd.x - px) < sd.hw + 0.6 && Math.abs(sd.z - pz) < sd.hd + 0.6 && Math.abs(sd.y1 - player.position.y) < 0.4) { st = sd; break; } if (st) { const t = performance.now(); if (!SC.sitAt) SC.sitAt = t; if (t - SC.sitAt > 6000) award("p_sc_courtside"); } else SC.sitAt = 0; } else SC.sitAt = 0; }
  SC.night = { n: 0, on: false };
  function nightLevels() { const n = clamp((nightK() - 0.1) * 2.4, 0, 1), h = hourNow(); const on = n > 0.03 && (h > 15 || h < 0.5); SC.night.n = n; SC.night.on = on;
    U.lit.value = on ? 0.82 * n : 0; MT.emit.color.setScalar(on ? 0.9 + 3.0 * n : 0.9); MT.emitW.color.setScalar(0.75 + 2.4 * n); MT.sign.emissiveIntensity = 0.55 * n; if (MT.art) MT.art.emissiveIntensity = 0.16 * n; MT.pool.color.setScalar(0.55 * n); MT.halo.opacity = on ? n : 0; MT.halo.color.setScalar(1);
    for (const l of LAMPS) l.intensity = (on || l.userData.k0 < 1.2) ? l.userData.k0 * n : 0; if (SC.gN) SC.gN.visible = n > 0.02; }
  // A/B: everything the module draws hidden (groups, people, staff, rackets and balls), for measuring its share of a frame
  function dbgHide(on) { SC.dbgHide = !!on; const v = !on; for (const g of SC.groups || []) g.visible = v; for (const P of PP.list) P.g.visible = v && P.g.visible; for (const S2 of STAFF) S2.g.visible = v && S2.g.visible; try { const A = window.PLAN_ROAM && PLAN_ROAM.A.sportsclub; if (A) for (const c of A.npcs || []) if (c.g) c.g.visible = v; } catch (e) {} return SC.dbgHide; }
  const FT = SC.ft = { n: 0, sum: 0, max: 0, ema: 0 };
  function frameHook(dt, now) { if (!SC.ready) return; if (SC.dbgHide) { dbgHide(true); return; } const t0 = performance.now(); try { if ((FRAME_N % 10) === 3) nightLevels(); const cam = camera.position; const dC = hyp(cam.x - 446, cam.z - 595);
      if (SC.gI) SC.gI.visible = dC < 90; if (SC.gN && SC.gN.visible && dC > 700) SC.gN.visible = false;
      const near = dC < 175 && !inside; peopleFrame(dt, near, dC); gameFrame(dt); gamePose(); if (PP.rk) PP.rk.set(PP.rk.n - 1, null); if (PP.pd && !GM.on) PP.pd.set(PP.pd.n - 1, null); if (!GM.on && PP.bl && SC.game && SC.game.ball && !SC.game.ball.on) { PP.bl.set(PP.bl.n - 1, null); PP.sh.set(PP.sh.n - 1, null); } for (const Bt of [PP.rk, PP.pd, PP.bl, PP.sh]) if (Bt) Bt.write();
      if ((FRAME_N % 15) === 7) stampFrame(); } catch (e) { err("frame", e); } const ms = performance.now() - t0; FT.n++; FT.sum += ms; FT.ema += (ms - FT.ema) * 0.02; if (ms > FT.max) FT.max = ms; }
  // the camera inside the clubhouse: kept inside the walls and under the ceiling, first person when tight (as the body shop)
  const FR = SC.fr = { inCam: false, fp: undefined };
  function clubCam(dt) { if (!SC.ready || window.__cam) return false; try { const px = player.position.x, py = player.position.y, pz = player.position.z; if (!inClub(px, py + 1, pz)) { if (FR.inCam) { FR.inCam = false; FR.fp = undefined; try { player.userData.walk.visible = true; } catch (e) {} } return false; }
      FR.inCam = true; const fwd = [-Math.sin(yaw), -Math.cos(yaw)], by = typeof bobY === "number" ? bobY : 0, cy0 = py - by + 1.75, maxD = 5.0; let dist = 0;
      for (let d = 0.2; d <= maxD; d += 0.2) { const cx = px - fwd[0] * d, cz = pz - fwd[1] * d; if (!inClub(cx, cy0 + d * 0.12, cz)) break; dist = d; }
      if (FR.fp === undefined) FR.fp = dist < 1.3; else if (FR.fp && dist > 2.1) FR.fp = false; else if (!FR.fp && dist < 1.1) FR.fp = true;
      CAM.dist += (dist - CAM.dist) * smoothK(dt, 10); const sd = Math.min(dist, CAM.dist);
      if (FR.fp) { camera.position.set(px, py - by + 1.62, pz); CAM.init = false; camera.lookAt(px + fwd[0] * 10, camera.position.y - pitch * 6, pz + fwd[1] * 10); player.userData.walk.visible = false; }
      else { const cy = Math.min(L.F + (inLobby(px) ? 4.85 : 3.55), cy0 + pitch * 1.2 + sd * 0.12); camera.position.lerp(camTarget.set(px - fwd[0] * sd, cy, pz - fwd[1] * sd), smoothK(dt, 24)); camLook(px, py + 1.3, pz, dt, 30); player.userData.walk.visible = true; }
      return true; } catch (e) { err("cam", e); return false; } }
  function camHook(dt) { try { if (typeof VRX !== "undefined" && VRX && VRX.on) return false; } catch (e) {} try { if (gameCam(dt)) return true; } catch (e) { err("gamecam", e); } return clubCam(dt); }   // never in VR: the headset owns the camera
  // ───────────── client overrides (by bare name, at run time) ─────────────
  function installOverrides() { if (SC.ov) return; SC.ov = true;
    try { const o = openNearest; openNearest = function () { try { if (GM.on) { gameKey(); return; } if (SC.ready && !busy() && nearMachine()) { startGame(); return; } if (SC.ready && !busy() && player) for (const q of SC.order || []) if (hyp(player.position.x - q.x, player.position.z - q.z) < q.r) { try { closeCards(); } catch (e) {} openShop(q.shop); return; } } catch (e) { err("open", e); } return o.apply(this, arguments); }; } catch (e) { err("ov open", e); }
    try { const os = openShop; openShop = function (kind) { const r = os.apply(this, arguments); try { if (kind === "sc_cafe") award("p_sc_cafe"); } catch (e) {} return r; }; } catch (e) { err("ov shop", e); }
    try { const st = showTalk; showTalk = function (c, idx) { const r = st.apply(this, arguments); try { if (c && c.id === "sc_coach") award("p_sc_coach"); } catch (e) {} return r; }; } catch (e) { err("ov talk", e); } }
  // ───────────── API, debug, hooks ─────────────
  SC.api = { inFoot, inClub, award, startGame, endGame, layout: () => L };
  SC.debug = { cam: (px, py, pz, tx, ty, tz, fov) => { window.__cam = [px, L.pad + py, pz, tx, L.pad + ty, tz, fov || 0]; try { updateCulling(true); } catch (e) {} return window.__cam; },
    at: (x, z, yw) => { player.position.set(x, planGroundAt(x, z), z); if (yw !== undefined) yaw = yw; return [x, z]; },
    counts: () => { const o = {}; for (const g of SC.groups || []) { let m = 0, tr = 0; g.traverse((x) => { if (x.isMesh) { m++; const gi = x.geometry; tr += (gi.index ? gi.index.count : gi.attributes.position.count) / 3; } }); o[g.name] = { meshes: m, tris: Math.round(tr) }; } o.solids = SOL.length; o.seats = SEATS.length; o.people = PP.list.length; o.mats = Object.keys(MT).length; return o; },
    hide: (on) => dbgHide(on), rally: () => PP.courts.map((c) => ({ st: c.st, rally: c.rally, ball: c.ball.p.toArray().map((v) => +v.toFixed(2)), on: c.ball.on })), game: () => ({ on: GM.on, n: GM.n, score: GM.score, hits: GM.hits, phase: GM.phase }), press: () => gameKey(), night: () => SC.night, frameMs: () => ({ avg: +(FT.sum / Math.max(1, FT.n)).toFixed(3), ema: +FT.ema.toFixed(3), max: +FT.max.toFixed(2), n: FT.n }), resetFt: () => { FT.n = 0; FT.sum = 0; FT.max = 0; return 1; } };
  (function hookAll() { const set = (phase, name, fn, first) => { const list = HK[phase]; for (let i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } if (first) list.unshift({ name, fn }); else list.push({ name, fn }); };
    set("world", "scKeepout", () => keepEarly(), true);   // the first world hook: the footprint is a keep-out before any module plants
    set("world", "scWorld", () => worldHook()); set("terrain", "scTerrain", () => terrainHook()); set("defer", "scDefer", () => deferHook()); set("frame", "scFrame", (dt, now) => frameHook(dt, now)); set("interior", "scCam", (dt) => camHook(dt)); })();
})();
