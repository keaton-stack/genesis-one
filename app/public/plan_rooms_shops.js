// R14 (4 Oct 2026): the store interiors. Every "store" building (the Flight Line Market row, Main Street, Garden Row, Corral Row, the
// Landside arcade, the night plaza vendor village, Gantry Row, the Launch Row depot, the ballpark and the farm) and the fifteen
// streamline storefronts of the Club Walk (made enterable here, the Giveback Desk among them) gets a bespoke interior for its trade,
// built through PLAN_ROOMS (plan_rooms.js) in place of the generic box room:
//   - 24 trade layouts (soda fountain, candy, coffee, bakery, lunch counter, tavern, gift shop, outfitters, the Giveback shop, hats,
//     leather and boots, smithy, parts and hardware, mercantile, garden and feed, toys and models, gallery, photo studio, bike shop,
//     records, barber, makers and printing, books and maps, apothecary and optics, frontier offices, the sheriff, museums, the
//     market hall, the space age vendor stalls, the park house), each varied per shop by its own name, colourway, mirror and stock;
//   - a real shell per room: plank, tile or concrete floors, wainscot and plaster, brick or wallpaper, pressed tin or timber
//     ceilings, display windows you can see out of (plan_perf portals), a back room door; emissive fixtures (no new lights; the
//     room's one lamp and fill are tuned, the sky's share is cut indoors);
//   - stock from generated shelf images (tex/rs_*.jpg, 2x2 sheets), merged geometry per material (a dozen draws a room);
//   - a shopkeeper with a talk card naming the shop, a patron or two (the client's avatars), sittable stools, chairs, booths and
//     benches, buy and browse through the client's shop (coffee, meals, merch, hats, art), info cards, passport stamps (n 280-289).
// Every name and line of copy: plan/rooms_shops.json. ?rs=0 turns the module off (?rooms=0 turns every R14 room off).
// window.PLAN_ROOMS_SHOPS: v, errs, n (counters), cfg, trade(name), api { build, sheet, prefetch }, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var RS = window.PLAN_ROOMS_SHOPS = window.PLAN_ROOMS_SHOPS || {};
  RS.v = "r14"; RS.errs = RS.errs || []; RS.n = RS.n || { built: 0, ms: 0, maxMs: 0, tris: 0, draws: 0, sheets: 0, people: 0 };
  if (/[?&]rs=0\b/.test(location.search)) { RS.off = true; return; }
  var PI = Math.PI, TAU = PI * 2, HP = PI / 2;
  function note(w, e) { try { if (RS.errs.length < 40) RS.errs.push(w + ": " + ((e && e.message) || e)); if (RS.errs.length < 6) console.warn("plan_rooms_shops " + w, e); } catch (x) {} }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function pick(R, a) { return a[Math.floor(R() * a.length) % a.length]; }
  function lowTier() { try { return ASSET.tier === "m"; } catch (e) { return false; } }
  function au(u) { try { return window.AV ? window.AV(u) : u; } catch (e) { return u; } }
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function shared(o) { if (o) { o.userData = o.userData || {}; o.userData.avShared = true; } return o; }

  // ───────────────────────── config: plan/rooms_shops.json ─────────────────────────
  var CFG = RS.cfg || null;
  function cfgUrl() { return au("/plan/rooms_shops.json?v=" + (window.BUILD || "dev")); }
  if (!CFG) { try { fetch(cfgUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && !CFG) CFG = RS.cfg = d; }).catch(function (e) { note("cfg fetch", e); }); } catch (e) { note("cfg", e); } }
  function cfg() { if (CFG) return CFG; try { var x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = RS.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); } return CFG || (CFG = RS.cfg = {}); }
  function C(path, dflt) { var o = cfg(); var p = path.split("."); for (var i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }

  // ───────────────────────── colour ─────────────────────────
  var _col = null; var COLC = {};
  function col(hex) { var c = COLC[hex]; if (c) return c; if (!_col) _col = new THREE.Color(); _col.set(hex); c = COLC[hex] = [_col.r, _col.g, _col.b]; return c; }
  function mixc(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function mulc(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }

  // ───────────────────────── drawn textures (canvas, built once, shared by every room) ─────────────────────────
  var TX = RS.tx = RS.tx || {};
  function cv(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h || w; return c; }
  // the drawn surfaces are painted in their design units (N px) on a canvas scaled by TS (half size on the low tier); their normal
  // maps are made at half the map's size (R14 warm-up: GPU memory for the shared surfaces about 50 MB desktop, 13 MB low)
  var TS = lowTier() ? 0.5 : 1;
  function cvs(w, h) { var c = cv(Math.max(1, Math.round(w * TS)), Math.max(1, Math.round((h || w) * TS))); if (TS !== 1) c.getContext("2d").scale(TS, TS); return c; }
  function canvasTex(c, srgb, rep) { var t = new THREE.CanvasTexture(c); if (rep !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; return shared(t); }
  // a tangent space normal map from a grey height canvas (wraps at the edges)
  function nrmFrom(hc0, k) { var hc = cv(Math.max(1, hc0.width >> 1), Math.max(1, hc0.height >> 1)); hc.getContext("2d").drawImage(hc0, 0, 0, hc.width, hc.height); k *= 0.7; var w = hc.width, h = hc.height, src = hc.getContext("2d").getImageData(0, 0, w, h).data; var o = cv(w, h), ox = o.getContext("2d"), img = ox.createImageData(w, h), d = img.data;
    for (var y = 0; y < h; y++) { var yu = ((y - 1 + h) % h) * w, yd = ((y + 1) % h) * w, yc = y * w; for (var x = 0; x < w; x++) { var xl = (x - 1 + w) % w, xr = (x + 1) % w;
      var du = (src[(yc + xr) * 4] - src[(yc + xl) * 4]) / 255 * k, dv = (src[(yu + x) * 4] - src[(yd + x) * 4]) / 255 * k; var L = Math.sqrt(du * du + dv * dv + 1), i = (yc + x) * 4;
      d[i] = (-du / L * 0.5 + 0.5) * 255; d[i + 1] = (-dv / L * 0.5 + 0.5) * 255; d[i + 2] = (1 / L * 0.5 + 0.5) * 255; d[i + 3] = 255; } }
    ox.putImageData(img, 0, 0); return canvasTex(o, false); }
  function flatN() { if (TX.flatN) return TX.flatN; var t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); t.needsUpdate = true; t.colorSpace = THREE.NoColorSpace; return (TX.flatN = shared(t)); }
  function noiseDots(x, R, N, n, a0, a1, s0, s1, dark) { for (var i = 0; i < n; i++) { var a = a0 + R() * (a1 - a0); x.fillStyle = dark ? "rgba(40,28,18," + a + ")" : "rgba(255,248,236," + a + ")"; var s = s0 + R() * (s1 - s0); x.fillRect(R() * N, R() * N, s, s); } }
  // floor boards: rows of planks with butt joints, grain and knots; neutral warm so vertex colours tint them oak, walnut or pine
  function texPlanks(key, rows, seed, weathered) {
    if (TX[key]) return TX[key]; var N = 1024, a = cvs(N), h = cvs(N), x = a.getContext("2d"), y = h.getContext("2d"), R = rng(seed); var rh = N / rows;
    y.fillStyle = "#c8c8c8"; y.fillRect(0, 0, N, N);
    for (var r = 0; r < rows; r++) { var u = -R() * 300; while (u < N) { var L = 220 + R() * 380, b = 0.86 + R() * 0.22, cr = 196 * b, cg = 166 * b, cb = 132 * b * (0.94 + R() * 0.1);
        var gr = x.createLinearGradient(0, r * rh, 0, (r + 1) * rh); gr.addColorStop(0, "rgb(" + (cr - 8 | 0) + "," + (cg - 8 | 0) + "," + (cb - 6 | 0) + ")"); gr.addColorStop(0.5, "rgb(" + (cr | 0) + "," + (cg | 0) + "," + (cb | 0) + ")"); gr.addColorStop(1, "rgb(" + (cr - 12 | 0) + "," + (cg - 12 | 0) + "," + (cb - 9 | 0) + ")");
        var drawPl = function (ox) { x.fillStyle = gr; x.fillRect(u + ox, r * rh, L, rh);
          for (var k = 0; k < 26; k++) { var gy = r * rh + R() * rh, amp = 1 + R() * 3, ph = R() * 6; x.strokeStyle = (R() < 0.5 ? "rgba(90,58,30," : "rgba(250,225,190,") + (0.05 + R() * 0.09) + ")"; x.lineWidth = 0.7 + R() * 1.6; x.beginPath(); for (var t = 0; t <= 12; t++) { var px = u + ox + t / 12 * L; x[t ? "lineTo" : "moveTo"](px, gy + Math.sin(t * 0.7 + ph) * amp); } x.stroke(); }
          if (R() < 0.35) { var kx = u + ox + R() * L, ky = r * rh + rh * (0.25 + R() * 0.5); x.fillStyle = "rgba(80,48,24,0.45)"; x.beginPath(); x.ellipse(kx, ky, 6 + R() * 8, 3 + R() * 3, 0, 0, TAU); x.fill(); x.strokeStyle = "rgba(80,48,24,0.25)"; x.lineWidth = 1.5; x.beginPath(); x.ellipse(kx, ky, 14 + R() * 6, 6 + R() * 3, 0, 0, TAU); x.stroke(); }
          x.fillStyle = "rgba(45,28,14,0.85)"; x.fillRect(u + ox, r * rh, 2.5, rh); x.fillRect(u + ox, r * rh, L, 2);
          y.fillStyle = "#3a3a3a"; y.fillRect(u + ox, r * rh, 3, rh); y.fillRect(u + ox, r * rh, L, 3); y.fillStyle = "#8a8a8a"; y.fillRect(u + ox + 3, r * rh + 3, 2, rh - 3); y.fillRect(u + ox + 3, r * rh + 3, L - 3, 2); };
        drawPl(0); if (u + L > N) drawPl(-N); if (u < 0) drawPl(N); u += L; } }
    noiseDots(x, R, N, 5000, 0.04, 0.12, 1, 3, true); noiseDots(y, R, N, 3000, 0.05, 0.1, 1, 3, true);
    if (weathered) { x.fillStyle = "rgba(170,165,150,0.22)"; x.fillRect(0, 0, N, N); noiseDots(x, R, N, 3000, 0.05, 0.12, 2, 6, false); }
    return (TX[key] = { map: canvasTex(a), nrm: nrmFrom(h, 2.2) });
  }
  // furniture wood: long continuous grain (no plank seams), neutral warm so a vertex colour stains it
  function texGrain() {
    if (TX.grain) return TX.grain; var N = 512, a = cvs(N), h = cvs(N), x = a.getContext("2d"), y = h.getContext("2d"), R = rng(6060);
    x.fillStyle = "#d2b48e"; x.fillRect(0, 0, N, N); y.fillStyle = "#808080"; y.fillRect(0, 0, N, N);
    for (var k = 0; k < 220; k++) { var gy = R() * N, amp = 2 + R() * 7, ph = R() * 6, fr = 0.5 + R() * 1.5, dk = R() < 0.6; x.strokeStyle = (dk ? "rgba(120,78,40," : "rgba(250,228,196,") + (0.05 + R() * 0.12) + ")"; x.lineWidth = 0.8 + R() * 3; y.strokeStyle = dk ? "rgba(90,90,90,0.25)" : "rgba(170,170,170,0.2)"; y.lineWidth = x.lineWidth;
      [x, y].forEach(function (c) { c.beginPath(); for (var t = 0; t <= 32; t++) { var px = t / 32 * N; c[t ? "lineTo" : "moveTo"](px, gy + Math.sin(t / 32 * TAU * fr + ph) * amp); } c.stroke(); c.beginPath(); for (var t2 = 0; t2 <= 32; t2++) { var px2 = t2 / 32 * N; c[t2 ? "lineTo" : "moveTo"](px2, gy - N + Math.sin(t2 / 32 * TAU * fr + ph) * amp); } c.stroke(); c.beginPath(); for (var t3 = 0; t3 <= 32; t3++) { var px3 = t3 / 32 * N; c[t3 ? "lineTo" : "moveTo"](px3, gy + N + Math.sin(t3 / 32 * TAU * fr + ph) * amp); } c.stroke(); }); }
    for (var q = 0; q < 5; q++) { var kx = R() * N, ky = R() * N; x.strokeStyle = "rgba(100,60,30,0.3)"; x.lineWidth = 2; for (var r = 0; r < 4; r++) { x.beginPath(); x.ellipse(kx, ky, 8 + r * 7, 3 + r * 2.5, 0, 0, TAU); x.stroke(); } }
    noiseDots(x, R, N, 4000, 0.03, 0.08, 1, 2, true);
    return (TX.grain = { map: canvasTex(a), nrm: nrmFrom(h, 0.8) });
  }
  // pressed tin ceiling: a square panel with a raised border, a rosette and corner fans (one tile = 0.61 m)
  function texTin() {
    if (TX.tin) return TX.tin; var N = 512, h = cvs(N), y = h.getContext("2d"), a = cvs(N), x = a.getContext("2d");
    var g0 = y.createRadialGradient(N / 2, N / 2, 10, N / 2, N / 2, N * 0.72); g0.addColorStop(0, "#909090"); g0.addColorStop(1, "#707070"); y.fillStyle = g0; y.fillRect(0, 0, N, N);
    y.strokeStyle = "#d8d8d8"; y.lineWidth = 18; y.strokeRect(20, 20, N - 40, N - 40); y.strokeStyle = "#404040"; y.lineWidth = 6; y.strokeRect(36, 36, N - 72, N - 72); y.strokeStyle = "#c0c0c0"; y.lineWidth = 5; y.strokeRect(52, 52, N - 104, N - 104);
    for (var r = 0; r < 4; r++) { y.strokeStyle = r % 2 ? "#505050" : "#d0d0d0"; y.lineWidth = 8 - r; y.beginPath(); y.arc(N / 2, N / 2, 120 - r * 26, 0, TAU); y.stroke(); }
    for (var p = 0; p < 12; p++) { var an = p / 12 * TAU; y.fillStyle = "#c8c8c8"; y.beginPath(); y.ellipse(N / 2 + Math.cos(an) * 64, N / 2 + Math.sin(an) * 64, 22, 9, an, 0, TAU); y.fill(); }
    y.fillStyle = "#e0e0e0"; y.beginPath(); y.arc(N / 2, N / 2, 18, 0, TAU); y.fill();
    [[0, 0], [N, 0], [0, N], [N, N]].forEach(function (c) { for (var k = 0; k < 5; k++) { y.fillStyle = k % 2 ? "#5a5a5a" : "#c4c4c4"; y.beginPath(); y.arc(c[0], c[1], 92 - k * 16, 0, TAU); y.fill(); } });
    for (var s = 0; s < 4; s++) { var cx = s % 2 ? N / 2 : (s ? N - 120 : 120), cy = s % 2 ? (s === 1 ? 120 : N - 120) : N / 2; y.fillStyle = "#bcbcbc"; y.beginPath(); y.arc(cx, cy, 16, 0, TAU); y.fill(); }
    x.drawImage(h, 0, 0, N, N); x.globalCompositeOperation = "multiply"; x.fillStyle = "#f2efe6"; x.fillRect(0, 0, N, N); x.globalCompositeOperation = "source-over";
    var gl = x.createLinearGradient(0, 0, N, N); gl.addColorStop(0, "rgba(255,255,255,0.35)"); gl.addColorStop(1, "rgba(255,255,255,0.0)"); x.fillStyle = gl; x.fillRect(0, 0, N, N); x.fillStyle = "rgba(255,255,255,0.55)"; x.fillRect(0, 0, N, N);
    return (TX.tin = { map: canvasTex(a), nrm: nrmFrom(h, 3.0) });
  }
  // plaster (adobe skim coat): soft blotches and trowel marks, near white so a colourway tints it
  function texPlaster() {
    if (TX.plaster) return TX.plaster; var N = 512, a = cvs(N), h = cvs(N), x = a.getContext("2d"), y = h.getContext("2d"), R = rng(77);
    x.fillStyle = "#ece6dc"; x.fillRect(0, 0, N, N); y.fillStyle = "#808080"; y.fillRect(0, 0, N, N);
    for (var i = 0; i < 260; i++) { var px = R() * N, py = R() * N, rr = 10 + R() * 50, l = R() < 0.5; for (var dx = -N; dx <= N; dx += N) for (var dy = -N; dy <= N; dy += N) { var gr = x.createRadialGradient(px + dx, py + dy, 0, px + dx, py + dy, rr); gr.addColorStop(0, l ? "rgba(255,252,246,0.16)" : "rgba(150,130,110,0.10)"); gr.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = gr; x.fillRect(px + dx - rr, py + dy - rr, rr * 2, rr * 2); var g2 = y.createRadialGradient(px + dx, py + dy, 0, px + dx, py + dy, rr); g2.addColorStop(0, l ? "rgba(200,200,200,0.35)" : "rgba(60,60,60,0.3)"); g2.addColorStop(1, "rgba(128,128,128,0)"); y.fillStyle = g2; y.fillRect(px + dx - rr, py + dy - rr, rr * 2, rr * 2); } }
    noiseDots(x, R, N, 6000, 0.03, 0.08, 1, 2, true); noiseDots(y, R, N, 4000, 0.1, 0.25, 1, 2, true);
    return (TX.plaster = { map: canvasTex(a), nrm: nrmFrom(h, 1.2) });
  }
  // beadboard wainscot: vertical boards with a bead between them (one repeat = 0.6 m, 6 boards)
  function texBead() {
    if (TX.bead) return TX.bead; var N = 512, a = cvs(N), h = cvs(N), x = a.getContext("2d"), y = h.getContext("2d"), R = rng(9); var bw = N / 6;
    for (var i = 0; i < 6; i++) { var b = 0.92 + R() * 0.12; x.fillStyle = "rgb(" + (238 * b | 0) + "," + (232 * b | 0) + "," + (220 * b | 0) + ")"; x.fillRect(i * bw, 0, bw, N); var gg = y.createLinearGradient(i * bw, 0, (i + 1) * bw, 0); gg.addColorStop(0, "#6a6a6a"); gg.addColorStop(0.08, "#b8b8b8"); gg.addColorStop(0.9, "#b0b0b0"); gg.addColorStop(1, "#7a7a7a"); y.fillStyle = gg; y.fillRect(i * bw, 0, bw, N);
      x.fillStyle = "rgba(60,45,30,0.35)"; x.fillRect(i * bw, 0, 3, N); y.fillStyle = "#e0e0e0"; y.fillRect(i * bw + bw / 2 - 3, 0, 6, N); y.fillStyle = "#303030"; y.fillRect(i * bw + bw / 2 - 6, 0, 2, N); y.fillRect(i * bw + bw / 2 + 4, 0, 2, N); x.fillStyle = "rgba(60,45,30,0.18)"; x.fillRect(i * bw + bw / 2 - 6, 0, 2, N); x.fillRect(i * bw + bw / 2 + 4, 0, 2, N); }
    for (var k = 0; k < 400; k++) { x.strokeStyle = "rgba(120,95,70," + (0.03 + R() * 0.05) + ")"; x.lineWidth = 1; var gx = R() * N; x.beginPath(); x.moveTo(gx, R() * N); x.lineTo(gx + (R() - 0.5) * 3, R() * N); x.stroke(); }
    return (TX.bead = { map: canvasTex(a), nrm: nrmFrom(h, 2.0) });
  }
  // brick: running bond with mortar, burnt ends and soot (one repeat = 1.2 m, 16 courses)
  function texBrick() {
    if (TX.brick) return TX.brick; var N = 1024, a = cvs(N), h = cvs(N), x = a.getContext("2d"), y = h.getContext("2d"), R = rng(4141); var rows = 16, rh = N / rows, bwid = N / 4;
    x.fillStyle = "#b9ad9c"; x.fillRect(0, 0, N, N); y.fillStyle = "#404040"; y.fillRect(0, 0, N, N);
    for (var r = 0; r < rows; r++) for (var c = -1; c < 5; c++) { var ox = c * bwid + (r % 2 ? bwid / 2 : 0); var tone = R(); var cr = 150 + tone * 50, cg = 70 + tone * 30, cb = 50 + tone * 20; if (R() < 0.12) { cr *= 0.7; cg *= 0.7; cb *= 0.7; }
      x.fillStyle = "rgb(" + (cr | 0) + "," + (cg | 0) + "," + (cb | 0) + ")"; x.fillRect(ox + 4, r * rh + 4, bwid - 8, rh - 8); noiseDots(x, R, 0, 0, 0, 0, 0, 0, true);
      for (var k = 0; k < 40; k++) { x.fillStyle = "rgba(" + (R() < 0.5 ? "40,20,10" : "230,200,170") + "," + (0.05 + R() * 0.12) + ")"; x.fillRect(ox + 4 + R() * (bwid - 10), r * rh + 4 + R() * (rh - 10), 2 + R() * 6, 1 + R() * 3); }
      y.fillStyle = "#b0b0b0"; y.fillRect(ox + 4, r * rh + 4, bwid - 8, rh - 8); y.fillStyle = "#c8c8c8"; y.fillRect(ox + 8, r * rh + 8, bwid - 16, rh - 16); }
    noiseDots(x, R, N, 8000, 0.04, 0.1, 1, 3, true);
    return (TX.brick = { map: canvasTex(a), nrm: nrmFrom(h, 2.6) });
  }
  // floor tile: hex mosaic (barber, restroom), checker (fountain, diner) and terracotta squares (cafe, apothecary)
  function texTile(kind) {
    var key = "tile_" + kind; if (TX[key]) return TX[key]; var N = 512, a = cvs(N), h = cvs(N), x = a.getContext("2d"), y = h.getContext("2d"), R = rng(hash(kind));
    y.fillStyle = "#404040"; y.fillRect(0, 0, N, N);
    if (kind === "checker") { var n = 4, s = N / n; x.fillStyle = "#8a8680"; x.fillRect(0, 0, N, N); for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) { var w = (i + j) % 2 === 0; x.fillStyle = w ? "#f1ede4" : "#1d1d1f"; x.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); y.fillStyle = "#b8b8b8"; y.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); } }
    else if (kind === "hex") { x.fillStyle = "#9a958c"; x.fillRect(0, 0, N, N); var r = N / 16, dx = r * Math.sqrt(3), dy = r * 1.5; for (var row = -1; row < N / dy + 1; row++) for (var q = -1; q < N / dx + 1; q++) { var cx = q * dx + (row % 2 ? dx / 2 : 0), cy = row * dy; var flower = (Math.abs(q * 7 + row * 3) % 11) === 0; x.fillStyle = flower ? "#202022" : (R() < 0.04 ? "#e8e2d6" : "#f4f1ea"); y.fillStyle = "#b4b4b4";
        [x, y].forEach(function (c2) { c2.beginPath(); for (var k = 0; k < 6; k++) { var an = PI / 6 + k * PI / 3; c2[k ? "lineTo" : "moveTo"](cx + Math.cos(an) * (r - 1.6), cy + Math.sin(an) * (r - 1.6)); } c2.closePath(); c2.fill(); }); } }
    else { var m = 2, ss = N / m; x.fillStyle = "#7a6a5a"; x.fillRect(0, 0, N, N); for (var i2 = 0; i2 < m; i2++) for (var j2 = 0; j2 < m; j2++) { var t = R(); x.fillStyle = "rgb(" + (176 + t * 30 | 0) + "," + (96 + t * 22 | 0) + "," + (62 + t * 14 | 0) + ")"; x.fillRect(i2 * ss + 5, j2 * ss + 5, ss - 10, ss - 10); for (var k2 = 0; k2 < 300; k2++) { x.fillStyle = "rgba(" + (R() < 0.5 ? "90,40,20" : "240,190,150") + "," + (0.05 + R() * 0.1) + ")"; x.fillRect(i2 * ss + 5 + R() * (ss - 12), j2 * ss + 5 + R() * (ss - 12), 2 + R() * 5, 2 + R() * 5); } y.fillStyle = "#b0b0b0"; y.fillRect(i2 * ss + 5, j2 * ss + 5, ss - 10, ss - 10); } }
    noiseDots(x, R, N, 3000, 0.03, 0.08, 1, 2, true);
    return (TX[key] = { map: canvasTex(a), nrm: nrmFrom(h, 1.6) });
  }
  // wallpaper: damask, pinstripe and a small diamond, light on light so a colourway tints them
  function texPaper(kind) {
    var key = "paper_" + kind; if (TX[key]) return TX[key]; var N = 512, a = cvs(N), x = a.getContext("2d"), R = rng(hash(kind) + 3);
    x.fillStyle = "#efe8da"; x.fillRect(0, 0, N, N);
    if (kind === "stripe") { for (var i = 0; i < 16; i++) { x.fillStyle = i % 2 ? "rgba(120,90,60,0.22)" : "rgba(255,255,255,0.25)"; x.fillRect(i * 32, 0, i % 2 ? 22 : 10, N); x.fillStyle = "rgba(150,110,60,0.35)"; x.fillRect(i * 32 + 26, 0, 2, N); } }
    else if (kind === "diamond") { x.strokeStyle = "rgba(120,90,60,0.35)"; x.lineWidth = 2; for (var k = -N; k < 2 * N; k += 64) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + N, N); x.stroke(); x.beginPath(); x.moveTo(k, N); x.lineTo(k + N, 0); x.stroke(); } for (var u = 0; u <= N; u += 64) for (var v = 0; v <= N; v += 64) { x.fillStyle = "rgba(160,110,60,0.45)"; x.beginPath(); x.arc(u + 32, v, 4, 0, TAU); x.fill(); } }
    else { for (var q = 0; q < 4; q++) { var cx = (q % 2) * 256 + 128, cy = Math.floor(q / 2) * 256 + 128 + (q % 2 ? 0 : 0); x.save(); x.translate(cx, cy); x.fillStyle = "rgba(120,88,58,0.28)";
        for (var p = 0; p < 8; p++) { x.save(); x.rotate(p / 8 * TAU); x.beginPath(); x.moveTo(0, 0); x.bezierCurveTo(26, -20, 56, -10, 86, -40); x.bezierCurveTo(70, 0, 40, 10, 0, 0); x.fill(); x.restore(); }
        x.beginPath(); x.arc(0, 0, 20, 0, TAU); x.fill(); x.strokeStyle = "rgba(120,88,58,0.3)"; x.lineWidth = 3; x.beginPath(); x.ellipse(0, 0, 100, 112, 0, 0, TAU); x.stroke(); x.restore(); } }
    noiseDots(x, R, N, 2500, 0.02, 0.06, 1, 2, true);
    return (TX[key] = { map: canvasTex(a), nrm: flatN() });
  }
  // shiplap and painted board walls; concrete; a soft contact shadow blob; a light shaft gradient
  function texShiplap() {
    if (TX.shiplap) return TX.shiplap; var N = 512, a = cvs(N), h = cvs(N), x = a.getContext("2d"), y = h.getContext("2d"), R = rng(51); var bh = N / 4;
    for (var i = 0; i < 4; i++) { var b = 0.9 + R() * 0.14; x.fillStyle = "rgb(" + (226 * b | 0) + "," + (214 * b | 0) + "," + (196 * b | 0) + ")"; x.fillRect(0, i * bh, N, bh); var gg = y.createLinearGradient(0, i * bh, 0, (i + 1) * bh); gg.addColorStop(0, "#5a5a5a"); gg.addColorStop(0.06, "#b4b4b4"); gg.addColorStop(1, "#a8a8a8"); y.fillStyle = gg; y.fillRect(0, i * bh, N, bh); x.fillStyle = "rgba(40,30,20,0.55)"; x.fillRect(0, i * bh, N, 4);
      for (var k = 0; k < 30; k++) { x.strokeStyle = "rgba(110,80,50," + (0.04 + R() * 0.07) + ")"; x.lineWidth = 1 + R(); var gy = i * bh + 6 + R() * (bh - 8); x.beginPath(); x.moveTo(0, gy); x.bezierCurveTo(N / 3, gy + (R() - 0.5) * 6, 2 * N / 3, gy + (R() - 0.5) * 6, N, gy); x.stroke(); } }
    noiseDots(x, R, N, 2000, 0.03, 0.08, 1, 3, true);
    return (TX.shiplap = { map: canvasTex(a), nrm: nrmFrom(h, 2.0) });
  }
  function texConcrete() {
    if (TX.concrete) return TX.concrete; var N = 512, a = cvs(N), h = cvs(N), x = a.getContext("2d"), y = h.getContext("2d"), R = rng(808);
    x.fillStyle = "#c9c6c0"; x.fillRect(0, 0, N, N); y.fillStyle = "#808080"; y.fillRect(0, 0, N, N);
    for (var i = 0; i < 180; i++) { var px = R() * N, py = R() * N, rr = 8 + R() * 70; var gr = x.createRadialGradient(px, py, 0, px, py, rr); gr.addColorStop(0, R() < 0.5 ? "rgba(255,255,255,0.12)" : "rgba(90,85,78,0.12)"); gr.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = gr; x.fillRect(px - rr, py - rr, rr * 2, rr * 2); }
    noiseDots(x, R, N, 9000, 0.05, 0.15, 1, 2, true); noiseDots(y, R, N, 5000, 0.1, 0.3, 1, 2, true); x.fillStyle = "rgba(60,60,60,0.5)"; x.fillRect(0, 0, N, 2); x.fillRect(0, 0, 2, N); y.fillStyle = "#303030"; y.fillRect(0, 0, N, 3); y.fillRect(0, 0, 3, N);
    return (TX.concrete = { map: canvasTex(a), nrm: nrmFrom(h, 1.0) });
  }
  function texBlob() { if (TX.blob) return TX.blob; var N = 128, a = cvs(N), x = a.getContext("2d"); var g = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2); g.addColorStop(0, "rgba(255,255,255,0.75)"); g.addColorStop(0.55, "rgba(255,255,255,0.4)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, N, N); return (TX.blob = canvasTex(a, true, false)); }
  function texShaft() { if (TX.shaft) return TX.shaft; var N = 256, a = cvs(N, 64), x = a.getContext("2d"); var g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, "rgba(255,255,255,0.9)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, N, 64); var e = x.createLinearGradient(0, 0, N, 0); x.globalCompositeOperation = "destination-in"; e.addColorStop(0, "rgba(0,0,0,0)"); e.addColorStop(0.15, "rgba(0,0,0,1)"); e.addColorStop(0.85, "rgba(0,0,0,1)"); e.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = e; x.fillRect(0, 0, N, 64); return (TX.shaft = canvasTex(a, true, false)); }
  // a rug: a woven border and a field pattern (navajo diamonds, a persian medallion, stripes), drawn once per pattern
  function texRug(kind) {
    var key = "rug_" + kind; if (TX[key]) return TX[key]; var W = 512, H = 768, a = cvs(W, H), x = a.getContext("2d"), R = rng(hash(kind));
    var pal = kind === "navajo" ? ["#8c2f22", "#e8dcc4", "#2b2420", "#c98a3a"] : kind === "persian" ? ["#6e1f22", "#1d2a44", "#c9a24a", "#e6d7b8"] : ["#2f4a3a", "#e9e2d3", "#b5623a", "#1c1f24"];
    x.fillStyle = pal[0]; x.fillRect(0, 0, W, H); x.fillStyle = pal[1]; x.fillRect(24, 24, W - 48, H - 48); x.fillStyle = pal[0]; x.fillRect(40, 40, W - 80, H - 80);
    if (kind === "navajo") { for (var i = 0; i < 4; i++) { var cy = 120 + i * 176; x.fillStyle = i % 2 ? pal[3] : pal[1]; x.beginPath(); x.moveTo(W / 2, cy - 70); x.lineTo(W / 2 + 150, cy); x.lineTo(W / 2, cy + 70); x.lineTo(W / 2 - 150, cy); x.closePath(); x.fill(); x.fillStyle = pal[2]; x.beginPath(); x.moveTo(W / 2, cy - 34); x.lineTo(W / 2 + 70, cy); x.lineTo(W / 2, cy + 34); x.lineTo(W / 2 - 70, cy); x.closePath(); x.fill(); x.fillStyle = pal[2]; x.fillRect(56, cy - 6, 70, 12); x.fillRect(W - 126, cy - 6, 70, 12); } }
    else if (kind === "persian") { x.fillStyle = pal[1]; x.beginPath(); x.ellipse(W / 2, H / 2, 150, 250, 0, 0, TAU); x.fill(); x.fillStyle = pal[2]; x.beginPath(); x.ellipse(W / 2, H / 2, 70, 120, 0, 0, TAU); x.fill(); x.fillStyle = pal[3]; for (var k = 0; k < 16; k++) { var an = k / 16 * TAU; x.beginPath(); x.arc(W / 2 + Math.cos(an) * 110, H / 2 + Math.sin(an) * 190, 9, 0, TAU); x.fill(); } [[90, 90], [W - 90, 90], [90, H - 90], [W - 90, H - 90]].forEach(function (p) { x.fillStyle = pal[1]; x.beginPath(); x.arc(p[0], p[1], 40, 0, TAU); x.fill(); }); }
    else { for (var s = 0; s < 12; s++) { x.fillStyle = pal[s % 4]; x.fillRect(40, 40 + s * 57, W - 80, 30); } }
    for (var n = 0; n < 9000; n++) { x.fillStyle = "rgba(" + (R() < 0.5 ? "0,0,0" : "255,255,255") + "," + (0.03 + R() * 0.06) + ")"; x.fillRect(R() * W, R() * H, 1 + R() * 2, 1 + R() * 2); }
    x.fillStyle = "rgba(240,230,210,0.9)"; for (var f = 0; f < W; f += 6) { x.fillRect(f, 0, 2, 12); x.fillRect(f, H - 12, 2, 12); }
    var t = canvasTex(a, true, false); return (TX[key] = { map: t, nrm: flatN() });
  }

  // ───────────────────────── the generated stock sheets (tex/rs_<name>.jpg: four 1024 panels on 2048, a 1024 copy on the low tier) ─────────────────────────
  // loaded on demand (when a shop is near or built), kept to the eight most recent (GPU memory), each one material
  var SHEETS = RS.sheets = RS.sheets || {}; var SHEET_MAX = lowTier() ? 6 : 4;
  // decoded off the main thread (createImageBitmap, flipped at decode as three's flipY is ignored for bitmaps), then handed to
  // PLAN_ROOMS.warm, which uploads it the next frame the player is outdoors; the GPU keeps the SHEET_MAX most recent, a sheet
  // evicted from it frees its bitmap and comes back from the HTTP cache the next time a shop needs it
  function sheetLoad(s) {
    var url = au("/tex/rs_" + s.name + (lowTier() ? "_m" : "") + ".jpg"), t = s.tex = shared(new THREE.Texture()); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.name = "rs_sheet_" + s.name; s.state = "loading";
    if (s.mat && MAT[s.mat]) MAT[s.mat].map = t;
    var done = function (img, flip) { if (s.tex !== t) { try { if (img.close) img.close(); } catch (e) {} return; } t.image = img; t.flipY = flip; t.needsUpdate = true; s.state = "ready"; RS.n.sheets++; try { if (window.PLAN_ROOMS && PLAN_ROOMS.warm) PLAN_ROOMS.warm(t); } catch (e) {} };
    var viaImg = function () { new THREE.ImageLoader().load(url, function (im) { done(im, true); }, undefined, function () { note("sheet " + s.name, "load failed"); }); };
    if (/[?&]rsbm=1\b/.test(location.search) && typeof createImageBitmap === "function" && typeof fetch === "function") fetch(url).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.blob(); }).then(function (b) { return createImageBitmap(b, { imageOrientation: "flipY" }); }).then(function (bm) { done(bm, false); }, function (e) { note("sheet bitmap " + s.name, e); viaImg(); });
    else viaImg();
  }
  function sheet(name) {
    var s = SHEETS[name]; if (s) { s.used = performance.now(); if (s.state === "evicted") sheetLoad(s); return s; }
    s = SHEETS[name] = { name: name, tex: null, mat: null, used: performance.now(), state: "new", live: false }; try { sheetLoad(s); } catch (e) { note("sheet " + name, e); }
    var res = Object.keys(SHEETS).filter(function (k) { return SHEETS[k].state !== "evicted"; }); if (res.length > SHEET_MAX) { res.sort(function (a, b) { return SHEETS[a].used - SHEETS[b].used; });
      for (var i = 0; i < res.length - SHEET_MAX; i++) { var o = SHEETS[res[i]]; if (o === s || o.live) continue; try { var tx0 = o.tex; o.tex = null; o.state = "evicted"; if (tx0) { tx0.userData.noWarm = true; tx0.dispose(); if (tx0.image && tx0.image.close) tx0.image.close(); tx0.image = null; } RS.n.evicted = (RS.n.evicted || 0) + 1; } catch (e) {} } }
    return s;
  }
  // the panel q (0 top left, 1 top right, 2 bottom left, 3 bottom right) of a sheet, optionally a sub-rectangle [u0, v0, u1, v1] of it
  function panel(q, sub) { var u0 = (q % 2) * 0.5, v1 = q < 2 ? 1 : 0.5; var r = sub || [0, 0, 1, 1]; return [u0 + r[0] * 0.5, v1 - 0.5 + r[1] * 0.5, u0 + r[2] * 0.5, v1 - 0.5 + r[3] * 0.5]; }

  // ───────────────────────── materials: a few families shared by every room (stable programs) ─────────────────────────
  // "t" textured standard (map + normal map + vertex colours): every surface with a texture, the stock sheets included (flat normal)
  // "p" plain standard (vertex colours): paint, metal, chrome, brass, leather, glass-free trims. "g" unlit vertex colour: bulbs,
  // neon, lit panels. "s" unlit map, transparent: signs, menu boards, the contact shadows and the light shafts. "x" the client's
  // own window glass. "l" alpha tested foliage (the Market Hall's own material settings and atlas).
  var MAT = RS.mat = RS.mat || {};
  function tmat(key, pair, rough, metal, ns) { var k = "t_" + key; if (MAT[k]) return k; var m = new THREE.MeshStandardMaterial({ map: pair.map, normalMap: pair.nrm || flatN(), vertexColors: true, roughness: rough === undefined ? 0.85 : rough, metalness: metal || 0 }); if (m.normalScale) m.normalScale.set(ns || 1, ns || 1); m.name = "rs_" + key; MAT[k] = shared(m); try { if (window.PLAN_RL && PLAN_RL.surfMat) PLAN_RL.surfMat(m); } catch (e) {} return k; }
  function pmat(key, rough, metal) { var k = "p_" + key; if (MAT[k]) return k; var m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal }); m.name = "rs_" + key; MAT[k] = shared(m); try { if (window.PLAN_RL && PLAN_RL.surfMat) PLAN_RL.surfMat(m); } catch (e) {} return k; }
  function base() {
    if (MAT.ready) return MAT; MAT.ready = true;
    pmat("paint", 0.72, 0); pmat("gloss", 0.28, 0.05); pmat("metal", 0.42, 0.75); pmat("chrome", 0.14, 1.0); pmat("brass", 0.3, 0.9); pmat("satin", 0.5, 0.25); pmat("cloth", 0.95, 0);
    MAT.g = shared(new THREE.MeshBasicMaterial({ vertexColors: true })); MAT.g.name = "rs_glow";
    MAT.x = shared(new THREE.MeshStandardMaterial({ color: 0xbfe0ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35, side: THREE.DoubleSide })); MAT.x.name = "rs_glass";
    MAT.blob = shared(new THREE.MeshBasicMaterial({ map: texBlob(), color: 0x000000, transparent: true, depthWrite: false })); MAT.blob.name = "rs_blob";
    MAT.shaft = shared(new THREE.MeshBasicMaterial({ map: texShaft(), color: 0xffe2b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.12 })); MAT.shaft.name = "rs_shaft";
    try { var fol = new THREE.TextureLoader().load(au("/tex/mkt_foliage.png")); fol.colorSpace = THREE.SRGBColorSpace; fol.anisotropy = 8; shared(fol); MAT.l = shared(new THREE.MeshStandardMaterial({ map: fol, alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, roughness: 0.78, metalness: 0, envMapIntensity: 0.45 })); MAT.l.name = "rs_leaf"; } catch (e) { note("leaf", e); }
    return MAT;
  }
  function tex(kind) {   // a drawn surface by name -> material key
    switch (kind) {
      case "oak": return tmat("planks", texPlanks("pl_wide", 8, 1928), 0.78, 0, 0.9);
      case "strip": return tmat("strip", texPlanks("pl_strip", 14, 1929), 0.55, 0, 0.8);
      case "grain": return tmat("grain", texGrain(), 0.62, 0, 0.6);
      case "barn": return tmat("barn", texPlanks("pl_barn", 6, 1930, true), 0.92, 0, 1.2);
      case "tin": return tmat("tin", texTin(), 0.35, 0.65, 1.0);
      case "plaster": return tmat("plaster", texPlaster(), 0.95, 0, 1.0);
      case "bead": return tmat("bead", texBead(), 0.6, 0, 1.0);
      case "brick": return tmat("brick", texBrick(), 0.9, 0, 1.0);
      case "checker": return tmat("checker", texTile("checker"), 0.32, 0, 0.6);
      case "hex": return tmat("hex", texTile("hex"), 0.3, 0, 0.6);
      case "terra": return tmat("terra", texTile("terra"), 0.7, 0, 0.8);
      case "damask": return tmat("damask", texPaper("damask"), 0.85, 0, 1);
      case "stripe": return tmat("stripe", texPaper("stripe"), 0.85, 0, 1);
      case "diamond": return tmat("diamond", texPaper("diamond"), 0.85, 0, 1);
      case "shiplap": return tmat("shiplap", texShiplap(), 0.8, 0, 1.0);
      case "concrete": return tmat("concrete", texConcrete(), 0.45, 0, 0.6);
      case "navajo": case "persian": case "stripes": return tmat("rug_" + kind, texRug(kind), 0.98, 0, 1);
    }
    return tmat("plaster", texPlaster(), 0.95, 0, 1.0);
  }
  function smat(name) { var s = sheet(name); if (s.mat && MAT[s.mat] && s.tex && MAT[s.mat].map !== s.tex) MAT[s.mat].map = s.tex; if (!s.mat) { s.mat = "t_sheet_" + name; MAT[s.mat] = shared(new THREE.MeshStandardMaterial({ map: s.tex, normalMap: flatN(), vertexColors: true, roughness: 0.78, metalness: 0 })); MAT[s.mat].name = "rs_sheet_" + name; try { if (window.PLAN_RL && PLAN_RL.surfMat) PLAN_RL.surfMat(MAT[s.mat]); } catch (e) {} } return s.mat; }

  // ───────────────────────── the batch: every piece of a room goes into one vertex list per material (one draw each) ─────────────────────────
  // positions are in the room frame (metres); boxes and quads are written straight into number arrays (no geometry objects)
  function Bt() { this.k = {}; this.tris = 0; }
  Bt.prototype.a = function (key) { var a = this.k[key]; if (!a) a = this.k[key] = { p: [], n: [], u: [], c: [] }; return a; };
  // four corners (local to a frame at x, z turned by ry), counter-clockwise seen from the front; uvs per corner; one colour,
  // or a bottom and a top colour (a cheap occlusion gradient)
  var _q = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  Bt.prototype.q4 = function (key, P, U, c0, c1, x, z, cs, sn) {
    var a = this.a(key), p = a.p, n = a.n, u = a.u, c = a.c;
    for (var i = 0; i < 4; i++) { var lx = P[i * 3], lz = P[i * 3 + 2]; _q[i * 3] = x + lx * cs + lz * sn; _q[i * 3 + 1] = P[i * 3 + 1]; _q[i * 3 + 2] = z - lx * sn + lz * cs; }
    var e1x = _q[3] - _q[0], e1y = _q[4] - _q[1], e1z = _q[5] - _q[2], e2x = _q[6] - _q[0], e2y = _q[7] - _q[1], e2z = _q[8] - _q[2];
    var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x, L = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= L; ny /= L; nz /= L;
    var ord = [0, 1, 2, 0, 2, 3]; var ylo = Math.min(P[1], P[4], P[7], P[10]), yhi = Math.max(P[1], P[4], P[7], P[10]), dy = yhi - ylo;
    for (var j = 0; j < 6; j++) { var v = ord[j]; p.push(_q[v * 3], _q[v * 3 + 1], _q[v * 3 + 2]); n.push(nx, ny, nz); u.push(U[v * 2], U[v * 2 + 1]);
      if (c1 && dy > 0.001) { var t = (P[v * 3 + 1] - ylo) / dy; c.push(c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t); } else c.push(c0[0], c0[1], c0[2]); }
    this.tris += 2;
  };
  var _P = new Array(12), _U = new Array(8);
  // a box: centre x, z, from y0 up h; w along x, d along z (before the turn ry); t = metres per texture repeat; opt:
  //   { no: "bt" (faces left out: b bottom, t top, f front +z, k back -z, l -x, r +x), top: colour of the top face, ao: 0..1 (bottom darker), u0 / v0 uv offset }
  function face(self, k, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, uA, vA, uB, vB, cbot, ctop, x, z, cs, sn) {
    _P[0] = ax; _P[1] = ay; _P[2] = az; _P[3] = bx; _P[4] = by; _P[5] = bz; _P[6] = cx; _P[7] = cy; _P[8] = cz; _P[9] = dx; _P[10] = dy; _P[11] = dz;
    _U[0] = uA; _U[1] = vA; _U[2] = uB; _U[3] = vA; _U[4] = uB; _U[5] = vB; _U[6] = uA; _U[7] = vB; self.q4(k, _P, _U, cbot, ctop, x, z, cs, sn); }
  Bt.prototype.box = function (key, c0, x, y0, z, w, h, d, ry, t, opt) {
    if (!(w > 0 && h > 0 && d > 0)) return; t = t || 1; var o = opt || {}, no = o.no || "b", ao = o.ao === undefined ? 0.18 : o.ao, cs = Math.cos(ry || 0), sn = Math.sin(ry || 0);
    var hw = w / 2, hd = d / 2, y1 = y0 + h, cb = ao ? mulc(c0, 1 - ao) : c0, cu = ao ? c0 : null, ct = o.top || c0, ou = o.u0 !== undefined ? o.u0 : (x + z) * 0.37, ov = o.v0 || 0;
    if (no.indexOf("r") < 0) face(this, key, hw, y0, hd, hw, y0, -hd, hw, y1, -hd, hw, y1, hd, (ou - hd) / t, (ov + y0) / t, (ou + hd) / t, (ov + y1) / t, cb, cu, x, z, cs, sn);
    if (no.indexOf("l") < 0) face(this, key, -hw, y0, -hd, -hw, y0, hd, -hw, y1, hd, -hw, y1, -hd, (ou - hd) / t, (ov + y0) / t, (ou + hd) / t, (ov + y1) / t, cb, cu, x, z, cs, sn);
    if (no.indexOf("f") < 0) face(this, key, -hw, y0, hd, hw, y0, hd, hw, y1, hd, -hw, y1, hd, (ou - hw) / t, (ov + y0) / t, (ou + hw) / t, (ov + y1) / t, cb, cu, x, z, cs, sn);
    if (no.indexOf("k") < 0) face(this, key, hw, y0, -hd, -hw, y0, -hd, -hw, y1, -hd, hw, y1, -hd, (ou - hw) / t, (ov + y0) / t, (ou + hw) / t, (ov + y1) / t, cb, cu, x, z, cs, sn);
    if (no.indexOf("t") < 0) face(this, key, -hw, y1, hd, hw, y1, hd, hw, y1, -hd, -hw, y1, -hd, (ou - hw) / t, (ov - hd) / t, (ou + hw) / t, (ov + hd) / t, ct, null, x, z, cs, sn);
    if (no.indexOf("b") < 0) face(this, key, -hw, y0, -hd, hw, y0, -hd, hw, y0, hd, -hw, y0, hd, (ou - hw) / t, (ov - hd) / t, (ou + hw) / t, (ov + hd) / t, cb, null, x, z, cs, sn);
  };
  // an axis aligned box between bounds (room frame)
  Bt.prototype.aab = function (key, c0, x0, x1, y0, y1, z0, z1, t, opt) { this.box(key, c0, (x0 + x1) / 2, Math.min(y0, y1), (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 0, t, opt); };
  // an upright quad facing ry (0 = facing +z), centred at x, y, z; uv = [u0, v0, u1, v1] (an image) or a repeat size (number)
  Bt.prototype.quad = function (key, c0, x, y, z, w, h, ry, uv, c1) { var cs = Math.cos(ry || 0), sn = Math.sin(ry || 0), hw = w / 2, hh = h / 2;
    _P[0] = -hw; _P[1] = y - hh; _P[2] = 0; _P[3] = hw; _P[4] = y - hh; _P[5] = 0; _P[6] = hw; _P[7] = y + hh; _P[8] = 0; _P[9] = -hw; _P[10] = y + hh; _P[11] = 0;
    if (typeof uv === "number") { _U[0] = 0; _U[1] = 0; _U[2] = w / uv; _U[3] = 0; _U[4] = w / uv; _U[5] = h / uv; _U[6] = 0; _U[7] = h / uv; } else { var r = uv || [0, 0, 1, 1]; _U[0] = r[0]; _U[1] = r[1]; _U[2] = r[2]; _U[3] = r[1]; _U[4] = r[2]; _U[5] = r[3]; _U[6] = r[0]; _U[7] = r[3]; }
    this.q4(key, _P, _U, c0, c1 || null, x, z, cs, sn); };
  // a flat quad (floor decal, rug, ceiling panel), facing up (or down with down = true)
  Bt.prototype.flat = function (key, c0, x, y, z, w, d, ry, uv, down) { var cs = Math.cos(ry || 0), sn = Math.sin(ry || 0), hw = w / 2, hd = d / 2;
    if (!down) { _P[0] = -hw; _P[1] = y; _P[2] = hd; _P[3] = hw; _P[4] = y; _P[5] = hd; _P[6] = hw; _P[7] = y; _P[8] = -hd; _P[9] = -hw; _P[10] = y; _P[11] = -hd; } else { _P[0] = -hw; _P[1] = y; _P[2] = -hd; _P[3] = hw; _P[4] = y; _P[5] = -hd; _P[6] = hw; _P[7] = y; _P[8] = hd; _P[9] = -hw; _P[10] = y; _P[11] = hd; }
    if (typeof uv === "number") { var ox = x * 0.0, oz = z * 0.0; _U[0] = (x - hw) / uv; _U[1] = (z - hd) / uv; _U[2] = (x + hw) / uv; _U[3] = (z - hd) / uv; _U[4] = (x + hw) / uv; _U[5] = (z + hd) / uv; _U[6] = (x - hw) / uv; _U[7] = (z + hd) / uv; } else { var r = uv || [0, 0, 1, 1]; _U[0] = r[0]; _U[1] = r[1]; _U[2] = r[2]; _U[3] = r[1]; _U[4] = r[2]; _U[5] = r[3]; _U[6] = r[0]; _U[7] = r[3]; }
    this.q4(key, _P, _U, c0, null, x, z, cs, sn); };
  // a cylinder (or a cone, or a frustum) standing at x, z from y0 up h; seg sides; caps unless opt.open; opt.top / opt.bot cap colours
  Bt.prototype.cyl = function (key, c0, x, y0, z, r0, r1, h, seg, opt) { var o = opt || {}, a = this.a(key), y1 = y0 + h, s = seg || 12, ct = o.top || c0, ub = o.u || 1, cb = o.ao ? mulc(c0, 1 - o.ao) : c0;
    var sl = (r0 - r1) / h, ny0 = sl / Math.sqrt(1 + sl * sl), nk = 1 / Math.sqrt(1 + sl * sl);
    for (var i = 0; i < s; i++) { var a0 = i / s * TAU, a1 = (i + 1) / s * TAU, c0x = Math.sin(a0), c0z = Math.cos(a0), c1x = Math.sin(a1), c1z = Math.cos(a1);
      var V = [[x + c0x * r0, y0, z + c0z * r0, c0x, c0z, i / s, 0, cb], [x + c1x * r0, y0, z + c1z * r0, c1x, c1z, (i + 1) / s, 0, cb], [x + c1x * r1, y1, z + c1z * r1, c1x, c1z, (i + 1) / s, 1, c0], [x + c0x * r1, y1, z + c0z * r1, c0x, c0z, i / s, 1, c0]];
      [0, 1, 2, 0, 2, 3].forEach(function (k) { var v = V[k]; a.p.push(v[0], v[1], v[2]); a.n.push(v[3] * nk, ny0, v[4] * nk); a.u.push(v[5] * ub, v[6] * h); a.c.push(v[7][0], v[7][1], v[7][2]); });
      if (!o.open) { if (r1 > 0.001 && !o.notop) { a.p.push(x, y1, z, x + c0x * r1, y1, z + c0z * r1, x + c1x * r1, y1, z + c1z * r1); for (var q = 0; q < 3; q++) { a.n.push(0, 1, 0); a.c.push(ct[0], ct[1], ct[2]); } a.u.push(0.5, 0.5, 0.5 + c0x * 0.5, 0.5 + c0z * 0.5, 0.5 + c1x * 0.5, 0.5 + c1z * 0.5); }
        if (r0 > 0.001 && o.bot) { a.p.push(x, y0, z, x + c1x * r0, y0, z + c1z * r0, x + c0x * r0, y0, z + c0z * r0); for (var q2 = 0; q2 < 3; q2++) { a.n.push(0, -1, 0); a.c.push(cb[0], cb[1], cb[2]); } a.u.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5); } } }
    this.tris += s * 2 + (o.open ? 0 : s * 2); };
  // a turned profile [[r, y], ...] (bottles, jars, glasses, lamp shades, stool seats)
  Bt.prototype.lathe = function (key, c0, x, y0, z, prof, seg, c1, sc) { var a = this.a(key), s = seg || 12, k = sc || 1;
    for (var j = 0; j < prof.length - 1; j++) { var A = prof[j], B = prof[j + 1]; var dr = B[0] - A[0], dy = B[1] - A[1], L = Math.sqrt(dr * dr + dy * dy) || 1, nr = dy / L, nyy = -dr / L; var ca = c1 ? mixc(c0, c1, j / (prof.length - 1)) : c0, cbb = c1 ? mixc(c0, c1, (j + 1) / (prof.length - 1)) : c0;
      for (var i = 0; i < s; i++) { var a0 = i / s * TAU, a1 = (i + 1) / s * TAU, s0 = Math.sin(a0), q0 = Math.cos(a0), s1 = Math.sin(a1), q1 = Math.cos(a1);
        var V = [[A[0] * s0, A[1], A[0] * q0, s0, q0, ca, i / s, j], [A[0] * s1, A[1], A[0] * q1, s1, q1, ca, (i + 1) / s, j], [B[0] * s1, B[1], B[0] * q1, s1, q1, cbb, (i + 1) / s, j + 1], [B[0] * s0, B[1], B[0] * q0, s0, q0, cbb, i / s, j + 1]];
        [0, 1, 2, 0, 2, 3].forEach(function (m) { var v = V[m]; a.p.push(x + v[0] * k, y0 + v[1] * k, z + v[2] * k); a.n.push(v[3] * nr, nyy, v[4] * nr); a.u.push(v[6], v[7] / prof.length); a.c.push(v[5][0], v[5][1], v[5][2]); }); } }
    this.tris += (prof.length - 1) * s * 2; };
  // a sphere (globe lights, fruit, ornaments), optionally squashed
  Bt.prototype.sph = function (key, c0, x, y, z, r, seg, sy) { var s = seg || 10, P = []; for (var j = 0; j <= s / 2; j++) { var t = j / (s / 2) * PI; P.push([Math.sin(t) * r, -Math.cos(t) * r * (sy || 1)]); } P[0][0] = 0.0001; P[P.length - 1][0] = 0.0001; this.lathe(key, c0, x, y, z, P, s); };
  // a beam from A to B with a square section w (rails, pipes, frame tubes, legs at an angle)
  Bt.prototype.beam = function (key, c0, A, B, w, d) { var dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L = Math.sqrt(dx * dx + dy * dy + dz * dz); if (L < 1e-4) return;
    var fx = dx / L, fy = dy / L, fz = dz / L; var ux = 0, uy = 1, uz = 0; if (Math.abs(fy) > 0.95) { ux = 1; uy = 0; } var sx = fy * uz - fz * uy, sy = fz * ux - fx * uz, sz = fx * uy - fy * ux, sl = Math.sqrt(sx * sx + sy * sy + sz * sz); sx /= sl; sy /= sl; sz /= sl; ux = sy * fz - sz * fy; uy = sz * fx - sx * fz; uz = sx * fy - sy * fx;
    var hw = w / 2, hd = (d || w) / 2, a = this.a(key);
    var corner = function (e, ss, uu) { return [e[0] + sx * ss + ux * uu, e[1] + sy * ss + uy * uu, e[2] + sz * ss + uz * uu]; };
    var sides = [[hw, 0], [0, hd], [-hw, 0], [0, -hd]];
    for (var i = 0; i < 4; i++) { var s0 = i === 0 ? [hw, -hd] : i === 1 ? [hw, hd] : i === 2 ? [-hw, hd] : [-hw, -hd], s1 = i === 0 ? [hw, hd] : i === 1 ? [-hw, hd] : i === 2 ? [-hw, -hd] : [hw, -hd];
      var p0 = corner(A, s0[0], s0[1]), p1 = corner(A, s1[0], s1[1]), p2 = corner(B, s1[0], s1[1]), p3 = corner(B, s0[0], s0[1]); var nx2 = (s0[0] + s1[0]) / 2, nu2 = (s0[1] + s1[1]) / 2, nl = Math.sqrt(nx2 * nx2 + nu2 * nu2) || 1; nx2 /= nl; nu2 /= nl; var N = [sx * nx2 + ux * nu2, sy * nx2 + uy * nu2, sz * nx2 + uz * nu2];
      [p0, p1, p2, p0, p2, p3].forEach(function (pp, m) { a.p.push(pp[0], pp[1], pp[2]); a.n.push(N[0], N[1], N[2]); a.u.push(m === 1 || m === 2 || m === 4 ? 1 : 0, m >= 2 && m !== 3 ? L : 0); a.c.push(c0[0], c0[1], c0[2]); }); }
    this.tris += 8; };
  // a round tube from A to B (radius r0 at A, r1 at B), capped unless open: drums, pipes, logs, rolled maps, bolts of cloth
  Bt.prototype.tube = function (key, c0, A, B, r0, r1, seg, open, c1) { var dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L = Math.sqrt(dx * dx + dy * dy + dz * dz); if (L < 1e-4) return; r1 = r1 === undefined || r1 === null ? r0 : r1; var s = seg || 12, a = this.a(key), ce = c1 || c0;
    var fx = dx / L, fy = dy / L, fz = dz / L, ux = 0, uy = 1, uz = 0; if (Math.abs(fy) > 0.95) { ux = 1; uy = 0; } var sx = fy * uz - fz * uy, sy = fz * ux - fx * uz, sz = fx * uy - fy * ux, sl = Math.sqrt(sx * sx + sy * sy + sz * sz); sx /= sl; sy /= sl; sz /= sl; ux = sy * fz - sz * fy; uy = sz * fx - sx * fz; uz = sx * fy - sy * fx;
    for (var i = 0; i < s; i++) { var a0 = i / s * TAU, a1 = (i + 1) / s * TAU, c0a = Math.cos(a0), s0a = Math.sin(a0), c1a = Math.cos(a1), s1a = Math.sin(a1);
      var n0 = [sx * c0a + ux * s0a, sy * c0a + uy * s0a, sz * c0a + uz * s0a], n1 = [sx * c1a + ux * s1a, sy * c1a + uy * s1a, sz * c1a + uz * s1a];
      var V = [[A[0] + n0[0] * r0, A[1] + n0[1] * r0, A[2] + n0[2] * r0, n0, i / s, 0], [A[0] + n1[0] * r0, A[1] + n1[1] * r0, A[2] + n1[2] * r0, n1, (i + 1) / s, 0], [B[0] + n1[0] * r1, B[1] + n1[1] * r1, B[2] + n1[2] * r1, n1, (i + 1) / s, 1], [B[0] + n0[0] * r1, B[1] + n0[1] * r1, B[2] + n0[2] * r1, n0, i / s, 1]];
      [0, 2, 1, 0, 3, 2].forEach(function (k) { var v = V[k]; a.p.push(v[0], v[1], v[2]); a.n.push(v[3][0], v[3][1], v[3][2]); a.u.push(v[4], v[5] * L); a.c.push(c0[0], c0[1], c0[2]); });
      if (!open) { [[A, r0, -1], [B, r1, 1]].forEach(function (E) { var P = E[0], r = E[1], sg = E[2]; var q0 = [P[0] + n0[0] * r, P[1] + n0[1] * r, P[2] + n0[2] * r], q1 = [P[0] + n1[0] * r, P[1] + n1[1] * r, P[2] + n1[2] * r]; var tri = sg > 0 ? [P, q1, q0] : [P, q0, q1]; tri.forEach(function (v, m) { a.p.push(v[0], v[1], v[2]); a.n.push(fx * sg, fy * sg, fz * sg); a.u.push(m === 0 ? 0.5 : m === 1 ? 0.5 + c0a * 0.5 : 0.5 + c1a * 0.5, m === 0 ? 0.5 : m === 1 ? 0.5 + s0a * 0.5 : 0.5 + s1a * 0.5); a.c.push(ce[0], ce[1], ce[2]); }); }); } }
    this.tris += s * (open ? 2 : 4); };
  // a ring of beams (a torus with square tubes): wheels, hoops, lamp rings, a clock rim
  Bt.prototype.ring = function (key, c0, x, y, z, r, w, seg, ry, vertical) { var s = seg || 16, cs = Math.cos(ry || 0), sn = Math.sin(ry || 0); var pt = function (t) { var a = Math.cos(t) * r, b = Math.sin(t) * r; return vertical ? [x + a * cs, y + b, z - a * sn] : [x + a, y, z + b]; }; for (var i = 0; i < s; i++) this.beam(key, c0, pt(i / s * TAU), pt((i + 1) / s * TAU), w, w); };
  // a vertical disc facing ry, seen from both sides (lollipops, plates on a rack, a dartboard, a clock face)
  Bt.prototype.disc = function (key, c0, x, y, z, r, ry, seg, uv) { var a = this.a(key), s = seg || 16, cs = Math.cos(ry || 0), sn = Math.sin(ry || 0), nx = sn, nz = cs; var r0 = uv || [0, 0, 1, 1], cu = (r0[0] + r0[2]) / 2, cvv = (r0[1] + r0[3]) / 2, hu = (r0[2] - r0[0]) / 2, hv = (r0[3] - r0[1]) / 2;
    for (var i = 0; i < s; i++) { var a0 = i / s * TAU, a1 = (i + 1) / s * TAU; var p0 = [x + Math.cos(a0) * r * cs, y + Math.sin(a0) * r, z - Math.cos(a0) * r * sn], p1 = [x + Math.cos(a1) * r * cs, y + Math.sin(a1) * r, z - Math.cos(a1) * r * sn];
      var U0 = [cu + Math.cos(a0) * hu, cvv + Math.sin(a0) * hv], U1 = [cu + Math.cos(a1) * hu, cvv + Math.sin(a1) * hv];
      a.p.push(x, y, z, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], x, y, z, p1[0], p1[1], p1[2], p0[0], p0[1], p0[2]); a.n.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, -nx, 0, -nz, -nx, 0, -nz, -nx, 0, -nz); a.u.push(cu, cvv, U0[0], U0[1], U1[0], U1[1], cu, cvv, U1[0], U1[1], U0[0], U0[1]); for (var k = 0; k < 6; k++) a.c.push(c0[0], c0[1], c0[2]); }
    this.tris += s * 2; };
  Bt.prototype.build = function (g, name) {
    var n = 0; for (var key in this.k) { var a = this.k[key]; if (!a.p.length || !MAT[key]) continue; var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(a.p), 3)); geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(a.n), 3)); geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(a.u), 2)); geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(a.c), 3));
      geo.computeBoundingSphere(); var m = new THREE.Mesh(geo, MAT[key]); m.name = (name || "rs") + ":" + key; m.userData.noSolid = true; var lit = key.charAt(0) === "t" || key.charAt(0) === "p" || key === "l"; m.receiveShadow = lit; m.castShadow = false;
      if (key === "x") m.renderOrder = 2; if (key === "blob" || key === "shaft") m.renderOrder = 1; m.matrixAutoUpdate = false; m.updateMatrix(); g.add(m); n++; }
    this.k = {}; return n; };

  // ───────────────────────── the room's sign atlas: every painted sign, menu, placard and poster in one canvas (one draw) ─────────────────────────
  function Atlas(w, h) { this.c = cv(w, h); this.x = this.c.getContext("2d"); this.w = w; this.h = h; this.cx = 0; this.cy = 0; this.rh = 0; this.x.clearRect(0, 0, w, h); }
  Atlas.prototype.slot = function (w, h, draw) { if (this.cx + w > this.w) { this.cx = 0; this.cy += this.rh + 2; this.rh = 0; } if (this.cy + h > this.h) { note("atlas", "full"); return [0, 0, 0.001, 0.001]; } var x0 = this.cx, y0 = this.cy; this.cx += w + 2; this.rh = Math.max(this.rh, h);
    var X = this.x; X.save(); X.beginPath(); X.rect(x0, y0, w, h); X.clip(); X.translate(x0, y0); try { draw(X, w, h); } catch (e) { note("atlas draw", e); } X.restore(); return [x0 / this.w, 1 - (y0 + h) / this.h, (x0 + w) / this.w, 1 - y0 / this.h]; };
  Atlas.prototype.mat = function () { var t = new THREE.CanvasTexture(this.c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.userData.noWarm = true; var m = new THREE.MeshBasicMaterial({ map: t, transparent: true }); m.name = "rs_room_signs"; m.userData.noWarm = true; return m; };
  var SERIF = "Georgia, 'Times New Roman', serif", DISPLAY = "Anton, Impact, sans-serif", GROT = "'Space Grotesk', system-ui, sans-serif", MONO = "'JetBrains Mono', monospace";
  function fitFont(X, text, font, weight, size, maxW, ls) { var s = size; for (var i = 0; i < 30; i++) { X.font = weight + " " + s + "px " + font; if (ls !== undefined) try { X.letterSpacing = ls + "px"; } catch (e) {} if (X.measureText(text).width <= maxW) break; s *= 0.93; } return s; }
  function txt(X, text, x, y, font, weight, size, color, maxW, opt) { var o = opt || {}; X.textAlign = o.align || "center"; X.textBaseline = "middle"; fitFont(X, text, font, weight, size, maxW || 9999, o.ls); if (o.shadow) { X.shadowColor = o.shadow; X.shadowBlur = o.blur || 8; X.shadowOffsetY = o.dy === undefined ? 3 : o.dy; }
    if (o.stroke) { X.lineWidth = o.lw || 4; X.strokeStyle = o.stroke; X.strokeText(text, x, y); } if (o.gold) { var g = X.createLinearGradient(0, y - size / 2, 0, y + size / 2); g.addColorStop(0, "#fff0b8"); g.addColorStop(0.45, "#e2b04a"); g.addColorStop(0.55, "#b07a20"); g.addColorStop(1, "#f6d27a"); X.fillStyle = g; } else X.fillStyle = color; X.fillText(text, x, y); X.shadowBlur = 0; X.shadowOffsetY = 0; try { X.letterSpacing = "0px"; } catch (e) {} }
  function woodBg(X, w, h, c0, c1, seed) { var R = rng(seed || 7); var g = X.createLinearGradient(0, 0, 0, h); g.addColorStop(0, c0); g.addColorStop(1, c1); X.fillStyle = g; X.fillRect(0, 0, w, h); for (var i = 0; i < 70; i++) { X.strokeStyle = "rgba(0,0,0," + (0.04 + R() * 0.08) + ")"; X.lineWidth = 1 + R() * 2; var y = R() * h; X.beginPath(); X.moveTo(0, y); X.bezierCurveTo(w / 3, y + (R() - 0.5) * 8, 2 * w / 3, y + (R() - 0.5) * 8, w, y); X.stroke(); } }
  function frameIn(X, w, h, c, lw, inset) { X.strokeStyle = c; X.lineWidth = lw; X.strokeRect(inset, inset, w - inset * 2, h - inset * 2); }

  // ───────────────────────── the kit: furniture and props (room frame, metres; ry = the way the front faces, 0 = +z) ─────────────────────────
  function Kit(ctx, R, pal, mx) { this.ctx = ctx; this.b = new Bt(); this.R = R; this.pal = pal; this.mx = mx || 1; this.H = ctx.H; this.hgt = ctx.hgt; this.half = ctx.half; this.atl = null; this.fans = []; this.spin = []; }
  Kit.prototype.X = function (x) { return x * this.mx; };
  Kit.prototype.Y = function (ry) { return this.mx < 0 ? -ry : ry; };
  Kit.prototype.solid = function (x, z, w, d, ry, y0, y1) { return this.H.solid(x, z, w, d, ry || 0, y0 || 0, y1 === undefined ? 2.2 : y1); };
  Kit.prototype.seat = function (x, z, w, d, ry, y1, face, out) { return this.H.seat(x, z, w, d, ry || 0, y1, face, out); };
  Kit.prototype.sign = function (w, h, draw) { if (!this.atl) this.atl = new Atlas(2048, 1024); return this.atl.slot(w, h, draw); };
  // local offset (lx along the piece, lz toward its front) of a piece at x, z facing ry, in the room frame
  function off(x, z, ry, lx, lz) { var c = Math.cos(ry), s = Math.sin(ry); return [x + lx * c + lz * s, z - lx * s + lz * c]; }
  RS.off = off;
  // a contact shadow under a piece
  Kit.prototype.shadow = function (x, z, w, d, ry, k) { this.b.flat("blob", [1, 1, 1], x, 0.056, z, w * 1.25, d * 1.35, ry, [0, 0, 1, 1]); };

  // a counter: plinth, body with raised panels, a top that overhangs the front; o: { h, d, top: hex, topKey, front: "panel" | "bead" | "tin" | "glass", body: hex, kick }
  Kit.prototype.counter = function (x, z, len, ry, o) {
    o = o || {}; var b = this.b, h = o.h || 1.02, d = o.d || 0.62, P = this.pal, body = col(o.body || P.wood), top = col(o.top || P.top || P.wood2), dark = mulc(body, 0.62), tk = o.topKey || "p_satin", wk = o.key || tex("grain");
    b.box(wk, dark, x, 0, z, len - 0.06, 0.12, d - 0.1, ry, 0.6, { no: "bt" });
    var fz = off(x, z, ry, 0, -0.02); b.box(wk, body, fz[0], 0.12, fz[1], len, h - 0.17, d - 0.06, ry, 0.6, { ao: 0.25 });
    var tz = off(x, z, ry, 0, 0.04); b.box(tk, top, tz[0], h - 0.05, tz[1], len + 0.08, 0.05, d + 0.08, ry, 0.8, { no: "" });
    var front = o.front || "panel", np = Math.max(1, Math.round(len / 0.9)), pw = len / np;
    for (var i = 0; i < np; i++) { var cx = -len / 2 + pw * (i + 0.5), pf = off(x, z, ry, cx, d / 2 - 0.02);
      if (front === "panel") { b.box("p_satin", mulc(body, 0.85), pf[0], 0.24, pf[1], pw - 0.16, h - 0.42, 0.03, ry, 1, { no: "bk", ao: 0.1 }); b.box("p_satin", mulc(body, 1.08), pf[0], 0.3, pf[1], pw - 0.3, h - 0.54, 0.045, ry, 1, { no: "bk", ao: 0 }); }
      else if (front === "tin") { b.quad(tex("tin"), mulc(col(o.tin || "#c9b48a"), 1), pf[0], 0.12 + (h - 0.17) / 2, pf[1] + 0.0, pw - 0.04, h - 0.2, ry, [0, 0, (pw - 0.04) / 0.6, (h - 0.2) / 0.6]); }
      else if (front === "bead") { var q = off(x, z, ry, cx, d / 2 - 0.025); b.quad(tex("bead"), body, q[0], 0.12 + (h - 0.17) / 2, q[1], pw, h - 0.17, ry, [0, 0, pw / 0.6, (h - 0.17) / 0.6]); } }
    if (o.rail) { var r1 = off(x, z, ry, -len / 2, d / 2 + 0.12), r2 = off(x, z, ry, len / 2, d / 2 + 0.12); this.b.beam("p_brass", col("#c9a24a"), [r1[0], 0.22, r1[1]], [r2[0], 0.22, r2[1]], 0.04); for (var k = 0; k <= Math.round(len / 1.2); k++) { var rr = off(x, z, ry, -len / 2 + k * len / Math.round(len / 1.2), d / 2 + 0.06); b.box("p_brass", col("#c9a24a"), rr[0], 0.12, rr[1], 0.03, 0.12, 0.1, ry, 1, { ao: 0 }); } }
    this.shadow(x, z, len, d, ry); this.solid(x, z, len + 0.08, d + 0.08, ry, 0, h); return { h: h, d: d };
  };
  // a glass display case: a wooden base, a glass box, the stock image (sheet panel) inside, a lit strip under the top
  Kit.prototype.showcase = function (x, z, len, ry, sheetKey, uv, o) {
    o = o || {}; var b = this.b, h = o.h || 1.0, d = o.d || 0.6, base = o.base || 0.42, body = col(o.body || this.pal.wood), dark = mulc(body, 0.6);
    b.box(tex("grain"), body, x, 0, z, len, base, d, ry, 0.6, { ao: 0.3 }); var p = off(x, z, ry, 0, d / 2 + 0.005); b.box("p_satin", mulc(body, 0.85), p[0], 0.08, p[1], len - 0.1, base - 0.16, 0.02, ry, 1, { no: "bk", ao: 0 });
    var gh = h - base - 0.04; b.box("x", [1, 1, 1], x, base, z, len - 0.02, gh, d - 0.02, ry, 1, { no: "b", ao: 0 });
    var fr = col(o.frame || "#b08d4a"); [[-len / 2, -d / 2], [len / 2, -d / 2], [-len / 2, d / 2], [len / 2, d / 2]].forEach(function (c) { var q = off(x, z, ry, c[0] * 0.995, c[1] * 0.98); b.box("p_brass", fr, q[0], base, q[1], 0.025, gh, 0.025, ry, 1, { ao: 0 }); });
    var tp = off(x, z, ry, 0, 0); b.box("p_brass", fr, tp[0], h - 0.04, tp[1], len, 0.025, d, ry, 1, { ao: 0, no: "" });
    if (sheetKey) { var bk = off(x, z, ry, 0, -d / 2 + 0.04); b.quad(sheetKey, [1, 1, 1], bk[0], base + gh / 2, bk[1], len - 0.08, gh - 0.02, ry, uv); var fl = off(x, z, ry, 0, 0.02); b.flat(sheetKey, [0.95, 0.95, 0.95], fl[0], base + 0.005, fl[1], len - 0.08, d - 0.08, ry, uv); }
    var gl = off(x, z, ry, 0, -d / 2 + 0.1); b.box("g", col(o.light || "#fff3d6"), gl[0], h - 0.075, gl[1], len - 0.12, 0.012, 0.03, ry, 1, { ao: 0, no: "bt" });
    this.shadow(x, z, len, d, ry); this.solid(x, z, len, d, ry, 0, h);
  };
  // a wall unit against a wall: kick, sides, crown, a valance light, the stock image as its back; o: { depth, lit, crown, ladder }
  Kit.prototype.wallUnit = function (x, z, w, h, ry, sheetKey, uv, o) {
    o = o || {}; var b = this.b, dp = o.depth || 0.42, body = col(o.body || this.pal.wood), dark = mulc(body, 0.7), wk = o.paint ? "p_paint" : tex("grain");
    var back = off(x, z, ry, 0, -dp / 2 + 0.02); b.quad(sheetKey, [1, 1, 1], back[0], 0.18 + (h - 0.36) / 2, back[1], w - 0.08, h - 0.36, ry, uv, mulc([1, 1, 1], o.dim || 0.82));
    b.box(wk, dark, x, 0, z, w, 0.16, dp, ry, 0.6, { no: "bk" });
    [-1, 1].forEach(function (s) { var p = off(x, z, ry, s * (w / 2 - 0.03), 0); b.box(wk, body, p[0], 0, p[1], 0.06, h, dp, ry, 0.6, { no: "b" }); });
    var cr = off(x, z, ry, 0, 0.02); b.box(wk, body, cr[0], h - 0.18, cr[1], w + 0.06, 0.18, dp + 0.04, ry, 0.6, { no: "b", ao: 0 }); if (o.crown !== false) { var cr2 = off(x, z, ry, 0, 0.05); b.box(wk, mulc(body, 1.1), cr2[0], h, cr2[1], w + 0.16, 0.07, dp + 0.1, ry, 0.6, { ao: 0, no: "" }); }
    if (o.shelves) { var n = o.shelves; for (var i = 1; i < n; i++) { var sy = 0.16 + (h - 0.34) * i / n; var sp = off(x, z, ry, 0, 0.0); b.box(wk, body, sp[0], sy - 0.015, sp[1], w - 0.1, 0.03, dp - 0.04, ry, 0.6, { ao: 0 }); } }
    if (o.lit !== false) { var lt = off(x, z, ry, 0, dp / 2 - 0.06); b.box("g", col(o.light || "#ffe9c4"), lt[0], h - 0.205, lt[1], w - 0.16, 0.02, 0.02, ry, 1, { ao: 0, no: "t" }); }
    if (o.ladder) { var lp = off(x, z, ry, 0, dp / 2 + 0.1), lr = off(x, z, ry, -w / 2, dp / 2 + 0.06), lq = off(x, z, ry, w / 2, dp / 2 + 0.06); b.beam("p_brass", col("#b89040"), [lr[0], h - 0.25, lr[1]], [lq[0], h - 0.25, lq[1]], 0.035);
      var la = off(x, z, ry, o.ladder, dp / 2 + 0.55), lb = off(x, z, ry, o.ladder, dp / 2 + 0.08); [-0.22, 0.22].forEach(function (s) { var A = off(la[0], la[1], ry, s, 0), B = off(lb[0], lb[1], ry, s, 0); b.beam(wk, body, [A[0], 0.02, A[1]], [B[0], h - 0.22, B[1]], 0.05, 0.03); });
      for (var r = 1; r < 8; r++) { var t = r / 8, A2 = off(la[0] + (lb[0] - la[0]) * t, la[1] + (lb[1] - la[1]) * t, ry, -0.22, 0), B2 = off(la[0] + (lb[0] - la[0]) * t, la[1] + (lb[1] - la[1]) * t, ry, 0.22, 0); b.beam(wk, body, [A2[0], 0.02 + (h - 0.24) * t, A2[1]], [B2[0], 0.02 + (h - 0.24) * t, B2[1]], 0.03); } }
    this.solid(x, z, w, dp, ry, 0, h);
  };
  // a freestanding double sided gondola (two sheet panels), with end caps
  Kit.prototype.gondola = function (x, z, len, ry, sheetKey, uvA, uvB, o) {
    o = o || {}; var b = this.b, h = o.h || 1.45, dp = o.d || 0.7, body = col(o.body || this.pal.paint || this.pal.wood), wk = o.key || tex("grain");
    b.box(wk, mulc(body, 0.6), x, 0, z, len, 0.14, dp, ry, 0.6, { no: "b" }); b.box(wk, body, x, 0.14, z, len - 0.04, h - 0.14, 0.06, ry, 0.6, { no: "b" });
    [[1, uvA], [-1, uvB]].forEach(function (sd) { var p = off(x, z, ry, 0, sd[0] * 0.035); b.quad(sheetKey, [0.92, 0.92, 0.92], p[0], 0.14 + (h - 0.2) / 2 + 0.03, p[1], len - 0.1, h - 0.24, ry + (sd[0] < 0 ? PI : 0), sd[1], [0.62, 0.62, 0.62]);
      for (var i = 1; i < 4; i++) { var sp = off(x, z, ry, 0, sd[0] * (dp / 4 + 0.02)); b.box(wk, body, sp[0], 0.14 + (h - 0.2) * i / 4, sp[1], len - 0.08, 0.025, dp / 2 - 0.06, ry, 0.6, { ao: 0 }); } });
    [-1, 1].forEach(function (s) { var p = off(x, z, ry, s * len / 2, 0); b.box(wk, mulc(body, 0.9), p[0], 0, p[1], 0.05, h + 0.04, dp, ry, 0.6, { no: "b" }); });
    this.shadow(x, z, len, dp, ry); this.solid(x, z, len + 0.06, dp, ry, 0, h);
  };
  // a table (display or cafe): rect or round, four legs or a pedestal; returns the top height
  Kit.prototype.table = function (x, z, w, d, ry, o) {
    o = o || {}; var b = this.b, h = o.h || 0.76, tc = col(o.top || this.pal.wood), lc = col(o.leg || this.pal.wood2 || "#3a2a1c"), k = o.key || tex("grain");
    if (o.round) { b.cyl(o.topKey || "p_satin", tc, x, h - 0.04, z, w / 2, w / 2, 0.04, 20, { bot: true }); b.cyl("p_metal", lc, x, 0.02, z, 0.035, 0.035, h - 0.06, 8, { open: true }); b.cyl("p_metal", lc, x, 0, z, 0.24, 0.2, 0.03, 14); }
    else { b.box(o.topKey || k, tc, x, h - 0.045, z, w, 0.045, d, ry, 0.7, { no: "", ao: 0 }); b.box(k, mulc(tc, 0.8), x, h - 0.15, z, w - 0.12, 0.1, d - 0.12, ry, 0.7, { no: "t", ao: 0 });
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) { var p = off(x, z, ry, c[0] * (w / 2 - 0.08), c[1] * (d / 2 - 0.08)); b.box(k, lc, p[0], 0, p[1], 0.06, h - 0.05, 0.06, ry, 0.7, { no: "bt" }); }); }
    this.shadow(x, z, w, o.round ? w : d, ry); this.solid(x, z, o.round ? w * 0.8 : w, o.round ? w * 0.8 : d, ry, 0, h); return h;
  };
  // a chair facing `face`, sittable (you stand up behind it)
  Kit.prototype.chair = function (x, z, face, o) {
    o = o || {}; var b = this.b, c0 = col(o.c || this.pal.wood), k = o.key || tex("grain"); var sh = 0.46;
    b.box(k, c0, x, sh - 0.04, z, 0.44, 0.04, 0.42, face, 0.5, { no: "", ao: 0 }); if (o.cushion) b.box("p_cloth", col(o.cushion), x, sh, z, 0.4, 0.03, 0.38, face, 1, { ao: 0 });
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) { var p = off(x, z, face, c[0] * 0.19, c[1] * 0.18); b.box(k, mulc(c0, 0.85), p[0], 0, p[1], 0.035, sh - 0.04, 0.035, face, 0.5, { no: "bt" }); });
    var bk = off(x, z, face, 0, -0.2); [-0.19, 0.19].forEach(function (s) { var p = off(bk[0], bk[1], face, s, 0); b.box(k, mulc(c0, 0.85), p[0], sh, p[1], 0.035, 0.46, 0.035, face, 0.5, { no: "b", ao: 0 }); });
    b.box(k, c0, bk[0], sh + 0.22, bk[1], 0.4, 0.2, 0.025, face, 0.5, { ao: 0 }); if (o.slats !== false) b.box(k, c0, bk[0], sh + 0.36, bk[1], 0.4, 0.08, 0.025, face, 0.5, { ao: 0 });
    if (!o.occupied) this.seat(x, z, 0.44, 0.42, face, sh, face, "back"); else this.solid(x, z, 0.44, 0.42, face, 0, sh); this.solid(bk[0], bk[1], 0.42, 0.06, face, sh, sh + 0.48);
  };
  // a counter stool: round seat on a pedestal with a foot ring (chrome or wood), sittable, facing the counter
  Kit.prototype.stool = function (x, z, face, o) {
    o = o || {}; var b = this.b, sc = col(o.seat || this.pal.accent || "#a3262a"), mc = col(o.metal || "#d9d9d9"), sh = o.h || 0.76, mk = o.mk || "p_chrome";
    b.cyl(mk, mc, x, 0, z, 0.2, 0.18, 0.04, 14); b.cyl(mk, mc, x, 0.04, z, 0.035, 0.035, sh - 0.12, 8, { open: true }); b.ring(mk, mc, x, 0.3, z, 0.17, 0.018, 12);
    b.lathe(o.sk || "p_gloss", sc, x, sh - 0.09, z, [[0.001, 0], [0.19, 0.01], [0.21, 0.04], [0.2, 0.08], [0.001, 0.095]], 16); b.cyl(mk, mc, x, sh - 0.11, z, 0.2, 0.21, 0.025, 16, { open: true });
    if (!o.occupied) this.seat(x, z, 0.42, 0.42, 0, sh, face, "back"); else this.solid(x, z, 0.4, 0.4, 0, 0, sh);
  };
  // a booth bench (seat and a tall back) with its back along -z of the piece; sittable
  Kit.prototype.booth = function (x, z, len, face, o) {
    o = o || {}; var b = this.b, up = col(o.c || this.pal.accent || "#8a2a26"), fr = col(o.frame || this.pal.wood), k = tex("grain");
    b.box(k, fr, x, 0, z, len, 0.4, 0.55, face, 0.6, { ao: 0.3 }); var s = off(x, z, face, 0, 0.02); b.box("p_gloss", up, s[0], 0.4, s[1], len - 0.06, 0.08, 0.52, face, 1, { no: "b", ao: 0 });
    var bk = off(x, z, face, 0, -0.24); b.box(k, fr, bk[0], 0.4, bk[1], len, 0.82, 0.1, face, 0.6, { no: "b", ao: 0 }); var bp = off(x, z, face, 0, -0.17);
    var nt = Math.max(2, Math.round(len / 0.45)); for (var i = 0; i < nt; i++) { var tp = off(bp[0], bp[1], face, -len / 2 + 0.05 + (len - 0.1) * (i + 0.5) / nt, 0); b.box("p_gloss", up, tp[0], 0.5, tp[1], (len - 0.1) / nt - 0.02, 0.62, 0.05, face, 1, { ao: 0.08 }); }
    b.box(k, mulc(fr, 1.1), bk[0], 1.22, bk[1], len + 0.04, 0.04, 0.14, face, 0.6, { ao: 0, no: "" });
    if (!o.occupied) this.seat(x, z, len, 0.5, face, 0.48, face, null); else this.solid(x, z, len, 0.5, face, 0, 0.48); this.solid(bk[0], bk[1], len, 0.12, face, 0.48, 1.26);
  };
  // a bench with a back (waiting benches, the gallery, the barber): sittable
  Kit.prototype.bench = function (x, z, len, face, o) {
    o = o || {}; var b = this.b, c0 = col(o.c || this.pal.wood), k = o.key || tex("grain"); var sh = 0.45;
    b.box(k, c0, x, sh - 0.05, z, len, 0.05, 0.44, face, 0.6, { no: "", ao: 0 }); [-1, 1].forEach(function (s) { var p = off(x, z, face, s * (len / 2 - 0.06), 0); b.box(k, mulc(c0, 0.8), p[0], 0, p[1], 0.06, sh - 0.05, 0.4, face, 0.6, { no: "bt" }); });
    if (o.back !== false) { var bk = off(x, z, face, 0, -0.2); b.box(k, c0, bk[0], sh + 0.12, bk[1], len, 0.32, 0.04, face, 0.6, { ao: 0 }); [-1, 1].forEach(function (s) { var p = off(bk[0], bk[1], face, s * (len / 2 - 0.06), 0); b.box(k, mulc(c0, 0.8), p[0], sh, p[1], 0.05, 0.48, 0.05, face, 0.6, { no: "b", ao: 0 }); }); this.solid(bk[0], bk[1], len, 0.08, face, sh, sh + 0.5); }
    if (!o.occupied) this.seat(x, z, len, 0.44, face, sh, face, o.out !== undefined ? o.out : o.back !== false ? null : "front"); this.shadow(x, z, len, 0.44, face);
  };
  // a pendant lamp from the ceiling: cord, shade (dome, school globe, cone, lantern, bare bulb), the bulb glows
  Kit.prototype.pendant = function (x, z, y, o) {
    o = o || {}; var b = this.b, top = this.hgt, st = o.style || "dome", sc = col(o.c || this.pal.metal || "#2f4a3a"), gl = col(o.glow || "#ffe2a8");
    b.cyl("p_metal", col("#1c1c1c"), x, y + 0.2, z, 0.006, 0.006, top - y - 0.2, 4, { open: true }); b.cyl("p_metal", col("#1c1c1c"), x, top - 0.04, z, 0.05, 0.05, 0.04, 10);
    if (st === "dome") { b.lathe("p_gloss", sc, x, y, z, [[0.24, 0], [0.23, 0.06], [0.18, 0.13], [0.09, 0.19], [0.03, 0.22], [0.02, 0.24]], 16); b.sph("g", gl, x, y + 0.06, z, 0.07, 10); b.flat("g", mixc(gl, [1, 1, 1], 0.3), x, y + 0.005, z, 0.4, 0.4, 0, [0, 0, 1, 1], true); }
    else if (st === "globe") { b.sph("g", mixc(gl, [1, 1, 1], 0.55), x, y, z, 0.17, 14); b.cyl("p_brass", col("#b89040"), x, y + 0.15, z, 0.06, 0.05, 0.06, 12); }
    else if (st === "cone") { b.lathe("p_gloss", sc, x, y, z, [[0.16, 0], [0.12, 0.08], [0.06, 0.2], [0.025, 0.26]], 14); b.sph("g", gl, x, y + 0.05, z, 0.05, 8); }
    else if (st === "lantern") { b.box("p_metal", col("#2a2622"), x, y - 0.02, z, 0.24, 0.03, 0.24, 0, 1, { ao: 0, no: "" }); b.box("p_metal", col("#2a2622"), x, y + 0.3, z, 0.26, 0.04, 0.26, 0, 1, { ao: 0, no: "" }); b.box("g", mixc(gl, [1, 0.8, 0.5], 0.3), x, y + 0.01, z, 0.2, 0.29, 0.2, 0, 1, { ao: 0, no: "b" }); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) { b.box("p_metal", col("#2a2622"), x + c[0] * 0.11, y, z + c[1] * 0.11, 0.02, 0.32, 0.02, 0, 1, { ao: 0 }); }); }
    else { b.cyl("p_brass", col("#b89040"), x, y + 0.12, z, 0.022, 0.022, 0.05, 8); b.lathe("g", mixc(gl, [1, 0.75, 0.4], 0.35), x, y, z, [[0.001, 0], [0.03, 0.01], [0.045, 0.05], [0.035, 0.09], [0.02, 0.12]], 10); }
  };
  // a ceiling fan (turns while you are inside); one small separate mesh per room
  Kit.prototype.fan = function (x, z, o) {
    var b = this.b, top = this.hgt, mc = col((o && o.c) || "#3a2e26"); b.cyl("p_metal", col("#1c1c1c"), x, top - 0.5, z, 0.015, 0.015, 0.5, 6, { open: true }); b.cyl("p_brass", col("#a8823a"), x, top - 0.62, z, 0.11, 0.09, 0.14, 14, { bot: true });
    this.fans.push({ x: x, z: z, y: top - 0.6, c: mc });
  };
  // a small separate piece that moves while you are inside (a postcard spinner, a turntable, a train): fn(b) draws it in its own frame
  Kit.prototype.rotor = function (x, y, z, speed, fn, path) { this.rotors = this.rotors || []; this.rotors.push({ x: x, y: y, z: z, sp: speed, fn: fn, path: path || null }); };
  Kit.prototype.rug = function (x, z, w, d, ry, kind, tint) { this.b.flat(tex(kind || "navajo"), col(tint || "#ffffff"), x, 0.058, z, w, d, ry, [0, 0, 1, 1]); };
  // a potted plant: a terracotta pot and crossed foliage cards (grass, trailing vine or flowers) or a little cactus
  Kit.prototype.plant = function (x, z, s, kind, y0) {
    var b = this.b; s = s || 1; y0 = y0 || 0; var pc = col(this.R() < 0.5 ? "#b5623a" : "#9a5434");
    b.lathe("p_paint", pc, x, y0, z, [[0.12 * s, 0], [0.16 * s, 0.24 * s], [0.18 * s, 0.26 * s], [0.18 * s, 0.3 * s], [0.155 * s, 0.3 * s]], 12); b.flat("p_cloth", col("#4a3424"), x, y0 + 0.28 * s, z, 0.3 * s, 0.3 * s, 0, [0, 0, 1, 1]);
    if (kind === "cactus") { var cc = col("#4f7a3a"); b.cyl("p_cloth", cc, x, y0 + 0.28 * s, z, 0.07 * s, 0.06 * s, 0.42 * s, 10, { top: mulc(cc, 1.1) }); b.cyl("p_cloth", cc, x + 0.06 * s, y0 + 0.45 * s, z, 0.035 * s, 0.03 * s, 0.16 * s, 8); return; }
    var uv = kind === "vine" ? [0.02, 0.32, 0.47, 0.99] : kind === "flower" ? [0.5, 0.18, 1.0, 0.44] : [0.52, 0.5, 0.98, 1.0], hh = (kind === "vine" ? 0.75 : 0.6) * s, ww = 0.55 * s;
    for (var i = 0; i < 3; i++) b.quad("l", col("#ffffff"), x, y0 + 0.24 * s + hh / 2, z, ww, hh, i * PI / 3 + 0.3, uv);
  };
  Kit.prototype.crate = function (x, y, z, w, h, d, ry, c) { var b = this.b, k = tex("barn"), cc = col(c || "#a07a52"); b.box(k, cc, x, y, z, w, h, d, ry, 0.5, { no: y > 0.01 ? "" : "b", ao: 0.25 }); var f = off(x, z, ry, 0, d / 2 + 0.008); [0.2, 0.8].forEach(function (t) { b.box(k, mulc(cc, 0.75), f[0], y + h * t - 0.025, f[1], w, 0.05, 0.016, ry, 0.5, { ao: 0 }); }); };
  Kit.prototype.barrel = function (x, z, r, h, c, y0) { var b = this.b, cc = col(c || "#7a5232"); y0 = y0 || 0; b.lathe(tex("grain"), cc, x, y0, z, [[r * 0.84, 0], [r * 0.95, h * 0.2], [r, h * 0.5], [r * 0.95, h * 0.8], [r * 0.84, h], [0.001, h]], 14); [0.12, 0.3, 0.7, 0.88].forEach(function (t) { var rr = r * (t < 0.5 ? 0.84 + (0.16 * t / 0.5) : 0.84 + 0.16 * (1 - t) / 0.5) + 0.012; b.cyl("p_metal", col("#3a3632"), x, y0 + h * t - 0.025, z, rr, rr, 0.05, 14, { open: true }); }); this.shadow(x, z, r * 2, r * 2, 0); };
  Kit.prototype.sack = function (x, z, s, c) { var b = this.b; s = s || 1; b.lathe("p_cloth", mulc(col(c || "#b09a72"), 0.82), x, 0, z, [[0.2 * s, 0], [0.25 * s, 0.1 * s], [0.24 * s, 0.32 * s], [0.18 * s, 0.46 * s], [0.08 * s, 0.52 * s], [0.06 * s, 0.6 * s], [0.001, 0.62 * s]], 9); };
  // a cash register (brass, with a till drawer and keys)
  Kit.prototype.register = function (x, y, z, ry) { var b = this.b, br = col("#c9a24a"), dk = col("#3a2a1c"); b.box("p_brass", br, x, y, z, 0.42, 0.14, 0.38, ry, 1, { ao: 0.2 }); var p = off(x, z, ry, 0, -0.05); b.box("p_brass", br, p[0], y + 0.14, p[1], 0.38, 0.22, 0.24, ry, 1, { ao: 0.2 }); var q = off(x, z, ry, 0, -0.1); b.box("p_brass", mulc(br, 1.1), q[0], y + 0.36, q[1], 0.3, 0.1, 0.06, ry, 1, { ao: 0 }); for (var i = 0; i < 4; i++) for (var j = 0; j < 3; j++) { var kp = off(x, z, ry, -0.12 + i * 0.08, 0.06 + j * 0.05); b.cyl("p_gloss", col("#f2ead8"), kp[0], y + 0.14, kp[1], 0.016, 0.016, 0.02 + j * 0.012, 8); } var dr = off(x, z, ry, 0, 0.19); b.box("p_satin", dk, dr[0], y + 0.02, dr[1], 0.36, 0.08, 0.01, ry, 1, { ao: 0 }); };
  // a framed picture on a wall (a sheet panel, or a uv of the room's sign atlas when key = "s")
  Kit.prototype.frame = function (x, y, z, w, h, ry, key, uv, fc) { var b = this.b, c0 = col(fc || "#2a1e14"); var p = off(x, z, ry, 0, 0.02); b.box("p_satin", c0, p[0], y - h / 2 - 0.05, p[1], w + 0.1, h + 0.1, 0.04, ry, 1, { ao: 0 }); var q = off(x, z, ry, 0, 0.045); b.quad(key, [1, 1, 1], q[0], y, q[1], w, h, ry, uv); };
  // a back room door: architrave, a four panel door, a brass knob, a small sign above
  Kit.prototype.door = function (x, z, ry, label) {
    var b = this.b, P = this.pal, dc = col(P.door || P.wood2 || "#5a3a24"), tc = col(P.trim || P.wood || "#3a2a1c"), k = tex("grain");
    var p = off(x, z, ry, 0, 0.03); b.box(k, dc, p[0], 0, p[1], 0.92, 2.12, 0.05, ry, 0.6, { ao: 0.15 });
    [[-0.2, 0.55], [0.2, 0.55], [-0.2, 1.5], [0.2, 1.5]].forEach(function (c) { var q = off(x, z, ry, c[0], 0.06); b.box("p_satin", mulc(dc, 0.8), q[0], c[1] - (c[1] < 1 ? 0.35 : 0.4), q[1], 0.3, c[1] < 1 ? 0.7 : 0.8, 0.02, ry, 1, { ao: 0, no: "bk" }); });
    var kn = off(x, z, ry, 0.36, 0.09); b.sph("p_brass", col("#c9a24a"), kn[0], 1.0, kn[1], 0.03, 8);
    [-1, 1].forEach(function (s) { var q = off(x, z, ry, s * 0.51, 0.04); b.box(k, tc, q[0], 0, q[1], 0.1, 2.24, 0.07, ry, 0.6, { ao: 0 }); }); var hd = off(x, z, ry, 0, 0.045); b.box(k, tc, hd[0], 2.18, hd[1], 1.22, 0.14, 0.09, ry, 0.6, { ao: 0, no: "" });
    if (label) { var uv = this.sign(256, 64, function (X, w, h) { woodBg(X, w, h, "#2a1e14", "#1a120c", 3); frameIn(X, w, h, "#c9a24a", 3, 4); txt(X, label, w / 2, h / 2 + 2, SERIF, "700", 30, "#f2dfae", w - 24, { ls: 2 }); }); var sp = off(x, z, ry, 0, 0.07); b.quad("s", [1, 1, 1], sp[0], 2.42, sp[1], 0.62, 0.155, ry, uv); }
  };
  // a wall clock: case, face and hands (painted into the sign atlas)
  Kit.prototype.clock = function (x, y, z, ry, o) { var b = this.b; var uv = this.sign(160, 160, function (X, w, h) { X.fillStyle = "#f4ecd6"; X.beginPath(); X.arc(w / 2, h / 2, w / 2 - 2, 0, TAU); X.fill(); X.strokeStyle = "#2a1e14"; X.lineWidth = 3; X.stroke(); X.fillStyle = "#2a1e14"; for (var i = 0; i < 12; i++) { var a = i / 12 * TAU; X.fillRect(w / 2 + Math.sin(a) * (w / 2 - 16) - 2, h / 2 - Math.cos(a) * (h / 2 - 16) - 2, 4, 4); } X.font = "700 14px " + SERIF; X.textAlign = "center"; X.fillText("XII", w / 2, 30); X.lineWidth = 4; X.beginPath(); X.moveTo(w / 2, h / 2); X.lineTo(w / 2 + 30, h / 2 - 22); X.stroke(); X.lineWidth = 2.5; X.beginPath(); X.moveTo(w / 2, h / 2); X.lineTo(w / 2 - 12, h / 2 - 50); X.stroke(); });
    var p = off(x, z, ry, 0, 0.03); b.box("p_satin", col("#3a2414"), p[0], y - 0.24, p[1], 0.48, 0.48, 0.05, ry, 1, { ao: 0 }); var q = off(x, z, ry, 0, 0.06); b.quad("s", [1, 1, 1], q[0], y, q[1], 0.4, 0.4, ry, uv); };
  // a light shaft from a window (daylight): an additive card that slants into the room
  Kit.prototype.shaft = function (x, z, w, h, ry, len) { var b = this.b, a = b.a("shaft"); var c = Math.cos(ry), s = Math.sin(ry); var P0 = [x - c * w / 2, h, z + s * w / 2], P1 = [x + c * w / 2, h, z - s * w / 2]; var dx = Math.sin(ry) * len, dz = Math.cos(ry) * len; var Q0 = [P0[0] + dx, 0.06, P0[2] + dz], Q1 = [P1[0] + dx, 0.06, P1[2] + dz];
    [[P0, 0, 0], [P1, 1, 0], [Q1, 1, 1], [P0, 0, 0], [Q1, 1, 1], [Q0, 0, 1], [P0, 0, 0], [Q1, 1, 1], [P1, 1, 0], [P0, 0, 0], [Q0, 0, 1], [Q1, 1, 1]].forEach(function (v) { a.p.push(v[0][0], v[0][1], v[0][2]); a.n.push(0, 1, 0); a.u.push(v[1], 1 - v[2]); a.c.push(1, 1, 1); }); };

  // ───────────────────────── the shell: floor, walls, ceiling, the storefront with its display windows and door ─────────────────────────
  // The generic room's walls stay (hidden) as the outer collision; this shell is drawn inside them. The storefront wall stands
  // 0.55 m in from the generic front (the street planters at the shop front sit in that strip, outside the glass).
  var FRONT_IN = 0.55;
  function shell(K, S) {
    var ctx = K.ctx, b = K.b, h = ctx.half, H = K.hgt, zf = h - FRONT_IN, P = K.pal;
    for (var i = 0; i < ctx.shell.length; i++) { var o = ctx.shell[i]; if (o.isMesh) o.visible = false; }
    K.zf = zf; K.zb = -h + 0.1; K.xw = h - 0.1;   // inner faces: front, back, side walls
    var fk = tex(S.floor || "oak"), ft = S.floorTile || (S.floor === "checker" || S.floor === "hex" ? 1.2 : S.floor === "terra" ? 1.0 : S.floor === "concrete" ? 3 : 2.4);
    b.flat(fk, col(S.floorTint || "#ffffff"), 0, 0.052, 0.15, h * 2, h * 2 + 0.3, 0, ft);
    var trim = col(S.trim || P.trim || "#3a2a1c"), wk = tex("grain"), wain = S.wain === undefined ? "bead" : S.wain, wh = S.wainH || 1.05, up = S.upper || "plaster", ut = col(S.upperTint || "#ffffff"), wt = col(S.wainTint || "#ffffff");
    var upT = up === "brick" ? 1.2 : up === "shiplap" ? 0.6 : up === "barn" ? 2.4 : up === "plaster" ? 1.6 : 0.9;
    // a wall from (ax, az) to (bx, bz), facing into the room, with openings [[a0, a1, y0, y1], ...] along it (metres from a)
    function wall(ax, az, bx, bz, openings) {
      var dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
      // the face looks along the inward normal: rotate the wall direction -90 degrees in the plane (left of travel)
      var nx = uz, nz = -ux, face = Math.atan2(nx, nz), fc = Math.cos(face), fs = Math.sin(face);
      var ops = (openings || []).slice().sort(function (p, q) { return p[0] - q[0]; });
      var spans = [], cur = 0; ops.forEach(function (o) { spans.push([cur, o[0], 0, H, null]); spans.push([o[0], o[1], 0, o[2], o]); spans.push([o[0], o[1], o[3], H, o]); cur = o[1]; }); spans.push([cur, L, 0, H, null]);
      spans.forEach(function (s) { var a0 = s[0], a1 = s[1], y0 = s[2], y1 = s[3]; if (a1 - a0 < 0.01 || y1 - y0 < 0.01) return; var mx = ax + ux * (a0 + a1) / 2, mz = az + uz * (a0 + a1) / 2, w = a1 - a0;
        var wtop = Math.min(y1, wh), utop = y1; var uofs = mx * fc - mz * fs;
        if (wain && y0 < wh && wtop > y0 + 0.01) b.quad(tex(wain === "tile" ? "hex" : wain), wt, mx, (Math.max(y0, 0.16) + wtop) / 2, mz, w, wtop - Math.max(y0, 0.16), face, [(uofs - w / 2) / 0.6, Math.max(y0, 0.16) / 0.6, (uofs + w / 2) / 0.6, wtop / 0.6], mulc(wt, 0.9));
        var ub = wain ? Math.max(y0, wh) : Math.max(y0, 0.16); if (utop > ub + 0.01) b.quad(tex(up), ut, mx, (ub + utop) / 2, mz, w, utop - ub, face, [(uofs - w / 2) / upT, ub / upT, (uofs + w / 2) / upT, utop / upT], mulc(ut, 0.86));
        if (y0 < 0.01) { var bp = off(mx, mz, face, 0, 0.02); b.box(wk, mulc(trim, 0.9), bp[0], 0, bp[1], w, 0.17, 0.04, face, 0.6, { ao: 0.1, no: "bk" }); }
        if (wain && y0 < wh && y1 > wh) { var rp = off(mx, mz, face, 0, 0.025); b.box(wk, trim, rp[0], wh - 0.03, rp[1], w, 0.06, 0.05, face, 0.6, { ao: 0, no: "bk" }); }
        if (y1 >= H - 0.01) { var cp = off(mx, mz, face, 0, 0.04); b.box(wk, mulc(trim, 1.05), cp[0], H - 0.16, cp[1], w, 0.16, 0.08, face, 0.6, { ao: 0, no: "k" }); var cq = off(mx, mz, face, 0, 0.09); b.box(wk, mulc(trim, 0.9), cq[0], H - 0.09, cq[1], w, 0.06, 0.06, face, 0.6, { ao: 0, no: "k" }); } });
      return face;
    }
    K.backFace = wall(h, K.zb, -h, K.zb, S.backOpen || []);            // the back wall faces +z
    wall(-K.xw, K.zb, -K.xw, zf, S.leftOpen || []);                    // left wall (x = -half) faces +x
    wall(K.xw, zf, K.xw, K.zb, S.rightOpen || []);                     // right wall faces -x
    // the storefront (from inside it runs from +x to -x and faces -z): two display windows, the door and its transom
    var dw = 1.1, wx0 = S.win0 || 1.55, wx1 = S.win1 || (h - 0.75), wy0 = S.winY0 || 0.72, wy1 = S.winY1 || 3.05, ty0 = 2.55, ty1 = Math.min(H - 0.5, 3.1);
    var fo = function (x0, x1) { return [x0 + K.xw, x1 + K.xw]; };
    var opsF = [fo(-wx1, -wx0).concat([wy0, wy1]), fo(-dw, dw).concat([0, ty1]), fo(wx0, wx1).concat([wy0, wy1])];
    if (S.noWindows) opsF = [fo(-dw, dw).concat([0, ty1])];
    wall(-K.xw, zf, K.xw, zf, opsF);
    var fr = col(S.frame || P.frame || P.trim || "#3a2a1c"), gl = [1, 1, 1];
    var win = function (x0, x1, y0, y1, mull) { var cx = (x0 + x1) / 2, w = x1 - x0; b.quad("x", gl, cx, (y0 + y1) / 2, zf + 0.04, w, y1 - y0, PI, [0, 0, 1, 1]);
      b.box(wk, fr, cx, y0 - 0.06, zf - 0.06, w + 0.16, 0.08, 0.2, 0, 0.6, { ao: 0, no: "" }); b.box(wk, fr, cx, y1, zf - 0.02, w + 0.12, 0.09, 0.12, 0, 0.6, { ao: 0, no: "" });
      [x0, x1].forEach(function (x) { b.box(wk, fr, x, y0 - 0.02, zf - 0.02, 0.09, y1 - y0 + 0.11, 0.12, 0, 0.6, { ao: 0 }); });
      for (var m = 1; m < mull; m++) b.box(wk, fr, x0 + w * m / mull, y0, zf + 0.01, 0.045, y1 - y0, 0.06, 0, 0.6, { ao: 0 });
      var tr = y0 + (y1 - y0) * 0.78; b.box(wk, fr, cx, tr, zf + 0.01, w, 0.045, 0.06, 0, 0.6, { ao: 0 }); K.H.portal("x", zf, x0, x1, y0, y1); };
    if (!S.noWindows) { win(-wx1, -wx0, wy0, wy1, S.mull || 3); win(wx0, wx1, wy0, wy1, S.mull || 3); }
    // the door: frame, transom glass, the open leaf swung back against the wall, an OPEN card, a bell
    b.quad("x", gl, 0, (ty0 + ty1) / 2, zf + 0.04, dw * 2, ty1 - ty0, PI, [0, 0, 1, 1]); K.H.portal("x", zf, -dw, dw, ty0, ty1); K.H.portal("x", zf, -dw, dw, 0, ty0);
    [-dw, dw].forEach(function (x) { b.box(wk, fr, x + (x < 0 ? -0.05 : 0.05), 0, zf - 0.03, 0.12, ty1 + 0.05, 0.16, 0, 0.6, { ao: 0.1 }); }); b.box(wk, fr, 0, ty0 - 0.04, zf - 0.02, dw * 2 + 0.1, 0.09, 0.14, 0, 0.6, { ao: 0, no: "" }); b.box(wk, fr, 0, ty1, zf - 0.03, dw * 2 + 0.24, 0.1, 0.16, 0, 0.6, { ao: 0, no: "" });
    var lx = S.leaf === "left" ? -dw + 0.04 : dw - 0.04, lsg = lx < 0 ? 1 : -1; var leafC = col(P.door || P.wood2 || "#5a3a24");
    b.box(wk, leafC, lx + lsg * -0.0, 0.02, zf - 0.5, 0.05, 2.4, 0.95, 0, 0.6, { ao: 0.1 }); b.quad("x", gl, lx + lsg * 0.03, 1.55, zf - 0.5, 0.62, 1.0, lsg > 0 ? HP : -HP, [0, 0, 1, 1]);
    var openUv = K.sign(192, 96, function (X, w, hh) { X.fillStyle = "#f4ecd6"; X.fillRect(0, 0, w, hh); frameIn(X, w, hh, "#8a2a26", 4, 5); txt(X, "OPEN", w / 2, hh / 2 + 3, SERIF, "700", 52, "#8a2a26", w - 20, { ls: 4 }); });
    b.quad("s", [1, 1, 1], lx + lsg * 0.04, 1.62, zf - 0.5, 0.3, 0.15, lsg > 0 ? HP : -HP, openUv);
    K.solid(lx, zf - 0.5, 0.12, 0.98, 0, 0, 2.4);
    b.box("p_brass", col("#c9a24a"), lx + lsg * 0.12, 2.42, zf - 0.08, 0.02, 0.12, 0.02, 0, 1, { ao: 0 }); b.lathe("p_brass", col("#d8b25a"), lx + lsg * 0.12, 2.28, zf - 0.08, [[0.001, 0], [0.05, 0.005], [0.045, 0.06], [0.02, 0.12], [0.005, 0.14]], 10);
    // the front strip between the storefront and the old front wall is out of bounds (beside the door)
    K.solid(-(h + dw) / 2 - 0.02, zf + FRONT_IN / 2 + 0.06, h - dw, FRONT_IN + 0.4, 0, 0, 3); K.solid((h + dw) / 2 + 0.02, zf + FRONT_IN / 2 + 0.06, h - dw, FRONT_IN + 0.4, 0, 0, 3);
    // window display platforms (trades put their window dressing on K.disp)
    K.disp = []; if (!S.noWindows && S.platform !== false) [-1, 1].forEach(function (s) { if ((s < 0 && S.platL === false) || (s > 0 && S.platR === false)) return; var x0 = s < 0 ? -wx1 : wx0, x1 = s < 0 ? -wx0 : wx1, cx = (x0 + x1) / 2, w = x1 - x0 + 0.1; b.box(wk, mulc(trim, 1.1), cx, 0, zf - 0.32, w, 0.42, 0.62, 0, 0.6, { ao: 0.25 }); b.box(tex(S.dispTop || "strip"), col(S.dispTint || P.wood || "#8a6440"), cx, 0.42, zf - 0.32, w + 0.04, 0.035, 0.66, 0, 0.6, { ao: 0, no: "" }); K.solid(cx, zf - 0.32, w, 0.66, 0, 0, 0.45); K.disp.push({ x: cx, z: zf - 0.32, w: w - 0.2, d: 0.5, y: 0.455 }); });
    // the ceiling: pressed tin with a cornice, timber boards with beams, or plain plaster
    var ck = S.ceil || "tin", cc = col(S.ceilTint || "#ffffff");
    if (ck === "tin") { b.flat(tex("tin"), cc, 0, H, 0, h * 2, h * 2, 0, 0.61, true); }
    else if (ck === "planks" || ck === "beams") { b.flat(tex("strip"), cc, 0, H, 0, h * 2, h * 2, HP, 2.4, true); if (ck === "beams") for (var k = -2; k <= 2; k++) b.box(tex("grain"), col(S.beam || "#6a4a2e"), 0, H - 0.26, k * h * 0.4, h * 2, 0.26, 0.22, 0, 1.6, { ao: 0.25, no: "t" }); }
    else b.flat(tex("plaster"), cc, 0, H, 0, h * 2, h * 2, 0, 1.6, true);
    // daylight through the display windows
    if (!S.noWindows) [-1, 1].forEach(function (s) { var cx = s * (wx0 + wx1) / 2; K.shaft(cx, zf - 0.02, wx1 - wx0 - 0.1, wy1 - 0.1, PI + s * 0.18, 2.6); });
    // the room's lamp and fill: warm, closer falloff; the sky's share cut indoors
    var lp = ctx.lamp, fl = ctx.fill, lc = S.lamp || [0xffd9a8, 1.15];
    if (lp) { lp.color.setHex(lc[0]); lp.intensity = lc[1]; lp.distance = S.lampDist || 14; lp.decay = 1.5; lp.position.set(S.lampX || 0, H - 0.9, S.lampZ === undefined ? -0.6 : S.lampZ); }
    if (fl) { fl.color.setHex(S.fillSky || 0xffe6c8); fl.groundColor.setHex(S.fillGround || 0x4a3a2c); fl.intensity = S.fill === undefined ? 0.55 : S.fill; }
    ctx.sky = S.sky === undefined ? 0.32 : S.sky;
  }

  // ───────────────────────── people: the shopkeeper behind the counter and a patron or two (the client's avatars) ─────────────────────────
  var SKIN = ["f3d9c0", "e8c19a", "d9a877", "c98f63", "a86f46", "8d5a3b", "6b4226"], HAIRC = ["1c1512", "3a2416", "6b4226", "a0703a", "c9a26a", "8a8a8a", "2a2a2a"];
  function lookFor(R, o) { o = o || {}; var b = o.body || (R() < 0.5 ? "m" : "f"); return { body: b, skin: o.skin || pick(R, SKIN), shirt: o.shirt || pick(R, ["1f2a3c", "e9e2d3", "6e1f24", "2f4a3a", "3a4a5a", "d8c39a", "5a3a24", "f5f1e6", "1c1f24", "3a7bd5"]), pants: o.pants || pick(R, ["2b2f36", "1c1f24", "6d5a3e", "2f4a7a", "3a3d42"]), hair: o.hair !== undefined ? o.hair : Math.floor(R() * 4), hairc: o.hairc || pick(R, HAIRC) }; }
  function people(K) {
    var ctx = K.ctx, list = []; K.people = list; if (RS.noPeople) return; var key = ctx.door.kind + ":" + ctx.door.i, R = rng(hash(key + "people"));
    var spawn = function (o, i) { try { var a = avatar("rs_" + key.replace(":", "_") + "_" + i, o.name || "", o.look, o.hat || null, o.outfit || null); if (a.userData.label) { a.userData.label.visible = !!o.label; a.userData.label.scale.set(1.3, 0.34, 1); } if (a.userData.blob) a.userData.blob.visible = false;
        var P = { o: o, g: a, x: o.x, z: o.z, yaw: o.face || 0, yaw0: o.face || 0, k: 0, pause: 1 + R() * 3, sp: o.speed || 0.85 };
        if (o.sit) { a.userData.sit = true; try { sitOffset(a, o.back === undefined ? 0.22 : o.back); } catch (e) {} }
        a.position.set(o.x, (o.sit ? o.sit : 0) + 0.05, o.z); a.rotation.y = P.yaw; a.traverse(function (q) { if (q.isMesh) { q.castShadow = false; } }); ctx.g.add(a); list.push(P); RS.n.people++; return P; } catch (e) { note("person", e); return null; } };
    // the keeper first (with the talk card), the others a frame or two later (an avatar is a few milliseconds to build)
    var defs = K.cast || []; var i0 = 0;
    ctx.H.after(function () { var t = 0; defs.forEach(function (o, i) { setTimeout(function () { if (ctx.left || !ctx.g.parent) return; var P = spawn(o, i); if (P && o.talk) talkFor(K, P, o); }, (t += (i === 0 ? 30 : 110))); }); });
    ctx.H.frame(function (dt) { var pl = ctx.H.w2l(player.position.x, player.position.z);
      for (var i = 0; i < list.length; i++) { var P = list[i], o = P.o, moving = false;
        if (o.walk && o.walk.length > 1) { if (P.pause > 0) { P.pause -= dt; var w0 = o.walk[P.k]; if (w0[3] !== undefined && w0[3] !== null) turn(P, w0[3], dt, 2.5); }
          else { var tg = o.walk[(P.k + 1) % o.walk.length]; var dx = tg[0] - P.x, dz = tg[1] - P.z, d = Math.hypot(dx, dz); if (d < 0.06) { P.k = (P.k + 1) % o.walk.length; P.pause = tg[2] || 0; } else { var st = Math.min(d, P.sp * dt); P.x += dx / d * st; P.z += dz / d * st; turn(P, Math.atan2(dx, dz), dt, 5); moving = true; } } }
        else if (!o.sit && o.face !== null) { var dxp = pl[0] - P.x, dzp = pl[1] - P.z, dd = Math.hypot(dxp, dzp); turn(P, dd < 5 ? Math.atan2(dxp, dzp) : P.yaw0, dt, 2.2); }
        P.g.position.x = P.x; P.g.position.z = P.z; P.g.rotation.y = P.yaw; if (P.anchor) { var w = ctx.H.l2w(P.x, P.z); P.anchor.position.set(w[0], ctx.e[1], w[1]); }
        try { animateWalk(P.g, moving ? P.sp : 0, dt); } catch (e) { if (!RS.awErr) { RS.awErr = 1; note("walk anim", e); } } } });
    ctx.H.leave(function () { list.forEach(function (P) { try { var bu = P.g && P.g.userData.bubble; if (bu) { P.g.remove(bu); if (bu.material) { if (bu.material.map) bu.material.map.dispose(); bu.material.dispose(); } P.g.userData.bubble = null; } } catch (e) {} if (P.talkId && window.PLAN_TALK && window.PLAN_TALK[P.talkId] && window.PLAN_TALK[P.talkId].rs) delete window.PLAN_TALK[P.talkId]; }); list.length = 0; });
  }
  function turn(P, want, dt, rate) { var err = Math.atan2(Math.sin(want - P.yaw), Math.cos(want - P.yaw)), tr = rate * dt; P.yaw += err > tr ? tr : err < -tr ? -tr : err; }
  // the talk card: plan/rooms_shops.json talk.<trade> (or the shop's own), {shop} and {name} filled in; the client closes it at 10 m from `g`
  function fill(s, v) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return v[k] !== undefined ? v[k] : m; }); }
  function talkFor(K, P, o) {
    var ctx = K.ctx, id = "rs_" + ctx.door.kind + "_" + ctx.door.i; window.PLAN_TALK = window.PLAN_TALK || {};
    var v = { shop: K.shopName, name: o.name, trade: K.tradeName, town: K.town || "Genesis One" };
    var src = o.talk || []; var talk = src.map(function (n) { return { t: fill(n.t, v), o: (n.o || [["Thanks", null]]).map(function (x) { return [fill(x[0], v), x[1]]; }) }; });
    P.anchor = new THREE.Object3D(); var w = ctx.H.l2w(P.x, P.z); P.anchor.position.set(w[0], ctx.e[1], w[1]);
    var T = window.PLAN_TALK[id] = { id: id, rs: true, name: o.name, role: fill(o.role || "{shop}", v), talk: talk, greet: (o.greet || []).map(function (s) { return fill(s, v); }), kw: [], get g() { return P.anchor; } }; P.talkId = id;
    // a hello when you walk up (once a visit)
    var said = false; ctx.H.frame(function () { if (said || !P.g) return; var q = ctx.H.w2l(player.position.x, player.position.z); if (Math.hypot(q[0] - P.x, q[1] - P.z) < 3.2) { said = true; if (T.greet.length && !RS.noGreet) try { npcSay({ g: P.g, name: o.name }, T.greet[Math.floor(Math.random() * T.greet.length)]); } catch (e) {} } });
    return T;
  }
  function infoCard(t, k, p) { try { $("#info-h").textContent = t; $("#info-k").textContent = k || ""; $("#info-p").textContent = p || ""; var go = $("#info-go"); if (go) go.style.display = "none"; var nv = $("#info-nav"); if (nv) nv.style.display = "none"; $("#info").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock(); sfx("ui"); } catch (e) { note("info", e); } }
  // spots: the keeper (talk, faced), the till (the client's shop with this trade's goods), the hero piece (an info card)
  function spots(K) {
    var ctx = K.ctx, H = ctx.H, k0 = K.cast && K.cast[0];
    if (k0 && K.till) H.spot(K.till[0], K.till[1], 2.7, "talk to " + k0.name + " · " + K.shopName, function () { var c = window.PLAN_TALK && window.PLAN_TALK["rs_" + ctx.door.kind + "_" + ctx.door.i]; if (c && c.talk && c.talk.length) { try { showTalk(c, 0); } catch (e) { note("talk", e); } } }, { face: true });
    if (K.shop) H.spot(K.shop.x, K.shop.z, Math.max(2.1, K.shop.r || 1.5), K.shop.prompt || ("browse and buy at " + K.shopName), function () { openRS(K.shop.venue, K); }, { face: !!K.shop.face });
    (K.infos || []).forEach(function (f) { H.spot(f.x, f.z, f.r || 1.4, f.prompt || ("about " + f.t), function () { infoCard(f.t, f.k, f.p); stampFor(K, f.stamp); }, { face: f.face !== false }); });
  }
  // ───────────────────────── the client's shop (VENUE / openShop) with this trade's goods and names ─────────────────────────
  var VEN = RS.venues = RS.venues || {}, RENAME = {};
  function venue(id, v) { if (!VEN[id]) VEN[id] = v; try { if (typeof VENUE !== "undefined" && !VENUE[id]) VENUE[id] = { title: v.title, k: v.k, items: v.items }; } catch (e) { note("venue", e); } if (v.rename) RENAME[id] = v.rename; return id; }
  function openRS(id, K) { try { if (typeof VENUE !== "undefined" && VENUE[id] && K) { VENUE[id].title = K.shopName; } openShop(id); stampFor(K, K && K.stampBuy); } catch (e) { note("shop", e); } }
  var _shopWrapped = false;
  function wrapShop() { if (_shopWrapped || typeof openShop !== "function") return; _shopWrapped = true; var orig = openShop;
    openShop = window.openShop = function (kind) { var rn = RENAME[kind], saved = null; if (rn && typeof ITEM !== "undefined") { saved = {}; for (var k in rn) { saved[k] = ITEM[k]; ITEM[k] = rn[k]; } } try { return orig.apply(this, arguments); } finally { if (saved) for (var k2 in saved) ITEM[k2] = saved[k2]; } }; }
  // ───────────────────────── passport stamps (n 280 to 289; plan/progress.json chapter "shops", added by the main session) ─────────────────────────
  function award(id) { try { var PP = window.PLAN_PROGRESS; if (PP && PP.award && id) PP.award("stamp", { id: id }); } catch (e) {} }
  function stampFor(K, id) { if (id) award(id); }
  function visited(trade) { var key = "g1:rs:seen", s = {}; try { s = JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch (e) {} if (!s[trade]) { s[trade] = 1; try { localStorage.setItem(key, JSON.stringify(s)); } catch (e) {} } return Object.keys(s).length; }

  // ───────────────────────── per-frame room life: the fans turn, daylight shafts follow the sun ─────────────────────────
  function life(K) {
    var ctx = K.ctx, b = new Bt(), any = false;
    K.fans.forEach(function (f) { var g = new THREE.Group(); g.position.set(f.x, f.y, f.z); for (var i = 0; i < 4; i++) { var a = i * HP; b.box(tex("strip"), f.c, Math.sin(a) * 0.42, 0, Math.cos(a) * 0.42, 0.16, 0.015, 0.62, a, 0.6, { ao: 0, no: "" }); } b.cyl("p_brass", col("#a8823a"), 0, -0.05, 0, 0.12, 0.12, 0.06, 12, { bot: true }); b.build(g, "rs fan"); ctx.g.add(g); K.spin.push(g); any = true; });
    (K.rotors || []).forEach(function (r) { var g = new THREE.Group(); g.position.set(r.x, r.y, r.z); try { r.fn(b); } catch (e) { note("rotor", e); } b.build(g, "rs rotor"); ctx.g.add(g); r.g = g; r.t = 0; });
    ctx.H.frame(function (dt) { (K.rotors || []).forEach(function (r) { if (!r.g) return; r.t += dt; if (r.path) { var p = r.path(r.t); r.g.position.set(p[0], r.y, p[1]); r.g.rotation.y = p[2]; } else r.g.rotation.y += dt * r.sp; }); });
    ctx.H.frame(function (dt) { for (var i = 0; i < K.spin.length; i++) K.spin[i].rotation.y += dt * 2.2; var day = 1 - nightK(); if (MAT.shaft) MAT.shaft.opacity = 0.11 * day * day; });
  }
  // ───────────────────────── sheets near the player load ahead (twice a second, the nearest store door within 28 m) ─────────────────────────
  var PF = { t: 0, last: null };
  function prefetch(dt) { PF.t -= dt; if (PF.t > 0 || typeof player === "undefined" || !player || (window.PLAN_ROOMS && PLAN_ROOMS.off)) return; PF.t = 0.5; try { if (inside) return; var best = null, bd = 28; ["store", "storefront_sl"].forEach(function (k) { var L = PLACE[k]; if (!L) return; for (var i = 0; i < L.length; i++) { var e = L[i]; var d = Math.abs(e[0] - player.position.x) + Math.abs(e[2] - player.position.z); if (d < bd) { bd = d; best = { kind: k, i: i, e: e }; } } });
      var bk = best ? best.kind + best.i : null; if (best && bk !== PF.last) { PF.last = bk; var tr = tradeOf(best); if (tr) sheetsOf(tr, PLAN_ROOMS.info(best).name, best).forEach(function (n) { sheet(n); }); } } catch (e) { note("prefetch", e); } }

  // ───────────────────────── shared pieces of the trades: signs, posters, wall runs, the cast, small props ─────────────────────────
  var LOGO = { img: null, ok: false };
  function logoImg() { if (LOGO.img) return LOGO.img; var im = new Image(); im.onload = function () { LOGO.ok = true; }; im.src = au("/tex/rs_gb_logo.png"); LOGO.img = im; return im; }
  // a shop name board: style "gold" (gold leaf on black glass), "wood" (painted frontier board), "neon", "enamel", "modern", "chalk"
  function boardDraw(style, title, sub, pal) {
    return function (X, w, h) {
      var big = h * 0.5, fg = pal && pal.signFg || "#f2dfae", bg = pal && pal.signBg || "#141210";
      if (style === "gold") { X.fillStyle = bg; X.fillRect(0, 0, w, h); var g = X.createLinearGradient(0, 0, w, h); g.addColorStop(0, "rgba(255,255,255,0.08)"); g.addColorStop(0.5, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(255,255,255,0.05)"); X.fillStyle = g; X.fillRect(0, 0, w, h); frameIn(X, w, h, "#c9a24a", 5, 10); frameIn(X, w, h, "#7a5a20", 2, 20);
        txt(X, title.toUpperCase(), w / 2, sub ? h * 0.42 : h * 0.52, SERIF, "700", big, "#e2b04a", w - 80, { gold: true, ls: 6, shadow: "rgba(0,0,0,0.8)", blur: 4 }); if (sub) txt(X, sub, w / 2, h * 0.76, SERIF, "italic 400", h * 0.17, "#d8c08a", w - 120, { ls: 2 }); }
      else if (style === "wood") { woodBg(X, w, h, pal && pal.signBg || "#4a3220", "#2e1e12", hash(title)); frameIn(X, w, h, "rgba(20,12,6,0.9)", 8, 6); frameIn(X, w, h, fg, 3, 18);
        txt(X, title.toUpperCase(), w / 2, sub ? h * 0.42 : h * 0.52, SERIF, "900", big, fg, w - 80, { ls: 5, shadow: "rgba(0,0,0,0.85)", blur: 2, dy: 4 }); if (sub) txt(X, sub.toUpperCase(), w / 2, h * 0.77, GROT, "600", h * 0.13, fg, w - 120, { ls: 6 }); }
      else if (style === "neon") { X.fillStyle = bg; X.fillRect(0, 0, w, h); var nc = pal && pal.neon || "#ff5a8a"; txt(X, title, w / 2, sub ? h * 0.42 : h * 0.5, pal && pal.neonFont || DISPLAY, "400", big * 1.05, "#fff4f8", w - 70, { ls: 4, shadow: nc, blur: 28, dy: 0, stroke: nc, lw: 6 }); if (sub) txt(X, sub.toUpperCase(), w / 2, h * 0.78, GROT, "600", h * 0.12, nc, w - 100, { ls: 8, shadow: nc, blur: 12, dy: 0 }); }
      else if (style === "enamel") { X.fillStyle = pal && pal.signBg || "#a3262a"; X.fillRect(0, 0, w, h); X.fillStyle = "rgba(255,255,255,0.08)"; X.fillRect(0, 0, w, h * 0.45); frameIn(X, w, h, "#f4ecd6", 6, 12); txt(X, title.toUpperCase(), w / 2, sub ? h * 0.42 : h * 0.52, DISPLAY, "400", big * 1.05, "#f4ecd6", w - 80, { ls: 5 }); if (sub) txt(X, sub.toUpperCase(), w / 2, h * 0.78, GROT, "600", h * 0.12, "#f4ecd6", w - 110, { ls: 6 }); }
      else if (style === "chalk") { X.fillStyle = "#1f2622"; X.fillRect(0, 0, w, h); X.fillStyle = "rgba(255,255,255,0.05)"; for (var i = 0; i < 40; i++) X.fillRect(Math.random() * w, Math.random() * h, 60, 6); txt(X, title, w / 2, sub ? h * 0.42 : h * 0.52, SERIF, "italic 700", big, "#f4f1e8", w - 60, {}); if (sub) txt(X, sub, w / 2, h * 0.78, GROT, "400", h * 0.14, "#e8d9a0", w - 80, {}); }
      else { X.fillStyle = pal && pal.signBg || "#0a1610"; X.fillRect(0, 0, w, h); txt(X, title.toUpperCase(), w / 2, sub ? h * 0.42 : h * 0.52, DISPLAY, "400", big, pal && pal.signFg || "#f5f1e6", w - 70, { ls: 8 }); if (sub) txt(X, sub.toUpperCase(), w / 2, h * 0.78, MONO, "600", h * 0.11, pal && pal.neon || "#4DDE6F", w - 90, { ls: 6 }); }
    };
  }
  // the board itself: a framed panel with the painted sign (on a wall, or hanging from chains when hang = true)
  Kit.prototype.board = function (x, y, z, w, h, ry, style, title, sub, o) {
    o = o || {}; var b = this.b, px = Math.round(1024 * Math.min(1, w / 3.2)), py = Math.round(px * h / w); if (py > 300) { py = 300; px = Math.round(py * w / h); }
    var uv = this.sign(px, py, boardDraw(style, title, sub, this.pal)); var fc = col(o.frame || (style === "gold" ? "#2a1e10" : style === "neon" ? "#151515" : this.pal.trim || "#3a2a1c"));
    var p = off(x, z, ry, 0, 0.03); b.box("p_satin", fc, p[0], y - h / 2 - 0.05, p[1], w + 0.1, h + 0.1, 0.05, ry, 1, { ao: 0, no: "" }); var q = off(x, z, ry, 0, 0.058); b.quad("s", [1, 1, 1], q[0], y, q[1], w, h, ry, uv);
    if (o.hang) { [-1, 1].forEach(function (s) { var a = off(x, z, ry, s * (w / 2 - 0.1), 0.03); b.beam("p_metal", col("#2a2622"), [a[0], y + h / 2 + 0.05, a[1]], [a[0], o.hang, a[1]], 0.012); }); }
    if (o.back) { var r = off(x, z, ry, 0, 0.0); b.quad("s", [1, 1, 1], r[0], y, r[1], w, h, ry + PI, uv); }
    return uv;
  };
  // a poster: 1928 airfield, air mail, a fly-in, Route 80, the rodeo, a space launch (drawn type and pictures, no real marks)
  function posterDraw(kind, seed) {
    return function (X, w, h) { var R = rng(seed || 5); var P = { airfield: ["#e8d9b8", "#2a4a6a", "#b5452a"], airmail: ["#f2e8d2", "#8a2a26", "#1d3b5a"], flyin: ["#f4cd5a", "#1c1f24", "#c9302c"], route: ["#1d3b5a", "#f4ecd6", "#c9302c"], rodeo: ["#e8c87a", "#5a2a14", "#1c1f24"], launch: ["#0a0f24", "#ff9a3a", "#8fd8ff"], fair: ["#f4ecd6", "#2f6a3e", "#c9a24a"] }[kind] || ["#e8d9b8", "#2a4a6a", "#b5452a"];
      X.fillStyle = P[0]; X.fillRect(0, 0, w, h); for (var i = 0; i < 1200; i++) { X.fillStyle = "rgba(80,60,40," + (R() * 0.06) + ")"; X.fillRect(R() * w, R() * h, 2, 2); }
      var plane = function (cx, cy, s, c) { X.save(); X.translate(cx, cy); X.scale(s, s); X.fillStyle = c; X.fillRect(-60, -6, 120, 12); X.fillRect(-55, -26, 110, 8); X.fillRect(-55, 18, 110, 8); X.fillRect(-8, -26, 6, 52); X.fillRect(30, -26, 6, 52); X.beginPath(); X.moveTo(-60, 0); X.lineTo(-90, -14); X.lineTo(-90, 10); X.closePath(); X.fill(); X.fillRect(60, -16, 6, 32); X.restore(); };
      if (kind === "launch") { X.fillStyle = "#ffffff"; for (var s = 0; s < 80; s++) X.fillRect(R() * w, R() * h * 0.7, 2, 2); X.fillStyle = P[2]; X.beginPath(); X.moveTo(w / 2, h * 0.18); X.lineTo(w / 2 + 26, h * 0.55); X.lineTo(w / 2 - 26, h * 0.55); X.closePath(); X.fill(); X.fillStyle = P[1]; X.beginPath(); X.moveTo(w / 2 - 22, h * 0.55); X.quadraticCurveTo(w / 2, h * 0.75, w / 2 + 22, h * 0.55); X.fill(); txt(X, "GENESIS ONE", w / 2, h * 0.84, DISPLAY, "400", w * 0.13, P[1], w - 30, { ls: 6 }); txt(X, "LAUNCH ROW · NIGHT FLIGHTS", w / 2, h * 0.92, GROT, "600", w * 0.05, P[2], w - 30, { ls: 3 }); return; }
      X.fillStyle = P[1]; X.fillRect(0, h * 0.62, w, h * 0.38); X.fillStyle = P[2]; X.beginPath(); X.arc(w * 0.72, h * 0.3, w * 0.16, 0, TAU); X.fill(); X.fillStyle = "rgba(0,0,0,0.25)"; X.beginPath(); X.moveTo(0, h * 0.62); X.lineTo(w * 0.3, h * 0.48); X.lineTo(w * 0.55, h * 0.62); X.fill(); X.beginPath(); X.moveTo(w * 0.4, h * 0.62); X.lineTo(w * 0.75, h * 0.44); X.lineTo(w, h * 0.62); X.fill();
      plane(w * 0.42, h * 0.36, w / 300, "#1c1f24");
      var T = { airfield: ["DOUGLAS AIRFIELD", "EST. 1928 · ON THE BORDER"], airmail: ["AIR MAIL", "DOUGLAS TO THE WORLD · 1928"], flyin: ["FLY-IN", "SATURDAY · THE FLIGHT LINE"], route: ["ROUTE 80", "COAST TO COAST THROUGH DOUGLAS"], rodeo: ["RODEO", "SUNDAY AT THE CORRAL"], fair: ["HARVEST FAIR", "GARDEN ROW · ALL WELCOME"] }[kind] || ["GENESIS ONE", "THE AWAKENING"];
      txt(X, T[0], w / 2, h * 0.74, DISPLAY, "400", w * 0.15, P[0], w - 30, { ls: 5 }); txt(X, T[1], w / 2, h * 0.86, GROT, "600", w * 0.045, P[0], w - 30, { ls: 2 }); X.strokeStyle = P[1]; X.lineWidth = 6; X.strokeRect(6, 6, w - 12, h - 12); };
  }
  Kit.prototype.poster = function (x, y, z, w, h, ry, kind) { var uv = this.sign(Math.round(300 * w / Math.max(w, h) * 1.4), Math.round(300 * h / Math.max(w, h) * 1.4), posterDraw(kind, hash(kind + x + z))); this.frame(x, y, z, w, h, ry, "s", uv, "#2a1e14"); };
  // a menu or price board (chalk or lit): lines of [name, detail]
  Kit.prototype.menu = function (x, y, z, w, h, ry, title, rows, style) {
    var pal = this.pal; var uv = this.sign(Math.round(560 * w / Math.max(w, h)), Math.round(560 * h / Math.max(w, h)), function (X, W, Hh) {
      var lit = style === "lit"; X.fillStyle = lit ? "#141414" : "#1f2622"; X.fillRect(0, 0, W, Hh); if (!lit) { X.fillStyle = "rgba(255,255,255,0.04)"; for (var i = 0; i < 30; i++) X.fillRect(i * 37 % W, (i * 53) % Hh, 80, 5); }
      frameIn(X, W, Hh, lit ? (pal.neon || "#ffcf6a") : "#8a6a40", 6, 6); txt(X, title, W / 2, Hh * 0.12, lit ? DISPLAY : SERIF, lit ? "400" : "italic 700", Hh * 0.1, lit ? (pal.neon || "#ffcf6a") : "#f4f1e8", W - 40, { ls: lit ? 4 : 0 });
      var n = rows.length, y0 = Hh * 0.25, dy = (Hh * 0.7) / Math.max(n, 1); rows.forEach(function (r, i) { var yy = y0 + dy * (i + 0.5); txt(X, r[0], 24, yy - dy * 0.12, lit ? GROT : SERIF, "700", Math.min(dy * 0.42, Hh * 0.07), "#f4f1e8", W * 0.62, { align: "left" }); if (r[1]) txt(X, r[1], 24, yy + dy * 0.24, GROT, "400", Math.min(dy * 0.26, Hh * 0.045), lit ? "#c8c0b0" : "#d8d0b0", W - 48, { align: "left" }); if (r[2]) txt(X, r[2], W - 24, yy - dy * 0.12, MONO, "600", Math.min(dy * 0.34, Hh * 0.055), lit ? (pal.neon || "#ffcf6a") : "#f2d27a", W * 0.3, { align: "right" }); }); });
    var b = this.b, p = off(x, z, ry, 0, 0.03); b.box("p_satin", col(style === "lit" ? "#151515" : "#5a3a20"), p[0], y - h / 2 - 0.06, p[1], w + 0.12, h + 0.12, 0.05, ry, 1, { ao: 0, no: "" }); var q = off(x, z, ry, 0, 0.06); b.quad("s", [1, 1, 1], q[0], y, q[1], w, h, ry, uv);
  };
  // wall runs: wall units side by side along the left (-1) or right (+1) wall from z0 to z1, or along the back wall from x0 to x1
  Kit.prototype.sideRun = function (side, z0, z1, h, sheetName, panels, o) { o = o || {}; var dp = o.depth || 0.42, x = side * (this.xw - dp / 2), n = Math.max(1, Math.round((z1 - z0) / (o.unit || 1.5))), w = (z1 - z0) / n, sk = smat(sheetName); for (var i = 0; i < n; i++) { var z = z0 + w * (i + 0.5); this.wallUnit(x, z, w, h, side < 0 ? HP : -HP, sk, panel(panels[i % panels.length], o.sub), o); } };
  Kit.prototype.backRun = function (x0, x1, h, sheetName, panels, o) { o = o || {}; var dp = o.depth || 0.42, z = this.zb + dp / 2, n = Math.max(1, Math.round((x1 - x0) / (o.unit || 1.5))), w = (x1 - x0) / n, sk = smat(sheetName); for (var i = 0; i < n; i++) { var x = x0 + w * (i + 0.5); this.wallUnit(x, z, w, h, 0, sk, panel(panels[i % panels.length], o.sub), o); } };
  // a row of bottles or jars on a shelf (instanced into the batch): along the piece's x from x0 to x1 at y, facing ry
  Kit.prototype.bottles = function (cx, y, cz, len, ry, n, kind, cols) { var b = this.b, R = this.R; for (var i = 0; i < n; i++) { var p = off(cx, cz, ry, -len / 2 + len * (i + 0.5) / n, 0), c = col(cols[Math.floor(R() * cols.length)]);
      if (kind === "jar") { b.lathe("x", [1, 1, 1], p[0], y, p[1], [[0.06, 0], [0.075, 0.02], [0.075, 0.2], [0.05, 0.23], [0.05, 0.26]], 10); b.cyl("p_gloss", c, p[0], y + 0.005, p[1], 0.066, 0.066, 0.17, 10); b.cyl("p_metal", col("#c9c2b0"), p[0], y + 0.26, p[1], 0.055, 0.055, 0.03, 10); }
      else if (kind === "glass") { b.lathe("x", [1, 1, 1], p[0], y, p[1], [[0.03, 0], [0.035, 0.005], [0.01, 0.02], [0.01, 0.08], [0.045, 0.14], [0.05, 0.18]], 10); }
      else { var hh = 0.24 + R() * 0.08; b.lathe("p_gloss", c, p[0], y, p[1], [[0.035, 0], [0.038, 0.01], [0.038, hh * 0.6], [0.016, hh * 0.78], [0.013, hh], [0.016, hh + 0.02]], 8); } } };
  // a model biplane (hanging from the ceiling, on a stand, on a shelf): fuselage, two wings, struts, tail, a propeller
  Kit.prototype.biplane = function (x, y, z, s, ry, c, c2) { var b = this.b, cc = col(c || "#c9302c"), c2c = col(c2 || "#f4ecd6"), dk = col("#2a2622"); var P = function (lx, lz) { return off(x, z, ry, lx * s, lz * s); };
    var a = P(0, -0.55), f = P(0, 0.55); b.beam("p_gloss", cc, [a[0], y, a[1]], [f[0], y, f[1]], 0.16 * s, 0.18 * s); var t = P(0, -0.7); b.beam("p_gloss", cc, [a[0], y, a[1]], [t[0], y + 0.04 * s, t[1]], 0.08 * s, 0.1 * s);
    [0.0, 0.32].forEach(function (dy) { var w0 = P(0, 0.25); b.box("p_gloss", c2c, w0[0], y - 0.04 * s + dy * s, w0[1], 1.25 * s, 0.025 * s, 0.26 * s, ry, 1, { ao: 0, no: "" }); }); [-0.45, 0.45].forEach(function (sx) { var q = P(sx, 0.25); b.box("p_metal", dk, q[0], y - 0.02 * s, q[1], 0.015 * s, 0.32 * s, 0.015 * s, ry, 1, { ao: 0 }); });
    var tl = P(0, -0.66); b.box("p_gloss", c2c, tl[0], y, tl[1], 0.44 * s, 0.02 * s, 0.14 * s, ry, 1, { ao: 0, no: "" }); b.box("p_gloss", cc, tl[0], y, tl[1], 0.02 * s, 0.18 * s, 0.14 * s, ry, 1, { ao: 0 }); var pr = P(0, 0.65); b.box("p_satin", col("#6a4a2e"), pr[0], y - 0.2 * s, pr[1], 0.03 * s, 0.4 * s, 0.02 * s, ry, 1, { ao: 0 }); };
  // a cruiser bicycle standing on its wheels along the piece's x
  Kit.prototype.bike = function (x, z, ry, c) { var b = this.b, fc = col(c || "#3a7bd5"), dk = col("#1c1c1c"), ch = col("#cfcfcf"); var R0 = 0.33, P = function (lx, y) { var q = off(x, z, ry, lx, 0); return [q[0], y, q[1]]; };
    [-0.52, 0.52].forEach(function (wx) { var q = off(x, z, ry, wx, 0); b.ring("p_satin", dk, q[0], R0, q[1], R0, 0.045, 18, ry, true); b.ring("p_chrome", ch, q[0], R0, q[1], R0 - 0.05, 0.012, 14, ry, true); b.beam("p_chrome", ch, [q[0], R0 - 0.29, q[1]], [q[0], R0 + 0.29, q[1]], 0.008); });
    b.beam("p_gloss", fc, P(-0.52, R0), P(-0.08, R0 + 0.02), 0.04); b.beam("p_gloss", fc, P(-0.08, R0 + 0.02), P(-0.18, R0 + 0.42), 0.045); b.beam("p_gloss", fc, P(-0.18, R0 + 0.42), P(0.36, R0 + 0.38), 0.045); b.beam("p_gloss", fc, P(-0.08, R0 + 0.02), P(0.34, R0 + 0.3), 0.045); b.beam("p_gloss", fc, P(0.34, R0 + 0.5), P(0.52, R0), 0.04); b.beam("p_gloss", fc, P(-0.52, R0), P(-0.18, R0 + 0.42), 0.03);
    b.beam("p_chrome", ch, P(0.34, R0 + 0.5), P(0.3, R0 + 0.66), 0.03); var hb = off(x, z, ry, 0.27, 0); var c0 = Math.cos(ry), s0 = Math.sin(ry); b.beam("p_chrome", ch, [hb[0] - s0 * 0.32, R0 + 0.68, hb[1] - c0 * 0.32], [hb[0] + s0 * 0.32, R0 + 0.68, hb[1] + c0 * 0.32], 0.022);
    b.box("p_satin", col("#5a3a24"), P(-0.2, 0)[0], R0 + 0.5, P(-0.2, 0)[2], 0.26, 0.06, 0.16, ry, 1, { ao: 0, no: "" }); b.beam("p_chrome", ch, P(-0.18, R0 + 0.42), P(-0.2, R0 + 0.5), 0.025); b.cyl("p_metal", dk, P(-0.08, 0)[0], R0 - 0.07, P(-0.08, 0)[2], 0.09, 0.09, 0.03, 12, { bot: true }); };
  // a felt hat (cowboy or fedora) at x, y, z: brim and crown
  Kit.prototype.hat = function (x, y, z, c, kind) { var b = this.b, cc = col(c || "#6a4a2e"); if (kind === "cap") { b.sph("p_cloth", cc, x, y, z, 0.1, 10, 0.6); b.box("p_cloth", cc, x, y, z + 0.1, 0.16, 0.012, 0.1, 0, 1, { ao: 0, no: "" }); return; } b.cyl("p_cloth", cc, x, y, z, kind === "cowboy" ? 0.24 : 0.18, kind === "cowboy" ? 0.24 : 0.18, 0.012, 16, { bot: true }); b.lathe("p_cloth", mulc(cc, 0.92), x, y + 0.01, z, [[0.11, 0], [0.105, 0.09], [0.085, 0.13], [0.03, 0.14]], 12); b.cyl("p_cloth", col("#2a1e14"), x, y + 0.012, z, 0.112, 0.112, 0.025, 12, { open: true }); };
  // hanging garments on a rail (shirts, jackets, flight suits): thin boxes with a shoulder slope
  Kit.prototype.garments = function (x0, z0, x1, z1, y, n, cols, long) { var b = this.b, R = this.R; var dx = x1 - x0, dz = z1 - z0, ry = Math.atan2(-dz, dx); b.beam("p_chrome", col("#cfcfcf"), [x0, y, z0], [x1, y, z1], 0.025);
    for (var i = 0; i < n; i++) { var t = (i + 0.5) / n, x = x0 + dx * t, z = z0 + dz * t, c = col(cols[Math.floor(R() * cols.length)]), hh = long ? 1.1 : 0.72; b.box("p_cloth", c, x, y - 0.06 - hh, z, 0.05, hh, 0.5, ry, 1, { ao: 0.2 }); b.box("p_metal", col("#3a3a3a"), x, y - 0.06, z, 0.01, 0.06, 0.02, 0, 1, { ao: 0 }); } };
  // stacks of folded shirts on a table top (y), along x from x0 to x1
  Kit.prototype.folds = function (x0, x1, y, z, n, cols, ry) { var b = this.b, R = this.R; for (var i = 0; i < n; i++) { var x = x0 + (x1 - x0) * (i + 0.5) / n, k = 3 + Math.floor(R() * 4), c = col(cols[i % cols.length]); for (var j = 0; j < k; j++) b.box("p_cloth", mulc(c, 0.92 + R() * 0.12), x + (R() - 0.5) * 0.02, y + j * 0.045, z + (R() - 0.5) * 0.02, 0.34, 0.042, 0.28, ry || 0, 1, { ao: 0.12, no: "b" }); } };
  // the cast from the config: the keeper (talk card) and the patrons; the keeper's name is picked per building
  function castFor(K, keeperAt, patrons) {
    var T = K.T, ctx = K.ctx, R = rng(hash((ctx.b && ctx.b.id || ctx.door.i) + "cast")), shopC = K.shopCfg || {}, names = shopC.keepers || T.keepers || ["Rosa", "Hank", "June", "Eli"];
    var idx = 0; try { var same = []; for (var i = 0; i < PLACE[ctx.door.kind].length; i++) { var inf = PLAN_ROOMS.info({ kind: ctx.door.kind, i: i, e: PLACE[ctx.door.kind][i] }); if (inf.name === ctx.name) same.push(i); } idx = Math.max(0, same.indexOf(ctx.door.i)); } catch (e) {}
    var nm = names[idx % names.length]; var kl = lookFor(R, Object.assign({}, T.look || {}, shopC.look || {}));
    var cast = [{ name: nm, look: kl, hat: shopC.hat || T.hat || null, outfit: T.outfit || null, x: keeperAt[0], z: keeperAt[1], face: keeperAt[2], talk: shopC.talk || T.talk, greet: shopC.greet || T.greet, role: shopC.role || T.role || "{shop}", label: true }];
    (patrons || []).forEach(function (p) { cast.push(Object.assign({ name: "", look: lookFor(R, p.look), hat: p.hat || (R() < 0.25 ? pick(R, ["hat_cowboy", "hat_cap", "hat_trucker"]) : null), outfit: null, face: p.face || 0 }, p)); });
    K.cast = cast; K.keeperName = nm; return cast;
  }
  // a sign name and subtitle from the plan.json name: "Florist (Landside arcade)" -> "Florist" / "Landside Arcade"
  function signName(n) { var m = String(n || "").match(/^(.*?)\s*\(([^)]*)\)\s*$/); var t = m ? m[1] : String(n || "Shop"), sub = m ? m[2] : ""; if (/streamline storefront/i.test(sub)) sub = "Club Walk"; if (/museum/i.test(sub)) { t = t + " Museum"; sub = "Heritage Main Street"; } if (/City, kept/i.test(sub)) sub = "The Park House"; sub = sub.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); return { title: t, sub: sub }; }

  // ───────────────────────── the trades: food and drink ─────────────────────────
  var TR = RS.trades = RS.trades || {};
  function cw(K, list) { return list[Math.floor(K.R() * list.length) % list.length]; }
  function chromeBand(K, x, y, z, w, h, ry) { var b = K.b, p = off(x, z, ry, 0, 0.03); b.box("p_satin", col("#2a1e14"), p[0], y - h / 2 - 0.06, p[1], w + 0.12, h + 0.12, 0.05, ry, 1, { ao: 0, no: "" }); var q = off(x, z, ry, 0, 0.06); b.box("p_chrome", col("#8a7a62"), q[0], y - h / 2, q[1], w, h, 0.012, ry, 1, { ao: 0, no: "bk" }); }

  // SODA FOUNTAIN: a marble fountain counter with chrome stools, the back bar and its mirror, the fountain head, booths, a menu
  TR.soda = { sheets: ["fountain"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R;
    var C = cw(K, [{ acc: "#a3262a", up: "#d8efe3", fl: "#ffffff", neon: "#ff5a6a" }, { acc: "#2f6aa8", up: "#f6dbe0", fl: "#f2eadc", neon: "#6ad0ff" }, { acc: "#2f7a4a", up: "#f6ead0", fl: "#ffffff", neon: "#7dff9a" }, { acc: "#c26a2a", up: "#e6e8f6", fl: "#f4efe6", neon: "#ffb36a" }]);
    K.pal = Object.assign(K.pal, { accent: C.acc, neon: C.neon, wood: "#f2efe8", wood2: "#2a2624", trim: "#3a2a1c", top: "#e9e6e0", signBg: "#121212" });
    shell(K, { floor: R() < 0.7 ? "checker" : "hex", floorTint: C.fl, wain: "tile", wainTint: "#ffffff", upper: "stripe", upperTint: C.up, ceil: "tin", ceilTint: "#fff8ec", trim: "#2a2624", lamp: [0xfff0dc, 1.25], fill: 0.5 });
    var cz = -0.9, cx = X(-2.5); K.counter(cx, cz, 4.8, Y(HP), { h: 1.04, d: 0.66, body: C.acc, top: "#ebe7e0", topKey: "p_gloss", front: "tin", tin: "#d8d0c0", rail: true });
    var sk = smat("fountain"); K.sideRun(-mx, -3.6, 1.4, 2.3, "fountain", R() < 0.5 ? [0, 2] : [2, 0], { body: "#f2efe8", depth: 0.44, unit: 2.5 });
    chromeBand(K, X(-4.6), 2.95, -1.1, 4.8, 0.7, Y(HP)); K.board(X(-4.58), 3.78, -1.1, 3.4, 0.68, Y(HP), "neon", K.sign1.title, K.sign1.sub || "Phosphates · Floats · Sundaes");
    // the dipping cabinet behind the counter, the fountain head, syrup pumps, a mixer, glasses and a cake under glass on the counter
    b.box("p_gloss", col("#f4f1ea"), X(-3.55), 0, -2.55, 1.4, 0.86, 0.62, Y(HP), 1, { ao: 0.2 }); b.flat(sk, [1, 1, 1], X(-3.55), 0.865, -2.55, 0.55, 1.3, Y(HP) + HP, panel(1)); b.box("x", [1, 1, 1], X(-3.55), 0.87, -2.55, 1.36, 0.06, 0.58, Y(HP), 1, { ao: 0 }); K.solid(X(-3.55), -2.55, 0.62, 1.4, 0, 0, 0.9);
    var top = 1.04, fx = X(-2.62); b.box("p_chrome", col("#e8ecf0"), fx, top, -0.6, 0.3, 0.42, 0.9, Y(HP), 1, { ao: 0 }); b.lathe("p_chrome", col("#f0f2f4"), fx, top + 0.42, -0.6, [[0.12, 0], [0.1, 0.12], [0.06, 0.2], [0.07, 0.3], [0.001, 0.32]], 14);
    [-0.3, 0, 0.3].forEach(function (dz) { b.beam("p_chrome", col("#e8ecf0"), [fx, top + 0.36, -0.6 + dz], [fx + X(0.22), top + 0.42, -0.6 + dz], 0.03); b.beam("p_chrome", col("#e8ecf0"), [fx + X(0.22), top + 0.42, -0.6 + dz], [fx + X(0.26), top + 0.3, -0.6 + dz], 0.025); b.sph("p_gloss", col("#1c1c1c"), fx, top + 0.5, -0.6 + dz, 0.035, 8); });
    for (var i = 0; i < 6; i++) { var pz = 0.15 + i * 0.17; b.lathe("p_chrome", col("#dfe3e6"), X(-2.75), top, pz, [[0.045, 0], [0.045, 0.16], [0.03, 0.2], [0.012, 0.3]], 10); b.beam("p_chrome", col("#dfe3e6"), [X(-2.75), top + 0.28, pz], [X(-2.6), top + 0.27, pz], 0.012); b.sph("p_gloss", col(["#7a1c1c", "#3a1c0c", "#f2b134", "#8cc63f", "#e25d8a", "#5a3a24"][i]), X(-2.75), top + 0.31, pz, 0.025, 8); }
    b.box("p_chrome", col("#cfd4d8"), X(-3.6), 0.9, -1.4, 0.22, 0.32, 0.3, Y(HP), 1, { ao: 0 }); [-0.07, 0.07].forEach(function (dz) { b.cyl("p_chrome", col("#e8ecf0"), X(-3.5), 1.0, -1.4 + dz, 0.045, 0.05, 0.18, 10); });
    K.bottles(X(-2.3), top, -2.3, 0.9, Y(HP), 4, "glass", ["#ffffff"]); [[-2.25, -1.6], [-2.4, -1.75]].forEach(function (p) { b.lathe("x", [1, 1, 1], X(p[0]), top, p[1], [[0.04, 0], [0.04, 0.01], [0.012, 0.02], [0.012, 0.09], [0.07, 0.13], [0.08, 0.16]], 12); b.sph("p_gloss", col(pick(R, ["#f7e7c6", "#e25d8a", "#5a3a24", "#f2d8f0"])), X(p[0]), top + 0.17, p[1], 0.05, 10); b.sph("p_gloss", col("#c2181f"), X(p[0]), top + 0.23, p[1], 0.016, 6); });
    b.cyl("p_chrome", col("#e8ecf0"), X(-2.4), top, 1.0, 0.03, 0.03, 0.18, 8); b.cyl("p_gloss", col("#f4ecd6"), X(-2.4), top + 0.18, 1.0, 0.17, 0.17, 0.012, 16); b.cyl("p_gloss", col("#6b3f22"), X(-2.4), top + 0.19, 1.0, 0.14, 0.14, 0.09, 16, { top: col("#f4e8d0") }); b.lathe("x", [1, 1, 1], X(-2.4), top + 0.19, 1.0, [[0.16, 0], [0.16, 0.14], [0.11, 0.21], [0.02, 0.24], [0.02, 0.27]], 14);
    K.register(X(-2.55), top, 1.55, Y(HP));
    for (var s = 0; s < 5; s++) K.stool(X(-1.76), -2.9 + s * 0.95, Y(-HP), { seat: C.acc, occupied: s === 3 });
    // booths on the other wall, menu and poster, globe pendants over the counter, a fan
    [[-3.62, 0], [-2.1, PI], [-0.66, 0], [0.84, PI]].forEach(function (q, j) { K.booth(X(3.72), q[0], 1.42, q[1], { c: C.acc, frame: "#5a3a24", occupied: j === 3 }); }); [-2.86, 0.09].forEach(function (z) { K.table(X(3.72), z, 1.3, 0.66, 0, { top: "#efeae2", topKey: "p_gloss", leg: "#c8ccd0" }); K.pendant(X(3.72), z, 2.4, { style: "dome", c: C.acc }); b.cyl("p_chrome", col("#e8ecf0"), X(3.95), 0.76, z, 0.03, 0.03, 0.12, 8); b.cyl("p_gloss", col("#c2181f"), X(3.85), 0.76, z, 0.025, 0.025, 0.14, 8); });
    [-2.6, -0.9, 0.8].forEach(function (z) { K.pendant(X(-2.25), z, 3.0, { style: "globe" }); }); K.fan(X(1.0), -1.0);
    K.menu(X(0.95), 2.65, K.zb + 0.02, 2.3, 1.5, 0, "At the Fountain", [["Root Beer Float", "vanilla and draft root beer"], ["Chocolate Malt", "made in the chrome cup"], ["Banana Split", "three scoops, three sauces"], ["Cherry Phosphate", "the 1928 recipe"], ["Grilled Cheese", "on sourdough"]], "lit");
    K.poster(X(4.6), 2.55, -2.86, 0.9, 1.25, Y(-HP), "airfield"); K.poster(X(4.6), 2.55, 0.09, 0.9, 1.25, Y(-HP), "route"); K.door(X(2.15), K.zb, 0, "KITCHEN"); K.clock(X(-0.7), 3.3, K.zb, 0);
    K.disp.forEach(function (d, j) { K.bottles(d.x, d.y, d.z + 0.05, d.w * 0.8, 0, 6, j ? "jar" : "bottle", ["#c2181f", "#f2b134", "#8cc63f", "#3a7bd5", "#e25d8a"]); b.lathe("x", [1, 1, 1], d.x + 0.5, d.y, d.z - 0.1, [[0.08, 0], [0.08, 0.02], [0.03, 0.05], [0.03, 0.2], [0.2, 0.32], [0.22, 0.38]], 14); [0, 1, 2].forEach(function (k) { b.sph("p_gloss", col(["#f7e7c6", "#e25d8a", "#5a3a24"][k]), d.x + 0.5 + (k - 1) * 0.1, d.y + 0.42, d.z - 0.1, 0.09, 10); }); });
    castFor(K, [X(-3.3), -0.35, Y(HP)], [{ sit: 0.76, x: X(-1.76), z: -2.9 + 3 * 0.95, face: Y(-HP), back: 0.08 }, { sit: 0.48, x: X(3.72), z: 0.84, face: PI }]); K.till = [X(-3.3), -0.35];
    K.shop = { x: X(-2.4), z: 1.55, r: 1.6, venue: K.venueId, face: true, prompt: "order at the fountain" }; K.infos = [{ x: fx, z: -0.6, t: "The fountain", k: K.shopName, p: "A marble counter, a chrome fountain head with three draft arms and a row of syrup pumps. Floats, phosphates and malts are mixed here the way they were when the first air mail planes landed at Douglas.", r: 1.3 }];
  } };

  // CANDY: a chocolate case for a counter, walls of glass jars, a pick and mix island, a lollipop tree, a brass scale
  TR.candy = { sheets: function (nm) { return /moon|rock/i.test(nm) ? ["space", "candy"] : ["candy"]; }, build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, space = /moon|rock/i.test(K.ctx.name || "");
    var C = cw(K, space ? [{ up: "#d8d8f6", fl: "#c8c8d8", acc: "#7a5ad8", neon: "#b48cff" }] : [{ up: "#f8dce4", fl: "#f6e6c8", acc: "#d84a7a", neon: "#ff7aa8" }, { up: "#d8f2e6", fl: "#f6e6c8", acc: "#2f9a6a", neon: "#7dffc8" }, { up: "#fff0c8", fl: "#f0e0ff", acc: "#c25a2a", neon: "#ffb36a" }]);
    K.pal = Object.assign(K.pal, { accent: C.acc, neon: C.neon, wood: "#f6efe4", wood2: "#5a3a24", trim: "#6a4a2e", signBg: space ? "#0a0f24" : "#2a1418" });
    shell(K, { floor: space ? "concrete" : (R() < 0.5 ? "strip" : "checker"), floorTint: C.fl, wain: "bead", wainTint: C.acc === "#d84a7a" ? "#ffe8ee" : "#eaf8f0", upper: "stripe", upperTint: C.up, ceil: "tin", ceilTint: "#fff4f6", lamp: [0xfff0e8, 1.25], fill: 0.55 });
    var sk = smat(space ? "space" : "candy"), ck = smat("candy");
    K.showcase(X(-0.3), -2.55, 3.4, 0, ck, panel(3), { body: "#f6efe4", frame: "#c9a24a" }); K.backRun(-4.4, 4.4, 2.6, "candy", R() < 0.5 ? [0, 2, 0] : [2, 0, 2], { body: "#f6efe4", unit: 2.9 });
    K.board(0, 3.65, K.zb + 0.02, 3.6, 0.7, 0, "gold", K.sign1.title, K.sign1.sub || "Fine Confections · Since 1928");
    K.sideRun(-mx, -2.2, 2.9, 2.3, "candy", [1, 0, 1], { body: "#f6efe4", unit: 1.7 }); K.sideRun(mx, -2.2, 1.0, 2.3, space ? "space" : "candy", space ? [2, 0] : [2, 3], { body: "#f6efe4", unit: 1.6 });
    // the pick and mix island: sloped bins under glass lids with scoops
    var ix = X(0.2), iz = 0.3; b.box(tex("grain"), col("#f6efe4"), ix, 0, iz, 2.0, 0.78, 1.0, 0, 0.6, { ao: 0.3 }); b.box("p_satin", col(C.acc), ix, 0.1, iz + 0.505, 1.9, 0.55, 0.01, 0, 1, { ao: 0, no: "bk" });
    [-1, 1].forEach(function (s) { var y0 = 0.82, rz = iz + s * 0.25; for (var j = 0; j < 4; j++) { var bx = ix - 0.72 + j * 0.48; b.flat(ck, [1, 1, 1], bx, y0 + 0.02, rz, 0.44, 0.44, s > 0 ? 0 : PI, [0.5 + (j % 2) * 0.25, 0.5 + (s > 0 ? 0.25 : 0), 0.75 + (j % 2) * 0.25, 0.75 + (s > 0 ? 0.25 : 0)]); b.box("x", [1, 1, 1], bx, y0 + 0.03, rz, 0.44, 0.03, 0.44, 0, 1, { ao: 0 }); } b.beam("p_chrome", col("#dfe3e6"), [ix - 0.9, y0 + 0.06, rz + s * 0.2], [ix + 0.9, y0 + 0.06, rz + s * 0.2], 0.02); });
    b.box(tex("grain"), col("#f6efe4"), ix, 0.78, iz, 2.04, 0.04, 1.04, 0, 0.6, { ao: 0, no: "b" }); K.solid(ix, iz, 2.04, 1.04, 0, 0, 0.9); K.shadow(ix, iz, 2, 1, 0);
    // the lollipop tree, giant jars on the counter, the scale, the till
    var lx = X(3.4), lz = 2.2; b.cyl("p_gloss", col("#f4ecd6"), lx, 0, lz, 0.3, 0.26, 0.5, 14); for (var i = 0; i < 14; i++) { var a = i / 14 * TAU, rr = 0.1 + R() * 0.16, hh = 0.9 + R() * 0.9; var sx = lx + Math.sin(a) * rr, sz = lz + Math.cos(a) * rr; b.beam("p_gloss", col("#f4f1ea"), [lx, 0.5, lz], [sx, hh, sz], 0.012); var cc = col(pick(R, ["#e25d8a", "#3a7bd5", "#f2b134", "#8cc63f", "#c2181f", "#9a5ad8"])); var fa = Math.atan2(sx - lx, sz - lz); for (var k = 0; k < 3; k++) { var q = off(sx, sz, fa, 0, 0.005 * k); b.disc("p_gloss", k % 2 ? [1, 1, 1] : cc, q[0], hh, q[1], 0.12 - k * 0.035, fa, 16); } } K.solid(lx, lz, 0.6, 0.6, 0, 0, 1.8);
    K.bottles(X(-0.9), 1.0, -2.55, 1.3, 0, 4, "jar", ["#e25d8a", "#3a7bd5", "#f2b134", "#8cc63f", "#c2181f"]);
    var scx = X(0.75); b.cyl("p_brass", col("#c9a24a"), scx, 1.0, -2.6, 0.12, 0.14, 0.05, 14); b.cyl("p_brass", col("#c9a24a"), scx, 1.05, -2.6, 0.02, 0.02, 0.3, 8); b.lathe("p_brass", col("#d8b25a"), scx, 1.33, -2.6, [[0.001, 0], [0.16, 0.0], [0.17, 0.04], [0.15, 0.06]], 16); b.cyl("p_gloss", col("#f4f1ea"), scx, 1.12, -2.48, 0.07, 0.07, 0.01, 14);
    K.register(X(1.25), 1.0, -2.6, 0); [-1.6, 0, 1.6].forEach(function (x) { K.pendant(X(x), -1.2, 3.1, { style: "globe" }); }); K.pendant(ix, iz, 3.0, { style: "dome", c: C.acc });
    K.disp.forEach(function (d) { for (var j = 0; j < 3; j++) { var x = d.x - d.w / 2 + 0.3 + j * (d.w - 0.6) / 2; b.beam("p_gloss", col("#f4f1ea"), [x, d.y, d.z], [x, d.y + 0.8 + j * 0.2, d.z], 0.02); var cc = col(pick(R, ["#e25d8a", "#3a7bd5", "#f2b134", "#8cc63f"])); for (var k = 0; k < 4; k++) b.disc("p_gloss", k % 2 ? [1, 1, 1] : cc, x, d.y + 0.8 + j * 0.2, d.z - 0.012 * k, 0.26 - k * 0.06, PI, 20); } });
    K.door(X(-3.7), K.zb, 0, "STOCK"); K.plant(X(-3.9), 3.0, 1.1, "flower");
    castFor(K, [X(-0.3), -3.4, 0], [{ walk: [[X(1.5), 1.6, 3, PI], [X(-0.8), 1.4, 4, PI], [X(-3.4), 0.4, 3, Y(-HP)], [X(-1.2), 1.9, 2]], x: X(1.5), z: 1.6 }]); K.till = [X(-0.3), -3.4];
    K.shop = { x: X(1.25), z: -2.6, r: 1.6, venue: K.venueId, face: true, prompt: "buy a bag of sweets" };
    K.infos = [{ x: ix, z: iz, t: "Pick and mix", k: K.shopName, p: "Eight bins of the day's sweets under glass lids: gumdrops, sour worms, peppermints, sugared orange slices. Scoop what you like into a striped bag; it is weighed on the brass scale at the counter.", r: 1.4 }];
  } };

  // COFFEE: a coffee bar with an espresso machine, grinder and pastry case, a drum roaster, cafe tables and a window bar
  TR.coffee = { sheets: ["coffee"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, nm = K.ctx.name || "", space = /rocket/i.test(nm), garden = /garden/i.test(nm);
    var C = cw(K, space ? [{ fl: "concrete", up: "plaster", ut: "#3a3f52", acc: "#ff7a3a", neon: "#ff9a5a", wood: "#2a2a30" }] : [{ fl: "concrete", up: "brick", ut: "#ffffff", acc: "#2f4a3a", neon: "#ffcf6a", wood: "#8a6440" }, { fl: "terra", up: "plaster", ut: "#f2e6d4", acc: "#b5623a", neon: "#ffd08a", wood: "#6a4a2e" }, { fl: "strip", up: "shiplap", ut: "#e8e2d6", acc: "#1f3b5a", neon: "#8fd8ff", wood: "#b08a5a" }]);
    K.pal = Object.assign(K.pal, { accent: C.acc, neon: C.neon, wood: C.wood, wood2: "#2a2624", trim: "#2a2624", top: "#3a2e26", signBg: "#141414" });
    var winSide = R() < 0.5 ? -1 : 1;   // the window bar sits behind one display window, the other keeps its display
    shell(K, { floor: C.fl, floorTint: C.fl === "concrete" ? "#d8d2c8" : "#ffffff", wain: C.up === "brick" ? null : "shiplap", wainTint: "#e8e2d6", upper: C.up, upperTint: C.ut, ceil: "beams", ceilTint: "#d8c8b0", beam: "#4a3424", platL: winSide < 0 ? false : true, platR: winSide > 0 ? false : true, lamp: [0xffdcb0, 1.15], fill: 0.5, sky: 0.38 });
    var ck = smat("coffee"); K.counter(X(-0.2), -2.45, 3.8, 0, { h: 1.02, d: 0.66, body: C.wood, top: "#3a2e26", front: C.up === "shiplap" ? "bead" : "panel" }); K.showcase(X(2.55), -2.45, 1.3, 0, ck, panel(1), { body: C.wood, frame: "#2a2624", h: 1.02 });
    K.backRun(-4.4, -1.4, 2.4, "coffee", [2, 3], { body: C.wood, unit: 1.5 }); K.backRun(1.4, 4.4, 2.4, "coffee", [3, 2], { body: C.wood, unit: 1.5 });
    K.menu(0, 3.05, K.zb + 0.02, 2.5, 1.35, 0, "Coffee Bar", [["Espresso", "single origin, pulled short"], ["Flat White", "silky steamed milk"], ["Pour-Over", "Chiricahua roast"], ["Horchata Latte", "cinnamon and rice milk"], ["Pastry of the Day", "from the case"]], "chalk");
    K.board(0, 4.0, K.zb + 0.02, 2.6, 0.5, 0, space ? "neon" : "modern", K.sign1.title, K.sign1.sub);
    // the espresso machine: a chrome body, a copper dome, two group heads with portafilters, steam wands, cups warming on top
    var ex = X(-0.9), top = 1.02; b.box("p_chrome", col("#dfe3e6"), ex, top, -2.5, 0.78, 0.44, 0.48, 0, 1, { ao: 0.1 }); b.box("p_gloss", col(C.acc), ex, top + 0.06, -2.25, 0.7, 0.3, 0.01, 0, 1, { ao: 0, no: "bk" }); b.lathe("p_brass", col("#c87a3a"), ex, top + 0.44, -2.55, [[0.2, 0], [0.18, 0.08], [0.1, 0.16], [0.03, 0.2], [0.03, 0.26]], 16); b.sph("p_gloss", col("#1c1c1c"), ex, top + 0.73, -2.55, 0.035, 8);
    [-0.18, 0.18].forEach(function (dx) { b.cyl("p_chrome", col("#e8ecf0"), ex + dx, top + 0.18, -2.18, 0.05, 0.05, 0.1, 12); b.beam("p_satin", col("#1c1c1c"), [ex + dx, top + 0.16, -2.15], [ex + dx, top + 0.15, -1.98], 0.03); b.cyl("p_gloss", col("#f4f1ea"), ex + dx, top + 0.02, -2.15, 0.035, 0.03, 0.07, 10); });
    [-0.36, 0.36].forEach(function (dx) { b.beam("p_chrome", col("#e8ecf0"), [ex + dx, top + 0.3, -2.25], [ex + dx * 1.05, top + 0.08, -2.12], 0.012); }); for (var i = 0; i < 6; i++) b.cyl("p_gloss", col("#f4f1ea"), ex - 0.25 + i * 0.1, top + 0.44, -2.4, 0.03, 0.025, 0.06, 8); b.box("p_metal", col("#3a3a3a"), ex, top, -2.12, 0.7, 0.03, 0.14, 0, 1, { ao: 0 });
    var gx = X(0.25); b.box("p_satin", col("#1c1c1c"), gx, top, -2.55, 0.22, 0.34, 0.26, 0, 1, { ao: 0.1 }); b.lathe("x", [1, 1, 1], gx, top + 0.34, -2.55, [[0.05, 0], [0.09, 0.08], [0.11, 0.24], [0.11, 0.26]], 12); b.cyl("p_satin", col("#3a2416"), gx, top + 0.36, -2.55, 0.08, 0.1, 0.16, 12);
    K.register(X(1.2), top, -2.5, 0); b.lathe("x", [1, 1, 1], X(1.6), top, -2.3, [[0.06, 0], [0.065, 0.16], [0.06, 0.18]], 10); b.cyl("p_gloss", col("#3a7a4a"), X(1.6), top + 0.01, -2.3, 0.055, 0.055, 0.05, 10);
    // the drum roaster against the side wall: drum, hopper, cooling tray, a flue up through the ceiling, sacks of green beans
    var rx = X(-3.75), rz = 0.4, enam = col(C.acc === "#2f4a3a" ? "#7a1c1c" : "#1c1c1c"); b.box("p_satin", col("#2a2622"), rx, 0, rz, 0.8, 0.7, 1.1, 0, 1, { ao: 0.35 }); [[-0.3, -0.45], [0.3, -0.45], [-0.3, 0.45], [0.3, 0.45]].forEach(function (q) { b.box("p_metal", col("#1c1c1c"), rx + q[0], 0, rz + q[1], 0.06, 0.12, 0.06, 0, 1, { ao: 0 }); });
    b.tube("p_gloss", enam, [rx, 1.05, rz - 0.5], [rx, 1.05, rz + 0.42], 0.34, 0.34, 20); b.tube("p_brass", col("#c9a24a"), [rx, 1.05, rz + 0.42], [rx, 1.05, rz + 0.5], 0.36, 0.3, 20); b.tube("p_chrome", col("#cfd4d8"), [rx, 1.05, rz + 0.5], [rx, 1.05, rz + 0.56], 0.22, 0.2, 16); b.sph("x", [1, 1, 1], rx, 1.05, rz + 0.57, 0.08, 10, 0.6);
    b.lathe("p_chrome", col("#cfd4d8"), rx, 1.36, rz - 0.15, [[0.06, 0], [0.24, 0.3], [0.26, 0.34]], 14); b.tube("p_metal", col("#3a3a3a"), [rx, 1.3, rz - 0.42], [rx, 2.0, rz - 0.42], 0.08, 0.08, 10, true); b.tube("p_metal", col("#3a3a3a"), [rx, 2.0, rz - 0.42], [rx, K.hgt, rz - 0.42], 0.09, 0.09, 10, true);
    b.cyl("p_metal", col("#5a5a5a"), rx + X(0.05), 0.0, rz + 1.05, 0.08, 0.1, 0.62, 10); b.cyl("p_metal", col("#6a6a6a"), rx + X(0.05), 0.62, rz + 1.05, 0.44, 0.44, 0.14, 24, { top: col("#3a2416") }); for (var bb2 = 0; bb2 < 30; bb2++) b.sph("p_satin", col("#5a3416"), rx + X(0.05) + (R() - 0.5) * 0.6, 0.77, rz + 1.05 + (R() - 0.5) * 0.6, 0.03, 4, 0.6); b.beam("p_chrome", col("#cfd4d8"), [rx + X(0.05), 0.8, rz + 1.05], [rx + X(0.42), 0.8, rz + 1.15], 0.025);
    b.box("p_satin", col("#2a2622"), rx + X(0.42), 0.5, rz - 0.15, 0.06, 0.5, 0.4, 0, 1, { ao: 0 }); b.cyl("g", col("#ffb03a"), rx + X(0.46), 0.75, rz - 0.15, 0.03, 0.03, 0.01, 8); K.solid(rx, rz + 0.45, 0.95, 2.3, 0, 0, 1.4);
    [[-3.6, -1.1], [-3.95, -0.7], [-3.2, -1.45]].forEach(function (p) { K.sack(X(p[0]), p[1], 0.95, "#b09a6c"); }); K.solid(X(-3.6), -1.1, 0.9, 1.1, 0, 0, 0.6); K.frame(X(-4.6), 2.6, 0.4, 1.3, 1.3, Y(HP), ck, panel(0));
    // cafe tables, a window bar with stools, cone pendants, edison bulbs
    [[2.7, -0.4], [2.7, 1.6]].forEach(function (p, j) { K.table(X(p[0]), p[1], 0.8, 0.8, 0, { round: true, top: "#e8e2d6", leg: "#1c1c1c" }); K.chair(X(p[0] - 0.7), p[1], Y(HP), { c: C.wood }); K.chair(X(p[0] + 0.7), p[1], Y(-HP), { c: C.wood, occupied: j === 0 }); b.cyl("p_gloss", col("#f4f1ea"), X(p[0] + 0.12), 0.76, p[1], 0.045, 0.04, 0.09, 10); K.pendant(X(p[0]), p[1], 2.6, { style: "bulb" }); });
    var wbx = winSide * 2.75; b.box(tex("grain"), col(C.wood), wbx, 1.02, K.zf - 0.28, 2.3, 0.05, 0.42, 0, 0.6, { ao: 0, no: "" }); [-0.9, 0.9].forEach(function (d) { b.box("p_metal", col("#1c1c1c"), wbx + d, 0, K.zf - 0.12, 0.05, 1.02, 0.05, 0, 1, { ao: 0 }); }); K.solid(wbx, K.zf - 0.28, 2.3, 0.44, 0, 0, 1.06);
    [-0.55, 0.55].forEach(function (d) { K.stool(wbx + d, K.zf - 0.95, 0, { seat: "#3a2416", metal: "#1c1c1c", mk: "p_metal", sk: "p_satin" }); });
    [-1.4, -0.2, 1.0].forEach(function (x) { K.pendant(X(x), -2.3, 2.75, { style: "cone", c: C.acc }); }); K.plant(X(-1.7), -2.1, 0.7, "vine", 1.02); K.plant(X(4.1), 3.0, 1.2, "grass"); if (garden) { K.plant(X(1.7), 3.0, 1.1, "flower"); K.plant(X(-4.0), -2.0, 1.0, "vine", 2.42); }
    K.disp.forEach(function (d) { for (var j = 0; j < 3; j++) K.sack(d.x - 0.5 + j * 0.5, d.z, 0.6, "#b09a6c"); b.cyl("p_brass", col("#c87a3a"), d.x + 0.7, d.y, d.z, 0.1, 0.1, 0.3, 12); });
    K.door(X(3.5), K.zb, 0, "ROASTERY"); K.poster(X(4.6), 2.5, -0.4, 0.8, 1.1, Y(-HP), space ? "launch" : "flyin");
    castFor(K, [X(-0.2), -3.3, 0], [{ sit: 0.46, x: X(3.4), z: -0.4, face: Y(-HP), back: 0.2 }, { walk: [[X(0.6), -1.4, 5, PI], [X(1.4), 0.6, 2], [X(0.2), 1.6, 3, PI], [X(-0.6), -0.6, 2]], x: X(0.6), z: -1.4 }]); K.till = [X(-0.2), -3.3];
    K.shop = { x: X(1.2), z: -2.5, r: 1.7, venue: K.venueId, face: true, prompt: "order a coffee" };
    K.infos = [{ x: rx, z: rz, t: "The roaster", k: K.shopName, p: "A small drum roaster turns green beans brown in about twelve minutes. They tip into the cooling tray, where the arm stirs them until they stop crackling. Every bag on the back wall was roasted in this room.", r: 1.6 }];
  } };

  // BAKERY: a brick oven with a live fire, bread racks, pastry and pie cases for a counter, flour sacks, a dough table
  TR.bakery = { sheets: ["bakery"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, bk = smat("bakery");
    K.pal = Object.assign(K.pal, { accent: "#8a3a22", neon: "#ffcf6a", wood: "#9a6a3e", wood2: "#3a2416", trim: "#4a3020", signBg: "#3a2416", signFg: "#f4e4c0" });
    shell(K, { floor: "terra", wain: "bead", wainTint: "#e8dcc4", upper: "plaster", upperTint: "#f0e2c8", ceil: "beams", ceilTint: "#d8c0a0", beam: "#5a3a22", lamp: [0xffd09a, 1.2], fill: 0.45 });
    // the oven: a brick mass on the side wall with an arched mouth, the fire glowing inside, a peel and a stack of wood
    var ox = X(-3.85), oz = -1.6, sd = Y(HP); b.box(tex("brick"), col("#c8a890"), ox, 0, oz, 2.2, 2.2, 1.4, sd, 1.2, { ao: 0.3 }); var mf = off(ox, oz, sd, 0, 0.71); b.box(tex("brick"), col("#a08070"), mf[0], 0.8, mf[1], 1.0, 0.75, 0.04, sd, 1.2, { ao: 0, no: "bk" });
    var mo = off(ox, oz, sd, 0, 0.735); b.quad("g", col("#ff8a3a"), mo[0], 1.12, mo[1], 0.62, 0.4, sd, [0, 0, 1, 1], col("#ffcf7a")); b.disc("g", col("#ff9a4a"), mo[0], 1.32, mo[1], 0.31, sd, 14); var hd = off(ox, oz, sd, 0, 0.5); b.box(tex("brick"), col("#b89a86"), hd[0], 2.2, hd[1], 1.6, 0.9, 0.6, sd, 1.2, { ao: 0, no: "b" }); b.cyl("p_metal", col("#2a2622"), off(ox, oz, sd, 0, 0.2)[0], 3.1, off(ox, oz, sd, 0, 0.2)[1], 0.16, 0.16, K.hgt - 3.1, 10, { open: true });
    var pe = off(ox, oz, sd, 0.9, 0.85); b.beam(tex("grain"), col("#c8a070"), [pe[0], 0.05, pe[1]], [pe[0], 1.9, pe[1] + 0.05], 0.04, 0.03); b.box(tex("grain"), col("#c8a070"), pe[0], 1.85, pe[1], 0.3, 0.4, 0.01, sd, 0.6, { ao: 0 }); for (var i = 0; i < 6; i++) { var lw = off(ox, oz, sd, -0.85, 0.95); b.beam(tex("grain"), col("#7a5232"), [lw[0] - 0.25, 0.08 + (i % 3) * 0.13, lw[1] - 0.1 + Math.floor(i / 3) * 0.18], [lw[0] + 0.25, 0.08 + (i % 3) * 0.13, lw[1] - 0.1 + Math.floor(i / 3) * 0.18], 0.12, 0.12); }
    K.solid(ox, oz, 1.4, 2.2, 0, 0, 2.2); K.solid(off(ox, oz, sd, -0.85, 0.95)[0], off(ox, oz, sd, -0.85, 0.95)[1], 0.6, 0.5, 0, 0, 0.5);
    // the counter: two cases (pastries, pies and cakes) and a till; bread racks behind on the back wall
    K.showcase(X(-0.3), -2.45, 2.2, 0, bk, panel(2), { body: "#9a6a3e", frame: "#b08d4a" }); K.showcase(X(1.95), -2.45, 1.9, 0, bk, panel(1), { body: "#9a6a3e", frame: "#b08d4a" }); K.register(X(1.2), 1.0, -2.6, 0);
    K.backRun(-2.4, 4.4, 2.5, "bakery", [0, 3, 0], { body: "#7a5232", unit: 2.2 }); K.board(X(0.9), 3.7, K.zb + 0.02, 3.2, 0.62, 0, "wood", K.sign1.title, K.sign1.sub);
    for (var j = 0; j < 9; j++) { var bx = X(-1.9 + j * 0.62); b.sph("p_satin", col(pick(R, ["#c88a4a", "#b8743a", "#d8a060"])), bx, 2.55, K.zb + 0.25, 0.14, 10, 0.55); }
    // the dough table and sacks, a rack cart of cooling trays
    K.table(X(1.2), 0.4, 1.8, 0.9, 0, { top: "#e8dcc0", leg: "#5a3a22", h: 0.86 }); b.flat("p_cloth", col("#f4efe4"), X(1.2), 0.865, 0.4, 1.5, 0.7, 0, [0, 0, 1, 1]); b.sph("p_satin", col("#f2e6d2"), X(0.9), 0.9, 0.35, 0.16, 12, 0.5); b.sph("p_satin", col("#f2e6d2"), X(1.4), 0.9, 0.5, 0.12, 12, 0.5); b.beam(tex("grain"), col("#c8a070"), [X(1.6), 0.9, 0.2], [X(2.0), 0.9, 0.3], 0.05);
    [[3.7, 1.4], [3.95, 1.0], [3.55, 0.8], [3.9, 1.8]].forEach(function (p) { K.sack(X(p[0]), p[1], 1.0, "#e2d6bc"); }); K.solid(X(3.75), 1.25, 0.8, 1.4, 0, 0, 0.6);
    var cx = X(3.5), cz = -0.9; [0, 1].forEach(function (s) { b.box("p_metal", col("#8a8a8a"), cx + X(s ? 0.3 : -0.3), 0, cz, 0.03, 1.7, 0.6, 0, 1, { ao: 0 }); }); for (var t = 0; t < 7; t++) { b.box("p_metal", col("#b0b0b0"), cx, 0.2 + t * 0.22, cz, 0.6, 0.015, 0.58, 0, 1, { ao: 0 }); b.flat(bk, [1, 1, 1], cx, 0.22 + t * 0.22, cz, 0.55, 0.52, 0, panel(2, [0.1 * (t % 3), 0.2, 0.1 * (t % 3) + 0.6, 0.8])); } K.solid(cx, cz, 0.65, 0.65, 0, 0, 1.7);
    [-1.4, 0.2, 1.8].forEach(function (x) { K.pendant(X(x), -1.6, 2.8, { style: "dome", c: "#2a2622" }); }); K.pendant(X(1.2), 0.4, 2.6, { style: "bulb" });
    K.disp.forEach(function (d) { for (var j = 0; j < 4; j++) { var x = d.x - d.w / 2 + 0.25 + j * (d.w - 0.5) / 3; b.cyl("p_gloss", col("#f4efe4"), x, d.y, d.z, 0.04, 0.04, 0.25, 8); b.cyl("p_gloss", col("#f4efe4"), x, d.y + 0.25, d.z, 0.2, 0.2, 0.012, 14); b.lathe("p_satin", col(pick(R, ["#c88a4a", "#e8c0a0", "#6b3f22"])), x, d.y + 0.26, d.z, [[0.17, 0], [0.18, 0.06], [0.14, 0.14], [0.001, 0.15]], 14); } });
    K.menu(X(-2.9), 2.7, K.zb + 0.02, 1.6, 1.3, 0, "Today", [["Sourdough", "baked at four"], ["Conchas", "vanilla and chocolate"], ["Peach Pie", "by the slice"], ["Cinnamon Rolls", "until they run out"]], "chalk"); K.door(X(3.6), K.zb, 0, "BAKEHOUSE"); K.poster(X(4.6), 2.5, 0.4, 0.8, 1.1, Y(-HP), "fair");
    castFor(K, [X(0.6), -3.35, 0], [{ walk: [[X(-1.6), 0.8, 4, Y(-HP)], [X(0.2), 1.9, 3, PI], [X(2.0), -1.4, 4, PI], [X(-0.4), -1.2, 3, PI]], x: X(-1.6), z: 0.8 }]); K.till = [X(0.6), -3.35];
    K.shop = { x: X(1.2), z: -2.6, r: 1.6, venue: K.venueId, face: true, prompt: "buy something from the case" };
    K.infos = [{ x: ox + X(0.9), z: oz, t: "The brick oven", k: K.shopName, p: "A wood fired oven built of local brick. The fire is lit before dawn and the bread goes in once the dome has soaked up the heat; pies and pan dulce follow as it cools through the day.", r: 1.6 }];
  } };

  // LUNCH COUNTER (Route 80, the deli, noodles, tacos, the concessions): a counter with stools, the flat top and hood, booths
  TR.diner = { sheets: ["food", "bakery"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, nm = K.ctx.name || "", fd = smat("food");
    var v = /noodle/i.test(nm) ? "noodle" : /taco/i.test(nm) ? "taco" : /deli/i.test(nm) ? "deli" : /concession|snack|scorer/i.test(nm) ? "snack" : "diner";
    var C = { diner: { acc: "#c2181f", up: "diamond", ut: "#f6efe0", fl: "checker", ft: "#ffffff", top: "#e8e2d6", neon: "#ff4a5a", lamp: "dome" }, noodle: { acc: "#8a1c1c", up: "shiplap", ut: "#3a2a20", fl: "strip", ft: "#8a6a50", top: "#5a3a24", neon: "#ff6a3a", lamp: "lantern" }, taco: { acc: "#2f8a5a", up: "plaster", ut: "#f2c88a", fl: "terra", ft: "#ffffff", top: "#e8d8b8", neon: "#ffd23a", lamp: "bulb" }, deli: { acc: "#1f3b5a", up: "stripe", ut: "#e6eef2", fl: "hex", ft: "#ffffff", top: "#e8e2d6", neon: "#8fd8ff", lamp: "globe" }, snack: { acc: "#c26a1a", up: "shiplap", ut: "#f2efe6", fl: "concrete", ft: "#d8d2c8", top: "#d8d2c8", neon: "#ffb33a", lamp: "dome" } }[v];
    K.pal = Object.assign(K.pal, { accent: C.acc, neon: C.neon, wood: v === "noodle" ? "#6a4228" : "#c8ccd0", wood2: "#2a2624", trim: v === "noodle" ? "#2a1a10" : "#2a2624", signBg: "#121212" });
    shell(K, { floor: C.fl, floorTint: C.ft, wain: v === "noodle" ? "bead" : "tile", wainTint: v === "noodle" ? "#6a4228" : "#ffffff", upper: C.up, upperTint: C.ut, ceil: v === "noodle" ? "beams" : "plaster", ceilTint: v === "noodle" ? "#6a4a32" : "#f8f6f0", beam: "#2a1a10", lamp: [v === "noodle" ? 0xffb070 : 0xfff2e0, 1.2], fill: 0.5 });
    var cz = -0.9; K.counter(X(-2.5), cz, 4.8, Y(HP), { h: 1.04, d: 0.66, body: v === "noodle" ? "#6a4228" : C.acc, top: C.top, topKey: "p_gloss", front: v === "noodle" ? "panel" : "tin", tin: "#d0d4d8", rail: v !== "noodle" });
    // the line behind: a flat top, a fryer, the hood, a pass shelf with plates; the menu above
    var lx = X(-4.25); b.box("p_metal", col("#9aa0a6"), lx, 0, -2.4, 2.2, 0.9, 0.7, Y(HP), 1, { ao: 0.2 }); b.box("p_satin", col("#2a2a2a"), lx, 0.9, -2.6, 1.3, 0.04, 0.62, Y(HP), 1, { ao: 0 }); b.box("p_metal", col("#9aa0a6"), lx, 0.9, -1.6, 0.6, 0.2, 0.62, Y(HP), 1, { ao: 0 }); b.box("p_satin", col("#3a2a10"), lx, 1.08, -1.6, 0.5, 0.02, 0.5, Y(HP), 1, { ao: 0 });
    b.box("p_metal", col("#b8bec4"), X(-4.3), 2.2, -2.4, 2.4, 0.5, 0.9, Y(HP), 1, { ao: 0, no: "" }); b.box("g", col("#fff2d8"), X(-4.05), 2.18, -2.4, 2.2, 0.02, 0.06, Y(HP), 1, { ao: 0 }); K.solid(lx, -2.4, 0.7, 2.2, 0, 0, 0.92);
    if (v === "noodle") { for (var p = 0; p < 3; p++) b.cyl("p_metal", col("#8a8a8a"), X(-4.25), 0.95, -2.9 + p * 0.35, 0.15, 0.14, 0.3, 14, { top: col("#d8c8a0") }); }
    b.box("p_metal", col("#c8ccd0"), X(-3.0), 1.5, -0.9, 0.3, 0.03, 4.2, 0, 1, { ao: 0, no: "" }); for (var q = 0; q < 7; q++) b.cyl("p_gloss", col("#f4f1ea"), X(-3.0), 1.53, -2.7 + q * 0.6, 0.12, 0.12, 0.02, 14);
    K.sideRun(-mx, -0.2, 1.6, 2.4, "food", [3], { body: "#c8ccd0", paint: true, unit: 1.8 });
    K.menu(X(-4.58), 3.25, -1.6, 2.8, 1.1, Y(HP), v === "noodle" ? "Noodle Bar" : v === "taco" ? "Tacos" : v === "deli" ? "Deli" : v === "snack" ? "Snack Window" : "Route 80 Menu",
      v === "noodle" ? [["Shoyu Ramen", "chashu, egg, scallion", ""], ["Miso Noodles", "corn and butter", ""], ["Cold Soba", "for the hot days", ""]] : v === "taco" ? [["Carne Asada", "off the plancha", ""], ["Al Pastor", "with pineapple", ""], ["Calabacitas", "squash and corn", ""]] : v === "deli" ? [["Club Sandwich", "three decks", ""], ["Pastrami on Rye", "hand cut", ""], ["Soup of the Day", "with crackers", ""]] : v === "snack" ? [["Hot Dog", "all the fixings", ""], ["Popcorn", "fresh popped", ""], ["Peanuts", "in the shell", ""]] : [["Blue Plate Special", "meatloaf and mash", ""], ["Cheeseburger", "with fries and a pickle", ""], ["Pie of the Day", "a la mode", ""]], "lit");
    var fq = v === "noodle" ? 1 : v === "taco" ? 2 : v === "deli" ? 3 : 0; K.frame(X(-4.58), 3.25, 0.65, 0.95, 0.95, Y(HP), fd, panel(fq)); K.frame(X(-4.58), 3.25, -3.75, 0.8, 0.8, Y(HP), fd, panel((fq + 1) % 4));
    // on the counter: a pie case or the special's props; the register
    if (v === "snack") { var px = X(-2.55), pz = 0.9; b.box("p_gloss", col("#c2181f"), px, 1.04, pz, 0.6, 0.12, 0.6, Y(HP), 1, { ao: 0 }); b.box("x", [1, 1, 1], px, 1.16, pz, 0.58, 0.6, 0.58, Y(HP), 1, { ao: 0 }); for (var k = 0; k < 60; k++) b.sph("p_satin", col("#f8e8a0"), px + (R() - 0.5) * 0.48, 1.18 + R() * 0.25, pz + (R() - 0.5) * 0.48, 0.03, 4); b.box("p_gloss", col("#c2181f"), px, 1.76, pz, 0.62, 0.08, 0.62, Y(HP), 1, { ao: 0, no: "" }); b.box("g", col("#fff2b0"), px, 1.73, pz, 0.5, 0.02, 0.5, Y(HP), 1, { ao: 0 }); }
    else { K.showcase(X(-2.5), 0.9, 0.9, Y(HP), smat("bakery"), panel(v === "deli" ? 1 : 1), { h: 0.55, base: 0.06, d: 0.5, body: "#c8ccd0" }); }
    if (v === "taco") K.bottles(X(-2.45), 1.04, -2.6, 0.9, Y(HP), 6, "bottle", ["#c2181f", "#2f8a5a", "#e8a020"]); if (v === "diner") { b.cyl("p_chrome", col("#e8ecf0"), X(-2.45), 1.04, -2.4, 0.04, 0.05, 0.12, 10); b.cyl("p_chrome", col("#e8ecf0"), X(-2.45), 1.04, -1.4, 0.04, 0.05, 0.12, 10); }
    K.register(X(-2.55), 1.04, 1.85, Y(HP));
    for (var s = 0; s < 5; s++) K.stool(X(-1.76), -2.9 + s * 0.95, Y(-HP), { seat: v === "noodle" ? "#3a2416" : C.acc, occupied: s === 1, mk: v === "noodle" ? "p_metal" : "p_chrome", metal: v === "noodle" ? "#2a2a2a" : "#d9d9d9" });
    // booths (or a long shared table for the noodle bar), pendants, a clock, the kitchen door
    if (v === "noodle") { K.table(X(3.3), -0.9, 0.8, 3.6, 0, { top: "#6a4228", leg: "#2a1a10" }); [-2.3, -1.4, -0.5, 0.4].forEach(function (z, j) { K.stool(X(2.55), z, Y(HP), { seat: "#3a2416", metal: "#2a2a2a", mk: "p_metal", sk: "p_satin", h: 0.62, occupied: j === 2 }); K.stool(X(4.05), z, Y(-HP), { seat: "#3a2416", metal: "#2a2a2a", mk: "p_metal", sk: "p_satin", h: 0.62 }); }); [-2.2, -0.9, 0.4].forEach(function (z) { K.pendant(X(3.3), z, 2.5, { style: "lantern", glow: "#ff6a3a" }); }); }
    else { [[-3.62, 0], [-2.1, PI], [-0.66, 0], [0.84, PI]].forEach(function (q, j) { K.booth(X(3.72), q[0], 1.42, q[1], { c: C.acc, frame: "#c8ccd0", occupied: j === 2 }); }); [-2.86, 0.09].forEach(function (z) { K.table(X(3.72), z, 1.3, 0.66, 0, { top: "#efeae2", topKey: "p_gloss", leg: "#c8ccd0" }); K.pendant(X(3.72), z, 2.4, { style: C.lamp, c: C.acc }); b.cyl("p_gloss", col("#c2181f"), X(3.9), 0.76, z, 0.025, 0.025, 0.14, 8); b.cyl("p_gloss", col("#e8c020"), X(3.98), 0.76, z, 0.025, 0.025, 0.14, 8); }); }
    if (v === "taco") { for (var f = 0; f < 3; f++) { var z0 = -3.4 + f * 1.6; for (var t2 = 0; t2 < 22; t2++) { var x = X(-4.3 + t2 * 0.41), cc2 = col(["#e8402a", "#f2b134", "#2f8a5a", "#3a7bd5", "#e25d8a"][t2 % 5]); b.quad("p_cloth", cc2, x, 3.56 - Math.sin(t2 / 21 * PI) * 0.18, z0, 0.3, 0.24, 0, [0, 0, 1, 1]); b.quad("p_cloth", cc2, x, 3.56 - Math.sin(t2 / 21 * PI) * 0.18, z0, 0.3, 0.24, PI, [0, 0, 1, 1]); } b.beam("p_metal", col("#2a2622"), [-4.6, 3.68, z0], [4.6, 3.68, z0], 0.01); } }
    if (v !== "noodle") [-2.6, -0.9, 0.8].forEach(function (z) { K.pendant(X(-2.25), z, 3.0, { style: v === "taco" ? "bulb" : "globe" }); }); else [-2.6, -0.9, 0.8].forEach(function (z) { K.pendant(X(-2.25), z, 2.8, { style: "lantern", glow: "#ff6a3a" }); });
    K.clock(X(0.9), 3.3, K.zb, 0); K.door(X(2.15), K.zb, 0, "KITCHEN"); K.poster(X(4.6), 2.6, -1.4, 0.9, 1.25, Y(-HP), v === "snack" ? "fair" : "route"); K.fan(X(1.0), -1.0);
    K.disp.forEach(function (d) { b.cyl("p_gloss", col("#f4efe4"), d.x - 0.4, d.y, d.z, 0.18, 0.18, 0.02, 16); K.frame(d.x + 0.3, d.y + 0.5, d.z + 0.1, 0.7, 0.7, PI, fd, panel(fq)); });
    castFor(K, [X(-3.3), -0.4, Y(HP)], [{ sit: v === "noodle" ? 0.62 : 0.76, x: X(-1.76), z: -2.9 + 0.95, face: Y(-HP), back: 0.08 }, v === "noodle" ? { sit: 0.62, x: X(2.55), z: -0.5, face: Y(HP), back: 0.08 } : { sit: 0.48, x: X(3.72), z: -0.66, face: 0 }]); K.till = [X(-3.3), -0.4];
    K.shop = { x: X(-2.4), z: 1.85, r: 1.6, venue: K.venueId, face: true, prompt: v === "noodle" ? "order a bowl" : v === "taco" ? "order tacos" : "order at the register" };
    K.infos = [{ x: X(-3.4), z: -2.4, t: v === "noodle" ? "The broth pots" : "The flat top", k: K.shopName, p: v === "noodle" ? "Three stock pots simmer all day behind the counter: pork bone, chicken and a vegetable dashi. Noodles are pulled to order and the bowls go out over the pass." : "A seasoned steel griddle under a stainless hood: eggs at dawn, burgers at noon, the blue plate at six. Route 80 ran coast to coast right through Douglas, and lunch counters like this fed the drivers.", r: 1.8 }];
  } };

  // TAVERN (the Tie-Down Tavern, the Cider House): a long bar with a brass rail and a back bar, the propeller, darts, a piano, high tables
  TR.tavern = { sheets: ["bar"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, cider = /cider/i.test(K.ctx.name || ""), bs = smat("bar");
    var C = cw(K, cider ? [{ up: "plaster", ut: "#e8d8b8", tin: "#c8b088", wood: "#7a5232" }] : [{ up: "shiplap", ut: "#7a5a40", tin: "#b87a4a", wood: "#5a3820" }, { up: "brick", ut: "#c8a090", tin: "#a8a090", wood: "#4a2e1a" }]);
    K.pal = Object.assign(K.pal, { accent: "#7a1c1c", neon: "#ffb36a", wood: C.wood, wood2: "#2a1a10", trim: "#2a1a10", top: "#3a2416", signBg: "#2a1a10", signFg: "#f2d8a0" });
    shell(K, { floor: "barn", floorTint: "#8a6a50", wain: "bead", wainTint: "#6a4a32", upper: C.up, upperTint: C.ut, ceil: "tin", ceilTint: C.tin, lamp: [0xffb46a, 1.0], fill: 0.4, sky: 0.25, lampDist: 12 });
    K.counter(X(-0.6), -2.35, 5.2, 0, { h: 1.08, d: 0.7, body: C.wood, top: "#3a2416", front: "panel", rail: true });
    K.backRun(-3.4, 2.2, 2.4, "bar", cider ? [1, 0, 1] : [0, 2, 0], { body: "#4a2e1a", unit: 1.9, light: "#ffb46a" }); chromeBand(K, X(-0.6), 2.95, K.zb, 5.4, 0.5, 0);
    K.board(X(-0.6), 3.75, K.zb + 0.02, 3.8, 0.7, 0, "wood", K.sign1.title, K.sign1.sub);
    // taps on the bar, glasses, a jar of pickled eggs, the register
    var tx = X(0.6); b.box("p_brass", col("#c9a24a"), tx, 1.08, -2.5, 0.9, 0.08, 0.12, 0, 1, { ao: 0, no: "" }); for (var i = 0; i < 4; i++) { var px = tx - 0.33 + i * 0.22; b.cyl("p_brass", col("#c9a24a"), px, 1.16, -2.5, 0.025, 0.025, 0.12, 8); b.cyl("p_satin", col(["#2a1a10", "#7a1c1c", "#c9a24a", "#2f4a3a"][i]), px, 1.28, -2.5, 0.02, 0.025, 0.2, 8); }
    K.bottles(X(-1.8), 1.08, -2.3, 1.0, 0, 5, "glass", ["#ffffff"]); K.bottles(X(-0.3), 1.08, -2.25, 0.4, 0, 1, "jar", ["#e8d8a0"]); K.register(X(-2.8), 1.08, -2.45, 0);
    for (var s = 0; s < 6; s++) K.stool(X(-2.75 + s * 0.85), -1.5, PI, { seat: "#5a2a14", metal: "#2a2622", mk: "p_metal", sk: "p_satin", occupied: s === 4 });
    // the propeller and the memorabilia wall, darts and a chalk board, the piano (or the cider barrels), high tables
    var wx = X(4.58), wr = Y(-HP); var hub = [wx + X(-0.08), 2.75, -1.0]; [0, PI].forEach(function (a) { var dy = Math.cos(a + 0.5), dz = Math.sin(a + 0.5); var mid = [hub[0], hub[1] + dy * 0.55, hub[2] + dz * 0.55], tip = [hub[0], hub[1] + dy * 1.25, hub[2] + dz * 1.25]; b.beam(tex("grain"), col("#6a3a1a"), hub, mid, 0.05, 0.22); b.beam(tex("grain"), col("#6a3a1a"), mid, tip, 0.04, 0.15); b.beam("p_brass", col("#c9a24a"), [tip[0], tip[1] - dy * 0.12, tip[2] - dz * 0.12], tip, 0.045, 0.155); }); b.cyl("p_brass", col("#c9a24a"), hub[0] - X(0.03), hub[1] - 0.1, hub[2], 0.1, 0.1, 0.2, 12); K.frame(wx, 1.7, 1.25, 1.3, 1.3, wr, bs, panel(3));
    var dx = X(-4.58), dr = Y(HP); var duv = K.sign(200, 200, function (X2, w, h) { var c = w / 2; var ring = [[0.5, "#1c1c1c"], [0.47, "#c2181f"], [0.43, "#1c1c1c"], [0.3, "#f2e6c8"], [0.27, "#2f7a4a"], [0.16, "#f2e6c8"], [0.06, "#2f7a4a"], [0.025, "#c2181f"]]; ring.forEach(function (r) { X2.fillStyle = r[1]; X2.beginPath(); X2.arc(c, c, r[0] * w * 0.98, 0, TAU); X2.fill(); }); X2.strokeStyle = "#c8c0a8"; X2.lineWidth = 1.5; for (var k = 0; k < 20; k++) { var a = k / 20 * TAU + PI / 20; X2.beginPath(); X2.moveTo(c, c); X2.lineTo(c + Math.cos(a) * w * 0.46, c + Math.sin(a) * w * 0.46); X2.stroke(); } });
    var dp = off(dx, 2.6, dr, 0, 0.04); b.disc("p_satin", col("#2a1a10"), off(dx, 2.6, dr, 0, 0.02)[0], 1.75, off(dx, 2.6, dr, 0, 0.02)[1], 0.3, dr, 20); b.disc("s", [1, 1, 1], dp[0], 1.75, dp[1], 0.24, dr, 24, duv);
    K.menu(dx, 1.75, 1.85, 0.6, 0.8, dr, "Darts", [["Della", "301"], ["Boone", "277"], ["Visitors", "?"]], "chalk");
    if (cider) { [[-3.95, -0.4], [-3.95, 0.5], [-3.95, 1.4]].forEach(function (p) { K.barrel(X(p[0]), p[1], 0.32, 0.8, "#7a5232", 0.3); b.box(tex("grain"), col("#3a2416"), X(p[0]), 0, p[1], 0.7, 0.3, 0.5, 0, 0.6, { ao: 0.2 }); }); K.solid(X(-3.95), 0.5, 0.75, 2.7, 0, 0, 1.1); [[3.6, 2.6], [3.95, 2.3]].forEach(function (p) { K.crate(X(p[0]), 0, p[1], 0.5, 0.36, 0.4, 0.2, "#a07a52"); for (var k = 0; k < 6; k++) b.sph("p_gloss", col(pick(R, ["#c2181f", "#8cc63f", "#e8a020"])), X(p[0]) + (R() - 0.5) * 0.36, 0.38, p[1] + (R() - 0.5) * 0.26, 0.05, 8); }); }
    else { var pz = 0.6, pxx = X(-4.2); b.box(tex("grain"), col("#2a1a10"), pxx, 0, pz, 0.6, 1.3, 1.55, 0, 0.8, { ao: 0.2 }); b.box(tex("grain"), col("#2a1a10"), pxx + X(0.32), 0.72, pz, 0.3, 0.05, 1.5, 0, 0.8, { ao: 0, no: "" }); b.box("p_gloss", col("#f4efe4"), pxx + X(0.33), 0.77, pz, 0.15, 0.02, 1.4, 0, 1, { ao: 0, no: "" }); for (var k2 = 0; k2 < 20; k2++) b.box("p_gloss", col("#1c1c1c"), pxx + X(0.37), 0.785, pz - 0.66 + k2 * 0.07, 0.07, 0.015, 0.03, 0, 1, { ao: 0 }); b.box(tex("grain"), col("#4a2e1a"), pxx + X(0.25), 1.3, pz, 0.12, 0.35, 1.3, 0, 0.8, { ao: 0, no: "" }); K.solid(pxx, pz, 0.7, 1.6, 0, 0, 1.3); K.bench(X(-3.25), pz, 1.0, Y(-HP), { c: "#2a1a10", back: false, out: "back" }); K.bottles(pxx, 1.3, pz, 0.8, Y(HP), 2, "glass", ["#ffffff"]); }
    [[2.8, -0.1], [2.8, 2.0]].forEach(function (p, j) { K.table(X(p[0]), p[1], 0.7, 0.7, 0, { round: true, h: 1.05, top: "#3a2416", leg: "#2a2622" }); K.stool(X(p[0] - 0.62), p[1], Y(HP), { seat: "#5a2a14", metal: "#2a2622", mk: "p_metal", sk: "p_satin", occupied: j === 1 }); K.stool(X(p[0] + 0.62), p[1], Y(-HP), { seat: "#5a2a14", metal: "#2a2622", mk: "p_metal", sk: "p_satin" }); K.pendant(X(p[0]), p[1], 2.5, { style: "lantern" }); });
    [-2.6, -1.0, 0.6].forEach(function (x) { K.pendant(X(x), -2.0, 2.9, { style: "bulb" }); }); K.barrel(X(3.95), -3.95, 0.34, 0.85, "#6a4428"); K.door(X(3.4), K.zb, 0, cider ? "PRESS ROOM" : "CELLAR"); K.poster(X(4.6), 2.6, 1.25 + 1.4, 0.7, 0.95, Y(-HP), "airmail"); K.clock(X(2.6), 3.3, K.zb, 0);
    K.disp.forEach(function (d) { K.barrel(d.x - 0.5, d.z, 0.22, 0.5, "#7a5232", d.y); K.bottles(d.x + 0.3, d.y, d.z, 0.7, 0, 5, "bottle", ["#5a3a14", "#2f4a2a", "#8a5a14"]); });
    castFor(K, [X(-0.6), -3.25, 0], [{ sit: 0.76, x: X(-2.75 + 4 * 0.85), z: -1.5, face: PI, back: 0.08 }, { sit: 0.76, x: X(2.8 - 0.62), z: 2.0, face: Y(HP), back: 0.08 }]); K.till = [X(-0.6), -3.25];
    K.shop = { x: X(-2.8), z: -2.45, r: 1.7, venue: K.venueId, face: true, prompt: cider ? "order a cider" : "order at the bar" };
    K.infos = [{ x: X(4.0), z: -1.0, t: "The propeller", k: K.shopName, p: "A laminated wooden propeller off a biplane that ground-looped on the old field. The pilot walked away and, the story goes, traded it for a bar tab that was never quite settled.", r: 1.6 }];
  } };

  // MARKET HALL and the farm stand: produce on tilted crates, chile ristras, a hanging scale, a chalk price board
  TR.market = { sheets: ["market"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, mk = smat("market");
    K.pal = Object.assign(K.pal, { accent: "#2f6a3e", neon: "#ffcf6a", wood: "#9a7046", wood2: "#3a2416", trim: "#3a2416", signBg: "#2f4a2a", signFg: "#f4ecd6" });
    shell(K, { floor: "concrete", floorTint: "#cfc6b8", wain: "shiplap", wainTint: "#c8b8a0", upper: "brick", upperTint: "#e0c8b8", ceil: "beams", ceilTint: "#c8b090", beam: "#4a3424", lamp: [0xffe2b8, 1.2], fill: 0.5 });
    // produce stands: tilted crate beds with the stock photos, awnings over them
    var stand = function (x, z, ry, q, aw) { b.box(tex("grain"), col("#7a5232"), x, 0, z, 1.8, 0.7, 0.9, ry, 0.6, { ao: 0.3 }); var t = off(x, z, ry, 0, 0.05); var g = b.a(mk); var c = Math.cos(ry), s = Math.sin(ry);
      var P = [[-0.9, 0.7, 0.45], [0.9, 0.7, 0.45], [0.9, 1.05, -0.45], [-0.9, 1.05, -0.45]].map(function (p) { return [x + p[0] * c + p[2] * s, p[1], z - p[0] * s + p[2] * c]; }); var uv = panel(q); var U = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]]; [0, 1, 2, 0, 2, 3].forEach(function (k) { g.p.push(P[k][0], P[k][1], P[k][2]); g.n.push(0, 0.9, 0.4); g.u.push(U[k][0], U[k][1]); g.c.push(1, 1, 1); });
      var lip = off(x, z, ry, 0, 0.46); b.box(tex("grain"), col("#9a7046"), lip[0], 0.68, lip[1], 1.84, 0.1, 0.04, ry, 0.6, { ao: 0 });
      if (aw) { [-0.85, 0.85].forEach(function (sx) { var p = off(x, z, ry, sx, -0.4); b.box(tex("grain"), col("#5a3a22"), p[0], 0, p[1], 0.06, 2.3, 0.06, ry, 0.6, { ao: 0 }); }); for (var k = 0; k < 8; k++) { var p2 = off(x, z, ry, -0.9 + k * 0.225 + 0.1125, 0.0); b.box("p_cloth", col(k % 2 ? "#f4ecd6" : aw), p2[0], 2.25, p2[1], 0.225, 0.03, 1.0, ry, 1, { ao: 0, no: "" }); } }
      K.solid(x, z, 1.85, 0.95, ry, 0, 1.05); K.shadow(x, z, 1.8, 0.9, ry); };
    stand(X(-1.0), 0.0, 0, 0, "#c2181f"); stand(X(1.2), 0.0, 0, 1, "#2f6a3e"); stand(X(-3.7), -1.3, Y(HP), 3, "#e8a020"); stand(X(3.7), -0.4, Y(-HP), 0, "#3a7bd5");
    K.counter(X(0.4), -2.6, 3.2, 0, { body: "#7a5232", top: "#9a7046", front: "panel" }); K.register(X(1.4), 1.02, -2.7, 0); K.backRun(-4.4, 4.4, 2.4, "market", [1, 2, 3], { body: "#5a3a22", unit: 2.9 });
    K.board(X(0.4), 3.8, K.zb + 0.02, 3.6, 0.6, 0, "wood", K.sign1.title, K.sign1.sub);
    for (var r = 0; r < 5; r++) { var rx = X(-2.6 + r * 0.6), rz = -3.95; for (var k = 0; k < 14; k++) b.sph("p_gloss", col(R() < 0.85 ? "#9a1a14" : "#c23a1a"), rx + (R() - 0.5) * 0.06, 3.3 - k * 0.07, rz + (R() - 0.5) * 0.06, 0.05, 6, 1.6); b.beam("p_cloth", col("#c8b48c"), [rx, 3.35, rz], [rx, 4.4, rz], 0.01); }
    var sx = X(0.4), sz = -1.6; b.beam("p_metal", col("#2a2622"), [sx, 2.3, sz], [sx, 4.4, sz], 0.012); b.cyl("p_brass", col("#c9a24a"), sx, 2.0, sz, 0.12, 0.12, 0.25, 14); b.lathe("p_metal", col("#9aa0a6"), sx, 1.6, sz, [[0.001, 0], [0.22, 0.02], [0.24, 0.12]], 14); [0, 2.1, 4.2].forEach(function (a) { b.beam("p_metal", col("#2a2622"), [sx + Math.sin(a) * 0.22, 1.72, sz + Math.cos(a) * 0.22], [sx, 2.0, sz], 0.006); });
    K.menu(X(-3.0), 2.6, K.zb + 0.02, 1.4, 1.1, 0, "Today", [["Peaches", "Willcox orchards", ""], ["Chiles", "Hatch and poblano", ""], ["Eggs", "by the dozen", ""], ["Honey", "Garden Row", ""]], "chalk");
    [[3.6, 2.5], [3.3, 2.9], [3.9, 3.0]].forEach(function (p) { b.cyl("p_cloth", col("#b08a5a"), X(p[0]), 0, p[1], 0.22, 0.18, 0.3, 12, { top: col("#e8a020") }); }); K.solid(X(3.6), 2.75, 1.0, 0.9, 0, 0, 0.35);
    [-1.2, 1.2].forEach(function (x) { K.pendant(X(x), 0.0, 2.9, { style: "dome", c: "#2f4a3a" }); }); K.door(X(-3.6), K.zb, 0, "COOL ROOM");
    K.disp.forEach(function (d) { K.crate(d.x - 0.4, d.y, d.z, 0.5, 0.3, 0.4, 0, "#a07a52"); for (var k = 0; k < 8; k++) b.sph("p_gloss", col(pick(R, ["#e8a020", "#c2181f", "#8cc63f"])), d.x - 0.4 + (R() - 0.5) * 0.4, d.y + 0.32, d.z + (R() - 0.5) * 0.3, 0.05, 8); b.cyl("p_cloth", col("#b08a5a"), d.x + 0.4, d.y, d.z, 0.2, 0.16, 0.25, 12, { top: col("#f4ecd6") }); });
    castFor(K, [X(0.4), -3.4, 0], [{ walk: [[X(0.1), 1.0, 4, PI], [X(-2.6), -0.3, 4, Y(-HP)], [X(2.4), -1.2, 3, Y(HP)], [X(2.0), 1.2, 4, PI]], x: X(0.1), z: 1.0 }]); K.till = [X(0.4), -3.4];
    K.shop = { x: X(1.4), z: -2.7, r: 1.6, venue: K.venueId, face: true, prompt: "buy from the stand" };
    K.infos = [{ x: X(-2.4), z: -3.6, t: "Chile ristras", k: K.shopName, p: "Strings of red chiles hung to dry after the harvest, the way the valley farms have done it for generations. Hang one by the door for luck and use it all winter.", r: 1.5 }];
  } };

  // ───────────────────────── the trades: shops ─────────────────────────
  function hangPlanes(K, list) { var b = K.b, R = K.R; list.forEach(function (p) { b.beam("p_metal", col("#c8c8c8"), [p[0], p[1] + 0.06, p[2]], [p[0], K.hgt, p[2]], 0.004); K.biplane(p[0], p[1], p[2], p[3] || 0.6, p[4] !== undefined ? p[4] : R() * TAU, pick(R, ["#c2181f", "#f2b134", "#3a7bd5", "#2f7a4a", "#f4ecd6"]), pick(R, ["#f4ecd6", "#c9a24a", "#1c1f24"])); }); }
  function spinner(K, x, z, sheetName, q, speed) { var b = K.b, sk = smat(sheetName); b.cyl("p_metal", col("#2a2622"), x, 0, z, 0.3, 0.32, 0.05, 14); b.cyl("p_metal", col("#2a2622"), x, 0.05, z, 0.025, 0.025, 1.8, 8, { open: true }); K.solid(x, z, 0.6, 0.6, 0, 0, 1.9); K.shadow(x, z, 0.6, 0.6, 0);
    K.rotor(x, 0, z, speed || 0.25, function (bb) { for (var f = 0; f < 4; f++) { var a = f * HP, p = [Math.sin(a) * 0.17, Math.cos(a) * 0.17]; for (var t = 0; t < 4; t++) { bb.quad(sk, [1, 1, 1], p[0], 0.55 + t * 0.34, p[1], 0.32, 0.3, a, panel(q, [((f + t) % 3) * 0.33, 0.66 - (t % 3) * 0.33, ((f + t) % 3) * 0.33 + 0.33, 0.99 - (t % 3) * 0.33])); bb.box("p_metal", col("#3a3a3a"), p[0], 0.4 + t * 0.34, p[1], 0.34, 0.012, 0.04, a, 1, { ao: 0 }); } } bb.box("p_metal", col("#3a3a3a"), 0, 1.8, 0, 0.36, 0.03, 0.36, 0, 1, { ao: 0, no: "" }); }); }

  // GIFT SHOP (Wings, the vendor village, the newsstand, the club store): postcard spinners, souvenir walls, the patch wall, jewelry, planes overhead
  TR.gift = { sheets: function (nm) { return /star|patch|launch/i.test(nm) ? ["space", "gift"] : ["gift"]; }, build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, nm = K.ctx.name || "", space = K.space || /star|patch|launch/i.test(nm), news = /newsstand/i.test(nm);
    var C = space ? { fl: "concrete", ft: "#9a98a8", wain: "shiplap", wt: "#2a3050", up: "plaster", ut: "#1c2440", ceil: "plaster", ct: "#141a30", wood: "#3a3f52", neon: "#8fd8ff" } : cw(K, [{ fl: "oak", ft: "#e8d0b0", wain: "bead", wt: "#a8c8d8", up: "damask", ut: "#f2e8d4", ceil: "tin", ct: "#fff4e8", wood: "#a07850", neon: "#ffcf6a" }, { fl: "strip", ft: "#ffffff", wain: "bead", wt: "#e8d8b8", up: "plaster", ut: "#e8d4b8", ceil: "beams", ct: "#d8c0a0", wood: "#7a5a3a", neon: "#ffb36a" }, { fl: "oak", ft: "#c8a888", wain: "shiplap", wt: "#c8d8c0", up: "stripe", ut: "#e8eef0", ceil: "tin", ct: "#f4f4ec", wood: "#8a6440", neon: "#8fd8ff" }]);
    K.pal = Object.assign(K.pal, { accent: space ? "#3a7bd5" : "#2f6aa8", neon: C.neon, wood: C.wood, wood2: "#3a2416", trim: space ? "#141a30" : "#4a3020", signBg: space ? "#0a0f24" : "#1a2a3a", signFg: "#f4ecd6" });
    shell(K, { floor: C.fl, floorTint: C.ft, wain: C.wain, wainTint: C.wt, upper: C.up, upperTint: C.ut, ceil: C.ceil, ceilTint: C.ct, lamp: [space ? 0xc8d8ff : 0xffe8c8, 1.15], fill: 0.5, sky: space ? 0.2 : 0.32 });
    var gk = space ? "space" : "gift", gs = smat(gk);
    K.counter(X(2.3), -2.55, 2.6, 0, { body: C.wood, top: "#3a2416", front: "panel" }); K.register(X(3.1), 1.02, -2.65, 0); K.showcase(X(0.15), -2.55, 1.6, 0, smat("gift"), panel(3), { body: C.wood, frame: "#b08d4a" });
    K.backRun(-4.4, -0.9, 2.4, gk, space ? [1, 3] : [0, 2], { body: C.wood, unit: 1.75 }); K.backRun(1.0, 4.4, 2.4, gk, space ? [0] : [0, 1], { body: C.wood, unit: 1.7 });
    K.sideRun(-mx, -1.9, 2.9, 2.3, news ? "gift" : gk, news ? [1, 1, 1] : space ? [3, 1, 0] : [2, 0, 2], { body: C.wood, unit: 1.6 }); K.sideRun(mx, -1.0, 2.9, 2.3, news ? "gift" : gk, news ? [1, 1] : space ? [1, 0] : [1, 0], { body: C.wood, unit: 1.95 });
    K.board(X(-2.6), 3.6, K.zb + 0.02, 3.0, 0.62, 0, space ? "neon" : "gold", K.sign1.title, K.sign1.sub);
    spinner(K, X(-1.3), 0.6, news ? "gift" : gk, 1, 0.22); if (!space) spinner(K, X(1.6), 1.2, "gift", 1, -0.18);
    if (space) { var tx = X(2.2), tz = 1.6; [0, 2.1, 4.2].forEach(function (a) { b.beam("p_metal", col("#c8ccd0"), [tx, 1.1, tz], [tx + Math.sin(a) * 0.45, 0.02, tz + Math.cos(a) * 0.45], 0.025); }); b.beam("p_gloss", col("#f4f1ea"), [tx - 0.15, 1.05, tz + 0.5], [tx + 0.25, 1.55, tz - 0.6], 0.16, 0.16); b.cyl("p_metal", col("#2a2a2a"), tx, 1.05, tz, 0.06, 0.06, 0.12, 10); K.solid(tx, tz, 0.9, 0.9, 0, 0, 1.6);
      for (var st = 0; st < 60; st++) b.sph("g", col(R() < 0.8 ? "#ffffff" : "#ffd8a0"), (R() - 0.5) * 8.6, K.hgt - 0.02, (R() - 0.5) * 8.6, 0.015 + R() * 0.02, 4); }
    else { var bx = X(1.9), bz = 2.6; b.lathe(tex("grain"), col("#b08a5a"), bx, 0, bz, [[0.34, 0], [0.42, 0.42], [0.44, 0.46]], 16); for (var k = 0; k < 12; k++) b.sph("p_cloth", col(pick(R, ["#b07a4a", "#d8c0a0", "#8a6a50", "#f4ecd6", "#5a4a3a"])), bx + (R() - 0.5) * 0.5, 0.42 + R() * 0.12, bz + (R() - 0.5) * 0.5, 0.12, 8); K.solid(bx, bz, 0.85, 0.85, 0, 0, 0.5); }
    var tbx = X(0.2), tbz = 2.3; K.table(tbx, tbz, 1.4, 0.8, 0, { top: C.wood, leg: "#3a2416" }); for (var m = 0; m < 6; m++) b.cyl("p_gloss", col(pick(R, ["#f4ecd6", "#2f6aa8", "#c2181f", "#1c1c1c"])), tbx - 0.5 + (m % 3) * 0.5, 0.76, tbz - 0.18 + Math.floor(m / 3) * 0.36, 0.045, 0.045, 0.1, 10); K.folds(tbx - 0.55, tbx + 0.55, 0.76, tbz, 0, ["#2f6aa8"], 0);
    hangPlanes(K, [[X(-1.4), 3.4, -1.0, 0.7], [X(0.9), 3.6, -0.2, 0.55], [X(-0.2), 3.3, 1.6, 0.65], [X(2.6), 3.5, 0.6, 0.5]]);
    [-2.0, 0.6].forEach(function (x) { K.pendant(X(x), -0.4, 3.0, { style: space ? "cone" : "dome", c: space ? "#c8ccd0" : "#2f4a3a" }); }); K.pendant(X(2.3), -2.3, 2.8, { style: "globe" });
    K.door(X(-3.8), K.zb + 0.0, 0, null);
    K.disp.forEach(function (d, j) { hangPlanes(K, [[d.x, d.y + 1.4, d.z, 0.55, PI / 2 + j]]); K.bottles(d.x, d.y, d.z + 0.05, d.w * 0.7, 0, 5, "jar", ["#c2181f", "#2f6aa8", "#f2b134"]); });
    castFor(K, [X(2.3), -3.35, 0], [{ walk: [[X(-2.9), 1.0, 4, Y(-HP)], [X(-0.5), 1.5, 3, 0], [X(3.4), 0.5, 4, Y(HP)], [X(0.9), -1.4, 3, PI]], x: X(-2.9), z: 1.0 }]); K.till = [X(2.3), -3.35];
    K.shop = { x: X(3.1), z: -2.65, r: 1.6, venue: K.venueId, face: true, prompt: "browse and buy" };
    K.infos = [{ x: X(-1.3), z: 0.6, t: space ? "Star charts" : "Postcards", k: K.shopName, p: space ? "Charts of the summer and winter skies over the dark sky park, mission patches from Launch Row's night flights and little rockets for the shelf." : "Two spinners of postcards: the Flight Line, the old airfield in 1928, Main Street, the mountains at dusk. Four for a few coins, and the stamps are on the counter.", r: 1.3 }];
  } };

  // OUTFITTERS (Flight Line, Frontier, the Club Walk, Launch Row, the tailor, Flight Gear): cubbies, a jacket rail, a round rack, the fitting rooms
  TR.outfit = { sheets: ["apparel"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, nm = K.ctx.name || "", space = K.space || /launch/i.test(nm), tailor = /tailor/i.test(nm), ap = smat("apparel");
    var C = space ? { fl: "concrete", ft: "#a8a6b4", wain: "shiplap", wt: "#3a4058", up: "plaster", ut: "#2a3048", ceil: "plaster", ct: "#1c2238", wood: "#5a5f72" } : cw(K, [{ fl: "oak", ft: "#c8a888", wain: "bead", wt: "#2f4a3a", up: "plaster", ut: "#e8dcc8", ceil: "tin", ct: "#e8e0d0", wood: "#7a5232" }, { fl: "strip", ft: "#d8c0a0", wain: "shiplap", wt: "#5a4030", up: "brick", ut: "#d8b8a8", ceil: "beams", ct: "#c8b090", wood: "#5a3820" }, { fl: "oak", ft: "#a88868", wain: "bead", wt: "#1f3b5a", up: "plaster", ut: "#ece2d0", ceil: "tin", ct: "#f2ece0", wood: "#8a6440" }]);
    K.pal = Object.assign(K.pal, { accent: "#2f4a3a", neon: space ? "#ff9a3a" : "#ffcf6a", wood: C.wood, wood2: "#2a1a10", trim: "#2a1a10", signBg: space ? "#0a0f24" : "#2a1a10", signFg: "#f2dfae" });
    shell(K, { floor: C.fl, floorTint: C.ft, wain: C.wain, wainTint: C.wt, upper: C.up, upperTint: C.ut, ceil: C.ceil, ceilTint: C.ct, beam: "#3a2416", lamp: [space ? 0xd0dcff : 0xffe4c4, 1.15], fill: 0.5 });
    K.counter(X(-2.2), -2.55, 2.6, 0, { body: C.wood, top: "#2a1a10", front: "panel" }); K.register(X(-1.4), 1.02, -2.65, 0); b.box("p_cloth", col("#c8b48c"), X(-2.8), 1.02, -2.5, 0.4, 0.06, 0.3, 0.2, 1, { ao: 0 });
    K.backRun(-4.4, 1.2, 2.5, "apparel", [2, 3, 2], { body: C.wood, unit: 1.85 }); K.board(X(-1.6), 3.65, K.zb + 0.02, 3.0, 0.6, 0, space ? "neon" : "wood", K.sign1.title, K.sign1.sub);
    K.sideRun(-mx, -1.9, 2.9, 2.5, "apparel", [0, 0, 3], { body: C.wood, unit: 1.6 });
    // the jacket rail along the far wall, a wall mirror, the round rack, the folding table (or the tailor's cutting table)
    var cols = space ? ["#e86a1a", "#f4f1ea", "#c8ccd0", "#2a3048", "#e86a1a"] : ["#5a3a24", "#7a5a3a", "#2f3a4a", "#6a6a4a", "#3a2a20", "#8a6a4a", "#2a4a6a"]; var rx = X(4.28);
    [-1, 1].forEach(function (s) { b.box("p_metal", col("#2a2622"), rx, 1.75, -0.4 + s * 2.2, 0.3, 0.04, 0.04, 0, 1, { ao: 0 }); }); K.garments(rx, -2.6, rx, 1.8, 1.8, 15, cols, true); K.solid(rx, -0.4, 0.62, 4.6, 0, 0, 1.9);
    var mz = 2.65; b.box("p_satin", col("#2a1a10"), X(4.56), 0.2, mz, 0.06, 2.0, 0.7, 0, 1, { ao: 0 }); b.box("p_chrome", col("#f4f8fc"), X(4.52), 0.28, mz, 0.01, 1.84, 0.58, 0, 1, { ao: 0, no: "b" });
    if (tailor) { K.table(X(0.6), 0.6, 2.0, 1.0, 0, { top: "#c8b090", leg: "#3a2416", h: 0.9 }); for (var f = 0; f < 4; f++) b.beam("p_cloth", col(pick(R, ["#2a3a5a", "#5a3a2a", "#3a3a3a", "#8a7a6a", "#1f3b2c"])), [X(0.0) + f * 0.12 * mx, 0.95, 0.25 + f * 0.18], [X(1.2) + f * 0.12 * mx, 0.95, 0.25 + f * 0.18], 0.1, 0.1); var sx = X(1.3), sz = 0.8; b.box("p_gloss", col("#1c1c1c"), sx, 0.9, sz, 0.42, 0.1, 0.2, 0, 1, { ao: 0 }); b.box("p_gloss", col("#1c1c1c"), sx - X(0.18), 1.0, sz, 0.08, 0.28, 0.16, 0, 1, { ao: 0 }); b.box("p_gloss", col("#1c1c1c"), sx, 1.24, sz, 0.42, 0.08, 0.16, 0, 1, { ao: 0 }); b.cyl("p_chrome", col("#e8ecf0"), sx + X(0.2), 1.1, sz, 0.05, 0.05, 0.04, 10);
      for (var bo = 0; bo < 6; bo++) b.cyl("p_cloth", col(pick(R, ["#2a3a5a", "#5a3a2a", "#3a3a3a", "#8a7a6a", "#c8b090", "#6e1f24"])), X(-0.1) + bo * 0.16 * mx, 0, 2.3, 0.07, 0.07, 1.4, 10); }
    else { K.table(X(0.0), 0.5, 1.8, 0.9, 0, { top: C.wood, leg: "#2a1a10" }); K.folds(X(-0.7), X(0.7), 0.76, 0.5, 5, space ? ["#e86a1a", "#f4f1ea", "#2a3048"] : ["#2f3a4a", "#8a2a26", "#e8dcc8", "#3a5a3a", "#6a5a4a"], 0);
      var rrx = X(1.9), rrz = 1.6; b.cyl("p_chrome", col("#cfcfcf"), rrx, 0, rrz, 0.28, 0.28, 0.03, 14); b.cyl("p_chrome", col("#cfcfcf"), rrx, 0.03, rrz, 0.025, 0.025, 1.35, 8, { open: true }); b.ring("p_chrome", col("#cfcfcf"), rrx, 1.38, rrz, 0.5, 0.02, 20); for (var g = 0; g < 14; g++) { var a = g / 14 * TAU; b.box("p_cloth", col(pick(R, cols)), rrx + Math.sin(a) * 0.5, 0.62, rrz + Math.cos(a) * 0.5, 0.36, 0.72, 0.05, a - HP, 1, { ao: 0.15 }); } K.solid(rrx, rrz, 1.15, 1.15, 0, 0, 1.4); }
    // the fitting rooms in the back corner: posts, curtain rails, curtains, a stool, a hook
    var fx0 = X(1.75), fx1 = X(4.45); [0, 1].forEach(function (k) { var cx = fx0 + (fx1 - fx0) * (k + 0.5) / 2; b.box(tex("grain"), col(C.wood), cx, 0, -3.15, 0.04, 2.3, 0.06, 0, 1, { ao: 0 }); b.box(tex("grain"), col(C.wood), fx0 + (fx1 - fx0) * k / 2 + (k ? 0 : 0), 0, -3.9, 0.05, 2.3, 1.5, 0, 0.6, { ao: 0.1 }); var w = Math.abs(fx1 - fx0) / 2 - 0.1; for (var c = 0; c < 6; c++) b.box("p_cloth", col(space ? "#3a4058" : "#6e1f24"), cx - w / 2 + (c + 0.5) * w / 6, 0.12, -3.15 + (c % 2) * 0.05, w / 6 + 0.02, 2.05, 0.03, 0, 1, { ao: 0.1 }); b.beam("p_brass", col("#c9a24a"), [cx - w / 2, 2.22, -3.15], [cx + w / 2, 2.22, -3.15], 0.025); }); K.solid((fx0 + fx1) / 2, -3.9, Math.abs(fx1 - fx0), 1.5, 0, 0, 2.3);
    if (space) { for (var h = 0; h < 4; h++) b.sph("p_gloss", col(h % 2 ? "#f4f1ea" : "#e86a1a"), X(-4.4), 2.6, -1.4 + h * 0.9, 0.16, 12); }
    else for (var hh = 0; hh < 5; hh++) K.hat(X(-4.42) + X(0.16), 2.62, -1.6 + hh * 0.85, pick(R, ["#5a3a24", "#2a2a2a", "#8a6a4a", "#c8b090"]), "cowboy");
    [-2.2, 0.0, 1.9].forEach(function (x, j) { K.pendant(X(x), j === 0 ? -2.4 : 0.8, 2.9, { style: space ? "cone" : "dome", c: space ? "#c8ccd0" : "#2f4a3a" }); });
    K.disp.forEach(function (d) { K.garments(d.x - d.w / 2 + 0.1, d.z, d.x + d.w / 2 - 0.1, d.z, d.y + 1.6, 5, cols, false); K.hat(d.x, d.y + 0.02, d.z - 0.05, "#6a4a2e", "cowboy"); });
    castFor(K, [X(-2.2), -3.35, 0], [{ walk: [[X(3.6), -1.6, 5, Y(HP)], [X(1.0), 0.0, 2], [X(-3.6), 0.6, 4, Y(-HP)], [X(-0.2), 1.6, 3, PI]], x: X(3.6), z: -1.6 }]); K.till = [X(-2.2), -3.35];
    K.shop = { x: X(-1.4), z: -2.65, r: 1.6, venue: K.venueId, face: true, prompt: "browse and buy" };
    K.infos = [{ x: rx - X(0.5), z: -0.4, t: space ? "Flight suits" : "The jacket rail", k: K.shopName, p: space ? "Orange and white flight suits for Launch Row's night flights, with reflective tape and a dozen pockets. Helmets on the shelf are for show." : "Canvas work jackets and leather flight jackets, the kind the mail pilots wore over the border in the open cockpits of the 1920s. Try one on behind the curtain.", r: 1.6 }];
  } };

  // THE GIVEBACK SHOP (the Giveback Desk on the Club Walk): GIVEBACK merch walls, a lit logo, an island of folded tees, caps on stands
  TR.giveback = { sheets: ["giveback"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, gs = smat("giveback"), im = logoImg();
    K.pal = Object.assign(K.pal, { accent: "#4DDE6F", neon: "#4DDE6F", wood: "#c8a878", wood2: "#1f3b2c", trim: "#0f1f16", signBg: "#0a1610", signFg: "#f5f1e6" });
    shell(K, { floor: "concrete", floorTint: "#c8c4bc", wain: null, upper: "plaster", upperTint: "#2a4a36", ceil: "plaster", ceilTint: "#1a2a20", frame: "#0f1f16", lamp: [0xf4fff0, 1.25], fill: 0.5, sky: 0.3 });
    // the lit logo on the back wall (the GIVEBACK mark is 2:1, sized by its height), a green neon line under it
    var luv = K.sign(1024, 512, function (X2, w, h) { X2.fillStyle = "#0a1610"; X2.fillRect(0, 0, w, h); var g = X2.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.55); g.addColorStop(0, "rgba(77,222,111,0.18)"); g.addColorStop(1, "rgba(77,222,111,0)"); X2.fillStyle = g; X2.fillRect(0, 0, w, h); if (LOGO.ok) { var lh = h * 0.86; X2.drawImage(im, (w - lh * 2) / 2, (h - lh) / 2, lh * 2, lh); } else txt(X2, "GIVEBACK", w / 2, h / 2, DISPLAY, "400", h * 0.36, "#f5f1e6", w - 60, { ls: 10 }); });
    b.box("p_satin", col("#0a1610"), 0, 2.0, K.zb + 0.04, 3.36, 1.76, 0.06, 0, 1, { ao: 0, no: "" }); b.quad("s", [1, 1, 1], 0, 2.88, K.zb + 0.075, 3.2, 1.6, 0, luv); b.box("g", col("#4DDE6F"), 0, 1.86, K.zb + 0.08, 3.2, 0.03, 0.03, 0, 1, { ao: 0 }); b.box("g", col("#4DDE6F"), 0, 3.9, K.zb + 0.08, 3.2, 0.03, 0.03, 0, 1, { ao: 0 });
    K.backRun(-4.4, -1.8, 2.5, "giveback", [0, 2], { body: "#c8a878", unit: 1.3, light: "#e8ffe8" }); K.backRun(1.8, 4.4, 2.5, "giveback", [1, 3], { body: "#c8a878", unit: 1.3, light: "#e8ffe8" });
    K.sideRun(-mx, -1.6, 2.9, 2.5, "giveback", [0, 2, 1], { body: "#c8a878", unit: 1.5, light: "#e8ffe8" }); K.sideRun(mx, -0.8, 2.9, 2.5, "giveback", [1, 3], { body: "#c8a878", unit: 1.85, light: "#e8ffe8" });
    // the island: folded tees in the brand colours, caps on stands; the counter with a green front and a tablet till
    var ix = X(-0.6), iz = 0.7; b.box(tex("grain"), col("#c8a878"), ix, 0, iz, 2.2, 0.8, 1.0, 0, 0.6, { ao: 0.3 }); b.box("p_satin", col("#1f3b2c"), ix, 0.1, iz + 0.505, 2.1, 0.6, 0.01, 0, 1, { ao: 0, no: "bk" }); b.box(tex("grain"), col("#d8b888"), ix, 0.8, iz, 2.3, 0.05, 1.1, 0, 0.6, { ao: 0, no: "b" }); K.solid(ix, iz, 2.3, 1.1, 0, 0, 0.9); K.shadow(ix, iz, 2.2, 1.0, 0);
    K.folds(ix - 0.9, ix + 0.9, 0.85, iz - 0.2, 5, ["#1f3b2c", "#141414", "#f5f1e6", "#8a8a8a", "#1f3b2c"], 0); K.folds(ix - 0.9, ix + 0.9, 0.85, iz + 0.25, 5, ["#141414", "#1f3b2c", "#f5f1e6", "#1f3b2c", "#141414"], 0);
    var tuv = K.sign(256, 128, function (X2, w, h) { X2.fillStyle = "#1f3b2c"; X2.fillRect(0, 0, w, h); if (LOGO.ok) { var lh = h * 0.8; X2.drawImage(im, (w - lh * 2) / 2, (h - lh) / 2, lh * 2, lh); } });
    [-1, 1].forEach(function (s) { var sx = X(2.0 + s * 0.5), sz = 1.4; b.cyl("p_metal", col("#1c1c1c"), sx, 0, sz, 0.18, 0.2, 0.04, 12); b.cyl("p_metal", col("#1c1c1c"), sx, 0.04, sz, 0.015, 0.015, 1.3, 6, { open: true }); K.hat(sx, 1.34, sz, s < 0 ? "#1f3b2c" : "#141414", "cap"); b.quad("s", [1, 1, 1], sx, 1.37, sz + 0.105, 0.12, 0.06, 0, tuv); K.solid(sx, sz, 0.4, 0.4, 0, 0, 1.4); });
    K.counter(X(2.6), -2.55, 2.2, 0, { body: "#1f3b2c", top: "#d8b888", front: "panel" }); b.box("p_gloss", col("#141414"), X(2.9), 1.02, -2.6, 0.26, 0.02, 0.2, 0.3, 1, { ao: 0 }); var cuv = K.sign(512, 128, function (X2, w, h) { X2.fillStyle = "#0a1610"; X2.fillRect(0, 0, w, h); if (LOGO.ok) { var lh = h * 0.84; X2.drawImage(im, 20, (h - lh) / 2, lh * 2, lh); } txt(X2, "OFFICIAL MERCH", w * 0.68, h / 2, DISPLAY, "400", h * 0.34, "#4DDE6F", w * 0.5, { ls: 4 }); }); b.quad("s", [1, 1, 1], X(2.6), 0.6, -2.55 + 0.335, 1.6, 0.4, 0, cuv);
    K.board(X(-2.9), 3.75, K.zb + 0.02, 2.6, 0.5, 0, "modern", K.sign1.title, K.sign1.sub);
    [-1.8, 0.6, 2.6].forEach(function (x, j) { K.pendant(X(x), j === 2 ? -2.3 : 0.6, 2.9, { style: "cone", c: "#1f3b2c", glow: "#f0fff0" }); }); K.plant(X(-3.9), 3.0, 1.2, "grass"); K.plant(X(3.9), 3.0, 1.1, "grass");
    K.disp.forEach(function (d, j) { b.box("p_satin", col("#0a1610"), d.x, d.y, d.z + 0.05, 1.2, 1.1, 0.04, 0, 1, { ao: 0 }); b.quad("s", [1, 1, 1], d.x, d.y + 0.55, d.z + 0.075, 1.1, 0.55, PI, tuv); b.quad("s", [1, 1, 1], d.x, d.y + 0.55, d.z + 0.02, 1.1, 0.55, 0, tuv); K.folds(d.x - 0.5, d.x + 0.5, d.y, d.z - 0.15, 3, ["#1f3b2c", "#f5f1e6", "#141414"], 0); });
    castFor(K, [X(2.6), -3.35, 0], [{ walk: [[X(-3.5), 0.2, 5, Y(-HP)], [X(-0.6), 1.8, 4, PI], [X(3.5), 0.4, 4, Y(HP)], [X(0.6), -1.8, 4, PI]], x: X(-3.5), z: 0.2 }]); K.till = [X(2.6), -3.35];
    K.shop = { x: X(2.9), z: -2.6, r: 1.6, venue: K.venueId, face: true, prompt: "browse and buy GIVEBACK merch" };
    K.infos = [{ x: 0, z: -3.6, t: "GIVEBACK", k: "Giveback Ventures", p: "The GIVEBACK shop on the Club Walk: tees, hoodies, caps, packs and the crew lanyard. Giveback Ventures builds the giving rails under Genesis One, where a share of every protocol sale goes to verified nonprofits, automatically and on chain.", r: 1.8 }];
  } };

  // HATS (the hat shop, the milliner): walls of hats, hat stands on a round table, hat boxes, the blocking bench and its steamer
  TR.hats = { sheets: ["apparel"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, ap = smat("apparel");
    K.pal = Object.assign(K.pal, { accent: "#6e1f24", neon: "#ffcf6a", wood: "#6a4428", wood2: "#2a1a10", trim: "#2a1a10", signBg: "#141210" });
    shell(K, { floor: "oak", floorTint: "#a88060", wain: "bead", wainTint: "#5a2a24", upper: "damask", upperTint: "#e8d0b8", ceil: "tin", ceilTint: "#e8dcc8", lamp: [0xffe0c0, 1.15], fill: 0.5 });
    K.counter(X(2.4), -2.55, 2.4, 0, { body: "#6a4428", top: "#2a1a10" }); K.register(X(3.1), 1.02, -2.65, 0); K.backRun(-4.4, 1.0, 2.4, "apparel", [2, 2, 2], { body: "#6a4428", unit: 1.8, sub: [0, 0, 1, 1] });
    K.board(X(-1.7), 3.6, K.zb + 0.02, 3.0, 0.6, 0, "gold", K.sign1.title, K.sign1.sub || "Felt · Straw · Caps");
    // a wall of hats on pegs on the far wall, hat stands, hat boxes
    for (var r = 0; r < 3; r++) for (var c = 0; c < 7; c++) { var z = -2.4 + c * 0.75, y = 1.4 + r * 0.6; b.beam(tex("grain"), col("#3a2416"), [X(4.6), y, z], [X(4.42), y + 0.04, z], 0.03); K.hat(X(4.38), y + 0.02, z, pick(R, ["#5a3a24", "#2a2a2a", "#8a6a4a", "#c8b090", "#6e1f24", "#3a4a5a"]), r === 0 && c % 2 ? "fedora" : "cowboy"); }
    var tx = X(-0.3), tz = 0.6; K.table(tx, tz, 1.3, 1.3, 0, { round: true, top: "#6a4428", leg: "#2a1a10" }); for (var s = 0; s < 5; s++) { var a = s / 5 * TAU, sx = tx + Math.sin(a) * 0.42, sz = tz + Math.cos(a) * 0.42, hh = 0.25 + (s % 2) * 0.15; b.cyl("p_brass", col("#c9a24a"), sx, 0.76, sz, 0.012, 0.012, hh, 6, { open: true }); b.sph("p_satin", col("#e8dcc8"), sx, 0.76 + hh + 0.04, sz, 0.08, 10, 0.7); K.hat(sx, 0.76 + hh + 0.06, sz, pick(R, ["#5a3a24", "#2a2a2a", "#c8b090", "#6e1f24"]), s % 2 ? "fedora" : "cowboy"); }
    for (var k = 0; k < 4; k++) { var bx = X(-3.8 + (k % 2) * 0.6), bz = 1.8 + Math.floor(k / 2) * 0.55; for (var j = 0; j < 3 - (k % 2); j++) { var rr = 0.26 - j * 0.03; b.cyl("p_cloth", col(pick(R, ["#e8c8b8", "#c8d8e8", "#f2e6c8", "#d8c0e0"])), bx, j * 0.3, bz, rr, rr, 0.28, 16, { top: col("#f4ecd6") }); b.cyl("p_cloth", col("#6e1f24"), bx, j * 0.3 + 0.25, bz, rr + 0.005, rr + 0.005, 0.03, 16, { open: true }); } } K.solid(X(-3.5), 2.08, 1.3, 1.2, 0, 0, 0.9);
    // the blocking bench: wooden hat blocks, a steamer, a brim iron
    var wx = X(-4.25), wz = -1.4; b.box(tex("grain"), col("#7a5232"), wx, 0, wz, 0.7, 0.9, 2.0, 0, 0.6, { ao: 0.3 }); K.solid(wx, wz, 0.7, 2.0, 0, 0, 0.95); for (var q = 0; q < 3; q++) b.lathe(tex("grain"), col("#c8a070"), wx, 0.9, wz - 0.6 + q * 0.6, [[0.1, 0], [0.11, 0.08], [0.1, 0.16], [0.06, 0.2], [0.001, 0.21]], 12);
    b.cyl("p_metal", col("#8a8a8a"), wx, 0.9, wz + 0.9, 0.12, 0.12, 0.3, 12); b.beam("p_metal", col("#3a3a3a"), [wx, 1.2, wz + 0.9], [wx + X(0.2), 1.5, wz + 0.9], 0.02);
    var my = 1.6; b.cyl("p_brass", col("#c9a24a"), X(1.6), 0, 2.4, 0.2, 0.22, 0.04, 14); b.beam("p_brass", col("#c9a24a"), [X(1.6), 0.04, 2.4], [X(1.6), 1.3, 2.4], 0.025); b.disc("p_brass", col("#c9a24a"), X(1.6), my, 2.4, 0.3, Y(0.6), 20); b.disc("p_chrome", col("#f4f8fc"), X(1.6) + Math.sin(Y(0.6)) * 0.01, my, 2.4 + Math.cos(Y(0.6)) * 0.01, 0.27, Y(0.6), 20); K.solid(X(1.6), 2.4, 0.5, 0.5, 0, 0, 1.9);
    [-1.6, 0.8].forEach(function (x) { K.pendant(X(x), 0.2, 2.9, { style: "globe" }); }); K.pendant(X(2.4), -2.3, 2.8, { style: "dome", c: "#6e1f24" }); K.door(X(-3.8), K.zb, 0, "WORKROOM");
    K.disp.forEach(function (d) { for (var j = 0; j < 3; j++) { var x = d.x - d.w / 2 + 0.3 + j * (d.w - 0.6) / 2; b.cyl("p_brass", col("#c9a24a"), x, d.y, d.z, 0.012, 0.012, 0.35 + j * 0.1, 6, { open: true }); K.hat(x, d.y + 0.38 + j * 0.1, d.z, pick(R, ["#5a3a24", "#c8b090", "#2a2a2a"]), j % 2 ? "fedora" : "cowboy"); } });
    castFor(K, [X(2.4), -3.35, 0], [{ walk: [[X(1.2), 0.9, 4, Y(HP)], [X(3.6), 0.2, 4, Y(HP)], [X(-1.6), 2.0, 3, PI]], x: X(1.2), z: 0.9 }]); K.till = [X(2.4), -3.35];
    K.shop = { x: X(3.1), z: -2.65, r: 1.6, venue: K.venueId, face: true, prompt: "try on a hat" };
    K.infos = [{ x: wx + X(0.6), z: wz, t: "The blocking bench", k: K.shopName, p: "Felt goes over a wooden block with steam, dries overnight, then the brim is set and the crease pinched by hand. A hat made here takes three days and lasts thirty years.", r: 1.5 }];
  } };

  // a western saddle on a sawhorse stand (the seat, the horn, the cantle, fenders and stirrups)
  function saddle(K, x, z, ry, c) { var b = K.b, lc = col(c || "#7a4a2a"), dk = mulc(lc, 0.7), wd = col("#5a3a22");
    [[-0.35, -0.25], [0.35, -0.25], [-0.35, 0.25], [0.35, 0.25]].forEach(function (p) { var q = off(x, z, ry, p[0], p[1]); b.beam(tex("grain"), wd, [q[0], 0, q[1]], [off(x, z, ry, p[0] * 0.6, 0)[0], 0.82, off(x, z, ry, p[0] * 0.6, 0)[1]], 0.06, 0.06); });
    var t = off(x, z, ry, 0, 0); b.beam(tex("grain"), wd, [off(x, z, ry, -0.5, 0)[0], 0.84, off(x, z, ry, -0.5, 0)[1]], [off(x, z, ry, 0.5, 0)[0], 0.84, off(x, z, ry, 0.5, 0)[1]], 0.12, 0.1);
    b.box("p_satin", lc, t[0], 0.9, t[1], 0.75, 0.1, 0.5, ry, 1, { ao: 0.15 }); var hn = off(x, z, ry, 0.32, 0); b.cyl("p_satin", dk, hn[0], 0.98, hn[1], 0.05, 0.035, 0.18, 8); b.cyl("p_satin", dk, hn[0], 1.16, hn[1], 0.07, 0.07, 0.03, 10); var ct = off(x, z, ry, -0.3, 0); b.box("p_satin", lc, ct[0], 0.98, ct[1], 0.08, 0.16, 0.42, ry, 1, { ao: 0 });
    [-1, 1].forEach(function (s) { var f = off(x, z, ry, 0, s * 0.28); b.box("p_satin", dk, f[0], 0.42, f[1], 0.32, 0.5, 0.025, ry, 1, { ao: 0.1 }); b.ring("p_brass", col("#b89040"), f[0], 0.32, f[1], 0.07, 0.02, 8, ry, true); });
    K.solid(x, z, 1.1, 0.75, ry, 0, 1.15); K.shadow(x, z, 1.1, 0.7, ry); }
  // LEATHER (the boot maker, leather goods, the saddlery, the harness maker): saddles on stands, the harness wall, boots, the cutting bench, hides
  TR.leather = { sheets: ["leather", "apparel"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, nm = K.ctx.name || "", boots = /boot/i.test(nm), ls = smat("leather");
    K.pal = Object.assign(K.pal, { accent: "#7a4a2a", neon: "#ffcf6a", wood: "#5a3a22", wood2: "#2a1a10", trim: "#2a1a10", signBg: "#3a2414", signFg: "#f2d8a0" });
    shell(K, { floor: "barn", floorTint: "#a08068", wain: "bead", wainTint: "#5a3a24", upper: R() < 0.5 ? "brick" : "shiplap", upperTint: "#c8a890", ceil: "beams", ceilTint: "#b89a78", beam: "#3a2416", lamp: [0xffc890, 1.1], fill: 0.42, sky: 0.28 });
    K.counter(X(2.2), -2.55, 2.4, 0, { body: "#5a3a22", top: "#2a1a10" }); K.register(X(2.9), 1.02, -2.65, 0); K.backRun(-4.4, 1.0, 2.5, "leather", boots ? [3, 1] : [1, 3], { body: "#4a2e1a", unit: 2.7 }); K.backRun(1.2, 4.4, 2.5, boots ? "apparel" : "leather", boots ? [3, 3] : [3, 0], { body: "#4a2e1a", unit: 1.6 });
    K.board(X(-1.7), 3.65, K.zb + 0.02, 3.2, 0.62, 0, "wood", K.sign1.title, K.sign1.sub);
    K.sideRun(mx, -1.0, 2.9, 2.4, boots ? "apparel" : "leather", boots ? [3, 3] : [0, 1], { body: "#4a2e1a", unit: 1.95 });
    if (!boots) { saddle(K, X(-0.6), 0.5, Y(0.3), "#7a4a2a"); saddle(K, X(1.4), 1.3, Y(-0.2), "#5a3018"); } else { K.table(X(0.2), 0.7, 1.8, 0.9, 0, { top: "#5a3a22", leg: "#2a1a10" }); for (var bt = 0; bt < 6; bt++) { var bx = X(-0.5) + bt * 0.28 * mx; b.box("p_satin", col(pick(R, ["#5a3018", "#7a4a2a", "#2a1a10", "#8a6040"])), bx, 0.76, 0.6, 0.11, 0.42, 0.14, 0, 1, { ao: 0.1 }); b.box("p_satin", col("#2a1a10"), bx, 0.76, 0.72, 0.11, 0.1, 0.26, 0, 1, { ao: 0 }); } }
    // the cutting bench along the near wall: hides, tools, a stitching horse and boot lasts; hides hanging from a beam
    var wx = X(-4.2), wz = -0.2; b.box(tex("grain"), col("#6a4428"), wx, 0, wz, 0.8, 0.92, 2.6, 0, 0.6, { ao: 0.3 }); K.solid(wx, wz, 0.8, 2.6, 0, 0, 0.95); K.frame(X(-4.6), 1.9, wz, 1.4, 1.0, Y(HP), ls, panel(2));
    b.flat("p_satin", col("#a0703a"), wx, 0.925, wz - 0.4, 0.7, 1.1, 0.1, [0, 0, 1, 1]); for (var q = 0; q < 3; q++) b.lathe(tex("grain"), col("#c8a070"), wx, 0.92, wz + 0.5 + q * 0.25, [[0.05, 0], [0.06, 0.12], [0.045, 0.2], [0.001, 0.22]], 8, null, 1);
    var hz = 2.2; b.beam(tex("grain"), col("#3a2416"), [X(-4.4), 2.5, hz - 0.8], [X(-4.4), 2.5, hz + 0.8], 0.06); for (var h = 0; h < 3; h++) b.quad("p_satin", col(pick(R, ["#8a5a32", "#a0703a", "#6a4428"])), X(-4.36), 1.8, hz - 0.5 + h * 0.5, 0.6, 1.3, Y(HP), [0, 0, 1, 1]);
    [-1.6, 0.6].forEach(function (x) { K.pendant(X(x), 0.6, 2.8, { style: "lantern" }); }); K.pendant(X(2.2), -2.3, 2.8, { style: "bulb" }); K.door(X(-3.7), K.zb, 0, "SHOP");
    K.disp.forEach(function (d) { if (!boots) saddle(K, d.x, d.z + 0.02, PI / 2, "#7a4a2a"); else for (var j = 0; j < 4; j++) b.box("p_satin", col("#5a3018"), d.x - 0.5 + j * 0.33, d.y, d.z, 0.11, 0.42, 0.14, 0, 1, { ao: 0.1 }); });
    castFor(K, [X(-3.5), -0.2, Y(HP)], [{ walk: [[X(0.4), 2.0, 4, PI], [X(2.6), -0.2, 3, Y(HP)], [X(-1.6), -1.4, 4, PI]], x: X(0.4), z: 2.0 }]); K.till = [X(-3.5), -0.2];
    K.shop = { x: X(2.9), z: -2.65, r: 1.6, venue: K.venueId, face: true, prompt: "browse the leather goods" };
    K.infos = [{ x: X(-0.6), z: 0.5, t: boots ? "Made to measure" : "The saddle", k: K.shopName, p: boots ? "Each pair starts on a wooden last cut to the customer's foot. The uppers are stitched by hand on the bench, then pegged and welted to a leather sole. Six weeks, and they will outlast you." : "A working ranch saddle on a sawhorse stand: a tree of wood and rawhide, wet-formed leather over it, a tooled seat and fenders. About six weeks of work from first cut to last stitch.", r: 1.6 }];
  } };

  // FARRIER (Corral Row): the forge with live coals and a hood, the anvil on its stump, a quench barrel, horseshoes and tongs on the wall
  TR.smithy = { sheets: ["hardware", "leather"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, hs = smat("hardware");
    K.pal = Object.assign(K.pal, { accent: "#c25a1a", neon: "#ff8a3a", wood: "#4a2e1a", wood2: "#1c1410", trim: "#1c1410", signBg: "#1c1410", signFg: "#e8c890" });
    shell(K, { floor: "barn", floorTint: "#5a4a3c", wain: null, upper: "brick", upperTint: "#8a7068", ceil: "beams", ceilTint: "#7a6a58", beam: "#2a1c12", lamp: [0xff9a50, 1.0], fill: 0.32, sky: 0.22, lampDist: 11, lampX: -1.5 * K.mx, lampZ: -2.0 });
    var fx = X(-2.6), fz = -3.6; b.box(tex("brick"), col("#9a7a6a"), fx, 0, fz, 1.8, 0.85, 1.2, 0, 1.2, { ao: 0.3 }); b.box("p_satin", col("#1c1410"), fx, 0.85, fz, 1.2, 0.08, 0.8, 0, 1, { ao: 0, no: "b" }); for (var c = 0; c < 26; c++) b.sph("g", col(R() < 0.6 ? "#ff6a1a" : "#ffb03a"), fx + (R() - 0.5) * 0.9, 0.92, fz + (R() - 0.5) * 0.6, 0.05 + R() * 0.05, 5, 0.6);
    b.lathe("p_metal", col("#2a2622"), fx, 1.9, fz, [[0.75, 0], [0.55, 0.4], [0.18, 0.9], [0.16, 1.0]], 4); b.cyl("p_metal", col("#2a2622"), fx, 2.9, fz, 0.16, 0.16, K.hgt - 2.9, 10, { open: true }); [-0.75, 0.75].forEach(function (s) { b.beam("p_metal", col("#2a2622"), [fx + s, 0.95, fz - 0.4], [fx + s * 0.7, 1.95, fz - 0.3], 0.04); });
    var bw = off(fx, fz, 0, 1.25, 0.1); b.box(tex("grain"), col("#5a3a22"), bw[0], 0.6, bw[1], 0.5, 0.12, 0.9, 0.2, 0.6, { ao: 0 }); b.box("p_satin", col("#3a2414"), bw[0], 0.72, bw[1], 0.45, 0.18, 0.8, 0.2, 1, { ao: 0 }); K.solid(fx, fz, 2.4, 1.3, 0, 0, 0.95);
    var ax = X(-1.0), az = -1.4; b.cyl(tex("grain"), col("#6a4428"), ax, 0, az, 0.32, 0.34, 0.55, 12, { top: col("#8a6a48") }); b.box("p_metal", col("#3a3a3a"), ax, 0.55, az, 0.3, 0.2, 0.18, 0.4, 1, { ao: 0.2 }); b.box("p_metal", col("#4a4a4a"), ax, 0.75, az, 0.55, 0.12, 0.16, 0.4, 1, { ao: 0, no: "" }); var hp = off(ax, az, 0.4, 0.35, 0); b.beam("p_metal", col("#4a4a4a"), [hp[0], 0.81, hp[1]], [off(ax, az, 0.4, 0.55, 0)[0], 0.83, off(ax, az, 0.4, 0.55, 0)[1]], 0.05); K.solid(ax, az, 0.7, 0.7, 0, 0, 0.9);
    K.barrel(X(0.2), -2.4, 0.3, 0.75, "#5a3a22"); K.solid(X(0.2), -2.4, 0.62, 0.62, 0, 0, 0.8);
    for (var r = 0; r < 3; r++) for (var k = 0; k < 6; k++) b.ring("p_metal", col("#4a4642"), X(4.55), 1.5 + r * 0.45, -2.6 + k * 0.4, 0.09, 0.022, 10, Y(-HP), true); K.frame(X(4.6), 1.9, 0.6, 1.2, 1.2, Y(-HP), hs, panel(0)); K.frame(X(4.6), 1.9, 2.0, 1.0, 1.0, Y(-HP), smat("leather"), panel(1));
    K.counter(X(2.6), 0.6, 2.4, Y(-HP), { body: "#4a2e1a", top: "#2a1a10", h: 0.95 }); K.register(X(2.6), 0.95, 1.2, Y(-HP)); K.board(X(-1.0), 3.8, K.zb + 0.02, 3.0, 0.55, 0, "wood", K.sign1.title, K.sign1.sub);
    [[-3.6, 1.0], [-3.2, 1.6]].forEach(function (p) { K.crate(X(p[0]), 0, p[1], 0.6, 0.42, 0.5, 0.3, "#8a6a48"); }); K.pendant(X(0.4), 0.4, 2.8, { style: "lantern" }); K.pendant(X(-1.0), -1.4, 2.6, { style: "bulb" }); K.door(X(3.6), K.zb, 0, "STABLE");
    K.disp.forEach(function (d) { for (var j = 0; j < 5; j++) b.ring("p_metal", col("#4a4642"), d.x - 0.6 + j * 0.3, d.y + 0.12, d.z, 0.09, 0.022, 10, PI, true); K.crate(d.x + 0.2, d.y, d.z - 0.05, 0.4, 0.3, 0.3, 0, "#8a6a48"); });
    castFor(K, [X(-1.6), -1.0, Y(0.8)], [{ walk: [[X(1.4), 1.8, 4, Y(HP)], [X(0.4), -0.4, 3, PI]], x: X(1.4), z: 1.8 }]); K.till = [X(-1.6), -1.0];
    K.infos = [{ x: fx + X(1.2), z: fz + 0.8, t: "The forge", k: K.shopName, p: "A coal forge with a brick hearth and a sheet iron hood. The bellows feed the fire until the iron glows orange; then it goes to the anvil, the hammer and the quench barrel. Horseshoes for the corral are made here every week.", r: 1.8, face: false }];
  } };

  // a seven cylinder radial engine on a stand (the parts store's hero)
  function radial(K, x, y, z, ry, s) { var b = K.b; s = s || 1; var dk = col("#2a2a2a"), al = col("#a8aeb4"), c = Math.cos(ry), sn = Math.sin(ry), ax = [sn, 0, c];   // the crank axis points along the piece's front
    var P = function (k) { return [x + ax[0] * k * s, y, z + ax[2] * k * s]; }; b.tube("p_metal", al, P(-0.22), P(0.12), 0.24 * s, 0.24 * s, 18); b.tube("p_metal", dk, P(0.12), P(0.3), 0.16 * s, 0.1 * s, 16); b.tube("p_metal", al, P(0.3), P(0.4), 0.06 * s, 0.06 * s, 10); b.tube("p_metal", dk, P(-0.4), P(-0.22), 0.2 * s, 0.22 * s, 16);
    for (var i = 0; i < 7; i++) { var a = i / 7 * TAU, dx = Math.cos(a), dy = Math.sin(a), ox = c * dx, oz = -sn * dx; var A = [x + ox * 0.22 * s, y + dy * 0.22 * s, z + oz * 0.22 * s], B = [x + ox * 0.5 * s, y + dy * 0.5 * s, z + oz * 0.5 * s];
      b.tube("p_metal", dk, A, B, 0.07 * s, 0.065 * s, 10); for (var f = 0; f < 5; f++) { var t0 = 0.27 + f * 0.045, F0 = [x + ox * t0 * s, y + dy * t0 * s, z + oz * t0 * s], F1 = [x + ox * (t0 + 0.012) * s, y + dy * (t0 + 0.012) * s, z + oz * (t0 + 0.012) * s]; b.tube("p_metal", dk, F0, F1, 0.1 * s, 0.1 * s, 10); }
      b.tube("p_metal", al, B, [x + ox * 0.56 * s, y + dy * 0.56 * s, z + oz * 0.56 * s], 0.075 * s, 0.05 * s, 10); b.beam("p_brass", col("#b88a3a"), [B[0] + ax[0] * 0.08 * s, B[1], B[2] + ax[2] * 0.08 * s], P(0.15), 0.015 * s); }
    var hub = P(0.4); [0, PI].forEach(function (a2) { var up = [Math.cos(a2 + 0.3) * c, Math.sin(a2 + 0.3), -Math.cos(a2 + 0.3) * sn]; b.beam(tex("grain"), col("#6a3a1a"), hub, [hub[0] + up[0] * 0.9 * s, hub[1] + up[1] * 0.9 * s, hub[2] + up[2] * 0.9 * s], 0.05 * s, 0.13 * s); }); }
  // PARTS AND HARDWARE (Parts and Props, pilot supply, avionics, mining supply): the parts counter, drawer walls, pegboard, the radial engine
  TR.hardware = { sheets: ["hardware"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, nm = K.ctx.name || "", av = /avionics/i.test(nm), mine = /mining/i.test(nm), hs = smat("hardware");
    var C = cw(K, [{ up: "shiplap", ut: "#c8ccc8", wain: "bead", wt: "#3a4a5a", fl: "strip", ft: "#a89880", sign: "enamel", sbg: "#a3262a" }, { up: "brick", ut: "#c8b0a0", wain: null, fl: "concrete", ft: "#b8b4ac", sign: "enamel", sbg: "#1f3b5a" }]);
    K.pal = Object.assign(K.pal, { accent: "#a3262a", neon: "#ffcf6a", wood: mine ? "#5a3a22" : "#4a5058", wood2: "#1c1c1c", trim: "#2a2a2a", signBg: C.sbg });
    shell(K, { floor: mine ? "barn" : C.fl, floorTint: C.ft, wain: C.wain, wainTint: C.wt, upper: C.up, upperTint: C.ut, ceil: mine ? "beams" : "tin", ceilTint: "#d8d8d0", beam: "#3a2a1a", lamp: [0xfff0e0, 1.2], fill: 0.5 });
    K.counter(X(-0.4), -2.3, 5.2, 0, { body: mine ? "#5a3a22" : "#4a5058", top: "#2a2622", topKey: "p_metal", front: mine ? "panel" : "bead" }); K.register(X(1.6), 1.02, -2.4, 0); b.box("p_metal", col("#8a8f94"), X(-1.6), 1.02, -2.4, 0.5, 0.06, 0.35, 0.1, 1, { ao: 0 });
    K.backRun(-4.4, 4.4, 2.6, "hardware", mine ? [3, 1, 3] : av ? [2, 1, 2] : [1, 2, 1], { body: mine ? "#4a2e1a" : "#5a6068", unit: 2.9, paint: !mine });
    K.sideRun(-mx, -1.4, 2.9, 2.5, "hardware", mine ? [3, 0] : [0, 0], { body: mine ? "#4a2e1a" : "#5a6068", unit: 2.15, paint: !mine }); K.sideRun(mx, -1.4, 1.4, 2.5, "hardware", mine ? [0] : [2], { body: mine ? "#4a2e1a" : "#5a6068", unit: 2.8, paint: !mine });
    K.board(0, 3.8, K.zb + 0.02, 3.8, 0.6, 0, mine ? "wood" : C.sign, K.sign1.title, K.sign1.sub);
    // the hero: the radial on a stand, or the avionics panel wall with lit gauges, or an ore cart with picks
    if (av) { var px = X(4.56); var guv = K.sign(512, 256, function (X2, w, h) { X2.fillStyle = "#141414"; X2.fillRect(0, 0, w, h); for (var i = 0; i < 6; i++) { var cx = 50 + (i % 3) * 205, cy = 64 + Math.floor(i / 3) * 128, r = 48; X2.fillStyle = "#050505"; X2.beginPath(); X2.arc(cx, cy, r + 6, 0, TAU); X2.fill(); X2.strokeStyle = "#e8e8e8"; X2.lineWidth = 2; X2.beginPath(); X2.arc(cx, cy, r, 0, TAU); X2.stroke(); for (var t = 0; t < 12; t++) { var a = t / 12 * TAU; X2.beginPath(); X2.moveTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8); X2.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); X2.stroke(); } X2.strokeStyle = "#7dff9a"; X2.lineWidth = 4; var na = -1 + i * 0.7; X2.beginPath(); X2.moveTo(cx, cy); X2.lineTo(cx + Math.cos(na) * r * 0.8, cy + Math.sin(na) * r * 0.8); X2.stroke(); } });
      b.box("p_satin", col("#1c1c1c"), px, 1.2, 1.9, 0.08, 1.2, 2.2, 0, 1, { ao: 0 }); b.quad("s", [1, 1, 1], px - X(0.05), 1.8, 1.9, 2.0, 1.0, Y(-HP), guv); K.table(X(3.4), 1.9, 0.8, 1.8, 0, { top: "#3a3a3a", leg: "#1c1c1c", h: 0.86 }); for (var r = 0; r < 3; r++) { b.box("p_satin", col("#2a2a2a"), X(3.4), 0.86, 1.3 + r * 0.6, 0.4, 0.18, 0.35, 0, 1, { ao: 0.2 }); b.box("g", col(["#7dff9a", "#ffb03a", "#8fd8ff"][r]), X(3.4) - X(0.21), 0.95, 1.3 + r * 0.6, 0.005, 0.03, 0.12, 0, 1, { ao: 0 }); } }
    else if (mine) { var cx = X(1.8), cz = 1.0; b.box("p_metal", col("#5a4a3a"), cx, 0.25, cz, 0.9, 0.55, 0.6, 0.2, 1, { ao: 0.2 }); [-0.3, 0.3].forEach(function (s) { [-0.2, 0.2].forEach(function (t) { var p = off(cx, cz, 0.2, s, t * 1.6); b.ring("p_metal", col("#2a2a2a"), p[0], 0.15, p[1], 0.14, 0.04, 10, 0.2 + HP, true); }); }); for (var k = 0; k < 10; k++) b.sph("p_satin", col(pick(R, ["#8a6a4a", "#6a5a4a", "#b08a5a"])), cx + (R() - 0.5) * 0.6, 0.82, cz + (R() - 0.5) * 0.4, 0.09, 6); b.beam("p_metal", col("#4a4a4a"), [cx - 1.6, 0.06, cz + 0.4], [cx + 1.2, 0.06, cz - 0.3], 0.05, 0.03); K.solid(cx, cz, 1.0, 0.8, 0.2, 0, 0.9);
      for (var l = 0; l < 4; l++) K.pendant(X(-2.4 + l * 1.4), 0.4, 2.7, { style: "lantern" }); [[-0.8, 1.6], [-0.4, 1.9]].forEach(function (p) { K.crate(X(p[0]), 0, p[1], 0.6, 0.45, 0.45, 0.3, "#8a6a48"); }); for (var pk = 0; pk < 3; pk++) b.beam(tex("grain"), col("#8a6a48"), [X(-0.8) + pk * 0.1, 0.45, 1.5], [X(-0.6) + pk * 0.12, 1.2, 1.7], 0.035); }
    else { var ex = X(1.4), ez = 0.8; b.box("p_metal", col("#a3262a"), ex, 0, ez, 0.8, 0.08, 0.8, 0, 1, { ao: 0.2 }); [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]].forEach(function (p) { b.beam("p_metal", col("#a3262a"), [ex + p[0], 0.08, ez + p[1]], [ex + p[0] * 0.25, 0.85, ez + p[1] * 0.25], 0.05); }); b.box("p_metal", col("#a3262a"), ex, 0.8, ez, 0.3, 0.12, 0.3, 0, 1, { ao: 0 }); radial(K, ex, 1.3, ez, Y(0.6), 1.1); K.solid(ex, ez, 1.0, 1.0, 0, 0, 1.8); }
    var pr = [X(-1.5), 3.25, K.zb + 0.06]; [0, PI].forEach(function (a) { b.beam(tex("grain"), col("#8a5a32"), [pr[0], pr[1], pr[2] + 0.02], [pr[0] + Math.cos(a) * 1.4, pr[1] + Math.sin(a) * 0.18, pr[2] + 0.02], 0.16, 0.05); }); b.cyl("p_metal", col("#3a3a3a"), pr[0], pr[1] - 0.08, pr[2] + 0.06, 0.1, 0.1, 0.16, 12);
    K.table(X(-1.4), 0.9, 1.6, 0.8, 0, { top: "#4a5058", topKey: "p_metal", leg: "#1c1c1c" }); for (var bx = 0; bx < 6; bx++) b.box("p_gloss", col(pick(R, ["#a3262a", "#1f3b5a", "#e8a020", "#2f4a3a"])), X(-1.9) + (bx % 3) * 0.5 * mx, 0.76, 0.75 + Math.floor(bx / 3) * 0.3, 0.3, 0.18, 0.22, 0, 1, { ao: 0.15 });
    [-2.2, 0.4, 2.6].forEach(function (x) { K.pendant(X(x), -1.6, 2.9, { style: mine ? "lantern" : "dome", c: "#2a2a2a" }); }); K.door(X(-3.8), K.zb, 0, null); K.poster(X(4.6), 2.7, -0.8, 0.8, 1.1, Y(-HP), mine ? "rodeo" : "flyin");
    K.disp.forEach(function (d, j) { if (!mine && j === 0) radial(K, d.x, d.y + 0.45, d.z, 0, 0.7); else { K.crate(d.x - 0.4, d.y, d.z, 0.5, 0.35, 0.4, 0, "#8a6a48"); b.cyl("p_metal", col("#8a8f94"), d.x + 0.4, d.y, d.z, 0.16, 0.16, 0.3, 12); } });
    castFor(K, [X(-0.4), -3.15, 0], [{ walk: [[X(-3.2), 0.4, 4, Y(-HP)], [X(-1.4), 1.8, 3, PI], [X(2.9), 0.0, 4, Y(HP)]], x: X(-3.2), z: 0.4 }]); K.till = [X(-0.4), -3.15];
    if (C && K.T.venue) K.shop = { x: X(1.6), z: -2.4, r: 1.6, venue: K.venueId, face: true, prompt: "buy flight gear" };
    K.infos = [{ x: av ? X(3.6) : mine ? X(1.8) : X(1.4), z: av ? 1.9 : mine ? 1.0 : 0.8, t: av ? "The avionics bench" : mine ? "The ore cart" : "The radial engine", k: K.shopName, p: av ? "Radios and instruments come here for a bench check: the panel on the wall runs a set of gauges off a test rig, and the radios are tuned to the tower and the old field frequency." : mine ? "An ore cart from the Copper Queen days, when Bisbee's copper came down to the Douglas smelter by rail. The picks and lamps on the wall are for the hikers and rock hounds now." : "A seven cylinder radial off an old trainer, rebuilt for the fly-in and parked on a stand for the customers to admire. The propeller over the counter came off the same aircraft.", r: 1.6 }];
  } };

  // a pot-bellied stove with its pipe up through the ceiling and a glow in the door
  function stove(K, x, z) { var b = K.b, ir = col("#1c1a18"); b.cyl("p_metal", ir, x, 0, z, 0.26, 0.3, 0.12, 14); b.lathe("p_metal", ir, x, 0.12, z, [[0.3, 0], [0.36, 0.18], [0.38, 0.35], [0.33, 0.55], [0.24, 0.66], [0.12, 0.72], [0.1, 0.76]], 16); b.cyl("p_metal", ir, x, 0.76, z, 0.085, 0.085, K.hgt - 0.76, 10, { open: true }); b.disc("g", col("#ff7a2a"), x, 0.36, z + 0.36, 0.09, 0, 12); b.cyl("p_brass", col("#a8823a"), x, 0.58, z, 0.35, 0.35, 0.03, 16, { open: true }); K.solid(x, z, 0.8, 0.8, 0, 0, 1.2); K.shadow(x, z, 0.8, 0.8, 0); }
  // MERCANTILE (the mercantile, Tomas's general store, the trading post, dry goods): ladder shelving, the stove and the checkers barrel, cracker barrels, sacks
  TR.mercantile = { sheets: ["mercantile"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, nm = K.ctx.name || "", tp = /trading/i.test(nm), dry = /dry goods/i.test(nm), ms = smat("mercantile");
    K.pal = Object.assign(K.pal, { accent: "#8a2a26", neon: "#ffcf6a", wood: "#6a4428", wood2: "#2a1a10", trim: "#2a1a10", signBg: "#3a2414", signFg: "#f2dfae" });
    shell(K, { floor: "oak", floorTint: "#9a7860", wain: "bead", wainTint: "#6a4a32", upper: R() < 0.5 ? "shiplap" : "plaster", upperTint: "#d8c8a8", ceil: "tin", ceilTint: "#d8c8a8", lamp: [0xffd8a8, 1.1], fill: 0.42, sky: 0.28 });
    K.sideRun(-mx, -3.4, 2.9, 3.3, "mercantile", tp ? [2, 0, 2] : dry ? [1, 0, 1] : [0, 3, 0], { body: "#5a3a22", unit: 2.1, ladder: 0.3 }); K.sideRun(mx, -1.0, 2.9, 3.3, "mercantile", dry ? [1, 1] : tp ? [2, 2] : [0, 0], { body: "#5a3a22", unit: 1.95 });
    K.counter(X(1.9), -2.6, 3.0, 0, { body: "#6a4428", top: "#3a2416", front: "panel" }); K.register(X(2.9), 1.02, -2.7, 0); K.backRun(0.3, 4.4, 2.6, "mercantile", [3, 0], { body: "#5a3a22", unit: 2.05 }); K.board(X(2.3), 3.65, K.zb + 0.02, 3.6, 0.62, 0, "wood", K.sign1.title, K.sign1.sub);
    // the counter top: a coffee grinder, candy jars, a brass scale; the stove with chairs and the checkers barrel
    var gx = X(1.0); b.box("p_metal", col("#2a2622"), gx, 1.02, -2.6, 0.24, 0.32, 0.24, 0, 1, { ao: 0 }); b.cyl("p_metal", col("#a3262a"), gx, 1.34, -2.6, 0.12, 0.16, 0.1, 12); [-1, 1].forEach(function (s) { b.disc("p_metal", col("#a3262a"), gx + s * 0.14 * mx, 1.3, -2.6, 0.22, Y(HP), 16); }); K.bottles(X(1.95), 1.02, -2.5, 0.9, 0, 3, "jar", ["#c2181f", "#f2b134", "#8cc63f"]);
    var sx = X(-0.6), sz = -0.2; stove(K, sx, sz); K.chair(sx - X(0.95), sz + 0.2, Y(HP + 0.3), { c: "#5a3a22" }); K.chair(sx + X(0.95), sz + 0.4, Y(-HP - 0.3), { c: "#5a3a22", occupied: true }); var cb = [sx, sz + 1.05]; K.barrel(cb[0], cb[1], 0.3, 0.72, "#7a5232");
    var cuv = K.sign(160, 160, function (X2, w, h) { for (var i = 0; i < 8; i++) for (var j = 0; j < 8; j++) { X2.fillStyle = (i + j) % 2 ? "#1c1c1c" : "#c2181f"; X2.fillRect(i * w / 8, j * h / 8, w / 8, h / 8); } for (var k = 0; k < 7; k++) { X2.fillStyle = k < 4 ? "#f4ecd6" : "#2a1a10"; X2.beginPath(); X2.arc((k * 2 + 1.5) * w / 16 % w, (k < 4 ? 1.5 : 6.5) * h / 8, w / 22, 0, TAU); X2.fill(); } });
    b.flat("s", [1, 1, 1], cb[0], 0.735, cb[1], 0.42, 0.42, 0.3, cuv); K.solid(cb[0], cb[1], 0.62, 0.62, 0, 0, 0.75);
    [[2.6, 1.3], [3.2, 0.7]].forEach(function (p) { K.barrel(X(p[0]), p[1], 0.3, 0.75, "#8a6040"); b.cyl("p_satin", col("#e8d8b0"), X(p[0]), 0.7, p[1], 0.26, 0.26, 0.04, 14); }); K.solid(X(2.9), 1.0, 1.3, 1.3, 0, 0, 0.8);
    [[3.7, 2.5], [3.3, 2.8], [3.9, 2.0]].forEach(function (p) { K.sack(X(p[0]), p[1], 1.0, pick(R, ["#c8b48c", "#b8a07a", "#d8c8a0"])); }); K.solid(X(3.6), 2.45, 1.0, 1.2, 0, 0, 0.6);
    if (dry || tp) { var tx = X(0.6), tz = 2.0; K.table(tx, tz, 1.6, 0.9, 0, { top: "#6a4428", leg: "#2a1a10" }); if (dry) { for (var f = 0; f < 6; f++) { var bc = col(pick(R, ["#c84a3a", "#3a6a9a", "#e8c870", "#5a8a4a", "#e8dcc8", "#7a3a6a"])); b.box(tex("stripes"), bc, tx - 0.6 + f * 0.24, 0.76, tz - 0.05, 0.2, 0.06, 0.62, 0.05 * (f % 2), 0.4, { ao: 0.1 }); b.tube("p_cloth", bc, [tx - 0.6 + f * 0.24 - 0.09, 0.86, tz + 0.32], [tx - 0.6 + f * 0.24 + 0.09, 0.86, tz + 0.32], 0.05, 0.05, 10); } } else { for (var bl = 0; bl < 6; bl++) b.box(tex(bl % 2 ? "navajo" : "stripes"), col(pick(R, ["#ffffff", "#f0e0d0", "#e0d0c0"])), tx + (R() - 0.5) * 0.06, 0.76 + bl * 0.065, tz + (R() - 0.5) * 0.04, 1.3, 0.06, 0.75, (R() - 0.5) * 0.08, 0.9, { ao: 0.1, no: "b" }); K.rug(X(-1.9), 1.8, 1.6, 2.4, 0, "navajo"); } }
    else K.rug(X(-0.6), 0.2, 2.4, 3.0, 0, "stripes", "#c8b8a0");
    [-1.8, 1.0].forEach(function (x) { K.pendant(X(x), 0.0, 2.9, { style: "lantern" }); }); K.pendant(X(1.9), -2.3, 2.9, { style: "dome", c: "#2a2a2a" }); K.door(X(-0.6), K.zb, 0, "STOREROOM"); K.clock(X(-1.9), 3.4, K.zb, 0); K.poster(X(-1.8), 2.3, K.zb + 0.02, 0.0001 + 0.7, 0.95, 0, "rodeo");
    K.disp.forEach(function (d) { K.crate(d.x - 0.45, d.y, d.z, 0.45, 0.3, 0.4, 0, "#8a6a48"); K.sack(d.x + 0.35, d.z, 0.7, "#c8b48c"); b.cyl("p_metal", col("#a3262a"), d.x + 0.05, d.y, d.z, 0.1, 0.1, 0.22, 12); });
    castFor(K, [X(1.9), -3.4, 0], [{ sit: 0.46, x: sx + X(0.95), z: sz + 0.4, face: Y(-HP - 0.3), back: 0.2 }, { walk: [[X(-3.4), 0.4, 5, Y(-HP)], [X(-1.8), 2.6, 3, PI], [X(1.3), 0.6, 3, PI]], x: X(-3.4), z: 0.4 }]); K.till = [X(1.9), -3.4];
    K.shop = { x: X(2.9), z: -2.7, r: 1.6, venue: K.venueId, face: true, prompt: "buy provisions" };
    K.infos = [{ x: sx, z: sz + 0.4, t: "The stove", k: K.shopName, p: "A pot-bellied stove, the checkers barrel and two chairs: the oldest club in town. The regulars settle the weather, the price of feed and the last game here every afternoon.", r: 1.3, face: false }];
  } };

  // GARDEN AND FEED (the nursery, the florist, desert botanicals, the beekeeper, seed and feed, the feed store): tiered plant stands, buckets, seeds, honey, sacks
  TR.garden = { sheets: ["garden", "market"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, nm = K.ctx.name || "", flor = /florist/i.test(nm), bee = /bee/i.test(nm), feed = /feed/i.test(nm), gs = smat("garden");
    K.pal = Object.assign(K.pal, { accent: "#4f7a3a", neon: "#ffcf6a", wood: "#8a6a48", wood2: "#3a2a1a", trim: "#3a2a1a", signBg: "#2f4a2a", signFg: "#f4ecd6" });
    shell(K, { floor: feed ? "barn" : R() < 0.5 ? "terra" : "concrete", floorTint: feed ? "#9a8068" : "#d8ccbc", wain: "shiplap", wainTint: "#a8b898", upper: bee ? "plaster" : "shiplap", upperTint: bee ? "#f2e0b0" : "#e8ece0", ceil: "beams", ceilTint: "#e8e0d0", beam: "#5a4030", lamp: [0xfff0d8, 1.25], fill: 0.55, sky: 0.42 });
    var stand = function (x, z, ry, q) { for (var t = 0; t < 3; t++) { var p = off(x, z, ry, 0, -0.15 + t * 0.3 - 0.3); b.box(tex("grain"), col("#8a6a48"), p[0], 0, p[1], 1.6, 0.9 - t * 0.28, 0.32, ry, 0.6, { ao: 0.2 }); } var bk = off(x, z, ry, 0, -0.6); b.quad(gs, [1, 1, 1], bk[0], 1.4, bk[1], 1.5, 1.0, ry, panel(q)); b.box(tex("grain"), col("#6a4a32"), bk[0], 0, bk[1], 1.6, 1.95, 0.04, ry, 0.6, { ao: 0.1, no: "f" });
      for (var t2 = 0; t2 < 3; t2++) for (var k = 0; k < 4; k++) { var pp = off(x, z, ry, -0.6 + k * 0.4, -0.15 + t2 * 0.3 - 0.3); K.plant(pp[0], pp[1], 0.45 + R() * 0.15, R() < 0.5 ? "cactus" : flor ? "flower" : "grass", 0.9 - t2 * 0.28); }
      K.solid(x, z - 0.2, 1.65, 1.0, ry, 0, 1.0); };
    if (!feed && !bee) { stand(X(-3.9), -0.4, Y(HP), 0); stand(X(-3.9), 1.8, Y(HP), flor ? 1 : 0); } else K.sideRun(-mx, -1.4, 2.9, 2.4, "garden", bee ? [3, 3] : [2, 2], { body: "#6a4a32", unit: 2.15 });
    K.counter(X(2.2), -2.55, 2.6, 0, { body: "#6a4a32", top: "#3a2a1a", front: "bead" }); K.register(X(3.0), 1.02, -2.65, 0); K.backRun(-4.4, 0.9, 2.4, "garden", bee ? [3, 0] : flor ? [1, 2] : feed ? [2, 0] : [0, 2], { body: "#6a4a32", unit: 2.65 }); K.board(X(-1.8), 3.7, K.zb + 0.02, 3.2, 0.62, 0, "wood", K.sign1.title, K.sign1.sub);
    K.sideRun(mx, -1.0, 2.9, 2.4, flor ? "garden" : "market", flor ? [1, 1] : [3, 1], { body: "#6a4a32", unit: 1.95 });
    if (flor) { [[0.2, 0.3], [0.9, 0.6], [-0.5, 0.8], [0.3, 1.3]].forEach(function (p) { var x = X(p[0]), z = p[1]; b.cyl("p_metal", col("#a8acb0"), x, 0, z, 0.2, 0.16, 0.45, 14, { top: col("#3a5a3a") }); for (var i = 0; i < 3; i++) b.quad("l", col("#ffffff"), x, 0.75, z, 0.5, 0.6, i * PI / 3, [0.5, 0.18, 1.0, 0.44]); }); K.solid(X(0.25), 0.75, 1.9, 1.4, 0, 0, 0.6); }
    else if (bee) { [[0.0, 0.5], [0.9, 0.5]].forEach(function (p) { for (var s = 0; s < 3; s++) b.box(tex("grain"), col(s % 2 ? "#e8d8a8" : "#f2e6c0"), X(p[0]), s * 0.26, p[1], 0.5, 0.25, 0.42, 0, 0.6, { ao: 0.15 }); b.box(tex("grain"), col("#c8b888"), X(p[0]), 0.78, p[1], 0.56, 0.05, 0.48, 0, 0.6, { ao: 0, no: "" }); }); K.solid(X(0.45), 0.5, 1.5, 0.5, 0, 0, 0.85); K.bottles(X(2.2), 1.02, -2.5, 1.6, 0, 6, "jar", ["#e8a020", "#c87a10", "#f2c040"]); }
    else if (feed) { for (var k = 0; k < 9; k++) b.lathe("p_cloth", col(pick(R, ["#e2d6bc", "#c8b48c", "#d8c8a0"])), X(-0.4 + (k % 3) * 0.55), Math.floor(k / 3) * 0.24, 0.6 + ((k % 2) * 0.06), [[0.001, 0], [0.24, 0.01], [0.26, 0.1], [0.22, 0.22], [0.001, 0.24]], 6, null, 1); b.box(tex("grain"), col("#7a5a3a"), X(0.15), 0, 0.6, 1.8, 0.1, 1.0, 0, 0.6, { ao: 0.2 }); K.solid(X(0.15), 0.6, 1.8, 1.0, 0, 0, 0.8); }
    else { spinner(K, X(0.4), 0.8, "garden", 2, 0.2); }
    // a potting bench by the window, hanging baskets, watering cans
    var px = X(2.4), pz = 1.6; b.box(tex("grain"), col("#7a5a3a"), px, 0, pz, 1.6, 0.86, 0.6, 0, 0.6, { ao: 0.3 }); b.box("p_cloth", col("#4a3424"), px - 0.3, 0.86, pz, 0.6, 0.1, 0.45, 0, 1, { ao: 0 }); K.plant(px + 0.4, pz, 0.6, "grass", 0.86); b.cyl("p_metal", col("#9aa0a6"), px + 0.1, 0.86, pz + 0.1, 0.1, 0.1, 0.2, 12); b.beam("p_metal", col("#9aa0a6"), [px + 0.2, 0.95, pz + 0.1], [px + 0.4, 1.1, pz + 0.12], 0.02); K.solid(px, pz, 1.6, 0.6, 0, 0, 0.9);
    [[-1.4, -1.2], [0.8, -1.0], [-0.4, 2.2], [1.6, 0.0]].forEach(function (p) { var x = X(p[0]), z = p[1]; [0, 2.1, 4.2].forEach(function (a) { b.beam("p_metal", col("#3a3a3a"), [x + Math.sin(a) * 0.18, 2.6, z + Math.cos(a) * 0.18], [x, 3.2, z], 0.006); }); b.beam("p_metal", col("#3a3a3a"), [x, 3.2, z], [x, K.hgt, z], 0.006); b.lathe("p_cloth", col("#8a6a48"), x, 2.42, z, [[0.06, 0], [0.18, 0.08], [0.2, 0.18]], 10); for (var i = 0; i < 3; i++) b.quad("l", col("#ffffff"), x, 2.15, z, 0.45, 0.7, i * PI / 3, [0.02, 0.32, 0.47, 0.99]); });
    [-1.0, 1.4].forEach(function (x) { K.pendant(X(x), 0.6, 3.0, { style: "dome", c: "#4f7a3a" }); }); K.door(X(3.7), K.zb, 0, "GREENHOUSE");
    K.disp.forEach(function (d) { for (var j = 0; j < 4; j++) K.plant(d.x - d.w / 2 + 0.25 + j * (d.w - 0.5) / 3, d.z, 0.8, j % 2 ? "cactus" : flor ? "flower" : "grass", d.y); });
    castFor(K, [X(2.2), -3.35, 0], [{ walk: [[X(-2.6), 0.6, 5, Y(-HP)], [X(0.4), 2.4, 3, PI], [X(1.5), -0.6, 3, PI]], x: X(-2.6), z: 0.6 }]); K.till = [X(2.2), -3.35];
    if (K.T.venue) K.shop = { x: X(3.0), z: -2.65, r: 1.6, venue: K.venueId, face: true, prompt: "buy a cold drink" };
    K.infos = [{ x: px, z: pz, t: bee ? "Desert honey" : feed ? "Feed and seed" : "Desert plants", k: K.shopName, p: bee ? "Mesquite, catclaw and desert wildflower honey from hives on Garden Row. The darker the jar, the later in the summer it was gathered." : feed ? "Sacks of oats, alfalfa pellets and chicken scratch for the corral and the barnyard, and seed for the community garden: chiles, squash, corn and beans that like the heat." : "Plants that thrive out here: agave, barrel cactus, ocotillo, desert marigold. Pot them in gritty soil, give them sun and very little water.", r: 1.5 }];
  } };

  // TOYS AND MODELS (Cockpit Toys, the model shop): toy shelves, planes and kites overhead, the train table, a rocking horse
  TR.toys = { sheets: ["toys"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, model = /model/i.test(K.ctx.name || ""), space = K.space, ts = smat(space ? "space" : "toys");
    K.pal = Object.assign(K.pal, { accent: "#c2181f", neon: "#ffcf6a", wood: "#c8a070", wood2: "#3a2a1a", trim: "#3a2a1a", signBg: space ? "#0a0f24" : "#1f3b5a", signFg: "#f4ecd6" });
    shell(K, { floor: space ? "concrete" : "strip", floorTint: space ? "#a8a6b4" : "#e8d0b0", wain: "bead", wainTint: space ? "#3a4058" : "#f2d870", upper: space ? "plaster" : "diamond", upperTint: space ? "#2a3048" : "#d8e8f2", ceil: space ? "plaster" : "tin", ceilTint: space ? "#1c2238" : "#f2f4f8", lamp: [0xfff4e4, 1.25], fill: 0.55 });
    K.sideRun(-mx, -2.6, 2.9, 2.4, space ? "space" : "toys", space ? [0, 3] : [0, 1, 0], { body: "#c8a070", unit: 1.85, paint: true }); K.sideRun(mx, -1.0, 2.9, 2.4, space ? "space" : "toys", space ? [0] : [3, 2], { body: "#c8a070", unit: 1.95, paint: true });
    K.counter(X(2.3), -2.55, 2.4, 0, { body: "#c8a070", top: "#3a2a1a", front: "bead" }); K.register(X(3.0), 1.02, -2.65, 0); K.backRun(-4.4, 0.9, 2.4, space ? "space" : "toys", model ? [1, 2] : [2, 1], { body: "#c8a070", unit: 2.65, paint: true }); K.board(X(-1.8), 3.65, K.zb + 0.02, 3.2, 0.62, 0, space ? "neon" : "enamel", K.sign1.title, K.sign1.sub);
    // the train table: green felt, an oval of track, a station, trees; the little train runs round it while you are in the shop
    var tx = X(0.0), tz = 0.7, tw = 2.2, td = 1.3; K.table(tx, tz, tw, td, 0, { top: "#3a6a3a", leg: "#5a3a22", h: 0.82 }); var ra = 0.85, rb = 0.42; for (var i = 0; i < 28; i++) { var a0 = i / 28 * TAU, a1 = (i + 1) / 28 * TAU; b.beam("p_metal", col("#6a6a6a"), [tx + Math.cos(a0) * ra, 0.83, tz + Math.sin(a0) * rb], [tx + Math.cos(a1) * ra, 0.83, tz + Math.sin(a1) * rb], 0.06, 0.015); }
    b.box("p_gloss", col("#c2181f"), tx, 0.82, tz, 0.4, 0.16, 0.2, 0, 1, { ao: 0.1 }); b.box("p_gloss", col("#3a2a1a"), tx, 0.98, tz, 0.46, 0.04, 0.26, 0, 1, { ao: 0 }); for (var t = 0; t < 4; t++) b.lathe("p_cloth", col("#2f6a3a"), tx - 0.8 + t * 0.5, 0.82, tz + (t % 2 ? 0.52 : -0.52), [[0.001, 0], [0.08, 0.06], [0.001, 0.26]], 8);
    K.rotor(tx, 0.84, tz, 0, function (bb) { for (var c = 0; c < 4; c++) { bb.box("p_gloss", col(c ? ["#2f4a7a", "#e8a020", "#2f7a4a"][c - 1] : "#1c1c1c"), -c * 0.16, 0, 0, 0.14, c ? 0.08 : 0.1, 0.07, 0, 1, { ao: 0 }); } bb.cyl("p_gloss", col("#1c1c1c"), 0.03, 0.1, 0, 0.02, 0.02, 0.05, 8); }, function (t2) { var a = t2 * 0.6; return [tx + Math.cos(a) * ra, tz + Math.sin(a) * rb, Math.atan2(-Math.sin(a) * ra, Math.cos(a) * rb) + PI]; });
    // planes and kites overhead, a rocking horse, the model bench (model shop)
    hangPlanes(K, [[X(-2.0), 3.5, -1.2, 0.7], [X(-0.6), 3.3, -2.2, 0.5], [X(1.2), 3.6, -0.6, 0.65], [X(-1.6), 3.4, 1.6, 0.55], [X(1.8), 3.3, 2.0, 0.6], [X(0.2), 3.7, 2.6, 0.5]]);
    for (var k = 0; k < 3; k++) { var kz = 0.6 + k * 0.85; var kc = col(pick(R, ["#c2181f", "#f2b134", "#3a7bd5", "#2f7a4a", "#e25d8a"])); var p0 = [X(4.56), 2.9, kz]; b.quad("p_cloth", kc, p0[0], p0[1], p0[2], 0.45, 0.45, Y(-HP), [0, 0, 1, 1]); b.beam("p_cloth", col("#f4ecd6"), [p0[0], p0[1] - 0.3, p0[2]], [p0[0], 2.2, p0[2] + 0.1], 0.01); }
    if (model) { var mbx = X(-3.95), mbz = 1.4; b.box(tex("grain"), col("#7a5a3a"), mbx, 0, mbz, 0.9, 0.9, 1.6, 0, 0.6, { ao: 0.3 }); for (var p = 0; p < 10; p++) b.cyl("p_gloss", col(pick(R, ["#c2181f", "#f2b134", "#3a7bd5", "#2f7a4a", "#f4ecd6", "#1c1c1c"])), mbx + 0.2 - (p % 2) * 0.1, 0.9, mbz - 0.6 + p * 0.1, 0.02, 0.02, 0.05, 8); K.biplane(mbx, 1.05, mbz + 0.3, 0.45, 0.4, "#9aa0a6", "#c8c8c8"); b.beam("p_metal", col("#2a2a2a"), [mbx, 0.9, mbz - 0.3], [mbx + X(0.2), 1.5, mbz - 0.2], 0.02); b.cyl("g", col("#fff8e8"), mbx + X(0.2), 1.45, mbz - 0.2, 0.1, 0.12, 0.06, 12); K.solid(mbx, mbz, 0.9, 1.6, 0, 0, 0.95); K.showcase(X(1.6), 2.2, 1.4, Y(-0.3), ts, panel(1), { body: "#c8a070" }); }
    else { var hx = X(2.2), hz = 1.9, hr = Y(0.5); b.ring(tex("grain"), col("#a07040"), hx, 0.62, hz, 0.62, 0.05, 18, hr + HP, true); b.box("p_gloss", col("#f4ecd6"), hx, 0.5, hz, 0.7, 0.28, 0.24, hr, 1, { ao: 0.1 }); var hd = off(hx, hz, hr, 0.36, 0); b.box("p_gloss", col("#f4ecd6"), hd[0], 0.68, hd[1], 0.16, 0.4, 0.16, hr, 1, { ao: 0 }); b.box("p_satin", col("#c2181f"), hx, 0.78, hz, 0.24, 0.04, 0.26, hr, 1, { ao: 0 }); [[-0.25, -0.1], [0.25, -0.1], [-0.25, 0.1], [0.25, 0.1]].forEach(function (q) { var lp = off(hx, hz, hr, q[0], q[1]); b.beam("p_gloss", col("#f4ecd6"), [lp[0], 0.5, lp[1]], [lp[0], 0.1, lp[1]], 0.05); }); K.solid(hx, hz, 1.2, 0.5, hr, 0, 0.9); }
    [-1.6, 1.0].forEach(function (x) { K.pendant(X(x), 0.4, 2.95, { style: "globe" }); }); K.pendant(X(2.3), -2.3, 2.8, { style: "dome", c: "#c2181f" }); K.door(X(3.7), K.zb, 0, "WORKSHOP");
    K.disp.forEach(function (d, j) { hangPlanes(K, [[d.x, d.y + 1.3, d.z, 0.6, PI / 2]]); for (var q = 0; q < 4; q++) b.box("p_gloss", col(pick(R, ["#c2181f", "#f2b134", "#3a7bd5", "#2f7a4a"])), d.x - 0.6 + q * 0.4, d.y, d.z, 0.24, 0.24, 0.24, R() * 0.6, 1, { ao: 0.1 }); });
    castFor(K, [X(2.3), -3.35, 0], [{ walk: [[X(-1.4), 1.9, 6, 0], [X(1.4), 0.1, 4, Y(-HP)], [X(-2.9), -0.4, 3, Y(-HP)]], x: X(-1.4), z: 1.9, look: { body: "m" } }]); K.till = [X(2.3), -3.35];
    K.infos = [{ x: tx, z: tz, t: "The train table", k: K.shopName, p: "An oval of track on green felt with a little station and a stand of pines. The engine goes round all day; children are allowed to drive it on Saturdays.", r: 1.7 }];
  } };

  // ───────────────────────── the trades: studios, services and the heritage rooms ─────────────────────────
  // GALLERY (Gold Stage Gallery, the Gallery of Flight): white walls, track lights, framed works with labels, plinths, a bench in the middle
  TR.gallery = { sheets: ["galleryA", "galleryB"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, ga = smat("galleryA"), gb = smat("galleryB"), flight = /flight/i.test(K.ctx.name || "");
    K.pal = Object.assign(K.pal, { accent: "#c9a24a", neon: "#f4cd5a", wood: "#d8c8a8", wood2: "#2a2622", trim: "#e8e4dc", signBg: "#f4f2ee", signFg: "#1c1c1c" });
    shell(K, { floor: "concrete", floorTint: "#d0ccc4", wain: null, upper: "plaster", upperTint: "#f6f4f0", ceil: "plaster", ceilTint: "#f8f8f6", trim: "#e8e4dc", frame: "#2a2622", lamp: [0xfffaf0, 1.35], fill: 0.62, sky: 0.35 });
    var works = [[ga, 0, "Mesa at Dusk", "oil on linen"], [ga, 1, "Contrails", "acrylic"], [ga, 2, "Field DGL, 1928", "oil on board"], [ga, 3, "Saguaro Study", "gouache"], [gb, 0, "Mission, San Bernardino Valley", "silver gelatin print"], [gb, 1, "Sunset Field", "oil"], [gb, 2, "Balloon over the Chiricahuas", "watercolour"], [gb, 3, "Hand of the Range", "oil portrait"]];
    if (flight) works = [works[2], works[1], works[6], works[0], works[5], works[3], works[4], works[7]];
    var hang = function (w, x, z, ry, size) { var s = size || 1.3; K.frame(x, 1.75, z, s, s, ry, w[0], panel(w[1]), "#1c1a18"); var uv = K.sign(256, 96, function (X2, ww, hh) { X2.fillStyle = "#f8f6f2"; X2.fillRect(0, 0, ww, hh); txt(X2, w[2], 12, 30, GROT, "600", 22, "#1c1c1c", ww - 24, { align: "left" }); txt(X2, w[3] + " · for your lot", 12, 66, GROT, "400", 16, "#5a5a5a", ww - 24, { align: "left" }); }); var lp = off(x, z, ry, s / 2 + 0.25, 0.02); b.quad("s", [1, 1, 1], lp[0], 1.3, lp[1], 0.3, 0.11, ry, uv); var tl = off(x, z, ry, 0, 0.9); b.cyl("p_metal", col("#1c1c1c"), tl[0], K.hgt - 0.35, tl[1], 0.05, 0.06, 0.18, 10); b.sph("g", col("#fff8e8"), tl[0], K.hgt - 0.37, tl[1], 0.04, 8); };
    hang(works[0], 0, K.zb, 0, 1.6); hang(works[1], X(-2.8), K.zb, 0, 1.2); hang(works[2], X(2.8), K.zb, 0, 1.2);
    hang(works[3], X(-K.xw), -2.2, Y(HP), 1.2); hang(works[4], X(-K.xw), 0.4, Y(HP), 1.3); hang(works[5], X(-K.xw), 2.6, Y(HP), 1.0); hang(works[6], X(K.xw), -1.4, Y(-HP), 1.4); hang(works[7], X(K.xw), 1.4, Y(-HP), 1.1);
    [-2.6, 0, 2.6].forEach(function (z) { b.box("p_metal", col("#1c1c1c"), 0, K.hgt - 0.08, z, 8.6, 0.05, 0.05, 0, 1, { ao: 0, no: "" }); });
    var plinth = function (x, z, kind) { b.box("p_gloss", col("#f4f2ee"), x, 0, z, 0.55, 1.05, 0.55, 0, 1, { ao: 0.2 }); K.solid(x, z, 0.6, 0.6, 0, 0, 1.6); K.shadow(x, z, 0.6, 0.6, 0);
      if (kind === 0) { b.ring("p_brass", col("#c9a24a"), x, 1.45, z, 0.28, 0.07, 18, 0.6, true); b.ring("p_brass", col("#b88a3a"), x, 1.45, z, 0.18, 0.05, 14, 2.0, true); b.cyl("p_metal", col("#1c1c1c"), x, 1.05, z, 0.02, 0.02, 0.15, 6); } else { b.lathe("p_gloss", col("#b5623a"), x, 1.05, z, [[0.12, 0], [0.2, 0.15], [0.16, 0.4], [0.08, 0.52], [0.1, 0.58]], 16); } };
    plinth(X(-1.5), 0.9, 0); plinth(X(1.6), -0.6, 1); K.bench(0, 0.4, 1.8, PI, { c: "#2a2622", back: false, out: "front" });
    K.counter(X(2.9), 2.6, 1.6, Y(-HP), { body: "#f4f2ee", top: "#2a2622", h: 1.0 }); K.board(X(-1.6), 3.75, K.zb + 0.02, 2.4, 0.4, 0, "modern", K.sign1.title, K.sign1.sub); b.box("x", [1, 1, 1], X(2.9), 1.0, 2.2, 0.3, 0.2, 0.25, 0, 1, { ao: 0 });
    K.disp.forEach(function (d, j) { K.frame(d.x, d.y + 0.8, d.z + 0.05, 0.9, 0.9, PI, works[4 + j][0], panel(works[4 + j][1]), "#1c1a18"); b.box(tex("grain"), col("#d8c8a8"), d.x, d.y, d.z + 0.05, 0.08, 0.3, 0.3, 0, 0.6, { ao: 0 }); });
    castFor(K, [X(3.6), 2.6, Y(-HP)], [{ walk: [[X(-2.4), -1.6, 6, Y(-HP)], [X(0), -2.4, 5, PI], [X(2.4), -0.4, 5, Y(HP)], [X(-1.0), 2.0, 4, Y(-HP)]], x: X(-2.4), z: -1.6 }]); K.till = [X(3.6), 2.6];
    K.shop = { x: X(2.6), z: 2.6, r: 1.5, venue: K.venueId, face: true, prompt: "buy a piece for your lot" };
    K.infos = [{ x: 0, z: -3.6, t: works[0][2], k: K.shopName, p: "Painters, printmakers and photographers from the borderlands and the design district. Every work in the room can be bought as a piece for your lot. Sit on the bench a while: the light is best in the afternoon.", r: 1.8 }];
  } };

  // PHOTO STUDIO (the tintype studio, the photographer, the Club Walk studio): the painted backdrop, a big wooden camera, the posing chair, softboxes, the portrait wall, the darkroom
  TR.photo = { sheets: ["photo"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, ps = smat("photo");
    K.pal = Object.assign(K.pal, { accent: "#6e1f24", neon: "#ffcf6a", wood: "#5a3a22", wood2: "#2a1a10", trim: "#2a1a10", signBg: "#141210" });
    shell(K, { floor: "oak", floorTint: "#8a6a50", wain: "bead", wainTint: "#3a2a20", upper: "damask", upperTint: "#c8b8a0", ceil: "tin", ceilTint: "#c8c0b0", lamp: [0xffe0c0, 1.05], fill: 0.42, sky: 0.25 });
    // the backdrop on its frame, the posing chair and a pedestal with a fern
    var bx = X(-1.2), bz = -3.8; [-1.3, 1.3].forEach(function (s) { b.box("p_metal", col("#2a2622"), bx + s, 0, bz, 0.05, 2.9, 0.05, 0, 1, { ao: 0 }); }); b.beam("p_metal", col("#2a2622"), [bx - 1.35, 2.9, bz], [bx + 1.35, 2.9, bz], 0.06); b.quad(ps, [1, 1, 1], bx, 1.45, bz + 0.03, 2.5, 2.85, 0, panel(2)); b.flat(ps, [0.85, 0.85, 0.85], bx, 0.06, bz + 0.6, 2.5, 1.2, 0, panel(2, [0, 0, 1, 0.4])); K.solid(bx, bz, 2.7, 0.2, 0, 0, 2.9);
    var cx = bx, cz = -3.0; K.chair(cx, cz, 0, { c: "#4a2a1a", cushion: "#6e1f24" }); b.cyl("p_gloss", col("#e8e0d0"), bx + X(1.0), 0, cz, 0.16, 0.2, 0.95, 12); K.plant(bx + X(1.0), cz, 0.8, "grass", 0.95); K.solid(bx + X(1.0), cz, 0.4, 0.4, 0, 0, 1.0);
    // the camera: a bellows box on a heavy wooden tripod, with a black cloth over the back
    var kx = bx + X(0.2), kz = -0.6; [0, 2.1, 4.2].forEach(function (a) { b.beam(tex("grain"), col("#5a3a22"), [kx, 1.25, kz], [kx + Math.sin(a) * 0.45, 0.02, kz + Math.cos(a) * 0.45], 0.05); }); b.box(tex("grain"), col("#7a5232"), kx, 1.25, kz, 0.36, 0.34, 0.3, 0, 0.6, { ao: 0.1 }); b.box("p_cloth", col("#3a2a20"), kx, 1.28, kz - 0.28, 0.3, 0.3, 0.3, 0, 1, { ao: 0.1 }); b.box(tex("grain"), col("#7a5232"), kx, 1.25, kz - 0.5, 0.34, 0.34, 0.06, 0, 0.6, { ao: 0 }); b.cyl("p_brass", col("#c9a24a"), kx, 1.34, kz - 0.56, 0.07, 0.07, 0.01, 12); b.beam("p_brass", col("#c9a24a"), [kx, 1.42, kz - 0.53], [kx, 1.42, kz - 0.7], 0.12, 0.12); b.box("p_cloth", col("#141414"), kx, 1.0, kz + 0.25, 0.42, 0.6, 0.05, 0, 1, { ao: 0.1 }); K.solid(kx, kz, 0.9, 0.9, 0, 0, 1.6);
    // softboxes (lit), the portrait wall, cameras on a shelf, the darkroom door with its red lamp
    [[-1.0, -2.2, 0.6], [1.0, -2.0, -0.6]].forEach(function (p) { var lx = bx + X(p[0] * 1.6), lz = p[1]; [0, 2.1, 4.2].forEach(function (a) { b.beam("p_metal", col("#1c1c1c"), [lx, 1.6, lz], [lx + Math.sin(a) * 0.3, 0.02, lz + Math.cos(a) * 0.3], 0.02); }); var fr = Y(p[2]) + PI; b.box("p_satin", col("#1c1c1c"), lx, 1.55, lz, 0.6, 0.6, 0.24, fr, 1, { ao: 0 }); var fp = off(lx, lz, fr, 0, 0.125); b.quad("g", col("#fff4e0"), fp[0], 1.85, fp[1], 0.54, 0.54, fr, [0, 0, 1, 1]); K.solid(lx, lz, 0.5, 0.5, 0, 0, 1.9); });
    K.sideRun(mx, -1.6, 1.4, 2.4, "photo", [0, 1], { body: "#4a2e1a", unit: 1.5 }); for (var f = 0; f < 6; f++) K.frame(X(-K.xw), 1.4 + (f % 2) * 0.75, -1.6 + Math.floor(f / 2) * 1.0, 0.55, 0.62, Y(HP), ps, panel(0, [(f % 3) * 0.33, 0.5 - (f % 2) * 0.5, (f % 3) * 0.33 + 0.33, 1 - (f % 2) * 0.5]), "#3a2414");
    var dx = X(3.4); K.door(dx, K.zb, 0, "DARKROOM"); b.sph("g", col("#ff2a1a"), dx + X(0.7), 2.4, K.zb + 0.1, 0.07, 10); b.box("p_metal", col("#2a2a2a"), dx + X(0.7), 2.3, K.zb + 0.05, 0.08, 0.06, 0.08, 0, 1, { ao: 0 });
    K.counter(X(2.6), 2.2, 1.8, Y(-HP), { body: "#5a3a22", top: "#2a1a10" }); K.register(X(2.6), 1.02, 2.8, Y(-HP)); K.board(X(1.9), 3.7, K.zb + 0.02, 2.8, 0.55, 0, "gold", K.sign1.title, K.sign1.sub); K.bench(X(-3.6), 2.2, 1.4, Y(HP), { c: "#4a2a1a" });
    K.pendant(X(-0.6), 0.6, 3.0, { style: "globe" }); K.pendant(X(2.6), 2.2, 2.8, { style: "dome", c: "#6e1f24" });
    K.disp.forEach(function (d, j) { [0, 2.1, 4.2].forEach(function (a) { b.beam(tex("grain"), col("#5a3a22"), [d.x, d.y + 0.9, d.z], [d.x + Math.sin(a) * 0.25, d.y, d.z + Math.cos(a) * 0.25], 0.03); }); b.box(tex("grain"), col("#7a5232"), d.x, d.y + 0.9, d.z, 0.25, 0.22, 0.2, PI, 0.6, { ao: 0 }); K.frame(d.x + 0.6, d.y + 0.6, d.z + 0.1, 0.4, 0.5, PI, ps, panel(0, [0.33 * j, 0.5, 0.33 * j + 0.33, 1]), "#3a2414"); });
    castFor(K, [kx + X(0.5), kz + 0.3, Y(-0.4) + PI], [{ sit: 0.46, x: cx, z: cz, face: 0, back: 0.2 }]); K.till = [kx + X(0.5), kz + 0.3];
    K.infos = [{ x: kx, z: kz, t: "The camera", k: K.shopName, p: "A wooden view camera with leather bellows and a brass lens. The plate goes in the back, the cloth goes over the photographer's head, and the sitter holds still for a slow count. The portraits on the wall were all made in this room.", r: 1.5 }];
  } };

  // BIKE SHOP (Runway Cycles, the rental desk): cruisers on the floor and in the repair stand, the wheel wall, parts pegboard, helmets, the workbench
  TR.bikes = { sheets: ["bikes", "hardware"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, rent = /rental/i.test(K.ctx.name || ""), bs = smat("bikes");
    K.pal = Object.assign(K.pal, { accent: "#e8a020", neon: "#ffcf6a", wood: "#4a5058", wood2: "#1c1c1c", trim: "#2a2a2a", signBg: "#1f3b5a" });
    shell(K, { floor: "concrete", floorTint: "#b8b4ac", wain: null, upper: R() < 0.5 ? "brick" : "shiplap", upperTint: "#d8c8b8", ceil: "beams", ceilTint: "#b8a890", beam: "#3a2a1a", lamp: [0xfff0e0, 1.25], fill: 0.5 });
    K.backRun(-4.4, -0.6, 2.6, "bikes", [0, 1], { body: "#4a5058", unit: 1.9, paint: true }); K.sideRun(-mx, -1.4, 2.9, 2.4, "bikes", [2, 3], { body: "#4a5058", unit: 2.15, paint: true }); K.board(X(-2.5), 3.75, K.zb + 0.02, 3.0, 0.55, 0, "enamel", K.sign1.title, K.sign1.sub);
    var cols = ["#3a7bd5", "#c2181f", "#2f7a4a", "#e8a020", "#e25d8a", "#f4ecd6"]; [[0.2, 1.6, 0.2], [1.6, 2.4, -0.3], [-1.4, 2.2, 0.4]].forEach(function (p) { K.bike(X(p[0]), p[1], Y(p[2]), pick(R, cols)); K.solid(X(p[0]), p[1], 1.6, 0.4, Y(p[2]), 0, 1.1); });
    // the repair stand with a bike up in it, the workbench with a vise and the pegboard over it
    var sx = X(1.4), sz = -1.6; b.cyl("p_metal", col("#1c1c1c"), sx, 0, sz, 0.3, 0.3, 0.04, 12); b.cyl("p_metal", col("#2f6aa8"), sx, 0.04, sz, 0.03, 0.03, 1.2, 8, { open: true }); b.beam("p_metal", col("#2f6aa8"), [sx, 1.24, sz], [sx + 0.3, 1.3, sz], 0.04); K.b.box("p_metal", col("#1c1c1c"), sx + 0.32, 1.2, sz, 0.08, 0.12, 0.1, 0, 1, { ao: 0 });
    K.bike(sx + 0.6, sz, Y(0.15), "#c2181f"); K.solid(sx + 0.3, sz, 1.8, 0.6, 0, 0, 1.3);
    var wx = X(3.2), wz = K.zb + 0.4; b.box(tex("grain"), col("#7a5a3a"), wx, 0, wz, 2.2, 0.9, 0.7, 0, 0.6, { ao: 0.3 }); b.box("p_metal", col("#2f6aa8"), wx - 0.8, 0.9, wz, 0.18, 0.14, 0.16, 0, 1, { ao: 0 }); K.solid(wx, wz, 2.2, 0.7, 0, 0, 0.95); K.frame(wx, 1.9, K.zb, 2.0, 1.1, 0, smat("hardware"), panel(0));
    for (var t = 0; t < 6; t++) b.ring("p_satin", col("#1c1c1c"), X(4.5), 2.8, -2.0 + t * 0.55, 0.32, 0.05, 16, Y(-HP), true); K.sideRun(mx, 0.6, 2.9, 2.2, "bikes", [3], { body: "#4a5058", unit: 2.3, paint: true });
    K.counter(X(-0.6), -2.6, 2.4, 0, { body: "#4a5058", top: "#2a2622", front: "panel" }); K.register(X(0.2), 1.02, -2.7, 0); if (rent) { var kuv = K.sign(256, 192, function (X2, w, h) { woodBg(X2, w, h, "#4a3220", "#2e1e12", 9); txt(X2, "RENTALS", w / 2, 26, DISPLAY, "400", 30, "#f4ecd6", w - 20, { ls: 4 }); for (var i = 0; i < 12; i++) { X2.fillStyle = "#c9a24a"; X2.beginPath(); X2.arc(30 + (i % 6) * 40, 80 + Math.floor(i / 6) * 60, 6, 0, TAU); X2.fill(); X2.fillStyle = "#f4ecd6"; X2.fillRect(26 + (i % 6) * 40, 90 + Math.floor(i / 6) * 60, 8, 22); } }); K.frame(X(-0.6), 1.9, K.zb, 0.9, 0.68, 0, "s", kuv, "#2a1a10"); }
    [-1.2, 1.4].forEach(function (x) { K.pendant(X(x), 0.2, 3.0, { style: "dome", c: "#2a2a2a" }); }); K.door(X(3.4) - X(1.6), K.zb, 0, null); var pump = [X(-3.6), 2.9]; b.cyl("p_gloss", col("#c2181f"), pump[0], 0, pump[1], 0.06, 0.06, 0.7, 10); b.box("p_metal", col("#1c1c1c"), pump[0], 0.7, pump[1], 0.3, 0.04, 0.05, 0, 1, { ao: 0 });
    K.disp.forEach(function (d, j) { K.bike(d.x, d.z, 0, cols[j + 1]); });
    castFor(K, [sx - X(0.4), sz + 0.6, Y(0.6)], [{ walk: [[X(-2.6), 0.6, 5, Y(-HP)], [X(-0.4), 2.6, 4, PI], [X(2.8), 1.0, 4, Y(HP)]], x: X(-2.6), z: 0.6 }]); K.till = [sx - X(0.4), sz + 0.6];
    K.infos = [{ x: sx, z: sz, t: "The repair stand", k: K.shopName, p: "Cruisers for the dirt roads get new bearings, wide tyres and a coaster brake here. Every road on the site is dirt except the runway, so the shop fits the fat tyres as standard.", r: 1.6 }];
  } };

  // RECORDS (Hangar Records): crates on tables, the album wall, the listening booth, a turntable that turns, hi-fi, posters
  TR.records = { sheets: ["records"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, rs = smat("records");
    var C = cw(K, [{ fl: "checker", ft: "#d8d0c8", up: "brick", ut: "#b89888", neon: "#ff5a8a" }, { fl: "strip", ft: "#a08068", up: "plaster", ut: "#3a3048", neon: "#6ad0ff" }]);
    K.pal = Object.assign(K.pal, { accent: "#6e1f24", neon: C.neon, wood: "#3a2a20", wood2: "#1c1c1c", trim: "#1c1c1c", signBg: "#101010" });
    shell(K, { floor: C.fl, floorTint: C.ft, wain: null, upper: C.up, upperTint: C.ut, ceil: "plaster", ceilTint: "#2a2a30", lamp: [0xffd8b8, 1.1], fill: 0.4, sky: 0.25 });
    K.sideRun(-mx, -2.6, 2.9, 2.6, "records", [0, 0, 3], { body: "#2a2a2a", unit: 1.85, paint: true }); K.backRun(1.0, 4.4, 2.6, "records", [2, 0], { body: "#2a2a2a", unit: 1.7, paint: true });
    K.board(X(-1.4), 3.7, K.zb + 0.02, 3.4, 0.7, 0, "neon", K.sign1.title, K.sign1.sub);
    // crate tables: rows of record crates with the album tops showing
    var crates = function (x, z, ry) { b.box(tex("grain"), col("#4a3020"), x, 0, z, 1.8, 0.72, 0.9, ry, 0.6, { ao: 0.3 }); for (var i = 0; i < 4; i++) for (var j = 0; j < 2; j++) { var p = off(x, z, ry, -0.66 + i * 0.44, -0.22 + j * 0.44); b.box(tex("grain"), col("#8a6a48"), p[0], 0.72, p[1], 0.4, 0.2, 0.4, ry, 0.6, { ao: 0.1, no: "t" }); var q = (i + j * 4) % 4; b.quad(rs, [1, 1, 1], p[0], 0.86, p[1], 0.36, 0.34, ry - 0.25, panel(1, [(q % 2) * 0.5, 0.5 - Math.floor(q / 2) * 0.5, (q % 2) * 0.5 + 0.5, 1 - Math.floor(q / 2) * 0.5])); } K.solid(x, z, 1.85, 0.95, ry, 0, 1.0); K.shadow(x, z, 1.8, 0.9, ry); };
    crates(X(-0.6), 0.2, 0); crates(X(-0.6), 1.9, 0);
    // the listening booth: glass on two sides, a bench, two pairs of headphones, a turntable on a shelf
    var lx = X(3.1), lz = 1.6; [[-0.95, 0], [0.95, 0]].forEach(function (p) { b.box("p_satin", col("#2a2a2a"), lx + X(p[0]), 0, lz - 1.0, 0.06, 2.4, 0.06, 0, 1, { ao: 0 }); b.box("p_satin", col("#2a2a2a"), lx + X(p[0]), 0, lz + 1.0, 0.06, 2.4, 0.06, 0, 1, { ao: 0 }); }); b.box("x", [1, 1, 1], lx - X(0.95), 0.05, lz, 0.03, 2.3, 1.94, 0, 1, { ao: 0 }); b.box("x", [1, 1, 1], lx, 0.05, lz - 1.0, 1.9, 2.3, 0.03, 0, 1, { ao: 0 }); b.box("p_satin", col("#2a2a2a"), lx, 2.4, lz, 2.0, 0.08, 2.1, 0, 1, { ao: 0, no: "" });
    K.solid(lx - X(0.95), lz + 0.15, 0.08, 1.8, 0, 0, 2.4); K.solid(lx, lz - 1.0, 1.95, 0.08, 0, 0, 2.4); K.bench(lx + X(0.3), lz + 0.25, 1.2, Y(-HP), { c: "#6e1f24", back: false, out: "front" }); b.box(tex("grain"), col("#3a2a20"), lx + X(0.75), 1.0, lz - 0.55, 0.4, 0.05, 0.5, 0, 0.6, { ao: 0 });
    [0, 1].forEach(function (k) { var hp = [lx + X(0.6), 1.55, lz + 0.0 + k * 0.6]; b.ring("p_satin", col("#1c1c1c"), hp[0], hp[1], hp[2], 0.1, 0.02, 10, Y(HP), true); b.cyl("p_satin", col("#1c1c1c"), hp[0], hp[1] - 0.12, hp[2] - 0.1, 0.045, 0.045, 0.04, 10); });
    b.box("p_satin", col("#1c1c1c"), lx + X(0.75), 1.05, lz - 0.55, 0.36, 0.08, 0.36, 0, 1, { ao: 0 }); K.rotor(lx + X(0.75), 1.14, lz - 0.55, 3.5, function (bb) { bb.cyl("p_gloss", col("#101010"), 0, 0, 0, 0.15, 0.15, 0.005, 24); bb.cyl("p_gloss", col("#c2181f"), 0, 0.005, 0, 0.05, 0.05, 0.002, 16); });
    // the counter turntable, hi-fi stacks, posters, neon in the window
    K.counter(X(-2.2), -2.6, 2.6, 0, { body: "#2a2a2a", top: "#1c1c1c", front: "panel" }); b.box("p_satin", col("#2a2a2a"), X(-2.5), 1.02, -2.6, 0.48, 0.1, 0.38, 0, 1, { ao: 0 }); K.rotor(X(-2.5), 1.12, -2.6, 3.5, function (bb) { bb.cyl("p_gloss", col("#101010"), 0, 0, 0, 0.15, 0.15, 0.005, 24); bb.cyl("p_gloss", col("#f2b134"), 0, 0.005, 0, 0.05, 0.05, 0.002, 16); }); K.register(X(-1.4), 1.02, -2.7, 0);
    [[-0.2], [0.9]].forEach(function (p, i) { b.box("p_satin", col("#2a1e16"), X(p[0]), 0, K.zb + 0.3, 0.45, 1.0, 0.4, 0, 1, { ao: 0.2 }); b.disc("p_satin", col("#141414"), X(p[0]), 0.7, K.zb + 0.505, 0.16, 0, 16); b.disc("p_satin", col("#141414"), X(p[0]), 0.3, K.zb + 0.505, 0.1, 0, 14); K.solid(X(p[0]), K.zb + 0.3, 0.5, 0.45, 0, 0, 1.0); });
    [-2.4, 1.2].forEach(function (x) { K.pendant(X(x), 0.6, 2.9, { style: "cone", c: "#1c1c1c", glow: "#ffd8b8" }); }); K.door(X(-3.8), K.zb, 0, "STOCK"); K.poster(X(K.xw), 2.6, -1.4, 0.8, 1.1, Y(-HP), "flyin");
    K.disp.forEach(function (d) { for (var j = 0; j < 3; j++) K.frame(d.x - 0.6 + j * 0.6, d.y + 0.45, d.z + 0.1, 0.42, 0.42, PI, rs, panel(0, [j * 0.33, 0.5, j * 0.33 + 0.33, 0.83])); });
    castFor(K, [X(-2.2), -3.4, 0], [{ sit: 0.45, x: lx + X(0.3), z: lz + 0.25, face: Y(-HP), back: 0.08 }, { walk: [[X(-1.9), 1.05, 6, 0], [X(0.7), 1.05, 5, 0], [X(0.7), -0.65, 4, PI], [X(-1.9), -0.65, 5, PI]], x: X(-1.9), z: 1.05 }]); K.till = [X(-2.2), -3.4];
    K.infos = [{ x: lx, z: lz, t: "The listening booth", k: K.shopName, p: "Glass on two sides, a bench and two pairs of headphones. Pick a record from the crates and the turntable in the booth is yours for a side.", r: 1.6 }, { x: X(-0.6), z: 1.05, t: "The crates", k: K.shopName, p: "Desert blues, Tejano, jazz from the old hangar dances, surf, country and a crate of mystery records. Prices are pencilled on the sleeves.", r: 1.2 }];
  } };

  // a barber chair: a chrome pump base, a leather seat and back, a head rest, arm rests and a foot plate (sittable)
  function barberChair(K, x, z, face, c) { var b = K.b, ch = col("#d9dde0"), lt = col(c || "#7a1c1c");
    b.cyl("p_chrome", ch, x, 0, z, 0.3, 0.32, 0.06, 18); b.cyl("p_chrome", ch, x, 0.06, z, 0.09, 0.11, 0.42, 14); var s = off(x, z, face, 0, 0.0); b.box("p_gloss", lt, s[0], 0.5, s[1], 0.56, 0.12, 0.5, face, 1, { ao: 0 }); var bk = off(x, z, face, 0, -0.26); b.box("p_gloss", lt, bk[0], 0.6, bk[1], 0.52, 0.66, 0.1, face, 1, { ao: 0 }); var hr = off(x, z, face, 0, -0.3); b.box("p_gloss", lt, hr[0], 1.3, hr[1], 0.24, 0.14, 0.08, face, 1, { ao: 0 }); b.beam("p_chrome", ch, [hr[0], 1.22, hr[1]], [hr[0], 1.3, hr[1]], 0.02);
    [-1, 1].forEach(function (sd) { var a = off(x, z, face, sd * 0.31, 0.05); b.box("p_chrome", ch, a[0], 0.62, a[1], 0.06, 0.04, 0.46, face, 1, { ao: 0 }); b.beam("p_chrome", ch, [a[0], 0.5, a[1]], [a[0], 0.62, a[1]], 0.02); }); var fp = off(x, z, face, 0, 0.45); b.box("p_chrome", ch, fp[0], 0.18, fp[1], 0.36, 0.03, 0.2, face, 1, { ao: 0 }); b.beam("p_chrome", ch, [s[0], 0.5, s[1]], [fp[0], 0.2, fp[1]], 0.025);
    K.seat(x, z, 0.56, 0.5, face, 0.62, face, "front"); K.solid(bk[0], bk[1], 0.55, 0.12, face, 0.62, 1.38); K.shadow(x, z, 0.7, 0.7, 0); }
  // BARBER (Aviator Barber, Barber and Bath): three chairs at the mirrors, the back counter, the pole, the waiting bench, hex tile
  TR.barber = { sheets: ["barber"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, bath = /bath/i.test(K.ctx.name || ""), bs = smat("barber");
    var C = cw(K, [{ lt: "#7a1c1c", wt: "#1f3b5a", ut: "#e8e2d4" }, { lt: "#1c1c1c", wt: "#2f4a3a", ut: "#e8dcc8" }, { lt: "#5a3a24", wt: "#6e1f24", ut: "#f0e8dc" }]);
    K.pal = Object.assign(K.pal, { accent: C.lt, neon: "#ff5a5a", wood: "#3a2a20", wood2: "#1c1c1c", trim: "#2a1e16", signBg: "#141210" });
    shell(K, { floor: "hex", floorTint: "#ffffff", wain: "tile", wainTint: "#ffffff", upper: R() < 0.5 ? "stripe" : "plaster", upperTint: C.ut, ceil: "tin", ceilTint: "#f4f0e8", lamp: [0xfff4e8, 1.3], fill: 0.55 });
    // the mirror wall: a back counter with tonics, three mirrors with lit frames, the chairs facing them
    var mxw = X(K.xw); b.box(tex("grain"), col("#3a2a20"), X(4.33), 0, -0.8, 0.6, 0.92, 4.8, 0, 0.6, { ao: 0.3 }); b.box("p_gloss", col("#e8e2d8"), X(4.3), 0.92, -0.8, 0.66, 0.04, 4.86, 0, 1, { ao: 0, no: "" }); K.solid(X(4.33), -0.8, 0.62, 4.8, 0, 0, 0.98);
    [-2.4, -0.8, 0.8].forEach(function (z, i) { b.box("p_satin", col("#2a1e16"), X(4.58), 1.1, z, 0.06, 1.5, 1.2, 0, 1, { ao: 0 }); b.box("p_chrome", col("#f0f4f8"), X(4.54), 1.18, z, 0.02, 1.34, 1.04, 0, 1, { ao: 0 }); [-1, 1].forEach(function (s) { b.box("g", col("#fff2dc"), X(4.52), 1.18, z + s * 0.56, 0.03, 1.34, 0.04, 0, 1, { ao: 0 }); }); K.bottles(X(4.4), 0.96, z, 0.9, Y(-HP), 4, "bottle", ["#1f6aa8", "#2f8a5a", "#c9a24a", "#e8e2d8"]); barberChair(K, X(3.0), z, Y(-HP), C.lt); });
    K.sideRun(mx, 1.8, 2.9, 2.3, "barber", [0], { body: "#3a2a20", unit: 1.1 }); K.frame(X(4.6), 2.85, -1.6, 1.4, 0.9, Y(-HP), bs, panel(2), "#2a1e16"); K.frame(X(4.6), 2.85, 0.6, 1.0, 0.9, Y(-HP), bs, panel(3), "#2a1e16");
    // the waiting bench under the posters, a table with papers, the pole by the window, the towel steamer, the till
    K.bench(X(-4.2), -0.6, 2.4, Y(HP), { c: "#3a2a20" }); K.table(X(-3.6), 1.4, 0.6, 0.6, 0, { round: true, top: "#3a2a20", leg: "#1c1c1c" }); for (var p = 0; p < 3; p++) b.box("p_cloth", col("#e8e2d0"), X(-3.6), 0.76 + p * 0.012, 1.4, 0.38, 0.01, 0.28, p * 0.4, 1, { ao: 0 });
    K.poster(X(-K.xw), 2.4, -1.6, 0.7, 0.95, Y(HP), "airfield"); K.frame(X(-K.xw), 2.4, 0.3, 0.9, 0.9, Y(HP), bs, panel(2), "#2a1e16");
    var px = X(-3.0), pz = K.zf - 0.9; b.cyl("p_chrome", col("#d9dde0"), px, 0, pz, 0.14, 0.14, 0.1, 12); b.cyl("p_chrome", col("#d9dde0"), px, 1.7, pz, 0.12, 0.12, 0.1, 12); b.sph("p_chrome", col("#d9dde0"), px, 1.86, pz, 0.1, 10); b.box("x", [1, 1, 1], px, 0.1, pz, 0.2, 1.6, 0.2, 0, 1, { ao: 0 }); K.solid(px, pz, 0.3, 0.3, 0, 0, 1.9);
    var stripe = K.sign(128, 512, function (X2, w, h) { X2.fillStyle = "#f4f4f4"; X2.fillRect(0, 0, w, h); for (var i = -8; i < 16; i++) { X2.fillStyle = i % 3 === 0 ? "#c2181f" : i % 3 === 1 ? "#f4f4f4" : "#1f4a9a"; X2.beginPath(); X2.moveTo(0, i * 40); X2.lineTo(w, i * 40 + 60); X2.lineTo(w, i * 40 + 100); X2.lineTo(0, i * 40 + 40); X2.closePath(); X2.fill(); } });
    K.rotor(px, 0.12, pz, 1.6, function (bb) { for (var f = 0; f < 10; f++) { var a0 = f / 10 * TAU, a1 = (f + 1) / 10 * TAU; var g = bb.a("s"); var r = 0.075, h = 1.56; var P = [[Math.sin(a0) * r, 0, Math.cos(a0) * r], [Math.sin(a1) * r, 0, Math.cos(a1) * r], [Math.sin(a1) * r, h, Math.cos(a1) * r], [Math.sin(a0) * r, h, Math.cos(a0) * r]]; var u0 = stripe[0] + (stripe[2] - stripe[0]) * f / 10, u1 = stripe[0] + (stripe[2] - stripe[0]) * (f + 1) / 10; var U = [[u0, stripe[1]], [u1, stripe[1]], [u1, stripe[3]], [u0, stripe[3]]]; [0, 1, 2, 0, 2, 3].forEach(function (k) { g.p.push(P[k][0], P[k][1], P[k][2]); g.n.push(P[k][0] / r, 0, P[k][2] / r); g.u.push(U[k][0], U[k][1]); g.c.push(1, 1, 1); }); } });
    b.box("p_chrome", col("#d9dde0"), X(-3.9), 0, -3.4, 0.45, 0.85, 0.45, 0, 1, { ao: 0.2 }); b.cyl("p_chrome", col("#e8ecf0"), X(-3.9), 0.85, -3.4, 0.18, 0.18, 0.4, 14, { top: col("#c8ccd0") }); K.solid(X(-3.9), -3.4, 0.5, 0.5, 0, 0, 1.3);
    K.counter(X(-1.6), -3.0, 1.8, 0, { body: "#3a2a20", top: "#e8e2d8", topKey: "p_gloss" }); K.register(X(-1.2), 1.02, -3.1, 0); K.board(X(0.4), 3.7, K.zb + 0.02, 3.4, 0.62, 0, "gold", K.sign1.title, K.sign1.sub);
    if (bath) { var tx = X(0.9), tz = -3.6; b.lathe("p_gloss", col("#f4f2ee"), tx, 0.18, tz, [[0.3, 0], [0.5, 0.05], [0.55, 0.4], [0.58, 0.55], [0.54, 0.56]], 18, null, 1); for (var f2 = 0; f2 < 4; f2++) b.cyl("p_brass", col("#c9a24a"), tx + (f2 % 2 ? 0.3 : -0.3), 0, tz + (f2 < 2 ? 0.25 : -0.25), 0.04, 0.03, 0.2, 8); b.beam("p_brass", col("#c9a24a"), [tx, 0.7, tz - 0.55], [tx, 0.95, tz - 0.6], 0.03); for (var sc = 0; sc < 3; sc++) b.box("p_cloth", col("#e8dcc4"), tx - 0.9 + sc * 0.6, 0.02, tz + 0.75 + (sc % 2) * 0.08, 0.6, 1.8, 0.03, sc % 2 ? 0.3 : -0.3, 1, { ao: 0.1 }); K.solid(tx, tz, 1.2, 1.2, 0, 0, 0.9); }
    else K.door(X(1.0), K.zb, 0, "BACK");
    [-2.4, -0.8, 0.8].forEach(function (z) { K.pendant(X(2.6), z, 2.9, { style: "globe" }); }); K.pendant(X(-2.6), 0.4, 2.9, { style: "globe" });
    K.disp.forEach(function (d) { K.bottles(d.x, d.y, d.z + 0.05, d.w * 0.7, 0, 7, "bottle", ["#1f6aa8", "#2f8a5a", "#c9a24a"]); });
    castFor(K, [X(2.4), -0.6, Y(HP)], [{ sit: 0.62, x: X(3.0), z: -0.8, face: Y(-HP), back: 0.12 }, { sit: 0.45, x: X(-4.2), z: -0.2, face: Y(HP), back: 0.2 }]); K.till = [X(2.4), -0.6];
    K.stampSit = K.T.stamp; K.noEnterStamp = true; K.infos = [{ x: X(3.0), z: -2.4, t: "The barber chairs", k: K.shopName, p: "Three hydraulic chairs in chrome and leather, facing the mirrors. Sit in any free chair: short back and sides, a hot towel, a straight razor shave. The aviator cut fits under a flying helmet.", r: 1.0, face: false }];
    K.ctx.H.frame(function () { try { if (SIT.on && K.stampSit && Math.abs(player.position.y - K.ctx.e[1] - 0.62) < 0.05) { award(K.stampSit); K.stampSit = null; } } catch (e) {} });
  } };

  // MAKERS (Douglas Makers, the printing office): workbenches, the potter's wheel (it turns), makers' shelves, the tool wall; the letterpress
  TR.makers = { sheets: ["makers"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, print = /print/i.test(K.ctx.name || ""), ms = smat("makers");
    K.pal = Object.assign(K.pal, { accent: "#b5623a", neon: "#ffcf6a", wood: "#8a6440", wood2: "#3a2a1a", trim: "#3a2a1a", signBg: print ? "#141414" : "#3a2414", signFg: "#f2dfae" });
    shell(K, { floor: print ? "strip" : "concrete", floorTint: print ? "#8a7058" : "#c8c0b4", wain: print ? "bead" : null, wainTint: "#4a3a2a", upper: "brick", upperTint: print ? "#a89080" : "#d8c0b0", ceil: "beams", ceilTint: "#c8b090", beam: "#3a2a1a", lamp: [0xffe8cc, 1.25], fill: 0.5 });
    K.sideRun(-mx, -2.6, 2.9, 2.4, "makers", print ? [3, 3] : [0, 1, 2], { body: "#6a4a32", unit: 1.85 }); K.counter(X(2.4), -2.55, 2.4, 0, { body: "#6a4a32", top: "#3a2a1a" }); K.register(X(3.1), 1.02, -2.65, 0);
    K.backRun(-4.4, 1.1, 2.4, "makers", print ? [3, 2] : [2, 0], { body: "#6a4a32", unit: 2.75 }); K.board(X(-1.7), 3.7, K.zb + 0.02, 3.2, 0.62, 0, print ? "gold" : "wood", K.sign1.title, K.sign1.sub);
    if (print) { // the letterpress: a cast iron frame, the platen, the big flywheel; type cases; printed bills drying on a line
      var px = X(0.2), pz = 0.2; b.box("p_metal", col("#1c1c1c"), px, 0, pz, 0.9, 0.5, 1.2, 0, 1, { ao: 0.3 }); b.box("p_metal", col("#2a2622"), px, 0.5, pz - 0.3, 0.7, 1.1, 0.25, 0, 1, { ao: 0.1 }); b.box("p_metal", col("#3a3632"), px, 0.9, pz + 0.15, 0.6, 0.5, 0.06, 0, 1, { ao: 0 }); b.ring("p_metal", col("#2a2622"), px + X(0.55), 0.95, pz, 0.6, 0.06, 20, Y(HP), true); for (var sp = 0; sp < 6; sp++) { var a = sp / 6 * TAU; b.beam("p_metal", col("#2a2622"), [px + X(0.55), 0.95, pz], [px + X(0.55), 0.95 + Math.sin(a) * 0.58, pz + Math.cos(a) * 0.58], 0.03); } K.solid(px + X(0.2), pz, 1.4, 1.4, 0, 0, 1.7);
      var tx = X(2.6), tz = 0.9; b.box(tex("grain"), col("#6a4a32"), tx, 0, tz, 1.2, 1.1, 0.6, Y(-HP), 0.6, { ao: 0.3 }); for (var dr = 0; dr < 8; dr++) { var q = off(tx, tz, Y(-HP), 0, 0.31); b.box("p_satin", col("#5a3a22"), q[0], 0.1 + dr * 0.125, q[1], 1.1, 0.1, 0.02, Y(-HP), 1, { ao: 0, no: "bk" }); b.box("p_brass", col("#c9a24a"), off(q[0], q[1], Y(-HP), 0, 0.02)[0], 0.15 + dr * 0.125, off(q[0], q[1], Y(-HP), 0, 0.02)[1], 0.12, 0.02, 0.01, Y(-HP), 1, { ao: 0 }); } b.box("p_satin", col("#c8b090"), tx, 1.1, tz, 1.2, 0.04, 0.6, Y(-HP), 1, { ao: 0, no: "" }); K.solid(tx, tz, 0.62, 1.22, 0, 0, 1.15);
      b.beam("p_cloth", col("#c8b48c"), [X(-3.6), 2.62, 1.6], [X(1.4), 2.62, 2.4], 0.008); ["airmail", "rodeo", "flyin", "fair", "route"].forEach(function (k, i) { var t = (i + 0.5) / 5; var x = X(-3.6) + (X(1.4) - X(-3.6)) * t, z = 1.6 + 0.8 * t; var uv = K.sign(150, 210, posterDraw(k, i * 31 + 7)); b.quad("s", [1, 1, 1], x, 2.38, z, 0.32, 0.45, Y(-0.16) + 0, uv); b.quad("s", [1, 1, 1], x, 2.38, z, 0.32, 0.45, Y(-0.16) + PI, uv); }); }
    else { // the potter's wheel with a pot on it, two workbenches, a loom frame
      var wx = X(0.0), wz = 0.6; b.box("p_metal", col("#4a5058"), wx, 0, wz, 0.7, 0.45, 0.7, 0, 1, { ao: 0.3 }); b.cyl("p_metal", col("#5a6068"), wx, 0.45, wz, 0.36, 0.36, 0.08, 18, { top: col("#7a6a5a") }); K.chair(wx, wz + 0.75, PI, { c: "#5a3a22" }); K.solid(wx, wz, 0.75, 0.75, 0, 0, 0.6);
      K.rotor(wx, 0.535, wz, 2.4, function (bb) { bb.cyl("p_satin", col("#a87a5a"), 0, 0, 0, 0.3, 0.3, 0.02, 18); bb.lathe("p_satin", col("#b5824a"), 0, 0.02, 0, [[0.08, 0], [0.12, 0.06], [0.14, 0.16], [0.1, 0.24], [0.08, 0.26], [0.085, 0.28]], 14); });
      var bx = X(2.4), bz = 1.4; b.box(tex("grain"), col("#7a5a3a"), bx, 0, bz, 1.6, 0.9, 0.8, 0, 0.6, { ao: 0.3 }); for (var k2 = 0; k2 < 5; k2++) b.lathe("p_satin", col(pick(R, ["#b5623a", "#8a9a7a", "#c8b090", "#3a5a6a"])), bx - 0.6 + k2 * 0.3, 0.9, bz + (k2 % 2) * 0.12, [[0.06, 0], [0.1, 0.08], [0.09, 0.18], [0.05, 0.24], [0.06, 0.26]], 12); K.solid(bx, bz, 1.6, 0.8, 0, 0, 1.0);
      var lx = X(-1.6), lz = 2.6; [-0.6, 0.6].forEach(function (s) { b.box(tex("grain"), col("#6a4a32"), lx + s, 0, lz, 0.08, 1.7, 0.08, 0, 0.6, { ao: 0 }); }); b.beam(tex("grain"), col("#6a4a32"), [lx - 0.65, 1.66, lz], [lx + 0.65, 1.66, lz], 0.08); b.beam(tex("grain"), col("#6a4a32"), [lx - 0.65, 0.3, lz], [lx + 0.65, 0.3, lz], 0.08); b.quad(ms, [1, 1, 1], lx, 0.98, lz, 1.1, 1.3, 0, panel(1, [0.5, 0.0, 1.0, 0.5])); b.quad(ms, [1, 1, 1], lx, 0.98, lz, 1.1, 1.3, PI, panel(1, [0.5, 0.0, 1.0, 0.5])); K.solid(lx, lz, 1.3, 0.2, 0, 0, 1.7); }
    K.frame(X(K.xw), 2.0, -0.8, 1.6, 1.4, Y(-HP), ms, panel(3), "#3a2414");
    [-1.4, 1.4].forEach(function (x) { K.pendant(X(x), 0.6, 2.9, { style: "dome", c: "#2a2a2a" }); }); K.pendant(X(2.4), -2.3, 2.8, { style: "bulb" }); K.door(X(3.6), K.zb, 0, "STUDIO");
    K.disp.forEach(function (d) { for (var j = 0; j < 4; j++) b.lathe("p_satin", col(pick(R, ["#b5623a", "#8a9a7a", "#c8b090", "#3a5a6a"])), d.x - 0.6 + j * 0.4, d.y, d.z, [[0.07, 0], [0.12, 0.1], [0.11, 0.24], [0.06, 0.32], [0.07, 0.34]], 12); });
    castFor(K, print ? [X(0.9), 0.4, Y(-HP)] : [X(0.0), 1.35, PI], [{ walk: [[X(-3.4), 0.0, 5, Y(-HP)], [X(-2.0), 1.4, 3, 0], [X(1.6), -0.8, 4, Y(HP)]], x: X(-3.4), z: 0.0 }]); K.till = print ? [X(0.9), 0.4] : [X(0.0), 1.35];
    K.infos = [{ x: print ? X(0.2) : X(0.0), z: print ? 0.2 : 0.6, t: print ? "The letterpress" : "The potter's wheel", k: K.shopName, p: print ? "A cast iron platen press with a flywheel taller than a child. The handbills on the line were set by hand from the type cases and printed one sheet at a time: rodeos, fly-ins, the harvest fair." : "The wheel turns most afternoons. Clay from the hills east of town, glazes mixed on the bench, fired in the kiln out back. Everything on the shelves was made by someone who lives in Douglas.", r: 1.6 }];
  } };

  // BOOKS AND MAPS (Border Books, the Book and Map Room): shelves to the ceiling with a rolling ladder, two reading chairs on a rug, the map table
  TR.books = { sheets: ["books"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, space = K.space, bks = smat("books");
    K.pal = Object.assign(K.pal, { accent: "#2f4a3a", neon: "#ffcf6a", wood: "#4a2e1a", wood2: "#2a1a10", trim: "#2a1a10", signBg: "#141210" });
    shell(K, { floor: "oak", floorTint: "#8a6a50", wain: "bead", wainTint: "#2f4a3a", upper: "damask", upperTint: "#c8b898", ceil: "tin", ceilTint: "#d8ccb4", lamp: [0xffd8a8, 1.0], fill: 0.4, sky: 0.25 });
    K.sideRun(-mx, -3.4, 2.9, 3.4, "books", [0, 2, 0], { body: "#4a2e1a", unit: 2.1, ladder: 0.4 }); K.sideRun(mx, -1.2, 2.9, 3.4, "books", [2, 0], { body: "#4a2e1a", unit: 2.05 }); K.backRun(0.4, 4.4, 3.4, "books", [0, 2], { body: "#4a2e1a", unit: 2.0 });
    K.board(X(2.4), 3.95, K.zb + 0.02, 3.0, 0.45, 0, "gold", K.sign1.title, K.sign1.sub);
    // the reading nook: a rug, two armchairs, a side table with a lamp (glows), a stack of books
    var nx = X(1.9), nz = 1.6; K.rug(nx, nz, 2.4, 1.8, 0, "persian");
    var arm = function (x, z, face) { var lt = col("#6e2a1c"); b.box("p_satin", lt, x, 0.1, z, 0.8, 0.36, 0.8, face, 1, { ao: 0.2 }); var bk = off(x, z, face, 0, -0.33); b.box("p_satin", lt, bk[0], 0.46, bk[1], 0.8, 0.6, 0.16, face, 1, { ao: 0 }); [-1, 1].forEach(function (s) { var a = off(x, z, face, s * 0.36, 0.0); b.box("p_satin", mulc(lt, 0.92), a[0], 0.46, a[1], 0.12, 0.24, 0.76, face, 1, { ao: 0 }); }); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) { var l = off(x, z, face, c[0] * 0.33, c[1] * 0.33); b.cyl(tex("grain"), col("#2a1a10"), l[0], 0, l[1], 0.03, 0.025, 0.1, 6); }); K.seat(x, z, 0.62, 0.6, face, 0.48, face, "front"); K.solid(bk[0], bk[1], 0.8, 0.18, face, 0.48, 1.06); };
    arm(nx - X(0.7), nz - 0.2, Y(0.5)); arm(nx + X(0.7), nz - 0.2, Y(-0.5)); var st = [nx, nz - 0.65]; K.table(st[0], st[1], 0.45, 0.45, 0, { round: true, top: "#4a2e1a", leg: "#2a1a10", h: 0.6 }); b.cyl("p_brass", col("#c9a24a"), st[0], 0.6, st[1], 0.015, 0.015, 0.5, 6); b.lathe("p_cloth", col("#e8d8b0"), st[0], 1.02, st[1], [[0.18, 0], [0.1, 0.2]], 12); b.sph("g", col("#ffe2b0"), st[0], 1.0, st[1], 0.05, 8); for (var k = 0; k < 4; k++) b.box("p_cloth", col(pick(R, ["#6e1f24", "#1f3b5a", "#2f4a3a", "#c9a24a"])), st[0] + 0.08, 0.6 + k * 0.04, st[1] + 0.05, 0.22, 0.035, 0.16, k * 0.3, 1, { ao: 0 });
    // the map table (the 1928 field plan under glass) and the book display table; the till
    var mxx = X(-1.0), mz = 0.4; K.table(mxx, mz, 1.8, 1.1, 0, { top: "#4a2e1a", leg: "#2a1a10", h: 0.88 }); var muv = K.sign(512, 320, function (X2, w, h) { X2.fillStyle = "#e8dcc0"; X2.fillRect(0, 0, w, h); var R2 = rng(1928); for (var i = 0; i < 400; i++) { X2.fillStyle = "rgba(120,90,50," + R2() * 0.08 + ")"; X2.fillRect(R2() * w, R2() * h, 3, 3); } X2.strokeStyle = "#5a4a3a"; X2.lineWidth = 1; for (var g = 0; g < w; g += 32) { X2.beginPath(); X2.moveTo(g, 0); X2.lineTo(g, h); X2.stroke(); } for (var g2 = 0; g2 < h; g2 += 32) { X2.beginPath(); X2.moveTo(0, g2); X2.lineTo(w, g2); X2.stroke(); } X2.strokeStyle = "#3a2a1a"; X2.lineWidth = 14; X2.beginPath(); X2.moveTo(60, 250); X2.lineTo(440, 80); X2.stroke(); X2.lineWidth = 2; X2.strokeStyle = "#8a2a26"; X2.strokeRect(120, 150, 70, 40); X2.strokeRect(330, 200, 90, 50); txt(X2, "DOUGLAS MUNICIPAL FIELD · 1928", w / 2, 26, SERIF, "italic 700", 22, "#3a2a1a", w - 40, {}); txt(X2, "RUNWAY", 260, 150, SERIF, "700", 16, "#3a2a1a", 120, {}); txt(X2, "HANGAR", 155, 200, SERIF, "400", 12, "#8a2a26", 90, {}); txt(X2, "N", w - 30, h - 30, SERIF, "700", 20, "#3a2a1a", 30, {}); });
    b.flat("s", [1, 1, 1], mxx, 0.885, mz, 1.6, 0.95, 0, muv); b.box("x", [1, 1, 1], mxx, 0.885, mz, 1.66, 0.01, 1.0, 0, 1, { ao: 0, no: "" }); b.cyl("p_brass", col("#c9a24a"), mxx + 0.6, 0.89, mz - 0.3, 0.05, 0.05, 0.03, 10);
    K.table(X(-1.0), 2.4, 1.4, 0.8, 0, { top: "#4a2e1a", leg: "#2a1a10" }); b.flat(bks, [1, 1, 1], X(-1.0), 0.765, 2.4, 1.3, 0.7, 0, panel(3, [0, 0.1, 1, 0.9]));
    K.counter(X(-2.2), -2.6, 2.0, 0, { body: "#4a2e1a", top: "#2a1a10" }); K.register(X(-1.6), 1.02, -2.7, 0);
    [-1.0, 1.9].forEach(function (x, i) { K.pendant(X(x), i ? 1.4 : 0.4, 2.9, { style: "dome", c: "#2f4a3a" }); }); K.pendant(X(-2.2), -2.3, 2.9, { style: "globe" }); K.door(X(-3.6), K.zb, 0, "OFFICE");
    K.disp.forEach(function (d) { for (var j = 0; j < 5; j++) b.box("p_cloth", col(pick(R, ["#6e1f24", "#1f3b5a", "#2f4a3a", "#c9a24a", "#e8dcc4"])), d.x - 0.7 + j * 0.35, d.y, d.z, 0.22, 0.3 + (j % 2) * 0.06, 0.05, PI + (j % 2) * 0.15, 1, { ao: 0.1 }); });
    castFor(K, [X(-2.2), -3.4, 0], [{ sit: 0.48, x: nx + X(0.7), z: nz - 0.2, face: Y(-0.5), back: 0.2 }, { walk: [[X(-3.5), -1.6, 6, Y(-HP)], [X(-1.0), 1.25, 4, PI], [X(3.4), -0.6, 5, Y(HP)]], x: X(-3.5), z: -1.6 }]); K.till = [X(-2.2), -3.4];
    K.infos = [{ x: mxx, z: mz, t: "The 1928 field plan", k: K.shopName, p: "A survey of Douglas Municipal Field as it was laid out in 1928: one long dirt runway, a hangar, a windsock and the road to town. The original is in the county archive; this copy lives under glass.", r: 1.6 }];
  } };

  // APOTHECARY (the apothecary, the pharmacies, the tobacconist, the optician): drawer walls, bottle shelves, the dispensing counter, show globes, an eye chart
  TR.apothecary = { sheets: ["apothecary"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, nm = K.ctx.name || "", optic = /optic/i.test(nm), tob = /tobacc/i.test(nm), as = smat("apothecary");
    K.pal = Object.assign(K.pal, { accent: "#1f3b5a", neon: "#8fd8ff", wood: "#4a2e1a", wood2: "#2a1a10", trim: "#2a1a10", signBg: "#141210" });
    shell(K, { floor: optic ? "concrete" : R() < 0.5 ? "hex" : "terra", floorTint: optic ? "#d0ccc4" : "#ffffff", wain: "bead", wainTint: optic ? "#e8e8e4" : "#3a2a20", upper: optic ? "plaster" : "damask", upperTint: optic ? "#eef0ee" : "#d8d0b8", ceil: "tin", ceilTint: "#e8e4d8", lamp: [0xfff0dc, 1.15], fill: 0.45 });
    K.backRun(-4.4, 4.4, 3.0, "apothecary", optic ? [2, 2, 2] : tob ? [3, 1, 3] : [1, 0, 1], { body: "#4a2e1a", unit: 2.9 }); K.board(0, 3.75, K.zb + 0.02, 3.4, 0.55, 0, "gold", K.sign1.title, K.sign1.sub);
    K.counter(0, -2.4, 4.0, 0, { body: "#4a2e1a", top: "#e8e4dc", topKey: "p_gloss", front: "panel" }); K.showcase(X(-3.2), -2.4, 1.6, 0, as, panel(optic ? 2 : 3), { body: "#4a2e1a", frame: "#c9a24a" }); K.register(X(1.4), 1.02, -2.5, 0);
    var sx = X(-0.6); b.cyl("p_brass", col("#c9a24a"), sx, 1.02, -2.45, 0.1, 0.12, 0.04, 14); b.beam("p_brass", col("#c9a24a"), [sx, 1.06, -2.45], [sx, 1.4, -2.45], 0.02); b.beam("p_brass", col("#c9a24a"), [sx - 0.25, 1.4, -2.45], [sx + 0.25, 1.4, -2.45], 0.015); [-0.25, 0.25].forEach(function (d) { b.lathe("p_brass", col("#d8b25a"), sx + d, 1.2, -2.45, [[0.001, 0], [0.09, 0.0], [0.1, 0.04]], 12); b.beam("p_brass", col("#c9a24a"), [sx + d, 1.24, -2.45], [sx + d, 1.4, -2.45], 0.004); });
    b.lathe("p_gloss", col("#f4f2ee"), X(0.4), 1.02, -2.4, [[0.08, 0], [0.11, 0.06], [0.12, 0.14], [0.13, 0.16]], 12); b.beam("p_gloss", col("#e8e4dc"), [X(0.4), 1.12, -2.4], [X(0.5), 1.3, -2.35], 0.03);
    K.sideRun(-mx, -1.4, 2.9, 2.5, "apothecary", optic ? [2, 2] : [0, 1], { body: "#4a2e1a", unit: 2.15 });
    if (optic) { var euv = K.sign(256, 384, function (X2, w, h) { X2.fillStyle = "#f8f8f4"; X2.fillRect(0, 0, w, h); ["E", "F P", "T O Z", "L P E D", "P E C F D", "E D F C Z P"].forEach(function (l, i) { txt(X2, l, w / 2, 40 + i * 58, GROT, "700", 64 - i * 9, "#1c1c1c", w - 20, { ls: 6 }); }); }); K.frame(X(K.xw), 1.8, 0.0, 0.8, 1.2, Y(-HP), "s", euv, "#2a2622"); K.chair(X(2.4), 0.0, Y(HP), { c: "#1c1c1c", cushion: "#1f3b5a" }); b.box("p_chrome", col("#f0f4f8"), X(K.xw - 0.05), 0.9, 2.2, 0.02, 1.6, 0.6, 0, 1, { ao: 0 }); }
    else { K.sideRun(mx, -1.4, 1.4, 2.5, "apothecary", tob ? [3] : [0], { body: "#4a2e1a", unit: 2.8 }); K.bench(X(3.4), 2.4, 1.4, Y(-HP), { c: "#3a2a20" }); }
    // show globes in the windows: tall glass carboys of coloured liquid, a lamp behind each
    K.disp.forEach(function (d, j) { var c = j ? "#2f8a5a" : "#c2181f"; b.lathe("x", [1, 1, 1], d.x, d.y, d.z, [[0.12, 0], [0.2, 0.08], [0.26, 0.3], [0.22, 0.5], [0.08, 0.62], [0.06, 0.8], [0.1, 0.84]], 16); b.lathe("g", col(c), d.x, d.y + 0.02, d.z, [[0.1, 0], [0.18, 0.08], [0.23, 0.3], [0.19, 0.48], [0.001, 0.5]], 14); b.cyl("p_brass", col("#c9a24a"), d.x, d.y - 0.01, d.z, 0.16, 0.18, 0.04, 14); K.bottles(d.x + 0.6, d.y, d.z, 0.5, 0, 3, "bottle", ["#5a3a14", "#1f3b5a"]); K.bottles(d.x - 0.6, d.y, d.z, 0.5, 0, 3, "bottle", ["#5a3a14", "#1f3b5a"]); });
    K.table(X(0.6), 0.8, 1.2, 0.7, 0, { top: "#4a2e1a", leg: "#2a1a10" }); K.bottles(X(0.6), 0.76, 0.8, 0.9, 0, 5, "jar", ["#c8b088", "#8a9a6a", "#a07050"]);
    [-1.6, 1.6].forEach(function (x) { K.pendant(X(x), -1.4, 3.0, { style: "globe" }); }); K.pendant(X(0.6), 0.8, 2.8, { style: "dome", c: "#1f3b5a" }); K.door(X(3.7), K.zb, 0, "DISPENSARY"); K.clock(X(-1.6), 3.35, K.zb + 0.1, 0);
    castFor(K, [X(0.0), -3.3, 0], [{ walk: [[X(-3.0), 0.2, 5, Y(-HP)], [X(0.6), 1.8, 3, PI], [X(2.8), -0.6, 4, Y(HP)]], x: X(-3.0), z: 0.2 }]); K.till = [X(0.0), -3.3];
    if (K.T.venue) K.shop = { x: X(1.4), z: -2.5, r: 1.6, venue: K.venueId, face: true, prompt: optic ? "try on eyewear" : "buy a tonic" };
    K.infos = [{ x: K.disp.length ? K.disp[0].x : 0, z: K.zf - 0.9, t: "Show globes", k: K.shopName, p: "Tall glass globes of coloured water in the window, lit from behind, were the sign of an apothecary for two hundred years: a traveller could find the shop at night from the end of the street.", r: 1.4 }];
  } };

  // FRONTIER OFFICES (post, telegraph, stage, claims, surveyor, the lot office, the box office, travel, luggage, the concierge): a counter with brass grilles, the wall behind, benches
  TR.office = { sheets: ["office"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, nm = K.ctx.name || "", os = smat("office"), modern = /lot office|travel|concierge|luggage/i.test(nm), post = /post/i.test(nm), tele = /telegraph/i.test(nm), land = /land|lot|surveyor/i.test(nm), box = /box office/i.test(nm), lug = /luggage/i.test(nm);
    K.pal = Object.assign(K.pal, { accent: "#1f3b5a", neon: "#ffcf6a", wood: modern ? "#9a7a5a" : "#5a3a22", wood2: "#2a1a10", trim: "#2a1a10", signBg: modern ? "#0a1610" : "#141210" });
    shell(K, { floor: modern ? "terra" : "oak", floorTint: modern ? "#ffffff" : "#8a6a50", wain: "bead", wainTint: modern ? "#c8b8a0" : "#3a2a20", upper: modern ? "plaster" : "stripe", upperTint: modern ? "#efe6d8" : "#d8ccb4", ceil: modern ? "beams" : "tin", ceilTint: "#d8ccb8", beam: "#5a3a22", lamp: [0xffe8cc, 1.15], fill: 0.45 });
    // the counter across the room with brass grilles over two windows, a ledge for writing
    var cz = -1.9; K.counter(0, cz, 6.4, 0, { body: K.pal.wood, top: "#2a1a10", front: "panel", h: 1.08 }); b.box(tex("grain"), col(K.pal.wood), 0, 1.08, cz - 0.15, 6.4, 1.2, 0.06, 0, 0.6, { ao: 0 }); K.solid(0, cz - 0.15, 6.4, 0.1, 0, 1.08, 2.3);
    [-1.6, 1.6].forEach(function (x, i) { var wx = X(x); b.box("p_satin", col("#141008"), wx, 1.12, cz - 0.12, 1.0, 1.05, 0.02, 0, 1, { ao: 0, no: "k" }); for (var g = 0; g < 9; g++) b.box("p_brass", col("#c9a24a"), wx - 0.44 + g * 0.11, 1.2, cz - 0.1, 0.014, 0.8, 0.014, 0, 1, { ao: 0 }); b.ring("p_brass", col("#c9a24a"), wx, 1.4, cz - 0.09, 0.3, 0.015, 14, 0, true); var uv = K.sign(256, 64, function (X2, w, h) { X2.fillStyle = "#141210"; X2.fillRect(0, 0, w, h); txt(X2, (box ? ["TICKETS", "WILL CALL"] : post ? ["STAMPS", "PARCELS"] : tele ? ["SEND", "RECEIVE"] : land ? ["CLAIMS", "PLATS"] : lug ? ["CHECK IN", "COLLECT"] : ["INFORMATION", "BOOKINGS"])[i], w / 2, h / 2 + 2, SERIF, "700", 30, "#e2b04a", w - 20, { gold: true, ls: 3 }); }); b.quad("s", [1, 1, 1], wx, 2.08, cz - 0.08, 0.9, 0.22, 0, uv); b.quad("x", [1, 1, 1], wx, 1.6, cz - 0.11, 0.98, 1.0, 0, [0, 0, 1, 1]); });
    // the wall behind: pigeonholes, the telegraph desk, maps and the transit, luggage racks; a big painted map or a show poster
    K.backRun(-4.4, 4.4, 2.8, "office", post ? [0, 0, 0] : tele ? [1, 0, 1] : land ? [2, 0, 2] : lug ? [3, 3, 3] : [0, 3, 2], { body: "#4a2e1a", unit: 2.9 }); K.board(0, 3.75, K.zb + 0.02, 3.6, 0.55, 0, modern ? "modern" : "gold", K.sign1.title, K.sign1.sub);
    if (tele) { var tx = X(2.6), tz = -3.4; b.box(tex("grain"), col("#5a3a22"), tx, 0, tz, 1.4, 0.78, 0.7, 0, 0.6, { ao: 0.3 }); b.box("p_brass", col("#c9a24a"), tx - 0.2, 0.78, tz, 0.16, 0.04, 0.08, 0, 1, { ao: 0 }); b.beam("p_brass", col("#c9a24a"), [tx - 0.24, 0.84, tz], [tx - 0.12, 0.84, tz], 0.012); b.box("p_metal", col("#2a2622"), tx + 0.3, 0.78, tz, 0.22, 0.14, 0.12, 0, 1, { ao: 0 }); K.chair(tx, tz + 0.6, PI, { c: "#3a2416" }); K.solid(tx, tz, 1.4, 0.7, 0, 0, 0.82); }
    if (land) { var mapuv = K.sign(512, 320, function (X2, w, h) { X2.fillStyle = "#e8dcc0"; X2.fillRect(0, 0, w, h); X2.strokeStyle = "#8a6a40"; X2.lineWidth = 1; for (var i = 0; i < 12; i++) for (var j = 0; j < 7; j++) X2.strokeRect(20 + i * 39, 30 + j * 40, 39, 40); X2.strokeStyle = "#2a1a10"; X2.lineWidth = 3; X2.beginPath(); X2.moveTo(20, 290); X2.bezierCurveTo(160, 220, 300, 260, 490, 120); X2.stroke(); txt(X2, "TOWNSITE OF DOUGLAS · LOTS AND CLAIMS", w / 2, 16, SERIF, "italic 700", 18, "#2a1a10", w - 30, {}); X2.fillStyle = "rgba(77,222,111,0.25)"; X2.fillRect(254, 110, 117, 80); }); K.frame(X(-K.xw), 2.1, 0.8, 2.2, 1.4, Y(HP), "s", mapuv, "#2a1a10"); var tx2 = X(2.8), tz2 = 1.2; [0, 2.1, 4.2].forEach(function (a) { b.beam(tex("grain"), col("#8a6a40"), [tx2, 1.35, tz2], [tx2 + Math.sin(a) * 0.4, 0.02, tz2 + Math.cos(a) * 0.4], 0.03); }); b.cyl("p_brass", col("#c9a24a"), tx2, 1.35, tz2, 0.06, 0.06, 0.1, 10); b.beam("p_brass", col("#c9a24a"), [tx2 - 0.15, 1.5, tz2], [tx2 + 0.15, 1.5, tz2], 0.05); K.solid(tx2, tz2, 0.8, 0.8, 0, 0, 1.6); }
    else if (box) { ["rodeo", "fair", "flyin"].forEach(function (k, i) { K.poster(X(-K.xw), 2.0, -0.6 + i * 1.1, 0.75, 1.05, Y(HP), k); }); }
    else if (lug) { for (var s = 0; s < 6; s++) b.box("p_satin", col(pick(R, ["#5a3a22", "#2a1a10", "#8a6a48", "#6e1f24"])), X(-3.6) + (s % 2) * 0.1, Math.floor(s / 2) * 0.32, 1.2 + (s % 2) * 0.5, 0.7, 0.3, 0.45, (s % 3) * 0.1, 1, { ao: 0.2 }); K.solid(X(-3.6), 1.45, 0.9, 1.1, 0, 0, 1.0); var cx = X(2.6), cz2 = 1.6; b.box("p_brass", col("#c9a24a"), cx, 0.2, cz2, 1.0, 0.04, 0.6, 0, 1, { ao: 0 }); [-0.45, 0.45].forEach(function (d) { b.beam("p_brass", col("#c9a24a"), [cx + d, 0.2, cz2 - 0.25], [cx + d, 1.1, cz2 - 0.25], 0.025); b.ring("p_satin", col("#1c1c1c"), cx + d, 0.12, cz2 + 0.2, 0.1, 0.03, 10, HP, true); }); for (var t2 = 0; t2 < 3; t2++) b.box("p_satin", col(pick(R, ["#5a3a22", "#8a6a48", "#1f3b5a"])), cx, 0.24 + t2 * 0.25, cz2, 0.8, 0.24, 0.45, 0, 1, { ao: 0.1 }); K.solid(cx, cz2, 1.1, 0.7, 0, 0, 1.1); }
    else { K.poster(X(-K.xw), 2.2, -0.2, 0.8, 1.1, Y(HP), post ? "airmail" : "airfield"); K.poster(X(-K.xw), 2.2, 1.2, 0.8, 1.1, Y(HP), modern ? "flyin" : "route"); }
    // the public side: benches to wait on, a writing ledge, a wall clock, a stove for the old offices
    K.bench(X(-4.2), 0.4, 2.0, Y(HP), { c: K.pal.wood }); if (!lug && !land) K.bench(X(4.2), 0.4, 2.0, Y(-HP), { c: K.pal.wood }); var lx = X(1.6), lz = 2.2; b.box(tex("grain"), col(K.pal.wood), lx, 0, lz, 1.4, 1.1, 0.5, 0, 0.6, { ao: 0.3 }); b.box(tex("grain"), col("#2a1a10"), lx, 1.1, lz, 1.5, 0.04, 0.6, 0.0, 0.6, { ao: 0, no: "" }); b.cyl("p_gloss", col("#1c1c1c"), lx - 0.5, 1.14, lz, 0.03, 0.035, 0.05, 8); b.beam("p_metal", col("#2a2a2a"), [lx - 0.5, 1.19, lz], [lx - 0.45, 1.32, lz + 0.05], 0.005); K.solid(lx, lz, 1.5, 0.6, 0, 0, 1.15);
    K.clock(0, 3.2, cz - 0.12, 0); if (!modern) stove(K, X(-3.4), 2.6); [-1.6, 1.6].forEach(function (x) { K.pendant(X(x), 0.6, 2.9, { style: modern ? "cone" : "globe", c: "#2a2a2a" }); }); K.pendant(0, -3.0, 2.9, { style: "dome", c: "#1f3b5a" });
    K.disp.forEach(function (d) { b.box("p_satin", col("#1f3b5a"), d.x, d.y, d.z, 0.5, 0.5, 0.35, 0, 1, { ao: 0.1 }); b.box("p_satin", col("#c2181f"), d.x - 0.04, d.y + 0.5, d.z, 0.42, 0.04, 0.3, 0, 1, { ao: 0 }); K.bottles(d.x + 0.6, d.y, d.z, 0.4, 0, 2, "bottle", ["#1f3b5a"]); });
    castFor(K, [X(-1.6), cz - 0.9, 0], [{ walk: [[X(1.6), cz + 0.8, 6, PI], [X(1.2), 1.6, 4, 0], [X(-2.6), 1.0, 4, Y(-HP)]], x: X(1.6), z: cz + 0.8 }]); K.till = [X(-1.6), cz - 0.9];
    K.infos = [{ x: X(1.6), z: cz + 0.4, t: K.shopName, k: K.sign1.sub || "Heritage Main Street", p: box ? "Tickets for the Opera House: tonight's revue, the matinee and the Sunday concert. Will call at the second window." : post ? "The post office of a border town: letters by stage and rail, then by air mail when the first mail planes landed at the field in the late 1920s. The pigeonholes are still sorted by street." : tele ? "Wires went out to Tucson, El Paso and the world from this desk. The sounder clicks, the clerk writes it out, a boy on a bicycle runs it to the door." : land ? "Every lot, claim and boundary in the valley passed across this counter: the plats on the wall, the transit by the window, the ledger in the safe." : modern ? "Directions, bookings, luggage and a friendly word for anyone arriving at Genesis One. Ask at either window." : "Stage lines and freight, once the lifeline between the border towns and the railroad.", r: 1.6 }];
  } };

  // THE SHERIFF'S OFFICE: the cell with its bars, the desk, a rack of keys, wanted posters, the coffee pot on the stove
  TR.sheriff = { sheets: [], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R;
    K.pal = Object.assign(K.pal, { accent: "#8a2a26", neon: "#ffcf6a", wood: "#5a3a22", wood2: "#2a1a10", trim: "#2a1a10", signBg: "#141210" });
    shell(K, { floor: "barn", floorTint: "#8a6a50", wain: "bead", wainTint: "#3a2a20", upper: "plaster", upperTint: "#d8c8a8", ceil: "beams", ceilTint: "#b8a080", beam: "#3a2416", lamp: [0xffd8a8, 1.05], fill: 0.4, sky: 0.25 });
    // the cell: iron bars on two sides, a door ajar, a cot and a bucket
    var cx0 = X(1.4), cx1 = X(4.6), cz0 = -4.6, cz1 = -2.2; for (var i = 0; i <= 16; i++) { var x = cx0 + (cx1 - cx0) * i / 16; if (i > 3 && i < 7) continue; b.box("p_metal", col("#2a2622"), x, 0, cz1, 0.035, 2.6, 0.035, 0, 1, { ao: 0 }); } b.beam("p_metal", col("#2a2622"), [cx0, 2.6, cz1], [cx1, 2.6, cz1], 0.06); b.beam("p_metal", col("#2a2622"), [cx0, 0.1, cz1], [cx1, 0.1, cz1], 0.05); b.beam("p_metal", col("#2a2622"), [cx0, 1.3, cz1], [cx1, 1.3, cz1], 0.03);
    for (var j = 0; j <= 10; j++) b.box("p_metal", col("#2a2622"), cx0, 0, cz0 + (cz1 - cz0) * j / 10, 0.035, 2.6, 0.035, 0, 1, { ao: 0 }); b.beam("p_metal", col("#2a2622"), [cx0, 2.6, cz0], [cx0, 2.6, cz1], 0.06);
    var dx0 = cx0 + (cx1 - cx0) * 4 / 16; for (var d = 0; d < 4; d++) b.box("p_metal", col("#2a2622"), dx0 + Math.cos(Y(0.9)) * d * 0.2 * mx, 0, cz1 + Math.sin(0.9) * d * 0.2, 0.035, 2.5, 0.035, 0, 1, { ao: 0 }); K.solid((cx0 + cx1) / 2, cz1, Math.abs(cx1 - cx0), 0.1, 0, 0, 2.6); K.solid(cx0, (cz0 + cz1) / 2, 0.1, Math.abs(cz1 - cz0), 0, 0, 2.6);
    var cotx = X(3.6), cotz = -4.1; b.box(tex("grain"), col("#4a2e1a"), cotx, 0.3, cotz, 1.8, 0.1, 0.7, 0, 0.6, { ao: 0 }); b.box("p_cloth", col("#6a6a5a"), cotx, 0.4, cotz, 1.7, 0.08, 0.62, 0, 1, { ao: 0 }); [[-0.85, -0.3], [0.85, -0.3], [-0.85, 0.3], [0.85, 0.3]].forEach(function (p) { b.box("p_metal", col("#2a2622"), cotx + p[0], 0, cotz + p[1], 0.04, 0.3, 0.04, 0, 1, { ao: 0 }); });
    // the desk with a chair, a lamp and a ledger; wanted posters; a key rack; the stove and the coffee pot
    var dkx = X(-1.6), dkz = -2.6; b.box(tex("grain"), col("#5a3a22"), dkx, 0, dkz, 1.8, 0.78, 0.9, 0, 0.6, { ao: 0.3 }); b.box(tex("grain"), col("#3a2416"), dkx, 0.78, dkz, 1.9, 0.04, 1.0, 0, 0.6, { ao: 0, no: "" }); K.solid(dkx, dkz, 1.9, 1.0, 0, 0, 0.82); K.chair(dkx, dkz - 0.8, 0, { c: "#3a2416" }); b.cyl("p_brass", col("#c9a24a"), dkx + 0.6, 0.82, dkz - 0.2, 0.08, 0.1, 0.03, 10); b.lathe("g", col("#ffd8a0"), dkx + 0.6, 0.85, dkz - 0.2, [[0.05, 0], [0.07, 0.08], [0.04, 0.2]], 10); b.box("p_cloth", col("#6e1f24"), dkx - 0.3, 0.82, dkz, 0.4, 0.04, 0.3, 0.2, 1, { ao: 0 });
    var outlaws = [["DUSTY PETE", "HORSE THIEF"], ["ONE-EAR MCGEE", "CATTLE RUSTLING"], ["THE BISBEE KID", "TRAIN ROBBERY"], ["CALAMITY JO", "CARD SHARP"], ["SNAKE OIL SAM", "SWINDLES"], ["BLACK HAT BILL", "BANK ROBBERY"]];
    outlaws.forEach(function (o, i) { var uv = K.sign(180, 240, function (X2, w, h) { X2.fillStyle = "#e8d8b0"; X2.fillRect(0, 0, w, h); var R2 = rng(i * 17 + 3); for (var k = 0; k < 300; k++) { X2.fillStyle = "rgba(110,80,40," + R2() * 0.12 + ")"; X2.fillRect(R2() * w, R2() * h, 3, 3); } txt(X2, "WANTED", w / 2, 28, SERIF, "900", 34, "#2a1a10", w - 16, { ls: 2 }); X2.fillStyle = "#3a2a1a"; X2.beginPath(); X2.ellipse(w / 2, 105, 34, 42, 0, 0, TAU); X2.fill(); X2.fillRect(w / 2 - 50, 60, 100, 14); X2.fillRect(w / 2 - 30, 40, 60, 26); X2.fillStyle = "#e8d8b0"; X2.fillRect(w / 2 - 18, 100, 8, 4); X2.fillRect(w / 2 + 10, 100, 8, 4); txt(X2, o[0], w / 2, 170, SERIF, "700", 18, "#2a1a10", w - 16, {}); txt(X2, "FOR " + o[1], w / 2, 194, SERIF, "italic 400", 12, "#5a3a20", w - 16, {}); txt(X2, "REWARD", w / 2, 222, SERIF, "900", 20, "#8a2a26", w - 16, { ls: 3 }); });
      var z = -1.4 + (i % 3) * 0.75, y = 1.9 + Math.floor(i / 3) * 0.7; b.quad("s", [1, 1, 1], X(-K.xw + 0.02), y, z, 0.45, 0.6, Y(HP) + (i % 2 ? 0.04 : -0.03), uv); });
    b.box(tex("grain"), col("#3a2416"), X(-K.xw + 0.03), 1.4, 1.4, 0.04, 0.2, 0.9, 0, 0.6, { ao: 0 }); for (var k = 0; k < 6; k++) { b.beam("p_brass", col("#c9a24a"), [X(-K.xw + 0.05), 1.5, 1.0 + k * 0.15], [X(-K.xw + 0.1), 1.48, 1.0 + k * 0.15], 0.01); b.ring("p_brass", col("#c9a24a"), X(-K.xw + 0.1), 1.38, 1.0 + k * 0.15, 0.04, 0.008, 8, Y(HP), true); }
    stove(K, X(-3.6), 2.6); K.bench(X(4.2), 0.8, 2.2, Y(-HP), { c: "#4a2e1a" }); K.board(X(-1.6), 3.75, K.zb + 0.02, 3.0, 0.55, 0, "wood", K.sign1.title, K.sign1.sub); K.clock(X(-3.4), 3.2, K.zb, 0); K.door(X(-3.6), K.zb, 0, "MARSHAL");
    var star = K.sign(128, 128, function (X2, w, h) { X2.clearRect(0, 0, w, h); X2.fillStyle = "#d8b25a"; X2.beginPath(); for (var p = 0; p < 10; p++) { var a = p / 10 * TAU - PI / 2, r = p % 2 ? 26 : 60; X2.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r); } X2.closePath(); X2.fill(); X2.strokeStyle = "#8a6a20"; X2.lineWidth = 3; X2.stroke(); txt(X2, "SHERIFF", w / 2, h / 2 + 2, SERIF, "900", 16, "#5a3a10", 80, {}); });
    K.frame(X(-1.6), 2.4, K.zb, 0.5, 0.5, 0, "s", star, "#2a1a10"); [-1.6, 1.4].forEach(function (x) { K.pendant(X(x), x < 0 ? -2.4 : 0.6, 2.8, { style: "lantern" }); }); K.pendant(X(3.0), -3.4, 2.6, { style: "bulb" });
    K.disp.forEach(function (d) { K.crate(d.x, d.y, d.z, 0.5, 0.4, 0.4, 0, "#8a6a48"); K.hat(d.x, d.y + 0.42, d.z, "#2a1a10", "cowboy"); });
    castFor(K, [dkx + X(1.2), dkz + 0.9, PI], []); K.cast[0].hat = "hat_cowboy"; K.till = [K.cast[0].x, K.cast[0].z];
    K.infos = [{ x: (cx0 + cx1) / 2, z: cz1 + 0.6, t: "The cell", k: K.shopName, p: "A strap iron cell bolted into the floor, a cot and a window too small to climb through. These days the door stays open and the only prisoner is the deputy's coffee pot.", r: 1.6 }];
  } };

  // THE MUSEUMS (the gunsmith, the undertaker, the dentist): the period room behind a velvet rope, cases with placards, a docent
  TR.museum = { sheets: ["museum"], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b, R = K.R, nm = K.ctx.name || "", gun = /gun/i.test(nm), und = /undertak/i.test(nm), dent = /dent/i.test(nm), ms = smat("museum");
    K.pal = Object.assign(K.pal, { accent: "#6e1f24", neon: "#ffcf6a", wood: "#4a2e1a", wood2: "#2a1a10", trim: "#2a1a10", signBg: "#141210" });
    shell(K, { floor: "oak", floorTint: "#7a5a40", wain: "bead", wainTint: und ? "#1c1c24" : "#3a2a20", upper: "damask", upperTint: und ? "#7a7080" : "#c8b8a0", ceil: "tin", ceilTint: "#c8c0b0", lamp: [0xffe0b8, 1.0], fill: 0.4, sky: 0.22 });
    // the period room (back half) behind stanchions and a rope
    var rz = -1.1; for (var s = 0; s < 6; s++) { var x = -3.6 + s * 1.44; b.cyl("p_brass", col("#c9a24a"), x, 0, rz, 0.13, 0.15, 0.05, 12); b.cyl("p_brass", col("#c9a24a"), x, 0.05, rz, 0.025, 0.025, 0.9, 8, { open: true }); b.sph("p_brass", col("#d8b25a"), x, 0.97, rz, 0.04, 8); if (s < 5) { for (var k = 0; k < 8; k++) { var t0 = k / 8, t1 = (k + 1) / 8; b.beam("p_cloth", col("#8a1c24"), [x + t0 * 1.44, 0.92 - Math.sin(t0 * PI) * 0.12, rz], [x + t1 * 1.44, 0.92 - Math.sin(t1 * PI) * 0.12, rz], 0.035); } } } K.solid(0, rz, 7.6, 0.12, 0, 0, 1.0);
    if (dent) { var dx = X(-0.4), dz = -2.8; barberChair(K, dx, dz, 0, "#5a2a1c"); b.box("p_chrome", col("#c8ccd0"), dx + X(0.8), 0, dz - 0.2, 0.08, 1.2, 0.08, 0, 1, { ao: 0 }); b.beam("p_chrome", col("#c8ccd0"), [dx + X(0.8), 1.2, dz - 0.2], [dx + X(0.4), 1.4, dz + 0.1], 0.03); b.cyl("p_gloss", col("#f4f2ee"), dx + X(0.4), 1.25, dz + 0.1, 0.1, 0.12, 0.15, 12); b.lathe("p_gloss", col("#f4f2ee"), dx + X(-0.8), 0, dz, [[0.1, 0], [0.12, 0.6], [0.2, 0.9], [0.22, 0.95]], 14); K.showcase(X(2.8), -2.6, 1.4, 0, ms, panel(0), { body: "#4a2e1a" }); }
    else if (und) { var ux = X(0.0), uz = -3.0; b.box(tex("grain"), col("#3a1e10"), ux, 0.6, uz, 2.0, 0.5, 0.65, 0, 0.6, { ao: 0.2 }); b.box("p_gloss", col("#2a1810"), ux, 1.1, uz, 2.0, 0.08, 0.65, 0, 1, { ao: 0, no: "" }); b.box("p_cloth", col("#f4f2ee"), ux, 1.18, uz, 0.9, 0.02, 0.7, 0, 1, { ao: 0 }); [[-0.9, -0.25], [0.9, -0.25], [-0.9, 0.25], [0.9, 0.25]].forEach(function (p) { b.box(tex("grain"), col("#2a1810"), ux + p[0], 0, uz + p[1], 0.06, 0.6, 0.06, 0, 0.6, { ao: 0 }); }); [-1.3, 1.3].forEach(function (s2) { b.cyl("p_brass", col("#c9a24a"), ux + s2, 0, uz, 0.12, 0.14, 0.05, 12); b.cyl("p_brass", col("#c9a24a"), ux + s2, 0.05, uz, 0.02, 0.02, 1.3, 8, { open: true }); b.cyl("p_gloss", col("#f4ecd6"), ux + s2, 1.35, uz, 0.03, 0.03, 0.22, 8); b.sph("g", col("#ffd890"), ux + s2, 1.6, uz, 0.025, 6); }); b.ring("p_cloth", col("#2f4a3a"), ux, 2.4, K.zb + 0.1, 0.35, 0.08, 16, 0, true); K.frame(X(-2.8), 2.0, K.zb, 1.0, 1.0, 0, ms, panel(2)); }
    else { var gx = X(-0.2), gz = -3.4; b.box(tex("grain"), col("#5a3a22"), gx, 0, gz, 2.4, 0.9, 0.8, 0, 0.6, { ao: 0.3 }); b.box("p_metal", col("#3a3a3a"), gx - 0.8, 0.9, gz, 0.2, 0.2, 0.16, 0, 1, { ao: 0 }); for (var st2 = 0; st2 < 4; st2++) b.beam(tex("grain"), col("#8a5a32"), [gx - 0.4 + st2 * 0.3, 0.92, gz - 0.2], [gx - 0.2 + st2 * 0.3, 0.94, gz + 0.25], 0.06, 0.03); K.frame(gx, 2.1, K.zb, 1.6, 1.2, 0, ms, panel(1)); b.cyl("p_metal", col("#2a2622"), X(2.6), 0, -3.4, 0.25, 0.3, 0.9, 14, { top: col("#4a4a4a") }); b.box("p_metal", col("#3a3a3a"), X(2.6), 0.9, -3.4, 0.6, 0.15, 0.2, 0.3, 1, { ao: 0 }); }
    K.solid(0, -3.0, 8.6, 3.2, 0, 0, 2.2);
    // display cases along the walls with placards, framed airfield photographs, a bench
    var plac = function (x, z, ry, title, body) { var uv = K.sign(320, 160, function (X2, w, h) { X2.fillStyle = "#f2e8d2"; X2.fillRect(0, 0, w, h); frameIn(X2, w, h, "#6e1f24", 3, 6); txt(X2, title, w / 2, 30, SERIF, "700", 22, "#2a1a10", w - 30, {}); var words = body.split(" "), line = "", y = 66; X2.font = "400 15px " + SERIF; X2.fillStyle = "#3a2a1a"; X2.textAlign = "left"; words.forEach(function (wd) { var t = line ? line + " " + wd : wd; if (X2.measureText(t).width > w - 40) { X2.fillText(line, 20, y); line = wd; y += 20; } else line = t; }); if (line) X2.fillText(line, 20, y); }); var p = off(x, z, ry, 0, 0.0); b.box(tex("grain"), col("#4a2e1a"), p[0], 0, p[1], 0.5, 1.0, 0.36, ry, 0.6, { ao: 0.2 }); var q = off(x, z, ry, 0, 0.1); var g = b.a("s"); var c = Math.cos(ry), sn = Math.sin(ry); var P = [[-0.22, 1.0, 0.18], [0.22, 1.0, 0.18], [0.22, 1.12, -0.05], [-0.22, 1.12, -0.05]].map(function (v) { return [x + v[0] * c + v[2] * sn, v[1], z - v[0] * sn + v[2] * c]; }); var U = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]]; [0, 1, 2, 0, 2, 3].forEach(function (k2) { g.p.push(P[k2][0], P[k2][1], P[k2][2]); g.n.push(sn * 0.6, 0.8, c * 0.6); g.u.push(U[k2][0], U[k2][1]); g.c.push(1, 1, 1); }); K.solid(x, z, 0.5, 0.4, ry, 0, 1.15); };
    K.showcase(X(-3.9), 0.6, 1.6, Y(HP), ms, panel(dent ? 0 : und ? 2 : 1), { body: "#4a2e1a" }); K.showcase(X(3.9), 0.4, 1.6, Y(-HP), ms, panel(3), { body: "#4a2e1a" });
    plac(X(-1.8), 0.0, PI * 0 + 0, dent ? "The Painless Parlour" : und ? "The Undertaker's Parlour" : "The Gunsmith's Bench", dent ? "Chair, spittoon and drill as they were in a Main Street dental parlour around 1900. The drill was driven by a foot treadle." : und ? "Main Street's undertaker was also its cabinet maker. Families sat here to choose a casket of mesquite or pine." : "Stocks were carved from walnut blanks on this bench. Most work was repair: springs, sights and the odd broken hammer.");
    plac(X(1.8), 0.0, 0, "Douglas Field, 1928", "Photographs from the first years of the airfield, found in a box in a hangar attic and lent by the families who flew from it.");
    for (var f = 0; f < 4; f++) K.frame(X(K.xw), 2.0 + (f % 2) * 0.0, 1.4 + (f < 2 ? 0 : 1.2) - (f % 2) * 0.6, 0.55, 0.42, Y(-HP), ms, panel(3, [(f % 2) * 0.5, 0.5 - Math.floor(f / 2) * 0.5, (f % 2) * 0.5 + 0.5, 1 - Math.floor(f / 2) * 0.5]), "#2a1a10");
    K.bench(X(-1.2), 2.4, 1.6, PI, { c: "#4a2e1a" }); K.board(0, 3.75, K.zb + 0.02, 3.4, 0.55, 0, "gold", K.sign1.title, "Heritage Main Street"); [-2.0, 0, 2.0].forEach(function (x) { K.pendant(X(x), -2.2, 3.0, { style: "globe" }); }); K.clock(X(3.4), 3.3, K.zb + 0.1, 0);
    K.disp.forEach(function (d) { b.box("p_cloth", col("#6e1f24"), d.x, d.y, d.z, d.w, 0.02, 0.5, 0, 1, { ao: 0 }); K.frame(d.x, d.y + 0.6, d.z + 0.1, 0.7, 0.55, PI, ms, panel(3, [0, 0.5, 0.5, 1])); });
    castFor(K, [X(2.6), 1.4, Y(-2.2)], [{ walk: [[X(-2.4), -0.3, 6, PI], [X(0.4), -0.4, 6, PI], [X(2.6), 0.9, 4, Y(-HP)]], x: X(-2.4), z: -0.3 }]); K.till = [X(2.6), 1.4];
    K.infos = [{ x: 0, z: -0.4, t: K.shopName, k: "Heritage Main Street", p: dent ? "A frontier dentist's parlour: the chair, the foot treadle drill, the instruments in their velvet case. Visitors may look but not sit." : und ? "The parlour of Main Street's undertaker and cabinet maker, set up as it stood around 1900, with the candle stands and the mourning wreath." : "The gunsmith's workshop as it stood on Main Street: the bench, the vise, the stock blanks and the files. Repairs, not weapons, were most of the trade.", r: 2.2 }];
  } };

  // THE PARK HOUSE (restrooms): tile, stalls with doors, sinks and mirrors, a bench, the lost and found
  TR.restroom = { sheets: [], build: function (K) {
    var mx = K.mx, X = function (v) { return v * mx; }, Y = function (r) { return r * mx; }, b = K.b;
    K.pal = Object.assign(K.pal, { accent: "#2f6a8a", neon: "#8fd8ff", wood: "#9a7a5a", wood2: "#2a2a2a", trim: "#3a4a52", signBg: "#1f3b5a" });
    shell(K, { floor: "hex", floorTint: "#ffffff", wain: "tile", wainTint: "#e8f0f2", wainH: 1.5, upper: "plaster", upperTint: "#eef2f0", ceil: "plaster", ceilTint: "#f4f6f6", lamp: [0xf4f8ff, 1.3], fill: 0.6 });
    for (var s = 0; s < 3; s++) { var z = -3.9 + s * 1.25, pc = col("#7aa8b8"); b.box("p_gloss", pc, X(2.9), 0.18, z - 0.62, 2.8, 1.75, 0.04, 0, 1, { ao: 0 }); if (s === 2) b.box("p_gloss", pc, X(2.9), 0.18, z + 0.62, 2.8, 1.75, 0.04, 0, 1, { ao: 0 });
      b.box("p_gloss", pc, X(1.52), 0.18, z - 0.42, 0.04, 1.75, 0.4, 0, 1, { ao: 0 }); var dsw = Y(s === 1 ? 0.3 : 1.3); var dp = off(X(1.52), z + 0.2, dsw, 0, 0); b.box("p_gloss", mulc(pc, 1.08), X(1.52) + Math.sin(dsw) * 0.4 * mx, 0.18, z - 0.2 + Math.cos(dsw) * 0.4, 0.03, 1.7, 0.8, dsw, 1, { ao: 0 }); b.box("p_chrome", col("#c8ccd0"), X(1.52), 0.15, z - 0.62, 0.04, 2.0, 0.04, 0, 1, { ao: 0 });
      b.lathe("p_gloss", col("#f4f6f6"), X(4.1), 0, z, [[0.12, 0], [0.16, 0.25], [0.2, 0.4], [0.18, 0.42]], 14); b.box("p_gloss", col("#f4f6f6"), X(4.45), 0.42, z, 0.18, 0.34, 0.38, 0, 1, { ao: 0 }); K.solid(X(2.9), z - 0.62, 2.85, 0.08, 0, 0, 2.0); K.solid(X(3.2), z, 2.4, 1.1, 0, 0, 2.0); }
    for (var dd = 0; dd < 3; dd++) b.box("p_chrome", col("#c8ccd0"), X(1.52), 1.93, -3.9 + dd * 1.25, 0.04, 0.04, 1.25, 0, 1, { ao: 0 });
    for (var k = 0; k < 3; k++) { var x = X(-3.4 + k * 1.0); b.box("p_gloss", col("#f4f6f6"), x, 0.8, K.zb + 0.25, 0.6, 0.12, 0.45, 0, 1, { ao: 0.1 }); b.cyl("p_chrome", col("#e8ecf0"), x, 0.92, K.zb + 0.1, 0.02, 0.02, 0.18, 8); b.beam("p_chrome", col("#e8ecf0"), [x, 1.08, K.zb + 0.1], [x, 1.08, K.zb + 0.24], 0.018); b.box("p_chrome", col("#f0f4f8"), x, 1.25, K.zb + 0.03, 0.55, 0.75, 0.01, 0, 1, { ao: 0 }); b.box("p_satin", col("#2a2a2a"), x, 0, K.zb + 0.25, 0.08, 0.8, 0.08, 0, 1, { ao: 0 }); } K.solid(X(-2.4), K.zb + 0.25, 3.2, 0.5, 0, 0, 1.0);
    K.bench(X(-4.2), 0.4, 1.8, Y(HP), { c: "#9a7a5a" }); K.counter(X(-1.6), 2.2, 1.6, Y(HP + PI), { body: "#3a4a52", top: "#e8ecf0", topKey: "p_gloss", h: 1.0 }); b.box("p_cloth", col("#c2181f"), X(-1.6), 1.0, 2.2, 0.3, 0.2, 0.3, 0.2, 1, { ao: 0 }); K.board(X(-2.0), 3.6, K.zb + 0.02, 2.8, 0.5, 0, "enamel", K.sign1.title, K.sign1.sub);
    [-1.6, 1.4].forEach(function (x) { K.pendant(X(x), -0.6, 3.0, { style: "globe" }); }); K.plant(X(-4.0), 2.6, 1.1, "grass");
    castFor(K, [X(-2.4), 2.2, Y(-HP)], []); K.till = [X(-2.4), 2.2];
    K.infos = [{ x: X(-1.6), z: 2.2, t: "Lost and found", k: K.shopName, p: "Sunglasses, a single boot, three hats and a model biplane, all waiting at the counter. Ask the park keeper if something of yours went missing at the park.", r: 1.6 }];
  } };

  // ───────────────────────── the street side: every shop's own name on its false front ─────────────────────────
  // The store model has a blank board above the porch roof (local z 3.2, y 3.45 to 4.25) and the streamline storefront a plain
  // band over its glass blocks (z 5.25, y 4.4 to 5.2): each gets a painted sign with the shop's plan.json name in its trade's
  // style. All of them are one canvas (5 x 28 slots) and two merged meshes (the boards, the lettering), lit like the walls.
  // Hidden while you are inside a shop (the room's box reaches past the false front).
  var FAC = RS.facade = RS.facade || { built: false, n: 0, meshes: [] };
  var FAC_STYLE = { soda: "neon", candy: "gold", coffee: "modern", bakery: "wood", diner: "neon", tavern: "wood", market: "wood", gift: "gold", outfit: "wood", giveback: "modern", hats: "gold", leather: "wood", smithy: "wood", hardware: "enamel", mercantile: "wood", garden: "wood", toys: "enamel", gallery: "modern", photo: "gold", bikes: "enamel", records: "neon", barber: "gold", makers: "wood", books: "gold", apothecary: "gold", office: "gold", sheriff: "wood", museum: "gold", restroom: "enamel", stall: "neon" };
  var FAC_PAL = { neon: { signBg: "#121212", neon: "#ff5a8a" }, gold: { signBg: "#141210" }, modern: { signBg: "#0a1610", signFg: "#f5f1e6", neon: "#4DDE6F" }, wood: { signBg: "#4a3220", signFg: "#f2dfae" }, enamel: { signBg: "#a3262a" } };
  function facade() {
    if (FAC.built || C("facade", true) === false || typeof PLACE === "undefined" || !MODELS.store) return; FAC.built = true; base();
    var low = lowTier(), SW = low ? 160 : 288, SH = low ? 30 : 54, COLS = 5, ROWS = 28, A = new Atlas(SW * COLS + 8, SH * ROWS + 30), bd = new Bt(), tx = new Bt(), n = 0;
    var neonCols = ["#ff5a8a", "#6ad0ff", "#7dff9a", "#ffb36a", "#b48cff"];
    var spec = { store: { x: 0.14, y: 3.86, z: 3.2, w: 3.5, h: 0.62, ry: 0.0765 }, storefront_sl: { x: 0, y: 4.78, z: 5.27, w: 3.6, h: 0.6, ry: 0 } };
    ["store", "storefront_sl"].forEach(function (kind) { var L = PLACE[kind], S = spec[kind]; if (!L || !MODELS[kind]) return;
      for (var i = 0; i < L.length; i++) { var e = L[i], info = PLAN_ROOMS.info({ kind: kind, i: i, e: e }); var nm = info.name; if (!nm) continue; var tk = tradeKey(nm); if (!tk) continue;
        var sc = e[4] || 1, sn = signName(nm), shopC = C("shops." + nm, {}) || {}, title = shopC.title || sn.title, style = FAC_STYLE[tk] || "wood"; if (/park house restroom/i.test(nm)) title = "Park House";
        var pal = Object.assign({}, FAC_PAL[style] || {}); if (style === "neon") pal.neon = neonCols[hash(nm) % neonCols.length];
        var uv = A.slot(SW, SH, boardDraw(style, title, null, pal)); var c = Math.cos(e[3]), s = Math.sin(e[3]); var lx = S.x * sc, lz = S.z * sc + 0.035; var wx = e[0] + lx * c + lz * s, wz = e[2] - lx * s + lz * c, ry = e[3] + S.ry;
        var bx = e[0] + lx * c + (lz - 0.03) * s, bz = e[2] - lx * s + (lz - 0.03) * c; bd.box("p_satin", col(style === "neon" ? "#151515" : style === "enamel" ? "#2a2a2a" : "#2a1a10"), bx, e[1] + S.y * sc - S.h * sc / 2 - 0.05, bz, (S.w + 0.12) * sc, (S.h + 0.1) * sc, 0.05, ry, 1, { ao: 0, no: "b" });
        tx.quad("t_facade", [1, 1, 1], wx, e[1] + S.y * sc, wz, S.w * sc, S.h * sc, ry, uv); n++; } });
    var t = new THREE.CanvasTexture(A.c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; shared(t); MAT.t_facade = shared(new THREE.MeshStandardMaterial({ map: t, normalMap: flatN(), vertexColors: true, roughness: 0.6, metalness: 0, emissiveMap: null })); MAT.t_facade.name = "rs_facade";
    var g = new THREE.Group(); g.name = "rs facade signs"; g.userData.noCull = true; bd.build(g, "rs facade boards"); tx.build(g, "rs facade signs");
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.userData.noSolid = true; shared(o.geometry); } }); scene.add(g); FAC.g = g; FAC.n = n; RS.n.facade = n;
  }
  function facadeFrame() { var g = FAC.g; if (!g) return; var inShop = false; try { inShop = !!(inside && inside.door && (inside.door.kind === "store" || inside.door.kind === "storefront_sl")); } catch (e) {} if (g.visible === inShop) g.visible = !inShop; }

  // ───────────────────────── which trade a shop is (plan/rooms_shops.json "shops", then these rules) ─────────────────────────
  var RULES = [[/giveback/i, "giveback"], [/soda|ice cream|ice house/i, "soda"], [/candy/i, "candy"], [/coffee|cafe/i, "coffee"], [/bakery/i, "bakery"], [/diner|deli|noodle|taco|concession|snack|scorer/i, "diner"],
    [/tavern|cider/i, "tavern"], [/hat shop|milliner/i, "hats"], [/boot|leather|saddle|harness/i, "leather"], [/farrier/i, "smithy"], [/outfitter|tailor|flight gear|pilot shop/i, "outfit"],
    [/gift|patches|star charts|newsstand|club store|concierge|travel desk/i, "gift"], [/parts|pilot supply|avionics|mining/i, "hardware"], [/mercantile|general store|trading post|dry goods/i, "mercantile"],
    [/feed|seed|farm stand|nursery|beekeeper|florist|botanical/i, "garden"], [/toys|model shop/i, "toys"], [/gallery/i, "gallery"], [/photo|tintype/i, "photo"], [/cycle|bike/i, "bikes"], [/records/i, "records"],
    [/barber/i, "barber"], [/makers|printing/i, "makers"], [/book|map room/i, "books"], [/apothecary|pharmacy|optics|tobacconist/i, "apothecary"], [/museum/i, "museum"], [/sheriff/i, "sheriff"],
    [/office|telegraph|claims|surveyor|luggage/i, "office"], [/market hall/i, "market"], [/restroom/i, "restroom"], [/gantry/i, "stall"]];
  function tradeKey(name) { var sc = C("shops." + name, null); if (sc && sc.trade && TR[sc.trade]) return sc.trade; for (var i = 0; i < RULES.length; i++) if (RULES[i][0].test(name || "")) return TR[RULES[i][1]] ? RULES[i][1] : null; return null; }
  function sheetsOf(T, nm, door) { if (!T || !T.sheets) return []; try { return typeof T.sheets === "function" ? T.sheets(nm || "", door) || [] : T.sheets; } catch (e) { return []; } }
  function tradeOf(door) { try { var info = PLAN_ROOMS.info(door); var k = tradeKey(info.name); return k && TR[k] ? TR[k] : null; } catch (e) { return null; } }
  RS.trade = function (name) { return tradeKey(name); };
  // the Gantry Row stalls (night plaza): each a small trade of its own under the space age palette
  var STALLN = null; function stallIdx(door) { try { if (!STALLN) { STALLN = []; for (var i = 0; i < PLACE.store.length; i++) { if (PLAN_ROOMS.info({ kind: "store", i: i, e: PLACE.store[i] }).name === "Gantry Row stall") STALLN.push(i); } } return Math.max(0, STALLN.indexOf(door.i)); } catch (e) { return 0; } }
  function stallTrade(door) { var list = C("stalls", ["records", "toys", "gift", "makers", "coffee", "candy", "books", "apothecary"]); return list[stallIdx(door) % list.length]; }
  TR.stall = { sheets: function (nm, door) { var t = TR[stallTrade(door)]; return ["space"].concat(sheetsOf(t, nm, door).filter(function (x) { return x !== "space"; })); }, build: function (K) { var list = C("stalls", ["records", "toys", "gift", "makers", "coffee", "candy", "books", "apothecary"]), labels = C("stallLabels", {}); var n = stallIdx(K.ctx.door);
    var tk = list[n % list.length]; K.space = true; K.sign1 = { title: "Gantry Row Stall " + (n + 1), sub: labels[tk] || tk }; K.shopName = K.sign1.title; K.T = Object.assign({}, C("trades." + tk, {}), K.T || {}); K.tradeName = tk; var T2 = TR[tk]; (T2 || TR.gift).build(K); } };

  // ───────────────────────── building a room (PLAN_ROOMS calls this in place of the generic furniture) ─────────────────────────
  function buildRoom(ctx) {
    var t0 = performance.now(); base(); wrapShop(); var door = ctx.door, name = ctx.name || "Shop", tk = tradeKey(name), T = TR[tk]; if (!T) throw new Error("no trade for " + name);
    var R = rng(hash((ctx.b && ctx.b.id) || (door.kind + door.i)) ^ 0x51ed); var K = new Kit(ctx, R, { wood: "#8a6440", wood2: "#3a2a1c", trim: "#3a2a1c", metal: "#2f4a3a" }, R() < 0.5 ? 1 : -1);
    K.xw = ctx.half - 0.1; K.zb = -ctx.half + 0.1; K.zf = ctx.half - FRONT_IN; K.T = C("trades." + tk, {}); K.shopCfg = C("shops." + name, {}) || {}; var sn = signName(name); K.sign1 = { title: K.shopCfg.title || sn.title, sub: K.shopCfg.sub || sn.sub || K.T.sub || "" }; K.shopName = K.sign1.title; K.tradeName = tk; K.venueId = K.shopCfg.venue ? venue("rs_s" + hash(name), K.shopCfg.venue) : "rs_" + tk;
    sheetsOf(T, name, door).forEach(function (n) { var s = sheet(n); s.live = true; ctx.H.leave(function () { s.live = false; }); });
    T.build(K);
    if (K.atl) { MAT.s = K.atl.mat(); } var n = K.b.build(ctx.g, "rs " + tk); life(K); people(K); spots(K);
    var tt = K.T.tip || ("{shop}: look around · the door is behind you"); ctx.tip = fill(tt, { shop: K.shopName }); ctx.venue = false; ctx.door0 = [K.zf - 1.3, 1.9];
    // stamps: the trade's stamp on the way in, and the shop crawl (ten different trades)
    var st = K.noEnterStamp ? null : K.T.stamp; ctx.H.after(function () { if (st) award(st); try { if (visited(K.tradeName) >= 10) award(C("crawlStamp", "p_rs_crawl")); } catch (e) {} });
    var ms = performance.now() - t0; RS.n.built++; RS.n.ms = +ms.toFixed(1); RS.n.maxMs = Math.max(RS.n.maxMs, RS.n.ms); RS.n.tris = K.b.tris; RS.n.draws = n; RS.last = { name: name, trade: tk, ms: RS.n.ms, tris: K.b.tris, draws: n, mirror: K.mx };
  }
  // the venues the shop card opens (prices come from the room: coffee, meal, merch, hats, art)
  function venues() { var t = C("trades", {}); for (var k in t) { var v = t[k] && t[k].venue; if (v) venue("rs_" + k, v); } }

  // ───────────────────────── install ─────────────────────────
  var THEME_SHOP = { wall: ["adobe"], floor: ["wood", 0.85], ceil: 0xe9e2d3, light: [0xffe2c0, 1.1], hgt: 4.5 };
  function install() {
    if (RS.installed || !window.PLAN_ROOMS || !PLAN_ROOMS.register) return false; RS.installed = true;
    PLAN_ROOMS.register("r14_shops", function (door, info) { return (door.kind === "store" || door.kind === "storefront_sl") && !!tradeKey(info.name); }, { theme: THEME_SHOP, build: buildRoom, solids: "manual" });
    return true;
  }
  install();
  // the Club Walk's streamline storefronts become enterable (their own rooms; the Giveback Desk is the Giveback shop)
  function doors() { try { if (C("streamline", true) === false || typeof DOOR_KINDS === "undefined" || !PLACE.storefront_sl || !MODELS.storefront_sl) return; if (DOOR_KINDS.indexOf("storefront_sl") < 0) DOOR_KINDS.push("storefront_sl"); if (typeof DOOR_NAMES !== "undefined" && !DOOR_NAMES.storefront_sl) DOOR_NAMES.storefront_sl = "shop"; RS.n.slDoors = PLACE.storefront_sl.length; } catch (e) { note("doors", e); } }
  window.PLAN_HOOKS.world.push({ name: "roomsShopsWorld", fn: function () { install(); try { cfg(); venues(); wrapShop(); } catch (e) { note("world", e); } doors(); } });
  // the drawn surfaces are made in idle time after load (a room entered before that makes the ones it needs)
  window.PLAN_HOOKS.defer.push({ name: "roomsShopsDefer", fn: function () { doors(); var jobs = [base, function () { texPlanks("pl_wide", 8, 1928); }, function () { texPlanks("pl_strip", 14, 1929); }, function () { texPlanks("pl_barn", 6, 1930, true); }, texGrain, texTin, texPlaster, texBead, texBrick, function () { texTile("checker"); }, function () { texTile("hex"); }, function () { texTile("terra"); }, function () { texPaper("damask"); }, function () { texPaper("stripe"); }, function () { texPaper("diamond"); }, texShiplap, texConcrete, function () { texRug("navajo"); }, function () { texRug("persian"); }, function () { texRug("stripes"); }, logoImg, facade];
    var step = function () { var t0 = performance.now(); while (jobs.length && performance.now() - t0 < 6) { try { jobs.shift()(); } catch (e) { note("prebuild", e); } } if (jobs.length) setTimeout(step, 60); else { RS.n.prebuilt = Math.round(performance.now()); try { if (window.PLAN_ROOMS && PLAN_ROOMS.warm) PLAN_ROOMS.warm(function () { return [TX, MAT]; }, "shops"); } catch (e) { note("warm", e); } } }; setTimeout(step, 1500); } });
  window.PLAN_HOOKS.frame.push({ name: "roomsShopsFrame", fn: function (dt) { prefetch(dt || 0.016); facadeFrame(); } });
  RS.api = { build: buildRoom, sheet: sheet, prefetch: prefetch, tradeOf: tradeOf, signName: signName };
  RS.debug = { tx: TX, mat: MAT, sheets: SHEETS, kit: Kit, bt: Bt };
})();
