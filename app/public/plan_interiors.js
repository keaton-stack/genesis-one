// plan_interiors.js · INT3 (30 Sep 2026): walkable interiors for the rebuilt clubhouse (both), the five restaurants and the
// hangar homes (all 24; Founders Row and Flight Line Row). Classic script, loaded before client.js; no top-level const/let,
// everything lives in the IIFE and on window.PLAN_INTERIORS.
//
// How it works (PLAN mode only):
// - The shells (models/clubhouse.glb, restaurant.glb, hangarhome2.glb) are single closed outer surfaces. A small shader chain on
//   their materials cuts the door opening of the ACTIVE building (and, on a hangar home, its glazed hangar door) and, while the
//   camera is inside that building, drops the shell's back faces inside its footprint: from inside, the windows of the interior
//   look out at the real world; from outside the shell looks exactly as before.
// - The interior of the nearest building of these kinds is built when you come within about 40 m (the door leaves swing open as
//   you walk up, so the room shows through the opening) and disposed at about 75 m. One interior at a time.
// - Walking through the door sets the client's `inside` (its seats, talk cards, floor and camera rules) without a fade or a
//   teleport; walking out clears it. The building's box solid and circle collider are swapped for wall, porch and step solids
//   while its interior exists. enterInterior / leaveInterior / openNearest / updateZone are wrapped by bare name in the world
//   hook and fall through to the previous functions (plan_hangars.js and the client) for everything else.
// - Copy (the bartender, the waiter, the restaurant menus, the hangar home room notes) lives in plan/interiors.json.
// - Furniture models come from kinds that are already boot kinds (jetsofa, jettable, jetbar, jetlamp, lounge_chair, exec_desk,
//   bookcase, term_planter, cart, jet_light); a kind added to LAZY below is registered lazy and fetched with
//   window.PLAN_LOAD_KINDS on approach (120 m). The rest is procedural, merged per material.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || [];
window.PLAN_MODEL_LAZY = window.PLAN_MODEL_LAZY || [];
window.PLAN_TALK = window.PLAN_TALK || {};
window.PLAN_INTERIORS = window.PLAN_INTERIORS || {};
(function () {
  "use strict";
  var IN = window.PLAN_INTERIORS;
  IN.v = 1; IN.errs = IN.errs || []; IN.n = IN.n || { builds: 0, disposes: 0, enters: 0, leaves: 0 }; IN.list = IN.list || []; IN.cfg = IN.cfg || null; IN.off = !!IN.off;
  var LAZY = []; LAZY.forEach(function (k) { if (window.PLAN_MODEL_LAZY.indexOf(k) < 0) window.PLAN_MODEL_LAZY.push(k); });
  function note(tag, e) { try { if (IN.errs.length < 40) IN.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (IN.errs.length <= 6) console.warn("plan_interiors " + tag, e); } catch (x) {} }
  var R9I = !!(window.R9 && window.R9.part("i"));
  // R14 (HANDOFF_R14_VENUES.md): real paintings (generated, tex/rv_i3_*) in place of the procedural canvases, photographed back-bar
  // bottles on the clubhouse and restaurant bars, and the Main Street Grill, Outpost and Launch Complex art. ?r14i=0 brings back R3.
  var R14I = !/[?&]r14i=0/.test(location.search);
  function r14tex(url, rep) { try { var t = new THREE.TextureLoader().load((window.AV || String)(url + "?v=" + (window.BUILD || "r14"))); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; if (rep) { t.wrapS = THREE.RepeatWrapping; t.repeat.set(rep, 1); } return t; } catch (e) { note("r14 tex " + url, e); return null; } }   // R9 (HANDOFF_R9_HITCHES.md): ?r9i=0 turns this module's hitch fixes off
  var TAU = Math.PI * 2, PI = Math.PI;
  var cl = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var ease = function (t) { t = cl(t, 0, 1); return t * t * (3 - 2 * t); };
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function has(k) { try { return !!(MODELS[k] && MODELS[k].parts && MODELS[k].parts.length); } catch (e) { return false; } }

  // ───────────────────────── editable copy (plan/interiors.json) with a built-in fallback ─────────────────────────
  var DEF = {
    clubhouse: { names: { b0036: "The Landing Clubhouse", b0292: "The Golf Clubhouse" },
      bartender: { name: "Marco", role: "Bartender · {club}", greet: ["Evening. Pull up a stool."], talk: [{ t: "Welcome to {club}. The fire is lit, the bar is open and the Grill Room has the best view of the course.", o: [["Thanks", null]] }] } },
    restaurant: { venues: {}, waiter: { name: "Server", role: "Server · {venue}", greet: ["Welcome in."], talk: [{ t: "Welcome to {venue}. Sit anywhere you like; the kitchen is open.", o: [["Thanks", null]] }] } },
    hangarhome: { rooms: {} }
  };
  function C() { return IN.cfg || DEF; }
  function sect(k) { var c = C(); return (c && c[k]) || DEF[k] || {}; }
  try { fetch((window.AV || String)("/plan/interiors.json?v=" + (window.BUILD || "0"))).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && typeof j === "object") { IN.cfg = j; try { refreshTalk(); } catch (e) { note("talk late", e); } } }).catch(function (e) { note("json", e); }); } catch (e) { note("json", e); }

  // ───────────────────────── canvas and texture helpers ─────────────────────────
  var FT = { ui: "'Space Grotesk', 'Segoe UI', system-ui, sans-serif", serif: "'Fraunces', Georgia, 'Times New Roman', serif", cond: "'Anton', 'Oswald', 'Arial Narrow', Impact, sans-serif", hand: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive" };
  var TX = IN.tx = IN.tx || {};
  function cv(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function mkTex(c, rep, lin) { var t = new THREE.CanvasTexture(c); if (!lin) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; try { if (typeof MAX_ANISO !== "undefined") t.anisotropy = Math.min(8, MAX_ANISO); } catch (e) {} t.needsUpdate = true; return t; }
  function panel(key, W, H, fn, rep, lin) { if (TX[key]) return TX[key]; var c = cv(W, H), x = c.getContext("2d"); try { fn(x, W, H); } catch (e) { note("panel " + key, e); } return (TX[key] = mkTex(c, rep, lin)); }
  function txt(x, t, px, py, font, color, ls, align, maxW) { x.font = font; x.fillStyle = color; x.textAlign = align || "center"; x.textBaseline = "middle"; try { x.letterSpacing = (ls || 0) + "px"; } catch (e) {} if (maxW) { var w = x.measureText(t).width; if (w > maxW) { x.save(); x.translate(px, py); x.scale(maxW / w, 1); x.fillText(t, 0, 0); x.restore(); try { x.letterSpacing = "0px"; } catch (e) {} return; } } x.fillText(t, px, py); try { x.letterSpacing = "0px"; } catch (e) {} }
  function rrect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.lineTo(a + w - r, b); x.quadraticCurveTo(a + w, b, a + w, b + r); x.lineTo(a + w, b + h - r); x.quadraticCurveTo(a + w, b + h, a + w - r, b + h); x.lineTo(a + r, b + h); x.quadraticCurveTo(a, b + h, a, b + h - r); x.lineTo(a, b + r); x.quadraticCurveTo(a, b, a + r, b); x.closePath(); }
  function noise(x, W, H, n, a, s0, s1) { var R = rng(W * 7 + H + n); for (var i = 0; i < n; i++) { x.fillStyle = R() < 0.5 ? "rgba(255,255,255," + a + ")" : "rgba(0,0,0," + a + ")"; var r = s0 + R() * (s1 - s0); x.fillRect(R() * W, R() * H, r, r); } }
  function tiled(path, col, rough, nk, extra) { try { var ld = new THREE.TextureLoader(); var mk = function (p, srgb) { var t = ld.load(p); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }; return new THREE.MeshStandardMaterial(Object.assign({ map: mk(path + ".jpg", true), normalMap: mk(path + "_n.jpg"), roughnessMap: mk(path + "_r.jpg"), color: col === undefined ? 0xffffff : col, roughness: rough || 1, normalScale: new THREE.Vector2(nk || 0.6, nk || 0.6) }, extra || {})); } catch (e) { note("tiled " + path, e); return new THREE.MeshStandardMaterial({ color: col || 0xcccccc, roughness: rough || 0.8 }); } }

  // ───────────────────────── geometry kit: primitives collected per material key, merged into one mesh per key ─────────────────────────
  function mergeGeos(list) {
    var nv = 0, ni = 0; for (var i = 0; i < list.length; i++) { var g = list[i]; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    var pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), nrm = new Float32Array(nv * 3), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni); var vo = 0, io = 0;
    for (var j = 0; j < list.length; j++) { var q = list[j]; var c = q.attributes.position.count; pos.set(q.attributes.position.array, vo * 3); if (q.attributes.uv) uv.set(q.attributes.uv.array, vo * 2); if (q.attributes.normal) nrm.set(q.attributes.normal.array, vo * 3);
      if (q.index) { var ia = q.index.array; for (var k = 0; k < ia.length; k++) idx[io + k] = ia[k] + vo; io += ia.length; } else { for (var k2 = 0; k2 < c; k2++) idx[io + k2] = vo + k2; io += c; } vo += c; }
    var out = new THREE.BufferGeometry(); out.setAttribute("position", new THREE.BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3)); out.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); out.setIndex(new THREE.BufferAttribute(idx, 1)); out.computeBoundingSphere(); out.computeBoundingBox(); return out;
  }
  var TILE = { tan: 0.8, ox: 0.8, walnut: 1.2, oakP: 1.4, burl: 1.0, turf: 2.0, oak: 1.6, trav: 1.2, plaster: 2.0, sand: 2.0, stone: 1.6, marble: 1.4, concrete: 3.0, epoxy: 6.0, terra: 1.2, leather: 0.8, carpet: 1.5, rugA: 0, rugB: 0 };
  function uvBox(g, w, h, d, t) { var uv = g.attributes.uv; var dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (var f = 0; f < 6; f++) for (var k = 0; k < 4; k++) { var i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } }
  var _m4 = new THREE.Matrix4(), _eu = new THREE.Euler();
  function Kit() { this.m = {}; }
  Kit.prototype.put = function (key, g) { (this.m[key] || (this.m[key] = [])).push(g); return g; };
  Kit.prototype.box = function (key, w, h, d, x, y, z, ry, t) { if (w <= 0 || h <= 0 || d <= 0) return null; var g = new THREE.BoxGeometry(w, h, d); var tt = t !== undefined ? t : TILE[key]; if (tt) uvBox(g, w, h, d, tt); _m4.makeRotationY(ry || 0); _m4.setPosition(x, y, z); g.applyMatrix4(_m4); return this.put(key, g); };
  // a box given by its min/max corners (axis aligned in the room frame)
  Kit.prototype.bb = function (key, x0, y0, z0, x1, y1, z1, t) { return this.box(key, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, t); };
  Kit.prototype.cyl = function (key, r1, r2, h, x, y, z, seg, rx, rz, ry) { var g = new THREE.CylinderGeometry(r1, r2, h, seg || 16); _eu.set(rx || 0, ry || 0, rz || 0); _m4.makeRotationFromEuler(_eu); _m4.setPosition(x, y, z); g.applyMatrix4(_m4); return this.put(key, g); };
  Kit.prototype.sph = function (key, r, x, y, z, sy, seg) { var g = new THREE.SphereGeometry(r, seg || 16, Math.max(6, (seg || 16) >> 1)); if (sy) g.scale(1, sy, 1); g.translate(x, y, z); return this.put(key, g); };
  // a quad facing +z at ry 0 (rx tilts it), w x h; uv in metres / tile when tile [tx, ty] is given (else 0..1)
  Kit.prototype.quad = function (key, w, h, x, y, z, ry, rx, tile) { var g = new THREE.PlaneGeometry(w, h); if (tile) { var uv = g.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile[0], uv.getY(i) * h / tile[1]); } _eu.set(rx || 0, ry || 0, 0, "YXZ"); _m4.makeRotationFromEuler(_eu); _m4.setPosition(x, y, z); g.applyMatrix4(_m4); return this.put(key, g); };
  // a horizontal floor or ceiling rectangle (up: true faces up), uv in metres / tile
  Kit.prototype.flat = function (key, x0, z0, x1, z1, y, up, t, ur) { var w = Math.abs(x1 - x0), d = Math.abs(z1 - z0); if (w < 0.01 || d < 0.01) return null; var tt = t !== undefined ? t : (TILE[key] || 1); var g = this.quad(key, w, d, (x0 + x1) / 2, y, (z0 + z1) / 2, 0, up === false ? PI / 2 : -PI / 2, tt ? [tt, tt] : null);
    if (ur && g) { var uv = g.attributes.uv, c = Math.cos(ur), s = Math.sin(ur); var ox = ((x0 + x1) / 2) / (tt || 1), oz = ((z0 + z1) / 2) / (tt || 1); for (var i = 0; i < uv.count; i++) { var u = uv.getX(i) + ox, v = uv.getY(i) - oz; uv.setXY(i, u * c - v * s, u * s + v * c); } } return g; };
  Kit.prototype.geo = function (key, g, x, y, z, ry, s) { if (s) g.scale(s[0], s[1], s[2]); _m4.makeRotationY(ry || 0); _m4.setPosition(x, y, z); g.applyMatrix4(_m4); return this.put(key, g); };
  Kit.prototype.q4 = function (key, a, b, c, d, t) { t = t || TILE[key] || 1; var g = new THREE.BufferGeometry(); var p = [a, b, c, a, c, d]; var pos = []; p.forEach(function (v) { pos.push(v[0], v[1], v[2]); }); var e1 = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / t, e2 = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]) / t;
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, e1, 0, e1, e2, 0, 0, e1, e2, 0, e2], 2)); g.computeVertexNormals(); return this.put(key, g); };
  // a flat polygon in a vertical plane: pts [[a, y]...] along the wall axis; ax "x" (plane z = c, faces +z when face > 0) or "z" (plane x = c)
  // a flat polygon in the vertical plane z = c: pts [[x, y]...]; face > 0 looks toward +z, face < 0 toward -z; uv in metres / tile
  Kit.prototype.poly = function (key, pts, c, face, t) { t = t || TILE[key] || 1; var m = face < 0 ? -1 : 1; var sh = new THREE.Shape(); pts.forEach(function (p, i) { if (i) sh.lineTo(p[0] * m, p[1]); else sh.moveTo(p[0] * m, p[1]); }); var g = new THREE.ShapeGeometry(sh); var uv = g.attributes.uv, pa = g.attributes.position; for (var i = 0; i < uv.count; i++) uv.setXY(i, pa.getX(i) / t, pa.getY(i) / t);
    if (m < 0) g.rotateY(PI); g.translate(0, 0, c); return this.put(key, g); };
  Kit.prototype.build = function (group, M) { var out = [];
    for (var key in this.m) { var list = this.m[key], mat = M[key]; if (!mat) { note("kit", new Error("no material " + key)); continue; } var one = null; try { one = mergeGeos(list); } catch (e) { note("merge " + key, e); }
      if (one) { list.forEach(function (g) { g.dispose(); }); var mesh = new THREE.Mesh(one, mat); mesh.castShadow = false; mesh.receiveShadow = !mat.transparent; mesh.userData.int3 = key; group.add(mesh); out.push(mesh); } }
    this.m = {}; return out; };
  // a quad with a uv sub-rectangle (atlas cells: photos, bottles, plaques); faces +z at ry 0
  Kit.prototype.quv = function (key, w, h, x, y, z, ry, u0, v0, u1, v1) { var g = new THREE.PlaneGeometry(w, h); var uv = g.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0)); _m4.makeRotationY(ry || 0); _m4.setPosition(x, y, z); g.applyMatrix4(_m4); return this.put(key, g); };

  // ───────────────────────── procedural surfaces (canvas, made once) ─────────────────────────
  // herringbone oak (axis staircase: 16 x 16 cells of 0.1 m, planks 0.4 x 0.1 m; the floor quad turns its uv 45 degrees)
  function herringTex() { return panel("herring", 1024, 1024, function (x, W, H) { var u = 64, N = 16; x.fillStyle = "#5a3f26"; x.fillRect(0, 0, W, H);
    var plank = function (px, py, w, h, seed, vert) { var R = rng(seed); var k = 0.8 + R() * 0.32; var r = 158 * k, g = 114 * k, b = 72 * k; var gr = vert ? x.createLinearGradient(0, py, 0, py + h) : x.createLinearGradient(px, 0, px + w, 0); gr.addColorStop(0, "rgb(" + (r * 0.95 | 0) + "," + (g * 0.95 | 0) + "," + (b * 0.95 | 0) + ")"); gr.addColorStop(0.5, "rgb(" + (r * 1.05 | 0) + "," + (g * 1.04 | 0) + "," + (b * 1.03 | 0) + ")"); gr.addColorStop(1, "rgb(" + (r * 0.93 | 0) + "," + (g * 0.93 | 0) + "," + (b * 0.93 | 0) + ")");
      [[0, 0], [-W, 0], [0, -H], [W, 0], [0, H]].forEach(function (o) { var qx = px + o[0], qy = py + o[1]; if (qx + w < 0 || qx > W || qy + h < 0 || qy > H) return; x.fillStyle = gr; x.save(); x.translate(o[0], o[1]); x.fillRect(px, py, w, h); x.strokeStyle = "rgba(70,44,22,0.22)"; x.lineWidth = 1; for (var q = 0; q < 4; q++) { x.beginPath(); if (vert) { var xx = px + 6 + R() * (w - 12); x.moveTo(xx, py); x.bezierCurveTo(xx + R() * 6 - 3, py + h / 3, xx + R() * 6 - 3, py + 2 * h / 3, xx, py + h); } else { var yy = py + 6 + R() * (h - 12); x.moveTo(px, yy); x.bezierCurveTo(px + w / 3, yy + R() * 6 - 3, px + 2 * w / 3, yy + R() * 6 - 3, px + w, yy); } x.stroke(); } x.strokeStyle = "rgba(35,22,10,0.7)"; x.lineWidth = 2; x.strokeRect(px + 1, py + 1, w - 2, h - 2); x.restore(); }); };
    for (var cy = 0; cy < N; cy++) for (var m = -2; m < 2; m++) { var x0 = cy + 8 * m; plank(x0 * u, cy * u, 4 * u, u, cy * 131 + m * 17 + 3, false); }
    for (var cx = 0; cx < N; cx++) for (var m2 = -2; m2 < 2; m2++) { var y0 = cx - 7 - 8 * m2; plank(cx * u, y0 * u, u, 4 * u, cx * 71 + m2 * 29 + 11, true); }
    noise(x, W, H, 3000, 0.03, 1, 3); }, true); }
  function ledgeTex() { return panel("ledge", 1024, 1024, function (x, W, H) { var R = rng(23); x.fillStyle = "#3b352f"; x.fillRect(0, 0, W, H); var y = 0; while (y < H) { var h = 22 + Math.floor(R() * 34); var xx = -Math.floor(R() * 120); while (xx < W) { var w = 70 + Math.floor(R() * 190); var t = R(); var base = [[168, 150, 128], [140, 124, 104], [186, 170, 146], [122, 108, 94], [158, 136, 110]][Math.floor(t * 5)]; var k = 0.85 + R() * 0.25;
      var gr = x.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, "rgb(" + Math.round(base[0] * k * 1.08) + "," + Math.round(base[1] * k * 1.08) + "," + Math.round(base[2] * k * 1.08) + ")"); gr.addColorStop(1, "rgb(" + Math.round(base[0] * k * 0.8) + "," + Math.round(base[1] * k * 0.8) + "," + Math.round(base[2] * k * 0.8) + ")"); x.fillStyle = gr; rrect(x, xx + 2, y + 2, w - 4, h - 4, 4); x.fill(); x.fillStyle = "rgba(255,255,255,0.08)"; x.fillRect(xx + 4, y + 3, w - 8, 3); xx += w; } y += h; }
      noise(x, W, H, 9000, 0.06, 1, 2.5); }, true); }
  function marbleTex() { return panel("marble", 1024, 1024, function (x, W, H) { var R = rng(5); x.fillStyle = "#f1eee9"; x.fillRect(0, 0, W, H); for (var v = 0; v < 22; v++) { x.strokeStyle = "rgba(" + (110 + R() * 40 | 0) + "," + (112 + R() * 40 | 0) + "," + (118 + R() * 40 | 0) + "," + (0.12 + R() * 0.3) + ")"; x.lineWidth = 0.6 + R() * 2.4; x.beginPath(); var px = R() * W, py = R() * H; x.moveTo(px, py); for (var s = 0; s < 14; s++) { px += (R() - 0.3) * 140; py += (R() - 0.5) * 90; x.lineTo(px, py); } x.stroke(); } noise(x, W, H, 4000, 0.02, 1, 3); }, true); }
  function terraTex() { return panel("terra", 512, 512, function (x, W, H) { var R = rng(9); x.fillStyle = "#6e4a34"; x.fillRect(0, 0, W, H); var n = 4, s = W / n; for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) { var k = 0.86 + R() * 0.22; x.fillStyle = "rgb(" + Math.round(184 * k) + "," + Math.round(112 * k) + "," + Math.round(78 * k) + ")"; rrect(x, i * s + 3, j * s + 3, s - 6, s - 6, 6); x.fill(); x.fillStyle = "rgba(255,230,200,0.08)"; x.beginPath(); x.arc(i * s + s * (0.3 + R() * 0.4), j * s + s * (0.3 + R() * 0.4), s * 0.3, 0, TAU); x.fill(); } noise(x, W, H, 3000, 0.05, 1, 3); }, true); }
  function concreteTex() { return panel("concrete", 512, 512, function (x, W, H) { var R = rng(3); x.fillStyle = "#c4c1bb"; x.fillRect(0, 0, W, H); for (var i = 0; i < 260; i++) { x.fillStyle = "rgba(" + (R() < 0.5 ? "255,255,255" : "70,66,60") + "," + (0.025 + R() * 0.04) + ")"; x.beginPath(); x.arc(R() * W, R() * H, 8 + R() * 60, 0, TAU); x.fill(); } noise(x, W, H, 5000, 0.05, 1, 2); }, true); }
  function epoxyTex() { return panel("epoxy", 512, 512, function (x, W, H) { x.fillStyle = "#cfd1d0"; x.fillRect(0, 0, W, H); noise(x, W, H, 2400, 0.05, 2, 14); var R = rng(4); for (var j = 0; j < 900; j++) { x.fillStyle = ["rgba(70,74,78,0.5)", "rgba(245,245,240,0.6)", "rgba(120,126,132,0.5)"][j % 3]; x.fillRect(R() * W, R() * H, 1.4, 1.4); } }, true); }
  // straight-grain wood (walnut, oak): long wavy grain lines with a few cathedral arches; 512 x 1024, grain along v
  function grainTex(key, base, light, dark, seed) { return panel("grain:" + key, 512, 1024, function (x, W, H) { var R = rng(seed || 17); x.fillStyle = base; x.fillRect(0, 0, W, H);
    for (var i = 0; i < 170; i++) { var gx = R() * W, a = 0.05 + R() * 0.16, lw = 0.6 + R() * 2.6; x.strokeStyle = (R() < 0.55 ? dark : light).replace("A", a.toFixed(3)); x.lineWidth = lw; x.beginPath(); x.moveTo(gx, 0); var ph = R() * 6, amp = 2 + R() * 7; for (var yy = 0; yy <= H; yy += 32) x.lineTo(gx + Math.sin(yy / 140 + ph) * amp + Math.sin(yy / 37 + ph * 2) * 1.2, yy); x.stroke(); }
    for (var c = 0; c < 5; c++) { var cx = R() * W, cy = R() * H, w = 30 + R() * 60; x.strokeStyle = dark.replace("A", "0.18"); x.lineWidth = 1.4; for (var k = 0; k < 6; k++) { x.beginPath(); x.moveTo(cx - w - k * 6, cy + 160 + k * 18); x.quadraticCurveTo(cx, cy - 60 + k * 16, cx + w + k * 6, cy + 160 + k * 18); x.stroke(); } }
    noise(x, W, H, 5000, 0.025, 1, 2); }, true); }
  // leather: a warm base with fine grain, soft creases and a darker welt line every panel
  function leatherTex(key, base) { return panel("leather:" + key, 512, 512, function (x, W, H) { var R = rng(key.length * 31 + 7); x.fillStyle = base; x.fillRect(0, 0, W, H); for (var i = 0; i < 14000; i++) { x.fillStyle = R() < 0.5 ? "rgba(255,240,220,0.035)" : "rgba(30,12,4,0.05)"; var r = 1 + R() * 2.2; x.fillRect(R() * W, R() * H, r, r); }
    x.strokeStyle = "rgba(40,18,6,0.12)"; x.lineWidth = 1.2; for (var c = 0; c < 40; c++) { x.beginPath(); var px = R() * W, py = R() * H; x.moveTo(px, py); x.quadraticCurveTo(px + (R() - 0.5) * 60, py + (R() - 0.5) * 60, px + (R() - 0.5) * 90, py + (R() - 0.5) * 90); x.stroke(); }
    x.fillStyle = "rgba(20,8,2,0.35)"; x.fillRect(0, 0, W, 3); x.fillRect(0, 0, 3, H); x.fillStyle = "rgba(255,235,210,0.12)"; x.fillRect(0, 4, W, 2); }, true); }
  // R5: after a WebGL context loss the one-time room probe is empty: plan_perf calls this on restore to draw it again
  IN.restoreEnv = function () { var old = IN.env; if (old === undefined) return false; IN.env = undefined; var t = roomEnv(); try { scene.traverse(function (o) { var ms = o.material; if (!ms) return; ms = Array.isArray(ms) ? ms : [ms]; for (var i = 0; i < ms.length; i++) if (ms[i] && ms[i].envMap === old) { ms[i].envMap = t; ms[i].needsUpdate = true; } }); if (MT) for (var k in MT) { var m = MT[k]; if (m && m.envMap === old) { m.envMap = t; m.needsUpdate = true; } } } catch (e) { note("restore env", e); } return !!t; };
  function roomEnv() {
    if (IN.env !== undefined) return IN.env; IN.env = null;
    try { var c = cv(256, 128), x = c.getContext("2d"); var g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, "#fff6e8"); g.addColorStop(0.42, "#d9c9b2"); g.addColorStop(0.55, "#8f7f6c"); g.addColorStop(1, "#4d4136"); x.fillStyle = g; x.fillRect(0, 0, 256, 128);
      x.fillStyle = "#fff4dc"; for (var i = 0; i < 7; i++) { x.beginPath(); x.ellipse(18 + i * 36, 12, 7, 3, 0, 0, TAU); x.fill(); } x.fillStyle = "rgba(200,225,245,0.9)"; x.fillRect(90, 40, 80, 22); x.fillRect(0, 44, 40, 18);
      var t = mkTex(c); t.mapping = THREE.EquirectangularReflectionMapping; var pm = new THREE.PMREMGenerator(renderer); IN.env = pm.fromEquirectangular(t).texture; pm.dispose(); t.dispose(); } catch (e) { note("env", e); IN.env = null; }
    return IN.env;
  }

  // ───────────────────────── pictures and signs (canvas) ─────────────────────────
  // heritage photographs (sepia prints in a 3 x 2 atlas): the 1928 field, a biplane over the flats, the hangars, the first clubhouse, a putting green, the Chiricahua skyline
  function photoTex() { return panel("photos", 1536, 1024, function (x, W, H) { var R = rng(1928); var cw = W / 3, ch = H / 2;
    var caps = ["THE FIELD · 1928", "BIPLANE OVER THE FLATS", "THE FIRST HANGARS", "THE LANDING · FOUNDERS", "THE FIRST GREEN", "CHIRICAHUA SKYLINE"];
    for (var k = 0; k < 6; k++) { var ox = (k % 3) * cw, oy = Math.floor(k / 3) * ch; x.save(); x.translate(ox, oy); x.fillStyle = "#1c140d"; x.fillRect(0, 0, cw, ch); x.fillStyle = "#efe6d2"; x.fillRect(18, 18, cw - 36, ch - 36); var px = 44, py = 44, pw = cw - 88, ph = ch - 130;
      var sky = x.createLinearGradient(0, py, 0, py + ph); sky.addColorStop(0, "#d8c7a4"); sky.addColorStop(0.6, "#bba47c"); sky.addColorStop(1, "#8a7352"); x.fillStyle = sky; x.fillRect(px, py, pw, ph); var hz = py + ph * (0.55 + R() * 0.12);
      x.fillStyle = "#6e5a3e"; x.beginPath(); x.moveTo(px, hz); for (var s = 0; s <= 10; s++) x.lineTo(px + s * pw / 10, hz - (k === 5 ? 30 + R() * 70 : 6 + R() * 22)); x.lineTo(px + pw, py + ph); x.lineTo(px, py + ph); x.fill(); x.fillStyle = "#57462f"; x.fillRect(px, hz + 8, pw, py + ph - hz - 8);
      x.fillStyle = "#2e2418"; if (k === 0) { for (var h = 0; h < 3; h++) { x.beginPath(); x.moveTo(px + 60 + h * 120, hz + 8); x.quadraticCurveTo(px + 110 + h * 120, hz - 50, px + 160 + h * 120, hz + 8); x.fill(); } x.fillRect(px + 20, hz + 30, pw - 40, 6); }
      if (k === 1 || k === 0) { var bx = px + pw * (k ? 0.45 : 0.7), by = py + ph * (k ? 0.35 : 0.25); x.fillRect(bx - 50, by - 3, 100, 6); x.fillRect(bx - 46, by - 22, 92, 5); x.fillRect(bx - 4, by - 22, 5, 22); x.fillRect(bx - 18, by - 1, 60, 10); x.fillRect(bx + 36, by - 10, 6, 14); }
      if (k === 2) for (var h2 = 0; h2 < 4; h2++) { x.beginPath(); x.moveTo(px + 20 + h2 * 90, hz + 10); x.lineTo(px + 20 + h2 * 90, hz - 40); x.quadraticCurveTo(px + 60 + h2 * 90, hz - 75, px + 100 + h2 * 90, hz - 40); x.lineTo(px + 100 + h2 * 90, hz + 10); x.fill(); }
      if (k === 3) { x.fillRect(px + pw * 0.2, hz - 60, pw * 0.6, 60); x.fillStyle = "#1f1810"; for (var p = 0; p < 7; p++) { x.beginPath(); x.arc(px + pw * 0.22 + p * pw * 0.09, hz + 28, 11, 0, TAU); x.fill(); x.fillRect(px + pw * 0.22 + p * pw * 0.09 - 10, hz + 38, 20, 40); } }
      if (k === 4) { x.fillStyle = "#7a6a48"; x.beginPath(); x.ellipse(px + pw / 2, hz + 50, pw * 0.35, 28, 0, 0, TAU); x.fill(); x.fillStyle = "#2e2418"; x.fillRect(px + pw / 2 + 30, hz - 20, 3, 70); x.fillRect(px + pw / 2 + 33, hz - 20, 26, 14); x.fillRect(px + pw / 2 - 60, hz + 10, 8, 50); x.beginPath(); x.arc(px + pw / 2 - 56, hz + 2, 10, 0, TAU); x.fill(); }
      x.fillStyle = "rgba(60,40,20,0.18)"; for (var q = 0; q < 900; q++) x.fillRect(px + R() * pw, py + R() * ph, 1.5, 1.5); var vg = x.createRadialGradient(px + pw / 2, py + ph / 2, ph * 0.3, px + pw / 2, py + ph / 2, pw * 0.7); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(40,24,10,0.45)"); x.fillStyle = vg; x.fillRect(px, py, pw, ph);
      txt(x, caps[k], cw / 2, ch - 50, "600 26px " + FT.ui, "#3a2c1c", 4, "center", cw - 80); x.restore(); } }); }
  // abstract desert paintings (three canvases): mesa and sun, layered ridges, a monsoon sky
  function artTex(k) { return panel("art" + k, 768, 1024, function (x, W, H) { var R = rng(40 + k); var pal = [["#f3c98b", "#e08a4f", "#9c4a2f", "#3d2a2a"], ["#cfe0e6", "#9fb7c4", "#6f8a8a", "#2f3d3a"], ["#f4dcc0", "#d9a07a", "#7a5a78", "#2a2340"]][k % 3];
    var g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, pal[0]); g.addColorStop(0.55, pal[1]); g.addColorStop(1, pal[2]); x.fillStyle = g; x.fillRect(0, 0, W, H);
    if (k % 3 === 0) { x.fillStyle = "rgba(255,244,214,0.9)"; x.beginPath(); x.arc(W * 0.66, H * 0.3, 90, 0, TAU); x.fill(); }
    for (var l = 0; l < 4; l++) { x.fillStyle = l === 3 ? pal[3] : "rgba(" + (60 + l * 20) + "," + (40 + l * 10) + "," + (40 + l * 12) + "," + (0.35 + l * 0.18) + ")"; x.beginPath(); var y0 = H * (0.5 + l * 0.11); x.moveTo(0, y0); for (var s = 0; s <= 8; s++) x.lineTo(s * W / 8, y0 - (k % 3 === 0 && l === 1 && s > 2 && s < 6 ? 120 : R() * 60)); x.lineTo(W, H); x.lineTo(0, H); x.fill(); }
    for (var b = 0; b < 1400; b++) { x.fillStyle = "rgba(255,255,255," + (R() * 0.05) + ")"; x.fillRect(R() * W, R() * H, 3, 1); } }); }
  function rugTex(k) { return panel("rug" + k, 1024, 768, function (x, W, H) { var R = rng(70 + k); var P = [["#355e48", "#c9a24d", "#e9dcc0", "#24402f"], ["#e6ddcc", "#3a3a3c", "#b9a78a", "#d8ccb6"], ["#7a3b2a", "#e3c9a0", "#2e2a26", "#9c5a3c"]][k % 3];
    x.fillStyle = P[0]; x.fillRect(0, 0, W, H); x.strokeStyle = P[1]; x.lineWidth = 14; x.strokeRect(34, 34, W - 68, H - 68); x.lineWidth = 3; x.strokeRect(62, 62, W - 124, H - 124);
    x.strokeStyle = P[2]; x.globalAlpha = 0.55; x.lineWidth = 4; for (var i = 0; i < 9; i++) { x.beginPath(); var cx = 120 + i * (W - 240) / 8; x.moveTo(cx, 110); x.lineTo(cx + 40, H / 2); x.lineTo(cx, H - 110); x.stroke(); } x.globalAlpha = 1; noise(x, W, H, 16000, 0.06, 1, 2); }); }
  function flameTex() { return panel("flame", 256, 256, function (x, W, H) { x.clearRect(0, 0, W, H); for (var f = 0; f < 9; f++) { var cx = 30 + f * 25 + Math.sin(f * 3.1) * 8, h = 120 + (f % 3) * 40; var g = x.createRadialGradient(cx, H - 20, 4, cx, H - h * 0.5, h * 0.6); g.addColorStop(0, "rgba(255,246,210,0.95)"); g.addColorStop(0.3, "rgba(255,190,90,0.8)"); g.addColorStop(0.7, "rgba(230,90,30,0.35)"); g.addColorStop(1, "rgba(160,40,10,0)"); x.fillStyle = g; x.beginPath(); x.moveTo(cx - 22, H - 10); x.quadraticCurveTo(cx - 26, H - h * 0.6, cx, H - h); x.quadraticCurveTo(cx + 26, H - h * 0.6, cx + 22, H - 10); x.fill(); } }); }
  function glowTex() { return panel("glow", 128, 128, function (x, W, H) { var g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,236,200,0.9)"); g.addColorStop(0.45, "rgba(255,214,160,0.3)"); g.addColorStop(1, "rgba(255,210,160,0)"); x.fillStyle = g; x.fillRect(0, 0, W, H); }); }
  // back-bar bottles on three lit glass shelves (the quad sits behind the 3D shelves)
  function bottlesTex(k) { return panel("bottles" + (k || 0), 1024, 512, function (x, W, H) { var R = rng(300 + (k || 0)); var g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#3a2a1c"); g.addColorStop(1, "#1a120c"); x.fillStyle = g; x.fillRect(0, 0, W, H);
    for (var s = 0; s < 3; s++) { var base = 150 + s * 160; var lg = x.createLinearGradient(0, base - 140, 0, base); lg.addColorStop(0, "rgba(255,200,120,0)"); lg.addColorStop(1, "rgba(255,200,120,0.28)"); x.fillStyle = lg; x.fillRect(0, base - 140, W, 140); var bx = 14;
      while (bx < W - 30) { var bw = 26 + R() * 22, bh = 70 + R() * 60; var col = ["#2f5a3a", "#8a4a14", "#c9a24d", "#e8e0d0", "#6e1f24", "#1d3b5a", "#b86a2a"][Math.floor(R() * 7)]; x.fillStyle = col; x.globalAlpha = 0.9; rrect(x, bx, base - bh, bw, bh, 6); x.fill(); x.fillRect(bx + bw * 0.35, base - bh - 26, bw * 0.3, 28); x.globalAlpha = 1; x.fillStyle = "rgba(255,255,255,0.35)"; x.fillRect(bx + 4, base - bh + 6, 3, bh - 14); x.fillStyle = "#efe6d2"; x.fillRect(bx + 3, base - bh * 0.55, bw - 6, bh * 0.25); bx += bw + 6 + R() * 8; }
      x.fillStyle = "rgba(220,235,240,0.5)"; x.fillRect(0, base, W, 5); } }); }
  // book spines (a 1024 x 512 wall of shelves)
  function booksTex() { return panel("books", 1024, 512, function (x, W, H) { var R = rng(77); x.fillStyle = "#3b2a1c"; x.fillRect(0, 0, W, H); for (var s = 0; s < 4; s++) { var y1 = (s + 1) * H / 4 - 8, bx = 8; x.fillStyle = "#5a3f26"; x.fillRect(0, y1, W, 8);
      while (bx < W - 10) { var bw = 12 + R() * 22, bh = H / 4 - 30 - R() * 30; var col = ["#6e1f24", "#1d3b5a", "#2f4a3a", "#c9b48a", "#3a3a3c", "#8a5a2c", "#e9e1d2", "#4a2c3a"][Math.floor(R() * 8)]; x.fillStyle = col; x.fillRect(bx, y1 - bh, bw, bh); x.fillStyle = "rgba(201,162,77,0.7)"; x.fillRect(bx + 2, y1 - bh + 10, bw - 4, 2); x.fillRect(bx + 2, y1 - 16, bw - 4, 2); bx += bw + 1 + (R() < 0.08 ? 20 : 0); } } }); }
  // chalkboard menu (per venue); no prices
  function menuTex(v) { var key = "menu:" + (v.name || ""); return panel(key, 768, 1024, function (x, W, H) { x.fillStyle = "#1f2421"; x.fillRect(0, 0, W, H); noise(x, W, H, 5000, 0.05, 1, 4); x.strokeStyle = "#c9a24d"; x.lineWidth = 10; x.strokeRect(22, 22, W - 44, H - 44);
    txt(x, (v.name || "Today").toUpperCase(), W / 2, 110, "700 58px " + FT.cond, "#f4ecd8", 6, "center", W - 110); txt(x, v.tagline || "From the kitchen", W / 2, 168, "italic 30px " + FT.serif, "#c9a24d", 1, "center", W - 110);
    x.strokeStyle = "rgba(244,236,216,0.5)"; x.lineWidth = 2; x.beginPath(); x.moveTo(120, 205); x.lineTo(W - 120, 205); x.stroke(); var items = v.menu || [];
    for (var i = 0; i < items.length && i < 8; i++) { var it = items[i]; var y = 262 + i * 88; txt(x, String(it[0] || it).toUpperCase(), W / 2, y, "600 32px " + FT.ui, "#f4ecd8", 3, "center", W - 110); if (it[1]) txt(x, it[1], W / 2, y + 34, "24px " + FT.hand, "rgba(244,236,216,0.72)", 0, "center", W - 120); }
    txt(x, v.foot || "Ask your server about today's specials", W / 2, H - 70, "24px " + FT.hand, "#4DDE6F", 0, "center", W - 110); }); }
  // brass letters on dark walnut (a name plate), transparent background
  function plateTex(t1, t2, dark) { var key = "plate:" + t1 + "|" + (t2 || "") + (dark ? "d" : ""); return panel(key, 2048, 384, function (x, W, H) { x.clearRect(0, 0, W, H); txt(x, t1, W / 2, t2 ? 150 : H / 2, "700 150px " + FT.cond, dark ? "#1d2a22" : "#d9b45e", 22, "center", W - 120); if (t2) txt(x, t2, W / 2, 300, "500 54px " + FT.ui, dark ? "#6b5a3a" : "#e9dcc0", 12, "center", W - 160); }); }
  // wine wall (hangar home): diamond racks of bottle ends, backlit
  function wineTex() { return panel("wine2", 512, 1024, function (x, W, H) { var R = rng(9); var lg = x.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, "#8a5a2c"); lg.addColorStop(0.5, "#6b4424"); lg.addColorStop(1, "#4a2e18"); x.fillStyle = lg; x.fillRect(0, 0, W, H); x.strokeStyle = "rgba(40,24,12,0.9)"; x.lineWidth = 3; for (var d = -H; d < W + H; d += 40) { x.beginPath(); x.moveTo(d, 0); x.lineTo(d + H, H); x.stroke(); x.beginPath(); x.moveTo(d, H); x.lineTo(d + H, 0); x.stroke(); }
    for (var j = 0; j < 24; j++) for (var i = 0; i < 12; i++) { var cx = 22 + i * 40 + (j % 2) * 20, cy = 22 + j * 41; if (R() < 0.1) continue; x.fillStyle = ["#1c0c0a", "#0e160c", "#20120a", "#140c12"][Math.floor(R() * 4)]; x.beginPath(); x.arc(cx, cy, 14, 0, TAU); x.fill(); x.strokeStyle = "rgba(255,230,190,0.35)"; x.lineWidth = 2; x.beginPath(); x.arc(cx - 3, cy - 3, 9, PI, PI * 1.6); x.stroke(); x.fillStyle = R() < 0.5 ? "rgba(201,162,77,0.9)" : "rgba(140,30,30,0.9)"; x.beginPath(); x.arc(cx, cy, 5, 0, TAU); x.fill(); } }); }
  // pro shop polos folded on a table (rows of colour) and a shoe wall
  function shopTex() { return panel("shop", 1024, 512, function (x, W, H) { var R = rng(12); x.fillStyle = "#e9e1d2"; x.fillRect(0, 0, W, H); var cols = ["#1d3b5a", "#f4f1ea", "#2f4a3a", "#c9a24d", "#6e1f24", "#9fb7c4", "#3a3a3c", "#e6c9a8"];
    for (var r = 0; r < 4; r++) for (var c = 0; c < 8; c++) { var px = 20 + c * 124, py = 20 + r * 122; x.fillStyle = "#d8ccb6"; x.fillRect(px - 6, py + 96, 118, 8); x.fillStyle = cols[(c + r * 3) % cols.length]; rrect(x, px, py + 22, 106, 74, 8); x.fill(); x.fillStyle = "rgba(0,0,0,0.12)"; x.fillRect(px + 40, py + 22, 26, 22); x.fillStyle = "rgba(255,255,255,0.18)"; x.fillRect(px + 6, py + 26, 94, 4); } }); }
  // "OPEN HOUSE" easel card for the hangar homes
  function easelTex(t1, t2) { var key = "easel:" + t1 + "|" + t2; return panel(key, 512, 704, function (x, W, H) { x.fillStyle = "#0a1610"; x.fillRect(0, 0, W, H); x.strokeStyle = "#c9a24d"; x.lineWidth = 8; x.strokeRect(18, 18, W - 36, H - 36); txt(x, "GENESIS ONE", W / 2, 110, "700 44px " + FT.cond, "#4DDE6F", 10, "center", W - 80); txt(x, t1, W / 2, 300, "700 86px " + FT.cond, "#f5f1e6", 6, "center", W - 70); txt(x, t2, W / 2, 400, "italic 34px " + FT.serif, "#f4cd5a", 1, "center", W - 70); txt(x, "Walk in: the front door is open", W / 2, 560, "500 26px " + FT.ui, "#e9dcc0", 2, "center", W - 70); }); }

  // ───────────────────────── materials (made once, shared by every interior) ─────────────────────────
  var MT = null;
  function mats() {
    if (MT) return MT; var env = roomEnv(); var S = function (o) { if (env && o.envMap === undefined) { o.envMap = env; if (o.envMapIntensity === undefined) o.envMapIntensity = 0.55; } return new THREE.MeshStandardMaterial(o); };
    var E = function (m, k) { if (env) { m.envMap = env; m.envMapIntensity = k || 0.55; } return m; };
    var wood = (typeof TEX !== "undefined" && TEX.wood) || null;
    MT = {
      trav: E(tiled("/tex/travertine", 0xf6eddc, 0.55, 0.35), 0.7), terrazzo: E(tiled("/tex/terrazzo", 0xf1ede6, 0.6, 0.35), 0.6),
      oak: S({ map: herringTex(), roughness: 0.42, metalness: 0.02, envMapIntensity: 0.45 }), terra: S({ map: terraTex(), roughness: 0.62, envMapIntensity: 0.3 }),
      concrete: S({ map: concreteTex(), roughness: 0.3, envMapIntensity: 0.6 }), epoxy: S({ map: epoxyTex(), color: 0xb8bcbf, roughness: 0.18, envMapIntensity: 0.55 }),
      carpet: tiled("/tex/jet_carpet", 0x8f8a82, 1, 0.5), plaster: tiled("/tex/jet_wall", 0xf4eee4, 0.95, 0.25), sand: tiled("/tex/jet_wall", 0xe6d3b6, 0.95, 0.25), clay: tiled("/tex/jet_wall", 0xc58b66, 0.95, 0.3), slate: S({ color: 0x3c3f41, roughness: 0.8, envMapIntensity: 0.2 }), turf: tiled("/tex/turf", 0x6f9a55, 1, 0.5),
      walnut: S({ map: grainTex("walnut2", "#5c4431", "rgba(160,128,96,A)", "rgba(30,22,14,A)", 17), roughness: 0.46, envMapIntensity: 0.45 }), oakP: S({ map: grainTex("oak", "#a67d55", "rgba(222,190,150,A)", "rgba(92,62,36,A)", 29), roughness: 0.55, envMapIntensity: 0.3 }), burl: E(tiled("/tex/jet_walnut", 0x9a6a50, 0.45, 0.35), 0.5), ebony: S({ color: 0x2a1d15, roughness: 0.45, envMapIntensity: 0.4 }),
      stone: S({ map: ledgeTex(), roughness: 0.92, envMapIntensity: 0.15 }), marble: S({ map: marbleTex(), roughness: 0.16, envMapIntensity: 0.85 }), slab: E(tiled("/tex/travertine", 0xe9dcc4, 0.5, 0.4), 0.5), hearth: S({ color: 0x2b2826, roughness: 0.7 }),
      quilt: tiled("/tex/jet_leather", 0xf1e7d6, 0.6, 0.5), tan: S({ map: leatherTex("tan", "#9a6240"), roughness: 0.5, envMapIntensity: 0.35 }), ox: S({ map: leatherTex("ox", "#6a3424"), roughness: 0.48, envMapIntensity: 0.35 }), blackL: S({ color: 0x201c1a, roughness: 0.45, envMapIntensity: 0.35 }),
      green: S({ color: 0x1d3a2b, roughness: 0.92, envMapIntensity: 0.08 }), navy: S({ color: 0x19233a, roughness: 0.92, envMapIntensity: 0.08 }), cream: S({ color: 0xe9e1d2, roughness: 0.95, envMapIntensity: 0.1 }), rust: S({ color: 0xa2552f, roughness: 0.95, envMapIntensity: 0.1 }), sage: S({ color: 0x8a9a7e, roughness: 0.95, envMapIntensity: 0.1 }), char: S({ color: 0x3a3a3c, roughness: 0.95, envMapIntensity: 0.1 }), teal: S({ color: 0x2c5a5c, roughness: 0.95, envMapIntensity: 0.1 }),
      linen: S({ color: 0xf6f3ec, roughness: 0.9, envMapIntensity: 0.15 }), ceramic: S({ color: 0xfbfaf6, roughness: 0.18, envMapIntensity: 0.8 }),
      bronze: S({ color: 0x6f5535, metalness: 0.85, roughness: 0.3, envMapIntensity: 0.9 }), brass: S({ color: 0xcfa653, metalness: 1, roughness: 0.24, envMapIntensity: 1.0 }), steel: S({ color: 0x1e1f21, metalness: 0.6, roughness: 0.38, envMapIntensity: 0.6 }), chrome: S({ color: 0xe1e5e8, metalness: 1, roughness: 0.1, envMapIntensity: 1.2 }), brushed: S({ color: 0xbfc4c9, metalness: 0.9, roughness: 0.28, envMapIntensity: 1.0 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xe3f0f3, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, envMap: env, envMapIntensity: 1.1 }),
      glassB: new THREE.MeshStandardMaterial({ color: 0xcfe2e6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, envMap: env, envMapIntensity: 1.0 }),
      mirror: S({ color: 0x9a948a, metalness: 1, roughness: 0.08, envMapIntensity: 0.9 }), white: S({ color: 0xf3f1ec, roughness: 0.5 }), black: S({ color: 0x151617, roughness: 0.4 }), pot: S({ color: 0xcdbfa8, roughness: 0.85 }), leaf: S({ color: 0x4d6b3c, roughness: 0.8 }), soil: S({ color: 0x3a2c20, roughness: 1 }),
      lamp: new THREE.MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffcf8a, emissiveIntensity: 2.2, roughness: 0.3 }), lampC: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf2f6ff, emissiveIntensity: 2.4, roughness: 0.3 }),
      shade: new THREE.MeshStandardMaterial({ color: 0xf0e2c8, emissive: 0xffb45a, emissiveIntensity: 0.55, roughness: 0.8, side: THREE.DoubleSide }), strip: new THREE.MeshStandardMaterial({ color: 0xfff0d8, emissive: 0xffc98a, emissiveIntensity: 1.4, roughness: 0.5 }),
      ember: new THREE.MeshStandardMaterial({ color: 0x2a1208, emissive: 0xff5a1a, emissiveIntensity: 1.2, roughness: 0.9 }),
      fire: new THREE.MeshBasicMaterial({ map: flameTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }),
      glow: new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      photos: S({ map: photoTex(), roughness: 0.35, envMapIntensity: 0.5 }), bottles: new THREE.MeshStandardMaterial({ map: bottlesTex(0), emissiveMap: bottlesTex(0), emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.3 }),
      books: S({ map: booksTex(), roughness: 0.8 }), wine: new THREE.MeshStandardMaterial({ map: wineTex(), emissiveMap: wineTex(), emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.5 }), shop: S({ map: shopTex(), roughness: 0.85 }),
      art0: S({ map: artTex(0), roughness: 0.7 }), art1: S({ map: artTex(1), roughness: 0.7 }), art2: S({ map: artTex(2), roughness: 0.7 }),
      rug0: S({ map: rugTex(0), roughness: 1 }), rug1: S({ map: rugTex(1), roughness: 1 }), rug2: S({ map: rugTex(2), roughness: 1 })
    };
    if (R14I) { try { var tP = r14tex("/tex/rv_i3_p0.jpg"), tL0 = r14tex("/tex/rv_i3_l0.jpg"), tL1 = r14tex("/tex/rv_i3_l1.jpg"), tL2 = r14tex("/tex/rv_i3_l2.jpg"), tL3 = r14tex("/tex/rv_i3_l3.jpg"), tB = r14tex("/tex/rv_bottles.jpg", 1.5);
        if (tP) MT.art0.map = tP; if (tL0) MT.art1.map = tL0; if (tL1) MT.art2.map = tL1; MT.art3 = S({ map: tL2 || artTex(0), roughness: 0.7 }); MT.art4 = S({ map: tL3 || artTex(1), roughness: 0.7 });
        if (tB) { MT.bottles.map = tB; MT.bottles.emissiveMap = tB; MT.bottles.emissiveIntensity = 0.28; } } catch (e) { note("r14 mats", e); } }
    var AO = aoTex(); for (var mk in MT) { var mm = MT[mk]; if (mm && mm.isMeshStandardMaterial && !mm.transparent && mk !== "lamp" && mk !== "lampC") { mm.aoMap = AO; mm.aoMapIntensity = 1; } }
    MT.glass.userData.noSolid = true; MT.glassB.userData.noSolid = true; MT.fire.userData.noSolid = true; MT.glow.userData.noSolid = true;
    [MT.lamp, MT.lampC, MT.strip, MT.ember].forEach(function (m) { m.userData.k0 = m.emissiveIntensity; });
    return MT;
  }
  // indoor light: under a roof a room gets a fraction of the sky's light; three.js applies the ao map to indirect light only
  // (hemisphere, ambient, environment), so one grey texel makes every interior surface an indoor surface while the lamps stay full
  function aoTex() { if (IN.ao) return IN.ao; var t = new THREE.DataTexture(new Uint8Array([IN.aoK || 105, IN.aoK || 105, IN.aoK || 105, 255]), 1, 1); t.needsUpdate = true; return (IN.ao = t); }
  // a model's materials with the indoor ao (clones share the textures; one clone per material)
  var AOM = new Map(); function indoor(mat) { if (!mat || !mat.isMeshStandardMaterial || mat.transparent) return mat; var c = AOM.get(mat); if (!c) { c = mat.clone(); c.aoMap = aoTex(); c.aoMapIntensity = 1; AOM.set(mat, c); } return c; }
  // per-use materials (a menu, a name plate, a sign) cached by texture key
  var MX = {};
  function matOf(key, mk) { return MX[key] || (MX[key] = mk()); }
  // ───────────────────────── the three kinds, in the model frame (metres at scale 1; +z = the entrance side) ─────────────────────────
  // shell: the shell's wall lines (outer solids replace the box collider); room: the interior rectangles [x0, z0, x1, z1, floor];
  // door: our door opening and leaves; cut: shell regions discarded while the interior exists [x0, x1, y0, y1, z0, z1];
  // see: the footprint box whose shell back faces are dropped while the camera is inside [x0, x1, z0, z1, ymax]; porch: the
  // region in front of the door searched for standable steps and decks, and the posts that stand in it.
  var TYPES = {
    clubhouse: { key: "club", label: "clubhouse", R: 15,
      walls: [[-12.97, -12.4, 12.97, -12.4], [-12.97, -12.4, -12.97, 9.09], [12.97, -12.4, 12.97, 9.09], [-12.97, 9.09, -1.56, 9.09], [0.16, 9.09, 12.97, 9.09]], wallH: 6.4,
      rooms: [[-12.72, -12.15, 12.72, 8.84, 0.83, 5.95], [-4.35, -3.65, 4.5, 3.55, 6.36, 9.35]], floor: 0.83,
      door: { x0: -1.5, x1: 0.1, y0: 0.83, h: 2.85, z: 9.0, zw: 8.84, leaves: 2, mat: "glassDoor" },
      cut: [[-1.53, 0.13, 0.87, 3.7, 8.35, 9.75]], see: [-13.6, 13.6, -13.0, 9.3, 10.4],
      porch: { x0: -6.5, x1: 5.5, z0: 9.12, z1: 13.4, posts: true } },
    restaurant: { key: "rest", label: "restaurant", R: 9,
      walls: [[-7.66, -8.6, 7.66, -8.6], [-7.66, -8.6, -7.66, 5.66], [7.66, -8.6, 7.66, 5.66], [-7.66, 5.66, -1.44, 5.66], [0.1, 5.66, 7.66, 5.66]], wallH: 5.0,
      rooms: [[-7.42, -8.36, 7.42, 5.42, 0.216, 4.72]], floor: 0.216,
      door: { x0: -1.41, x1: 0.07, y0: 0.216, h: 2.86, z: 5.58, zw: 5.42, leaves: 2, mat: "walnutDoor" },
      cut: [[-1.44, 0.1, 0.26, 3.12, 5.15, 6.1]], see: [-9.0, 9.0, -9.0, 5.9, 6.7],
      porch: { x0: -8.7, x1: 8.7, z0: 5.7, z1: 9.4, posts: true } },
    hangarhome2: { key: "hh", label: "hangar home", R: 15.5,
      walls: [[-13.8, -14.45, 9.29, -14.45], [-13.8, -14.45, -13.8, 12.45], [9.29, -14.45, 9.29, -5.6], [9.29, -5.6, 14.43, -5.6], [14.43, -5.6, 14.43, 10.65], [11.24, 10.65, 14.43, 10.65], [8.5, 10.65, 9.9, 10.65], [8.5, 10.65, 8.5, 12.45], [-13.8, 12.45, 8.5, 12.45]], wallH: 7.0,
      rooms: [[-13.35, -14.15, 9.0, 12.2, 0.05, 6.3], [9.0, -5.3, 14.15, 10.4, 0.7, 5.2]], floor: 0.05,
      door: { x0: 9.95, x1: 11.2, y0: 0.7, h: 2.55, z: 10.58, zw: 10.4, leaves: 1, mat: "walnutDoor" },
      cut: [[9.93, 11.22, 0.74, 3.28, 10.2, 11.1], [-10.05, 5.95, 0.06, 6.25, 11.9, 13.0]], see: [-14.4, 15.0, -15.0, 12.75, 11.2],
      porch: { x0: 8.3, x1: 14.7, z0: 10.7, z1: 15.5, posts: true } }
  };
  IN.TYPES = TYPES;
  function l2w(e, lx, lz) { var c = Math.cos(e[3]), s = Math.sin(e[3]); return [e[0] + lx * c + lz * s, e[2] - lx * s + lz * c]; }
  function w2l(e, x, z) { var dx = x - e[0], dz = z - e[2], c = Math.cos(e[3]), s = Math.sin(e[3]); return [dx * c - dz * s, dx * s + dz * c]; }
  function inRooms(T, lx, lz, pad) { pad = pad || 0; for (var i = 0; i < T.rooms.length; i++) { var r = T.rooms[i]; if (i > 0 && r[4] > 3) continue; if (lx > r[0] - pad && lx < r[2] + pad && lz > r[1] - pad && lz < r[3] + pad) return r; } return null; }

  // ───────────────────────── the shell: door cut and see-through (a chained shader hook on the kind's materials) ─────────────────────────
  var SH = IN.sh = IN.sh || {};
  function shellU(kind) { if (SH[kind]) return SH[kind]; var V4 = function () { return { value: new THREE.Vector4(0, 0, 0, 0) }; }, V2 = function () { return { value: new THREE.Vector2(0, 0) }; };
    SH[kind] = { u: { uIntOn: { value: 0 }, uIntInv: { value: new THREE.Matrix4() }, uIntC1a: V4(), uIntC1b: V2(), uIntC2a: V4(), uIntC2b: V2(), uIntSee: V4(), uIntSeeY: { value: 0 }, uIntCam: { value: 0 } }, n: 0 }; return SH[kind]; }
  var I3V = "varying vec3 vI3W;", I3F = "varying vec3 vI3W; uniform float uIntOn; uniform mat4 uIntInv; uniform vec4 uIntC1a; uniform vec2 uIntC1b; uniform vec4 uIntC2a; uniform vec2 uIntC2b; uniform vec4 uIntSee; uniform float uIntSeeY; uniform float uIntCam;";
  var I3VM = "{ vec4 i3 = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n i3 = instanceMatrix * i3;\n#endif\n vI3W = (modelMatrix * i3).xyz; }";
  var I3FM = "if (uIntOn > 0.5) { vec3 i3l = (uIntInv * vec4(vI3W, 1.0)).xyz;\n if (i3l.x > uIntC1a.x && i3l.x < uIntC1a.y && i3l.y > uIntC1a.z && i3l.y < uIntC1a.w && i3l.z > uIntC1b.x && i3l.z < uIntC1b.y) discard;\n if (i3l.x > uIntC2a.x && i3l.x < uIntC2a.y && i3l.y > uIntC2a.z && i3l.y < uIntC2a.w && i3l.z > uIntC2b.x && i3l.z < uIntC2b.y) discard;\n if (uIntCam > 0.5 && !gl_FrontFacing && i3l.x > uIntSee.x && i3l.x < uIntSee.y && i3l.z > uIntSee.z && i3l.z < uIntSee.w && i3l.y < uIntSeeY) discard; }";
  function shellHook(sh, U) { for (var k in U) sh.uniforms[k] = U[k];
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + I3V).replace("#include <project_vertex>", "#include <project_vertex>\n" + I3VM);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + I3F).replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n" + I3FM); }
  function patchShell(kind) { var m = MODELS[kind]; if (!m) return 0; var S = shellU(kind), U = S.u, n = 0;
    m.parts.forEach(function (pt) { var mat = pt.material; if (!mat || (mat.userData && mat.userData.int3sh)) return; mat.userData.int3sh = kind; var prev = mat.onBeforeCompile;
      mat.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r); shellHook(sh, U); };
      var pk = mat.customProgramCacheKey; mat.customProgramCacheKey = function () { return (pk ? pk.call(this) : "") + "|int3shell:" + kind; }; mat.needsUpdate = true; n++; });
    S.n += n; return n; }
  var _mx = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _vp = new THREE.Vector3(), _vs = new THREE.Vector3();
  function shellSet(h, on) { var T = TYPES[h.kind], U = shellU(h.kind).u; if (!on) { U.uIntOn.value = 0; U.uIntCam.value = 0; return; } var e = h.e, s = h.s;
    _vp.set(e[0], e[1], e[2]); _q.setFromAxisAngle(_up, e[3]); _vs.set(s, s, s); _mx.compose(_vp, _q, _vs); U.uIntInv.value.copy(_mx).invert();
    var c1 = T.cut[0], c2 = T.cut[1] || [0, 0, 0, 0, 0, 0]; U.uIntC1a.value.set(c1[0], c1[1], c1[2], c1[3]); U.uIntC1b.value.set(c1[4], c1[5]); U.uIntC2a.value.set(c2[0], c2[1], c2[2], c2[3]); U.uIntC2b.value.set(c2[4], c2[5]);
    U.uIntSee.value.set(T.see[0], T.see[1], T.see[2], T.see[3]); U.uIntSeeY.value = T.see[4]; U.uIntOn.value = 1; }

  // ───────────────────────── the porch: standable decks and steps, and the posts in front of the door (from the shell, cached per kind) ─────────────────────────
  function subGeo(kind, P) { var m = MODELS[kind]; var pos = [], A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3(); var x0 = P.x0 - 0.6, x1 = P.x1 + 0.6, z0 = P.z0 - 0.6, z1 = P.z1 + 0.6;
    m.parts.forEach(function (pt) { var g = pt.geometry, pa = g.attributes.position, ix = g.index ? g.index.array : null, F = (ix ? ix.length : pa.count) / 3;
      for (var f = 0; f < F; f++) { var a = ix ? ix[f * 3] : f * 3, b = ix ? ix[f * 3 + 1] : f * 3 + 1, c = ix ? ix[f * 3 + 2] : f * 3 + 2; A.fromBufferAttribute(pa, a); B.fromBufferAttribute(pa, b); Cc.fromBufferAttribute(pa, c);
        if (Math.min(A.y, B.y, Cc.y) > 4.2) continue; if (Math.max(A.x, B.x, Cc.x) < x0 || Math.min(A.x, B.x, Cc.x) > x1 || Math.max(A.z, B.z, Cc.z) < z0 || Math.min(A.z, B.z, Cc.z) > z1) continue; pos.push(A.x, A.y, A.z, B.x, B.y, B.z, Cc.x, Cc.y, Cc.z); } });
    var out = new THREE.BufferGeometry(); out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); out.computeVertexNormals(); out.computeBoundingSphere(); return out; }
  function porchOf(kind) { IN.porch = IN.porch || {}; if (IN.porch[kind]) return IN.porch[kind]; var T = TYPES[kind], P = T.porch, t0 = performance.now(); var res = { rows: [], posts: [] };
    try { var geo = subGeo(kind, P), mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld(true); var ray = new THREE.Raycaster(), dn = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3(), cell = 0.3;
      for (var z = P.z0 + cell / 2; z < P.z1; z += cell) { var run = null; for (var x = P.x0 + cell / 2; x < P.x1 + cell; x += cell) { var top = null; if (x < P.x1) { o.set(x, 1.7, z); ray.set(o, dn); ray.far = 2.1; var hs = ray.intersectObject(mesh, false); for (var i = 0; i < hs.length; i++) { var nn = hs[i].face && hs[i].face.normal; if (nn && nn.y > 0.55) { top = hs[i].point.y; break; } if (nn && nn.y < -0.55) break; } }
          if (top !== null && top < 0.08) top = null; if (run && top !== null && Math.abs(top - run.y) < 0.04) { run.x1 = x + cell / 2; run.y = Math.max(run.y, top); continue; } if (run) res.rows.push(run); run = top !== null ? { x0: x - cell / 2, x1: x + cell / 2, z: z, d: cell, y: top } : null; } if (run) res.rows.push(run); }
      // posts and piers: the shell's near-vertical faces that cross a slice at 1.3 m, rasterised on a 0.25 m grid, grouped into
      // connected blocks, one solid per block (thin pergola posts and the clubhouse's stone piers alike)
      if (P.posts) { var pa = geo.attributes.position, A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3(), E1 = new THREE.Vector3(), E2 = new THREE.Vector3(), cs = 0.25, occ = new Map(), Y = 1.3;
        var mark = function (x, z) { if (z < P.z0 + 0.25 || x < P.x0 || x > P.x1 || z > P.z1) return; var ix = Math.floor(x / cs), iz = Math.floor(z / cs); occ.set(ix + "," + iz, [ix, iz]); };
        for (var f = 0; f < pa.count / 3; f++) { A.fromBufferAttribute(pa, f * 3); B.fromBufferAttribute(pa, f * 3 + 1); Cc.fromBufferAttribute(pa, f * 3 + 2); if (Math.min(A.y, B.y, Cc.y) > Y || Math.max(A.y, B.y, Cc.y) < Y) continue; E1.subVectors(B, A); E2.subVectors(Cc, A); E1.cross(E2).normalize(); if (Math.abs(E1.y) > 0.5) continue;
          var vs = [A, B, Cc], pts = []; for (var k = 0; k < 3; k++) { var u = vs[k], v = vs[(k + 1) % 3]; if ((u.y - Y) * (v.y - Y) <= 0 && u.y !== v.y) { var t = (Y - u.y) / (v.y - u.y); pts.push([u.x + (v.x - u.x) * t, u.z + (v.z - u.z) * t]); } } if (pts.length < 2) continue; var n = Math.max(1, Math.ceil(Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) / (cs * 0.5))); for (var j = 0; j <= n; j++) mark(pts[0][0] + (pts[1][0] - pts[0][0]) * j / n, pts[0][1] + (pts[1][1] - pts[0][1]) * j / n); }
        var seen = {}; occ.forEach(function (c, key) { if (seen[key]) return; var st = [c], bx0 = c[0], bx1 = c[0], bz0 = c[1], bz1 = c[1], cnt = 0; seen[key] = 1; while (st.length) { var q = st.pop(); cnt++; bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); bz0 = Math.min(bz0, q[1]); bz1 = Math.max(bz1, q[1]); [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { var k2 = (q[0] + d[0]) + "," + (q[1] + d[1]); if (!seen[k2] && occ.has(k2)) { seen[k2] = 1; st.push(occ.get(k2)); } }); }
          if ((bx1 - bx0 + 1) * cs > 3.5 || (bz1 - bz0 + 1) * cs > 3.5) return; res.posts.push([(bx0 + bx1 + 1) / 2 * cs, (bz0 + bz1 + 1) / 2 * cs, (bx1 - bx0 + 1) * cs, (bz1 - bz0 + 1) * cs]); }); }
      geo.dispose(); } catch (e) { note("porch " + kind, e); }
    res.ms = Math.round(performance.now() - t0); return (IN.porch[kind] = res); }

  // ───────────────────────── collision swap while an interior exists ─────────────────────────
  function swapIn(h) { var e = h.e, L = h.L, T = TYPES[h.kind], s = h.s; L.saved = { sol: null, cols: [] };
    if (e.sol) { var i = SOLIDS.indexOf(e.sol); if (i >= 0) { SOLIDS.splice(i, 1); L.saved.sol = e.sol; } }
    for (var k = COLLIDERS.length - 1; k >= 0; k--) { var c = COLLIDERS[k]; if (Math.abs(c[0] - e[0]) < 0.05 && Math.abs(c[1] - e[2]) < 0.05) { L.saved.cols.push(c); COLLIDERS.splice(k, 1); } }
    T.walls.forEach(function (w) { var dx = w[2] - w[0], dz = w[3] - w[1], len = Math.hypot(dx, dz); if (len < 0.05) return; var cx = (w[0] + w[2]) / 2, cz = (w[1] + w[3]) / 2; var nx = -dz / len, nz = dx / len;   // push the solid 0.3 m outward (away from the footprint centre)
      if (nx * cx + nz * cz < 0) { nx = -nx; nz = -nz; } L.solid(cx + nx * 0.3, cz + nz * 0.3, len + 0.6, 0.6, -0.3, T.wallH, Math.atan2(dx, dz) + PI / 2); });
    var P = porchOf(h.kind); P.rows.forEach(function (r) { L.solid((r.x0 + r.x1) / 2, r.z, r.x1 - r.x0, r.d + 0.02, r.y - 0.45, r.y); }); (P.posts || []).forEach(function (p) { L.solid(p[0], p[1], p[2], p[3], 0, 3.0); });
    try { if (typeof updateCulling === "function") updateCulling(true); } catch (x) {} }
  function swapOut(h) { var L = h.L; if (!L || !L.saved) return; if (L.saved.sol && SOLIDS.indexOf(L.saved.sol) < 0) SOLIDS.push(L.saved.sol); L.saved.cols.forEach(function (c) { if (COLLIDERS.indexOf(c) < 0) COLLIDERS.push(c); }); L.saved = null; }
  // ───────────────────────── one interior: the group, its solids, seats, lights, hotspots, models and people ─────────────────────────
  var LODOK = { lounge_chair: 1, bookcase: 1, jettable: 1, jetbar: 1, exec_desk: 1, planter_lux: 1, cart: 1 };
  function makeL(h) {
    var e = h.e, s = h.s, T = TYPES[h.kind]; var g = new THREE.Group(); g.position.set(e[0], e[1], e[2]); g.rotation.y = e[3]; if (s !== 1) g.scale.setScalar(s); g.name = "int3 " + h.kind + " " + h.id; g.userData.noCull = true; g.userData.interior = true;
    var L = { h: h, g: g, e: e, s: s, T: T, solids: [], seats: [], lights: [], hots: [], models: [], people: [], doors: [], anim: [], tex: [], K: new Kit() };
    // a box solid in the model frame (y from the placement's base); seat: face yaw in the model frame
    L.solid = function (lx, lz, w, d, y0, y1, ry, face) { var p = l2w(e, lx * s, lz * s); var sd = addSolid(p[0], p[1], e[3] + (ry || 0), w * s, d * s, e[1] + y0 * s, e[1] + y1 * s, "int3"); if (sd) { L.solids.push(sd); if (face !== undefined) { sd.seat = true; sd.face = e[3] + face; L.seats.push(sd); } } return sd; };
    L.seat = function (lx, lz, w, d, y, face, ry) { return L.solid(lx, lz, w, d, y - 0.42, y, ry || 0, face); };
    L.light = function (col, k, dist, lx, ly, lz) { k *= IN.lk || 4.5; dist *= 1.35; var l = new THREE.PointLight(col, k, dist, 1.35); l.position.set(lx, ly, lz); l.userData.k0 = k; g.add(l); L.lights.push(l); return l; };
    // a hotspot of this interior: [kind, data], handled by this module (never the global list, so a mezzanine and the room below can each have one)
    L.hot = function (lx, ly, lz, r, kind, data) { var p = l2w(e, lx * s, lz * s); var o = { x: p[0], y: e[1] + ly * s, z: p[1], r: r, kind: kind, d: data || {} }; L.hots.push(o); return o; };
    // furniture uses the kind's far-LOD geometry with the full material where that holds up at arm's length (a fifth of the triangles)
    L.model = function (kind, lx, ly, lz, ry, sc, keepShadow) { if (!has(kind)) return null; var m = MODELS[kind], o; if (LODOK[kind] && m.lodGeos && m.lodGeos.length) { o = new THREE.Group(); m.lodGeos.forEach(function (geo, i) { o.add(new THREE.Mesh(geo, (m.parts[i] || m.parts[m.parts.length - 1]).material)); }); } else o = makeModel(kind); o.position.set(lx, ly, lz); o.rotation.y = ry || 0; if (sc) { if (sc.length) o.scale.set(sc[0], sc[1], sc[2]); else o.scale.setScalar(sc); } o.traverse(function (q) { if (q.isMesh) { q.castShadow = !!keepShadow; q.receiveShadow = true; q.userData.noSolid = true; if (!keepShadow || keepShadow === "in") q.material = indoor(q.material); } }); g.add(o); L.models.push(o); return o; };
    return L;
  }
  // ── door leaves (move, so not merged): glass in bronze, or walnut; hinged on the opening's sides, swinging inward
  function doorLeaves(L) { var D = L.T.door, M = mats(); var n = D.leaves, W = (D.x1 - D.x0) / n, H = D.h;
    for (var i = 0; i < n; i++) { var piv = new THREE.Group(), right = i === 1; piv.position.set(right ? D.x1 : D.x0, D.y0, D.z); var leaf = new THREE.Group(); leaf.position.x = right ? -W / 2 : W / 2; piv.add(leaf);
      var add = function (geo, mat, x, y, z) { var m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.receiveShadow = true; m.userData.own = true; leaf.add(m); return m; };
      if (D.mat === "glassDoor") { var fw = 0.07; add(new THREE.BoxGeometry(fw, H, 0.06), M.bronze, -W / 2 + fw / 2, H / 2, 0); add(new THREE.BoxGeometry(fw, H, 0.06), M.bronze, W / 2 - fw / 2, H / 2, 0); add(new THREE.BoxGeometry(W, 0.1, 0.06), M.bronze, 0, 0.05, 0); add(new THREE.BoxGeometry(W, 0.1, 0.06), M.bronze, 0, H - 0.05, 0); add(new THREE.PlaneGeometry(W - 2 * fw, H - 0.2), M.glassB, 0, H / 2, 0); add(new THREE.CylinderGeometry(0.018, 0.018, 1.3, 10), M.brass, right ? -W / 2 + 0.16 : W / 2 - 0.16, 1.15, 0.07); add(new THREE.CylinderGeometry(0.018, 0.018, 1.3, 10), M.brass, right ? -W / 2 + 0.16 : W / 2 - 0.16, 1.15, -0.07); }
      else { add(new THREE.BoxGeometry(W - 0.01, H, 0.07), M.walnut, 0, H / 2, 0); add(new THREE.BoxGeometry(W * 0.5, H * 0.34, 0.075), M.glassB, 0, H * 0.72, 0); add(new THREE.BoxGeometry(0.03, 0.9, 0.03), M.bronze, right ? -W / 2 + 0.12 : W / 2 - 0.12, 1.05, 0.07); add(new THREE.BoxGeometry(0.03, 0.9, 0.03), M.bronze, right ? -W / 2 + 0.12 : W / 2 - 0.12, 1.05, -0.07); }
      L.g.add(piv); L.doors.push({ piv: piv, sign: right ? -1 : 1 }); }
    L.door = { open: 0, target: 0, manual: null, solid: null };
    var c = (D.x0 + D.x1) / 2; L.door.solidArgs = [c, D.z, D.x1 - D.x0, 0.2, D.y0, D.y0 + D.h]; L.door.solid = L.solid.apply(null, L.door.solidArgs); }
  function doorSolidOn(L, on) { var sd = L.door && L.door.solid; if (!sd) return; var i = SOLIDS.indexOf(sd); if (on && i < 0) SOLIDS.push(sd); else if (!on && i >= 0) SOLIDS.splice(i, 1); }
  function setDoors(L, t) { var a = ease(t) * 1.62; L.doors.forEach(function (d) { d.piv.rotation.y = d.sign * a; }); }
  // the frame of the opening (static, merged), in the interior wall plane
  function doorFrame(L, key) { var D = L.T.door, K = L.K; var x0 = D.x0, x1 = D.x1, y0 = D.y0, y1 = D.y0 + D.h, z0 = D.zw - 0.02, z1 = D.z + 0.2;
    K.bb(key, x0 - 0.1, y0, z0, x0, y1 + 0.1, z1); K.bb(key, x1, y0, z0, x1 + 0.1, y1 + 0.1, z1); K.bb(key, x0 - 0.1, y1, z0, x1 + 0.1, y1 + 0.12, z1); K.bb("hearth", x0, y0 - 0.02, z0, x1, y0 + 0.012, z1); }

  function buildInterior(h) { var it = buildSteps(h), r; do { r = it.next(); } while (!r.done); return r.value; }
  // the same build in stages: plan_perf.js steps it inside a per-frame budget while the player is still on the way (R_PREP)
  function* buildSteps(h) {
    var t0 = performance.now(); var T = TYPES[h.kind], M = mats(); var L = makeL(h); h.L = L;
    swapIn(h); doorLeaves(L); yield;
    try { var sub = T.build(h, L, L.K, M); if (sub && typeof sub.next === "function") yield* sub; } catch (err) { note("build " + h.kind + " " + h.id, err); }
    yield; L.K.build(L.g, M); yield;
    L.g.traverse(function (o) { if (o.isMesh) { o.receiveShadow = !(o.material && o.material.transparent); if (o.castShadow === undefined) o.castShadow = false; } });
    scene.add(L.g); try { LIGHTS.dirty = true; } catch (e) {} shellSet(h, true); IN.active = h;
    IN.n.builds++; IN.n.lastBuildMs = Math.round(performance.now() - t0); IN.n.solids = L.solids.length; IN.n.seats = L.seats.length; IN.n.hots = L.hots.length;
    try { var tri = 0, dc = 0; L.g.traverse(function (o) { if (o.isMesh && o.geometry) { dc++; var gg = o.geometry; tri += (gg.index ? gg.index.count : gg.attributes.position.count) / 3; } }); IN.n.meshes = dc; IN.n.tris = Math.round(tri); } catch (e) {}
    return L;
  }
  function disposeInterior(h) {
    var L = h && h.L; if (!L) return; L.dead = true; try { if (inside && inside.int3 === h) myLeave(true); } catch (e) {}
    L.solids.forEach(function (sd) { var i = SOLIDS.indexOf(sd); if (i >= 0) SOLIDS.splice(i, 1); }); swapOut(h);
    L.people.forEach(function (p) { try { if (p.mixer) p.mixer.stopAllAction(); } catch (e) {} try { if (p.g && p.g.userData && p.g.userData.r5ids && typeof r5DropAvatar === "function") r5DropAvatar(p.g); else if (p.g && p.r5 && typeof r5Free === "function") r5Free(p.g, p.r5, true); } catch (e) {} });   /* R5: a person's label, tinted copies and skeleton go with the interior */ (L.anchors || []).forEach(function (a) { if (a.parent) a.parent.remove(a); }); try { if (typeof talkNpc !== "undefined" && talkNpc && talkNpc.g && (L.anchors || []).indexOf(talkNpc.g) >= 0) closeTalk(); } catch (e) {}
    if (L.g.parent) L.g.parent.remove(L.g);
    L.g.traverse(function (o) { if (o.isMesh && o.userData.int3 && o.geometry) o.geometry.dispose(); });
    L.g.traverse(function (o) { if ((o.isMesh || o.isSkinnedMesh) && o.userData.own) { if (o.geometry) o.geometry.dispose(); } });
    shellSet(h, false); h.L = null; if (IN.active === h) IN.active = null; IN.n.disposes++; try { LIGHTS.dirty = true; } catch (e) {} try { updateCulling(true); } catch (e) {}
  }
  // ───────────────────────── entering and leaving (the client's `inside`, no fade, no teleport) ─────────────────────────
  function localP(h, x, z) { var p = w2l(h.e, x, z); return [p[0] / h.s, p[1] / h.s]; }
  function doorW(h) { var D = TYPES[h.kind].door; var p = l2w(h.e, (D.x0 + D.x1) / 2 * h.s, D.z * h.s); return [p[0], h.e[1] + D.y0 * h.s, p[1]]; }
  // the room under a point: the highest room whose floor is at or below the feet (the clubhouse roof lounge sits over the lobby)
  function roomAt(h, x, z, y) { var T = TYPES[h.kind], q = localP(h, x, z), ly = (y - h.e[1]) / h.s, best = null; for (var i = 0; i < T.rooms.length; i++) { var r = T.rooms[i]; if (q[0] > r[0] - 0.05 && q[0] < r[2] + 0.05 && q[1] > r[1] - 0.05 && q[1] < r[3] + 0.05 && r[4] <= ly + 0.7 && (!best || r[4] > best[4])) best = r; } return best; }
  function blockedAt(L, x, z, y) { for (var i = 0; i < L.solids.length; i++) { var sd = L.solids[i]; if (sd.seat || y < sd.y0 || y > sd.y1) continue; if (Math.abs(sd.x - x) > sd.hw + sd.hd + 0.3 || Math.abs(sd.z - z) > sd.hw + sd.hd + 0.3) continue; var lp = solidLocal(sd, x, z); if (Math.abs(lp[0]) < sd.hw + 0.12 && Math.abs(lp[1]) < sd.hd + 0.12) return true; } return false; }
  function myEnter(h) {
    if (inside || (typeof riding !== "undefined" && riding) || (typeof golf !== "undefined" && golf.playing) || !h.L) return false; try { if (cartMode) toggleCart(); } catch (e) {}
    var T = TYPES[h.kind];
    var atDoor = function () { var p = localP(h, player.position.x, player.position.z), D = T.door; return p[1] > D.zw - 1.9 && p[0] > D.x0 - 0.9 && p[0] < D.x1 + 0.9 && player.position.y < h.e[1] + (D.y0 + 1.4) * h.s; };
    inside = { door: { kind: "int3_" + h.kind, i: h.i, e: h.e, r: T.R * h.s }, g: h.L.g, half: T.R * h.s + 8, atDoor: atDoor, hiddenWorld: [], saved: [], int3: h };
    IN.n.enters++; try { visited(h); } catch (e) { note("visit", e); } try { lastSent.at = 0; pushMove(true); } catch (e2) {} return true;
  }
  function myLeave() {
    if (!inside || !inside.int3) return; try { if (SIT.on) { SIT.on = false; player.userData.sit = false; } } catch (e) {}
    inside_left_at = performance.now(); try { player.userData.walk.visible = true; } catch (e) {} inside = null; IN.n.leaves++; try { lastSent.at = 0; pushMove(true); } catch (e) {}
  }
  // E at the door from inside: the leaves open and you step out onto the porch, facing out
  function stepOut(h) { var T = TYPES[h.kind], D = T.door, L = h.L; if (L && L.door) { L.door.target = 1; L.door.open = Math.max(L.door.open, 0.75); setDoors(L, L.door.open); doorSolidOn(L, false); }
    var p = l2w(h.e, (D.x0 + D.x1) / 2 * h.s, (D.z + 1.4) * h.s); myLeave(); var y = h.e[1] + D.y0 * h.s; try { y = surfaceAt(p[0], p[1], y + 0.3); } catch (e) {}
    player.position.set(p[0], y, p[1]); player.rotation.y = h.e[3]; yaw = h.e[3] + PI; pitch = 0.08; airborne = false; vy = 0; try { lastSent.at = 0; pushMove(true); sfx("ui"); } catch (e) {} }
  // progress: the place stamp that fits (if any) and some XP the first time each interior is visited on a day
  var STAMP = { b0036: "p_landing_club", b0292: "p_golf_clubhouse", b0062: "p_flightline_market", b0069: "p_flightline_market" };
  function visited(h) { var P = window.PLAN_PROGRESS; if (!P || !P.award) return; var id = STAMP[h.id] || (h.kind === "hangarhome2" ? (h.e[0] > 200 ? "p_founders_row" : "p_flightline_row") : null); if (id) P.award("stamp", { id: id });
    var key = "g1:int3:" + new Date().toISOString().slice(0, 10); var seen = {}; try { seen = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { seen = {}; }
    var tag = h.kind === "hangarhome2" ? "hangarhome" : h.id; if (seen[tag]) return; seen[tag] = 1; try { localStorage.setItem(key, JSON.stringify(seen)); } catch (e) {}
    P.award("activity", { game: h.kind === "hangarhome2" ? "Hangar home open house" : (h.name || TYPES[h.kind].label) }); }

  // ───────────────────────── the camera inside: the client's interior camera, bounded by these rooms, their walls and ceilings ─────────────────────────
  function camHook(dt) {
    if (!inside || !inside.int3 || window.__cam) return false; var h = inside.int3, L = h.L; if (!L) return false;
    try { var fwd = [-Math.sin(yaw), -Math.cos(yaw)]; var px = player.position.x, pz = player.position.z, py = player.position.y; var room = roomAt(h, px, pz, py); var ceil = room ? h.e[1] + room[5] * h.s : py + 3; var cy0 = py - bobY + 1.75, dist = 0;
      for (var d = 0.2; d <= 3.4; d += 0.2) { var cx = px - fwd[0] * d, cz = pz - fwd[1] * d; var r2 = roomAt(h, cx, cz, py); var q = localP(h, cx, cz); if (!r2 || q[0] < r2[0] + 0.3 || q[0] > r2[2] - 0.3 || q[1] < r2[1] + 0.3 || q[1] > r2[3] - 0.3 || blockedAt(L, cx, cz, cy0)) break; dist = d; }
      if (inside.fp === undefined) inside.fp = dist < 1.4; else if (inside.fp && dist > 2.2) inside.fp = false; else if (!inside.fp && dist < 1.2) inside.fp = true;
      CAM.dist += (dist - CAM.dist) * smoothK(dt, 10); var sd = Math.min(dist, CAM.dist);
      if (inside.fp) { camera.position.set(px, py - bobY + 1.62, pz); CAM.init = false; camera.lookAt(px + fwd[0] * 10, py - bobY + 1.62 - pitch * 6, pz + fwd[1] * 10); player.userData.walk.visible = false; }
      else { var cy = Math.min(py - bobY + 1.9 + pitch * 1.2, ceil - 0.35); camera.position.lerp(camTarget.set(px - fwd[0] * sd, cy, pz - fwd[1] * sd), smoothK(dt, 24)); camLook(px, py - bobY + 1.3, pz, dt, 30); player.userData.walk.visible = true; }
      return true; } catch (e) { note("cam", e); return false; }
  }

  // ───────────────────────── E and the prompt ─────────────────────────
  // a person you are facing (within 2.8 m, 55 degrees) wins over the seats around them (the bar stools, the booths)
  function facedTalk() { var h = inside && inside.int3, L = h && h.L; if (!L || SIT.on) return null; var px = player.position.x, pz = player.position.z, fx = -Math.sin(yaw), fz = -Math.cos(yaw), best = null, bd = 2.8;
    var sd = 9; for (var j = 0; j < L.seats.length; j++) { var st = L.seats[j]; if (Math.abs(st.y1 - player.position.y) < 1.5) sd = Math.min(sd, Math.hypot(st.x - px, st.z - pz)); }
    for (var i = 0; i < L.hots.length; i++) { var o = L.hots[i]; if ((o.kind !== "talk" && !o.d.faced) || Math.abs(player.position.y - o.y) > 1.6) continue; var P = o.d.who; var wp = P && P.g ? P.g.getWorldPosition(_tv) : null; if (!wp && P) { var pw = l2w(h.e, P.x * h.s, P.z * h.s); _tv.set(pw[0], 0, pw[1]); wp = _tv; } var tx = wp ? wp.x : o.x, tz = wp ? wp.z : o.z; var dx = tx - px, dz = tz - pz, d = Math.hypot(dx, dz); if (d > bd || d < 0.05 || d > sd + 1.2) continue; if ((dx * fx + dz * fz) / d < 0.57) continue; bd = d; best = o; } return best; }
  var _tv = new THREE.Vector3();
  function nearHot() { var h = inside && inside.int3, L = h && h.L; if (!L) return null; var px = player.position.x, py = player.position.y, pz = player.position.z, best = null, bd = 1e9;
    for (var i = 0; i < L.hots.length; i++) { var o = L.hots[i]; if (Math.abs(py - o.y) > 1.6) continue; var d = Math.hypot(o.x - px, o.z - pz); if (d < o.r && d < bd) { bd = d; best = o; } } return best; }
  function nearDoorOutside() { var h = IN.active; if (!h || !h.L || inside) return null; var D = TYPES[h.kind].door, q = localP(h, player.position.x, player.position.z); if (q[1] < D.z - 0.2 || q[1] > D.z + 3.2 || q[0] < D.x0 - 1.4 || q[0] > D.x1 + 1.4) return null; if (Math.abs(player.position.y - (h.e[1] + D.y0 * h.s)) > 1.5) return null; return h; }
  // the hangar home's glass hangar door: in front of it outside, or inside the bay near it
  function nearHangarDoor() { var h = IN.active, L = h && h.L; if (!L || !L.hangar) return null; var q = localP(h, player.position.x, player.position.z); if (q[0] < -10.3 || q[0] > 6.2 || q[1] < 8.5 || q[1] > 17 || Math.abs(player.position.y - h.e[1]) > 2) return null; if (Math.hypot(q[0] - 10.6, q[1] - 10.6) < 3.5) return null; return h; }
  function infoCard(t, k, p) { $("#info-h").textContent = t; $("#info-k").textContent = k || ""; $("#info-p").textContent = p || ""; var go = $("#info-go"); if (go) go.style.display = "none"; var nv = $("#info-nav"); if (nv) nv.style.display = "none"; $("#info").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock(); try { sfx("ui"); } catch (e) {} }
  function useHot(o) { var d = o.d || {};
    if (o.kind === "talk") { var c = window.PLAN_TALK[d.id]; if (c && c.talk && c.talk.length) { showTalk(c, 0); return true; } return false; }
    if (o.kind === "info") { infoCard(d.t, d.k, d.p); return true; }
    if (o.kind === "shop") { try { openShop(d.shop || "restaurant"); } catch (e) { note("shop", e); } return true; }
    return false; }
  // standing up from one of these seats: the client steps 0.55 m forward, which from a bar stool or a dining chair lands on the
  // counter or the table; here you step out to the first free side (behind, then left, right, front) onto the floor
  function freeAt(x, z, y) { for (var i = 0; i < SOLIDS.length; i++) { var sd = SOLIDS[i]; if (y + 0.3 > sd.y1 || y + 1.7 < sd.y0) continue; if (Math.abs(sd.x - x) > sd.hw + sd.hd + 0.5 || Math.abs(sd.z - z) > sd.hw + sd.hd + 0.5) continue; var lp = solidLocal(sd, x, z); if (Math.abs(lp[0]) < sd.hw + 0.28 && Math.abs(lp[1]) < sd.hd + 0.28) return false; } return true; }
  function standUpHere() { var h = inside && inside.int3, L = h && h.L; if (!L || !SIT.on) return false; var px = player.position.x, pz = player.position.z, seat = null; for (var i = 0; i < L.seats.length; i++) { var sd = L.seats[i]; if (Math.abs(sd.y1 - player.position.y) > 0.2) continue; var lq = solidLocal(sd, px, pz); if (Math.abs(lq[0]) <= sd.hw + 0.1 && Math.abs(lq[1]) <= sd.hd + 0.1) { seat = sd; break; } } if (!seat) return false;
    var f = player.rotation.y, fx = Math.sin(f), fz = Math.cos(f), room = roomAt(h, px, pz, seat.y1 - 0.4), fy = h.e[1] + (room ? room[4] : TYPES[h.kind].floor) * h.s; if (seat.y1 - fy > 1.2) fy = seat.y1 - 0.5;
    var tries = [[-fx, -fz], [-fz, fx], [fz, -fx], [fx, fz]]; for (var d = 0.75; d <= 1.35; d += 0.3) for (var t = 0; t < 4; t++) { var x = px + tries[t][0] * d, z = pz + tries[t][1] * d; if (!freeAt(x, z, fy)) continue;
      SIT.on = false; try { sitClear(player); } catch (e) {} player.userData.sit = false; player.position.set(x, fy, z); player.position.y = surfaceAt(x, z, fy + 0.3); airborne = false; vy = 0; try { lastSent.at = 0; pushMove(true); } catch (e) {} return true; }
    return false; }
  function handleE() {
    try { if (IN.off) return false;
      if (inside && inside.int3) { if (SIT.on) return standUpHere(); var ft = facedTalk(); if (ft && useHot(ft)) return true; if (nearestSeat()) return false; var o = nearHot(); if (o && useHot(o)) return true; if (inside.atDoor()) { stepOut(inside.int3); return true; } var hb = nearHangarDoor(); if (hb) { var Hb = hb.L.hangar, ob = Hb.target > 0.5; Hb.manual = !ob; Hb.target = ob ? 0 : 1; try { sfx("board"); } catch (e) {} return true; } return false; }
      if (!inside && !(typeof riding !== "undefined" && riding)) { var h = nearDoorOutside(); if (h && h.L && h.L.door) { var open = h.L.door.target > 0.5; h.L.door.manual = !open; h.L.door.target = open ? 0 : 1; try { sfx("board"); } catch (e) {} return true; } }
      var hh = nearHangarDoor(); if (hh && !(inside && inside.int3 && nearHot())) { var H = hh.L.hangar, op = H.target > 0.5; H.manual = !op; H.target = op ? 0 : 1; try { sfx("board"); } catch (e) {} return true; }
    } catch (e) { note("E", e); } return false;
  }
  function prompt() {
    try { if (IN.off) return; var el = $("#prompt"), t = $("#prompt-t"); if (!el || !t) return;
      if (inside && inside.int3) { if (SIT.on) return; var o = facedTalk() || (nearestSeat() ? null : nearHot()); if (!o && nearestSeat()) return; if (o) { t.innerHTML = "<b>E</b> &nbsp;" + (o.d.prompt || (o.kind === "talk" ? "talk to " + (o.d.name || "the host") : o.kind === "shop" ? "order" : "about " + (o.d.t || "this room"))); el.classList.add("on"); return; }
        if (inside.atDoor()) { t.innerHTML = "<b>E</b> &nbsp;step outside · or just walk out"; el.classList.add("on"); return; } var hb = nearHangarDoor(); if (hb) { t.innerHTML = "<b>E</b> &nbsp;" + (hb.L.hangar.target > 0.5 ? "close" : "open") + " the hangar door"; el.classList.add("on"); return; } t.innerHTML = inside.int3.L && inside.int3.L.tip ? inside.int3.L.tip : "look around · walk out through the door to leave"; el.classList.add("on"); return; }
      if (!inside && !(typeof riding !== "undefined" && riding)) { var h = nearDoorOutside(); if (h && h.L && h.L.door) { var open = h.L.door.target > 0.5; t.innerHTML = open ? "<b>E</b> &nbsp;close the door · or walk in" : "<b>E</b> &nbsp;open the door"; el.classList.add("on"); return; } var hh = nearHangarDoor(); if (hh) { t.innerHTML = "<b>E</b> &nbsp;" + (hh.L.hangar.target > 0.5 ? "close the hangar door · or walk into the bay" : "open the hangar door"); el.classList.add("on"); } } } catch (e) { note("prompt", e); }
  }
  // ───────────────────────── people: the client's avatars, and the round 3 rigged staff (cloned from one download per kind) ─────────────────────────
  var RIG = IN.rigs = IN.rigs || {};
  function rigInfo(k) { var I = window.PLAN_MODEL_INFO && window.PLAN_MODEL_INFO[k]; return I && I.file && I.installed ? I : null; }
  function rigLoad(k) { if (RIG[k]) return RIG[k].p; var I = rigInfo(k); if (!I || !THREE.SkeletonUtils) return Promise.resolve(null); var R = RIG[k] = { gl: null, clips: {} }; var q = "?v=" + (window.BUILD || "dev"); var mob = false; try { mob = /models_m/.test(ASSET.models); } catch (e) {}
    var ld = function (u) { return new Promise(function (ok) { try { gltfLoader().load(u + q, ok, undefined, function () { ok(null); }); } catch (e) { ok(null); } }); };
    R.p = Promise.all([ld(mob && I.mobile ? I.mobile : I.file), I.idle ? ld(I.idle) : null, I.walk ? ld(I.walk) : null]).then(function (a) { if (!a[0]) { note("rig " + k, "load failed"); return null; } R.gl = a[0]; R.h = I.height || 1.8;
      ["idle", "walk"].forEach(function (c, j) { var g = a[j + 1]; var cl = g && g.animations && g.animations[0]; if (cl) { cl.tracks = cl.tracks.filter(function (t) { return !/\.scale$/.test(t.name); }); R.clips[c] = cl; } }); return R; });
    return R.p; }
  // a person in the room frame: { kind: rig kind | null (avatar), look, x, z, y (floor), yaw, sit, walk: [[x, z, dwell, yaw]...], face (turn to a visitor), name }
  function person(L, o) { var P = { o: o, x: o.x, z: o.z, y: o.y, yaw: o.yaw || 0, yaw0: o.yaw || 0, g: null, mixer: null, act: null, t: 0, k: 0, pause: o.walk ? 2 + Math.random() * 4 : 0, sp: o.speed || 0.95 }; L.people.push(P);
    if (o.rig && rigInfo(o.rig) && THREE.SkeletonUtils) { rigLoad(o.rig).then(function (R) { if (!R || !L.g.parent && L.dead) return; if (L.dead) return; try { if (typeof r5Ids === "function" && typeof R5 !== "undefined" && R5.on) P.r5 = r5Ids(); var g = THREE.SkeletonUtils.clone(R.gl.scene); g.traverse(function (q) { if (q.isMesh || q.isSkinnedMesh) { q.castShadow = false; q.receiveShadow = true; q.frustumCulled = false; } });
        /* R9i: the box of a fresh clone skins every vertex on the CPU (75 ms a person); every clone of a rig has the same pose, so it is measured once per rig */ var hh = R9I && R.r9hh !== undefined ? R.r9hh : (function () { var bb = new THREE.Box3().setFromObject(g); return bb.max.y - bb.min.y; })(); if (R9I) R.r9hh = hh; if (hh > 0.5 && Math.abs(hh - R.h) > R.h * 0.12) g.scale.multiplyScalar(R.h / hh); P.mixer = new THREE.AnimationMixer(g); P.clips = {}; for (var c in R.clips) P.clips[c] = P.mixer.clipAction(R.clips[c]); P.g = g; P.rig = true; L.g.add(g); place(P); } catch (e) { note("rig spawn " + o.rig, e); } }); if (!o.fallback) return P; }
    try { var a = avatar("int3_" + (o.id || L.people.length) + "_" + L.h.id, o.name || "", o.look || { body: "m" }, o.hat || null, o.outfit || null); if (a.userData.label) { a.userData.label.visible = !!o.label; a.userData.label.scale.set(1.3, 0.34, 1); } if (a.userData.blob) a.userData.blob.visible = false;
      if (o.sit) { a.userData.sit = true; try { sitOffset(a, o.back); } catch (e) {} } P.g = a; L.g.add(a); place(P); if (o.toque) P.hat = toque(a); } catch (e) { note("avatar", e); }
    return P; }
  function place(P) { if (!P.g) return; P.g.position.set(P.x, P.y + (P.o.sit ? P.o.seatY || 0.46 : 0) - (P.o.sit ? 0.02 : 0), P.z); P.g.rotation.y = P.yaw; }
  // a chef's toque: kept upright on top of the head bone every frame (the rig's head axes are not the world's)
  function toque(a) { var head = null; a.traverse(function (q) { if (!head && q.isBone && /head$/i.test(q.name)) head = q; }); if (!head) return null; var M = mats(); var hat = new THREE.Group(); var band = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.095, 0.1, 16), M.white); band.position.y = 0.05; var puff = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 10), M.white); puff.scale.set(1, 0.72, 1); puff.position.y = 0.14; band.userData.own = puff.userData.own = true; hat.add(band, puff); a.add(hat); return { g: hat, head: head }; }
  var _hv = new THREE.Vector3();
  function hatFrame(P) { var H = P.hat; if (!H) return; P.g.updateMatrixWorld(true); H.head.getWorldPosition(_hv); P.g.worldToLocal(_hv); H.g.position.set(_hv.x, _hv.y + 0.13, _hv.z); }
  function turnTo(P, want, dt, rate) { var err = Math.atan2(Math.sin(want - P.yaw), Math.cos(want - P.yaw)), tr = rate * dt; P.yaw += err > tr ? tr : err < -tr ? -tr : err; }
  function peopleFrame(L, dt) { var h = L.h, pl = localP(h, player.position.x, player.position.z), inHere = !!(inside && inside.int3 === h);
    if (L.lblIn !== inHere) { L.lblIn = inHere; L.people.forEach(function (P) { var lb = P.g && P.g.userData && P.g.userData.label; if (lb) lb.visible = inHere && !!P.o.label; }); }   // names only inside (a sprite would show through the shell's glass)
    for (var i = 0; i < L.people.length; i++) { var P = L.people[i]; if (!P.g) continue; var o = P.o, moving = false;
      if (o.walk && o.walk.length) { if (P.pause > 0) { P.pause -= dt; var w0 = o.walk[P.k]; if (w0[3] !== undefined) turnTo(P, w0[3], dt, 2.5); }
        else { var tg = o.walk[(P.k + 1) % o.walk.length]; var dx = tg[0] - P.x, dz = tg[1] - P.z, d = Math.hypot(dx, dz); if (d < 0.08) { P.k = (P.k + 1) % o.walk.length; P.pause = tg[2] || 0; } else { var st = Math.min(d, P.sp * dt); P.x += dx / d * st; P.z += dz / d * st; turnTo(P, Math.atan2(dx, dz), dt, 5); moving = true; } } }
      else if (o.face !== false && !o.sit) { var dxp = pl[0] - P.x, dzp = pl[1] - P.z; turnTo(P, Math.hypot(dxp, dzp) < 6 && Math.abs((player.position.y - h.e[1]) - P.y) < 2 ? Math.atan2(dxp, dzp) : P.yaw0, dt, 2.2); }
      P.g.position.x = P.x; P.g.position.z = P.z; P.g.rotation.y = P.yaw; if (P.anchor) anchorAt(L, P);
      if (P.rig) { var clip = moving && P.clips.walk ? P.clips.walk : (P.clips.idle || P.clips.walk); if (clip && P.act !== clip) { if (P.act) P.act.fadeOut(0.3); clip.reset().fadeIn(0.3).play(); P.act = clip; } if (clip && moving) clip.timeScale = P.sp / 0.72; P.mixer.update(Math.min(dt, 0.1)); }
      else { try { animateWalk(P.g, moving ? P.sp : 0, dt); if (P.hat) hatFrame(P); } catch (e) { if (!IN.awErr) { IN.awErr = 1; note("walk anim", e); } } } } }
  // talk cards (plan/interiors.json): {club}, {venue} are filled in for the building the person stands in
  function talkOf(sectKey, who, vars) { var c = sect(sectKey)[who] || DEF[sectKey][who]; var fill = function (s) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? vars[k] : m; }); };
    return { name: fill(c.name), role: fill(c.role), greet: (c.greet || []).map(fill), talk: (c.talk || []).map(function (n) { return { t: fill(n.t), o: (n.o || [["Thanks", null]]).map(function (x) { return [fill(x[0]), x[1]]; }) }; }) }; }
  // the talk card's `g` is an anchor in the scene at the person's WORLD position (the client measures talkNpc.g.position against
  // the player to close the card at 10 m; the person itself lives in the rotated room group, and a rig may still be loading)
  function registerTalk(id, L, P, sectKey, who, vars) { var c = talkOf(sectKey, who, vars); P.anchor = new THREE.Object3D(); P.anchor.name = "int3 talk " + id; anchorAt(L, P); scene.add(P.anchor); L.anchors = (L.anchors || []).concat([P.anchor]);
    var T = window.PLAN_TALK[id] = { id: id, name: c.name, role: c.role, talk: c.talk, greet: c.greet, kw: [], sect: sectKey, who: who, vars: vars, get g() { return P.anchor; } }; P.talkId = id; return T; }
  function anchorAt(L, P) { var w = l2w(L.e, P.x * L.s, P.z * L.s); P.anchor.position.set(w[0], L.e[1] + P.y * L.s, w[1]); P.anchor.rotation.y = L.e[3] + P.yaw; }
  function refreshTalk() { for (var id in window.PLAN_TALK) { var T = window.PLAN_TALK[id]; if (!T || !T.sect || id.indexOf("int3_") !== 0) continue; var c = talkOf(T.sect, T.who, T.vars); T.name = c.name; T.role = c.role; T.talk = c.talk; T.greet = c.greet; } }
  // ───────────────────────── building blocks (room frame; F = the floor height) ─────────────────────────
  // a straight wall: along x (z = c, from x a to b) or along z (x = c, from z a to b), y0..y1, thickness t; openings
  // [a0, a1, oy0, oy1, "glass" | "open" | "none", mullion spacing]; solids for everything that is not an open passage
  function wall(L, key, ax, c, a, b, y0, y1, t, open, frameKey) { var K = L.K; t = t || 0.2; open = (open || []).slice().sort(function (p, q) { return p[0] - q[0]; });
    var piece = function (p0, p1, q0, q1, solid) { if (p1 - p0 < 0.01 || q1 - q0 < 0.01) return; if (ax === "x") { K.bb(key, p0, q0, c - t / 2, p1, q1, c + t / 2); if (solid) L.solid((p0 + p1) / 2, c, p1 - p0, t, q0 - 0.2, q1); } else { K.bb(key, c - t / 2, q0, p0, c + t / 2, q1, p1); if (solid) L.solid(c, (p0 + p1) / 2, t, p1 - p0, q0 - 0.2, q1); } };
    var cur = a; open.forEach(function (o) { if (o[4] !== "none" && o[4] !== "glass") (L.ports || (L.ports = [])).push([ax, c, o[0], o[1], o[2], o[3]]);   // openings, for plan_perf.js's indoor culling
      piece(cur, o[0], y0, y1, true); piece(o[0], o[1], y0, o[2], true); piece(o[0], o[1], o[3], y1, false);
      if (o[4] === "glass") { glazing(L, ax, c, o[0], o[1], o[2], o[3], o[5] || 1.6, frameKey || "bronze"); if (ax === "x") L.solid((o[0] + o[1]) / 2, c, o[1] - o[0], t, o[2], o[3]); else L.solid(c, (o[0] + o[1]) / 2, t, o[1] - o[0], o[2], o[3]); }
      else if (o[4] === "none") piece(o[0], o[1], o[2], o[3], true);
      else if (o[4] === "open" && frameKey) { var fk = frameKey; if (ax === "x") { K.bb(fk, o[0] - 0.06, y0, c - t / 2 - 0.03, o[0], o[3] + 0.06, c + t / 2 + 0.03); K.bb(fk, o[1], y0, c - t / 2 - 0.03, o[1] + 0.06, o[3] + 0.06, c + t / 2 + 0.03); K.bb(fk, o[0] - 0.06, o[3], c - t / 2 - 0.03, o[1] + 0.06, o[3] + 0.08, c + t / 2 + 0.03); }
        else { K.bb(fk, c - t / 2 - 0.03, y0, o[0] - 0.06, c + t / 2 + 0.03, o[3] + 0.06, o[0]); K.bb(fk, c - t / 2 - 0.03, y0, o[1], c + t / 2 + 0.03, o[3] + 0.06, o[1] + 0.06); K.bb(fk, c - t / 2 - 0.03, o[3], o[0] - 0.06, c + t / 2 + 0.03, o[3] + 0.08, o[1] + 0.06); } }
      cur = o[1]; }); piece(cur, b, y0, y1, true); }
  // a glazed opening: glass pane with slim mullions every `sp` metres and a transom rail, in the wall plane
  function glazing(L, ax, c, a0, a1, y0, y1, sp, fk) { (L.ports || (L.ports = [])).push([ax, c, a0, a1, y0, y1]); var K = L.K, n =Math.max(1, Math.round((a1 - a0) / sp)), w = (a1 - a0) / n, m = 0.06;
    if (ax === "x") { K.quad("glass", a1 - a0, y1 - y0, (a0 + a1) / 2, (y0 + y1) / 2, c, 0); for (var i = 0; i <= n; i++) K.bb(fk, a0 + i * w - m / 2, y0, c - 0.05, a0 + i * w + m / 2, y1, c + 0.05); K.bb(fk, a0, y0 - 0.05, c - 0.07, a1, y0 + 0.02, c + 0.07); K.bb(fk, a0, y1 - 0.02, c - 0.07, a1, y1 + 0.05, c + 0.07); if (y1 - y0 > 3) K.bb(fk, a0, y0 + (y1 - y0) * 0.72 - 0.03, c - 0.05, a1, y0 + (y1 - y0) * 0.72 + 0.03, c + 0.05); }
    else { K.quad("glass", a1 - a0, y1 - y0, c, (y0 + y1) / 2, (a0 + a1) / 2, PI / 2); for (var j = 0; j <= n; j++) K.bb(fk, c - 0.05, y0, a0 + j * w - m / 2, c + 0.05, y1, a0 + j * w + m / 2); K.bb(fk, c - 0.07, y0 - 0.05, a0, c + 0.07, y0 + 0.02, a1); K.bb(fk, c - 0.07, y1 - 0.02, a0, c + 0.07, y1 + 0.05, a1); if (y1 - y0 > 3) K.bb(fk, c - 0.05, y0 + (y1 - y0) * 0.72 - 0.03, a0, c + 0.05, y0 + (y1 - y0) * 0.72 + 0.03, a1); } }
  // floor (with a solid under the whole rectangle) and ceiling
  function floorRect(L, key, x0, z0, x1, z1, y, ur) { L.K.flat(key, x0, z0, x1, z1, y + 0.003, true, undefined, ur); L.solid((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, y - 0.5, y); }
  function ceilRect(L, key, x0, z0, x1, z1, y) { L.K.flat(key, x0, z0, x1, z1, y, false); }
  // a framed picture on a wall facing `ry` (0 = +z): the mat key carries the picture, uv sub-rect optional
  function picture(L, key, x, y, z, w, h, ry, uv, frameKey) { var K = L.K, fx = Math.sin(ry), fz = Math.cos(ry); K.box(frameKey || "ebony", w + 0.12, h + 0.12, 0.05, x - fx * 0.0, y, z - fz * 0.0, ry, 0); if (uv) K.quv(key, w, h, x + fx * 0.03, y, z + fz * 0.03, ry, uv[0], uv[1], uv[2], uv[3]); else K.quv(key, w, h, x + fx * 0.03, y, z + fz * 0.03, ry, 0, 0, 1, 1); }
  // furniture (procedural, merged per material)
  function roundTable(L, x, z, F, r, cloth) { var K = L.K; if (cloth) { K.cyl("linen", r + 0.06, r + 0.1, 0.72, x, F + 0.39, z, 28); K.cyl("linen", r + 0.06, r + 0.06, 0.03, x, F + 0.755, z, 28); } else { K.cyl("walnut", r, r, 0.04, x, F + 0.74, z, 28); K.cyl("bronze", 0.05, 0.05, 0.7, x, F + 0.37, z, 10); K.cyl("bronze", 0.28, 0.32, 0.03, x, F + 0.015, z, 20); } L.solid(x, z, r * 1.6, r * 1.6, F, F + 0.76); }
  function setting(L, x, z, F, ry) { var K = L.K, fx = Math.sin(ry), fz = Math.cos(ry); K.cyl("ceramic", 0.14, 0.12, 0.015, x, F + 0.775, z, 20); K.cyl("glassB", 0.035, 0.03, 0.12, x + fz * 0.18 - fx * 0.14, F + 0.83, z - fx * 0.18 - fz * 0.14, 10); K.box("brushed", 0.02, 0.006, 0.2, x + fz * 0.19, F + 0.772, z - fx * 0.19, ry, 0); K.box("brushed", 0.02, 0.006, 0.2, x - fz * 0.19, F + 0.772, z + fx * 0.19, ry, 0); }
  // an upholstered dining chair: walnut frame and tapered legs, a padded seat, a back raked 8 degrees with a walnut top rail
  function chair(L, x, z, F, ry, fab, seat) { var K = L.K, c = Math.cos(ry), sn = Math.sin(ry); var P = function (lx, lz) { return [x + lx * c + lz * sn, z - lx * sn + lz * c]; };
    var q = P(0, 0.01); K.box("walnut", 0.47, 0.05, 0.46, q[0], F + 0.425, q[1], ry, 0); K.box(fab, 0.45, 0.07, 0.43, q[0], F + 0.485, q[1], ry, 0);
    [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]].forEach(function (p) { var w = P(p[0], p[1]); K.cyl("walnut", 0.022, 0.014, 0.41, w[0], F + 0.205, w[1], 6); });
    var bk = new THREE.BoxGeometry(0.44, 0.5, 0.06); bk.translate(0, 0.25, 0); bk.rotateX(-0.14); var bq = P(0, -0.2); K.geo(fab, bk, bq[0], F + 0.47, bq[1], ry);
    var rl = new THREE.BoxGeometry(0.48, 0.05, 0.05); rl.translate(0, 0.5, 0); rl.rotateX(-0.14); K.geo("walnut", rl, bq[0], F + 0.47, bq[1], ry); [-0.21, 0.21].forEach(function (o) { var pg = new THREE.CylinderGeometry(0.016, 0.018, 0.55, 6); pg.translate(0, 0.27, 0); pg.rotateX(-0.14); var pq = P(o, -0.21); K.geo("walnut", pg, pq[0], F + 0.45, pq[1], ry); });
    if (seat !== false) L.seat(x, z, 0.5, 0.5, F + 0.52, ry); else L.solid(x, z, 0.46, 0.46, F, F + 0.52); }
  function stool(L, x, z, F, ry, top) { var K = L.K; top = top || 0.76; K.cyl("tan", 0.2, 0.19, 0.08, x, F + top, z, 16); K.cyl("brass", 0.025, 0.035, top - 0.04, x, F + (top - 0.04) / 2, z, 8); K.cyl("brass", 0.2, 0.2, 0.02, x, F + 0.28, z, 16); K.cyl("bronze", 0.2, 0.22, 0.02, x, F + 0.01, z, 16); L.seat(x, z, 0.42, 0.42, F + top + 0.04, ry); }
  function pendant(L, x, y, z, drop, key) { var K = L.K; K.cyl("brass", 0.006, 0.006, drop, x, y - drop / 2, z, 4); K.cyl(key || "shade", 0.1, 0.24, 0.26, x, y - drop - 0.1, z, 18); K.sph("lamp", 0.06, x, y - drop - 0.2, z, 1, 10); }
  function plant(L, x, z, F, h, s) { var K = L.K, R = rng(Math.round(x * 13 + z * 7)); s = s || 1; K.cyl("pot", 0.26 * s, 0.2 * s, 0.5 * s, x, F + 0.25 * s, z, 16); K.cyl("soil", 0.24 * s, 0.24 * s, 0.02, x, F + 0.49 * s, z, 12); for (var i = 0; i < 7; i++) { var a = i / 7 * TAU + R(), rr = 0.05 + R() * 0.18 * s; K.sph("leaf", (0.14 + R() * 0.1) * s, x + Math.cos(a) * rr, F + 0.5 * s + (0.25 + R() * (h - 0.6)) * s, z + Math.sin(a) * rr, 1.5, 8); } L.solid(x, z, 0.5 * s, 0.5 * s, F, F + 0.9); }
  function rug(L, key, x, z, w, d, F, ry) { L.K.quad(key, w, d, x, F + 0.008, z, ry || 0, -PI / 2); }
  // a procedural sofa (plinth, seat cushions, back, arms), facing +z at ry 0; seats along it
  function sofa(L, x, z, F, w, ry, fab, seats) { var K = L.K, c = Math.cos(ry), s = Math.sin(ry); var P = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; };
    var p = P(0, 0); K.box("walnut", w, 0.12, 0.9, p[0], F + 0.08, p[1], ry); var cw = (w - 0.3) / Math.max(1, seats || 3); for (var i = 0; i < (seats || 3); i++) { var q = P(-w / 2 + 0.15 + cw * (i + 0.5), 0.08); K.box(fab, cw - 0.03, 0.2, 0.62, q[0], F + 0.3, q[1], ry); L.seat(q[0], q[1], cw, 0.6, F + 0.44, ry); }
    var b = P(0, -0.34); K.box(fab, w - 0.2, 0.52, 0.2, b[0], F + 0.55, b[1], ry); L.solid(b[0], b[1], w, 0.24, F, F + 0.82, ry); [-1, 1].forEach(function (sd) { var a = P(sd * (w / 2 - 0.08), 0); K.box(fab, 0.16, 0.42, 0.88, a[0], F + 0.35, a[1], ry); L.solid(a[0], a[1], 0.18, 0.9, F, F + 0.62, ry); }); }
  function shelfBottles(L, x0, x1, z, F, y0, y1, face, tex) { var K = L.K, w = x1 - x0, cx = (x0 + x1) / 2; K.box("walnut", w + 0.1, y1 - y0 + 0.2, 0.35, cx, F + (y0 + y1) / 2, z - face * 0.12, 0); K.quad(tex || "bottles", w - 0.1, y1 - y0 - 0.1, cx, F + (y0 + y1) / 2, z + face * 0.06, face > 0 ? 0 : PI);
    for (var i = 0; i < 3; i++) K.box("glassB", w - 0.1, 0.02, 0.3, cx, F + y0 + (i + 0.95) * (y1 - y0) / 3.2, z + face * 0.14, 0); K.box("strip", w - 0.1, 0.03, 0.03, cx, F + y1 - 0.05, z + face * 0.25, 0); }

  // ═════════════════════════ THE CLUBHOUSE ═════════════════════════
  // lobby (centre front, concierge desk, stair to the roof lounge, heritage photos, trophy case), lounge (left front: stone
  // fireplace, leather seating, the bar), the Grill Room (the whole back, glazed to the course), pro shop (right front), and the
  // glazed roof lounge (floor 6.36) over the lobby.
  var CB = { F: 0.83, C: 5.95, X0: -12.72, X1: 12.72, Z0: -12.15, Z1: 8.84, PZ: -3.8, PL: -4.5, PR: 3.4, RF: 6.36, RC: 9.35, rx0: -4.35, rx1: 4.5, rz0: -3.65, rz1: 3.55,
    st: { x0: -4.3, x1: -2.8, zb: 4.9, n: 30, run: 0.28 } };
  function* buildClub(h, L, K, M) { var B = CB; clubShell(L, B); yield; clubStair(L, B); clubLobby(L, B, h); yield; clubLounge(L, B); yield; clubDining(L, B); clubShop(L, B); yield; clubRoof(L, B); yield; clubPeople(L, B, h);
    L.tip = "look around · the stair to the roof lounge is on the left of the lobby"; }
  function clubShell(L, B) { var K = L.K, F = B.F, C = B.C, X0 = B.X0, X1 = B.X1, Z0 = B.Z0, Z1 = B.Z1, S = B.st, zt = S.zb - (S.n - 1) * S.run;
    // floors: travertine lobby and pro shop, herringbone oak in the lounge and the Grill Room
    floorRect(L, "trav", B.PL, B.PZ, X1, Z1, F); floorRect(L, "oak", X0, Z0, X1, B.PZ, F, PI / 4); floorRect(L, "oak", X0, B.PZ, B.PL, Z1, F, PI / 4);
    K.bb("brass", -2.6, F, 7.9, 1.2, F + 0.009, 7.94);
    // outer walls: the course glass across the back, windows either side at the Grill Room ends, the front windows and the entrance
    wall(L, "sand", "x", Z0 - 0.1, X0 - 0.2, X1 + 0.2, F - 0.1, C + 0.05, 0.2, [[X0 + 0.5, X1 - 0.5, F + 0.45, F + 4.6, "glass", 2.44]]);
    wall(L, "sand", "z", X0 - 0.1, Z0, Z1, F - 0.1, C + 0.05, 0.2, [[-11.2, -8.4, F + 0.45, F + 4.2, "glass", 1.4], [-7.4, -4.6, F + 0.45, F + 4.2, "glass", 1.4]]);
    wall(L, "sand", "z", X1 + 0.1, Z0, Z1, F - 0.1, C + 0.05, 0.2, [[-11.2, -8.4, F + 0.45, F + 4.2, "glass", 1.4], [-7.4, -4.6, F + 0.45, F + 4.2, "glass", 1.4]]);
    wall(L, "sand", "x", Z1 + 0.1, X0, X1, F - 0.1, C + 0.05, 0.2, [[-10.8, -5.4, F + 0.5, F + 3.6, "glass", 1.35], [-2.7, -1.64, F + 0.05, F + 2.9, "glass", 2], [-1.64, 0.24, F, F + 2.95, "open"], [0.24, 0.95, F + 0.05, F + 2.9, "glass", 2], [4.0, 10.6, F + 0.5, F + 3.6, "glass", 1.32]]);
    glazing(L, "x", Z1 + 0.1, -2.7, 0.95, F + 3.05, F + 3.7, 1.2, "bronze"); doorFrame(L, "bronze");
    // partitions: the Grill Room line (openings from the lounge and the lobby), lobby | lounge (the stair against it), lobby | pro shop
    wall(L, "sand", "x", B.PZ, X0, X1, F - 0.1, C, 0.2, [[-6.4, -4.7, F, F + 3.0, "open"], [-2.5, 0.5, F, F + 3.4, "open"]], "walnut");
    wall(L, "sand", "z", B.PL, B.PZ, Z1, F - 0.1, C, 0.2, [[5.4, 8.3, F, F + 3.2, "open"]], "walnut");
    wall(L, "sand", "z", B.PR, B.PZ, Z1, F - 0.1, C, 0.2, [[5.4, 8.3, F, F + 3.2, "open"]], "walnut");
    // walnut wainscot in the lounge and the Grill Room
    K.bb("walnut", X0, F, Z0, X0 + 0.03, F + 1.1, B.PZ - 0.1); K.bb("walnut", X1 - 0.03, F, Z0, X1, F + 1.1, B.PZ - 0.1); K.bb("walnut", X0, F, B.PZ - 0.13, -6.45, F + 1.1, B.PZ - 0.1); K.bb("walnut", -4.65, F, B.PZ - 0.13, -2.55, F + 1.1, B.PZ - 0.1); K.bb("walnut", 0.55, F, B.PZ - 0.13, X1, F + 1.1, B.PZ - 0.1);
    K.bb("walnut", X0, F, B.PZ + 0.1, -6.45, F + 1.1, B.PZ + 0.13); K.bb("walnut", X0, F, B.PZ + 0.1, X0 + 0.03, F + 1.1, Z1); K.bb("walnut", B.PL - 0.13, F, B.PZ + 0.1, B.PL - 0.1, F + 1.1, 5.35);
    // ceilings (the stairwell stays open) and walnut beams
    ceilRect(L, "plaster", X0, Z0, S.x0, Z1, C); ceilRect(L, "plaster", S.x1, Z0, X1, Z1, C); ceilRect(L, "plaster", S.x0, Z0, S.x1, zt - 0.02, C); ceilRect(L, "plaster", S.x0, 0.45, S.x1, Z1, C);
    for (var bx = -10.6; bx <= 10.7; bx += 2.12) K.bb("walnut", bx - 0.11, C - 0.34, Z0, bx + 0.11, C, B.PZ - 0.1); for (var bz = -2.4; bz <= 8.2; bz += 2.1) { K.bb("walnut", X0, C - 0.3, bz - 0.1, B.PL - 0.1, C, bz + 0.1); K.bb("walnut", B.PR + 0.1, C - 0.3, bz - 0.1, X1, C, bz + 0.1); }
    K.bb("bronze", B.PR + 0.1, F, B.PZ + 0.1, X1, F + 0.1, B.PZ + 0.12); K.bb("bronze", X1 - 0.02, F, B.PZ + 0.1, X1, F + 0.1, Z1); }
  // the stair to the roof lounge: walnut treads on a closed walnut-clad block, a glass balustrade with a brass rail; every tread is a
  // full-height solid (steps of 0.18 m), so nothing walks under it
  function clubStair(L, B) { var K = L.K, F = B.F, S = B.st, rise = (B.RF - F) / S.n, w = S.x1 - S.x0, cx = (S.x0 + S.x1) / 2;
    for (var i = 1; i < S.n; i++) { var y = F + i * rise, z1 = S.zb - (i - 1) * S.run, z0 = z1 - S.run; K.bb("walnut", S.x0, y - 0.05, z0, S.x1 + 0.03, y, z1 + 0.03); K.bb("walnut", S.x0, y - rise, z1 - 0.01, S.x1, y - 0.05, z1 + 0.01); K.bb("walnut", S.x1, F, z0, S.x1 + 0.03, y - 0.05, z1); L.solid(cx, (z0 + z1) / 2, w, S.run + 0.01, F - 0.1, y); }
    var zt = S.zb - (S.n - 1) * S.run; var len = S.zb - zt, ang = Math.atan2(B.RF - F, len), hyp = Math.hypot(B.RF - F, len);
    var g1 = new THREE.PlaneGeometry(hyp, 0.95); g1.rotateZ(ang); g1.rotateY(PI / 2); K.geo("glassB", g1, S.x1 + 0.06, F + (B.RF - F) / 2 + 0.55, (S.zb + zt) / 2, 0);
    var r1 = new THREE.BoxGeometry(hyp, 0.05, 0.06); r1.rotateZ(ang); r1.rotateY(PI / 2); K.geo("brass", r1, S.x1 + 0.06, F + (B.RF - F) / 2 + 1.03, (S.zb + zt) / 2, 0);
    L.solid(S.x1 + 0.1, (S.zb + zt) / 2 - 0.3, 0.1, len - 0.6, F + 0.6, B.RF + 1.1);
    // heritage photographs rising with the stair on the partition (lobby face)
    for (var p = 0; p < 6; p++) { var zp = S.zb - 0.6 - p * 1.25, yp = F + (S.zb - zp) / len * (B.RF - F) + 1.6; if (yp > B.C - 0.45) break; var u = (p % 3) / 3, v = p < 3 ? 0.5 : 0; picture(L, "photos", B.PL + 0.14, yp, zp, 0.84, 0.56, PI / 2, [u, v, u + 1 / 3, v + 0.5]); }
    L.hot(-2.2, F, 3.6, 2.4, "info", { t: "Heritage wall", k: "The field and the club", p: "Photographs from the field's early days: the 1928 airfield, the first hangars and the founders of The Landing. The stair beside them climbs to the glazed roof lounge.", prompt: "about the heritage wall" }); }
  function cup(L, x, y, z, s, key) { var pts = [[0, 0], [0.07, 0], [0.07, 0.02], [0.025, 0.05], [0.02, 0.14], [0.05, 0.16], [0.1, 0.22], [0.12, 0.33], [0.115, 0.34], [0.0, 0.2]].map(function (p) { return new THREE.Vector2(p[0] * s, p[1] * s); }); var g = new THREE.LatheGeometry(pts, 18); L.K.geo(key || "brass", g, x, y, z, 0); }
  function namePlate(L, id, t1, t2, x, y, z, w, ry, dark) { var M = mats(), key = "plate_" + id; if (!M[key]) M[key] = new THREE.MeshStandardMaterial({ map: plateTex(t1, t2, dark), transparent: true, roughness: 0.3, metalness: dark ? 0 : 0.6, emissive: dark ? 0x000000 : 0x5a4012, emissiveMap: plateTex(t1, t2, dark), emissiveIntensity: dark ? 0 : 0.35, depthWrite: false }); var hgt = w * 384 / 2048, fx = Math.sin(ry), fz = Math.cos(ry); if (!dark) L.K.box("ebony", w + 0.3, hgt + 0.2, 0.04, x - fx * 0.02, y, z - fz * 0.02, ry, 0); L.K.quad(key, w, hgt, x + fx * 0.005, y, z + fz * 0.005, ry); }
  function clubLobby(L, B, h) { var K = L.K, F = B.F, C = B.C;
    // concierge desk on the right, facing the lobby: fluted walnut, a marble top, a brass kick line, a lamp and flowers
    K.bb("walnut", 1.5, F, 1.6, 2.3, F + 1.0, 4.6); K.bb("marble", 1.44, F + 1.0, 1.54, 2.36, F + 1.06, 4.66); K.bb("brass", 1.46, F + 0.08, 1.6, 1.5, F + 0.12, 4.6); for (var fz = 1.66; fz < 4.56; fz += 0.12) K.bb("walnut", 1.46, F + 0.14, fz, 1.5, F + 0.96, fz + 0.07);
    K.bb("walnut", 2.3, F + 0.72, 1.7, 2.62, F + 0.76, 4.5); K.cyl("brass", 0.07, 0.09, 0.03, 1.95, F + 1.075, 4.2, 14); K.cyl("brass", 0.012, 0.012, 0.42, 1.95, F + 1.29, 4.2, 6); K.cyl("shade", 0.08, 0.16, 0.18, 1.95, F + 1.55, 4.2, 16);
    K.cyl("glassB", 0.07, 0.06, 0.26, 1.9, F + 1.19, 2.0, 12); for (var fl = 0; fl < 6; fl++) K.sph(fl % 2 ? "cream" : "rust", 0.07, 1.9 + Math.cos(fl) * 0.08, F + 1.38 + (fl % 3) * 0.04, 2.0 + Math.sin(fl * 2) * 0.08, 1, 8);
    L.solid(1.95, 3.1, 0.95, 3.15, F, F + 1.06); namePlate(L, h.id, (h.name || "The Clubhouse").toUpperCase(), "MEMBERS · GUESTS · THE COURSE", B.PR - 0.12, F + 3.35, 3.1, 3.2, -PI / 2);
    L.hot(1.1, F, 3.1, 1.7, "info", { t: h.name || "The clubhouse", k: "Concierge", p: "Tee times, a table in the Grill Room, a cart for the course: the concierge desk arranges it. The lounge and the bar are to the left, the pro shop to the right, the roof lounge up the stair.", prompt: "ask at the concierge desk" });
    // trophy case on the back wall: walnut, glass front, lit glass shelves, cups and plaques
    var tx0 = 0.85, tx1 = 3.2, tz = B.PZ + 0.1; K.bb("walnut", tx0, F, tz, tx1, F + 0.9, tz + 0.5); K.bb("walnut", tx0, F + 0.9, tz, tx0 + 0.06, F + 2.7, tz + 0.5); K.bb("walnut", tx1 - 0.06, F + 0.9, tz, tx1, F + 2.7, tz + 0.5); K.bb("walnut", tx0, F + 2.7, tz, tx1, F + 2.82, tz + 0.5); K.bb("green", tx0 + 0.06, F + 0.9, tz, tx1 - 0.06, F + 2.7, tz + 0.02);
    K.quad("glass", tx1 - tx0 - 0.12, 1.8, (tx0 + tx1) / 2, F + 1.8, tz + 0.49, 0); for (var sh = 0; sh < 3; sh++) K.bb("glassB", tx0 + 0.06, F + 0.9 + sh * 0.6, tz + 0.02, tx1 - 0.06, F + 0.92 + sh * 0.6, tz + 0.46); K.bb("strip", tx0 + 0.1, F + 2.66, tz + 0.3, tx1 - 0.1, F + 2.69, tz + 0.33);
    for (var c = 0; c < 9; c++) { var cx = tx0 + 0.35 + (c % 3) * 0.8, cy = F + 0.92 + Math.floor(c / 3) * 0.6; cup(L, cx, cy, tz + 0.24, c % 4 === 0 ? 1.3 : 0.9, c % 3 === 1 ? "brushed" : "brass"); K.bb("walnut", cx - 0.12, cy, tz + 0.36, cx + 0.12, cy + 0.07, tz + 0.42); }
    L.solid((tx0 + tx1) / 2, tz + 0.25, tx1 - tx0, 0.5, F, F + 2.82);
    L.hot(2.0, F, tz + 1.2, 1.8, "info", { t: "Trophy case", k: "Club competitions", p: "The club's cups: the Founders' Cup, the monthly medals and the mixed foursomes, with the winners on the plaques. There is room on the shelves for this season.", prompt: "about the trophy case" });
    // the round table under the chandelier, with an arrangement of desert flowers
    var tx = -0.55, tzc = 4.3; K.cyl("walnut", 0.72, 0.72, 0.05, tx, F + 0.76, tzc, 32); K.cyl("marble", 0.5, 0.5, 0.012, tx, F + 0.79, tzc, 32); K.cyl("walnut", 0.18, 0.3, 0.72, tx, F + 0.37, tzc, 16); L.solid(tx, tzc, 1.2, 1.2, F, F + 0.8);
    K.cyl("ceramic", 0.13, 0.1, 0.46, tx, F + 1.02, tzc, 18); var R = rng(8); for (var b = 0; b < 9; b++) { var a = b / 9 * TAU + R() * 0.4, tilt = 0.18 + R() * 0.2, hh = 0.9 + R() * 0.5; var bg = new THREE.CylinderGeometry(0.008, 0.012, hh, 5); bg.translate(0, hh / 2, 0); bg.rotateZ(tilt); bg.rotateY(a); K.geo("ebony", bg, tx, F + 1.2, tzc, 0); for (var lf = 0; lf < 5; lf++) { var t = 0.35 + lf * 0.14; K.sph(lf % 2 ? "sage" : "leaf", 0.035, tx + Math.cos(a) * Math.sin(tilt) * hh * t * -1 + (R() - 0.5) * 0.05, F + 1.2 + Math.cos(tilt) * hh * t, tzc + Math.sin(a) * Math.sin(tilt) * hh * t + (R() - 0.5) * 0.05, 1.8, 6); } }
    K.bb("navy", tx + 0.25, F + 0.785, tzc - 0.25, tx + 0.55, F + 0.82, tzc + 0.05); K.bb("cream", tx + 0.27, F + 0.82, tzc - 0.22, tx + 0.53, F + 0.845, tzc + 0.02); K.cyl("bronze", 0.16, 0.08, 0.07, tx - 0.35, F + 0.82, tzc + 0.25, 18);
    var ring = new THREE.TorusGeometry(0.95, 0.03, 8, 48); ring.rotateX(PI / 2); K.geo("brass", ring, tx, C - 1.45, tzc, 0); for (var q = 0; q < 12; q++) { var aa = q / 12 * TAU; K.sph("lamp", 0.05, tx + Math.cos(aa) * 0.95, C - 1.38, tzc + Math.sin(aa) * 0.95, 1.4, 8); } for (var q2 = 0; q2 < 4; q2++) { var a2 = q2 / 4 * TAU + 0.4; K.cyl("brass", 0.005, 0.005, 1.45, tx + Math.cos(a2) * 0.95, C - 0.72, tzc + Math.sin(a2) * 0.95, 4); }
    [[-2.5, 8.72, PI], [1.6, 8.72, PI]].forEach(function (c) { K.bb("brass", c[0] - 0.06, F + 2.2, c[1] - 0.02, c[0] + 0.06, F + 2.5, c[1]); K.cyl("shade", 0.07, 0.11, 0.2, c[0], F + 2.45, c[1] - 0.14, 14); K.quad("glow", 0.9, 0.9, c[0], F + 2.5, c[1] - 0.04, PI); });
    rug(L, "rug1", -0.7, 6.4, 2.6, 3.6, F);
    L.model("term_planter", -3.1, F, 8.1, 0.4, 0.62); L.solid(-3.1, 8.1, 1.3, 1.2, F, F + 1.0); L.model("term_planter", 1.95, F, 8.1, 2.1, 0.62); L.solid(1.95, 8.1, 1.3, 1.2, F, F + 1.0);
    L.light(0xffe2bd, 1.5, 13, tx, C - 1.7, tzc); L.light(0xffe6c8, 1.0, 10, 0.6, C - 1.2, -1.6); }
  function clubLounge(L, B) { var K = L.K, F = B.F, C = B.C, X0 = B.X0, fz = 3.4, M = mats();
    // the fireplace on the left wall: a ledgestone chimney breast to the ceiling, the firebox, a raised slate hearth, a walnut mantel
    var d = 0.75; K.bb("stone", X0, F, fz - 1.6, X0 + d, C, fz - 0.8); K.bb("stone", X0, F, fz + 0.8, X0 + d, C, fz + 1.6); K.bb("stone", X0, F + 1.4, fz - 0.8, X0 + d, C, fz + 0.8); K.bb("stone", X0, F, fz - 0.8, X0 + d, F + 0.42, fz + 0.8);
    K.bb("black", X0, F + 0.42, fz - 0.8, X0 + 0.3, F + 1.4, fz + 0.8); K.bb("black", X0, F + 0.42, fz - 0.8, X0 + d, F + 0.45, fz + 0.8); K.bb("black", X0, F + 0.42, fz - 0.82, X0 + d, F + 1.4, fz - 0.78); K.bb("black", X0, F + 0.42, fz + 0.78, X0 + d, F + 1.4, fz + 0.82); K.bb("black", X0, F + 1.36, fz - 0.8, X0 + d, F + 1.4, fz + 0.8);
    K.cyl("ebony", 0.08, 0.08, 1.1, X0 + 0.48, F + 0.53, fz - 0.05, 10, PI / 2, 0, 0.1); K.cyl("ebony", 0.07, 0.07, 1.0, X0 + 0.42, F + 0.62, fz + 0.1, 10, PI / 2, 0, -0.25); K.bb("ember", X0 + 0.34, F + 0.45, fz - 0.55, X0 + 0.64, F + 0.5, fz + 0.55);
    K.quad("fire", 1.2, 0.8, X0 + 0.45, F + 0.86, fz, PI / 2); K.quad("fire", 0.9, 0.7, X0 + 0.5, F + 0.81, fz - 0.05, PI / 2 + 0.5); K.quad("fire", 0.9, 0.7, X0 + 0.5, F + 0.81, fz + 0.05, PI / 2 - 0.5);
    K.bb("hearth", X0 + d, F, fz - 1.9, X0 + d + 0.7, F + 0.38, fz + 1.9); K.bb("walnut", X0 + d, F + 1.62, fz - 1.55, X0 + d + 0.2, F + 1.78, fz + 1.55); picture(L, "art0", X0 + d + 0.04, F + 2.95, fz, 1.5, 2.0, PI / 2, null, "brass");
    L.solid(X0 + d / 2, fz, d, 3.2, F, C); L.solid(X0 + d + 0.35, fz, 0.7, 3.8, F - 0.1, F + 0.38);
    var fl = L.light(0xff9a4a, 1.7, 9, X0 + d + 0.6, F + 0.9, fz); L.anim.push(function (dt, t) { var k = 0.82 + 0.1 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 13.1 + 1.7); if (L.g.visible) fl.intensity = fl.userData.k0 * k; M.fire.opacity = 0.8 + 0.2 * Math.sin(t * 9.1); M.ember.emissiveIntensity = 1.0 + 0.4 * k; });
    // leather seating round the fire: two tan leather sofas face each other, two leather lounge chairs face the fire, a walnut table, a rug
    sofa(L, -9.6, fz - 2.15, F, 2.5, 0, "tan", 3); sofa(L, -9.6, fz + 2.15, F, 2.5, PI, "tan", 3); rug(L, "rug0", -9.5, fz, 5.0, 6.2, F);
    if (L.model("jettable", -9.6, F, fz, 0, 0.85)) L.solid(-9.6, fz, 1.45, 0.8, F, F + 0.55);
    [fz - 0.8, fz + 0.8].forEach(function (z) { if (L.model("lounge_chair", -7.5, F, z, -PI / 2)) L.seat(-7.5, z, 0.62, 0.62, F + 0.46, -PI / 2); });
    // the bar across the back of the lounge: back bar of lit bottles, a walnut counter quilted in cream leather, a marble top, a brass foot rail, stools
    shelfBottles(L, -12.3, -7.0, B.PZ + 0.35, F, 1.15, 3.2, 1); K.bb("walnut", -12.3, F, B.PZ + 0.1, -7.0, F + 0.95, B.PZ + 0.62); K.bb("marble", -12.34, F + 0.95, B.PZ + 0.1, -6.96, F + 1.0, B.PZ + 0.66); K.bb("walnut", -12.35, F + 3.2, B.PZ + 0.1, -6.95, F + 4.1, B.PZ + 0.3); K.bb("brass", -12.35, F + 4.1, B.PZ + 0.1, -6.95, F + 4.14, B.PZ + 0.34); K.bb("strip", -12.2, F + 4.06, B.PZ + 0.3, -7.1, F + 4.09, B.PZ + 0.33);
    K.bb("walnut", -11.9, F, -2.45, -7.3, F + 1.02, -1.8); K.quad("quilt", 4.5, 0.82, -9.6, F + 0.55, -1.79, 0, 0, [0.6, 0.6]); K.bb("marble", -12.0, F + 1.02, -2.55, -7.2, F + 1.08, -1.7); K.cyl("brass", 0.025, 0.025, 4.6, -9.6, F + 0.22, -1.62, 10, 0, PI / 2);
    L.solid(-9.6, -2.12, 4.8, 0.85, F, F + 1.08); L.solid(-9.65, B.PZ + 0.38, 5.3, 0.6, F, F + 3.3);
    [-11.3, -10.35, -9.4, -8.45, -7.5].forEach(function (x) { stool(L, x, -1.25, F, PI); }); [-11.0, -9.6, -8.2].forEach(function (x) { pendant(L, x, C, -2.12, 2.55); });
    L.light(0xffc98a, 1.25, 9, -9.6, F + 2.5, -2.3);
    // the window nook: two lounge chairs to the front glass; bookcases on the lobby wall; a potted olive
    [-11.0, -9.2].forEach(function (x) { if (L.model("lounge_chair", x, F, 7.6, 0)) L.seat(x, 7.6, 0.62, 0.62, F + 0.46, 0); }); K.cyl("walnut", 0.3, 0.3, 0.03, -10.1, F + 0.55, 7.8, 20); K.cyl("bronze", 0.03, 0.03, 0.55, -10.1, F + 0.27, 7.8, 8); L.solid(-10.1, 7.8, 0.5, 0.5, F, F + 0.56);
    [0.5, 1.75, 3.0].forEach(function (z) { if (L.model("bookcase", B.PL - 0.32, F, z, -PI / 2)) L.solid(B.PL - 0.32, z, 0.42, 1.2, F, F + 2.3); });
    L.model("term_planter", -12.0, F, 8.1, 0.2, 0.62); L.solid(-12.0, 8.1, 1.2, 1.2, F, F + 1.0);
    L.light(0xffe0b8, 1.1, 11, -9.0, C - 1.3, 5.4);
    L.hot(-9.6, F, fz, 3.2, "info", { t: "The Lounge", k: "Fireside · the bar", p: "Leather chairs round a ledgestone fireplace, and the bar along the back. Take a seat by the fire, or pull up a stool.", prompt: "about the lounge" }); }
  function clubDining(L, B) { var K = L.K, F = B.F, C = B.C; L.chairs = [];
    // two rows of five round tables laid for four, linen, place settings, a candle and a bud vase each; a pendant over every table
    [-9.9, -6.5].forEach(function (z, row) { [-10.2, -5.1, 0, 5.1, 10.2].forEach(function (x, col) { roundTable(L, x, z, F, 0.62, true); K.cyl("lamp", 0.025, 0.025, 0.08, x + 0.12, F + 0.81, z, 8); K.cyl("glassB", 0.03, 0.025, 0.14, x - 0.1, F + 0.84, z + 0.05, 8); K.sph(col % 2 ? "rust" : "cream", 0.04, x - 0.1, F + 0.95, z + 0.05, 1, 8);
      for (var k = 0; k < 4; k++) { var a = PI / 4 + k * PI / 2, cx = x + Math.sin(a) * 0.98, cz = z + Math.cos(a) * 0.98, ry = a + PI; chair(L, cx, cz, F, ry, row ? "green" : "navy"); L.chairs.push([cx, cz, ry]); setting(L, x + Math.sin(a) * 0.42, z + Math.cos(a) * 0.42, F, ry); }
      pendant(L, x, C, z, 2.2); }); });
    // art on the partition between the openings, a sideboard, plants in the corners
    picture(L, "art1", -9.6, F + 2.6, B.PZ - 0.14, 1.9, 1.4, PI, null, "walnut"); picture(L, "art2", 3.6, F + 2.6, B.PZ - 0.14, 1.9, 1.4, PI, null, "walnut"); picture(L, R14I ? "art3" : "art0", 8.6, F + 2.6, B.PZ - 0.14, 1.9, 1.4, PI, null, "walnut");
    if (L.model("jetbar", 6.4, F, B.PZ - 0.5, PI)) L.solid(6.4, B.PZ - 0.5, 1.6, 0.66, F, F + 1.3);
    plant(L, -12.1, -11.6, F, 1.8, 1.1); plant(L, 12.1, -11.6, F, 1.8, 1.1); plant(L, 12.1, -4.4, F, 1.5, 1.0);
    L.light(0xffdcb0, 1.3, 12, -7.2, C - 1.6, -8.2); L.light(0xffdcb0, 1.3, 12, 0, C - 1.6, -8.2); L.light(0xffdcb0, 1.3, 12, 7.2, C - 1.6, -8.2);
    L.hot(-1.0, F, -5.0, 2.2, "info", { t: "The Grill Room", k: "Dining · the course view", p: "The club's dining room runs the full width of the house, glazed floor to ceiling onto the course. Lunch after a round, dinner as the light goes off the mountains.", prompt: "about the Grill Room" }); }
  function clubShop(L, B) { var K = L.K, F = B.F, C = B.C, X1 = B.X1, M = mats();
    // display tables with folded polos, an oak slat wall of shoes and caps, golf bags, the counter, a putting mat with a flag
    [[6.3, 2.4], [9.5, 2.4], [7.9, 5.6]].forEach(function (p, i) { K.bb("walnut", p[0] - 0.95, F + 0.76, p[1] - 0.5, p[0] + 0.95, F + 0.82, p[1] + 0.5); K.bb("bronze", p[0] - 0.85, F, p[1] - 0.4, p[0] - 0.8, F + 0.76, p[1] + 0.4); K.bb("bronze", p[0] + 0.8, F, p[1] - 0.4, p[0] + 0.85, F + 0.76, p[1] + 0.4); var cols = ["navy", "white", "green", "cream", "rust", "char", "sage", "tan"]; for (var fx = 0; fx < 4; fx++) for (var fz2 = 0; fz2 < 2; fz2++) { var nstack = 2 + ((fx + fz2 + i) % 3); for (var st = 0; st < nstack; st++) K.box(cols[(fx * 2 + fz2 + i * 3) % cols.length], 0.34, 0.045, 0.28, p[0] - 0.63 + fx * 0.42, F + 0.845 + st * 0.047, p[1] - 0.2 + fz2 * 0.4, (st % 2) * 0.04, 0); } L.solid(p[0], p[1], 1.9, 1.0, F, F + 0.82); });
    K.bb("oakP", X1 - 0.12, F, -2.6, X1, F + 3.4, 5.2); for (var s = 0; s < 5; s++) { var y = F + 0.45 + s * 0.6; K.bb("walnut", X1 - 0.45, y, -2.5, X1 - 0.12, y + 0.03, 5.1); for (var b = 0; b < 12; b++) { var bz = -2.3 + b * 0.62; K.bb(["white", "black", "navy", "tan", "cream"][(b + s) % 5], X1 - 0.42, y + 0.03, bz, X1 - 0.16, y + 0.15, bz + 0.3); } } L.solid(X1 - 0.3, 1.3, 0.5, 7.8, F, F + 3.4);
    for (var g = 0; g < 4; g++) { var gx = 11.4 - g * 0.55, gz = 7.9; K.cyl(g % 2 ? "navy" : "tan", 0.14, 0.13, 0.9, gx, F + 0.45, gz, 14); K.cyl("black", 0.145, 0.145, 0.06, gx, F + 0.9, gz, 14); for (var c = 0; c < 4; c++) { K.cyl("brushed", 0.008, 0.008, 0.35, gx - 0.05 + (c % 2) * 0.1, F + 1.08, gz - 0.04 + (c > 1 ? 0.08 : 0), 4); K.bb("chrome", gx - 0.08 + (c % 2) * 0.1, F + 1.24, gz - 0.06 + (c > 1 ? 0.08 : 0), gx - 0.0 + (c % 2) * 0.1, F + 1.29, gz - 0.02 + (c > 1 ? 0.08 : 0)); } } L.solid(10.6, 7.9, 2.3, 0.4, F, F + 1.3);
    K.bb("walnut", 4.6, F, B.PZ + 0.5, 8.4, F + 1.0, B.PZ + 1.2); K.bb("marble", 4.56, F + 1.0, B.PZ + 0.46, 8.44, F + 1.05, B.PZ + 1.24); L.solid(6.5, B.PZ + 0.85, 3.9, 0.8, F, F + 1.05); namePlate(L, "proshop", "PRO SHOP", "APPAREL · CLUB FITTING · THE ESSENTIALS", 6.5, F + 3.1, B.PZ + 0.12, 3.4, 0);
    K.flat("turf", 8.6, 6.0, 11.4, 7.3, F + 0.012, true); K.bb("walnut", 8.55, F, 5.95, 11.45, F + 0.03, 6.0); K.bb("walnut", 8.55, F, 7.3, 11.45, F + 0.03, 7.35); K.cyl("black", 0.055, 0.055, 0.004, 11.0, F + 0.016, 6.6, 16); K.cyl("white", 0.006, 0.006, 1.2, 11.0, F + 0.6, 6.6, 4); K.bb("rust", 11.0, F + 1.02, 6.6, 11.26, F + 1.18, 6.605);
    K.quad("mirror", 0.9, 2.0, B.PR + 0.12, F + 1.25, 0.2, PI / 2); plant(L, 4.2, -3.1, F, 1.4, 0.9);
    L.light(0xfff0dc, 1.2, 12, 8.0, C - 1.3, 2.4);
    L.hot(7.9, F, 3.9, 3.0, "info", { t: "Pro shop", k: "Apparel · club fitting", p: "Polos, caps and shoes in the club's colours, a fitting bay for irons and wedges, and a putting mat by the window to try a new putter. Ask at the counter about a lesson.", prompt: "about the pro shop" }); }
  function clubRoof(L, B) { var K = L.K, S = B.st, RF = B.RF, RC = B.RC, x0 = B.rx0, x1 = B.rx1, z0 = B.rz0, z1 = B.rz1, zt = S.zb - (S.n - 1) * S.run, C = B.C;
    // the floor over the lobby ceiling (the stairwell open), its edges in walnut, the solids that make it a floor
    [[S.x1, z0, x1, z1], [x0, 0.45, S.x1, z1], [x0, z0, S.x1, zt]].forEach(function (r) { K.flat("trav", r[0], r[1], r[2], r[3], RF + 0.003, true); L.solid((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, r[2] - r[0], r[3] - r[1], RF - 0.4, RF); });
    K.bb("walnut", S.x0, C, 0.45, S.x1, RF, 0.5); K.bb("walnut", S.x1, C, zt, S.x1 + 0.04, RF, 0.5);
    // glass all round (the shell's glazed pavilion), mullions in bronze; a walnut ceiling with a warm cove
    glazing(L, "x", z0 - 0.05, x0, x1, RF, RC, 1.5, "bronze"); glazing(L, "x", z1 + 0.05, x0, x1, RF, RC, 1.5, "bronze"); glazing(L, "z", x0 - 0.05, z0, z1, RF, RC, 1.5, "bronze"); glazing(L, "z", x1 + 0.05, z0, z1, RF, RC, 1.5, "bronze");
    L.solid((x0 + x1) / 2, z0 - 0.1, x1 - x0 + 0.3, 0.12, RF - 0.2, RC); L.solid((x0 + x1) / 2, z1 + 0.1, x1 - x0 + 0.3, 0.12, RF - 0.2, RC); L.solid(x0 - 0.1, (z0 + z1) / 2, 0.12, z1 - z0 + 0.3, RF - 0.2, RC); L.solid(x1 + 0.1, (z0 + z1) / 2, 0.12, z1 - z0 + 0.3, RF - 0.2, RC);
    K.flat("walnut", x0 - 0.1, z0 - 0.1, x1 + 0.1, z1 + 0.1, RC, false); K.bb("strip", x0, RC - 0.12, z0, x1, RC - 0.08, z0 + 0.04); K.bb("strip", x0, RC - 0.12, z1 - 0.04, x1, RC - 0.08, z1);
    // a glass balustrade round the stairwell (the stair arrives at the far end, then you turn into the lounge)
    K.quad("glassB", 0.45 - (zt + 0.9), 1.0, S.x1 + 0.05, RF + 0.5, (zt + 0.9 + 0.45) / 2, PI / 2); K.quad("glassB", S.x1 - S.x0, 1.0, (S.x0 + S.x1) / 2, RF + 0.5, 0.5, 0); K.bb("brass", S.x1 + 0.02, RF + 1.0, zt + 0.9, S.x1 + 0.08, RF + 1.05, 0.5); K.bb("brass", S.x0, RF + 1.0, 0.47, S.x1 + 0.08, RF + 1.05, 0.53);
    L.solid(S.x1 + 0.05, (zt + 0.9 + 0.5) / 2, 0.12, 0.5 - (zt + 0.9), RF, RF + 1.05); L.solid((S.x0 + S.x1) / 2, 0.5, S.x1 - S.x0, 0.12, RF, RF + 1.05);
    // a conversation group toward the course, two chairs to the front view, a bar cabinet, olive trees in the corners
    if (L.model("jetsofa", 0.9, RF, 0.8, PI)) { L.solid(0.9, 0.95, 2.3, 0.4, RF, RF + 0.85); L.seat(0.2, 0.7, 0.7, 0.6, RF + 0.45, PI); L.seat(0.9, 0.7, 0.7, 0.6, RF + 0.45, PI); L.seat(1.6, 0.7, 0.7, 0.6, RF + 0.45, PI); }
    if (L.model("jettable", 0.9, RF, -0.75, 0, 0.8)) L.solid(0.9, -0.75, 1.3, 0.7, RF, RF + 0.5);
    [[-0.6, -2.35, 0.25], [2.4, -2.35, -0.25], [2.4, 2.55, PI - 0.3], [3.6, 1.6, -PI / 2 - 0.2]].forEach(function (c) { if (L.model("lounge_chair", c[0], RF, c[1], c[2])) L.seat(c[0], c[1], 0.62, 0.62, RF + 0.46, c[2]); });
    if (L.model("jetbar", -2.0, RF, 3.05, PI)) L.solid(-2.0, 3.05, 1.6, 0.66, RF, RF + 1.3); rug(L, "rug2", 0.9, -0.8, 3.6, 3.0, RF);
    L.model("term_planter", 4.0, RF, -3.1, 0.3, 0.55); L.solid(4.0, -3.1, 1.1, 1.1, RF, RF + 1.0); L.model("term_planter", -3.8, RF, 3.0, 1.2, 0.5); L.solid(-3.8, 3.0, 1.0, 1.0, RF, RF + 1.0);
    L.light(0xffe0b8, 1.1, 11, 0.8, RC - 0.9, 0.2);
    L.hot(1.0, RF, 1.9, 2.4, "info", { t: "The Roof Lounge", k: "Glass on four sides", p: "The glazed pavilion on the roof: a quiet room over the lobby with the whole course, the Flight Line and the Chiricahua skyline around it. Best at the last light of the day.", prompt: "about the roof lounge" }); }
  function clubPeople(L, B, h) { var F = B.F, RF = B.RF;
    var bart = person(L, { rig: "concierge", x: -9.5, z: -2.95, y: F, yaw: 0, id: "bart" }); var tid = "int3_bartender_" + h.id; var T = registerTalk(tid, L, bart, "clubhouse", "bartender", { club: h.name || "the clubhouse" });
    L.hot(-9.5, F, -1.35, 2.4, "talk", { id: tid, name: T.name, who: bart, prompt: "talk to " + T.name + ", the bartender" });
    person(L, { rig: "resident_m", x: -7.2, z: -0.9, y: F, yaw: PI + 0.5, face: false }); person(L, { rig: "resident_f", x: -11.0, z: 6.1, y: F, yaw: PI / 2 + 0.7 });
    person(L, { id: "desk", name: "Concierge", look: { body: "f", skin: "c98f63", shirt: "1d3b2c", pants: "1c1f24", hair: 2, hairc: "1c1512" }, x: 2.8, z: 3.1, y: F, yaw: -PI / 2, label: true });
    var seat = function (i, look, id) { var c = L.chairs && L.chairs[i]; if (!c) return; person(L, { id: id, look: look, x: c[0], z: c[1], y: F, yaw: c[2], sit: true, seatY: 0.5 }); };
    seat(1, { body: "m", skin: "e8c19a", shirt: "e9e2d3", pants: "2b2f36", hair: 1, hairc: "3a2416" }, "d1"); seat(3, { body: "f", skin: "a86f46", shirt: "6e1f24", pants: "1c1f24", hair: 2, hairc: "1c1512" }, "d2");
    person(L, { id: "s1", look: { body: "f", skin: "f3d9c0", shirt: "e9e1d2", pants: "3a3a3c", hair: 1, hairc: "6b4226" }, x: -10.5, z: 1.45, y: F, yaw: 0, sit: true, seatY: 0.42 }); }
  TYPES.clubhouse.build = buildClub;

  // ═════════════════════════ THE RESTAURANTS (one layout, five venues) ═════════════════════════
  // host stand at the door, dining room with booths along the right wall and tables in the middle, the bar with stools along
  // the left wall, the open kitchen behind a pass across the back, pendants, plants, a chalkboard menu; the venue (name, menu,
  // leather, feature wall) comes from plan/interiors.json
  var RB = { F: 0.216, C: 4.72, X0: -7.42, X1: 7.42, Z0: -8.36, Z1: 5.42, PK: -5.3 };
  var VDEF = { b0062: { name: "Market Hall", tagline: "Market kitchen · since the first harvest", accent: "tan", menu: [["Mesquite grilled chicken", "green chile, charred corn"], ["Market salad", "citrus, pepitas, queso fresco"], ["Street tacos", "carne asada, salsa verde"], ["Prickly pear lemonade", "fresh pressed"]] },
    b0069: { name: "Border Books", tagline: "Coffee, books and a good lunch", accent: "green", feature: "books", menu: [["Pour over coffee", "single origin"], ["Green chile quiche", "house greens"], ["Pecan sticky bun", "baked this morning"], ["Horchata latte", "cinnamon, rice milk"]] },
    b0126: { name: "Main Street Grill", tagline: "Steaks and chops on Main Street", accent: "ox", menu: [["Ribeye", "mesquite fire, chimichurri"], ["Frontier burger", "aged cheddar, onion jam"], ["Cast iron cornbread", "honey butter"], ["Sarsaparilla float", "vanilla bean"]] },
    b0181: { name: "Launch Complex Food Hall", tagline: "Fuel for the night field", accent: "navy", menu: [["Countdown bowls", "rice, greens, choice of grill"], ["Wood fired flatbreads", "three toppings"], ["Orbit fries", "chile salt, aioli"], ["Night sky sundae", "dark chocolate, sea salt"]] },
    b0288: { name: "Outpost Mess Hall", tagline: "Hearty plates for the Outpost crews", accent: "rust", feature: "art", menu: [["Crew breakfast", "all day"], ["Red chile stew", "slow braised, tortillas"], ["Rover sandwiches", "smoked brisket, slaw"], ["Mission coffee", "strong and hot"]] } };
  function venueOf(h) { var v = (sect("restaurant").venues || {})[h.id] || VDEF[h.id] || { name: h.name || "Restaurant", tagline: "From the kitchen", accent: "tan", menu: [] }; if (!v.name) v.name = h.name || "Restaurant"; return v; }
  function* buildRest(h, L, K, M) { var B = RB, F = B.F, C = B.C, X0 = B.X0, X1 = B.X1, Z0 = B.Z0, Z1 = B.Z1, PK = B.PK, v = venueOf(h), acc = M[v.accent] ? v.accent : "tan"; L.v = v;
    // floors: terracotta in the room, slate in the kitchen; walls: sand plaster, a clay accent wall behind the bar; a timber ceiling
    floorRect(L, "terra", X0, PK, X1, Z1, F); floorRect(L, "slate", X0, Z0, X1, PK, F);
    wall(L, "sand", "x", Z0 - 0.1, X0 - 0.2, X1 + 0.2, F - 0.1, C + 0.05, 0.2); wall(L, "clay", "z", X0 - 0.1, Z0, Z1, F - 0.1, C + 0.05, 0.2, [[1.6, 4.6, F + 0.9, F + 3.2, "glass", 1.5]]);
    wall(L, "sand", "z", X1 + 0.1, Z0, Z1, F - 0.1, C + 0.05, 0.2, [[3.4, 4.9, F + 0.9, F + 3.2, "glass", 1.5]]);
    wall(L, "sand", "x", Z1 + 0.1, X0, X1, F - 0.1, C + 0.05, 0.2, [[X0 + 0.25, -1.55, F + 0.08, F + 3.4, "glass", 1.4], [-1.55, 0.21, F, F + 2.95, "open"], [0.21, X1 - 0.25, F + 0.08, F + 3.4, "glass", 1.4]], "ebony"); doorFrame(L, "ebony");
    // the pass: a half wall with a stainless shelf, heat lamps and a kitchen door
    wall(L, "sand", "x", PK, X0, X1, F - 0.1, C, 0.2, [[-3.2, 3.4, F + 1.05, F + 2.45, "open"], [4.6, 5.6, F, F + 2.3, "open"]], "walnut");
    K.bb("brushed", -3.2, F + 1.02, PK - 0.35, 3.4, F + 1.07, PK + 0.35); K.bb("brushed", -3.2, F + 2.42, PK - 0.3, 3.4, F + 2.47, PK + 0.3); for (var hl = -2.6; hl <= 2.9; hl += 1.1) { K.bb("black", hl - 0.25, F + 2.3, PK - 0.08, hl + 0.25, F + 2.42, PK + 0.08); K.bb("lampC", hl - 0.22, F + 2.29, PK - 0.06, hl + 0.22, F + 2.3, PK + 0.06); }
    for (var pl = 0; pl < 5; pl++) { K.cyl("ceramic", 0.14, 0.12, 0.02, -2.4 + pl * 1.2, F + 1.08, PK + 0.1, 18); K.sph(pl % 2 ? "rust" : "sage", 0.06, -2.4 + pl * 1.2, F + 1.12, PK + 0.1, 0.6, 10); }
    // ceiling: oak boards between walnut beams, pendants later
    ceilRect(L, "oakP", X0, Z0, X1, Z1, C); for (var bx = -6.2; bx <= 6.3; bx += 2.45) K.bb("walnut", bx - 0.1, C - 0.28, Z0, bx + 0.1, C, Z1);
    yield; restBar(L, B, v); yield; restDining(L, B, v, acc); yield; restKitchen(L, B); yield; restPeople(L, B, h, v);
    L.tip = "look around · the bar is on the left, the booths on the right, the kitchen at the back"; }
  function restBar(L, B, v) { var K = L.K, F = B.F, C = B.C, X0 = B.X0;
    // back bar on the clay wall (lit bottles, a bronze mirror), the counter in walnut with a quilted front and a marble top, five stools
    K.bb("walnut", X0, F, -4.9, X0 + 0.55, F + 0.95, 0.7); K.bb("marble", X0, F + 0.95, -4.95, X0 + 0.6, F + 1.0, 0.75);
    K.quad("bottles", 5.2, 1.9, X0 + 0.07, F + 2.1, -2.1, PI / 2); for (var s2 = 0; s2 < 3; s2++) K.bb("glassB", X0 + 0.05, F + 1.35 + s2 * 0.62, -4.8, X0 + 0.35, F + 1.37 + s2 * 0.62, 0.6); K.bb("walnut", X0 + 0.02, F + 3.1, -4.9, X0 + 0.4, F + 3.2, 0.7); K.bb("strip", X0 + 0.3, F + 3.08, -4.8, X0 + 0.33, F + 3.1, 0.6);
    L.solid(X0 + 0.3, -2.1, 0.6, 5.7, F, F + 3.2);
    K.bb("walnut", -5.9, F, -4.6, -5.25, F + 1.02, 0.4); K.quad("quilt", 5.0, 0.84, -5.24, F + 0.55, -2.1, PI / 2, 0, [0.6, 0.6]); K.bb("marble", -6.0, F + 1.02, -4.7, -5.15, F + 1.08, 0.5); K.cyl("brass", 0.025, 0.025, 5.0, -5.05, F + 0.22, -2.1, 10, PI / 2, 0);
    L.solid(-5.6, -2.1, 0.8, 5.1, F, F + 1.08); [-4.0, -3.0, -2.0, -1.0, 0.0].forEach(function (z) { stool(L, -4.75, z, F, -PI / 2); }); [-3.6, -2.1, -0.6].forEach(function (z) { pendant(L, -5.6, C, z, 2.1, "shade"); });
    L.light(0xffc98a, 1.3, 9, -5.8, F + 2.4, -2.1);
    L.hot(-5.3, F, -2.1, 2.0, "shop", { shop: "restaurant", faced: true, prompt: "order at the bar" }); }
  // a booth against the right wall at z c: two high-backed benches facing across a walnut table
  function booth(L, c, F, acc, X1) { var K = L.K, x0 = X1 - 1.9, xm = (x0 + X1) / 2;
    [-1, 1].forEach(function (sd) { var z = c + sd * 0.95; K.bb("walnut", x0, F, z - 0.3, X1, F + 0.4, z + 0.3); K.bb(acc, x0 + 0.05, F + 0.4, z - 0.28, X1, F + 0.52, z + 0.28); K.bb(acc, x0 + 0.05, F + 0.5, z + sd * 0.22 - 0.07, X1, F + 1.35, z + sd * 0.22 + 0.07); K.bb("walnut", x0, F, z + sd * 0.3 - 0.05, X1, F + 1.42, z + sd * 0.3 + 0.05);
      L.seat(xm + 0.1, z - sd * 0.02, 1.6, 0.5, F + 0.52, sd > 0 ? PI : 0); L.solid(xm, z + sd * 0.3, 1.9, 0.12, F, F + 1.42); });
    K.bb("walnut", x0 + 0.15, F + 0.72, c - 0.4, X1 - 0.05, F + 0.77, c + 0.4); K.bb("bronze", xm - 0.03, F, c - 0.03, xm + 0.03, F + 0.72, c + 0.03); K.bb("bronze", xm - 0.3, F, c - 0.2, xm + 0.3, F + 0.03, c + 0.2); L.solid(xm, c, 1.8, 0.8, F, F + 0.77);
    setting(L, xm, c - 0.25, F, PI); setting(L, xm, c + 0.25, F, 0); pendant(L, xm, RB.C, c, 2.2, "shade"); }
  function restDining(L, B, v, acc) { var K = L.K, F = B.F, C = B.C, X1 = B.X1; L.chairs = [];
    [-3.9, -1.0, 1.9].forEach(function (c) { booth(L, c, F, acc, X1); });
    // feature wall over the booths: books (Border Books), a triptych (the Outpost), else a walnut slat panel with sconces
    if (v.feature === "books") { K.quad("books", 7.4, 1.6, X1 - 0.02, F + 2.5, -1.0, -PI / 2); K.bb("walnut", X1 - 0.08, F + 1.62, -4.8, X1, F + 1.7, 2.8); K.bb("walnut", X1 - 0.08, F + 3.3, -4.8, X1, F + 3.38, 2.8); }
    else if (v.feature === "art") { picture(L, R14I ? "art3" : "art0", X1 - 0.08, F + 2.5, -3.9, 1.4, 1.1, -PI / 2, null, "walnut"); picture(L, "art1", X1 - 0.08, F + 2.5, -1.0, 1.4, 1.1, -PI / 2, null, "walnut"); picture(L, R14I ? "art4" : "art2", X1 - 0.08, F + 2.5, 1.9, 1.4, 1.1, -PI / 2, null, "walnut"); }
    else { for (var sl = -4.8; sl <= 2.8; sl += 0.16) K.bb("oakP", X1 - 0.1, F + 1.5, sl, X1 - 0.02, F + 3.6, sl + 0.09); }
    // tables for two and four in the middle
    [[-2.3, -3.6, 4], [0.9, -3.6, 4], [-2.3, -0.6, 2], [0.9, -0.6, 4], [-2.6, 2.3, 2], [0.4, 2.2, 2]].forEach(function (t, i) { var x = t[0], z = t[1]; K.bb("walnut", x - 0.45, F + 0.72, z - 0.45, x + 0.45, F + 0.77, z + 0.45); K.cyl("bronze", 0.04, 0.04, 0.72, x, F + 0.36, z, 8); K.cyl("bronze", 0.25, 0.28, 0.03, x, F + 0.015, z, 16); L.solid(x, z, 0.9, 0.9, F, F + 0.77); K.cyl("glassB", 0.03, 0.03, 0.1, x, F + 0.82, z, 8);
      var sides = t[2] === 4 ? [0, PI / 2, PI, -PI / 2] : [0, PI]; sides.forEach(function (a) { var cx = x - Math.sin(a) * 0.72, cz = z - Math.cos(a) * 0.72; chair(L, cx, cz, F, a, i % 2 ? "cream" : acc); L.chairs.push([cx, cz, a]); setting(L, x - Math.sin(a) * 0.28, z - Math.cos(a) * 0.28, F, a); });
      pendant(L, x, C, z, 2.25, "shade"); });
    // host stand by the door, the chalkboard menu, plants in the front corners
    K.bb("walnut", 1.6, F, 4.0, 2.4, F + 1.12, 4.5); K.bb("brass", 1.55, F + 1.12, 3.95, 2.45, F + 1.15, 4.55); K.cyl("shade", 0.08, 0.13, 0.16, 2.2, F + 1.4, 4.25, 14); K.cyl("brass", 0.01, 0.01, 0.25, 2.2, F + 1.27, 4.25, 4); L.solid(2.0, 4.25, 0.9, 0.6, F, F + 1.15);
    var M = mats(), mk = "menu_" + L.h.id; if (!M[mk]) M[mk] = new THREE.MeshStandardMaterial({ map: menuTex(v), emissiveMap: menuTex(v), emissive: 0xffffff, emissiveIntensity: 0.18, roughness: 0.85 }); K.box("walnut", 1.08, 1.4, 0.06, 0.1, F + 3.35, B.PK + 0.13, 0, 0); K.quad(mk, 0.96, 1.28, 0.1, F + 3.35, B.PK + 0.165, 0);
    L.hot(2.0, F, 4.25, 2.2, "info", { faced: true, t: v.name, k: "Today's menu", p: (v.menu || []).map(function (m) { return (m[0] || m) + (m[1] ? " (" + m[1] + ")" : ""); }).join(" · ") || "Ask your server.", prompt: "read the menu" });
    L.model("term_planter", -6.6, F, 4.6, 0.3, 0.55); L.solid(-6.6, 4.6, 1.1, 1.1, F, F + 1.0); L.model("term_planter", 6.6, F, 4.6, 1.3, 0.55); L.solid(6.6, 4.6, 1.1, 1.1, F, F + 1.0); plant(L, 4.4, -4.9, F, 1.3, 0.8);
    L.light(0xffd9a8, 1.25, 10, 5.6, C - 1.4, -1.0); L.light(0xffe0b8, 1.2, 10, -0.6, C - 1.4, -1.2); L.light(0xffe0b8, 1.0, 9, 0.5, C - 1.2, 3.2); }
  function restKitchen(L, B) { var K = L.K, F = B.F, C = B.C, Z0 = B.Z0, PK = B.PK;
    // back line: stainless counters, the range under a hood, shelves of pots; a prep island facing the pass
    K.bb("brushed", -7.2, F, Z0, 7.2, F + 0.9, Z0 + 0.72); K.bb("brushed", -7.2, F + 0.9, Z0, 7.2, F + 0.94, Z0 + 0.75); K.bb("black", -2.2, F + 0.94, Z0 + 0.05, 1.2, F + 0.97, Z0 + 0.7); for (var bn = 0; bn < 6; bn++) K.cyl("steel", 0.12, 0.12, 0.03, -1.9 + (bn % 3) * 1.1, F + 0.98, Z0 + 0.22 + Math.floor(bn / 3) * 0.3, 16);
    K.bb("brushed", -2.4, F + 2.2, Z0, 1.4, F + 2.9, Z0 + 1.0); K.bb("brushed", -2.2, F + 2.9, Z0, 1.2, C, Z0 + 0.5); K.bb("strip", -2.3, F + 2.18, Z0 + 0.1, 1.3, F + 2.2, Z0 + 0.9);
    for (var sh = 0; sh < 2; sh++) { K.bb("brushed", 2.0, F + 1.6 + sh * 0.55, Z0, 7.0, F + 1.63 + sh * 0.55, Z0 + 0.4); for (var pp = 0; pp < 7; pp++) K.cyl(pp % 2 ? "steel" : "brushed", 0.13, 0.12, 0.2, 2.4 + pp * 0.66, F + 1.73 + sh * 0.55, Z0 + 0.2, 14); }
    K.bb("brushed", -3.0, F, -7.0, 2.6, F + 0.9, -6.3); K.bb("walnut", -3.05, F + 0.9, -7.05, 2.65, F + 0.95, -6.25); for (var bw = 0; bw < 4; bw++) K.cyl("ceramic", 0.16, 0.1, 0.1, -2.2 + bw * 1.3, F + 1.0, -6.65, 16);
    L.solid(0, Z0 + 0.38, 14.4, 0.76, F, F + 0.95); L.solid(-0.2, -6.65, 5.6, 0.75, F, F + 0.95);
    L.light(0xf2f6ff, 1.2, 10, -0.5, C - 1.0, -7.0); }
  function restPeople(L, B, h, v) { var F = B.F;
    var w = person(L, { id: "waiter", name: "Server", label: false, look: { body: "m", skin: "d9a877", shirt: "f4f2ec", pants: "1c1f24", hair: 3 }, x: 0.3, z: -4.5, y: F, yaw: PI, walk: [[0.3, -4.6, 5, PI], [-0.7, -4.5], [-0.8, -2.1, 2.5], [3.9, -2.4, 4, -PI / 2], [3.9, 0.5, 3, -PI / 2], [-0.8, 1.0, 2], [-0.8, 3.6, 3, 0], [-0.8, -2.0], [-0.7, -4.5]], speed: 0.9 });
    var tid = "int3_waiter_" + h.id, T = registerTalk(tid, L, w, "restaurant", "waiter", { venue: v.name }); w.hot = L.hot(0, F, 0, 2.0, "talk", { id: tid, name: T.name, who: w, prompt: "talk to " + T.name + ", your server" });
    person(L, { id: "chef1", look: { body: "m", skin: "c98e62", shirt: "f4f2ec", pants: "2b2f36", hair: 1, hairc: "231a14" }, x: -0.8, z: -7.35, y: F, yaw: 0.2, toque: true, face: false });
    person(L, { id: "chef2", look: { body: "f", skin: "e8c19a", shirt: "f4f2ec", pants: "2b2f36", hair: 2, hairc: "3a2416" }, x: 1.6, z: -6.0, y: F, yaw: PI, toque: true, face: false });
    person(L, { id: "host", name: "Host", label: true, look: { body: "f", skin: "a86f46", shirt: "1c1f24", pants: "1c1f24", hair: 2, hairc: "1c1512" }, x: 2.0, z: 3.75, y: F, yaw: 0 });
    person(L, { id: "g2", look: { body: "f", skin: "f3d9c0", shirt: "6e1f24", pants: "1c1f24", hair: 1, hairc: "6b4226" }, x: RB.X1 - 0.85, z: -1.0 + 0.93, y: F, yaw: PI, sit: true, seatY: 0.52 });
    L.anim.push(function () { if (w.g && w.hot) { var p = w.g.getWorldPosition(new THREE.Vector3()); w.hot.x = p.x; w.hot.z = p.z; } }); }
  TYPES.restaurant.build = buildRest;

  // ═════════════════════════ THE HANGAR HOME (every hangar home; a model-home open house) ═════════════════════════
  // the hangar bay (a light jet behind the glass hangar door, the cart), the double-height great room behind a glass wall
  // (lounge facing the jet, dining, the kitchen island), a stair to the mezzanine (bedroom suite, office), the entry gallery
  // in the side wing (raised to the porch, steps down to the great room), room notes for the open house
  var HB = { F: 0.05, FW: 0.7, X0: -13.35, X1: 9.0, Z0: -14.15, Z1: 12.2, WX1: 14.15, WZ0: -5.3, WZ1: 10.4, GZ: -2.5, MZ: -10.5, MY: 3.4, ridge: -2.0, top: 9.9,
    st: { x0: -13.3, x1: -12.1, zb: -3.4, n: 18, run: 0.3 } };
  function hcy(x) { return x < HB.ridge ? HB.top - 0.273 * (HB.ridge - x) : HB.top - 0.314 * (x - HB.ridge); }   // the pitched ceiling (0.45 m under the shell's roof)
  function roomNote(k) { var r = (sect("hangarhome").rooms || {})[k]; var D = { bay: ["The Hangar Bay", "Your aircraft, in the house", "Park a light jet or a turboprop a few steps from the living room, behind a glass hangar door that lifts in one piece. Epoxy floor, LED high bays, room for the cart beside the wing."],
      great: ["The Great Room", "Double height, facing the aircraft", "The living room looks straight through a full-height glass wall into the hangar bay. The pitched timber ceiling rises to the ridge; the lounge, the dining table and the kitchen share the one room."],
      kitchen: ["The Kitchen", "A marble island, walnut and steel", "A waterfall marble island with seating for three, a professional range under a steel hood and full-height walnut pantry and refrigerator columns, all tucked under the mezzanine."],
      suite: ["The Mezzanine Suite", "Bedroom over the great room", "The principal bedroom sits on the mezzanine behind a glass balustrade: wake up over the great room with the aircraft beyond the glass."],
      office: ["The Office", "A desk with a view of the bay", "A walnut desk faces the balustrade and the hangar bay, with bookcases along the side wall."],
      entry: ["The Entry Gallery", "Arrive by the front door", "The front door opens into a gallery along the hangar glass, so the first thing you see is the aircraft. The wine wall is on your right; a few steps lead down into the great room."] }[k];
    return { t: (r && r.t) || D[0], k: (r && r.k) || D[1], p: (r && r.p) || D[2] }; }
  function* buildHome(h, L, K, M) { var B = HB, F = B.F, FW = B.FW, X0 = B.X0, X1 = B.X1, Z0 = B.Z0, Z1 = B.Z1;
    // floors: epoxy in the bay, polished concrete in the great room and the low end of the wing, oak in the raised wing
    floorRect(L, "epoxy", X0, B.GZ, X1, Z1, F); floorRect(L, "concrete", X0, Z0, X1, B.GZ, F); floorRect(L, "concrete", X1, B.WZ0, B.WX1, -1.2, F);
    K.flat("oak", X1, -0.3, B.WX1, B.WZ1, FW + 0.003, true, undefined, PI / 4); L.solid((X1 + B.WX1) / 2, (B.WZ1 - 0.3) / 2, B.WX1 - X1, B.WZ1 + 0.3, FW - 0.5, FW);
    for (var sp = 0; sp < 3; sp++) { var y = FW - (sp + 1) * (FW - F) / 4, z1 = -0.3 - sp * 0.3, z0 = z1 - 0.3; K.bb("oakP", X1, F, z0, B.WX1, y, z1); L.solid((X1 + B.WX1) / 2, (z0 + z1) / 2, B.WX1 - X1, 0.3, F - 0.1, y); }
    K.bb("brass", B.WX1 - 0.12, F + 0.9, -1.4, B.WX1 - 0.07, F + 0.95, 0.2); K.bb("brass", B.WX1 - 0.12, F, -1.4, B.WX1 - 0.07, F + 0.93, -1.35); K.bb("brass", B.WX1 - 0.12, FW, 0.15, B.WX1 - 0.07, F + 0.93, 0.2);
    // the pitched ceiling in timber, glulam rafters and ties; black steel trusses over the bay
    var zc0 = Z0, zc1 = Z1; K.q4("oakP", [X0, hcy(X0), zc0], [B.ridge, hcy(B.ridge), zc0], [B.ridge, hcy(B.ridge), zc1], [X0, hcy(X0), zc1], 1.4); K.q4("oakP", [B.ridge, hcy(B.ridge), zc0], [X1, hcy(X1), zc0], [X1, hcy(X1), zc1], [B.ridge, hcy(B.ridge), zc1], 1.4);
    for (var rz = Z0 + 1.6; rz < Z1 - 0.5; rz += 3.2) { var inBay = rz > B.GZ; var bk = inBay ? "steel" : "walnut"; var gl = new THREE.BoxGeometry(B.ridge - X0 + 0.2, 0.3, 0.2); gl.rotateZ(Math.atan2(hcy(B.ridge) - hcy(X0), B.ridge - X0)); K.geo(bk, gl, (X0 + B.ridge) / 2, (hcy(X0) + hcy(B.ridge)) / 2 - 0.16, rz, 0);
      var gr2 = new THREE.BoxGeometry(X1 - B.ridge + 0.2, 0.3, 0.2); gr2.rotateZ(Math.atan2(hcy(X1) - hcy(B.ridge), X1 - B.ridge)); K.geo(bk, gr2, (B.ridge + X1) / 2, (hcy(X1) + hcy(B.ridge)) / 2 - 0.16, rz, 0); K.bb(bk, X0, 6.0, rz - 0.08, X1, 6.18, rz + 0.08); }
    // walls: the left wall with tall great-room windows, the back gable (mezzanine windows), the gable's right wall, the wing
    wall(L, "plaster", "z", X0 - 0.1, Z0, Z1, F - 0.1, 7.0, 0.2, [[-12.4, -8.9, F + 0.5, F + 5.2, "glass", 1.2], [-7.4, -3.9, F + 0.5, F + 5.2, "glass", 1.2]]);
    K.poly("plaster", [[X0, hcy(X0) - 0.05], [B.ridge, hcy(B.ridge) + 0.05], [X1, hcy(X1) - 0.05]], Z0 - 0.02, 1); wall(L, "plaster", "x", Z0 - 0.1, X0 - 0.2, X1 + 0.2, F - 0.1, 7.0, 0.2, [[-11.6, -5.2, B.MY + 0.6, B.MY + 3.0, "glass", 1.6], [1.2, 7.6, B.MY + 0.6, B.MY + 3.0, "glass", 1.6]]);
    wall(L, "plaster", "z", X1 + 0.1, Z0, B.WZ0, F - 0.1, 6.7, 0.2);
    wall(L, "plaster", "x", B.WZ0 - 0.1, X1, B.WX1 + 0.2, F - 0.1, 5.3, 0.2); wall(L, "plaster", "z", B.WX1 + 0.1, B.WZ0, B.WZ1 + 0.2, F - 0.1, 5.3, 0.2, [[-4.6, -2.2, F + 0.6, F + 4.2, "glass", 1.2]]);
    wall(L, "plaster", "x", B.WZ1 + 0.1, X1, B.WX1, FW - 0.1, 5.3, 0.2, [[9.84, 11.31, FW, FW + 2.6, "open"], [11.45, 13.95, FW + 0.05, FW + 2.9, "glass", 1.25]], "walnut"); doorFrame(L, "walnut");
    ceilRect(L, "plaster", X1, B.WZ0, B.WX1, B.WZ1, 5.2); K.bb("strip", X1 + 0.1, 5.1, B.WZ0 + 0.3, X1 + 0.14, 5.14, B.WZ1 - 0.3);
    // the gable front: solid either side of the hangar door, a glazed gable above it (to the ridge)
    wall(L, "plaster", "x", Z1 + 0.1, X0, X1, F - 0.1, 6.3, 0.2, [[-10.1, 6.0, F, 6.28, "open"]]);
    K.poly("glass", [[X0, 6.3], [X1, 6.3], [X1, hcy(X1)], [B.ridge, hcy(B.ridge)], [X0, hcy(X0)]], Z1 + 0.1, -1); for (var gm = X0 + 2.2; gm < X1; gm += 2.25) K.bb("steel", gm - 0.04, 6.3, Z1 + 0.05, gm + 0.04, hcy(gm), Z1 + 0.15); K.bb("steel", X0, 6.25, Z1 + 0.02, X1, 6.35, Z1 + 0.18);
    yield; homeBay(L, B); yield; homeGreat(L, B); yield; homeMezz(L, B); yield; homeWing(L, B); L.tip = "open house · look around, the notes by each room tell you more"; }
  function homeBay(L, B) { var K = L.K, F = B.F, FW = B.FW, X0 = B.X0, X1 = B.X1, Z1 = B.Z1, M = mats();
    // the glazed hangar door: one glass leaf in a black steel frame, hinged at the header, lifting outward (walk up to it, or E)
    var piv = new THREE.Group(), dW = 16.0, dH = 6.18; piv.position.set(-2.05, 6.25, Z1 + 0.12); var parts = [], bx = function (w, hh, d, x, y, z) { var g = new THREE.BoxGeometry(w, hh, d); g.translate(x, y, z); parts.push(g); };
    bx(dW, 0.14, 0.12, 0, -0.07, 0); bx(dW, 0.14, 0.12, 0, -dH + 0.07, 0); bx(0.14, dH, 0.12, -dW / 2 + 0.07, -dH / 2, 0); bx(0.14, dH, 0.12, dW / 2 - 0.07, -dH / 2, 0); for (var m = 1; m < 8; m++) bx(0.07, dH, 0.1, -dW / 2 + m * dW / 8, -dH / 2, 0); bx(dW, 0.07, 0.1, 0, -dH * 0.36, 0); bx(dW, 0.07, 0.1, 0, -dH * 0.68, 0);
    var fr = new THREE.Mesh(mergeGeos(parts), M.steel); fr.userData.own = true; parts.forEach(function (g) { g.dispose(); }); var gp = new THREE.Mesh(new THREE.PlaneGeometry(dW - 0.2, dH - 0.2), M.glassB); gp.position.y = -dH / 2; gp.userData.own = true; piv.add(fr, gp); L.g.add(piv);
    L.hangar = { piv: piv, open: 0, target: 0, manual: null, solid: L.solid(-2.05, Z1 + 0.12, dW, 0.3, F, 6.25) };
    // the aircraft (a light jet at the scale of a very light jet), solids from its footprint below head height
    var jk = has("jet_light") ? "jet_light" : has("jet_mid") ? "jet_mid" : null; if (jk) { var sc = jk === "jet_light" ? 0.8 : 0.6, jx = -2.4, jz = 4.9; L.model(jk, jx, F, jz, 0, sc, "in"); L.jet = { kind: jk, x: jx, z: jz, sc: sc };
      var HG = window.PLAN_HANGARS, boxes = null; try { boxes = HG && HG.api && HG.api.occBoxes ? HG.api.occBoxes(jk, 0.7, 2.05 / sc) : null; } catch (e) { boxes = null; } if (boxes && boxes.length) boxes.forEach(function (b) { L.solid(jx + b[0] * sc, jz + b[1] * sc, b[2] * sc + 0.1, b[3] * sc + 0.1, F - 0.2, F + 2.0); }); else { L.solid(jx, jz, 1.8, 12.5, F, F + 2.0); L.solid(jx, jz + 0.5, 12.0, 1.6, F + 1.1, F + 2.0); } }
    if (L.model("cart", 6.3, F, 8.8, 0.3)) L.solid(6.3, 8.8, 1.5, 2.7, F, F + 1.9, 0.3);
    // the floor: a brass compass inlay in front of the nose, a taxi line to the door, chocks
    var ring = new THREE.RingGeometry(1.25, 1.33, 48); ring.rotateX(-PI / 2); K.geo("brass", ring, -2.4, F + 0.006, 10.3, 0); var ring2 = new THREE.RingGeometry(0.9, 0.94, 48); ring2.rotateX(-PI / 2); K.geo("brass", ring2, -2.4, F + 0.006, 10.3, 0); for (var cp = 0; cp < 4; cp++) K.box("brass", 0.05, 0.004, 2.5, -2.4, F + 0.006, 10.3, cp * PI / 4, 0);
    K.bb("strip", -2.47, F + 0.002, -2.2, -2.33, F + 0.006, 8.9); [-1, 1].forEach(function (s) { K.bb("black", -2.4 + s * 1.6 - 0.12, F, 3.2, -2.4 + s * 1.6 + 0.12, F + 0.12, 3.5); });
    // a black steel storage wall on the left, walnut top, a workbench and a lit tool board
    K.bb("steel", X0, F, 0.4, X0 + 0.65, F + 0.95, 9.6); K.bb("walnut", X0, F + 0.95, 0.35, X0 + 0.7, F + 1.0, 9.65); K.bb("steel", X0, F + 2.2, 0.4, X0 + 0.45, F + 3.0, 9.6); K.bb("strip", X0 + 0.4, F + 2.17, 0.5, X0 + 0.44, F + 2.2, 9.5); for (var dz = 1.2; dz < 9.5; dz += 1.2) K.bb("brushed", X0 + 0.66, F + 0.8, dz - 0.3, X0 + 0.68, F + 0.83, dz + 0.3);
    L.solid(X0 + 0.35, 5.0, 0.7, 9.3, F, F + 1.0);
    // the glass between the bay and the entry gallery, the wing's floor edge under it, the band over it to the gable's ceiling
    glazing(L, "z", X1 + 0.05, B.GZ, B.WZ1, FW, 5.2, 2.2, "steel"); K.bb("concrete", X1 - 0.02, F, B.GZ, X1 + 0.12, FW, B.WZ1); K.bb("plaster", X1 - 0.02, 5.2, B.GZ, X1 + 0.12, 6.9, B.WZ1 + 0.1); L.solid(X1 + 0.05, (B.GZ + B.WZ1) / 2, 0.14, B.WZ1 - B.GZ, F - 0.1, 5.2);
    wall(L, "plaster", "z", X1 + 0.1, B.WZ1, Z1, F - 0.1, 6.6, 0.2);
    // LED high bays over the aircraft; cool pooled lights
    [[-6.2, 2.6], [1.4, 2.6], [-6.2, 7.6], [1.4, 7.6]].forEach(function (p) { K.cyl("steel", 0.36, 0.3, 0.2, p[0], 5.85, p[1], 20); K.cyl("lampC", 0.32, 0.32, 0.02, p[0], 5.74, p[1], 20); K.cyl("steel", 0.01, 0.01, hcy(p[0]) - 5.95, p[0], (hcy(p[0]) + 5.95) / 2, p[1], 4); });
    L.light(0xf4f2ec, 1.1, 15, -6.2, 5.4, 5.0); L.light(0xf4f2ec, 1.1, 15, 1.4, 5.4, 5.0);
    var n = roomNote("bay"); L.hot(5.2, F, 1.0, 3.0, "info", { t: n.t, k: n.k, p: n.p, prompt: "about the hangar bay" }); }
  function homeGreat(L, B) { var K = L.K, F = B.F, X0 = B.X0, X1 = B.X1, Z0 = B.Z0, GZ = B.GZ, M = mats();
    // the full-height glass wall to the bay, a sliding glass door (parked open), steel mullions
    K.poly("glass", [[X0, F], [2.9, F], [2.9, 2.85], [4.7, 2.85], [4.7, F], [X1, F], [X1, hcy(X1)], [B.ridge, hcy(B.ridge)], [X0, hcy(X0)]], GZ, 1);
    for (var mx = X0 + 2.23; mx < X1 - 0.2; mx += 2.23) { if (mx > 2.8 && mx < 4.8) continue; K.bb("steel", mx - 0.035, F, GZ - 0.05, mx + 0.035, hcy(mx), GZ + 0.05); } K.bb("steel", 2.84, F, GZ - 0.06, 2.9, 2.9, GZ + 0.06); K.bb("steel", 4.7, F, GZ - 0.06, 4.76, 2.9, GZ + 0.06); K.bb("steel", 2.84, 2.85, GZ - 0.06, 4.76, 2.92, GZ + 0.06); K.bb("steel", X0, F, GZ - 0.06, X1, F + 0.06, GZ + 0.06);
    K.quad("glassB", 1.8, 2.75, 5.62, F + 1.42, GZ - 0.08, 0); K.bb("steel", 4.72, F, GZ - 0.11, 6.52, F + 0.05, GZ - 0.05); L.solid((X0 + 2.9) / 2, GZ, 2.9 - X0, 0.14, F - 0.1, 6.5); L.solid((4.7 + X1) / 2, GZ, X1 - 4.7, 0.14, F - 0.1, 6.5);
    // the lounge facing the glass and the aircraft: a pair of sofas, leather lounge chairs, a walnut table, floor lamps, a rug
    rug(L, "rug1", -3.3, -4.9, 6.0, 4.4, F); [[-4.45, -6.0], [-2.15, -6.0]].forEach(function (p) { if (L.model("jetsofa", p[0], F, p[1], 0)) { L.solid(p[0], p[1] - 0.3, 2.3, 0.35, F, F + 0.85); [-0.7, 0, 0.7].forEach(function (o) { L.seat(p[0] + o, p[1] + 0.05, 0.66, 0.6, F + 0.45, 0); }); } });
    if (L.model("jettable", -3.3, F, -4.5, 0, 0.9)) L.solid(-3.3, -4.5, 1.5, 0.8, F, F + 0.56); [[-7.0, -4.6, 1.25], [0.4, -4.6, -1.25]].forEach(function (c) { if (L.model("lounge_chair", c[0], F, c[1], c[2])) L.seat(c[0], c[1], 0.62, 0.62, F + 0.46, c[2]); }); [[-6.6, -6.4], [0.0, -6.4]].forEach(function (p) { if (L.model("jetlamp", p[0], F, p[1], 0)) L.solid(p[0], p[1], 0.4, 0.4, F, F + 1.5); });
    // dining: a long walnut table for eight under a linear brass chandelier
    var dx = -8.6, dz = -8.1; K.bb("walnut", dx - 1.45, F + 0.72, dz - 0.55, dx + 1.45, F + 0.78, dz + 0.55); K.bb("walnut", dx - 1.2, F, dz - 0.08, dx - 1.05, F + 0.72, dz + 0.08); K.bb("walnut", dx + 1.05, F, dz - 0.08, dx + 1.2, F + 0.72, dz + 0.08); K.bb("walnut", dx - 1.2, F + 0.02, dz - 0.4, dx - 1.05, F + 0.08, dz + 0.4); K.bb("walnut", dx + 1.05, F + 0.02, dz - 0.4, dx + 1.2, F + 0.08, dz + 0.4); L.solid(dx, dz, 2.9, 1.1, F, F + 0.78);
    L.chairs = []; [-0.95, -0.32, 0.32, 0.95].forEach(function (o) { [[-0.85, 0], [0.85, PI]].forEach(function (sd) { var cx = dx + o, cz = dz + sd[0]; chair(L, cx, cz, F, sd[1], "cream"); L.chairs.push([cx, cz, sd[1]]); setting(L, cx, dz + sd[0] * 0.3, F, sd[1]); }); }); chair(L, dx - 1.75, dz, F, PI / 2, "tan"); chair(L, dx + 1.75, dz, F, -PI / 2, "tan");
    K.bb("brass", dx - 1.2, 3.1, dz - 0.03, dx + 1.2, 3.14, dz + 0.03); for (var cl = 0; cl < 7; cl++) K.sph("lamp", 0.055, dx - 1.1 + cl * 0.366, 3.02, dz, 1.3, 10); [-1.0, 1.0].forEach(function (o) { K.cyl("brass", 0.006, 0.006, hcy(dx + o) - 3.14, dx + o, (hcy(dx + o) + 3.14) / 2, dz, 4); });
    // the kitchen under the mezzanine: walnut and marble along the back wall, a steel range and hood, walnut columns, the island
    K.bb("walnut", 0.8, F, Z0, 7.5, F + 0.88, Z0 + 0.66); K.bb("marble", 0.78, F + 0.88, Z0, 7.52, F + 0.93, Z0 + 0.7); K.bb("marble", 0.8, F + 0.93, Z0, 7.5, F + 1.6, Z0 + 0.02); K.bb("brushed", 3.4, F + 0.93, Z0 + 0.02, 5.0, F + 0.97, Z0 + 0.66); K.bb("brushed", 3.3, F + 1.7, Z0, 5.1, F + 2.4, Z0 + 0.6); K.bb("brushed", 3.6, F + 2.4, Z0, 4.8, B.MY - 0.3, Z0 + 0.35);
    K.bb("walnut", 7.55, F, Z0, 8.95, B.MY - 0.32, Z0 + 0.7); K.bb("bronze", 8.2, F + 0.9, Z0 + 0.71, 8.23, F + 1.9, Z0 + 0.73); L.solid(4.9, Z0 + 0.36, 8.2, 0.72, F, F + 1.0); L.solid(8.25, Z0 + 0.36, 1.4, 0.72, F, B.MY - 0.3);
    var ix = 4.3, iz = -8.9; K.bb("marble", ix - 1.7, F, iz - 0.55, ix + 1.7, F + 0.95, iz + 0.55); K.bb("walnut", ix - 1.55, F, iz - 0.62, ix + 1.55, F + 0.6, iz - 0.55); L.solid(ix, iz, 3.4, 1.1, F, F + 0.95); [-1.0, 0, 1.0].forEach(function (o) { stool(L, ix + o, iz + 0.95, F, PI, 0.72); }); [-0.9, 0, 0.9].forEach(function (o) { pendant(L, ix + o, hcy(ix + o), iz, hcy(ix + o) - 2.5, "shade"); });
    K.bb("ceramic", ix - 0.4, F + 0.95, iz - 0.2, ix - 0.1, F + 1.0, iz + 0.1); K.cyl("glassB", 0.1, 0.08, 0.28, ix + 0.6, F + 1.09, iz, 14); for (var fr2 = 0; fr2 < 4; fr2++) K.sph(["rust", "sage", "cream", "rust"][fr2], 0.05, ix + 0.3 + fr2 * 0.06, F + 1.0, iz + 0.25, 1, 8);
    L.light(0xffd9a8, 2.0, 12, -3.3, 4.6, -5.0); L.light(0xffd6a8, 1.6, 10, dx, 2.8, dz); L.light(0xffe0bc, 1.7, 10, ix, 3.0, iz + 0.6); L.light(0xffd9a8, 1.3, 11, -8.0, 5.2, -4.0);
    var n1 = roomNote("great"), n2 = roomNote("kitchen"); L.hot(-3.3, F, -3.2, 2.2, "info", { t: n1.t, k: n1.k, p: n1.p, prompt: "about the great room" }); L.hot(ix, F, iz + 1.9, 1.6, "info", { t: n2.t, k: n2.k, p: n2.p, prompt: "about the kitchen" }); }
  function homeMezz(L, B) { var K = L.K, F = B.F, X0 = B.X0, X1 = B.X1, Z0 = B.Z0, MZ = B.MZ, MY = B.MY, S = B.st, rise = (MY - F) / S.n, cx = (S.x0 + S.x1) / 2, zt = S.zb - (S.n - 1) * S.run;
    // the stair along the left wall: walnut treads on a closed block, a glass balustrade with a walnut rail
    for (var i = 1; i < S.n; i++) { var y = F + i * rise, z1 = S.zb - (i - 1) * S.run, z0 = z1 - S.run; K.bb("walnut", S.x0, y - 0.05, z0, S.x1 + 0.03, y, z1 + 0.03); K.bb("walnut", S.x0, y - rise, z1 - 0.01, S.x1, y - 0.05, z1 + 0.01); K.bb("plaster", S.x1, F, z0, S.x1 + 0.03, y - 0.05, z1); L.solid(cx, (z0 + z1) / 2, S.x1 - S.x0, S.run + 0.01, F - 0.1, y); }
    var len = S.zb - zt, ang = Math.atan2(MY - F, len), hyp = Math.hypot(MY - F, len); var g1 = new THREE.PlaneGeometry(hyp, 0.95); g1.rotateZ(ang); g1.rotateY(PI / 2); K.geo("glassB", g1, S.x1 + 0.06, F + (MY - F) / 2 + 0.55, (S.zb + zt) / 2, 0); var r1 = new THREE.BoxGeometry(hyp, 0.06, 0.06); r1.rotateZ(ang); r1.rotateY(PI / 2); K.geo("walnut", r1, S.x1 + 0.06, F + (MY - F) / 2 + 1.03, (S.zb + zt) / 2, 0);
    L.solid(S.x1 + 0.1, (S.zb + zt) / 2, 0.1, len - 0.4, F + 0.6, MY + 1.0);
    // the mezzanine: slab, oak floor, plaster soffit, walnut fascia; the landing strip along the left wall; the glass balustrade
    var xe = S.x1 + 0.1; K.flat("oak", X0, Z0, X1, MZ, MY + 0.003, true, undefined, PI / 4); K.flat("oak", X0, MZ, xe, zt, MY + 0.003, true, undefined, PI / 4); K.flat("plaster", X0, Z0, X1, MZ, MY - 0.3, false); K.bb("walnut", xe, MY - 0.3, MZ, X1, MY + 0.02, MZ + 0.06); K.bb("walnut", xe, MY - 0.3, MZ, xe + 0.06, MY + 0.02, zt);
    L.solid((X0 + X1) / 2, (Z0 + MZ) / 2, X1 - X0, MZ - Z0, MY - 0.3, MY); L.solid((X0 + xe) / 2, (MZ + zt) / 2, xe - X0, zt - MZ, MY - 0.3, MY);
    K.quad("glassB", X1 - xe - 0.1, 1.0, (xe + X1) / 2, MY + 0.5, MZ + 0.03, 0); K.bb("walnut", xe, MY + 1.0, MZ, X1, MY + 1.06, MZ + 0.07); K.quad("glassB", zt - MZ, 1.0, xe + 0.03, MY + 0.5, (MZ + zt) / 2, PI / 2); K.bb("walnut", xe, MY + 1.0, MZ, xe + 0.07, MY + 1.06, zt);
    L.solid((xe + X1) / 2, MZ + 0.04, X1 - xe, 0.1, MY, MY + 1.06); L.solid(xe + 0.04, (MZ + zt) / 2, 0.1, zt - MZ, MY, MY + 1.06);
    // the bedroom: a king bed under an upholstered headboard, nightstands and lamps, a bench, a rug, a chair by the window, art
    var bx = -3.3, bz = Z0 + 1.15; K.bb("cream", bx - 1.3, MY, Z0, bx + 1.3, MY + 1.35, Z0 + 0.15); K.bb("walnut", bx - 1.05, MY, bz - 0.95, bx + 1.05, MY + 0.3, bz + 1.1); K.bb("white", bx - 1.0, MY + 0.3, bz - 0.9, bx + 1.0, MY + 0.55, bz + 1.05); K.bb("linen", bx - 1.02, MY + 0.52, bz - 0.35, bx + 1.02, MY + 0.6, bz + 1.07); K.bb("rust", bx - 1.03, MY + 0.55, bz + 0.55, bx + 1.03, MY + 0.62, bz + 0.85); [-0.55, 0.55].forEach(function (o) { K.box("cream", 0.7, 0.16, 0.3, bx + o, MY + 0.66, bz - 0.7, 0, 0); });
    L.seat(bx, bz + 0.3, 2.0, 1.2, MY + 0.58, 0); L.solid(bx, Z0 + 0.35, 2.6, 0.45, MY, MY + 1.35); [-1.75, 1.75].forEach(function (o) { K.bb("walnut", bx + o - 0.3, MY, Z0 + 0.1, bx + o + 0.3, MY + 0.55, Z0 + 0.6); K.cyl("brass", 0.08, 0.1, 0.03, bx + o, MY + 0.57, Z0 + 0.35, 14); K.cyl("brass", 0.012, 0.012, 0.4, bx + o, MY + 0.78, Z0 + 0.35, 6); K.cyl("shade", 0.1, 0.17, 0.2, bx + o, MY + 1.05, Z0 + 0.35, 16); L.solid(bx + o, Z0 + 0.35, 0.6, 0.5, MY, MY + 0.6); });
    K.bb("tan", bx - 0.8, MY + 0.3, bz + 1.25, bx + 0.8, MY + 0.46, bz + 1.65); K.bb("walnut", bx - 0.75, MY, bz + 1.3, bx + 0.75, MY + 0.3, bz + 1.6); L.seat(bx, bz + 1.45, 1.6, 0.4, MY + 0.46, PI); rug(L, "rug0", bx, bz + 0.9, 3.6, 3.2, MY); picture(L, "art2", bx, MY + 2.25, Z0 + 0.04, 1.8, 0.9, 0, R14I ? [0, 0.125, 1, 0.875] : null, "walnut");
    if (L.model("lounge_chair", -9.4, MY, -12.4, PI - 0.4)) L.seat(-9.4, -12.4, 0.62, 0.62, MY + 0.46, PI - 0.4); K.cyl("walnut", 0.25, 0.25, 0.03, -8.6, MY + 0.52, -12.9, 18); K.cyl("bronze", 0.03, 0.03, 0.5, -8.6, MY + 0.26, -12.9, 8); L.solid(-8.6, -12.9, 0.45, 0.45, MY, MY + 0.55);
    L.light(0xffd8a8, 1.2, 9, bx, MY + 2.2, bz + 0.8);
    // a low bookshelf between the suite and the office
    K.bb("walnut", -0.75, MY, Z0 + 0.2, -0.35, MY + 1.5, MZ - 0.9); K.quad("books", 2.4, 1.2, -0.34, MY + 0.75, (Z0 + MZ - 0.7) / 2, PI / 2); K.quad("books", 2.4, 1.2, -0.76, MY + 0.75, (Z0 + MZ - 0.7) / 2, -PI / 2); L.solid(-0.55, (Z0 + 0.2 + MZ - 0.9) / 2, 0.4, MZ - 0.9 - Z0 - 0.2, MY, MY + 1.5);
    // the office: a walnut desk facing the balustrade and the bay, its chair, bookcases on the side wall
    if (L.model("exec_desk", 4.6, MY, -11.6, PI)) L.solid(4.6, -11.6, 2.0, 1.0, MY, MY + 0.78); if (L.model("lounge_chair", 4.6, MY, -12.6, 0)) L.seat(4.6, -12.6, 0.62, 0.62, MY + 0.46, 0);
    [-13.3, -12.05].forEach(function (z) { if (L.model("bookcase", X1 - 0.3, MY, z, -PI / 2)) L.solid(X1 - 0.3, z, 0.42, 1.2, MY, MY + 2.3); }); if (L.model("lounge_chair", 7.6, MY, -11.2, -2.3)) L.seat(7.6, -11.2, 0.62, 0.62, MY + 0.46, -2.3);
    L.light(0xffe0b8, 1.1, 9, 4.6, MY + 2.3, -12.0);
    var n1 = roomNote("suite"), n2 = roomNote("office"); L.hot(bx, MY, bz + 2.3, 1.8, "info", { t: n1.t, k: n1.k, p: n1.p, prompt: "about the mezzanine suite" }); L.hot(4.6, MY, -10.9, 1.6, "info", { t: n2.t, k: n2.k, p: n2.p, prompt: "about the office" }); }
  function homeWing(L, B) { var K = L.K, FW = B.FW, X1 = B.X1, WX = B.WX1, M = mats();
    // the entry gallery: a console and mirror by the door, the wine wall, art, a bench, a planter; recessed lights
    K.bb("walnut", WX - 0.45, FW + 0.8, 7.4, WX, FW + 0.86, 9.6); K.bb("bronze", WX - 0.42, FW, 7.45, WX - 0.38, FW + 0.8, 7.5); K.bb("bronze", WX - 0.42, FW, 9.5, WX - 0.38, FW + 0.8, 9.55); K.quad("mirror", 1.9, 1.2, WX - 0.02, FW + 1.75, 8.5, -PI / 2); K.cyl("shade", 0.08, 0.14, 0.2, WX - 0.22, FW + 1.2, 9.2, 14); K.cyl("brass", 0.01, 0.01, 0.3, WX - 0.22, FW + 0.98, 9.2, 4); L.solid(WX - 0.22, 8.5, 0.45, 2.2, FW, FW + 0.86);
    K.bb("walnut", WX - 0.4, FW, 0.6, WX, FW + 3.4, 5.6); K.quad("wine", 4.8, 3.2, WX - 0.41, FW + 1.7, 3.1, -PI / 2); K.bb("strip", WX - 0.44, FW + 3.3, 0.7, WX - 0.4, FW + 3.34, 5.5); L.solid(WX - 0.25, 3.1, 0.5, 5.0, FW, FW + 3.4);
    picture(L, "art1", WX - 0.03, B.F + 2.1, -3.2, 1.6, 1.2, -PI / 2, null, "walnut"); K.bb("tan", 11.0, B.F + 0.3, -5.15, 12.8, B.F + 0.46, -4.75); K.bb("walnut", 11.1, B.F, -5.1, 12.7, B.F + 0.3, -4.8); L.seat(11.9, -4.95, 1.8, 0.4, B.F + 0.46, 0);
    L.model("term_planter", 13.4, FW, 6.2, 0.5, 0.5); L.solid(13.4, 6.2, 1.0, 1.0, FW, FW + 1.0);
    for (var rz = -4.2; rz <= 9.6; rz += 2.3) K.cyl("lamp", 0.1, 0.1, 0.02, (X1 + WX) / 2, 5.19, rz, 16); L.light(0xffe6c8, 1.1, 10, (X1 + WX) / 2 + 0.6, 4.2, 6.5); L.light(0xffe6c8, 0.9, 9, (X1 + WX) / 2, 4.2, -1.0);
    // the open-house card on the porch
    var ek = "easel"; if (!M[ek]) M[ek] = new THREE.MeshStandardMaterial({ map: easelTex("OPEN HOUSE", "Hangar home · walk in"), emissiveMap: easelTex("OPEN HOUSE", "Hangar home · walk in"), emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.6 });
    K.quad(ek, 0.72, 0.99, 13.5, FW + 1.18, 12.62, 0.35); K.box("walnut", 0.05, 1.6, 0.05, 13.5 - 0.3, FW + 0.8, 12.55, 0.35, 0); K.box("walnut", 0.05, 1.6, 0.05, 13.5 + 0.3, FW + 0.8, 12.45, 0.35, 0); K.box("walnut", 0.05, 1.5, 0.05, 13.4, FW + 0.75, 12.2, 0.35, 0); L.solid(13.45, 12.45, 0.8, 0.5, FW, FW + 1.6, 0.35);
    var n = roomNote("entry"); L.hot(11.4, FW, 7.2, 2.4, "info", { t: n.t, k: n.k, p: n.p, prompt: "about the entry gallery" }); }
  TYPES.hangarhome2.build = buildHome;
  // @@HOME@@
  // @@REST@@
  // @@CLUB@@

  var R_BUILD = 34, R_DROP = 95, R_PREP = 120, R_STAGE = 70, R_NOW = 10;   // R5: inside R_BUILD the staged build gets 10 ms a frame; within R_NOW it is finished at once   // R_STAGE: the staged build starts (plan_perf.js budget); R_BUILD: finished at once
  function distTo(h, x, z) { return Math.hypot(h.e[0] - x, h.e[2] - z) - TYPES[h.kind].R * h.s; }
  function camInside(h) { var T = TYPES[h.kind], q = localP(h, camera.position.x, camera.position.z), cy = (camera.position.y - h.e[1]) / h.s; if (cy < -0.5 || cy > T.see[4]) return false; for (var i = 0; i < T.rooms.length; i++) { var r = T.rooms[i]; if (q[0] > r[0] && q[0] < r[2] && q[1] > r[1] && q[1] < r[3]) return true; } return false; }
  function frame(dt) {
    if (IN.off || !IN.list.length || !player) return; dt = Math.min(dt || 0.016, 0.1); var px = player.position.x, pz = player.position.z; var flying = false; try { flying = !!(FLY && FLY.on); } catch (e) {}
    if (!IN.patched) { IN.patched = true; for (var kk in TYPES) { try { patchShell(kk); } catch (e) { note("shell " + kk, e); } } try { for (var k2 in TYPES) { var di = DOOR_KINDS.indexOf(k2); if (di >= 0) DOOR_KINDS.splice(di, 1); } } catch (e) { note("door kinds", e); } }
    var best = null, bd = 1e9; for (var i = 0; i < IN.list.length; i++) { var h = IN.list[i]; var d = distTo(h, px, pz); if (d < bd) { bd = d; best = h; } } if (IN.active && best && best !== IN.active && !(inside && inside.int3)) { var dA = distTo(IN.active, px, pz); if (dA < bd * 1.15 + 3) { best = IN.active; bd = dA; } }   // R5: hysteresis (no rebuild at every midpoint between two buildings)
    IN.near = best; IN.nearD = bd;
    if (bd < R_PREP && !IN.pref && LAZY.length) { IN.pref = true; try { if (window.PLAN_LOAD_KINDS) window.PLAN_LOAD_KINDS(LAZY).then(function (ks) { IN.n.lazy = ks; }); } catch (e) { note("prefetch", e); } }
    var act = IN.active; var inMine = !!(inside && inside.int3);
    var SB = IN.sb; if (SB && (SB.h !== best || flying || inMine || bd > R_STAGE + 12)) { try { disposeInterior(SB.h); } catch (e) {} IN.sb = SB = null; }
    if (act && !inMine && (distTo(act, px, pz) > R_DROP || flying)) { disposeInterior(act); act = null; }
    if (best && !flying && (bd < R_NOW || (bd < R_BUILD && !(window.PLAN_PERF && PLAN_PERF.step))) && act !== best && !inMine) { if (act) disposeInterior(act); try { if (SB) { IN.sb = null; while (!SB.it.next().done); } else buildInterior(best); } catch (e) { note("build " + best.id, e); try { disposeInterior(best); } catch (x) {} } act = IN.active; }
    else if (best && !flying && bd < R_STAGE && act !== best && !inMine && window.PLAN_PERF && PLAN_PERF.step) { try { if (!SB) { if (act) { disposeInterior(act); act = null; } SB = IN.sb = { h: best, it: buildSteps(best) }; } if (PLAN_PERF.step(SB.it, bd < R_BUILD ? 10 : undefined).done) { IN.sb = null; act = IN.active; IN.n.staged = (IN.n.staged || 0) + 1; if (best.L) PLAN_PERF.warmGroup(best.L.g, { name: "int3 " + best.id }); } } catch (e) { note("stage " + best.id, e); IN.sb = null; try { disposeInterior(best); } catch (x) {} } }
    if (!act || !act.L) return; var L = act.L, T = TYPES[act.kind], D = T.door;
    // the doors: open as you walk up (from either side), shut when you walk away; E overrides until you leave the porch
    var dw = doorW(act), dd = Math.hypot(dw[0] - px, dw[2] - pz), lvl = Math.abs(player.position.y - dw[1]) < 2.2; if (L.door.manual !== null && dd > 7) L.door.manual = null;
    L.door.target = L.door.manual !== null ? (L.door.manual ? 1 : 0) : (dd < 4.4 && lvl ? 1 : 0); if (L.door.open !== L.door.target) { var sp = dt / 0.85; L.door.open = L.door.target > L.door.open ? Math.min(L.door.target, L.door.open + sp) : Math.max(L.door.target, L.door.open - sp); setDoors(L, L.door.open); } doorSolidOn(L, L.door.open < 0.55);
    if (L.hangar) hangarDoor(act, L, dt, px, pz);
    // walking in and out
    var q = localP(act, px, pz), ly = (player.position.y - act.e[1]) / act.s, inR = inRooms(T, q[0], q[1], -0.02) && ly > -0.6 && ly < T.see[4];
    if (!inside && inR && performance.now() - (inside_left_at || 0) > 350) myEnter(act);
    else if (inside && inside.int3 === act && !inRooms(T, q[0], q[1], 0.35)) myLeave();
    if (inside && inside.int3 && inside.int3 !== act) myLeave();
    // drawn only while you are in, the door is open or (a hangar home) the bay shows through its glass; the shell's cut follows
    var cin = camInside(act); var vis = !!(inside && inside.int3 === act) || L.door.open > 0.02 || (!!L.hangar && distTo(act, px, pz) < R_BUILD + 8) || cin; var U = shellU(act.kind).u;
    if (L.g.visible !== vis) { L.g.visible = vis; L.lights.forEach(function (l) { l.intensity = vis ? l.userData.k0 : 0; }); } U.uIntOn.value = vis ? 1 : 0; U.uIntCam.value = cin ? 1 : 0;
    if (!vis) return;
    var n = typeof night === "number" ? night : 0; if (IN.ao && Math.abs(n - (IN.aoN === undefined ? -1 : IN.aoN)) > 0.04) { IN.aoN = n; var av = Math.round((IN.aoK || 105) * (1 - 0.5 * n)); IN.ao.image.data[0] = IN.ao.image.data[1] = IN.ao.image.data[2] = av; IN.ao.needsUpdate = true; }
    if (MT) { MT.lamp.emissiveIntensity = 1.4 + 1.2 * n; MT.strip.emissiveIntensity = 0.9 + 0.8 * n; MT.shade.emissiveIntensity = 0.35 + 0.5 * n; MT.bottles.emissiveIntensity = 0.3 + 0.35 * n; MT.wine.emissiveIntensity = 0.25 + 0.35 * n; }
    L.t = (L.t || 0) + dt; L.anim.forEach(function (f) { try { f(dt, L.t, n); } catch (e) { note("anim", e); } });
    try { peopleFrame(L, dt); } catch (e) { if (!IN.pfErr) { IN.pfErr = 1; note("people", e); } }
    greet(L, dt);
  }
  function greet(L, dt) { L.cool = (L.cool || 8) - dt; if (L.cool > 0 || typeof npcSay !== "function") return; for (var i = 0; i < L.people.length; i++) { var P = L.people[i]; if (!P.talkId || !P.g) continue; var T = window.PLAN_TALK[P.talkId]; var wp = P.g.getWorldPosition(new THREE.Vector3()); if (T && T.greet && T.greet.length && Math.hypot(wp.x - player.position.x, wp.z - player.position.z) < 5.5) { try { npcSay({ g: P.g, name: T.name }, T.greet[Math.floor(Math.random() * T.greet.length)]); } catch (e) {} L.cool = 45 + Math.random() * 30; return; } } L.cool = 2; }
  function hangarDoor(h, L, dt, px, pz) { var H = L.hangar; var q = localP(h, px, pz); var near = q[1] > 7 && q[1] < 22 && q[0] > -11.5 && q[0] < 7.5 && Math.abs(player.position.y - h.e[1]) < 3; if (H.manual !== null && !near) H.manual = null; H.target = H.manual !== null ? (H.manual ? 1 : 0) : near ? 1 : 0;
    if (H.open !== H.target) { var sp = dt / 4.2; H.open = H.target > H.open ? Math.min(H.target, H.open + sp) : Math.max(H.target, H.open - sp); H.piv.rotation.x = -ease(H.open) * 1.45; } var on = H.open < 0.8, i = SOLIDS.indexOf(H.solid); if (H.solid) { if (on && i < 0) SOLIDS.push(H.solid); else if (!on && i >= 0) SOLIDS.splice(i, 1); } }

  // ───────────────────────── install: wrappers dispatch through IN.impl (a new copy of this file evaluated in a running page takes over) ─────────────────────────
  function listBuildings() { var out = []; var byE = new Map(); try { (window.PLAN_BLD || (typeof PLAN_BLD !== "undefined" ? PLAN_BLD : [])).forEach(function (r) { if (r && r.e) byE.set(r.e, r.b); }); } catch (e) {}
    for (var k in TYPES) { var list = PLACE[k] || []; if (!MODELS[k]) continue; list.forEach(function (e, i) { var b = byE.get(e) || {}; out.push({ kind: k, i: i, e: e, s: e[4] || 1, id: b.id || (k + i), name: b.name || "", L: null }); }); }
    var names = (sect("clubhouse").names || DEF.clubhouse.names); out.forEach(function (h) { if (h.kind === "clubhouse" && names[h.id]) h.name = names[h.id]; }); return out; }
  // the canvas surfaces are drawn one per idle slot after the world is built, so the first interior does not stall a frame
  function warm() { var q = [herringTex, ledgeTex, marbleTex, terraTex, concreteTex, epoxyTex, photoTex, function () { artTex(0); }, function () { artTex(1); }, function () { artTex(2); }, function () { rugTex(0); }, function () { rugTex(1); }, function () { rugTex(2); }, function () { bottlesTex(0); }, booksTex, wineTex, shopTex, flameTex, glowTex,
      function () { grainTex("walnut2", "#5c4431", "rgba(160,128,96,A)", "rgba(30,22,14,A)", 17); }, function () { grainTex("oak", "#a67d55", "rgba(222,190,150,A)", "rgba(92,62,36,A)", 29); }, function () { leatherTex("tan", "#9a6240"); }, function () { leatherTex("ox", "#6a3424"); }, mats]; var t0 = performance.now(), i = 0;
    var step = function () { if (i >= q.length) { IN.n.warmMs = Math.round(performance.now() - t0); return; } try { q[i++](); } catch (e) { note("warm", e); } if (window.requestIdleCallback) requestIdleCallback(step, { timeout: 1500 }); else setTimeout(step, 50); };
    try { if (window.requestIdleCallback) requestIdleCallback(step, { timeout: 3000 }); else setTimeout(step, 500); } catch (e) { note("warm", e); } }
  function install() {
    if (IN.installed) return; IN.installed = true; var o = IN.orig = { enterInterior: enterInterior, leaveInterior: leaveInterior, openNearest: openNearest, updateZone: updateZone };
    enterInterior = function (door) { if (door && TYPES[door.kind] && !IN.off) { var h = IN.list.find(function (q) { return q.kind === door.kind && q.i === door.i; }); if (h && h.L) return; } return o.enterInterior.apply(this, arguments); };
    leaveInterior = function () { if (inside && inside.int3) return IN.impl.leave(); return o.leaveInterior.apply(this, arguments); };
    openNearest = function () { if (IN.impl.handleE()) return; return o.openNearest.apply(this, arguments); };
    updateZone = function () { var r = o.updateZone.apply(this, arguments); IN.impl.prompt(); return r; };
  }
  // the client's leaveInterior (E at a door, fast travel, a teleport): step out at the door, or, when you are already
  // somewhere else (a teleport moved you first), just let go of the room
  function leave() { var h = inside && inside.int3; if (!h) return; var q = localP(h, player.position.x, player.position.z); if (!inRooms(TYPES[h.kind], q[0], q[1], 1.0)) return myLeave(); return stepOut(h); }
  IN.impl = { frame: frame, camHook: camHook, handleE: handleE, prompt: prompt, stepOut: stepOut, leave: leave };
  // tests: open or shut the active building's doors at once (t 0..1), the hangar home's glass door too; E-less
  IN.debug = { door: function (t, hangar) { var h = IN.active, L = h && h.L; if (!L) return null; L.door.manual = t > 0.5; L.door.target = L.door.open = t; setDoors(L, t); doorSolidOn(L, t < 0.55); if (L.hangar && hangar !== undefined) { L.hangar.manual = hangar > 0.5; L.hangar.open = L.hangar.target = hangar; L.hangar.piv.rotation.x = -ease(hangar) * 1.45; } return [L.door.open, L.hangar ? L.hangar.open : null]; },
    enter: function (lx, lz, yawL) { var h = IN.active; if (!h || !h.L) return null; var r = roomAt(h, l2w(h.e, lx * h.s, lz * h.s)[0], l2w(h.e, lx * h.s, lz * h.s)[1], h.e[1] + 9); var q = l2w(h.e, lx * h.s, lz * h.s); var fl = TYPES[h.kind].rooms[0][4]; var rr = inRooms(TYPES[h.kind], lx, lz, 0); player.position.set(q[0], h.e[1] + (rr ? rr[4] : fl) * h.s, q[1]); if (yawL !== undefined) yaw = h.e[3] + yawL; if (!inside) myEnter(h); return !!(inside && inside.int3); } };
  IN.api = { build: buildInterior, dispose: disposeInterior, l2w: l2w, w2l: w2l, localP: localP, roomAt: roomAt, porchOf: porchOf, patchShell: patchShell, shellU: shellU, mats: mats, TYPES: TYPES, refreshTalk: refreshTalk, myEnter: myEnter, myLeave: myLeave, install: install, list: listBuildings, stepOut: stepOut };
  (function hookAll() {
    var set = function (phase, name, fn) { var list = window.PLAN_HOOKS[phase]; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name: name, fn: fn }); };
    set("world", "int3World", function () { if (IN.off || !window.PLAN) return; install(); });
    set("defer", "int3Defer", function () { if (IN.off || !window.PLAN) return; try { IN.list = listBuildings(); IN.n.buildings = IN.list.length; } catch (e) { note("list", e); } warm(); });
    set("frame", "int3Frame", function (dt) { try { IN.impl.frame(dt); } catch (e) { note("frame", e); } });
    set("interior", "int3Cam", function (dt) { return IN.impl.camHook(dt); });
  })();
  if (IN.installed && window.PLAN && typeof PLACE !== "undefined") { try { if (IN.active) { var a0 = IN.active; if (inside && inside.int3) inside = null; disposeInterior(a0); } IN.list = listBuildings(); for (var kt in MX) delete MX[kt]; } catch (e) { note("reload", e); } }
  // @@END@@
})();
