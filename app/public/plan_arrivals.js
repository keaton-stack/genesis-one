// R15 (Agent F, 5 Oct 2026): Arrivals Court and the Stellar Aviation FBO apron, the first thing every player sees.
// Classic script, loaded before client.js. Everything lives in this IIFE and window.PLAN_ARRIVALS; client functions and consts
// are reached by bare name at call time (never at load). Copy and layout numbers: app/public/plan/arrivals.json.
//   LANDSIDE (Arrivals Court, centre 129.4, -141.7): one paved court flush with the walks (the old painted disc and the raised
//     travertine ribbons met at a hard seam): honed travertine laid in rings, granite bands and a curb, brass LED inlays, planters
//     with palms, seating, sails, the directory totem with a live "you are here" map, the 3D site model table, the hub signpost,
//     the Grand Loop stop, the Club Walk gateway pylons, banners and a night lighting design (all emissive, no lights).
//   AIRSIDE (the apron outside the FBO airside doors): a concrete ramp with painted lead-in lines and stand numbers, parked
//     jets on stands with chocks, cones, tow bars, GPUs, an airstair, a fuel truck, baggage carts, a tug and a few line crew,
//     the red-carpet walk under a canopy, palms and planters along the facade, an airside lounge terrace, floodlight masts,
//     edge lights, a windsock and a security fence with gates.
// Switches: ?arrivals=0 (all of it off), ?arcourt=0, ?arapron=0.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var HK = window.PLAN_HOOKS;
  var QS = new URLSearchParams(location.search);
  var AR = window.PLAN_ARRIVALS = window.PLAN_ARRIVALS || { v: "r18f2-1", errs: [], n: {}, t: {}, parts: {}, debug: {} };
  function note(w, e) { var s = w + ": " + (e && e.message ? e.message : e); if (AR.errs.length < 40) AR.errs.push(s); if (AR.errs.length <= 8) try { console.warn("[arrivals] " + s); } catch (x) {} }
  if (QS.get("arrivals") === "0") { AR.off = true; return; }
  var ON = { court: QS.get("arcourt") !== "0", apron: QS.get("arapron") !== "0" };
  AR.on = ON;
  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ── data: plan/arrivals.json (copy, layout); the built-in values below are the fallback ──
  var DATA = null;
  try { fetch("/plan/arrivals.json?v=" + (window.BUILD || "dev")).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j) DATA = j; }).catch(function () {}); } catch (e) {}
  function cfg(k, d) { return DATA && DATA[k] !== undefined ? DATA[k] : d; }

  // the model kinds this module places (loadModels only loads what a module declares)
  var KINDS = ["datepalm", "fanpalm", "fanpalm2", "canarypalm", "agave_cluster", "yucca_cluster", "barrel_cactus", "ph_succulent_2", "ph_quiver_1", "bench_lux", "jet_mid", "jet_light", "stellar_fueler", "stellar_tug", "ocotillo"];
  { var ND = window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || []; for (var ki = 0; ki < KINDS.length; ki++) if (ND.indexOf(KINDS[ki]) < 0) ND.push(KINDS[ki]); }

  // ───────────────────────── frames ─────────────────────────
  function terr(x, z) { var f = window.PLAN_FLOOR; window.PLAN_FLOOR = null; try { return getH(x, z); } finally { window.PLAN_FLOOR = f; } }
  function gy(x, z) { try { return planGroundAt(x, z); } catch (e) { return getH(x, z); } }
  // Arrivals Court frame K: u along the Horizon Line (toward the Club Walk), v to its right (toward the shade pavilion)
  var K = { c: [129.4, -141.7], a: [0.7667, -0.642], p: [0.642, 0.7667] };
  function k2w(u, v) { return [K.c[0] + u * K.a[0] + v * K.p[0], K.c[1] + u * K.a[1] + v * K.p[1]]; }
  function w2k(x, z) { var dx = x - K.c[0], dz = z - K.c[1]; return [dx * K.a[0] + dz * K.a[1], dx * K.p[0] + dz * K.p[1]]; }
  function kYaw(du, dv) { var dx = du * K.a[0] + dv * K.p[0], dz = du * K.a[1] + dv * K.p[1]; return Math.atan2(dx, dz); }   // the yaw that faces direction (du, dv) of K
  // the terminal frame T: x along the hall (+x the landside end), z across it (+z the airside glass and the apron)
  var T = { x: 63.2558, z: -65.3118, rot: 0.858081, y: 16.34 };
  function t2w(lx, lz) { var c = Math.cos(T.rot), s = Math.sin(T.rot); return [T.x + lx * c + lz * s, T.z - lx * s + lz * c]; }
  function w2t(x, z) { var dx = x - T.x, dz = z - T.z, c = Math.cos(T.rot), s = Math.sin(T.rot); return [dx * c - dz * s, dx * s + dz * c]; }
  function tYaw(lyaw) { return T.rot + lyaw; }
  function frames() {
    try { var P = window.PLAN; var pr = P && P.promenades.find(function (q) { return q.id === "hl1_club_walk"; }); if (pr) { var a = pr.pts[0], b = pr.pts[1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); K.c = [a[0], a[1]]; K.a = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; K.p = [-K.a[1], K.a[0]]; if (K.p[0] * 0.64 + K.p[1] * 0.77 < 0) K.p = [-K.p[0], -K.p[1]]; } } catch (e) { note("court frame", e); }
    try { var e = PLACE.terminal && PLACE.terminal[0]; if (e) { T.x = e[0]; T.z = e[2]; T.rot = e[3]; T.y = e[1]; } } catch (e2) { note("terminal frame", e2); }
  }

  // ───────────────────────── geometry kit: world-space pieces merged per material ─────────────────────────
  function Geo(colors) { this.p = []; this.n = []; this.u = []; this.c = colors ? [] : null; this.i = []; this.col = [1, 1, 1]; }
  Geo.prototype.setCol = function (hex) { this.col = [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255]; return this; };
  Geo.prototype.v = function (x, y, z, nx, ny, nz, u, w) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, w); if (this.c) this.c.push(this.col[0], this.col[1], this.col[2]); return this.p.length / 3 - 1; };
  Geo.prototype.tri = function (a, b, c) { this.i.push(a, b, c); };
  // a quad a b c d (counter-clockwise seen from the front), flat normal
  Geo.prototype.quad = function (a, b, c, d, ua, ub, uc, ud) {
    var ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], fx = d[0] - a[0], fy = d[1] - a[1], fz = d[2] - a[2];
    var nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx, L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    ua = ua || [0, 0]; ub = ub || [1, 0]; uc = uc || [1, 1]; ud = ud || [0, 1];
    var i0 = this.v(a[0], a[1], a[2], nx, ny, nz, ua[0], ua[1]), i1 = this.v(b[0], b[1], b[2], nx, ny, nz, ub[0], ub[1]), i2 = this.v(c[0], c[1], c[2], nx, ny, nz, uc[0], uc[1]), i3 = this.v(d[0], d[1], d[2], nx, ny, nz, ud[0], ud[1]);
    this.i.push(i0, i1, i2, i0, i2, i3); return this; };
  // any THREE geometry placed by a matrix (its uv kept, or scaled by uvs)
  var _m4 = null, _nm = null;
  Geo.prototype.add = function (geo, m4, uvs) {
    if (!_nm) _nm = new THREE.Matrix3(); var g = geo.index ? geo : geo; var pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv; _nm.getNormalMatrix(m4);
    var o = this.p.length / 3, e = m4.elements, ne = _nm.elements; var su = uvs ? uvs[0] : 1, sv = uvs ? uvs[1] : 1;
    for (var k = 0; k < pa.count; k++) { var x = pa.getX(k), y = pa.getY(k), z = pa.getZ(k);
      var X = e[0] * x + e[4] * y + e[8] * z + e[12], Y = e[1] * x + e[5] * y + e[9] * z + e[13], Z = e[2] * x + e[6] * y + e[10] * z + e[14];
      var nx = 0, ny = 1, nz = 0; if (na) { var a = na.getX(k), b = na.getY(k), c = na.getZ(k); nx = ne[0] * a + ne[3] * b + ne[6] * c; ny = ne[1] * a + ne[4] * b + ne[7] * c; nz = ne[2] * a + ne[5] * b + ne[8] * c; var L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L; }
      this.v(X, Y, Z, nx, ny, nz, ua ? ua.getX(k) * su : 0, ua ? ua.getY(k) * sv : 0); }
    if (g.index) { var ix = g.index.array; for (var j = 0; j < ix.length; j++) this.i.push(o + ix[j]); } else for (var j2 = 0; j2 < pa.count; j2++) this.i.push(o + j2);
    return this; };
  function M4(x, y, z, ry, sx, sy, sz, rx, rz) { var m = new THREE.Matrix4(); var q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, "YXZ")); m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx === undefined ? 1 : sx, sy === undefined ? (sx === undefined ? 1 : sx) : sy, sz === undefined ? (sx === undefined ? 1 : sx) : sz)); return m; }
  // an oriented box with uv in metres per tile (world-scale texture, never stretched)
  var BOXG = null;
  Geo.prototype.box = function (cx, cy, cz, w, h, d, yaw, tile) { var t = tile || 1;
    var cs = Math.cos(yaw || 0), sn = Math.sin(yaw || 0), hx = w / 2, hy = h / 2, hz = d / 2; var self = this;
    var P = function (lx, ly, lz) { return [cx + lx * cs + lz * sn, cy + ly, cz - lx * sn + lz * cs]; };
    var W = w / t, H = h / t, D = d / t;
    self.quad(P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), [0, 0], [W, 0], [W, H], [0, H]);
    self.quad(P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), [0, 0], [W, 0], [W, H], [0, H]);
    self.quad(P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), [0, 0], [D, 0], [D, H], [0, H]);
    self.quad(P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), [0, 0], [D, 0], [D, H], [0, H]);
    self.quad(P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), [0, 0], [W, 0], [W, D], [0, D]);
    self.quad(P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), [0, 0], [W, 0], [W, D], [0, D]);
    return self; };
  // a cylinder (axis y) from y0 to y1
  Geo.prototype.cyl = function (x, y0, z, rt, rb, y1, seg, open) { var g = new THREE.CylinderGeometry(rt, rb, Math.max(0.001, y1 - y0), seg || 12, 1, !!open); this.add(g, M4(x, (y0 + y1) / 2, z, 0)); g.dispose(); return this; };
  // a rod between two points
  var _up = null;
  Geo.prototype.rod = function (a, b, r, seg) { if (!_up) _up = new THREE.Vector3(0, 1, 0); var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz); if (L < 1e-4) return this; var g = new THREE.CylinderGeometry(r, r, L, seg || 8, 1, true); var q = new THREE.Quaternion().setFromUnitVectors(_up, new THREE.Vector3(dx / L, dy / L, dz / L)); var m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1)); this.add(g, m); g.dispose(); return this; };
  Geo.prototype.empty = function () { return this.i.length === 0; };
  Geo.prototype.build = function () { var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2)); if (this.c) g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3)); g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1)); g.computeBoundingSphere(); g.computeBoundingBox(); return g; };
  Geo.prototype.mesh = function (mat, o) { if (this.empty()) return null; o = o || {}; var m = new THREE.Mesh(this.build(), mat); m.castShadow = !!o.cast; m.receiveShadow = o.recv !== false; m.userData.noInst = true; m.userData.arrivals = true; if (o.order) m.renderOrder = o.order; if (o.name) m.name = o.name; return m; };

  // ───────────────────────── textures (canvas, generated once) ─────────────────────────
  var TX = AR.tx = {};
  function cv(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function canvasTex(c, opt) { opt = opt || {}; var t = new THREE.CanvasTexture(c); if (!opt.lin) t.colorSpace = THREE.SRGBColorSpace; if (opt.rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; try { t.anisotropy = Math.min(8, MAX_ANISO || 4); } catch (e) {} if (opt.mips === false) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; } t.needsUpdate = true; return t; }
  function tiledTex(path, srgb) { try { var t = tiled(path, 1, 1); return t; } catch (e) { var t2 = new THREE.TextureLoader().load(path); t2.wrapS = t2.wrapT = THREE.RepeatWrapping; if (srgb) t2.colorSpace = THREE.SRGBColorSpace; return t2; } }
  // a soft radial glow (light pools, halos)
  function glowTex() { if (TX.glow) return TX.glow; var c = cv(128, 128), x = c.getContext("2d"), g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.55)"); g.addColorStop(0.6, "rgba(255,255,255,0.14)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 128, 128); TX.glow = canvasTex(c, { lin: false }); return TX.glow; }
  // a vertical beam gradient (uplight washes on trunks and canopies)
  function beamTex() { if (TX.beam) return TX.beam; var c = cv(64, 256), x = c.getContext("2d"); var g = x.createLinearGradient(0, 256, 0, 0); g.addColorStop(0, "rgba(255,255,255,0.9)"); g.addColorStop(0.35, "rgba(255,255,255,0.35)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 256); var h = x.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, "rgba(0,0,0,1)"); h.addColorStop(0.3, "rgba(0,0,0,0)"); h.addColorStop(0.7, "rgba(0,0,0,0)"); h.addColorStop(1, "rgba(0,0,0,1)"); x.globalCompositeOperation = "destination-out"; x.fillStyle = h; x.fillRect(0, 0, 64, 256); TX.beam = canvasTex(c); return TX.beam; }

  // ───────────────────────── materials (shared; few programs) ─────────────────────────
  var MT = null;
  function mats() {
    if (MT) return MT; MT = AR.mt = {};
    var S = function (o) { return new THREE.MeshStandardMaterial(o); };
    var trav = tiledTex("/tex/travertine.jpg", true), travN = tiledTex("/tex/travertine_n.jpg"), travR = tiledTex("/tex/travertine_r.jpg");
    MT.trav = S({ map: trav, normalMap: travN, roughnessMap: travR, color: 0xf1e4cc, roughness: 1, normalScale: new THREE.Vector2(0.55, 0.55), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    var tz = tiledTex("/tex/terrazzo.jpg", true), tzN = tiledTex("/tex/terrazzo_n.jpg"), tzR = tiledTex("/tex/terrazzo_r.jpg");
    MT.gran = S({ map: tz, normalMap: tzN, roughnessMap: tzR, color: 0x55524f, roughness: 1, normalScale: new THREE.Vector2(0.6, 0.6), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    MT.cantera = S({ map: tz, normalMap: tzN, roughnessMap: tzR, color: 0xc89a72, roughness: 1, normalScale: new THREE.Vector2(0.6, 0.6), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    MT.brass = S({ color: 0xc9a24d, roughness: 0.32, metalness: 0.9 });
    MT.led = S({ color: 0xffe2a8, emissive: 0xffc977, emissiveIntensity: 0.2, roughness: 0.4, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    MT.bronze = S({ color: 0x2f2925, roughness: 0.4, metalness: 0.75 });
    MT.white = S({ color: 0xf1f0ec, roughness: 0.38, metalness: 0.4 });
    MT.dark = S({ color: 0x1d2024, roughness: 0.55, metalness: 0.3 });
    MT.glow = new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false });
    MT.beam = new THREE.MeshBasicMaterial({ map: beamTex(), color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexColors: true, toneMapped: false });
    return MT;
  }

  // ───────────────────────── the court surface: one paved court flush with the walks ─────────────────────────
  // The court used to be the ground shader's painted disc at terrain level, crossed by three travertine ribbons 0.34 m above it
  // (the Sun Gate Walk, the Club Walk, the Landside Walk): a hard seam and a step wherever they met. Now one deck at the walks'
  // height covers the whole court; the walks run into it at the same level, the curb and its stone edge take the drop to the
  // ground outside, and the walk grid carries it, so everything seated on the surface (props, people, carts) stands on it.
  var CRT = AR.court = { R: 35, r0: 6.6, lift: 0.36, rings: [10.5, 17.5, 25, 31.6], spokes: 16, open: [], holes: [], walkIds: ["sun_gate_walk", "hl1_club_walk", "landside_walk"] };
  function courtOpenings() {
    // where the walks leave the court: an angular gap in the curb per walk (half-width plus a margin)
    var P = window.PLAN, out = []; if (!P) return out;
    for (var i = 0; i < P.promenades.length; i++) { var pr = P.promenades[i]; if (CRT.walkIds.indexOf(pr.id) < 0 && !pr.pts.some(function (q) { return Math.hypot(q[0] - K.c[0], q[1] - K.c[1]) < 2; })) continue;
      var pts = pr.pts.slice(); if (Math.hypot(pts[pts.length - 1][0] - K.c[0], pts[pts.length - 1][1] - K.c[1]) < 2) pts.reverse(); if (Math.hypot(pts[0][0] - K.c[0], pts[0][1] - K.c[1]) > 2) continue;
      // the walk's crossing of the curb circle
      var acc = 0, hit = null; for (var j = 0; j < pts.length - 1 && !hit; j++) { var a = pts[j], b = pts[j + 1]; var L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (var s = 0; s <= L; s += 0.25) { var x = a[0] + (b[0] - a[0]) * s / L, z = a[1] + (b[1] - a[1]) * s / L; if (Math.hypot(x - K.c[0], z - K.c[1]) >= CRT.R) { hit = [x, z]; break; } } }
      if (!hit) continue; var kk = w2k(hit[0], hit[1]); var ang = Math.atan2(kk[1], kk[0]); var half = Math.asin(clamp((pr.width / 2 + 0.6) / CRT.R, 0, 0.99));
      out.push({ id: pr.id, a: ang, half: half, w: pr.width }); }
    return out;
  }
  function inOpening(ang) { for (var i = 0; i < CRT.open.length; i++) { var o = CRT.open[i]; var d = Math.atan2(Math.sin(ang - o.a), Math.cos(ang - o.a)); if (Math.abs(d) < o.half) return o; } return null; }
  function inHole(x, z) { for (var i = 0; i < CRT.holes.length; i++) if (planInPoly(CRT.holes[i], x, z)) return true; return false; }
  // is (x, z) on one of the walks that run through the court (their ribbons may stand higher than the deck on a cross-slope)
  function onWalk(x, z) { var P = window.PLAN; if (!P) return false; for (var i = 0; i < P.promenades.length; i++) { var pr = P.promenades[i]; if (CRT.walkIds.indexOf(pr.id) < 0) continue; var p = pr.pts; for (var j = 0; j < p.length - 1; j++) { var ax = p[j][0], az = p[j][1], vx = p[j + 1][0] - ax, vz = p[j + 1][1] - az, L2 = vx * vx + vz * vz || 1; var t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1); if (Math.hypot(x - ax - vx * t, z - az - vz * t) < pr.width / 2 + 0.3) return true; } } return false; }
  function courtIn(x, z) { var d = Math.hypot(x - K.c[0], z - K.c[1]); return d >= CRT.r0 - 0.3 && d <= CRT.R + 0.05 && !inHole(x, z); }
  // the deck height: the ground plus the walks' lift; over a walk whose ribbon stands higher, a hair over the ribbon
  CRT.prov = function (x, z) { return terr(x, z) + CRT.lift; };
  CRT.y = function (x, z) { var y = CRT.prov(x, z); if (CRT.final && onWalk(x, z)) { var w = CRT.rib ? CRT.rib(x, z) : null; if (w !== null && w > y) y = w + 0.006; } return y; };
  // walk grid: write a cell (assignment, so the final pass can lower what the provisional one raised)
  function walkPut(x, z, y) { var C = WALK.C, CH = WALK.CH; var gx = Math.floor(x / C), gz = Math.floor(z / C); var kx = Math.floor(gx / CH), kz = Math.floor(gz / CH); var key = kx * 100003 + kz; var a = WALK.chunks.get(key); if (!a) { a = new Float32Array(CH * CH).fill(-1e9); WALK.chunks.set(key, a); } var i = (gz - kz * CH) * CH + (gx - kx * CH); if (a[i] < -1e8) WALK.cells++; a[i] = y; }
  function walkGet(x, z) { var C = WALK.C, CH = WALK.CH; var gx = Math.floor(x / C), gz = Math.floor(z / C); var kx = Math.floor(gx / CH), kz = Math.floor(gz / CH); var a = WALK.chunks.get(kx * 100003 + kz); if (!a) return null; var y = a[(gz - kz * CH) * CH + (gx - kx * CH)]; return y > -1e8 ? y : null; }
  function courtRaster(fn) { var C = WALK.C, R = CRT.R; var n = 0; for (var gx = Math.floor((K.c[0] - R) / C); gx <= Math.floor((K.c[0] + R) / C); gx++) for (var gz = Math.floor((K.c[1] - R) / C); gz <= Math.floor((K.c[1] + R) / C); gz++) { var x = (gx + 0.5) * C, z = (gz + 0.5) * C; if (!courtIn(x, z)) continue; fn(x, z); n++; } return n; }
  function courtHoles() {
    CRT.holes = [];
    // the shade pavilion's 0.5 m sandstone platform stays its own step up (b0033)
    try { var pv = PLACE.pavilion || []; var info = window.PLAN_MODEL_INFO && PLAN_MODEL_INFO.pavilion; var half = (info && info.posts && info.posts[4] ? info.posts[4][2] / 2 : 8.3) + 0.04;
      for (var i = 0; i < pv.length; i++) { var e = pv[i]; if (Math.hypot(e[0] - K.c[0], e[2] - K.c[1]) > CRT.R + 14) continue; var s = e[4] || 1, c = Math.cos(e[3]), sn = Math.sin(e[3]), h = half * s; CRT.holes.push([[-h, -h], [h, -h], [h, h], [-h, h]].map(function (q) { return [e[0] + q[0] * c + q[1] * sn, e[2] - q[0] * sn + q[1] * c]; })); } } catch (e) { note("court holes", e); }
  }
  // world hook (first of all world hooks): the provisional deck in the walk grid, so every module that seats something in the
  // court from here on (world hooks, the client's DEFER, the plan defer hooks, planSeatProps) puts it on the deck
  function worldEarly() {
    if (!window.PLAN) return; frames(); AR.t.w0 = performance.now();
    if (ON.court) { try { CRT.open = courtOpenings(); courtHoles(); var n = courtRaster(function (x, z) { var y = CRT.prov(x, z); var w = walkGet(x, z); if (w === null || y > w) walkPut(x, z, y); }); AR.n.courtCells = n; planterCells(function (x, z) { walkPut(x, z, CRT.prov(x, z) + 0.45); }); KEEPOUT.push([K.c[0], K.c[1], CRT.R + 1]); } catch (e) { note("court walk", e); } }
    if (ON.apron) { try { apronWalk(); apronCellsPlanters(function (x, z) { walkPut(x, z, APR.y(x, z) + 0.72); }); } catch (e) { note("apron walk", e); } }
    try { world18Early(); } catch (e) { note("r18 worldEarly", e); }
    AR.t.worldEarly = +(performance.now() - AR.t.w0).toFixed(1);
  }
  // defer (first of the plan defer hooks; the ribbons are drawn and in the walk grid by now): the final deck heights
  function deferEarly() {
    if (!window.PLAN) return; var t0 = performance.now(); if (ON.court) {
    try {
      // the ribbons' own heights inside the court: what the walk grid holds above the provisional deck on a walk
      var rib = new Map(), ribL = [], ribAll = new Map(); courtRaster(function (x, z) { if (!onWalk(x, z)) return; var w = walkGet(x, z), p = CRT.prov(x, z); var gx = Math.floor(x / WALK.C), gz = Math.floor(z / WALK.C); if (w !== null && w > p + 0.002) { rib.set(gx * 100003 + gz, w); ribL.push([gx, gz, w]); } if (w !== null && Math.abs(w - p) > 0.002) ribAll.set(gx * 100003 + gz, w); });
      CRT.rib = function (x, z) { var v = rib.get(Math.floor(x / WALK.C) * 100003 + Math.floor(z / WALK.C)); return v === undefined ? null : v; };
      CRT.final = true; AR.n.ribCells = rib.size; if (ON18.fix) { try { deckFix(); } catch (e) { note("r18 deck", e); } }
      courtRaster(function (x, z) { walkPut(x, z, CRT.y(x, z)); }); planterCells(function (x, z) { walkPut(x, z, CRT.y(x, z) + 0.45); }); for (var di = 0; di < DLAY.planters.length; di++) { var dw = t2w(DLAY.planters[di][0], DLAY.planters[di][1]); var wy = walkGet(dw[0], dw[1]); DOORY[di] = wy !== null ? wy : terr(dw[0], dw[1]); } doorCells(function (x, z) { var di2 = 0; var d0 = t2w(DLAY.planters[0][0], DLAY.planters[0][1]); if (Math.hypot(x - d0[0], z - d0[1]) > 2) di2 = 1; walkPut(x, z, DOORY[di2] + 0.5); });
    } catch (e) { note("court final", e); }
    deferCells18(); }
    if (ON.apron) { try { apronWalk(); apronCellsPlanters(function (x, z) { walkPut(x, z, APR.y(x, z) + 0.72); }); } catch (e) { note("apron final", e); } }
    AR.t.deferEarly = +(performance.now() - t0).toFixed(1);
  }

  // the deck mesh: rings of honed travertine slabs (polar uv, so the joints run round the fountain), granite bands, spokes,
  // the curb and its stone edge down to the ground, brass LED inlays
  function buildCourtDeck(grp) {
    var M = mats(); var R = CRT.R, r0 = CRT.r0, N = 240; var TILE = 4.5;   // travertine.jpg: 3 x 3 slabs, 1.5 m slabs at 4.5 m
    var bands = [r0].concat(CRT.rings).concat([R]);
    var deck = new Geo(), gran = new Geo(), led = new Geo(), cant = new Geo();
    var Y = function (x, z) { return CRT.y(x, z); };
    for (var b = 0; b < bands.length - 1; b++) {
      var ra = bands[b], rb = bands[b + 1]; var rm = (ra + rb) / 2; var Ku = Math.max(4, Math.round(TAU * rm / TILE));   // textures round the band
      var nr = Math.max(1, Math.ceil((rb - ra) / 1.0)); var rows = [];
      for (var i = 0; i <= nr; i++) { var r = ra + (rb - ra) * i / nr; var row = []; for (var j = 0; j <= N; j++) { var th = j / N * TAU; var w = k2w(Math.cos(th) * r, Math.sin(th) * r); var keep = !inHole(w[0], w[1]); row.push({ x: w[0], z: w[1], y: Y(w[0], w[1]), u: j / N * Ku, v: (r - ra) / TILE, k: keep }); } rows.push(row); }
      for (var i2 = 0; i2 < nr; i2++) for (var j2 = 0; j2 < N; j2++) { var A = rows[i2][j2], B = rows[i2][j2 + 1], Cc = rows[i2 + 1][j2 + 1], D = rows[i2 + 1][j2]; if (!(A.k && B.k && Cc.k && D.k)) continue;
        var ia = deck.v(A.x, A.y, A.z, 0, 1, 0, A.u, A.v), ib = deck.v(B.x, B.y, B.z, 0, 1, 0, B.u, B.v), ic = deck.v(Cc.x, Cc.y, Cc.z, 0, 1, 0, Cc.u, Cc.v), id = deck.v(D.x, D.y, D.z, 0, 1, 0, D.u, D.v); deck.i.push(ia, ib, ic, ia, ic, id); }
    }
    // a granite band: a ring strip of width bw centred on radius r (skips the holes); at the curb it follows the openings too
    var ringStrip = function (G, r, bw, lift, skipOpen, segLen) { var n = Math.max(48, Math.round(TAU * r / (segLen || 0.9))); for (var j = 0; j < n; j++) { var t0 = j / n * TAU, t1 = (j + 1) / n * TAU; var tm = (t0 + t1) / 2; if (skipOpen && inOpening(tm)) continue;
        var p0 = k2w(Math.cos(t0) * (r - bw / 2), Math.sin(t0) * (r - bw / 2)), p1 = k2w(Math.cos(t1) * (r - bw / 2), Math.sin(t1) * (r - bw / 2)), p2 = k2w(Math.cos(t1) * (r + bw / 2), Math.sin(t1) * (r + bw / 2)), p3 = k2w(Math.cos(t0) * (r + bw / 2), Math.sin(t0) * (r + bw / 2));
        if (inHole(p0[0], p0[1]) || inHole(p2[0], p2[1]) || inHole(p1[0], p1[1]) || inHole(p3[0], p3[1])) continue;
        var u0 = t0 * r / 1.2, u1 = t1 * r / 1.2;
        G.quad([p0[0], Y(p0[0], p0[1]) + lift, p0[1]], [p1[0], Y(p1[0], p1[1]) + lift, p1[1]], [p2[0], Y(p2[0], p2[1]) + lift, p2[1]], [p3[0], Y(p3[0], p3[1]) + lift, p3[1]], [u0, 0], [u1, 0], [u1, bw / 1.2], [u0, bw / 1.2]); } };
    ringStrip(cant, CRT.rings[0], 0.62, 0.004); for (var q = 1; q < CRT.rings.length; q++) ringStrip(gran, CRT.rings[q], 0.36, 0.004);
    // spokes between the first and the last band (the Horizon Line axis is one of them)
    for (var s = 0; s < CRT.spokes; s++) { var th2 = s / CRT.spokes * TAU; var c = Math.cos(th2), sn = Math.sin(th2); var ra2 = CRT.rings[0] + 0.31, rb2 = CRT.rings[CRT.rings.length - 1] - 0.18; var hw = 0.14; var steps = Math.ceil((rb2 - ra2) / 1.2);
      for (var k = 0; k < steps; k++) { var a0 = ra2 + (rb2 - ra2) * k / steps, a1 = ra2 + (rb2 - ra2) * (k + 1) / steps; var P0 = k2w(c * a0 - sn * hw, sn * a0 + c * hw), P1 = k2w(c * a1 - sn * hw, sn * a1 + c * hw), P2 = k2w(c * a1 + sn * hw, sn * a1 - c * hw), P3 = k2w(c * a0 + sn * hw, sn * a0 - c * hw);
        if (inHole(P0[0], P0[1]) || inHole(P2[0], P2[1])) continue;
        cant.quad([P0[0], Y(P0[0], P0[1]) + 0.004, P0[1]], [P1[0], Y(P1[0], P1[1]) + 0.004, P1[1]], [P2[0], Y(P2[0], P2[1]) + 0.004, P2[1]], [P3[0], Y(P3[0], P3[1]) + 0.004, P3[1]], [a0 / 1.2, 0], [a1 / 1.2, 0], [a1 / 1.2, 0.34 / 1.2], [a0 / 1.2, 0.34 / 1.2]); } }
    // the curb: a 0.62 m granite band at the rim, and the stone edge from the deck down into the ground, open where a walk leaves
    ringStrip(gran, R - 0.31, 0.62, 0.012, true, 0.8);
    { var n2 = Math.round(TAU * R / 0.8); for (var j3 = 0; j3 < n2; j3++) { var t0b = j3 / n2 * TAU, t1b = (j3 + 1) / n2 * TAU; if (inOpening((t0b + t1b) / 2)) continue; var e0 = k2w(Math.cos(t0b) * R, Math.sin(t0b) * R), e1 = k2w(Math.cos(t1b) * R, Math.sin(t1b) * R); if (inHole(e0[0], e0[1]) || inHole(e1[0], e1[1])) continue;
      var y0a = Y(e0[0], e0[1]) + 0.012, y1a = Y(e1[0], e1[1]) + 0.012, g0 = terr(e0[0], e0[1]) - 0.15, g1 = terr(e1[0], e1[1]) - 0.15;
      gran.quad([e1[0], g1, e1[1]], [e0[0], g0, e0[1]], [e0[0], y0a, e0[1]], [e1[0], y1a, e1[1]], [t1b * R / 1.2, 0], [t0b * R / 1.2, 0], [t0b * R / 1.2, (y0a - g0) / 1.2], [t1b * R / 1.2, (y1a - g1) / 1.2]); } }
    // brass LED inlays: a ring round the fountain band and one inside the curb (they glow after dusk)
    ringStrip(led, CRT.rings[0] - 0.42, 0.07, 0.008); ringStrip(led, R - 0.75, 0.07, 0.016, true); ringStrip(led, CRT.rings[2], 0.05, 0.008);
    var me = deck.mesh(M.trav, { name: "ar court deck" }); if (me) grp.add(me);
    var mg = gran.mesh(M.gran, { name: "ar court granite" }); if (mg) grp.add(mg);
    var ml = led.mesh(M.led, { name: "ar court led" }); if (ml) grp.add(ml); var mc = cant.mesh(M.cantera, { name: "ar court spokes" }); if (mc) grp.add(mc);
    AR.n.deckTris = me ? me.geometry.index.count / 3 : 0;
  }
  // things the client builds on the bare ground inside the court (the tour booth) go up onto the deck with their solids
  function liftOnto(obj, dy, r) { if (!obj || !(dy > 0.01)) return 0; obj.position.y += dy; obj.updateMatrixWorld(true); var n = 0; for (var i = 0; i < SOLIDS.length; i++) { var s = SOLIDS[i]; if (Math.hypot(s.x - obj.position.x, s.z - obj.position.z) < r && s.y0 < obj.position.y - dy + 0.2) { s.y0 += dy; s.y1 += dy; n++; } } return n; }
  function liftCourtBits() {
    var out = 0;
    try { // the SITE TOURS booth at GUIDE (client: buildTourBooth, on getH)
      for (var i = 0; i < scene.children.length; i++) { var o = scene.children[i]; if (!o.isGroup || o.userData.arrivals) continue; if (Math.hypot(o.position.x - GUIDE.x, o.position.z - GUIDE.z) > 0.05) continue; var t = terr(o.position.x, o.position.z); if (Math.abs(o.position.y - t) > 0.05) continue; var dy = CRT.y(o.position.x, o.position.z) - o.position.y; liftOnto(o, dy, 2.6); out++; }
    } catch (e) { note("lift booth", e); }
    // lamps placed before the deck existed stand at the old ground: seat them on the deck (their own packed matrices)
    try { ["lux_lamp", "lamp", "stone_pillar"].forEach(function (k) { (PLACE[k] || []).forEach(function (e) { if (!courtIn(e[0], e[2])) return; var y = CRT.y(e[0], e[2]); if (e[1] < y - 0.08 && typeof planSeatEntry === "function") { planSeatEntry(k, e, y); out++; } }); }); } catch (e) { note("lift lamps", e); }
    AR.n.lifted = out;
  }

  // ───────────────────────── canvas type ─────────────────────────
  var FT = { d: "Anton, Impact, sans-serif", b: "'Space Grotesk', system-ui, sans-serif", m: "'JetBrains Mono', ui-monospace, monospace", s: "Fraunces, Georgia, serif" };
  function fit(x, t, maxW, px, font, weight) { var s = px; x.font = (weight || 400) + " " + s + "px " + font; while (s > 8 && x.measureText(t).width > maxW) { s -= 2; x.font = (weight || 400) + " " + s + "px " + font; } return s; }
  function txt(x, t, cx, cy, px, font, col, weight, align, maxW, ls) { if (ls) { try { x.letterSpacing = ls + "px"; } catch (e) {} } var s = maxW ? fit(x, t, maxW, px, font, weight) : px; x.font = (weight || 400) + " " + s + "px " + font; x.fillStyle = col; x.textAlign = align || "center"; x.textBaseline = "middle"; x.fillText(t, cx, cy); if (ls) { try { x.letterSpacing = "0px"; } catch (e) {} } return s; }
  function rr(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.lineTo(a + w - r, b); x.quadraticCurveTo(a + w, b, a + w, b + r); x.lineTo(a + w, b + h - r); x.quadraticCurveTo(a + w, b + h, a + w - r, b + h); x.lineTo(a + r, b + h); x.quadraticCurveTo(a, b + h, a, b + h - r); x.lineTo(a, b + r); x.quadraticCurveTo(a, b, a + r, b); x.closePath(); }
  var LOGO = { img: null, ok: false, cbs: [] };
  function logo(cb) { if (LOGO.ok) { cb(LOGO.img); return; } LOGO.cbs.push(cb); if (LOGO.img) return; LOGO.img = new Image(); LOGO.img.onload = function () { LOGO.ok = true; var c = LOGO.cbs; LOGO.cbs = []; c.forEach(function (f) { try { f(LOGO.img); } catch (e) { note("logo cb", e); } }); }; LOGO.img.onerror = function () { note("logo", "load failed"); }; LOGO.img.src = "/tex/ar_logo.png?v=" + (window.BUILD || "dev"); }
  // the logo is 2:1: sized by its height only
  function drawLogo(x, img, cx, cy, h) { var w = h * 2; x.drawImage(img, cx - w / 2, cy - h / 2, w, h); }
  var REDRAW = AR.redraw = [];   // canvases drawn again once the web fonts are in
  function onFonts(fn) { REDRAW.push(fn); try { fn(); } catch (e) { note("draw", e); } }
  try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { setTimeout(function () { REDRAW.forEach(function (f) { try { f(); } catch (e) {} }); }, 400); }); } catch (e) {}
  function lowq() { try { return QUAL && QUAL.level === "low"; } catch (e) { return false; } }

  // ───────────────────────── hubs: names, positions, distances ─────────────────────────
  var HUBDEF = [["Stellar Aviation FBO", "Stellar FBO"], ["Crossing Plaza", "Crossing Plaza"], ["The Landing Clubhouse", "Landing Club"], ["Founders Row", "Founders Row"], ["Propeller Plaza", "The Flight Line"], ["Expanse Gate", "Expanse Gate"], ["Four Corners", "Main Street"], ["Compass Plaza", "Compass Plaza"], ["GBANK", "GBANK"], ["The Commons", "The Commons"], ["The Genesis Ring", "Genesis Ring"], ["Genesis Park", "Genesis Park"], ["Genesis Arcade", "Genesis Arcade"], ["Solport Convention Center", "Convention Center"]];
  function hubs() { var out = []; try { for (var i = 0; i < HUBDEF.length; i++) { var nm = HUBDEF[i][0]; var h = HUBS.find(function (q) { return q[0] === nm; }); if (!h) continue; var d = Math.hypot(h[1] - K.c[0], h[2] - K.c[1]); out.push({ name: HUBDEF[i][1], full: nm, x: h[1], z: h[2], d: d }); } } catch (e) { note("hubs", e); } return out; }
  function distTxt(d) { return d < 950 ? Math.round(d / 10) * 10 + " m" : (d / 1000).toFixed(1) + " km"; }
  function minTxt(d) { var m = Math.max(1, Math.round(d / 75)); return m + " min"; }

  // ───────────────────────── the site map: districts, roads, walks, the runway, the Horizon Line, buildings ─────────────────────────
  var SITEBB = { x0: -500, x1: 1140, z0: -640, z1: 1010 };
  function stageCol(d) { try { var st = planStageOf(d); return (PLAN_STAGE[st] || PLAN_STAGE.AIRPORT)[1]; } catch (e) { return "#f5f1e6"; } }
  // draws the plan into the rect (X0, Y0, W, H) centred on world (cxw, czw), `scale` px per metre; `up` is the world heading
  // (yaw: 0 = +z) shown as screen-up. Returns the world -> canvas map.
  function drawPlan(x, X0, Y0, W, H, cxw, czw, scale, up, opt) {
    opt = opt || {}; var P = window.PLAN; if (!P) return null;
    // a world direction d = (sin yaw, cos yaw); screen-up is -y. Rotate so that heading `up` maps to (0, -1).
    var cu = Math.cos(up), su = Math.sin(up);
    var M2 = function (wx, wz) { var dx = wx - cxw, dz = wz - czw; var rgt = -dx * cu + dz * su, fwd = dx * su + dz * cu; return [X0 + W / 2 + rgt * scale, Y0 + H / 2 - fwd * scale]; };
    x.save(); x.beginPath(); x.rect(X0, Y0, W, H); x.clip();
    x.fillStyle = opt.bg || "#ece2cf"; x.fillRect(X0, Y0, W, H);
    var line = function (pts) { x.beginPath(); for (var k = 0; k < pts.length; k++) { var q = M2(pts[k][0], pts[k][1]); if (k) x.lineTo(q[0], q[1]); else x.moveTo(q[0], q[1]); } };
    for (var i = 0; i < P.districts.length; i++) { var d = P.districts[i]; line(d.poly); x.closePath(); var col = stageCol(d); x.globalAlpha = opt.distA || 0.2; x.fillStyle = col; x.fill(); x.globalAlpha = 0.6; x.strokeStyle = col; x.lineWidth = Math.max(1, scale * 1.6); x.stroke(); x.globalAlpha = 1; }
    try { var R = P.runway; x.strokeStyle = "#3b3f44"; x.lineCap = "butt"; x.lineWidth = Math.max(3, 46 * scale); line([R.ne, R.sw]); x.stroke(); x.strokeStyle = "#f5f1e6"; x.setLineDash([30 * scale, 24 * scale]); x.lineWidth = Math.max(1, 1.5 * scale); line([R.ne, R.sw]); x.stroke(); x.setLineDash([]); } catch (e) {}
    x.lineJoin = "round"; x.lineCap = "round";
    for (var r2 = 0; r2 < P.roads.length; r2++) { var rd = P.roads[r2]; if (rd.class === "tunnel") continue; var tw = rd.class === "taxilane"; x.strokeStyle = tw ? "#8a8f95" : "#c4a77b"; x.lineWidth = Math.max(tw ? 2 : 1.3, (rd.width || 8) * scale * 1.15); line(rd.pts); x.stroke(); }
    for (var p2 = 0; p2 < P.promenades.length; p2++) { var pr = P.promenades[p2]; x.strokeStyle = "#fbf5ea"; x.lineWidth = Math.max(1.3, (pr.width || 6) * scale * 1.25); line(pr.pts); x.stroke(); }
    try { var hl = ["sun_gate_walk", "hl1_club_walk", "the_crossing", "hl3_main_street", "hl4_sculpture_ave", "hl5_launch_walk"].map(function (id) { return P.promenades.find(function (q) { return q.id === id; }) || P.roads.find(function (q) { return q.id === id; }); }).filter(Boolean); x.strokeStyle = "#b8862e"; x.lineWidth = Math.max(2, 7 * scale); for (var h1 = 0; h1 < hl.length; h1++) { line(hl[h1].pts); x.stroke(); } } catch (e) {}
    x.fillStyle = opt.bld || "#6f665a"; for (var bi = 0; bi < P.buildings.length; bi++) { var bd = P.buildings[bi]; if (!bd.poly || bd.kind === "jet") continue; line(bd.poly); x.closePath(); x.fill(); }
    x.restore(); return M2;
  }
  // the totem faces: header, the heads-up map with the hubs and YOU ARE HERE, the walking times
  function totemDraw(c, faces) {
    var x = c.getContext("2d"), W = c.width, Hh = c.height, fw = W / faces.length; var hs = hubs();
    for (var f = 0; f < faces.length; f++) { var X0 = f * fw, up = faces[f].up; var u = fw / 1024;
      x.fillStyle = "#0b1712"; x.fillRect(X0, 0, fw, Hh);
      x.fillStyle = "#c9a24d"; x.fillRect(X0 + 40 * u, 46 * u, fw - 80 * u, 6 * u);
      txt(x, "ARRIVALS COURT", X0 + fw / 2, 122 * u, 100 * u, FT.d, "#f5f1e6", 400, "center", fw - 120 * u, 4 * u);
      txt(x, "STAGE ONE · THE LANDING · GENESIS", X0 + fw / 2, 196 * u, 32 * u, FT.b, "#4DDE6F", 600, "center", fw - 140 * u, 3 * u);
      var MX = X0 + 56 * u, MY = 250 * u, MW = fw - 112 * u, MH = Hh - 250 * u - 560 * u;
      rr(x, MX - 8 * u, MY - 8 * u, MW + 16 * u, MH + 16 * u, 18 * u); x.fillStyle = "#c9a24d"; x.fill();
      var sc = Math.min(MW, MH) / 1650; var cxw = (SITEBB.x0 + SITEBB.x1) / 2, czw = (SITEBB.z0 + SITEBB.z1) / 2;
      var M2 = drawPlan(x, MX, MY, MW, MH, cxw, czw, sc, up, { bg: "#efe6d4", distA: 0.24 });
      faces[f].map = { MX: MX, MY: MY, MW: MW, MH: MH, cxw: cxw, czw: czw, sc: sc, up: up, W: W, H: Hh };
      if (M2) { x.save(); x.beginPath(); x.rect(MX, MY, MW, MH); x.clip();
        for (var i = 0; i < hs.length; i++) { var q = M2(hs[i].x, hs[i].z); x.fillStyle = "#0b1712"; x.beginPath(); x.arc(q[0], q[1], 7 * u, 0, TAU); x.fill(); x.fillStyle = "#f4cd5a"; x.beginPath(); x.arc(q[0], q[1], 4 * u, 0, TAU); x.fill(); x.font = "600 " + Math.round(23 * u) + "px " + FT.b; var tw = x.measureText(hs[i].name).width; x.fillStyle = "rgba(11,23,18,0.82)"; rr(x, q[0] + 10 * u, q[1] - 15 * u, tw + 14 * u, 30 * u, 6 * u); x.fill(); txt(x, hs[i].name, q[0] + 17 * u, q[1], 23 * u, FT.b, "#f5f1e6", 600, "left"); }
        var yh = M2(K.c[0], K.c[1]); x.fillStyle = "rgba(77,222,111,0.28)"; x.beginPath(); x.arc(yh[0], yh[1], 34 * u, 0, TAU); x.fill(); x.fillStyle = "#4DDE6F"; x.beginPath(); x.arc(yh[0], yh[1], 13 * u, 0, TAU); x.fill(); x.strokeStyle = "#0b1712"; x.lineWidth = 4 * u; x.stroke();
        x.fillStyle = "#0b1712"; rr(x, yh[0] - 120 * u, yh[1] - 80 * u, 240 * u, 44 * u, 10 * u); x.fill(); txt(x, "YOU ARE HERE", yh[0], yh[1] - 58 * u, 28 * u, FT.d, "#4DDE6F", 400, "center", 220 * u, 2 * u);
        x.restore(); }
      { var nx = MX + MW - 60 * u, ny = MY + 70 * u; x.save(); x.translate(nx, ny); x.rotate(up); x.fillStyle = "#0b1712"; x.beginPath(); x.arc(0, 0, 38 * u, 0, TAU); x.fill(); x.fillStyle = "#f5f1e6"; x.beginPath(); x.moveTo(0, -28 * u); x.lineTo(12 * u, 10 * u); x.lineTo(0, 3 * u); x.lineTo(-12 * u, 10 * u); x.closePath(); x.fill(); x.restore(); txt(x, "N", nx, ny + 50 * u, 20 * u, FT.b, "#f4cd5a", 700); }
      var LY = MY + MH + 40 * u; txt(x, "WALKING FROM HERE", X0 + 64 * u, LY, 30 * u, FT.d, "#c9a24d", 400, "left", 600 * u, 3 * u);
      var rows = Math.ceil(hs.length / 2);
      for (var j = 0; j < hs.length; j++) { var cx0 = X0 + 64 * u + (j >= rows ? fw / 2 - 30 * u : 0), cy0 = LY + 52 * u + (j % rows) * 52 * u; txt(x, hs[j].name, cx0, cy0, 27 * u, FT.b, "#f5f1e6", 600, "left", 240 * u); txt(x, distTxt(hs[j].d) + " · " + minTxt(hs[j].d), cx0 + 410 * u, cy0, 23 * u, FT.m, "#9fd8b0", 500, "right", 165 * u); }
      x.fillStyle = "#c9a24d"; x.fillRect(X0 + 40 * u, Hh - 92 * u, fw - 80 * u, 4 * u);
      txt(x, "GRAND LOOP SHUTTLE · THE NORTH KERB OF THE COURT · EVERY 15 MIN", X0 + fw / 2, Hh - 50 * u, 25 * u, FT.m, "#f4cd5a", 600, "center", fw - 120 * u);
    }
  }
  // a face's canvas uv (0..1, both faces side by side) for a world point, for the live dot
  function faceUV(F, wx, wz) { var m = F.map; if (!m) return null; var dx = wx - m.cxw, dz = wz - m.czw; var cu = Math.cos(m.up), su = Math.sin(m.up); var rgt = -dx * cu + dz * su, fwd = dx * su + dz * cu; var px = m.MX + m.MW / 2 + rgt * m.sc, py = m.MY + m.MH / 2 - fwd * m.sc; if (px < m.MX || px > m.MX + m.MW || py < m.MY || py > m.MY + m.MH) return null; return [px / m.W, py / m.H]; }

  // ───────────────────────── court pieces ─────────────────────────
  var LAY = AR.layout = {
    planters: [[40, 24], [128, 24.5], [262, 27], [305, 24]],      // [angle deg, radius] in the court frame
    benches: [[40, 13.6], [90, 13.6], [130, 13.6], [300, 13.6], [330, 13.6]],
    totem: [195, 21], model: [148, 21.5], post: [292, 15.5], pylons: [[22.2, 35.9], [-22.2, 35.9]],
    banners: [[148, 36.6], [196, 36.6], [244, 36.6], [300, 36.6], [60, 36.6], [112, 36.6], [340, 36.6], [20, 36.6]],
    stop: 272,
  };
  function kp(a, r) { var t = a * Math.PI / 180; return [Math.cos(t) * r, Math.sin(t) * r]; }
  function kw(a, r) { var q = kp(a, r); return k2w(q[0], q[1]); }
  function addSeat(x, z, yaw, w, d, y0, y1) { var sd = addSolid(x, z, yaw, w, d, y0, y1, "world"); if (sd) { sd.seat = true; sd.face = yaw; sd.noStep = true; } return sd; }
  function wall(x, z, yaw, w, d, y0, y1) { var sd = addSolid(x, z, yaw, w, d, y0, y1, "world"); if (sd) sd.noStep = true; return sd; }
  function planterCells(fn) { for (var i = 0; i < LAY.planters.length; i++) { var w = kw(LAY.planters[i][0], LAY.planters[i][1]); for (var dx = -2; dx <= 2; dx += 0.5) for (var dz = -2; dz <= 2; dz += 0.5) { if (Math.hypot(dx, dz) > 1.55) continue; fn(w[0] + dx, w[1] + dz); } } }
  // the world hook placements: instanced by the engine, seated by planSeatProps on the deck and the bed soil
  function courtPlace() {
    var R = rng(1503);
    for (var i = 0; i < LAY.planters.length; i++) { var w = kw(LAY.planters[i][0], LAY.planters[i][1]); if (MODELS.datepalm) put("datepalm", w[0], w[1], R() * TAU, 1.22 + R() * 0.12);
      for (var k = 0; k < 4; k++) { var a = k / 4 * TAU + 0.6, kind = k % 2 ? "agave_cluster" : "barrel_cactus"; if (MODELS[kind]) put(kind, w[0] + Math.cos(a) * 1.05, w[1] + Math.sin(a) * 1.05, R() * TAU, kind === "agave_cluster" ? 0.62 : 0.9); } }
    AR.parts.benches = [];
    for (var j = 0; j < LAY.benches.length; j++) { var b = LAY.benches[j], p = kp(b[0], b[1]), wp = k2w(p[0], p[1]); var yaw = kYaw(-p[0], -p[1]); if (MODELS.bench_lux) { put("bench_lux", wp[0], wp[1], yaw, 1); AR.parts.benches.push([wp[0], wp[1], yaw]); } }
    KEEPOUT.push([K.c[0], K.c[1], CRT.R + 1]);
  }
  var SOILM = null;
  function soilMat() { if (SOILM) return SOILM; try { SOILM = new THREE.MeshStandardMaterial({ map: TEX.dirt, normalMap: TEX.dirtN, normalScale: new THREE.Vector2(0.9, 0.9), color: 0x5e4634, roughness: 1 }); } catch (e) { SOILM = new THREE.MeshStandardMaterial({ color: 0x5e4634, roughness: 1 }); } return SOILM; }
  function buildPlanters(grp) {
    var M = mats(); var wallG = new Geo(), cap = new Geo(), soil = new Geo();
    for (var i = 0; i < LAY.planters.length; i++) { var w = kw(LAY.planters[i][0], LAY.planters[i][1]); var y = CRT.y(w[0], w[1]); var R0 = 1.95, Hh = 0.55;
      var cg = new THREE.CylinderGeometry(R0, R0 + 0.03, Hh + 0.2, 40, 1, true); var uv = cg.attributes.uv; for (var k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * TAU * R0 / 1.5, uv.getY(k) * (Hh + 0.2) / 1.5); wallG.add(cg, M4(w[0], y + Hh / 2 - 0.1, w[1], 0)); cg.dispose();
      var ring = new THREE.RingGeometry(R0 - 0.32, R0 + 0.06, 40, 1); ring.rotateX(-Math.PI / 2); var uv3 = ring.attributes.uv, pa = ring.attributes.position; for (var k3 = 0; k3 < uv3.count; k3++) uv3.setXY(k3, pa.getX(k3) / 1.2, pa.getZ(k3) / 1.2); cap.add(ring, M4(w[0], y + Hh + 0.005, w[1], 0)); ring.dispose();
      var disc = new THREE.CircleGeometry(R0 - 0.3, 32); disc.rotateX(-Math.PI / 2); var uv4 = disc.attributes.uv, pa4 = disc.attributes.position; for (var k4 = 0; k4 < uv4.count; k4++) uv4.setXY(k4, pa4.getX(k4) / 2, pa4.getZ(k4) / 2); soil.add(disc, M4(w[0], y + 0.45, w[1], 0)); disc.dispose();
      wall(w[0], w[1], 0, 3.5, 3.5, y - 0.2, y + Hh); wall(w[0], w[1], Math.PI / 4, 3.5, 3.5, y - 0.2, y + Hh); }
    var a = wallG.mesh(M.trav, { cast: true, name: "ar planter walls" }), b = cap.mesh(M.gran, { name: "ar planter caps" }), c = soil.mesh(soilMat(), { name: "ar planter soil" });
    [a, b, c].forEach(function (m) { if (m) grp.add(m); });
  }
  function benchSeats() { var L = AR.parts.benches || []; for (var i = 0; i < L.length; i++) { var b = L[i]; var y = CRT.y(b[0], b[1]); addSeat(b[0], b[1], b[2], 1.75, 0.5, y, y + 0.46); } }

  // the directory totem: two lit faces with the heads-up map and the walking times; the player's live dot when close
  var TOT = null;
  function buildTotem(grp) {
    var M = mats(); var p = kp(LAY.totem[0], LAY.totem[1]), w = k2w(p[0], p[1]); var y = CRT.y(w[0], w[1]);
    var sg = kw(172, 33); var yaw = Math.atan2(sg[0] - w[0], sg[1] - w[1]);   // the front faces the visitor walking in from the Sun Gate
    var Wd = 2.5, Ht = 4.7, Dp = 0.56; var g = new THREE.Group(); g.position.set(w[0], y, w[1]); g.rotation.y = yaw; g.name = "ar totem"; g.userData.arrivals = true;
    var body = new Geo(), bron = new Geo(), stone = new Geo();
    stone.box(0, 0.2, 0, Wd + 0.5, 0.4, Dp + 0.5, 0, 1.2); stone.box(0, 0.46, 0, Wd + 0.2, 0.12, Dp + 0.2, 0, 1.2);
    bron.box(0, 0.52 + Ht / 2, 0, Wd, Ht, Dp, 0, 1); bron.box(0, 0.52 + Ht + 0.06, 0, Wd + 0.12, 0.12, Dp + 0.12, 0, 1);
    for (var s = -1; s <= 1; s += 2) body.box(s * (Wd / 2 + 0.005), 0.52 + Ht / 2, 0, 0.02, Ht - 0.1, Dp - 0.12, 0, 1.2);
    var mb = bron.mesh(M.bronze, { cast: true }), ms = stone.mesh(M.trav, { cast: true }), mo = body.mesh(M.trav, {}); [mb, ms, mo].forEach(function (m) { if (m) g.add(m); });
    // the front is read by someone facing -yaw's direction... the visitor faces the totem, i.e. looks along (yaw + PI): that heading is up on the front map
    var upF = yaw + Math.PI, upB = yaw;
    var cW = lowq() ? 1024 : 2048, cH = lowq() ? 1024 : 2048; var c = cv(cW, cH); var faces = [{ up: upF }, { up: upB }];
    var tex = canvasTex(c, {}); onFonts(function () { totemDraw(c, faces); tex.needsUpdate = true; });
    var fm = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3, roughness: 0.35, metalness: 0.1 }); MT.totemFace = fm;
    var fh = Ht - 0.42, fwid = Wd - 0.26;
    for (var f = 0; f < 2; f++) { var pg = new THREE.PlaneGeometry(fwid, fh); var uv = pg.attributes.uv; for (var k = 0; k < uv.count; k++) uv.setX(k, f * 0.5 + uv.getX(k) * 0.5); var pm = new THREE.Mesh(pg, fm); pm.position.set(0, 0.52 + Ht / 2, f ? -(Dp / 2 + 0.006) : Dp / 2 + 0.006); if (f) pm.rotation.y = Math.PI; g.add(pm); }
    var dotM = new THREE.MeshBasicMaterial({ color: 0x4dff7a, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }); var dg = new THREE.CircleGeometry(0.035, 16); var dots = [];
    for (var f2 = 0; f2 < 2; f2++) { var d = new THREE.Mesh(dg, dotM); d.visible = false; d.renderOrder = 4; g.add(d); dots.push(d); }
    grp.add(g); TOT = AR.totem = { g: g, faces: faces, dots: dots, fw: fwid, fh: fh, Ht: Ht, Dp: Dp, x: w[0], z: w[1], y: y };
    wall(w[0], w[1], yaw, Wd + 0.5, Dp + 0.5, y - 0.2, y + 0.52 + Ht);
    hotspots.push({ x: w[0], z: w[1], r: 6, t: "Arrivals Court directory", k: "You are here · the whole site and the walking times", p: "The map turns to face the way you are looking, so ahead on the map is ahead of you. The green dot is you. Every hub is listed with its walking time from here; the Grand Loop shuttle stops at the north kerb of the court." });
  }
  function totemFrame() { var T0 = TOT; if (!T0 || !player) return; var px = player.position.x, pz = player.position.z; var near = Math.hypot(px - T0.x, pz - T0.z) < 45;
    for (var f = 0; f < 2; f++) { var d = T0.dots[f]; if (!near) { if (d.visible) d.visible = false; continue; } var q = faceUV(T0.faces[f], px, pz); if (!q) { d.visible = false; continue; } var lx = (q[0] - f * 0.5) / 0.5 - 0.5, ly = 0.5 - q[1]; d.visible = true; var sx = (f ? -1 : 1) * lx * T0.fw; d.position.set(sx, 0.52 + T0.Ht / 2 + ly * T0.fh, f ? -(T0.Dp / 2 + 0.012) : T0.Dp / 2 + 0.012); d.rotation.y = f ? Math.PI : 0; var s = 1 + 0.3 * Math.sin(performance.now() / 260); d.scale.setScalar(s); } }

  // the 3D site model of Genesis One under its sail: the plan in relief, true north, the green pin on Arrivals Court
  var SAILM = null;
  function sailMat() { if (SAILM) return SAILM; SAILM = new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.82, metalness: 0, side: THREE.DoubleSide, emissive: 0xffe2b8, emissiveIntensity: 0 }); return SAILM; }
  function bil(c, s, t) { var a = c[0], b = c[1], cc = c[2], d = c[3]; var x0 = lerp(a[0], b[0], s), z0 = lerp(a[1], b[1], s), y0 = lerp(a[2], b[2], s); var x1 = lerp(d[0], cc[0], s), z1 = lerp(d[1], cc[1], s), y1 = lerp(d[2], cc[2], s); var sag = 0.32 * Math.sin(Math.PI * s) * Math.sin(Math.PI * t); return [lerp(x0, x1, t), lerp(y0, y1, t) - sag, lerp(z0, z1, t)]; }
  function sailGeo(G, corners, n) { for (var a = 0; a < n; a++) for (var b = 0; b < n; b++) { var P0 = bil(corners, a / n, b / n), P1 = bil(corners, (a + 1) / n, b / n), P2 = bil(corners, (a + 1) / n, (b + 1) / n), P3 = bil(corners, a / n, (b + 1) / n); G.quad(P0, P3, P2, P1, [a / n, b / n], [a / n, (b + 1) / n], [(a + 1) / n, (b + 1) / n], [(a + 1) / n, b / n]); } }
  function buildSiteModel(grp) {
    var M = mats(); var p = kp(LAY.model[0], LAY.model[1]), w = k2w(p[0], p[1]); var y = CRT.y(w[0], w[1]);
    var S = 4.4 / 1700; var top = 0.98; var cxw = (SITEBB.x0 + SITEBB.x1) / 2, czw = (SITEBB.z0 + SITEBB.z1) / 2;
    var g = new THREE.Group(); g.position.set(w[0], y, w[1]); g.name = "ar site model"; g.userData.arrivals = true;
    var TW = 4.6, TD = 4.6; var st = new Geo(), br = new Geo(), led = new Geo();
    st.box(0, 0.08, 0, TW + 0.2, 0.16, TD + 0.2, 0, 1.2); st.box(0, 0.16 + (top - 0.22) / 2, 0, TW - 0.3, top - 0.22, TD - 0.3, 0, 1.2);
    br.box(0, top - 0.04, 0, TW + 0.08, 0.1, TD + 0.08, 0, 1); led.box(0, top - 0.105, 0, TW - 0.1, 0.02, TD - 0.1, 0, 1);
    [st.mesh(M.trav, { cast: true }), br.mesh(M.bronze, { cast: true }), led.mesh(M.led, {})].forEach(function (m) { if (m) g.add(m); });
    var cs = lowq() ? 1024 : 2048; var c = cv(cs, cs), tex = canvasTex(c, {});
    onFonts(function () { var x = c.getContext("2d"); drawPlan(x, 0, 0, cs, cs, cxw, czw, cs / 1700, Math.PI, { bg: "#d9c7a4", distA: 0.32, bld: "#5d554a" }); x.strokeStyle = "#2b2622"; x.lineWidth = cs / 200; x.strokeRect(0, 0, cs, cs); tex.needsUpdate = true; });
    // with heading PI up the canvas shows -z (north) at the top: the plate lies with its top edge to the north (true north)
    var plate = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.05 })); plate.rotation.x = -Math.PI / 2; plate.position.y = top + 0.012; plate.receiveShadow = true; g.add(plate);
    var bl = new Geo(true); var P = window.PLAN;
    var colOf = function (b) { if (b.id === "b0002") return 0xffffff; var s = b.stage || "AIRPORT"; var h = (PLAN_STAGE[s] || PLAN_STAGE.AIRPORT)[1]; var n = parseInt(h.replace("#", ""), 16); var r = n >> 16 & 255, gg = n >> 8 & 255, bb = n & 255; return ((Math.round(r * 0.5 + 100) << 16) | (Math.round(gg * 0.5 + 100) << 8) | Math.round(bb * 0.5 + 100)); };
    for (var i = 0; i < P.buildings.length; i++) { var b = P.buildings[i]; if (!b.footprint || b.kind === "jet") continue; var fx = Math.max(0.012, b.footprint[0] * S), fz = Math.max(0.012, b.footprint[1] * S), fh = Math.max(0.01, (b.h || 6) * S * 3); var yaw = 0; try { yaw = planYaw(b) || 0; } catch (e) { yaw = b.rot || 0; }
      var lx = (b.x - cxw) * S, lz = (b.z - czw) * S; if (Math.abs(lx) > 2.2 || Math.abs(lz) > 2.2) continue; bl.setCol(colOf(b)); bl.box(lx, top + 0.012 + fh / 2, lz, fx, fh, fz, yaw, 1); }
    try { var R = P.runway; var ax = (R.ne[0] - cxw) * S, az = (R.ne[1] - czw) * S, bx = (R.sw[0] - cxw) * S, bz = (R.sw[1] - czw) * S; var L = Math.hypot(bx - ax, bz - az); bl.setCol(0x3d4248); bl.box((ax + bx) / 2, top + 0.016, (az + bz) / 2, 46 * S, 0.006, L, Math.atan2(bx - ax, bz - az), 1); } catch (e) {}
    var mb = bl.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }), { cast: false }); if (mb) g.add(mb);
    var hx = (K.c[0] - cxw) * S, hz = (K.c[1] - czw) * S;
    var pin = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0x4dde6f, emissive: 0x4dde6f, emissiveIntensity: 0.9, roughness: 0.3 })); pin.rotation.x = Math.PI; pin.position.set(hx, top + 0.11, hz); g.add(pin);
    var halo = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.11, 32), new THREE.MeshBasicMaterial({ color: 0x4dff7a, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false })); halo.rotation.x = -Math.PI / 2; halo.position.set(hx, top + 0.02, hz); g.add(halo);
    var sail = new Geo(), mast = new Geo(); var corners = [[-3.7, 4.9, -3.2], [3.7, 3.7, -3.2], [3.7, 4.9, 3.2], [-3.7, 3.7, 3.2]];
    for (var k = 0; k < 4; k++) { var q = corners[k]; mast.cyl(q[0] * 1.04, 0, q[2] * 1.04, 0.07, 0.1, q[1] + 0.25, 10); }
    sailGeo(sail, corners.map(function (q) { return [q[0], q[2], q[1]]; }).map(function (q) { return [q[0], q[1], q[2]]; }), 10);
    var sm = sail.mesh(sailMat(), { cast: true, name: "ar model sail" }), mm = mast.mesh(M.bronze, { cast: true }); if (sm) g.add(sm); if (mm) g.add(mm);
    grp.add(g); AR.model = { g: g, halo: halo, x: w[0], z: w[1] };
    for (var k5 = 0; k5 < 4; k5++) { var c5 = corners[k5]; wall(w[0] + c5[0] * 1.04, w[1] + c5[2] * 1.04, 0, 0.3, 0.3, y, y + c5[1]); }
    wall(w[0], w[1], 0, TW + 0.2, TD + 0.2, y - 0.2, y + top);
    hotspots.push({ x: w[0], z: w[1], r: 5.5, t: "The relief model", k: "Genesis in relief · true north", p: "All of Genesis on one table: The Landing north of the runway, The Flight Line on the west side and The Expanse across the runway, the buildings in their stage colours and the Stellar Aviation FBO in white. The green pin is Arrivals Court, where you stand." });
  }

  // the hub signpost: a brass mast with a blade to every hub, each pointing at it, with its distance and walking time
  function buildSignpost(grp) {
    var M = mats(); var p = kp(LAY.post[0], LAY.post[1]), w = k2w(p[0], p[1]); var y = CRT.y(w[0], w[1]); var hs = hubs().filter(function (h) { return h.d > 40; }).slice(0, 12);
    var BW = 512, BH = 80; var c = cv(BW, BH * hs.length * 2), x = c.getContext("2d"), tex = canvasTex(c, {});
    onFonts(function () { for (var i = 0; i < hs.length; i++) for (var s = 0; s < 2; s++) { var Y0 = (i * 2 + s) * BH; x.fillStyle = "#0e1a14"; x.fillRect(0, Y0, BW, BH); x.fillStyle = "#c9a24d"; x.fillRect(0, Y0, BW, 4); x.fillRect(0, Y0 + BH - 4, BW, 4);
        txt(x, hs[i].name.toUpperCase(), s === 0 ? 22 : BW - 22, Y0 + BH * 0.5, 34, FT.d, "#f5f1e6", 400, s === 0 ? "left" : "right", BW * 0.6, 2); txt(x, distTxt(hs[i].d) + " · " + minTxt(hs[i].d), s === 0 ? BW - 30 : 30, Y0 + BH * 0.5, 22, FT.m, "#f4cd5a", 600, s === 0 ? "right" : "left", BW * 0.34); } tex.needsUpdate = true; });
    var bm = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0.2 }); MT.blade = bm;
    var bl = new Geo(), edge = new Geo(); var Lb = 1.75, Hb = 0.27, z0 = 2.35, NB = hs.length * 2;
    for (var i2 = 0; i2 < hs.length; i2++) { var yaw = Math.atan2(hs[i2].x - w[0], hs[i2].z - w[1]); var yy = y + z0 + i2 * (Hb + 0.06);
      var vA0 = 1 - (i2 * 2 + 1) / NB, vA1 = 1 - (i2 * 2) / NB, vB0 = 1 - (i2 * 2 + 2) / NB, vB1 = 1 - (i2 * 2 + 1) / NB;
      var cs2 = Math.cos(yaw), sn2 = Math.sin(yaw); var P = function (along, up2, side) { return [w[0] + sn2 * along + cs2 * side, yy + up2, w[1] + cs2 * along - sn2 * side]; };
      var a0 = 0.12, a1 = 0.12 + Lb, t = 0.022;
      // the +side face reads left to right toward the tip when the blade points to the viewer's right
      bl.quad(P(a0, -Hb / 2, -t), P(a1, -Hb / 2, -t), P(a1, Hb / 2, -t), P(a0, Hb / 2, -t), [0, vA0], [1, vA0], [1, vA1], [0, vA1]);
      bl.quad(P(a1, -Hb / 2, t), P(a0, -Hb / 2, t), P(a0, Hb / 2, t), P(a1, Hb / 2, t), [0, vB0], [1, vB0], [1, vB1], [0, vB1]);
      edge.quad(P(a1, -Hb / 2, t), P(a1, -Hb / 2, -t), P(a1 + 0.16, 0, 0), P(a1 + 0.16, 0, 0)); edge.quad(P(a1, Hb / 2, -t), P(a1, Hb / 2, t), P(a1 + 0.16, 0, 0), P(a1 + 0.16, 0, 0)); edge.box(P(a1 + 0.02, 0, 0)[0], yy, P(a1 + 0.02, 0, 0)[2], 0.04, Hb, 0.05, yaw, 1); }
    var bmesh = bl.mesh(bm, { cast: true, name: "ar signpost blades" }); if (bmesh) grp.add(bmesh);
    var mast = new Geo(); var topY = y + z0 + hs.length * (Hb + 0.06) + 0.45; mast.cyl(w[0], y, w[1], 0.11, 0.14, topY, 16); mast.cyl(w[0], y, w[1], 0.3, 0.34, y + 0.3, 20);
    var ft = new THREE.SphereGeometry(0.17, 16, 12); mast.add(ft, M4(w[0], topY + 0.14, w[1], 0)); ft.dispose();
    var mm = mast.mesh(M.brass, { cast: true }), me = edge.mesh(M.brass, {}); if (mm) grp.add(mm); if (me) grp.add(me); AR.parts.post = { x: w[0], z: w[1] };
    wall(w[0], w[1], 0, 0.62, 0.62, y - 0.1, y + 3);
  }

  // the Club Walk gateway: two travertine and bronze pylons framing the view down the Horizon Line
  function buildPylons(grp) {
    var M = mats(); var trav = new Geo(), br = new Geo(), led = new Geo(), lg = new Geo(); var c = cv(512, 2048), x = c.getContext("2d"), tex = canvasTex(c, {});
    var words = ["THE LANDING", "GENESIS"];
    onFonts(function () { for (var i = 0; i < 2; i++) { var X0 = i * 256; x.fillStyle = "#0b1712"; x.fillRect(X0, 0, 256, 2048); x.save(); x.translate(X0 + 128, 1024); x.rotate(-Math.PI / 2); txt(x, words[i], 0, 0, 150, FT.d, "#f5f1e6", 400, "center", 1880, 22); x.restore(); x.fillStyle = "#c9a24d"; x.fillRect(X0 + 20, 30, 216, 6); x.fillRect(X0 + 20, 2012, 216, 6); } tex.needsUpdate = true; });
    var lm = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25, roughness: 0.4 }); MT.pylon = lm;
    for (var i2 = 0; i2 < 2; i2++) { var q = LAY.pylons[i2], w = kw(q[0], q[1]); var y = CRT.y(w[0], w[1]); var yaw = kYaw(-1, 0);
      var Wd = 2.1, Dp = 1.2, Ht = 8.4; trav.box(w[0], y + 0.25, w[1], Wd + 0.5, 0.5, Dp + 0.5, yaw, 1.2); trav.box(w[0], y + 0.5 + Ht / 2, w[1], Wd, Ht, Dp, yaw, 1.5);
      br.box(w[0], y + 0.5 + Ht + 0.15, w[1], Wd + 0.16, 0.3, Dp + 0.16, yaw, 1);
      var cs2 = Math.cos(yaw), sn2 = Math.sin(yaw); var off = function (lx, lz) { return [w[0] + lx * cs2 + lz * sn2, w[1] - lx * sn2 + lz * cs2]; };
      for (var f = -1; f <= 1; f += 2) { var fp = off(f * (Wd / 2 + 0.01), 0); br.box(fp[0], y + 0.5 + Ht / 2, fp[1], 0.06, Ht - 0.6, Dp * 0.5, yaw, 1); }
      var u0 = i2 * 0.5, u1 = u0 + 0.5; var hw = 0.58, hh = (Ht - 1.4) / 2, cy2 = y + 0.5 + Ht / 2;
      for (var side = 0; side < 2; side++) { var dz = side ? -(Dp / 2 + 0.012) : Dp / 2 + 0.012; var A = off(side ? hw : -hw, dz), B = off(side ? -hw : hw, dz); lg.quad([A[0], cy2 - hh, A[1]], [B[0], cy2 - hh, B[1]], [B[0], cy2 + hh, B[1]], [A[0], cy2 + hh, A[1]], [u0, 0], [u1, 0], [u1, 1], [u0, 1]); }
      led.box(w[0], y + 0.5 + Ht - 0.12, w[1], Wd + 0.02, 0.1, Dp + 0.02, yaw, 1);
      wall(w[0], w[1], yaw, Wd + 0.5, Dp + 0.5, y - 0.2, y + Ht); }
    [trav.mesh(M.trav, { cast: true, name: "ar pylons" }), br.mesh(M.bronze, { cast: true }), led.mesh(M.led, {}), lg.mesh(lm, {})].forEach(function (m) { if (m) grp.add(m); });
  }

  // banners on slender poles round the court rim
  function buildBanners(grp) {
    var M = mats(); var c = cv(1024, 1024), x = c.getContext("2d"), tex = canvasTex(c, {}); var D = 4;
    var draw = function (img) { for (var i = 0; i < D; i++) { var X0 = i * 256; var dark = i % 2 === 0; x.fillStyle = dark ? "#0b1712" : "#f3ead8"; x.fillRect(X0, 0, 256, 1024); x.fillStyle = "#c9a24d"; x.fillRect(X0 + 16, 22, 224, 5); x.fillRect(X0 + 16, 997, 224, 5);
        if (i === 0) { if (img) drawLogo(x, img, X0 + 128, 330, 110); txt(x, "WELCOME", X0 + 128, 620, 64, FT.d, "#f5f1e6", 400, "center", 220, 4); txt(x, "TO GENESIS", X0 + 128, 700, 30, FT.b, "#4DDE6F", 600, "center", 220, 2); }
        if (i === 1) { txt(x, "THE", X0 + 128, 330, 44, FT.d, "#1f6b3a", 400, "center", 220, 6); txt(x, "LANDING", X0 + 128, 420, 72, FT.d, "#0b1712", 400, "center", 220, 2); txt(x, "STAGE ONE", X0 + 128, 520, 30, FT.b, "#1f6b3a", 600, "center", 220, 3); }
        if (i === 2) { if (img) drawLogo(x, img, X0 + 128, 300, 100); txt(x, "SOLPORT", X0 + 128, 560, 66, FT.d, "#f5f1e6", 400, "center", 220, 4); txt(x, "FIELD DGL · 1928", X0 + 128, 640, 26, FT.m, "#f4cd5a", 600, "center", 220); }
        if (i === 3) { txt(x, "ARRIVALS", X0 + 128, 360, 60, FT.d, "#0b1712", 400, "center", 220, 3); txt(x, "COURT", X0 + 128, 440, 60, FT.d, "#1f6b3a", 400, "center", 220, 3); txt(x, "GENESIS", X0 + 128, 540, 26, FT.b, "#0b1712", 600, "center", 220, 3); } } tex.needsUpdate = true; };
    onFonts(function () { draw(LOGO.ok ? LOGO.img : null); }); logo(function (img) { draw(img); });
    var bm = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0, roughness: 0.8 }); MT.banner = bm;
    var poles = new Geo(), ban = new Geo();
    for (var i2 = 0; i2 < LAY.banners.length; i2++) { var q = LAY.banners[i2]; var w = kw(q[0], ON18.garden && inSteps(q[0] * DEG) ? LAY18.steps.rb + 0.9 : q[1]); var y = terr(w[0], w[1]); var th = q[0] * Math.PI / 180; var yaw = kYaw(-Math.sin(th), Math.cos(th)); var H = 7.6;
      poles.cyl(w[0], y - 0.1, w[1], 0.06, 0.085, y + H, 10); poles.cyl(w[0], y - 0.1, w[1], 0.2, 0.24, y + 0.35, 14);
      var cs2 = Math.cos(yaw), sn2 = Math.sin(yaw); var arm = function (lx, yy) { return [w[0] + lx * cs2, yy, w[1] - lx * sn2]; }; poles.rod(arm(0, y + H - 0.25), arm(1.05, y + H - 0.25), 0.03, 6); poles.rod(arm(0, y + H - 3.25), arm(1.05, y + H - 3.25), 0.03, 6);
      var d = i2 % D, u0 = d / D, u1 = (d + 1) / D; var x0 = 0.1, x1 = 1.0, y0 = y + H - 3.2, y1 = y + H - 0.3;
      for (var s = 0; s < 6; s++) { var t0 = s / 6, t1 = (s + 1) / 6; var b0 = 0.05 * Math.sin(t0 * Math.PI), b1 = 0.05 * Math.sin(t1 * Math.PI); var A = [w[0] + lerp(x0, x1, t0) * cs2 + b0 * sn2, 0, w[1] - lerp(x0, x1, t0) * sn2 + b0 * cs2], B = [w[0] + lerp(x0, x1, t1) * cs2 + b1 * sn2, 0, w[1] - lerp(x0, x1, t1) * sn2 + b1 * cs2];
        ban.quad([A[0], y0, A[2]], [B[0], y0, B[2]], [B[0], y1, B[2]], [A[0], y1, A[2]], [lerp(u0, u1, t0), 0], [lerp(u0, u1, t1), 0], [lerp(u0, u1, t1), 1], [lerp(u0, u1, t0), 1]); ban.quad([B[0], y0, B[2]], [A[0], y0, A[2]], [A[0], y1, A[2]], [B[0], y1, B[2]], [lerp(u0, u1, 1 - t1), 0], [lerp(u0, u1, 1 - t0), 0], [lerp(u0, u1, 1 - t0), 1], [lerp(u0, u1, 1 - t1), 1]); }
      wall(w[0], w[1], 0, 0.4, 0.4, y - 0.1, y + 2.5); }
    var pm = poles.mesh(M.bronze, { cast: true, name: "ar banner poles" }), bmm = ban.mesh(bm, { cast: true, name: "ar banners" }); if (pm) grp.add(pm); if (bmm) grp.add(bmm);
  }

  // the Grand Loop stop on the north kerb of the court: a shelter, benches, the route panel and a tall lit roundel
  var WOODM = null;
  function woodMat() { if (WOODM) return WOODM; try { WOODM = new THREE.MeshStandardMaterial({ map: texRep("wood", 1, 1), color: 0xb98e62, roughness: 0.6 }); } catch (e) { WOODM = new THREE.MeshStandardMaterial({ color: 0xa47a52, roughness: 0.6 }); } return WOODM; }
  function buildStop(grp) {
    var M = mats(); var st = null; try { st = SITES.stops.find(function (s) { return /Arriv/i.test(s.hub) && s.line === "GRAND LOOP"; }); } catch (e) {}
    var sx = st ? st.x : kw(LAY.stop, 34.7)[0], sz = st ? st.z : kw(LAY.stop, 34.7)[1]; var kk = w2k(sx, sz); var ang = Math.atan2(kk[1], kk[0]); var rs = Math.hypot(kk[0], kk[1]);
    var c0 = k2w(Math.cos(ang) * (rs - 3.6), Math.sin(ang) * (rs - 3.6)); var y = CRT.y(c0[0], c0[1]); var yaw = kYaw(Math.cos(ang), Math.sin(ang));   // open toward the road
    var g = new THREE.Group(); g.position.set(c0[0], y, c0[1]); g.rotation.y = yaw; g.name = "ar grand loop stop"; g.userData.arrivals = true;
    var fr = new Geo(), roof = new Geo(), glass = new Geo(), wood = new Geo(); var W = 7.2, D = 2.5, H = 3.0;
    for (var s = -1; s <= 1; s += 2) for (var t = -1; t <= 1; t += 2) fr.box(s * (W / 2 - 0.12), H / 2, t * (D / 2 - 0.12), 0.12, H, 0.12, 0, 1);
    roof.box(0, H + 0.08, 0.15, W + 0.6, 0.16, D + 0.9, 0, 1.5); fr.box(0, H - 0.05, 0.15, W + 0.64, 0.08, D + 0.94, 0, 1);
    glass.box(0, 1.45, -D / 2 + 0.12, W - 0.4, 2.4, 0.03, 0, 1);
    wood.box(0, 0.46, -D / 2 + 0.55, W - 1.2, 0.07, 0.48, 0, 1); for (var b = -1; b <= 1; b++) fr.box(b * 2.6, 0.22, -D / 2 + 0.55, 0.08, 0.44, 0.4, 0, 1);
    var glassM = new THREE.MeshStandardMaterial({ color: 0xbfd6dd, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false });
    [fr.mesh(M.bronze, { cast: true }), roof.mesh(M.white, { cast: true }), glass.mesh(glassM, { order: 2 }), wood.mesh(woodMat(), { cast: true })].forEach(function (m) { if (m) g.add(m); });
    var c = cv(1024, 512), x = c.getContext("2d"), tex = canvasTex(c, {});
    onFonts(function () { x.fillStyle = "#0b1712"; x.fillRect(0, 0, 1024, 512); x.fillStyle = "#4DDE6F"; x.fillRect(0, 0, 1024, 12); txt(x, "GRAND LOOP", 512, 72, 84, FT.d, "#f5f1e6", 400, "center", 960, 6); txt(x, "ALL THREE STAGES · ROUND BOTH RUNWAY ENDS · EVERY 15 MIN", 512, 134, 27, FT.m, "#4DDE6F", 600, "center", 980);
      var names = ["Arrivals Court", "Crossing Plaza", "North Gate", "Launch Complex", "Expanse Gate", "Four Corners", "The Commons", "Golf Gate", "Flight Line Gate", "Propeller Plaza"]; x.strokeStyle = "#4DDE6F"; x.lineWidth = 8; x.beginPath(); x.moveTo(70, 270); x.lineTo(954, 270); x.stroke();
      for (var i = 0; i < names.length; i++) { var px = 70 + i * (884 / (names.length - 1)); x.fillStyle = i === 0 ? "#f4cd5a" : "#f5f1e6"; x.beginPath(); x.arc(px, 270, i === 0 ? 16 : 11, 0, TAU); x.fill(); x.save(); x.translate(px - 4, 300); x.rotate(0.62); txt(x, names[i], 0, 0, 23, FT.b, i === 0 ? "#f4cd5a" : "#e9e2d2", 600, "left", 220); x.restore(); }
      txt(x, "YOU ARE HERE", 52, 232, 22, FT.m, "#f4cd5a", 700, "left"); tex.needsUpdate = true; });
    var pm = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3, roughness: 0.4 }); MT.stopPanel = pm;
    var panel = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), pm); panel.position.set(-1.6, 1.75, -D / 2 + 0.15); g.add(panel);
    var back = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), pm); back.position.set(-1.6, 1.75, -D / 2 + 0.09); back.rotation.y = Math.PI; g.add(back);
    var fg = new THREE.PlaneGeometry(4.2, 0.62), uv = fg.attributes.uv; for (var k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), 0.8 + uv.getY(k) * 0.2); var fas = new THREE.Mesh(fg, pm); fas.position.set(0, H + 0.08, D / 2 + 0.61); g.add(fas);
    var py = new Geo(); py.cyl(W / 2 + 1.1, 0, 0.4, 0.1, 0.12, 5.6, 12); var pym = py.mesh(M.bronze, { cast: true }); if (pym) g.add(pym);
    var rc = cv(512, 512), rx = rc.getContext("2d"), rt = canvasTex(rc, {});
    onFonts(function () { rx.clearRect(0, 0, 512, 512); rx.fillStyle = "#4DDE6F"; rx.beginPath(); rx.arc(256, 256, 250, 0, TAU); rx.fill(); rx.fillStyle = "#0b1712"; rx.beginPath(); rx.arc(256, 256, 196, 0, TAU); rx.fill(); rx.fillStyle = "#4DDE6F"; rx.fillRect(0, 214, 512, 84); txt(rx, "GRAND LOOP", 256, 258, 66, FT.d, "#0b1712", 400, "center", 470, 3); txt(rx, "SHUTTLE", 256, 150, 44, FT.d, "#f5f1e6", 400, "center", 300, 6); txt(rx, "ALL 3 STAGES", 256, 360, 34, FT.b, "#f5f1e6", 700, "center", 300, 2); rt.needsUpdate = true; });
    var rm = new THREE.MeshStandardMaterial({ map: rt, emissive: 0xffffff, emissiveMap: rt, emissiveIntensity: 0.4, roughness: 0.4, alphaTest: 0.3, side: THREE.DoubleSide }); MT.roundel = rm;
    var rd = new THREE.Mesh(new THREE.CircleGeometry(0.85, 40), rm); rd.position.set(W / 2 + 1.1, 4.9, 0.4); rd.rotation.y = Math.PI / 2; g.add(rd);
    g.traverse(function (o) { if (o.isMesh) o.receiveShadow = true; }); grp.add(g);
    var cs = Math.cos(yaw), sn = Math.sin(yaw); var L = function (lx, lz) { return [c0[0] + lx * cs + lz * sn, c0[1] - lx * sn + lz * cs]; };
    for (var s2 = -1; s2 <= 1; s2 += 2) for (var t2 = -1; t2 <= 1; t2 += 2) { var q = L(s2 * (W / 2 - 0.12), t2 * (D / 2 - 0.12)); wall(q[0], q[1], yaw, 0.2, 0.2, y, y + H); }
    var gb = L(0, -D / 2 + 0.12); wall(gb[0], gb[1], yaw, W - 0.4, 0.12, y, y + 2.6);
    for (var b2 = -1; b2 <= 1; b2 += 2) { var q2 = L(b2 * 1.5, -D / 2 + 0.55); addSeat(q2[0], q2[1], yaw, 2.9, 0.48, y, y + 0.5); }
    var pq = L(W / 2 + 1.1, 0.4); wall(pq[0], pq[1], 0, 0.3, 0.3, y, y + 3);
    hotspots.push({ x: c0[0], z: c0[1], r: 7, t: "Grand Loop shuttle", k: "Arrivals Court stop · all three stages", p: "The Grand Loop runs round both runway ends to all three stages every 15 minutes: Crossing Plaza, North Gate, the Launch Complex, the Expanse Gate, Four Corners, The Commons and back by the Flight Line. Wait at the kerb and press F beside the shuttle to hop on." });
    AR.parts.stop = { x: c0[0], z: c0[1], yaw: yaw };
  }

  // the night design: bollards on the curb, uplights on the palms, glow pools (all emissive or additive, no lights)
  function glowQuad(G, x, y, z, r, col) { G.setCol(col); G.quad([x - r, y, z + r], [x + r, y, z + r], [x + r, y, z - r], [x - r, y, z - r], [0, 0], [1, 0], [1, 1], [0, 1]); }
  function buildCourtNight(grp) {
    var M = mats(); var bol = new Geo(), cap = new Geo(), pools = new Geo(true), beams = new Geo(true);
    var R = CRT.R - 0.75; var n = Math.round(TAU * R / 7.5);
    for (var i = 0; i < n; i++) { var a = (i + 0.5) / n * TAU; if (inOpening(a)) continue; if (ON18.garden && inSteps(a)) continue; var q = k2w(Math.cos(a) * R, Math.sin(a) * R); if (inHole(q[0], q[1])) continue; var y = CRT.y(q[0], q[1]);
      bol.cyl(q[0], y, q[1], 0.085, 0.1, y + 0.68, 12); cap.cyl(q[0], y + 0.68, q[1], 0.088, 0.088, y + 0.8, 12); bol.cyl(q[0], y + 0.8, q[1], 0.1, 0.1, y + 0.86, 12);
      glowQuad(pools, q[0], y + 0.02, q[1], 1.5, 0xffc98a); }
    for (var j = 0; j < LAY.planters.length; j++) { var w = kw(LAY.planters[j][0], LAY.planters[j][1]); var yy = CRT.y(w[0], w[1]) + 0.55; for (var s = 0; s < 2; s++) { var yaw = s * Math.PI / 2 + 0.3; var cs = Math.cos(yaw), sn = Math.sin(yaw); var hw = 0.9;
        beams.setCol(0xffd2a0); beams.quad([w[0] - cs * hw, yy, w[1] + sn * hw], [w[0] + cs * hw, yy, w[1] - sn * hw], [w[0] + cs * hw, yy + 8, w[1] - sn * hw], [w[0] - cs * hw, yy + 8, w[1] + sn * hw], [0, 0], [1, 0], [1, 1], [0, 1]); }
      glowQuad(pools, w[0], CRT.y(w[0], w[1]) + 0.03, w[1], 5.2, 0xffb873); }
    if (TOT) glowQuad(pools, TOT.x, TOT.y + 0.03, TOT.z, 5, 0x9fe8b4);
    if (AR.model) glowQuad(pools, AR.model.x, CRT.y(AR.model.x, AR.model.z) + 0.03, AR.model.z, 6.5, 0xffd9a0);
    for (var k = 0; k < 2; k++) { var pw = kw(LAY.pylons[k][0], LAY.pylons[k][1]); glowQuad(pools, pw[0], CRT.y(pw[0], pw[1]) + 0.03, pw[1], 6, 0xffc98a); }
    if (AR.parts.stop) glowQuad(pools, AR.parts.stop.x, CRT.y(AR.parts.stop.x, AR.parts.stop.z) + 0.03, AR.parts.stop.z, 6, 0xc8ffd6);
    var m1 = bol.mesh(M.bronze, { name: "ar bollards" }), m2 = cap.mesh(M.led, {}), m3 = pools.mesh(M.glow, { order: 3, recv: false }), m4 = beams.mesh(M.beam, { order: 3, recv: false });
    [m1, m2, m3, m4].forEach(function (m) { if (m) grp.add(m); }); AR.parts.glow = [m3, m4].filter(Boolean);
  }

  // the landside door's forecourt: two planters with fan palms flanking the walk, a brass WELCOME inlay on the walk, lit bollards
  var DLAY = AR.dlay = { planters: [[51.2, -8.0], [51.2, 7.0]], inlay: [49.6, -0.5], bollards: [[48.2, -5.6], [50.6, -5.6], [48.2, 4.6], [50.6, 4.6]] };
  function doorPlace() { var R = rng(311); for (var i = 0; i < DLAY.planters.length; i++) { var q = DLAY.planters[i], w = t2w(q[0], q[1]); if (MODELS.fanpalm2) put("fanpalm2", w[0], w[1], R() * TAU, 1.05); if (MODELS.agave_cluster) put("agave_cluster", w[0] + 0.6, w[1] + 0.4, R() * TAU, 0.5); } }
  function doorCells(fn) { for (var i = 0; i < DLAY.planters.length; i++) { var q = DLAY.planters[i]; for (var dx = -1.5; dx <= 1.5; dx += 0.5) for (var dz = -1.5; dz <= 1.5; dz += 0.5) { if (Math.hypot(dx, dz) > 1.3) continue; var w = t2w(q[0] + dx, q[1] + dz); fn(w[0], w[1]); } } }
  function buildDoorForecourt(grp) {
    var M = mats(); var wallG = new Geo(), cap = new Geo(), soil = new Geo(), bol = new Geo(), led = new Geo(), pools = new Geo(true);
    for (var i = 0; i < DLAY.planters.length; i++) { var q = DLAY.planters[i], w = t2w(q[0], q[1]); var y = DOORY[i]; var R0 = 1.6, Hh = 0.6;
      var cg = new THREE.CylinderGeometry(R0, R0 + 0.03, Hh + 0.25, 36, 1, true); var uv = cg.attributes.uv; for (var k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * TAU * R0 / 1.5, uv.getY(k) * (Hh + 0.25) / 1.5); wallG.add(cg, M4(w[0], y + Hh / 2 - 0.125, w[1], 0)); cg.dispose();
      var ring = new THREE.RingGeometry(R0 - 0.28, R0 + 0.06, 36, 1); ring.rotateX(-Math.PI / 2); cap.add(ring, M4(w[0], y + Hh + 0.005, w[1], 0)); ring.dispose();
      var disc = new THREE.CircleGeometry(R0 - 0.26, 28); disc.rotateX(-Math.PI / 2); soil.add(disc, M4(w[0], y + Hh - 0.1, w[1], 0)); disc.dispose();
      wall(w[0], w[1], 0, 2.9, 2.9, y - 0.2, y + Hh); wall(w[0], w[1], Math.PI / 4, 2.9, 2.9, y - 0.2, y + Hh); glowQuad(pools, w[0], y + 0.03, w[1], 4.2, 0xffb873); }
    for (var j = 0; j < DLAY.bollards.length; j++) { var b = DLAY.bollards[j], wb = t2w(b[0], b[1]); var yb = gy(wb[0], wb[1]); bol.cyl(wb[0], yb, wb[1], 0.085, 0.1, yb + 0.68, 12); led.cyl(wb[0], yb + 0.68, wb[1], 0.088, 0.088, yb + 0.8, 12); bol.cyl(wb[0], yb + 0.8, wb[1], 0.1, 0.1, yb + 0.86, 12); glowQuad(pools, wb[0], yb + 0.02, wb[1], 1.5, 0xffc98a); wall(wb[0], wb[1], 0, 0.24, 0.24, yb, yb + 0.86); }
    [wallG.mesh(M.trav, { cast: true, name: "ar door planters" }), cap.mesh(M.gran, {}), soil.mesh(soilMat(), {}), bol.mesh(M.bronze, {}), led.mesh(M.led, {})].forEach(function (m) { if (m) grp.add(m); });
    var mp = pools.mesh(M.glow, { order: 3, recv: false }); if (mp) { grp.add(mp); AR.parts.glow = (AR.parts.glow || []).concat([mp]); }
    // the brass inlay: WELCOME TO GENESIS ONE, read by everyone walking out of the door (letters up toward the Sun Gate)
    var c = cv(2048, 256), x = c.getContext("2d"), tex = canvasTex(c, {});
    onFonts(function () { x.clearRect(0, 0, 2048, 256); x.strokeStyle = "#d8b25c"; x.lineWidth = 6; x.strokeRect(14, 14, 2020, 228); txt(x, "WELCOME TO GENESIS", 1024, 132, 150, FT.d, "#e2bd66", 400, "center", 1900, 26); tex.needsUpdate = true; });
    var im = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, roughness: 0.28, metalness: 0.85, emissive: 0xffd58a, emissiveMap: tex, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); MT.inlay = im;
    var IG = new Geo(); var lx = DLAY.inlay[0], lz = DLAY.inlay[1], W = 7.6, H = 0.95;
    // the reader faces +lx (toward the Sun Gate): the top of the letters toward +lx, the left of the line toward -lz... facing +x, right is -z
    var P = function (a, b) { var w = t2w(lx + a, lz + b); return [w[0], gy(w[0], w[1]) + 0.012, w[1]]; };
    IG.quad(P(-H / 2, W / 2), P(H / 2, W / 2), P(H / 2, -W / 2), P(-H / 2, -W / 2), [1, 0], [1, 1], [0, 1], [0, 0]);
    var mi = IG.mesh(im, { name: "ar welcome inlay" }); if (mi) grp.add(mi);
  }
  var DOORY = [0, 0];
  // ───────────────────────── Terminal Drive west of the FBO: the boulevard toward the convention center ─────────────────────────
  // The stretch of Terminal Drive inside the Arrivals zone (x -70 to 22) was a bare 14 m road between dirt: now a planted parkway
  // either side (a mulch bed with a granite kerb, agave, yucca and barrel cactus), tall date palms every 12 m both sides, benches on
  // the south side, a fingerpost at the Arrivals Walk crossing toward the convention center, Arrivals Court and Genesis Park, banner
  // poles at both ends, and at night warm pools under the lamps and uplights on the palms. It meets Agent E1's planting at x -70.
  var BLV = AR.blvd = { x0: -70, x1: 22, gap: 8, off: [7.7, 11.6], palmOff: 9.7, step: 12 };
  function roadZ(x) { return -180 + (x + 160) * 5 / 186; }
  function blvdFree(x, z, r) { try { var L = PLACE.lamp || [], P2 = PLACE.paloverde || []; for (var i = 0; i < L.length; i++) if (Math.hypot(L[i][0] - x, L[i][2] - z) < r) return false; for (var j = 0; j < P2.length; j++) if (Math.hypot(P2[j][0] - x, P2[j][2] - z) < r) return false; } catch (e) {} return true; }
  function blvdPalms() { var out = []; for (var x = -66; x <= BLV.x1 - 2; x += BLV.step) { if (Math.abs(x) < BLV.gap + 2) continue; for (var sd = -1; sd <= 1; sd += 2) { var z = roadZ(x) + sd * BLV.palmOff; var xx = x; if (!blvdFree(xx, z, 3.2)) xx += 3.5; if (!blvdFree(xx, z, 3.2)) continue; out.push([xx, z, sd]); } } return out; }
  function blvdPlace() {
    var R = rng(4040); var kinds = ["agave_cluster", "yucca_cluster", "barrel_cactus", "ph_succulent_2"]; var palms = BLV.palms = blvdPalms();
    for (var i = 0; i < palms.length; i++) if (MODELS.datepalm) put("datepalm", palms[i][0], palms[i][1], R() * TAU, 1.2 + R() * 0.15);
    for (var sd = -1; sd <= 1; sd += 2) for (var x = BLV.x0 + 1.5; x <= BLV.x1 - 1; x += 2.7) { if (Math.abs(x) < BLV.gap) continue; var z = roadZ(x) + sd * (BLV.off[0] + 1.0 + R() * 1.6); if (palms.some(function (p) { return Math.hypot(p[0] - x, p[1] - z) < 1.6; })) continue; if (!blvdFree(x, z, 1.4)) continue; var k = kinds[Math.floor(R() * kinds.length)]; if (!MODELS[k]) continue; put(k, x, z, R() * TAU, k === "agave_cluster" ? 0.55 + R() * 0.2 : k === "yucca_cluster" ? 0.7 + R() * 0.2 : 0.85); }
    BLV.benches = []; [-58, -36, -20, 14].forEach(function (x) { var z = roadZ(x) + 13.2; if (!blvdFree(x, z, 2.2)) return; if (MODELS.bench_lux) { put("bench_lux", x, z, Math.PI, 1); BLV.benches.push([x, z, Math.PI]); } });
  }
  function blvdCells(fn) { var C = WALK.C; for (var gx = Math.floor(BLV.x0 / C); gx <= Math.floor(BLV.x1 / C); gx++) { var x = (gx + 0.5) * C; if (Math.abs(x) < BLV.gap) continue; var rz = roadZ(x); for (var sd = -1; sd <= 1; sd += 2) for (var o = BLV.off[0]; o <= BLV.off[1]; o += C) { var z = rz + sd * o; fn(x, z); } } }
  function buildBoulevard(grp) {
    var M = mats(); var bed = new Geo(), kerb = new Geo(), pools = new Geo(true), beams = new Geo(true), poles = new Geo(), ban = new Geo();
    // the beds: a strip per side and per run (west of the crossing, east of it), the kerb on the road side
    var runs = [[BLV.x0, -BLV.gap], [BLV.gap, BLV.x1]];
    for (var r = 0; r < runs.length; r++) for (var sd = -1; sd <= 1; sd += 2) { var xa = runs[r][0], xb = runs[r][1]; var n = Math.ceil((xb - xa) / 2);
      for (var i = 0; i < n; i++) { var x0 = xa + (xb - xa) * i / n, x1 = xa + (xb - xa) * (i + 1) / n; var a0 = roadZ(x0) + sd * BLV.off[0], a1 = roadZ(x1) + sd * BLV.off[0], b0 = roadZ(x0) + sd * BLV.off[1], b1 = roadZ(x1) + sd * BLV.off[1];
        var y = function (x, z) { return terr(x, z) + 0.07; };
        var A = [x0, y(x0, a0), a0], B = [x1, y(x1, a1), a1], Cc = [x1, y(x1, b1), b1], D = [x0, y(x0, b0), b0];
        if (sd > 0) bed.quad(A, D, Cc, B, [x0 / 2, a0 / 2], [x0 / 2, b0 / 2], [x1 / 2, b1 / 2], [x1 / 2, a1 / 2]); else bed.quad(A, B, Cc, D, [x0 / 2, a0 / 2], [x1 / 2, a1 / 2], [x1 / 2, b1 / 2], [x0 / 2, b0 / 2]);
        // the kerb: a 0.22 m granite strip on the road side and a low one at the back
        [[BLV.off[0] - 0.11, 0.22, 0.13], [BLV.off[1] + 0.06, 0.12, 0.09]].forEach(function (k) { var zm0 = roadZ(x0) + sd * k[0], zm1 = roadZ(x1) + sd * k[0]; var xm = (x0 + x1) / 2, zm = (zm0 + zm1) / 2; var yaw = Math.atan2(x1 - x0, zm1 - zm0); kerb.box(xm, terr(xm, zm) + k[2] / 2 - 0.02, zm, k[1], k[2] + 0.04, Math.hypot(x1 - x0, zm1 - zm0) + 0.02, yaw, 1.2); }); } }
    [bed.mesh(soilMat(), { name: "ar blvd beds" }), kerb.mesh(M.gran, { name: "ar blvd kerbs" })].forEach(function (m) { if (m) grp.add(m); });
    // night: pools under the existing lamps and the benches, uplights on the palms
    try { (PLACE.lamp || []).forEach(function (e) { if (e[0] < BLV.x0 - 2 || e[0] > BLV.x1 + 2 || Math.abs(e[2] - roadZ(e[0])) > 16) return; glowQuad(pools, e[0], gy(e[0], e[2]) + 0.03, e[2], 5.5, 0xffd2a0); }); } catch (e) {}
    (BLV.palms || []).forEach(function (p) { var yy = terr(p[0], p[1]) + 0.1; for (var s = 0; s < 2; s++) { var yaw = s * Math.PI / 2 + 0.4; var cs = Math.cos(yaw), sn = Math.sin(yaw), hw = 0.8; beams.setCol(0xffd2a0); beams.quad([p[0] - cs * hw, yy, p[1] + sn * hw], [p[0] + cs * hw, yy, p[1] - sn * hw], [p[0] + cs * hw, yy + 7.5, p[1] - sn * hw], [p[0] - cs * hw, yy + 7.5, p[1] + sn * hw], [0, 0], [1, 0], [1, 1], [0, 1]); } glowQuad(pools, p[0], yy - 0.04, p[1], 2.8, 0xffb873); });
    var m3 = pools.mesh(M.glow, { order: 3, recv: false }), m4 = beams.mesh(M.beam, { order: 3, recv: false }); [m3, m4].forEach(function (m) { if (m) { grp.add(m); AR.parts.glow = (AR.parts.glow || []).concat([m]); } });
    // the bench seats
    (BLV.benches || []).forEach(function (b) { var y = gy(b[0], b[1]); addSeat(b[0], b[1], b[2], 1.75, 0.5, y, y + 0.46); });
    // banner poles at both ends (the court's banner atlas: WELCOME and SOLPORT)
    if (MT.banner) { [[BLV.x0 + 3.5, -1, 2], [BLV.x0 + 3.5, 1, 0], [BLV.x1 - 1, -1, 0], [BLV.x1 - 1, 1, 2]].forEach(function (q) { var x = q[0], z = roadZ(x) + q[1] * 12.4; var y = terr(x, z); var H = 7.6, yaw = q[1] > 0 ? Math.PI : 0; var cs2 = Math.cos(yaw), sn2 = Math.sin(yaw);
        poles.cyl(x, y - 0.1, z, 0.06, 0.085, y + H, 10); poles.cyl(x, y - 0.1, z, 0.2, 0.24, y + 0.35, 14); poles.rod([x, y + H - 0.25, z], [x + 1.05 * cs2, y + H - 0.25, z - 1.05 * sn2], 0.03, 6); poles.rod([x, y + H - 3.25, z], [x + 1.05 * cs2, y + H - 3.25, z - 1.05 * sn2], 0.03, 6);
        var u0 = q[2] / 4, u1 = u0 + 0.25, y0 = y + H - 3.2, y1 = y + H - 0.3; var A = [x + 0.1 * cs2, z - 0.1 * sn2], B = [x + 1.0 * cs2, z - 1.0 * sn2];
        ban.quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], [u0, 0], [u1, 0], [u1, 1], [u0, 1]); ban.quad([B[0], y0, B[1]], [A[0], y0, A[1]], [A[0], y1, A[1]], [B[0], y1, B[1]], [u0, 0], [u1, 0], [u1, 1], [u0, 1]); wall(x, z, 0, 0.4, 0.4, y - 0.1, y + 2.5); });
      [poles.mesh(M.bronze, { cast: true, name: "ar blvd poles" }), ban.mesh(MT.banner, { cast: true, name: "ar blvd banners" })].forEach(function (m) { if (m) grp.add(m); }); }
    // the fingerpost at the Arrivals Walk crossing (south-west corner)
    var fx = -9.6, fz = roadZ(-9.6) + 9.4; var fy = gy(fx, fz); var dests = [["SOLPORT CONVENTION CENTER", -268, -90], ["ARRIVALS COURT", K.c[0], K.c[1]], ["GENESIS PARK · OVERLOOK GATE", 0, -238]];
    var c = cv(512, 80 * 6), x = c.getContext("2d"), tex = canvasTex(c, {});
    onFonts(function () { for (var i = 0; i < 3; i++) { var d = Math.hypot(dests[i][1] - fx, dests[i][2] - fz); for (var s = 0; s < 2; s++) { var Y0 = (i * 2 + s) * 80; x.fillStyle = "#0e1a14"; x.fillRect(0, Y0, 512, 80); x.fillStyle = "#c9a24d"; x.fillRect(0, Y0, 512, 4); x.fillRect(0, Y0 + 76, 512, 4); txt(x, dests[i][0], s === 0 ? 20 : 492, Y0 + 40, 28, FT.d, "#f5f1e6", 400, s === 0 ? "left" : "right", 330, 1); txt(x, distTxt(d) + " · " + minTxt(d), s === 0 ? 492 : 20, Y0 + 40, 21, FT.m, "#f4cd5a", 600, s === 0 ? "right" : "left", 150); } } tex.needsUpdate = true; });
    var bm = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0.2 }); MT.blade2 = bm; var bl = new Geo(), mast = new Geo();
    for (var i2 = 0; i2 < 3; i2++) { var yaw2 = Math.atan2(dests[i2][1] - fx, dests[i2][2] - fz); var yy2 = fy + 2.3 + i2 * 0.34; var cs3 = Math.cos(yaw2), sn3 = Math.sin(yaw2); var P = function (along, up2, side) { return [fx + sn3 * along + cs3 * side, yy2 + up2, fz + cs3 * along - sn3 * side]; }; var a0 = 0.1, a1 = 1.85, t = 0.022, Hb = 0.27, NB = 6;
      var vA0 = 1 - (i2 * 2 + 1) / NB, vA1 = 1 - (i2 * 2) / NB, vB0 = 1 - (i2 * 2 + 2) / NB, vB1 = 1 - (i2 * 2 + 1) / NB;
      bl.quad(P(a0, -Hb / 2, -t), P(a1, -Hb / 2, -t), P(a1, Hb / 2, -t), P(a0, Hb / 2, -t), [0, vA0], [1, vA0], [1, vA1], [0, vA1]); bl.quad(P(a1, -Hb / 2, t), P(a0, -Hb / 2, t), P(a0, Hb / 2, t), P(a1, Hb / 2, t), [0, vB0], [1, vB0], [1, vB1], [0, vB1]); }
    mast.cyl(fx, fy, fz, 0.1, 0.13, fy + 3.6, 14); mast.cyl(fx, fy, fz, 0.28, 0.32, fy + 0.28, 18); var sp = new THREE.SphereGeometry(0.15, 14, 10); mast.add(sp, M4(fx, fy + 3.72, fz, 0)); sp.dispose();
    [bl.mesh(bm, { cast: true, name: "ar blvd fingerpost" }), mast.mesh(M.brass, { cast: true })].forEach(function (m) { if (m) grp.add(m); }); wall(fx, fz, 0, 0.56, 0.56, fy - 0.1, fy + 3);
    hotspots.push({ x: fx, z: fz, r: 6, t: "Terminal Drive", k: "To the Solport Convention Center · Arrivals Court · Genesis Park", p: "The palm boulevard along Terminal Drive runs west from Arrivals Court to the Solport Convention Center, the Market Hall and the festival grounds. The Arrivals Walk crosses here north to the Overlook Gate of Genesis Park." });
  }

  // ───────────────────────── AIRSIDE: the ramp outside the FBO airside doors (terminal frame T) ─────────────────────────
  // The apron in front of the airside facade was bare dirt with pebbles between the FBO, the Gate A2 stand and the visiting
  // stands. Now: a concrete ramp from the colonnade to the A2 lead-in, the airside terrace under the roof overhang (the podium
  // carried out to the roof edge, the lounge on its west half), palms in planters along the facade, two dressed stands (A1
  // west with a mid jet, B1 east with a light jet), the red carpet from the doors to the A2 stand under a canopy, floodlight
  // masts and edge lights. The A2 stand itself (lz 62 to 112 on the axis) stays clear for the arriving jets.
  var APR = AR.apron = { lift: 0.32, x0: -64, x1: 64, z0: 40.6, z1: 102, tz0: 33.9, tz1: 40.6, tx: 44.5, terr: 0.45 };
  APR.y = function (x, z) { return terr(x, z) + APR.lift; };
  APR.ty = function () { return T.y + APR.terr; };
  function inApron(lx, lz) { return lx >= APR.x0 && lx <= APR.x1 && lz >= APR.z0 && lz <= APR.z1; }
  function inTerrace(lx, lz) { return Math.abs(lx) <= APR.tx && lz >= APR.tz0 && lz <= APR.tz1; }
  function apronRaster(fn) { var C = WALK.C; var cs = [t2w(APR.x0, APR.tz0), t2w(APR.x1, APR.tz0), t2w(APR.x1, APR.z1), t2w(APR.x0, APR.z1)]; var xs = cs.map(function (q) { return q[0]; }), zs = cs.map(function (q) { return q[1]; });
    for (var gx = Math.floor(Math.min.apply(null, xs) / C); gx <= Math.floor(Math.max.apply(null, xs) / C); gx++) for (var gz = Math.floor(Math.min.apply(null, zs) / C); gz <= Math.floor(Math.max.apply(null, zs) / C); gz++) { var x = (gx + 0.5) * C, z = (gz + 0.5) * C; var l = w2t(x, z); if (inTerrace(l[0], l[1])) fn(x, z, 1); else if (inApron(l[0], l[1])) fn(x, z, 0); } }
  function apronWalk() { var n = 0; apronRaster(function (x, z, t) { walkPut(x, z, t ? APR.ty() : APR.y(x, z)); n++; }); AR.n.apronCells = n; }
  // planters along the facade (T frame), the stands, the masts
  var ALAY = AR.alay = {
    planters: [[-40, 44], [-28, 44], [-16, 44], [16, 44], [28, 44], [40, 44]],
    stands: [{ id: "A1", kind: "jet_mid", lx: -36, lz: 73, yaw: 0, len: 21, span: 20.9, gear: [8.1, -1.4, 1.9] }, { id: "B1", kind: "jet_light", lx: 36, lz: 73, yaw: Math.PI, len: 16.2, span: 15.6, gear: [6.4, -1.1, 1.6] }],
    masts: [[-62, 100], [62, 100], [-63, 62], [63, 62]],
    a2: { lz: 66 },
  };
  function apronCellsPlanters(fn) { for (var i = 0; i < ALAY.planters.length; i++) { var q = ALAY.planters[i]; for (var dx = -1; dx <= 1; dx += 0.5) for (var dz = -1; dz <= 1; dz += 0.5) { var w = t2w(q[0] + dx, q[1] + dz); fn(w[0], w[1]); } } }
  function apronPlace() {
    var R = rng(2207);
    for (var i = 0; i < ALAY.planters.length; i++) { var q = ALAY.planters[i], w = t2w(q[0], q[1]); if (MODELS.datepalm) put("datepalm", w[0], w[1], R() * TAU, 1.32 + R() * 0.12); if (MODELS.agave_cluster) put("agave_cluster", w[0] + 0.7, w[1] - 0.5, R() * TAU, 0.55); }
    for (var j = 0; j < ALAY.stands.length; j++) { var s = ALAY.stands[j], p = t2w(s.lx, s.lz); if (MODELS[s.kind]) { put(s.kind, p[0], p[1], tYaw(s.yaw), 1); s.e = PLACE[s.kind][PLACE[s.kind].length - 1]; s.e.arrivals = true; } }
    // the second refueller and tug, on our stands (the City's own pair stays at A4 and A5)
    var B1 = ALAY.stands[1], A1 = ALAY.stands[0];
    if (MODELS.stellar_fueler) { var f = jw(B1, -6.6, 3.2); put("stellar_fueler", f[0], f[1], tYaw(B1.yaw + Math.PI / 2 + 0.1), 1); AR.parts.fueler = PLACE.stellar_fueler[PLACE.stellar_fueler.length - 1]; }
    if (MODELS.stellar_tug) { var tg = jw(A1, 0, A1.gear[0] + 5.6); put("stellar_tug", tg[0], tg[1], tYaw(A1.yaw + Math.PI), 1); AR.parts.tug = PLACE.stellar_tug[PLACE.stellar_tug.length - 1]; }
    // keep the scatter off the ramp
    var cc = t2w(0, 70); KEEPOUT.push([cc[0], cc[1], 72]);
  }
  // a stand's local frame: x = the left wing, z = the nose
  function jw(s, jx, jz) { var c = Math.cos(s.yaw), sn = Math.sin(s.yaw); var lx = s.lx + jx * c + jz * sn, lz = s.lz - jx * sn + jz * c; return t2w(lx, lz); }
  function jyaw(s, a) { return tYaw(s.yaw + (a || 0)); }

  // a crisp concrete ramp texture: 2 x 2 slabs of 5 m (one texture = 10 m), sawn joints, tone per slab, aggregate, faint tyre marks
  function concreteTex() { if (TX.conc) return TX.conc; var N = lowq() ? 512 : 1024, c = cv(N, N), x = c.getContext("2d"), R = rng(77); var u = N / 1024;
    // fine aggregate noise on a 256 tile, laid as a pattern (a per-pixel pass over the whole canvas cost 250 ms)
    var nc = cv(256, 256), nx = nc.getContext("2d"), id = nx.createImageData(256, 256), d = id.data; for (var i = 0; i < d.length; i += 4) { var n = 128 + (R() - 0.5) * 44 + (R() < 0.02 ? -34 : 0); d[i] = d[i + 1] = d[i + 2] = n; d[i + 3] = 255; } nx.putImageData(id, 0, 0);
    x.fillStyle = "#b9b4aa"; x.fillRect(0, 0, N, N); x.globalAlpha = 0.22; x.globalCompositeOperation = "overlay"; x.fillStyle = x.createPattern(nc, "repeat"); x.fillRect(0, 0, N, N); x.globalCompositeOperation = "source-over"; x.globalAlpha = 1;
    for (var sx = 0; sx < 2; sx++) for (var sz = 0; sz < 2; sz++) { var t = (R() - 0.5) * 0.08; x.fillStyle = t > 0 ? "rgba(255,250,240," + t + ")" : "rgba(40,36,30," + (-t) + ")"; x.fillRect(sx * N / 2, sz * N / 2, N / 2, N / 2); }
    for (var k = 0; k < 60; k++) { x.fillStyle = "rgba(90,86,80," + (0.03 + R() * 0.05) + ")"; x.beginPath(); x.ellipse(R() * N, R() * N, (10 + R() * 60) * u, (6 + R() * 30) * u, R() * 3, 0, TAU); x.fill(); }
    x.strokeStyle = "rgba(40,38,36,0.07)"; x.lineWidth = 22 * u; for (var m2 = 0; m2 < 3; m2++) { x.beginPath(); var y0 = R() * N; x.moveTo(-10, y0); x.bezierCurveTo(N * 0.3, y0 + (R() - 0.5) * 200, N * 0.6, y0 + (R() - 0.5) * 200, N + 10, y0 + (R() - 0.5) * 100); x.stroke(); }
    x.fillStyle = "#5f5b55"; for (var j = 0; j <= 2; j++) { x.fillRect(j * N / 2 - 1.5 * u, 0, 3 * u, N); x.fillRect(0, j * N / 2 - 1.5 * u, N, 3 * u); }
    TX.conc = canvasTex(c, { rep: true }); return TX.conc; }
  function apronMats() { var M = mats(); if (M.conc) return M;
    M.conc = new THREE.MeshStandardMaterial({ map: concreteTex(), normalMap: tiledTex("/tex/detail_n.jpg"), roughnessMap: tiledTex("/tex/detail_r.jpg"), color: 0xffffff, roughness: 1, normalScale: new THREE.Vector2(0.35, 0.35), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    M.paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    M.gse = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
    M.ledB = new THREE.MeshStandardMaterial({ color: 0x9ac4ff, emissive: 0x3d7dff, emissiveIntensity: 0.4, roughness: 0.4, metalness: 0.3 });
    M.lamp = new THREE.MeshStandardMaterial({ color: 0xfff2d8, emissive: 0xffe3b0, emissiveIntensity: 0.1, roughness: 0.3, metalness: 0.2 });
    return M; }
  // the ramp slab and the terrace: one grid mesh each, uv in metres (10 m concrete texture), conformed to the ground
  function buildApronSlab(grp) {
    var M = apronMats(); var slab = new Geo(), edge = new Geo(), terrG = new Geo(), stepG = new Geo();
    var dx = 2.0, nx = Math.round((APR.x1 - APR.x0) / dx), nz = Math.round((APR.z1 - APR.z0) / dx); var rows = [];
    for (var i = 0; i <= nz; i++) { var row = []; for (var j = 0; j <= nx; j++) { var lx = APR.x0 + j * dx, lz = APR.z0 + i * dx; var w = t2w(lx, lz); var y = APR.y(w[0], w[1]); row.push(slab.v(w[0], y, w[1], 0, 1, 0, w[0] / 10, w[1] / 10)); } rows.push(row); }
    for (var i2 = 0; i2 < nz; i2++) for (var j2 = 0; j2 < nx; j2++) { var a = rows[i2][j2], b = rows[i2][j2 + 1], c = rows[i2 + 1][j2 + 1], d = rows[i2 + 1][j2]; slab.i.push(a, d, c, a, c, b); }
    // the slab's outer edges: a concrete face down into the ground (not along the terrace)
    var side = function (pts) { for (var k = 0; k < pts.length - 1; k++) { var A = t2w(pts[k][0], pts[k][1]), B = t2w(pts[k + 1][0], pts[k + 1][1]); var ya = APR.y(A[0], A[1]), yb = APR.y(B[0], B[1]); edge.quad([B[0], terr(B[0], B[1]) - 0.15, B[1]], [A[0], terr(A[0], A[1]) - 0.15, A[1]], [A[0], ya, A[1]], [B[0], yb, B[1]], [0, 0], [1, 0], [1, 0.05], [0, 0.05]); } };
    var segs = function (a0, a1, f) { var out = []; for (var t = a0; t <= a1 + 0.01; t += 2) out.push(f(t)); return out; };
    side(segs(APR.z0, APR.z1, function (t) { return [APR.x1, t]; })); side(segs(APR.x0, APR.x1, function (t) { return [APR.x1 - (t - APR.x0), APR.z1]; })); side(segs(APR.z0, APR.z1, function (t) { return [APR.x0, APR.z1 - (t - APR.z0)]; }));
    // the terrace: travertine at the podium's height from the glass to the roof edge, a coping and a front face, one wide step
    var ty = APR.ty(); var c0 = t2w(0, (APR.tz0 + APR.tz1) / 2);
    terrG.box(c0[0], ty - 0.25, c0[1], APR.tx * 2, 0.5, APR.tz1 - APR.tz0, T.rot, 1.5);
    var cp = t2w(0, APR.tz1 - 0.2); stepG.box(cp[0], ty + 0.005, cp[1], APR.tx * 2 + 0.1, 0.03, 0.42, T.rot, 1.2);
    var st = t2w(0, APR.tz1 + 0.35); var sy = (ty + APR.y(st[0], st[1])) / 2; stepG.box(st[0], sy - 0.12, st[1], APR.tx * 2 - 0.2, 0.24 + (ty - APR.y(st[0], st[1])) * 0, 0.7, T.rot, 1.2);
    for (var e = -1; e <= 1; e += 2) { var sc = t2w(e * (APR.tx + 0.01), (APR.tz0 + APR.tz1) / 2); stepG.box(sc[0], ty - 0.25, sc[1], 0.06, 0.5, APR.tz1 - APR.tz0, T.rot, 1.2); }
    [slab.mesh(M.conc, { name: "ar apron slab" }), edge.mesh(M.conc, {}), terrG.mesh(M.trav, { name: "ar terrace" }), stepG.mesh(M.gran, { cast: false })].forEach(function (m) { if (m) grp.add(m); });
    AR.n.slabTris = (nx * nz * 2);
  }

  // painted markings (vertex colours, one mesh): lead-in lines, stop bars, safety lines, the walkways, hatching, the edge line
  function strip(G, pts, w, col, lift) { G.setCol(col); for (var k = 0; k < pts.length - 1; k++) { var a = pts[k], b = pts[k + 1]; var dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; var nx = -dz / L * w / 2, nz = dx / L * w / 2; var A = t2w(a[0] - nx, a[1] - nz), B = t2w(b[0] - nx, b[1] - nz), Cc = t2w(b[0] + nx, b[1] + nz), D = t2w(a[0] + nx, a[1] + nz); var y = function (q) { return APR.y(q[0], q[1]) + (lift || 0.006); }; G.quad([A[0], y(A), A[1]], [D[0], y(D), D[1]], [Cc[0], y(Cc), Cc[1]], [B[0], y(B), B[1]], [0, 0], [0, 1], [1, 1], [1, 0]); } }
  function arc(cx, cz, r, a0, a1, n) { var o = []; for (var i = 0; i <= n; i++) { var a = lerp(a0, a1, i / n); o.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } return o; }
  function dashed(G, pts, w, col, on, off) { var acc = 0, draw = true, cur = [pts[0]]; for (var k = 0; k < pts.length - 1; k++) { var a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); var t = 0; while (t < L) { var left = (draw ? on : off) - acc; var step = Math.min(left, L - t); t += step; acc += step; var p = [a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]; if (draw) cur.push(p); if (acc >= (draw ? on : off) - 1e-6) { if (draw && cur.length > 1) strip(G, cur, w, col); draw = !draw; acc = 0; cur = [p]; } } if (draw) cur.push(b); } if (draw && cur.length > 1) strip(G, cur, w, col); }
  var YEL = 0xf2c230, WHT = 0xf3f1ea, RED = 0xc8302a, BLK = 0x1b1c1e, GRN = 0x2f7d4a;
  function buildMarkings(grp) {
    var M = apronMats(); var G = new Geo(true);
    // the A2 lead-in: from the taxilane through the stand centre to the stop bar
    var a2 = w2t(122.7, -13.9), le = w2t(120, 61.5); var dirx = a2[0] - le[0], dirz = a2[1] - le[1], L0 = Math.hypot(dirx, dirz); var ent = [a2[0] - dirx / L0 * 30, a2[1] - dirz / L0 * 30];
    strip(G, [ent, [a2[0], a2[1]], [0, ALAY.a2.lz]], 0.16, YEL); strip(G, [[-3.5, ALAY.a2.lz], [3.5, ALAY.a2.lz]], 0.35, YEL); strip(G, [[-1.2, ALAY.a2.lz + 1.2], [1.2, ALAY.a2.lz + 1.2]], 0.12, YEL);
    // the A2 stand's safety envelope (red with white edges), clear of the jet
    var env = function (cx, cz, hw, hz) { var r = [[cx - hw, cz - hz], [cx + hw, cz - hz], [cx + hw, cz + hz], [cx - hw, cz + hz], [cx - hw, cz - hz]]; strip(G, r, 0.3, RED); };
    env(0, 83.4, 15.5, 18);
    // our two stands: a lead-in from the A2 lead-in, the stand centre line, the nose stop bar, the safety envelope, wingtip clearance
    for (var i = 0; i < ALAY.stands.length; i++) { var s = ALAY.stands[i]; var nose = s.yaw === 0 ? 1 : -1; var stop = s.lz + nose * (s.gear[0]);
      strip(G, [[s.lx, s.lz - nose * 12], [s.lx, stop]], 0.16, YEL); strip(G, [[s.lx - 2.4, stop], [s.lx + 2.4, stop]], 0.3, YEL);
      // A1 stands nose out: its lead-out curves onto the A2 lead-in; B1 is nose in: its lead-in runs straight from the ramp edge
      if (nose > 0) { var ex = s.lz + 14; strip(G, [[s.lx, stop], [s.lx, ex]], 0.16, YEL); strip(G, arc(s.lx + 12, ex, 12, Math.PI, Math.PI / 2, 12), 0.16, YEL); }
      else strip(G, [[s.lx, APR.z1 - 1.6], [s.lx, stop]], 0.16, YEL);
      env(s.lx, s.lz, s.span / 2 + 2.6, s.len / 2 + 3); dashed(G, [[s.lx - s.span / 2 - 2.6, s.lz - s.len / 2 - 3], [s.lx - s.span / 2 - 2.6, s.lz + s.len / 2 + 3]], 0.15, WHT, 1.2, 1.2); dashed(G, [[s.lx + s.span / 2 + 2.6, s.lz - s.len / 2 - 3], [s.lx + s.span / 2 + 2.6, s.lz + s.len / 2 + 3]], 0.15, WHT, 1.2, 1.2); }
    // the passenger walkways: white zebra from the terrace to A1 and B1 (green borders), clear of the A2 envelope
    var zebra = function (x0, z0, x1, z1, w) { var dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz); var n = Math.floor(L / 1.2); for (var k = 0; k < n; k++) { var t0 = k * 1.2 / L, t1 = (k * 1.2 + 0.6) / L; var a = [x0 + dx * t0, z0 + dz * t0], b = [x0 + dx * t1, z0 + dz * t1]; strip(G, [a, b], w, WHT); } var nxv = -dz / L * (w / 2 + 0.15), nzv = dx / L * (w / 2 + 0.15); strip(G, [[x0 + nxv, z0 + nzv], [x1 + nxv, z1 + nzv]], 0.12, GRN); strip(G, [[x0 - nxv, z0 - nzv], [x1 - nxv, z1 - nzv]], 0.12, GRN); };
    zebra(-14, 42.5, -28, 60, 2.6); zebra(14, 42.5, 28, 60, 2.6);
    // no-parking hatch in front of the terrace either side of the carpet, the equipment restraint line along the facade
    for (var sd = -1; sd <= 1; sd += 2) for (var k = 0; k < 22; k++) { var x0 = sd * (5 + k * 1.6); strip(G, [[x0, 41.4], [x0 + sd * 1.2, 45.2]], 0.18, YEL); }
    strip(G, [[-44, 46], [-5, 46]], 0.2, RED); strip(G, [[5, 46], [44, 46]], 0.2, RED);
    // the ramp edge line (double yellow) on the outer edges, open where the A2 lead-in runs out
    var edgeL = function (pts) { strip(G, pts, 0.15, YEL); var o = pts.map(function (q) { return [q[0], q[1]]; }); void o; };
    edgeL([[APR.x0 + 0.6, APR.z0 + 6], [APR.x0 + 0.6, APR.z1 - 0.6], [-22, APR.z1 - 0.6]]); edgeL([[APR.x0 + 0.95, APR.z0 + 6], [APR.x0 + 0.95, APR.z1 - 0.95], [-22, APR.z1 - 0.95]]);
    edgeL([[8, APR.z1 - 0.6], [APR.x1 - 0.6, APR.z1 - 0.6], [APR.x1 - 0.6, APR.z0 + 6]]); edgeL([[8, APR.z1 - 0.95], [APR.x1 - 0.95, APR.z1 - 0.95], [APR.x1 - 0.95, APR.z0 + 6]]);
    var me = G.mesh(M.paint, { name: "ar apron markings" }); if (me) grp.add(me);
    // stand numbers and words (canvas atlas, alpha tested)
    var c = cv(1024, 512), x = c.getContext("2d"), tex = canvasTex(c, {}); var labels = [["A1", YEL], ["A2", YEL], ["B1", YEL], ["STOP", YEL], ["FBO", WHT], ["NO PARKING", YEL], ["PASSENGERS", WHT], ["STELLAR", WHT]];
    onFonts(function () { x.clearRect(0, 0, 1024, 512); for (var i = 0; i < labels.length; i++) { var cx = (i % 2) * 512 + 256, cy = Math.floor(i / 2) * 128 + 64; var col = "#" + labels[i][1].toString(16).padStart(6, "0"); if (i < 3) { x.fillStyle = "#111214"; x.fillRect(cx - 120, cy - 56, 240, 112); x.strokeStyle = col; x.lineWidth = 8; x.strokeRect(cx - 112, cy - 48, 224, 96); } txt(x, labels[i][0], cx, cy + 4, i < 3 ? 86 : 70, FT.d, col, 400, "center", 470, 4); } tex.needsUpdate = true; });
    var lm = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); var LG = new Geo();
    var decal = function (idx, lx, lz, w, h, rot) { var u0 = (idx % 2) * 0.5, v1 = 1 - Math.floor(idx / 2) * 0.25, u1 = u0 + 0.5, v0 = v1 - 0.25; var c2 = Math.cos(rot), s2 = Math.sin(rot); var P = function (a, b) { var l = [lx + a * c2 + b * s2, lz - a * s2 + b * c2]; var q = t2w(l[0], l[1]); return [q[0], APR.y(q[0], q[1]) + 0.012, q[1]]; }; LG.quad(P(-w / 2, h / 2), P(w / 2, h / 2), P(w / 2, -h / 2), P(-w / 2, -h / 2), [u0, v0], [u1, v0], [u1, v1], [u0, v1]); };
    // read from the facade (looking +z): letters upright toward +z
    decal(1, 0, ALAY.a2.lz - 4.5, 4.4, 2.2, 0); decal(3, 0, ALAY.a2.lz - 1.6, 3.2, 0.9, 0);
    decal(0, ALAY.stands[0].lx, 50.5, 4.4, 2.2, 0); decal(2, ALAY.stands[1].lx, 50.5, 4.4, 2.2, 0);
    decal(6, -21, 52, 3.6, 0.9, Math.atan2(14, -17.5)); decal(6, 21, 52, 3.6, 0.9, Math.atan2(-14, -17.5));
    decal(5, -26, 43.3, 4.4, 1.0, Math.PI); decal(5, 26, 43.3, 4.4, 1.0, Math.PI);
    var ml = LG.mesh(lm, { name: "ar apron words" }); if (ml) grp.add(ml);
  }

  // ground support equipment, cones, chocks, the airstair, baggage carts, the GPU, tow bars (vertex colours, one mesh)
  function cone(G, x, y, z, h) { G.setCol(0xff6a1a); G.cyl(x, y, z, 0.035, 0.17 * h, y + 0.72 * h, 12); G.setCol(0xf4f4f0); G.cyl(x, y + 0.36 * h, z, 0.105 * h, 0.12 * h, y + 0.46 * h, 12); G.setCol(0x1e1f22); G.box(x, y + 0.015, z, 0.4 * h, 0.03, 0.4 * h, 0, 1); }
  function chock(G, x, y, z, yaw) { G.setCol(0xf2c230); var g = new THREE.CylinderGeometry(0.14, 0.14, 0.42, 3); g.rotateZ(Math.PI / 2); G.add(g, M4(x, y + 0.08, z, yaw, 1, 0.75, 1)); g.dispose(); }
  function towbar(G, A, B, y) { G.setCol(0xf2c230); G.rod([A[0], y + 0.42, A[1]], [B[0], y + 0.42, B[1]], 0.05, 8); var m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]; G.setCol(0x1e1f22); var yaw = Math.atan2(B[0] - A[0], B[1] - A[1]); var c = Math.cos(yaw), s = Math.sin(yaw); for (var sd = -1; sd <= 1; sd += 2) { var w = new THREE.CylinderGeometry(0.2, 0.2, 0.12, 14); w.rotateZ(Math.PI / 2); G.add(w, M4(m[0] + c * 0.32 * sd, y + 0.2, m[1] - s * 0.32 * sd, yaw)); w.dispose(); } }
  function gpu(G, x, y, z, yaw) { var c = Math.cos(yaw), s = Math.sin(yaw); var L = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; }; G.setCol(0xe9e7e0); G.box(x, y + 0.85, z, 1.2, 1.0, 2.1, yaw, 1); G.setCol(0x2c3a52); var p = L(0.61, 0); G.box(p[0], y + 0.9, p[1], 0.02, 0.6, 1.6, yaw, 1); G.setCol(0x1e1f22); for (var a = -1; a <= 1; a += 2) for (var b = -1; b <= 1; b += 2) { var q = L(a * 0.55, b * 0.7); var w = new THREE.CylinderGeometry(0.22, 0.22, 0.16, 14); w.rotateZ(Math.PI / 2); G.add(w, M4(q[0], y + 0.22, q[1], yaw)); w.dispose(); } G.setCol(0xf2c230); var h = L(0, 1.25); G.box(h[0], y + 0.35, h[1], 0.08, 0.08, 0.6, yaw, 1); G.setCol(0x111111); var e = L(0.3, -1.06); G.box(e[0], y + 1.2, e[1], 0.3, 0.3, 0.05, yaw, 1); }
  function airstair(G, x, y, z, yaw, H) { var c = Math.cos(yaw), s = Math.sin(yaw); var L = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; }; G.setCol(0xeeeeea); G.box(x, y + 0.5, z, 1.7, 0.45, 4.6, yaw, 1); G.setCol(0x1e1f22); for (var a = -1; a <= 1; a += 2) for (var b = -1; b <= 1; b += 2) { var q = L(a * 0.8, b * 1.6); var w = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 14); w.rotateZ(Math.PI / 2); G.add(w, M4(q[0], y + 0.3, q[1], yaw)); w.dispose(); }
    var n = 9; for (var i = 0; i < n; i++) { var t = i / (n - 1); var q2 = L(0, -1.9 + t * 3.4); G.setCol(0x9aa0a6); G.box(q2[0], y + 0.85 + t * (H - 0.85), q2[1], 1.0, 0.05, 0.36, yaw, 1); }
    G.setCol(0xd8d8d2); for (var sd = -1; sd <= 1; sd += 2) { var a0 = L(sd * 0.55, -1.9), a1 = L(sd * 0.55, 1.5); G.rod([a0[0], y + 1.75, a0[1]], [a1[0], y + H + 0.9, a1[1]], 0.03, 6); G.rod([a0[0], y + 0.85, a0[1]], [a0[0], y + 1.75, a0[1]], 0.025, 6); G.rod([a1[0], y + H, a1[1]], [a1[0], y + H + 0.9, a1[1]], 0.025, 6); var a2 = L(sd * 0.55, -1.9), a3 = L(sd * 0.55, 1.5); G.rod([a2[0], y + 0.85, a2[1]], [a3[0], y + H, a3[1]], 0.04, 6); }
    var top = L(0, 1.75); G.setCol(0x9aa0a6); G.box(top[0], y + H, top[1], 1.1, 0.06, 0.7, yaw, 1); }
  function bagCart(G, x, y, z, yaw, load) { var c = Math.cos(yaw), s = Math.sin(yaw); var L = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; }; G.setCol(0x3a3f45); G.box(x, y + 0.48, z, 1.5, 0.08, 2.6, yaw, 1); for (var a = -1; a <= 1; a += 2) for (var b = -1; b <= 1; b += 2) { var q = L(a * 0.7, b * 1.2); G.rod([q[0], y + 0.5, q[1]], [q[0], y + 1.95, q[1]], 0.03, 6); var w = new THREE.CylinderGeometry(0.18, 0.18, 0.12, 12); w.rotateZ(Math.PI / 2); G.setCol(0x1e1f22); G.add(w, M4(q[0], y + 0.18, q[1], yaw)); w.dispose(); G.setCol(0x3a3f45); }
    G.setCol(0x2d5a8c); G.box(x, y + 1.98, z, 1.56, 0.05, 2.66, yaw, 1); var hb = L(0, 1.55); G.setCol(0xf2c230); G.box(hb[0], y + 0.4, hb[1], 0.08, 0.08, 0.7, yaw, 1);
    if (load) { var R = rng(Math.round(x * 13 + z)); var cols = [0x2b2b2b, 0x6b3a26, 0x1f3f6b, 0x8a1f2a, 0x4a5a3a, 0xb8a27a]; for (var k = 0; k < 7; k++) { var q2 = L((R() - 0.5) * 0.9, (R() - 0.5) * 2.0); G.setCol(cols[k % cols.length]); G.box(q2[0], y + 0.52 + 0.2 + (k % 2) * 0.42, q2[1], 0.5 + R() * 0.25, 0.36, 0.7 + R() * 0.2, yaw + (R() - 0.5) * 0.4, 1); } } }
  function buildGSE(grp) {
    var M = apronMats(); var G = new Geo(true); var y0 = function (w) { return APR.y(w[0], w[1]); };
    for (var i = 0; i < ALAY.stands.length; i++) { var s = ALAY.stands[i];
      // chocks at the nose gear and both mains, cones at the wingtips, the nose and the tail
      var ng = jw(s, 0, s.gear[0]); chock(G, ng[0], y0(ng), ng[1] + 0, jyaw(s, Math.PI / 2));
      for (var sd = -1; sd <= 1; sd += 2) { var mg = jw(s, sd * s.gear[2], s.gear[1]); var a = jw(s, sd * s.gear[2], s.gear[1] + 0.55), b = jw(s, sd * s.gear[2], s.gear[1] - 0.55); chock(G, a[0], y0(a), a[1], jyaw(s, Math.PI / 2)); chock(G, b[0], y0(b), b[1], jyaw(s, Math.PI / 2)); void mg;
        var wt = jw(s, sd * (s.span / 2 + 0.9), -2.6); cone(G, wt[0], y0(wt), wt[1], 1.0); var wt2 = jw(s, sd * (s.span / 2 + 0.9), -1.2); cone(G, wt2[0], y0(wt2), wt2[1], 1.0); }
      var nc = jw(s, 0, s.len / 2 + 1.4); cone(G, nc[0], y0(nc), nc[1], 1.0); var tc = jw(s, 0, -s.len / 2 - 1.2); cone(G, tc[0], y0(tc), tc[1], 1.0);
      // wing walkers' cones: tall ones each side of the stand mouth
      for (var sd2 = -1; sd2 <= 1; sd2 += 2) { var ww = jw(s, sd2 * (s.span / 2 + 3.6), s.len / 2 + 4); cone(G, ww[0], y0(ww), ww[1], 1.45); } }
    var A1 = ALAY.stands[0], B1 = ALAY.stands[1];
    // A1: the tug on its tow bar at the nose, the GPU on the right of the nose with its cable, the airstair at the cabin door (left side)
    var tg = jw(A1, 0, A1.gear[0] + 5.6 - 2.1), ngA = jw(A1, 0, A1.gear[0] + 0.35); towbar(G, tg, ngA, y0(ngA));
    var gp = jw(A1, -3.6, A1.gear[0] - 1.5); gpu(G, gp[0], y0(gp), gp[1], jyaw(A1, 0.2)); G.setCol(0x111111); var cab0 = jw(A1, -3.0, A1.gear[0] - 0.4), cab1 = jw(A1, -0.9, A1.gear[0] - 1.1); G.rod([cab0[0], y0(cab0) + 0.6, cab0[1]], [cab1[0], y0(cab1) + 1.2, cab1[1]], 0.035, 6);
    var as = jw(A1, 3.0, 4.6); airstair(G, as[0], y0(as), as[1], jyaw(A1, -Math.PI / 2), 2.3);
    // B1: the baggage train behind the wing (three carts), a GPU at the nose
    for (var k = 0; k < 3; k++) { var bc = jw(B1, 6.2 + 0, -6.5 - k * 3.1); bagCart(G, bc[0], y0(bc), bc[1], jyaw(B1, 0), k < 2); }
    var gp2 = jw(B1, 3.2, B1.gear[0] - 0.9); gpu(G, gp2[0], y0(gp2), gp2[1], jyaw(B1, -0.25));
    // A2: the stand is kept clear; its wing walkers' cones wait at the stand mouth
    for (var sd3 = -1; sd3 <= 1; sd3 += 2) { var q = t2w(sd3 * 13.5, 72); cone(G, q[0], y0(q), q[1], 1.45); }
    var me = G.mesh(M.gse, { cast: true, name: "ar gse" }); if (me) grp.add(me);
    // solids: the GPUs, the airstair, the baggage carts
    var sol = function (w, yaw, wd, dp, h) { wall(w[0], w[1], yaw, wd, dp, y0(w) - 0.1, y0(w) + h); };
    sol(gp, jyaw(A1, 0.2), 1.3, 2.4, 1.4); sol(gp2, jyaw(B1, -0.25), 1.3, 2.4, 1.4); sol(as, jyaw(A1, -Math.PI / 2), 1.8, 4.8, 1.0);
    for (var k2 = 0; k2 < 3; k2++) { var bc2 = jw(B1, 6.2, -6.5 - k2 * 3.1); sol(bc2, jyaw(B1, 0), 1.6, 2.7, 2.0); }
  }

  // the red carpet from the airside doors to the A2 stand: brass stanchions with red ropes, a canopy either side of the porte-cochere
  function carpetTex() { if (TX.carpet) return TX.carpet; var W = 256, H = 1024, c = cv(W, H), x = c.getContext("2d"), R = rng(9);
    x.fillStyle = "#8e1b22"; x.fillRect(0, 0, W, H); var nc = cv(64, 64), nx = nc.getContext("2d"), id = nx.createImageData(64, 64), d = id.data; for (var i = 0; i < d.length; i += 4) { var n = 128 + (R() - 0.5) * 60; d[i] = d[i + 1] = d[i + 2] = n; d[i + 3] = 255; } nx.putImageData(id, 0, 0); x.globalAlpha = 0.18; x.globalCompositeOperation = "overlay"; x.fillStyle = x.createPattern(nc, "repeat"); x.fillRect(0, 0, W, H); x.globalCompositeOperation = "source-over"; x.globalAlpha = 1;
    x.fillStyle = "#c9a24d"; x.fillRect(10, 0, 8, H); x.fillRect(W - 18, 0, 8, H); x.fillStyle = "#6a1218"; x.fillRect(0, 0, 10, H); x.fillRect(W - 10, 0, 10, H);
    TX.carpet = canvasTex(c, { rep: true }); return TX.carpet; }
  function buildCarpet(grp) {
    var M = apronMats(); var cm = new THREE.MeshStandardMaterial({ map: carpetTex(), roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    var G = new Geo(), posts = new Geo(), rope = new Geo(true); var hw = 1.25, z0 = 34.1, z1 = ALAY.a2.lz - 2.4;
    var hAt = function (lz, w) { if (lz <= APR.tz1) return APR.ty() + 0.012; if (lz < APR.tz1 + 0.75) return lerp(APR.ty(), APR.y(w[0], w[1]), (lz - APR.tz1) / 0.75) + 0.012; return APR.y(w[0], w[1]) + 0.014; };
    var prev = null; for (var lz = z0; lz <= z1 + 0.01; lz += (lz >= APR.tz1 - 0.01 && lz < APR.tz1 + 0.8) ? 0.25 : 1.0) { var L0 = t2w(-hw, lz), R0 = t2w(hw, lz); var a = [L0[0], hAt(lz, L0), L0[1]], b = [R0[0], hAt(lz, R0), R0[1]]; if (prev) G.quad(prev[0], a, b, prev[1], [0, prev[2] / 4], [0, lz / 4], [1, lz / 4], [1, prev[2] / 4]); prev = [a, b, lz]; }
    var meC = G.mesh(cm, { name: "ar red carpet" }); if (meC) grp.add(meC);
    // stanchions every 2.5 m on the slab part, ropes sagging between
    var pts = []; for (var lz2 = 42.2; lz2 <= z1 - 0.5; lz2 += 2.5) { if (lz2 > 47.6 && lz2 < 59.2) continue; pts.push(lz2); }
    for (var sd = -1; sd <= 1; sd += 2) { var lastP = null; for (var k = 0; k < pts.length; k++) { var w = t2w(sd * (hw + 0.35), pts[k]); var y = APR.y(w[0], w[1]); posts.cyl(w[0], y, w[1], 0.03, 0.03, y + 0.92, 10); posts.cyl(w[0], y, w[1], 0.15, 0.17, y + 0.04, 16); var sp = new THREE.SphereGeometry(0.055, 10, 8); posts.add(sp, M4(w[0], y + 0.95, w[1], 0)); sp.dispose();
        if (lastP && pts[k] - lastP.lz < 2.6) { rope.setCol(0xa3141c); var n = 6; for (var i2 = 0; i2 < n; i2++) { var t0 = i2 / n, t1 = (i2 + 1) / n; var A = [lerp(lastP.w[0], w[0], t0), lerp(lastP.y, y, t0) + 0.86 - 0.22 * Math.sin(Math.PI * t0), lerp(lastP.w[1], w[1], t0)], B = [lerp(lastP.w[0], w[0], t1), lerp(lastP.y, y, t1) + 0.86 - 0.22 * Math.sin(Math.PI * t1), lerp(lastP.w[1], w[1], t1)]; rope.rod(A, B, 0.022, 6); } }
        lastP = { w: w, y: y, lz: pts[k] }; } }
    var mp = posts.mesh(M.brass, { cast: true, name: "ar stanchions" }), mr = rope.mesh(M.gse, {}); if (mp) grp.add(mp); if (mr) grp.add(mr);
    // the canopies: white steel arches and a membrane from the roof edge to the porte-cochere, and on toward the stand
    var arcG = new Geo(), mem = new Geo(); var spans = [[40.9, 48.4], [59.4, z1 + 0.6]]; var CW = 3.6, CH = 4.4;
    for (var si = 0; si < spans.length; si++) { var za = spans[si][0], zb = spans[si][1]; var nA = Math.max(2, Math.round((zb - za) / 3.2) + 1);
      for (var k3 = 0; k3 < nA; k3++) { var lzA = lerp(za, zb, k3 / (nA - 1)); var wl = t2w(-CW, lzA), wr = t2w(CW, lzA); var yl = APR.y(wl[0], wl[1]), yr = APR.y(wr[0], wr[1]); arcG.cyl(wl[0], yl, wl[1], 0.075, 0.09, yl + CH - 0.3, 10); arcG.cyl(wr[0], yr, wr[1], 0.075, 0.09, yr + CH - 0.3, 10);
        var prevA = null; for (var j = 0; j <= 10; j++) { var t = j / 10, ang = Math.PI * t; var lx = -Math.cos(ang) * CW; var w2 = t2w(lx, lzA); var yy = lerp(yl, yr, t) + CH - 0.3 + Math.sin(ang) * 1.1; var P = [w2[0], yy, w2[1]]; if (prevA) arcG.rod(prevA, P, 0.06, 8); prevA = P; } }
      var nm = 12; var nzs = Math.max(2, Math.round((zb - za) / 1.0)); for (var a2 = 0; a2 < nm; a2++) for (var b2 = 0; b2 < nzs; b2++) { var tA = a2 / nm, tB = (a2 + 1) / nm, zA = lerp(za, zb, b2 / nzs), zB = lerp(za, zb, (b2 + 1) / nzs);
        var Pp = function (t, lz) { var ang = Math.PI * t; var lx = -Math.cos(ang) * CW; var w3 = t2w(lx, lz); var yb = APR.y(t2w(-CW, lz)[0], t2w(-CW, lz)[1]); var sag = 0.12 * Math.sin(Math.PI * ((lz - za) / (zb - za)) * (nA - 1)); return [w3[0], yb + CH - 0.3 + Math.sin(ang) * 1.1 + 0.08 - Math.abs(sag) * 0.5, w3[1]]; };
        mem.quad(Pp(tA, zA), Pp(tA, zB), Pp(tB, zB), Pp(tB, zA)); } }
    var ma = arcG.mesh(M.white, { cast: true, name: "ar canopy arches" }), mm = mem.mesh(sailMat(), { cast: true, name: "ar canopy membrane" }); if (ma) grp.add(ma); if (mm) grp.add(mm);
    // the canopy posts as solids
    for (var si2 = 0; si2 < spans.length; si2++) { var nA2 = Math.max(2, Math.round((spans[si2][1] - spans[si2][0]) / 3.2) + 1); for (var k4 = 0; k4 < nA2; k4++) { var lz4 = lerp(spans[si2][0], spans[si2][1], k4 / (nA2 - 1)); for (var sd4 = -1; sd4 <= 1; sd4 += 2) { var w4 = t2w(sd4 * CW, lz4); wall(w4[0], w4[1], 0, 0.22, 0.22, APR.y(w4[0], w4[1]), APR.y(w4[0], w4[1]) + CH); } } }
    AR.parts.carpet = { z0: z0, z1: z1 };
  }

  // planters along the facade, the airside lounge on the terrace (west), benches (east)
  function buildAirsideDress(grp) {
    var M = apronMats(); var pw = new Geo(), pc = new Geo(), ps = new Geo(), wood = new Geo(), lea = new Geo(true), glass = new Geo(), heat = new Geo();
    for (var i = 0; i < ALAY.planters.length; i++) { var q = ALAY.planters[i], w = t2w(q[0], q[1]); var y = APR.y(w[0], w[1]); pw.box(w[0], y + 0.33, w[1], 2.4, 0.76, 2.4, T.rot, 1.2); pc.box(w[0], y + 0.73, w[1], 2.55, 0.06, 2.55, T.rot, 1.2); ps.box(w[0], y + 0.66, w[1], 2.1, 0.02, 2.1, T.rot, 2); wall(w[0], w[1], T.rot, 2.5, 2.5, y - 0.1, y + 0.76); }
    // the lounge: three groups on the west terrace (a sofa facing the apron, two club chairs, a low table), heaters between
    var ty = APR.ty(); var groups = [-39, -30.5, -22];
    for (var g = 0; g < groups.length; g++) { var gx = groups[g];
      var sofa = function (lx, lz, yaw, n) { var w = t2w(lx, lz); var yw = tYaw(yaw); var W = n * 0.78 + 0.3; wood.box(w[0], ty + 0.1, w[1], W, 0.2, 0.9, yw, 1); lea.setCol(0x8a5634); lea.box(w[0], ty + 0.32, w[1], W - 0.1, 0.24, 0.82, yw, 1); var c = Math.cos(yw), s = Math.sin(yw); var bk = [w[0] - s * 0.36, w[1] - c * 0.36]; lea.box(bk[0], ty + 0.68, bk[1], W - 0.1, 0.5, 0.18, yw, 1); for (var sd = -1; sd <= 1; sd += 2) { var ar = [w[0] + c * sd * (W / 2 - 0.06), w[1] - s * sd * (W / 2 - 0.06)]; wood.box(ar[0], ty + 0.52, ar[1], 0.12, 0.42, 0.86, yw, 1); }
        for (var k = 0; k < n; k++) { var off = (k - (n - 1) / 2) * 0.78; var sp = [w[0] + c * off + s * 0.08, w[1] - s * off + c * 0.08]; addSeat(sp[0], sp[1], yw, 0.7, 0.6, ty, ty + 0.44); } };
      sofa(gx, 35.8, 0, 3); sofa(gx - 2.1, 37.9, Math.PI / 2, 1); sofa(gx + 2.1, 37.9, -Math.PI / 2, 1);
      var tw = t2w(gx, 37.9); wood.box(tw[0], ty + 0.2, tw[1], 1.3, 0.06, 0.8, T.rot, 1); wood.box(tw[0], ty + 0.1, tw[1], 1.1, 0.16, 0.6, T.rot, 1); wall(tw[0], tw[1], T.rot, 1.3, 0.8, ty, ty + 0.26);
      if (g < groups.length - 1) { var hw = t2w(gx + 4.25, 36.2); heat.box(hw[0], ty + 1.1, hw[1], 0.32, 2.2, 0.32, T.rot, 1); heat.box(hw[0], ty + 0.04, hw[1], 0.5, 0.08, 0.5, T.rot, 1); wall(hw[0], hw[1], 0, 0.4, 0.4, ty, ty + 2.3); } }
    // glass balustrade with a bronze rail at the terrace's west front, open at the steps
    for (var b = 0; b < 14; b++) { var lx0 = -44 + b * 2.15; if (lx0 > -32.5 && lx0 < -28.4) continue; var w5 = t2w(lx0 + 1.0, APR.tz1 - 0.12); glass.box(w5[0], ty + 0.52, w5[1], 2.0, 1.0, 0.025, T.rot, 1); pc.box(w5[0], ty + 1.05, w5[1], 2.1, 0.06, 0.08, T.rot, 1); wall(w5[0], w5[1], T.rot, 2.1, 0.12, ty, ty + 1.05); }
    // east terrace: two long teak benches facing the apron and the line crew's gear lockers
    for (var e = 0; e < 2; e++) { var lx2 = 22 + e * 11; var w6 = t2w(lx2, 36.6); wood.box(w6[0], ty + 0.44, w6[1], 3.4, 0.08, 0.5, T.rot, 1); var w7 = t2w(lx2, 36.35); wood.box(w7[0], ty + 0.75, w7[1], 3.4, 0.5, 0.06, T.rot, 1); pc.box(w6[0], ty + 0.22, w6[1], 3.0, 0.44, 0.36, T.rot, 1.2); for (var k2 = -1; k2 <= 1; k2++) { var sp2 = t2w(lx2 + k2 * 1.1, 36.65); addSeat(sp2[0], sp2[1], T.rot, 1.0, 0.5, ty, ty + 0.48); } }
    var heatM = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, emissive: 0xff8a3a, emissiveIntensity: 0.0, roughness: 0.4, metalness: 0.6 }); MT.heat = heatM;
    var glassM = new THREE.MeshStandardMaterial({ color: 0xcfe2e8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.28, depthWrite: false });
    [pw.mesh(M.trav, { cast: true, name: "ar airside planters" }), pc.mesh(M.bronze, {}), ps.mesh(soilMat(), {}), wood.mesh(woodMat(), { cast: true, name: "ar lounge wood" }), lea.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 }), { cast: true }), glass.mesh(glassM, { order: 2 }), heat.mesh(heatM, { cast: true })].forEach(function (m) { if (m) grp.add(m); });
    hotspots.push({ x: t2w(-30, 37)[0], z: t2w(-30, 37)[1], r: 9, t: "The airside lounge", k: "Stellar Aviation FBO · the terrace on the ramp", p: "Shade under the FBO's roof, deep sofas and the heaters for the desert evening, with the whole ramp in front of you: the jets on stands A1 and B1, the arrivals on Gate A2 and the line crew at work. Press E beside a seat to sit." });
  }

  // floodlight masts (emissive heads, a glow and a light pool on the ramp at night), blue edge lights, the security fence
  function buildApronLights(grp) {
    var M = apronMats(); var mast = new Geo(), heads = new Geo(), lamps = new Geo(), pools = new Geo(true), edge = new Geo(), caps = new Geo();
    for (var i = 0; i < ALAY.masts.length; i++) { var q = ALAY.masts[i], w = t2w(q[0], q[1]); var y = APR.y(w[0], w[1]); var H = 21; mast.cyl(w[0], y, w[1], 0.18, 0.34, y + H, 14); mast.cyl(w[0], y, w[1], 0.55, 0.6, y + 0.5, 16);
      var toC = Math.atan2(t2w(0, 70)[0] - w[0], t2w(0, 70)[1] - w[1]); var c = Math.cos(toC), s = Math.sin(toC);
      heads.box(w[0], y + H + 0.3, w[1], 3.6, 0.2, 0.3, toC, 1); for (var k = -1; k <= 1; k += 2) for (var r = 0; r < 2; r++) { var lx = k * (0.6 + r * 1.1); var p = [w[0] + c * lx + s * 0.3, w[1] - s * lx + c * 0.3]; heads.box(p[0], y + H, p[1], 0.9, 0.55, 0.5, toC, 1); var pf = [p[0] + s * 0.26, p[1] + c * 0.26]; lamps.box(pf[0], y + H - 0.02, pf[1], 0.78, 0.44, 0.02, toC, 1); }
      var pc = [w[0] + s * 18, w[1] + c * 18]; glowQuad(pools, pc[0], APR.y(pc[0], pc[1]) + 0.05, pc[1], 24, 0xfff0d8); wall(w[0], w[1], 0, 1.1, 1.1, y - 0.1, y + 3); }
    // blue edge lights round the ramp every 10 m (not on the A2 lead-in)
    var lit = function (lx, lz) { var w = t2w(lx, lz); var y = APR.y(w[0], w[1]); edge.cyl(w[0], y, w[1], 0.04, 0.05, y + 0.3, 8); caps.cyl(w[0], y + 0.3, w[1], 0.08, 0.07, y + 0.44, 10); glowQuad(pools, w[0], y + 0.03, w[1], 1.2, 0x7aa8ff); };
    for (var lz = APR.z0 + 6; lz <= APR.z1 - 1; lz += 10) { lit(APR.x0 + 1.6, lz); lit(APR.x1 - 1.6, lz); }
    for (var lx2 = APR.x0 + 6; lx2 <= APR.x1 - 6; lx2 += 10) { if (lx2 > -24 && lx2 < 10) continue; lit(lx2, APR.z1 - 1.6); }
    var m1 = mast.mesh(M.white, { cast: true, name: "ar masts" }), m2 = heads.mesh(M.dark, { cast: true }), m3 = lamps.mesh(M.lamp, {}), m4 = edge.mesh(M.dark, {}), m5 = caps.mesh(M.ledB, {}), m6 = pools.mesh(M.glow, { order: 3, recv: false });
    [m1, m2, m3, m4, m5, m6].forEach(function (m) { if (m) grp.add(m); }); if (m6) AR.parts.glow = (AR.parts.glow || []).concat([m6]);
    // the glow round each mast head (sprites, one material)
    var sm = new THREE.SpriteMaterial({ map: glowTex(), color: 0xfff1d6, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }); MT.mastGlow = sm;
    for (var i2 = 0; i2 < ALAY.masts.length; i2++) { var q2 = ALAY.masts[i2], w2 = t2w(q2[0], q2[1]); var spr = new THREE.Sprite(sm); spr.position.set(w2[0], APR.y(w2[0], w2[1]) + 21, w2[1]); spr.scale.set(9, 9, 1); grp.add(spr); }
  }
  // a proper windsock at the ramp's east corner: a 6.5 m mast, a lit frame ring, a striped sock that swings with the breeze
  function buildWindsock(grp) {
    var M = apronMats(); var w = t2w(60, 90); var y = APR.y(w[0], w[1]); var H = 6.5; var mast = new Geo(); mast.cyl(w[0], y, w[1], 0.07, 0.1, y + H, 10); mast.cyl(w[0], y, w[1], 0.32, 0.36, y + 0.3, 14);
    var mm = mast.mesh(M.white, { cast: true, name: "ar windsock mast" }); if (mm) grp.add(mm);
    var piv = new THREE.Group(); piv.position.set(w[0], y + H - 0.25, w[1]); grp.add(piv);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.035, 8, 24), M.lamp); ring.rotation.y = Math.PI / 2; ring.position.set(0.2, 0, 0); piv.add(ring);
    var G = new Geo(true); var n = 5; for (var i = 0; i < n; i++) { var r0 = lerp(0.45, 0.17, i / n), r1 = lerp(0.45, 0.17, (i + 1) / n); G.setCol(i % 2 ? 0xf4f4f0 : 0xff6a1a); var g = new THREE.CylinderGeometry(r1, r0, 0.64, 16, 1, true); g.rotateZ(-Math.PI / 2); g.translate(0.2 + 0.32 + i * 0.64, 0, 0); G.add(g, new THREE.Matrix4()); g.dispose(); }
    var sm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }); var sock = G.mesh(sm, { cast: true, name: "ar windsock" }); if (sock) { sock.position.set(0, 0, 0); piv.add(sock); }
    AR.parts.sock = { piv: piv, sock: sock, yaw: 0.6 }; wall(w[0], w[1], 0, 0.7, 0.7, y - 0.1, y + 3);
  }
  function sockFrame(now) { var S = AR.parts.sock; if (!S || !S.piv) return; var t = now / 1000; var want = 0.6 + 0.35 * Math.sin(t * 0.05) + 0.12 * Math.sin(t * 0.37); S.piv.rotation.y = want; if (S.sock) { S.sock.rotation.z = -0.18 - 0.08 * Math.sin(t * 0.9); S.sock.rotation.x = 0.06 * Math.sin(t * 2.3); } }
  // the security fence between the landside and the ramp: from the FBO's north-east end face along the ramp's north side,
  // a pedestrian gate (open) and a vehicle gate (closed), chain-link panels on posts
  function fenceTex() { if (TX.fence) return TX.fence; var c = cv(256, 256), x = c.getContext("2d"); x.clearRect(0, 0, 256, 256); x.strokeStyle = "rgba(170,176,182,1)"; x.lineWidth = 3; for (var i = -256; i < 512; i += 24) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 256, 256); x.stroke(); x.beginPath(); x.moveTo(i + 256, 0); x.lineTo(i, 256); x.stroke(); } TX.fence = canvasTex(c, { rep: true }); return TX.fence; }
  function buildFence(grp) {
    var M = apronMats(); var posts = new Geo(), mesh = new Geo(), sign = new Geo();
    var line = [[46.4, 24], [68, 24], [100, 24], [126, 30]]; var gatesAt = [{ at: 12, w: 1.8, open: true }, { at: 50, w: 6, open: false }]; if (ON18.fix) try { line = fenceClip(line, gatesAt); } catch (e) { note("r18 fence", e); }
    var fm = new THREE.MeshStandardMaterial({ map: fenceTex(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6, color: 0xffffff });
    var acc = 0; for (var k = 0; k < line.length - 1; k++) { var a = line[k], b = line[k + 1]; var L = Math.hypot(b[0] - a[0], b[1] - a[1]); var n = Math.ceil(L / 3);
      for (var i = 0; i < n; i++) { var t0 = i / n, t1 = (i + 1) / n; var p0 = [lerp(a[0], b[0], t0), lerp(a[1], b[1], t0)], p1 = [lerp(a[0], b[0], t1), lerp(a[1], b[1], t1)]; var d0 = acc + L * t0, d1 = acc + L * t1; var gate = gatesAt.find(function (g) { return d1 > g.at - g.w / 2 && d0 < g.at + g.w / 2; });
        var w0 = t2w(p0[0], p0[1]), w1 = t2w(p1[0], p1[1]); var y0 = terr(w0[0], w0[1]), y1 = terr(w1[0], w1[1]);
        posts.cyl(w0[0], y0 - 0.2, w0[1], 0.04, 0.045, y0 + 2.5, 8);
        if (gate && gate.open) continue;
        mesh.quad([w0[0], y0 + 0.05, w0[1]], [w1[0], y1 + 0.05, w1[1]], [w1[0], y1 + 2.4, w1[1]], [w0[0], y0 + 2.4, w0[1]], [d0 / 2.4, 0], [d1 / 2.4, 0], [d1 / 2.4, 1], [d0 / 2.4, 1]);
        posts.rod([w0[0], y0 + 2.42, w0[1]], [w1[0], y1 + 2.42, w1[1]], 0.025, 6); posts.rod([w0[0], y0 + 0.1, w0[1]], [w1[0], y1 + 0.1, w1[1]], 0.02, 6);
        var mid = [(w0[0] + w1[0]) / 2, (w0[1] + w1[1]) / 2]; var yaw = Math.atan2(w1[0] - w0[0], w1[1] - w0[1]) - Math.PI / 2; wall(mid[0], mid[1], yaw + Math.PI / 2, 0.15, Math.hypot(w1[0] - w0[0], w1[1] - w0[1]) + 0.05, Math.min(y0, y1) - 0.2, Math.max(y0, y1) + 2.4); }
      acc += L; }
    // gate frames: heavier posts and a sign on the vehicle gate
    gatesAt.forEach(function (g) { var dd = 0, k2 = 0; for (; k2 < line.length - 1; k2++) { var L2 = Math.hypot(line[k2 + 1][0] - line[k2][0], line[k2 + 1][1] - line[k2][1]); if (dd + L2 >= g.at) break; dd += L2; } var a = line[k2], b = line[k2 + 1]; var L3 = Math.hypot(b[0] - a[0], b[1] - a[1]); for (var sd = -1; sd <= 1; sd += 2) { var t = (g.at - dd + sd * g.w / 2) / L3; var p = [lerp(a[0], b[0], t), lerp(a[1], b[1], t)], w = t2w(p[0], p[1]); var y = terr(w[0], w[1]); posts.cyl(w[0], y - 0.2, w[1], 0.09, 0.1, y + 2.8, 10); } });
    [posts.mesh(M.white, { cast: true, name: "ar fence posts" }), mesh.mesh(fm, { name: "ar fence mesh" })].forEach(function (m) { if (m) grp.add(m); });
  }
  // the porte-cochere's walnut roof was one texture stretched over 19.6 x 11 m: give it a crisp repeat
  function crispPorte() { try { var AX = TERM.air || TERM.exit; var cx = AX[0] + Math.sin(TERM.rot) * 5, cz = AX[1] + Math.cos(TERM.rot) * 5; var n = 0;
      for (var i = 0; i < scene.children.length; i++) { var o = scene.children[i]; if (!o.isGroup || Math.hypot(o.position.x - cx, o.position.z - cz) > 0.2) continue; o.traverse(function (m) { if (!m.isMesh || !m.material || !m.material.map) return; var mt = m.material; var p = m.geometry && m.geometry.parameters; if (!p || !(p.width > 15)) return; var t = mt.map.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(p.width / 2.2, p.depth / 2.2); t.needsUpdate = true; var nm = mt.clone(); nm.map = t; m.material = nm; n++; }); }
      AR.n.porte = n; } catch (e) { note("porte", e); } }

  // the line crew: Stellar line technicians on the ramp (the round 3 rig, idle and walk clips), loaded one at a time when close
  var CREW = AR.crew = [];
  function crewSetup() {
    var A1 = ALAY.stands[0], B1 = ALAY.stands[1]; var add = function (o) { CREW.push(Object.assign({ state: 0, t: 0, pause: 0, yaw: o.yaw0 || 0 }, o)); };
    var p1 = jw(A1, -1.6, A1.gear[0] + 3.2); add({ x: p1[0], z: p1[1], yaw0: jyaw(A1, Math.PI) });
    var p2 = jw(A1, -4.6, A1.gear[0] - 0.4); add({ x: p2[0], z: p2[1], yaw0: jyaw(A1, -Math.PI / 2) });
    var w0 = t2w(16, 43.4), w1 = t2w(27, 58), w2 = jw(B1, 5.0, -2.0); add({ x: w0[0], z: w0[1], path: [w0, w1, w2, w1], speed: 1.05 });
  }
  function rigInfo() { var I = window.PLAN_MODEL_INFO && PLAN_MODEL_INFO.linetech; return I && I.file && I.installed ? I : null; }
  var crewLoading = false;
  function crewFail(p) { crewLoading = false; p.tries = (p.tries || 0) + 1; p.state = p.tries < 4 ? 0 : 3; p.wait = performance.now() + 12000; }
  function loadCrew(p) { var I = rigInfo(); if (!I || crewLoading) return; crewLoading = true; p.state = 1; var q = "?v=" + (window.BUILD || "dev"); var mob = false; try { mob = /models_m/.test(ASSET.models); } catch (e) {}
    try { gltfLoader().load((mob && I.mobile ? I.mobile : I.file) + q, function (gl) { try { var g = gl.scene; g.traverse(function (o) { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } }); g.userData.noCull = true;
          var mixer = new THREE.AnimationMixer(g), R = { g: g, mixer: mixer, clips: {} }, left = 2;
          var fin = function () { if (--left > 0) return; crewLoading = false; if (!R.clips.idle && !R.clips.walk) { p.state = 3; return; } p.R = R; scene.add(g); p.state = 2; try { if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(g); } catch (e) {} };
          ["idle", "walk"].forEach(function (c) { if (!I[c]) { fin(); return; } gltfLoader().load(I[c] + q, function (cg) { var cl = cg.animations && cg.animations[0]; if (cl) { cl.tracks = cl.tracks.filter(function (t) { return !/\.scale$/.test(t.name); }); R.clips[c] = mixer.clipAction(cl); } fin(); }, undefined, function () { fin(); }); });
        } catch (err) { crewFail(p); if (p.state === 3) note("crew rig", err); } }, undefined, function (err) { crewFail(p); if (p.state === 3) note("crew load", err); }); } catch (err) { crewFail(p); }
  }
  function crewFrame(dt) {
    if (!CREW.length) return; var cx = camera.position.x, cz = camera.position.z; var ins = false; try { ins = !!inside; } catch (e) {}
    for (var i = 0; i < CREW.length; i++) { var p = CREW[i]; var d = Math.hypot(p.x - cx, p.z - cz);
      if (p.state === 0 && d < 230) { if (!(p.wait > performance.now())) loadCrew(p); continue; } if (p.state !== 2) continue;
      var g = p.R.g, vis = d < 180 && !ins; if (g.visible !== vis) g.visible = vis; if (!vis) continue;
      var moving = false; if (p.path) { if (p.pause > 0) p.pause -= dt; else { if (p.seg === undefined) { p.seg = 0; p.u = 0; } var A = p.path[p.seg], B = p.path[(p.seg + 1) % p.path.length], L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 0.01; p.u += p.speed * dt / L; if (p.u >= 1) { p.u = 0; p.seg = (p.seg + 1) % p.path.length; p.pause = 3 + Math.random() * 5; } else { p.x = A[0] + (B[0] - A[0]) * p.u; p.z = A[1] + (B[1] - A[1]) * p.u; p.want = Math.atan2(B[0] - A[0], B[1] - A[1]); moving = true; } } }
      var want = moving ? p.want : (p.path ? p.yaw : p.yaw0); if (!moving && !p.path) { var dxp = player.position.x - p.x, dzp = player.position.z - p.z; if (Math.hypot(dxp, dzp) < 6) want = Math.atan2(dxp, dzp); }
      var err = Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw)), tr = (moving ? 4 : 2) * dt; p.yaw += err > tr ? tr : err < -tr ? -tr : err;
      var clip = moving && p.R.clips.walk ? p.R.clips.walk : (p.R.clips.idle || p.R.clips.walk); if (p.act !== clip) { if (p.act) p.act.fadeOut(0.3); clip.reset().fadeIn(0.3).play(); if (moving) clip.timeScale = p.speed / 0.72; p.act = clip; }
      g.position.set(p.x, gy(p.x, p.z), p.z); g.rotation.y = p.yaw; if (d < 70 || (FRAME_N & 1)) p.R.mixer.update(Math.min(dt * (d < 70 ? 1 : 2), 0.1)); }
  }


  // ═════════════════════════ R18 (Agent F2, 6 Oct 2026): Arrivals Court, the hero pass ═════════════════════════
  // FIXES. The deck feathers over the walk ribbons inside the court, so their side skirts no longer stand up as two kerbs side by
  // side, and meets each walk at the walk's own height where it leaves the court (the zigzag step under the Sun Gate and at the
  // landside opening). The court railing (plan_enrich's plaza border) stands on the court's own curb instead of 3 m inside it, is
  // cut round the shade pavilion's platform (it used to cross its corner) and finished with lantern pillars where it is cut. The
  // Club Walk median loses plan_enrich's second, lower kerb beside plan_crossing's. The R15 security fence stops short of the court
  // instead of running across the deck and the pavilion. The old low-poly fan palms in the zone become the HQ date and canary palms.
  // NEW. Twin runnels with bubbler jets on the Sun Gate and Club Walk axes; two water walls framing the arrival from the Sun Gate;
  // the GENESIS ONE letters; the Welcome Steps (a planted terrace of seat walls, specimen canary palms and shade sails on the south
  // rim); the Sun Ring sculpture in a desert garden; festoon lights and banners over the entry; brass wayfinding inlays at the three
  // openings; a night scheme (lit water, letters, LED seat walls, uplit palms; emissive and additive only, no lights); a few
  // roaming visitors (PLAN_ROAM). Water reuses the client's fountain shaders (no new programs).
  // Switches: ?ar18=0 (all of R18), ?arfix=0 (the fixes), ?arwater=0, ?arart=0 (letters, sculpture), ?argarden=0 (terraces,
  // garden and planting), ?arnpc=0.
  var R18 = AR.r18 = { n: {}, t: {}, palms: [], ends: [], cut: 0 };
  var ON18 = { all: QS.get("ar18") !== "0" && ON.court };
  ON18.fix = ON18.all && QS.get("arfix") !== "0"; ON18.water = ON18.all && QS.get("arwater") !== "0"; ON18.art = ON18.all && QS.get("arart") !== "0";
  ON18.garden = ON18.all && QS.get("argarden") !== "0"; ON18.npc = ON18.all && QS.get("arnpc") !== "0"; R18.on = ON18;
  var DEG = Math.PI / 180;
  ["ph_shrub_1", "ph_shrub_2", "ph_shrub_5", "ph_succulent_1", "ph_succulent_3", "ph_boulder_2", "ph_boulder_4", "ph_rock_4", "prickly_pear", "saguaro_young"].forEach(function (k) { var ND = window.PLAN_MODEL_NEEDS; if (ND.indexOf(k) < 0) ND.push(k); });
  // a point s metres out from the court centre along K angle A (radians), l metres to the side (+v turning)
  function ax2w(A, s, l) { var c = Math.cos(A), sn = Math.sin(A); return k2w(c * s - sn * l, sn * s + c * l); }
  function kang(x, z) { var k = w2k(x, z); return Math.atan2(k[1], k[0]); }
  function adiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
  function wdir(A) { var p = ax2w(A, 1, 0); return [p[0] - K.c[0], p[1] - K.c[1]]; }   // the world direction of K angle A
  var LAY18 = AR.lay18 = {
    sunA: 172.46 * DEG, clubA: 0,
    runnel: { lat: 3.4, w: 0.62, sun: [11.7, 28.9], club: [11.7, 31.0], jet: 2.6 },
    wwall: { lat: 8.45, s0: 23.2, s1: 28.6, h: 2.5, t: 0.5, tw: 0.62 },
    letters: { a: 50 * DEG, r: 30.2, H: 1.85, D: 0.42 },
    steps: { a0: 116 * DEG, a1: 157 * DEG, rf: 34.55, rs: 35.1, r2: 37.5, r2b: 37.75, rb: 40.6 },
    garden: { a: 62 * DEG, r: 48, R: 8.2 },
    fest: { s: [22.3, 29.5], lat: [8.45, 7.7], h: 5.0 },
  };
  function inSteps(a) { var S = LAY18.steps; var d = adiff(a, (S.a0 + S.a1) / 2); return Math.abs(d) <= (S.a1 - S.a0) / 2; }
  function stepsY(a) { var S = LAY18.steps; var p = k2w(Math.cos(a) * 34.6, Math.sin(a) * 34.6); return CRT.final ? CRT.y(p[0], p[1]) : CRT.prov(p[0], p[1]); }
  function gardenC() { var G = LAY18.garden; return k2w(Math.cos(G.a) * G.r, Math.sin(G.a) * G.r); }
  function wallPoly(A, s0, s1, l0, l1) { return [ax2w(A, s0, l0), ax2w(A, s1, l0), ax2w(A, s1, l1), ax2w(A, s0, l1)]; }
  // the footprints of the new pieces (keep-outs, the clean-up of strays, the railing cut)
  function polys18() {
    if (R18.polys) return R18.polys; var P = [], W = LAY18.wwall, S = LAY18.steps;
    if (ON18.water) for (var sd = -1; sd <= 1; sd += 2) P.push({ id: "wwall", poly: wallPoly(LAY18.sunA, W.s0 - 0.6, W.s1 + 0.6, sd * (W.lat - W.t / 2 - W.tw - 0.5), sd * (W.lat + W.t / 2 + 0.5)) });
    if (ON18.art) { var L = LAY18.letters; P.push({ id: "letters", poly: [[-8.2, -1.5], [8.2, -1.5], [8.2, 1.4], [-8.2, 1.4]].map(function (q) { var c = Math.cos(L.a), s = Math.sin(L.a); var u = c * L.r - s * q[0] + c * q[1], v = s * L.r + c * q[0] + s * q[1]; return k2w(u, v); }) }); }
    if (ON18.garden) { var arc = []; for (var a = S.a0 - 1 * DEG; a <= S.a1 + 1 * DEG + 1e-6; a += 2 * DEG) arc.push(k2w(Math.cos(a) * (S.rb + 0.8), Math.sin(a) * (S.rb + 0.8))); for (var a2 = S.a1 + 1 * DEG; a2 >= S.a0 - 1 * DEG - 1e-6; a2 -= 2 * DEG) arc.push(k2w(Math.cos(a2) * (S.rf - 0.4), Math.sin(a2) * (S.rf - 0.4))); P.push({ id: "steps", poly: arc });
      var g = gardenC(), gp = []; for (var i = 0; i < 20; i++) { var t = i / 20 * TAU; gp.push([g[0] + Math.cos(t) * (LAY18.garden.R + 0.8), g[1] + Math.sin(t) * (LAY18.garden.R + 0.8)]); } P.push({ id: "garden", poly: gp }); }
    R18.polys = P; return P; }
  function in18(x, z, ids) { var P = polys18(); for (var i = 0; i < P.length; i++) { if (ids && ids.indexOf(P[i].id) < 0) continue; if (planInPoly(P[i].poly, x, z)) return P[i].id; } return null; }

  // ───────── fix: the deck over the walk ribbons and at the openings ─────────
  // The R15 deck stood a hair over "the ribbons' own heights inside the court", read from the walk grid; but those cells hold a
  // ramp that no visible ribbon has (the ribbon meshes inside the court lie at the deck's own level, within 3 cm), so the deck
  // rose up to 0.45 m in bands along the walks: the two "kerbs" side by side and the zigzag step at the openings. Now the deck is
  // the ground plus the walks' lift, kept a hair over the real ribbon triangles where any stands higher, and in its last 7.5 m
  // at each opening it runs to the walk's own height just outside the curb (read from the ribbon triangles there).
  function ribbonTris() { var out = [], v = new THREE.Vector3(), Rr = CRT.R + 4;
    try { scene.traverse(function (o) { if (!o.isMesh || !o.userData || !o.userData.planRibbons || !o.geometry) return; var g = o.geometry, pa = g.attributes.position, ix = g.index ? g.index.array : null; if (!pa) return; o.updateMatrixWorld(); var bs = g.boundingSphere || (g.computeBoundingSphere(), g.boundingSphere); var P = [];
        var get = function (i) { if (P[i]) return P[i]; v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld); return (P[i] = [v.x, v.y, v.z]); }; var n = ix ? ix.length : pa.count;
        for (var t = 0; t < n; t += 3) { var a = ix ? ix[t] : t, b = ix ? ix[t + 1] : t + 1, c = ix ? ix[t + 2] : t + 2; var A = get(a), B = get(b), Cc = get(c);
          var mx = Math.min(A[0], B[0], Cc[0]), Mx = Math.max(A[0], B[0], Cc[0]), mz = Math.min(A[2], B[2], Cc[2]), Mz = Math.max(A[2], B[2], Cc[2]); if (Mx < K.c[0] - Rr || mx > K.c[0] + Rr || Mz < K.c[1] - Rr || mz > K.c[1] + Rr) continue;
          if (Math.abs((B[0] - A[0]) * (Cc[2] - A[2]) - (B[2] - A[2]) * (Cc[0] - A[0])) < 1e-6) continue; out.push([A, B, Cc, mx, Mx, mz, Mz]); } }); } catch (e) { note("r18 ribbon tris", e); }
    return out; }
  function triY(T, x, z) { var y = null; for (var i = 0; i < T.length; i++) { var t = T[i]; if (x < t[3] || x > t[4] || z < t[5] || z > t[6]) continue; var A = t[0], B = t[1], Cc = t[2];
      var d = (B[2] - Cc[2]) * (A[0] - Cc[0]) + (Cc[0] - B[0]) * (A[2] - Cc[2]); var l1 = ((B[2] - Cc[2]) * (x - Cc[0]) + (Cc[0] - B[0]) * (z - Cc[2])) / d, l2 = ((Cc[2] - A[2]) * (x - Cc[0]) + (A[0] - Cc[0]) * (z - Cc[2])) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue; var h = l1 * A[1] + l2 * B[1] + l3 * Cc[1]; if (y === null || h > y) y = h; } return y; }
  function deckFix() {
    var T = ribbonTris(); R18.n.ribbonTris = T.length; CRT.ribY = function (x, z) { return triY(T, x, z); };
    for (var oi = 0; oi < CRT.open.length; oi++) { var o = CRT.open[oi]; o.a0 = o.a - o.half - 0.08; o.st = 0.004; o.hs = []; var last = null;
      for (var a = o.a0; a <= o.a + o.half + 0.08 + 1e-9; a += o.st) { var p = k2w(Math.cos(a) * (CRT.R + 0.8), Math.sin(a) * (CRT.R + 0.8)); var w = triY(T, p[0], p[1]); if (w === null && Math.abs(adiff(a, o.a)) < o.half) w = walkGet(p[0], p[1]); o.hs.push(w); if (w !== null) last = w; }
      for (var j = 0; j < o.hs.length; j++) if (o.hs[j] === null) { var best = null; for (var dj = 1; dj < o.hs.length && best === null; dj++) { if (j - dj >= 0 && o.hs[j - dj] !== null) best = o.hs[j - dj]; else if (j + dj < o.hs.length && o.hs[j + dj] !== null) best = o.hs[j + dj]; } o.hs[j] = best; }
      o.ok = last !== null; }
    CRT.blend = function (x, z, y) { var r = Math.hypot(x - K.c[0], z - K.c[1]); if (r < CRT.R - 7.6) return y; var th = kang(x, z);
      for (var i2 = 0; i2 < CRT.open.length; i2++) { var o2 = CRT.open[i2]; if (!o2.ok) continue; var d2 = Math.abs(adiff(th, o2.a)); if (d2 > o2.half + 0.075) continue; var m = 1 - sstep(o2.half, o2.half + 0.075, d2);
        var fi = (o2.a0 + adiff(th, o2.a0) - o2.a0) / o2.st; fi = clamp(fi, 0, o2.hs.length - 1); var i0 = Math.floor(fi), i1 = Math.min(o2.hs.length - 1, i0 + 1); var h0 = o2.hs[i0], h1 = o2.hs[i1]; if (h0 === null || h1 === null) continue; var hO = lerp(h0, h1, fi - i0);
        return lerp(y, hO + 0.004, sstep(CRT.R - 7.5, CRT.R - 0.3, r) * m); }
      return y; };
    // where a ribbon stands above the deck (a straight ribbon over a terrain dip), bury it and its side skirts: a hair over the
    // ribbon, falling 1:13 away from its edge
    var C = WALK.C, FR = 4.6, FS = 0.075, nr = Math.ceil(FR / C), Rg = CRT.R + FR + 1; var gx0 = Math.floor((K.c[0] - Rg) / C), gz0 = Math.floor((K.c[1] - Rg) / C), nx = Math.ceil(2 * Rg / C) + 2; var need = new Float32Array(nx * nx).fill(-1e9), seeds = 0;
    for (var jz = 0; jz < nx; jz++) for (var jx = 0; jx < nx; jx++) { var x = (gx0 + jx + 0.5) * C, z = (gz0 + jz + 0.5) * C; if (Math.hypot(x - K.c[0], z - K.c[1]) > CRT.R + 0.6) continue; var h = triY(T, x, z); if (h === null || h < CRT.prov(x, z) + 0.002) continue; seeds++;
      for (var dz = -nr; dz <= nr; dz++) { var kz = jz + dz; if (kz < 0 || kz >= nx) continue; for (var dx = -nr; dx <= nr; dx++) { var kx = jx + dx; if (kx < 0 || kx >= nx) continue; var d = Math.sqrt(dx * dx + dz * dz) * C; if (d > FR) continue; var v = h + 0.006 - FS * Math.max(0, d - 0.35); var k = kz * nx + kx; if (v > need[k]) need[k] = v; } } }
    R18.n.deckSeeds = seeds;
    var needAt = function (x, z) { var jx2 = Math.floor(x / C) - gx0, jz2 = Math.floor(z / C) - gz0; if (jx2 < 0 || jz2 < 0 || jx2 >= nx || jz2 >= nx) return -1e9; return need[jz2 * nx + jx2]; };
    CRT.y = function (x, z) { var y = CRT.prov(x, z); if (!CRT.final) return y; var nv = needAt(x, z); if (nv > y) y = nv; var rb = triY(T, x, z); if (rb !== null && rb + 0.006 > y) y = rb + 0.006; y = CRT.blend(x, z, y); if (rb !== null && y < rb + 0.006) y = rb + 0.006; return y; };
  }

  // ───────── fix: plan_enrich's court border on the court's own curb, cut round the pavilion and the new pieces ─────────
  function growPoly(poly, d) { var cx = 0, cz = 0; poly.forEach(function (q) { cx += q[0]; cz += q[1]; }); cx /= poly.length; cz /= poly.length; return poly.map(function (q) { var dx = q[0] - cx, dz = q[1] - cz, L = Math.hypot(dx, dz) || 1; return [q[0] + dx / L * d * 1.42, q[1] + dz / L * d * 1.42]; }); }
  function railBlocked(x, z) { for (var i = 0; i < CRT.holes.length; i++) if (planInPoly(growPoly(CRT.holes[i], 0.9), x, z)) return "pav"; if (ON18.garden) { var a = kang(x, z); var S = LAY18.steps; if (Math.abs(adiff(a, (S.a0 + S.a1) / 2)) <= (S.a1 - S.a0) / 2 + 1.2 * DEG) return "steps"; } return null; }
  function cutRuns(runs, S, ends) { var n = S.length, out = [];
    runs.forEach(function (r) { var cur = null, prevBad = false; for (var k = 0; k <= r[1]; k++) { var i = r[0] + k, q = S[((i % n) + n) % n]; var bad = railBlocked(q.x, q.z);
        if (bad) { if (cur) { if (cur[1] >= 3) out.push(cur); if (ends) ends.push([S[(((i - 1) % n) + n) % n], bad]); } cur = null; prevBad = true; }
        else { if (!cur) { cur = [i, 0]; if (prevBad && ends) ends.push([q, "start"]); } else cur[1]++; prevBad = false; } }
      if (cur && cur[1] >= 3) out.push(cur); });
    return out; }
  function preEnrich() {
    var E = window.PLAN_ENRICH; if (!E || !E.plazas) return; var rec = E.plazas.find(function (p) { return p.id === "pz_court"; }); if (!rec || rec.r18) return; rec.r18 = true;
    var nr = rec.rails.length, nk = rec.kerbs.length; var ends = [];
    rec.rails = cutRuns(rec.rails, rec.S, ends); rec.kerbs = cutRuns(rec.kerbs, rec.S, null);
    R18.ends = ends.map(function (e) { return { x: e[0].x, z: e[0].z, a: e[0].a, why: e[1] }; }); R18.n.rails = [nr, rec.rails.length, nk, rec.kerbs.length, rec.R];
  }
  // the wrapper round plan_enrich's defer: the court border and anything else it builds inside the court stand on the deck
  // (getH reads PLAN_FLOOR first), and its Club Walk median kerb (a second kerb beside plan_crossing's) is not drawn
  function wrapEnrich() { var hk = HK.defer.find(function (h) { return h && h.name === "enrichDefer"; }); if (!hk || hk.r18) return; hk.r18 = true; var f0 = hk.fn;
    hk.fn = function () { var pf = window.PLAN_FLOOR, pp = window.planPlace, pt = window.planTrim;
      try { preEnrich(); } catch (e) { note("r18 preEnrich", e); }
      try { window.PLAN_FLOOR = function (x, z) { if (Math.hypot(x - K.c[0], z - K.c[1]) <= CRT.R + 0.05 && !inHole(x, z)) return CRT.y(x, z); return pf ? pf(x, z) : null; };
        if (typeof pp === "function") window.planPlace = function (id) { var q = pp(id); if (id === "arrivals_court" && q) return Object.assign({}, q, { r: 4321 }); return q; };
        if (typeof pt === "function") window.planTrim = function (pts, a, b) { if (a === 4322) { R18.n.clubKerb = 1; return [pts[0], pts[0]]; } return pt(pts, a, b); };
      } catch (e) { note("r18 wrap", e); }
      try { return f0.apply(this, arguments); } finally { window.PLAN_FLOOR = pf; if (pp) window.planPlace = pp; if (pt) window.planTrim = pt; } }; }
  if (ON18.fix) try { wrapEnrich(); } catch (e) { note("r18 wrapEnrich", e); }
  // the R15 security fence: stop it 1.6 m short of the court curb and the pavilion's platform
  function fenceClip(line, gates) { var out = [line[0]], acc = 0;
    var bad = function (lx, lz) { var w = t2w(lx, lz); if (Math.hypot(w[0] - K.c[0], w[1] - K.c[1]) < CRT.R + 1.6) return true; for (var i = 0; i < CRT.holes.length; i++) if (planInPoly(growPoly(CRT.holes[i], 1.4), w[0], w[1])) return true; return false; };
    for (var k = 0; k < line.length - 1; k++) { var a = line[k], b = line[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (var s = 0; s <= L; s += 0.25) { if (!bad(lerp(a[0], b[0], s / L), lerp(a[1], b[1], s / L))) continue; var cut = acc + s; if (s > 0.5) out.push([lerp(a[0], b[0], s / L), lerp(a[1], b[1], s / L)]); R18.n.fenceCut = +cut.toFixed(1);
        for (var g = gates.length - 1; g >= 0; g--) { if (gates[g].at + gates[g].w / 2 > cut - 1.5) { gates[g].at = cut - gates[g].w / 2 - 2.5; if (gates[g].at < 16) gates.splice(g, 1); } } return out; }
      out.push(b); acc += L; }
    return out; }
  // the old low-poly fan palms in the zone become the HQ palms (the last world hook, after plan_enrich's late pass; before instancing)
  function palmSwap() {
    var Z = function (e) { return e[0] > -70 && e[0] < 270 && e[2] > -260 && e[2] < 75; }; var n = 0;
    [["fanpalm", "datepalm", 1.22], ["e1_fanpalm", "e1_datepalm", 1.22], ["fanpalm2", "canarypalm", 1.2], ["e1_fanpalm2", "e1_canarypalm", 1.2]].forEach(function (m) {
      var src = PLACE[m[0]]; if (!src || !src.length) return; var dk = m[1]; if (!MODELS[dk] || !MODEL_SPECS[dk]) { dk = dk.replace(/^e1_/, ""); if (!MODELS[dk] || !MODEL_SPECS[dk]) return; }
      var dst = PLACE[dk] || (PLACE[dk] = []);
      for (var i = src.length - 1; i >= 0; i--) { var e = src[i]; if (!Z(e)) continue; src.splice(i, 1); var j = ((e[0] * 7.13 + e[2] * 3.71) % 1 + 1) % 1; e[4] = m[2] + j * 0.16; dst.push(e); n++; R18.palms.push([e[0], e[2], (MODELS[dk].height || 10) * e[4]]); } });
    R18.n.palmSwap = n; }
  // other modules' plants and rocks standing where the new pieces go (before instancing, so they can still be removed)
  function strays18() { var re = /palm|agave|yucca|cactus|cholla|saguaro|ocotillo|prickly|bush|shrub|succulent|rock|boulder|pebble|stones|paloverde|mesquite|ironwood|willow|grass|quiver|creosote/; var n = 0, keep = [];
    for (var k in PLACE) { var L = PLACE[k]; if (!Array.isArray(L) || !L.length) continue; var plant = re.test(k);
      for (var i = L.length - 1; i >= 0; i--) { var e = L[i]; if (!e || e.ar18 || Math.hypot(e[0] - K.c[0], e[2] - K.c[1]) > 70) continue; var id = in18(e[0], e[2]); if (!id) continue; if (plant) { L.splice(i, 1); n++; } else keep.push(k + "@" + e[0].toFixed(1) + "," + e[2].toFixed(1) + ":" + id); } }
    R18.n.strays = n; R18.n.straysKept = keep.slice(0, 12); }

  // ───────── the world phase: keep-outs and walk cells (first hook), the placements (the module's world hook) ─────────
  function stepsCells(fn) { var S = LAY18.steps, C = WALK.C; for (var a = S.a0; a <= S.a1 + 1e-9; a += 0.4 / 38) { var yb = stepsY(a); for (var r = S.rs + 0.05; r < S.rb - 0.1; r += C * 0.8) { var p = k2w(Math.cos(a) * r, Math.sin(a) * r); fn(p[0], p[1], r < S.r2 ? yb + 0.4 : r < S.r2b ? yb + 0.95 : yb + 0.88); } } }
  function gardenCells(fn) { var g = gardenC(), R = LAY18.garden.R, C = WALK.C; for (var x = -R; x <= R; x += C) for (var z = -R; z <= R; z += C) { if (Math.hypot(x, z) > R - 0.15) continue; var X = g[0] + x, Z = g[1] + z; fn(X, Z, terr(X, Z) + 0.06); } }
  function world18Early() {
    if (!ON18.all) return;
    if (ON18.fix) { try { var pz = (window.PLAN.plazas || []).find(function (p) { return p.id === "pz_court"; }); if (pz && !pz.r18) { R18.pzR0 = pz.r; pz.r = CRT.R - 0.05; pz.r18 = true; } } catch (e) { note("r18 plaza r", e); } }
    try { polys18().forEach(function (p) { planKeepout(p.poly); }); } catch (e) { note("r18 keepouts", e); }
    if (ON18.garden) { try { stepsCells(function (x, z, y) { walkPut(x, z, y); }); gardenCells(function (x, z, y) { var w = walkGet(x, z); if (w === null || w < y) walkPut(x, z, y); }); } catch (e) { note("r18 cells", e); } }
  }
  function deferCells18() { if (!ON18.garden) return; try { stepsCells(function (x, z, y) { walkPut(x, z, y); }); } catch (e) { note("r18 cells final", e); } }
  function put18(kind, x, z, rot, sc) { if (!MODELS[kind] || !MODEL_SPECS[kind]) return null; put(kind, x, z, rot, sc); var L = PLACE[kind], e = L[L.length - 1]; e.ar18 = true; e.keep = true; return e; }
  function place18() {
    if (!ON18.all) return; var R = rng(1806);
    if (ON18.garden) {
      var S = LAY18.steps, rm = (S.r2b + S.rb) / 2;
      // tier two: specimen canary palms (a date palm in the middle), yucca, quiver trees and ocotillo between them
      var np = 4; for (var i = 0; i < np; i++) { var a = S.a0 + (S.a1 - S.a0) * (0.03 + 0.94 * i / (np - 1)); var p = k2w(Math.cos(a) * rm, Math.sin(a) * rm); var k = i === 1 || i === 2 ? "canarypalm" : "datepalm"; var e = put18(k, p[0], p[1], R() * TAU, k === "datepalm" ? 1.32 : 1.38 + R() * 0.12); if (e) R18.palms.push([p[0], p[1], (MODELS[k].height || 10) * e[4]]);
        if (i < np - 1) { var a2 = S.a0 + (S.a1 - S.a0) * (0.03 + 0.94 * (i + 0.5) / (np - 1)); var kk = ["yucca_cluster", "ph_quiver_1", "ocotillo"][i]; var q = k2w(Math.cos(a2) * (rm + (R() - 0.5) * 0.8), Math.sin(a2) * (rm + (R() - 0.5) * 0.8)); put18(kk, q[0], q[1], R() * TAU, kk === "ph_quiver_1" ? 0.75 : kk === "ocotillo" ? 0.8 : 0.75); } }
      // tier one: a low, dense xeriscape band behind the seat walls (agave, barrel and golden barrel, flowering shrubs, succulents, prickly pear)
      var lowK = ["agave_cluster", "barrel_cactus", "ph_shrub_1", "ph_succulent_2", "prickly_pear", "barrel_cactus", "ph_shrub_2", "agave_cluster", "ph_succulent_3", "ph_shrub_5"];
      var step = 1.35 / 36.3, ii = 0; for (var a3 = S.a0 + step; a3 < S.a1 - step * 0.5; a3 += step) { for (var row = 0; row < 2; row++) { var rr = S.rs + 0.55 + row * 1.15 + (R() - 0.5) * 0.3; var aa = a3 + (row ? step * 0.5 : 0); if (aa > S.a1 - step * 0.4) continue; var q2 = k2w(Math.cos(aa) * rr, Math.sin(aa) * rr); var k2 = lowK[(ii++ * 7 + row * 3) % lowK.length]; if (!MODELS[k2]) k2 = "agave_cluster";
          put18(k2, q2[0], q2[1], R() * TAU, k2 === "agave_cluster" ? 0.5 + R() * 0.15 : k2 === "barrel_cactus" ? 0.75 + R() * 0.2 : k2 === "prickly_pear" ? 0.5 : k2.indexOf("shrub") >= 0 ? 0.55 + R() * 0.15 : 0.7); } }
      // the desert garden round the Sun Ring: four date palms, boulders, barrels, agave, prickly pear, yucca and a young saguaro
      var g = gardenC(); for (var j = 0; j < 4; j++) { var t = (j + 0.5) / 4 * TAU + 0.3; var pg = [g[0] + Math.cos(t) * 6.2, g[1] + Math.sin(t) * 6.2]; var eg = put18("datepalm", pg[0], pg[1], R() * TAU, 1.18 + R() * 0.2); if (eg) R18.palms.push([pg[0], pg[1], (MODELS.datepalm.height || 10) * eg[4]]); }
      var gk = ["ph_boulder_2", "barrel_cactus", "agave_cluster", "prickly_pear", "ph_boulder_4", "yucca_cluster", "barrel_cactus", "ph_shrub_1", "agave_cluster", "ph_rock_4", "saguaro_young", "ph_succulent_2", "barrel_cactus", "ph_shrub_2"];
      for (var m = 0; m < gk.length; m++) { var t2 = m / gk.length * TAU + R() * 0.25; var rg = 3.6 + (m % 3) * 1.25 + R() * 0.4; var pk = [g[0] + Math.cos(t2) * rg, g[1] + Math.sin(t2) * rg]; var kd = gk[m];
        put18(kd, pk[0], pk[1], R() * TAU, /boulder/.test(kd) ? 0.55 + R() * 0.25 : kd === "ph_rock_4" ? 0.8 : kd === "saguaro_young" ? 0.85 : kd === "agave_cluster" ? 0.6 : kd === "prickly_pear" ? 0.55 : kd.indexOf("shrub") >= 0 ? 0.6 : 0.8); }
    }
    if (ON18.art) { var L = LAY18.letters; for (var sd = -1; sd <= 1; sd += 2) { var pl = k2w(Math.cos(L.a + sd * 17 * DEG) * (L.r + 0.4), Math.sin(L.a + sd * 17 * DEG) * (L.r + 0.4)); if (CRT.holes.some(function (h) { return planInPoly(growPoly(h, 2.2), pl[0], pl[1]); })) continue; var el = put18("canarypalm", pl[0], pl[1], R() * TAU, 1.25); if (el) { R18.palms.push([pl[0], pl[1], (MODELS.canarypalm.height || 9) * el[4]]); R18.lpalms = (R18.lpalms || []).concat([pl]); } } }
    // the late pass: after plan_enrich's last world hook, before the engine instances anything
    HK.world.push({ name: "arrivalsWorldR18Late", fn: function () { try { if (ON18.fix) palmSwap(); } catch (e) { note("r18 palms", e); } try { strays18(); } catch (e) { note("r18 strays", e); } } });
  }

  // ───────── materials and kit ─────────
  var M18 = null;
  function mats18() { if (M18) return M18; var M = mats(); M18 = AR.m18 = {};
    M18.letter = M.white.clone(); M18.letter.color = new THREE.Color(0xf6f2ea); M18.letter.emissive = new THREE.Color(0xfff0d2); M18.letter.emissiveIntensity = 0.02;
    M18.bulb = M.led.clone(); M18.bulb.color = new THREE.Color(0xfff1d0); M18.bulb.emissive = new THREE.Color(0xffd28a); M18.bulb.emissiveIntensity = 0.1; M18.bulb.polygonOffset = false;
    M18.ring = M.led.clone(); M18.ring.color = new THREE.Color(0xffe6b0); M18.ring.emissive = new THREE.Color(0xffb54a); M18.ring.polygonOffset = false;
    M18.dg = soilMat().clone(); M18.dg.color = new THREE.Color(0xc9ae86);
    M18.beam = M.beam.clone(); M18.halo = M.beam.clone(); M18.halo.map = glowTex(); M18.glow = M.glow.clone();
    M18.corten = M.bronze.clone(); M18.corten.color = new THREE.Color(0x7a3d1e); M18.corten.roughness = 0.75; M18.corten.metalness = 0.35;
    try { var FM = fountainMats(); M18.water = FM.water([new THREE.Vector4(1e5, 0, 0, 0), new THREE.Vector4(), new THREE.Vector4()]); M18.sheet = FM.sheet; } catch (e) { note("r18 water mats", e); }
    return M18; }
  // water surfaces: the fountain water shader reads its ripples from the local xy plane, so the geometry is built in a frame that
  // a -90 degree turn about x lays flat: local (x, -z, y) is world (x, y, z)
  function wq(G, a, b, c, d) { var L = function (p) { return [p[0], -p[2], p[1]]; }; var A = L(a), B = L(b), D = L(d); var nz = (B[0] - A[0]) * (D[1] - A[1]) - (B[1] - A[1]) * (D[0] - A[0]); var i0 = G.v.apply(G, A.concat([0, 0, 1, 0, 0])), i1 = G.v.apply(G, B.concat([0, 0, 1, 1, 0])), i2 = G.v.apply(G, L(c).concat([0, 0, 1, 1, 1])), i3 = G.v.apply(G, D.concat([0, 0, 1, 0, 1])); if (nz >= 0) G.i.push(i0, i1, i2, i0, i2, i3); else G.i.push(i0, i2, i1, i0, i3, i2); }
  function dY(x, z) { return courtIn(x, z) ? CRT.y(x, z) : (gy(x, z)); }

  // ───────── the runnels and their bubblers; the water walls ─────────
  function buildWater18(K18) {
    var RN = LAY18.runnel, W = LAY18.wwall; var jets = [], splash = [];
    [[LAY18.sunA, RN.sun], [LAY18.clubA, RN.club]].forEach(function (ax) { var A = ax[0], s0 = ax[1][0], s1 = ax[1][1];
      for (var sd = -1; sd <= 1; sd += 2) { var l = sd * RN.lat, hw = RN.w / 2; var n = Math.ceil((s1 - s0) / 1.0);
        for (var i = 0; i < n; i++) { var a = s0 + (s1 - s0) * i / n, b = s0 + (s1 - s0) * (i + 1) / n;
          var P = function (s, ll, dy) { var w = ax2w(A, s, ll); return [w[0], dY(w[0], w[1]) + dy, w[1]]; };
          wq(K18.water, P(a, l - hw, 0.035), P(b, l - hw, 0.035), P(b, l + hw, 0.035), P(a, l + hw, 0.035));
          // granite lips either side, 0.1 m wide and 70 mm proud of the deck
          [l - hw - 0.05, l + hw + 0.05].forEach(function (lc) { var m = ax2w(A, (a + b) / 2, lc); var y = dY(m[0], m[1]); var f = wdir(A); K18.gran.box(m[0], y + 0.025, m[1], 0.1, 0.1, (b - a) + 0.01, Math.atan2(f[0], f[1]), 1.2); }); }
        // the inner end: a granite sill; the outer end: a source stone with a bronze spout and a short spill
        var f2 = wdir(A), yaw = Math.atan2(f2[0], f2[1]); var e0 = ax2w(A, s0 - 0.06, l); K18.gran.box(e0[0], dY(e0[0], e0[1]) + 0.025, e0[1], RN.w + 0.2, 0.1, 0.12, yaw, 1.2);
        var sc = ax2w(A, s1 + 0.45, l), ys = dY(sc[0], sc[1]); K18.trav.box(sc[0], ys + 0.3, sc[1], 1.1, 0.6, 0.9, yaw, 1.2); K18.bronze.box(sc[0], ys + 0.61, sc[1], 1.16, 0.04, 0.96, yaw, 1);
        var sp = ax2w(A, s1 - 0.06, l); K18.bronze.box(sp[0], ys + 0.47, sp[1], 0.34, 0.05, 0.16, yaw, 1);
        // the spill: a 0.3 m sheet from the spout lip to the runnel
        var q0 = ax2w(A, s1 - 0.12, l - 0.15), q1 = ax2w(A, s1 - 0.12, l + 0.15), q2 = ax2w(A, s1 - 0.22, l + 0.15), q3 = ax2w(A, s1 - 0.22, l - 0.15);
        K18.sheet.quad([q0[0], ys + 0.45, q0[1]], [q1[0], ys + 0.45, q1[1]], [q2[0], dY(q2[0], q2[1]) + 0.04, q2[1]], [q3[0], dY(q3[0], q3[1]) + 0.04, q3[1]], [0, 0], [0.12, 0], [0.12, 1], [0, 1]);
        wall(sc[0], sc[1], yaw, 1.1, 0.9, ys - 0.1, ys + 0.62);
        for (var s = s0 + 1.3; s < s1 - 1.0; s += RN.jet) { var jp = ax2w(A, s, l); jets.push([jp[0], dY(jp[0], jp[1]) + 0.04, jp[1]]); K18.bronze.cyl(jp[0], dY(jp[0], jp[1]) + 0.03, jp[1], 0.07, 0.08, dY(jp[0], jp[1]) + 0.045, 10); } } });
    // the water walls: a 2.5 m travertine wall each side of the Sun Gate Walk, a sheet of water down its inner face into a trough
    var A = LAY18.sunA, f = wdir(A), yaw = Math.atan2(f[0], f[1]), Lw = W.s1 - W.s0, sm = (W.s0 + W.s1) / 2; R18.walls = [];
    for (var sd2 = -1; sd2 <= 1; sd2 += 2) { var c = ax2w(A, sm, sd2 * W.lat); var ya = dY.apply(null, ax2w(A, W.s0, sd2 * W.lat)), yb = dY.apply(null, ax2w(A, W.s1, sd2 * W.lat)); var y0 = Math.min(ya, yb), y1 = Math.max(ya, yb);
      K18.trav.box(c[0], y0 + 0.06, c[1], W.t + 0.22, 0.2, Lw + 0.22, yaw, 1.2);
      K18.trav.box(c[0], y0 + (W.h + (y1 - y0)) / 2, c[1], W.t, W.h + (y1 - y0), Lw, yaw, 1.5);
      K18.bronze.box(c[0], y0 + W.h + (y1 - y0) + 0.04, c[1], W.t + 0.12, 0.08, Lw + 0.12, yaw, 1);
      var inner = sd2 * (W.lat - W.t / 2), top = y0 + W.h + (y1 - y0) - 0.06, wl = y0 + 0.36;
      var lip = ax2w(A, sm, inner - sd2 * 0.04); K18.bronze.box(lip[0], top, lip[1], 0.08, 0.05, Lw - 0.1, yaw, 1);
      // the sheet (uv x across the wall, 0 at the top), a hair off the face
      var off = inner - sd2 * 0.05; var S0 = ax2w(A, W.s0 + 0.08, off), S1 = ax2w(A, W.s1 - 0.08, off), B0 = ax2w(A, W.s0 + 0.08, off - sd2 * 0.06), B1 = ax2w(A, W.s1 - 0.08, off - sd2 * 0.06);
      K18.sheet.quad([S0[0], top, S0[1]], [S1[0], top, S1[1]], [B1[0], wl, B1[1]], [B0[0], wl, B0[1]], [0, 0], [1, 0], [1, 1], [0, 1]);
      // the trough: an outer lip and two ends in travertine, the water at 0.36 m
      var tl = inner - sd2 * W.tw; var tc = ax2w(A, sm, tl - sd2 * 0.06); K18.trav.box(tc[0], y0 + 0.21, tc[1], 0.14, 0.42, Lw, yaw, 1.2); K18.gran.box(tc[0], y0 + 0.43, tc[1], 0.2, 0.04, Lw + 0.04, yaw, 1.2);
      [W.s0 + 0.07, W.s1 - 0.07].forEach(function (se) { var ec = ax2w(A, se, (inner + tl) / 2); K18.trav.box(ec[0], y0 + 0.21, ec[1], W.tw, 0.42, 0.14, yaw, 1.2); });
      var T0 = ax2w(A, W.s0 + 0.14, inner), T1 = ax2w(A, W.s1 - 0.14, inner), T2 = ax2w(A, W.s1 - 0.14, tl), T3 = ax2w(A, W.s0 + 0.14, tl); wq(K18.water, [T0[0], wl, T0[1]], [T1[0], wl, T1[1]], [T2[0], wl, T2[1]], [T3[0], wl, T3[1]]);
      for (var s3 = W.s0 + 0.4; s3 < W.s1 - 0.3; s3 += 0.45) { var sp3 = ax2w(A, s3, inner - sd2 * 0.12); splash.push([sp3[0], wl + 0.01, sp3[1]]); }
      // the LED wash up the falling water (an additive beam on the sheet) and a line of light under the cap
      var bm = ax2w(A, W.s0 + 0.1, inner - sd2 * 0.09), bn = ax2w(A, W.s1 - 0.1, inner - sd2 * 0.09); K18.beam.setCol(0x9fd8ff); K18.beam.quad([bm[0], wl, bm[1]], [bn[0], wl, bn[1]], [bn[0], top, bn[1]], [bm[0], top, bm[1]], [0, 0], [1, 0], [1, 1], [0, 1]);
      var gp = ax2w(A, sm, tl - sd2 * 1.4); glowQuad(K18.glow, gp[0], dY(gp[0], gp[1]) + 0.03, gp[1], 3.4, 0x7fc8ff);
      wall(c[0], c[1], yaw, W.t + 0.22, Lw + 0.22, y0 - 0.2, y0 + W.h + (y1 - y0)); var trc = ax2w(A, sm, (inner + tl) / 2); wall(trc[0], trc[1], yaw, W.tw + 0.1, Lw, y0 - 0.2, y0 + 0.45);
      R18.walls.push({ x: c[0], z: c[1], y: y0, inner: ax2w(A, sm, tl - sd2 * 1.6), face: Math.atan2(c[0] - ax2w(A, sm, tl - sd2 * 1.6)[0], c[1] - ax2w(A, sm, tl - sd2 * 1.6)[1]) }); }
    var pts = []; if (typeof sprayPoints === "function" && (jets.length || splash.length)) {
      var v = Math.sqrt(2 * 9.8 * 0.42); var jp2 = sprayPoints(jets.length * 46, function (i) { var p = jets[i % jets.length]; return { p: p, v: v, spread: 0.06, life: 2 * v / 9.8 }; }); pts.push(jp2);
      var v2 = Math.sqrt(2 * 9.8 * 0.08); var sp2 = sprayPoints(splash.length * 14, function (i) { var p = splash[i % splash.length]; return { p: p, v: v2, spread: 0.9, life: 2 * v2 / 9.8 + 0.05 }; }); pts.push(sp2);
      var bs = new THREE.Sphere(new THREE.Vector3(K.c[0], dY(K.c[0], K.c[1]) + 1, K.c[1]), CRT.R + 2); pts.forEach(function (p) { p.geometry.boundingSphere = bs; p.frustumCulled = true; p.name = "ar18 jets"; }); }
    R18.n.jets = jets.length; R18.n.splash = splash.length; return pts;
  }

  // ───────── the GENESIS ONE letters ─────────
  // block letters from stroke outlines (no font files): straight strokes as boxes, the bowls of G, O and S as offset centrelines
  function strokeShape(pts, w) { var Lf = [], Rt = [], n = pts.length; for (var i = 0; i < n; i++) { var a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; var dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; var nx = -dy / l, ny = dx / l; Lf.push(new THREE.Vector2(pts[i][0] + nx * w / 2, pts[i][1] + ny * w / 2)); Rt.push(new THREE.Vector2(pts[i][0] - nx * w / 2, pts[i][1] - ny * w / 2)); } return new THREE.Shape(Lf.concat(Rt.reverse())); }
  function rectShape(x0, y0, x1, y1) { return new THREE.Shape([new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)]); }
  function arcPts(cx, cy, rx, ry, a0, a1, n) { var o = []; for (var i = 0; i <= n; i++) { var t = a0 + (a1 - a0) * i / n; o.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]); } return o; }
  function glyph(ch, H, Wl, w) {
    var S = [], wI = w * 1.1;
    if (ch === "E") { S.push(rectShape(0, 0, w, H), rectShape(0, H - w, Wl, H), rectShape(0, (H - w * 0.9) / 2, Wl * 0.84, (H + w * 0.9) / 2), rectShape(0, 0, Wl, w)); return { s: S, w: Wl }; }
    if (ch === "N") { S.push(rectShape(0, 0, w, H), rectShape(Wl - w, 0, Wl, H), new THREE.Shape([new THREE.Vector2(0, H), new THREE.Vector2(w * 1.12, H), new THREE.Vector2(Wl, 0), new THREE.Vector2(Wl - w * 1.12, 0)])); return { s: S, w: Wl }; }
    if (ch === "I") { S.push(rectShape(0, 0, wI, H)); return { s: S, w: wI }; }
    var rc = (Wl - w) / 2, yT = H - Wl / 2, yB = Wl / 2;
    if (ch === "O") { var sh = new THREE.Shape(); sh.moveTo(0, yB); sh.lineTo(0, yT); sh.absarc(Wl / 2, yT, Wl / 2, Math.PI, 0, true); sh.lineTo(Wl, yB); sh.absarc(Wl / 2, yB, Wl / 2, 0, -Math.PI, true);
      var ho = new THREE.Path(); var ri = Wl / 2 - w; ho.moveTo(w, yB); ho.absarc(Wl / 2, yB, ri, Math.PI, 2 * Math.PI, false); ho.lineTo(Wl - w, yT); ho.absarc(Wl / 2, yT, ri, 0, Math.PI, false); ho.lineTo(w, yB); sh.holes.push(ho); S.push(sh); return { s: S, w: Wl }; }
    if (ch === "G") { var p = arcPts(Wl / 2, yT, rc, rc, 22 * DEG, Math.PI, 16); p = p.concat(arcPts(Wl / 2, yB, rc, rc, Math.PI, 2 * Math.PI, 18)); p.push([Wl - w / 2, H * 0.47]); S.push(strokeShape(p, w)); S.push(rectShape(Wl * 0.5, H * 0.47 - w * 0.46, Wl, H * 0.47 + w * 0.46)); return { s: S, w: Wl }; }
    if (ch === "S") { var ry = (H - w) / 4, cyU = H - w / 2 - ry, cyL = w / 2 + ry; var q = arcPts(Wl / 2, cyU, rc, ry, 18 * DEG, 270 * DEG, 22).concat(arcPts(Wl / 2, cyL, rc, ry, 90 * DEG, -162 * DEG, 22).slice(1)); S.push(strokeShape(q, w)); return { s: S, w: Wl }; }
    return { s: [], w: Wl * 0.6 };
  }
  function buildLetters(K18) {
    var L = LAY18.letters, M = mats(); var word = "GENESIS", H = L.H, Wl = 1.14, w = 0.4, gap = 0.27, sp = 0.78, D = L.D;
    var gl = [], tot = 0; for (var i = 0; i < word.length; i++) { var ch = word[i]; if (ch === " ") { gl.push(null); tot += sp; continue; } var g = glyph(ch, H, Wl, w); gl.push(g); tot += g.w + (i < word.length - 1 && word[i + 1] !== " " ? gap : 0); }
    // the chord: centre at K angle L.a, the letters face the court centre; reading left to right for someone looking out
    var mid = k2w(Math.cos(L.a) * L.r, Math.sin(L.a) * L.r), f = [mid[0] - K.c[0], mid[1] - K.c[1]], fl = Math.hypot(f[0], f[1]); f = [f[0] / fl, f[1] / fl]; var rt = [-f[1], f[0]];
    var yaw = Math.atan2(-f[0], -f[1]);   // local +z (the letter fronts) toward the centre, local +x the reading direction
    var PW = tot + 1.1, PD = 1.25, PH = 0.44; var yl = -1e9; for (var t = -0.5; t <= 0.5; t += 0.125) for (var dd = -0.5; dd <= 0.5; dd += 0.5) { var px = mid[0] + rt[0] * PW * t + f[0] * PD * dd, pz = mid[1] + rt[1] * PW * t + f[1] * PD * dd; yl = Math.max(yl, dY(px, pz)); }
    var yb = yl - 0.02; K18.trav.box(mid[0], yb + PH / 2 - 0.1, mid[1], PW, PH + 0.2, PD, yaw, 1.5); K18.bronze.box(mid[0], yb + PH + 0.02, mid[1], PW + 0.06, 0.04, PD + 0.06, yaw, 1); K18.led.box(mid[0] + f[0] * 0.01, yb + 0.06, mid[1] + f[1] * 0.01, PW - 0.2, 0.03, PD + 0.02, yaw, 1);
    var caps = new Geo(), sides = new Geo(); var x0 = -tot / 2, ybase = yb + PH + 0.04;
    var m4 = new THREE.Matrix4().compose(new THREE.Vector3(mid[0], ybase, mid[1]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
    var cx = x0; for (var j = 0; j < word.length; j++) { var gj = gl[j]; if (!gj) { cx += sp; continue; }
      if (gj.s.length) { var eg = new THREE.ExtrudeGeometry(gj.s, { depth: D, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.016, bevelSegments: 1, curveSegments: 10 }); eg.translate(cx, 0, -D / 2);
        var mm = new THREE.Matrix4().multiplyMatrices(m4, new THREE.Matrix4()); var grp0 = eg.groups && eg.groups.length ? eg.groups : [{ start: 0, count: eg.attributes.position.count, materialIndex: 0 }];
        grp0.forEach(function (gg) { var sub = new THREE.BufferGeometry(); ["position", "normal", "uv"].forEach(function (an) { var at = eg.attributes[an]; sub.setAttribute(an, new THREE.BufferAttribute(at.array.slice(gg.start * at.itemSize, (gg.start + gg.count) * at.itemSize), at.itemSize)); }); (gg.materialIndex === 0 ? caps : sides).add(sub, mm); sub.dispose(); }); eg.dispose(); }
      cx += gj.w + gap; }
    var mc = caps.mesh(M18.letter, { cast: true, name: "ar18 letters" }), ms = sides.mesh(M.brass, { cast: true, name: "ar18 letter returns" }); [mc, ms].forEach(function (m) { if (m) K18.grp.add(m); });
    // the plinth's brass line: STAGE ONE · THE LANDING (on the inlay atlas, row 3)
    var fy = yb + PH * 0.5, fc = [mid[0] - f[0] * (PD / 2 + 0.006), mid[1] - f[1] * (PD / 2 + 0.006)], hw = Math.min(5.2, PW * 0.42), hh = 0.2;
    K18.inlay.quad([fc[0] - rt[0] * hw, fy - hh, fc[1] - rt[1] * hw], [fc[0] + rt[0] * hw, fy - hh, fc[1] + rt[1] * hw], [fc[0] + rt[0] * hw, fy + hh, fc[1] + rt[1] * hw], [fc[0] - rt[0] * hw, fy + hh, fc[1] - rt[1] * hw], [0, 0], [1, 0], [1, 0.25], [0, 0.25]);
    // night: a warm pool in front, two washes up the letters, tree rings round the two flanking palms
    var gp = [mid[0] - f[0] * 2.6, mid[1] - f[1] * 2.6]; glowQuad(K18.glow, gp[0], dY(gp[0], gp[1]) + 0.03, gp[1], 6.5, 0xffd9a8);
    wall(mid[0], mid[1], yaw, PW, PD, yb - 0.2, ybase + H); R18.letters = { x: mid[0], z: mid[1], y: ybase, front: [mid[0] - f[0] * 5.5, mid[1] - f[1] * 5.5], face: yaw + Math.PI, f: f };
    hotspots.push({ x: mid[0] - f[0] * 3, z: mid[1] - f[1] * 3, r: 7, t: "GENESIS", k: "Arrivals Court · the photo spot", p: "The name in letters taller than you, lit warm after dark. Stand on the court side for the photo: the Welcome House and the Club Walk palms behind you, the Welcome Fountain in front." });
  }

  // ───────── the Welcome Steps: seat walls, two planted tiers, specimen palms and shade sails on the south rim ─────────
  function buildSteps(K18) {
    var S = LAY18.steps, n = Math.ceil((S.a1 - S.a0) / (1.1 * DEG)); R18.seats = 0;
    var P = function (a, r, y) { return [Math.cos(a) * r, Math.sin(a) * r]; };
    var W = function (a, r, y) { var q = k2w(Math.cos(a) * r, Math.sin(a) * r); return [q[0], y, q[1]]; };
    for (var i = 0; i < n; i++) { var a0 = S.a0 + (S.a1 - S.a0) * i / n, a1 = S.a0 + (S.a1 - S.a0) * (i + 1) / n; var y0 = stepsY(a0), y1 = stepsY(a1);
      var u0 = a0 * S.rf / 1.5, u1 = a1 * S.rf / 1.5;
      // the seat wall: travertine face, an LED line under a teak seat, the seat
      K18.trav.quad(W(a0, S.rf, y0 - 0.02), W(a1, S.rf, y1 - 0.02), W(a1, S.rf, y1 + 0.37), W(a0, S.rf, y0 + 0.37), [u0, 0], [u1, 0], [u1, 0.26], [u0, 0.26]);
      K18.led.quad(W(a0, S.rf + 0.03, y0 + 0.37), W(a1, S.rf + 0.03, y1 + 0.37), W(a1, S.rf + 0.03, y1 + 0.405), W(a0, S.rf + 0.03, y0 + 0.405));
      K18.wood.quad(W(a0, S.rf - 0.05, y0 + 0.405), W(a1, S.rf - 0.05, y1 + 0.405), W(a1, S.rf - 0.05, y1 + 0.465), W(a0, S.rf - 0.05, y0 + 0.465), [u0, 0], [u1, 0], [u1, 0.04], [u0, 0.04]);
      K18.wood.quad(W(a0, S.rf - 0.05, y0 + 0.465), W(a1, S.rf - 0.05, y1 + 0.465), W(a1, S.rs, y1 + 0.465), W(a0, S.rs, y0 + 0.465), [u0, 0], [u1, 0], [u1, 0.4], [u0, 0.4]);
      K18.trav.quad(W(a0, S.rs, y0 + 0.465), W(a1, S.rs, y1 + 0.465), W(a1, S.rs, y1 + 0.4), W(a0, S.rs, y0 + 0.4));
      // tier one soil, the tier two wall and cap, tier two soil, the back wall down to the ground
      K18.soil.quad(W(a0, S.rs, y0 + 0.4), W(a1, S.rs, y1 + 0.4), W(a1, S.r2, y1 + 0.4), W(a0, S.r2, y0 + 0.4), [a0 * 18, 0], [a1 * 18, 0], [a1 * 18, 1.2], [a0 * 18, 1.2]);
      var v0 = a0 * S.r2 / 1.5, v1 = a1 * S.r2 / 1.5; K18.trav.quad(W(a0, S.r2, y0 + 0.4), W(a1, S.r2, y1 + 0.4), W(a1, S.r2, y1 + 0.95), W(a0, S.r2, y0 + 0.95), [v0, 0], [v1, 0], [v1, 0.37], [v0, 0.37]);
      K18.gran.quad(W(a0, S.r2 - 0.03, y0 + 0.95), W(a1, S.r2 - 0.03, y1 + 0.95), W(a1, S.r2b, y1 + 0.95), W(a0, S.r2b, y0 + 0.95), [v0, 0], [v1, 0], [v1, 0.2], [v0, 0.2]);
      K18.trav.quad(W(a0, S.r2b, y0 + 0.95), W(a1, S.r2b, y1 + 0.95), W(a1, S.r2b, y1 + 0.88), W(a0, S.r2b, y0 + 0.88));
      K18.soil.quad(W(a0, S.r2b, y0 + 0.88), W(a1, S.r2b, y1 + 0.88), W(a1, S.rb - 0.25, y1 + 0.88), W(a0, S.rb - 0.25, y0 + 0.88), [a0 * 20, 0], [a1 * 20, 0], [a1 * 20, 1.4], [a0 * 20, 1.4]);
      K18.gran.quad(W(a0, S.rb - 0.25, y0 + 0.95), W(a1, S.rb - 0.25, y1 + 0.95), W(a1, S.rb + 0.03, y1 + 0.95), W(a0, S.rb + 0.03, y0 + 0.95));
      K18.trav.quad(W(a0, S.rb - 0.25, y0 + 0.88), W(a1, S.rb - 0.25, y1 + 0.88), W(a1, S.rb - 0.25, y1 + 0.95), W(a0, S.rb - 0.25, y0 + 0.95));
      var p0 = k2w(Math.cos(a0) * S.rb, Math.sin(a0) * S.rb), p1 = k2w(Math.cos(a1) * S.rb, Math.sin(a1) * S.rb); var g0 = terr(p0[0], p0[1]) - 0.15, g1 = terr(p1[0], p1[1]) - 0.15; var b0 = a0 * S.rb / 1.5, b1 = a1 * S.rb / 1.5;
      K18.trav.quad(W(a1, S.rb, g1), W(a0, S.rb, g0), W(a0, S.rb, y0 + 0.95), W(a1, S.rb, y1 + 0.95), [b1, 0], [b0, 0], [b0, (y0 + 0.95 - g0) / 1.5], [b1, (y1 + 0.95 - g1) / 1.5]);
      // the solids: the beds (no step), and a seat every bay (sitters face the court)
      var am = (a0 + a1) / 2, ym = (y0 + y1) / 2; var bc = k2w(Math.cos(am) * (S.rs + S.rb) / 2, Math.sin(am) * (S.rs + S.rb) / 2); var ty = kYaw(-Math.sin(am), Math.cos(am)); wall(bc[0], bc[1], ty, (S.rb - S.rs), S.rf * (a1 - a0) * 1.15, ym - 0.3, ym + 0.95);
      if (i % 2 === 0) { var a2 = Math.min(S.a1, a0 + 2 * (S.a1 - S.a0) / n), am2 = (a0 + a2) / 2; var sc = k2w(Math.cos(am2) * (S.rf + S.rs) / 2, Math.sin(am2) * (S.rf + S.rs) / 2); var face = kYaw(-Math.cos(am2), -Math.sin(am2)); var sd = addSolid(sc[0], sc[1], face, S.rf * (a2 - a0) * 0.98, S.rs - S.rf, ym - 0.05, ym + 0.465, "arrivals"); if (sd) { sd.seat = true; sd.face = face; sd.noStep = true; R18.seats++; } } }
    // the two ends: travertine cheeks on the full profile
    [S.a0, S.a1].forEach(function (a, e) { var y = stepsY(a), pr = [[S.rf, y - 0.02], [S.rf, y + 0.465], [S.rs, y + 0.465], [S.rs, y + 0.4], [S.r2, y + 0.4], [S.r2, y + 0.95], [S.rb + 0.03, y + 0.95], [S.rb + 0.03, null]];
      var pb = k2w(Math.cos(a) * S.rb, Math.sin(a) * S.rb); pr[7][1] = terr(pb[0], pb[1]) - 0.15; var pf = k2w(Math.cos(a) * (S.rf + 0.45), Math.sin(a) * (S.rf + 0.45)); pr.push([S.rf + 0.45, Math.min(y - 0.02, terr(pf[0], pf[1]) - 0.15)]);
      var v2 = pr.map(function (q) { return new THREE.Vector2(q[0], q[1]); }); var tri = THREE.ShapeUtils.triangulateShape(v2, []); var base = K18.trav.p.length / 3; var t = kYaw(-Math.sin(a), Math.cos(a)); var nx = Math.sin(t) * (e ? 1 : -1), nz = Math.cos(t) * (e ? 1 : -1);
      pr.forEach(function (q) { var w = k2w(Math.cos(a) * q[0], Math.sin(a) * q[0]); K18.trav.v(w[0], q[1], w[1], nx, 0, nz, q[0] / 1.5, q[1] / 1.5); }); var Pv = K18.trav.p; tri.forEach(function (tr) { var ia = base + tr[0], ib = base + tr[1], ic = base + tr[2]; var ax = Pv[ib * 3] - Pv[ia * 3], ay = Pv[ib * 3 + 1] - Pv[ia * 3 + 1], az = Pv[ib * 3 + 2] - Pv[ia * 3 + 2], bx = Pv[ic * 3] - Pv[ia * 3], by = Pv[ic * 3 + 1] - Pv[ia * 3 + 1], bz = Pv[ic * 3 + 2] - Pv[ia * 3 + 2]; var cx2 = ay * bz - az * by, cz2 = ax * by - ay * bx; if (cx2 * nx + cz2 * nz >= 0) K18.trav.i.push(ia, ib, ic); else K18.trav.i.push(ia, ic, ib); }); });
    // shade sails: three hypars from tall masts on the back tier to short masts behind the seats
    var SM = sailMat(), sg = new Geo(); var nS = 3; for (var k = 0; k < nS; k++) { var ac = S.a0 + (S.a1 - S.a0) * (0.03 + 0.94 * (k + 0.5) / nS), hwA = (S.a1 - S.a0) * 0.94 / nS * 0.3; var yc = stepsY(ac);
      var cF0 = W(ac - hwA, S.rs + 0.9, yc + 3.5), cF1 = W(ac + hwA, S.rs + 0.9, yc + 3.1), cB1 = W(ac + hwA * 0.95, S.rb - 0.45, yc + 6.1), cB0 = W(ac - hwA * 0.95, S.rb - 0.45, yc + 5.6);
      sailGeo(sg, [[cF0[0], cF0[2], cF0[1]], [cF1[0], cF1[2], cF1[1]], [cB1[0], cB1[2], cB1[1]], [cB0[0], cB0[2], cB0[1]]], 8);
      [[cF0, yc + 0.4], [cF1, yc + 0.4], [cB1, yc + 0.88], [cB0, yc + 0.88]].forEach(function (q) { K18.bronze.cyl(q[0][0], q[1] - 0.1, q[0][2], 0.07, 0.1, q[0][1] + 0.3, 10); wall(q[0][0], q[0][2], 0, 0.26, 0.26, q[1], q[0][1]); }); }
    var smesh = sg.mesh(SM, { cast: true, name: "ar18 step sails" }); if (smesh) K18.grp.add(smesh);
    // night: warm pools along the seats
    for (var g2 = 0; g2 < 9; g2++) { var ag = S.a0 + (S.a1 - S.a0) * (g2 + 0.5) / 9; var pg = k2w(Math.cos(ag) * (S.rf - 1.3), Math.sin(ag) * (S.rf - 1.3)); glowQuad(K18.glow, pg[0], dY(pg[0], pg[1]) + 0.03, pg[1], 2.6, 0xffc98a); }
    var hc = k2w(Math.cos((S.a0 + S.a1) / 2) * (S.rf - 2), Math.sin((S.a0 + S.a1) / 2) * (S.rf - 2));
    hotspots.push({ x: hc[0], z: hc[1], r: 9, t: "The Welcome Steps", k: "Arrivals Court · seat walls under the palms", p: "Teak seats on the court's south rim, planted tiers of agave, barrel cactus, flowering shrubs and prickly pear behind you, specimen canary palms and shade sails above. Sit and watch the court; the seats glow along their edge after dark." });
  }

  // ───────── the Sun Ring in its desert garden ─────────
  function buildGarden(K18) {
    var g = gardenC(), G = LAY18.garden, n = 48;
    for (var i = 0; i < n; i++) { var t0 = i / n * TAU, t1 = (i + 1) / n * TAU; var P = function (t, r) { var x = g[0] + Math.cos(t) * r, z = g[1] + Math.sin(t) * r; return [x, terr(x, z) + 0.06, z]; };
      K18.dg.quad(P(t0, 0.01), P(t1, 0.01), P(t1, G.R - 0.12), P(t0, G.R - 0.12), [0, 0], [0, 0], [Math.cos(t1) * G.R / 2, Math.sin(t1) * G.R / 2], [Math.cos(t0) * G.R / 2, Math.sin(t0) * G.R / 2]);
      var e0 = P(t0, G.R), e1 = P(t1, G.R); K18.gran.quad([e1[0], e1[1] - 0.2, e1[2]], [e0[0], e0[1] - 0.2, e0[2]], [e0[0], e0[1] + 0.06, e0[2]], [e1[0], e1[1] + 0.06, e1[2]]); }
    if (!ON18.art) return;
    // the ring faces the court; a corten plinth, a 6.4 m brass ring, a slowly turning inner ring, an LED line inside the outer ring
    var f = [K.c[0] - g[0], K.c[1] - g[1]], fl = Math.hypot(f[0], f[1]); f = [f[0] / fl, f[1] / fl]; var yaw = Math.atan2(f[0], f[1]); var y0 = terr(g[0], g[1]) + 0.06;
    K18.corten.box(g[0], y0 + 0.3, g[1], 2.1, 0.6, 1.0, yaw, 1); K18.corten.box(g[0], y0 + 0.66, g[1], 1.2, 0.12, 0.7, yaw, 1);
    var Rr = 3.2, yc = y0 + 0.72 + Rr; var tg = new THREE.TorusGeometry(Rr, 0.17, 14, 96); K18.brass.add(tg, M4(g[0], yc, g[1], yaw)); tg.dispose();
    var lg = new THREE.TorusGeometry(Rr - 0.17, 0.035, 8, 96); K18.ring.add(lg, M4(g[0], yc, g[1], yaw)); lg.dispose();
    var ig = new THREE.TorusGeometry(Rr * 0.72, 0.07, 10, 72); var im = new THREE.Mesh(ig, mats().brass); im.position.set(g[0], yc, g[1]); im.rotation.y = yaw; im.castShadow = true; im.receiveShadow = true; im.name = "ar18 sun ring inner"; im.userData.noInst = true; im.userData.arrivals = true; K18.grp.add(im);
    var sg = new THREE.SphereGeometry(0.34, 20, 14); K18.ring.add(sg, M4(g[0], yc, g[1], 0)); sg.dispose();
    R18.ring = { m: im, x: g[0], z: g[1], yaw: yaw }; try { if (window.PLAN_POST && PLAN_POST.mover) PLAN_POST.mover(im); } catch (e) {}
    glowQuad(K18.glow, g[0], y0 + 0.03, g[1], 7.5, 0xffc27a); K18.beam.setCol(0xffd0a0); var rt = [-f[1], f[0]]; K18.beam.quad([g[0] - rt[0] * 3.4 + f[0] * 0.6, y0 + 0.6, g[1] - rt[1] * 3.4 + f[1] * 0.6], [g[0] + rt[0] * 3.4 + f[0] * 0.6, y0 + 0.6, g[1] + rt[1] * 3.4 + f[1] * 0.6], [g[0] + rt[0] * 3.4 + f[0] * 0.6, y0 + 7.8, g[1] + rt[1] * 3.4 + f[1] * 0.6], [g[0] - rt[0] * 3.4 + f[0] * 0.6, y0 + 7.8, g[1] - rt[1] * 3.4 + f[1] * 0.6], [0, 0], [1, 0], [1, 1], [0, 1]);
    wall(g[0], g[1], yaw, 2.1, 1.0, y0 - 0.2, y0 + 0.72 + 2 * Rr);
    hotspots.push({ x: g[0], z: g[1], r: 8, t: "The Sun Ring", k: "Arrivals Court garden · brass and corten", p: "A ring of brass taller than a house, its inner ring turning slowly with the breeze, in a garden of date palms, golden barrels, agave and boulders. It frames the court from the garden and glows at its core after dark." });
  }

  // ───────── the entry: festoon lights and banners over the Sun Gate approach; the brass wayfinding inlays ─────────
  function buildEntry(K18) {
    var F = LAY18.fest, A = LAY18.sunA, f = wdir(A), posts = [];
    for (var i = 0; i < 2; i++) for (var sd = -1; sd <= 1; sd += 2) { var p = ax2w(A, F.s[i], sd * F.lat[i]); var y = dY(p[0], p[1]); posts.push([p[0], y, p[1], i, sd]); K18.bronze.cyl(p[0], y - 0.1, p[1], 0.07, 0.1, y + F.h, 10); K18.bronze.cyl(p[0], y - 0.1, p[1], 0.18, 0.22, y + 0.3, 14); var tp = new THREE.SphereGeometry(0.11, 12, 8); K18.brass.add(tp, M4(p[0], y + F.h + 0.08, p[1], 0)); tp.dispose(); wall(p[0], p[1], 0, 0.36, 0.36, y - 0.1, y + 2.5); }
    var strands = [[0, 1], [2, 3], [0, 3], [1, 2]], nb = 0, bulbG = new THREE.SphereGeometry(0.055, 8, 6);
    strands.forEach(function (st) { var a = posts[st[0]], b = posts[st[1]]; var ya = a[1] + F.h - 0.25, yb = b[1] + F.h - 0.25, L = Math.hypot(b[0] - a[0], b[2] - a[2]); var sag = 0.07 * L; var n = Math.round(L / 0.55); var prev = null;
      for (var k = 0; k <= n; k++) { var t = k / n; var x = lerp(a[0], b[0], t), z = lerp(a[2], b[2], t), y = lerp(ya, yb, t) - sag * 4 * t * (1 - t); var q = [x, y, z]; if (prev) K18.bronze.rod(prev, q, 0.008, 4); prev = q; if (k > 0 && k < n) { K18.bulb.add(bulbG, M4(x, y - 0.09, z, 0)); nb++; } } });
    bulbG.dispose(); R18.n.bulbs = nb;
    // a banner on every festoon post (the court's banner atlas), turned to the people walking in
    if (MT.banner) { var ban = new Geo(); var yaw = Math.atan2(-f[0], -f[1]); var cs = Math.cos(yaw), sn = Math.sin(yaw);
      posts.forEach(function (p, j) { var x = p[0], z = p[2], y = p[1], H = F.h; var side = -p[4]; var arm = function (lx, yy) { return [x + lx * cs * side, yy, z - lx * sn * side]; }; K18.bronze.rod(arm(0, y + H - 0.55), arm(0.95, y + H - 0.55), 0.025, 6); K18.bronze.rod(arm(0, y + H - 3.35), arm(0.95, y + H - 3.35), 0.025, 6);
        var d = [0, 3, 2, 1][j] % 4, u0 = d / 4, u1 = u0 + 0.25; var A0 = arm(0.08, 0), B0 = arm(0.92, 0); var y0 = y + H - 3.3, y1 = y + H - 0.6; var flip = side > 0;
        ban.quad([A0[0], y0, A0[2]], [B0[0], y0, B0[2]], [B0[0], y1, B0[2]], [A0[0], y1, A0[2]], [flip ? u1 : u0, 0], [flip ? u0 : u1, 0], [flip ? u0 : u1, 1], [flip ? u1 : u0, 1]); ban.quad([B0[0], y0, B0[2]], [A0[0], y0, A0[2]], [A0[0], y1, A0[2]], [B0[0], y1, B0[2]], [flip ? u0 : u1, 0], [flip ? u1 : u0, 0], [flip ? u1 : u0, 1], [flip ? u0 : u1, 1]); });
      var bm = ban.mesh(MT.banner, { cast: true, name: "ar18 entry banners" }); if (bm) K18.grp.add(bm); }
    // the inlays: one per opening, read on the way out (the top of the letters outward), rows 0..2 of the atlas
    var rows = { sun_gate_walk: 0, hl1_club_walk: 1, landside_walk: 2 };
    CRT.open.forEach(function (o) { var row = rows[o.id]; if (row === undefined) return; var s = o.id === "hl1_club_walk" ? 26.6 : 25.2; var c = k2w(Math.cos(o.a) * s, Math.sin(o.a) * s); var fo = [Math.cos(o.a) * K.a[0] + Math.sin(o.a) * K.p[0], Math.cos(o.a) * K.a[1] + Math.sin(o.a) * K.p[1]]; var rt = [-fo[1], fo[0]]; var hw = 2.6, hh = 0.33;
      var P = function (r, u) { var x = c[0] + rt[0] * r + fo[0] * u, z = c[1] + rt[1] * r + fo[1] * u; return [x, dY(x, z) + 0.008, z]; }; var v0 = 1 - (row + 1) / 4, v1 = 1 - row / 4;
      K18.inlayF.quad(P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh), [0, v0], [1, v0], [1, v1], [0, v1]); });
  }
  function inlayTex() { var c = cv(2048, 1024), x = c.getContext("2d"), tex = canvasTex(c, {});
    var dist = function (x2, z2) { return distTxt(Math.hypot(x2 - K.c[0], z2 - K.c[1])); }; var hub = function (nm) { try { var h = HUBS.find(function (q) { return q[0] === nm; }); return h ? [h[1], h[2]] : null; } catch (e) { return null; } };
    var draw = function () { x.clearRect(0, 0, 2048, 1024); var rowsT = [["STELLAR AVIATION FBO · SOLPORT", "THE SUN GATE · THE LANDSIDE DOOR · THE RAMP"], ["THE CLUB WALK", "CROSSING PLAZA · THE CROSSING TO STAGE THREE"], ["THE LANDSIDE WALK", "THE CONVENTION CENTER · THE MARKET HALL · GENESIS PARK"], ["STAGE ONE · THE LANDING", ""]];
      try { var cp = hub("Crossing Plaza"); if (cp) rowsT[1][1] = "CROSSING PLAZA " + dist(cp[0], cp[1]) + " · THE CROSSING TO STAGE THREE"; } catch (e) {}
      for (var r = 0; r < 4; r++) { var Y0 = r * 256; if (r < 3) { x.strokeStyle = "#d8b25c"; x.lineWidth = 5; x.strokeRect(10, Y0 + 12, 2028, 232); x.beginPath(); x.moveTo(1024, Y0 + 26); x.lineTo(1064, Y0 + 62); x.lineTo(984, Y0 + 62); x.closePath(); x.fillStyle = "#e2bd66"; x.fill(); }
        txt(x, rowsT[r][0], 1024, Y0 + (r < 3 ? 122 : 128), r < 3 ? 92 : 120, FT.d, "#e2bd66", 400, "center", 1900, r < 3 ? 14 : 24); if (rowsT[r][1]) txt(x, rowsT[r][1], 1024, Y0 + 204, 40, FT.b, "#e2bd66", 700, "center", 1900, 4); }
      tex.needsUpdate = true; };
    onFonts(draw); return tex; }

  // ───────── night: uplights on every palm in the zone's new and converted planting, pools under them ─────────
  function buildPalmLights(K18) { var n = 0;
    R18.palms.forEach(function (p) { var y = gy(p[0], p[1]); if (!(y > -1e8)) return; var H = clamp(p[2], 7, 15), h = H * 0.78;
      for (var s = 0; s < 2; s++) { var yaw = s * Math.PI / 2 + 0.35 + p[0] * 0.1; var cs = Math.cos(yaw), sn = Math.sin(yaw), hw = 0.55; K18.beam.setCol(0xffc887); K18.beam.quad([p[0] - cs * hw, y + 0.1, p[1] + sn * hw], [p[0] + cs * hw, y + 0.1, p[1] - sn * hw], [p[0] + cs * hw, y + h, p[1] - sn * hw], [p[0] - cs * hw, y + h, p[1] + sn * hw], [0, 0], [1, 0], [1, 1], [0, 1]);
        var hr = H * 0.36, hy = y + H * 0.8; K18.halo.setCol(0xffb46a); K18.halo.quad([p[0] - cs * hr, hy - hr * 0.7, p[1] + sn * hr], [p[0] + cs * hr, hy - hr * 0.7, p[1] - sn * hr], [p[0] + cs * hr, hy + hr * 0.7, p[1] - sn * hr], [p[0] - cs * hr, hy + hr * 0.7, p[1] + sn * hr], [0, 0], [1, 0], [1, 1], [0, 1]); }
      glowQuad(K18.glow, p[0], y + 0.04, p[1], 2.6, 0xffb873); n++; });
    R18.n.uplit = n; }

  // ───────── the rail ends: a cantera pillar with a bronze lantern where the court railing is cut ─────────
  function buildRailEnds(K18) { var n = 0;
    (R18.ends || []).forEach(function (e) { var x = e.x, z = e.z, y = dY(x, z); var t = Math.atan2(-Math.sin(e.a), Math.cos(e.a));
      K18.trav.box(x, y + 0.62, z, 0.42, 1.24, 0.42, t, 1.2); K18.gran.box(x, y + 1.27, z, 0.5, 0.06, 0.5, t, 1.2); K18.bronze.box(x, y + 1.33, z, 0.2, 0.06, 0.2, t, 1); K18.led.box(x, y + 1.47, z, 0.15, 0.22, 0.15, t, 1); K18.bronze.box(x, y + 1.6, z, 0.22, 0.05, 0.22, t, 1);
      glowQuad(K18.glow, x, y + 0.03, z, 1.8, 0xffc98a); wall(x, z, t, 0.5, 0.5, y - 0.1, y + 1.6); n++; }); R18.n.railEnds = n; }


  // ───────── fix: plan_crossing's Club Walk median kerb is one 0.3 m kerb, not two thin walls ─────────
  // Its quads share one winding on both sides of the median, so on one side the top faced down and on the other an outer face
  // faced in: with front faces only, the kerb read as two parallel strips with paving between. Turn every face outward (in place,
  // no new material or program).
  function fixClubKerb() { var g = scene.getObjectByName("clubwalk_arcade"); var pr = window.PLAN && PLAN.promenades.find(function (q) { return q.id === "hl1_club_walk"; }); if (!g || !pr) return 0; var FM = null; try { FM = fountainMats().stone; } catch (e) {}
    var lat = function (x, z) { var best = 1e9, sg = 1; for (var i = 0; i < pr.pts.length - 1; i++) { var a = pr.pts[i], b = pr.pts[i + 1], vx = b[0] - a[0], vz = b[1] - a[1], L2 = vx * vx + vz * vz; var t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / L2, 0, 1); var px = a[0] + vx * t, pz = a[1] + vz * t, d = Math.hypot(x - px, z - pz); if (d < best) { best = d; sg = (vx * (z - a[1]) - vz * (x - a[0])) >= 0 ? 1 : -1; } } return best * sg; };
    var n = 0, cut = 0; g.children.forEach(function (m) { if (!m.isMesh || !m.geometry || (FM && m.material !== FM)) return; var G = m.geometry, P = G.attributes.position, N = G.attributes.normal, I = G.index; if (!P || !N || !I) return;
      var ok = 0, tot = 0; for (var v = 0; v < P.count; v += 7) { tot++; var l = Math.abs(lat(P.getX(v), P.getZ(v))); if (l > 1.8 && l < 2.3) ok++; } if (!tot || ok / tot < 0.8) return;
      var ix = I.array, fv = new Set(); for (var t = 0; t < ix.length; t += 3) { var a = ix[t], b = ix[t + 1], c = ix[t + 2];
        var ax = P.getX(b) - P.getX(a), ay = P.getY(b) - P.getY(a), az = P.getZ(b) - P.getZ(a), bx = P.getX(c) - P.getX(a), by = P.getY(c) - P.getY(a), bz = P.getZ(c) - P.getZ(a); var nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
        var cx = (P.getX(a) + P.getX(b) + P.getX(c)) / 3, cz = (P.getZ(a) + P.getZ(b) + P.getZ(c)) / 3; var flip = false;
        if (Math.abs(ny) > 0.7) flip = ny < 0; else { var lc = lat(cx, cz), l2 = lat(cx + nx * 0.05, cz + nz * 0.05); var outward = Math.abs(lc) > 2.05; flip = outward ? Math.abs(l2) < Math.abs(lc) : Math.abs(l2) > Math.abs(lc); if (Math.abs(Math.abs(lc) - 2.05) < 0.04) flip = false; }
        if (Math.hypot(cx - K.c[0], cz - K.c[1]) < CRT.R + 0.4) { ix[t + 1] = a; ix[t + 2] = a; cut++; continue; }   // inside the court the median kerbs stood 0.42 m proud of the deck: gone
        if (flip) { ix[t + 1] = c; ix[t + 2] = b; fv.add(a); fv.add(b); fv.add(c); n++; } }
      fv.forEach(function (q) { N.setXYZ(q, -N.getX(q), -N.getY(q), -N.getZ(q)); }); I.needsUpdate = true; N.needsUpdate = true; });
    // and their solids inside the court (a run that crosses the curb keeps its outside part)
    var rm = 0, Rc = CRT.R + 0.4; for (var i = SOLIDS.length - 1; i >= 0; i--) { var sd = SOLIDS[i]; if (!sd || Math.abs(sd.hw - 0.15) > 0.02 || sd.tag !== "world") continue; var l0 = Math.abs(lat(sd.x, sd.z)); if (l0 < 1.85 || l0 > 2.25) continue;
      var dx = Math.sin(sd.ry), dz = Math.cos(sd.ry); var A = [sd.x - dx * sd.hd, sd.z - dz * sd.hd], B = [sd.x + dx * sd.hd, sd.z + dz * sd.hd]; var ra = Math.hypot(A[0] - K.c[0], A[1] - K.c[1]), rb = Math.hypot(B[0] - K.c[0], B[1] - K.c[1]);
      if (ra >= Rc && rb >= Rc) continue; if (ra < Rc && rb < Rc) { SOLIDS.splice(i, 1); rm++; continue; }
      var In = ra < Rc ? A : B, Out = ra < Rc ? B : A, lo = 0, hi = 1; for (var it = 0; it < 24; it++) { var mid = (lo + hi) / 2; var px = lerp(In[0], Out[0], mid), pz = lerp(In[1], Out[1], mid); if (Math.hypot(px - K.c[0], pz - K.c[1]) < Rc) lo = mid; else hi = mid; }
      var P0 = [lerp(In[0], Out[0], hi), lerp(In[1], Out[1], hi)]; sd.x = (P0[0] + Out[0]) / 2; sd.z = (P0[1] + Out[1]) / 2; sd.hd = Math.hypot(Out[0] - P0[0], Out[1] - P0[1]) / 2; rm++; }
    try { if (rm && typeof R9SG !== "undefined") R9SG.ver++; } catch (e) {}
    R18.n.clubKerbFlips = n; R18.n.clubKerbCut = cut; R18.n.clubKerbSolids = rm; return n; }

  // ───────── the build (the module's defer) ─────────
  function build18() {
    if (!ON18.all || !window.PLAN) return; var t0 = performance.now(); mats18();
    var grp = R18.grp = new THREE.Group(); grp.name = "arrivals r18"; grp.userData.arrivals = true; scene.add(grp);
    var K18 = { grp: grp, trav: new Geo(), gran: new Geo(), bronze: new Geo(), brass: new Geo(), led: new Geo(), soil: new Geo(), dg: new Geo(), wood: new Geo(), corten: new Geo(), ring: new Geo(), bulb: new Geo(), water: new Geo(), sheet: new Geo(), inlay: new Geo(), inlayF: new Geo(), glow: new Geo(true), beam: new Geo(true), halo: new Geo(true) };
    if (ON18.fix) try { fixClubKerb(); } catch (e) { note("r18 club kerb", e); }
    var parts = [["water", ON18.water, buildWater18], ["letters", ON18.art, buildLetters], ["steps", ON18.garden, buildSteps], ["garden", ON18.garden, buildGarden], ["entry", ON18.water || ON18.art, buildEntry], ["railEnds", ON18.fix, buildRailEnds], ["palmLights", true, buildPalmLights]]; var jets = [];
    parts.forEach(function (p) { if (!p[1]) return; var t1 = performance.now(); try { var r = p[2](K18); if (p[0] === "water" && r) jets = r; } catch (e) { note("r18 " + p[0], e); } R18.t[p[0]] = +(performance.now() - t1).toFixed(1); });
    var M = mats(); var itex = null; if (!K18.inlay.empty() || !K18.inlayF.empty()) { itex = inlayTex(); M18.inlay = new THREE.MeshStandardMaterial({ map: itex, transparent: true, alphaTest: 0.3, roughness: 0.28, metalness: 0.85, emissive: 0xffd58a, emissiveMap: itex, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); M18.inlayV = M18.inlay.clone(); M18.inlayV.polygonOffset = false; }
    var add = function (G, mat, o) { var m = G.mesh(mat, o || {}); if (m) grp.add(m); return m; };
    add(K18.trav, M.trav, { cast: true, name: "ar18 travertine" }); add(K18.gran, M.gran, { name: "ar18 granite" }); add(K18.bronze, M.bronze, { name: "ar18 bronze" }); add(K18.brass, M.brass, { cast: true, name: "ar18 brass" }); add(K18.led, M.led, { name: "ar18 led" });
    add(K18.soil, soilMat(), { name: "ar18 beds" }); add(K18.dg, M18.dg, { name: "ar18 garden dg" }); add(K18.wood, woodMat(), { name: "ar18 seats" }); add(K18.corten, M18.corten, { cast: true, name: "ar18 corten" }); add(K18.ring, M18.ring, { name: "ar18 ring led" }); add(K18.bulb, M18.bulb, { name: "ar18 festoon bulbs" });
    if (M18.inlay) { add(K18.inlayF, M18.inlay, { name: "ar18 inlays" }); add(K18.inlay, M18.inlayV, { name: "ar18 plinth line" }); }
    var gm = add(K18.glow, M18.glow, { order: 3, recv: false, name: "ar18 pools" }), bmm = add(K18.beam, M18.beam, { order: 3, recv: false, name: "ar18 beams" }), hm = add(K18.halo, M18.halo, { order: 3, recv: false, name: "ar18 crown light" }); R18.glows = [gm, bmm, hm].filter(Boolean); R18.glows.forEach(function (m) { m.visible = false; });
    // the water: one group the client's fountain loop shows near and hides far (it animates the shaders' time)
    if (M18.water && (!K18.water.empty() || !K18.sheet.empty())) { var wg = new THREE.Group(); wg.name = "ar18 water"; wg.userData.noInst = true; wg.userData.arrivals = true; var anim = [];
      var wm = K18.water.mesh(M18.water, { name: "ar18 water surface" }); if (wm) { wm.rotation.x = -Math.PI / 2; wm.renderOrder = 1; wg.add(wm); }
      var sm = K18.sheet.mesh(M18.sheet, { name: "ar18 water sheets", recv: false }); if (sm) { sm.renderOrder = 3; wg.add(sm); anim.push(sm); }
      jets.forEach(function (p) { wg.add(p); anim.push(p); }); scene.add(wg); R18.water = wg;
      try { if (typeof PLAN_FOUNTAINS !== "undefined") PLAN_FOUNTAINS.push({ id: "ar18", g: wg, anim: anim, x: K.c[0], z: K.c[1], near: true, vis: true, far: 900 }); } catch (e) { note("r18 fountain reg", e); }
      if (R18.walls) R18.walls.forEach(function (w, i) { hotspots.push({ x: w.inner[0], z: w.inner[1], r: 6, t: "The water walls", k: "The Sun Gate Walk · the arrival", p: "Two travertine walls frame the walk in from the Sun Gate, a sheet of water falling down each into a trough, lit from below after dark. The runnels carry the line on past the Welcome Fountain to the Club Walk." }); }); }
    try { var W = window.PLAN_PERF; if (W && W.warmGroup) W.warmGroup(grp, { name: "ar18" }); } catch (e) {}
    R18.built = true; R18.t.build = +(performance.now() - t0).toFixed(1);
    if (ON18.npc) try { setupRoam18(); } catch (e) { note("r18 roam", e); }
  }

  // ───────── a few visitors (PLAN_ROAM): through the openings, to the letters, the water walls, the directory, the steps ─────────
  function setupRoam18() { var RO = window.PLAN_ROAM; if (!RO || !RO.area || RO.off || R18.roam) return;
    var ents = CRT.open.map(function (o) { var p = k2w(Math.cos(o.a) * (CRT.R + 3), Math.sin(o.a) * (CRT.R + 3)); return { x: p[0], z: p[1], face: kYaw(-Math.cos(o.a), -Math.sin(o.a)), tag: o.id }; });
    var pois = []; var add = function (x, z, kind, face, line, dur, tag) { pois.push({ kind: kind, x: x, z: z, face: face, line: line, dur: dur, tag: tag }); };
    if (R18.letters) { var L = R18.letters; for (var i = -1; i <= 1; i++) { var p = [L.front[0] + L.f[1] * i * 2.2, L.front[1] - L.f[0] * i * 2.2]; add(p[0], p[1], "look", L.face, "photo", [8, 18], "letters"); } }
    (R18.walls || []).forEach(function (w) { add(w.inner[0], w.inner[1], "look", w.face, "water", [8, 16], "wwall"); });
    if (TOT) { var tf = [TOT.x + Math.sin(TOT.g.rotation.y) * 2.2, TOT.z + Math.cos(TOT.g.rotation.y) * 2.2]; add(tf[0], tf[1], "look", TOT.g.rotation.y + Math.PI, "map", [8, 18], "totem"); }
    if (AR.model) { var mp = kw(LAY.model[0], LAY.model[1] - 3.6); add(mp[0], mp[1], "look", Math.atan2(AR.model.x - mp[0], AR.model.z - mp[1]), "map", [8, 16], "model"); }
    [30, 150, 210, 330].forEach(function (a) { var p2 = kw(a, 9.4); add(p2[0], p2[1], "look", kYaw(-Math.cos(a * DEG), -Math.sin(a * DEG)), "plaza", [6, 14], "fountain"); });
    [[80, 20], [250, 18], [345, 22]].forEach(function (q, j) { var p3 = kw(q[0], q[1]); add(p3[0], p3[1], "chat", j * 1.7, "plaza", [16, 36], "chat"); });
    var names = (cfg("roam", {}).names) || ["Maya", "Diego", "Priya", "Tom", "Lena", "Marcus", "Sofia", "Ken"];
    var lines = (cfg("roam", {}).lines) || { plaza: ["First time here?", "The fountain is even better at night.", "Which way to the Club Walk?"], photo: ["One more, with the letters.", "Get the palms in too.", "Now one with the fountain."], water: ["Listen to that water.", "It is cooler right here by the wall."], map: ["We are here. Crossing Plaza is that way.", "The Grand Loop stops on the north kerb.", "Look, the whole site on one table."], steps: ["Good spot to people watch.", "Let's sit a minute in the shade."] };
    var inOpen = function (x, z, r) { var th = kang(x, z); for (var i2 = 0; i2 < CRT.open.length; i2++) { var o = CRT.open[i2]; if (Math.abs(adiff(th, o.a)) < o.half - 0.01 && r < CRT.R + 4.5) return true; } return false; };
    var def = { id: "arrivals", max: 3, box: [K.c[0] - 42, K.c[1] - 42, K.c[0] + 42, K.c[1] + 42], people: names.map(function (n) { return { name: n }; }), lines: lines, ready: function () { return !!R18.built; },
      levels: [{ base: function (x, z) { return planGroundAt(x, z); }, exact: true, block: function (x, z) { var r = Math.hypot(x - K.c[0], z - K.c[1]); if (r < 7.9) return true; if (r > CRT.R - 0.4 && !inOpen(x, z, r)) return true; return false; } }],
      entries: function () { return ents; }, seeds: function () { return [kw(100, 15), kw(200, 16), kw(320, 17), kw(20, 24), kw(170, 22)].map(function (q) { return { x: q[0], z: q[1] }; }); }, pois: function () { return pois; },
      seatInfo: function (sd) { return sd.seat && !sd.lie && (sd.tag === "arrivals" || sd.tag === "world") && Math.hypot(sd.x - K.c[0], sd.z - K.c[1]) < CRT.R + 0.6 ? { kind: "sit", line: "steps", tag: "seat" } : null; },
      weight: function (p, h) { if (p.kind === "sit") return h >= 10 && h < 17 ? 2.2 : 1.4; if (p.line === "photo") return h >= 16 && h < 22 ? 2.4 : 1.5; if (p.kind === "chat") return 1.0; return 1.1; },
      count: function (h) { return h >= 8 && h < 23 ? 3 : h >= 6 ? 2 : 1; },
      dur: { sit: [25, 70], chat: [15, 40], look: [6, 16] }, visible: function () { return true; }, sameZone: function () { return true; } };
    var A = RO.area(def); if (A) R18.roam = def.id; }

  // ───────── per frame: night levels, the turning ring, stamps ─────────
  var lastN18 = -1;
  function frame18(dt, now) {
    if (!R18.built) return;
    if ((FRAME_N % 20) === 7) { if (Math.abs(nightK - lastN18) > 0.01) { lastN18 = nightK; if (M18.letter) M18.letter.emissiveIntensity = lerp(0.02, 0.85, nightK); if (M18.bulb) M18.bulb.emissiveIntensity = lerp(0.1, 3.6, nightK); if (M18.ring) M18.ring.emissiveIntensity = lerp(0.15, 3.0, nightK); if (M18.inlay) { M18.inlay.emissiveIntensity = nightK * 0.75; M18.inlayV.emissiveIntensity = nightK * 0.6; }
        if (M18.glow) M18.glow.opacity = nightK; if (M18.beam) M18.beam.opacity = nightK * 0.8; if (M18.halo) M18.halo.opacity = nightK * 0.42; var gv = nightK > 0.02; (R18.glows || []).forEach(function (m) { if (m.visible !== gv) m.visible = gv; }); } }
    if (R18.ring && camera && Math.hypot(camera.position.x - R18.ring.x, camera.position.z - R18.ring.z) < 220) R18.ring.m.rotation.y = R18.ring.yaw + Math.sin(now / 9000) * 1.2 + now / 24000;
    if ((FRAME_N % 15) === 11 && player) { try { if (inside) return; } catch (e) {} var px = player.position.x, pz = player.position.z;
      if (R18.letters && Math.hypot(px - R18.letters.front[0], pz - R18.letters.front[1]) < 3.6) award(STAMP.letters);
      if (R18.ring && Math.hypot(px - R18.ring.x, pz - R18.ring.z) < 5) award(STAMP.ring);
      try { if (SIT && SIT.on && inSteps(kang(px, pz)) && Math.abs(Math.hypot(px - K.c[0], pz - K.c[1]) - 34.8) < 1.4) award(STAMP.steps); } catch (e) {}
      if (R18.walls && R18.walls.some(function (w) { return Math.hypot(px - w.inner[0], pz - w.inner[1]) < 2.4; })) award(STAMP.water); }
  }

  // ───────────────────────── hooks ─────────────────────────
  var GRP = { court: null, apron: null };
  function defer() {
    if (!window.PLAN) return; var t0 = performance.now(); mats();
    if (ON.court) { var g = GRP.court = new THREE.Group(); g.name = "arrivals court"; g.userData.arrivals = true; scene.add(g);
      [["deck", buildCourtDeck], ["planters", buildPlanters], ["totem", buildTotem], ["model", buildSiteModel], ["signpost", buildSignpost], ["pylons", buildPylons], ["banners", buildBanners], ["stop", buildStop], ["night", buildCourtNight], ["door", buildDoorForecourt], ["blvd", buildBoulevard]].forEach(function (b) { var t1 = performance.now(); try { b[1](g); } catch (e) { note("court " + b[0], e); } AR.t["c_" + b[0]] = +(performance.now() - t1).toFixed(1); });
      try { benchSeats(); } catch (e) { note("bench seats", e); } try { liftCourtBits(); } catch (e) { note("lift", e); } }
    if (ON.apron) { var ga = GRP.apron = new THREE.Group(); ga.name = "arrivals apron"; ga.userData.arrivals = true; scene.add(ga);
      [["slab", buildApronSlab], ["markings", buildMarkings], ["gse", buildGSE], ["carpet", buildCarpet], ["dress", buildAirsideDress], ["lights", buildApronLights], ["fence", buildFence], ["sock", buildWindsock], ["crew", crewSetup]].forEach(function (b) { var t1 = performance.now(); try { b[1](ga); } catch (e) { note("apron " + b[0], e); } AR.t["a_" + b[0]] = +(performance.now() - t1).toFixed(1); }); }
    try { build18(); } catch (e) { note("r18 build", e); }
    AR.t.defer = +(performance.now() - t0).toFixed(1);
  }
  // passport stamps this module awards (ids proposed for plan/progress.json, 345 to 349; unknown ids are ignored until added)
  var STAMP = AR.stamps = { dir: "p_ar_directory", model: "p_ar_model", carpet: "p_ar_carpet", lounge: "p_ar_lounge", loop: "p_ar_grandloop", post: "p_ar_signpost", gate: "p_ar_gateway", blvd: "p_ar_boulevard", crew: "p_ar_linecrew", plane: "p_ar_planeside", letters: "p_ar_letters", steps: "p_ar_steps", ring: "p_ar_sunring", water: "p_ar_waterwalls" }; AR.got = AR.got || {};
  function award(id) { if (AR.got[id]) return; AR.got[id] = 1; try { if (window.PLAN_PROGRESS && PLAN_PROGRESS.award) PLAN_PROGRESS.award("stamp", { id: id }); } catch (e) { note("stamp", e); } }
  function stampFrame() { if (!player) return; try { if (inside) return; } catch (e) {} var px = player.position.x, pz = player.position.z;
    if (TOT && Math.hypot(px - TOT.x, pz - TOT.z) < 3.6) award(STAMP.dir);
    if (AR.model && Math.hypot(px - AR.model.x, pz - AR.model.z) < 4.2) award(STAMP.model);
    if (AR.parts.stop && Math.hypot(px - AR.parts.stop.x, pz - AR.parts.stop.z) < 3.2) award(STAMP.loop);
    var l = w2t(px, pz); if (ON.apron && Math.abs(l[0]) < 1.3 && l[1] > 52 && l[1] < ALAY.a2.lz - 3) award(STAMP.carpet);
    try { if (SIT && SIT.on && l[0] > -45 && l[0] < -14 && l[1] > 33.5 && l[1] < 41) award(STAMP.lounge); } catch (e) {}
    if (AR.parts.post && Math.hypot(px - AR.parts.post.x, pz - AR.parts.post.z) < 3.2) award(STAMP.post);
    var kk = w2k(px, pz); if (ON.court && kk[0] > 33 && kk[0] < 38.5 && Math.abs(kk[1]) < 11.5) award(STAMP.gate);
    if (ON.court && px < -60 && px > -71 && Math.abs(pz - roadZ(px)) < 9) award(STAMP.blvd);
    for (var ci = 0; ci < CREW.length; ci++) if (CREW[ci].state === 2 && Math.hypot(px - CREW[ci].x, pz - CREW[ci].z) < 4) { award(STAMP.crew); break; }
    if (ON.apron) for (var si = 0; si < ALAY.stands.length; si++) { var c0 = jw(ALAY.stands[si], 0, 0); if (Math.hypot(px - c0[0], pz - c0[1]) < 7) { award(STAMP.plane); break; } } }
  var nightK = 0, lastN = -1;
  function frame(dt, now) {
    if (!window.PLAN || !MT) return;
    if ((FRAME_N % 20) === 3) { var n = 0; try { n = typeof night === "number" ? night : 0; } catch (e) {} nightK = sstep(0.15, 0.85, n);
      if (Math.abs(nightK - lastN) > 0.01) { lastN = nightK; MT.led.emissiveIntensity = lerp(0.12, 3.2, nightK); MT.glow.opacity = nightK * 0.9; MT.beam.opacity = nightK * 0.55;
        if (MT.totemFace) MT.totemFace.emissiveIntensity = lerp(0.28, 1.05, nightK); if (MT.blade) MT.blade.emissiveIntensity = lerp(0.2, 0.9, nightK); if (MT.blade2) MT.blade2.emissiveIntensity = lerp(0.2, 0.9, nightK); if (MT.pylon) MT.pylon.emissiveIntensity = lerp(0.22, 1.2, nightK); if (MT.banner) MT.banner.emissiveIntensity = nightK * 0.35; if (MT.stopPanel) MT.stopPanel.emissiveIntensity = lerp(0.3, 1.1, nightK); if (MT.roundel) MT.roundel.emissiveIntensity = lerp(0.4, 1.4, nightK); if (SAILM) SAILM.emissiveIntensity = nightK * 0.42;
        if (MT.inlay) MT.inlay.emissiveIntensity = nightK * 0.7; if (MT.lamp) MT.lamp.emissiveIntensity = lerp(0.05, 2.6, nightK); if (MT.ledB) MT.ledB.emissiveIntensity = lerp(0.3, 2.4, nightK); if (MT.heat) MT.heat.emissiveIntensity = nightK * 1.6; if (MT.mastGlow) MT.mastGlow.opacity = nightK * 0.85;
        var gv = nightK > 0.02; (AR.parts.glow || []).forEach(function (m) { if (m && m.visible !== gv) m.visible = gv; }); } }
    try { crewFrame(Math.min(0.1, dt || 0.016)); } catch (e) { if (!AR.ce) { AR.ce = 1; note("crew", e); } }
    if ((FRAME_N % 15) === 9) { try { stampFrame(); } catch (e) {} }
    if (camera && AR.parts.sock && Math.hypot(camera.position.x - AR.parts.sock.piv.position.x, camera.position.z - AR.parts.sock.piv.position.z) < 260) { try { sockFrame(now); } catch (e) {} }
    try { frame18(dt, now); } catch (e) { if (!AR.fe18) { AR.fe18 = 1; note("frame r18", e); } }
    if ((FRAME_N % 3) === 1) { try { totemFrame(); } catch (e) {} if (AR.model && AR.model.halo) { var s = 1 + 0.35 * Math.sin(now / 300); AR.model.halo.scale.set(s, s, s); } }
  }
  HK.world.push({ name: "arrivalsWorld", fn: function () { try { if (window.PLAN && ON.court) courtPlace(); } catch (e) { note("world court", e); } try { if (window.PLAN && ON.court) doorPlace(); } catch (e) { note("world door", e); } try { if (window.PLAN && ON.court) blvdPlace(); } catch (e) { note("world blvd", e); } try { if (window.PLAN && ON.apron) apronPlace(); } catch (e) { note("world apron", e); } try { if (window.PLAN) place18(); } catch (e) { note("world r18", e); } } });
  HK.world.unshift({ name: "arrivalsWorldEarly", fn: function () { try { worldEarly(); } catch (e) { note("worldEarly", e); } } });
  HK.defer.unshift({ name: "arrivalsDeferEarly", fn: function () { try { deferEarly(); } catch (e) { note("deferEarly", e); } } });
  HK.defer.push({ name: "arrivalsDefer", fn: function () { try { defer(); } catch (e) { note("defer", e); } } });
  HK.frame.push({ name: "arrivalsFrame", fn: function (dt, now) { try { frame(dt, now); } catch (e) { if (!AR.fe) { AR.fe = 1; note("frame", e); } } } });
  AR.debug = { k2w: k2w, w2k: w2k, t2w: t2w, w2t: w2t, K: K, T: T, CRT: CRT };
})();
