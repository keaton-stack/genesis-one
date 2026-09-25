// The Outpost, the landmarks and the land art of Stage Three (master plan drop B4).
// Loaded before client.js. Classic script: never declare top-level const/let/var here, register on window only.
// Everything runs from PLAN_HOOKS in PLAN mode and reaches the client's globals by bare name at call time:
//   world   positions, models (put / planPut), walkable ribbons, keep-outs, colliders, hotspots, the berm line
//   terrain the Genesis Ring mound and the Launch Complex earth berm (edits H before the ground mesh is built)
//   defer   every mesh, at the final ground and ribbon heights (walkAt), and the box solids
//   frame   night, the dark-sky hour, the Landing Light Pause, the mists, the clock; only near the camera
// State for other modules and for testing: window.PLAN_OUTPOST (positions, counts, errors) and window.PLAN_LLP.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var HK = window.PLAN_HOOKS;
  var SK = window.PLAN_SKIP = window.PLAN_SKIP || new Set();
  function skipId(id) { if (SK && typeof SK.add === "function") SK.add(id); else if (Array.isArray(SK) && SK.indexOf(id) < 0) SK.push(id); }
  // fountains and buildings this module builds itself (A1 would otherwise put a lathe fountain or a stand-in there)
  ["halo_mist", "launch_mist", "compass_f", "cascade", "water_table", "planet_mercury", "planet_venus", "planet_earth", "planet_mars", "planet_jupiter", "planet_saturn", "planet_uranus", "planet_neptune", "b0291", "hs:genesis_dome"].forEach(skipId);

  // the new model kinds this module places (loadModels may load a PLAN_MODEL_SPECS kind only when something declares it)
  var NEEDS = window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || []; ["lander", "rover", "stratos", "habitat", "mission", "agave_cluster"].forEach(function (k) { if (NEEDS.indexOf(k) < 0) NEEDS.push(k); });
  var OP = window.PLAN_OUTPOST = { v: 1, built: false, err: [], pos: {}, n: {}, items: [], lights: [], mats: null, darkSky: 0, llp: 0, u: { t: { value: 0 }, night: { value: 0 }, px: { value: 900 } } };
  var TAU = Math.PI * 2, DEG = Math.PI / 180;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  var seedN = 20260924; function rr() { seedN = (seedN * 1664525 + 1013904223) >>> 0; return seedN / 4294967296; }   // our own random: never disturbs the engine's rnd() sequence
  function hsh(n) { var s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function note(where, e) { var m = where + ": " + ((e && e.message) || e); OP.err.push(m); if (OP.err.length < 12) console.warn("plan_outpost " + m); }
  function safe(name, fn) { try { fn(); OP.n[name] = OP.n[name] || 1; } catch (e) { note(name, e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); } }
  function place(id) { try { return planPlace(id); } catch (e) { return null; } }
  function prom(id) { try { var r = PLAN_IDX.prom.get(id); return r || null; } catch (e) { return null; } }
  function fount(id) { try { return PLAN_IDX.fount.get(id) || null; } catch (e) { return null; } }
  // the walkable surface: a ribbon or plaza top where there is one, else the ground
  function surf(x, z) { var h = getH(x, z), w = walkAt(x, z); return w !== null && w > h - 0.6 && w < h + 2.5 ? Math.max(h, w) : h; }
  function inPlaza(x, z, pad) { for (var i = 0; i < PLAZAS.length; i++) { var p = PLAZAS[i]; if (Math.hypot(p[0] - x, p[1] - z) < p[2] + (pad || 0)) return true; } return false; }
  function spotFree(x, z, r, own) { return !planNearRoad(x, z, r, own) && !planNearCollider(x, z, r) && !planPolyBlocked(x, z); }
  function polyLen(pts) { var L = 0; for (var i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return L; }
  // point, unit direction and right-hand normal at distance d along a polyline
  function at(pts, d) { var acc = 0; for (var i = 0; i < pts.length - 1; i++) { var a = pts[i], b = pts[i + 1]; var L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue; if (d <= acc + L || i === pts.length - 2) { var t = clamp((d - acc) / L, 0, 1), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L; return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, ux: ux, uz: uz, rx: -uz, rz: ux }; } acc += L; } var p = pts[pts.length - 1]; return { x: p[0], z: p[1], ux: 1, uz: 0, rx: 0, rz: 1 }; }
  // right of travel for heading (ux, uz) in x-east / z-south is (-uz, ux)
  function yawOf(dx, dz) { return Math.atan2(dx, dz); }   // three.js yaw that turns local +z to (dx, dz)
  var _o = null;
  function mtx(x, y, z, ry, rx, rz, sx, sy, sz) { if (!_o) _o = new THREE.Object3D(); _o.position.set(x, y, z); _o.rotation.set(rx || 0, ry || 0, rz || 0, "YXZ"); var s = sx === undefined ? 1 : sx; _o.scale.set(s, sy === undefined ? s : sy, sz === undefined ? s : sz); _o.updateMatrix(); return _o.matrix.clone(); }
  function scaleUV(g, su, sv) { var uv = g.attributes.uv; if (!uv) return g; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); uv.needsUpdate = true; return g; }
  // a box whose uvs are in tiles of `tile` metres on every face (BoxGeometry face order px nx py ny pz nz)
  function boxUV(w, h, d, tile) { var g = new THREE.BoxGeometry(w, h, d); var uv = g.attributes.uv, t = tile || 1; var dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (var f = 0; f < 6; f++) for (var k = 0; k < 4; k++) { var i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } return g; }
  // merge many geometries (optionally transformed) into one non-indexed geometry with normals, uvs and (optional) colours
  function Batch() { this.g = []; }
  Batch.prototype.add = function (geo, m, col) { var g = geo.index ? geo.toNonIndexed() : geo.clone(); if (m) g.applyMatrix4(m); if (!g.attributes.normal) g.computeVertexNormals(); if (col) { var n = g.attributes.position.count, c = new Float32Array(n * 3); for (var i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; } g.setAttribute("color", new THREE.BufferAttribute(c, 3)); } this.g.push(g); return this; };
  Batch.prototype.geo = function () { if (!this.g.length) return null; var n = 0, hasC = false; this.g.forEach(function (g) { n += g.attributes.position.count; if (g.attributes.color) hasC = true; });
    var pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = hasC ? new Float32Array(n * 3).fill(1) : null, o = 0;
    this.g.forEach(function (g) { var c = g.attributes.position.count; pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2); if (col && g.attributes.color) col.set(g.attributes.color.array, o * 3); o += c; g.dispose(); });
    var out = new THREE.BufferGeometry(); out.setAttribute("position", new THREE.BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); out.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); if (col) out.setAttribute("color", new THREE.BufferAttribute(col, 3)); out.computeBoundingSphere(); this.g = []; return out; };
  Batch.prototype.mesh = function (mat, shadow) { var g = this.geo(); if (!g) return null; var m = new THREE.Mesh(g, mat); m.castShadow = shadow !== false; m.receiveShadow = true; m.userData.noInst = true; return m; };
  // a ground decal draped over the walk surface (or the ground): a grid of cells kept by keep(lx, lz), uv from uvOf(lx, lz)
  function drape(cx, cz, half, cell, uvOf, keep, yOf) { var n = Math.ceil(2 * half / cell), N = n + 1; var pos = [], uv = [], idx = [], vid = new Int32Array(N * N).fill(-1);
    function v(i, j) { var k = j * N + i; if (vid[k] >= 0) return vid[k]; var lx = -half + i * cell, lz = -half + j * cell, x = cx + lx, z = cz + lz; pos.push(x, yOf(x, z), z); var u = uvOf(lx, lz); uv.push(u[0], u[1]); vid[k] = pos.length / 3 - 1; return vid[k]; }
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) { if (!keep(-half + (i + 0.5) * cell, -half + (j + 0.5) * cell, cell)) continue; var a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1); idx.push(a, d, b, b, d, c); }
    if (!idx.length) return null; var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere(); return g; }
  // an annulus draped the same way: uvOf(a01, r01) with a01 round the circle and r01 across the band
  function drapeAnnulus(cx, cz, r0, r1, seg, nr, yOf, uvOf) { var pos = [], uv = [], idx = [], N = nr + 1;
    for (var i = 0; i <= seg; i++) { var a = i / seg * TAU; for (var j = 0; j <= nr; j++) { var r = r0 + (r1 - r0) * j / nr, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; pos.push(x, yOf(x, z), z); var u = uvOf(i / seg, j / nr); uv.push(u[0], u[1]); } }
    for (var i2 = 0; i2 < seg; i2++) for (var j2 = 0; j2 < nr; j2++) { var p0 = i2 * N + j2, p1 = p0 + 1, p2 = p0 + N, p3 = p2 + 1; idx.push(p0, p2, p1, p1, p2, p3); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere(); return g; }
  // turn a geometry inside out (winding and normals), for the inside of a tube
  function flipGeo(geo) { var g = geo.index ? geo.toNonIndexed() : geo; ["position", "normal", "uv"].forEach(function (k) { var at2 = g.attributes[k]; if (!at2) return; var a = at2.array, s = at2.itemSize; for (var i = 0; i < at2.count; i += 3) for (var c = 0; c < s; c++) { var t = a[(i + 1) * s + c]; a[(i + 1) * s + c] = a[(i + 2) * s + c]; a[(i + 2) * s + c] = t; } }); var n = g.attributes.normal; if (n) for (var j = 0; j < n.array.length; j++) n.array[j] = -n.array[j]; return g; }
  // uvs for a round medallion of radius R whose top reads along the direction (ux, uz); cell n of the numeral atlas when n is given
  function medallionUV(R, ux, uz, n) { var rx = -uz, rz = ux; return function (lx, lz) { var uu = (lx * rx + lz * rz + R) / (2 * R), vv = (R + (lx * ux + lz * uz)) / (2 * R); if (!n) return [uu, vv]; var i = (n - 1) % 5, j = Math.floor((n - 1) / 5); return [(i + uu) / 5, 1 - (j + 1 - vv) / 2]; }; }
  function canvasTex(w, h, draw, repeat) { var c = document.createElement("canvas"); c.width = w; c.height = h; var x = c.getContext("2d"); draw(x, w, h); var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.userData.canvas = c; return t; }
  function speckle(x, w, h, n, rgb, a) { for (var i = 0; i < n; i++) { x.fillStyle = "rgba(" + rgb + "," + (Math.random() * a).toFixed(3) + ")"; var s = 1 + Math.random() * 3; x.fillRect(Math.random() * w, Math.random() * h, s, s); } }
  // register something for distance gating (and optional per-frame work) by the frame hook
  function gate(obj, x, z, R, tick) { OP.items.push({ o: obj, x: x, z: z, R: R, tick: tick || null, vis: true }); return obj; }
  function addGroup(g, noCull) { g.userData.noInst = true; g.userData.b4 = true; if (noCull) g.userData.noCull = true; scene.add(g); return g; }
  function addMesh(m) { m.userData.noInst = true; m.userData.b4 = true; scene.add(m); return m; }
  function light(col, inten, dist, x, y, z, kind) { var l = new THREE.PointLight(col, 0, dist, 1.5); l.position.set(x, y, z); scene.add(l); OP.lights.push({ l: l, base: inten, kind: kind || "night" }); return l; }
  function hotspot(x, z, r, t, k, p) { hotspots.push({ x: x, z: z, r: r, t: t, k: k, p: p, plan: "b4" }); }
  // drop engine props (lamps, planting, solar bollards) that stand where one of our solids goes
  var CLEAR = ["lamp", "saguaro", "agave_cluster", "yucca_cluster", "bush1", "bush2", "ocotillo", "boulder", "paloverde", "ironwood", "mesquite", "desertwillow", "fanpalm"];
  function clearProps(x, z, r, kinds) { var ks = kinds || CLEAR, n = 0;
    for (var k = 0; k < ks.length; k++) { var L = PLACE[ks[k]]; if (!L) continue; for (var i = L.length - 1; i >= 0; i--) { var e = L[i]; if (e.b4) continue; if (Math.abs(e[0] - x) < r && Math.abs(e[2] - z) < r && Math.hypot(e[0] - x, e[2] - z) < r) { L.splice(i, 1); for (var c = COLLIDERS.length - 1; c >= 0; c--) { var q = COLLIDERS[c]; if (Math.abs(q[0] - e[0]) < 0.01 && Math.abs(q[1] - e[2]) < 0.01) { COLLIDERS.splice(c, 1); break; } } n++; } } }
    if (SOLAR && SOLAR.pts) { var before = SOLAR.pts.length; SOLAR.pts = SOLAR.pts.filter(function (q) { return Math.hypot(q[0] - x, q[1] - z) >= r * 0.8; }); n += before - SOLAR.pts.length; }
    if (n) { try { PGRID.colN = 1e9; } catch (e) {} } return n; }
  function putB4(kind, x, z, yaw, sc, keep) { if (!MODELS[kind] || !MODEL_SPECS[kind]) return null; put(kind, x, z, yaw, sc); var e = PLACE[kind][PLACE[kind].length - 1]; e.b4 = true; if (keep) e.keep = true; return e; }

  // ─────────────────────────────── materials ───────────────────────────────
  function mats() {
    if (OP.mats) return OP.mats; var Mm = {};
    var panel = canvasTex(256, 256, function (x, w, h) { x.fillStyle = "#e6e9ea"; x.fillRect(0, 0, w, h); speckle(x, w, h, 700, "80,90,100", 0.06); for (var i = 0; i < h; i += 2) { x.fillStyle = "rgba(255,255,255," + (Math.random() * 0.05).toFixed(3) + ")"; x.fillRect(0, i, w, 1); }
      x.fillStyle = "#7d858c"; x.fillRect(0, 0, w, 4); x.fillRect(0, 0, 4, h); x.fillStyle = "rgba(255,255,255,0.55)"; x.fillRect(0, 4, w, 2); x.fillRect(4, 0, 2, h);
      x.fillStyle = "#9aa1a6"; for (var k = 1; k < 8; k++) { x.beginPath(); x.arc(k * w / 8, 12, 2.2, 0, TAU); x.fill(); x.beginPath(); x.arc(12, k * h / 8, 2.2, 0, TAU); x.fill(); } }, true);
    Mm.panel = new THREE.MeshStandardMaterial({ map: panel, color: 0xffffff, metalness: 0.55, roughness: 0.34 });
    Mm.white = new THREE.MeshStandardMaterial({ color: 0xeef0ef, roughness: 0.42, metalness: 0.35 });
    Mm.ringGlow = new THREE.MeshStandardMaterial({ color: 0x0e3640, emissive: 0x3fe6ff, emissiveIntensity: 1, roughness: 0.3, metalness: 0.2 });
    Mm.countGlow = new THREE.MeshStandardMaterial({ color: 0x173a42, emissive: 0x4ff0ff, emissiveIntensity: 0, roughness: 0.35, metalness: 0.2 });
    Mm.red = new THREE.MeshStandardMaterial({ color: 0x3a0606, emissive: 0xff2414, emissiveIntensity: 2 });
    var rust = canvasTex(256, 256, function (x, w, h) { x.fillStyle = "#7c3f22"; x.fillRect(0, 0, w, h); speckle(x, w, h, 1600, "40,18,8", 0.22); speckle(x, w, h, 900, "176,96,48", 0.2); for (var i = 0; i < 40; i++) { x.fillStyle = "rgba(60,26,12," + (Math.random() * 0.25).toFixed(3) + ")"; x.fillRect(Math.random() * w, 0, 1 + Math.random() * 2, h); } }, true);
    Mm.corten = new THREE.MeshStandardMaterial({ map: rust, color: 0xffffff, roughness: 0.88, metalness: 0.2 });
    Mm.brass = new THREE.MeshStandardMaterial({ color: 0xd9b25e, metalness: 0.6, roughness: 0.32, emissive: 0x7a5418, emissiveIntensity: 0.1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    Mm.bronze = new THREE.MeshStandardMaterial({ color: 0xa87a3e, metalness: 0.85, roughness: 0.36 });
    Mm.concrete = new THREE.MeshStandardMaterial({ map: TEX.apron, normalMap: TEX.apronN, normalScale: new THREE.Vector2(0.5, 0.5), color: 0xd4ccbd, roughness: 0.95 });
    Mm.basalt = new THREE.MeshStandardMaterial({ normalMap: TEX.rockN, color: 0x292624, roughness: 0.9, metalness: 0.05, flatShading: true });
    Mm.steel = new THREE.MeshStandardMaterial({ color: 0x8c969e, roughness: 0.45, metalness: 0.7 });
    Mm.dark = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.55, metalness: 0.5 });
    Mm.glass = new THREE.MeshStandardMaterial({ color: 0xa9d9e2, roughness: 0.06, metalness: 0.25, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide });
    Mm.frost = new THREE.MeshStandardMaterial({ color: 0xf1f3f1, roughness: 0.62, metalness: 0.05, emissive: 0xffdcaa, emissiveIntensity: 0, side: THREE.DoubleSide });
    Mm.warm = new THREE.MeshStandardMaterial({ color: 0x3a2a16, emissive: 0xffc27a, emissiveIntensity: 0 });   // warm lamp faces of the Launch Complex show (festoon bulbs, gantry lamps): they hold for the Landing Light Pause
    Mm.up = Mm.warm.clone();   // the Seven Gates uplights
    Mm.whiteDS = new THREE.MeshStandardMaterial({ color: 0xeef0ef, roughness: 0.42, metalness: 0.35, side: THREE.DoubleSide });
    Mm.plant = new THREE.MeshStandardMaterial({ color: 0x7b8656, roughness: 0.92 });
    Mm.stem = new THREE.MeshStandardMaterial({ color: 0x33363a, roughness: 0.7, metalness: 0.4 });
    try { Mm.stone = fountainMats().stone; Mm.wet = fountainMats().wet; } catch (e) { Mm.stone = Mm.concrete; Mm.wet = Mm.concrete; }
    Mm.wash = new THREE.MeshBasicMaterial({ map: canvasTex(32, 128, function (x, w, h) { var g = x.createLinearGradient(0, h, 0, 0); g.addColorStop(0, "rgba(255,214,150,0.9)"); g.addColorStop(0.35, "rgba(255,196,120,0.35)"); g.addColorStop(1, "rgba(255,190,110,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h); }), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    OP.mats = Mm; return Mm;
  }
  // additive glow sprites (Points): size in metres, never smaller than uMin pixels
  function glowMat(col, minPx) { var m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uCol: { value: new THREE.Color(col) }, uK: { value: 0 }, uPx: OP.u.px, uMin: { value: minPx || 1.5 } },
    vertexShader: "attribute float aS; uniform float uPx; uniform float uMin; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(aS * uPx / max(0.5, -mv.z), uMin, 110.0); }",
    fragmentShader: "uniform vec3 uCol; uniform float uK; void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0) discard; float a = pow(1.0 - d, 2.4) * uK; gl_FragColor = vec4(uCol, a); }" }); return m; }
  function glowPoints(list, col, minPx) { var p = [], s = []; list.forEach(function (q) { p.push(q[0], q[1], q[2]); s.push(q[3]); }); var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); g.setAttribute("aS", new THREE.Float32BufferAttribute(s, 1)); g.computeBoundingSphere(); var pts = new THREE.Points(g, glowMat(col, minPx)); pts.renderOrder = 5; pts.userData.noInst = true; return pts; }
  // soft rising mist (Halo Mist, Launch Mist): emitters in position, per-particle seeds
  function mistMat() { return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uT: OP.u.t, uPx: OP.u.px, uRise: { value: 3 }, uLife: { value: 6 }, uSpread: { value: 1.5 }, uSize: { value: 1 }, uCol: { value: new THREE.Color(0xeef4f6) }, uA: { value: 0.2 } },
    vertexShader: "attribute vec4 aSeed; uniform float uT; uniform float uPx; uniform float uRise; uniform float uLife; uniform float uSpread; uniform float uSize; varying float vA;\n" +
      "void main() { float life = uLife * (0.7 + 0.6 * aSeed.y); float k = fract(uT / life + aSeed.x); float ang = aSeed.z * 6.2832;\n" +
      " vec3 p = position + vec3(cos(ang), 0.0, sin(ang)) * uSpread * k * (0.4 + aSeed.w) + vec3(0.0, uRise * k * (0.6 + 0.8 * aSeed.y), 0.0);\n" +
      " vA = smoothstep(0.0, 0.18, k) * (1.0 - smoothstep(0.5, 1.0, k)); vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;\n" +
      " gl_PointSize = clamp((0.9 + 2.8 * k) * (0.6 + aSeed.w) * uSize * uPx / max(0.5, -mv.z), 1.0, 160.0); }",
    fragmentShader: "uniform vec3 uCol; uniform float uA; varying float vA; void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0) discard; float a = (1.0 - d); a = a * a * vA * uA; gl_FragColor = vec4(uCol, a); }" }); }
  function mistPoints(n, emit, mat) { var p = new Float32Array(n * 3), s = new Float32Array(n * 4); for (var i = 0; i < n; i++) { var e = emit(i); p[i * 3] = e[0]; p[i * 3 + 1] = e[1]; p[i * 3 + 2] = e[2]; s[i * 4] = rr(); s[i * 4 + 1] = rr(); s[i * 4 + 2] = rr(); s[i * 4 + 3] = rr(); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("aSeed", new THREE.BufferAttribute(s, 4)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 0), 16); var pts = new THREE.Points(g, mat); pts.renderOrder = 4; pts.userData.noInst = true; return pts; }
  // floor jets: like the engine's spray, with a colour per particle (planet fountains, the Compass Fountain)
  var JETMAT = null;
  function jetMat() { if (JETMAT) return JETMAT; JETMAT = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uT: OP.u.t, uPx: OP.u.px, uNight: OP.u.night, uDim: { value: 1 } },
    vertexShader: "attribute vec4 aSeed; attribute vec4 aEmit; attribute vec3 aCol; uniform float uT; uniform float uPx; uniform float uNight; varying float vA; varying vec3 vC;\n" +
      "void main() { float life = aEmit.w; float t = fract(uT / life + aSeed.x) * life; float ang = aSeed.y * 6.2832; vec3 dir = normalize(vec3(cos(ang) * aEmit.y, 1.0, sin(ang) * aEmit.y)); float v0 = aEmit.x * (0.85 + 0.3 * aSeed.z);\n" +
      " vec3 p = position + dir * v0 * t + vec3(0.0, -4.9 * t * t, 0.0); vA = (1.0 - t / life) * smoothstep(0.0, 0.05, t) * (0.5 + 0.5 * aSeed.w); vC = mix(vec3(0.92, 0.97, 1.0), aCol * 1.6, uNight * 0.85);\n" +
      " vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp((0.05 + 0.07 * aSeed.w) * uPx / max(0.5, -mv.z), 1.5, 64.0); }",
    fragmentShader: "varying float vA; varying vec3 vC; uniform float uDim; void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25) discard; gl_FragColor = vec4(vC * uDim, vA * (1.0 - d * 4.0) * 0.9); }" }); return JETMAT; }
  function jetPoints(list) { // list of { p: [x,y,z], h, spread, n, col: THREE.Color }
    var n = 0; list.forEach(function (j) { n += j.n; }); var pos = new Float32Array(n * 3), seed = new Float32Array(n * 4), em = new Float32Array(n * 4), col = new Float32Array(n * 3), i = 0;
    list.forEach(function (j) { var v = Math.sqrt(2 * 9.8 * j.h), life = 2 * v / 9.8; for (var k = 0; k < j.n; k++, i++) { pos.set(j.p, i * 3); seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4); em.set([v, j.spread, 0, life], i * 4); col.set([j.col.r, j.col.g, j.col.b], i * 3); } });
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4)); g.setAttribute("aEmit", new THREE.BufferAttribute(em, 4)); g.setAttribute("aCol", new THREE.BufferAttribute(col, 3)); g.computeBoundingSphere(); g.boundingSphere.radius += 4;
    var pts = new THREE.Points(g, jetMat()); pts.renderOrder = 4; pts.userData.noInst = true; return pts; }
  // twinkling fibre tips and Field of Light bulbs (normal blending, bright at night)
  function twinkleMat(size, day) { return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uT: OP.u.t, uPx: OP.u.px, uNight: OP.u.night, uDim: { value: 1 }, uSize: { value: size }, uDay: { value: day } },
    vertexShader: "attribute vec4 aSeed; uniform float uT; uniform float uPx; uniform float uNight; uniform float uSize; uniform float uDay; varying vec3 vC; varying float vA;\n" +
      "void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float tw = 0.6 + 0.4 * sin(uT * (0.5 + aSeed.y * 1.4) + aSeed.x * 6.2832);\n" +
      " float h = fract(aSeed.z + uT * 0.015 + aSeed.x * 0.2); vec3 hue = 0.55 + 0.45 * cos(6.2832 * (h + vec3(0.0, 0.33, 0.67))); vC = mix(vec3(0.9, 0.9, 0.86), hue * (1.2 + 1.3 * tw), uNight); vA = mix(uDay, 1.0, uNight) * mix(1.0, tw, uNight);\n" +
      " gl_PointSize = clamp(uSize * (0.8 + 0.4 * aSeed.w) * uPx / max(0.5, -mv.z), 1.2, 48.0); }",
    fragmentShader: "varying vec3 vC; varying float vA; uniform float uDim; void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0) discard; gl_FragColor = vec4(vC * uDim, vA * (1.0 - d * d)); }" }); }
  function seededPoints(list, mat) { var n = list.length, p = new Float32Array(n * 3), s = new Float32Array(n * 4); for (var i = 0; i < n; i++) { p[i * 3] = list[i][0]; p[i * 3 + 1] = list[i][1]; p[i * 3 + 2] = list[i][2]; s[i * 4] = rr(); s[i * 4 + 1] = rr(); s[i * 4 + 2] = rr(); s[i * 4 + 3] = rr(); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("aSeed", new THREE.BufferAttribute(s, 4)); g.computeBoundingSphere(); var pts = new THREE.Points(g, mat); pts.renderOrder = 4; pts.userData.noInst = true; return pts; }
  function instanced(geo, mat, list, shadow) { var im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); for (var i = 0; i < list.length; i++) im.setMatrixAt(i, list[i]); im.count = list.length; im.instanceMatrix.needsUpdate = true; im.castShadow = shadow !== false; im.receiveShadow = true; im.userData.noInst = true; im.computeBoundingSphere(); return im; }

  // ─────────────────────────────── geometry of the plan ───────────────────────────────
  function axis() { var p = prom("hl5_launch_walk"); var a = p ? p.pts[0] : [886.2, 606.6], b = p ? p.pts[p.pts.length - 1] : [995, 832.5]; var L = Math.hypot(b[0] - a[0], b[1] - a[1]); return { a: a, b: b, L: L, ux: (b[0] - a[0]) / L, uz: (b[1] - a[1]) / L }; }
  function ringCentre() { var q = place("genesis_ring"); return q ? [q.x, q.z] : [995, 832.5]; }
  function countdownSpots() { var A = axis(), out = []; for (var k = 10; k >= 1; k--) { var d = A.L - (k - 1) * 25; out.push({ n: k, d: d, x: A.a[0] + A.ux * d, z: A.a[1] + A.uz * d }); } return out; }

  // ═════════════════════════════════ WORLD ═════════════════════════════════
  function world() {
    if (!window.PLAN) return; var A = axis(); OP.ax = [A.ux, A.uz]; OP.pos.ring = ringCentre();
    safe("worldRing", worldRing); safe("worldCountdown", worldCountdown); safe("worldLaunch", worldLaunch); safe("worldDome", worldDome); safe("worldHabitats", worldHabitats);
    safe("worldObservatory", worldObservatory); safe("worldStratos", worldStratos); safe("worldLowG", worldLowG); safe("worldLaunchComplex", worldLaunchComplex);
    safe("worldCompass", worldCompass); safe("worldGates", worldGates); safe("worldFieldOfLight", worldFieldOfLight); safe("worldSunTunnels", worldSunTunnels); safe("worldSpiral", worldSpiral);
    safe("worldGeoglyph", worldGeoglyph); safe("worldCascade", worldCascade); safe("worldPlanets", worldPlanets);
    try { PGRID.colN = 1e9; } catch (e) {}
  }
  function worldRing() { var c = OP.pos.ring; KEEPOUT.push([c[0], c[1], 27]); clearProps(c[0], c[1], 10); }
  function worldCountdown() {
    var A = axis(), rx = A.uz, rz = -A.ux;   // local +x of the rings = the walk's east normal
    OP.pos.count = countdownSpots(); OP.pos.feet = [];
    OP.pos.count.forEach(function (s) { if (s.n === 1) return; for (var sd = -1; sd <= 1; sd += 2) { var fx = s.x + rx * 7.83 * sd, fz = s.z + rz * 7.83 * sd; clearProps(fx, fz, 1.6); COLLIDERS.push([fx, fz, 0.6]); OP.pos.feet.push([fx, fz]); } });
    // the xeno-garden beds on both sides of the Launch Walk, outside the plazas
    var beds = [], lp = place("launch_plaza"), og = place("outpost_gate");
    var dLaunch = lp ? (lp.x - A.a[0]) * A.ux + (lp.z - A.a[1]) * A.uz : 106, rL = lp ? lp.r : 35, rG = og ? og.r : 22, rRing = 45;
    var spans = [[rG + 2, dLaunch - rL], [dLaunch + rL, A.L - rRing]];
    spans.forEach(function (sp) { if (sp[1] - sp[0] < 8) return; for (var sd = -1; sd <= 1; sd += 2) { var poly = []; [[sp[0], 8.6], [sp[1], 8.6], [sp[1], 15], [sp[0], 15]].forEach(function (q) { poly.push([A.a[0] + A.ux * q[0] + rx * q[1] * sd, A.a[1] + A.uz * q[0] + rz * q[1] * sd]); }); planKeepout(poly); beds.push({ d0: sp[0], d1: sp[1], sd: sd }); } });
    OP.pos.beds = beds;
    // planting in the beds: totem pole cactus, blue-lit agave, grass; boojums are procedural (defer)
    var own = new Set(ROADS.filter(function (r) { return r.plan === "hl5_launch_walk"; })); OP.pos.agave = []; OP.pos.boojum = []; OP.pos.fibre = [];
    beds.forEach(function (b) { for (var d = b.d0 + 2; d < b.d1 - 1.5; d += 3.2) { var lat = 9.6 + rr() * 4.8, x = A.a[0] + A.ux * d + rx * lat * b.sd, z = A.a[1] + A.uz * d + rz * lat * b.sd; if (planNearRoad(x, z, 0.8, own) || planNearCollider(x, z, 0.8)) continue; var q = rr();
      if (q < 0.26) { if (putB4("saguaro", x, z, rr() * TAU, 0.42 + rr() * 0.22, true)) continue; }
      if (q < 0.58) { if (putB4("agave_cluster", x, z, rr() * TAU, 0.9 + rr() * 0.5, true) || putB4("bush1", x, z, rr() * TAU, 0.8, true)) { OP.pos.agave.push([x, z]); continue; } }
      if (q < 0.74) { OP.pos.boojum.push([x, z, 0.75 + rr() * 0.6, rr() * TAU, rr() < 0.5 ? 0 : 1]); COLLIDERS.push([x, z, 0.45]); continue; }
      OP.pos.fibre.push([x, z]); } });
  }
  function worldLaunch() {
    var lp = place("launch_plaza"); if (!lp) return; var A = axis(); var ex = A.uz, ez = -A.ux;   // east of the axis
    OP.pos.launch = [lp.x, lp.z]; clearProps(lp.x, lp.z, 6.5);
    var lx = lp.x + ex * 25, lz = lp.z + ez * 25; OP.pos.lander = [lx, lz];
    var r = planPut("lander", lx, lz, yawOf(lp.x - lx, lp.z - lz), 1); if (r && r.e) { r.e.keep = true; r.e.b4 = true; }
    KEEPOUT.push([lx, lz, 8]);
    // the rover stop: two parked rovers beside the rover shelter, on the plaza side of the walk
    var sh = null; try { sh = planBuilding("b0297"); } catch (e) {}
    for (var i = 0; i < 2; i++) { var d = -16 - i * 6.5, x = lp.x + A.ux * d - ex * 10.6, z = lp.z + A.uz * d - ez * 10.6; if (planNearCollider(x, z, 1.2)) continue; var rv = planPut("rover", x, z, yawOf(A.ux, A.uz) + (i ? 0.25 : -0.2), 1); if (rv && rv.e) { rv.e.keep = true; rv.e.b4 = true; } }
    HOST.hs = { x: lp.x + 13, z: lp.z, r: 5, t: "The Outpost host", k: "Launch Plaza · your guide in a surface suit · press E to talk", p: "Welcome to The Outpost. Walk the Countdown from ring 10 at the Outpost Gate to ring 1 under the Genesis Ring, then circle the Orbit Walk past the eight planets. Mission Control briefs every mission from its forecourt bowl.", play: "npc:host", plan: "b4" }; hotspots.push(HOST.hs); HOST.stub = new THREE.Object3D(); HOST.stub.position.set(HOST.hs.x, 0, HOST.hs.z);
    hotspot(lx - ex * 6, lz - ez * 6, 9, "The lander", "Launch Plaza · The Outpost", "A lander sculpture on its own blast pad, 25 m east of the Launch Walk. Every so often the Launch Mist beside it lights up white like a pad at ignition.");
  }
  function worldDome() {
    var q = place("genesis_dome"); if (!q) return; var A = axis(); var c = [q.x, q.z]; OP.pos.dome = c;
    // the entry faces Launch Plaza: straight across to the walk
    var t = (c[0] - A.a[0]) * A.ux + (c[1] - A.a[1]) * A.uz; var fx = A.a[0] + A.ux * t, fz = A.a[1] + A.uz * t; var L = Math.hypot(fx - c[0], fz - c[1]); var ex = (fx - c[0]) / L, ez = (fz - c[1]) / L; OP.pos.domeDir = [ex, ez];
    KEEPOUT.push([c[0], c[1], 34]); COLLIDERS.push([c[0], c[1], 29.6]); clearProps(c[0], c[1], 40);
    var lp = place("launch_plaza"); var end = lp ? Math.max(40, Math.hypot(lp.x - c[0], lp.z - c[1]) - lp.r + 3) : L - 30;
    planRibbon([[c[0] + ex * 29.3, c[1] + ez * 29.3], [c[0] + ex * end, c[1] + ez * end]], 4.4, { mat: planMats().redg, lift: 0.3, tile: 3 }, "b4_dome_walk");
    // the biome garden inside the glass
    // [kind, count, scale range, radius range]: everything stays under the glass (the dome is 16 m high at r 11, 8.6 m at r 23)
    var kinds = [["fanpalm", 8, 0.55, 0.72, 11.5, 15.5], ["desertwillow", 4, 0.85, 1.1, 12, 19], ["agave_cluster", 14, 1.0, 1.6, 11, 24], ["bush1", 10, 0.8, 1.3, 11, 24], ["saguaro", 3, 0.6, 0.8, 12, 20]];
    kinds.forEach(function (k) { for (var i = 0; i < k[1]; i++) { var a = rr() * TAU, r = k[4] + rr() * (k[5] - k[4]); if (Math.abs(Math.atan2(Math.sin(a - Math.atan2(ez, ex)), Math.cos(a - Math.atan2(ez, ex)))) < 0.3) continue; putB4(k[0], c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, rr() * TAU, k[2] + rr() * (k[3] - k[2]), true); } });
    // the interior plants are inside the dome's collider: never let the tidy pass or the tree culling treat them as outdoor planting
    OP.pos.domeR = 29.6;
    hotspot(c[0] + ex * 35, c[1] + ez * 35, 10, "The Genesis Dome", "The Outpost · the biome under glass", "A 60 m geodesic biome, low and wide at 18 m, with a planetarium, a mission hall and a desert biome garden under the glass. The entry canopy faces Launch Plaza.");
  }
  function worldHabitats() {
    if (!MODELS.habitat) return; var ids = []; var add = function (a, b) { for (var i = a; i <= b; i++) ids.push("b0" + String(i)); };
    add(540, 551); add(488, 495); add(393, 397); var placed = [], n = 0; var hl = MODELS.habitat.sz / 2, hw = MODELS.habitat.sx / 2;
    var clearOf = function (x, z, own) { if (planNearRoad(x, z, hw + 0.6)) return false; planColSync(); var cells = PGRID.col.get(Math.floor(x / PGRID.C) * 100003 + Math.floor(z / PGRID.C)) || []; for (var i = 0; i < cells.length; i++) { var cc = cells[i]; if (Math.abs(cc[0] - own[0]) < 0.01 && Math.abs(cc[1] - own[1]) < 0.01) continue; if (Math.hypot(cc[0] - x, cc[1] - z) < cc[2] + hw + 0.3) return false; } for (var j = 0; j < placed.length; j++) if (Math.hypot(placed[j][0] - x, placed[j][1] - z) < hl + hw + 1.5) return false; return !inPlaza(x, z, 0); };
    ids.forEach(function (id) { var rec = null; try { rec = planBuilding(id); } catch (e) {} if (!rec || !rec.e || !MODELS[rec.kind]) return; var e = rec.e, yaw = e[3], sc = e[4] || 1, m = MODELS[rec.kind];
      var halfD = (m.sz || 13) / 2 * sc, halfW = (m.sx || 12) / 2 * sc; var opts = [[-Math.sin(yaw), -Math.cos(yaw), halfD], [Math.cos(yaw), -Math.sin(yaw), halfW], [-Math.cos(yaw), Math.sin(yaw), halfW]];
      for (var o = 0; o < opts.length; o++) { var dx = opts[o][0], dz = opts[o][1], reach = opts[o][2] - 0.7 + hl; var cx = e[0] + dx * reach, cz = e[2] + dz * reach; var ok = true;
        for (var s = 0.25; s <= 1.0 && ok; s += 0.25) { var px = e[0] + dx * (opts[o][2] + (hl * 2 - 0.7) * s), pz = e[2] + dz * (opts[o][2] + (hl * 2 - 0.7) * s); if (!clearOf(px, pz, [e[0], e[2]])) ok = false; }
        if (!ok) continue; var he = putB4("habitat", cx, cz, yawOf(dx, dz), 1, true); if (he) { placed.push([cx, cz]); n++; } break; } });
    OP.n.habitats = n;
  }
  function worldObservatory() { var q = place("observatory"); if (!q) return; OP.pos.obs = [q.x, q.z];
    // a stargazing pad for the dark-sky hour, beside the observatory and off the spur
    var best = null; for (var k = 0; k < 16 && !best; k++) { var a = k / 16 * TAU, x = q.x + Math.cos(a) * 19, z = q.z + Math.sin(a) * 19; if (spotFree(x, z, 5.5) && !inPlaza(x, z, 5)) best = [x, z]; } if (best) { OP.pos.stargaze = best; KEEPOUT.push([best[0], best[1], 7]); COLLIDERS.push([best[0], best[1], 0.5]); } }
  function worldStratos() { var q = place("stratos_field"); if (!q) return; OP.pos.stratos = [q.x, q.z]; KEEPOUT.push([q.x, q.z, q.r + 4]); clearProps(q.x, q.z, q.r);
    // three launch circles (a triangle, 16 m apart) and the capsule on its display cradle at the field edge
    // the circles sit under A2's three balloons (planStratos: 13 m out at 0.3, 2.4 and 4.5 radians)
    var pads = [0.3, 2.4, 4.5].map(function (a) { return [q.x + Math.cos(a) * 13, q.z + Math.sin(a) * 13]; }); OP.pos.stratosPads = pads;
    var best = null; for (var k = 0; k < 24 && !best; k++) { var b = k / 24 * TAU, x = q.x + Math.cos(b) * (q.r + 3), z = q.z + Math.sin(b) * (q.r + 3); if (spotFree(x, z, 3.2)) best = [x, z, b]; }
    if (best) { OP.pos.capsule = best; var e = putB4("stratos", best[0], best[1], yawOf(q.x - best[0], q.z - best[1]), 1, true); if (!e) OP.pos.capsule = null; else KEEPOUT.push([best[0], best[1], 5]); }
    var ws = null; for (var w = 0; w < 24 && !ws; w++) { var c = w / 24 * TAU + 0.6, x2 = q.x + Math.cos(c) * (q.r + 1), z2 = q.z + Math.sin(c) * (q.r + 1); if (spotFree(x2, z2, 1.2) && (!best || Math.hypot(x2 - best[0], z2 - best[1]) > 8)) ws = [x2, z2]; } if (ws) { OP.pos.windsock = ws; COLLIDERS.push([ws[0], ws[1], 0.3]); } }
  function worldLowG() { var q = place("lowg_course"); if (!q) return; OP.pos.lowg = [q.x, q.z, q.r]; KEEPOUT.push([q.x, q.z, q.r + 4]); clearProps(q.x, q.z, q.r + 2);
    // the course itself (platforms, the green start pad) is A2's Sky Obby re-homed here; keep our rim clear of its start
    var st = null; try { if (OBBY && OBBY.start) st = [OBBY.start[0], OBBY.start[2]]; } catch (e) {} OP.pos.obbyStart = st || [q.x + 23, q.z + 24]; }
  function worldLaunchComplex() {
    var q = place("night_plaza"); if (!q) return; OP.pos.night = [q.x, q.z, q.r];
    // the countdown clock faces you as you come in off the Night Walk
    var nw = prom("night_walk"), from = nw ? nw.pts[nw.pts.length - 1] : [q.x - 18, q.z + 17]; var dx = q.x - from[0], dz = q.z - from[1], L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    var cx = q.x + dx * 18, cz = q.z + dz * 18; for (var k = 0; k < 8 && planNearCollider(cx, cz, 3.2); k++) { var a = Math.atan2(dz, dx) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.25; cx = q.x + Math.cos(a) * 18; cz = q.z + Math.sin(a) * 18; }
    OP.pos.clock = [cx, cz, yawOf(q.x - cx, q.z - cz)]; for (var s = -1; s <= 1; s += 2) COLLIDERS.push([cx + Math.cos(OP.pos.clock[2]) * 3.6 * s, cz - Math.sin(OP.pos.clock[2]) * 3.6 * s, 0.45]);
    // festoon poles round the plaza between the bench ring and the vendor village
    var poles = []; for (var i = 0; i < 14; i++) { var b = i / 14 * TAU + 0.11, rP = q.r + 2.5, x = q.x + Math.cos(b) * rP, z = q.z + Math.sin(b) * rP; if (planNearCollider(x, z, 1.4) || planNearRoad(x, z, 0.8) || Math.hypot(x - cx, z - cz) < 6) { poles.push(null); continue; } poles.push([x, z]); COLLIDERS.push([x, z, 0.25]); } OP.pos.poles = poles;
    // blue-lit agave between the vendor stalls
    OP.pos.vagave = []; for (var j = 0; j < 12; j++) { var c = j / 12 * TAU + 0.26, x3 = q.x + Math.cos(c) * (q.r + 8), z3 = q.z + Math.sin(c) * (q.r + 8); if (planNearCollider(x3, z3, 1.4) || planNearRoad(x3, z3, 0.8)) continue; if (putB4("agave_cluster", x3, z3, rr() * TAU, 1.1 + rr() * 0.4, true)) OP.pos.vagave.push([x3, z3]); }
    // Gantry Row: a launch-gantry tower behind each canopy
    OP.pos.gantry = []; ["b0189", "b0192", "b0196", "b0199"].forEach(function (id) { var rec = null; try { rec = planBuilding(id); } catch (e) {} if (!rec) return; var e = rec.e, yaw = e[3], bx = -Math.sin(yaw), bz = -Math.cos(yaw); var R = (MODELS[rec.kind] ? MODELS[rec.kind].radius * (e[4] || 1) : 9);
      var tries = [[bx, bz], [Math.cos(yaw), -Math.sin(yaw)], [-Math.cos(yaw), Math.sin(yaw)]]; for (var t = 0; t < tries.length; t++) { var gx = e[0] + tries[t][0] * (R + 2.8), gz = e[2] + tries[t][1] * (R + 2.8); if (planNearRoad(gx, gz, 2.2) || planNearCollider(gx, gz, 1.9)) continue; OP.pos.gantry.push([gx, gz, yawOf(e[0] - gx, e[2] - gz), R]); COLLIDERS.push([gx, gz, 2.1]); break; } });
    // the earth berm on the runway side of the Launch Complex (terrain hook), broken wherever it would meet a road, a building or the wash
    var berm = { sc: -148, t0: -915, t1: -700, half: 9.25, st: [] }; var wash = null; try { wash = PLAN_IDX.district.get("S3_NFWASH"); } catch (e) {}
    for (var tt = berm.t0; tt <= berm.t1; tt += 3) { var p = along(tt, berm.sc), p1 = along(tt, berm.sc + berm.half), p2 = along(tt, berm.sc - berm.half); var blocked = planNearRoad(p[0], p[1], berm.half - 1) || planNearRoad(p1[0], p1[1], 1) || planNearRoad(p2[0], p2[1], 1) || planNearCollider(p[0], p[1], berm.half) || inPlaza(p[0], p[1], berm.half) || (wash && planInPoly(wash.poly, p[0], p[1])); berm.st.push([tt, blocked ? 1 : 0]); }
    OP.berm = berm; OP.n.bermOpen = berm.st.filter(function (s) { return !s[1]; }).length;
    // the ocotillo fence along its crest
    for (var ti = 0; ti < berm.st.length; ti++) { var st = berm.st[ti]; if (st[1]) continue; var okN = true; for (var nb = -3; nb <= 3; nb++) { var sN = berm.st[ti + nb]; if (!sN || sN[1]) { okN = false; break; } } if (!okN) continue; for (var f = 0; f < 3; f++) { var tf = st[0] + f * 1.0 + rr() * 0.4, pf = along(tf, berm.sc + (rr() - 0.5) * 1.1); putB4("ocotillo", pf[0], pf[1], rr() * TAU, 0.75 + rr() * 0.35, true); } }
  }
  function worldCompass() { var q = place("compass_plaza"); if (q) { OP.pos.compass = [q.x, q.z]; clearProps(q.x, q.z, 7.5); }
    var b = place("outpost_beacon"); if (b) { OP.pos.beacon = [b.x, b.z]; clearProps(b.x, b.z, 3); COLLIDERS.push([b.x, b.z, 1.7]); KEEPOUT.push([b.x, b.z, 4]); } }
  function worldGates() {
    var hl4 = prom("hl4_sculpture_ave"); if (!hl4) return; var pts = hl4.pts, L = polyLen(pts); OP.pos.gates = [];
    for (var k = 0; k < 7; k++) { var d = 14 + 20 * k; if (d > L - 6) break; var s = at(pts, d), W = 22 - k, Hh = 16.5 - 0.7 * k; var g = { k: k, d: d, x: s.x, z: s.z, W: W, H: Hh, ux: s.ux, uz: s.uz, cols: [] };
      for (var sd = -1; sd <= 1; sd += 2) { var cx = s.x + s.rx * W / 2 * sd, cz = s.z + s.rz * W / 2 * sd; clearProps(cx, cz, 2.2); COLLIDERS.push([cx, cz, 0.85]); g.cols.push([cx, cz]); } OP.pos.gates.push(g); }
    var wt = fount("water_table"); var d0 = wt ? (wt.x - pts[0][0]) * (pts[1][0] - pts[0][0]) / L + (wt.z - pts[0][1]) * (pts[1][1] - pts[0][1]) / L : 74; OP.pos.table = at(pts, d0); OP.pos.table.d = d0; clearProps(OP.pos.table.x, OP.pos.table.z, 4.5); COLLIDERS.push([OP.pos.table.x, OP.pos.table.z, 1.4]);
  }
  function worldFieldOfLight() {
    var q = place("field_of_light"); if (!q) return; var c = [q.x, q.z], R = q.r || 38; OP.pos.fol = [c[0], c[1], R]; KEEPOUT.push([c[0], c[1], R + 3]); clearProps(c[0], c[1], R + 1, ["bush1", "bush2", "boulder", "ocotillo", "saguaro"]);
    // two footpaths through the field: a gentle S-curve west to east and a straight path north to south
    var ew = [], ns = []; for (var x = -R - 2; x <= R + 2.01; x += 4) ew.push([c[0] + x, c[1] + 7 * Math.sin(x / R * Math.PI)]); for (var z = -R - 2; z <= R + 2.01; z += 8) ns.push([c[0] + 3 * Math.sin(z / R * 1.6), c[1] + z]);
    var sf = { mat: planMats().dg, lift: 0.22, tile: 3 }; planRibbon(ew, 2.4, sf, "b4_fol_path"); planRibbon(ns, 2.4, sf, "b4_fol_path");
    hotspot(c[0] + 7, c[1] + 2, 12, "Field of Light", "The Design District · land art", "Thousands of glowing stems planted in the open desert, under a metre high. By day they are frosted glass; after dark they breathe slowly through the colours. Two paths cross the field.");
  }
  function worldSunTunnels() { var q = place("sun_tunnels"); if (!q) return; OP.pos.sun = [q.x, q.z]; KEEPOUT.push([q.x, q.z, 16]); clearProps(q.x, q.z, 15, ["bush1", "bush2", "boulder", "ocotillo", "saguaro", "mesquite", "paloverde"]);
    OP.pos.tubes = []; [62.2, 242.2, 117.8, 297.8].forEach(function (az) { var dx = Math.sin(az * DEG), dz = -Math.cos(az * DEG); var x = q.x + dx * 8.2, z = q.z + dz * 8.2; OP.pos.tubes.push([x, z, az]); for (var s = -2; s <= 2; s++) COLLIDERS.push([x + dx * s * 1.2, z + dz * s * 1.2, 0.2]); }); }
  function worldSpiral() {
    var q = place("stone_spiral"); if (!q) return; var rw = prom("ridge_walk"), wash = null; try { wash = PLAN_IDX.district.get("S3_RIDGEWASH"); } catch (e) {}
    var dir = [0.46, 0.89]; if (rw) { var best = 1e9; for (var i = 0; i < rw.pts.length - 1; i++) { var a = rw.pts[i], b = rw.pts[i + 1]; var dd = Math.hypot((a[0] + b[0]) / 2 - q.x, (a[1] + b[1]) / 2 - q.z); if (dd < best) { best = dd; var L = Math.hypot(b[0] - a[0], b[1] - a[1]); dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; } } }
    var cands = []; for (var dd = 14; dd <= 34; dd += 4) for (var an = 0; an < 18; an++) { var aa = an / 18 * TAU, x = q.x + Math.cos(aa) * dd, z = q.z + Math.sin(aa) * dd; var score = (wash && planInPoly(wash.poly, x, z) ? 0 : 40) + (planNearRoad(x, z, 10.4) ? 200 : 0) + (planNearCollider(x, z, 10) ? 60 : 0) + (planPolyBlocked(x, z) ? 30 : 0) + dd * 0.6; cands.push([score, x, z]); }
    cands.sort(function (a, b) { return a[0] - b[0]; }); var c = [cands[0][1], cands[0][2]]; OP.pos.spiral = c; KEEPOUT.push([c[0], c[1], 12]); clearProps(c[0], c[1], 11.5, ["bush1", "bush2", "boulder", "ocotillo", "saguaro", "mesquite", "paloverde", "desertwillow"]);
    var pts = [], turns = 3.25, r0 = 1.3, R = 9.3, th = 0; while (th <= turns * TAU) { var r = r0 + (R - r0) * th / (turns * TAU); pts.push([c[0] + Math.cos(th) * r, c[1] + Math.sin(th) * r]); th += 1.1 / Math.max(r, 1.3); } OP.pos.spiralPts = pts;
    if (!OP.spiralMat) { OP.spiralMat = new THREE.MeshStandardMaterial({ map: TEX.dirt, normalMap: TEX.dirtN, color: 0x4a4038, roughness: 1 }); ROAD_MATS.set(OP.spiralMat, false); }
    planRibbon(pts, 1.3, { mat: OP.spiralMat, lift: 0.16, tile: 2 }, "b4_stone_spiral");
  }
  function worldGeoglyph() { var q = place("geoglyph"); if (!q) return; OP.pos.geo = [q.x, q.z]; KEEPOUT.push([q.x, q.z, 48]); clearProps(q.x, q.z, 47, ["bush1", "bush2", "boulder", "ocotillo", "saguaro", "mesquite", "paloverde"]); }
  function worldCascade() {
    var q = place("fountain_court") || fount("cascade"); if (!q) return; var c = [q.x, q.z];
    // the free sector between the walks that meet at the court; the cascade climbs away from the junction inside it
    var dirs = []; ["gallery_walk", "ridge_walk"].forEach(function (id) { var p = prom(id); if (!p) return; for (var i = 0; i < p.pts.length; i++) { var a = p.pts[i]; if (Math.hypot(a[0] - c[0], a[1] - c[1]) > 1) continue; if (i > 0) dirs.push(Math.atan2(p.pts[i - 1][1] - a[1], p.pts[i - 1][0] - a[0])); if (i < p.pts.length - 1) dirs.push(Math.atan2(p.pts[i + 1][1] - a[1], p.pts[i + 1][0] - a[0])); } });
    var bestA = 0, bestS = -1; for (var k = 0; k < 72; k++) { var a2 = k / 72 * TAU, gap = 9; dirs.forEach(function (d) { gap = Math.min(gap, Math.abs(Math.atan2(Math.sin(a2 - d), Math.cos(a2 - d)))); }); var x = c[0] + Math.cos(a2) * 18, z = c[1] + Math.sin(a2) * 18; var sc = gap - (planNearCollider(x, z, 4) ? 3 : 0); if (sc > bestS) { bestS = sc; bestA = a2; } }
    var ux = Math.cos(bestA), uz = Math.sin(bestA); OP.pos.cascade = { x: c[0], z: c[1], ux: ux, uz: uz, s0: 11, s1: 25 };
    for (var s = 11; s <= 26; s += 3) { clearProps(c[0] + ux * s, c[1] + uz * s, 5); }
    var rx0 = -uz, rz0 = ux, poly = []; [[10.5, -4.4], [26.5, -4.4], [26.5, 4.4], [10.5, 4.4]].forEach(function (q) { poly.push([c[0] + ux * q[0] + rx0 * q[1], c[1] + uz * q[0] + rz0 * q[1]]); }); planKeepout(poly); OP.pos.cascadePoly = poly;
    // the formal desert garden: fan palms in pairs along the cascade
    OP.pos.cascadePalms = 0; for (var p2 = 13; p2 <= 25; p2 += 4) for (var sd = -1; sd <= 1; sd += 2) { var px = c[0] + ux * p2 - uz * 6.4 * sd, pz = c[1] + uz * p2 + ux * 6.4 * sd; if (planNearRoad(px, pz, 1.2) || planNearCollider(px, pz, 1.0)) continue; if (putB4("fanpalm", px, pz, rr() * TAU, 0.95 + rr() * 0.15, true)) OP.pos.cascadePalms++; putB4("agave_cluster", px + ux * 2, pz + uz * 2, rr() * TAU, 1.0, true); }
  }
  function worldPlanets() { OP.pos.planets = []; ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"].forEach(function (nm) { var f = fount("planet_" + nm); if (!f) return; OP.pos.planets.push({ id: nm, x: f.x, z: f.z, major: f.scale === "major" }); COLLIDERS.push([f.x, f.z, 0.75]); clearProps(f.x, f.z, 3.4); });
    var names = { mercury: "Mercury", venus: "Venus", earth: "Earth", mars: "Mars", jupiter: "Jupiter", saturn: "Saturn", uranus: "Uranus", neptune: "Neptune" };
    OP.pos.planets.forEach(function (p) { hotspot(p.x, p.z, 6, names[p.id] + " Fountain", "The Orbit Walk · eight planets round the Ring", "Floor jets round a " + names[p.id] + " globe, standing at its place in the orbits round the Genesis Ring. After dark the water is lit in the colours of the planet."); });
    var cd = OP.pos.count && OP.pos.count[0]; if (cd) hotspot(cd.x, cd.z, 10, "The Countdown", "Launch Walk · The Outpost", "Ten numbered light rings count you down the Launch Walk to the Genesis Ring, one every 25 m, through a lit xeno-garden. Ring 1 is the Halo Mist at the foot of the Ring. Beyond the Outpost Gate, no wheels but rovers.");
    var hl1 = prom("hl1_club_walk"); if (hl1) { var s = at(hl1.pts, 9); hotspot(s.x + s.rx * 3.4, s.z + s.rz * 3.4, 5, "The Horizon Line", "The brass line starts here", "Lost? Find the brass line. It runs from Arrivals Court along the Club Walk, through The Crossing, down Main Street and Sculpture Avenue and along the Launch Walk to the Genesis Ring, about 1,550 m on foot, with a brass star every 25 m."); }
  }

  // ═════════════════════════════════ TERRAIN ═════════════════════════════════
  function terrain() {
    if (!window.PLAN) return; var cw = (T.xmax - T.xmin) / (T.cols - 1), chh = (T.zmax - T.zmin) / (T.rows - 1);
    var each = function (x0, x1, z0, z1, fn) { var c0 = Math.max(0, Math.floor((x0 - T.xmin) / cw)), c1 = Math.min(T.cols - 1, Math.ceil((x1 - T.xmin) / cw)), r0 = Math.max(0, Math.floor((z0 - T.zmin) / chh)), r1 = Math.min(T.rows - 1, Math.ceil((z1 - T.zmin) / chh)); for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) fn(r * T.cols + c, T.xmin + c * cw, T.zmin + r * chh); };
    safe("mound", function () { var c = OP.pos.ring || ringCentre(); var base = 0, nb = 0; each(c[0] - 10, c[0] + 10, c[1] - 10, c[1] + 10, function (i, x, z) { if (Math.hypot(x - c[0], z - c[1]) <= 10) { base += H[i]; nb++; } }); base = nb ? base / nb : getH(c[0], c[1]); var top = base + 2.2;
      each(c[0] - 28, c[0] + 28, c[1] - 28, c[1] + 28, function (i, x, z) { var d = Math.hypot(x - c[0], z - c[1]); if (d > 26) return; var k = d <= 9.5 ? 1 : 1 - sstep(9.5, 26, d); var v = H[i] + (top - H[i]) * k; if (v > H[i]) H[i] = v; }); OP.moundTop = top; });
    safe("sunPad", function () { var c = OP.pos.sun; if (!c) return; var base = 0, nb = 0; each(c[0] - 13, c[0] + 13, c[1] - 13, c[1] + 13, function (i, x, z) { if (Math.hypot(x - c[0], z - c[1]) <= 13) { base += H[i]; nb++; } }); if (!nb) return; base /= nb;
      each(c[0] - 22, c[0] + 22, c[1] - 22, c[1] + 22, function (i, x, z) { var d = Math.hypot(x - c[0], z - c[1]); if (d > 21) return; var k = d <= 13.5 ? 1 : 1 - sstep(13.5, 21, d); H[i] += (base - H[i]) * k; }); });
    safe("berm", function () { var B = OP.berm; if (!B || !B.st.length) return; var open = function (t) { var i = Math.round((t - B.t0) / 3); var k = 1; for (var j = -4; j <= 4; j++) { var s = B.st[i + j]; if (!s || s[1]) { k = Math.min(k, clamp((Math.abs(j) * 3 - 2) / 12, 0, 1)); } } return k; };
      var pA = along(B.t0, B.sc), pB = along(B.t1, B.sc); var x0 = Math.min(pA[0], pB[0]) - 20, x1 = Math.max(pA[0], pB[0]) + 20, z0 = Math.min(pA[1], pB[1]) - 20, z1 = Math.max(pA[1], pB[1]) + 20; var n = 0;
      each(x0, x1, z0, z1, function (i, x, z) { var dx = x - runwayMid[0], dz = z - runwayMid[1]; var t = dx * U[0] + dz * U[1], s = dx * Nn[0] + dz * Nn[1]; if (t < B.t0 || t > B.t1) return; var ds = Math.abs(s - B.sc); if (ds > B.half) return; var h = 4 * (1 - sstep(1.25, B.half, ds)) * sstep(B.t0, B.t0 + 16, t) * (1 - sstep(B.t1 - 16, B.t1, t)) * open(t); if (h > 0.01) { H[i] += h; n++; } }); OP.n.bermCells = n; });
  }

  // ═════════════════════════════════ DEFER: the meshes ═════════════════════════════════
  function defer() {
    if (!window.PLAN) return; var Mm = mats();
    [["ring", buildRing], ["countdown", buildCountdown], ["xeno", buildXeno], ["launch", buildLaunch], ["dome", buildDome], ["observatory", buildObservatory], ["stratos", buildStratos], ["lowg", buildLowG], ["launchComplex", buildLaunchComplex],
      ["compass", buildCompass], ["beacon", buildBeacon], ["gates", buildGates], ["fieldOfLight", buildFieldOfLight], ["sunTunnels", buildSunTunnels], ["spiral", buildSpiral], ["geoglyph", buildGeoglyph], ["cascade", buildCascade], ["planets", buildPlanets], ["brass", buildBrass], ["dishes", buildDishes]].forEach(function (b) { safe(b[0], function () { b[1](Mm); }); });
    OP.built = true; console.log("plan_outpost: built " + Object.keys(OP.n).length + " parts, " + OP.items.length + " gated, " + OP.lights.length + " lights" + (OP.err.length ? ", " + OP.err.length + " problems" : ""));
  }

  // ── the Genesis Ring over the Halo Mist ──
  function buildRing(Mm) {
    var c = OP.pos.ring, A = axis(), yaw = yawOf(A.ux, A.uz), y0 = getH(c[0], c[1]); var R = 10.7, r = 1.3, lift = 0.9, cy = lift + R + r;
    var g = new THREE.Group(); g.position.set(c[0], y0, c[1]); g.rotation.y = yaw;
    var ring = new THREE.Mesh(scaleUV(new THREE.TorusGeometry(R, r, 28, 220), 44, 4), Mm.panel); ring.position.y = cy; ring.castShadow = true; ring.receiveShadow = true; g.add(ring);
    var halo = new THREE.Mesh(new THREE.TorusGeometry(R - r + 0.05, 0.2, 8, 220), Mm.ringGlow); halo.position.y = cy; g.add(halo);
    for (var s = -1; s <= 1; s += 2) { var f = new THREE.Mesh(new THREE.TorusGeometry(R, 0.08, 6, 220), Mm.ringGlow); f.position.set(0, cy, s * (r - 0.03)); g.add(f); }
    // the red obstruction light, steady, on top
    var hous = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.35, 12), Mm.dark); hous.position.y = cy + R + r + 0.12; g.add(hous);
    var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 10), Mm.red); lamp.position.y = cy + R + r + 0.42; g.add(lamp);
    // the cradle and its two fins along the axis
    var cr = new THREE.Mesh(boxUV(7.6, 1.5, 4.6, 2), Mm.concrete); cr.position.y = 0.55; cr.castShadow = cr.receiveShadow = true; g.add(cr);
    var fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(4.6, 0); fin.lineTo(4.6, 0.45); fin.lineTo(0, 2.7); fin.lineTo(0, 0);
    for (var sd = -1; sd <= 1; sd += 2) { var fg = new THREE.ExtrudeGeometry(fin, { depth: 1.0, bevelEnabled: false }); fg.translate(0, 0, -0.5); fg.rotateY(-Math.PI / 2); if (sd < 0) fg.rotateY(Math.PI); var fm = new THREE.Mesh(fg, Mm.white); fm.position.set(0, -0.2, sd * 1.0); fm.castShadow = true; g.add(fm); }
    // the Halo Mist: a flush grated ring round the cradle, ring 1 of the Countdown as a floor light just outside it (draped on the walk)
    var grate = canvasTex(512, 64, function (x, w, h) { x.fillStyle = "#1c2024"; x.fillRect(0, 0, w, h); x.fillStyle = "#3a4046"; for (var i = 0; i < w; i += 8) x.fillRect(i, 0, 3, h); x.fillStyle = "#555c62"; x.fillRect(0, 0, w, 4); x.fillRect(0, h - 4, w, 4); }, true);
    var gm = new THREE.MeshStandardMaterial({ map: grate, roughness: 0.6, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    var dec = new THREE.Group(); var gmesh = new THREE.Mesh(drapeAnnulus(c[0], c[1], 6.4, 7.3, 144, 2, function (x, z) { return surf(x, z) + 0.035; }, function (a, r) { return [a * 60, r]; }), gm); gmesh.receiveShadow = true; dec.add(gmesh);
    var r1 = new THREE.Mesh(drapeAnnulus(c[0], c[1], 7.55, 7.85, 180, 1, function (x, z) { return surf(x, z) + 0.04; }, function (a, r) { return [a, r]; }), Mm.countGlow); dec.add(r1);
    var mx = c[0] - A.ux * 8.9, mz = c[1] - A.uz * 8.9; var og = drape(mx, mz, 0.9, 0.2, medallionUV(0.85, A.ux, A.uz, 1), function (lx, lz) { return lx * lx + lz * lz < 0.85 * 0.85; }, function (x, z) { return surf(x, z) + 0.045; }); if (og) dec.add(new THREE.Mesh(og, numeralMat(Mm)));
    addGroup(dec, true);
    // glow: a ring of soft cyan sprites along the inner face and a red sprite on the lamp, so the Ring reads across the whole site
    var gp = []; for (var k = 0; k < 96; k++) { var a = k / 96 * TAU; gp.push([Math.cos(a) * (R - r + 0.2), cy + Math.sin(a) * (R - r + 0.2), 0, 4.6]); } var glow = glowPoints(gp, 0x46e8ff, 2.4); g.add(glow); OP.ringGlowPts = glow;
    var rg = glowPoints([[0, cy + R + r + 0.42, 0, 2.6]], 0xff3020, 2.5); g.add(rg); OP.redGlowPts = rg;
    addGroup(g, true); OP.ringGroup = g;
    // the Halo Mist particles (world-aligned group at the Ring)
    var mm = mistMat(); mm.uniforms.uRise.value = 3.2; mm.uniforms.uLife.value = 7; mm.uniforms.uSpread.value = 1.8; mm.uniforms.uSize.value = 1.25; OP.haloMist = mm;
    var mg = new THREE.Group(); mg.position.set(c[0], y0 + 0.1, c[1]); mg.add(mistPoints(480, function () { var a = rr() * TAU, rad = 6.85 + (rr() - 0.5) * 0.7; return [Math.cos(a) * rad, rr() * 0.3, Math.sin(a) * rad]; }, mm)); addGroup(mg, true); gate(mg, c[0], c[1], 420);
    light(0x46e8ff, 2.4, 36, c[0], y0 + 3, c[1], "ring");
    // solids: the cradle, the fins and the low arc of the ring
    addSolid(c[0], c[1], yaw, 7.6, 4.6, y0 - 0.4, y0 + 1.3, "world"); addSolid(c[0], c[1], yaw, 1.0, 11.2, y0 - 0.4, y0 + 2.5, "world"); addSolid(c[0], c[1], yaw, 11.6, 2.8, y0 - 0.4, y0 + 2.6, "world");
    OP.n.ring = 1;
  }
  // the numeral atlas for the Countdown (1 to 10): 5 x 2 cells of 256 px
  function numeralTex() { if (OP.numTex) return OP.numTex; OP.numTex = canvasTex(1280, 512, function (x, w, h) { x.fillStyle = "#0b1a22"; x.fillRect(0, 0, w, h); for (var n = 1; n <= 10; n++) { var i = (n - 1) % 5, j = Math.floor((n - 1) / 5), cx = i * 256 + 128, cy = j * 256 + 128; x.fillStyle = "#0e2630"; x.beginPath(); x.arc(cx, cy, 124, 0, TAU); x.fill(); x.strokeStyle = "#54eeff"; x.lineWidth = 10; x.beginPath(); x.arc(cx, cy, 112, 0, TAU); x.stroke(); x.fillStyle = "#e9fbff"; x.font = "700 " + (n === 10 ? 138 : 164) + "px Anton, Impact, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(String(n), cx, cy + 8); } }); return OP.numTex; }
  function numeralMat(Mm) { if (OP.numMat) return OP.numMat; var t = numeralTex(); OP.numMat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); return OP.numMat; }
  // remap a circle's uvs (0..1) into numeral n's atlas cell; flat = true for a floor medallion read from the walk
  function numeralUV(geo, n, flat) { var i = (n - 1) % 5, j = Math.floor((n - 1) / 5), uv = geo.attributes.uv; for (var k = 0; k < uv.count; k++) { var u = uv.getX(k), v = uv.getY(k); if (flat) { v = 1 - v; u = 1 - u; } uv.setXY(k, (i + u) / 5, 1 - (j + 1 - v) / 2); } uv.needsUpdate = true; return geo; }

  // ── the Countdown: nine standing light rings (10 to 2) over the Launch Walk ──
  function buildCountdown(Mm) {
    var A = axis(), yaw = yawOf(A.ux, A.uz), R = 8.5, c0 = 3.3; var th = Math.asin(c0 / R) + 3 * DEG, arc = Math.PI + 2 * th;
    var shellG = new THREE.TorusGeometry(R, 0.3, 10, 132, arc); shellG.rotateZ(-th); scaleUV(shellG, 18, 1);
    var stripG = new THREE.TorusGeometry(R - 0.27, 0.085, 6, 132, arc); stripG.rotateZ(-th);
    var shoeG = boxUV(1.0, 0.7, 1.0, 1);
    var shells = [], shoes = [], badges = new Batch(), rims = new Batch(); OP.pos.countY = [];
    OP.pos.count.forEach(function (s) { if (s.n === 1) return; var y = surf(s.x, s.z); OP.pos.countY.push([s.n, y]); shells.push(mtx(s.x, y + c0, s.z, yaw)); var rx = A.uz, rz = -A.ux;
      for (var sd = -1; sd <= 1; sd += 2) { var fx = s.x + rx * 7.83 * sd, fz = s.z + rz * 7.83 * sd, fy = getH(fx, fz); shoes.push(mtx(fx, fy + 0.2, fz, yaw)); addSolid(fx, fz, yaw, 0.9, 0.9, fy - 0.3, fy + 2.2, "world"); }
      var cg = new THREE.CircleGeometry(0.95, 40); numeralUV(cg, s.n, false); var top = y + c0 + R - 0.3 - 1.25;
      badges.add(cg, mtx(s.x - A.ux * 0.09, top, s.z - A.uz * 0.09, yaw + Math.PI)); var cg2 = new THREE.CircleGeometry(0.95, 40); numeralUV(cg2, s.n, false); badges.add(cg2, mtx(s.x + A.ux * 0.09, top, s.z + A.uz * 0.09, yaw));
      rims.add(new THREE.CylinderGeometry(1.0, 1.0, 0.16, 40, 1, true), mtx(s.x, top, s.z, yaw, Math.PI / 2)); rims.add(new THREE.CylinderGeometry(0.05, 0.05, 1.05, 6), mtx(s.x, top + 1.0 + 0.1, s.z, yaw)); });
    var g = new THREE.Group(); g.add(instanced(shellG, Mm.panel, shells)); g.add(instanced(stripG, Mm.countGlow, shells, false)); g.add(instanced(shoeG, Mm.concrete, shoes)); var bm = badges.mesh(numeralMat(Mm), false); if (bm) g.add(bm); var rm = rims.mesh(Mm.white); if (rm) g.add(rm);
    // a soft cyan glow along each ring at night
    var gp = []; OP.pos.count.forEach(function (s) { if (s.n === 1) return; var y = surf(s.x, s.z) + c0; for (var k = 0; k <= 20; k++) { var a = -th + k / 20 * arc, lx = Math.cos(a) * (R - 0.3), ly = Math.sin(a) * (R - 0.3); if (ly < -c0 + 0.4) continue; gp.push([s.x + A.uz * lx, y + ly, s.z - A.ux * lx, 1.6]); } }); var cgp = glowPoints(gp, 0x4ff0ff, 1.2); g.add(cgp); OP.countGlowPts = cgp;
    addGroup(g, true); gate(g, A.a[0] + A.ux * A.L / 2, A.a[1] + A.uz * A.L / 2, 1500); OP.n.countdown = shells.length;
  }

  // ── the lit xeno-garden: raked red gravel beds, boojums, blue-lit agave, fibre-optic grass ──
  function buildXeno(Mm) {
    var A = axis(), rx = A.uz, rz = -A.ux, own = new Set(ROADS.filter(function (r) { return r.plan === "hl5_launch_walk"; }));
    var pos = [], uv = [], idx = [];
    OP.pos.beds.forEach(function (b) { var n = Math.ceil((b.d1 - b.d0) / 1.6), m = 4, base = pos.length / 3; for (var i = 0; i <= n; i++) for (var j = 0; j <= m; j++) { var d = b.d0 + (b.d1 - b.d0) * i / n, lat = 8.6 + 6.4 * j / m; var x = A.a[0] + A.ux * d + rx * lat * b.sd, z = A.a[1] + A.uz * d + rz * lat * b.sd; pos.push(x, getH(x, z) + 0.05, z); uv.push(x / 3, z / 3); }
      for (var i2 = 0; i2 < n; i2++) for (var j2 = 0; j2 < m; j2++) { var a = base + i2 * (m + 1) + j2, bb = a + 1, cc = a + m + 1, dd = cc + 1; if (b.sd > 0) idx.push(a, cc, bb, bb, cc, dd); else idx.push(a, bb, cc, bb, dd, cc); } });
    if (idx.length) { var bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); bg.setIndex(idx); bg.computeVertexNormals(); walkAdd(bg); var bed = new THREE.Mesh(bg, planMats().redg); bed.receiveShadow = true; addMesh(bed); }
    // boojums: two tapering, gently bent trunks with short twigs, instanced
    var mk = function (bend) { var b = new Batch(); var lp = []; [[0.36, 0], [0.34, 0.8], [0.29, 2.4], [0.21, 4.3], [0.13, 6], [0.06, 7.2], [0.01, 7.6]].forEach(function (q) { lp.push(new THREE.Vector2(q[0], q[1])); }); var tr = new THREE.LatheGeometry(lp, 8); var pa = tr.attributes.position; for (var i = 0; i < pa.count; i++) { var y = pa.getY(i); pa.setX(i, pa.getX(i) + bend * Math.pow(y / 7.6, 2)); } tr.computeVertexNormals(); b.add(tr);
      for (var t = 0; t < 70; t++) { var y2 = 0.6 + (t / 70) * 6.8, rad = 0.36 - 0.33 * (y2 / 7.6), a = t * 2.39996; var tw = new THREE.BoxGeometry(0.03, 0.03, 0.28 + 0.2 * (1 - y2 / 7.6)); b.add(tw, mtx(Math.cos(a) * (rad + 0.1) + bend * Math.pow(y2 / 7.6, 2), y2, Math.sin(a) * (rad + 0.1), -a + Math.PI / 2, -0.5)); } return b.geo(); };
    var geoA = mk(0.45), geoB = mk(-0.7); var la = [], lb = []; OP.pos.boojum.forEach(function (q) { (q[4] ? lb : la).push(mtx(q[0], getH(q[0], q[1]) - 0.05, q[1], q[3], 0, 0, q[2])); });
    var g = new THREE.Group(); if (la.length) g.add(instanced(geoA, Mm.plant, la)); if (lb.length) g.add(instanced(geoB, Mm.plant, lb));
    // fibre-optic grass: tufts of fine fibres with glowing tips
    var tips = [], lines = []; OP.pos.fibre.forEach(function (q) { var y = getH(q[0], q[1]); for (var k = 0; k < 46; k++) { var a = rr() * TAU, rad = Math.sqrt(rr()) * 0.75, h = 0.35 + rr() * 0.55; var tx = q[0] + Math.cos(a) * rad, tz = q[1] + Math.sin(a) * rad; tips.push([tx, y + h, tz]); lines.push(q[0] + Math.cos(a) * rad * 0.15, y + 0.02, q[1] + Math.sin(a) * rad * 0.15, tx, y + h, tz); } });
    if (tips.length) { var fm = twinkleMat(0.07, 0.25); OP.fibreMat = fm; g.add(seededPoints(tips, fm)); var lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3)); var ls = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x6f8a90, transparent: true, opacity: 0.55 })); ls.userData.noInst = true; g.add(ls); }
    // the agave uplights: a blue glow at the foot of each plant
    var ag = []; OP.pos.agave.forEach(function (q) { ag.push([q[0], getH(q[0], q[1]) + 0.35, q[1], 2.4]); }); if (ag.length) { var ap = glowPoints(ag, 0x2d6bff, 1.2); g.add(ap); OP.agaveGlow = ap; }
    addGroup(g, true); var mid = at([A.a, A.b], A.L / 2); gate(g, mid.x, mid.z, 700); OP.n.xeno = OP.pos.boojum.length + OP.pos.fibre.length;
  }

  // ── Launch Plaza: the Launch Mist pad and the lander's blast pad ──
  function buildLaunch(Mm) {
    var c = OP.pos.launch; if (!c) return; var A = axis();
    var pad = canvasTex(1024, 1024, function (x, w) { var k = w / 12, cx = w / 2; x.fillStyle = "#2a2e31"; x.beginPath(); x.arc(cx, cx, 6 * k, 0, TAU); x.fill(); x.strokeStyle = "#3d4347"; x.lineWidth = 3; for (var r = 0.8; r < 6; r += 0.45) { x.beginPath(); x.arc(cx, cx, r * k, 0, TAU); x.stroke(); } for (var i = 0; i < 48; i++) { var a = i / 48 * TAU; x.beginPath(); x.moveTo(cx + Math.cos(a) * 0.8 * k, cx + Math.sin(a) * 0.8 * k); x.lineTo(cx + Math.cos(a) * 5.6 * k, cx + Math.sin(a) * 5.6 * k); x.stroke(); }
      x.strokeStyle = "#e9e6dc"; x.lineWidth = 0.22 * k; x.beginPath(); x.arc(cx, cx, 5.75 * k, 0, TAU); x.stroke(); x.fillStyle = "#16191b"; for (var j = 0; j < 12; j++) { var b = j / 12 * TAU; x.beginPath(); x.arc(cx + Math.cos(b) * 4.6 * k, cx + Math.sin(b) * 4.6 * k, 0.28 * k, 0, TAU); x.fill(); } x.fillStyle = "#f4cd5a"; for (var q = 0; q < 24; q++) { if (q % 2) continue; var a0 = q / 24 * TAU; x.beginPath(); x.arc(cx, cx, 5.95 * k, a0, a0 + TAU / 24); x.arc(cx, cx, 5.55 * k, a0 + TAU / 24, a0, true); x.fill(); } });
    var pm = new THREE.MeshStandardMaterial({ map: pad, transparent: true, alphaTest: 0.5, roughness: 0.55, metalness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    var geo = drape(c[0], c[1], 6.1, 0.6, function (lx, lz) { return [(lx + 6) / 12, (6 - lz) / 12]; }, function (lx, lz) { return lx * lx + lz * lz < 6.3 * 6.3; }, function (x, z) { return surf(x, z) + 0.04; });
    var g = new THREE.Group(); if (geo) { var pmh = new THREE.Mesh(geo, pm); pmh.receiveShadow = true; g.add(pmh); }
    // the white LED ring round the pad and the nozzle glows
    var ringY = surf(c[0], c[1]) + 0.06; var lrm = Mm.warm.clone(); lrm.emissive = new THREE.Color(0xf4fbff); var lr = new THREE.Mesh(drapeAnnulus(c[0], c[1], 6.02, 6.22, 150, 1, function (x, z) { return surf(x, z) + 0.05; }, function (a, r) { return [a, r]; }), lrm); g.add(lr); OP.launchRing = lrm;
    var mm = mistMat(); mm.uniforms.uRise.value = 4; mm.uniforms.uLife.value = 4.5; mm.uniforms.uSpread.value = 2.6; mm.uniforms.uSize.value = 1.5; OP.launchMist = mm;
    var mg = new THREE.Group(); mg.position.set(c[0], ringY, c[1]); mg.add(mistPoints(520, function (i) { var a = (i % 13) / 12 * TAU + rr() * 0.2, rad = i % 13 === 12 ? rr() * 1.4 : 4.6; return [Math.cos(a) * rad, 0.05, Math.sin(a) * rad]; }, mm)); g.add(mg);
    OP.launchLight = light(0xf2f7ff, 1, 34, c[0], ringY + 2.2, c[1], "launch");
    // the lander's blast pad (under the lander model or its stand-in)
    var L = OP.pos.lander; if (L) { var sc = canvasTex(512, 512, function (x, w) { var cx = w / 2; var gr = x.createRadialGradient(cx, cx, w * 0.05, cx, cx, w * 0.5); gr.addColorStop(0, "rgba(30,26,22,0.95)"); gr.addColorStop(0.55, "rgba(60,52,44,0.75)"); gr.addColorStop(0.9, "rgba(120,110,98,0.35)"); gr.addColorStop(1, "rgba(120,110,98,0)"); x.fillStyle = "#b8b1a4"; x.beginPath(); for (var i = 0; i < 6; i++) { var a = i / 6 * TAU + 0.5; x.lineTo(cx + Math.cos(a) * w * 0.49, cx + Math.sin(a) * w * 0.49); } x.closePath(); x.fill(); x.fillStyle = gr; x.fillRect(0, 0, w, w); });
      var sm = new THREE.MeshStandardMaterial({ map: sc, transparent: true, alphaTest: 0.1, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); var lg = drape(L[0], L[1], 8, 1, function (lx, lz) { return [(lx + 8) / 16, (8 - lz) / 16]; }, function (lx, lz) { return lx * lx + lz * lz < 8.4 * 8.4; }, function (x, z) { return surf(x, z) + 0.05; }); if (lg) { var lm = new THREE.Mesh(lg, sm); lm.receiveShadow = true; g.add(lm); } }
    addGroup(g, true); gate(mg, c[0], c[1], 380); OP.n.launch = 1;
  }

  // ── the Genesis Dome: a low 60 m geodesic biome with an entry canopy ──
  function buildDome(Mm) {
    var c = OP.pos.dome; if (!c) return; var e = OP.pos.domeDir, y0 = getH(c[0], c[1]) - 0.1; var Rs = 34, hh = 18, cut = (Rs - hh) / Rs;
    var ico = new THREE.IcosahedronGeometry(1, 7); var phi = (1 + Math.sqrt(5)) / 2; ico.rotateZ(Math.atan(1 / phi)); var pa = ico.attributes.position; var tris = [];
    for (var i = 0; i < pa.count; i += 3) { var cyv = (pa.getY(i) + pa.getY(i + 1) + pa.getY(i + 2)) / 3; if (cyv < cut) continue; var tri = []; for (var k = 0; k < 3; k++) { var v = new THREE.Vector3(pa.getX(i + k), pa.getY(i + k), pa.getZ(i + k)); if (v.y < cut) { var rxz = Math.hypot(v.x, v.z) || 1, rb = Math.sqrt(1 - cut * cut); v.set(v.x / rxz * rb, cut, v.z / rxz * rb); } tri.push(v); } tris.push(tri); }
    var W = function (v) { return new THREE.Vector3(c[0] + v.x * Rs, y0 + (v.y - cut) * Rs, c[1] + v.z * Rs); };
    var struts = new Batch(), glass = new Batch(), frost = new Batch(), edges = new Map(), unit = new THREE.BoxGeometry(1, 1, 1), m4 = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
    var key = function (v) { return Math.round(v.x * 1e4) + "," + Math.round(v.y * 1e4) + "," + Math.round(v.z * 1e4); };
    tris.forEach(function (t, ti) { var wv = t.map(W); var cen = wv[0].clone().add(wv[1]).add(wv[2]).multiplyScalar(1 / 3); var inset = wv.map(function (p) { return p.clone().lerp(cen, 0.06); });
      var tg = new THREE.BufferGeometry(); tg.setAttribute("position", new THREE.Float32BufferAttribute([inset[0].x, inset[0].y, inset[0].z, inset[2].x, inset[2].y, inset[2].z, inset[1].x, inset[1].y, inset[1].z], 3)); tg.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2)); tg.computeVertexNormals();
      var lat = t[0].y + t[1].y + t[2].y; var fr = (lat / 3 > 0.9) || (Math.abs(lat / 3 - 0.66) < 0.035) || hsh(ti * 7.1) < 0.18; (fr ? frost : glass).add(tg);
      for (var k = 0; k < 3; k++) { var a = t[k], b = t[(k + 1) % 3]; var ka = key(a), kb = key(b), kk = ka < kb ? ka + "|" + kb : kb + "|" + ka; if (!edges.has(kk)) edges.set(kk, [W(a), W(b)]); } });
    edges.forEach(function (ab) { var a = ab[0], b = ab[1]; Z.subVectors(b, a); var L = Z.length(); if (L < 0.05) return; Z.normalize(); var out = a.clone().add(b).multiplyScalar(0.5).sub(new THREE.Vector3(c[0], y0 - cut * Rs, c[1])).normalize(); X.crossVectors(out, Z).normalize(); Y.crossVectors(Z, X); m4.makeBasis(X.multiplyScalar(0.32), Y.multiplyScalar(0.32), Z.multiplyScalar(L)); var mid = a.clone().add(b).multiplyScalar(0.5); m4.setPosition(mid); struts.add(unit, m4); });
    var g = new THREE.Group(); var sm = struts.mesh(Mm.white); if (sm) g.add(sm); var fm = frost.mesh(Mm.frost); if (fm) g.add(fm); var gm = glass.mesh(Mm.glass, false); if (gm) { gm.renderOrder = 3; g.add(gm); }
    // the base ring wall and the planetarium drum inside
    var rb = Math.sqrt(1 - cut * cut) * Rs; var wall = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(rb + 0.35, rb + 0.45, 1.6, 96, 1, true), 40, 1), Mm.concrete); wall.position.set(c[0], y0 + 0.2, c[1]); wall.receiveShadow = true; g.add(wall);
    var cap = new THREE.Mesh(new THREE.RingGeometry(rb - 0.2, rb + 0.45, 96, 1), Mm.concrete); cap.rotation.x = -Math.PI / 2; cap.position.set(c[0], y0 + 1.0, c[1]); g.add(cap);
    var drum = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 8.5, 5.2, 48), Mm.white); drum.position.set(c[0], y0 + 2.6, c[1]); drum.castShadow = true; g.add(drum); var dc = new THREE.Mesh(new THREE.SphereGeometry(8.5, 40, 12, 0, TAU, 0, Math.PI / 2), Mm.panel); dc.scale.y = 0.45; dc.position.set(c[0], y0 + 5.2, c[1]); g.add(dc);
    // the entry canopy: a glazed half-vault with white ribs, a lit portal at its mouth, the glass doors at the dome wall
    var yaw = yawOf(e[0], e[1]), v0 = 26.5, v1 = 38.5, vr = 4.2, vc = (v0 + v1) / 2, vx = c[0] + e[0] * vc, vz = c[1] + e[1] * vc, vy = surf(c[0] + e[0] * 34, c[1] + e[1] * 34) - 0.3;
    var vault = new THREE.CylinderGeometry(vr, vr, v1 - v0, 24, 1, true, -Math.PI / 2, Math.PI); vault.rotateX(-Math.PI / 2); var vm = new THREE.Mesh(vault, Mm.glass); vm.position.set(vx, vy, vz); vm.rotation.y = yaw; vm.renderOrder = 3; g.add(vm);
    var ribs = new Batch(); for (var r = 0; r <= 6; r++) { var d = v0 + 1.2 + (v1 - v0 - 1.2) * r / 6; ribs.add(new THREE.TorusGeometry(vr + 0.05, 0.14, 6, 24, Math.PI), mtx(c[0] + e[0] * d, vy, c[1] + e[1] * d, yaw)); } for (var sd = -1; sd <= 1; sd += 2) ribs.add(boxUV(0.25, 0.25, v1 - v0, 1), mtx(vx + Math.cos(yaw) * vr * sd, vy + 0.12, vz - Math.sin(yaw) * vr * sd, yaw)); var rm = ribs.mesh(Mm.white); if (rm) g.add(rm);
    var portal = new THREE.Mesh(new THREE.TorusGeometry(vr + 0.12, 0.1, 6, 32, Math.PI), Mm.ringGlow); portal.position.set(c[0] + e[0] * (v1 + 0.05), vy, c[1] + e[1] * (v1 + 0.05)); portal.rotation.y = yaw; g.add(portal);
    var door = new THREE.Mesh(new THREE.CircleGeometry(vr - 0.1, 24, 0, Math.PI), Mm.frost); door.position.set(c[0] + e[0] * 29.2, vy + 0.05, c[1] + e[1] * 29.2); door.rotation.y = yaw + Math.PI; g.add(door);
    for (var s2 = -1; s2 <= 1; s2 += 2) addSolid(vx + Math.cos(yaw) * (vr - 0.2) * s2, vz - Math.sin(yaw) * (vr - 0.2) * s2, yaw, 0.35, v1 - v0 - 1, vy - 0.5, vy + 4, "world");
    addSolid(c[0] + e[0] * 29.4, c[1] + e[1] * 29.4, yaw, vr * 2, 0.4, vy - 0.5, vy + 4.2, "world");
    addGroup(g); OP.domeGroup = g; light(0xffd7a0, 1.3, 42, c[0], y0 + 9, c[1], "night"); OP.n.dome = edges.size;
  }

  // ── the Dark Sky Observatory: red-light bollards on the spur and a stargazing pad ──
  function buildObservatory(Mm) {
    var sp = prom("observatory_spur"); var posts = [], caps = [], glows = [];
    if (sp) { var L = polyLen(sp.pts), w = sp.width || 6; for (var d = 1.5; d <= L; d += 3.5) { var s = at(sp.pts, d); for (var sd = -1; sd <= 1; sd += 2) { var x = s.x + s.rx * (w / 2 + 0.45) * sd, z = s.z + s.rz * (w / 2 + 0.45) * sd, y = getH(x, z); posts.push(mtx(x, y + 0.42, z)); caps.push(mtx(x, y + 0.86, z)); glows.push([x, y + 0.8, z, 0.7]); } } }
    var g = new THREE.Group(); if (posts.length) { g.add(instanced(new THREE.CylinderGeometry(0.07, 0.08, 0.84, 8), Mm.dark, posts)); var redDim = Mm.red.clone(); redDim.emissiveIntensity = 0.6; OP.redDim = redDim; g.add(instanced(new THREE.BoxGeometry(0.16, 0.06, 0.16), redDim, caps, false)); var gp = glowPoints(glows, 0xff2a18, 1); g.add(gp); OP.obsGlow = gp; }
    var pad = OP.pos.stargaze; if (pad) { var y0 = getH(pad[0], pad[1]); var disc = drape(pad[0], pad[1], 6, 1, function (lx, lz) { return [lx / 3, lz / 3]; }, function (lx, lz) { return lx * lx + lz * lz < 5.6 * 5.6; }, function (x, z) { return getH(x, z) + 0.06; }); if (disc) { walkAdd(disc); var dm = new THREE.Mesh(disc, planMats().redg); dm.receiveShadow = true; g.add(dm); }
      var tb = new Batch(); for (var k = 0; k < 3; k++) { var a = k / 3 * TAU + 0.4, tx = pad[0] + Math.cos(a) * 2.6, tz = pad[1] + Math.sin(a) * 2.6, ty = getH(tx, tz); for (var l = 0; l < 3; l++) { var b = l / 3 * TAU; tb.add(new THREE.CylinderGeometry(0.025, 0.03, 1.35, 5), mtx(tx + Math.cos(b) * 0.28, ty + 0.62, tz + Math.sin(b) * 0.28, 0, Math.sin(b) * 0.22, -Math.cos(b) * 0.22)); } tb.add(new THREE.CylinderGeometry(0.11, 0.13, 1.25, 12), mtx(tx, ty + 1.55, tz, a + Math.PI / 2, 0.9)); }
      var tm = tb.mesh(Mm.white); if (tm) g.add(tm); }
    addGroup(g, true); if (OP.pos.obs) gate(g, OP.pos.obs[0], OP.pos.obs[1], 520); OP.n.observatory = posts.length;
  }

  // ── Stratos Field: launch circles, the capsule on its cradle, a windsock ──
  function buildStratos(Mm) {
    var q = OP.pos.stratos; if (!q) return; var g = new THREE.Group(); var field = place("stratos_field"); var R = field ? field.r : 24;
    var tex = canvasTex(1024, 1024, function (x, w) { var k = w / (2 * R + 4), cx = w / 2; x.clearRect(0, 0, w, w); x.fillStyle = "rgba(172,120,90,0.9)"; x.beginPath(); x.arc(cx, cx, (R + 1.5) * k, 0, TAU); x.fill(); speckle(x, w, w, 5000, "90,54,36", 0.24);
      OP.pos.stratosPads.forEach(function (p) { var px = cx + (p[0] - q[0]) * k, pz = cx + (p[1] - q[1]) * k; x.strokeStyle = "#f5f1e6"; x.lineWidth = 0.45 * k; x.beginPath(); x.arc(px, pz, 6.2 * k, 0, TAU); x.stroke(); x.lineWidth = 0.25 * k; x.beginPath(); x.arc(px, pz, 4.8 * k, 0, TAU); x.stroke(); x.fillStyle = "#6fd6e8"; x.fillRect(px - 2.2 * k, pz - 0.2 * k, 4.4 * k, 0.4 * k); x.fillRect(px - 0.2 * k, pz - 2.2 * k, 0.4 * k, 4.4 * k); }); });
    var tm = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.4, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    var geo = drape(q[0], q[1], R + 2, 1.5, function (lx, lz) { return [(lx + R + 2) / (2 * R + 4), (R + 2 - lz) / (2 * R + 4)]; }, function (lx, lz) { return lx * lx + lz * lz < (R + 2) * (R + 2); }, function (x, z) { return surf(x, z) + 0.05; }); if (geo) { walkAdd(geo); var fmesh = new THREE.Mesh(geo, tm); fmesh.receiveShadow = true; g.add(fmesh); }
    // the capsule's cradle
    var cp = OP.pos.capsule; if (cp) { var y = getH(cp[0], cp[1]); var cb = new Batch(); cb.add(boxUV(4.6, 0.35, 4.6, 1), mtx(cp[0], y - 0.05, cp[1], cp[2])); for (var i = 0; i < 4; i++) { var a = cp[2] + Math.PI / 4 + i * Math.PI / 2; cb.add(new THREE.CylinderGeometry(0.1, 0.12, 0.6, 6), mtx(cp[0] + Math.sin(a) * 1.9, y + 0.3, cp[1] + Math.cos(a) * 1.9)); } var cm = cb.mesh(Mm.concrete); if (cm) g.add(cm); }
    // the windsock: mast, ring and an orange sock swinging with the wind
    var ws = OP.pos.windsock; if (ws) { var wy = getH(ws[0], ws[1]); var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 6.5, 8), Mm.white); mast.position.set(ws[0], wy + 3.25, ws[1]); g.add(mast); var sg = new THREE.Group(); sg.position.set(ws[0], wy + 6.2, ws[1]); var sockG = new THREE.CylinderGeometry(0.42, 0.18, 2.6, 16, 4, true); sockG.rotateZ(Math.PI / 2); sockG.translate(1.35, 0, 0); var sm = new THREE.MeshStandardMaterial({ color: 0xff7a1f, roughness: 0.85, side: THREE.DoubleSide }); var sock = new THREE.Mesh(sockG, sm); sg.add(sock); g.add(sg); OP.sock = sg; }
    addGroup(g, true); gate(g, q[0], q[1], 700); OP.n.stratos = 1;
  }

  // ── the Low-G Course: a crater floor of raked red gravel, a basalt rim with blue marker lights, the start deck ──
  function buildLowG(Mm) {
    var q = OP.pos.lowg; if (!q) return; var R = q[2], g = new THREE.Group();
    var tex = canvasTex(1024, 1024, function (x, w) { var k = w / (2 * R + 6), cx = w / 2; x.clearRect(0, 0, w, w); x.save(); x.beginPath(); x.arc(cx, cx, (R + 2.5) * k, 0, TAU); x.clip();
      var gr = x.createRadialGradient(cx, cx, (R - 8) * k, cx, cx, (R + 2.5) * k); gr.addColorStop(0, "rgba(160,110,84,0.8)"); gr.addColorStop(1, "rgba(160,110,84,0)"); x.fillStyle = gr; x.fillRect(0, 0, w, w); speckle(x, w, w, 5000, "70,40,26", 0.18);
      x.strokeStyle = "rgba(120,78,56,0.22)"; x.lineWidth = 2; for (var r = 3; r < R - 2; r += 1.1) { x.beginPath(); x.arc(cx, cx, r * k, 0, TAU); x.stroke(); } x.strokeStyle = "rgba(111,214,232,0.7)"; x.lineWidth = 0.3 * k; x.beginPath(); x.arc(cx, cx, (R - 3) * k, 0, TAU); x.stroke(); x.restore(); });
    var tm = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    var geo = drape(q[0], q[1], R + 3, 1.5, function (lx, lz) { return [(lx + R + 3) / (2 * R + 6), (R + 3 - lz) / (2 * R + 6)]; }, function (lx, lz) { return lx * lx + lz * lz < (R + 3) * (R + 3); }, function (x, z) { return surf(x, z) + 0.05; }); if (geo) { walkAdd(geo); var m = new THREE.Mesh(geo, tm); m.receiveShadow = true; g.add(m); }
    var rocks = [], posts = [], glows = []; var rockG = new THREE.IcosahedronGeometry(0.6, 0);
    for (var i = 0; i < 150; i++) { var a = i / 150 * TAU + rr() * 0.03, r = R + 1.6 + rr() * 2.2, x = q[0] + Math.cos(a) * r, z = q[1] + Math.sin(a) * r; if (planNearRoad(x, z, 0.8) || (OP.pos.obbyStart && Math.hypot(x - OP.pos.obbyStart[0], z - OP.pos.obbyStart[1]) < 7)) continue; var s = 0.8 + rr() * 1.3; rocks.push(mtx(x, getH(x, z) + 0.05 * s, z, rr() * TAU, rr() * 0.5, rr() * 0.5, s * 1.3, s * 0.6, s)); if (i % 9 === 0) { var px = q[0] + Math.cos(a) * (R + 0.8), pz = q[1] + Math.sin(a) * (R + 0.8), py = getH(px, pz); posts.push(mtx(px, py + 0.45, pz)); glows.push([px, py + 0.95, pz, 1.1]); } }
    if (rocks.length) g.add(instanced(rockG, Mm.basalt, rocks)); if (posts.length) { g.add(instanced(new THREE.CylinderGeometry(0.08, 0.1, 0.9, 8), Mm.white, posts)); var gp = glowPoints(glows, 0x3aa0ff, 1.2); g.add(gp); OP.lowgGlow = gp; }
    addGroup(g, true); gate(g, q[0], q[1], 640); OP.n.lowg = 1;
  }

  // ── the Launch Complex: the countdown clock, festoons round the vendor village, Gantry Row towers, blue-lit agave ──
  function clockDraw(x, w, h, st) { x.fillStyle = "#07090b"; x.fillRect(0, 0, w, h); x.strokeStyle = "#1b2228"; x.lineWidth = 6; x.strokeRect(6, 6, w - 12, h - 12); x.textAlign = "center"; x.textBaseline = "middle";
    x.fillStyle = st.hold ? "#ffb347" : "#6fd6e8"; x.font = "600 34px 'JetBrains Mono', 'Space Grotesk', monospace"; x.fillText(st.hold ? "LANDING LIGHT PAUSE" : "LAUNCH COMPLEX", w / 2, 50);
    x.fillStyle = st.hold ? "#ffb347" : "#ff3b2e"; x.font = "700 150px 'JetBrains Mono', 'Courier New', monospace"; x.fillText(st.big, w / 2, h / 2 + 12);
    x.fillStyle = "#f5f1e6"; x.font = "600 30px 'JetBrains Mono', 'Space Grotesk', monospace"; x.fillText(st.sub, w / 2, h - 44); }
  function clockState() { var t = dayT() * 24, hold = OP.llp > 0.5; if (hold) return { hold: true, big: "HOLD", sub: "HOLDING FOR ARRIVING AIRCRAFT", key: "hold" };
    var shows = [19, 20, 21, 22, 23], next = null; for (var i = 0; i < shows.length; i++) if (shows[i] > t + 1e-3) { next = shows[i]; break; } var left = next === null ? (24 - t) + 19 : next - t; if (next === null) next = 19;
    var hh = Math.floor(left), mm = Math.floor((left - hh) * 60); var big = "T- " + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0"); return { hold: false, big: big, sub: "NEXT SHOW " + String(next).padStart(2, "0") + ":00 SITE TIME", key: big }; }
  function buildLaunchComplex(Mm) {
    var q = OP.pos.night; if (!q) return; var g = new THREE.Group();
    var ck = OP.pos.clock; if (ck) { var y = getH(ck[0], ck[1]), yaw = ck[2]; var st = clockState(); var tex = canvasTex(1024, 384, function (x, w, h) { clockDraw(x, w, h, st); }); OP.clockTex = tex; OP.clockKey = st.key;
      var face = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.5 }); OP.clockMat = face; var cb = new Batch(); cb.add(boxUV(8.4, 3.4, 0.6, 1), mtx(ck[0], y + 4.7, ck[1], yaw)); for (var s = -1; s <= 1; s += 2) cb.add(boxUV(0.45, 3.2, 0.45, 1), mtx(ck[0] + Math.cos(yaw) * 3.6 * s, y + 1.55, ck[1] - Math.sin(yaw) * 3.6 * s, yaw)); var body = cb.mesh(Mm.dark); if (body) g.add(body);
      var fp = new THREE.Mesh(new THREE.PlaneGeometry(8.0, 3.0), face); fp.position.set(ck[0] + Math.sin(yaw) * 0.31, y + 4.7, ck[1] + Math.cos(yaw) * 0.31); fp.rotation.y = yaw; g.add(fp);
      for (var s2 = -1; s2 <= 1; s2 += 2) addSolid(ck[0] + Math.cos(yaw) * 3.6 * s2, ck[1] - Math.sin(yaw) * 3.6 * s2, yaw, 0.5, 0.5, y - 0.3, y + 3.1, "world"); OP.clockLight = light(0xff5a3a, 0.8, 16, ck[0] + Math.sin(yaw) * 2, y + 4.2, ck[1] + Math.cos(yaw) * 2, "clock"); }
    // festoon strings between the poles
    var poles = OP.pos.poles || [], pb = new Batch(), bulbs = [], wire = []; for (var i = 0; i < poles.length; i++) { var p = poles[i]; if (!p) continue; var py = getH(p[0], p[1]); pb.add(new THREE.CylinderGeometry(0.09, 0.12, 4.8, 8), mtx(p[0], py + 2.4, p[1])); var nx = poles[(i + 1) % poles.length]; if (!nx) continue; var ny = getH(nx[0], nx[1]); var L = Math.hypot(nx[0] - p[0], nx[1] - p[1]); var nb = Math.max(4, Math.round(L / 1.1)); var prev = null;
      for (var k = 0; k <= nb; k++) { var t = k / nb, x = p[0] + (nx[0] - p[0]) * t, z = p[1] + (nx[1] - p[1]) * t, yy = py + (ny - py) * t + 4.6 - Math.sin(t * Math.PI) * 0.9; if (prev) wire.push(prev[0], prev[1], prev[2], x, yy, z); prev = [x, yy, z]; if (k > 0 && k < nb) bulbs.push([x, yy - 0.12, z, 0.55]); } }
    var pm = pb.mesh(Mm.dark); if (pm) g.add(pm); if (wire.length) { var wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(wire, 3)); var wl = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2a2622 })); wl.userData.noInst = true; g.add(wl); }
    if (bulbs.length) { var bb = new Batch(); var bgeo = new THREE.SphereGeometry(0.07, 6, 4); bulbs.forEach(function (b) { bb.add(bgeo, mtx(b[0], b[1], b[2])); }); var bm = bb.mesh(Mm.warm, false); if (bm) g.add(bm); var fg = glowPoints(bulbs, 0xffc27a, 1.2); g.add(fg); OP.festoonGlow = fg; }
    // Gantry Row: lattice launch-gantry towers with a service arm over each canopy
    if (OP.pos.gantry.length) { var tw = new Batch(), H2 = 14, hw = 1.4; var leg = boxUV(0.2, H2, 0.2, 1); for (var a = 0; a < 4; a++) tw.add(leg, mtx((a % 2 ? 1 : -1) * hw, H2 / 2, (a < 2 ? 1 : -1) * hw)); for (var lv = 1.5; lv < H2; lv += 2.1) { tw.add(boxUV(2 * hw + 0.2, 0.12, 0.12, 1), mtx(0, lv, hw)); tw.add(boxUV(2 * hw + 0.2, 0.12, 0.12, 1), mtx(0, lv, -hw)); tw.add(boxUV(0.12, 0.12, 2 * hw + 0.2, 1), mtx(hw, lv, 0)); tw.add(boxUV(0.12, 0.12, 2 * hw + 0.2, 1), mtx(-hw, lv, 0));
        var br = Math.hypot(2 * hw, 2.1), ang = Math.atan2(2.1, 2 * hw); tw.add(boxUV(br, 0.08, 0.08, 1), mtx(0, lv + 1.05, hw, 0, 0, ang)); tw.add(boxUV(br, 0.08, 0.08, 1), mtx(0, lv + 1.05, -hw, 0, 0, -ang)); tw.add(boxUV(0.08, 0.08, br, 1), mtx(hw, lv + 1.05, 0, 0, ang)); tw.add(boxUV(0.08, 0.08, br, 1), mtx(-hw, lv + 1.05, 0, 0, -ang)); }
      tw.add(boxUV(0.5, 0.5, 8.5, 1), mtx(0, 10.2, 5.4)); tw.add(boxUV(0.1, 0.1, 6, 1), mtx(0, 11.6, 3.6, 0, 0.45)); tw.add(boxUV(3.2, 0.3, 3.2, 1), mtx(0, H2 + 0.15, 0));
      var towerGeo = tw.geo(); var ms = [], lamps = []; OP.pos.gantry.forEach(function (gt) { var y = getH(gt[0], gt[1]); ms.push(mtx(gt[0], y, gt[1], gt[2])); for (var k = 0; k < 5; k++) { var d = 2 + k * 1.8; lamps.push([gt[0] + Math.sin(gt[2]) * d, y + 9.8, gt[1] + Math.cos(gt[2]) * d, 0.7]); } lamps.push([gt[0], y + H2 + 0.5, gt[1], 1.2]); });
      var tmat = Mm.white.clone(); tmat.color = new THREE.Color(0xe7e2da); g.add(instanced(towerGeo, tmat, ms)); var lb = new Batch(); var lgeo = new THREE.BoxGeometry(0.22, 0.12, 0.22); lamps.forEach(function (l) { lb.add(lgeo, mtx(l[0], l[1] + 0.1, l[2])); }); var lmesh = lb.mesh(Mm.warm, false); if (lmesh) g.add(lmesh); var gg = glowPoints(lamps, 0xfff0d8, 1.2); g.add(gg); OP.gantryGlow = gg;
      OP.pos.gantry.forEach(function (gt) { var y = getH(gt[0], gt[1]); addSolid(gt[0], gt[1], gt[2], 3.2, 3.2, y - 0.3, y + H2, "world"); }); }
    // blue uplights under the vendor-village agave
    var ag = []; (OP.pos.vagave || []).forEach(function (q2) { ag.push([q2[0], getH(q2[0], q2[1]) + 0.35, q2[1], 2.4]); }); if (ag.length) { var ap = glowPoints(ag, 0x2d6bff, 1.2); g.add(ap); OP.vagaveGlow = ap; }
    addGroup(g, true); gate(g, q[0], q[1], 900); OP.n.launchComplex = (OP.pos.gantry || []).length;
  }

  // ── Compass Plaza: the compass rose geoglyph and the Compass Fountain ──
  function drawRose(x, S) { var k = S / 120, c = S / 2; x.clearRect(0, 0, S, S); x.save(); x.translate(c, c);
    var ring = function (r0, r1, col) { x.beginPath(); x.arc(0, 0, r1 * k, 0, TAU); x.arc(0, 0, r0 * k, 0, TAU, true); x.fillStyle = col; x.fill(); };
    ring(58.0, 59.6, "#b8904e"); ring(55.2, 55.7, "#8a6a38"); ring(9.3, 10.2, "#b8904e"); ring(29.6, 30.0, "#9a7a48");
    for (var i = 0; i < 72; i++) { var a = i / 72 * TAU, L = i % 18 === 0 ? 0 : i % 9 === 0 ? 3.6 : i % 3 === 0 ? 2.4 : 1.4; if (!L) continue; x.save(); x.rotate(a); x.fillStyle = "#9a7640"; x.fillRect(-0.2 * k, -58 * k, 0.4 * k, L * k); x.restore(); }
    var pts = []; for (var j = 0; j < 16; j++) { var main = j % 4 === 0, mid = j % 2 === 0 && !main; pts.push([j / 16 * TAU, main ? 47 : mid ? 35 : 24, main ? 6.2 : mid ? 4.6 : 3.2, main ? "#d8aa5e" : mid ? "#b8743f" : "#eadfc6", main ? "#7e5a2c" : mid ? "#7a4224" : "#b3a283"]); }
    pts.sort(function (a, b) { return a[1] - b[1]; });
    pts.forEach(function (p) { x.save(); x.rotate(p[0]); x.beginPath(); x.moveTo(0, -p[1] * k); x.lineTo(-p[2] * k, -11.5 * k); x.lineTo(0, -9.8 * k); x.closePath(); x.fillStyle = p[3]; x.fill(); x.beginPath(); x.moveTo(0, -p[1] * k); x.lineTo(p[2] * k, -11.5 * k); x.lineTo(0, -9.8 * k); x.closePath(); x.fillStyle = p[4]; x.fill(); x.restore(); });
    x.fillStyle = "#c69a52"; x.textAlign = "center"; x.textBaseline = "middle"; x.font = "700 " + Math.round(6.2 * k) + "px Fraunces, Georgia, serif"; [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(function (l) { x.save(); x.rotate(l[1] * DEG); x.fillText(l[0], 0, -51.5 * k); x.restore(); });
    x.restore(); }
  function buildCompass(Mm) {
    var c = OP.pos.compass; if (!c) return; var g = new THREE.Group();
    var tex = canvasTex(2048, 2048, function (x, S) { drawRose(x, S); }); tex.anisotropy = 8; var mask = document.createElement("canvas"); mask.width = mask.height = 240; drawRose(mask.getContext("2d"), 240); var md = mask.getContext("2d").getImageData(0, 0, 240, 240).data;
    var hit = function (lx, lz, cell) { var x0 = Math.floor((lx - cell / 2 + 60) * 2), x1 = Math.ceil((lx + cell / 2 + 60) * 2), z0 = Math.floor((lz - cell / 2 + 60) * 2), z1 = Math.ceil((lz + cell / 2 + 60) * 2); for (var zz = Math.max(0, z0); zz <= Math.min(239, z1); zz++) for (var xx = Math.max(0, x0); xx <= Math.min(239, x1); xx++) if (md[(zz * 240 + xx) * 4 + 3] > 8) return true; return false; };
    var rm = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.5, metalness: 0.45, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    var geo = drape(c[0], c[1], 60, 1.5, function (lx, lz) { return [(lx + 60) / 120, (60 - lz) / 120]; }, function (lx, lz, cell) { var x = c[0] + lx, z = c[1] + lz, w = walkAt(x, z), h = getH(x, z); if (w !== null && w - h > 0.4) return false; return hit(lx, lz, cell); }, function (x, z) { return surf(x, z) + 0.03; });
    if (geo) { var rose = new THREE.Mesh(geo, rm); rose.receiveShadow = true; g.add(rose); OP.n.roseTris = geo.index.count / 3; }
    // the Compass Fountain: a flush bronze disc with an eight-point star, eight floor jets on the points and one in the centre
    var ft = canvasTex(1024, 1024, function (x, w) { var k = w / 13.2, cx = w / 2; x.fillStyle = "#3b2c1c"; x.beginPath(); x.arc(cx, cx, 6.5 * k, 0, TAU); x.fill(); x.save(); x.translate(cx, cx); for (var i = 0; i < 8; i++) { x.save(); x.rotate(i / 8 * TAU); var L = i % 2 ? 3.4 : 5.2; x.beginPath(); x.moveTo(0, -L * k); x.lineTo(-0.7 * k, -0.9 * k); x.lineTo(0, 0); x.closePath(); x.fillStyle = "#c79a55"; x.fill(); x.beginPath(); x.moveTo(0, -L * k); x.lineTo(0.7 * k, -0.9 * k); x.lineTo(0, 0); x.closePath(); x.fillStyle = "#8a6433"; x.fill(); x.restore(); }
      x.restore(); x.strokeStyle = "#1a140e"; x.lineWidth = 0.45 * k; x.beginPath(); x.arc(cx, cx, 6.15 * k, 0, TAU); x.stroke(); x.strokeStyle = "#5c4a36"; x.lineWidth = 3; for (var j = 0; j < 180; j++) { var b = j / 180 * TAU; x.beginPath(); x.moveTo(cx + Math.cos(b) * 5.95 * k, cx + Math.sin(b) * 5.95 * k); x.lineTo(cx + Math.cos(b) * 6.35 * k, cx + Math.sin(b) * 6.35 * k); x.stroke(); }
      x.fillStyle = "#15110c"; for (var n = 0; n < 8; n++) { var a = n / 8 * TAU; var r = n % 2 ? 3.2 : 4.9; x.beginPath(); x.arc(cx + Math.sin(a) * r * k, cx - Math.cos(a) * r * k, 0.2 * k, 0, TAU); x.fill(); } x.beginPath(); x.arc(cx, cx, 0.3 * k, 0, TAU); x.fill(); });
    var fm = new THREE.MeshStandardMaterial({ map: ft, alphaTest: 0.5, roughness: 0.32, metalness: 0.85, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    var fg = drape(c[0], c[1], 6.6, 0.55, function (lx, lz) { return [(lx + 6.6) / 13.2, (6.6 - lz) / 13.2]; }, function (lx, lz) { return lx * lx + lz * lz < 6.7 * 6.7; }, function (x, z) { return surf(x, z) + 0.045; }); if (fg) { var fmh = new THREE.Mesh(fg, fm); fmh.receiveShadow = true; g.add(fmh); }
    var jy = surf(c[0], c[1]) + 0.05, jets = [], warm = new THREE.Color(0xffd9a0); for (var n = 0; n < 8; n++) { var a = n / 8 * TAU, r = n % 2 ? 3.2 : 4.9; jets.push({ p: [c[0] + Math.sin(a) * r, jy, c[1] - Math.cos(a) * r], h: n % 2 ? 1.7 : 2.6, spread: 0.05, n: 150, col: warm }); } jets.push({ p: [c[0], jy, c[1]], h: 3.4, spread: 0.06, n: 260, col: warm });
    var jp = jetPoints(jets); g.add(jp); gate(jp, c[0], c[1], 300);
    var ng = []; jets.forEach(function (j) { ng.push([j.p[0], j.p[1] + 0.05, j.p[2], 0.8]); }); var np = glowPoints(ng, 0xffd9a0, 1); g.add(np); OP.compassGlow = np;
    addGroup(g, true); light(0xffd9a0, 1.1, 22, c[0], jy + 1.5, c[1], "night"); OP.n.compass = 1;
  }
  // ── the Outpost Beacon: a 5 m meteorite split open round a slow cyan core ──
  function buildBeacon(Mm) {
    var b = OP.pos.beacon; if (!b) return; var y = getH(b[0], b[1]); var g = new THREE.Group(); g.position.set(b[0], y, b[1]); g.rotation.y = 0.6;
    var core = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 3.2, 6, 16), new THREE.MeshStandardMaterial({ color: 0x0c2a30, emissive: 0x3fe6ff, emissiveIntensity: 1.2, roughness: 0.3 })); core.position.y = 2.35; g.add(core); OP.beaconCore = core.material;
    var shards = new Batch(); for (var k = 0; k < 4; k++) { var ig = new THREE.IcosahedronGeometry(1, 2); var pa = ig.attributes.position; for (var i = 0; i < pa.count; i++) { var vx = pa.getX(i), vy = pa.getY(i), vz = pa.getZ(i); var n = 0.82 + 0.3 * hsh(Math.round(vx * 5) * 13.1 + Math.round(vy * 5) * 7.7 + Math.round(vz * 5) * 3.3 + k * 17); pa.setXYZ(i, vx * n, vy * n, vz * n); } ig.computeVertexNormals();
      var a = k / 4 * TAU + 0.35; shards.add(ig, mtx(Math.cos(a) * 0.62, 2.3 + (k % 2) * 0.25, Math.sin(a) * 0.62, -a, 0.08 * (k % 2 ? 1 : -1), 0, 0.78, 2.45, 0.72)); }
    var sm = shards.mesh(Mm.basalt); if (sm) g.add(sm); var plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.3, 0.35, 7), Mm.concrete); plinth.position.y = 0.1; plinth.receiveShadow = true; g.add(plinth);
    var gl = glowPoints([[0, 2.3, 0, 3.4], [0, 3.6, 0, 2.4], [0, 1.2, 0, 2.4]], 0x46e8ff, 1.5); g.add(gl); OP.beaconGlow = gl;
    addGroup(g, true); addSolid(b[0], b[1], 0.6, 2.4, 2.4, y - 0.3, y + 4.8, "world"); OP.beaconLight = light(0x46e8ff, 1.4, 18, b[0], y + 2.4, b[1], "beacon"); OP.n.beacon = 1;
  }

  // ── Sculpture Avenue: the Seven Gates, the Corten Water Table, night uplights ──
  function buildGates(Mm) {
    var gates = OP.pos.gates; if (!gates || !gates.length) return; var body = new Batch(), wash = new Batch(), ups = new Batch(), g = new THREE.Group();
    gates.forEach(function (gt) { var yaw = yawOf(gt.ux, gt.uz), bases = gt.cols.map(function (q) { return surf(q[0], q[1]); }), top = Math.max(bases[0], bases[1]) + gt.H; var mx = (gt.cols[0][0] + gt.cols[1][0]) / 2, mz = (gt.cols[0][1] + gt.cols[1][1]) / 2;
      gt.cols.forEach(function (q, i) { var h = top - bases[i] + 0.25; body.add(boxUV(1.1, h, 1.1, 2), mtx(q[0], bases[i] - 0.25 + h / 2, q[1], yaw)); addSolid(q[0], q[1], yaw, 1.1, 1.1, bases[i] - 0.3, top, "world");
        for (var f = -1; f <= 1; f += 2) { var fx = gt.ux * f, fz = gt.uz * f; var wp = new THREE.PlaneGeometry(0.95, 7.5); wp.translate(0, 3.75, 0); wash.add(wp, mtx(q[0] + fx * 0.57, bases[i], q[1] + fz * 0.57, yawOf(fx, fz))); ups.add(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 10), mtx(q[0] + fx * 0.9, bases[i] + 0.03, q[1] + fz * 0.9)); } });
      body.add(boxUV(gt.W + 1.1, 1.3, 1.1, 2), mtx(mx, top - 0.65, mz, yaw)); });
    var bm = body.mesh(Mm.corten); if (bm) g.add(bm); var wm = wash.mesh(Mm.wash, false); if (wm) { wm.renderOrder = 4; g.add(wm); } var um = ups.mesh(Mm.up, false); if (um) g.add(um);
    // the Corten Water Table in the median: a thin sheet of water over a corten slab
    var t = OP.pos.table; if (t) { var y = surf(t.x, t.z), yaw = yawOf(t.ux, t.uz); var slab = new THREE.Mesh(boxUV(3.0, 0.75, 8.0, 2), Mm.corten); slab.position.set(t.x, y + 0.3, t.z); slab.rotation.y = yaw; slab.castShadow = slab.receiveShadow = true; g.add(slab);
      try { var FM = fountainMats(); var rings = [new THREE.Vector4(1.4, 0, 0, 0), new THREE.Vector4(), new THREE.Vector4()]; var wmat = FM.water(rings); var wsh = new THREE.Mesh(new THREE.PlaneGeometry(2.86, 7.86), wmat); wsh.rotation.set(-Math.PI / 2, 0, 0); var wg = new THREE.Group(); wg.position.set(t.x, y + 0.69, t.z); wg.rotation.y = yaw; wg.add(wsh); g.add(wg);
        for (var s = -1; s <= 1; s += 2) { var sg = new THREE.PlaneGeometry(7.9, 0.7); var uv = sg.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i)); var sh = new THREE.Mesh(sg, FM.sheet); sh.position.set(s * 1.52, -0.36, 0); sh.rotation.y = Math.PI / 2; sh.renderOrder = 3; wg.add(sh); } } catch (e) { note("waterTable", e); }
      addSolid(t.x, t.z, yaw, 3.0, 8.0, y - 0.3, y + 0.72, "world"); }
    addGroup(g, true); var mid = gates[3] || gates[0]; gate(wm || g, mid.x, mid.z, 900); OP.n.gates = gates.length;
  }

  // ── Field of Light ──
  function buildFieldOfLight(Mm) {
    var f = OP.pos.fol; if (!f) return; var stems = [], tips = []; var step = 1.2;
    for (var x = -f[2]; x <= f[2]; x += step) for (var z = -f[2]; z <= f[2]; z += step) { var jx = x + (rr() - 0.5) * step * 0.8, jz = z + (rr() - 0.5) * step * 0.8; var rd = Math.hypot(jx, jz); if (rd > f[2] * (0.93 + 0.07 * hsh(Math.round(jx) * 3.1 + Math.round(jz) * 1.7))) continue; var wx = f[0] + jx, wz = f[1] + jz; if (planNearRoad(wx, wz, 0.5) || planNearCollider(wx, wz, 0.4)) continue; var y = getH(wx, wz), h = 0.55 + rr() * 0.4; stems.push(mtx(wx, y, wz, 0, 0, 0, 1, h, 1)); tips.push([wx, y + h + 0.05, wz]); }
    var sg = new THREE.CylinderGeometry(0.01, 0.016, 1, 3, 1, true); sg.translate(0, 0.5, 0); var g = new THREE.Group(); var sm = instanced(sg, Mm.stem, stems, false); g.add(sm); gate(sm, f[0], f[1], 360);
    var bm = twinkleMat(0.17, 0.8); bm.uniforms.uSize.value = 0.17; OP.folMat = bm; var bp = seededPoints(tips, bm); g.add(bp); gate(bp, f[0], f[1], 1400);
    addGroup(g, true); OP.n.fieldOfLight = tips.length;
  }
  // ── the Sun Tunnels: four concrete tubes aligned to the solstice sunrises and sunsets ──
  function buildSunTunnels(Mm) {
    var tubes = OP.pos.tubes; if (!tubes) return;
    // one tube along local z: outer wall, inner wall (turned inside out) and the two end rings, so the corners stay crisp
    var tube = new Batch(); var outer = new THREE.CylinderGeometry(1.4, 1.4, 5.5, 40, 1, true); scaleUV(outer, 4, 2); outer.rotateX(Math.PI / 2); tube.add(outer); var inner = flipGeo(new THREE.CylinderGeometry(1.2, 1.2, 5.5, 40, 1, true)); scaleUV(inner, 4, 2); inner.rotateX(Math.PI / 2); tube.add(inner);
    var eA = new THREE.RingGeometry(1.2, 1.4, 40, 1); eA.translate(0, 0, 2.75); tube.add(eA); var eB = new THREE.RingGeometry(1.2, 1.4, 40, 1); eB.rotateY(Math.PI); eB.translate(0, 0, -2.75); tube.add(eB); var tg = tube.geo(); var b = new Batch(), holes = new Batch(), lk = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
    tubes.forEach(function (t, ti) { var dx = Math.sin(t[2] * DEG), dz = -Math.cos(t[2] * DEG), yaw = yawOf(dx, dz), y = getH(t[0], t[1]) + 1.18; b.add(tg, mtx(t[0], y, t[1], yaw)); var rxx = Math.cos(yaw), rzz = -Math.sin(yaw);
      // the constellation holes in the upper half (dark discs on the outer wall)
      for (var k = 0; k < 11; k++) { var ang = -0.9 + hsh(ti * 31 + k) * 1.8, zz = -2.3 + hsh(ti * 17 + k * 3) * 4.6; var nx = rxx * Math.sin(ang), ny = Math.cos(ang), nz = rzz * Math.sin(ang); var px = t[0] + nx * 1.407 + dx * zz, py = y + ny * 1.407, pz = t[1] + nz * 1.407 + dz * zz; var eye = new THREE.Vector3(px, py, pz); lk.lookAt(eye, new THREE.Vector3(px - nx, py - ny, pz - nz), Math.abs(ny) > 0.95 ? new THREE.Vector3(dx, 0, dz) : up); lk.setPosition(eye); holes.add(new THREE.CircleGeometry(0.05 + 0.04 * hsh(k + ti), 8), lk); }
      var rx = Math.cos(yaw), rz = -Math.sin(yaw); for (var sd = -1; sd <= 1; sd += 2) addSolid(t[0] + rx * 1.3 * sd, t[1] + rz * 1.3 * sd, yaw, 0.26, 5.5, y - 1.4, y + 1.45, "world"); addSolid(t[0], t[1], yaw, 2.8, 5.5, y + 1.2, y + 1.42, "world"); });
    var g = new THREE.Group(); var tm = b.mesh(Mm.concrete); if (tm) g.add(tm); var hm = holes.mesh(new THREE.MeshBasicMaterial({ color: 0x1b1712, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), false); if (hm) g.add(hm);
    addGroup(g); OP.n.sunTunnels = tubes.length;
  }
  // ── the Stone Spiral: basalt stones lining a spiral path in the Ridge Arroyo ──
  function buildSpiral(Mm) {
    var pts = OP.pos.spiralPts; if (!pts) return; var list = [], rg = new THREE.IcosahedronGeometry(0.5, 0);
    for (var i = 0; i < pts.length - 1; i++) { var a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; for (var sd = -1; sd <= 1; sd += 2) { var off = 0.82 + rr() * 0.18, x = a[0] + nx * off * sd, z = a[1] + nz * off * sd, s = 0.42 + rr() * 0.34; list.push(mtx(x, getH(x, z) + 0.05, z, rr() * TAU, rr() * 0.6, rr() * 0.6, s * 1.25, s * 0.55, s)); } }
    var c = OP.pos.spiral; for (var k = 0; k < 7; k++) { var aa = k / 7 * TAU, x2 = c[0] + Math.cos(aa) * 0.5, z2 = c[1] + Math.sin(aa) * 0.5, s2 = 0.5 + rr() * 0.3; list.push(mtx(x2, getH(x2, z2) + 0.1, z2, rr() * TAU, 0, 0, s2, s2 * 0.8, s2)); }
    var g = new THREE.Group(); g.add(instanced(rg, Mm.basalt, list)); addGroup(g, true); gate(g, c[0], c[1], 600); OP.n.spiral = list.length;
  }
  // ── the Ring geoglyph: a 90 m Genesis Ring laid flat in coloured gravel at the North Yard ──
  function buildGeoglyph(Mm) {
    var c = OP.pos.geo; if (!c) return; var R0 = 33.5, R1 = 46.5, seg = 288, radii = [33.5, 35.0, 37.5, 40, 42.5, 45.0, 46.5];
    var tex = canvasTex(256, 512, function (x, w, h) { var v = function (r) { return h - (r - R0) / (R1 - R0) * h; }; x.fillStyle = "#8a4a2e"; x.fillRect(0, 0, w, h); speckle(x, w, h, 2500, "50,24,14", 0.35);
      x.fillStyle = "#3fcfe0"; x.fillRect(0, v(35.8), w, v(35.0) - v(35.8)); speckle(x, w, h, 0, "0,0,0", 0);
      x.fillStyle = "#dcd6ca"; x.fillRect(0, v(44.9), w, v(35.8) - v(44.9)); speckle(x, w, h, 2600, "120,112,100", 0.3); x.fillStyle = "#6b6660"; x.fillRect(0, v(44.9), 5, v(35.8) - v(44.9)); x.fillStyle = "rgba(60,56,52,0.6)"; x.fillRect(0, v(40.4), w, 3); }, true);
    var mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    var geo = drapeAnnulus(c[0], c[1], R0, R1, seg, radii.length - 1, function (x, z) { return getH(x, z) + 0.06; }, function (a, r) { return [a * 48, r]; });
    var m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.userData.noCull = true; addMesh(m);
    // the red obstruction light, as a disc of red gravel on the band nearest the runway
    var ax = runwayMid[0] - c[0], az = runwayMid[1] - c[1], aL = Math.hypot(ax, az) || 1, rx = c[0] + ax / aL * 40.35, rz = c[1] + az / aL * 40.35; var dg = drape(rx, rz, 2.2, 0.5, function (lx, lz) { return [0, 0]; }, function (lx, lz) { return lx * lx + lz * lz < 2.1 * 2.1; }, function (x, z) { return getH(x, z) + 0.08; }); if (dg) { var dm = new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ color: 0xb8261a, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); addMesh(dm); }
    OP.n.geoglyph = 1;
  }
  // ── the Grand Cascade at Fountain Court: stepped stone runnels over a flush grated drain, no pool ──
  function buildCascade(Mm) {
    var cs = OP.pos.cascade; if (!cs) return; var ux = cs.ux, uz = cs.uz, rx = -uz, rz = ux, yaw = yawOf(ux, uz); var bx = cs.x + ux * cs.s0, bz = cs.z + uz * cs.s0, base = surf(bx, bz); var steps = 7, run = 2, rise = 0.28, W = 7;
    var stone = new Batch(), wet = new Batch(), water = new Batch(), sheets = [], g = new THREE.Group(); var P = function (s, l) { return [cs.x + ux * s + rx * l, cs.z + uz * s + rz * l]; };
    var lanes = [-2.2, 0, 2.2];
    // boxes and planes are laid out in the cascade's frame: local x across the runnels, local z up the steps
    for (var i = 0; i < steps; i++) { var s0 = cs.s0 + 0.9 + i * run, top = base + rise * (i + 1), p = P(s0 + run / 2, 0); var hgt = top - (base - 0.6); stone.add(boxUV(W, hgt, run, 1), mtx(p[0], base - 0.6 + hgt / 2, p[1], yaw));
      for (var sd = -1; sd <= 1; sd += 2) { var pw = P(s0 + run / 2, (W / 2 + 0.25) * sd); stone.add(boxUV(0.5, hgt + 0.35, run, 1), mtx(pw[0], base - 0.6 + (hgt + 0.35) / 2, pw[1], yaw)); addSolid(pw[0], pw[1], yaw, 0.5, run, base - 0.6, top + 0.35, "world"); }
      addSolid(p[0], p[1], yaw, W, run, base - 0.6, top, "world");
      lanes.forEach(function (l) { var q = P(s0 + run / 2, l); wet.add(new THREE.PlaneGeometry(1.1, run), mtx(q[0], top + 0.008, q[1], yaw, -Math.PI / 2)); water.add(new THREE.PlaneGeometry(1.02, run - 0.05), mtx(q[0], top + 0.03, q[1], yaw, -Math.PI / 2)); var f = P(s0, l); sheets.push([f[0], f[1], top, i === 0 ? base + 0.02 : top - rise]); }); }
    // the headwall with three spouts, and the flush grated drain at the foot
    var hwP = P(cs.s0 + 0.9 + steps * run + 0.6, 0), topY = base + rise * steps; stone.add(boxUV(W + 1, topY - base + 1.5, 1.2, 1), mtx(hwP[0], base - 0.6 + (topY - base + 2.1) / 2, hwP[1], yaw)); addSolid(hwP[0], hwP[1], yaw, W + 1, 1.2, base - 0.6, topY + 0.9, "world");
    lanes.forEach(function (l) { var sp = P(cs.s0 + 0.9 + steps * run - 0.05, l); stone.add(boxUV(0.4, 0.18, 0.5, 1), mtx(sp[0], topY + 0.55, sp[1], yaw)); sheets.push([sp[0], sp[1], topY + 0.5, topY + 0.03]); });
    var sm = stone.mesh(Mm.stone); if (sm) g.add(sm); var wm = wet.mesh(Mm.wet, false); if (wm) g.add(wm);
    var dgP = P(cs.s0 + 0.45, 0); var grate = canvasTex(256, 64, function (x, w, h) { x.fillStyle = "#1d2124"; x.fillRect(0, 0, w, h); x.fillStyle = "#4a5055"; for (var i = 0; i < w; i += 7) x.fillRect(i, 0, 3, h); x.fillStyle = "#6a7074"; x.fillRect(0, 0, w, 3); x.fillRect(0, h - 3, w, 3); });
    var dgm = new THREE.Mesh(new THREE.PlaneGeometry(W + 1, 0.9), new THREE.MeshStandardMaterial({ map: grate, roughness: 0.6, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); dgm.position.set(dgP[0], surf(dgP[0], dgP[1]) + 0.03, dgP[1]); dgm.rotation.order = "YXZ"; dgm.rotation.set(-Math.PI / 2, yaw, 0); g.add(dgm);
    try { var FM = fountainMats(); var rings = [new THREE.Vector4(1.0, 0, 0, 0), new THREE.Vector4(), new THREE.Vector4()]; var wmesh = water.mesh(FM.water(rings), false); if (wmesh) { wmesh.renderOrder = 2; g.add(wmesh); }
      var sb = new Batch(); sheets.forEach(function (s) { var h = Math.max(0.1, s[2] - s[3]); var pg = new THREE.PlaneGeometry(1.0, h); var uv = pg.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i)); sb.add(pg, mtx(s[0] - ux * 0.02, s[3] + h / 2, s[1] - uz * 0.02, yaw + Math.PI)); }); var shm = sb.mesh(FM.sheet, false); if (shm) { shm.renderOrder = 3; shm.material.side = THREE.DoubleSide; g.add(shm); } } catch (e) { note("cascadeWater", e); }
    var sp2 = []; sheets.forEach(function (s) { sp2.push({ p: [s[0] - ux * 0.25, s[3] + 0.02, s[1] - uz * 0.25], h: 0.35, spread: 0.9, n: 40, col: new THREE.Color(0xdff6ff) }); }); var jp = jetPoints(sp2); g.add(jp); gate(jp, bx, bz, 280);
    addGroup(g, true); gate(g, bx, bz, 900); light(0xffe2b8, 0.9, 20, bx + ux * 6, base + 2.6, bz + uz * 6, "night"); OP.n.cascade = steps;
  }
  // ── the Orbit Walk planet fountains: floor jets round a planet globe, lit in the planet's colours ──
  var PLANET = { mercury: [0.55, 0x9c9088, [0x8a7f78, 0xb3a89e]], venus: [0.8, 0xe6c680, [0xe8cf8a, 0xd9b36a]], earth: [0.85, 0x3f7fd8, [0x2f66c8, 0x3f9a4a, 0xf2f2f0]], mars: [0.62, 0xc9502c, [0xc1502e, 0x9a3a22]],
    jupiter: [1.35, 0xd99a5c, [0xd8b48a, 0xb4784a, 0xefe0c6, 0xa86a40]], saturn: [1.15, 0xe3c889, [0xe8d49c, 0xcfb37a, 0xf1e6c8]], uranus: [0.95, 0x9fe6ea, [0x9fe3e8, 0xb8f0f2]], neptune: [0.95, 0x3b62e0, [0x3b5bd8, 0x2a44b0, 0x6f8ff0]] };
  function planetAtlas() { if (OP.planetTex) return OP.planetTex; var ids = Object.keys(PLANET); OP.planetTex = canvasTex(1024, 1024, function (x) { ids.forEach(function (id, n) { var cx = (n % 2) * 512, cy = Math.floor(n / 2) * 256, cols = PLANET[id][2];
      for (var r = 0; r < 256; r++) { var band = id === "jupiter" || id === "saturn" ? cols[Math.floor((Math.sin(r * 0.11) + Math.sin(r * 0.037) * 0.8 + 2) / 4 * cols.length) % cols.length] : cols[0]; x.fillStyle = "#" + new THREE.Color(band).getHexString(); x.fillRect(cx, cy + r, 512, 1); }
      if (id === "earth") { for (var k = 0; k < 26; k++) { x.fillStyle = "#3f8a44"; x.beginPath(); x.ellipse(cx + hsh(k) * 512, cy + 40 + hsh(k + 9) * 170, 20 + hsh(k + 3) * 60, 12 + hsh(k + 5) * 30, 0, 0, TAU); x.fill(); } x.fillStyle = "rgba(245,245,245,0.8)"; x.fillRect(cx, cy, 512, 16); x.fillRect(cx, cy + 240, 512, 16); }
      if (id === "mars" || id === "mercury") { for (var q = 0; q < 60; q++) { x.fillStyle = "rgba(40,20,10," + (0.1 + hsh(q + n) * 0.2).toFixed(2) + ")"; x.beginPath(); x.arc(cx + hsh(q * 3 + n) * 512, cy + hsh(q * 7 + n) * 256, 3 + hsh(q) * 10, 0, TAU); x.fill(); } }
      if (id === "jupiter") { x.fillStyle = "#b8583a"; x.beginPath(); x.ellipse(cx + 330, cy + 160, 34, 18, 0, 0, TAU); x.fill(); } }); }); return OP.planetTex; }
  function buildPlanets(Mm) {
    var ps = OP.pos.planets; if (!ps || !ps.length) return; var ids = Object.keys(PLANET), atlas = planetAtlas(); var globe = new Batch(), ped = new Batch(), pads = new Batch(), jets = [], glows = [], g = new THREE.Group();
    var padTex = canvasTex(512, 512, function (x, w) { var k = w / 6.8, cx = w / 2; x.fillStyle = "#14171a"; x.beginPath(); x.arc(cx, cx, 3.35 * k, 0, TAU); x.fill(); x.strokeStyle = "#ffffff"; x.lineWidth = 0.16 * k; x.beginPath(); x.arc(cx, cx, 2.75 * k, 0, TAU); x.stroke(); x.lineWidth = 0.05 * k; x.beginPath(); x.arc(cx, cx, 3.15 * k, 0, TAU); x.stroke(); x.fillStyle = "#ffffff"; for (var i = 0; i < 8; i++) { var a = i / 8 * TAU; x.beginPath(); x.arc(cx + Math.cos(a) * 2.2 * k, cx + Math.sin(a) * 2.2 * k, 0.12 * k, 0, TAU); x.fill(); } for (var s = 0; s < 70; s++) { x.fillStyle = "rgba(255,255,255," + (0.2 + Math.random() * 0.5).toFixed(2) + ")"; var a2 = Math.random() * TAU, r2 = Math.random() * 2.5 * k; x.fillRect(cx + Math.cos(a2) * r2, cx + Math.sin(a2) * r2, 2, 2); } });
    var padMat = new THREE.MeshStandardMaterial({ map: padTex, vertexColors: true, alphaTest: 0.5, roughness: 0.25, metalness: 0.4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    ps.forEach(function (p) { var P0 = PLANET[p.id], R = P0[0], col = new THREE.Color(P0[1]), n = ids.indexOf(p.id), y = surf(p.x, p.z);
      var pg = drape(p.x, p.z, 3.4, 0.5, function (lx, lz) { return [(lx + 3.4) / 6.8, (3.4 - lz) / 6.8]; }, function (lx, lz) { return lx * lx + lz * lz < 3.45 * 3.45; }, function (x, z) { return surf(x, z) + 0.04; }); if (pg) pads.add(pg, null, col);
      var sg = new THREE.SphereGeometry(R, 32, 20); var uv = sg.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, ((n % 2) + uv.getX(i)) / 2, 1 - (Math.floor(n / 2) + 1 - uv.getY(i)) / 4); var gy = y + 1.25 + R; globe.add(sg, mtx(p.x, gy, p.z, hsh(n) * TAU, 0.25));
      ped.add(new THREE.CylinderGeometry(0.16, 0.3, 1.25 + R * 0.3, 12), mtx(p.x, y + (1.25 + R * 0.3) / 2, p.z)); ped.add(new THREE.CylinderGeometry(0.55, 0.62, 0.12, 20), mtx(p.x, y + 0.06, p.z));
      if (p.id === "saturn") { var rg2 = new THREE.RingGeometry(R * 1.35, R * 2.2, 64, 1); var rm = new THREE.Mesh(rg2, new THREE.MeshStandardMaterial({ color: 0xe0cc98, roughness: 0.6, transparent: true, opacity: 0.85, side: THREE.DoubleSide })); rm.position.set(p.x, gy, p.z); rm.rotation.set(-Math.PI / 2 + 0.45, 0.3, 0); g.add(rm); }
      for (var k = 0; k < 8; k++) { var a = k / 8 * TAU; jets.push({ p: [p.x + Math.cos(a) * 2.2, y + 0.05, p.z + Math.sin(a) * 2.2], h: p.major ? 2.1 : 1.5, spread: 0.06, n: 70, col: col }); glows.push([p.x + Math.cos(a) * 2.2, y + 0.1, p.z + Math.sin(a) * 2.2, 0.9]); }
      light(P0[1], 0.9, 11, p.x, y + 1.0, p.z, "orbit"); });
    var pm = pads.mesh(padMat, false); if (pm) g.add(pm); var gmat = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.55, metalness: 0.1 }); OP.planetMat = gmat; var gm = globe.mesh(gmat); if (gm) g.add(gm); var pdm = ped.mesh(Mm.steel); if (pdm) g.add(pdm);
    var jp = jetPoints(jets); g.add(jp); gate(jp, OP.pos.ring[0], OP.pos.ring[1], 380); var gl = glowPoints(glows, 0xffffff, 1); g.add(gl); OP.orbitGlow = gl;
    addGroup(g, true); gate(g, OP.pos.ring[0], OP.pos.ring[1], 1100); OP.n.planets = ps.length;
  }
  // ── the brass line along the Horizon Line: inlay and studs with a brass star every 25 m, and the secondary line on the Gallery Walk ──
  function buildBrass(Mm) {
    var b = new Batch(), n = { strip: 0, studs: 0, stars: 0 }; var founts = []; try { PLAN_IDX.fount.forEach(function (f) { founts.push([f.x, f.z, (f._r || 0) + 0.8]); }); } catch (e) {}
    if (OP.pos.launch) founts.push([OP.pos.launch[0], OP.pos.launch[1], 6.6]); if (OP.pos.compass) founts.push([OP.pos.compass[0], OP.pos.compass[1], 7.2]); if (OP.pos.ring) founts.push([OP.pos.ring[0], OP.pos.ring[1], 8.2]); (OP.pos.planets || []).forEach(function (p) { founts.push([p.x, p.z, 3.6]); }); if (OP.pos.table) founts.push([OP.pos.table.x, OP.pos.table.z, 4.4]);
    var lamps = PLACE.lamp || []; var blocked = function (x, z, r) { for (var i = 0; i < founts.length; i++) { var f = founts[i]; if (Math.abs(f[0] - x) < f[2] && Math.hypot(f[0] - x, f[1] - z) < f[2]) return true; } for (var j = 0; j < lamps.length; j++) { var e = lamps[j]; if (Math.abs(e[0] - x) < r && Math.abs(e[2] - z) < r && Math.hypot(e[0] - x, e[2] - z) < r) return true; } return false; };
    var star = new THREE.Shape(); for (var i = 0; i < 10; i++) { var a = i / 10 * TAU - Math.PI / 2, r = i % 2 ? 0.12 : 0.3; if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r); else star.lineTo(Math.cos(a) * r, Math.sin(a) * r); } star.closePath(); var starG = new THREE.ShapeGeometry(star); starG.rotateX(-Math.PI / 2);
    var studG = new THREE.CircleGeometry(0.05, 6); studG.rotateX(-Math.PI / 2);
    var strip = function (pts, off, w, d0, d1) { var L = polyLen(pts), cur = null; var flush = function () { if (cur && cur.length >= 2) { var pos = []; for (var k = 0; k < cur.length - 1; k++) { var a2 = cur[k], c2 = cur[k + 1]; pos.push(a2[0], a2[1], a2[2], c2[0], c2[1], c2[2], a2[3], a2[4], a2[5], a2[3], a2[4], a2[5], c2[0], c2[1], c2[2], c2[3], c2[4], c2[5]); } var gg = new THREE.BufferGeometry(); gg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); gg.computeVertexNormals(); b.add(gg); n.strip += cur.length; } cur = null; };
      for (var d = d0; d <= Math.min(L, d1); d += 0.8) { var s = at(pts, d), x = s.x + s.rx * off, z = s.z + s.rz * off; if (blocked(x, z, 0)) { flush(); continue; } var y = surf(x, z) + 0.012; if (!cur) cur = []; cur.push([x + s.rx * w / 2, y, z + s.rz * w / 2, x - s.rx * w / 2, y, z - s.rz * w / 2]); } flush(); };
    var stars = function (pts, off, d0, d1, sc) { var L = polyLen(pts); for (var d = d0; d <= Math.min(L, d1); d += 25) { var s = at(pts, d), x = s.x + s.rx * off, z = s.z + s.rz * off; if (blocked(x, z, 0.5)) continue; b.add(starG, mtx(x, surf(x, z) + 0.016, z, yawOf(s.ux, s.uz) + Math.PI, 0, 0, sc || 1)); n.stars++; } };
    var studs = function (pts, off, step, d0, d1) { var L = polyLen(pts); for (var d = d0; d <= Math.min(L, d1); d += step) { var s = at(pts, d), x = s.x + s.rx * off, z = s.z + s.rz * off; if (blocked(x, z, 0.55)) continue; b.add(studG, mtx(x, surf(x, z) + 0.012, z)); n.studs++; } };
    var p1 = prom("hl1_club_walk"); if (p1) { studs(p1.pts, 2.6, 1.0, 10.5, 1e9); stars(p1.pts, 2.6, 25, 1e9); }
    var p3 = prom("hl3_main_street"); if (p3) { var p3pts = window.PLAN_MAIN_PTS || p3.pts; for (var sd = -1; sd <= 1; sd += 2) { studs(p3pts, 8.25 * sd, 1.25, 4, 1e9); stars(p3pts, 9.4 * sd, 12.5, 1e9); } }
    var p4 = prom("hl4_sculpture_ave"); if (p4) { strip(p4.pts, 2.7, 0.1, 8, 1e9); stars(p4.pts, 2.7, 12.5, 1e9); }
    var p5 = prom("hl5_launch_walk"); if (p5) { var L5 = polyLen(p5.pts); strip(p5.pts, 0, 0.12, 0, L5 - 8.3); for (var k = 10; k >= 2; k--) { var d = L5 - (k - 1) * 25, s = at(p5.pts, d); b.add(starG, mtx(s.x, surf(s.x, s.z) + 0.016, s.z, yawOf(s.ux, s.uz) + Math.PI, 0, 0, 1.25)); n.stars++; } }
    var pg = prom("gallery_walk"); if (pg) { strip(pg.pts, 0, 0.06, 7.5, 1e9); stars(pg.pts, 0, 25, 1e9, 0.75); }
    var m = b.mesh(Mm.brass, false); if (m) { m.frustumCulled = true; m.userData.noCull = true; addMesh(m); OP.brassMesh = m; }
    // the brass medallion at the start of the line in Arrivals Court
    if (p1) { var s1 = at(p1.pts, 9), mx = s1.x + s1.rx * 3.4, mz = s1.z + s1.rz * 3.4; var mt = canvasTex(512, 512, function (x, w) { var c = w / 2; x.fillStyle = "#b8914c"; x.beginPath(); x.arc(c, c, c - 2, 0, TAU); x.fill(); x.strokeStyle = "#6e5328"; x.lineWidth = 10; x.beginPath(); x.arc(c, c, c - 14, 0, TAU); x.stroke(); x.lineWidth = 16; x.beginPath(); x.arc(c, c, 92, 0, TAU); x.stroke(); x.fillStyle = "#5a4320"; x.textAlign = "center"; x.textBaseline = "middle"; x.font = "700 44px Anton, Impact, sans-serif"; x.fillText("THE HORIZON LINE", c, 110); x.font = "600 30px 'Space Grotesk', sans-serif"; x.fillText("FOLLOW THE BRASS LINE", c, 404); x.fillText("TO THE GENESIS RING", c, 440); });
      var mg = drape(mx, mz, 0.9, 0.2, medallionUV(0.86, s1.ux, s1.uz), function (lx, lz) { return lx * lx + lz * lz < 0.86 * 0.86; }, function (x, z) { return surf(x, z) + 0.014; }); if (mg) { var mm = new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ map: mt, metalness: 0.85, roughness: 0.32, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })); addMesh(mm); } }
    OP.n.brass = n;
  }
  // ── antenna dishes by the Launch Walk ──
  function buildDishes(Mm) {
    var A = axis(), ex = A.uz, ez = -A.ux, spots = [], tries = [[163, 12.5], [188, 12.2], [58, -12.5]]; tries.forEach(function (t) { var x = A.a[0] + A.ux * t[0] + ex * t[1], z = A.a[1] + A.uz * t[0] + ez * t[1]; if (planNearCollider(x, z, 1.6) || planNearRoad(x, z, 2)) return; spots.push([x, z, t[1] > 0 ? 1 : -1]); }); if (!spots.length) return;
    var b = new Batch(); var prof = []; for (var i = 0; i <= 10; i++) { var r = 2.3 * i / 10; prof.push(new THREE.Vector2(r, r * r / (4 * 1.6))); } var dish = new THREE.LatheGeometry(prof, 28);
    spots.forEach(function (s) { var y = getH(s[0], s[1]), face = yawOf(A.ux, A.uz) + (s[2] > 0 ? -2.2 : 2.2); b.add(new THREE.CylinderGeometry(0.28, 0.4, 3.0, 12), mtx(s[0], y + 1.5, s[1])); b.add(boxUV(1.0, 0.5, 0.6, 1), mtx(s[0], y + 3.1, s[1], face)); var tilt = 0.85; b.add(dish, mtx(s[0] + Math.sin(face) * 0.2, y + 3.4, s[1] + Math.cos(face) * 0.2, face, Math.PI / 2 - tilt));
      for (var k = 0; k < 3; k++) { var a = k / 3 * TAU; b.add(new THREE.CylinderGeometry(0.025, 0.025, 1.9, 4), mtx(s[0] + Math.sin(face) * 0.9 + Math.cos(a) * 0.3, y + 4.2 + Math.sin(a) * 0.3, s[1] + Math.cos(face) * 0.9, face, Math.PI / 2 - tilt)); } COLLIDERS.push([s[0], s[1], 0.5]); addSolid(s[0], s[1], 0, 0.8, 0.8, y - 0.2, y + 3, "world"); });
    var m = b.mesh(Mm.whiteDS); if (m) { var g = new THREE.Group(); g.add(m); addGroup(g, true); gate(g, spots[0][0], spots[0][1], 900); } OP.n.dishes = spots.length;
  }

  // ── the Outpost host: the surface-suit guide walking a slow loop round Launch Plaza (loaded the first time anyone comes near) ──
  var HOST = { state: 0, g: null, mixer: null, a: 0, hs: null };
  // the host's talk card (the client's castById reads window.PLAN_TALK; g is the walking model, or a marker until it loads)
  var TALK = window.PLAN_TALK = window.PLAN_TALK || {};
  TALK.host = { id: "host", name: "The Outpost host", role: "Launch Plaza · The Outpost", get g() { return HOST.g || HOST.stub; },
    talk: [{ t: "Welcome to The Outpost, the off-world end of the Horizon Line. I walk Launch Plaza in a surface suit so you know you have arrived. What would you like to see?", o: [["The Countdown", 1], ["The Genesis Ring", 2], ["Mission Control and the Dome", 3], ["Thanks", null]] },
      { t: "Ten numbered light rings count down along the Launch Walk, one every 25 metres, from ring 10 at the Outpost Gate to ring 1 under the Genesis Ring. After dark the xeno-garden between them glows blue.", o: [["The Genesis Ring", 2], ["Something else", 0], ["Thanks", null]] },
      { t: "The Genesis Ring stands 24 metres tall on its edge at the end of the line, lit a steady cyan at night. The Orbit Walk circles it past the eight planet fountains. From midnight to one it dims for the Dark Sky Observatory.", o: [["Mission Control and the Dome", 3], ["Something else", 0], ["Thanks", null]] },
      { t: "Mission Control faces Launch Plaza, the lander stands on its blast pad beside the walk, and the Genesis Dome keeps a desert garden under glass. Stratos Field and the Low-G Course are at the south end of The Outpost.", o: [["The Countdown", 1], ["Something else", 0], ["Thanks", null]] }] };
  function hostLoaded(gl) { var g = gl.scene; g.userData.b4 = true; g.traverse(function (o) { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } }); g.userData.noInst = true; g.userData.noCull = true; scene.add(g); HOST.g = g;
    var clip = gl.animations && gl.animations[0]; if (clip) { clip.tracks.forEach(function (t) { if (/hips\.position$/i.test(t.name) && t.values.length >= 3) { var x0 = t.values[0], z0 = t.values[2]; for (var i = 0; i < t.values.length; i += 3) { t.values[i] = x0; t.values[i + 2] = z0; } } }); HOST.mixer = new THREE.AnimationMixer(g); HOST.mixer.clipAction(clip).play(); } HOST.state = 2; OP.n.host = clip ? 2 : 1; }
  function hostTick(dt) { var c = OP.pos.launch; if (!c) return; var d = Math.hypot(c[0] - camera.position.x, c[1] - camera.position.z);
    if (HOST.state === 0) { if (d > 450) return; HOST.state = 1; try { gltfLoader().load(ASSET.models + "/host.glb?v=" + (window.BUILD || "dev"), function (gl) { try { hostLoaded(gl); } catch (e) { HOST.state = 3; note("host", e); } }, undefined, function (e) { HOST.state = 3; note("host load", e); }); } catch (e) { HOST.state = 3; note("host", e); } return; }
    if (HOST.state !== 2) return; var vis = d < 260; if (HOST.g.visible !== vis) HOST.g.visible = vis; if (!vis) return;
    if (!HOST.R) { HOST.R = 13; var tries = [13, 14.5, 11.5, 16, 10.5, 17.5]; for (var ti = 0; ti < tries.length; ti++) { var ok = true; for (var k = 0; k < 36 && ok; k++) { var aa = k / 36 * TAU, px = c[0] + Math.cos(aa) * tries[ti], pz = c[1] + Math.sin(aa) * tries[ti]; if (planNearCollider(px, pz, 0.9)) ok = false; for (var f = 0; f < SOLIDS.length && ok; f++) { var sd = SOLIDS[f]; if (Math.abs(sd.x - px) < sd.hw + sd.hd + 1.2 && Math.abs(sd.z - pz) < sd.hw + sd.hd + 1.2) { var lc = solidLocal(sd, px, pz); if (Math.abs(lc[0]) < sd.hw + 0.6 && Math.abs(lc[1]) < sd.hd + 0.6) ok = false; } } } if (ok) { HOST.R = tries[ti]; break; } } }
    var R = HOST.R; var talking = typeof talkNpc !== "undefined" && talkNpc === TALK.host; if (talking && player) { HOST.g.rotation.y = Math.atan2(player.position.x - HOST.g.position.x, player.position.z - HOST.g.position.z); return; } HOST.a += Math.min(dt, 0.1) * 1.1 / R; var x = c[0] + Math.cos(HOST.a) * R, z = c[1] + Math.sin(HOST.a) * R; HOST.g.position.set(x, surf(x, z), z); HOST.g.rotation.y = yawOf(-Math.sin(HOST.a), Math.cos(HOST.a)); if (HOST.mixer) HOST.mixer.update(Math.min(dt, 0.1)); if (HOST.hs) { HOST.hs.x = x; HOST.hs.z = z; } }
  OP.host = HOST;

  // ═════════════════════════════════ FRAME ═════════════════════════════════
  function llpActive() { try { var J = TRAFFIC.jets; for (var i = 0; i < J.length; i++) if (J[i].phase === "approach" && J[i].dir === 1) return true; } catch (e) {} try { if (FLY.on && !FLY.done) return true; } catch (e) {} return window.PLAN_LLP_FORCE === true; }
  function setK(m, key, v) { if (!m) return; var cur = key === "op" ? m.opacity : key === "uK" ? m.uniforms.uK.value : m.emissiveIntensity; if (Math.abs(cur - v) < 0.004) return; if (key === "op") m.opacity = v; else if (key === "uK") m.uniforms.uK.value = v; else m.emissiveIntensity = v; }
  var lastClock = 0, lastGate = -1, dsMsg = false;
  function frame(dt, now) {
    if (!OP.built) return; var nt = typeof night === "number" ? night : 0; var hr = dayT() * 24;
    // the dark-sky hour: 00:00 to 01:00 site time, after the last rover
    var dsT = hr < 1 ? sstep(0, 0.05, hr) * (1 - sstep(0.95, 1, hr)) : 0; OP.darkSky += (dsT - OP.darkSky) * Math.min(1, dt * 2); var ds = OP.darkSky;
    var lp = llpActive() ? 1 : 0, ap = null; try { ap = A2.pause; } catch (e) {} if (typeof ap === "number" && !window.PLAN_LLP_FORCE) OP.llp = ap; else OP.llp += (lp - OP.llp) * Math.min(1, dt * 1.5); window.PLAN_LLP = { on: OP.llp > 0.5, k: OP.llp };   // A2 runs the pause (planApproachWant); we follow it
    OP.u.t.value = now / 1000; OP.u.night.value = nt; OP.u.px.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
    var Mm = OP.mats, glow = Math.max(0, nt - 0.15) / 0.85, dim = 1 - 0.92 * ds, show = 1 - 0.75 * OP.llp;
    if (Mm) { setK(Mm.ringGlow, "e", (0.9 + 2.2 * glow) * (1 - 0.88 * ds)); setK(Mm.countGlow, "e", 2.4 * glow * (1 - 0.94 * ds)); setK(Mm.red, "e", 1.6 + 2 * glow); setK(Mm.brass, "e", 0.1 + 0.3 * glow); setK(Mm.frost, "e", 0.3 * glow); setK(Mm.warm, "e", 2.6 * glow * show); setK(Mm.up, "e", 2.4 * glow); setK(Mm.wash, "op", 0.55 * glow); if (OP.redDim) setK(OP.redDim, "e", 0.3 + 0.9 * glow); }
    setK(OP.numMat, "e", 0.25 + 1.4 * glow * (1 - 0.85 * ds)); setK(OP.planetMat, "e", 0.35 * glow * dim); setK(OP.ringGlowPts && OP.ringGlowPts.material, "uK", (0.12 + 0.75 * glow) * (1 - 0.9 * ds)); setK(OP.redGlowPts && OP.redGlowPts.material, "uK", 0.5 + 0.5 * glow);
    setK(OP.countGlowPts && OP.countGlowPts.material, "uK", 0.6 * glow * (1 - 0.95 * ds)); setK(OP.agaveGlow && OP.agaveGlow.material, "uK", 0.7 * glow * dim); setK(OP.vagaveGlow && OP.vagaveGlow.material, "uK", 0.7 * glow * show); setK(OP.festoonGlow && OP.festoonGlow.material, "uK", 0.8 * glow * show); setK(OP.gantryGlow && OP.gantryGlow.material, "uK", 0.8 * glow * show);
    setK(OP.compassGlow && OP.compassGlow.material, "uK", 0.8 * glow); setK(OP.orbitGlow && OP.orbitGlow.material, "uK", 0.7 * glow * dim); setK(OP.obsGlow && OP.obsGlow.material, "uK", 0.25 + 0.55 * glow); setK(OP.lowgGlow && OP.lowgGlow.material, "uK", 0.2 + 0.6 * glow); setK(OP.beaconGlow && OP.beaconGlow.material, "uK", (0.25 + 0.7 * glow) * (0.75 + 0.25 * Math.sin(now / 1000 * 0.8)));
    if (OP.fibreMat) OP.fibreMat.uniforms.uDim.value = dim; if (OP.folMat) OP.folMat.uniforms.uDim.value = 1; if (JETMAT) JETMAT.uniforms.uDim.value = 1;
    if (OP.beaconCore) setK(OP.beaconCore, "e", (0.7 + 1.8 * glow) * (0.72 + 0.28 * Math.sin(now / 1000 * 0.8)));
    if (OP.clockMat) setK(OP.clockMat, "e", 0.7 + 0.6 * glow);
    // the mists: steady cyan at night for the Halo Mist; the Launch Mist builds to an ignition every 26 s
    if (OP.haloMist) { var u = OP.haloMist.uniforms; u.uA.value = 0.18 + 0.12 * glow * (1 - 0.6 * ds); u.uCol.value.setRGB(0.93 - 0.55 * glow * (1 - ds), 0.96 - 0.04 * glow, 0.98); }
    var ph = (now / 1000) % 26, burst = ph < 4 ? sstep(0, 4, ph) : ph < 9 ? 1 : ph < 14 ? 1 - sstep(9, 14, ph) : 0.08; OP.burst = burst;
    if (OP.launchMist) { var u2 = OP.launchMist.uniforms; u2.uA.value = 0.06 + 0.32 * burst; u2.uRise.value = 1.6 + 4.2 * burst; u2.uSpread.value = 1.4 + 2.2 * burst; u2.uCol.value.setRGB(0.95, 0.96, 0.98); }
    if (OP.launchRing) setK(OP.launchRing, "e", (0.3 + 2.4 * burst) * (0.25 + glow));
    for (var i = 0; i < OP.lights.length; i++) { var L = OP.lights[i], k = glow; if (L.kind === "ring") k = glow * (1 - 0.9 * ds); else if (L.kind === "orbit") k = glow * dim; else if (L.kind === "launch") k = glow * (0.25 + 0.75 * burst); else if (L.kind === "clock") k = (0.3 + 0.7 * glow) * (OP.llp > 0.5 ? 0.6 : 1); else if (L.kind === "beacon") k = glow * (0.7 + 0.3 * Math.sin(now / 1000 * 0.8)); var want = L.base * k; if (Math.abs(L.l.intensity / 1.7 - want) > 0.01) L.l.intensity = want; }
    try { hostTick(dt); } catch (e) { HOST.state = 3; note("hostTick", e); }
    if (OP.sock) OP.sock.rotation.y = 0.6 + Math.sin(now / 1000 * 0.21) * 0.35 + Math.sin(now / 1000 * 0.9) * 0.06;
    // distance gating every few frames
    if (FRAME_N !== lastGate && FRAME_N % 6 === 0) { lastGate = FRAME_N; var cx = camera.position.x, cz = camera.position.z; for (var j = 0; j < OP.items.length; j++) { var it = OP.items[j]; var d = Math.hypot(it.x - cx, it.z - cz), vis = d < it.R; if (vis !== it.vis) { it.vis = vis; it.o.visible = vis; } } }
    // the countdown clock, once a second while anyone could read it
    if (OP.clockTex && now - lastClock > 1000) { lastClock = now; var ck = OP.pos.clock; if (ck && Math.hypot(ck[0] - camera.position.x, ck[1] - camera.position.z) < 320) { var st = clockState(); if (st.key !== OP.clockKey) { OP.clockKey = st.key; var cv = OP.clockTex.userData.canvas; clockDraw(cv.getContext("2d"), cv.width, cv.height, st); OP.clockTex.needsUpdate = true; } } }
    // tell the player once when the dark-sky hour starts while they are in The Outpost
    if (ds > 0.5 && !dsMsg) { dsMsg = true; try { if (OP.pos.ring && Math.hypot(OP.pos.ring[0] - camera.position.x, OP.pos.ring[1] - camera.position.z) < 500) logLine("The Outpost", "The dark-sky hour has begun: the Ring and the Countdown dim for the Dark Sky Observatory."); } catch (e) {} }
    if (ds < 0.2) dsMsg = false;
  }

  HK.world.push({ name: "outpostWorld", fn: world });
  HK.terrain.push({ name: "outpostTerrain", fn: terrain });
  HK.defer.push({ name: "outpostDefer", fn: defer });
  HK.frame.push({ name: "outpostFrame", fn: frame });
})();
