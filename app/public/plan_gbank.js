// plan_gbank.js: GBANK and the Riverside Management Group suite (round 2, module G, IMPL2.md).
// 30 Sep 2026: the user asked for the round-2 pavilion back (the generated gbank model changed its look), so it is pinned
// here: PLAN_GBANK_PROC forces the procedural pavilion and the gbank model is neither requested nor used.
window.PLAN_GBANK_PROC = true;
// Classic script loaded before client.js. Everything lives in this closure; client globals are reached by bare name at
// hook time (never at load). All player-facing copy comes from /plan/partners.json (window.PLAN_PARTNERS).
//
// The site: a two-level desert-modern pavilion on the east side of Compass Plaza, on the plaza's east axis, its front and
// its wide exterior stair facing the Compass Fountain, clear of the compass rose, the Horizon Line and the Ring axis.
//   ground floor  GBANK hall: the capital flow installation (five stations, a light path with moving pulses) and the
//                 ledger wall (a scrolling on-chain ledger concept), reception, lounge, the $GBACK and real-world-asset panels
//   upper floor   the Riverside Management Group suite (Will Deitrick, executive desk, lounge chairs, bookcases) and the
//                 terrace, reached by the grand stair on the north side of the front
// Everything is walk-in (no teleport): floors, stair treads, walls and balustrades are box solids, the camera is kept
// inside the rooms and out of the walls by an interior hook. When the gbank model exists (MODELS.gbank) it becomes the
// exterior shell and the rooms open through door mats instead (see buildModelShell).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var HK = window.PLAN_HOOKS;
  // model kinds this module places when they exist (the engine loads a PLAN_MODEL_SPECS kind only if someone needs it)
  var NEEDS = window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || [];
  ["exec_desk", "lounge_chair", "bookcase", "planter_lux", "bench_lux", "lux_lamp", "datepalm", "canarypalm", "fanpalm2", "barrel_cactus", "agave_cluster", "yucca_cluster"].forEach(function (k) { if (NEEDS.indexOf(k) < 0) NEEDS.push(k); });

  var GB = window.PLAN_GBANK = { errs: [], n: {}, mode: null, built: false, site: null, hs: [], seats: [], lights: [] };
  function note(w, e) { var m = w + ": " + (e && e.message ? e.message : e); if (GB.errs.length < 40) GB.errs.push(m); if (GB.errs.length <= 5) console.warn("[gbank] " + m); }
  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  var seed = 1996; function rr() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

  // ── copy (partners.json) ──
  var DATA = null;
  try {
    fetch((window.AV || String)("/plan/partners.json?v=" + (window.BUILD || "dev"))).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (!d) { note("partners.json", "missing"); return; } DATA = GB.data = window.PLAN_PARTNERS = d; }).catch(function (e) { note("partners.json", e); });
  } catch (e) { note("partners.json", e); }
  function D(path, dflt) { var o = DATA; if (!o) return dflt; var p = path.split("."); for (var i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o == null ? dflt : o; }

  // ── the site: local frame (x across the front, z toward the plaza, y above the pad) ──
  var S = null;
  function site() {
    if (S) return S;
    var px = 821.8, pz = 472.8, pr = 45;
    try { var q = (window.PLAN.plazas || []).find(function (p) { return p.id === "pz_compass"; }); if (q) { px = q.x; pz = q.z; pr = q.r; } } catch (e) {}
    var th = 0.05, ux = Math.cos(th), uz = Math.sin(th), Dd = 94;   // 94 m east of the Compass Fountain, a hair south of due east (the Outpost Beacon stays clear)
    var cx = px + ux * Dd, cz = pz + uz * Dd, yaw = Math.atan2(-ux, -uz);   // the front faces the fountain
    S = GB.site = { px: px, pz: pz, pr: pr, cx: cx, cz: cz, yaw: yaw, cs: Math.cos(yaw), sn: Math.sin(yaw), B: null, D: Dd };
    return S;
  }
  function L2W(lx, lz) { return [S.cx + lx * S.cs + lz * S.sn, S.cz - lx * S.sn + lz * S.cs]; }
  function W2L(x, z) { var dx = x - S.cx, dz = z - S.cz; return [dx * S.cs - dz * S.sn, dx * S.sn + dz * S.cs]; }
  function wpoly(x0, x1, z0, z1) { return [L2W(x0, z0), L2W(x1, z0), L2W(x1, z1), L2W(x0, z1)]; }

  // layout (metres, local frame; y above the pad)
  var K = {
    pod: [-17, 17, -12, 12], podTop: 0.6,
    hall: [-16, 16, -11, 11], hy0: 0.6, hy1: 6.2,
    slab: [-16.5, 16.5, -11.5, 11.5], sy0: 6.2, TL: 6.6,
    suite: [-12, 12, -11, 2], uy1: 10.8,
    roof: [-13, 13, -11.5, 8], ry1: 11.2,
    stair: { x0: -16.6, x1: -11.4, zTop: 11.5, n: 36, tread: 0.3, land: 2.4, landK: 18 },
    door: 2.4, doorH: 3.4, sdoor: 1.2, sdoorH: 2.7,
    court: [-19.5, 19.5, 12.8, 33.2]
  };
  var RISE = K.TL / K.stair.n;
  // the z range of stair step k (1 at the foot .. n-1 next to the terrace; step landK is the landing)
  function stepZ(k) { var s = K.stair, t = s.tread; if (k > s.landK) { var a = s.zTop + (s.n - 1 - k) * t; return [a, a + t]; } var zl = s.zTop + (s.n - 1 - s.landK) * t; if (k === s.landK) return [zl, zl + s.land]; var b = zl + s.land + (s.landK - 1 - k) * t; return [b, b + t]; }
  var STAIR_FOOT = stepZ(1)[1];

  // ── geometry helpers (world-scaled UVs so tiled textures keep their size on merged meshes) ──
  function boxGeo(w, h, d, tile) { var g = new THREE.BoxGeometry(w, h, d); if (tile) { var uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (var f = 0; f < 6; f++) for (var i = 0; i < 4; i++) { var k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / tile, uv.getY(k) * dims[f][1] / tile); } } return g; }
  function B(g, w, h, d, mat, x, y, z, ry, tile) { var m = new THREE.Mesh(boxGeo(w, h, d, tile === undefined ? 1.6 : tile), mat); m.position.set(x, y, z); if (ry) m.rotation.y = ry; g.add(m); return m; }
  function BX(g, x0, x1, y0, y1, z0, z1, mat, tile) { return B(g, x1 - x0, y1 - y0, z1 - z0, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, tile); }
  function CY(g, r0, r1, h, mat, x, y, z, seg) { var m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg || 16), mat); m.position.set(x, y, z); g.add(m); return m; }
  function PL(g, w, h, mat, x, y, z, ry, rx) { var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.order = "YXZ"; if (ry) m.rotation.y = ry; if (rx) m.rotation.x = rx; g.add(m); return m; }
  function floorPlane(g, x0, x1, z0, z1, y, mat, tile) { var w = x1 - x0, d = z1 - z0; var geo = new THREE.PlaneGeometry(w, d); var uv = geo.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile); var m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); g.add(m); return m; }
  // a box between two local points (a rail or a sloped handrail)
  function beam(g, a, b, w, h, mat) { var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]; var L = Math.hypot(dx, dy, dz); var m = new THREE.Mesh(boxGeo(w, h, L, 1), mat); m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dx / L, dy / L, dz / L)); g.add(m); return m; }
  // canvas textures
  function cv(w, h, draw) { var c = document.createElement("canvas"); c.width = w; c.height = h; var x = c.getContext("2d"); draw(x, w, h); var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.userData.text = true; return t; }
  function spaced(x, text, px, py, sp) { try { x.letterSpacing = (sp || 0) + "px"; } catch (e) {} x.fillText(text, px, py); try { x.letterSpacing = "0px"; } catch (e) {} }
  function gold(x, y0, y1) { var gr = x.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, "#f6dea0"); gr.addColorStop(0.45, "#d6ad5c"); gr.addColorStop(1, "#a07636"); return gr; }
  var SERIF = "Georgia, 'Times New Roman', serif", SANS = "'Space Grotesk', system-ui, sans-serif", MONO = "'JetBrains Mono', ui-monospace, monospace", DISP = "Anton, Impact, sans-serif";

  // solids in the local frame (tag "gbank"); lvl marks seats for the level toggle
  var CAP = null; function addS(x, z, ry, w, d, y0, y1) { var sd = addSolid(x, z, ry, w, d, y0, y1, "gbank"); if (sd && CAP) CAP.push(sd); return sd; }
  function SOL(x0, x1, z0, z1, y0, y1) { var c = L2W((x0 + x1) / 2, (z0 + z1) / 2); return addS(c[0], c[1], S.yaw, x1 - x0, z1 - z0, S.B + y0, S.B + y1); }
  function seat(x0, x1, z0, z1, top, faceLocal, lvl) { var sd = SOL(x0, x1, z0, z1, top - 0.45, top); if (!sd) return; sd.face = S.yaw + faceLocal; sd.gbLvl = lvl; GB.seats.push(sd); }

  // ── materials ──
  // procedural wood textures (canvas, tiled by the world-scaled UVs): walnut veneer, pale oak slats, a wide-plank oak floor
  function woodTex(kind) { var S2 = kind === "floor" ? 1024 : 512; var t = cv(S2, S2, function (x, w, h) { var R = function () { return rr(); };
      if (kind === "floor") { var pl = 8, pw = w / pl; for (var i = 0; i < pl; i++) { var y0 = 0; while (y0 < h) { var L = h * (0.3 + 0.5 * R()); var b = 120 + R() * 26, gcol = "rgb(" + Math.round(b + 22) + "," + Math.round(b * 0.74 + 8) + "," + Math.round(b * 0.5) + ")"; x.fillStyle = gcol; x.fillRect(i * pw, y0, pw, L); for (var k = 0; k < 26; k++) { x.fillStyle = "rgba(60,36,20," + (0.05 + R() * 0.12) + ")"; var gx = i * pw + R() * pw; x.fillRect(gx, y0, 1 + R() * 2, L); } x.fillStyle = "rgba(30,18,10,0.55)"; x.fillRect(i * pw, y0 + L - 2, pw, 2); y0 += L; } x.fillStyle = "rgba(28,16,8,0.6)"; x.fillRect(i * pw, 0, 2, h); } return; }
      var base = kind === "oak" ? [196, 164, 124] : [92, 62, 44]; x.fillStyle = "rgb(" + base.join(",") + ")"; x.fillRect(0, 0, w, h);
      for (var j = 0; j < 900; j++) { var gx2 = R() * w, a = kind === "oak" ? 0.05 + R() * 0.1 : 0.06 + R() * 0.16, dk = R() < 0.6; x.strokeStyle = dk ? "rgba(" + (kind === "oak" ? "120,86,52" : "40,24,16") + "," + a + ")" : "rgba(" + (kind === "oak" ? "236,214,176" : "140,100,70") + "," + a * 0.8 + ")"; x.lineWidth = 0.6 + R() * 1.8; x.beginPath(); x.moveTo(gx2, 0); var wv = R() * 6; for (var yy = 0; yy <= h; yy += 32) x.lineTo(gx2 + Math.sin(yy / (60 + wv * 20) + j) * wv, yy); x.stroke(); } });
    t.userData.text = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
  var MT = null;
  function mats() {
    if (MT) return MT; var P = planMats();
    var trav = function (col, rough, nk) { return new THREE.MeshStandardMaterial({ map: P.stone.map, normalMap: P.stone.normalMap, roughnessMap: P.stone.roughnessMap, color: col, roughness: rough, metalness: 0, normalScale: new THREE.Vector2(nk || 0.5, nk || 0.5) }); };
    var std = function (o) { return new THREE.MeshStandardMaterial(o); };
    MT = {
      stone: trav(0xeadcc4, 0.92, 0.55), stoneWarm: trav(0xdcc7a6, 0.9, 0.6), stoneDark: trav(0x8f7c63, 0.85, 0.7), floor: trav(0xf2e9d8, 0.32, 0.25), pave: trav(0xe3d2b6, 0.95, 0.7),
      stucco: std({ map: TEX.adobeWall || null, color: 0xf1ebe0, roughness: 0.96 }),
      walnut: std({ map: woodTex("walnut"), color: 0xffffff, roughness: 0.48 }), walnutDark: std({ map: woodTex("walnut"), color: 0x9a8f86, roughness: 0.5 }), oak: std({ map: woodTex("oak"), color: 0xffffff, roughness: 0.62 }), floorWood: std({ map: woodTex("floor"), color: 0xe6dccf, roughness: 0.38 }),
      leather: std({ map: TEX.jetLeather, color: 0x9a6038, roughness: 0.55 }), leatherDark: std({ map: TEX.jetLeather, color: 0x3a2a22, roughness: 0.6 }),
      fabric: std({ map: TEX.jetCarpet, color: 0xd9cdb8, roughness: 0.95 }), fabricOlive: std({ map: TEX.jetCarpet, color: 0x7c7a5c, roughness: 0.95 }),
      rug: std({ map: TEX.jetCarpet, color: 0x8c7a62, roughness: 1 }), rugDeep: std({ map: TEX.jetCarpet, color: 0x3d4a3e, roughness: 1 }),
      wood: std({ map: TEX.wood, color: 0xc49a6c, roughness: 0.55 }),
      bronze: std({ color: 0x6f5233, metalness: 0.9, roughness: 0.32 }), bronzeDark: std({ color: 0x2f261e, metalness: 0.75, roughness: 0.42 }), brass: std({ color: 0xd6b064, metalness: 1, roughness: 0.22 }),
      black: std({ color: 0x121312, metalness: 0.25, roughness: 0.35 }), plaster: std({ color: 0xf4efe6, roughness: 0.95 }), soil: std({ color: 0x3e3026, roughness: 1 }), gravel: std({ map: P.dg.map, color: 0xcdb48c, roughness: 1 }),
      glass: std({ color: 0x6f878f, metalness: 0.55, roughness: 0.06, transparent: true, opacity: 0.26, depthWrite: false, envMapIntensity: 1.0, side: THREE.DoubleSide }),
      glassBal: std({ color: 0xb9ccd0, metalness: 0.6, roughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
      glassFin: std({ color: 0x9fb8ad, metalness: 0, roughness: 0.12, transparent: true, opacity: 0.07, depthWrite: false, envMapIntensity: 0.35, emissive: 0x4dde6f, emissiveIntensity: 0.03, side: THREE.DoubleSide }),
      agave: std({ color: 0x6d8c72, roughness: 0.72 }), agave2: std({ color: 0x93a883, roughness: 0.7 }), leaf: std({ color: 0x4f6b3e, roughness: 0.8 }),
      ledWarm: std({ color: 0xfff0d8, emissive: 0xffd9a0, emissiveIntensity: 1.0, roughness: 0.6 }), ledPanel: std({ color: 0xfff6ea, emissive: 0xfff1dc, emissiveIntensity: 0.9, roughness: 0.8 }),
      ledGreen: std({ color: 0x9ff0b4, emissive: 0x4dde6f, emissiveIntensity: 1.2, roughness: 0.5 }), fire: std({ color: 0xffb060, emissive: 0xff8a2a, emissiveIntensity: 2.2, roughness: 1, transparent: true, opacity: 0.9, depthWrite: false }),
      shade: std({ color: 0xf6e7cc, emissive: 0xffe0b0, emissiveIntensity: 0.7, roughness: 0.9 })
    };
    [[MT.floor, 0x5a4028], [MT.oak, 0x4a3018], [MT.floorWood, 0x4a3018], [MT.plaster, 0x4a3a28]].forEach(function (q) { q[0].emissive = new THREE.Color(q[1]); q[0].emissiveIntensity = 0; });
    MT.glass.userData.noShadow = true; for (var k in MT) MT[k].userData.gbank = true;
    return MT;
  }

  // ═════════════════════════ hooks ═════════════════════════
  // 1. reserve the site first (unshifted), so every module that tests planSpotOK / planFree / scatter keeps off it
  HK.world.unshift({ name: "gbankReserve", fn: function () { if (!window.PLAN_MODE || window.PLAN_GBANK_OFF) return; site();
    var poly = wpoly(-21, 21, -14, 34.5); planKeepout(poly); GB.keep = poly;
    // clear anything already standing on the footprint or the forecourt (props, lamps, bollards, allee trees)
    var n = 0; for (var kind in PLACE) { var list = PLACE[kind]; if (!list || !list.length) continue; var sp = MODEL_SPECS[kind]; if (!sp || !sp.prop) continue; for (var i = list.length - 1; i >= 0; i--) { var e = list[i]; if (planInPoly(poly, e[0], e[2])) { list.splice(i, 1); n++; } } }
    for (var j = COLLIDERS.length - 1; j >= 0; j--) { var c = COLLIDERS[j]; if (c[2] < 2 && planInPoly(poly, c[0], c[1])) COLLIDERS.splice(j, 1); }
    GB.n.cleared = n; } });
  HK.world.push({ name: "gbankWorld", fn: function () { if (!window.PLAN_MODE || window.PLAN_GBANK_OFF) return; worldHook(); } });
  HK.terrain.push({ name: "gbankTerrain", fn: function () { if (!window.PLAN_MODE || window.PLAN_GBANK_OFF) return; terrainHook(); } });
  HK.defer.push({ name: "gbankDefer", fn: function () { if (!window.PLAN_MODE || window.PLAN_GBANK_OFF) return; deferHook(); } });
  HK.frame.push({ name: "gbankFrame", fn: function (dt, now) { if (!GB.built) return; try { frameHook(dt, now); } catch (e) { if (!GB.fErr) { GB.fErr = 1; note("frame", e); } } } });
  HK.interior.push({ name: "gbankCam", fn: function (dt) { if (!GB.built) return false; try { return camHook(dt); } catch (e) { if (!GB.cErr) { GB.cErr = 1; note("camera", e); } return false; } } });

  // ── world: planting (instanced), the forecourt paving, hub, rail button, zone, hotspots, talk card ──
  function worldHook() {
    site(); var sum = 0, n = 0; for (var lx = -17; lx <= 17; lx += 2) for (var lz = -12; lz <= 24; lz += 2) { var w = L2W(lx, lz); sum += getH(w[0], w[1]); n++; } S.B = sum / n;
    if (MODELS.gbank && !window.PLAN_GBANK_PROC) { try { analyzeModel(); } catch (e) { GB.modelOK = false; GB.modelWhy = e.message; note("model analysis", e); } }
    // forecourt paving (cantera pavers; walkable through the walk grid)
    try { var pg = polygon(wpoly(K.court[0], K.court[1], K.court[2], K.court[3]), MT_PAVE(), 0.06); pg.userData.noCull = true; scene.add(pg); GB.paving = pg; } catch (e) { note("paving", e); }
    // approach planting: a palm allee framing the axis, agave, yucca and barrel beds along the sides
    var palm = ["datepalm", "canarypalm", "fanpalm2", "fanpalm"].find(function (k) { return MODELS[k]; });
    GB.palm = palm; GB.bedPlants = []; var putL = function (kind, lx, lz, rot, sc, bed) { if (!MODELS[kind] || modelBlocks(lx, lz)) return null; var p = L2W(lx, lz); put(kind, p[0], p[1], S.yaw + (rot || 0), sc || 1); var L = PLACE[kind]; var e = L[L.length - 1]; e.keep = true; e.gbank = true; if (bed !== undefined) GB.bedPlants.push([e, bed, kind]); return e; };
    // palms rise from the side beds (their kerbs ring the trunks), never in front of the facade; the beds are underplanted
    GB.palms = []; var PALMS = [[17.6, 15.2, 0], [17.6, 21.8, 0], [17.6, 28.4, 0], [-17.6, 27.2, 1], [-17.6, 31.6, 1], [18.4, -11.2, 2], [-18.4, -8.5, 3]]; if (palm) PALMS.forEach(function (p) { var e = putL(palm, p[0], p[1], rr() * TAU, palm === "fanpalm" ? 1.0 + 0.12 * rr() : 0.95 + 0.12 * rr(), p[2]); if (e) GB.palms.push(p); });
    var low = function (kind, alt) { return MODELS[kind] ? kind : MODELS[alt] ? alt : null; };
    var ag = low("agave_cluster", "bush1"), yu = low("yucca_cluster", "bush2"), ba = low("barrel_cactus", "agave_cluster"), sg = low("saguaro_young", "saguaro");
    var nearPalm = function (x, z) { return PALMS.some(function (p) { return Math.hypot(p[0] - x, p[1] - z) < 1.1; }); };
    var bed = function (x, z0, z1, step, tall, bi) { var i = 0; for (var z = z0 + 0.8; z < z1 - 0.5; z += step) { if (!nearPalm(x, z)) { var k = tall && i % 5 === 2 ? sg : i % 3 === 0 ? yu : i % 3 === 1 ? ag : ba; if (k) putL(k, x + (rr() - 0.5) * 0.6, z + (rr() - 0.5) * 0.4, rr() * TAU, (k === sg ? 0.55 : 0.75) + 0.3 * rr(), bi); } i++; } };
    GB.beds = [[17.6, 14, 32.4], [-17.6, 25.6, 32.4], [18.4, -12.4, 11.6], [-18.4, -12.4, 23.8]];
    GB.seatPlants = []; GB.potModel = false; if (!GB.modelOK && MODELS.agave_cluster) { GB.potModel = true; var seatP = function (lx, lz, yOff, sc) { var nC = COLLIDERS.length; var e = putL("agave_cluster", lx, lz, rr() * TAU, sc); if (COLLIDERS.length > nC) COLLIDERS.splice(nC, COLLIDERS.length - nC); if (e) GB.seatPlants.push([e, yOff]); };
      [[-11, -3.2], [3.2, 15.6]].forEach(function (r) { for (var x = r[0] + 0.7; x < r[1] - 0.35; x += 1.25) seatP(x, 10.62, K.TL + 0.47, 0.34 + 0.06 * rr()); });
      HALL_POTS.forEach(function (q) { seatP(q[0], q[1], K.hy0 + 0.72 * 0.62 * 1.3 - 0.03, 0.44); }); SUITE_POTS.forEach(function (q) { seatP(q[0], q[1], K.TL + 0.72 * 0.55 * 1.3 - 0.03, 0.4); }); }
    bed(17.6, 14, 32.4, 1.5, false, 0); bed(-17.6, 25.6, 32.4, 1.5, false, 1); bed(18.4, -12.4, 11.6, 1.9, true, 2); bed(-18.4, -12.4, 23.8, 1.9, true, 3);
    // lamps at the forecourt corners (the engine lights PLACE.lamp: bulbs, halos and the pooled night light)
    var lampK = MODELS.lux_lamp ? "lux_lamp" : MODELS.lamp ? "lamp" : null; if (lampK) [[-15.5, 33], [15.5, 33], [14.6, 16.4]].forEach(function (p) { putL(lampK, p[0], p[1], p[0] < 0 ? Math.PI / 2 : -Math.PI / 2, 1); });
    try { if (typeof SOLAR !== "undefined") [[-19, 14.5], [-19, 20.5], [19, 14.5], [19, 20.5], [19, 26.5], [-19, 32.5], [19, 32.5]].forEach(function (p) { if (p[0] < 0 && p[1] < STAIR_FOOT + 1 && p[1] > 11) return; SOLAR.pts.push(L2W(p[0], p[1])); }); } catch (e) {}
    // hub (the Places list, the map pills, fast travel), the rail button, the zone title
    var hub = L2W(0, 29.5); GB.hub = hub; try { planAddHub("GBANK", hub[0], hub[1]); planNavCats(); } catch (e) { note("hub", e); }
    try { var box = document.getElementById("warp"); if (box && !box.querySelector("[data-gbank]")) { var bt = document.createElement("button"); bt.textContent = "GBANK"; bt.setAttribute("data-gbank", "1"); bt.addEventListener("click", function () { warpTo(hub[0], hub[1]); try { player.rotation.y = S.yaw + Math.PI; yaw = S.yaw; } catch (e) {} }); var after = Array.prototype.find.call(box.children, function (b) { return b.textContent === "Compass Plaza"; }); if (after && after.nextSibling) box.insertBefore(bt, after.nextSibling); else box.append(bt); } } catch (e) { note("rail", e); }
    try { zoneRings.push({ name: "GBANK", label: "GBANK", center: [S.cx, S.cz], r: 26, k: D("gbank.zone", "Capital and on-chain treasury hall · Stage Three · The Expanse"), poly: wpoly(-20, 20, -13, 33.5), col: "#f4cd5a55", plan: "gbank", noLabel: true }); GB.zone = zoneRings[zoneRings.length - 1]; } catch (e) { note("zone", e); }
    // hotspots (text from partners.json, read when they are shown); lvl 0 = ground floor and forecourt, 1 = terrace and suite
    var hs = function (key, lx, lz, r, lvl, extra) { var p = L2W(lx, lz); var h = { x: p[0], z: p[1], r: r, t: "", k: "", p: "", plan: "gbank", gb: { key: key, x: p[0], z: p[1], lvl: lvl } }; if (extra) for (var q in extra) h[q] = extra[q]; hotspots.push(h); GB.hs.push(h); return h; };
    hs("gbank.hotspot", 0, 26.5, 8, 0); GB.entryHs = hs("gbank.entry", 0, 8.2, 3.2, 2); hs("gbank.ledger.hotspot", 0, -8.2, 4.2, 2); hs("gbank.flow.hotspot", 0, 0.2, 3.4, 2);
    hs("gbank.panels.0.hotspot", -13.8, -4, 2.8, 2); hs("gbank.panels.1.hotspot", 13.8, -4, 2.8, 2); GB.stairHs = hs("rmg.stair", -14, STAIR_FOOT + 2.2, 3.6, 0);
    GB.terrHs = hs("rmg.terrace", 7.5, 5.2, 3.6, 1); hs("rmg.suite", 0, 0.2, 2.2, 3);
    GB.willHs = hs("will", WILL_AT[0], WILL_AT[1], 3.2, 3, { play: "npc:will" });
    fillHotspots();
    // Will's talk card (the client's castById reads window.PLAN_TALK; g is the model, the stand-in or a marker)
    var TALK = window.PLAN_TALK = window.PLAN_TALK || {};
    TALK.will = { id: "will", get name() { return D("will.name", "Will Deitrick"); }, get role() { return D("will.role", "Managing Director · Riverside Management Group"); }, get g() { return WILL.g || WILL.ph || WILL.stub; }, get talk() { return D("will.talk", [{ t: D("legal", "Nothing here is an offer to sell securities or investment advice."), o: [["Goodbye", null]] }]); }, get greet() { return D("will.greet", ["Welcome."]); }, kw: [], legal: true };
    WILL.stub = new THREE.Object3D(); var wp = L2W(WILL_AT[0], WILL_AT[1]); WILL.stub.position.set(wp[0], S.B + K.TL, wp[1]);
  }
  function MT_PAVE() { return mats().pave; }
  function fillHotspots() { for (var i = 0; i < GB.hs.length; i++) { var h = GB.hs[i]; var o = h.gb.key === "will" ? { t: D("will.name", "Will Deitrick"), k: D("will.role", "Managing Director · Riverside Management Group") + " · press E to talk", p: D("will.talk.0.t", "") } : D(h.gb.key, null); if (!o) continue; h.t = o.t || h.t; h.k = o.k || h.k; h.p = o.p || h.p; } GB.hsFilled = !!DATA; }

  // ── terrain: a level pad under the pavilion and the stair, blended into the natural slope (clear of the compass rose) ──
  function terrainHook() {
    site(); if (typeof H === "undefined" || !H || !T) return; var sum = 0, n = 0;
    for (var lx = -17; lx <= 17; lx += 2) for (var lz = -12; lz <= 24; lz += 2) { var w = L2W(lx, lz); sum += sampleGrid(H, T, w[0], w[1]); n++; }
    var Bv = sum / n; var cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1);
    var X0 = -20, X1 = 20, Z0 = -15, Z1 = 24.5, BL = 8; var bb = wpoly(X0 - BL - 5, X1 + BL + 5, Z0 - BL - 5, Z1 + BL + 5); var xs = bb.map(function (p) { return p[0]; }), zs = bb.map(function (p) { return p[1]; });
    var c0 = Math.max(0, Math.floor((Math.min.apply(null, xs) - T.xmin) / cw)), c1 = Math.min(T.cols - 1, Math.ceil((Math.max.apply(null, xs) - T.xmin) / cw)), r0 = Math.max(0, Math.floor((Math.min.apply(null, zs) - T.zmin) / ch)), r1 = Math.min(T.rows - 1, Math.ceil((Math.max.apply(null, zs) - T.zmin) / ch)); var nv = 0;
    for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) { var x = T.xmin + c * cw, z = T.zmin + r * ch; var l = W2L(x, z); var dx = Math.max(0, X0 - l[0], l[0] - X1), dz = Math.max(0, Z0 - l[1], l[1] - Z1); var d = Math.hypot(dx, dz); if (d >= BL) continue; var k = 1 - sstep(0, BL, d); var v = r * T.cols + c; H[v] = H[v] + (Bv - H[v]) * k; nv++; }
    S.B = Bv; GB.n.graded = nv;
    // seat the bed planting on the gravel (the same bed top buildCourt uses)
    var tops = (GB.beds || []).map(function (b) { var gy = function (lz) { var w = L2W(b[0], lz); return sampleGrid(H, T, w[0], w[1]) - Bv; }; return Math.max(gy(b[1]), gy(b[2]), gy((b[1] + b[2]) / 2)) + 0.31; });
    (GB.bedPlants || []).forEach(function (q) { var t2 = tops[q[1]]; if (t2 === undefined) return; q[0][1] = Bv + t2; q[0].seated = true; }); GB.n.seated = (GB.bedPlants || []).length;
    (GB.seatPlants || []).forEach(function (q) { q[0][1] = Bv + q[1]; q[0].seated = true; }); GB.n.seatedPots = (GB.seatPlants || []).length;
  }

  // ═════════════════════════ build (defer: final heights, roads flushed) ═════════════════════════
  var G = {};   // groups: ex (exterior shell), up (terrace furniture), hall, suite, dyn (animated / text), court (forecourt)
  function group(name, far) { var g = new THREE.Group(); g.name = "gbank_" + name; g.position.set(S.cx, S.B, S.cz); g.rotation.y = S.yaw; g.userData.noCull = true; g.userData.gbank = true; g.userData.far = far; G[name] = g; return g; }
  function deferHook() {
    site(); S.B = getH(S.cx, S.cz); mats(); var t0 = performance.now();
    var useModel = !!(MODELS.gbank && !window.PLAN_GBANK_PROC);
    group("ex", 1600); group("up", 220); group("hall", 115); group("suite", 34); group("dyn", 50); group("court", 600);
    if (useModel && GB.modelOK) { try { buildModelShell(); } catch (e) { GB.modelOK = false; GB.modelWhy = e.message; note("model shell", e); G.ex.clear(); clearModelSolids(); } }
    var model = useModel && GB.modelOK;
    if (model) { group("rs", 115); var ex0 = G.ex; CAP = []; G.ex = G.rs; try { buildShell(); } catch (e) { note("room shell", e); } G.ex = ex0; }
    else { CAP = null; }
    var steps = [["shell", model ? null : buildShell], ["stair", model ? null : buildStair], ["hall", buildHall], ["suite", buildSuite], ["terrace", model ? null : buildTerrace], ["court", buildCourt], ["lights", buildLights]];
    for (var i = 0; i < steps.length; i++) { if (!steps[i][1]) continue; if (steps[i][0] === "court" && model) CAP = null; try { steps[i][1](); } catch (e) { note("build " + steps[i][0], e); } if (steps[i][0] === "suite" && model) { GB.roomSolids = CAP; CAP = null; } }
    GB.mode = model ? "model" : "procedural"; if (useModel && !model) GB.mode = "procedural (model rejected: " + (GB.modelWhy || "?") + ")";
    if (model) { var rsd = GB.roomSolids || []; for (var r = SOLIDS.length - 1; r >= 0; r--) if (rsd.indexOf(SOLIDS[r]) >= 0) SOLIDS.splice(r, 1); try { buildMats(); } catch (e) { note("mats", e); } }
    // merge the static meshes of each group by material (animated and text parts live in dyn, which stays as it is)
    var saved = 0; ["ex", "up", "hall", "suite", "court", "rs", "dyn"].forEach(function (k) { if (!G[k] || (k === "ex" && GB.mode === "model")) return; try { saved += planMergeStatic(G[k], null, false); } catch (e) { note("merge " + k, e); } });
    for (var k in G) { var inner = k === "hall" || k === "suite" || k === "dyn" || k === "rs"; G[k].traverse(function (o) { if (o.isMesh) { o.receiveShadow = true; if (inner) { o.castShadow = false; o.userData.noShadow = true; } else o.castShadow = !(o.material && o.material.transparent); } }); if (inner && GB.mode === "model") G[k].visible = false; scene.add(G[k]); }
    // interior groups carry userData.interior so the shadow sweep leaves them (they sit in the shell's shadow)
    ["hall", "suite", "dyn", "rs"].forEach(function (k) { if (G[k]) G[k].userData.interior = true; });
    try { buildWillStandIn(); } catch (e) { note("will stand-in", e); }
    GB.built = true; GB.n.merged = saved; GB.n.ms = Math.round(performance.now() - t0);
    var tri = 0, dr = 0; for (var k2 in G) G[k2].traverse(function (o) { if (o.isMesh && o.geometry) { dr++; var ix = o.geometry.index; tri += (ix ? ix.count : o.geometry.attributes.position.count) / 3; } }); GB.n.draws = dr; GB.n.tris = Math.round(tri);
  }

  // ── the procedural pavilion: travertine podium and frame, bronze-mullioned glass, a stucco upper volume under a deep canopy ──
  function buildShell() {
    var g = G.ex, M = mats(); var P = K.pod, Hh = K.hall, TL = K.TL;
    // podium (the hall floor is its top); a dark base reveal
    BX(g, P[0], P[1], -0.8, K.podTop - 0.02, P[2], P[3], M.stoneWarm, 1.6);
    BX(g, P[0] - 0.02, P[1] + 0.02, -0.02, 0.1, P[2] - 0.02, P[3] + 0.02, M.stoneDark, 1.2);
    // front steps: two broad treads along the front, from the stair to the south corner
    BX(g, -11.2, 17, -0.4, 0.4, 12, 12.4, M.stoneWarm, 1.2); BX(g, -11.2, 17, -0.4, 0.2, 12.4, 12.8, M.stoneWarm, 1.2);
    BX(g, -11.2, 17, 0.02, 0.05, 12.78, 12.84, M.ledWarm, 1);   // a warm light line under the lower nosing (glows at night)
    // hall walls: stone where solid, glass bays with bronze mullions and a transom where open
    var y0 = K.hy0, y1 = K.hy1, hH = y1 - y0, t = 0.3;
    BX(g, Hh[0], Hh[1], y0, y1, Hh[2] - t, Hh[2], M.stone, 1.6);                                   // back
    BX(g, Hh[0] - t, Hh[0], y0, y1, Hh[2], Hh[3], M.stone, 1.6);                                   // north side
    BX(g, Hh[1], Hh[1] + t, y0, y1, Hh[2], 0.2, M.stone, 1.6);                                     // south side, back half
    for (var r = 1; r <= 3; r++) { var ry = y0 + r * 1.4; BX(g, Hh[0] - 0.02, Hh[1] + 0.02, ry, ry + 0.035, Hh[2] - t - 0.015, Hh[2] - t + 0.005, M.stoneDark, 1); }   // reveals on the back
    // north slot windows
    [-6, 3].forEach(function (z) { BX(g, Hh[0] - t - 0.01, Hh[0] + 0.01, y0 + 0.4, y1 - 0.6, z - 0.4, z + 0.4, M.bronzeDark, 1); PL(g, 0.7, hH - 1.1, M.glass, Hh[0] - t - 0.02, y0 + 0.4 + (hH - 1.0) / 2, z, -Math.PI / 2); });
    // the stone bay behind the grand stair
    BX(g, Hh[0], -11.2, y0, y1, Hh[3] - t, Hh[3], M.stone, 1.6);
    // front glazing (x -11.2 .. 16) and the south glazing (z 0.2 .. 11): frame, mullions every ~2 m, transom at 3.9 m
    var glazeRun = function (a, b, fixed, alongX, isFront) { var L = b - a; PLf(g, alongX, a, b, fixed, y0, y1, isFront); var nm = Math.round(L / 2.05); for (var i = 0; i <= nm; i++) { var s = a + L * i / nm; if (isFront && Math.abs(s) < K.door + 0.05) continue; if (alongX) BX(g, s - 0.05, s + 0.05, y0, y1, fixed - 0.1, fixed + 0.32, M.bronze, 1); else BX(g, fixed - 0.1, fixed + 0.32, y0, y1, s - 0.05, s + 0.05, M.bronze, 1); } var ty = y0 + 3.9;
      if (alongX) { BX(g, a, b, ty, ty + 0.1, fixed - 0.06, fixed + 0.12, M.bronze, 1); (isFront ? [[a, -K.door - 0.25], [K.door + 0.25, b]] : [[a, b]]).forEach(function (sg) { BX(g, sg[0], sg[1], y0, y0 + 0.14, fixed - 0.08, fixed + 0.14, M.bronzeDark, 1); }); } else { BX(g, fixed - 0.06, fixed + 0.12, ty, ty + 0.1, a, b, M.bronze, 1); BX(g, fixed - 0.08, fixed + 0.14, y0, y0 + 0.14, a, b, M.bronzeDark, 1); } };
    glazeRun(-11.2, Hh[1], Hh[3], true, true); glazeRun(0.2, Hh[3], Hh[1], false, false);
    BX(g, -11.2, -K.door - 0.3, y0 + 0.02, y0 + 0.05, Hh[3] - 0.5, Hh[3] - 0.44, M.ledWarm, 1); BX(g, K.door + 0.3, Hh[1] - 0.4, y0 + 0.02, y0 + 0.05, Hh[3] - 0.5, Hh[3] - 0.44, M.ledWarm, 1); BX(g, Hh[1] - 0.5, Hh[1] - 0.44, y0 + 0.02, y0 + 0.05, 0.4, Hh[3] - 0.5, M.ledWarm, 1);
    // the entrance: a bronze portal frame, glass leaves slid open, a mat
    BX(g, -K.door - 0.25, -K.door, y0, y0 + K.doorH + 0.25, Hh[3] - 0.1, Hh[3] + 0.4, M.bronze, 1); BX(g, K.door, K.door + 0.25, y0, y0 + K.doorH + 0.25, Hh[3] - 0.1, Hh[3] + 0.4, M.bronze, 1);
    BX(g, -K.door - 0.25, K.door + 0.25, y0 + K.doorH, y0 + K.doorH + 0.25, Hh[3] - 0.1, Hh[3] + 0.4, M.bronze, 1);
    PL(g, 2 * K.door, hH - K.doorH - 0.25, M.glass, 0, y0 + K.doorH + 0.25 + (hH - K.doorH - 0.25) / 2, Hh[3] - 0.02);
    [-1, 1].forEach(function (s) { PL(g, 1.9, K.doorH - 0.1, M.glass, s * (K.door + 1.2), y0 + K.doorH / 2, Hh[3] - 0.22); BX(g, s * (K.door + 0.28) - 0.03, s * (K.door + 0.28) + 0.03, y0 + 0.9, y0 + 2.2, Hh[3] - 0.3, Hh[3] - 0.26, M.brass, 1); });
    BX(g, -K.door + 0.2, K.door - 0.2, y0 - 0.005, y0 + 0.012, Hh[3] - 1.4, Hh[3] + 0.9, M.rugDeep, 1);
    // stone piers framing the glass at the corners, and the fascia band carrying the terrace
    BX(g, Hh[1] - 0.2, Hh[1] + 0.35, y0, y1, Hh[3] - 0.2, Hh[3] + 0.35, M.stone, 1.6);
    var Sl0 = K.slab; BX(g, Sl0[0], Sl0[1], K.sy0, TL, Sl0[2], Sl0[3], M.stone, 1.6);           // slab and terrace (its top is the terrace floor)
    var fy0 = K.sy0 - 0.45; [[Sl0[0], Sl0[1], Hh[3], Sl0[3]], [Sl0[0], Sl0[1], Sl0[2], Hh[2]], [Sl0[0], Hh[0], Hh[2], Hh[3]], [Hh[1], Sl0[1], Hh[2], Hh[3]]].forEach(function (q) { BX(g, q[0], q[1], fy0, K.sy0, q[2], q[3], M.stone, 1.6); BX(g, q[0] - 0.02, q[1] + 0.02, fy0 - 0.05, fy0 + 0.01, q[2] - 0.02, q[3] + 0.02, M.bronzeDark, 1); });   // the fascia band drops outside the glass line only
    // the upper volume: stucco box, bronze-framed glass front with the suite door, glass to the south (the Ring)
    var U = K.suite, uy1 = K.uy1, uh = uy1 - TL;
    BX(g, U[0], U[1], TL, uy1, U[2], U[2] + t, M.stucco, 3);                                        // back
    BX(g, U[0], U[0] + t, TL, uy1, U[2], U[3], M.stucco, 3);                                        // north
    BX(g, U[1] - t, U[1], TL, uy1, U[2], -5.2, M.stucco, 3);                                        // south, back part
    BX(g, U[0], U[1], uy1 - 0.9, uy1, U[3] - t, U[3], M.stucco, 3);                                 // front header
    BX(g, U[1] - t, U[1], uy1 - 0.9, uy1, -5.2, U[3], M.stucco, 3);                                 // south header
    PLf(g, true, U[0] + t, U[1] - t, U[3], TL, uy1 - 0.9, true, K.sdoor); PLf(g, false, -5.2, U[3], U[1], TL, uy1 - 0.9, false);
    for (var i = 0; i <= 12; i++) { var xm = U[0] + t + (U[1] - U[0] - 2 * t) * i / 12; if (Math.abs(xm) < K.sdoor + 0.05) continue; BX(g, xm - 0.05, xm + 0.05, TL, uy1 - 0.9, U[3] - 0.12, U[3] + 0.08, M.bronzeDark, 1); }
    for (var j = 0; j <= 4; j++) { var zm = -5.2 + (U[3] + 5.2) * j / 4; BX(g, U[1] - 0.12, U[1] + 0.08, TL, uy1 - 0.9, zm - 0.05, zm + 0.05, M.bronzeDark, 1); }
    BX(g, -K.sdoor - 0.12, -K.sdoor, TL, TL + K.sdoorH + 0.1, U[3] - 0.14, U[3] + 0.1, M.bronze, 1); BX(g, K.sdoor, K.sdoor + 0.12, TL, TL + K.sdoorH + 0.1, U[3] - 0.14, U[3] + 0.1, M.bronze, 1); BX(g, -K.sdoor - 0.12, K.sdoor + 0.12, TL + K.sdoorH, TL + K.sdoorH + 0.12, U[3] - 0.14, U[3] + 0.1, M.bronze, 1);
    PL(g, 2 * K.sdoor, uh - 0.9 - K.sdoorH - 0.12, M.glass, 0, TL + K.sdoorH + 0.12 + (uh - 0.9 - K.sdoorH - 0.12) / 2, U[3] - 0.02);
    // roof and canopy (deep overhang over the terrace), walnut soffit, slim bronze columns
    var R = K.roof; BX(g, R[0], R[1], uy1, K.ry1, R[2], R[3], M.stucco, 3); [[R[0], R[1], R[3] - 0.25, R[3]], [R[0], R[1], R[2], R[2] + 0.25], [R[0], R[0] + 0.25, R[2], R[3]], [R[1] - 0.25, R[1], R[2], R[3]]].forEach(function (q) { BX(g, q[0] - 0.02, q[1] + 0.02, K.ry1, K.ry1 + 0.18, q[2] - 0.02, q[3] + 0.02, M.bronzeDark, 1); }); BX(g, R[0] + 0.25, R[1] - 0.25, K.ry1, K.ry1 + 0.05, R[2] + 0.25, R[3] - 0.25, M.gravel, 2);
    for (var s = 0; s <= 30; s++) { var sx = R[0] + 0.2 + (R[1] - R[0] - 0.4) * s / 30; BX(g, sx - 0.05, sx + 0.05, uy1 - 0.14, uy1 - 0.02, U[3] + 0.05, R[3] - 0.15, M.walnut, 1); }
    [-10.8, 10.8].forEach(function (cx2) { CY(g, 0.13, 0.13, uy1 - TL, M.bronzeDark, cx2, TL + (uy1 - TL) / 2, R[3] - 0.6, 14); });
    // terrace balustrade: glass with a bronze cap rail and posts
    var bal = function (a, b, fixed, alongX) { var L = b - a; if (alongX) { PL(g, L, 1.0, M.glassBal, (a + b) / 2, TL + 0.55, fixed); BX(g, a, b, TL + 1.05, TL + 1.12, fixed - 0.05, fixed + 0.05, M.bronze, 1); BX(g, a, b, TL, TL + 0.06, fixed - 0.04, fixed + 0.04, M.bronzeDark, 1); } else { PL(g, L, 1.0, M.glassBal, fixed, TL + 0.55, (a + b) / 2, Math.PI / 2); BX(g, fixed - 0.05, fixed + 0.05, TL + 1.05, TL + 1.12, a, b, M.bronze, 1); BX(g, fixed - 0.04, fixed + 0.04, TL, TL + 0.06, a, b, M.bronzeDark, 1); } var np = Math.max(1, Math.round(L / 1.6)); for (var i = 0; i <= np; i++) { var s = a + L * i / np; if (alongX) BX(g, s - 0.03, s + 0.03, TL, TL + 1.05, fixed - 0.03, fixed + 0.03, M.bronze, 1); else BX(g, fixed - 0.03, fixed + 0.03, TL, TL + 1.05, s - 0.03, s + 0.03, M.bronze, 1); } };
    var Sl = K.slab; bal(K.stair.x1, Sl[1] - 0.1, Sl[3] - 0.12, true); bal(Sl[2] + 0.1, Sl[3] - 0.1, Sl[1] - 0.12, false); bal(Sl[2] + 0.1, Sl[3] - 0.1, Sl[0] + 0.12, false); bal(Sl[0] + 0.1, U[0], Sl[2] + 0.12, true); bal(U[1], Sl[1] - 0.1, Sl[2] + 0.12, true);
    // GBANK letters on the fascia over the entrance (bronze by day, backlit at night)
    lettersGBANK(g);
    // collision: podium, steps, walls, slab, suite, balustrades, columns
    SOL(P[0], P[1], P[2], P[3], -1, K.podTop); SOL(-11.2, 17, 12, 12.4, -1, 0.4); SOL(-11.2, 17, 12.4, 12.8, -1, 0.2);
    SOL(Hh[0], Hh[1], Hh[2] - t, Hh[2], y0, y1); SOL(Hh[0] - t, Hh[0], Hh[2], Hh[3], y0, y1); SOL(Hh[1], Hh[1] + t, Hh[2], Hh[3], y0, y1);
    SOL(Hh[0], -K.door, Hh[3] - t, Hh[3] + 0.05, y0, y1); SOL(K.door, Hh[1], Hh[3] - t, Hh[3] + 0.05, y0, y1);
    SOL(Sl[0], Sl[1], Sl[2], Sl[3], K.sy0, TL);
    SOL(U[0], U[1], U[2], U[2] + t, TL, uy1); SOL(U[0], U[0] + t, U[2], U[3], TL, uy1); SOL(U[1] - t, U[1], U[2], U[3], TL, uy1);
    SOL(U[0], -K.sdoor, U[3] - t, U[3] + 0.05, TL, uy1); SOL(K.sdoor, U[1], U[3] - t, U[3] + 0.05, TL, uy1);
    SOL(K.stair.x1, Sl[1], Sl[3] - 0.25, Sl[3], TL, TL + 1.12); SOL(Sl[1] - 0.25, Sl[1], Sl[2], Sl[3], TL, TL + 1.12); SOL(Sl[0], Sl[0] + 0.25, Sl[2], Sl[3], TL, TL + 1.12); SOL(Sl[0], U[0], Sl[2], Sl[2] + 0.25, TL, TL + 1.12); SOL(U[1], Sl[1], Sl[2], Sl[2] + 0.25, TL, TL + 1.12);
    [-10.8, 10.8].forEach(function (cx2) { SOL(cx2 - 0.2, cx2 + 0.2, K.roof[3] - 0.8, K.roof[3] - 0.4, TL, uy1); });
    GB.n.shell = 1;
  }
  // a glazed run: a glass plane along x (front, facing +z) or along z (side, facing +x), optionally with a door gap
  function PLf(g, alongX, a, b, fixed, y0, y1, isFront, gap) { var M = mats(); var h = y1 - y0, dg = gap === undefined ? (isFront ? K.door : 0) : gap; var segs = dg > 0 && a < -dg && b > dg ? [[a, -dg], [dg, b]] : [[a, b]]; if (dg > 0 && isFront && h > K.doorH + 0.3 && gap === undefined) segs = [[a, -dg], [dg, b]];
    segs.forEach(function (sg) { var L = sg[1] - sg[0]; if (L <= 0.05) return; if (alongX) PL(g, L, h, M.glass, (sg[0] + sg[1]) / 2, y0 + h / 2, fixed + 0.02); else PL(g, L, h, M.glass, fixed + 0.02, y0 + h / 2, (sg[0] + sg[1]) / 2, Math.PI / 2); }); }
  function lettersGBANK(g) { var M = mats(); var tex = cv(1024, 256, function (x, w, h) { x.clearRect(0, 0, w, h); x.textAlign = "center"; x.textBaseline = "middle"; x.font = "400 200px " + DISP; x.fillStyle = gold(x, 30, 230); spaced(x, "GBANK", w / 2 + 14, h / 2 + 8, 28); });
    var m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, metalness: 0.75, roughness: 0.3, color: 0xffffff, emissive: 0xffd9a0, emissiveMap: tex, emissiveIntensity: 0.05 }); GB.letterMat = m;
    var p = PL(G.dyn, 3.4, 0.85, m, 0, K.sy0 - 0.03, K.slab[3] + 0.03); p.userData.noMerge = true; }

  // ── the grand stair: a stepped travertine mass with cheek walls, bronze handrails and a light line under each rail ──
  function buildStair() {
    var g = G.ex, M = mats(), s = K.stair, xi0 = s.x0 + 0.3, xi1 = s.x1 - 0.3;
    for (var k = 1; k < s.n; k++) { var zz = stepZ(k), top = k * RISE; BX(g, xi0, xi1, 0, top, zz[0], zz[1], M.stoneWarm, 1.2); BX(g, xi0, xi1, top - 0.012, top + 0.004, zz[1] - 0.05, zz[1] + 0.004, M.bronzeDark, 1); SOL(xi0, xi1, zz[0], zz[1], -1, top); }
    // cheek walls: a travertine profile following the nosing line one metre up
    var prof = [[STAIR_FOOT + 0.25, 0], [STAIR_FOOT + 0.25, 1.15], [stepZ(s.landK)[1], s.landK * RISE + 1.05], [stepZ(s.landK)[0], s.landK * RISE + 1.05], [s.zTop, K.TL + 1.12], [s.zTop, 0]];
    [s.x0, s.x1 - 0.3].forEach(function (x0) { var sh = new THREE.Shape(); prof.forEach(function (p, i) { if (i === 0) sh.moveTo(p[0], p[1]); else sh.lineTo(p[0], p[1]); }); sh.closePath(); var geo = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false }); geo.rotateY(-Math.PI / 2); geo.translate(x0 + 0.3, 0, 0); var uv = geo.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.6, uv.getY(i) / 1.6); var m = new THREE.Mesh(geo, M.stone); g.add(m); SOL(x0, x0 + 0.3, s.zTop, STAIR_FOOT + 0.25, -1, K.TL + 1.12); });
    // handrails and light lines on both cheek walls (inner faces)
    var rail = [[STAIR_FOOT + 0.1, RISE + 0.95], [stepZ(s.landK)[1], s.landK * RISE + 0.95], [stepZ(s.landK)[0], s.landK * RISE + 0.95], [s.zTop, K.TL + 0.98]];
    [xi0 + 0.06, xi1 - 0.06].forEach(function (x) { for (var i = 0; i < rail.length - 1; i++) { var a = [x, rail[i][1], rail[i][0]], b = [x, rail[i + 1][1], rail[i + 1][0]]; beam(g, a, b, 0.06, 0.06, M.bronze); var la = [x + (x < -14 ? -0.02 : 0.02), rail[i][1] - 0.32, rail[i][0]], lb = [x + (x < -14 ? -0.02 : 0.02), rail[i + 1][1] - 0.32, rail[i + 1][0]]; beam(G.ex, la, lb, 0.035, 0.05, M.ledWarm); } });
    // a newel block with the Riverside Management Group plaque at the foot (text in buildTexts)
    [[s.x0 - 0.15, s.x0 + 0.3], [s.x1 - 0.3, s.x1 + 0.15]].forEach(function (nx) { BX(g, nx[0], nx[1], 0, 1.35, STAIR_FOOT - 0.3, STAIR_FOOT + 0.45, M.stone, 1.2); BX(g, nx[0] - 0.02, nx[1] + 0.02, 1.35, 1.4, STAIR_FOOT - 0.32, STAIR_FOOT + 0.47, M.bronze, 1); SOL(nx[0], nx[1], STAIR_FOOT - 0.3, STAIR_FOOT + 0.45, -1, 1.4); });
    GB.n.stair = s.n - 1;
  }

  // ── GBANK hall: the capital flow installation, the ledger wall, reception, lounge, panels ──
  var HALL = { stations: [], pulses: null, nodes: [] };
  function buildHall() {
    var g = G.hall, M = mats(), y0 = K.hy0, y1 = K.hy1, Hh = K.hall;
    floorPlane(g, Hh[0] + 0.01, Hh[1] - 0.01, Hh[2] + 0.01, Hh[3] - 0.01, y0 + 0.012, M.floor, 1.2);
    // walnut slat ceiling with linear light lines
    PL(g, 32, 22, M.black, 0, y1 - 0.04, 0, 0, Math.PI / 2);
    for (var i = 0; i < 48; i++) { var x = Hh[0] + 0.33 + i * 0.66; BX(g, x - 0.09, x + 0.09, y1 - 0.38, y1 - 0.06, Hh[2] + 0.4, Hh[3] - 0.4, M.oak, 1); }
    [-7.5, 0, 7.5].forEach(function (z) { BX(g, Hh[0] + 0.4, Hh[1] - 0.4, y1 - 0.42, y1 - 0.39, z - 0.06, z + 0.06, M.ledPanel, 1); });
    BX(g, Hh[0] + 0.32, Hh[1] - 0.32, y1 - 0.5, y1 - 0.46, Hh[2] + 0.44, Hh[2] + 0.5, M.ledPanel, 1); BX(g, Hh[0] + 0.3, Hh[0] + 0.36, y1 - 0.5, y1 - 0.46, Hh[2] + 0.4, Hh[3] - 0.4, M.ledPanel, 1); BX(g, Hh[1] - 0.36, Hh[1] - 0.3, y1 - 0.5, y1 - 0.46, Hh[2] + 0.4, 0, M.ledPanel, 1);
    // the back wall behind the ledger: black stone surround, walnut flanks
    BX(g, -9.2, 9.2, y0, y1 - 0.4, Hh[2] + 0.3, Hh[2] + 0.42, M.black, 1);
    BX(g, Hh[0] + 0.3, -9.2, y0, y1 - 0.4, Hh[2] + 0.3, Hh[2] + 0.36, M.walnut, 1.2); BX(g, 9.2, Hh[1] - 0.3, y0, y1 - 0.4, Hh[2] + 0.3, Hh[2] + 0.36, M.walnut, 1.2);
    BX(g, -8.4, 8.4, y0, y0 + 0.9, Hh[2] + 0.42, Hh[2] + 1.0, M.stone, 1.2); SOL(-8.4, 8.4, Hh[2] + 0.3, Hh[2] + 1.0, y0, y0 + 0.9);   // a travertine ledge under the screen
    // the capital flow: five stations across the hall, a suspended light path and a bronze floor inlay
    var zs = -2.2, xs = [-12, -6, 0, 6, 12]; HALL.path = [];
    xs.forEach(function (x, i) {
      BX(g, x - 0.95, x + 0.95, y0, y0 + 0.95, zs - 0.4, zs + 0.4, M.stone, 1.2); BX(g, x - 0.97, x + 0.97, y0 + 0.95, y0 + 1.0, zs - 0.42, zs + 0.42, M.bronze, 1);
      PL(G.dyn, 1.7, 2.3, M.glassFin, x, y0 + 2.2, zs); BX(g, x - 0.87, x + 0.87, y0 + 1.0, y0 + 1.06, zs - 0.05, zs + 0.05, M.bronzeDark, 1);
      BX(g, x - 0.012, x + 0.012, y0 + 3.8, y1 - 0.38, zs - 0.012, zs + 0.012, M.bronzeDark, 1);   // hanger rod
      var nm = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: [0xf4cd5a, 0xd8d27a, 0x9fe08c, 0x6fe08a, 0x4dde6f][i], emissiveIntensity: 1.4, roughness: 0.3 }); var nd = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), nm); nd.position.set(x, y0 + 3.75, zs); G.dyn.add(nd); HALL.nodes.push(nd);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.025, 8, 36), M.brass); ring.position.copy(nd.position); G.dyn.add(ring); HALL.nodes.push(ring);
      HALL.path.push([x, y0 + 3.75, zs]); HALL.stations.push({ x: x, z: zs, i: i }); SOL(x - 0.95, x + 0.95, zs - 0.4, zs + 0.4, y0, y0 + 1.0);
    });
    for (var j = 0; j < xs.length - 1; j++) { beam(g, [xs[j] + 0.34, y0 + 3.75, zs], [xs[j + 1] - 0.34, y0 + 3.75, zs], 0.05, 0.05, M.bronze); beam(g, [xs[j] + 0.34, y0 + 3.72, zs], [xs[j + 1] - 0.34, y0 + 3.72, zs], 0.018, 0.018, M.ledGreen); }
    BX(g, -12.9, 12.9, y0 + 0.012, y0 + 0.02, zs + 0.9, zs + 1.0, M.brass, 1); BX(g, -12.9, 12.9, y0 + 0.012, y0 + 0.022, zs + 0.96, zs + 0.99, M.ledGreen, 1);
    // pulses travelling the path (one Points draw)
    var NP = 18, pg = new THREE.BufferGeometry(), pa = new Float32Array(NP * 3); pg.setAttribute("position", new THREE.BufferAttribute(pa, 3));
    var spr = cv(64, 64, function (x) { var gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(220,255,230,1)"); gr.addColorStop(0.25, "rgba(120,240,150,0.85)"); gr.addColorStop(1, "rgba(77,222,111,0)"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); }); spr.userData.text = false;
    var pm = new THREE.PointsMaterial({ size: 0.42, map: spr, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, color: 0xffffff }); var pts = new THREE.Points(pg, pm); pts.frustumCulled = false; G.dyn.add(pts); HALL.pulses = { pts: pts, n: NP, a: pa };
    // reception: a travertine desk with a walnut top, facing the entrance
    var rg = new THREE.Group(); rg.position.set(9.6, 0, 6.2); rg.rotation.y = -0.32; g.add(rg);
    BX(rg, -2.6, 2.6, y0, y0 + 1.05, -0.45, 0.45, M.stone, 1.2); BX(rg, -2.7, 2.7, y0 + 1.05, y0 + 1.11, -0.55, 0.55, M.walnutDark, 1); BX(rg, -2.5, 2.5, y0 + 0.08, y0 + 0.12, 0.45, 0.47, M.ledWarm, 1);
    BX(rg, -2.2, 2.2, y0, y0 + 0.72, -1.3, -0.8, M.walnut, 1); CY(rg, 0.22, 0.26, 0.5, M.leatherDark, -1.0, y0 + 0.25, -1.6, 14); CY(rg, 0.22, 0.26, 0.5, M.leatherDark, 1.0, y0 + 0.25, -1.6, 14);
    rg.updateMatrixWorld(true); solidFromGroupBox(rg, -2.7, 2.7, -0.55, 0.55, y0, y0 + 1.11);
    // the lounge (north front): an L of sofas, two armchairs, a low table on a deep green rug
    var lg = new THREE.Group(); lg.position.set(-7.4, 0, 5.2); g.add(lg);
    BX(lg, -3.1, 3.1, y0 + 0.005, y0 + 0.02, -2.2, 2.2, M.rugDeep, 1);
    sofa(lg, 0, -1.6, 0, 3.0, M.fabric, y0); sofa(lg, -2.5, 0.2, Math.PI / 2, 2.2, M.fabric, y0); chair(lg, 1.8, 1.3, Math.PI + 0.5, M.leather, y0); chair(lg, 0.2, 1.7, Math.PI - 0.2, M.leather, y0);
    BX(lg, -0.9, 0.9, y0 + 0.36, y0 + 0.42, -0.45, 0.45, M.walnutDark, 1); BX(lg, -0.8, 0.8, y0, y0 + 0.36, -0.35, 0.35, M.stoneDark, 1); SOL2(lg, -0.9, 0.9, -0.45, 0.45, y0, y0 + 0.42);
    floorLamp(lg, 2.7, -1.8, y0); floorLamp(G.hall, -14.8, 9.6, y0);
    // panels on the side walls ($GBACK utility, north; real world assets, south) and the planters
    BX(g, Hh[0] + 0.01, Hh[0] + 0.12, y0 + 1.1, y0 + 4.2, -6.6, -1.4, M.walnutDark, 1); BX(g, Hh[1] - 0.12, Hh[1] - 0.01, y0 + 1.1, y0 + 4.2, -6.6, -1.4, M.walnutDark, 1);
    HALL_POTS.forEach(function (p) { pot(g, p[0], p[1], y0, 0.62, GB.potModel); });
    GB.n.hall = 1;
  }
  // soft furniture (hall and suite), local to a group
  function sofa(g, x, z, ry, w, mat, y0) { var s = new THREE.Group(); s.position.set(x, 0, z); s.rotation.y = ry; g.add(s); var M = mats();
    BX(s, -w / 2, w / 2, y0 + 0.1, y0 + 0.44, -0.42, 0.42, mat, 1); BX(s, -w / 2, w / 2, y0 + 0.44, y0 + 0.86, -0.46, -0.24, mat, 1); BX(s, -w / 2 - 0.12, -w / 2, y0 + 0.1, y0 + 0.64, -0.46, 0.42, mat, 1); BX(s, w / 2, w / 2 + 0.12, y0 + 0.1, y0 + 0.64, -0.46, 0.42, mat, 1);
    for (var i = 0; i < Math.round(w / 0.9); i++) { var cx = -w / 2 + (i + 0.5) * w / Math.round(w / 0.9); BX(s, cx - w / Math.round(w / 0.9) / 2 + 0.02, cx + w / Math.round(w / 0.9) / 2 - 0.02, y0 + 0.44, y0 + 0.54, -0.2, 0.4, mat, 1); }
    BX(s, -w / 2, w / 2, y0, y0 + 0.1, -0.4, 0.38, M.bronzeDark, 1);
    s.updateMatrixWorld(true); var lvl = y0 > 3 ? 1 : 0; seatFromGroup(s, -w / 2, w / 2, -0.24, 0.42, y0 + 0.5, 0, lvl); solidFromGroupBox(s, -w / 2 - 0.12, w / 2 + 0.12, -0.46, -0.24, y0 + 0.1, y0 + 0.86); }
  function chair(g, x, z, ry, mat, y0) { var s = new THREE.Group(); s.position.set(x, 0, z); s.rotation.y = ry; g.add(s); var M = mats();
    BX(s, -0.42, 0.42, y0 + 0.16, y0 + 0.42, -0.4, 0.38, mat, 1); BX(s, -0.42, 0.42, y0 + 0.42, y0 + 0.92, -0.42, -0.26, mat, 1); BX(s, -0.46, -0.36, y0 + 0.16, y0 + 0.62, -0.4, 0.34, mat, 1); BX(s, 0.36, 0.46, y0 + 0.16, y0 + 0.62, -0.4, 0.34, mat, 1);
    [[-0.38, -0.36], [0.38, -0.36], [-0.38, 0.32], [0.38, 0.32]].forEach(function (p) { BX(s, p[0] - 0.025, p[0] + 0.025, y0, y0 + 0.16, p[1] - 0.025, p[1] + 0.025, M.bronze, 1); });
    s.updateMatrixWorld(true); seatFromGroup(s, -0.36, 0.36, -0.26, 0.36, y0 + 0.46, 0, y0 > 3 ? 1 : 0); solidFromGroupBox(s, -0.46, 0.46, -0.42, -0.26, y0 + 0.16, y0 + 0.92); }
  function floorLamp(g, x, z, y0) { var M = mats(); CY(g, 0.16, 0.18, 0.03, M.bronzeDark, x, y0 + 0.015, z, 16); CY(g, 0.015, 0.015, 1.5, M.bronze, x, y0 + 0.78, z, 8); CY(g, 0.2, 0.26, 0.34, M.shade, x, y0 + 1.62, z, 20); }
  var HALL_POTS = [[-14.6, 9.4], [14.6, -9.6], [-14.6, -9.6], [14.6, 1.2]], SUITE_POTS = [[-10.6, 1.3], [10.4, 1.3]];
  function pot(g, x, z, y0, s, noPlant) { var M = mats(); CY(g, 0.42 * s * 1.6, 0.34 * s * 1.6, 0.72 * s * 1.3, M.stoneDark, x, y0 + 0.36 * s * 1.3, z, 20); CY(g, 0.4 * s * 1.6, 0.4 * s * 1.6, 0.02, M.soil, x, y0 + 0.72 * s * 1.3 - 0.03, z, 20); if (!noPlant) agave(g, x, y0 + 0.72 * s * 1.3 - 0.02, z, 0.9 * s * 1.4); SOL(x - 0.45, x + 0.45, z - 0.45, z + 0.45, y0, y0 + 0.9); }
  // a sculptural agave: tapered, keeled blades in two rings (merged later with every other agave)
  var AGAVE = null;
  function agaveGeo() { if (AGAVE) return AGAVE; var parts = []; var blade = new THREE.ConeGeometry(0.13, 1, 4, 1); blade.translate(0, 0.5, 0); blade.scale(1, 1, 0.3);
    var rings = [[12, 0.9, 1.0, 0], [10, 0.78, 0.7, 0.3], [8, 0.62, 0.42, 0.15], [5, 0.45, 0.18, 0.5]]; rings.forEach(function (rg) { for (var i = 0; i < rg[0]; i++) { var a = i / rg[0] * TAU + rg[3], L = rg[1] * (0.85 + 0.3 * ((i * 37) % 7) / 7); var b = blade.clone(); b.scale(1, L, 1); b.rotateX(rg[2]); b.rotateY(a); parts.push(b); } });
    var U = THREE.BufferGeometryUtils; var mg = U && (U.mergeGeometries || U.mergeBufferGeometries); AGAVE = mg ? mg.call(U, parts.map(function (p) { return p.index ? p.toNonIndexed() : p; })) : parts[0]; AGAVE.computeVertexNormals(); return AGAVE; }
  function agave(g, x, y, z, s) { var m = new THREE.Mesh(agaveGeo(), mats().agave); m.position.set(x, y, z); m.scale.setScalar(s); m.rotation.y = rr() * TAU; g.add(m); return m; }
  // solids for a box given in a child group's own frame
  function solidFromGroupBox(sg, x0, x1, z0, z1, y0, y1) { var c = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2); var p = localToBuilding(sg, c); var ry = S.yaw + rotToBuilding(sg); var w = L2W(p.x, p.z); return addS(w[0], w[1], ry, x1 - x0, z1 - z0, S.B + y0, S.B + y1); }
  function SOL2(sg, x0, x1, z0, z1, y0, y1) { return solidFromGroupBox(sg, x0, x1, z0, z1, y0, y1); }
  function seatFromGroup(sg, x0, x1, z0, z1, top, faceLocal, lvl) { var c = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2); var p = localToBuilding(sg, c); var w = L2W(p.x, p.z); var rb = rotToBuilding(sg); var sd = addS(w[0], w[1], S.yaw + rb, x1 - x0, z1 - z0, S.B + top - 0.4, S.B + top); if (!sd) return; sd.face = S.yaw + rb + (faceLocal || 0); sd.gbLvl = lvl; GB.seats.push(sd); }
  // a point in a nested group's frame -> the building frame (groups nest at most two deep under a G root)
  function localToBuilding(sg, v) { var p = v.clone(); var o = sg; while (o && !(o.userData && o.userData.gbank)) { p.multiply(o.scale); p.applyEuler(o.rotation); p.add(o.position); o = o.parent; } return p; }
  function rotToBuilding(sg) { var r = 0, o = sg; while (o && !(o.userData && o.userData.gbank)) { r += o.rotation.y; o = o.parent; } return r; }

  // ── the Riverside Management Group suite ──
  function buildSuite() {
    var g = G.suite, M = mats(), U = K.suite, y0 = K.TL, y1 = K.uy1 - 0.02, t = 0.3;
    floorPlane(g, U[0] + t, U[1] - 0.05, U[2] + t, U[3] - 0.05, y0 + 0.014, M.floorWood, 3.2);
    PL(g, U[1] - U[0], U[3] - U[2], M.plaster, 0, y1 - 0.02, (U[2] + U[3]) / 2, 0, Math.PI / 2);
    // walnut panelled back wall and north wall, a cove with a warm light line
    BX(g, U[0] + t, U[1] - t, y0, y1, U[2] + t, U[2] + t + 0.06, M.walnutDark, 1.2); for (var i = 0; i < 12; i++) { var x = U[0] + t + (U[1] - U[0] - 2 * t) * (i + 0.5) / 12; BX(g, x - 0.012, x + 0.012, y0, y1, U[2] + t + 0.06, U[2] + t + 0.075, M.black, 1); }
    BX(g, U[0] + t, U[0] + t + 0.06, y0, y1, U[2] + t, U[3] - t, M.walnut, 1.2);
    BX(g, U[0] + t, U[1] - t, y1 - 0.42, y1 - 0.36, U[2] + t, U[3] - 0.2, M.plaster, 1); BX(g, U[0] + t + 0.3, U[1] - t - 0.3, y1 - 0.36, y1 - 0.33, U[2] + t + 0.3, U[3] - 0.5, M.ledWarm, 1);
    BX(g, U[0] + t, U[1] - t, y0, y0 + 0.12, U[3] - 0.18, U[3] - 0.12, M.walnutDark, 1);
    // bookcases along the north wall (models when they exist)
    var bk = MODELS.bookcase; for (var b = 0; b < 3; b++) { var bz = -9.6 + b * 3.2; if (bk) { placeModel(g, "bookcase", U[0] + t + 0.3, y0, bz, Math.PI / 2, [3.0, 3.1, 0.5]); SOL(U[0] + t, U[0] + t + 0.55, bz - 1.5, bz + 1.5, y0, y0 + 3); } else bookcase(g, U[0] + t + 0.25, y0, bz); }
    // the executive desk and chair (models when they exist), facing the door
    var dx = -5.4, dz = -6.6; if (MODELS.exec_desk) placeModel(g, "exec_desk", dx, y0, dz, 0, [2.4, 0.78, 1.1]); else desk(g, dx, y0, dz); SOL(dx - 1.2, dx + 1.2, dz - 0.55, dz + 0.55, y0, y0 + 0.78);
    var dc = new THREE.Group(); dc.position.set(dx, 0, dz - 1.0); g.add(dc); BX(dc, -0.34, 0.34, y0 + 0.44, y0 + 0.56, -0.3, 0.32, M.leatherDark, 1); BX(dc, -0.32, 0.32, y0 + 0.56, y0 + 1.35, -0.34, -0.22, M.leatherDark, 1); CY(dc, 0.03, 0.03, 0.4, M.bronzeDark, 0, y0 + 0.22, 0, 8); CY(dc, 0.3, 0.3, 0.03, M.bronzeDark, 0, y0 + 0.03, 0, 16);
    // the credenza and the painting behind the desk
    BX(g, dx - 1.7, dx + 1.7, y0, y0 + 0.78, U[2] + t + 0.08, U[2] + t + 0.6, M.walnut, 1); BX(g, dx - 1.72, dx + 1.72, y0 + 0.78, y0 + 0.82, U[2] + t + 0.06, U[2] + t + 0.62, M.stoneDark, 1); SOL(dx - 1.7, dx + 1.7, U[2] + t, U[2] + t + 0.62, y0, y0 + 0.82);
    [[dx - 1.1, 0.26], [dx - 0.8, 0.2]].forEach(function (p) { CY(G.suite, 0.06, 0.07, p[1], M.glass, p[0], y0 + 0.82 + p[1] / 2, U[2] + t + 0.32, 14); });
    var globe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), M.walnut); globe.position.set(dx + 1.05, y0 + 1.1, U[2] + t + 0.34); g.add(globe); var mer = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.012, 8, 40), M.brass); mer.position.set(dx + 1.05, y0 + 1.1, U[2] + t + 0.34); mer.rotation.y = 0.5; g.add(mer); CY(g, 0.1, 0.12, 0.06, M.brass, dx + 1.05, y0 + 0.85, U[2] + t + 0.34, 14); CY(g, 0.012, 0.012, 0.3, M.brass, dx + 1.05, y0 + 0.94, U[2] + t + 0.34, 6);
    // the lounge: sofa and two lounge chairs round a low table, in front of a linear fireplace
    var fx = 4.6, fz = U[2] + t + 0.07; BX(g, fx - 1.8, fx + 1.8, y0 + 0.3, y0 + 1.25, fz, fz + 0.02, M.black, 1); var fire = BX(G.suite, fx - 1.4, fx + 1.4, y0 + 0.42, y0 + 0.62, fz + 0.02, fz + 0.06, M.fire, 1); fire.userData.noMerge = true; GB.fire = fire;
    BX(g, fx - 1.5, fx + 1.5, y0 + 0.38, y0 + 0.42, fz + 0.02, fz + 0.3, M.brass, 1);
    BX(g, fx - 3, fx + 3, y0 + 0.016, y0 + 0.028, -8.9, -2.6, M.rug, 1);
    sofa(g, fx, -3.4, Math.PI, 3.0, M.fabricOlive, y0);
    if (MODELS.lounge_chair) { placeModel(g, "lounge_chair", fx - 2.4, y0, -6.8, Math.PI / 2, [0.9, 0.95, 0.9]); placeModel(g, "lounge_chair", fx + 2.4, y0, -6.8, -Math.PI / 2, [0.9, 0.95, 0.9]); seat(fx - 2.8, fx - 2.0, -7.2, -6.4, y0 + 0.46, Math.PI / 2, 1); seat(fx + 2.0, fx + 2.8, -7.2, -6.4, y0 + 0.46, -Math.PI / 2, 1); }
    else { chair(g, fx - 2.4, -6.8, Math.PI / 2, M.leather, y0); chair(g, fx + 2.4, -6.8, -Math.PI / 2, M.leather, y0); }
    BX(g, fx - 0.8, fx + 0.8, y0 + 0.36, y0 + 0.42, -7.2, -6.3, M.walnutDark, 1); BX(g, fx - 0.7, fx + 0.7, y0, y0 + 0.36, -7.1, -6.4, M.brass, 1); SOL(fx - 0.8, fx + 0.8, -7.2, -6.3, y0, y0 + 0.42);
    floorLamp(g, fx + 3.4, -3.0, y0); floorLamp(g, -8.2, -9.9, y0);
    // side table and books on the low table
    [[fx - 0.3, 0.06, 0x7a2e24], [fx + 0.25, 0.04, 0x1f3b2c]].forEach(function (p) { BX(G.suite, p[0] - 0.16, p[0] + 0.16, y0 + 0.42, y0 + 0.42 + p[1], -6.9, -6.66, new THREE.MeshStandardMaterial({ color: p[2], roughness: 0.8 }), 1); });
    // planters by the door and a sculpture on a plinth by the south glass
    SUITE_POTS.forEach(function (p) { pot(g, p[0], p[1], y0, 0.55, GB.potModel); });
    BX(g, 9.4, 10.4, y0, y0 + 1.0, -9.8, -8.8, M.stone, 1); SOL(9.4, 10.4, -9.8, -8.8, y0, y0 + 1.0); var sc = new THREE.Mesh(new THREE.TorusKnotGeometry(0.28, 0.07, 96, 12, 2, 3), M.bronze); sc.position.set(9.9, y0 + 1.45, -9.3); g.add(sc);
    GB.n.suite = 1;
  }
  function desk(g, x, y0, z) { var M = mats(); BX(g, x - 1.2, x + 1.2, y0 + 0.72, y0 + 0.78, z - 0.55, z + 0.55, M.walnutDark, 1); BX(g, x - 1.1, x + 1.1, y0 + 0.772, y0 + 0.781, z - 0.4, z + 0.3, M.leather, 1); BX(g, x - 1.14, x - 1.02, y0, y0 + 0.72, z - 0.5, z + 0.5, M.bronzeDark, 1); BX(g, x + 1.02, x + 1.14, y0, y0 + 0.72, z - 0.5, z + 0.5, M.bronzeDark, 1); BX(g, x - 1.02, x + 1.02, y0 + 0.3, y0 + 0.7, z + 0.36, z + 0.42, M.walnut, 1);
    BX(g, x + 0.5, x + 0.95, y0 + 0.78, y0 + 0.8, z - 0.2, z + 0.1, M.black, 1); CY(g, 0.07, 0.08, 0.03, M.brass, x - 0.7, y0 + 0.795, z - 0.15, 14); CY(g, 0.012, 0.012, 0.42, M.brass, x - 0.7, y0 + 1.0, z - 0.15, 6); CY(g, 0.11, 0.14, 0.14, M.shade, x - 0.7, y0 + 1.2, z - 0.15, 16); }
  function bookcase(g, x, y0, z) { var M = mats(); var W = 3.0, Hb = 3.2, Dp = 0.42; BX(g, x - 0.05, x + 0.01, y0, y0 + Hb, z - W / 2, z + W / 2, M.walnutDark, 1); BX(g, x - 0.05, x + Dp, y0, y0 + Hb, z - W / 2, z - W / 2 + 0.05, M.walnutDark, 1); BX(g, x - 0.05, x + Dp, y0, y0 + Hb, z + W / 2 - 0.05, z + W / 2, M.walnutDark, 1); BX(g, x - 0.05, x + Dp, y0 + Hb - 0.06, y0 + Hb, z - W / 2, z + W / 2, M.walnutDark, 1); BX(g, x - 0.05, x + Dp, y0, y0 + 0.1, z - W / 2, z + W / 2, M.walnutDark, 1); SOL(x - 0.05, x + Dp, z - W / 2, z + W / 2, y0, y0 + Hb);
    if (!MT.books) { var cols = ["#7a2e24", "#2f4a3a", "#33456a", "#d8c7a4", "#a0783f", "#5a4636", "#efe6d6", "#8c3a2e", "#1f2a3a", "#c2a45a", "#4a5a3a", "#6a2230"]; var bt = cv(64, 16, function (x) { cols.forEach(function (c, i) { x.fillStyle = c; x.fillRect(i * 64 / cols.length, 0, 64 / cols.length + 1, 16); x.fillStyle = "rgba(255,230,170,0.35)"; x.fillRect(i * 64 / cols.length + 1, 3, 1, 10); }); }); bt.userData.text = false; bt.magFilter = THREE.NearestFilter; bt.minFilter = THREE.NearestFilter; bt.generateMipmaps = false; MT.books = new THREE.MeshStandardMaterial({ map: bt, roughness: 0.82 }); MT.booksN = cols.length; }
    for (var s = 0; s < 6; s++) { var sy = y0 + 0.12 + s * 0.52; BX(g, x + 0.02, x + Dp + 0.01, sy - 0.03, sy, z - W / 2 + 0.05, z + W / 2 - 0.05, M.walnut, 1); if (s > 0) BX(g, x + Dp - 0.03, x + Dp - 0.01, sy - 0.045, sy - 0.03, z - W / 2 + 0.08, z + W / 2 - 0.08, M.ledPanel, 1); if (s === 5) continue; var zz = z - W / 2 + 0.1; while (zz < z + W / 2 - 0.15) { if (rr() < 0.12) { zz += 0.3; continue; } var bw = 0.03 + rr() * 0.05, bh = 0.26 + rr() * 0.16; if (rr() < 0.08) { var ob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), M.brass); ob.position.set(x + 0.2, sy + 0.09, zz + 0.1); g.add(ob); zz += 0.3; continue; } var bk2 = BX(g, x + 0.06, x + 0.06 + 0.2 + rr() * 0.08, sy, sy + bh, zz, zz + bw, MT.books, 0); var ci = (Math.floor(rr() * MT.booksN) + 0.5) / MT.booksN, uvb = bk2.geometry.attributes.uv; for (var ui = 0; ui < uvb.count; ui++) uvb.setXY(ui, ci, 0.5); zz += bw + 0.004; } } }
  // a registered model scaled to a target size [x, y, z] (metres), placed in a building group
  function placeModel(g, kind, x, y, z, ry, target) { var m = MODELS[kind]; var mg = makeModel(kind); var sx = m.sx || 1, sz = m.sz || 1, sh = m.height || 1; var k = Math.min(target[0] / sx, target[2] / sz, target[1] / sh); if (!isFinite(k) || k <= 0) k = 1; mg.scale.setScalar(k); mg.position.set(x, y, z); mg.rotation.y = ry; g.add(mg); GB.n["m_" + kind] = (GB.n["m_" + kind] || 0) + 1; return mg; }

  // ── the terrace: canopy lights, loungers, a fire table, long planters ──
  function buildTerrace() {
    var g = G.up, M = mats(), y0 = K.TL;
    [[-11, -3.2], [3.2, 15.6]].forEach(function (r) { BX(g, r[0], r[1], y0, y0 + 0.5, 10.3, 10.95, M.stone, 1.2); BX(g, r[0] + 0.06, r[1] - 0.06, y0 + 0.46, y0 + 0.48, 10.36, 10.89, M.gravel, 1); SOL(r[0], r[1], 10.3, 10.95, y0, y0 + 0.5); if (!GB.potModel) for (var x = r[0] + 0.6; x < r[1] - 0.3; x += 1.1) agave(g, x, y0 + 0.48, 10.62, 0.5 + 0.15 * rr()); });
    // west: two loungers and a side table facing the plaza; east: an outdoor sofa round a fire table
    [-8.2, -5.6].forEach(function (x) { lounger(g, x, 7.4, 0); }); BX(g, -7.2, -6.6, y0, y0 + 0.45, 7.2, 7.8, M.bronzeDark, 1); SOL(-7.2, -6.6, 7.2, 7.8, y0, y0 + 0.45);
    sofa(g, 6.4, 6.2, 0, 3.2, M.fabric, y0); BX(g, 5.2, 7.6, y0, y0 + 0.36, 7.5, 8.5, M.stoneDark, 1); SOL(5.2, 7.6, 7.5, 8.5, y0, y0 + 0.36); var ft = BX(G.dyn, 5.5, 7.3, y0 + 0.36, y0 + 0.5, 7.9, 8.1, M.fire, 1); ft.userData.noMerge = true; GB.fire2 = ft;
    // canopy downlights (emissive discs) and lanterns
    for (var i = -2; i <= 2; i++) for (var j = 0; j < 2; j++) { var d = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 14), M.ledWarm); d.position.set(i * 4.6, K.uy1 - 0.16, 3.6 + j * 3.2); g.add(d); }
    [[-11.8, 10.6], [-3.6, 10.6], [3.6, 10.6], [15.9, 10.6], [15.9, -10.8], [-15.9, -10.8]].forEach(function (p) { lantern(g, p[0], y0, p[1]); });
    GB.n.terrace = 1;
  }
  function lounger(g, x, z, ry) { var s = new THREE.Group(); s.position.set(x, 0, z); s.rotation.y = ry; g.add(s); var M = mats(), y0 = K.TL;
    if (MODELS.lounge_chair) { placeModel(s, "lounge_chair", 0, y0, 0, 0, [0.9, 0.95, 0.9]); } else { BX(s, -0.42, 0.42, y0 + 0.16, y0 + 0.22, -0.46, 0.46, M.walnut, 1); BX(s, -0.39, 0.39, y0 + 0.22, y0 + 0.4, -0.43, 0.43, M.plaster, 1); BX(s, -0.39, 0.39, y0 + 0.4, y0 + 0.9, -0.5, -0.33, M.plaster, 1); BX(s, -0.46, -0.4, y0, y0 + 0.6, -0.5, 0.46, M.walnut, 1); BX(s, 0.4, 0.46, y0, y0 + 0.6, -0.5, 0.46, M.walnut, 1); BX(s, -0.46, 0.46, y0 + 0.6, y0 + 0.64, -0.5, -0.36, M.walnut, 1); }
    s.updateMatrixWorld(true); seatFromGroup(s, -0.4, 0.4, -0.32, 0.45, y0 + 0.45, 0, 1); solidFromGroupBox(s, -0.44, 0.44, -0.5, -0.32, y0, y0 + 0.95); }
  function lantern(g, x, y0, z) { var M = mats(); BX(g, x - 0.16, x + 0.16, y0, y0 + 0.04, z - 0.16, z + 0.16, M.bronzeDark, 1); BX(g, x - 0.13, x + 0.13, y0 + 0.04, y0 + 0.62, z - 0.13, z + 0.13, M.shade, 1); BX(g, x - 0.16, x + 0.16, y0 + 0.62, y0 + 0.68, z - 0.16, z + 0.16, M.bronzeDark, 1); }

  // ── the forecourt: palm planters, bed kerbs, benches, the monument and the stair plaque ──
  function buildCourt() {
    var g = G.court, M = mats(); var gy = function (lx, lz) { var w = L2W(lx, lz); return getH(w[0], w[1]) - S.B; };
    (GB.beds || []).forEach(function (b, bi) { if (GB.model && (modelBlocks(b[0], b[1]) || modelBlocks(b[0], b[2]) || modelBlocks(b[0], (b[1] + b[2]) / 2))) return; var zm = (b[1] + b[2]) / 2; var y = Math.min(gy(b[0], b[1]), gy(b[0], b[2]), gy(b[0], zm)); var y1 = Math.max(gy(b[0], b[1]), gy(b[0], b[2]), gy(b[0], zm)) + 0.34; GB.bedTop = GB.bedTop || []; GB.bedTop.push(y1);
      /* R8: the bed planting stands on this gravel (seated at the terrain hook, before the court was graded and the bed built: about 6 cm under it) */ if (window.R8ON !== false && typeof planSeatEntry === "function") (GB.bedPlants || []).forEach(function (q) { if (q[1] !== bi || !q[2]) return; var yt = S.B + y1 - 0.02; if (Math.abs(q[0][1] - yt) > 0.01) try { planSeatEntry(q[2], q[0], yt); GB.n.reseated = (GB.n.reseated || 0) + 1; } catch (e) {} }); BX(g, b[0] - 0.9, b[0] + 0.9, y - 0.25, y1, b[1], b[2], M.stone, 1.2); BX(g, b[0] - 0.92, b[0] + 0.92, y1, y1 + 0.03, b[1] - 0.02, b[2] + 0.02, M.bronzeDark, 1); BX(g, b[0] - 0.76, b[0] + 0.76, y1 - 0.05, y1 - 0.02, b[1] + 0.14, b[2] - 0.14, M.gravel, 1); SOL(b[0] - 0.9, b[0] + 0.9, b[1], b[2], y - 0.3, y1 + 0.03); });
    // benches: travertine plinth, walnut slats (bench_lux when it exists)
    [[13.4, 19.5, -Math.PI / 2], [13.4, 25.5, -Math.PI / 2], [-13.4, 28.6, Math.PI / 2]].forEach(function (b) { if (modelBlocks(b[0], b[1])) return; var y = gy(b[0], b[1]); var s = new THREE.Group(); s.position.set(b[0], y, b[1]); s.rotation.y = b[2]; g.add(s);
      if (MODELS.bench_lux) placeModel(s, "bench_lux", 0, 0, 0, 0, [2.2, 0.9, 0.8]); else { BX(s, -1.1, 1.1, -0.1, 0.36, -0.28, 0.28, M.stone, 1.2); for (var i = 0; i < 5; i++) BX(s, -1.15, 1.15, 0.36, 0.44, -0.3 + i * 0.125, -0.2 + i * 0.125, M.walnut, 1); }
      s.updateMatrixWorld(true); var p = localToBuilding(s, new THREE.Vector3(0, 0, 0)); var w = L2W(p.x, p.z); var sd = addS(w[0], w[1], S.yaw + b[2], 2.3, 0.6, S.B + y - 0.1, S.B + y + 0.45); if (sd) { sd.seat = true; sd.face = S.yaw + b[2]; sd.gbLvl = 0; GB.seats.push(sd); } });
    // the monument: a long low travertine block (text faces in buildTexts)
    var my = gy(11, 31.4); BX(g, 7.6, 14.4, my - 0.3, my + 1.25, 31.0, 31.8, M.stone, 1.2); BX(g, 7.5, 14.5, my - 0.3, my + 0.08, 30.9, 31.9, M.stoneDark, 1.2); SOL(7.6, 14.4, 31.0, 31.8, my - 0.3, my + 1.25); GB.monY = my;
    GB.n.court = 1;
  }

  // ── lights: pooled point lights (the engine's light pool copies the nearest), so the visible light count never changes ──
  // warm additive light pools (night only): at every palm, on the corner pier, along the stair's outer wall
  function buildWashes() { var tex = cv(128, 128, function (x, w, h) { var gr = x.createRadialGradient(w / 2, h, 0, w / 2, h, h); gr.addColorStop(0, "rgba(255,214,150,0.95)"); gr.addColorStop(0.35, "rgba(255,196,120,0.45)"); gr.addColorStop(1, "rgba(255,180,100,0)"); x.fillStyle = gr; x.fillRect(0, 0, w, h); }); tex.userData.text = false;
    var m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }); GB.washMat = m; var g = G.court; var gy = function (lx, lz) { var w = L2W(lx, lz); return getH(w[0], w[1]) - S.B; };
    var wash = function (w, h, x, y, z, ry) { var p = PL(g, w, h, m, x, y + h / 2, z, ry); p.userData.noMerge = true; p.renderOrder = 2; return p; };
    (GB.palms || []).forEach(function (p) { var y = gy(p[0], p[1]) + 0.4; wash(2.4, 5.5, p[0], y, p[1], S.yaw * 0 + Math.PI / 2); wash(2.4, 5.5, p[0], y, p[1], 0); });
    wash(1.4, 5.6, 16.1, 0.6, 11.4, 0); wash(5.4, 3.2, -16.64, 0.05, 20.5, -Math.PI / 2); wash(4.2, 3.0, -16.64, 1.0, 14.8, -Math.PI / 2); var my = GB.monY || 0; wash(6.6, 1.6, 11, my - 0.2, 31.83, 0); }
  function buildLights() { try { buildWashes(); } catch (e) { note("washes", e); }
    var add = function (col, k, dist, x, y, z, kind) { var l = new THREE.PointLight(col, k, dist, 1.15); l.position.set(x, y, z); l.castShadow = false; ((kind === "suite" && G.suite) || (kind === "terrace" && G.up) || G.dyn).add(l); GB.lights.push({ l: l, base: k, kind: kind }); };
    add(0xfff0dc, 5.2, 24, -8, 5.2, 3, "hall"); add(0xfff0dc, 5.2, 24, 8, 5.2, 3, "hall"); add(0xeafff0, 4.0, 20, 0, 4.6, -6.5, "hall");
    add(0xffe2bc, 3.4, 16, -5, 9.9, -4.2, "suite"); add(0xffe2bc, 3.4, 16, 5, 9.9, -5.5, "suite"); add(0xffd6a0, 3.0, 16, 0, 10.2, 5.5, "terrace");
  }

  // ── texts (partners.json): the ledger, the stations, the panels, the plaques and the lettering ──
  function buildTexts() {
    if (GB.texts || !DATA) return; GB.texts = true; var g = G.dyn, M = mats(), y0 = K.hy0, Hh = K.hall;
    var lit = function (tex, k) { return new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: k === undefined ? 0.55 : k, roughness: 0.6, transparent: true }); };
    var bronzeText = function (tex) { return new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, metalness: 0.7, roughness: 0.32, color: 0xffffff, emissive: 0xffd9a0, emissiveMap: tex, emissiveIntensity: 0.12 }); };
    // the ledger wall: a scrolling screen and its header
    var L = D("gbank.ledger", {}); var routes = L.routes || ["Squads treasury > Giveback protocol"], stats = L.status || ["confirmed"]; var B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    var sig = function () { var s = ""; for (var i = 0; i < 6; i++) s += B58[Math.floor(rr() * B58.length)]; s += "..."; for (var j = 0; j < 6; j++) s += B58[Math.floor(rr() * B58.length)]; return s; };
    var ROWS = 48, RH = 40, rowsTex = cv(2048, ROWS * RH, function (x, w, h) { x.fillStyle = "#040806"; x.fillRect(0, 0, w, h); var t0 = 9 * 3600 + 12 * 60; x.textBaseline = "middle";
      for (var i = 0; i < ROWS; i++) { var y = i * RH, cy = y + RH / 2; if (i % 2) { x.fillStyle = "rgba(77,222,111,0.06)"; x.fillRect(0, y, w, RH); } var tt = t0 + i * 17 + Math.floor(rr() * 9); var hh = Math.floor(tt / 3600) % 24, mm = Math.floor(tt / 60) % 60, ss = tt % 60; var ts = (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
        x.font = "400 24px " + MONO; x.fillStyle = "#6fae84"; x.textAlign = "left"; x.fillText(ts, 44, cy); x.fillStyle = "#eaf6ee"; x.fillText(sig(), 300, cy); x.font = "600 24px " + SANS; x.fillStyle = "#cbeed6"; x.fillText(routes[(i * 7 + 3) % routes.length], 760, cy);
        var st = stats[i % stats.length]; x.fillStyle = "#4DDE6F"; x.beginPath(); x.arc(1700, cy, 7, 0, TAU); x.fill(); x.font = "400 24px " + MONO; x.fillText(st, 1722, cy); } });
    rowsTex.wrapT = THREE.RepeatWrapping; rowsTex.repeat.set(1, 10 / ROWS); rowsTex.offset.set(0, 1 - 10 / ROWS);
    var scr = new THREE.MeshBasicMaterial({ map: rowsTex, toneMapped: false, color: 0xd8e8dc }); var sw = 16, sh = 3.1, sy = y0 + 1.05; var screen = PL(G.hall, sw, sh, scr, 0, sy + sh / 2, Hh[2] + 0.44); HALL.rows = rowsTex; HALL.rowsN = ROWS; HALL.screen = screen;
    var cols = L.cols || ["TIME", "SIGNATURE", "ROUTE", "STATUS"]; var ct = cv(2048, 30, function (x, w, h) { x.fillStyle = "#07120b"; x.fillRect(0, 0, w, h); x.textBaseline = "middle"; x.textAlign = "left"; x.font = "600 19px " + MONO; x.fillStyle = "#6fae84"; [44, 300, 760, 1700].forEach(function (px, i) { if (cols[i]) spaced(x, cols[i], px, h / 2 + 1, 3); }); });
    PL(G.hall, sw, sw * 30 / 2048, new THREE.MeshBasicMaterial({ map: ct, toneMapped: false }), 0, sy + sh + 0.02 + sw * 15 / 2048, Hh[2] + 0.44);
    var hdr = cv(2048, 92, function (x, w, h) { x.fillStyle = "#07120b"; x.fillRect(0, 0, w, h); x.fillStyle = "#4DDE6F"; x.fillRect(0, h - 3, w, 3); x.textBaseline = "middle"; x.textAlign = "left"; x.font = "400 50px " + DISP; x.fillStyle = "#f5f1e6"; spaced(x, L.title || "THE GIVEBACK LEDGER", 44, 38, 5); var tw = 0; try { x.letterSpacing = "5px"; tw = x.measureText(L.title || "THE GIVEBACK LEDGER").width; x.letterSpacing = "0px"; } catch (e) {} x.font = "600 22px " + SANS; x.fillStyle = "#9fe0b0"; x.fillText(L.sub || "", 44 + tw + 36, 42); x.textAlign = "right"; x.font = "600 22px " + MONO; x.fillStyle = "#4DDE6F"; x.fillText(L.live || "LIVE", w - 70, 40); });
    var hy = sy + sh + 0.28 + sw * 46 / 2048; PL(G.hall, sw, sw * 92 / 2048, new THREE.MeshBasicMaterial({ map: hdr, toneMapped: false }), 0, hy, Hh[2] + 0.44);
    var dot = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), new THREE.MeshBasicMaterial({ color: 0x4dde6f, toneMapped: false })); dot.position.set(sw / 2 - 2.05, hy + 0.02, Hh[2] + 0.45); g.add(dot); HALL.dot = dot;
    var band = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh / 10), new THREE.MeshBasicMaterial({ color: 0x4dde6f, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); band.position.set(0, sy + sh / 20, Hh[2] + 0.45); g.add(band); HALL.band = band;
    // the five stations: glass fins with the step, the name and one line
    var st = D("gbank.flow.stations", []); HALL.stations.forEach(function (s, i) { var d = st[i]; if (!d) return; var tex = cv(512, 704, function (x, w, h) { x.clearRect(0, 0, w, h); x.textAlign = "left"; x.textBaseline = "alphabetic"; x.font = "400 96px " + DISP; x.fillStyle = "rgba(77,222,111,0.95)"; x.fillText(d.n, 34, 132); x.fillStyle = "#4DDE6F"; x.fillRect(36, 160, 90, 5); x.font = "600 44px " + SANS; x.fillStyle = "#f5f1e6"; var words = d.t.split(" "); var ln = "", yy = 240; words.forEach(function (wd) { var tr = ln ? ln + " " + wd : wd; if (x.measureText(tr).width > 440) { x.fillText(ln, 34, yy); yy += 54; ln = wd; } else ln = tr; }); if (ln) x.fillText(ln, 34, yy); x.font = "400 29px " + SANS; x.fillStyle = "#d9e6dc"; (d.l || []).forEach(function (l, k) { x.fillText(l, 34, yy + 70 + k * 40); }); });
      var m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }); var sg2 = new THREE.Group(); g.add(sg2); PL(sg2, 1.5, 2.06, m, s.x, y0 + 2.2, s.z + 0.012); PL(sg2, 1.5, 2.06, m, s.x, y0 + 2.2, s.z - 0.012, Math.PI); try { planMergeStatic(sg2, null, false); } catch (e) {} });
    var fl = D("gbank.flow", {}); var ft = cv(1024, 180, function (x, w, h) { x.clearRect(0, 0, w, h); x.textAlign = "center"; x.textBaseline = "middle"; x.font = "400 76px " + DISP; x.fillStyle = gold(x, 20, 110); spaced(x, fl.title || "THE CAPITAL FLOW", w / 2, 66, 10); x.font = "600 30px " + SANS; x.fillStyle = "#e9dcc2"; x.fillText(fl.sub || "", w / 2, 146); });
    PL(g, 6.4, 1.125, bronzeText(ft), 0, K.hy1 - 0.95, -2.2 + 0.02);
    // the side panels ($GBACK utility, real world assets)
    var pn = D("gbank.panels", []); [[pn[0], Hh[0] + 0.13, Math.PI / 2], [pn[1], Hh[1] - 0.13, -Math.PI / 2]].forEach(function (q) { var d = q[0]; if (!d) return; var tex = cv(1024, 612, function (x, w, h) { x.fillStyle = "#0b1510"; x.fillRect(0, 0, w, h); x.strokeStyle = "rgba(214,176,100,0.8)"; x.lineWidth = 3; x.strokeRect(18, 18, w - 36, h - 36); x.textAlign = "left"; x.textBaseline = "alphabetic"; x.font = "400 58px " + DISP; x.fillStyle = "#f4cd5a"; spaced(x, d.t, 60, 118, 3); x.fillStyle = "#4DDE6F"; x.fillRect(62, 146, 120, 5); x.font = "400 40px " + SANS; x.fillStyle = "#eee6d6"; (d.l || []).forEach(function (l, k) { x.fillText(l, 60, 222 + k * 64); }); });
      PL(g, 4.6, 4.6 * 612 / 1024, lit(tex, 0.5), q[1], y0 + 2.65, -4, q[2]); });
    // plaques: the no-offer line inside the entrance, the way to RMG
    var pq = cv(1024, 200, function (x, w, h) { x.fillStyle = "#1a1612"; x.fillRect(0, 0, w, h); x.strokeStyle = "#b8904e"; x.lineWidth = 3; x.strokeRect(10, 10, w - 20, h - 20); x.textAlign = "center"; x.textBaseline = "middle"; x.font = "italic 400 36px " + SERIF; x.fillStyle = "#e9dcc2"; x.fillText(D("gbank.plaque", D("legal", "")), w / 2, h / 2); });
    PL(g, 3.2, 0.625, lit(pq, 0.25), -13.6, y0 + 1.7, Hh[3] - 0.32, Math.PI);
    var wf = D("gbank.wayfinding", {}); var wt = cv(1024, 256, function (x, w, h) { x.clearRect(0, 0, w, h); x.textAlign = "center"; x.textBaseline = "middle"; x.font = "400 50px " + SERIF; x.fillStyle = gold(x, 40, 130); spaced(x, wf.t || "RIVERSIDE MANAGEMENT GROUP", w / 2, 88, 8); x.font = "400 34px " + SANS; x.fillStyle = "#e9dcc2"; x.fillText(wf.l || "", w / 2, 176); });
    PL(g, 3.8, 0.95, bronzeText(wt), -13.6, y0 + 3.1, Hh[3] - 0.32, Math.PI);
    // the Riverside Management Group lettering in the suite, the door plaque, the agreement plaque
    var rn = D("rmg.name", "RIVERSIDE MANAGEMENT GROUP"), rl = D("rmg.line", "MERCHANT BANKING SINCE 1996");
    var rt = cv(2048, 420, function (x, w, h) { x.clearRect(0, 0, w, h); x.textAlign = "center"; x.textBaseline = "middle"; var fs = fitFont(x, rn, SERIF, 118, 14, w - 120); x.font = "400 " + fs + "px " + SERIF; x.fillStyle = gold(x, 70, 230); spaced(x, rn, w / 2 + 7, 150, 14); x.fillStyle = "rgba(214,176,100,0.9)"; x.fillRect(w / 2 - 260, 250, 520, 4); x.font = "400 52px " + SERIF; x.fillStyle = "#e7d2a4"; spaced(x, rl, w / 2 + 8, 330, 14); });
    PL(G.suite, 10.6, 10.6 * 420 / 2048, bronzeText(rt), 0, K.TL + 2.75, K.suite[2] + 0.3 + 0.08);
    var dp = cv(1024, 360, function (x, w, h) { x.fillStyle = "#231c15"; x.fillRect(0, 0, w, h); x.strokeStyle = "#c9a25a"; x.lineWidth = 4; x.strokeRect(14, 14, w - 28, h - 28); x.textAlign = "center"; x.textBaseline = "middle"; x.font = "400 58px " + SERIF; x.fillStyle = gold(x, 70, 150); spaced(x, "RIVERSIDE", w / 2, 108, 10); x.font = "400 36px " + SERIF; x.fillStyle = "#e7d2a4"; spaced(x, "MANAGEMENT GROUP", w / 2, 176, 8); x.font = "400 26px " + SANS; x.fillStyle = "#d9c7a4"; x.fillText(D("rmg.site", "rmginvestments.com"), w / 2, 262); });
    PL(GB.mode === "model" ? G.suite : G.up, 1.3, 0.457, lit(dp, 0.18), K.sdoor + 1.05, K.TL + 1.7, K.suite[3] + 0.11);
    var ag = cv(1024, 380, function (x, w, h) { x.fillStyle = "#231c15"; x.fillRect(0, 0, w, h); x.strokeStyle = "#c9a25a"; x.lineWidth = 3; x.strokeRect(12, 12, w - 24, h - 24); x.textAlign = "center"; x.textBaseline = "middle"; x.font = "400 30px " + SERIF; x.fillStyle = "#eadbbd"; var lines = wrap(x, D("rmg.agreement", "") + " " + D("rmg.experience", ""), 900); lines.forEach(function (l, i) { x.fillText(l, w / 2, 92 + i * 46); }); x.font = "italic 400 25px " + SERIF; x.fillStyle = "#cdb88f"; x.fillText(D("legal", ""), w / 2, h - 58); });
    PL(G.suite, 1.9, 0.705, lit(ag, 0.18), K.suite[0] + 0.39, K.TL + 1.6, -0.3, Math.PI / 2);
    // the stair plaque on the newel, the monument faces
    var sp = cv(512, 512, function (x, w, h) { x.fillStyle = "#231c15"; x.fillRect(0, 0, w, h); x.strokeStyle = "#c9a25a"; x.lineWidth = 4; x.strokeRect(14, 14, w - 28, h - 28); x.textAlign = "center"; x.textBaseline = "middle"; x.font = "400 50px " + SERIF; x.fillStyle = gold(x, 100, 180); spaced(x, "RIVERSIDE", w / 2, 150, 6); x.font = "400 30px " + SERIF; x.fillStyle = "#e7d2a4"; spaced(x, "MANAGEMENT GROUP", w / 2, 212, 4); x.fillStyle = "rgba(201,162,90,0.8)"; x.fillRect(w / 2 - 70, 262, 140, 3); x.font = "400 26px " + SANS; x.fillStyle = "#d9c7a4"; x.fillText("Upper terrace", w / 2, 322); x.fillText("Merchant banking since 1996", w / 2, 364); });
    PL(G.court, 0.4, 0.4, lit(sp, 0.2), K.stair.x0 + 0.075, 0.86, STAIR_FOOT + 0.456);
    var mo = D("gbank.monument", {}); var mt = cv(2048, 380, function (x, w, h) { x.clearRect(0, 0, w, h); x.textAlign = "center"; x.textBaseline = "middle"; x.font = "400 190px " + DISP; x.fillStyle = gold(x, 40, 230); spaced(x, mo.title || "GBANK", w / 2 + 20, 140, 34); x.font = "600 50px " + SANS; x.fillStyle = "#3a2e22"; x.fillText(mo.sub || "", w / 2, 272); x.font = "400 38px " + SANS; x.fillStyle = "#5a4a38"; x.fillText(mo.line || "", w / 2, 336); });
    var mm = bronzeText(mt); mm.emissiveIntensity = 0.06; GB.monMat = mm; var my = GB.monY || 0; PL(G.court, 6.4, 6.4 * 380 / 2048, mm, 11, my + 0.56, 31.815); PL(G.court, 6.4, 6.4 * 380 / 2048, mm, 11, my + 0.56, 30.985, Math.PI);
    // Will's name on the hall wayfinding is enough: hotspots pick their copy up now too
    fillHotspots(); GB.n.texts = 1;
  }
  function fitFont(x, text, fam, size, sp, maxW) { for (var fs = size; fs > 20; fs -= 2) { x.font = "400 " + fs + "px " + fam; try { x.letterSpacing = sp + "px"; } catch (e) {} var w = x.measureText(text).width; try { x.letterSpacing = "0px"; } catch (e) {} if (w <= maxW) return fs; } return 20; }
  function wrap(x, text, maxW) { var words = String(text).split(" "), out = [], ln = ""; words.forEach(function (w) { var t = ln ? ln + " " + w : w; if (x.measureText(t).width > maxW && ln) { out.push(ln); ln = w; } else ln = t; }); if (ln) out.push(ln); return out; }

  // ═════════════════════════ Will Deitrick ═════════════════════════
  var WILL_AT = [-3.3, -6.3];   // beside the desk, facing the door
  var WILL = { state: 0, g: null, ph: null, stub: null, mixer: null, yaw: 0, greetAt: 0, lab: null };
  function willPos() { var w = L2W(WILL_AT[0], WILL_AT[1]); return [w[0], S.B + K.TL + 0.014, w[1]]; }
  // the stand-in: a CAST-style rigged character in a charcoal suit (the engine's avatar), until the will model exists
  function buildWillStandIn() { var p = willPos(); var look = window.__willLook || { skin: "e0b596", shirt: "1b1d22", pants: "2c313b", shoes: "3a2419", hair: 5, hairc: "3b2717", body: "m" };
    var g = avatar("gbank_will", D("will.name", "Will Deitrick"), look, null, null); g.position.set(p[0], p[1], p[2]); g.rotation.y = S.yaw; if (g.userData.label) g.userData.label.scale.set(1.9, 0.48, 1); WILL.ph = g; WILL.yaw = S.yaw; WILL.lab = g.userData.label; try { GB.n.suit = dressWill(g); } catch (e) { note("suit", e); } }
  function dressWill(g) { var n = 0; g.traverse(function (o) { if (!o.isSkinnedMesh || !o.material || o.userData.suit) return; var nm = (o.material.name || "").toLowerCase(); if (nm !== "body" && nm !== "skin") return; o.userData.suit = true; var m = o.material, prev = m.onBeforeCompile; n++; m.roughness = Math.max(0.82, m.roughness || 0); m.metalness = 0; m.envMapIntensity = 0.35; if ("sheen" in m) m.sheen = 0; if ("specularIntensity" in m) m.specularIntensity = 0.4;
      m.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r); if (sh.fragmentShader.indexOf("uBodyH") < 0) return;
        sh.vertexShader = sh.vertexShader.replace("varying float vBodyY;", "varying float vBodyY; varying vec3 vSuitP;").replace("vBodyY = transformed.y;", "vBodyY = transformed.y; vSuitP = transformed;");
        sh.fragmentShader = sh.fragmentShader.replace("varying float vBodyY;", "varying float vBodyY; varying vec3 vSuitP;").replace("#include <color_fragment>", "#include <color_fragment>\n { float fy = vBodyY / uBodyH; float l2 = dot(diffuseColor.rgb, vec3(0.333)); float st = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b)); float sk = smoothstep(0.05, 0.14, st) * step(diffuseColor.b + 0.02, diffuseColor.r) * smoothstep(0.14, 0.3, l2); float head = step(0.815, fy); float jk = step(0.515, fy) * (1.0 - head); float tr = (1.0 - step(0.515, fy)) * step(0.07, fy) * (1.0 - sk); float vn = step(0.0, vSuitP.z) * step(0.72, fy) * (1.0 - head) * step(abs(vSuitP.x), (fy - 0.72) * uBodyH * 0.85); vec3 jc = vec3(0.1, 0.105, 0.12) * (0.55 + l2 * 1.1); vec3 tc = vec3(0.12, 0.13, 0.15) * (0.55 + l2 * 1.1); diffuseColor.rgb = mix(diffuseColor.rgb, jc, jk * (1.0 - vn)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.66, 0.75, 0.86) * (0.75 + l2 * 0.4), vn * (1.0 - step(abs(vSuitP.x), uBodyH * 0.012) * step(fy, 0.79))); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.1, 0.16), vn * step(abs(vSuitP.x), uBodyH * 0.012) * step(fy, 0.79)); diffuseColor.rgb = mix(diffuseColor.rgb, tc, tr); }");
      }; m.customProgramCacheKey = function () { return "gbankSuit"; }; m.needsUpdate = true; }); return n; }
  function willTick(dt, now, pl, upper) {
    var g = WILL.g || WILL.ph; if (!g) return; var p = willPos(); var dx = pl.x - p[0], dz = pl.z - p[2], d = Math.hypot(dx, dz);
    // turn to a visitor on this floor (rate limited), otherwise face the door
    var want = (GB.mode === "model" ? GB.zoneNow === 3 : upper) && d < 7.5 ? Math.atan2(dx, dz) : S.yaw; var err = Math.atan2(Math.sin(want - WILL.yaw), Math.cos(want - WILL.yaw)), turn = 2.4 * dt; WILL.yaw += err > turn ? turn : err < -turn ? -turn : err; g.rotation.y = WILL.yaw; g.position.set(p[0], p[1], p[2]);
    if (WILL.ph && !WILL.g) animateWalk(WILL.ph, 0, dt); if (WILL.mixer) WILL.mixer.update(Math.min(dt, 0.1));
    var inSuite = GB.mode === "model" ? GB.zoneNow === 3 : upper; if (WILL.lab) WILL.lab.visible = inSuite && d < 26; if (GB.mode === "model" && g.visible !== !!GB.inRoom) g.visible = !!GB.inRoom;
    // a greeting when someone walks up on this floor
    if (inSuite && d < 5 && now > WILL.greetAt) { WILL.greetAt = now + 45000 + rr() * 25000; try { var gr = D("will.greet", []); if (gr.length) npcSay(window.PLAN_TALK.will, gr[Math.floor(rr() * gr.length)]); } catch (e) {} }
    // the real model: once someone is within 140 m (registered in PLAN_MODEL_INFO, or found with one HEAD request)
    if (WILL.state === 0 && window.PLAN_MODEL_INFO && window.PLAN_MODEL_INFO.will && Math.hypot(camera.position.x - p[0], camera.position.z - p[2]) < 140) willLoad();
  }
  function willLoad() {
    WILL.state = 1; var info = window.PLAN_MODEL_INFO && window.PLAN_MODEL_INFO.will; var q = "?v=" + (window.BUILD || "dev");
    var url = info ? (ASSET.models === "/models_m" && info.mobile ? info.mobile : info.file || ASSET.models + "/will.glb") : ASSET.models + "/will.glb";
    var go = function () { try { gltfLoader().load(url + q, function (gl) { try { willLoaded(gl, info); } catch (e) { WILL.state = 3; note("will model", e); } }, undefined, function (e) { WILL.state = 3; }); } catch (e) { WILL.state = 3; note("will load", e); } };
    if (info) go(); else WILL.state = 0;   /* INT: wait for the asset round to publish PLAN_MODEL_INFO.will; the suited stand-in stays until then */
  }
  function willLoaded(gl, info) {
    var g = gl.scene; g.updateMatrixWorld(true); var bb = new THREE.Box3().setFromObject(g); var hgt = bb.max.y - bb.min.y; if (!(hgt > 0.2)) throw new Error("empty will model");
    var sc = hgt > 1.55 && hgt < 2.1 ? 1 : 1.83 / hgt; g.scale.setScalar(sc);
    var an = 1; try { an = MAX_ANISO || 1; } catch (e) {} g.traverse(function (o) { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { if (!m || an <= 1) return; ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap"].forEach(function (k) { if (m[k]) { m[k].anisotropy = an; m[k].needsUpdate = true; } }); }); } }); g.userData.noInst = true; g.userData.noCull = true;
    var mixer = new THREE.AnimationMixer(g); var clip = null, why = "";
    // an idle for the rig: a clip file named in PLAN_MODEL_INFO.will.idle, else the game's char_m idle retargeted onto this rig at runtime
    var start = function (c) { WILL.mixer = mixer; var a = mixer.clipAction(c); a.play(); var p = willPos(); g.position.set(p[0], p[1], p[2]); g.rotation.y = WILL.yaw; scene.add(g); var lab = makeLabel(D("will.name", "Will Deitrick")); lab.scale.set(1.9, 0.48, 1); lab.position.y = 2.25 / sc; g.add(lab); WILL.lab = lab; WILL.g = g; if (WILL.ph) { WILL.ph.visible = false; } WILL.state = 2; GB.n.will = "model"; };
    if (info && info.idle) { gltfLoader().load(info.idle + "?v=" + (window.BUILD || "dev"), function (c) { var cl = c.animations && c.animations[0]; if (cl) { cl.tracks = cl.tracks.filter(function (t) { return !/\.scale$/.test(t.name); }); start(cl); } else fallback(); }, undefined, fallback); return; }
    fallback();
    function fallback() { try { var src = CHAR.m && CHAR.m.clips && CHAR.m.clips.idle; if (src && CHAR.m.scene) { var rc = retargetClip(src, CHAR.m.scene, g); if (rc) { start(rc); return; } why = "bones differ"; } else why = "no char_m idle"; } catch (e) { why = e.message; }
      var emb = gl.animations && gl.animations[0]; if (emb && emb.duration > 0.5 && emb.tracks.some(function (t) { return t.times.length > 4; })) { emb.tracks.forEach(function (t) { if (/hips\.position$/i.test(t.name) && t.values.length >= 3) { var x0 = t.values[0], z0 = t.values[2]; for (var i = 0; i < t.values.length; i += 3) { t.values[i] = x0; t.values[i + 2] = z0; } } }); start(emb); return; }
      WILL.state = 3; GB.n.will = "stand-in (" + (why || "no idle") + ")"; }
  }
  // retarget a clip between two rigs with the same joint names (the math of genesis_data\v2\scripts\retarget_clip.py):
  // C_i = inv(W_dst_i) * W_src_i from the world rest orientations; R_dst_i(t) = C_parent * R_src_i(t) * inv(C_i)
  function retargetClip(clip, srcRoot, dstRoot) {
    var rest = function (root) { root.updateMatrixWorld(true); var W = {}, N = {}, P = {}; root.traverse(function (o) { if (!o.name) return; var q = new THREE.Quaternion(); o.getWorldQuaternion(q); W[o.name] = q; N[o.name] = o; P[o.name] = o.parent && o.parent.name ? o.parent.name : null; }); return { W: W, N: N, P: P }; };
    var A = rest(dstRoot), Bb = rest(srcRoot); var C = {}, n = 0, hit = 0;
    for (var name in Bb.W) { if (!Bb.N[name].isBone) continue; n++; if (A.W[name]) { C[name] = A.W[name].clone().invert().multiply(Bb.W[name]); hit++; } }
    if (!n || hit / n < 0.8) return null;
    var id = new THREE.Quaternion(), tracks = [];
    clip.tracks.forEach(function (tr) { var dot = tr.name.lastIndexOf("."); var bone = tr.name.slice(0, dot), prop = tr.name.slice(dot + 1); if (!C[bone]) return; var Cp = C[Bb.P[bone]] || id, Ci = C[bone], CiInv = Ci.clone().invert();
      if (prop === "quaternion") { var v = tr.values.slice(), q = new THREE.Quaternion(); for (var i = 0; i < v.length; i += 4) { q.set(v[i], v[i + 1], v[i + 2], v[i + 3]); q.premultiply(Cp).multiply(CiInv).normalize(); v[i] = q.x; v[i + 1] = q.y; v[i + 2] = q.z; v[i + 3] = q.w; } tracks.push(new THREE.QuaternionKeyframeTrack(tr.name, tr.times.slice(), v)); }
      else if (prop === "position" && /hips/i.test(bone)) { var rA = A.N[bone].position, rB = Bb.N[bone].position, vv = tr.values.slice(), t3 = new THREE.Vector3(); var k = rB.length() > 1e-6 ? rA.length() / rB.length() : 1; for (var j = 0; j < vv.length; j += 3) { t3.set(vv[j] - rB.x, vv[j + 1] - rB.y, vv[j + 2] - rB.z).applyQuaternion(Cp).multiplyScalar(k); vv[j] = rA.x; vv[j + 1] = rA.y + t3.y; vv[j + 2] = rA.z; } tracks.push(new THREE.VectorKeyframeTrack(tr.name, tr.times.slice(), vv)); } });
    return tracks.length ? new THREE.AnimationClip("will_idle", clip.duration, tracks) : null;
  }

  // ═════════════════════════ the gbank model as the exterior shell ═════════════════════════
  // A generated shell has no real interior, so the model stands for the outside and the procedural rooms open through
  // door mats (hall at the front, suite on the terrace). Its stair and terrace are made walkable from a downward raycast of
  // the model's top surfaces (box solids per 0.5 m cell run). If no climbable path to a terrace is found, the procedural
  // pavilion is built instead and PLAN_GBANK.mode says why.
  function analyzeModel() {
    var m = MODELS.gbank; var mg = makeModel("gbank"); var sx = m.sx || 32, sz = m.sz || 24, sh = m.height || 11;
    var k = Math.min(36 / sx, 26 / sz, 13 / sh, 1.6); if (k < 0.5) k = 0.5; mg.scale.setScalar(k);
    var cell = 0.5, hx = sx * k / 2 + 1, hz = sz * k / 2 + 1, nX0 = Math.floor(2 * hx / cell) + 1, nZ0 = Math.floor(2 * hz / cell) + 1, top = 0;
    var grid = []; for (var gi = 0; gi < nX0; gi++) { grid.push(new Array(nZ0).fill(null)); }
    var A = new THREE.Vector3(), Bv = new THREE.Vector3(), Cv = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3(), tris = 0;
    (m.parts || []).forEach(function (part) { var geo = part.geometry || part.geo; if (!geo || !geo.attributes || !geo.attributes.position) return; var pa = geo.attributes.position, ix = geo.index, nt = ix ? ix.count / 3 : pa.count / 3;
      for (var t = 0; t < nt; t++) { var i0 = ix ? ix.getX(t * 3) : t * 3, i1 = ix ? ix.getX(t * 3 + 1) : t * 3 + 1, i2 = ix ? ix.getX(t * 3 + 2) : t * 3 + 2; A.fromBufferAttribute(pa, i0).multiplyScalar(k); Bv.fromBufferAttribute(pa, i1).multiplyScalar(k); Cv.fromBufferAttribute(pa, i2).multiplyScalar(k);
        e1.subVectors(Bv, A); e2.subVectors(Cv, A); nn.crossVectors(e1, e2); var L = nn.length(); if (L < 1e-9) continue; if (Math.abs(nn.y) / L < 0.55) continue; tris++;
        var x0 = Math.min(A.x, Bv.x, Cv.x), x1 = Math.max(A.x, Bv.x, Cv.x), z0 = Math.min(A.z, Bv.z, Cv.z), z1 = Math.max(A.z, Bv.z, Cv.z); var c0 = Math.max(0, Math.ceil((x0 + hx) / cell - 1e-6)), c1 = Math.min(nX0 - 1, Math.floor((x1 + hx) / cell + 1e-6)), r0 = Math.max(0, Math.ceil((z0 + hz) / cell - 1e-6)), r1 = Math.min(nZ0 - 1, Math.floor((z1 + hz) / cell + 1e-6));
        var den = (Bv.z - Cv.z) * (A.x - Cv.x) + (Cv.x - Bv.x) * (A.z - Cv.z); if (Math.abs(den) < 1e-12) continue;
        for (var c = c0; c <= c1; c++) for (var r = r0; r <= r1; r++) { var px = -hx + c * cell, pz = -hz + r * cell; var w1 = ((Bv.z - Cv.z) * (px - Cv.x) + (Cv.x - Bv.x) * (pz - Cv.z)) / den, w2 = ((Cv.z - A.z) * (px - Cv.x) + (A.x - Cv.x) * (pz - Cv.z)) / den, w3 = 1 - w1 - w2; if (w1 < -1e-4 || w2 < -1e-4 || w3 < -1e-4) continue; var y = w1 * A.y + w2 * Bv.y + w3 * Cv.y; if (grid[c][r] === null || y > grid[c][r]) grid[c][r] = y; } } });
    for (var gx2 = 0; gx2 < nX0; gx2++) for (var gz2 = 0; gz2 < nZ0; gz2++) { var yv = grid[gx2][gz2]; if (yv !== null && yv < 0.12) grid[gx2][gz2] = null; else if (yv !== null && yv > top) top = yv; }
    if (!tris) { GB.modelWhy = "no upward faces"; return; }
    var nX = grid.length, nZ = grid[0].length, at = function (a, b) { return a < 0 || b < 0 || a >= nX || b >= nZ ? null : grid[a][b]; }, toL = function (a, b) { return [-hx + a * cell, -hz + b * cell]; };
    // the terrace: the largest flat plateau between 3 and 9 m
    var hist = {}, best = null; for (var a = 0; a < nX; a++) for (var b = 0; b < nZ; b++) { var v = grid[a][b]; if (v === null || v < 3 || v > 9) continue; var key = (Math.round(v * 5) / 5).toFixed(1); hist[key] = (hist[key] || 0) + 1; } for (var kk in hist) if (!best || hist[kk] > hist[best]) best = kk;
    if (!best || hist[best] < 40) { GB.modelWhy = "no terrace plateau"; return; } var TLm = +best;
    // a climbable path from the ground to it (rises under 0.5 m per cell)
    var seen = new Uint8Array(nX * nZ), qu = []; for (var a2 = 0; a2 < nX; a2++) for (var b2 = 0; b2 < nZ; b2++) { if (at(a2, b2) === null && (a2 === 0 || b2 === 0 || a2 === nX - 1 || b2 === nZ - 1)) { seen[a2 * nZ + b2] = 1; qu.push([a2, b2]); } }
    var reached = false; while (qu.length && !reached) { var c = qu.pop(); var h0 = at(c[0], c[1]) || 0; [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (dd) { var na = c[0] + dd[0], nb = c[1] + dd[1]; if (na < 0 || nb < 0 || na >= nX || nb >= nZ || seen[na * nZ + nb]) return; var nv = at(na, nb) || 0; if (Math.abs(nv - h0) > 0.5) return; seen[na * nZ + nb] = 1; if (Math.abs(nv - TLm) < 0.25) reached = true; qu.push([na, nb]); }); }
    if (!reached) { GB.modelWhy = "no climbable stair to the terrace"; return; }
    // the hall mat: on the axis in front of the facade (the first cell from the front that rises over 1 m)
    var ax = Math.round(hx / cell), fz = null; for (var b3 = nZ - 1; b3 >= 0; b3--) { var v3 = at(ax, b3); if (v3 !== null && v3 > 1.0) { fz = toL(ax, b3)[1]; break; } } if (fz === null) { GB.modelWhy = "no facade on the axis"; return; }
    var hallMat = [0, fz + 1.3];
    // the suite mat: the front-most terrace cell against the upper volume, nearest the axis
    var cand = null; for (var a4 = 0; a4 < nX; a4++) for (var b4 = 0; b4 < nZ; b4++) { var v4 = at(a4, b4); if (v4 === null || Math.abs(v4 - TLm) > 0.2) continue; var up = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(function (dd) { var q = at(a4 + dd[0], b4 + dd[1]); return q !== null && q > TLm + 1.5; }); if (!up) continue; var L = toL(a4, b4); var score = L[1] - 0.5 * Math.abs(L[0]); if (!cand || score > cand.s) cand = { s: score, l: L }; }
    if (!cand) { GB.modelWhy = "no door wall on the terrace"; return; }
    var suiteMat = [cand.l[0], cand.l[1] + 0.6], suiteOut = [cand.l[0], cand.l[1] + 2.0]; var so = at(Math.round((suiteOut[0] + hx) / cell), Math.round((suiteOut[1] + hz) / cell)); if (so === null || Math.abs(so - TLm) > 0.3) suiteOut = suiteMat.slice();
    GB.model = { k: k, TL: TLm, top: top, grid: grid, nX: nX, nZ: nZ, cell: cell, hx: hx, hz: hz, hallMat: hallMat, suiteMat: suiteMat, suiteOut: suiteOut, mesh: mg }; GB.modelOK = true;
  }
  function buildModelShell() { var Mo = GB.model; if (!Mo) return; var grid = Mo.grid, nX = Mo.nX, nZ = Mo.nZ, cell = Mo.cell, hx = Mo.hx, hz = Mo.hz;
    // solids: every run of cells along x with the same top (to 5 cm) becomes one box from below the ground to that top
    GB.modelSolids = []; for (var b5 = 0; b5 < nZ; b5++) { var a5 = 0; while (a5 < nX) { var v5 = grid[a5][b5]; if (v5 === null) { a5++; continue; } var e5 = a5; while (e5 + 1 < nX && grid[e5 + 1][b5] !== null && Math.abs(grid[e5 + 1][b5] - v5) < 0.05) e5++; var sd = SOL(-hx + a5 * cell - cell / 2, -hx + e5 * cell + cell / 2, -hz + b5 * cell - cell / 2, -hz + b5 * cell + cell / 2, -1, v5); if (sd) GB.modelSolids.push(sd); a5 = e5 + 1; } }
    G.ex.add(Mo.mesh); Mo.solids = GB.modelSolids.length;
  }
  // is a planting or furniture spot on the model's footprint, or in front of its low steps?
  function modelBlocks(lx, lz) { var Mo = GB.model; if (!Mo) return false; for (var dx = -2; dx <= 2; dx += 0.5) for (var dz = -2; dz <= 2; dz += 0.5) { var h = modelH(lx + dx, lz + dz); if (h === null) continue; if (Math.abs(dx) <= 1.5 && Math.abs(dz) <= 1.5) return true; if (h < 1.2) return true; } return false; }
  function clearModelSolids() { (GB.modelSolids || []).forEach(function (sd) { var i = SOLIDS.indexOf(sd); if (i >= 0) SOLIDS.splice(i, 1); }); }
  function modelH(lx, lz) { var Mo = GB.model; if (!Mo) return null; var a = Math.round((lx + Mo.hx) / Mo.cell), b = Math.round((lz + Mo.hz) / Mo.cell); if (a < 0 || b < 0 || a >= Mo.nX || b >= Mo.nZ) return null; return Mo.grid[a][b]; }
  // door mats (model shell only): step on one to go in; walk out through the room's door to come back out
  function buildMats() { var Mo = GB.model, M = mats(); var mk = function (l, y) { var gm = new THREE.Group(); BX(gm, -1.1, 1.1, 0, 0.02, -0.7, 0.7, M.rugDeep, 1); [[-1.12, 1.12, -0.72, -0.66], [-1.12, 1.12, 0.66, 0.72], [-1.12, -1.06, -0.72, 0.72], [1.06, 1.12, -0.72, 0.72]].forEach(function (q) { BX(gm, q[0], q[1], 0, 0.025, q[2], q[3], M.brass, 1); }); gm.position.set(l[0], y + 0.01, l[1]); G.court.add(gm); return gm; };
    var yh = modelH(Mo.hallMat[0], Mo.hallMat[1]) || 0; mk(Mo.hallMat, yh); mk(Mo.suiteMat, Mo.TL); Mo.hallY = yh;
    var w1 = L2W(Mo.hallMat[0], Mo.hallMat[1]); GB.entryHs.gb.x = w1[0]; GB.entryHs.gb.z = w1[1]; GB.entryHs.gb.lvl = 0; GB.entryHs.r = 2.6; var w2 = L2W(Mo.suiteMat[0], Mo.suiteMat[1]); GB.terrHs.gb.x = w2[0]; GB.terrHs.gb.z = w2[1]; GB.stairHs.gb.lvl = -1; }
  function enterRoom(which) { var Mo = GB.model; if (!Mo || GB.inRoom) return; try { fade(); } catch (e) {} if (!GB.modelSolidsSaved) GB.modelSolidsSaved = GB.modelSolids.slice(); clearModelSolids(); (GB.roomSolids || []).forEach(function (sd) { if (SOLIDS.indexOf(sd) < 0) SOLIDS.push(sd); }); GB.inRoom = which; roomVis(true);
    var l = which === "hall" ? [0, 8.6] : [0, 0.6], y = which === "hall" ? K.hy0 : K.TL; var w = L2W(l[0], l[1]); player.position.set(w[0], S.B + y + 0.02, w[1]); player.rotation.y = S.yaw + Math.PI; yaw = S.yaw; airborne = false; vy = 0; try { lastSent.at = 0; pushMove(true); sfx("ui"); } catch (e) {} }
  function exitRoom(silent) { var Mo = GB.model; if (!GB.inRoom) return; var which = GB.inRoom; if (!silent) { try { fade(); } catch (e) {} } (GB.roomSolids || []).forEach(function (sd) { var i = SOLIDS.indexOf(sd); if (i >= 0) SOLIDS.splice(i, 1); }); (GB.modelSolidsSaved || []).forEach(function (sd) { if (SOLIDS.indexOf(sd) < 0) SOLIDS.push(sd); }); GB.inRoom = null; roomVis(false); GB.leftAt = performance.now();
    if (!silent) { var l = which === "hall" ? [Mo.hallMat[0], Mo.hallMat[1] + 1.6] : Mo.suiteOut; var w = L2W(l[0], l[1]); var y = which === "hall" ? (modelH(l[0], l[1]) || 0) : Mo.TL; player.position.set(w[0], Math.max(getH(w[0], w[1]), S.B + y) + 0.02, w[1]); player.rotation.y = S.yaw; yaw = S.yaw + Math.PI; airborne = false; vy = 0; try { lastSent.at = 0; pushMove(true); sfx("ui"); } catch (e) {} } }
  function roomVis(on) { ["rs", "hall", "suite", "dyn"].forEach(function (k) { if (G[k]) G[k].visible = on; }); G.ex.visible = !on; GB.forceVis = true; }
  function modelTick(now, pl, lp, rel) { var Mo = GB.model; if (!Mo) return;
    if (!GB.inRoom) { if (riding || cartMode || (GB.leftAt && performance.now() - GB.leftAt < 1500)) return; var dh = Math.hypot(lp[0] - Mo.hallMat[0], lp[1] - Mo.hallMat[1]); if (dh < 1.0 && Math.abs(rel - (Mo.hallY || 0)) < 0.8) { enterRoom("hall"); return; } var ds = Math.hypot(lp[0] - Mo.suiteMat[0], lp[1] - Mo.suiteMat[1]); if (ds < 1.0 && Math.abs(rel - Mo.TL) < 0.8) enterRoom("suite"); return; }
    var far = Math.abs(lp[0]) > 40 || Math.abs(lp[1]) > 40; if (far) { exitRoom(true); return; }
    if (GB.inRoom === "hall" && lp[1] > K.hall[3] + 0.35) exitRoom(); else if (GB.inRoom === "suite" && lp[1] > K.suite[3] + 0.45) exitRoom(); }

  // ═════════════════════════ frame ═════════════════════════
  var lastF = -1, pulseT = 0;
  function frameHook(dt, now) {
    if (DATA && !GB.texts) { try { buildTexts(); } catch (e) { GB.texts = true; note("texts", e); } }
    if (DATA && !GB.hsFilled) fillHotspots();
    var cam = camera.position, dc = Math.hypot(cam.x - S.cx, cam.z - S.cz);
    if ((FRAME_N !== lastF && FRAME_N % 8 === 0) || GB.forceVis) { lastF = FRAME_N; GB.forceVis = false; var mm = GB.mode === "model"; var pz = GB.zoneNow; for (var k in G) { var vis = dc < G[k].userData.far; if (!mm && pz === 2 && (k === "suite" || k === "up")) vis = false; if (!mm && (pz === 1 || pz === 3) && (k === "hall" || k === "dyn")) vis = false; if (mm && (k === "rs" || k === "hall" || k === "suite" || k === "dyn")) vis = !!GB.inRoom; if (mm && k === "ex") vis = vis && !GB.inRoom; if (G[k].visible !== vis) G[k].visible = vis; } }
    var nt = typeof night === "number" ? night : 0, glow = Math.max(0, nt - 0.12) / 0.88; var M = MT;
    if (M) { setE(M.floor, 0.3 * glow); setE(M.oak, 0.22 * glow); setE(M.floorWood, 0.26 * glow); setE(M.plaster, 0.18 * glow); setE(M.ledWarm, 0.12 + 1.8 * glow); setE(M.shade, 0.35 + 0.9 * glow); if (GB.letterMat) setE(GB.letterMat, 0.04 + 2.4 * glow); if (GB.washMat) { var wo = 0.85 * glow; if (Math.abs(GB.washMat.opacity - wo) > 0.01) GB.washMat.opacity = wo; GB.washMat.visible = wo > 0.02; } if (GB.monMat) setE(GB.monMat, 0.05 + 0.9 * glow); }
    for (var i = 0; i < GB.lights.length; i++) { var L = GB.lights[i]; var want = L.kind === "terrace" ? L.base * glow : L.base * (0.75 + 0.25 * glow); if (Math.abs(L.l.intensity / 1.7 - want) > 0.01) L.l.intensity = want; }
    var pl = player ? player.position : null; if (!pl) return; var lp = W2L(pl.x, pl.z), rel = pl.y - S.B; var inFoot = Math.abs(lp[0]) < 17.2 && lp[1] > -12.2 && lp[1] < 12.2; var upper = inFoot && rel > K.TL - 1.2;
    var zone = upper ? (lp[0] > K.suite[0] && lp[0] < K.suite[1] && lp[1] > K.suite[2] && lp[1] < K.suite[3] ? 3 : 1) : (Math.abs(lp[0]) < 16 && Math.abs(lp[1]) < 11 && rel < K.TL - 1.2 ? 2 : 0); if (GB.mode === "model") { modelTick(now, pl, lp, rel); zone = GB.inRoom === "hall" ? 2 : GB.inRoom === "suite" ? 3 : rel > GB.model.TL - 1.2 && Math.abs(lp[0]) < GB.model.hx && Math.abs(lp[1]) < GB.model.hz ? 1 : 0; upper = zone === 3 || zone === 1; } GB.upper = upper; GB.zoneNow = zone;
    // level-aware hotspots and seats (the hall and the suite share a footprint)
    if (FRAME_N % 4 === 0) { for (var h = 0; h < GB.hs.length; h++) { var hs = GB.hs[h], lv = hs.gb.lvl, on = GB.mode === "model" ? lv === zone : (upper ? lv === 1 || lv === 3 : lv === 0 || lv === 2); var tx = on ? hs.gb.x : 1e7; if (hs.gb.key === "will") { if (on) { var wp2 = willPos(); hs.x = wp2[0]; hs.z = wp2[2]; } else hs.x = 1e7; } else if (hs.x !== tx) { hs.x = tx; hs.z = on ? hs.gb.z : 1e7; } }
      for (var s = 0; s < GB.seats.length; s++) { var sd = GB.seats[s]; sd.seat = sd.gbLvl === (upper ? 1 : 0) && (GB.mode !== "model" || !!GB.inRoom || sd.gbLvl === 0); } }
    // the talk footer (the no-offer line under every Will and Paul card)
    footer();
    if (WILL.ph && !WILL.g) { var wv = dc < 150 && (GB.mode !== "model" || !!GB.inRoom); if (WILL.ph.visible !== wv) WILL.ph.visible = wv; }
    if (dc > 160) return;
    // the ledger scrolls up a row every 2.4 s; the band flashes as each row lands; the live dot blinks
    if (HALL.rows) { var rowT = now / 1000 / 2.4; var rows = HALL.rowsN; HALL.rows.offset.y = (1 - 10 / rows) - ((rowT % rows) / rows); if (HALL.band) HALL.band.material.opacity = 0.05 + 0.16 * Math.pow(1 - (rowT % 1), 3); if (HALL.dot) HALL.dot.visible = (now % 1400) < 900; }
    // pulses along the capital flow, station 1 to 5, easing through each node
    if (HALL.pulses && HALL.path && HALL.path.length > 1) { pulseT += dt; var P = HALL.path, n = HALL.pulses.n, a = HALL.pulses.a, segs = P.length - 1; for (var j = 0; j < n; j++) { var u = ((pulseT * 0.16 + j / n) % 1) * segs; var si = Math.floor(u), f = u - si; f = f * f * (3 - 2 * f); var A = P[si], Bq = P[Math.min(segs, si + 1)]; a[j * 3] = A[0] + (Bq[0] - A[0]) * f; a[j * 3 + 1] = A[1] + Math.sin(f * Math.PI) * 0.06; a[j * 3 + 2] = A[2]; } HALL.pulses.pts.geometry.attributes.position.needsUpdate = true;
      for (var q = 0; q < HALL.nodes.length; q += 2) { var nd = HALL.nodes[q]; var ph = (pulseT * 0.16 * segs - q / 2) % segs; nd.material.emissiveIntensity = 1.0 + 1.2 * Math.max(0, 1 - Math.abs(ph < 0 ? ph + segs : ph) * 2.2); } }
    if (GB.fire) setE(GB.fire.material, 1.8 + 0.5 * Math.sin(now / 90) + 0.3 * Math.sin(now / 37));
    try { willTick(Math.min(dt, 0.1), now, pl, upper); } catch (e) { if (!GB.wErr) { GB.wErr = 1; note("will", e); } }
  }
  function setE(m, v) { if (m && Math.abs(m.emissiveIntensity - v) > 0.004) m.emissiveIntensity = v; }
  var FOOT = null;
  function footer() { var tn = typeof talkNpc !== "undefined" ? talkNpc : null; var want = !!(tn && (tn.id === "will" || tn.id === "paul" || tn.legal)); if (!FOOT) { if (!want) return; var box = document.getElementById("talk"); if (!box) return; FOOT = document.createElement("div"); FOOT.className = "mono"; FOOT.style.cssText = "margin-top:12px;padding-top:9px;border-top:1px solid rgba(77,222,111,.25);font-size:11px;letter-spacing:.06em;color:rgba(245,241,230,.62);user-select:text"; box.appendChild(FOOT); } if (want) FOOT.textContent = D("legal", "Nothing here is an offer to sell securities or investment advice."); var d = want ? "" : "none"; if (FOOT.style.display !== d) FOOT.style.display = d; }

  // ═════════════════════════ camera: kept inside the rooms, pulled in before the walls ═════════════════════════
  var ROOMS = null, _v = new THREE.Vector3();
  function rooms() { if (ROOMS) return ROOMS; var Hh = K.hall, U = K.suite; ROOMS = { hall: { x0: Hh[0] + 0.35, x1: Hh[1] - 0.35, z0: Hh[2] + 0.35, z1: Hh[3] - 0.25, y0: K.hy0, y1: K.hy1 - 0.45 }, suite: { x0: U[0] + 0.55, x1: U[1] - 0.45, z0: U[2] + 0.55, z1: U[3] - 0.25, y0: K.TL, y1: K.uy1 - 0.3 } }; return ROOMS; }
  // outside the rooms the camera may not enter these volumes (local boxes, y above the pad)
  var BLOCK = null;
  function blockers() { if (BLOCK) return BLOCK; var s = K.stair; BLOCK = [[-16.4, 16.4, -11.4, 11.4, -1, K.TL + 0.1], [K.suite[0] - 0.25, K.suite[1] + 0.25, K.suite[2] - 0.25, K.suite[3] + 0.25, K.TL, K.ry1 + 0.3], [K.roof[0] - 0.2, K.roof[1] + 0.2, K.roof[2], K.roof[3] + 0.2, K.uy1 - 0.3, K.ry1 + 0.3], [-17.2, 17.2, -12.2, 12.9, -1, K.podTop], [s.x0 - 0.1, s.x1 + 0.1, s.zTop, STAIR_FOOT + 0.3, -1, 1]]; return BLOCK; }
  function stairTopAt(lz) { if (lz >= STAIR_FOOT) return 0; var s = K.stair; for (var k = 1; k < s.n; k++) { var z = stepZ(k); if (lz >= z[0] && lz <= z[1]) return k * RISE; } return K.TL; }
  function blocked(x, y, z) { var l = W2L(x, z), ry = y - S.B; if (GB.mode === "model" && !GB.inRoom) { var mh = modelH(l[0], l[1]); return mh !== null && ry < mh + 0.35; } var b = blockers(); for (var i = 0; i < b.length; i++) { var q = b[i]; if (l[0] > q[0] && l[0] < q[1] && l[1] > q[2] && l[1] < q[3] && ry > q[4] && ry < q[5]) return true; } var s = K.stair; if (l[0] > s.x0 - 0.1 && l[0] < s.x1 + 0.1 && l[1] > s.zTop && l[1] < STAIR_FOOT + 0.3 && ry < stairTopAt(l[1]) + 1.2) return true; return false; }
  function inRoom(R, x, y, z) { var l = W2L(x, z), ry = y - S.B; return l[0] > R.x0 && l[0] < R.x1 && l[1] > R.z0 && l[1] < R.z1 && ry > R.y0 - 0.2 && ry < R.y1; }
  function camHook(dt) {
    if (!player || typeof FLY === "undefined" || window.__cam) return false; if (FLY.on || riding || golf.playing || inside || towerView || FPV) { camRelease(); return false; } try { if (document.getElementById("creator").classList.contains("on")) return false; } catch (e) {}
    var px = player.position.x, pz = player.position.z, py = player.position.y; if (Math.abs(px - S.cx) > 70 || Math.abs(pz - S.cz) > 70) { camRelease(); return false; }
    var by = py - (typeof bobY === "number" ? bobY : 0); var fwd = [-Math.sin(yaw), -Math.cos(yaw)]; var R = rooms(); var room = null, l = W2L(px, pz), rel = py - S.B;
    var realRooms = GB.mode !== "model" || !!GB.inRoom; if (realRooms && Math.abs(l[0]) < 16 && Math.abs(l[1]) < 11 && rel < K.TL - 1) room = R.hall; else if (realRooms && l[0] > K.suite[0] && l[0] < K.suite[1] && l[1] > K.suite[2] && l[1] < K.suite[3] && rel > K.TL - 0.5 && rel < K.uy1) room = R.suite;
    if (room) {
      var dist = 0; for (var d = 0; d <= 3.6; d += 0.2) { if (!inRoom(room, px - fwd[0] * d, by + 1.8, pz - fwd[1] * d)) break; dist = d; }
      if (GB.fp === undefined) GB.fp = dist < 1.3; else if (GB.fp && dist > 2.1) GB.fp = false; else if (!GB.fp && dist < 1.1) GB.fp = true;
      CAM.dist += (dist - CAM.dist) * smoothK(dt, 10); var sd = Math.min(dist, CAM.dist); GB.camOn = true;
      if (GB.fp) { camera.position.set(px, by + 1.62, pz); CAM.init = false; camera.lookAt(px + fwd[0] * 10, by + 1.62 - pitch * 6, pz + fwd[1] * 10); player.userData.walk.visible = false; GB.hid = true; }
      else { var cy = Math.min(S.B + room.y1 - 0.15, by + 1.9 + pitch * 1.2); camera.position.lerp(_v.set(px - fwd[0] * sd, cy, pz - fwd[1] * sd), smoothK(dt, 24)); camLook(px, by + 1.3, pz, dt, 30); if (GB.hid) { player.userData.walk.visible = true; GB.hid = false; } }
      return true;
    }
    GB.fp = undefined; if (GB.hid) { player.userData.walk.visible = true; GB.hid = false; }
    // outside: march the default follow camera back and stop short of the building volumes
    var want = cartMode ? 12 : 9.5, h = (cartMode ? 4.2 : 3.2) + pitch * 4, cp = Math.cos(pitch); var lim = want;
    for (var d2 = 0.6; d2 <= want; d2 += 0.3) { var cx = px - fwd[0] * d2 * cp, cz = pz - fwd[1] * d2 * cp, cy2 = by + h * (d2 / 9.5) + 1.2; if (blocked(cx, cy2, cz)) { lim = Math.max(1.4, d2 - 0.6); break; } }
    if (lim >= want - 0.01 && !GB.camOn) return false;
    if (lim >= want - 0.01 && Math.abs(CAM.dist - want) < 0.3) { GB.camOn = false; return false; }
    GB.camOn = true; CAM.dist += (lim - CAM.dist) * smoothK(dt, lim < CAM.dist ? 14 : 5); var sd2 = CAM.dist;
    var cx3 = px - fwd[0] * sd2 * cp, cz3 = pz - fwd[1] * sd2 * cp; var cy3 = Math.max(getH(cx3, cz3) + roadLiftAt(cx3, cz3) + 1.2, by + h * (sd2 / 9.5) + 1.2); camera.position.lerp(_v.set(cx3, cy3, cz3), smoothK(dt, cartMode ? 12 : 16)); camLook(px, by + 1.6, pz, dt, 26);
    return true;
  }
  function camRelease() { if (GB.hid) { try { player.userData.walk.visible = true; } catch (e) {} GB.hid = false; } GB.fp = undefined; GB.camOn = false; }

  // debug and test helpers (not used by the game)
  GB.debug = { L2W: function (x, z) { site(); return L2W(x, z); }, W2L: function (x, z) { site(); return W2L(x, z); }, K: K, stepZ: stepZ, G: G, WILL: WILL, HALL: HALL, retarget: retargetClip,
    go: function (where) { site(); var spots = { court: [0, 27, 0, 0], hall: [0, 6, 0, 0], ledger: [0, -5, 0, 0], stair: [-14, STAIR_FOOT + 1.5, 0, 0], terrace: [-5, 8.5, K.TL, Math.PI], suite: [0, -1, K.TL, 0], will: [-2.4, -3.6, K.TL, 0] }; var s = spots[where] || spots.court; var w = L2W(s[0], s[1]); try { if (inside) leaveInterior(); } catch (e) {} player.position.set(w[0], S.B + s[2] + (s[2] > 0 ? 0.02 : 0), w[1]); if (s[2] === 0) player.position.y = surfaceAt(w[0], w[1], getH(w[0], w[1]) + (where === "court" || where === "stair" ? 0.1 : 1.0)); yaw = S.yaw + s[3]; player.rotation.y = yaw + Math.PI; return [+w[0].toFixed(1), +w[1].toFixed(1), +player.position.y.toFixed(2)]; } };
})();
