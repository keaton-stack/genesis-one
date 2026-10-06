// R8 SOLAR PARK (2 Oct 2026): the Solar Cart Park, the Shuttle Hub and the Market Garden of the Solport Convention Center campus,
// on the strip between the Market Hall's south wall (z 46) and the backs of the Flight Line Market shops (z 131), x -470..-138.
//   - the Solar Cart Park (x -466..-244): five rows of steel solar carport canopies (mono-slope, dark PV modules with frames, LED
//     downlights after dark), 448 painted bays on asphalt, accessible and EV bays, 70 EV charging pedestals, planted islands of palo
//     verde, mesquite and agave, about 230 parked golf carts (the game's own cart model, two to a bay, three clustered LODs, colour and canopy
//     per cart, many on charge) and about ten cars (three generated models) in the accessible bays and by the connector.
//   - the Shuttle Hub (x -466..-433): a drop-off loop round a transit island with a branded shelter, benches, the Grand Loop route
//     map, a live arrivals board (next shuttle to the FBO, Main Street, the Commons and the Convention Center), cart and bike share.
//     The Grand Loop shuttle is re-routed at run time (planRoute is wrapped) to call here and at the Convention Center drop-off.
//   - the Market Garden (x -244..-138): raised timber and corten beds of peppers, squash, herbs, corn and greens, a citrus,
//     pomegranate and olive orchard, a hoop greenhouse, the farm stand (buy produce), a tool shed, compost bins, a chicken coop,
//     shade trellises, drip lines; Marisol the farmer.
// Classic script, loaded before client.js; hooks into window.PLAN_HOOKS { terrain, world, defer, frame, interior }. Every name, line
// of copy and number: plan/solarpark.json. ?solar=0 turns the module off. window.PLAN_SOLAR: n (counters), errs, cfg, site, api, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var SP = window.PLAN_SOLAR = window.PLAN_SOLAR || {};
  SP.errs = SP.errs || []; SP.n = SP.n || {}; SP.ver = "r8";
  if (/[?&]solar=0\b/.test(location.search)) { SP.off = true; return; }
  { var NEED = window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || []; ["chicken", "bike1", "bike2", "cart"].forEach(function (k) { if (NEED.indexOf(k) < 0) NEED.push(k); }); }
  var PI = Math.PI, TAU = PI * 2;
  function note(tag, e) { try { if (SP.errs.length < 50) SP.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (SP.errs.length <= 6) console.warn("plan_solarpark " + tag, e); } catch (x) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function nowMs() { return performance.now(); }
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function gh(x, z) { try { return getH(x, z); } catch (e) { return 0; } }
  function has(k) { try { return !!(MODELS[k] && (MODELS[k].parts || MODELS[k]._pp)); } catch (e) { return false; } }
  function canPut(k) { try { return has(k) && !!MODEL_SPECS[k]; } catch (e) { return false; } }
  function $id(id) { return document.getElementById(id); }
  function rectDist(x, z, x0, x1, z0, z1) { var dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1); return Math.sqrt(dx * dx + dz * dz); }
  function inPoly(poly, x, z) { var c = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }

  // ───────────────────────── config: plan/solarpark.json ─────────────────────────
  var CFG = SP.cfg || null;
  function cfgUrl() { var u = "/plan/solarpark.json?v=" + (window.BUILD || "dev"); try { if (window.AV) u = window.AV(u); } catch (e) {} return u; }
  if (!CFG) { try { fetch(cfgUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && !CFG) CFG = SP.cfg = d; }).catch(function (e) { note("cfg fetch", e); }); } catch (e) { note("cfg", e); } }
  function cfg() { if (CFG) return CFG; try { var x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = SP.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); } return CFG; }
  function C(path, dflt) { var o = cfg(); if (!o) return dflt; var p = path.split("."); for (var i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }

  // ───────────────────────── geometry kit: parts by base material, vertex colours, merged once ─────────────────────────
  var _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _c = new THREE.Color();
  // metres per texture repeat for the textured bases (planar uv by the dominant axis); 0 = keep the geometry's uv
  var TILE = { wood: 1.2, corten: 1.6, conc: 2.0 };
  function Kit() { this.m = {}; this.tris = 0; }
  Kit.prototype.add = function (base, g, col, keepUv) {
    if (g.index) g = g.toNonIndexed(); if (!g.attributes.normal) g.computeVertexNormals();
    var n = g.attributes.position.count, P = g.attributes.position.array, t = TILE[base];
    if (t && !keepUv) { var U = new Float32Array(n * 2); for (var f = 0; f < n; f += 3) { var ax = P[f * 3], ay = P[f * 3 + 1], az = P[f * 3 + 2]; var e1x = P[f * 3 + 3] - ax, e1y = P[f * 3 + 4] - ay, e1z = P[f * 3 + 5] - az, e2x = P[f * 3 + 6] - ax, e2y = P[f * 3 + 7] - ay, e2z = P[f * 3 + 8] - az; var nx = Math.abs(e1y * e2z - e1z * e2y), ny = Math.abs(e1z * e2x - e1x * e2z), nz = Math.abs(e1x * e2y - e1y * e2x);
        for (var k = 0; k < 3; k++) { var i = f + k, x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; if (ny >= nx && ny >= nz) { U[i * 2] = x / t; U[i * 2 + 1] = z / t; } else if (nx >= nz) { U[i * 2] = z / t; U[i * 2 + 1] = y / t; } else { U[i * 2] = x / t; U[i * 2 + 1] = y / t; } } }
      g.setAttribute("uv", new THREE.BufferAttribute(U, 2)); }
    else if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!(col === null && g.attributes.color)) { var Cc = new Float32Array(n * 3); _c.set(col === undefined || col === null ? 0xffffff : col); for (var j = 0; j < n; j++) { Cc[j * 3] = _c.r; Cc[j * 3 + 1] = _c.g; Cc[j * 3 + 2] = _c.b; } g.setAttribute("color", new THREE.BufferAttribute(Cc, 3)); }
    for (var a in g.attributes) if (a !== "position" && a !== "normal" && a !== "uv" && a !== "color") g.deleteAttribute(a);
    (this.m[base] || (this.m[base] = [])).push(g); this.tris += n / 3; return g;
  };
  function xf(g, x, y, z, ry, rx, rz, sx, sy, sz) { _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(x || 0, y || 0, z || 0), _q, _v2.set(sx || 1, sy || 1, sz || 1)); g.applyMatrix4(_m4); return g; }
  // a box with its base at y0 (w along x, d along z), turned ry about its own centre
  Kit.prototype.box = function (base, col, w, h, d, x, y0, z, ry, rx, rz) { if (!(w > 0 && h > 0 && d > 0)) return null; var g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); return this.add(base, xf(g, x, y0, z, ry, rx, rz), col); };
  Kit.prototype.aab = function (base, col, x0, x1, y0, y1, z0, z1) { return this.box(base, col, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, Math.min(y0, y1), (z0 + z1) / 2); };
  Kit.prototype.cyl = function (base, col, r0, r1, h, x, y0, z, seg, ry, rx, rz, open) { var g = new THREE.CylinderGeometry(r0, r1, h, seg || 10, 1, !!open); g.translate(0, h / 2, 0); return this.add(base, xf(g, x, y0, z, ry, rx, rz), col); };
  Kit.prototype.sph = function (base, col, r, x, y, z, seg, sx, sy, sz) { var g = new THREE.SphereGeometry(r, seg || 8, Math.max(4, (seg || 8) >> 1)); return this.add(base, xf(g, x, y, z, 0, 0, 0, sx, sy, sz), col); };
  Kit.prototype.ico = function (base, col, r, x, y, z, sx, sy, sz, ry, det) { var g = new THREE.IcosahedronGeometry(r, det || 0); return this.add(base, xf(g, x, y, z, ry || 0, 0, 0, sx, sy, sz), col); };
  Kit.prototype.lathe = function (base, col, prof, x, y0, z, seg, sx, sz) { var pts = prof.map(function (p) { return new THREE.Vector2(Math.max(0.0001, p[0]), p[1]); }); var g = new THREE.LatheGeometry(pts, seg || 12); return this.add(base, xf(g, x, y0, z, 0, 0, 0, sx || 1, 1, sz || sx || 1), col); };
  // a quad (w x h) centred at (x, y, z), its face toward +z before the rotation (ry, then rx)
  Kit.prototype.quad = function (base, col, w, h, x, y, z, ry, rx, uv) { var g = new THREE.PlaneGeometry(w, h); if (uv) { var u = g.attributes.uv; for (var i = 0; i < u.count; i++) u.setXY(i, lerp(uv[0], uv[2], u.getX(i)), lerp(uv[1], uv[3], u.getY(i))); } return this.add(base, xf(g, x, y, z, ry, rx), col, !!uv); };
  // a beam (box) from A to B, cross section w (sideways, horizontal) x d (up of the beam)
  Kit.prototype.beam = function (base, col, A, B, w, d) { var dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L = Math.sqrt(dx * dx + dy * dy + dz * dz); if (L < 1e-4) return null; var g = new THREE.BoxGeometry(w, d, L); _v1.set(dx / L, dy / L, dz / L); var up = Math.abs(_v1.y) > 0.95 ? _v3.set(1, 0, 0) : _v3.set(0, 1, 0); _m4.lookAt(_v2.set(0, 0, 0), _v1, up); _q.setFromRotationMatrix(_m4); _m4.compose(_v2.set((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2), _q, _v3.set(1, 1, 1)); g.applyMatrix4(_m4); return this.add(base, g, col); };
  Kit.prototype.tube = function (base, col, A, B, r, seg) { var dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L = Math.sqrt(dx * dx + dy * dy + dz * dz); if (L < 1e-4) return null; var g = new THREE.CylinderGeometry(r, r, L, seg || 5, 1, true); _v1.set(dx / L, dy / L, dz / L); _q.setFromUnitVectors(_v2.set(0, 1, 0), _v1); _m4.compose(_v3.set((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2), _q, _v2.set(1, 1, 1)); g.applyMatrix4(_m4); return this.add(base, g, col); };
  // a triangle list ([x, y, z] corners), optional uv per corner
  Kit.prototype.tris3 = function (base, col, pts, uvs) { var g = new THREE.BufferGeometry(); var a = new Float32Array(pts.length * 3); for (var i = 0; i < pts.length; i++) { a[i * 3] = pts[i][0]; a[i * 3 + 1] = pts[i][1]; a[i * 3 + 2] = pts[i][2]; } g.setAttribute("position", new THREE.BufferAttribute(a, 3)); if (uvs) { var u = new Float32Array(uvs.length * 2); for (var j = 0; j < uvs.length; j++) { u[j * 2] = uvs[j][0]; u[j * 2 + 1] = uvs[j][1]; } g.setAttribute("uv", new THREE.BufferAttribute(u, 2)); } g.computeVertexNormals(); return this.add(base, g, col, !!uvs); };
  // a quad a-b-c-d facing the side of `up` (a direction), uv per corner optional
  Kit.prototype.face = function (base, col, a, b, c, d, out, ua, ub, uc, ud) { var e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; var n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; var flip = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0;
    var P = flip ? [a, d, c, a, c, b] : [a, b, c, a, c, d], U = ua ? (flip ? [ua, ud, uc, ua, uc, ub] : [ua, ub, uc, ua, uc, ud]) : null; return this.tris3(base, col, P, U); };
  Kit.prototype.mark = function () { var o = {}; for (var k in this.m) o[k] = this.m[k].length; return o; };
  Kit.prototype.since = function (mk, fn) { for (var k in this.m) for (var i = mk[k] || 0; i < this.m[k].length; i++) fn(this.m[k][i], k); };
  // place everything added since mark: turn ry about (0,0,0), then move to (x, y, z)
  Kit.prototype.place = function (mk, x, y, z, ry, s) { _e.set(0, ry || 0, 0); _q.setFromEuler(_e); var M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(s || 1, s || 1, s || 1)); this.since(mk, function (g) { g.applyMatrix4(M); }); };
  function mergeList(list) {
    var n = 0; list.forEach(function (g) { n += g.attributes.position.count; }); if (!n) return null;
    var P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), Cc = new Float32Array(n * 3), o = 0;
    list.forEach(function (g) { var c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); U.set(g.attributes.uv.array, o * 2); Cc.set(g.attributes.color.array, o * 3); o += c; g.dispose(); });
    var r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(U, 2)); r.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
    r.computeBoundingBox(); r.computeBoundingSphere(); return r;
  }
  Kit.prototype.merged = function () { var out = {}; for (var k in this.m) { var g = mergeList(this.m[k]); if (g) out[k] = g; } this.m = {}; return out; };
  // a frame at (x, y, z) turned yaw: local x across, local z toward the front (the client's convention: world = c + R(yaw) local)
  function Fr(x, y, z, yaw) { this.x = x; this.y = y; this.z = z; this.yaw = yaw || 0; this.c = Math.cos(this.yaw); this.s = Math.sin(this.yaw); }
  Fr.prototype.w = function (lx, lz) { return [this.x + lx * this.c + lz * this.s, this.z - lx * this.s + lz * this.c]; };

  // ───────────────────────── materials: few bases shared by everything (stable programs) ─────────────────────────
  // std / metal: untextured vertex-colour PBR (one program). wood and corten: textured with normal and roughness maps (the market's
  // timber program). pv: the solar modules (one drawn texture: front cells and the white backsheet). glow: unlit (LEDs, screens).
  // mark: painted bay lines and symbols (alpha tested). pool: additive light pools after dark. blob: soft contact shadows under cars.
  // glass: greenhouse glazing and the shelter's glass (single pass). sign: the drawn sign atlas. board: the live arrivals board.
  var MAT = SP.mat = {}, WARM = new THREE.Color(0xffa24e);
  function canvasTex(name, w, h, draw, rep) { var c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = rep === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.name = name; return t; }
  function tl(p) { try { return tiled(p, 1, 1); } catch (e) { return null; } }
  function texMat(name, nk, rough, metal, map0, nrm) {
    var nb = nrm || name, map = map0 || tl("/tex/" + name + ".jpg"), m = new THREE.MeshStandardMaterial({ map: map, normalMap: tl("/tex/" + nb + "_n.jpg"), roughnessMap: tl("/tex/" + nb + "_r.jpg"), emissiveMap: map, emissive: WARM.clone(), emissiveIntensity: 0, vertexColors: true, roughness: rough || 1, metalness: metal || 0 });
    if (m.normalScale) m.normalScale.set(nk || 0.7, nk || 0.7); m.name = "sp_" + name; m.envMapIntensity = 0.6; return m;
  }
  // one PV module, 1.04 m across x 1.72 m along the slope: 6 x 10 monocrystalline cells (black-blue, the small white diamonds at the
  // cell corners, three silver busbars), an anodised frame; the right half of the canvas is the backsheet seen from below (white
  // film, the frame, the junction box and its two leads)
  function pvTex() { return canvasTex("sp_pv", 512, 424, function (x, W, H) { var R = rng(4040), w = W / 2; x.fillStyle = "#b9bec2"; x.fillRect(0, 0, w, H); x.fillStyle = "#0b1018"; x.fillRect(5, 5, w - 10, H - 10);
      var cw = (w - 14) / 6, ch = (H - 14) / 10; for (var i = 0; i < 6; i++) for (var j = 0; j < 10; j++) { var cx = 7 + i * cw, cy = 7 + j * ch; var g = x.createLinearGradient(cx, cy, cx + cw, cy + ch), b = 22 + R() * 10; g.addColorStop(0, "rgb(" + (b * 0.5 | 0) + "," + (b * 0.65 | 0) + "," + (b * 1.35 | 0) + ")"); g.addColorStop(1, "rgb(" + (b * 0.35 | 0) + "," + (b * 0.45 | 0) + "," + (b * 1.05 | 0) + ")"); x.fillStyle = g; x.fillRect(cx + 0.8, cy + 0.8, cw - 1.6, ch - 1.6);
        x.fillStyle = "rgba(205,212,222,0.55)"; [0.25, 0.5, 0.75].forEach(function (f) { x.fillRect(cx + cw * f - 0.5, cy + 1, 1, ch - 2); }); x.fillStyle = "rgba(130,140,155,0.22)"; for (var k = 1; k < 7; k++) x.fillRect(cx + 1, cy + ch * k / 7, cw - 2, 0.6);
        x.fillStyle = "#d9dee4"; [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]].forEach(function (q) { x.beginPath(); x.moveTo(q[0] - 2.4, q[1]); x.lineTo(q[0], q[1] - 2.4); x.lineTo(q[0] + 2.4, q[1]); x.lineTo(q[0], q[1] + 2.4); x.closePath(); x.fill(); }); }
      x.strokeStyle = "#8d949a"; x.lineWidth = 2; x.strokeRect(4, 4, w - 8, H - 8);
      // backsheet
      x.fillStyle = "#9aa1a6"; x.fillRect(w, 0, w, H); x.fillStyle = "#e9ebe8"; x.fillRect(w + 6, 6, w - 12, H - 12); x.fillStyle = "rgba(0,0,0,0.05)"; for (var r = 0; r < 10; r++) x.fillRect(w + 6, 6 + r * (H - 12) / 10, w - 12, 1); x.fillStyle = "#2a2c2e"; x.fillRect(w + w / 2 - 22, 40, 44, 26); x.strokeStyle = "#1a1b1c"; x.lineWidth = 3; x.beginPath(); x.moveTo(w + w / 2 - 14, 66); x.quadraticCurveTo(w + w / 2 - 40, 140, w + w / 2 - 30, 220); x.moveTo(w + w / 2 + 14, 66); x.quadraticCurveTo(w + w / 2 + 40, 140, w + w / 2 + 30, 220); x.stroke(); }, false); }
  // painted markings atlas (512 x 512, 4 x 4 cells): white, blue, accessible symbol, EV symbol, arrow, hatch, green, yellow
  var MK_CELL = { white: 0, blue: 1, acc: 2, ev: 3, arrow: 4, hatch: 5, green: 6, yellow: 7, zebra: 8, mesh: 9 };
  function markUV(k) { var i = MK_CELL[k] || 0, cx = i % 4, cy = Math.floor(i / 4); var e = 0.004; return [cx / 4 + e, 1 - (cy + 1) / 4 + e, (cx + 1) / 4 - e, 1 - cy / 4 - e]; }
  function markTex() { return canvasTex("sp_marks", 512, 512, function (x, W) { var S = W / 4; var cell = function (k, fn) { var i = MK_CELL[k], cx = (i % 4) * S, cy = Math.floor(i / 4) * S; x.save(); x.translate(cx, cy); x.beginPath(); x.rect(0, 0, S, S); x.clip(); fn(); x.restore(); };
      x.clearRect(0, 0, W, W);
      var worn = function (col) { x.fillStyle = col; x.fillRect(0, 0, S, S); var R = rng(77); for (var i = 0; i < 260; i++) { x.fillStyle = "rgba(0,0,0," + (0.05 + R() * 0.12) + ")"; x.fillRect(R() * S, R() * S, 1 + R() * 3, 1 + R() * 2); } };
      cell("white", function () { worn("#ecebe4"); }); cell("blue", function () { worn("#2a5fa8"); }); cell("green", function () { worn("#3f9a5a"); }); cell("yellow", function () { worn("#e3b93a"); });
      cell("acc", function () { worn("#2a5fa8"); x.strokeStyle = "#f2f2ee"; x.fillStyle = "#f2f2ee"; x.lineWidth = 9; x.lineCap = "round"; x.beginPath(); x.arc(S * 0.47, S * 0.24, 9, 0, TAU); x.fill(); x.beginPath(); x.moveTo(S * 0.45, S * 0.34); x.lineTo(S * 0.43, S * 0.58); x.lineTo(S * 0.66, S * 0.58); x.lineTo(S * 0.74, S * 0.78); x.stroke(); x.beginPath(); x.arc(S * 0.42, S * 0.66, S * 0.17, -1.1, 2.3); x.stroke(); x.beginPath(); x.moveTo(S * 0.45, S * 0.44); x.lineTo(S * 0.62, S * 0.44); x.stroke(); });
      cell("ev", function () { worn("#3f9a5a"); x.fillStyle = "#f2f2ee"; x.font = "800 " + (S * 0.36 | 0) + "px 'Space Grotesk', system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("EV", S / 2, S * 0.36); x.beginPath(); x.moveTo(S * 0.55, S * 0.56); x.lineTo(S * 0.4, S * 0.76); x.lineTo(S * 0.5, S * 0.76); x.lineTo(S * 0.44, S * 0.94); x.lineTo(S * 0.62, S * 0.7); x.lineTo(S * 0.52, S * 0.7); x.lineTo(S * 0.58, S * 0.56); x.closePath(); x.fill(); });
      cell("arrow", function () { x.fillStyle = "#ecebe4"; x.beginPath(); x.moveTo(S * 0.5, S * 0.04); x.lineTo(S * 0.82, S * 0.4); x.lineTo(S * 0.6, S * 0.4); x.lineTo(S * 0.6, S * 0.96); x.lineTo(S * 0.4, S * 0.96); x.lineTo(S * 0.4, S * 0.4); x.lineTo(S * 0.18, S * 0.4); x.closePath(); x.fill(); });
      cell("hatch", function () { x.strokeStyle = "#ecebe4"; x.lineWidth = 9; for (var i = -S; i < 2 * S; i += 26) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + S, S); x.stroke(); } x.lineWidth = 10; x.strokeRect(0, 0, S, S); });
      cell("mesh", function () { x.strokeStyle = "#e4e7e4"; x.lineWidth = 0.9; var st = S / 13; for (var i = -13; i <= 26; i++) { x.beginPath(); x.moveTo(i * st, 0); x.lineTo(i * st + S, S); x.stroke(); x.beginPath(); x.moveTo(i * st + S, 0); x.lineTo(i * st, S); x.stroke(); } x.lineWidth = 5; x.beginPath(); x.moveTo(0, 2); x.lineTo(S, 2); x.moveTo(0, S - 2); x.lineTo(S, S - 2); x.stroke(); });
      cell("zebra", function () { x.fillStyle = "#ecebe4"; for (var i = 0; i < 4; i++) x.fillRect(i * S / 4 + 4, 0, S / 8, S); }); }, false); }
  // soft round light pool and contact shadow (alpha from a radial falloff)
  function radialTex(name, inner, outer) { return canvasTex(name, 128, 128, function (x, W) { var g = x.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2); g.addColorStop(0, inner); g.addColorStop(0.55, inner.replace(/[\d.]+\)$/, "0.45)")); g.addColorStop(1, outer); x.fillStyle = g; x.fillRect(0, 0, W, W); }, false); }
  // corten: a rust ramp with mottling and vertical run-off streaks (on the market's normal map)
  function cortenTex() { return canvasTex("sp_corten", 512, 512, function (x, N) { var R = rng(919); x.fillStyle = "#8a4523"; x.fillRect(0, 0, N, N); for (var i = 0; i < 2600; i++) { var r = 2 + R() * 18, c = R() < 0.5 ? "rgba(" + (110 + R() * 50 | 0) + "," + (50 + R() * 26 | 0) + "," + (22 + R() * 14 | 0) + "," + (0.12 + R() * 0.2) + ")" : "rgba(" + (60 + R() * 30 | 0) + "," + (28 + R() * 14 | 0) + "," + (16 + R() * 8 | 0) + "," + (0.1 + R() * 0.18) + ")"; x.fillStyle = c; x.beginPath(); x.ellipse(R() * N, R() * N, r, r * (0.5 + R()), R() * 3, 0, TAU); x.fill(); }
      for (var k = 0; k < 120; k++) { x.fillStyle = "rgba(70,32,16," + (0.08 + R() * 0.1) + ")"; x.fillRect(R() * N, R() * N * 0.4, 1 + R() * 2, 40 + R() * 160); } }); }
  // asphalt: dark binder, light aggregate, a few patches and fine cracks (tiles every 6 m)
  function asphaltTex() { return canvasTex("sp_asphalt", 512, 512, function (x, N) { var R = rng(2718); x.fillStyle = "#3d3f42"; x.fillRect(0, 0, N, N);
      for (var i = 0; i < 26; i++) { var g = x.createRadialGradient(R() * N, R() * N, 0, R() * N, R() * N, 40 + R() * 90); g.addColorStop(0, "rgba(" + (R() < 0.5 ? "70,72,75" : "48,50,52") + ",0.35)"); g.addColorStop(1, "rgba(60,60,60,0)"); x.fillStyle = g; x.fillRect(0, 0, N, N); }
      for (var k = 0; k < 26000; k++) { var l = R(); var gv = 95 + R() * 60 | 0; x.fillStyle = l < 0.55 ? "rgba(" + gv + "," + gv + "," + (gv - 4) + "," + (0.18 + R() * 0.3) + ")" : "rgba(24,25,27," + (0.3 + R() * 0.4) + ")"; var s = 0.6 + R() * 1.3; x.fillRect(R() * N, R() * N, s, s); }
      x.strokeStyle = "rgba(20,20,22,0.5)"; x.lineWidth = 1; for (var c = 0; c < 7; c++) { var px = R() * N, py = R() * N; x.beginPath(); x.moveTo(px, py); for (var j = 0; j < 7; j++) { px += (R() - 0.5) * 50; py += (R() - 0.5) * 50; x.lineTo(px, py); } x.stroke(); } }); }
  function mats() {
    if (MAT.ready) return MAT; MAT.ready = true;
    MAT.std = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: 0.6 }); MAT.std.name = "sp_std";
    MAT.metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.6, envMapIntensity: 0.8 }); MAT.metal.name = "sp_metal";
    MAT.wood = texMat("wood", 0.6, 0.9); MAT.corten = texMat("corten", 0.6, 0.78, 0.25, cortenTex(), "rock");
    var pv = SP.pvTex = pvTex(); MAT.pv = new THREE.MeshStandardMaterial({ map: pv, vertexColors: true, roughness: 0.2, metalness: 0.3, envMapIntensity: 1.1 }); MAT.pv.name = "sp_pv";
    MAT.glow = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff }); MAT.glow.name = "sp_glow";
    MAT.mark = new THREE.MeshStandardMaterial({ map: markTex(), alphaTest: 0.5, vertexColors: true, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }); MAT.mark.name = "sp_mark";
    MAT.pool = new THREE.MeshBasicMaterial({ map: radialTex("sp_pool", "rgba(255,255,255,1)", "rgba(255,255,255,0)"), vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); MAT.pool.name = "sp_pool";
    MAT.blob = new THREE.MeshBasicMaterial({ map: radialTex("sp_blob", "rgba(0,0,0,0.85)", "rgba(0,0,0,0)"), color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); MAT.blob.name = "sp_blob";
    MAT.glass = new THREE.MeshStandardMaterial({ color: 0xd2e8ee, roughness: 0.05, metalness: 0.25, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, emissive: new THREE.Color(0xff8a3a), emissiveIntensity: 0, envMapIntensity: 0.7 }); MAT.glass.name = "sp_glass"; MAT.glass.forceSinglePass = true;
    MAT.poly = MAT.glass.clone(); MAT.poly.name = "sp_poly"; MAT.poly.color.setHex(0xdfe6dc); MAT.poly.opacity = 0.5; MAT.poly.roughness = 0.55; MAT.poly.emissive.setHex(0xffd9a0);
    var fol = tl("/tex/mkt_foliage.png"); if (fol) { fol.wrapS = fol.wrapT = THREE.ClampToEdgeWrapping; } MAT.leaf = new THREE.MeshStandardMaterial({ map: fol, alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, roughness: 0.78, metalness: 0, envMapIntensity: 0.45 }); MAT.leaf.name = "sp_leaf";
    var PMs = null; try { PMs = planMats(); } catch (e) {} SP.pm = PMs;
    var gsp = tl("/tex/sp_garden.png"); if (gsp) { gsp.wrapS = gsp.wrapT = THREE.ClampToEdgeWrapping; gsp.anisotropy = 4; } MAT.crop = new THREE.MeshStandardMaterial({ map: gsp, alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, roughness: 0.78, metalness: 0, envMapIntensity: 0.45 }); MAT.crop.name = "sp_crop";
    MAT.sign = new THREE.MeshStandardMaterial({ map: atlas().tex, emissiveMap: atlas().tex, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.55, metalness: 0.1 }); MAT.sign.name = "sp_sign";
    
    var gnd = function (src, col, name) { var m = src ? src.clone() : new THREE.MeshStandardMaterial({ color: col }); if (col !== undefined && col !== null) m.color.setHex(col); m.name = name; m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1; return m; };
    MAT.asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex(), color: 0xffffff, roughness: 0.93, metalness: 0, envMapIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }); MAT.asphalt.name = "sp_asphalt"; MAT.dg = gnd(PMs && PMs.dg, 0xd6bf98, "sp_dg"); MAT.stone = gnd(PMs && PMs.stone, 0xe2cfb2, "sp_stone"); MAT.soil = gnd(PMs && PMs.bed, 0x6a5040, "sp_soil"); MAT.gsoil = gnd(PMs && PMs.dg, 0xb89c78, "sp_gsoil"); MAT.soilq = gnd(PMs && PMs.bed, 0x3a2a1e, "sp_bedsoil"); MAT.soilq.polygonOffset = false; MAT.mulch = gnd(PMs && PMs.bed, 0x5a4636, "sp_mulch");
    return MAT;
  }

  // ───────────────────────── the sign atlas (one canvas, one texture): hub, park, garden, chargers, menus, route map ─────────────────────────
  var ATL = null, ATW = 2048, ATH = 2048;
  function atlas() { if (ATL) return ATL; var c = document.createElement("canvas"); c.width = ATW; c.height = ATH; var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.name = "sp_atlas"; ATL = { cv: c, x: c.getContext("2d"), tex: t, slots: {}, cx: 0, cy: 0, rowH: 0 }; ATL.x.fillStyle = "#222"; ATL.x.fillRect(0, 0, ATW, ATH); return ATL; }
  // a slot of w x h px packed in rows; draw(x, w, h) in slot space; returns [u0, v0, u1, v1]
  function slot(key, w, h, draw0, dw, dh) { var draw = dw ? function (x) { x.scale(w / dw, h / dh); draw0(x, dw, dh); } : draw0; var A = atlas(); if (A.slots[key]) return A.slots[key].uv; if (A.cx + w > ATW) { A.cx = 0; A.cy += A.rowH + 2; A.rowH = 0; } if (A.cy + h > ATH) { note("atlas", "full at " + key); return [0, 0, 0.01, 0.01]; }
    var sx = A.cx, sy = A.cy; A.cx += w + 2; A.rowH = Math.max(A.rowH, h); var x = A.x; x.save(); x.translate(sx, sy); x.beginPath(); x.rect(0, 0, w, h); x.clip(); try { draw(x, w, h); } catch (e) { note("slot " + key, e); } x.restore(); A.tex.needsUpdate = true;
    var uv = [(sx + 1) / ATW, 1 - (sy + h - 1) / ATH, (sx + w - 1) / ATW, 1 - (sy + 1) / ATH]; A.slots[key] = { uv: uv, sx: sx, sy: sy, w: w, h: h, draw: draw }; return uv; }
  function redraw(key) { var A = atlas(), s = A.slots[key]; if (!s) return; var x = A.x; x.save(); x.translate(s.sx, s.sy); x.beginPath(); x.rect(0, 0, s.w, s.h); x.clip(); try { s.draw(x, s.w, s.h); } catch (e) {} x.restore(); A.tex.needsUpdate = true; }
  var SANS = "'Space Grotesk', 'Segoe UI', system-ui, sans-serif", DISP = "Anton, Impact, 'Arial Narrow', sans-serif", SERIF = "Fraunces, Georgia, serif";
  function txt(x, s, px, py, font, col, align, maxW, ls) { x.font = font; x.fillStyle = col; x.textAlign = align || "center"; x.textBaseline = "middle"; try { x.letterSpacing = (ls || 0) + "px"; } catch (e) {} if (maxW) { var w = x.measureText(s).width; if (w > maxW) { x.save(); x.translate(px, py); x.scale(maxW / w, 1); x.fillText(s, 0, 0); x.restore(); try { x.letterSpacing = "0px"; } catch (e) {} return; } } x.fillText(s, px, py); try { x.letterSpacing = "0px"; } catch (e) {} }
  function rrect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
  var LOGO = SP.logo || (SP.logo = { img: null, ok: false });
  function loadLogo() { if (LOGO.img) return; try { var im = new Image(); im.onload = function () { LOGO.ok = true; ["hubfascia", "parksign", "gardensign", "standsign"].forEach(redraw); }; im.src = "/tex/gb_logo.png"; LOGO.img = im; } catch (e) {} }
  // the GIVEBACK logo is 2:1: sized by its height only
  function logo(x, cx, cy, h) { var im = LOGO.img; if (!im || !LOGO.ok || !im.naturalWidth) return false; var w = h * im.naturalWidth / im.naturalHeight; x.drawImage(im, cx - w / 2, cy - h / 2, w, h); return true; }
  function signQuad(K, uv, w, h, x, y, z, ry) { return K.quad("sign", 0xffffff, w, h, x, y, z, ry || 0, 0, uv); }

  // ───────────────────────── the site: every dimension (world metres, x east, z south) ─────────────────────────
  // Car park rows run east-west: A single (cars nose north), B C D double (back to back under one canopy), E single (nose south);
  // aisles 1 to 4 between them; the drop-off loop is the west end of aisles 1 and 4 with its own west leg; the east cross aisle
  // closes the rows at x -247.5. Segments of eight 2.6 m bays (one canopy each) with 4.5 m planted islands between them.
  var S = SP.site = null;
  function site() {
    if (S) return S; var c = C("site", {}) || {};
    S = SP.site = {
      LIFT: 0.07, WLIFT: 0.06, ILIFT: 0.17,
      PX0: -466, PX1: -244, PZ0: 53.5, PZ1: 125.5,                // the asphalt (park + loop)
      WALK: { z0: 47.2, z1: 51.2, x0: -478, x1: -193 },             // the walk along the hall's south wall
      WEST: { x0: -478.5, x1: -473.5, z0: -22, z1: 51.2 },          // and round the hall's west end to the campus
      C1: { x: -452, w: 7, z0: 116.5, z1: 146.8 },                  // the connector to Flight Line Road (z 150)
      LEG: { x: -462.5, w: 7, z0: 59, z1: 120 },                     // the loop's west leg (one way, northbound): the shuttle bay
      WA: { x: -437, w: 7 }, EA: { x: -247.5, w: 7 },
      AISLES: [62.5, 80.5, 98.5, 116.5], AW: 7,
      ROWS: [{ id: "A", z0: 53.5, z1: 59, kind: "single", nose: -1 }, { id: "B", z0: 66, z1: 77, kind: "double" }, { id: "C", z0: 84, z1: 95, kind: "double" }, { id: "D", z0: 102, z1: 113, kind: "double" }, { id: "E", z0: 120, z1: 125.5, kind: "single", nose: 1 }],
      RX0: c.rx0 || -429.5, NSEG: c.nseg || 7, NBAY: 8, BAY: 2.6, ISL: 4.5,
      ISLAND: { x0: -459, x1: -440.5, z0: 66, z1: 113 },            // the transit island in the loop
      STOP: c.stop || [-462.5, 91],                                  // where the shuttle stops (west leg, beside the shelter)
      GX0: -244, GX1: -138, GZ0: 51.6, GZ1: 128,                     // the garden
      FENCE: [[-190, 47.2], [-190, 68.5], [-138, 68.5]],             // the airside fence at the taxiway's west end
      TOPC: 0.0
    };
    S.SEGW = S.NBAY * S.BAY; S.segX0 = function (k) { return S.RX0 + k * (S.SEGW + S.ISL); };
    S.RX1 = S.segX0(S.NSEG - 1) + S.SEGW;
    S.inPark = function (x, z, m) { return rectDist(x, z, S.PX0, S.PX1, S.PZ0, S.PZ1) <= (m || 0); };
    S.inGarden = function (x, z, m) { m = m || 0; return rectDist(x, z, S.GX0, S.GX1, S.GZ0, S.GZ1) <= m && !(x > -190 + m && z < 68.5 - m); };
    S.inHub = function (x, z, m) { return rectDist(x, z, S.LEG.x - 4, S.WA.x, S.PZ0, S.PZ1) <= (m || 0); };
    return S;
  }
  // the walkable surface of the module's own ground (the asphalt, the walks, the raised islands), used to seat every prop
  function onIsland(x, z) { if (!S) return false; var I = S.ISLAND; if (rectDist(x, z, I.x0, I.x1, I.z0, I.z1) <= 0) return true; var L = LAY; if (!L) return false; for (var i = 0; i < L.islands.length; i++) { var q = L.islands[i]; if (x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1) return true; } return false; }
  function liftAt(x, z) { if (!S) return 0; if (onIsland(x, z)) return S.ILIFT; if (S.inPark(x, z) || rectDist(x, z, S.C1.x - S.C1.w / 2, S.C1.x + S.C1.w / 2, S.C1.z0, S.C1.z1) <= 0) return S.LIFT + (z > 135 ? Math.min(0.19, (z - 135) / 9.5 * 0.19) : 0); if (rectDist(x, z, S.WALK.x0, S.WALK.x1, S.WALK.z0, S.WALK.z1) <= 0 || rectDist(x, z, S.WEST.x0, S.WEST.x1, S.WEST.z0, S.WEST.z1) <= 0) return S.WLIFT; return 0; }
  function sY(x, z) { return gh(x, z) + liftAt(x, z); }

  // ───────────────────────── the layout: rows, segments, bays, islands, chargers, cars; the garden's pieces ─────────────────────────
  var LAY = SP.lay = null;
  var CAR_COLS = [[0xf2f2f0, 22], [0xd9dbdd, 8], [0x9da2a7, 14], [0x5d6267, 10], [0x1c1d20, 14], [0x23314f, 7], [0x8e1c1c, 6], [0xc9b99a, 5], [0x2c4a3a, 4], [0x6b2430, 3], [0xb7c3cc, 4], [0x3f6f9a, 3]];
  var CART_BODY = [[0x2f8f45, 30], [0xf2f1ea, 16], [0xe8dcc0, 8], [0x1c1d20, 8], [0xb8bcc0, 8], [0x8e1c1c, 6], [0x23477a, 6], [0x4dde6f, 5], [0xc9a95a, 4], [0x5a6b3a, 4]];
  function pickW(R, list) { var t = 0; list.forEach(function (q) { t += q[1]; }); var r = R() * t; for (var i = 0; i < list.length; i++) { r -= list[i][1]; if (r <= 0) return list[i][0]; } return list[0][0]; }
  function layout() {
    if (LAY) return LAY; site(); var R = rng(8031), L = LAY = SP.lay = { rows: [], segs: [], bays: [], islands: [], chargers: [], columns: [], cars: [] };
    S.ROWS.forEach(function (row, ri) {
      var halves = row.kind === "double" ? [{ z0: row.z0, z1: (row.z0 + row.z1) / 2, dir: 1 }, { z0: (row.z0 + row.z1) / 2, z1: row.z1, dir: -1 }] : [{ z0: row.z0, z1: row.z1, dir: row.nose }];
      var zc = row.kind === "double" ? (row.z0 + row.z1) / 2 : row.nose < 0 ? row.z0 + 0.5 : row.z1 - 0.5;   // column / charger line
      for (var k = 0; k < S.NSEG; k++) { var x0 = S.segX0(k), seg = { row: row.id, ri: ri, k: k, x0: x0, x1: x0 + S.SEGW, z0: row.z0, z1: row.z1, kind: row.kind, zc: zc, nose: row.nose || 0 }; L.segs.push(seg);
        [1, 4, 7].forEach(function (b) { L.columns.push({ x: x0 + b * S.BAY, z: zc, seg: seg }); });
        [2, 6].forEach(function (b) { L.chargers.push({ x: x0 + b * S.BAY, z: zc, seg: seg, dbl: row.kind === "double" }); });
        halves.forEach(function (h, hi) { for (var i = 0; i < S.NBAY; i++) { var bx = x0 + (i + 0.5) * S.BAY; var acc = k === 0 && (ri === 0 || ri === 4 || (ri === 1 && hi === 0)) && i <= 2; var b = { x: bx, z: (h.z0 + h.z1) / 2, z0: h.z0, z1: h.z1, dir: h.dir, row: row.id, k: k, i: i, acc: acc && i !== 1, hatch: acc && i === 1, ev: !acc && (i === 1 || i === 2 || i === 5 || i === 6) }; L.bays.push(b); } }); }
      // islands between the segments and at both row ends (planted, kerbed, raised soil)
      for (var k2 = 0; k2 < S.NSEG - 1; k2++) L.islands.push({ x0: S.segX0(k2) + S.SEGW + 0.25, x1: S.segX0(k2 + 1) - 0.25, z0: row.z0 + 0.3, z1: row.z1 - 0.3, row: row.id, tree: true });
      L.islands.push({ x0: S.WA.x + S.WA.w / 2 + 0.3, x1: S.RX0 - 0.3, z0: row.z0 + 0.3, z1: row.z1 - 0.3, row: row.id, end: "w" }); L.islands.push({ x0: S.RX1 + 0.3, x1: S.EA.x - S.EA.w / 2 - 0.3, z0: row.z0 + 0.3, z1: row.z1 - 0.3, row: row.id, end: "e", tree: true });
    });
    // what is parked: golf carts first (two to a bay, nose to tail, in the cart bays), a few cars in the car bays (the accessible bays
    // and the first segment of rows D and E, next to the connector from the Flight Line Gate road); about half the lot taken, busiest by
    // the hub and the Market Hall walk, emptier rows farther east and south; the EV bays mostly taken by carts on charge
    L.carts = []; var segK = {}; L.segs.forEach(function (sg) { segK[sg.row + sg.k] = 0.75 + R() * 0.5; });
    var ROWB = { A: 0.16, B: 0.1, C: 0, D: -0.06, E: -0.12 };
    L.bays.forEach(function (b) { b.carBay = b.acc || b.hatch || (b.k === 0 && (b.row === "E" || (b.row === "D" && b.dir < 0))); });
    var occ = function (b) { var p = 0.7 * Math.exp(-(b.x - S.RX0) / 75) + 0.01 + (ROWB[b.row] || 0); p *= segK[b.row + b.k] || 1; if (b.ev) p = p * 0.48 + 0.37; return clamp(p, 0.04, 0.95); };
    L.bays.forEach(function (b) { if (b.hatch) return; var zf = b.dir > 0 ? b.z1 : b.z0;
      if (b.carBay) { if (R() > (b.acc ? 0.6 : 0.5)) return; var t = R(), type = t < 0.42 ? 0 : t < 0.82 ? 1 : 2, len = [4.85, 4.6, 5.9][type]; var cz = zf - b.dir * (len / 2 + 0.35 + R() * 0.25); L.cars.push({ x: b.x + (R() - 0.5) * 0.3, z: cz, ry: (b.dir > 0 ? PI : 0) + (R() - 0.5) * 0.06, type: type, col: pickW(R, CAR_COLS), bay: b }); b.taken = 1; return; }
      var p = occ(b); [0, 1].forEach(function (slot) { if (R() > (slot ? p * 0.62 : p)) return; var cz = zf - b.dir * (1.25 + 0.28 + slot * 2.72 + R() * 0.12); L.carts.push({ x: b.x + (R() - 0.5) * 0.22, z: cz, ry: (b.dir > 0 ? 0 : PI) + (R() - 0.5) * 0.08, slot: slot, body: pickW(R, CART_BODY), roof: Math.floor(R() * 8), bay: b, charge: b.ev && slot === 0 && R() < 0.85 }); b.taken = 1; }); });
    SP.n.taken = L.bays.filter(function (b) { return b.taken; }).length; SP.n.carts = L.carts.length;
    SP.n.bays = L.bays.length; SP.n.cars = L.cars.length; SP.n.chargers = L.chargers.length; SP.n.canopies = L.segs.length;
    garden(L, R);
    return L;
  }
  // the Market Garden: an entrance plaza with the farm stand, two crossing paths, timber (west) and corten (east) raised beds,
  // corn rows, the hoop greenhouse, the orchard, the tool shed, compost bins, the coop and its run, trellises, the fence
  function garden(L, R) {
    var G = L.g = { beds: [], corn: [], trees: [], trellis: [], tables: [], paths: [] };
    G.paths.push({ id: "g_ns", pts: [[-214, 51.4], [-214, 128.5], [-213.2, 137], [-213.5, 150]], w: 3 }); G.paths.push({ id: "g_ew", pts: [[-244, 89], [-141, 89]], w: 3 });
    G.paths.push({ id: "g_gh", pts: [[-191.5, 89], [-191.5, 76.5], [-188.5, 76.5]], w: 2 }); G.plaza = [[-244, 52], [-217, 52], [-217, 70], [-244, 70]];
    var crops = ["pepper", "squash", "herb", "greens", "pepper", "tomato", "herb", "greens", "squash", "chard"];
    var block = function (x0, x1, rows, mat, seed) { var n = Math.floor((x1 - x0) / 2.5); rows.forEach(function (rz, ri) { for (var i = 0; i < n; i++) { var x = x0 + 1.25 + i * 2.5; G.beds.push({ x: x, z: rz + 2.5, w: 1.25, l: 5, mat: mat, crop: crops[(i + ri * 3 + seed) % crops.length], h: mat === "corten" ? 0.62 : 0.5 }); } }); };
    block(-242, -217, [72, 79], "wood", 0); block(-242, -217, [92.5, 99.5, 106.5], "wood", 4); block(-211, -193, [72, 79], "corten", 2); block(-211, -193, [92.5, 99.5, 106.5], "corten", 7);
    for (var cx = -241; cx <= -194; cx += 1.6) { if (Math.abs(cx + 214) < 2.4) continue; G.corn.push({ x: cx, z0: 114.5, z1: 126 }); }
    G.gh = { x0: -188, x1: -163, z0: 72.5, z1: 81.5 };
    var kinds = ["citrus", "citrus", "pomegranate", "olive", "citrus", "olive"];
    for (var ix = 0; ix < 5; ix++) for (var iz = 0; iz < 5; iz++) G.trees.push({ x: -186 + ix * 6 + (iz % 2) * 1.2, z: 96 + iz * 6.6, kind: kinds[(ix + iz * 2) % kinds.length], s: 0.85 + R() * 0.3 });
    for (var ix2 = 0; ix2 < 3; ix2++) for (var iz2 = 0; iz2 < 2; iz2++) G.trees.push({ x: -155 + ix2 * 6, z: 116 + iz2 * 6.6, kind: ix2 === 1 ? "olive" : "pomegranate", s: 0.85 + R() * 0.3 });
    G.shed = { x: -153, z: 76, w: 4.2, d: 3.2, ry: 0 }; G.compost = { x: -145, z: 75.5 }; G.coop = { x: -146, z: 99, run: [-156, -141, 94, 107] };
    G.stand = { x: -222.5, z: 58.5, ry: -PI / 2 };                    // counter faces west (local +z = world -x)
    G.trellis.push({ x: -214, z: 89, w: 9, d: 9 }); G.trellis.push({ x: -235, z: 63.5, w: 12, d: 9 });
    G.tables.push([-238.5, 61.5, 0], [-238.5, 66, 0], [-231.5, 61.5, 0], [-231.5, 66, 0]);
    G.sign = { x: -241.5, z: 53.6 };
    return G;
  }

  // ───────────────────────── world hook: clearing, keep-outs, the drawn roads for the map, hubs, zones, info points, the shuttle ─────────────────────────
  var VEG = /^(bush\d|mesquite|ocotillo|saguaro.*|paloverde|ironwood|desertwillow|barrel_cactus|prickly_pear|cholla|organ_pipe|agave_cluster|yucca_cluster|boulder|fanpalm.*|datepalm|canarypalm|ph_(rock|boulder|shrub|succulent|stones|sandrocks|moonrock)_?\d*|e1_(?!opost|spost|lantern|canarypalm|fanpalm2|datepalm).*)$/;
  // the footprint: every rectangle the module paves, plants or builds on (x0, x1, z0, z1)
  function foot() { site(); return [[S.PX0 - 1, S.PX1 + 1, S.PZ0 - 3, S.PZ1 + 4.5], [S.WALK.x0, S.WALK.x1, S.WALK.z0 - 0.5, S.WALK.z1 + 2], [S.WEST.x0 - 1, S.WEST.x1 + 1, S.WEST.z0, S.WEST.z1], [S.C1.x - 5, S.C1.x + 5, S.C1.z0, S.C1.z1 - 2], [S.GX0, S.GX1 + 1, S.GZ0 - 1, S.GZ1 + 1.5], [-216.5, -210.5, 128, 147]]; }
  function inFoot(x, z, m) { var F = SP.foot || (SP.foot = foot()); for (var i = 0; i < F.length; i++) { var r = F[i]; if (rectDist(x, z, r[0], r[1], r[2], r[3]) <= (m || 0)) { if (i === 4 && x > -190 && z < 67.5) continue; return true; } } return false; }
  function clearSite() {
    var removed = 0, keys = new Set();
    for (var k in PLACE) { if (!VEG.test(k)) continue; var Lk = PLACE[k], out = []; for (var i = 0; i < Lk.length; i++) { var e = Lk[i]; if (!e.sp && inFoot(e[0], e[2], 1.2)) { keys.add(Math.round(e[0] * 100) + ":" + Math.round(e[2] * 100)); removed++; } else out.push(e); } if (out.length !== Lk.length) { Lk.length = 0; Array.prototype.push.apply(Lk, out); } }
    if (keys.size) for (var j = COLLIDERS.length - 1; j >= 0; j--) { var c = COLLIDERS[j]; if (keys.has(Math.round(c[0] * 100) + ":" + Math.round(c[1] * 100))) COLLIDERS.splice(j, 1); }
    SP.n.cleared = removed;
  }
  function keepouts() { (SP.foot || foot()).forEach(function (r, i) { for (var x = r[0] + 4; x <= r[1] + 4; x += 8) for (var z = r[2] + 4; z <= r[3] + 4; z += 8) { var px = Math.min(x, r[1]), pz = Math.min(z, r[3]); if (i === 4 && px > -190 && pz < 66) continue; KEEPOUT.push([px, pz, 6.2]); } }); }
  // the paved surfaces as entries of the client's ROADS (the minimap draws them, the walk lift matches the drape, scatter keeps off)
  function roads() {
    var add = function (pts, w, lift, id) { ROADS.push({ pts: pts, w: w, lift: lift, sp: id }); SP.n.roads = (SP.n.roads || 0) + 1; };
    S.AISLES.forEach(function (z, i) { add([[i === 0 || i === 3 ? S.LEG.x : S.WA.x, z], [S.EA.x, z]], S.AW, S.LIFT, "aisle" + i); });
    add([[S.LEG.x, S.LEG.z0], [S.LEG.x, S.LEG.z1]], S.LEG.w, S.LIFT, "leg"); add([[S.WA.x, S.AISLES[0]], [S.WA.x, S.AISLES[3]]], S.WA.w, S.LIFT, "wa"); add([[S.EA.x, S.PZ0 + 2], [S.EA.x, S.PZ1 - 2]], S.EA.w, S.LIFT, "ea");
    add([[S.C1.x, S.C1.z0], [S.C1.x, 135]], S.C1.w, S.LIFT, "c1");
    S.ROWS.forEach(function (r) { add([[S.RX0 - 3, (r.z0 + r.z1) / 2], [S.RX1 + 3, (r.z0 + r.z1) / 2]], r.z1 - r.z0, S.LIFT, "row" + r.id); });
    add([[S.WALK.x0 + 2, (S.WALK.z0 + S.WALK.z1) / 2], [S.WALK.x1, (S.WALK.z0 + S.WALK.z1) / 2]], S.WALK.z1 - S.WALK.z0, S.WLIFT, "walk"); add([[(S.WEST.x0 + S.WEST.x1) / 2, S.WALK.z1], [(S.WEST.x0 + S.WEST.x1) / 2, S.WEST.z0]], S.WEST.x1 - S.WEST.x0, S.WLIFT, "westwalk");
    layout().g.paths.forEach(function (p) { add(p.pts, p.w, 0.05, p.id); });
  }
  function hsAdd(key, x, z, r) { var d = C("info." + key, null); if (!d) return null; var h = { x: x, z: z, r: r, t: d[0], k: d[1], p: d[2], sp: key }; hotspots.push(h); (SP.hs = SP.hs || []).push(h); return h; }
  function worldHook() {
    if (SP.off || !window.PLAN || SP.world) return; if (!cfg()) { note("cfg", "no plan/solarpark.json"); return; } SP.world = true; var t0 = nowMs();
    site(); layout();
    try { clearSite(); } catch (e) { note("clear", e); } try { keepouts(); } catch (e) { note("keepouts", e); } try { roads(); } catch (e) { note("roads", e); }
    try { (C("hubs", []) || []).forEach(function (h) { planAddHub(h.name, h.x, h.z); }); planNavCats(); } catch (e) { note("hub", e); }
    try { var Z = C("zones", []) || []; Z.forEach(function (q) { zoneRings.push({ name: q.name, label: q.label || q.name, center: q.center, r: q.r || 60, k: q.k || "", poly: q.poly, col: q.col || "#4dde6f33", plan: "solarpark", noLabel: true }); }); } catch (e) { note("zone", e); }
    try { hsAdd("park", -430, 50.5, 5); hsAdd("park", -262, 50.5, 5); hsAdd("hub", -455.5, 91, 4.5); hsAdd("ev", -400.2, 60.5, 3); hsAdd("garden", -241.5, 55.5, 4.5); hsAdd("greenhouse", -175.5, 84, 4); hsAdd("orchard", -175, 92, 3.5); hsAdd("coop", -149, 92.6, 3.5); hsAdd("compost", -145, 79, 3); } catch (e) { note("hotspots", e); }
    try { transitPatch(); } catch (e) { note("transit", e); }
    install(); SP.n.worldMs = Math.round(nowMs() - t0);
  }

  // ───────────────────────── terrain hook: trees in the islands, along the walk and the shop backs, at the hub and the garden ─────────────────────────
  function put1(k, x, z, rot, sc, y) { if (!canPut(k)) return false; try { put(k, x, z, rot, sc); var Lk = PLACE[k]; Lk[Lk.length - 1].sp = 1; Lk[Lk.length - 1].keep = true; if (y !== undefined) { Lk[Lk.length - 1][1] = y; Lk[Lk.length - 1].seated = true; } SP.n.planted = (SP.n.planted || 0) + 1; return true; } catch (e) { note("put " + k, e); return false; } }
  function terrainHook() {
    if (SP.off || !SP.world || SP.planted) return; SP.planted = true; var L = layout(), R = rng(2468), t0 = nowMs();
    var tree = function (x, z, k) { var kk = k || (R() < 0.72 ? "paloverde" : R() < 0.6 ? "mesquite" : "desertwillow"); put1(kk, x, z, R() * TAU, kk === "paloverde" ? 0.62 + R() * 0.18 : kk === "mesquite" ? 0.55 + R() * 0.12 : 0.6 + R() * 0.12, onIsland(x, z) ? gh(x, z) + S.ILIFT - 0.06 : undefined); };
    L.islands.forEach(function (I, i) { if (!I.tree) return; if (I.end === "e") { tree((I.x0 + I.x1) / 2, (I.z0 + I.z1) / 2, "paloverde"); return; } var cx = (I.x0 + I.x1) / 2; if (I.z1 - I.z0 > 8) { tree(cx, I.z0 + (I.z1 - I.z0) * 0.3); if (i % 2) tree(cx, I.z0 + (I.z1 - I.z0) * 0.72, "paloverde"); } else tree(cx, (I.z0 + I.z1) / 2); });
    // the strip along the walk (between the walk and row A) and the buffer under the shop backs
    for (var x = S.RX0 + 6; x < S.RX1 - 4; x += 14.5) tree(x + (R() - 0.5) * 2, 52.35, "paloverde");
    for (var x2 = S.RX0 + 2; x2 < S.EA.x - 6; x2 += 13) tree(x2 + (R() - 0.5) * 3, 127.6 + (R() - 0.5) * 0.6, R() < 0.5 ? "mesquite" : "paloverde");
    // the transit island: two palo verdes and a desert willow over the benches; the garden's west edge
    [[-449.5, 71], [-449.5, 109.5], [-450.5, 91]].forEach(function (q, j) { tree(q[0], q[1], j === 2 ? "desertwillow" : "paloverde"); });
    [[-242.5, 74], [-242.5, 102], [-242.5, 118]].forEach(function (q) { tree(q[0], q[1], "paloverde"); });
    [[-139.5, 80], [-139.5, 96], [-139.5, 113], [-139.5, 126]].forEach(function (q, j) { tree(q[0], q[1], j % 2 ? "mesquite" : "desertwillow"); });
    // share carts in their bays on the island
    if (canPut("cart")) (C("hub.carts", []) || []).forEach(function (c) { put1("cart", c[0], c[1], c[2], 1, gh(c[0], c[1]) + S.ILIFT); });
    SP.n.terrainMs = Math.round(nowMs() - t0);
  }

  // ───────────────────────── the Grand Loop: call at the Shuttle Hub and at the Convention Center drop-off ─────────────────────────
  // planTransit (client) builds the loop with planRoute(pieces) and its stops from plan.json transit. Wrapping planRoute for the
  // Grand Loop's piece list: the return leg from the Flight Line turns north up the connector, round the drop-off loop (stopping
  // on the west leg beside the shelter) and back; on Terminal Drive it pulls into the Convention Center bay by the shelter and out
  // again. The two stops are added to the timetable before planTransit reads it.
  function hubLoopPts() { var x1 = S.C1.x, xl = S.LEG.x, xw = S.WA.x, a1 = S.AISLES[0], a4 = S.AISLES[3], r = 3.2, out = [];
    var arc = function (cx, cz, a0, a1r, n) { for (var i = 0; i <= n; i++) { var a = lerp(a0, a1r, i / n); out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } };
    out.push([x1, 150], [x1, a4 + r]); arc(x1 - r, a4 + r, 0, -PI / 2, 4); out.push([xl + r, a4]); arc(xl + r, a4 - r, PI / 2, PI, 4); out.push([xl, S.STOP[1] + 14], [xl, S.STOP[1]], [xl, a1 + r]); arc(xl + r, a1 + r, PI, 1.5 * PI, 4);
    out.push([xw - r, a1]); arc(xw - r, a1 + r, -PI / 2, 0, 4); out.push([xw, a4 - r]); arc(xw - r, a4 - r, 0, PI / 2, 4); out.push([x1 + r, a4]); arc(x1 + r, a4 + r, -PI / 2, -PI, 4); out.push([x1, 150]); return out; }
  function bayPts() { return (C("transit.bay", null) || [[-236, -191.9], [-226.5, -185.4], [-219, -178.6], [-211, -174.6], [-205, -173.9], [-198, -174.1], [-190.5, -176.4], [-182, -180.6], [-170, -181.6]]); }
  function transitPatch() {
    if (SP.transit || /[?&]sploop=0\b/.test(location.search)) return; var P = window.PLAN, GL = P && P.transit && P.transit.find(function (t) { return /grand loop/i.test(t.name); }); if (!GL) { note("transit", "no Grand Loop in plan.json"); return; }
    SP.transit = { stops: C("transit.stops", []) || [], cut: 0 };
    SP.transit.stops.forEach(function (s) { if (!GL.stops.some(function (q) { return q[0] === s[0]; })) GL.stops.push([s[0], s[1], s[2]]); });
    var o = SP.transit.orig = planRoute;
    planRoute = function (pieces) {
      try { if (pieces && pieces.length > 20 && pieces[0] && pieces[0][0] === "landing_blvd" && !pieces.spDone) pieces = spPieces(pieces); } catch (e) { note("route", e); }
      return o.apply(this, [pieces].concat([].slice.call(arguments, 1)));
    };
  }
  function spPieces(src) {
    var out = [], hub = 0, bay = 0, seenProm = false, B = bayPts();
    for (var i = 0; i < src.length; i++) { var p = src[i];
      if (p[0] === "flightline_prom") seenProm = true;
      if (!hub && seenProm && p[0] === "flightline_rd" && Math.abs(p[1][0] + 440) < 2 && Math.abs(p[2][0] + 485) < 2) { out.push(["flightline_rd", p[1], [S.C1.x, 150]], ["pts", hubLoopPts(), null, C("transit.hubSpeed", 5)], ["flightline_rd", [S.C1.x, 150], p[2]]); hub = 1; continue; }
      if (!bay && p[0] === "terminal_drive" && Math.abs(p[1][0] + 495) < 2 && p[2][0] > 0) { out.push(["terminal_drive", p[1], B[0]], ["pts", B, null, C("transit.baySpeed", 6)], ["terminal_drive", B[B.length - 1], p[2]]); bay = 1; continue; }
      out.push(p); }
    out.spDone = true; SP.transit.cut = hub + bay; SP.n.routeHub = hub; SP.n.routeBay = bay; return out;
  }

  // ───────────────────────── ground: draped on the terrain (cells clipped to the outline), lift by surface ─────────────────────────
  function clipCell(poly, x0, z0, x1, z1) { var out = poly; var edges = [[0, x0, 1], [0, x1, -1], [1, z0, 1], [1, z1, -1]];
    for (var e = 0; e < 4 && out.length; e++) { var ax = edges[e][0], v = edges[e][1], sd = edges[e][2], inp = out; out = []; for (var i = 0; i < inp.length; i++) { var P = inp[i], Q = inp[(i + 1) % inp.length]; var pin = (P[ax] - v) * sd >= 0, qin = (Q[ax] - v) * sd >= 0; if (pin) out.push(P); if (pin !== qin) { var t = (v - P[ax]) / (Q[ax] - P[ax]); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); } } }
    return out; }
  // a draped surface: lift is metres over the terrain (a number or f(x, z)); tile is metres per texture repeat
  function drape(poly, cell, lift, tile) {
    var bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9; poly.forEach(function (p) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); bz0 = Math.min(bz0, p[1]); bz1 = Math.max(bz1, p[1]); });
    var P = [], N = [], UV = [], lf = typeof lift === "function" ? lift : function () { return lift; };
    var hN = function (x, z) { var e = 0.8; var dx = gh(x - e, z) - gh(x + e, z), dz = gh(x, z - e) - gh(x, z + e); var L = Math.hypot(dx, 2 * e, dz); return [dx / L, 2 * e / L, dz / L]; };
    var vtx = function (q) { P.push(q[0], gh(q[0], q[1]) + lf(q[0], q[1]), q[1]); var n = hN(q[0], q[1]); N.push(n[0], n[1], n[2]); UV.push(q[0] / tile, -q[1] / tile); };
    for (var x = Math.floor(bx0 / cell) * cell; x < bx1; x += cell) for (var z = Math.floor(bz0 / cell) * cell; z < bz1; z += cell) {
      var pc = clipCell(poly, x, z, x + cell, z + cell); if (pc.length < 3) continue;
      var tri = THREE.ShapeUtils.triangulateShape(pc.map(function (q) { return new THREE.Vector2(q[0], q[1]); }), []);
      tri.forEach(function (t) { var a = pc[t[0]], b = pc[t[1]], c = pc[t[2]]; var cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); if (Math.abs(cr) < 1e-6) return; if (cr > 0) { vtx(a); vtx(c); vtx(b); } else { vtx(a); vtx(b); vtx(c); } }); }
    if (!P.length) return null; var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); return g;
  }
  function rect(x0, z0, x1, z1) { return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; }
  function stripPoly(pts, w) { var l = [], r = []; for (var i = 0; i < pts.length; i++) { var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], tx = b[0] - a[0], tz = b[1] - a[1], L = Math.hypot(tx, tz) || 1, nx = -tz / L * w / 2, nz = tx / L * w / 2; l.push([pts[i][0] + nx, pts[i][1] + nz]); r.unshift([pts[i][0] - nx, pts[i][1] - nz]); } return l.concat(r); }
  var GD = SP.gd = {};   // ground geometries by material
  function gput(k, g) { if (!g) return; (GD[k] || (GD[k] = [])).push(g); }
  function buildGround() {
    var L = layout(), G = L.g;
    gput("asphalt", drape(rect(S.PX0, S.PZ0, S.PX1, S.PZ1), 3, S.LIFT, 6)); gput("asphalt", drape(rect(S.C1.x - S.C1.w / 2, S.PZ1, S.C1.x + S.C1.w / 2, S.C1.z1), 3, function (x, z) { return liftAt(x, Math.min(z, S.C1.z1 - 0.01)); }, 6));
    gput("dg", drape(rect(S.WALK.x0, S.WALK.z0, S.WALK.x1, S.WALK.z1), 2, S.WLIFT, 4)); gput("dg", drape(rect(S.WEST.x0, S.WEST.z0, S.WEST.x1, S.WALK.z0), 2, S.WLIFT, 4));
    gput("soil", drape(rect(S.RX0 - 4, S.WALK.z1, S.RX1 + 4, S.PZ0), 1.5, 0.04, 3)); gput("soil", drape(rect(S.PX0 + 3, S.PZ1, S.EA.x + 3, 129.6), 1.5, 0.04, 3));
    gput("soil", drape(rect(S.PX0, S.WALK.z1, S.RX0 - 4, S.PZ0), 1.5, 0.04, 3));
    // the garden: decomposed granite over the whole plot, darker mulch under the orchard and the corn, the plaza and paths in stone-toned DG
    gput("gsoil", drape([[S.GX0, S.GZ0], [-190, S.GZ0], [-190, 68.5], [S.GX1, 68.5], [S.GX1, S.GZ1], [S.GX0, S.GZ1]], 2.5, 0.035, 4));
    gput("mulch", drape(rect(-242, 113.8, -193.5, 126.8), 2, 0.055, 3)); gput("mulch", drape(rect(-190, 92.5, -159, 127), 2.5, 0.055, 3)); gput("mulch", drape(rect(-158.5, 112.5, -140.5, 127), 2.5, 0.055, 3));
    gput("dg", drape(G.plaza, 2, 0.06, 4)); G.paths.forEach(function (p) { gput("stone", drape(stripPoly(p.pts, p.w), 1.5, 0.065, 2.4)); });
  }
  // the transit island and the parking islands: kerbed, raised (soil or stone paving on top)
  function island(K, I, top) {
    var y = function (x, z) { return gh(x, z) + S.ILIFT; }; var poly = rect(I.x0, I.z0, I.x1, I.z1); gput(top || "soil", drape(poly, 1.5, S.ILIFT, 3));
    var edge = function (A, B) { var L = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.max(1, Math.ceil(L / 3)); for (var i = 0; i < n; i++) { var a = [lerp(A[0], B[0], i / n), lerp(A[1], B[1], i / n)], b = [lerp(A[0], B[0], (i + 1) / n), lerp(A[1], B[1], (i + 1) / n)]; var mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, g0 = Math.min(gh(a[0], a[1]), gh(b[0], b[1])); K.box("stdn", 0xc9c3b6, Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.16, y(mx, mz) + 0.03 - (g0 - 0.12), 0.16, mx, g0 - 0.12, mz, Math.atan2(b[1] - a[1], b[0] - a[0]) * -1); } };
    for (var i = 0; i < 4; i++) edge(poly[i], poly[(i + 1) % 4]);
  }

  // ───────────────────────── the canopies: steel T and cantilever frames, purlins, PV modules (front cells, backsheet below), LEDs ─────────────────────────
  var CAN = SP.can = [];
  function canopy(K, seg) {
    var dbl = seg.kind === "double", tilt = (dbl ? 7 : 6) * PI / 180, tn = Math.tan(tilt), ov = 0.3, xa = seg.x0 - ov, xb = seg.x1 + ov;
    var depth = seg.z1 - seg.z0, nS = dbl ? 7 : 4, pitchZ = 1.74 * Math.cos(tilt), span = nS * pitchZ, zN = (seg.z0 + seg.z1) / 2 - span / 2, zS = zN + span;
    var gmax = -1e9; [xa, (xa + xb) / 2, xb].forEach(function (x) { [zN, (zN + zS) / 2, zS].forEach(function (z) { gmax = Math.max(gmax, gh(x, z)); }); });
    var yS = gmax + S.LIFT + (dbl ? 3.25 : 3.15), yAt = function (z) { return yS + (zS - z) * tn; };   // underside of the modules, low (south) edge
    CAN.push({ seg: seg, xa: xa, xb: xb, zN: zN, zS: zS, yS: yS, tn: tn });
    // modules: 20 across, nS along the slope, 2 cm joints; the top shows the cells, the underside the backsheet
    var nX = 20, pitchX = (xb - xa) / nX, R = rng(seg.ri * 31 + seg.k * 7 + 1), th = 0.045;
    for (var i = 0; i < nX; i++) for (var j = 0; j < nS; j++) { var x0 = xa + i * pitchX + 0.01, x1 = x0 + pitchX - 0.02, z0 = zN + j * pitchZ + 0.01, z1 = z0 + pitchZ - 0.02, y0 = yAt(z0), y1 = yAt(z1), tint = 0.9 + R() * 0.16;
      var col = new THREE.Color(tint, tint, tint * (0.98 + R() * 0.04)).getHex();
      K.face("pv", col, [x0, y0 + th, z0], [x1, y0 + th, z0], [x1, y1 + th, z1], [x0, y1 + th, z1], [0, 1, 0], [0, 1], [0.5, 1], [0.5, 0], [0, 0]);
      K.face("pv", 0xffffff, [x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1], [0, -1, 0], [0.5, 1], [1, 1], [1, 0], [0.5, 0]); }
    // the perimeter: a thin anodised edge all round, a deeper fascia on the low (south) edge
    var steel = 0x9ca3a8, dark = 0x3c4146;
    K.beam("metal", steel, [xa, yAt(zN) + 0.02, zN], [xb, yAt(zN) + 0.02, zN], 0.05, 0.1); K.beam("metal", steel, [xa, yAt(zS) - 0.06, zS + 0.02], [xb, yAt(zS) - 0.06, zS + 0.02], 0.06, 0.26);
    K.beam("metal", steel, [xa, yAt(zN) + 0.02, zN], [xa, yAt(zS) + 0.02, zS], 0.05, 0.1); K.beam("metal", steel, [xb, yAt(zN) + 0.02, zN], [xb, yAt(zS) + 0.02, zS], 0.05, 0.1);
    // purlins along x at every module joint (Z sections), girders along the slope on each column, columns, knee braces, piers
    for (var p = 0; p <= nS; p++) { var zp = zN + p * pitchZ; K.beam("metal", steel, [xa + 0.05, yAt(zp) - 0.11, zp], [xb - 0.05, yAt(zp) - 0.11, zp], 0.07, 0.2); }
    var zc = seg.zc; [1, 4, 7].forEach(function (b) { var x = seg.x0 + b * S.BAY, g0 = gh(x, zc) + S.LIFT, yb = yAt(zc) - 0.22 - 0.25;
      K.beam("metal", dark, [x, yAt(zN - 0.1) - 0.47, zN - 0.1], [x, yAt(zS + 0.1) - 0.47, zS + 0.1], 0.22, 0.48);
      K.box("metal", dark, 0.36, yb - (g0 - 0.3), 0.36, x, g0 - 0.3, zc); K.box("metal", dark, 0.62, 0.04, 0.62, x, g0 + 0.9, zc);
      K.cyl("std", 0xb9b4aa, 0.3, 0.3, 1.2, x, g0 - 0.3, zc, 12); K.cyl("std", 0xe2b53a, 0.305, 0.305, 0.16, x, g0 + 0.62, zc, 12);
      var kb = function (dz) { var zt = zc + dz; K.beam("metal", dark, [x, yb - 1.25, zc + Math.sign(dz) * 0.18], [x, yAt(zt) - 0.62, zt], 0.14, 0.14); };
      if (dbl) { kb(-2.6); kb(2.6); } else kb(seg.nose < 0 ? 2.4 : -2.4);
      // the row and segment marker on the column (both faces)
      if (b === 4) { var uv = slot("row:" + seg.row + (seg.k + 1), 128, 128, function (x, w, h) { x.fillStyle = "#1d3a2a"; x.fillRect(0, 0, w, h); x.strokeStyle = "#4DDE6F"; x.lineWidth = 6; x.strokeRect(4, 4, w - 8, h - 8); txt(x, seg.row + (seg.k + 1), w / 2, h / 2 + 4, "700 72px " + SANS, "#f4f1e6"); });
        signQuad(SP.KS, uv, 0.62, 0.62, x, g0 + 2.35, zc - 0.185, PI); signQuad(SP.KS, uv, 0.62, 0.62, x, g0 + 2.35, zc + 0.185, 0); } });
    // LED downlights under the purlins, one strip over each pair of bays; a pool of light on the asphalt under each after dark
    var lines = dbl ? [seg.z0 + 2.9, seg.z1 - 2.9] : [(seg.z0 + seg.z1) / 2]; lines.forEach(function (lz) { for (var b2 = 0; b2 < 4; b2++) { var lx = seg.x0 + (b2 * 2 + 1) * S.BAY; K.box("glow", 0xfff3e2, 1.1, 0.05, 0.16, lx, yAt(lz) - 0.235, lz); K.box("metal", 0x8a9095, 1.2, 0.04, 0.22, lx, yAt(lz) - 0.19, lz);
      var gy = gh(lx, lz) + S.LIFT + 0.03; SP.KP.quad("pool", 0x6e6a62, 6.4, 5.6, lx, gy, lz, 0, -PI / 2, [0, 0, 1, 1]); var ca = lz - 1.6, cb = lz + 1.6; SP.KP.face("pool", 0x8a8478, [lx - 1.9, yAt(ca) - 0.03, ca], [lx + 1.9, yAt(ca) - 0.03, ca], [lx + 1.9, yAt(cb) - 0.03, cb], [lx - 1.9, yAt(cb) - 0.03, cb], [0, -1, 0], [0, 0], [1, 0], [1, 1], [0, 1]); (SP.lampSpots = SP.lampSpots || []).push([lx, yAt(lz) - 0.4, lz]); } });
  }
  // EV charging pedestals on the column line: dark body, a lit screen and status ring on each served face, cables in holsters
  function charger(K, c) {
    var g0 = gh(c.x, c.z) + S.LIFT, faces = c.dbl ? [1, -1] : [c.seg.nose < 0 ? 1 : -1];
    K.box("std", 0xb9b4aa, 0.9, 0.16, c.dbl ? 0.75 : 0.6, c.x, g0 - 0.04, c.z);
    K.box("metal", 0x2a2d31, 0.34, 1.42, c.dbl ? 0.26 : 0.22, c.x, g0 + 0.12, c.z); K.box("metal", 0xdfe3e6, 0.36, 0.08, c.dbl ? 0.28 : 0.24, c.x, g0 + 1.54, c.z);
    faces.forEach(function (f) { var zf = c.z + f * ((c.dbl ? 0.13 : 0.11) + 0.006); K.quad("glow", 0x6fd3ff, 0.2, 0.14, c.x, g0 + 1.22, zf, f > 0 ? 0 : PI); K.quad("glow", 0x4dde6f, 0.24, 0.03, c.x, g0 + 1.42, zf, f > 0 ? 0 : PI);
      [-1, 1].forEach(function (sd) { var hx = c.x + sd * 0.12, hz = c.z + f * 0.2; K.box("std", 0x16181a, 0.06, 0.16, 0.08, hx, g0 + 0.95, hz); var pts = [[hx, g0 + 0.95, hz]]; for (var t = 1; t <= 5; t++) { var a = t / 5; pts.push([hx + sd * 0.08 * Math.sin(a * PI), g0 + 0.95 - 0.7 * Math.sin(a * PI * 0.9), hz + f * 0.05 * a]); } for (var q = 0; q < pts.length - 1; q++) K.tube("stdn", 0x111214, pts[q], pts[q + 1], 0.016, 5); }); });
  }
  // painted lines, the accessible and EV bays, hatched access aisles, the lane arrows, the crossings
  function markings(K) {
    var L = layout(), lw = 0.11, y = function (x, z) { return gh(x, z) + S.LIFT + 0.008; };
    // orient: which way the top of the picture points (0 north, 1 east, 2 south, 3 west)
    var flat = function (cell, x0, z0, x1, z1, orient) { var u = markUV(cell), o = orient || 0; var P = o === 0 ? [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] : o === 1 ? [[x1, z0], [x1, z1], [x0, z1], [x0, z0]] : o === 2 ? [[x1, z1], [x0, z1], [x0, z0], [x1, z0]] : [[x0, z1], [x0, z0], [x1, z0], [x1, z1]];
      K.face("mark", 0xffffff, [P[0][0], y(P[0][0], P[0][1]), P[0][1]], [P[1][0], y(P[1][0], P[1][1]), P[1][1]], [P[2][0], y(P[2][0], P[2][1]), P[2][1]], [P[3][0], y(P[3][0], P[3][1]), P[3][1]], [0, 1, 0], [u[0], u[3]], [u[2], u[3]], [u[2], u[1]], [u[0], u[1]]); };
    L.bays.forEach(function (b) { var x0 = b.x - S.BAY / 2, x1 = b.x + S.BAY / 2; flat("white", x0 - lw / 2, b.z0 + 0.1, x0 + lw / 2, b.z1 - 0.1); if (b.i === S.NBAY - 1) flat("white", x1 - lw / 2, b.z0 + 0.1, x1 + lw / 2, b.z1 - 0.1);
      if (!b.carBay) { var zm = (b.z0 + b.z1) / 2 + b.dir * 0.05; flat("white", x0 + 0.25, zm - 0.045, x1 - 0.25, zm + 0.045); }
      if (b.acc) { flat("blue", x0 + 0.1, b.z0 + 0.15, x1 - 0.1, b.z1 - 0.15); var cz = (b.z0 + b.z1) / 2 + b.dir * 0.6; flat("acc", b.x - 0.75, cz - 0.75, b.x + 0.75, cz + 0.75, b.dir > 0 ? 2 : 0); }
      else if (b.hatch) flat("hatch", x0 + 0.12, b.z0 + 0.15, x1 - 0.12, b.z1 - 0.15);
      else if (b.ev) { var ez = b.dir > 0 ? b.z1 - 1.35 : b.z0 + 1.35; flat("ev", b.x - 0.55, ez - 0.55, b.x + 0.55, ez + 0.55, b.dir > 0 ? 2 : 0); flat("green", x0 + 0.1, (b.dir > 0 ? b.z0 + 0.25 : b.z1 - 0.37), x1 - 0.1, (b.dir > 0 ? b.z0 + 0.37 : b.z1 - 0.25)); } });
    // lane arrows down each aisle (one way east on aisles 1 and 3, west on 2 and 4), the loop's arrows, the crossings
    S.AISLES.forEach(function (z, i) { for (var x = S.RX0 + 14; x < S.RX1 - 6; x += 36) flat("arrow", x - 1.0, z - 0.45, x + 1.0, z + 0.45, i % 2 ? 3 : 1); });
    [[S.LEG.x, 108], [S.LEG.x, 74]].forEach(function (q) { flat("arrow", q[0] - 0.45, q[1] - 1.0, q[0] + 0.45, q[1] + 1.0); });
    var zebra = function (x0, z0, x1, z1) { flat("zebra", x0, z0, x1, z1, Math.abs(x1 - x0) > Math.abs(z1 - z0) ? 1 : 0); };
    zebra(-452, S.PZ0 + 0.3, -448, S.AISLES[0] + 3.4); zebra(S.EA.x - 3.4, 87, S.EA.x + 3.4, 91); zebra(-452, S.AISLES[3] - 3.4, -448, S.AISLES[3] + 3.4);
    // the shuttle bay on the west leg: a yellow box and SHUTTLE ONLY ladder
    flat("yellow", S.LEG.x + 2.9, S.STOP[1] - 7, S.LEG.x + 3.12, S.STOP[1] + 7); flat("yellow", S.LEG.x - 3.12, S.STOP[1] - 7, S.LEG.x - 2.9, S.STOP[1] + 7);
    // wheel stops (concrete) at the head of every bay
    L.bays.forEach(function (b) { if (b.hatch) return; var zf = b.dir > 0 ? b.z1 - 0.75 : b.z0 + 0.75; var g0 = gh(b.x, zf) + S.LIFT; SP.K.box("stdn", 0xbdb7aa, 1.7, 0.13, 0.16, b.x, g0 - 0.02, zf); });
  }
  // kerbs round the park (the walk, the buffer, the garden side), the strips' edging
  function kerbLine(K, A, B, h) { var L = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.max(1, Math.ceil(L / 3)); for (var i = 0; i < n; i++) { var a = [lerp(A[0], B[0], i / n), lerp(A[1], B[1], i / n)], b = [lerp(A[0], B[0], (i + 1) / n), lerp(A[1], B[1], (i + 1) / n)], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, g0 = Math.min(gh(a[0], a[1]), gh(b[0], b[1])); K.box("stdn", 0xc4beb1, Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.02, gh(mx, mz) + (h || 0.16) - (g0 - 0.12), 0.16, mx, g0 - 0.12, mz, -Math.atan2(b[1] - a[1], b[0] - a[0])); } }
  // low desert planting in the islands and strips (procedural, merged): agave rosettes, brittlebush mounds, grass cards, boulders
  function agaveP(K, x, y, z, s, R) { var n = 14; for (var i = 0; i < n; i++) { var a = i / n * TAU + R() * 0.3, Lh = (0.45 + R() * 0.25) * s, inner = i % 3 === 0, tilt = inner ? 0.35 : 0.95 + R() * 0.25; var g = new THREE.ConeGeometry(0.07 * s, Lh, 3); g.translate(0, Lh / 2, 0); K.add("stdn", xf(g, x, y, z, a, tilt, 0), shade(0x3a5446, 0.8 + R() * 0.35)); } }
  function brittleP(K, x, y, z, s, R) { for (var b = 0; b < 3; b++) { var a0 = R() * TAU; K.ico("stdn", R() < 0.5 ? 0x46523a : 0x525c40, 0.24 * s, x + Math.cos(a0) * 0.16 * s, y + 0.16 * s, z + Math.sin(a0) * 0.16 * s, 1, 0.7, 1, R() * 3, 1); } for (var f = 0; f < 7; f++) { var a = R() * TAU; K.ico("stdn", 0xc8a228, 0.035 * s, x + Math.cos(a) * 0.26 * s, y + (0.3 + R() * 0.08) * s, z + Math.sin(a) * 0.26 * s, 1, 0.6, 1); } }
  function grassP(K, x, y, z, s, R) { var ry = R() * PI, h = (0.5 + R() * 0.3) * s, g = LEAF.grass; K.quad("leafn", 0xe6ead0, h * 1.05, h, x, y + h / 2, z, ry, 0, g); K.quad("leafn", 0xdfe4c8, h * 1.05, h, x, y + h / 2, z, ry + PI / 2, 0, g); }
  function rockP(K, x, y, z, s, R) { var g = new THREE.IcosahedronGeometry(0.35 * s, 0), p = g.attributes.position; for (var i = 0; i < p.count; i++) p.setY(i, p.getY(i) * 0.6); K.add("stdn", xf(g, x, y + 0.05 * s, z, R() * 3, 0, 0), shade(0xa48a6e, 0.8 + R() * 0.3)); }
  function plantRect(K, x0, x1, z0, z1, lift, dens, R, avoid) { var area = (x1 - x0) * (z1 - z0), n = Math.round(area * dens); for (var i = 0; i < n; i++) { var x = lerp(x0 + 0.4, x1 - 0.4, R()), z = lerp(z0 + 0.4, z1 - 0.4, R()); if (avoid && avoid(x, z)) continue; var y = gh(x, z) + lift, q = R(); if (q < 0.3) agaveP(K, x, y, z, 0.8 + R() * 0.5, R); else if (q < 0.55) brittleP(K, x, y, z, 0.8 + R() * 0.5, R); else if (q < 0.9) grassP(K, x, y, z, 0.8 + R() * 0.5, R); else rockP(K, x, y, z, 0.8 + R() * 0.7, R); } }
  function buildPlanting(K) { var L = layout(), R = rng(9393), trees = []; for (var k in PLACE) if (/^(paloverde|mesquite|desertwillow)$/.test(k)) PLACE[k].forEach(function (e) { if (e.sp) trees.push(e); });
    var nearTree = function (x, z) { for (var i = 0; i < trees.length; i++) if (Math.hypot(trees[i][0] - x, trees[i][2] - z) < 0.8) return true; return false; };
    L.islands.forEach(function (I) { plantRect(K, I.x0, I.x1, I.z0, I.z1, S.ILIFT, 0.32, R, nearTree); });
    plantRect(K, S.RX0 - 4, S.RX1 + 4, S.WALK.z1 + 0.1, S.PZ0 - 0.2, 0.04, 0.22, R, nearTree); plantRect(K, S.PX0 + 3, S.EA.x + 3, S.PZ1 + 0.3, 129.4, 0.04, 0.2, R, function (x, z) { return nearTree(x, z) || Math.abs(x - S.C1.x) < 5 || (x > -446 && x < -441 && z > 127); });
    plantRect(K, S.PX0, S.RX0 - 4, S.WALK.z1 + 0.1, S.PZ0 - 0.2, 0.04, 0.22, R, function (x, z) { return nearTree(x, z) || (x > -474 && x < -470); }); }
  function buildPark() {
    var L = layout(), K = SP.K;
    L.segs.forEach(function (seg) { try { canopy(K, seg); } catch (e) { note("canopy", e); } });
    L.chargers.forEach(function (c) { charger(K, c); });
    L.islands.forEach(function (I) { island(K, I); });
    markings(SP.KM); try { buildPlanting(K); } catch (e) { note("planting", e); }
    kerbLine(K, [S.RX0 - 4, S.PZ0], [S.RX1 + 4, S.PZ0], 0.16); kerbLine(K, [S.PX0, S.PZ0], [S.RX0 - 4, S.PZ0], 0.16); kerbLine(K, [S.PX0 + 3, S.PZ1], [S.C1.x - S.C1.w / 2, S.PZ1]); kerbLine(K, [S.C1.x + S.C1.w / 2, S.PZ1], [S.EA.x + 3, S.PZ1]);
    kerbLine(K, [S.C1.x - S.C1.w / 2, S.PZ1], [S.C1.x - S.C1.w / 2, S.C1.z1 - 4]); kerbLine(K, [S.C1.x + S.C1.w / 2, S.PZ1], [S.C1.x + S.C1.w / 2, S.C1.z1 - 4]);
    kerbLine(K, [S.PX1, S.PZ0], [S.PX1, 87]); kerbLine(K, [S.PX1, 91], [S.PX1, S.PZ1]); kerbLine(K, [S.PX0, S.PZ0], [S.PX0, S.PZ1]);
    // contact shadows under the cars
    L.cars.forEach(function (c) { var len = [4.85, 4.6, 5.9][c.type] + 0.5, w = [1.86, 1.9, 2.05][c.type] + 0.5; SP.KB.quad("blob", 0xffffff, w, len, c.x, gh(c.x, c.z) + S.LIFT + 0.02, c.z, c.ry, -PI / 2, [0, 0, 1, 1]); });
    L.carts.forEach(function (c) { SP.KB.quad("blob", 0xffffff, 1.7, 2.9, c.x, gh(c.x, c.z) + S.LIFT + 0.02, c.z, c.ry, -PI / 2, [0, 0, 1, 1]); });
    // carts on charge: a cable from the pedestal's holster to the charging port by the cart's nose
    L.carts.forEach(function (c) { if (!c.charge) return; var b = c.bay, ch = null, bd = 9; L.chargers.forEach(function (q) { var d = Math.hypot(q.x - b.x, q.z - (b.dir > 0 ? b.z1 : b.z0)); if (d < bd) { bd = d; ch = q; } }); if (!ch || bd > 3.2) return;
      var g0 = gh(ch.x, ch.z) + S.LIFT, sd = c.x < ch.x ? -1 : 1, A = [ch.x + sd * 0.12, g0 + 0.95, ch.z + (b.dir > 0 ? -0.2 : 0.2)], nz = c.z + b.dir * 1.18, B = [c.x + sd * -0.42, gh(c.x, nz) + S.LIFT + 0.62, nz], pts = [];
      for (var t = 0; t <= 8; t++) { var u = t / 8; pts.push([lerp(A[0], B[0], u), lerp(A[1], B[1], u) - Math.sin(u * PI) * 0.55, lerp(A[2], B[2], u)]); } for (var k = 0; k < 8; k++) K.tube("stdn", 0x111214, pts[k], pts[k + 1], 0.016, 5); });
  }

  // ───────────────────────── the Shuttle Hub: the transit island, the shelter, benches, route map, arrivals board, bike and cart share ─────────────────────────
  var SOL = SP.sol = SP.sol || [];
  function sol(x, z, ry, w, d, y0, y1, seat, face) { try { var sd = addSolid(x, z, ry || 0, w, d, y0, y1, "solar"); if (!sd) return null; sd.sp = 1; if (seat) { sd.seat = true; sd.face = face; } SOL.push(sd); return sd; } catch (e) { note("solid", e); return null; } }
  // a bench along local x (length l), seat 0.45 m, slatted timber on steel legs, a back on the -z side; the seat is a SOLIDS seat
  function bench(K, x, z, ry, l, back) { var F = new Fr(x, 0, z, ry), y0 = sY(x, z), M = K.mark();
    for (var s = 0; s < 4; s++) K.box("wood", 0xa8784a, l, 0.04, 0.09, 0, 0.43, -0.2 + s * 0.12); [-l / 2 + 0.15, l / 2 - 0.15].forEach(function (lx) { K.box("metal", 0x2b2e31, 0.06, 0.43, 0.42, lx, 0, -0.02); if (back) K.box("metal", 0x2b2e31, 0.05, 0.5, 0.05, lx, 0.47, -0.27); });
    if (back) for (var b = 0; b < 3; b++) K.box("wood", 0xa8784a, l, 0.09, 0.03, 0, 0.55 + b * 0.13, -0.28);
    K.place(M, x, y0, z, ry); var c = F.w(0, 0); sol(c[0], c[1], ry, l, 0.5, y0, y0 + 0.47, true, ry); if (back) { var bk = F.w(0, -0.28); sol(bk[0], bk[1], ry, l, 0.08, y0 + 0.47, y0 + 0.95); } }
  function bike(K, x, z, ry, col) { var M = K.mark(), y0 = sY(x, z);
    [-0.52, 0.52].forEach(function (lz) { var t = new THREE.TorusGeometry(0.33, 0.025, 5, 14); t.rotateY(PI / 2); t.translate(0, 0.35, lz); K.add("std", t, 0x1a1b1d); var h = new THREE.TorusGeometry(0.06, 0.02, 4, 8); h.rotateY(PI / 2); h.translate(0, 0.35, lz); K.add("metal", h, 0xb8bec4); });
    var P = function (a, b, r, c) { K.tube("metal", c || col, a, b, r || 0.022, 5); };
    P([0, 0.35, -0.52], [0, 0.62, -0.05]); P([0, 0.62, -0.05], [0, 0.35, 0.18]); P([0, 0.35, 0.18], [0, 0.35, -0.52]); P([0, 0.62, -0.05], [0, 0.82, 0.42]); P([0, 0.82, 0.42], [0, 0.35, 0.52]); P([0, 0.62, -0.05], [0, 0.9, -0.12]); P([0, 0.82, 0.42], [0, 1.05, 0.47]);
    K.box("std", 0x1c1d1f, 0.16, 0.06, 0.26, 0, 0.9, -0.17); K.beam("metal", 0x2a2c2e, [-0.28, 1.05, 0.47], [0.28, 1.05, 0.47], 0.03, 0.03); K.box("std", col, 0.32, 0.18, 0.26, 0, 0.88, 0.62);
    K.place(M, x, y0, z, ry); }
  function shelter(K) {
    var x0 = -458.7, x1 = -454.7, z0 = 83.6, z1 = 98.4, g = function (x, z) { return gh(x, z) + S.ILIFT; };
    var y0 = Math.max(g(x0, z0), g(x0, z1), g(x1, z0), g(x1, z1)), yf = y0 + 3.15, yr = y0 + 2.85, steel = 0x2b3a33, green = 0x1f6b3a;
    // posts (back line) and slim front posts, roof deck sloping to the back, a PV skin on top, white soffit, green fascia
    [z0 + 0.3, (z0 + z1) / 2, z1 - 0.3].forEach(function (z) { K.box("metal", steel, 0.16, yr - y0 + 0.05, 0.16, x1 - 0.25, y0 - 0.2, z); K.box("metal", steel, 0.12, yf - y0 - 0.05, 0.12, x0 + 0.35, y0 - 0.2, z); K.beam("metal", steel, [x0 + 0.1, yf - 0.06, z], [x1 + 0.05, yr - 0.06, z], 0.12, 0.2); });
    K.face("std", 0xf2f1ec, [x0 - 0.2, yf - 0.02, z0 - 0.2], [x1 + 0.2, yr - 0.02, z0 - 0.2], [x1 + 0.2, yr - 0.02, z1 + 0.2], [x0 - 0.2, yf - 0.02, z1 + 0.2], [0, -1, 0]);
    var nz = 8, nx = 2; for (var i = 0; i < nz; i++) for (var j = 0; j < nx; j++) { var za = z0 - 0.15 + i * (z1 - z0 + 0.3) / nz + 0.01, zb = za + (z1 - z0 + 0.3) / nz - 0.02, xa = x0 - 0.15 + j * (x1 - x0 + 0.3) / nx + 0.01, xb = xa + (x1 - x0 + 0.3) / nx - 0.02, ya = lerp(yf, yr, (xa - x0) / (x1 - x0)) + 0.06, ybb = lerp(yf, yr, (xb - x0) / (x1 - x0)) + 0.06;
      K.face("pv", 0xffffff, [xa, ya, za], [xa, ya, zb], [xb, ybb, zb], [xb, ybb, za], [0, 1, 0], [0, 1], [0.5, 1], [0.5, 0], [0, 0]); }
    K.beam("metal", green, [x0 - 0.22, yf + 0.04, z0 - 0.22], [x0 - 0.22, yf + 0.04, z1 + 0.22], 0.08, 0.36); K.beam("metal", green, [x1 + 0.22, yr + 0.04, z0 - 0.22], [x1 + 0.22, yr + 0.04, z1 + 0.22], 0.06, 0.2);
    K.beam("metal", green, [x0 - 0.22, yf + 0.04, z0 - 0.22], [x1 + 0.22, yr + 0.04, z0 - 0.22], 0.06, 0.24); K.beam("metal", green, [x0 - 0.22, yf + 0.04, z1 + 0.22], [x1 + 0.22, yr + 0.04, z1 + 0.22], 0.06, 0.24);
    // glass back and the two side wings (frames dark), a concrete plinth
    K.aab("std", 0xc9c3b6, x1 - 0.4, x1 - 0.1, y0 - 0.15, y0 + 0.1, z0, z1); K.aab("glass", 0xffffff, x1 - 0.27, x1 - 0.23, y0 + 0.1, yr - 0.1, z0 + 0.4, z1 - 0.4); [z0 + 0.3, z1 - 0.3].forEach(function (z) { K.aab("glass", 0xffffff, x0 + 1.2, x1 - 0.3, y0 + 0.1, yr - 0.15, z - 0.02, z + 0.02); K.aab("metal", steel, x0 + 1.15, x1 - 0.25, y0 + 0.08, y0 + 0.14, z - 0.04, z + 0.04); });
    for (var zz = z0 + 0.4; zz <= z1 - 0.39; zz += 2.0) K.box("metal", steel, 0.05, yr - y0 - 0.2, 0.05, x1 - 0.25, y0 + 0.1, zz);
    // the fascia signs (both faces of the front fascia) and the inside of the back glass: the hub's name
    var uv = slot("hubfascia", 1024, 96, function (x, w, h) { x.fillStyle = "#123a22"; x.fillRect(0, 0, w, h); x.fillStyle = "#4DDE6F"; x.fillRect(0, h - 6, w, 6); txt(x, C("names.hubSign", "SHUTTLE HUB · SOLAR CAR PARK"), w * 0.42, h / 2, "700 50px " + SANS, "#f4f1e6", "center", w * 0.66, 3); if (!logo(x, w * 0.88, h / 2 - 2, 56)) txt(x, "GIVEBACK", w * 0.88, h / 2, "800 40px " + SANS, "#4DDE6F"); });
    signQuad(SP.KS, uv, 6.4, 0.6, x0 - 0.27, yf + 0.22, (z0 + z1) / 2, -PI / 2); signQuad(SP.KS, uv, 6.4, 0.6, x1 + 0.27, yr + 0.14, (z0 + z1) / 2, PI / 2);
    bench(K, x1 - 0.75, 87.6, -PI / 2, 3.6, false); bench(K, x1 - 0.75, 94.4, -PI / 2, 3.6, false);
    SP.shelter = { x0: x0, x1: x1, z0: z0, z1: z1, y0: y0, yf: yf, yr: yr };
    sol(x1 - 0.25, (z0 + z1) / 2, 0, 0.3, z1 - z0, y0, yr); [z0 + 0.3, z1 - 0.3].forEach(function (z) { sol((x0 + 1.2 + x1) / 2, z, 0, x1 - x0 - 1.2, 0.1, y0, yr - 0.1); sol(x0 + 0.35, z, 0, 0.14, 0.14, y0, yf); });
    // the live arrivals board, hung under the roof at the north end (double sided), and its frame
    var bx = -456.9, bz = z0 + 0.55, byc = y0 + 2.3; K.aab("metal", 0x1b1d1f, bx - 1.42, bx + 1.42, byc - 0.62, byc + 0.62, bz - 0.09, bz + 0.09); K.beam("metal", steel, [bx - 1.1, byc + 0.6, bz], [bx - 1.1, lerp(yf, yr, (bx - 1.1 - x0) / (x1 - x0)) - 0.05, bz], 0.04, 0.04); K.beam("metal", steel, [bx + 1.1, byc + 0.6, bz], [bx + 1.1, lerp(yf, yr, (bx + 1.1 - x0) / (x1 - x0)) - 0.05, bz], 0.04, 0.04);
    SP.boardAt = { x: bx, y: byc, z: bz, w: 2.7, h: 1.12 };
  }
  // the route map totem: the Grand Loop drawn as a ring with its stops, YOU ARE HERE
  function routeMapSlot() { return slot("routemap", 448, 784, function (x, w, h) { x.fillStyle = "#0d1f15"; x.fillRect(0, 0, w, h); x.fillStyle = "#4DDE6F"; x.fillRect(0, 0, w, 10);
      txt(x, "GRAND LOOP", w / 2, 58, "700 52px " + DISP, "#f4f1e6", "center", w - 40, 4); txt(x, C("names.mapSub", "ELECTRIC SHUTTLE · ALL THREE STAGES"), w / 2, 104, "600 22px " + SANS, "#9fe8b2", "center", w - 40, 2);
      var stops = (C("routeMap", []) || []), n = stops.length, top = 150, step = (h - top - 70) / Math.max(1, n - 1);
      x.strokeStyle = "#4DDE6F"; x.lineWidth = 10; x.beginPath(); x.moveTo(70, top); x.lineTo(70, top + step * (n - 1)); x.stroke(); x.lineWidth = 4; x.strokeStyle = "rgba(77,222,111,0.45)"; x.beginPath(); x.moveTo(70, top + step * (n - 1)); x.quadraticCurveTo(28, top + step * (n - 1) + 40, 34, top + step * (n - 1) / 2); x.quadraticCurveTo(28, top - 40, 70, top); x.stroke();
      stops.forEach(function (s, i) { var y = top + i * step, here = /solar cart? park/i.test(s); x.fillStyle = here ? "#f4cd5a" : "#f4f1e6"; x.beginPath(); x.arc(70, y, here ? 14 : 9, 0, TAU); x.fill(); x.strokeStyle = "#0d1f15"; x.lineWidth = 3; x.stroke(); txt(x, s.toUpperCase(), 100, y, (here ? "700 " : "600 ") + "22px " + SANS, here ? "#f4cd5a" : "#e9e5d8", "left", w - 120, 1); if (here) txt(x, "YOU ARE HERE", 100, y + 22, "700 15px " + SANS, "#f4cd5a", "left", w - 120, 2); });
      txt(x, C("names.mapFoot", "PRESS F BESIDE THE SHUTTLE TO RIDE"), w / 2, h - 30, "600 19px " + SANS, "#9fe8b2", "center", w - 40, 2); }, 512, 896); }
  function totem(K, x, z, ry, uv, w, h, col) { var y0 = sY(x, z), F = new Fr(x, y0, z, ry);
    var M = K.mark(); K.box("std", col || 0x2b3a33, w + 0.2, h + 0.5, 0.26, 0, 0, 0); K.box("std", 0xc9c3b6, w + 0.5, 0.18, 0.5, 0, -0.1, 0); K.place(M, x, y0, z, ry);
    var a = F.w(0, 0.135), b = F.w(0, -0.135); signQuad(SP.KS, uv, w, h, a[0], y0 + 0.35 + h / 2, a[1], ry); signQuad(SP.KS, uv, w, h, b[0], y0 + 0.35 + h / 2, b[1], ry + PI); sol(x, z, ry, w + 0.2, 0.3, y0, y0 + h + 0.5); }
  function lightPole(K, x, z, h) { var y0 = sY(x, z); K.cyl("metal", 0x2b3a33, 0.07, 0.1, h, x, y0 - 0.2, z, 8); K.box("metal", 0x2b3a33, 0.9, 0.12, 0.3, x + 0.35, y0 + h - 0.2, z); K.box("glow", 0xfff1dc, 0.7, 0.03, 0.2, x + 0.38, y0 + h - 0.22, z); SP.KP.quad("pool", 0xffe7c4, 9, 9, x + 0.4, sY(x, z) + 0.035, z, 0, -PI / 2, [0, 0, 1, 1]); (SP.lampSpots = SP.lampSpots || []).push([x + 0.4, y0 + h - 0.4, z]); sol(x, z, 0, 0.22, 0.22, y0, y0 + h); }
  function buildHub() {
    var K = SP.K, I = S.ISLAND;
    island(K, I, "stone");
    shelter(K);
    totem(K, -456.6, 101.2, -PI / 2, routeMapSlot(), 1.1, 1.92);
    var hu = slot("hubtotem", 224, 560, function (x, w, h) { x.fillStyle = "#123a22"; x.fillRect(0, 0, w, h); x.fillStyle = "#4DDE6F"; x.fillRect(0, 0, w, 8); txt(x, "SHUTTLE", w / 2, 120, "700 64px " + DISP, "#f4f1e6", "center", w - 30, 4); txt(x, "HUB", w / 2, 196, "700 64px " + DISP, "#4DDE6F", "center", w - 30, 6); txt(x, "GRAND LOOP", w / 2, 290, "600 26px " + SANS, "#e9e5d8", "center", w - 30, 3); txt(x, "BIKE SHARE", w / 2, 340, "600 26px " + SANS, "#e9e5d8", "center", w - 30, 3); txt(x, "CART SHARE", w / 2, 390, "600 26px " + SANS, "#e9e5d8", "center", w - 30, 3); txt(x, "DROP-OFF", w / 2, 440, "600 26px " + SANS, "#e9e5d8", "center", w - 30, 3); txt(x, "SUNFIELD CONVENTION CENTER", w / 2, 560, "600 15px " + SANS, "#9fe8b2", "center", w - 24, 2); }, 256, 640);
    totem(K, -449.7, 67.6, 0, hu, 0.95, 2.4);
    // bike share: a dock rail with eight bikes and a kiosk on the island's east side
    var dock = [-442.2, 69.2, 79.6]; for (var z = dock[1] + 0.6; z < dock[2]; z += 1.25) { K.box("metal", 0x2b3a33, 0.12, 0.85, 0.12, dock[0] + 0.55, sY(dock[0], z) - 0.05, z); bike(K, dock[0], z, PI / 2, [0x2a7a3e, 0x1f6b3a, 0x3a8f4f][Math.round(z) % 3]); }
    K.box("metal", 0x2b3a33, 0.08, 0.08, dock[2] - dock[1], dock[0] + 0.55, sY(dock[0], (dock[1] + dock[2]) / 2) + 0.75, (dock[1] + dock[2]) / 2);
    sol(dock[0], (dock[1] + dock[2]) / 2, 0, 1.9, dock[2] - dock[1], sY(dock[0], 74), sY(dock[0], 74) + 1.1);
    var bk = slot("bikeshare", 256, 96, function (x, w, h) { x.fillStyle = "#1f6b3a"; x.fillRect(0, 0, w, h); txt(x, "BIKE SHARE", w / 2, h / 2, "700 34px " + SANS, "#f4f1e6", "center", w - 20, 3); });
    totem(K, -442.6, 81.3, PI / 2, bk, 0.8, 0.3, 0x2b3a33);
    // cart share bays (painted), the carts are the client's own kind (terrain hook)
    var cs = slot("cartshare", 256, 96, function (x, w, h) { x.fillStyle = "#1f6b3a"; x.fillRect(0, 0, w, h); txt(x, "CART SHARE", w / 2, h / 2, "700 34px " + SANS, "#f4f1e6", "center", w - 20, 3); });
    totem(K, -442.6, 99.0, PI / 2, cs, 0.8, 0.3, 0x2b3a33);
    bench(K, -452.7, 91, -PI / 2, 2.4, true); bench(K, -448.3, 91, PI / 2, 2.4, true);
    [[-457.6, 70.2], [-457.6, 111.6], [-441.6, 111.6], [-441.6, 66.8]].forEach(function (q) { lightPole(K, q[0], q[1], 5.2); });
    // the park's monument at the connector and a fingerpost at the west walk
    var ps = slot("parksign", 768, 192, function (x, w, h) { x.fillStyle = "#e9e1d0"; x.fillRect(0, 0, w, h); x.fillStyle = "#1f6b3a"; x.fillRect(0, h - 14, w, 14); txt(x, C("names.park", "SOLAR CAR PARK"), w * 0.4, h * 0.38, "700 66px " + DISP, "#1d2a22", "center", w * 0.7, 5); txt(x, C("names.parkSub", "SHUTTLE HUB · EV CHARGING · MARKET GARDEN"), w * 0.4, h * 0.72, "600 24px " + SANS, "#3a5a44", "center", w * 0.72, 2); if (!logo(x, w * 0.87, h * 0.45, 70)) txt(x, "GIVEBACK", w * 0.87, h * 0.45, "800 34px " + SANS, "#1f6b3a"); });
    totem(K, -443.8, 128.6, 0, ps, 3.6, 0.9, 0x8a6a4a); totem(K, -472.2, 55.6, -PI / 2, ps, 3.0, 0.75, 0x8a6a4a);
  }

  // ───────────────────────── the Market Garden: beds and crops, corn rows, the orchard, the greenhouse, the stand, shed, compost, coop ─────────────────────────
  var LEAF = { vine: [[0.0, 0.25, 0.167, 1.0], [0.167, 0.25, 0.333, 1.0], [0.333, 0.25, 0.5, 1.0]], grass: [0.5, 0.5, 1.0, 1.0], green: [0.5, 0.168, 1.0, 0.5] };
  function card(K, uv, w, h, x, y, z, ry, tint, ua, ub) { var u0 = ua === undefined ? uv[0] : lerp(uv[0], uv[2], ua), u1 = ub === undefined ? uv[2] : lerp(uv[0], uv[2], ub); return K.quad("leaf", tint || 0xffffff, w, h, x, y, z, ry || 0, 0, [u0, uv[1], u1, uv[3]]); }
  // the generated garden atlas (tex/sp_garden.png): side-view cut-outs of the crops and the three orchard trees [u0, v0, u1, v1, w/h]
  var SPR = { pepper: [0.0439, 0.7529, 0.196, 0.9971, 0.62], squash: [0.2715, 0.7529, 0.4775, 0.9971, 0.844], kale: [0.541, 0.7529, 0.708, 0.9971, 0.684], lettuce: [0.7627, 0.7529, 0.9873, 0.9971, 0.92], chard: [0.0518, 0.5029, 0.1982, 0.7471, 0.6], basil: [0.2979, 0.5029, 0.4521, 0.7471, 0.632], tomato: [0.5615, 0.5029, 0.6885, 0.7471, 0.52], herb: [0.7959, 0.5029, 0.9541, 0.7471, 0.648], citrus: [0.0234, 0.0029, 0.3086, 0.4971, 0.577], pomegranate: [0.373, 0.0029, 0.625, 0.4971, 0.51], olive: [0.6797, 0.0029, 0.9863, 0.4971, 0.621] };
  // a plant as two or three crossed cut-out cards standing on (x, y, z), h tall
  function sprite(K, key, x, y, z, h, ry, n, tint) { var q = SPR[key]; if (!q) return; var w = h * q[4]; n = n || 2; for (var i = 0; i < n; i++) K.quad("crop", tint || 0xffffff, w, h, x, y + h / 2 - 0.02, z, ry + i * PI / n, 0, [q[0], q[1], q[2], q[3]]); }
  function shade(hex, k) { _c.setHex(hex); _c.multiplyScalar(k); return _c.getHex(); }
  // one crop plant at (x, y, z), scale s: procedural, a few dozen triangles each
  var CROPH = { pepper: 0.62, squash: 0.5, kale: 0.58, lettuce: 0.3, chard: 0.55, basil: 0.45, tomato: 1.25, herb: 0.5 };
  function crop(K, kind, x, y, z, s, R) { var key = kind === "greens" ? (R() < 0.5 ? "lettuce" : "kale") : kind === "herb" ? (R() < 0.5 ? "basil" : "herb") : kind; var h = (CROPH[key] || 0.5) * s; sprite(K, key, x, y, z, h, R() * PI, key === "squash" || key === "lettuce" ? 3 : 2, new THREE.Color(0.9 + R() * 0.12, 0.9 + R() * 0.12, 0.88 + R() * 0.1).getHex()); if (key === "tomato") K.cyl("stdn", 0x8a6a48, 0.012, 0.012, h + 0.1, x, y - 0.05, z, 4); }
  // a raised bed (w across x, l along z), timber boards or a corten box; soil, two rows of its crop, two drip lines with emitters
  function bed(K, B, R) {
    var x0 = B.x - B.w / 2, x1 = B.x + B.w / 2, z0 = B.z - B.l / 2, z1 = B.z + B.l / 2, gs = [gh(x0, z0), gh(x1, z0), gh(x0, z1), gh(x1, z1)], g0 = Math.min.apply(null, gs) - 0.12, top = Math.max.apply(null, gs) + B.h;
    if (B.mat === "wood") { var t = 0.06; K.aab("wood", 0xb08860, x0, x1, g0, top, z0, z0 + t); K.aab("wood", 0xb08860, x0, x1, g0, top, z1 - t, z1); K.aab("wood", 0xa88058, x0, x0 + t, g0, top, z0, z1); K.aab("wood", 0xa88058, x1 - t, x1, g0, top, z0, z1); [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].forEach(function (c) { K.box("wood", 0x8a6a48, 0.1, top - g0 + 0.04, 0.1, c[0] + (c[0] < B.x ? 0.05 : -0.05), g0, c[1] + (c[1] < B.z ? 0.05 : -0.05)); }); K.aab("wood", 0xc09a70, x0 - 0.03, x1 + 0.03, top, top + 0.04, z0 - 0.03, z0 + 0.12); K.aab("wood", 0xc09a70, x0 - 0.03, x1 + 0.03, top, top + 0.04, z1 - 0.12, z1 + 0.03); }
    else { var tc = 0.025; K.aab("corten", 0xffffff, x0, x1, g0, top, z0, z0 + tc); K.aab("corten", 0xffffff, x0, x1, g0, top, z1 - tc, z1); K.aab("corten", 0xf0e8e0, x0, x0 + tc, g0, top, z0, z1); K.aab("corten", 0xf0e8e0, x1 - tc, x1, g0, top, z0, z1); K.aab("corten", 0xe8d8c8, x0 - 0.02, x1 + 0.02, top, top + 0.03, z0 - 0.02, z0 + 0.06); K.aab("corten", 0xe8d8c8, x0 - 0.02, x1 + 0.02, top, top + 0.03, z1 - 0.06, z1 + 0.02); }
    var ys = top - 0.07; K.face("soilq", 0xffffff, [x0 + 0.05, ys, z0 + 0.05], [x1 - 0.05, ys, z0 + 0.05], [x1 - 0.05, ys, z1 - 0.05], [x0 + 0.05, ys, z1 - 0.05], [0, 1, 0], [x0 / 2, z0 / 2], [x1 / 2, z0 / 2], [x1 / 2, z1 / 2], [x0 / 2, z1 / 2]);
    [-0.28, 0.28].forEach(function (dx) { K.beam("stdn", 0x161616, [B.x + dx, ys + 0.015, z0 + 0.15], [B.x + dx, ys + 0.015, z1 - 0.15], 0.018, 0.018); });
    var n = Math.floor((B.l - 0.4) / (B.crop === "squash" ? 0.95 : B.crop === "tomato" ? 0.8 : 0.48)); for (var i = 0; i < n; i++) { var z = z0 + 0.35 + (i + 0.5) * (B.l - 0.7) / n; (B.crop === "squash" || B.crop === "tomato" ? [0] : [-0.3, 0.3]).forEach(function (dx) { crop(K, B.crop, B.x + dx + (R() - 0.5) * 0.06, ys, z + (R() - 0.5) * 0.08, 0.9 + R() * 0.3, R); }); }
    sol(B.x, B.z, 0, B.w, B.l, g0, top + 0.02); return top;
  }
  function cornRow(K, row, R) { for (var z = row.z0; z < row.z1; z += 0.42) { var x = row.x + (R() - 0.5) * 0.08, y = gh(x, z) + 0.05, h = 1.7 + R() * 0.5; K.cyl("stdn", 0x6f8a3a, 0.018, 0.026, h, x, y - 0.05, z, 4); for (var l = 0; l < 4; l++) { var a = R() * TAU, yy = y + h * (0.3 + l * 0.15), L = 0.55 + R() * 0.2, ex = x + Math.cos(a) * L, ez = z + Math.sin(a) * L; K.tris3("stdn", shade(0x6a8e36, 0.85 + R() * 0.3), [[x, yy, z], [ex, yy + 0.18 - R() * 0.25, ez], [x + Math.cos(a + 0.5) * 0.08, yy + 0.14, z + Math.sin(a + 0.5) * 0.08]]); } K.cyl("stdn", 0xc8a85a, 0.004, 0.02, 0.22, x, y + h - 0.02, z, 3); if (R() < 0.5) K.ico("stdn", 0xb8b060, 0.045, x + 0.05, y + h * 0.55, z, 0.8, 2.4, 0.8); }
    K.beam("stdn", 0x161616, [row.x + 0.18, gh(row.x, row.z0) + 0.07, row.z0], [row.x + 0.18, gh(row.x, row.z1) + 0.07, row.z1], 0.018, 0.018); }
  function squashRow(K, row, R) { for (var z = row.z0 + 0.6; z < row.z1; z += 1.1) crop(K, "squash", row.x + (R() - 0.5) * 0.2, gh(row.x, z) + 0.05, z, 1.4 + R() * 0.3, R); K.beam("stdn", 0x161616, [row.x, gh(row.x, row.z0) + 0.07, row.z0], [row.x, gh(row.x, row.z1) + 0.07, row.z1], 0.018, 0.018); }
  // orchard trees: a trunk and a jittered cluster of crown lobes, fruit on the citrus and pomegranates; a mulch ring and drip emitter
  function tree(K, T, R) { var y = gh(T.x, T.z) + 0.05, s = T.s, kind = T.kind, h = (kind === "olive" ? 3.7 : kind === "pomegranate" ? 3.1 : 3.3) * s;
    sprite(K, kind, T.x, y, T.z, h, R() * PI, 3);
    sprite(K, kind, T.x, y, T.z, h * 0.96, R() * PI + PI / 6, 3);
    var ring = drape(rect(T.x - 1.2, T.z - 1.2, T.x + 1.2, T.z + 1.2), 1.2, 0.07, 2); gput("mulch", ring); K.cyl("stdn", 0x161616, 0.02, 0.02, 0.05, T.x + 0.5, y, T.z, 4);
    if (typeof COLLIDERS !== "undefined") COLLIDERS.push([T.x, T.z, 0.35]); }
  // the hoop greenhouse: galvanised hoops every 2 m on a side wall, twin-wall polycarbonate skin, end walls with doors, benches inside
  function greenhouse(K, G) {
    var H = G.gh, nb = Math.round((H.x1 - H.x0) / 2), zc = (H.z0 + H.z1) / 2, hw = (H.z1 - H.z0) / 2, wall = 1.1, rise = 3.2, prof = [];
    for (var i = 0; i <= 12; i++) { var a = i / 12 * PI; prof.push([zc - Math.cos(a) * hw, wall + Math.sin(a) * rise * (1 - 0.18 * Math.pow(Math.cos(a), 2))]); }
    prof.unshift([H.z0, 0]); prof.push([H.z1, 0]);
    var xs = []; for (var b = 0; b <= nb; b++) xs.push(lerp(H.x0, H.x1, b / nb)); var base = function (x) { return Math.min(gh(x, H.z0), gh(x, H.z1)) - 0.05; };
    xs.forEach(function (x) { var y0 = base(x); for (var k = 0; k < prof.length - 1; k++) K.tube("metal", 0xb6bcc0, [x, y0 + prof[k][1], prof[k][0]], [x, y0 + prof[k + 1][1], prof[k + 1][0]], 0.03, 5); });
    [0.35, 0.65].forEach(function (f) { var k = Math.round(f * (prof.length - 1)); K.tube("metal", 0xb6bcc0, [H.x0, base(H.x0) + prof[k][1], prof[k][0]], [H.x1, base(H.x1) + prof[k][1], prof[k][0]], 0.025, 5); }); var kr = Math.floor(prof.length / 2); K.tube("metal", 0xb6bcc0, [H.x0, base(H.x0) + prof[kr][1], prof[kr][0]], [H.x1, base(H.x1) + prof[kr][1], prof[kr][0]], 0.03, 5);
    // the skin: one strip per profile facet per bay (the base board below it), both ends glazed round the doors
    for (var bb = 0; bb < nb; bb++) { var xa = xs[bb], xb = xs[bb + 1], ya = base(xa), yb = base(xb); for (var k2 = 0; k2 < prof.length - 1; k2++) { var p = prof[k2], q = prof[k2 + 1], oz = (p[0] + q[0]) / 2 - zc, oy = (p[1] + q[1]) / 2; K.face("poly", 0xffffff, [xa, ya + p[1], p[0]], [xb, yb + p[1], p[0]], [xb, yb + q[1], q[0]], [xa, ya + q[1], q[0]], [0, oy, oz]); }
      [H.z0, H.z1].forEach(function (z) { K.face("wood", 0x8a6a48, [xa, ya - 0.1, z], [xb, yb - 0.1, z], [xb, yb + 0.35, z], [xa, ya + 0.35, z], [0, 0, z < zc ? -1 : 1]); }); }
    [H.x0, H.x1].forEach(function (x, ei) { var y0 = base(x), out = ei ? 1 : -1, dz0 = zc - 0.7, dz1 = zc + 0.7, dh = 2.2;
      for (var k3 = 1; k3 < prof.length - 2; k3++) { var A = prof[k3], B = prof[k3 + 1]; var pts = [[x, y0, A[0]], [x, y0 + A[1], A[0]], [x, y0 + B[1], B[0]], [x, y0, B[0]]]; if (B[0] <= dz0 || A[0] >= dz1) K.face("poly", 0xffffff, pts[0], pts[1], pts[2], pts[3], [out, 0, 0]); else { var Aa = Math.max(A[0], dz0), Bb = Math.min(B[0], dz1); if (A[0] < dz0) K.face("poly", 0xffffff, [x, y0, A[0]], [x, y0 + A[1], A[0]], [x, y0 + lerp(A[1], B[1], (dz0 - A[0]) / (B[0] - A[0])), dz0], [x, y0, dz0], [out, 0, 0]); if (B[0] > dz1) K.face("poly", 0xffffff, [x, y0, dz1], [x, y0 + lerp(A[1], B[1], (dz1 - A[0]) / (B[0] - A[0])), dz1], [x, y0 + B[1], B[0]], [x, y0, B[0]], [out, 0, 0]); K.face("poly", 0xffffff, [x, y0 + dh, Aa], [x, y0 + lerp(A[1], B[1], (Aa - A[0]) / (B[0] - A[0])), Aa], [x, y0 + lerp(A[1], B[1], (Bb - A[0]) / (B[0] - A[0])), Bb], [x, y0 + dh, Bb], [out, 0, 0]); } }
      K.aab("wood", 0x7a5a3c, x - 0.06, x + 0.06, y0, y0 + dh + 0.1, dz0 - 0.08, dz0); K.aab("wood", 0x7a5a3c, x - 0.06, x + 0.06, y0, y0 + dh + 0.1, dz1, dz1 + 0.08); K.aab("wood", 0x7a5a3c, x - 0.06, x + 0.06, y0 + dh, y0 + dh + 0.1, dz0, dz1);
      sol(x, (H.z0 + dz0) / 2, 0, 0.14, dz0 - H.z0, y0, y0 + 2.6); sol(x, (dz1 + H.z1) / 2, 0, 0.14, H.z1 - dz1, y0, y0 + 2.6); });
    for (var sb = 0; sb < nb; sb++) { var sxa = xs[sb], sxb = xs[sb + 1], sy0 = Math.min(base(sxa), base(sxb)), sy1 = Math.max(base(sxa), base(sxb)) + 2.4; sol((sxa + sxb) / 2, H.z0 + 0.05, 0, sxb - sxa, 0.12, sy0, sy1); sol((sxa + sxb) / 2, H.z1 - 0.05, 0, sxb - sxa, 0.12, sy0, sy1); }
    gput("dg", drape(rect(H.x0 + 0.1, H.z0 + 0.1, H.x1 - 0.1, H.z1 - 0.1), 2, 0.06, 2));
    // benches of seedling trays along both sides, hanging baskets, a potting bench at the east end
    var R = rng(66); [H.z0 + 1.0, H.z1 - 1.0].forEach(function (bz) { for (var x = H.x0 + 1.2; x < H.x1 - 2.5; x += 2.4) { var y = gh(x, bz) + 0.05; K.box("metal", 0x9aa0a4, 2.2, 0.04, 1.1, x + 1.1, y + 0.76, bz); [[0.1, -0.5], [2.1, -0.5], [0.1, 0.5], [2.1, 0.5]].forEach(function (o) { K.box("metal", 0x9aa0a4, 0.04, 0.76, 0.04, x + o[0], y, bz + o[1]); }); for (var t = 0; t < 4; t++) { var tx = x + 0.3 + t * 0.52; K.box("std", 0x2a2a2a, 0.48, 0.06, 0.95, tx, y + 0.8, bz); for (var s = 0; s < 8; s++) K.ico("stdn", shade(0x6aa63c, 0.8 + R() * 0.4), 0.04, tx + (s % 2 - 0.5) * 0.2, y + 0.9, bz + (Math.floor(s / 2) - 1.5) * 0.22, 1, 0.6, 1); } sol(x + 1.1, bz, 0, 2.2, 1.1, y, y + 0.82); } });
    for (var hx = H.x0 + 3; hx < H.x1 - 2; hx += 4.5) { var hy = base(hx) + wall + rise * 0.8; K.tube("std", 0x333333, [hx, hy + 0.6, zc], [hx, hy, zc], 0.008, 3); K.lathe("std", 0x8a6a48, [[0.0, 0], [0.18, 0], [0.24, 0.16]], hx, hy - 0.16, zc, 8); sprite(K, "basil", hx, hy - 0.05, zc, 0.5, 0, 2); }
    SP.ghBox = { x0: H.x0, x1: H.x1, z0: H.z0, z1: H.z1 };
  }
  // the farm stand: timber posts, a shed roof of corrugated steel, a sloped display of produce crates, a chalkboard, the sign
  function stand(K, G) {
    var T = G.stand, F = new Fr(T.x, 0, T.z, T.ry), y0 = Math.max(gh(F.w(-3, -1.6)[0], F.w(-3, -1.6)[1]), gh(F.w(3, 1.6)[0], F.w(3, 1.6)[1]), gh(F.w(-3, 1.6)[0], F.w(-3, 1.6)[1]), gh(F.w(3, -1.6)[0], F.w(3, -1.6)[1])) + 0.06, M = K.mark(), R = rng(512);
    K.box("wood", 0x8a6a48, 6.4, 0.55, 3.4, 0, -0.55, 0);   // the deck (its skirt reaches the ground)
    [[-3, 1.5], [3, 1.5], [-3, -1.5], [3, -1.5]].forEach(function (p) { K.box("wood", 0x6a4a30, 0.16, (p[1] > 0 ? 2.75 : 2.45) + 0.5, 0.16, p[0], -0.5, p[1]); });
    K.face("metal", 0x8a9095, [-3.4, 2.8, 2.0], [3.4, 2.8, 2.0], [3.4, 2.5, -1.8], [-3.4, 2.5, -1.8], [0, 1, 0]); K.face("std", 0xd9c8a8, [-3.4, 2.77, 2.0], [3.4, 2.77, 2.0], [3.4, 2.47, -1.8], [-3.4, 2.47, -1.8], [0, -1, 0]);
    K.beam("wood", 0x6a4a30, [-3.3, 2.7, 1.5], [3.3, 2.7, 1.5], 0.12, 0.16); K.beam("wood", 0x6a4a30, [-3.3, 2.42, -1.5], [3.3, 2.42, -1.5], 0.12, 0.16);
    // the counter and the sloped crate display in front of it
    K.box("wood", 0x9a7650, 5.6, 0.95, 0.7, 0, 0, 0.6); K.box("wood", 0xb08a60, 5.8, 0.05, 0.8, 0, 0.95, 0.6);
    var produce = [0xd2321e, 0xf08a1a, 0xe8d040, 0x5f8a34, 0x7a3a8a, 0xe0b040, 0x3c7a24, 0xb82432, 0xd8a050, 0x8fbf4a];
    for (var c = 0; c < 8; c++) { var cx = -2.45 + c * 0.7, col = produce[c % produce.length]; K.box("wood", 0xc09a70, 0.62, 0.22, 0.46, cx, 0.98, 0.62, 0, -0.25); for (var f = 0; f < 9; f++) K.ico("stdn", shade(col, 0.85 + R() * 0.3), 0.065, cx + (f % 3 - 1) * 0.17, 1.15 + Math.floor(f / 3) * 0.02 + 0.03, 0.5 + Math.floor(f / 3) * 0.13, 1, 1, 1, 0, 1); }
    for (var c2 = 0; c2 < 5; c2++) { var bx = -2.2 + c2 * 1.1; K.lathe("std", 0xc9a06a, [[0, 0], [0.2, 0], [0.26, 0.12], [0.28, 0.26]], bx, 0, 1.45, 10); for (var f2 = 0; f2 < 5; f2++) K.ico("stdn", produce[(c2 * 3 + f2) % produce.length], 0.07, bx + (R() - 0.5) * 0.2, 0.28, 1.45 + (R() - 0.5) * 0.2, 1, 1, 1, 0, 1); }
    // back shelves with jars and boxes, a scale, a chalkboard
    K.box("wood", 0x8a6a48, 5.4, 1.6, 0.4, 0, 0, -1.25); for (var sh = 0; sh < 2; sh++) for (var j = 0; j < 14; j++) K.cyl("std", [0xd8a050, 0xc8241c, 0x7a3a8a, 0xe8d040][j % 4], 0.06, 0.06, 0.16, -2.4 + j * 0.37, 1.62 + sh * 0.0, -1.2, 8);
    K.box("metal", 0xc0c4c6, 0.3, 0.12, 0.3, 2.3, 1.0, 0.4); K.box("metal", 0xc0c4c6, 0.4, 0.02, 0.4, 2.3, 1.18, 0.4);
    K.place(M, T.x, y0, T.z, T.ry);
    var uv = slot("standsign", 768, 160, function (x, w, h) { x.fillStyle = "#2c2118"; x.fillRect(0, 0, w, h); x.strokeStyle = "#c9a06a"; x.lineWidth = 6; x.strokeRect(6, 6, w - 12, h - 12); txt(x, C("names.stand", "FARM STAND"), w * 0.42, h * 0.4, "700 64px " + DISP, "#f4e9c8", "center", w * 0.66, 5); txt(x, C("names.standSub", "PICKED THIS MORNING, 50 M FROM THE MARKET HALL"), w * 0.42, h * 0.76, "600 20px " + SANS, "#d9c08a", "center", w * 0.72, 1); if (!logo(x, w * 0.87, h / 2, 64)) txt(x, "GIVEBACK", w * 0.87, h / 2, "800 30px " + SANS, "#4DDE6F"); });
    var sp = F.w(0, 2.04); signQuad(SP.KS, uv, 4.2, 0.88, sp[0], y0 + 2.42, sp[1], T.ry);
    var menu = slot("standmenu", 256, 320, function (x, w, h) { x.fillStyle = "#1d211f"; x.fillRect(0, 0, w, h); x.strokeStyle = "#8a6a48"; x.lineWidth = 10; x.strokeRect(5, 5, w - 10, h - 10); txt(x, C("names.menuT", "TODAY"), w / 2, 40, "700 36px " + DISP, "#f4e9c8", "center", w - 30, 3); (C("menu", []) || []).forEach(function (l, i) { txt(x, l, w / 2, 86 + i * 34, "500 22px " + SANS, "#e9e2cc", "center", w - 30); }); });
    var mp = F.w(-3.6, 1.8); var M2 = K.mark(); K.box("wood", 0x6a4a30, 0.05, 1.3, 0.05, -0.35, 0, -0.18); K.box("wood", 0x6a4a30, 0.05, 1.3, 0.05, 0.35, 0, -0.18); K.box("wood", 0x3a2a1c, 0.8, 0.95, 0.04, 0, 0.42, 0); K.place(M2, mp[0], gh(mp[0], mp[1]), mp[1], T.ry + 0.25);
    var mq = new Fr(mp[0], 0, mp[1], T.ry + 0.25).w(0, 0.025); signQuad(SP.KS, menu, 0.7, 0.86, mq[0], gh(mp[0], mp[1]) + 0.9, mq[1], T.ry + 0.25);
    var cp = F.w(0, 0.6); sol(cp[0], cp[1], T.ry, 5.8, 0.8, y0 - 0.1, y0 + 1.0); var bp = F.w(0, -1.25); sol(bp[0], bp[1], T.ry, 5.4, 0.4, y0, y0 + 1.6); var dp = F.w(0, 0); sol(dp[0], dp[1], T.ry, 6.4, 3.4, y0 - 0.55, y0);
    [[-3, 1.5], [3, 1.5], [-3, -1.5], [3, -1.5]].forEach(function (p) { var w = F.w(p[0], p[1]); sol(w[0], w[1], T.ry, 0.18, 0.18, y0 - 0.4, y0 + 2.6); });
    SP.standAt = { x: F.w(1.9, 1.75)[0], z: F.w(1.9, 1.75)[1], y: gh(F.w(1.9, 1.75)[0], F.w(1.9, 1.75)[1]), farmer: F.w(-1.5, -0.55), talk: F.w(-1.9, 1.75), ry: T.ry, y0: y0 };
  }
  function pergola(K, P, R) { var x0 = P.x - P.w / 2, x1 = P.x + P.w / 2, z0 = P.z - P.d / 2, z1 = P.z + P.d / 2, top = Math.max(gh(x0, z0), gh(x1, z0), gh(x0, z1), gh(x1, z1)) + 2.9;
    [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [P.x, z0], [P.x, z1]].forEach(function (c) { K.box("wood", 0x6a4a30, 0.2, top - gh(c[0], c[1]) + 0.2, 0.2, c[0], gh(c[0], c[1]) - 0.1, c[1]); sol(c[0], c[1], 0, 0.22, 0.22, gh(c[0], c[1]), top); });
    [z0, z1].forEach(function (z) { K.box("wood", 0x7a5838, P.w + 0.8, 0.24, 0.12, P.x, top, z); }); for (var x = x0 - 0.2; x <= x1 + 0.2; x += 0.6) K.box("wood", 0x8a6a48, 0.07, 0.18, P.d + 0.6, x, top + 0.24, P.z);
    for (var i = 0; i < Math.round(P.w * 1.4); i++) { var vx = lerp(x0 + 0.3, x1 - 0.3, R()), vz = lerp(z0 + 0.3, z1 - 0.3, R()); card(K, LEAF.green, 1.6, 0.9, vx, top + 0.42, vz, R() * PI, 0xe0ecd0, R() * 0.4, R() * 0.4 + 0.5); K.quad("leaf", 0xd8e8c8, 1.3, 1.3, vx + 0.3, top + 0.45, vz + 0.2, R() * PI, -PI / 2, [LEAF.green[0] + 0.1, LEAF.green[1], LEAF.green[0] + 0.32, LEAF.green[3]]); }
    [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].forEach(function (c, j) { card(K, LEAF.vine[j % 3], 0.5, 2.2, c[0] + 0.12, top - 1.0, c[1] + (c[1] < P.z ? 0.12 : -0.12), j, 0xe8f0d8); }); }
  function picnic(K, x, z, ry) { var y0 = gh(x, z) + 0.035, M = K.mark(); K.box("wood", 0xa8784a, 1.9, 0.05, 0.85, 0, 0.73, 0); [-0.8, 0.8].forEach(function (lx) { K.box("wood", 0x7a5838, 0.08, 0.73, 0.7, lx, 0, 0); }); [-0.72, 0.72].forEach(function (lz) { K.box("wood", 0xa8784a, 1.9, 0.045, 0.3, 0, 0.43, lz); K.box("wood", 0x7a5838, 0.08, 0.43, 0.08, -0.8, 0, lz); K.box("wood", 0x7a5838, 0.08, 0.43, 0.08, 0.8, 0, lz); }); K.place(M, x, y0, z, ry);
    var F = new Fr(x, 0, z, ry); sol(x, z, ry, 1.9, 0.85, y0, y0 + 0.76); [-0.72, 0.72].forEach(function (lz) { var w = F.w(0, lz); sol(w[0], w[1], ry, 1.9, 0.3, y0, y0 + 0.46, true, ry + (lz < 0 ? 0 : PI)); }); }
  function shed(K, G) { var S0 = G.shed, x0 = S0.x - S0.w / 2, x1 = S0.x + S0.w / 2, z0 = S0.z - S0.d / 2, z1 = S0.z + S0.d / 2, g0 = Math.min(gh(x0, z0), gh(x1, z0), gh(x0, z1), gh(x1, z1)) - 0.1, y0 = Math.max(gh(x0, z0), gh(x1, z0), gh(x0, z1), gh(x1, z1)) + 0.12;
    K.aab("std", 0xb9b4aa, x0 - 0.1, x1 + 0.1, g0, y0, z0 - 0.1, z1 + 0.1); K.aab("wood", 0x8a5a3a, x0, x1, y0, y0 + 2.3, z0, z1); var ry = y0 + 2.3, rp = y0 + 3.2;
    K.face("metal", 0x6e7478, [x0 - 0.3, ry - 0.05, z0 - 0.3], [x1 + 0.3, ry - 0.05, z0 - 0.3], [x1 + 0.3, rp, S0.z], [x0 - 0.3, rp, S0.z], [0, 1, -1]); K.face("metal", 0x6e7478, [x0 - 0.3, ry - 0.05, z1 + 0.3], [x1 + 0.3, ry - 0.05, z1 + 0.3], [x1 + 0.3, rp, S0.z], [x0 - 0.3, rp, S0.z], [0, 1, 1]);
    [x0, x1].forEach(function (x) { K.tris3("wood", 0x8a5a3a, [[x, ry, z0], [x, ry, z1], [x, rp - 0.05, S0.z]]); K.tris3("wood", 0x8a5a3a, [[x, ry, z1], [x, ry, z0], [x, rp - 0.05, S0.z]]); });
    K.aab("std", 0x3a2a1e, S0.x - 0.6, S0.x + 0.6, y0, y0 + 2.0, z1, z1 + 0.04); K.aab("glass", 0xffffff, x0 - 0.02, x0, y0 + 1.1, y0 + 1.8, S0.z - 0.5, S0.z + 0.5);
    [0, 1, 2].forEach(function (i) { K.box("wood", 0x6a4a30, 0.05, 1.5, 0.05, x1 + 0.15, y0 - 0.1, z0 + 0.6 + i * 0.4, 0, 0.12); });
    sol(S0.x, S0.z, 0, S0.w, S0.d, g0, ry); }
  function compost(K, G) { var c = G.compost; for (var i = 0; i < 3; i++) { var x = c.x - 2.6 + i * 1.3 + 0.65, g0 = gh(x, c.z) - 0.05; for (var s = 0; s < 6; s++) { K.box("wood", 0x8a6a48, 1.2, 0.1, 0.05, x, g0 + s * 0.17, c.z - 0.6); K.box("wood", 0x8a6a48, 0.05, 0.1, 1.2, x - 0.6, g0 + s * 0.17, c.z); } K.ico("std", [0x3a2a1c, 0x4a3422, 0x5a4a2a][i], 0.62, x, g0 + 0.25, c.z, 1, 0.6 + i * 0.1, 1, i, 1); }
    K.box("wood", 0x8a6a48, 0.05, 1.0, 1.2, c.x + 1.3, gh(c.x + 1.3, c.z) - 0.05, c.z); sol(c.x - 0.65, c.z, 0, 3.9, 1.2, gh(c.x, c.z), gh(c.x, c.z) + 1.0); }
  // the chicken run's mesh fence, the coop on legs with its ramp and nest boxes
  function meshFence(K, A, B, h, post) { var L = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.max(1, Math.ceil(L / 2.4)); for (var i = 0; i <= n; i++) { var x = lerp(A[0], B[0], i / n), z = lerp(A[1], B[1], i / n); K.cyl(post === "wood" ? "wood" : "metal", post === "wood" ? 0x6a4a30 : 0x8a9095, 0.05, 0.05, h + 0.3, x, gh(x, z) - 0.3, z, 6); }
    for (var j = 0; j < n; j++) { var a = [lerp(A[0], B[0], j / n), lerp(A[1], B[1], j / n)], b = [lerp(A[0], B[0], (j + 1) / n), lerp(A[1], B[1], (j + 1) / n)], ya = gh(a[0], a[1]), yb = gh(b[0], b[1]), u = markUV("mesh"), sl = Math.hypot(b[0] - a[0], b[1] - a[1]); var nx = -(b[1] - a[1]) / sl, nz = (b[0] - a[0]) / sl;
      [1, -1].forEach(function (sd) { K.face("mark", 0x8a9093, [a[0], ya + 0.05, a[1]], [b[0], yb + 0.05, b[1]], [b[0], yb + h, b[1]], [a[0], ya + h, a[1]], [nx * sd, 0, nz * sd], [u[0], u[1]], [u[0] + (u[2] - u[0]) * Math.min(1, sl / 2.4), u[1]], [u[0] + (u[2] - u[0]) * Math.min(1, sl / 2.4), u[3]], [u[0], u[3]]); });
      K.beam("metal", 0x8a9095, [a[0], ya + h, a[1]], [b[0], yb + h, b[1]], 0.03, 0.03); sol((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -Math.atan2(b[1] - a[1], b[0] - a[0]), sl, 0.12, Math.min(ya, yb), Math.max(ya, yb) + h); } }
  function coop(K, G) { var c = G.coop, r = c.run, y0 = gh(c.x, c.z), M = K.mark();
    [[-1.1, -0.7], [1.1, -0.7], [-1.1, 0.7], [1.1, 0.7]].forEach(function (p) { K.box("wood", 0x6a4a30, 0.1, 0.75, 0.1, p[0], -0.1, p[1]); }); K.box("wood", 0xd8c8a0, 2.4, 1.1, 1.6, 0, 0.6, 0); K.box("wood", 0x8a5a3a, 2.5, 0.06, 1.7, 0, 0.6, 0);
    K.face("metal", 0x6e7478, [-1.4, 1.7, -1.0], [1.4, 1.7, -1.0], [1.4, 2.3, 0], [-1.4, 2.3, 0], [0, 1, -1]); K.face("metal", 0x6e7478, [-1.4, 1.7, 1.0], [1.4, 1.7, 1.0], [1.4, 2.3, 0], [-1.4, 2.3, 0], [0, 1, 1]); [-1.2, 1.2].forEach(function (x) { K.tris3("wood", 0xd8c8a0, [[x, 1.7, -0.8], [x, 1.7, 0.8], [x, 2.25, 0]]); K.tris3("wood", 0xd8c8a0, [[x, 1.7, 0.8], [x, 1.7, -0.8], [x, 2.25, 0]]); });
    K.box("std", 0x3a2a1e, 0.36, 0.42, 0.03, -0.5, 0.65, 0.81); K.box("wood", 0xa8784a, 0.4, 0.04, 1.4, -0.5, 0.0, 1.45, 0, 0.42); for (var i = 0; i < 3; i++) K.box("wood", 0xb08860, 0.55, 0.4, 0.5, 0.45 + 0, 0.65, -1.05 + 0 * i, 0); K.box("std", 0xc8241c, 0.5, 0.04, 0.5, 0.45, 1.06, -1.05);
    K.place(M, c.x, y0, c.z, 0); sol(c.x, c.z, 0, 2.5, 1.7, y0, y0 + 2.2);
    meshFence(K, [r[0], r[2]], [r[1], r[2]], 1.8); meshFence(K, [r[1], r[2]], [r[1], r[3]], 1.8); meshFence(K, [r[1], r[3]], [r[0], r[3]], 1.8); meshFence(K, [r[0], r[3]], [r[0], r[2] + 1.6], 1.8);
    K.box("wood", 0x6a4a30, 1.2, 0.04, 0.4, r[0] + 0.3, gh(r[0], r[2] + 0.9) + 0.9, r[2] + 0.8, PI / 2); SP.run = { x0: r[0] + 0.8, x1: r[1] - 0.8, z0: r[2] + 0.8, z1: r[3] - 0.8 };
    gput("soil", drape(rect(r[0] + 0.1, r[2] + 0.1, r[1] - 0.1, r[3] - 0.1), 1.5, 0.05, 2.5)); }
  function buildGarden() {
    var L = layout(), G = L.g, K = SP.K, R = rng(1357);
    G.beds.forEach(function (B) { try { bed(K, B, R); } catch (e) { note("bed", e); } });
    G.corn.forEach(function (row, i) { if (i % 3 === 2) squashRow(K, { x: row.x, z0: row.z0, z1: row.z1 }, R); else cornRow(K, row, R); });
    G.trees.forEach(function (T) { tree(K, T, R); });
    // drip lines down the orchard rows (on the mulch)
    for (var ix = 0; ix < 5; ix++) { var tx = -186 + ix * 6; for (var z = 96; z < 125; z += 3) K.beam("stdn", 0x161616, [tx + 0.6, gh(tx + 0.6, z) + 0.07, z], [tx + 0.6, gh(tx + 0.6, z + 3) + 0.07, z + 3], 0.018, 0.018); }
    greenhouse(K, G); stand(K, G); shed(K, G); compost(K, G); coop(K, G);
    G.trellis.forEach(function (P) { pergola(K, P, R); }); G.tables.forEach(function (t) { picnic(K, t[0], t[1], t[2]); });
    // the garden's fences: chain link along the taxiway corner, a rail and wire fence round the rest (gaps for the paths)
    var F = S.FENCE; for (var i = 0; i < F.length - 1; i++) meshFence(K, F[i], F[i + 1], 2.2);
    var rail = function (A, B) { var Lr = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.max(1, Math.ceil(Lr / 2.6)); for (var j = 0; j <= n; j++) { var x = lerp(A[0], B[0], j / n), z = lerp(A[1], B[1], j / n); K.box("wood", 0x6a4a30, 0.12, 1.25, 0.12, x, gh(x, z) - 0.2, z); } for (var k = 0; k < n; k++) { var a = [lerp(A[0], B[0], k / n), lerp(A[1], B[1], k / n)], b = [lerp(A[0], B[0], (k + 1) / n), lerp(A[1], B[1], (k + 1) / n)]; K.beam("wood", 0x7a5838, [a[0], gh(a[0], a[1]) + 1.0, a[1]], [b[0], gh(b[0], b[1]) + 1.0, b[1]], 0.08, 0.1); [0.35, 0.65].forEach(function (h) { K.beam("metal", 0x6a6e70, [a[0], gh(a[0], a[1]) + h, a[1]], [b[0], gh(b[0], b[1]) + h, b[1]], 0.01, 0.01); }); sol((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -Math.atan2(b[1] - a[1], b[0] - a[0]), Math.hypot(b[0] - a[0], b[1] - a[1]), 0.14, Math.min(gh(a[0], a[1]), gh(b[0], b[1])), Math.max(gh(a[0], a[1]), gh(b[0], b[1])) + 1.05); } };
    rail([-138.5, 69], [-138.5, 128]); rail([-138.5, 128], [-211.8, 128]); rail([-216.2, 128], [-243.5, 128]);
    var gs = slot("gardensign", 448, 560, function (x, w, h) { x.fillStyle = "#efe4cc"; x.fillRect(0, 0, w, h); x.fillStyle = "#3f6a28"; x.fillRect(0, 0, w, 16); txt(x, C("names.garden", "MARKET GARDEN"), w / 2, 92, "700 62px " + DISP, "#2c3a22", "center", w - 50, 4); txt(x, C("names.gardenSub", "Grown here for the Market Hall"), w / 2, 150, "italic 600 30px " + SERIF, "#5a4a2a", "center", w - 60);
      (C("gardenList", []) || []).forEach(function (l, i) { txt(x, l, w / 2, 230 + i * 44, "600 26px " + SANS, "#3a3424", "center", w - 70, 1); }); if (!logo(x, w / 2, h - 70, 70)) txt(x, "GIVEBACK", w / 2, h - 70, "800 34px " + SANS, "#2f7a3e"); }, 512, 640);
    totem(K, G.sign.x, G.sign.z, -PI / 2 - 0.5, gs, 1.3, 1.62, 0x6a4a30);
  }

  // ───────────────────────── parked cars: three generated models (sedan, SUV, pickup), two LODs each, one texture atlas, two BatchedMeshes ─────────────────────────
  // models/sp_car_<type>.glb (about 2,400 triangles) and _far.glb (about 1,300), white paint: the paint is recoloured per car in the
  // shader (bright, unsaturated texels take the car's colour, set by setColorAt), glass, tyres, wheels and lights keep the texture.
  var CARS = SP.cars = { state: "idle", near: null, far: null, list: [], at: 0, cx: 1e9, cz: 1e9, NEAR: 55, FAR: 520 };
  try { var QL = (localStorage.getItem("g1:quality") || "high"); if (QL === "low") { CARS.NEAR = 32; CARS.FAR = 340; } else if (QL === "medium") { CARS.NEAR = 42; CARS.FAR = 420; } } catch (e) {}
  var CAR_TYPES = ["sedan", "suv", "pickup"];
  function carMat(tex) {
    var m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.38, metalness: 0.35, envMapIntensity: 0.9 }); m.name = "sp_car";
    m.onBeforeCompile = function (sh) { sh.fragmentShader = sh.fragmentShader.replace("#include <color_fragment>", "#if defined( USE_COLOR )\n{ float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)); float sat = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b)); float paint = smoothstep(0.24, 0.42, lum) * (1.0 - smoothstep(0.07, 0.16, sat)); diffuseColor.rgb = mix(diffuseColor.rgb, vColor.rgb * (0.25 + lum * 0.95), paint); }\n#endif"); };
    m.customProgramCacheKey = function () { return "sp_car_v1"; }; return m;
  }
  function loadCars() {
    if (CARS.state !== "idle") return; CARS.state = "loading"; var L = new THREE.GLTFLoader(); try { if (typeof MeshoptDecoder !== "undefined" && L.setMeshoptDecoder) L.setMeshoptDecoder(MeshoptDecoder); } catch (e) {}
    var files = []; CAR_TYPES.forEach(function (t) { files.push("/models/sp_car_" + t + ".glb", "/models/sp_car_" + t + "_far.glb"); });
    var v = "?v=" + (window.BUILD || "dev"); Promise.all(files.map(function (f) { var u = f + v; try { if (window.AV) u = window.AV(u); } catch (e) {} return new Promise(function (res) { L.load(u, function (g) { res(g); }, undefined, function (e) { note("car load " + f, e); res(null); }); }); })).then(function (gl) {
      try { if (gl.some(function (g) { return !g; })) { CARS.state = "fail"; return; } buildCars(gl); } catch (e) { note("cars", e); CARS.state = "fail"; } });
  }
  function meshOf(g) { var m = null; g.scene.updateMatrixWorld(true); g.scene.traverse(function (o) { if (o.isMesh && !m) m = o; }); return m; }
  function buildCars(gl) {
    // the atlas: the three 512 px textures side by side; uvs remapped into thirds
    var imgs = [0, 1, 2].map(function (i) { var m = meshOf(gl[i * 2]); return m.material.map ? m.material.map.image : null; }), W = 512, cv = document.createElement("canvas"); cv.width = W * 3; cv.height = W; var x = cv.getContext("2d");
    imgs.forEach(function (im, i) { if (im) x.drawImage(im, i * W, 0, W, W); }); var tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 4; tex.name = "sp_cars";
    var geos = gl.map(function (g, gi) { var m = meshOf(g), geo = m.geometry.clone(); geo.applyMatrix4(m.matrixWorld); var keep = { position: 1, normal: 1, uv: 1 }; for (var a in geo.attributes) if (!keep[a]) geo.deleteAttribute(a); if (!geo.attributes.normal) geo.computeVertexNormals(); if (!geo.index) { var I = new Uint32Array(geo.attributes.position.count); for (var k = 0; k < I.length; k++) I[k] = k; geo.setIndex(new THREE.BufferAttribute(I, 1)); }
      var uv = geo.attributes.uv, ti = Math.floor(gi / 2); for (var j = 0; j < uv.count; j++) uv.setX(j, (ti + clamp(uv.getX(j), 0.002, 0.998)) / 3); geo.computeBoundingBox(); geo.computeBoundingSphere(); m.material.map && m.material.map.dispose && m.material.map.dispose(); return geo; });
    var mat = MAT.car = carMat(tex), LAY0 = layout(), list = CARS.list = LAY0.cars;
    var mk = function (lod) { var vc = 0, ic = 0, ids = []; CAR_TYPES.forEach(function (t, i) { var g = geos[i * 2 + lod]; vc += g.attributes.position.count; ic += g.index.count; }); var bm = new THREE.BatchedMesh(list.length, vc, ic, mat); bm.name = "sp_cars_" + (lod ? "far" : "near"); bm.sortObjects = false; bm.perObjectFrustumCulled = true; bm.castShadow = false; bm.receiveShadow = true; bm.userData.shSet = true; bm.userData.noShadow = true; bm.userData.noCull = true;
      CAR_TYPES.forEach(function (t, i) { ids[i] = bm.addGeometry(geos[i * 2 + lod]); }); list.forEach(function (c) { var id = bm.addInstance(ids[c.type]); bm.setMatrixAt(id, carMatrix(c)); _c.setHex(c.col); bm.setColorAt(id, _c); bm.setVisibleAt(id, false); c["id" + lod] = id; }); bm.computeBoundingBox(); bm.computeBoundingSphere(); return bm; };
    var g = new THREE.Group(); g.name = "sp_cars"; g.userData.noCull = true; CARS.near = mk(0); CARS.far = mk(1); g.add(CARS.near); g.add(CARS.far); scene.add(g); GR.cars = g;
    list.forEach(function (c) { c.st = -1; }); CARS.state = "ready"; CARS.cx = 1e9; SP.n.carTris = CAR_TYPES.map(function (t, i) { return [geos[i * 2].index.count / 3, geos[i * 2 + 1].index.count / 3]; });
    try { var W2 = window.PLAN_PERF; if (W2 && W2.warmGroup) W2.warmGroup(g, { name: "solar cars" }); } catch (e) {}
  }
  // a car sits on its four wheels: yaw from the bay, pitch and roll from the ground under the axles and the sides
  function carMatrix(c) { var len = [4.85, 4.6, 5.9][c.type] * 0.8, w = [1.86, 1.9, 2.05][c.type] * 0.8, s = Math.sin(c.ry), co = Math.cos(c.ry);
    var hf = sY(c.x - s * len / 2, c.z - co * len / 2), hb = sY(c.x + s * len / 2, c.z + co * len / 2), hr = sY(c.x + co * w / 2, c.z - s * w / 2), hl = sY(c.x - co * w / 2, c.z + s * w / 2);
    var y = Math.min((hf + hb) / 2, (hr + hl) / 2) + 0.005; _e.set(Math.atan2(hf - hb, len), c.ry, Math.atan2(hr - hl, w), "YXZ"); _q.setFromEuler(_e); return new THREE.Matrix4().compose(_v1.set(c.x, y, c.z), _q, _v2.set(1, 1, 1)); }
  function carsFrame(force) {
    if (CARS.state !== "ready") return; var cam = camera.position, mv = Math.hypot(cam.x - CARS.cx, cam.z - CARS.cz); if (!force && mv < 4 && nowMs() - CARS.at < 700) return; CARS.cx = cam.x; CARS.cz = cam.z; CARS.at = nowMs();
    var n2 = CARS.NEAR * CARS.NEAR, f2 = CARS.FAR * CARS.FAR, nn = 0, nf = 0; for (var i = 0; i < CARS.list.length; i++) { var c = CARS.list[i], dx = c.x - cam.x, dz = c.z - cam.z, dy = cam.y - sY(c.x, c.z) - 30, d2 = dx * dx + dz * dz + (dy > 0 ? dy * dy : 0), st = d2 > f2 ? 0 : d2 < n2 ? 1 : 2; if (st === 1) nn++; else if (st === 2) nf++; if (st === c.st && !force) continue; c.st = st; CARS.near.setVisibleAt(c.id0, st === 1); CARS.far.setVisibleAt(c.id1, st === 2); }
    SP.n.carsNear = nn; SP.n.carsFar = nf;
  }

  // ───────────────────────── the hens: the client's chicken model, instanced, wandering and pecking in the run ─────────────────────────
  var HENS = SP.hens = { list: [], ims: [], ready: false };
  function buildHens() {
    if (HENS.ready || !has("chicken") || !SP.run) return; var m = MODELS.chicken, parts = m.parts || [], R = rng(41), run = SP.run; if (!parts.length) return; var bb = new THREE.Box3(); parts.forEach(function (p) { p.geometry.computeBoundingBox(); bb.union(p.geometry.boundingBox); }); var sc = 0.42 / Math.max(0.01, bb.max.y - bb.min.y);
    var g = new THREE.Group(); g.name = "sp_hens"; parts.forEach(function (p) { var im = new THREE.InstancedMesh(p.geometry, p.material, 6); im.castShadow = false; im.receiveShadow = true; im.userData.shSet = true; im.userData.noShadow = true; im.frustumCulled = false; g.add(im); HENS.ims.push(im); });
    for (var i = 0; i < 6; i++) HENS.list.push({ x: lerp(run.x0, run.x1, R()), z: lerp(run.z0, run.z1, R()), yaw: R() * TAU, tx: 0, tz: 0, wait: R() * 3, peck: 0, sc: sc * (0.9 + R() * 0.2), y0: -bb.min.y });
    scene.add(g); GR.hens = g; HENS.ready = true; HENS.R = R; henFrame(0.1, true); try { var W2 = window.PLAN_PERF; if (W2 && W2.warmGroup) W2.warmGroup(g, { name: "solar hens" }); } catch (e) {}
  }
  function henFrame(dt, force) { if (!HENS.ready) return; var R = HENS.R, run = SP.run, near = Math.hypot(camera.position.x - (run.x0 + run.x1) / 2, camera.position.z - (run.z0 + run.z1) / 2) < 70; GR.hens.visible = near; if (!near && !force) return;
    HENS.list.forEach(function (h, i) { if (h.wait > 0) { h.wait -= dt; h.peck += dt * 9; } else { var dx = h.tx - h.x, dz = h.tz - h.z, d = Math.hypot(dx, dz); if (d < 0.15 || !h.tx) { h.tx = lerp(run.x0, run.x1, R()); h.tz = lerp(run.z0, run.z1, R()); h.wait = 1 + R() * 4; } else { var sp = 0.55 * dt; h.x += dx / d * sp; h.z += dz / d * sp; var want = Math.atan2(dx, dz) + PI; var dd = Math.atan2(Math.sin(want - h.yaw), Math.cos(want - h.yaw)); h.yaw += dd * Math.min(1, dt * 5); h.peck = 0; } }
      var bob = h.wait > 0 ? Math.max(0, Math.sin(h.peck)) * 0.45 : 0; _e.set(bob, h.yaw, 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(h.x, gh(h.x, h.z) + 0.05 + h.y0 * h.sc, h.z), _q, _v2.set(h.sc, h.sc, h.sc)); HENS.ims.forEach(function (im) { im.setMatrixAt(i, _m4); }); });
    HENS.ims.forEach(function (im) { im.instanceMatrix.needsUpdate = true; }); }
  // ───────────────────────── golf carts: the game's own cart model (MODELS.cart), three clustered LODs, two BatchedMeshes per LOD set ─────────────────────────
  // vertex clustering on position only (no cracks): the output is unindexed, every kept triangle keeps the uvs of its own original
  // corners (the texture stays put across uv seams), normals averaged per cluster with the original facing kept (after plan_market)
  function clusterGeo(src, cell) {
    var g = src.index ? src : src.clone(); if (!g.index) { var I0 = new Uint32Array(g.attributes.position.count); for (var q = 0; q < I0.length; q++) I0[q] = q; g.setIndex(new THREE.BufferAttribute(I0, 1)); }
    var P = g.attributes.position.array, U = g.attributes.uv.array, idx = g.index.array, N = g.attributes.position.count, F = idx.length / 3, cmap = new Map(), acc = [], cellOf = new Int32Array(N), ON = new Float32Array(N * 3), f, k;
    for (f = 0; f < F; f++) { var i0 = idx[f * 3] * 3, i1 = idx[f * 3 + 1] * 3, i2 = idx[f * 3 + 2] * 3, ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2], vx = P[i2] - P[i0], vy = P[i2 + 1] - P[i0 + 1], vz = P[i2 + 2] - P[i0 + 2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; [i0, i1, i2].forEach(function (ii) { ON[ii] += nx; ON[ii + 1] += ny; ON[ii + 2] += nz; }); }
    for (var v = 0; v < N; v++) { var key = (Math.floor(P[v * 3] / cell) + 512) * 1048576 + (Math.floor(P[v * 3 + 1] / cell) + 512) * 1024 + (Math.floor(P[v * 3 + 2] / cell) + 512); var c = cmap.get(key); if (c === undefined) { c = acc.length / 7; cmap.set(key, c); acc.push(0, 0, 0, 0, 0, 0, 0); } var o = c * 7; acc[o] += P[v * 3]; acc[o + 1] += P[v * 3 + 1]; acc[o + 2] += P[v * 3 + 2]; acc[o + 3] += ON[v * 3]; acc[o + 4] += ON[v * 3 + 1]; acc[o + 5] += ON[v * 3 + 2]; acc[o + 6]++; cellOf[v] = c; }
    var keep = [], seen = new Set(); for (f = 0; f < F; f++) { var a = cellOf[idx[f * 3]], b = cellOf[idx[f * 3 + 1]], cc = cellOf[idx[f * 3 + 2]]; if (a === b || b === cc || a === cc) continue; var s0 = Math.min(a, b, cc), s2 = Math.max(a, b, cc), kk = s0 + "," + (a + b + cc - s0 - s2) + "," + s2; if (seen.has(kk)) continue; seen.add(kk); keep.push(f); }
    var T = keep.length, PP = new Float32Array(T * 9), UU = new Float32Array(T * 6), NN = new Float32Array(T * 9), cs = [0, 0, 0], vs = [0, 0, 0], pc = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var t = 0; t < T; t++) { f = keep[t]; for (k = 0; k < 3; k++) { vs[k] = idx[f * 3 + k]; cs[k] = cellOf[vs[k]]; var oo = cs[k] * 7, n = acc[oo + 6]; pc[k][0] = acc[oo] / n; pc[k][1] = acc[oo + 1] / n; pc[k][2] = acc[oo + 2] / n; }
      var e1x = pc[1][0] - pc[0][0], e1y = pc[1][1] - pc[0][1], e1z = pc[1][2] - pc[0][2], e2x = pc[2][0] - pc[0][0], e2y = pc[2][1] - pc[0][1], e2z = pc[2][2] - pc[0][2], qx = e1y * e2z - e1z * e2y, qy = e1z * e2x - e1x * e2z, qz = e1x * e2y - e1y * e2x;
      var j0 = vs[0] * 3, j1 = vs[1] * 3, j2 = vs[2] * 3, ox = (P[j1 + 1] - P[j0 + 1]) * (P[j2 + 2] - P[j0 + 2]) - (P[j1 + 2] - P[j0 + 2]) * (P[j2 + 1] - P[j0 + 1]), oy = (P[j1 + 2] - P[j0 + 2]) * (P[j2] - P[j0]) - (P[j1] - P[j0]) * (P[j2 + 2] - P[j0 + 2]), oz = (P[j1] - P[j0]) * (P[j2 + 1] - P[j0 + 1]) - (P[j1 + 1] - P[j0 + 1]) * (P[j2] - P[j0]);
      var order = qx * ox + qy * oy + qz * oz < 0 ? [0, 2, 1] : [0, 1, 2];
      for (var j = 0; j < 3; j++) { k = order[j]; var qi = t * 3 + j, cc2 = cs[k] * 7, vv = vs[k]; PP[qi * 3] = pc[k][0]; PP[qi * 3 + 1] = pc[k][1]; PP[qi * 3 + 2] = pc[k][2]; UU[qi * 2] = U[vv * 2]; UU[qi * 2 + 1] = U[vv * 2 + 1]; var nx2 = acc[cc2 + 3], ny2 = acc[cc2 + 4], nz2 = acc[cc2 + 5], Ln = Math.sqrt(nx2 * nx2 + ny2 * ny2 + nz2 * nz2) || 1; NN[qi * 3] = nx2 / Ln; NN[qi * 3 + 1] = ny2 / Ln; NN[qi * 3 + 2] = nz2 / Ln; } }
    var g2 = new THREE.BufferGeometry(); g2.setAttribute("position", new THREE.BufferAttribute(PP, 3)); g2.setAttribute("uv", new THREE.BufferAttribute(UU, 2)); g2.setAttribute("normal", new THREE.BufferAttribute(NN, 3)); var I2 = new Uint32Array(T * 3); for (var w = 0; w < I2.length; w++) I2[w] = w; g2.setIndex(new THREE.BufferAttribute(I2, 1)); g2.computeBoundingSphere(); g2.computeBoundingBox(); return g2;
  }
  // body paint (the model's green) takes the cart's colour (setColorAt); the canopy roof one of eight finishes picked per cart
  var CARTS = SP.carts = { state: "idle", bm: [], list: [], at: 0, cx: 1e9, cz: 1e9, R: [14, 40, 120, 520] };
  try { var QL2 = (localStorage.getItem("g1:quality") || "high"); if (QL2 === "low") CARTS.R = [0, 24, 80, 340]; else if (QL2 === "medium") CARTS.R = [8, 30, 100, 420]; } catch (e) {}
  function cartMat(src) {
    var m = new THREE.MeshStandardMaterial({ map: src.map || null, normalMap: src.normalMap || null, roughness: 0.5, metalness: 0.15, envMapIntensity: 0.8 }); m.name = "sp_cart"; if (src.normalMap && m.normalScale) m.normalScale.set(0.6, 0.6);
    m.onBeforeCompile = function (sh) {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vLy; varying float vRoof;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvLy = position.y;\n#ifdef USE_BATCHING\nvRoof = fract(float(getIndirectIndex(gl_DrawID)) * 0.6180339 + 0.13);\n#else\nvRoof = 0.0;\n#endif");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vLy; varying float vRoof;").replace("#include <color_fragment>", "#if defined( USE_COLOR )\n{ vec3 c = diffuseColor.rgb; float lum = dot(c, vec3(0.299, 0.587, 0.114)); float green = smoothstep(0.03, 0.09, c.g - max(c.r, c.b)); diffuseColor.rgb = mix(c, vColor.rgb * (0.35 + lum * 2.2), green);\n float roof = step(1.84, vLy) * smoothstep(0.35, 0.55, lum); vec3 rc = vRoof < 0.45 ? vec3(0.93, 0.93, 0.9) : vRoof < 0.62 ? vec3(0.78, 0.7, 0.55) : vRoof < 0.8 ? vec3(0.07, 0.07, 0.08) : vRoof < 0.9 ? vec3(0.12, 0.42, 0.22) : vec3(0.55, 0.12, 0.1); diffuseColor.rgb = mix(diffuseColor.rgb, rc * (0.55 + lum * 0.5), roof); }\n#endif");
    }; m.customProgramCacheKey = function () { return "sp_cart_v1"; }; return m;
  }
  function cartMatrix(c) { var s = Math.sin(c.ry), co = Math.cos(c.ry), hf = sY(c.x + s * 0.9, c.z + co * 0.9), hb = sY(c.x - s * 0.9, c.z - co * 0.9), hr = sY(c.x + co * 0.5, c.z - s * 0.5), hl = sY(c.x - co * 0.5, c.z + s * 0.5);
    var y = Math.min((hf + hb) / 2, (hr + hl) / 2) + 0.004; _e.set(-Math.atan2(hf - hb, 1.8), c.ry, Math.atan2(hr - hl, 1.0), "YXZ"); _q.setFromEuler(_e); return new THREE.Matrix4().compose(_v1.set(c.x, y, c.z), _q, _v2.set(1, 1, 1)); }
  function buildCarts() {
    if (CARTS.state !== "idle" || !has("cart")) return; CARTS.state = "building"; var m = MODELS.cart, part = m.parts && m.parts[0]; if (!part) { CARTS.state = "fail"; return; }
    var src = part.geometry.clone(); for (var a in src.attributes) if (a !== "position" && a !== "uv" && a !== "normal") src.deleteAttribute(a); src.computeBoundingBox(); var bb = src.boundingBox; src.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    if (!src.index) { var I0 = new Uint32Array(src.attributes.position.count); for (var q = 0; q < I0.length; q++) I0[q] = q; src.setIndex(new THREE.BufferAttribute(I0, 1)); } var geos = [src].concat([0.06, 0.12, 0.22].map(function (cs) { return clusterGeo(src, cs); })); var mat = MAT.cart2 = cartMat(part.material), list = CARTS.list = layout().carts;
    var g = new THREE.Group(); g.name = "sp_carts"; g.userData.noCull = true;
    CARTS.bm = geos.map(function (geo, lod) { var bm = new THREE.BatchedMesh(list.length, geo.attributes.position.count, geo.index.count, mat); bm.name = "sp_carts_" + lod; bm.sortObjects = false; bm.perObjectFrustumCulled = true; bm.castShadow = false; bm.receiveShadow = true; bm.userData.shSet = true; bm.userData.noShadow = true; bm.userData.noCull = true; var gid = bm.addGeometry(geo);
      list.forEach(function (c) { var id = bm.addInstance(gid); bm.setMatrixAt(id, cartMatrix(c)); _c.setHex(c.body); bm.setColorAt(id, _c); bm.setVisibleAt(id, false); c["id" + lod] = id; }); bm.computeBoundingBox(); bm.computeBoundingSphere(); g.add(bm); return bm; });
    scene.add(g); GR.carts = g; list.forEach(function (c) { c.st = -1; }); CARTS.state = "ready"; CARTS.cx = 1e9; SP.n.cartTris = geos.map(function (q) { return q.index.count / 3; });
    try { var W2 = window.PLAN_PERF; if (W2 && W2.warmGroup) W2.warmGroup(g, { name: "solar carts" }); } catch (e) {}
  }
  function cartsFrame(force) {
    if (CARTS.state !== "ready") return; var cam = camera.position, mv = Math.hypot(cam.x - CARTS.cx, cam.z - CARTS.cz); if (!force && mv < 3 && nowMs() - CARTS.at < 700) return; CARTS.cx = cam.x; CARTS.cz = cam.z; CARTS.at = nowMs();
    var RR = CARTS.R.map(function (r) { return r * r; }), cnt = [0, 0, 0, 0]; for (var i = 0; i < CARTS.list.length; i++) { var c = CARTS.list[i], dx = c.x - cam.x, dz = c.z - cam.z, dy = cam.y - sY(c.x, c.z) - 25, d2 = dx * dx + dz * dz + (dy > 0 ? dy * dy : 0), st = d2 < RR[0] ? 0 : d2 < RR[1] ? 1 : d2 < RR[2] ? 2 : d2 < RR[3] ? 3 : 4; if (st < 4) cnt[st]++; if (st === c.st && !force) continue; c.st = st; for (var l = 0; l < 4; l++) CARTS.bm[l].setVisibleAt(c["id" + l], st === l); }
    SP.n.cartsLod = cnt;
  }

  // ───────────────────────── defer hook: build every mesh once (behind the loading screen) ─────────────────────────
  var GR = SP.groups = {};
  var CASTB = { pv: 1, metal: 1, std: 1, wood: 1, corten: 1, leaf: 1, crop: 1 };
  function meshesOf(K, name, zone) { var g = new THREE.Group(); g.name = "sp_" + name; g.userData.noCull = true; var mg = K.merged(); for (var b in mg) { var m = new THREE.Mesh(mg[b], MAT[b] || (b === "stdn" ? MAT.std : b === "leafn" ? MAT.leaf : MAT.std)); m.name = "sp_" + name + "_" + b; m.castShadow = !!CASTB[b] && zone !== "flat"; m.receiveShadow = b !== "glow" && b !== "pool" && b !== "blob"; m.userData.shSet = true; m.userData.noShadow = !m.castShadow; if (b === "glass" || b === "poly") m.renderOrder = 2; if (b === "pool") m.renderOrder = 3; m.matrixAutoUpdate = false; m.updateMatrix(); g.add(m); SP.n.tris = (SP.n.tris || 0) + mg[b].attributes.position.count / 3; } scene.add(g); GR[name] = g; return g; }
  function groundMeshes() { var g = new THREE.Group(); g.name = "sp_ground"; g.userData.noCull = true; for (var k in GD) { var list = GD[k].filter(Boolean), n = 0; list.forEach(function (q) { n += q.attributes.position.count; }); if (!n) continue; var P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), o = 0; list.forEach(function (q) { P.set(q.attributes.position.array, o * 3); N.set(q.attributes.normal.array, o * 3); U.set(q.attributes.uv.array, o * 2); o += q.attributes.position.count; });
      var geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(P, 3)); geo.setAttribute("normal", new THREE.BufferAttribute(N, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(U, 2)); geo.computeBoundingSphere(); geo.computeBoundingBox();
      try { if (typeof walkAdd === "function") walkAdd(geo); } catch (e) { note("walk", e); }
      var m = new THREE.Mesh(geo, MAT[k] || MAT.dg); m.name = "sp_g_" + k; m.receiveShadow = true; m.castShadow = false; m.userData.shSet = true; m.userData.noShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); g.add(m); SP.n.groundTris = (SP.n.groundTris || 0) + n / 3; } scene.add(g); GR.ground = g; }
  function buildAll() {
    mats(); loadLogo(); var t0 = nowMs(), step = function (name, fn) { var t = nowMs(); try { fn(); } catch (e) { note(name, e); } SP.n["ms_" + name] = Math.round(nowMs() - t); };
    SP.K = new Kit(); SP.KS = new Kit(); SP.KP = new Kit(); SP.KB = new Kit(); SP.KM = new Kit();
    step("ground", buildGround); step("park", buildPark); step("hub", buildHub);
    step("parkMesh", function () { meshesOf(SP.K, "park", "park"); }); SP.K = new Kit();
    step("garden", buildGarden); step("gardenMesh", function () { meshesOf(SP.K, "garden", "garden"); });
    step("flat", function () { meshesOf(SP.KM, "marks", "flat"); meshesOf(SP.KS, "signs", "flat"); meshesOf(SP.KP, "pools", "flat"); meshesOf(SP.KB, "blobs", "flat"); groundMeshes(); });
    step("board", buildBoard); step("lamps", buildLamps);
    SP.n.buildMs = Math.round(nowMs() - t0);
    try { var W = window.PLAN_PERF; if (W && W.warmGroup) for (var k in GR) W.warmGroup(GR[k], { name: "solar " + k }); } catch (e) { note("warm", e); }
  }
  function deferHook() {
    if (SP.off || !SP.world || SP.ready) return; var t0 = nowMs();
    try { buildAll(); } catch (e) { note("build", e); } try { carSolids(); } catch (e) { note("car solids", e); } try { spotsSetup(); } catch (e) { note("spots", e); }
    try { loadCars(); } catch (e) { note("cars", e); } try { buildCarts(); } catch (e) { note("carts", e); CARTS.state = "fail"; } try { buildHens(); } catch (e) { note("hens", e); }
    SP.n.deferMs = Math.round(nowMs() - t0); SP.ready = true;
  }
  // collision: the canopy columns, the chargers, every parked car (a box at its own height)
  function carSolids() { var L = layout(); L.columns.forEach(function (c) { var y = sY(c.x, c.z); sol(c.x, c.z, 0, 0.62, 0.62, y - 0.2, y + 4.4); }); L.chargers.forEach(function (c) { var y = sY(c.x, c.z); sol(c.x, c.z, 0, 0.5, c.dbl ? 0.5 : 0.4, y, y + 1.6); });
    L.cars.forEach(function (c) { var y = sY(c.x, c.z); sol(c.x, c.z, c.ry, [1.86, 1.9, 2.05][c.type], [4.85, 4.6, 5.9][c.type] - 0.1, y, y + [1.42, 1.62, 1.85][c.type]); });
    L.carts.forEach(function (c) { var y = sY(c.x, c.z); sol(c.x, c.z, c.ry, 1.25, 2.4, y, y + 1.95); }); SP.n.solids = SOL.length; }
  // warm and cool pools through the client's light pool (no new shader lights: the pool shows the nearest few)
  function buildLamps() { var g = new THREE.Group(); g.name = "sp_lamps"; SP.lights = []; var pick = [[-456.8, 3.0, 91, 0xfff0dc, 14], [-449.5, 4.6, 104, 0xfff0dc, 10], [-222.5, 2.6, 58.5, 0xffc88a, 12], [-175.5, 3.0, 77, 0xffb070, 10], [-400, 3.6, 71.5, 0xf4f6ff, 12], [-330, 3.6, 89.5, 0xf4f6ff, 12], [-290, 3.6, 107.5, 0xf4f6ff, 12], [-360, 3.6, 107.5, 0xf4f6ff, 12]];
    pick.forEach(function (q) { var l = new THREE.PointLight(q[3], 0, 22, 1.6); l.position.set(q[0], sY(q[0], q[2]) + q[1], q[2]); l.userData.k0 = q[4]; g.add(l); SP.lights.push(l); }); scene.add(g); GR.lamps = g; }

  // ───────────────────────── the live arrivals board: the next Grand Loop from here to the FBO, Main Street, the Commons, the Convention Center ─────────────────────────
  var BOARD = SP.board = { cv: null, tex: null, at: 0, rows: [] };
  function buildBoard() { var B = SP.boardAt; if (!B) return; var cv = document.createElement("canvas"); cv.width = 1024; cv.height = 426; var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; BOARD.cv = cv; BOARD.tex = t;
    var m = new THREE.MeshBasicMaterial({ map: t, color: 0xffffff }); m.name = "sp_board"; MAT.board = m; var g = new THREE.Group(); g.name = "sp_board";
    [0, PI].forEach(function (ry, i) { var q = new THREE.Mesh(new THREE.PlaneGeometry(B.w - 0.16, B.h - 0.12), m); q.position.set(B.x, B.y, B.z + (i ? -0.095 : 0.095)); q.rotation.y = ry; q.userData.shSet = true; q.userData.noShadow = true; g.add(q); }); scene.add(g); GR.board = g; drawBoard(true); }
  function cartsOn() { try { return (SITES.carts || []).filter(function (c) { return /GRAND LOOP/.test(c.line || ""); }); } catch (e) { return []; } }
  // seconds for a cart to run from route position ta to tb (forward round the loop), through its slow zones and stops
  function runTime(c, ta, tb) { var L = c.L || (c.L = polyLen(c.r)), d = ((tb - ta) % L + L) % L, t = 0, base = (c.base || c.speed || 11) * 0.9, step = 20;
    for (var s = 0; s < d; s += step) { var p = (ta + s) % L, sp = base; if (c.zones) for (var z = 0; z < c.zones.length; z++) { var zn = c.zones[z]; if (p >= zn[0] && p <= zn[1]) { sp = zn[2] * 0.9; break; } } t += Math.min(step, d - s) / Math.max(1, sp); }
    c.stops.forEach(function (st) { var off = ((st.t - ta) % L + L) % L; if (off > 1 && off < d - 1) t += c.stopPause || 9; }); return t; }
  function boardData() { var cs = cartsOn(), hubRe = new RegExp(C("transit.hubMatch", "solar cart park"), "i"), out = { next: null, boarding: false, rows: [] }; if (!cs.length) return out;
    var hub = cs[0].stops.find(function (s) { return hubRe.test(s.hub); }); if (!hub) return out; var dests = C("board.dests", []) || [];
    var best = 1e9, bc = null; cs.forEach(function (c) { var L = c.L || (c.L = polyLen(c.r)); var dp = Math.hypot(c.g.position.x - S.STOP[0], c.g.position.z - S.STOP[1]); if (c.pause > 0 && dp < 16) { out.boarding = true; best = 0; bc = c; return; } var e = runTime(c, c.t, hub.t) + (c.pause > 0 ? c.pause : 0); if (e < best) { best = e; bc = c; } });
    out.next = best; var second = 1e9; cs.forEach(function (c) { if (c === bc) return; var e = runTime(c, c.t, hub.t) + (c.pause > 0 ? c.pause : 0); if (e < second) second = e; }); out.then = second;
    dests.forEach(function (d) { var re = new RegExp(d.match, "i"), st = bc && bc.stops.find(function (s) { return re.test(s.hub); }); if (!st) return; out.rows.push({ label: d.label, sub: d.sub || "", eta: best + (bc.stopPause || 9) + runTime(bc, hub.t, st.t) }); });
    return out; }
  function fmtMin(s) { if (s < 45) return "DUE"; return Math.max(1, Math.round(s / 60)) + " MIN"; }
  function drawBoard(force) { if (!BOARD.cv) return; var D = boardData(), key = JSON.stringify([D.boarding, Math.round((D.next || 0) / 15), D.rows.map(function (r) { return Math.round(r.eta / 30); })]); if (!force && key === BOARD.key) return; BOARD.key = key;
    var x = BOARD.cv.getContext("2d"), W = 1024, H = 426; x.fillStyle = "#050806"; x.fillRect(0, 0, W, H); x.fillStyle = "#0e1a12"; for (var yy = 0; yy < H; yy += 4) x.fillRect(0, yy, W, 1);
    x.fillStyle = "#4DDE6F"; x.fillRect(0, 0, W, 64); txt(x, C("board.title", "GRAND LOOP · SHUTTLE HUB"), 24, 33, "700 36px " + SANS, "#06120a", "left", 640, 3);
    var hh = 12; try { hh = dayT() * 24; } catch (e) {} var H2 = Math.floor(hh), M2 = Math.floor((hh - H2) * 60); txt(x, (H2 < 10 ? "0" : "") + H2 + ":" + (M2 < 10 ? "0" : "") + M2, W - 24, 33, "700 36px " + SANS, "#06120a", "right");
    txt(x, D.boarding ? C("board.boarding", "NOW BOARDING") : C("board.next", "NEXT SHUTTLE"), 24, 108, "700 34px " + SANS, D.boarding ? "#f4cd5a" : "#e9e5d8", "left"); txt(x, D.boarding ? "" : D.next === null ? "--" : fmtMin(D.next), W - 24, 108, "700 44px " + SANS, "#f4cd5a", "right"); if (D.then < 1e8 && !D.boarding) txt(x, "THEN " + fmtMin(D.then), W - 210, 108, "600 24px " + SANS, "#9fe8b2", "right");
    x.fillStyle = "rgba(77,222,111,0.35)"; x.fillRect(24, 142, W - 48, 2); txt(x, C("board.colDest", "TO"), 24, 168, "600 20px " + SANS, "#7fbf8f", "left", 200, 3); txt(x, C("board.colEta", "ARRIVES IN"), W - 24, 168, "600 20px " + SANS, "#7fbf8f", "right", 300, 3);
    D.rows.forEach(function (r, i) { var y = 214 + i * 52; txt(x, r.label.toUpperCase(), 24, y, "700 32px " + SANS, "#f4f1e6", "left", 470, 1); if (r.sub) txt(x, r.sub, 520, y + 2, "500 22px " + SANS, "#9fb8a6", "left", 300); txt(x, fmtMin(r.eta), W - 24, y, "700 32px " + SANS, "#4DDE6F", "right"); });
    BOARD.tex.needsUpdate = true; }
  // the client's stop posts (a post and a small board 7 m off the route) moved next to the shelters
  function postsFrame() { if (SP.postsDone || !SITES.stops || !SITES.stops.length) return; var moved = 0;
    (C("transit.posts", []) || []).forEach(function (P) { var re = new RegExp(P.match, "i"); SITES.stops.forEach(function (st) { if (!re.test(st.hubName || st.hub || "") || st.spMoved) return; var c = (A2.cull || []).find(function (q) { return q.o && Math.abs(q.x - st.x) < 0.01 && Math.abs(q.z - st.z) < 0.01; }); if (!c) return; c.o.position.set(P.x, (P.y !== undefined ? P.y : sY(P.x, P.z)), P.z); c.o.rotation.y = P.ry; c.x = P.x; c.z = P.z; st.x = P.x; st.z = P.z; st.spMoved = true; moved++; }); });
    SP.n.postsMoved = moved; if (moved >= 2 || nowMs() - (SP.postsAt || (SP.postsAt = nowMs())) > 30000) SP.postsDone = true; }

  // ───────────────────────── people: Marisol at the farm stand (talk card), two passengers at the shelter (client avatars, near only) ─────────────────────────
  SP.cast = SP.cast || []; SP.extras = SP.extras || [];
  function buildPeople() { if (typeof avatar !== "function") return; var F = C("farmer", null), sa = SP.standAt;
    if (F && sa && !SP.cast.length && !CAST.some(function (c) { return c.id === F.id; })) { var g = avatar("cast_" + F.id, F.name, F.look || {}, F.hat || null, null); g.position.set(sa.farmer[0], sa.y0 + 0.01, sa.farmer[1]); g.rotation.y = sa.ry; try { g.userData.label.scale.set(1.6, 0.4, 1); } catch (e) {} g.traverse(function (o) { if (o.isMesh) { o.castShadow = false; o.userData.shSet = true; } }); scene.add(g);
      var c = { id: F.id, name: F.name, role: F.role, pos: [sa.farmer[0], sa.farmer[1]], look: F.look, hat: F.hat || null, outfit: null, greet: F.greet || ["Hello."], talk: (F.talk || []).map(function (q) { return { t: q.t, o: q.o }; }), kw: [], g: g, rot: sa.ry }; CAST.push(c); var hs = { x: sa.talk[0], z: sa.talk[1], r: 2.2, t: c.name, k: c.role + " · press E to talk", p: c.talk[0] ? c.talk[0].t : "", play: "npc:" + c.id }; hotspots.push(hs); (SP.hs = SP.hs || []).push(hs); SP.cast.push(c); return; }
    var X = C("extras", []) || []; if (SP.extras.length < X.length) { var e = X[SP.extras.length], ga = avatar("sp_x" + SP.extras.length, "", e.look || {}, e.hat || null, null); try { ga.userData.label.visible = false; } catch (er) {} ga.position.set(e.x, sY(e.x, e.z) + (e.sit ? 0.47 : 0.02), e.z); ga.rotation.y = e.ry || 0; if (e.sit) ga.userData.sit = true; ga.traverse(function (o) { if (o.isMesh) { o.castShadow = false; o.userData.shSet = true; } }); scene.add(ga); SP.extras.push({ g: ga, e: e }); } }

  // ───────────────────────── E, prompts, seats, the farm stand, chargers ─────────────────────────
  SP.spots = [];
  function spotsSetup() { var out = SP.spots = [], sa = SP.standAt, V = C("venue", null); if (V) try { VENUE.sp_stand = { title: V.title, k: V.k, items: (V.items || []).slice() }; } catch (e) { note("venue", e); }
    if (sa) out.push({ x: sa.x, z: sa.z, r: 1.9, kind: "stand" }); layout().chargers.forEach(function (c) { var fs = c.dbl ? [1, -1] : [c.seg.nose < 0 ? 1 : -1]; fs.forEach(function (f) { out.push({ x: c.x, z: c.z + f * 0.9, r: 1.3, kind: "charge", c: c }); }); }); SP.n.spots = out.length; }
  function nearSpot() { if (!player) return null; var px = player.position.x, pz = player.position.z, best = null, bd = 1e9; for (var i = 0; i < SP.spots.length; i++) { var o = SP.spots[i]; var d = Math.hypot(o.x - px, o.z - pz); if (d < o.r && d < bd) { bd = d; best = o; } } return best; }
  function infoCard(t, k, p) { try { $id("info-h").textContent = t; $id("info-k").textContent = k || ""; $id("info-p").textContent = p || ""; var go = $id("info-go"); if (go) go.style.display = "none"; var nv = $id("info-nav"); if (nv) nv.style.display = "none"; $id("info").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock(); sfx("ui"); } catch (e) {} }
  function stamp(key) { try { var id = C("progress." + key, null); var PP = window.PLAN_PROGRESS; if (id && PP && PP.award) PP.award("stamp", { id: id }); } catch (e) {} }
  var BUB = SP.bub = { list: [], at: 0 };
  function bubbleAt(x, y, z, text) { try { if (typeof makeBubble !== "function") return; var g = new THREE.Group(); g.position.set(x, y, z); var b = makeBubble(text); g.add(b); scene.add(g); BUB.list.push({ g: g, b: b, t: nowMs() + 4200 }); } catch (e) { note("bubble", e); } }
  function bubbleFrame() { var t = nowMs(); for (var i = BUB.list.length - 1; i >= 0; i--) { var q = BUB.list[i]; if (t < q.t) continue; scene.remove(q.g); try { if (q.b.material.map) q.b.material.map.dispose(); q.b.material.dispose(); } catch (e) {} BUB.list.splice(i, 1); } }
  function line(key) { var L = C("lines." + key, []) || []; return L.length ? L[Math.floor(Math.random() * L.length)] : ""; }
  function busy() { try { return (typeof riding !== "undefined" && riding) || (typeof SIT !== "undefined" && SIT.on) || (typeof inside !== "undefined" && inside) || (typeof SITES !== "undefined" && SITES.ride); } catch (e) { return false; } }
  function handleE() {
    if (SP.off || !SP.ready || busy()) return false; try { if (nearestSeat()) return false; } catch (e) {} try { var nh = nearestHotspot(); if (nh && nh.play && String(nh.play).indexOf("npc:") === 0 && Math.hypot(nh.x - player.position.x, nh.z - player.position.z) < 2.0) return false; } catch (e) {}
    var o = nearSpot(); if (!o) return false;
    if (o.kind === "stand") { try { openShop("sp_stand"); } catch (e) { note("shop", e); } stamp("stand"); var sa = SP.standAt; bubbleAt(sa.farmer[0], sa.y0 + 0.1, sa.farmer[1], line("stand")); return true; }
    if (o.kind === "charge") { var d = C("info.charge", ["EV charging", "", ""]); infoCard(d[0], d[1], d[2]); stamp("charge"); bubbleAt(o.c.x, sY(o.c.x, o.c.z) + 0.2, o.c.z, line("charge")); return true; }
    return false;
  }
  function promptFrame() { try { if (SP.off || !SP.ready || !player || busy()) return; var el = $id("prompt"), t = $id("prompt-t"); if (!el || !t || el.classList.contains("on")) return; var o = nearSpot(); if (!o) return; var Pm = C("prompts", {}); var msg = o.kind === "stand" ? Pm.stand : o.kind === "charge" ? Pm.charge : null; if (msg) { t.innerHTML = "<b>E</b> &nbsp;" + msg; el.classList.add("on"); } } catch (e) { note("prompt", e); } }
  function install() { if (SP.installed) return; SP.installed = true; var o = SP.orig = { openNearest: openNearest, updateZone: updateZone };
    openNearest = function () { try { if (SP.impl.handleE()) return; } catch (e) { note("E", e); } return o.openNearest.apply(this, arguments); };
    updateZone = function () { var r = o.updateZone.apply(this, arguments); try { SP.impl.prompt(); } catch (e) {} return r; }; }
  // the client's near-player pebbles and rocks stay off the paving
  function nearBlock() { try { if (typeof NEAR === "undefined" || !NEAR.blocked || NEAR.blocked.sp) return; var b0 = NEAR.blocked; var f = function (x, z) { return inFoot(x, z, 0.5) || b0(x, z); }; for (var k in b0) f[k] = b0[k]; f.sp = true; NEAR.blocked = f; NEAR.at = [1e9, 1e9]; SP.n.nearWrap = (SP.n.nearWrap || 0) + 1; } catch (e) {} }

  // ───────────────────────── every frame: night, LODs, the board, the shuttle posts, people, hens, stamps ─────────────────────────
  var FR = SP.fr = { stamped: {}, n: -1 };
  function frameHook(dt, now) {
    if (SP.off || !SP.ready) return; dt = Math.min(dt || 0.016, 0.1);
    if (SP.hideAll) { for (var hk in GR) GR[hk].visible = false; SP.cast.concat(SP.extras).forEach(function (c) { c.g.visible = false; }); return; }
    try {
      var cam = camera.position, n = clamp((nightK() - 0.02) * 3.2, 0, 1), dS = rectDist(cam.x, cam.z, -478, -138, 47, 131);
      if (Math.abs(n - FR.n) > 0.004) { FR.n = n; MAT.glow.color.setScalar(0.55 + 1.9 * n); MAT.pool.opacity = 0.62 * n; GR.pools && (GR.pools.visible = n > 0.02); MAT.sign.emissiveIntensity = 0.12 + 0.5 * n; MAT.poly.emissiveIntensity = 0.35 * n; MAT.glass.emissiveIntensity = 0.15 * n; if (MAT.board) MAT.board.color.setScalar(0.85 + 0.4 * n); ["wood", "corten"].forEach(function (k) { MAT[k].emissiveIntensity = 0.05 * n; }); (SP.lights || []).forEach(function (l) { l.intensity = l.userData.k0 * n * (dS < 250 ? 1 : 0); }); }
      var vis = function (k, v) { if (GR[k] && GR[k].visible !== v) GR[k].visible = v; }; vis("park", dS < 2600); vis("garden", dS < 1600); vis("marks", dS < 700); vis("signs", dS < 700); vis("blobs", dS < 600); vis("ground", dS < 3000); vis("board", dS < 220);
      if (CARS.state === "idle" && dS < 1500) loadCars(); if (CARS.state === "ready") { var cv = dS < 1200; vis("cars", cv); if (cv) carsFrame(false); } if (CARTS.state === "idle" && has("cart")) { try { buildCarts(); } catch (e) { note("carts", e); CARTS.state = "fail"; } } if (CARTS.state === "ready") { var ctv = dS < 1200; vis("carts", ctv); if (ctv) cartsFrame(false); }
      if (!HENS.ready && dS < 400 && nowMs() > (FR.henAt || 0)) { FR.henAt = nowMs() + 2000; buildHens(); } if (HENS.ready) henFrame(dt, false);
      if (dS < 160 && nowMs() > (FR.pAt || 0)) { FR.pAt = nowMs() + 700; try { buildPeople(); } catch (e) { note("people", e); } }
      SP.cast.forEach(function (c) { var d = Math.hypot(c.g.position.x - cam.x, c.g.position.z - cam.z); c.g.visible = d < 60; }); SP.extras.forEach(function (c) { var d = Math.hypot(c.g.position.x - cam.x, c.g.position.z - cam.z); c.g.visible = d < 55; if (c.g.visible && (FRAME_N & 3) === 0) try { animateWalk(c.g, 0, dt * 4); } catch (e) {} });
      if (dS < 120 && nowMs() > BOARD.at) { BOARD.at = nowMs() + 1000; drawBoard(false); }
      postsFrame(); if (dS < 160 && (FR.nb = (FR.nb || 0) + 1) % 60 === 0) nearBlock(); bubbleFrame();
      if (player) { var px = player.position.x, pz = player.position.z; var st = function (k, cond) { if (cond && !FR.stamped[k]) { FR.stamped[k] = 1; stamp(k); } };
        st("park", S.inPark(px, pz)); st("hub", rectDist(px, pz, S.ISLAND.x0, S.ISLAND.x1, S.ISLAND.z0, S.ISLAND.z1) < 2); st("garden", S.inGarden(px, pz)); var gb = SP.ghBox; if (gb) st("greenhouse", px > gb.x0 && px < gb.x1 && pz > gb.z0 && pz < gb.z1);
        try { if (SITES.ride && Math.hypot(px - S.STOP[0], pz - S.STOP[1]) < 25) st("ride", true); } catch (e) {} }
    } catch (e) { note("frame", e); }
  }

  // ───────────────────────── hooks, API, debug ─────────────────────────
  SP.impl = { handleE: handleE, prompt: promptFrame, frame: frameHook };
  SP.api = { site: site, layout: layout, sY: sY, boardData: boardData, runTime: runTime, hubLoopPts: hubLoopPts, carsFrame: carsFrame };
  SP.debug = {
    at: function (x, z, yw) { if (inside) try { leaveInterior(); } catch (e) {} player.position.set(x, planGroundAt(x, z) + 0.02, z); if (yw !== undefined) yaw = yw; return [x, z]; },
    cam: function (px, py, pz, tx, ty, tz, fov) { window.__cam = [px, sY(px, pz) + py, pz, tx, sY(tx, tz) + ty, tz, fov || 0]; try { updateCulling(true); } catch (e) {} return window.__cam; },
    // hold a Grand Loop shuttle at the hub (or the Convention Center bay) for s seconds
    hold: function (where, s) { var cs = cartsOn(); if (!cs.length) return "no carts"; var c = cs[0], re = new RegExp(where === "conv" ? "convention" : C("transit.hubMatch", "solar cart park"), "i"), st = c.stops.find(function (q) { return re.test(q.hub); }); if (!st) return "no stop"; c.t = st.t; c.pause = s || 60; c.lastStop = c.stops.indexOf(st); var q = polyAt(c.r, c.t); c.g.position.set(q[0], planGroundAt(q[0], q[1]), q[1]); c.g.rotation.y = Math.atan2(q[2], q[3]); return [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]; },
    counts: function () { var o = {}; for (var k in GR) { var c = 0, t = 0; GR[k].traverse(function (m) { if (m.isMesh) { c++; var g = m.geometry; t += m.isBatchedMesh ? 0 : (g.index ? g.index.count : g.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1); } }); o[k] = [c, Math.round(t)]; } o.cars = [SP.n.carsNear, SP.n.carsFar]; o.carts = SP.n.cartsLod; return o; },
    hide: function () { SP.hideAll = true; return 1; }, show: function () { SP.hideAll = false; for (var k in GR) GR[k].visible = true; FR.n = -1; CARS.cx = 1e9; CARTS.cx = 1e9; return 1; }
  };
  (function hookAll() {
    var set = function (phase, name, fn) { var list = window.PLAN_HOOKS[phase]; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name: name, fn: fn }); };
    set("world", "solarWorld", function () { worldHook(); });
    set("terrain", "solarTerrain", function () { terrainHook(); });
    set("defer", "solarDefer", function () { deferHook(); });
    set("frame", "solarFrame", function (dt, now) { SP.impl.frame(dt, now); });
  })();
})();
