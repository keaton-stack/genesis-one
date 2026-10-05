// R14 HOMES (4 Oct 2026): the villa, ranch, lakehouse and glamp interiors, the homes players will one day own. Registered through
// PLAN_ROOMS (plan_rooms.js): each style replaces client.js's generic box room (walls, floor, ceiling and the few boxes of
// furnishHome / furnishVariant) with a bespoke open-plan home:
//   - villa      desert-modern luxury: travertine, plaster, a stacked sandstone fireplace wall, walnut slat ceiling, steel glazing
//   - ranch      Western ranch house: timber walls, heavy beams, a fieldstone fireplace, a leather sofa, a cowhide rug
//   - lakehouse  a warm lodge great room: log walls, a river rock chimney, timber trusses and a sleeping loft up a timber stair
//   - glamp      the round bell tent its model shows: a canvas ring on poles, a cone roof to the centre pole, a wood stove, string lights
// Every home has a living area (sofas, coffee table, rug, fireplace or stove), a kitchen (island or counter, stools, a range,
// pendants, stocked shelves), dining, a bedroom nook or loft and a reading corner, and windows framing the desert (painted vistas
// behind real glass). Homes vary by their plan.json building: colourways, mirrored layouts, two layouts and three furniture sets
// per style, decor picked per home, so no two neighbours match. Seats are real seats (the client's sit system), furniture blocks
// walking, and E does things (the fire, the lights, coffee, a book, the house card, the dog).
// Rules kept (BRIEF_R14_INTERIORS.md): no new lights (the room's one lamp and fill are tuned), shared materials and textures with
// stable keys built at idle, all furniture merged into one mesh per material, nothing per frame but a few uniforms.
// Classic script, loaded before client.js. Copy and tuning: plan/rooms_homes.json. ?homes=0 turns this module off (?rooms=0 turns
// every PLAN_ROOMS builder off). window.PLAN_RH: n (counters), errs, cfg, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var RH = window.PLAN_RH = window.PLAN_RH || {};
  RH.ver = "r14h-1"; RH.errs = RH.errs || []; RH.n = RH.n || { built: 0, ms: [], tri: 0, draws: 0, solids: 0, seats: 0 };
  if (/[?&]homes=0\b/.test(location.search)) { RH.off = true; return; }
  var PI = Math.PI, TAU = PI * 2, HP = PI / 2;
  function note(tag, e) { try { if (RH.errs.length < 50) RH.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (RH.errs.length <= 6) console.warn("plan_rooms_homes " + tag, e); } catch (x) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hashStr(s) { var h = 2166136261; s = String(s || ""); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function nowMs() { return performance.now(); }
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function $id(id) { return document.getElementById(id); }
  function au(u) { try { if (window.AV) return window.AV(u); } catch (e) {} return u; }
  function lowTier() { try { return ASSET.tier === "m"; } catch (e) { return false; } }
  function pick(R, a) { return a[Math.floor(R() * a.length) % a.length]; }

  // ───────────────────────── config: plan/rooms_homes.json (copy, titles, lines, stamps); defaults keep the module whole without it ─────────────────────────
  var DEF = {
    styles: {
      villa: { title: "Desert-modern villa", tag: "Open plan under a walnut slat ceiling, a sandstone fire wall and the desert through steel glass." },
      ranch: { title: "Ranch house", tag: "Timber and stone, a leather sofa by a fieldstone fire, a cowhide rug and a long farmhouse table." },
      lakehouse: { title: "Lodge great room", tag: "Log walls, a river rock chimney to the trusses and a sleeping loft up the timber stair." },
      glamp: { title: "Canvas bell tent", tag: "A ring of poles under a cone of canvas, a wood stove, string lights down the spokes and a bed piled with quilts." }
    },
    card: { k: "A home in Genesis One", p: "Homes like this one will belong to residents of Genesis One. Details revealing soon.", foot: "Walk around: E lights the fire, dims the lamps, brews coffee and pulls a book." },
    books: ["Field Notes from the Sky Islands", "The Long Trail North", "Adobe and Light", "A Year of Desert Gardens", "Night Skies over Cochise County", "The Cowhand's Cookbook", "Stories from the First Airfield", "Stone, Timber and Sun", "The Quiet Mesa", "Birds of the Chiricahuas"],
    bookLines: ["A well-thumbed copy, a pressed ocotillo flower marking a page.", "Someone has underlined half of chapter three.", "The spine is cracked at the good part.", "A note inside the cover: for long evenings by the fire."],
    coffee: ["Fresh coffee. The whole house smells of it.", "A pour-over, slow and strong.", "Coffee in a heavy mug, the way it should be."],
    dogs: ["Biscuit", "Juniper", "Scout", "Mesa", "Rusty", "Pepper"],
    dogLines: ["{dog} thumps a tail on the floor and sighs.", "{dog} rolls over for a belly rub.", "{dog} opens one eye, then goes back to sleep."],
    prompts: { fireOn: "light the fire", fireOff: "let the fire burn down", stoveOn: "light the stove", stoveOff: "let the stove go out", lights: "dim the lamps", lightsUp: "bring the lamps up", coffee: "brew a coffee", book: "pick a book", card: "read the house card", dog: "pet {dog}", record: "put a record on", recordOff: "lift the needle", pool: "rack up a frame" },
    records: ["A slow country record crackles into the room.", "A worn jazz record turns, low and warm.", "Desert folk, a guitar and a harmonica."],
    pool: ["You sink the eight ball. Nobody saw it, so it counts.", "A clean break. Three stripes drop.", "The cue ball kisses the nine and stops dead."],
    stamps: { villa: "p_home_villa", ranch: "p_home_ranch", lakehouse: "p_home_lodge", glamp: "p_home_glamp", all: "p_open_house" }
  };
  var CFG = RH.cfg || null;
  function cfgUrl() { return au("/plan/rooms_homes.json?v=" + (window.BUILD || "dev")); }
  if (!CFG) { try { fetch(cfgUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && typeof d === "object") CFG = RH.cfg = d; }).catch(function (e) { note("cfg", e); }); } catch (e) { note("cfg", e); } }
  function C(path, dflt) { var p = path.split("."), o = CFG, d = DEF; for (var i = 0; i < p.length; i++) { o = o == null ? undefined : o[p[i]]; d = d == null ? undefined : d[p[i]]; } return o !== undefined ? o : d !== undefined ? d : dflt; }

  // ───────────────────────── atlas rects (written by mkassets.py; [u0, v0, u1, v1]) ─────────────────────────
  var AT = {"art": {"abstract_bands": [0.0, 0.62305, 0.5, 1.0], "horses": [0.5, 0.62305, 1.0, 1.0], "pines": [0.0, 0.24609, 0.5, 0.62305], "sun_dunes": [0.5, 0.29102, 0.75, 0.62305], "cowboy": [0.75, 0.29102, 1.0, 0.62305], "map": [0.0, 0.0, 0.32812, 0.24609], "botanical0": [0.32812, 0.0, 0.49219, 0.24609], "botanical1": [0.49219, 0.0, 0.65625, 0.24609], "botanical2": [0.65625, 0.0, 0.82031, 0.24609], "photo_ridge": [0.82031, 0.0, 1.0, 0.24609]}, "stock": {"books": [0.0, 0.5, 0.5, 1.0], "kitchen": [0.5, 0.5, 1.0, 1.0], "pantry": [0.0, 0.0, 0.5, 0.5], "fire": [0.5, 0.12305, 1.0, 0.5], "white": [0.51758, 0.02734, 0.5957, 0.10547], "spines": [0.61523, 0.03711, 0.99609, 0.11523], "black": [0.62012, 0.00879, 0.99121, 0.02832]}, "rug": {"navajo": [0.0, 0.6665, 0.5, 1.0], "beni": [0.5, 0.6665, 1.0, 1.0], "persian": [0.0, 0.33301, 0.5, 0.6665], "abstract": [0.5, 0.33301, 1.0, 0.6665], "quilt": [0.0, 0.0, 0.5, 0.33301], "plaid": [0.5, 0.0, 1.0, 0.33301]}, "leaf": {"fig": [0.00195, 0.66699, 0.24805, 0.93213], "olive": [0.25195, 0.66699, 0.49805, 0.91846], "monstera": [0.50195, 0.66699, 0.74805, 0.91406], "paradise": [0.75195, 0.66699, 0.99805, 0.99268], "pampas": [0.021, 0.33398, 0.22852, 0.66309], "pothos": [0.30811, 0.33398, 0.44189, 0.66309], "eucalyptus": [0.50195, 0.33398, 0.74805, 0.62695], "snake": [0.77832, 0.33398, 0.97119, 0.66309], "cowhide": [0.00195, 0.02832, 0.24805, 0.30664], "macrame": [0.27979, 0.00293, 0.47021, 0.33203]}};
  var LEAF_ASP = {"fig": 0.9282, "olive": 0.9786, "monstera": 0.996, "paradise": 0.7556, "pampas": 0.6306, "pothos": 0.4065, "eucalyptus": 0.84, "snake": 0.5861, "cowhide": 0.8842, "macrame": 0.5786};
  var WHITE = [(AT.stock.white[0] + AT.stock.white[2]) / 2, (AT.stock.white[1] + AT.stock.white[3]) / 2];   // a constant uv: the plain glow

  // ───────────────────────── colours (sRGB hex -> linear THREE.Color, cached) ─────────────────────────
  var COLS = {};
  // the game runs with colour management off: palette hexes are sRGB, so they are linearised here to sit right against the sRGB textures
  function col(h) { if (h && h.isColor) return h; var c = COLS[h]; if (!c) { c = COLS[h] = new THREE.Color(h); try { if (!THREE.ColorManagement.enabled) c.convertSRGBToLinear(); } catch (e) {} } return c; }
  function shade(h, k) { var c = col(h); return new THREE.Color(c.r * k, c.g * k, c.b * k); }

  // ───────────────────────── textures: drawn ones (grain, weave, plaster, glow) and the generated rh_* set; built and loaded at idle ─────────────────────────
  var TX = RH.tx = RH.tx || {};
  function keep(o) { if (o) { o.userData = o.userData || {}; o.userData.avShared = true; } return o; }
  function canvasTex(w, h, draw, rep) { var c = document.createElement("canvas"); c.width = w; c.height = h; var x = c.getContext("2d"); draw(x, w, h); var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } t.needsUpdate = true; return keep(t); }
  function noiseFill(x, w, h, base, amp, n, R, sz) { x.fillStyle = base; x.fillRect(0, 0, w, h); for (var i = 0; i < n; i++) { var v = (R() - 0.5) * amp; x.fillStyle = v > 0 ? "rgba(255,255,255," + v + ")" : "rgba(0,0,0," + (-v) + ")"; var s = (sz || 2) * (0.5 + R()); x.fillRect(R() * w, R() * h, s, s); } }
  function drawGrain(x, w, h) { var R = rng(11); x.fillStyle = "#d9c3a3"; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 160; i++) { var y = R() * h, a = 0.04 + R() * 0.12, th = 0.6 + R() * 2.4; x.strokeStyle = R() < 0.5 ? "rgba(90,58,30," + a + ")" : "rgba(255,240,215," + a * 0.7 + ")"; x.lineWidth = th; x.beginPath(); for (var X = 0; X <= w; X += 16) { var yy = y + Math.sin(X / w * TAU * (1 + (i % 3)) + i) * (2 + R() * 3); if (X === 0) x.moveTo(X, yy); else x.lineTo(X, yy); } x.stroke();
      if (i % 2) { x.beginPath(); x.moveTo(0, y + h); for (var X2 = 0; X2 <= w; X2 += 16) x.lineTo(X2, y + h + Math.sin(X2 / w * TAU + i) * 3); x.stroke(); } }
    for (var k = 0; k < 3; k++) { var kx = R() * w, ky = R() * h; x.save(); x.translate(kx, ky); x.scale(3.2, 0.7); var gr = x.createRadialGradient(0, 0, 0, 0, 0, 9); gr.addColorStop(0, "rgba(90,56,28,0.22)"); gr.addColorStop(1, "rgba(90,56,28,0)"); x.fillStyle = gr; x.fillRect(-10, -10, 20, 20); x.restore(); } }
  function drawWeave(x, w, h) { var R = rng(5); x.fillStyle = "#ece6dc"; x.fillRect(0, 0, w, h); for (var y = 0; y < h; y += 2) { x.fillStyle = "rgba(0,0,0," + (0.02 + R() * 0.05) + ")"; x.fillRect(0, y, w, 1); } for (var X = 0; X < w; X += 2) { x.fillStyle = "rgba(255,255,255," + (0.02 + R() * 0.06) + ")"; x.fillRect(X, 0, 1, h); } noiseFill2(x, w, h, R, 2600, 0.08); }
  function noiseFill2(x, w, h, R, n, amp) { for (var i = 0; i < n; i++) { var v = (R() - 0.5) * amp; x.fillStyle = v > 0 ? "rgba(255,255,255," + v + ")" : "rgba(0,0,0," + (-v) + ")"; x.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 2); } }
  function drawPlaster(x, w, h) { var R = rng(7); x.fillStyle = "#f2ece2"; x.fillRect(0, 0, w, h); for (var i = 0; i < 900; i++) { var r = 6 + R() * 40, px = R() * w, py = R() * h, a = R() * 0.035; var g = x.createRadialGradient(px, py, 0, px, py, r); var c = R() < 0.5 ? "190,170,140" : "255,252,245"; g.addColorStop(0, "rgba(" + c + "," + a + ")"); g.addColorStop(1, "rgba(" + c + ",0)"); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); } noiseFill2(x, w, h, R, 4000, 0.04); }
  function drawLeather(x, w, h) { var R = rng(9); x.fillStyle = "#c9a284"; x.fillRect(0, 0, w, h); for (var i = 0; i < 1400; i++) { var r = 2 + R() * 9, px = R() * w, py = R() * h, a = R() * 0.08; var g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, "rgba(60,30,12," + a + ")"); g.addColorStop(1, "rgba(60,30,12,0)"); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); } for (var k = 0; k < 220; k++) { x.strokeStyle = "rgba(255,235,210," + (0.03 + R() * 0.06) + ")"; x.lineWidth = 1; x.beginPath(); var sx = R() * w, sy = R() * h; x.moveTo(sx, sy); x.quadraticCurveTo(sx + (R() - 0.5) * 30, sy + (R() - 0.5) * 30, sx + (R() - 0.5) * 50, sy + (R() - 0.5) * 50); x.stroke(); } }
  function loadTex(name, rep, ext) { if (TX[name]) return TX[name]; var url = "/tex/" + name + (lowTier() ? "_m" : "") + "." + (ext || "jpg"); var t = new THREE.TextureLoader().load(au(url), function () { RH.n.texLoaded = (RH.n.texLoaded || 0) + 1; }, undefined, function (e) { note("tex " + name, e && e.message || "load"); }); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; return (TX[name] = keep(t)); }
  function texInit() {
    if (TX.ready) return; var t0 = nowMs();
    TX.grain = TX.grain || canvasTex(512, 512, drawGrain, true); TX.weave = TX.weave || canvasTex(256, 256, drawWeave, true); TX.plaster = TX.plaster || canvasTex(512, 512, drawPlaster, true); TX.leather = TX.leather || canvasTex(256, 256, drawLeather, true);
    ["rh_oak", "rh_logs", "rh_canvas", "rh_stone_f", "rh_stone_s"].forEach(function (n) { loadTex(n, true); });
    ["rh_art", "rh_stock", "rh_rugs", "rh_vista_a", "rh_vista_b", "rh_vista_c"].forEach(function (n) { loadTex(n, false); }); loadTex("rh_leaf", false, "webp");
    TX.ready = true; RH.n.texMs = Math.round(nowMs() - t0);
  }

  // ───────────────────────── materials: one per surface family, shared by every home (draws per room = materials used) ─────────────────────────
  // textured families share one program (map + vertex colours); plain families another; glow (unlit, the stock atlas' white patch or the
  // fire); leaves alpha tested and double sided; glass; the window vistas (unlit, tinted with the hour)
  var MT = RH.mt = RH.mt || {};
  function std(o) { var m = new THREE.MeshStandardMaterial(o); m.envMapIntensity = o.envMapIntensity !== undefined ? o.envMapIntensity : 0.45; return keep(m); }
  function matInit() {
    if (MT.ready) return; texInit();
    var tx = function (map, o) { return std(Object.assign({ map: map, vertexColors: true, color: 0xffffff, roughness: 0.8, metalness: 0 }, o || {})); };
    MT.wood = tx(TX.grain, { roughness: 0.55 }); MT.oak = tx(TX.rh_oak, { roughness: 0.62 }); MT.fabric = tx(TX.weave, { roughness: 0.96, envMapIntensity: 0.2 });
    MT.leather = tx(TX.leather, { roughness: 0.48, envMapIntensity: 0.55 }); MT.plaster = tx(TX.plaster, { roughness: 0.92, envMapIntensity: 0.25 });
    MT.logs = tx(TX.rh_logs, { roughness: 0.82 }); MT.canvas = tx(TX.rh_canvas, { roughness: 0.98, envMapIntensity: 0.2 }); MT.stoneF = tx(TX.rh_stone_f, { roughness: 0.95, envMapIntensity: 0.2 }); MT.stoneS = tx(TX.rh_stone_s, { roughness: 0.9, envMapIntensity: 0.25 });
    MT.trav = tx((typeof TEX !== "undefined" && TEX.travertine) || TX.plaster, { roughness: 0.32, envMapIntensity: 0.6 });
    MT.art = tx(TX.rh_art, { roughness: 0.62 }); MT.stock = tx(TX.rh_stock, { roughness: 0.7 }); MT.rug = tx(TX.rh_rugs, { roughness: 1, envMapIntensity: 0.1 });
    MT.metal = std({ vertexColors: true, color: 0xffffff, roughness: 0.3, metalness: 0.9, envMapIntensity: 0.8 }); MT.matte = std({ vertexColors: true, color: 0xffffff, roughness: 0.78, metalness: 0 }); MT.gloss = std({ vertexColors: true, color: 0xffffff, roughness: 0.18, metalness: 0, envMapIntensity: 0.7 });
    MT.glow = keep(new THREE.MeshBasicMaterial({ map: TX.rh_stock, vertexColors: true, color: 0xffffff })); MT.fire = keep(new THREE.MeshBasicMaterial({ map: TX.rh_stock, vertexColors: true, color: 0xffffff }));
    MT.leaf = std({ map: TX.rh_leaf, vertexColors: true, color: 0xffffff, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, envMapIntensity: 0.25 });
    MT.glass = std({ color: 0xe4f0f4, transparent: true, opacity: 0.12, roughness: 0.04, metalness: 0.1, depthWrite: false, envMapIntensity: 1.0 });
    MT.vistaA = keep(new THREE.MeshBasicMaterial({ map: TX.rh_vista_a, color: 0xffffff })); MT.vistaB = keep(new THREE.MeshBasicMaterial({ map: TX.rh_vista_b, color: 0xffffff })); MT.vistaC = keep(new THREE.MeshBasicMaterial({ map: TX.rh_vista_c, color: 0xffffff }));
    MT.caster = keep(new THREE.MeshBasicMaterial({ color: 0x000000, colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));   // casts the room's shadow, draws nothing
    for (var k in MT) if (MT[k] && MT[k].isMaterial) MT[k].name = "rh_" + k;
    MT.ready = true;
  }
  // the room's emissive fixtures share one look: their brightness follows the lamps switch (glow colour) and the hour (vistas)

  // ───────────────────────── geometry: cached primitives (non-indexed, uvs in metres unless noted) and the kit that merges a room ─────────────────────────
  var GC = RH.gc = RH.gc || {}; RH.n.geoCached = 0;
  function cache(key, make) { var g = GC[key]; if (!g) { g = make(); if (g.index) { var g2 = g.toNonIndexed(); g.dispose(); g = g2; } keep(g); GC[key] = g; RH.n.geoCached++; } return g; }
  function f3(v) { return Math.round(v * 1000); }   // cache keys: millimetres
  function scaleUv(g, su, sv) { var uv = g.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); }
  function boxG(w, h, d) { return cache("b" + f3(w) + "," + f3(h) + "," + f3(d), function () { var g = new THREE.BoxGeometry(w, h, d); var uv = g.attributes.uv; var dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (var f = 0; f < 6; f++) for (var k = 0; k < 4; k++) { var i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); } return g; }); }
  function boxU(w, h, d) { return cache("u" + f3(w) + "," + f3(h) + "," + f3(d), function () { return new THREE.BoxGeometry(w, h, d); }); }   // 0..1 per face (atlas pictures on a box)
  function planeG(w, h) { return cache("p" + f3(w) + "," + f3(h), function () { return new THREE.PlaneGeometry(w, h); }); }   // x-y plane facing +z, uvs 0..1
  function discG(r, seg) { return cache("o" + f3(r) + "," + (seg || 32), function () { var g = new THREE.CircleGeometry(r, seg || 32); g.rotateX(-HP); return g; }); }   // flat, uvs 0..1 (a round rug)
  function planeM(w, h) { return cache("pm" + f3(w) + "," + f3(h), function () { var g = new THREE.PlaneGeometry(w, h); scaleUv(g, w, h); return g; }); }   // the same, uvs in metres
  function cylG(r0, r1, h, seg, open) { seg = seg || 14; return cache("c" + f3(r0) + "," + f3(r1) + "," + f3(h) + "," + seg + (open ? "o" : ""), function () { var g = new THREE.CylinderGeometry(r0, r1, h, seg, 1, !!open); scaleUv(g, TAU * Math.max(r0, r1, 0.01), h); return g; }); }
  function sphG(r, ws, hs) { ws = ws || 12; hs = hs || 8; return cache("s" + f3(r) + "," + ws + "," + hs, function () { var g = new THREE.SphereGeometry(r, ws, hs); scaleUv(g, TAU * r, PI * r); return g; }); }
  function torG(R, r, rs, ts, arc) { return cache("t" + f3(R) + "," + f3(r) + "," + rs + "," + ts + "," + f3(arc || TAU), function () { var g = new THREE.TorusGeometry(R, r, rs || 6, ts || 24, arc || TAU); scaleUv(g, TAU * R, TAU * r); return g; }); }
  function latheG(prof, seg, p0, pl) { seg = seg || 16; var key = "l" + seg + ":" + f3(p0 || 0) + ":" + f3(pl || TAU) + ":" + prof.map(function (q) { return f3(q[0]) + "," + f3(q[1]); }).join(";");
    return cache(key, function () { var L = 0, mr = 0.01; for (var i = 1; i < prof.length; i++) L += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]); prof.forEach(function (q) { mr = Math.max(mr, q[0]); }); var g = new THREE.LatheGeometry(prof.map(function (q) { return new THREE.Vector2(Math.max(0, q[0]), q[1]); }), seg, p0 || 0, pl || TAU); scaleUv(g, TAU * mr * (pl || TAU) / TAU, L); return g; }); }
  // a rounded box (radius r on every edge, seg steps a quarter), uvs in metres per face; bulge pillows the top and bottom (a cushion)
  function rboxG(w, h, d, r, seg, bulge) { seg = seg || 1; r = Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)); bulge = bulge || 0;
    return cache("r" + [w, h, d, r, bulge].map(f3).join(",") + "," + seg, function () {
      var n = 2 * seg + 1, g = new THREE.BoxGeometry(1, 1, 1, n, n, n), pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
      var co = function (hh) { var a = []; for (var k = 0; k <= seg; k++) a.push(-hh + r - r * Math.cos(k / seg * HP)); for (var k2 = 0; k2 <= seg; k2++) a.push(hh - r + r * Math.sin(k2 / seg * HP)); return a; };
      var CX = co(w / 2), CY = co(h / 2), CZ = co(d / 2), hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
      for (var i = 0; i < pa.count; i++) { var x = CX[Math.round((pa.getX(i) + 0.5) * n)], y = CY[Math.round((pa.getY(i) + 0.5) * n)], z = CZ[Math.round((pa.getZ(i) + 0.5) * n)];
        var qx = clamp(x, -hx, hx), qy = clamp(y, -hy, hy), qz = clamp(z, -hz, hz), vx = x - qx, vy = y - qy, vz = z - qz, L = Math.sqrt(vx * vx + vy * vy + vz * vz), nx = na.getX(i), ny = na.getY(i), nz = na.getZ(i);
        if (L > 1e-6) { nx = vx / L; ny = vy / L; nz = vz / L; x = qx + nx * r; y = qy + ny * r; z = qz + nz * r; }
        if (bulge) { var fx = clamp(x / (w / 2), -1, 1), fz = clamp(z / (d / 2), -1, 1), k3 = (1 - fx * fx) * (1 - fz * fz); y += bulge * k3 * (y / (h / 2)); if (Math.abs(ny) > 0.5) { var sg = ny > 0 ? 1 : -1; nx += sg * 4 * bulge * fx / w * (1 - fz * fz); nz += sg * 4 * bulge * fz / d * (1 - fx * fx); var l2 = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= l2; ny /= l2; nz /= l2; } }
        pa.setXYZ(i, x, y, z); na.setXYZ(i, nx, ny, nz);
        var ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz); if (ay >= ax && ay >= az) ua.setXY(i, x, z); else if (ax >= az) ua.setXY(i, z, y); else ua.setXY(i, x, y); }
      return g; }); }
  // a flat grid in x-z (y up) of nx by nz cells, uvs in metres, with a colour per vertex from fn(x, z) (baked ambient occlusion)
  function gridXZ(x0, z0, x1, z1, nx, nz, fn, down) { var P = [], N = [], U = [], Cc = [], ny = down ? -1 : 1;
    var v = function (i, j) { var x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz; P.push(x, 0, z); N.push(0, ny, 0); U.push(x, -z); var k = fn ? fn(x, z) : 1; Cc.push(k, k, k); };
    for (var j = 0; j < nz; j++) for (var i = 0; i < nx; i++) { if (!down) { v(i, j); v(i, j + 1); v(i + 1, j); v(i + 1, j); v(i, j + 1); v(i + 1, j + 1); } else { v(i, j); v(i + 1, j); v(i, j + 1); v(i + 1, j); v(i + 1, j + 1); v(i, j + 1); } }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(Cc, 3)); return g; }
  // a vertical grid in the u-y plane (u along the wall, normal toward +z of its frame), uvs in metres, colours from fn(u, y)
  function gridUY(u0, u1, y0, y1, nu, ny, fn) { var P = [], N = [], U = [], Cc = [];
    var v = function (i, j) { var u = u0 + (u1 - u0) * i / nu, y = y0 + (y1 - y0) * j / ny; P.push(u, y, 0); N.push(0, 0, 1); U.push(u, y); var k = fn ? fn(u, y) : 1; Cc.push(k, k, k); };
    for (var j = 0; j < ny; j++) for (var i = 0; i < nu; i++) { v(i, j); v(i + 1, j); v(i, j + 1); v(i + 1, j); v(i + 1, j + 1); v(i, j + 1); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(Cc, 3)); return g; }

  // texture scale per material family (metres per repeat); atlas families use their own 0..1 uvs remapped to a rect
  var UVS = { wood: 1 / 0.9, oak: 1 / 1.25, fabric: 1 / 0.28, leather: 1 / 0.6, plaster: 1 / 2.4, logs: 1 / 2.4, canvas: 1 / 1.7, stoneF: 1 / 1.7, stoneS: 1 / 1.5, trav: 1 / 1.6, metal: 1, matte: 1, gloss: 1, glass: 1 };
  var _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _n3 = new THREE.Matrix3();
  function mtx(x, y, z, ry, rx, rz, sx, sy, sz) { _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); return new THREE.Matrix4().compose(_v1.set(x, y, z), _q, _v2.set(sx || 1, sy || 1, sz || 1)); }
  function Kit(mirror) { this.L = {}; this.sol = []; this.occ = []; this.hot = []; this.portals = []; this.cast = []; this.mir = mirror ? -1 : 1; this.parts = 0; this.extra = []; }
  Kit.prototype.put = function (key, g, M, c, uvr, ao) { (this.L[key] || (this.L[key] = [])).push({ g: g, M: M, c: c ? col(c) : null, uvr: uvr || null, ao: ao !== false }); this.parts++; };
  // merge every family into one mesh in the room frame (y up from the floor); contact shading darkens what sits low (ao)
  Kit.prototype.build = function (parent, mats) { var out = [], tri = 0;
    for (var key in this.L) { var list = this.L[key], mt = mats[key]; if (!mt) { note("kit", "no material " + key); continue; } var n = 0; for (var i = 0; i < list.length; i++) n += list[i].g.attributes.position.count; if (!n) continue;
      var P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), CC = new Float32Array(n * 3), o = 0, su = UVS[key] || 1;
      for (var a = 0; a < list.length; a++) { var it = list[a], g = it.g, e = it.M.elements, pa = g.attributes.position.array, na = g.attributes.normal.array, ua = g.attributes.uv.array, ca = g.attributes.color ? g.attributes.color.array : null, cnt = g.attributes.position.count;
        _n3.getNormalMatrix(it.M); var m = _n3.elements, cr = it.c ? it.c.r : 1, cg = it.c ? it.c.g : 1, cb = it.c ? it.c.b : 1, r4 = it.uvr && it.uvr.length === 4 ? it.uvr : null, cu = it.uvr && it.uvr.length === 2 ? it.uvr : null, du = r4 ? r4[2] - r4[0] : 0, dv = r4 ? r4[3] - r4[1] : 0;
        for (var i2 = 0; i2 < cnt; i2++) { var x = pa[i2 * 3], y = pa[i2 * 3 + 1], z = pa[i2 * 3 + 2], j = (o + i2) * 3;
          var px = e[0] * x + e[4] * y + e[8] * z + e[12], py = e[1] * x + e[5] * y + e[9] * z + e[13], pz = e[2] * x + e[6] * y + e[10] * z + e[14]; P[j] = px; P[j + 1] = py; P[j + 2] = pz;
          var nx = na[i2 * 3], ny = na[i2 * 3 + 1], nz = na[i2 * 3 + 2], qx = m[0] * nx + m[3] * ny + m[6] * nz, qy = m[1] * nx + m[4] * ny + m[7] * nz, qz = m[2] * nx + m[5] * ny + m[8] * nz, ql = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1; N[j] = qx / ql; N[j + 1] = qy / ql; N[j + 2] = qz / ql;
          var k2 = (o + i2) * 2; if (r4) { U[k2] = r4[0] + ua[i2 * 2] * du; U[k2 + 1] = r4[1] + ua[i2 * 2 + 1] * dv; } else if (cu) { U[k2] = cu[0]; U[k2 + 1] = cu[1]; } else { U[k2] = ua[i2 * 2] * su; U[k2 + 1] = ua[i2 * 2 + 1] * su; }
          var k = it.ao ? 0.56 + 0.44 * smooth(0.0, 0.42, py) : 1; if (ca) { CC[j] = cr * ca[i2 * 3] * k; CC[j + 1] = cg * ca[i2 * 3 + 1] * k; CC[j + 2] = cb * ca[i2 * 3 + 2] * k; } else { CC[j] = cr * k; CC[j + 1] = cg * k; CC[j + 2] = cb * k; } }
        o += cnt; }
      var geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(P, 3)); geo.setAttribute("normal", new THREE.BufferAttribute(N, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(U, 2)); geo.setAttribute("color", new THREE.BufferAttribute(CC, 3)); geo.computeBoundingSphere();
      var me = new THREE.Mesh(geo, mt); me.name = "rh " + key; me.userData.noSolid = true; me.userData.shSet = true; me.castShadow = false; me.receiveShadow = !mt.transparent; if (mt.transparent) me.renderOrder = 2; parent.add(me); out.push(me); tri += n / 3; }
    RH.n.tri = Math.round(tri); return out; };

  // a piece in its own frame (x across, z toward its front, y up from y0), placed at (x, z) facing yaw in the room frame;
  // the kit's mirror flips the room across x (positions and yaws; geometry is never mirrored)
  function F(K, x, z, yaw, y0, raw) { var mr = raw ? 1 : K.mir; x *= mr; yaw = mr < 0 ? -(yaw || 0) : (yaw || 0); y0 = (y0 || 0) + (K.y0 || 0); var c = Math.cos(yaw), s = Math.sin(yaw), B = mtx(x, y0, z, yaw);
    var f = { K: K, x: x, z: z, yaw: yaw, y0: y0, mr: mr };
    f.w = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; };
    f.put = function (key, g, lx, ly, lz, cl, o) { o = o || {}; var M = mtx(lx, ly, lz, o.ry, o.rx, o.rz, o.sx, o.sy, o.sz); M.premultiply(B); K.put(key, g, M, cl, o.uvr, o.ao); return f; };
    f.box = function (key, w, h, d, lx, ly, lz, cl, o) { return f.put(key, boxG(w, h, d), lx, ly, lz, cl, o); };
    f.boxU = function (key, w, h, d, lx, ly, lz, cl, o) { return f.put(key, boxU(w, h, d), lx, ly, lz, cl, o); };
    f.rb = function (key, w, h, d, r, lx, ly, lz, cl, o) { o = o || {}; return f.put(key, rboxG(w, h, d, r, o.seg || 1, o.bulge || 0), lx, ly, lz, cl, o); };
    f.cyl = function (key, r0, r1, h, lx, ly, lz, cl, o) { o = o || {}; return f.put(key, cylG(r0, r1, h, o.seg || 14, o.open), lx, ly, lz, cl, o); };
    f.sph = function (key, r, lx, ly, lz, cl, o) { o = o || {}; return f.put(key, sphG(r, o.ws || 12, o.hs || 8), lx, ly, lz, cl, o); };
    f.lathe = function (key, prof, lx, ly, lz, cl, o) { o = o || {}; return f.put(key, latheG(prof, o.seg || 16, o.p0, o.pl), lx, ly, lz, cl, o); };
    f.tor = function (key, R, r, lx, ly, lz, cl, o) { o = o || {}; return f.put(key, torG(R, r, o.rs, o.ts, o.arc), lx, ly, lz, cl, o); };
    f.quad = function (key, w, h, lx, ly, lz, cl, uvr, o) { o = Object.assign({ ao: false }, o || {}); o.uvr = uvr; return f.put(key, planeG(w, h), lx, ly, lz, cl, o); };
    f.quadM = function (key, w, h, lx, ly, lz, cl, o) { return f.put(key, planeM(w, h), lx, ly, lz, cl, o); };
    // a rod between two local points (radius r)
    f.rod = function (key, A, Bp, r, cl, seg) { var dx = Bp[0] - A[0], dy = Bp[1] - A[1], dz = Bp[2] - A[2], L = Math.sqrt(dx * dx + dy * dy + dz * dz); if (L < 1e-4) return f; var g = cylG(r, r, L, seg || 6, true);
      _v1.set(dx / L, dy / L, dz / L); _q.setFromUnitVectors(_v2.set(0, 1, 0), _v1); var M = new THREE.Matrix4().compose(new THREE.Vector3((A[0] + Bp[0]) / 2, (A[1] + Bp[1]) / 2, (A[2] + Bp[2]) / 2), _q, new THREE.Vector3(1, 1, 1)); M.premultiply(B); K.put(key, g, M, cl, null, true); return f; };
    // a solid in the piece frame (the box from y0 to y1); seat: sittable, face: the yaw (piece frame) a sitter faces
    f.solid = function (lx, lz, w, d, sy0, sy1, o) { o = o || {}; var p = f.w(lx, lz); K.sol.push([p[0], p[1], w, d, y0 + sy0, y0 + sy1, yaw + (o.ry || 0), !!o.seat, o.seat ? yaw + (o.face || 0) : null, o.out || null]); return f; };
    f.occ = function (lx, lz, w, d, h, k) { if (y0 > 0.5) return f; var p = f.w(lx, lz); K.occ.push([p[0], p[1], w / 2, d / 2, yaw, h || 0.5, k || 1]); return f; };
    f.hot = function (lx, lz, r, kind, d) { var p = f.w(lx, lz); K.hot.push({ x: p[0], z: p[1], y: y0, r: r, kind: kind, d: d || {} }); return f; };
    return f; }

  // ───────────────────────── furniture: every piece faces +z in its own frame, writes its parts, solids, seats and floor shadow into the kit ─────────────────────────
  var BLACK = 0x1c1a19, IRON = 0x2a2724, BRASS = 0xb8955a, CHROME = 0xc8ccd0, COPPER = 0xb4683c, CREAM = 0xf1ebe0, WHITEC = 0xf6f4f0, BULB = 0xfff1d6;
  function legs4(f, key, w, d, h, r, cl, inset) { inset = inset === undefined ? 0.07 : inset; [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { f.cyl(key, r, r * 0.75, h, q[0] * (w / 2 - inset), h / 2, q[1] * (d / 2 - inset), cl, { seg: 8 }); }); }
  // sofa: track (modern), roll (rolled arms, button tufting), low (deep and low, villa), camel (leather chesterfield with nailheads)
  function sofa(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), L = o.len || 2.3, D = o.d || 0.95, m = o.mat || "fabric", c = o.c || 0xd8d0c4, st = o.style || "track", lg = st === "low" ? 0.06 : 0.12, sh = st === "low" ? 0.4 : 0.44;
    var aw = st === "roll" || st === "camel" ? 0.24 : st === "low" ? 0.16 : 0.2, ah = st === "low" ? sh + 0.12 : sh + 0.2, bh = st === "low" ? 0.72 : 0.84, ih = L - 2 * aw;
    f.rb(m, L, sh - lg - 0.1, D, 0.04, 0, lg + (sh - lg - 0.1) / 2, 0, c, { seg: 2 });   // plinth
    [-1, 1].forEach(function (s) { if (st === "roll" || st === "camel") { f.rb(m, aw, ah - lg, D, 0.05, s * (L / 2 - aw / 2), lg + (ah - lg) / 2, 0, c, { seg: 2 }); f.cyl(m, 0.14, 0.14, D, s * (L / 2 - aw / 2 + 0.02), ah - 0.02, 0, c, { rx: HP, seg: 14 }); }
      else f.rb(m, aw, ah - lg, D, st === "low" ? 0.05 : 0.06, s * (L / 2 - aw / 2), lg + (ah - lg) / 2, 0, c, { seg: 2 }); });
    f.rb(m, L - 0.02, bh - lg, 0.22, 0.06, 0, lg + (bh - lg) / 2, -D / 2 + 0.11, c, { seg: 2 });
    var n = o.n || (ih > 1.7 ? 3 : ih > 1.0 ? 2 : 1), cw = ih / n;
    for (var i = 0; i < n; i++) { var cx = -ih / 2 + cw * (i + 0.5); f.rb(m, cw - 0.015, 0.16, D - 0.26, 0.06, cx, sh - 0.08, 0.11, c, { seg: 2, bulge: 0.02 });
      if (st !== "camel") f.rb(m, cw - 0.03, st === "low" ? 0.4 : 0.46, 0.18, 0.07, cx, sh + (st === "low" ? 0.18 : 0.22), -D / 2 + 0.3, c, { seg: 2, bulge: 0.03, rx: -0.14 }); }
    if (st === "camel" || st === "roll") { var nb = Math.round(L / 0.1); for (var b = 0; b < nb; b++) f.sph("metal", 0.009, -L / 2 + 0.05 + b * (L - 0.1) / (nb - 1), lg + 0.06, D / 2 + 0.003, BRASS, { ws: 5, hs: 4 }); if (st === "camel") for (var t = 0; t < 2; t++) for (var u = 0; u < Math.round(L / 0.22); u++) f.sph(m, 0.014, -L / 2 + 0.3 + u * 0.22 + (t ? 0.11 : 0), bh - 0.12 - t * 0.14, -D / 2 + 0.225, shade(c, 0.6), { ws: 5, hs: 4 }); }
    (o.pil || []).forEach(function (p, j) { var s = j % 2 ? 1 : -1, off = Math.floor(j / 2) * 0.36; var g = rboxG(0.44, 0.14, 0.42, 0.06, 1, 0.04), lz = -D / 2 + 0.42; if (p.uvr) f.put("rug", g, s * (ih / 2 - 0.26 - off), sh + 0.22, lz, null, { rx: -1.2, ry: s * 0.18, uvr: p.uvr }); else f.put(p.m || "fabric", g, s * (ih / 2 - 0.26 - off), sh + 0.22, lz, p.c, { rx: -1.2, ry: s * 0.18 }); });
    if (o.throwUv) { f.box("rug", 0.5, 0.02, D - 0.1, (o.throwSide || 1) * (ih / 2 - 0.35), sh + 0.005, 0.05, null, { uvr: o.throwUv }); f.box("rug", 0.5, 0.36, 0.02, (o.throwSide || 1) * (ih / 2 - 0.35), sh - 0.17, D / 2 + 0.005, null, { uvr: o.throwUv }); }
    if (lg > 0.07) legs4(f, o.legM || "wood", L, D, lg, 0.022, o.legC || 0x4a3426, 0.1); else f.box("matte", L - 0.1, lg, D - 0.12, 0, lg / 2, 0, 0x151413);
    f.solid(0, 0.1, L - 0.1, D - 0.3, 0, sh, { seat: true }); f.solid(0, -D / 2 + 0.13, L, 0.26, 0, bh); f.solid(-L / 2 + aw / 2, 0.1, aw, D - 0.3, 0, ah); f.solid(L / 2 - aw / 2, 0.1, aw, D - 0.3, 0, ah); f.occ(0, 0, L + 0.1, D + 0.1, 0.5);
    return f; }
  // a chaise (sectional end) or an ottoman: a cushioned block
  function ottoman(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), w = o.w || 0.9, d = o.d || 0.9, h = o.h || 0.42, m = o.mat || "fabric", c = o.c || 0xd8d0c4;
    f.rb(m, w, h - 0.08, d, 0.05, 0, (h - 0.08) / 2 + 0.06, 0, c, { seg: 2, bulge: 0.012 }); f.box("matte", w - 0.08, 0.06, d - 0.08, 0, 0.03, 0, 0x161514); if (o.tray) { f.box("wood", 0.5, 0.03, 0.36, 0, h + 0.015, 0, o.trayC || 0x5a3e2b); }
    f.solid(0, 0, w, d, 0, h, { seat: !o.noSeat, face: o.face || 0 }); f.occ(0, 0, w + 0.05, d + 0.05, 0.4); return f; }
  // armchairs: lounge (upholstered), club (leather, rolled), sling (leather on a black frame), rocker (wood), wing (wingback), campaign (wood and canvas)
  function chair(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), st = o.style || "lounge", c = o.c || 0xcfc6b8, m = o.mat || "fabric", wc = o.wc || 0x5a3e2b;
    if (st === "lounge" || st === "club" || st === "wing") { var W = st === "club" ? 0.92 : 0.82, D = 0.86, sh = 0.43; f.rb(m, W, 0.26, D, 0.05, 0, 0.21, 0, c, { seg: 2 }); [-1, 1].forEach(function (s) { f.rb(m, 0.16, st === "wing" ? 0.42 : 0.38, D, 0.06, s * (W / 2 - 0.08), 0.42, 0, c, { seg: 2 }); if (st === "club") f.cyl(m, 0.1, 0.1, D, s * (W / 2 - 0.08), 0.62, 0, c, { rx: HP }); });
      f.rb(m, W, st === "wing" ? 1.0 : 0.62, 0.18, 0.06, 0, st === "wing" ? 0.62 : 0.5, -D / 2 + 0.09, c, { seg: 2 }); if (st === "wing") [-1, 1].forEach(function (s) { f.rb(m, 0.1, 0.42, 0.3, 0.04, s * (W / 2 - 0.05), 0.9, -D / 2 + 0.2, c, { ry: s * 0.3 }); });
      f.rb(m, W - 0.32, 0.14, D - 0.24, 0.05, 0, sh - 0.06, 0.08, c, { seg: 2, bulge: 0.02 }); f.rb(m, W - 0.34, 0.4, 0.16, 0.06, 0, sh + 0.2, -D / 2 + 0.26, c, { bulge: 0.025, rx: -0.15 });
      legs4(f, "wood", W, D, 0.08, 0.02, wc, 0.08); if (st === "club" || st === "wing") { var nb = 12; for (var b = 0; b < nb; b++) f.sph("metal", 0.008, -W / 2 + 0.08 + b * (W - 0.16) / (nb - 1), 0.11, D / 2 + 0.002, BRASS, { ws: 5, hs: 4 }); }
      if (o.pil) f.put(o.pil.uvr ? "rug" : "fabric", rboxG(0.38, 0.12, 0.36, 0.05, 1, 0.035), 0, sh + 0.22, -D / 2 + 0.38, o.pil.c, { rx: -1.25, uvr: o.pil.uvr });
      f.solid(0, 0.05, W - 0.2, D - 0.25, 0, sh, { seat: true }); f.solid(0, -D / 2 + 0.1, W, 0.2, 0, st === "wing" ? 1.12 : 0.8); f.occ(0, 0, W, D, 0.45); }
    else if (st === "sling") { var W2 = 0.74, D2 = 0.8; [-1, 1].forEach(function (s) { f.rod("metal", [s * W2 / 2, 0, D2 / 2 - 0.05], [s * W2 / 2, 0.55, D2 / 2 - 0.12], 0.012, BLACK); f.rod("metal", [s * W2 / 2, 0, -D2 / 2 + 0.05], [s * W2 / 2, 0.82, -D2 / 2 - 0.06], 0.012, BLACK); f.rod("metal", [s * W2 / 2, 0.55, D2 / 2 - 0.12], [s * W2 / 2, 0.55, -D2 / 2 + 0.1], 0.012, BLACK); f.rod("metal", [s * W2 / 2, 0.02, D2 / 2 - 0.05], [s * W2 / 2, 0.02, -D2 / 2 + 0.05], 0.012, BLACK); f.box("leather", 0.06, 0.03, D2 - 0.25, s * W2 / 2, 0.57, -0.02, c); });
      f.box("leather", W2 - 0.04, 0.02, 0.55, 0, 0.36, 0.08, c, { rx: 0.1 }); f.box("leather", W2 - 0.04, 0.6, 0.02, 0, 0.62, -D2 / 2 + 0.02, c, { rx: -0.2 }); f.rb("leather", W2 - 0.12, 0.08, 0.48, 0.03, 0, 0.4, 0.08, c, { rx: 0.1 });
      f.solid(0, 0.05, W2 - 0.1, D2 - 0.3, 0, 0.42, { seat: true }); f.solid(0, -D2 / 2 + 0.08, W2, 0.16, 0, 0.85); f.occ(0, 0, W2, D2, 0.4); }
    else if (st === "rocker") { var W3 = 0.62, D3 = 0.7; [-1, 1].forEach(function (s) { f.tor("wood", 0.95, 0.02, s * W3 / 2, 0.98, 0, wc, { arc: 0.78, ry: HP, rz: -HP - 0.39, ts: 12 }); f.rod("wood", [s * W3 / 2, 0.05, D3 / 2 - 0.12], [s * W3 / 2, 0.62, D3 / 2 - 0.12], 0.018, wc); f.rod("wood", [s * W3 / 2, 0.05, -D3 / 2 + 0.1], [s * W3 / 2, 1.08, -D3 / 2 - 0.02], 0.02, wc); f.box("wood", 0.06, 0.03, D3 - 0.1, s * W3 / 2, 0.64, 0.02, wc); });
      f.box("wood", W3, 0.04, D3 - 0.2, 0, 0.42, 0.02, wc); for (var sl = 0; sl < 6; sl++) f.box("wood", 0.05, 0.62, 0.02, -W3 / 2 + 0.08 + sl * (W3 - 0.16) / 5, 0.78, -D3 / 2 + 0.03, wc, { rx: -0.12 }); f.box("wood", W3, 0.06, 0.03, 0, 1.08, -D3 / 2 - 0.02, wc);
      f.rb("fabric", W3 - 0.08, 0.06, D3 - 0.28, 0.025, 0, 0.47, 0.02, o.cushion || 0x8f2b1e, { bulge: 0.012 }); if (o.throwUv) f.box("rug", W3 - 0.1, 0.5, 0.015, 0, 0.82, -D3 / 2 + 0.06, null, { uvr: o.throwUv, rx: -0.12 });
      f.solid(0, 0.02, W3 - 0.08, D3 - 0.3, 0, 0.47, { seat: true }); f.solid(0, -D3 / 2 + 0.02, W3, 0.12, 0, 1.1); f.occ(0, 0, W3, D3, 0.4); }
    else { var W4 = 0.66, D4 = 0.72; [-1, 1].forEach(function (s) { f.rod("wood", [s * W4 / 2, 0, D4 / 2 - 0.05], [s * W4 / 2, 0.64, D4 / 2 - 0.05], 0.022, wc); f.rod("wood", [s * W4 / 2, 0, -D4 / 2 + 0.05], [s * W4 / 2, 0.9, -D4 / 2 + 0.02], 0.022, wc); f.box("wood", 0.05, 0.04, D4, s * W4 / 2, 0.64, 0, wc); f.box("leather", 0.07, 0.02, D4 - 0.2, s * W4 / 2, 0.665, 0, o.strap || 0x6a3c22); });
      f.box("canvas", W4 - 0.04, 0.03, D4 - 0.15, 0, 0.4, 0.03, c, { rx: 0.06 }); f.box("canvas", W4 - 0.04, 0.5, 0.03, 0, 0.66, -D4 / 2 + 0.06, c, { rx: -0.16 }); f.rb("fabric", W4 - 0.12, 0.08, 0.48, 0.03, 0, 0.45, 0.04, o.cushion || 0xb5623a, { bulge: 0.015 });
      f.solid(0, 0.04, W4 - 0.08, D4 - 0.25, 0, 0.45, { seat: true }); f.solid(0, -D4 / 2 + 0.05, W4, 0.12, 0, 0.92); f.occ(0, 0, W4, D4, 0.4); }
    return f; }
  // dining and bar seating: cross (wood cross back, rattan seat), spindle (ranch Windsor), shell (moulded seat on oak legs), ladder (ladder back), bench, stool (saddle), barstool
  function dchair(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), st = o.style || "spindle", wc = o.wc || 0x6a4a30, c = o.c || 0xd8cbb4, sh = 0.46;
    if (st === "shell") { f.rb("gloss", 0.48, 0.05, 0.46, 0.02, 0, sh, 0.02, c, { seg: 2 }); f.rb("gloss", 0.48, 0.36, 0.05, 0.025, 0, sh + 0.2, -0.2, c, { rx: -0.18, seg: 2 }); [-1, 1].forEach(function (s) { f.rod("wood", [s * 0.2, 0, 0.2], [s * 0.15, sh - 0.02, 0.12], 0.016, wc); f.rod("wood", [s * 0.2, 0, -0.2], [s * 0.15, sh - 0.02, -0.12], 0.016, wc); }); if (o.pad) f.rb("fabric", 0.4, 0.04, 0.38, 0.018, 0, sh + 0.04, 0.03, o.pad, { bulge: 0.008 }); }
    else { var W = 0.46, D = 0.46; legs4(f, "wood", W, D, sh - 0.03, 0.02, wc, 0.04); f.box(st === "cross" ? "wood" : "wood", W, 0.04, D, 0, sh - 0.02, 0, wc);
      if (st === "cross") { f.box("wood", W - 0.08, 0.02, D - 0.08, 0, sh + 0.005, 0, o.seatC || 0xc9a46a); [-1, 1].forEach(function (s) { f.rod("wood", [s * (W / 2 - 0.04), sh, -D / 2 + 0.04], [s * (W / 2 - 0.04), sh + 0.46, -D / 2 + 0.01], 0.018, wc); f.rod("wood", [s * (W / 2 - 0.05), sh + 0.08, -D / 2 + 0.035], [-s * (W / 2 - 0.05), sh + 0.38, -D / 2 + 0.015], 0.012, wc); }); f.box("wood", W - 0.04, 0.06, 0.025, 0, sh + 0.43, -D / 2 + 0.01, wc); }
      else if (st === "ladder") { [-1, 1].forEach(function (s) { f.rod("wood", [s * (W / 2 - 0.04), sh, -D / 2 + 0.04], [s * (W / 2 - 0.04), sh + 0.56, -D / 2 + 0.0], 0.02, wc); }); for (var l = 0; l < 3; l++) f.box("wood", W - 0.08, 0.06, 0.02, 0, sh + 0.2 + l * 0.15, -D / 2 + 0.025 - l * 0.012, wc); f.rb("fabric", W - 0.06, 0.04, D - 0.06, 0.015, 0, sh + 0.02, 0.01, c, { bulge: 0.008 }); }
      else { f.tor("wood", 0.22, 0.016, 0, sh + 0.36, -0.06, wc, { arc: PI, rx: 0, ts: 12, ry: 0 }); for (var sp = 0; sp < 7; sp++) { var a = PI * (0.08 + sp * 0.14); f.rod("wood", [Math.cos(a) * 0.2, sh, -0.06 - Math.sin(a) * 0.05], [Math.cos(a) * 0.21, sh + 0.36 + Math.sin(a) * 0.2, -0.06 - Math.sin(a) * 0.05], 0.008, wc); } if (o.pad) f.rb("fabric", W - 0.08, 0.035, D - 0.1, 0.015, 0, sh + 0.02, 0.01, o.pad, { bulge: 0.008 }); } }
    f.solid(0, 0.02, 0.44, 0.42, 0, sh + 0.02, { seat: true, out: "back" }); f.solid(0, -0.22, 0.46, 0.08, 0, sh + 0.45); f.occ(0, 0, 0.5, 0.5, 0.45, 0.6); return f; }
  function bench(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), L = o.len || 1.8, wc = o.wc || 0x6a4a30; f.box("wood", L, 0.06, 0.38, 0, 0.44, 0, wc); [-1, 1].forEach(function (s) { f.box("wood", 0.07, 0.41, 0.3, s * (L / 2 - 0.12), 0.205, 0, wc); }); f.box("wood", L - 0.3, 0.05, 0.05, 0, 0.12, 0, wc);
    if (o.cushion) f.rb("fabric", L - 0.06, 0.05, 0.36, 0.02, 0, 0.495, 0, o.cushion, { bulge: 0.01 }); f.solid(0, 0, L, 0.38, 0, 0.47, { seat: true, face: o.face || 0 }); f.occ(0, 0, L, 0.4, 0.45, 0.7); return f; }
  function stool(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), h = o.h || 0.74, st = o.style || "bar", wc = o.wc || 0x6a4a30, c = o.c || 0x6b3c22;
    if (st === "saddle") { legs4(f, "wood", 0.36, 0.36, h - 0.05, 0.02, wc, 0.03); f.box("wood", 0.3, 0.02, 0.02, 0, h * 0.35, 0.15, wc); f.rb("leather", 0.4, 0.07, 0.36, 0.03, 0, h - 0.02, 0, c, { bulge: -0.012, seg: 2 }); }
    else if (st === "metal") { [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { f.rod("metal", [q[0] * 0.17, 0, q[1] * 0.17], [q[0] * 0.13, h - 0.04, q[1] * 0.13], 0.011, o.mc || BLACK); }); f.tor("metal", 0.17, 0.008, 0, h * 0.32, 0, o.mc || BLACK, { rx: HP, ts: 16 }); f.rb(o.mat || "leather", 0.4, 0.06, 0.38, 0.025, 0, h - 0.01, 0, c, { bulge: 0.01 }); f.rb(o.mat || "leather", 0.38, 0.18, 0.04, 0.02, 0, h + 0.13, -0.18, c, { rx: -0.1 }); f.rod("metal", [-0.12, h, -0.17], [-0.12, h + 0.1, -0.18], 0.008, o.mc || BLACK); f.rod("metal", [0.12, h, -0.17], [0.12, h + 0.1, -0.18], 0.008, o.mc || BLACK); }
    else { f.cyl("wood", 0.19, 0.19, 0.05, 0, h - 0.025, 0, wc, { seg: 18 }); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { f.rod("wood", [q[0] * 0.16, 0, q[1] * 0.16], [q[0] * 0.11, h - 0.05, q[1] * 0.11], 0.016, wc); }); f.tor("metal", 0.15, 0.008, 0, h * 0.32, 0, BRASS, { rx: HP, ts: 16 }); }
    f.solid(0, 0, 0.38, 0.38, 0, h, { seat: true, out: "back" }); f.occ(0, 0, 0.4, 0.4, 0.4, 0.5); return f; }

  // tables: dining (rect, trestle, round, live edge), coffee (block, drum, slab, trunk, round), side and console
  function table(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), L = o.len || 2.2, D = o.d || 0.95, h = o.h || 0.76, st = o.style || "rect", top = o.top || "wood", tc = o.tc || 0x6a4a30, lc = o.lc || tc;
    if (st === "round") { var R = L / 2; f.cyl(top, R, R, 0.045, 0, h - 0.022, 0, tc, { seg: 32 }); f.lathe(o.legM || "wood", [[0.3, 0], [0.28, 0.03], [0.1, 0.08], [0.08, h * 0.5], [0.12, h - 0.06], [0.0, h - 0.05]], 0, 0, 0, lc, { seg: 18 }); f.solid(0, 0, R * 1.5, R * 1.5, 0, h); f.occ(0, 0, L, L, h, 0.6); return f; }
    f.box(top, L, 0.05, D, 0, h - 0.025, 0, tc);
    if (st === "trestle") { [-1, 1].forEach(function (s) { f.box("wood", 0.09, h - 0.11, 0.12, s * (L / 2 - 0.3), (h - 0.05) / 2 + 0.03, 0, lc); f.box("wood", 0.1, 0.06, D - 0.12, s * (L / 2 - 0.3), 0.03, 0, lc); f.box("wood", 0.1, 0.06, D - 0.2, s * (L / 2 - 0.3), h - 0.08, 0, lc); }); f.box("wood", L - 0.6, 0.08, 0.06, 0, 0.3, 0, lc); }
    else if (st === "pedestal2") { [-1, 1].forEach(function (s) { f.box(o.legM || "stoneS", 0.24, h - 0.05, D * 0.55, s * (L / 2 - 0.45), (h - 0.05) / 2, 0, lc); }); }
    else if (st === "slab") { f.box("wood", L - 0.04, 0.02, D - 0.06, 0, h - 0.06, 0, shade(tc, 0.7)); [-1, 1].forEach(function (s) { f.rod("metal", [s * (L / 2 - 0.25), 0, D / 2 - 0.12], [s * (L / 2 - 0.25), h - 0.05, 0], 0.016, BLACK); f.rod("metal", [s * (L / 2 - 0.25), 0, -D / 2 + 0.12], [s * (L / 2 - 0.25), h - 0.05, 0], 0.016, BLACK); f.rod("metal", [s * (L / 2 - 0.25), 0.01, D / 2 - 0.12], [s * (L / 2 - 0.25), 0.01, -D / 2 + 0.12], 0.016, BLACK); }); }
    else legs4(f, o.legM || "wood", L, D, h - 0.05, 0.035, lc, 0.08);
    f.solid(0, 0, L, D, 0, h); f.occ(0, 0, L, D, h, 0.55); return f; }
  function coffee(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), st = o.style || "block", L = o.len || 1.2, D = o.d || 0.7, h = o.h || 0.38, tc = o.tc || 0xd9cbb4;
    if (st === "block") { f.rb(o.mat || "trav", L, h, D, 0.02, 0, h / 2, 0, tc, { seg: 1 }); }
    else if (st === "drum") { f.cyl(o.mat || "wood", L / 2, L / 2, h, 0, h / 2, 0, tc, { seg: 28 }); f.cyl("metal", L / 2 + 0.004, L / 2 + 0.004, 0.02, 0, h - 0.04, 0, BRASS, { seg: 28, open: true }); }
    else if (st === "slab") { f.rb("wood", L, 0.09, D, 0.03, 0, h - 0.045, 0, tc, { seg: 1 }); f.box("wood", L - 0.04, 0.02, D - 0.06, 0, h - 0.1, 0, shade(tc, 0.65)); [-1, 1].forEach(function (s) { f.box("wood", 0.12, h - 0.09, D - 0.2, s * (L / 2 - 0.2), (h - 0.09) / 2, 0, shade(tc, 0.8)); }); }
    else if (st === "trunk") { f.rb("wood", L, h - 0.05, D, 0.02, 0, (h - 0.05) / 2, 0, tc); f.rb("leather", L + 0.01, 0.08, D + 0.01, 0.03, 0, h - 0.06, 0, shade(tc, 0.7)); [-1, 1].forEach(function (s) { f.box("metal", 0.04, h + 0.01, D + 0.02, s * (L / 2 - 0.15), h / 2, 0, BRASS); f.box("metal", 0.12, 0.05, 0.02, s * 0.25, h - 0.18, D / 2 + 0.01, BRASS); }); }
    else if (st === "round2") { f.cyl("trav", L / 2, L / 2, 0.06, 0, h - 0.03, 0, tc, { seg: 30 }); f.cyl("trav", L * 0.28, L * 0.32, h - 0.06, 0, (h - 0.06) / 2, 0, shade(tc, 0.92), { seg: 22 }); f.cyl("trav", L * 0.32, L * 0.32, 0.05, 0.38 * L, h * 0.6 - 0.025, 0.18 * L, tc, { seg: 22 }); }
    f.solid(0, 0, L, D, 0, h); f.occ(0, 0, L + 0.05, D + 0.05, h, 0.7); return f; }
  function sideTable(K, x, z, o) { o = o || {}; var f = F(K, x, z, o.yaw || 0), h = o.h || 0.55, st = o.style || "round", tc = o.tc || 0x6a4a30;
    if (st === "round") { f.cyl(o.mat || "wood", 0.25, 0.25, 0.035, 0, h - 0.018, 0, tc, { seg: 22 }); f.rod("metal", [0, 0, 0], [0, h - 0.03, 0], 0.02, o.mc || BLACK); f.cyl("metal", 0.17, 0.17, 0.02, 0, 0.01, 0, o.mc || BLACK, { seg: 18 }); }
    else if (st === "stump") { f.cyl("wood", 0.22, 0.24, h, 0, h / 2, 0, tc, { seg: 12 }); f.cyl("wood", 0.215, 0.215, 0.005, 0, h + 0.002, 0, shade(tc, 1.35), { seg: 12 }); }
    else if (st === "barrel") { f.lathe("wood", [[0.23, 0], [0.27, h * 0.5], [0.23, h], [0, h]], 0, 0, 0, tc, { seg: 16 }); [0.08, h - 0.08].forEach(function (yy) { f.cyl("metal", 0.245, 0.245, 0.03, 0, yy, 0, IRON, { seg: 16, open: true }); }); }
    else { f.box("wood", 0.5, 0.04, 0.42, 0, h - 0.02, 0, tc); legs4(f, "wood", 0.5, 0.42, h - 0.04, 0.016, tc, 0.04); f.box("wood", 0.44, 0.02, 0.36, 0, 0.16, 0, tc); }
    f.solid(0, 0, 0.5, 0.5, 0, h); f.occ(0, 0, 0.5, 0.5, h, 0.4); return f; }

  // lights: emissive fixtures (glow family) on stems, shades and cords; brightness follows the lamps switch
  function tableLamp(K, x, z, y, o) { o = o || {}; var f = F(K, x, z, 0, y), st = o.style || "ceramic", bc = o.c || 0xd8cbb4;
    if (st === "lantern") { f.box("metal", 0.16, 0.02, 0.16, 0, 0.01, 0, IRON); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { f.rod("metal", [q[0] * 0.07, 0.02, q[1] * 0.07], [q[0] * 0.07, 0.28, q[1] * 0.07], 0.006, IRON); }); f.cyl("glow", 0.05, 0.05, 0.18, 0, 0.13, 0, 0xffb85a, { uvr: WHITE, seg: 10 }); f.cyl("metal", 0.0, 0.11, 0.06, 0, 0.31, 0, IRON, { seg: 4, ry: PI / 4 }); f.tor("metal", 0.035, 0.006, 0, 0.37, 0, IRON, { ts: 10 }); return f; }
    f.lathe(st === "brass" ? "metal" : "gloss", st === "brass" ? [[0, 0], [0.08, 0], [0.08, 0.02], [0.02, 0.04], [0.015, 0.3], [0, 0.3]] : [[0, 0], [0.07, 0], [0.11, 0.08], [0.1, 0.2], [0.04, 0.28], [0.015, 0.31], [0, 0.31]], 0, 0, 0, st === "brass" ? BRASS : bc, { seg: 16 });
    f.cyl("glow", 0.17, 0.2, 0.22, 0, 0.42, 0, o.shade || 0xffe0b0, { uvr: WHITE, seg: 18, open: true }); f.cyl("glow", 0.165, 0.195, 0.215, 0, 0.42, 0, 0xfff0d8, { uvr: WHITE, seg: 18, open: true, ry: 0.01 }); return f; }
  function floorLamp(K, x, z, o) { o = o || {}; var f = F(K, x, z, o.yaw || 0), st = o.style || "arc";
    if (st === "arc") { f.cyl("trav", 0.18, 0.18, 0.06, 0, 0.03, 0, 0xe9e3d8, { seg: 18 }); f.rod("metal", [0, 0.06, 0], [0, 1.2, 0], 0.012, o.mc || BRASS); var pts = []; for (var i = 0; i <= 8; i++) { var a = i / 8 * 1.2; pts.push([Math.sin(a) * 0.9, 1.2 + Math.sin(a * 1.3) * 0.75, 0]); } for (var j = 0; j < 8; j++) f.rod("metal", [pts[j][0], pts[j][1], 0.0], [pts[j + 1][0], pts[j + 1][1], 0], 0.011, o.mc || BRASS);
      var tip = pts[8]; f.lathe("metal", [[0.0, 0.0], [0.2, -0.0], [0.2, -0.02], [0.03, 0.14], [0, 0.15]], tip[0], tip[1] - 0.2, 0, o.mc || BRASS, { seg: 20 }); f.cyl("glow", 0.17, 0.17, 0.01, tip[0], tip[1] - 0.205, 0, 0xfff1d8, { uvr: WHITE, seg: 18 }); f.solid(0, 0, 0.36, 0.36, 0, 1.0); return f; }
    if (st === "tripod") { [0, 1, 2].forEach(function (k) { var a = k / 3 * TAU; f.rod("wood", [Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3], [0, 1.25, 0], 0.016, o.wc || 0x6a4a30); }); f.cyl("glow", 0.24, 0.26, 0.32, 0, 1.38, 0, o.shade || 0xffd9a4, { uvr: WHITE, seg: 18, open: true }); f.cyl("glow", 0.235, 0.255, 0.31, 0, 1.38, 0, 0xfff0d8, { uvr: WHITE, seg: 18, open: true }); f.solid(0, 0, 0.5, 0.5, 0, 1.2); return f; }
    f.cyl("metal", 0.15, 0.17, 0.03, 0, 0.015, 0, o.mc || IRON, { seg: 16 }); f.rod("metal", [0, 0.02, 0], [0, 1.4, 0], 0.012, o.mc || IRON); f.cyl("glow", 0.2, 0.24, 0.3, 0, 1.52, 0, o.shade || 0xffe0b0, { uvr: WHITE, seg: 18, open: true }); f.cyl("glow", 0.195, 0.235, 0.29, 0, 1.52, 0, 0xfff0d8, { uvr: WHITE, seg: 18, open: true }); f.solid(0, 0, 0.36, 0.36, 0, 1.2); return f; }
  function pendant(K, x, z, top, y, o) { o = o || {}; var f = F(K, x, z, 0), st = o.style || "dome", mc = o.mc || BLACK;
    f.rod("metal", [0, top, 0], [0, y + 0.02, 0], 0.004, 0x202020, 4); f.cyl("metal", 0.035, 0.035, 0.02, 0, top - 0.01, 0, mc, { seg: 10 });
    if (st === "dome") { f.lathe("metal", [[0.0, 0.18], [0.04, 0.18], [0.14, 0.12], [0.2, 0.02], [0.21, 0.0]], 0, y - 0.18, 0, mc, { seg: 24 }); f.cyl("glow", 0.19, 0.19, 0.005, 0, y - 0.175, 0, 0xfff0d8, { uvr: WHITE, seg: 20 }); }
    else if (st === "globe") { f.sph("glow", o.r || 0.13, 0, y - (o.r || 0.13), 0, 0xffe9c8, { uvr: WHITE, ws: 16, hs: 10 }); f.cyl("metal", 0.03, 0.04, 0.04, 0, y, 0, mc, { seg: 10 }); }
    else if (st === "lantern") { f.cyl("metal", 0.0, 0.14, 0.08, 0, y - 0.04, 0, IRON, { seg: 6 }); [0, 1, 2, 3, 4, 5].forEach(function (k) { var a = k / 6 * TAU; f.rod("metal", [Math.cos(a) * 0.12, y - 0.08, Math.sin(a) * 0.12], [Math.cos(a) * 0.1, y - 0.36, Math.sin(a) * 0.1], 0.006, IRON); }); f.cyl("glow", 0.1, 0.09, 0.26, 0, y - 0.22, 0, 0xffc070, { uvr: WHITE, seg: 6 }); f.cyl("metal", 0.11, 0.11, 0.025, 0, y - 0.37, 0, IRON, { seg: 6 }); }
    else if (st === "rattan") { f.lathe("wood", [[0.0, 0.32], [0.05, 0.32], [0.16, 0.26], [0.24, 0.12], [0.26, 0.02], [0.25, 0.0]], 0, y - 0.32, 0, o.wc || 0xc9a46a, { seg: 20 }); f.cyl("glow", 0.23, 0.23, 0.005, 0, y - 0.315, 0, 0xffe0b0, { uvr: WHITE, seg: 18 }); f.sph("glow", 0.06, 0, y - 0.26, 0, BULB, { uvr: WHITE }); }
    else if (st === "bulb") { f.cyl("metal", 0.02, 0.02, 0.05, 0, y, 0, BRASS, { seg: 8 }); f.sph("glow", 0.055, 0, y - 0.07, 0, BULB, { uvr: WHITE, ws: 10, hs: 8 }); }
    return f; }
  // a wagon wheel (ranch), an iron ring of candles (lodge) or a linear bar (villa) hung from the ceiling
  function chandelier(K, x, z, top, y, o) { o = o || {}; var f = F(K, x, z, o.yaw || 0), st = o.style || "wheel";
    if (st === "wheel") { var R = 0.62; f.tor("wood", R, 0.035, 0, y, 0, 0x4a3020, { rx: HP, ts: 28, rs: 6 }); f.cyl("wood", 0.08, 0.08, 0.1, 0, y, 0, 0x4a3020, { seg: 10 }); for (var s = 0; s < 10; s++) { var a = s / 10 * TAU; f.rod("wood", [0, y, 0], [Math.cos(a) * R, y, Math.sin(a) * R], 0.016, 0x4a3020); }
      for (var c = 0; c < 8; c++) { var b = c / 8 * TAU + 0.2; f.cyl("matte", 0.022, 0.022, 0.1, Math.cos(b) * R, y + 0.08, Math.sin(b) * R, CREAM, { seg: 8 }); f.sph("glow", 0.035, Math.cos(b) * R, y + 0.17, Math.sin(b) * R, 0xffc878, { uvr: WHITE, ws: 8, hs: 6, sy: 1.5 }); }
      for (var ch = 0; ch < 3; ch++) { var d = ch / 3 * TAU; f.rod("metal", [Math.cos(d) * R * 0.98, y, Math.sin(d) * R * 0.98], [0, top, 0], 0.005, IRON, 4); } return f; }
    if (st === "ring") { var R2 = o.r || 0.75; for (var lv = 0; lv < 2; lv++) { var rr = R2 * (lv ? 0.6 : 1), yy = y + lv * 0.32; f.tor("metal", rr, 0.018, 0, yy, 0, IRON, { rx: HP, ts: 32 }); var nc = lv ? 6 : 10; for (var c2 = 0; c2 < nc; c2++) { var b2 = c2 / nc * TAU; f.cyl("metal", 0.03, 0.02, 0.04, Math.cos(b2) * rr, yy + 0.02, Math.sin(b2) * rr, IRON, { seg: 8 }); f.cyl("matte", 0.018, 0.018, 0.11, Math.cos(b2) * rr, yy + 0.09, Math.sin(b2) * rr, CREAM, { seg: 8 }); f.sph("glow", 0.026, Math.cos(b2) * rr, yy + 0.17, Math.sin(b2) * rr, 0xffc270, { uvr: WHITE, ws: 8, hs: 6, sy: 1.6 }); } }
      for (var ch2 = 0; ch2 < 4; ch2++) { var d2 = ch2 / 4 * TAU; f.rod("metal", [Math.cos(d2) * R2, y, Math.sin(d2) * R2], [0, y + 1.0, 0], 0.008, IRON); } f.rod("metal", [0, y + 1.0, 0], [0, top, 0], 0.012, IRON); return f; }
    var L = o.len || 1.8; f.box("metal", L, 0.05, 0.08, 0, y, 0, o.mc || BLACK); f.box("glow", L - 0.04, 0.01, 0.06, 0, y - 0.028, 0, 0xfff1dc, { uvr: WHITE }); [-1, 1].forEach(function (s2) { f.rod("metal", [s2 * (L / 2 - 0.1), y, 0], [s2 * (L / 2 - 0.1), top, 0], 0.004, 0x202020, 4); }); if (o.globes) for (var gk = 0; gk < 5; gk++) f.sph("glow", 0.07, -L / 2 + 0.2 + gk * (L - 0.4) / 4, y - 0.12, 0, 0xfff0d8, { uvr: WHITE, ws: 12, hs: 8 }); return f; }

  // rugs (rug atlas or the cowhide card), with their own floor shadow from what stands on them via the floor bake
  function rug(K, x, z, yaw, w, d, uvr, y) { var f = F(K, x, z, yaw); f.put("rug", planeG(w, d), 0, y || 0.012, 0, null, { rx: -HP, uvr: uvr, ao: false }); f.box("rug", w, 0.01, 0.012, 0, (y || 0.012) - 0.004, d / 2, shade(0xffffff, 0.6), { uvr: [uvr[0] + 0.01, uvr[1] + 0.01] }); f.box("rug", w, 0.01, 0.012, 0, (y || 0.012) - 0.004, -d / 2, shade(0xffffff, 0.6), { uvr: [uvr[0] + 0.01, uvr[1] + 0.01] }); return f; }
  function cowhide(K, x, z, yaw, s) { var f = F(K, x, z, yaw), w = 2.3 * (s || 1), d = w / LEAF_ASP.cowhide; f.put("leaf", planeG(w, d), 0, 0.014, 0, 0xffffff, { rx: -HP, uvr: AT.leaf.cowhide, ao: false }); return f; }

  // plants: a pot (terracotta, white, black, basket, stone) with crossed alpha cards of the generated foliage
  var POTC = { terra: [0xb5623a, "matte"], white: [0xf0ede6, "gloss"], black: [0x1f1d1b, "matte"], basket: [0xc9a46a, "wood"], stone: [0xb9b0a2, "trav"], sand: [0xd8c2a0, "matte"] };
  function pot(f, kind, r, h, lx, lz, ly) { var P = POTC[kind] || POTC.terra; var prof = kind === "basket" ? [[0, 0], [r * 0.8, 0], [r, h * 0.9], [r * 1.02, h], [r * 0.95, h]] : kind === "black" || kind === "white" ? [[0, 0], [r * 0.75, 0], [r * 0.92, h * 0.25], [r, h * 0.9], [r * 0.97, h]] : [[0, 0], [r * 0.7, 0], [r * 0.95, h * 0.85], [r * 1.05, h * 0.88], [r * 1.05, h], [r * 0.95, h]];
    f.lathe(P[1], prof, lx || 0, ly || 0, lz || 0, P[0], { seg: 18 }); f.cyl("matte", r * 0.93, r * 0.93, 0.01, lx || 0, (ly || 0) + h - 0.02, lz || 0, 0x3a2a1e, { seg: 14 }); }
  function plant(K, x, z, o) { o = o || {}; var f = F(K, x, z, o.yaw || 0, o.y || 0), kind = o.kind || "fig", h = o.h || 1.6, pr = o.pr || 0.24, ph = o.ph || 0.42, rot = o.rot || 0;
    if (!o.noPot) pot(f, o.pot || "terra", pr, ph, 0, 0);
    var uv = AT.leaf[kind], asp = LEAF_ASP[kind] || 1, ch = h - (o.noPot ? 0 : ph * 0.7), cw = ch * asp, y0 = o.noPot ? 0 : ph * 0.75, n = o.n || 3;
    for (var i = 0; i < n; i++) f.put("leaf", planeG(cw, ch), 0, y0 + ch / 2, 0, o.tint || 0xffffff, { ry: rot + i * PI / n, uvr: uv, ao: false });
    if (!o.noSolid) f.solid(0, 0, pr * 2, pr * 2, 0, ph + 0.3); f.occ(0, 0, pr * 2.2, pr * 2.2, 0.4, 0.5); return f; }
  function hanging(K, x, z, y, o) { o = o || {}; var f = F(K, x, z, o.yaw || 0, y), kind = o.kind || "pothos", L = o.len || 1.1, asp = LEAF_ASP[kind] || 0.4; pot(f, o.pot || "white", 0.14, 0.18, 0, 0); f.rod("metal", [0, 0.18, 0], [0, o.cord || 0.6, 0], 0.003, 0x3a3a3a, 3);
    for (var i = 0; i < 2; i++) f.put("leaf", planeG(L * asp, L), 0, 0.15 - L / 2, 0, 0xffffff, { ry: i * HP + 0.3, uvr: AT.leaf[kind], ao: false }); return f; }

  // books and small things
  var BOOKC = [0x7a2e22, 0x2e4a6a, 0x3e5a3a, 0xc9a46a, 0xe9e2d3, 0x1f1d1b, 0x8a5a2e, 0x5a3a5a, 0xb5623a, 0x6a7a8a];
  function books(f, n, lx, ly, lz, R, o) { o = o || {}; var x = lx; for (var i = 0; i < n; i++) { var h = 0.18 + R() * 0.1, t = 0.025 + R() * 0.035, d = 0.15 + R() * 0.05; if (o.flat) { f.box("matte", 0.2 + R() * 0.06, t, d + 0.02, lx, ly + t / 2 + i * 0.001, lz, BOOKC[Math.floor(R() * BOOKC.length)], { ry: (R() - 0.5) * 0.3 }); ly += t; } else { f.box("matte", t, h, d, x + t / 2, ly + h / 2, lz, BOOKC[Math.floor(R() * BOOKC.length)], { rz: i === n - 1 && R() < 0.5 ? 0.25 : 0 }); x += t + 0.002; } } return x; }
  function vase(f, lx, ly, lz, c, h, kind) { h = h || 0.3; var prof = kind === 1 ? [[0, 0], [0.06, 0], [0.11, h * 0.35], [0.05, h * 0.85], [0.06, h]] : kind === 2 ? [[0, 0], [0.09, 0], [0.12, h * 0.5], [0.09, h * 0.9], [0.1, h]] : [[0, 0], [0.05, 0], [0.08, h * 0.6], [0.03, h * 0.92], [0.04, h]]; f.lathe("gloss", prof, lx, ly, lz, c, { seg: 16 }); }
  function bowl(f, lx, ly, lz, r, c, fruit) { f.lathe("gloss", [[0, 0], [r * 0.5, 0], [r, r * 0.5], [r * 1.02, r * 0.55], [r * 0.95, r * 0.5], [r * 0.4, r * 0.1]], lx, ly, lz, c, { seg: 18 }); if (fruit) for (var i = 0; i < 5; i++) { var a = i * 1.3; f.sph("gloss", 0.04, lx + Math.cos(a) * r * 0.45, ly + r * 0.42 + (i === 4 ? 0.04 : 0), lz + Math.sin(a) * r * 0.45, [0xe04a3a, 0xf2a934, 0x8cc63f, 0xe8c040, 0xd0402a][i], { ws: 8, hs: 6 }); } }
  function mug(f, lx, ly, lz, c) { f.cyl("gloss", 0.04, 0.036, 0.09, lx, ly + 0.045, lz, c, { seg: 12 }); f.tor("gloss", 0.025, 0.007, lx + 0.045, ly + 0.05, lz, c, { ts: 8, rs: 4 }); f.cyl("matte", 0.035, 0.035, 0.005, lx, ly + 0.085, lz, 0x3a2414, { seg: 10 }); }
  function candle(f, lx, ly, lz, h) { f.cyl("matte", 0.03, 0.03, h || 0.12, lx, ly + (h || 0.12) / 2, lz, CREAM, { seg: 10 }); f.sph("glow", 0.012, lx, ly + (h || 0.12) + 0.02, lz, 0xffc060, { uvr: WHITE, ws: 6, hs: 5, sy: 1.8 }); }
  // framed art on a wall: the frame (wood, black, brass), a mat, the picture (art atlas)
  function art(K, x, z, yaw, y, key, w, o) { o = o || {}; var f = F(K, x, z, yaw, y), r = AT.art[key]; if (!r) return f; var asp = (r[2] - r[0]) * 2048 / ((r[3] - r[1]) * 2048), h = o.h || w / asp; if (o.h) w = h * asp; var fr = o.frame === undefined ? 0.04 : o.frame, mat = o.mat || 0;
    if (fr > 0) f.box(o.fm || "wood", w + 2 * (fr + mat), h + 2 * (fr + mat), 0.035, 0, 0, 0.018, o.fc || 0x2a1e16, { ao: false }); if (mat > 0) f.box("matte", w + 2 * mat, h + 2 * mat, 0.01, 0, 0, 0.037, 0xf4f1ea, { ao: false });
    f.quad("art", w, h, 0, 0, fr > 0 ? 0.044 : 0.02, 0xffffff, r); if (fr === 0) f.box("wood", w, h, 0.03, 0, 0, 0.004, 0x3a2e24, { ao: false }); return f; }

  // ───────────────────────── the shell: a floor and ceiling with baked shade, walls with real openings, windows onto painted desert vistas ─────────────────────────
  // node-sampled grids: fn is evaluated once per grid node (not per vertex)
  function nodeGrid(nx, nz, fn, x0, z0, x1, z1) { var T = new Float32Array((nx + 1) * (nz + 1)); for (var j = 0; j <= nz; j++) for (var i = 0; i <= nx; i++) T[j * (nx + 1) + i] = fn ? fn(x0 + (x1 - x0) * i / nx, z0 + (z1 - z0) * j / nz) : 1; return T; }
  function gridXZn(x0, z0, x1, z1, cell, fn, down) { var nx = Math.max(1, Math.round((x1 - x0) / cell)), nz = Math.max(1, Math.round((z1 - z0) / cell)), T = nodeGrid(nx, nz, fn, x0, z0, x1, z1);
    return gridXZ(x0, z0, x1, z1, nx, nz, function (x, z) { var i = Math.round((x - x0) / (x1 - x0) * nx), j = Math.round((z - z0) / (z1 - z0) * nz); return T[j * (nx + 1) + i]; }, down); }
  function gridUYn(u0, u1, y0, y1, cell, fn) { var nu = Math.max(1, Math.round((u1 - u0) / cell)), ny = Math.max(1, Math.round((y1 - y0) / cell)), T = nodeGrid(nu, ny, fn, u0, y0, u1, y1);
    return gridUY(u0, u1, y0, y1, nu, ny, function (u, y) { var i = Math.round((u - u0) / (u1 - u0) * nu), j = Math.round((y - y0) / (y1 - y0) * ny); return T[j * (nu + 1) + i]; }); }
  // floor shade: walls and every furniture footprint the pieces registered (K.occ)
  function floorAO(K, h) { var O = K.occ; return function (x, z) { var k = 1 - 0.3 * Math.exp(-(h - Math.abs(x)) / 0.45); k *= 1 - 0.3 * Math.exp(-(h - Math.abs(z)) / 0.45);
      for (var i = 0; i < O.length; i++) { var q = O[i], dx = x - q[0], dz = z - q[1], c = Math.cos(q[4]), s = Math.sin(q[4]), lx = dx * c - dz * s, lz = dx * s + dz * c, ex = Math.max(Math.abs(lx) - q[2], 0), ez = Math.max(Math.abs(lz) - q[3], 0), d = Math.sqrt(ex * ex + ez * ez); if (d > 1.2) continue;
        var rad = 0.12 + 0.22 * Math.min(q[5], 1.2); k *= 1 - q[6] * (d === 0 ? 0.42 : 0.42 * Math.exp(-d / rad)); }
      return clamp(k, 0.3, 1); }; }
  function wallAO(h, H) { return function (u, y) { var k = 1 - 0.3 * Math.exp(-y / 0.32); k *= 1 - 0.18 * Math.exp(-(H - y) / 0.45); k *= 1 - 0.22 * Math.exp(-(h - Math.abs(u)) / 0.5); return k; }; }
  // a wall frame: origin, yaw (local +z points into the room) and how a room coordinate along the wall maps to its local u
  function wallFrame(K, side, h) { var s = side; if (K.mir < 0 && (s === "L" || s === "R")) s = s === "L" ? "R" : "L";
    if (s === "B") return { s: s, x: 0, z: -h, yaw: 0, u: function (a) { return a * K.mir; } };
    if (s === "F") return { s: s, x: 0, z: h, yaw: PI, u: function (a) { return -a * K.mir; } };
    if (s === "L") return { s: s, x: -h, z: 0, yaw: HP, u: function (a) { return -a; } };
    return { s: s, x: h, z: 0, yaw: -HP, u: function (a) { return a; } }; }
  // ops: [{ a0, a1, y0, y1, kind }] along the wall's room axis (x for B and F, z for L and R), before the mirror
  function wall(K, side, h, H, key, ops, o) { o = o || {}; var W = wallFrame(K, side, h), f = F(K, W.x, W.z, W.yaw, 0, true), ins = 0.1, ao = wallAO(h, H), tint = o.tint || 0xffffff;
    var list = (ops || []).map(function (q) { var u0 = W.u(q.a0), u1 = W.u(q.a1); return Object.assign({}, q, { u0: Math.min(u0, u1), u1: Math.max(u0, u1) }); }).sort(function (a, b) { return a.u0 - b.u0; });
    var seg = function (u0, u1, y0, y1) { if (u1 - u0 < 0.005 || y1 - y0 < 0.005) return; f.put(key, gridUYn(u0, u1, y0, y1, 0.6, ao), 0, 0, ins, tint, { ao: false }); var M = mtx((u0 + u1) / 2, (y0 + y1) / 2, -0.05); M.premultiply(mtx(W.x, 0, W.z, W.yaw)); K.cast.push([planeG(u1 - u0, y1 - y0), M]); };
    var u = -h; list.forEach(function (q) { seg(u, q.u0, 0, H); seg(q.u0, q.u1, 0, q.y0); seg(q.u0, q.u1, q.y1, H); u = q.u1;
      // reveals: the wall's depth shows in the opening
      var dj = 0.2, jc = o.jamb || tint, jk = o.jambKey || key; f.box(jk, 0.02, q.y1 - q.y0, dj, q.u0 - 0.01, (q.y0 + q.y1) / 2, 0, jc, { ao: false }); f.box(jk, 0.02, q.y1 - q.y0, dj, q.u1 + 0.01, (q.y0 + q.y1) / 2, 0, jc, { ao: false });
      if (q.y1 < H - 0.01) f.box(jk, q.u1 - q.u0 + 0.04, 0.02, dj, (q.u0 + q.u1) / 2, q.y1 + 0.01, 0, jc, { ao: false }); if (q.y0 > 0.01) f.box(jk, q.u1 - q.u0 + 0.04, 0.02, dj, (q.u0 + q.u1) / 2, q.y0 - 0.01, 0, jc, { ao: false });
      if (q.kind && q.kind !== "door" && q.kind !== "open") { windowK(f, q, o); var A0 = W.s === "B" || W.s === "R" ? q.u0 : -q.u1, A1 = W.s === "B" || W.s === "R" ? q.u1 : -q.u0; K.portals.push([W.s === "B" || W.s === "F" ? "x" : "z", W.s === "B" ? -h : W.s === "F" ? h : W.s === "L" ? -h : h, A0, A1, q.y0, q.y1]); } });
    seg(u, h, 0, H);
    if (o.base) { var bu = -h; list.concat([{ u0: h, u1: h, y0: 0 }]).forEach(function (q) { if (q.y0 < 0.05) { if (q.u0 - bu > 0.02) f.box(o.baseKey || "wood", q.u0 - bu, o.base, 0.02, (bu + q.u0) / 2, o.base / 2, ins + 0.01, o.baseC || 0x3a2a1e, { ao: false }); bu = q.u1; } }); }
    if (o.vista && list.some(function (q) { return q.kind && q.kind !== "door" && q.kind !== "open"; })) vistaK(f, h, o.vista, W.s, o.vh);
    return W; }
  // window furniture in an opening: a frame, mullions and the glass (kinds: steel, wood6, lodge, tent)
  function windowK(f, q, o) { var w = q.u1 - q.u0, hh = q.y1 - q.y0, cu = (q.u0 + q.u1) / 2, cy = (q.y0 + q.y1) / 2, k = q.kind, fc = o.frameC || (k === "steel" ? 0x1b1a19 : 0x5a3e2b), fk = k === "steel" ? "metal" : "wood";
    f.quad("glass", w, hh, cu, cy, 0.0, null, null, { ao: false });
    if (k === "tent") { var bc = o.flapC || 0xd8cbb4; f.cyl("canvas", 0.085, 0.085, w + 0.16, cu, q.y1 + 0.1, 0.13, bc, { rz: HP, seg: 12, ao: false }); [-1, 1].forEach(function (s) { f.box("leather", 0.035, 0.3, 0.012, cu + s * w * 0.32, q.y1 + 0.05, 0.225, 0x6a3c22, { ao: false }); f.box("canvas", 0.05, hh + 0.04, 0.02, s > 0 ? q.u1 : q.u0, cy, 0.105, shade(bc, 0.85), { ao: false }); });
      f.box("canvas", w + 0.06, 0.05, 0.02, cu, q.y0, 0.105, shade(bc, 0.85), { ao: false }); for (var mg = 1; mg < 4; mg++) f.box("matte", w, 0.004, 0.004, cu, q.y0 + hh * mg / 4, 0.01, 0x3a3a3a, { ao: false }); for (var mv = 1; mv < Math.round(w / 0.3); mv++) f.box("matte", 0.004, hh, 0.004, q.u0 + mv * 0.3, cy, 0.01, 0x3a3a3a, { ao: false }); return; }
    var t = k === "steel" ? 0.045 : 0.07, d = k === "steel" ? 0.06 : 0.1;
    f.box(fk, w, t, d, cu, q.y0 + t / 2, 0.02, fc, { ao: false }); f.box(fk, w, t, d, cu, q.y1 - t / 2, 0.02, fc, { ao: false }); f.box(fk, t, hh, d, q.u0 + t / 2, cy, 0.02, fc, { ao: false }); f.box(fk, t, hh, d, q.u1 - t / 2, cy, 0.02, fc, { ao: false });
    if (k === "steel") { var nm = Math.max(1, Math.round(w / 1.1)); for (var i = 1; i < nm; i++) f.box("metal", 0.035, hh, 0.05, q.u0 + w * i / nm, cy, 0.02, fc, { ao: false }); if (hh > 2.2) f.box("metal", w, 0.035, 0.05, cu, q.y1 - 0.5, 0.02, fc, { ao: false }); }
    else if (k === "wood6" || k === "lodge") { var nc = Math.max(2, Math.round(w / 0.45)), nr = Math.max(2, Math.round(hh / 0.45)); for (var c2 = 1; c2 < nc; c2++) f.box("wood", 0.03, hh, 0.04, q.u0 + w * c2 / nc, cy, 0.03, fc, { ao: false }); for (var r2 = 1; r2 < nr; r2++) f.box("wood", w, 0.03, 0.04, cu, q.y0 + hh * r2 / nr, 0.03, fc, { ao: false });
      f.box("wood", w + 0.12, 0.04, 0.2, cu, q.y0 - 0.02, 0.12, o.sillC || fc, { ao: false }); }
    if (o.curtain && k !== "tent") [-1, 1].forEach(function (s) { f.put("fabric", drapeG(0.55, Math.min(o.curtainH || 2.6, q.y1 + 0.3), 0.14, 0.035), cu + s * (w / 2 + 0.25), 0, 0.2, o.curtain, { ao: false }); }); }
  var DRP = {};
  function drapeG(w, h, p, amp) { var key = [w, h, p, amp].map(f3).join(","); return cache("d" + key, function () { var nx = Math.max(8, Math.round(w / p * 6)), ny = 6, P = [], U = [], idx = [];
    for (var j = 0; j <= ny; j++) { var y = h * j / ny; for (var i = 0; i <= nx; i++) { var x = -w / 2 + w * i / nx; P.push(x, y, amp * Math.sin(x / p * TAU) * (0.75 + 0.25 * j / ny)); U.push(x, y); } }
    for (var j2 = 0; j2 < ny; j2++) for (var i2 = 0; i2 < nx; i2++) { var a = j2 * (nx + 1) + i2, b = a + 1, c2 = a + nx + 1, d2 = c2 + 1; idx.push(a, b, c2, b, d2, c2); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.setIndex(idx); g.computeVertexNormals(); return g; }); }
  // the painted desert beyond a wall: one big unlit card 7 m outside, its slice of the panorama picked by the wall side
  var VSL = { B: [0.08, 0.92], L: [0.0, 0.62], R: [0.38, 1.0], F: [0.2, 0.8] };
  function vistaK(f, h, key, side, vh) { var Wd = 2 * h + 18, Hd = 13, sl = VSL[side] || [0, 1], asp = 2048 / 878, du = Math.min(sl[1] - sl[0], (Wd / Hd) / asp), u0 = (sl[0] + sl[1]) / 2 - du / 2, horizon = vh || 0.5;
    f.quad(key, Wd, Hd, 0, 1.75 - (horizon - 0.5) * Hd, -7.2, 0xffffff, [u0, 0, u0 + du, 1], { ao: false }); }
  // a ceiling over the whole room, shaded toward the walls (or a pitched canvas roof for the tent)
  function ceilingK(K, h, H, key, tint) { K.cast.push([planeG(2 * h + 0.4, 2 * h + 0.4), mtx(0, H + 0.08, 0, 0, HP)]); var f = F(K, 0, 0, 0, 0, true); f.put(key, gridXZn(-h, -h, h, h, 0.8, function (x, z) { var k = 1 - 0.22 * Math.exp(-(h - Math.abs(x)) / 0.6); return k * (1 - 0.22 * Math.exp(-(h - Math.abs(z)) / 0.6)); }, true), 0, H, 0, tint || 0xffffff, { ao: false }); }
  function floorK(K, h, key, tint) { var f = F(K, 0, 0, 0, 0, true); f.put(key, gridXZn(-h, -h, h, h, 0.4, floorAO(K, h)), 0, 0, 0, tint || 0xffffff, { ao: false }); }
  // the front door: trim round the client's 2.2 m opening and two leaves standing open against the inside of the front wall
  function doorK(K, h, o) { o = o || {}; var f = F(K, 0, h - 0.1, PI, 0, true), tc = o.trim || 0x3a2a1e, lc = o.leaf || 0x5a3e2b, dk = o.leafKey || "wood";
    f.box("wood", 0.12, 2.5, 0.04, -1.16, 1.25, 0.02, tc, { ao: false }); f.box("wood", 0.12, 2.5, 0.04, 1.16, 1.25, 0.02, tc, { ao: false }); f.box("wood", 2.44, 0.12, 0.04, 0, 2.46, 0.02, tc, { ao: false });
    if (o.none) return; [-1, 1].forEach(function (s) { var x0 = s * 1.68; f.box(dk, 1.08, 2.36, 0.05, x0, 1.19, 0.08, lc, { ao: false }); if (o.panels) for (var p = 0; p < 2; p++) f.box(dk, 0.78, 0.86, 0.02, x0, 0.66 + p * 1.04, 0.115, shade(lc, 0.82), { ao: false });
      f.cyl("metal", 0.014, 0.014, 0.55, x0 - s * 0.42, 1.1, 0.13, o.handle || BRASS, { seg: 8 }); }); }

  // ───────────────────────── assemblies: a kitchen run, an island, fireplaces and the stove, beds, shelves, dining sets, decor groups ─────────────────────────
  // a kitchen run against a wall, centred at (x, z) facing yaw, modules left to right: base, drawers, sink, range, tall, dish
  function kitchenRun(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), mods = o.mods || ["tall", "base", "sink", "base", "range", "drawers", "base"], wd = { tall: 0.9, base: 0.6, drawers: 0.6, sink: 0.9, range: 0.9, dish: 0.6 };
    var L = 0; mods.forEach(function (m) { L += wd[m]; }); var cab = o.cab || 0x5a3e2b, ck = o.cabKey || "wood", top = o.top || 0xe9e3d8, tk = o.topKey || "trav", pc = o.pull || BRASS, D = 0.6, H = o.hgt || 4.4, R = o.R || Math.random;
    var u = -L / 2, sinkU = 0, rangeU = 0;
    mods.forEach(function (m) { var w = wd[m], cu = u + w / 2;
      if (m === "tall") { f.box(ck, w - 0.006, 2.3, D, cu, 1.15, 0, cab); f.box(ck, w / 2 - 0.01, 2.2, 0.02, cu - w / 4, 1.15, D / 2 + 0.01, shade(cab, 0.94)); f.box(ck, w / 2 - 0.01, 2.2, 0.02, cu + w / 4, 1.15, D / 2 + 0.01, shade(cab, 0.94)); f.box("metal", 0.02, 0.6, 0.03, cu - 0.04, 1.2, D / 2 + 0.035, pc); f.box("metal", 0.02, 0.6, 0.03, cu + 0.04, 1.2, D / 2 + 0.035, pc); f.solid(cu, 0, w, D, 0, 2.3); }
      else { f.box("matte", w, 0.1, D - 0.06, cu, 0.05, -0.03, 0x1b1916); f.box(ck, w - 0.004, 0.78, D - 0.02, cu, 0.49, -0.01, cab);
        if (m === "range") { f.box("metal", w - 0.02, 0.8, 0.04, cu, 0.5, D / 2 - 0.01, o.rangeC || 0x2b2a29); f.box("gloss", w - 0.2, 0.36, 0.02, cu, 0.42, D / 2 + 0.015, 0x0e0d0c); f.box("metal", w - 0.24, 0.025, 0.04, cu, 0.66, D / 2 + 0.04, CHROME); for (var k = 0; k < 5; k++) f.cyl("metal", 0.022, 0.022, 0.03, cu - 0.3 + k * 0.15, 0.82, D / 2 + 0.03, CHROME, { rx: HP, seg: 10 }); rangeU = cu; }
        else if (m === "drawers") { for (var d = 0; d < 3; d++) { f.box(ck, w - 0.012, 0.24, 0.02, cu, 0.24 + d * 0.255, D / 2 - 0.0, shade(cab, 0.95)); f.box("metal", 0.2, 0.015, 0.025, cu, 0.32 + d * 0.255, D / 2 + 0.02, pc); } }
        else { f.box(ck, w / 2 - 0.008, 0.72, 0.02, cu - w / 4, 0.48, D / 2, shade(cab, 0.95)); f.box(ck, w / 2 - 0.008, 0.72, 0.02, cu + w / 4, 0.48, D / 2, shade(cab, 0.95)); f.box("metal", 0.015, 0.16, 0.025, cu - 0.04, 0.72, D / 2 + 0.02, pc); f.box("metal", 0.015, 0.16, 0.025, cu + 0.04, 0.72, D / 2 + 0.02, pc); if (m === "sink") sinkU = cu; }
        f.solid(cu, 0, w, D, 0, 0.92); }
      u += w; });
    // the worktop with a sink and a cooktop, a splashback, the hood and the shelves or wall cabinets above
    var tops = [], u2 = -L / 2; mods.forEach(function (m) { if (m !== "tall") tops.push([u2, u2 + wd[m]]); u2 += wd[m]; }); var t0 = tops.length ? tops[0][0] : 0, t1 = tops.length ? tops[tops.length - 1][1] : 0;
    f.box(tk, t1 - t0 + 0.02, 0.04, D + 0.03, (t0 + t1) / 2, 0.9, 0.01, top);
    if (sinkU) { f.box("matte", 0.62, 0.02, 0.4, sinkU, 0.915, 0.03, 0x2a2826); f.box("metal", 0.58, 0.18, 0.02, sinkU, 0.83, 0.23, 0xd9d6d0); f.rod("metal", [sinkU, 0.92, -0.2], [sinkU, 1.22, -0.2], 0.014, o.tap || CHROME); f.tor("metal", 0.1, 0.012, sinkU, 1.22, -0.1, o.tap || CHROME, { arc: PI, ry: HP, rz: 0, ts: 10 }); f.cyl("metal", 0.02, 0.02, 0.06, sinkU + 0.1, 0.95, -0.2, o.tap || CHROME, { seg: 8 }); }
    if (rangeU) { f.box("matte", 0.86, 0.015, 0.56, rangeU, 0.925, 0.02, 0x121110); for (var b = 0; b < 4; b++) f.tor("metal", 0.07, 0.012, rangeU + (b % 2 ? 0.2 : -0.2), 0.94, (b < 2 ? -0.12 : 0.14), 0x3a3836, { rx: HP, ts: 14 });
      if (o.hood === "plaster") { f.box(o.hoodKey || "plaster", 1.0, 0.7, 0.55, rangeU, 2.05, -0.02, o.hoodC || 0xf0ebe2); f.box(o.hoodKey || "plaster", 0.6, H - 2.4, 0.4, rangeU, 2.4 + (H - 2.4) / 2, -0.1, o.hoodC || 0xf0ebe2); f.box("wood", 1.04, 0.06, 0.58, rangeU, 1.72, 0, o.hoodTrim || 0x5a3e2b); }
      else { f.lathe("metal", [[0.0, 0.5], [0.16, 0.5], [0.5, 0.06], [0.52, 0.0]], rangeU, 1.62, -0.02, o.hoodC || 0x2b2a29, { seg: 4, p0: PI / 4, sz: 0.62 }); f.box("metal", 0.32, H - 2.12, 0.28, rangeU, 2.12 + (H - 2.12) / 2, -0.1, o.hoodC || 0x2b2a29); } }
    if (o.splash !== false) f.box(o.splashKey || "gloss", t1 - t0, o.splashH || 0.62, 0.015, (t0 + t1) / 2, 0.92 + (o.splashH || 0.62) / 2, -D / 2 + 0.008, o.splashC || 0xece7dd);
    if (o.uppers === "shelves") { var shW = (t1 - t0) - (rangeU ? 1.2 : 0), segs = rangeU ? [[t0, rangeU - 0.6], [rangeU + 0.6, t1]] : [[t0, t1]];
      segs.forEach(function (sg) { var w = sg[1] - sg[0]; if (w < 0.5) return; var cu = (sg[0] + sg[1]) / 2; f.quad("stock", w - 0.04, 0.98, cu, 1.98, -D / 2 + 0.03, 0xffffff, o.stock || AT.stock.kitchen); [1.56, 2.02, 2.48].forEach(function (yy) { f.box(o.shelfKey || "wood", w, 0.04, 0.3, cu, yy, -D / 2 + 0.16, o.shelfC || cab); }); }); }
    else if (o.uppers === "cabinets") { var segs2 = rangeU ? [[t0, rangeU - 0.55], [rangeU + 0.55, t1]] : [[t0, t1]]; segs2.forEach(function (sg) { var w = sg[1] - sg[0]; if (w < 0.4) return; var cu = (sg[0] + sg[1]) / 2; f.box(ck, w, 0.8, 0.36, cu, 1.95, -D / 2 + 0.18, cab); var nd = Math.max(1, Math.round(w / 0.45)); for (var q = 0; q < nd; q++) { f.box(ck, w / nd - 0.01, 0.76, 0.02, sg[0] + (q + 0.5) * w / nd, 1.95, -D / 2 + 0.37, shade(cab, 0.95)); f.box("metal", 0.015, 0.14, 0.025, sg[0] + (q + 0.5) * w / nd + (q % 2 ? -1 : 1) * (w / nd / 2 - 0.06), 1.66, -D / 2 + 0.39, pc); } f.box("glow", w - 0.04, 0.012, 0.03, cu, 1.545, -D / 2 + 0.3, 0xfff1dc, { uvr: WHITE }); }); }
    // the counter top, lived in: a kettle, a coffee machine or a pour-over, a board and bread, jars, a crock of utensils, a herb pot, fruit
    var cy = 0.92, spots = []; for (var uu = t0 + 0.3; uu < t1 - 0.25; uu += 0.5) { if (Math.abs(uu - sinkU) < 0.45 || Math.abs(uu - rangeU) < 0.5) continue; spots.push(uu); }
    spots.forEach(function (su, i) { var kk = (i + (o.seed || 0)) % 6;
      if (kk === 0) { f.lathe("gloss", [[0, 0], [0.09, 0], [0.1, 0.12], [0.07, 0.2], [0.02, 0.22], [0, 0.22]], su, cy, -0.1, o.kettle || 0x2e4a3e, { seg: 14 }); f.tor("gloss", 0.06, 0.008, su, cy + 0.22, -0.1, 0x1b1a19, { arc: PI, ts: 8 }); }
      else if (kk === 1) { f.box("wood", 0.42, 0.025, 0.28, su, cy + 0.012, 0.0, 0xb08a5e, { ry: 0.2 }); f.lathe("matte", [[0, 0], [0.12, 0], [0.13, 0.04], [0.1, 0.09], [0, 0.1]], su - 0.04, cy + 0.025, 0.0, 0xc9894a, { seg: 12, sz: 0.6 }); }
      else if (kk === 2) { for (var j = 0; j < 3; j++) { f.cyl("glass", 0.055, 0.055, 0.2 - j * 0.03, su - 0.12 + j * 0.12, cy + 0.1 - j * 0.015, -0.18, null, { seg: 12 }); f.cyl("matte", 0.05, 0.05, 0.12 - j * 0.02, su - 0.12 + j * 0.12, cy + 0.06, -0.18, [0xe8d8b0, 0x8a5a2e, 0xc9b26a][j], { seg: 12 }); f.cyl("wood", 0.058, 0.058, 0.02, su - 0.12 + j * 0.12, cy + 0.2 - j * 0.03, -0.18, 0xb08a5e, { seg: 12 }); } }
      else if (kk === 3) { f.cyl("gloss", 0.06, 0.055, 0.16, su, cy + 0.08, -0.15, 0xf0ede6, { seg: 12 }); for (var t = 0; t < 4; t++) f.rod("wood", [su, cy + 0.1, -0.15], [su + (t - 1.5) * 0.03, cy + 0.36, -0.15 + (t % 2 ? 0.02 : -0.02)], 0.008, 0x6a4a30); }
      else if (kk === 4) { pot(f, "terra", 0.07, 0.11, su, -0.12, cy); f.put("leaf", planeG(0.22, 0.24), su, cy + 0.2, -0.12, 0x9fd08a, { uvr: AT.leaf.olive, ao: false }); f.put("leaf", planeG(0.22, 0.24), su, cy + 0.2, -0.12, 0x9fd08a, { uvr: AT.leaf.olive, ry: HP, ao: false }); }
      else { bowl(f, su, cy, 0.0, 0.14, o.bowlC || 0xe9e3d8, true); } });
    f.occ(0, 0, L, D, 0.9, 0.8); f.hot(spots.length ? spots[0] : 0, 0.6, 1.5, "coffee"); return { f: f, L: L, rangeU: rangeU, sinkU: sinkU }; }
  // an island: drawers on the kitchen side, a panel on the stool side, the worktop overhanging the stools, pendants over it
  function island(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), L = o.len || 2.6, D = o.d || 0.95, cab = o.cab || 0x5a3e2b, ck = o.cabKey || "wood", top = o.top || 0xe9e3d8, tk = o.topKey || "trav", H = o.hgt || 4.4;
    f.box("matte", L - 0.1, 0.1, D - 0.12, 0, 0.05, 0, 0x1b1916); f.box(ck, L, 0.8, D - 0.02, 0, 0.5, 0, cab);
    for (var i = 0; i < Math.round(L / 0.6); i++) { var cu = -L / 2 + (i + 0.5) * L / Math.round(L / 0.6); f.box(ck, L / Math.round(L / 0.6) - 0.012, 0.72, 0.02, cu, 0.48, -D / 2, shade(cab, 0.95)); f.box("metal", 0.16, 0.015, 0.025, cu, 0.78, -D / 2 - 0.02, o.pull || BRASS); }
    if (o.waterfall) { f.box(tk, L + 0.04, 0.05, D + 0.28, 0, 0.915, 0.14, top); [-1, 1].forEach(function (s) { f.box(tk, 0.05, 0.89, D + 0.28, s * (L / 2 + 0.045), 0.445, 0.14, top); }); }
    else { f.box(tk, L + 0.1, 0.05, D + 0.3, 0, 0.915, 0.15, top); if (o.legs) [-1, 1].forEach(function (s) { f.box("wood", 0.09, 0.89, 0.09, s * (L / 2 - 0.02), 0.445, D / 2 + 0.22, cab); }); }
    // on top: a bowl of fruit, a vase of stems or a tray
    bowl(f, -L * 0.22, 0.94, 0.12, 0.16, o.bowlC || 0x2b2a29, true); vase(f, L * 0.25, 0.94, 0.05, o.vaseC || 0xd8c2a0, 0.28, 1); f.put("leaf", planeG(0.32, 0.5), L * 0.25, 1.36, 0.05, 0xffffff, { uvr: AT.leaf.eucalyptus, ao: false }); f.put("leaf", planeG(0.32, 0.5), L * 0.25, 1.36, 0.05, 0xffffff, { uvr: AT.leaf.eucalyptus, ry: HP, ao: false });
    var n = o.stools === undefined ? Math.max(2, Math.round(L / 0.75)) : o.stools;
    var sp = L / n; for (var s3 = 0; s3 < n; s3++) { var p = f.w(-L / 2 + sp * (s3 + 0.5), D / 2 + 0.55); var st = stoolAt(K, p[0], p[1], f.yaw + PI, o.stool || {}); }
    if (o.pendants !== false) { var np = o.np || (L > 2.2 ? 3 : 2), ps = o.pstyle || "globe"; for (var q = 0; q < np; q++) { var pp = f.w(-L / 2 + L * (q + 0.5) / np, 0.05); pendantRaw(K, pp[0], pp[1], H, 2.0, { style: ps, mc: o.pmc, r: o.pr, wc: o.pwc }); } }
    f.solid(0, 0.1, L + 0.1, D + 0.3, 0, 0.94); f.occ(0, 0, L, D, 0.9, 0.8); return f; }
  // place in raw room coordinates (an assembly already resolved the mirror)
  function stoolAt(K, x, z, yaw, o) { var m = K.mir; K.mir = 1; try { return stool(K, x, z, yaw, o); } finally { K.mir = m; } }
  function pendantRaw(K, x, z, top, y, o) { var m = K.mir; K.mir = 1; try { return pendant(K, x, z, top, y, o); } finally { K.mir = m; } }
  function rawCall(K, fn) { var m = K.mir; K.mir = 1; try { return fn(); } finally { K.mir = m; } }
  // fireplaces: linear (in a stone wall, villa), stone (a chimney breast with a raised hearth, ranch and lodge), the glamp's wood stove
  function fireplace(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), st = o.style || "stone", H = o.hgt || 4.4, sk = o.stoneKey || "stoneF", sc = o.stoneC || 0xffffff;
    if (st === "linear") { var W = o.w || 3.4, D = 0.32; f.box(sk, W, H, D, 0, H / 2, -D / 2 + 0.02, sc); f.box("matte", 1.9, 0.5, 0.04, 0, 0.62, 0.025, 0x0b0a09); f.box("metal", 1.98, 0.03, 0.06, 0, 0.885, 0.03, o.trim || 0x6b5a48); f.box("metal", 1.98, 0.03, 0.06, 0, 0.355, 0.03, o.trim || 0x6b5a48);
      FIRE(K, f, 0, 0.6, 0.06, 1.85, 0.44); f.box("matte", 1.8, 0.06, 0.1, 0, 0.4, 0.0, 0x222020); for (var c = 0; c < 9; c++) f.sph("matte", 0.035, -0.8 + c * 0.2, 0.43, 0.03, 0x9a948c, { ws: 6, hs: 4, sy: 0.6 });
      f.box("wood", W + 0.6, 0.1, 0.46, 0, 0.28, 0.23, o.bench || 0x5a3e2b); f.box("wood", W + 0.6, 0.01, 0.42, 0, 0.226, 0.23, shade(o.bench || 0x5a3e2b, 0.6)); f.solid(0, 0.23, W + 0.6, 0.46, 0, 0.33, { seat: true }); f.solid(0, -0.14, W, 0.3, 0, H);
      f.hot(0, 0.9, 1.6, "fire"); return f; }
    if (st === "stove") { var hz = o.hearth || [1.2, 1.1]; f.box("stoneF", hz[0], 0.06, hz[1], 0, 0.03, 0, o.hearthC || 0xd8cfc4); legs4(f, "metal", 0.5, 0.42, 0.18, 0.02, IRON, 0.04); f.rb("metal", 0.58, 0.56, 0.5, 0.03, 0, 0.46, 0, IRON); f.box("matte", 0.34, 0.26, 0.01, 0, 0.46, 0.253, 0x110c08); FIRE(K, f, 0, 0.45, 0.259, 0.32, 0.24);
      [[0, 0.155, 0.42, 0.05], [0, -0.155, 0.42, 0.05]].forEach(function (q) { f.box("metal", q[2], q[3], 0.02, q[0], 0.46 + q[1], 0.262, IRON); }); [-1, 1].forEach(function (s) { f.box("metal", 0.05, 0.36, 0.02, s * 0.185, 0.46, 0.262, IRON); }); f.box("metal", 0.06, 0.06, 0.02, 0.24, 0.46, 0.27, BRASS); f.cyl("metal", 0.08, 0.08, (o.pipe || 3.2) - 0.74, 0, 0.74 + ((o.pipe || 3.2) - 0.74) / 2, -0.05, IRON, { seg: 12 }); f.cyl("metal", 0.1, 0.1, 0.05, 0, 0.75, -0.05, IRON, { seg: 12 });
      // the opening that frames the window: a grate drawn over the glass
      for (var g = 0; g < 4; g++) f.box("metal", 0.01, 0.26, 0.01, -0.12 + g * 0.08, 0.46, 0.268, IRON); f.cyl("metal", 0.1, 0.1, 0.02, 0.0, 0.76, 0.0, IRON, { seg: 14 }); f.lathe("metal", [[0, 0], [0.09, 0], [0.1, 0.1], [0.06, 0.16], [0, 0.16]], 0.15, 0.75, 0.05, 0x3a3836, { seg: 10 });
      logs(f, 0.62, 0, 0.28, 3); f.solid(0, 0, 0.62, 0.55, 0, 0.75); f.occ(0, 0, 0.7, 0.6, 0.7, 0.8); f.hot(0, 0.8, 1.5, "stove"); return f; }
    var W2 = o.w || 2.6, D2 = o.d || 0.75, ow = o.ow || 1.15, oh = o.oh || 0.9, hh = o.hearthH === undefined ? 0.38 : o.hearthH, y0 = hh;
    f.box(sk, (W2 - ow) / 2, H, D2, -(W2 + ow) / 4, H / 2, -D2 / 2, sc); f.box(sk, (W2 - ow) / 2, H, D2, (W2 + ow) / 4, H / 2, -D2 / 2, sc); f.box(sk, ow, H - y0 - oh, D2, 0, y0 + oh + (H - y0 - oh) / 2, -D2 / 2, sc); f.box(sk, ow, y0, D2, 0, y0 / 2, -D2 / 2, sc);
    f.box("matte", ow, oh, 0.04, 0, y0 + oh / 2, -D2 + 0.12, 0x0c0a08); f.box("matte", 0.04, oh, D2 - 0.12, -ow / 2 + 0.02, y0 + oh / 2, -D2 / 2 + 0.06, 0x1a1512); f.box("matte", 0.04, oh, D2 - 0.12, ow / 2 - 0.02, y0 + oh / 2, -D2 / 2 + 0.06, 0x1a1512); f.box("matte", ow, 0.04, D2 - 0.12, 0, y0 + oh - 0.02, -D2 / 2 + 0.06, 0x120f0c); f.box("matte", ow, 0.02, D2, 0, y0 + 0.01, -D2 / 2, 0x2a2420);
    FIRE(K, f, 0, y0 + 0.36, -D2 + 0.32, ow * 0.86, 0.66); logs(f, ow * 0.7, -D2 + 0.34, y0 + 0.02, 3); f.box("metal", ow * 0.75, 0.03, 0.03, 0, y0 + 0.12, -0.2, IRON); [-1, 1].forEach(function (s) { f.rod("metal", [s * ow * 0.34, y0, -0.2], [s * ow * 0.34, y0 + 0.28, -0.16], 0.014, IRON); f.sph("metal", 0.03, s * ow * 0.34, y0 + 0.3, -0.16, IRON); });
    // the hearth (raised stone you can sit on), the mantel beam and what sits on it
    if (hh > 0.05) { f.box(sk, W2 + 0.4, hh, 0.62, 0, hh / 2, 0.31, sc); f.box("stoneS", W2 + 0.44, 0.05, 0.66, 0, hh + 0.025, 0.31, o.capC || 0xc9bca8); f.solid(0, 0.31, W2 + 0.4, 0.62, 0, hh + 0.05, { seat: true }); }
    f.box("wood", W2 + 0.3, 0.2, 0.3, 0, y0 + oh + 0.32, 0.12, o.mantel || 0x4a3020); f.solid(0, -D2 / 2, W2, D2, 0, H); f.occ(0, 0.1, W2 + 0.4, 1.0, 0.6, 0.7);
    f.hot(0, 1.1, 1.8, "fire"); return f; }
  // the fire: its own small mesh (it flickers and can be put out), split logs and an ember bed
  function FIRE(K, f, lx, ly, lz, w, h) { var p = f.w(lx, lz); K.fires = K.fires || []; K.fires.push({ x: p[0], y: f.y0 + ly, z: p[1], yaw: f.yaw, w: w, h: h }); }
  function logs(f, w, lz, y, n) { for (var i = 0; i < n; i++) f.cyl("wood", 0.06, 0.06, w * (0.8 + 0.1 * i), (i - 1) * 0.04, y + 0.06 + (i === 2 ? 0.08 : 0), lz + (i === 1 ? 0.08 : 0), 0x4a3020, { rz: HP, ry: (i - 1) * 0.25, seg: 8 }); f.box("glow", w * 0.8, 0.02, 0.18, 0, y + 0.01, lz + 0.04, 0xff7a2a, { uvr: WHITE }); }
  // beds: platform (villa), log (ranch), timber (lodge), iron (glamp); headboard at -z, the foot toward +z
  function bed(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), W = o.w || 1.9, Lb = 2.15, st = o.style || "platform", fc = o.frame || 0x5a3e2b, mh = st === "platform" ? 0.42 : 0.56, duv = o.duvet || 0xf2efe9, R = o.R || Math.random;
    if (st === "platform") { f.box("wood", W + 0.3, 0.22, Lb + 0.1, 0, 0.11, 0.02, fc); f.box("matte", W + 0.1, 0.06, Lb - 0.1, 0, 0.03, 0.02, 0x141312); f.rb(o.headKey || "fabric", W + 0.6, 1.1, 0.12, 0.04, 0, 0.75, -Lb / 2 - 0.02, o.head || 0xd8cbb4, { seg: 2 }); for (var c = 0; c < 6; c++) f.box(o.headKey || "fabric", 0.01, 1.0, 0.13, -W / 2 - 0.25 + c * (W + 0.5) / 5, 0.75, -Lb / 2 - 0.02, shade(o.head || 0xd8cbb4, 0.85));
      [-1, 1].forEach(function (s) { f.box("wood", 0.55, 0.42, 0.42, s * (W / 2 + 0.55), 0.21, -Lb / 2 + 0.25, fc); f.box("wood", 0.53, 0.012, 0.4, s * (W / 2 + 0.55), 0.25, -Lb / 2 + 0.25 + 0.0, shade(fc, 0.6)); tableLampRaw(K, f, s * (W / 2 + 0.55), -Lb / 2 + 0.2, 0.42, o.lamp); f.solid(s * (W / 2 + 0.55), -Lb / 2 + 0.25, 0.55, 0.42, 0, 0.45); }); }
    else if (st === "log") { [[-1, -1], [1, -1]].forEach(function (q) { f.cyl("wood", 0.08, 0.08, 1.35, q[0] * (W / 2 + 0.05), 0.675, -Lb / 2, fc, { seg: 10 }); f.sph("wood", 0.085, q[0] * (W / 2 + 0.05), 1.36, -Lb / 2, fc, { ws: 8, hs: 6 }); }); [[-1, 1], [1, 1]].forEach(function (q) { f.cyl("wood", 0.075, 0.075, 0.8, q[0] * (W / 2 + 0.05), 0.4, Lb / 2, fc, { seg: 10 }); });
      for (var r = 0; r < 4; r++) f.cyl("wood", 0.05, 0.05, W + 0.1, 0, 0.55 + r * 0.22, -Lb / 2, shade(fc, 0.92 + r * 0.03), { rz: HP, seg: 8 }); f.cyl("wood", 0.05, 0.05, W + 0.1, 0, 0.62, Lb / 2, fc, { rz: HP, seg: 8 }); [-1, 1].forEach(function (s) { f.cyl("wood", 0.05, 0.05, Lb, s * (W / 2 + 0.05), 0.3, 0, fc, { rx: HP, seg: 8 }); });
      f.box("wood", W, 0.12, Lb - 0.05, 0, 0.3, 0, shade(fc, 0.7)); }
    else if (st === "timber") { f.box("wood", 0.14, 1.2, 0.14, -W / 2 - 0.07, 0.6, -Lb / 2, fc); f.box("wood", 0.14, 1.2, 0.14, W / 2 + 0.07, 0.6, -Lb / 2, fc); for (var pl = 0; pl < 6; pl++) f.box("wood", (W) / 6 - 0.01, 0.75, 0.05, -W / 2 + (pl + 0.5) * W / 6, 0.85, -Lb / 2, shade(fc, 0.9 + (pl % 3) * 0.06)); f.box("wood", W + 0.3, 0.1, 0.1, 0, 1.25, -Lb / 2, fc);
      f.box("wood", W + 0.28, 0.24, Lb + 0.1, 0, 0.2, 0.03, fc); f.box("wood", 0.14, 0.62, 0.14, -W / 2 - 0.07, 0.31, Lb / 2 + 0.06, fc); f.box("wood", 0.14, 0.62, 0.14, W / 2 + 0.07, 0.31, Lb / 2 + 0.06, fc); f.box("wood", W + 0.28, 0.2, 0.08, 0, 0.42, Lb / 2 + 0.06, fc); }
    else { var ic = o.iron || IRON; [-1, 1].forEach(function (s) { f.rod("metal", [s * (W / 2 + 0.04), 0, -Lb / 2], [s * (W / 2 + 0.04), 1.3, -Lb / 2], 0.02, ic); f.sph("metal", 0.04, s * (W / 2 + 0.04), 1.32, -Lb / 2, BRASS); f.rod("metal", [s * (W / 2 + 0.04), 0, Lb / 2], [s * (W / 2 + 0.04), 0.85, Lb / 2], 0.02, ic); f.sph("metal", 0.035, s * (W / 2 + 0.04), 0.87, Lb / 2, BRASS); f.rod("metal", [s * (W / 2 + 0.04), 0.3, -Lb / 2], [s * (W / 2 + 0.04), 0.3, Lb / 2], 0.015, ic); });
      [1.25, 0.65].forEach(function (yy) { f.rod("metal", [-W / 2 - 0.04, yy, -Lb / 2], [W / 2 + 0.04, yy, -Lb / 2], 0.016, ic); }); for (var sp = 0; sp < 7; sp++) f.rod("metal", [-W / 2 + 0.2 + sp * (W - 0.4) / 6, 0.65, -Lb / 2], [-W / 2 + 0.2 + sp * (W - 0.4) / 6, 1.25, -Lb / 2], 0.009, ic); f.rod("metal", [-W / 2 - 0.04, 0.78, Lb / 2], [W / 2 + 0.04, 0.78, Lb / 2], 0.016, ic); f.box("wood", W, 0.06, Lb - 0.04, 0, 0.3, 0, 0x6a4a30); }
    // the bedding: a mattress, a duvet that drapes, the quilt or throw folded at the foot, pillows
    f.rb("fabric", W - 0.04, 0.22, Lb - 0.06, 0.06, 0, mh - 0.11, 0, 0xf4f2ee, { seg: 2 }); f.rb("fabric", W + 0.06, 0.1, Lb - 0.4, 0.05, 0, mh + 0.02, 0.17, duv, { seg: 2, bulge: 0.015 }); [-1, 1].forEach(function (s) { f.box("fabric", 0.03, 0.26, Lb - 0.42, s * (W / 2 + 0.04), mh - 0.09, 0.17, duv); }); f.box("fabric", W + 0.06, 0.26, 0.03, 0, mh - 0.09, Lb / 2 - 0.04, duv);
    f.rb("fabric", W + 0.04, 0.06, 0.32, 0.03, 0, mh + 0.06, -Lb / 2 + 0.46, duv, { seg: 1 });
    if (o.quilt) { f.box("rug", W + 0.1, 0.035, 0.6, 0, mh + 0.085, Lb / 2 - 0.4, null, { uvr: o.quilt }); f.box("rug", W + 0.1, 0.24, 0.02, 0, mh - 0.03, Lb / 2 - 0.09, null, { uvr: o.quilt }); }
    var pc = o.pillows || [0xf4f2ee, 0xf4f2ee, 0xd8cbb4]; f.rb("fabric", 0.7, 0.16, 0.42, 0.07, -W / 4, mh + 0.16, -Lb / 2 + 0.32, pc[0], { bulge: 0.04, rx: -0.5 }); f.rb("fabric", 0.7, 0.16, 0.42, 0.07, W / 4, mh + 0.16, -Lb / 2 + 0.32, pc[1], { bulge: 0.04, rx: -0.5 });
    f.rb(o.accUv ? "rug" : "fabric", 0.5, 0.12, 0.4, 0.05, -W / 4 + 0.05, mh + 0.16, -Lb / 2 + 0.5, pc[2], { bulge: 0.03, rx: -1.1, ry: 0.15, uvr: o.accUv }); f.rb("fabric", 0.5, 0.12, 0.4, 0.05, W / 4 - 0.05, mh + 0.16, -Lb / 2 + 0.5, pc[2], { bulge: 0.03, rx: -1.1, ry: -0.15 });
    f.solid(0, Lb / 2 - 0.35, W, 0.7, 0, mh + 0.1, { seat: true }); f.solid(0, -0.35, W + 0.1, Lb - 0.7, 0, mh + 0.3); f.solid(0, -Lb / 2 - 0.02, W + 0.4, 0.2, 0, 1.2); f.occ(0, 0, W + 0.3, Lb + 0.1, 0.5, 0.9);
    if (o.benchC) { var pb = f.w(0, Lb / 2 + 0.42); rawCall(K, function () { bench(K, pb[0], pb[1], f.yaw, { len: W - 0.1, wc: fc, cushion: o.benchC }); }); } return f; }
  function tableLampRaw(K, f, lx, lz, y, o) { var p = f.w(lx, lz); rawCall(K, function () { tableLamp(K, p[0], p[1], f.y0 - (K.y0 || 0) + y, o || {}); }); }
  // a bookcase: the generated shelf of books on its face inside a carcass; a book can be pulled (E)
  function bookcase(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), W = o.w || 1.2, H = o.h || 2.2, D = 0.36, wc = o.wc || 0x5a3e2b;
    f.box("wood", W, H, 0.03, 0, H / 2, -D / 2 + 0.015, shade(wc, 0.7)); [-1, 1].forEach(function (s) { f.box("wood", 0.04, H, D, s * (W / 2 - 0.02), H / 2, 0, wc); }); f.box("wood", W, 0.05, D, 0, H - 0.025, 0, wc); f.box("wood", W, 0.1, D, 0, 0.05, 0, wc);
    f.quad("stock", W - 0.08, H - 0.16, 0, H / 2 + 0.02, -D / 2 + 0.04, 0xffffff, o.stock || AT.stock.books); f.solid(0, 0, W, D, 0, H); f.occ(0, 0, W, D, 2, 0.8); f.hot(0, 0.5, 1.4, "book"); return f; }
  // a floating shelf with a row of spines, a vase and a small plant
  function shelf(K, x, z, yaw, y, w, o) { o = o || {}; var f = F(K, x, z, yaw, y), wc = o.wc || 0x5a3e2b; f.box("wood", w, 0.045, 0.26, 0, 0, 0.13, wc); var bw = Math.min(w * 0.55, 0.9); f.quad("stock", bw, bw * 0.205, -w / 2 + bw / 2 + 0.05, 0.025 + bw * 0.1, 0.06, 0xffffff, AT.stock.spines, { ry: 0 }); f.box("matte", bw, bw * 0.2, 0.12, -w / 2 + bw / 2 + 0.05, 0.025 + bw * 0.1, 0.0, 0x2a2420);
    vase(f, w / 2 - 0.25, 0.022, 0.13, o.vc || 0xd8c2a0, 0.22, 2); if (w > 1.0) { pot(f, o.pot || "white", 0.07, 0.1, w / 2 - 0.08, 0.13, 0.022); f.put("leaf", planeG(0.2, 0.42), w / 2 - 0.08, 0.022 - 0.12, 0.15, 0xffffff, { uvr: AT.leaf.pothos, ao: false }); } return f; }
  // a dining set: the table, chairs round it, a runner, settings, candles or a bowl; the light above is the room's call
  function diningSet(K, x, z, yaw, o) { o = o || {}; var t = table(K, x, z, yaw, o.table || {}), L = (o.table && o.table.len) || 2.2, D = (o.table && o.table.d) || 0.95, n = o.perSide || Math.max(2, Math.round((L - 0.3) / 0.65)), ch = o.chair || {}, R = o.R || Math.random;
    if ((o.table || {}).style === "round") { var nr = o.nRound || 4; for (var r = 0; r < nr; r++) { var a = r / nr * TAU + PI / 4, p = t.w(Math.sin(a) * (L / 2 + 0.32), Math.cos(a) * (L / 2 + 0.32)); rawCall(K, function () { dchair(K, p[0], p[1], t.yaw + a + PI, ch); }); } }
    else { for (var i = 0; i < n; i++) { var u = -L / 2 + (i + 0.5) * L / n; [1, -1].forEach(function (s) { if (s < 0 && o.benchBack) return; var p = t.w(u, s * (D / 2 + 0.3)); rawCall(K, function () { dchair(K, p[0], p[1], t.yaw + (s > 0 ? PI : 0), ch); }); }); }
      if (o.benchBack) { var pb = t.w(0, -(D / 2 + 0.32)); rawCall(K, function () { bench(K, pb[0], pb[1], t.yaw, { len: L - 0.2, wc: (o.table || {}).lc || 0x6a4a30, cushion: o.benchCushion }); }); }
      if (o.ends) [-1, 1].forEach(function (s) { var p = t.w(s * (L / 2 + 0.36), 0); rawCall(K, function () { dchair(K, p[0], p[1], t.yaw - s * HP, o.endChair || ch); }); }); }
    var h = ((o.table || {}).h || 0.76); if (o.runner) t.box("rug", 0.4, 0.006, L * 0.8 > 2 ? 2 : L * 0.8, 0, h + 0.003, 0, null, { uvr: o.runner, ry: HP, ao: false });
    var cp = o.center || "candles"; if (cp === "candles") { for (var c = 0; c < 3; c++) candle(t, -0.25 + c * 0.25, h, 0.0, 0.12 + (c % 2) * 0.08); } else if (cp === "bowl") bowl(t, 0, h, 0, 0.18, o.bowlC || 0x2b2a29, true); else { vase(t, 0, h, 0, o.vaseC || 0xe8e0d0, 0.3, 1); t.put("leaf", planeG(0.4, 0.6), 0, h + 0.5, 0, 0xffffff, { uvr: AT.leaf[o.stems || "eucalyptus"], ao: false }); t.put("leaf", planeG(0.4, 0.6), 0, h + 0.5, 0, 0xffffff, { uvr: AT.leaf[o.stems || "eucalyptus"], ry: HP, ao: false }); }
    if (o.settings) { var sp = L / n; for (var k = 0; k < n; k++) [1, -1].forEach(function (s) { var u = -L / 2 + (k + 0.5) * sp; t.cyl("gloss", 0.13, 0.13, 0.012, u, h + 0.006, s * (D / 2 - 0.2), 0xf6f4f0, { seg: 18 }); t.cyl("glass", 0.035, 0.03, 0.12, u + 0.15, h + 0.06, s * (D / 2 - 0.32), null, { seg: 10 }); }); }
    return t; }
  // a console or sideboard against a wall with a lamp, books, a bowl and art above
  function sideboard(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), L = o.len || 1.8, D = 0.45, h = o.h || 0.78, wc = o.wc || 0x5a3e2b, R = o.R || Math.random;
    f.box("wood", L, h - 0.12, D, 0, 0.12 + (h - 0.12) / 2, 0, wc); legs4(f, "wood", L, D, 0.12, 0.02, shade(wc, 0.8), 0.06); var nd = Math.max(2, Math.round(L / 0.45)); for (var i = 0; i < nd; i++) { f.box("wood", L / nd - 0.012, h - 0.18, 0.02, -L / 2 + (i + 0.5) * L / nd, 0.12 + (h - 0.12) / 2, D / 2, o.slats ? shade(wc, 0.9) : shade(wc, 0.95)); if (o.slats) for (var s = 0; s < 6; s++) f.box("wood", 0.012, h - 0.22, 0.012, -L / 2 + (i + 0.5) * L / nd - L / nd / 2 + (s + 0.5) * L / nd / 6, 0.12 + (h - 0.12) / 2, D / 2 + 0.012, shade(wc, 0.7)); }
    tableLampRaw(K, f, -L / 2 + 0.28, 0, h, o.lamp); books(f, 3, 0.05, h, 0.0, R, { flat: true }); vase(f, L / 2 - 0.25, h, 0.0, o.vc || 0x2b2a29, 0.34, 0); bowl(f, 0.45, h, 0.05, 0.12, o.bc || 0xd8c2a0, false);
    f.solid(0, 0, L, D, 0, h); f.occ(0, 0, L, D, h, 0.7); return f; }

  // ───────────────────────── the four styles: colourways, zones (living, kitchen, dining, bedroom, reading), two layouts each ─────────────────────────
  // a zone frame: origin on a wall face (or a table centre), +w into the room, +u along the wall; Z(u, w) -> room [x, z] before the mirror
  function Zf(cx, cz, yaw) { var c = Math.cos(yaw), s = Math.sin(yaw); var z = function (u, w) { return [cx + u * c + w * s, cz - u * s + w * c]; }; z.yaw = yaw; z.a = function (a) { return yaw + (a || 0); }; return z; }
  function zWall(side, h, off) { off = off || 0; if (side === "B") return Zf(off, -h + 0.1, 0); if (side === "F") return Zf(off, h - 0.1, PI); if (side === "L") return Zf(-h + 0.1, off, HP); return Zf(h - 0.1, off, -HP); }
  var CW = {
    villa: [
      { fab: 0xe9e2d6, fab2: 0xc9b8a0, acc: 0x8a9a78, acc2: 0xb86e4a, wood: 0x5e4838, wood2: 0xb08a5e, met: BLACK, trav: 0xffffff, wall: 0xf4efe6, stone: 0xffffff, rug: "abstract", lea: 0x7e5032, cab: 0x5e4838, top: 0xf2eee8, topKey: "trav", art: ["sun_dunes", "abstract_bands"] },
      { fab: 0x6b6762, fab2: 0x9a9289, acc: 0xd9b98a, acc2: 0x9c5b36, wood: 0xb08a5e, wood2: 0x5e4838, met: BRASS, trav: 0xe8e4dc, wall: 0xefebe4, stone: 0xd8d0c8, rug: "beni", lea: 0x8a4b2a, cab: 0x34312e, top: 0xe9e6e0, topKey: "trav", art: ["abstract_bands", "photo_ridge"] },
      { fab: 0xdcc9b0, fab2: 0xb5552e, acc: 0xe6c08a, acc2: 0x7d8b6a, wood: 0x5a4232, wood2: 0xc9a46a, met: 0x6b5a48, trav: 0xfff4e6, wall: 0xf3e8da, stone: 0xffe6d2, rug: "persian", lea: 0x6a3c22, cab: 0xb08a5e, top: 0xd8cfc0, topKey: "trav", art: ["sun_dunes", "map"] },
      { fab: 0xf3f0ea, fab2: 0x2e2c2a, acc: 0x7d8b6a, acc2: 0xb08a5e, wood: 0xc9ad86, wood2: 0x2b2622, met: BLACK, trav: 0xf4f4f0, wall: 0xf7f6f2, stone: 0xe8e2da, rug: "beni", lea: 0x2a2420, cab: 0xe9e5dc, top: 0x3a3836, topKey: "gloss", art: ["abstract_bands", "sun_dunes"] } ],
    ranch: [
      { lea: 0x6e4a32, wood: 0x8a6040, wood2: 0x4a3426, acc: 0x8a3a2a, acc2: 0x34506a, fab: 0xd9cbb4, rug: "navajo", thr: "plaid", cab: 0x5e4a36, art: ["horses", "cowboy"], wall: 0xe8c8a0, plank: 0x8a6a4a },
      { lea: 0x4a3224, wood: 0x9a7048, wood2: 0x3a2a1e, acc: 0x3a7a78, acc2: 0xb89640, fab: 0xe0d4be, rug: "navajo", thr: "navajo", cab: 0x7d8b7a, art: ["cowboy", "horses"], wall: 0xdcc0a0, plank: 0x7a5a3c },
      { lea: 0x8a6446, wood: 0x7a5636, wood2: 0x34261c, acc: 0x4a5e42, acc2: 0xa8653e, fab: 0xd8cbb4, rug: "persian", thr: "quilt", cab: 0x44523f, art: ["horses", "map"], wall: 0xf0d4b0, plank: 0x6a4a30 },
      { lea: 0x5a2e24, wood: 0x946a44, wood2: 0x3a2a1e, acc: 0xcdbfa6, acc2: 0x34506a, fab: 0xcdbfa6, rug: "navajo", thr: "plaid", cab: 0x6e3328, art: ["cowboy", "map"], wall: 0xe4c49c, plank: 0x5e4430 } ],
    lakehouse: [
      { fab: 0x4a5a4c, lea: 0x6e4a32, wood: 0x7a5636, acc: 0x8a3a2a, rug: "persian", thr: "plaid", art: ["pines", "map"], logs: 0xd2c6bc, cab: 0x5a4232 },
      { fab: 0x7a4a36, lea: 0x4a3224, wood: 0x8a6444, acc: 0x4a5e42, rug: "navajo", thr: "plaid", art: ["pines", "horses"], logs: 0xc8bcb4, cab: 0x44523f },
      { fab: 0x3a4660, lea: 0x8a6446, wood: 0x6e5034, acc: 0xb8943a, rug: "persian", thr: "quilt", art: ["map", "pines"], logs: 0xdacec4, cab: 0x5e4a36 },
      { fab: 0xa08664, lea: 0x5a2e24, wood: 0x806248, acc: 0x34405a, rug: "navajo", thr: "plaid", art: ["pines", "cowboy"], logs: 0xc4bab2, cab: 0x2e2a26 } ],
    glamp: [
      { can: 0xf6efe2, acc: 0xa8653e, acc2: 0xc9a048, quilt: "quilt", rug: "navajo", wood: 0x8a6a48, iron: IRON },
      { can: 0xece2d0, acc: 0x34405a, acc2: 0xd9cbb4, quilt: "plaid", rug: "persian", wood: 0x6a4a30, iron: 0x3a3532 },
      { can: 0xeceee2, acc: 0x7d8b6a, acc2: 0xc46a3c, quilt: "quilt", rug: "abstract", wood: 0xa0805a, iron: BRASS },
      { can: 0xf8f3e8, acc: 0x8f2b1e, acc2: 0x3a8a8a, quilt: "navajo", rug: "beni", wood: 0x5a3e2b, iron: IRON } ]
  };
  function RUG(k) { return AT.rug[k] || AT.rug.navajo; }

  // ── the villa: desert-modern luxury ──
  function villa(K, h, H, V) { var S = CW.villa[V.cw], R = K.R, set = V.set, A = V.lay === 0;
    // living: a sandstone fire wall on the back wall (layout A) or the left wall (layout B), the sofa set facing it
    var ZL = A ? Zf(-4.0, -h + 0.1, 0) : Zf(-h + 0.1, -3.4, HP), ZK = A ? Zf(4.2, -h + 0.1, 0) : Zf(1.6, -h + 0.1, 0), ZD = A ? Zf(4.5, 1.9, HP) : Zf(4.9, 2.6, HP), ZB = A ? Zf(-4.9, h - 0.1, PI) : Zf(-4.8, h - 0.1, PI);
    var wf = ZL(0, 0.32); fireplace(K, wf[0], wf[1], ZL.a(0), { style: "linear", w: 3.6, hgt: H, stoneKey: "stoneS", stoneC: S.stone, bench: S.wood, trim: S.met === BRASS ? BRASS : 0x5a4a3c });
    var ap = ZL(0, 0.36); art(K, ap[0], ap[1], ZL.a(0), 2.55, S.art[0], 1.5, { frame: 0.03, fc: S.wood2, mat: 0.06 });
    [-1, 1].forEach(function (s) { var p = ZL(s * 1.25, 0.55); vase(F(K, p[0], p[1], ZL.a(0), 0.33), 0, 0, 0, s < 0 ? S.acc : 0x2b2a29, 0.36, s < 0 ? 1 : 0); });
    var rp = ZL(0, 3.0); rug(K, rp[0], rp[1], ZL.a(0), 3.9, 3.0, RUG(S.rug));
    var pil = [{ c: S.acc }, { c: S.fab2 }, { c: S.acc2 }, { c: S.fab2 }];
    if (set === 0) { var sp = ZL(0, 4.15); sofa(K, sp[0], sp[1], ZL.a(PI), { len: 3.0, style: "low", c: S.fab, pil: pil, legC: S.wood2 }); var cp = ZL(-2.05, 2.75); sofa(K, cp[0], cp[1], ZL.a(HP), { len: 2.2, style: "low", c: S.fab, pil: [{ c: S.acc2 }], legC: S.wood2 });
      var ct = ZL(0.2, 2.75); coffee(K, ct[0], ct[1], ZL.a(0), { style: "block", len: 1.5, d: 0.8, tc: S.trav }); var ch = ZL(2.1, 2.6); chair(K, ch[0], ch[1], ZL.a(-HP), { style: "sling", c: S.lea }); }
    else if (set === 1) { [-1, 1].forEach(function (s) { var p = ZL(s * 1.95, 2.9); sofa(K, p[0], p[1], ZL.a(-s * HP), { len: 2.4, style: "track", c: s < 0 ? S.fab : S.fab, pil: [{ c: S.acc }, { c: S.acc2 }], legC: S.wood2 }); });
      var ct2 = ZL(0, 2.9); coffee(K, ct2[0], ct2[1], ZL.a(HP), { style: "slab", len: 1.4, d: 0.75, tc: S.wood }); var op = ZL(0, 4.3); ottoman(K, op[0], op[1], ZL.a(0), { w: 1.1, d: 0.6, c: S.lea, mat: "leather" }); }
    else { var sp3 = ZL(0, 4.15); sofa(K, sp3[0], sp3[1], ZL.a(PI), { len: 2.7, style: "track", c: S.fab, pil: pil, legC: S.wood2, throwUv: RUG("plaid") === RUG(S.rug) ? null : null });
      [-1, 1].forEach(function (s) { var p = ZL(s * 1.75, 2.3); chair(K, p[0], p[1], ZL.a(-s * HP + PI * 0.06 * s), { style: "lounge", c: s < 0 ? S.fab2 : S.fab2, pil: { c: S.acc } }); }); var ct3 = ZL(0, 2.8); coffee(K, ct3[0], ct3[1], 0, { style: "round2", len: 1.1, tc: S.trav }); }
    // coffee table and side table decor
    var cd = ZL(0.25, 2.8); var fcd = F(K, cd[0], cd[1], ZL.a(0), 0.38); books(fcd, 3, -0.35, 0, 0.05, R, { flat: true }); bowl(fcd, 0.25, 0, 0.0, 0.14, S.acc, false); candle(fcd, 0.0, 0, -0.18, 0.1);
    var st1 = ZL(1.85, 4.25); sideTable(K, st1[0], st1[1], { style: "round", tc: S.wood, mc: S.met }); tableLamp(K, st1[0], st1[1], 0.55, { style: "ceramic", c: S.acc2 });
    var fl = ZL(-2.5, 4.4); floorLamp(K, fl[0], fl[1], { style: "arc", yaw: ZL.a(PI * 0.75), mc: S.met }); F(K, fl[0], fl[1], 0).hot(0, 0, 1.2, "lights");
    var pl1 = ZL(-2.6, 0.55); plant(K, pl1[0], pl1[1], { kind: "fig", h: 2.1, pot: "black", pr: 0.28, ph: 0.5 }); var pl2 = ZL(2.6, 0.55); plant(K, pl2[0], pl2[1], { kind: "paradise", h: 1.9, pot: "stone", pr: 0.26, ph: 0.48 });
    // kitchen: a run with open shelves on the back wall, the island in front with stools and globe pendants
    var kr = ZK(0, 0.3); var KR = kitchenRun(K, kr[0], kr[1], ZK.a(0), { mods: A ? ["tall", "base", "sink", "drawers", "range", "drawers", "base", "tall"] : ["tall", "base", "sink", "base", "range", "drawers", "tall"], cab: S.cab, top: S.top, topKey: S.topKey, pull: S.met, uppers: set === 2 ? "cabinets" : "shelves", hood: set === 1 ? "plaster" : "metal", hoodC: set === 1 ? S.wall : S.met === BRASS ? 0x2b2a29 : 0x2b2a29, hgt: H, splashC: S.acc === 0x7d8b6a ? 0xdfe4d8 : 0xece6dc, seed: V.seed, kettle: S.acc });
    var ipc = ZK((A ? 3.0 : 2.6) / 2 + 0.75, 3.05); F(K, ipc[0], ipc[1], 0).hot(0, 0, 1.2, "card");
    var ip = ZK(0, 3.05); island(K, ip[0], ip[1], ZK.a(0), { len: A ? 3.0 : 2.6, cab: S.wood, top: S.top, topKey: S.topKey, waterfall: set !== 1, legs: set === 1, hgt: H, stool: { style: set === 2 ? "bar" : "metal", c: S.lea, mc: S.met, wc: S.wood2 }, pstyle: set === 1 ? "dome" : "globe", pmc: S.met, pr: 0.14 });
    // dining: the table along the glass, eight chairs, a linear light
    var dp = ZD(0, 0); diningSet(K, dp[0], dp[1], ZD.a(0), { table: { len: 2.6, d: 1.0, style: set === 0 ? "pedestal2" : set === 1 ? "slab" : "rect", top: "wood", tc: S.wood, lc: S.trav, legM: set === 0 ? "trav" : "wood" }, chair: { style: set === 2 ? "cross" : "shell", wc: S.wood2, c: S.fab, pad: S.acc2, seatC: 0xc9a46a }, ends: set !== 1, center: set === 1 ? "bowl" : "stems", stems: "eucalyptus", bowlC: S.acc, settings: true, R: R });
    var cl = ZD(0, 0); chandelier(K, cl[0], cl[1], H, 2.25, { style: "linear", len: 1.9, yaw: ZD.a(0), mc: S.met, globes: set === 0 });
    var ZW = Zf(h - 0.1, A ? -4.6 : -5.0, -HP), cw1 = ZW(0, 0.25); if (A) { sideboard(K, cw1[0], cw1[1], ZW.a(0), { len: 2.2, h: 0.75, wc: S.wood2, slats: true, lamp: { style: "brass" }, vc: S.acc2, R: R }); var aw1 = ZW(0, 0.05); art(K, aw1[0], aw1[1], ZW.a(0), 2.05, "photo_ridge", 1.0, { frame: 0.03, fc: 0x1b1a19, fm: "metal", mat: 0.08 }); var pw = ZW(1.6, 0.45); plant(K, pw[0], pw[1], { kind: "fig", h: 2.2, pot: "basket", pr: 0.3, ph: 0.5 }); }
    if (!A) { var ZS = Zf(h - 0.1, -5.6, -HP), dk = ZS(0, 1.1); var fd = F(K, dk[0], dk[1], ZS.a(PI)); fd.box("wood", 1.6, 0.05, 0.75, 0, 0.75, 0, S.wood); [-1, 1].forEach(function (s2) { fd.box("wood", 0.05, 0.73, 0.7, s2 * 0.76, 0.365, 0, S.wood); }); fd.box("gloss", 0.5, 0.02, 0.34, 0.25, 0.79, 0.05, 0x2b2a29); books(fd, 3, -0.6, 0.775, -0.1, R, { flat: true }); mug(fd, -0.2, 0.775, 0.12, S.acc2); fd.solid(0, 0, 1.6, 0.75, 0, 0.78);
      var dcp = ZS(0, 1.75); dchair(K, dcp[0], dcp[1], ZS.a(PI), { style: "shell", wc: S.wood2, c: S.fab, pad: S.acc }); tableLampRaw(K, fd, 0.62, -0.2, 0.775, { style: "brass" }); var b1 = ZS(-1.6, 0.18); bookcase(K, b1[0], b1[1], ZS.a(0), { w: 1.2, h: 2.3, wc: S.wood }); var b2 = ZS(1.6, 0.18); bookcase(K, b2[0], b2[1], ZS.a(0), { w: 1.2, h: 2.3, wc: S.wood }); var aw2 = ZS(0, 0.05); art(K, aw2[0], aw2[1], ZS.a(0), 1.85, "photo_ridge", 0.9, { frame: 0.03, fc: 0x1b1a19, fm: "metal", mat: 0.08 }); var sp5 = ZS(0, 3.1); plant(K, sp5[0], sp5[1], { kind: "paradise", h: 1.8, pot: "stone", pr: 0.26, ph: 0.46 }); }
    var drp = ZD(0, 0); rug(K, drp[0], drp[1], ZD.a(0), 3.6, 2.7, RUG(S.rug === "abstract" ? "beni" : "abstract"));
    // the bedroom: a platform bed against the front wall behind a walnut slat screen, a reading chair by the window
    var bp = ZB(0, 1.12); bed(K, bp[0], bp[1], ZB.a(0), { style: "platform", w: 1.9, frame: S.wood, head: S.fab2, duvet: S.fab === 0x6b6762 ? 0xe9e5de : 0xf4f2ee, quilt: null, pillows: [0xf4f2ee, 0xf4f2ee, S.acc], lamp: { style: "brass" }, benchC: S.acc2, R: R });
    var ab = ZB(0, 0.05); art(K, ab[0], ab[1], ZB.a(0), 2.25, S.art[1], 1.4, { frame: 0.025, fc: S.met === BRASS ? BRASS : 0x1b1a19, fm: "metal", mat: 0.05 });
    var sx0 = -h + 0.15, sx1 = -2.4, sz = 1.25; for (var x = sx0 + 0.08; x < sx1 - 0.04; x += 0.17) K.put("wood", boxG(0.05, 2.36, 0.09), mtx(x * K.mir, 1.22, sz), S.wood); K.put("wood", boxG(sx1 - sx0, 0.06, 0.14), mtx(((sx0 + sx1) / 2) * K.mir, 2.43, sz), S.wood); K.put("wood", boxG(sx1 - sx0, 0.05, 0.14), mtx(((sx0 + sx1) / 2) * K.mir, 0.025, sz), S.wood);
    K.sol.push([((sx0 + sx1) / 2) * K.mir, sz, sx1 - sx0, 0.14, 0, 2.45, 0, false, null]); plant(K, sx1 + 0.45, sz + 0.5, { kind: "monstera", h: 1.3, pot: "white", pr: 0.24, ph: 0.4 });
    chair(K, -7.2, 4.45, HP + 0.25, { style: set === 1 ? "club" : "lounge", c: set === 1 ? S.lea : S.fab2, mat: set === 1 ? "leather" : "fabric", pil: { c: S.acc } }); floorLamp(K, -7.7, 5.2, { style: "lamp", mc: S.met }); sideTable(K, -7.25, 3.62, { style: "round", tc: S.wood, mc: S.met }); var rtf = F(K, -7.25, 3.62, 0, 0.55); books(rtf, 2, -0.1, 0, 0, R, { flat: true }); mug(rtf, 0.12, 0, 0.08, S.acc2);
    var brug = ZB(0, 1.6); rug(K, brug[0], brug[1], ZB.a(0), 3.2, 2.6, RUG(S.rug === "beni" ? "abstract" : "beni"));
    // reading corner by the front glass: a lounge chair, an ottoman, a lamp, a bookcase, a snake plant
    var ZR = Zf(h - 0.1, h - 1.6, -HP), bc = ZR(0.2, 0.18); bookcase(K, bc[0], bc[1], ZR.a(0), { w: 1.3, h: 2.3, wc: S.wood }); var rch = ZR(-0.2, 1.7); chair(K, rch[0], rch[1], ZR.a(PI * 0.15), { style: set === 0 ? "sling" : "lounge", c: set === 0 ? S.lea : S.fab, pil: { c: S.acc2 } });
    var oto = ZR(-0.1, 2.6); ottoman(K, oto[0], oto[1], ZR.a(0), { w: 0.6, d: 0.5, h: 0.4, c: S.acc, noSeat: false }); var rfl = ZR(-1.0, 1.1); floorLamp(K, rfl[0], rfl[1], { style: "lamp", mc: S.met }); var rpl = ZR(1.15, 0.5); plant(K, rpl[0], rpl[1], { kind: "snake", h: 1.0, pot: "white", pr: 0.18, ph: 0.34 });
    // the entry: olives in stone pots either side of the door, a console with a lamp and art on the front wall
    [-1, 1].forEach(function (s) { plant(K, s * 1.75, h - 0.65, { kind: "olive", h: 2.0, pot: "stone", pr: 0.3, ph: 0.55 }); });
    var ZE = Zf(3.6, h - 0.1, PI), ce = ZE(0, 0.25); sideboard(K, ce[0], ce[1], ZE.a(0), { len: 1.7, h: 0.8, wc: S.wood, slats: set !== 2, lamp: { style: "ceramic", c: S.fab2 }, vc: S.acc, R: R }); var ae = ZE(0, 0.05); art(K, ae[0], ae[1], ZE.a(0), 1.85, set === 1 ? "photo_ridge" : "abstract_bands", 1.3, { frame: 0.025, fc: S.wood2, mat: 0.04 });
    // the open middle: a sculptural cluster of glass globes at mixed heights over a round rug, a ceramic vessel on a plinth
    var gc = [0.4, -0.2]; for (var gi = 0; gi < 7; gi++) { var ga = gi / 7 * TAU, gr = gi ? 0.55 : 0, gy = 2.55 + ((gi * 37) % 7) * 0.12; pendant(K, gc[0] + Math.cos(ga) * gr, gc[1] + Math.sin(ga) * gr, H, gy, { style: "globe", r: 0.11 + (gi % 3) * 0.03, mc: S.met }); }
    var rr = F(K, gc[0], gc[1], 0); rr.put("rug", discG(1.75, 40), 0, 0.013, 0, null, { uvr: RUG(S.rug === "persian" ? "beni" : "persian"), ao: false }); var pl = F(K, A ? 2.6 : -2.4, 4.2, 0); pl.box("trav", 0.5, 0.75, 0.5, 0, 0.375, 0, S.trav); vase(pl, 0, 0.75, 0, S.acc2, 0.55, 2); pl.solid(0, 0, 0.5, 0.5, 0, 0.75);
    // the shell: travertine, plaster, a walnut slat ceiling over the living area, a cove of light, steel glazing onto the desert
    var rx = ZK(KR.rangeU, 0)[0], clere = function (a0, a1) { return rx > a0 && rx < a1 ? [{ a0: a0, a1: rx - 0.6, y0: 3.2, y1: 4.05, kind: "steel" }, { a0: rx + 0.6, a1: a1, y0: 3.2, y1: 4.05, kind: "steel" }] : [{ a0: a0, a1: a1, y0: 3.2, y1: 4.05, kind: "steel" }]; };
    var vis = V.vista; var ops = { B: A ? clere(1.0, 7.4).concat([ { a0: -7.5, a1: -6.4, y0: 0.3, y1: 4.05, kind: "steel" }, { a0: -1.6, a1: -0.7, y0: 0.3, y1: 4.05, kind: "steel" }]) : clere(-1.2, 4.4),
      R: [{ a0: -1.4, a1: 5.0, y0: 0.04, y1: 4.2, kind: "steel" }], L: A ? [{ a0: 3.1, a1: 6.4, y0: 0.8, y1: 3.5, kind: "steel" }, { a0: -6.8, a1: -4.4, y0: 0.8, y1: 3.5, kind: "steel" }] : [{ a0: 2.6, a1: 6.6, y0: 0.8, y1: 3.5, kind: "steel" }, { a0: -7.4, a1: -6.2, y0: 0.3, y1: 4.05, kind: "steel" }, { a0: -1.2, a1: -0.2, y0: 0.3, y1: 4.05, kind: "steel" }],
      F: [{ a0: -1.1, a1: 1.1, y0: 0, y1: 2.4, kind: "door" }, { a0: -7.2, a1: -6.0, y0: 0.6, y1: 3.6, kind: "steel" }] };
    ["B", "R", "L", "F"].forEach(function (sd) { wall(K, sd, h, H, "plaster", ops[sd], { tint: S.wall, vista: vis, base: 0.08, baseKey: "plaster", baseC: shade(S.wall, 0.82), frameC: S.met === BRASS ? 0x2b2622 : 0x1b1a19, jamb: S.wall }); });
    doorK(K, h, { trim: S.wood, leaf: S.wood, panels: false, handle: S.met });
    ceilingK(K, h, H, "plaster", S.wall); var slx0 = A ? -h + 0.3 : -h + 0.3, slx1 = A ? -0.6 : -0.9, slz0 = A ? -h + 0.3 : -7.5, slz1 = A ? -2.1 : 0.4;
    for (var sx = slx0; sx < slx1; sx += 0.13) K.put("wood", boxG(0.06, 0.08, slz1 - slz0), mtx((sx + 0.03) * K.mir, H - 0.06, (slz0 + slz1) / 2), S.wood, null, false);
    [[0, -h + 0.25, 2 * h - 0.5, 0.03], [0, h - 0.25, 2 * h - 0.5, 0.03], [-h + 0.25, 0, 0.03, 2 * h - 0.5], [h - 0.25, 0, 0.03, 2 * h - 0.5]].forEach(function (q) { K.put("glow", boxG(q[2], 0.015, q[3]), mtx(q[0], H - 0.012, q[1]), 0xffe6c4, WHITE, false); });
    floorK(K, h, "trav", S.trav);
    return { lamp: [A ? -1.5 : 0.5, H - 0.5, -2.5], lampC: 0xffe6c8, lampI: 1.5, fillC: 0xfff3e2, fillG: 0x8a7a66, fillI: 1.05, dog: V.dog ? { x: ZL(1.4, 1.2), yaw: ZL.a(-0.6) } : null }; }

  // ───────────────────────── props with a sense of place: the ranch's saddle, hats, guitar and skull, a pot rack, firewood, bunks and tack, a chess table, string lights ─────────────────────────
  function saddle(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), c = o.c || 0x7a4022;
    [-1, 1].forEach(function (s) { f.rod("wood", [s * 0.3, 0, -0.22], [s * 0.3, 0.7, 0], 0.03, 0x5a3e2b); f.rod("wood", [s * 0.3, 0, 0.22], [s * 0.3, 0.7, 0], 0.03, 0x5a3e2b); }); f.box("wood", 0.75, 0.07, 0.1, 0, 0.72, 0, 0x5a3e2b);
    f.rb("leather", 0.62, 0.12, 0.5, 0.05, 0, 0.8, 0, c, { seg: 2, bulge: -0.02 }); f.rb("leather", 0.66, 0.42, 0.04, 0.03, 0, 0.62, 0.24, shade(c, 0.85)); f.rb("leather", 0.66, 0.42, 0.04, 0.03, 0, 0.62, -0.24, shade(c, 0.85)); f.cyl("leather", 0.035, 0.04, 0.14, 0.3, 0.92, 0, shade(c, 0.8), { seg: 10 }); f.cyl("leather", 0.06, 0.06, 0.03, 0.3, 1.0, 0, shade(c, 0.8), { seg: 10 }); f.rb("leather", 0.12, 0.16, 0.48, 0.05, -0.3, 0.92, 0, c);
    [-1, 1].forEach(function (s) { f.rod("leather", [0.05, 0.75, s * 0.26], [0.05, 0.42, s * 0.28], 0.012, 0x3a2414); f.tor("metal", 0.06, 0.012, 0.05, 0.38, s * 0.28, BRASS, { ts: 10, ry: HP }); }); f.box("rug", 0.7, 0.02, 0.62, 0, 0.745, 0, null, { uvr: o.blanket || AT.rug.navajo });
    f.solid(0, 0, 0.8, 0.6, 0, 1.0); f.occ(0, 0, 0.8, 0.6, 0.8, 0.5); return f; }
  function hat(f, lx, ly, lz, c, tilt) { f.cyl("leather", 0.2, 0.2, 0.012, lx, ly, lz, c, { seg: 18, rx: tilt || 0 }); f.lathe("leather", [[0.0, 0.0], [0.11, 0.0], [0.115, 0.08], [0.1, 0.13], [0.04, 0.12], [0, 0.11]], lx, ly + 0.005, lz, c, { seg: 14, rx: tilt || 0, sz: 0.85 }); f.cyl("leather", 0.113, 0.113, 0.025, lx, ly + 0.02, lz, 0x2a1a10, { seg: 14, open: true, rx: tilt || 0 }); }
  function hatRack(K, x, z, yaw, y, o) { o = o || {}; var f = F(K, x, z, yaw, y), n = o.n || 3; f.box("wood", 0.4 * n + 0.2, 0.12, 0.03, 0, 0, 0.015, 0x5a3e2b);
    for (var i = 0; i < n; i++) { var u = -0.2 * (n - 1) + i * 0.4; f.rod("wood", [u, 0, 0.02], [u, 0.06, 0.16], 0.014, 0x3a2a1e); if (i < (o.hats || n)) hat(f, u, -0.02, 0.2, [0x6a4a30, 0xc9a46a, 0x2a2420, 0x8a6a4a][(i + (o.seed || 0)) % 4], 1.25); } return f; }
  function guitar(K, x, z, yaw) { var f = F(K, x, z, yaw); [-1, 1].forEach(function (s) { f.rod("metal", [0, 0, 0], [s * 0.18, 0.0, 0.15], 0.01, BLACK); }); f.rod("metal", [0, 0, 0], [0, 0.0, -0.2], 0.01, BLACK); f.rod("metal", [0, 0, -0.05], [0, 0.55, -0.08], 0.01, BLACK);
    var t = -0.22; f.cyl("wood", 0.19, 0.19, 0.1, 0, 0.3, 0.02, 0xa0683e, { rx: HP + t, seg: 20 }); f.cyl("wood", 0.15, 0.15, 0.1, 0, 0.6, -0.05, 0xa0683e, { rx: HP + t, seg: 20 }); f.cyl("matte", 0.055, 0.055, 0.105, 0, 0.5, -0.04, 0x1a1210, { rx: HP + t, seg: 14 });
    f.box("wood", 0.06, 0.62, 0.03, 0, 1.0, -0.15, 0x3a2414, { rx: t }); f.box("wood", 0.09, 0.18, 0.04, 0, 1.38, -0.24, 0x2a1a10, { rx: t }); f.solid(0, 0, 0.42, 0.42, 0, 1.4); return f; }
  function skull(K, x, z, yaw, y) { var f = F(K, x, z, yaw, y); f.lathe("matte", [[0, -0.2], [0.05, -0.18], [0.09, -0.05], [0.12, 0.08], [0.1, 0.16], [0, 0.18]], 0, 0, 0.06, 0xe9e2d0, { seg: 12, sz: 0.55 }); [-1, 1].forEach(function (s) { f.tor("matte", 0.45, 0.035, s * 0.47, 0.25, 0.05, 0xe2d8c0, { arc: 1.25, rz: s > 0 ? PI + 0.2 : -0.2 - 1.25 + 0, ts: 12, rs: 6 }); f.sph("matte", 0.02, s * 0.06, 0.05, 0.12, 0x2a2420, { ws: 6, hs: 4 }); }); f.box("wood", 0.3, 0.38, 0.03, 0, 0.02, 0.0, 0x4a3020); return f; }
  function potRack(K, x, z, yaw, y, L) { var f = F(K, x, z, yaw, y); f.box("wood", L, 0.06, 0.32, 0, 0, 0, 0x4a3020); [-1, 1].forEach(function (s) { f.rod("metal", [s * (L / 2 - 0.1), 0, 0], [s * (L / 2 - 0.1), 1.6, 0], 0.008, IRON); });
    for (var i = 0; i < 5; i++) { var u = -L / 2 + 0.3 + i * (L - 0.6) / 4, r = 0.11 + (i % 3) * 0.03; f.rod("metal", [u, 0, 0.1], [u, -0.18, 0.1], 0.005, IRON, 3); f.cyl("metal", r, r * 0.85, 0.08, u, -0.24 - r, 0.1, [COPPER, IRON, COPPER, 0x3a3836, COPPER][i], { rx: HP, seg: 16 }); f.box("metal", 0.03, 0.18, 0.02, u, -0.18 - r * 0.2, 0.1, [COPPER, IRON, COPPER, 0x3a3836, COPPER][i]); } return f; }
  function firewood(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), L = o.len || 0.9, rows = o.rows || 4; for (var r = 0; r < rows; r++) for (var i = 0; i < 4 - (r % 2); i++) f.cyl("wood", 0.07, 0.07, L, -0.21 + i * 0.14 + (r % 2) * 0.07, 0.07 + r * 0.12, 0, [0x8a6a4a, 0x7a5a3a, 0x9a7a5a][(r + i) % 3], { rz: HP, ry: HP, seg: 7 });
    f.solid(0, 0, 0.6, L, 0, 0.1 + rows * 0.12); f.occ(0, 0, 0.6, L, 0.5, 0.6); return f; }
  function bunk(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), W = 1.0, Lb = 2.05, wc = o.wc || 0x6a4a30; [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { f.box("wood", 0.09, 1.9, 0.09, q[0] * (W / 2 + 0.04), 0.95, q[1] * (Lb / 2 + 0.04), wc); });
    [0.3, 1.35].forEach(function (yy, k) { f.box("wood", W + 0.1, 0.12, Lb + 0.1, 0, yy, 0, wc); f.rb("fabric", W - 0.04, 0.16, Lb - 0.06, 0.05, 0, yy + 0.14, 0, 0xf2efe9, { seg: 1 }); f.box("rug", W + 0.02, 0.04, Lb * 0.7, 0, yy + 0.24, 0.25, null, { uvr: k ? AT.rug.plaid : (o.quilt || AT.rug.quilt) }); f.rb("fabric", 0.6, 0.12, 0.36, 0.05, 0, yy + 0.3, -Lb / 2 + 0.3, 0xf4f2ee, { bulge: 0.03 }); });
    f.box("wood", 0.05, 0.05, Lb, -W / 2 - 0.04, 1.75, 0, wc); for (var r = 0; r < 4; r++) f.box("wood", 0.4, 0.04, 0.04, W / 2 + 0.04, 0.55 + r * 0.3, Lb / 2 + 0.06, wc, { ry: HP });
    f.solid(0, 0, W + 0.2, Lb + 0.2, 0, 0.5, { seat: true, face: HP }); f.solid(0, 0, W + 0.2, Lb + 0.2, 0.5, 1.95); f.occ(0, 0, W + 0.2, Lb + 0.2, 0.6, 0.9); return f; }
  function hay(K, x, z, yaw, n) { var f = F(K, x, z, yaw); for (var i = 0; i < n; i++) { var lx = (i % 2) * 1.02 - 0.5, ly = Math.floor(i / 2) * 0.46; f.rb("wood", 1.0, 0.45, 0.5, 0.05, lx, ly + 0.225, 0, 0xd9b45a, { seg: 1 }); f.box("matte", 0.02, 0.46, 0.51, lx - 0.25, ly + 0.225, 0, 0x8a6a3a); f.box("matte", 0.02, 0.46, 0.51, lx + 0.25, ly + 0.225, 0, 0x8a6a3a); }
    f.solid(0, 0, 2.1, 0.55, 0, Math.ceil(n / 2) * 0.46, { seat: n <= 2, face: 0 }); return f; }
  function sacks(K, x, z, yaw) { var f = F(K, x, z, yaw); for (var i = 0; i < 4; i++) f.rb("fabric", 0.45, 0.62, 0.28, 0.1, -0.5 + i * 0.34, 0.31 + (i === 2 ? 0.02 : 0), (i % 2) * 0.08, [0xc9b48a, 0xd8c8a0, 0xbfae8a, 0xd2c098][i], { seg: 2, bulge: 0.04, ry: (i - 1.5) * 0.15 }); f.solid(0, 0.04, 1.5, 0.4, 0, 0.64); return f; }
  function chessTable(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), wc = o.wc || 0x5a3e2b; f.box("wood", 0.8, 0.05, 0.8, 0, 0.74, 0, wc); legs4(f, "wood", 0.8, 0.8, 0.72, 0.03, wc, 0.07);
    for (var i = 0; i < 8; i++) for (var j = 0; j < 8; j++) f.box("matte", 0.06, 0.006, 0.06, -0.21 + i * 0.06, 0.768, -0.21 + j * 0.06, (i + j) % 2 ? 0x2a2420 : 0xe9e2d0, { ao: false });
    var pcs = [[0, 0], [2, 0], [5, 0], [7, 1], [3, 1], [1, 6], [4, 6], [6, 7], [3, 7], [2, 4], [5, 3]]; pcs.forEach(function (p, k) { var w = k < 5, h = 0.03 + (k % 3) * 0.015; f.lathe("gloss", [[0, 0], [0.018, 0], [0.012, h * 0.6], [0.01, h], [0, h + 0.008]], -0.21 + p[0] * 0.06, 0.771, -0.21 + p[1] * 0.06, w ? 0xf2ede4 : 0x1f1d1b, { seg: 8 }); });
    [-1, 1].forEach(function (s) { var p = f.w(0, s * 0.75); rawCall(K, function () { dchair(K, p[0], p[1], f.yaw + (s > 0 ? PI : 0), { style: "ladder", wc: wc, c: o.c || 0x8a3a2a }); }); }); f.solid(0, 0, 0.8, 0.8, 0, 0.76); f.occ(0, 0, 0.8, 0.8, 0.75, 0.5); return f; }
  function barCart(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), mc = o.mc || BRASS; [0.25, 0.75].forEach(function (yy) { f.box("gloss", 0.8, 0.02, 0.45, 0, yy, 0, 0x2a2420); }); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { f.rod("metal", [q[0] * 0.39, 0.06, q[1] * 0.21], [q[0] * 0.39, 0.85, q[1] * 0.21], 0.01, mc); }); [-1, 1].forEach(function (s) { f.tor("metal", 0.06, 0.012, s * 0.39, 0.06, 0.21, 0x1a1a1a, { ry: HP, ts: 12 }); });
    for (var i = 0; i < 5; i++) { var h = 0.24 + (i % 3) * 0.05; f.lathe("glass", [[0, 0], [0.04, 0], [0.042, h * 0.7], [0.015, h * 0.82], [0.013, h], [0, h]], -0.3 + i * 0.14, 0.76, -0.08, null, { seg: 10 }); f.cyl("gloss", 0.036, 0.036, h * 0.5, -0.3 + i * 0.14, 0.76 + h * 0.25, -0.08, [0x7a3a1a, 0xc98a2a, 0x3a5a2a, 0x9a2a2a, 0xe8c070][i], { seg: 10 }); }
    for (var g = 0; g < 4; g++) f.cyl("glass", 0.035, 0.03, 0.09, -0.2 + g * 0.13, 0.805, 0.12, null, { seg: 10 }); f.solid(0, 0, 0.82, 0.48, 0, 0.9); return f; }
  // a run of warm bulbs on a cord between two room points, sagging between them
  function stringLights(K, A, B, sag, n) { var f = F(K, 0, 0, 0, 0, true), P = []; for (var i = 0; i <= n; i++) { var t = i / n, y = A[1] + (B[1] - A[1]) * t - sag * 4 * t * (1 - t); P.push([A[0] + (B[0] - A[0]) * t, y, A[2] + (B[2] - A[2]) * t]); }
    for (var j = 0; j < n; j++) { f.rod("metal", P[j], P[j + 1], 0.004, 0x2a2420, 3); if (j % 2 === 0) f.sph("glow", 0.032, P[j][0], P[j][1] - 0.05, P[j][2], 0xffd28a, { uvr: WHITE, ws: 8, hs: 6, sy: 1.3 }); } return f; }
  function cushions(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), cs = o.c || [0xb5623a, 0xd9a441, 0x34405a]; f.rb("fabric", 0.75, 0.16, 0.75, 0.07, -0.4, 0.08, 0, cs[0], { bulge: 0.03, ry: 0.2 }); f.rb("fabric", 0.7, 0.16, 0.7, 0.07, 0.45, 0.08, 0.1, cs[1], { bulge: 0.03, ry: -0.3 }); f.rb("fabric", 0.5, 0.14, 0.46, 0.06, 0.0, 0.22, -0.35, cs[2], { bulge: 0.03, rx: -1.0 });
    f.cyl("fabric", 0.26, 0.28, 0.36, 0.95, 0.18, -0.3, o.pouf || 0xe9e2d3, { seg: 18 }); f.solid(-0.4, 0, 0.75, 0.75, 0, 0.18, { seat: true, face: 0 }); f.solid(0.45, 0.1, 0.7, 0.7, 0, 0.18, { seat: true, face: 0 }); f.solid(0.95, -0.3, 0.5, 0.5, 0, 0.36, { seat: true, face: 0 }); f.occ(0.2, 0, 1.8, 0.9, 0.2, 0.5); return f; }
  function basin(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), wc = o.wc || 0x6a4a30, L = o.len || 1.6; f.box("wood", L, 0.82, 0.55, 0, 0.41, 0, wc); for (var i = 0; i < 2; i++) f.box("wood", L / 2 - 0.02, 0.6, 0.02, -L / 4 + i * L / 2, 0.42, 0.28, shade(wc, 0.92)); f.box("wood", L + 0.04, 0.05, 0.6, 0, 0.845, 0, shade(wc, 1.15));
    f.lathe("gloss", [[0, 0], [0.12, 0], [0.2, 0.1], [0.21, 0.11], [0.19, 0.11], [0.1, 0.02]], -L / 4, 0.87, 0.02, 0xf2f0ea, { seg: 20 }); f.rod("metal", [-L / 4, 0.87, -0.24], [-L / 4, 1.15, -0.24], 0.012, COPPER); f.tor("metal", 0.08, 0.011, -L / 4, 1.15, -0.16, COPPER, { arc: PI, ry: HP, ts: 10 });
    mug(f, 0.2, 0.87, 0.05, 0x34405a); mug(f, 0.32, 0.87, -0.05, 0xf2f0ea); f.lathe("gloss", [[0, 0], [0.09, 0], [0.1, 0.12], [0.07, 0.2], [0.02, 0.22], [0, 0.22]], 0.6, 0.87, -0.05, o.kettle || 0xb5623a, { seg: 14 }); f.solid(0, 0, L, 0.55, 0, 0.88); f.occ(0, 0, L, 0.55, 0.85, 0.7); f.hot(0, 0.6, 1.4, "coffee"); return f; }
  function recordPlayer(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), wc = o.wc || 0x5a3e2b; f.box("wood", 1.0, 0.55, 0.42, 0, 0.36, 0, wc); legs4(f, "wood", 1.0, 0.42, 0.09, 0.015, shade(wc, 0.8), 0.06); for (var i = 0; i < 14; i++) f.box("matte", 0.012, 0.3, 0.3, -0.42 + i * 0.022, 0.26, 0.0, [0x1f1d1b, 0x8a3a2a, 0xe9e2d0, 0x34405a, 0xd9a441][i % 5]);
    f.box("wood", 0.44, 0.08, 0.34, 0.22, 0.675, 0, shade(wc, 1.2)); f.cyl("matte", 0.14, 0.14, 0.012, 0.2, 0.72, 0, 0x111111, { seg: 24 }); f.cyl("matte", 0.04, 0.04, 0.014, 0.2, 0.722, 0, 0xc9894a, { seg: 12 }); f.rod("metal", [0.38, 0.73, 0.12], [0.26, 0.74, -0.02], 0.005, CHROME); f.solid(0, 0, 1.0, 0.42, 0, 0.72); f.hot(0, 0.5, 1.3, "record"); return f; }
  // a billiards table: turned legs, a felt bed, rails and pockets, the balls mid-game and a cue across the rails
  function billiards(K, x, z, yaw, o) { o = o || {}; var f = F(K, x, z, yaw), L = 2.7, W = 1.5, wc = o.wc || 0x4a3020, felt = o.felt || 0x2f5a3e, R = o.R || Math.random;
    f.box("wood", L, 0.22, W, 0, 0.66, 0, wc); [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]].forEach(function (q) { if (q[0] === 0) return; f.lathe("wood", [[0.09, 0], [0.11, 0.06], [0.07, 0.14], [0.1, 0.3], [0.06, 0.48], [0.08, 0.56], [0, 0.56]], q[0] * (L / 2 - 0.16), 0, q[1] * (W / 2 - 0.16), wc, { seg: 12 }); });
    f.box("fabric", L - 0.2, 0.03, W - 0.2, 0, 0.785, 0, felt); [-1, 1].forEach(function (s) { f.box("wood", L + 0.04, 0.07, 0.12, 0, 0.82, s * (W / 2 - 0.02), wc); f.box("wood", 0.12, 0.07, W + 0.04, s * (L / 2 - 0.02), 0.82, 0, wc); f.box("fabric", L - 0.2, 0.05, 0.05, 0, 0.815, s * (W / 2 - 0.1), shade(felt, 0.8)); f.box("fabric", 0.05, 0.05, W - 0.2, s * (L / 2 - 0.1), 0.815, 0, shade(felt, 0.8)); });
    [[-1, -1], [0, -1], [1, -1], [-1, 1], [0, 1], [1, 1]].forEach(function (q) { f.cyl("matte", 0.06, 0.06, 0.02, q[0] * (L / 2 - 0.1), 0.858, q[1] * (W / 2 - 0.1), 0x0e0d0c, { seg: 12 }); }); for (var d = 0; d < 6; d++) f.sph("metal", 0.015, (d % 3 - 1) * (L / 2 - 0.1), 0.85, (d < 3 ? -1 : 1) * (W / 2 - 0.02), BRASS, { ws: 6, hs: 4 });
    var bc = [0xf2b134, 0x2e4a9a, 0xc8341a, 0x5a2a7a, 0xe0702a, 0x2a7a3e, 0x7a2a1a, 0x111111, 0xf2b134, 0x2e4a9a]; for (var i = 0; i < 10; i++) f.sph("gloss", 0.028, (R() - 0.5) * (L - 0.5), 0.828, (R() - 0.5) * (W - 0.45), bc[i], { ws: 10, hs: 8 }); f.sph("gloss", 0.028, L * 0.3, 0.828, 0.1, 0xf6f4ee, { ws: 10, hs: 8 });
    f.rod("wood", [L * 0.42, 0.9, 0.35], [-L * 0.2, 0.86, -0.1], 0.012, 0xc9a46a); f.solid(0, 0, L + 0.04, W + 0.04, 0, 0.86); f.occ(0, 0, L, W, 0.85, 0.8); f.hot(L / 2 + 0.5, 0, 1.3, "pool"); return f; }
  function cueRack(K, x, z, yaw, y) { var f = F(K, x, z, yaw, y); f.box("wood", 0.7, 0.12, 0.06, 0, 0, 0.03, 0x4a3020); f.box("wood", 0.7, 0.1, 0.06, 0, -1.25, 0.03, 0x4a3020); for (var i = 0; i < 5; i++) f.rod("wood", [-0.26 + i * 0.13, -1.3, 0.08], [-0.26 + i * 0.13, 0.05, 0.08], 0.011, 0xc9a46a); return f; }
  function coatRack(K, x, z, o) { o = o || {}; var f = F(K, x, z, o.yaw || 0), wc = o.wc || 0x5a3e2b; [0, 1, 2].forEach(function (k) { var a = k / 3 * TAU; f.rod("wood", [Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25], [0, 0.35, 0], 0.016, wc); }); f.rod("wood", [0, 0.3, 0], [0, 1.78, 0], 0.022, wc);
    for (var h2 = 0; h2 < 4; h2++) { var a2 = h2 / 4 * TAU + 0.4; f.rod("wood", [0, 1.62, 0], [Math.cos(a2) * 0.18, 1.74, Math.sin(a2) * 0.18], 0.01, wc); } hat(f, 0.12, 1.66, 0.08, o.hat || 0x6a4a30, 0.5); f.rb("fabric", 0.4, 0.75, 0.12, 0.05, -0.14, 1.28, -0.05, o.coat || 0x8a3a2a, { rz: 0.1, bulge: 0.02 }); f.solid(0, 0, 0.5, 0.5, 0, 1.8); return f; }

  // ── the ranch house: timber and stone, a leather sofa by a fieldstone fire, a cowhide rug, a farmhouse table under a wagon wheel ──
  function ranch(K, h, H, V) { var S = CW.ranch[V.cw], R = K.R, set = V.set, A = V.lay === 0, thr = RUG(S.thr);
    var ZL = A ? Zf(-3.9, -h + 0.1, 0) : Zf(-h + 0.1, -3.4, HP), ZK = A ? Zf(3.9, -h + 0.1, 0) : Zf(2.3, -h + 0.1, 0), ZD = A ? Zf(4.1, 2.2, HP) : Zf(4.3, 2.6, 0);
    // living: the fieldstone fireplace, the leather sofa, a cowhide, a rocker and a club chair, a guitar, firewood, the lamps
    var fp = ZL(0, 0.75); fireplace(K, fp[0], fp[1], ZL.a(0), { style: "stone", w: 2.6, d: 0.75, hgt: H, stoneKey: "stoneF", stoneC: 0xffffff, mantel: S.wood2, capC: 0xc9bca8 });
    var aa = ZL(0, 0.77); if (set === 1) skull(K, aa[0], aa[1], ZL.a(0), 2.55); else art(K, aa[0], aa[1], ZL.a(0), 2.5, S.art[0], 1.25, { frame: 0.06, fc: S.wood2 });
    [-1, 1].forEach(function (s) { var p = ZL(s * 1.05, 0.87); tableLamp(K, p[0], p[1], 1.7, { style: "lantern" }); }); var mb = ZL(0.45, 0.87); books(F(K, mb[0], mb[1], ZL.a(0), 1.7), 2, 0, 0, 0, R, { flat: true });
    var sp = ZL(0, 4.3); sofa(K, sp[0], sp[1], ZL.a(PI), { len: 2.5, style: "camel", mat: "leather", c: S.lea, pil: [{ uvr: thr }, { uvr: RUG(S.rug) }], throwUv: RUG("navajo"), throwSide: -1, legC: S.wood2 });
    var cw = ZL(0, 2.85); cowhide(K, cw[0], cw[1], ZL.a(HP + 0.15), 0.95); var ct = ZL(0, 2.85); coffee(K, ct[0], ct[1], ZL.a(0), { style: set === 2 ? "trunk" : "slab", len: 1.3, d: 0.7, tc: S.wood });
    var cd = ZL(0.1, 2.85); var fcd = F(K, cd[0], cd[1], ZL.a(0), set === 2 ? 0.38 : 0.38); books(fcd, 2, -0.4, 0, 0.05, R, { flat: true }); mug(fcd, 0.25, 0, 0.12, S.acc); candle(fcd, 0.05, 0, -0.15, 0.14);
    var rk = ZL(-2.1, 2.5); chair(K, rk[0], rk[1], ZL.a(1.95), { style: "rocker", wc: S.wood, cushion: S.acc, throwUv: thr }); var cc = ZL(2.15, 2.5); chair(K, cc[0], cc[1], ZL.a(-1.95), { style: set === 0 ? "club" : "wing", mat: "leather", c: S.lea, wc: S.wood2, pil: { uvr: RUG(S.rug) } });
    var st = ZL(-1.6, 4.35); sideTable(K, st[0], st[1], { style: "barrel", h: 0.62, tc: S.wood }); tableLamp(K, st[0], st[1], 0.62, { style: "lantern" }); var fl = ZL(1.75, 4.55); floorLamp(K, fl[0], fl[1], { style: "tripod", wc: S.wood2, shade: 0xffd9a4 }); F(K, fl[0], fl[1], 0).hot(0, 0, 1.2, "lights");
    var fw = ZL(-2.05, 0.45); firewood(K, fw[0], fw[1], ZL.a(0), { len: 0.8, rows: 4 }); var gt = ZL(1.95, 0.55); guitar(K, gt[0], gt[1], ZL.a(-0.4));
    var lr = ZL(0, 2.9); rug(K, lr[0], lr[1], ZL.a(0), 4.2, 3.2, RUG(S.rug === "navajo" ? "persian" : "navajo"), 0.008);
    // kitchen: painted cabinets under a butcher block, a plaster hood, open pantry shelves, the island with saddle stools
    var kr = ZK(0, 0.3); var KR = kitchenRun(K, kr[0], kr[1], ZK.a(0), { mods: ["base", "sink", "drawers", "range", "base", "tall"], cab: S.cab, top: 0xb08a5e, topKey: "wood", pull: IRON, uppers: "shelves", stock: AT.stock.pantry, shelfC: S.wood2, hood: "plaster", hoodKey: "plaster", hoodC: 0xece2d0, hoodTrim: S.wood2, hgt: H, splashKey: "gloss", splashC: 0xe8e0d0, seed: V.seed, kettle: 0x2f4a6a, rangeC: 0x1f1d1b, tap: BRASS, bowlC: 0x34405a });
    var ip = ZK(0, 3.0); island(K, ip[0], ip[1], ZK.a(0), { len: 2.3, d: 0.9, cab: S.wood, top: 0xb08a5e, topKey: "wood", legs: true, hgt: H, pull: IRON, stool: { style: "saddle", c: S.lea, wc: S.wood2 }, pendants: set !== 1, pstyle: "lantern", np: 2, bowlC: 0xe9e2d0 });
    if (set === 1) { var pr = ZK(0, 2.95); potRack(K, pr[0], pr[1], ZK.a(0), 2.75, 1.9); }
    // dining: the farmhouse trestle, ladder backs and a bench, a wagon wheel overhead, a hutch
    var dp = ZD(0, 0); diningSet(K, dp[0], dp[1], ZD.a(0), { table: { len: 2.4, d: 0.95, style: "trestle", tc: S.wood, lc: S.wood2 }, chair: { style: set === 2 ? "spindle" : "ladder", wc: S.wood2, c: S.acc, pad: S.acc }, benchBack: true, benchCushion: set === 0 ? S.acc : null, ends: set !== 1, endChair: { style: "spindle", wc: S.wood2, pad: S.acc }, center: set === 1 ? "bowl" : "candles", bowlC: 0xe9e2d0, runner: RUG(S.thr === "plaid" ? "navajo" : S.thr), R: R });
    chandelier(K, dp[0], dp[1], H, 2.35, { style: "wheel" }); F(K, dp[0], dp[1], 0).hot(0, 0, 1.8, "card"); var hb = A ? Zf(h - 0.1, -2.7, -HP) : Zf(4.3, h - 0.1, PI), hp = hb(0, 0.25); sideboard(K, hp[0], hp[1], hb.a(0), { len: 1.7, h: 0.86, wc: S.wood2, lamp: { style: "lantern" }, vc: 0x34405a, bc: 0xe9e2d0, R: R }); var ha = hb(0, 0.04); art(K, ha[0], ha[1], hb.a(0), 2.05, S.art[1], 1.2, { frame: 0.05, fc: S.wood2 });
    // the bedroom: a log bed under a quilt behind a half wall, lantern lamps, a trunk at the foot; or the bunkhouse's bunks, or the feed shed's tack room
    var ZB = Zf(-h + 0.1, 4.75, HP);
    if (V.special === "bunk") { [-1.6, 1.6].forEach(function (u) { var p = ZB(u, 1.1); bunk(K, p[0], p[1], ZB.a(0), { wc: S.wood2 }); }); var bt = ZB(0, 0.4); sideTable(K, bt[0], bt[1], { style: "square", h: 0.6, tc: S.wood2 }); tableLamp(K, bt[0], bt[1], 0.6, { style: "lantern" }); }
    else if (V.special === "tack") { [-2.1, -0.7, 0.7].forEach(function (u, i) { var p = ZB(u, 0.55); saddle(K, p[0], p[1], ZB.a(HP), { c: [S.lea, 0x4a2a18, 0xa0683e][i], blanket: [RUG("navajo"), RUG("plaid"), RUG("quilt")][i] }); }); var hy = ZB(0.9, 2.2); hay(K, hy[0], hy[1], ZB.a(0.1), 4); var sk = ZB(-1.4, 2.3); sacks(K, sk[0], sk[1], ZB.a(0)); var hr = ZB(0, 0.02); hatRack(K, hr[0], hr[1], ZB.a(0), 1.85, { n: 4, hats: 2, seed: V.seed }); }
    else { var bp = ZB(0, 1.12); bed(K, bp[0], bp[1], ZB.a(0), { style: "log", w: 1.8, frame: S.wood, duvet: S.fab, quilt: set === 0 ? RUG("quilt") : RUG(S.thr === "quilt" ? "navajo" : S.thr), pillows: [0xf4f2ee, 0xf4f2ee, S.acc], R: R });
      [-1, 1].forEach(function (s) { var p = ZB(s * 1.45, 0.32); sideTable(K, p[0], p[1], { style: "square", h: 0.6, tc: S.wood2, yaw: ZB.a(0) }); tableLamp(K, p[0], p[1], 0.6, { style: s < 0 ? "lantern" : "ceramic", c: 0xd8c2a0 }); });
      var ab = ZB(0, 0.03); art(K, ab[0], ab[1], ZB.a(0), 2.15, set === 2 ? "map" : "cowboy", 0.8, { frame: 0.05, fc: S.wood2 }); var tk = ZB(0, 2.62); coffee(K, tk[0], tk[1], ZB.a(HP), { style: "trunk", len: 1.1, d: 0.5, h: 0.48, tc: S.wood2 }); var br = ZB(0, 1.6); rug(K, br[0], br[1], ZB.a(0), 2.9, 2.4, RUG(S.rug === "persian" ? "navajo" : "persian")); }
    var pw = Zf(-4.9, 1.75, 0); for (var i = 0; i < 18; i++) K.put("oak", boxG(0.27, 1.25, 0.06), mtx((-h + 0.25 + i * 0.28) * K.mir, 0.625, 1.75), shade(S.plank, 1.1)); K.put("wood", boxG(5.3, 0.08, 0.14), mtx((-h + 2.75) * K.mir, 1.29, 1.75), S.wood2); K.put("wood", boxG(0.14, 2.3, 0.14), mtx((-h + 5.35) * K.mir, 1.15, 1.75), S.wood2); K.sol.push([(-h + 2.75) * K.mir, 1.75, 5.3, 0.12, 0, 1.33, 0, false, null]);
    plant(K, -h + 5.85, 2.3, { kind: "snake", h: 1.0, pot: "terra", pr: 0.2, ph: 0.36 });
    // reading corner: a bookcase, a wingback or club chair with a lamp, a stump table and coffee; the saddle on its stand; hats by the door
    var ZR = A ? Zf(h - 0.1, h - 1.5, -HP) : Zf(h - 0.1, -h + 1.8, -HP), bc = ZR(0.2, 0.18); bookcase(K, bc[0], bc[1], ZR.a(0), { w: 1.3, h: 2.2, wc: S.wood2 }); var rc = ZR(-0.3, 1.6); chair(K, rc[0], rc[1], ZR.a(0.4), { style: set === 0 ? "wing" : "club", mat: "leather", c: S.lea, wc: S.wood2, pil: { uvr: thr } });
    var rl = ZR(-1.1, 1.0); floorLamp(K, rl[0], rl[1], { style: "lamp", mc: IRON, shade: 0xffd9a4 }); var rs = ZR(0.6, 1.25); sideTable(K, rs[0], rs[1], { style: "stump", h: 0.5, tc: S.wood }); mug(F(K, rs[0], rs[1], 0, 0.5), 0, 0, 0, S.acc2);
    var sd = Zf(-3.3, h - 0.1, PI)(0, 1.4); saddle(K, sd[0], sd[1], PI + HP, { c: S.lea, blanket: RUG(S.thr === "plaid" ? "navajo" : "navajo") }); var hr2 = Zf(2.3, h - 0.1, PI); var hrp = hr2(0, 0.02); hatRack(K, hrp[0], hrp[1], hr2.a(0), 1.8, { n: 3, hats: 2 + (V.seed % 2), seed: V.seed });
    var bb = hr2(0, 0.35); bench(K, bb[0], bb[1], hr2.a(0), { len: 1.2, wc: S.wood2 }); var bootsF = F(K, bb[0] + 0.3, bb[1] - 0.05, hr2.a(0), 0); [-1, 1].forEach(function (s) { bootsF.rb("leather", 0.1, 0.3, 0.26, 0.04, s * 0.07, 0.15, 0.25, 0x5a3420); bootsF.rb("leather", 0.1, 0.06, 0.2, 0.03, s * 0.07, 0.03, 0.4, 0x5a3420); });
    plant(K, A ? 1.8 : -1.8, -h + 1.0, { kind: "pampas", h: 1.4, pot: "basket", pr: 0.2, ph: 0.4, noSolid: false });
    // the shell: board walls, a plank floor and ceiling, heavy beams, divided-light windows with curtains
    var fx = ZL(0, 0)[0], ops;
    if (A) ops = { B: [{ a0: fx - 3.2, a1: fx - 1.9, y0: 0.9, y1: 2.7, kind: "wood6" }, { a0: fx + 1.9, a1: fx + 3.0, y0: 0.9, y1: 2.7, kind: "wood6" }, { a0: ZK(KR.sinkU, 0)[0] - 0.6, a1: ZK(KR.sinkU, 0)[0] + 0.6, y0: 3.0, y1: 3.8, kind: "wood6" }],
      R: [{ a0: 0.6, a1: 3.8, y0: 0.9, y1: 2.7, kind: "wood6" }, { a0: -5.2, a1: -4.0, y0: 1.3, y1: 2.6, kind: "wood6" }], L: [{ a0: 6.4, a1: 7.3, y0: 1.0, y1: 2.5, kind: "wood6" }, { a0: 2.2, a1: 3.0, y0: 1.0, y1: 2.5, kind: "wood6" }, { a0: -6.6, a1: -5.0, y0: 0.9, y1: 2.6, kind: "wood6" }], F: [{ a0: -1.1, a1: 1.1, y0: 0, y1: 2.4, kind: "door" }, { a0: 3.6, a1: 5.0, y0: 0.9, y1: 2.6, kind: "wood6" }, { a0: -6.6, a1: -5.4, y0: 0.9, y1: 2.6, kind: "wood6" }] };
    else ops = { B: [{ a0: -6.8, a1: -5.4, y0: 0.9, y1: 2.6, kind: "wood6" }, { a0: 5.6, a1: 7.0, y0: 0.9, y1: 2.6, kind: "wood6" }, { a0: ZK(KR.sinkU, 0)[0] - 0.6, a1: ZK(KR.sinkU, 0)[0] + 0.6, y0: 3.0, y1: 3.8, kind: "wood6" }],
      R: [{ a0: 1.6, a1: 4.4, y0: 0.9, y1: 2.7, kind: "wood6" }], L: [{ a0: 6.4, a1: 7.3, y0: 1.0, y1: 2.5, kind: "wood6" }, { a0: 2.2, a1: 3.0, y0: 1.0, y1: 2.5, kind: "wood6" }, { a0: -6.7, a1: -5.4, y0: 0.9, y1: 2.6, kind: "wood6" }, { a0: -1.4, a1: -0.4, y0: 0.9, y1: 2.6, kind: "wood6" }], F: [{ a0: -1.1, a1: 1.1, y0: 0, y1: 2.4, kind: "door" }, { a0: 5.9, a1: 7.2, y0: 0.9, y1: 2.6, kind: "wood6" }, { a0: -6.6, a1: -5.4, y0: 0.9, y1: 2.6, kind: "wood6" }] };
    ["B", "R", "L", "F"].forEach(function (sd2) { wall(K, sd2, h, H, "oak", ops[sd2], { tint: S.wall, vista: V.vista, vh: 0.45, base: 0.16, baseKey: "wood", baseC: S.wood2, frameC: S.wood2, sillC: S.wood2, jamb: shade(S.wall, 0.95), jambKey: "oak", curtain: set === 2 ? null : S.fab, curtainH: 2.9 }); });
    doorK(K, h, { trim: S.wood2, leaf: S.wood, panels: true, handle: IRON });
    ceilingK(K, h, H, "oak", shade(S.plank, 1.2)); for (var bz = -h + 1.5; bz < h - 0.5; bz += 2.4) K.put("wood", boxG(2 * h, 0.32, 0.26), mtx(0, H - 0.16, bz), S.wood2, null, false); K.put("wood", boxG(0.3, 0.36, 2 * h), mtx(0, H - 0.5, 0), S.wood2, null, false);
    floorK(K, h, "oak", S.plank);
    return { lamp: [A ? -1.2 : -0.5, H - 0.7, -2.2], lampC: 0xffd2a0, lampI: 1.7, fillC: 0xffe8cc, fillG: 0x6a5038, fillI: 1.2, dog: V.dog ? { x: ZL(1.1, 1.95), yaw: ZL.a(-0.4), bed: S.acc2 } : null }; }

  // ── the lakehouse: a warm lodge great room, a river rock chimney to the trusses, a library wall and a sleeping loft up a timber stair ──
  function lodge(K, h, H, V) { var S = CW.lakehouse[V.cw], R = K.R, set = V.set, A = V.lay === 0, thr = RUG(S.thr), rock = [0xc8c2bc, 0xd8cdbf, 0xbfbab2, 0xd2c6b6][V.cw];
    var LH = 3.1, LX0 = h - 4.4, LZ1 = 1.2, SX0 = h - 1.25, NS = 15, RISE = LH / NS, TR = 0.27, cx = A ? -2.0 : -0.8;
    // living: the chimney on the back wall, a big sofa set on a rug, a sofa table with lamps behind, club chairs
    var ZL = Zf(cx, -h + 0.1, 0), fp = ZL(0, 0.9); fireplace(K, fp[0], fp[1], ZL.a(0), { style: "stone", w: 3.4, d: 0.9, ow: 1.4, oh: 1.05, hgt: H, stoneKey: "stoneF", stoneC: rock, mantel: 0x4a3020, capC: 0xb9ae9e });
    var aa = ZL(0, 0.92); art(K, aa[0], aa[1], ZL.a(0), 3.2, S.art[0], 1.7, { frame: 0.07, fc: 0x3a2a1e }); [-1, 1].forEach(function (s) { var p = ZL(s * 1.3, 1.05); tableLamp(K, p[0], p[1], 2.04, { style: "lantern" }); }); var mb = ZL(-0.5, 1.05); vase(F(K, mb[0], mb[1], 0, 2.04), 0, 0, 0, S.acc, 0.3, 2);
    var lr = ZL(0, 3.6); rug(K, lr[0], lr[1], ZL.a(0), 5.0, 3.8, RUG(S.rug)); var pil = [{ uvr: thr }, { c: S.acc }, { uvr: thr }, { c: 0xe9e2d3 }];
    if (set === 0) { var sp = ZL(0, 5.2); sofa(K, sp[0], sp[1], ZL.a(PI), { len: 3.2, style: "roll", c: S.fab, pil: pil, legC: 0x3a2a1e }); var s2 = ZL(-2.4, 3.6); sofa(K, s2[0], s2[1], ZL.a(HP), { len: 2.4, style: "roll", c: S.fab, pil: [{ uvr: thr }, { c: S.acc }], legC: 0x3a2a1e }); var c2 = ZL(2.3, 3.4); chair(K, c2[0], c2[1], ZL.a(-HP), { style: "club", mat: "leather", c: S.lea, pil: { uvr: thr } }); }
    else if (set === 1) { var sp2 = ZL(0, 5.2); sofa(K, sp2[0], sp2[1], ZL.a(PI), { len: 2.9, style: "camel", mat: "leather", c: S.lea, pil: pil, throwUv: thr, legC: 0x3a2a1e }); [-1, 1].forEach(function (s) { var p = ZL(s * 2.25, 3.3); chair(K, p[0], p[1], ZL.a(-s * HP), { style: "wing", c: S.fab, pil: { c: S.acc } }); }); }
    else { [-1, 1].forEach(function (s) { var p = ZL(s * 2.05, 3.6); sofa(K, p[0], p[1], ZL.a(-s * HP), { len: 2.6, style: "roll", c: s < 0 ? S.fab : S.fab, pil: [{ uvr: thr }, { c: S.acc }], legC: 0x3a2a1e }); }); var o5 = ZL(0, 5.0); ottoman(K, o5[0], o5[1], ZL.a(0), { w: 1.3, d: 0.7, c: S.lea, mat: "leather" }); }
    var ct = ZL(0, 3.5); coffee(K, ct[0], ct[1], ZL.a(0), { style: set === 1 ? "trunk" : "slab", len: 1.5, d: 0.8, tc: S.wood }); var fcd = F(K, ct[0], ct[1], ZL.a(0), set === 1 ? 0.38 : 0.38); books(fcd, 3, -0.45, 0, 0.0, R, { flat: true }); bowl(fcd, 0.3, 0, 0.05, 0.15, 0x34405a, false); candle(fcd, 0.05, 0, -0.2, 0.15); mug(fcd, -0.1, 0, 0.22, S.acc);
    if (set !== 2) { var stb = ZL(0, 5.95); table(K, stb[0], stb[1], ZL.a(0), { len: 2.2, d: 0.42, h: 0.78, tc: S.wood, lc: S.wood }); [-1, 1].forEach(function (s) { var p = ZL(s * 0.8, 5.95); tableLamp(K, p[0], p[1], 0.78, { style: "ceramic", c: 0x9a8a72 }); }); var bk = ZL(0, 5.95); books(F(K, bk[0], bk[1], ZL.a(PI), 0.78), 5, -0.1, 0, 0, R); }
    var fl = ZL(-2.9, 5.3); floorLamp(K, fl[0], fl[1], { style: "tripod", wc: 0x3a2a1e }); F(K, fl[0], fl[1], 0).hot(0, 0, 1.2, "lights"); var fw = ZL(-2.3, 0.5); firewood(K, fw[0], fw[1], ZL.a(0), { len: 0.9, rows: 5 }); var pl = ZL(2.4, 0.5); plant(K, pl[0], pl[1], { kind: "fig", h: 2.3, pot: "basket", pr: 0.3, ph: 0.5 });
    // the library wall: three bookcases, a wingback and ottoman, a lamp, the chess table
    var ZB2 = A ? Zf(-h + 0.1, -4.6, HP) : Zf(-h + 0.1, 5.2, HP); [-1.42, 0, 1.42].forEach(function (u) { var p = ZB2(u, 0.2); bookcase(K, p[0], p[1], ZB2.a(0), { w: 1.38, h: 2.5, wc: S.wood }); }); var wb = ZB2(-1.4, 1.9); chair(K, wb[0], wb[1], ZB2.a(0.5), { style: "wing", mat: "leather", c: S.lea, pil: { uvr: thr } }); var ob = ZB2(-0.6, 2.4); ottoman(K, ob[0], ob[1], 0, { w: 0.6, d: 0.5, h: 0.4, c: S.acc, noSeat: false });
    var lb = ZB2(-2.3, 1.3); floorLamp(K, lb[0], lb[1], { style: "lamp", mc: IRON, shade: 0xffd9a4 }); var cht = ZB2(1.2, 2.6); chessTable(K, cht[0], cht[1], ZB2.a(HP), { wc: S.wood, c: S.acc });
    // dining: the trestle for ten under an iron ring of candles
    var ZD = A ? Zf(-5.6, 5.2, HP) : Zf(-6.2, -5.4, HP), dp = ZD(0, 0); rug(K, dp[0], dp[1], ZD.a(0), 4.6, 3.2, RUG(S.rug === "persian" ? "navajo" : "persian"));
    diningSet(K, dp[0], dp[1], ZD.a(0), { table: { len: 3.0, d: 1.0, style: "trestle", tc: S.wood, lc: 0x3a2a1e }, chair: { style: set === 1 ? "cross" : "ladder", wc: 0x3a2a1e, c: S.acc, seatC: 0xb08a5e }, ends: true, endChair: { style: "ladder", wc: 0x3a2a1e, c: S.acc }, center: "candles", runner: thr, settings: set !== 2, R: R });
    chandelier(K, dp[0], dp[1], H, 3.0, { style: "ring", r: 0.8 }); F(K, dp[0], dp[1], 0).hot(0, 0, 1.9, "card"); var sbz = A ? Zf(-h + 0.1, 5.2, HP) : Zf(-h + 0.1, -5.4, HP); if (!A || true) { var sb = sbz(0, 0.25); if (A) sideboard(K, sb[0], sb[1], sbz.a(0), { len: 2.0, h: 0.86, wc: S.wood, lamp: { style: "lantern" }, vc: S.acc, R: R }); }
    // under the loft: the kitchen along the right wall, the island, pendants from the loft beams
    var ZK = Zf(h - 0.1, -5.2, -HP), kr = ZK(0, 0.3); kitchenRun(K, kr[0], kr[1], ZK.a(0), { mods: ["tall", "base", "sink", "drawers", "range", "base", "drawers", "tall"], cab: S.cab, top: 0x3a3836, topKey: "gloss", pull: BRASS, uppers: "cabinets", hood: "plaster", hoodKey: "stoneF", hoodC: rock, hoodTrim: 0x4a3020, hgt: 2.85, splashKey: "stoneS", splashC: 0xd8cdbf, splashH: 0.6, seed: V.seed + 2, kettle: S.acc, tap: BRASS });
    var ip = ZK(0, 3.0); island(K, ip[0], ip[1], ZK.a(0), { len: 2.7, d: 1.0, cab: S.wood, top: 0xb08a5e, topKey: "wood", legs: true, hgt: 2.85, stool: { style: "saddle", c: S.lea, wc: 0x3a2a1e, h: 0.76 }, pstyle: "lantern", np: 2, bowlC: 0xe9e2d0 });
    // the loft: deck, joists, posts, a railing with balusters, the timber stair against the right wall
    K.put("oak", boxG(4.4, 0.24, h + LZ1), mtx((LX0 + 2.2) * K.mir, LH - 0.12, (-h + LZ1) / 2), 0xc09a70, null, false); K.put("wood", boxG(0.3, 0.36, h + LZ1 + 0.1), mtx((LX0 + 0.15) * K.mir, LH - 0.2, (-h + LZ1) / 2), 0x4a3020, null, false); K.put("wood", boxG(4.4, 0.32, 0.3), mtx((LX0 + 2.2) * K.mir, LH - 0.18, LZ1 - 0.15), 0x4a3020, null, false);
    for (var jz = -h + 1.0; jz < LZ1 - 0.5; jz += 1.3) K.put("wood", boxG(4.3, 0.2, 0.14), mtx((LX0 + 2.2) * K.mir, LH - 0.34, jz), 0x5a3e2b, null, false);
    [-h + 2.4, -3.2, LZ1 - 0.2].forEach(function (pz) { K.put("wood", boxG(0.26, LH - 0.36, 0.26), mtx((LX0 + 0.15) * K.mir, (LH - 0.36) / 2, pz), 0x4a3020); K.sol.push([(LX0 + 0.15) * K.mir, pz, 0.28, 0.28, 0, LH - 0.36, 0, false, null]); });
    K.sol.push([(LX0 + 2.2) * K.mir, (-h + LZ1) / 2, 4.4, h + LZ1, LH - 0.3, LH, 0, false, null, null, "step"]);
    var rail = function (x0, z0, x1, z1) { var L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(L / 0.13)), yaw = Math.atan2(x1 - x0, z1 - z0); for (var i = 0; i <= n; i++) { var t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, post = i % 10 === 0 || i === n; K.put("wood", boxG(post ? 0.12 : 0.04, 0.95, post ? 0.12 : 0.04), mtx(x * K.mir, LH + 0.475, z), post ? 0x4a3020 : 0x6a4a30); }
      K.put("wood", boxG(0.1, 0.07, L + 0.1), mtx(((x0 + x1) / 2) * K.mir, LH + 0.98, (z0 + z1) / 2, yaw * K.mir), 0x4a3020); K.put("wood", boxG(0.06, 0.05, L), mtx(((x0 + x1) / 2) * K.mir, LH + 0.12, (z0 + z1) / 2, yaw * K.mir), 0x4a3020); K.sol.push([((x0 + x1) / 2) * K.mir, (z0 + z1) / 2, 0.1, L, LH, LH + 1.0, yaw * K.mir, false, null]); };
    rail(LX0 + 0.06, -h + 0.15, LX0 + 0.06, LZ1 - 0.05); rail(LX0 + 0.06, LZ1 - 0.05, SX0 - 0.05, LZ1 - 0.05);
    for (var k = 1; k < NS; k++) { var ty = k * RISE, tz = LZ1 + (NS - k - 0.5) * TR; K.put("wood", boxG(1.15, 0.06, TR + 0.03), mtx(((SX0 + h - 0.1) / 2) * K.mir, ty - 0.03, tz), 0x8a6a48); K.sol.push([((SX0 + h - 0.1) / 2) * K.mir, tz, 1.15, TR, 0, ty, 0, false, null, null, "step"]); K.sol.push([(SX0 - 0.04) * K.mir, tz, 0.06, TR, ty, ty + 0.95, 0, false, null]);
      if (k % 2 === 0) K.put("wood", boxG(0.04, 0.9, 0.04), mtx((SX0 + 0.02) * K.mir, ty + 0.45, tz), 0x6a4a30); }
    var sz0 = LZ1 + (NS - 1) * TR, sl = Math.hypot(sz0 - LZ1, LH), sa = Math.atan2(LH, sz0 - LZ1); [SX0 + 0.04, h - 0.14].forEach(function (sx) { K.put("wood", boxG(0.08, 0.3, sl), mtx(sx * K.mir, LH / 2 - 0.12, (sz0 + LZ1) / 2, 0, sa), 0x4a3020); });
    K.put("wood", boxG(0.08, 0.07, sl + 0.2), mtx((SX0 + 0.02) * K.mir, LH / 2 + 0.95, (sz0 + LZ1) / 2, 0, sa), 0x4a3020); K.put("wood", boxG(0.12, LH + 1.0, 0.12), mtx((SX0 + 0.02) * K.mir, (LH + 1.0) / 2, LZ1 - 0.02), 0x4a3020); K.put("wood", boxG(0.12, 1.0, 0.12), mtx((SX0 + 0.02) * K.mir, 0.5, sz0 + 0.1), 0x4a3020);
    firewood(K, h - 0.65, LZ1 + 1.1, 0, { len: 0.9, rows: 3 });
    // the loft bedroom: a timber bed under a quilt, nightstands, a chest, an armchair by the window, plants
    K.y0 = LH; var ZB = Zf(h - 0.1, A ? -5.6 : -5.0, -HP), bp = ZB(0, 1.12); bed(K, bp[0], bp[1], ZB.a(0), { style: "timber", w: 1.9, frame: 0x6a4a30, duvet: 0xf2ede4, quilt: RUG(S.thr === "quilt" ? "navajo" : "quilt"), pillows: [0xf4f2ee, 0xf4f2ee, S.acc], accUv: thr, R: R });
    [-1, 1].forEach(function (s) { var p = ZB(s * 1.5, 0.3); sideTable(K, p[0], p[1], { style: "square", h: 0.6, tc: 0x5a3e2b }); tableLamp(K, p[0], p[1], 0.6, { style: "lantern" }); }); var ba = ZB(0, 0.03); art(K, ba[0], ba[1], ZB.a(0), 1.65, S.art[1], 1.1, { frame: 0.05, fc: 0x3a2a1e });
    var chs = ZB(0, 2.65); coffee(K, chs[0], chs[1], ZB.a(HP), { style: "trunk", len: 1.2, d: 0.55, h: 0.5, tc: 0x6a4a30 }); var br = ZB(0, 1.6); rug(K, br[0], br[1], ZB.a(0), 3.0, 2.6, RUG(S.rug === "navajo" ? "beni" : "navajo"));
    var lc = ZB(-3.3, 1.6); chair(K, lc[0], lc[1], ZB.a(PI * 0.15), { style: "club", mat: "leather", c: S.lea, pil: { uvr: thr } }); var lfl = ZB(-4.0, 0.8); floorLamp(K, lfl[0], lfl[1], { style: "lamp", mc: IRON }); var lpl = ZB(3.6, 0.5); plant(K, lpl[0], lpl[1], { kind: "snake", h: 1.0, pot: "black", pr: 0.18, ph: 0.34 });
    K.y0 = 0;
    // the middle of the great room: the billiards table under a pair of lanterns, a cue rack, a big rug in the entry
    var bl = A ? [2.6, -1.4] : [-4.2, -0.4]; billiards(K, bl[0], bl[1], 0, { wc: 0x4a3020, felt: [0x2f5a3e, 0x6a2a24, 0x2e3b52, 0x3e5a3a][V.cw], R: R }); [-0.7, 0.7].forEach(function (dx) { pendant(K, bl[0] + dx, bl[1], H, 1.85, { style: "dome", mc: 0x2f5a3e }); }); var cq = A ? Zf(h - 4.6, 1.5, -HP) : Zf(-h + 0.1, -0.4, HP); var cqp = cq(0, 0.02); if (!A) cueRack(K, cqp[0], cqp[1], cq.a(0), 2.1);
    rug(K, 0, 5.4, 0, 3.2, 4.6, RUG(S.rug === "navajo" ? "beni" : "navajo"));
    // the front of the room: the record cabinet, a bar cart, an entry bench under coat hooks, a big plant either side of the door
    var ZF = Zf(4.6, h - 0.1, PI), rp = ZF(0, 0.3); recordPlayer(K, rp[0], rp[1], ZF.a(0), { wc: S.wood }); var ra = ZF(0, 0.04); art(K, ra[0], ra[1], ZF.a(0), 1.8, "map", 1.4, { frame: 0.05, fc: 0x3a2a1e });
    var bcp = A ? [6.9, 7.6] : [-3.0, 7.9]; barCart(K, bcp[0], bcp[1], A ? -HP + 0.3 : PI, { mc: BRASS }); [-1, 1].forEach(function (s) { plant(K, s * 1.8, h - 0.7, { kind: s < 0 ? "paradise" : "fig", h: 2.0, pot: "terra", pr: 0.3, ph: 0.5 }); });
    var ZE = Zf(-3.4, h - 0.1, PI), eb = ZE(0, 0.32); if (A) { bench(K, eb[0], eb[1], ZE.a(0), { len: 1.6, wc: S.wood, cushion: S.acc }); var hk = ZE(0, 0.02); hatRack(K, hk[0], hk[1], ZE.a(0), 1.75, { n: 4, hats: 2, seed: V.seed }); }
    var gn = A ? [3.7, 4.6] : [3.9, 4.0]; chair(K, gn[0] - 0.95, gn[1], HP, { style: "club", mat: "leather", c: S.lea, pil: { c: S.acc } }); chair(K, gn[0] + 0.95, gn[1], -HP, { style: "club", mat: "leather", c: S.lea, pil: { uvr: thr } }); sideTable(K, gn[0], gn[1], { style: "round", tc: S.wood, mc: IRON }); var gt2 = F(K, gn[0], gn[1], 0, 0.55); mug(gt2, 0.08, 0, 0, S.acc); books(gt2, 2, -0.15, 0, 0.05, R, { flat: true }); rug(K, gn[0], gn[1], 0, 3.0, 2.0, RUG(S.rug === "persian" ? "beni" : "persian")); floorLamp(K, gn[0] - 1.6, gn[1] - 0.6, { style: "lamp", mc: IRON });
    // the shell: log walls, a plank floor and a boarded ceiling, king post trusses, tall divided windows, the lodge glow
    var ops = { B: [{ a0: cx - 4.2, a1: cx - 2.3, y0: 0.6, y1: 5.4, kind: "lodge" }, { a0: cx + 2.3, a1: cx + 4.2, y0: 0.6, y1: 5.4, kind: "lodge" }, { a0: 7.0, a1: 9.2, y0: 3.7, y1: 5.5, kind: "lodge" }],
      R: [{ a0: -9.6, a1: -8.0, y0: 3.8, y1: 5.5, kind: "lodge" }, { a0: -2.6, a1: -0.6, y0: 3.8, y1: 5.5, kind: "lodge" }, { a0: 6.4, a1: 9.0, y0: 0.8, y1: 3.2, kind: "lodge" }],
      L: A ? [{ a0: 3.2, a1: 7.2, y0: 0.8, y1: 3.2, kind: "lodge" }, { a0: -7.0, a1: -2.2, y0: 3.4, y1: 5.4, kind: "lodge" }] : [{ a0: -7.6, a1: -3.2, y0: 0.8, y1: 3.2, kind: "lodge" }, { a0: 2.8, a1: 7.6, y0: 3.4, y1: 5.4, kind: "lodge" }],
      F: [{ a0: -1.1, a1: 1.1, y0: 0, y1: 2.4, kind: "door" }, { a0: -7.6, a1: -5.2, y0: 0.8, y1: 3.2, kind: "lodge" }, { a0: 2.4, a1: 3.4, y0: 3.4, y1: 5.4, kind: "lodge" }] };
    ["B", "R", "L", "F"].forEach(function (sd) { wall(K, sd, h, H, "logs", ops[sd], { tint: S.logs, vista: V.vista, vh: 0.42, base: 0.18, baseKey: "wood", baseC: 0x4a3020, frameC: 0x3a2a1e, sillC: 0x4a3020, jamb: 0xc09a70, jambKey: "oak", curtain: set === 1 ? null : S.fab === 0xa8865a ? 0x8a3a2a : 0xd8c8b0, curtainH: 3.4 }); });
    doorK(K, h, { trim: 0x3a2a1e, leaf: 0x6a4a30, panels: true, handle: IRON });
    ceilingK(K, h, H, "oak", 0xb08a5e); for (var tz2 = -h + 1.6; tz2 < h - 0.5; tz2 += 3.4) { var tf = F(K, 0, tz2, 0, 0, true); tf.box("wood", 2 * h, 0.34, 0.26, 0, 5.3, 0, 0x4a3020, { ao: false }); tf.box("wood", 0.3, H - 5.3, 0.26, 0, 5.3 + (H - 5.3) / 2, 0, 0x4a3020, { ao: false }); [-1, 1].forEach(function (s) { if (s !== K.mir) tf.box("wood", 1.6, 0.2, 0.2, s * (h - 0.75), 4.75, 0, 0x4a3020, { ao: false, rz: -s * 0.75 }); }); }
    floorK(K, h, "oak", 0xa07a52);
    return { lamp: [cx + 1.5, H - 1.8, -3.0], lampC: 0xffd2a0, lampI: 1.9, fillC: 0xffe6c8, fillG: 0x6a5038, fillI: 1.15, dog: V.dog ? { x: ZL(1.3, 2.0), yaw: ZL.a(-0.5), bed: S.acc } : null }; }

  // ── the glamp: inside the round bell tent its model shows outside: a canvas wall on a ring of poles, a cone of canvas up to the
  //    centre pole, a wood stove, an iron (or a canopy) bed piled with quilts, string lights down the spokes ──
  // a curved canvas wall: panels between angles (0 = the front, +z; positive toward +x), windows cut where asked, the door arc left open
  function roundWall(K, R0, WH, key, tint, wins, door) { var P = [], N = [], U = [], CC = [], n = 56;
    var quad = function (a0, a1, y0, y1) { var p = [[Math.sin(a0) * R0, y0, Math.cos(a0) * R0], [Math.sin(a1) * R0, y0, Math.cos(a1) * R0], [Math.sin(a1) * R0, y1, Math.cos(a1) * R0], [Math.sin(a0) * R0, y1, Math.cos(a0) * R0]], am = (a0 + a1) / 2, nx = -Math.sin(am), nz = -Math.cos(am);
      [[0, 2, 1, 1], [0, 3, 2, 1], [0, 1, 2, -1], [0, 2, 3, -1]].forEach(function (t) { var sg = t[3]; t.slice(0, 3).forEach(function (j) { var v = p[j]; P.push(v[0], v[1], v[2]); N.push(nx * sg, 0, nz * sg); U.push((j === 1 || j === 2 ? a1 : a0) * R0, v[1]); var k = (1 - 0.3 * Math.exp(-v[1] / 0.35)) * (1 - 0.15 * Math.exp(-(WH - v[1]) / 0.4)); CC.push(k, k, k); }); }); };
    for (var i = 0; i < n; i++) { var a0 = -PI + TAU * i / n, a1 = -PI + TAU * (i + 1) / n, am = (a0 + a1) / 2; if (Math.abs(am) < door) continue; var w = null; for (var q = 0; q < wins.length; q++) if (Math.abs(am - wins[q]) < 0.17) w = wins[q];
      if (w === null) quad(a0, a1, 0, WH); else { quad(a0, a1, 0, 0.95); quad(a0, a1, 2.0, WH); } }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(CC, 3)); K.put(key, g, new THREE.Matrix4(), tint, null, false); }
  // the canvas cone from the wall top (R0, WH) to the pole crown (rc, RH), sagging a little between nsp spokes; normals face down into the tent
  function coneRoof(K, R0, WH, RH, rc, key, tint, nsp) { var P = [], N = [], U = [], CC = [], na = 64, nt = 9;
    var pt = function (a, t) { var fr = ((a + PI) / TAU * nsp) % 1, sag = 0.1 * Math.sin(PI * fr) * Math.sin(PI * t), r = R0 + (rc - R0) * t; return [Math.sin(a) * r, WH + (RH - WH) * t - sag, Math.cos(a) * r]; };
    for (var i = 0; i < na; i++) for (var j = 0; j < nt; j++) { var a0 = -PI + TAU * i / na, a1 = -PI + TAU * (i + 1) / na, t0 = j / nt, t1 = (j + 1) / nt, A = pt(a0, t0), B = pt(a1, t0), C2 = pt(a1, t1), D = pt(a0, t1);
      [[A, C2, B], [A, D, C2]].forEach(function (tr) { var ux = tr[1][0] - tr[0][0], uy = tr[1][1] - tr[0][1], uz = tr[1][2] - tr[0][2], vx = tr[2][0] - tr[0][0], vy = tr[2][1] - tr[0][1], vz = tr[2][2] - tr[0][2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l; var p = tr;
        if (ny > 0) { p = [tr[0], tr[2], tr[1]]; nx = -nx; ny = -ny; nz = -nz; } p.forEach(function (v) { P.push(v[0], v[1], v[2]); N.push(nx, ny, nz); var aa = Math.atan2(v[0], v[2]); U.push(aa * 3, Math.hypot(v[0], v[2])); var k = 0.8 + 0.2 * (v[1] - WH) / (RH - WH); CC.push(k, k, k); }); }); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(CC, 3)); K.put(key, g, new THREE.Matrix4(), tint, null, false); }
  function glamp(K, h, H, V) { var S = CW.glamp[V.cw], R = K.R, set = V.set, A = V.lay === 0, R0 = Math.min(h - 0.2, 4.95), WH = 2.3, RH = 4.7, wc = S.wood, mr = K.mir;
    var at = function (deg, r) { var a = deg * PI / 180; return [Math.sin(a) * r, Math.cos(a) * r]; }, faceIn = function (p) { return Math.atan2(-p[0], -p[1]); }, coneY = function (r) { return WH + (RH - WH) * (1 - r / R0); };
    // the bed against the back of the round wall: iron and brass, or (the other layout) a timber canopy bed hung with linen
    var bz = -R0 + 0.2 + 1.07; bed(K, 0, bz, 0, { style: A ? "iron" : "timber", w: 1.7, iron: S.iron, frame: wc, duvet: 0xf4efe4, quilt: RUG(S.quilt), pillows: [0xf4f2ee, 0xf2ede4, S.acc], accUv: RUG(S.quilt === "plaid" ? "navajo" : "plaid"), R: R });
    if (!A) { var cf = F(K, 0, bz, 0); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { cf.box("wood", 0.09, 2.15, 0.09, q[0] * 0.98, 1.075, q[1] * 1.12, wc); }); [-1, 1].forEach(function (s) { cf.box("wood", 2.05, 0.08, 0.08, 0, 2.17, s * 1.12, wc); cf.box("wood", 0.08, 0.08, 2.3, s * 0.98, 2.17, 0, wc); }); [-1, 1].forEach(function (s) { [-1, 1].forEach(function (s2) { cf.put("fabric", drapeG(0.5, 2.0, 0.12, 0.03), s * 1.0, 0.13, s2 * 1.1, 0xf2ede4, { ry: HP * s, ao: false }); }); }); }
    [-1, 1].forEach(function (s) { var p = [s * 1.42, bz - 0.62]; F(K, p[0], p[1], 0).box("wood", 0.5, 0.52, 0.4, 0, 0.26, 0, wc).box("wood", 0.46, 0.02, 0.36, 0, 0.27, 0.02, shade(wc, 0.6)).solid(0, 0, 0.5, 0.4, 0, 0.52); books(F(K, p[0], p[1], 0, 0.02), 4, -0.18, 0, 0.0, R); tableLamp(K, p[0], p[1], 0.52, { style: "lantern" }); });
    F(K, 0, -R0 + 0.12, 0, 1.25).put("leaf", planeG(0.62, 0.62 / LEAF_ASP.macrame), 0, 0.52, 0, 0xffffff, { uvr: AT.leaf.macrame, ao: false }); rug(K, 0, bz + 0.35, 0, 2.6, 2.1, RUG(S.rug)); coffee(K, 0, bz + 1.55, HP, { style: "trunk", len: 1.0, d: 0.5, h: 0.46, tc: wc });
    // the stove on its hearth with its pipe up through the cone, firewood, two chairs and a trunk table on a flatweave
    var sv = at(-112, 3.85), syaw = faceIn(sv); fireplace(K, sv[0], sv[1], syaw, { style: "stove", pipe: coneY(3.85) + 0.55, hearth: [1.2, 1.1] }); var fw = at(-138, 3.9); firewood(K, fw[0], fw[1], faceIn(fw) + HP, { len: 0.8, rows: 3 });
    var lv = [-1.85, 0.45]; rug(K, lv[0], lv[1], 0.25, 2.4, 1.8, RUG(S.rug === "navajo" ? "persian" : "navajo")); coffee(K, lv[0], lv[1], HP + 0.25, { style: "trunk", len: 0.85, d: 0.48, h: 0.42, tc: shade(wc, 0.85) }); var lt = F(K, lv[0], lv[1], 0, 0.42); mug(lt, 0.1, 0, 0.05, S.acc); candle(lt, -0.15, 0, -0.05, 0.1); books(lt, 2, 0.0, 0, -0.12, R, { flat: true });
    var toS = function (x, z) { return Math.atan2(sv[0] - x, sv[1] - z); }, c1 = [-2.35, 1.55], c2 = [-0.75, -0.35];
    chair(K, c1[0], c1[1], toS(c1[0], c1[1]), { style: set === 1 ? "lounge" : "club", mat: set === 1 ? "fabric" : "leather", c: set === 1 ? S.acc : 0x6e4a32, pil: { uvr: RUG(S.quilt) } }); chair(K, c2[0], c2[1], toS(c2[0], c2[1]), { style: "campaign", c: S.can === 0xf8f3e8 ? 0xd8cbb4 : 0xe9e2d0, wc: wc, cushion: S.acc2 });
    // the kitchenette: an enamel basin in a timber sideboard and an open shelf of jars and enamelware behind it
    var kp = at(100, 4.0), kyaw = faceIn(kp); basin(K, kp[0], kp[1], kyaw, { wc: wc, len: 1.5, kettle: S.acc }); var ks = at(100, 4.42); F(K, ks[0], ks[1], kyaw).box("wood", 1.5, 0.05, 0.3, 0, 1.05, 0, wc).box("wood", 1.5, 0.05, 0.3, 0, 1.6, 0, wc).box("wood", 1.5, 0.05, 0.3, 0, 2.1, 0, wc).box("wood", 0.05, 2.1, 0.3, -0.75, 1.05, 0, wc).box("wood", 0.05, 2.1, 0.3, 0.75, 1.05, 0, wc).quad("stock", 1.42, 1.0, 0, 1.6, -0.12, 0xffffff, AT.stock.pantry).solid(0, 0, 1.5, 0.3, 0, 2.1);
    // dining for two; the reading nook of floor cushions, a pouf, a crate of books, pampas and a tripod lamp; a monstera; a coat rack by the door
    var dn = at(48, 3.2); F(K, dn[0], dn[1], 0).hot(0, 0, 1.3, "card"); diningSet(K, dn[0], dn[1], 0.5, { table: { len: 0.9, style: "round", tc: wc, lc: shade(wc, 0.8), h: 0.74 }, nRound: 2, chair: { style: "spindle", wc: shade(wc, 0.8), pad: S.acc2 }, center: "candles", R: R });
    var rn = at(-42, 3.55); cushions(K, rn[0], rn[1], faceIn(rn) + 0.2, { c: [S.acc, S.acc2, 0xe9e2d3], pouf: 0xd8c8a8 }); var cr = at(-62, 4.05); F(K, cr[0], cr[1], faceIn(cr)).box("wood", 0.6, 0.38, 0.4, 0, 0.19, 0, wc).quad("stock", 0.55, 0.11, 0, 0.32, 0.205, 0xffffff, AT.stock.spines).solid(0, 0, 0.6, 0.4, 0, 0.38).hot(0, 0.5, 1.2, "book");
    var pp = at(-26, 4.2); plant(K, pp[0], pp[1], { kind: "pampas", h: 1.5, pot: "white", pr: 0.16, ph: 0.42 }); var tl = at(-88, 3.65); floorLamp(K, tl[0], tl[1], { style: "tripod", wc: wc, shade: 0xffe0b0 }); F(K, tl[0], tl[1], 0).hot(0, 0, 1.0, "lights");
    var mo = at(140, 4.0); plant(K, mo[0], mo[1], { kind: "monstera", h: 1.4, pot: "basket", pr: 0.26, ph: 0.4 }); var hp = at(62, 3.7); hanging(K, hp[0], hp[1], coneY(3.7) - 0.7, { kind: "pothos", len: 0.9, cord: 0.5 }); var cra = at(36, 4.3); coatRack(K, cra[0], cra[1], { wc: wc, coat: S.acc, hat: 0x6a4a30 });
    rug(K, 0.3, 1.9, 0, 2.8, 1.8, RUG(S.rug === "beni" ? "abstract" : "beni"), 0.008);
    // the frame: the centre pole and its crown, spokes to the wall poles, a wall plate ring; string lights down the spokes; lanterns
    var nsp = 10, pf = F(K, 0, 0, 0, 0, true); pf.cyl("wood", 0.09, 0.1, RH + 0.1, 0, (RH + 0.1) / 2, 0, wc, { seg: 12 }); pf.tor("wood", 0.32, 0.05, 0, RH - 0.12, 0, wc, { rx: HP, ts: 20 }); pf.tor("wood", R0 - 0.06, 0.045, 0, WH - 0.04, 0, wc, { rx: HP, ts: 64, rs: 6 }); K.sol.push([0, 0, 0.24, 0.24, 0, RH, 0, false, null]);
    for (var s = 0; s < nsp; s++) { var a = -PI + TAU * (s + 0.5) / nsp; if (Math.abs(a) < 0.25) a += 0.3; var ex = Math.sin(a), ez = Math.cos(a); pf.rod("wood", [ex * 0.3, RH - 0.12, ez * 0.3], [ex * (R0 - 0.08), WH, ez * (R0 - 0.08)], 0.035, wc, 6); pf.rod("wood", [ex * (R0 - 0.08), 0, ez * (R0 - 0.08)], [ex * (R0 - 0.08), WH, ez * (R0 - 0.08)], 0.045, wc, 6); if (s % 2 === 0) stringLights(K, [ex * 0.4, RH - 0.22, ez * 0.4], [ex * (R0 - 0.4), WH + 0.16, ez * (R0 - 0.4)], 0.14, 14); }
    pendant(K, 0.35, 0.35, RH - 0.5, 2.85, { style: "lantern" }); pendant(K, dn[0], dn[1], coneY(Math.hypot(dn[0], dn[1])) - 0.05, 2.15, { style: "lantern" });
    // the door: an opening in the front of the ring, its flaps tied back to the poles either side
    var dA = 0.24; [-1, 1].forEach(function (sd) { var dp = [Math.sin(sd * dA) * (R0 - 0.1), Math.cos(sd * dA) * (R0 - 0.1)]; K.put("canvas", rboxG(0.34, 2.25, 0.22, 0.1, 1, 0), mtx(dp[0], 1.13, dp[1], sd * dA), shade(S.can, 0.95)); K.put("leather", boxG(0.38, 0.04, 0.24), mtx(dp[0], 1.4, dp[1], sd * dA), 0x6a3c22); });
    // the round wall with four roll-up windows, the cone roof; the collision ring (the room's own walls are square) and its sun shade
    var wins = [70, -70, 135, -135].map(function (d) { return d * PI / 180; }); roundWall(K, R0, WH, "canvas", S.can, wins, dA); coneRoof(K, R0, WH, RH, 0.3, "canvas", S.can, nsp);
    wins.forEach(function (w) { var c = [Math.sin(w) * (R0 - 0.03), Math.cos(w) * (R0 - 0.03)], f = F(K, c[0], c[1], w + PI, 0, true), ww = 2 * R0 * Math.sin(0.17) * 1.05; f.quad("glass", ww, 1.05, 0, 1.475, 0.0, null, null, { ao: false }); f.cyl("canvas", 0.08, 0.08, ww + 0.12, 0, 2.08, 0.1, shade(S.can, 0.9), { rz: HP, seg: 12, ao: false });
      [-1, 1].forEach(function (s2) { f.box("leather", 0.035, 0.28, 0.012, s2 * ww * 0.3, 2.03, 0.19, 0x6a3c22, { ao: false }); }); for (var mg = 1; mg < 4; mg++) f.box("matte", ww, 0.004, 0.004, 0, 0.95 + 1.05 * mg / 4, 0.01, 0x3a3a3a, { ao: false }); });
    ["L", "R", "B"].forEach(function (sd) { var W2 = wallFrame(K, sd, h); vistaK(F(K, W2.x, W2.z, W2.yaw, 0, true), h, V.vista, W2.s, 0.5); });
    for (var ri = 0; ri < 40; ri++) { var ra = -PI + TAU * (ri + 0.5) / 40; if (Math.abs(ra) < dA + 0.06) continue; K.sol.push([Math.sin(ra) * (R0 + 0.12), Math.cos(ra) * (R0 + 0.12), 0.85, 0.2, 0, WH, ra, false, null]); }
    K.cast.push([planeG(2 * h + 0.4, 2 * h + 0.4), mtx(0, RH + 0.15, 0, 0, HP)]); ["B", "F", "L", "R"].forEach(function (sd) { var W3 = wallFrame(K, sd, h); var M = mtx(0, RH / 2, -0.05); M.premultiply(mtx(W3.x, 0, W3.z, W3.yaw)); K.cast.push([planeG(2 * h, RH + 0.2), M]); });
    floorK(K, h, "oak", 0x9a8470);
    return { lamp: [0, RH - 1.4, 0.2], lampC: 0xffd6a0, lampI: 1.3, fillC: 0xfff0d8, fillG: 0x7a6248, fillI: 1.1, dog: V.dog ? { x: [-2.55, -2.05], yaw: 0.6, bed: S.acc2 } : null }; }

  // ───────────────────────── building a home: the variant, the kit, the shell swap, solids and seats, the tuned lamp and fill ─────────────────────────
  var STYLES = { villa: villa, ranch: ranch, lakehouse: lodge, glamp: glamp };
  // the hidden generic shell (kept for its wall solids) still reads THEME through this; the lodge is taller for its loft
  var THEMES = {
    villa: { wall: [0xf4efe6], floor: ["tile", 0xd9cfbf], ceil: 0xf4efe6, light: [0xffe6c8, 1.0], hgt: 4.4 },
    ranch: { wall: ["wood"], floor: ["wood", 0.9], ceil: 0xd9c8a8, light: [0xffd9a0, 1.0], hgt: 4.4 },
    lakehouse: { wall: [0xe6dccb], floor: ["wood", 0.9], ceil: 0xf5f1e6, light: [0xffe2b8, 1.1], hgt: 6.6 },
    glamp: { wall: ["canvas"], floor: ["wood", 0.9], ceil: 0xf1e6d0, light: [0xffd9a0, 1.0], hgt: 3.6 }
  };
  // which home this is: neighbours in the plan order never share a colourway, and the mirror, furniture set and layout vary on top
  function variant(kind, door, b) { var i = door.i | 0, hs = hashStr((b && b.id) || kind + ":" + i);
    var V = { i: i, cw: i % 4, mir: ((i >> 1) & 1) === 1, set: ((i >> 2) + (hs & 1)) % 3, lay: (hs >>> 3) & 1, seed: hs % 997, name: (b && b.name) || null, id: (b && b.id) || null };
    V.vista = kind === "ranch" ? ((hs >>> 5) & 1 ? "vistaC" : "vistaA") : kind === "glamp" ? ((hs >>> 5) & 1 ? "vistaB" : "vistaA") : kind === "lakehouse" ? ((hs >>> 5) & 1 ? "vistaC" : "vistaB") : ((hs >>> 5) & 1 ? "vistaA" : "vistaB");
    V.dog = kind === "ranch" ? (hs % 3) !== 0 : kind === "lakehouse" ? (hs % 2) === 0 : kind === "villa" ? (hs % 5) === 0 : (hs % 4) === 0;
    var nm = String(V.name || ""); V.special = /bunkhouse/i.test(nm) ? "bunk" : /feed shed|hay/i.test(nm) ? "tack" : null;
    if (RH.force) for (var k in RH.force) V[k] = RH.force[k]; return V; }
  // the floor sits over whatever the ground or a road does under the room (a ribbon used to show through the generic floor)
  // the lifted ribbons (the capsules client.js's roadLiftAt uses indoors) and the drawn walk surface (paths, decks) under the room
  function ribbonLift(x, z) { try { var G = ROADGRID; if (!G || !G.map) return 0; var a = G.map.get(Math.floor(x / G.cell) * 100003 + Math.floor(z / G.cell)); if (!a) return 0; var best = 0;
      for (var i = 0; i < a.length; i++) { var s = a[i], vx = s[2] - s[0], vz = s[3] - s[1], L2 = vx * vx + vz * vz || 1, tr = ((x - s[0]) * vx + (z - s[1]) * vz) / L2; if ((tr < 0 && s[6]) || (tr > 1 && s[7])) continue; var t = clamp(tr, 0, 1), d = Math.hypot(x - (s[0] + vx * t), z - (s[1] + vz * t)); if (d >= s[4] + 0.5) continue; var l = d <= s[4] ? s[5] : s[5] * (1 - (d - s[4]) / 0.5); if (l > best) best = l; } return best; } catch (e) { return 0; } }
  function floorLift(door, h) { var e = door.e, c = Math.cos(e[3]), s = Math.sin(e[3]), mx = -9; for (var a = -4; a <= 4; a++) for (var b2 = -4; b2 <= 4; b2++) { var lx = a / 4 * h, lz = b2 / 4 * h, x = e[0] + lx * c + lz * s, z = e[2] - lx * s + lz * c, y = -9; try { y = getH(x, z); } catch (er) {} var rl = ribbonLift(x, z); try { rl = Math.max(rl, roadLiftAt(x, z)); } catch (er3) {} y += rl; if (y - e[1] > mx) mx = y - e[1]; } return clamp(mx + 0.05, 0.05, 0.6); }
  // solids of the world that stand inside the room's square (the building's own body block, a porch deck, a fence) are set aside
  // while you are in, the way client.js sets the building's colliders aside, and come back on the way out
  function stashSolids(e, h, H) { var out = [], c = Math.cos(e[3]), s = Math.sin(e[3]); try { for (var i = SOLIDS.length - 1; i >= 0; i--) { var sd = SOLIDS[i]; if (!sd || sd.tag === "room" || (typeof sd.tag === "string" && sd.tag.indexOf("ride:") === 0)) continue; if (sd.y1 < e[1] - 0.5 || sd.y0 > e[1] + H) continue;
        var dx = sd.x - e[0], dz = sd.z - e[2], lx = dx * c - dz * s, lz = dx * s + dz * c, rr = Math.min(sd.hw + sd.hd, 30); if (Math.abs(lx) > h + rr || Math.abs(lz) > h + rr) continue; if (Math.abs(lx) > h - 0.05 && Math.abs(lz) > h - 0.05 && rr < 0.5) continue; out.push(sd); SOLIDS.splice(i, 1); } } catch (er) { note("stash", er); } RH.n.stashed = out.length; return out; }
  function unstash(list) { if (!list || !list.length) return; try { for (var i = 0; i < list.length; i++) SOLIDS.push(list[i]); } catch (e) {} list.length = 0; }
  function dogMesh(inner, K, d) { var m = null; try { m = MODELS.dog; } catch (e) {} if (!m || !m.parts || !m.parts.length) return null; var g = new THREE.Group(); g.name = "rh dog"; m.parts.forEach(function (p) { var me = new THREE.Mesh(p.geometry, p.material); me.userData.noSolid = true; me.castShadow = false; g.add(me); }); var s = 0.62 / Math.max(0.1, m.height || 0.68); g.scale.setScalar(s); g.userData.s = s; g.position.set(d.x, 0.1, d.z); g.rotation.y = d.yaw; inner.add(g); return g; }
  // the room is larger than its building: world dressing that stands inside it (a fence, a mailbox, grass, the lot marker by the door) is
  // folded away while you are in (instances collapsed in place, the culler's source copy too) and put back on the way out
  function hideWorld(e, h, H) { var out = [], c = Math.cos(e[3]), s = Math.sin(e[3]), CU = null; try { CU = INSTCULL; } catch (er) {}
    var inRoom = function (x, y, z) { var dx = x - e[0], dz = z - e[2], lx = dx * c - dz * s, lz = dx * s + dz * c, ly = y - e[1]; return Math.abs(lx) < h + 0.35 && Math.abs(lz) < h + 0.35 && ly > -2.5 && ly < H + 0.5; };
    var fold = function (arr, i) { var sv = arr.slice(i * 16, i * 16 + 16); for (var k = 0; k < 11; k++) arr[i * 16 + k] = 0; return sv; };
    try { var ch = scene.children; for (var j = 0; j < ch.length; j++) { var o = ch[j]; if (!o.visible) continue;
        if (o.isInstancedMesh) { var a = o.instanceMatrix.array, n = o.count, idn = o.matrixWorld.equals(_I4), C2 = null, mi = -1; if (CU) for (var q = 0; q < CU.length; q++) { var ix = CU[q].ims.indexOf(o); if (ix >= 0) { C2 = CU[q]; mi = ix; break; } }
          if (C2) { var src = C2.src[mi]; for (var i = 0; i < C2.n; i++) { if (!inRoom(src[i * 16 + 12], src[i * 16 + 13], src[i * 16 + 14])) continue; out.push({ arr: src, i: i, sv: fold(src, i), C: C2 }); } C2.f = -999; continue; }
          for (var i2 = 0; i2 < n; i2++) { var x = a[i2 * 16 + 12], y = a[i2 * 16 + 13], z = a[i2 * 16 + 14]; if (!idn) { _hv.set(x, y, z).applyMatrix4(o.matrixWorld); x = _hv.x; y = _hv.y; z = _hv.z; } if (!inRoom(x, y, z)) continue; out.push({ arr: a, i: i2, sv: fold(a, i2), im: o }); o.instanceMatrix.needsUpdate = true; } }
        else if ((o.isMesh || o.isGroup) && !(o.userData && (o.userData.walk || o.userData.id || o.userData.noCull || o.userData.interior)) && o !== player && !(o.position.x === 0 && o.position.z === 0) && inRoom(o.position.x, o.position.y, o.position.z)) { o.visible = false; out.push({ obj: o }); } } } catch (er3) { note("hideWorld", er3); }
    RH.n.hidden = out.length; return out; }
  function restoreWorld(list) { if (!list) return; for (var i = 0; i < list.length; i++) { var r = list[i]; try { if (r.obj) { r.obj.visible = true; continue; } r.arr.set(r.sv, r.i * 16); if (r.im) r.im.instanceMatrix.needsUpdate = true; if (r.C) r.C.f = -999; } catch (e) {} } list.length = 0; }
  var _I4 = new THREE.Matrix4(), _hv = new THREE.Vector3();
  function build(ctx) { var t0 = nowMs(); matInit(); var kind = ctx.kind, h = ctx.half, H = ctx.hgt, V = variant(kind, ctx.door, ctx.b), K = new Kit(V.mir);
    K.R = rng(V.seed * 7919 + 13); K.kind = kind; K.V = V; RH.n.lastV = V;
    if (RH.cur) { restoreWorld(RH.cur.hidden); unstash(RH.cur.stash); }
    for (var i = 0; i < ctx.shell.length; i++) { var m = ctx.shell[i]; if (m && m.isMesh) m.visible = false; }
    var tA = nowMs(), out = STYLES[kind](K, h, H, V, ctx) || {}; var tB = nowMs(), FY = floorLift(ctx.door, h);
    var dog = null; if (out.dog) { var dp = out.dog.x, dx = dp[0] * K.mir, dz = dp[1], dyaw = K.mir < 0 ? -out.dog.yaw : out.dog.yaw; rawCall(K, function () { var f = F(K, dx, dz, dyaw); f.rb("fabric", 1.0, 0.16, 0.8, 0.07, 0, 0.08, 0, out.dog.bed || 0x8a6a4a, { seg: 2, bulge: 0.02 }); f.rb("fabric", 0.8, 0.06, 0.6, 0.03, 0, 0.13, 0, 0xe9e2d3, { bulge: 0.015 }); f.solid(0, 0, 1.0, 0.8, 0, 0.5); f.hot(0, 0, 1.3, "dog"); }); }
    var inner = new THREE.Group(); inner.name = "rh home " + kind; inner.position.y = FY; inner.userData.noSolid = true; ctx.g.add(inner); var tC = nowMs(), meshes = K.build(inner, MT), tD = nowMs(), triAll = RH.n.tri;
    var caster = null; if (K.cast && K.cast.length) { var K3 = new Kit(false); K.cast.forEach(function (q) { K3.put("caster", q[0], q[1], null, null, false); }); caster = K3.build(inner, MT)[0] || null; if (caster) { caster.userData.noSolid = true; caster.receiveShadow = false; } }
    var fires = null; if (K.fires && K.fires.length) { var K2 = new Kit(false); K.fires.forEach(function (q) { K2.put("fire", planeG(q.w, q.h), mtx(q.x, q.y, q.z, q.yaw), 0xffffff, AT.stock.fire, false); }); var fm = K2.build(inner, MT); fires = fm[0] || null; if (fires) fires.renderOrder = 1; }
    if (out.dog) dog = dogMesh(inner, K, { x: out.dog.x[0] * K.mir, z: out.dog.x[1], yaw: (K.mir < 0 ? -out.dog.yaw : out.dog.yaw) + (out.dog.turn || 0) });
    // solids and seats in the world (y from the lifted floor); the floor itself when it is lifted
    var e = ctx.door.e, c = Math.cos(e[3]), s = Math.sin(e[3]), ns = 0, nseat = 0;
    if (FY > 0.06) { var fsd = addSolid(e[0], e[2], e[3], 2 * h, 2 * h, e[1] - 0.6, e[1] + FY, "room"); if (fsd) ns++; }
    for (var q = 0; q < K.sol.length; q++) { var Q = K.sol[q], wx = e[0] + Q[0] * c + Q[1] * s, wz = e[2] - Q[0] * s + Q[1] * c; var sd = addSolid(wx, wz, e[3] + Q[6], Q[2], Q[3], e[1] + FY + Q[4], e[1] + FY + Q[5], "room"); if (!sd) continue; ns++; if (Q[10] !== "step") sd.noStep = true;   /* furniture is never stepped onto (client R14 noStep); stairs and the loft deck are */
      if (Q[7]) { sd.seat = true; sd.face = e[3] + Q[8]; sd.rh = kind; nseat++; if (Q[9] === "back") { var dd = Math.min(Q[2], Q[3]) / 2 + 0.42, ox = Q[0] - Math.sin(Q[8]) * dd, oz = Q[1] - Math.cos(Q[8]) * dd; sd.r14out = [e[0] + ox * c + oz * s, e[2] - ox * s + oz * c]; } if (ctx.seats) ctx.seats.push(sd); } }
    // the room's one lamp and its fill, tuned to the style (never a new light)
    var lp = out.lamp || [0, H - 0.6, 0]; if (ctx.lamp) { ctx.lamp.position.set(lp[0] * K.mir, FY + lp[1], lp[2]); ctx.lamp.color.set(out.lampC || 0xffe2c0); ctx.lamp.intensity = out.lampI || 1.0; ctx.lamp.distance = h * 6; ctx.lamp.decay = 1.3; ctx.lamp.visible = false; }   // the client's light pool draws it (hidden now, not a frame later, so the first frame never compiles for one light more)
    if (ctx.fill) { ctx.fill.color.set(out.fillC || 0xfff0dc); if (ctx.fill.groundColor) ctx.fill.groundColor.set(out.fillG || 0x7a6a56); ctx.fill.intensity = out.fillI || 0.6; }
    MT.glow.color.setScalar(1); MT.fire && MT.fire.color.setScalar(1);
    var stash = stashSolids(e, h, H + FY), hidden = hideWorld(ctx.door.e, h, H + FY), HK = ctx.H, own = !(HK && typeof HK.spot === "function");
    RH.cur = { own: own, hidden: hidden, stash: stash, g: ctx.g, door: ctx.door, kind: kind, V: V, hot: K.hot, FY: FY, fires: fires, dog: dog, lamp: ctx.lamp, fill: ctx.fill, lampI: out.lampI || 1.0, fillI: out.fillI || 0.6, lights: true, fire: true, vista: V.vista, t: 0, name: V.name, rec: false, dogName: pick(rng(V.seed + 5), C("dogs", DEF.dogs)) };
    // E and the HUD line through PLAN_ROOMS' spots (faced spots, y bands for the loft); its portals for the windows; the world back on leaving
    if (!own) { var cur = RH.cur; K.hot.forEach(function (o) { var y = (o.y || 0) + FY; HK.spot(o.x, o.z, o.r, hotText(o, cur), function (sp) { doHot(o, cur); sp.prompt = hotText(o, cur); }, { face: true, y0: y - 0.6, y1: y + 1.4 }); });
      if (HK.leave) HK.leave(function () { restoreWorld(hidden); unstash(stash); }); if (caster && HK.after) HK.after(function () { caster.castShadow = true; }); if (HK.portal) HK.portal("x", h, -1.12, 1.12, 0, 2.5); }   // portal culling: the door only (every window shows its painted vista, so the world behind it never needs drawing)
    RH.n.tri = triAll + (dog ? 12000 : 0);
    var ms = nowMs() - t0; RH.n.split = { layout: +(tB - tA).toFixed(1), merge: +(tD - tC).toFixed(1), rest: +(ms - (tB - tA) - (tD - tC)).toFixed(1) }; RH.n.built++; RH.n.ms.push(Math.round(ms * 10) / 10); if (RH.n.ms.length > 40) RH.n.ms.shift(); RH.n.draws = meshes.length + (fires ? 1 : 0) + (dog ? dog.children.length : 0); RH.n.solids = ns; RH.n.seats = nseat; RH.n.parts = K.parts; RH.n.FY = FY;
    stampFor(kind); }

  // ───────────────────────── passport stamps (ids proposed in HANDOFF_R14_HOMES.md; no-ops until progress.json has them) ─────────────────────────
  function award(id) { try { var PP = window.PLAN_PROGRESS; if (id && PP && PP.award) PP.award("stamp", { id: id }); } catch (e) {} }
  function stampFor(kind) { try { award(C("stamps." + kind, null)); var seen = {}; try { (localStorage.getItem("g1:rhkinds") || "").split(",").forEach(function (k) { if (k) seen[k] = 1; }); } catch (e) {} seen[kind] = 1; var ks = Object.keys(seen); try { localStorage.setItem("g1:rhkinds", ks.join(",")); } catch (e) {} if (seen.villa && seen.ranch && seen.lakehouse && seen.glamp) award(C("stamps.all", null)); } catch (e) { note("stamp", e); } }

  // ───────────────────────── E in a home: the fire, the lamps, coffee, a book, the house card, the dog, a record ─────────────────────────
  function inHome() { var c = RH.cur; try { return c && inside && inside.g === c.g ? c : null; } catch (e) { return null; } }
  function localP() { var c = RH.cur, e = c.door.e, dx = player.position.x - e[0], dz = player.position.z - e[2], cs = Math.cos(e[3]), sn = Math.sin(e[3]); return [dx * cs - dz * sn, dx * sn + dz * cs, player.position.y - e[1] - c.FY]; }
  function nearHot() { var c = inHome(); if (!c || !player) return null; var p = localP(), best = null, bd = 1e9; for (var i = 0; i < c.hot.length; i++) { var o = c.hot[i]; if (Math.abs(p[2] - (o.y || 0)) > 1.4) continue; var d = Math.hypot(p[0] - o.x, p[1] - o.z); if (d < o.r && d < bd) { bd = d; best = o; } } if (best) best.dist = bd; return best; }
  function fill(s, c) { return String(s || "").replace(/\{dog\}/g, (c && c.dogName) || "the dog"); }
  function hotText(o, c) { var P = C("prompts", {}); if (o.kind === "fire") return c.fire ? P.fireOff : P.fireOn; if (o.kind === "stove") return c.fire ? P.stoveOff : P.stoveOn; if (o.kind === "lights") return c.lights ? P.lights : P.lightsUp; if (o.kind === "coffee") return P.coffee; if (o.kind === "book") return P.book; if (o.kind === "card") return P.card; if (o.kind === "dog") return fill(P.dog, c); if (o.kind === "record") return c.rec ? P.recordOff : P.record; if (o.kind === "pool") return P.pool || "rack up a frame"; return "look"; }
  function card(hd, k, p) { try { $id("info-h").textContent = hd; $id("info-k").textContent = k; $id("info-p").textContent = p; var g = $id("info-go"); if (g) g.style.display = "none"; var nv = $id("info-nav"); if (nv) nv.style.display = "none"; $id("info").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock(); } catch (e) { note("card", e); } }
  function say(t) { try { setStatus(t); } catch (e) {} try { sfx("ui"); } catch (e) {} }
  function doHot(o, c) { var R = rng((Date.now() / 1000) | 0);
    if (o.kind === "fire" || o.kind === "stove") { c.fire = !c.fire; if (c.fires) c.fires.visible = c.fire; say(c.fire ? (o.kind === "stove" ? "The stove ticks as it warms." : "The fire catches and crackles.") : "The fire settles to embers."); return; }
    if (o.kind === "lights") { c.lights = !c.lights; say(c.lights ? "Lamps up." : "Lamps down low."); return; }
    if (o.kind === "coffee") { say(pick(R, C("coffee", DEF.coffee))); return; }
    if (o.kind === "book") { var bs = C("books", DEF.books), ls = C("bookLines", DEF.bookLines); card(pick(R, bs), "From the shelf", pick(R, ls)); return; }
    if (o.kind === "card") { var st = C("styles." + c.kind, {}), cd = C("card", DEF.card); card((c.name ? c.name + ": " : "") + (st.title || "Home"), cd.k, (st.tag ? st.tag + " " : "") + cd.p + " " + cd.foot); return; }
    if (o.kind === "dog") { say(fill(pick(R, C("dogLines", DEF.dogLines)), c)); return; }
    if (o.kind === "pool") { say(pick(R, C("pool", DEF.pool))); return; }
    if (o.kind === "record") { c.rec = !c.rec; say(c.rec ? pick(R, C("records", DEF.records)) : "The needle lifts. Quiet again."); return; } }
  function seatDist() { try { var st = nearestSeat(); return st ? Math.hypot(st.x - player.position.x, st.z - player.position.z) : 9; } catch (e) { return 9; } }
  function install() { if (RH.installed || typeof openNearest !== "function" || typeof updateZone !== "function") return false; RH.installed = true; var oO = openNearest, oZ = updateZone;
    openNearest = function () { try { var c = inHome(); if (c && c.own && !SIT.on) { var o = nearHot(); if (o && !(inside.atDoor() && o.dist > 0.9) && (o.dist < 0.8 || o.dist < seatDist())) { doHot(o, c); return; } } } catch (e) { note("E", e); } return oO.apply(this, arguments); };
    updateZone = function () { var r = oZ.apply(this, arguments); try { var c = inHome(); if (c && c.own && !SIT.on) { var o = nearHot(); if (o && !(inside.atDoor() && o.dist > 0.9) && (o.dist < 0.8 || o.dist < seatDist())) { var pt = $id("prompt-t"); if (pt) pt.innerHTML = "<b>E</b> &nbsp;" + hotText(o, c); var pr = $id("prompt"); if (pr) pr.classList.add("on"); } } } catch (e) {} return r; };
    return true; }

  // ───────────────────────── every frame while in a home: the fire flickers, the lamps follow the switch, the vistas follow the hour ─────────────────────────
  var VNIGHT = new THREE.Color(0.05, 0.065, 0.12), VDAY = new THREE.Color(1, 1, 1), VDUSK = new THREE.Color(1.0, 0.78, 0.62);
  function frame(dt, now) { var c = RH.cur; if (!c) return; var ih = inHome(); if (!ih) { if (!inside || inside.g !== c.g) { restoreWorld(c.hidden); unstash(c.stash); RH.cur = null; } return; } dt = Math.min(0.1, dt || 0.016); c.t += dt;
    var nk = nightK(), fl = c.fire ? 0.88 + 0.08 * Math.sin(c.t * 9.1) + 0.05 * Math.sin(c.t * 23.7 + 1.3) : 0; if (MT.fire) MT.fire.color.setScalar(c.fire ? fl * 1.15 : 0);
    var lk = c.lights ? 1 : 0.42; MT.glow.color.setScalar(c.lights ? 1 : 0.3); if (c.lamp) c.lamp.intensity = c.lampI * lk * (0.9 + 0.35 * nk) + (c.fire ? 0.12 * fl : 0); if (c.fill) c.fill.intensity = c.fillI * (c.lights ? 1 : 0.7) * (1 - 0.5 * nk);
    var dk = 1 - nk, dusk = Math.max(0, 1 - Math.abs(nk - 0.5) * 3.2); var vc = MT[c.vista]; if (vc) { vc.color.copy(VNIGHT).lerp(VDAY, dk * dk); if (dusk > 0) vc.color.multiply(_vt.copy(VDAY).lerp(VDUSK, dusk)); }
    if (c.dog) { var s0 = c.dog.userData.s || 1; c.dog.scale.set(s0, s0 * (1 + 0.012 * Math.sin(c.t * 2.2)), s0); } }
  var _vt = new THREE.Color();

  // ───────────────────────── registration through PLAN_ROOMS, idle prebuild, debug ─────────────────────────
  function register() { var PR = window.PLAN_ROOMS; if (!PR || !PR.register) return false; if (RH.registered) return true; RH.registered = true;
    ["villa", "ranch", "lakehouse", "glamp"].forEach(function (k) { PR.register("homes:" + k, function (door) { return door && door.kind === k; }, { theme: THEMES[k], build: function (ctx) { build(ctx); } }); }); return true; }
  register(); if (!RH.registered) window.PLAN_HOOKS.world.push({ name: "rhRegister", fn: function () { register(); } });
  window.PLAN_HOOKS.world.push({ name: "rhInstall", fn: function () { install(); } });
  // textures and materials at idle after the world is built, so the first door never waits on them
  // at idle: textures and materials, then one dry layout of every style and furniture set into a throwaway kit (fills the geometry cache)
  function prewarm() { if (window.PLAN_ROOMS && PLAN_ROOMS.off) return; var t0 = nowMs(), HH = { villa: [8.17, 4.4], ranch: [7.74, 4.4], lakehouse: [10.32, 6.6], glamp: [5.16, 3.6] }, jobs = [];
    Object.keys(STYLES).forEach(function (k) { [0, 1, 2].forEach(function (st) { jobs.push([k, st]); }); });
    var tail = [function () { // one full merge into a throwaway group (the merge code is compiled before the first door), then freed
        var K = new Kit(false); K.R = rng(5); glamp(K, 5.16, 3.6, { cw: 0, set: 0, lay: 0, mir: false, seed: 3, vista: "vistaA", dog: false, special: null }, {}); var gg = new THREE.Group(); K.build(gg, MT); gg.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); },
      function () { // textures to the GPU before the first door (the atlases and vistas are 2048 px)
        var R2 = typeof renderer !== "undefined" ? renderer : null; if (!R2 || !R2.initTexture) return; var n = 0, seen = new Set(); var up = function (t) { if (!t || !t.isTexture || seen.has(t)) return; seen.add(t); var im = t.image; if (!(im && (im.width || im.naturalWidth || (t.mipmaps && t.mipmaps.length)))) return; try { R2.initTexture(t); n++; } catch (e) {} }; for (var k in TX) up(TX[k]); MTL().forEach(function (m) { up(m.map); up(m.normalMap); up(m.roughnessMap); }); RH.n.texInit = n; }];   // every map a home uses (the game's travertine too)
    var step = function () { var j = jobs.shift(); if (!j) { var tf = tail.shift(); if (tf) { try { tf(); } catch (e) { note("prewarm tail", e); } setTimeout(step, 40); return; } RH.n.prewarmMs = Math.round(nowMs() - t0); return; } try { var sz = HH[j[0]], V = { cw: j[1], set: j[1], lay: j[1] & 1, mir: false, seed: 7, vista: "vistaA", dog: false, special: null }; var K = new Kit(false); K.R = rng(3); STYLES[j[0]](K, sz[0], sz[1], V, {}); } catch (e) { note("prewarm " + j[0], e); } setTimeout(step, 30); };
    step(); }
  // the materials (and the resident dog's) whose textures go to the GPU at idle. Their programs are not precompiled: three's compile() keys a
  // program on the passed object's environment and fog and on the frame's light set, so an idle compile made extra variants, never the one used
  function MTL() { var out = []; for (var k in MT) { var m = MT[k]; if (m && m.isMaterial) out.push(m); } try { (MODELS.dog && MODELS.dog.parts || []).forEach(function (p) { if (p.material && out.indexOf(p.material) < 0) out.push(p.material); }); } catch (e) {} return out; }   // + the resident dog's own material
  window.PLAN_HOOKS.defer.push({ name: "rhPrebuild", fn: function () { install(); var go = function () { try { matInit(); prewarm(); } catch (e) { note("prebuild", e); } }; if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500); } });
  window.PLAN_HOOKS.frame.push({ name: "rhFrame", fn: function (dt, now) { try { frame(dt, now); } catch (e) { note("frame", e); } } });
  try { if (typeof openNearest === "function" && typeof updateZone === "function") install(); } catch (e) {}   // a reload of this file in a running game
  RH.debug = { Kit: Kit, styles: STYLES, variant: variant, build: build, hot: function () { return RH.cur ? RH.cur.hot.map(function (o) { return [o.kind, +o.x.toFixed(2), +o.z.toFixed(2)]; }) : null; }, near: nearHot, mt: MT, tx: TX, gc: GC };
})();
