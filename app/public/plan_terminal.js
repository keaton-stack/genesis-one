// plan_terminal.js (T, round 2, 25 Sep 2026): the terminal of Solport, the Stellar Aviation FBO: its interior and its
// Industry Partners hall, and (29 Sep 2026) its exterior branding (the Stellar Aviation signs, SOLPORT letters, the monument).
// Classic script, loaded before client.js. Everything lives in this IIFE and window.PLAN_TERMINAL; client functions and
// consts are reached by bare name at call time. A PLAN_HOOKS.world hook takes over the terminal furnishing
// (furnishTerminal), the hall people (spawnHallWalkers, updateHall); a frame hook keeps everyone on the real floor.
// Dialogue and partner facts: app/public/plan/partners_terminal.json (editable without code changes).
// Room frame (the client's interior group): x along the hall (+x = the landside door, Arrivals Court), z across it
// (+z = the airside glass and the Gate A2 door), y up from the pad; the walk surface is y = 0.05.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  // the asset kinds this interior uses as soon as they exist (loadModels only loads what a module declares). J (30 Sep 2026): the terminal
  // set is seen only inside the FBO, so it is declared lazy (window.PLAN_MODEL_LAZY: registered, not in the boot download) and fetched with
  // window.PLAN_LOAD_KINDS when the player approaches or enters (or during the fly-in, which ends inside); the three planting scans are
  // also planted outdoors (plan_land.js), so they stay boot kinds. exec_desk, lounge_chair and bookcase were declared here but never placed.
  var NEED = ["ph_quiver_1", "ph_succulent_2", "ph_shrub_4"];
  var TSET = ["term_checkin", "term_seating", "term_carousel", "term_cafe", "term_info", "term_planter", "booth_lux"];
  var ND = window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || [];
  for (var ni = 0; ni < NEED.length; ni++) if (ND.indexOf(NEED[ni]) < 0) ND.push(NEED[ni]);
  var LZ = window.PLAN_MODEL_LAZY = window.PLAN_MODEL_LAZY || [];
  for (var li = 0; li < TSET.length; li++) if (LZ.indexOf(TSET[li]) < 0) LZ.push(TSET[li]);

  var PT = window.PLAN_TERMINAL = window.PLAN_TERMINAL || {};
  PT.v = "r2t-1"; PT.errs = PT.errs || []; PT.n = PT.n || {}; PT.tx = PT.tx || {};
  var TAU = Math.PI * 2, F = 0.05, HALF = 27, DROP = 0.1;
  function note(where, e) { if (PT.errs.length < 30) PT.errs.push(where + ": " + (e && e.message ? e.message : e)); try { console.warn("plan_terminal " + where, e); } catch (x) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var RND = rng(1928);

  // ───────────────────────── data (partners_terminal.json, with a minimal built-in fallback) ─────────────────────────
  var DISC = "Nothing here is an offer to sell securities or investment advice.";
  var DEF = { hall: { title: "INDUSTRY PARTNERS", subtitle: "A coalition of established aviation, logistics, and investment partners ready to bring jobs, activity, and long-term investment to Douglas." },
    partners: {
      stellar: { name: "Stellar Aviation", badge: "SOLPORT FBO", blurb: "A proven FBO operator, now running the FBO at Solport: fuel, hangar, ground services, a crew lounge and concierge, along with local jobs.", services: ["Fuel", "Hangar", "Ground services", "Concierge", "Crew lounge", "Flight planning"], locations: ["Reno  KRNO", "Carson-Tahoe  KCXP", "South Palm Beach  KLNA", "Springfield  KSPI"], npc: { id: "pt_stellar", name: "Brad Kost", role: "Founding Partner and COO · Stellar Aviation" }, contact: ["Brad Kost", "Founding Partner and COO", "Bkost@stellaraviationgroup.com", "stellaraviationgroup.com"], greet: ["Welcome to Solport. This is the Stellar Aviation FBO."], talk: [{ t: "Welcome to Stellar Aviation. We operate the FBO here at Solport: fuel, hangar, ground services, the crew lounge and concierge, along with local jobs.", o: [["Thanks", null]] }] },
      financeadvisors: { name: "FinanceAdvisors.com", blurb: "A fintech corporation that matches high-net-worth retirees with wealth managers. Servicing Fisher Investments, Edelman Financial Engines, Empower, and more.", notice: "FinanceAdvisors.com does not provide investment advice.", npc: { id: "pt_paul", name: "Paul Mazzapica", role: "Co-Founder and President · FinanceAdvisors.com" }, contact: ["Paul Mazzapica", "Co-Founder and President", "paul@financeadvisors.com", "financeadvisors.com"], footer: DISC, greet: ["Hi, I'm Paul. Come on in."], talk: [{ t: "Hi, I'm Paul Mazzapica, Co-Founder and President of FinanceAdvisors.com. We match high-net-worth retirees with independent wealth managers. " + DISC, o: [["Goodbye", null]] }] },
      jetfinders: { name: "JetFinders", tagline: "The only jet contact you'll ever need.", services: ["On-demand charter", "Jet cards", "Fractional ownership", "Aircraft sales and management", "Real estate and hangars", "Asset tokenization"], npc: { id: "pt_jetfinders", name: "Jake", role: "JetFinders · private aviation advisor" }, contact: ["JetFinders", "jetfinders.com"], greet: ["The only jet contact you'll ever need."], talk: [{ t: "Welcome to JetFinders, the only jet contact you'll ever need.", o: [["Thanks", null]] }] },
      freedomair: { name: "Freedom Air", tagline: "Finding freedom", fleet: ["Challenger 300", "Citation X", "Citation XLS", "CJ3+", "Epic E1000", "Pilatus PC-12", "Airbus EC130 helicopter"], npc: { id: "freedomair", name: "Joe", role: "Freedom Air · private jet charter" }, contact: ["Freedom Air charter desk", "+1 775 447 9830", "charter@freedomairservices.com"], greet: ["Finding freedom starts here."], talk: [{ t: "Welcome to Freedom Air: private jet charter and aircraft management out of Reno.", o: [["Thanks", null]] }] } } };
  function loadData() { if (PT.dataP) return PT.dataP; try { PT.dataP = fetch("/plan/partners_terminal.json?v=" + (window.BUILD || "dev") + "-" + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.partners) PT.data = j; return j; }).catch(function (e) { note("data", e); return null; }); } catch (e) { note("data", e); } return PT.dataP; }
  loadData();
  function D() { return PT.data || DEF; }
  function P(id) { var d = D(); return (d.partners && d.partners[id]) || DEF.partners[id]; }

  // ───────────────────────── frames ─────────────────────────
  function TE() { try { return PLACE.terminal && PLACE.terminal[0]; } catch (e) { return null; } }
  function l2w(e, lx, lz) { var c = Math.cos(e[3]), s = Math.sin(e[3]); return [e[0] + lx * c + lz * s, e[2] - lx * s + lz * c]; }
  function w2l(e, x, z) { var dx = x - e[0], dz = z - e[2], c = Math.cos(e[3]), s = Math.sin(e[3]); return [dx * c - dz * s, dx * s + dz * c]; }
  function inTerm() { try { return !!(inside && inside.door && inside.door.kind === "terminal"); } catch (e) { return false; } }
  // raised floors inside the room (booth platforms): [cx, cz, hw, hd, ry, top]
  PT.plats = PT.plats || [];
  function floorAt(lx, lz) { var y = F; for (var i = 0; i < PT.plats.length; i++) { var p = PT.plats[i], c = Math.cos(p[4]), s = Math.sin(p[4]), dx = lx - p[0], dz = lz - p[1]; var u = dx * c - dz * s, v = dx * s + dz * c; if (Math.abs(u) <= p[2] && Math.abs(v) <= p[3] && p[5] > y) y = p[5]; } return y; }
  PT.floorAt = floorAt;

  // ───────────────────────── textures (canvas, generated once per session) ─────────────────────────
  var TX = PT.tx;
  function cv(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function mkTex(c, rep, lin) { var t = new THREE.CanvasTexture(c); if (!lin) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.needsUpdate = true; return t; }
  function hexRGB(h) { var n = parseInt(h.replace("#", ""), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function jit(rgb, R, k) { var d = (R() - 0.5) * k; return "rgb(" + clamp(Math.round(rgb[0] + d), 0, 255) + "," + clamp(Math.round(rgb[1] + d), 0, 255) + "," + clamp(Math.round(rgb[2] + d * 0.9), 0, 255) + ")"; }
  function wrapAt(N, px, py, r, fn) { var xs = [0], ys = [0]; if (px < r) xs.push(N); if (px > N - r) xs.push(-N); if (py < r) ys.push(N); if (py > N - r) ys.push(-N); for (var i = 0; i < xs.length; i++) for (var j = 0; j < ys.length; j++) fn(px + xs[i], py + ys[j]); }
  // Venetian terrazzo: a cloudy matrix with marble, granite and glass chips (seamless; 1024 px = 2 m)
  function terrazzo(key, base, chips, seed) {
    if (TX[key]) return TX[key]; var N = 1024, c = cv(N, N), x = c.getContext("2d"), R = rng(seed); x.fillStyle = base; x.fillRect(0, 0, N, N);
    for (var i = 0; i < 2200; i++) { var px = R() * N, py = R() * N, r = 8 + R() * 38, l = R() < 0.5 ? 255 : 30; x.fillStyle = "rgba(" + l + "," + l + "," + (l - 10) + "," + (0.012 + R() * 0.022) + ")"; wrapAt(N, px, py, r, function (ax, ay) { x.beginPath(); x.arc(ax, ay, r, 0, TAU); x.fill(); }); }
    for (var k = 0; k < chips.length; k++) { var ch = chips[k], rgb = hexRGB(ch[0]); for (var n = 0; n < ch[1]; n++) { var cx0 = R() * N, cy0 = R() * N, sz = ch[2] + R() * (ch[3] - ch[2]), nv = 5 + (R() * 4 | 0), a0 = R() * TAU, pts = []; for (var q = 0; q < nv; q++) { var a = a0 + q / nv * TAU + (R() - 0.5) * 0.7, rr2 = sz * (0.5 + R() * 0.5); pts.push([Math.cos(a) * rr2, Math.sin(a) * rr2 * (0.7 + R() * 0.3)]); } x.fillStyle = jit(rgb, R, 26); wrapAt(N, cx0, cy0, sz + 1, function (ax, ay) { x.beginPath(); x.moveTo(ax + pts[0][0], ay + pts[0][1]); for (var q2 = 1; q2 < pts.length; q2++) x.lineTo(ax + pts[q2][0], ay + pts[q2][1]); x.closePath(); x.fill(); }); } }
    for (var s2 = 0; s2 < 9000; s2++) { var sx = R() * N, sy = R() * N; x.fillStyle = R() < 0.5 ? "rgba(40,34,28,0.28)" : "rgba(255,255,250,0.35)"; x.fillRect(sx, sy, 1 + (R() < 0.3 ? 1 : 0), 1); }
    return (TX[key] = mkTex(c, true));
  }
  // straight-grain walnut (grain along u; seamless; 1024 px = 1.2 m)
  function woodTex(key, dark, light, seed, rings) {
    if (TX[key]) return TX[key]; var N = 1024, c = cv(N, N), x = c.getContext("2d"), R = rng(seed), id = x.createImageData(N, N), d = id.data; var A = hexRGB(dark), B = hexRGB(light);
    var wob = new Float32Array(N), p1 = R() * TAU, p2 = R() * TAU, p3 = R() * TAU, p4 = R() * TAU; for (var i = 0; i < N; i++) wob[i] = 10 * Math.sin(TAU * 2 * i / N + p1) + 4 * Math.sin(TAU * 5 * i / N + p2) + 1.6 * Math.sin(TAU * 13 * i / N + p3);
    var LUT = new Float32Array(N), K = rings || 30; for (var t = 0; t < N; t++) { var ring = 0.5 + 0.5 * Math.sin(TAU * K * t / N + 1.8 * Math.sin(TAU * 3 * t / N + p4) + 0.7 * Math.sin(TAU * 7 * t / N)); var fine = 0.5 + 0.5 * Math.sin(TAU * K * 3 * t / N + 2.1 * Math.sin(TAU * 5 * t / N)); LUT[t] = 0.65 * Math.pow(ring, 1.7) + 0.35 * fine; }
    var streak = new Float32Array(N); for (var y0 = 0; y0 < N; y0++) streak[y0] = R(); for (var y1 = 1; y1 < N; y1++) streak[y1] = streak[y1] * 0.35 + streak[y1 - 1] * 0.65;
    var cell = new Float32Array((N >> 3) * N); for (var ci = 0; ci < cell.length; ci++) cell[ci] = R();
    for (var y = 0; y < N; y++) for (var xx = 0; xx < N; xx++) { var tt = y + wob[xx]; tt = ((tt % N) + N) % N; var t0 = tt | 0, fr = tt - t0, v = LUT[t0] * (1 - fr) + LUT[(t0 + 1) % N] * fr; var f = cell[(y * (N >> 3)) + (xx >> 3)]; var k2 = clamp(0.3 + 0.3 * v + 0.26 * streak[(y + (wob[xx] | 0) + N) % N] + 0.12 * f, 0, 1); var o = (y * N + xx) * 4; d[o] = A[0] + (B[0] - A[0]) * k2; d[o + 1] = A[1] + (B[1] - A[1]) * k2; d[o + 2] = A[2] + (B[2] - A[2]) * k2; d[o + 3] = 255; }
    x.putImageData(id, 0, 0); for (var pz = 0; pz < 7000; pz++) { var ax = R() * N, ay = R() * N; x.fillStyle = "rgba(20,10,4," + (0.18 + R() * 0.25) + ")"; x.fillRect(ax, ay, 2 + R() * 7, 1); }
    return (TX[key] = mkTex(c, true));
  }
  // wide-plank oak for the lounge (seamless; 1024 px = 2.4 m; 12 rows of 20 cm planks with staggered joints)
  function plankTex(key) {
    if (TX[key]) return TX[key]; var N = 1024, c = cv(N, N), x = c.getContext("2d"), R = rng(77); var grain = woodTex("oakgrain", "#8a6440", "#c49a6c", 31, 44).image;
    var rows = 12, rh = N / rows; for (var r = 0; r < rows; r++) { var y0 = Math.floor(r * rh), y1 = Math.floor((r + 1) * rh); var xx = R() * N, left = N; while (left > 0) { var L = Math.min(left, 380 + R() * 300); var tone = 0.82 + R() * 0.3; x.save(); x.beginPath(); x.rect(0, y0, N, y1 - y0); x.clip(); var sx = R() * (N - L); for (var w = -1; w <= 1; w++) { x.globalAlpha = 1; x.drawImage(grain, sx, R() * (N - rh), L, y1 - y0, xx + w * N, y0, L, y1 - y0); x.fillStyle = tone > 1 ? "rgba(255,240,215," + (tone - 1) * 0.9 + ")" : "rgba(40,24,10," + (1 - tone) * 0.9 + ")"; x.fillRect(xx + w * N, y0, L, y1 - y0); x.fillStyle = "rgba(30,18,8,0.55)"; x.fillRect(xx + w * N, y0, 2, y1 - y0); } x.restore(); xx = (xx + L) % N; left -= L; } x.fillStyle = "rgba(30,18,8,0.6)"; x.fillRect(0, y0, N, 2); }
    return (TX[key] = mkTex(c, true));
  }
  // backlit honey onyx (not tiled)
  function onyxTex() {
    if (TX.onyx) return TX.onyx; var W = 1024, H = 512, c = cv(W, H), x = c.getContext("2d"), R = rng(515), id = x.createImageData(W, H), d = id.data;
    var G = []; for (var o = 0; o < 5; o++) { var gw = 4 << o, gh = 3 << o, a = new Float32Array((gw + 1) * (gh + 1)); for (var i = 0; i < a.length; i++) a[i] = R(); G.push([gw, gh, a]); }
    function vn(g, u, v) { var gw = g[0], gh = g[1], a = g[2], X = u * gw, Y = v * gh, x0 = Math.min(gw - 1, X | 0), y0 = Math.min(gh - 1, Y | 0), fx = X - x0, fy = Y - y0; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); var r0 = a[y0 * (gw + 1) + x0] * (1 - fx) + a[y0 * (gw + 1) + x0 + 1] * fx, r1 = a[(y0 + 1) * (gw + 1) + x0] * (1 - fx) + a[(y0 + 1) * (gw + 1) + x0 + 1] * fx; return r0 * (1 - fy) + r1 * fy; }
    for (var y = 0; y < H; y++) for (var xx = 0; xx < W; xx++) { var u = xx / W, v = y / H, n = 0, amp = 0.55, tot = 0; for (var k = 0; k < G.length; k++) { n += vn(G[k], u, v) * amp; tot += amp; amp *= 0.55; } n /= tot; var b = Math.sin((u * 2.2 + v * 5.2 + n * 7.5) * Math.PI * 2); var vein = Math.pow(1 - Math.abs(b), 16); var band = 0.5 + 0.5 * Math.sin((v * 3.1 + n * 4.2) * Math.PI * 2); var L = clamp(0.5 + 0.55 * (n - 0.5) * 2 + 0.18 * band, 0, 1); var p = (y * W + xx) * 4; d[p] = clamp(186 + 64 * L + 30 * vein, 0, 255); d[p + 1] = clamp(112 + 96 * L + 40 * vein, 0, 255); d[p + 2] = clamp(46 + 88 * L + 50 * vein, 0, 255); d[p + 3] = 255; }
    x.putImageData(id, 0, 0); return (TX.onyx = mkTex(c, false));
  }
  function runnerTex() { if (TX.runner) return TX.runner; var N = 512, c = cv(N, N), x = c.getContext("2d"), R = rng(42); x.fillStyle = "#2a5a3d"; x.fillRect(0, 0, N, N); for (var y = 0; y < N; y += 4) for (var xx = 0; xx < N; xx += 4) { var d = ((xx >> 2) + (y >> 2)) % 8 < 4; x.fillStyle = d ? "rgba(12,40,22,0.16)" : "rgba(110,170,128,0.07)"; x.fillRect(xx, y, 4, 4); } for (var i = 0; i < 26000; i++) { x.fillStyle = R() < 0.5 ? "rgba(8,30,16,0.3)" : "rgba(150,200,160,0.16)"; x.fillRect(R() * N, R() * N, 1, 1 + (R() * 2 | 0)); } return (TX.runner = mkTex(c, true)); }
  function poolTex() { if (TX.pool) return TX.pool; var c = cv(256, 256), x = c.getContext("2d"), g = x.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,0.55)"); g.addColorStop(0.7, "rgba(255,255,255,0.14)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 256, 256); return (TX.pool = mkTex(c, false)); }
  // a wall-wash scallop from a recessed downlight near the wall
  function scallopTex() { if (TX.scallop) return TX.scallop; var W = 128, H = 256, c = cv(W, H), x = c.getContext("2d"), id = x.createImageData(W, H), d = id.data; for (var y = 0; y < H; y++) for (var xx = 0; xx < W; xx++) { var v = y / H, u = (xx / W - 0.5); var wdt = 0.05 + 0.42 * Math.pow(v, 0.6); var a = Math.exp(-(u * u) / (wdt * wdt) * 2.2) * Math.min(1, v * 12) * Math.pow(1 - v, 1.3); var p = (y * W + xx) * 4; d[p] = d[p + 1] = d[p + 2] = 255; d[p + 3] = clamp(a * 255, 0, 255); } x.putImageData(id, 0, 0); return (TX.scallop = mkTex(c, false)); }
  // a skylight's sun patch: soft edges, the glulam beams' shadows (skylight spans x -26..26)
  function patchTex() { if (TX.patch) return TX.patch; var W = 1024, H = 64, c = cv(W, H), x = c.getContext("2d"), id = x.createImageData(W, H), d = id.data; var beams = [-22.5, -13.5, -4.5, 4.5, 13.5, 22.5]; for (var y = 0; y < H; y++) for (var xx = 0; xx < W; xx++) { var u = xx / W, v = y / H, X = -26 + u * 52; var a = Math.min(1, Math.min(v, 1 - v) * 7) * Math.min(1, Math.min(u, 1 - u) * 40); for (var b = 0; b < beams.length; b++) a *= clamp((Math.abs(X - beams[b]) - 0.2) / 0.22, 0, 1); var p = (y * W + xx) * 4; d[p] = d[p + 1] = d[p + 2] = 255; d[p + 3] = clamp(a * 255, 0, 255); } x.putImageData(id, 0, 0); return (TX.patch = mkTex(c, false)); }

  // ───────────────────────── type and signs ─────────────────────────
  var FT = { ui: "'Space Grotesk', 'Segoe UI', system-ui, sans-serif", disp: "Anton, Impact, 'Arial Narrow', sans-serif", mono: "'JetBrains Mono', Consolas, monospace", serif: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif", heavy: "'Segoe UI Black', 'Arial Black', 'Helvetica Neue', Arial, sans-serif" };
  function txt(x, t, px, py, font, color, ls, align, maxW) { x.font = font; x.fillStyle = color; x.textAlign = align || "center"; x.textBaseline = "middle"; try { x.letterSpacing = (ls || 0) + "px"; } catch (e) {} if (maxW) { var w = x.measureText(t).width; if (w > maxW) { x.save(); x.translate(px, py); x.scale(maxW / w, 1); x.fillText(t, 0, 0); x.restore(); try { x.letterSpacing = "0px"; } catch (e) {} return; } } x.fillText(t, px, py); try { x.letterSpacing = "0px"; } catch (e) {} }
  function rrect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.lineTo(a + w - r, b); x.quadraticCurveTo(a + w, b, a + w, b + r); x.lineTo(a + w, b + h - r); x.quadraticCurveTo(a + w, b + h, a + w - r, b + h); x.lineTo(a + r, b + h); x.quadraticCurveTo(a, b + h, a, b + h - r); x.lineTo(a, b + r); x.quadraticCurveTo(a, b, a + r, b); x.closePath(); }
  // pictograms for wayfinding (white on the sign colour)
  function picto(x, kind, cx, cy, s, col) {
    x.save(); x.translate(cx, cy); x.scale(s / 100, s / 100); x.fillStyle = col; x.strokeStyle = col; x.lineWidth = 8; x.lineCap = "round"; x.lineJoin = "round";
    if (kind === "bag") { rrect(x, -30, -18, 60, 56, 8); x.fill(); x.beginPath(); x.moveTo(-12, -18); x.lineTo(-12, -34); x.lineTo(12, -34); x.lineTo(12, -18); x.stroke(); }
    else if (kind === "plane") { x.rotate(-Math.PI / 4); x.beginPath(); x.moveTo(0, -46); x.quadraticCurveTo(7, -40, 7, -20); x.lineTo(44, 4); x.lineTo(44, 14); x.lineTo(7, 4); x.lineTo(6, 30); x.lineTo(18, 40); x.lineTo(18, 46); x.lineTo(0, 40); x.lineTo(-18, 46); x.lineTo(-18, 40); x.lineTo(-6, 30); x.lineTo(-7, 4); x.lineTo(-44, 14); x.lineTo(-44, 4); x.lineTo(-7, -20); x.quadraticCurveTo(-7, -40, 0, -46); x.fill(); }
    else if (kind === "cup") { x.beginPath(); x.moveTo(-30, -16); x.lineTo(24, -16); x.lineTo(18, 30); x.lineTo(-24, 30); x.closePath(); x.fill(); x.beginPath(); x.arc(30, 2, 12, -Math.PI / 2, Math.PI / 2); x.stroke(); x.fillRect(-36, 36, 66, 7); }
    else if (kind === "info") { x.beginPath(); x.arc(0, 0, 44, 0, TAU); x.stroke(); x.fillRect(-6, -8, 12, 36); x.beginPath(); x.arc(0, -22, 7, 0, TAU); x.fill(); }
    else if (kind === "exit") { x.fillRect(-40, -44, 8, 88); x.beginPath(); x.moveTo(-18, 0); x.lineTo(40, 0); x.stroke(); x.beginPath(); x.moveTo(22, -18); x.lineTo(40, 0); x.lineTo(22, 18); x.stroke(); }
    else if (kind === "people") { for (var i = -1; i <= 1; i += 2) { x.beginPath(); x.arc(i * 20, -26, 11, 0, TAU); x.fill(); rrect(x, i * 20 - 14, -12, 28, 40, 8); x.fill(); x.fillRect(i * 20 - 11, 26, 9, 22); x.fillRect(i * 20 + 2, 26, 9, 22); } }
    else if (kind === "lounge") { rrect(x, -40, 0, 80, 22, 6); x.fill(); rrect(x, -40, -26, 14, 48, 5); x.fill(); rrect(x, 26, -26, 14, 48, 5); x.fill(); rrect(x, -28, -16, 56, 16, 5); x.fill(); x.fillRect(-34, 22, 6, 14); x.fillRect(28, 22, 6, 14); }
    x.restore();
  }
  // arrows: "u" up/ahead, "ul" up-left, "ur" up-right, "l", "r"
  function arrow(x, dir, cx, cy, s, col) { var a = { u: 0, ur: Math.PI / 4, r: Math.PI / 2, dr: 3 * Math.PI / 4, dl: -3 * Math.PI / 4, l: -Math.PI / 2, ul: -Math.PI / 4 }[dir] || 0; x.save(); x.translate(cx, cy); x.rotate(a); x.scale(s / 100, s / 100); x.fillStyle = col; x.beginPath(); x.moveTo(0, -46); x.lineTo(38, -6); x.lineTo(12, -6); x.lineTo(12, 44); x.lineTo(-12, 44); x.lineTo(-12, -6); x.lineTo(-38, -6); x.closePath(); x.fill(); x.restore(); }
  // a hanging wayfinding face: rows of [picto, text, arrow]
  function wayTex(key, rows, W, H) {
    if (TX[key]) return TX[key]; var c = cv(W, H), x = c.getContext("2d"); x.fillStyle = "#101112"; x.fillRect(0, 0, W, H); x.fillStyle = "#b99a62"; x.fillRect(0, H - 6, W, 6); x.fillRect(0, 0, W, 3);
    var rh = (H - 16) / rows.length; rows.forEach(function (r, i) { var cy = 8 + rh * (i + 0.5), s = rh * 0.62; var left = r[2] && /l/.test(r[2]); var ax = left ? 20 + s * 0.6 : W - 20 - s * 0.6; if (r[2]) arrow(x, r[2], ax, cy, s * 0.92, "#f4cd5a"); var px0 = left ? 30 + s * 1.3 : 26 + s * 0.6; if (r[0]) { x.fillStyle = "#2a2c2e"; rrect(x, px0 - s * 0.55, cy - s * 0.55, s * 1.1, s * 1.1, 10); x.fill(); picto(x, r[0], px0, cy, s * 0.8, "#f5f1e6"); } var tx0 = px0 + (r[0] ? s * 0.8 : -s * 0.4); txt(x, r[1], tx0, cy + 2, "600 " + Math.round(rh * 0.36) + "px " + FT.ui, "#f5f1e6", 3, "left", (left ? W - tx0 - 20 : ax - s * 0.7 - tx0)); if (i) { x.fillStyle = "rgba(245,241,230,0.12)"; x.fillRect(16, 8 + rh * i, W - 32, 2); } });
    return (TX[key] = mkTex(c));
  }

  // ── partner wordmarks (drawn in type from the partners' own marks; no downloaded artwork) ──
  function stellarMark(x, cx, cy, s) {   // blue STELLAR with the S roundel, grey swoosh, AVIATION beneath
    x.save(); x.translate(cx, cy); x.scale(s, s);
    var gr = x.createLinearGradient(-300, 0, 300, 0); gr.addColorStop(0, "rgba(140,146,152,0.1)"); gr.addColorStop(0.35, "rgba(128,134,140,0.95)"); gr.addColorStop(1, "rgba(150,156,162,0.9)");
    x.strokeStyle = gr; x.lineCap = "round"; x.lineWidth = 9; x.beginPath(); x.ellipse(-60, 6, 250, 62, -0.06, Math.PI * 1.02, Math.PI * 1.9); x.stroke(); x.lineWidth = 6; x.beginPath(); x.ellipse(-70, 2, 236, 52, -0.04, Math.PI * 0.12, Math.PI * 0.62); x.stroke();
    x.fillStyle = "#1464b4"; x.beginPath(); x.arc(-232, -2, 46, 0, TAU); x.fill(); x.fillStyle = "#ffffff"; x.beginPath(); x.arc(-232, -2, 33, 0, TAU); x.fill(); txt(x, "S", -232, 2, "900 64px " + FT.heavy, "#1464b4", 0);
    x.save(); x.scale(1.18, 1); txt(x, "TELLAR", 30 / 1.18, -2, "900 78px " + FT.heavy, "#1464b4", 6, "center"); x.restore();
    txt(x, "AVIATION", 110, 58, "400 30px " + FT.ui, "#7c8288", 11, "center"); x.restore();
  }
  function faMark(x, cx, cy, h) { x.font = "600 " + h + "px " + FT.serif; var w1 = x.measureText("Finance ").width, w2 = x.measureText("Advisors").width, x0 = cx - (w1 + w2) / 2; txt(x, "Finance", x0, cy, "600 " + h + "px " + FT.serif, "#ffffff", 0, "left"); txt(x, "Advisors", x0 + w1, cy, "600 " + h + "px " + FT.serif, "#e2323d", 0, "left"); }
  function jfMark(x, cx, cy, h) { txt(x, "JetFinders", cx, cy, "600 " + h + "px " + FT.ui, "#ffffff", -1, "center"); x.save(); x.fillStyle = "#7fb2ff"; x.translate(cx + h * 2.72, cy - h * 0.46); x.rotate(-0.5); x.beginPath(); x.moveTo(0, -h * 0.16); x.lineTo(h * 0.05, 0); x.lineTo(h * 0.2, h * 0.06); x.lineTo(h * 0.05, h * 0.05); x.lineTo(0, h * 0.18); x.lineTo(-h * 0.05, h * 0.05); x.lineTo(-h * 0.2, h * 0.06); x.lineTo(-h * 0.05, 0); x.closePath(); x.fill(); x.restore(); }
  // images the Freedom Air desk already uses (tex/freedomair_*.png); a canvas redraws when they arrive
  var IMG = PT.img = PT.img || {};
  function img(path, then) { var im = IMG[path]; if (!im) { im = IMG[path] = new Image(); im.onload = function () { (im._cb || []).forEach(function (f) { try { f(); } catch (e) { note("img", e); } }); im._cb = null; }; im.src = path; } if (im.complete && im.naturalWidth) { then(im); return; } (im._cb = im._cb || []).push(function () { then(im); }); }

  // a panel texture: fn(x, W, H) draws it; cached by key
  function panel(key, W, H, fn, lin) { if (TX[key]) return TX[key]; var c = cv(W, H), x = c.getContext("2d"); var t = mkTex(c, false, lin); t.userData = { c: c }; try { fn(x, W, H, t); } catch (e) { note("panel " + key, e); } t.needsUpdate = true; return (TX[key] = t); }
  function lines(x, arr, x0, y0, lh, font, col, ls, align, maxW) { for (var i = 0; i < arr.length; i++) txt(x, arr[i], x0, y0 + i * lh, font, col, ls, align, maxW); }
  function wrapText(x, text, maxW, font) { x.font = font; var words = String(text).split(" "), out = [], cur = ""; for (var i = 0; i < words.length; i++) { var t = cur ? cur + " " + words[i] : words[i]; if (x.measureText(t).width > maxW && cur) { out.push(cur); cur = words[i]; } else cur = t; } if (cur) out.push(cur); return out; }

  // ───────────────────────── materials ─────────────────────────
  var CH1 = [["#f4f1ea", 900, 3, 9], ["#a19b92", 520, 2, 7], ["#d3c19f", 520, 3, 8], ["#9a5a3a", 150, 2, 6], ["#3c3834", 220, 2, 5], ["#7d877a", 110, 2, 6], ["#fbfaf6", 70, 9, 17], ["#c6a878", 60, 8, 15]], CH2 = [["#ece7de", 700, 3, 9], ["#5b5650", 520, 2, 7], ["#c9b391", 420, 3, 8], ["#8e4f33", 140, 2, 6], ["#23201d", 300, 2, 5], ["#f7f4ee", 60, 9, 16]], CHG = [["#8c7f70", 1200, 3, 8], ["#4a4038", 900, 2, 6], ["#b3a08a", 700, 2, 7]];
  function mats() {
    if (PT.M) return PT.M; var m = {}; var L = new THREE.TextureLoader();
    function im(p, srgb) { var t = L.load(p); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }
    function S(o) { var mt = new THREE.MeshStandardMaterial(o); mt.userData.pt = 1; return mt; }
    m.terr = S({ map: terrazzo("terr1", "#e5dccb", CH1, 7), roughness: 0.17, metalness: 0 });
    m.terrG = S({ map: terrazzo("terr2", "#b0a797", CH2, 11), roughness: 0.2, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    m.trav = S({ map: im("/tex/travertine.jpg", 1), normalMap: im("/tex/travertine_n.jpg"), roughnessMap: im("/tex/travertine_r.jpg"), color: 0xf7efe2, roughness: 0.8 });
    m.travF = S({ map: im("/tex/travertine.jpg", 1), color: 0xe9dfcf, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    m.walnut = S({ map: woodTex("walnut2", "#2a1e16", "#6f5643", 5, 30), roughness: 0.42 });
    m.walnutD = S({ map: woodTex("walnut2", "#2a1e16", "#6f5643", 5, 30), color: 0x7d7069, roughness: 0.48 });
    m.oak = S({ map: plankTex("planks"), roughness: 0.46, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    m.brass = S({ map: im("/tex/jet_gold.jpg", 1), color: 0xe9d2a0, metalness: 1, roughness: 0.28 });
    m.bronze = S({ color: 0x3e3129, metalness: 0.85, roughness: 0.36 });
    m.steel = S({ color: 0x1c1d1f, metalness: 0.6, roughness: 0.42 });
    m.stain = S({ color: 0xcfd2d5, metalness: 1, roughness: 0.26 });
    m.rubber = S({ color: 0x151515, roughness: 0.88 });
    m.cognac = S({ map: im("/tex/jet_leather.jpg", 1), normalMap: im("/tex/jet_leather_n.jpg"), color: 0xb97c4c, roughness: 0.5 });
    m.cognacS = S({ color: 0x9c6238, roughness: 0.46 });
    m.leatherBk = S({ color: 0x201e1d, roughness: 0.4 });
    m.fabric = S({ color: 0x8c857a, roughness: 1 });
    m.felt = S({ color: 0x1d1a18, roughness: 1 });
    m.plaster = S({ color: 0xece5da, roughness: 0.92 });
    m.marble = S({ color: 0xf3efe8, roughness: 0.22 });
    m.glass = new THREE.MeshStandardMaterial({ color: 0xcfe2ea, transparent: true, opacity: 0.15, roughness: 0.03, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    m.glassCase = new THREE.MeshStandardMaterial({ color: 0xe6f0f2, transparent: true, opacity: 0.22, roughness: 0.02, metalness: 0.05, depthWrite: false });
    m.bglass = S({ color: 0x09090a, roughness: 0.1, metalness: 0.35 });
    m.soil = S({ color: 0x2f241c, roughness: 1 });
    m.gravel = S({ map: terrazzo("gravel", "#6f6457", CHG, 19), roughness: 1 });
    var carpet = im("/tex/jet_carpet.jpg", 1), carpetN = im("/tex/jet_carpet_n.jpg");
    m.runner = S({ map: runnerTex(), normalMap: carpetN, color: 0xd0dcd4, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    m.rug = S({ map: carpet, normalMap: carpetN, color: 0xd9ccb4, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    m.coir = S({ map: carpet, color: 0x5e5246, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    m.onyx = S({ map: onyxTex(), emissiveMap: onyxTex(), emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.25 });
    m.led = new THREE.MeshBasicMaterial({ color: 0xffe6c0 }); m.ledCool = new THREE.MeshBasicMaterial({ color: 0xf4f7ff });
    m.sky = new THREE.MeshBasicMaterial({ color: 0xeaf1f8 });
    m.screen = new THREE.MeshBasicMaterial({ color: 0x1a2a3a });
    m.pool = new THREE.MeshBasicMaterial({ map: poolTex(), color: 0xffd8a2, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    m.scallop = new THREE.MeshBasicMaterial({ map: scallopTex(), color: 0xffd2a0, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    m.sunPatch = new THREE.MeshBasicMaterial({ map: patchTex(), color: 0xffe9c8, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -10 });
    m.shaft = new THREE.MeshBasicMaterial({ map: patchTex(), color: 0xfff1d8, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    m.fire = new THREE.MeshBasicMaterial({ map: panel("flame", 256, 128, function (x, W, H) { var g = x.createLinearGradient(0, H, 0, 0); g.addColorStop(0, "rgba(255,190,90,1)"); g.addColorStop(0.35, "rgba(255,120,30,0.9)"); g.addColorStop(0.8, "rgba(200,60,10,0.25)"); g.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = g; for (var i = 0; i < 26; i++) { var cx = (i + 0.5) / 26 * W, w = W / 26 * (1.2 + Math.random()), h = H * (0.45 + Math.random() * 0.5); x.beginPath(); x.moveTo(cx - w, H); x.quadraticCurveTo(cx - w * 0.3, H - h * 0.6, cx, H - h); x.quadraticCurveTo(cx + w * 0.3, H - h * 0.6, cx + w, H); x.fill(); } }), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    m.embers = S({ color: 0x2a211c, emissive: 0xff5a1a, emissiveIntensity: 0.35, roughness: 0.8 });
    var env = envMap(); for (var k in m) { var mt = m[k]; if (mt && mt.isMeshStandardMaterial && env) { mt.envMap = env; mt.envMapIntensity = mt.metalness > 0.5 ? 0.9 : 0.55; mt.needsUpdate = true; } } [["runner", 0.45], ["rug", 0.4], ["coir", 0.3], ["felt", 0.2], ["fabric", 0.4], ["soil", 0.3], ["gravel", 0.35]].forEach(function (q) { if (m[q[0]]) m[q[0]].envMapIntensity = q[1]; });
    return (PT.M = m);
  }
  // the interior reflection probe: a warm room with the airside glass bright (rotated to the terminal's heading)
  function envMap() {
    try { if (PT.env && PT.envNight !== undefined && Math.abs(PT.envNight - nightK()) < 0.25) return PT.env.texture; var e = TE(); if (!e || typeof pmrem === "undefined") return null; var nk = nightK();
      var sc = new THREE.Scene(); var B = function (col) { return new THREE.MeshBasicMaterial({ color: col, side: THREE.BackSide }); };
      var day = 1 - nk, win = new THREE.Color(0xdfe9f2).multiplyScalar(0.25 + 1.9 * day), wall = new THREE.Color(0xb9aa94).multiplyScalar(0.35 + 0.35 * day), flo = new THREE.Color(0xd8cbb6).multiplyScalar(0.3 + 0.4 * day), ceil = new THREE.Color(0x3a2a1e).multiplyScalar(0.8);
      var room = new THREE.Mesh(new THREE.BoxGeometry(54, 9.5, 54), [B(wall), B(wall), B(ceil), B(flo), B(win), B(wall)]); room.position.y = 4.75; var grp = new THREE.Group(); grp.add(room);
      for (var z = -13; z <= 13; z += 13) { var sk = new THREE.Mesh(new THREE.PlaneGeometry(52, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf2f6fb).multiplyScalar(0.3 + 2.2 * day), side: THREE.DoubleSide })); sk.rotation.x = Math.PI / 2; sk.position.set(0, 9.4, z); grp.add(sk); }
      for (var i = 0; i < 16; i++) { var dl = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(2.5 + 2 * nk), side: THREE.DoubleSide })); dl.rotation.x = Math.PI / 2; dl.position.set(-18 + (i % 4) * 12, 9.3, -18 + (i >> 2) * 12); grp.add(dl); }
      grp.rotation.y = e[3]; sc.add(grp); var rt = pmrem.fromScene(sc, 0.02, 0.1, 100); if (PT.env) PT.env.dispose(); PT.env = rt; PT.envNight = nk; room.geometry.dispose(); return rt.texture;
    } catch (err) { note("env", err); return null; }
  }
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }

  // ───────────────────────── geometry kit: batches static pieces by material, collects explicit solids ─────────────────────────
  function bx(w, h, d, tile) { var g = new THREE.BoxGeometry(w, h, d); if (tile) { var rot = tile < 0, t = Math.abs(tile), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (var f = 0; f < 6; f++) for (var i = 0; i < 4; i++) { var k = f * 4 + i, u = uv.getX(k) * dims[f][0] / t, v = uv.getY(k) * dims[f][1] / t; if (rot) uv.setXY(k, v, u); else uv.setXY(k, u, v); } } return g; }
  function cy(rt, rb, h, seg, tile, open, t0, tl) { var g = new THREE.CylinderGeometry(rt, rb, h, seg || 16, 1, !!open, t0 || 0, tl === undefined ? TAU : tl); if (tile) { var uv = g.attributes.uv, circ = Math.max(rt, rb) * (tl === undefined ? TAU : tl); for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ / tile, uv.getY(i) * h / tile); } return g; }
  function pl(w, h, tile) { var g = new THREE.PlaneGeometry(w, h); if (tile) { var uv = g.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * h / tile); } return g; }
  function mergeGeos(list) {
    var nv = 0, ni = 0, i; for (i = 0; i < list.length; i++) { var g0 = list[i]; if (!g0.attributes.normal) g0.computeVertexNormals(); nv += g0.attributes.position.count; ni += g0.index ? g0.index.count : g0.attributes.position.count; }
    var pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = nv > 65000 ? new Uint32Array(ni) : new Uint16Array(ni), vo = 0, io = 0;
    for (i = 0; i < list.length; i++) { var g = list[i], Pa = g.attributes.position, Na = g.attributes.normal, Ua = g.attributes.uv, c = Pa.count; for (var k = 0; k < c; k++) { pos[(vo + k) * 3] = Pa.getX(k); pos[(vo + k) * 3 + 1] = Pa.getY(k); pos[(vo + k) * 3 + 2] = Pa.getZ(k); nrm[(vo + k) * 3] = Na.getX(k); nrm[(vo + k) * 3 + 1] = Na.getY(k); nrm[(vo + k) * 3 + 2] = Na.getZ(k); if (Ua) { uv[(vo + k) * 2] = Ua.getX(k); uv[(vo + k) * 2 + 1] = Ua.getY(k); } } if (g.index) { var ia = g.index.array; for (var q = 0; q < ia.length; q++) idx[io + q] = ia[q] + vo; io += ia.length; } else { for (var q2 = 0; q2 < c; q2++) idx[io + q2] = vo + q2; io += c; } vo += c; g.dispose(); }
    var geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeBoundingSphere(); geo.computeBoundingBox(); return geo;
  }
  function Kit(g, e) { this.g = g; this.e = e; this.by = new Map(); this.sol = []; this.st = [{ x: 0, z: 0, r: 0, s: 1, y: 0 }]; this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.eu = new THREE.Euler(); this.v = new THREE.Vector3(); this.sv = new THREE.Vector3(); this.tris = 0; }
  Kit.prototype.T = function () { return this.st[this.st.length - 1]; };
  Kit.prototype.pt = function (x, z) { var t = this.T(), c = Math.cos(t.r), s = Math.sin(t.r); return [t.x + (x * c + z * s) * t.s, t.z + (-x * s + z * c) * t.s]; };
  Kit.prototype.push = function (x, z, yaw, sc, y) { var t = this.T(), p = this.pt(x, z); this.st.push({ x: p[0], z: p[1], r: t.r + (yaw || 0), s: t.s * (sc || 1), y: t.y + (y || 0) * t.s }); };
  Kit.prototype.pop = function () { if (this.st.length > 1) this.st.pop(); };
  Kit.prototype.add = function (geo, mat, x, y, z, ry, rx, rz, sx, sy, sz) { var t = this.T(), p = this.pt(x, z); this.eu.set(rx || 0, (ry || 0) + t.r, rz || 0, "YXZ"); this.q.setFromEuler(this.eu); this.sv.set(t.s * (sx || 1), t.s * (sy || 1), t.s * (sz || 1)); this.v.set(p[0], t.y + y * t.s, p[1]); this.m4.compose(this.v, this.q, this.sv); geo.applyMatrix4(this.m4); var a = this.by.get(mat); if (!a) this.by.set(mat, a = []); a.push(geo); return geo; };
  // box standing on y0 (bottom), centred in x and z
  Kit.prototype.box = function (w, h, d, mat, x, y0, z, ry, tile, rx, rz) { return this.add(bx(w, h, d, tile), mat, x, y0 + h / 2, z, ry, rx, rz); };
  Kit.prototype.cyl = function (r0, r1, h, mat, x, y0, z, seg, tile) { return this.add(cy(r0, r1, h, seg, tile), mat, x, y0 + h / 2, z, 0); };
  // flat piece lying on the floor (inlays, pools): w along x, d along z
  Kit.prototype.flat = function (w, d, mat, x, y, z, ry, tile) { return this.add(pl(w, d, tile), mat, x, y, z, ry, -Math.PI / 2); };
  Kit.prototype.solid = function (x, z, w, d, y0, y1, ry, opt) { var t = this.T(), p = this.pt(x, z); var o2 = opt && opt.seat ? { seat: true, face: t.r + (opt.face || 0) } : null; this.sol.push([p[0], p[1], w * t.s, d * t.s, t.y + y0 * t.s, t.y + y1 * t.s, t.r + (ry || 0), o2]); };
  Kit.prototype.done = function () {
    var e = this.e, g = this.g, n = 0; this.by.forEach(function (list, mat) { if (!list.length) return; var geo = mergeGeos(list); var m = new THREE.Mesh(geo, mat); m.userData.noSolid = true; m.userData.ptStatic = true; m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.updateMatrix(); g.add(m); n++; });
    var ns = 0; for (var i = 0; i < this.sol.length; i++) { var s = this.sol[i], w = l2w(e, s[0], s[1]); var sd = addSolid(w[0], w[1], e[3] + s[6], s[2], s[3], e[1] + s[4], e[1] + s[5], "room"); if (sd) { ns++; if (s[7] && s[7].seat) { sd.seat = true; sd.face = e[3] + (s[7].face || 0); } } }
    PT.n.batches = n; PT.n.solids = ns; };

  // ───────────────────────── model helpers ─────────────────────────
  function hasM(k) { try { return !!(MODELS[k] && MODELS[k].parts); } catch (e) { return false; } }
  // a model in room-local coordinates (not batched); size-limited to a slot; its own meshes carry no auto solids
  function model(g, k, lx, y, lz, ry, sc, fitW) { if (!hasM(k)) return null; var m = makeModel(k); var s = sc || 1; if (fitW) { var M0 = MODELS[k]; var w = Math.max(M0.sx || 0, M0.sz || 0) || (M0.radius * 2); if (w > 0) s = Math.min(s, fitW / w); } m.scale.setScalar(s); m.position.set(lx, y, lz); m.rotation.y = ry || 0; m.traverse(function (o) { if (o.isMesh) { o.userData.noSolid = true; o.castShadow = false; o.receiveShadow = true; } }); g.add(m); return m; }
  // plants indoors: their own static material copies (no wind sway indoors)
  function plantModel(g, k, lx, y, lz, ry, h) { if (!hasM(k)) return null; var m = makeModel(k); var H0 = MODELS[k].height || 2; m.scale.setScalar(h / H0); m.position.set(lx, y, lz); m.rotation.y = ry || 0; m.traverse(function (o) { if (o.isMesh && o.material) { var src = o.material; o.material = new THREE.MeshStandardMaterial({ map: src.map || null, normalMap: src.normalMap || null, color: src.color ? src.color.clone() : 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, alphaTest: src.alphaTest || (src.transparent ? 0.4 : 0), transparent: false }); if (PT.env) o.material.envMap = PT.env.texture; o.userData.noSolid = true; o.castShadow = false; } }); g.add(m); return m; }

  // ───────────────────────── the room ─────────────────────────
  function restyleBase(g, base, half, hgt, M) {
    for (var i = 0; i < base.length; i++) { var o = base[i]; if (o.isLight) continue; if (!o.isMesh) continue; var gp = o.geometry && o.geometry.parameters || {}; var t = o.geometry && o.geometry.type;
      if (t === "PlaneGeometry") { o.visible = false; continue; }   // the plain floor and ceiling (mine replace them)
      if (t === "BoxGeometry") { if ((gp.width >= 50 && gp.height >= hgt - 0.1 && gp.depth < 0.5) || (gp.depth >= 50 && gp.height >= hgt - 0.1)) { o.material = M.felt; continue; }   // plain walls: a dark backing behind the cladding
        if (o.position.z > half - 1) { if (gp.width === 0.5 && gp.depth === 0.5) { o.material = M.bronze; continue; } if (gp.height <= 0.7 && gp.width >= 50) { o.material = M.bronze; continue; } o.material = M.glass; o.userData.ptGlass = true; } } }
  }
  function buildRoom(K, M, g, half, hgt) {
    var H = half, i, x, z;
    // floor: cream terrazzo field, a warm grey band down the concourse and the airside axis, brass strips
    K.flat(2 * H, 2 * H, M.terr, 0, F, 0, 0, 2.0);
    K.flat(2 * H, 8, M.terrG, 0, F + 0.002, -0.5, 0, 2.0); K.flat(8, H - 3.5, M.terrG, 0, F + 0.002, (3.5 + H) / 2, 0, 2.0);
    [[-4.5, -H, H], [3.5, -H, -4]].forEach(function (s) { K.box(s[2] - s[1], 0.004, 0.03, M.brass, (s[1] + s[2]) / 2, F, s[0]); }); K.box(H - 4, 0.004, 0.03, M.brass, (4 + H) / 2, F, 3.5);
    [-4, 4].forEach(function (sx) { K.box(0.03, 0.004, H - 3.5, M.brass, sx, F, (3.5 + H) / 2); });
    // the green runner from baggage claim to the landside door (Rosa: follow the green carpet), broken by the 1928 medallion
    [[-19, -14.6, -19, -1.5], [-20, -0.5, -2.45, -0.5], [2.45, -0.5, 25.3, -0.5]].forEach(function (r) { var L = Math.hypot(r[2] - r[0], r[3] - r[1]), ry = Math.atan2(r[2] - r[0], r[3] - r[1]); K.flat(2.0, L, M.runner, (r[0] + r[2]) / 2, F + 0.005, (r[1] + r[3]) / 2, ry, 1.4); [-1.02, 1.02].forEach(function (o) { K.box(0.035, 0.006, L, M.brass, (r[0] + r[2]) / 2 + Math.cos(ry) * o, F, (r[1] + r[3]) / 2 - Math.sin(ry) * o, ry); }); });
    // walls: travertine to 3.4 m, a bronze reveal, walnut slats over black felt to the ceiling
    var wallRun = function (axis, sgn, from, to, skip) {   // axis "z": back/front wall (runs along x); "x": side walls (runs along z)
      var len = to - from, mid = (from + to) / 2;
      var segs = [[from, to]]; if (skip) { segs = []; var a = from; skip.forEach(function (s) { if (s[0] > a) segs.push([a, s[0]]); a = Math.max(a, s[1]); }); if (a < to) segs.push([a, to]); }
      segs.forEach(function (sg) { var L = sg[1] - sg[0], c = (sg[0] + sg[1]) / 2; if (axis === "z") { K.box(L, 3.4, 0.12, M.trav, c, 0, sgn * (H - 0.06), 0, 2.4); K.box(L, 0.1, 0.14, M.bronze, c, 0, sgn * (H - 0.07)); } else { K.box(0.12, 3.4, L, M.trav, sgn * (H - 0.06), 0, c, 0, 2.4); K.box(0.14, 0.1, L, M.bronze, sgn * (H - 0.07), 0, c); } });
      if (axis === "z") { K.box(len, 0.05, 0.16, M.bronze, mid, 3.4, sgn * (H - 0.08)); K.box(len, hgt - 3.45, 0.02, M.felt, mid, 3.45, sgn * (H - 0.01)); for (var q = from + 0.12; q < to; q += 0.24) K.box(0.07, hgt - 3.5, 0.12, M.walnut, q, 3.45, sgn * (H - 0.08), 0, -1.2); }
      else { K.box(0.16, 0.05, len, M.bronze, sgn * (H - 0.08), 3.4, mid); K.box(0.02, hgt - 3.45, len, M.felt, sgn * (H - 0.01), 3.45, mid); for (var q2 = from + 0.12; q2 < to; q2 += 0.24) K.box(0.12, hgt - 3.5, 0.07, M.walnut, sgn * (H - 0.08), 3.45, q2, 0, -1.2); } };
    wallRun("z", -1, -H, H, [[-8.6, 8.6]]);   // back wall (the onyx wall fills the gap)
    wallRun("x", -1, -H, H, [[18.8, 25.2]]);   // SW end (the fireplace fills the gap)
    wallRun("x", 1, -H, H, [[-2.4, 1.4]]);    // NE end (the landside door)
    // ceiling: felt, glulam beams every 9 m, walnut slats between three long skylights, recessed downlights
    var skyZ = [-13, 0, 13], segZ = [[-H, -14.6], [-11.4, -1.6], [1.6, 11.4], [14.6, H]];
    segZ.forEach(function (s) { K.add(pl(2 * H, s[1] - s[0]), M.felt, 0, 9.45, (s[0] + s[1]) / 2, 0, Math.PI / 2); });
    for (x = -22.5; x <= 22.5; x += 9) { K.box(0.36, 0.9, 2 * H, M.walnutD, x, 8.3, 0, 0, 1.2); K.box(0.02, 0.025, 2 * H - 0.4, M.led, x - 0.19, 8.32, 0); K.box(0.02, 0.025, 2 * H - 0.4, M.led, x + 0.19, 8.32, 0); }
    segZ.forEach(function (s) { var L = s[1] - s[0], c = (s[0] + s[1]) / 2; for (var q = -H + 0.15; q < H; q += 0.3) { var near = false; for (var bx2 = -22.5; bx2 <= 22.5; bx2 += 9) if (Math.abs(q - bx2) < 0.3) near = true; if (!near) K.box(0.06, 0.16, L, M.walnut, q, 9.2, c, 0, 1.2); } });
    skyZ.forEach(function (sz) { K.add(pl(2 * H, 3.1), M.sky, 0, 9.95, sz, 0, Math.PI / 2); [-1.5, 1.5].forEach(function (d) { K.box(2 * H, 0.6, 0.06, M.walnut, 0, 9.4, sz + d * 1.03, 0, 1.2); }); [-1, 1].forEach(function (sx) { K.box(0.06, 0.6, 3.2, M.walnut, sx * (H - 0.03), 9.4, sz); }); for (var bx3 = -24; bx3 <= 24; bx3 += 3) K.box(0.05, 0.12, 3, M.bronze, bx3, 9.82, sz); });
    // downlights between the slats: an emissive lens and a soft pool on the floor under each
    PT.downs = []; for (x = -18; x <= 18; x += 9) segZ.forEach(function (s) { for (z = s[0] + 2.2; z < s[1] - 1; z += 4.2) { K.cyl(0.11, 0.11, 0.02, M.led, x, 9.17, z, 14); PT.downs.push([x, z]); } });
    PT.downs.forEach(function (d) { K.flat(4.4, 4.4, M.pool, d[0], F + 0.01, d[1]); });
    // wall washers: scallops of light on the travertine
    for (x = -24; x <= 24; x += 4) { if (Math.abs(x) < 9) continue; K.add(pl(2.4, 4.8), M.scallop, x, 1.0 + 2.4, -H + 0.15, 0); }
    for (z = -24; z <= 24; z += 4) { if (z > 18 && z < 26) continue; K.add(pl(2.4, 4.8), M.scallop, -H + 0.15, 3.4, z, Math.PI / 2); if (z > -3 && z < 2) continue; K.add(pl(2.4, 4.8), M.scallop, H - 0.15, 3.4, z, -Math.PI / 2); }
    // the airside curtain wall: slim bronze fins every 1.5 m, transoms, a sill and the door portal (the client's glass and posts stay the solids)
    for (x = -H + 1.5; x < H; x += 1.5) { if (Math.abs(x) < 4.3 || Math.abs(x % 6) < 0.3) continue; K.box(0.05, hgt - 0.1, 0.18, M.bronze, x, 0.05, H - 0.2); }
    [3.2, 6.4].forEach(function (y) { K.box(H - 4.2, 0.08, 0.14, M.bronze, -(H + 4.2) / 2, y, H - 0.2); K.box(H - 4.2, 0.08, 0.14, M.bronze, (H + 4.2) / 2, y, H - 0.2); }); K.box(8.4, 0.08, 0.14, M.bronze, 0, 6.4, H - 0.2);
    K.box(2 * H, 0.12, 0.3, M.bronze, 0, 0.0, H - 0.25);
    [-4.15, 4.15].forEach(function (sx) { K.box(0.3, 4.1, 0.4, M.bronze, sx, 0, H - 0.25); }); K.box(8.6, 0.36, 0.42, M.bronze, 0, 4.0, H - 0.25); K.box(0.9, 0.08, 0.14, M.stain, 0, 3.9, H - 0.5);
    K.flat(7.6, 1.9, M.coir, 0, F + 0.004, H - 1.2);   // entrance mat
  }

  // ── check-in: the backlit onyx wall with GENESIS ONE in brass, four desks, the bag belts, a walnut header and the queue ──
  function buildCheckin(K, M, g) {
    var zW = -HALF + 0.2;
    K.add(pl(17, 7.0), M.onyx, 0, F + 3.5, zW, 0);
    K.box(0.3, 7.25, 0.26, M.walnut, -8.65, 0, zW, 0, -1.2); K.box(0.3, 7.25, 0.26, M.walnut, 8.65, 0, zW, 0, -1.2); K.box(17.6, 0.3, 0.26, M.walnut, 0, 7.05, zW, 0, 1.2);
    K.box(17.0, 0.06, 0.04, M.brass, 0, 7.04, zW + 0.12); [-8.48, 8.48].forEach(function (sx) { K.box(0.04, 7.0, 0.04, M.brass, sx, F, zW + 0.12); });
    // brass letters (alpha-tested plane with real metal) and a quiet shadow plane behind them
    var lt = panel("gonel", 2048, 256, function (x, W, H) { x.fillStyle = "#000"; x.fillRect(0, 0, W, H); txt(x, "GENESIS ONE", W / 2, H / 2 + 8, "400 214px " + FT.disp, "#fff", 34); }, true);
    var bm = new THREE.MeshStandardMaterial({ color: 0x4a3524, metalness: 0.9, roughness: 0.3, alphaMap: lt, alphaTest: 0.5, envMap: PT.env ? PT.env.texture : null, envMapIntensity: 1.0 }); bm.userData.pt = 1;
    var sm = new THREE.MeshBasicMaterial({ color: 0x3a1e08, alphaMap: lt, transparent: true, opacity: 0.35, depthWrite: false });
    var L1 = new THREE.Mesh(new THREE.PlaneGeometry(13.2, 1.65), bm); L1.position.set(0, 5.75, zW + 0.09); g.add(L1); var S1 = new THREE.Mesh(new THREE.PlaneGeometry(13.2, 1.65), sm); S1.position.set(0.05, 5.7, zW + 0.02); g.add(S1);
    var sub = panel("gone2", 2048, 160, function (x, W, H) { txt(x, "SOLPORT  ·  STELLAR AVIATION FBO  ·  FIELD DGL", W / 2, H / 2, "600 70px " + FT.ui, "#2b1c10", 18); });
    var S2 = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 0.75), new THREE.MeshBasicMaterial({ map: sub, transparent: true, opacity: 0.85, depthWrite: false })); S2.position.set(0, 4.55, zW + 0.05); g.add(S2);
    try { var lg = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.0), new THREE.MeshBasicMaterial({ map: LOGO_TEX, transparent: true, depthWrite: false })); lg.position.set(0, 2.45, zW + 0.05); g.add(lg); } catch (e) { note("logo", e); }
    // four desks (term_checkin when it exists)
    var dx = [-5.4, -1.8, 1.8, 5.4], dz = -21.9;
    if (hasM("term_checkin")) { dx.forEach(function (x0) { model(g, "term_checkin", x0, F, dz, 0, 1, 3.1); K.solid(x0, dz, 2.9, 1.0, 0, 1.1); }); }
    else dx.forEach(function (x0) {
      K.box(2.6, 0.98, 0.72, M.walnut, x0, F, dz, 0, 1.2); K.box(2.36, 0.72, 0.02, M.trav, x0, F + 0.14, dz + 0.37, 0, 2.4); K.box(2.6, 0.08, 0.04, M.brass, x0, F, dz + 0.37);
      K.box(2.7, 0.05, 0.44, M.trav, x0, F + 0.98, dz + 0.16, 0, 2.4); K.box(2.6, 0.04, 0.6, M.walnut, x0, F + 0.74, dz - 0.62, 0, 1.2); K.box(0.06, 0.74, 0.5, M.walnut, x0 - 1.27, F, dz - 0.62); K.box(0.06, 0.74, 0.5, M.walnut, x0 + 1.27, F, dz - 0.62);
      K.box(0.56, 0.36, 0.03, M.bglass, x0 + 0.5, F + 1.02, dz - 0.52); K.box(0.04, 0.16, 0.04, M.steel, x0 + 0.5, F + 0.78, dz - 0.5); K.add(pl(0.52, 0.32), M.screen, x0 + 0.5, F + 1.2, dz - 0.54, Math.PI);
      K.box(0.3, 0.14, 0.24, M.steel, x0 - 0.6, F + 0.78, dz - 0.55); K.solid(x0, dz - 0.1, 2.7, 1.0, 0, 1.1); });
    // bag belts between the desks (stainless well, black rubber top)
    [-7.25, -3.6, 0, 3.6].forEach(function (x0) { K.box(0.6, 0.3, 1.2, M.stain, x0, F, dz + 0.05); K.box(0.56, 0.02, 1.16, M.rubber, x0, F + 0.3, dz + 0.05); K.solid(x0, dz + 0.05, 0.6, 1.2, 0, 0.8); });
    // the floating walnut header with the backlit CHECK-IN fascia
    K.box(15.2, 0.42, 1.4, M.walnut, 0, 3.3, dz - 0.3, 0, 1.2); [-6, -2, 2, 6].forEach(function (x0) { K.box(0.02, 5.8, 0.02, M.steel, x0, 3.72, dz - 0.3); });
    var hd = panel("ckin", 2048, 64, function (x, W, H) { x.fillStyle = "#15110d"; x.fillRect(0, 0, W, H); txt(x, "CHECK-IN  ·  BAG DROP", W * 0.5, H / 2 + 1, "600 36px " + FT.ui, "#f5e7c8", 10); [-5.4, -1.8, 1.8, 5.4].forEach(function (x0, i) { txt(x, String(i + 1), W * (0.5 + x0 / 15.2), H / 2 + 1, "600 34px " + FT.ui, "#f4cd5a", 0); }); });
    var hp = new THREE.Mesh(new THREE.PlaneGeometry(15.2, 0.42), new THREE.MeshBasicMaterial({ map: hd })); hp.position.set(0, 3.51, dz + 0.41); g.add(hp);
    K.box(15.0, 0.02, 1.2, M.led, 0, 3.29, dz - 0.3);
    // the queue: brass posts with black leather belts, gaps in front of each desk
    [[-7.4, -6.3], [-4.6, -2.6], [-1.0, 1.0], [2.6, 4.6], [6.3, 7.4]].forEach(function (s) { var z0 = -18.9; [s[0], s[1]].forEach(function (px) { K.cyl(0.028, 0.028, 0.95, M.brass, px, F, z0, 10); K.cyl(0.17, 0.17, 0.02, M.brass, px, F, z0, 18); K.cyl(0.04, 0.04, 0.05, M.brass, px, F + 0.95, z0, 10); }); K.box(s[1] - s[0], 0.05, 0.012, M.leatherBk, (s[0] + s[1]) / 2, F + 0.86, z0); });
  }

  // ── baggage claim: a racetrack carousel fed through the back wall, the moving bags, trolleys, a bench, the arrivals board ──
  function racetrack(a, R) { var s = new THREE.Shape(); s.moveTo(-a, -R); s.lineTo(a, -R); s.absarc(a, 0, R, -Math.PI / 2, Math.PI / 2, false); s.lineTo(-a, R); s.absarc(-a, 0, R, Math.PI / 2, 3 * Math.PI / 2, false); return s; }
  function ringShape(a, R0, R1) { var s = racetrack(a, R1); var h = new THREE.Path(); h.moveTo(-a, -R0); h.absarc(-a, 0, R0, 3 * Math.PI / 2, Math.PI / 2, true); h.lineTo(a, R0); h.absarc(a, 0, R0, Math.PI / 2, -Math.PI / 2, true); h.lineTo(-a, -R0); s.holes.push(h); return s; }
  function flatShape(shape, depth, curve) { var g = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false, curveSegments: curve || 24 }); g.rotateX(-Math.PI / 2); return g; }   // shape (x, y) -> floor (x, -y), rising depth
  function buildBaggage(K, M, g) {
    var cx = -19, cz = -19.2, a = 3.1, R = 2.3; PT.car = { cx: cx, cz: cz, a: a, R: R };
    if (hasM("term_carousel")) { model(g, "term_carousel", cx, F, cz, Math.PI / 2, 1, 11); }
    else { K.add(flatShape(racetrack(a, R + 0.05), 0.34), M.stain, cx, F, cz, 0); K.add(flatShape(ringShape(a, R - 0.72, R + 0.02), 0.05), M.rubber, cx, F + 0.34, cz, 0); K.add(flatShape(racetrack(a, R - 0.74), 0.12), M.stain, cx, F + 0.34, cz, 0); K.add(flatShape(ringShape(a, R + 0.05, R + 0.13), 0.1), M.bronze, cx, F + 0.26, cz, 0); K.add(flatShape(racetrack(a, R - 0.9), 0.02), M.bronze, cx, F + 0.46, cz, 0); }
    K.solid(cx, cz, 2 * a + 0.4, 2 * R + 0.2, 0, 0.9); K.solid(cx - a, cz, 3.3, 3.3, 0, 0.9, Math.PI / 4); K.solid(cx + a, cz, 3.3, 3.3, 0, 0.9, Math.PI / 4);
    // the feed chute from the wall portal down onto the belt
    var zA = -HALF + 0.2, zB = cz - R + 0.5, L = zB - zA, ang = Math.atan2(1.05 - 0.42, L); K.add(bx(1.2, 0.08, Math.hypot(L, 0.63)), M.stain, cx, F + (1.05 + 0.42) / 2, (zA + zB) / 2, 0, ang); [-0.62, 0.62].forEach(function (sx) { K.add(bx(0.05, 0.3, Math.hypot(L, 0.63)), M.stain, cx + sx, F + (1.05 + 0.42) / 2 + 0.12, (zA + zB) / 2, 0, ang); });
    K.solid(cx, (zA + zB) / 2, 1.4, L, 0, 1.3);
    K.box(2.2, 0.16, 0.2, M.bronze, cx, F + 2.0, -HALF + 0.2); [-1.02, 1.02].forEach(function (sx) { K.box(0.16, 2.0, 0.2, M.bronze, cx + sx, F, -HALF + 0.2); }); K.box(1.9, 1.95, 0.02, M.felt, cx, F, -HALF + 0.21);
    for (var i = 0; i < 9; i++) K.box(0.19, 1.2, 0.012, M.rubber, cx - 0.84 + i * 0.21, F + 0.75, -HALF + 0.26 + (i % 2) * 0.01);
    // bags: one instanced mesh, animated along the belt
    var bagParts = [bx(1, 1, 1)]; var hb = bx(0.34, 0.07, 0.07); hb.translate(0, 0.53, 0); bagParts.push(hb); [-0.13, 0.13].forEach(function (o) { var p0 = bx(0.04, 0.06, 0.05); p0.translate(o, 0.5, 0); bagParts.push(p0); }); [[-0.47, -0.47], [0.47, -0.47], [-0.47, 0.47], [0.47, 0.47]].forEach(function (c2) { var cg = bx(0.08, 1.02, 0.08); cg.translate(c2[0], 0, c2[1]); bagParts.push(cg); }); var zp = bx(1.02, 0.02, 1.02); zp.translate(0, 0.1, 0); bagParts.push(zp); var bagG = mergeGeos(bagParts); var bm = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, envMap: PT.env ? PT.env.texture : null, envMapIntensity: 0.5 }); var N = 11; var im = new THREE.InstancedMesh(bagG, bm, N); im.userData.noSolid = true; im.frustumCulled = false;
    var cols = [0x1d2a44, 0x1b1b1d, 0x3a3d42, 0x6e1f24, 0xb9bcc0, 0x3f4a37, 0x9a6a43, 0x2a4d6e, 0x141414, 0x7a7f86, 0xc9a071]; var bags = []; for (var b = 0; b < N; b++) { im.setColorAt(b, new THREE.Color(cols[b])); bags.push({ s: b / N, w: 0.42 + RND() * 0.2, l: 0.62 + RND() * 0.18, h: 0.22 + RND() * 0.1, r: (RND() - 0.5) * 0.5 }); } if (im.instanceColor) im.instanceColor.needsUpdate = true; g.add(im); PT.bags = { im: im, list: bags, perim: 4 * a + TAU * (R - 0.36) };
    // arrivals board over the carousel, the carousel totem, trolleys, a bench facing the belt
    var arr = panel("arrb", 1024, 460, function (x, W, H) { x.fillStyle = "#07090b"; x.fillRect(0, 0, W, H); x.fillStyle = "#b99a62"; x.fillRect(0, 0, W, 4); txt(x, "ARRIVALS", 40, 52, "600 46px " + FT.ui, "#f4cd5a", 8, "left"); txt(x, "BAGGAGE CLAIM  1", W - 40, 52, "600 30px " + FT.ui, "#f5f1e6", 6, "right"); var rows = [["GB 001", "GIVEBACK ONE", "LANDED", "#4DDE6F"], ["GB 204", "PHOENIX SKY HARBOR", "ON TIME", "#f5f1e6"], ["FA 118", "RENO-TAHOE", "ON TIME", "#f5f1e6"], ["GB 318", "LOS ANGELES", "DELAYED", "#ff9a6a"], ["GB 442", "DENVER", "ON TIME", "#f5f1e6"]]; rows.forEach(function (r, i) { var y = 128 + i * 64; x.fillStyle = i % 2 ? "#0c1014" : "#10151a"; x.fillRect(24, y - 28, W - 48, 56); txt(x, r[0], 44, y, "600 30px " + FT.mono, "#f4cd5a", 2, "left"); txt(x, r[1], 220, y, "600 30px " + FT.ui, "#f5f1e6", 3, "left"); txt(x, r[2], W - 44, y, "600 28px " + FT.mono, r[3], 3, "right"); }); });
    K.box(5.4, 2.5, 0.12, M.bglass, cx, F + 3.7, -HALF + 0.22); var ab = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.34), new THREE.MeshBasicMaterial({ map: arr })); ab.position.set(cx, F + 4.95, -HALF + 0.29); g.add(ab);
    var tot = panel("carT", 256, 768, function (x, W, H) { x.fillStyle = "#08090a"; x.fillRect(0, 0, W, H); txt(x, "1", W / 2, 170, "400 230px " + FT.disp, "#f4cd5a", 0); txt(x, "BAGGAGE", W / 2, 330, "600 34px " + FT.ui, "#f5f1e6", 6); txt(x, "CLAIM", W / 2, 372, "600 34px " + FT.ui, "#f5f1e6", 6); x.fillStyle = "#1a1e22"; x.fillRect(24, 430, W - 48, 2); txt(x, "GB 001", W / 2, 490, "600 30px " + FT.mono, "#f4cd5a", 2); txt(x, "GIVEBACK ONE", W / 2, 540, "600 24px " + FT.ui, "#f5f1e6", 2); txt(x, "BAGS ON BELT", W / 2, 600, "600 24px " + FT.mono, "#4DDE6F", 2); });
    K.box(0.66, 2.3, 0.3, M.walnut, -12.9, F, -21.6, -Math.PI / 2, -1.2); var tp = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.5), new THREE.MeshBasicMaterial({ map: tot })); tp.position.set(-12.74, F + 1.45, -21.6); tp.rotation.y = Math.PI / 2; g.add(tp); K.solid(-12.9, -21.6, 0.66, 0.3, 0, 2.3, -Math.PI / 2);
    for (var t = 0; t < 6; t++) trolley(K, M, -26.1, -23.6 + t * 0.34, Math.PI / 2); K.solid(-26.1, -22.75, 1.0, 2.8, 0, 1.1);
    var dx0 = -12.0, dzW = -HALF + 0.16; K.box(2.9, 0.3, 0.3, M.bronze, dx0, F + 2.7, dzW); [-1.35, 1.35].forEach(function (o) { K.box(0.2, 2.7, 0.3, M.bronze, dx0 + o, F, dzW); }); K.box(2.5, 2.68, 0.04, M.felt, dx0, F, dzW + 0.0); [-0.62, 0.62].forEach(function (o) { K.box(1.2, 2.62, 0.05, M.glassCase, dx0 + o, F + 0.02, dzW + 0.05); K.box(0.04, 1.0, 0.06, M.stain, dx0 + o * 0.12, F + 0.7, dzW + 0.1); });
    var ad = panel("arrDoor", 1024, 160, function (x, W, H) { x.fillStyle = "#101112"; x.fillRect(0, 0, W, H); picto(x, "plane", 90, H / 2, 110, "#f5f1e6"); txt(x, "ARRIVALS  ·  FROM GATE A2", W / 2 + 40, H / 2 + 2, "600 58px " + FT.ui, "#f5f1e6", 8); }); var adp = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.45), new THREE.MeshBasicMaterial({ map: ad })); adp.position.set(dx0, F + 3.25, dzW + 0.16); adp.userData.noSolid = true; g.add(adp);
    bench(K, M, -21.2, -13.7, Math.PI, 3.0);
  }
  function trolley(K, M, x, z, ry) { K.push(x, z, ry, 1, F); K.box(0.56, 0.03, 0.8, M.stain, 0, 0.12, 0); [-0.24, 0.24].forEach(function (sx) { [-0.34, 0.34].forEach(function (sz) { K.add(cy(0.07, 0.07, 0.04, 12), M.rubber, sx, 0.07, sz, 0, 0, Math.PI / 2); }); K.box(0.03, 0.95, 0.03, M.stain, sx, 0.12, -0.38); K.box(0.02, 0.02, 0.62, M.stain, sx, 0.5, -0.08); }); K.box(0.56, 0.03, 0.03, M.stain, 0, 1.07, -0.4); K.box(0.6, 0.05, 0.05, M.rubber, 0, 1.09, -0.42); K.box(0.52, 0.42, 0.02, M.stain, 0, 0.5, -0.38); K.pop(); }
  function bench(K, M, x, z, ry, len) { K.push(x, z, ry, 1, F); K.box(len, 0.08, 0.52, M.walnut, 0, 0.38, 0, 0, 1.2); [-len / 2 + 0.25, len / 2 - 0.25].forEach(function (sx) { K.box(0.08, 0.38, 0.46, M.bronze, sx, 0, 0); }); var n = Math.max(1, Math.round(len / 0.8)); for (var i = 0; i < n; i++) K.solid(-len / 2 + (i + 0.5) * len / n, 0, len / n - 0.05, 0.5, 0, 0.46, 0, { seat: true, face: 0 }); K.pop(); }

  // ── information desk: a travertine and walnut ring with a lit totem, the halo pendant, two flight-information pylons ──
  function buildInfo(K, M, g) {
    var cx = 0, cz = -10.5, R0 = 1.45, R1 = 2.05, t0 = -2.55, tl = 5.1;
    if (hasM("term_info")) { model(g, "term_info", cx, F, cz, 0, 1, 4.4); }
    else { K.add(cy(R1, R1 - 0.05, 1.0, 48, 2.4, true, t0, tl), M.trav, cx, F + 0.5, cz, 0); K.add(cy(R0, R0, 1.0, 40, 1.2, true, t0, tl), M.walnut, cx, F + 0.5, cz, 0); K.add(cy(R1 + 0.02, R1 + 0.02, 0.07, 48, 0, true, t0, tl), M.brass, cx, F + 0.12, cz, 0);
      var top = new THREE.Shape(); top.absarc(0, 0, R1 + 0.06, 0, TAU, false); var hole = new THREE.Path(); hole.absarc(0, 0, R0 - 0.04, 0, TAU, true); top.holes.push(hole); K.add(flatShape(top, 0.05, 48), M.walnut, cx, F + 1.0, cz, 0);
      [t0, t0 + tl].forEach(function (a) { K.box(0.62, 1.0, 0.08, M.walnut, cx + Math.sin(a) * (R0 + R1) / 2, F, cz + Math.cos(a) * (R0 + R1) / 2, a + Math.PI / 2); }); }
    [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4].forEach(function (a) { K.solid(cx, cz, 4.2, 2.5, 0, 1.1, a); });
    K.box(0.34, 3.0, 0.34, M.walnut, cx, F, cz - 0.3); K.box(0.9, 0.9, 0.9, M.bglass, cx, F + 3.0, cz - 0.3);
    var it = panel("infoC", 512, 512, function (x, W, H) { x.fillStyle = "#101112"; x.fillRect(0, 0, W, H); picto(x, "info", W / 2, 190, 190, "#f4cd5a"); txt(x, "INFORMATION", W / 2, 390, "600 52px " + FT.ui, "#f5f1e6", 6); });
    var im = new THREE.MeshBasicMaterial({ map: it }); for (var i = 0; i < 4; i++) { var p = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.84), im); var a = i * Math.PI / 2; p.position.set(cx + Math.sin(a) * 0.46, F + 3.45, cz - 0.3 + Math.cos(a) * 0.46); p.rotation.y = a; g.add(p); }
    [-0.7, 0.7].forEach(function (sx) { K.box(0.5, 0.32, 0.03, M.bglass, cx + sx, F + 1.06, cz + 1.0, sx * 0.3); });
    // the halo: a brass ring with a warm LED inner ring, on three cables
    K.add(new THREE.TorusGeometry(3.2, 0.06, 8, 72), M.brass, cx, F + 5.2, cz, 0, Math.PI / 2); K.add(new THREE.TorusGeometry(3.12, 0.025, 6, 72), M.led, cx, F + 5.17, cz, 0, Math.PI / 2);
    for (var c = 0; c < 3; c++) { var ca = c / 3 * TAU; K.box(0.012, 9.2 - 5.26, 0.012, M.steel, cx + Math.sin(ca) * 3.2, F + 5.26, cz + Math.cos(ca) * 3.2); }
    // flight information pylons: departures facing the concourse, arrivals on the back
    var dep = fids("depP", "DEPARTURES", [["GB 204", "PHOENIX SKY HARBOR", "A2", "BOARDING", "#4DDE6F"], ["GB 101", "TUCSON", "A2", "ON TIME", "#f5f1e6"], ["FA 220", "RENO-TAHOE", "A2", "ON TIME", "#f5f1e6"], ["GB 318", "LOS ANGELES", "A2", "10:40", "#f5f1e6"], ["GB 442", "DENVER", "A2", "DELAYED", "#ff9a6a"], ["GB 511", "SAN DIEGO", "A2", "12:15", "#f5f1e6"], ["GB 629", "LAS VEGAS", "A2", "13:05", "#f5f1e6"], ["GB 880", "MEXICO CITY", "A2", "CHECK-IN", "#f4cd5a"]]);
    var arv = fids("arrP", "ARRIVALS", [["GB 001", "GIVEBACK ONE", "BELT 1", "LANDED", "#4DDE6F"], ["FA 118", "RENO-TAHOE", "BELT 1", "ON TIME", "#f5f1e6"], ["GB 205", "PHOENIX SKY HARBOR", "BELT 1", "ON TIME", "#f5f1e6"], ["GB 319", "LOS ANGELES", "BELT 1", "DELAYED", "#ff9a6a"], ["GB 443", "DENVER", "BELT 1", "11:55", "#f5f1e6"], ["GB 512", "SAN DIEGO", "BELT 1", "13:20", "#f5f1e6"], ["GB 630", "LAS VEGAS", "BELT 1", "14:10", "#f5f1e6"], ["GB 881", "MEXICO CITY", "BELT 1", "15:45", "#f5f1e6"]]);
    [-3.2, 3.2].forEach(function (px, i) { var pz = -6.4; K.box(1.2, 2.7, 0.3, M.walnut, px, F, pz, 0, -1.2); K.box(1.3, 0.06, 0.4, M.bronze, px, F, pz); K.box(1.1, 1.9, 0.02, M.bglass, px, F + 0.72, pz + 0.155); K.box(1.1, 1.9, 0.02, M.bglass, px, F + 0.72, pz - 0.155);
      var a1 = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 1.84), new THREE.MeshBasicMaterial({ map: i ? arv : dep })); a1.position.set(px, F + 1.67, pz + 0.168); g.add(a1); var a2 = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 1.84), new THREE.MeshBasicMaterial({ map: i ? dep : arv })); a2.position.set(px, F + 1.67, pz - 0.168); a2.rotation.y = Math.PI; g.add(a2); K.solid(px, pz, 1.2, 0.34, 0, 2.7); });
  }
  function fids(key, title, rows) { return panel(key, 512, 900, function (x, W, H) { x.fillStyle = "#06080a"; x.fillRect(0, 0, W, H); x.fillStyle = "#b99a62"; x.fillRect(0, 0, W, 5); txt(x, title, 26, 56, "600 40px " + FT.ui, "#f4cd5a", 6, "left"); txt(x, "DGL", W - 26, 56, "600 26px " + FT.mono, "#8f969c", 4, "right"); rows.forEach(function (r, i) { var y = 140 + i * 92; x.fillStyle = i % 2 ? "#0b0f13" : "#0f1419"; x.fillRect(14, y - 36, W - 28, 80); txt(x, r[0], 28, y - 10, "600 26px " + FT.mono, "#f4cd5a", 1, "left"); txt(x, r[2], W - 28, y - 10, "600 22px " + FT.mono, "#8f969c", 1, "right"); txt(x, r[1], 28, y + 22, "600 26px " + FT.ui, "#f5f1e6", 1, "left", W - 200); txt(x, r[3], W - 28, y + 22, "600 24px " + FT.mono, r[4], 1, "right"); }); }); }

  // ── the Sky Cafe and Genesis Roasters: a fluted walnut counter, pastry case, espresso machine, back bar, four tables ──
  function buildCafe(K, M, g) {
    var x0 = -23.0, z0 = 7.4, z1 = 15.4, zc = (z0 + z1) / 2, L = z1 - z0;
    if (hasM("term_cafe")) { model(g, "term_cafe", -23.8, F, zc, Math.PI / 2, 1, 9); K.solid(-23.8, zc, 5.4, L, 0, 1.2); }
    else {
      K.box(0.9, 0.98, L, M.walnut, x0, F, zc, 0, 1.2); for (var q = z0 + 0.06; q < z1; q += 0.09) K.box(0.03, 0.9, 0.05, M.walnut, x0 + 0.46, F + 0.04, q, 0, -1.2);
      K.box(1.06, 0.05, L + 0.1, M.trav, x0 + 0.03, F + 0.98, zc, 0, 2.4); K.add(cy(0.025, 0.025, L - 0.4, 10), M.brass, x0 + 0.62, F + 0.2, zc, 0, Math.PI / 2); [z0 + 0.4, zc, z1 - 0.4].forEach(function (bz) { K.box(0.2, 0.03, 0.03, M.brass, x0 + 0.53, F + 0.19, bz); });
      K.box(0.9, 0.08, L, M.bronze, x0, F, zc);
      // pastry case
      K.box(0.62, 0.08, 1.9, M.bronze, x0 - 0.05, F + 1.03, 11.2); K.box(0.58, 0.46, 1.86, M.glassCase, x0 - 0.05, F + 1.11, 11.2); K.box(0.5, 0.015, 1.8, M.marble, x0 - 0.05, F + 1.3, 11.2); K.box(0.5, 0.02, 1.8, M.led, x0 - 0.05, F + 1.55, 11.2);
      var pc = [M.cognacS, M.brass, M.marble, M.walnut]; for (var p = 0; p < 12; p++) K.add(new THREE.SphereGeometry(0.06 + (p % 3) * 0.015, 10, 6), pc[p % 4], x0 - 0.05 + ((p % 2) - 0.5) * 0.2, F + 1.17 + (p > 5 ? 0.2 : 0), 10.45 + (p % 6) * 0.3, 0, 0, 0, 1.3, 0.55, 1);
      // espresso machine and grinders
      var bb = -26.4; K.box(0.55, 0.42, 0.85, M.stain, bb, F + 0.94, 9.2); K.box(0.57, 0.06, 0.87, M.bronze, bb, F + 1.36, 9.2); [-0.26, 0, 0.26].forEach(function (dz2) { K.add(cy(0.045, 0.045, 0.12, 12), M.stain, bb + 0.3, F + 1.1, 9.2 + dz2, 0, 0, Math.PI / 2); }); for (var cu = 0; cu < 6; cu++) K.cyl(0.04, 0.035, 0.08, M.marble, bb - 0.12 + (cu % 2) * 0.12, F + 1.42, 8.95 + (cu >> 1) * 0.12, 10);
      [8.0, 8.35].forEach(function (gz) { K.cyl(0.08, 0.1, 0.34, M.steel, bb, F + 0.94, gz, 12); K.add(cy(0.07, 0.04, 0.18, 12), M.glassCase, bb, F + 1.37, gz, 0); });
      K.solid(x0, zc, 0.95, L, 0, 1.1);
    }
    // back bar on the wall: cabinets, three shelves, cups and bags of coffee, the menu board
    K.box(0.6, 0.9, L, M.walnut, -26.55, F, zc, 0, 1.2); K.box(0.62, 0.04, L, M.marble, -26.55, F + 0.9, zc);
    [1.55, 2.05, 2.55].forEach(function (y, i) { K.box(0.36, 0.04, L - 1.2, M.walnut, -26.72, F + y, zc, 0, 1.2); K.box(0.02, 0.02, L - 1.2, M.led, -26.56, F + y - 0.03, zc); for (var j = 0; j < 18; j++) { var jz = z0 + 0.9 + j * (L - 1.8) / 17; if (i === 1) K.box(0.14, 0.24, 0.12, [M.cognacS, M.felt, M.brass][j % 3], -26.72, F + y + 0.02, jz); else K.cyl(0.045, 0.04, 0.1, M.marble, -26.72, F + y + 0.02, jz, 10); } });
    var menu = panel("menu", 1024, 512, function (x, W, H) { x.fillStyle = "#15110d"; x.fillRect(0, 0, W, H); x.strokeStyle = "#b99a62"; x.lineWidth = 4; x.strokeRect(14, 14, W - 28, H - 28); txt(x, "SKY CAFE", W / 2, 80, "400 72px " + FT.disp, "#f4cd5a", 8); txt(x, "GENESIS ROASTERS COFFEE", W / 2, 136, "600 26px " + FT.ui, "#d8c8a8", 8); var L1 = ["Espresso", "Cortado", "Flat white", "Cold brew", "Prickly pear tea"], L2 = ["Breakfast burritos", "Green chile scones", "Pastries", "Mesquite honey toast", "Fresh juice"]; lines(x, L1, W * 0.27, 220, 52, "600 32px " + FT.ui, "#f5f1e6", 1); lines(x, L2, W * 0.73, 220, 52, "600 32px " + FT.ui, "#f5f1e6", 1); });
    var mp = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshBasicMaterial({ map: menu })); mp.position.set(-26.83, F + 3.28 - 0.62, 13.2); mp.rotation.y = Math.PI / 2; g.add(mp); K.box(0.06, 1.4, 2.7, M.walnut, -26.9, F + 1.95, 13.2);
    // walnut canopy over the counter with the lit name (kept low, under the 1928 wall)
    K.box(4.8, 0.3, L, M.walnut, -24.55, F + 3.05, zc, 0, 1.2); K.box(4.7, 0.02, L - 0.2, M.plaster, -24.55, F + 3.04, zc);
    var sn = panel("cafeN", 2048, 128, function (x, W, H) { x.fillStyle = "#1a120c"; x.fillRect(0, 0, W, H); txt(x, "SKY CAFE  ·  GENESIS ROASTERS", W / 2, H / 2 + 2, "600 64px " + FT.ui, "#f4d9a0", 14); });
    var sp = new THREE.Mesh(new THREE.PlaneGeometry(L, 0.3), new THREE.MeshBasicMaterial({ map: sn })); sp.position.set(-22.14, F + 3.2, zc); sp.rotation.y = Math.PI / 2; g.add(sp);
    // three brass drum pendants over the counter
    [9.0, 11.4, 13.8].forEach(function (pz) { K.cyl(0.26, 0.26, 0.32, M.brass, -23.0, F + 2.3, pz, 20); K.cyl(0.22, 0.22, 0.02, M.led, -23.0, F + 2.29, pz, 18); K.box(0.01, 0.43, 0.01, M.steel, -23.0, F + 2.62, pz); });
    // four tables with walnut chairs (the chairs are seats)
    [[-18.6, 8.8], [-18.6, 12.8], [-15.2, 8.8], [-15.2, 12.8]].forEach(function (tp, i) { K.cyl(0.4, 0.4, 0.035, M.marble, tp[0], F + 0.72, tp[1], 28); K.cyl(0.045, 0.045, 0.7, M.bronze, tp[0], F + 0.02, tp[1], 10); K.cyl(0.26, 0.28, 0.03, M.bronze, tp[0], F, tp[1], 20); K.solid(tp[0], tp[1], 0.8, 0.8, 0, 0.8);
      [-1, 1].forEach(function (sd) { chair(K, M, tp[0] + sd * 0.78, tp[1], sd > 0 ? -Math.PI / 2 : Math.PI / 2, true); }); });
  }
  function chair(K, M, x, z, face, seat) { K.push(x, z, face, 1, F); K.box(0.46, 0.06, 0.46, M.walnut, 0, 0.4, 0, 0, 1.2); K.box(0.44, 0.05, 0.42, M.cognacS, 0, 0.46, 0.01); K.box(0.46, 0.44, 0.05, M.walnut, 0, 0.46, -0.22, 0, 1.2); [-0.2, 0.2].forEach(function (sx) { [-0.2, 0.2].forEach(function (sz) { K.box(0.04, 0.4, 0.04, M.walnut, sx, 0, sz); }); }); if (seat !== false) K.solid(0, 0, 0.46, 0.46, 0, 0.5, 0, { seat: true, face: 0 }); else K.solid(0, 0, 0.46, 0.46, 0, 0.5); K.pop(); }

  // ── the Giveback Lounge: oak floor, a fireplace in travertine, cognac sofas, club chairs by the glass, globe pendants ──
  function buildLounge(K, M, g) {
    K.flat(14.2, 10.2, M.oak, -19.5, F + 0.003, 21.9, 0, 2.4);
    [[-19.5, 16.8, 14.2, 0.03], [-12.4, 21.9, 0.03, 10.2]].forEach(function (s) { K.box(s[2], 0.004, s[3], M.brass, s[0], F, s[1]); });
    // divider credenza with planting toward the cafe, glass screen above
    K.box(11.0, 0.9, 0.5, M.walnut, -21.1, F, 16.8, 0, 1.2); K.box(11.1, 0.04, 0.56, M.trav, -21.1, F + 0.9, 16.8, 0, 2.4); K.box(11.0, 1.1, 0.02, M.glass, -21.1, F + 0.94, 16.8); K.box(11.0, 0.04, 0.04, M.bronze, -21.1, F + 2.04, 16.8); K.solid(-21.1, 16.8, 11.0, 0.55, 0, 2.05);
    // fireplace
    var fz = 22, fx = -HALF + 0.35; K.box(0.7, 2.6, 6.4, M.trav, fx, 0, fz, 0, 2.4); K.box(0.1, 0.62, 4.2, M.felt, fx + 0.33, F + 0.55, fz); K.box(0.05, 0.05, 4.3, M.brass, fx + 0.37, F + 1.18, fz); K.box(0.05, 0.05, 4.3, M.brass, fx + 0.37, F + 0.52, fz);
    K.box(0.2, 0.08, 4.0, M.embers, fx + 0.33, F + 0.58, fz); K.box(1.3, 0.1, 6.6, M.trav, fx + 0.3, 0, fz, 0, 2.4); K.solid(fx + 0.3, fz, 1.3, 6.6, 0, 2.6);
    var fire = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 0.5), M.fire); fire.position.set(fx + 0.42, F + 0.86, fz); fire.rotation.y = Math.PI / 2; fire.userData.noSolid = true; g.add(fire); var fire2 = fire.clone(); fire2.position.x += 0.02; fire2.scale.set(0.97, 1.2, 1); g.add(fire2); PT.fire = [fire, fire2];
    // art over the fireplace: a painted desert at dusk
    var art = panel("art", 1024, 448, function (x, W, H) { var gg = x.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, "#2b3552"); gg.addColorStop(0.45, "#b86a4a"); gg.addColorStop(0.62, "#e9b27a"); gg.addColorStop(1, "#6d4a35"); x.fillStyle = gg; x.fillRect(0, 0, W, H); var R = rng(8); [["#8b5a44", 0.58, 0.18], ["#5e3c30", 0.68, 0.12], ["#3b2620", 0.8, 0.08]].forEach(function (lyr) { x.fillStyle = lyr[0]; x.beginPath(); x.moveTo(0, H); var y = H * lyr[1]; for (var xx = 0; xx <= W; xx += 16) { y += (R() - 0.5) * H * lyr[2] * 0.5; y = clamp(y, H * (lyr[1] - 0.12), H * (lyr[1] + 0.06)); if (R() < 0.08) y -= H * 0.1; x.lineTo(xx, y); } x.lineTo(W, H); x.closePath(); x.fill(); }); x.fillStyle = "rgba(255,230,180,0.85)"; x.beginPath(); x.arc(W * 0.72, H * 0.5, 26, 0, TAU); x.fill(); });
    K.box(0.08, 2.5, 5.2, M.walnut, -HALF + 0.2, F + 3.7, fz); var ap = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 2.2), new THREE.MeshBasicMaterial({ map: art })); ap.position.set(-HALF + 0.25, F + 4.95, fz); ap.rotation.y = Math.PI / 2; g.add(ap);
    var ln = panel("lngN", 1024, 128, function (x, W, H) { x.fillStyle = "#000"; x.fillRect(0, 0, W, H); txt(x, "GIVEBACK LOUNGE", W / 2, H / 2 + 4, "400 92px " + FT.disp, "#fff", 18); }, true);
    var lm = new THREE.MeshStandardMaterial({ color: 0xe8cf98, metalness: 1, roughness: 0.25, alphaMap: ln, alphaTest: 0.5, envMap: PT.env ? PT.env.texture : null }); var lp = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.45), lm); lp.position.set(fx + 0.36, F + 2.05, fz); lp.rotation.y = Math.PI / 2; g.add(lp);
    // rug, sofa facing the fire, two club chairs, a long table; a pair of chairs by the glass
    K.flat(5.6, 4.6, M.rug, -22.6, F + 0.005, fz, 0, 2.0);
    sofa(K, M, -20.3, fz, -Math.PI / 2, 3); club(K, M, -23.6, fz - 2.2, 0); club(K, M, -23.6, fz + 2.2, Math.PI, true); K.box(1.5, 0.08, 0.8, M.walnut, -23.4, F + 0.36, fz, Math.PI / 2, 1.2); K.box(1.4, 0.34, 0.7, M.bronze, -23.4, F + 0.02, fz, Math.PI / 2); K.solid(-23.4, fz, 0.8, 1.5, 0, 0.8);
    club(K, M, -17.3, 25.1, 0); club(K, M, -15.3, 25.1, 0); K.cyl(0.3, 0.3, 0.5, M.brass, -16.3, F, 25.2, 20); K.solid(-16.3, 25.2, 0.6, 0.6, 0, 0.8);
    club(K, M, -14.3, 19.3, -Math.PI / 2); club(K, M, -14.3, 21.3, -Math.PI / 2);
    // globe pendants
    for (var i = 0; i < 7; i++) { var px = -24.5 + (i % 4) * 2.2 + (i > 3 ? 1.1 : 0), pz = fz - 1.2 + (i > 3 ? 2.4 : 0), py = 3.2 + (i % 3) * 0.35; K.add(new THREE.SphereGeometry(0.2, 16, 12), M.led, px, F + py, pz, 0); K.box(0.008, 9.3 - py - 0.2, 0.008, M.steel, px, F + py + 0.2, pz); }
  }
  function sofa(K, M, x, z, face, n) { var W = n * 0.72 + 0.4; K.push(x, z, face, 1, F); K.box(W - 0.1, 0.12, 0.84, M.walnut, 0, 0, 0, 0, 1.2); K.box(W, 0.2, 0.92, M.cognac, 0, 0.12, 0, 0, 0.6); K.box(W, 0.5, 0.2, M.cognac, 0, 0.32, -0.36, 0, 0.6); [-W / 2 + 0.1, W / 2 - 0.1].forEach(function (sx) { K.box(0.2, 0.3, 0.92, M.cognac, sx, 0.32, 0, 0, 0.6); }); for (var i = 0; i < n; i++) { var sx2 = -(n - 1) * 0.36 + i * 0.72; K.box(0.7, 0.13, 0.62, M.cognac, sx2, 0.32, 0.1, 0, 0.6); K.box(0.66, 0.42, 0.14, M.cognac, sx2, 0.45, -0.2, 0, 0.6, -0.12); K.solid(sx2, 0.1, 0.66, 0.6, 0, 0.45, 0, { seat: true, face: 0 }); } K.solid(0, -0.36, W, 0.22, 0, 0.9); K.pop(); }
  function club(K, M, x, z, face, occupied) { K.push(x, z, face, 1, F); K.box(0.78, 0.14, 0.78, M.walnut, 0, 0, 0, 0, 1.2); K.box(0.86, 0.16, 0.86, M.cognac, 0, 0.14, 0, 0, 0.6); K.box(0.58, 0.16, 0.62, M.cognac, 0, 0.3, 0.08, 0, 0.6); K.box(0.86, 0.46, 0.2, M.cognac, 0, 0.3, -0.33, 0, 0.6); [-0.35, 0.35].forEach(function (sx) { K.box(0.16, 0.24, 0.86, M.cognac, sx, 0.3, 0, 0, 0.6); }); K.box(0.56, 0.34, 0.12, M.cognac, 0, 0.46, -0.2, 0, 0.6, -0.15); K.solid(0, 0.08, 0.6, 0.6, 0, 0.46, 0, occupied ? null : { seat: true, face: 0 }); K.solid(0, -0.33, 0.86, 0.22, 0, 0.76); K.pop(); }

  // ── Gate A2 holdroom: four rows of beam seating facing the glass, planted beds either side of the axis, the two podiums ──
  function buildGate(K, M, g) {
    var rows = [8.6, 12.0, 15.4, 18.8], x0 = -11.3, n = 6, pitch = 0.64;
    rows.forEach(function (rz, ri) {
      if (hasM("term_seating")) { model(g, "term_seating", x0 + (n - 1) * pitch / 2, F, rz, 0, 1, n * pitch + 0.5); for (var s0 = 0; s0 < n; s0++) K.solid(x0 + s0 * pitch, rz, 0.52, 0.5, 0, F + 0.47, 0, { seat: true, face: 0 }); return; }
      var L = (n - 1) * pitch + 0.8, cx = x0 + (n - 1) * pitch / 2; K.box(L, 0.07, 0.1, M.stain, cx, F + 0.3, rz - 0.08); [-L / 2 + 0.2, 0, L / 2 - 0.2].forEach(function (lx) { K.box(0.07, 0.3, 0.5, M.stain, cx + lx, F, rz - 0.05); });
      for (var s = 0; s < n; s++) { var sx = x0 + s * pitch; K.box(0.54, 0.09, 0.5, M.leatherBk, sx, F + 0.38, rz); K.box(0.54, 0.46, 0.08, M.leatherBk, sx, F + 0.47, rz - 0.26, 0, 0, -0.1); K.box(0.5, 0.06, 0.03, M.stain, sx, F + 0.94, rz - 0.3); K.solid(sx, rz, 0.52, 0.5, 0, F + 0.47, 0, (ri === 1 && (s === 1 || s === 4)) ? null : { seat: true, face: 0 }); }
      for (var a = 0; a <= n; a++) { var ax = x0 - pitch / 2 + a * pitch; K.box(0.05, 0.2, 0.42, M.stain, ax, F + 0.47, rz - 0.02); K.box(0.07, 0.03, 0.44, M.walnut, ax, F + 0.67, rz - 0.02); }
      K.box(0.5, 0.5, 0.5, M.walnut, x0 + (n - 1) * pitch + 0.62, F, rz, 0, 1.2); K.box(0.52, 0.03, 0.52, M.brass, x0 + (n - 1) * pitch + 0.62, F + 0.5, rz); K.solid(x0 + (n - 1) * pitch + 0.62, rz, 0.5, 0.5, 0, 0.8);
    });
    // planted beds either side of the airside axis
    [-5.4, 5.4].forEach(function (bxc) { K.box(1.7, 0.41, 5.6, M.trav, bxc, 0, 7.5, 0, 2.4); [-0.83, 0.83].forEach(function (o) { K.box(0.06, 0.05, 5.6, M.trav, bxc + o, 0.41, 7.5); K.box(0.07, 0.012, 5.62, M.brass, bxc + o, 0.46, 7.5); }); [-2.77, 2.77].forEach(function (o) { K.box(1.7, 0.05, 0.06, M.trav, bxc, 0.41, 7.5 + o); K.box(1.72, 0.012, 0.07, M.brass, bxc, 0.46, 7.5 + o); }); K.box(1.6, 0.012, 5.5, M.gravel, bxc, 0.41, 7.5, 0, 1.5); K.solid(bxc, 7.5, 1.7, 5.6, 0, 0.8); });
    // podiums: security (west) and the Gate A2 agent (east); the gate pylon behind the agent
    [[-5.3, Math.PI / 2], [5.3, -Math.PI / 2]].forEach(function (p) { K.push(p[0], 22.2, p[1]); K.box(1.3, 1.05, 0.6, M.walnut, 0, 0, 0, 0, 1.2); K.box(1.36, 0.04, 0.66, M.trav, 0, 1.05, 0, 0, 2.4); K.box(1.3, 0.07, 0.62, M.brass, 0, 0, 0); K.box(0.46, 0.3, 0.03, M.bglass, 0.25, 1.12, -0.12); K.solid(0, 0, 1.3, 0.62, 0, 1.1); K.pop(); });
    var gp = panel("gateA2", 512, 1024, function (x, W, H) { x.fillStyle = "#07090b"; x.fillRect(0, 0, W, H); x.fillStyle = "#1d6b3a"; x.fillRect(0, 0, W, 220); txt(x, "GATE", W / 2, 70, "600 44px " + FT.ui, "#e8f5ec", 10); txt(x, "A2", W / 2, 156, "400 120px " + FT.disp, "#ffffff", 4); txt(x, "THE APRON", W / 2, 280, "600 34px " + FT.ui, "#f5f1e6", 8); x.fillStyle = "#1a1e22"; x.fillRect(30, 330, W - 60, 2); txt(x, "GB 204", W / 2, 400, "600 44px " + FT.mono, "#f4cd5a", 2); txt(x, "PHOENIX SKY HARBOR", W / 2, 460, "600 30px " + FT.ui, "#f5f1e6", 2); txt(x, "BOARDING", W / 2, 530, "600 36px " + FT.mono, "#4DDE6F", 4); x.fillStyle = "#1a1e22"; x.fillRect(30, 600, W - 60, 2); txt(x, "GIVEBACK ONE", W / 2, 670, "600 30px " + FT.ui, "#f5f1e6", 4); txt(x, "ON STAND A2", W / 2, 720, "600 26px " + FT.mono, "#8f969c", 4); picto(x, "plane", W / 2, 860, 150, "#f5f1e6"); });
    K.box(1.0, 2.6, 0.3, M.walnut, 7.2, F, 23.0, -Math.PI / 2, -1.2); var gpl = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 1.68), new THREE.MeshBasicMaterial({ map: gp })); gpl.position.set(7.04, F + 1.5, 23.0); gpl.rotation.y = -Math.PI / 2; g.add(gpl); K.solid(7.2, 23.0, 1.0, 0.3, 0, 2.6, -Math.PI / 2);
    var sec = panel("secS", 512, 128, function (x, W, H) { x.fillStyle = "#101112"; x.fillRect(0, 0, W, H); txt(x, "SECURITY", W / 2, H / 2 + 2, "600 52px " + FT.ui, "#f4cd5a", 10); }); var spn = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), new THREE.MeshBasicMaterial({ map: sec })); spn.position.set(-4.98, F + 0.62, 22.2); spn.rotation.y = Math.PI / 2; g.add(spn);
    // over the door: GATE A2 · THE APRON (facing into the hall)
    var dr = panel("doorS", 2048, 256, function (x, W, H) { x.fillStyle = "#101112"; x.fillRect(0, 0, W, H); picto(x, "plane", 150, H / 2, 150, "#f5f1e6"); txt(x, "GATE A2  ·  THE APRON", W / 2 + 60, H / 2 + 4, "600 96px " + FT.ui, "#f5f1e6", 12); arrow(x, "u", W - 140, H / 2, 150, "#f4cd5a"); });
    var dp = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 0.9), new THREE.MeshBasicMaterial({ map: dr })); dp.position.set(0, F + 4.75, HALF - 0.5); dp.rotation.y = Math.PI; g.add(dp); K.box(7.4, 1.0, 0.06, M.bronze, 0, F + 4.25, HALF - 0.45);
  }

  // ── the apron view: a walnut ledge along the glass with stools, a lounge group ──
  function buildApron(K, M, g) {
    K.box(10.2, 0.05, 0.55, M.walnut, 12.2, F + 1.02, 25.55, 0, 1.2); [7.4, 12.2, 17.0].forEach(function (lx) { K.box(0.06, 1.02, 0.4, M.bronze, lx, F, 25.55); }); K.solid(12.2, 25.55, 10.2, 0.55, 1.0, 1.08);
    for (var i = 0; i < 7; i++) { var sx = 7.9 + i * 1.45; K.cyl(0.21, 0.19, 0.08, M.cognacS, sx, F + 0.72, 24.75, 20); K.cyl(0.03, 0.03, 0.7, M.bronze, sx, F + 0.02, 24.75, 8); K.cyl(0.22, 0.24, 0.02, M.bronze, sx, F, 24.75, 18); K.add(new THREE.TorusGeometry(0.17, 0.012, 6, 20), M.bronze, sx, F + 0.3, 24.75, 0, Math.PI / 2); K.solid(sx, 24.75, 0.42, 0.42, 0, F + 0.8, 0, { seat: true, face: 0 }); }
    K.flat(4.6, 4.6, M.rug, 12.5, F + 0.005, 17.2, 0, 2.0); club(K, M, 11.2, 17.2, Math.PI / 2); club(K, M, 13.8, 17.2, -Math.PI / 2); club(K, M, 12.5, 15.9, 0); club(K, M, 12.5, 18.5, Math.PI); K.cyl(0.48, 0.48, 0.04, M.walnut, 12.5, F + 0.4, 17.2, 28); K.cyl(0.3, 0.34, 0.4, M.bronze, 12.5, F, 17.2, 24); K.solid(12.5, 17.2, 0.96, 0.96, 0, 0.8);
  }

  // ── plants: big planters with palms, quiver trees, the beds' planting ──
  function planter(K, M, g, x, z, kind, h, size) { var s = size || 1.3; if (hasM("term_planter")) { model(g, "term_planter", x, F, z, 0, 1, s + 0.2); } else { K.box(s, 0.95, s, M.trav, x, 0, z, 0, 2.4); K.box(s + 0.06, 0.05, s + 0.06, M.brass, x, 0.95, z); K.box(s - 0.14, 0.02, s - 0.14, M.soil, x, 0.93, z); K.box(s + 0.02, 0.08, s + 0.02, M.bronze, x, 0, z); } K.solid(x, z, s, s, 0, 1.0); if (kind) plantModel(g, kind, x, 0.95, z, RND() * TAU, h); }
  function buildPlants(K, M, g) {
    var palm = hasM("fanpalm") ? "fanpalm" : null, tree = hasM("ph_quiver_1") ? "ph_quiver_1" : hasM("ocotillo") ? "ocotillo" : palm, succ = hasM("ph_succulent_2") ? "ph_succulent_2" : hasM("bush1") ? "bush1" : null;
    [[-11.4, -5.9, palm, 5.2], [7.6, -6.0, palm, 5.2], [-25.9, -7.6, tree, 2.9], [-5.2, 25.3, palm, 4.6], [5.2, 25.3, palm, 4.6], [25.6, -4.1, tree, 2.9], [25.6, 3.1, tree, 2.9], [-12.9, 25.6, succ, 1.6], [9.4, -24.4, succ, 1.6]].forEach(function (p) { planter(K, M, g, p[0], p[1], p[2], p[3], p[2] === palm ? 1.4 : 1.1); });
    [-5.4, 5.4].forEach(function (bxc) { if (palm) plantModel(g, palm, bxc, 0.42, 6.0, RND() * TAU, 4.2); if (succ) { plantModel(g, succ, bxc - 0.2, 0.42, 8.6, RND() * TAU, 1.4); plantModel(g, succ, bxc + 0.25, 0.42, 9.6, RND() * TAU, 1.0); } if (hasM("bush1")) plantModel(g, "bush1", bxc, 0.42, 4.9, RND() * TAU, 0.8); });
    if (hasM("bush2")) for (var i = 0; i < 5; i++) plantModel(g, "bush2", -25.2 + i * 2.2, F + 0.94, 16.8, RND() * TAU, 0.55);
  }

  // ── the hanging 1928 biplane over the crossing and its brass medallion ──
  function buildHeritage(K, M, g, e) {
    var md = panel("medal", 1024, 1024, function (x, W, H) { var c = W / 2; x.clearRect(0, 0, W, H); x.fillStyle = "#3a332c"; x.beginPath(); x.arc(c, c, c - 4, 0, TAU); x.fill(); x.strokeStyle = "#c9a45e"; x.lineWidth = 10; x.beginPath(); x.arc(c, c, c - 14, 0, TAU); x.stroke(); x.lineWidth = 4; x.beginPath(); x.arc(c, c, c - 118, 0, TAU); x.stroke();
      var t = "SOLPORT  ·  FIELD DGL  ·  AN AIRFIELD SINCE 1928  ·  31°20'N  109°30'W  ·  "; x.font = "600 44px " + FT.ui; x.fillStyle = "#e3c587"; x.textAlign = "center"; x.textBaseline = "middle"; var ang = 0, step = TAU / t.length; for (var i = 0; i < t.length; i++) { x.save(); x.translate(c, c); x.rotate(ang); x.fillText(t[i], 0, -(c - 66)); x.restore(); ang += step; }
      x.save(); x.translate(c, c); var north = Math.atan2(Math.sin(e[3]), -Math.cos(e[3])); x.rotate(north); for (var k = 0; k < 8; k++) { var L = k % 2 ? 200 : 360, w = k % 2 ? 26 : 44; x.save(); x.rotate(k * Math.PI / 4); x.fillStyle = k === 0 ? "#f4d9a0" : "#c9a45e"; x.beginPath(); x.moveTo(0, -L); x.lineTo(w, 0); x.lineTo(0, 30); x.lineTo(-w, 0); x.closePath(); x.fill(); x.fillStyle = "rgba(0,0,0,0.25)"; x.beginPath(); x.moveTo(0, -L); x.lineTo(w, 0); x.lineTo(0, 0); x.closePath(); x.fill(); x.restore(); } txt(x, "N", 0, -300, "400 64px " + FT.disp, "#3a332c", 0); x.restore(); });
    var mm = new THREE.MeshStandardMaterial({ map: md, alphaTest: 0.5, roughness: 0.3, metalness: 0.4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, envMap: PT.env ? PT.env.texture : null, envMapIntensity: 0.8 }); var mp = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 4.8), mm); mp.rotation.x = -Math.PI / 2; mp.position.set(0, F + 0.006, -0.5); mp.userData.noSolid = true; g.add(mp);
    if (hasM("biplane")) { var bp = model(g, "biplane", 0.3, F + 5.1, -0.5, Math.PI / 2 - 0.4, 0.82); if (bp) { bp.rotation.z = 0.12; bp.rotation.x = -0.05; var R = (MODELS.biplane.radius || 4.5) * 0.82 * 0.72; [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (s) { var a = Math.PI / 2 - 0.4, lx = s[0] * R * 0.55, lz = s[1] * R * 0.22; var wx = 0.3 + lx * Math.cos(a) + lz * Math.sin(a), wz = -0.5 - lx * Math.sin(a) + lz * Math.cos(a); K.box(0.01, 9.2 - 7.0, 0.01, M.steel, wx, F + 7.0, wz); }); } }
    var pq = panel("plaque", 1024, 512, function (x, W, H) { x.fillStyle = "#1a1510"; x.fillRect(0, 0, W, H); x.strokeStyle = "#c9a45e"; x.lineWidth = 6; x.strokeRect(12, 12, W - 24, H - 24); txt(x, "SOLPORT  ·  THE 1928 AIRFIELD", W / 2, 90, "600 56px " + FT.ui, "#e3c587", 6); lines(x, ["One of the first international airports in the United States,", "on the border with Agua Prieta, Sonora. The biplane overhead", "is a 1928-style trainer like the ones that flew from this field.", "The 1928 Airfield Museum is next door, beside the Tower."], W / 2, 200, 62, "600 32px " + FT.ui, "#f5f1e6", 0); });
    K.box(1.4, 1.0, 0.5, M.walnut, 3.6, F, 2.6, -0.6, 1.2); K.box(1.44, 0.04, 0.54, M.brass, 3.6, F + 1.0, 2.6, -0.6); var pp = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65), new THREE.MeshBasicMaterial({ map: pq })); pp.position.set(3.6, F + 1.05, 2.6); pp.rotation.set(-1.2, -0.6, 0, "YXZ"); pp.userData.noSolid = true; g.add(pp); K.solid(3.6, 2.6, 1.4, 0.5, 0, 1.05, -0.6);
  }


  // ── the 1928 wall at the end of the concourse: a sepia photograph of the field and a bronze caption (replaces the plain board) ──
  function buildHistoryWall(K, M, g) {
    var ph = panel("hist", 1536, 672, function (x, W, H) { var R = rng(1928); var gg = x.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, "#d9cbb0"); gg.addColorStop(0.55, "#c9b391"); gg.addColorStop(0.62, "#a58f6c"); gg.addColorStop(1, "#8a7555"); x.fillStyle = gg; x.fillRect(0, 0, W, H);
      x.fillStyle = "#9d8a6b"; x.beginPath(); x.moveTo(0, H * 0.6); for (var i = 0; i <= 40; i++) { var px = i / 40 * W; x.lineTo(px, H * (0.52 - 0.06 * Math.sin(i * 0.5) - 0.05 * Math.sin(i * 0.19 + 1) - (i > 24 && i < 31 ? 0.05 : 0))); } x.lineTo(W, H * 0.6); x.closePath(); x.fill();
      x.fillStyle = "#6f5d45"; x.beginPath(); x.moveTo(W * 0.08, H * 0.62); x.lineTo(W * 0.08, H * 0.5); x.quadraticCurveTo(W * 0.21, H * 0.36, W * 0.34, H * 0.5); x.lineTo(W * 0.34, H * 0.62); x.fill(); x.fillStyle = "#4e412f"; x.fillRect(W * 0.17, H * 0.53, W * 0.08, H * 0.09);
      x.fillStyle = "#3e3325"; x.save(); x.translate(W * 0.64, H * 0.3); x.scale(1.5, 1.5); x.fillRect(-90, -12, 180, 7); x.fillRect(-84, 16, 168, 6); x.fillRect(-60, -6, 3, 24); x.fillRect(57, -6, 3, 24); x.beginPath(); x.ellipse(-8, 6, 44, 9, 0, 0, TAU); x.fill(); x.beginPath(); x.moveTo(34, 4); x.lineTo(78, 0); x.lineTo(80, -10); x.lineTo(70, 2); x.fill(); x.fillRect(-56, 2, 3, 12); x.beginPath(); x.arc(-16, 30, 5, 0, TAU); x.arc(4, 30, 5, 0, TAU); x.fill(); x.restore();
      x.fillStyle = "rgba(60,48,34,0.55)"; x.fillRect(0, H * 0.74, W, 5); for (var q = 0; q < 26000; q++) { x.fillStyle = "rgba(" + (R() < 0.5 ? "40,30,20" : "255,245,225") + "," + (R() * 0.12) + ")"; x.fillRect(R() * W, R() * H, 1.5, 1.5); }
      var vg = x.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(40,28,16,0.55)"); x.fillStyle = vg; x.fillRect(0, 0, W, H); x.strokeStyle = "#efe6d4"; x.lineWidth = 22; x.strokeRect(0, 0, W, H); });
    var zc = 1.6, y0 = F + 3.9; K.box(0.1, 3.3, 7.6, M.walnut, -HALF + 0.22, y0 - 0.15, zc, 0, 1.2); var pp = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.15), new THREE.MeshBasicMaterial({ map: ph })); pp.position.set(-HALF + 0.28, y0 + 1.5, zc); pp.rotation.y = Math.PI / 2; pp.userData.noSolid = true; g.add(pp);
    var cap = panel("histC", 2048, 256, function (x, W, H) { x.fillStyle = "#231b13"; x.fillRect(0, 0, W, H); x.strokeStyle = "#b99a62"; x.lineWidth = 6; x.strokeRect(8, 8, W - 16, H - 16); txt(x, "DOUGLAS MUNICIPAL AIRPORT  ·  1928", W / 2, 78, "600 64px " + FT.ui, "#e3c587", 10); txt(x, "One of the first international airports in the United States. Solport flies on from the same field; the 1928 Airfield Museum is next door, beside the Tower.", W / 2, 172, "400 40px " + FT.ui, "#efe6d4", 0, "center", W - 90); });
    K.box(0.06, 0.62, 5.6, M.bronze, -HALF + 0.22, y0 - 0.95, zc); var cp = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 0.66), new THREE.MeshBasicMaterial({ map: cap })); cp.position.set(-HALF + 0.26, y0 - 0.64, zc); cp.rotation.y = Math.PI / 2; cp.userData.noSolid = true; g.add(cp);
  }
  // ── the Genesis One master plan under glass: drawn from plan.json (districts in the stage colours, roads, walks, buildings, the runway) ──
  function planCanvas() { return panel("plantable", 2048, 2048, function (x, W, H) { var P = window.PLAN; var X0 = -520, Z0 = -660, S = 1700, k = W / S; var mx = function (v) { return (v - X0) * k; }, mz = function (v) { return (v - Z0) * k; };
      x.fillStyle = "#e3d6bd"; x.fillRect(0, 0, W, H); var R = rng(3); for (var i = 0; i < 9000; i++) { x.fillStyle = "rgba(120,96,64," + (R() * 0.06) + ")"; x.fillRect(R() * W, R() * H, 3, 3); }
      if (!P) return; var poly = function (pts, fill, stroke, lw) { if (!pts || pts.length < 3) return; x.beginPath(); x.moveTo(mx(pts[0][0]), mz(pts[0][1])); for (var i = 1; i < pts.length; i++) x.lineTo(mx(pts[i][0]), mz(pts[i][1])); x.closePath(); if (fill) { x.fillStyle = fill; x.fill(); } if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw || 2; x.stroke(); } };
      var line = function (pts, col, w) { if (!pts || pts.length < 2) return; x.beginPath(); x.moveTo(mx(pts[0][0]), mz(pts[0][1])); for (var i = 1; i < pts.length; i++) x.lineTo(mx(pts[i][0]), mz(pts[i][1])); x.strokeStyle = col; x.lineWidth = Math.max(1.5, w * k); x.lineCap = "round"; x.lineJoin = "round"; x.stroke(); };
      try { for (var pk in (P.parcels || {})) poly(P.parcels[pk].ring, "rgba(245,238,222,0.75)", "rgba(120,100,70,0.5)", 3); } catch (e) {}
      var tint = { S1: "rgba(60,190,95,0.3)", S2: "rgba(226,178,52,0.34)", S3: "rgba(80,180,206,0.3)", GP: "rgba(196,120,64,0.32)", AIRPORT: "rgba(130,130,130,0.14)" };
      (P.districts || []).forEach(function (d) { var st = d.stage && /1/.test(d.stage) ? "S1" : d.stage && /2/.test(d.stage) ? "S2" : d.stage && /3/.test(d.stage) ? "S3" : /GP|park/i.test(d.id + d.stage) ? "GP" : "AIRPORT"; poly(d.poly, tint[st], "rgba(90,70,50,0.25)", 1.5); });
      var rw = P.runway; if (rw) { line([rw.ne, rw.sw], "#5d5a55", 46); x.setLineDash([22, 22]); line([rw.ne, rw.sw], "#f3efe6", 2); x.setLineDash([]); }
      (P.roads || []).forEach(function (r) { if (/tunnel/i.test(r.surface || "") || /crossing|link/i.test(r.id || "") && /tunnel/i.test(r.class || "")) return; line(r.pts, /taxi|apron/i.test(r.class || "") ? "#5f5b54" : "#9a8158", Math.max(5, r.width || 8)); });
      (P.promenades || []).forEach(function (r) { line(r.pts, "#f4ecdc", Math.max(4, r.width || 6)); });
      (P.plazas || []).forEach(function (z) { x.fillStyle = "#f4ecdc"; x.beginPath(); x.arc(mx(z.x), mz(z.z), Math.max(4, z.r * k), 0, TAU); x.fill(); });
      (P.buildings || []).forEach(function (b) { if (b.poly) { x.save(); x.translate(3, 3); poly(b.poly, "rgba(60,45,30,0.25)"); x.restore(); poly(b.poly, "#ffffff", "rgba(50,38,24,0.85)", 1.6); } });
      x.fillStyle = "#3c3024"; x.font = "600 30px " + FT.ui; x.textAlign = "left"; x.fillText("N", 60, 90); x.beginPath(); x.moveTo(70, 110); x.lineTo(56, 150); x.lineTo(84, 150); x.closePath(); x.fill(); }); }
  function buildPlanTable(K, M, g) {
    var cx = 11.8, cz = 9.2, s = 3.0; K.box(s - 0.4, 0.84, s - 0.4, M.walnut, cx, 0, cz, 0, 1.2); K.box(s, 0.06, s, M.walnut, cx, 0.84, cz, 0, 1.2); [[0, s / 2], [0, -s / 2], [s / 2, 0], [-s / 2, 0]].forEach(function (o) { K.box(o[0] ? 0.05 : s + 0.05, 0.05, o[0] ? s + 0.05 : 0.05, M.brass, cx + o[0], 0.88, cz + o[1]); }); K.box(s - 0.12, 0.012, s - 0.12, M.glassCase, cx, 0.925, cz);
    var t = planCanvas(); var mp = new THREE.Mesh(new THREE.PlaneGeometry(s - 0.14, s - 0.14), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0 })); mp.rotation.x = -Math.PI / 2; mp.position.set(cx, 0.905, cz); mp.userData.noSolid = true; g.add(mp); K.solid(cx, cz, s, s, 0, 1.0);
    var cap = panel("planCap", 1024, 256, function (x, W, H) { x.fillStyle = "#1a1510"; x.fillRect(0, 0, W, H); txt(x, "GENESIS ONE  ·  THE MASTER PLAN", W / 2, 60, "600 40px " + FT.ui, "#e3c587", 6); lines(x, ["A concept on the real land at Solport. Genesis Park is a partnership proposal,", "subject to agreement with the City of Douglas. The Crossing is planned, subject to City of", "Douglas and FAA approval. Stage Three homes are future, subject to rezoning."], W / 2, 130, 42, "400 25px " + FT.ui, "#efe6d4", 0, "center", W - 50); });
    K.box(1.3, 0.9, 0.34, M.walnut, cx - s / 2 - 0.5, 0, cz, Math.PI / 2, 1.2); var cp = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({ map: cap })); cp.position.set(cx - s / 2 - 0.66, 0.93, cz); cp.rotation.set(-0.7, -Math.PI / 2, 0, "YXZ"); cp.userData.noSolid = true; g.add(cp); K.solid(cx - s / 2 - 0.5, cz, 0.34, 1.3, 0, 1.0);
  }

  // ───────────────────────── Industry Partners hall ─────────────────────────
  // booth slots in room coordinates: centre (model frame origin) and yaw; Stellar (the FBO partner) is the largest
  var SLOTS = { stellar: { x: 18.6, z: -HALF + 0.12 + 2.525 * 1.12, yaw: 0, s: 1.12 }, financeadvisors: { x: HALF - 0.12 - 2.525, z: -10.9, yaw: -Math.PI / 2, s: 1 }, jetfinders: { x: HALF - 0.12 - 2.525, z: 9.4, yaw: -Math.PI / 2, s: 1 }, freedomair: { x: HALF - 0.12 - 2.525, z: 19.6, yaw: -Math.PI / 2, s: 1 } };
  PT.SLOTS = SLOTS;
  function boothInfo() { var I = window.PLAN_MODEL_INFO && window.PLAN_MODEL_INFO.booth_lux; return I || { size: [8, 3.91, 5.05], platform_top: 0.158, brand_wall: { logo_zone: { center: [0.05, 2.25, -2.47], w: 5.0, h: 2.1 } }, screen: { center: [3.82, 2.2, 0.25], w: 2.3, h: 1.2 }, desk: { staff_spot: [-2.55, 0.158, 0.6], visitor_spot: [-2.55, 0.158, 2.25] }, lounge: { chairs: [{ center: [1.16, -0.2], seat_y: 0.68 }, { center: [2.33, 1.64], seat_y: 0.68 }], table: { center: [0.72, 1.6] } }, solids: { back_wall: [0, -2.42, 8, 0.22, 0, 3.91], wing_wall: [3.86, 0.22, 0.28, 3.12, 0, 3.7], desk: [-2.53, 0.95, 2.45, 1.42, 0, 1.32], planter: [3.45, -1.9, 0.86, 1.0, 0, 1.3], chair_back: [1.16, -0.2, 1.16, 0.93, 0, 1.05], chair_front: [2.33, 1.64, 1.03, 1.04, 0, 1.06], table: [0.72, 1.62, 1.18, 1.17, 0, 0.62] } }; }
  // slot frame -> room coordinates
  function slotPt(sl, bx0, bz0) { var c = Math.cos(sl.yaw), s = Math.sin(sl.yaw); return [sl.x + (bx0 * c + bz0 * s) * sl.s, sl.z + (-bx0 * s + bz0 * c) * sl.s]; }
  PT.slotPt = slotPt;
  // brand art for each booth: the lightbox logo, the header sign, the wing screen slides, the aisle totem
  function brandArt(id) {
    var p = P(id) || {}, key = "b_" + id;
    var logo = panel(key + "L", 1280, 540, function (x, W, H) {
      if (id === "stellar") { x.fillStyle = "#fbf8f2"; x.fillRect(0, 0, W, H); x.fillStyle = "#111"; rrect(x, W / 2 - 150, 40, 300, 56, 28); x.fill(); txt(x, p.badge || "SOLPORT FBO", W / 2, 69, "600 28px " + FT.ui, "#fff", 6); stellarMark(x, W / 2 + 20, 270, 1.55); txt(x, (p.tagline || "").toUpperCase(), W / 2, 470, "600 30px " + FT.ui, "#6c737a", 10); }
      else if (id === "financeadvisors") { x.fillStyle = "#121212"; x.fillRect(0, 0, W, H); faMark(x, W / 2, 250, 150); x.fillStyle = "#e2323d"; x.fillRect(W / 2 - 70, 360, 140, 5); txt(x, "FINANCEADVISORS.COM", W / 2, 430, "600 34px " + FT.ui, "#d8d8d8", 12); }
      else if (id === "jetfinders") { var gg = x.createLinearGradient(0, 0, W, H); gg.addColorStop(0, "#0b1426"); gg.addColorStop(1, "#050810"); x.fillStyle = gg; x.fillRect(0, 0, W, H); jfMark(x, W / 2 - 30, 230, 150); txt(x, p.tagline || "", W / 2, 400, "italic 400 40px " + FT.serif, "#c9d6ea", 1); }
      else { x.fillStyle = "#0b0b0c"; x.fillRect(0, 0, W, H); img("/tex/freedomair_eagle.png", function (im) { x.drawImage(im, W / 2 - 80, 40, 160, 151); if (TX[key + "L"]) TX[key + "L"].needsUpdate = true; }); img("/tex/freedomair_gold.png", function (im) { x.drawImage(im, W / 2 - 440, 225, 880, 92); if (TX[key + "L"]) TX[key + "L"].needsUpdate = true; }); txt(x, "F I N D I N G   F R E E D O M", W / 2, 400, "600 34px " + FT.ui, "#c9a24d", 4); txt(x, "PRIVATE JET CHARTER  ·  AIRCRAFT MANAGEMENT", W / 2, 460, "600 26px " + FT.ui, "#e8e2d4", 6); } });
    var header = panel(key + "H", 1536, 192, function (x, W, H) { x.clearRect(0, 0, W, H); var nm = (p.name || id).toUpperCase(); if (id === "financeadvisors") { x.fillStyle = "rgba(0,0,0,0)"; faMark(x, W / 2, H / 2, 120); } else if (id === "stellar") { txt(x, "STELLAR AVIATION", W / 2, H / 2, "900 104px " + FT.heavy, "#f7fbff", 10); } else if (id === "jetfinders") { jfMark(x, W / 2 - 20, H / 2, 128); } else { txt(x, "FREEDOM AIR", W / 2, H / 2, "italic 900 116px " + FT.heavy, "#e3bf6a", 8); } });
    var slides = [panel(key + "S1", 1024, 540, function (x, W, H) { slideBase(x, W, H, id); if (id === "stellar") { txt(x, "FBO SERVICES", 60, 90, "600 44px " + FT.ui, "#1464b4", 6, "left"); (p.services || []).forEach(function (s2, i) { var col = i % 2, row = i >> 1; x.fillStyle = "#1464b4"; x.fillRect(60 + col * 460, 170 + row * 110, 8, 60); txt(x, s2, 90 + col * 460, 200 + row * 110, "600 40px " + FT.ui, "#1b2330", 1, "left"); }); }
        else if (id === "financeadvisors") { txt(x, "HOW IT WORKS", 60, 90, "600 40px " + FT.ui, "#e2323d", 8, "left"); var st = ["1  A short questionnaire about you", "2  Matched with independent wealth managers", "3  You choose who to talk to"]; lines(x, st, 60, 190, 80, "600 38px " + FT.ui, "#f2f2f2", 0, "left", W - 120); txt(x, (p.notice || "").split(".")[0] + ".", 60, 470, "400 26px " + FT.ui, "#9a9a9a", 0, "left", W - 120); }
        else if (id === "jetfinders") { txt(x, "ONE ADVISOR FOR ALL YOUR FLYING", 60, 90, "600 34px " + FT.ui, "#7fb2ff", 5, "left"); (p.services || []).slice(0, 8).forEach(function (s2, i) { var col = i % 2, row = i >> 1; txt(x, "·  " + s2, 60 + col * 470, 180 + row * 86, "600 32px " + FT.ui, "#eef3fb", 0, "left", 440); }); }
        else { txt(x, "THE FLEET", 60, 90, "600 40px " + FT.ui, "#c9a24d", 8, "left"); (p.fleet || []).forEach(function (s2, i) { var col = i % 2, row = i >> 1; txt(x, s2, 60 + col * 470, 180 + row * 80, "600 36px " + FT.ui, "#f2ede2", 0, "left", 440); }); } }),
      panel(key + "S2", 1024, 540, function (x, W, H) { slideBase(x, W, H, id); var body = p.blurb || ""; var ls = wrapText(x, body, W - 140, "600 38px " + FT.ui); if (id === "stellar") { txt(x, "FBO NETWORK", 60, 90, "600 40px " + FT.ui, "#1464b4", 6, "left"); (p.locations || []).forEach(function (s2, i) { txt(x, s2, 90, 170 + i * 70, "600 38px " + FT.ui, "#1b2330", 2, "left"); }); txt(x, "Solport  DGL  ·  the FBO you are standing in", 90, 460, "600 34px " + FT.ui, "#1464b4", 1, "left"); }
        else { lines(x, ls.slice(0, 6), 70, 120, 58, "600 38px " + FT.ui, id === "freedomair" ? "#f2ede2" : "#f2f2f2", 0, "left", W - 140); if (id === "freedomair") txt(x, "+1 775 447 9830", 70, 470, "600 36px " + FT.mono, "#c9a24d", 2, "left"); } })];
    return { logo: logo, header: header, slides: slides };
  }
  function slideBase(x, W, H, id) { var bg = { stellar: "#f6f8fb", financeadvisors: "#121212", jetfinders: "#0a1222", freedomair: "#0b0b0c" }[id]; x.fillStyle = bg; x.fillRect(0, 0, W, H); var ac = { stellar: "#1464b4", financeadvisors: "#e2323d", jetfinders: "#7fb2ff", freedomair: "#c9a24d" }[id]; x.fillStyle = ac; x.fillRect(0, H - 10, W, 10); }
  function totemArt(id) { var p = P(id) || {}; return panel("tot_" + id, 512, 1280, function (x, W, H) { var dark = id !== "stellar"; x.fillStyle = dark ? "#0e0e0f" : "#f7f4ee"; x.fillRect(0, 0, W, H); var ac = { stellar: "#1464b4", financeadvisors: "#e2323d", jetfinders: "#7fb2ff", freedomair: "#c9a24d" }[id]; x.fillStyle = ac; x.fillRect(0, 0, W, 12);
      if (id === "stellar") { stellarMark(x, W / 2 + 10, 190, 0.62); if (p.badge) { x.fillStyle = "#111"; rrect(x, W / 2 - 120, 300, 240, 46, 23); x.fill(); txt(x, p.badge, W / 2, 324, "600 24px " + FT.ui, "#fff", 5); } }
      else if (id === "financeadvisors") faMark(x, W / 2, 200, 62); else if (id === "jetfinders") jfMark(x, W / 2 - 10, 200, 64); else { txt(x, "FREEDOM AIR", W / 2, 200, "italic 900 58px " + FT.heavy, "#e3bf6a", 2); }
      var ls = wrapText(x, p.blurb || "", W - 90, "600 30px " + FT.ui); lines(x, ls.slice(0, 9), W / 2, 430, 44, "600 30px " + FT.ui, dark ? "#ecebe7" : "#1b2330", 0, "center", W - 70);
      var y = 430 + Math.min(9, ls.length) * 44 + 60; x.fillStyle = dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)"; x.fillRect(60, y - 30, W - 120, 2);
      (p.contact || []).slice(0, 5).forEach(function (c, i) { txt(x, c, W / 2, y + 20 + i * 44, (i === 0 ? "600 30px " : "400 26px ") + (/@|\.com|\+/.test(c) ? FT.mono : FT.ui), dark ? (i === 0 ? "#ffffff" : "#b9b6ae") : (i === 0 ? "#111" : "#50565c"), 0, "center", W - 60); });
      if (p.notice) { var nl = wrapText(x, p.notice, W - 100, "400 22px " + FT.ui); lines(x, nl, W / 2, H - 150, 32, "400 22px " + FT.ui, "#8a8a8a", 0, "center", W - 80); } }); }
  function buildBooth(K, M, g, id) {
    var sl = SLOTS[id], I = boothInfo(), art = brandArt(id), s = sl.s, useModel = hasM("booth_lux");
    var add2 = function (mesh, bx0, by, bz0, ryl) { var p = slotPt(sl, bx0, bz0); mesh.position.set(p[0], F + by * s, p[1]); mesh.rotation.y = sl.yaw + (ryl || 0); mesh.scale.multiplyScalar(s); mesh.userData.noSolid = true; g.add(mesh); return mesh; };
    K.push(sl.x, sl.z, sl.yaw, s, F);
    var ptop = I.platform_top || 0.158;
    if (useModel) { var m = makeModel("booth_lux"); m.traverse(function (o) { if (o.isMesh) { o.userData.noSolid = true; o.castShadow = false; o.receiveShadow = true; if (o.material && PT.env && !o.material.userData.ptEnv) { o.material.envMap = PT.env.texture; o.material.envMapIntensity = 0.6; o.material.userData.ptEnv = 1; o.material.needsUpdate = true; } } }); add2(m, 0, 0, 0, 0); }
    else proceduralBooth(K, M, id);
    // the platform is a walkable floor (a 16 cm step)
    K.solid(0, 0, 8.0, 5.05, 0, ptop); var c0 = slotPt(sl, 0, 0); PT.plats.push([c0[0], c0[1], 4.0 * s, 2.525 * s, sl.yaw, F + ptop * s]);
    var S = I.solids || {}; ["back_wall", "wing_wall", "desk", "planter", "chair_back", "chair_front", "table"].forEach(function (k) { var b = S[k]; if (b) K.solid(b[0], b[1], b[2], b[3], b[4], Math.max(b[5], 0.8)); });
    (I.lounge && I.lounge.chairs || []).forEach(function (ch, i) { var tb = I.lounge.table ? I.lounge.table.center : [0.72, 1.6]; var face = Math.atan2(tb[0] - ch.center[0], tb[1] - ch.center[1]); K.solid(ch.center[0], ch.center[1], 0.55, 0.55, 0, ch.seat_y || 0.68, face, (id === "stellar" && i === 1) ? null : { seat: true, face: face }); });
    K.pop();
    // lightbox logo, header on the canopy front, the wing screen
    var lz = I.brand_wall && I.brand_wall.logo_zone || { center: [0.05, 2.25, -2.47], w: 5.0, h: 2.1 };
    // (J: the procedural stand's lit panel face is at z -2.29 and its wing glass at x 3.70, in front of the model's surfaces: keep the logo and the screen on them)
    add2(new THREE.Mesh(new THREE.PlaneGeometry(lz.w, lz.h), new THREE.MeshBasicMaterial({ map: art.logo })), lz.center[0], lz.center[1], useModel ? lz.center[2] + 0.012 : -2.284, 0);
    var hdr = new THREE.MeshBasicMaterial({ map: art.header, transparent: true, depthWrite: false }); add2(new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.8), hdr), 0, 4.3, 2.28, 0);
    K.push(sl.x, sl.z, sl.yaw, s, F); K.box(6.6, 0.06, 0.08, M.bronze, 0, 3.93, 2.28); [-3.0, 3.0].forEach(function (hx) { K.box(0.05, 0.8, 0.05, M.bronze, hx, 3.93, 2.24); }); K.box(6.6, 0.9, 0.04, M.bglass, 0, 3.88, 2.24); K.pop();
    var scr = I.screen || { center: [3.82, 2.2, 0.25], w: 2.3, h: 1.2 }; var sm = new THREE.MeshBasicMaterial({ map: art.slides[0] }); add2(new THREE.Mesh(new THREE.PlaneGeometry(scr.w, scr.h), sm), useModel ? scr.center[0] - 0.012 : 3.694, scr.center[1], scr.center[2], -Math.PI / 2); (PT.screens = PT.screens || []).push({ m: sm, slides: art.slides, i: 0, id: id });
    // the aisle totem at the booth's front left corner (outside the platform)
    var tp = slotPt(sl, -4.55, 2.2), tyaw = sl.yaw; K.push(tp[0], tp[1], tyaw, 1, 0); K.box(0.96, 0.06, 0.4, M.bronze, 0, F, 0); K.box(0.9, 2.4, 0.08, M.walnut, 0, F + 0.06, 0, 0, -1.2); K.solid(0, 0, 0.96, 0.4, 0, 2.4); K.pop();
    var tt = totemArt(id); [0, Math.PI].forEach(function (r0, i) { var mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 2.05), new THREE.MeshBasicMaterial({ map: tt })); var off = i ? -0.045 : 0.045; mesh.position.set(tp[0] + Math.sin(tyaw + r0) * 0.045, F + 0.06 + 1.2, tp[1] + Math.cos(tyaw + r0) * 0.045); mesh.rotation.y = tyaw + r0; mesh.userData.noSolid = true; g.add(mesh); });
    // Stellar, the FBO partner, gets the largest stand: an FBO services wall and a crew lounge beside the booth, a network totem on the other side
    if (id === "stellar") stellarExtension(K, M, g);
  }
  function stellarExtension(K, M, g) {
    var zb = -HALF + 0.14, x0 = 23.4, x1 = 26.8, cx = (x0 + x1) / 2;
    K.box(x1 - x0, 3.6, 0.3, M.walnut, cx, F, zb + 0.15, 0, -1.2); K.box(x1 - x0 - 0.3, 2.6, 0.02, M.plaster, cx, F + 0.7, zb + 0.31);
    var fb = panel("stFBO", 768, 640, function (x, W, H) { x.fillStyle = "#f6f8fb"; x.fillRect(0, 0, W, H); x.fillStyle = "#1464b4"; x.fillRect(0, 0, W, 14); txt(x, "SOLPORT  DGL", W / 2, 80, "600 38px " + FT.ui, "#1464b4", 4); txt(x, "FBO OPERATOR", W / 2, 130, "600 28px " + FT.ui, "#6c737a", 8); var p = P("stellar"); (p.services || []).forEach(function (s2, i) { txt(x, s2, W / 2, 220 + i * 62, "600 38px " + FT.ui, "#1b2330", 1); }); txt(x, "Stellar Aviation operates the FBO at Solport.", W / 2, H - 50, "400 22px " + FT.ui, "#6c737a", 0, "center", W - 50); });
    var fp = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.5, 2.5), new THREE.MeshBasicMaterial({ map: fb })); fp.position.set(cx, F + 1.95, zb + 0.33); fp.userData.noSolid = true; g.add(fp); K.solid(cx, zb + 0.15, x1 - x0, 0.3, 0, 3.6);
    K.flat(3.3, 3.6, M.rug, cx, F + 0.005, -23.1, 0, 2.0); sofa(K, M, cx, -24.6, 0, 3); club(K, M, 24.2, -21.9, Math.PI * 0.85); K.cyl(0.32, 0.32, 0.42, M.walnut, 25.6, F, -22.4, 20); K.solid(25.6, -22.4, 0.64, 0.64, 0, 0.8);
    // west: a tall FBO-network totem and a planter
    var nw = panel("stNet", 512, 1280, function (x, W, H) { x.fillStyle = "#0f2745"; x.fillRect(0, 0, W, H); stellarMark(x, W / 2 + 10, 150, 0.6); x.fillStyle = "#ffffff"; x.globalAlpha = 0.12; x.fillRect(50, 250, W - 100, 2); x.globalAlpha = 1; txt(x, "FBO NETWORK", W / 2, 320, "600 36px " + FT.ui, "#9cc6f2", 8); var p = P("stellar"); (p.locations || []).concat(["Solport  DGL"]).forEach(function (s2, i) { txt(x, s2, W / 2, 420 + i * 92, "600 34px " + FT.ui, i === 4 ? "#f4cd5a" : "#ffffff", 1, "center", W - 60); }); txt(x, "Soaring Beyond Expectations", W / 2, H - 120, "italic 400 30px " + FT.serif, "#c8dcf2", 0); });
    K.box(1.3, 3.4, 0.36, M.walnut, 12.6, F, -24.8, 0, -1.2); K.box(1.4, 0.08, 0.46, M.bronze, 12.6, F, -24.8); var np = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 2.9), new THREE.MeshBasicMaterial({ map: nw })); np.position.set(12.6, F + 1.85, -24.61); np.userData.noSolid = true; g.add(np); K.solid(12.6, -24.8, 1.3, 0.36, 0, 3.4);
  }
  // when booth_lux is not loaded: a walnut and stone stand of the same footprint and layout (brand wall -Z, desk front left, lounge right)
  function proceduralBooth(K, M, id) {
    K.box(8.0, 0.158, 5.05, M.travF, 0, 0, 0, 0, 2.4); K.box(8.04, 0.03, 5.09, M.brass, 0, 0.13, 0);
    K.box(8.0, 3.9, 0.22, M.walnut, 0, 0, -2.42, 0, 1.2); K.box(6.0, 3.3, 0.02, M.led, 0.1, 0.3, -2.3); K.box(0.28, 3.7, 3.12, M.walnut, 3.86, 0, 0.22, 0, -1.2); K.box(0.02, 1.25, 2.35, M.bglass, 3.71, 1.58, 0.25);
    K.box(8.2, 0.24, 5.2, M.walnut, 0, 3.66, 0, 0, 1.2); K.box(0.1, 3.66, 0.1, M.steel, -3.92, 0, -2.42);
    for (var i = 0; i < 12; i++) K.cyl(0.06, 0.06, 0.01, M.led, -3.2 + (i % 4) * 2.1, 3.65, -1.4 + (i >> 2) * 1.4, 10);
    K.box(2.45, 1.16, 1.2, M.walnut, -2.53, 0.158, 0.95, 0, 1.2); K.box(2.55, 0.04, 1.3, M.trav, -2.53, 1.3, 0.95, 0, 2.4); K.box(2.45, 0.08, 1.2, M.brass, -2.53, 0.158, 0.95);
    club(K, M, 1.16, -0.2, Math.PI * 0.8); club(K, M, 2.33, 1.64, -Math.PI * 0.6); K.cyl(0.5, 0.5, 0.05, M.walnut, 0.72, 0.62, 1.6, 24); K.cyl(0.26, 0.3, 0.46, M.bronze, 0.72, 0.16, 1.6, 20);
    K.cyl(0.4, 0.32, 0.9, M.trav, 3.45, 0.158, -1.9, 20);
  }
  function buildPartners(K, M, g) {
    PT.screens = [];
    ["stellar", "financeadvisors", "jetfinders", "freedomair"].forEach(function (id) { try { buildBooth(K, M, g, id); } catch (e) { note("booth " + id, e); } });
    // the hall header over the concourse (both faces) and the threshold inlay
    var d = D().hall || DEF.hall; var hdr = panel("hallH", 2048, 420, function (x, W, H) { x.fillStyle = "#141210"; x.fillRect(0, 0, W, H); x.fillStyle = "#b99a62"; x.fillRect(0, H - 8, W, 8); txt(x, d.title || "INDUSTRY PARTNERS", W / 2, 130, "400 150px " + FT.disp, "#f5f1e6", 26); var ls = wrapText(x, d.subtitle || "", W - 260, "600 44px " + FT.ui); lines(x, ls.slice(0, 2), W / 2, 270, 62, "600 44px " + FT.ui, "#d9c8a4", 1, "center", W - 200); });
    [Math.PI / 2, -Math.PI / 2].forEach(function (r0) { var p = new THREE.Mesh(new THREE.PlaneGeometry(8.0, 1.64), new THREE.MeshBasicMaterial({ map: hdr })); p.position.set(10.2 + (r0 > 0 ? 0.04 : -0.04), F + 5.5, -0.5); p.rotation.y = r0; p.userData.noSolid = true; g.add(p); });
    K.box(0.06, 1.76, 8.14, M.bronze, 10.2, F + 4.62, -0.5); [-3.6, 2.6].forEach(function (z) { K.box(0.012, 9.2 - 6.38, 0.012, M.steel, 10.2, F + 6.38, z); });
    K.box(0.03, 0.004, 24.0, M.brass, 10.0, F, 5.5); K.box(0.03, 0.004, 14.0, M.brass, 10.0, F, -18.0);
    // a directory totem at the hall entrance
    var dir = panel("hallDir", 512, 1280, function (x, W, H) { x.fillStyle = "#101112"; x.fillRect(0, 0, W, H); x.fillStyle = "#b99a62"; x.fillRect(0, 0, W, 10); txt(x, "INDUSTRY", W / 2, 100, "400 76px " + FT.disp, "#f5f1e6", 10); txt(x, "PARTNERS", W / 2, 180, "400 76px " + FT.disp, "#f5f1e6", 10); var rows = [["STELLAR AVIATION", "Solport FBO operator", "#5aa0e6"], ["FINANCEADVISORS.COM", "Paul Mazzapica", "#e2323d"], ["JETFINDERS", "Private aviation", "#9cc0ff"], ["FREEDOM AIR", "Charter desk", "#c9a24d"]]; rows.forEach(function (r, i) { var y = 330 + i * 190; x.fillStyle = r[2]; x.fillRect(46, y - 44, 10, 110); txt(x, r[0], 78, y - 6, "600 36px " + FT.ui, "#ffffff", 2, "left", W - 110); txt(x, r[1], 78, y + 44, "400 30px " + FT.ui, "#b9b6ae", 1, "left", W - 110); }); txt(x, "Arrivals Court is through the door ahead.", W / 2, H - 90, "400 26px " + FT.ui, "#8f8a80", 0, "center", W - 60); });
    K.box(1.1, 2.7, 0.3, M.walnut, 12.0, F, -5.7, -Math.PI / 2, -1.2); K.box(1.2, 0.06, 0.4, M.bronze, 12.0, F, -5.7, -Math.PI / 2); K.solid(12.0, -5.7, 1.1, 0.3, 0, 2.7, -Math.PI / 2);
    [-Math.PI / 2, Math.PI / 2].forEach(function (r0) { var p = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 2.4), new THREE.MeshBasicMaterial({ map: dir })); p.position.set(12.0 + (r0 < 0 ? -0.16 : 0.16), F + 1.45, -5.7); p.rotation.y = r0; p.userData.noSolid = true; g.add(p); });
  }

  // ── hanging wayfinding (double-sided, black glass and bronze) ──
  function hangSign(K, M, g, key, rowsA, rowsB, x, y, z, ry, w, h) { var tA = wayTex(key + "A", rowsA, 1024, Math.round(1024 * h / w)), tB = wayTex(key + "B", rowsB, 1024, Math.round(1024 * h / w)); [[tA, 0], [tB, Math.PI]].forEach(function (s) { var p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: s[0] })); var a = ry + s[1]; p.position.set(x + Math.sin(a) * 0.035, y, z + Math.cos(a) * 0.035); p.rotation.y = a; p.userData.noSolid = true; g.add(p); }); K.box(w + 0.08, h + 0.08, 0.06, M.bronze, x, y - h / 2 - 0.04, z, ry); [-w / 2 + 0.3, w / 2 - 0.3].forEach(function (o) { K.box(0.012, 9.2 - (y + h / 2), 0.012, M.steel, x + Math.cos(ry) * o, y + h / 2, z - Math.sin(ry) * o); }); }
  function buildSigns(K, M, g) {
    // over the concourse west of the crossing, seen walking SW (face +x) and NE (face -x)
    hangSign(K, M, g, "w1", [["bag", "Baggage claim", "ur"], ["cup", "Sky Cafe  ·  Giveback Lounge", "ul"]], [["exit", "Arrivals Court  ·  The Landing", "u"], ["people", "Industry Partners", "u"], ["plane", "Gate A2  ·  The Apron", "ur"]], -7.6, F + 4.9, -0.5, Math.PI / 2, 5.4, 1.5);
    // over the airside axis: walking to the door (face -z) and coming in (face +z)
    hangSign(K, M, g, "w2", [["exit", "Arrivals Court  ·  Industry Partners", "ur"], ["bag", "Baggage claim  ·  Check-in", "ul"]], [["plane", "Gate A2  ·  The Apron", "u"]], 0, F + 4.6, 13.5, 0, 5.2, 1.1);
    // at baggage claim looking back toward the hall
    hangSign(K, M, g, "w3", [["bag", "Baggage claim  1", "u"]], [["exit", "Arrivals Court  ·  The Landing", "ul"], ["info", "Information  ·  Check-in", "l"]], -19.0, F + 4.4, -12.4, 0, 4.8, 1.1);
    // the lounge and cafe blade
    hangSign(K, M, g, "w4", [["exit", "Arrivals Court", "ur"]], [["lounge", "Giveback Lounge", "u"], ["cup", "Sky Cafe", "ur"]], -15.8, F + 4.2, 3.9, 0, 3.8, 0.95);
    // the Stellar Aviation FBO lightbox over the airside axis: arrivals from Gate A2 read WELCOME TO SOLPORT, the hall side reads the gate
    var wA = panel("stWelA", 2048, 400, function (x, W, H) { stellarFace(x, W, H, { fbo: true, big: "SOLPORT", sub: "WELCOME", k: 1.05 }); }), wB = panel("stWelB", 2048, 400, function (x, W, H) { stellarFace(x, W, H, { fbo: true, sub: "GATE A2  ·  THE APRON", k: 1.05 }); });
    var ww = 7.2, wh = ww * 400 / 2048, wy = F + 6.3, wz = 19.6; [[wA, 0], [wB, Math.PI]].forEach(function (s) { var p = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), new THREE.MeshBasicMaterial({ map: s[0] })); p.position.set(Math.sin(s[1]) * 0.075, wy, wz + Math.cos(s[1]) * 0.075); p.rotation.y = s[1]; p.userData.noSolid = true; g.add(p); });
    K.box(ww + 0.2, wh + 0.2, 0.14, M.bronze, 0, wy - wh / 2 - 0.1, wz); [-ww / 2 + 0.4, ww / 2 - 0.4].forEach(function (o) { K.box(0.012, 9.2 - (wy + wh / 2 + 0.1), 0.012, M.steel, o, wy + wh / 2 + 0.1, wz); });
  }

  // ───────────────────────── lights (the client's five pooled point lights and hemisphere, plus three more and three spots) ─────────────────────────
  var LIGHT_SPOTS = [[0, 6.2, -20], [-19, 5.8, -17], [18.6, 6.0, -19.5], [18.5, 6.0, -1.5], [20.5, 6.0, 14.5], [-19.5, 5.2, 14.5], [-4.5, 6.2, 17.5], [0, 6.4, -6.5]];
  function buildLights(g) {
    var pts = [], hemi = null; g.children.forEach(function (o) { if (o.isPointLight) pts.push(o); if (o.isHemisphereLight) hemi = o; });
    while (pts.length < 8) { var l = new THREE.PointLight(0xffd9ac, 0.5, 24, 1.2); g.add(l); pts.push(l); }
    pts.forEach(function (l, i) { var p = LIGHT_SPOTS[i]; l.position.set(p[0], p[1], p[2]); l.color.setHex(0xffd6a6); l.distance = 26; l.decay = 1.2; });
    var spots = [], aim = [[[0, 8.6, -15], [0, 4.4, -26.8]], [[18.6, 8.6, -14.5], [18.6, 2.2, -26.4]], [[15.5, 8.6, -10.9], [24.4, 2.2, -10.9]]];
    aim.forEach(function (a) { var sp = new THREE.SpotLight(0xfff0dc, 1.2, 30, 0.42, 0.6, 1.1); sp.position.set(a[0][0], a[0][1], a[0][2]); var t = new THREE.Object3D(); t.position.set(a[1][0], a[1][1], a[1][2]); g.add(t); sp.target = t; g.add(sp); spots.push(sp); });
    if (hemi) { hemi.color.setHex(0xe4ecf2); hemi.groundColor.setHex(0x8f7d66); }
    return { pts: pts, hemi: hemi, spots: spots };
  }

  // ───────────────────────── the sun through the three skylights ─────────────────────────
  function buildSun(g, M) { var list = []; var sp = panel("spill", 64, 256, function (x, W, H) { var gg = x.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, "rgba(255,255,255,0)"); gg.addColorStop(0.65, "rgba(255,255,255,0.35)"); gg.addColorStop(1, "rgba(255,255,255,0.9)"); x.fillStyle = gg; x.fillRect(0, 0, W, H); }, true); M.spill = new THREE.MeshBasicMaterial({ map: sp, color: 0xe6eefc, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -9 }); var sm = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF, 10), M.spill); sm.rotation.x = -Math.PI / 2; sm.position.set(0, F + 0.011, HALF - 5); sm.userData.noSolid = true; sm.renderOrder = 3; g.add(sm); [-13, 0, 13].forEach(function (sz) { var p = new THREE.Mesh(new THREE.PlaneGeometry(52, 3), M.sunPatch); p.rotation.x = -Math.PI / 2; p.position.set(0, F + 0.012, sz); p.userData.noSolid = true; p.renderOrder = 3; g.add(p); var sh = new THREE.Mesh(new THREE.PlaneGeometry(52, 1), M.shaft); sh.userData.noSolid = true; sh.renderOrder = 4; g.add(sh); list.push({ p: p, sh: sh, z: sz }); }); return list; }
  function keyDir() { var v = new THREE.Vector3(); try { if (typeof CSMX !== "undefined" && CSMX.on && CSMX.csm) { v.copy(CSMX.csm.lightDirection).multiplyScalar(-1); } else { v.copy(sun.position).sub(sun.target.position); } } catch (e) { v.set(0.3, 1, 0.2); } return v.normalize(); }
  var _bX = null, _bY = null, _bZ = null, _bM = null;
  function updateSun(R, e, M) { if (!R.sun) return; var d = keyDir(), nk = nightK(); var c = Math.cos(e[3]), s = Math.sin(e[3]); var lx = d.x * c - d.z * s, lz = d.x * s + d.z * c; var up = d.y; var k = (1 - nk) * clamp((up - 0.12) * 3, 0, 1); M.sunPatch.opacity = 0.34 * k; M.shaft.opacity = 0.028 * k; if (M.spill) M.spill.opacity = 0.16 * (1 - nk); var hgt = 9.9 - F, ox = up > 0.12 ? -lx / up * hgt : 0, oz = up > 0.12 ? -lz / up * hgt : 0; ox = clamp(ox, -30, 30); oz = clamp(oz, -12, 12);
    if (!_bX) { _bX = new THREE.Vector3(); _bY = new THREE.Vector3(); _bZ = new THREE.Vector3(); _bM = new THREE.Matrix4(); }
    var L = Math.hypot(ox, hgt, oz); _bY.set(-ox, hgt, -oz).normalize(); _bX.set(1, 0, 0); _bZ.crossVectors(_bX, _bY).normalize(); _bX.crossVectors(_bY, _bZ).normalize(); _bM.makeBasis(_bX, _bY, _bZ);
    R.sun.forEach(function (S) { var zc = S.z + oz; var vis = k > 0.01 && Math.abs(zc) < HALF - 1.4; S.p.visible = vis; S.sh.visible = vis && M.shaft.opacity > 0.004; if (!vis) return; S.p.position.set(ox, F + 0.012, zc); S.sh.position.set(ox / 2, (9.9 + F) / 2, S.z + oz / 2); S.sh.quaternion.setFromRotationMatrix(_bM); S.sh.scale.set(1, L, 1); }); }

  // ───────────────────────── furnishTerminal replacement ─────────────────────────
  function furnish(g, half, hgt) {
    var e = g.userData.e || TE(); if (!e) throw new Error("no terminal placement");
    PT.plats = []; PT.screens = []; PT.bags = null; PT.fire = null; PT.downs = [];
    var M = mats(); var base = g.children.slice(); restyleBase(g, base, half, hgt, M);
    var K = new Kit(g, e), t0 = performance.now();
    var steps = [["room", buildRoom], ["checkin", buildCheckin], ["baggage", buildBaggage], ["info", buildInfo], ["cafe", buildCafe], ["lounge", buildLounge], ["gate", buildGate], ["apron", buildApron], ["plants", buildPlants], ["heritage", buildHeritage], ["history", buildHistoryWall], ["plantable", buildPlanTable], ["partners", buildPartners], ["signs", buildSigns]];
    steps.forEach(function (st) { try { st[1](K, M, g, st[0] === "heritage" ? e : half, hgt); } catch (err) { note("build " + st[0], err); } });
    K.done();
    var R = { lights: buildLights(g), sun: buildSun(g, M), built: performance.now() - t0 };
    g.userData.pt = R; g.userData.ptOK = true; PT.n.build = Math.round(R.built); PT.last = { g: g }; g.userData.ptMissing = tsetMissing().length; R.at = performance.now();
  }

  // ───────────────────────── hall people: walkers on an aisle graph, seated travellers, the info desk attendant ─────────────────────────
  var NODES = { c0: [-22.5, -0.5], c1: [-15, -0.5], c2: [-8.6, -1.2], c3: [0, -2.6], c4: [7.4, -1.4], c5: [13.4, -0.5], c6: [18.6, -0.5], c7: [23.6, -0.5],
    b1: [-19, -11.8], b2: [-11.6, -15.2], b3: [-11.4, -21.9], b4: [-24.6, -12.6], b5: [-15.4, -15.3], b6: [-22.6, -15.3], b7: [-12.0, -25.2],
    k0: [-7.8, -16.6], k1: [-5.4, -16.6], k2: [-1.8, -16.6], k3: [1.8, -16.6], k4: [5.4, -16.6], k5: [7.8, -16.6], i1: [-3.3, -10.5], i2: [3.3, -10.5], i3: [0, -7.3], i4: [-3.1, -7.45], i5: [3.1, -7.45],
    h1: [13.2, -12.5], h2: [18.4, -18.2], h3: [19.2, -10.9], h4: [19.2, 9.4], h5: [19.2, 19.6], h6: [14.6, 6.2], h7: [14.6, 12.6], h8: [16.0, -18.0],
    a1: [0, 4.2], a2: [0, 10.5], a3: [0, 17.0], a4: [0, 22.6], a5: [0, 25.4],
    g1: [-12.6, 6.4], g2: [-12.6, 20.4], g3: [-6.9, 3.6], f1: [-16.9, 6.2], f2: [-21.1, 10.8], f3: [-12.9, 15.6], f5: [-21.0, 6.4], f6: [-21.0, 15.4], l1: [-13.0, 17.9], l2: [-18.3, 18.5],
    n1: [7.6, 20.4], n2: [14.4, 23.2], n3: [9.4, 12.4], d1: [23.6, -0.5] };
  var EDGES = ["c0-c1", "c1-c2", "c2-c3", "c3-c4", "c4-c5", "c5-c6", "c6-c7", "c0-b4", "c1-b1", "b1-b4", "b1-b5", "b5-b6", "b5-b2", "b6-b4", "b2-b3", "b3-b7", "b2-k0", "c2-b2", "k0-k1", "k1-k2", "k2-k3", "k3-k4", "k4-k5", "k0-i1", "k5-i2", "i1-i4", "i4-i3", "i2-i5", "i5-i3", "i3-c3", "i2-c4", "i1-c2", "k5-h1", "c4-h1", "h1-h8", "h8-h2", "h1-h3", "c5-h1", "c6-h3", "c5-h6", "c6-h4", "h6-h4", "h6-h7", "h7-h4", "h7-h5", "h4-h5", "c3-a1", "a1-a2", "a2-a3", "a3-a4", "a4-a5", "a1-g3", "g3-g1", "c1-f1", "f1-g1", "f1-f5", "f5-f2", "f2-f6", "f6-f3", "g1-f3", "f3-l1", "g1-l1", "l1-g2", "l1-l2", "a3-n1", "n1-n2", "n1-n3", "n3-a2", "n3-h7", "n2-h5", "c7-d1"];
  // places people walk to: [node, x, z, face (room yaw) | null, dwell s, exit]
  var DEST = [["b5", -15.4, -16.0, Math.PI, 14], ["b6", -22.6, -16.0, Math.PI, 14], ["b2", -12.2, -19.2, -Math.PI / 2, 12], ["k1", -5.4, -20.6, Math.PI, 9], ["k2", -1.8, -20.6, Math.PI, 9], ["k3", 1.8, -20.6, Math.PI, 9], ["k4", 5.4, -20.6, Math.PI, 9],
    ["i3", 0, -7.9, Math.PI, 7], ["i1", -3.3, -7.8, Math.PI, 6], ["i2", 3.3, -7.8, Math.PI, 6], ["h8", 16.2, -19.6, Math.PI, 9], ["h3", 20.6, -12.9, -Math.PI / 2, 9], ["h4", 20.6, 7.4, -Math.PI / 2, 8], ["h5", 20.6, 17.6, -Math.PI / 2, 8], ["h2", 20.2, -19.4, Math.PI, 8],
    ["f2", -21.5, 11.6, -Math.PI / 2, 10], ["f2", -21.5, 9.6, -Math.PI / 2, 10], ["n2", 12.0, 23.6, 0, 12], ["n2", 15.6, 23.6, 0, 12], ["a4", -1.6, 22.8, 0, 6], ["g2", -12.6, 21.0, Math.PI / 2, 6], ["c3", 0.6, -3.4, 0.4, 8],
    ["a5", 0, 26.2, 0, 0, "air"], ["d1", 25.2, -0.5, Math.PI / 2, 0, "land"], ["b7", -12.0, -26.2, Math.PI, 0, "arr"]];
  var ENTRY = { air: ["a5", 0, 25.8, Math.PI], land: ["d1", 25.0, -0.5, -Math.PI / 2], arr: ["b7", -12.0, -26.1, 0] };
  function graph() { if (PT.G) return PT.G; var adj = {}; for (var k in NODES) adj[k] = []; EDGES.forEach(function (s) { var p = s.split("-"); var a = NODES[p[0]], b = NODES[p[1]]; if (!a || !b) return; var d = Math.hypot(a[0] - b[0], a[1] - b[1]); adj[p[0]].push([p[1], d]); adj[p[1]].push([p[0], d]); }); return (PT.G = adj); }
  function route(from, to) { var G = graph(), dist = {}, prev = {}, Q = Object.keys(NODES); for (var i = 0; i < Q.length; i++) dist[Q[i]] = 1e9; dist[from] = 0; while (Q.length) { var bi = 0; for (var j = 1; j < Q.length; j++) if (dist[Q[j]] < dist[Q[bi]]) bi = j; var u = Q.splice(bi, 1)[0]; if (u === to || dist[u] >= 1e9) break; G[u].forEach(function (n) { var nd = dist[u] + n[1]; if (nd < dist[n[0]]) { dist[n[0]] = nd; prev[n[0]] = u; } }); } var path = [], c = to; if (dist[to] >= 1e9) return null; while (c) { path.unshift(c); c = prev[c]; } return path; }
  function nearestNode(x, z) { var best = null, bd = 1e9; for (var k in NODES) { var d = Math.hypot(NODES[k][0] - x, NODES[k][1] - z); if (d < bd) { bd = d; best = k; } } return best; }
  var LOOKS = [[{ body: "m", skin: "e8c19a", shirt: "1f2a3c", pants: "2b2f36", hair: 1, hairc: "3a2416" }, null, null, "Traveller"], [{ body: "f", skin: "c98f63", shirt: "e9e2d3", pants: "1c1f24", hair: 2, hairc: "1c1512" }, null, null, "Traveller"], [{ body: "m", skin: "8d5a3b", shirt: "e9e2d3", pants: "1c1f24", hair: 3 }, "hat_cap", "outfit_flight", "Captain"], [{ body: "f", skin: "f3d9c0", shirt: "6e1f24", pants: "2b2f36", hair: 1, hairc: "6b4226" }, null, null, "Guest"], [{ body: "m", skin: "d9a877", shirt: "3a4a5a", pants: "6d5a3e", hair: 0 }, null, null, "Resident"], [{ body: "f", skin: "a86f46", shirt: "1c1f24", pants: "1c1f24", hair: 2, hairc: "1c1512" }, null, "outfit_flight", "Cabin crew"], [{ body: "m", skin: "e8c19a", shirt: "f5f1e6", pants: "3a3d42", hair: 1, hairc: "6b4226" }, "hat_trucker", null, "Visitor"], [{ body: "f", skin: "e8c19a", shirt: "3a7bd5", pants: "e9e2d3", hair: 1, hairc: "c9a24d" }, null, null, "Traveller"], [{ body: "m", skin: "c98f63", shirt: "2a7a3e", pants: "1c1f24", hair: 3 }, null, null, "Guest"], [{ body: "f", skin: "8d5a3b", shirt: "d8c39a", pants: "2b3a4a", hair: 2, hairc: "1c1512" }, null, null, "Resident"], [{ body: "m", skin: "f3d9c0", shirt: "1c1f24", pants: "1c1f24", hair: 0 }, "hat_cap", "outfit_flight", "First officer"], [{ body: "f", skin: "d9a877", shirt: "4a5a3a", pants: "1c1f24", hair: 1, hairc: "3a2416" }, null, null, "Traveller"]];
  function mkPerson(id, i) { var L = LOOKS[i % LOOKS.length]; var a = avatar(id, L[3], L[0], L[1], L[2]); try { a.userData.label.scale.set(1.3, 0.34, 1); } catch (e) {} return a; }
  function suitcase(M, col) { var s = new THREE.Group(); var body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.58, 0.24), new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.1 })); body.position.y = 0.36; s.add(body); var h = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 0.03), M.stain); h.position.set(0, 0.86, -0.08); s.add(h); var hb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.04), M.rubber); hb.position.set(0, 1.07, -0.08); s.add(hb); [-0.14, 0.14].forEach(function (x) { var w = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 10), M.rubber); w.rotation.z = Math.PI / 2; w.position.set(x, 0.05, 0.08); s.add(w); }); s.traverse(function (o) { if (o.isMesh) o.userData.noSolid = true; }); return s; }
  function spawnPeople(g, half) {
    var M = mats(); var hall = []; hall.pt = true; SITES.hall = hall;
    var dests = DEST.filter(function (d) { return !d[5]; });
    for (var i = 0; i < 8; i++) { var a = mkPerson("hall_" + i, i); var d0 = dests[(i * 7) % dests.length]; var n0 = NODES[d0[0]]; a.position.set(n0[0], F, n0[1]); g.add(a); var w = { g: a, path: [], k: 0, speed: 1.12 + (i % 4) * 0.1, pause: 1 + i * 0.8, dest: null, at: n0.slice(), node: d0[0], lane: ((i % 3) - 1) * 0.35, hidden: 0 };
      if (i % 3 === 0) { var sc = suitcase(M, [0x1d2a44, 0x1b1b1d, 0x6e1f24, 0x3a3d42][i % 4]); a.add(sc); sc.position.set(0.3, 0, -0.32); w.bag = sc; }
      hall.push(w); }
    // seated: two in the gate rows, one by the lounge fire, one in the apron lounge, one at a cafe table
    var seats = [[-11.3 + 0.64, 12.0, 0], [-11.3 + 4 * 0.64, 12.0, 0], [-23.6, 24.2, Math.PI]], sy = [0.47, 0.47, 0.46];
    seats.forEach(function (s, j) { var a = mkPerson("hall_s" + j, j + 3); a.position.set(s[0], F + sy[j], s[1]); a.rotation.y = s[2]; a.userData.sit = true; try { sitOffset(a); } catch (e) {} g.add(a); hall.push({ g: a, seated: true }); });
    // staff: the information desk attendant and a second check-in agent
    [[0, -11.2, 0, { body: "f", skin: "c98f63", shirt: "1d3b2c", pants: "1c1f24", hair: 2, hairc: "1c1512" }, "Information"], [5.4, -23.3, 0, { body: "m", skin: "e8c19a", shirt: "e9e2d3", pants: "1c1f24", hair: 3 }, "Check-in"]].forEach(function (s, j) { var a = avatar("hall_t" + j, s[4], s[3], null, "outfit_flight"); try { a.userData.label.scale.set(1.3, 0.34, 1); } catch (e) {} a.position.set(s[0], F, s[1]); a.rotation.y = s[2]; g.add(a); hall.push({ g: a, staff: true, home: [s[0], s[1], s[2]] }); });
    // booth guests sitting in one tub chair at Stellar and JetFinders
    var I = boothInfo(); [["stellar", 1, 5]].forEach(function (q, j) { var ch = I.lounge && I.lounge.chairs && I.lounge.chairs[q[1]]; if (!ch) return; var sl = SLOTS[q[0]]; var tb = I.lounge.table ? I.lounge.table.center : [0.72, 1.6]; var p = slotPt(sl, ch.center[0], ch.center[1]); var face = sl.yaw + Math.atan2(tb[0] - ch.center[0], tb[1] - ch.center[1]); var a = mkPerson("hall_b" + j, q[2]); a.position.set(p[0], F + (ch.seat_y || 0.68) * sl.s - 0.02, p[1]); a.rotation.y = face; a.userData.sit = true; try { sitOffset(a); } catch (e) {} g.add(a); hall.push({ g: a, seated: true }); });
    PT.n.people = hall.length;
  }
  function pickDest(w) { var list = DEST; for (var t = 0; t < 6; t++) { var d = list[Math.floor(Math.random() * list.length)]; if (d[0] !== w.node || d[5]) return d; } return list[0]; }
  function planWalk(w) { var d = pickDest(w); var from = nearestNode(w.g.position.x, w.g.position.z); var r = route(from, d[0]); if (!r) { w.pause = 2; return; } var pts = [[w.g.position.x, w.g.position.z]]; r.forEach(function (n, i) { var p = NODES[n]; if (i === 0 && Math.hypot(p[0] - w.g.position.x, p[1] - w.g.position.z) < 0.5) return; pts.push([p[0], p[1]]); }); pts.push([d[1], d[2]]);
    // a lane offset on the inner points so people do not walk single file
    for (var i = 1; i < pts.length - 1; i++) { var a = pts[i - 1], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; pts[i] = [pts[i][0] - dz / L * w.lane, pts[i][1] + dx / L * w.lane]; }
    w.path = pts; w.k = 0; w.dest = d; w.node = d[0]; }
  function turnTo(g, want, dt, rate) { var dr = want - g.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); var mx = (rate || 4) * dt; g.rotation.y += dr > mx ? mx : dr < -mx ? -mx : dr; }
  // the walk clip carries the feet about 10 cm over the idle stance; when the client seats walking feet itself it sets window.WALK_DROP_FIXED and this is skipped
  function walkW(g) { if (window.WALK_DROP_FIXED) return 0; var u = g.userData.w; return u ? Math.min(1, (u.walk || 0) + (u.jog || 0) + (u.run || 0)) : 0; }
  function hallUpdate(dt) {
    var H = SITES.hall; if (!H || !inside) { if (H && !inside) SITES.hall = null; return; } dt = Math.min(dt, 0.1);
    for (var i = 0; i < H.length; i++) { var w = H[i], a = w.g;
      if (w.seated) { animateWalk(a, 0, dt); continue; }
      if (w.staff) { var dx0 = player.position.x, dz0 = player.position.z; var e0 = inside.door.e; var pl0 = w2l(e0, dx0, dz0); var dd = Math.hypot(pl0[0] - w.home[0], pl0[1] - w.home[1]); turnTo(a, dd < 7 ? Math.atan2(pl0[0] - w.home[0], pl0[1] - w.home[1]) : w.home[2], dt, 2.5); a.position.y = F; animateWalk(a, 0, dt); continue; }
      if (w.hidden > 0) { w.hidden -= dt; if (w.hidden <= 0) { var en = ENTRY[["air", "land", "arr"][Math.floor(Math.random() * 3)]]; a.position.set(en[1], F, en[2]); a.rotation.y = en[3]; a.visible = true; w.node = en[0]; w.pause = 0.5; w.path = []; } continue; }
      if (w.pause > 0) { w.pause -= dt; if (w.dest && w.dest[3] !== null && w.dest[3] !== undefined) turnTo(a, w.dest[3], dt, 3); animateWalk(a, 0, dt); a.position.y = floorAt(a.position.x, a.position.z); if (w.bag) w.bag.rotation.x += (0 - w.bag.rotation.x) * Math.min(1, dt * 4); if (w.pause <= 0) planWalk(w); continue; }
      if (!w.path || w.k >= w.path.length - 1) { if (w.dest && w.dest[5]) { a.visible = false; w.hidden = 6 + Math.random() * 14; w.dest = null; continue; } w.pause = w.dest ? w.dest[4] * (0.6 + Math.random() * 0.8) : 1; if (!w.dest) planWalk(w); continue; }
      var p0 = w.path[w.k], p1 = w.path[w.k + 1], dx = p1[0] - a.position.x, dz = p1[1] - a.position.z, L = Math.hypot(dx, dz);
      if (L < 0.25) { w.k++; continue; } var st = Math.min(L, w.speed * dt); a.position.x += dx / L * st; a.position.z += dz / L * st; turnTo(a, Math.atan2(dx, dz), dt, 5);
      animateWalk(a, w.speed, dt); a.position.y = floorAt(a.position.x, a.position.z) - DROP * walkW(a); if (w.bag) w.bag.rotation.x += (0.42 - w.bag.rotation.x) * Math.min(1, dt * 4); }
  }

  // ───────────────────────── partner staff (talk cards) and the terminal cast ─────────────────────────
  var TALK = window.PLAN_TALK = window.PLAN_TALK || {};
  var STAFF = PT.staff = PT.staff || {};
  var LOOK = { stellar: [{ body: "m", skin: "e3b48f", shirt: "1c1f24", pants: "1c1f24", hair: 1, hairc: "1c1512" }], financeadvisors: [{ body: "m", skin: "e3b48f", shirt: "1f2a3c", pants: "3a3d42", hair: 3, hairc: "5b4634", height: 1.03 }], jetfinders: [{ body: "m", skin: "d9a877", shirt: "0f1a2e", pants: "2b2f36", hair: 1, hairc: "3a2416" }] };
  function staffSpot(id) { var I = boothInfo(), sl = SLOTS[id], sp = I.desk && I.desk.staff_spot || [-2.55, 0.158, 0.6]; var p = slotPt(sl, sp[0], sp[2]); return { x: p[0], z: p[1], y: F + (I.platform_top || 0.158) * sl.s, yaw: sl.yaw }; }
  function visitorSpot(id) { var I = boothInfo(), sl = SLOTS[id], sp = I.desk && I.desk.visitor_spot || [-2.55, 0.158, 2.25]; var p = slotPt(sl, sp[0], sp[2] + 0.4); return p; }
  function makeStaff(id) {
    var e = TE(); if (!e || STAFF[id]) return; var p = P(id); var npc = p.npc || {}; var L = LOOK[id]; if (!L) return; var sp = staffSpot(id), w = l2w(e, sp.x, sp.z);
    var g = avatar("pt_" + id, npc.name || p.name, L[0], null, null); try { g.userData.label.scale.set(1.9, 0.48, 1); } catch (x) {} g.position.set(w[0], e[1] + sp.y, w[1]); g.rotation.y = e[3] + sp.yaw; g.visible = false; scene.add(g);
    var S = STAFF[id] = { id: npc.id || ("pt_" + id), pid: id, ph: g, rig: null, home: sp, yaw0: e[3] + sp.yaw, cool: 0 };
    S.hsText = function () { var q = P(id); return (q.talk && q.talk[0] && q.talk[0].t) || q.blurb || ""; };
    var T = TALK[S.id] = { id: S.id, name: npc.name || p.name, role: npc.role || p.name, talk: p.talk, kw: [], greet: p.greet || [], ptContact: p.contact || null, ptFooter: p.footer || null, ptPartner: id, get g() { return S.rig || S.ph; } };
    var vs = visitorSpot(id), vw = l2w(e, vs[0], vs[1]); var hs = { x: vw[0], z: vw[1], r: 4.2, t: T.name, k: T.role + " · press E to talk", p: (p.talk && p.talk[0] && p.talk[0].t) || p.blurb || "", play: "npc:" + S.id }; hotspots.push(hs); S.hs = hs;
  }
  function refreshTalk() { for (var k in STAFF) { var S = STAFF[k], p = P(S.pid), T = TALK[S.id]; if (S.hs && S.hsText) S.hs.p = S.hsText(); if (T && p) { T.talk = p.talk; T.greet = p.greet || []; T.ptContact = p.contact || null; T.ptFooter = p.footer || null; if (p.npc) { T.name = p.npc.name || T.name; T.role = p.npc.role || T.role; } } } var c = castFind("freedomair"); if (c) { var f = P("freedomair"); if (f && f.talk) { c.talk = f.talk; c.greet = f.greet || c.greet; c.ptContact = f.contact || null; c.ptPartner = "freedomair"; if (f.npc && f.npc.role) c.role = f.npc.role; castName(c, f.npc); } } }
  function castFind(id) { try { for (var i = 0; i < CAST.length; i++) if (CAST[i].id === id) return CAST[i]; } catch (e) {} return null; }
  // the terminal cast moves to the new desks: [id, x, z, yaw]
  var CASTPOS = { rosa: [-1.8, -23.3, 0], marcus: [6.1, 22.2, -Math.PI / 2], dale: [-6.1, 22.2, Math.PI / 2], lupe: [-24.1, 11.8, Math.PI / 2], freedomair: null };
  function placeCast() {
    var e = TE(); if (!e) return false; var any = false;
    for (var id in CASTPOS) { var c = castFind(id); if (!c) continue; any = true; var p = CASTPOS[id]; if (!p) { var sp = staffSpot("freedomair"); p = [sp.x, sp.z, sp.yaw, sp.y]; } var w = l2w(e, p[0], p[1]); c.pos = [w[0], w[1]]; c.rot = e[3] + p[2]; c.ptFloor = p[3] || F; c.ptLocal = p; c.g.position.set(w[0], e[1] + c.ptFloor, w[1]); c.g.rotation.y = c.rot;
      var hs = null; for (var h = 0; h < hotspots.length; h++) if (hotspots[h].play === "npc:" + id) { hs = hotspots[h]; break; } if (hs) { var hv = id === "freedomair" ? visitorSpot("freedomair") : [p[0] + Math.sin(p[2]) * 1.6, p[1] + Math.cos(p[2]) * 1.6]; var hw = l2w(e, hv[0], hv[1]); hs.x = hw[0]; hs.z = hw[1]; hs.r = 4.2; } }
    return any;
  }
  // The partners' rigged models (PLAN_MODEL_INFO.<key>, published by the asset rounds once installed): each swaps in for
  // its placeholder once its idle clip plays. Paul (FinanceAdvisors.com), Brad (Stellar Aviation), Jake (JetFinders),
  // Beth (Freedom Air, standing by the lounge), and Joe, who takes over the Freedom Air desk character from the client cast.
  var RIGS = { financeadvisors: "paul", stellar: "brad", jetfinders: "jake", fa_beth: "beth" };
  var BETH_AT = [-0.55, -1.05];   // booth-local spot in the Freedom Air booth, between the desk and the lounge
  function rigInfo(key) { var I = window.PLAN_MODEL_INFO && window.PLAN_MODEL_INFO[key]; return I && I.file && I.installed !== false ? I : null; }
  function loadRig(key, onReady, onFail) {
    var I = rigInfo(key); if (!I) return false;
    try { var mob = false; try { mob = typeof ASSET !== "undefined" && /models_m/.test(ASSET.models); } catch (e) {} var ld = gltfLoader(), q = "?v=" + (window.BUILD || "dev"), an = 1; try { an = MAX_ANISO || 1; } catch (e) {}
      ld.load((mob && I.mobile ? I.mobile : I.file) + q, function (gl) { try { var g = gl.scene; g.traverse(function (o) { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; var m = o.material; if (m && m.map && an > 1) { m.map.anisotropy = an; m.map.needsUpdate = true; } } }); var bb = new THREE.Box3().setFromObject(g), h = bb.max.y - bb.min.y; var want = (I.size && I.size[1]) || I.height || 1.8; if (h > 0.5 && (h < want * 0.85 || h > want * 1.15)) g.scale.multiplyScalar(want / h); g.userData.noCull = true; var mixer = new THREE.AnimationMixer(g), done = false;
          var useClip = function (cl) { if (!cl || done) return; done = true; cl.tracks = cl.tracks.filter(function (t) { return !/\.scale$/.test(t.name); }); var act = mixer.clipAction(cl); act.play(); onReady(g, mixer, act); };
          var emb = (gl.animations || []).filter(function (a) { return /idle|stand|breath|talk/i.test(a.name); })[0]; if (emb) useClip(emb); else if (I.idle) ld.load(I.idle + q, function (c) { useClip(c.animations && c.animations[0]); }, undefined, function (e) { onFail(e); }); else onFail("no idle clip");
        } catch (err) { onFail(err); } }, undefined, function (e) { onFail(e); });
    } catch (err) { onFail(err); }
    return true;
  }
  function staffRig(pid) {
    var S = STAFF[pid], key = RIGS[pid]; if (!S || S.rigState || !key || !rigInfo(key)) return; S.rigState = 1;
    loadRig(key, function (g, mixer, act) { if (S.rig) return; g.visible = false; S.rigG = g; S.mixer = mixer; S.idle = act; scene.add(g); S.rig = g; g.position.copy(S.ph.position); g.rotation.y = S.ph.rotation.y; S.ph.visible = false; S.rigState = 2; PT.n[key + "Rig"] = 1; }, function (e) { S.rigState = 3; note(key + " rig", e); });
  }
  function paulRig() { staffRig("financeadvisors"); }
  // Beth: no talk card of her own (Joe keeps the Freedom Air desk); an empty placeholder until her model loads
  function makeBeth() {
    var e = TE(); if (!e || STAFF.fa_beth || !SLOTS.freedomair) return; var sl = SLOTS.freedomair, I = boothInfo(), p = slotPt(sl, BETH_AT[0], BETH_AT[1]), w = l2w(e, p[0], p[1]);
    var ph = new THREE.Group(); ph.visible = false; scene.add(ph); var y = F + (I.platform_top || 0.158) * sl.s; ph.position.set(w[0], e[1] + y, w[1]); ph.rotation.y = e[3] + sl.yaw;
    STAFF.fa_beth = { id: "pt_beth", pid: "freedomair", ph: ph, rig: null, home: { x: p[0], z: p[1], y: y, yaw: sl.yaw }, yaw0: e[3] + sl.yaw, cool: 0, noWalk: true };
  }
  // Joe: his rig rides inside the client's Freedom Air cast character (its talk card, hotspot and turning stay the client's);
  // the cast's own body is hidden once he plays
  function joeRig() {
    if (PT.joe) return; var c = castFind("freedomair"); if (!c || !c.g || !rigInfo("joe")) return; PT.joe = { state: 1 };
    loadRig("joe", function (g, mixer) { var ud = c.g.userData, keep = [ud.label, ud.emote, ud.blob, ud.bubble, ud.cartG]; var hid = c.g.children.filter(function (ch) { return keep.indexOf(ch) < 0; });
      var sc = c.g.scale.x || 1; if (Math.abs(sc - 1) > 0.01) g.scale.multiplyScalar(1 / sc); g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); c.g.add(g); hid.forEach(function (ch) { ch.visible = false; });
      var ms = []; g.traverse(function (o) { if (o.isMesh || o.isSkinnedMesh) ms.push(o); }); PT.joe = { state: 2, g: g, mixer: mixer, hid: hid, ms: ms }; PT.n.joeRig = 1; }, function (e) { PT.joe = { state: 3 }; note("joe rig", e); });
  }
  function castName(c, npc) { if (!c || !npc || !npc.name || c.name === npc.name) return; c.name = npc.name; try { setName(c.g, npc.name); c.g.userData.label.scale.set(1.9, 0.48, 1); } catch (e) {} for (var h = 0; h < hotspots.length; h++) if (hotspots[h].play === "npc:" + c.id) { hotspots[h].t = c.name; hotspots[h].k = (npc.role || c.role) + " · press E to talk"; } }

  // ───────────────────────── the talk card: selectable contact details under a partner's card ─────────────────────────
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function contactCard() {
    var tn = null; try { tn = talkNpc; } catch (e) {} var card = document.getElementById("talk"); if (!card) return; var box = document.getElementById("pt-contact");
    if (!tn || !tn.ptContact) { if (box && box.style.display !== "none") box.style.display = "none"; return; }
    if (!box) { box = document.createElement("div"); box.id = "pt-contact"; box.style.cssText = "margin:-2px 0 12px;padding:10px 12px;border-radius:10px;background:rgba(245,241,230,.06);border:1px solid rgba(245,241,230,.14);user-select:text;-webkit-user-select:text;cursor:text;pointer-events:auto;font-size:13px;line-height:1.5"; var opt = document.getElementById("talk-o"); card.insertBefore(box, opt); ["mousedown", "keydown", "click"].forEach(function (ev) { box.addEventListener(ev, function (x) { x.stopPropagation(); }); }); }
    var key = (tn.ptPartner || tn.id) + "|" + (tn.ptFooter || ""); if (box.dataset.k !== key) { box.dataset.k = key; var c = tn.ptContact, h = ""; c.forEach(function (l, i) { var mono = /@|\.com|\+\d/.test(l); h += "<div style=\"" + (i === 0 ? "font-weight:600;color:#f5f1e6" : mono ? "font-family:'JetBrains Mono',monospace;font-size:12.5px;color:#8fd8ff" : "color:rgba(245,241,230,.72)") + "\">" + esc(l) + "</div>"; }); if (tn.ptFooter) h += "<div style=\"margin-top:8px;font-size:12px;font-style:italic;color:rgba(245,241,230,.62)\">" + esc(tn.ptFooter) + "</div>"; box.innerHTML = h; }
    if (box.style.display !== "block") box.style.display = "block";
  }

  // ───────────────────────── J: the terminal set on demand ─────────────────────────
  // Requested when the player comes near the FBO (inside its footprint plus 25 m at once, plus 90 m after the first 6 s of play), steps
  // inside, or is on the fly-in (from 25 s, or as soon as the cabin set has landed): the flight ends inside the room. A room built before
  // the set arrived uses the procedural pieces; when the set lands it is rebuilt in place (the player keeps their spot and view) at the
  // first calm moment: not seated, no talk card, not riding.
  function tsetMissing() { return TSET.filter(function (k) { try { return !!MODEL_SPECS[k] && !hasM(k); } catch (e) { return false; } }); }
  function tsetLoad(why) {
    if (PT.tsetP || typeof window.PLAN_LOAD_KINDS !== "function") return PT.tsetP || null;
    PT.n.tsetWhy = why; PT.n.tsetT0 = performance.now();
    PT.tsetP = window.PLAN_LOAD_KINDS(TSET).then(function (got) { PT.n.tsetMs = Math.round(performance.now() - PT.n.tsetT0); PT.n.tsetGot = got.length; PT.tsetDone = true; return got; }, function (err) { note("tset", err); PT.tsetP = null; return []; });
    return PT.tsetP;
  }
  PT.tsetLoad = tsetLoad; PT.tsetMissing = tsetMissing;
  function lazyFrame(e, inT, now) {
    if (PT.f0 === undefined) PT.f0 = now;
    if (inT && PT.tsetDone && !PT.tsetRetry && tsetMissing().length) { PT.tsetRetry = true; PT.tsetP = null; PT.tsetDone = false; }   // entering asks once more for what failed
    if (!PT.tsetP && typeof window.PLAN_LOAD_KINDS === "function") { var why = null;
      if (inT) why = "inside";
      else if (typeof FLY !== "undefined" && FLY.on) { if (FLY.t > 25 || (window.FLYIN && window.FLYIN.cabDone)) why = "fly-in"; }
      else if (player) { var R0 = (MODELS.terminal && MODELS.terminal.radius ? MODELS.terminal.radius * (e[4] || 1) : 48), d = Math.hypot(player.position.x - e[0], player.position.z - e[2]); if (d < R0 + 25 || (d < R0 + 90 && now - PT.f0 > 6000)) why = "approach " + Math.round(d - R0) + " m"; }
      if (why) tsetLoad(why); }
    if (inT && PT.tsetDone && inside && inside.g && inside.g.userData.ptMissing > 0 && tsetMissing().length < inside.g.userData.ptMissing) { var R = inside.g.userData.pt; if (R && now - (R.at || 0) > 1500 && calm()) refreshRoom(); }
  }
  function calm() { try { if (SIT.on || riding || (typeof ARC !== "undefined" && ARC.on)) return false; var tk = document.getElementById("talk"); if (tk && tk.classList.contains("on")) return false; if (typeof talkNpc !== "undefined" && talkNpc) return false; } catch (e) { return false; } return true; }
  function disposeG(L) { L.traverse(function (o) { if (o.userData && o.userData.ptStatic && o.geometry) o.geometry.dispose(); if (o.isInstancedMesh && o.userData.noSolid && o.geometry) o.geometry.dispose(); }); }
  function refreshRoom() {
    if (!inside || !inside.door || inside.door.kind !== "terminal") return false; var door = inside.door, e = door.e, oldG = inside.g;
    var lp = w2l(e, player.position.x, player.position.z), py = player.position.y - e[1], yw = yaw, pt = pitch, pr = player.rotation.y, lc = w2l(e, camera.position.x, camera.position.z), cy = camera.position.y;
    PT.n.refresh = (PT.n.refresh || 0) + 1; PT.n.refreshAt = Math.round(performance.now());
    try { leaveInterior(); enterInterior(door); } catch (err) { note("refresh", err); }
    if (!inside) return false;
    var w = l2w(e, lp[0], lp[1]); player.position.set(w[0], e[1] + py, w[1]); yaw = yw; pitch = pt; player.rotation.y = pr; var cw = l2w(e, lc[0], lc[1]); camera.position.set(cw[0], cy, cw[1]);
    try { lastSent.at = 0; pushMove(true); } catch (err) {}
    try { if (oldG !== inside.g && !oldG.parent) disposeG(oldG); } catch (err) { note("refresh dispose", err); }
    return true;
  }
  PT.refreshRoom = refreshRoom;

  // ───────────────────────── every frame ─────────────────────────
  var WARM = [function () { terrazzo("terr1", "#e5dccb", CH1, 7); }, function () { terrazzo("terr2", "#b0a797", CH2, 11); }, function () { woodTex("walnut2", "#2a1e16", "#6f5643", 5, 30); }, function () { woodTex("oakgrain", "#8a6440", "#c49a6c", 31, 44); }, function () { plankTex("planks"); }, function () { onyxTex(); }, function () { terrazzo("gravel", "#6f6457", CHG, 19); }, function () { patchTex(); scallopTex(); poolTex(); runnerTex(); }, function () { if (window.PLAN) planCanvas(); }];
  function warm(now) { if (PT.warmI === undefined) { PT.warmI = 0; PT.warmAt = now + 15000; } if (PT.warmI >= WARM.length || now < PT.warmAt || PT.warmBusy) return; PT.warmBusy = true; var run = function () { PT.warmBusy = false; PT.warmAt = performance.now() + 1500; try { WARM[PT.warmI++](); } catch (e) { note("warm", e); } }; if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 50); }
  var _v = null;
  function frame(dt, now) {
    var e = TE(); if (!e) return; var inT = inTerm(); dt = Math.min(dt || 0.016, 0.1); if (!inT) warm(now);
    try { lazyFrame(e, inT, now); } catch (err) { if (!PT.lazyErr) { PT.lazyErr = 1; note("lazy", err); } }
    try { brandFrame(); } catch (err) { if (!PT.brandErr) { PT.brandErr = 1; note("brand frame", err); } }
    if (!PT.castDone) { try { if (typeof CAST !== "undefined" && CAST.length && placeCast()) { PT.castDone = true; ["stellar", "financeadvisors", "jetfinders"].forEach(makeStaff); try { makeBeth(); } catch (err) { note("beth", err); } refreshTalk(); } } catch (err) { PT.castDone = true; note("cast", err); } }
    if (PT.data && !PT.dataUsed && PT.castDone) { PT.dataUsed = true; try { refreshTalk(); } catch (err) { note("talk", err); } }
    podium(inT);
    // the terminal cast stays on the floor (their spots are inside the room)
    if (PT.castDone) for (var id in CASTPOS) { var c = castFind(id); if (c && c.ptLocal) { var y0 = e[1] + (c.ptFloor || F); if (Math.abs(c.g.position.y - y0) > 0.001) c.g.position.y = y0; } }
    for (var k in STAFF) { var S = STAFF[k]; var g = S.rig || S.ph; if (S.ph.visible !== (inT && !S.rig)) S.ph.visible = inT && !S.rig; if (S.rig && S.rig.visible !== inT) S.rig.visible = inT; if (!inT) continue; g.position.y = e[1] + S.home.y; var dxp = player.position.x - g.position.x, dzp = player.position.z - g.position.z, dp = Math.hypot(dxp, dzp); turnTo(g, dp < 7 ? Math.atan2(dxp, dzp) : S.yaw0, dt, 3); if (S.rig) { if (S.mixer) S.mixer.update(dt); } else if (!S.noWalk) animateWalk(g, 0, dt);
      if (dp < 5.5 && now > S.cool && TALK[S.id] && TALK[S.id].greet && TALK[S.id].greet.length) { S.cool = now + 45000 + Math.random() * 30000; try { npcSay({ g: g, name: TALK[S.id].name }, TALK[S.id].greet[Math.floor(Math.random() * TALK[S.id].greet.length)]); } catch (err) {} } if (g.userData.bubble && now - (g.userData.bubbleAt || 0) > 7000) { g.remove(g.userData.bubble); g.userData.bubble = null; } }
    if (inT) { for (var rk in RIGS) if (STAFF[rk] && !STAFF[rk].rigState) staffRig(rk); if (!PT.joe) joeRig(); }
    if (PT.joe && PT.joe.state === 2) { var J = PT.joe; if (J.g.visible !== inT) J.g.visible = inT; if (inT) { J.mixer.update(dt); for (var mj = 0; mj < J.ms.length; mj++) if (!J.ms[mj].visible) J.ms[mj].visible = true; } for (var hj = 0; hj < J.hid.length; hj++) if (J.hid[hj].visible) J.hid[hj].visible = false; }
    contactCard();
    if (!inT) { if (PT.wasIn) { PT.wasIn = false; try { if (!window.WALK_DROP_FIXED && player && player.userData.walk && !player.userData.sitOff) player.userData.walk.position.y = 0; } catch (err) {} disposeRoom(); } return; }
    PT.wasIn = true; var R = inside.g.userData.pt; if (!R) return; var M = PT.M;
    if (!R.tidy) { R.tidy = true; try { tidyClient(inside.g, inside.half, M); } catch (err) { note("tidy", err); } }
    // the local player and other players inside the room stand on the floor (booth platforms too); the walk clip's 10 cm lift is taken out
    try { if (!window.WALK_DROP_FIXED && player && player.userData.walk && !player.userData.sitOff && !SIT.on) player.userData.walk.position.y = -DROP * walkW(player); } catch (err) {}
    try { avatars.forEach(function (a) { var ag = a.g; if (!ag || !ag.visible || ag.userData.sit || ag.userData.sitOff) return; var l = w2l(e, ag.position.x, ag.position.z); if (Math.abs(l[0]) > HALF + 0.5 || Math.abs(l[1]) > HALF + 0.5) return; ag.position.y = e[1] + floorAt(l[0], l[1]); if (ag.userData.walk && !window.WALK_DROP_FIXED) ag.userData.walk.position.y = -DROP * walkW(ag); }); } catch (err) {}
    // bags on the carousel
    if (PT.bags && PT.car) { var B = PT.bags, C = PT.car, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), eu = new THREE.Euler(); var Rr = C.R - 0.36, per = 4 * C.a + TAU * Rr; for (var bi = 0; bi < B.list.length; bi++) { var b = B.list[bi]; b.s = (b.s + dt * 0.32 / per) % 1; var d = b.s * per, bx0, bz0, hd; if (d < 2 * C.a) { bx0 = -C.a + d; bz0 = -Rr; hd = 0; } else if (d < 2 * C.a + Math.PI * Rr) { var an = (d - 2 * C.a) / Rr; bx0 = C.a + Math.sin(an) * Rr; bz0 = -Math.cos(an) * Rr; hd = an; } else if (d < 4 * C.a + Math.PI * Rr) { bx0 = C.a - (d - 2 * C.a - Math.PI * Rr); bz0 = Rr; hd = Math.PI; } else { var an2 = (d - 4 * C.a - Math.PI * Rr) / Rr; bx0 = -C.a - Math.sin(an2) * Rr; bz0 = Math.cos(an2) * Rr; hd = Math.PI + an2; } eu.set(0, -hd + b.r, 0); q.setFromEuler(eu); sv.set(b.l, b.h, b.w); pv.set(C.cx + bx0, F + 0.39 + b.h / 2, C.cz + bz0); m4.compose(pv, q, sv); B.im.setMatrixAt(bi, m4); } B.im.instanceMatrix.needsUpdate = true; }
    // fire, screens, sun, lights by the hour (the heavier ones every few frames)
    if (PT.fire) { var fl = 0.85 + 0.15 * Math.sin(now * 0.011) * Math.sin(now * 0.0037 + 1.3); PT.fire[0].scale.y = fl; PT.fire[1].scale.y = 1.2 * (1.9 - fl) / 1.0; }
    PT.fc = (PT.fc || 0) + 1;
    if (PT.fc % 30 === 0 && PT.screens) PT.screens.forEach(function (s, i) { var ix = Math.floor((now / 1000 + i * 2.3) / 8) % s.slides.length; if (ix !== s.i) { s.i = ix; s.m.map = s.slides[ix]; s.m.needsUpdate = true; } });
    if (PT.fc % 6 === 0) { try { updateSun(R, e, M); } catch (err) { note("sun", err); } lightsByHour(R, M); }
  }
  function lightsByHour(R, M) { var nk = nightK(), day = 1 - nk; R.lights.pts.forEach(function (l) { l.intensity = 0.55 + 0.45 * nk; }); R.lights.spots.forEach(function (s) { s.intensity = 0.9 + 0.6 * nk; }); if (R.lights.hemi) R.lights.hemi.intensity = 0.28 + 0.22 * day; M.sky.color.setRGB(0.02 + 0.9 * day, 0.03 + 0.9 * day, 0.06 + 0.9 * day); M.walnut.emissive.setHex(0x2e2419); M.walnut.emissiveIntensity = 0.1 * nk; M.walnutD.emissive.setHex(0x2e2419); M.walnutD.emissiveIntensity = 0.08 * nk; M.pool.opacity = 0.07 + 0.12 * nk; M.scallop.opacity = 0.1 + 0.16 * nk; M.onyx.emissiveIntensity = 0.7 + 0.5 * nk; M.fire.opacity = 0.9; if (Math.abs((PT.envNight || 0) - nk) > 0.3) { var tex = envMap(); if (tex) for (var k in M) { var mt = M[k]; if (mt && mt.isMeshStandardMaterial && mt.envMap !== tex) { mt.envMap = tex; } } } }
  // the merged geometry of a room that was left (the room is rebuilt on every entry; textures and materials are shared and kept)
  function disposeRoom() { var L = PT.last && PT.last.g; if (!L || L.parent) return; disposeG(L); PT.last = null; }
  // the client's landside door pieces (planTerminalLandside) join the house finishes; its 1928 board and green exit board give way to the photograph wall and a house-style sign
  function tidyClient(g, half, M) { var lz = (typeof TERM !== "undefined" && TERM.landZ !== undefined) ? TERM.landZ : -0.5;
    g.children.forEach(function (o) { if (o.userData.ptStatic || o.userData.noSolid && o.isMesh && o.material && o.material.userData && o.material.userData.pt) return;
      if (o.isGroup && Math.abs(o.position.x + half - 0.4) < 0.2 && Math.abs(o.position.y - 5.2) < 0.2) { o.visible = false; return; }
      if (o.isGroup && Math.abs(o.position.x - (half - 0.45)) < 0.2 && Math.abs(o.position.z - lz) < 0.5 && o.position.y > 3.5) { o.visible = false; return; }
      if (o.isMesh && o.position.x > half - 1.6 && Math.abs(o.position.z - lz) < 2.4 && o.position.y < 4.2) { var mt = o.material; if (mt && mt.map && mt.map.repeat && !mt.transparent) o.material = M.walnut; else if (mt && mt.transparent && mt.opacity > 0.4) o.material = M.glassCase; } });
    var ex = panel("exitLand", 2048, 320, function (x, W, H) { x.fillStyle = "#101112"; x.fillRect(0, 0, W, H); x.fillStyle = "#2a7a3e"; x.fillRect(0, H - 14, W, 14); x.fillStyle = "#1d6b3a"; rrect(x, 40, 50, 210, 210, 18); x.fill(); picto(x, "exit", 145, 155, 150, "#ffffff"); txt(x, "EXIT  ·  ARRIVALS COURT", 300, 130, "600 96px " + FT.ui, "#f5f1e6", 10, "left"); txt(x, "The Sun Gate Walk  ·  The Landing  ·  all three stages", 304, 228, "600 50px " + FT.ui, "#d9c8a4", 4, "left"); });
    var ep = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 0.875), new THREE.MeshBasicMaterial({ map: ex })); ep.position.set(half - 0.3, F + 4.15, lz); ep.rotation.y = -Math.PI / 2; ep.userData.noSolid = true; g.add(ep); var eb = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.95, 5.7), M.bronze); eb.position.set(half - 0.26, F + 4.15, lz); g.add(eb); }
  // the shell's 45 cm podium stands inside the room: while inside, a frame of podium around the room replaces it
  function podium(inT) {
    var T = null; try { T = TSHELL; } catch (e) { return; } if (!T || !T.g) return;
    if (!PT.pod) { var pod = null; T.g.children.forEach(function (o) { var gp = o.geometry && o.geometry.parameters; if (o.isMesh && gp && gp.height === 0.45 && gp.width > 80) pod = o; }); if (!pod) { PT.pod = { none: true }; return; } var fr = new THREE.Group(); var W0 = pod.geometry.parameters.width, D0 = pod.geometry.parameters.depth, cz = pod.position.z, x0 = -W0 / 2, x1 = W0 / 2, z0 = cz - D0 / 2, z1 = cz + D0 / 2, r = HALF + 0.1;
      [[x0, -r, z0, z1], [r, x1, z0, z1], [-r, r, z0, -r], [-r, r, r, z1]].forEach(function (b) { var w = b[1] - b[0], d = b[3] - b[2]; if (w <= 0 || d <= 0) return; var geo = new THREE.BoxGeometry(w, 0.45, d); var uv = geo.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / W0, uv.getY(i) * d / D0); var m = new THREE.Mesh(geo, pod.material); m.position.set((b[0] + b[1]) / 2, 0.225, (b[2] + b[3]) / 2); m.receiveShadow = true; m.castShadow = true; fr.add(m); }); fr.visible = false; T.g.add(fr); PT.pod = { pod: pod, frame: fr }; }
    if (PT.pod.none) return; if (PT.pod.pod.visible === inT) { PT.pod.pod.visible = !inT; PT.pod.frame.visible = inT; }
  }

  // ───────────────────────── the exterior: Solport's terminal is the Stellar Aviation FBO ─────────────────────────
  // A PLAN_HOOKS.defer hook (after the client's shell, forecourt and landside door are built) adds, in the shell's frame
  // (x across the hall, +x = the landside end facing Arrivals Court, +z = the airside front facing Gate A2, y up from the pad):
  //  - a backlit STELLAR AVIATION | FBO lightbox standing on the airside roof edge (the booth's stellarMark, set on canvas),
  //  - on the landside end wall: SOLPORT in lit letters on a bronze band and a STELLAR AVIATION | FBO lightbox,
  //  - the FBO signs over both doors (the client's ARRIVALS · DEPARTURES and ARRIVALS COURT boards are re-faced),
  //  - SOLPORT on a bronze fascia band on the porte-cochere (in place of the client's GENESIS ONE INTERNATIONAL letters),
  //  - a SOLPORT monument on the airside forecourt beside the red carpet.
  // brandFrame lights them by the hour. Every letter is canvas type or geometry; nothing is downloaded or generated.
  var BR = PT.brand = PT.brand || {};
  var BRP = [];
  function bpanel(key, W, H, fn, lin) { var t = panel(key, W, H, fn, lin); t.anisotropy = 16; if (!t.userData.fn) { t.userData.fn = fn; BRP.push(t); } return t; }
  // the web fonts may land after the world is built: every brand canvas is drawn again once they are in
  function brandRedraw() { BRP.forEach(function (t) { var c = t.userData.c; if (!c || !t.userData.fn) return; var x = c.getContext("2d"); x.setTransform(1, 0, 0, 1, 0, 0); x.shadowBlur = 0; x.globalAlpha = 1; x.clearRect(0, 0, c.width, c.height); try { t.userData.fn(x, c.width, c.height, t); } catch (e) { note("brand redraw", e); } t.needsUpdate = true; }); }
  // a Stellar lightbox face: white, the logo; with o.fbo a divider and FBO (o.sub beneath it); a Stellar-blue base band
  function stellarFace(x, W, H, o) {
    o = o || {}; var g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#edf1f5"); x.fillStyle = g; x.fillRect(0, 0, W, H);
    var band = Math.max(4, Math.round(H * 0.05)); x.fillStyle = "#1464b4"; x.fillRect(0, H - band, W, band);
    var s = H / 228 * (o.k || 1), lx = o.fbo ? (o.lx || 0.345) * W : W / 2 + 35 * s;
    stellarMark(x, lx, H * 0.47 - band * 0.3, s);
    if (o.fbo) { x.fillStyle = "#c3c9d0"; x.fillRect(Math.round(W * 0.668), Math.round(H * 0.17), Math.max(2, Math.round(W * 0.0018)), Math.round(H * 0.6));
      var big = o.big || "FBO", fx = W * 0.835, fs = Math.round(Math.min(H * (o.sub ? 0.4 : 0.48), W * 0.29 / (big.length * 0.74))); txt(x, big, fx + fs * 0.02, H * (o.sub ? 0.38 : 0.46), "900 " + fs + "px " + FT.heavy, "#1464b4", Math.round(fs * 0.04));
      if (o.sub) { var ss = Math.round(H * (o.subK || 0.105)); txt(x, o.sub, fx + ss * 0.15, H * 0.745, "600 " + ss + "px " + FT.ui, "#5f666d", Math.round(ss * 0.3), "center", W * 0.3); } }
  }
  // SOLPORT: an alpha mask (white letters on black), 2048 x 320, the letters' plane is 6.4 : 1
  function solType(x, cx, cy, px, ls, bold) { x.font = "600 " + px + "px " + FT.ui; x.textAlign = "center"; x.textBaseline = "middle"; try { x.letterSpacing = ls + "px"; } catch (e) {} x.fillStyle = "#fff"; x.fillText("SOLPORT", cx + ls / 2, cy); if (bold) { x.lineWidth = bold; x.lineJoin = "round"; x.strokeStyle = "#fff"; x.strokeText("SOLPORT", cx + ls / 2, cy); } try { x.letterSpacing = "0px"; } catch (e) {} }
  function solLetters() { return bpanel("solL", 2048, 320, function (x, W, H) { x.fillStyle = "#000"; x.fillRect(0, 0, W, H); solType(x, W / 2, H / 2 + 8, 238, 62, 11); }, true); }
  // its soft glow: the same layout at half scale inside 64 px side and 48 px top and bottom margins, blurred
  function solHalo() { return bpanel("solH", 1152, 256, function (x, W, H) { x.fillStyle = "#000"; x.fillRect(0, 0, W, H); x.shadowColor = "rgba(255,238,210,1)"; x.shadowBlur = 26; for (var i = 0; i < 3; i++) solType(x, W / 2, H / 2 + 4, 119, 31, 6); x.shadowBlur = 0; }); }
  function brandMats() {
    if (BR.M) return BR.M; var m = {}, L = solLetters();
    m.bronze = new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.38, metalness: 0.75 });
    m.band = new THREE.MeshStandardMaterial({ color: 0x24201d, roughness: 0.42, metalness: 0.7 });
    m.champ = new THREE.MeshStandardMaterial({ color: 0xcdb68a, roughness: 0.3, metalness: 0.85 });
    m.trav = new THREE.MeshStandardMaterial({ color: 0xf1e7d6, roughness: 0.75 }); try { m.trav.map = texRep("travertine", 2, 1); } catch (e) {}
    m.letW = new THREE.MeshStandardMaterial({ color: 0xf7f7f4, alphaMap: L, alphaTest: 0.5, emissive: 0xfff6ea, emissiveIntensity: 0.08, roughness: 0.35, metalness: 0.05 });
    m.ret = new THREE.MeshStandardMaterial({ color: 0x3a342e, alphaMap: L, alphaTest: 0.5, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide });
    m.halo = new THREE.MeshBasicMaterial({ map: solHalo(), color: 0xffe7c4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    m.blue = new THREE.MeshStandardMaterial({ color: 0x1464b4, emissive: 0x1464b4, emissiveIntensity: 0.25, roughness: 0.4 });
    m.lamp = new THREE.MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffe6bd, emissiveIntensity: 0.2, roughness: 0.4 });
    BR.lit = []; return (BR.M = m);
  }
  function faceMat(tex) { var mt = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.32, metalness: 0 }); BR.lit.push(mt); return mt; }
  function bbox(w, h, d, mat, x, y, z) { var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; }
  // dimensional letters (SOLPORT): a lit face plane and five alpha-tested return slices behind it, facing +z of the group
  function letters3D(w, depth) { var M = brandMats(), g = new THREE.Group(), geo = new THREE.PlaneGeometry(w, w / 6.4); var f = new THREE.Mesh(geo, M.letW); f.position.z = depth; g.add(f); for (var i = 0; i < 5; i++) { var sl = new THREE.Mesh(geo, M.ret); sl.position.z = depth * i / 5; sl.castShadow = i === 0; g.add(sl); } return g; }
  // their halo on the band behind them (night only)
  function halo3D(w) { var hm = new THREE.Mesh(new THREE.PlaneGeometry(w * 1152 / 1024, w / 6.4 * 256 / 160), brandMats().halo); hm.renderOrder = 2; (BR.halos = BR.halos || []).push(hm); return hm; }
  function brandTex() {
    return { roof: bpanel("stRoof", 3072, 600, function (x, W, H) { stellarFace(x, W, H, { fbo: true, sub: "SOLPORT", k: 1.08 }); }),
      land: bpanel("stLandB", 2048, 410, function (x, W, H) { stellarFace(x, W, H, { fbo: true, sub: "SOLPORT", k: 1.05 }); }),
      portal: bpanel("stPortal", 2048, 250, function (x, W, H) { stellarFace(x, W, H, { fbo: true, sub: "ARRIVALS  ·  DEPARTURES", subK: 0.1, k: 1.05 }); }),
      door: bpanel("stDoor", 1536, 384, function (x, W, H) { stellarFace(x, W, H, { fbo: true, sub: "SOLPORT", k: 1.05 }); }),
      mon: bpanel("stMon", 1024, 205, function (x, W, H) { stellarFace(x, W, H, { fbo: true, sub: "FIELD DGL", k: 1.05 }); }) };
  }
  function removeBrand() { (BR.objs || []).forEach(function (o) { if (o.parent) o.parent.remove(o); }); (BR.restore || []).forEach(function (r) { try { r(); } catch (e) {} }); BR.objs = []; BR.restore = []; BR.halos = []; BR.built = false; }
  function buildBrand() {
    var T = null; try { T = TSHELL; } catch (e) { return; } var e = TE(); if (!T || !T.g || !e) return; if (BR.built && BR.g === T.g) return; removeBrand();
    var M = brandMats(), X = brandTex(), g = T.g, objs = BR.objs = [], rest = BR.restore = []; BR.g = g; BR.halos = [];
    var add = function (parent, o) { parent.add(o); objs.push(o); return o; };
    var nb = 0;
    // 1. airside roof: the STELLAR AVIATION | FBO lightbox on the canopy's roof edge, a bronze cabinet on a plinth with two back stays
    { var s = new THREE.Group(); var fw = 30.0, fh = fw * 600 / 3072, cy = 14.1 + fh / 2 + 0.2;
      s.add(bbox(fw + 0.5, fh + 0.4, 0.5, M.bronze, 0, cy, 40.55)); s.add(bbox(fw + 0.7, 0.55, 0.62, M.bronze, 0, 13.82, 40.5));
      var face = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), faceMat(X.roof)); face.position.set(0, cy, 40.806); s.add(face);
      [-10, 10].forEach(function (sx) { var st = bbox(0.26, 0.26, 6.2, M.bronze, sx, cy - 0.4, 37.6); st.rotation.x = -0.62; st.position.y = cy - 1.95; s.add(st); });
      add(g, s); nb++; }
    // 2. landside end wall (faces +x): SOLPORT on a bronze band left of the door, the Stellar lightbox right of it (as you face the wall),
    //    both clear of the Sun Gate shell as you come up the walk from Arrivals Court
    { var ls = new THREE.Group(); ls.position.set(46.0, 0, 0); ls.rotation.y = Math.PI / 2;   // group +z = out of the wall, group +x = along -z (the viewer's right)
      var bw = 16.0, by = 6.5; var sz = -23.0; ls.add(bbox(bw, 3.1, 0.14, M.band, sz, by, 0.62)); ls.add(bbox(bw + 0.1, 0.06, 0.2, M.champ, sz, by + 1.58, 0.63)); ls.add(bbox(bw + 0.1, 0.06, 0.2, M.champ, sz, by - 1.58, 0.63));
      var lt = letters3D(13.2, 0.16); lt.position.set(sz, by + 0.05, 0.7); ls.add(lt); var hl = halo3D(13.2); hl.position.set(sz, by + 0.05, 0.695); ls.add(hl);
      var lw = 14.0, lh = lw * 410 / 2048; ls.add(bbox(lw + 0.35, lh + 0.35, 0.4, M.bronze, 19.0, by, 0.75)); var lf = new THREE.Mesh(new THREE.PlaneGeometry(lw, lh), faceMat(X.land)); lf.position.set(19.0, by, 0.956); ls.add(lf);
      add(g, ls); nb++; }
    // 3. the FBO sign over the airside doors: the client's ARRIVALS · DEPARTURES board is re-faced
    g.children.forEach(function (o) { var p = o.geometry && o.geometry.parameters; if (o.isMesh && p && o.geometry.type === "PlaneGeometry" && Math.abs(p.width - 9) < 0.01 && Math.abs(p.height - 1.1) < 0.01) { var old = o.material; o.material = faceMat(X.portal); rest.push(function () { o.material = old; }); nb++; } });
    // 4. the landside door's board (ARRIVALS COURT, outside) becomes the Stellar Aviation FBO sign; 5. the porte-cochere: SOLPORT on a bronze fascia band
    var land = (typeof TERM !== "undefined" && TERM.land) || null;
    scene.children.forEach(function (grp) { if (!grp.isGroup) return;
      grp.children.forEach(function (o) { var p = o.geometry && o.geometry.parameters; if (!o.isMesh || !p || o.geometry.type !== "PlaneGeometry") return;
        if (land && Math.abs(p.width - 5.6) < 0.01 && Math.abs(p.height - 1.4) < 0.01 && Math.hypot(grp.position.x - land[0], grp.position.z - land[1]) < 3) { var old = o.material; o.material = faceMat(X.door); rest.push(function () { o.material = old; }); nb++; }
        if (Math.abs(p.width - 17) < 0.01 && Math.abs(p.height - 2.1) < 0.01 && Math.hypot(grp.position.x - e[0], grp.position.z - e[2]) < 70 && !grp.userData.solBand) { o.visible = false; rest.push(function () { o.visible = true; }); grp.userData.solBand = 1; rest.push(function () { grp.userData.solBand = 0; });
          var pb = new THREE.Group(); pb.add(bbox(19.9, 1.5, 0.22, M.band, 0, 7.42, 5.86)); pb.add(bbox(20.0, 0.06, 0.26, M.champ, 0, 8.2, 5.86)); pb.add(bbox(20.0, 0.06, 0.26, M.champ, 0, 6.64, 5.86));
          var pl = letters3D(7.0, 0.12); pl.position.set(0, 7.44, 5.97); pb.add(pl); var ph = halo3D(7.0); ph.position.set(0, 7.44, 5.973); pb.add(ph);
          add(grp, pb); nb++; } }); });
    // 6. the SOLPORT monument on the forecourt, left of the carpet as you walk in from Gate A2, turned toward the stand
    { var mp = l2w(e, -19.5, 63.5), my = getH(mp[0], mp[1]), yaw = e[3] + 0.5; var mo = new THREE.Group(); mo.position.set(mp[0], my, mp[1]); mo.rotation.y = yaw;
      mo.add(bbox(10.2, 0.45, 2.8, M.trav, 0, 0.225, 0)); mo.add(bbox(8.8, 3.3, 0.9, M.band, 0, 2.1, 0)); mo.add(bbox(9.0, 0.1, 1.0, M.champ, 0, 3.8, 0)); mo.add(bbox(0.08, 3.3, 0.94, M.champ, -4.36, 2.1, 0)); mo.add(bbox(0.08, 3.3, 0.94, M.champ, 4.36, 2.1, 0));
      [1, -1].forEach(function (sd) { var f2 = new THREE.Group(); f2.rotation.y = sd > 0 ? 0 : Math.PI; var ml = letters3D(7.2, 0.08); ml.position.set(0, 2.9, 0.45); f2.add(ml); var mh = halo3D(7.2); mh.position.set(0, 2.9, 0.452); f2.add(mh);
        f2.add(bbox(2.6, 0.045, 0.02, M.blue, 0, 2.15, 0.46)); var mf = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 5.3 * 205 / 1024), faceMat(X.mon)); mf.position.set(0, 1.3, 0.457); f2.add(mf);
        [-3.6, 3.6].forEach(function (lx0) { f2.add(bbox(0.34, 0.1, 0.22, M.lamp, lx0, 0.5, 1.05)); }); mo.add(f2); });
      mo.traverse(function (o) { if (o.isMesh && o.material !== M.halo) { o.castShadow = true; o.receiveShadow = true; } }); add(scene, mo); BR.mon = mo;
      try { addSolid(mp[0], mp[1], yaw, 10.2, 2.8, my, my + 0.45, "world"); addSolid(mp[0], mp[1], yaw, 8.8, 0.9, my, my + 3.85, "world"); } catch (err) { note("brand solids", err); } nb++; }
    BR.built = true; BR.n = nb; PT.n.brand = nb; BR.nk = -1;
    try { if (document.fonts && document.fonts.status !== "loaded") document.fonts.ready.then(brandRedraw); } catch (err) {}
    setTimeout(brandRedraw, 20000);
  }
  // lit by the hour: the lightbox faces glow, the letters light up and their halos come on after dusk
  function brandFrame() {
    if (!BR.built || !BR.M) return; PT.bfc = (PT.bfc || 0) + 1; if (PT.bfc % 20) return; var nk = nightK(); if (Math.abs(nk - BR.nk) < 0.01) return; BR.nk = nk;
    (BR.lit || []).forEach(function (m) { m.emissiveIntensity = 0.3 + 2.0 * nk; }); var M = BR.M; M.letW.emissiveIntensity = 0.08 + 1.3 * nk; M.halo.opacity = 0.95 * nk; M.blue.emissiveIntensity = 0.25 + 1.2 * nk; M.lamp.emissiveIntensity = 0.2 + 2.2 * nk;
    (BR.halos || []).forEach(function (h) { h.visible = nk > 0.02; });
  }
  PT.buildBrand = buildBrand; PT.removeBrand = removeBrand; PT.brandRedraw = brandRedraw;

  // ───────────────────────── install ─────────────────────────
  PT.install = function () {
    var O = PT.orig = PT.orig || {};
    try { if (!O.furnishTerminal) O.furnishTerminal = furnishTerminal; if (!O.spawnHallWalkers) O.spawnHallWalkers = spawnHallWalkers; if (!O.updateHall) O.updateHall = updateHall; } catch (e) { note("install", e); return; }
    furnishTerminal = function (g, half, hgt) { if (!PT.off) { var keep = g.children.slice(); try { furnish(g, half, hgt); return; } catch (err) { note("furnish", err); g.userData.ptOK = false; g.children.slice().forEach(function (o) { if (keep.indexOf(o) < 0) g.remove(o); }); keep.forEach(function (o) { o.visible = true; }); } } return O.furnishTerminal.apply(this, arguments); };
    spawnHallWalkers = function (g, half) { if (g.userData.ptOK) { try { spawnPeople(g, half); return; } catch (err) { note("people", err); } } return O.spawnHallWalkers.apply(this, arguments); };
    updateHall = function (dt) { if (SITES.hall && SITES.hall.pt) { try { hallUpdate(dt); } catch (err) { note("hall", err); SITES.hall = null; } return; } return O.updateHall.apply(this, arguments); };
    PT.installed = true;
  };
  PT.frame = frame; PT.debug = { route: route, NODES: NODES, EDGES: EDGES, DEST: DEST, floorAt: floorAt, l2w: l2w, w2l: w2l, mats: mats, SLOTS: SLOTS, staffSpot: staffSpot, visitorSpot: visitorSpot };
  if (!PT.hooked) { PT.hooked = true; var H = window.PLAN_HOOKS;
    H.world.push({ name: "planTerminal", fn: function () { window.PLAN_TERMINAL.install(); } });
    (H.defer = H.defer || []).push({ name: "planTerminalBrand", fn: function () { try { window.PLAN_TERMINAL.buildBrand(); } catch (err) { note("brand", err); } } });
    H.frame.push({ name: "planTerminalFrame", fn: function (dt, now) { try { window.PLAN_TERMINAL.frame(dt, now); } catch (err) { if (!PT.frameErr) { PT.frameErr = 1; note("frame", err); } } } }); }
})();
