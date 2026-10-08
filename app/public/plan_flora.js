// R18 Agent G2, desert flora on the open land (HANDOFF_R18_FLORA.md). Classic script, loaded after the fill modules and before
// client.js; reaches the client's globals (MODELS, MODEL_SPECS, INSTSET, PLACE, ROADS, SOLIDS, COLLIDERS, KEEPOUT, PLAN_KEEP_POLY,
// PLAZAS, POOLS, SITE, H, T, walkAt, coverAt, COVER, XG, QUAL, camera, scene, renderer, inside, FLY) by bare name at call time.
// Nothing here edits another file.
//
// What it does: a xeriscape and natural desert layer on every piece of open land more than about 6 m from paths, roads and
// buildings, outside the venues, keep-outs, the runway and taxiway strips and the Arrivals zone (Agent F2's), matched to the user's
// photo references (assets_r18/refs/veg_ref_1..5): boulders and red rock outcrops, agave, prickly pear (green and purple), barrel and
// golden barrel cactus, totem columns and saguaro, yucca, flowering shrubs (brittlebush, Texas sage, purple salvia, red firecracker),
// palo verde in yellow bloom, rock-mulch and decomposed granite beds. Planted in drifts and clumps (a designed bed near the walks,
// natural desert further out), never a uniform scatter.
//
// How it draws (instancing, LOD, impostors, fades):
//   near    the game's own best plant models (the engine's MODELS kinds, their plan_foliage shading and wind kept) as instanced
//           meshes, full model close up and the kind's LOD geometry beyond; the camera ring is refilled from a 16 m chunk grid
//           only after 3 m of travel; full -> LOD -> impostor are dithered cross-fades (plan_foliage's band and range dissolves on
//           per-tier material clones, the same programs)
//   far     one static instanced impostor mesh for every plant of every species (two crossed cards per plant, albedo and normal
//           atlases baked at load from the same models, lit and shadowed like the 3D ones), dithered in where the 3D tier
//           dissolves out and out again by size and distance: 1 draw, no CPU per frame
//   ground  rock-mulch and DG beds as two merged, terrain-following meshes with soft edges; small flowering ground cover near the
//           camera only, dissolving in and out with distance
// Switches: ?flora=0 off; ?flimp=0 no impostors; ?flbeds=0 no beds; ?flgc=0 no ground cover; ?flshad=0 no flora shadows;
// ?fldens=<f> density factor; ?flab=1 keeps the module switchable live: PLAN_FLORA.ab(false / true).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_FLORA = window.PLAN_FLORA || { v: "r18-0", errs: [], n: {} };
(function () {
  "use strict";
  var FL = window.PLAN_FLORA; if (typeof FL._dispose === "function") { try { FL._dispose(); } catch (e) {} }   // a re-evaluated copy (dev) replaces the old one
  FL.v = "r18-1"; FL.errs = []; FL.n = {}; FL.t = {}; FL.ready = false;
  var Q = location.search || "";
  var sw = function (k) { return !new RegExp("[?&]" + k + "=0\\b").test(Q); };
  var num = function (k, d) { var m = new RegExp("[?&]" + k + "=([0-9.]+)").exec(Q); return m ? +m[1] : d; };
  if (!sw("flora")) { FL.off = true; return; }
  var K = FL.K = {
    imp: sw("flimp"), beds: sw("flbeds"), gc: sw("flgc"), shad: sw("flshad"), dens: num("fldens", 1), ab: /[?&]flab=1\b/.test(Q),
    clear: 6,              // metres from paths, roads, plazas and buildings
    clearFlat: 2,          // from flat module surfaces and small props
    rwy: 75, taxi: 22, apron: 10, edge: 45,
    arr: [-75, 275, -265, 80],   // the Arrivals zone (Agent F2) plus 5 m
    cell: 2, chunk: 16, refill: 3, budget: num("flbudget", 4),
  };
  // R21 CP (HANDOFF_R21_CPU.md, ?cpfl=0, ?cp=0): the build's long loops yield on a 2 ms clock instead of every few thousand items, so no
  // single step of the in-play build takes 20 to 60 ms (the same work, in the same order, over more frames)
  var CPFL = !/[?&](cp|cpfl)=0\b/.test(Q), tY = 0;
  var readyRes; FL.whenReady = new Promise(function (r) { readyRes = r; });
  function err(where, e) { var s = where + ": " + ((e && e.message) || e); try { if (e && e.stack) s += " @ " + String(e.stack).split("\n").slice(1, 3).map(function (l) { return l.trim().replace(/^at /, "").replace(/\(?https?:\/\/[^/]+\//, "").slice(0, 80); }).join(" < "); } catch (x) {} if (FL.errs.length < 40) FL.errs.push(s); try { console.warn("PLAN_FLORA " + s); } catch (x) {} }
  function cnt(k, v) { FL.n[k] = (FL.n[k] || 0) + (v === undefined ? 1 : v); }
  function now() { return performance.now(); }
  function tierQ() { try { var l = QUAL.level; return l === "ultra" ? 3 : l === "high" ? 2 : l === "medium" ? 1 : 0; } catch (e) { return 2; } }

  // ───────────────────────── noise and random ─────────────────────────
  function h2(i, j) { var h = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function vn(x, z) { var i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j; fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    var a = h2(i, j), b = h2(i + 1, j), c = h2(i, j + 1), d = h2(i + 1, j + 1); return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz; }
  function fbm(x, z) { return vn(x, z) * 0.62 + vn(x * 2.13 + 17.3, z * 2.13 - 5.1) * 0.38; }
  function rng(seed) { var s = seed >>> 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
  function wpick(r, w) { var s = 0, k; for (k in w) s += w[k]; var v = r() * s; for (k in w) { v -= w[k]; if (v <= 0) return k; } return k; }
  function ri(r, a, b) { return a + Math.floor(r() * (b - a + 1)); }
  function rf(r, a, b) { return a + r() * (b - a); }

  // ───────────────────────── species ─────────────────────────
  // kind: the engine model; v: material variant; s: scale range; sy: extra height factor range; full/near: the 3D tier radii
  // (ultra, metres; full = the full model, 0 = the LOD geometry only); r: footprint radius for spacing (m, at scale 1);
  // col: collider radius factor; sh: casts shadows; sink: fraction of the height set into the ground (rocks)
  var SP = [
    { id: "pv",  kind: "paloverde",     v: "bloom",  s: [0.55, 0.88], full: 0, noLod: 1, near: 62, r: 2.2, col: 0.05, sh: 1, tree: 1 },
    { id: "sag", kind: "saguaro",       s: [0.5, 1.05], full: 22, near: 85, r: 0.9, col: 0.3, sh: 1 },
    { id: "tot", kind: "saguaro_young", s: [1.0, 1.85], full: 12, near: 46, r: 0.45, col: 1.2 },
    { id: "yuc", kind: "yucca_cluster", s: [0.62, 1.0], full: 14, near: 46, r: 0.9, col: 0.35 },
    { id: "pp",  kind: "prickly_pear",  s: [0.6, 1.08], full: 12, near: 38, r: 0.85, col: 0.5 },
    { id: "ppp", kind: "prickly_pear",  v: "purple", s: [0.55, 0.95], full: 12, near: 38, r: 0.8, col: 0.5 },
    { id: "bar", kind: "barrel_cactus", s: [0.65, 1.25], full: 7, near: 36, r: 0.32 },
    { id: "gb",  kind: "barrel_cactus", v: "gold", s: [0.6, 0.95], sy: [0.68, 0.82], full: 7, near: 36, r: 0.36 },
    { id: "agc", kind: "agave_cluster", s: [0.7, 1.25], full: 12, near: 38, r: 0.9, sink: 0.115 },
    { id: "ag0", kind: "fa_agave0",     s: [0.9, 1.7], full: 0, near: 42, r: 0.6 },
    { id: "ag1", kind: "fa_agave1",     s: [0.9, 1.7], full: 0, near: 42, r: 0.6 },
    { id: "rk0", kind: "land_rock0",    v: "tan", s: [0.7, 2.0], full: 0, near: 50, r: 1.0, col: 0.75, sh: 3, rock: 1, sink: 0.22 },
    { id: "rk1", kind: "land_rock1",    v: "tan", s: [0.6, 1.8], full: 0, near: 50, r: 1.2, col: 0.75, sh: 3, rock: 1, sink: 0.22 },
    { id: "rr",  kind: "land_rock1",    v: "red", s: [1.4, 3.0], sy: [1.0, 1.6], full: 0, near: 75, r: 1.1, col: 0.8, sh: 1, rock: 1, sink: 0.18 },
    { id: "br",  card: 0, h: 0.95, w: 1.25, s: [0.75, 1.25], near: 42, r: 0.6 },
    { id: "ts",  card: 1, h: 1.45, w: 1.5,  s: [0.75, 1.2],  near: 42, r: 0.75 },
    { id: "sv",  card: 2, h: 1.1,  w: 1.2,  s: [0.75, 1.25], near: 42, r: 0.6 },
    { id: "fc",  card: 3, h: 1.15, w: 1.45, s: [0.75, 1.2],  near: 42, r: 0.65 },
    { id: "gc",  card: 0, h: 0.95, w: 1.25, s: [0.3, 0.48],  near: 26, r: 0.25, gc: 1, noImp: 1 },
  ];
  var SPI = {}; SP.forEach(function (s, i) { s.i = i; SPI[s.id] = s; });
  FL.SP = SP;

  // ───────────────────────── the open-land raster ─────────────────────────
  // 2 m cells over the terrain. ex: never plant (strips, zones, keep-outs, edges); h1: built (paths, roads, plazas, buildings,
  // structures: K.clear applies, through the distance field); soft: an existing plant, rock or small prop (spacing only)
  var R = FL.R = null;
  function rasterInit() {
    var C = K.cell, x0 = T.xmin, z0 = T.zmin, W = Math.ceil((T.xmax - T.xmin) / C), D = Math.ceil((T.zmax - T.zmin) / C);
    R = FL.R = { C: C, x0: x0, z0: z0, W: W, D: D, ex: new Uint8Array(W * D), h1: new Uint8Array(W * D), soft: new Uint8Array(W * D), src: new Uint8Array(W * D), dist: null, mine: null };
  }
  var SRC = 0; FL.SRCN = ["", "edge", "arrivals", "site", "taxilanes", "keeppoly", "keepout", "roads", "paths", "plazas", "pools", "planplazas", "buildings", "propsFlat", "propsTall", "solidsH", "solidsFlat", "instH", "instFlat", "meshH", "meshFlat", "bigH", "bigFlat"];
  function idx(x, z) { var i = Math.floor((x - R.x0) / R.C), j = Math.floor((z - R.z0) / R.C); if (i < 0 || j < 0 || i >= R.W || j >= R.D) return -1; return j * R.W + i; }
  function markRect(a, x0, z0, x1, z1, v) { var C = R.C; var i0 = Math.max(0, Math.floor((x0 - R.x0) / C)), i1 = Math.min(R.W - 1, Math.floor((x1 - R.x0) / C)), j0 = Math.max(0, Math.floor((z0 - R.z0) / C)), j1 = Math.min(R.D - 1, Math.floor((z1 - R.z0) / C));
    for (var j = j0; j <= j1; j++) { var o = j * R.W; for (var i = i0; i <= i1; i++) { a[o + i] = v; if (a !== R.soft) R.src[o + i] = SRC; } } }
  function markDisc(a, x, z, r, v) { var C = R.C; if (!(r > 0)) return; var i0 = Math.max(0, Math.floor((x - r - R.x0) / C)), i1 = Math.min(R.W - 1, Math.floor((x + r - R.x0) / C)), j0 = Math.max(0, Math.floor((z - r - R.z0) / C)), j1 = Math.min(R.D - 1, Math.floor((z + r - R.z0) / C)); var r2 = (r + C * 0.5) * (r + C * 0.5);
    for (var j = j0; j <= j1; j++) { var cz = R.z0 + (j + 0.5) * C - z, o = j * R.W; for (var i = i0; i <= i1; i++) { var cx = R.x0 + (i + 0.5) * C - x; if (cx * cx + cz * cz <= r2) { a[o + i] = v; if (a !== R.soft) R.src[o + i] = SRC; } } } }
  function markSeg(a, ax, az, bx, bz, hw, v) { var C = R.C; var i0 = Math.max(0, Math.floor((Math.min(ax, bx) - hw - R.x0) / C)), i1 = Math.min(R.W - 1, Math.floor((Math.max(ax, bx) + hw - R.x0) / C)), j0 = Math.max(0, Math.floor((Math.min(az, bz) - hw - R.z0) / C)), j1 = Math.min(R.D - 1, Math.floor((Math.max(az, bz) + hw - R.z0) / C));
    var vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1e-9, e = hw + C * 0.5, e2 = e * e;
    for (var j = j0; j <= j1; j++) { var pz = R.z0 + (j + 0.5) * C, o = j * R.W; for (var i = i0; i <= i1; i++) { var px = R.x0 + (i + 0.5) * C; var t = ((px - ax) * vx + (pz - az) * vz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; var dx = px - ax - vx * t, dz = pz - az - vz * t; if (dx * dx + dz * dz <= e2) { a[o + i] = v; if (a !== R.soft) R.src[o + i] = SRC; } } } }
  function markLine(a, pts, hw, v) { if (!pts || pts.length < 2) return; for (var k = 0; k < pts.length - 1; k++) { var p = pts[k], q = pts[k + 1]; if (!p || !q) continue; markSeg(a, p[0], p[1], q[0], q[1], hw, v); } }
  function inPoly(poly, x, z) { var c = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1] + 1e-12) + a[0]) c = !c; } return c; }
  function markPoly(a, poly, v, grow) { if (!poly || poly.length < 3) return; var mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9; for (var k = 0; k < poly.length; k++) { var p = poly[k]; if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0]; if (p[1] < mnz) mnz = p[1]; if (p[1] > mxz) mxz = p[1]; }
    var C = R.C; var i0 = Math.max(0, Math.floor((mnx - R.x0) / C)), i1 = Math.min(R.W - 1, Math.floor((mxx - R.x0) / C)), j0 = Math.max(0, Math.floor((mnz - R.z0) / C)), j1 = Math.min(R.D - 1, Math.floor((mxz - R.z0) / C));
    for (var j = j0; j <= j1; j++) { var pz = R.z0 + (j + 0.5) * C, o = j * R.W; for (var i = i0; i <= i1; i++) { if (inPoly(poly, R.x0 + (i + 0.5) * C, pz)) { a[o + i] = v; if (a !== R.soft) R.src[o + i] = SRC; } } }
    if (grow > 0) { var cl = poly.concat([poly[0]]); markLine(a, cl, grow, v); } }
  function markOBB(a, x, z, ry, hw, hd, v) { var c = Math.cos(ry), s = Math.sin(ry); var ex = Math.abs(c) * hw + Math.abs(s) * hd, ez = Math.abs(s) * hw + Math.abs(c) * hd;
    if (hw * hd < 6 || Math.max(hw, hd) < 3) { markRect(a, x - ex, z - ez, x + ex, z + ez, v); return; }
    var C = R.C, i0 = Math.max(0, Math.floor((x - ex - R.x0) / C)), i1 = Math.min(R.W - 1, Math.floor((x + ex - R.x0) / C)), j0 = Math.max(0, Math.floor((z - ez - R.z0) / C)), j1 = Math.min(R.D - 1, Math.floor((z + ez - R.z0) / C)), m = C * 0.5;
    for (var j = j0; j <= j1; j++) { var dz = R.z0 + (j + 0.5) * C - z, o = j * R.W; for (var i = i0; i <= i1; i++) { var dx = R.x0 + (i + 0.5) * C - x; var lx = dx * c - dz * s, lz = dx * s + dz * c; if (Math.abs(lx) <= hw + m && Math.abs(lz) <= hd + m) { a[o + i] = v; if (a !== R.soft) R.src[o + i] = SRC; } } } }

  // an oriented box (centre, unit axes u and v with half sizes), grown by g metres
  function markOBB2(a, cx, cz, ux, uz, hu, vx, vz, hv, g) { var C = R.C, eu = hu + g + C * 0.5, ev = hv + g + C * 0.5; var ex = Math.abs(ux) * eu + Math.abs(vx) * ev, ez = Math.abs(uz) * eu + Math.abs(vz) * ev;
    if (eu * ev < 9) { markRect(a, cx - ex, cz - ez, cx + ex, cz + ez, 1); return; }
    var i0 = Math.max(0, Math.floor((cx - ex - R.x0) / C)), i1 = Math.min(R.W - 1, Math.floor((cx + ex - R.x0) / C)), j0 = Math.max(0, Math.floor((cz - ez - R.z0) / C)), j1 = Math.min(R.D - 1, Math.floor((cz + ez - R.z0) / C));
    for (var j = j0; j <= j1; j++) { var dz = R.z0 + (j + 0.5) * C - cz, o = j * R.W; for (var i = i0; i <= i1; i++) { var dx = R.x0 + (i + 0.5) * C - cx; if (Math.abs(dx * ux + dz * uz) <= eu && Math.abs(dx * vx + dz * vz) <= ev) { a[o + i] = 1; if (a !== R.soft) R.src[o + i] = SRC; } } } }
  // a triangle on the ground plane, grown by g metres (cells whose centre is inside, or within g plus half a cell of an edge)
  function markTri(a, ax, az, bx, bz, cx, cz, g) { var C = R.C, e = g + C * 0.71; var mnx = Math.min(ax, bx, cx) - e, mxx = Math.max(ax, bx, cx) + e, mnz = Math.min(az, bz, cz) - e, mxz = Math.max(az, bz, cz) + e;
    if (mxx - mnx <= C * 1.5 && mxz - mnz <= C * 1.5) { markRect(a, mnx + e - g, mnz + e - g, mxx - e + g, mxz - e + g, 1); return; }
    var i0 = Math.max(0, Math.floor((mnx - R.x0) / C)), i1 = Math.min(R.W - 1, Math.floor((mxx - R.x0) / C)), j0 = Math.max(0, Math.floor((mnz - R.z0) / C)), j1 = Math.min(R.D - 1, Math.floor((mxz - R.z0) / C));
    var den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); var e2 = e * e;
    var sd = function (px, pz, x0, z0, x1, z1) { var vx = x1 - x0, vz = z1 - z0, L2 = vx * vx + vz * vz || 1e-9; var t = ((px - x0) * vx + (pz - z0) * vz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; var dx = px - x0 - vx * t, dz = pz - z0 - vz * t; return dx * dx + dz * dz; };
    for (var j = j0; j <= j1; j++) { var pz = R.z0 + (j + 0.5) * C, o = j * R.W; for (var i = i0; i <= i1; i++) { var px = R.x0 + (i + 0.5) * C, inn = false;
        if (Math.abs(den) > 1e-9) { var l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den; inn = l1 >= 0 && l2 >= 0 && l1 + l2 <= 1; }
        if (!inn && (sd(px, pz, ax, az, bx, bz) <= e2 || sd(px, pz, bx, bz, cx, cz) <= e2 || sd(px, pz, cx, cz, ax, az) <= e2)) inn = true;
        if (inn) { a[o + i] = 1; if (a !== R.soft) R.src[o + i] = SRC; } } } }
  var PLANT_RE = /saguaro|cactus|cholla|pear|organ|agave|yucca|ocotillo|succulent|quiver|palm|bush|shrub|tree|verde|mesquite|willow|ironwood|olive|grass|flower|leaf|sagy|rock|boulder|stone|pebble/i;
  var OWN = new Set();   // my meshes (never read back into the raster)
  // the build steps, as a generator: yields often so the frame hook can spread it over frames
  function* rasterSteps() {
    var t0 = now(); rasterInit(); var ex = R.ex, h1 = R.h1, soft = R.soft;
    // the land edge
    SRC = 1; markRect(ex, T.xmin - 10, T.zmin - 10, T.xmin + K.edge, T.zmax + 10, 1); markRect(ex, T.xmax - K.edge, T.zmin - 10, T.xmax + 10, T.zmax + 10, 1);
    markRect(ex, T.xmin - 10, T.zmin - 10, T.xmax + 10, T.zmin + K.edge, 1); markRect(ex, T.xmin - 10, T.zmax - K.edge, T.xmax + 10, T.zmax + 10, 1);
    SRC = 2; markRect(ex, K.arr[0], K.arr[2], K.arr[1], K.arr[3], 1);   // Agent F2's Arrivals zone
    SRC = 3; try { markLine(ex, SITE.runway, K.rwy, 1); (SITE.taxiways || []).forEach(function (tw) { markLine(ex, tw, K.taxi, 1); }); (SITE.aprons || []).forEach(function (ap) { if (ap && ap.length >= 3) markPoly(ex, ap, 1, K.apron); }); } catch (e) { err("site", e); }
    SRC = 4; try { var P = window.PLAN; (P && P.roads || []).forEach(function (r) { if (r && /taxi|apron/i.test(r.class || "") && r.pts) markLine(ex, r.pts, 15, 1); }); } catch (e) { err("taxilanes", e); }
    yield 1;
    SRC = 5; try { for (var k = 0; k < PLAN_KEEP_POLY.length; k++) markPoly(ex, PLAN_KEEP_POLY[k].poly, 1, 2); } catch (e) { err("keep polys", e); }
    SRC = 6; try { for (var k2 = 0; k2 < KEEPOUT.length; k2++) { var ko = KEEPOUT[k2]; markDisc(ex, ko[0], ko[1], ko[2], 1); } } catch (e) { err("keepouts", e); }
    yield 1;
    // roads, the dressed path network, plazas, pools
    SRC = 7; try { for (var r = 0; r < ROADS.length; r++) { var rd = ROADS[r]; if (rd && rd.pts) markLine(h1, rd.pts, (rd.w || 2) / 2, 1); } } catch (e) { err("roads", e); }
    SRC = 8; try { var E = window.PLAN_PATHS && PLAN_PATHS.edges; if (E && E.length) E.forEach(function (q) { if (q && q.pts) markLine(h1, q.pts, (q.w || 2) / 2 + (q.dress || 0), 1); }); } catch (e) { err("paths", e); }
    SRC = 9; try { PLAZAS.forEach(function (p) { if (Array.isArray(p)) markDisc(h1, p[0], p[1], p[2], 1); else if (p && p.x !== undefined) markDisc(h1, p.x, p.z, p.r || 10, 1); }); } catch (e) { err("plazas", e); }
    SRC = 10; try { POOLS.forEach(function (p) { if (p && p.x !== undefined) markDisc(h1, p.x, p.z, Math.max(p.w || 4, p.d || 4) / 2 + 2, 1); }); } catch (e) { err("pools", e); }
    SRC = 11; try { var PL = window.PLAN; if (PL && PL.plazas) PL.plazas.forEach(function (z) { if (z && z.x !== undefined) markDisc(h1, z.x, z.z, z.r || 10, 1); }); } catch (e) { err("plan plazas", e); }
    yield 1;
    // buildings and props of the engine's placements; existing plants and rocks are soft
    FL.ph = "r.place"; try { for (var kind in PLACE) { var sp = MODEL_SPECS[kind], m = MODELS[kind], list = PLACE[kind]; if (!sp || !list || !list.length) continue; var rad = m ? m.radius : (sp.size || 4) / 2;
        var plant = PLANT_RE.test(kind) || (sp.prop && sp.sway);
        for (var q = 0; q < list.length; q++) { var e = list[q]; if (e.hide || !(e[4] > 0)) continue; var rr = rad * e[4];
          if (!sp.prop && !sp.vehicle) { SRC = 12; markDisc(h1, e[0], e[2], rr * 0.92, 1); }
          else if (plant) markDisc(soft, e[0], e[2], Math.min(rr * 0.85, sp.sway && m && m.height * e[4] > 2.6 ? 1.6 : rr), 1);
          else if (rr > 2.5 || (m && m.height * e[4] > 1.6)) { SRC = 14; markDisc(h1, e[0], e[2], rr, 1); }   // lamps, signs, sculptures, carts, ramadas
          else { SRC = 13; markDisc(ex, e[0], e[2], rr + K.clearFlat, 1); } }
        yield 1; } } catch (e) { err("place", e); }
    // solids: structures and decks
    FL.ph = "r.solids"; try { for (var s = 0; s < SOLIDS.length; s++) { var so = SOLIDS[s]; if (!so || so.tag === "room") continue; if (so.y1 - so.y0 > 0.9 || so.hw * so.hd > 4) { SRC = 15; markOBB(h1, so.x, so.z, so.ry || 0, so.hw, so.hd, 1); } else { SRC = 16; markOBB(ex, so.x, so.z, so.ry || 0, so.hw + K.clearFlat, so.hd + K.clearFlat, 1); } if (CPFL ? ((s & 255) === 255 && now() - tY > 2) : (s & 2047) === 2047) { yield 1; tY = now(); } } } catch (e) { err("solids", e); }
    try { tY = now(); for (var c = 0; c < COLLIDERS.length; c++) { var co = COLLIDERS[c]; if (OLD !== null && OLD.colS.has(co)) continue; markDisc(soft, co[0], co[1], co[2] + 0.6, 1); if (CPFL && (c & 1023) === 1023 && now() - tY > 2) { yield 1; tY = now(); } } } catch (e) { err("colliders", e); }
    yield 1;
    // every module mesh in the scene: small ones by their bounds, large merged ones triangle by triangle (structures above the
    // ground count as built, flat pieces keep the small clearance)
    FL.ph = "r.scene"; var instSet = new Set(); try { INSTSET.forEach(function (S) { [S.insts, S.far, S.far2].forEach(function (a) { (a || []).forEach(function (im) { instSet.add(im); }); }); }); } catch (e) {}
    try { [NEAR && NEAR.pebbles, NEAR && NEAR.rocks, NEAR && NEAR.grass].forEach(function (o) { if (o) instSet.add(o); }); } catch (e) {}
    try { if (window.PLAN_FOLIAGE && PLAN_FOLIAGE.gc) [].concat(PLAN_FOLIAGE.gc.meshes || []).forEach(function (o) { instSet.add(o); }); } catch (e) {}
    var list2 = []; var bb = new THREE.Box3(), mw = new THREE.Matrix4();
    scene.traverse(function (o) { if (!o.isMesh || OWN.has(o) || instSet.has(o) || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return; if (o.isSkinnedMesh) return; var ud = o.userData || {}; if (ud.interior || ud.flora) return; list2.push(o); });
    FL.n.sceneMeshes = list2.length; var tri = 0;
    for (var li = 0; li < list2.length; li++) { var o = list2[li]; try { var g = o.geometry; if (!g.boundingBox) g.computeBoundingBox(); if (!g.boundingBox || g.boundingBox.isEmpty()) continue; o.updateWorldMatrix(true, false);
        var mat0 = Array.isArray(o.material) ? o.material[0] : o.material; var leafy = mat0 && (mat0.alphaTest > 0.05 || /leaf|leaves|frond|grass|flower/i.test(mat0.name || ""));
        if (mat0 && ((mat0.transparent && mat0.depthWrite === false) || mat0.isSpriteMaterial || mat0.isPointsMaterial || mat0.colorWrite === false)) { cnt("decalSkip"); continue; }   // glows, light pools, contact shadows, decals
        if (o.isInstancedMesh) { if (!o.count || o.count > 3000) continue; if (g.boundingBox.max.y - g.boundingBox.min.y < 0.03) { cnt("planeSkip"); continue; } var gb = g.boundingBox, gcx = (gb.min.x + gb.max.x) / 2, gcy = (gb.min.y + gb.max.y) / 2, gcz = (gb.min.z + gb.max.z) / 2, ghx = (gb.max.x - gb.min.x) / 2, ghz = (gb.max.z - gb.min.z) / 2;
          for (var ii = 0; ii < o.count; ii++) { if (CPFL && (ii & 255) === 255 && now() - tY > 2) { yield 1; tY = now(); } mw.fromArray(o.instanceMatrix.array, ii * 16).premultiply(o.matrixWorld); var me = mw.elements; bb.copy(gb).applyMatrix4(mw); var sx = bb.max.x - bb.min.x, sz = bb.max.z - bb.min.z; if (!(sx < 400 && sz < 400) || !(sx + sz > 0)) continue;
            // the oriented footprint: the local x and z axes of the instance on the ground
            var wx = me[0] * gcx + me[4] * gcy + me[8] * gcz + me[12], wz = me[2] * gcx + me[6] * gcy + me[10] * gcz + me[14];
            var axx = me[0], axz = me[2], azx = me[8], azz = me[10], la = Math.hypot(axx, axz) || 1e-6, lb = Math.hypot(azx, azz) || 1e-6, hx = ghx * la, hz = ghz * lb;
            if (leafy) markDisc(soft, wx, wz, Math.max(hx, hz), 1); else if (bb.max.y - bb.min.y > 1.2 && sx * sz > 0.3) { SRC = 17; markOBB2(h1, wx, wz, axx / la, axz / la, hx, azx / lb, azz / lb, hz, 0); } else { SRC = 18; markOBB2(ex, wx, wz, axx / la, axz / la, hx, azx / lb, azz / lb, hz, K.clearFlat); } }
          continue; }
        bb.copy(g.boundingBox).applyMatrix4(o.matrixWorld); var bx = bb.max.x - bb.min.x, bz = bb.max.z - bb.min.z;
        if (bx > 1400 || bz > 1400) continue;   // the terrain, the far ring, the sky
        if (bx <= 12 && bz <= 12) { var ty = bb.max.y - bb.min.y; if (leafy) markRect(soft, bb.min.x, bb.min.z, bb.max.x, bb.max.z, 1); else if (ty > 1.0) { SRC = 19; markRect(h1, bb.min.x, bb.min.z, bb.max.x, bb.max.z, 1); } else { SRC = 20; markRect(ex, bb.min.x - K.clearFlat, bb.min.z - K.clearFlat, bb.max.x + K.clearFlat, bb.max.z + K.clearFlat, 1); } continue; }
        // a larger or merged mesh: its triangles (an L-shaped edging or a curved wall covers only what it covers)
        var pa = g.attributes.position; if (pa.isInterleavedBufferAttribute || pa.r6free || (g.index && g.index.r6free) || !pa.array || !pa.array.length) { cnt("bigFreed"); if (bx <= 60 && bz <= 60) { SRC = 19; markRect(bb.max.y - bb.min.y > 1 ? h1 : ex, bb.min.x, bb.min.z, bb.max.x, bb.max.z, 1); } continue; }
        var P2 = pa.array, ix = g.index ? g.index.array : null, n = ix ? ix.length : pa.count, el = o.matrixWorld.elements;
        var W3 = function (i, k) { return el[k] * P2[i * 3] + el[4 + k] * P2[i * 3 + 1] + el[8 + k] * P2[i * 3 + 2] + el[12 + k]; };
        var tA = now();
        for (var t = 0; t + 2 < n; t += 3) { var a1 = ix ? ix[t] : t, b1 = ix ? ix[t + 1] : t + 1, c1 = ix ? ix[t + 2] : t + 2;
          var ax = W3(a1, 0), az = W3(a1, 2), bxx = W3(b1, 0), bzz = W3(b1, 2), cxx = W3(c1, 0), czz = W3(c1, 2);
          var mnx = Math.min(ax, bxx, cxx), mxx = Math.max(ax, bxx, cxx), mnz = Math.min(az, bzz, czz), mxz = Math.max(az, bzz, czz); if (mxx - mnx > 60 || mxz - mnz > 60) continue;
          var my = Math.max(W3(a1, 1), W3(b1, 1), W3(c1, 1)), gy = sampleGrid(H, T, (mnx + mxx) / 2, (mnz + mxz) / 2);
          if (leafy) markTri(soft, ax, az, bxx, bzz, cxx, czz, 0); else if (my > gy + 1.0) { SRC = 21; markTri(h1, ax, az, bxx, bzz, cxx, czz, 0); } else { SRC = 22; markTri(ex, ax, az, bxx, bzz, cxx, czz, K.clearFlat); }
          tri++; if (CPFL ? (tri & 63) === 0 && now() - tA > 2 : (t & 4095) === 0 && now() - tA > 6) { yield 1; tA = now(); } }
      } catch (e) { err("mesh " + (o.name || ""), e); }
      if (CPFL ? (li & 15) === 15 && now() - tY > 2 : (li & 127) === 127) { yield 1; tY = now(); } }
    FL.n.bigTris = tri;
    yield 1;
    // distance (m) from every cell to the nearest built cell: two-pass chamfer (3-4), in tenths of a cell
    FL.ph = "r.dist"; var W = R.W, D = R.D, dist = new Uint16Array(W * D), BIG = 60000;
    tY = now(); for (var p = 0; p < W * D; p++) { if (CPFL && (p & 262143) === 262143 && now() - tY > 2) { yield 1; tY = now(); } dist[p] = h1[p] ? 0 : BIG; }
    tY = now(); for (var j = 0; j < D; j++) { if (CPFL && (j & 31) === 31 && now() - tY > 2) { yield 1; tY = now(); } var o2 = j * W; for (var i = 0; i < W; i++) { var pp = o2 + i, v = dist[pp]; if (!v) continue; if (i > 0 && dist[pp - 1] + 3 < v) v = dist[pp - 1] + 3; if (j > 0) { if (dist[pp - W] + 3 < v) v = dist[pp - W] + 3; if (i > 0 && dist[pp - W - 1] + 4 < v) v = dist[pp - W - 1] + 4; if (i < W - 1 && dist[pp - W + 1] + 4 < v) v = dist[pp - W + 1] + 4; } dist[pp] = v; } if ((j & 127) === 127) yield 1; }
    for (var j2 = D - 1; j2 >= 0; j2--) { if (CPFL && (j2 & 31) === 31 && now() - tY > 2) { yield 1; tY = now(); } var o3 = j2 * W; for (var i2 = W - 1; i2 >= 0; i2--) { var p2 = o3 + i2, v2 = dist[p2]; if (!v2) continue; if (i2 < W - 1 && dist[p2 + 1] + 3 < v2) v2 = dist[p2 + 1] + 3; if (j2 < D - 1) { if (dist[p2 + W] + 3 < v2) v2 = dist[p2 + W] + 3; if (i2 < W - 1 && dist[p2 + W + 1] + 4 < v2) v2 = dist[p2 + W + 1] + 4; if (i2 > 0 && dist[p2 + W - 1] + 4 < v2) v2 = dist[p2 + W - 1] + 4; } dist[p2] = v2; } if ((j2 & 127) === 127) yield 1; }
    R.dist = dist; R.dk = R.C / 3;   // metres per chamfer unit
    if (CPFL) yield 1; var free = 0; tY = now(); for (var f = 0; f < W * D; f++) { if (CPFL && (f & 262143) === 262143 && now() - tY > 2) { yield 1; tY = now(); } if (!ex[f] && !soft[f] && dist[f] * R.dk >= K.clear) free++; }
    FL.n.freeM2 = free * R.C * R.C; FL.t.raster = Math.round(now() - t0);
    if (CPFL) yield 1; var bys = {}; tY = now(); for (var f2 = 0; f2 < W * D; f2++) { if (CPFL && (f2 & 262143) === 262143 && now() - tY > 2) { yield 1; tY = now(); } if (!(ex[f2] || h1[f2])) continue; var nm = FL.SRCN[R.src[f2]] || "?"; bys[nm] = (bys[nm] || 0) + R.C * R.C; } FL.n.bySrc = bys;
  }
  function distAt(x, z) { var k = idx(x, z); if (k < 0) return 0; return R.dist[k] * R.dk; }

  // ───────────────────────── placement ─────────────────────────
  // my own spacing grid (0.5 m) so drifts pack naturally without overlaps
  var MG = { C: 0.5, W: 0, D: 0, a: null };
  function mgInit() { MG.W = Math.ceil((T.xmax - T.xmin) / MG.C); MG.D = Math.ceil((T.zmax - T.zmin) / MG.C); MG.a = new Uint8Array(MG.W * MG.D); }
  function mgTest(x, z, r) { var C = MG.C, i0 = Math.floor((x - r - T.xmin) / C), i1 = Math.floor((x + r - T.xmin) / C), j0 = Math.floor((z - r - T.zmin) / C), j1 = Math.floor((z + r - T.zmin) / C); if (i0 < 0 || j0 < 0 || i1 >= MG.W || j1 >= MG.D) return false; var r2 = r * r;
    for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) { if (!MG.a[j * MG.W + i]) continue; var dx = T.xmin + (i + 0.5) * C - x, dz = T.zmin + (j + 0.5) * C - z; if (dx * dx + dz * dz <= r2) return false; } return true; }
  function mgMark(x, z, r) { var C = MG.C, i0 = Math.max(0, Math.floor((x - r - T.xmin) / C)), i1 = Math.min(MG.W - 1, Math.floor((x + r - T.xmin) / C)), j0 = Math.max(0, Math.floor((z - r - T.zmin) / C)), j1 = Math.min(MG.D - 1, Math.floor((z + r - T.zmin) / C)), r2 = r * r;
    for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) { var dx = T.xmin + (i + 0.5) * C - x, dz = T.zmin + (j + 0.5) * C - z; if (dx * dx + dz * dz <= r2) MG.a[j * MG.W + i] = 1; } }
  function zoneW(x, z) { var zn = "land"; try { zn = planZone(x, z); } catch (e) {} return zn === "off" ? 0.2 : zn === "wash" ? 0.65 : zn === "city" ? 0.85 : 1; }
  // can a plant of footprint r stand here? (cheap raster tests first, then the drawn surfaces)
  function okAt(x, z, r, clr) { var k = idx(x, z); if (k < 0 || R.ex[k] || R.soft[k]) return false; if (R.dist[k] * R.dk < (clr === undefined ? K.clear : clr)) return false; if (!mgTest(x, z, r)) return false;
    try { if (walkAt(x, z) !== null) return false; } catch (e) {}
    try { if (COVER && COVER.ready && coverAt(x, z)) return false; } catch (e) {}
    try { if (window.PLAN_FLOOR && typeof window.PLAN_FLOOR(x, z) === "number") return false; } catch (e) {}
    try { if (window.GP_PARK && GP_PARK.inPatch && GP_PARK.inPatch(x, z)) return false; } catch (e) {}
    var y = sampleGrid(H, T, x, z), d = Math.max(0.6, r); var sx = sampleGrid(H, T, x + d, z) - sampleGrid(H, T, x - d, z), sz = sampleGrid(H, T, x, z + d) - sampleGrid(H, T, x, z - d); if (Math.hypot(sx, sz) / (2 * d) > 0.45) return false;
    if (!isFinite(y)) return false; return true; }
  var IN = { sp: [], x: [], y: [], z: [], rot: [], s: [], sy: [], tx: [], tz: [] };   // the placements (plain arrays while building)
  var BEDS = { mulch: [], dg: [] };
  function add(spid, x, z, s, r, opt) { var S = SPI[spid]; if (!S) return false; var sc = s === undefined ? rf(r, S.s[0], S.s[1]) : s; var fr = S.r * sc;
    if (!okAt(x, z, fr * 0.8, opt && opt.clr)) return false; mgMark(x, z, fr * (S.tree ? 0.6 : 0.85));
    var sy = S.sy ? rf(r, S.sy[0], S.sy[1]) : 1, tilt = S.rock ? 0.32 : S.card ? 0.05 : 0.035;
    IN.sp.push(S.i); IN.x.push(x); IN.z.push(z); IN.y.push(0); IN.rot.push(r() * 6.2832); IN.s.push(sc); IN.sy.push(sy); IN.tx.push((r() - 0.5) * tilt); IN.tz.push((r() - 0.5) * tilt); cnt("sp_" + spid); return true; }
  // scatter n items of a species round (cx, cz) inside rad, spaced by their footprints (dart throwing)
  function drift(spid, n, cx, cz, rad, r, opt) { var S = SPI[spid], got = 0, tries = 0; while (got < n && tries++ < n * 9) { var a = r() * 6.2832, d = Math.sqrt(r()) * rad; if (add(spid, cx + Math.cos(a) * d, cz + Math.sin(a) * d, undefined, r, opt)) got++; } return got; }
  function bed(type, cx, cz, rad, r) { if (!K.beds) return; var nl = r() < 0.55 ? 2 : r() < 0.5 ? 3 : 1, a0 = r() * 6.2832;   // one to three overlapping lobes: a drift, not a disc
    for (var l = 0; l < nl; l++) { var a = a0 + l * 2.3 + rf(r, -0.4, 0.4), d = l ? rad * rf(r, 0.45, 0.8) : 0, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, rr = rad * (l ? rf(r, 0.55, 0.85) : 1);
      var k = idx(x, z); if (k < 0 || R.ex[k]) continue; if (R.dist[k] * R.dk < rr + 3.5) rr = R.dist[k] * R.dk - 3.5; if (rr < 1.6) continue; BEDS[type].push([x, z, rr, r() * 1000]); } }
  var CL = {
    // designed beds near the walks (refs 1 to 3)
    rockgarden: function (x, z, r) { bed("mulch", x, z, rf(r, 3.5, 5.5), r); drift(r() < 0.5 ? "rk0" : "rk1", ri(r, 2, 4), x, z, 3.2, r); var gx = x + rf(r, -1.5, 1.5), gz = z + rf(r, -1.5, 1.5); drift("gb", ri(r, 3, 7), gx, gz, 1.6, r); drift(pick(r, ["agc", "agc", "ag1"]), ri(r, 1, 3), x, z, 3.5, r); drift(pick(r, ["sv", "fc", "br"]), ri(r, 1, 2), x, z, 4, r); },
    flowers: function (x, z, r) { bed(r() < 0.55 ? "mulch" : "dg", x, z, rf(r, 3.2, 5.2), r); var a = pick(r, ["br", "ts", "sv", "fc"]), b = pick(r, ["br", "ts", "sv", "fc"]); drift(a, ri(r, 4, 8), x, z, 3.6, r); if (b !== a) drift(b, ri(r, 1, 4), x + rf(r, -2, 2), z + rf(r, -2, 2), 2.5, r); drift(pick(r, ["agc", "gb", "tot", "rk1"]), 1, x, z, 2.5, r); if (K.gc) drift("gc", ri(r, 3, 8), x, z, 4.2, r); },
    cactusbed: function (x, z, r) { bed("mulch", x, z, rf(r, 3.5, 5.5), r); drift(r() < 0.45 ? "ppp" : "pp", ri(r, 1, 3), x, z, 3.5, r); drift("tot", ri(r, 1, 3), x, z, 3, r); drift(r() < 0.6 ? "gb" : "bar", ri(r, 2, 5), x, z, 3.5, r); drift("agc", ri(r, 1, 2), x, z, 3.5, r); if (r() < 0.35) drift("sag", 1, x, z, 3, r); drift(pick(r, ["rk0", "rk1"]), ri(r, 1, 2), x, z, 3.8, r); },
    specimen: function (x, z, r) { bed("dg", x, z, rf(r, 4, 6), r); drift("pv", r() < 0.3 ? 2 : 1, x, z, 2.5, r); drift(pick(r, ["br", "ts", "sv"]), ri(r, 3, 6), x, z, 4.8, r); drift(pick(r, ["agc", "yuc", "rk1"]), 1, x, z, 4.5, r); if (K.gc) drift("gc", ri(r, 2, 6), x, z, 5, r); },
    yucca: function (x, z, r) { if (r() < 0.6) bed("mulch", x, z, rf(r, 3, 4.5), r); drift("yuc", ri(r, 2, 4), x, z, 3.2, r); drift(pick(r, ["agc", "agc", "ag1"]), ri(r, 2, 3), x, z, 3.6, r); drift(pick(r, ["rk0", "rk1"]), ri(r, 1, 2), x, z, 3.5, r); },
    // natural desert further out (refs 4 and 5)
    scrub: function (x, z, r) { drift("br", ri(r, 3, 8), x, z, 4.5, r); if (r() < 0.6) drift("ts", ri(r, 1, 3), x, z, 4, r); if (r() < 0.5) drift("bar", ri(r, 1, 2), x, z, 4, r); if (r() < 0.3) drift(pick(r, ["sv", "fc"]), ri(r, 1, 3), x, z, 3, r); },
    boulders: function (x, z, r) { drift(pick(r, ["rk0", "rk1"]), ri(r, 3, 6), x, z, 3.5, r); drift(r() < 0.3 ? "ppp" : "pp", ri(r, 0, 2), x, z, 4, r); drift("br", ri(r, 1, 3), x, z, 4.5, r); if (r() < 0.4) drift("bar", ri(r, 1, 3), x, z, 3.5, r); },
    saguaro: function (x, z, r) { drift("sag", ri(r, 1, 2), x, z, 3.5, r); if (r() < 0.5) drift("tot", 1, x, z, 3, r); drift(r() < 0.5 ? "bar" : "gb", ri(r, 1, 3), x, z, 4, r); drift("br", ri(r, 1, 3), x, z, 4.5, r); },
    tree: function (x, z, r) { drift("pv", 1, x, z, 1.5, r); drift(pick(r, ["br", "ts"]), ri(r, 2, 4), x, z, 5, r); if (r() < 0.4) drift(pick(r, ["pp", "agc", "yuc"]), 1, x, z, 4.5, r); },
    pear: function (x, z, r) { drift("pp", ri(r, 2, 4), x, z, 3.5, r); drift("ppp", ri(r, 0, 2), x, z, 3.5, r); drift("bar", ri(r, 0, 2), x, z, 3, r); drift("br", ri(r, 0, 2), x, z, 4, r); },
    redrock: function (x, z, r) { var n = ri(r, 3, 7), got = 0, tries = 0; while (got < n && tries++ < 40) { var a = r() * 6.2832, d = Math.sqrt(r()) * 4.2; if (add("rr", x + Math.cos(a) * d, z + Math.sin(a) * d, rf(r, 1.4, 3.4), r)) got++; }
      drift("br", ri(r, 2, 4), x, z, 6.5, r); drift(r() < 0.5 ? "ppp" : "pp", ri(r, 0, 2), x, z, 6, r); drift(pick(r, ["agc", "yuc", "tot"]), ri(r, 0, 2), x, z, 6, r); if (r() < 0.5) drift("pv", 1, x, z, 7, r); },
  };
  var GW = { rockgarden: 0.2, flowers: 0.3, cactusbed: 0.18, specimen: 0.18, yucca: 0.14 };
  var WW = { scrub: 0.38, boulders: 0.15, saguaro: 0.14, tree: 0.16, pear: 0.13, redrock: 0.04 };
  function* placeSteps() {
    var t0 = now(); mgInit(); var G = 8, tq = tierQ(); var dq = [0.4, 0.62, 0.85, 1][tq] * K.dens;
    var i0 = Math.floor((T.xmin + K.edge) / G), i1 = Math.floor((T.xmax - K.edge) / G), j0 = Math.floor((T.zmin + K.edge) / G), j1 = Math.floor((T.zmax - K.edge) / G), tA = now();
    for (var j = j0; j <= j1; j++) { for (var i = i0; i <= i1; i++) {
        var r = rng(h2(i, j) * 4294967296 ^ 0x5eed); var x = (i + 0.15 + r() * 0.7) * G, z = (j + 0.15 + r() * 0.7) * G;
        var k = idx(x, z); if (k < 0 || R.ex[k] || R.dist[k] * R.dk < K.clear) continue;
        var zw = zoneW(x, z), mask = fbm(x / 130, z / 130), keep = (mask - 0.24) * 2.4; if (r() > Math.min(1, keep) * zw * dq) { if (zw >= 0.65) { var ns = r() < 0.75 * dq ? ri(r, 1, 3) : 0; for (var q = 0; q < ns; q++) add(pick(r, ["br", "br", "br", "ts", "bar", "agc", "pp", "gc"]), x + rf(r, -3, 3), z + rf(r, -3, 3), undefined, r); } continue; }
        var dd = R.dist[k] * R.dk, garden = zw >= 0.85 && dd < 26 + fbm(x / 60 + 9, z / 60) * 14;
        var red = fbm(x / 210 - 40, z / 210 + 13) > 0.66;
        var type = garden ? wpick(r, GW) : red && r() < 0.4 ? "redrock" : wpick(r, WW);
        try { CL[type](x, z, r); cnt("cl_" + type); } catch (e) { err("clump " + type, e); }
      }
      if (now() - tA > (CPFL ? 2 : 5)) { yield 1; tA = now(); } }
    FL.t.place = Math.round(now() - t0); FL.n.items = IN.sp.length;
  }

  // ───────────────────────── materials ─────────────────────────
  var FO = function () { var f = window.PLAN_FOLIAGE; return f && !f.off && f.ST ? f : null; };
  function recolor(tex, fn, maxSize) {   // a canvas copy of a model's albedo map, recoloured per pixel (null when the map is not drawable)
    var im = tex && tex.image; if (!im || !(im.width > 0) || tex.isCompressedTexture || tex.isDataTexture) return null;
    var w = im.width, h = im.height, s = Math.min(1, (maxSize || 1024) / Math.max(w, h)); w = Math.max(4, Math.round(w * s)); h = Math.max(4, Math.round(h * s));
    var c = document.createElement("canvas"); c.width = w; c.height = h; var g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0, w, h); var d = g.getImageData(0, 0, w, h), a = d.data;
    for (var p = 0; p < a.length; p += 4) fn(a, p, (p >> 2) % w, Math.floor((p >> 2) / w)); g.putImageData(d, 0, 0);
    var t = new THREE.CanvasTexture(c); t.flipY = tex.flipY; t.colorSpace = tex.colorSpace; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT; t.channel = tex.channel || 0; t.anisotropy = tex.anisotropy || 4; t.minFilter = tex.minFilter; t.magFilter = tex.magFilter; t.name = (tex.name || "") + "_fl"; t.needsUpdate = true; return t;
  }
  // palo verde in full bloom: the leaflet clusters turn to masses of small yellow flowers, a little green showing through
  function bloomPx(a, p, x, y) { var r = a[p], g = a[p + 1], b = a[p + 2]; var l = (r * 0.3 + g * 0.59 + b * 0.11) / 255; var n = h2(x >> 2, y >> 2), n2 = h2(x, y);
    if (n < 0.66) { var k = 0.5 + 0.7 * l + (n2 - 0.5) * 0.25; a[p] = Math.min(235, 228 * k); a[p + 1] = Math.min(215, 192 * k); a[p + 2] = Math.min(110, 46 * k + 14); } else if (n < 0.8) { a[p] = Math.min(235, r * 0.6 + 70); a[p + 1] = Math.min(225, g * 0.75 + 45); } }
  // Santa Rita prickly pear: violet pads, rose at the rims
  function purplePx(a, p) { var r = a[p], g = a[p + 1], b = a[p + 2]; var l = (r * 0.3 + g * 0.59 + b * 0.11); var gr = g - Math.max(r, b);
    if (gr > -8) { a[p] = Math.min(240, l * 1.05 + 18); a[p + 1] = Math.max(30, l * 0.62); a[p + 2] = Math.min(235, l * 1.12 + 22); } }
  function foClone(src, mapT, tint, F, tier) {   // a material for one tier: plan_foliage's program and kind setup, my own fade uniforms
    var c = src.clone(); c.name = src.name; if (mapT) c.map = mapT; if (tint) c.color.multiply(tint);
    var fo = FO(), st = fo && fo.ST.get(src);
    if (st) { var u0 = st.u, myF = { value: F.clone() }, myT = { value: tier }; var hook = src._userObc !== undefined ? src._userObc : src.onBeforeCompile;
      c.onBeforeCompile = function (sh, r) { if (hook) hook.call(this, sh, r); sh.uniforms.uFolF = myF; sh.uniforms.uFolTier = myT; };
      c.customProgramCacheKey = src.customProgramCacheKey; c.userData.flF = myF; c.userData.flT = myT;
      fo.ST.set(c, { u: Object.assign({}, u0, { uFolF: myF, uFolTier: myT }), chain: st.chain, kind: st.kind, role: st.role, key: st.key, src: src, tier: tier, flora: true });
    } else { var prev = src._userObc !== undefined ? src._userObc : null; if (prev) c.onBeforeCompile = prev; }
    c.needsUpdate = true; return c;
  }
  var MAT = FL.mats = {};
  function variantMaps(S, m) {   // the recoloured maps a variant needs, made once per kind and variant
    var key = S.kind + ":" + (S.v || ""); if (MAT[key]) return MAT[key];
    var out = { maps: [], tint: null };
    m.parts.forEach(function (p, i) { var mt = p.material, leaf = mt && (mt.alphaTest > 0.05 || /leaf/i.test(mt.name || "")); var t = null;
      try { if (S.v === "bloom" && leaf && mt.map) t = recolor(mt.map, bloomPx, 1024); else if (S.v === "purple" && mt.map) t = recolor(mt.map, purplePx, 512); } catch (e) { err("recolor " + key, e); }
      out.maps[i] = t; });
    if (S.v === "gold") out.tint = new THREE.Color(1.22, 1.12, 0.62);
    if (S.v === "red") out.tint = new THREE.Color(0.64, 0.47, 0.42);
    if (S.v === "tan") out.tint = new THREE.Color(0.84, 0.74, 0.6);
    if (S.v === "purple" && !out.maps.some(Boolean)) out.tint = new THREE.Color(1.15, 0.62, 1.2);
    if (S.v === "bloom" && !out.maps.some(Boolean)) out.tint = new THREE.Color(1.9, 1.45, 0.25);
    MAT[key] = out; return out;
  }
  var TL = new THREE.TextureLoader();
  function ldTex(p, srgb, rep) { var t = TL.load(p + "?v=" + (window.BUILD || 0), function () { t.userData.ok = true; }, undefined, function () { t.userData.bad = true; err("texture", p); }); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = tierQ() >= 3 ? 16 : 8; return t; }
  var SHR = null;   // the flowering shrub cards
  function shrubMat() { if (SHR) return SHR; var tex = ldTex("/tex/fl_shrubs.png", true, false); tex.anisotropy = 4;
    var m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.72, metalness: 0 }); m.name = "fl_shrub leaf";
    var fo = FO(); if (fo && fo.patch) { var st = fo.patch(m, "fl_shrub", "leaf"); if (st) { st.role = "leaf"; st.t = 1; var u = st.u; u.uFolK.value.set(0.7, 1.1, 0.7, 1); u.uFolC.value.set(0, 0.55, 0, 0.55); u.uFolE.value.set(0.7, 0.55, 0.7, 1); u.uFolTint.value.set(1.1, 1.08, 0.7, 1); u.uFolM.value.set(0, 0.4, 0.3, 0); if (tierQ() >= 2) u.uFolTr.value.set(0.28, 5, 0.1, 1); } }
    SHR = m; return m; }
  function cardGeo(tile, w, h) {   // three crossed cards (60 degrees apart), leaning out a little, uv in the atlas tile
    var P = [], U = [], N = [], I = [], u0 = tile / 4, u1 = (tile + 1) / 4, lean = 0.12;
    for (var k = 0; k < 3; k++) { var a = k * Math.PI / 3, c = Math.cos(a), s = Math.sin(a), b = P.length / 3;
      P.push(-c * w / 2, 0, s * w / 2, c * w / 2, 0, -s * w / 2, c * w / 2 * (1 + lean), h, -s * w / 2 * (1 + lean), -c * w / 2 * (1 + lean), h, s * w / 2 * (1 + lean));
      U.push(u0, 0, u1, 0, u1, 1, u0, 1); for (var q = 0; q < 4; q++) N.push(s, 0, c); I.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); g.setIndex(I); g.computeBoundingSphere(); g.computeBoundingBox(); return g; }

  // ───────────────────────── the tiers ─────────────────────────
  // per species: tiers [{ geos, mats, r0, r1, meshes, cap }], the model frame for the impostor
  var GRP = null;
  function tierScale() { return [0.5, 0.68, 0.85, 1][tierQ()]; }
  function setupSpecies(S) {
    var tq = tierQ(), f = tierScale(); S.nearR = Math.max(14, S.near * f); S.tiers = [];
    if (S.card !== undefined) { var g = cardGeo(S.card, S.w, S.h); S.model = { parts: [{ geometry: g, material: shrubMat() }], height: S.h, radius: S.w / 2, sink: 0 }; S.hgt = S.h;
      var mat = shrubMat(); if (S.gc) { mat = foClone(mat, null, null, new THREE.Vector4(1e7, 2e7, 0, S.nearR), 0); }
      else { mat = foClone(mat, null, null, new THREE.Vector4(1e7, 2e7, 0, S.nearR), 0); }
      S.tiers.push({ geos: [g], mats: [mat], r0: 0, r1: S.nearR, cast: false }); return true; }
    var m = MODELS[S.kind]; if (!m || !m.parts || !m.parts.length || m.proxy) return false; S.model = m; S.hgt = m.height;
    var vm = variantMaps(S, m), sh = K.shad && S.sh && tq >= Math.max(2, S.sh);   // sh: 1 high and ultra, 3 ultra only
    var full = S.full * f, lod = !S.noLod && m.lodGeos && m.lodGeos.length === m.parts.length ? m.lodGeos : null; if (!lod) full = 0;
    var w = Math.max(5, Math.min(14, full * 0.2)), fo = !!FO();
    if (full > 0) { S.tiers.push({ geos: m.parts.map(function (p) { return p.geometry; }), mats: m.parts.map(function (p, i) { return foClone(p.material, vm.maps[i], vm.tint, new THREE.Vector4(full, full + w, 0, 1e9), 0); }), r0: 0, r1: fo ? full + w : full, cast: sh });
      S.tiers.push({ geos: lod, mats: m.parts.map(function (p, i) { return foClone(p.material, vm.maps[i], vm.tint, new THREE.Vector4(full, full + w, 0, S.nearR), 1); }), r0: full, r1: S.nearR, cast: sh }); }
    else { S.tiers.push({ geos: lod || m.parts.map(function (p) { return p.geometry; }), mats: m.parts.map(function (p, i) { return foClone(p.material, vm.maps[i], vm.tint, new THREE.Vector4(1e7, 2e7, 0, S.nearR), 0); }), r0: 0, r1: S.nearR, cast: sh }); }
    return true;
  }
  function makeMeshes(S) {
    S.tiers.forEach(function (tr) { tr.meshes = []; tr.cap = Math.max(16, Math.min(S.count, 512)); tr.n = 0;
      tr.geos.forEach(function (g, i) { var im = new THREE.InstancedMesh(g, tr.mats[i], tr.cap); im.count = 0; im.visible = false; im.frustumCulled = true; im.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
        im.castShadow = !!tr.cast; im.receiveShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.name = "flora " + S.id + " t" + S.tiers.indexOf(tr); im.userData.flora = true; im.userData.noBatch = true; im.userData.noCull = true; im.userData.noInst = true; im.userData.perf = true;
        GRP.add(im); OWN.add(im); tr.meshes.push(im); }); });
  }
  function growTier(tr, need) { var cap = tr.cap; while (cap < need) cap *= 2; tr.meshes.forEach(function (im, i) { var n2 = new THREE.InstancedMesh(im.geometry, im.material, cap); n2.count = 0; n2.visible = false; n2.frustumCulled = true; n2.boundingSphere = im.boundingSphere; n2.castShadow = im.castShadow; n2.receiveShadow = true; n2.instanceMatrix.setUsage(THREE.DynamicDrawUsage); n2.name = im.name; n2.userData = im.userData; GRP.remove(im); OWN.delete(im); im.dispose(); GRP.add(n2); OWN.add(n2); tr.meshes[i] = n2; }); tr.cap = cap; cnt("grow"); }

  // ───────────────────────── instances: matrices and the chunk grid ─────────────────────────
  var MYCOL = [];
  var NI = 0, ISP = null, IX = null, IZ = null, IMAT = null, CH = null;
  function* finishInstances() {
    var n = IN.sp.length, mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), qt = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tA = now();
    var keep = []; for (var i = 0; i < n; i++) if (SP[IN.sp[i]].ok) keep.push(i);
    NI = keep.length; ISP = new Uint8Array(NI); IX = new Float32Array(NI); IZ = new Float32Array(NI); IMAT = new Float32Array(NI * 16); var IY = FL.IY = new Float32Array(NI), IS = FL.IS = new Float32Array(NI * 2), IR = FL.IR = new Float32Array(NI);
    for (var k = 0; k < NI; k++) { var j = keep[k], S = SP[IN.sp[j]], m = S.model, x = IN.x[j], z = IN.z[j], sc = IN.s[j], sy = IN.sy[j], rot = IN.rot[j];
      var y = sampleGrid(H, T, x, z), rr = Math.max(0.3, (m.radius || 0.5) * sc * 0.6);
      if (S.rock) { var lo = Math.min(y, sampleGrid(H, T, x + rr, z), sampleGrid(H, T, x - rr, z), sampleGrid(H, T, x, z + rr), sampleGrid(H, T, x, z - rr)); y = lo - S.sink * m.height * sc * sy; }
      else if (S.sink) { y = Math.min(y, sampleGrid(H, T, x + rr, z), sampleGrid(H, T, x - rr, z), sampleGrid(H, T, x, z + rr), sampleGrid(H, T, x, z - rr)) - S.sink * m.height * sc * sy; }
      else { var lo2 = Math.min(y, sampleGrid(H, T, x + rr, z), sampleGrid(H, T, x - rr, z), sampleGrid(H, T, x, z + rr), sampleGrid(H, T, x, z - rr)); y = Math.min(y - 0.03, lo2 + 0.02) - (m.sink || 0); }
      e.set(IN.tx[j], 0, IN.tz[j]); qt.setFromEuler(e); q.setFromAxisAngle(up, rot).premultiply(qt); p.set(x, y, z); s.set(sc, sc * sy, sc); mtx.compose(p, q, s); mtx.toArray(IMAT, k * 16);
      ISP[k] = S.i; IX[k] = x; IZ[k] = z; IY[k] = y; IS[k * 2] = sc; IS[k * 2 + 1] = sy; IR[k] = rot; S.count = (S.count || 0) + 1;
      // colliders for the plants you would walk into
      if (S.col && !S.card) { var cr = (S.tree ? 0.35 : (m.radius || 0.5) * S.col) * sc; if (cr > 0.18) { var cc = [x, z, cr]; COLLIDERS.push(cc); MYCOL.push(cc); } }
      if (CPFL ? (k & 511) === 511 && now() - tA > 2 : (k & 4095) === 4095 && now() - tA > 6) { yield 1; tA = now(); } }
    // chunk grid (CSR): cells of K.chunk metres
    var C = K.chunk, cw = Math.ceil((T.xmax - T.xmin) / C), cd = Math.ceil((T.zmax - T.zmin) / C), cntA = new Int32Array(cw * cd + 1), cell = new Int32Array(NI);
    for (var a = 0; a < NI; a++) { var ci = Math.max(0, Math.min(cw - 1, Math.floor((IX[a] - T.xmin) / C))) + Math.max(0, Math.min(cd - 1, Math.floor((IZ[a] - T.zmin) / C))) * cw; cell[a] = ci; cntA[ci + 1]++; }
    for (var b = 0; b < cw * cd; b++) cntA[b + 1] += cntA[b]; var fill = cntA.slice(0, cw * cd), ord = new Int32Array(NI); for (var c2 = 0; c2 < NI; c2++) ord[fill[cell[c2]]++] = c2;
    CH = FL.CH = { C: C, W: cw, D: cd, start: cntA, ord: ord };
  }

  // ───────────────────────── the near tiers (camera ring) ─────────────────────────
  var NR = FL.NR = { at: null, t: 0, ms: 0, n: 0, maxR: 0 };
  function nearUpdate(force) {
    if (!CH || !GRP || STATE !== "done") return; var cam = camera.position, cx = cam.x, cz = cam.z, t = now();
    if (!force && NR.at && Math.hypot(cx - NR.at[0], cz - NR.at[1]) < K.refill && t - NR.t < 4000) return;
    var t0 = t; NR.at = [cx, cz]; NR.t = t; var maxR = NR.maxR + K.refill;
    for (var s = 0; s < SP.length; s++) { var S = SP[s]; if (!S.ok || !S.count) continue; for (var q = 0; q < S.tiers.length; q++) S.tiers[q].n = 0; }
    var C = CH.C, i0 = Math.max(0, Math.floor((cx - maxR - T.xmin) / C)), i1 = Math.min(CH.W - 1, Math.floor((cx + maxR - T.xmin) / C)), j0 = Math.max(0, Math.floor((cz - maxR - T.zmin) / C)), j1 = Math.min(CH.D - 1, Math.floor((cz + maxR - T.zmin) / C));
    var st = CH.start, ord = CH.ord, tot = 0;
    for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) { var ci = j * CH.W + i, a = st[ci], b = st[ci + 1]; if (a === b) continue;
      for (var k = a; k < b; k++) { var id = ord[k], S2 = SP[ISP[id]], dx = IX[id] - cx, dz = IZ[id] - cz, d2 = dx * dx + dz * dz, pad = K.refill + 1;
        for (var q2 = 0; q2 < S2.tiers.length; q2++) { var tr = S2.tiers[q2]; if (!tr.meshes) continue; var lo = Math.max(0, tr.r0 - pad), hi = tr.r1 + pad; if (d2 < lo * lo || d2 > hi * hi) continue;
          if (tr.n >= tr.cap) growTier(tr, tr.n + 1);
          var o = tr.n * 16, src = id * 16; for (var mm = 0; mm < tr.meshes.length; mm++) { var arr = tr.meshes[mm].instanceMatrix.array; for (var z = 0; z < 16; z++) arr[o + z] = IMAT[src + z]; }
          tr.n++; tot++; } } }
    for (var s2 = 0; s2 < SP.length; s2++) { var S3 = SP[s2]; if (!S3.ok || !S3.count) continue; var hr = (S3.hgt || 2) * (S3.s[1] || 1) * 2.2 + 2;
      for (var q3 = 0; q3 < S3.tiers.length; q3++) { var tr3 = S3.tiers[q3]; for (var m3 = 0; m3 < tr3.meshes.length; m3++) { var im = tr3.meshes[m3]; im.count = tr3.n; im.visible = tr3.n > 0 && !NR.hide; im.castShadow = !!tr3.cast; im.boundingSphere.center.set(cx, cam.y, cz); im.boundingSphere.radius = tr3.r1 + K.refill + hr; if (tr3.n) { im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, tr3.n * 16); im.instanceMatrix.needsUpdate = true; } } } }
    NR.n = tot; NR.ms = +(now() - t0).toFixed(2); cnt("nearUpd");
  }

  // ───────────────────────── impostors ─────────────────────────
  // atlas tiles: two side views per species (card A faces +z, card B faces +x), albedo (sRGB) and model-space normals; 256 px
  var IMP = FL.imp = { tile: 256, cols: 8, rows: 0, alb: null, nrm: null, mesh: null, mat: null, frames: {} };
  var BAKE_NV = "varying vec3 vN; varying vec2 vUv; void main() { vN = normal; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
  var BAKE_NF = "uniform sampler2D map; uniform float useMap; uniform float aTest; varying vec3 vN; varying vec2 vUv; void main() { float a = useMap > 0.5 ? texture2D(map, vUv).a : 1.0; if (a < aTest) discard; vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0); gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }";
  function* bakeImpostors() {
    var list = SP.filter(function (S) { return S.ok && !S.noImp && S.count; }); if (!list.length) return false;
    var T2 = IMP.tile, cols = IMP.cols, rows = Math.ceil(list.length * 3 / cols); IMP.rows = rows;
    T2 = IMP.tile = tierQ() >= 2 ? 192 : 128; var mk = function (srgb, ts) { var rt = new THREE.WebGLRenderTarget(ts * cols, ts * rows, { depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, type: THREE.UnsignedByteType }); rt.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; rt.texture.anisotropy = 4; return rt; };
    var TN = T2 / 2, ra = mk(true, T2), rn = mk(false, TN), sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    var tmp = [], G = [];
    // the bake groups (albedo: unlit map x colour x vertex colour; normals: model-space, cut out like the leaves)
    list.forEach(function (S) {
      var m = S.model, vm = S.card !== undefined ? { maps: [], tint: null } : variantMaps(S, m), g = new THREE.Group(), gN = new THREE.Group(), parts = m.parts;
      parts.forEach(function (p, i) { var src = S.card !== undefined ? shrubMat() : p.material, map = vm.maps[i] || src.map || null, at = Math.max(0.5, src.alphaTest || 0), cut = !!map && (src.alphaTest > 0 || S.card !== undefined);
        var col = src.color ? src.color.clone() : new THREE.Color(1, 1, 1); if (vm.tint) col.multiply(vm.tint);
        var ba = new THREE.MeshBasicMaterial({ map: map, color: col, alphaTest: cut ? at : 0, side: THREE.DoubleSide, vertexColors: !!src.vertexColors, toneMapped: false, fog: false });
        var bn = new THREE.ShaderMaterial({ vertexShader: BAKE_NV, fragmentShader: BAKE_NF, side: THREE.DoubleSide, uniforms: { map: { value: map }, useMap: { value: cut ? 1 : 0 }, aTest: { value: at } } });
        tmp.push(ba, bn); g.add(new THREE.Mesh(p.geometry, ba)); gN.add(new THREE.Mesh(p.geometry, bn)); });
      var bb = new THREE.Box3(); parts.forEach(function (p) { if (!p.geometry.boundingBox) p.geometry.computeBoundingBox(); bb.union(p.geometry.boundingBox); });
      S.frame = Math.max(bb.max.y, 2 * Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z))) * 1.04; IMP.frames[S.id] = S.frame; S.hc = Math.min(0.95, (S.tree ? 0.66 : 0.5) * bb.max.y / S.frame);
      G.push([S, g, gN]); });
    // compile the bake programs off the main thread first (no stall when they first draw)
    var done = false; try { G.forEach(function (q) { sc.add(q[1]); sc.add(q[2]); }); var pr0 = renderer.compileAsync ? renderer.compileAsync(sc, cam) : null; if (pr0 && pr0.then) pr0.then(function () { done = true; }, function () { done = true; }); else done = true; } catch (e) { done = true; err("bake compile", e); }
    var tw = now(); while (!done && now() - tw < 10000) yield 0;
    G.forEach(function (q) { sc.remove(q[1]); sc.remove(q[2]); }); yield 1;
    var prevT = renderer.getRenderTarget(), prevC = new THREE.Color(), prevA = renderer.getClearAlpha(), prevAuto = renderer.autoClear, prevSh = renderer.shadowMap.autoUpdate, prevTM = renderer.toneMapping; renderer.getClearColor(prevC);
    try {
      renderer.autoClear = false; renderer.shadowMap.autoUpdate = false; renderer.toneMapping = THREE.NoToneMapping;
      [ra, rn].forEach(function (rt, w) { renderer.setRenderTarget(rt); renderer.setClearColor(w ? new THREE.Color(0.5, 0.5, 1) : new THREE.Color(0.32, 0.33, 0.24), 0); renderer.clear(true, true, true); });
      G.forEach(function (q, li) { var S = q[0], F = S.frame;
        cam.left = -F / 2; cam.right = F / 2; cam.top = F; cam.bottom = 0; cam.near = 0.1; cam.far = 400; cam.updateProjectionMatrix();
        for (var v = 0; v < 3; v++) { var ti = li * 3 + v, tx = ti % cols, ty = Math.floor(ti / cols);
          if (v === 2) { cam.left = -F / 2; cam.right = F / 2; cam.top = F / 2; cam.bottom = -F / 2; cam.updateProjectionMatrix(); cam.up.set(0, 0, -1); cam.position.set(0, 200, 0); cam.lookAt(0, 0, 0); cam.up.set(0, 1, 0); }
          else if (v === 0) { cam.position.set(0, 0, 200); cam.lookAt(0, 0, 0); } else { cam.position.set(200, 0, 0); cam.lookAt(0, 0, 0); } cam.updateMatrixWorld(true);
          [[ra, q[1]], [rn, q[2]]].forEach(function (pr) { sc.add(pr[1]); var tz2 = pr[0] === rn ? TN : T2; pr[0].viewport.set(tx * tz2, ty * tz2, tz2, tz2); pr[0].scissor.set(tx * tz2, ty * tz2, tz2, tz2); pr[0].scissorTest = true; renderer.setRenderTarget(pr[0]); renderer.render(sc, cam); sc.remove(pr[1]); pr[0].scissorTest = false; pr[0].viewport.set(0, 0, pr[0].width, pr[0].height); pr[0].scissor.set(0, 0, pr[0].width, pr[0].height); }); }
        S.tile = li * 3; });
    } catch (e) { err("bake", e); }
    finally { renderer.setRenderTarget(prevT); renderer.setClearColor(prevC, prevA); renderer.autoClear = prevAuto; renderer.shadowMap.autoUpdate = prevSh; renderer.toneMapping = prevTM; tmp.forEach(function (mt) { mt.dispose(); }); }
    IMP.alb = ra; IMP.nrm = rn; IMP.list = list.map(function (S) { return S.id; }); return true;
  }
  // the impostor material: a MeshStandardMaterial whose vertex stage places each card from the instance attributes and whose normal
  // comes from the baked normal atlas; dithered in against plan_foliage's range dissolve of the 3D tier (same noise), out by size
  var IV = [
    "attribute vec4 iP; attribute vec4 iD; attribute float aCard; uniform vec4 uImpA; uniform vec4 uImpB; varying float vImpA;",
    "varying vec2 vImpCS; varying float vImpIn; varying float vImpOut; varying float vImpV;",
  ].join("\n");
  var IVB = [
    "float impC = cos( iP.w ), impS = sin( iP.w ); vImpCS = vec2( impC, impS );",
    "float impD = distance( cameraPosition.xz, iP.xz ); float impNear = iD.z, impFar = min( uImpA.z, iD.x * uImpA.w );",
    "vImpIn = 1.0 - smoothstep( impNear * 0.86, impNear, impD );",   // the 3D tier's range dissolve (kept where noise < vImpIn): the impostor keeps the rest
    "vImpOut = 1.0 - smoothstep( impFar * 0.8, impFar, impD ); vImpV = fract( iD.w );",
    "vec3 impL = position * iD.x; if ( aCard > 1.5 ) impL.y = floor( iD.w ) / 255.0 * iD.x; if ( ( impD < impNear * 0.86 - 0.5 || impD > impFar ) && uImpB.z < 0.5 ) impL = vec3( 0.0 );",
    "vec3 transformed = vec3( impC * impL.x + impS * impL.z, impL.y, -impS * impL.x + impC * impL.z ) + iP.xyz;",
    "{ vec3 impWN = aCard > 1.5 ? vec3( 0.0, 1.0, 0.0 ) : aCard > 0.5 ? vec3( impC, 0.0, -impS ) : vec3( impS, 0.0, impC ); vImpA = abs( dot( normalize( cameraPosition - transformed ), impWN ) ); }",
    "vec2 impT = vec2( mod( iD.y + aCard, uImpB.x ), floor( ( iD.y + aCard ) / uImpB.x ) );",
    "vMapUv = ( impT + clamp( uv, vec2( 0.004 ), vec2( 0.996 ) ) ) / uImpB.xy;",
  ].join("\n");
  var IVN = "vec3 objectNormal = vec3( impS * normal.z + impC * normal.x, normal.y, impC * normal.z - impS * normal.x );";
  var IF = [
    "uniform sampler2D tImpN; uniform vec4 uFolA; uniform vec4 uImpB; varying float vImpA; varying vec2 vImpCS; varying float vImpIn; varying float vImpOut; varying float vImpV;",
    "float impIgn( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }",
  ].join("\n");
  var IFD = [
    "if ( uImpB.z < 0.5 ) { if ( impIgn( gl_FragCoord.xy * 0.73 + uFolA.zw + 5.3 ) >= smoothstep( 0.1, 0.32, vImpA ) ) discard; if ( vImpIn > 0.001 && impIgn( gl_FragCoord.yx * 1.37 + uFolA.wz + 3.7 ) < vImpIn ) discard;",
    "if ( vImpOut < 0.999 && impIgn( gl_FragCoord.xy * 0.91 + uFolA.zw + 9.1 ) >= vImpOut ) discard; }",
  ].join("\n");
  var IFA = [   // cut-out with the coverage kept down the mips (the cards are small far away)
    "{ float impA = diffuseColor.a; vec2 impTs = vec2( textureSize( map, 0 ) ); vec2 impDx = dFdx( vMapUv * impTs ), impDy = dFdy( vMapUv * impTs ); float impMip = max( 0.0, 0.5 * log2( max( dot( impDx, impDx ), dot( impDy, impDy ) ) ) ); impA *= 1.0 + impMip * 0.28; if ( impA < 0.5 ) discard; }",
  ].join("\n");
  var IFN = [
    "{ vec3 impM = texture2D( tImpN, vMapUv ).xyz * 2.0 - 1.0; vec3 impW = vec3( vImpCS.y * impM.z + vImpCS.x * impM.x, impM.y, vImpCS.x * impM.z - vImpCS.y * impM.x );",
    "  normal = normalize( ( viewMatrix * vec4( normalize( impW + vec3( 0.0, 0.25, 0.0 ) ), 0.0 ) ).xyz ); }",
  ].join("\n");
  function impMaterial() {
    var foA = FO() && FO().U && FO().U.uFolA && FO().U.uFolA.value ? FO().U.uFolA : { value: new THREE.Vector4(0, 0, 0, 0) };
    var tq = tierQ(), far = [420, 650, 950, 1350][tq], kpx = [260, 380, 520, 700][tq];
    var U = { tImpN: { value: IMP.nrm.texture }, uImpA: { value: new THREE.Vector4(0, 0, far, kpx) }, uImpB: { value: new THREE.Vector4(IMP.cols, IMP.rows, 0, 0) }, uFolA: foA };
    // the plain standard material class: under the client's cascaded-shadow wrapper this vertex-placed material came out about ten
    // times too bright (measured against the 3D tier in the same frame); without it the sun and sky light it like the 3D plants
    var Std = THREE.MeshStandardMaterial; try { var P0 = Object.getPrototypeOf(Std); if (CSMX && CSMX.on && typeof P0 === "function" && P0 !== Function.prototype && P0.prototype instanceof THREE.Material) Std = P0; } catch (e) {}
    var m = new Std({ map: IMP.alb.texture, roughness: 0.82, metalness: 0, side: THREE.DoubleSide }); m.name = "flora impostor";
    m.onBeforeCompile = function (sh) { Object.assign(sh.uniforms, U);
      // the placement runs after uv_vertex (it sets vMapUv) and before the normal and position stages (begin_vertex is replaced)
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + IV).replace("#include <color_vertex>", "#include <color_vertex>\n" + IVB).replace("#include <beginnormal_vertex>", IVN).replace("#include <begin_vertex>", "");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + IF).replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n" + IFD)
        .replace("#include <alphatest_fragment>", IFA).replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" + IFN)
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 0.9 + 0.2 * vImpV;"); };
    m.customProgramCacheKey = function () { return "flimp1"; };
    m.userData.U = U; IMP.U = U; return m;
  }
  function impGeo() {   // two crossed unit cards: A in the xy plane (faces +z), B in the zy plane (faces +x); the bake views match
    var P = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0, 0, 0, 0.5, 0, 0, -0.5, 0, 1, -0.5, 0, 1, 0.5, -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5];
    var U2 = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 0, 0], N = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], C = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2], I = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11];
    var g = new THREE.InstancedBufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U2, 2)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); g.setAttribute("aCard", new THREE.Float32BufferAttribute(C, 1)); g.setIndex(I); return g; }
  function buildImpostors() {
    if (!K.imp || !IMP.alb) return; var n = 0; for (var i = 0; i < NI; i++) if (SP[ISP[i]].tile !== undefined) n++; if (!n) return;
    // all impostor instances, sorted into 64 m blocks; each refill copies only the blocks in reach and in a widened view into the
    // drawn buffer (most of the map's plants are behind the camera or out of range at any time)
    var BC = 64, bw = Math.ceil((T.xmax - T.xmin) / BC), bd = Math.ceil((T.zmax - T.zmin) / BC), cntB = new Int32Array(bw * bd + 1), blk = new Int32Array(n), ids = new Int32Array(n), k = 0;
    for (var j = 0; j < NI; j++) { if (SP[ISP[j]].tile === undefined) continue; var b = Math.max(0, Math.min(bw - 1, Math.floor((IX[j] - T.xmin) / BC))) + Math.max(0, Math.min(bd - 1, Math.floor((IZ[j] - T.zmin) / BC))) * bw; blk[k] = b; ids[k] = j; cntB[b + 1]++; k++; }
    for (var q = 0; q < bw * bd; q++) cntB[q + 1] += cntB[q]; var fill = cntB.slice(0, bw * bd), SP4 = new Float32Array(n * 4), SD4 = new Float32Array(n * 4), minN = new Float32Array(bw * bd).fill(1e9), maxH = new Float32Array(bw * bd);
    for (var a = 0; a < n; a++) { var jj = ids[a], S = SP[ISP[jj]], o = fill[blk[a]]++, sc = FL.IS[jj * 2], sy = FL.IS[jj * 2 + 1];
      SP4[o * 4] = IX[jj]; SP4[o * 4 + 1] = FL.IY[jj]; SP4[o * 4 + 2] = IZ[jj]; SP4[o * 4 + 3] = FL.IR[jj];
      var fsz = S.frame * sc * (sy > 1.05 || sy < 0.95 ? Math.sqrt(sy) : 1); SD4[o * 4] = fsz; SD4[o * 4 + 1] = S.tile; SD4[o * 4 + 2] = S.nearR; SD4[o * 4 + 3] = Math.round((S.hc || 0.5) * 255) + h2(jj, 77) * 0.98;
      if (S.nearR < minN[blk[a]]) minN[blk[a]] = S.nearR; if (fsz > maxH[blk[a]]) maxH[blk[a]] = fsz; }
    IMP.B = { C: BC, W: bw, D: bd, start: cntB, P: SP4, D4: SD4, minN: minN, maxH: maxH, at: null, yaw: 0, t: 0, ms: 0, drawn: 0 };
    var g = impGeo(), aP = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), aD = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    aP.setUsage(THREE.DynamicDrawUsage); aD.setUsage(THREE.DynamicDrawUsage); g.setAttribute("iP", aP); g.setAttribute("iD", aD); g.instanceCount = 0;
    // the bounds of the whole layer (the cards' own unit bounds would let plan_perf's small-object pixel cull drop the mesh)
    var cxm = (T.xmin + T.xmax) / 2, czm = (T.zmin + T.zmax) / 2; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cxm, 0, czm), Math.hypot(T.xmax - T.xmin, T.zmax - T.zmin) / 2 + 50); g.boundingBox = new THREE.Box3(new THREE.Vector3(T.xmin, -100, T.zmin), new THREE.Vector3(T.xmax, 400, T.zmax));
    // no shadow receiving far away (the cascaded PCF lookups were most of the layer's cost; the 3D tier carries the shadows near)
    var mesh = new THREE.Mesh(g, impMaterial()); mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.name = "flora impostors"; mesh.userData.flora = true; mesh.userData.noBatch = true; mesh.userData.noCull = true; mesh.userData.noInst = true;
    GRP.add(mesh); OWN.add(mesh); IMP.mesh = mesh; IMP.n = n; impUpdate(true);
  }
  var _ifr = null, _ifm = null, _ifs = null;
  function impUpdate(force) {
    var B = IMP.B; if (!B || !IMP.mesh || !IMP.U) return; var cam = camera.position, t = now(), yw = 0; try { yw = yaw; } catch (e) {}
    if (!force && B.at && Math.hypot(cam.x - B.at[0], cam.z - B.at[1]) < 12 && Math.abs(cam.y - B.at[2]) < 12 && Math.abs(Math.atan2(Math.sin(yw - B.yaw), Math.cos(yw - B.yaw))) < 0.2 && t - B.t < 3000) return;
    var t0 = t; B.at = [cam.x, cam.z, cam.y]; B.yaw = yw; B.t = t;
    if (!_ifr) { _ifr = new THREE.Frustum(); _ifm = new THREE.Matrix4(); _ifs = new THREE.Sphere(); }
    var cc = camera.clone(); cc.fov = Math.min(170, camera.fov + 50); cc.updateProjectionMatrix(); cc.updateMatrixWorld(true); _ifm.multiplyMatrices(cc.projectionMatrix, cc.matrixWorldInverse); _ifr.setFromProjectionMatrix(_ifm);
    var U = IMP.U.uImpA.value, far = U.z, g = IMP.mesh.geometry, aP = g.attributes.iP, aD = g.attributes.iD, dP = aP.array, dD = aD.array, m = 0, h = Math.SQRT1_2 * B.C;
    for (var bz = 0; bz < B.D; bz++) for (var bx = 0; bx < B.W; bx++) { var bi = bz * B.W + bx, s0 = B.start[bi], s1 = B.start[bi + 1]; if (s0 === s1) continue;
      var cx = T.xmin + (bx + 0.5) * B.C, cz = T.zmin + (bz + 0.5) * B.C, d = Math.hypot(cx - cam.x, cz - cam.z);
      if (d - h > far || d + h < B.minN[bi] * 0.86 - 1) continue;   // out of reach, or every plant in it still in its 3D tier
      _ifs.center.set(cx, sampleGrid(H, T, cx, cz) + B.maxH[bi] * 0.5, cz); _ifs.radius = h + B.maxH[bi]; if (d > 40 && !_ifr.intersectsSphere(_ifs)) continue;
      var c = s1 - s0; dP.set(B.P.subarray(s0 * 4, s1 * 4), m * 4); dD.set(B.D4.subarray(s0 * 4, s1 * 4), m * 4); m += c; }
    IMP.mesh.castShadow = false; if (FL.beds) for (var bk in FL.beds) FL.beds[bk].castShadow = false;   // (something in the scene turned casting on for the whole layer once)
    g.instanceCount = m; aP.clearUpdateRanges(); aD.clearUpdateRanges(); if (m) { aP.addUpdateRange(0, m * 4); aD.addUpdateRange(0, m * 4); aP.needsUpdate = true; aD.needsUpdate = true; } IMP.mesh.visible = m > 0;
    B.drawn = m; B.ms = +(now() - t0).toFixed(2); cnt("impUpd");
  }

  // ───────────────────────── ground beds ─────────────────────────
  function bedMat(albP, nrmP, tile) { var a = ldTex(albP, true, true), nm = ldTex(nrmP, false, true);
    var m = new THREE.MeshStandardMaterial({ map: a, normalMap: nm, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.94, metalness: 0, transparent: true, depthWrite: false, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.name = "flora bed"; m.userData.tile = tile;
    // beds read near and mid range and fade into the ground far away (no polka dots from the air)
    m.onBeforeCompile = function (sh) { sh.fragmentShader = sh.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= 1.0 - smoothstep( 110.0, 320.0, length( vViewPosition ) );"); };
    m.customProgramCacheKey = function () { return "flbed1"; };
    return m; }
  function* buildBeds() {
    if (!K.beds) return; var defs = [["mulch", "/tex/fl_mulch.jpg", "/tex/fl_mulch_n.jpg", 1.6], ["dg", "/tex/fl_dg.jpg", "/tex/fl_dg_n.jpg", 2.2]], mats = {};
    for (var di = 0; di < defs.length; di++) { var def = defs[di], L = BEDS[def[0]]; if (!L.length) continue; var mat = bedMat(def[1], def[2], def[3]);
      var SEG = 14, P = [], Cc = [], Uv = [], I = [], tile = def[3], tA = now();
      var VB = []; for (var b = 0; b < L.length; b++) { var cx = L[b][0], cz = L[b][1], rad = L[b][2], sd = L[b][3], base = P.length / 3; VB.push(base, I.length);
        var y0 = sampleGrid(H, T, cx, cz) + 0.045; P.push(cx, y0, cz); Cc.push(1, 1, 1, 1); Uv.push(cx / tile, cz / tile);
        for (var ring = 0; ring < 2; ring++) for (var s = 0; s < SEG; s++) { var a = s / SEG * 6.2832, wob = 0.78 + 0.32 * vn(Math.cos(a) * 1.6 + sd, Math.sin(a) * 1.6 + sd * 0.7), rr = rad * wob * (ring ? 1 : 0.72);
          var x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr; P.push(x, sampleGrid(H, T, x, z) + 0.045, z); Cc.push(1, 1, 1, ring ? 0 : 0.96); Uv.push(x / tile, z / tile); }
        for (var s2 = 0; s2 < SEG; s2++) { var a0 = base + 1 + s2, a1 = base + 1 + (s2 + 1) % SEG, o0 = a0 + SEG, o1 = a1 + SEG; I.push(base, a1, a0, a0, a1, o1, a0, o1, o0); }
        if (now() - tA > (CPFL ? 2 : 5)) { yield 1; tA = now(); } }
      var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(Cc, 4)); g.setAttribute("uv", new THREE.Float32BufferAttribute(Uv, 2)); g.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
      if (CPFL && L.length > 64) {   /* R21 CP: the normals bed by bed in slices (no bed shares a vertex with another, so each slice gives the very values the whole-mesh pass gives) */
        yield 1; var PA = g.attributes.position.array, NV = PA.length / 3, NA = new Float32Array(NV * 3), tN = now();
        for (var b0 = 0; b0 < L.length; b0 += 128) { var b1 = Math.min(L.length, b0 + 128), v0 = VB[b0 * 2], i0 = VB[b0 * 2 + 1], v1 = b1 < L.length ? VB[b1 * 2] : NV, i1 = b1 < L.length ? VB[b1 * 2 + 1] : I.length;
          var tg = new THREE.BufferGeometry(), ti = new Uint32Array(i1 - i0); for (var q = i0; q < i1; q++) ti[q - i0] = I[q] - v0;
          tg.setAttribute("position", new THREE.BufferAttribute(PA.slice(v0 * 3, v1 * 3), 3)); tg.setIndex(new THREE.BufferAttribute(ti, 1)); tg.computeVertexNormals(); NA.set(tg.attributes.normal.array, v0 * 3); tg.dispose();
          if (now() - tN > 2) { yield 1; tN = now(); } }
        g.setAttribute("normal", new THREE.BufferAttribute(NA, 3)); yield 1;
      } else g.computeVertexNormals();
      g.computeBoundingSphere();
      if (def[0] === "dg") mat.color.setRGB(0.97, 0.9, 0.82);
      var mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false; mesh.renderOrder = -1; mesh.name = "flora beds " + def[0]; mesh.userData.flora = true; mesh.userData.noBatch = true; mesh.userData.noCull = true; mesh.userData.noInst = true;
      GRP.add(mesh); OWN.add(mesh); mats[def[0]] = mesh; cnt("beds_" + def[0], L.length); }
    FL.beds = mats;
  }

  // ───────────────────────── the build job ─────────────────────────
  var JOB = null, STATE = "wait";
  function* build() {
    var t0 = now(), tw = now();
    // wait for the walk grid, the cover raster (R8), plan_foliage's material setup and the plant models
    // wait for the walk grid, the cover raster (R8), plan_foliage's material setup, the path network, and a world that has stopped
    // registering keep-outs, roads and solids for 2 s (several modules add theirs after the world build)
    var sig0 = "", ts = now();
    while (true) { var cov = typeof COVER !== "undefined" && COVER.ready, fo = !window.PLAN_FOLIAGE || PLAN_FOLIAGE.off || PLAN_FOLIAGE.active || (window.PLAN_FOLIAGE.ST && PLAN_FOLIAGE.progAtDefer !== undefined), pp = !window.PLAN_PATHS || PLAN_PATHS.off || PLAN_PATHS.ready;
      var sg = worldSig(); if (sg !== sig0) { sig0 = sg; ts = now(); }
      var w = now() - tw; if (typeof XG !== "undefined" && XG.walkReady && ((cov && fo && pp && now() - ts > 2000) || w > 70000)) break; yield 0; }
    FL.sig = sig0;
    FL.t.wait = Math.round(now() - t0); var tb = now();
    FL.ph = "raster"; yield* rasterSteps();
    FL.ph = "place"; yield* placeSteps(); FL.ph = "species";
    GRP = new THREE.Group(); GRP.name = "flora"; GRP.userData.noShadowTree = true; GRP.userData.flora = true;   // noShadowTree: the client's shadow sweep would turn every mesh of the layer into a caster GRP.userData.noBatch = true; GRP.userData.noCull = true; GRP.userData.perf = true; GRP.userData.noInst = true;
    for (var s = 0; s < SP.length; s++) { var S = SP[s]; try { S.ok = setupSpecies(S); } catch (e) { S.ok = false; err("species " + S.id, e); } if (!S.ok) cnt("spMissing"); yield 1; }
    FL.ph = "finish"; yield* finishInstances(); FL.ph = "meshes";
    NR.maxR = 0; for (var mi = 0; mi < SP.length; mi++) { var S2 = SP[mi]; if (S2.ok && S2.count) { makeMeshes(S2); S2.tiers.forEach(function (tr) { if (tr.r1 > NR.maxR) NR.maxR = tr.r1; }); if (CPFL) yield 1; } }   /* R21 CP: a yield per species (?cpfl=0: all in one step, as before) */
    yield 1;
    { var tt = now(), sm = shrubMat().map; while (!(sm.userData.ok || sm.userData.bad) && now() - tt < 20000) yield 0; }
    FL.ph = "bake"; if (K.imp) { try { yield* bakeImpostors(); } catch (e) { err("bake", e); } yield 1; try { buildImpostors(); } catch (e) { err("impostors", e); } }
    FL.ph = "beds"; yield* buildBeds(); FL.ph = "compile";
    // compile the new programs before anything draws them (all tiers visible for the pass), then show the layer
    var cdone = false; try { GRP.traverse(function (o) { if (o.isMesh) o.visible = true; });
      if (CPFL && renderer.compileAsync && GRP.children.length > 1) {   /* R21 CP: one child of the layer a step (the synchronous part of a whole-layer compileAsync was 30 to 40 ms in one frame) */
        var cps = []; for (var ci = 0; ci < GRP.children.length; ci++) { try { cps.push(renderer.compileAsync(GRP.children[ci], camera, scene)); } catch (e) { err("compile", e); } yield 1; }
        Promise.all(cps).then(function () { cdone = true; }, function () { cdone = true; });
      } else { var pc = renderer.compileAsync ? renderer.compileAsync(GRP, camera, scene) : null; if (pc && pc.then) pc.then(function () { cdone = true; }, function () { cdone = true; }); else cdone = true; } } catch (e) { cdone = true; err("compile", e); }
    var tc = now(); while (!cdone && now() - tc < 12000) yield 0; FL.t.compile = Math.round(now() - tc);
    FL.ph = "show"; scene.add(GRP); nearUpdate(true); dropOld();
    // the raster and spacing grids are only needed while building
    FL.t.build = Math.round(now() - tb); FL.t.total = Math.round(now() - t0); MG.a = null; if (!/[?&]fldebug=1\b/.test(Q)) { R.soft = null; R.h1 = null; R.src = null; R.ex = null; R.dist = null; }   // ?fldebug=1 keeps the raster for PLAN_FLORA.map and spots
    IN = null; FL.ready = true; try { readyRes(true); } catch (e) {}
    console.log("PLAN_FLORA: " + NI + " plants (" + SP.filter(function (S) { return S.ok; }).length + " species), " + (IMP.n || 0) + " impostors, " + (BEDS.mulch.length + BEDS.dg.length) + " beds, free land " + Math.round(FL.n.freeM2 / 1e4) + " ha, build " + FL.t.build + " ms");
  }
  function loadingVisible() { var L = document.getElementById("load"); return !!L && !L.classList.contains("off"); }
  function frameHook() {
    if (FL.abOff) return;
    if (STATE === "run") {
      var budget = loadingVisible() ? 24 : K.budget, t0 = now();
      try { while (now() - t0 < budget) { var tq = now(); var r = JOB.next(); var dq = now() - tq; if (dq > CPM.step[0] && !loadingVisible()) { CPM.step[0] = +dq.toFixed(1); CPM.step[1] = FL.ph || ""; } if (r.done) { STATE = "done"; break; } if (r.value === 0) break; } } catch (e) { err("build", e); STATE = "failed"; try { readyRes(false); } catch (x) {} }
      if (OLD !== null) { var hd = false; try { hd = !!inside; } catch (e) {} if (OLD.grp.visible === hd) OLD.grp.visible = !hd; }   /* R21 CP: the old layer, while the new one builds */
      return; }
    if (STATE !== "done" || !GRP) return;
    var tw0 = now(); watchWorld(); var dw = now() - tw0; if (dw > CPM.watch) CPM.watch = +dw.toFixed(1); if (STATE !== "done" || !GRP) return;
    var hide = false; try { hide = !!inside; } catch (e) {} if (hide !== !!NR.hide) { NR.hide = hide; GRP.visible = !hide; }
    if (!hide) { try { nearUpdate(false); } catch (e) { err("near", e); } try { impUpdate(false); } catch (e) { err("imp", e); } }
  }
  var CPM = FL.cpMax = { step: [0, ""], watch: 0 };
  function deferHook() { if (STATE !== "wait") return; JOB = build(); STATE = "run"; }
  // what the open-land raster depends on: when a module registers more after the build, the layer is rebuilt (first minutes only)
  function worldSig() { var e = 0; try { e = window.PLAN_PATHS && PLAN_PATHS.edges ? PLAN_PATHS.edges.length : 0; } catch (x) {} try { return PLAN_KEEP_POLY.length + ":" + KEEPOUT.length + ":" + ROADS.length + ":" + e + ":" + Math.round(SOLIDS.length / 50) + ":" + PLAZAS.length; } catch (x) { return "?"; } }
  var WATCH = { t0: 0, at: 0, n: 0 };
  function watchWorld() { var t = now(); if (!WATCH.t0) WATCH.t0 = t; if (t - WATCH.t0 > 240000 || t - WATCH.at < 4000 || WATCH.n >= 3) return; WATCH.at = t; var sg = worldSig(); if (sg === FL.sig) return; WATCH.n++; cnt("rebuild"); try { console.log("PLAN_FLORA: the world changed (" + FL.sig + " -> " + sg + "), rebuilding"); } catch (e) {} var keep = CPFL ? keepOld() : null; reset(); if (keep) keep.own.forEach(function (o) { OWN.add(o); }); deferHook(); }
  // R21 CP (?cpfl=0): a rebuild in play keeps the old layer drawn (and its colliders) until the new one is shown; the new raster leaves
  // the old layer's meshes and colliders out, exactly as after a reset, so the new layout is the same
  var OLD = null;
  function keepOld() {
    if (!GRP) return null; dropOld(); OLD = { grp: GRP, imp: IMP.mesh, alb: IMP.alb, nrm: IMP.nrm, col: MYCOL.slice(), own: [] }; OLD.colS = new Set(OLD.col); OWN.forEach(function (o) { OLD.own.push(o); });
    GRP = null; IMP.alb = IMP.nrm = null; MYCOL.length = 0; return OLD;
  }
  function dropOld() {
    var O = OLD; if (!O) return; OLD = null;
    try { if (O.grp.parent) O.grp.parent.remove(O.grp); O.grp.traverse(function (o) { if (!o.isMesh) return; if (o.isInstancedMesh) o.dispose(); if (o === O.imp || /beds/.test(o.name)) o.geometry.dispose(); }); } catch (e) { err("drop old", e); }
    if (O.alb) O.alb.dispose(); if (O.nrm) O.nrm.dispose(); O.own.forEach(function (o) { OWN.delete(o); });
    var cw = 0; for (var c = 0; c < COLLIDERS.length; c++) { var cc = COLLIDERS[c]; if (!O.colS.has(cc)) COLLIDERS[cw++] = cc; } COLLIDERS.length = cw;
  }
  function reset() {
    if (GRP) { if (GRP.parent) GRP.parent.remove(GRP); GRP.traverse(function (o) { if (!o.isMesh) return; if (o.isInstancedMesh) o.dispose(); if (o === IMP.mesh || /beds/.test(o.name)) o.geometry.dispose(); }); GRP = null; }
    if (IMP.alb) IMP.alb.dispose(); if (IMP.nrm) IMP.nrm.dispose(); IMP.alb = IMP.nrm = IMP.mesh = IMP.B = null; IMP.n = 0; OWN.clear();
    var drop = new Set(MYCOL); if (CPFL) { var cw = 0; for (var c0 = 0; c0 < COLLIDERS.length; c0++) { var cc0 = COLLIDERS[c0]; if (!drop.has(cc0)) COLLIDERS[cw++] = cc0; } COLLIDERS.length = cw; } else for (var c = COLLIDERS.length - 1; c >= 0; c--) if (drop.has(COLLIDERS[c])) COLLIDERS.splice(c, 1); MYCOL.length = 0;   /* R21 CP: one pass (?cpfl=0: a splice each) */
    SP.forEach(function (S) { S.count = 0; S.ok = false; S.tiers = null; delete S.tile; });
    IN = { sp: [], x: [], y: [], z: [], rot: [], s: [], sy: [], tx: [], tz: [] }; BEDS = { mulch: [], dg: [] }; NI = 0; CH = null; NR.at = null; FL.ready = false; STATE = "wait"; }
  var HK = [{ name: "flora", fn: deferHook }, { name: "flora", fn: frameHook }];
  PLAN_HOOKS.defer.push(HK[0]); PLAN_HOOKS.frame.push(HK[1]);
  FL.start = deferHook;
  try { if (typeof XG !== "undefined" && XG.walkReady) deferHook(); } catch (e) {}   // loaded after the world was built (a dev re-evaluation)
  FL._dispose = function () { var i = PLAN_HOOKS.defer.indexOf(HK[0]); if (i >= 0) PLAN_HOOKS.defer.splice(i, 1); i = PLAN_HOOKS.frame.indexOf(HK[1]); if (i >= 0) PLAN_HOOKS.frame.splice(i, 1); STATE = "disposed";
    if (GRP) { if (GRP.parent) GRP.parent.remove(GRP); GRP.traverse(function (o) { if (!o.isMesh) return; if (o.isInstancedMesh) o.dispose(); if (o === IMP.mesh || /beds/.test(o.name)) o.geometry.dispose(); }); }
    if (IMP.alb) IMP.alb.dispose(); if (IMP.nrm) IMP.nrm.dispose();
    for (var c = 0; c < MYCOL.length; c++) { var k = COLLIDERS.indexOf(MYCOL[c]); if (k >= 0) COLLIDERS.splice(k, 1); } MYCOL.length = 0; };

  // ───────────────────────── debug and A/B ─────────────────────────
  FL.stat = function () { var o = { ready: FL.ready, state: STATE, items: NI, imp: IMP.n || 0, near: NR.n, nearMs: NR.ms, t: FL.t, n: FL.n, errs: FL.errs.slice(), species: {} };
    SP.forEach(function (S) { o.species[S.id] = { ok: !!S.ok, n: S.count || 0, tiers: (S.tiers || []).map(function (t) { return [Math.round(t.r0), Math.round(t.r1), t.n, t.cap]; }) }; }); return o; };
  FL.draws = function () { var n = 0, l = []; if (!GRP) return 0; GRP.traverse(function (o) { if (o.isMesh && o.visible && (o.isInstancedMesh ? o.count > 0 : true)) { n++; l.push(o.name); } }); return { n: n, list: l }; };
  FL.ab = function (on) { FL.abOff = !on; if (GRP) GRP.visible = !!on; if (on) { nearUpdate(true); impUpdate(true); } return !!on; };
  FL.near = function () { nearUpdate(true); impUpdate(true); return NR; };
  // debug: the plants of mine within r of (x, z), by species
  FL.around = function (x, z, r) { var o = { n: 0 }; for (var i = 0; i < NI; i++) { var dx = IX[i] - x, dz = IZ[i] - z; if (dx * dx + dz * dz > r * r) continue; o.n++; var id = SP[ISP[i]].id; o[id] = (o[id] || 0) + 1; } return o; };
  // debug: candidate camera spots on the property, in open land among my plants (for the before and after shots)
  FL.spots = function (n, r) { if (!R || !R.dist || !R.ex) return null; var out = [], tries = 0, rr = r || 35; var rnd = rng(1234); while (out.length < (n || 8) && tries++ < 20000) { var x = T.xmin + 60 + rnd() * (T.xmax - T.xmin - 120), z = T.zmin + 60 + rnd() * (T.zmax - T.zmin - 120); var zn = "off"; try { zn = planZone(x, z); } catch (e) {} if (zn === "off") continue; var k = idx(x, z); if (k < 0 || R.ex[k] || R.dist[k] * R.dk < 8) continue; var a = FL.around(x, z, rr); if (a.n < 25) continue; if (out.some(function (q) { return Math.hypot(q[0] - x, q[1] - z) < 150; })) continue; out.push([Math.round(x), Math.round(z), a.n]); } return out; };
  // a map of the raster (debug): 1 px per cell, red built, dark keep-out, olive soft, my plants green, beds brown
  FL.map = function (scale, bySrc) { if (!R || !R.dist || !R.ex) return null; var c = document.createElement("canvas"), sc = scale || 0.5; c.width = Math.round(R.W * sc); c.height = Math.round(R.D * sc); var g = c.getContext("2d"), im = g.createImageData(c.width, c.height), a = im.data;
    for (var y = 0; y < c.height; y++) for (var x = 0; x < c.width; x++) { var k = Math.floor(y / sc) * R.W + Math.floor(x / sc), p = (y * c.width + x) * 4, d = R.dist[k] * R.dk; var sc0 = (R.ex[k] || (R.h1 && R.h1[k])) && bySrc && R.src ? R.src[k] : 0; var col = sc0 ? [(sc0 * 97) % 200 + 40, (sc0 * 57) % 200 + 30, (sc0 * 151) % 200 + 40] : R.h1 && R.h1[k] ? [200, 60, 50] : R.ex[k] ? [70, 70, 80] : R.soft && R.soft[k] ? [140, 150, 90] : d < K.clear ? [210, 170, 140] : [235, 225, 205]; a[p] = col[0]; a[p + 1] = col[1]; a[p + 2] = col[2]; a[p + 3] = 255; }
    g.putImageData(im, 0, 0); g.fillStyle = "rgba(30,130,40,0.9)"; for (var i = 0; i < NI; i++) g.fillRect((IX[i] - R.x0) / R.C * sc, (IZ[i] - R.z0) / R.C * sc, 1, 1);
    return c.toDataURL("image/png"); };
})();
