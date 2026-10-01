// R4 STAR (1 Oct 2026): The Stargazer Pyramids, a dark sky glass pyramid retreat, and the Solport Dark Sky Observatory, in the
// Ridge Arroyo between Ridge Road and South Ridge, beside the Outpost. Classic script, loaded before client.js; hooks into
// window.PLAN_HOOKS { terrain, world, defer, frame, interior }. All names, copy and positions: plan/stargaze.json.
//   - 14 procedural glass pyramids (two sizes) on raised timber decks with railings, steps, a hot tub and a fire pit each:
//     every repeated part is one InstancedMesh (crisp metal mullion grid, frosted or clear smart glass, warm glow at night).
//   - winding dirt paths with low amber dark-sky bollards, desert planting, a small cart park and a welcome sign.
//   - the Solport Dark Sky Observatory: a dome whose slit opens after dark over a large telescope, the Star Theatre (stone
//     tiers round a fire pit lounge) and the Stargazing Terrace (a ring of zero gravity loungers); the resident astronomer.
//   - the Model Pyramid (and any pyramid marked open) is a seamless walk-in interior built when you come near: king bed facing
//     up through the glass, lounge with sofa and fireplace, dining table, kitchen with espresso machine, spa bathroom with a
//     rain shower, a telescope by the glass, a smart glass switch.
//   - stargazing mode: lie back on a bed or a lounger (E), the camera eases back to look up, the HUD fades, the world dims
//     (PLAN_SKY.setStargaze), a night soundscape plays; drag to look, constellations, what is up tonight, telescope, star trails.
// ?star=0 turns the module off. window.PLAN_STARGAZE: n (counters), errs, cfg, site, api, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var SG = window.PLAN_STARGAZE = window.PLAN_STARGAZE || {};
  SG.errs = SG.errs || []; SG.n = SG.n || { builds: 0, disposes: 0, sessions: 0 };
  if (/[?&]star=0\b/.test(location.search)) { SG.off = true; return; }
  var PI = Math.PI, TAU = PI * 2;
  function note(tag, e) { try { if (SG.errs.length < 50) SG.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (SG.errs.length <= 6) console.warn("plan_stargaze " + tag, e); } catch (x) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function ease(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function nowMs() { return performance.now(); }
  function has(k) { try { return !!(MODELS[k] && (MODELS[k].parts || MODELS[k]._pp)); } catch (e) { return false; } }
  function canPut(k) { try { return has(k) && !!MODEL_SPECS[k]; } catch (e) { return false; } }
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function $id(id) { return document.getElementById(id); }

  // ───────────────────────── config: plan/stargaze.json ─────────────────────────
  var CFG = SG.cfg || null;
  function cfgUrl() { var u = "/plan/stargaze.json?v=" + (window.BUILD || "dev"); try { if (window.AV) u = window.AV(u); } catch (e) {} return u; }
  if (!CFG) { try { fetch(cfgUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && !CFG) { CFG = SG.cfg = d; } }).catch(function (e) { note("cfg fetch", e); }); } catch (e) { note("cfg", e); } }
  // the world hook needs the layout at once: if the fetch has not landed yet, read it synchronously (a small local file)
  function cfg() {
    if (CFG) return CFG;
    try { var x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = SG.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); }
    return CFG;
  }
  function C(path, dflt) { var o = cfg(); if (!o) return dflt; var p = path.split("."); for (var i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }
  function hex(s, d) { try { return new THREE.Color(s || d); } catch (e) { return new THREE.Color(d); } }

  // ───────────────────────── geometry kit: primitives in a frame, merged per material ─────────────────────────
  var _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _e = new THREE.Euler();
  function toNonIndexed(g) { return g.index ? g.toNonIndexed() : g; }
  // merge non-indexed geometries with position, normal, uv (and an optional extra attribute) into one
  function mergeGeos(list, extra) {
    var n = 0; list.forEach(function (g) { n += g.attributes.position.count; }); if (!n) return null;
    var P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), X = extra ? new Float32Array(n * extra.size) : null, o = 0;
    list.forEach(function (g) { var c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); if (g.attributes.normal) N.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2); if (X && g.attributes[extra.name]) X.set(g.attributes[extra.name].array, o * extra.size); o += c; });
    var r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(U, 2)); if (X) r.setAttribute(extra.name, new THREE.BufferAttribute(X, extra.size));
    r.computeBoundingBox(); r.computeBoundingSphere(); return r;
  }
  function Kit() { this.m = {}; }
  Kit.prototype.add = function (key, g) { g = toNonIndexed(g); if (!g.attributes.normal) g.computeVertexNormals(); (this.m[key] || (this.m[key] = [])).push(g); return g; };
  Kit.prototype.place = function (key, g, x, y, z, ry, rx, rz, sx, sy, sz) { _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(x, y, z), _q, _v2.set(sx || 1, sy || 1, sz || 1)); g.applyMatrix4(_m4); return this.add(key, g); };
  // a box w x h x d centred at (x, y, z), yaw ry; uv in metres / t (wood and stone read at their real scale)
  Kit.prototype.box = function (key, w, h, d, x, y, z, ry, t, rx, rz) { var g = new THREE.BoxGeometry(w, h, d); if (t) uvBox(g, w, h, d, t); return this.place(key, g, x, y, z, ry, rx, rz); };
  Kit.prototype.cyl = function (key, r0, r1, h, x, y, z, seg, open, ry, rx, rz) { var g = new THREE.CylinderGeometry(r0, r1, h, seg || 16, 1, !!open); return this.place(key, g, x, y, z, ry, rx, rz); };
  Kit.prototype.sph = function (key, r, x, y, z, sy, seg) { var g = new THREE.SphereGeometry(r, seg || 12, Math.max(6, (seg || 12) >> 1)); return this.place(key, g, x, y, z, 0, 0, 0, 1, sy || 1, 1); };
  Kit.prototype.geo = function (key, g, x, y, z, ry, rx, rz) { return this.place(key, g, x || 0, y || 0, z || 0, ry, rx, rz); };
  // a horizontal quad (floor or ceiling) from (x0, z0) to (x1, z1) at y; up true faces up
  Kit.prototype.flat = function (key, x0, z0, x1, z1, y, up, t) { var g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); var uv = g.attributes.uv; t = t || 1; for (var i = 0; i < uv.count; i++) uv.setXY(i, (x0 + uv.getX(i) * (x1 - x0)) / t, (z0 + uv.getY(i) * (z1 - z0)) / t); g.rotateX(up === false ? PI / 2 : -PI / 2); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2); return this.add(key, g); };
  // a vertical quad w x h facing yaw ry (its front faces +z rotated by ry)
  Kit.prototype.quad = function (key, w, h, x, y, z, ry, rx) { var g = new THREE.PlaneGeometry(w, h); return this.place(key, g, x, y, z, ry, rx || 0, 0); };
  // a beam (box) from A to B with cross-section w (across, in the plane normal to nrm) and d (along nrm)
  Kit.prototype.beam = function (key, A, B, w, d, nrm) {
    var dir = _v1.subVectors(B, A); var L = dir.length(); if (L < 1e-4) return null; dir.multiplyScalar(1 / L);
    var e2 = _v2.copy(nrm).addScaledVector(dir, -nrm.dot(dir)).normalize(); var e1 = _v3.crossVectors(e2, dir).normalize();
    var g = new THREE.BoxGeometry(w, L, d); _m4.makeBasis(e1, dir, e2); _m4.setPosition((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2); g.applyMatrix4(_m4); return this.add(key, g);
  };
  // a ring sector solid (curved bench, tier, kerb): radii r0..r1, heights y0..y1, angles a0..a1 (0 = +z, turning toward +x)
  Kit.prototype.sector = function (key, cx, cz, r0, r1, y0, y1, a0, a1, seg, t) {
    seg = seg || 24; t = t || 1; var P = [], U = [];
    function pt(r, a, y) { return [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r]; }
    function tri(a, b, c, ua, ub, uc) { P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); U.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]); }
    function quad(a, b, c, d, ua, ub, uc, ud) { tri(a, b, c, ua, ub, uc); tri(a, c, d, ua, uc, ud); }
    for (var i = 0; i < seg; i++) { var aa = a0 + (a1 - a0) * i / seg, ab = a0 + (a1 - a0) * (i + 1) / seg; var la = aa * r1 / t, lb = ab * r1 / t;
      quad(pt(r0, aa, y1), pt(r0, ab, y1), pt(r1, ab, y1), pt(r1, aa, y1), [la, r0 / t], [lb, r0 / t], [lb, r1 / t], [la, r1 / t]);   // top
      quad(pt(r1, aa, y0), pt(r1, aa, y1), pt(r1, ab, y1), pt(r1, ab, y0), [la, y0 / t], [la, y1 / t], [lb, y1 / t], [lb, y0 / t]);   // outer
      quad(pt(r0, ab, y0), pt(r0, ab, y1), pt(r0, aa, y1), pt(r0, aa, y0), [lb, y0 / t], [lb, y1 / t], [la, y1 / t], [la, y0 / t]); }  // inner
    quad(pt(r0, a0, y0), pt(r0, a0, y1), pt(r1, a0, y1), pt(r1, a0, y0), [0, 0], [0, 1], [1, 1], [1, 0]);
    quad(pt(r1, a1, y0), pt(r1, a1, y1), pt(r0, a1, y1), pt(r0, a1, y0), [0, 0], [0, 1], [1, 1], [1, 0]);
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.computeVertexNormals(); return this.add(key, g);
  };
  // the kit's geometries as meshes (one per material) in group g
  Kit.prototype.build = function (g, mats, opts) { opts = opts || {}; var out = []; for (var k in this.m) { var geo = mergeGeos(this.m[k]); if (!geo) continue; var mt = mats[k]; if (!mt) { note("kit mat", k); continue; } var me = new THREE.Mesh(geo, mt); me.name = "sg " + k; me.castShadow = opts.cast !== false && !mt.transparent; me.receiveShadow = true; g.add(me); out.push(me); } return out; };
  Kit.prototype.geos = function () { var r = {}; for (var k in this.m) { var geo = mergeGeos(this.m[k]); if (geo) r[k] = geo; } return r; };
  function uvBox(g, w, h, d, t) { var uv = g.attributes.uv; var dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (var f = 0; f < 6; f++) for (var k = 0; k < 4; k++) { var i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } }

  // ───────────────────────── canvas textures ─────────────────────────
  SG.old = SG.ready ? { ex: SG.ex, ob: SG.ob, am: SG.am, tr: SG.tr, lot: SG.lotG, steam: SG.steamG, sol: SG.sol, astro: SG.astro, hs: SG.site && SG.site.hs, ls: SG.listeners, mode: SG.mode } : null;   // a hot reload (dev) rebuilds the visuals
  var TX = SG.tx = SG.old ? {} : (SG.tx || {});
  function cv(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function mkTex(c, rep, lin) { var t = new THREE.CanvasTexture(c); if (!lin) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; try { if (typeof MAX_ANISO !== "undefined") t.anisotropy = Math.min(8, MAX_ANISO); } catch (e) {} t.needsUpdate = true; return t; }
  function panel(key, W, H, fn, rep, lin) { if (TX[key]) return TX[key]; var c = cv(W, H), x = c.getContext("2d"); try { fn(x, W, H); } catch (e) { note("panel " + key, e); } return (TX[key] = mkTex(c, rep, lin)); }
  function noise(x, W, H, n, a, s0, s1, seed) { var R = rng(seed || (W * 7 + H + n)); for (var i = 0; i < n; i++) { x.fillStyle = R() < 0.5 ? "rgba(255,255,255," + a + ")" : "rgba(0,0,0," + a + ")"; var r = s0 + R() * (s1 - s0); x.fillRect(R() * W, R() * H, r, r); } }
  var FONT = { ui: "'Space Grotesk', 'Segoe UI', system-ui, sans-serif", cond: "'Anton', 'Oswald', 'Arial Narrow', Impact, sans-serif", serif: "'Fraunces', Georgia, serif", mono: "'JetBrains Mono', Consolas, monospace" };
  function txt(x, t, px, py, font, color, ls, align, maxW) { x.font = font; x.fillStyle = color; x.textAlign = align || "center"; x.textBaseline = "middle"; try { x.letterSpacing = (ls || 0) + "px"; } catch (e) {} if (maxW) { var w = x.measureText(t).width; if (w > maxW) { x.save(); x.translate(px, py); x.scale(maxW / w, 1); x.fillText(t, 0, 0); x.restore(); try { x.letterSpacing = "0px"; } catch (e) {} return; } } x.fillText(t, px, py); try { x.letterSpacing = "0px"; } catch (e) {} }
  // a soft radial glow (additive decals and sprites)
  function glowTex() { return panel("glow", 128, 128, function (x, W, H) { var g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.55)"); g.addColorStop(0.6, "rgba(255,255,255,0.14)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, W, H); }); }
  // light spilling out of a pyramid onto its deck: brightest along the glass, fading over the deck (deck frame, u across, v back to front)
  function deckGlowTex(key, W, D, half, zb) { return panel("dglow:" + key, 256, 256, function (x, CW, CH) { x.fillStyle = "#000"; x.fillRect(0, 0, CW, CH); var sx = CW / W, sz = CH / D; var px0 = (W / 2 - half) * sx, pz0 = (-half - zb) * sz, pw = 2 * half * sx, pd = 2 * half * sz;
      x.filter = "blur(" + Math.round(CW * 0.05) + "px)"; x.fillStyle = "rgba(255,255,255,1)"; x.fillRect(px0 - 8, pz0 - 8, pw + 16, pd + 16); x.filter = "blur(" + Math.round(CW * 0.12) + "px)"; x.fillStyle = "rgba(255,255,255,0.75)"; x.fillRect(px0 - 26, pz0 - 10, pw + 52, pd + 70); x.filter = "blur(" + Math.round(CW * 0.2) + "px)"; x.fillStyle = "rgba(255,255,255,0.35)"; x.fillRect(0, pz0, CW, CH - pz0); x.filter = "none"; x.fillStyle = "#000"; x.fillRect(px0 + 3, pz0 + 3, pw - 6, pd - 6);
      var g = x.createLinearGradient(0, pz0 + pd, 0, CH); g.addColorStop(0, "rgba(255,255,255,0.25)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(CW / 2 - 18, pz0 + pd, 36, CH - pz0 - pd); }, false, false); }
  // sand-coloured outdoor fabric, a dark slatted timber, the dome's stucco
  function fabricTex() { return panel("fabric", 256, 256, function (x, W, H) { x.fillStyle = "#c9b79a"; x.fillRect(0, 0, W, H); for (var i = 0; i < W; i += 3) { x.fillStyle = "rgba(0,0,0,0.05)"; x.fillRect(i, 0, 1, H); x.fillRect(0, i, W, 1); } noise(x, W, H, 2500, 0.04, 1, 2, 7); }, true); }
  function stuccoTex() { return panel("stucco", 512, 512, function (x, W, H) { x.fillStyle = "#e8e4dc"; x.fillRect(0, 0, W, H); noise(x, W, H, 9000, 0.035, 1, 3, 11); for (var i = 0; i < 160; i++) { var R = rng(i * 13 + 5); x.fillStyle = "rgba(120,110,95,0.03)"; x.beginPath(); x.arc(R() * W, R() * H, 10 + R() * 50, 0, TAU); x.fill(); } }, true); }
  function stoneTex() { return panel("stone", 512, 512, function (x, W, H) { var R = rng(31); x.fillStyle = "#8f8478"; x.fillRect(0, 0, W, H); var y = 0; while (y < H) { var h = 40 + Math.floor(R() * 50); var xx = -Math.floor(R() * 90); while (xx < W) { var w = 70 + Math.floor(R() * 150); var k = 0.82 + R() * 0.3; var b = [[188, 160, 128], [170, 142, 112], [204, 178, 146], [156, 130, 102]][Math.floor(R() * 4)]; x.fillStyle = "rgb(" + Math.round(b[0] * k) + "," + Math.round(b[1] * k) + "," + Math.round(b[2] * k) + ")"; x.fillRect(xx + 2, y + 2, w - 4, h - 4); xx += w; } y += h; } noise(x, W, H, 6000, 0.05, 1, 3, 17); }, true); }
  // interior woods (wide oak planks, dark walnut) and a white marble with grey veins, drawn so no image bytes are added
  function grainTex(key, base, light, dark, seed, planks) { return panel("grain:" + key, 512, 1024, function (x, W, H) { var R = rng(seed); x.fillStyle = base; x.fillRect(0, 0, W, H); var n = planks || 1, pw = W / n;
      for (var p = 0; p < n; p++) { var k = R(); x.fillStyle = k < 0.5 ? "rgba(255,240,220," + (0.03 + k * 0.08) + ")" : "rgba(30,18,8," + ((k - 0.5) * 0.14) + ")"; x.fillRect(p * pw, 0, pw, H); }
      for (var i = 0; i < 340; i++) { var lt = R() < 0.5; x.strokeStyle = (lt ? light : dark).replace("A", (0.04 + R() * 0.12).toFixed(3)); x.lineWidth = 0.5 + R() * 1.6; x.beginPath(); var px = R() * W, ph = R() * 6; x.moveTo(px, 0); for (var y = 0; y <= H; y += 24) x.lineTo(px + Math.sin(y * 0.008 + ph) * 5 + Math.sin(y * 0.031 + ph * 2) * 1.5, y); x.stroke(); }
      for (var k2 = 0; k2 < 14; k2++) { var kx = R() * W, ky = R() * H; var gk = x.createRadialGradient(kx, ky, 0, kx, ky, 10 + R() * 12); gk.addColorStop(0, dark.replace("A", "0.35")); gk.addColorStop(1, dark.replace("A", "0")); x.fillStyle = gk; x.beginPath(); x.ellipse(kx, ky, 8, 18, 0, 0, TAU); x.fill(); }
      if (n > 1) { for (var q = 0; q < n; q++) { x.fillStyle = "rgba(20,12,6,0.45)"; x.fillRect(q * pw, 0, 2, H); var jy = R() * H; x.fillRect(q * pw, jy, pw, 2); x.fillRect(q * pw, (jy + H * 0.5) % H, pw, 2); } } }, true); }
  function marbleTex() { return panel("marble", 1024, 1024, function (x, W, H) { var R = rng(5); x.fillStyle = "#efece6"; x.fillRect(0, 0, W, H); for (var v = 0; v < 26; v++) { x.strokeStyle = "rgba(" + (105 + R() * 40 | 0) + "," + (108 + R() * 40 | 0) + "," + (114 + R() * 40 | 0) + "," + (0.1 + R() * 0.3) + ")"; x.lineWidth = 0.6 + R() * 2.2; x.beginPath(); var px = R() * W, py = R() * H; x.moveTo(px, py); for (var s2 = 0; s2 < 14; s2++) { px += (R() - 0.3) * 130; py += (R() - 0.5) * 90; x.lineTo(px, py); } x.stroke(); } noise(x, W, H, 4000, 0.02, 1, 3, 9); }, true); }
  function weaveTex(key, a, b) { return panel("weave:" + key, 256, 256, function (x, W, H) { x.fillStyle = a; x.fillRect(0, 0, W, H); for (var i = 0; i < W; i += 4) for (var j = 0; j < H; j += 4) { if (((i + j) / 4) % 2) { x.fillStyle = b; x.fillRect(i, j, 4, 2); } } x.strokeStyle = "rgba(0,0,0,0.12)"; x.lineWidth = 6; x.strokeRect(10, 10, W - 20, H - 20); noise(x, W, H, 1500, 0.04, 1, 2, 3); }, true); }
  // the dome's skin: aluminium panels in gores parallel to the slit and rings of latitude, a darker seam between them
  function seamTex() { return panel("seams", 1024, 512, function (x, W, H) { x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, H); noise(x, W, H, 4000, 0.025, 1, 3, 19); x.fillStyle = "rgba(60,64,70,0.55)"; for (var i = 1; i < 16; i++) x.fillRect(i * W / 16 - 1.5, 0, 3, H); for (var j = 1; j < 7; j++) x.fillRect(0, j * H / 7 - 1.5, W, 3); x.fillStyle = "rgba(255,255,255,0.35)"; for (var i2 = 1; i2 < 16; i2++) x.fillRect(i2 * W / 16 + 2, 0, 1, H); }, false); }
  // the star chart on the observatory wall and the compass rose on the terrace (drawn, so no image bytes)
  function chartTex() { return panel("chart", 1024, 1024, function (x, W, H) { x.fillStyle = "#0b1020"; x.fillRect(0, 0, W, H); var R = rng(4242); x.strokeStyle = "rgba(160,190,255,0.25)"; x.lineWidth = 2; for (var r = 120; r < 500; r += 95) { x.beginPath(); x.arc(W / 2, H / 2, r, 0, TAU); x.stroke(); } for (var a = 0; a < 12; a++) { x.beginPath(); x.moveTo(W / 2, H / 2); x.lineTo(W / 2 + Math.cos(a / 12 * TAU) * 480, H / 2 + Math.sin(a / 12 * TAU) * 480); x.stroke(); }
      for (var i = 0; i < 900; i++) { var rr = Math.sqrt(R()) * 470, aa = R() * TAU, m = R(); x.fillStyle = "rgba(255,255,255," + (0.35 + m * 0.65) + ")"; x.beginPath(); x.arc(W / 2 + Math.cos(aa) * rr, H / 2 + Math.sin(aa) * rr, m > 0.97 ? 3.4 : m > 0.85 ? 2 : 1, 0, TAU); x.fill(); }
      x.strokeStyle = "rgba(244,205,90,0.55)"; x.lineWidth = 2; var dip = [[620, 250], [680, 300], [740, 320], [800, 300], [830, 360], [760, 400], [740, 320]]; x.beginPath(); dip.forEach(function (p, k) { if (k) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); }); x.stroke(); var cas = [[260, 700], [300, 640], [345, 690], [390, 630], [430, 690]]; x.beginPath(); cas.forEach(function (p, k) { if (k) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); }); x.stroke();
      txt(x, "THE NORTHERN SKY", W / 2, 40, "700 34px " + FONT.cond, "#f4cd5a", 8); txt(x, "Solport Dark Sky Observatory · Douglas, Arizona", W / 2, H - 36, "500 22px " + FONT.ui, "#c9d4ff", 2); }); }
  function roseTex() { return panel("rose", 512, 512, function (x, W, H) { x.clearRect(0, 0, W, H); x.translate(W / 2, H / 2); x.strokeStyle = "rgba(60,40,20,0.9)"; x.lineWidth = 6; x.beginPath(); x.arc(0, 0, 230, 0, TAU); x.stroke(); x.lineWidth = 3; x.beginPath(); x.arc(0, 0, 200, 0, TAU); x.stroke();
      for (var a = 0; a < 4; a++) { x.save(); x.rotate(a * PI / 2); x.fillStyle = a === 0 ? "rgba(70,40,18,0.95)" : "rgba(70,40,18,0.6)"; x.beginPath(); x.moveTo(0, -190); x.lineTo(26, 0); x.lineTo(-26, 0); x.closePath(); x.fill(); x.restore(); }
      x.setTransform(1, 0, 0, 1, 0, 0); ["N", "E", "S", "W"].forEach(function (l, k) { var a = k * PI / 2; txt(x, l, W / 2 + Math.sin(a) * 215, H / 2 - Math.cos(a) * 215, "700 30px " + FONT.cond, "rgba(50,30,12,0.95)", 2); }); }, false); }
  function signTex() { return panel("sign", 2048, 768, function (x, W, H) { x.clearRect(0, 0, W, H); var L1 = C("sign.line1", "THE STARGAZER PYRAMIDS"), L2 = C("sign.line2", "A DARK SKY RETREAT"), L3 = C("sign.line3", "SOLPORT DARK SKY OBSERVATORY");
      // a small pyramid mark over the name
      x.strokeStyle = "rgba(255,226,180,1)"; x.lineWidth = 7; x.beginPath(); x.moveTo(W / 2 - 70, 190); x.lineTo(W / 2, 70); x.lineTo(W / 2 + 70, 190); x.closePath(); x.stroke(); x.lineWidth = 3; for (var k = 1; k < 4; k++) { var yy = 70 + k * 30; x.beginPath(); x.moveTo(W / 2 - 70 * (yy - 70) / 120, yy); x.lineTo(W / 2 + 70 * (yy - 70) / 120, yy); x.stroke(); } x.fillStyle = "#fff4dc"; x.beginPath(); x.arc(W / 2 + 120, 80, 6, 0, TAU); x.fill(); x.beginPath(); x.arc(W / 2 - 140, 110, 4, 0, TAU); x.fill();
      txt(x, L1, W / 2, 330, "400 190px " + FONT.cond, "#ffe9c6", 18, "center", W - 120); txt(x, L2, W / 2, 500, "500 70px " + FONT.ui, "#ffd8a0", 22, "center", W - 200); txt(x, L3, W / 2, 640, "600 56px " + FONT.mono, "#f1d7ae", 12, "center", W - 160); }); }

  // ───────────────────────── materials (made in the defer hook, when the client's textures exist) ─────────────────────────
  var MX = SG.mx = SG.old ? {} : (SG.mx || {});
  var SHV = SG.old ? "_" + Math.random().toString(36).slice(2, 7) : "";   // a hot reload compiles fresh shader programs
  var U = SG.u = SG.u || { uNight: { value: 0 }, uTime: { value: 0 }, uGlow: { value: 1 }, uDim: { value: 1 }, uWater: { value: hex("#38c8ff", "#38c8ff") } }; U.uClearGlow = U.uClearGlow || { value: 1 };
  function std(o) { var m = new THREE.MeshStandardMaterial(o); return m; }
  function woodMap() { try { return TEX.wood; } catch (e) { return null; } }
  function mats() {
    if (MX.ok) return MX; MX.ok = true; var wm = woodMap(), wn = null; try { wn = TEX.woodN; } catch (e) {}
    MX.deck = std({ map: wm, normalMap: wn, color: 0x6e4c34, roughness: 0.82, metalness: 0 });
    MX.timber = std({ map: wm, normalMap: wn, color: 0x4a3426, roughness: 0.86 });
    MX.post = std({ map: wm, color: 0x3a291d, roughness: 0.9 });
    MX.metal = std({ color: 0x070708, roughness: 0.6, metalness: 0.12 });
    MX.steel = std({ color: 0x9aa0a6, roughness: 0.28, metalness: 0.9 });
    MX.concrete = std({ map: (function () { try { return TEX.detail; } catch (e) { return null; } })(), color: 0xb3ada3, roughness: 0.92 });
    MX.stone = std({ map: stoneTex(), color: 0xf2dcc0, roughness: 0.9 });
    MX.cap = std({ color: 0xd9d2c4, roughness: 0.6 });
    MX.fabric = std({ map: fabricTex(), color: 0xf2e6d0, roughness: 0.95 });
    MX.cushion = std({ map: fabricTex(), color: 0x9a8c78, roughness: 0.95 });
    MX.tubIn = std({ color: 0x2e4752, roughness: 0.35, side: THREE.BackSide });
    MX.beads = std({ color: 0x1a1a1c, roughness: 0.25, metalness: 0.3 });
    MX.stucco = std({ map: stuccoTex(), color: 0xf4f1ea, roughness: 0.88 });
    MX.domeM = std({ map: seamTex(), color: 0xf2f4f6, roughness: 0.34, metalness: 0.5 });
    MX.domeIn = std({ color: 0x24262b, roughness: 0.7, metalness: 0.3, side: THREE.BackSide }); MX.obsIn = std({ map: stuccoTex(), color: 0x34363c, roughness: 0.9, side: THREE.BackSide });
    MX.white = std({ color: 0xf2f2ee, roughness: 0.45, metalness: 0.1 });
    MX.black = std({ color: 0x0c0c0d, roughness: 0.62, metalness: 0.2 });
    MX.brass = std({ color: 0xb8913c, roughness: 0.32, metalness: 0.85 });
    MX.corten = std({ color: 0x6b3a1f, roughness: 0.78, metalness: 0.25 });
    MX.gravel = std({ map: (function () { try { return TEX.sand; } catch (e) { return null; } })(), color: 0xa59a8a, roughness: 1 });
    MX.redLed = std({ color: 0x220404, emissive: 0xff2a18, emissiveIntensity: 1.6 });
    MX.screen = std({ color: 0x050608, emissive: 0x6a1410, emissiveIntensity: 0.9, roughness: 0.2 });
    MX.chart = std({ map: chartTex(), emissive: 0xffffff, emissiveMap: chartTex(), emissiveIntensity: 0.12, roughness: 0.6 });
    MX.rose = std({ map: roseTex(), transparent: true, roughness: 0.4, metalness: 0.6, color: 0xb8913c, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    MX.sign = std({ map: signTex(), emissive: 0xffc888, emissiveMap: signTex(), emissiveIntensity: 0.1, transparent: true, roughness: 0.4, depthWrite: false });
    // the bollard heads and lamp lenses: amber, brightening after dark (uGlow)
    MX.lens = std({ color: 0x3a2a14, emissive: hex(C("light.bollardColor", "#ffb468"), "#ffb468"), emissiveIntensity: 0.1, roughness: 0.3 });
    // the door's glass: lit from inside after dark
    MX.doorGlass = std({ color: 0x5e5a54, emissive: hex(C("light.glowColor", "#ffd39a"), "#ffd39a"), emissiveIntensity: 0.1, roughness: 0.1, metalness: 0.1, envMapIntensity: 1.4 }); MX.doorClear = std({ color: 0x2c3537, roughness: 0.04, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.6 });
    // additive decals: light pools from bollards, decks, tubs and fires (opacity follows the night)
    var add = function (col) { return new THREE.MeshBasicMaterial({ map: glowTex(), color: hex(col, col), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: true }); };
    MX.glowAmber = add(C("light.bollardColor", "#ffb468")); MX.glowWarm = add(C("light.glowColor", "#ffd39a")); MX.glowBlue = add(C("light.tubColor", "#38c8ff")); MX.glowFire = add("#ff8a3a"); MX.glowRed = add(C("light.domeRed", "#ff3a2a"));
    MX.deckGlow = {};
    glassMats(); waterMat(); fireMat(); steamMat();
    for (var k in MX) { var m = MX[k]; if (m && m.isMaterial) m.name = "sg_" + k; }
    return MX;
  }
  // smart glass. Frosted (privacy): milky, nearly opaque, writes depth, glows warm after dark with a per-panel variation
  // brightest low and near the door (the lamps inside). Clear: a thin tinted film whose reflection and opacity rise at grazing
  // angles (Fresnel), so you see in at a face-on view and see the sky mirrored at a slant. aI = (frost alpha, glow, seed).
  function glassMats() {
    var glowC = hex(C("light.glowColor", "#ffd39a"), "#ffd39a");
    MX.frost = std({ color: 0xb4ada2, roughness: 0.16, metalness: 0, envMapIntensity: 1.5, transparent: true, opacity: 1, side: THREE.DoubleSide, emissive: glowC, emissiveIntensity: 1 });
    MX.frost.onBeforeCompile = function (sh) {
      sh.uniforms.uNight = U.uNight; sh.uniforms.uGlow = U.uGlow; sh.uniforms.uDim = U.uDim;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 aFace;\nattribute vec3 aI;\nvarying vec4 vFace;\nvarying vec3 vI;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFace = aFace; vI = aI;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight; uniform float uGlow; uniform float uDim;\nvarying vec4 vFace;\nvarying vec3 vI;\nfloat sgH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }")
        .replace("#include <alphatest_fragment>", "#include <alphatest_fragment>\nif (vI.x < 0.02) discard; diffuseColor.a = vI.x;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n{ vec2 cell = floor(vFace.xy); vec2 fr = fract(vFace.xy); float pv = 0.8 + 0.4 * sgH(cell + vI.z * 17.0);\n float edge = smoothstep(0.0, 0.18, fr.x) * smoothstep(1.0, 0.82, fr.x) * smoothstep(0.0, 0.16, fr.y) * smoothstep(1.0, 0.84, fr.y);\n float low = 1.0 - 0.6 * smoothstep(0.0, 1.0, vFace.z); float mid = 1.0 - 0.35 * smoothstep(0.15, 1.0, vFace.w);\n float g = low * mid * pv * (0.5 + 0.5 * edge); vec3 warm = mix(vec3(1.0, 0.62, 0.32), vec3(1.0, 0.93, 0.8), g * g);\n totalEmissiveRadiance *= warm * g * vI.y * uGlow * uDim * uNight; diffuseColor.rgb *= 1.0 - 0.86 * uNight; }");
    };
    MX.frost.customProgramCacheKey = function () { return "sg_frost" + SHV; };
    MX.clear = std({ color: 0x000000, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6, emissive: glowC, emissiveIntensity: 1 });
    MX.clear.onBeforeCompile = function (sh) {
      sh.uniforms.uNight = U.uNight; sh.uniforms.uDim = U.uDim; sh.uniforms.uClearGlow = U.uClearGlow;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec3 aI;\nvarying vec3 vI;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvI = aI;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight; uniform float uDim; uniform float uClearGlow;\nvarying vec3 vI;")
        .replace("#include <alphatest_fragment>", "#include <alphatest_fragment>\nif (vI.x < 0.02) discard;")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n{ float fr = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 4.0); diffuseColor.a = clamp(opacity + 0.42 * fr, 0.0, 0.55) * vI.x; }")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n{ totalEmissiveRadiance *= (0.04 + 0.04 * uClearGlow) * uNight * uDim * vI.y; }");
    };
    MX.clear.customProgramCacheKey = function () { return "sg_clear" + SHV; };
  }
  // hot tub water: a deep blue body lit from below by LEDs, slow caustic ripples on the surface (one uniform clock for all tubs)
  function waterMat() {
    MX.water = std({ color: 0x0a4a66, roughness: 0.06, metalness: 0.0, emissive: U.uWater.value.clone(), emissiveIntensity: 1 });
    MX.water.onBeforeCompile = function (sh) {
      sh.uniforms.uTime = U.uTime; sh.uniforms.uNight = U.uNight; sh.uniforms.uDim = U.uDim;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vWp;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvWp = position.xz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uNight; uniform float uDim; varying vec2 vWp;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n{ vec2 p = vWp * 3.1; float t = uTime * 0.9; float c = sin(p.x * 2.3 + t) * sin(p.y * 2.1 - t * 0.8) + sin((p.x + p.y) * 3.7 + t * 1.3) * 0.5 + sin(length(p) * 4.0 - t * 1.6) * 0.35;\n float caus = pow(clamp(0.5 + 0.5 * c, 0.0, 1.0), 3.0); float r = length(vWp) / 1.0; float edge = 1.0 - smoothstep(0.55, 1.0, r);\n totalEmissiveRadiance *= (0.25 + 0.75 * uNight * uDim) * (0.55 + 0.45 * edge) * (0.75 + 0.9 * caus); }")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n{ float t = uTime; vec2 p = vWp * 4.0; normal = normalize(normal + vec3(sin(p.x * 3.0 + t * 1.7) * 0.05, cos(p.y * 3.3 - t * 1.4) * 0.05, 0.0)); }");
    };
    MX.water.customProgramCacheKey = function () { return "sg_water" + SHV; };
  }
  // flames: two crossed cards per fire, an animated noise flame (additive, no light of their own; pooled lights do the lighting)
  function fireMat() {
    MX.fire = new THREE.ShaderMaterial({ uniforms: { uTime: U.uTime, uAmp: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: "varying vec2 vUv; varying float vSeed; attribute float aSeed; void main(){ vUv = uv; vSeed = 0.0;\n #ifdef USE_INSTANCING\n vSeed = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.71;\n gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);\n #else\n gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n #endif\n }",
      fragmentShader: "uniform float uTime; uniform float uAmp; varying vec2 vUv; varying float vSeed;\n float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }\n float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }\n void main(){ vec2 uv = vUv; float t = uTime * 1.6 + vSeed * 10.0; float y = uv.y; float x = (uv.x - 0.5) * 2.0;\n float q = n(vec2(uv.x * 5.0, uv.y * 3.0 - t * 2.2)) * 0.6 + n(vec2(uv.x * 11.0, uv.y * 6.0 - t * 3.5)) * 0.4;\n float w = (1.0 - y) * 0.95 + 0.05; float shape = smoothstep(w, w * 0.25, abs(x + (q - 0.5) * 0.55 * y)) * smoothstep(1.0, 0.25, y + q * 0.45) * smoothstep(0.0, 0.08, y);\n vec3 col = mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.86, 0.48), smoothstep(0.55, 0.0, y) * smoothstep(0.7, 0.0, abs(x)));\n float a = shape * uAmp; if (a < 0.01) discard; gl_FragColor = vec4(col * a * 1.6, a); }" });
    MX.fire.name = "sg_fire";
  }
  function steamMat() { MX.steam = new THREE.SpriteMaterial({ map: glowTex(), color: 0xdfe8ee, transparent: true, opacity: 0.0, depthWrite: false }); }

  // ───────────────────────── the site: pyramids, campus and paths resolved from the JSON ─────────────────────────
  var SITE = SG.site = SG.site || null;
  function l2w(P, lx, lz) { var c = Math.cos(P.rot), s = Math.sin(P.rot); return [P.x + lx * c + lz * s, P.z - lx * s + lz * c]; }
  function w2l(P, x, z) { var dx = x - P.x, dz = z - P.z, c = Math.cos(P.rot), s = Math.sin(P.rot); return [dx * c - dz * s, dx * s + dz * c]; }
  function resolveSite() {
    if (SITE) return SITE; var c = cfg(); if (!c) return null;
    var S = { pyr: [], sizes: {}, paths: [], c: c, deckH: C("site.deckHeight", 0.95) };
    for (var k in c.sizes) { var z = c.sizes[k]; var half = z.side / 2; S.sizes[k] = { key: k, side: z.side, half: half, H: z.height, back: z.back, front: z.front, W: z.side + 2 * z.sideMargin, zb: -half - z.back, zf: half + z.front, rows: z.rows, cols: z.cols, stepsX: z.stepsX, tub: [z.tubX, half + z.tubZ], fire: [z.fireX, half + z.fireZ], label: z.label }; }
    var rot0 = (c.site.rot || 0) * PI / 180;
    (c.pyramids || []).forEach(function (p, i) { var sz = S.sizes[p.size] || S.sizes.L; S.pyr.push({ i: i, id: p.id, sz: sz, x: p.x, z: p.z, rot: p.rot !== undefined ? p.rot * PI / 180 : rot0, open: !!p.open, model: !!p.model, G: 0, D: 0, frost: p.open ? 0 : 1, frostT: p.open ? 0 : 1, glow: 0.8 + rng(i * 31 + 7)() * 0.4 }); });
    S.obs = c.site.observatory; S.amph = c.site.amphitheatre; S.terr = c.site.terrace; S.lot = c.site.lot; S.sign = c.site.signAt;
    return (SITE = SG.site = S);
  }
  // a deck's footprint corners in world (with a margin), for keep-outs, clearing and grading
  function deckPoly(P, m) { var z = P.sz; m = m || 0; return [l2w(P, -z.W / 2 - m, z.zb - m), l2w(P, z.W / 2 + m, z.zb - m), l2w(P, z.W / 2 + m, z.zf + 1.4 + m), l2w(P, -z.W / 2 - m, z.zf + 1.4 + m)]; }
  function inPoly(poly, x, z) { var c = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
  function deckCentre(P) { var z = P.sz; return l2w(P, 0, (z.zb + z.zf + 1.4) / 2); }
  function deckRadius(P) { var z = P.sz; return Math.hypot(z.W / 2, (z.zf + 1.4 - z.zb) / 2); }
  // the paths: the JSON's polylines plus one from every pyramid's steps to the Ridge Arroyo Trail, smoothed and gently wandering
  function trailZ(x) { var pts = [[833, 801], [800, 796], [650, 826], [550, 856]]; try { var P = window.PLAN; var r = P && P.roads && P.roads.find(function (q) { return q.id === "ridge_tr"; }); if (r) pts = r.pts; } catch (e) {} for (var i = 0; i < pts.length - 1; i++) { var a = pts[i], b = pts[i + 1]; var lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]); if (x >= lo && x <= hi) { var t = (x - a[0]) / (b[0] - a[0] || 1); return a[1] + (b[1] - a[1]) * t; } } return null; }
  function stepsFoot(P) { var z = P.sz; return l2w(P, z.stepsX, z.zf + 1.5); }
  function smoothPath(pts, seed) { var R = rng(seed || 3), out = []; if (pts.length < 2) return pts.slice(); var P = pts.map(function (p, i) { if (i === 0 || i === pts.length - 1) return p.slice(); return [p[0] + (R() - 0.5) * 0.8, p[1] + (R() - 0.5) * 0.8]; });
    for (var i = 0; i < P.length - 1; i++) { var p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)]; var L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]); var n = Math.max(2, Math.ceil(L / 1.4));
      for (var k = 0; k < n; k++) { var t = k / n, t2 = t * t, t3 = t2 * t; var f = function (a, b, c, d) { return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); }; out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]); } }
    out.push(P[P.length - 1].slice()); return out; }
  function resolvePaths() {
    var S = resolveSite(); if (!S || S.pathsDone) return S && S.paths; S.pathsDone = true; var have = {};
    (S.c.paths || []).forEach(function (p, i) { S.paths.push({ id: p.id, w: p.w || 2.2, pts: smoothPath(p.pts, 11 + i * 7), raw: p.pts }); if (/^p\d+/i.test(p.id)) have[p.id.toUpperCase().replace(/AMPH$/, "")] = true; });
    S.pyr.forEach(function (P, i) { if (have[P.id.toUpperCase()]) return; var f = stepsFoot(P); var tz = trailZ(f[0]); if (tz === null) return; var dir = tz < f[1] ? -1 : 1; var L = Math.abs(f[1] - tz) - 1.0; if (L < 0.8) return; var R = rng(i * 97 + 5);
      var raw = [[f[0], f[1]], [f[0] + (R() - 0.5) * 1.6, f[1] + dir * L * 0.45], [f[0] + (R() - 0.5) * 1.2, tz - dir * 1.0]];
      // the second row (P12) threads between the decks of the first row
      S.pyr.forEach(function (Q) { if (Q === P) return; var q = w2l(Q, raw[1][0], raw[1][1]); if (Math.abs(q[0]) < Q.sz.W / 2 + 1.2 && q[1] > Q.sz.zb - 1.2 && q[1] < Q.sz.zf + 2.6) { var side = q[0] > 0 ? 1 : -1; var w = l2w(Q, side * (Q.sz.W / 2 + 1.6), q[1]); raw[1] = w; raw.splice(2, 0, [w[0], w[1] + dir * 6]); } });
      S.paths.push({ id: "auto_" + P.id, w: 1.9, pts: smoothPath(raw, 31 + i), raw: raw, pyr: P.id }); });
    return S.paths;
  }
  // every footprint the retreat occupies (decks, campus, lot, paths): [kind, ...] tests used for clearing, keep-outs and scatter
  function footprints(S) {
    if (S.fp) return S.fp; var F = [];
    S.pyr.forEach(function (P) { F.push({ t: "poly", poly: deckPoly(P, 1.4), c: deckCentre(P), r: deckRadius(P) + 1.4 }); });
    F.push({ t: "disc", c: [S.obs.x, S.obs.z], r: S.obs.r + 3.4 }); F.push({ t: "disc", c: [S.amph.x, S.amph.z], r: S.amph.tiers[S.amph.tiers.length - 1] + 1.6 }); F.push({ t: "disc", c: [S.terr.x, S.terr.z], r: S.terr.r + 1.4 });
    var L = S.lot, lr = L.rot * PI / 180, lc = Math.cos(lr), ls = Math.sin(lr); var lw = function (x, z) { return [L.x + x * lc + z * ls, L.z - x * ls + z * lc]; };
    F.push({ t: "poly", poly: [lw(-L.w / 2 - 1.5, -L.d / 2 - 1.5), lw(L.w / 2 + 1.5, -L.d / 2 - 1.5), lw(L.w / 2 + 1.5, L.d / 2 + 1.5), lw(-L.w / 2 - 1.5, L.d / 2 + 1.5)], c: [L.x, L.z], r: Math.hypot(L.w, L.d) / 2 + 2 });
    F.push({ t: "disc", c: [S.sign.x, S.sign.z], r: 2.6 });
    (S.paths || []).forEach(function (p) { for (var i = 0; i < p.pts.length; i++) F.push({ t: "disc", c: p.pts[i], r: p.w / 2 + 0.7, path: true }); });
    return (S.fp = F);
  }
  function inFootprint(S, x, z, pathsToo) { var F = footprints(S); for (var i = 0; i < F.length; i++) { var f = F[i]; if (f.path && !pathsToo) continue; var dx = x - f.c[0], dz = z - f.c[1]; if (dx * dx + dz * dz > f.r * f.r) continue; if (f.t === "disc" || inPoly(f.poly, x, z)) return true; } return false; }
  var VEG = /^(bush\d|mesquite|ocotillo|saguaro.*|paloverde|ironwood|desertwillow|barrel_cactus|prickly_pear|cholla|organ_pipe|agave_cluster|yucca_cluster|boulder|ph_(rock|boulder|shrub|succulent|stones|sandrocks|moonrock)_?\d*|e1_(?!opost).*)$/;
  function clearSite(S) {
    var removed = 0, keys = new Set();
    for (var k in PLACE) { if (!VEG.test(k)) continue; var L = PLACE[k], out = []; for (var i = 0; i < L.length; i++) { var e = L[i]; if (inFootprint(S, e[0], e[2], true)) { keys.add(Math.round(e[0] * 100) + ":" + Math.round(e[2] * 100)); removed++; } else out.push(e); } if (out.length !== L.length) { L.length = 0; Array.prototype.push.apply(L, out); } }
    if (keys.size) for (var j = COLLIDERS.length - 1; j >= 0; j--) { var c = COLLIDERS[j]; if (keys.has(Math.round(c[0] * 100) + ":" + Math.round(c[1] * 100))) COLLIDERS.splice(j, 1); }
    SG.n.cleared = removed;
  }
  function keepouts(S) { footprints(S).forEach(function (f, i) { if (f.path && i % 2) return; KEEPOUT.push([f.c[0], f.c[1], f.t === "poly" ? f.r : f.r]); }); }
  // the site outline (for the zone title): a convex hull of everything, pushed out a little
  function hull(pts) { pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }); var cr = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }; var lo = [], up = []; pts.forEach(function (p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }); for (var i = pts.length - 1; i >= 0; i--) { var p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); } up.pop(); lo.pop(); return lo.concat(up); }
  function siteOutline(S) { var pts = []; S.pyr.forEach(function (P) { deckPoly(P, 5).forEach(function (q) { pts.push(q); }); }); [[S.obs.x, S.obs.z, 12], [S.amph.x, S.amph.z, 14], [S.terr.x, S.terr.z, 14], [S.lot.x, S.lot.z, 16]].forEach(function (d) { for (var a = 0; a < 12; a++) pts.push([d[0] + Math.sin(a / 12 * TAU) * d[2], d[1] + Math.cos(a / 12 * TAU) * d[2]]); }); return hull(pts); }

  // ───────────────────────── world hook: keep-outs, clearing, paths, the cart park, the hub, the zone, info points ─────────────────────────
  function worldHook() {
    if (SG.off || !window.PLAN) return; var S = resolveSite(); if (!S) { note("site", "no plan/stargaze.json"); return; } var t0 = nowMs();
    resolvePaths(); try { clearSite(S); } catch (e) { note("clear", e); } try { keepouts(S); } catch (e) { note("keepouts", e); }
    // winding dirt paths (registered as roads: the walk surface, scatter and the minimap know them)
    var pm = M.track; try { var PM = planMats(); if (PM && PM.dg) { pm = PM.dg.clone(); pm.name = "sg_path"; pm.color.multiply(new THREE.Color(0xd9ae86)); ROAD_MATS.set(pm, true); } } catch (e) { pm = M.track; } S.paths.forEach(function (p) { try { scene.add(ribbon(p.pts, p.w, pm, pm === M.track ? 0.16 : 0.18)); } catch (e) { note("path " + p.id, e); } });
    // the cart park: compacted dirt along its long axis, off Ridge Road
    try { var L = S.lot, lr = L.rot * PI / 180; var ax = Math.cos(lr), az = -Math.sin(lr); scene.add(ribbon([[L.x - ax * L.w / 2, L.z - az * L.w / 2], [L.x + ax * L.w / 2, L.z + az * L.w / 2]], L.d, M.dirt, 0.2)); } catch (e) { note("lot", e); }
    // the hub (Places list, map pills, fast travel) and the zone title
    try { var hb = C("site.hub", [742, 800]); S.hub = hb; planAddHub(C("names.retreatShort", "Stargazer Pyramids"), hb[0], hb[1]); planNavCats(); } catch (e) { note("hub", e); }
    try { var poly = siteOutline(S); S.outline = poly; var zc = C("site.zoneCenter", [716, 800]); zoneRings.push({ name: C("names.retreat", "The Stargazer Pyramids"), label: C("names.retreatShort", "Stargazer Pyramids"), center: zc, r: C("site.zoneRadius", 105), k: C("names.zone", "A dark sky retreat"), poly: poly, col: "#f4cd5a44", plan: "stargaze", noLabel: true }); S.zone = zoneRings[zoneRings.length - 1]; } catch (e) { note("zone", e); }
    // info points (E reads them)
    try { var I = C("info", {}); var hs = function (key, x, z, r) { var d = I[key]; if (!d) return; var h = { x: x, z: z, r: r, t: d.t, k: d.k, p: d.p, sg: key }; hotspots.push(h); (S.hs = S.hs || []).push(h); return h; };
      hs("sign", S.sign.x, S.sign.z, 5); var od = [S.obs.doorToward[0] - S.obs.x, S.obs.doorToward[1] - S.obs.z], ol = Math.hypot(od[0], od[1]) || 1; hs("observatory", S.obs.x + od[0] / ol * (S.obs.r + 3.2), S.obs.z + od[1] / ol * (S.obs.r + 3.2), 3.2);
      hs("terrace", S.terr.x, S.terr.z, 2.4); hs("theatre", S.amph.x, S.amph.z, 2.6);
      S.pyr.forEach(function (P) { if (!P.model) return; var f = stepsFoot(P); hs("model", f[0], f[1], 3.2); }); } catch (e) { note("hotspots", e); }
    install(); SG.n.worldMs = Math.round(nowMs() - t0);
  }

  // ───────────────────────── terrain hook: grade the pads, plant the desert round them, re-seat what stands in the blend ─────────────────────────
  function gridH(x, z) { try { return sampleGrid(H, T, x, z); } catch (e) { return getH(x, z); } }
  function gradePad(test, bb, level, blend) {
    if (typeof H === "undefined" || !H || !T) return 0; var cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1), n = 0;
    var c0 = Math.max(0, Math.floor((bb[0] - blend - T.xmin) / cw)), c1 = Math.min(T.cols - 1, Math.ceil((bb[1] + blend - T.xmin) / cw)), r0 = Math.max(0, Math.floor((bb[2] - blend - T.zmin) / ch)), r1 = Math.min(T.rows - 1, Math.ceil((bb[3] + blend - T.zmin) / ch));
    for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) { var x = T.xmin + c * cw, z = T.zmin + r * ch; var d = test(x, z); if (d >= blend) continue; var k = 1 - sstep(0, blend, d); var v = r * T.cols + c; H[v] = H[v] + (level - H[v]) * k; n++; }
    return n;
  }
  function polyDist(poly, x, z) { if (inPoly(poly, x, z)) return 0; var best = 1e9; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var a = poly[j], b = poly[i]; var vx = b[0] - a[0], vz = b[1] - a[1]; var t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1), 0, 1); best = Math.min(best, Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t)); } return best; }
  function bbOf(poly) { var b = [1e9, -1e9, 1e9, -1e9]; poly.forEach(function (p) { b[0] = Math.min(b[0], p[0]); b[1] = Math.max(b[1], p[0]); b[2] = Math.min(b[2], p[1]); b[3] = Math.max(b[3], p[1]); }); return b; }
  function avgOver(poly, step) { var b = bbOf(poly), s = 0, n = 0; for (var x = b[0]; x <= b[1]; x += step) for (var z = b[2]; z <= b[3]; z += step) if (inPoly(poly, x, z)) { s += gridH(x, z); n++; } return n ? s / n : gridH((b[0] + b[1]) / 2, (b[2] + b[3]) / 2); }
  function terrainHook() {
    if (SG.off || !window.PLAN || !SITE) return; var S = SITE, t0 = nowMs(), n = 0, dH = S.deckH;
    try {
      S.pyr.forEach(function (P) { var poly = deckPoly(P, 1.2); var lv = avgOver(poly, 1.5); P.G = lv; n += gradePad(function (x, z) { return polyDist(poly, x, z); }, bbOf(poly), lv, 5); });
      [["obs", S.obs, S.obs.r + 3.2, 6], ["amph", S.amph, S.amph.tiers[S.amph.tiers.length - 1] + 1.2, 5], ["terr", S.terr, S.terr.r + 1.2, 5]].forEach(function (d) { var o = d[1], R = d[2]; var s = 0, m = 0; for (var a = 0; a < 16; a++) for (var rr = 0; rr <= R; rr += R / 3) { s += gridH(o.x + Math.sin(a / 16 * TAU) * rr, o.z + Math.cos(a / 16 * TAU) * rr); m++; } o.G = s / m; n += gradePad(function (x, z) { return Math.max(0, Math.hypot(x - o.x, z - o.z) - R); }, [o.x - R, o.x + R, o.z - R, o.z + R], o.G, d[3]); });
      var L = S.lot, lp = footprints(S).filter(function (f) { return f.t === "poly" && f.c[0] === L.x && f.c[1] === L.z; })[0]; if (lp) { L.G = avgOver(lp.poly, 2); n += gradePad(function (x, z) { return polyDist(lp.poly, x, z); }, bbOf(lp.poly), L.G, 4); }
    } catch (e) { note("grade", e); }
    S.pyr.forEach(function (P) { P.G = gridH(P.x, P.z); var poly = deckPoly(P, 0); var lo = 1e9, hi = -1e9; poly.forEach(function (q) { var h = gridH(q[0], q[1]); lo = Math.min(lo, h); hi = Math.max(hi, h); }); P.G = Math.max(P.G, hi - 0.25); P.D = P.G + dH; P.lo = lo; });
    [S.obs, S.amph, S.terr].forEach(function (o) { o.G = gridH(o.x, o.z); }); S.sign.G = gridH(S.sign.x, S.sign.z); S.lot.G = gridH(S.lot.x, S.lot.z);
    SG.n.graded = n;
    // re-seat everything standing on the graded ground (others' props in the blend, nothing on our pads after the clearing)
    try { var R = 0; for (var k in PLACE) { var Lk = PLACE[k]; for (var i = 0; i < Lk.length; i++) { var e = Lk[i]; if (e.seated || e[0] < 560 || e[0] > 860 || e[2] < 680 || e[2] > 900) continue; var g = getH(e[0], e[2]); if (Math.abs(g - e[1]) > 0.02 && Math.abs(g - e[1]) < 1.5) { e[1] = g; R++; } } } SG.n.reseated = R; } catch (e) { note("reseat", e); }
    try { plant(S); } catch (e) { note("plant", e); }
    SG.n.terrainMs = Math.round(nowMs() - t0);
  }
  // desert planting round the decks and the campus: low scrub, barrel cactus, prickly pear, agave and yucca near the decks, a few
  // young saguaros and ocotillo standing back, rocks; the client's scatter fills the open desert between (it skips our keep-outs)
  function plant(S) {
    var R = rng(C("vegetation.seed", 1977)), per = C("vegetation.perPyramid", 9), nC = C("vegetation.campus", 26), n = 0;
    var near = ["barrel_cactus", "prickly_pear", "agave_cluster", "yucca_cluster", "ph_succulent_1", "ph_succulent_2", "ph_shrub_1", "ph_shrub_2", "bush1", "bush2", "ph_rock_1", "ph_rock_3", "ph_rock_5"].filter(canPut);
    var far = ["saguaro_young", "saguaro_mid", "ocotillo", "cholla", "organ_pipe", "ph_boulder_2", "ph_boulder_4", "bush2", "mesquite"].filter(canPut);
    if (!near.length) return;
    var ok = function (x, z) { if (inFootprint(S, x, z, true)) return false; try { if (typeof nearRoad === "function" && nearRoad(x, z, 2)) return false; } catch (e) {} for (var i = 0; i < COLLIDERS.length; i += 1) { var c = COLLIDERS[i]; if (Math.abs(c[0] - x) < c[2] + 1.2 && Math.abs(c[1] - z) < c[2] + 1.2 && Math.hypot(c[0] - x, c[1] - z) < c[2] + 1.0) return false; } return true; };
    var put1 = function (k, x, z, sc) { if (!ok(x, z)) return false; put(k, x, z, R() * TAU, sc); n++; return true; };
    S.pyr.forEach(function (P) { var z = P.sz; for (var i = 0; i < per; i++) { var side = R(); var lx, lz; if (side < 0.35) { lx = (R() < 0.5 ? -1 : 1) * (z.W / 2 + 1.6 + R() * 3.5); lz = z.zb + R() * (z.zf - z.zb); } else if (side < 0.7) { lx = (R() - 0.5) * (z.W + 6); lz = z.zb - 1.8 - R() * 4; } else { lx = (R() - 0.5) * (z.W + 4); lz = z.zf + 2.6 + R() * 4; }
        var w = l2w(P, lx, lz); var k = R() < 0.78 ? near[Math.floor(R() * near.length)] : far[Math.floor(R() * far.length)] || near[0]; put1(k, w[0], w[1], 0.75 + R() * 0.5); } });
    for (var j = 0; j < nC; j++) { var o = [S.obs, S.amph, S.terr][j % 3]; var rr = (o === S.obs ? o.r + 5 : o === S.amph ? o.tiers[o.tiers.length - 1] + 3 : o.r + 3) + R() * 7, a = R() * TAU; var k2 = R() < 0.7 ? near[Math.floor(R() * near.length)] : far[Math.floor(R() * far.length)] || near[0]; put1(k2, o.x + Math.sin(a) * rr, o.z + Math.cos(a) * rr, 0.7 + R() * 0.55); }
    SG.n.planted = n;
  }
  // ───────────────────────── the pyramid and its deck, built once per size (pyramid frame: floor centre at the deck top, +z the door) ─────────────────────────
  var DOOR = { hw: 0.56, top: 2.32, leafW: 1.0, leafH: 2.16 };
  function faceBasis(a) { return { n: new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), t: new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)) }; }
  function faceNormal(B, half, Hh) { return B.n.clone().multiplyScalar(Hh).add(new THREE.Vector3(0, half, 0)).normalize(); }
  // glass faces as one geometry with aFace = (u across the face, height, face index): the frosted shader shades per panel from it
  function glassGeo(sz) {
    var half = sz.half, Hh = sz.H, hAt = function (y) { return half * (1 - y / Hh); }, P = [], Nn = [], Uv = [], F = [], colW = 2 * half / sz.cols, rowH = Hh / sz.rows;
    var fc = function (u, y) { return [(u + half) / colW, y / rowH, y / Hh, Math.abs(u) / half]; };
    for (var f = 0; f < 4; f++) {
      var B = faceBasis(f * PI / 2), N = faceNormal(B, half, Hh), off = N.clone().multiplyScalar(-0.012);
      var shape = f === 0 ? [[-half, 0], [-DOOR.hw, 0], [-DOOR.hw, DOOR.top], [DOOR.hw, DOOR.top], [DOOR.hw, 0], [half, 0], [0, Hh]] : [[-half, 0], [half, 0], [0, Hh]];
      var tris = THREE.ShapeUtils.triangulateShape(shape.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), []);
      tris.forEach(function (tr) { var vs = tr.map(function (ix) { var u = shape[ix][0], y = shape[ix][1]; var p = B.n.clone().multiplyScalar(hAt(y)).addScaledVector(B.t, u); p.y = y; p.add(off); return [p, u, y]; });
        var cr = new THREE.Vector3().subVectors(vs[1][0], vs[0][0]).cross(new THREE.Vector3().subVectors(vs[2][0], vs[0][0])); if (cr.dot(N) < 0) { var t = vs[1]; vs[1] = vs[2]; vs[2] = t; }   // wound to face out
        vs.forEach(function (v) { P.push(v[0].x, v[0].y, v[0].z); Nn.push(N.x, N.y, N.z); Uv.push(v[1] / 2, v[2] / 2); Array.prototype.push.apply(F, fc(v[1], v[2])); }); });
    }
    // the dormer's glass cheeks either side of the door
    [-1, 1].forEach(function (sd) { var x = sd * DOOR.hw, pts = [[x, 0, half], [x, DOOR.top, half], [x, DOOR.top, hAt(DOOR.top)]]; var a = new THREE.Vector3().fromArray(pts[0]), b = new THREE.Vector3().fromArray(pts[1]), c = new THREE.Vector3().fromArray(pts[2]); if (new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).x * sd < 0) pts = [pts[0], pts[2], pts[1]]; pts.forEach(function (q) { P.push(q[0], q[1], q[2]); Nn.push(sd, 0, 0); Uv.push(q[2] / 2, q[1] / 2); Array.prototype.push.apply(F, fc(x, q[1])); }); });
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(Nn, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(Uv, 2)); g.setAttribute("aFace", new THREE.Float32BufferAttribute(F, 4)); g.computeBoundingSphere(); return g;
  }
  // the metal: mullion grid on every face (rectilinear, clipped by the triangle and the door notch), hips, base frame, apex cap, dormer
  function shellKit(K, sz) {
    var half = sz.half, Hh = sz.H, hAt = function (y) { return half * (1 - y / Hh); }, V = function (x, y, z) { return new THREE.Vector3(x, y, z); };
    var mw = 0.075, md = 0.1;
    for (var f = 0; f < 4; f++) {
      var B = faceBasis(f * PI / 2), N = faceNormal(B, half, Hh), out = N.clone().multiplyScalar(0.025);
      var at = function (u, y) { var p = B.n.clone().multiplyScalar(hAt(y)).addScaledVector(B.t, u); p.y = y; return p.add(out); };
      for (var k = 1; k < sz.rows; k++) { var y = Hh * k / sz.rows, w = hAt(y) - 0.03; if (w < 0.15) continue;
        if (f === 0 && y < DOOR.top) { K.beam("metal", at(-w, y), at(-DOOR.hw, y), mw, md, N); K.beam("metal", at(DOOR.hw, y), at(w, y), mw, md, N); } else K.beam("metal", at(-w, y), at(w, y), mw, md, N); }
      for (var j = 1; j < sz.cols; j++) { var u = -half + j * 2 * half / sz.cols; var ytop = Hh * (1 - Math.abs(u) / half) - 0.04; var y0 = (f === 0 && Math.abs(u) < DOOR.hw + 0.02) ? DOOR.top : 0; if (ytop - y0 < 0.1) continue; K.beam("metal", at(u, y0), at(u, ytop), mw, md, N); }
      // the base frame along this face
      K.beam("metal", V(0, 0.07, 0).addScaledVector(B.n, half + 0.01).addScaledVector(B.t, -half - 0.06), V(0, 0.07, 0).addScaledVector(B.n, half + 0.01).addScaledVector(B.t, half + 0.06), 0.14, 0.12, B.n);
    }
    // hips (the four corner ridges) and the apex cap
    [[1, 1], [1, -1], [-1, -1], [-1, 1]].forEach(function (c) { var nrm = V(c[0], 0.9, c[1]).normalize(); K.beam("metal", V(c[0] * (half + 0.02), 0, c[1] * (half + 0.02)), V(0, Hh + 0.02, 0), 0.13, 0.12, nrm); });
    K.box("metal", 0.2, 0.18, 0.2, 0, Hh + 0.02, 0, PI / 4);
    // the dormer: door posts, header, cheek edges, a flashing roof
    var dt = DOOR.top, z1 = half + 0.02, z0 = hAt(dt);
    [-1, 1].forEach(function (sd) { K.beam("metal", V(sd * DOOR.hw, 0, z1), V(sd * DOOR.hw, dt + 0.04, z1), 0.08, 0.1, V(0, 0, 1)); K.beam("metal", V(sd * DOOR.hw, dt + 0.02, z1), V(sd * DOOR.hw, dt + 0.02, z0), 0.07, 0.07, V(sd, 0, 0)); });
    K.beam("metal", V(-DOOR.hw - 0.04, dt + 0.02, z1), V(DOOR.hw + 0.04, dt + 0.02, z1), 0.1, 0.1, V(0, 0, 1));
    K.box("metal", 2 * DOOR.hw + 0.08, 0.04, z1 - z0 + 0.05, 0, dt + 0.06, (z0 + z1) / 2, 0);
  }
  // a door leaf (glass in a slim metal frame) in its hinge frame: the hinge at x = 0, the leaf toward +x, closed in the plane z = 0
  function leafKit(K) { var W = DOOR.leafW, Hh = DOOR.leafH; K.box("doorGlass", W - 0.08, Hh - 0.08, 0.02, W / 2, Hh / 2 + 0.03, 0, 0);
    K.box("metal", 0.05, Hh, 0.05, 0.025, Hh / 2 + 0.03, 0); K.box("metal", 0.05, Hh, 0.05, W - 0.025, Hh / 2 + 0.03, 0); K.box("metal", W, 0.05, 0.05, W / 2, 0.055, 0); K.box("metal", W, 0.05, 0.05, W / 2, Hh + 0.005, 0);
    K.box("brass", 0.03, 0.5, 0.03, W - 0.12, 1.05, 0.05); K.box("brass", 0.03, 0.5, 0.03, W - 0.12, 1.05, -0.05); }
  // the deck: boards, fascia, bearers, posts down to the pad, railing with cables, steps with handrails
  function deckKit(K, sz, dH) {
    var W = sz.W, zb = sz.zb, zf = sz.zf, sx = sz.stepsX, gap0 = sx - 0.78, gap1 = sx + 0.78, D = zf - zb, zc = (zb + zf) / 2;
    K.box("deck", W, 0.05, D, 0, -0.025, zc, 0, 1.6);
    K.box("timber", W + 0.04, 0.28, 0.05, 0, -0.19, zb - 0.02, 0, 1); K.box("timber", W + 0.04, 0.28, 0.05, 0, -0.19, zf + 0.02, 0, 1); K.box("timber", 0.05, 0.28, D, -W / 2 - 0.02, -0.19, zc, 0, 1); K.box("timber", 0.05, 0.28, D, W / 2 + 0.02, -0.19, zc, 0, 1);
    var nx = Math.ceil(W / 2.4), nz = Math.ceil(D / 2.4), xs = [], zs = []; for (var i = 0; i <= nx; i++) xs.push(-W / 2 + 0.16 + (W - 0.32) * i / nx); for (var j = 0; j <= nz; j++) zs.push(zb + 0.16 + (D - 0.32) * j / nz);
    var ph = dH + 0.55 - 0.33; zs.forEach(function (z) { K.box("post", W - 0.2, 0.22, 0.12, 0, -0.44, z, 0, 1); xs.forEach(function (x) { var edge = Math.abs(x) > W / 2 - 0.3 || z < zb + 0.3 || z > zf - 0.3; if (!edge && (Math.abs(x) % 2.2) > 1.1) return; K.box("post", 0.16, ph, 0.16, x, -0.33 - ph / 2, z, 0, 1); }); });
    // railing: posts, a timber cap and three steel cables, round the whole deck but for the gap at the steps
    var rail = function (ax, az, bx, bz) { var L = Math.hypot(bx - ax, bz - az); if (L < 0.05) return; var ry = Math.atan2(bx - ax, bz - az), mx = (ax + bx) / 2, mz = (az + bz) / 2;
      K.box("timber", 0.11, 0.045, L + 0.06, mx, 1.0, mz, ry, 1); [0.28, 0.55, 0.8].forEach(function (y) { K.box("steel", 0.012, 0.012, L, mx, y, mz, ry); });
      var n = Math.max(1, Math.ceil(L / 1.6)); for (var k = 0; k <= n; k++) { var t = k / n; K.box("metal", 0.06, 1.0, 0.06, ax + (bx - ax) * t, 0.5, az + (bz - az) * t, ry); } };
    var e = 0.03, xL = -W / 2 + e, xR = W / 2 - e, zB = zb + e, zF = zf - e;
    rail(xL, zB, xR, zB); rail(xL, zB, xL, zF); rail(xR, zB, xR, zF); rail(xL, zF, gap0, zF); rail(gap1, zF, xR, zF);
    // steps down to the pad: four treads and the pad, stringers and handrails on both sides
    var rise = dH / 5, run = 0.3; for (var s = 1; s <= 4; s++) K.box("timber", 1.42, 0.05, run + 0.02, sx, -rise * s - 0.025, zf + run * (s - 0.5), 0, 1);
    [-1, 1].forEach(function (sd) { var x = sx + sd * 0.74; K.beam("metal", new THREE.Vector3(x, -0.1, zf), new THREE.Vector3(x, -dH + 0.05, zf + run * 4.3), 0.05, 0.22, new THREE.Vector3(sd, 0, 0));
      K.beam("metal", new THREE.Vector3(x, 1.0, zf), new THREE.Vector3(x, -dH + 0.95, zf + run * 4), 0.05, 0.05, new THREE.Vector3(0, 1, 0)); K.box("metal", 0.05, 0.95, 0.05, x, -dH + 0.47, zf + run * 4); });
  }
  // the hot tub (shared by both sizes): a round timber-clad tub, a stone cap, the dark shell inside; the water is its own mesh
  function tubKit(K) { K.cyl("timber", 1.15, 1.15, 0.48, 0, 0.24, 0, 36, true); var ring = new THREE.RingGeometry(0.98, 1.19, 40, 1); ring.rotateX(-PI / 2); K.geo("cap", ring, 0, 0.5, 0); K.cyl("cap", 1.19, 1.19, 0.04, 0, 0.48, 0, 40, true); K.cyl("tubIn", 0.98, 0.94, 0.42, 0, 0.29, 0, 36, true); }
  function fireKit(K) { var prof = [[0, 0], [0.5, 0], [0.56, 0.04], [0.56, 0.37], [0.53, 0.41], [0.44, 0.41], [0.42, 0.34], [0, 0.34]].map(function (p) { return new THREE.Vector2(p[0], p[1]); }); K.geo("concrete", new THREE.LatheGeometry(prof, 28), 0, 0, 0); K.cyl("beads", 0.42, 0.42, 0.02, 0, 0.345, 0, 24); }
  // a low lounge chair facing +z: slatted timber arms and frame, deep sand cushions
  function chairKit(K) {
    K.box("cushion", 0.64, 0.11, 0.62, 0, 0.33, 0.04, 0, 0.5); var bk = new THREE.BoxGeometry(0.64, 0.56, 0.11); bk.rotateX(-0.42); K.geo("cushion", bk, 0, 0.6, -0.27); var pl = new THREE.BoxGeometry(0.34, 0.26, 0.12); pl.rotateX(-0.42); K.geo("fabric", pl, 0.08, 0.62, -0.18);
    [-1, 1].forEach(function (sd) { var x = sd * 0.37; K.box("timber", 0.06, 0.05, 0.8, x, 0.52, 0.0, 0, 0.5); K.box("timber", 0.05, 0.5, 0.05, x, 0.25, 0.33, 0); K.box("timber", 0.05, 0.5, 0.05, x, 0.25, -0.33, 0); K.box("timber", 0.05, 0.05, 0.7, x, 0.08, 0, 0); var bp = new THREE.BoxGeometry(0.05, 0.62, 0.05); bp.rotateX(-0.42); K.geo("timber", bp, x, 0.56, -0.38); });
    K.box("timber", 0.7, 0.05, 0.05, 0, 0.26, 0.33, 0); K.box("timber", 0.7, 0.05, 0.05, 0, 0.26, -0.33, 0); for (var k = 0; k < 6; k++) K.box("timber", 0.66, 0.025, 0.07, 0, 0.27, -0.27 + k * 0.11, 0); }
  // a zero gravity lounger, feet toward +z, reclined (the terrace)
  function loungerKit(K) { var seg = function (z0, y0, z1, y1) { var L = Math.hypot(z1 - z0, y1 - y0), a = Math.atan2(y1 - y0, z1 - z0); var g = new THREE.BoxGeometry(0.66, 0.06, L); g.rotateX(-a); K.geo("fabric", g, 0, (y0 + y1) / 2, (z0 + z1) / 2); [-1, 1].forEach(function (sd) { var r = new THREE.BoxGeometry(0.035, 0.035, L + 0.04); r.rotateX(-a); K.geo("metal", r, sd * 0.35, (y0 + y1) / 2 - 0.03, (z0 + z1) / 2); }); };
    seg(-0.95, 0.78, -0.25, 0.42); seg(-0.25, 0.42, 0.4, 0.5); seg(0.4, 0.5, 0.95, 0.66); K.box("fabric", 0.36, 0.12, 0.22, 0, 0.84, -0.84, 0, 0.5);
    [-1, 1].forEach(function (sd) { K.beam("metal", new THREE.Vector3(sd * 0.35, 0, -0.7), new THREE.Vector3(sd * 0.35, 0.47, 0.1), 0.035, 0.035, new THREE.Vector3(1, 0, 0)); K.beam("metal", new THREE.Vector3(sd * 0.35, 0, 0.75), new THREE.Vector3(sd * 0.35, 0.47, -0.05), 0.035, 0.035, new THREE.Vector3(1, 0, 0)); }); }
  // a low dark-sky bollard: bronze post, a shielded head with a downward amber louvre
  function bollardKit(K) { K.cyl("metal", 0.065, 0.075, 0.62, 0, 0.31, 0, 12); K.cyl("lens", 0.07, 0.07, 0.07, 0, 0.6, 0, 12); K.cyl("metal", 0.1, 0.085, 0.05, 0, 0.665, 0, 12); }
  // ───────────────────────── the exterior, instanced: one draw per part and material for all fourteen ─────────────────────────
  var EX = SG.ex = SG.old ? { meshes: [], lights: [] } : (SG.ex || { meshes: [], lights: [] });
  var _M = new THREE.Matrix4(), _M2 = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _P = new THREE.Vector3(), _S1 = new THREE.Vector3(1, 1, 1), _Y = new THREE.Vector3(0, 1, 0), _ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  function pyrMatrix(P, out) { _Q.setFromAxisAngle(_Y, P.rot); return (out || new THREE.Matrix4()).compose(_P.set(P.x, P.D, P.z), _Q, _S1); }
  function localMatrix(P, lx, ly, lz, ry, out) { pyrMatrix(P, _M2); _Q.setFromAxisAngle(_Y, ry || 0); _M.compose(_P.set(lx, ly, lz), _Q, _S1); return (out || new THREE.Matrix4()).multiplyMatrices(_M2, _M); }
  function instMesh(geo, mat, n, name, shadow) { var m = new THREE.InstancedMesh(geo, mat, n); m.name = "sg " + name; m.castShadow = !!shadow; m.receiveShadow = !mat.transparent; m.userData.shSet = true; m.userData.sg = true; EX.meshes.push(m); return m; }
  function finish(m) { m.instanceMatrix.needsUpdate = true; try { m.computeBoundingSphere(); m.computeBoundingBox(); } catch (e) {} return m; }
  var SHADOW = { deck: 1, timber: 1, post: 1, metal: 1, concrete: 1, cushion: 1, fabric: 1 };
  function buildExterior(S) {
    var Mt = mats(), g = new THREE.Group(); g.name = "stargaze_exterior"; g.userData.noCull = true; EX.g = g; EX.size = {};
    for (var k in S.sizes) { var sz = S.sizes[k], list = S.pyr.filter(function (P) { return P.sz === sz; }); if (!list.length) continue; var E = EX.size[k] = { list: list };
      var K = new Kit(); deckKit(K, sz, S.deckH); shellKit(K, sz); var geos = K.geos();
      for (var mk in geos) { var im = instMesh(geos[mk], Mt[mk], list.length, k + ":" + mk, SHADOW[mk]); list.forEach(function (P, i) { im.setMatrixAt(i, pyrMatrix(P)); }); g.add(finish(im)); }
      // smart glass: the frosted and the clear sheet (each pyramid shows in one of them, or both while switching)
      var gf = glassGeo(sz), gc = gf.clone(); var aF = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3), aC = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3); gf.setAttribute("aI", aF); gc.setAttribute("aI", aC);
      E.frost = instMesh(gf, Mt.frost, list.length, k + ":frost", false); E.clear = instMesh(gc, Mt.clear, list.length, k + ":clear", false); E.frost.renderOrder = 1; E.clear.renderOrder = 3; E.aF = aF; E.aC = aC;
      list.forEach(function (P, i) { P.ei = i; P.E = E; var m = pyrMatrix(P); E.frost.setMatrixAt(i, m); E.clear.setMatrixAt(i, m); }); g.add(finish(E.frost)); g.add(finish(E.clear));
      // closed door leaves (the open pyramids get a real, moving leaf instead)
      var LK = new Kit(); leafKit(LK); var lg = LK.geos(); E.leaf = [];
      for (var lk in lg) { var lm = instMesh(lg[lk], Mt[lk], list.length, k + ":leaf:" + lk, lk === "metal"); list.forEach(function (P, i) { lm.setMatrixAt(i, P.open ? _ZERO : localMatrix(P, -DOOR.leafW / 2, 0, sz.half + 0.0, 0)); }); g.add(finish(lm)); E.leaf.push(lm); } E.leafGeos = lg;
      // the light on each deck after dark
      var dg = new THREE.PlaneGeometry(sz.W, sz.zf - sz.zb); dg.rotateX(-PI / 2); dg.translate(0, 0.014, (sz.zb + sz.zf) / 2); var dm = Mt.deckGlow[k] = new THREE.MeshBasicMaterial({ map: deckGlowTex(k, sz.W, sz.zf - sz.zb, sz.half, sz.zb), color: hex(C("light.glowColor", "#ffd39a"), "#ffd39a"), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      E.glow = instMesh(dg, dm, list.length, k + ":deckglow", false); E.glow.renderOrder = 2; list.forEach(function (P, i) { E.glow.setMatrixAt(i, pyrMatrix(P)); }); g.add(finish(E.glow));
    }
    // hot tubs, water, fire tables, fires, chairs and their light pools: shared by both sizes
    var n = S.pyr.length, TK = new Kit(); tubKit(TK); var tg = TK.geos(); EX.tub = [];
    for (var tk in tg) { var tm = instMesh(tg[tk], Mt[tk], n, "tub:" + tk, tk === "timber"); S.pyr.forEach(function (P, i) { tm.setMatrixAt(i, localMatrix(P, P.sz.tub[0], 0, P.sz.tub[1], 0)); }); g.add(finish(tm)); EX.tub.push(tm); }
    var wg = new THREE.CircleGeometry(0.985, 40); wg.rotateX(-PI / 2); EX.water = instMesh(wg, Mt.water, n, "water", false); S.pyr.forEach(function (P, i) { EX.water.setMatrixAt(i, localMatrix(P, P.sz.tub[0], 0.42, P.sz.tub[1], 0)); }); g.add(finish(EX.water));
    var FK = new Kit(); fireKit(FK); var fg = FK.geos(); for (var fk in fg) { var fm = instMesh(fg[fk], Mt[fk], n, "fire:" + fk, fk === "concrete"); S.pyr.forEach(function (P, i) { fm.setMatrixAt(i, localMatrix(P, P.sz.fire[0], 0, P.sz.fire[1], 0)); }); g.add(finish(fm)); }
    var cards = (function () { var a = new THREE.PlaneGeometry(0.78, 0.62), b = a.clone(); b.rotateY(PI / 2); var m = mergeGeos([toNonIndexed(a), toNonIndexed(b)]); m.translate(0, 0.34 + 0.31, 0); return m; })();
    EX.fire = instMesh(cards, Mt.fire, n, "flames", false); EX.fire.renderOrder = 4; S.pyr.forEach(function (P, i) { EX.fire.setMatrixAt(i, localMatrix(P, P.sz.fire[0], 0, P.sz.fire[1], 0)); }); g.add(finish(EX.fire));
    var CK = new Kit(); chairKit(CK); var cg = CK.geos(); EX.chairs = []; var chairAt = function (P, sd) { var f = P.sz.fire, x = f[0] + sd * 1.0, z = f[1] + 0.78; return [x, z, Math.atan2(f[0] - x, f[1] - z)]; };
    for (var ck in cg) { var cm = instMesh(cg[ck], Mt[ck], n * 2, "chair:" + ck, true); S.pyr.forEach(function (P, i) { [-1, 1].forEach(function (sd, j) { var c = chairAt(P, sd); cm.setMatrixAt(i * 2 + j, localMatrix(P, c[0], 0, c[1], c[2])); }); }); g.add(finish(cm)); EX.chairs.push(cm); }
    EX.chairAt = chairAt;
    EX.lounAt = function (P) { var z = P.sz; return [z.tub[0] + 1.05, z.zf - 0.85, PI / 2]; };
    var LK2 = new Kit(); loungerKit(LK2); var lg2 = LK2.geos(); EX.loungers = [];
    for (var lk2 in lg2) { var lm2 = instMesh(lg2[lk2], Mt[lk2], n, "deck lounger:" + lk2, true); S.pyr.forEach(function (P, i) { var a = EX.lounAt(P); lm2.setMatrixAt(i, localMatrix(P, a[0], 0.02, a[1], a[2])); }); g.add(finish(lm2)); EX.loungers.push(lm2); }
    var pl = function (size) { var q = new THREE.PlaneGeometry(size, size); q.rotateX(-PI / 2); return q; };
    EX.gTub = instMesh(pl(3.6), Mt.glowBlue, n, "glow:tub", false); EX.gFire = instMesh(pl(3.4), Mt.glowFire, n, "glow:fire", false); EX.gTub.renderOrder = EX.gFire.renderOrder = 2;
    S.pyr.forEach(function (P, i) { EX.gTub.setMatrixAt(i, localMatrix(P, P.sz.tub[0], 0.016, P.sz.tub[1], 0)); EX.gFire.setMatrixAt(i, localMatrix(P, P.sz.fire[0], 0.018, P.sz.fire[1], 0)); }); g.add(finish(EX.gTub)); g.add(finish(EX.gFire));
    // the pooled lights: a warm spill in front of every door, the tub's LEDs, the fire (the client shows the nearest few)
    var LG = new THREE.Group(); LG.name = "stargaze_lights"; g.add(LG);
    S.pyr.forEach(function (P) { var a = function (col, k, d, lx, ly, lz, tag) { var w = l2w(P, lx, lz); var l = new THREE.PointLight(col, 0, d, 1.6); l.position.set(w[0], P.D + ly, w[1]); l.userData.k0 = k; l.userData.tag = tag; l.userData.P = P; LG.add(l); EX.lights.push(l); return l; };
      P.lDoor = a(hex(C("light.glowColor", "#ffd39a"), "#ffd39a"), 1.5, 10, 0, 1.4, P.sz.half + 1.4, "door"); P.lTub = a(hex(C("light.tubColor", "#38c8ff"), "#38c8ff"), 0.7, 4.5, P.sz.tub[0], 0.75, P.sz.tub[1], "tub"); P.lFire = a(0xff8a3a, 1.2, 6.5, P.sz.fire[0], 0.8, P.sz.fire[1], "fire"); });
    scene.add(g); setGlass(true); SG.n.exteriorMeshes = EX.meshes.length;
    return g;
  }
  // the glass state of every pyramid: frosted and clear alphas with the per-pyramid glow (P.frostT eases toward P.frost)
  function setGlass(all) {
    for (var k in EX.size) { var E = EX.size[k]; var aF = E.aF.array, aC = E.aC.array, ch = false;
      E.list.forEach(function (P, i) { var f = P.frostT, glow = P.glow * (P.lit === false ? 0.15 : 1); var fa = f, ca = 1 - f; if (aF[i * 3] !== fa || aC[i * 3] !== ca || aF[i * 3 + 1] !== glow || all) { aF[i * 3] = fa; aF[i * 3 + 1] = glow; aF[i * 3 + 2] = (P.i * 0.618) % 1; aC[i * 3] = ca; aC[i * 3 + 1] = glow; aC[i * 3 + 2] = aF[i * 3 + 2]; ch = true;
          // a sheet that is fully off is moved out (no draw, no shadow); the frosted one comes back whenever it shows
          E.frost.setMatrixAt(i, fa < 0.01 ? _ZERO : pyrMatrix(P)); E.clear.setMatrixAt(i, ca < 0.01 ? _ZERO : pyrMatrix(P)); E.frost.instanceMatrix.needsUpdate = E.clear.instanceMatrix.needsUpdate = true; } });
      if (ch) { E.aF.needsUpdate = true; E.aC.needsUpdate = true; } }
  }
  // bollards along every path (alternating sides), with a soft amber pool on the ground
  function buildBollards(S) {
    var Mt = mats(), pts = [], sp = C("light.bollardSpacing", 8.5);
    S.paths.forEach(function (p, pi) { var acc = sp * 0.5, side = pi % 2 ? 1 : -1; for (var i = 0; i < p.pts.length - 1; i++) { var a = p.pts[i], b = p.pts[i + 1]; var L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!L) continue; var dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L; var t = 0; while (acc + (L - t) >= sp) { t += sp - acc; acc = 0; var x = a[0] + dx * t - dz * side * (p.w / 2 + 0.45), z = a[1] + dz * t + dx * side * (p.w / 2 + 0.45); side = -side; if (!inFootprint(S, x, z, false)) pts.push([x, z]); } acc += L - t; } });
    // the terrace and the theatre get a few as well (low, so the sky stays dark)
    [[S.terr, S.terr.r + 0.6, 6], [S.amph, S.amph.tiers[S.amph.tiers.length - 1] + 0.9, 7]].forEach(function (d) { for (var a = 0; a < d[2]; a++) { var an = (a + 0.5) / d[2] * TAU; pts.push([d[0].x + Math.sin(an) * d[1], d[0].z + Math.cos(an) * d[1]]); } });
    var K = new Kit(); bollardKit(K); var bg = K.geos(), g = EX.g; EX.bollards = [];
    for (var k in bg) { var m = instMesh(bg[k], Mt[k], pts.length, "bollard:" + k, k === "metal"); pts.forEach(function (p, i) { var y = planGroundAt(p[0], p[1]); m.setMatrixAt(i, _M.compose(_P.set(p[0], y - 0.02, p[1]), _Q.identity(), _S1)); }); g.add(finish(m)); EX.bollards.push(m); }
    var q = new THREE.PlaneGeometry(2.0, 2.0); q.rotateX(-PI / 2); EX.gBol = instMesh(q, Mt.glowAmber, pts.length, "glow:bollard", false); EX.gBol.renderOrder = 2; pts.forEach(function (p, i) { EX.gBol.setMatrixAt(i, _M.compose(_P.set(p[0], planGroundAt(p[0], p[1]) + 0.05, p[1]), _Q.identity(), _S1)); }); g.add(finish(EX.gBol));
    S.bollards = pts; SG.n.bollards = pts.length;
  }
  // ───────────────────────── the Solport Dark Sky Observatory: drum, dome with a two part shutter, the telescope, red-lit inside ─────────────────────────
  var OB = SG.ob = SG.old ? {} : (SG.ob || {});
  // the dome as a sphere parametrised round its x axis: x across the slit, psi from the +z horizon (0) over the top to -z (PI);
  // the slit (|x| < s, psi < psiEnd) is then an exact rectangle in (x, psi), so its edges are crisp. keep(x, psi) chooses cells.
  function domeGeo(R, s, keep, nx, np) {
    var xs = [], ps = []; nx = nx || 40; np = np || 48; for (var i = 0; i <= nx; i++) xs.push(-R + 2 * R * i / nx); xs.push(-s, s, -s - 0.06, s + 0.06); xs = xs.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    for (var j = 0; j <= np; j++) ps.push(PI * j / np); [35, 100].forEach(function (d) { ps.push(d * PI / 180); }); ps = ps.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    var P = [], N = [], Uv = [], at = function (x, p) { var r = Math.sqrt(Math.max(0, R * R - x * x)); return [x, r * Math.sin(p), r * Math.cos(p)]; };
    for (var a = 0; a < xs.length - 1; a++) for (var b = 0; b < ps.length - 1; b++) { var xm = (xs[a] + xs[a + 1]) / 2, pm = (ps[b] + ps[b + 1]) / 2; if (!keep(xm, pm)) continue;
      var q = [at(xs[a], ps[b]), at(xs[a + 1], ps[b]), at(xs[a + 1], ps[b + 1]), at(xs[a], ps[b + 1])]; var idx = [0, 1, 2, 0, 2, 3];
      // wind outward
      var c0 = new THREE.Vector3().fromArray(q[0]), c1 = new THREE.Vector3().fromArray(q[1]), c2 = new THREE.Vector3().fromArray(q[2]); var cr = c1.clone().sub(c0).cross(c2.clone().sub(c0)); var mid = at(xm, pm); if (cr.dot(new THREE.Vector3().fromArray(mid)) < 0) idx = [0, 2, 1, 0, 3, 2];
      idx.forEach(function (k) { var v = q[k]; P.push(v[0], v[1], v[2]); var l = Math.hypot(v[0], v[1], v[2]) || 1; N.push(v[0] / l, v[1] / l, v[2] / l); Uv.push((v[0] + R) / (2 * R), v[1] / R); }); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(Uv, 2)); g.computeBoundingSphere(); return g;
  }
  function buildObservatory(S) {
    var Mt = mats(), O = S.obs, R = O.r, Rd = O.domeR, wallH = O.wallH, FL = 0.12, top = FL + wallH; var dir = [O.doorToward[0] - O.x, O.doorToward[1] - O.z]; var yaw = Math.atan2(dir[0], dir[1]);
    var g = new THREE.Group(); g.name = "stargaze_observatory"; g.position.set(O.x, O.G, O.z); g.rotation.y = yaw; g.userData.noCull = true; OB.g = g; OB.yaw = yaw; OB.FL = FL; OB.top = top; OB.R = R;
    var K = new Kit(), dA = 0.165;
    K.cyl("concrete", R + 0.4, R + 0.48, FL, 0, FL / 2, 0, 48);
    K.sector("stucco", 0, 0, R - 0.25, R, FL, top, dA, TAU - dA, 48, 1.5); K.sector("stucco", 0, 0, R - 0.25, R, FL + 2.5, top, -dA, dA, 4, 1.5);
    K.sector("metal", 0, 0, R - 0.32, R + 0.1, top, top + 0.18, 0, TAU, 48);
    K.sector("redLed", 0, 0, R - 0.27, R - 0.25, FL + 0.55, FL + 0.58, dA + 0.05, TAU - dA - 0.05, 40);   // the red guide strip round the wall inside
    K.flat("deck", -R + 0.3, -R + 0.3, R - 0.3, R - 0.3, FL + 0.005, true, 1.6); K.geo("obsIn", new THREE.CylinderGeometry(R - 0.27, R - 0.27, wallH, 48, 1, true, dA, TAU - 2 * dA), 0, FL + wallH / 2, 0);
    // the door: a steel frame and one leaf standing open into the room; a step and a porch
    K.box("metal", 0.12, 2.5, 0.3, -0.62, FL + 1.25, R - 0.1); K.box("metal", 0.12, 2.5, 0.3, 0.62, FL + 1.25, R - 0.1); K.box("metal", 1.36, 0.14, 0.3, 0, FL + 2.48, R - 0.1);
    K.box("metal", 1.12, 2.3, 0.05, -0.58 + 0.03, FL + 1.17, R - 0.75, PI / 2 - 0.15);
    K.box("concrete", 2.6, 0.12, 1.8, 0, 0.06, R + 1.2, 0, 1); K.box("cap", 1.6, 0.05, 0.6, 0, 0.145, R + 0.6, 0, 1);
    // inside: the pier, a curved desk with two dim red screens, the star chart, an observing step
    K.cyl("concrete", 0.46, 0.55, 1.35, 0, FL + 0.675, 0, 24);
    var deskA = PI * 0.62; K.sector("timber", 0, 0, R - 1.15, R - 0.35, FL, FL + 0.74, deskA - 0.32, deskA + 0.32, 10, 1); K.sector("black", 0, 0, R - 1.17, R - 0.33, FL + 0.74, FL + 0.78, deskA - 0.33, deskA + 0.33, 10);
    [-0.12, 0.12].forEach(function (o) { var a = deskA + o, rr = R - 0.6; K.box("black", 0.62, 0.42, 0.04, Math.sin(a) * rr, FL + 1.06, Math.cos(a) * rr, a + PI); K.box("screen", 0.56, 0.36, 0.01, Math.sin(a) * (rr - 0.03), FL + 1.06, Math.cos(a) * (rr - 0.03), a + PI); });
    var chA = -PI * 0.6, chr = R - 0.27; K.quad("chart", 1.7, 1.7, Math.sin(chA) * chr, FL + 1.75, Math.cos(chA) * chr, chA + PI);
    K.box("timber", 1.0, 0.36, 0.7, Math.sin(PI * 0.2) * 1.6, FL + 0.18, Math.cos(PI * 0.2) * 1.6, PI * 0.2, 1);
    var meshes = K.build(g, Mt); meshes.forEach(function (m) { m.userData.shSet = true; });
    // the dome turns (its own group); the upper shutter slides back over the top, the lower one drops outward
    var dome = new THREE.Group(); dome.position.y = top + 0.12; g.add(dome); OB.dome = dome; var s = 0.78;
    var dg = domeGeo(Rd, s, function (x, p) { return Math.abs(x) > s || p > 100 * PI / 180; });
    var dO = new THREE.Mesh(dg, Mt.domeM), dI = new THREE.Mesh(dg, Mt.domeIn); dO.castShadow = true; dO.receiveShadow = true; dO.userData.shSet = dI.userData.shSet = true; dome.add(dO, dI);
    // one shutter over the whole slit, sliding back over the top of the dome (it never hangs below the drum)
    var up = domeGeo(Rd + 0.06, s + 0.08, function (x, p) { return Math.abs(x) < s + 0.08 && p < 100 * PI / 180; }, 8, 56);
    OB.up = new THREE.Mesh(up, Mt.domeM); OB.up.castShadow = true; OB.up.userData.shSet = true; dome.add(OB.up); var upI = new THREE.Mesh(up, Mt.domeIn); OB.up.add(upI);
    // the telescope: fork mount turning with the dome, a white tube on the altitude axis aimed out of the slit
    var mount = new THREE.Group(); mount.position.y = FL + 1.35; g.add(mount); OB.mount = mount; var TKt = new Kit();
    TKt.cyl("white", 0.5, 0.55, 0.16, 0, 0.08, 0, 28); TKt.box("white", 0.14, 1.1, 0.34, -0.55, 0.65, 0); TKt.box("white", 0.14, 1.1, 0.34, 0.55, 0.65, 0); TKt.box("white", 1.25, 0.14, 0.4, 0, 0.18, 0); TKt.build(mount, Mt);
    var tube = new THREE.Group(); tube.position.y = 1.05; mount.add(tube); OB.tube = tube; var TT = new Kit();
    TT.cyl("white", 0.33, 0.33, 2.9, 0, 0.35, 0, 32, false); TT.cyl("black", 0.355, 0.355, 0.5, 0, 1.75, 0, 32, true); TT.cyl("black", 0.345, 0.345, 0.12, 0, -1.05, 0, 32); TT.cyl("metal", 0.07, 0.07, 0.55, 0.36, -0.2, 0.18, 12); TT.cyl("brass", 0.04, 0.04, 0.14, 0.32, -1.05, 0.0, 10, false, 0, 0, PI / 2);
    TT.cyl("metal", 0.085, 0.085, 0.65, 0.0, 0.2, 0.42, 14); TT.box("metal", 0.08, 0.12, 0.14, 0, 0.2, 0.34); TT.build(tube, Mt);
    // a dim red light inside, and the red pool at the door after dark
    OB.light = new THREE.PointLight(hex(C("light.domeRed", "#ff3a2a"), "#ff3a2a"), 0, 9, 1.4); OB.light.position.set(0, FL + 2.6, 0); OB.light.userData.k0 = 0.9; g.add(OB.light);
    var gq = new THREE.PlaneGeometry(3.2, 3.2); gq.rotateX(-PI / 2); OB.doorGlow = new THREE.Mesh(gq, Mt.glowRed); OB.doorGlow.position.set(0, 0.16, R + 1.0); OB.doorGlow.renderOrder = 2; g.add(OB.doorGlow);
    scene.add(g); g.updateMatrixWorld(true);
    // solids: the drum wall round the door, the plinth floor, the pier and telescope, the desk; the wall segments have a gap at the door
    var W = function (lx, lz) { var c = Math.cos(yaw), sn = Math.sin(yaw); return [O.x + lx * c + lz * sn, O.z - lx * sn + lz * c]; };
    var nS = 40; for (var i = 0; i < nS; i++) { var a = (i + 0.5) / nS * TAU; if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.12) continue; var p = W(Math.sin(a) * (R - 0.12), Math.cos(a) * (R - 0.12)); var sd = addSolid(p[0], p[1], yaw + a, TAU * R / nS + 0.1, 0.3, O.G, O.G + top + 0.2, "stargaze"); if (sd) SG.sol.push(sd); }
    [0, PI / 2].forEach(function (r0) { var sd = addSolid(O.x, O.z, yaw + r0, 2 * (R - 0.3), 4.6, O.G - 0.5, O.G + FL, "stargaze"); if (sd) SG.sol.push(sd); });
    var sd2 = addSolid(O.x, O.z, yaw, 1.35, 1.35, O.G + FL, O.G + FL + 2.6, "stargaze"); if (sd2) SG.sol.push(sd2);
    var dp = W(Math.sin(deskA) * (R - 0.75), Math.cos(deskA) * (R - 0.75)); var sd3 = addSolid(dp[0], dp[1], yaw + deskA, 2.4, 0.8, O.G + FL, O.G + FL + 0.78, "stargaze"); if (sd3) SG.sol.push(sd3);
    var stp = W(Math.sin(PI * 0.2) * 1.6, Math.cos(PI * 0.2) * 1.6); var sd4 = addSolid(stp[0], stp[1], yaw + PI * 0.2, 1.0, 0.7, O.G + FL, O.G + FL + 0.36, "stargaze"); if (sd4) SG.sol.push(sd4);
    // the eyepiece (E: the telescope) and the room the camera keeps to
    var ep = W(0.0, -0.9); OB.eye = { x: ep[0], z: ep[1], y: O.G + FL, r: 1.9 }; OB.shut = 0; OB.az = 0; OB.alt = 0.9;
    return g;
  }
  // ───────────────────────── the Star Theatre: stone tiers round a fire pit lounge, open toward the dome ─────────────────────────
  var AM = SG.am = SG.old ? {} : (SG.am || {});
  function buildTheatre(S) {
    var Mt = mats(), A = S.amph, yaw = Math.atan2(A.toward[0] - A.x, A.toward[1] - A.z), arc = (A.arc || 230) * PI / 180, a0 = PI - arc / 2, a1 = PI + arc / 2;
    var g = new THREE.Group(); g.name = "stargaze_theatre"; g.position.set(A.x, A.G, A.z); g.rotation.y = yaw; g.userData.noCull = true; AM.g = g; AM.yaw = yaw;
    var K = new Kit(), rise = 0.42;
    A.tiers.forEach(function (r, i) { var y1 = rise * (i + 1); K.sector("stone", 0, 0, r, r + 1.45, 0, y1, a0, a1, 40, 1.2); K.sector("timber", 0, 0, r - 0.04, r + 0.52, y1, y1 + 0.05, a0, a1, 40, 0.8); });
    // the fire pit lounge in the middle: a stone ring, embers, four low chairs
    K.sector("stone", 0, 0, 0.62, 0.98, 0, 0.36, 0, TAU, 28, 0.8); K.cyl("beads", 0.62, 0.62, 0.03, 0, 0.2, 0, 24); var gd = new THREE.CircleGeometry(A.tiers[0] + 0.1, 40); gd.rotateX(-PI / 2); var gu = gd.attributes.uv; for (var ui = 0; ui < gu.count; ui++) gu.setXY(ui, gu.getX(ui) * 4, gu.getY(ui) * 4); K.geo("gravel", gd, 0, 0.02, 0);
    var CK = new Kit(); [0.5, 1.5, 2.5, 3.5].forEach(function (k) { var a = PI + (k - 2) * 0.62, x = Math.sin(a) * 2.3, z = Math.cos(a) * 2.3; chairKit(CK); var arr = CK.m; for (var key in arr) { var last = arr[key].splice(-arr[key].length); last.forEach(function (gm) { _e.set(0, Math.atan2(-x, -z), 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(x, 0, z), _q, _v2.set(1, 1, 1)); gm.applyMatrix4(_m4); (K.m[key] || (K.m[key] = [])).push(gm); }); } });
    // the lectern and a portable refractor on a tripod at the open side
    K.box("corten", 0.5, 1.05, 0.38, -1.4, 0.525, 4.2, PI); K.box("corten", 0.62, 0.04, 0.46, -1.4, 1.07, 4.16, PI, 0, -0.25);
    [0, 1, 2].forEach(function (k) { var a = k / 3 * TAU; K.beam("metal", new THREE.Vector3(1.5 + Math.sin(a) * 0.45, 0, 4.0 + Math.cos(a) * 0.45), new THREE.Vector3(1.5, 1.15, 4.0), 0.03, 0.03, new THREE.Vector3(0, 0, 1)); });
    var tb = new THREE.CylinderGeometry(0.075, 0.075, 1.1, 16); tb.rotateX(-0.9); K.geo("white", tb, 1.5, 1.38, 4.05); K.cyl("black", 0.09, 0.09, 0.16, 1.5, 1.38 + Math.cos(0.9) * 0.55, 4.05 - Math.sin(0.9) * 0.55, 16, false, 0, -0.9);
    K.build(g, Mt).forEach(function (m) { m.userData.shSet = true; });
    var f = new THREE.Mesh((function () { var a = new THREE.PlaneGeometry(1.25, 1.1), b = a.clone(); b.rotateY(PI / 2); var m = mergeGeos([toNonIndexed(a), toNonIndexed(b)]); m.translate(0, 0.2 + 0.55, 0); return m; })(), Mt.fire); f.renderOrder = 4; g.add(f); AM.fire = f;
    var gq = new THREE.PlaneGeometry(6, 6); gq.rotateX(-PI / 2); var gm = new THREE.Mesh(gq, Mt.glowFire); gm.position.y = 0.03; gm.renderOrder = 2; g.add(gm);
    AM.light = new THREE.PointLight(0xff8a3a, 0, 11, 1.5); AM.light.position.set(0, 1.0, 0); AM.light.userData.k0 = 1.6; g.add(AM.light);
    scene.add(g); g.updateMatrixWorld(true);
    var W = function (lx, lz) { var c = Math.cos(yaw), sn = Math.sin(yaw); return [A.x + lx * c + lz * sn, A.z - lx * sn + lz * c]; }; AM.W = W;
    // tiers you can climb, seats along each front edge facing the fire, the fire ring, the lounge chairs as seats
    A.tiers.forEach(function (r, i) { var y1 = A.G + rise * (i + 1), rm = r + 0.72, n = Math.ceil((a1 - a0) * rm / 1.3); for (var k = 0; k < n; k++) { var a = a0 + (k + 0.5) / n * (a1 - a0); var p = W(Math.sin(a) * rm, Math.cos(a) * rm); var sd = addSolid(p[0], p[1], yaw + a, (a1 - a0) * rm / n + 0.08, 1.45, A.G - 0.4, y1, "stargaze"); if (sd) SG.sol.push(sd); }
      var rs = r + 0.3, ns = Math.floor((a1 - a0) * rs / 1.15); for (var j = 0; j < ns; j++) { var b = a0 + (j + 0.5) / ns * (a1 - a0); var q = W(Math.sin(b) * rs, Math.cos(b) * rs); var st = addSolid(q[0], q[1], yaw + b, 0.5, 0.5, y1 - 0.42, y1 + 0.02, "stargaze"); if (st) { st.seat = true; st.face = yaw + b + PI; SG.sol.push(st); } } });
    var fr = addSolid(A.x, A.z, yaw, 1.7, 1.7, A.G, A.G + 0.62, "stargaze"); if (fr) SG.sol.push(fr);
    [0.5, 1.5, 2.5, 3.5].forEach(function (k) { var a = PI + (k - 2) * 0.62, p = W(Math.sin(a) * 2.3, Math.cos(a) * 2.3); var st = addSolid(p[0], p[1], yaw + a, 0.7, 0.7, A.G, A.G + 0.42, "stargaze"); if (st) { st.seat = true; st.face = yaw + a + PI; SG.sol.push(st); } });
    AM.speaker = W(-0.2, 3.6);
    return g;
  }
  // ───────────────────────── the Stargazing Terrace: a gravel disc, a stone kerb, a bronze compass rose, a ring of loungers ─────────────────────────
  var TR = SG.tr = SG.old ? {} : (SG.tr || {});
  function buildTerrace(S) {
    var Mt = mats(), T0 = S.terr, g = new THREE.Group(); g.name = "stargaze_terrace"; g.position.set(T0.x, T0.G, T0.z); g.userData.noCull = true; TR.g = g;
    var K = new Kit(); var disc = new THREE.CircleGeometry(T0.r, 48); disc.rotateX(-PI / 2); var uv = disc.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * T0.r / 1.5, uv.getY(i) * T0.r / 1.5); K.geo("gravel", disc, 0, 0.03, 0);
    K.sector("stone", 0, 0, T0.r, T0.r + 0.28, -0.1, 0.12, 0, TAU, 64, 0.8); K.cyl("stone", 1.55, 1.6, 0.1, 0, 0.05, 0, 40);
    K.build(g, Mt).forEach(function (m) { m.userData.shSet = true; m.castShadow = false; });
    var rose = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), Mt.rose); rose.rotation.x = -PI / 2; rose.position.y = 0.106; g.add(rose);   // N up the texture = world north (-z)
    var LK = new Kit(); loungerKit(LK); var lg = LK.geos(), n = T0.loungers || 10; TR.spots = [];
    for (var k in lg) { var m = instMesh(lg[k], Mt[k], n, "lounger:" + k, true); for (var j = 0; j < n; j++) { var a = (j + 0.5) / n * TAU; m.setMatrixAt(j, _M.compose(_P.set(Math.sin(a) * 4.7, 0.04, Math.cos(a) * 4.7), _Q.setFromAxisAngle(_Y, a), _S1)); } finish(m); g.add(m); }
    for (var q = 0; q < n; q++) { var an = (q + 0.5) / n * TAU; var hx = Math.sin(an) * (4.7 - 0.85), hz = Math.cos(an) * (4.7 - 0.85); TR.spots.push({ kind: "lounger", x: T0.x + hx, z: T0.z + hz, y: T0.G + 0.04 + 0.95, yaw: an, fx: T0.x + Math.sin(an) * 4.7, fz: T0.z + Math.cos(an) * 4.7 });
      var sx = T0.x + Math.sin(an) * 4.7, sz2 = T0.z + Math.cos(an) * 4.7; var sd = addSolid(sx, sz2, an, 0.72, 1.9, T0.G, T0.G + 0.55, "stargaze"); if (sd) SG.sol.push(sd); }
    scene.add(g); return g;
  }
  // ───────────────────────── the cart park dressing and the welcome sign ─────────────────────────
  function lotPuts(S) { var L = S.lot, lr = L.rot * PI / 180, c = Math.cos(lr), s = Math.sin(lr); var W = function (lx, lz) { return [L.x + lx * c + lz * s, L.z - lx * s + lz * c]; }; var n = L.bays || 6, bw = L.w / n, R = rng(77); S.lotBays = [];
    for (var i = 0; i < n; i++) { var lx = -L.w / 2 + bw * (i + 0.5); S.lotBays.push(W(lx, L.d / 2 - 0.7)); }
    var carts = Math.min(L.carts || 0, n), used = {}; for (var k = 0; k < carts; k++) { var b = [0, 2, 3, 1, 4][k] % n; used[b] = 1; var p = W(-L.w / 2 + bw * (b + 0.5) + (R() - 0.5) * 0.3, L.d / 2 - 2.6); if (canPut("cart")) put("cart", p[0], p[1], lr + PI + (R() - 0.5) * 0.08, 1); }
    if (L.rover && canPut("rover")) { var p2 = W(-L.w / 2 + bw * (n - 0.5), L.d / 2 - 3.0); put("rover", p2[0], p2[1], lr + PI, 1); } }
  function buildLotAndSign(S) {
    var Mt = mats(), g = new THREE.Group(); g.name = "stargaze_lot"; g.userData.noCull = true; var K = new Kit(); var L = S.lot, lr = L.rot * PI / 180;
    (S.lotBays || []).forEach(function (p) { var y = planGroundAt(p[0], p[1]); K.box("timber", 1.7, 0.12, 0.22, p[0], y + 0.06, p[1], lr, 1); });
    var sg = S.sign, sr = (sg.rot || 0) * PI / 180, sy = planGroundAt(sg.x, sg.z);
    var sgG = new THREE.Group(); sgG.position.set(sg.x, sy, sg.z); sgG.rotation.y = sr; g.add(sgG); var SK = new Kit();
    SK.box("stone", 3.6, 0.55, 0.8, 0, 0.27, 0, 0, 1); SK.box("corten", 3.2, 1.35, 0.1, 0, 1.22, 0, 0, 1); SK.box("metal", 3.3, 0.06, 0.16, 0, 1.93, 0, 0);
    SK.build(sgG, Mt).forEach(function (m) { m.userData.shSet = true; });
    [1, -1].forEach(function (sd) { var q = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.125), Mt.sign); q.position.set(0, 1.22, sd * 0.056); q.rotation.y = sd > 0 ? 0 : PI; q.renderOrder = 2; sgG.add(q); });
    var gq = new THREE.PlaneGeometry(4.4, 4.4); gq.rotateX(-PI / 2); var gw = new THREE.Mesh(gq, Mt.glowWarm); gw.position.set(0, 0.04, 0); gw.renderOrder = 2; sgG.add(gw);
    var ss = addSolid(sg.x, sg.z, sr, 3.6, 0.8, sy - 0.2, sy + 1.95, "stargaze"); if (ss) SG.sol.push(ss);
    K.build(g, Mt); scene.add(g); SG.lotG = g; return g;
  }
  // ───────────────────────── solids and seats of every deck and pyramid ─────────────────────────
  SG.sol = SG.old ? [] : (SG.sol || []);
  function pSolid(P, lx, lz, w, d, y0, y1, ry) { var p = l2w(P, lx, lz); var sd = addSolid(p[0], p[1], P.rot + (ry || 0), w, d, y0, y1, "stargaze"); if (sd) SG.sol.push(sd); return sd; }
  function pyramidSolids(P, dH) {
    var z = P.sz, D = P.D, W = z.W, zb = z.zb, zf = z.zf, sx = z.stepsX, half = z.half, rise = dH / 5, i = 0.62, hi = half - i;
    pSolid(P, 0, (zb + zf) / 2, W, zf - zb, D - 0.5, D);
    for (var s = 1; s <= 4; s++) pSolid(P, sx, zf + 0.3 * (s - 0.5), 1.42, 0.32, D - dH - 0.3, D - rise * s);
    var rh = D + 1.05; pSolid(P, 0, zb + 0.03, W, 0.12, D, rh); pSolid(P, -W / 2 + 0.03, (zb + zf) / 2, 0.12, zf - zb, D, rh); pSolid(P, W / 2 - 0.03, (zb + zf) / 2, 0.12, zf - zb, D, rh);
    var g0 = sx - 0.78, g1 = sx + 0.78; pSolid(P, (-W / 2 + g0) / 2, zf - 0.03, g0 + W / 2, 0.12, D, rh); pSolid(P, (g1 + W / 2) / 2, zf - 0.03, W / 2 - g1, 0.12, D, rh);
    [-1, 1].forEach(function (sd) { pSolid(P, sx + sd * 0.76, zf + 0.62, 0.1, 1.3, D - dH, D + 1.0); });
    // the glass walls, kept in where the slope would meet your head; the dormer's cheeks; the door (open pyramids lift it when open)
    pSolid(P, 0, -hi, 2 * hi + 0.2, 0.2, D, D + 2.6); pSolid(P, -hi, 0, 0.2, 2 * hi, D, D + 2.6); pSolid(P, hi, 0, 0.2, 2 * hi, D, D + 2.6);
    pSolid(P, (-hi - 0.62) / 2, hi, hi - 0.62, 0.2, D, D + 2.6); pSolid(P, (hi + 0.62) / 2, hi, hi - 0.62, 0.2, D, D + 2.6);
    [-1, 1].forEach(function (sd) { pSolid(P, sd * 0.66, (hi + half) / 2, 0.12, half - hi + 0.1, D, D + 2.6); });
    P.doorSolid = pSolid(P, 0, half - 0.06, 1.2, 0.16, D, D + 2.4);
    // the tub (you cannot wade in; E sits you in the water), the fire table, the two chairs by the fire
    pSolid(P, z.tub[0], z.tub[1], 2.15, 2.15, D, D + 0.66);
    [0, 1, 2, 3].forEach(function (k) { var a = k * PI / 2 + PI / 4, sx2 = z.tub[0] + Math.sin(a) * 0.58, sz2 = z.tub[1] + Math.cos(a) * 0.58; var ts = pSolid(P, sx2, sz2, 0.5, 0.5, D - 0.3, D + 0.14); if (ts) { ts.seat = true; ts.face = P.rot + a + PI; ts.tub = true; } });
    pSolid(P, z.fire[0], z.fire[1], 1.1, 1.1, D, D + 0.65);
    [-1, 1].forEach(function (sd) { var c = EX.chairAt(P, sd); var st = pSolid(P, c[0], c[1], 0.72, 0.72, D, D + 0.43, c[2]); if (st) { st.seat = true; st.face = P.rot + c[2]; } });
    var la = EX.lounAt(P); pSolid(P, la[0], la[1], 1.9, 0.72, D, D + 0.5, 0); var hw = l2w(P, la[0] - 0.85, la[1]), fw = l2w(P, la[0] + 0.95, la[1]); P.lounger = { kind: "lounger", P: P, x: hw[0], z: hw[1], y: D + 0.97, yaw: P.rot + PI / 2, fx: fw[0], fz: fw[1], deck: true };
  }
  function doorSolidOn(P, on) { var sd = P.doorSolid; if (!sd) return; var i = SOLIDS.indexOf(sd); if (on && i < 0) SOLIDS.push(sd); else if (!on && i >= 0) SOLIDS.splice(i, 1); }
  // the pyramid a point is inside (feet on its floor), or null
  function pyramidAt(x, z, y) { var S = SITE; if (!S) return null; for (var i = 0; i < S.pyr.length; i++) { var P = S.pyr[i]; if (Math.abs(x - P.x) > 7 || Math.abs(z - P.z) > 7) continue; var q = w2l(P, x, z); if (Math.abs(q[0]) < P.sz.half - 0.05 && Math.abs(q[1]) < P.sz.half - 0.05 && Math.abs(y - P.D) < 1.6) return P; } return null; }

  // ───────────────────────── the walk-in interior (the Model Pyramid and any pyramid marked open), built near, disposed far ─────────────────────────
  var IN = SG.in = SG.old ? { active: null, sb: null } : (SG.in || { active: null, sb: null });
  var R_STAGE = 70, R_BUILD = 40, R_DROP = 95;
  function intMats() { var Mt = mats(); if (Mt.oak) return Mt; var wm = woodMap();
    Mt.oak = std({ map: grainTex("oak", "#b88d5f", "rgba(236,204,160,A)", "rgba(92,60,30,A)", 29, 6), color: 0xffffff, roughness: 0.48 }); Mt.walnut = std({ map: grainTex("walnut", "#4b3324", "rgba(150,110,75,A)", "rgba(22,12,6,A)", 17, 1), color: 0xffffff, roughness: 0.42 }); Mt.linen = std({ map: fabricTex(), color: 0xf5f1e8, roughness: 0.92 }); Mt.throw = std({ map: fabricTex(), color: 0x8a6f4e, roughness: 0.95 });
    Mt.sofa = std({ map: weaveTex("boucle", "#e2d9c8", "#d2c7b3"), color: 0xffffff, roughness: 0.97 }); Mt.leather = std({ color: 0x6b4128, roughness: 0.6 }); Mt.marble = std({ map: marbleTex(), color: 0xffffff, roughness: 0.22 }); Mt.basalt = std({ color: 0x2a2a2c, roughness: 0.55 });
    Mt.frostPane = std({ color: 0x9aa4a2, roughness: 0.35, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }); Mt.chrome = std({ color: 0xdadde0, roughness: 0.12, metalness: 1 }); Mt.inox = std({ color: 0xb9bcbf, roughness: 0.3, metalness: 0.9 });
    Mt.lamp = std({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 1.2 }); Mt.ledStrip = std({ color: 0x2a2015, emissive: 0xffc27a, emissiveIntensity: 1.4 }); Mt.ember = std({ color: 0x220a02, emissive: 0xff5a14, emissiveIntensity: 1.6 });
    Mt.rug = std({ map: weaveTex("rug", "#b9a588", "#8f7a5e"), color: 0xffffff, roughness: 1 }); Mt.leaf = std({ color: 0x4f6a3a, roughness: 0.8 }); Mt.pot = std({ color: 0x9a6a48, roughness: 0.9 }); Mt.glassB = std({ color: 0xcfe0e6, roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false });
    IN.ao = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1); IN.ao.needsUpdate = true; IN.aoV = 200;
    ["oak", "walnut", "linen", "throw", "sofa", "leather", "marble", "basalt", "rug", "leaf", "pot", "inox"].forEach(function (k) { Mt[k].aoMap = IN.ao; Mt[k].aoMapIntensity = 1; });
    for (var k in Mt) { var m = Mt[k]; if (m && m.isMaterial && !m.name) m.name = "sg_" + k; } return Mt; }
  function aoFrame(n) { if (!IN.ao) return; var v = Math.round(255 * lerp(0.82, 0.28, n)); if (Math.abs(v - IN.aoV) < 4) return; IN.aoV = v; IN.ao.image.data[0] = IN.ao.image.data[1] = IN.ao.image.data[2] = v; IN.ao.needsUpdate = true; }
  function listOpen() { return SITE ? SITE.pyr.filter(function (P) { return P.open; }) : []; }
  // the layout of the large pyramid (half 4.31); a smaller open pyramid uses the same, drawn in by k
  function* buildSteps(P) {
    var Mt = intMats(), z = P.sz, half = z.half, Hh = z.H, kk = Math.min(1, half / 4.31); var g = new THREE.Group(); g.name = "stargaze_interior " + P.id; g.position.set(P.x, P.D, P.z); g.rotation.y = P.rot; g.userData.noCull = true; g.userData.interior = true;
    var L = { P: P, g: g, solids: [], lights: [], hots: [], recl: [], anim: [] }; var K = new Kit(); var X = function (v) { return v * kk; };
    var so = function (lx, lz, w, d, y0, y1, ry) { var sd = pSolid(P, lx, lz, w, d, P.D + y0, P.D + y1, ry); if (sd) L.solids.push(sd); return sd; };
    var seat = function (lx, lz, w, d, y, face) { var sd = so(lx, lz, w, d, y - 0.42, y); if (sd) { sd.seat = true; sd.face = P.rot + face; } return sd; };
    var light = function (col, k, dist, lx, ly, lz, flick) { k *= 4.2; dist *= 1.3; var l = new THREE.PointLight(col, 0, dist, 1.4); l.position.set(lx, ly, lz); l.userData.k0 = k; l.userData.flick = !!flick; g.add(l); L.lights.push(l); return l; };
    var hot = function (lx, ly, lz, r, kind, d) { var w = l2w(P, lx, lz); var o = { x: w[0], y: P.D + ly, z: w[1], r: r, kind: kind, d: d || {} }; L.hots.push(o); return o; };
    // the floor: wide oak boards inside the glass, a wool rug under the bed and one in the lounge
    K.flat("oak", -half + 0.06, -half + 0.06, half - 0.06, half - 0.06, 0.02, true, 1.2); K.flat("rug", X(-3.3), X(-3.6), X(-0.9), X(-0.7), 0.02, true, 1); K.flat("rug", X(-3.2), X(0.5), X(-0.4), X(2.9), 0.02, true, 1);
    yield 1;
    // ── the bed: head to the west glass, foot to the room, so you lie looking up through the apex ──
    var bx0 = X(-3.5), bx1 = X(-3.5) + 2.15, bz = X(-2.15);
    K.box("walnut", 2.2, 0.28, 2.06, (bx0 + bx1) / 2, 0.16, bz, 0, 1); K.box("linen", 2.1, 0.26, 2.0, (bx0 + bx1) / 2, 0.43, bz, 0, 1); K.box("throw", 0.62, 0.05, 2.04, bx1 - 0.42, 0.585, bz, 0, 1);
    K.box("sofa", 0.12, 1.0, 2.1, bx0 - 0.04, 0.55, bz, 0, 1); [-0.5, 0.5].forEach(function (o) { var pg = new THREE.BoxGeometry(0.42, 0.14, 0.7); pg.rotateZ(0.35); K.geo("linen", pg, bx0 + 0.3, 0.66, bz + o); });
    [-1, 1].forEach(function (sd) { var nz = bz + sd * 1.32; K.box("walnut", 0.5, 0.52, 0.42, bx0 + 0.25, 0.26, nz, 0, 1); K.cyl("brass", 0.06, 0.08, 0.04, bx0 + 0.25, 0.54, nz, 12); K.cyl("lamp", 0.1, 0.13, 0.2, bx0 + 0.25, 0.74, nz, 16); K.cyl("brass", 0.012, 0.012, 0.18, bx0 + 0.25, 0.63, nz, 6); so(bx0 + 0.25, nz, 0.5, 0.42, 0, 0.56); });
    so((bx0 + bx1) / 2, bz, 2.2, 2.06, 0, 0.58);
    L.recl.push({ kind: "bed", x: 0, z: 0, local: [bx0 + 0.42, 0.95, bz], yaw: PI / 2, foot: [bx1, bz] });
    light(0xffd2a0, 0.55, 5.5, bx0 + 0.6, 1.3, bz, false);
    hot((bx0 + bx1) / 2, 0.6, bz, 1.9, "note", { key: "bed" });
    yield 2;
    // ── the spa bathroom: frosted glass screens, a rain shower on a stone tray, a basalt vessel basin on a floating walnut vanity ──
    var bx = X(0.9), bzF = X(-1.0), bzB = X(-3.05), bxR = X(2.9);
    K.box("frostPane", 0.03, 2.1, bzF - bzB, bx, 1.05, (bzF + bzB) / 2, 0); K.box("frostPane", bxR - bx - 0.9, 2.1, 0.03, bx + (bxR - bx - 0.9) / 2, 1.05, bzF, 0);
    [[bx, (bzF + bzB) / 2, 0.035, bzF - bzB], [bx + (bxR - bx - 0.9) / 2, bzF, bxR - bx - 0.9, 0.035]].forEach(function (f) { K.box("black", f[2], 0.035, f[3], f[0], 2.12, f[1], 0); K.box("black", f[2], 0.035, f[3], f[0], 0.02, f[1], 0); });
    K.box("black", 0.04, 2.14, 0.04, bx, 1.07, bzF, 0); K.box("black", 0.04, 2.14, 0.04, bx, 1.07, bzB, 0); K.box("black", 0.04, 2.14, 0.04, bxR - 0.9, 1.07, bzF, 0);
    K.box("basalt", 1.2, 0.04, 1.2, X(2.05), 0.03, X(-2.25), 0, 1); K.cyl("black", 0.016, 0.016, 2.3, X(2.05) + 0.5, 1.15, X(-2.25), 8); K.box("black", 0.5, 0.025, 0.025, X(2.05) + 0.25, 2.3, X(-2.25), 0); K.cyl("black", 0.19, 0.19, 0.025, X(2.05), 2.29, X(-2.25), 28); K.box("walnut", 0.6, 0.04, 0.32, X(2.05) + 0.2, 0.45, X(-2.25) - 0.4, 0, 1); K.box("black", 0.04, 0.43, 0.3, X(2.05) + 0.2, 0.22, X(-2.25) - 0.4, 0);
    K.box("walnut", 0.95, 0.12, 0.42, bx + 0.6, 0.82, bzB + 0.3, 0, 1); K.cyl("basalt", 0.19, 0.14, 0.13, bx + 0.6, 0.945, bzB + 0.3, 20); K.cyl("chrome", 0.012, 0.012, 0.22, bx + 0.6, 1.0, bzB + 0.1, 6);
    var mir = new THREE.CircleGeometry(0.32, 32); K.geo("chrome", mir, bx + 0.6, 1.5, bzB + 0.02); K.box("linen", 0.32, 0.5, 0.04, bx + 1.3, 1.05, bzF - 0.05, 0);
    so(bx, (bzF + bzB) / 2, 0.08, bzF - bzB, 0, 2.1); so(bx + (bxR - bx - 0.9) / 2, bzF, bxR - bx - 0.9, 0.08, 0, 2.1); so(bx + 0.6, bzB + 0.3, 0.95, 0.42, 0.7, 0.9);
    light(0xfff0d8, 0.35, 3.5, X(2.0), 1.9, X(-2.0), false); hot(X(1.8), 1.0, X(-1.6), 1.6, "note", { key: "bath" });
    yield 3;
    // ── the lounge: a deep sofa facing a suspended steel fireplace (its flue up to the glass), a low table, a reading lamp ──
    var sx0 = X(-3.0), sz0 = X(1.55), fx = X(-1.25), fz = X(1.55);
    // the sofa: the quilted cream divan (a model the game already has) facing the fire, a throw and cushions; boxes if it is missing
    var sofaM = null; if (has("jetsofa")) { try { sofaM = makeModel("jetsofa"); sofaM.position.set(sx0 + 0.02, 0, sz0); sofaM.rotation.y = PI / 2; sofaM.traverse(function (q) { if (q.isMesh) { q.castShadow = false; q.receiveShadow = true; q.userData.noSolid = true; q.userData.noDispose = true; } }); g.add(sofaM); } catch (e) { sofaM = null; note("sofa", e); } }
    if (!sofaM) { K.box("sofa", 0.95, 0.42, 2.3, sx0, 0.21, sz0, 0, 1); K.box("sofa", 0.24, 0.62, 2.3, sx0 - 0.4, 0.62, sz0, 0, 1); [-1, 1].forEach(function (sd) { K.box("sofa", 0.95, 0.56, 0.2, sx0, 0.28, sz0 + sd * 1.15, 0, 1); }); [-0.55, 0.55].forEach(function (o) { K.box("linen", 0.75, 0.14, 1.0, sx0 + 0.05, 0.48, sz0 + o, 0, 1); }); }
    K.box("throw", 0.5, 0.36, 0.12, sx0 - 0.12, 0.66, sz0 - 0.62, 0.2, 1); var cu = new THREE.BoxGeometry(0.14, 0.42, 0.42); cu.rotateZ(-0.25); K.geo("rug", cu, sx0 - 0.15, 0.68, sz0 + 0.7);
    if (has("jetlamp")) { try { var lampM = makeModel("jetlamp"); lampM.position.set(sx0 - 0.1, 0, sz0 + 1.55); lampM.traverse(function (q) { if (q.isMesh) { q.castShadow = false; q.userData.noSolid = true; q.userData.noDispose = true; } }); g.add(lampM); so(sx0 - 0.1, sz0 + 1.55, 0.4, 0.4, 0, 1.5); light(0xffd9a8, 0.35, 4, sx0 - 0.1, 1.4, sz0 + 1.55, false); } catch (e) { note("lamp", e); } }
    K.box("walnut", 0.75, 0.32, 0.95, X(-2.05), 0.16, sz0, 0, 1);
    // a freestanding round steel fireplace (open toward the sofa), its cone hood and flue running up to the glass
    var gap = 1.9, fb = new THREE.CylinderGeometry(0.44, 0.47, 0.7, 36, 1, true, -PI / 2 + gap / 2, TAU - gap); K.geo("black", fb, fx, 0.41, fz); K.cyl("black", 0.47, 0.5, 0.06, fx, 0.06, fz, 36); K.cyl("basalt", 0.44, 0.44, 0.03, fx, 0.3, fz, 28);
    var hood = new THREE.CylinderGeometry(0.1, 0.46, 0.62, 36, 1, true); K.geo("black", hood, fx, 1.07, fz); var flueTop = Hh * (1 - Math.max(Math.abs(fx), Math.abs(fz)) / half); K.cyl("black", 0.1, 0.1, flueTop - 1.38, fx, 1.38 + (flueTop - 1.38) / 2, fz, 14);
    K.cyl("ember", 0.3, 0.3, 0.02, fx, 0.325, fz, 20); K.cyl("walnut", 0.05, 0.05, 0.5, fx - 0.05, 0.37, fz - 0.08, 8, false, 0.4, 0, PI / 2); K.cyl("walnut", 0.045, 0.045, 0.46, fx + 0.02, 0.37, fz + 0.09, 8, false, -0.3, 0, PI / 2); K.cyl("basalt", 0.8, 0.8, 0.04, fx, 0.02, fz, 36);
    var fl = new THREE.Mesh((function () { var a = new THREE.PlaneGeometry(0.5, 0.4), b = a.clone(); b.rotateY(PI / 2); var m = mergeGeos([toNonIndexed(a), toNonIndexed(b)]); m.translate(0, 0.34 + 0.2, 0); return m; })(), mats().fire); fl.position.set(fx, 0, fz); fl.renderOrder = 4; g.add(fl);
    [-0.7, 0, 0.7].forEach(function (o) { seat(sx0 + 0.08, sz0 + o, 0.62, 0.66, 0.46, PI / 2); }); so(sx0 - 0.33, sz0, 0.32, 2.3, 0, 0.9); so(X(-2.05), sz0, 0.75, 0.95, 0, 0.34); so(fx, fz, 1.0, 1.0, 0, 1.3);
    L.fireLight = light(0xff8a3a, 0.9, 6, fx, 1.1, fz, true); hot(X(-2.3), 0.6, sz0, 1.5, "note", { key: "lounge" });
    yield 4;
    // ── the kitchen along the east glass (stone top, induction, sink, an espresso machine) and a walnut table for two ──
    var kx = X(3.15), kz0 = X(0.35), kz1 = X(2.65), kc = (kz0 + kz1) / 2;
    K.box("walnut", 0.6, 0.86, kz1 - kz0, kx, 0.43, kc, 0, 1); K.box("marble", 0.66, 0.04, kz1 - kz0 + 0.04, kx, 0.88, kc, 0, 1); K.box("ledStrip", 0.02, 0.02, kz1 - kz0 - 0.1, kx - 0.31, 0.06, kc, 0);
    K.box("black", 0.5, 0.008, 0.55, kx, 0.904, kz0 + 1.45, 0); K.box("inox", 0.4, 0.02, 0.36, kx, 0.895, kz0 + 0.6, 0); K.cyl("chrome", 0.012, 0.012, 0.3, kx + 0.2, 1.05, kz0 + 0.6, 8);
    // the espresso machine: a steel body, a group head, a drip tray, two cups
    var ex = kx - 0.02, ez = kz1 - 0.42; K.box("inox", 0.34, 0.38, 0.3, ex + 0.05, 1.09, ez, 0); K.box("black", 0.3, 0.04, 0.2, ex - 0.06, 0.92, ez, 0); K.cyl("chrome", 0.035, 0.035, 0.08, ex - 0.1, 1.03, ez, 12); K.box("black", 0.12, 0.03, 0.03, ex - 0.18, 1.03, ez, 0); [-0.06, 0.06].forEach(function (o) { K.cyl("linen", 0.035, 0.03, 0.06, ex - 0.1, 0.97, ez + o, 12); }); K.cyl("chrome", 0.012, 0.012, 0.12, ex - 0.16, 1.2, ez + 0.11, 6);
    so(kx, kc, 0.62, kz1 - kz0, 0, 0.92); light(0xffd9a8, 0.6, 5, X(2.2), 2.3, X(1.5), false);
    var tx = X(1.45), tz = X(1.55); K.cyl("walnut", 0.48, 0.48, 0.04, tx, 0.74, tz, 32); K.cyl("brass", 0.04, 0.04, 0.7, tx, 0.37, tz, 10); K.cyl("brass", 0.26, 0.28, 0.03, tx, 0.015, tz, 24); K.cyl("glassB", 0.035, 0.03, 0.11, tx + 0.15, 0.82, tz - 0.1, 10); K.cyl("lamp", 0.025, 0.025, 0.06, tx, 0.79, tz, 8);
    [[0, 0.85], [0, -0.85]].forEach(function (o, i) { var cx = tx + o[0], cz = tz + o[1]; var ry = i ? 0 : PI; K.box("leather", 0.46, 0.06, 0.44, cx, 0.46, cz, ry, 1); K.box("leather", 0.46, 0.42, 0.06, cx, 0.7, cz + (i ? -0.2 : 0.2), ry, 1); [-0.18, 0.18].forEach(function (a) { [-0.18, 0.18].forEach(function (b) { K.box("walnut", 0.035, 0.44, 0.035, cx + a, 0.22, cz + b, 0); }); }); seat(cx, cz, 0.5, 0.5, 0.48, i ? PI : 0); });
    so(tx, tz, 0.7, 0.7, 0, 0.76); hot(X(2.6), 0.9, X(1.5), 1.5, "note", { key: "kitchen" }); hot(tx, 0.8, tz, 1.2, "note", { key: "dining" });
    yield 5;
    // ── the telescope by the glass (a refractor on a tripod, aimed out through the north face) and the smart glass switch by the door ──
    var tsx = X(-2.2), tsz = X(3.15); [0, 1, 2].forEach(function (k) { var a = k / 3 * TAU + 0.3; K.beam("walnut", new THREE.Vector3(tsx + Math.sin(a) * 0.42, 0, tsz + Math.cos(a) * 0.42), new THREE.Vector3(tsx, 1.05, tsz), 0.035, 0.035, new THREE.Vector3(0, 0, 1)); });
    var tg2 = new THREE.CylinderGeometry(0.07, 0.065, 1.15, 20); tg2.rotateX(0.95); tg2.rotateY(-0.35); K.geo("brass", tg2, tsx, 1.28, tsz); K.cyl("black", 0.03, 0.03, 0.12, tsx + 0.15, 1.0, tsz - 0.35, 10);
    so(tsx, tsz, 0.7, 0.7, 0, 1.4); hot(tsx, 1.0, tsz - 0.2, 1.4, "telescope", {});
    var swx = 0.72, swz = half - 0.3; K.box("black", 0.09, 0.14, 0.02, swx, 1.25, swz - 0.01, 0); K.box("lamp", 0.05, 0.03, 0.01, swx, 1.28, swz - 0.025, 0); hot(swx, 1.25, swz - 0.4, 1.2, "glass", {});
    // a plant and a basket by the door, soft LED under the glass rim
    K.cyl("pot", 0.22, 0.18, 0.42, X(2.6), 0.21, X(3.1), 16); for (var pl = 0; pl < 7; pl++) { var a2 = pl / 7 * TAU; K.sph("leaf", 0.16, X(2.6) + Math.cos(a2) * 0.1, 0.62 + (pl % 3) * 0.12, X(3.1) + Math.sin(a2) * 0.1, 1.5, 8); }
    [[-1, 0], [1, 0], [0, -1]].forEach(function (d) { var L2 = 2 * (half - 0.08); if (d[0]) K.box("ledStrip", 0.02, 0.02, L2, d[0] * (half - 0.09), 0.03, 0, 0); else K.box("ledStrip", L2, 0.02, 0.02, 0, 0.03, d[1] * (half - 0.09), 0); });
    yield 6;
    K.build(g, Mt).forEach(function (m) { m.userData.shSet = true; m.castShadow = false; m.receiveShadow = true; });
    // the door: a real leaf on its hinge, swinging out onto the deck
    var piv = new THREE.Group(); piv.position.set(-DOOR.leafW / 2, 0, half + 0.0); g.add(piv); for (var lk in P.E.leafGeos) { var lm = new THREE.Mesh(P.E.leafGeos[lk], lk === "doorGlass" ? mats().doorClear : mats()[lk]); lm.castShadow = lk === "metal"; piv.add(lm); } L.door = { piv: piv, open: 0, target: 0, manual: false };
    scene.add(g); g.updateMatrixWorld(true); L.ports = [["x", half, -half, half, 0, Hh], ["x", -half, -half, half, 0, Hh], ["z", half, -half, half, 0, Hh], ["z", -half, -half, half, 0, Hh]];
    try { if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(g, { name: "stargaze interior" }); } catch (e) {}
    return L;
  }
  function buildInterior(P) { var it = buildSteps(P), r; do { r = it.next(); } while (!r.done); return r.value; }
  function disposeInterior(P) { var L = P.L; if (!L) return; try { scene.remove(L.g); L.solids.forEach(function (sd) { var i = SOLIDS.indexOf(sd); if (i >= 0) SOLIDS.splice(i, 1); var j = SG.sol.indexOf(sd); if (j >= 0) SG.sol.splice(j, 1); }); var shared = []; for (var k in P.E.leafGeos) shared.push(P.E.leafGeos[k]); L.g.traverse(function (o) { if (o.isMesh && o.geometry && !o.userData.noDispose && shared.indexOf(o.geometry) < 0) o.geometry.dispose(); }); } catch (e) { note("dispose", e); } P.L = null; doorSolidOn(P, true); SG.n.disposes++; }
  // ───────────────────────── every frame: night glow, water and fire, the dome, doors, glass, interiors, steam, the astronomer ─────────────────────────
  var STEAM = { pool: [], t: 0 };
  function steamFrame(dt, S, n) {
    var cam = camera.position; if (!STEAM.g) { STEAM.g = SG.steamG = new THREE.Group(); STEAM.g.name = "stargaze_steam"; STEAM.g.userData.noCull = true; scene.add(STEAM.g); for (var i = 0; i < 18; i++) { var sp = new THREE.Sprite(MX.steam.clone()); sp.visible = false; sp.userData.t = Math.random(); STEAM.g.add(sp); STEAM.pool.push(sp); } }
    var near = S.pyr.map(function (P) { var w = l2w(P, P.sz.tub[0], P.sz.tub[1]); return { P: P, x: w[0], z: w[1], d: Math.hypot(w[0] - cam.x, w[1] - cam.z) }; }).filter(function (o) { return o.d < 60; }).sort(function (a, b) { return a.d - b.d; }).slice(0, 3);
    STEAM.pool.forEach(function (sp, i) { var o = near[i % 6 < 6 ? Math.floor(i / 6) : 0]; if (!o) { sp.visible = false; return; } var u = sp.userData; u.t += dt * (0.16 + (i % 5) * 0.025); if (u.t > 1) { u.t -= 1; u.ox = (Math.random() - 0.5) * 1.3; u.oz = (Math.random() - 0.5) * 1.3; }
      var t = u.t; sp.visible = true; sp.position.set(o.x + (u.ox || 0) + Math.sin(t * 3 + i) * 0.15, o.P.D + 0.5 + t * 1.6, o.z + (u.oz || 0)); var s = 0.5 + t * 1.6; sp.scale.set(s, s, 1); sp.material.opacity = Math.sin(t * PI) * (0.07 + 0.08 * n); });
  }
  function nearestOpen() { var best = null, bd = 1e9, px = player.position.x, pz = player.position.z; listOpen().forEach(function (P) { var d = Math.hypot(P.x - px, P.z - pz); if (d < bd) { bd = d; best = P; } }); return best ? { P: best, d: bd } : null; }
  function interiorFrame(dt) {
    var no = nearestOpen(); if (!no) return; var P = no.P, d = no.d;
    if (!IN.sb && !P.L && d < R_STAGE && !(typeof FLY !== "undefined" && FLY.on)) IN.sb = { P: P, it: buildSteps(P), t0: nowMs() };
    if (IN.sb) { var r; var near = Math.hypot(IN.sb.P.x - player.position.x, IN.sb.P.z - player.position.z) < R_BUILD; var stepFn = window.PLAN_PERF && PLAN_PERF.step && !near ? function (it) { return PLAN_PERF.step(it); } : function (it) { var q; do { q = it.next(); } while (!q.done); return q; };
      try { r = stepFn(IN.sb.it); } catch (e) { note("build", e); IN.sb = null; return; }
      if (r && r.done) { IN.sb.P.L = r.value; SG.n.builds++; SG.n.lastBuildMs = Math.round(nowMs() - IN.sb.t0); IN.sb = null; } }
    listOpen().forEach(function (Q) { if (!Q.L) return; var dq = Math.hypot(Q.x - player.position.x, Q.z - player.position.z); if (dq > R_DROP && !(SGM.on && SGM.P === Q)) disposeInterior(Q); });
  }
  function doorFrame(P, dt) {
    var L = P.L; if (!L || !L.door) return; var D = L.door; var w = l2w(P, 0, P.sz.half + 0.3); var dx = player.position.x - w[0], dz = player.position.z - w[1], dd = Math.hypot(dx, dz), dy = Math.abs(player.position.y - P.D);
    if (!D.manual) D.target = dd < 2.6 && dy < 1.6 ? 1 : dd > 4.2 ? 0 : D.target; D.open += clamp(D.target - D.open, -dt * 1.6, dt * 1.6); D.piv.rotation.y = -ease(D.open) * 1.55; doorSolidOn(P, D.open < 0.45);
    if (D.manual && dd > 9) D.manual = false;
  }
  var FR = SG.fr = { t: 0, astro: false };
  function frameHook(dt, now) {
    if (SG.off || !SITE || !EX.g) return; var S = SITE; dt = Math.min(dt || 0.016, 0.1);
    try {
      var n = nightK(), dim = U.uDim.value; U.uNight.value = n; U.uTime.value = (U.uTime.value + dt) % 10000;
      var cam = camera.position, dc = Math.hypot(cam.x - S.cx, cam.z - S.cz), near = dc < 260;
      // the night look: decals, bollard lenses, the door glass, the sign, the glow of the frosted glass
      var gk = n * dim; MX.glowAmber.opacity = 0.34 * gk; MX.glowWarm.opacity = 0.32 * gk; MX.glowBlue.opacity = 0.55 * n; MX.glowFire.opacity = 0.45 * n; MX.glowRed.opacity = 0.5 * n * OB.shut;
      for (var k in MX.deckGlow) MX.deckGlow[k].opacity = 0.42 * gk; MX.lens.emissiveIntensity = 0.15 + 3.2 * gk; MX.doorGlass.emissiveIntensity = 0.05 + 1.5 * gk; MX.sign.emissiveIntensity = 0.12 + 0.75 * n; MX.frost.emissiveIntensity = C("light.glassGlow", 2.4); MX.water.emissiveIntensity = 0.55 + 1.4 * n;
      MX.fire.uniforms.uAmp.value = 0.75 + 0.25 * n; MX.redLed.emissiveIntensity = 0.3 + 1.6 * n; MX.screen.emissiveIntensity = 0.3 + 0.8 * n;
      // the pooled lights only near (the pool picks the nearest few); fires flicker
      var t = U.uTime.value; EX.lights.forEach(function (l, i) { var P = l.userData.P; var far = Math.abs(P.x - cam.x) > 150 || Math.abs(P.z - cam.z) > 150; var k0 = l.userData.k0; var v = 0; if (!far) { if (l.userData.tag === "fire") v = k0 * (0.35 + 0.65 * n) * (0.82 + 0.18 * Math.sin(t * 13 + i) * Math.sin(t * 7.3 + i * 2)); else if (l.userData.tag === "tub") v = k0 * n; else v = k0 * gk * (P.L && P.frost < 0.5 ? 0.55 : 1); } l.intensity = v; });
      // far away the small things go (the instanced decks, glass and tubs stay: they read from a distance)
      var showSmall = dc < 380; [EX.fire, EX.gTub, EX.gFire, EX.gBol].concat(EX.chairs || [], EX.loungers || []).forEach(function (m) { if (m) m.visible = showSmall; }); (EX.bollards || []).forEach(function (m) { m.visible = dc < 520; });
      // the dome: the slit opens after dark (the upper shutter slides back, the lower drops), the dome and telescope swing to a target
      if (OB.g) { var want = n > 0.35 ? 1 : 0; OB.shut += clamp(want - OB.shut, -dt * 0.09, dt * 0.09); OB.up.rotation.x = -72 * PI / 180 * ease(OB.shut);
        var tgt = obsTarget(); var az = tgt ? tgt.az - OB.yaw : OB.az0 || 0.6; var da = Math.atan2(Math.sin(az - OB.az), Math.cos(az - OB.az)); OB.az += clamp(da, -dt * 0.05, dt * 0.05); OB.dome.rotation.y = OB.az; OB.mount.rotation.y = OB.az;
        var alt = tgt ? clamp(tgt.alt, 0.3, 1.18) : 0.95; OB.alt += clamp(alt - OB.alt, -dt * 0.05, dt * 0.05); OB.tube.rotation.x = (PI / 2 - OB.alt) * ease(OB.shut) + 0.0 * (1 - OB.shut); OB.light.intensity = OB.light.userData.k0 * (0.25 + 0.75 * n) * (dc < 150 ? 1 : 0); OB.dome.visible = true; }
      if (AM.light) { AM.light.intensity = dc < 150 ? AM.light.userData.k0 * (0.4 + 0.6 * n) * (0.85 + 0.15 * Math.sin(t * 11.0) * Math.sin(t * 5.1)) : 0; AM.fire.visible = showSmall; }
      // the open pyramids: interiors, doors, the glass (frosted until the interior is in, then whatever the switch says)
      if (near) { interiorFrame(dt); listOpen().forEach(function (P) { doorFrame(P, dt); }); } else if (!SGM.on) { if (IN.sb) { try { var q2; do { q2 = IN.sb.it.next(); } while (!q2.done); IN.sb.P.L = q2.value; } catch (e) { note("finish", e); } IN.sb = null; } listOpen().forEach(function (P) { if (P.L) disposeInterior(P); }); }
      var gch = false; S.pyr.forEach(function (P) { var dP = Math.hypot(P.x - cam.x, P.z - cam.z); var want = P.open ? (P.L && !(n > 0.5 && dP > 34 && !(SGM.on && SGM.P === P)) ? (P.userFrost ? 1 : 0) : 1) : 1; P.frost = want; if (P.frostT !== want) { P.frostT += clamp(want - P.frostT, -dt * 1.3, dt * 1.3); gch = true; } if (P.L) P.L.lights.forEach(function (l) { var dimIn = (SGM.on && SGM.P === P) ? 0.12 : 1; l.intensity = l.userData.k0 * (0.35 + 0.65 * n) * dimIn * (l.userData.flick ? 0.85 + 0.15 * Math.sin(t * 12 + l.id) * Math.sin(t * 6.1) : 1); }); });
      if (gch) setGlass(false); aoFrame(n);
      if (dc < 90 && showSmall) steamFrame(dt, S, n); else if (STEAM.g) STEAM.pool.forEach(function (sp) { sp.visible = false; });
      if (!FR.astro && dc < 260 && nowMs() > (FR.astroAt || 0)) { try { buildAstronomer(S); FR.astro = !!SG.astro; } catch (e) { note("astronomer", e); } if (!FR.astro) FR.astroAt = nowMs() + 5000; }
      stargazeFrame(dt);
    } catch (e) { note("frame", e); }
  }
  // the observatory's target: what the stargazing list has selected, else the first of tonight's targets, else a slow sweep
  function obsTarget() { if (SGM.target && SGM.target.dir) { var d = SGM.target.dir; return { az: Math.atan2(d.x, d.z), alt: Math.asin(clamp(d.y, -1, 1)) }; } var T0 = FR.tg && FR.tg[0]; if (T0 && T0.dir) return { az: Math.atan2(T0.dir.x, T0.dir.z), alt: Math.asin(clamp(T0.dir.y, -1, 1)) }; return null; }

  // ───────────────────────── the camera inside a pyramid or the dome: kept within the glass, first person when tight ─────────────────────────
  function inPyrVolume(P, x, y, z, pad) { var q = w2l(P, x, z); var h = y - P.D; if (h < 0) return false; var lim = P.sz.half * (1 - h / P.sz.H) - pad; return Math.abs(q[0]) < lim && Math.abs(q[1]) < lim; }
  function camHook(dt) {
    if (SG.off || !SITE || window.__cam) return false;
    if (SGM.on || SGM.k > 0.001) return stargazeCam(dt);
    try { var px = player.position.x, py = player.position.y, pz = player.position.z, fwd = [-Math.sin(yaw), -Math.cos(yaw)]; var P = pyramidAt(px, pz, py), inObs = false;
      if (!P && OB.g) { var od = Math.hypot(px - SITE.obs.x, pz - SITE.obs.z); inObs = od < SITE.obs.r - 0.25 && Math.abs(py - (SITE.obs.G + OB.FL)) < 1.2; }
      if (!P && !inObs) { if (FR.inCam) { FR.inCam = false; try { player.userData.walk.visible = true; } catch (e) {} } return false; }
      FR.inCam = true; var cy0 = py - (typeof bobY === "number" ? bobY : 0) + 1.75, dist = 0;
      var ok = function (x, y, z) { if (P) return inPyrVolume(P, x, y, z, 0.32); var r = Math.hypot(x - SITE.obs.x, z - SITE.obs.z); return r < SITE.obs.r - 0.6 && !(r < 1.1 && y < SITE.obs.G + OB.FL + 2.8); };
      for (var d = 0.2; d <= 3.6; d += 0.2) { var cx = px - fwd[0] * d, cz = pz - fwd[1] * d; if (!ok(cx, cy0 + 0.2, cz)) break; dist = d; }
      if (FR.fp === undefined) FR.fp = dist < 1.3; else if (FR.fp && dist > 2.1) FR.fp = false; else if (!FR.fp && dist < 1.1) FR.fp = true;
      CAM.dist += (dist - CAM.dist) * smoothK(dt, 10); var sd = Math.min(dist, CAM.dist);
      if (FR.fp) { camera.position.set(px, py - (typeof bobY === "number" ? bobY : 0) + 1.62, pz); CAM.init = false; camera.lookAt(px + fwd[0] * 10, camera.position.y - pitch * 6, pz + fwd[1] * 10); player.userData.walk.visible = false; }
      else { var cy = cy0 + pitch * 1.1; camera.position.lerp(camTarget.set(px - fwd[0] * sd, cy, pz - fwd[1] * sd), smoothK(dt, 24)); camLook(px, py + 1.3, pz, dt, 30); player.userData.walk.visible = true; }
      return true; } catch (e) { note("cam", e); return false; }
  }

  // ───────────────────────── E and the prompt ─────────────────────────
  function allHots() { var out = []; listOpen().forEach(function (P) { if (P.L) out = out.concat(P.L.hots); }); return out; }
  function nearReclines() { var px = player.position.x, pz = player.position.z, py = player.position.y, best = null, bd = 1e9;
    (TR.spots || []).concat(SITE ? SITE.pyr.map(function (P) { return P.lounger; }).filter(Boolean) : []).forEach(function (s) { var d = Math.hypot(s.fx - px, s.fz - pz); var d2 = Math.hypot(s.x - px, s.z - pz); var m = Math.min(d, d2); if (m < 1.6 && m < bd && Math.abs(py - s.y) < 2) { bd = m; best = s; } });
    listOpen().forEach(function (P) { if (!P.L) return; P.L.recl.forEach(function (r) { var w = l2w(P, r.local[0] + 1.0, r.local[2]); var d = Math.hypot(w[0] - px, w[1] - pz); if (d < 1.9 && d < bd && Math.abs(py - P.D) < 1.2) { bd = d; best = { kind: "bed", P: P, r: r }; } }); });
    return best; }
  function nearHot(kinds) { var px = player.position.x, py = player.position.y, pz = player.position.z, best = null, bd = 1e9; allHots().forEach(function (o) { if (kinds && kinds.indexOf(o.kind) < 0) return; if (Math.abs(py - o.y) > 1.8) return; var d = Math.hypot(o.x - px, o.z - pz); if (d < o.r && d < bd) { bd = d; best = o; } }); return best; }
  function nearObsEye() { if (!OB.eye) return false; return Math.hypot(OB.eye.x - player.position.x, OB.eye.z - player.position.z) < OB.eye.r && Math.abs(player.position.y - OB.eye.y) < 1.4; }
  function nearOnTerrace() { var T0 = SITE && SITE.terr; if (!T0) return null; var d = Math.hypot(player.position.x - T0.x, player.position.z - T0.z); return d < T0.r + 0.5 && d > 2.2 ? T0 : null; }
  function nearDoor() { var px = player.position.x, pz = player.position.z, py = player.position.y; var S = SITE; for (var i = 0; i < S.pyr.length; i++) { var P = S.pyr[i]; if (Math.abs(px - P.x) > 12 || Math.abs(pz - P.z) > 12) continue; var q = w2l(P, px, pz); if (Math.abs(q[0]) < 1.5 && q[1] > P.sz.half - 2.2 && q[1] < P.sz.half + 1.9 && Math.abs(py - P.D) < 1.4) return P; } return null; }
  function freeLounger(T0) { var px = player.position.x, pz = player.position.z, best = null, bd = 1e9; (TR.spots || []).forEach(function (s) { var d = Math.hypot(s.fx - px, s.fz - pz); if (d < bd) { bd = d; best = s; } }); return best; }
  function infoCard(t, k, p) { try { $id("info-h").textContent = t; $id("info-k").textContent = k || ""; $id("info-p").textContent = p || ""; var go = $id("info-go"); if (go) go.style.display = "none"; var nv = $id("info-nav"); if (nv) nv.style.display = "none"; $id("info").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock(); sfx("ui"); } catch (e) {} }
  function status(s) { try { setStatus(s); } catch (e) { try { logLine(C("names.retreatShort", "Stargazer Pyramids"), s); } catch (x) {} } }
  function handleE() {
    if (SG.off || !SITE) return false;
    if (SGM.on) { exitStargaze(); return true; }
    if ((typeof riding !== "undefined" && riding) || (typeof SIT !== "undefined" && SIT.on) || (typeof inside !== "undefined" && inside)) return false;
    var rc = nearReclines(); if (rc) { enterStargaze(rc.kind === "bed" ? bedSpot(rc.P, rc.r) : rc, false); return true; }
    var h = nearHot(); if (h) { if (h.kind === "telescope") { var P = pyramidAt(player.position.x, player.position.z, player.position.y) || nearestOpen().P; enterStargaze(teleSpot(P), true); return true; }
      if (h.kind === "glass") { var Pg = pyramidAt(player.position.x, player.position.z, player.position.y) || nearestOpen().P; Pg.userFrost = !Pg.userFrost; try { sfx("ui"); } catch (e) {} status(Pg.userFrost ? "Smart glass: frosted" : "Smart glass: clear"); return true; }
      if (h.kind === "note") { var r = C("rooms." + h.d.key, null); if (r) { infoCard(r[0], r[1], r[2]); return true; } } }
    if (nearObsEye()) { enterStargaze(obsSpot(), true); return true; }
    try { if (nearestSeat()) return false; } catch (e) {}
    var P2 = nearDoor(); if (P2) { if (P2.open && P2.L && P2.L.door) { var D = P2.L.door, op = D.target > 0.5; D.manual = true; D.target = op ? 0 : 1; try { sfx("board"); } catch (e) {} return true; } if (!P2.open) { status(C("prompts.locked", "occupied tonight")); return true; } }
    var T0 = nearOnTerrace(); if (T0) { var s = freeLounger(T0); if (s) { enterStargaze(s, false); return true; } }
    return false;
  }
  function promptFrame() {
    try { if (SG.off || !SITE) return; var el = $id("prompt"), t = $id("prompt-t"); if (!el || !t) return; if (SGM.on) { el.classList.remove("on"); return; }
      if ((typeof riding !== "undefined" && riding) || (typeof SIT !== "undefined" && SIT.on)) return; var Pm = C("prompts", {}), msg = null;
      var rc = nearReclines(); if (rc) msg = rc.kind === "bed" ? Pm.bed : Pm.lounger;
      if (!msg) { var h = nearHot(); if (h) { if (h.kind === "telescope") msg = Pm.telescope; else if (h.kind === "glass") { var Pg = pyramidAt(player.position.x, player.position.z, player.position.y) || nearestOpen().P; msg = Pg && Pg.userFrost ? Pm.glassFrost : Pm.glassClear; } else if (h.kind === "note") { var r = C("rooms." + h.d.key, null); if (r && !nearestSeat()) msg = "about " + r[0].replace(/^The /, "the "); } } }
      if (!msg && nearObsEye()) msg = Pm.obsTelescope;
      if (!msg) { var P2 = nearDoor(); if (P2) { if (P2.open && P2.L && P2.L.door) { if (!pyramidAt(player.position.x, player.position.z, player.position.y)) msg = P2.L.door.target > 0.5 ? Pm.doorOpen : Pm.doorShut; } else if (!P2.open && !nearestSeat()) msg = Pm.locked; } }
      if (!msg && nearOnTerrace() && !nearestSeat()) msg = Pm.terrace;
      if (msg) { t.innerHTML = "<b>E</b> &nbsp;" + msg; el.classList.add("on"); }
    } catch (e) { note("prompt", e); }
  }
  function install() {
    if (SG.installed) return; SG.installed = true; var o = SG.orig = { openNearest: openNearest, updateZone: updateZone };
    openNearest = function () { try { if (SG.impl.handleE()) return; } catch (e) { note("E", e); } return o.openNearest.apply(this, arguments); };
    updateZone = function () { var r = o.updateZone.apply(this, arguments); try { SG.impl.prompt(); } catch (e) {} return r; };
  }
  // ───────────────────────── stargazing mode ─────────────────────────
  // Lie back (a bed, a lounger) or step up to a telescope: the camera eases back to your head and tilts up at the sky, the HUD
  // fades, the retreat's lights dim (and PLAN_SKY.setStargaze when the sky module is there), a quiet night soundscape plays.
  // Drag (or the locked mouse) looks round the sky; C constellations, T telescope, L star trails, 1-9 a target; Esc or E to get up.
  // Every PLAN_SKY call is optional: without it you still lie back and look up, the list falls back to Polaris and the Moon,
  // the telescope narrows the view behind an eyepiece mask, and star trails run the clock fast for a few seconds.
  var SGM = SG.mode = (SG.old && SG.old.mode && !SG.old.mode.on) ? null : SG.mode; SGM = SG.mode = SGM || { on: false, k: 0, spot: null, yaw: 0, pitch: 0, tele: false, cons: false, lapse: false, target: null };
  var _hv = new THREE.Vector3(), _dv = new THREE.Vector3(), _c0 = new THREE.Vector3(), _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _mL = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
  function SKY() { return window.PLAN_SKY || null; }
  function skyFn(names) { var S = SKY(); if (!S) return null; for (var i = 0; i < names.length; i++) if (typeof S[names[i]] === "function") return { S: S, f: S[names[i]], name: names[i] }; return null; }
  function skyCall(names) { var a = [].slice.call(arguments, 1), F = skyFn(names); if (!F) return undefined; try { return F.f.apply(F.S, a); } catch (e) { note("sky " + F.name, e); return undefined; } }
  function dirFromAltAz(alt, az) { return new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)); }
  function toDir(v) { if (!v) return null; if (v.isVector3) return v.clone().normalize(); if (Array.isArray(v) && v.length >= 3) return new THREE.Vector3(v[0], v[1], v[2]).normalize(); if (typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number") return new THREE.Vector3(v.x, v.y, v.z).normalize(); return null; }
  function angle(v) { if (typeof v !== "number") return null; return Math.abs(v) > TAU + 0.01 ? v * PI / 180 : v; }
  function targetDir(t) {
    var d = null; try { var F = skyFn(["dirTo"]); if (F) d = toDir(F.f.call(F.S, t.id || t.name)); } catch (e) {}
    if (!d && t.raw) { d = toDir(t.raw.dir || t.raw.direction || t.raw.vec); if (!d) { var alt = angle(t.raw.alt !== undefined ? t.raw.alt : t.raw.altitude), az = angle(t.raw.az !== undefined ? t.raw.az : t.raw.azimuth); if (alt !== null && az !== null) d = dirFromAltAz(alt, az); } }
    return d || t.dir || null;
  }
  function compass(d) { var az = Math.atan2(d.x, -d.z); if (az < 0) az += TAU; var n = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(az / (PI / 4)) % 8]; var alt = Math.asin(clamp(d.y, -1, 1)) * 180 / PI; return (alt > 70 ? "almost overhead" : alt > 40 ? "high in the " + n : alt > 15 ? "in the " + n : "low in the " + n); }
  // tonight's list: the sky module's targets above the horizon, else Polaris, the Moon when it is up, the zenith
  function targets() {
    var out = [], raw = skyCall(["targets", "getTargets"]);
    var rank = { moon: 100, planet: 90, dso: 70, star: 40 }, best = { "Milky Way core": 88, M31: 84, M45: 82, M42: 80, M13: 74, M8: 72, Polaris: 66 };
    if (raw && raw.length) raw.forEach(function (r) { if (r.up === false || (r.kind === "planet" && r.visible === false && r.mag > 6)) return; var id = String(r.name || r.id || r.label || "Target"); var nm = r.kind === "dso" && r.title ? r.title + (id !== r.title && /^M\d+$/.test(id) ? " (" + id + ")" : "") : id === "Moon" && r.phase ? "The Moon, " + r.phase : id;
      var t = { id: id, name: nm, kind: r.kind || r.type || "", raw: r, mag: r.mag, fov: r.fov }; t.dir = targetDir(t); t.score = (best[id] || rank[t.kind] || 30) - (typeof r.mag === "number" && t.kind === "star" ? r.mag * 4 : 0) + (t.dir ? t.dir.y * 6 : 0); if (t.dir && t.dir.y > 0.05) out.push(t); });
    out.sort(function (a, b) { return b.score - a.score; });
    if (!out.length) { out.push({ name: "Polaris, the North Star", kind: "star", dir: dirFromAltAz(31.34 * PI / 180, 0) });
      try { if (typeof moon !== "undefined" && moon && moon.intensity > 0.001) { var md = moon.position.clone().sub(moon.target ? moon.target.position : new THREE.Vector3()).normalize(); if (md.y > 0.05) out.push({ name: "The Moon", kind: "moon", dir: md }); } } catch (e) {}
      out.push({ name: "The zenith, straight up", kind: "zenith", dir: new THREE.Vector3(0, 1, 0) }); out.fallback = true; }
    return out.slice(0, 9);
  }
  function tonightText() { var T = targets(); if (T.fallback) return C("astronomer.tonightFallback", "Look north for Polaris."); var s = C("astronomer.tonightIntro", "Tonight:") + " " + T.slice(0, 5).map(function (t) { return t.name + ", " + compass(t.dir); }).join("; ") + ". Lie back on a lounger and pick one from the list, I will swing your view onto it."; return s; }
  // where you lie: a lounger on the terrace, the bed in a pyramid; a telescope spot looks along the tube
  function bedSpot(P, r) { var w = l2w(P, r.local[0], r.local[2]); var f = l2w(P, r.foot[0], r.foot[1]); return { kind: "bed", P: P, x: w[0], z: w[1], y: P.D + r.local[1], yaw: Math.atan2(f[0] - w[0], f[1] - w[1]) }; }
  function teleSpot(P) { var q = l2w(P, -2.2 * Math.min(1, P.sz.half / 4.31) + 0.25, 3.15 * Math.min(1, P.sz.half / 4.31) - 0.55); return { kind: "telescope", P: P, x: q[0], z: q[1], y: P.D + 1.55, yaw: P.rot - 0.35, pitch0: 0.62 }; }
  function obsSpot() { var O = SITE.obs; var a = OB.yaw + OB.az; var p = [O.x - Math.sin(a) * 0.95, O.z - Math.cos(a) * 0.95]; return { kind: "observatory", x: p[0], z: p[1], y: O.G + OB.FL + 2.05, yaw: a, pitch0: OB.alt }; }
  function enterStargaze(spot, tele) {
    if (SGM.on || !spot) return; SGM.on = true; SGM.spot = spot; SGM.P = spot.P || null; SGM.tele = !!tele; SGM.t0 = nowMs(); SGM.awarded = false; SGM.k = Math.max(SGM.k, 0); SGM.cam0 = camera.position.clone(); SGM.q0 = camera.quaternion.clone(); SGM.fov0 = camera.fov; if (SGM.cam0.distanceTo(new THREE.Vector3(spot.x, spot.y, spot.z)) > 9) { SGM.cam0.set(spot.x, spot.y, spot.z); SGM.k = 0.35; }
    SGM.yaw = spot.yaw; SGM.pitch = spot.pitch0 !== undefined ? spot.pitch0 : 1.08; if (spot.kind === "bed" || spot.kind === "lounger") { var cd = skyCall(["dirTo"], "core"); if (cd && cd[1] > 0.17) { SGM.yaw = Math.atan2(cd[0], cd[2]); SGM.pitch = Math.max(0.35, Math.min(1.35, Math.asin(Math.max(-1, Math.min(1, cd[1]))))); } } SGM.target = null; SGM.goal = null; SG.n.sessions++;
    try { if (document.exitPointerLock && !SGM.keepLock) {} } catch (e) {}
    try { player.userData.walk.visible = false; player.visible = false; } catch (e) {} try { for (var kk in keys) keys[kk] = false; } catch (e) {}
    skyCall(["setStargaze", "stargaze"], true, { lights: 0.7 }); if (tele) teleOn(true);
    U.uDim.value = 0.55; U.uClearGlow.value = 0; document.body.classList.add("sg-on"); ui(true); audioOn(true); try { sfx("ui"); } catch (e) {}
  }
  function exitStargaze() {
    if (!SGM.on) return; SGM.on = false; if (SGM.tele) teleOn(false); if (SGM.cons) consOn(false); if (SGM.lapse) lapseOn(false);
    skyCall(["setStargaze", "stargaze"], false); U.uDim.value = 1; U.uClearGlow.value = 1; document.body.classList.remove("sg-on"); ui(false); audioOn(false); SGM.target = null;
    try { player.userData.walk.visible = true; player.visible = true; CAM.init = false; } catch (e) {}
  }
  // the telescope: the sky module's eyepiece view (PLAN_SKY.telescopeView: planets with their moons, the deep-sky showcases), drawn
  // in the middle of the screen inside our eyepiece mask; without it, the main view narrows behind the same mask
  function teleOn(on) { SGM.tele = on; var S = SKY(), t = SGM.target || (FR.tg && FR.tg[0]) || null;
    if (S && typeof S.telescopeView === "function") { try { if (on) { var id = t ? (t.id || t.name) : "Moon"; if (!SGM.tv) SGM.tv = S.telescopeView(id, t && t.fov, { size: 768 }); else SGM.tv.set(id, t && t.fov); if (SGM.tv && SGM.tv.show) SGM.tv.show(); } else if (SGM.tv) { if (SGM.tv.hide) SGM.tv.hide(); if (SGM.tv.dispose) SGM.tv.dispose(); SGM.tv = null; } } catch (e) { note("sky telescope", e); } }
    if (on && t && !SGM.goal) { var d = targetDir(t) || t.dir; if (d) SGM.goal = { yaw: Math.atan2(d.x, d.z), pitch: Math.asin(clamp(d.y, -1, 1)), t: 0, y0: SGM.yaw, p0: SGM.pitch }; }
    var m = $id("sg-eye"); if (m) m.classList.toggle("on", on); var u2 = $id("sg-ui"); if (u2) u2.classList.toggle("tele", on); var l = $id("sg-tl"); if (l) l.textContent = on ? teleLabel(t) : ""; uiState(); }
  function teleLabel(t) { var nm = t ? t.name : "The sky"; var f = null; try { f = SGM.tv && SGM.tv.info ? SGM.tv.info().fov : t && t.fov; } catch (e) {} return nm + (f ? " · " + (f < 1 ? Math.round(f * 60) + " arcminute field" : (Math.round(f * 10) / 10) + " degree field") : ""); }
  function consOn(on) { SGM.cons = on; var S = SKY(); if (S) { if (typeof S.constellations === "function") { try { S.constellations(on); } catch (e) { note("sky constellations", e); } } else if (typeof S.setConstellations === "function") { try { S.setConstellations(on); } catch (e) {} } else if ("constellations" in S) { try { S.constellations = on; } catch (e) {} } } uiState(); }
  // star trails: the sky module's time lapse (the sky turns fast and the stars leave trails); without it the clock runs fast for a while
  function lapseOn(on) { SGM.lapse = on; SGM.lapseAt = nowMs(); var F = skyFn(["timeLapse", "timelapse", "starTrails", "trails"]); if (F) { try { F.f.call(F.S, on ? { speed: 90, seconds: 12, trails: true } : false); } catch (e) { note("sky timelapse", e); } SGM.lapseOwn = false; } else { SGM.lapseOwn = on; if (on) { SGM.lapseT = 0; try { SGM.toff0 = timeOffset; } catch (e) {} } else { try { if (SGM.toff0 !== undefined) timeOffset = SGM.toff0; } catch (e) {} } } uiState(); }
  function pick(i) { var T = FR.tg || targets(); var t = T[i]; if (!t) return; SGM.target = t; var d = targetDir(t) || t.dir; if (!d) return; SGM.goal = { yaw: Math.atan2(d.x, d.z), pitch: Math.asin(clamp(d.y, -1, 1)), t: 0, y0: SGM.yaw, p0: SGM.pitch }; if (SGM.tele) teleOn(true); uiState(); try { sfx("ui"); } catch (e) {} }
  // the camera: eased from where it was to your head, then free look; the telescope narrows the field
  function stargazeCam(dt) {
    var sp = SGM.spot; if (!sp) return false; var dur = C("stargaze.settleSeconds", 2.6);
    SGM.k = clamp(SGM.k + (SGM.on ? dt / dur : -dt / 0.8), 0, 1); var k = ease(SGM.k);
    if (SGM.goal) { var G0 = SGM.goal; G0.t = Math.min(1, G0.t + dt / 1.3); var e2 = ease(G0.t); var dy = Math.atan2(Math.sin(G0.yaw - G0.y0), Math.cos(G0.yaw - G0.y0)); SGM.yaw = G0.y0 + dy * e2; SGM.pitch = lerp(G0.p0, G0.pitch, e2); if (G0.t >= 1) SGM.goal = null; }
    _hv.set(sp.x, sp.y, sp.z); var cp = Math.cos(SGM.pitch); _dv.set(Math.sin(SGM.yaw) * cp, Math.sin(SGM.pitch), Math.cos(SGM.yaw) * cp);
    _mL.lookAt(_hv, _c0.copy(_hv).add(_dv), _up); _q1.setFromRotationMatrix(_mL);
    var p0 = SGM.cam0 || _hv, q0 = SGM.q0 || _q1; camera.position.lerpVectors(p0, _hv, k); camera.quaternion.slerpQuaternions(q0, _q1, k);
    var fovT = SGM.on ? (SGM.tele && !skyFn(["telescopeView", "telescope"]) ? C("stargaze.telescopeFov", 6) : C("stargaze.fov", 72)) : SGM.fov0 || 62; var f = lerp(SGM.fov0 || 62, fovT, k); if (SGM.tele && SGM.on) f = lerp(camera.fov, fovT, Math.min(1, dt * 3)); if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); }
    if (!SGM.on && SGM.k <= 0.001) { SGM.spot = null; try { player.userData.walk.visible = true; player.visible = true; } catch (e) {} return false; }
    return true;
  }
  function stargazeFrame(dt) {
    if (!SGM.on) { if (SGM.lapseOwn) lapseOn(false); return; }
    // the first session (a few seconds lying back) stamps the passport and gives the first-time XP
    if (!SGM.awarded && nowMs() - SGM.t0 > C("stargaze.firstSessionSeconds", 8) * 1000) { SGM.awarded = true; try { var PP = window.PLAN_PROGRESS; if (PP && PP.award) { PP.award("activity", { game: C("progress.activity", "stargaze") }); PP.award("stamp", { id: C("progress.stampFirst", "p_first_stargaze") }); } } catch (e) { note("award", e); } }
    if (SGM.lapse && !SGM.lapseOwn && nowMs() - SGM.lapseAt > 1500) { try { var st = SKY().state(); if (!st.timeLapse) { SGM.lapse = false; uiState(); } } catch (e) {} }
    if (SGM.lapseOwn) { SGM.lapseT += dt; try { timeOffset += dt * 900; } catch (e) {} if (SGM.lapseT > 10) lapseOn(false); }
    // the radio and the wind give way to the night; a quiet ambient bed fades in
    try { if (typeof RADIO !== "undefined") RADIO.a.volume = Math.min(RADIO.a.volume, 0.025); if (typeof AUD !== "undefined" && AUD.wind) AUD.wind.volume = Math.min(AUD.wind.volume, 0.07); } catch (e) {}
    audioFrame(dt);
    FR.tgT = (FR.tgT || 0) - dt; if (FR.tgT <= 0) { FR.tgT = 5; FR.tg = targets(); uiList(); }
    var day = nightK() < 0.3, el = $id("sg-day"); if (el) el.style.opacity = day ? "1" : "0";
  }
  // the soundscape: the client's night crickets carry on; under them a soft ambient bed (the Dark Sky Ambient station), faded in
  var AMBI = SG.ambi = SG.ambi || { a: null, want: 0 };
  function audioOn(on) { try { if (on && !AMBI.a) { AMBI.a = new Audio("/audio/radio_ambient.m4a"); AMBI.a.loop = true; AMBI.a.volume = 0; } AMBI.want = on ? 1 : 0; if (on && AMBI.a && typeof soundOn !== "undefined" && soundOn && audioReady) AMBI.a.play().catch(function () {}); } catch (e) { note("audio", e); } }
  function audioFrame(dt) { var a = AMBI.a; if (!a) return; var on = (typeof soundOn !== "undefined" && soundOn && typeof audioReady !== "undefined" && audioReady) ? 1 : 0; var v = 1; try { v = VOL.amb * VOL.master; } catch (e) {} var want = AMBI.want * on * C("stargaze.ambientVolume", 0.22) * v; a.volume = clamp(a.volume + (want - a.volume) * Math.min(1, dt * 0.8), 0, 1); if (want > 0 && a.paused) a.play().catch(function () {}); if (want <= 0 && a.volume < 0.005 && !a.paused) a.pause(); }
  function ambientTick(dt) { if (!SGM.on && AMBI.a && !AMBI.a.paused) audioFrame(dt); }

  // ── the overlay: a small title, the hint line, what is up tonight, four buttons, an eyepiece mask, a daytime note ──
  function css() { if ($id("sg-css")) return; var s = document.createElement("style"); s.id = "sg-css";
    s.textContent = "body.sg-on>*:not(canvas):not(#sg-ui):not(#sg-eye):not(#talk):not(#info):not(#fade):not(script):not(style){opacity:0!important;pointer-events:none!important;transition:opacity 1.2s}" +
      "#sg-ui{position:fixed;inset:0;pointer-events:none;z-index:40;opacity:0;transition:opacity 1.4s;font-family:'Space Grotesk',system-ui,sans-serif;color:#f3dcc0}#sg-ui.on{opacity:1}#sg-ui.tele .l,#sg-ui.tele .h{opacity:0;pointer-events:none;transition:opacity .6s}" +
      "#sg-ui .t{position:absolute;left:50%;top:18px;transform:translateX(-50%);font:600 11px 'JetBrains Mono',monospace;letter-spacing:.32em;text-transform:uppercase;color:rgba(255,206,160,.78)}" +
      "#sg-ui .h{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);font:500 12px 'Space Grotesk',sans-serif;color:rgba(255,214,176,.62);white-space:nowrap;max-width:94vw;overflow:hidden;text-overflow:ellipsis}" +
      "#sg-ui .l{position:absolute;right:18px;top:50%;transform:translateY(-50%);width:min(250px,42vw);pointer-events:auto}#sg-ui .l b{display:block;font:600 10px 'JetBrains Mono',monospace;letter-spacing:.24em;text-transform:uppercase;color:rgba(255,190,140,.7);margin:0 0 8px 2px}" +
      "#sg-ui .l button{display:flex;gap:9px;align-items:baseline;width:100%;text-align:left;background:rgba(14,10,8,.38);border:1px solid rgba(255,190,140,.12);color:#f3dcc0;border-radius:8px;padding:6px 9px;margin:0 0 5px;font:500 12.5px 'Space Grotesk',sans-serif;cursor:pointer;backdrop-filter:blur(2px)}#sg-ui .l button:hover,#sg-ui .l button.on{border-color:rgba(255,190,140,.5);background:rgba(40,20,12,.5)}#sg-ui .l button i{font:600 10px 'JetBrains Mono',monospace;color:rgba(255,170,110,.75);font-style:normal}#sg-ui .l button small{display:block;color:rgba(243,220,192,.55);font-size:10.5px}" +
      "#sg-ui .b{position:absolute;left:50%;bottom:52px;transform:translateX(-50%);display:flex;gap:8px;pointer-events:auto}#sg-ui .b button{background:rgba(14,10,8,.42);border:1px solid rgba(255,190,140,.18);color:#f3dcc0;border-radius:999px;padding:7px 14px;font:600 10.5px 'JetBrains Mono',monospace;letter-spacing:.14em;text-transform:uppercase;cursor:pointer}#sg-ui .b button.on{background:rgba(120,50,20,.45);border-color:rgba(255,170,110,.6)}" +
      "#sg-ui .d{position:absolute;left:50%;top:48px;transform:translateX(-50%);font:italic 500 14px 'Fraunces',Georgia,serif;color:rgba(255,226,196,.85);opacity:0;transition:opacity 1s;text-align:center;max-width:80vw}" +
      "#sg-tl{position:absolute;left:50%;top:calc(50% + 33vmin);transform:translateX(-50%);font:600 11px 'JetBrains Mono',monospace;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,190,140,.8);white-space:nowrap}#sg-eye{position:fixed;inset:0;pointer-events:none;z-index:39;opacity:0;transition:opacity .8s;background:radial-gradient(circle at 50% 50%,transparent 0,transparent 30.7vmin,#000 31.2vmin)}#sg-eye.on{opacity:1}#sg-eye:after{content:'';position:absolute;left:50%;top:50%;width:62vmin;height:62vmin;transform:translate(-50%,-50%);border-radius:50%;box-shadow:inset 0 0 6vmin rgba(0,0,0,.6)}" +
      "@media (max-width:700px){#sg-ui .l{top:auto;bottom:96px;transform:none;right:10px;width:min(220px,56vw)}#sg-ui .h{display:none}}";
    document.head.appendChild(s); }
  function ui(on) { css(); var U2 = $id("sg-ui"); if (!U2) { U2 = document.createElement("div"); U2.id = "sg-ui"; var c = C("stargaze.ui", {});
      U2.innerHTML = '<div class="t"></div><div class="d" id="sg-day"></div><div class="l"><b></b><div class="li"></div></div><div class="b"><button data-a="cons"></button><button data-a="tele"></button><button data-a="lapse"></button><button data-a="exit"></button></div><div class="h"></div>';
      U2.querySelector(".t").textContent = c.title || "Stargazing"; U2.querySelector(".h").textContent = c.hint || ""; U2.querySelector(".l b").textContent = c.upTonight || "Up tonight"; U2.querySelector(".d").textContent = c.daytime || "";
      U2.querySelector('[data-a="cons"]').textContent = "C · " + (c.constellationsOn ? "Constellations" : "Constellations"); U2.querySelector('[data-a="tele"]').textContent = "T · " + (c.telescope || "Telescope"); U2.querySelector('[data-a="lapse"]').textContent = "L · " + (c.timelapse || "Star trails"); U2.querySelector('[data-a="exit"]').textContent = "E · " + (c.exit || "Get up");
      U2.addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; e.stopPropagation(); var a = b.getAttribute("data-a"); if (a === "cons") consOn(!SGM.cons); else if (a === "tele") teleOn(!SGM.tele); else if (a === "lapse") lapseOn(!SGM.lapse); else if (a === "exit") exitStargaze(); else if (b.hasAttribute("data-i")) pick(+b.getAttribute("data-i")); });
      document.body.appendChild(U2); var E2 = document.createElement("div"); E2.id = "sg-eye"; E2.innerHTML = '<div id="sg-tl"></div>'; document.body.appendChild(E2); }
    U2.classList.toggle("on", on); if (on) { FR.tg = targets(); uiList(); uiState(); } }
  function uiList() { var box = document.querySelector("#sg-ui .li"); if (!box) return; var T = FR.tg || []; var c = C("stargaze.ui", {}); box.innerHTML = T.length ? T.map(function (t, i) { var d = t.dir || targetDir(t); return '<button data-i="' + i + '"' + (SGM.target && SGM.target.name === t.name ? ' class="on"' : "") + "><i>" + (i + 1) + "</i><span>" + esc(t.name) + (d ? "<small>" + esc(compass(d)) + "</small>" : "") + "</span></button>"; }).join("") : "<small>" + esc(c.noTargets || "") + "</small>"; }
  function uiState() { var U2 = $id("sg-ui"); if (!U2) return; U2.querySelector('[data-a="cons"]').classList.toggle("on", !!SGM.cons); U2.querySelector('[data-a="tele"]').classList.toggle("on", !!SGM.tele); U2.querySelector('[data-a="lapse"]').classList.toggle("on", !!SGM.lapse); uiList(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  // input while lying back: keys are ours (the player does not walk), the mouse and touch look round the sky
  function onKey(e) {
    if (!SGM.on || e.type !== "keydown") return; var c = e.code; if (/^(F\d+|KeyN|MetaLeft|MetaRight|AltLeft|AltRight|ControlLeft|ControlRight)$/.test(c)) return; var tag = (e.target && e.target.tagName) || ""; if (tag === "INPUT" || tag === "TEXTAREA") return;
    e.stopImmediatePropagation(); e.preventDefault(); if (e.repeat) return;
    if (c === "Escape" || c === "KeyE") exitStargaze(); else if (c === "KeyC") consOn(!SGM.cons); else if (c === "KeyT") teleOn(!SGM.tele); else if (c === "KeyL") lapseOn(!SGM.lapse); else if (/^Digit[1-9]$/.test(c)) pick(+c.slice(5) - 1);
    else if (c === "ArrowLeft") SGM.yaw += 0.08; else if (c === "ArrowRight") SGM.yaw -= 0.08; else if (c === "ArrowUp") SGM.pitch = clamp(SGM.pitch + 0.06, -0.15, 1.56); else if (c === "ArrowDown") SGM.pitch = clamp(SGM.pitch - 0.06, -0.15, 1.56);
  }
  function lookBy(dx, dy) { var s = (camera.fov || 60) / 72; SGM.yaw -= dx * 0.0024 * s; SGM.pitch = clamp(SGM.pitch - dy * 0.0021 * s, -0.15, 1.56); SGM.goal = null; }
  var DRAG = { on: false, x: 0, y: 0, id: null };
  function onMove(e) { if (!SGM.on) return; var locked = !!document.pointerLockElement; if (locked) { lookBy(e.movementX || 0, e.movementY || 0); e.stopImmediatePropagation(); return; } if (DRAG.on && (e.buttons & 1)) { lookBy(e.clientX - DRAG.x, e.clientY - DRAG.y); DRAG.x = e.clientX; DRAG.y = e.clientY; e.stopImmediatePropagation(); } }
  function onDown(e) { if (!SGM.on || (e.target && e.target.closest && e.target.closest("#sg-ui button,#talk,#info"))) return; DRAG.on = true; DRAG.x = e.clientX; DRAG.y = e.clientY; e.stopImmediatePropagation(); }
  function onUp() { DRAG.on = false; }
  function onTouch(e) { if (!SGM.on || !e.touches || !e.touches.length) return; if (e.target && e.target.closest && e.target.closest("#sg-ui button")) return; var t = e.touches[0]; if (e.type === "touchstart") { DRAG.x = t.clientX; DRAG.y = t.clientY; } else { lookBy((t.clientX - DRAG.x) * 1.4, (t.clientY - DRAG.y) * 1.4); DRAG.x = t.clientX; DRAG.y = t.clientY; } e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); }
  try { if (SG.old && SG.old.ls) SG.old.ls.forEach(function (l) { removeEventListener(l[0], l[1], true); }); SG.listeners = [["keydown", onKey], ["mousemove", onMove], ["mousedown", onDown], ["mouseup", onUp], ["touchstart", onTouch], ["touchmove", onTouch]];
    SG.listeners.forEach(function (l) { addEventListener(l[0], l[1], /^touch/.test(l[0]) ? { capture: true, passive: false } : true); }); } catch (e) { note("input", e); }
  // ───────────────────────── the resident astronomer (a client avatar in the CAST: greets, turns to you, talk card on E) ─────────────────────────
  function buildAstronomer(S) {
    var A = C("astronomer", null); if (!A || typeof avatar !== "function" || CAST.some(function (c) { return c.id === A.id; })) return;
    var at = AM.speaker || [C("site.astronomer.x", 760), C("site.astronomer.z", 786)]; var y = planGroundAt(at[0], at[1]);
    var g = avatar("cast_" + A.id, A.name, A.look || {}, null, null); g.position.set(at[0], y, at[1]); g.rotation.y = Math.atan2(S.amph.x - at[0], S.amph.z - at[1]); try { g.userData.label.scale.set(1.9, 0.48, 1); } catch (e) {} scene.add(g);
    var talk = (A.talk || []).map(function (n) { if (/\{tonight\}/.test(n.t)) return { get t() { return n.t.replace("{tonight}", tonightText()); }, o: n.o }; return { t: n.t, o: n.o }; });
    var c = { id: A.id, name: A.name, role: A.role, pos: [at[0], at[1]], look: A.look, hat: null, outfit: null, greet: A.greet || ["Clear skies."], talk: talk, kw: (A.kw || []).map(function (q) { return [new RegExp(q[0], "i"), q[1]]; }), g: g, rot: g.rotation.y };
    CAST.push(c); hotspots.push({ x: at[0], z: at[1], r: 5, t: c.name, k: c.role + " · press E to talk", p: talk[0] ? talk[0].t : "", play: "npc:" + c.id }); SG.astro = c; SG.n.astronomer = 1;
  }

  // ───────────────────────── defer hook: build everything at its final height ─────────────────────────
  function strays(S) { var n = 0; for (var i = SOLIDS.length - 1; i >= 0; i--) { var sd = SOLIDS[i]; if (sd.tag === "stargaze" || SG.sol.indexOf(sd) >= 0) continue; if (sd.hw > 3 || sd.hd > 3) continue; if (inFootprint(S, sd.x, sd.z, false)) { SOLIDS.splice(i, 1); n++; } }
    for (var j = COLLIDERS.length - 1; j >= 0; j--) { var c = COLLIDERS[j]; if (c[2] < 3 && inFootprint(S, c[0], c[1], false)) { COLLIDERS.splice(j, 1); n++; } } SG.n.strays = n; }
  function deferHook() {
    if (SG.off || !window.PLAN || !SITE) return; var S = SITE, t0 = nowMs(); var sx = 0, sz = 0; S.pyr.forEach(function (P) { sx += P.x; sz += P.z; }); S.cx = sx / S.pyr.length; S.cz = sz / S.pyr.length;
    var step = function (name, fn) { var t = nowMs(); try { fn(); } catch (e) { note(name, e); } SG.n["ms_" + name] = Math.round(nowMs() - t); };
    step("strays", function () { strays(S); });
    step("exterior", function () { buildExterior(S); }); step("bollards", function () { buildBollards(S); });
    step("solids", function () { S.pyr.forEach(function (P) { pyramidSolids(P, S.deckH); }); });
    step("observatory", function () { buildObservatory(S); }); step("theatre", function () { buildTheatre(S); }); step("terrace", function () { buildTerrace(S); }); step("lot", function () { buildLotAndSign(S); });
    step("perf", function () { perfRooms(S); var W = window.PLAN_PERF; if (W && W.warmGroup) [EX.g, OB.g, AM.g, TR.g].forEach(function (g) { if (g) W.warmGroup(g, { name: g.name }); }); });
    SG.n.deferMs = Math.round(nowMs() - t0); SG.ready = true;
  }
  // indoor culling (plan_perf): inside a frosted pyramid only the clear door looks out; clear glass opens all four faces and
  // the top; in the dome, the door and (after dark) the open slit. plan_perf asks PLAN_PERF.rooms for the room the camera is in.
  function perfRooms(S) {
    var W = window.PLAN_PERF; if (!W) return; W.rooms = W.rooms || []; if (W.rooms.some(function (r) { return r.name === "stargaze"; })) return;
    S.pyr.forEach(function (P) { P.perfSig = function () { return (P.frostT > 0.5 ? 1 : 2) + (P.L && P.L.door && P.L.door.open > 0.1 ? 4 : 0); };
      P.perfRoom = function (R) { var h = P.sz.half, Hh = P.sz.H, D = { kind: "stargaze " + P.id, M: pyrMatrix(P), boxes: [[-h, h, -0.6, Hh, -h, h]], rects: [R("x", h, -0.6, 0.6, 0, 2.35)], roots: P.L ? [P.L.g] : [] };
        if (P.frostT <= 0.5) D.rects.push(R("x", h, -h, h, 0, Hh), R("x", -h, -h, h, 0, Hh), R("z", h, -h, h, 0, Hh), R("z", -h, -h, h, 0, Hh), R("y", Hh, -h, h, -h, h)); return D; }; });
    if (OB.g) { OB.perfSig = function () { return OB.shut > 0.3 ? 2 : 1; }; OB.perfRoom = function (R) { OB.g.updateMatrixWorld(true); var r = SITE.obs.r, top = OB.top; var D = { kind: "stargaze observatory", M: OB.g.matrixWorld.clone(), boxes: [[-r, r, -0.5, top + SITE.obs.domeR, -r, r]], rects: [R("x", r, -0.75, 0.75, 0, 2.6)], roots: [OB.g] }; if (OB.shut > 0.3) D.rects.push(R("y", top + 1.2, -r, r, -r, r)); return D; }; }
    W.rooms.push({ name: "stargaze", key: function () { if (!SITE || SGM.on) return null; var c = camera.position; if (c.x < 585 || c.x > 820 || c.z < 700 || c.z > 870) return null;
      var P = pyramidAt(c.x, c.z, c.y - 1.4); if (P && inPyrVolume(P, c.x, c.y, c.z, 0)) return P;
      if (OB.g && Math.hypot(c.x - SITE.obs.x, c.z - SITE.obs.z) < SITE.obs.r - 0.3 && c.y < SITE.obs.G + OB.top + 2) return OB; return null; } });
  }

  // ───────────────────────── hooks, API ─────────────────────────
  SG.impl = { handleE: handleE, prompt: promptFrame, frame: frameHook, cam: camHook };
  SG.api = { resolveSite: resolveSite, l2w: l2w, w2l: w2l, buildInterior: buildInterior, disposeInterior: disposeInterior, enterStargaze: enterStargaze, exitStargaze: exitStargaze, targets: targets, tonightText: tonightText, setGlass: setGlass, pyramidAt: pyramidAt, bedSpot: bedSpot, teleSpot: teleSpot, obsSpot: obsSpot };
  SG.debug = {
    // stand the player at a pyramid's local spot (lx, lz) facing yawL (local); returns the world point
    at: function (id, lx, lz, yawL) { var P = SITE.pyr.find(function (q) { return q.id === id; }); if (!P) return null; var w = l2w(P, lx, lz); player.position.set(w[0], P.D + 0.02, w[1]); if (yawL !== undefined) yaw = P.rot + yawL; return [w[0], P.D, w[1]]; },
    lie: function (which, instant) { if (instant) setTimeout(function () { SGM.k = 1; }, 0); if (which === "bed") { var P = listOpen()[0]; if (!P) return "no open pyramid"; if (!P.L) P.L = buildInterior(P); return enterStargaze(bedSpot(P, P.L.recl[0]), false), "bed"; } var s = (TR.spots || [])[which | 0]; if (s) { enterStargaze(s, false); return "lounger " + (which | 0); } return null; },
    tele: function (where) { if (where === "obs") enterStargaze(obsSpot(), true); else { var P = listOpen()[0]; if (!P.L) P.L = buildInterior(P); enterStargaze(teleSpot(P), true); } return SGM.on; },
    up: function () { exitStargaze(); return true; }, cons: function (on) { consOn(on !== false); return SGM.cons; }, pick: function (i) { pick(i | 0); return SGM.target && SGM.target.name; },
    frost: function (id, on) { var P = SITE.pyr.find(function (q) { return q.id === id; }); if (!P) return null; P.userFrost = !!on; return P.userFrost; },
    shutter: function (v) { OB.shut = v; return v; }, build: function (id) { var P = SITE.pyr.find(function (q) { return q.id === id; }) || listOpen()[0]; if (!P.L) P.L = buildInterior(P); return !!P.L; },
    door: function (id, t) { var P = SITE.pyr.find(function (q) { return q.id === id; }) || listOpen()[0]; if (!P || !P.L) return null; var D = P.L.door; D.manual = true; D.target = D.open = t; D.piv.rotation.y = -ease(t) * 1.55; doorSolidOn(P, t < 0.45); return t; }
  };
  (function hookAll() {
    var set = function (phase, name, fn) { var list = window.PLAN_HOOKS[phase]; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name: name, fn: fn }); };
    set("world", "stargazeWorld", function () { worldHook(); try { if (SITE) lotPuts(SITE); } catch (e) { note("lot puts", e); } });
    set("terrain", "stargazeTerrain", function () { terrainHook(); });
    set("defer", "stargazeDefer", function () { deferHook(); });
    set("frame", "stargazeFrame", function (dt, now) { SG.impl.frame(dt, now); ambientTick(dt); });
    set("interior", "stargazeCam", function (dt) { return SG.impl.cam(dt); });
  })();
  // development: evaluating this file again in a running game rebuilds every visual from the JSON (the grading, paths and planting stay)
  function hotReload() {
    var O = SG.old; CFG = SG.cfg = null; cfg(); SITE = SG.site; ["sg-ui", "sg-eye", "sg-css"].forEach(function (id) { var el = $id(id); if (el) el.remove(); });
    [O.ex && O.ex.g, O.ob && O.ob.g, O.am && O.am.g, O.tr && O.tr.g, O.lot, O.steam].forEach(function (g) { if (g) scene.remove(g); });
    (O.sol || []).forEach(function (sd) { var i = SOLIDS.indexOf(sd); if (i >= 0) SOLIDS.splice(i, 1); });
    SITE.pyr.forEach(function (P) { if (P.L) { try { scene.remove(P.L.g); P.L.solids.forEach(function (sd) { var i = SOLIDS.indexOf(sd); if (i >= 0) SOLIDS.splice(i, 1); }); } catch (e) {} P.L = null; } P.doorSolid = null; });
    if (O.astro) { var ci = CAST.indexOf(O.astro); if (ci >= 0) CAST.splice(ci, 1); scene.remove(O.astro.g); for (var h = hotspots.length - 1; h >= 0; h--) if (hotspots[h].play === "npc:" + O.astro.id) hotspots.splice(h, 1); SG.astro = null; }
    try { var W = window.PLAN_PERF; if (W && W.rooms) W.rooms = W.rooms.filter(function (r) { return r.name !== "stargaze"; }); } catch (e) {}
    SITE.pathsDone = true; deferHook(); SG.n.hot = (SG.n.hot || 0) + 1; SG.old = null;
  }
  if (SG.old && typeof scene !== "undefined" && SG.site) { try { hotReload(); } catch (e) { note("hot reload", e); } }
})();
