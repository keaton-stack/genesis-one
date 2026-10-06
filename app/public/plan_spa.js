// R17 (5 Oct 2026): ATARDECER, the spa at Sunset Bluff (Agent Y). A desert-modern sanctuary on the bluff above the runway.
//   Site: S3_SUNSET "Sunset Bluff", the block between Hangar Road, Mesa Loop and Bluff Loop. Local frame (u, v) on the street grid:
//   u along Mesa Loop (east-south-east), v along Hangar Road and the runway (south-south-west), origin (431, 331), y up from the pad G.
//   The sunset (in game, low in the north-north-west at 17:40) and the runway lie toward -u / -v, so the lounge, its terrace and the
//   rooftop deck sit at the -u end and look that way.
//   - Architecture: rammed earth walls in tamped lifts, charred cedar fascias and doors, cedar slat soffits and screens, deep flat
//     roofs, travertine floors, a stacked stone hearth and chimney, bronze.
//   - Arrival court on Mesa Loop (golf carts under a slatted pergola, a big olive in a rammed earth ring, the monument sign), the
//     reception pavilion, the Olive Court (eight olives, a 28 m reflecting runnel fed by a basalt water wall, cloisters), four
//     treatment rooms with private gardens, the bath house (steam room, cedar sauna, rain walk, changing room), the walled Soaking
//     Garden (five small round mineral tubs, two pergolas, palo verde), the Hearth Lounge (fire, daybeds facing the glass, a tea
//     bar), the Sunset Terrace (fire bowl, loungers) and the rooftop stargazing deck (loungers, telescopes) up an outdoor stair.
//   - People: three staff with talk cards (host, bath attendant, therapist), a few roaming guests (PLAN_ROAM). Interactions: lie on
//     any lounger or daybed (a real recline pose, not the sit pose), take a treatment (a fade, a short ritual, a stamp), soak in a
//     tub, sit by either fire, stargaze. Stamps 384 to 388 through PLAN_PROGRESS.award.
//   - Night: warm emissive fixtures (lanterns, step lights, candles, pendants, uplights, the hearth) and a few lamps registered as
//     sources of the client's fixed light pool. No new real lights. Gentle ambience (water, distant chimes) through the client's
//     audio context while you are near.
// Classic script, loaded before plan_fill_a.js and client.js: the world hook registers the keep-out first (plan_land, fill A and
// fill B queue their passes later and stay out), the terrain hook grades the pad, clears the scatter and places the engine kinds,
// the defer hook builds everything (merged per material: a shell group and a detail group), the frame hook runs the night levels,
// water, steam, poses, the treatment and the stamps. ?spa=0 turns the module off. window.PLAN_SPA: n, t, errs, site, api, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var SP = window.PLAN_SPA = window.PLAN_SPA || {};
  SP.v = "r17y-1"; SP.errs = SP.errs || []; SP.n = SP.n || {}; SP.t = SP.t || {};
  if (/[?&]spa=0\b/.test(location.search)) { SP.off = true; return; }
  var Q = location.search, PI = Math.PI, TAU = PI * 2;
  function note(tag, e) { try { if (SP.errs.length < 50) SP.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (SP.errs.length <= 6) console.warn("plan_spa " + tag, e); } catch (x) {} }
  function cnt(k, v) { SP.n[k] = (SP.n[k] || 0) + (v === undefined ? 1 : v); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function nowMs() { return performance.now(); }
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function has(k) { try { return !!(MODELS[k] && MODEL_SPECS[k]); } catch (e) { return false; } }
  function lowTier() { try { return ASSET.tier === "m"; } catch (e) { return false; } }
  function qual() { try { return localStorage.getItem("g1:quality") || "high"; } catch (e) { return "high"; } }
  function hiTier() { var q = qual(); return q === "high" || q === "ultra"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function au(u) { try { if (window.AV) return window.AV(u); } catch (e) {} return u; }
  function $id(id) { return document.getElementById(id); }
  function V3(x, y, z) { return new THREE.Vector3(x, y, z); }

  // ───────────────────────── config: plan/spa.json (names, copy, people, stamps); the built-in values are the fallback ─────────────────────────
  var CFG = SP.cfg || null;
  function cfgUrl() { return au("/plan/spa.json?v=" + (window.BUILD || "dev")); }
  if (!CFG) { try { fetch(cfgUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && !CFG) CFG = SP.cfg = d; }).catch(function (e) { note("cfg fetch", e); }); } catch (e) { note("cfg", e); } }
  function cfg() { if (CFG) return CFG; try { var x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = SP.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); } return CFG || {}; }
  function C(path, dflt) { var o = cfg(); var p = path.split("."); for (var i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }

  // ───────────────────────── the site frame ─────────────────────────
  // u along Mesa Loop (0.7565, 0.6540), v along Hangar Road (-0.6540, 0.7565); world = O + u * U + v * V. A group turned by YAW maps
  // local (x, z) the same way (three's rotation.y), so everything is built in local coordinates inside one group.
  var S = SP.site = SP.site || null;
  function site() {
    if (S) return S; var s = C("site", {}) || {};
    var o = s.origin || [431, 331], yaw = typeof s.yaw === "number" ? s.yaw : -0.7129;
    S = SP.site = { ox: o[0], oz: o[1], yaw: yaw, c: Math.cos(yaw), s: Math.sin(yaw), G: typeof s.pad === "number" ? s.pad : 21.6,
      // the lot (local): the keep-out and the pad
      lot: s.lot || [-53.6, 34, -35.5, 43], pad: s.padRect || [-50.5, 33.5, -34.6, 42.4], blend: s.blend || 10,
      hub: s.hub || [19, -27] };
    return S; }
  function l2w(u, v) { return [S.ox + u * S.c + v * S.s, S.oz - u * S.s + v * S.c]; }
  function w2l(x, z) { var dx = x - S.ox, dz = z - S.oz; return [dx * S.c - dz * S.s, dx * S.s + dz * S.c]; }
  function wyaw(psi) { return psi + S.yaw; }   // a local facing angle (0 = +v) to a world rotation.y
  function inRect(u, v, r, m) { m = m || 0; return u > r[0] - m && u < r[1] + m && v > r[2] - m && v < r[3] + m; }
  function rectDist(u, v, r) { var dx = Math.max(r[0] - u, 0, u - r[1]), dz = Math.max(r[2] - v, 0, v - r[3]); return Math.hypot(dx, dz); }
  function inLot(x, z, m) { var q = w2l(x, z); return inRect(q[0], q[1], S.lot, m || 0); }
  function lotDist(x, z) { var q = w2l(x, z); return rectDist(q[0], q[1], S.lot); }
  function lotPoly(r, m) { m = m || 0; return [[r[0] - m, r[2] - m], [r[1] + m, r[2] - m], [r[1] + m, r[3] + m], [r[0] - m, r[3] + m]].map(function (q) { return l2w(q[0], q[1]); }); }

  // ───────────────────────── world hook: the keep-out (first, so plan_land and the fill modules plant round us), the hub, the zone, info cards ─────────────────────────
  var VEG = /^(bush\d|mesquite|ocotillo|saguaro.*|paloverde|ironwood|desertwillow|barrel_cactus|prickly_pear|cholla|organ_pipe|agave_cluster|yucca_cluster|boulder|ph_(rock|boulder|shrub|succulent|stones|sandrocks|quiver)_?\d*|e1_(fanpalm2?|datepalm|canarypalm)|fanpalm2?|datepalm|land_(rock|rrock|sag|cholla|barrel|pear|organ).*|fa_agave\d)$/;
  function keepout() {
    if (SP.kept) return; SP.kept = true;
    try { planKeepout(lotPoly(S.lot, 0)); cnt("keepPoly"); } catch (e) { note("keepout", e); }
    // circles too (the client's own scatter and plan_land's rasters read KEEPOUT), on a 9 m lattice over the lot
    try { for (var u = S.lot[0] + 4; u <= S.lot[1] - 3; u += 9) for (var v = S.lot[2] + 4; v <= S.lot[3] - 3; v += 9) { var w = l2w(u, v); KEEPOUT.push([w[0], w[1], 6.4]); cnt("keepCircles"); } } catch (e) { note("keep circles", e); }
  }
  function worldHook() {
    if (SP.off || !window.PLAN) return; site(); var t0 = nowMs();
    keepout();
    try { var hub = l2w(S.hub[0], S.hub[1]); planAddHub(C("names.hub", "Atardecer Spa"), hub[0], hub[1]); planNavCats(); } catch (e) { note("hub", e); }
    try { var poly = lotPoly(S.lot, -0.5); var cc = l2w((S.lot[0] + S.lot[1]) / 2, (S.lot[2] + S.lot[3]) / 2); zoneRings.push({ name: C("names.spa", "Atardecer, the spa at Sunset Bluff"), label: C("names.short", "Atardecer Spa"), center: cc, r: 58, k: C("info.arrival.k", "The spa at Sunset Bluff"), poly: poly, col: "#c98a5a55", plan: "spa" }); } catch (e) { note("zone", e); }
    try { infoSpots(); } catch (e) { note("info", e); }
    try { installOverrides(); } catch (e) { note("overrides", e); }
    SP.t.world = Math.round(nowMs() - t0); }
  function infoSpots() {
    var hs = function (key, u, v, r) { var d = C("info." + key, null); if (!d) return; var w = l2w(u, v); var h = { x: w[0], z: w[1], r: r, t: d.t, k: d.k, p: d.p, spa: key }; hotspots.push(h); (SP.hs = SP.hs || []).push(h); };
    hs("arrival", 12, -27, 7); hs("court", -8, -4.2, 5); hs("waterwall", 0, 3.0, 3.2); hs("lounge", -35, 1.5, 4); hs("terrace", -46, -4, 3.5); hs("bath", -16, 13.5, 3.5);
    hs("garden", -7, 30, 5); hs("treatment", -10, -10.6, 3); hs("roof", -36, -2, 4); hs("reception", 11, -9, 3.5); }

  // ───────────────────────── terrain hook: the pad (roads and neighbours protected), the lot cleared, the engine kinds, the paths in ─────────────────────────
  function gridRoads() { var out = []; try { for (var i = 0; i < ROADS.length; i++) { var r = ROADS[i]; if (!r || !r.pts || r.pts.length < 2 || !(r.w >= 4.5) || r.spa) continue; for (var k = 0; k < r.pts.length - 1; k++) { var a = r.pts[k], b = r.pts[k + 1]; var mx = Math.min(a[0], b[0]) - 40, Mx = Math.max(a[0], b[0]) + 40, mz = Math.min(a[1], b[1]) - 40, Mz = Math.max(a[1], b[1]) + 40; var c0 = l2w((S.lot[0] + S.lot[1]) / 2, (S.lot[2] + S.lot[3]) / 2); if (c0[0] < mx - 80 || c0[0] > Mx + 80 || c0[1] < mz - 80 || c0[1] > Mz + 80) continue; out.push([a[0], a[1], b[0], b[1], r.w / 2]); } } } catch (e) { note("roads", e); } return out; }
  function segD(x, z, ax, az, bx, bz) { var vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1, t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1); return Math.hypot(x - ax - vx * t, z - az - vz * t); }
  function nearBuildings() { var out = []; try { var c0 = l2w(0, 0); (window.PLAN.buildings || []).forEach(function (b) { if (!b.footprint || Math.hypot(b.x - c0[0], b.z - c0[1]) > 140) return; out.push([b.x, b.z, 0.5 * Math.hypot(b.footprint[0], b.footprint[1]) + 1.5]); }); } catch (e) { note("blds", e); } return out; }
  function protectK(x, z, RD, BL) { var k = 1; for (var i = 0; i < RD.length; i++) { var r = RD[i], d = segD(x, z, r[0], r[1], r[2], r[3]); if (d < r[4] + 8) k = Math.min(k, sstep(r[4] + 0.6, r[4] + 4.2, d)); } for (var j = 0; j < BL.length; j++) { var b = BL[j], db = Math.hypot(x - b[0], z - b[1]); if (db < b[2] + 6) k = Math.min(k, sstep(b[2], b[2] + 5, db)); } return k; }
  function terrainHook() {
    if (SP.off || !window.PLAN) return; site(); var t0 = nowMs(); keepout();
    try { if (typeof H !== "undefined" && H && T) { var cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1), RD = gridRoads(), BL = nearBuildings(), n = 0;
        var P = lotPoly(S.pad, S.blend + 2), x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; P.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); });
        for (var r = Math.max(0, Math.floor((z0 - T.zmin) / ch)); r <= Math.min(T.rows - 1, Math.ceil((z1 - T.zmin) / ch)); r++) for (var c = Math.max(0, Math.floor((x0 - T.xmin) / cw)); c <= Math.min(T.cols - 1, Math.ceil((x1 - T.xmin) / cw)); c++) {
          var x = T.xmin + c * cw, z = T.zmin + r * ch, q = w2l(x, z), d = rectDist(q[0], q[1], S.pad); if (d >= S.blend) continue;
          var k = d <= 0 ? 1 : 1 - sstep(0, S.blend, d); k *= protectK(x, z, RD, BL); if (k <= 0.001) continue; var vi = r * T.cols + c; H[vi] = H[vi] + (S.G - H[vi]) * k; n++; }
        SP.n.graded = n; } } catch (e) { note("grade", e); }
    // whatever stands in the lot already (the engine's early scatter, earlier modules' plants and rocks) goes; the rest is reseated
    try { var removed = 0, keys = new Set(); for (var kk in PLACE) { if (!VEG.test(kk)) continue; var L = PLACE[kk], keep = []; for (var i = 0; i < L.length; i++) { var e = L[i]; if (!e.spa && inLot(e[0], e[2], 1.5)) { keys.add(Math.round(e[0] * 100) + ":" + Math.round(e[2] * 100)); removed++; } else keep.push(e); } if (keep.length !== L.length) { L.length = 0; Array.prototype.push.apply(L, keep); } }
      if (keys.size) for (var j = COLLIDERS.length - 1; j >= 0; j--) { var cl = COLLIDERS[j]; if (keys.has(Math.round(cl[0] * 100) + ":" + Math.round(cl[1] * 100))) COLLIDERS.splice(j, 1); }
      SP.n.cleared = removed; } catch (e) { note("clear", e); }
    try { var rs = 0; for (var k2 in PLACE) { var L2 = PLACE[k2]; for (var i2 = 0; i2 < L2.length; i2++) { var e2 = L2[i2]; if (lotDist(e2[0], e2[2]) > S.blend + 4) continue; var g = getH(e2[0], e2[2]); if (Math.abs(g - e2[1]) > 0.02 && Math.abs(g - e2[1]) < 6) { e2[1] = g; rs++; } } } SP.n.reseated = rs; } catch (e) { note("reseat", e); }
    try { plant(); } catch (e) { note("plant", e); }
    try { paths(); } catch (e) { note("paths", e); }
    SP.t.terrain = Math.round(nowMs() - t0); }
  // engine kinds (instanced, LOD'd and seated by the engine): palo verde, mesquite, the desert understory, boulders, the golf carts
  function plant() {
    var R = rng(1717), n = 0;
    var put1 = function (k, u, v, sc, rot) { if (!has(k)) return null; var w = l2w(u, v); put(k, w[0], w[2] === undefined ? w[1] : w[1], rot === undefined ? R() * TAU : rot, sc); var L = PLACE[k]; var e = L && L[L.length - 1]; if (e) { e.spa = 1; e.keep = true; } n++; return e; };
    var low = ["agave_cluster", "bush2", "barrel_cactus", "bush2", "yucca_cluster", "bush1"].filter(has);
    var lowAt = function (u, v, s) { if (!low.length) return; put1(low[Math.floor(R() * low.length)], u, v, s || (0.55 + R() * 0.35)); };
    // palo verde: the soaking garden, the east garden, the north walk, the south-west garden
    [[-16.5, 25.6, 1.0], [-6.6, 37.4, 0.9], [2.4, 24.7, 0.82], [12.2, 37.4, 1.0], [-26.2, 34.6, 0.85],
      [22.5, -7.5, 1.05], [28.5, 3.5, 1.0], [21.5, 13.5, 0.92], [29.0, 22.0, 1.05], [22.0, 30.5, 0.9], [29.5, 38.0, 1.0],
      [-6.0, -29.8, 0.95], [-21.0, -31.2, 0.9], [-35.0, -28.6, 1.08], [-45.6, -31.4, 0.92],
      [-36.0, 23.0, 1.0], [-45.0, 31.0, 1.05], [-37.5, 38.0, 0.9]].forEach(function (q) { put1("paloverde", q[0], q[1], q[2]); });
    [[-28.5, -31.8, 0.95], [-48.4, -24.0, 0.85], [-44.0, 40.0, 0.9]].forEach(function (q) { put1("mesquite", q[0], q[1], q[2]); });
    // a light screen of trees on the Hangar Road verge (Maker Row behind), open where the terrace and the lounge look at the setting sun
    [[-52.5, -15.0, "desertwillow", 1.0], [-52.5, -8.6, "paloverde", 0.95], [-52.6, -2.4, "desertwillow", 1.05], [-52.6, 12.6, "paloverde", 1.0], [-52.6, 32.0, "desertwillow", 1.0], [-52.4, 42.0, "paloverde", 0.9]].forEach(function (q) { put1(q[2], q[0], q[1], q[3]); });
    // the north walk beds (z -34..-25): grasses, agave and barrels both sides of the walk
    for (var u = -46; u <= 2; u += 2.6) { lowAt(u + R() * 0.8, -32.6 + R() * 0.8); if (u < -20 || u > -2) lowAt(u + 1.2 + R() * 0.6, -26.0 - R() * 0.6); }
    // the east garden: saguaros, ocotillo, the understory
    [[25.5, -2.0, "saguaro_young", 1.0], [31.0, 12.5, "saguaro_mid", 0.95], [19.5, 22.5, "ocotillo", 0.9], [30.5, 29.5, "ocotillo", 1.0], [24.5, 36.0, "saguaro_young", 1.1]].forEach(function (q) { put1(q[2], q[0], q[1], q[3]); });
    for (var i = 0; i < 26; i++) lowAt(19.2 + R() * 13, -10 + R() * 50);
    // the south-west garden and the terrace's ends
    for (var j = 0; j < 14; j++) lowAt(-49 + R() * 18, 14.5 + R() * 25);
    [[-50.0, -16.4], [-46.0, -16.6], [-27.0, 21.0], [-30.5, 21.2]].forEach(function (q) { lowAt(q[0], q[1], 0.7); });
    // the arrival court: agave round the olive ring, beds by the reception, the sign wall
    for (var a = 0; a < 6; a++) { var ang = a / 6 * TAU + 0.3; lowAt(17 + Math.cos(ang) * 2.35, -25.5 + Math.sin(ang) * 2.35, 0.55); }
    [[5.0, -17.0], [5.0, -21.0], [5.2, -25.5], [13.5, -33.9], [4.6, -31.5], [27.0, -14.6], [22.0, -14.6]].forEach(function (q) { lowAt(q[0], q[1], 0.75); });
    // the soaking garden beds along its walls
    for (var b = 0; b < 16; b++) { var bu = -26.5 + b * 2.7; if (bu > 13.5) break; lowAt(bu + R() * 0.5, 38.6 - R() * 0.3, 0.6); }
    [[-26.6, 24.0], [-26.6, 28.4], [13.8, 24.2], [13.6, 31.0], [13.8, 35.5]].forEach(function (q) { lowAt(q[0], q[1], 0.7); });
    // a few boulders (the plan_land / Poly Haven scans)
    [["ph_boulder_2", 31.5, -9.0, 0.9], ["ph_boulder_4", 26.5, 41.0, 0.8], ["ph_boulder_1", -48.5, 26.0, 0.9], ["ph_boulder_5", -9.5, -33.6, 0.7]].forEach(function (q) { put1(q[0], q[1], q[2], q[3]); });
    // golf carts in the shaded bays on the east side of the arrival court, nose in
    var cr = C("carts.rot", 0.857 - PI / 2), cartsN = 0; [-31.4, -28.4, -25.4, -19.4].forEach(function (v) { if (put1("cart", 30.7, v, 1, cr)) cartsN++; }); SP.n.carts = cartsN;
    SP.n.planted = n; }
  // the paths into the network (ROADS ribbons, so the walk grid, the minimap and the R15 edging see them)
  function paths() { if (SP.pathsDone) return; SP.pathsDone = true; var sf = { mat: planMats().dg, lift: 0.14, tile: 3 }; var mk = function (pts, w, id) { var rec = planRibbon(pts.map(function (q) { return l2w(q[0], q[1]); }), w, sf, id); if (rec) { rec.spa = true; cnt("ribbons"); } return rec; };
    mk([[19, -39.4], [19, -34.0]], 6, "spa_drive"); mk([[-50.4, 20], [-56.2, 20]], 2.2, "spa_west"); mk([[24, 42.0], [24, 48.0]], 2.2, "spa_south"); }

  // ───────────────────────── materials: a few shader families with stable keys (vertex colours tint every piece) ─────────────────────────
  //   A  standard + map + normal + roughness + vertex colours + the indoor patch (earth, plaster, charred, cedar, oak, stone, gravel,
  //      ledgestone, basalt, the painting, the signs); on high and ultra plan_bmat's detail layer is chained on the architecture
  //   B  standard + vertex colours + the indoor patch (bronze, steel, linen, cushions, ceramics)
  //   and glass, glow (basic), add (basic additive, soft maps), water (standard + normal map), olive bark and leaves (instanced)
  var MX = SP.mx = SP.mx || null;
  var SPU = SP.u = SP.u || null;   // the indoor patch uniforms (shared by every patched material)
  function makeU() { if (SPU) return SPU; var bx = [], bh = []; for (var i = 0; i < 5; i++) { bx.push(new THREE.Vector4(0, 0, 0, 0)); bh.push(new THREE.Vector4(-99, 0, 0, 0)); }
    SPU = SP.u = { uSpO: { value: new THREE.Vector4(S.ox, S.G, S.oz, 0) }, uSpR: { value: new THREE.Vector4(S.c, S.s, 0, 0) }, uSpB: { value: bx }, uSpH: { value: bh }, uSpK: { value: new THREE.Vector4(0.32, 0.03, 0, 0) } }; return SPU; }
  // inside a room box (local frame) the sky's share of the light drops and a warm house term comes up (most after dark); the walls,
  // floors and ceilings of the rooms read as rooms by day and glow warm at night. One function text, so one program per family.
  var OBC = function (sh) {
    var U = window.PLAN_SPA.u; sh.uniforms.uSpO = U.uSpO; sh.uniforms.uSpR = U.uSpR; sh.uniforms.uSpB = U.uSpB; sh.uniforms.uSpH = U.uSpH; sh.uniforms.uSpK = U.uSpK;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vSpW;").replace("#include <project_vertex>", "#include <project_vertex>\nvSpW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vSpW; uniform vec4 uSpO; uniform vec4 uSpR; uniform vec4 uSpB[5]; uniform vec4 uSpH[5]; uniform vec4 uSpK;")
      .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\n{ vec2 sd = vSpW.xz - uSpO.xz; vec2 sl = vec2(sd.x * uSpR.x - sd.y * uSpR.y, sd.x * uSpR.y + sd.y * uSpR.x); float sIn = 0.0; float sy = vSpW.y - uSpO.y;\n for (int i = 0; i < 5; i++) { vec4 b = uSpB[i]; vec2 q = abs(sl - b.xy) - b.zw; float o = max(q.x, q.y); float k = (1.0 - smoothstep(0.05, 0.45, o)) * (1.0 - smoothstep(uSpH[i].x - 0.02, uSpH[i].x + 0.12, sy)); sIn = max(sIn, k); }\n reflectedLight.indirectDiffuse *= mix(1.0, uSpK.x, sIn); reflectedLight.indirectSpecular *= mix(1.0, uSpK.x * 1.3, sIn); reflectedLight.indirectDiffuse += sIn * uSpK.y * diffuseColor.rgb * vec3(1.0, 0.74, 0.5); }");
  };
  function canvasTex(w, h, draw, srgb) { var cv = document.createElement("canvas"); cv.width = w; cv.height = h; var x = cv.getContext("2d"); draw(x, w, h); var t = new THREE.CanvasTexture(cv); t.colorSpace = srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = 8; t.userData.avShared = true; return t; }
  function dataTex(r, g, b) { var t = new THREE.DataTexture(new Uint8Array([r, g, b, 255, r, g, b, 255, r, g, b, 255, r, g, b, 255]), 2, 2); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; t.userData.avShared = true; return t; }
  var ANISO = 8; function aniso() { try { return Math.min(qual() === "ultra" ? 16 : 8, renderer.capabilities.getMaxAnisotropy()); } catch (e) { return 8; } }
  function texL(url, srgb, cb) { var t = new THREE.TextureLoader().load(au(url), cb || undefined, undefined, function (e) { note("tex " + url, e && e.message ? e : url); }); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO; t.userData.avShared = true; return t; }
  function tn(n, ext) { return "/tex/" + n + (lowTier() ? "_m" : "") + "." + (ext || "jpg"); }
  // the rammed earth albedo: KTX2 2048 (UASTC, a quarter of the memory of the JPEG on the GPU) on desktop, the 1024 JPEG fallback, 512 on low
  function earthMap(m) {
    var lt = lowTier(), k = null; try { k = !lt && typeof ktx2Loader === "function" && !/[?&]spktx=0\b/.test(Q) ? ktx2Loader() : null; } catch (e) { k = null; }
    var jpg = function () { var t = texL(tn("sp_earth"), true); m.map = t; m.needsUpdate = true; SP.n.earthTex = lt ? "jpg512" : "jpg1024"; };
    if (!k) { jpg(); return; }
    m.map = texL("/tex/sp_earth_m.jpg", true);   // placeholder while the KTX2 transcodes (same uv, same program)
    try { k.load(au("/tex/sp_earth.ktx2?v=" + (window.BUILD || "dev")), function (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso(); t.colorSpace = THREE.SRGBColorSpace; t.userData.avShared = true; var old = m.map; m.map = t; m.needsUpdate = true; SP.n.earthTex = "ktx2"; try { if (old) old.dispose(); } catch (e) {} }, undefined, function (e) { note("earth ktx2", e); jpg(); }); } catch (e) { note("earth ktx2", e); jpg(); } }
  function mats() {
    if (MX) return MX; makeU(); ANISO = aniso(); var lt = lowTier();
    var sh = function (m, name, patch) { m.name = name; m.userData.avShared = true; m.userData.spa = true; if (patch !== false) m.onBeforeCompile = OBC; return m; };
    var flatN = dataTex(128, 128, 255), white = dataTex(255, 255, 255);
    var A = function (name, map, nrm, rough, r, ns, extra) { var o = { map: map, normalMap: lt ? flatN : nrm || flatN, roughnessMap: lt ? white : rough || white, roughness: r, metalness: 0, vertexColors: true, color: 0xffffff, normalScale: new THREE.Vector2(ns || 1, ns || 1) }; if (extra) for (var k in extra) o[k] = extra[k]; return sh(new THREE.MeshStandardMaterial(o), name); };
    var B = function (name, r, m) { return sh(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: r, metalness: m || 0, vertexColors: true }), name); };
    var stoneN = texL("/tex/travertine_n.jpg", false), stoneR = texL("/tex/travertine_r.jpg", false);
    var woodN = texL("/tex/wood_n.jpg", false), woodR = texL("/tex/wood_r.jpg", false), rockN = texL("/tex/rock_n.jpg", false), rockR = texL("/tex/rock_r.jpg", false);
    var plasterN = texL("/tex/sp_plaster_n.jpg", false);
    MX = SP.mx = {
      earth: A("sp earth wall", null, texL(lt ? "/tex/sp_earth_n_m.jpg" : "/tex/sp_earth_n.jpg", false), texL(lt ? "/tex/sp_earth_r_m.jpg" : "/tex/sp_earth_r.jpg", false), 1.0, 0.9),
      plaster: A("sp plaster wall", texL(tn("sp_plaster"), true), plasterN, texL("/tex/sp_plaster_r.jpg", false), 1.0, 0.5),
      charred: A("sp charred timber", texL(tn("sp_charred"), true), texL("/tex/sp_charred_n.jpg", false), texL("/tex/sp_charred_r.jpg", false), 1.0, 0.9),
      cedar: A("sp cedar slat wood", texL(lt ? "/tex/ar_fbo_slat_m.jpg" : "/tex/ar_fbo_slat.jpg", true), texL(lt ? "/tex/ar_fbo_slat_n_m.jpg" : "/tex/ar_fbo_slat_n.jpg", false), texL(lt ? "/tex/ar_fbo_slat_r_m.jpg" : "/tex/ar_fbo_slat_r.jpg", false), 1.0, 0.8),
      oak: A("sp oak wood", texL(tn("rh_oak"), true), woodN, woodR, 0.85, 0.35),
      stone: A("sp stone travertine floor", texL("/tex/travertine.jpg", true), stoneN, stoneR, 1.0, 0.6),
      gravel: A("sp gravel ground", texL("/tex/sand2.jpg", true), texL("/tex/sand2_n.jpg", false), texL("/tex/sand2_r.jpg", false), 1.0, 0.9),
      ledge: A("sp ledgestone", texL(tn("rh_stone_s"), true), rockN, rockR, 1.0, 1.0),
      dark: A("sp basalt stone", texL("/tex/terrazzo.jpg", true), texL("/tex/terrazzo_n.jpg", false), texL("/tex/terrazzo_r.jpg", false), 0.75, 0.5),
      painting: A("sp painting canvas", texL(tn("sp_painting"), true), plasterN, null, 0.72, 0.25),
      signs: null,
      metal: B("sp bronze metal", 0.38, 0.85), steel: B("sp dark steel metal", 0.5, 0.7), linen: B("sp linen fabric", 0.95, 0), ceramic: B("sp glazed ceramic", 0.28, 0),
      glass: sh(new THREE.MeshStandardMaterial({ color: 0xa9b8b6, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.2, depthWrite: false, vertexColors: true }), "sp glass pane", false),
      glow: sh(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), "sp glow lamp", false),
      add: null, flame: null, water: null, sheet: null, leaf: null, bark: null, steam: null
    };
    MX.roof = MX.stone; earthMap(MX.earth);
    // the soft pool (light on floors and walls, halos, uplight cones, foam)
    var pool = canvasTex(128, 128, function (x, w, h) { var g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.4, "rgba(255,255,255,0.45)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
    pool.wrapS = pool.wrapT = THREE.ClampToEdgeWrapping;
    MX.add = sh(new THREE.MeshBasicMaterial({ map: pool, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), "sp add glow", false);
    MX.addDay = sh(new THREE.MeshBasicMaterial({ map: pool, vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), "sp add day glow", false);
    // flames: a soft tongue (the hearth, the fire bowl, candles)
    var fl = canvasTex(128, 256, function (x, w, h) { for (var i = 0; i < 3; i++) { var cx = w / 2 + (i - 1) * 18, g = x.createRadialGradient(cx, h * 0.78, 4, cx, h * 0.62, h * 0.55); g.addColorStop(0, "rgba(255,240,200,0.95)"); g.addColorStop(0.25, "rgba(255,170,70,0.75)"); g.addColorStop(0.6, "rgba(220,80,20,0.25)"); g.addColorStop(1, "rgba(120,30,0,0)"); x.fillStyle = g; x.beginPath(); x.moveTo(cx - 34, h); x.bezierCurveTo(cx - 40, h * 0.55, cx - 6, h * 0.35, cx + (i - 1) * 6, h * 0.05); x.bezierCurveTo(cx + 8, h * 0.4, cx + 40, h * 0.55, cx + 34, h); x.closePath(); x.fill(); } });
    fl.wrapS = fl.wrapT = THREE.ClampToEdgeWrapping;
    MX.flame = sh(new THREE.MeshBasicMaterial({ map: fl, vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }), "sp flame", false);
    // water: a tileable ripple normal (the runnel, the trough, the tubs) and the falling sheet (scrolled down)
    var rip = rippleTex(); MX.water = sh(new THREE.MeshStandardMaterial({ color: 0x0e1514, roughness: 0.06, metalness: 0.2, normalMap: rip, normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 0.7 }), "sp water", false); rip.repeat.set(0.7, 0.7);
    var rip2 = rip.clone(); rip2.repeat.set(1.4, 0.32); rip2.needsUpdate = true; rip2.userData.avShared = true;
    MX.sheet = sh(new THREE.MeshStandardMaterial({ color: 0x5b7473, roughness: 0.08, metalness: 0.1, normalMap: rip2, normalScale: new THREE.Vector2(0.75, 0.75) }), "sp water sheet", false);
    var rip3 = rip.clone(); rip3.repeat.set(2.6, 2.6); rip3.needsUpdate = true; rip3.userData.avShared = true; MX.tub = sh(new THREE.MeshStandardMaterial({ color: 0x1c2b27, roughness: 0.07, metalness: 0.15, normalMap: rip3, normalScale: new THREE.Vector2(0.22, 0.22), envMapIntensity: 0.6 }), "sp tub water", false);
    // steam (points, additive)
    var puff = canvasTex(64, 64, function (x, w, h) { var g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,0.55)"); g.addColorStop(0.5, "rgba(255,255,255,0.18)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
    MX.steam = new THREE.PointsMaterial({ map: puff, size: 1.5, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }); MX.steam.userData.avShared = true; MX.steam.name = "sp steam";
    // the olive: silver green leaf cards and grey fissured bark
    MX.leaf = sh(new THREE.MeshStandardMaterial({ map: leafTex(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.62, metalness: 0, vertexColors: true, color: 0xffffff }), "sp olive leaves", false);
    MX.bark = sh(new THREE.MeshStandardMaterial({ map: texL("/tex/wood.jpg", true), normalMap: lt ? null : woodN, roughness: 0.9, metalness: 0, color: 0xb3aca2, normalScale: new THREE.Vector2(1.4, 1.4) }), "sp olive bark", false);
    // the sign sheet: bronze plaques (the name, the rooms), drawn when the fonts are ready
    var SGS = lt ? 512 : 1024; var sg = canvasTex(SGS, SGS, function (x, w, h) { x.save(); x.scale(w / 1024, h / 1024); drawSigns(x, 1024, 1024); x.restore(); }); MX.signTex = sg; MX.signs = A("sp signs bronze", sg, flatN, white, 0.42, 1, { metalness: 0.6 });
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { try { var cx = sg.image.getContext("2d"); cx.save(); cx.scale(SGS / 1024, SGS / 1024); drawSigns(cx, 1024, 1024); cx.restore(); sg.needsUpdate = true; } catch (e) {} }); } catch (e) {}
    // the R16 building detail layer (plan_bmat: mineral micro normal, wood grain, grime at the wall foot, dust on ledges), high and ultra
    try { var BM = window.PLAN_BMAT; if (BM && !BM.off && typeof BM.patchMat === "function" && !/[?&]spbm=0\b/.test(Q)) { var nb = 0; ["earth", "plaster", "charred", "cedar", "oak", "stone", "ledge", "dark"].forEach(function (k) { nb += BM.patchMat(MX[k], {}) || 0; }); SP.n.bmat = nb; } } catch (e) { note("bmat", e); }
    return MX; }
  function rippleTex() { var S2 = 256, c = document.createElement("canvas"); c.width = c.height = S2; var x = c.getContext("2d"), img = x.createImageData(S2, S2), h = new Float32Array(S2 * S2), R = rng(909);
    var waves = []; for (var i = 0; i < 9; i++) waves.push([1 + Math.floor(R() * 5), 1 + Math.floor(R() * 5), R() * TAU, 0.4 + R() * 0.6]);
    for (var y = 0; y < S2; y++) for (var xx = 0; xx < S2; xx++) { var v = 0; for (var w = 0; w < waves.length; w++) { var q = waves[w]; v += Math.sin((xx / S2 * q[0] + y / S2 * q[1]) * TAU + q[2]) * q[3]; } h[y * S2 + xx] = v; }
    for (var y2 = 0; y2 < S2; y2++) for (var x2 = 0; x2 < S2; x2++) { var i0 = y2 * S2 + x2, gx = h[y2 * S2 + (x2 + 1) % S2] - h[y2 * S2 + (x2 + S2 - 1) % S2], gy = h[((y2 + 1) % S2) * S2 + x2] - h[((y2 + S2 - 1) % S2) * S2 + x2]; var nx = -gx * 2.2, ny = -gy * 2.2, nz = 1, l = Math.hypot(nx, ny, nz); img.data[i0 * 4] = (nx / l * 0.5 + 0.5) * 255; img.data[i0 * 4 + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i0 * 4 + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i0 * 4 + 3] = 255; }
    x.putImageData(img, 0, 0); var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.userData.avShared = true; return t; }
  // olive leaves: narrow lanceolate leaves, dark grey-green above, silver below, on a transparent sheet
  function leafTex() { return canvasTex(256, 256, function (x, w, h) { x.clearRect(0, 0, w, h); var R = rng(3131);
    for (var i = 0; i < 95; i++) { var cx = 14 + R() * (w - 28), cy = 14 + R() * (h - 28), a = R() * TAU, L = 30 + R() * 34, W = 5 + R() * 4, silver = R() < 0.42;
      var c0 = silver ? [150 + R() * 30, 160 + R() * 26, 140 + R() * 22] : [70 + R() * 26, 86 + R() * 24, 58 + R() * 18];
      x.save(); x.translate(cx, cy); x.rotate(a); x.fillStyle = "rgb(" + (c0[0] | 0) + "," + (c0[1] | 0) + "," + (c0[2] | 0) + ")"; x.beginPath(); x.moveTo(-L / 2, 0); x.quadraticCurveTo(0, -W, L / 2, 0); x.quadraticCurveTo(0, W, -L / 2, 0); x.fill();
      x.strokeStyle = silver ? "rgba(230,235,220,0.5)" : "rgba(170,180,140,0.35)"; x.lineWidth = 1; x.beginPath(); x.moveTo(-L / 2 + 2, 0); x.lineTo(L / 2 - 2, 0); x.stroke(); x.restore(); } }); }
  // the sign sheet (1024 x 1024, rows of 128): 0 ATARDECER, 1 the line under it, 2 HEARTH LOUNGE, 3 BATH HOUSE, 4 SOAKING GARDEN,
  // 5 room plaques (1 2 3 4 STEAM SAUNA RAIN), 6 THE ROOF, 7 a quiet line
  var FONT = { d: "Fraunces, Georgia, serif", s: "'Space Grotesk', system-ui, sans-serif", m: "'JetBrains Mono', ui-monospace, monospace", a: "Anton, Impact, sans-serif" };
  function drawSigns(x, W, H) {
    var bg = function (y, h) { var g = x.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, "#4a3a2b"); g.addColorStop(1, "#34291f"); x.fillStyle = g; x.fillRect(0, y, W, h); for (var i = 0; i < 400; i++) { x.fillStyle = "rgba(90,120,100," + (Math.random() * 0.06) + ")"; x.fillRect(Math.random() * W, y + Math.random() * h, 2 + Math.random() * 6, 1 + Math.random() * 3); } x.strokeStyle = "#a9814f"; x.lineWidth = 3; x.strokeRect(6, y + 6, W - 12, h - 12); };
    var txt = function (t, y, size, font, col, spacing) { x.save(); x.fillStyle = col || "#ecd09c"; var fp = String(font).split(" "), fam = fp.slice(1).join(" "); x.font = /^[0-9]+$|^italic$/.test(fp[0]) && fam ? (fp[0] === "italic" ? "italic " + fp[1] + " " + size + "px " + fp.slice(2).join(" ") : fp[0] + " " + size + "px " + fam) : size + "px " + font; x.textAlign = "center"; x.textBaseline = "middle"; try { x.letterSpacing = (spacing || 0) + "px"; } catch (e) {} x.shadowColor = "rgba(0,0,0,0.45)"; x.shadowOffsetY = 2; x.shadowBlur = 2; x.fillText(t, W / 2, y, W - 60); x.restore(); };
    var row = function (i, t, size, font, spacing, sub) { var y = i * 128; bg(y, 128); txt(t, y + (sub ? 54 : 66), size, font, null, spacing); if (sub) txt(sub, y + 104, 24, "500 " + FONT.m, "#d4b083", 4); };
    row(0, C("names.sign", "ATARDECER"), 92, "300 " + FONT.d, 18);
    row(1, C("names.signSub", "THE SPA AT SUNSET BLUFF"), 56, "400 " + FONT.s, 10, C("names.signLine", "GENESIS  ·  SUNSET BLUFF"));
    row(2, C("names.lounge", "HEARTH LOUNGE"), 70, "400 " + FONT.s, 12);
    row(3, C("names.bath", "BATH HOUSE"), 70, "400 " + FONT.s, 12);
    row(4, C("names.garden", "SOAKING GARDEN"), 70, "400 " + FONT.s, 12);
    var y5 = 5 * 128; bg(y5, 128); ["I", "II", "III", "IV", "STEAM", "SAUNA", "RAIN"].forEach(function (t, i) { x.save(); x.fillStyle = "#e2bd85"; x.font = (i < 4 ? "400 64px " + FONT.d : "500 30px " + FONT.s); x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(t, (i + 0.5) * W / 7, y5 + 66); x.restore(); });
    row(6, C("names.roof", "THE ROOF"), 70, "400 " + FONT.s, 12, C("names.roofSub", "SUNSET AND STARS"));
    row(7, C("names.quiet", "PLEASE SPEAK SOFTLY"), 46, "italic 300 " + FONT.d, 4);
  }
  function signUV(row, a, b) { var v0 = 1 - (row + 1) / 8, v1 = 1 - row / 8; return [a === undefined ? 0 : a, v0, b === undefined ? 1 : b, v1]; }

  // ───────────────────────── the geometry kit: pieces collected per material in local coordinates, mapped at world scale, merged once ─────────────────────────
  var TILE = { roof: 4.0, earth: 2.4, plaster: 1.8, charred: 1.6, cedar: 1.25, oak: 1.8, stone: 2.4, gravel: 3.2, ledge: 1.5, dark: 1.4, metal: 1, steel: 1, linen: 1, ceramic: 1, glass: 1, glow: 1, add: 1, addDay: 1, flame: 1, water: 1, sheet: 1, tub: 1, signs: 1, painting: 1 };
  var _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1);
  var _cc = {};
  function rgb(c) { if (Array.isArray(c)) return c; var k = String(c); if (_cc[k]) return _cc[k]; var q = new THREE.Color(c); return (_cc[k] = [q.r, q.g, q.b]); }
  function Kit(name) { this.name = name; this.m = {}; this.tris = 0; }
  // uv: "box" (world scale by face normal: walls get v from the height, so the earth's lifts run level across every wall), "keep", "cylT"
  Kit.prototype.add = function (mat, g, col, m4, uv) {
    if (g.index) g = g.toNonIndexed(); if (m4) g.applyMatrix4(m4); if (!g.attributes.normal) g.computeVertexNormals();
    var n = g.attributes.position.count; if (!g.attributes.uv) { g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2)); if (!uv) uv = "box"; }
    var mode = uv || "box", t = TILE[mat] || 1;
    if (mode === "box" && t !== 1 || mode === "boxF") { var P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      for (var f = 0; f < n; f += 3) { var nx = 0, ny = 0, nz = 0; for (var k = 0; k < 3; k++) { nx += N.getX(f + k); ny += N.getY(f + k); nz += N.getZ(f + k); } var ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
        for (var j = 0; j < 3; j++) { var i = f + j, x = P.getX(i), y = P.getY(i), z = P.getZ(i); if (ay >= ax && ay >= az) U.setXY(i, x / t, -z / t); else if (ax >= az) U.setXY(i, (nx > 0 ? -z : z) / t, y / t); else U.setXY(i, (nz > 0 ? x : -x) / t, y / t); } } }
    if (!g.attributes.color) { var c = rgb(col === undefined ? 0xffffff : col), ca = new Float32Array(n * 3); for (var q = 0; q < n; q++) { ca[q * 3] = c[0]; ca[q * 3 + 1] = c[1]; ca[q * 3 + 2] = c[2]; } g.setAttribute("color", new THREE.BufferAttribute(ca, 3)); }
    (this.m[mat] || (this.m[mat] = [])).push(g); this.tris += n / 3; return g; };
  Kit.prototype.place = function (mat, g, col, x, y, z, ry, rx, rz, sx, sy, sz, uv) { _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(x || 0, y || 0, z || 0), _q, _v2.set(sx || 1, sy || 1, sz || 1)); return this.add(mat, g, col, _m4, uv); };
  // a box by its centre and size, optionally turned about y
  Kit.prototype.box = function (mat, col, w, h, d, x, y, z, ry, uv) { return this.place(mat, new THREE.BoxGeometry(w, h, d), col, x, y, z, ry, 0, 0, 1, 1, 1, uv); };
  // a box by its extents (local axes)
  Kit.prototype.ext = function (mat, col, x0, x1, y0, y1, z0, z1) { if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return null; return this.box(mat, col, x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); };
  Kit.prototype.cyl = function (mat, col, r0, r1, h, x, y, z, seg, open, rx, rz, ry) { var g = new THREE.CylinderGeometry(r0, r1, h, seg || 14, 1, !!open); cylUV(g, Math.max(r0, r1), h, TILE[mat] || 1); return this.place(mat, g, col, x, y, z, ry || 0, rx || 0, rz || 0, 1, 1, 1, "keep"); };
  Kit.prototype.sph = function (mat, col, r, x, y, z, seg, sx, sy, sz) { return this.place(mat, new THREE.SphereGeometry(r, seg || 10, Math.max(5, (seg || 10) >> 1)), col, x, y, z, 0, 0, 0, sx, sy, sz, "keep"); };
  Kit.prototype.plane = function (mat, col, w, h, x, y, z, ry, rx, uvr) { var g = new THREE.PlaneGeometry(w, h); if (uvr) { var U = g.attributes.uv; for (var i = 0; i < U.count; i++) U.setXY(i, uvr[0] + U.getX(i) * (uvr[2] - uvr[0]), uvr[1] + U.getY(i) * (uvr[3] - uvr[1])); } return this.place(mat, g, col, x, y, z, ry || 0, rx || 0, 0, 1, 1, 1, "keep"); };
  // a flat horizontal quad facing up (pools, rugs, water); uvr maps it into a texture (else world scale)
  Kit.prototype.flat = function (mat, col, w, d, x, y, z, ry, uvr) { var g = new THREE.PlaneGeometry(w, d); g.rotateX(-PI / 2); if (uvr) { var U = g.attributes.uv; for (var i = 0; i < U.count; i++) U.setXY(i, uvr[0] + U.getX(i) * (uvr[2] - uvr[0]), uvr[1] + U.getY(i) * (uvr[3] - uvr[1])); } return this.place(mat, g, col, x, y, z, ry || 0, 0, 0, 1, 1, 1, uvr ? "keep" : "box"); };
  Kit.prototype.disc = function (mat, col, r, x, y, z, seg) { var g = new THREE.CircleGeometry(r, seg || 24); g.rotateX(-PI / 2); return this.place(mat, g, col, x, y, z, 0, 0, 0, 1, 1, 1, mat === "add" || mat === "addDay" ? "keep" : "box"); };
  Kit.prototype.ring = function (mat, col, r0, r1, x, y, z, seg) { var g = new THREE.RingGeometry(r0, r1, seg || 32); g.rotateX(-PI / 2); return this.place(mat, g, col, x, y, z, 0, 0, 0, 1, 1, 1, "box"); };
  Kit.prototype.tube = function (mat, col, A, B, r, seg) { var d = _v3.subVectors(B, A), L = d.length(); if (L < 1e-4) return null; var g = new THREE.CylinderGeometry(r, r, L, seg || 8, 1, true); _q.setFromUnitVectors(_v1.set(0, 1, 0), d.clone().normalize()); _m4.compose(_v2.addVectors(A, B).multiplyScalar(0.5), _q, _s1); return this.add(mat, g, col, _m4, "keep"); };
  // rounded box (cushions, mattresses, the table pads)
  var RBX = {};
  function rbox(w, h, d, r, seg) { var key = [w, h, d, r, seg].join(":"); if (RBX[key]) return RBX[key].clone(); seg = seg || 2; var g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2); var p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3(); var hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
    for (var i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); c.set(clamp(v.x, -hw, hw), clamp(v.y, -hh, hh), clamp(v.z, -hd, hd)); var dd = v.clone().sub(c); if (dd.lengthSq() > 1e-10) { dd.setLength(r); v.copy(c).add(dd); } p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); RBX[key] = g; return g.clone(); }
  Kit.prototype.rbox = function (mat, col, w, h, d, r, x, y, z, ry, rx) { return this.place(mat, rbox(w, h, d, r, 2), col, x, y, z, ry || 0, rx || 0, 0, 1, 1, 1, "box"); };
  function cylUV(g, r, h, t) { var U = g.attributes.uv, P = g.attributes.position; for (var i = 0; i < U.count; i++) { var x = P.getX(i), y = P.getY(i), z = P.getZ(i), a = Math.atan2(z, x); if (Math.abs(y) >= h / 2 - 1e-4 && U.getY(i) !== 0 && U.getY(i) !== 1) { U.setXY(i, x / t, z / t); continue; } U.setXY(i, (a + PI) * r / t, (y + h / 2) / t); } }
  // a ground-following grid (courts, gravel, terrace edges near the blend): every vertex at the ground under it plus a lift
  Kit.prototype.drape = function (mat, col, u0, u1, v0, v1, step, lift, skip) { var nu = Math.max(1, Math.ceil((u1 - u0) / step)), nv = Math.max(1, Math.ceil((v1 - v0) / step)), du = (u1 - u0) / nu, dv = (v1 - v0) / nv, t = TILE[mat] || 1;
    var pos = [], nrm = [], uvs = [], hAt = function (u, v) { var w = l2w(u, v); return groundL(w[0], w[1]) + (typeof lift === "function" ? lift(u, v) : lift); };
    for (var i = 0; i < nu; i++) for (var j = 0; j < nv; j++) { var a0 = u0 + i * du, a1 = a0 + du, b0 = v0 + j * dv, b1 = b0 + dv; if (skip && skip((a0 + a1) / 2, (b0 + b1) / 2)) continue;
      var q = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(function (p) { return [p[0], hAt(p[0], p[1]), p[1]]; });
      [[0, 2, 1], [0, 3, 2]].forEach(function (tr) { tr.forEach(function (ix) { var p = q[ix]; pos.push(p[0], p[1], p[2]); nrm.push(0, 1, 0); uvs.push(p[0] / t, -p[2] / t); }); }); }
    if (!pos.length) return null; var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2)); g.computeVertexNormals(); return this.add(mat, g, col, null, "keep"); };
  Kit.prototype.merge = function () { var out = {}; for (var k in this.m) { var g = mergeAll(this.m[k]); if (g) out[k] = g; } return out; };
  Kit.prototype.build = function (grp, opts) { opts = opts || {}; var M = mats(), out = [], geos = this.merge(); for (var b in geos) { var mt = M[b]; if (!mt) { note("mat", b); continue; } var me = new THREE.Mesh(geos[b], mt); me.name = "sp " + this.name + " " + b; var cast = opts.cast && opts.cast.indexOf(b) >= 0; me.castShadow = !!cast; me.userData.spCast = !!cast; me.receiveShadow = !mt.transparent && b !== "glow"; me.userData.shSet = true; me.userData.spa = true; if (mt.transparent) me.renderOrder = b === "glass" ? 2 : 3; grp.add(me); out.push(me); } this.m = {}; return out; };
  function mergeAll(list) {
    if (!list || !list.length) return null; var n = 0; list.forEach(function (g) { n += g.attributes.position.count; }); if (!n) return null;
    var P = new Float32Array(n * 3), N = new Float32Array(n * 3), Uu = new Float32Array(n * 2), Cc = new Float32Array(n * 3), o = 0;
    list.forEach(function (g) { var c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); Uu.set(g.attributes.uv.array, o * 2); if (g.attributes.color) Cc.set(g.attributes.color.array, o * 3); else Cc.fill(1, o * 3, (o + c) * 3); o += c; g.dispose(); });
    var r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(Uu, 2)); r.setAttribute("color", new THREE.BufferAttribute(Cc, 3)); r.computeBoundingBox(); r.computeBoundingSphere(); r.userData.avShared = true; return r; }
  function groundL(x, z) { try { return getH(x, z) - S.G; } catch (e) { return 0; } }

  // ───────────────────────── solids (collision, seats), in local coordinates ─────────────────────────
  var SOL = SP.sol = SP.sol || [];
  var YB = 0;   // the base of the solids being made (the roof deck furniture sets it)
  function solid(u, v, w, d, y0, y1, ry, opt) { try { if (w < 0.2 && d < 0.2) { w = 0.2; d = 0.2; } var p = l2w(u, v); var sd = addSolid(p[0], p[1], S.yaw + (ry || 0), w, d, S.G + y0 + YB, S.G + y1 + YB, "spa"); if (!sd) return null; if (opt) for (var k in opt) sd[k] = opt[k]; sd.spa = 1; SOL.push(sd); return sd; } catch (e) { note("solid", e); return null; } }
  // a seat: the client's sit (E) puts you on its top facing psi (local; 0 = +v); lie: 1 a lounger, 2 flat (the treatment tables)
  function seat(u, v, w, d, top, psi, opt) { var o = { seat: true, face: wyaw(psi), noStep: true }; if (opt) for (var k in opt) o[k] = opt[k]; return solid(u, v, w, d, top - 0.42, top, psi, o); }
  function wall(u0, u1, v0, v1, h, y0) { return solid((u0 + u1) / 2, (v0 + v1) / 2, u1 - u0, v1 - v0, y0 || -0.3, h, 0); }

  // ───────────────────────── the plan (local metres; y up from the pad) ─────────────────────────
  var PSUN = -0.72;   // the local facing toward the 17:40 sun (west-south-west in the world); spa.json sun.psi overrides
  function psun() { var p = C("sun.psi", null); return typeof p === "number" ? p : PSUN; }
  var L = SP.L = {
    lounge: [-42, -28, -12, 10], loungeH: 4.2, roofT: 4.62, deck: 4.7,
    court: [-27.75, 3.1, -9.9, 9.9], recep: [4, 18, -13, 3.5], recepH: 3.6,
    rooms: [[-27.75, -21.25], [-20.75, -14.25], [-13.75, -7.25], [-6.75, -0.25]], roomV: [-19.25, -12.25], wingH: 3.3,
    bath: { steam: [-27.75, -19.75], sauna: [-19.25, -12.75], rain: [-12.25, -4.75], change: [-4.25, 3.75], v: [12.25, 22.25] },
    tubs: [[-21.5, 28.2], [-12.0, 33.8], [-3.0, 28.0], [6.0, 33.6], [11.5, 26.2]],
    olives: [[-23.5, 5.6, 1.3], [-23.5, -5.6, 1.24], [-18.0, 5.6, 1.18], [-18.0, -5.6, 1.33], [-8.5, 5.6, 1.26], [-8.5, -5.6, 1.2], [-3.0, 5.6, 1.3], [-3.0, -5.6, 1.24],
      [17.0, -25.5, 1.45], [8.2, -18.6, 1.0], [25.2, -31.6, 0.95], [-30.6, -8.6, 0.62, 4.7 + 0.66], [-30.6, 6.8, 0.6, 4.7 + 0.66], [-24.4, -22.1, 0.62], [-17.5, -22.1, 0.58], [-10.5, -22.1, 0.64], [-3.5, -22.1, 0.6], [-29.4, 18.6, 0.8], [-48.9, -14.9, 0.78]],
    stair: { u0: -41.2, n: 29, run: 0.4, v0: -14.9, v1: -13.3 }
  };
  // the rooms (camera and indoor light): [u0, u1, v0, v1, ceiling]
  var ROOMS = SP.rooms = [
    { id: "lounge", r: [-41.75, -28.25, -11.75, 9.75], h: 4.15 }, { id: "reception", r: [4.25, 17.75, -12.75, 3.25], h: 3.55 },
    { id: "t1", r: [-27.75, -21.25, -19.25, -12.25], h: 3.25 }, { id: "t2", r: [-20.75, -14.25, -19.25, -12.25], h: 3.25 }, { id: "t3", r: [-13.75, -7.25, -19.25, -12.25], h: 3.25 }, { id: "t4", r: [-6.75, -0.25, -19.25, -12.25], h: 3.25 },
    { id: "steam", r: [-27.75, -19.75, 12.25, 22.25], h: 2.95 }, { id: "sauna", r: [-19.25, -12.75, 12.25, 22.25], h: 2.65 }, { id: "rain", r: [-12.25, -4.75, 12.25, 22.25], h: 3.15 }, { id: "change", r: [-4.25, 3.75, 12.25, 22.25], h: 3.15 }];
  function roomAt(u, v, y) { for (var i = 0; i < ROOMS.length; i++) { var R0 = ROOMS[i]; if (u > R0.r[0] && u < R0.r[1] && v > R0.r[2] && v < R0.r[3] && y > -1 && y < R0.h + 0.1) return R0; } return null; }

  // ───────────────────────── wall helpers ─────────────────────────
  // a wall along u at v = vc (thickness t), from u0 to u1, height h; openings [a, b, y0, y1]
  function wallU(K, mat, col, u0, u1, vc, t, h, ops, noSol) { ops = (ops || []).slice().sort(function (a, b) { return a[0] - b[0]; }); var cur = u0, v0 = vc - t / 2, v1 = vc + t / 2;
    ops.forEach(function (o) { if (o[0] > cur) { K.ext(mat, col, cur, o[0], 0, h, v0, v1); if (!noSol) wall(cur, o[0], v0, v1, h); } if (o[3] < h) { K.ext(mat, col, o[0], o[1], o[3], h, v0, v1); if (!noSol) wall(o[0], o[1], v0, v1, h, o[3]); } if (o[2] > 0) { K.ext(mat, col, o[0], o[1], 0, o[2], v0, v1); if (!noSol) wall(o[0], o[1], v0, v1, o[2]); } cur = Math.max(cur, o[1]); });
    if (cur < u1) { K.ext(mat, col, cur, u1, 0, h, v0, v1); if (!noSol) wall(cur, u1, v0, v1, h); } }
  function wallV(K, mat, col, v0, v1, uc, t, h, ops, noSol) { ops = (ops || []).slice().sort(function (a, b) { return a[0] - b[0]; }); var cur = v0, u0 = uc - t / 2, u1 = uc + t / 2;
    ops.forEach(function (o) { if (o[0] > cur) { K.ext(mat, col, u0, u1, 0, h, cur, o[0]); if (!noSol) wall(u0, u1, cur, o[0], h); } if (o[3] < h) { K.ext(mat, col, u0, u1, o[3], h, o[0], o[1]); if (!noSol) wall(u0, u1, o[0], o[1], h, o[3]); } if (o[2] > 0) { K.ext(mat, col, u0, u1, 0, o[2], o[0], o[1]); if (!noSol) wall(u0, u1, o[0], o[1], o[2]); } cur = Math.max(cur, o[1]); });
    if (cur < v1) { K.ext(mat, col, u0, u1, 0, h, cur, v1); if (!noSol) wall(u0, u1, cur, v1, h); } }
  // a flat roof: the slab (pale gravel ballast on top), a charred cedar fascia round it and a cedar slat soffit under it
  function roof(K, u0, u1, v0, v1, yb, yt, noSoffit) { K.ext("roof", 0xd2cdc4, u0 + 0.05, u1 - 0.05, yb + 0.02, yt, v0 + 0.05, v1 - 0.05); var f = 0.07;
    K.ext("charred", 0xffffff, u0, u1, yb, yt + 0.06, v0, v0 + f); K.ext("charred", 0xffffff, u0, u1, yb, yt + 0.06, v1 - f, v1); K.ext("charred", 0xffffff, u0, u0 + f, yb, yt + 0.06, v0 + f, v1 - f); K.ext("charred", 0xffffff, u1 - f, u1, yb, yt + 0.06, v0 + f, v1 - f);
    if (!noSoffit) soffit(K, u0 + f, u1 - f, v0 + f, v1 - f, yb - 0.005); }
  // the soffit plane faces down: a flat quad turned over
  function soffit(K, u0, u1, v0, v1, y, col) { var g = new THREE.PlaneGeometry(u1 - u0, v1 - v0); g.rotateX(PI / 2); K.place("cedar", g, col || 0xd9c6b2, (u0 + u1) / 2, y, (v0 + v1) / 2, 0, 0, 0, 1, 1, 1, "box"); }
  function ceiling(K, mat, r, y, col) { var g = new THREE.PlaneGeometry(r[1] - r[0], r[3] - r[2]); g.rotateX(PI / 2); K.place(mat, g, col || 0xffffff, (r[0] + r[1]) / 2, y, (r[2] + r[3]) / 2, 0, 0, 0, 1, 1, 1, "box"); }
  // a piece frame: local (lx, lz) of a piece at (u, v) facing psi
  function PF(u, v, psi) { var c = Math.cos(psi), s = Math.sin(psi); return { u: u, v: v, psi: psi, f: function (lx, lz) { return [u + lx * c + lz * s, v - lx * s + lz * c]; } }; }
  function pbox(K, F, mat, col, w, h, d, lx, y, lz, rx) { var p = F.f(lx, lz); return K.place(mat, new THREE.BoxGeometry(w, h, d), col, p[0], y, p[1], F.psi, rx || 0, 0, 1, 1, 1, "box"); }
  function prbox(K, F, mat, col, w, h, d, r, lx, y, lz, rx) { var p = F.f(lx, lz); return K.place(mat, rbox(w, h, d, r, 2), col, p[0], y, p[1], F.psi, rx || 0, 0, 1, 1, 1, "box"); }
  function pcyl(K, F, mat, col, r0, r1, h, lx, y, lz, seg) { var p = F.f(lx, lz); return K.cyl(mat, col, r0, r1, h, p[0], y, p[1], seg); }
  // a vertical ring wall (tubs, the planter): the outside or the inside face
  function ringWall(K, mat, col, r, y0, y1, cu, cv, seg, inward) { var pos = [], nrm = [], uv = [], t = TILE[mat] || 1; seg = seg || 32;
    for (var i = 0; i < seg; i++) { var a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      var A = [cu + c0 * r, y0, cv + s0 * r], B = [cu + c1 * r, y0, cv + s1 * r], Cc = [cu + c1 * r, y1, cv + s1 * r], D = [cu + c0 * r, y1, cv + s0 * r];
      var tri = inward ? [A, Cc, B, A, D, Cc] : [A, B, Cc, A, Cc, D]; var nn = inward ? -1 : 1;
      tri.forEach(function (p, k) { pos.push(p[0], p[1], p[2]); var a = (p === A || p === D) ? a0 : a1; nrm.push(Math.cos(a) * nn, 0, Math.sin(a) * nn); uv.push(a * r / t, p[1] / t); }); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); return K.add(mat, g, col, null, "keep"); }
  function ringSolids(cu, cv, r, top, n) { for (var i = 0; i < n; i++) { var a = i / n * TAU, w = 2 * r * Math.tan(PI / n) + 0.1; var p = [cu + Math.cos(a) * r, cv + Math.sin(a) * r]; solid(p[0], p[1], w, 0.3, -0.3, top, -a + PI / 2, { noStep: true }); } }

  // ───────────────────────── furniture and fixtures ─────────────────────────
  var SRCS = SP.lights = SP.lights || [];   // sources for the client's light pool: { u, y, v, col, k, d, night, day }
  var GLOWS = SP.glows = SP.glows || [];       // flicker points (flames)
  function lamp(u, y, v, col, k, d, dayK, flick) { SRCS.push({ u: u, y: y, v: v, col: col, k: k * 3, d: d, day: dayK || 0, flick: !!flick }); }
  // a lounger facing local +z: the hips at the seat solid, the legs toward +z, the back reclined behind; lie 1
  function lounger(K, u, v, psi, o) { o = o || {}; var F = PF(u, v, psi), wood = o.wood || "oak", wc = o.wcol || 0xb08a62, cush = o.cush || 0xe9e1d2, W = o.w || 0.72;
    pbox(K, F, wood, wc, W, 0.1, 2.0, 0, 0.25, 0.22); [[-1, -0.7], [1, -0.7], [-1, 1.1], [1, 1.1]].forEach(function (q) { pbox(K, F, wood, wc, 0.07, 0.2, 0.07, q[0] * (W / 2 - 0.05), 0.1, q[1]); });
    prbox(K, F, "linen", cush, W - 0.04, 0.11, 1.26, 0.04, 0, 0.355, 0.62);
    var th = 1.26, bl = 0.82, by = 0.36 + Math.cos(th) * bl / 2, bz = -0.04 - Math.sin(th) * bl / 2; prbox(K, F, "linen", cush, W - 0.04, bl, 0.1, 0.04, 0, by, bz, -th); pbox(K, F, wood, wc, W, bl + 0.06, 0.05, 0, by - 0.04, bz - 0.07, -th);
    prbox(K, F, "linen", o.pillow || 0xc9b79c, W * 0.62, 0.14, 0.26, 0.06, 0, by + Math.cos(th) * 0.32 + 0.06, bz - Math.sin(th) * 0.32 + 0.08, -th + 0.3);
    if (o.towel !== false) prbox(K, F, "linen", 0xf5f2ea, W * 0.7, 0.05, 0.34, 0.02, 0, 0.44, 1.05);
    var p = F.f(0, 0.1); var sd = seat(p[0], p[1], 0.62, 0.6, 0.4, psi, { lie: 1, spaKind: o.kind || "lounger" }); var pc = F.f(0, 0.4); solid(pc[0], pc[1], W, 2.05, -0.3, 0.38, psi, { noStep: true }); return sd; }
  function daybed(K, u, v, psi) { return lounger(K, u, v, psi, { w: 0.92, wood: "oak", wcol: 0x7a5a3e, cush: 0xe6dccb, pillow: 0xb7926a, kind: "daybed" }); }
  // a sofa facing +z (seat depth 0.95), len along x
  function sofa(K, u, v, psi, len, col) { var F = PF(u, v, psi), c = col || 0xd8ccb8; pbox(K, F, "oak", 0x5e4532, len, 0.12, 0.95, 0, 0.06, 0); prbox(K, F, "linen", c, len - 0.1, 0.2, 0.82, 0.06, 0, 0.24, 0.04); prbox(K, F, "linen", c, len, 0.5, 0.22, 0.08, 0, 0.47, -0.37); [-1, 1].forEach(function (s) { prbox(K, F, "linen", c, 0.2, 0.38, 0.95, 0.07, s * (len / 2 - 0.1), 0.31, 0); });
    for (var i = 0; i < Math.round(len / 0.9); i++) prbox(K, F, "linen", i % 2 ? 0xb88f66 : 0x9c6f4c, 0.42, 0.36, 0.13, 0.06, -len / 2 + 0.45 + i * 0.9 + 0.1, 0.52, -0.22, -0.2);
    var p = F.f(0, 0.12); seat(p[0], p[1], len - 0.4, 0.62, 0.44, psi, { spaKind: "sofa" }); var b = F.f(0, -0.37); solid(b[0], b[1], len, 0.24, -0.3, 0.72, psi, { noStep: true }); }
  function chair(K, u, v, psi, col) { var F = PF(u, v, psi), c = col || 0xcfc2ad; pbox(K, F, "oak", 0x6b4d36, 0.78, 0.1, 0.78, 0, 0.12, 0); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { pbox(K, F, "oak", 0x6b4d36, 0.06, 0.12, 0.06, q[0] * 0.33, 0.04, q[1] * 0.33); }); prbox(K, F, "linen", c, 0.72, 0.16, 0.7, 0.05, 0, 0.25, 0.02); prbox(K, F, "linen", c, 0.74, 0.42, 0.16, 0.06, 0, 0.5, -0.32, -0.15); [-1, 1].forEach(function (s) { pbox(K, F, "oak", 0x6b4d36, 0.07, 0.3, 0.74, s * 0.37, 0.32, 0); });
    var p = F.f(0, 0.06); seat(p[0], p[1], 0.58, 0.55, 0.36, psi, { spaKind: "chair" }); }
  function stoneBench(K, u, v, psi, len, opt) { var F = PF(u, v, psi); pbox(K, F, "stone", 0xe8dfd0, len, 0.12, 0.5, 0, 0.39, 0); [-1, 1].forEach(function (s) { pbox(K, F, "dark", 0x6a625a, 0.32, 0.34, 0.42, s * (len / 2 - 0.35), 0.17, 0); }); var p = F.f(0, 0); seat(p[0], p[1], len - 0.2, 0.5, 0.45, psi, Object.assign({ spaKind: "bench" }, opt || {})); }
  function sideTable(K, u, v, h, candle) { K.cyl("dark", 0x7d746a, 0.24, 0.24, 0.04, u, h - 0.02, v, 18); K.cyl("steel", 0x3a3631, 0.03, 0.05, h - 0.04, u, (h - 0.04) / 2, v, 8); solid(u, v, 0.5, 0.5, -0.3, h, 0, { noStep: true }); if (candle) candleAt(K, u, h, v, 0.12); }
  function candleAt(K, u, y, v, hh) { K.cyl("ceramic", 0xf1e8d6, 0.035, 0.035, hh, u, y + hh / 2, v, 10); K.sph("glow", 0xffc07a, 0.018, u, y + hh + 0.022, v, 6, 1, 1.7, 1); K.flat("add", 0xff9a40, 0.26, 0.26, u, y + 0.005, v); GLOWS.push({ u: u, y: y + hh + 0.03 + YB, v: v, s: 0.2 }); }
  function pendant(K, u, y, v, r, h, col) { K.cyl("linen", col || 0xe8dcc6, r, r, h, u, y, v, 20, true); K.disc("glow", 0xffd9a6, r * 0.96, u, y - h / 2 + 0.01, v, 20); K.cyl("steel", 0x222222, 0.006, 0.006, 3.0, u, y + h / 2 + 1.5, v, 4); K.flat("add", 0xffb97a, r * 9, r * 9, u, 0.04, v); }
  function bollard(K, u, v, h) { h = h || 0.62; K.box("metal", 0x6a4a2c, 0.16, h, 0.16, u, h / 2, v); K.box("glow", 0xffcf8a, 0.17, 0.05, 0.17, u, h - 0.12, v); K.flat("add", 0xffb46a, 1.7, 1.7, u, 0.045, v); solid(u, v, 0.18, 0.18, -0.3, h, 0, { noStep: true }); }
  function stoneLantern(K, u, v) { K.box("stone", 0xd9cfbf, 0.36, 0.7, 0.36, u, 0.35, v); K.box("glow", 0xffc27a, 0.3, 0.12, 0.37, u, 0.52, v); K.box("glow", 0xffc27a, 0.37, 0.12, 0.3, u, 0.52, v); K.box("dark", 0x5a5148, 0.44, 0.06, 0.44, u, 0.73, v); K.flat("add", 0xffa860, 3.6, 3.6, u, 0.045, v); solid(u, v, 0.4, 0.4, -0.3, 0.76, 0, { noStep: true }); }
  function uplight(K, u, v, h) { K.disc("glow", 0xffe2b0, 0.08, u, 0.03, v, 10); var g = new THREE.CylinderGeometry(0.62, 0.12, h, 14, 1, true); K.place("add", g, [0.1, 0.068, 0.04], u, h / 2 + 0.05, v, 0, 0, 0, 1, 1, 1, "keep"); }
  function planter(K, u, v, w, d, h, col) { K.ext("earth", col || 0xffffff, u - w / 2, u + w / 2, 0, h, v - d / 2, v + d / 2); K.ext("dark", 0x4a3e33, u - w / 2 + 0.12, u + w / 2 - 0.12, h - 0.02, h + 0.005, v - d / 2 + 0.12, v + d / 2 - 0.12); solid(u, v, w, d, -0.3, h, 0, { noStep: true }); }
  function firePit(K, u, v, r) { var g = new THREE.LatheGeometry([[r * 0.25, 0], [r * 0.55, 0.06], [r * 0.95, 0.32], [r, 0.42], [r * 0.9, 0.44], [r * 0.6, 0.3], [0.001, 0.26]].map(function (q) { return new THREE.Vector2(q[0], q[1]); }), 28); K.place("dark", g, 0x5e554c, u, 0.05, v, 0, 0, 0, 1, 1, 1, "box"); K.cyl("stone", 0xd8cdbd, r * 0.32, r * 0.4, 0.06, u, 0.03, v, 20);
    K.disc("glow", 0xff7a2a, r * 0.55, u, 0.35, v, 18); for (var i = 0; i < 5; i++) { var a = i / 5 * TAU; K.place("dark", new THREE.CylinderGeometry(0.05, 0.06, r * 0.9, 6), 0x2a2420, u + Math.cos(a) * 0.12, 0.38, v + Math.sin(a) * 0.12, a, PI / 2 - 0.2, 0, 1, 1, 1, "keep"); }
    flames(K, u, 0.38, v, 0.62, 0.95, 3); K.flat("add", 0xff8a3a, 6.5, 6.5, u, 0.045, v); GLOWS.push({ u: u, y: 0.9, v: v, s: 1 }); lamp(u, 1.1, v, 0xff9a52, 5.5, 11, 0, true); solid(u, v, r * 2, r * 2, -0.3, 0.48, 0, { noStep: true }); }
  // crossed flame cards (one draw with the hearth's), flickered in the frame hook through the material's opacity
  function flames(K, u, y, v, w, h, n) { for (var i = 0; i < n; i++) { var a = i / n * PI; K.plane("flame", [1, 0.9, 0.75], w, h, u, y + h / 2, v, a, 0); } }
  function telescope(K, u, v, psi) { var F = PF(u, v, psi); [0, 2.1, 4.2].forEach(function (a) { var A = V3(u, 1.18, v), B = V3(u + Math.cos(a) * 0.42, 0.02, v + Math.sin(a) * 0.42); K.tube("steel", 0x2b2724, A, B, 0.018, 6); }); var p0 = F.f(0, -0.25), p1 = F.f(0, 0.55); K.tube("metal", 0xa47a48, V3(p0[0], 1.05, p0[1]), V3(p1[0], 1.55, p1[1]), 0.07, 14); K.tube("steel", 0x1d1b19, V3(p1[0], 1.55, p1[1]), V3(F.f(0, 0.6)[0], 1.58, F.f(0, 0.6)[1]), 0.075, 14); solid(u, v, 0.6, 0.6, -0.3, 1.5, 0, { noStep: true }); }
  function massageTable(K, u, v, psi, i) { var F = PF(u, v, psi); pbox(K, F, "oak", 0x8a6646, 0.74, 0.08, 1.95, 0, 0.7, 0); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { pbox(K, F, "oak", 0x7a5a3e, 0.07, 0.66, 0.07, q[0] * 0.3, 0.33, q[1] * 0.88); }); pbox(K, F, "oak", 0x7a5a3e, 0.6, 0.05, 1.7, 0, 0.18, 0);
    prbox(K, F, "linen", 0xf3efe6, 0.72, 0.1, 1.92, 0.04, 0, 0.79, 0); prbox(K, F, "linen", 0xe2d6c2, 0.7, 0.04, 0.9, 0.015, 0, 0.855, 0.45); prbox(K, F, "linen", 0xd7c3a2, 0.22, 0.14, 0.62, 0.06, 0, 0.9, 0.7, 0); pcyl(K, F, "linen", 0xcbb79a, 0.08, 0.08, 0.6, 0, 0.88, -0.75);
    // folded towels on the lower shelf
    prbox(K, F, "linen", 0xf5f1e8, 0.42, 0.12, 0.3, 0.02, 0, 0.27, -0.3); prbox(K, F, "linen", 0xd9cbb3, 0.42, 0.1, 0.3, 0.02, 0, 0.38, -0.3);
    var p = F.f(0, 0.05); var sd = seat(p[0], p[1], 0.6, 0.6, 0.88, psi, { lie: 2, spaKind: "table", table: i }); var b = F.f(0, 0); solid(b[0], b[1], 0.76, 1.97, -0.3, 0.86, psi, { noStep: true }); return sd; }
  function tub(K, cu, cv, i) { var R0 = 1.18, Ri = 0.96, top = 0.72, wl = 0.6;
    ringWall(K, "stone", 0xe6dccb, R0, 0, top, cu, cv, 40, false); ringWall(K, "dark", 0x6d655c, Ri, wl - 0.02, top, cu, cv, 40, true); K.ring("stone", 0xefe7da, Ri, R0, cu, top, cv, 40);
    K.disc("tub", 0xffffff, Ri, cu, wl, cv, 40); var rg = new THREE.RingGeometry(Ri - 0.12, Ri, 40); rg.rotateX(-PI / 2); K.place("add", rg, [0.36, 0.5, 0.44], cu, wl + 0.004, cv, 0, 0, 0, 1, 1, 1, "keep"); K.flat("add", [0.16, 0.24, 0.21], 1.9, 1.9, cu, wl + 0.006, cv);
    K.cyl("stone", 0xd9cfbf, 2.0, 2.0, 0.04, cu, 0.02, cv, 40); K.box("oak", 0x8a6a4a, 0.9, 0.32, 0.42, cu, 0.16, cv - R0 - 0.26); solid(cu, cv - R0 - 0.26, 0.9, 0.42, -0.3, 0.32, 0, {});
    ringSolids(cu, cv, R0 - 0.05, top, 10);
    [0.6, 2.2, 3.9].forEach(function (a) { var p = [cu + Math.cos(a) * 0.5, cv + Math.sin(a) * 0.5]; seat(p[0], p[1], 0.4, 0.4, 0.36, Math.atan2(cu - p[0], cv - p[1]), { tub: i, spaKind: "tub" }); });
    STEAM.src.push({ u: cu, v: cv, r: 0.8, y: wl + 0.05, n: 7, kind: "tub" }); }
  var STEAM = SP.steam = SP.steam || { src: [] };

  // ───────────────────────── the architecture (shell: walls, roofs, floors, paving, water; detail: furniture, fixtures, small things) ─────────────────────────
  var EW = 0xf4ece2;   // the earth walls' tint (the texture carries the colour)
  function buildShell(K, D) {
    var lg = L.lounge, H = L.loungeH, s = L.stair;
    // ── the Hearth Lounge: rammed earth north and east, glass west and south under deep overhangs ──
    wallU(K, "earth", EW, lg[0] - 0.25, lg[1] + 0.25, lg[2], 0.5, H, []);
    wallV(K, "earth", EW, lg[2] + 0.25, lg[3], lg[1], 0.5, H, [[-3.2, 3.2, 0, 3.4]]);
    // the glass: west (door on the court axis) and south (door at the east end), charred mullions, a head beam and a threshold
    var mull = function (u, v) { K.box("charred", 0xffffff, 0.14, 3.9, 0.16, u, 1.95, v); solid(u, v, 0.16, 0.16, -0.3, 3.9, 0, { noStep: true }); };
    var paneV = function (v0, v1, u) { K.box("glass", 0xffffff, 0.02, 3.86, v1 - v0 - 0.14, u, 1.95, (v0 + v1) / 2, 0); wall(u - 0.04, u + 0.04, v0, v1, 3.9); };
    var paneU = function (u0, u1, v) { K.box("glass", 0xffffff, u1 - u0 - 0.14, 3.86, 0.02, (u0 + u1) / 2, 1.95, v, 0); wall(u0, u1, v - 0.04, v + 0.04, 3.9); };
    var wv = [lg[2] + 0.25, -7.8, -4.0, -1.1, 1.1, 4.4, 7.4, lg[3]]; for (var i = 0; i < wv.length; i++) mull(lg[0], wv[i]); for (var j = 0; j < wv.length - 1; j++) if (!(wv[j] === -1.1)) paneV(wv[j], wv[j + 1], lg[0]);
    K.ext("glass", 0xffffff, lg[0] - 0.36, lg[0] - 0.33, 0.04, 3.86, -1.0, 1.0);   // the west slider, open, parked outside the fixed pane
    var wu = [lg[0], -38.6, -35.2, -31.8, -29.6, lg[1] - 0.25]; for (var k = 1; k < wu.length; k++) mull(wu[k], lg[3]); for (var m = 0; m < wu.length - 1; m++) if (wu[m] !== -31.8) paneU(wu[m], wu[m + 1], lg[3]);
    K.ext("glass", 0xffffff, -31.7, -29.7, 0.04, 3.86, lg[3] + 0.33, lg[3] + 0.36);
    K.ext("charred", 0xffffff, lg[0] - 0.12, lg[0] + 0.12, 3.9, H, lg[2], lg[3] + 0.12); K.ext("charred", 0xffffff, lg[0], lg[1], 3.9, H, lg[3] - 0.12, lg[3] + 0.12);
    K.ext("dark", 0x6b625a, lg[0] - 0.1, lg[0] + 0.1, 0, 0.05, lg[2], lg[3]); K.ext("dark", 0x6b625a, lg[0], lg[1], 0, 0.05, lg[3] - 0.1, lg[3] + 0.1);
    // floor, ceiling, beams, the roof with its west and south overhangs, the rooftop deck
    K.ext("stone", 0xf2ebe0, lg[0], lg[1] - 0.25, 0, 0.03, lg[2] + 0.25, lg[3]);
    ceiling(K, "oak", [lg[0], lg[1] - 0.25, lg[2] + 0.25, lg[3]], H - 0.02, 0xf2e9dc);
    for (var bu = -40.1; bu < -28.5; bu += 2.6) K.ext("charred", 0xffffff, bu - 0.11, bu + 0.11, H - 0.32, H - 0.02, lg[2] + 0.25, lg[3]);
    roof(K, -45.6, -27.5, -12.6, 13.0, H, L.roofT, true); soffit(K, -45.5, lg[0] - 0.12, -12.5, 12.9, H - 0.005); soffit(K, lg[0] - 0.12, -27.6, lg[3] + 0.12, 12.9, H - 0.005);
    K.ext("oak", 0x9a7656, -45.0, -27.9, L.roofT, L.deck, -11.3, 12.5);
    // the chimney: an earth mass from the ground through the roof, a steel cap
    K.ext("earth", EW, -36.8, -33.2, 0, 6.5, -13.0, -12.25); K.ext("earth", EW, -36.8, -33.2, H, 6.5, -12.25, -11.4); K.ext("steel", 0x2a2826, -36.95, -33.05, 6.5, 6.58, -13.15, -11.25); wall(-36.8, -33.2, -13.0, -11.4, 6.5);
    // the stair to the roof along the north wall, rising east between two earth walls, and its landing over the roof's corner
    for (var t = 0; t < s.n; t++) { var u0 = s.u0 + t * s.run, top = (t + 1) * L.deck / s.n; K.ext("charred", 0xffffff, u0, u0 + s.run + 0.02, top - 0.07, top, s.v0, s.v1); K.ext("steel", 0x2b2826, u0, u0 + s.run, top - 0.24, top - 0.07, s.v0 + 0.05, s.v0 + 0.12); K.ext("steel", 0x2b2826, u0, u0 + s.run, top - 0.24, top - 0.07, s.v1 - 0.12, s.v1 - 0.05); solid(u0 + s.run / 2, (s.v0 + s.v1) / 2, s.run + 0.02, s.v1 - s.v0, top - 0.5, top, 0, { stair: 1 }); }
    for (var q = 0; q < s.n; q += 3) { var ua = s.u0 + q * s.run, ub = Math.min(s.u0 + (q + 3) * s.run, s.u0 + s.n * s.run), yt = (q + 3) * L.deck / s.n + 1.0; K.ext("earth", EW, ua, ub, 0, Math.min(yt, L.deck + 1.05), s.v0 - 0.3, s.v0); K.ext("earth", EW, ua, ub, 0, Math.min(yt, L.deck + 1.05), s.v1, s.v1 + 0.28); wall(ua, ub, s.v0 - 0.3, s.v0, Math.min(yt, L.deck + 1.05)); wall(ua, ub, s.v1, s.v1 + 0.28, Math.min(yt, L.deck + 1.05)); }
    var lu0 = s.u0 + s.n * s.run; K.ext("oak", 0x9a7656, lu0, -27.6, L.deck - 0.08, L.deck, -15.2, -11.3); K.ext("charred", 0xffffff, lu0, -27.6, L.roofT - 0.4, L.deck - 0.08, -15.3, -15.1); solid((lu0 - 27.6) / 2, -13.25, -27.6 - lu0, 3.9, L.deck - 0.5, L.deck, 0, { stair: 1 });
    K.ext("earth", EW, -28.6, -27.75, 0, L.deck - 0.08, -15.2, -14.4); wall(-28.6, -27.75, -15.2, -14.4, L.deck - 0.08);
    solid(-36.45, 0.6, 17.1, 23.8, L.roofT - 0.5, L.deck, 0, { deck: 1 });
    // the deck's glass balustrade with a bronze rail (open where the stair arrives)
    var rail = function (u0, u1, v0, v1) { K.ext("glass", 0xffffff, u0, u1, L.deck, L.deck + 1.02, v0, v1); var cu0 = u0 - 0.02, cu1 = u1 + 0.02, cv0 = v0 - 0.02, cv1 = v1 + 0.02; K.ext("metal", 0x9c7446, cu0, cu1, L.deck + 1.02, L.deck + 1.07, cv0, cv1); wall(u0, u1, v0, v1, L.deck + 1.07, L.deck - 0.2); };
    rail(-45.0, -27.9, 12.42, 12.5); rail(-45.08, -45.0, -11.3, 12.5); rail(-28.0, -27.92, -11.3, 12.5); rail(-45.0, -36.8, -11.38, -11.3); rail(-33.2, lu0, -11.38, -11.3); rail(-27.68, -27.6, -15.2, -11.3); rail(lu0, -27.6, -15.28, -15.2);
    // ── the Sunset Terrace (an L round the lounge's west and south sides): travertine, seat walls, the corner opening to the west walk ──
    K.drape("stone", 0xefe6d8, -50.4, lg[0], -12.4, 10.2, 1.6, 0.035); K.drape("stone", 0xefe6d8, -50.4, -27.8, 10.2, 19.6, 1.6, 0.035);
    K.ext("earth", EW, -50.9, -50.4, 0, 0.46, -12.4, 17.4); K.ext("stone", 0xe9e0d2, -50.96, -50.34, 0.46, 0.52, -12.4, 17.4); seat(-50.65, 2.5, 26, 0.5, 0.52, -PI / 2, { spaKind: "wall" }); wall(-50.9, -50.4, -12.4, 17.4, 0.52);
    K.ext("earth", EW, -48.6, -38.2, 0, 0.46, 19.6, 20.1); K.ext("earth", EW, -35.0, -27.8, 0, 0.46, 19.6, 20.1); K.ext("stone", 0xe9e0d2, -48.66, -38.14, 0.46, 0.52, 19.54, 20.16); K.ext("stone", 0xe9e0d2, -35.06, -27.74, 0.46, 0.52, 19.54, 20.16); wall(-48.6, -38.2, 19.6, 20.1, 0.52); wall(-35.0, -27.8, 19.6, 20.1, 0.52);
    // the landing at the stair's foot and the terrace's north end
    K.drape("stone", 0xefe6d8, -42.6, -41.2, -15.0, -12.4, 0.8, 0.035);
    // ── the Olive Court: gravel, the runnel with its coping and side walks, the bridge, the mulch rounds, the cloister paving ──
    var ct = L.court; K.drape("gravel", 0xd8cdbd, ct[0], ct[1], ct[2], ct[3], 2.0, 0.02);
    K.ext("stone", 0xebe3d6, -26.6, 2.0, 0, 0.075, 0.3, 0.62); K.ext("stone", 0xebe3d6, -26.6, 2.0, 0, 0.075, -0.62, -0.3); K.ext("stone", 0xebe3d6, -27.0, -26.6, 0, 0.075, -0.62, 0.62);
    K.flat("water", 0xffffff, 28.6, 0.6, -12.3, 0.035, 0); K.ext("dark", 0x3d3a36, -26.6, 2.0, -0.2, 0.03, -0.31, 0.31);
    K.ext("stone", 0xf0e8dc, -26.6, 1.0, 0, 0.05, 0.62, 2.4); K.ext("stone", 0xf0e8dc, -26.6, 1.0, 0, 0.05, -2.4, -0.62);
    K.ext("stone", 0xe2d8c8, -14.1, -12.5, 0.05, 0.12, -2.4, 2.4); K.ext("dark", 0x5a524a, -14.0, -12.6, 0, 0.05, -2.3, -2.4 + 0.1); solid(-13.3, 0, 1.6, 4.8, -0.3, 0.12, 0, {});
    solid(-6.1, 0, 16.0, 0.62, -0.3, 0.3, 0, { noStep: true, water: 1 }); solid(-20.35, 0, 12.5, 0.62, -0.3, 0.3, 0, { noStep: true, water: 1 });
    L.olives.slice(0, 8).forEach(function (o) { K.disc("gravel", 0x8f7f6d, 1.25, o[0], 0.035, o[1], 24); K.ring("stone", 0xd6ccbc, 1.25, 1.36, o[0], 0.05, o[1], 28); });
    [-1, 1].forEach(function (sg) { var v0 = sg < 0 ? -12.0 : 9.9, v1 = sg < 0 ? -9.9 : 12.0; K.ext("stone", 0xf0e8dc, -28.0, 4.0, 0, 0.04, v0, v1); });
    // the water wall: a basalt slab against the reception, a bronze lip, the sheet, the trough that feeds the runnel
    K.ext("dark", 0x4a4541, 3.1, 3.75, 0, 3.3, -2.9, 2.9); K.ext("metal", 0x9c7446, 2.95, 3.12, 3.0, 3.08, -2.8, 2.8); K.ext("dark", 0x3a3633, 3.0, 3.85, 3.3, 3.42, -3.0, 3.0);
    K.plane("sheet", 0xffffff, 5.6, 2.9, 3.07, 1.55, 0, -PI / 2, 0, [0, 0, 1, 1]);
    K.flat("water", 0xffffff, 1.1, 5.8, 2.55, 0.035, 0); K.ext("dark", 0x55504a, 1.8, 3.1, 0, 0.08, -3.1, -2.9); K.ext("dark", 0x55504a, 1.8, 3.1, 0, 0.08, 2.9, 3.1); K.ext("dark", 0x55504a, 1.8, 2.0, 0, 0.08, -2.9, -0.62); K.ext("dark", 0x55504a, 1.8, 2.0, 0, 0.08, 0.62, 2.9);
    wall(3.1, 3.75, -2.9, 2.9, 3.3); solid(2.55, 0, 1.1, 5.8, -0.3, 0.3, 0, { noStep: true, water: 1 });
    // ── the cloisters: slim steel posts, a low roof, soffit downlights (the fixtures are detail) ──
    [-1, 1].forEach(function (sg) { var v0 = sg < 0 ? -12.4 : 9.4, v1 = sg < 0 ? -9.4 : 12.4, pv = sg < 0 ? -9.75 : 9.75; roof(K, -28.0, 4.25, v0, v1, 3.0, 3.32);
      [-26.6, -21.3, -16.0, -10.6, -5.3, 0.0].forEach(function (u) { K.box("steel", 0x2c2a27, 0.14, 3.0, 0.14, u, 1.5, pv); solid(u, pv, 0.16, 0.16, -0.3, 3.0, 0, { noStep: true }); }); });
    // ── the treatment wing: four rooms off the north cloister, slatted windows to private gardens ──
    var rv = L.roomV, WH = L.wingH;
    wallU(K, "earth", EW, -28.25, 0.25, -12.0, 0.5, WH, L.rooms.map(function (r) { var c = (r[0] + r[1]) / 2; return [c - 0.6, c + 0.6, 0, 2.5]; }));
    wallU(K, "earth", EW, -28.25, 0.25, -19.5, 0.5, WH, L.rooms.map(function (r) { var c = (r[0] + r[1]) / 2; return [c - 1.3, c + 1.3, 0.8, 2.55]; }));
    [-28, -21, -14, -7, 0].forEach(function (u) { wallV(K, "earth", EW, -19.25, -12.25, u, 0.5, WH, []); });
    roof(K, -28.5, 0.5, -20.1, -11.9, WH, WH + 0.35);
    L.rooms.forEach(function (r, i) { var R0 = [r[0], r[1], rv[0], rv[1]]; K.ext("oak", 0xc9a47e, r[0], r[1], 0, 0.03, rv[0], rv[1]); ceiling(K, "oak", R0, WH - 0.02, 0xf0e6d8); plasterSkin(K, R0, WH - 0.02, [[(r[0] + r[1]) / 2 - 0.6, (r[0] + r[1]) / 2 + 0.6, 0, 2.5, "s"], [(r[0] + r[1]) / 2 - 1.3, (r[0] + r[1]) / 2 + 1.3, 0.8, 2.55, "n"]]);
      var c = (r[0] + r[1]) / 2; for (var sl = -1.25; sl <= 1.26; sl += 0.125) K.ext("cedar", 0xd9b28a, c + sl - 0.025, c + sl + 0.025, 0.8, 2.55, -19.55, -19.45); });
    // the private gardens behind (gravel, an earth wall)
    K.drape("gravel", 0xcfc3b2, -28.0, 0.25, -24.4, -19.75, 1.5, 0.03);
    wallU(K, "earth", EW, -28.25, 0.25, -24.65, 0.5, 2.2, []); [-28, -21, -14, -7, 0].forEach(function (u) { wallV(K, "earth", EW, -24.4, -19.75, u, 0.3, 2.2, []); });
    K.ext("steel", 0x2c2a27, -28.3, 0.3, 2.2, 2.24, -24.92, -24.38);
    // ── the bath house: steam, sauna, rain walk, changing room ──
    var bv = L.bath.v, B = L.bath;
    wallU(K, "earth", EW, -28.25, 4.25, 12.0, 0.5, WH, [[-24.4, -23.0, 0, 2.4], [-16.7, -15.3, 0, 2.4], [-9.2, -7.8, 0, 2.5], [-0.8, 0.8, 0, 2.6]]);
    wallU(K, "earth", EW, -28.25, 4.25, 22.5, 0.5, WH, [[-9.4, -7.6, 0, 2.6], [0.2, 2.0, 0, 2.6]]);
    [-28, -19.5, -12.5, -4.5, 4].forEach(function (u) { wallV(K, "earth", EW, 12.25, 22.25, u, 0.5, WH, []); });
    roof(K, -28.5, 4.5, 11.9, 23.1, WH, WH + 0.35);
    // steam: tadelakt everywhere, a dark wet floor, an oculus; sauna: cedar; rain: basalt; changing: oak and plaster
    var stR = [B.steam[0], B.steam[1], bv[0], bv[1]], saR = [B.sauna[0], B.sauna[1], bv[0], bv[1]], raR = [B.rain[0], B.rain[1], bv[0], bv[1]], chR = [B.change[0], B.change[1], bv[0], bv[1]];
    K.ext("dark", 0x7a7068, stR[0], stR[1], 0, 0.03, bv[0], bv[1]); plasterSkin(K, stR, 2.95, [[-24.4, -23.0, 0, 2.4, "n"]]); ceiling(K, "plaster", stR, 2.95, 0xeee2cf);
    K.ext("oak", 0xc4955f, saR[0], saR[1], 0, 0.03, bv[0], bv[1]); skin(K, "oak", 0xf0d6b0, saR, 2.65, [[-16.7, -15.3, 0, 2.4, "n"]]); ceiling(K, "oak", saR, 2.65, 0xead0a8);
    K.ext("dark", 0x57504a, raR[0], raR[1], 0, 0.03, bv[0], bv[1]); darkSkin(K, raR, 3.15, [[-9.2, -7.8, 0, 2.5, "n"], [-9.4, -7.6, 0, 2.6, "s"]]); ceiling(K, "dark", raR, 3.15, 0x6b625a);
    K.ext("oak", 0xc9a47e, chR[0], chR[1], 0, 0.03, bv[0], bv[1]); plasterSkin(K, chR, 3.15, [[-0.8, 0.8, 0, 2.6, "n"], [0.2, 2.0, 0, 2.6, "s"]]); ceiling(K, "oak", chR, 3.15, 0xf0e6d8);
    // ── the reception pavilion: a tall entry under a deep canopy toward the arrival court ──
    var rc = L.recep, RH = L.recepH;
    wallV(K, "earth", EW, rc[2] - 0.25, rc[3] + 0.25, rc[0], 0.5, RH, [[-10.6, -8.2, 0, 2.8]]);
    wallU(K, "earth", EW, rc[0] + 0.25, rc[1] + 0.25, rc[2], 0.5, RH, [[9.5, 12.5, 0, 3.1], [14.6, 15.2, 0.4, 3.1]]);
    wallV(K, "earth", EW, rc[2] - 0.25, rc[3] + 0.25, rc[1], 0.5, RH, []); wallU(K, "earth", EW, rc[0] + 0.25, rc[1] - 0.25, rc[3], 0.5, RH, []);
    K.ext("glass", 0xffffff, 14.6, 15.2, 0.4, 3.1, rc[2] - 0.02, rc[2] + 0.02);
    roof(K, 3.4, 18.6, -17.7, 4.0, RH, RH + 0.4, true); soffit(K, 3.5, 18.5, -17.6, rc[2] - 0.25, RH - 0.005); ceiling(K, "oak", [rc[0] + 0.25, rc[1] - 0.25, rc[2] + 0.25, rc[3] - 0.25], RH - 0.02, 0xf2e9dc);
    [8.0, 14.0].forEach(function (u) { K.box("steel", 0x2c2a27, 0.16, RH, 0.16, u, RH / 2, -17.3); solid(u, -17.3, 0.18, 0.18, -0.3, RH, 0, { noStep: true }); });
    K.ext("stone", 0xf2ebe0, rc[0] + 0.25, rc[1] - 0.25, 0, 0.03, rc[2] + 0.25, rc[3] - 0.25); plasterSkin(K, [rc[0] + 0.25, rc[1] - 0.25, rc[2] + 0.25, rc[3] - 0.25], RH - 0.02, [[9.5, 12.5, 0, 3.1, "n"], [14.6, 15.2, 0.4, 3.1, "n"], [-10.6, -8.2, 0, 2.8, "w"]]);
    // the big pivot doors, open
    K.ext("charred", 0xffffff, 9.5, 9.62, 0, 3.05, rc[2] + 0.25, rc[2] + 1.75); K.ext("charred", 0xffffff, 12.38, 12.5, 0, 3.05, rc[2] + 0.25, rc[2] + 1.75); K.ext("metal", 0x9c7446, 9.62, 9.66, 1.0, 1.9, rc[2] + 1.55, rc[2] + 1.6); K.ext("metal", 0x9c7446, 12.34, 12.38, 1.0, 1.9, rc[2] + 1.55, rc[2] + 1.6);
    // ── the arrival court: travertine forecourt (eased up to the drive at the lane), the olive ring, the cart pergola, the monument ──
    K.drape("stone", 0xe2d8ca, 4.0, 33.5, -34.6, -13.3, 1.5, function (u, v) { return 0.035 + 0.1 * (1 - sstep(-34.2, -32.4, v)); });
    ringWall(K, "earth", EW, 3.8, 0, 0.56, 17, -25.5, 44, false); ringWall(K, "earth", EW, 3.42, 0.2, 0.56, 17, -25.5, 44, true); K.ring("stone", 0xe9e1d3, 3.38, 3.84, 17, 0.56, -25.5, 48); K.disc("gravel", 0x8a7a68, 3.42, 17, 0.46, -25.5, 40); ringSolids(17, -25.5, 3.6, 0.56, 14);
    [-33.0, -29.9, -26.9, -23.9, -20.9, -17.9].forEach(function (v) { [28.6, 33.0].forEach(function (u) { K.box("charred", 0xffffff, 0.18, 2.6, 0.18, u, 1.3, v); solid(u, v, 0.2, 0.2, -0.3, 2.6, 0, { noStep: true }); }); });
    [28.6, 33.0].forEach(function (u) { K.ext("charred", 0xffffff, u - 0.1, u + 0.1, 2.6, 2.84, -33.2, -17.7); }); for (var sv = -33.0; sv <= -17.8; sv += 0.32) K.ext("cedar", 0xd9b28a, 28.3, 33.3, 2.84, 2.9, sv - 0.04, sv + 0.04);
    [-32.9, -29.9, -26.9, -23.9, -20.9, -17.9].forEach(function (v) { K.flat("stone", 0xfaf7f0, 4.2, 0.08, 30.7, 0.07, v); });
    K.ext("earth", EW, 5.0, 13.0, 0, 1.5, -34.2, -33.6); K.ext("stone", 0xe9e0d2, 4.95, 13.05, 1.5, 1.58, -34.26, -33.54); wall(5.0, 13.0, -34.2, -33.6, 1.58);
    // ── the soaking garden: walls (a slatted cedar screen on the low west wall), the quiet garden in front, the tub pads ──
    K.drape("gravel", 0xd6cab9, -27.75, 15.0, 22.75, 39.5, 2.0, 0.02); K.drape("gravel", 0xd6cab9, 4.25, 15.0, 3.75, 22.75, 2.0, 0.02);
    wallU(K, "earth", EW, -28.25, 15.5, 39.75, 0.5, 1.9, []); K.ext("steel", 0x2c2a27, -28.3, 15.55, 1.9, 1.94, 39.48, 40.02);
    wallV(K, "earth", EW, 22.75, 39.5, -28.0, 0.5, 1.2, [[30.0, 32.0, 0, 9]]); K.ext("steel", 0x2c2a27, -28.27, -27.73, 1.2, 1.23, 22.75, 30.0); K.ext("steel", 0x2c2a27, -28.27, -27.73, 1.2, 1.23, 32.0, 39.5);
    for (var sc = 22.9; sc < 39.4; sc += 0.16) { if (sc > 29.95 && sc < 32.05) continue; K.ext("cedar", 0xd2a77c, -28.03, -27.97, 1.23, 2.35, sc - 0.03, sc + 0.03); } K.ext("charred", 0xffffff, -28.08, -27.92, 2.35, 2.43, 22.75, 30.0); K.ext("charred", 0xffffff, -28.08, -27.92, 2.35, 2.43, 32.0, 39.5); wall(-28.1, -27.9, 22.75, 30.0, 2.43); wall(-28.1, -27.9, 32.0, 39.5, 2.43);
    wallV(K, "earth", EW, 3.75, 39.5, 15.25, 0.5, 1.9, [[26.0, 28.0, 0, 9]]); K.ext("steel", 0x2c2a27, 14.98, 15.52, 1.9, 1.94, 3.75, 26.0); K.ext("steel", 0x2c2a27, 14.98, 15.52, 1.9, 1.94, 28.0, 39.5);
    // the stone stepping path from the south cloister through the quiet garden to the tubs
    [[5.6, 11.2], [6.6, 13.0], [7.4, 14.8], [8.0, 16.6], [8.4, 18.4], [8.5, 20.2], [8.3, 22.0], [7.8, 23.8], [6.5, 25.2], [4.6, 26.0], [2.4, 26.5], [0.2, 26.8], [-6.0, 29.9], [-8.2, 30.6], [-10.5, 31.0], [-14.6, 31.2], [-16.9, 31.0], [-24.6, 31.0], [-26.6, 31.0], [9.0, 28.4], [10.4, 30.4]].forEach(function (p, i) { K.box("stone", 0xe8e0d2, 1.05, 0.05, 0.75, p[0], 0.025, p[1], (i * 0.37) % 0.5 - 0.25); });
    L.tubs.forEach(function (tq, i) { tub(K, tq[0], tq[1], i); });
    // ── the gravel walks round the outside: north (arrival court to the terrace and the stair), east (court to Bluff Loop), south-west ──
    K.drape("gravel", 0xcdbfad, -46.6, 4.0, -30.1, -28.0, 1.5, 0.03); K.drape("gravel", 0xcdbfad, -47.6, -45.6, -30.1, -12.4, 1.5, 0.03); K.drape("gravel", 0xcdbfad, -45.6, -42.6, -15.0, -13.2, 1.0, 0.03);
    K.drape("gravel", 0xcdbfad, 22.9, 25.1, -13.3, 42.0, 1.5, 0.03); K.drape("gravel", 0xcdbfad, 15.5, 22.9, 26.0, 28.0, 1.5, 0.03);
    K.drape("gravel", 0xcdbfad, -37.6, -35.4, 20.1, 32.0, 1.5, 0.03); K.drape("gravel", 0xcdbfad, -35.4, -28.0, 30.0, 32.0, 1.5, 0.03); K.drape("gravel", 0xcdbfad, -50.4, -48.6, 17.4, 20.1, 1.0, 0.03);
    K.drape("gravel", 0xcdbfad, 4.0, 4.6, -12.0, -10.0, 0.6, 0.03);
  }
  // interior skins (a thin layer on the room side of each wall, with the openings)
  function skin(K, mat, col, R0, h, ops) { var e = 0.012, o = ops || []; var opsFor = function (side) { return o.filter(function (q) { return q[4] === side; }).map(function (q) { return [q[0], q[1], q[2], q[3]]; }); };
    wallU(K, mat, col, R0[0], R0[1], R0[2] + e, 0.02, h, opsFor("n"), true); wallU(K, mat, col, R0[0], R0[1], R0[3] - e, 0.02, h, opsFor("s"), true);
    wallV(K, mat, col, R0[2], R0[3], R0[0] + e, 0.02, h, opsFor("w"), true); wallV(K, mat, col, R0[2], R0[3], R0[1] - e, 0.02, h, opsFor("e"), true); }
  // the skins' sides: "s" the wall on R0[3] (v max: the cloister side of the treatment rooms is v max = -12.25), "n" on R0[2]
  function plasterSkin(K, R0, h, ops) { skin(K, "plaster", 0xffffff, R0, h, ops); }
  function cedarSkin(K, R0, h, ops) { skin(K, "cedar", 0xe2b88c, R0, h, ops); }
  function darkSkin(K, R0, h, ops) { skin(K, "dark", 0x8a8078, R0, h, ops); }

  // ───────────────────────── the furnishing (the detail group: drawn within 150 m) ─────────────────────────
  function buildDetail(D) {
    var lg = L.lounge, H = L.loungeH, ps = psun();
    // ── the Hearth Lounge ──
    // the hearth: a stacked stone chimney breast, a linear firebox, embers, flames, a long stone hearth bench
    D.ext("ledge", 0xffffff, -37.4, -32.6, 0, H - 0.02, -11.75, -11.15); D.ext("dark", 0x1c1a18, -36.4, -33.6, 0.5, 1.12, -11.2, -11.13); D.ext("dark", 0x2a2522, -36.4, -33.6, 0.5, 0.56, -11.6, -11.12);
    D.ext("glow", 0xff7a2a, -36.2, -33.8, 0.56, 0.6, -11.45, -11.2); flames(D, -35.0, 0.56, -11.38, 2.2, 0.52, 2); flames(D, -35.6, 0.56, -11.38, 1.2, 0.42, 1); D.flat("add", 0xff8a3a, 5.2, 3.6, -35.0, 0.04, -9.6);
    D.ext("dark", 0x6a625a, -39.0, -31.0, 0, 0.42, -11.15, -10.5); D.ext("stone", 0xeae2d6, -39.05, -30.95, 0.42, 0.46, -11.2, -10.45); seat(-35.0, -10.8, 7.8, 0.62, 0.46, 0, { spaKind: "hearth", fire: 1 }); solid(-35.0, -10.8, 8.0, 0.7, -0.3, 0.42, 0, {});
    lamp(-35.0, 0.9, -10.6, 0xff9a52, 6.0, 9.5, 0.5, true); GLOWS.push({ u: -35.0, y: 0.8, v: -11.3, s: 1.2 });
    // the seating round the fire on a wool rug, the low stone table, lamps
    D.flat("linen", 0xb9a68c, 7.4, 6.0, -35.0, 0.035, -6.4); D.flat("linen", 0xd8cab4, 6.8, 5.4, -35.0, 0.037, -6.4);
    sofa(D, -35.0, -4.2, PI, 3.0, 0xd9cdb9); chair(D, -38.6, -7.4, PI / 2 + 0.35, 0xc7b39a); chair(D, -31.4, -7.4, -PI / 2 - 0.35, 0xc7b39a);
    D.ext("dark", 0x6d655d, -36.0, -34.0, 0, 0.36, -7.4, -6.4); D.ext("stone", 0xe6ddcf, -36.05, -33.95, 0.36, 0.4, -7.45, -6.35); solid(-35.0, -6.9, 2.0, 1.0, -0.3, 0.4, 0, { noStep: true }); candleAt(D, -35.4, 0.4, -6.9, 0.14); candleAt(D, -34.7, 0.4, -6.8, 0.1); D.cyl("ceramic", 0x2f3a3a, 0.16, 0.12, 0.12, -34.4, 0.46, -7.1, 16);
    // daybeds facing the glass and the setting sun (west wall pair, the corner, south wall pair)
    daybed(D, -40.3, -8.6, -PI / 2); daybed(D, -40.3, -5.2, -PI / 2); daybed(D, -40.0, 4.3, ps); daybed(D, -36.6, 7.6, ps); daybed(D, -33.4, 7.6, ps);
    sideTable(D, -40.4, -6.9, 0.5, true); sideTable(D, -38.6, 6.4, 0.5, true); sideTable(D, -35.0, 8.8, 0.5, true);
    // the tea bar on the east wall's south part: oak, a stone top, the teapot and cups, shelves of ceramics
    D.ext("oak", 0x7a5a3e, -29.0, -28.25, 0, 0.92, 3.8, 9.2); D.ext("stone", 0xebe3d6, -29.1, -28.25, 0.92, 0.97, 3.75, 9.25); solid(-28.6, 6.5, 0.8, 5.5, -0.3, 0.97, 0, { noStep: true });
    D.sph("ceramic", 0x3e4a48, 0.13, -28.65, 1.08, 5.2, 14, 1, 0.8, 1); D.cyl("ceramic", 0x3e4a48, 0.04, 0.05, 0.05, -28.65, 1.2, 5.2, 10); [5.6, 5.8, 6.0, 6.2].forEach(function (v, i) { D.cyl("ceramic", i % 2 ? 0xe8ddc8 : 0x9a5a3a, 0.045, 0.035, 0.07, -28.6, 1.005, v, 12); });
    D.sph("ceramic", 0xd9893a, 0.06, -28.6, 1.03, 7.4, 10); D.sph("ceramic", 0xe9a23f, 0.06, -28.5, 1.03, 7.55, 10); D.cyl("ceramic", 0xcfc3b0, 0.22, 0.16, 0.1, -28.55, 1.02, 7.5, 18);
    [1.7, 2.3].forEach(function (y) { D.ext("oak", 0x7a5a3e, -28.6, -28.25, y, y + 0.05, 4.0, 9.0); }); for (var ci = 0; ci < 9; ci++) { var cv = 4.3 + ci * 0.55, cy = ci % 2 ? 1.75 : 2.35; D.cyl("ceramic", [0xe6dccb, 0x8f5a3c, 0x3e4a48, 0xcdb48e][ci % 4], 0.08 + (ci % 3) * 0.02, 0.06, 0.14 + (ci % 3) * 0.08, -28.45, cy + 0.07 + (ci % 3) * 0.04, cv, 14); }
    // the painting on the east wall's north part, a picture light over it
    D.box("oak", 0x3a2a1e, 0.06, 2.86, 5.02, -28.27, 2.35, -7.6); D.plane("painting", 0xffffff, 4.8, 2.7, -28.23, 2.35, -7.6, -PI / 2, 0); D.box("metal", 0x9c7446, 0.12, 0.05, 2.4, -28.36, 3.86, -7.6); D.box("glow", 0xffe2b8, 0.03, 0.02, 2.3, -28.38, 3.83, -7.6);
    // pendants over the seating, floor lamps by the daybeds, tall pots of dried grasses
    pendant(D, -35.0, 3.0, -6.6, 0.42, 0.36, 0xe9dcc4); pendant(D, -37.5, 3.2, 6.0, 0.32, 0.3); pendant(D, -32.5, 3.2, 6.0, 0.32, 0.3);
    [[-41.2, -3.4], [-31.2, 8.9]].forEach(function (q) { D.cyl("steel", 0x2a2826, 0.016, 0.016, 1.45, q[0], 0.73, q[1], 6); D.cyl("steel", 0x2a2826, 0.16, 0.18, 0.03, q[0], 0.02, q[1], 14); D.cyl("linen", 0xe8dcc4, 0.2, 0.24, 0.32, q[0], 1.55, q[1], 18, true); D.disc("glow", 0xffd9a6, 0.19, q[0], 1.4, q[1], 14); D.flat("add", 0xffb97a, 2.4, 2.4, q[0], 0.04, q[1]); solid(q[0], q[1], 0.36, 0.36, -0.3, 1.7, 0, { noStep: true }); });
    [[-29.1, -10.9], [-41.2, 9.2], [-29.1, 2.6]].forEach(function (q, i) { D.cyl("ceramic", i === 1 ? 0x8f5a3c : 0xd6c8b2, 0.28, 0.2, 0.75, q[0], 0.375, q[1], 18); for (var gs = 0; gs < 14; gs++) { var a = gs / 14 * TAU, r = 0.04 + (gs % 3) * 0.03; D.tube("linen", 0xd8c49a, V3(q[0] + Math.cos(a) * r, 0.72, q[1] + Math.sin(a) * r), V3(q[0] + Math.cos(a) * (r + 0.22), 1.75 + (gs % 4) * 0.12, q[1] + Math.sin(a) * (r + 0.22)), 0.006, 3); } solid(q[0], q[1], 0.56, 0.56, -0.3, 0.75, 0, { noStep: true }); });
    lamp(-35.0, 2.6, 6.0, 0xffd2a0, 3.2, 10, 0.35); lamp(-35.0, 3.0, -6.6, 0xffd2a0, 2.6, 9, 0.3); lamp(-39.5, 1.2, -1.0, 0xffc890, 2.0, 7, 0.2);
    // ── the Sunset Terrace: loungers toward the setting sun, the fire bowl and its chairs, planters ──
    lounger(D, -47.4, -10.2, ps); lounger(D, -47.4, -7.2, ps); lounger(D, -47.4, -4.2, ps); lounger(D, -34.4, 16.4, ps); lounger(D, -31.4, 16.4, ps);
    sideTable(D, -46.2, -8.7, 0.45, true); sideTable(D, -32.9, 17.6, 0.45, true);
    firePit(D, -42.6, 15.6, 0.78); chair(D, -44.6, 13.9, Math.atan2(-42.6 + 44.6, 15.6 - 13.9), 0xd9cdb9); chair(D, -40.3, 14.2, Math.atan2(-42.6 + 40.3, 15.6 - 14.2), 0xd9cdb9); chair(D, -40.6, 17.6, Math.atan2(-42.6 + 40.6, 15.6 - 17.6), 0xd9cdb9);
    planter(D, -29.4, 18.6, 1.8, 1.8, 0.62); planter(D, -48.9, -14.9, 1.8, 1.8, 0.62);
    [[-50.6, -11.0], [-50.6, -5.0], [-50.6, 1.0], [-50.6, 7.0], [-50.6, 13.0], [-44.0, 19.85], [-38.6, 19.85], [-34.6, 19.85], [-30.6, 19.85]].forEach(function (q) { D.box("glow", 0xffc98a, 0.14, 0.05, 0.03, q[0] + (q[1] > 19 ? 0 : 0.27), 0.22, q[1] > 19 ? q[1] - 0.27 : q[1], q[1] > 19 ? 0 : PI / 2); D.flat("add", 0xffb46a, 1.6, 1.6, q[0] + (q[1] > 19 ? 0 : 0.9), 0.045, q[1] > 19 ? q[1] - 0.9 : q[1]); });
    // ── the roof: loungers toward the sunset, two telescopes, a low table, planters of grasses, a string of warm lights ──
    var dk = L.deck; YB = dk;
    [[-42.6, 8.6], [-39.6, 8.6], [-36.6, 8.6], [-42.6, 4.6]].forEach(function (q) { lounger(Dk(D, dk), q[0], q[1], ps); });
    telescope(Dk(D, dk), -43.4, 11.2, ps); telescope(Dk(D, dk), -43.6, -9.6, ps - 0.6);
    var D2 = Dk(D, dk); D2.ext("dark", 0x6d655d, -39.4, -37.6, 0, 0.38, 0.4, 1.4); D2.ext("stone", 0xe6ddcf, -39.45, -37.55, 0.38, 0.42, 0.35, 1.45); solid(-38.5, 0.9, 1.8, 1.0, -0.3, 0.42, 0, { noStep: true }); candleAt(D2, -38.8, 0.42, 0.9, 0.12); candleAt(D2, -38.2, 0.42, 0.95, 0.09);
    [[-41.2, 0.9, PI / 2], [-35.8, 0.9, -PI / 2]].forEach(function (q) { var F = PF(q[0], q[1], q[2]); pbox(D2, F, "oak", 0x7a5a3e, 2.2, 0.36, 0.5, 0, 0.18, 0); prbox(D2, F, "linen", 0xd9cdb9, 2.1, 0.12, 0.5, 0.04, 0, 0.42, 0); var p = F.f(0, 0); seat(p[0], p[1], 2.0, 0.5, 0.48, q[2], { spaKind: "roofbench" }); });
    for (var pl = -43.5; pl < -29; pl += 3.4) { D2.ext("earth", EW, pl, pl + 2.4, 0, 0.5, -11.0, -10.3); D2.ext("dark", 0x4a3e33, pl + 0.08, pl + 2.32, 0.48, 0.5, -10.92, -10.38); solid(pl + 1.2, -10.65, 2.4, 0.7, -0.3, 0.5, 0, { noStep: true }); for (var g2 = 0; g2 < 6; g2++) { var gu = pl + 0.25 + g2 * 0.38; for (var bl = 0; bl < 5; bl++) D2.tube("linen", 0xc9b48a, V3(gu, 0.5, -10.65), V3(gu + (bl - 2) * 0.07, 0.95 + (bl % 3) * 0.12, -10.65 + (bl % 2 ? 0.1 : -0.1)), 0.006, 3); } }
    // the festoon: four poles, warm bulbs on sagging wires
    [[-30.6, -8.6], [-30.6, 6.8]].forEach(function (q) { D2.cyl("earth", EW, 0.78, 0.66, 0.66, q[0], 0.33, q[1], 28); D2.disc("gravel", 0x8a7a68, 0.7, q[0], 0.64, q[1], 24); solid(q[0], q[1], 1.5, 1.5, -0.3, 0.66, 0, { noStep: true }); });
    var poles = [[-44.6, -11.0], [-44.6, 12.1], [-28.4, 12.1], [-28.4, -11.0]]; poles.forEach(function (q) { D2.cyl("steel", 0x2a2826, 0.04, 0.05, 2.9, q[0], 1.45, q[1], 8); solid(q[0], q[1], 0.12, 0.12, -0.3, 2.9, 0, { noStep: true }); });
    for (var pp = 0; pp < 4; pp++) { var A0 = poles[pp], B0 = poles[(pp + 1) % 4], nb = Math.round(Math.hypot(B0[0] - A0[0], B0[1] - A0[1]) / 0.8); for (var bi = 0; bi <= nb; bi++) { var t0 = bi / nb, sag = Math.sin(t0 * PI) * 0.45, bu2 = lerp(A0[0], B0[0], t0), bv2 = lerp(A0[1], B0[1], t0); D2.sph("glow", 0xffcf8a, 0.045, bu2, 2.82 - sag, bv2, 6); if (bi < nb) { var t1 = (bi + 1) / nb; D2.tube("steel", 0x1e1c1a, V3(bu2, 2.86 - sag, bv2), V3(lerp(A0[0], B0[0], t1), 2.86 - Math.sin(t1 * PI) * 0.45, lerp(A0[1], B0[1], t1)), 0.004, 3); } } }
    YB = dk; lounger(Dk(D, dk), -33.6, 8.6, ps); lounger(Dk(D, dk), -39.6, 4.6, ps); YB = 0;
    lamp(-36.5, dk + 2.5, 1.0, 0xffd2a0, 2.4, 13, 0);
    // ── the Olive Court: benches facing the runnel, bronze bollards, the LED lines in the coping, uplights on the olives ──
    [[-20.75, 3.25, PI], [-20.75, -3.25, 0], [-5.75, 3.25, PI], [-5.75, -3.25, 0]].forEach(function (q) { stoneBench(D, q[0], q[1], q[2], 2.2); });
    [-24.0, -16.2, -10.7, -1.6].forEach(function (u) { bollard(D, u, 2.75); bollard(D, u, -2.75); });
    D.ext("glow", 0xffd9a8, -26.5, 1.9, 0.036, 0.046, 0.27, 0.3); D.ext("glow", 0xffd9a8, -26.5, 1.9, 0.036, 0.046, -0.3, -0.27); for (var rs = -26.0; rs < 1.6; rs += 1.9) D.flat("add", [0.34, 0.24, 0.13], 2.1, 0.7, rs, 0.041, 0);
    [[-23.5, 4.4], [-23.5, -4.4], [-8.5, 4.4], [-8.5, -4.4]].forEach(function (q) { lamp(q[0], 0.6, q[1], 0xffc68a, 2.4, 7.5, 0); });
    [-1, 1].forEach(function (sg) { var vw = sg < 0 ? -11.72 : 11.72; [-24.0, -18.6, -13.3, -8.0, -2.6, 2.2].forEach(function (u) { D.plane("add", [0.3, 0.2, 0.11], 2.6, 3.4, u, 2.72, vw, sg < 0 ? 0 : PI, 0, [0, 0, 1, 1]); }); });
    L.olives.slice(0, 8).forEach(function (o) { uplight(D, o[0] + 0.6, o[1] + (o[1] > 0 ? -0.5 : 0.5), 2.6); });
    lamp(-15.0, 2.2, 0, 0xffc890, 2.4, 14, 0); lamp(1.0, 2.0, 0, 0xffd2a0, 2.0, 9, 0);
    // the water wall's foam line and the light hidden in the trough
    D.ext("addDay", 0x384440, 3.0, 3.06, 0.04, 0.3, -2.8, 2.8); D.ext("add", 0xffd9a0, 2.1, 3.05, 0.036, 0.04, -2.7, 2.7);
    // cloister downlights and pools; room plaques by the doors
    [-1, 1].forEach(function (sg) { var vv = sg < 0 ? -10.9 : 10.9; [-24.0, -18.6, -13.3, -8.0, -2.6, 2.2].forEach(function (u) { D.disc("glow", 0xffe0b0, 0.07, u, 2.99, vv, 10); D.flat("add", 0xffbf80, 2.4, 2.4, u, 0.045, vv); }); });
    L.rooms.forEach(function (r, i) { var c = (r[0] + r[1]) / 2; D.plane("signs", 0xffffff, 0.34, 0.34, c + 0.95, 1.55, -11.74, 0, 0, [i / 7, 1 - 6 / 8, (i + 1) / 7, 1 - 5 / 8]); });
    [[-23.7, "s"], [-16.0, "a"], [-8.5, "r"]].forEach(function (q, i) { D.plane("signs", 0xffffff, 0.6, 0.3, q[0] + 1.2, 1.55, 11.74, PI, 0, [(4 + i) / 7, 1 - 6 / 8, (5 + i) / 7, 1 - 5 / 8]); });
    D.plane("signs", 0xffffff, 1.6, 0.2, -28.27, 2.9, 1.4, -PI / 2, 0, signUV(2)); D.plane("signs", 0xffffff, 1.6, 0.2, -12.0, 3.1, 11.74, PI, 0, signUV(3));
    // ── the treatment rooms: the table, a rug, a basin of warm stones, candles on a ledge, a stool, towels, a pendant, the door leaf ──
    L.rooms.forEach(function (r, i) { var c = (r[0] + r[1]) / 2, v0 = L.roomV[0], v1 = L.roomV[1];
      D.flat("linen", [0xc9b79a, 0xb79e80, 0xc2ab8c, 0xbaa588][i], 2.6, 3.4, c, 0.035, -15.6); massageTable(D, c, -15.6, 0, i);
      D.ext("plaster", 0xf2e8d8, r[0] + 0.03, r[1] - 0.03, 0, 0.42, v0, v0 + 0.36); [-1.6, -0.9, 0.9, 1.6].forEach(function (du) { candleAt(D, c + du, 0.42, v0 + 0.2, 0.08 + (Math.abs(du) > 1 ? 0.06 : 0)); });
      D.box("oak", 0x6e5038, 0.5, 0.82, 0.5, r[0] + 0.6, 0.41, v0 + 0.9); D.cyl("dark", 0x3d3834, 0.24, 0.16, 0.12, r[0] + 0.6, 0.88, v0 + 0.9, 18); for (var st = 0; st < 5; st++) D.sph("dark", 0x2a2725, 0.06, r[0] + 0.52 + (st % 3) * 0.07, 0.95, v0 + 0.84 + (st >> 1) * 0.07, 8, 1, 0.55, 1); solid(r[0] + 0.6, v0 + 0.9, 0.55, 0.55, -0.3, 0.95, 0, { noStep: true });
      D.cyl("oak", 0x8a6646, 0.2, 0.18, 0.46, r[1] - 0.8, 0.23, -14.4, 14); solid(r[1] - 0.8, -14.4, 0.42, 0.42, -0.3, 0.46, 0, { noStep: true });
      D.ext("oak", 0x7a5a3e, r[1] - 0.45, r[1] - 0.03, 1.2, 1.25, v0 + 1.4, v0 + 2.6); [0, 1, 2].forEach(function (k) { D.rbox("linen", k % 2 ? 0xd9cbb3 : 0xf5f1e8, 0.36, 0.1, 0.3, 0.02, r[1] - 0.25, 1.31 + k * 0.1, v0 + 2.0, 0); });
      pendant(D, c, 2.55, -15.6, 0.3, 0.26, 0xe6d6bc); lamp(c, 2.2, -15.6, 0xffb27a, 1.8, 6.5, 0.45);
      D.ext("charred", 0xffffff, c - 0.62, c - 0.56, 0, 2.45, v1 - 1.2, v1 - 0.02); });
    // ── the bath house ──
    var B = L.bath, bv = B.v;
    // steam room: an L of tiled benches, an LED line under them, the oculus, the glass door
    D.ext("plaster", 0xf0e5d4, B.steam[0], B.steam[1], 0, 0.46, bv[1] - 0.6, bv[1]); D.ext("plaster", 0xf0e5d4, B.steam[0], B.steam[0] + 0.6, 0, 0.46, bv[0] + 1.4, bv[1] - 0.6); D.ext("glow", 0xffd9a0, B.steam[0] + 0.4, B.steam[1] - 0.2, 0.06, 0.08, bv[1] - 0.64, bv[1] - 0.6);
    seat((B.steam[0] + B.steam[1]) / 2, bv[1] - 0.3, 7.4, 0.55, 0.46, PI, { spaKind: "steam", bath: 1 }); seat(B.steam[0] + 0.3, (bv[0] + 1.4 + bv[1] - 0.6) / 2, 6.6, 0.55, 0.46, PI / 2, { spaKind: "steam", bath: 1 }); solid((B.steam[0] + B.steam[1]) / 2, bv[1] - 0.3, 8.0, 0.6, -0.3, 0.46, 0, {}); solid(B.steam[0] + 0.3, (bv[0] + bv[1] + 0.8) / 2, 0.6, 8.4, -0.3, 0.46, 0, {});
    D.ext("plaster", 0xf0e5d4, B.steam[1] - 0.6, B.steam[1], 0, 0.46, bv[0] + 1.4, bv[1] - 0.6); seat(B.steam[1] - 0.3, (bv[0] + 1.4 + bv[1] - 0.6) / 2, 6.6, 0.55, 0.46, -PI / 2, { spaKind: "steam", bath: 1 }); solid(B.steam[1] - 0.3, (bv[0] + bv[1] + 0.8) / 2, 0.6, 8.4, -0.3, 0.46, 0, {}); D.ext("glow", 0xffd9a0, B.steam[1] - 0.64, B.steam[1] - 0.6, 0.06, 0.08, bv[0] + 1.6, bv[1] - 0.8); D.ext("glow", 0xffd9a0, B.steam[0] + 0.6, B.steam[0] + 0.64, 0.06, 0.08, bv[0] + 1.6, bv[1] - 0.8);
    var fu = (B.steam[0] + B.steam[1]) / 2, fv = (bv[0] + bv[1]) / 2 + 0.6; D.cyl("stone", 0xf2ece2, 0.75, 0.62, 0.5, fu, 0.25, fv, 28); D.disc("water", 0xffffff, 0.66, fu, 0.49, fv, 28); D.cyl("dark", 0x4a4541, 0.12, 0.16, 0.9, fu, 0.95, fv, 14); D.sph("metal", 0x9c7446, 0.08, fu, 1.42, fv, 10); solid(fu, fv, 1.5, 1.5, -0.3, 0.5, 0, { noStep: true });
    [-25.6, -21.9].forEach(function (u) { D.ext("plaster", 0xe4d6c0, u - 0.45, u + 0.45, 1.3, 1.34, bv[1] - 0.06, bv[1] - 0.01); D.box("glow", 0xffc07a, 0.04, 0.05, 0.04, u, 1.37, bv[1] - 0.12); D.cyl("ceramic", 0x6b7a6a, 0.09, 0.07, 0.14, u + 0.2, 1.41, bv[1] - 0.14, 12); });
    D.disc("glow", 0xdfe8f0, 0.5, (B.steam[0] + B.steam[1]) / 2, 2.93, (bv[0] + bv[1]) / 2, 24); D.ext("glass", 0xffffff, -24.4, -24.34, 0, 2.38, 12.3, 13.7); lamp((B.steam[0] + B.steam[1]) / 2, 2.0, 17.3, 0xffe2c0, 1.6, 7, 0.6);
    STEAM.src.push({ u: (B.steam[0] + B.steam[1]) / 2, v: (bv[0] + bv[1]) / 2, r: 3.4, y: 0.3, n: 34, kind: "room", h: 2.6 });
    // sauna: two tiers of cedar benches, the stove with its stones, a bucket and ladle
    D.ext("oak", 0xe6c79c, B.sauna[0], B.sauna[1], 0.38, 0.45, bv[1] - 1.2, bv[1] - 0.6); D.ext("oak", 0xe6c79c, B.sauna[0], B.sauna[1], 0.83, 0.9, bv[1] - 0.6, bv[1]); D.ext("oak", 0xd9b88e, B.sauna[0], B.sauna[1], 0, 0.38, bv[1] - 1.2, bv[1] - 1.14); D.ext("oak", 0xd9b88e, B.sauna[0], B.sauna[1], 0.45, 0.83, bv[1] - 0.66, bv[1] - 0.6);
    seat((B.sauna[0] + B.sauna[1]) / 2, bv[1] - 0.9, 6.0, 0.55, 0.45, PI, { spaKind: "sauna", bath: 1 }); seat((B.sauna[0] + B.sauna[1]) / 2, bv[1] - 0.3, 6.0, 0.55, 0.9, PI, { spaKind: "sauna", bath: 1 }); solid((B.sauna[0] + B.sauna[1]) / 2, bv[1] - 0.9, 6.4, 0.62, -0.3, 0.45, 0, {}); solid((B.sauna[0] + B.sauna[1]) / 2, bv[1] - 0.3, 6.4, 0.6, -0.3, 0.9, 0, {});
    D.box("steel", 0x23211f, 0.6, 0.75, 0.55, B.sauna[0] + 0.7, 0.375, bv[0] + 1.1); for (var sn = 0; sn < 12; sn++) D.sph("dark", 0x3a3532, 0.07, B.sauna[0] + 0.5 + (sn % 4) * 0.12, 0.8, bv[0] + 0.95 + (sn >> 2) * 0.12, 7, 1, 0.7, 1); D.box("glow", 0xff6a20, 0.4, 0.06, 0.02, B.sauna[0] + 0.7, 0.22, bv[0] + 0.82); solid(B.sauna[0] + 0.7, bv[0] + 1.1, 0.7, 0.65, -0.3, 0.95, 0, { noStep: true });
    D.cyl("oak", 0x8a6040, 0.16, 0.13, 0.26, B.sauna[1] - 0.6, 0.13, bv[0] + 0.8, 14); D.tube("oak", 0x8a6040, V3(B.sauna[1] - 0.6, 0.3, bv[0] + 0.8), V3(B.sauna[1] - 0.75, 0.62, bv[0] + 0.95), 0.015, 5); lamp(B.sauna[0] + 0.7, 1.0, bv[0] + 1.2, 0xff8a40, 2.2, 6, 0.7, true);
    D.ext("glow", 0xffb070, B.sauna[0] + 0.1, B.sauna[1] - 0.1, 2.6, 2.62, bv[1] - 0.12, bv[1] - 0.08);
    // the rain walk: three bronze rain heads and their falls, a linear drain, a teak bench
    [-10.4, -8.5, -6.6].forEach(function (u) { D.cyl("metal", 0x9c7446, 0.24, 0.24, 0.03, u, 3.12, 17.3, 20); D.cyl("glass", 0xffffff, 0.2, 0.24, 3.05, u, 1.56, 17.3, 16, true); D.disc("addDay", 0x1a2224, 0.5, u, 0.035, 17.3, 18); }); D.ext("steel", 0x3a3836, B.rain[0] + 0.4, B.rain[1] - 0.4, 0.03, 0.035, 18.6, 18.75);
    D.ext("oak", 0x7a5a3e, B.rain[0] + 0.6, B.rain[1] - 0.6, 0.42, 0.47, bv[1] - 0.55, bv[1] - 0.1); seat((B.rain[0] + B.rain[1]) / 2, bv[1] - 0.33, 5.6, 0.45, 0.47, PI, { spaKind: "bench" }); solid((B.rain[0] + B.rain[1]) / 2, bv[1] - 0.33, 6.3, 0.5, -0.3, 0.47, 0, { noStep: true });
    [-11.2, -8.5, -5.8].forEach(function (u) { D.disc("glow", 0xfff0d8, 0.08, u, 3.13, 15.0, 10); }); lamp(-8.5, 2.6, 16.5, 0xffe8cc, 1.6, 7, 0.5);
    // the changing room: oak lockers, a bench, robes on hooks, towels, the vanity
    D.ext("oak", 0x9a7656, B.change[1] - 0.6, B.change[1] - 0.04, 0, 2.2, bv[0] + 0.6, bv[1] - 0.6); for (var lk = 0; lk < 8; lk++) D.ext("metal", 0x9c7446, B.change[1] - 0.63, B.change[1] - 0.6, 1.0, 1.25, bv[0] + 1.2 + lk * 1.1, bv[0] + 1.24 + lk * 1.1); wall(B.change[1] - 0.6, B.change[1] - 0.04, bv[0] + 0.6, bv[1] - 0.6, 2.2);
    D.ext("oak", 0x7a5a3e, -2.5, 1.5, 0, 0.46, 16.6, 17.1); seat(-0.5, 16.85, 3.8, 0.5, 0.46, 0, { spaKind: "bench" }); solid(-0.5, 16.85, 4.0, 0.52, -0.3, 0.46, 0, { noStep: true });
    for (var rb = 0; rb < 5; rb++) { D.rbox("linen", 0xf3efe6, 0.5, 1.05, 0.16, 0.06, B.change[0] + 0.5 + rb * 0.7, 1.3, bv[1] - 0.12, 0); D.box("metal", 0x9c7446, 0.04, 0.04, 0.1, B.change[0] + 0.5 + rb * 0.7, 1.86, bv[1] - 0.06); }
    D.ext("stone", 0xebe3d6, B.change[0] + 0.05, B.change[0] + 0.6, 0.85, 0.9, 13.0, 15.6); D.ext("oak", 0x7a5a3e, B.change[0] + 0.05, B.change[0] + 0.55, 0, 0.85, 13.1, 15.5); D.ext("steel", 0x1d2224, B.change[0] + 0.03, B.change[0] + 0.05, 1.1, 2.3, 13.1, 15.5); solid(B.change[0] + 0.33, 14.3, 0.6, 2.6, -0.3, 0.9, 0, { noStep: true });
    pendant(D, -0.5, 2.6, 15.0, 0.28, 0.24); lamp(-0.5, 2.2, 16.0, 0xffd2a0, 1.6, 7, 0.45);
    // ── the soaking garden: pergolas over two tubs, loungers, stone lanterns, the mineral water fountain ──
    [L.tubs[1], L.tubs[3]].forEach(function (tq) { var hp = 2.2, y = 2.75; [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q) { D.box("charred", 0xffffff, 0.16, y, 0.16, tq[0] + q[0] * hp, y / 2, tq[1] + q[1] * hp); solid(tq[0] + q[0] * hp, tq[1] + q[1] * hp, 0.18, 0.18, -0.3, y, 0, { noStep: true }); });
      [-1, 1].forEach(function (s) { D.ext("charred", 0xffffff, tq[0] - hp - 0.2, tq[0] + hp + 0.2, y, y + 0.2, tq[1] + s * hp - 0.08, tq[1] + s * hp + 0.08); }); for (var ps2 = -hp; ps2 <= hp + 0.01; ps2 += 0.3) D.ext("cedar", 0xd2a77c, tq[0] + ps2 - 0.03, tq[0] + ps2 + 0.03, y + 0.2, y + 0.3, tq[1] - hp - 0.25, tq[1] + hp + 0.25);
      for (var fb = 0; fb < 9; fb++) { var ang = fb / 9 * TAU; D.sph("glow", 0xffcf8a, 0.035, tq[0] + Math.cos(ang) * 1.9, y - 0.1 - (fb % 2) * 0.12, tq[1] + Math.sin(ang) * 1.9, 6); } });
    lounger(D, -17.4, 24.3, ps); lounger(D, -14.6, 24.3, ps); lounger(D, 2.0, 37.6, ps); lounger(D, 4.8, 37.6, ps);
    [[-16.5, 30.0], [-7.5, 31.6], [1.6, 30.6], [9.6, 30.2], [-24.6, 33.6], [11.8, 19.0], [5.0, 14.2]].forEach(function (q) { stoneLantern(D, q[0], q[1]); });
    D.box("stone", 0xe2d8c8, 0.9, 0.82, 0.55, 14.2, 0.41, 24.0); D.ext("dark", 0x3a3633, 13.85, 14.55, 0.78, 0.83, 23.8, 24.2); D.tube("metal", 0x9c7446, V3(14.5, 1.32, 24.0), V3(14.32, 1.12, 24.0), 0.018, 6); D.box("stone", 0xe2d8c8, 0.25, 0.6, 0.35, 14.62, 1.1, 24.0); solid(14.2, 24.0, 0.95, 0.6, -0.3, 0.82, 0, { noStep: true });
    D.plane("signs", 0xffffff, 1.6, 0.2, 14.98, 1.55, 25.2, -PI / 2, 0, signUV(4));
    lamp(-12.0, 2.4, 33.8, 0xffc890, 2.6, 13, 0); lamp(6.0, 2.4, 33.6, 0xffc890, 2.6, 13, 0); lamp(-21.0, 1.6, 28.0, 0xffc890, 1.6, 9, 0);
    // ── the reception: the desk, the plaque and the niche, a bench, pendants, pots, a rug ──
    D.ext("earth", EW, 8.0, 14.0, 0, 1.0, -4.3, -3.3); D.ext("oak", 0x6e5038, 7.9, 14.1, 1.0, 1.06, -4.4, -3.2); solid(11.0, -3.8, 6.2, 1.2, -0.3, 1.06, 0, { noStep: true });
    D.ext("ceramic", 0xe8ddc8, 9.0, 9.4, 1.06, 1.16, -3.9, -3.6); D.cyl("ceramic", 0x3e4a48, 0.12, 0.09, 0.3, 13.2, 1.21, -3.8, 14); for (var lv = 0; lv < 6; lv++) D.tube("linen", 0x8a9a7a, V3(13.2, 1.3, -3.8), V3(13.2 + Math.cos(lv) * 0.3, 1.85 + (lv % 3) * 0.12, -3.8 + Math.sin(lv) * 0.3), 0.008, 3);
    D.plane("signs", 0xffffff, 3.6, 0.45, 11.0, 2.5, 3.0, PI, 0, signUV(0)); D.box("glow", 0xffe0b8, 3.4, 0.02, 0.04, 11.0, 2.2, 2.98);
    D.ext("plaster", 0xefe4d2, 8.0, 14.0, 1.1, 1.16, 2.7, 3.24); [8.6, 9.6, 10.6, 11.4, 12.4, 13.4].forEach(function (u, i) { D.cyl("ceramic", [0xe6dccb, 0x8f5a3c, 0x3e4a48][i % 3], 0.1 + (i % 2) * 0.04, 0.07, 0.2 + (i % 3) * 0.12, u, 1.26 + (i % 3) * 0.06, 2.98, 14); }); candleAt(D, 9.1, 1.16, 2.9, 0.12); candleAt(D, 12.9, 1.16, 2.9, 0.16);
    D.ext("oak", 0x7a5a3e, 4.3, 4.85, 0.42, 0.47, -6.8, -1.0); seat(4.57, -3.9, 5.6, 0.5, 0.47, PI / 2, { spaKind: "bench" }); solid(4.57, -3.9, 0.55, 5.8, -0.3, 0.47, 0, { noStep: true });
    D.flat("linen", 0xc4ad8e, 4.6, 6.2, 11.0, 0.035, -8.0); [[9.6, -8.0], [11.0, -8.0], [12.4, -8.0]].forEach(function (q) { D.sph("glass", 0xffffff, 0.2, q[0], 2.6, q[1], 14); D.sph("glow", 0xffd9a6, 0.08, q[0], 2.6, q[1], 8); D.cyl("steel", 0x222222, 0.005, 0.005, 0.95, q[0], 3.1, q[1], 4); }); lamp(11.0, 2.4, -6.5, 0xffd2a0, 2.6, 9, 0.35);
    [[5.0, -12.0], [17.0, -12.0]].forEach(function (q) { D.cyl("ceramic", 0x8f5a3c, 0.3, 0.22, 0.85, q[0], 0.425, q[1], 18); solid(q[0], q[1], 0.6, 0.6, -0.3, 0.85, 0, { noStep: true }); });
    // ── the arrival court: the monument plaque (lit from below at night), bollards, uplights in the olive ring, pergola downlights ──
    D.plane("signs", 0xffffff, 6.4, 0.8, 9.0, 0.98, -34.22, PI, 0, signUV(0)); D.plane("signs", 0xffffff, 6.4, 0.4, 9.0, 0.46, -34.22, PI, 0, [0, 1 - 2 / 8 + 0.02, 1, 1 - 1 / 8 - 0.02]); D.flat("add", 0xffc890, 8.5, 1.6, 9.0, 0.045, -34.8);
    [[4.7, -31.0], [4.7, -26.0], [4.7, -21.0], [4.7, -16.0], [13.6, -16.5], [21.0, -16.5], [26.2, -33.6], [14.5, -33.0]].forEach(function (q) { bollard(D, q[0], q[1], 0.75); });
    [0.5, 2.6, 4.7].forEach(function (a) { uplight(D, 17 + Math.cos(a) * 1.4, -25.5 + Math.sin(a) * 1.4, 4.0); });
    [-31.4, -28.4, -25.4, -22.4, -19.4].forEach(function (v) { D.disc("glow", 0xffe0b0, 0.08, 30.8, 2.78, v, 10); D.flat("add", 0xffbf80, 2.8, 2.8, 30.8, 0.08, v); });
    D.ext("glow", 0xffe2b8, 9.4, 12.6, RHc() - 0.05, RHc() - 0.02, -15.5, -15.4); D.flat("add", 0xffc890, 5.0, 4.0, 11.0, 0.05, -15.0); [[9.0, -14.6], [13.0, -14.6]].forEach(function (q) { D.box("metal", 0x6a4a2c, 0.22, 0.5, 0.22, q[0], RHc() - 0.6, q[1]); D.box("glow", 0xffcf8a, 0.18, 0.3, 0.18, q[0], RHc() - 0.62, q[1]); D.cyl("steel", 0x222222, 0.006, 0.006, 0.35, q[0], RHc() - 0.18, q[1], 4); });
    lamp(17.0, 2.5, -25.5, 0xffd2a8, 3.0, 15, 0); lamp(11.0, 3.0, -15.5, 0xffd2a0, 2.6, 10, 0);
    // ── the walks: lanterns along the north and east walks ──
    [[-40.0, -28.0], [-30.0, -28.0], [-20.0, -28.0], [-10.0, -28.0], [-0.5, -28.0], [-45.5, -21.0], [25.4, 2.0], [25.4, 14.0], [25.4, 26.0], [25.4, 38.0], [-35.2, 26.0]].forEach(function (q) { stoneLantern(D, q[0], q[1]); });
  }
  function RHc() { return L.recepH; }
  // a kit view lifted onto the roof deck (the furniture there is built at deck height)
  function Dk(D, dy) { if (D._dk && D._dk.dy === dy) return D._dk; var o = Object.create(D); o.dy = dy;
    o.place = function (mat, g, col, x, y, z, ry, rx, rz, sx, sy, sz, uv) { return Kit.prototype.place.call(D, mat, g, col, x, (y || 0) + dy, z, ry, rx, rz, sx, sy, sz, uv); };
    o.add = function (mat, g, col, m4, uv) { if (m4) { _v3.setFromMatrixPosition(m4); } var m = new THREE.Matrix4().makeTranslation(0, dy, 0); if (m4) m.multiply(m4); return Kit.prototype.add.call(D, mat, g, col, m, uv); };
    o.ext = function (mat, col, x0, x1, y0, y1, z0, z1) { return Kit.prototype.ext.call(o, mat, col, x0, x1, y0, y1, z0, z1); };
    o.box = function (mat, col, w, h, d, x, y, z, ry, uv) { return Kit.prototype.box.call(o, mat, col, w, h, d, x, y, z, ry, uv); };
    o.cyl = function () { return Kit.prototype.cyl.apply(o, arguments); }; o.sph = function () { return Kit.prototype.sph.apply(o, arguments); }; o.plane = function () { return Kit.prototype.plane.apply(o, arguments); }; o.flat = function () { return Kit.prototype.flat.apply(o, arguments); }; o.disc = function () { return Kit.prototype.disc.apply(o, arguments); }; o.rbox = function () { return Kit.prototype.rbox.apply(o, arguments); };
    o.tube = function (mat, col, A, B, r, seg) { return Kit.prototype.tube.call(D, mat, col, A.clone().setY(A.y + dy), B.clone().setY(B.y + dy), r, seg); };
    D._dk = o; return o; }

  // ───────────────────────── the olives: one procedural tree (gnarled twin trunks, silver-green leaf cards), instanced ─────────────────────────
  function tubeGeo(pts, rad, sides, R) { var pos = [], idx = [], uv = [], n = pts.length, up = V3(0, 1, 0), acc = 0;
    for (var i = 0; i < n; i++) { var p = pts[i], tg = (i < n - 1 ? pts[i + 1].clone().sub(p) : p.clone().sub(pts[i - 1])).normalize(); var ref = Math.abs(tg.y) > 0.9 ? V3(1, 0, 0) : up; var N = ref.clone().cross(tg).normalize(), Bv = tg.clone().cross(N).normalize(); if (i > 0) acc += p.distanceTo(pts[i - 1]);
      for (var s = 0; s <= sides; s++) { var a = s / sides * TAU, lump = 1 + 0.16 * Math.sin(a * 3 + i * 1.7) + 0.08 * Math.sin(a * 5 + i), r = rad[i] * lump; pos.push(p.x + (N.x * Math.cos(a) + Bv.x * Math.sin(a)) * r, p.y + (N.y * Math.cos(a) + Bv.y * Math.sin(a)) * r, p.z + (N.z * Math.cos(a) + Bv.z * Math.sin(a)) * r); uv.push(s / sides * 1.2, acc * 0.9); } }
    for (var j = 0; j < n - 1; j++) for (var k = 0; k < sides; k++) { var a0 = j * (sides + 1) + k, b0 = a0 + sides + 1; idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g; }
  function oliveGeos(seed) { var R = rng(seed), bark = [], leaf = [], tips = [];
    for (var k = 0; k < 3; k++) { var a = k / 3 * TAU + R() * 0.7, lean = 0.2 + R() * 0.12, h = 1.5 + R() * 0.5, pts = [], rad = [];
      for (var i = 0; i <= 6; i++) { var t = i / 6, y = t * h; pts.push(V3(Math.cos(a) * (0.1 + lean * y) + Math.sin(t * 3.1 + k) * 0.09, y, Math.sin(a) * (0.1 + lean * y) + Math.cos(t * 2.6 + k * 2) * 0.08)); rad.push(lerp(0.2, 0.1, t) * (k === 0 ? 1.15 : 1)); }
      bark.push(tubeGeo(pts, rad, 8, R)); var top = pts[6], nb = 2 + (R() < 0.6 ? 1 : 0);
      for (var b = 0; b < nb; b++) { var ba = a + (b - (nb - 1) / 2) * 0.95 + (R() - 0.5) * 0.4, upk = 0.5 + R() * 0.4, len = 1.2 + R() * 0.7, bp = [], br = [];
        for (var j = 0; j <= 4; j++) { var t2 = j / 4; bp.push(V3(top.x + Math.cos(ba) * len * t2 * 0.85, top.y + len * t2 * upk + Math.sin(t2 * PI) * 0.12, top.z + Math.sin(ba) * len * t2 * 0.85)); br.push(lerp(0.095, 0.03, t2)); }
        bark.push(tubeGeo(bp, br, 6, R)); tips.push(bp[4], bp[2]); } }
    var ctr = V3(0, 0, 0); tips.forEach(function (p) { ctr.add(p); }); ctr.multiplyScalar(1 / tips.length);
    tips.forEach(function (tp) { var rx = 0.85 + R() * 0.35, ry = 0.5 + R() * 0.2; for (var i = 0; i < 46; i++) { var u = R() * 2 - 1, v = R() * 2 - 1, w = R() * 2 - 1; if (u * u + v * v + w * w > 1) { i--; continue; }
        var p = V3(tp.x + u * rx, tp.y + 0.2 + v * ry, tp.z + w * rx), g = new THREE.PlaneGeometry(0.7, 0.5); _e.set(R() * PI, R() * TAU, R() * PI, "YXZ"); _q.setFromEuler(_e); _m4.compose(p, _q, _s1); g.applyMatrix4(_m4); g = g.toNonIndexed();
        var dd = p.clone().sub(ctr), sh = clamp(0.62 + 0.3 * (dd.length() / 2.2) + 0.1 * v, 0.55, 1.08), tint = 0.92 + R() * 0.16, ca = new Float32Array(g.attributes.position.count * 3); for (var c = 0; c < ca.length; c += 3) { ca[c] = sh * tint; ca[c + 1] = sh * (0.98 + R() * 0.04); ca[c + 2] = sh * tint * 0.94; } g.setAttribute("color", new THREE.BufferAttribute(ca, 3)); leaf.push(g); } });
    var mb = function (list) { var nn = list.map(function (g) { return g.index ? g.toNonIndexed() : g; }); var r = mergeAll(nn.map(function (g) { if (!g.attributes.color) { var ca = new Float32Array(g.attributes.position.count * 3).fill(1); g.setAttribute("color", new THREE.BufferAttribute(ca, 3)); } if (!g.attributes.normal) g.computeVertexNormals(); return g; })); return r; };
    return { bark: mb(bark), leaf: mb(leaf) }; }
  function buildOlives(grp) { var M = mats(), G0 = oliveGeos(424242), list = L.olives, n = list.length, R = rng(77);
    var bm = new THREE.InstancedMesh(G0.bark, M.bark, n), lm = new THREE.InstancedMesh(G0.leaf, M.leaf, n); bm.name = "sp olive bark"; lm.name = "sp olive leaves";
    list.forEach(function (o, i) { var y = o[3] !== undefined ? o[3] : o[0] === 17 ? 0.46 : 0.03; _e.set(0, R() * TAU, 0); _q.setFromEuler(_e); var s = o[2] || 1; _m4.compose(_v1.set(o[0], y, o[1]), _q, _v2.set(s, s * (0.92 + R() * 0.16), s)); bm.setMatrixAt(i, _m4); lm.setMatrixAt(i, _m4); });
    [bm, lm].forEach(function (m) { m.castShadow = true; m.userData.spCast = true; m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); m.userData.spa = true; grp.add(m); });
    // trunks are solid (a small circle each)
    list.forEach(function (o) { if (o[3] !== undefined && o[3] > 1) return; var w = l2w(o[0], o[1]); COLLIDERS.push([w[0], w[1], 0.35 * (o[2] || 1)]); });
    SP.n.oliveTris = Math.round((G0.bark.attributes.position.count + G0.leaf.attributes.position.count) / 3); return [bm, lm]; }

  // ───────────────────────── steam (one points draw): over every tub, and the steam room's cloud ─────────────────────────
  function buildSteam(grp) { var src = STEAM.src, n = 0; src.forEach(function (s) { n += s.n; }); if (!n) return null; var pos = new Float32Array(n * 3), col = new Float32Array(n * 3), R = rng(5150), P = STEAM.p = [];
    src.forEach(function (s) { for (var i = 0; i < s.n; i++) { var a = R() * TAU, r = Math.sqrt(R()) * s.r; P.push({ u: s.u + Math.cos(a) * r, v: s.v + Math.sin(a) * r, y0: s.y, h: s.h || 1.4, ph: R(), sp: (s.kind === "room" ? 0.05 : 0.12) + R() * 0.06, k: s.kind === "room" ? 0.5 : 0.36, room: s.kind === "room" }); } });
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3)); g.boundingSphere = new THREE.Sphere(V3(-8, 1, 28), 40);
    var pts = new THREE.Points(g, mats().steam); pts.name = "sp steam"; pts.frustumCulled = true; pts.renderOrder = 4; pts.userData.spa = true; grp.add(pts); STEAM.obj = pts; return pts; }
  function steamFrame(dt, n) { var o = STEAM.obj; if (!o || !o.visible) return; var t = (STEAM.t = (STEAM.t || 0) + dt), pa = o.geometry.attributes.position, ca = o.geometry.attributes.color, P = STEAM.p, day = 1 - n;
    for (var i = 0; i < P.length; i++) { var p = P[i], f = (t * p.sp / p.h + p.ph) % 1, y = p.y0 + f * p.h, k = Math.sin(f * PI) * p.k * (p.room ? 1 : (0.55 + 0.45 * n + 0.25 * day)); pa.setXYZ(i, p.u + Math.sin(t * 0.3 + i) * 0.15 * f, y, p.v + Math.cos(t * 0.25 + i) * 0.15 * f); ca.setXYZ(i, k, k, k * 0.97); }
    pa.needsUpdate = true; ca.needsUpdate = true; }

  // ───────────────────────── the build (defer): two merged groups, the olives, the steam, the light sources ─────────────────────────
  var GR = SP.gr = SP.gr || {};
  function buildAll() {
    site(); var t0 = nowMs(), M = mats(), K = new Kit("shell"), D = new Kit("detail");
    STEAM.src.length = 0; SRCS.length = 0; GLOWS.length = 0;
    buildShell(K, D); var t1 = nowMs(); buildDetail(D); var t2 = nowMs();
    var g0 = new THREE.Group(); g0.name = "spa_exterior"; g0.position.set(S.ox, S.G, S.oz); g0.rotation.y = S.yaw; g0.userData.spa = true;
    var g1 = new THREE.Group(); g1.name = "spa_detail"; g1.position.copy(g0.position); g1.rotation.y = S.yaw; g1.userData.spa = true;
    SP.n.shellTris = Math.round(K.tris); SP.n.detailTris = Math.round(D.tris);
    K.build(g0, { cast: ["earth", "charred", "roof", "dark", "steel"] }); D.build(g1, { cast: ["oak", "linen", "earth", "charred"] });
    try { buildOlives(g1); } catch (e) { note("olives", e); }
    try { buildSteam(g1); } catch (e) { note("steam", e); }
    // light sources the client's fixed pool mirrors (8 point lights near the camera); none of these is drawn by itself
    GR.lights = []; SRCS.forEach(function (q) { var l = new THREE.PointLight(q.col, 0, q.d, 1.4); l.position.set(q.u, q.y, q.v); l.userData.q = q; g0.add(l); GR.lights.push(l); });
    scene.add(g0); scene.add(g1); g0.updateMatrixWorld(true); g1.updateMatrixWorld(true); GR.shell = g0; GR.detail = g1;
    try { LIGHTS.dirty = true; } catch (e) {} try { collectLights(); } catch (e) {}
    SP.t.shell = Math.round(t1 - t0); SP.t.detail = Math.round(t2 - t1); SP.t.build = Math.round(nowMs() - t0); SP.n.solids = SOL.length; SP.n.lights = GR.lights.length;
    var mc = 0; GR.meshes = []; [g0, g1].forEach(function (g) { g.traverse(function (o) { if (o.isMesh || o.isPoints) { mc++; if (o.isMesh) GR.meshes.push(o); } }); }); SP.n.meshes = mc; }
  // indoor boxes for the patch (lounge, reception, the treatment row, the bath row)
  function setBoxes() { var U = makeU(), list = [[-41.75, -28.25, -11.75, 9.75, 4.18], [4.25, 17.75, -12.75, 3.25, 3.58], [-27.75, -0.25, -19.25, -12.25, 3.28], [-27.75, 3.75, 12.25, 22.25, 3.28]];
    list.forEach(function (b, i) { U.uSpB.value[i].set((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[1] - b[0]) / 2, (b[3] - b[2]) / 2); U.uSpH.value[i].set(b[4], 0, 0, 0); }); }

  // ───────────────────────── people: three staff with talk cards, a few guests who roam (PLAN_ROAM) ─────────────────────────
  var STAFF = SP.staff = SP.staff || { list: [] };
  function buildStaff() {
    var ST = C("staff", null); if (!ST || typeof avatar !== "function" || STAFF.done) return; if (lotDist(player.position.x, player.position.z) > 170) return; STAFF.done = true;
    Object.keys(ST).forEach(function (id) { var A = ST[id]; if (CAST.some(function (c) { return c.id === id; })) return; var at = A.at || [11, -2.4], w = l2w(at[0], at[1]);
      var g = avatar("sp_" + id, A.name, A.look || {}, A.hat || null, A.outfit || null); g.position.set(w[0], S.G + 0.03, w[1]); g.rotation.y = wyaw(A.face || 0); try { g.userData.label.scale.set(1.7, 0.43, 1); } catch (e) {} scene.add(g);
      var talk = (A.talk || []).map(function (q) { return { t: q.t, o: q.o }; }); var c = { id: id, name: A.name, role: A.role, pos: [w[0], w[1]], look: A.look, hat: null, outfit: null, greet: A.greet || ["Welcome."], talk: talk, kw: [], g: g, rot: g.rotation.y };
      CAST.push(c); var hs = { x: w[0], z: w[1], r: 3.0, t: c.name, k: c.role + " · press E to talk", p: talk[0] ? talk[0].t : "", play: "npc:" + c.id, spa: "staff" }; hotspots.push(hs); STAFF.list.push(c); });
    SP.n.staff = STAFF.list.length; }
  function staffFrame(dt) { var cam = camera.position; STAFF.list.forEach(function (c) { var dd = Math.hypot(c.g.position.x - cam.x, c.g.position.z - cam.z); c.g.visible = dd < 90; if (c.g.visible && (FRAME_N & 1) === 0) try { animateWalk(c.g, 0, dt * 2); } catch (e) {} }); }
  function roamArea() {
    var RO = window.PLAN_ROAM; if (!RO || !RO.area || RO.off || SP.roamArea || SP.noRoam) return; var RC = C("roam", {}); if (!RC || !RC.people) return;
    var P = lotPoly(S.lot, 0), bx = [1e9, 1e9, -1e9, -1e9]; P.forEach(function (q) { bx[0] = Math.min(bx[0], q[0]); bx[1] = Math.min(bx[1], q[1]); bx[2] = Math.max(bx[2], q[0]); bx[3] = Math.max(bx[3], q[1]); });
    var Pt = function (u, v, kind, line, psi, tag, dur) { var w = l2w(u, v); return { kind: kind, line: line, x: w[0], z: w[1], face: wyaw(psi), tag: tag, dur: dur }; };
    var def = { id: "spa", max: 5, box: bx, perCat: true, pull: 3, people: RC.people.slice(), lines: RC.lines || {},
      ready: function () { return !!SP.ready; },
      levels: [{ base: function (x, z) { return inLot(x, z, 0.5) ? S.G + 0.03 : planGroundAt(x, z); }, exact: true, block: function (x, z) { var q = w2l(x, z), u = q[0], v = q[1]; if (!inRect(u, v, S.pad, -0.6)) return true;
        if (u > -42.6 && u < -27.4 && v > -15.4 && v < -12.9) return true;   // the roof stair
        if (Math.abs(v) < 0.75 && u > -27.2 && u < 3.2 && !(u > -14.1 && u < -12.5)) return true;   // the runnel (the bridge crosses it)
        for (var i = 0; i < L.tubs.length; i++) if (Math.hypot(u - L.tubs[i][0], v - L.tubs[i][1]) < 1.6) return true; return false; } }],
      entries: function () { return [Pt(19, -33.5, "", "", PI, "court"), Pt(-49.2, 18.8, "", "", PI / 2, "west"), Pt(24, 41.2, "", "", PI, "south")]; },
      seeds: function () { return def.entries().concat([Pt(-13.3, 1.2), Pt(10, -9), Pt(-36, 0), Pt(-5, 30)]); },
      pois: function () { var o = [], ps = psun();
        o.push(Pt(0.4, 2.2, "look", "water", -PI / 2 + 0.5, "wall", [10, 20])); o.push(Pt(0.4, -2.2, "look", "water", -PI / 2 - 0.5, "wall", [10, 20])); o.push(Pt(-13.3, 0.9, "look", "water", -PI / 2, "bridge", [8, 16]));
        o.push(Pt(-46.2, 0.0, "look", "view", ps, "terrace", [14, 28])); o.push(Pt(-45.2, 18.4, "look", "view", ps, "terrace", [14, 28])); o.push(Pt(-39.0, 2.0, "look", "lounge", ps, "lounge", [10, 22]));
        o.push(Pt(-16.5, 27.5, "look", "garden", PI / 2, "garden", [10, 20])); o.push(Pt(-7.8, 31.0, "look", "garden", -PI / 2, "garden", [10, 20])); o.push(Pt(9.0, 21.0, "look", "garden", 0, "quiet", [10, 20]));
        SOL.forEach(function (sd) { if (!sd.seat || sd.lie !== 1 || sd.y1 > S.G + 1.2) return; var q = w2l(sd.x, sd.z), f = sd.face - S.yaw, sx = Math.cos(f), sz = -Math.sin(f);   // the lounger's local side axis
          for (var k = 0; k < 2; k++) { var sg = k ? -1 : 1, au = q[0] + sx * 0.95 * sg, av = q[1] + sz * 0.95 * sg, w = l2w(au, av); if (!inRect(au, av, S.pad, -0.8)) continue; var lq = q; o.push({ kind: "sit", line: lq[1] > 22 ? "garden" : lq[0] > -41.5 && lq[0] < -28 && lq[1] < 10 ? "lounge" : "view", x: w[0], z: w[1], face: sd.face, sitAt: [sd.x, sd.y1, sd.z], seat: sd, back: 0.27, tag: "lounger", dur: [35, 80] }); break; } });
        o.push(Pt(11.0, -6.5, "browse", "reception", 0, "desk", [8, 14])); o.push(Pt(-12.0, -8.6, "chat", "court", 0, "cloister", [12, 24])); o.push(Pt(-12.0, 8.6, "chat", "court", PI, "cloister", [12, 24])); o.push(Pt(17.0, -20.4, "chat", "arrival", 0, "court", [10, 20]));
        return o; },
      seatInfo: function (s) { if (!s.spa || s.tub !== undefined || s.table !== undefined || s.bath || s.spaKind === "wall" || s.spaKind === "roofbench" || s.y1 > S.G + 1.2) return null; if (s.lie) return null; return { kind: "sit", line: s.fire ? "fire" : "sit", tag: s.spaKind || "seat" }; },
      weight: function (p, h) { var k = p.kind, t = p.tag || ""; if (h < 7 || h > 22) return k === "sit" ? 0.5 : t === "terrace" || t === "wall" ? 0.8 : 0.15; if ((t === "terrace" || t === "lounger") && h >= 16 && h <= 19) return 2.6; if (t === "lounger") return 1.3; if (k === "sit") return 1.0; if (t === "wall" || t === "bridge") return 1.4; return 1.0; },
      count: function (h) { return h < 7 || h > 22 ? 2 : h > 9 && h < 19 ? 5 : 3; },
      dur: { sit: [30, 70], chat: [14, 30], look: [10, 22], browse: [8, 16] },
      visible: function (c) { return true; }, sameZone: function (c) { return true; } };
    try { SP.roamArea = RO.area(def); } catch (e) { note("roam", e); SP.noRoam = true; } }

  // ───────────────────────── interactions: lie back (a recline pose), the treatment (a fade), soaking, the fire, stars ─────────────────────────
  function busy() { try { return (typeof riding !== "undefined" && riding) || (typeof inside !== "undefined" && inside) || (typeof DANCE !== "undefined" && DANCE.on) || (typeof FLY !== "undefined" && FLY.on) || (typeof golf !== "undefined" && golf.playing) || (typeof cartMode !== "undefined" && cartMode); } catch (e) { return false; } }
  function stamp(id) { try { var PP = window.PLAN_PROGRESS; if (PP && PP.award && id) { PP.award("stamp", { id: id }); cnt("stamp_" + id); } } catch (e) {} }
  function STID(k, d) { return C("stamps." + k, d); }
  var OV = SP.ov = SP.ov || { done: false };
  function installOverrides() {
    if (OV.done) return; OV.done = true;
    try { var on = openNearest; openNearest = function () { try { if (handleE()) return; } catch (e) { note("E", e); } return on.apply(this, arguments); }; OV.openNearest = true; } catch (e) { note("ov openNearest", e); }
    try { var sd0 = sitDown; sitDown = function (sd) { var r = sd0.apply(this, arguments); try { SP.sat = sd && sd.spa ? sd : null; if (SP.sat) onSat(sd); } catch (e) { note("sat", e); } return r; }; OV.sitDown = true; } catch (e) { note("ov sitDown", e); }
  }
  function nearestTable() { var best = null, bd = 1.7, px = player.position.x, pz = player.position.z; for (var i = 0; i < SOL.length; i++) { var s = SOL[i]; if (s.table === undefined || !s.seat) continue; var d = Math.hypot(s.x - px, s.z - pz); if (d < bd) { bd = d; best = s; } } return best; }
  function handleE() { if (SP.off || !SP.ready) return false; if (TR.on) return true; if (typeof SIT !== "undefined" && SIT.on) return false; if (busy()) return false; var t = nearestTable(); if (t) { startTreatment(t); return true; } return false; }
  function onSat(sd) { var k = sd.spaKind || ""; var msg = C("status." + k, null);
    if (sd.lie === 1) msg = msg || C("status.lie", "lying back · any move key to get up");
    if (sd.tub !== undefined || sd.bath) stamp(STID("soak", "p_sp_soak"));
    var w = w2l(sd.x, sd.z); if (sd.fire || Math.hypot(w[0] + 42.6, w[1] - 15.6) < 4.2 || Math.hypot(w[0] + 35.0, w[1] + 10.8) < 4.8) stamp(STID("fire", "p_sp_fire"));
    if (sd.lie === 1 && sd.y1 > S.G + L.deck) { stamp(STID("stars", "p_sp_stars")); msg = C(nightK() > 0.5 ? "status.stars" : "status.sunset", msg); }
    if (msg) try { setStatus(msg); } catch (e) {} }
  // the recline: the sit clip, turned back about the hips; thighs, knees and arms laid along the lounger (world-space bone turns)
  var PO = SP.pose = SP.pose || { on: 0, th1: 1.4, th2: 2.0, leg1: 1.3, leg2: 2.1, knee1: -1.2, knee2: -1.45, arm1: 0.9, arm2: 1.9, n: 0 };
  var _pq = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _hp = new THREE.Vector3(), _sx = new THREE.Vector3();
  function bonesOf(g) { var u = g.userData; if (u.spaBones && u.spaBones.root === u.walk) return u.spaBones; var B = { root: u.walk, q: {} }; if (u.walk) u.walk.traverse(function (o) { if (o.isBone && !B[o.name]) B[o.name] = o; }); u.spaBones = B; return B; }
  function rotW(B, n, axis, ang) { var b = B[n]; if (!b || !b.parent) return; var last = B.q[n]; if (last && b.quaternion.equals(last)) return; b.parent.getWorldQuaternion(_pq); _q1.setFromAxisAngle(axis, ang); _q2.copy(_pq).invert(); b.quaternion.premultiply(_pq).premultiply(_q1).premultiply(_q2); b.updateMatrixWorld(true); (B.q[n] = B.q[n] || new THREE.Quaternion()).copy(b.quaternion); }
  // one avatar's recline: g the avatar group, want 0 (none), 1 (a lounger), 2 (flat); st its state; seated tells a stand-up from a seat change
  function lieAv(g, want, st, seated) {
    var w = g.userData.walk; if (!w) return;
    if (!want) { if (st.on) { w.rotation.x = 0; if (st.base && seated) w.position.copy(st.base); st.on = 0; st.base = null; } return; }   // standing up: the sitClear already put the body back
    if (st.on !== want || !st.base) { st.on = want; st.base = w.position.clone(); st.n = 0; st.hp = null; }
    var B = bonesOf(g), th = want === 2 ? PO.th2 : PO.th1;
    if (st.n < 40 || !st.hp) { w.rotation.x = 0; w.position.copy(st.base); g.updateMatrixWorld(true); if (B.Hips) { B.Hips.getWorldPosition(_hp); st.hp = g.worldToLocal(_hp.clone()); } else st.hp = V3(0, 0.1, -0.1); }
    st.n++; var hp = st.hp, c = Math.cos(-th), s = Math.sin(-th), py = st.base.y - hp.y, pz = st.base.z - hp.z;
    w.position.set(st.base.x, hp.y + py * c - pz * s, hp.z + py * s + pz * c); w.rotation.x = -th; g.updateMatrixWorld(true);
    _sx.set(1, 0, 0).applyQuaternion(g.quaternion).normalize();
    var la = want === 2 ? PO.leg2 : PO.leg1, ka = want === 2 ? PO.knee2 : PO.knee1, aa = want === 2 ? PO.arm2 : PO.arm1;
    rotW(B, "LeftUpLeg", _sx, la); rotW(B, "RightUpLeg", _sx, la); rotW(B, "LeftLeg", _sx, ka); rotW(B, "RightLeg", _sx, ka); rotW(B, "LeftArm", _sx, aa); rotW(B, "RightArm", _sx, aa); }
  function poseFrame() {
    if (!player || !player.userData.walk) return; var sd = SP.sat, on = typeof SIT !== "undefined" && SIT.on, want = (on && sd && sd.lie) ? sd.lie : 0;
    lieAv(player, want, PO, on); if (!on) SP.sat = null;
    // the guests who chose a lounger or a daybed lie back on it too (the roam engine seats them with the sit clip)
    try { var A = window.PLAN_ROAM && PLAN_ROAM.A && PLAN_ROAM.A.spa; if (A && A.npcs) for (var i = 0; i < A.npcs.length; i++) { var c = A.npcs[i], g = c && c.g; if (!g) continue; var u = g.userData, ss = c.at && c.at.seat, wn = u.sit && ss && ss.lie === 1 && g.parent && g.visible ? 1 : 0; if (!wn && !u.spPose) continue; var st = u.spPose || (u.spPose = { on: 0 }); lieAv(g, wn, st, !!u.sit); if (!wn && !st.on) u.spPose = null; } } catch (e) { note("npc lie", e); } }
  // the treatment: a slow fade, two lines of the ritual, the stamp; you wake up lying on the table
  var TR = SP.tr = SP.tr || { on: false };
  function capEl() { var el = $id("sp-cap"); if (el) return el; el = document.createElement("div"); el.id = "sp-cap"; el.style.cssText = "position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;z-index:16;opacity:0;transition:opacity .9s;color:#f3e6d0;text-align:center;font-family:Fraunces,Georgia,serif;";
    el.innerHTML = "<div id='sp-cap-k' style='font:500 13px \"JetBrains Mono\",monospace;letter-spacing:.32em;color:#c9a276;margin-bottom:14px'></div><div id='sp-cap-t' style='font-style:italic;font-weight:300;font-size:34px;max-width:760px;line-height:1.3'></div><div id='sp-cap-p' style='font:400 15px \"Space Grotesk\",sans-serif;color:#d9c9ae;margin-top:16px;max-width:620px;line-height:1.5'></div>"; document.body.appendChild(el); return el; }
  function cap(k, t, p) { var el = capEl(); $id("sp-cap-k").textContent = k || ""; $id("sp-cap-t").textContent = t || ""; $id("sp-cap-p").textContent = p || ""; el.style.opacity = t ? 1 : 0; }
  function startTreatment(sd) { if (TR.on) return; var T0 = C("treatment", {}) || {}; TR.on = true; TR.t0 = nowMs(); TR.sd = sd; TR.phase = 0; TR.copy = T0;
    var f = $id("fade"); TR.f = f; if (f) { TR.tr0 = f.style.transition; f.style.transition = "opacity 1.4s"; f.style.opacity = 1; } try { closeCards(); } catch (e) {} cnt("treatments"); }
  function trFrame() { if (!TR.on) return; var t = (nowMs() - TR.t0) / 1000, T0 = TR.copy || {};
    if (TR.phase === 0 && t > 1.5) { TR.phase = 1; try { if (typeof standUp === "function" && SIT.on) standUp(); sitDown(TR.sd); } catch (e) { note("tr sit", e); } cap(T0.k || "ATARDECER", T0.t1 || "A desert stone ritual", T0.p1 || "Warm basalt stones, sage and juniper oil, and a long, unhurried hour of quiet."); }
    if (TR.phase === 1 && t > 5.4) { TR.phase = 2; cap(T0.k || "ATARDECER", T0.t2 || "Breathe out", T0.p2 || "The water wall runs on outside. Nothing else needs you right now."); }
    if (TR.phase === 2 && t > 9.0) { TR.phase = 3; cap("", "", ""); if (TR.f) TR.f.style.opacity = 0; stamp(STID("treatment", "p_sp_treatment")); try { setStatus(T0.status || "rested and warm · any move key to get up"); } catch (e) {} }
    if (TR.phase === 3 && t > 10.6) { TR.on = false; if (TR.f) TR.f.style.transition = TR.tr0 || ""; } }
  function promptFrame() { try { if (TR.on || busy() || (typeof SIT !== "undefined" && SIT.on)) return; var t = nearestTable(); if (!t) return; var el = $id("prompt"), tt = $id("prompt-t"); if (!el || !tt) return; tt.innerHTML = "<b>E</b> &nbsp;" + esc(C("prompts.treatment", "lie down for a treatment")); el.classList.add("on"); } catch (e) { note("prompt", e); } }

  // ───────────────────────── the camera in the rooms: kept inside the walls and under the ceiling, first person when tight ─────────────────────────
  var FR = SP.fr = SP.fr || { inCam: false };
  function camHook(dt) {
    if (SP.off || !SP.ready || window.__cam) return false;
    try { if (busy() || (typeof SIT !== "undefined" && SIT.on && !(SP.sat && SP.sat.spa))) { FR.inCam = false; return false; }
      var px = player.position.x, py = player.position.y, pz = player.position.z, q = w2l(px, pz), R0 = roomAt(q[0], q[1], py - S.G + 0.5);
      if (!R0) { if (FR.inCam) { FR.inCam = false; try { player.userData.walk.visible = true; } catch (e) {} } return false; }
      FR.inCam = true; var inR = function (x, y, z) { var l = w2l(x, z); return l[0] > R0.r[0] + 0.25 && l[0] < R0.r[1] - 0.25 && l[1] > R0.r[2] + 0.25 && l[1] < R0.r[3] - 0.25 && y < S.G + R0.h - 0.25; };
      var fwd = [-Math.sin(yaw), -Math.cos(yaw)], by = typeof bobY === "number" ? bobY : 0, cy0 = py - by + 1.75, maxD = 5.5, dist = 0;
      for (var d = 0.2; d <= maxD; d += 0.2) { var cx = px - fwd[0] * d, cz = pz - fwd[1] * d; if (!inR(cx, cy0 + d * 0.12, cz)) break; dist = d; }
      if (FR.fp === undefined) FR.fp = dist < 1.2; else if (FR.fp && dist > 2.0) FR.fp = false; else if (!FR.fp && dist < 1.0) FR.fp = true;
      CAM.dist += (dist - CAM.dist) * smoothK(dt, 10); var sdd = Math.min(dist, CAM.dist);
      if (FR.fp) { camera.position.set(px, py - by + 1.62, pz); CAM.init = false; camera.lookAt(px + fwd[0] * 10, camera.position.y - pitch * 6, pz + fwd[1] * 10); player.userData.walk.visible = false; }
      else { var cy = Math.min(cy0 + pitch * 1.2 + sdd * 0.12, S.G + R0.h - 0.35); camera.position.lerp(camTarget.set(px - fwd[0] * sdd, cy, pz - fwd[1] * sdd), smoothK(dt, 24)); camLook(px, py + 1.3, pz, dt, 30); player.userData.walk.visible = true; }
      return true; } catch (e) { note("cam", e); return false; } }

  // ───────────────────────── ambience: running water and a few soft chimes, through the client's audio context ─────────────────────────
  var AU = SP.au = SP.au || {};
  var SRC_U = [[2.6, 0], [-12, 0], [-24, 0], [-8, 31], [-35, -10]];
  function audioFrame(dt) {
    try { var ok = typeof soundOn !== "undefined" && soundOn && typeof audioReady !== "undefined" && audioReady && !/[?&]spau=0\b/.test(Q); var cam = camera.position, q = w2l(cam.x, cam.z), d = 1e9;
      for (var i = 0; i < SRC_U.length; i++) d = Math.min(d, Math.hypot(q[0] - SRC_U[i][0], q[1] - SRC_U[i][1])); var vol = (typeof VOL !== "undefined" ? VOL.amb * VOL.master : 1);
      var k = ok ? clamp(1 - (d - 3) / 42, 0, 1) * 0.3 * vol : 0; if (!AU.g && k <= 0.001) return;
      var c = actx(); if (!AU.g) { var len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), ch = buf.getChannelData(0), b0 = 0, b1 = 0; for (var j = 0; j < len; j++) { var wn = Math.random() * 2 - 1; b0 = 0.97 * b0 + wn * 0.3; b1 = 0.7 * b1 + wn * 0.5; ch[j] = (b0 * 0.6 + b1 * 0.4) * 0.5; }
        var src = c.createBufferSource(); src.buffer = buf; src.loop = true; var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 820; bp.Q.value = 0.55; var lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600; var g = c.createGain(); g.gain.value = 0;
        src.connect(bp).connect(lp).connect(g).connect(c.destination); src.start(); AU.g = g; AU.bp = bp; AU.next = c.currentTime + 4; }
      AU.g.gain.setTargetAtTime(k, c.currentTime, 0.6); AU.bp.frequency.setTargetAtTime(760 + 120 * Math.sin(c.currentTime * 0.31), c.currentTime, 1.5);
      if (k > 0.03 && c.currentTime > AU.next) { AU.next = c.currentTime + 7 + Math.random() * 9; var notes = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]; var nn = 1 + Math.floor(Math.random() * 3);
        for (var m = 0; m < nn; m++) { var f = notes[Math.floor(Math.random() * notes.length)], t0 = c.currentTime + m * (0.35 + Math.random() * 0.4), o = c.createOscillator(), gg = c.createGain(); o.type = "sine"; o.frequency.value = f; gg.gain.setValueAtTime(0.0001, t0); gg.gain.exponentialRampToValueAtTime(k * 0.18, t0 + 0.02); gg.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.2); o.connect(gg).connect(c.destination); o.start(t0); o.stop(t0 + 3.3); } } } catch (e) { note("audio", e); AU.dead = true; } }

  // ───────────────────────── defer hook: the build, the indoor boxes, the near-pebble guard, the warm-up ─────────────────────────
  function nearBlock() { try { if (typeof NEAR === "undefined" || !NEAR.blocked || NEAR.blocked.spa) return; var b0 = NEAR.blocked; var f = function (x, z) { return inLot(x, z, 1.0) || b0(x, z); }; f.spa = true; NEAR.blocked = f; NEAR.at = [1e9, 1e9]; cnt("nearWrap"); } catch (e) { note("near", e); } }
  function deferHook() {
    if (SP.off || !window.PLAN) return; site(); var t0 = nowMs();
    try { setBoxes(); buildAll(); } catch (e) { note("build", e); }
    nearBlock(); installOverrides();
    try { var W = window.PLAN_PERF; if (W && W.warmGroup) { if (GR.shell) W.warmGroup(GR.shell, { name: "spa exterior" }); if (GR.detail) W.warmGroup(GR.detail, { name: "spa detail" }); } } catch (e) { note("warm", e); }
    SP.t.defer = Math.round(nowMs() - t0); SP.ready = true; }

  // ───────────────────────── every frame ─────────────────────────
  var LV = SP.lv = SP.lv || { f: 0, wt: 0 };
  function frameHook(dt, now) {
    if (SP.off || !SP.ready) return; dt = Math.min(dt || 0.016, 0.1); LV.f++;
    try {
      var M = MX, n = clamp((nightK() - 0.02) * 3.2, 0, 1), cam = camera.position, dc = lotDist(cam.x, cam.z), dp = lotDist(player.position.x, player.position.z), near = dc < 160;
      if (GR.detail && (LV.f % 10) === 0) GR.detail.visible = dc < 170;
      if (near) {
        LV.wt += dt; if (M.water && M.water.normalMap) M.water.normalMap.offset.set(LV.wt * 0.016, LV.wt * 0.011); if (M.sheet && M.sheet.normalMap) M.sheet.normalMap.offset.set(0, LV.wt * 0.42); if (M.tub && M.tub.normalMap) M.tub.normalMap.offset.set(LV.wt * 0.03, -LV.wt * 0.02);
        var fl = 0.82 + 0.12 * Math.sin(now * 0.011) + 0.08 * Math.sin(now * 0.027 + 1.3); if (M.flame) M.flame.opacity = fl;
        if ((LV.f % 4) === 0) { M.glow.color.setScalar(0.42 + 0.58 * n); M.add.opacity = n; SPU.uSpK.value.y = 0.03 + 0.14 * n; }
        steamFrame(dt, n); poseFrame(); trFrame(); promptFrame(); staffFrame(dt);
      }
      // the light sources (the pool takes the nearest): outdoor ones after dark, indoor ones partly by day; the fires flicker
      if (GR.lights && (LV.f % 2) === 0) for (var i = 0; i < GR.lights.length; i++) { var l = GR.lights[i], q = l.userData.q, k = dc < 140 ? q.k * Math.max(n, q.day) : 0; if (q.flick && k) k *= 0.82 + 0.1 * Math.sin(now * 0.013 + i) + 0.08 * Math.sin(now * 0.031 + i * 2.1); l.intensity = k; }
      if ((LV.f % 180) === 7 && GR.meshes) { var ch = 0; for (var mi = 0; mi < GR.meshes.length; mi++) { var mm = GR.meshes[mi], want = !!mm.userData.spCast; if (mm.castShadow !== want) { mm.castShadow = want; ch++; } } if (ch) { cnt("castFix", ch); try { renderer.shadowMap.needsUpdate = true; } catch (e) {} } }
      if (now > (LV.slow || 0)) { LV.slow = now + 1500; try { buildStaff(); } catch (e) { note("staff", e); } try { if (dp < 400) roamArea(); } catch (e) { note("roam", e); } nearBlock(); try { roamShare(dp); } catch (e) { note("roam share", e); } }
      // the court stamp: through the reception into the Olive Court
      if (!LV.court && dp < 1) { var pq = w2l(player.position.x, player.position.z); if (inRect(pq[0], pq[1], L.court, 0)) { LV.court = true; stamp(STID("court", "p_sp_court")); } }
      if (near || AU.g) audioFrame(dt);
    } catch (e) { note("frame", e); } }

  // R17: seven venues now share the roam engine's pool of 22 people, and the areas within 420 m of the camera keep theirs; standing
  // in the spa, its neighbours (Mercado, the sports club, the museum, the library, fill B) can hold all 22. While the player is in the
  // lot and the spa has under three guests with the pool full, the cap goes up by at most three (once): see HANDOFF_R17_SPA.md 9.
  function roamShare(dp) { var RO = window.PLAN_ROAM; if (!RO || !RO.A || dp > 25) return; var A = RO.A.spa; if (!A || A.st !== "ready" || !A.on || A.npcs.length >= 3) return;
    var built = (RO.n && RO.n.built) || 0, cap = RO.maxBuilt || 22; if (built < cap) return; if ((SP.n.roamBump || 0) >= 3) return; var add = Math.min(3 - A.npcs.length, 3 - (SP.n.roamBump || 0)); if (add <= 0) return;
    RO.maxBuilt = cap + add; SP.n.roamBump = (SP.n.roamBump || 0) + add; SP.n.roamCap = RO.maxBuilt; }
  // ───────────────────────── API, debug, hooks ─────────────────────────
  SP.api = { site: site, l2w: l2w, w2l: w2l, wyaw: wyaw, roomAt: roomAt, psun: psun, stamp: stamp };
  SP.debug = {
    cam: function (u, y, v, tu, ty, tv, fov) { var a = l2w(u, v), b = l2w(tu, tv); window.__cam = [a[0], S.G + y, a[1], b[0], S.G + ty, b[1], fov || 0]; try { updateCulling(true); } catch (e) {} return window.__cam; },
    at: function (u, v, psi, y) { var w = l2w(u, v); try { if (SIT.on) standUp(); } catch (e) {} player.position.set(w[0], S.G + (y || 0.03), w[1]); if (psi !== undefined) { player.rotation.y = wyaw(psi); yaw = wyaw(psi) + PI; } try { updateCulling(true); } catch (e) {} return [Math.round(w[0] * 10) / 10, Math.round(w[1] * 10) / 10]; },
    sit: function (kind, i) { var list = SOL.filter(function (s) { return s.seat && (!kind || s.spaKind === kind); }); var s = list[i || 0]; if (!s) return null; try { if (SIT.on) standUp(); } catch (e) {} player.position.set(s.x, s.y1, s.z); sitDown(s); return { kind: s.spaKind, x: s.x, z: s.z, y1: s.y1, n: list.length }; },
    treat: function (i) { var t = SOL.filter(function (s) { return s.table !== undefined && s.seat; })[i || 0]; if (!t) return null; player.position.set(t.x, S.G, t.z); startTreatment(t); return true; },
    rebuild: function () { [GR.shell, GR.detail].forEach(function (g) { if (!g) return; scene.remove(g); g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }); for (var i = SOLIDS.length - 1; i >= 0; i--) if (SOLIDS[i].spa) SOLIDS.splice(i, 1); SOL.length = 0; buildAll(); return SP.n; },
    counts: function () { var o = {}; [["shell", GR.shell], ["detail", GR.detail]].forEach(function (q) { if (!q[1]) return; var m = 0, tr = 0; q[1].traverse(function (x) { if (x.isMesh) { m++; var gi = x.geometry, c0 = gi.index ? gi.index.count : gi.attributes.position.count; tr += (x.isInstancedMesh ? x.count : 1) * c0 / 3; } }); o[q[0]] = { meshes: m, tris: Math.round(tr) }; }); o.solids = SOL.length; o.lights = (GR.lights || []).length; return o; }
  };
  (function hookAll() {
    var set = function (phase, name, fn, first) { var list = window.PLAN_HOOKS[phase]; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } if (first) list.unshift({ name: name, fn: fn }); else list.push({ name: name, fn: fn }); };
    // the world hooks run before the terrain hooks: the keep-out goes in first of all world hooks (plan_enrich and the fill modules
    // plant later in the world phase), and the terrain hook clears what the engine laid out earlier (before anything is instanced)
    set("world", "spaWorld", function () { worldHook(); }, true);
    set("terrain", "spaTerrain", function () { terrainHook(); });
    set("defer", "spaDefer", function () { deferHook(); });
    set("frame", "spaFrame", function (dt, now) { frameHook(dt, now); });
    set("interior", "spaCam", function (dt) { return camHook(dt); });
  })();
})();
