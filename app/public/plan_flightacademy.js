// R17 (Agent A, 5 Oct 2026): THE GENESIS ONE FLIGHT ACADEMY on the Flight Line (S2_APRON), between the Flight Line Taxilane and
// Hangar Lane, south-west of the Flight Line Row hangar homes. HANDOFF_R17_ACADEMY.md.
//   - a glass and steel training hangar (sandstone plinth, warm metal panels, clerestory glass, stacking glass doors, a roof that
//     lifts toward the apron over a timber soffit, the academy's name lit in the fascia), and a ground-school wing beside it:
//     dispatch (the counter, the flight board, the logbook stand), the briefing room with the big wall chart of the field and the
//     lesson route, a classroom, the pilot lounge, and the heritage wall (Douglas Municipal Airport, 1928);
//   - the academy apron (concrete panels, tie-downs, taxi lines) opening onto the Flight Line Taxilane, three generic high-wing
//     trainers on tie-downs with chocks, a fourth in the hangar, a fuel truck, a windsock in a segmented circle; the landside
//     forecourt on Hangar Lane with golf-cart parking, the monument sign, benches, lamps and desert planting;
//   - three sim pods in the hangar's Sim Center: E at a pod starts a "lesson" in the existing flight experience (PLAN_FLIGHT,
//     plan_flight.js): the sim boards Giveback One, the tug lines it up on Runway 03, you fly the nine gates and land on 21; when
//     the flight ends the tug puts the jet back on its stand and you are back at the pod with a debrief and a logbook entry;
//   - people: Maya Torres (chief flight instructor) in the hangar and Sam Whitfield at dispatch (talk cards), a few students who
//     roam the apron, the classrooms and the lounge (PLAN_ROAM); sittable chairs, sofas and desks; the pilot logbook (E at the
//     stand) with the stamp chain 389 to 394 awarded through PLAN_PROGRESS.award("stamp", { id }).
// Classic script, loaded before plan_fill_a.js and client.js: the terrain hook grades the pad and the apron and registers the
// keep-out (planKeepout) before the fill modules plant; the world hook clears the lot, adds the hub, zone, info points, solids,
// staff and overrides; the defer hook builds everything (behind the loading screen, merged by material: one shared standard
// program family, glass, and one glow material); the frame hook animates and runs the lesson. No new real lights: lamps are
// sources for the client's light pool. ?fa2=0 turns the module off. window.PLAN_FLIGHTACADEMY: n, errs, cfg, site, api, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_FLIGHTACADEMY = window.PLAN_FLIGHTACADEMY || { v: "r17-0", errs: [], n: {} };
(function () {
  "use strict";
  var FA = window.PLAN_FLIGHTACADEMY; FA.v = "r17a-1"; FA.errs = FA.errs || []; FA.n = FA.n || {};
  if (/[?&]fa2=0\b/.test(location.search)) { FA.off = true; return; }
  var PI = Math.PI, TAU = PI * 2;
  function note(tag, e) { try { if (FA.errs.length < 50) FA.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (FA.errs.length <= 6) console.warn("plan_flightacademy " + tag, e); } catch (x) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function nowMs() { return performance.now(); }
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function has(k) { try { return !!(MODELS[k] && (MODELS[k].parts || MODELS[k]._pp)); } catch (e) { return false; } }
  function canPut(k) { try { return !!MODEL_SPECS[k]; } catch (e) { return false; } }
  function $id(id) { return document.getElementById(id); }
  function qual() { try { return localStorage.getItem("g1:quality") || "high"; } catch (e) { return "high"; } }
  var Q = qual(), ULTRA = Q === "ultra", HIGHQ = Q === "ultra" || Q === "high", LOWQ = Q === "low";
  FA.tier = Q;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function au(u) { try { if (window.AV) return window.AV(u); } catch (e) {} return u; }
  function award(id) { try { if (window.PLAN_PROGRESS && typeof PLAN_PROGRESS.award === "function") { var had = FA.got[id]; FA.got[id] = 1; if (!had) FA.n["stamp_" + id] = Math.round(nowMs()); return PLAN_PROGRESS.award("stamp", { id: id }); } } catch (e) { note("award " + id, e); } return 0; }
  FA.got = FA.got || {};
  function hasStamp(id) { try { if (FA.got[id]) return true; var st = PLAN_PROGRESS && PLAN_PROGRESS.state ? PLAN_PROGRESS.state() : null; return !!(st && st.stamps && st.stamps.indexOf(id) >= 0); } catch (e) { return !!FA.got[id]; } }
  function status(t) { try { if (typeof setStatus === "function") setStatus(t); } catch (e) {} }

  // ───────────────────────── config: plan/flightacademy.json ─────────────────────────
  var CFG = FA.cfg || null;
  function cfgUrl() { return au("/plan/flightacademy.json?v=" + (window.BUILD || "dev")); }
  if (!CFG) { try { fetch(cfgUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && !CFG) CFG = FA.cfg = d; }).catch(function (e) { note("cfg fetch", e); }); } catch (e) { note("cfg", e); } }
  function cfg() { if (CFG) return CFG; try { var x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = FA.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); } return CFG; }
  function C(path, dflt) { var o = cfg(); if (!o) return dflt; var p = path.split("."); for (var i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }

  // ───────────────────────── the site frame ─────────────────────────
  // Local frame: x along Runway 03/21 toward the north-east (the runway's direction u), z toward the taxilane and the runway
  // (south-east, p); y up from the pad G. A group at (cx, G, cz) with rotation.y = Y maps local (x, y, z) to the world.
  var SITE = FA.site = FA.site || null;
  function resolveSite() {
    if (SITE) return SITE; var P = window.PLAN; if (!P || !P.runway) return null;
    var ne = P.runway.ne, sw = P.runway.sw, dx = ne[0] - sw[0], dz = ne[1] - sw[1], L = Math.hypot(dx, dz);
    var u = [dx / L, dz / L], p = [-u[1], u[0]], mid = [(ne[0] + sw[0]) / 2, (ne[1] + sw[1]) / 2];
    var s = C("site", {}) || {}; var a0 = s.a !== undefined ? s.a : -452, c0 = s.c !== undefined ? s.c : -158;
    var S = { u: u, p: p, mid: mid, a0: a0, c0: c0, cx: mid[0] + u[0] * a0 + p[0] * c0, cz: mid[1] + u[1] * a0 + p[1] * c0, Y: Math.atan2(p[0], p[1]), G: s.pad || 12.75 };
    S.cs = Math.cos(S.Y); S.sn = Math.sin(S.Y);
    // the Flight Line Taxilane centre line in the local frame (plan.json road s2_taxilane), else the survey value
    S.tz = 45.96; try { var tl = (P.roads || []).filter(function (r) { return r.id === (s.taxilane || "s2_taxilane"); })[0]; if (tl && tl.pts && tl.pts.length >= 2) { var q = tl.pts[0]; var c = (q[0] - mid[0]) * p[0] + (q[1] - mid[1]) * p[1]; S.tz = c - c0; S.tw = tl.width || 15; } } catch (e) { note("taxilane", e); }
    S.tw = S.tw || 15; S.tEdge = S.tz - S.tw / 2;
    // the layout (local metres)
    S.H = { x0: 4, x1: 44, z0: -27, z1: -1, eaveB: 9.6, eaveF: 12.2, door: [8, 40], doorH: 9.2, ov: 3.6 };     // the hangar
    S.W = { x0: -46, x1: 4, z0: -27, z1: -11, h: 4.6, par: 5.3, canopy: -7.4 };                              // the school wing
    S.rooms = { lobby: [-8, 4], brief: [-20, -8], class: [-33, -20], lounge: [-46, -33] };
    S.A = { x0: -58, x1: 47, z0: -1, z1: 32, thr: [-31, 11] };                                                  // the apron and the throat to the taxilane
    S.F = { x0: -14, x1: 34, z0: -37.6, z1: -27 };                                                             // the landside forecourt
    S.planes = [[-41, 17.5], [-27, 17.5], [-13, 17.5]];                                                         // tie-down spots (nose toward the taxilane)
    S.hplane = [24, -9.5];                                                                                     // the trainer in the hangar
    S.pods = [[12, -22.4], [20, -22.4], [28, -22.4]];                                                           // sim pods (door toward +z)
    S.sock = [-61.5, 21.0]; S.fuel = [39.5, 12.5]; S.hub = [10, -40]; S.hdoor = [-19.6, -17.2];
    return (SITE = FA.site = S);
  }
  function l2w(x, z) { var S = SITE; return [S.cx + x * S.cs + z * S.sn, S.cz - x * S.sn + z * S.cs]; }
  function w2l(x, z) { var S = SITE, dx = x - S.cx, dz = z - S.cz; return [dx * S.cs - dz * S.sn, dx * S.sn + dz * S.cs]; }
  function wyaw(f) { return SITE.Y + (f || 0); }
  function inRect(x, z, r, m) { m = m || 0; return x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m; }
  // the lot in local coordinates: buildings, apron (with the throat), forecourt; the keep-out polygon follows it
  function lotPolyL() { var S = SITE, A = S.A, F = S.F;
    return [[A.x0 - 6, -31], [S.W.x0 - 2, -31], [F.x0, -31.5], [F.x0, F.z0], [F.x1 + 8, F.z0], [A.x1 + 1, -29.5], [A.x1 + 1, A.z1 + 1], [A.thr[1] + 7, A.z1 + 1], [A.thr[1], S.tEdge + 0.3], [A.thr[0], S.tEdge + 0.3], [A.thr[0] - 7, A.z1 + 1], [A.x0 - 6, A.z1 + 1]]; }
  function inPolyL(poly, x, z) { var c = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
  function inLotL(x, z) { return inPolyL(SITE.lot || (SITE.lot = lotPolyL()), x, z); }
  function inLotW(x, z) { var q = w2l(x, z); return inLotL(q[0], q[1]); }
  function inBldgL(x, z, m) { var S = SITE; return inRect(x, z, S.H, m) || inRect(x, z, S.W, m); }
  // the walls: inside the hangar or the wing (people, the camera, the zone)
  function insideL(x, z) { var S = SITE; return inRect(x, z, S.H, -0.35) || inRect(x, z, S.W, -0.35); }
  // the apron surface height (local y above G): level at the buildings, rising or falling linearly to the taxilane's own surface
  function apronY(x, z) { var S = SITE; if (!S.tY) return 0; var k = clamp((z - S.A.z0) / Math.max(1, S.tEdge - S.A.z0), 0, 1); var tY = S.tY(x); return (tY - S.G) * k; }

  // ───────────────────────── geometry kit: parts per material, one merged mesh each (as the body shop and the convention) ─────────────────────────
  var _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1);
  var _cc = {};
  function rgb(c) { if (Array.isArray(c)) return c; if (typeof c === "number" || typeof c === "string") { var k = String(c); if (_cc[k]) return _cc[k]; var q = new THREE.Color(c); return (_cc[k] = [q.r, q.g, q.b]); } return [1, 1, 1]; }
  function Kit() { this.m = {}; this.tris = 0; this.sol = []; }
  Kit.prototype.add = function (b, g, col, m4) {
    if (g.index) g = g.toNonIndexed(); if (m4) g.applyMatrix4(m4); if (!g.attributes.normal) g.computeVertexNormals();
    var n = g.attributes.position.count; if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.color) { var c = rgb(col === undefined ? 0xffffff : col), ca = new Float32Array(n * 3); for (var i = 0; i < n; i++) { ca[i * 3] = c[0]; ca[i * 3 + 1] = c[1]; ca[i * 3 + 2] = c[2]; } g.setAttribute("color", new THREE.BufferAttribute(ca, 3)); }
    (this.m[b] || (this.m[b] = [])).push(g); this.tris += n / 3; return g; };
  Kit.prototype.place = function (b, g, col, x, y, z, ry, rx, rz, sx, sy, sz) { _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(x || 0, y || 0, z || 0), _q, _v2.set(sx || 1, sy || 1, sz || 1)); return this.add(b, g, col, _m4); };
  // a box by its size and centre (y = its base unless yc); t = texture tile size in metres (world-scaled UVs)
  Kit.prototype.box = function (b, col, w, h, d, x, y, z, ry, t, rx, rz) { var g = new THREE.BoxGeometry(w, h, d); uvBox(g, w, h, d, t || 1); g.translate(0, h / 2, 0); return this.place(b, g, col, x, y, z, ry, rx, rz); };
  Kit.prototype.boxc = function (b, col, w, h, d, x, y, z, ry, t, rx, rz) { var g = new THREE.BoxGeometry(w, h, d); uvBox(g, w, h, d, t || 1); return this.place(b, g, col, x, y, z, ry, rx, rz); };
  Kit.prototype.cyl = function (b, col, r0, r1, h, x, y, z, seg, open, ry, rx, rz) { var g = new THREE.CylinderGeometry(r0, r1, h, seg || 12, 1, !!open); return this.place(b, g, col, x, y, z, ry, rx, rz); };
  Kit.prototype.sph = function (b, col, r, x, y, z, seg, sx, sy, sz) { return this.place(b, new THREE.SphereGeometry(r, seg || 10, Math.max(5, (seg || 10) >> 1)), col, x, y, z, 0, 0, 0, sx, sy, sz); };
  Kit.prototype.tube = function (b, A, B, r, seg, r2, col) { var d = new THREE.Vector3().subVectors(B, A), L = d.length(); if (!(L > 1e-4)) return null; var g = new THREE.CylinderGeometry(r2 === undefined ? r : r2, r, L, seg || 8, 1, true); var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); var m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)); return this.add(b, g, col, m); };
  Kit.prototype.plane = function (b, col, w, h, x, y, z, ry, rx, uv) { var g = new THREE.PlaneGeometry(w, h); if (uv) { var U = g.attributes.uv; for (var i = 0; i < U.count; i++) U.setXY(i, uv[0] + U.getX(i) * (uv[2] - uv[0]), uv[1] + U.getY(i) * (uv[3] - uv[1])); } return this.place(b, g, col, x, y, z, ry, rx); };
  // a solid (collision box) in the local frame: x, z centre, w (along x), d (along z), y0, y1 above the pad, ry local, seat, face
  Kit.prototype.solid = function (x, z, w, d, y0, y1, ry, seat, face, tag) { this.sol.push([x, z, w, d, y0, y1, ry || 0, !!seat, face, tag]); };
  Kit.prototype.merge = function () { var out = {}; for (var k in this.m) { var g = mergeAll(this.m[k]); if (g) out[k] = g; } return out; };
  Kit.prototype.build = function (grp, opts) { opts = opts || {}; var out = [], geos = this.merge(); for (var b in geos) { var mt = MAT(b); if (!mt) { note("base", b); continue; } var me = new THREE.Mesh(geos[b], mt); me.name = "fa2 " + b; me.castShadow = !!opts.cast && !mt.transparent && !mt.userData.noCast; me.receiveShadow = opts.receive !== false && !mt.transparent; me.userData.shSet = true; if (mt.transparent) me.renderOrder = 2; grp.add(me); out.push(me); } this.m = {}; return out; };
  function flipGeo(g) { if (g.index) g = g.toNonIndexed(); var A = g.attributes, n = A.position.count; for (var k in A) { var a = A[k], s2 = a.itemSize, arr = a.array; for (var t = 0; t + 2 < n; t += 3) for (var c = 0; c < s2; c++) { var i1 = (t + 1) * s2 + c, i2 = (t + 2) * s2 + c, v = arr[i1]; arr[i1] = arr[i2]; arr[i2] = v; } } g.computeVertexNormals(); return g; }
  function mergeAll(list) {
    if (!list || !list.length) return null; var n = 0; list.forEach(function (g) { n += g.attributes.position.count; }); if (!n) return null;
    var P = new Float32Array(n * 3), N = new Float32Array(n * 3), Uu = new Float32Array(n * 2), Cc = new Float32Array(n * 3), o = 0;
    list.forEach(function (g) { var c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); Uu.set(g.attributes.uv.array, o * 2); if (g.attributes.color) Cc.set(g.attributes.color.array, o * 3); else Cc.fill(1, o * 3, (o + c) * 3); o += c; g.dispose(); });
    var r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(Uu, 2)); r.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
    r.computeBoundingBox(); r.computeBoundingSphere(); return r; }
  // world-scaled box UVs: each face spans its size / t
  function uvBox(g, w, h, d, t) { var uv = g.attributes.uv; var dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (var f = 0; f < 6; f++) for (var k = 0; k < 4; k++) { var i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } }
  // a flat quad from four corners (counter-clockwise seen from the front), UVs in metres / t
  function quad(A, B, Cc, D, t, uvs) { var g = new THREE.BufferGeometry(); var p = [A, B, Cc, A, Cc, D]; var P = new Float32Array(18); for (var i = 0; i < 6; i++) { P[i * 3] = p[i][0]; P[i * 3 + 1] = p[i][1]; P[i * 3 + 2] = p[i][2]; } g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    var U = new Float32Array(12); if (uvs) { var q = [uvs[0], uvs[1], uvs[2], uvs[0], uvs[2], uvs[3]]; for (var j = 0; j < 6; j++) { U[j * 2] = q[j][0]; U[j * 2 + 1] = q[j][1]; } } else { var e1 = _v1.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]), L1 = e1.length(); e1.normalize(); var e2 = _v2.set(D[0] - A[0], D[1] - A[1], D[2] - A[2]); var nn = new THREE.Vector3().crossVectors(e1, e2).normalize(); var e3 = new THREE.Vector3().crossVectors(nn, e1); for (var k = 0; k < 6; k++) { var v = _v3.set(p[k][0] - A[0], p[k][1] - A[1], p[k][2] - A[2]); U[k * 2] = v.dot(e1) / (t || 1); U[k * 2 + 1] = v.dot(e3) / (t || 1); } void L1; }
    g.setAttribute("uv", new THREE.BufferAttribute(U, 2)); g.computeVertexNormals(); return g; }

  // ───────────────────────── materials: one standard family (map + normal + roughness + emissive maps + vertex colours), glass, glow ─────────────────────────
  // Every opaque material carries all four maps (the untextured ones get 1 px flats), so the whole academy compiles one program
  // (plus its R16 building-material variant on high and ultra) instead of one per combination of maps.
  var MATS = FA.mats = FA.mats || {};
  var FLAT = null;
  function flats() { if (FLAT) return FLAT; var mk = function (r, g, b, srgb) { var t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.userData.avShared = true; return t; };
    FLAT = { map: mk(255, 255, 255, true), nrm: mk(128, 128, 255), rgh: mk(255, 255, 255), blk: mk(0, 0, 0, true) }; return FLAT; }
  var TXC = {};
  function TX(name, rep, srgb) {   // a client texture (TEX.*) or /tex/<file>, on its shared source, with its own repeat
    // always through the client's loader by file (one shared source per file, the KTX2 path on desktop), never a clone of a TEX
    // entry: a clone made before its image arrives is never uploaded (it renders black)
    var key = name + ":" + rep; if (TXC[key]) return TXC[key]; var t = null; var file = name.replace(/([a-z])([A-Z])/g, function (m, a, b) { return a + "_" + b.toLowerCase(); }).replace(/_N$/i, "_n").replace(/_R$/i, "_r");
    try { t = (typeof texLoader0 !== "undefined" ? texLoader0 : new THREE.TextureLoader()).load("/tex/" + file + ".jpg"); } catch (e) { note("tex " + name, e); return null; } t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / rep, 1 / rep); t.anisotropy = ULTRA ? 16 : 8; t.needsUpdate = true; t.userData.avShared = true; TXC[key] = t; return t; }
  function std(name, o) {   // o: color, rough, metal, map/nrm/rgh [texture name, tile metres], nk (normal strength), emis, emisMap, env
    var F = flats(); var p = { color: o.color === undefined ? 0xffffff : o.color, roughness: o.rough === undefined ? 0.85 : o.rough, metalness: o.metal || 0, vertexColors: true,
      map: F.map, normalMap: F.nrm, roughnessMap: F.rgh, emissiveMap: F.blk, emissive: 0x000000 };
    if (!LOWQ || o.lowTex) { if (o.map) { var t1 = TX(o.map[0], o.map[1], true); if (t1) p.map = t1; } if (o.nrm) { var t2 = TX(o.nrm[0], o.nrm[1], false); if (t2) p.normalMap = t2; } if (o.rgh) { var t3 = TX(o.rgh[0], o.rgh[1], false); if (t3) p.roughnessMap = t3; } }
    if (o.emis !== undefined) { p.emissive = o.emis; p.emissiveIntensity = o.ei === undefined ? 1 : o.ei; p.emissiveMap = o.emisMap || F.map; }
    var m = new THREE.MeshStandardMaterial(p); m.name = "fa2_" + name; m.normalScale = new THREE.Vector2(o.nk || 0.8, o.nk || 0.8); if (o.env !== undefined) m.envMapIntensity = o.env;
    if (o.side) m.side = o.side; m.userData.avShared = true; if (o.noCast) m.userData.noCast = true; if (o.noBm) m.userData.noBm = true; return m; }
  function MAT(b) { if (MATS[b]) return MATS[b]; var m = null, F = flats();
    switch (b) {
      case "apron": m = std("apron_concrete", { color: 0xd2ccc0, rough: 1, map: ["apron", 6], nrm: ["apronN", 6], rgh: ["apronR", 6], nk: 0.55, lowTex: true }); break;
      case "walk": m = std("walk_pavers", { color: 0xd9cdb8, rough: 1, map: ["travertine", 2.4], nrm: ["travertine_n", 2.4], rgh: ["travertine_r", 2.4], nk: 0.6 }); break;
      case "epoxy": m = std("hangar_epoxy", { color: 0x8f969a, rough: 0.34, map: ["apron", 5], nrm: ["apronN", 5], rgh: ["apronR", 5], nk: 0.25, env: 1.3, lowTex: true }); break;
      case "terrazzo": m = std("lobby_terrazzo", { color: 0xf2ece2, rough: 0.5, map: ["terrazzo", 2.2], nrm: ["terrazzo_n", 2.2], rgh: ["terrazzo_r", 2.2], nk: 0.4, env: 1.1 }); break;
      case "carpet": m = std("carpet", { color: 0x7d8681, rough: 1, nrm: ["jet_carpet_n", 1.6], rgh: ["jet_carpet_r", 1.6], nk: 0.7 }); break;
      case "stucco": m = std("stucco", { color: 0xc9ad8c, rough: 0.95, nrm: ["adobeN", 3.5], rgh: ["adobeR", 3.5], nk: 0.85, lowTex: true }); break;
      case "plaster": m = std("plaster", { color: 0xe9e4da, rough: 0.92, nrm: ["adobeN", 4.5], rgh: ["adobeR", 4.5], nk: 0.25 }); break;
      case "stone": m = std("sandstone", { color: 0xe0c7a2, rough: 0.9, map: ["travertine", 1.8], nrm: ["travertine_n", 1.8], rgh: ["travertine_r", 1.8], nk: 1.0 }); break;
      case "panel": m = std("metal_panel", { color: 0xc9ad86, rough: 0.55, metal: 0.35, map: ["corrugated", 2.2], nrm: ["corrugatedN", 2.2], rgh: ["corrugatedR", 2.2], nk: 0.8, lowTex: true }); break;
      case "roof": m = std("roof_seam", { color: 0x7a6553, rough: 0.6, metal: 0.4, map: ["corrugated", 3.0], nrm: ["corrugatedN", 3.0], rgh: ["corrugatedR", 3.0], nk: 0.7 }); break;
      case "corten": m = std("corten_fascia", { color: 0xa3583a, rough: 0.78, metal: 0.25, map: ["corrugated", 4.0], nrm: ["corrugatedN", 4.0], rgh: ["corrugatedR", 4.0], nk: 0.3 }); break;
      case "steel": m = std("steel_frame", { color: 0x2e3236, rough: 0.42, metal: 0.65, env: 1.1 }); break;
      case "steelL": m = std("steel_light", { color: 0x9aa1a7, rough: 0.35, metal: 0.8, env: 1.2 }); break;
      case "wood": m = std("timber_soffit", { color: 0xc58f5e, rough: 0.75, map: ["wood", 1.6], nrm: ["woodN", 1.6], rgh: ["woodR", 1.6], nk: 0.8 }); break;
      case "walnut": m = std("walnut", { color: 0x8a6448, rough: 0.5, map: ["wood", 0.9], nrm: ["woodN", 0.9], rgh: ["woodR", 0.9], nk: 0.6, env: 1.0 }); break;
      case "leather": m = std("leather", { color: 0xb07a52, rough: 0.6, map: ["jetLeather", 0.8], nrm: ["jet_leather_n", 0.8], rgh: ["jet_leather_r", 0.8], nk: 0.8 }); break;
      case "fabric": m = std("fabric", { color: 0x8d9893, rough: 0.95, nrm: ["jet_carpet_n", 0.5], nk: 0.6 }); break;
      case "white": m = std("composite", { color: 0xf1f2f0, rough: 0.32, env: 1.1 }); break;
      case "paint": m = std("aircraft_paint", { color: 0xffffff, rough: 0.28, metal: 0.05, env: 1.25 }); break;
      case "livery": m = std("aircraft_livery", { color: 0xffffff, rough: 0.26, metal: 0.05, env: 1.25 }); m.map = liveryTex(); break;
      case "dark": m = std("rubber", { color: 0x1c1d1f, rough: 0.85 }); break;
      case "matte": m = std("matte", { color: 0xffffff, rough: 0.9 }); break;
      case "chrome": m = std("chrome", { color: 0xd4d8dc, rough: 0.16, metal: 1.0, env: 1.4 }); break;
      case "gravel": m = std("dg_gravel", { color: 0xcaa982, rough: 1, map: ["gfx_gravel", 2.0], nrm: ["gfx_gravel_n", 2.0], nk: 1.0 }); break;
      case "decal": m = std("decal", { color: 0xffffff, rough: 0.5 }); m.map = atlasTex(); break;
      case "screen": m = std("screen", { color: 0x111111, rough: 0.25, emis: 0xffffff, ei: 1.0, emisMap: atlasTex() }); m.map = atlasTex(); m.userData.noCast = true; break;
      case "lampE": m = std("lamp_lens", { color: 0xfff3dc, rough: 0.3, emis: 0xffd9a0, ei: 0.0 }); m.userData.noCast = true; break;
      case "chart": m = std("wall_chart", { color: 0xffffff, rough: 0.7, emis: 0xffffff, ei: 0.0, emisMap: F.map }); m.map = chartTex(); m.emissiveMap = m.map; m.userData.noCast = true; break;
      case "photo": m = std("heritage_photo", { color: 0xffffff, rough: 0.6 }); m.map = photoTex(); m.userData.noCast = true; photoFile(m); break;
      case "mark": m = std("paint_marks", { color: 0xffffff, rough: 0.7 }); m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; m.userData.noCast = true; break;
      case "poster": m = std("print", { color: 0xffffff, rough: 0.6 }); m.map = postTex(); m.userData.noCast = true; break;
      case "postE": m = std("print_lit", { color: 0x222222, rough: 0.3, emis: 0xffffff, ei: 0.9, emisMap: postTex() }); m.map = postTex(); m.userData.noCast = true; break;
      case "rugm": m = std("rug", { color: 0xffffff, rough: 1, nrm: ["jet_carpet_n", 0.4], nk: 0.7 }); m.map = postTex(); break;
      case "ctile": m = std("carpet_tile", { color: 0xffffff, rough: 1, nrm: ["jet_carpet_n", 0.5], rgh: ["jet_carpet_r", 0.5], nk: 0.6 }); m.map = ctileTex(); break;
      case "ceil": m = std("acoustic_tile", { color: 0xffffff, rough: 0.95 }); m.map = ceilTex(); m.normalMap = ceilNrm(); m.normalScale = new THREE.Vector2(0.9, 0.9); break;
      case "slat": m = std("oak_slat", { color: 0xffffff, rough: 0.62, nrm: ["woodN", 0.9], rgh: ["woodR", 0.9], nk: 0.7 }); break;
      case "felt": m = std("acoustic_felt", { color: 0x2b2c2e, rough: 1, nrm: ["jet_carpet_n", 0.6], nk: 0.8 }); break;
      case "brass": m = std("brass", { color: 0xc9a45e, rough: 0.28, metal: 1, env: 1.3 }); break;
      case "leaf": m = std("leaf", { color: 0xffffff, rough: 0.55 }); break;
      case "glass": m = new THREE.MeshStandardMaterial({ color: 0x9fb6c2, roughness: 0.04, metalness: 0.15, transparent: true, opacity: 0.26, depthWrite: false, envMapIntensity: 1.5 }); m.name = "fa2_glass"; m.userData.avShared = true; break;
      case "glassD": m = new THREE.MeshStandardMaterial({ color: 0x24303a, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.62, depthWrite: false, envMapIntensity: 1.6 }); m.name = "fa2_glass_tint"; m.userData.avShared = true; break;
      case "glow": m = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff, fog: true }); m.name = "fa2_glow"; m.userData.avShared = true; break;
      case "halo": m = new THREE.MeshBasicMaterial({ map: haloTex(), color: 0xffc98a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }); m.name = "fa2_halo"; m.userData.avShared = true; break;
      default: return null; }
    if (/^(apron|walk|gravel|mark|epoxy|terrazzo|carpet|ctile|rugm|ceil|felt)$/.test(b)) m.userData.noCast = true;
    MATS[b] = m; return m; }
  function haloTex() { if (FA.haloT) return FA.haloT; var c = document.createElement("canvas"); c.width = c.height = 64; var x = c.getContext("2d"); var g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64); var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.userData.avShared = true; FA.haloT = t; return t; }
  // the R16 building-material pass (plan_bmat.js) on every opaque academy material: detail layer, macro tone, grime, dust, Fresnel glass
  function bmat() { var B = window.PLAN_BMAT; if (!B || B.off || typeof B.patchMat !== "function") return 0; var n = 0; for (var k in MATS) { var m = MATS[k]; if (!m || m.userData.noBm || m.isMeshBasicMaterial) continue; if (k === "screen" || k === "lampE" || k === "chart" || k === "photo" || k === "decal" || k === "glow" || k === "halo" || k === "poster" || k === "postE" || k === "rugm") continue; try { n += B.patchMat(m, { det: k === "paint" || k === "livery" || k === "chrome" || k === "white" ? 0.35 : 1, dust: k !== "epoxy" && k !== "terrazzo" && k !== "carpet", grime: k !== "paint" && k !== "livery" && k !== "white" }) || 0; } catch (e) { note("bmat " + k, e); } } FA.n.bm = n; return n; }

  // ───────────────────────── terrain hook: the pad, the apron grade, the keep-out, the engine's own planting and props ─────────────────────────
  var H0 = null;   // the original terrain under the taxilane edge (the apron meets the taxilane's own surface)
  function gridH(x, z) { try { return sampleGrid(H, T, x, z); } catch (e) { return getH(x, z); } }
  // the drawn surface of the lot (world y): G under the buildings, the forecourt and the walks; the apron grade on the apron
  function surfL(x, z) { var S = SITE; if (z > S.A.z0 - 0.01 && !inBldgL(x, z, 0.05) && z > S.W.canopy - 0.01) return S.G + apronY(x, z); return S.G; }
  FA.surf = function (x, z) { var q = w2l(x, z); return surfL(q[0], q[1]); };
  function terrainHook() {
    if (FA.off || !window.PLAN) return; var S = resolveSite(); if (!S) return; var t0 = nowMs();
    try { clearLot(); } catch (e) { note("clear terrain", e); }
    // the taxilane's surface along its north-west edge, from the terrain before any grading (the ribbon is drawn at the ground + 0.3)
    try { var TL = []; for (var x = S.A.x0 - 20; x <= S.A.x1 + 20; x += 2) { var w = l2w(x, S.tEdge); TL.push(getH(w[0], w[1]) + 0.3); } var x00 = S.A.x0 - 20; S.tY = function (x) { var f = clamp((x - x00) / 2, 0, TL.length - 1.001), i = Math.floor(f), k = f - i; return lerp(TL[i], TL[i + 1], k); }; H0 = TL; } catch (e) { note("taxilane surface", e); S.tY = function () { return S.G; }; }
    // one level pad under the buildings and the forecourt, the apron graded to meet the taxilane; 12 m blend outside the lot
    try { if (typeof H !== "undefined" && H && T) { var cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1), blend = 12, cnt = 0, lot = S.lot = lotPolyL();
        var bb = [1e9, -1e9, 1e9, -1e9]; lot.forEach(function (q) { var w = l2w(q[0], q[1]); bb[0] = Math.min(bb[0], w[0]); bb[1] = Math.max(bb[1], w[0]); bb[2] = Math.min(bb[2], w[1]); bb[3] = Math.max(bb[3], w[1]); });
        var dEdge = function (lx, lz) { var best = 1e9; for (var i = 0, j = lot.length - 1; i < lot.length; j = i++) { var ax = lot[j][0], az = lot[j][1], bx = lot[i][0], bz = lot[i][1], vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1, t = clamp(((lx - ax) * vx + (lz - az) * vz) / L2, 0, 1); var d = Math.hypot(lx - ax - vx * t, lz - az - vz * t); if (d < best) best = d; } return best; };
        for (var r = Math.max(0, Math.floor((bb[2] - blend - 2 - T.zmin) / ch)); r <= Math.min(T.rows - 1, Math.ceil((bb[3] + blend + 2 - T.zmin) / ch)); r++) for (var c = Math.max(0, Math.floor((bb[0] - blend - 2 - T.xmin) / cw)); c <= Math.min(T.cols - 1, Math.ceil((bb[1] + blend + 2 - T.xmin) / cw)); c++) {
          var wx = T.xmin + c * cw, wz = T.zmin + r * ch, q = w2l(wx, wz); if (q[1] > S.tEdge - 0.8) continue;   // never under the taxilane ribbon
          var inL = inPolyL(lot, q[0], q[1]); var d = inL ? 0 : dEdge(q[0], q[1]); if (d >= blend) continue;
          var qx = clamp(q[0], S.A.x0 - 6, S.A.x1 + 1), qz = clamp(q[1], -37.6, S.tEdge); var target = surfL(qx, qz) - 0.12; var k = inL ? 1 : 1 - sstep(0, blend, d), vi = r * T.cols + c; H[vi] = H[vi] + (target - H[vi]) * k; cnt++; }
        FA.n.graded = cnt; } } catch (e) { note("grade", e); }
    try { keepEarly(); } catch (e) { note("keepout", e); }
    try { reseat(); } catch (e) { note("reseat", e); }
    try { plantLot(S); } catch (e) { note("plant", e); }
    FA.n.terrainMs = Math.round(nowMs() - t0); }
  // the keep-out: the whole lot (fill groves, features, boulevard palms and the engine's scatter stay out), plus circles for the
  // placement passes; registered by a terrain hook put at the front of the list, before every other module plants
  function keepEarly() { if (FA.off || !window.PLAN || FA.kept) return; var S = resolveSite(); if (!S) return; FA.kept = true; S.lot = S.lot || lotPolyL();
    var wp = S.lot.map(function (q) { return l2w(q[0], q[1]); }); S.lotW = wp; planKeepout(wp); FA.n.keep = 1;
    // a guard on the client's put(): vegetation another module puts inside the lot after this point keeps its entry (callers read it
    // back) but is shrunk to nothing and loses its collider; clearLot drops it before instancing
    try { if (!FA.putW && typeof put === "function") { FA.putW = true; var p0 = put, bx = [1e9, -1e9, 1e9, -1e9]; wp.forEach(function (w) { bx[0] = Math.min(bx[0], w[0]); bx[1] = Math.max(bx[1], w[0]); bx[2] = Math.min(bx[2], w[1]); bx[3] = Math.max(bx[3], w[1]); });
      put = function (kind, x, z) { var r = p0.apply(this, arguments); try { if (!FA.putting && x > bx[0] && x < bx[1] && z > bx[2] && z < bx[3] && VEG.test(kind) && inLotW(x, z)) { var L = PLACE[kind], e = L && L[L.length - 1]; if (e && e[0] === x && e[2] === z) { e[4] = 0.0001; e.fa2h = 1; var c = COLLIDERS[COLLIDERS.length - 1]; if (c && c[0] === x && c[1] === z) COLLIDERS.pop(); FA.n.shrunk = (FA.n.shrunk || 0) + 1; } } } catch (e2) {} return r; }; } } catch (e) { note("put guard", e); } for (var kx = S.A.x0; kx <= S.A.x1; kx += 9) for (var kz = -34; kz <= S.A.z1; kz += 9) { if (!inLotL(kx, kz)) continue; var w2 = l2w(kx, kz); KEEPOUT.push([w2[0], w2[1], 7]); } }
  function reseat() { var S = SITE, n = 0; for (var k in PLACE) { var L = PLACE[k]; for (var i = 0; i < L.length; i++) { var e = L[i]; var q = w2l(e[0], e[2]); if (q[0] < S.A.x0 - 22 || q[0] > S.A.x1 + 22 || q[1] < -52 || q[1] > S.tEdge) continue; var g = getH(e[0], e[2]); if (Math.abs(g - e[1]) > 0.02 && Math.abs(g - e[1]) < 6) { e[1] = g; n++; } } } FA.n.reseated = n; }
  // desert planting, the fuel truck, the golf carts and the lamps, through the engine (instanced with the rest of the world)
  function plantLot(S) { var R = rng(1928), n = 0;
    var put1 = function (k, x, z, rot, sc) { if (!canPut(k)) return null; var w = l2w(x, z); FA.putting = true; try { put(k, w[0], w[1], rot === null ? R() * TAU : rot, sc || 1); } finally { FA.putting = false; } var L = PLACE[k]; var e = L && L[L.length - 1]; if (e) { e.fa2 = 1; e[1] = surfL(x, z); (FA.myPlants = FA.myPlants || []).push([w[0], w[1]]); } n++; return e; };
    // forecourt beds along the rear walls and the lane, palo verde shade, a saguaro at each end
    var low = ["agave_cluster", "yucca_cluster", "barrel_cactus", "ph_succulent_2", "ph_shrub_3"].filter(canPut);
    [[-44, -29.6], [-38, -29.6], [-30, -29.6], [-23, -29.6], [37, -29.6], [41.5, -30.2]].forEach(function (q, i) { put1(low[i % low.length], q[0], q[1], null, 0.8 + R() * 0.3); });
    [[-16.2, -35.2, "saguaro", 1.05], [36.5, -33.5, "saguaro_mid", 1.0], [-52.5, -26.5, "saguaro", 0.95], [48.5, 6, "saguaro_mid", 0.9], [-63.5, 9, "saguaro", 1.0]].forEach(function (q) { put1(q[2], q[0], q[1], null, q[3]); });
    [[-19.5, -33.0], [30.5, -35.2], [-59, -12], [50, -18]].forEach(function (q) { put1("paloverde", q[0], q[1], null, 0.85 + R() * 0.2); });
    [[-56, -21], [-60, -4], [49.5, -8], [50.5, 18], [-62, 30]].forEach(function (q, i) { put1(i % 2 ? "ocotillo" : "yucca_cluster", q[0], q[1], null, 0.9); });
    // the fuel truck by the hangar (the FBO's refueller), parallel to the hangar front
    if (canPut("stellar_fueler")) put1("stellar_fueler", S.fuel[0], S.fuel[1], wyaw(-PI / 2), 1);
    // the tow tug by the hangar door
    if (canPut("stellar_tug")) put1("stellar_tug", 32.5, 5.2, wyaw(PI * 0.72), 1);
    // golf-cart parking on the forecourt, nose to the building
    if (canPut("cart")) [14, 17.2, 20.4, 23.6].forEach(function (x) { put1("cart", x, -33.6, wyaw(PI), 1); });
    // street lamps on the forecourt edge (the client's lamps, pool sources at night)
    if (canPut("lamp")) [[-12, -36.6], [6, -36.6], [26, -36.6]].forEach(function (q) { put1("lamp", q[0], q[1], wyaw(PI), 1); });
    // benches by the entrance (the client makes them sittable)
    if (canPut("bench_lux")) [[-9.2, -31.4, 0], [3.4, -31.4, 0], [-30, -9.2, PI], [-42, -9.2, PI]].forEach(function (q) { put1("bench_lux", q[0], q[1], wyaw(q[2]), 1); });
    FA.n.planted = n; }

  // ───────────────────────── world hook: clearing, hub, zone, info points, staff, overrides ─────────────────────────
  var VEG = /^(bush\d|mesquite|ocotillo|saguaro.*|paloverde|ironwood|desertwillow|barrel_cactus|prickly_pear|cholla|organ_pipe|agave_cluster|yucca_cluster|boulder|ph_(rock|boulder|shrub|succulent|stones|sandrocks)_?\d*|e1_.*|fa_.*|land_(rock|rrock|cholla|organ|pear|sagy).*|canarypalm|datepalm|fanpalm2?)$/;
  function clearLot() { var removed = 0, keys = new Set(), S = SITE;
    var inL = function (x, z) { var q = w2l(x, z); return inLotL(q[0], q[1]) || (q[0] > S.A.x0 - 8 && q[0] < S.A.x1 + 3 && q[1] > -33 && q[1] < S.A.z1 + 2); };
    for (var k in PLACE) { if (!VEG.test(k)) continue; var L = PLACE[k], out = []; for (var i = 0; i < L.length; i++) { var e = L[i]; if ((!e.fa2 && inL(e[0], e[2])) || e.fa2h) { keys.add(Math.round(e[0] * 100) + ":" + Math.round(e[2] * 100)); removed++; } else out.push(e); } if (out.length !== L.length) { L.length = 0; Array.prototype.push.apply(L, out); } }
    if (keys.size) for (var j = COLLIDERS.length - 1; j >= 0; j--) { var c = COLLIDERS[j]; if (keys.has(Math.round(c[0] * 100) + ":" + Math.round(c[1] * 100))) COLLIDERS.splice(j, 1); }
    FA.n.cleared = (FA.n.cleared || 0) + removed; }
  // after the client has instanced PLACE (the defer phase and later), the lists must not change: an entry still inside the lot is
  // hidden by zeroing its packed matrix (the client refills the instance buffers from it) and shrinking it, and its collider goes
  function hideLate() { var S = SITE, n = 0, Z = new Float32Array(16); try { if (typeof INSTSET === "undefined") return 0;
      var O = l2w(-6, 2); INSTSET.forEach(function (I) { if (!I.list || !I.mats || !VEG.test(I.kind)) return; for (var i = 0; i < I.list.length; i++) { var e = I.list[i]; if (!e || e.fa2) continue; if (Math.abs(e[0] - O[0]) > 95 || Math.abs(e[2] - O[1]) > 95) continue; if (!e.fa2h && !inLotW(e[0], e[2])) continue; if (I.mats[i * 16 + 15] === 0) continue;
        I.mats.set(Z, i * 16); e[4] = 0.0001; e.fa2h = 1; n++; for (var j = COLLIDERS.length - 1; j >= 0; j--) { var c = COLLIDERS[j]; if (Math.abs(c[0] - e[0]) < 0.01 && Math.abs(c[1] - e[2]) < 0.01) { COLLIDERS.splice(j, 1); break; } } } });
      if (n) { try { if (typeof updateCulling === "function") updateCulling(true); } catch (e) {} } } catch (e) { note("hide late", e); } FA.n.hidden = (FA.n.hidden || 0) + n; return n; }
  FA.hs = FA.hs || [];
  function hsAdd(key, x, z, r, extra) { var d = C("info." + key, null); if (!d) return null; var w = l2w(x, z); var h = { x: w[0], z: w[1], r: r, t: d.t, k: d.k, p: d.p, fa2: key }; if (extra) for (var k in extra) h[k] = extra[k]; hotspots.push(h); FA.hs.push(h); return h; }
  function worldHook() {
    if (FA.off || !window.PLAN) return; var S = resolveSite(); if (!S) { note("site", "no runway"); return; } var t0 = nowMs();
    try { keepEarly(); clearLot(); } catch (e) { note("clear", e); }
    try { window.PLAN_HOOKS.world.push({ name: "fa2WorldLate", fn: function () { try { clearLot(); } catch (e) { note("clear late", e); } } }); } catch (e) { note("late hook", e); }
    try { var hw = l2w(S.hub[0], S.hub[1]); planAddHub(C("names.academy", "Genesis One Flight Academy"), hw[0], hw[1]); if (typeof planNavCats === "function") planNavCats(); } catch (e) { note("hub", e); }
    try { var poly = S.lotW || S.lot.map(function (q) { return l2w(q[0], q[1]); }); var cw = l2w(-6, 2); zoneRings.push({ name: C("names.academy", "Genesis One Flight Academy"), label: C("names.short", "Flight Academy"), center: cw, r: 62, k: C("names.zone", ""), poly: poly, col: "#4dde6f55", plan: "academy" }); } catch (e) { note("zone", e); }
    try { hsAdd("forecourt", -2, -33.5, 5.5); hsAdd("apron", -27, 27.5, 5); hsAdd("windsock", S.sock[0] + 2.5, S.sock[1] + 2.5, 3.2); hsAdd("fuel", S.fuel[0] - 3.8, S.fuel[1] + 3.2, 3.2); hsAdd("hangar", 24, 3.5, 5); hsAdd("simcenter", 33.5, -17.5, 3.2); hsAdd("briefing", -14, -15.5, 3.2); hsAdd("classroom", -26.5, -13.6, 3.0); hsAdd("lounge", -39.5, -13.4, 3.0); } catch (e) { note("hotspots", e); }
    try { installOverrides(); } catch (e) { note("overrides", e); }
    FA.n.worldMs = Math.round(nowMs() - t0); }

  // ───────────────────────── the exterior: apron, forecourt, hangar shell, school shell, canopy, signs ─────────────────────────
  // All in the group's frame (origin at the site centre on the pad G, x along the runway, z toward the taxilane).
  var GEO = FA.geo = FA.geo || { walk: [] };
  // a slab over a polygon region given as a list of convex quads/rects: the top follows fy(x, z), sides go down `dep`
  function gridTop(K, b, x0, x1, z0, z1, cell, fy, col) {
    var nx = Math.max(1, Math.ceil((x1 - x0) / cell)), nz = Math.max(1, Math.ceil((z1 - z0) / cell)); var P = [], U = [];
    for (var i = 0; i < nx; i++) for (var j = 0; j < nz; j++) { var ax = x0 + (x1 - x0) * i / nx, bx = x0 + (x1 - x0) * (i + 1) / nx, az = z0 + (z1 - z0) * j / nz, bz = z0 + (z1 - z0) * (j + 1) / nz;
      var p00 = [ax, fy(ax, az), az], p10 = [bx, fy(bx, az), az], p11 = [bx, fy(bx, bz), bz], p01 = [ax, fy(ax, bz), bz];
      [p00, p01, p11, p00, p11, p10].forEach(function (q) { P.push(q[0], q[1], q[2]); U.push(q[0], -q[2]); }); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.computeVertexNormals(); K.add(b, g, col); GEO.walk.push(g.clone()); return g; }
  // a quad region with four arbitrary corners (the throat), top on fy, subdivided n x m
  function quadTop(K, b, A, B, Cq, D, n, m, fy, col) { var P = [], U = []; var at = function (u, v) { var x = lerp(lerp(A[0], B[0], u), lerp(D[0], Cq[0], u), v), z = lerp(lerp(A[1], B[1], u), lerp(D[1], Cq[1], u), v); return [x, fy(x, z), z]; };
    for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) { var p00 = at(i / n, j / m), p10 = at((i + 1) / n, j / m), p11 = at((i + 1) / n, (j + 1) / m), p01 = at(i / n, (j + 1) / m); [p00, p01, p11, p00, p11, p10].forEach(function (q) { P.push(q[0], q[1], q[2]); U.push(q[0], -q[2]); }); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.computeVertexNormals();
    // make sure the faces point up
    var pa = g.attributes.position.array; for (var t = 0; t < pa.length; t += 9) { var ux = pa[t + 3] - pa[t], uz = pa[t + 5] - pa[t + 2], vx = pa[t + 6] - pa[t], vz = pa[t + 8] - pa[t + 2]; if (uz * vx - ux * vz < 0) { for (var c = 0; c < 3; c++) { var s = pa[t + 3 + c]; pa[t + 3 + c] = pa[t + 6 + c]; pa[t + 6 + c] = s; } } }
    g.computeVertexNormals(); K.add(b, g, col); GEO.walk.push(g.clone()); return g; }
  // a vertical skirt under an edge (so the slab never shows a gap over the graded ground)
  function skirt(K, b, A, B, fy, dep, col) { var ya = fy(A[0], A[1]), yb = fy(B[0], B[1]); K.add(b, quad([A[0], ya - dep, A[1]], [B[0], yb - dep, B[1]], [B[0], yb, B[1]], [A[0], ya, A[1]], 1), col); }
  function apronFy(x, z) { return apronY(x, z) + 0.0; }
  function buildApron(K) {
    var S = SITE, A = S.A, W = S.W, Hh = S.H, y0 = function () { return 0; };
    // the apron proper: in front of the wing (from the canopy line) and of the hangar (from the door line), the throat to the taxilane
    gridTop(K, "apron", A.x0, Hh.x0, W.canopy, A.z1, 2.6, apronFy);
    gridTop(K, "apron", Hh.x0, A.x1, Hh.z1, A.z1, 2.6, apronFy);
    var t0 = A.thr[0], t1 = A.thr[1], te = S.tEdge + 0.3; quadTop(K, "apron", [t0 - 7, A.z1], [t1 + 7, A.z1], [t1, te], [t0, te], 10, 3, apronFy);
    // skirts on the open edges
    skirt(K, "apron", [A.x0, A.z1], [A.x0, W.canopy], apronFy, 0.45); skirt(K, "apron", [A.x1, Hh.z1], [A.x1, A.z1], apronFy, 0.45);
    skirt(K, "apron", [t0 - 7, A.z1], [A.x0, A.z1], apronFy, 0.45); skirt(K, "apron", [A.x1, A.z1], [t1 + 7, A.z1], apronFy, 0.45);
    skirt(K, "apron", [t0, te], [t0 - 7, A.z1], apronFy, 0.45); skirt(K, "apron", [t1 + 7, A.z1], [t1, te], apronFy, 0.45);
    skirt(K, "apron", [A.x0, W.canopy], [W.x0, W.canopy], apronFy, 0.45);
    // saw-cut joints every 6 m (thin dark lines just over the slab)
    var J = 0x6d6a64, lift = 0.008;
    for (var x = A.x0 + 6; x < A.x1 - 0.5; x += 6) { var zs = x < Hh.x0 ? W.canopy : Hh.z1; for (var z = zs; z < A.z1 - 0.1; z += 3) { var z2 = Math.min(A.z1, z + 3); K.add("mark", quad([x - 0.025, apronFy(x, z) + lift, z], [x - 0.025, apronFy(x, z2) + lift, z2], [x + 0.025, apronFy(x, z2) + lift, z2], [x + 0.025, apronFy(x, z) + lift, z], 1).rotateY(0), J); } }
    for (var z3 = W.canopy + 6; z3 < A.z1 - 0.5; z3 += 6) { for (var x3 = A.x0; x3 < A.x1 - 0.1; x3 += 3) { var x4 = Math.min(A.x1, x3 + 3); if (z3 < Hh.z1 && x3 >= Hh.x0) continue; K.add("mark", quad([x3, apronFy(x3, z3 + 0.025) + lift, z3 + 0.025], [x4, apronFy(x4, z3 + 0.025) + lift, z3 + 0.025], [x4, apronFy(x4, z3 - 0.025) + lift, z3 - 0.025], [x3, apronFy(x3, z3 - 0.025) + lift, z3 - 0.025], 1), J); } }
    // taxi lines: yellow with black borders (US light-pavement practice): the lead-in from the taxilane centre, the apron line, the stands, the hangar line
    var YL = 0xf2c230, BK = 0x18181a; var line = function (pts, w) { for (var i = 0; i < pts.length - 1; i++) { var a = pts[i], b2 = pts[i + 1], dx = b2[0] - a[0], dz = b2[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
        [[w / 2 + 0.1, BK, 0.012], [w / 2, YL, 0.016]].forEach(function (q) { var hw = q[0], yl = q[2]; K.add("mark", quad([a[0] + nx * hw, apronFy(a[0], a[1]) + yl, a[1] + nz * hw], [a[0] - nx * hw, apronFy(a[0], a[1]) + yl, a[1] - nz * hw], [b2[0] - nx * hw, apronFy(b2[0], b2[1]) + yl, b2[1] - nz * hw], [b2[0] + nx * hw, apronFy(b2[0], b2[1]) + yl, b2[1] + nz * hw], 1), q[1]); }); } };
    var cxT = (t0 + t1) / 2; var arc = []; for (var k = 0; k <= 8; k++) { var aa = k / 8 * PI / 2; arc.push([cxT - 6 + 6 * Math.cos(PI / 2 - aa) * 0 + 6 * Math.sin(aa) - 6, A.z1 - 6 + 6 * Math.cos(aa)]); }
    line([[cxT, S.tz], [cxT, A.z1 - 5]], 0.15); line([[A.x0 + 4, A.z1 - 5], [A.x1 - 4, A.z1 - 5]], 0.15);
    S.planes.forEach(function (p) { line([[p[0], A.z1 - 5], [p[0], p[1] - 4.6]], 0.15); line([[p[0] - 1.6, p[1] - 4.6], [p[0] + 1.6, p[1] - 4.6]], 0.15); });
    line([[S.hplane[0], A.z1 - 5], [S.hplane[0], Hh.z1 + 0.2]], 0.15);
    // tie-down rings (three per stand: under each wing strut and the tail) on small painted pads
    S.planes.forEach(function (p) { [[-2.75, 0.15], [2.75, 0.15], [0, -4.6]].forEach(function (o) { var x = p[0] + o[0], z = p[1] + o[1], y = apronFy(x, z); K.place("mark", new THREE.CircleGeometry(0.42, 16).rotateX(-PI / 2), YL, x, y + 0.014, z); K.place("steel", new THREE.TorusGeometry(0.09, 0.018, 6, 12).rotateX(-PI / 2), 0x6a6e72, x, y + 0.03, z); }); });
    // wheeled fire extinguishers between the stands (flight-line practice)
    [[-34, 14.2], [-20, 14.2]].forEach(function (q) { var x = q[0], z = q[1], y = apronFy(x, z); K.cyl("paint", 0xc8281e, 0.17, 0.17, 0.85, x, y + 0.62, z, 14); K.sph("paint", 0xc8281e, 0.17, x, y + 1.05, z, 12, 1, 0.6, 1); K.box("steel", 0x2e3236, 0.5, 0.05, 0.36, x, y + 0.16, z);
      [-0.24, 0.24].forEach(function (o) { K.cyl("dark", 0x1c1d1f, 0.16, 0.16, 0.06, x + o, y + 0.16, z, 12, false, 0, 0, PI / 2); }); K.tube("steel", new THREE.Vector3(x, y + 0.2, z - 0.15), new THREE.Vector3(x, y + 1.15, z - 0.36), 0.015, 5); K.solid(x, z, 0.6, 0.5, y, y + 1.2); });
    // the hangar threshold strip (a steel door track flush in the slab)
    K.box("steelL", 0x8d9296, Hh.door[1] - Hh.door[0], 0.03, 0.22, (Hh.door[0] + Hh.door[1]) / 2, -0.01, Hh.z1 + 0.05);
    // a segmented circle round the windsock (white segments) on the desert ground
    var sk = S.sock; for (var sg = 0; sg < 16; sg++) { var a0 = sg / 16 * TAU, a1 = a0 + TAU / 16 * 0.62; var r0 = 4.3, r1 = 4.75; var P2 = []; for (var st = 0; st <= 3; st++) { var aq = lerp(a0, a1, st / 3); P2.push([Math.cos(aq), Math.sin(aq)]); }
      for (var st2 = 0; st2 < 3; st2++) { var q0 = P2[st2], q1 = P2[st2 + 1]; var yy = function (x, z) { return gridH(l2w(x, z)[0], l2w(x, z)[1]) - SITE.G + 0.1; }; var A1 = [sk[0] + q0[0] * r0, sk[1] + q0[1] * r0], B1 = [sk[0] + q1[0] * r0, sk[1] + q1[1] * r0], C1 = [sk[0] + q1[0] * r1, sk[1] + q1[1] * r1], D1 = [sk[0] + q0[0] * r1, sk[1] + q0[1] * r1];
        K.add("white", quad([A1[0], yy(A1[0], A1[1]), A1[1]], [D1[0], yy(D1[0], D1[1]), D1[1]], [C1[0], yy(C1[0], C1[1]), C1[1]], [B1[0], yy(B1[0], B1[1]), B1[1]], 1), 0xf1efe8); } }
  }
  // the landside forecourt and the airside walk under the wing's canopy (pavers, with a concrete kerb edge)
  function buildWalks(K) { var S = SITE, F = S.F, W = S.W; var flat = function () { return 0; };
    gridTop(K, "walk", F.x0, F.x1, F.z0, F.z1, 4, flat); gridTop(K, "walk", W.x0, W.x1, W.z1, W.canopy, 4, flat);
    // the lounge terrace at the south-west end (pavers round the corner to the apron)
    gridTop(K, "walk", W.x0 - 6, W.x0, -26, W.canopy, 4, flat);
    var kerb = function (ax, az, bx, bz) { var dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); K.box("stone", 0xd8d2c6, L, 0.42, 0.18, (ax + bx) / 2, -0.32, (az + bz) / 2, Math.atan2(-dz, dx), 1); };
    kerb(F.x0, F.z0, F.x1, F.z0); kerb(F.x0, F.z0, F.x0, F.z1); kerb(F.x1, F.z0, F.x1, F.z1); kerb(W.x0 - 6, -26, W.x0 - 6, W.canopy); kerb(W.x0 - 6, -26, W.x0, -26);
    skirt(K, "walk", [F.x1, F.z0], [F.x0, F.z0], flat, 0.4); skirt(K, "walk", [F.x0, F.z0], [F.x0, F.z1], flat, 0.4); skirt(K, "walk", [F.x1, F.z1], [F.x1, F.z0], flat, 0.4);
    // gravel beds (decomposed granite) along the rear walls and the lounge end
    [[-46.5, -30.2, -14.2, -27.2], [34.2, -31.6, 44.2, -27.2], [-63, -27.6, -52.5, -8]].forEach(function (r) { gridTop(K, "gravel", r[0], r[2], r[1], r[3], 3, function () { return 0.02; }); });
  }
  // a rectangle frame of a curtain wall / door leaf: mullions + transoms (steel) and the glass pane
  function glazing(K, x0, x1, y0, y1, z, mullion, trans, glassB, dz) {   // a wall in the plane z = const, from x0 to x1
    var w = x1 - x0, h = y1 - y0, n = Math.max(1, Math.round(w / mullion)), d = dz || 0.12;
    K.box(glassB || "glass", 0xffffff, w, h, 0.03, (x0 + x1) / 2, y0, z);
    for (var i = 0; i <= n; i++) K.box("steel", 0x2e3236, 0.08, h, d, x0 + w * i / n, y0, z);
    (trans || []).forEach(function (ty) { K.box("steel", 0x2e3236, w, 0.08, d, (x0 + x1) / 2, y0 + ty, z); });
    K.box("steel", 0x2e3236, w, 0.1, d + 0.02, (x0 + x1) / 2, y0, z); K.box("steel", 0x2e3236, w, 0.1, d + 0.02, (x0 + x1) / 2, y1 - 0.1, z); }
  function glazingZ(K, z0, z1, y0, y1, x, mullion, trans, glassB) {   // a wall in the plane x = const, from z0 to z1
    var w = z1 - z0, h = y1 - y0, n = Math.max(1, Math.round(w / mullion));
    K.box(glassB || "glass", 0xffffff, 0.03, h, w, x, y0, (z0 + z1) / 2);
    for (var i = 0; i <= n; i++) K.box("steel", 0x2e3236, 0.12, h, 0.08, x, y0, z0 + w * i / n);
    (trans || []).forEach(function (ty) { K.box("steel", 0x2e3236, 0.12, 0.08, w, x, y0 + ty, (z0 + z1) / 2); }); }
  function roofY(z) { var Hh = SITE.H; return Hh.eaveB + (Hh.eaveF - Hh.eaveB) * (z - Hh.z0) / (Hh.z1 - Hh.z0); }
  FA.roofY = roofY;
  function buildHangar(K) {
    var S = SITE, Hh = S.H, x0 = Hh.x0, x1 = Hh.x1, z0 = Hh.z0, z1 = Hh.z1, d0 = Hh.door[0], d1 = Hh.door[1], dh = Hh.doorH, T2 = 0.4;
    // floor: epoxy slab with a sandstone-coloured band at the walls
    K.box("epoxy", 0xffffff, x1 - x0 - 0.5, 0.32, z1 - z0 - 0.25, (x0 + x1) / 2, -0.3, (z0 + z1) / 2 - 0.12);
    GEO.walk.push(new THREE.PlaneGeometry(x1 - x0 - 0.5, z1 - z0 - 0.25).rotateX(-PI / 2).translate((x0 + x1) / 2, 0.02, (z0 + z1) / 2 - 0.12));
    // sandstone plinth (1.2 m) round the rear and the sides, and the two front corner piers
    K.box("stone", 0xffffff, x1 - x0, 1.2, T2 + 0.1, (x0 + x1) / 2, 0, z0 + 0.2, 0); K.box("stone", 0xffffff, T2 + 0.1, 1.2, z1 - z0, x1 - 0.2, 0, (z0 + z1) / 2);
    K.box("stone", 0xffffff, 4.0, 1.2, T2 + 0.1, (x0 + d0) / 2, 0, z1 - 0.2); K.box("stone", 0xffffff, 4.0, 1.2, T2 + 0.1, (x1 + d1) / 2, 0, z1 - 0.2);
    K.solid((x0 + x1) / 2, z0 + 0.2, x1 - x0, T2 + 0.1, 0, 12); K.solid(x1 - 0.2, (z0 + z1) / 2, T2 + 0.1, z1 - z0, 0, 12);
    K.solid((x0 + d0) / 2, z1 - 0.2, d0 - x0, 0.5, 0, 12); K.solid((x1 + d1) / 2, z1 - 0.2, x1 - d1, 0.5, 0, 12);
    // metal panel walls above the plinth: the rear (to the eave), the north-east side (to the sloping roof) with a clerestory band
    K.box("panel", 0xffffff, x1 - x0, Hh.eaveB - 1.2, T2, (x0 + x1) / 2, 1.2, z0 + 0.2);
    K.box("corten", 0xffffff, 15.2, 4.1, 0.16, (x0 + x1) / 2 + 3, 4.75, z0 - 0.06); K.plane("screen", 0xffffff, 14.4, 3.6, (x0 + x1) / 2 + 3, 6.8, z0 - 0.16, PI, 0, atlasUV("academy"));
    var clo = 6.4, chi = 8.2;
    // NE side wall: panels below the clerestory, glass band, panels above it (a quad strip that follows the roof)
    K.box("panel", 0xffffff, T2, clo - 1.2, z1 - z0, x1 - 0.2, 1.2, (z0 + z1) / 2);
    glazingZ(K, z0 + 0.6, z1 - 0.6, clo, chi, x1 - 0.2, 2.6, [], "glass");
    K.add("panel", quad([x1 - 0.0, chi, z0], [x1 - 0.0, chi, z1], [x1 - 0.0, roofY(z1), z1], [x1 - 0.0, roofY(z0), z0], 1)); K.add("panel", quad([x1 - 0.4, chi, z1], [x1 - 0.4, chi, z0], [x1 - 0.4, roofY(z0), z0], [x1 - 0.4, roofY(z1), z1], 1), 0xd8d2c6);
    // SW side wall above the wing's roof (the wing is the lower part): panels with the clerestory band
    var wingTop = S.W.par; K.box("panel", 0xffffff, T2, clo - wingTop, z1 - z0, x0 + 0.2, wingTop, (z0 + z1) / 2);
    glazingZ(K, z0 + 0.6, z1 - 0.6, clo, chi, x0 + 0.2, 2.6, [], "glass");
    K.add("panel", quad([x0, chi, z1], [x0, chi, z0], [x0, roofY(z0), z0], [x0, roofY(z1), z1], 1)); K.add("panel", quad([x0 + 0.4, chi, z0], [x0 + 0.4, chi, z1], [x0 + 0.4, roofY(z1), z1], [x0 + 0.4, roofY(z0), z0], 1), 0xd8d2c6);
    K.solid(x0 + 0.2, (z0 + z1) / 2, 0.45, z1 - z0, S.W.h, 12);
    // the front corners: full-height glass curtain walls on steel, over the plinth
    glazing(K, x0 + 0.2, d0, 1.2, dh, z1 - 0.15, 1.3, [2.6, 5.2], "glass"); glazing(K, d1, x1 - 0.2, 1.2, dh, z1 - 0.15, 1.3, [2.6, 5.2], "glass");
    // the fascia over the door: weathered steel, from the door head to the roof edge, carrying the academy's name
    var fy0 = dh, fy1 = roofY(z1) + 0.55; K.box("corten", 0xffffff, x1 - x0 + 0.3, fy1 - fy0, 0.5, (x0 + x1) / 2, fy0, z1 + 0.05);
    K.box("steel", 0x2e3236, d1 - d0 + 0.6, 0.45, 0.7, (d0 + d1) / 2, dh - 0.45, z1 + 0.05);   // the door header
    // the stacking glass hangar door: six leaves on a top track, three stacked open at each side (21 m clear in the middle)
    var lw = (d1 - d0) / 6; K.box("steel", 0x2e3236, d1 - d0, 0.14, 0.95, (d0 + d1) / 2, dh - 0.6, z1 - 0.56);
    [0, 1, 2].forEach(function (k) { var zz = z1 - 0.3 - k * 0.24; glazing(K, d0 + k * 0.12, d0 + lw + k * 0.12, 0.03, dh - 0.62, zz, lw, [2.9, 5.8], "glass", 0.1); glazing(K, d1 - lw - k * 0.12, d1 - k * 0.12, 0.03, dh - 0.62, zz, lw, [2.9, 5.8], "glass", 0.1); });
    K.solid(d0 + lw / 2 + 0.12, z1 - 0.54, lw + 0.4, 0.8, 0, dh); K.solid(d1 - lw / 2 - 0.12, z1 - 0.54, lw + 0.4, 0.8, 0, dh);
    // the name panel (atlas, lit at night) and the GIVEBACK mark
    var nw = 24, nh = nw / 8; K.plane("screen", 0xffffff, nw, nh, (x0 + x1) / 2 - 2.2, (fy0 + fy1) / 2 + 0.05, z1 + 0.31, 0, 0, atlasUV("fascia"));
    K.plane("decal", 0xffffff, 3.4, 1.7, x1 - 4.6, (fy0 + fy1) / 2 + 0.05, z1 + 0.31, 0, 0, atlasUV("logo"));
    // the roof: a mono-pitch deck lifting toward the apron, overhanging the door by Hh.ov over a timber soffit
    var zo = z1 + Hh.ov, ry0 = roofY(z0), ry1 = roofY(zo), th = 0.55;
    K.add("roof", quad([x0 - 0.3, ry0 + th, z0 - 0.3], [x0 - 0.3, ry1 + th, zo], [x1 + 0.3, ry1 + th, zo], [x1 + 0.3, ry0 + th, z0 - 0.3], 1));
    K.add("roof", quad([x0 - 0.3, ry0, z0 - 0.3], [x1 + 0.3, ry0, z0 - 0.3], [x1 + 0.3, ry1, zo], [x0 - 0.3, ry1, zo], 1), 0x9aa0a4);   // the underside (inside: a light steel deck)
    [[x0 - 0.3, x1 + 0.3]].forEach(function () {});
    K.add("corten", quad([x0 - 0.3, ry1, zo], [x1 + 0.3, ry1, zo], [x1 + 0.3, ry1 + th, zo], [x0 - 0.3, ry1 + th, zo], 1));
    K.add("corten", quad([x1 + 0.3, ry0, z0 - 0.3], [x0 - 0.3, ry0, z0 - 0.3], [x0 - 0.3, ry0 + th, z0 - 0.3], [x1 + 0.3, ry0 + th, z0 - 0.3], 1));
    K.add("corten", quad([x0 - 0.3, ry0, z0 - 0.3], [x0 - 0.3, ry1, zo], [x0 - 0.3, ry1 + th, zo], [x0 - 0.3, ry0 + th, z0 - 0.3], 1)); K.add("corten", quad([x1 + 0.3, ry1, zo], [x1 + 0.3, ry0, z0 - 0.3], [x1 + 0.3, ry0 + th, z0 - 0.3], [x1 + 0.3, ry1 + th, zo], 1));
    // timber slat soffit under the overhang
    for (var sx = x0 + 0.1; sx < x1; sx += 0.32) K.box("wood", 0xffffff, 0.18, 0.06, Hh.ov, sx, roofY(z1 + Hh.ov / 2) - 0.08, z1 + Hh.ov / 2, 0, 1, Math.atan((Hh.eaveF - Hh.eaveB) / (z1 - z0)));
    // downlights in the soffit (lit at night) and four floodlights for the apron (pool spot sources)
    for (var lx = x0 + 3; lx < x1 - 1; lx += 5) K.cyl("lampE", 0xffffff, 0.16, 0.16, 0.05, lx, roofY(z1 + 1.8) - 0.14, z1 + 1.8, 12);
    // rain leaders and a ridge flashing line at the rear
    [x0 + 0.5, x1 - 0.5].forEach(function (x) { K.cyl("steel", 0x3a3e42, 0.08, 0.08, Hh.eaveB, x, Hh.eaveB / 2, z0 - 0.15, 8); });
  }
  function buildWing(K) {
    var S = SITE, W = S.W, x0 = W.x0, x1 = W.x1, z0 = W.z0, z1 = W.z1, h = W.h, R = S.rooms;
    // floors: terrazzo (dispatch), carpet (briefing, classroom), timber (lounge)
    K.box("terrazzo", 0xffffff, R.lobby[1] - R.lobby[0], 0.32, z1 - z0, (R.lobby[0] + R.lobby[1]) / 2, -0.3, (z0 + z1) / 2);
    K.box("ctile", 0x8a97a4, R.brief[1] - R.brief[0], 0.32, z1 - z0, (R.brief[0] + R.brief[1]) / 2, -0.3, (z0 + z1) / 2);
    K.box("ctile", 0x9aa493, R["class"][1] - R["class"][0], 0.32, z1 - z0, (R["class"][0] + R["class"][1]) / 2, -0.3, (z0 + z1) / 2);
    K.box("wood", 0xffffff, R.lounge[1] - R.lounge[0], 0.32, z1 - z0, (R.lounge[0] + R.lounge[1]) / 2, -0.3, (z0 + z1) / 2);
    GEO.walk.push(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-PI / 2).translate((x0 + x1) / 2, 0.02, (z0 + z1) / 2));
    // the rear wall (stucco outside, plaster inside) with the landside entrance and a band of high windows in the rooms
    var dA = -6.6, dB = -3.4, dH = 2.9, wy0 = 2.7, wy1 = 3.8, T3 = 0.35;
    var rearSeg = function (a, b) { K.box("stucco", 0xffffff, b - a, h, T3, (a + b) / 2, 0, z0 + T3 / 2); K.box("plaster", 0xffffff, b - a, h - 0.4, 0.04, (a + b) / 2, 0, z0 + T3 + 0.02); K.solid((a + b) / 2, z0 + T3 / 2, b - a, T3 + 0.05, 0, h); };
    // windows: cut the rear wall into piers between window bands (simple: the wall to wy0, glass to wy1, wall above)
    // high windows only in the lounge and the classroom (the briefing room's rear wall carries the chart, dispatch the board)
    var segW = [x0, R["class"][1]]; [segW].forEach(function (s) { K.box("stucco", 0xffffff, s[1] - s[0], wy0, T3, (s[0] + s[1]) / 2, 0, z0 + T3 / 2); K.box("plaster", 0xffffff, s[1] - s[0], wy0, 0.04, (s[0] + s[1]) / 2, 0, z0 + T3 + 0.02); K.box("stucco", 0xffffff, s[1] - s[0], h - wy1, T3, (s[0] + s[1]) / 2, wy1, z0 + T3 / 2); K.box("plaster", 0xffffff, s[1] - s[0], 4.0 - wy1, 0.04, (s[0] + s[1]) / 2, wy1, z0 + T3 + 0.02); K.solid((s[0] + s[1]) / 2, z0 + T3 / 2, s[1] - s[0], T3 + 0.05, 0, h); glazing(K, s[0] + 0.3, s[1] - 0.3, wy0, wy1, z0 + T3 / 2, 1.5, [], "glass", 0.1); });
    [[R["class"][1], dA], [dB, x1]].forEach(function (s) { rearSeg(s[0], s[1]); });
    K.box("stucco", 0xffffff, dB - dA, h - dH, T3, (dA + dB) / 2, dH, z0 + T3 / 2);
    for (var px2 = x0 + 4; px2 < x1 - 2; px2 += 7) { if (px2 > dA - 1.2 && px2 < dB + 1.2) continue; K.box("stone", 0xffffff, 0.75, h + 0.75, 0.22, px2, 0, z0 - 0.05); }
    K.box("steel", 0x2e3236, dB - dA + 0.4, 0.18, 1.6, (dA + dB) / 2, dH, z0 - 0.6);   // a small steel canopy over the landside door
    // the landside doors: two glass leaves slid open
    glazing(K, dA - 1.55, dA + 0.05, 0, dH, z0 + T3 + 0.12, 1.6, [], "glass", 0.08); glazing(K, dB - 0.05, dB + 1.55, 0, dH, z0 + T3 + 0.12, 1.6, [], "glass", 0.08);
    // the south-west end wall of the lounge: glass toward the low afternoon sun (the real sun sets over the west-south-west), stucco piers
    K.box("stucco", 0xffffff, T3 + 0.1, h, 1.6, x0 + T3 / 2, 0, z0 + 0.8); K.box("stucco", 0xffffff, T3 + 0.1, h, 1.2, x0 + T3 / 2, 0, z1 - 0.6);
    glazingZ(K, z0 + 1.6, z1 - 1.2, 0.0, 4.15, x0 + 0.15, 1.9, [], "glass"); K.solid(x0 + T3 / 2, (z0 + z1) / 2, T3 + 0.05, z1 - z0, 0, h);
    // sandstone base course on the outside of the rear wall
    K.box("stone", 0xffffff, x1 - x0 + 0.1, 0.6, T3 + 0.12, (x0 + x1) / 2, 0, z0 + T3 / 2 - 0.04);
    // the front: floor-to-ceiling glass on slim steel, the airside door gap in the lobby
    var fz = z1 - 0.1; glazing(K, x0 + 0.3, dA, 0.0, 4.15, fz, 2.0, [], "glass"); glazing(K, dB, x1 - 0.25, 0.0, 4.15, fz, 2.0, [], "glass");
    K.box("steel", 0x2e3236, dB - dA, 1.25, 0.18, (dA + dB) / 2, 2.9, fz);
    [[x0 + 0.3, dA], [dB, x1 - 0.25]].forEach(function (s) { K.solid((s[0] + s[1]) / 2, fz, s[1] - s[0], 0.25, 0, 4.2); });
    // roof slab, parapet, and the canopy over the airside walk on slim steel columns
    K.box("plaster", 0xf3eee6, x1 - x0, 0.06, z1 - z0, (x0 + x1) / 2, 4.0, (z0 + z1) / 2);   // the ceiling
    K.box("stucco", 0xffffff, x1 - x0 + 0.3, 0.55, z1 - z0 + 0.3, (x0 + x1) / 2, h - 0.05, (z0 + z1) / 2);
    K.box("stucco", 0xffffff, x1 - x0 + 0.3, W.par - h, 0.3, (x0 + x1) / 2, h + 0.5, z0 - 0.0); K.box("stucco", 0xffffff, 0.3, W.par - h, z1 - z0 + 0.3, x0 - 0.0, h + 0.5, (z0 + z1) / 2);
    K.box("roof", 0x8b8378, x1 - x0, 0.06, z1 - z0, (x0 + x1) / 2, h + 0.5, (z0 + z1) / 2);
    var cz0 = z1 - 0.1, cz1 = W.canopy; K.box("corten", 0xffffff, x1 - x0 + 0.3, 0.42, cz1 - cz0 + 0.3, (x0 + x1) / 2, h - 0.2, (cz0 + cz1) / 2);
    for (var sx = x0 + 0.15; sx < x1 - 0.1; sx += 0.32) K.box("wood", 0xffffff, 0.18, 0.06, cz1 - cz0 - 0.1, sx, h - 0.27, (cz0 + cz1) / 2);
    for (var cx = x0 + 4; cx < x1 - 1; cx += 8) { K.box("steel", 0x2e3236, 0.18, h - 0.2, 0.18, cx, 0, cz1 - 0.35); K.solid(cx, cz1 - 0.35, 0.3, 0.3, 0, h); K.cyl("lampE", 0xffffff, 0.14, 0.14, 0.05, cx - 2, h - 0.3, (cz0 + cz1) / 2, 12); K.cyl("lampE", 0xffffff, 0.14, 0.14, 0.05, cx + 2, h - 0.3, (cz0 + cz1) / 2, 12); }
    // rooftop units (screened), a few on the wing roof
    [[-36, -21], [-22, -20], [-12, -23]].forEach(function (q) { K.box("steelL", 0xb8b5ae, 2.2, 1.2, 1.6, q[0], h + 0.5, q[1]); K.box("dark", 0x3a3c3e, 1.0, 0.05, 1.0, q[0], h + 1.7, q[1]); });
    // partition walls with doorways near the glass (lobby | briefing | classroom | lounge)
    [R.brief[1], R["class"][1], R.lounge[1]].forEach(function (x) { var a = z0 + T3, b = z1 - 3.6, c2 = z1 - 1.2; K.box("plaster", 0xffffff, 0.2, 4.0, b - a, x, 0, (a + b) / 2); K.solid(x, (a + b) / 2, 0.25, b - a, 0, 4); K.box("plaster", 0xffffff, 0.2, 4.0, z1 - c2, x, 0, (c2 + z1) / 2); K.solid(x, (c2 + z1) / 2, 0.25, z1 - c2, 0, 4); K.box("plaster", 0xffffff, 0.2, 4.0 - 2.6, c2 - b, x, 2.6, (b + c2) / 2); K.box("walnut", 0xffffff, 0.26, 0.12, c2 - b + 0.2, x, 2.6, (b + c2) / 2); });
    // the shared wall with the hangar (x = 4): plaster on the dispatch side, panels on the hangar side, a door between them
    var hd0 = S.hdoor[0], hd1 = S.hdoor[1]; [[z0, hd0], [hd1, z1]].forEach(function (s) { K.box("plaster", 0xffffff, 0.06, 4.0, s[1] - s[0], x1 - 0.23, 0, (s[0] + s[1]) / 2); K.box("panel", 0xffffff, 0.06, W.par, s[1] - s[0], x1 + 0.23, 0, (s[0] + s[1]) / 2); K.solid(x1, (s[0] + s[1]) / 2, 0.5, s[1] - s[0], 0, W.par); });
    K.box("plaster", 0xffffff, 0.06, 4.0 - 2.7, hd1 - hd0, x1 - 0.23, 2.7, (hd0 + hd1) / 2); K.box("panel", 0xffffff, 0.06, W.par - 2.7, hd1 - hd0, x1 + 0.23, 2.7, (hd0 + hd1) / 2); K.box("steel", 0x2e3236, 0.5, 0.12, hd1 - hd0 + 0.24, x1, 2.6, (hd0 + hd1) / 2);
    K.box("stucco", 0xffffff, 0.46, W.par - 4.0, hd1 - hd0, x1, 4.0, (hd0 + hd1) / 2);
    // ceiling light panels (lit) in every room
    for (var lx = x0 + 3; lx < R.lounge[1] - 0.5; lx += 4) for (var lz = z0 + 3.5; lz < z1 - 1.5; lz += 4.2) K.box("lampE", 0xffffff, 1.2, 0.04, 0.6, lx, 3.96, lz);   // the lounge; the other rooms have their own ceilings
  }

  // ───────────────────────── the trainer: a generic four-seat high-wing piston trainer, built once, placed four times ─────────────────────────
  // Its own frame: nose toward +z, up +y, the port (left) wing toward +x; origin on the ground under the wing's leading edge.
  // Length 8.3 m, span 11 m, height 2.7 m. The fuselage is lofted from superelliptic sections and wears a painted livery
  // (white, a GIVEBACK green stripe with a gold pinstripe, dark tinted windows) from a canvas painted per pixel from the shape.
  var STN = [   // z, width, bottom, top
    [3.02, 0.62, 1.00, 1.42], [2.92, 0.86, 0.90, 1.50], [2.70, 0.98, 0.82, 1.56], [2.40, 1.06, 0.77, 1.61], [2.10, 1.10, 0.75, 1.64], [1.60, 1.13, 0.73, 1.66], [1.30, 1.14, 0.72, 1.80],
    [1.00, 1.14, 0.72, 1.97], [0.60, 1.14, 0.72, 2.00], [0.00, 1.14, 0.72, 2.00], [-0.60, 1.12, 0.74, 2.00], [-1.10, 1.06, 0.78, 1.98], [-1.55, 0.96, 0.86, 1.86], [-2.10, 0.80, 0.97, 1.68],
    [-2.70, 0.64, 1.07, 1.56], [-3.30, 0.48, 1.17, 1.47], [-3.90, 0.34, 1.25, 1.43], [-4.40, 0.22, 1.30, 1.41], [-4.78, 0.10, 1.33, 1.39]];
  var NE = 3.3, NSEG = 28, ZMIN = -4.78, ZMAX = 3.02;
  function cat(a, b, c, d, t) { var t2 = t * t, t3 = t2 * t; return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); }
  function stAt(z) {   // the section at z, Catmull-Rom between the stations
    var i = 0; while (i < STN.length - 2 && STN[i + 1][0] > z) i++; var a = STN[Math.max(0, i - 1)], b = STN[i], c = STN[i + 1], d = STN[Math.min(STN.length - 1, i + 2)]; var t = clamp((b[0] - z) / (b[0] - c[0]), 0, 1);
    return [z, Math.max(0.02, cat(a[1], b[1], c[1], d[1], t)), cat(a[2], b[2], c[2], d[2], t), cat(a[3], b[3], c[3], d[3], t)]; }
  function hull(z, th) { var s = stAt(z), cx = Math.cos(th), sy = Math.sin(th); var px = Math.sign(cx) * Math.pow(Math.abs(cx), 2 / NE), py = Math.sign(sy) * Math.pow(Math.abs(sy), 2 / NE); var yc = (s[2] + s[3]) / 2, h = s[3] - s[2]; return [px * s[1] / 2, yc + py * h / 2, z]; }
  // the livery at a hull point: [r, g, b] (0..255), from where the point is on the aircraft
  function liveryAt(z, th) { var p = hull(z, th), x = Math.abs(p[0]), y = p[1], s = stAt(z), side = x > s[1] * 0.36;
    var win = (z < 1.60 && z > 0.98 && y > 1.58 && !(z < 1.05 && y < 1.6)) || (side && z < 0.94 && z > -1.08 && y > 1.47 && y < 1.93 && !(z > -0.10 && z < 0.0) && !(z > 0.86)) || (z < -1.18 && z > -1.62 && y > 1.80 && x < s[1] * 0.42);
    if (win) return [26, 36, 44];
    if (y > 1.07 && y < 1.23 && z < 2.5 && z > -4.5) return [47, 174, 87];
    if (y > 1.26 && y < 1.30 && z < 2.3 && z > -4.2) return [244, 205, 90];
    if (z > 2.86) return [47, 174, 87];
    if (y < 0.84) return [214, 216, 216];
    return [244, 244, 240]; }
  function liveryTex() { if (FA.livT) return FA.livT; var W = LOWQ ? 256 : 1024, Hc = LOWQ ? 128 : 512; var c = document.createElement("canvas"); c.width = W; c.height = Hc; var x = c.getContext("2d"); var im = x.createImageData(W, Hc), d = im.data;
    for (var j = 0; j < Hc; j++) for (var i = 0; i < W; i++) { var z = ZMAX - (i + 0.5) / W * (ZMAX - ZMIN), th = (j + 0.5) / Hc * TAU; var col = i < 3 && j < 3 ? [255, 255, 255] : liveryAt(z, th); var o = (j * W + i) * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255; }
    x.putImageData(im, 0, 0); var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ULTRA ? 16 : 8; t.userData.avShared = true; FA.livT = t; return t; }
  function fuselageGeo() { var P = [], U = [], NR = 46; var rings = []; for (var r = 0; r <= NR; r++) { var z = ZMAX - (ZMAX - ZMIN) * Math.pow(r / NR, 1.0); rings.push(z); }
    for (var r2 = 0; r2 < NR; r2++) for (var k = 0; k < NSEG; k++) { var z0 = rings[r2], z1 = rings[r2 + 1], a0 = k / NSEG * TAU, a1 = (k + 1) / NSEG * TAU; var p00 = hull(z0, a0), p01 = hull(z0, a1), p10 = hull(z1, a0), p11 = hull(z1, a1);
      var u0 = (ZMAX - z0) / (ZMAX - ZMIN), u1 = (ZMAX - z1) / (ZMAX - ZMIN), v0 = k / NSEG, v1 = (k + 1) / NSEG;
      [[p00, u0, v0], [p11, u1, v1], [p01, u0, v1], [p00, u0, v0], [p10, u1, v0], [p11, u1, v1]].forEach(function (q) { P.push(q[0][0], q[0][1], q[0][2]); U.push(q[1], 1 - q[2]); }); }
    // the tail cone cap
    var zc = ZMIN; for (var k2 = 0; k2 < NSEG; k2++) { var b0 = hull(zc, k2 / NSEG * TAU), b1 = hull(zc, (k2 + 1) / NSEG * TAU), cc = [0, 1.36, zc - 0.03]; [b0, cc, b1].forEach(function (q) { P.push(q[0], q[1], q[2]); U.push(0.999, 0.5); }); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.computeVertexNormals(); return g; }
  // NACA 2412-like section, chord 1, from the trailing edge over the top to the leading edge and back under
  function foil(n, t, m, pp) { var up = [], lo = []; for (var i = 0; i <= n; i++) { var b = i / n * PI, x = (1 - Math.cos(b)) / 2; var yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x); var yc = m ? (x < pp ? m / (pp * pp) * (2 * pp * x - x * x) : m / ((1 - pp) * (1 - pp)) * ((1 - 2 * pp) + 2 * pp * x - x * x)) : 0; up.push([x, yc + yt]); lo.push([x, yc - yt]); }
    return up.reverse().concat(lo.slice(1)); }
  // a lofted surface through spanwise stations: st = [[x, zLE, chord, y, thickScale]], the section in the (chord along -z, y) plane
  function loftWing(st, sec) { var P = [], N = sec.length; var pt = function (s, i) { var q = sec[i]; return [s[0], s[3] + q[1] * s[2] * (s[4] || 1), s[1] - q[0] * s[2]]; };
    for (var a = 0; a < st.length - 1; a++) for (var i = 0; i < N - 1; i++) { var A = pt(st[a], i), B = pt(st[a], i + 1), Cc = pt(st[a + 1], i + 1), D = pt(st[a + 1], i); [A, Cc, B, A, D, Cc].forEach(function (q) { P.push(q[0], q[1], q[2]); }); }
    // tip caps
    [0, st.length - 1].forEach(function (e) { var s = st[e], ctr = pt(s, 0); for (var i = 1; i < N - 1; i++) { var A = pt(s, i), B = pt(s, i + 1); var tri = e === 0 ? [ctr, A, B] : [ctr, B, A]; tri.forEach(function (q) { P.push(q[0], q[1], q[2]); }); } });
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); var U = new Float32Array(P.length / 3 * 2); g.setAttribute("uv", new THREE.BufferAttribute(U, 2)); g.computeVertexNormals();
    // fix winding where the loft runs toward -x (normals must point out of the section): flip if the first normal points inward
    return g; }
  function finGeo(pts, th) { var sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]); sh.closePath();
    var g = new THREE.ExtrudeGeometry(sh, { depth: th, bevelEnabled: true, bevelThickness: th * 0.35, bevelSize: th * 0.45, bevelSegments: 2, curveSegments: 4 }); g.translate(0, 0, -th / 2); g.rotateY(-PI / 2); g = g.toNonIndexed(); var U = g.attributes.uv; for (var k = 0; k < U.count; k++) U.setXY(k, 0.001, 0.001); return g; }
  var PLANE = FA.planeTpl = FA.planeTpl || null;
  function planeTemplate() {
    if (PLANE) return PLANE; var K = new Kit(), W0 = 0xffffff;
    // fuselage (livery UVs)
    K.add("livery", fuselageGeo(), W0);
    // the high wing: constant chord inboard, tapered outboard, 1.7 degrees of dihedral, washout via a thinner tip
    var sec = foil(14, 0.12, 0.02, 0.4), dh = Math.tan(1.7 * PI / 180);
    var wst = [[-5.5, 0.22, 1.12, 1.99 + 5.5 * dh, 0.85], [-2.6, 0.35, 1.52, 1.99 + 2.6 * dh, 1], [0, 0.35, 1.55, 1.99, 1], [2.6, 0.35, 1.52, 1.99 + 2.6 * dh, 1], [5.5, 0.22, 1.12, 1.99 + 5.5 * dh, 0.85]];
    var wg = loftWing(wst, sec); var wc = new Float32Array(wg.attributes.position.count * 3); var wp = wg.attributes.position.array; for (var i = 0; i < wg.attributes.position.count; i++) { var ax = Math.abs(wp[i * 3]); var col = ax > 5.15 ? [47 / 255, 174 / 255, 87 / 255] : [0.957, 0.957, 0.94]; wc[i * 3] = col[0]; wc[i * 3 + 1] = col[1]; wc[i * 3 + 2] = col[2]; } wg.setAttribute("color", new THREE.BufferAttribute(wc, 3)); K.add("paint", wg);
    // flap and aileron hinge lines (thin dark strips under the trailing edge)
    [[0.7, 2.55], [2.75, 4.9]].forEach(function (s) { [-1, 1].forEach(function (sd) { K.box("dark", 0x3a3d40, s[1] - s[0], 0.012, 0.012, sd * (s[0] + s[1]) / 2, 1.99 + 1.6 * dh + 0.035, 0.35 - 1.12, 0); }); });
    // struts (streamlined tubes) from the lower fuselage to the wing, with the fairings
    [-1, 1].forEach(function (sd) { var A = new THREE.Vector3(sd * 0.56, 0.93, -0.22), B = new THREE.Vector3(sd * 2.85, 1.99 + 2.85 * dh - 0.07, -0.18); var g = new THREE.CylinderGeometry(0.035, 0.035, A.distanceTo(B), 8, 1, true); g.scale(1, 1, 2.6); var d = B.clone().sub(A).normalize(); var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); var m = new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)); K.add("paint", g, W0, m); });
    // the horizontal tail and the fin (with a dorsal fairing)
    var hsec = foil(8, 0.09, 0, 0.4); K.add("paint", loftWing([[-1.72, -3.98, 0.72, 1.36, 1], [0, -3.86, 0.98, 1.36, 1], [1.72, -3.98, 0.72, 1.36, 1]], hsec), W0);
    K.add("paint", finGeo([[-3.42, 1.38], [-4.32, 2.64], [-4.86, 2.62], [-4.97, 1.36]], 0.07), W0);
    K.add("paint", finGeo([[-2.35, 1.66], [-3.5, 1.86], [-3.6, 1.40], [-2.4, 1.48]], 0.04), W0);
    // landing gear: spring-steel mains with wheel pants, the nose strut and its pant
    [-1, 1].forEach(function (sd) { var A = new THREE.Vector3(sd * 0.48, 0.80, -0.55), B = new THREE.Vector3(sd * 1.24, 0.30, -0.6); K.tube("paint", A, B, 0.045, 6); K.cyl("dark", 0x1c1d1f, 0.3, 0.3, 0.15, sd * 1.24, 0.3, -0.6, 16, false, 0, 0, PI / 2);
      K.sph("paint", W0, 0.5, sd * 1.24, 0.34, -0.62, 14, 0.27, 0.56, 0.86); K.box("dark", 0x2a2b2d, 0.12, 0.03, 0.22, sd * 0.8, 0.62, -0.5); });
    K.tube("chrome", new THREE.Vector3(0, 0.82, 2.15), new THREE.Vector3(0, 0.28, 2.18), 0.04, 8); K.cyl("dark", 0x1c1d1f, 0.25, 0.25, 0.13, 0, 0.26, 2.18, 14, false, 0, 0, PI / 2); K.sph("paint", W0, 0.5, 0, 0.3, 2.16, 12, 0.24, 0.5, 0.74);
    // propeller (two blades) and spinner, cowling inlets, exhaust
    K.place("paint", new THREE.LatheGeometry([[0.0001, 0.48], [0.1, 0.42], [0.17, 0.28], [0.21, 0.1], [0.22, 0.0]].map(function (q) { return new THREE.Vector2(q[0], q[1]); }), 18).rotateX(PI / 2), 0x2fae57, 0, 1.2, 3.0);
    [0, PI].forEach(function (a) { for (var s2 = 0; s2 < 6; s2++) { var r0 = 0.2 + s2 * 0.13, w = 0.13 - s2 * 0.012; var g = new THREE.BoxGeometry(w, 0.135, 0.022); g.rotateZ(0); var m = new THREE.Matrix4(); var tw = 0.5 - s2 * 0.06; var q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, tw, a + PI / 2, "ZYX")); m.compose(new THREE.Vector3(Math.cos(a + PI / 2) * (r0 + 0.065), 1.2 + Math.sin(a + PI / 2) * (r0 + 0.065), 3.07), q, new THREE.Vector3(1, 1, 1)); K.add(s2 === 5 ? "paint" : "dark", g, s2 === 5 ? 0xf4cd5a : 0x232426, m); } });
    [-0.28, 0.28].forEach(function (x) { K.sph("dark", 0x15161a, 0.1, x, 1.06, 2.98, 10, 1, 0.65, 0.25); });
    K.cyl("chrome", 0xffffff, 0.035, 0.03, 0.22, 0.32, 0.8, 2.05, 8, false, 0, PI / 2 - 0.3, 0);
    // details: antennas, the beacon and nav lights (glow), the pitot tube with its streamer, fuel caps, steps
    K.box("dark", 0x222325, 0.012, 0.32, 0.18, 0, 2.0, -1.45, 0); K.tube("dark", new THREE.Vector3(0.1, 1.95, -2.2), new THREE.Vector3(0.1, 2.5, -2.6), 0.006, 4);
    K.box("glow", 0xff2a20, 0.08, 0.08, 0.12, 0, 2.66, -4.55); K.box("glow", 0xff3326, 0.05, 0.06, 0.16, 5.52, 2.02 + 5.5 * dh, -0.1); K.box("glow", 0x22ff6a, 0.05, 0.06, 0.16, -5.52, 2.02 + 5.5 * dh, -0.1); K.box("glow", 0xffffff, 0.05, 0.05, 0.05, 0, 1.43, -4.82);
    K.tube("chrome", new THREE.Vector3(3.6, 1.97, 0.2), new THREE.Vector3(3.6, 1.97, 0.55), 0.012, 6); K.box("glow", 0xff2a1a, 0.05, 0.05, 0.12, 3.6, 1.97, 0.6); K.box("paint", 0xd92b20, 0.012, 0.3, 0.05, 3.6, 1.72, 0.6);
    [-1.6, 1.6].forEach(function (x) { K.cyl("chrome", 0xffffff, 0.05, 0.05, 0.02, x, 2.1, -0.25, 10); });
    var g0 = K.merge(); PLANE = FA.planeTpl = g0; FA.n.planeTris = Math.round(Object.keys(g0).reduce(function (a, k) { return a + g0[k].attributes.position.count / 3; }, 0)); return PLANE; }
  // place one trainer into a kit: x, z (local site frame), yaw (local), y; fleet number slot, with chocks and tie-downs when parked
  var _pm = new THREE.Matrix4(), _pq = new THREE.Quaternion();
  function placePlane(K, x, z, yaw, y, slot, parked) {
    var tpl = planeTemplate(); _pq.setFromAxisAngle(_v1.set(0, 1, 0), yaw); _pm.compose(_v2.set(x, y, z), _pq, _s1);
    for (var b in tpl) { var g = tpl[b].clone(); g.applyMatrix4(_pm); K.add(b, g); }
    // the fleet number and the GIVEBACK mark on both sides of the fin
    [1, -1].forEach(function (sd) { var A = [sd * 0.058, 1.52, -3.62], B = [sd * 0.058, 2.5, -4.28], C2 = [sd * 0.058, 2.48, -4.84], D = [sd * 0.058, 1.42, -4.93]; var uv = atlasUV("fin" + slot);
      var pts = sd > 0 ? [A, D, C2, B] : [D, A, B, C2]; var uvs = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
      var g = quad(pts[0], pts[1], pts[2], pts[3], 1, uvs); g.applyMatrix4(_pm); K.add("decal", g); });
    // the registration on the fuselage sides (atlas text)
    [1, -1].forEach(function (sd) { var uv = atlasUV("reg" + slot), z0 = -3.55, z1 = -1.95, y0 = 1.33, y1 = 1.55; var xa = function (z) { return sd * (stAt(z)[1] / 2 * 0.985 + 0.004); };
      var pts = sd > 0 ? [[xa(z1), y0, z1], [xa(z0), y0, z0], [xa(z0), y1, z0], [xa(z1), y1, z1]] : [[xa(z0), y0, z0], [xa(z1), y0, z1], [xa(z1), y1, z1], [xa(z0), y1, z0]]; var uvs = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
      var g = quad(pts[0], pts[1], pts[2], pts[3], 1, uvs); g.applyMatrix4(_pm); K.add("decal", g); });
    // collision: fuselage, the wheels, the tail; the wing is overhead (you walk under it)
    var w = function (lx, lz) { return [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw)]; };
    var c0 = w(0, -0.4); K.solid(c0[0], c0[1], 1.2, 5.2, y + 0.3, y + 2.0, yaw); var c1 = w(0, -3.6); K.solid(c1[0], c1[1], 0.6, 2.4, y + 1.0, y + 1.6, yaw);
    [-1, 1].forEach(function (sd) { var c = w(sd * 1.24, -0.6); K.solid(c[0], c[1], 0.35, 0.9, y, y + 0.7, yaw); }); var cn = w(0, 2.2); K.solid(cn[0], cn[1], 0.4, 1.4, y, y + 1.6, yaw);
    if (!parked) return;
    // chocks at the main wheels, tie-down ropes from the wing rings to the ground rings and from the tail
    [-1, 1].forEach(function (sd) { [-1, 1].forEach(function (fb) { var c = w(sd * 1.24, -0.6 + fb * 0.42); var g = new THREE.BoxGeometry(0.2, 0.16, 0.18); g.translate(0, 0.08, 0); _pq.setFromAxisAngle(_v1.set(0, 1, 0), yaw); var m = new THREE.Matrix4().compose(_v2.set(c[0], apronY(c[0], c[1]) + 0.0, c[1]), _pq, _s1); K.add("matte", g, 0xf2a21c, m); }); });
    [[-2.75, 0.15, 1.95 + 2.75 * 0.03], [2.75, 0.15, 1.95 + 2.75 * 0.03], [0, -4.6, 1.33]].forEach(function (o) { var c = w(o[0], o[1]); var gy = apronY(c[0], c[1]); var top = w(o[0], o[1] + (o[0] === 0 ? 0 : -0.15)); K.tube("matte", new THREE.Vector3(c[0], gy + 0.05, c[1]), new THREE.Vector3(top[0], y + o[2] - 0.02, top[1]), 0.011, 5, undefined, 0xd8b23a); });
    // the pitot cover streamer
  }
  // ───────────────────────── the windsock (animated), on a frangible pole in its segmented circle ─────────────────────────
  function buildWindsock(g) { var S = SITE, sk = S.sock, gy = (function () { var w = l2w(sk[0], sk[1]); return gridH(w[0], w[1]) - S.G; })(), K = new Kit();
    K.cyl("white", 0xf2f1ec, 0.07, 0.09, 6.6, sk[0], gy + 3.3, sk[1], 10); K.cyl("steel", 0x2e3236, 0.22, 0.26, 0.35, sk[0], gy + 0.17, sk[1], 12); K.box("stone", 0xffffff, 0.9, 0.18, 0.9, sk[0], gy - 0.05, sk[1]);
    K.box("glow", 0xff2a1a, 0.12, 0.12, 0.12, sk[0], gy + 6.75, sk[1]); K.solid(sk[0], sk[1], 0.3, 0.3, gy, gy + 6.6);
    var base = new THREE.Group(); K.build(base, { cast: true }); g.add(base);
    // the sock: five bands, orange and white, a truncated cone 3.2 m long hinged at the top of the pole
    var sock = new THREE.Group(); sock.position.set(sk[0], gy + 6.45, sk[1]); var sk2 = new Kit(); sk2.cyl("dark", 0x2e3236, 0.48, 0.48, 0.05, 0, 0, 0, 16, true, 0, 0, PI / 2);
    var R0 = 0.45, R1 = 0.17, L = 3.2; for (var b = 0; b < 5; b++) { var a = b / 5, c = (b + 1) / 5; var cg = new THREE.CylinderGeometry(lerp(R0, R1, c), lerp(R0, R1, a), L / 5, 16, 1, true); cg.rotateZ(-PI / 2); cg.translate(-(a + c) / 2 * L, 0, 0); sk2.add("matte", cg, b % 2 ? 0xf3f0e8 : 0xf0621e); }
    sk2.build(sock, { cast: true }); sock.children.forEach(function (m) { m.material = m.material; }); g.add(sock); FA.sock = sock; return sock; }
  function sockFrame(t) { var s = FA.sock; if (!s) return; var w = 0.55 + 0.25 * Math.sin(t * 0.13) + 0.12 * Math.sin(t * 0.71 + 1.3); var dir = 2.35 + 0.18 * Math.sin(t * 0.05) + 0.06 * Math.sin(t * 0.9); s.rotation.set(0, dir, 0, "YZX"); s.rotation.z = -(1 - clamp(w, 0, 1)) * 1.15 + 0.04 * Math.sin(t * 3.1); }

  // ───────────────────────── one decal and sign atlas (2048 px; 1024 on low): lettering, fin numbers, screens, the whiteboard ─────────────────────────
  var FT = { ui: "'Space Grotesk', 'Segoe UI', system-ui, sans-serif", disp: "Anton, Impact, 'Arial Narrow', sans-serif", mono: "'JetBrains Mono', Consolas, monospace", serif: "Georgia, 'Palatino Linotype', serif" };
  var AT = FA.atlas = FA.atlas || { slots: {}, tex: null, c: null };
  var SLOTS = {   // x, y, w, h on the 2048 canvas
    fascia: [0, 0, 2048, 256], logo: [0, 256, 512, 256], fin1: [512, 256, 256, 256], fin2: [768, 256, 256, 256], fin3: [1024, 256, 256, 256], fin4: [1280, 256, 256, 256], spot1: [1536, 256, 128, 128], spot2: [1664, 256, 128, 128], spot3: [1792, 256, 128, 128], book: [1536, 384, 256, 128], clk1: [1920, 256, 128, 128], clk2: [1792, 384, 128, 128], clk3: [1920, 384, 128, 128],
    reg1: [0, 512, 512, 64], reg2: [512, 512, 512, 64], reg3: [1024, 512, 512, 64], reg4: [1536, 512, 512, 64],
    board: [0, 576, 1024, 512], sim: [1024, 576, 1024, 256], panel: [1024, 832, 512, 256], radar: [1536, 832, 512, 256],
    white: [0, 1088, 1024, 512], monument: [1024, 1088, 1024, 256], simsign: [1024, 1344, 512, 128], academy: [1536, 1344, 512, 128], s_dispatch: [1024, 1472, 512, 64], s_brief: [1536, 1472, 512, 64], s_class: [1024, 1536, 512, 64], s_lounge: [1536, 1536, 512, 64],
    caption: [0, 1600, 1024, 256], weather: [1024, 1600, 512, 256], timeline: [0, 1856, 1024, 192], prop: [1536, 1600, 512, 256], coffee: [1024, 1856, 512, 192], apronsign: [1536, 1856, 512, 192] };
  function atlasUV(k) { var s = SLOTS[k] || [0, 0, 4, 4], S2 = 2048; return [s[0] / S2, 1 - (s[1] + s[3]) / S2, (s[0] + s[2]) / S2, 1 - s[1] / S2]; }
  function atlasTex() { if (AT.tex) return AT.tex; var n = LOWQ ? 1024 : 2048; var c = document.createElement("canvas"); c.width = c.height = n; AT.c = c; AT.k = n / 2048; var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ULTRA ? 16 : 8; t.userData.avShared = true; AT.tex = t; paintAtlas(); return t; }
  function slot(k, fn) { var s = SLOTS[k], x = AT.c.getContext("2d"); x.save(); x.scale(AT.k, AT.k); x.translate(s[0], s[1]); x.beginPath(); x.rect(0, 0, s[2], s[3]); x.clip(); try { fn(x, s[2], s[3]); } catch (e) { note("atlas " + k, e); } x.restore(); }
  function txt(x, s, px, py, font, col, ls, align, maxW) { x.font = font; x.fillStyle = col; x.textAlign = align || "center"; x.textBaseline = "middle"; if (ls && "letterSpacing" in x) x.letterSpacing = ls + "px"; if (maxW) { var w = x.measureText(s).width; if (w > maxW) { x.save(); x.translate(px, py); x.scale(maxW / w, 1); x.fillText(s, 0, 0); x.restore(); if ("letterSpacing" in x) x.letterSpacing = "0px"; return; } } x.fillText(s, px, py); if ("letterSpacing" in x) x.letterSpacing = "0px"; }
  function noiseFill(x, w, h, col, a, n, R) { R = R || rng(7); for (var i = 0; i < n; i++) { x.fillStyle = "rgba(" + col + "," + (R() * a) + ")"; x.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 2); } }
  var LOGO = null;
  function logoImg(cb) { if (LOGO && LOGO.complete && LOGO.naturalWidth) { cb(LOGO); return; } if (!LOGO) { LOGO = new Image(); LOGO.src = au("/tex/rv_logo.png"); } LOGO.addEventListener("load", function () { cb(LOGO); }); }
  function drawLogo(x, cx, cy, hgt) { if (!LOGO || !LOGO.complete || !LOGO.naturalWidth) return; var w = hgt * 2; x.drawImage(LOGO, cx - w / 2, cy - hgt / 2, w, hgt); }
  function paintAtlas() {
    var x0 = AT.c.getContext("2d"); x0.fillStyle = "#ffffff"; x0.fillRect(0, 0, AT.c.width, AT.c.height);
    var name = C("names.academy", "Genesis One Flight Academy").toUpperCase();
    slot("fascia", function (x, W, H) { x.fillStyle = "#1b1410"; x.fillRect(0, 0, W, H); txt(x, name, W / 2, H / 2 + 6, "400 168px " + FT.disp, "#f5e9d6", 10, "center", W - 120); });
    slot("logo", function (x, W, H) { x.fillStyle = "#15120f"; x.fillRect(0, 0, W, H); drawLogo(x, W / 2, H / 2, H * 0.92); });
    var fleet = C("fleet", ["G1-01", "G1-02", "G1-03", "G1-04"]);
    for (var i = 1; i <= 4; i++) (function (i) {
      slot("fin" + i, function (x, W, H) { x.fillStyle = "#f4f4f0"; x.fillRect(0, 0, W, H); x.fillStyle = "#1d6b38"; x.fillRect(0, 0, W, H * 0.34); x.fillStyle = "#2fae57"; x.fillRect(0, H * 0.34, W, H * 0.06); x.fillStyle = "#f4cd5a"; x.fillRect(0, H * 0.40, W, H * 0.025); drawLogo(x, W * 0.5, H * 0.17, H * 0.26); txt(x, ("0" + i).slice(-2), W * 0.5, H * 0.68, "400 112px " + FT.disp, "#1d6b38", 2); });
      slot("reg" + i, function (x, W, H) { x.fillStyle = "#f4f4f0"; x.fillRect(0, 0, W, H); txt(x, fleet[i - 1] || ("G1-0" + i), W / 2, H / 2 + 2, "600 46px " + FT.ui, "#26282b", 6); }); })(i);
    [1, 2, 3].forEach(function (i) { slot("spot" + i, function (x, W, H) { x.fillStyle = "#c8c3b8"; x.fillRect(0, 0, W, H); txt(x, String(i), W / 2, H / 2 + 4, "400 104px " + FT.disp, "#f2c230", 0); }); });
    [["clk1", "DOUGLAS", 10, 10], ["clk2", "UTC", 17, 10], ["clk3", "AGUA PRIETA", 10, 10]].forEach(function (q) { slot(q[0], function (x, W, H) { x.fillStyle = "#2a2d30"; x.fillRect(0, 0, W, H); x.fillStyle = "#f6f4ee"; x.beginPath(); x.arc(W / 2, H / 2 - 4, 54, 0, TAU); x.fill(); x.strokeStyle = "#2a2d30"; x.lineWidth = 3; x.stroke();
        for (var k = 0; k < 12; k++) { var a = k / 12 * TAU; x.strokeStyle = "#2a2d30"; x.lineWidth = k % 3 ? 2 : 4; x.beginPath(); x.moveTo(W / 2 + Math.sin(a) * 46, H / 2 - 4 - Math.cos(a) * 46); x.lineTo(W / 2 + Math.sin(a) * 52, H / 2 - 4 - Math.cos(a) * 52); x.stroke(); }
        var hA = ((q[2] % 12) + q[3] / 60) / 12 * TAU, mA = q[3] / 60 * TAU; x.lineCap = "round"; x.strokeStyle = "#1b1d1f"; x.lineWidth = 5; x.beginPath(); x.moveTo(W / 2, H / 2 - 4); x.lineTo(W / 2 + Math.sin(hA) * 28, H / 2 - 4 - Math.cos(hA) * 28); x.stroke(); x.lineWidth = 3; x.beginPath(); x.moveTo(W / 2, H / 2 - 4); x.lineTo(W / 2 + Math.sin(mA) * 42, H / 2 - 4 - Math.cos(mA) * 42); x.stroke();
        txt(x, q[1], W / 2, H / 2 + 22, "600 11px " + FT.mono, "#7a1f18", 1, "center", 90); }); });
    slot("book", function (x, W, H) { x.fillStyle = "#efe6d2"; x.fillRect(0, 0, W, H); x.fillStyle = "#c9b896"; x.fillRect(W / 2 - 2, 0, 4, H); for (var r = 0; r < 9; r++) { x.fillStyle = "rgba(60,70,80,0.35)"; x.fillRect(14, 16 + r * 12, W / 2 - 28, 1.5); x.fillRect(W / 2 + 14, 16 + r * 12, W / 2 - 28, 1.5); } txt(x, "PILOT LOGBOOK", W * 0.25, H - 12, "600 13px " + FT.mono, "#2a3a2e", 1); });
    slot("board", function (x, W, H) { x.fillStyle = "#07120c"; x.fillRect(0, 0, W, H); txt(x, "TODAY ON THE FLIGHT LINE", 36, 42, "600 34px " + FT.mono, "#4dde6f", 4, "left"); x.fillStyle = "#1e3a29"; x.fillRect(30, 70, W - 60, 2);
      var rows = [["08:00", "GROUND SCHOOL", "FOUR FORCES", "CLASSROOM", "ON TIME"], ["09:30", "SIM LESSON 1", "SOLPORT CIRCUIT", "POD 1", "BOARDING"], ["10:15", "WALKAROUND", "G1-01", "APRON 1", "ON TIME"], ["11:00", "SIM LESSON 1", "SOLPORT CIRCUIT", "POD 2", "ON TIME"], ["13:00", "BRIEFING", "RUNWAY 03 / 21", "BRIEFING", "ON TIME"], ["14:30", "SIM LESSON 1", "SOLPORT CIRCUIT", "POD 3", "ON TIME"], ["16:00", "WALKAROUND", "G1-02", "APRON 2", "ON TIME"], ["20:00", "NIGHT CIRCUITS", "SOLPORT CIRCUIT", "POD 1", "LATER"]];
      rows.forEach(function (r, i) { var y = 110 + i * 48; txt(x, r[0], 40, y, "600 26px " + FT.mono, "#f4cd5a", 1, "left"); txt(x, r[1], 160, y, "600 26px " + FT.mono, "#f5f1e6", 1, "left"); txt(x, r[2], 450, y, "400 24px " + FT.mono, "#a9c7b2", 1, "left"); txt(x, r[3], 720, y, "400 24px " + FT.mono, "#a9c7b2", 1, "left"); txt(x, r[4], W - 40, y, "600 24px " + FT.mono, r[4] === "BOARDING" ? "#4dde6f" : "#e9e2d3", 1, "right"); }); });
    slot("sim", function (x, W, H) { var g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#3d7fc4"); g.addColorStop(0.55, "#9cc8ea"); g.addColorStop(0.62, "#e8d8b8"); g.addColorStop(1, "#b89a6c"); x.fillStyle = g; x.fillRect(0, 0, W, H);
      var R = rng(31); for (var i = 0; i < 26; i++) { var cx = R() * W, cy = H * (0.12 + R() * 0.32), r = 14 + R() * 34; x.fillStyle = "rgba(255,255,255," + (0.35 + R() * 0.4) + ")"; x.beginPath(); x.ellipse(cx, cy, r * 2.2, r * 0.7, 0, 0, TAU); x.fill(); }
      x.fillStyle = "#8d7d66"; x.beginPath(); x.moveTo(0, H * 0.6); for (var k = 0; k <= 20; k++) x.lineTo(k / 20 * W, H * (0.58 - 0.035 * Math.sin(k * 0.9) - 0.02 * Math.sin(k * 2.3))); x.lineTo(W, H * 0.62); x.lineTo(0, H * 0.62); x.fill();
      x.fillStyle = "#4a4d50"; x.beginPath(); x.moveTo(W * 0.47, H * 0.62); x.lineTo(W * 0.53, H * 0.62); x.lineTo(W * 0.78, H); x.lineTo(W * 0.22, H); x.closePath(); x.fill(); x.fillStyle = "#f1efe8"; for (var d = 0; d < 7; d++) { var t0 = 0.64 + d * 0.052, t1 = t0 + 0.022; var w0 = lerp(0.004, 0.02, (t0 - 0.62) / 0.38) * W, w1 = lerp(0.004, 0.02, (t1 - 0.62) / 0.38) * W; x.beginPath(); x.moveTo(W / 2 - w0 / 2, H * t0); x.lineTo(W / 2 + w0 / 2, H * t0); x.lineTo(W / 2 + w1 / 2, H * t1); x.lineTo(W / 2 - w1 / 2, H * t1); x.fill(); }
      txt(x, "03", W / 2, H * 0.9, "400 30px " + FT.disp, "#f1efe8", 0); });
    slot("panel", function (x, W, H) { x.fillStyle = "#16181a"; x.fillRect(0, 0, W, H); var inst = function (cx, cy, r, kind) { x.fillStyle = "#050607"; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill(); x.strokeStyle = "#5a5f63"; x.lineWidth = 3; x.stroke();
        if (kind === "ai") { x.save(); x.beginPath(); x.arc(cx, cy, r - 4, 0, TAU); x.clip(); x.fillStyle = "#3b7fd0"; x.fillRect(cx - r, cy - r, 2 * r, r); x.fillStyle = "#8a5a2b"; x.fillRect(cx - r, cy, 2 * r, r); x.fillStyle = "#fff"; x.fillRect(cx - r, cy - 1, 2 * r, 2); x.restore(); x.strokeStyle = "#f4cd5a"; x.lineWidth = 4; x.beginPath(); x.moveTo(cx - r * 0.5, cy); x.lineTo(cx - r * 0.15, cy); x.moveTo(cx + r * 0.15, cy); x.lineTo(cx + r * 0.5, cy); x.stroke(); return; }
        for (var k = 0; k < 12; k++) { var a = k / 12 * TAU; x.strokeStyle = "#e9e2d3"; x.lineWidth = 2; x.beginPath(); x.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4)); x.lineTo(cx + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12)); x.stroke(); }
        x.strokeStyle = "#ffffff"; x.lineWidth = 3; x.beginPath(); x.moveTo(cx, cy); var na = kind === "asi" ? -0.4 : kind === "alt" ? 1.2 : kind === "hdg" ? -1.4 : 0.4; x.lineTo(cx + Math.cos(na) * (r - 10), cy + Math.sin(na) * (r - 10)); x.stroke(); };
      inst(80, 70, 52, "asi"); inst(200, 70, 52, "ai"); inst(320, 70, 52, "alt"); inst(80, 186, 52, "tc"); inst(200, 186, 52, "hdg"); inst(320, 186, 52, "vsi");
      x.fillStyle = "#0b2a16"; x.fillRect(400, 30, 96, 196); txt(x, "COM 1", 448, 60, "600 16px " + FT.mono, "#4dde6f", 1); txt(x, "122.80", 448, 88, "600 20px " + FT.mono, "#bff5cc", 1); txt(x, "NAV 1", 448, 130, "600 16px " + FT.mono, "#4dde6f", 1); txt(x, "XPDR 1200", 448, 170, "600 14px " + FT.mono, "#bff5cc", 1); });
    slot("radar", function (x, W, H) { x.fillStyle = "#05100a"; x.fillRect(0, 0, W, H); x.strokeStyle = "#1e5a33"; x.lineWidth = 2; for (var r = 30; r < 130; r += 30) { x.beginPath(); x.arc(W * 0.3, H / 2, r, 0, TAU); x.stroke(); } x.strokeStyle = "#4dde6f"; x.beginPath(); x.moveTo(W * 0.3, H / 2); x.lineTo(W * 0.3 + 110, H / 2 - 50); x.stroke(); txt(x, "SIM 1  READY", W * 0.62, 50, "600 22px " + FT.mono, "#4dde6f", 2, "left"); txt(x, "SIM 2  IN SESSION", W * 0.62, 100, "600 22px " + FT.mono, "#f4cd5a", 2, "left"); txt(x, "SIM 3  READY", W * 0.62, 150, "600 22px " + FT.mono, "#4dde6f", 2, "left"); txt(x, "RWY 03 · WIND CALM", W * 0.62, 200, "400 20px " + FT.mono, "#a9c7b2", 1, "left"); });
    slot("white", function (x, W, H) { x.fillStyle = "#f7f7f4"; x.fillRect(0, 0, W, H); x.strokeStyle = "#c9ccd0"; x.lineWidth = 6; x.strokeRect(3, 3, W - 6, H - 6);
      txt(x, "THE FOUR FORCES", 40, 50, "600 38px " + FT.ui, "#1f4fa0", 2, "left");
      var cx = W * 0.42, cy = H * 0.55; x.strokeStyle = "#202428"; x.lineWidth = 4; x.beginPath(); x.ellipse(cx, cy, 150, 28, 0, 0, TAU); x.stroke(); x.beginPath(); x.moveTo(cx - 40, cy - 26); x.lineTo(cx + 40, cy - 26); x.lineTo(cx + 30, cy - 34); x.lineTo(cx - 30, cy - 34); x.stroke();
      var arrow = function (x1, y1, x2, y2, col, lab, lx, ly) { x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 6; x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke(); var a = Math.atan2(y2 - y1, x2 - x1); x.beginPath(); x.moveTo(x2, y2); x.lineTo(x2 - 22 * Math.cos(a - 0.4), y2 - 22 * Math.sin(a - 0.4)); x.lineTo(x2 - 22 * Math.cos(a + 0.4), y2 - 22 * Math.sin(a + 0.4)); x.fill(); txt(x, lab, lx, ly, "600 32px " + FT.ui, col, 1); };
      arrow(cx, cy - 40, cx, cy - 170, "#1d8a45", "LIFT", cx, cy - 195); arrow(cx, cy + 40, cx, cy + 170, "#b3342b", "WEIGHT", cx, cy + 200); arrow(cx + 160, cy, cx + 300, cy, "#1f4fa0", "THRUST", cx + 330, cy - 34); arrow(cx - 160, cy, cx - 300, cy, "#8a6a1e", "DRAG", cx - 330, cy - 34);
      txt(x, "Vr 100 KT · Vref 110 KT · sink < 600 FPM", W - 40, H - 34, "400 28px " + FT.ui, "#202428", 0, "right"); });
    slot("monument", function (x, W, H) { x.fillStyle = "#3b2416"; x.fillRect(0, 0, W, H); var g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, "rgba(255,140,70,0.12)"); g.addColorStop(1, "rgba(0,0,0,0.2)"); x.fillStyle = g; x.fillRect(0, 0, W, H); noiseFill(x, W, H, "20,10,5", 0.25, 2500, rng(4));
      txt(x, "GENESIS ONE", W / 2, H * 0.32, "400 92px " + FT.disp, "#f5e9d6", 8); txt(x, "FLIGHT ACADEMY", W / 2, H * 0.68, "600 64px " + FT.ui, "#f4cd5a", 14); });
    var sign = function (k, s, col, bg) { slot(k, function (x, W, H) { x.fillStyle = bg || "#1b1d1f"; x.fillRect(0, 0, W, H); txt(x, s, W / 2, H / 2 + 2, "600 " + Math.round(H * 0.5) + "px " + FT.ui, col || "#f5f1e6", Math.round(H * 0.08), "center", W - 30); }); };
    sign("simsign", "SIM CENTER", "#4dde6f", "#0d1a12"); sign("academy", "FLIGHT ACADEMY", "#f5f1e6", "#2a1a12"); sign("s_dispatch", "DISPATCH", "#f5f1e6"); sign("s_brief", "BRIEFING", "#f5f1e6"); sign("s_class", "GROUND SCHOOL", "#f5f1e6"); sign("s_lounge", "PILOT LOUNGE", "#f5f1e6");
    slot("caption", function (x, W, H) { x.fillStyle = "#231b13"; x.fillRect(0, 0, W, H); x.strokeStyle = "#b99a62"; x.lineWidth = 6; x.strokeRect(8, 8, W - 16, H - 16); txt(x, "DOUGLAS MUNICIPAL AIRPORT  ·  1928", W / 2, 66, "600 46px " + FT.ui, "#e3c587", 6, "center", W - 60);
      txt(x, "One of the first international airports in the United States,", W / 2, 138, "400 30px " + FT.ui, "#efe6d4", 0, "center", W - 70); txt(x, "on the border with Agua Prieta, Sonora. An airfield since 1928:", W / 2, 180, "400 30px " + FT.ui, "#efe6d4", 0, "center", W - 70); txt(x, "our students learn on the same ground.", W / 2, 222, "400 30px " + FT.ui, "#efe6d4", 0, "center", W - 70); });
    slot("timeline", function (x, W, H) { x.fillStyle = "#2b2219"; x.fillRect(0, 0, W, H); x.strokeStyle = "#c9a45e"; x.lineWidth = 4; x.beginPath(); x.moveTo(40, H / 2); x.lineTo(W - 40, H / 2); x.stroke();
      [["1928", "Douglas Municipal Airport opens", 0.08], ["THE BORDER", "Douglas and Agua Prieta, Sonora", 0.36], ["THE FIELD", "Runway 03/21 on the same ground", 0.64], ["TODAY", "Genesis One Flight Academy", 0.92]].forEach(function (q) { var px = 40 + (W - 80) * q[2]; x.fillStyle = "#e3c587"; x.beginPath(); x.arc(px, H / 2, 10, 0, TAU); x.fill(); txt(x, q[0], px, H / 2 - 40, "600 28px " + FT.ui, "#e3c587", 3, "center", 230); txt(x, q[1], px, H / 2 + 42, "400 20px " + FT.ui, "#efe6d4", 0, "center", 236); }); });
    slot("weather", function (x, W, H) { x.fillStyle = "#06101a"; x.fillRect(0, 0, W, H); txt(x, "FIELD WEATHER", 24, 34, "600 24px " + FT.mono, "#6fd6e8", 3, "left"); txt(x, "WIND   CALM", 24, 86, "600 28px " + FT.mono, "#e8f4f8", 1, "left"); txt(x, "VIS    10 SM", 24, 128, "600 28px " + FT.mono, "#e8f4f8", 1, "left"); txt(x, "SKY    CLEAR", 24, 170, "600 28px " + FT.mono, "#e8f4f8", 1, "left"); txt(x, "RWY    03 / 21", 24, 212, "600 28px " + FT.mono, "#4dde6f", 1, "left"); });
    slot("prop", function (x, W, H) { x.fillStyle = "#e9dcc3"; x.fillRect(0, 0, W, H); txt(x, "A 1928-STYLE WOODEN PROPELLER", W / 2, 54, "600 26px " + FT.ui, "#3a2c1c", 2, "center", W - 40); txt(x, "Laminated hardwood, like the trainers", W / 2, 110, "400 24px " + FT.ui, "#3a2c1c", 0, "center", W - 40); txt(x, "that flew from this field.", W / 2, 146, "400 24px " + FT.ui, "#3a2c1c", 0, "center", W - 40); });
    slot("coffee", function (x, W, H) { x.fillStyle = "#1a120c"; x.fillRect(0, 0, W, H); txt(x, "PILOT LOUNGE", W / 2, 60, "600 40px " + FT.ui, "#f4cd5a", 6); txt(x, "COFFEE  ·  TEA  ·  WATER", W / 2, 128, "400 28px " + FT.mono, "#f5e9d6", 2); });
    slot("apronsign", function (x, W, H) { x.fillStyle = "#151719"; x.fillRect(0, 0, W, H); txt(x, "ACADEMY APRON", W / 2, 70, "600 54px " + FT.ui, "#f2c230", 6); txt(x, "FLIGHT LINE TAXILANE  ·  RWY 03 / 21", W / 2, 140, "600 26px " + FT.mono, "#f5f1e6", 2, "center", W - 30); });
    if (AT.tex) AT.tex.needsUpdate = true; }
  // repaint once the webfonts and the logo are in
  function atlasLate() { if (AT.late) return; AT.late = true; var go = function () { try { if (AT.c) { paintAtlas(); AT.tex.needsUpdate = true; } } catch (e) { note("atlas late", e); } }; logoImg(function () { go(); }); try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { setTimeout(go, 300); }); } catch (e) {} }

  // ───────────────────────── the briefing room's wall chart: the field as a pilot sees it, drawn from plan.json, site.json and the lesson route ─────────────────────────
  function chartTex() {
    if (FA.chartT) return FA.chartT; var W = LOWQ ? 512 : 2048, Hc = W / 2, k = W / 2048; var c = document.createElement("canvas"); c.width = W; c.height = Hc; var x = c.getContext("2d"); x.scale(k, k); var CW = 2048, CH = 1024;
    try { var P = window.PLAN || {}, S = SITE; x.fillStyle = "#efe4c8"; x.fillRect(0, 0, CW, CH); noiseFill(x, CW, CH, "120,96,64", 0.06, 6000, rng(11));
      // the map frame: world x -700..1250, z -700..1000, rotated so north is up (x east right, z south down)
      var X0 = -720, X1 = 1260, Z0 = -720, Z1 = 1010, mx0 = 40, my0 = 40, mw = 1420, mh = CH - 80; var sc = Math.min(mw / (X1 - X0), mh / (Z1 - Z0)); var MX = function (v) { return mx0 + (v - X0) * sc; }, MZ = function (v) { return my0 + (v - Z0) * sc; };
      var line = function (pts) { x.beginPath(); pts.forEach(function (q, i) { if (i) x.lineTo(MX(q[0]), MZ(q[1])); else x.moveTo(MX(q[0]), MZ(q[1])); }); };
      x.save(); x.beginPath(); x.rect(mx0, my0, mw, mh); x.clip();
      // districts in pale stage tints
      var tint = { S1: "rgba(77,222,111,0.10)", S2: "rgba(244,205,90,0.16)", S3: "rgba(111,214,232,0.12)" }; (P.districts || []).forEach(function (d) { line(d.poly); x.closePath(); x.fillStyle = tint[d.stage] || "rgba(160,130,90,0.08)"; x.fill(); x.strokeStyle = "rgba(120,90,60,0.25)"; x.lineWidth = 1; x.stroke(); });
      // contours (from the terrain grid) for a little relief
      x.strokeStyle = "rgba(150,110,70,0.18)"; x.lineWidth = 1; for (var zz = Z0; zz < Z1; zz += 40) { x.beginPath(); for (var xx = X0; xx < X1; xx += 20) { var hh = 0; try { hh = getH(xx, zz); } catch (e) {} var yy = MZ(zz) - (hh % 4) * 1.2; if (xx === X0) x.moveTo(MX(xx), yy); else x.lineTo(MX(xx), yy); } x.stroke(); }
      // roads and walks
      (P.roads || []).forEach(function (r) { if (!r.pts || r.class === "tunnel") return; var tw = r.class === "taxilane"; line(r.pts); x.strokeStyle = tw ? "#9aa0a6" : "#c4a77b"; x.lineWidth = Math.max(tw ? 2.4 : 1.4, (r.width || 8) * sc * 1.1); x.stroke(); });
      // site.json taxiways and aprons, the runway with its numbers
      var SJ = (typeof SITE_JSON !== "undefined" && SITE_JSON) || null; try { if (!SJ && typeof SITE !== "undefined") SJ = null; } catch (e) {}
      x.fillStyle = "#b6babf"; [[[-433.8, -51.1], [-353.3, -48.9], [-329.9, -60.2], [-316, -72.1], [-315, -158.1], [-428, -159.6], [-428.8, -96.7], [-433.1, -95.2]], [[-105.1, 96.6], [-109.7, 205.7], [25.7, 210.6], [30.5, 105], [11.7, 103.8]], [[-101.1, -10], [-96.8, -10.1], [13.6, -11.2], [19.3, -11.3], [20.3, -101.3], [-101.3, -101]]].forEach(function (ap) { line(ap); x.closePath(); x.fill(); });
      var rw = P.runway || { ne: [738, -445.4], sw: [-411.2, 884.4] }; x.strokeStyle = "#4a4d52"; x.lineWidth = Math.max(5, 30 * sc); line([rw.ne, rw.sw]); x.stroke(); x.strokeStyle = "#f5f1e6"; x.lineWidth = 1.5; x.setLineDash([10, 8]); line([rw.ne, rw.sw]); x.stroke(); x.setLineDash([]);
      var rd = Math.atan2(rw.ne[1] - rw.sw[1], rw.ne[0] - rw.sw[0]); var lab = function (p, s, a) { x.save(); x.translate(MX(p[0]), MZ(p[1])); x.rotate(a); txt(x, s, 0, 0, "400 30px " + FT.disp, "#2a2d31", 0); x.restore(); };
      lab([rw.sw[0] + 30 * Math.cos(rd + PI), rw.sw[1] + 30 * Math.sin(rd + PI)], "03", rd + PI / 2); lab([rw.ne[0] + 30 * Math.cos(rd), rw.ne[1] + 30 * Math.sin(rd)], "21", rd - PI / 2);
      // the lesson route: the nine gates, numbered, joined by the course line, and the touchdown aim
      var R = null; try { R = window.PLAN_FLIGHT && PLAN_FLIGHT.debug ? PLAN_FLIGHT.debug.route() : null; } catch (e) { R = null; }
      if (R && R.length) { x.strokeStyle = "#c0392b"; x.lineWidth = 3; x.setLineDash([16, 10]); var path = [[rw.sw[0] + (rw.ne[0] - rw.sw[0]) * 0.05, rw.sw[1] + (rw.ne[1] - rw.sw[1]) * 0.05]].concat(R.map(function (G) { return [G.x, G.z]; })); line(path); x.stroke(); x.setLineDash([]);
        R.forEach(function (G, i) { var gx = MX(G.x), gz = MZ(G.z); x.fillStyle = "#c0392b"; x.beginPath(); x.arc(gx, gz, 15, 0, TAU); x.fill(); txt(x, String(i + 1), gx, gz + 1, "600 18px " + FT.ui, "#fff", 0); txt(x, G.name.replace("Solport · ", "").replace(" · Runway 21", ""), gx + 20, gz - 18, "600 17px " + FT.ui, "#7a2318", 0, "left", 220); }); }
      // the academy
      var aw = l2w(-6, -10); x.fillStyle = "#1d6b38"; x.beginPath(); x.arc(MX(aw[0]), MZ(aw[1]), 11, 0, TAU); x.fill(); x.strokeStyle = "#1d6b38"; x.lineWidth = 3; x.beginPath(); x.arc(MX(aw[0]), MZ(aw[1]), 20, 0, TAU); x.stroke(); txt(x, "FLIGHT ACADEMY · YOU ARE HERE", MX(aw[0]) - 26, MZ(aw[1]) + 34, "600 18px " + FT.ui, "#1d6b38", 1, "right");
      x.restore(); x.strokeStyle = "#5b4a35"; x.lineWidth = 3; x.strokeRect(mx0, my0, mw, mh);
      // the title block, the legend and a compass rose
      var tx = 1500; x.fillStyle = "#2a2118"; x.fillRect(tx, 40, CW - tx - 40, CH - 80); txt(x, "SOLPORT CIRCUIT", tx + 24, 110, "400 64px " + FT.disp, "#f4cd5a", 4, "left", CW - tx - 80); txt(x, "LESSON 1 · GIVEBACK ONE", tx + 26, 168, "600 26px " + FT.mono, "#e9e2d3", 2, "left");
      var L = [["1", "Take off Runway 03"], ["2", "Gates 1 to 6 over the site"], ["3", "Downwind, right base"], ["4", "Final, Runway 21"], ["5", "Land in the green zone"]]; L.forEach(function (q, i) { var y = 240 + i * 58; x.fillStyle = "#c0392b"; x.beginPath(); x.arc(tx + 44, y, 15, 0, TAU); x.fill(); txt(x, q[0], tx + 44, y + 1, "600 18px " + FT.ui, "#fff"); txt(x, q[1], tx + 72, y, "400 26px " + FT.ui, "#f5f1e6", 0, "left", CW - tx - 120); });
      txt(x, "FIELD DGL · AN AIRFIELD SINCE 1928", tx + 24, 560, "600 20px " + FT.mono, "#c9a45e", 2, "left", CW - tx - 70); txt(x, "31°20'N  109°30'W", tx + 24, 596, "400 20px " + FT.mono, "#c9a45e", 1, "left");
      var cx = tx + (CW - tx - 40) / 2, cy = 800; x.strokeStyle = "#c9a45e"; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, 120, 0, TAU); x.stroke(); for (var q = 0; q < 8; q++) { x.save(); x.translate(cx, cy); x.rotate(q * PI / 4); x.fillStyle = q === 0 ? "#f4d9a0" : "#c9a45e"; x.beginPath(); x.moveTo(0, q % 2 ? -70 : -110); x.lineTo(q % 2 ? 9 : 16, 0); x.lineTo(0, 14); x.lineTo(q % 2 ? -9 : -16, 0); x.closePath(); x.fill(); x.restore(); } txt(x, "N", cx, cy - 140, "400 36px " + FT.disp, "#f4d9a0");
    } catch (e) { note("chart", e); }
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ULTRA ? 16 : 8; t.userData.avShared = true; FA.chartT = t; return t; }
  // ───────────────────────── the heritage photograph: tex/fa2_photo.jpg (a generated period-style print; _m on low), the canvas until it loads ─────────────────────────
  function photoFile(m) { try { var url = "/tex/fa2_photo" + (LOWQ ? "_m" : "") + ".jpg?v=" + (window.BUILD || "dev"); new THREE.TextureLoader().load(au(url), function (t) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ULTRA ? 16 : 8; t.userData.avShared = true; var old = m.map; m.map = t; FA.photoFileT = t; FA.n.photo = "file"; if (old && old !== t && old === FA.photoT) { try { old.dispose(); } catch (e) {} FA.photoT = t; } }, undefined, function () { FA.n.photo = "canvas"; }); } catch (e) { note("photo file", e); } }
  function photoTex() {
    if (FA.photoT) return FA.photoT; var W = LOWQ ? 256 : 1024, Hc = Math.round(W * 0.6); var c = document.createElement("canvas"); c.width = W; c.height = Hc; var x = c.getContext("2d"); var R = rng(1928);
    var g = x.createLinearGradient(0, 0, 0, Hc); g.addColorStop(0, "#d9cbb0"); g.addColorStop(0.55, "#c9b391"); g.addColorStop(0.62, "#a58f6c"); g.addColorStop(1, "#8a7555"); x.fillStyle = g; x.fillRect(0, 0, W, Hc);
    x.fillStyle = "#9d8a6b"; x.beginPath(); x.moveTo(0, Hc * 0.6); for (var i = 0; i <= 40; i++) x.lineTo(i / 40 * W, Hc * (0.5 - 0.06 * Math.sin(i * 0.5) - 0.05 * Math.sin(i * 0.19 + 1) - (i > 24 && i < 31 ? 0.05 : 0))); x.lineTo(W, Hc * 0.6); x.closePath(); x.fill();
    x.fillStyle = "#6f5d45"; x.beginPath(); x.moveTo(W * 0.06, Hc * 0.63); x.lineTo(W * 0.06, Hc * 0.5); x.quadraticCurveTo(W * 0.2, Hc * 0.35, W * 0.34, Hc * 0.5); x.lineTo(W * 0.34, Hc * 0.63); x.fill(); x.fillStyle = "#4e412f"; x.fillRect(W * 0.16, Hc * 0.53, W * 0.08, Hc * 0.1);
    x.fillStyle = "#3e3325"; x.save(); x.translate(W * 0.62, Hc * 0.66); var s = W / 1024 * 1.7; x.scale(s, s); x.fillRect(-90, -24, 180, 7); x.fillRect(-84, 4, 168, 6); x.fillRect(-60, -18, 3, 24); x.fillRect(57, -18, 3, 24); x.beginPath(); x.ellipse(-8, -6, 44, 9, 0, 0, TAU); x.fill(); x.beginPath(); x.moveTo(34, -8); x.lineTo(78, -12); x.lineTo(80, -24); x.lineTo(70, -10); x.fill(); x.fillRect(-26, 2, 3, 22); x.fillRect(10, 2, 3, 22); x.beginPath(); x.arc(-24, 26, 6, 0, TAU); x.arc(12, 26, 6, 0, TAU); x.fill(); x.fillRect(-64, -10, 6, 4); x.restore();
    x.fillStyle = "#3a2f22"; [[0.8, 0.72], [0.84, 0.72], [0.45, 0.74]].forEach(function (p) { x.fillRect(W * p[0], Hc * p[1] - 18, 4, 18); x.beginPath(); x.arc(W * p[0] + 2, Hc * p[1] - 22, 5, 0, TAU); x.fill(); });
    x.fillStyle = "rgba(60,48,34,0.55)"; x.fillRect(0, Hc * 0.76, W, 4); for (var q = 0; q < 26000 * (W / 1024); q++) { x.fillStyle = "rgba(" + (R() < 0.5 ? "40,30,20" : "255,245,225") + "," + (R() * 0.12) + ")"; x.fillRect(R() * W, R() * Hc, 1.5, 1.5); }
    var vg = x.createRadialGradient(W / 2, Hc / 2, Hc * 0.3, W / 2, Hc / 2, W * 0.62); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(40,28,16,0.55)"); x.fillStyle = vg; x.fillRect(0, 0, W, Hc); x.strokeStyle = "#efe6d4"; x.lineWidth = W * 0.02; x.strokeRect(0, 0, W, Hc);
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.userData.avShared = true; FA.photoT = t; return t; }

  // ───────────────────────── the indoor light patch: inside the hangar and the wing the sky's share (hemisphere and environment) drops ─────────────────────────
  // One shared onBeforeCompile on every academy material (so the academy keeps one program family): a world-to-site matrix and
  // the two boxes. Direct sun still comes in through the door, the glass and the clerestories (the cascades); the rooms read
  // as rooms instead of being lit like the apron. Night: the pool lamps and the emissive panels carry them.
  var INU = FA.inU = FA.inU || { uFaM: { value: new THREE.Matrix4() }, uFaK: { value: new THREE.Vector4(0.42, 0.55, 0.62, 0.7) } };
  var IN_V = "varying vec3 vFaW;", IN_VM = "vFaW = (modelMatrix * vec4(transformed, 1.0)).xyz;";
  var IN_F = ["uniform mat4 uFaM; uniform vec4 uFaK; varying vec3 vFaW;"].join("\n");
  var IN_FM = ["{ vec3 fl = (uFaM * vec4(vFaW, 1.0)).xyz;",
    "  float rY = 9.6 + 2.6 * (fl.z + 27.0) / 26.0;",
    "  float inH = step(4.25, fl.x) * step(fl.x, 43.75) * step(-26.8, fl.z) * step(fl.z, -0.7) * step(fl.y, rY + 0.2) * step(-0.5, fl.y);",
    "  float hK = inH * smoothstep(-0.7, -7.0, fl.z);",
    "  float inW = step(-45.7, fl.x) * step(fl.x, 3.8) * step(-26.7, fl.z) * step(fl.z, -11.15) * step(fl.y, 4.3) * step(-0.5, fl.y);",
    "  float k = max(hK, inW * 0.85);",
    "  reflectedLight.indirectDiffuse *= mix(1.0, mix(uFaK.x, uFaK.y, inW), k); reflectedLight.indirectSpecular *= mix(1.0, mix(uFaK.z, uFaK.w, inW), k); }"].join("\n");
  function inPatch(m) { if (m.userData.faIn) return; m.userData.faIn = true;
    m.onBeforeCompile = function (sh) { sh.uniforms.uFaM = INU.uFaM; sh.uniforms.uFaK = INU.uFaK;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + IN_V).replace("#include <project_vertex>", "#include <project_vertex>\n" + IN_VM);
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + IN_F).replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\n" + IN_FM); };
    m.customProgramCacheKey = function () { return "fa2in1"; }; }
  function inUpdate() { var S = SITE; if (!S || !FA.root) return; FA.root.updateMatrixWorld(true); INU.uFaM.value.copy(FA.root.matrixWorld).invert(); }

  // ───────────────────────── the hangar inside: portal frames, the Sim Center with three pods, the trainer in for inspection, the 1928 biplane overhead ─────────────────────────
  function buildHangarIn(K) {
    var S = SITE, Hh = S.H, x0 = Hh.x0 + 0.45, x1 = Hh.x1 - 0.45, roofY = FA.roofY;
    // portal frames (I-section columns and rafters), purlins, rear-bay bracing
    [-26.4, -19.8, -13.2, -6.6, -1.5].forEach(function (z) { var ry = roofY(z); [x0, x1].forEach(function (x) { K.box("steel", 0xffffff, 0.36, ry - 0.7, 0.36, x, 0, z); K.box("steel", 0xffffff, 0.12, ry - 0.7, 0.5, x, 0, z); K.solid(x, z, 0.5, 0.5, 0, ry); });
      K.box("steel", 0xffffff, x1 - x0, 0.68, 0.32, (x0 + x1) / 2, ry - 0.7, z); K.box("steel", 0xffffff, x1 - x0, 0.08, 0.5, (x0 + x1) / 2, ry - 0.72, z); });
    for (var px = x0 + 3.2; px < x1 - 1; px += 3.6) K.add("steel", (function () { var g = new THREE.BoxGeometry(0.12, 0.22, Hh.z1 - Hh.z0 - 0.6); g.translate(0, -0.11, 0); var a = Math.atan((Hh.eaveF - Hh.eaveB) / (Hh.z1 - Hh.z0)); g.rotateX(-a); g.translate(px, roofY((Hh.z0 + Hh.z1) / 2) - 0.02, (Hh.z0 + Hh.z1) / 2); return g; })(), 0x3a3e42);
    [[x0, -26.4, x0 + 8, -19.8], [x1 - 8, -26.4, x1, -19.8]].forEach(function (b) { K.tube("steel", new THREE.Vector3(b[0] + 0.3, 1.0, b[1] + 0.25), new THREE.Vector3(b[2] - 0.3, roofY(b[3]) - 0.8, b[1] + 0.25), 0.025, 6); K.tube("steel", new THREE.Vector3(b[2] - 0.3, 1.0, b[1] + 0.25), new THREE.Vector3(b[0] + 0.3, roofY(b[3]) - 0.8, b[1] + 0.25), 0.025, 6); });
    FA.lights.push({ x: 16, y: 7.6, z: -11, c: 0xfff0dc, i: 14, d: 30, decay: 1.4, night: 0.3 }); FA.lights.push({ x: 32, y: 7.6, z: -15, c: 0xfff0dc, i: 14, d: 30, decay: 1.4, night: 0.3 });
    // high-bay lights (lit panels) on drop rods
    [[12, -9], [24, -9], [36, -9], [12, -16.5], [24, -16.5], [36, -16.5], [16, -23.4], [30, -23.4]].forEach(function (q) { var y = roofY(q[1]) - 2.0; K.cyl("steelL", 0x9aa1a7, 0.45, 0.55, 0.32, q[0], y, q[1], 18, false); K.cyl("lampE", 0xffffff, 0.48, 0.48, 0.02, q[0], y - 0.01, q[1], 18); K.tube("steel", new THREE.Vector3(q[0], y + 0.3, q[1]), new THREE.Vector3(q[0], roofY(q[1]) - 0.3, q[1]), 0.012, 4); });
    // floor markings: yellow safety lines round the sim platform, the trainer's box, a walk lane from the door to dispatch
    var YL = 0xf2c230, mk = function (ax, az, bx, bz, w) { var dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, nx = -dz / L * w / 2, nz = dx / L * w / 2; K.add("mark", quad([ax + nx, 0.03, az + nz], [ax - nx, 0.03, az - nz], [bx - nx, 0.03, bz - nz], [bx + nx, 0.03, bz + nz], 1), YL); };
    var hp = S.hplane; [[hp[0] - 6.6, hp[1] - 5.2, hp[0] + 6.6, hp[1] - 5.2], [hp[0] + 6.6, hp[1] - 5.2, hp[0] + 6.6, hp[1] + 4.6], [hp[0] - 6.6, hp[1] - 5.2, hp[0] - 6.6, hp[1] + 4.6]].forEach(function (l) { mk(l[0], l[1], l[2], l[3], 0.12); });
    [[7.6, -18.0, 32.4, -18.0], [7.6, -18.0, 7.6, -26.5], [32.4, -18.0, 32.4, -26.5]].forEach(function (l) { mk(l[0], l[1], l[2], l[3], 0.12); });
    for (var wz = -16.6; wz < -1.5; wz += 1.4) mk(5.2, wz, 5.2, wz + 0.7, 0.14);
    // the Sim Center: a low platform, three motion pods, the instructor station, the sign, the status screen
    K.box("carpet", 0x4a5450, 24.6, 0.16, 8.2, 20, 0, -22.4); K.box("steelL", 0x8d9296, 24.8, 0.06, 0.1, 20, 0.12, -18.25); K.solid(20, -22.4, 24.6, 8.2, 0, 0.16); GEO.walk.push(new THREE.PlaneGeometry(24.6, 8.2).rotateX(-PI / 2).translate(20, 0.16, -22.4));
    S.pods.forEach(function (p, i) { buildPod(K, p[0], p[1], i); });
    K.box("walnut", 0xffffff, 3.6, 0.06, 1.0, 36.6, 0.76, -24.4); K.box("white", 0xf1f2f0, 3.5, 0.74, 0.9, 36.6, 0, -24.45); K.solid(36.6, -24.4, 3.6, 1.0, 0, 0.82);
    [-1.1, 0, 1.1].forEach(function (o, i) { K.box("dark", 0x18191b, 1.0, 0.6, 0.05, 36.6 + o, 0.95, -24.75, o * -0.25); K.plane("screen", 0xffffff, 0.92, 0.52, 36.6 + o, 1.25, -24.71 + Math.abs(o) * 0.12, o * -0.25, 0, atlasUV(i === 1 ? "radar" : "panel")); });
    K.plane("screen", 0xffffff, 4.2, 1.05, 20, 6.2, Hh.z0 + 0.42, 0, 0, atlasUV("simsign")); K.box("dark", 0x0d1a12, 4.4, 1.2, 0.08, 20, 5.62, Hh.z0 + 0.36);
    K.plane("screen", 0xffffff, 3.0, 1.5, 36.4, 3.4, Hh.z0 + 0.42, 0, 0, atlasUV("radar")); K.box("dark", 0x101214, 3.2, 1.7, 0.06, 36.4, 2.55, Hh.z0 + 0.38);
    // the trainer in for its 100-hour inspection, a work stand at the cowling, a tool chest, a tool cart, extinguishers, a parts rack, a bench
    placePlane(K, hp[0], hp[1], 0, 0.02, 4, false);
    K.box("matte", 0xd9a21c, 1.4, 0.06, 0.9, hp[0] + 1.6, 0.9, hp[1] + 2.4); [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]].forEach(function (o) { K.box("steelL", 0x9aa1a7, 0.05, 0.9, 0.05, hp[0] + 1.6 + o[0], 0, hp[1] + 2.4 + o[1]); }); K.solid(hp[0] + 1.6, hp[1] + 2.4, 1.4, 0.9, 0, 0.96);
    var chest = function (x, z, ry) { K.box("paint", 0xb3261e, 1.6, 1.05, 0.6, x, 0.1, z, ry); K.box("paint", 0xc12d24, 1.5, 0.45, 0.5, x, 1.15, z, ry); for (var d = 0; d < 6; d++) K.box("chrome", 0xffffff, 1.3, 0.03, 0.02, x + Math.sin(ry || 0) * 0.31, 0.25 + d * 0.15, z + Math.cos(ry || 0) * 0.31, ry); [-0.7, 0.7].forEach(function (o) { K.cyl("dark", 0x1c1d1f, 0.06, 0.06, 0.05, x + o * Math.cos(ry || 0), 0.06, z - o * Math.sin(ry || 0), 10, false, 0, 0, PI / 2); }); K.solid(x, z, 1.6, 0.6, 0, 1.6, ry); };
    chest(hp[0] - 4.2, hp[1] + 1.5, PI / 2); chest(x1 - 0.5, -10.5, -PI / 2); chest(x1 - 0.5, -13.0, -PI / 2);
    K.box("steelL", 0x8d9296, 0.9, 0.04, 0.55, hp[0] - 3.4, 0.85, hp[1] - 1.8); K.box("steelL", 0x8d9296, 0.9, 0.04, 0.55, hp[0] - 3.4, 0.45, hp[1] - 1.8); [[-0.4, -0.24], [0.4, -0.24], [-0.4, 0.24], [0.4, 0.24]].forEach(function (o) { K.box("steelL", 0x8d9296, 0.03, 0.85, 0.03, hp[0] - 3.4 + o[0], 0.0, hp[1] - 1.8 + o[1]); }); K.solid(hp[0] - 3.4, hp[1] - 1.8, 0.9, 0.55, 0, 0.9);
    [[x1 - 0.35, -3.2], [x0 + 0.35, -3.2], [x1 - 0.35, -25.8]].forEach(function (q) { K.cyl("paint", 0xc8281e, 0.11, 0.11, 0.62, q[0], 0.62, q[1], 10); K.box("steel", 0x2e3236, 0.3, 0.4, 0.05, q[0], 0.6, q[1]); });
    K.box("walnut", 0xffffff, 0.8, 0.06, 6.0, x1 - 0.5, 0.92, -18.6); K.box("steel", 0x2e3236, 0.75, 0.9, 5.9, x1 - 0.52, 0, -18.6); K.solid(x1 - 0.5, -18.6, 0.85, 6.0, 0, 1.0);
    for (var sh = 0; sh < 4; sh++) { K.box("steelL", 0x8d9296, 0.6, 0.04, 4.0, x1 - 0.4, 1.6 + sh * 0.55, -6.5); } K.box("steelL", 0x8d9296, 0.05, 2.2, 0.05, x1 - 0.1, 1.4, -8.45); K.box("steelL", 0x8d9296, 0.05, 2.2, 0.05, x1 - 0.1, 1.4, -4.55);
    var R = rng(77); for (var bx = 0; bx < 18; bx++) { var w = 0.3 + R() * 0.3; K.box("matte", [0xb8916a, 0x9c7b56, 0xcfc4ae, 0x5a7d6a][bx % 4], 0.45, 0.25 + R() * 0.15, w, x1 - 0.42, 1.64 + (bx % 4) * 0.55, -8.2 + Math.floor(bx / 4) * 0.85 + R() * 0.2); }
    K.solid(x1 - 0.4, -6.5, 0.7, 4.0, 0, 3.6);
    // a GIVEBACK banner hung from a front frame (seen from the apron through the door), oil drums and a hose reel by the north-east wall
    K.box("dark", 0x15120f, 4.2, 2.2, 0.04, 24, 6.0, -6.62); K.plane("decal", 0xffffff, 4.0, 2.0, 24, 7.1, -6.58, 0, 0, atlasUV("logo")); K.tube("steel", new THREE.Vector3(22.2, 8.2, -6.62), new THREE.Vector3(22.2, roofY(-6.6) - 0.7, -6.62), 0.01, 4); K.tube("steel", new THREE.Vector3(25.8, 8.2, -6.62), new THREE.Vector3(25.8, roofY(-6.6) - 0.7, -6.62), 0.01, 4);
    [[x1 - 0.45, -24.6, 0x2f5d8a], [x1 - 0.45, -23.9, 0x2f5d8a], [x1 - 1.1, -24.25, 0xb3261e]].forEach(function (q) { K.cyl("paint", q[2], 0.29, 0.29, 0.88, q[0], 0.44, q[1], 16); K.cyl("chrome", 0xffffff, 0.3, 0.3, 0.02, q[0], 0.89, q[1], 16); K.solid(q[0], q[1], 0.6, 0.6, 0, 0.9); });
    var hr = new THREE.TorusGeometry(0.32, 0.07, 8, 20); hr.rotateY(PI / 2); hr.translate(x1 - 0.2, 1.6, -20.6); K.add("paint", hr, 0xc8281e); K.cyl("steel", 0x2e3236, 0.08, 0.08, 0.2, x1 - 0.2, 1.6, -20.6, 10, false, 0, 0, PI / 2);
    // the academy banner on the rear wall
    K.plane("decal", 0xffffff, 6.4, 1.6, 9.0, 6.0, Hh.z0 + 0.43, 0, 0, atlasUV("fascia"));
  }
  // a sim pod: a white capsule with a green door ring on six short actuators, the wrap-around screen and the cockpit inside, a step
  function buildPod(K, px, pz, i) {
    var lift = 0.62, L = 4.0, Wd = 2.5, r = 1.25, x0 = px, z0 = pz;
    K.cyl("steelL", 0x8d9296, 1.4, 1.5, 0.12, x0, 0.16, z0, 24); K.box("steelL", 0x8d9296, 2.4, 0.08, 3.6, x0, lift - 0.06, z0);
    for (var a = 0; a < 6; a++) { var aa = a / 6 * TAU, bb = aa + (a % 2 ? 0.5 : -0.5); K.tube("chrome", new THREE.Vector3(x0 + Math.cos(aa) * 1.25, 0.28, z0 + Math.sin(aa) * 1.25), new THREE.Vector3(x0 + Math.cos(bb) * 0.9, lift - 0.05, z0 + Math.sin(bb) * 1.3), 0.07, 8); }
    // the capsule: a box base and a half-cylinder top along z, the +z end open (the door), a rounded rear cap
    K.box("white", 0xf1f2f0, Wd, 0.9, L, x0, lift, z0); var cg = new THREE.CylinderGeometry(r, r, L, 22, 1, true, -PI / 2, PI); cg.rotateX(-PI / 2); var m = new THREE.Matrix4().makeTranslation(x0, lift + 0.9, z0); K.add("white", cg.clone().applyMatrix4(m), 0xf1f2f0);
    var cap = new THREE.SphereGeometry(r, 18, 9, 0, PI, 0, PI / 2); cap.rotateY(PI); cap.translate(x0, lift + 0.9, z0 - L / 2); K.add("white", cap, 0xf1f2f0); K.box("white", 0xf1f2f0, Wd, 0.9, 0.08, x0, lift, z0 - L / 2);
    var ring = new THREE.TorusGeometry(r - 0.02, 0.07, 8, 24, PI); ring.translate(x0, lift + 0.9, z0 + L / 2); K.add("paint", ring, 0x2fae57); K.box("paint", 0x2fae57, 0.14, 0.9, 0.14, x0 - Wd / 2 + 0.07, lift, z0 + L / 2); K.box("paint", 0x2fae57, 0.14, 0.9, 0.14, x0 + Wd / 2 - 0.07, lift, z0 + L / 2);
    K.box("glow", 0x4dde6f, Wd * 0.8, 0.05, 0.02, x0, lift + 0.12, z0 + L / 2 + 0.06);   // the LED sill (green: ready)
    K.plane("decal", 0xffffff, 0.9, 0.22, x0, lift + 0.55, z0 + L / 2 + 0.002, 0, 0, atlasUV("simsign"));
    // inside: the wrap screen at the rear, the panel, the yoke, the seat
    var sg = new THREE.CylinderGeometry(r - 0.12, r - 0.12, 1.1, 18, 1, true, PI / 2 + 0.55, PI - 1.1); sg.rotateX(0); var su = sg.attributes.uv, uv = atlasUV("sim"); for (var k = 0; k < su.count; k++) su.setXY(k, lerp(uv[2], uv[0], su.getX(k)), lerp(uv[1], uv[3], su.getY(k))); sg.translate(x0, lift + 1.35, z0 - 0.9); K.add("screen", flipGeo(sg));
    K.plane("screen", 0xffffff, 1.5, 0.42, x0, lift + 0.82, z0 - 1.05, 0, -0.5, atlasUV("panel"));
    K.tube("dark", new THREE.Vector3(x0 - 0.35, lift + 0.78, z0 - 0.75), new THREE.Vector3(x0 - 0.35, lift + 0.7, z0 - 0.45), 0.02, 6); K.box("dark", 0x18191b, 0.3, 0.06, 0.04, x0 - 0.35, lift + 0.76, z0 - 0.45);
    K.box("leather", 0x3b4a42, 0.62, 0.12, 0.6, x0 - 0.35, lift + 0.42, z0 + 0.35); K.box("leather", 0x3b4a42, 0.62, 0.75, 0.12, x0 - 0.35, lift + 0.52, z0 + 0.66, 0, 1, -0.15);
    // the step up to the door and the solids (the pod body; the step can be stood on)
    K.box("steelL", 0x8d9296, 1.4, 0.32, 0.8, x0, 0.16, z0 + L / 2 + 0.55); K.solid(x0, z0 + L / 2 + 0.55, 1.4, 0.8, 0.16, 0.48);
    K.solid(x0, z0 - 0.1, Wd + 0.1, L + 0.2, 0.2, lift + 2.2);
    // the pod's light source at night (the client's pool)
    void x0;
  }
  // ───────────────────────── the wing inside: dispatch, briefing, classroom, lounge, the heritage wall ─────────────────────────
  function chair(K, x, z, face, tag, col) { var c = Math.cos(face), s = Math.sin(face); K.box("fabric", col || 0x4a5a52, 0.5, 0.1, 0.5, x, 0.44, z, face); K.box("fabric", col || 0x4a5a52, 0.5, 0.5, 0.08, x - s * 0.22, 0.5, z - c * 0.22, face); K.cyl("chrome", 0xffffff, 0.025, 0.025, 0.44, x, 0.22, z, 6); K.cyl("chrome", 0xffffff, 0.24, 0.24, 0.02, x, 0.01, z, 12); K.solid(x, z, 0.5, 0.5, 0.0, 0.5, face, true, face, tag || "fa2"); }
  function table(K, x, z, w, d, mat) { K.box(mat || "walnut", 0xffffff, w, 0.05, d, x, 0.73, z); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (o) { K.box("steel", 0x2e3236, 0.05, 0.73, 0.05, x + o[0] * (w / 2 - 0.1), 0, z + o[1] * (d / 2 - 0.1)); }); K.solid(x, z, w, d, 0, 0.78); }
  function sofa(K, x, z, face, len, col) { var c = Math.cos(face), s = Math.sin(face); K.box("leather", col || 0x9a6b47, len, 0.42, 0.9, x, 0, z, face); K.box("leather", col || 0x9a6b47, len, 0.5, 0.18, x - s * 0.36, 0.42, z - c * 0.36, face); [-1, 1].forEach(function (sd) { K.box("leather", col || 0x9a6b47, 0.16, 0.24, 0.9, x + c * sd * (len / 2 - 0.08), 0.42, z - s * sd * (len / 2 - 0.08), face); });
    var n = Math.max(1, Math.round(len / 0.8)); for (var i = 0; i < n; i++) { var o = -len / 2 + (i + 0.5) * len / n; K.solid(x + c * o + s * 0.08, z - s * o + c * 0.08, len / n, 0.62, 0, 0.44, face, true, face, "fa2_lounge"); } K.solid(x - s * 0.36, z - c * 0.36, len, 0.18, 0.4, 0.92, face); }
  function buildWingIn(K) {
    var S = SITE, W = S.W, R = S.rooms, z0 = W.z0 + 0.35, z1 = W.z1 - 0.15;
    // dispatch: the counter, the flight board on the hangar wall, the logbook stand, a bench by the glass, the heritage wall
    // (the dispatch desk is built with the room design, buildDesign)
    K.box("dark", 0x15171a, 0.08, 2.2, 4.4, 3.72, 1.45, -23.4); K.plane("screen", 0xffffff, 4.2, 2.1, 3.66, 2.55, -23.4, -PI / 2, 0, atlasUV("board"));
    K.plane("decal", 0xffffff, 2.2, 0.28, 3.68, 3.75, -23.4, -PI / 2, 0, atlasUV("s_dispatch"));
    K.box("walnut", 0xffffff, 0.5, 1.05, 0.5, -1.6, 0, -16.6); K.box("walnut", 0xffffff, 0.62, 0.05, 0.5, -1.6, 1.05, -16.6, 0, 1, -0.3); K.plane("decal", 0xffffff, 0.56, 0.28, -1.6, 1.1, -16.6, 0, -PI / 2 + 0.3, atlasUV("book")); K.solid(-1.6, -16.6, 0.6, 0.6, 0, 1.1);
    [[-5.6, -12.4], [-2.2, -12.4]].forEach(function (q) { chair(K, q[0] - 0.6, q[1], PI, "fa2_lobby", 0x8a5a3a); chair(K, q[0] + 0.6, q[1], PI, "fa2_lobby", 0x8a5a3a); });
    // the heritage wall (lobby side of the briefing partition): the sepia photo, the caption, the timeline, a 1928-style wooden propeller
    var hx = R.lobby[0] + 0.2; K.box("walnut", 0xffffff, 0.06, 1.75, 2.95, hx, 1.32, -23.1); K.plane("photo", 0xffffff, 2.7, 1.62, hx + 0.04, 2.2, -23.1, PI / 2, 0);
    K.box("dark", 0x231b13, 0.04, 0.68, 2.8, hx + 0.01, 0.55, -23.1); K.plane("decal", 0xffffff, 2.72, 0.66, hx + 0.04, 0.89, -23.1, PI / 2, 0, atlasUV("caption"));
    K.plane("decal", 0xffffff, 3.0, 0.56, hx + 0.03, 3.25, -19.9, PI / 2, 0, atlasUV("timeline"));
    K.box("walnut", 0xffffff, 0.12, 0.18, 2.2, hx + 0.1, 2.15, -19.6, 0, 1, 0.0); K.cyl("walnut", 0xffffff, 0.11, 0.11, 0.16, hx + 0.14, 2.24, -19.6, 12, false, 0, 0, PI / 2); K.plane("decal", 0xffffff, 0.72, 0.36, hx + 0.03, 1.55, -19.6, PI / 2, 0, atlasUV("prop"));
    FA.heritageAt = [hx + 1.5, -21.5];
    // the briefing room: the wall chart, the long table with ten chairs, the weather screen, a lectern
    var bc = (R.brief[0] + R.brief[1]) / 2; K.box("walnut", 0xffffff, 6.7, 3.42, 0.06, bc, 0.45, z0 + 0.05); K.plane("chart", 0xffffff, 6.4, 3.2, bc, 2.15, z0 + 0.1, 0, 0);
    table(K, bc, -20.2, 6.0, 1.6); for (var ci = 0; ci < 5; ci++) { var cx = bc - 2.4 + ci * 1.2; chair(K, cx, -21.45, 0, "fa2_class"); chair(K, cx, -18.95, PI, "fa2_class"); }
    K.box("dark", 0x101214, 0.06, 1.0, 1.8, R.brief[0] + 0.14, 1.5, -18.0); K.plane("screen", 0xffffff, 1.7, 0.85, R.brief[0] + 0.18, 2.0, -18.0, PI / 2, 0, atlasUV("weather"));
    K.box("walnut", 0xffffff, 0.6, 1.1, 0.45, bc + 3.4, 0, z0 + 1.2); K.solid(bc + 3.4, z0 + 1.2, 0.6, 0.45, 0, 1.1);
    K.plane("decal", 0xffffff, 2.0, 0.25, R.brief[1] + 0.14, 2.95, -13.4, PI / 2, 0, atlasUV("s_brief")); K.plane("decal", 0xffffff, 2.0, 0.25, R.brief[0] + 0.14, 2.95, -13.4, PI / 2, 0, atlasUV("s_class"));
    // the classroom: whiteboard, nine desks with chairs facing it, the instructor's desk
    var cc = (R["class"][0] + R["class"][1]) / 2; K.box("steelL", 0xc9ccd0, 3.5, 1.8, 0.05, cc, 0.85, z0 + 0.04); K.plane("decal", 0xffffff, 3.3, 1.65, cc, 1.77, z0 + 0.08, 0, 0, atlasUV("white"));
    [-21.6, -18.9, -16.2].forEach(function (rz) { [-3.6, 0, 3.6].forEach(function (ox) { var x = cc + ox; K.box("white", 0xe9e6df, 1.5, 0.04, 0.6, x, 0.74, rz - 0.42); K.box("steel", 0x2e3236, 1.4, 0.7, 0.04, x, 0.04, rz - 0.68); K.solid(x, rz - 0.42, 1.5, 0.6, 0, 0.78); chair(K, x - 0.36, rz + 0.12, PI, "fa2_class", 0x3a4a6a); chair(K, x + 0.36, rz + 0.12, PI, "fa2_class", 0x3a4a6a); }); });
    table(K, cc - 3.8, z0 + 1.6, 1.6, 0.8, "walnut"); K.place("white", new THREE.SphereGeometry(0.18, 16, 10), 0x3a7ab8, cc - 3.3, 0.98, z0 + 1.6); K.cyl("chrome", 0xffffff, 0.02, 0.02, 0.2, cc - 3.3, 0.8, z0 + 1.6, 6);
    // the pilot lounge: sofas, armchairs at the sunset glass, a coffee bar, a rug, shelves
    var lc = (R.lounge[0] + R.lounge[1]) / 2; K.box("fabric", 0x6a5a48, 5.0, 0.012, 3.6, lc + 0.6, 0.02, -18.4);
    sofa(K, lc + 0.6, -20.6, 0, 2.6); sofa(K, lc + 0.6, -16.2, PI, 2.6); table(K, lc + 0.6, -18.4, 1.4, 0.8, "walnut");
    [[-44.3, -16.0], [-44.3, -20.4]].forEach(function (q) { sofa(K, q[0], q[1], -PI / 2, 0.9, 0x5c6b62); });
    K.box("walnut", 0xffffff, 6.2, 1.0, 0.65, lc + 1.6, 0, z0 + 0.38); K.box("stone", 0xffffff, 6.3, 0.05, 0.72, lc + 1.6, 1.0, z0 + 0.38); K.solid(lc + 1.6, z0 + 0.38, 6.3, 0.72, 0, 1.05);
    K.box("chrome", 0xffffff, 0.6, 0.45, 0.42, lc - 0.3, 1.05, z0 + 0.32); K.box("dark", 0x1a1a1c, 0.5, 0.06, 0.3, lc - 0.3, 1.5, z0 + 0.3); for (var cu = 0; cu < 5; cu++) K.cyl("white", 0xf4f2ee, 0.045, 0.04, 0.1, lc + 0.6 + cu * 0.22, 1.05, z0 + 0.4, 10);
    K.plane("screen", 0xffffff, 2.2, 0.83, lc + 2.6, 2.35, z0 + 0.06, 0, 0, atlasUV("coffee"));
    K.plane("decal", 0xffffff, 2.0, 0.25, R.lounge[1] + 0.14, 2.95, -13.4, PI / 2, 0, atlasUV("s_lounge")); K.plane("decal", 0xffffff, 2.0, 0.25, R["class"][0] - 0.14, 2.95, -13.4, -PI / 2, 0, atlasUV("s_class"));
    K.plane("photo", 0xffffff, 1.5, 0.9, R.lounge[1] - 0.14, 2.0, -21.0, -PI / 2, 0);
    // a few potted olive trees (pot and canopy) by the glass
    plant(K, -44.6, -12.6, "fig", 17);
    // the room lamps (pool sources): one in each room, warmer at night
    [[-2, -20], [bc, -20], [cc, -19], [lc, -18.5]].forEach(function (q) { FA.lights.push({ x: q[0], y: 3.4, z: q[1], c: 0xffe2b8, i: 3.2, d: 12, decay: 1.5, night: 0.6 }); });
    // dispatch: world clocks over the counter, a desk model of the trainer on a stand
    [["clk1", -2.4], ["clk2", -1.2], ["clk3", 0.0]].forEach(function (q) { var cg = new THREE.CylinderGeometry(0.24, 0.24, 0.05, 24); cg.rotateX(PI / 2); cg.translate(q[1], 3.15, z0 + 0.1); K.add("steel", cg, 0x2e3236); K.plane("decal", 0xffffff, 0.46, 0.46, q[1], 3.15, z0 + 0.13, 0, 0, atlasUV(q[0])); });
    try { var tpl = planeTemplate(), mm = new THREE.Matrix4().compose(new THREE.Vector3(0.36, 1.27, -21.2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.7), new THREE.Vector3(0.055, 0.055, 0.055)); for (var tb in tpl) { var tg = tpl[tb].clone(); tg.applyMatrix4(mm); K.add(tb, tg); } K.cyl("chrome", 0xffffff, 0.012, 0.012, 0.14, 0.36, 1.13, -21.2, 6); K.cyl("walnut", 0xffffff, 0.09, 0.1, 0.03, 0.36, 1.065, -21.2, 16); } catch (e) { note("desk model", e); }
    // the classroom: a projection screen and a ceiling projector, a cutaway flat-four engine on a stand, a bookshelf
    K.box("dark", 0x1a1c1e, 2.0, 1.25, 0.04, cc + 3.9, 1.4, z0 + 0.06); K.plane("screen", 0xffffff, 1.9, 1.07, cc + 3.9, 2.02, z0 + 0.09, 0, 0, atlasUV("panel")); K.box("white", 0xe9e6df, 0.4, 0.16, 0.34, cc + 3.9, 3.6, -19.6); K.cyl("steel", 0x2e3236, 0.02, 0.02, 0.1, cc + 3.9, 3.81, -19.6, 6);
    var ex = cc - 5.5, ez = -19.4; K.box("steel", 0x2e3236, 0.9, 0.7, 0.7, ex, 0, ez); [-1, 1].forEach(function (sd) { [-0.17, 0.17].forEach(function (o) { var g = new THREE.CylinderGeometry(0.075, 0.075, 0.3, 14); g.rotateZ(PI / 2); g.translate(ex + sd * 0.27, 0.95, ez + o); K.add("chrome", g); for (var f = 0; f < 6; f++) { var fg = new THREE.CylinderGeometry(0.095, 0.095, 0.012, 14); fg.rotateZ(PI / 2); fg.translate(ex + sd * (0.16 + f * 0.04), 0.95, ez + o); K.add("steelL", fg, 0x9aa1a7); } }); });
    K.box("dark", 0x2b2d30, 0.3, 0.32, 0.62, ex, 0.78, ez); K.cyl("chrome", 0xffffff, 0.05, 0.05, 0.2, ex, 0.95, ez + 0.4, 10, false, 0, PI / 2, 0); K.box("walnut", 0xffffff, 0.08, 1.5, 0.03, ex, 0.2, ez + 0.52); K.solid(ex, ez, 0.95, 0.95, 0, 1.3);
    var bx0 = R["class"][1] - 0.4; for (var bs = 0; bs < 5; bs++) K.box("walnut", 0xffffff, 0.34, 0.03, 3.0, bx0, 0.1 + bs * 0.42, -23.0); K.box("walnut", 0xffffff, 0.34, 1.95, 0.03, bx0, 0, -24.5); K.box("walnut", 0xffffff, 0.34, 1.95, 0.03, bx0, 0, -21.5); K.solid(bx0, -23.0, 0.4, 3.1, 0, 2.0);
    var RB = rng(9); for (var bsh = 0; bsh < 4; bsh++) { var bz = -24.4; while (bz < -21.65) { var bw = 0.03 + RB() * 0.05, bhh = 0.22 + RB() * 0.14; K.box("matte", [0x7a2b22, 0x1f4e6b, 0x2f5d3a, 0xc9a45e, 0x5b4a3a, 0xe9e2d3][Math.floor(RB() * 6)], 0.24, bhh, bw, bx0, 0.13 + bsh * 0.42, bz + bw / 2); bz += bw + 0.004; } }
    // the lounge: floor lamps by the sofas, a bookshelf on the partition
    [[lc - 1.2, -22.7], [lc + 2.5, -15.7]].forEach(function (q) { K.cyl("steel", 0x2e3236, 0.16, 0.16, 0.03, q[0], 0.015, q[1], 14); K.cyl("steel", 0x2e3236, 0.015, 0.015, 1.5, q[0], 0.78, q[1], 6); K.cyl("plaster", 0xf1e3c8, 0.2, 0.26, 0.32, q[0], 1.62, q[1], 18, true); K.cyl("lampE", 0xffffff, 0.17, 0.17, 0.02, q[0], 1.5, q[1], 14); K.solid(q[0], q[1], 0.35, 0.35, 0, 1.8); });
    var lb0 = R.lounge[1] - 0.3; for (var ls = 0; ls < 5; ls++) K.box("walnut", 0xffffff, 0.34, 0.03, 2.4, lb0, 0.1 + ls * 0.42, -24.6); K.solid(lb0, -24.6, 0.4, 2.5, 0, 2.0);
    for (var lsh = 0; lsh < 4; lsh++) { var lz2 = -25.7; while (lz2 < -23.55) { var lw2 = 0.03 + RB() * 0.05; K.box("matte", [0x7a2b22, 0x1f4e6b, 0x2f5d3a, 0xc9a45e, 0x5b4a3a][Math.floor(RB() * 5)], 0.24, 0.22 + RB() * 0.14, lw2, lb0, 0.13 + lsh * 0.42, lz2 + lw2 / 2); lz2 += lw2 + 0.004; } }
    // accent walls and a wainscot: slate behind the chart, terracotta in the lounge, charcoal behind the flight board, walnut rails
    K.box("plaster", 0x6f7a7f, R.brief[1] - R.brief[0] - 0.3, 3.98, 0.03, bc, 0, z0 + 0.065); K.box("plaster", 0xc48c69, R.lounge[1] - R.lounge[0] - 0.3, 2.65, 0.03, lc, 0, z0 + 0.065);
    K.box("plaster", 0x3b4044, 0.03, 3.98, 5.2, 3.7, 0, -23.4); var cz0 = W.z0 + 0.45, cz1 = W.z1 - 3.75; K.box("plaster", 0xd9cfbd, 0.03, 3.98, cz1 - cz0, R["class"][0] + 0.13, 0, (cz0 + cz1) / 2);
    [[R["class"][0] + 0.2, R["class"][1] - 0.2]].forEach(function (s) { K.box("walnut", 0xffffff, s[1] - s[0], 0.9, 0.03, (s[0] + s[1]) / 2, 0, z0 + 0.09); K.box("walnut", 0xffffff, s[1] - s[0], 0.05, 0.06, (s[0] + s[1]) / 2, 0.9, z0 + 0.1); });
  }
  // ───────────────────────── outside furniture: the monument sign, the apron sign, the spot numbers, apron floodlights ─────────────────────────
  function buildOutside(K) { var S = SITE;
    var mx = -11.6, mz = -35.4; K.box("stone", 0xffffff, 4.6, 1.2, 0.8, mx, -0.2, mz); K.box("corten", 0xffffff, 4.2, 1.05, 0.12, mx, 0.95, mz - 0.38); K.plane("decal", 0xffffff, 4.0, 1.0, mx, 1.47, mz - 0.45, PI, 0, atlasUV("monument")); K.solid(mx, mz, 4.6, 0.8, 0, 2.0);
    K.box("glow", 0xffd9a0, 4.2, 0.04, 0.04, mx, 0.02, mz - 0.6);
    var ax = S.A.thr[1] + 9, az = S.A.z1 - 1.0; K.box("steel", 0x2e3236, 0.1, 1.4, 0.1, ax - 1.1, apronY(ax, az), az); K.box("steel", 0x2e3236, 0.1, 1.4, 0.1, ax + 1.1, apronY(ax, az), az); K.box("dark", 0x151719, 2.5, 0.95, 0.1, ax, apronY(ax, az) + 0.75, az); K.plane("decal", 0xffffff, 2.4, 0.9, ax, apronY(ax, az) + 1.22, az + 0.06, 0, 0, atlasUV("apronsign")); K.solid(ax, az, 2.5, 0.3, apronY(ax, az), apronY(ax, az) + 1.8);
    S.planes.forEach(function (p, i) { var x = p[0], z = p[1] - 6.2; K.plane("decal", 0xffffff, 1.3, 1.3, x, apronY(x, z) + 0.02, z, PI, -PI / 2, atlasUV("spot" + (i + 1))); });
    // floodlights on the hangar fascia aimed down at the apron (pool spot sources at night)
    [12, 36].forEach(function (x) { K.box("dark", 0x1c1e20, 0.9, 0.35, 0.5, x, S.H.doorH - 0.9, S.H.z1 + 0.62); K.box("lampE", 0xffffff, 0.8, 0.02, 0.4, x, S.H.doorH - 0.92, S.H.z1 + 0.62); FA.lights.push({ x: x, y: S.H.doorH - 1.0, z: S.H.z1 + 0.8, c: 0xfff1d8, i: 2.2, d: 40, night: 1, spot: [x, 0, 16], ang: 0.72 }); });
    FA.lights.push({ x: -20, y: 4.0, z: -9.2, c: 0xffd9a8, i: 0.8, d: 14, night: 1 }); FA.lights.push({ x: 5, y: 3.6, z: -30.5, c: 0xffd9a8, i: 0.7, d: 12, night: 1 });
  }

  // ───────────────────────── R17 polish (6 Oct): interior design for dispatch, the briefing room and the classroom ─────────────────────────
  // One print canvas (sectional charts, posters, photographs, the compass-rose rug, plaques), a carpet-tile map and an acoustic
  // ceiling-tile map with its normal map; everything else is geometry in the academy's one material family (no new programs).
  var PS = FA.postSlots = { chartA: [0, 0, 512, 512], chartB: [512, 0, 512, 512], poster1: [1024, 0, 340, 476], poster2: [1366, 0, 340, 476], poster3: [1708, 0, 340, 476], rug: [1536, 512, 512, 512],
    p0: [0, 512, 256, 192], p1: [256, 512, 256, 192], p2: [512, 512, 256, 192], p3: [768, 512, 256, 192], p4: [1024, 512, 256, 192], p5: [1280, 512, 256, 192], p6: [0, 704, 256, 192], p7: [256, 704, 256, 192],
    plq1: [512, 704, 340, 96], plq2: [852, 704, 340, 96], plq3: [1192, 704, 340, 96], engine: [512, 800, 512, 96], tablet: [1024, 800, 256, 160] };
  function postUV(k) { var s = PS[k] || [0, 0, 4, 4]; return [s[0] / 2048, 1 - (s[1] + s[3]) / 1024, (s[0] + s[2]) / 2048, 1 - s[1] / 1024]; }
  function pslot(x0, k, fn) { var s = PS[k]; x0.save(); x0.translate(s[0], s[1]); x0.beginPath(); x0.rect(0, 0, s[2], s[3]); x0.clip(); try { fn(x0, s[2], s[3]); } catch (e) { note("print " + k, e); } x0.restore(); }
  function grain(x, W, H, n, a, R) { for (var i = 0; i < n; i++) { x.fillStyle = "rgba(" + (R() < 0.5 ? "30,24,18" : "255,250,240") + "," + (R() * a) + ")"; x.fillRect(R() * W, R() * H, 1.4, 1.4); } }
  function vign(x, W, H, a) { var g = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(20,14,8," + a + ")"); x.fillStyle = g; x.fillRect(0, 0, W, H); }
  // silhouettes: a high-wing trainer (side view) and a biplane, at (cx, cy), size s, angle a
  function silTrainer(x, cx, cy, s, a, col) { x.save(); x.translate(cx, cy); x.rotate(a || 0); x.scale(s, s); x.fillStyle = col; x.beginPath(); x.moveTo(-52, 2); x.quadraticCurveTo(-30, -6, 10, -8); x.lineTo(30, -6); x.quadraticCurveTo(46, -2, 50, 2); x.quadraticCurveTo(40, 8, 0, 8); x.lineTo(-50, 5); x.closePath(); x.fill();
    x.fillRect(-26, -12, 46, 4); x.beginPath(); x.moveTo(-52, 2); x.lineTo(-60, -16); x.lineTo(-50, -16); x.lineTo(-40, 0); x.fill(); x.fillRect(-62, 0, 18, 3); x.lineWidth = 2; x.strokeStyle = col; x.beginPath(); x.moveTo(-6, 8); x.lineTo(-10, 18); x.moveTo(10, 8); x.lineTo(14, 18); x.moveTo(40, 6); x.lineTo(40, 18); x.moveTo(0, -8); x.lineTo(-10, 6); x.stroke();
    x.beginPath(); x.arc(-10, 19, 3, 0, TAU); x.arc(14, 19, 3, 0, TAU); x.arc(40, 19, 2.5, 0, TAU); x.fill(); x.fillRect(50, -10, 2, 22); x.restore(); }
  function silBiplane(x, cx, cy, s, a, col) { x.save(); x.translate(cx, cy); x.rotate(a || 0); x.scale(s, s); x.fillStyle = col; x.beginPath(); x.ellipse(0, 0, 40, 7, 0, 0, TAU); x.fill(); x.fillRect(-34, -18, 60, 4); x.fillRect(-30, 9, 54, 4); x.fillRect(-14, -16, 2, 27); x.fillRect(14, -16, 2, 27);
    x.beginPath(); x.moveTo(-38, 0); x.lineTo(-50, -14); x.lineTo(-44, -14); x.lineTo(-32, -2); x.fill(); x.fillRect(40, -12, 2, 24); x.beginPath(); x.arc(-4, 20, 4, 0, TAU); x.arc(10, 20, 4, 0, TAU); x.fill(); x.restore(); }
  function mountains(x, W, H, base, amp, col, seed, n) { var R = rng(seed); x.fillStyle = col; x.beginPath(); x.moveTo(0, H); for (var i = 0; i <= (n || 12); i++) { var px = i / (n || 12) * W; x.lineTo(px, base - amp * (0.4 + 0.6 * R())); } x.lineTo(W, H); x.closePath(); x.fill(); }
  function sectional(x, W, H, seed, terminal) {
    var R = rng(seed), n = 96, off = document.createElement("canvas"); off.width = off.height = n; var ox = off.getContext("2d"), im = ox.createImageData(n, n), d = im.data;
    var f = function (u, v) { return 0.45 + 0.2 * Math.sin(u * 5.1 + seed) * Math.cos(v * 4.3 - seed * 0.2) + 0.16 * Math.sin(u * 11.7 + v * 7.9 + seed * 0.3) + 0.08 * Math.sin(u * 23 - v * 17) + 0.22 * Math.max(0, Math.sin(u * 2.3 - v * 1.7 + seed)); };
    var cols = [[208, 222, 186], [222, 222, 182], [232, 216, 172], [224, 198, 152], [208, 178, 132], [190, 156, 112]];
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) { var hv = f(i / n, j / n); var b = clamp(Math.floor(hv * 6), 0, 5), c = cols[b]; var o = (j * n + i) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; }
    ox.putImageData(im, 0, 0); x.imageSmoothingEnabled = true; x.drawImage(off, 0, 0, W, H * 0.86);
    // contours: sampled where the height crosses a level
    x.fillStyle = "rgba(140,96,52,0.55)"; for (var cj = 0; cj < 172; cj++) for (var ci = 0; ci < 200; ci++) { var u = ci / 200, v = cj / 200; var hh = f(u, v) * 18; if (Math.abs(hh - Math.round(hh)) < 0.06) x.fillRect(u * W, v * H, 1.6, 1.6); }
    // grid ticks and maximum elevation figures
    x.strokeStyle = "rgba(30,30,30,0.6)"; x.lineWidth = 1; for (var g = 1; g < 4; g++) { x.beginPath(); x.moveTo(W * g / 4, 0); x.lineTo(W * g / 4, H * 0.86); x.moveTo(0, H * 0.86 * g / 4); x.lineTo(W, H * 0.86 * g / 4); x.stroke(); for (var t = 0; t < 16; t++) { x.beginPath(); x.moveTo(W * g / 4 - 3, t * H * 0.86 / 16); x.lineTo(W * g / 4 + 3, t * H * 0.86 / 16); x.stroke(); } }
    for (var mi = 0; mi < 4; mi++) for (var mj = 0; mj < 4; mj++) { if (R() < 0.35) continue; txt(x, String(5 + Math.floor(R() * 4)), W * (mi + 0.5) / 4 - 6, H * 0.86 * (mj + 0.5) / 4, "700 30px " + FT.ui, "rgba(40,70,150,0.55)", 0); txt(x, String(Math.floor(R() * 9)), W * (mi + 0.5) / 4 + 10, H * 0.86 * (mj + 0.5) / 4 - 8, "700 17px " + FT.ui, "rgba(40,70,150,0.55)", 0); }
    // a VOR compass rose with airways, an airport with its class D ring
    var vx = W * (terminal ? 0.5 : 0.62), vy = H * (terminal ? 0.42 : 0.36), rr = terminal ? 150 : 70; x.strokeStyle = "rgba(40,80,170,0.8)"; x.lineWidth = 1.4; x.beginPath(); x.arc(vx, vy, rr, 0, TAU); x.stroke(); for (var k = 0; k < 72; k++) { var aa = k / 72 * TAU, l = k % 9 === 0 ? 12 : 5; x.beginPath(); x.moveTo(vx + Math.sin(aa) * rr, vy - Math.cos(aa) * rr); x.lineTo(vx + Math.sin(aa) * (rr - l), vy - Math.cos(aa) * (rr - l)); x.stroke(); }
    x.fillStyle = "rgba(40,80,170,0.85)"; x.beginPath(); x.moveTo(vx, vy - rr - 12); x.lineTo(vx - 6, vy - rr); x.lineTo(vx + 6, vy - rr); x.fill();
    if (!terminal) { [[0.05, 0.9], [0.98, 0.1], [0.15, 0.05], [0.95, 0.8]].forEach(function (q, i) { x.beginPath(); x.moveTo(vx, vy); x.lineTo(q[0] * W, q[1] * H * 0.86); x.stroke(); txt(x, "V-" + (66 + i * 28), (vx + q[0] * W) / 2 + 8, (vy + q[1] * H * 0.86) / 2, "700 13px " + FT.mono, "rgba(40,80,170,0.9)", 0); });
      var ax = W * 0.34, ay = H * 0.55; x.strokeStyle = "rgba(60,90,200,0.8)"; x.setLineDash([7, 5]); x.lineWidth = 1.6; x.beginPath(); x.arc(ax, ay, 46, 0, TAU); x.stroke(); x.setLineDash([]);
      x.fillStyle = "rgba(170,40,140,0.95)"; x.beginPath(); x.arc(ax, ay, 11, 0, TAU); x.fill(); x.strokeStyle = "#fff"; x.lineWidth = 3; x.beginPath(); x.moveTo(ax - 8, ay + 9); x.lineTo(ax + 8, ay - 9); x.stroke();
      txt(x, "DOUGLAS MUNI · DGL", ax + 18, ay + 28, "700 13px " + FT.ui, "rgba(120,30,110,0.95)", 0, "left"); txt(x, "4103  L 59  122.80", ax + 18, ay + 44, "600 11px " + FT.mono, "rgba(120,30,110,0.95)", 0, "left");
      [[0.8, 0.62], [0.2, 0.22]].forEach(function (q) { x.fillStyle = "rgba(170,40,140,0.85)"; x.beginPath(); x.arc(q[0] * W, q[1] * H, 7, 0, TAU); x.fill(); }); }
    else { // the field: Runway 03/21 diagonal, the taxilane, the right-hand pattern for 21
      x.strokeStyle = "#3a3d42"; x.lineWidth = 14; x.beginPath(); x.moveTo(W * 0.24, H * 0.72); x.lineTo(W * 0.76, H * 0.12); x.stroke(); x.strokeStyle = "#f1efe8"; x.lineWidth = 1.5; x.setLineDash([8, 6]); x.beginPath(); x.moveTo(W * 0.24, H * 0.72); x.lineTo(W * 0.76, H * 0.12); x.stroke(); x.setLineDash([]);
      x.strokeStyle = "#8a9096"; x.lineWidth = 5; x.beginPath(); x.moveTo(W * 0.18, H * 0.66); x.lineTo(W * 0.7, H * 0.06); x.stroke(); txt(x, "03", W * 0.22, H * 0.78, "700 20px " + FT.ui, "#2a2d31", 0); txt(x, "21", W * 0.79, H * 0.08, "700 20px " + FT.ui, "#2a2d31", 0);
      x.strokeStyle = "rgba(40,80,170,0.85)"; x.lineWidth = 2; x.setLineDash([10, 6]); x.beginPath(); x.moveTo(W * 0.62, H * 0.04); x.lineTo(W * 0.95, H * 0.3); x.lineTo(W * 0.6, H * 0.72); x.lineTo(W * 0.35, H * 0.55); x.stroke(); x.setLineDash([]);
      x.fillStyle = "#1d6b38"; x.beginPath(); x.arc(W * 0.35, H * 0.62, 8, 0, TAU); x.fill(); txt(x, "ACADEMY", W * 0.35, H * 0.68, "700 12px " + FT.mono, "#1d6b38", 1); }
    // the title block
    x.fillStyle = "#f2ede0"; x.fillRect(0, H * 0.86, W, H * 0.14); x.fillStyle = "#2a2118"; x.fillRect(0, H * 0.86, W, 3);
    txt(x, terminal ? "TERMINAL AREA · FIELD DGL" : "SECTIONAL · SOUTHEAST ARIZONA", 16, H * 0.905, "700 22px " + FT.ui, "#2a2118", 2, "left", W - 30); txt(x, terminal ? "RIGHT TRAFFIC RWY 21 · PATTERN 1000 AGL · NOT FOR NAVIGATION" : "SCALE 1:500,000 · MEF IN HUNDREDS OF FEET · NOT FOR NAVIGATION", 16, H * 0.955, "600 12px " + FT.mono, "#5b4a35", 1, "left", W - 30); }
  function poster(x, W, H, o) {
    var g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, o.sky[0]); g.addColorStop(0.62, o.sky[1]); g.addColorStop(1, o.sky[2]); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.save(); x.translate(W * o.sun[0], H * o.sun[1]); for (var r = 0; r < 18; r++) { x.rotate(TAU / 18); x.fillStyle = r % 2 ? "rgba(255,240,200,0.10)" : "rgba(255,240,200,0.03)"; x.beginPath(); x.moveTo(0, 0); x.lineTo(-W * 0.09, -H); x.lineTo(W * 0.09, -H); x.fill(); } x.restore(); x.fillStyle = o.sunCol; x.beginPath(); x.arc(W * o.sun[0], H * o.sun[1], W * 0.17, 0, TAU); x.fill();
    mountains(x, W, H, H * 0.72, H * 0.16, o.m1, 7 + o.seed, 7); mountains(x, W, H, H * 0.8, H * 0.1, o.m2, 11 + o.seed, 10); x.fillStyle = o.ground; x.fillRect(0, H * 0.84, W, H * 0.16);
    if (o.bi) silBiplane(x, W * 0.55, H * 0.42, W / 300, -0.12, o.plane); else silTrainer(x, W * 0.52, H * 0.44, W / 260, -0.18, o.plane);
    x.fillStyle = o.band; x.fillRect(0, 0, W, H * 0.2); txt(x, o.t1, W / 2, H * 0.085, "400 " + Math.round(W * 0.16) + "px " + FT.disp, o.tc, 3, "center", W - 24); txt(x, o.t2, W / 2, H * 0.165, "600 " + Math.round(W * 0.055) + "px " + FT.ui, o.tc2, 3, "center", W - 24);
    x.fillStyle = "rgba(20,14,10,0.8)"; x.fillRect(0, H * 0.9, W, H * 0.1); txt(x, o.t3, W / 2, H * 0.95, "600 " + Math.round(W * 0.05) + "px " + FT.ui, "#f2e6cf", 4, "center", W - 24);
    grain(x, W, H, 2600, 0.08, rng(o.seed)); x.strokeStyle = "#efe6d4"; x.lineWidth = 10; x.strokeRect(5, 5, W - 10, H - 10); }
  function photoSil(x, W, H, k) { var R = rng(40 + k), sep = k % 2 === 0;
    var g = x.createLinearGradient(0, 0, 0, H); if (k === 1) { g.addColorStop(0, "#e9a25b"); g.addColorStop(0.6, "#f3c98a"); g.addColorStop(1, "#6a5240"); } else if (k === 7) { g.addColorStop(0, "#0f1a2c"); g.addColorStop(1, "#23314a"); } else if (k === 5) { g.addColorStop(0, "#7fb3dc"); g.addColorStop(0.65, "#cfe0e8"); g.addColorStop(1, "#b89a6c"); } else { g.addColorStop(0, "#d4c4a6"); g.addColorStop(0.62, "#c2ac88"); g.addColorStop(1, "#8c7656"); }
    x.fillStyle = g; x.fillRect(0, 0, W, H); var dark = sep ? "#3a2f22" : k === 7 ? "#05080e" : "#2b2621";
    if (k === 0) { silBiplane(x, W * 0.55, H * 0.4, 0.95, -0.15, dark); for (var c = 0; c < 4; c++) { x.fillStyle = "rgba(245,235,215,0.5)"; x.beginPath(); x.ellipse(R() * W, H * (0.15 + R() * 0.3), 30, 8, 0, 0, TAU); x.fill(); } }
    if (k === 1) { mountains(x, W, H, H * 0.66, H * 0.1, "#5a3f34", 3, 9); x.fillStyle = "#4a3a30"; x.fillRect(0, H * 0.7, W, H * 0.3); silTrainer(x, W * 0.5, H * 0.62, 1.15, 0, "#1d1612"); }
    if (k === 2) { x.fillStyle = "#5e4e3a"; x.beginPath(); x.moveTo(W * 0.05, H * 0.62); x.lineTo(W * 0.05, H * 0.3); x.quadraticCurveTo(W * 0.5, H * 0.05, W * 0.95, H * 0.3); x.lineTo(W * 0.95, H * 0.62); x.fill(); for (var p = 0; p < 11; p++) { var px = W * (0.12 + p * 0.07), row = p % 2; x.fillStyle = dark; x.beginPath(); x.arc(px, H * (0.6 + row * 0.1), 7, 0, TAU); x.fill(); x.fillRect(px - 8, H * (0.63 + row * 0.1), 16, 26); } }
    if (k === 3) { x.fillStyle = "#9a8a6c"; x.fillRect(0, 0, W, H); for (var s2 = 0; s2 < 300; s2++) { x.fillStyle = "rgba(60,50,35," + R() * 0.2 + ")"; x.fillRect(R() * W, R() * H, 4, 4); } x.save(); x.translate(W / 2, H / 2); x.rotate(-0.6); x.fillStyle = "#4a4740"; x.fillRect(-W, -9, W * 2, 18); x.fillStyle = "#e8e4d8"; for (var dsh = -10; dsh < 10; dsh++) x.fillRect(dsh * 22, -1, 12, 2); x.restore(); }
    if (k === 4) { x.fillStyle = "#16181a"; x.fillRect(0, 0, W, H); for (var ii = 0; ii < 6; ii++) { var cx = W * (0.18 + (ii % 3) * 0.32), cy = H * (0.32 + Math.floor(ii / 3) * 0.4); x.fillStyle = "#050607"; x.beginPath(); x.arc(cx, cy, 30, 0, TAU); x.fill(); x.strokeStyle = "#e9e2d3"; x.lineWidth = 2; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(ii) * 24, cy + Math.sin(ii) * 24); x.stroke(); } x.fillStyle = "#1f6fb8"; x.fillRect(W * 0.5 - 30, H * 0.32 - 30, 60, 30); }
    if (k === 5) { mountains(x, W, H, H * 0.62, H * 0.12, "#a07a62", 5, 10); x.fillStyle = "#c9b089"; x.fillRect(0, H * 0.66, W, H * 0.34); x.fillStyle = "#e8e4dc"; x.fillRect(W * 0.3, H * 0.25, 3, H * 0.45); x.fillStyle = "#f0621e"; x.beginPath(); x.moveTo(W * 0.3, H * 0.25); x.lineTo(W * 0.55, H * 0.28); x.lineTo(W * 0.55, H * 0.32); x.lineTo(W * 0.3, H * 0.33); x.fill(); }
    if (k === 6) { silTrainer(x, W * 0.62, H * 0.6, 1.2, 0, "#4a3d2c"); for (var q2 = 0; q2 < 3; q2++) { var hx2 = W * (0.15 + q2 * 0.12); x.fillStyle = dark; x.beginPath(); x.arc(hx2, H * 0.5, 9, 0, TAU); x.fill(); x.fillRect(hx2 - 10, H * 0.54, 20, 44); } x.fillStyle = "#efe6d4"; x.fillRect(W * 0.24, H * 0.6, 20, 14); }
    if (k === 7) { x.fillStyle = "#1a2232"; x.fillRect(W * 0.15, H * 0.35, W * 0.7, H * 0.45); x.fillStyle = "#ffd98a"; for (var wl = 0; wl < 8; wl++) x.fillRect(W * (0.18 + wl * 0.08), H * 0.42, W * 0.05, H * 0.08); x.fillStyle = "#f5e9d6"; x.fillRect(W * 0.3, H * 0.62, W * 0.4, H * 0.12); for (var st = 0; st < 40; st++) { x.fillStyle = "rgba(255,255,255," + R() + ")"; x.fillRect(R() * W, R() * H * 0.3, 1.5, 1.5); } }
    if (sep) { var imd = x.getImageData(0, 0, W, H), dd = imd.data; for (var px2 = 0; px2 < dd.length; px2 += 4) { var l = dd[px2] * 0.3 + dd[px2 + 1] * 0.59 + dd[px2 + 2] * 0.11; dd[px2] = clamp(l * 1.07 + 18, 0, 255); dd[px2 + 1] = clamp(l * 0.95 + 10, 0, 255); dd[px2 + 2] = clamp(l * 0.78, 0, 255); } x.putImageData(imd, 0, 0); }
    grain(x, W, H, 1500, 0.12, R); vign(x, W, H, 0.45); x.strokeStyle = "#f4efe4"; x.lineWidth = 8; x.strokeRect(0, 0, W, H); }
  function rug(x, W, H) { x.fillStyle = "#1c2a40"; x.fillRect(0, 0, W, H); var R = rng(2); for (var i = 0; i < 9000; i++) { x.fillStyle = "rgba(" + (R() < 0.5 ? "0,0,0" : "255,255,255") + "," + R() * 0.05 + ")"; x.fillRect(R() * W, R() * H, 2, 2); }
    x.strokeStyle = "#d9c08a"; x.lineWidth = 14; x.strokeRect(22, 22, W - 44, H - 44); x.lineWidth = 3; x.strokeRect(44, 44, W - 88, H - 88);
    var c = W / 2, r = W * 0.36; x.strokeStyle = "#d9c08a"; x.lineWidth = 3; x.beginPath(); x.arc(c, c, r, 0, TAU); x.stroke(); x.beginPath(); x.arc(c, c, r - 26, 0, TAU); x.stroke();
    for (var k = 0; k < 72; k++) { var a = k / 72 * TAU, l = k % 9 === 0 ? 22 : 9; x.lineWidth = k % 9 === 0 ? 3 : 1.5; x.beginPath(); x.moveTo(c + Math.sin(a) * r, c - Math.cos(a) * r); x.lineTo(c + Math.sin(a) * (r - l), c - Math.cos(a) * (r - l)); x.stroke(); }
    for (var q = 0; q < 16; q++) { x.save(); x.translate(c, c); x.rotate(q * PI / 8); var L = q % 4 === 0 ? r - 30 : q % 2 === 0 ? r * 0.6 : r * 0.38, w = q % 4 === 0 ? 26 : 14; x.fillStyle = q % 2 === 0 ? "#e6cf98" : "#a88b55"; x.beginPath(); x.moveTo(0, -L); x.lineTo(w, 0); x.lineTo(0, 16); x.lineTo(-w, 0); x.closePath(); x.fill(); x.fillStyle = "rgba(0,0,0,0.22)"; x.beginPath(); x.moveTo(0, -L); x.lineTo(w, 0); x.lineTo(0, 0); x.closePath(); x.fill(); x.restore(); }
    ["N", "E", "S", "W"].forEach(function (s, i) { var a = i * PI / 2; txt(x, s, c + Math.sin(a) * (r + 34), c - Math.cos(a) * (r + 34), "400 40px " + FT.disp, "#e6cf98", 0); }); x.fillStyle = "#1c2a40"; x.beginPath(); x.arc(c, c, 18, 0, TAU); x.fill(); x.strokeStyle = "#d9c08a"; x.lineWidth = 3; x.stroke(); }
  function plaque(x, W, H, t1, t2) { var g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#d8b56a"); g.addColorStop(0.5, "#f1d996"); g.addColorStop(1, "#b88f48"); x.fillStyle = g; x.fillRect(0, 0, W, H); x.strokeStyle = "#7a5a24"; x.lineWidth = 4; x.strokeRect(6, 6, W - 12, H - 12); txt(x, t1, W / 2, H * 0.4, "700 " + Math.round(H * 0.24) + "px " + FT.ui, "#4a3412", 2, "center", W - 30); txt(x, t2, W / 2, H * 0.72, "600 " + Math.round(H * 0.17) + "px " + FT.mono, "#5c4318", 1, "center", W - 30); }
  function postTex() { if (FA.postT) return FA.postT; var k = LOWQ ? 0.5 : 1, c = document.createElement("canvas"); c.width = 2048 * k; c.height = 1024 * k; var x = c.getContext("2d"); x.scale(k, k); x.fillStyle = "#efe9dc"; x.fillRect(0, 0, 2048, 1024);
    pslot(x, "chartA", function (x2, W, H) { sectional(x2, W, H, 3, false); }); pslot(x, "chartB", function (x2, W, H) { sectional(x2, W, H, 9, true); });
    pslot(x, "poster1", function (x2, W, H) { poster(x2, W, H, { sky: ["#f08a4b", "#f6c47a", "#e7b77d"], sun: [0.5, 0.62], sunCol: "#fbe3a6", m1: "#9a4a3c", m2: "#6e3a32", ground: "#4a2c26", plane: "#1f1a1a", band: "#1f3a2c", t1: "LEARN TO FLY", t2: "GENESIS ONE FLIGHT ACADEMY", tc: "#f6e6c4", tc2: "#4dde6f", t3: "GROUND SCHOOL · SIM LESSONS · THE FLIGHT LINE", seed: 1 }); });
    pslot(x, "poster2", function (x2, W, H) { poster(x2, W, H, { sky: ["#2f7f86", "#9fd0c4", "#e8d8b0"], sun: [0.3, 0.55], sunCol: "#f6e8c0", m1: "#7a8f8a", m2: "#526860", ground: "#c4a77b", plane: "#1b2b2d", band: "#f2e6cf", t1: "FLY THE BORDER", t2: "DOUGLAS · AGUA PRIETA · 1928", tc: "#1b3b3f", tc2: "#a3583a", t3: "AN AIRFIELD SINCE 1928", seed: 2, bi: true }); });
    pslot(x, "poster3", function (x2, W, H) { poster(x2, W, H, { sky: ["#1b2a52", "#6a5a8a", "#e9a77a"], sun: [0.68, 0.7], sunCol: "#f7c98a", m1: "#3a2f4a", m2: "#2a2238", ground: "#22192a", plane: "#0c0a10", band: "#b3342b", t1: "NIGHT CIRCUITS", t2: "WHEN THE STARS COME OUT", tc: "#f6e6c4", tc2: "#f4cd5a", t3: "RUNWAY 03/21 · LIGHTS ON", seed: 3 }); x2.save(); x2.strokeStyle = "rgba(255,255,255,0.0)"; x2.restore(); });
    ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"].forEach(function (key, i) { pslot(x, key, function (x2, W, H) { photoSil(x2, W, H, i); }); });
    pslot(x, "rug", function (x2, W, H) { rug(x2, W, H); });
    pslot(x, "plq1", function (x2, W, H) { plaque(x2, W, H, "SMOOTHEST LANDING", "SOLPORT CIRCUIT · SPRING"); }); pslot(x, "plq2", function (x2, W, H) { plaque(x2, W, H, "TOP STUDENT", "GROUND SCHOOL · CLASS ONE"); }); pslot(x, "plq3", function (x2, W, H) { plaque(x2, W, H, "SAFETY AWARD", "ZERO INCIDENTS · FLIGHT LINE"); });
    pslot(x, "engine", function (x2, W, H) { x2.fillStyle = "#231b13"; x2.fillRect(0, 0, W, H); x2.strokeStyle = "#b99a62"; x2.lineWidth = 4; x2.strokeRect(5, 5, W - 10, H - 10); txt(x2, "CUTAWAY · FOUR-CYLINDER OPPOSED ENGINE", W / 2, H * 0.38, "700 22px " + FT.ui, "#e3c587", 2, "center", W - 30); txt(x2, "Air-cooled, the heart of a four-seat trainer", W / 2, H * 0.72, "400 18px " + FT.ui, "#efe6d4", 0, "center", W - 30); });
    pslot(x, "tablet", function (x2, W, H) { x2.fillStyle = "#07120c"; x2.fillRect(0, 0, W, H); txt(x2, "DISPATCH", W / 2, H * 0.25, "700 26px " + FT.mono, "#4dde6f", 3); txt(x2, "CHECK IN", W / 2, H * 0.52, "700 30px " + FT.ui, "#f5f1e6", 2); txt(x2, "SIGN OUT · LOGBOOK", W / 2, H * 0.78, "600 16px " + FT.mono, "#a9c7b2", 1); });
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ULTRA ? 16 : 8; t.userData.avShared = true; FA.postT = t; return t; }
  // carpet tiles: 50 cm tiles laid quarter-turn (the canvas covers 1 m); tinted per room by vertex colour
  function ctileTex() { if (FA.ctT) return FA.ctT; var N = 256, c = document.createElement("canvas"); c.width = c.height = N; var x = c.getContext("2d"), R = rng(77); x.fillStyle = "#a3a29e"; x.fillRect(0, 0, N, N);
    for (var ty = 0; ty < 2; ty++) for (var tx = 0; tx < 2; tx++) { var ox = tx * 128, oy = ty * 128, hor = (tx + ty) % 2 === 0;
      for (var s = 0; s < 64; s++) { var v = 150 + Math.round(R() * 26) + (s % 2 ? 12 : -8); x.fillStyle = "rgb(" + v + "," + v + "," + (v - 3) + ")"; if (hor) x.fillRect(ox, oy + s * 2, 128, 2); else x.fillRect(ox + s * 2, oy, 2, 128); }
      for (var k = 0; k < 1400; k++) { var w = 110 + Math.round(R() * 70); x.fillStyle = "rgba(" + w + "," + w + "," + w + ",0.4)"; x.fillRect(ox + R() * 128, oy + R() * 128, hor ? 3 : 1, hor ? 1 : 3); }
      x.fillStyle = "rgba(70,70,68,0.45)"; x.fillRect(ox, oy, 128, 1.5); x.fillRect(ox, oy, 1.5, 128); }
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ULTRA ? 16 : 8; t.userData.avShared = true; FA.ctT = t; return t; }
  // acoustic ceiling tiles: 60 cm mineral-fibre tiles in a white T-bar grid (the canvas covers 1.2 m), albedo and a normal map from one height field
  function ceilMaps() { if (FA.ceilT) return; var N = 256, R = rng(5), h = new Float32Array(N * N), A = new Uint8ClampedArray(N * N * 4);
    for (var j = 0; j < N; j++) for (var i = 0; i < N; i++) { var e = Math.min(i % 128, 127 - (i % 128), j % 128, 127 - (j % 128)), idx = j * N + i; h[idx] = e < 3 ? 1 : e < 5 ? 0.5 : 0; }
    for (var k = 0; k < 3000; k++) { var px = Math.floor(R() * N), py = Math.floor(R() * N), len = 1 + Math.floor(R() * 4), dir = R() < 0.5; for (var q = 0; q < len; q++) { var ii = (px + (dir ? q : 0)) % N, jj = (py + (dir ? 0 : q)) % N, id2 = jj * N + ii; if (h[id2] < 0.4) h[id2] = -0.7; } }
    for (var p = 0; p < N * N; p++) { var hv = h[p], bar = hv > 0.9, fis = hv < -0.5, nz = (R() - 0.5) * 8; var r = bar ? 212 : fis ? 196 : 234 + nz, g = bar ? 214 : fis ? 192 : 231 + nz, b = bar ? 216 : fis ? 186 : 225 + nz; A[p * 4] = r; A[p * 4 + 1] = g; A[p * 4 + 2] = b; A[p * 4 + 3] = 255; }
    var mk = function (data, srgb) { var c = document.createElement("canvas"); c.width = c.height = N; var x = c.getContext("2d"); var im = x.createImageData(N, N); im.data.set(data); x.putImageData(im, 0, 0); var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = ULTRA ? 16 : 8; t.repeat.set(1 / 1.2, 1 / 1.2); t.userData.avShared = true; return t; };
    var Nn = new Uint8ClampedArray(N * N * 4), kk = 2.2; for (var y = 0; y < N; y++) for (var xx = 0; xx < N; xx++) { var l = h[y * N + (xx + N - 1) % N], r2 = h[y * N + (xx + 1) % N], u = h[((y + N - 1) % N) * N + xx], dn = h[((y + 1) % N) * N + xx]; var nx = -(r2 - l) * kk, ny = (dn - u) * kk, nzz = 1, L = Math.hypot(nx, ny, nzz); var o = (y * N + xx) * 4; Nn[o] = (nx / L * 0.5 + 0.5) * 255; Nn[o + 1] = (ny / L * 0.5 + 0.5) * 255; Nn[o + 2] = (nzz / L * 0.5 + 0.5) * 255; Nn[o + 3] = 255; }
    FA.ceilT = mk(A, true); FA.ceilN = mk(Nn, false); }
  function ceilTex() { ceilMaps(); return FA.ceilT; }
  function ceilNrm() { ceilMaps(); return FA.ceilN; }

  // ───────────────────────── the design geometry ─────────────────────────
  function framed(K, xw, sgn, zc, yc, w, h, mat, uv) { var d = 0.035, ry = sgn > 0 ? PI / 2 : -PI / 2; K.box("walnut", 0xffffff, d, h + 0.08, w + 0.08, xw + sgn * d / 2, yc - h / 2 - 0.04, zc); K.plane(mat, 0xffffff, w, h, xw + sgn * (d + 0.004), yc, zc, ry, 0, uv); }
  var OAK = [0xc8915a, 0xbf8752, 0xd09a63, 0xc48d57, 0xb98250, 0xcc965f];
  function oak(i) { return OAK[(i * 7 + (i >> 2)) % OAK.length]; }
  function slatWall(K, xw, sgn, za, zb, top) { var L = zb - za, i = 0; K.box("felt", 0xffffff, 0.02, top, L, xw + sgn * 0.01, 0, (za + zb) / 2); for (var z = za + 0.03; z < zb - 0.02; z += 0.1, i++) K.box("slat", oak(i), 0.035, top - 0.02, 0.045, xw + sgn * 0.0375, 0.01, z); }
  function plant(K, x, z, kind, seed) { var R = rng(seed || 3); K.cyl("stone", 0xffffff, 0.27, 0.22, 0.58, x, 0.29, z, 18); K.cyl("dark", 0x2b241c, 0.25, 0.25, 0.02, x, 0.57, z, 18); K.solid(x, z, 0.56, 0.56, 0, 1.0);
    if (kind === "snake") { for (var i = 0; i < 17; i++) { var a = R() * TAU, rr = R() * 0.12, hgt = 0.55 + R() * 0.55; var g = new THREE.ConeGeometry(0.045, hgt, 4, 1); g.scale(1, 1, 0.22); g.translate(0, hgt / 2, 0); var m = new THREE.Matrix4().compose(new THREE.Vector3(x + Math.cos(a) * rr, 0.57, z + Math.sin(a) * rr), new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 0.35, a, (R() - 0.5) * 0.35, "YXZ")), new THREE.Vector3(1, 1, 1)); K.add("leaf", g, i % 3 === 0 ? 0x5e7f3a : i % 3 === 1 ? 0x2f5a2c : 0x3f6c34, m); } return; }
    K.cyl("walnut", 0xffffff, 0.025, 0.035, 1.35, x, 1.25, z, 6); for (var j = 0; j < 22; j++) { var a2 = R() * TAU, y = 1.05 + R() * 0.95, rr2 = 0.08 + R() * 0.22; var lg = new THREE.SphereGeometry(0.13, 8, 5); lg.scale(1, 0.12, 1.55); var m2 = new THREE.Matrix4().compose(new THREE.Vector3(x + Math.cos(a2) * rr2, y, z + Math.sin(a2) * rr2), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5 + R() * 0.4, a2 + PI / 2, (R() - 0.5) * 0.5, "YXZ")), new THREE.Vector3(1, 1, 1)); K.add("leaf", lg, j % 2 ? 0x3a6a30 : 0x4e7f3c, m2); } }
  function shelfModels(K, xw, sgn, za, zb, y, n) { var L = zb - za; K.box("walnut", 0xffffff, 0.36, 0.035, L, xw + sgn * 0.18, y, (za + zb) / 2); var tpl = planeTemplate();
    for (var i = 0; i < n; i++) { var zc = za + (i + 0.5) * L / n, px = xw + sgn * 0.24; K.cyl("chrome", 0xffffff, 0.006, 0.006, 0.09, px, y + 0.08, zc, 6); K.cyl("dark", 0x18191b, 0.05, 0.05, 0.012, px, y + 0.041, zc, 12);
      var m = new THREE.Matrix4().compose(new THREE.Vector3(px, y + 0.11, zc), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08 * (i % 2 ? 1 : -1), sgn > 0 ? PI / 2 : -PI / 2, 0.06 * (i - 1), "YXZ")), new THREE.Vector3(0.062, 0.062, 0.062)); for (var b in tpl) { var g = tpl[b].clone(); g.applyMatrix4(m); K.add(b, g); } } }
  function propeller(K, xw, sgn, zc, yc) { var px = xw + sgn * 0.16; K.box("steel", 0x2e3236, 0.12, 0.2, 0.2, xw + sgn * 0.06, yc - 0.1, zc); var hub = new THREE.CylinderGeometry(0.075, 0.075, 0.14, 18); hub.rotateZ(PI / 2); hub.translate(px, yc, zc); K.add("chrome", hub);
    [1, -1].forEach(function (dir) { for (var s = 0; s < 6; s++) { var r0 = 0.07 + s * 0.16, ch = 0.22 - s * 0.018, tw = 0.16 - s * 0.022, y0 = dir > 0 ? yc + r0 : yc - r0 - 0.16; K.box(s === 5 ? "brass" : "walnut", 0xffffff, 0.045, 0.16, ch, px, y0, zc, tw * dir); } }); }
  function trophyCase(K, xw, sgn, zc) { var dpt = 0.42, W2 = 1.8, x0 = xw + sgn * 0.02, xm = xw + sgn * (dpt / 2 + 0.02); K.box("walnut", 0xffffff, 0.03, 2.1, W2, x0 + sgn * 0.015, 0, zc); K.box("walnut", 0xffffff, dpt, 0.12, W2, xm, 0, zc); K.box("walnut", 0xffffff, dpt, 0.06, W2, xm, 2.04, zc);
    [-1, 1].forEach(function (s) { K.box("walnut", 0xffffff, dpt, 2.1, 0.04, xm, 0, zc + s * (W2 / 2 - 0.02)); }); [0.7, 1.22, 1.74].forEach(function (y) { K.box("glassD", 0xffffff, dpt - 0.04, 0.012, W2 - 0.08, xm, y, zc); });
    K.box("glass", 0xffffff, 0.012, 1.9, W2 - 0.06, xw + sgn * (dpt + 0.02), 0.12, zc); K.box("lampE", 0xffffff, dpt - 0.06, 0.012, W2 - 0.12, xm, 2.02, zc);
    var cup = new THREE.LatheGeometry([[0.0001, 0], [0.05, 0], [0.05, 0.02], [0.014, 0.035], [0.012, 0.1], [0.04, 0.125], [0.06, 0.21], [0.056, 0.215]].map(function (q) { return new THREE.Vector2(q[0], q[1]); }), 16);
    [[0.12, -0.55, 1.0], [1.22 + 0.012, -0.2, 1.25], [0.7 + 0.012, 0.45, 0.9], [1.74 + 0.012, 0.55, 1.1], [0.12, 0.35, 1.3]].forEach(function (q) { var g = cup.clone(); g.scale(q[2], q[2], q[2]); g.translate(xm, q[0], zc + q[1]); K.add("brass", g); });
    [["plq1", 0.7 + 0.012, -0.45], ["plq2", 1.22 + 0.012, 0.35], ["plq3", 1.74 + 0.012, -0.3]].forEach(function (q) { K.box("walnut", 0xffffff, 0.04, 0.16, 0.28, xm, q[1], zc + q[2]); K.plane("poster", 0xffffff, 0.25, 0.07, xm + sgn * 0.022, q[1] + 0.09, zc + q[2], sgn > 0 ? PI / 2 : -PI / 2, 0, postUV(q[0])); });
    K.solid(xm, zc, dpt + 0.04, W2, 0, 2.1); }
  function buildDesign(K) {
    var S = SITE, W = S.W, R = S.rooms, zr = W.z0 + 0.35, dzA = W.z1 - 3.6, zg = W.z1 - 0.2;
    // ── dispatch: a walnut slat feature wall behind the heritage display, a timber baffle ceiling with linear lights, the compass rug, the desk
    slatWall(K, R.lobby[0] + 0.1, 1, zr + 0.1, dzA - 0.15, 3.6);
    K.box("felt", 0xffffff, R.lobby[1] - R.lobby[0] - 0.4, 0.02, W.z1 - W.z0 - 0.6, (R.lobby[0] + R.lobby[1]) / 2, 3.965, (W.z0 + W.z1) / 2);
    var bx0 = R.lobby[0] + 0.45, bx1 = R.lobby[1] - 0.75, bxc = (bx0 + bx1) / 2, bl = bx1 - bx0, si = 0; for (var z = zr + 0.25; z < zg - 0.1; z += 0.3, si++) { if (si % 10 === 4) { K.box("dark", 0x1a1b1d, bl, 0.05, 0.1, bxc, 3.63, z); K.box("lampE", 0xffffff, bl, 0.03, 0.06, bxc, 3.6, z); } else K.box("slat", oak(si), bl, 0.26, 0.05, bxc, 3.66, z); }
    K.box("fabric", 0x1c2a40, 3.64, 0.014, 3.64, -2.7, 0.02, -18.6); K.plane("rugm", 0xffffff, 3.6, 3.6, -2.7, 0.036, -18.6, 0, -PI / 2, postUV("rug"));
    var dx0 = 0.42, dzc = -23.4, dL = 5.0; K.box("felt", 0xffffff, 0.04, 1.0, dL, dx0 + 0.03, 0, dzc); for (var sz = dzc - dL / 2 + 0.05, sj = 0; sz < dzc + dL / 2 - 0.03; sz += 0.09, sj++) K.box("slat", oak(sj), 0.03, 0.98, 0.05, dx0, 0.01, sz);
    K.box("white", 0xe9e6df, 0.86, 0.74, dL - 0.04, dx0 + 0.47, 0, dzc); K.box("walnut", 0xffffff, 0.8, 0.04, dL, dx0 + 0.5, 0.74, dzc); K.box("stone", 0xffffff, 0.42, 0.05, dL + 0.1, dx0 - 0.02, 1.0, dzc);
    [-1, 1].forEach(function (s) { K.box("walnut", 0xffffff, 0.94, 1.05, 0.05, dx0 + 0.45, 0, dzc + s * (dL / 2 + 0.01)); }); K.box("glow", 0x4dde6f, 0.02, 0.025, dL - 0.1, dx0 - 0.24, 0.965, dzc); K.solid(dx0 + 0.45, dzc, 0.98, dL + 0.12, 0, 1.08);
    [["board", -1.15], ["radar", 0], ["weather", 1.15]].forEach(function (q) { var zc = dzc + q[1]; K.box("dark", 0x18191b, 0.04, 0.32, 0.05, dx0 + 0.55, 0.78, zc); K.box("dark", 0x18191b, 0.2, 0.015, 0.24, dx0 + 0.55, 0.78, zc); K.boxc("dark", 0x101113, 0.035, 0.38, 0.64, dx0 + 0.55, 1.29, zc); K.plane("screen", 0xffffff, 0.6, 0.34, dx0 + 0.57, 1.29, zc, PI / 2, 0, atlasUV(q[0])); K.box("dark", 0x222325, 0.17, 0.02, 0.46, dx0 + 0.8, 0.78, zc); });
    K.box("dark", 0x18191b, 0.03, 0.24, 0.36, dx0 - 0.12, 1.05, dzc + 1.7, 0); K.plane("postE", 0xffffff, 0.33, 0.21, dx0 - 0.138, 1.17, dzc + 1.7, -PI / 2, 0, postUV("tablet"));
    K.box("dark", 0x222325, 0.2, 0.07, 0.22, dx0 + 0.75, 0.78, dzc - 2.0); K.box("white", 0xe9e9e6, 0.44, 0.24, 0.4, dx0 + 0.55, 0.78, dzc + 2.05); K.box("white", 0xf6f4ee, 0.3, 0.01, 0.22, dx0 + 0.55, 1.02, dzc + 2.05);
    K.tube("chrome", new THREE.Vector3(dx0 + 0.8, 0.78, dzc - 1.7), new THREE.Vector3(dx0 + 0.72, 1.18, dzc - 1.55), 0.01, 6); K.cyl("chrome", 0xffffff, 0.06, 0.09, 0.08, dx0 + 0.7, 1.12, dzc - 1.5, 12); K.cyl("lampE", 0xffffff, 0.055, 0.055, 0.01, dx0 + 0.7, 1.115, dzc - 1.5, 12);
    plant(K, -0.35, zr + 0.45, "fig", 11); plant(K, 3.25, -12.0, "snake", 12); plant(K, R.lobby[0] + 0.55, zr + 0.5, "snake", 13);
    // ── briefing: carpet tiles (in the wing build), a coffered ceiling with acoustic tiles and linear lights, fabric acoustic panels, charts, a propeller, models
    var bxa = R.brief[0] + 0.1, bxb = R.brief[1] - 0.1, bcx = (bxa + bxb) / 2;
    K.box("ceil", 0xffffff, bxb - bxa, 0.015, W.z1 - W.z0 - 0.5, bcx, 3.97, (W.z0 + W.z1) / 2);
    [-23.5, -20.4, -17.3, -14.2].forEach(function (z) { K.box("plaster", 0xf6f3ee, bxb - bxa, 0.32, 0.22, bcx, 3.66, z); }); [-15.95, -12.05].forEach(function (x) { K.box("plaster", 0xf6f3ee, 0.22, 0.32, W.z1 - W.z0 - 0.5, x, 3.66, (W.z0 + W.z1) / 2); });
    [bxa + 0.06, bxb - 0.06].forEach(function (x) { K.box("plaster", 0xf6f3ee, 0.12, 0.12, W.z1 - W.z0 - 0.5, x, 3.86, (W.z0 + W.z1) / 2); });
    [-17.9, -14.0, -10.1].forEach(function (xc) { [-25.05, -21.95, -18.85, -15.75, -12.7].forEach(function (zc) { K.box("dark", 0x1a1b1d, 2.62, 0.02, 0.1, xc, 3.94, zc); K.box("lampE", 0xffffff, 2.6, 0.025, 0.07, xc, 3.915, zc); }); });
    for (var pc = 0; pc < 4; pc++) for (var pr = 0; pr < 2; pr++) { var za = -26.3 + pc * 2.83; K.box("fabric", 0x4e5d6c, 0.05, 1.22, 2.73, bxb - 0.025, 1.02 + pr * 1.3, za + 1.365); }
    K.box("walnut", 0xffffff, 0.04, 0.05, 11.32, bxb - 0.02, 0.94, -20.64);
    framed(K, bxa, 1, -25.0, 2.15, 1.5, 1.5, "poster", postUV("chartA")); framed(K, bxa, 1, -23.25, 2.15, 1.5, 1.5, "poster", postUV("chartB"));
    propeller(K, bxa, 1, -20.75, 2.25); shelfModels(K, bxa, 1, -16.75, -15.0, 1.62, 2); shelfModels(K, bxa, 1, -16.75, -15.0, 2.32, 1);
    plant(K, bxb - 0.6, -11.9, "fig", 14);
    // ── the classroom: carpet tiles, an acoustic tile ceiling with recessed linear lights, a walnut slat wall with the trophy case and models, posters, a photo wall
    var cxa = R["class"][0] + 0.1, cxb = R["class"][1] - 0.1, ccx = (cxa + cxb) / 2;
    K.box("ceil", 0xffffff, cxb - cxa, 0.02, W.z1 - W.z0 - 0.5, ccx, 3.86, (W.z0 + W.z1) / 2);
    [-29.9, -26.5, -23.1].forEach(function (xc) { [-24.0, -19.8, -15.6].forEach(function (zc) { K.box("steelL", 0xb8bcc0, 2.46, 0.012, 0.22, xc, 3.848, zc); K.box("lampE", 0xffffff, 2.4, 0.012, 0.16, xc, 3.843, zc); }); });
    slatWall(K, cxb, -1, zr + 0.1, dzA - 0.15, 3.84); trophyCase(K, cxb - 0.04, -1, -19.9); shelfModels(K, cxb - 0.04, -1, -18.55, -16.6, 1.62, 3);
    [["poster1", -25.75], ["poster2", -24.6], ["poster3", -23.45]].forEach(function (q) { framed(K, cxa + 0.032, 1, q[1], 2.05, 0.88, 1.23, "poster", postUV(q[0])); });
    var crops = [[0.02, 0.35, 0.47, 0.87], [0.32, 0.25, 0.77, 0.77], [0.55, 0.28, 1.0, 0.8], [0.05, 0.0, 0.95, 1.0]], ph = ["c0", "p0", "p1", "c1", "p2", "p3", "p4", "c2", "p5", "p6", "p7", "c3"];
    for (var pi = 0; pi < 12; pi++) { var col = pi % 4, row = Math.floor(pi / 4), zc2 = -21.85 + col * 1.15, yc = 3.0 - row * 0.68, key = ph[pi]; if (key.charAt(0) === "c") framed(K, cxa + 0.032, 1, zc2, yc, 0.86, 0.56, "photo", crops[+key.charAt(1)]); else framed(K, cxa + 0.032, 1, zc2, yc, 0.86, 0.56, "poster", postUV(key)); }
    var ex = ccx - 5.5, ez = -19.4; K.box("walnut", 0xffffff, 0.05, 0.75, 0.1, ex + 0.55, 0, ez); K.plane("poster", 0xffffff, 0.5, 0.094, ex + 0.585, 0.8, ez, PI / 2, -0.45, postUV("engine"));
    plant(K, cxb - 0.55, -11.95, "snake", 15); plant(K, cxa + 0.55, -11.95, "fig", 16);
  }

  // ───────────────────────── people: Maya Torres (instructor) and Sam Whitfield (dispatch) with talk cards, a few roaming students (PLAN_ROAM) ─────────────────────────
  var STAFF = FA.staff = FA.staff || { list: [] };
  function buildStaff() {
    var ST = C("staff", null); if (!ST || typeof avatar !== "function" || STAFF.done || !player) return; var q = w2l(player.position.x, player.position.z); if (Math.hypot(q[0], q[1]) > 170) return; STAFF.done = true;
    Object.keys(ST).forEach(function (id) { var A = ST[id]; if (CAST.some(function (c) { return c.id === id; })) return; var at = A.at || [0, -20], w = l2w(at[0], at[1]);
      var g = avatar("fa2_" + id, A.name, A.look || {}, A.hat || null, A.outfit || null); g.position.set(w[0], SITE.G + 0.02 + (id === "fa_torres" ? 0 : 0), w[1]); g.rotation.y = wyaw(A.face || 0); try { g.userData.label.scale.set(1.7, 0.43, 1); } catch (e) {} scene.add(g);
      var talk = (A.talk || []).map(function (t) { return { t: t.t, o: t.o }; }); var c = { id: id, name: A.name, role: A.role, pos: [w[0], w[1]], look: A.look, hat: null, outfit: A.outfit || null, greet: A.greet || ["Welcome."], talk: talk, kw: [], g: g, rot: g.rotation.y };
      CAST.push(c); var hs = { x: w[0], z: w[1], r: 3.0, t: c.name, k: c.role + " · press E to talk", p: talk[0] ? talk[0].t : "", play: "npc:" + c.id, fa2: "npc" }; hotspots.push(hs); FA.hs.push(hs); STAFF.list.push(c); FA.n.staff = STAFF.list.length; }); }
  function staffFrame(dt) { var cam = camera.position; STAFF.list.forEach(function (c) { var dd = Math.hypot(c.g.position.x - cam.x, c.g.position.z - cam.z); c.g.visible = dd < 75; if (c.g.visible && (FRAME_N & 1) === 0) try { animateWalk(c.g, 0, dt * 2); } catch (e) {} }); }
  // the roaming students and pilots: the apron walkarounds, the classroom desks, the briefing chart, the lounge, the sim pods, the heritage wall
  function roamArea() {
    var RO = window.PLAN_ROAM; if (!RO || !RO.area || RO.off || FA.roamArea) return; var S = SITE, RC = C("roam", {});
    var P = function (x, z, kind, line, face, tag, dur) { var w = l2w(x, z); return { kind: kind, line: line, x: w[0], z: w[1], face: wyaw(face || 0), tag: tag, dur: dur }; };
    var bb = [1e9, -1e9, 1e9, -1e9]; (S.lotW || []).forEach(function (w) { bb[0] = Math.min(bb[0], w[0]); bb[1] = Math.max(bb[1], w[0]); bb[2] = Math.min(bb[2], w[1]); bb[3] = Math.max(bb[3], w[1]); });
    var def = { id: "academy", max: 6, box: [bb[0] - 2, bb[2] - 2, bb[1] + 2, bb[3] + 2], perCat: true, pull: 3,
      people: (RC.people || []).slice(), lines: RC.lines || {},
      ready: function () { return !!FA.built; },
      levels: [{ base: function (x, z) { var q = w2l(x, z); if (!inLotL(q[0], q[1])) return planGroundAt(x, z); return surfL(q[0], q[1]) + (inRect(q[0], q[1], { x0: 7.7, x1: 32.3, z0: -26.5, z1: -18.3 }) ? 0.16 : 0.02); }, exact: true,
        block: function (x, z) { var q = w2l(x, z); if (!inLotL(q[0], q[1])) return true; if (q[1] > S.A.z1 + 0.5) return true; return false; } }],
      entries: function () { var a = l2w(-5, -36.5), b = l2w(20, -36.8), c = l2w(-58, 4); return [{ x: a[0], z: a[1], face: wyaw(0), tag: "lane" }, { x: b[0], z: b[1], face: wyaw(0), tag: "lane" }, { x: c[0], z: c[1], face: wyaw(PI / 2), tag: "apron" }]; },
      seeds: function () { return def.entries().concat([P(-5, -18), P(20, -10), P(-26, 10), P(-38, -18)]); },
      pois: function () { var out = [];
        S.planes.forEach(function (p, i) { out.push(P(p[0], p[1] + 5.0, "look", "walk", PI, "plane" + i, [8, 16])); out.push(P(p[0] + 6.3, p[1] - 0.2, "look", "walk", -PI / 2, "plane" + i, [6, 12])); out.push(P(p[0] - 6.3, p[1] - 0.2, "look", "walk", PI / 2, "plane" + i, [6, 12])); out.push(P(p[0] + 0.8, p[1] - 6.6, "look", "walk", 0, "plane" + i, [6, 12])); });
        out.push(P(-14, -24.0, "look", "map", PI, "chart", [10, 18])); out.push(P(-12.2, -24.2, "look", "map", PI, "chart", [10, 18]));
        out.push(P(-6.2, -22.2, "look", "heritage", -PI / 2, "heritage", [8, 14])); out.push(P(-1.6, -15.6, "browse", "chat", PI, "logbook", [6, 10]));
        S.pods.forEach(function (p, i) { out.push(P(p[0] + 1.6, p[1] + 3.6, "look", "sim", PI - 0.3, "pod" + i, [8, 16])); });
        out.push(P(S.hplane[0] + 3.2, S.hplane[1] + 4.2, "look", "walk", PI + 0.6, "hplane", [10, 18])); out.push(P(-40.5, -24.6, "browse", "lounge", PI, "coffee", [8, 16]));
        out.push(P(-6, -14, "chat", "chat", 0, "lobby", [12, 24])); out.push(P(-30, -9.4, "chat", "chat", 0, "walk", [12, 24])); out.push(P(10, -31, "chat", "chat", PI, "fore", [12, 24])); out.push(P(S.sock[0] + 6, S.sock[1] - 2, "look", "walk", -PI / 2, "sock", [6, 12]));
        return out; },
      seatInfo: function (s) { if (!s.tag || String(s.tag).indexOf("fa2") !== 0) return null; return { kind: "sit", line: s.tag === "fa2_class" ? "class" : "lounge", tag: s.tag }; },
      weight: function (p, h) { var k = p.kind, t = p.tag || ""; if (h < 7 || h > 21) return k === "sit" ? 0.6 : t.indexOf("pod") === 0 ? 1.2 : 0.2; if (t.indexOf("plane") === 0) return 1.6; if (k === "sit") return 1.0; if (t === "chart" || t.indexOf("pod") === 0) return 1.3; return 0.9; },
      count: function (h) { return h < 7 || h > 22 ? 2 : h > 9 && h < 18 ? 6 : 4; },
      dur: { sit: [30, 70], chat: [14, 30], look: [8, 18], browse: [8, 16] },
      visible: function () { return true; }, sameZone: function () { return true; } };
    try { FA.roamArea = RO.area(def); } catch (e) { note("roam", e); } }

  // ───────────────────────── cards: the lesson brief, the debrief, the pilot logbook (the game's card style), and a lesson tag in flight ─────────────────────────
  var UI = FA.ui = FA.ui || {};
  function css() { if ($id("fa2-css")) return; var s = document.createElement("style"); s.id = "fa2-css"; s.textContent = [
    "#fa2c{width:min(560px,92vw)}#fa2c .fa2b{font:400 14px/1.5 'Space Grotesk',system-ui,sans-serif;color:var(--cream,#f5f1e6);margin:8px 0 12px}",
    "#fa2c ol{margin:6px 0 14px 18px;padding:0;font:400 13px/1.55 'Space Grotesk',system-ui,sans-serif;color:#dfe9e1}#fa2c ol li{margin:2px 0}",
    "#fa2c .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}#fa2c .big{font:400 54px/1 Anton,Impact,sans-serif;color:#4DDE6F;letter-spacing:.02em;margin:6px 0 2px}",
    "#fa2c table{width:100%;border-collapse:collapse;margin:8px 0 10px;font:400 13px 'Space Grotesk',system-ui,sans-serif}#fa2c td{padding:5px 0;border-bottom:1px solid rgba(255,255,255,.08)}#fa2c td.n{text-align:right;font-family:'JetBrains Mono',monospace;color:#f4cd5a}",
    "#fa2c .st{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.07);font:400 13px 'Space Grotesk',system-ui,sans-serif}#fa2c .st i{flex:0 0 14px;height:14px;border-radius:4px;border:1.5px solid rgba(77,222,111,.6)}#fa2c .st.ok i{background:#4DDE6F;border-color:#4DDE6F;box-shadow:0 0 10px rgba(77,222,111,.6)}#fa2c .st b{font-weight:600}#fa2c .st small{margin-left:auto;color:rgba(245,241,230,.55);font-size:11px;text-align:right}",
    "#fa2c .wings{margin:10px 0;padding:10px 12px;border-radius:12px;border:1px solid rgba(244,205,90,.6);background:rgba(244,205,90,.08);color:#f4cd5a;font:600 12px 'JetBrains Mono',monospace;letter-spacing:.16em;text-transform:uppercase}",
    "#fa2c .lg{max-height:170px;overflow:auto;margin-top:6px}#fa2c .lg div{display:flex;justify-content:space-between;font:400 12px 'JetBrains Mono',monospace;color:#cfe3d4;padding:3px 0}",
    "#fa2tag{position:fixed;left:16px;top:16px;z-index:19;padding:7px 12px;border-radius:999px;background:rgba(7,17,12,.78);border:1px solid rgba(77,222,111,.55);color:#4DDE6F;font:600 10px 'JetBrains Mono',monospace;letter-spacing:.18em;text-transform:uppercase;display:none;pointer-events:none}#fa2tag.on{display:block}"].join("\n"); document.head.appendChild(s); }
  function card() { css(); var c = $id("fa2c"); if (!c) { c = document.createElement("div"); c.id = "fa2c"; c.className = "card"; document.body.appendChild(c); } return c; }
  function openCard(html, kind) { var c = card(); c.innerHTML = html; c.classList.add("on"); UI.open = kind; try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {} try { if (typeof sfx === "function") sfx("ui"); } catch (e) {} return c; }
  function closeCard() { var c = $id("fa2c"); if (c) c.classList.remove("on"); UI.open = null; }
  FA.closeCard = closeCard;
  function tag(on, t) { css(); var e = $id("fa2tag"); if (!e) { e = document.createElement("div"); e.id = "fa2tag"; document.body.appendChild(e); } if (t) e.textContent = t; e.classList.toggle("on", !!on); }
  // the lesson log (this device): every lesson flown from a pod
  function logGet() { try { var a = JSON.parse(localStorage.getItem("g1:fa2log") || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function logAdd(r) { var a = logGet(); a.push(r); while (a.length > 40) a.shift(); try { localStorage.setItem("g1:fa2log", JSON.stringify(a)); } catch (e) {} return a.length; }
  function num(v) { return Math.round(v || 0).toLocaleString("en-US"); }
  function lessonCard(i) {
    var L = C("lesson", {}), steps = (L.steps || []).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    var c = openCard("<h2>" + esc(L.title || "Sim lesson") + "</h2><div class='k mono'>Sim Pod " + (i + 1) + " · Instructor Maya Torres</div><div class='fa2b'>" + esc(L.brief || "") + "</div><ol>" + steps + "</ol><div class='row'><button class='btn' id='fa2-go'>Start the lesson (E)</button><button class='btn ghost' id='fa2-x'>Not now (Esc)</button></div>", "lesson");
    UI.pod = i; $id("fa2-go").onclick = function () { closeCard(); lessonStart(UI.pod); }; $id("fa2-x").onclick = closeCard; return c; }
  function logbookCard() {
    var nm = (player && player.userData && player.userData.name) || localStorage.getItem("g1:name") || "Pilot"; var st = C("stamps", []), all = true;
    var rows = st.map(function (s) { var ok = hasStamp(s.id); if (!ok) all = false; return "<div class='st" + (ok ? " ok" : "") + "'><i></i><b>" + esc(s.name) + "</b><small>" + esc(ok ? "Stamped" : s.how || "") + "</small></div>"; }).join("");
    var lg = logGet().slice().reverse(), best = lg.reduce(function (a, r) { return Math.max(a, r.score || 0); }, 0);
    var list = lg.slice(0, 12).map(function (r) { var d = new Date(r.t); return "<div><span>" + d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · Pod " + (r.pod + 1) + "</span><span>" + (r.landed ? num(r.score) + " pts · " + num(r.fpm) + " FPM" : "no landing") + "</span></div>"; }).join("") || "<div><span>No lessons yet. Climb into a sim pod in the hangar.</span></div>";
    openCard("<h2>Pilot logbook</h2><div class='k mono'>" + esc(nm) + " · Genesis One Flight Academy</div>" + rows + (all ? "<div class='wings'>Academy wings · every page stamped</div>" : "") + "<div class='k mono' style='margin-top:12px'>Sim lessons · " + lg.length + (best ? " · best " + num(best) : "") + "</div><div class='lg'>" + list + "</div><div class='row'><button class='btn ghost' id='fa2-x'>Close (Esc)</button></div>", "logbook");
    $id("fa2-x").onclick = closeCard; award("p_fa_academy"); }
  FA.logbook = logbookCard;
  function debriefCard(r) {
    var rows = r.landed ? "<table><tr><td>Gates</td><td class='n'>" + r.gates + " of 9</td></tr><tr><td>Touchdown</td><td class='n'>" + num(r.fpm) + " FPM</td></tr><tr><td>Centreline</td><td class='n'>" + (r.cl || 0).toFixed(1) + " m</td></tr><tr><td>Time</td><td class='n'>" + Math.floor(r.time / 60) + ":" + ("0" + Math.floor(r.time % 60)).slice(-2) + "</td></tr></table>" : "<div class='fa2b'>" + esc(r.why || "The lesson ended before the landing. Every circuit counts: try it again from any pod.") + "</div>";
    var tip = !r.landed ? "Fly the gates in order, then gear down and flaps 35 for Runway 21." : r.fpm > 600 ? "Firm. Hold the nose up a touch in the flare and keep the sink under 600 FPM." : r.cl > 4 ? "Good touchdown. Work on the centreline: small corrections early on final." : r.gates < 9 ? "Nice landing. Next time thread every gate on the way round." : "Smooth and centred. I will sign this one off.";
    openCard("<h2>Debrief</h2><div class='k mono'>" + esc(C("lesson.title", "Lesson 1")) + " · Logbook entry " + r.n + "</div>" + (r.landed ? "<div class='big'>" + num(r.score) + "</div>" : "") + rows + "<div class='fa2b'><b>Maya:</b> " + esc(tip) + "</div><div class='row'><button class='btn' id='fa2-lb'>Open my logbook</button><button class='btn ghost' id='fa2-x'>Close (Esc)</button></div>", "debrief");
    $id("fa2-lb").onclick = function () { logbookCard(); }; $id("fa2-x").onclick = closeCard; }
  addEventListener("keydown", function (e) { if (!UI.open) return; if (e.target && e.target.tagName === "INPUT") return; var c = e.code;
    if (c === "Escape") { closeCard(); e.stopImmediatePropagation(); e.preventDefault(); return; }
    if (c === "KeyE" || c === "Enter") { var b = $id("fa2-go") || $id("fa2-lb") || $id("fa2-x"); if (b) b.click(); e.stopImmediatePropagation(); e.preventDefault(); } }, true);

  // ───────────────────────── the lesson: a sim pod puts you in Giveback One (PLAN_FLIGHT), lined up on Runway 03; the tug brings you home after ─────────────────────────
  var LS = FA.lesson = FA.lesson || { st: "idle" };
  function fade(on) { var f = $id("fade"); if (!f) return; f.style.transition = on ? "opacity .45s" : "opacity .6s"; f.style.opacity = on ? "0.999" : "0"; }   // 0.999: plan_flight clears a fade of exactly 1 when you leave the jet
  function pickJet() { if (typeof view === "undefined" || !view || !view.vehicles) return { err: C("lesson.offline", "offline") };
    var ids = Object.keys(view.vehicles).filter(function (id) { var v = view.vehicles[id]; return v && v.kind === "jet" && Math.abs(v.x) < 2500 && Math.abs(v.z) < 2500; }); ids.sort(function (a, b) { return a === "jet1" ? -1 : b === "jet1" ? 1 : 0; });
    for (var i = 0; i < ids.length; i++) { var v = view.vehicles[ids[i]]; var dr = v.driver && view.players && view.players[v.driver] && v.driver !== ME; if (!dr) return { id: ids[i], v: v }; }
    return { err: C("lesson.busy", "busy") }; }
  function lessonStart(i) {
    if (LS.st !== "idle") return; try { if (riding || inside || (typeof FLY !== "undefined" && FLY.on)) { status("finish what you are doing first"); return; } } catch (e) {}
    var J = pickJet(); if (J.err) { status(J.err); openCard("<h2>Sim Pod " + (i + 1) + "</h2><div class='k mono'>Dispatch</div><div class='fa2b'>" + esc(J.err) + "</div><div class='row'><button class='btn ghost' id='fa2-x'>Close (Esc)</button></div>", "busy"); $id("fa2-x").onclick = closeCard; return; }
    var v = J.v; LS.st = "fade"; LS.pod = i; LS.id = J.id; LS.home = { x: v.x, z: v.z, ry: v.ry }; LS.at = nowMs(); LS.t0 = nowMs(); LS.res = null; LS.resObj = null; LS.failObj = null; LS.ended = 0; LS.lifted = false; FA.n.lessons = (FA.n.lessons || 0) + 1;
    fade(true); tag(true, "Flight Academy · Lesson 1 · Sim Pod " + (i + 1)); try { if (typeof sfx === "function") sfx("board"); } catch (e) {} }
  function lessonFrame() {
    if (LS.st === "idle") return; var now = nowMs(), dt = now - LS.at, FL = window.PLAN_FLIGHT; var pil = FL && FL.piloting && FL.piloting();
    try {
      if (LS.st === "fade" && dt > 520) { var v = view.vehicles[LS.id]; var ry = v.ry, sx = Math.cos(ry), sz = -Math.sin(ry); var spot = [v.x + sx * 6.5, v.z + sz * 6.5]; try { if (typeof onLand === "function" && !onLand(spot[0], spot[1])) spot = [v.x - sx * 6.5, v.z - sz * 6.5]; } catch (e) {} LS.spot = spot; warpTo(spot[0], spot[1]); LS.st = "board"; LS.at = now; LS.tries = 0; LS.bAt = 0; return; }
      // board once the room has us beside the jet (the streamer may hold the warp a moment while the models there load)
      if (LS.st === "board" || LS.st === "boarding") { if (riding && riding.id === LS.id && riding.driver) { LS.st = "towwait"; LS.at = now; return; }
        var jv = view.vehicles[LS.id], me = view.players && view.players[ME]; var near = jv && me && Math.hypot(me.x - jv.x, me.z - jv.z) < 12 && Math.hypot(player.position.x - jv.x, player.position.z - jv.z) < 14;
        if (now - LS.bAt > 1400) { LS.bAt = now; LS.tries++; if (near) { act({ t: "board", v: LS.id }); LS.st = "boarding"; } else if (LS.tries % 2 === 0 && LS.spot && !riding) { try { warpTo(LS.spot[0], LS.spot[1]); } catch (e) {} } }
        if (dt > 14000) return lessonAbort(C("lesson.offline", "The sim could not reach Giveback One.")); return; }
      if (LS.st === "towwait") { fade(true); if (FL && FL.S && pil) { FL.debug.tow(); LS.st = "flying"; LS.at = now; return; } if (dt > 6000) return lessonAbort(C("lesson.offline", "")); return; }
      if (LS.st === "flying") { var R = FL && FL.run; if (!pil) { return lessonReturn(false); }
        if (R && (R.state === "gates" || R.state === "roll") && !LS.lifted) { LS.lifted = R.state === "gates"; }
        // every run flown in the lesson (FLY AGAIN restarts the circuit): the debrief reports the latest landing, else the latest failure
        if (R && R.state === "done" && R.res && R.res !== LS.resObj) { LS.resObj = R.res; var td = R.tds[R.tds.length - 1] || {}; LS.res = { landed: true, score: R.res.total, gates: R.res.nOk, fpm: td.fpm || 0, cl: Math.abs(td.c || 0), time: R.t || 0 }; award("p_fa_lesson"); }
        if (R && R.state === "failed" && R.fail && R.fail !== LS.failObj && !(LS.res && LS.res.landed)) { LS.failObj = R.fail; LS.res = { landed: false, why: R.fail.why ? failWhy(R.fail.why) : null }; }
        var ended = R && (R.state === "done" || R.state === "failed") && !FL.resOpen && !FL.tow && FL.S && FL.S.onGround && FL.S.V < 3;
        if (ended) { if (!LS.ended) LS.ended = now; else if (now - LS.ended > 1300) return lessonReturn(true); } else LS.ended = 0; return; }
      if (LS.st === "ret") { fade(true); var f = $id("fade"); if (f) { f.style.transition = "none"; f.style.opacity = "0.999"; }
        if (pil && FL.tow) { if (dt > 32000) { FL.tow = null; } return; }
        if (pil && !LS.left) { LS.left = true; act({ t: "leave" }); LS.at = now; return; }
        if (riding && dt < 6000) return;
        var p = SITE.pods[LS.pod || 0], w = l2w(p[0], p[1] + 3.9); warpTo(w[0], w[1]); yaw = wyaw(PI); try { player.rotation.y = wyaw(PI); } catch (e) {}
        var c = $id("fl-call"); if (c) c.classList.remove("on"); LS.st = "back"; LS.at = now; return; }
      if (LS.st === "back" && dt > 450) { fade(false); tag(false); var r = LS.res || { landed: false }; r.pod = LS.pod || 0; r.t = Date.now(); r.n = logAdd({ t: r.t, pod: r.pod, landed: !!r.landed, score: r.score || 0, gates: r.gates || 0, fpm: r.fpm || 0, cl: r.cl || 0, time: r.time || 0 }); LS.st = "idle"; LS.left = false; debriefCard(r); return; }
    } catch (e) { note("lesson " + LS.st, e); lessonAbort(); } }
  function failWhy(w) { return { gear: "Gear-up landing: the belly is scraped, nobody is hurt.", hard: "Hard landing. Keep the sink rate under 600 FPM and the wings level.", offrwy: "You touched down in the desert. The lesson counts on the runway.", across: "You touched down across the runway.", time: "Time ran out on this circuit.", rwyexit: "Takeoff abandoned: stay on the runway until you rotate.", abort: "Takeoff abandoned.", left: "You left the jet." }[w] || null; }
  function lessonReturn(towHome) { var FL = window.PLAN_FLIGHT; LS.st = "ret"; LS.at = nowMs(); LS.left = false; fade(true);
    try { if (towHome && FL && FL.S && FL.piloting && FL.piloting() && LS.home) { var s = FL.S, m = (s.M && s.M.mgZ) || 0, h = LS.home; var gx = h.x + Math.sin(h.ry) * m, gz = h.z + Math.cos(h.ry) * m; var d = Math.hypot(gx - s.P.x, gz - s.P.z);
        if (d > 3) FL.tow = { from: [s.P.x, s.P.z], to: [gx, gz], psi: h.ry, t: 0, dur: Math.max(1.6, d / 5500), fadeIn: false, at: performance.now() }; } } catch (e) { note("tow home", e); } }
  function lessonAbort(msg) { LS.st = "idle"; LS.left = false; fade(false); tag(false); if (msg) status(msg); }
  FA.lessonStart = lessonStart; FA.lessonCard = lessonCard;

  // ───────────────────────── the build (defer hook, behind the loading screen), lights, solids, walk surfaces ─────────────────────────
  FA.lights = FA.lights || [];
  function registerSolids(list, tagDef) { var S = SITE, n = 0; list.forEach(function (q) { var w = l2w(q[0], q[1]); var sd = addSolid(w[0], w[1], wyaw(q[6] || 0), q[2], q[3], S.G + q[4], S.G + q[5], q[9] || tagDef || "fa2"); if (sd) { n++; if (q[7]) { sd.seat = true; if (typeof q[8] === "number") sd.face = wyaw(q[8]); } } }); return n; }
  function registerWalks(root) { if (typeof walkAdd !== "function") return 0; root.updateMatrixWorld(true); var n = 0; GEO.walk.forEach(function (g) { try { var c = g.clone(); c.applyMatrix4(root.matrixWorld); walkAdd(c); c.dispose(); n++; } catch (e) { note("walk", e); } g.dispose(); }); GEO.walk = []; return n; }
  function addLights(root) { FA.lightObjs = []; FA.lights.forEach(function (L) { var l; if (L.spot) { l = new THREE.SpotLight(L.c, L.i, L.d, L.ang || 0.6, 0.6, 1.4); var t = new THREE.Object3D(); t.position.set(L.spot[0], L.spot[1], L.spot[2]); root.add(t); l.target = t; } else l = new THREE.PointLight(L.c, L.i, L.d, L.decay || 1.6); l.position.set(L.x, L.y, L.z); l.castShadow = false; l.userData.fa2 = L; root.add(l); FA.lightObjs.push(l); }); }
  function build() {
    if (FA.built || FA.off) return; var S = resolveSite(); if (!S || !S.tY) return; var t0 = nowMs(); FA.lights = [];
    var root = FA.root = new THREE.Group(); root.name = "fa2 academy"; root.position.set(S.cx, S.G, S.cz); root.rotation.y = S.Y; root.userData.noBatch = true; scene.add(root);
    var ext = new THREE.Group(); ext.name = "fa2 exterior"; root.add(ext); var intg = FA.intg = new THREE.Group(); intg.name = "fa2 interior"; intg.userData.interior = true; root.add(intg);
    atlasTex(); atlasLate();
    var K1 = new Kit(); try { buildApron(K1); } catch (e) { note("apron", e); } try { buildWalks(K1); } catch (e) { note("walks", e); } try { buildHangar(K1); } catch (e) { note("hangar", e); } try { buildWing(K1); } catch (e) { note("wing", e); } try { buildOutside(K1); } catch (e) { note("outside", e); }
    try { S.planes.forEach(function (p, i) { placePlane(K1, p[0], p[1], 0, apronY(p[0], p[1]), i + 1, true); }); } catch (e) { note("planes", e); }
    FA.n.extTris = Math.round(K1.tris); var sol1 = K1.sol; FA.extMeshes = K1.build(ext, { cast: true });
    var K2 = new Kit(); try { buildHangarIn(K2); } catch (e) { note("hangar in", e); } try { buildWingIn(K2); } catch (e) { note("wing in", e); } try { buildDesign(K2); } catch (e) { note("design", e); }
    FA.n.intTris = Math.round(K2.tris); var sol2 = K2.sol; FA.intMeshes = K2.build(intg, { cast: false }); FA.intMeshes.forEach(function (m) { if (/steel|white|walnut|leather|paint|chrome/.test(m.name)) m.castShadow = true; });
    try { buildWindsock(root); } catch (e) { note("windsock", e); }
    try { biplane(intg); } catch (e) { note("biplane", e); }
    try { addLights(root); } catch (e) { note("lights", e); }
    try { FA.n.solids = registerSolids(sol1) + registerSolids(sol2); } catch (e) { note("solids", e); }
    try { FA.n.walks = registerWalks(root); } catch (e) { note("walks reg", e); }
    // one program family: the indoor patch on every standard academy material, then the R16 building-material pass
    try { for (var k in MATS) { var m = MATS[k]; if (m && m.isMeshStandardMaterial && !m.transparent) inPatch(m); } } catch (e) { note("in patch", e); }
    try { bmat(); } catch (e) { note("bmat", e); }
    inUpdate();
    // the pods, the logbook and the heritage wall as interaction points (the client's prompt shows them)
    try { S.pods.forEach(function (p, i) { var w = l2w(p[0], p[1] + 3.0); var h = { x: w[0], z: w[1], r: 2.3, t: "Sim Pod " + (i + 1) + ": start a lesson", k: "Sim Center · Genesis One Flight Academy", p: C("info.simcenter.p", ""), fa2: "pod", pod: i }; hotspots.push(h); FA.hs.push(h); });
      var lb = l2w(-1.6, -15.6); var hl = { x: lb[0], z: lb[1], r: 1.7, t: "Pilot logbook", k: "Dispatch · press E", p: "", fa2: "logbook" }; hotspots.push(hl); FA.hs.push(hl);
      var ha = FA.heritageAt || [-6.4, -21.5]; hsAdd("heritage", ha[0], ha[1], 2.4); hsAdd("dispatch", -2.2, -21.0, 1.6); } catch (e) { note("hotspots 2", e); }
    try { if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(root, { name: "fa2 academy" }); } catch (e) { note("warm", e); }
    try { scrubLot(); } catch (e) { note("scrub", e); }
    try { buildFlyer(); } catch (e) { note("flyer build", e); }
    FA.built = true; FA.n.buildMs = Math.round(nowMs() - t0); FA.n.meshes = (FA.extMeshes || []).length + (FA.intMeshes || []).length; }
  var VEGM = /leaf|bark|trunk|tripo|palm|cact|agave|yucca|bush|shrub|ocotillo|saguaro|mesquite|paloverde|willow|ironwood|cholla|pear|organ|grass|rock|boulder|stone_0|namaqua|searsia|rooibos/i;
  function scrubLot() { var S = SITE; if (!S || !S.lot) return 0; var n = 0, mine = FA.myPlants || [], O = l2w(-6, 2);
    var isMine = function (x, z) { for (var i = 0; i < mine.length; i++) if (Math.abs(mine[i][0] - x) < 0.8 && Math.abs(mine[i][1] - z) < 0.8) return true; return false; };
    var inL = function (x, z) { if (Math.abs(x - O[0]) > 90 || Math.abs(z - O[1]) > 90) return false; var q = w2l(x, z); return inLotL(q[0], q[1]); };
    try { if (typeof INSTCULL !== "undefined") INSTCULL.forEach(function (Cc) { var m0 = Cc.ims && Cc.ims[0] && Cc.ims[0].material; var nm = (m0 && m0.name) || ""; if (nm && !VEGM.test(nm) && !/^$/.test(nm)) { /* props stay */ if (!/inst/i.test(nm)) return; } var hit = 0; for (var i = 0; i < Cc.n; i++) { var x = Cc.xs[i], z = Cc.zs[i]; if (!(x < 1e6)) continue; if (inL(x, z) && !isMine(x, z)) { Cc.xs[i] = 1e7; Cc.zs[i] = 1e7; hit++; } } if (hit) { Cc.cx = 1e9; n += hit; } }); } catch (e) { note("scrub cull", e); }
    try { var mineSet = new Set(); FA.root.traverse(function (o) { mineSet.add(o); }); var m4 = new THREE.Matrix4(), v = new THREE.Vector3(), sph = new THREE.Sphere();
      var managed = new Set(); try { INSTSET.forEach(function (I) { [I.insts, I.far, I.far2].forEach(function (a) { (a || []).forEach(function (m) { managed.add(m); }); }); }); } catch (e) {}
      scene.traverse(function (o) { if (!o.isInstancedMesh || mineSet.has(o) || managed.has(o) || !o.count || !o.material) return; var nm = (Array.isArray(o.material) ? o.material[0] : o.material).name || ""; if (!VEGM.test(nm)) return; if (o.count > 20000) return; var hit = 0;
        for (var i = 0; i < o.count; i++) { o.getMatrixAt(i, m4); v.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld); if (inL(v.x, v.z) && !isMine(v.x, v.z)) { m4.makeScale(0, 0, 0); o.setMatrixAt(i, m4); hit++; } } if (hit) { o.instanceMatrix.needsUpdate = true; n += hit; } }); } catch (e) { note("scrub inst", e); }
    FA.n.scrubbed = (FA.n.scrubbed || 0) + n; return n; }
  FA.scrub = scrubLot;
  // the 1928-style biplane over the hangar floor (the client's model, as at the Stellar FBO), on two cables
  function biplane(g) { if (!has("biplane") || typeof makeModel !== "function") return; var b = makeModel("biplane"); if (!b) return; var R = (MODELS.biplane.radius || 4.5); var sc = 7.6 / (R * 2); b.scale.setScalar(sc); b.position.set(13.5, 6.4, -10.5); b.rotation.set(-0.06, 0.55, 0.1, "YXZ"); b.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); g.add(b);
    var K = new Kit(); [[-2.2, 0], [2.2, 0]].forEach(function (o) { var x = 13.5 + o[0] * Math.cos(0.55), z = -10.5 - o[0] * Math.sin(0.55); K.tube("steel", new THREE.Vector3(x, 7.2, z), new THREE.Vector3(x, FA.roofY(z) - 0.7, z), 0.008, 4); }); K.build(g, {}); FA.n.biplane = 1; }

  // ───────────────────────── a fifth trainer (G1-05 in the log, the fleet's fin art) flying slow practice orbits, purely visual ─────────────────────────
  // A runway-aligned oval 300 m above the north-west of the site (Genesis Park side), at least 300 m off the runway axis (the
  // arrivals and departures stay on the axis), 40 m/s with coordinated banks near 30 degrees. Not on low. ?fa2fly=0 leaves it out.
  function buildFlyer() { if (FA.flyer || LOWQ || /[?&]fa2fly=0\b/.test(location.search)) return; var S = SITE; if (!S) return;
    var K = new Kit(); placePlane(K, 0, 0, 0, 0, 2, false); K.sol = []; var g = new THREE.Group(); g.name = "fa2 practice trainer"; g.rotation.order = "YXZ"; K.build(g, { cast: false });
    g.children.forEach(function (m) { m.castShadow = false; m.receiveShadow = false; }); g.userData.noBatch = true; scene.add(g);
    var cA = -150, cC = -560; FA.flyer = { g: g, th: 0, yaw: null, roll: 0, ctr: [S.mid[0] + S.u[0] * cA + S.p[0] * cC, S.mid[1] + S.u[1] * cA + S.p[1] * cC], Ra: 320, Rc: 260, v: 40, h: 300 }; FA.n.flyer = 1; }
  function flyerAt(F2, th) { var S = SITE, a = F2.Ra * Math.cos(th), c = F2.Rc * Math.sin(th); return [F2.ctr[0] + S.u[0] * a + S.p[0] * c, F2.ctr[1] + S.u[1] * a + S.p[1] * c]; }
  function flyerFrame(dt) { var F2 = FA.flyer; if (!F2) return; dt = clamp(dt || 0.016, 0, 0.1);
    var p0 = flyerAt(F2, F2.th), p1 = flyerAt(F2, F2.th + 0.001), ds = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 0.001; F2.th = (F2.th + F2.v * dt / Math.max(1, ds)) % TAU;
    var q = flyerAt(F2, F2.th), q2 = flyerAt(F2, F2.th + 0.002), yaw = Math.atan2(q2[0] - q[0], q2[1] - q[1]);
    var w = F2.yaw === null ? 0 : Math.atan2(Math.sin(yaw - F2.yaw), Math.cos(yaw - F2.yaw)) / Math.max(1e-3, dt); F2.yaw = yaw;
    var bank = -Math.atan(F2.v * clamp(w, -0.6, 0.6) / 9.81); F2.roll += (bank - F2.roll) * Math.min(1, dt * 1.5);
    var gy = 0; try { gy = getH(q[0], q[1]); } catch (e) {} F2.g.position.set(q[0], gy + F2.h + 14 * Math.sin(F2.th * 2), q[1]); F2.g.rotation.set(-0.04, yaw, F2.roll); }
  // ───────────────────────── per frame: night levels, the windsock, visibility, staff, people, stamps, the lesson ─────────────────────────
  var FR = 0, WALKAROUND = FA.walkaround = FA.walkaround || { pts: {}, at: 0 }, SITT = 0;
  function frame(dt, now) {
    if (FA.off || !FA.built) return; FR++; var S = SITE, t = (now || nowMs()) / 1000, nk = nightK();
    try { sockFrame(t); } catch (e) {}
    try { flyerFrame(dt); } catch (e) { note("flyer", e); }
    if ((FR % 20) === 1) { try {
      var cam = camera.position, cq = w2l(cam.x, cam.z), near = Math.hypot(cq[0] + 5, cq[1] + 5) < 130; if (FA.intg) FA.intg.visible = near || insideL(cq[0], cq[1]);
      var L = MATS.lampE; if (L) L.emissiveIntensity = 0.25 + 2.4 * nk; var sc = MATS.screen; if (sc) sc.emissiveIntensity = 0.75 + 0.35 * nk; var ch = MATS.chart; if (ch) ch.emissiveIntensity = 0.12 * nk;
      var gl = MATS.glow; if (gl) gl.color.setScalar(1 + 2.2 * nk);
      (FA.lightObjs || []).forEach(function (l) { var D = l.userData.fa2; l.intensity = D.i * (D.night >= 1 ? nk : (1 - D.night) + D.night * nk); });
      INU.uFaK.value.set(0.42 + 0.2 * nk, 0.55 + 0.2 * nk, 0.6, 0.7);
    } catch (e) { note("night", e); } }
    if ((FR % 30) === 5) { try { buildStaff(); if (!FA.roamArea) roamArea(); } catch (e) { note("people", e); } }
    if (FR === 90 || FR === 600 || FR === 2400) { try { hideLate(); scrubLot(); } catch (e) { note("scrub late", e); } }
    try { staffFrame(dt || 0.016); } catch (e) {}
    if ((FR % 6) === 3 && player && !riding) { try { stamps(); } catch (e) { note("stamps", e); } }
    try { lessonFrame(); } catch (e) { note("lesson frame", e); }
  }
  function stamps() { var S = SITE, p = player.position, q = w2l(p.x, p.z), x = q[0], z = q[1];
    if (Math.abs(x + 5) > 90 || Math.abs(z) > 70) return;
    if (inRect(x, z, { x0: S.rooms.lobby[0], x1: S.rooms.lobby[1], z0: S.W.z0, z1: S.W.z1 }, -0.4) && !FA.got.p_fa_academy) award("p_fa_academy");
    // the walkaround: the nose and propeller, both wing tips, the tail, of any one trainer on the apron, within three minutes
    var tn = nowMs(); S.planes.forEach(function (pl, i) { var marks = [[0, 4.4], [5.9, 0], [-5.9, 0], [0, -5.6]]; marks.forEach(function (m, j) { if (Math.hypot(x - (pl[0] + m[0]), z - (pl[1] + m[1])) < 2.4) { var key = i + ":" + j; if (!WALKAROUND.pts[key]) { WALKAROUND.pts[key] = tn; var got = [0, 1, 2, 3].filter(function (jj) { var v = WALKAROUND.pts[i + ":" + jj]; return v && tn - v < 180000; }).length; if (!hasStamp("p_fa_preflight")) status("Preflight " + C("fleet", [])[i] + ": " + ["nose and propeller", "left wing tip", "right wing tip", "tail"][j] + " checked (" + got + " of 4)"); if (got >= 4) award("p_fa_preflight"); } } }); });
    // ground school: seated at the briefing table or a classroom desk for a few seconds
    var seated = false; try { if (SIT.on) { for (var k = 0; k < SOLIDS.length; k++) { var sd = SOLIDS[k]; if (sd.seat && sd.tag === "fa2_class" && Math.abs(sd.x - p.x) < 0.7 && Math.abs(sd.z - p.z) < 0.7) { seated = true; break; } } } } catch (e) {}
    if (seated) { if (!SITT) SITT = nowMs(); if (nowMs() - SITT > 3000 && !FA.got.p_fa_groundschool) { award("p_fa_groundschool"); status("Ground school: the four forces, the circuit, the radio. Logged."); } } else SITT = 0; }
  // E: the pods (a lesson card), the logbook, the heritage wall and the chart (stamps, then the client's info card)
  function handleE() { if (UI.open) return true; if (LS.st !== "idle") return true; try { if (riding || inside || SIT.on || cartMode) return false; } catch (e) {}
    var h = null; try { h = nearestHotspot(); } catch (e) {} if (!h || !h.fa2) return false;
    if (h.fa2 === "pod") { lessonCard(h.pod); return true; } if (h.fa2 === "logbook") { logbookCard(); return true; }
    if (h.fa2 === "heritage") award("p_fa_1928"); if (h.fa2 === "briefing") award("p_fa_groundschool"); if (h.fa2 === "dispatch") award("p_fa_academy"); return false; }
  function installOverrides() {
    if (FA.ovr) return; FA.ovr = true;
    try { var o0 = openNearest; openNearest = function () { try { if (handleE()) return; } catch (e) { note("E", e); } return o0.apply(this, arguments); }; } catch (e) { note("ovr E", e); }
    try { var st0 = showTalk; showTalk = function (c) { try { if (c && c.id === "fa_torres") award("t_fa_torres"); if (c && c.id === "fa_sam") award("p_fa_academy"); } catch (e) {} return st0.apply(this, arguments); }; } catch (e) { note("ovr talk", e); }
  }
  // ───────────────────────── API and debug ─────────────────────────
  FA.api = { lessonStart: function (i) { return lessonStart(i || 0); }, logbook: function () { return logbookCard(); }, surf: FA.surf, l2w: function (x, z) { return l2w(x, z); }, w2l: function (x, z) { return w2l(x, z); } };
  FA.debug = {
    l2w: function (x, z) { return l2w(x, z); }, w2l: function (x, z) { return w2l(x, z); },
    // a camera in the site frame: from (lx, ly above the pad, lz) toward (tx, ty, tz)
    cam: function (lx, ly, lz, tx, ty, tz, fov) { var S = SITE, a = l2w(lx, lz), b = l2w(tx, tz); window.__cam = [a[0], S.G + ly, a[1], b[0], S.G + ty, b[1], fov || 0]; return [Math.round(a[0]), Math.round(a[1])]; },
    at: function (lx, lz, face) { var w = l2w(lx, lz); try { if (inside) leaveInterior(); } catch (e) {} player.position.set(w[0], FA.surf(w[0], w[1]) + 0.05, w[1]); if (face !== undefined) { yaw = wyaw(face); player.rotation.y = yaw; } try { updateCulling(true); } catch (e) {} return [Math.round(w[0]), Math.round(w[1])]; },
    stamps: function () { var o = {}; (C("stamps", []) || []).forEach(function (s) { o[s.id] = hasStamp(s.id); }); return o; },
    lesson: function () { return { st: LS.st, pod: LS.pod, id: LS.id, res: LS.res, home: LS.home }; },
    counts: function () { var o = { ext: 0, int: 0, tris: 0 }; (FA.extMeshes || []).forEach(function (m) { o.ext++; o.tris += m.geometry.attributes.position.count / 3; }); (FA.intMeshes || []).forEach(function (m) { o.int++; o.tris += m.geometry.attributes.position.count / 3; }); o.tris = Math.round(o.tris); return o; }
  };
  // ───────────────────────── hooks ─────────────────────────
  if (!FA.hooked) { FA.hooked = true; var HK = window.PLAN_HOOKS;
    HK.terrain.unshift({ name: "fa2Keep", fn: function () { try { keepEarly(); } catch (e) { note("keep early", e); } } });
    HK.terrain.push({ name: "fa2Terrain", fn: function () { try { terrainHook(); } catch (e) { note("terrain", e); } } });
    HK.world.push({ name: "fa2World", fn: function () { try { worldHook(); } catch (e) { note("world", e); } } });
    HK.world.unshift({ name: "fa2KeepWorld", fn: function () { try { keepEarly(); } catch (e) { note("keep world", e); } } });
    HK.defer.push({ name: "fa2Defer", fn: function () { try { hideLate(); build(); } catch (e) { note("defer", e); } } });
    HK.frame.push({ name: "fa2Frame", fn: function (dt, now) { try { frame(dt, now); } catch (e) { note("frame", e); } } }); }
})();
