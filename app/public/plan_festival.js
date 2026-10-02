// R7 FESTIVAL (2 Oct 2026): the Solport Convention Center campus. The Festival Grounds (a lawn and decomposed granite plaza,
// open-air timber bars under pergolas with string lights, the Side Stage with an LED screen, truss and DJ booth, picnic tables
// under white umbrellas, violet and green drapes strung between tall timber poles, food trucks with the green Giveback truck,
// fire bowls, saguaros, palo verdes, agave beds, boulders, bins, wayfinding and schedule boards), the campus paths (to Link Plaza
// and the Landside Walk, the arena forecourt and the Market Hall), the shuttle drop-off off Terminal Drive with a shuttle stop
// and parked carts, perimeter desert planting, and the campus event life (an in-game schedule on the boards, the LED screen and
// a HUD toast; an instanced crowd baked from the client's own rigs that gathers by event; a few rigged staff; ambient lines;
// a dance battle on the floor in front of the Side Stage; seats at every picnic table; passport stamps and an info point).
// Classic script, loaded before client.js; hooks into window.PLAN_HOOKS { world, terrain, defer, frame }. All names, copy,
// positions and the schedule: plan/festival.json. The crowd's baked poses: models/fest_crowd.bin (127 KB).
// Performance: no real lights (a few lamps feed the client's light pool), every static part merged into one mesh per material
// (nine materials in all), the crowd is six instanced draws gated per zone in the vertex shader, its blob shadows one more.
// ?fest=0 turns the module off. window.PLAN_FESTIVAL: n (counters), errs, cfg, api, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var FE = window.PLAN_FESTIVAL = window.PLAN_FESTIVAL || {};
  FE.errs = FE.errs || []; FE.n = FE.n || {}; FE.ver = "r7";
  if (/[?&]fest=0\b/.test(location.search)) { FE.off = true; return; }
  var PI = Math.PI, TAU = PI * 2;
  function note(tag, e) { try { if (FE.errs.length < 50) FE.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (FE.errs.length <= 6) console.warn("plan_festival " + tag, e); } catch (x) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function nowMs() { return performance.now(); }
  function $id(id) { return document.getElementById(id); }
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function hourNow() { try { return dayT() * 24; } catch (e) { return 12; } }
  function gh(x, z) { try { return getH(x, z); } catch (e) { return 0; } }
  function has(k) { try { return !!(MODELS[k] && (MODELS[k].parts || MODELS[k]._pp)); } catch (e) { return false; } }
  function canPut(k) { try { return has(k) && !!MODEL_SPECS[k]; } catch (e) { return false; } }

  // ───────────────────────── config: plan/festival.json ─────────────────────────
  var CFG = FE.cfg || null;
  function cfgUrl() { var u = "/plan/festival.json?v=" + (window.BUILD || "dev"); try { if (window.AV) u = window.AV(u); } catch (e) {} return u; }
  if (!CFG) { try { fetch(cfgUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && !CFG) CFG = FE.cfg = d; }).catch(function (e) { note("cfg fetch", e); }); } catch (e) { note("cfg", e); } }
  function cfg() { if (CFG) return CFG; try { var x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = FE.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); } return CFG; }
  function C(path, dflt) { var o = cfg(); if (!o) return dflt; var p = path.split("."); for (var i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }

  // ───────────────────────── geometry kit: parts in a local frame, merged per base material with a vertex tint ─────────────────────────
  // Every part carries colour (rgb) and aPM (roughness, metalness, emission) so paint, steel and glowing bulbs share one material.
  var _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  var _cc = {};
  function lin(hex) { if (_cc[hex]) return _cc[hex]; var c = new THREE.Color(hex); return (_cc[hex] = [c.r, c.g, c.b]); }
  function uvBox(g, w, h, d, t) { var uv = g.attributes.uv; var dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (var f = 0; f < 6; f++) for (var k = 0; k < 4; k++) { var i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } }
  function Kit() { this.L = {}; this.tris = 0; }
  Kit.prototype.push = function (base, g, col, pm, extra) {
    if (g.index) g = g.toNonIndexed(); if (!g.attributes.normal) g.computeVertexNormals(); var n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    var keep = col === "keep" && g.attributes.color, c = lin(keep || col == null ? 0xffffff : col), ca = new Float32Array(n * 3), pa = new Float32Array(n * 3); pm = pm || PM_PAINT;
    for (var i = 0; i < n; i++) { ca[i * 3] = c[0]; ca[i * 3 + 1] = c[1]; ca[i * 3 + 2] = c[2]; pa[i * 3] = pm[0]; pa[i * 3 + 1] = pm[1]; pa[i * 3 + 2] = pm[2]; }
    if (!keep) g.setAttribute("color", new THREE.BufferAttribute(ca, 3)); g.setAttribute("aPM", new THREE.BufferAttribute(pa, 3));
    if (extra) for (var k in extra) { var v = extra[k], sz = v.length, a = new Float32Array(n * sz); for (var j = 0; j < n; j++) for (var q = 0; q < sz; q++) a[j * sz + q] = typeof v[q] === "function" ? v[q](g, j) : v[q]; g.setAttribute(k, new THREE.BufferAttribute(a, sz)); }
    (this.L[base] || (this.L[base] = [])).push(g); this.tris += n / 3; return g;
  };
  // a local frame at (x, y, z) turned by yaw: parts are placed in it, then pushed in world space
  function Fr(K, x, y, z, yaw) { this.K = K; this.M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw || 0), new THREE.Vector3(1, 1, 1)); this.x = x; this.y = y; this.z = z; this.yaw = yaw || 0; this.c = Math.cos(this.yaw); this.s = Math.sin(this.yaw); }
  Fr.prototype.w = function (lx, lz) { return [this.x + lx * this.c + lz * this.s, this.z - lx * this.s + lz * this.c]; };
  Fr.prototype.geo = function (base, col, g, lx, ly, lz, ry, rx, rz, sx, sy, sz, pm, extra) { _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(lx || 0, ly || 0, lz || 0), _q, _v2.set(sx || 1, sy || 1, sz || 1)); g.applyMatrix4(_m4); g.applyMatrix4(this.M); return this.K.push(base, g, col, pm, extra); };
  Fr.prototype.box = function (base, col, w, h, d, lx, ly, lz, ry, rx, rz, pm, t) { var g = new THREE.BoxGeometry(w, h, d); uvBox(g, w, h, d, t || 1.2); return this.geo(base, col, g, lx, ly, lz, ry, rx, rz, 1, 1, 1, pm); };
  Fr.prototype.cyl = function (base, col, r0, r1, h, lx, ly, lz, seg, pm, rx, rz, ry) { var g = new THREE.CylinderGeometry(r0, r1, h, seg || 10, 1, false); return this.geo(base, col, g, lx, ly, lz, ry || 0, rx || 0, rz || 0, 1, 1, 1, pm); };
  Fr.prototype.sph = function (base, col, r, lx, ly, lz, seg, sy, pm) { var g = new THREE.SphereGeometry(r, seg || 8, Math.max(4, (seg || 8) >> 1)); return this.geo(base, col, g, lx, ly, lz, 0, 0, 0, 1, sy || 1, 1, pm); };
  // a quad mapped to an atlas rectangle [u0, v0, u1, v1] (canvas pixels, top-left origin), emission e (0 or 1)
  Fr.prototype.aquad = function (rect, w, h, lx, ly, lz, ry, e, rx, flipU) { var g = new THREE.PlaneGeometry(w, h); var uv = g.attributes.uv; for (var i = 0; i < uv.count; i++) { var u = uv.getX(i), v = uv.getY(i); if (flipU) u = 1 - u; uv.setXY(i, (rect[0] + (rect[2] - rect[0]) * u) / ATLAS_W, 1 - (rect[1] + (rect[3] - rect[1]) * (1 - v)) / ATLAS_H); } return this.geo("atlas", 0xffffff, g, lx, ly, lz, ry, rx || 0, 0, 1, 1, 1, [0.7, 0, e || 0]); };
  // a world-space tube from A to B
  function tubeG(A, B, r, seg) { var d = _v3.subVectors(B, A); var L = d.length(); if (L < 1e-4) return null; var g = new THREE.CylinderGeometry(r, r, L, seg || 6, 1, true); _q.setFromUnitVectors(_v1.set(0, 1, 0), d.normalize()); _m4.compose(_v2.addVectors(A, B).multiplyScalar(0.5), _q, new THREE.Vector3(1, 1, 1)); g.applyMatrix4(_m4); return g; }
  function boxBetween(A, B, w, d) { var dir = new THREE.Vector3().subVectors(B, A); var L = dir.length(); if (L < 1e-4) return null; dir.normalize(); var g = new THREE.BoxGeometry(w, L, d); uvBox(g, w, L, d, 1.2); _q.setFromUnitVectors(_v1.set(0, 1, 0), dir); _m4.compose(new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5), _q, new THREE.Vector3(1, 1, 1)); g.applyMatrix4(_m4); return g; }
  function mergeList(list) {
    var n = 0, names = null; list.forEach(function (g) { n += g.attributes.position.count; if (!names) names = Object.keys(g.attributes); }); if (!n) return null;
    var out = new THREE.BufferGeometry();
    names.forEach(function (nm) { var sz = list[0].attributes[nm].itemSize, arr = new Float32Array(n * sz), o = 0; list.forEach(function (g) { var a = g.attributes[nm]; if (a) arr.set(a.array, o * sz); o += g.attributes.position.count; }); out.setAttribute(nm, new THREE.BufferAttribute(arr, sz)); });
    out.computeBoundingBox(); out.computeBoundingSphere(); return out;
  }
  // every base's parts as one mesh (shadow flags per base)
  Kit.prototype.build = function (grp, noShadow) { var out = []; for (var b in this.L) { var mt = MAT[b]; if (!mt) { note("base", b); continue; } var geo = mergeList(this.L[b]); if (!geo) continue; var me = new THREE.Mesh(geo, mt); me.name = "fest " + b; me.castShadow = !noShadow && !mt.transparent && !/NS$/.test(b); me.receiveShadow = !mt.transparent; me.userData.shSet = true; if (!me.castShadow) me.userData.noShadow = true; grp.add(me); out.push(me); } this.L = {}; return out; };
  var PM_PAINT = [0.6, 0.02, 0], PM_SATIN = [0.38, 0.05, 0], PM_STEEL = [0.32, 0.85, 0], PM_CHROME = [0.15, 1.0, 0], PM_RUBBER = [0.9, 0, 0], PM_GLASS = [0.08, 0.4, 0], PM_EMIT = [0.4, 0, 1], PM_EMIT_H = [0.4, 0, 0.5], PM_FAB = [0.92, 0, 0];

  // ───────────────────────── materials: nine in all, shared by every part (stable program cache keys) ─────────────────────────
  var U = FE.U = { uT: { value: 0 }, uEm: { value: 0.2 }, uEmA: { value: 0.15 }, uGlow: { value: 0 }, uNight: { value: 0 }, uScreen: { value: 1 }, uBeam: { value: 0 }, uDay: { value: 1 } };
  var MAT = FE.mat = {};
  var ATLAS_W = 2048, ATLAS_H = 2560;
  function stdPatch(sh) {
    sh.uniforms.uEm = U.uEm;
    sh.vertexShader = "attribute vec3 aPM;\nvarying vec3 vPM;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvPM = aPM;");
    sh.fragmentShader = "uniform float uEm;\nvarying vec3 vPM;\n" + sh.fragmentShader.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = vPM.x;").replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = vPM.y;").replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vPM.z * uEm;");
  }
  function atlasPatch(sh) {
    sh.uniforms.uEmA = U.uEmA;
    sh.vertexShader = "attribute vec3 aPM;\nvarying vec3 vPM;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvPM = aPM;");
    sh.fragmentShader = "uniform float uEmA;\nvarying vec3 vPM;\n" + sh.fragmentShader.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = vPM.x;").replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vPM.z * uEmA;");
  }
  // fabric: sway; in daylight the side that faces down shows the sun through the cloth (a lighter underside) and the thin edges
  // glow a little (translucency), after dark a faint warm glow from the string lights
  function fabricPatch(sh) {
    sh.uniforms.uT = U.uT; sh.uniforms.uGlow = U.uGlow; sh.uniforms.uDay = U.uDay;
    sh.vertexShader = "attribute vec3 aSw;\nuniform float uT;\nvarying float vNy;\nvarying float vEd;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n{ float ph = uT * 1.15 + aSw.y + position.x * 0.07 + position.z * 0.05; transformed.y += sin(ph) * aSw.x; transformed.x += sin(ph * 0.83 + 1.3) * aSw.x * 0.45; transformed.z += cos(ph * 0.71) * aSw.x * 0.45; }\nvNy = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz).y; vEd = aSw.z;");
    sh.fragmentShader = "uniform float uGlow;\nuniform float uDay;\nvarying float vNy;\nvarying float vEd;\n" + sh.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n{ float dn = gl_FrontFacing ? -vNy : vNy; totalEmissiveRadiance += diffuseColor.rgb * (uGlow + uDay * (0.5 * pow(clamp(dn, 0.0, 1.0), 5.0) + 0.3 * vEd)); }");
  }
  // the lawn: the client's turf texture desaturated to a cooler olive, large mowing stripes, tone patches, dry wear near the tables,
  // poles and the edge, and a ragged soft edge into the plaza (aLw: distance to the edge, wear)
  var NOISE = "float fh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat fn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(fh(i), fh(i + vec2(1.0, 0.0)), f.x), mix(fh(i + vec2(0.0, 1.0)), fh(i + vec2(1.0, 1.0)), f.x), f.y); }\n";
  function lawnPatch(sh) {
    sh.uniforms.uDir = { value: new THREE.Vector2(0.34, 0.94) };
    sh.vertexShader = "attribute vec2 aLw;\nvarying vec2 vLw;\nvarying vec2 vWp;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvLw = aLw; vWp = (modelMatrix * vec4(transformed, 1.0)).xz;");
    sh.fragmentShader = "uniform vec2 uDir;\nvarying vec2 vLw;\nvarying vec2 vWp;\n" + NOISE + sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n{ vec3 c = diffuseColor.rgb; float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, 0.28) * vec3(0.80, 0.84, 0.56);\n" +
      " float n1 = fn(vWp * 0.06), n2 = fn(vWp * 0.27 + 7.0), n3 = fn(vWp * 1.9 + 3.0); c *= 0.84 + 0.2 * n1 + 0.08 * n2;\n" +
      " float st = smoothstep(0.38, 0.62, abs(fract(dot(vWp, uDir) / 9.0) * 2.0 - 1.0)); c *= mix(0.92, 1.07, st);\n" +
      " c = mix(c, c * vec3(1.14, 1.02, 0.72), smoothstep(0.55, 0.9, n1) * 0.55);\n" +
      " float w = clamp(vLw.y + (1.0 - smoothstep(0.0, 2.2, vLw.x)) * 0.5, 0.0, 1.0) * (0.45 + 0.75 * n3);\n" +
      " c = mix(c, vec3(0.40, 0.35, 0.24) * (0.8 + 0.35 * n2), clamp(w, 0.0, 0.8));\n" +
      " if (vLw.x < 1.0 && n3 * 0.75 + n2 * 0.35 > vLw.x + 0.18) discard;\n" +
      " diffuseColor.rgb = c; }");
  }
  function makeMats() {
    if (MAT.std) return MAT;
    MAT.std = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 }); MAT.std.name = "fest_std"; MAT.std.onBeforeCompile = stdPatch; MAT.std.customProgramCacheKey = function () { return "fest_std"; }; MAT.stdNS = MAT.std;
    MAT.wood = new THREE.MeshStandardMaterial({ vertexColors: true, map: TEX.wood, normalMap: TEX.woodN, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.82 }); MAT.wood.name = "fest_wood";
    MAT.fabric = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide }); MAT.fabric.name = "fest_fabric"; MAT.fabric.onBeforeCompile = fabricPatch; MAT.fabric.customProgramCacheKey = function () { return "fest_fabric"; };
    MAT.atlas = new THREE.MeshStandardMaterial({ vertexColors: true, map: atlasTex(), roughness: 0.7, side: THREE.FrontSide }); MAT.atlas.name = "fest_atlas"; MAT.atlas.onBeforeCompile = atlasPatch; MAT.atlas.customProgramCacheKey = function () { return "fest_atlas"; };
    MAT.board = new THREE.MeshStandardMaterial({ vertexColors: true, map: boardTex(), roughness: 0.7 }); MAT.board.name = "fest_board"; MAT.board.onBeforeCompile = atlasPatch; MAT.board.customProgramCacheKey = function () { return "fest_atlas"; };
    MAT.lawn = new THREE.MeshStandardMaterial({ map: TEX.turf, normalMap: TEX.turfN, normalScale: new THREE.Vector2(0.8, 0.8), color: 0xffffff, roughness: 0.97 }); MAT.lawn.name = "fest_lawn"; MAT.lawn.onBeforeCompile = lawnPatch; MAT.lawn.customProgramCacheKey = function () { return "fest_lawn"; };
    MAT.lawn.polygonOffset = true; MAT.lawn.polygonOffsetFactor = -2; MAT.lawn.polygonOffsetUnits = -2;
    try { var PMs = planMats(); MAT.dg = PMs.dg.clone(); MAT.dg.name = "fest_dg"; MAT.dg.color.multiply(new THREE.Color(0xe4c39c)); MAT.stone = PMs.stone.clone(); MAT.stone.name = "fest_pavers"; MAT.stone.color.multiply(new THREE.Color(0xd8cdbd)); MAT.bed = PMs.bed; } catch (e) { MAT.dg = MAT.stone = MAT.bed = M.walk; }
    MAT.asphalt = M.taxi;
    MAT.screen = new THREE.ShaderMaterial({ uniforms: { uT: U.uT, uMap: { value: screenTex() }, uK: U.uScreen }, vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "uniform float uT; uniform sampler2D uMap; uniform float uK; varying vec2 vUv;\n" +
        "float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n" +
        "void main(){ vec2 p = vUv; float t = uT * 0.35;\n" +
        " float w1 = sin(p.x * 6.0 + t * 2.0 + sin(p.y * 3.0 + t) * 1.6); float w2 = sin(p.x * 3.1 - t * 1.4 + p.y * 5.0); float w3 = sin((p.x + p.y) * 9.0 + t * 3.1);\n" +
        " float band = smoothstep(0.55, 1.0, w1 * 0.6 + w2 * 0.4); float band2 = smoothstep(0.7, 1.0, w3 * 0.5 + w2 * 0.5);\n" +
        " vec3 deep = vec3(0.004, 0.02, 0.012); vec3 green = vec3(0.07, 0.62, 0.17); vec3 gold = vec3(0.9, 0.55, 0.06); vec3 vio = vec3(0.22, 0.06, 0.5);\n" +
        " vec3 c = mix(deep, vio * 0.5, smoothstep(0.0, 1.0, p.y) * 0.6); c += green * band * 0.9 + gold * band2 * 0.55;\n" +
        " vec2 cell = floor(p * vec2(96.0, 54.0)); c *= 0.86 + 0.14 * step(0.08, fract(p.x * 96.0)) * step(0.08, fract(p.y * 54.0));\n" +
        " vec4 tx = texture2D(uMap, p); c = mix(c, tx.rgb, tx.a);\n" +
        " gl_FragColor = vec4(c * uK, 1.0); }" });
    MAT.screen.name = "fest_screen";
    MAT.flame = new THREE.ShaderMaterial({ uniforms: { uT: U.uT, uK: U.uNight }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: "attribute float aSeed; varying vec2 vUv; varying float vS; void main(){ vUv = uv; vS = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "uniform float uT; uniform float uK; varying vec2 vUv; varying float vS;\n" +
        "void main(){ vec2 p = vUv - vec2(0.5, 0.0); float t = uT * 3.0 + vS * 17.0; float flick = 0.75 + 0.25 * sin(t * 2.3) * sin(t * 1.7 + 1.0);\n" +
        " float w = 0.32 * (1.0 - vUv.y) * (0.85 + 0.15 * sin(vUv.y * 9.0 - t * 3.0)); float x = p.x + sin(vUv.y * 6.0 - t * 2.0) * 0.06 * vUv.y;\n" +
        " float f = smoothstep(w, w * 0.25, abs(x)) * smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.55 * flick, 1.0, vUv.y));\n" +
        " vec3 col = mix(vec3(1.0, 0.85, 0.45), vec3(1.0, 0.32, 0.05), smoothstep(0.1, 0.7, vUv.y));\n" +
        " gl_FragColor = vec4(col * f * (1.2 + 1.6 * uK), f); }" });
    MAT.flame.name = "fest_flame";
    // stage light beams after dark: additive cones from the par cans, sweeping slowly (one draw, no lights)
    MAT.beam = new THREE.ShaderMaterial({ uniforms: { uT: U.uT, uK: U.uBeam }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexColors: true,
      vertexShader: "attribute vec2 aBm; varying float vT; varying vec3 vC; varying vec3 vN; varying vec3 vV; uniform float uT; void main(){ vT = aBm.x; vC = color; vec3 p = position; float s = sin(uT * 0.55 + aBm.y) * 2.2 * aBm.x, c = cos(uT * 0.43 + aBm.y * 1.7) * 1.4 * aBm.x; p.x += s; p.z += c; vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }",
      fragmentShader: "uniform float uK; varying float vT; varying vec3 vC; varying vec3 vN; varying vec3 vV; void main(){ float e = abs(dot(normalize(vN), normalize(vV))); float a = uK * 1.0 * pow(1.0 - vT, 1.3) * e * e * smoothstep(0.0, 0.05, vT); gl_FragColor = vec4(vC * a * 3.0, a); }" });
    MAT.beam.name = "fest_beam";
    // warm light pools on the ground under the string lights, the bars, the trucks and the fire bowls after dark (additive, no lights)
    MAT.glow = new THREE.ShaderMaterial({ uniforms: { uK: U.uNight }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
      vertexShader: "attribute float aGl; varying float vA; varying vec3 vC; void main(){ vA = aGl; vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "uniform float uK; varying float vA; varying vec3 vC; void main(){ gl_FragColor = vec4(vC, vA * uK); }" });
    MAT.glow.name = "fest_glow";
    return MAT;
  }

  // ───────────────────────── canvas atlas (signs, liveries, banners, menus): drawn at run time, no image bytes ─────────────────────────
  var FONT = { cond: "'Anton', 'Oswald', 'Arial Narrow', Impact, sans-serif", ui: "'Space Grotesk', 'Segoe UI', system-ui, sans-serif", serif: "'Fraunces', Georgia, serif", mono: "'JetBrains Mono', Consolas, monospace" };
  function txt(x, t, px, py, font, color, align, maxW, ls) { x.font = font; x.fillStyle = color; x.textAlign = align || "center"; x.textBaseline = "middle"; try { x.letterSpacing = (ls || 0) + "px"; } catch (e) {} if (maxW) { var w = x.measureText(t).width; if (w > maxW) { x.save(); x.translate(px, py); x.scale(maxW / w, 1); x.fillText(t, 0, 0); x.restore(); try { x.letterSpacing = "0px"; } catch (e) {} return; } } x.fillText(t, px, py); try { x.letterSpacing = "0px"; } catch (e) {} }
  function rrect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
  function noise(x, W, H, n, a, seed) { var R = rng(seed || 5); for (var i = 0; i < n; i++) { x.fillStyle = R() < 0.5 ? "rgba(255,255,255," + a + ")" : "rgba(0,0,0," + a + ")"; var r = 1 + R() * 2; x.fillRect(R() * W, R() * H, r, r); } }
  var LOGO = FE.logo || (FE.logo = { img: null, white: null, ok: false });
  (function loadLogos() { try { if (LOGO.img) return; var a = new Image(); a.onload = function () { LOGO.ok = true; if (FE.atlas) redrawAtlas(); }; a.src = "/tex/gb_logo.png"; LOGO.img = a; var b = new Image(); b.onload = function () { if (FE.atlas) redrawAtlas(); }; b.src = "/logo.png"; LOGO.white = b; } catch (e) { note("logo", e); } })();
  function logo(x, cx, cy, h, white) { var im = white ? LOGO.white : LOGO.img; if (!im || !im.complete || !im.naturalWidth) return false; var w = h * im.naturalWidth / im.naturalHeight; x.drawImage(im, cx - w / 2, cy - h / 2, w, h); return true; }
  // the summit mark: three peaks, a sun, a rule (generic summit branding)
  function peaks(x, cx, cy, s, col) { x.save(); x.strokeStyle = col; x.lineWidth = Math.max(2, s * 0.07); x.lineJoin = "round"; x.beginPath(); x.moveTo(cx - s, cy + s * 0.35); x.lineTo(cx - s * 0.45, cy - s * 0.35); x.lineTo(cx - s * 0.1, cy + s * 0.05); x.lineTo(cx + s * 0.3, cy - s * 0.55); x.lineTo(cx + s, cy + s * 0.35); x.stroke(); x.beginPath(); x.arc(cx + s * 0.62, cy - s * 0.45, s * 0.13, 0, TAU); x.stroke(); x.restore(); }
  var REG = FE.reg = {};
  function regions() {
    var L = [], T = C("liveries", {}), BS = C("barSigns", {}), WF = C("site.wayfinding", []);
    Object.keys(T).forEach(function (id) { var lv = T[id];
      L.push({ k: "side_" + id, w: 1024, h: 470, d: function (x, W, H) { x.fillStyle = lv.body; x.fillRect(0, 0, W, H); noise(x, W, H, 2500, 0.02, 3); var g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(255,255,255,0.10)"); g.addColorStop(0.5, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(0,0,0,0.18)"); x.fillStyle = g; x.fillRect(0, 0, W, H);
          x.fillStyle = lv.trim; x.fillRect(0, H - 44, W, 14); x.fillRect(0, 10, W, 6);
          if (id === "giveback") { if (!logo(x, W * 0.73, H * 0.42, 210, false)) txt(x, "GIVEBACK", W * 0.73, H * 0.42, "700 92px " + FONT.ui, "#f5f1e6", "center", 420); txt(x, lv.sub, W * 0.73, H * 0.8, "italic 500 34px " + FONT.serif, "#e9efe6", "center", 440); }
          else { txt(x, lv.name, W * 0.73, H * 0.36, "400 78px " + FONT.cond, lv.trim, "center", 440, 2); txt(x, lv.sub, W * 0.73, H * 0.58, "500 30px " + FONT.ui, lv.trim, "center", 440); peaks(x, W * 0.73, H * 0.8, 34, lv.trim); }
          x.fillStyle = "rgba(0,0,0,0.25)"; x.fillRect(W * 0.08, H * 0.24, W * 0.36, H * 0.42); } });
      L.push({ k: "back_" + id, w: 512, h: 470, d: function (x, W, H) { x.fillStyle = lv.body; x.fillRect(0, 0, W, H); noise(x, W, H, 1200, 0.02, 4); x.fillStyle = lv.trim; x.fillRect(0, H - 44, W, 14); if (id === "giveback") { logo(x, W / 2, H * 0.42, 150, false); } else { txt(x, lv.name, W / 2, H * 0.4, "400 56px " + FONT.cond, lv.trim, "center", 440, 2); } txt(x, C("names.summit", "Solport Summit").toUpperCase(), W / 2, H * 0.72, "600 22px " + FONT.mono, lv.trim, "center", 400, 4); } });
      L.push({ k: "menu_" + id, w: 256, h: 320, d: function (x, W, H) { x.fillStyle = "#1b1d1a"; x.fillRect(0, 0, W, H); noise(x, W, H, 900, 0.04, 6); x.strokeStyle = lv.trim; x.lineWidth = 6; x.strokeRect(8, 8, W - 16, H - 16); txt(x, "MENU", W / 2, 44, "400 40px " + FONT.cond, "#f5f1e6", "center", 200, 3); (lv.menu || []).forEach(function (m, i) { txt(x, m, W / 2, 104 + i * 50, "500 24px " + FONT.ui, "#e8e2d2", "center", 210); }); } });
    });
    Object.keys(BS).forEach(function (id) { var s = BS[id];
      L.push({ k: "bar_" + id, w: 512, h: 640, d: function (x, W, H) { x.fillStyle = "#183a26"; x.fillRect(0, 0, W, H); noise(x, W, H, 2500, 0.04, 8); x.strokeStyle = "#c8a46a"; x.lineWidth = 14; x.strokeRect(7, 7, W - 14, H - 14); txt(x, s[0], W / 2, 150, "400 92px " + FONT.cond, "#f5f1e6", "center", 440, 2); txt(x, s[1], W / 2, 260, "400 92px " + FONT.cond, "#f5f1e6", "center", 440, 2); txt(x, s[2], W / 2, 370, "400 " + (s[2].length > 12 ? 40 : 92) + "px " + FONT.cond, "#f5f1e6", "center", 440, 2); peaks(x, W / 2, 500, 70, "#f5f1e6"); } });
      L.push({ k: "fascia_" + id, w: 1024, h: 160, d: function (x, W, H) { x.fillStyle = "#2b1d12"; x.fillRect(0, 0, W, H); noise(x, W, H, 1500, 0.04, 9); var nm = id === "goodtech" ? "THE PERGOLA BAR" : id === "mesquite" ? "THE MESQUITE BAR" : "BAR CART"; txt(x, nm, W / 2, H * 0.52, "400 96px " + FONT.cond, "#f4cd5a", "center", 940, 6); } });
    });
    ["v", "g"].forEach(function (c) { L.push({ k: "banner_" + c, w: 256, h: 1024, d: function (x, W, H) { var g = x.createLinearGradient(0, 0, 0, H); if (c === "v") { g.addColorStop(0, "#3b2470"); g.addColorStop(1, "#5c3aa3"); } else { g.addColorStop(0, "#14532d"); g.addColorStop(1, "#22803f"); } x.fillStyle = g; x.fillRect(0, 0, W, H); noise(x, W, H, 2000, 0.03, 11);
        peaks(x, W / 2, 150, 70, "#f5f1e6"); txt(x, "SOLPORT", W / 2, 300, "400 74px " + FONT.cond, "#f5f1e6", "center", 220, 4); txt(x, "SUMMIT", W / 2, 380, "400 74px " + FONT.cond, "#f5f1e6", "center", 220, 4); x.fillStyle = "#f4cd5a"; x.fillRect(W / 2 - 50, 440, 100, 5);
        ["BUILD", "CONNECT", "GIVE", "TOGETHER"].forEach(function (w, i) { txt(x, w, W / 2, 520 + i * 70, "600 34px " + FONT.ui, "#e9e4f6", "center", 220, 3); }); txt(x, "SOLPORT CONVENTION CENTER", W / 2, 930, "600 15px " + FONT.mono, "#f5f1e6", "center", 230, 2); } }); });
    WF.forEach(function (wf, i) { [["f", wf.face || 0], ["b", (wf.face || 0) + PI]].forEach(function (fc) { L.push({ k: "way_" + i + "_" + fc[0], w: 512, h: 384, d: function (x, W, H) { x.fillStyle = "#24170e"; x.fillRect(0, 0, W, H); noise(x, W, H, 1500, 0.04, 13 + i); x.fillStyle = "#4DDE6F"; x.fillRect(0, 0, W, 10);
        (wf.lines || []).forEach(function (ln, j) { var y = 80 + j * 110; x.fillStyle = "rgba(255,255,255,0.06)"; x.fillRect(16, y - 44, W - 32, 88); txt(x, ln[0], 120, y, "500 34px " + FONT.ui, "#f5f1e6", "left", 370); arrow(x, 62, y, dirAngle(ln[1], fc[1]), 26, "#f4cd5a"); }); } }); }); });
    L.push({ k: "info", w: 768, h: 384, d: function (x, W, H) { x.fillStyle = "#24170e"; x.fillRect(0, 0, W, H); noise(x, W, H, 2000, 0.04, 17); x.fillStyle = "#4DDE6F"; x.fillRect(0, H - 14, W, 14); peaks(x, 120, 150, 60, "#f4cd5a"); txt(x, "THE FESTIVAL GROUNDS", 450, 120, "400 64px " + FONT.cond, "#f5f1e6", "center", 520, 3); txt(x, "SOLPORT CONVENTION CENTER", 450, 200, "600 26px " + FONT.mono, "#f4cd5a", "center", 520, 4); txt(x, "Press E for the guide", 450, 290, "italic 400 34px " + FONT.serif, "#e8e2d2", "center", 520); } });
    L.push({ k: "shuttle", w: 512, h: 256, d: function (x, W, H) { x.fillStyle = "#0f2a1a"; x.fillRect(0, 0, W, H); x.fillStyle = "#4DDE6F"; x.fillRect(0, 0, W, 12); txt(x, "SHUTTLE", W / 2, 82, "400 84px " + FONT.cond, "#f5f1e6", "center", 460, 6); txt(x, "CONVENTION CENTER DROP-OFF", W / 2, 160, "600 24px " + FONT.mono, "#f4cd5a", "center", 470, 2); txt(x, "Grand Loop · Terminal Drive", W / 2, 212, "500 24px " + FONT.ui, "#e8e2d2", "center", 470); } });
    [["LANDFILL", "#1c1f24"], ["RECYCLE", "#2b5aa8"], ["COMPOST", "#2f7a3e"]].forEach(function (b, i) { L.push({ k: "bin_" + i, w: 128, h: 128, d: function (x, W, H) { x.fillStyle = b[1]; x.fillRect(0, 0, W, H); x.strokeStyle = "#f5f1e6"; x.lineWidth = 5; x.beginPath(); x.arc(W / 2, 50, 24, 0, TAU); x.stroke(); txt(x, b[0], W / 2, 100, "700 20px " + FONT.ui, "#f5f1e6", "center", 120, 1); } }); });
    L.push({ k: "booth", w: 768, h: 256, d: function (x, W, H) { x.fillStyle = "#08100b"; x.fillRect(0, 0, W, H); x.strokeStyle = "#4DDE6F"; x.lineWidth = 8; x.strokeRect(10, 10, W - 20, H - 20); peaks(x, 120, 128, 56, "#4DDE6F"); txt(x, "SOLPORT SUMMIT", 450, 110, "400 76px " + FONT.cond, "#4DDE6F", "center", 520, 5); txt(x, "THE SIDE STAGE", 450, 182, "600 26px " + FONT.mono, "#f4cd5a", "center", 520, 6); } });
    L.push({ k: "stagefascia", w: 1536, h: 160, d: function (x, W, H) { x.fillStyle = "#0c0d0e"; x.fillRect(0, 0, W, H); txt(x, "SOLPORT SUMMIT  ·  THE SIDE STAGE  ·  SOLPORT CONVENTION CENTER", W / 2, H / 2, "400 74px " + FONT.cond, "#f5f1e6", "center", 1480, 4); } });
        return L;
  }
  // the arrow for a world direction (N, S, E, W) on a sign whose face points along yaw "face": the reader looks the other way
  function dirAngle(d, face) { var D = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[d] || [0, -1]; var fx = -Math.sin(face), fz = -Math.cos(face), rx = Math.cos(face), rz = -Math.sin(face); var f = D[0] * fx + D[1] * fz, r = D[0] * rx + D[1] * rz; return Math.abs(f) >= Math.abs(r) ? (f >= 0 ? 0 : PI) : (r > 0 ? PI / 2 : -PI / 2); }
  function arrow(x, cx, cy, rot, s, col) { x.save(); x.translate(cx, cy); x.rotate(rot); x.fillStyle = col; x.beginPath(); x.moveTo(0, -s); x.lineTo(s * 0.85, 0); x.lineTo(s * 0.32, 0); x.lineTo(s * 0.32, s); x.lineTo(-s * 0.32, s); x.lineTo(-s * 0.32, 0); x.lineTo(-s * 0.85, 0); x.closePath(); x.fill(); x.restore(); }
  var SCALE = { side: 0.7, back: 0.6, menu: 0.7, bar: 0.62, fascia: 0.72, banner: 0.66, way: 0.6, info: 0.7, shuttle: 0.7, booth: 0.72, stagefascia: 0.8, bin: 0.9 };
  function pack(L) { L.forEach(function (r) { r.s = SCALE[r.k.split("_")[0]] || 1; r.pw = Math.ceil(r.w * r.s); r.ph = Math.ceil(r.h * r.s); }); var s = L.slice().sort(function (a, b) { return b.ph - a.ph; }), x = 2, y = 2, rowH = 0; s.forEach(function (r) { if (x + r.pw + 2 > ATLAS_W) { x = 2; y += rowH + 4; rowH = 0; } r.x = x; r.y = y; x += r.pw + 4; rowH = Math.max(rowH, r.ph); }); if (y + rowH > ATLAS_H) note("atlas", "overflow " + (y + rowH)); FE.n.atlasH = y + rowH; return s; }
  function redrawAtlas() { var A = FE.atlas; if (!A) return; var x = A.cv.getContext("2d"); A.list.forEach(function (r) { x.save(); x.beginPath(); x.rect(r.x, r.y, r.pw, r.ph); x.clip(); x.translate(r.x, r.y); x.scale(r.s, r.s); try { r.d(x, r.w, r.h); } catch (e) { note("draw " + r.k, e); } x.restore(); }); A.tex.needsUpdate = true; }
  function atlasTex() {
    if (FE.atlas) return FE.atlas.tex; var cv = document.createElement("canvas"); cv.width = ATLAS_W; cv.height = ATLAS_H; var list = pack(regions());
    list.forEach(function (r) { REG[r.k] = [r.x + 1, r.y + 1, r.x + r.pw - 1, r.y + r.ph - 1]; });
    var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; try { t.anisotropy = Math.min(8, MAX_ANISO); } catch (e) {} t.generateMipmaps = true;
    FE.atlas = { cv: cv, tex: t, list: list }; redrawAtlas();
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { setTimeout(function () { redrawAtlas(); redrawBoard(true); redrawScreen(true); }, 300); }); } catch (e) {}
    return t;
  }

  // ───────────────────────── the event schedule (plan/festival.json "schedule"): boards, the LED screen, the HUD toast ─────────────────────────
  function hhmm(h) { h = ((h % 24) + 24) % 24; var H = Math.floor(h), M = Math.round((h - H) * 60); if (M === 60) { H = (H + 1) % 24; M = 0; } return (H < 10 ? "0" : "") + H + ":" + (M < 10 ? "0" : "") + M; }
  function sched() { return C("schedule", []) || []; }
  function eventAt(h) { var S = sched(); for (var i = 0; i < S.length; i++) if (h >= S[i].start && h < S[i].end) return S[i]; return null; }
  function nextEvent(h) { var S = sched(), best = null, bd = 1e9; S.forEach(function (e) { var d = ((e.start - h) % 24 + 24) % 24; if (d > 0.001 && d < bd) { bd = d; best = e; } }); return best; }
  // crowd level per zone at hour h: the event's levels, eased in over the first and out over the last 20 in-game minutes
  var ZONES = ["stage", "bars", "trucks", "picnic", "lawn"];
  function levels(h) { var q = C("quiet.crowd", {}), out = {}; ZONES.forEach(function (z) { out[z] = q[z] || 0; }); sched().forEach(function (e) { var k = Math.min(sstep(e.start - 0.15, e.start + 0.2, h), 1 - sstep(e.end - 0.2, e.end + 0.15, h)); if (k <= 0) return; ZONES.forEach(function (z) { var v = (e.crowd && e.crowd[z]) || 0; out[z] = Math.max(out[z], lerp(out[z], v, k)); }); }); return out; }
  FE.sched = { eventAt: eventAt, nextEvent: nextEvent, levels: levels, hhmm: hhmm };

  var BOARD = FE.board || (FE.board = { cv: null, tex: null, key: "" });
  function boardTex() { if (BOARD.tex) return BOARD.tex; var cv = document.createElement("canvas"); cv.width = 1024; cv.height = 1280; BOARD.cv = cv; var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; BOARD.tex = t; redrawBoard(true); return t; }
  function redrawBoard(force) {
    if (!BOARD.cv) return; var h = hourNow(), ev = eventAt(h), key = ev ? ev.id : "quiet"; if (!force && key === BOARD.key) return; BOARD.key = key;
    var x = BOARD.cv.getContext("2d"), W = 1024, H = 1280; x.fillStyle = "#0b120d"; x.fillRect(0, 0, W, H); noise(x, W, H, 3000, 0.02, 31);
    x.fillStyle = "#4DDE6F"; x.fillRect(0, 0, W, 16); peaks(x, 120, 116, 58, "#4DDE6F");
    txt(x, C("names.summit", "Solport Summit").toUpperCase(), 560, 92, "400 92px " + FONT.cond, "#f5f1e6", "center", 760, 6); txt(x, "TODAY ON CAMPUS", 560, 168, "600 30px " + FONT.mono, "#f4cd5a", "center", 760, 8);
    var S = sched(), y = 250, rowH = Math.min(132, Math.floor(880 / Math.max(1, S.length)));
    S.forEach(function (e) { var now = ev && e.id === ev.id, past = !now && h >= e.end && h < 23.99; if (now) { x.fillStyle = "rgba(77,222,111,0.16)"; rrect(x, 30, y, W - 60, rowH - 10, 14); x.fill(); x.strokeStyle = "#4DDE6F"; x.lineWidth = 4; x.stroke(); }
      var a = past ? "rgba(245,241,230,0.42)" : "#f5f1e6"; txt(x, hhmm(e.start) + "  to  " + hhmm(e.end), 64, y + rowH * 0.3, "600 28px " + FONT.mono, now ? "#4DDE6F" : past ? "rgba(244,205,90,0.45)" : "#f4cd5a", "left", 420);
      txt(x, e.name, 64, y + rowH * 0.62, "500 44px " + FONT.ui, a, "left", now ? 700 : 900); if (now) { x.fillStyle = "#4DDE6F"; rrect(x, W - 190, y + rowH * 0.5 - 26, 130, 52, 26); x.fill(); txt(x, "NOW", W - 125, y + rowH * 0.5, "400 34px " + FONT.cond, "#0b120d", "center", 120, 4); }
      txt(x, e.where, W - 64, y + rowH * 0.3, "500 24px " + FONT.ui, past ? "rgba(232,226,210,0.4)" : "#cfc8b6", "right", 360); y += rowH; });
    x.fillStyle = "#4DDE6F"; x.fillRect(0, H - 80, W, 2); txt(x, "SOLPORT CONVENTION CENTER  ·  FESTIVAL GROUNDS", W / 2, H - 42, "600 24px " + FONT.mono, "#cfc8b6", "center", 960, 4);
    BOARD.tex.needsUpdate = true; FE.n.boardDraws = (FE.n.boardDraws || 0) + 1;
  }
  var SCR = FE.scr || (FE.scr = { cv: null, tex: null, key: "" });
  function screenTex() { if (SCR.tex) return SCR.tex; var cv = document.createElement("canvas"); cv.width = 1024; cv.height = 576; SCR.cv = cv; var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; SCR.tex = t; redrawScreen(true); return t; }
  function redrawScreen(force) {
    if (!SCR.cv) return; var ev = eventAt(hourNow()); var line = ev ? ev.screen : C("quiet.screen", "SOLPORT SUMMIT"); if (!force && line === SCR.key) return; SCR.key = line;
    var x = SCR.cv.getContext("2d"), W = 1024, H = 576; x.clearRect(0, 0, W, H);
    peaks(x, W / 2, 120, 64, "rgba(245,241,230,0.95)"); txt(x, C("names.summit", "Solport Summit").toUpperCase(), W / 2, 210, "600 30px " + FONT.mono, "rgba(244,205,90,0.95)", "center", 900, 10);
    var big = line.length > 18 ? 84 : 112; x.shadowColor = "rgba(0,0,0,0.6)"; x.shadowBlur = 18; txt(x, line, W / 2, 320, "400 " + big + "px " + FONT.cond, "#ffffff", "center", 940, 4); x.shadowBlur = 0;
    txt(x, "IDEAS  ·  BUILD  ·  WHAT'S NEXT", W / 2, 430, "500 32px " + FONT.ui, "rgba(233,239,230,0.9)", "center", 900, 6);
    SCR.tex.needsUpdate = true;
  }
  // the HUD toast near the campus: on arrival, and when the next event starts while you are here
  var TOAST = FE.toast || (FE.toast = { el: null, key: "", at: 0, hideAt: 0, near: false });
  function toastEl() { if (TOAST.el) return TOAST.el; try { var st = document.createElement("style"); st.textContent = "#fest-toast{position:fixed;left:50%;top:170px;transform:translate(-50%,-12px);min-width:300px;max-width:560px;padding:10px 18px 11px;background:rgba(8,13,8,0.86);border:1px solid rgba(77,222,111,0.55);border-radius:12px;color:#f5f1e6;font:500 14px 'Space Grotesk',system-ui,sans-serif;text-align:center;pointer-events:none;opacity:0;transition:opacity .45s,transform .45s;z-index:7;box-shadow:0 8px 28px rgba(0,0,0,0.35)}#fest-toast.on{opacity:1;transform:translate(-50%,0)}#fest-toast .k{font:600 11px 'JetBrains Mono',monospace;letter-spacing:3px;color:#4DDE6F}#fest-toast .t{font:400 24px 'Anton','Arial Narrow',sans-serif;letter-spacing:1px;margin:3px 0 2px}#fest-toast .p{color:#cfc8b6;font-size:13px}body.photo #fest-toast{display:none!important}"; document.head.appendChild(st);
      var el = document.createElement("div"); el.id = "fest-toast"; el.className = "hud"; el.innerHTML = "<div class='k'></div><div class='t'></div><div class='p'></div>"; document.body.appendChild(el); TOAST.el = el; } catch (e) { note("toast el", e); } return TOAST.el; }
  function showToast(k, t, p) { var el = toastEl(); if (!el) return; el.querySelector(".k").textContent = k; el.querySelector(".t").textContent = t; el.querySelector(".p").textContent = p || ""; el.classList.add("on"); TOAST.hideAt = nowMs() + 7000; FE.n.toasts = (FE.n.toasts || 0) + 1; }
  function toastFrame() {
    var cam = player ? player.position : camera.position; var CC = C("site.bounds", [-245, -165, -132, -30]); var cx = (CC[0] + CC[2]) / 2 - 60, cz = (CC[1] + CC[3]) / 2;
    var near = Math.hypot(cam.x - cx, cam.z - cz) < 260; var h = hourNow(), ev = eventAt(h), key = ev ? ev.id : "quiet", T = C("toast", {});
    if (near && (!TOAST.near || key !== TOAST.key) && !(typeof inside !== "undefined" && inside)) { TOAST.key = key; var nx = nextEvent(h);
      if (ev) showToast((T.kicker || "SOLPORT SUMMIT") + " · " + (T.now || "Now").toUpperCase(), ev.name, ev.where + " · " + (T.until || "until") + " " + hhmm(ev.end) + (nx ? "  ·  " + (T.next || "Next") + ": " + nx.name + " " + hhmm(nx.start) : ""));
      else if (nx) showToast((T.kicker || "SOLPORT SUMMIT") + " · " + (T.next || "Next").toUpperCase(), nx.name, nx.where + " · " + (T.from || "from") + " " + hhmm(nx.start)); }
    TOAST.near = near; if (TOAST.el && TOAST.hideAt && nowMs() > TOAST.hideAt) { TOAST.el.classList.remove("on"); TOAST.hideAt = 0; }
  }

  // ───────────────────────── surfaces draped on the terrain (lawn, plaza, dance floor, drop-off, planting beds) ─────────────────────────
  function inPoly(poly, x, z) { var c = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  function smoothClosed(pts, per) { var out = [], n = pts.length; for (var i = 0; i < n; i++) { var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n]; for (var k = 0; k < per; k++) { var t = k / per, t2 = t * t, t3 = t2 * t; var f = function (a, b, c, d) { return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); }; out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]); } } return out; }
  function circlePoly(cx, cz, r, n, wob, seed) { var R = rng(seed || 7), out = []; for (var i = 0; i < n; i++) { var a = i / n * TAU, rr = r * (1 + (R() - 0.5) * (wob || 0)); out.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]); } return out; }
  function rectPoly(x0, z0, x1, z1, r) { if (!r) return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; var out = []; [[x1 - r, z0 + r, -PI / 2], [x1 - r, z1 - r, 0], [x0 + r, z1 - r, PI / 2], [x0 + r, z0 + r, PI]].forEach(function (c) { for (var k = 0; k <= 4; k++) { var a = c[2] + k / 4 * PI / 2; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); } }); return out; }
  // Sutherland-Hodgman: the subject polygon clipped to one axis-aligned cell (a convex window)
  function clipCell(poly, x0, z0, x1, z1) { var out = poly; var edges = [[0, x0, 1], [0, x1, -1], [1, z0, 1], [1, z1, -1]];
    for (var e = 0; e < 4 && out.length; e++) { var ax = edges[e][0], v = edges[e][1], sd = edges[e][2], inp = out; out = []; for (var i = 0; i < inp.length; i++) { var P = inp[i], Q = inp[(i + 1) % inp.length]; var pin = (P[ax] - v) * sd >= 0, qin = (Q[ax] - v) * sd >= 0; if (pin) out.push(P); if (pin !== qin) { var t = (v - P[ax]) / (Q[ax] - P[ax]); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); } } }
    return out; }
  function drape(K, base, poly, cell, lift, tile, holes) {
    var bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9; poly.forEach(function (p) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); bz0 = Math.min(bz0, p[1]); bz1 = Math.max(bz1, p[1]); });
    var P = [], N = [], UV = []; var hN = function (x, z) { var e = 0.8; var dx = gh(x - e, z) - gh(x + e, z), dz = gh(x, z - e) - gh(x, z + e); var L = Math.hypot(dx, 2 * e, dz); return [dx / L, 2 * e / L, dz / L]; };
    var vtx = function (q) { var y = gh(q[0], q[1]) + lift; P.push(q[0], y, q[1]); var n = hN(q[0], q[1]); N.push(n[0], n[1], n[2]); UV.push(q[0] / tile, -q[1] / tile); };
    for (var x = Math.floor(bx0 / cell) * cell; x < bx1; x += cell) for (var z = Math.floor(bz0 / cell) * cell; z < bz1; z += cell) {
      var pc = clipCell(poly, x, z, x + cell, z + cell); if (pc.length < 3) continue; if (holes && holes.some(function (h) { return inPoly(h, x + cell / 2, z + cell / 2); })) continue;
      var tri = THREE.ShapeUtils.triangulateShape(pc.map(function (q) { return new THREE.Vector2(q[0], q[1]); }), []);
      tri.forEach(function (t) { var a = pc[t[0]], b = pc[t[1]], c = pc[t[2]]; var cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); if (Math.abs(cr) < 1e-6) return; if (cr > 0) { vtx(a); vtx(c); vtx(b); } else { vtx(a); vtx(b); vtx(c); } }); }
    if (!P.length) return null; var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); return K.push(base, g, 0xffffff, PM_PAINT);
  }

  // ───────────────────────── solids: collision boxes and seats (the client's SOLIDS) ─────────────────────────
  var SOL = FE.sol = FE.sol || [];
  function sol(x, z, ry, w, d, y0, y1, seat, face) { try { var sd = addSolid(x, z, ry || 0, w, d, y0, y1, "fest"); if (!sd) return null; if (seat) { sd.seat = true; sd.face = face; sd.fest = true; } SOL.push(sd); return sd; } catch (e) { note("solid", e); return null; } }
  function solF(F, lx, lz, w, d, y0, y1, seat, faceL) { var p = F.w(lx, lz); return sol(p[0], p[1], F.yaw, w, d, F.y + y0, F.y + y1, seat, seat ? F.yaw + (faceL || 0) : undefined); }

  // ───────────────────────── props: the stage, bars, food trucks, picnic tables, umbrellas, poles, drapes, string lights, fire bowls ─────────────────────────
  var COL = { timber: 0x8a6440, timberD: 0x5e4129, timberL: 0xb48a5c, black: 0x161719, steel: 0xa9b0b6, dark: 0x26282b, white: 0xf3f0e8, stone: 0x2c2a27, vine: 0x2f5a1f, vine2: 0x456f2a, bulb: 0xffd6a0, concrete: 0xc9c3b6 };
  function V(x, y, z) { return new THREE.Vector3(x, y, z); }
  // a pool of warm light on the ground: a strip between two points or a disc, alpha falling to the edges, laid on the terrain
  function glowStrip(KG, ax, az, bx, bz, w, col, k) { if (!KG) return; var L = Math.hypot(bx - ax, bz - az); if (L < 0.5) return; var ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux, na = Math.max(4, Math.round(L / 2.5)), lanes = [-1, -0.6, -0.25, 0, 0.25, 0.6, 1], P = [], A = [];
    var pt = function (t, s) { var x = ax + ux * L * t + nx * s * w / 2, z = az + uz * L * t + nz * s * w / 2; return [x, gh(x, z) + 0.2, z, k * Math.pow(1 - Math.abs(s), 1.15) * Math.min(1, Math.min(t, 1 - t) * 5 + 0.3)]; };
    for (var i = 0; i < na; i++) for (var j = 0; j < lanes.length - 1; j++) { var a = pt(i / na, lanes[j]), b = pt((i + 1) / na, lanes[j]), c = pt((i + 1) / na, lanes[j + 1]), d = pt(i / na, lanes[j + 1]); [a, c, b, a, d, c].forEach(function (q) { P.push(q[0], q[1], q[2]); A.push(q[3]); }); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("aGl", new THREE.Float32BufferAttribute(A, 1)); g.computeVertexNormals(); KG.push("glow", g, col, PM_EMIT); }
  function glowDisc(KG, cx, cz, r, col, k) { if (!KG) return; var P = [], A = [], seg = 20, rings = [0, 0.35, 0.7, 1]; var pt = function (a, rr) { var x = cx + Math.cos(a) * r * rr, z = cz + Math.sin(a) * r * rr; return [x, gh(x, z) + 0.21, z, k * Math.pow(1 - rr, 1.5)]; };
    for (var i = 0; i < seg; i++) for (var j = 0; j < rings.length - 1; j++) { var a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU; var p = [pt(a0, rings[j]), pt(a1, rings[j]), pt(a1, rings[j + 1]), pt(a0, rings[j + 1])]; [p[0], p[2], p[1], p[0], p[3], p[2]].forEach(function (q) { P.push(q[0], q[1], q[2]); A.push(q[3]); }); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("aGl", new THREE.Float32BufferAttribute(A, 1)); g.computeVertexNormals(); KG.push("glow", g, col, PM_EMIT); }
  // a box truss (four chords, zig-zag lacing on every face) from A to B in the frame's local space
  function truss(F, A, B, s) {
    var d = new THREE.Vector3().subVectors(B, A), L = d.length(); d.normalize(); var up = Math.abs(d.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0); var e1 = new THREE.Vector3().crossVectors(d, up).normalize(), e2 = new THREE.Vector3().crossVectors(e1, d).normalize(); var h = s / 2;
    var cs = [[h, h], [h, -h], [-h, -h], [-h, h]], c = function (k, t) { return A.clone().addScaledVector(d, t).addScaledVector(e1, cs[k][0]).addScaledVector(e2, cs[k][1]); };
    for (var k = 0; k < 4; k++) { var g = tubeG(c(k, 0), c(k, L), 0.026, 6); if (g) F.geo("std", COL.steel, g, 0, 0, 0, 0, 0, 0, 1, 1, 1, PM_STEEL); }
    var n = Math.max(1, Math.round(L / s)); for (var i = 0; i < n; i++) { var t0 = i * L / n, t1 = (i + 1) * L / n; for (var f = 0; f < 4; f++) { var a = f, b = (f + 1) % 4; var g2 = tubeG(c(a, i % 2 ? t1 : t0), c(b, i % 2 ? t0 : t1), 0.013, 4); if (g2) F.geo("std", COL.steel, g2, 0, 0, 0, 0, 0, 0, 1, 1, 1, PM_STEEL); } }
  }
  function stage(K, st) {
    var f = st.face, yaw = Math.atan2(f[0], f[1]); var cs = [[-7, -4], [7, -4], [7, 4], [-7, 4]].map(function (q) { var c = Math.cos(yaw), s = Math.sin(yaw); return gh(st.x + q[0] * c + q[1] * s, st.z - q[0] * s + q[1] * c); });
    var gy = Math.max.apply(null, cs); var F = new Fr(K, st.x, gy, st.z, yaw), H = st.h || 1.2, W = st.w || 14, D = st.d || 8; FE.stageF = F;
    F.box("std", 0x1b1c1e, W, 0.22, D, 0, H - 0.11, 0, 0, 0, 0, [0.55, 0.1, 0]); F.box("std", 0x111213, W - 0.1, H + 0.6, D - 0.1, 0, (H - 0.6) / 2 - 0.05, 0, 0, 0, 0, [0.95, 0, 0]);
    F.box("std", 0x4dde6f, W, 0.05, 0.04, 0, H - 0.04, D / 2 + 0.02, 0, 0, 0, PM_EMIT);
    for (var i = 0; i < 4; i++) F.box("std", 0x1b1c1e, 1.6, 0.2, 0.32, W / 2 - 1.4, 0.15 + i * 0.27, -D / 2 - 0.3 - (3 - i) * 0.3, 0, 0, 0, [0.6, 0.1, 0]);
    var Th = 8.6, lx = W / 2 + 0.6, lz = D / 2 + 0.4;
    [[-lx, -lz], [lx, -lz], [lx, lz], [-lx, lz]].forEach(function (p) { truss(F, V(p[0], -0.1, p[1]), V(p[0], Th, p[1]), 0.4); F.box("std", COL.black, 0.8, 0.12, 0.8, p[0], 0.0, p[1], 0, 0, 0, [0.6, 0.2, 0]); });
    truss(F, V(-lx, Th, lz), V(lx, Th, lz), 0.4); truss(F, V(-lx, Th, -lz), V(lx, Th, -lz), 0.4); truss(F, V(-lx, Th, -lz), V(-lx, Th, lz), 0.4); truss(F, V(lx, Th, -lz), V(lx, Th, lz), 0.4); truss(F, V(-lx, Th - 2.6, lz), V(lx, Th - 2.6, lz), 0.3);
    F.box("std", 0x101112, W + 1.6, 0.06, D - 1.0, 0, Th + 0.28, -0.6, 0, 0, 0, [0.85, 0, 0]);
    F.aquad(REG.stagefascia, W + 0.8, (W + 0.8) * 160 / 1536, 0, Th - 0.55, lz + 0.24, 0, 0.7);
    // the LED wall and two side towers (the screen shader), black frames
    var sw = 9.6, sh2 = 5.4, sy = H + 0.6 + sh2 / 2; F.box("std", 0x0d0e0f, sw + 0.3, sh2 + 0.3, 0.3, 0, sy, -D / 2 + 0.25, 0, 0, 0, [0.6, 0.2, 0]);
    var scr = new THREE.PlaneGeometry(sw, sh2); F.geo("screen", 0xffffff, scr, 0, sy, -D / 2 + 0.41);
    [-1, 1].forEach(function (sd) { var g = new THREE.PlaneGeometry(1.7, 4.6); var uv = g.attributes.uv; for (var k = 0; k < uv.count; k++) uv.setXY(k, (sd < 0 ? 0.0 : 0.88) + uv.getX(k) * 0.12, uv.getY(k)); F.geo("screen", 0xffffff, g, sd * 6.0, H + 0.6 + 2.3, -D / 2 + 1.0, -sd * 0.28); F.box("std", 0x0d0e0f, 1.85, 4.8, 0.25, sd * 6.05, H + 0.6 + 2.3, -D / 2 + 0.84, -sd * 0.28, 0, 0, [0.6, 0.2, 0]); });
    // line arrays and subs, the DJ booth, par cans on the front truss, moving heads at the back
    [-1, 1].forEach(function (sd) { for (var k = 0; k < 6; k++) F.box("std", 0x131415, 0.75, 0.32, 0.55, sd * (W / 2 - 0.2), Th - 0.6 - k * 0.34, lz - 0.1 + k * 0.04, 0, -0.04 * k, 0, [0.7, 0.1, 0]);
      F.box("std", 0x131415, 1.1, 0.85, 0.85, sd * (W / 2 - 0.8), H + 0.43, D / 2 - 0.6, 0, 0, 0, [0.8, 0.05, 0]); F.box("std", 0x2a2c2f, 0.9, 0.6, 0.02, sd * (W / 2 - 0.8), H + 0.45, D / 2 - 0.17, 0, 0, 0, [0.9, 0, 0]);
      F.box("std", 0x131415, 0.7, 0.35, 0.5, sd * 2.6, H + 0.17, D / 2 - 0.6, 0, -0.5, 0, [0.8, 0.05, 0]); });
    F.box("std", 0x0f1011, 3.4, 1.05, 1.0, 0, H + 0.53, 0.8, 0, 0, 0, [0.6, 0.1, 0]); F.aquad(REG.booth, 3.3, 1.1, 0, H + 0.55, 1.31, 0, 1.0);
    F.box("std", 0x1c1d20, 3.6, 0.06, 1.1, 0, H + 1.08, 0.8, 0, 0, 0, [0.4, 0.4, 0]); [-0.95, 0.95].forEach(function (x) { F.cyl("std", 0x222326, 0.17, 0.17, 0.04, x, H + 1.13, 0.75, 20, [0.3, 0.6, 0]); F.cyl("std", 0x4dde6f, 0.05, 0.05, 0.045, x, H + 1.135, 0.75, 10, PM_EMIT_H); });
    F.box("std", 0x1a1b1d, 0.6, 0.05, 0.4, 0, H + 1.12, 0.75, 0, 0, 0, [0.4, 0.3, 0]); F.box("std", 0x9fe8b4, 0.38, 0.24, 0.01, 0.0, H + 1.28, 0.55, 0, -0.35, 0, PM_EMIT);
    var parC = [0x7b4fd6, 0x4dde6f, 0xf4cd5a, 0x7b4fd6, 0x4dde6f, 0xf4cd5a, 0x7b4fd6, 0x4dde6f, 0xf4cd5a, 0x7b4fd6];
    var KB = FE.KB; for (var bp = 0; bp < 10 && KB; bp++) { var bx = -lx + 1.2 + bp * (2 * lx - 2.4) / 9; var A = V(bx, Th - 0.6, lz + 0.1), Bt = V(bx * 1.4 + (bp % 2 ? 3 : -3), 0.2, lz + 7 + (bp % 3) * 3.5); var L = A.distanceTo(Bt); var cg = new THREE.ConeGeometry(1.5, L, 14, 1, true); cg.translate(0, -L / 2, 0); var bm = new Float32Array(cg.attributes.position.count * 2); for (var vi = 0; vi < cg.attributes.position.count; vi++) { bm[vi * 2] = clamp(-cg.attributes.position.getY(vi) / L, 0, 1); bm[vi * 2 + 1] = bp * 1.9; } cg.setAttribute("aBm", new THREE.BufferAttribute(bm, 2)); _q.setFromUnitVectors(V(0, -1, 0), new THREE.Vector3().subVectors(Bt, A).normalize()); cg.applyQuaternion(_q); cg.translate(A.x, A.y, A.z); var bf = new Fr(KB, F.x, F.y, F.z, F.yaw); bf.geo("beam", parC[bp], cg, 0, 0, 0); }
    for (var p = 0; p < 10; p++) { var px = -lx + 1.2 + p * (2 * lx - 2.4) / 9; F.cyl("std", 0x101112, 0.13, 0.11, 0.32, px, Th - 0.45, lz - 0.05, 10, [0.5, 0.3, 0], -0.6); F.cyl("std", parC[p], 0.1, 0.1, 0.02, px, Th - 0.58, lz + 0.05, 10, PM_EMIT, -0.6); }
    for (var mh = 0; mh < 4; mh++) { var mx = -4.5 + mh * 3; F.box("std", 0x111213, 0.45, 0.25, 0.35, mx, H + 0.12, -D / 2 + 1.5, 0, 0, 0, [0.6, 0.2, 0]); F.sph("std", 0x18191b, 0.22, mx, H + 0.48, -D / 2 + 1.5, 10, 1, [0.4, 0.3, 0]); F.cyl("std", parC[mh + 1], 0.1, 0.1, 0.02, mx, H + 0.55, -D / 2 + 1.68, 10, PM_EMIT, 1.2); }
    // banners on the front legs
    [-1, 1].forEach(function (sd, i) { F.aquad(REG[i ? "banner_g" : "banner_v"], 1.1, 4.4, sd * (lx + 0.3), 4.6, lz + 0.05, 0, 0.35); F.aquad(REG[i ? "banner_g" : "banner_v"], 1.1, 4.4, sd * (lx + 0.3), 4.6, lz - 0.05, PI, 0.35); });
    solF(F, 0, 0, W, D, -0.6, H); [[-lx, -lz], [lx, -lz], [lx, lz], [-lx, lz]].forEach(function (q) { solF(F, q[0], q[1], 0.6, 0.6, -0.2, Th); });
    for (var s2 = 0; s2 < 4; s2++) solF(F, W / 2 - 1.4, -D / 2 - 0.3 - (3 - s2) * 0.3, 1.6, 0.32, -0.3, 0.25 + s2 * 0.27);
    // the dance floor in front of the stage (travertine pavers, drawn with the surfaces)
    var dn = C("site.dance", { w: 22, d: 15, ahead: 13.5 }); var cx = st.x + f[0] * dn.ahead, cz = st.z + f[1] * dn.ahead; glowDisc(FE.KG, st.x + f[0] * 8, st.z + f[1] * 8, 11, 0x8a5cff, 0.3); glowDisc(FE.KG, st.x + f[0] * 13, st.z + f[1] * 13, 9, 0x3fdc77, 0.18); FE.dance = { x: cx, z: cz, w: dn.w, d: dn.d, yaw: yaw };
    return F;
  }
  function festoon(K, A, B, sag, step, wire) { var L = A.distanceTo(B), n = Math.max(6, Math.round(L / 1.2)), pts = []; for (var i = 0; i <= n; i++) { var t = i / n; var p = A.clone().lerp(B, t); p.y -= sag * 4 * t * (1 - t); pts.push(p); }
    var F0 = FE.F0; for (var j = 0; j < n; j++) { var g = tubeG(pts[j], pts[j + 1], wire || 0.009, 4); if (g) F0.geo("std", 0x1a1a1a, g, 0, 0, 0, 0, 0, 0, 1, 1, 1, [0.6, 0, 0]); }
    if (!wire && A.y - FE.F0.y > -1) glowStrip(FE.KG, A.x, A.z, B.x, B.z, 12, 0xffb766, 0.11);
    var nb = Math.max(2, Math.round(L / (step || 0.85))); for (var b = 1; b < nb; b++) { var t2 = b / nb; var q = A.clone().lerp(B, t2); q.y -= sag * 4 * t2 * (1 - t2) + 0.07; F0.sph("stdNS", COL.bulb, 0.055, q.x, q.y, q.z, 6, 1.25, PM_EMIT); FE.n.bulbs = (FE.n.bulbs || 0) + 1; } }
  function pergola(K, B) {
    var g0 = gh(B.x, B.z); var F = new Fr(K, B.x, g0, B.z, B.face), w = B.w, d = B.d, R = rng(Math.round(B.x * 7 - B.z)), small = !!B.small;
    if (small) return barCart(K, B, F);
    F.box("wood", COL.timberD, w + 2.0, 0.16, d + 2.2, 0, 0.0, 0.2, 0, 0, 0, null, 1.4);
    var ph = 3.3, posts = [[-w / 2, -d / 2], [0, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2 + 0.6], [0, d / 2 + 0.6], [w / 2, d / 2 + 0.6]];
    posts.forEach(function (p) { F.box("wood", COL.timberD, 0.24, ph, 0.24, p[0], ph / 2, p[1], 0, 0, 0, null, 1); solF(F, p[0], p[1], 0.3, 0.3, 0, ph); });
    [-d / 2, d / 2 + 0.6].forEach(function (z) { F.box("wood", COL.timber, w + 1.0, 0.32, 0.2, 0, ph + 0.1, z); });
    for (var r = 0; r <= Math.round((w + 0.8) / 0.55); r++) { var rx = -w / 2 - 0.4 + r * 0.55; F.box("wood", COL.timberL, 0.08, 0.22, d + 2.0, rx, ph + 0.37, 0.3); }
    for (var pu = 0; pu < 7; pu++) F.box("wood", COL.timberL, w + 1.0, 0.06, 0.06, 0, ph + 0.51, -d / 2 - 0.4 + pu * (d + 1.8) / 6);
    for (var v = 0; v < 60; v++) { var vx = -w / 2 + R() * w, vz = -d / 2 + R() * (d + 0.8); F.sph("std", R() < 0.5 ? COL.vine : COL.vine2, 0.1 + R() * 0.13, vx, ph + 0.48, vz, 6, 0.4, [0.95, 0, 0]); if (R() < 0.5) F.box("std", COL.vine, 0.05, 0.5 + R() * 0.9, 0.05, vx, ph - 0.1 - R() * 0.4, vz, 0, 0, 0, [0.95, 0, 0]); }
    [[-w / 2, d / 2 + 0.6], [w / 2, d / 2 + 0.6]].forEach(function (p, i) { for (var k = 0; k < 16; k++) F.sph("std", k % 2 ? COL.vine : COL.vine2, 0.1 + R() * 0.08, p[0] + (R() - 0.5) * 0.4, 0.3 + k * 0.19, p[1] + (R() - 0.5) * 0.4, 5, 1.3, [0.95, 0, 0]); });
    // counter (timber front, stone top, foot rail), back bar (shelves of lit bottles), taps and a cooler
    var cz = d / 2 - 0.35; F.box("wood", COL.timber, w - 0.6, 1.05, 0.14, 0, 0.6, cz + 0.3, 0, 0, 0, null, 0.9); for (var sl = 0; sl < 10; sl++) F.box("wood", COL.timberD, 0.05, 0.95, 0.04, -w / 2 + 0.5 + sl * (w - 1) / 9, 0.6, cz + 0.39);
    F.box("std", COL.stone, w - 0.3, 0.07, 0.75, 0, 1.15, cz + 0.05, 0, 0, 0, PM_SATIN); F.box("std", 0x3a2d22, w - 0.7, 0.9, 0.5, 0, 0.6, cz - 0.05, 0, 0, 0, [0.8, 0, 0]);
    var rail = tubeG(V(-w / 2 + 0.5, 0.25, cz + 0.5), V(w / 2 - 0.5, 0.25, cz + 0.5), 0.025, 8); if (rail) F.geo("std", 0xc9a86a, rail, 0, 0, 0, 0, 0, 0, 1, 1, 1, PM_CHROME);
    var bz = -d / 2 + 0.45; F.box("wood", COL.timberD, w - 1.2, 0.95, 0.55, 0, 0.5, bz); F.box("std", 0x2b2620, w - 1.2, 0.05, 0.6, 0, 1.0, bz, 0, 0, 0, PM_SATIN);
    for (var sh = 0; sh < 2; sh++) { F.box("wood", COL.timberL, w - 1.4, 0.05, 0.28, 0, 1.55 + sh * 0.5, bz - 0.1); F.box("std", 0xffc27a, w - 1.5, 0.02, 0.02, 0, 1.52 + sh * 0.5, bz + 0.03, 0, 0, 0, PM_EMIT);
      for (var bt = 0; bt < Math.round(w * 2.2); bt++) { var bx = -w / 2 + 0.9 + bt * (w - 1.8) / Math.round(w * 2.2); F.cyl("std", [0xb8742a, 0x2f6b3a, 0xcfd8d0, 0x7a2a2a][(bt + sh) % 4], 0.035, 0.04, 0.26 + (bt % 3) * 0.03, bx, 1.72 + sh * 0.5, bz - 0.1, 6, [0.08, 0.3, 0.35]); } }
    [-1.2, -0.6, 0, 0.6].forEach(function (x) { F.box("std", 0xc9ccd0, 0.06, 0.32, 0.06, x, 1.34, cz - 0.15, 0, 0, 0, PM_CHROME); }); F.box("std", 0xd9dde0, 1.0, 0.85, 0.6, w / 2 - 1.2, 0.48, bz + 0.55, 0, 0, 0, PM_STEEL);
    F.aquad(REG["fascia_" + B.sign], Math.min(5.4, w * 0.62), Math.min(5.4, w * 0.62) * 160 / 1024, 0, ph + 0.1, d / 2 + 0.71, 0, 0.6);
    // the chalk sign at the front corner, two barrels, stools with seats
    F.box("wood", COL.timberD, 0.1, 2.2, 0.1, -w / 2 - 0.9, 1.1, d / 2 + 1.2); F.box("wood", COL.timberD, 0.1, 2.2, 0.1, -w / 2 - 0.9 + 1.25, 1.1, d / 2 + 1.2); F.aquad(REG["bar_" + B.sign], 1.15, 1.44, -w / 2 - 0.9 + 0.625, 1.35, d / 2 + 1.26, 0, 0.25); F.aquad(REG["bar_" + B.sign], 1.15, 1.44, -w / 2 - 0.9 + 0.625, 1.35, d / 2 + 1.14, PI, 0.25);
    solF(F, -w / 2 - 0.9 + 0.62, d / 2 + 1.2, 1.4, 0.3, 0, 2.2);
    [[w / 2 + 0.9, d / 2 + 1.6], [-w / 2 + 0.6, d / 2 + 2.4]].forEach(function (p) { F.cyl("wood", COL.timber, 0.34, 0.3, 0.98, p[0], 0.49, p[1], 14); F.cyl("std", 0x3b3b3b, 0.355, 0.355, 0.05, p[0], 0.25, p[1], 14, PM_STEEL); F.cyl("std", 0x3b3b3b, 0.345, 0.345, 0.05, p[0], 0.75, p[1], 14, PM_STEEL); solF(F, p[0], p[1], 0.65, 0.65, 0, 0.98); });
    var ns = Math.max(3, Math.floor((w - 1.4) / 1.1)); for (var s = 0; s < ns; s++) { var sx = -w / 2 + 1.0 + s * (w - 2.0) / (ns - 1), sz = cz + 0.95; F.cyl("wood", COL.timberL, 0.19, 0.19, 0.06, sx, 0.76, sz, 14); [[0.12, 0.12], [-0.12, 0.12], [0.12, -0.12], [-0.12, -0.12]].forEach(function (q) { F.box("std", 0x2a2b2d, 0.03, 0.74, 0.03, sx + q[0], 0.37, sz + q[1], 0, q[1] * 0.4, -q[0] * 0.4, PM_STEEL); }); solF(F, sx, sz, 0.4, 0.4, 0.3, 0.76, true, PI); }
    solF(F, 0, cz, w - 0.3, 0.85, 0, 1.18); solF(F, 0, bz, w - 1.1, 0.6, 0, 1.0);
    // festoons under the rafters
    var c0 = F.w(-w / 2, -d / 2), c1 = F.w(w / 2, -d / 2), c2 = F.w(w / 2, d / 2 + 0.6), c3 = F.w(-w / 2, d / 2 + 0.6), yy = g0 + ph - 0.15;
    festoon(K, V(c0[0], yy, c0[1]), V(c2[0], yy, c2[1]), 0.4, 0.6); festoon(K, V(c1[0], yy, c1[1]), V(c3[0], yy, c3[1]), 0.4, 0.6); festoon(K, V(c3[0], yy, c3[1]), V(c2[0], yy, c2[1]), 0.3, 0.6);
    var lamp = F.w(0, 0); FE.lamps.push({ x: lamp[0], y: g0 + 2.6, z: lamp[1], c: 0xffc98a, k: 14, d: 16, tag: "bar" }); var gl2 = F.w(0, d / 2 + 1.5); glowDisc(FE.KG, gl2[0], gl2[1], 7.5, 0xffb060, 0.45);
    return F;
  }
  function barCart(K, B, F) {
    var w = B.w, d = B.d; F.box("wood", COL.timber, 2.6, 0.95, 1.1, 0, 0.75, 0, 0, 0, 0, null, 0.9); F.box("std", COL.stone, 2.8, 0.06, 1.25, 0, 1.25, 0, 0, 0, 0, PM_SATIN);
    [-1, 1].forEach(function (sd) { F.cyl("wood", COL.timberD, 0.55, 0.55, 0.08, sd * 0.9, 0.55, 0.62, 18, null, PI / 2); F.cyl("std", 0x2a2b2d, 0.08, 0.08, 0.14, sd * 0.9, 0.55, 0.62, 8, PM_STEEL, PI / 2); });
    [[-1.3, -0.6], [1.3, -0.6], [1.3, 0.6], [-1.3, 0.6]].forEach(function (p) { F.box("wood", COL.timberD, 0.07, 2.3, 0.07, p[0], 1.25 + 1.15, p[1]); });
    var cn = new THREE.ConeGeometry(2.1, 0.55, 4, 1, true); cn.rotateY(PI / 4); cn.scale(1.0, 1, 0.62); F.geo("fabric", 0xf4f1ea, cn, 0, 3.75, 0, 0, 0, 0, 1, 1, 1, PM_FAB, { aSw: [0.015, 3, 0] });
    F.aquad(REG["bar_" + B.sign], 0.9, 1.12, 0, 0.85, 0.565, 0, 0.3);
    for (var bt = 0; bt < 10; bt++) F.cyl("std", [0xb8742a, 0x2f6b3a, 0xcfd8d0][bt % 3], 0.035, 0.04, 0.28, -1.1 + bt * 0.24, 1.42, -0.3, 6, [0.08, 0.3, 0.35]);
    F.cyl("std", 0xc9ccd0, 0.22, 0.18, 0.3, 0.9, 1.43, 0.1, 12, PM_CHROME); solF(F, 0, 0, 2.8, 1.3, 0, 1.3);
    var ft = F.w(0, 0); FE.lamps.push({ x: ft[0], y: F.y + 2.4, z: ft[1], c: 0xffc98a, k: 8, d: 12, tag: "bar" });
    return F;
  }
  function truck(K, T) {
    var lv = C("liveries." + T.livery, {}); var body = new THREE.Color(lv.body || "#2a7a3e").getHex(), trim = new THREE.Color(lv.trim || "#ffffff").getHex();
    var F = new Fr(K, T.x, gh(T.x, T.z), T.z, T.face); var y0 = 0.85, y1 = 3.35, x0 = -3.4, x1 = 2.2, Lb = x1 - x0, zb = 1.2, Hb = y1 - y0, side = REG["side_" + T.livery], back = REG["back_" + T.livery];
    // wheels, chassis, cab and hood
    [[-2.3, 1.08], [-2.3, -1.08], [3.05, 1.08], [3.05, -1.08]].forEach(function (p) { F.cyl("std", 0x161718, 0.46, 0.46, 0.32, p[0], 0.46, p[1], 16, PM_RUBBER, PI / 2); F.cyl("std", 0xc9ccd0, 0.22, 0.22, 0.34, p[0], 0.46, p[1], 10, PM_CHROME, PI / 2); });
    F.box("std", 0x1c1d1f, 7.4, 0.32, 1.9, -0.6, 0.62, 0, 0, 0, 0, [0.7, 0.3, 0]);
    F.box("std", body, 1.85, 1.55, 2.3, 3.12, 1.48, 0, 0, 0, 0, PM_SATIN); F.box("std", body, 0.75, 0.82, 2.3, 4.35, 1.08, 0, 0, 0, 0, PM_SATIN); F.box("std", body, 1.4, 0.06, 2.2, 3.2, 2.28, 0, 0, 0, 0, PM_SATIN);
    F.box("std", 0x1a2630, 0.04, 0.72, 2.05, 4.06, 1.82, 0, 0, 0, -0.32, PM_GLASS); [-1, 1].forEach(function (sd) { F.box("std", 0x1a2630, 0.95, 0.62, 0.04, 3.25, 1.85, sd * 1.16, 0, 0, 0, PM_GLASS); F.box("std", 0x16171a, 0.06, 0.25, 0.18, 3.95, 1.75, sd * 1.3, 0, 0, 0, [0.5, 0.4, 0]); });
    F.box("std", 0xc9ccd0, 0.18, 0.26, 2.36, 4.78, 0.72, 0, 0, 0, 0, PM_CHROME); F.box("std", 0x17181a, 0.05, 0.42, 1.2, 4.73, 1.1, 0, 0, 0, 0, [0.5, 0.4, 0]); [-0.85, 0.85].forEach(function (z) { F.box("std", 0xfff4d8, 0.04, 0.16, 0.3, 4.74, 1.18, z, 0, 0, 0, PM_EMIT); });
    // the box body: livery panels round the serving window, the far side and the rear (atlas), steel lining inside, a rounded roof
    var sub = function (u0, v0, u1, v1) { return [side[0] + (side[2] - side[0]) * u0, side[1] + (side[3] - side[1]) * (1 - v1), side[0] + (side[2] - side[0]) * u1, side[1] + (side[3] - side[1]) * (1 - v0)]; };
    var wx0 = x0 + 0.08 * Lb, wx1 = x0 + 0.44 * Lb, wy0 = 1.85, wy1 = 3.0, u = function (x) { return (x - x0) / Lb; }, v = function (y) { return (y - y0) / Hb; };
    var pane = function (xa, xb, ya, yb) { F.aquad(sub(u(xa), v(ya), u(xb), v(yb)), xb - xa, yb - ya, (xa + xb) / 2, (ya + yb) / 2, zb + 0.005, 0, 0); };
    pane(x0, wx0, y0, y1); pane(wx1, x1, y0, y1); pane(wx0, wx1, y0, wy0); pane(wx0, wx1, wy1, y1);
    F.aquad(side, Lb, Hb, (x0 + x1) / 2, (y0 + y1) / 2, -zb - 0.005, PI, 0); F.aquad(back, 2 * zb, Hb, x0 - 0.005, (y0 + y1) / 2, 0, -PI / 2, 0);
    F.box("std", 0xb7bcc0, Lb, Hb, 0.03, (x0 + x1) / 2, (y0 + y1) / 2, -zb + 0.03, 0, 0, 0, PM_STEEL); F.box("std", 0xb7bcc0, 0.03, Hb, 2 * zb, x0 + 0.03, (y0 + y1) / 2, 0, 0, 0, 0, PM_STEEL); F.box("std", body, 0.06, Hb, 2 * zb, x1, (y0 + y1) / 2, 0, 0, 0, 0, PM_SATIN);
    F.box("std", 0x9aa0a5, Lb, 0.08, 2 * zb, (x0 + x1) / 2, y0 + 0.04, 0, 0, 0, 0, PM_STEEL); F.box("std", body, Lb + 0.04, 0.08, 2 * zb - 0.3, (x0 + x1) / 2, y1 + 0.02, 0, 0, 0, 0, PM_SATIN);
    [-1, 1].forEach(function (sd) { var rc = new THREE.CylinderGeometry(0.16, 0.16, Lb + 0.04, 10, 1, true, sd > 0 ? 0 : PI / 2, PI / 2); rc.rotateZ(PI / 2); F.geo("std", body, rc, (x0 + x1) / 2, y1 - 0.12, sd * (zb - 0.15), 0, 0, 0, 1, 1, 1, PM_SATIN); });
    F.box("std", 0xc9ccd0, 1.0, 0.36, 0.85, -2.1, y1 + 0.2, -0.2, 0, 0, 0, PM_STEEL); F.box("std", 0x6d7176, 0.9, 0.04, 0.75, -2.1, y1 + 0.39, -0.2, 0, 0, 0, [0.5, 0.6, 0]);
    // inside: a steel line along the far wall, a hood, shelves, a warm ceiling strip; outside: the counter shelf, the awning, the menu, lights
    F.box("std", 0xc4c9cd, Lb - 0.6, 0.92, 0.62, -0.7, y0 + 0.46, -zb + 0.36, 0, 0, 0, PM_STEEL); F.box("std", 0x2b2c2e, 1.6, 0.04, 0.5, -1.8, y0 + 0.94, -zb + 0.36, 0, 0, 0, [0.4, 0.6, 0]); F.box("std", 0xb0b5b9, 1.8, 0.45, 0.7, -1.8, y1 - 0.45, -zb + 0.4, 0, 0, 0, PM_STEEL);
    for (var s = 0; s < 2; s++) { F.box("std", 0xc4c9cd, 2.0, 0.03, 0.3, 0.6, 2.25 + s * 0.4, -zb + 0.18, 0, 0, 0, PM_STEEL); for (var j = 0; j < 7; j++) F.box("std", [0xd94a2a, 0xf4cd5a, 0x2f8a4a, 0xe9e4d8][(j + s) % 4], 0.12, 0.2, 0.12, -0.2 + j * 0.27, 2.37 + s * 0.4, -zb + 0.18, 0, 0, 0, [0.6, 0, 0.05]); }
    F.box("std", 0xfff1d6, Lb - 0.8, 0.03, 0.12, -0.6, y1 - 0.06, 0, 0, 0, 0, PM_EMIT);
    F.box("std", 0xc9ccd0, wx1 - wx0 + 0.3, 0.05, 0.42, (wx0 + wx1) / 2, wy0 - 0.02, zb + 0.2, 0, 0, 0, PM_STEEL); F.box("std", trim, wx1 - wx0 + 0.1, 0.06, 0.08, (wx0 + wx1) / 2, wy0 - 0.05, zb + 0.03, 0, 0, 0, PM_SATIN);
    F.box("std", body, wx1 - wx0 + 0.4, 0.05, 1.15, (wx0 + wx1) / 2, wy1 + 0.2, zb + 0.52, 0, -0.42, 0, PM_SATIN); F.box("std", 0xffe7b8, wx1 - wx0 + 0.2, 0.02, 0.05, (wx0 + wx1) / 2, wy1 + 0.07, zb + 0.6, 0, -0.42, 0, PM_EMIT);
    [wx0 + 0.15, wx1 - 0.15].forEach(function (x) { var g = tubeG(V(x, wy1 + 0.4, zb + 0.95), V(x, wy1 - 0.3, zb + 0.02), 0.012, 4); if (g) F.geo("std", 0xc9ccd0, g, 0, 0, 0, 0, 0, 0, 1, 1, 1, PM_CHROME); });
    var mb = new Fr(K, 0, 0, 0, 0); (function () { var p = F.w(wx0 - 0.9, zb + 1.6); var A = new Fr(K, p[0], gh(p[0], p[1]), p[1], T.face + 0.35); [[0.22, -0.25], [-0.22, PI + 0.25]].forEach(function (q) { A.box("wood", COL.timberD, 0.7, 1.05, 0.04, 0, 0.55, q[0], 0, q[1] > 1 ? -0.25 : 0.25, 0); }); A.aquad(REG["menu_" + T.livery], 0.56, 0.7, 0, 0.62, 0.255, 0, 0.3, -0.25); A.aquad(REG["menu_" + T.livery], 0.56, 0.7, 0, 0.62, -0.255, PI, 0.3, -0.25); solF(A, 0, 0, 0.75, 0.5, 0, 1.0); })();
    [-1, 1].forEach(function (sd) { F.box("std", 0xd8261c, 0.04, 0.2, 0.12, x0 - 0.02, 1.05, sd * 0.95, 0, 0, 0, PM_EMIT_H); });
    for (var mq = 0; mq < 14; mq++) F.sph("std", COL.bulb, 0.04, x0 + 0.25 + mq * (Lb - 0.5) / 13, y1 + 0.02, zb + 0.06, 6, 1, PM_EMIT);
    solF(F, 0.6, 0, 8.4, 2.6, 0, 3.5);
    var gw = F.w((wx0 + wx1) / 2, zb + 2.6); glowDisc(FE.KG, gw[0], gw[1], 4.5, 0xfff0c8, 0.5);
    var ww = F.w((wx0 + wx1) / 2, zb + 1.2); FE.lamps.push({ x: ww[0], y: F.y + 3.0, z: ww[1], c: 0xffe2b0, k: 10, d: 12, tag: "truck" });
    T.F = F; T.win = [(wx0 + wx1) / 2, zb]; return F;
  }
  function picnic(K, x, z, yaw, umb, R) {
    var F = new Fr(K, x, gh(x, z), z, yaw), wc = COL.timberL;
    for (var p = 0; p < 5; p++) F.box("wood", wc, 2.0, 0.05, 0.16, 0, 0.76, -0.34 + p * 0.17, 0, 0, 0, null, 1);
    [-0.8, 0.8].forEach(function (x2) { [-1, 1].forEach(function (sd) { F.box("wood", COL.timber, 0.08, 0.92, 0.1, x2, 0.4, sd * 0.33, 0, sd * 0.62, 0); }); F.box("wood", COL.timber, 0.08, 0.08, 1.75, x2, 0.42, 0); });
    [-1, 1].forEach(function (sd) { F.box("wood", wc, 2.0, 0.05, 0.3, 0, 0.45, sd * 0.72, 0, 0, 0, null, 1); });
    solF(F, 0, 0, 2.0, 0.85, 0.65, 0.79);
    [-1, 1].forEach(function (sd) { [-0.66, 0, 0.66].forEach(function (x2) { solF(F, x2, sd * 0.72, 0.44, 0.32, 0, 0.45, true, sd > 0 ? PI : 0); }); });
    if (umb) { F.cyl("std", COL.white, 0.025, 0.025, 2.55, 0, 1.28, 0, 8, PM_SATIN); F.cyl("std", 0x6d6a64, 0.25, 0.3, 0.06, 0, 0.03, 0, 12, [0.7, 0.2, 0]);
      var cn = new THREE.ConeGeometry(1.55, 0.45, 8, 2, true); F.geo("fabric", 0xf6f4ee, cn, 0, 2.62, 0, R() * 0.4, 0, 0, 1, 1, 1, PM_FAB, { aSw: [0.012, R() * 6, 0.15] });
      var sk = new THREE.CylinderGeometry(1.55, 1.56, 0.16, 8, 1, true); F.geo("fabric", 0xf0ede4, sk, 0, 2.33, 0, R() * 0.4, 0, 0, 1, 1, 1, PM_FAB, { aSw: [0.02, R() * 6, 0.4] });
      for (var r = 0; r < 8; r++) { var a = r / 8 * TAU; var g = tubeG(V(0, 2.82, 0), V(Math.cos(a) * 1.5, 2.4, Math.sin(a) * 1.5), 0.008, 3); if (g) F.geo("std", COL.white, g, 0, 0, 0, 0, 0, 0, 1, 1, 1, PM_SATIN); } solF(F, 0, 0, 0.12, 0.12, 0.8, 2.5); }
    return F;
  }
  function pole(K, x, z, h, r) { var F = new Fr(K, x, gh(x, z), z, 0); F.cyl("wood", COL.timberD, r * 0.82, r, h, 0, h / 2, 0, 10); F.cyl("std", 0x2a2b2d, r * 0.95, r * 0.95, 0.12, 0, h - 0.3, 0, 10, PM_STEEL); F.cyl("std", 0x2a2b2d, r * 1.2, r * 1.3, 0.25, 0, 0.12, 0, 10, PM_STEEL); sol(x, z, 0, r * 2.2, r * 2.2, F.y, F.y + h); return F; }
  // a drape: a long swag of fabric between two pole tops, pinched at the poles, wide and twisting mid span; it sways in the shader
  // a drape: a long swag between two pole tops on a catenary, gathered at the poles, wide mid span with lengthwise pleats that are
  // deep at the gathered ends and shallow in the belly; built as an indexed grid so the pleats shade smoothly; it sways in the shader
  function drapeG(A, B, wid, sag, seed, col) {
    var R = rng(seed), dir = new THREE.Vector3().subVectors(B, A); dir.y = 0; var L = dir.length(); dir.normalize(); var side = V(-dir.z, 0, dir.x), nA = 40, nC = 14, tw = (R() - 0.5) * 1.4, np = 4 + Math.floor(R() * 2), ph0 = R() * TAU;
    var ca = 2.4, c0 = Math.cosh(ca / 2), cat = function (t) { return (Math.cosh(ca * (t - 0.5)) - c0) / (1 - c0); };
    var pt = function (t, s) { var sn = Math.sin(PI * t), w = 0.16 + (wid - 0.16) * Math.pow(sn, 0.6); var p = A.clone().lerp(B, t); p.y -= sag * cat(t); var a = tw * sn; var off = s * w / 2;
      var droop = -0.34 * (1 - s * s) * sn * wid / 2.2; var pleat = (0.09 + 0.16 * Math.pow(1 - sn, 1.5)) * Math.sin(s * PI * np + ph0 + t * 3.0) * (0.35 + 0.65 * (1 - s * s));
      p.addScaledVector(side, off * Math.cos(a)); p.y += off * Math.sin(a) + droop + pleat; p.fold = (0.5 + 0.5 * Math.sin(s * PI * np + ph0 + t * 3.0 + 0.6)) * (0.65 + 0.35 * (1 - sn)); return p; };
    var base = lin(col), pos = [], sw = [], cols = [], idx = []; for (var i = 0; i <= nA; i++) for (var j = 0; j <= nC; j++) { var t = i / nA, s = -1 + 2 * j / nC, q = pt(t, s); pos.push(q.x, q.y, q.z); sw.push(0.22 * Math.sin(PI * t), seed * 1.7, Math.pow(Math.abs(s), 3)); var k = 1.12 - 0.55 * q.fold; cols.push(base[0] * k, base[1] * k, base[2] * k); }
    for (var i2 = 0; i2 < nA; i2++) for (var j2 = 0; j2 < nC; j2++) { var a0 = i2 * (nC + 1) + j2, b0 = a0 + nC + 1; idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("aSw", new THREE.Float32BufferAttribute(sw, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  function firebowl(K, KF, x, z, seed) { var F = new Fr(K, x, gh(x, z), z, seed); F.cyl("std", 0x3a2a22, 0.3, 0.42, 0.28, 0, 0.14, 0, 16, [0.7, 0.4, 0]); var bw = new THREE.CylinderGeometry(0.62, 0.32, 0.32, 20, 1, true); F.geo("std", 0x4a3326, bw, 0, 0.44, 0, 0, 0, 0, 1, 1, 1, [0.55, 0.6, 0]); F.cyl("std", 0x161210, 0.58, 0.58, 0.04, 0, 0.52, 0, 20, [0.95, 0, 0]);
    for (var r = 0; r < 7; r++) { var a = r / 7 * TAU; F.sph("std", r % 2 ? 0x2a1d17 : 0xff7a2a, 0.11, Math.cos(a) * 0.26, 0.56, Math.sin(a) * 0.26, 5, 0.6, r % 2 ? [0.95, 0, 0] : [0.8, 0, 0.6]); }
    var F2 = new Fr(KF, x, F.y, z, seed); [0, PI / 2, PI / 4, -PI / 4].forEach(function (ry, i) { var q = new THREE.PlaneGeometry(i < 2 ? 0.9 : 0.6, i < 2 ? 1.15 : 0.8); q.translate(0, (i < 2 ? 1.15 : 0.8) / 2, 0); F2.geo("flame", 0xffffff, q, 0, 0.54, 0, ry, 0, 0, 1, 1, 1, PM_EMIT, { aSeed: [seed + i * 0.37] }); });
    glowDisc(FE.KG, x, z, 4.2, 0xff8a3a, 0.55); sol(x, z, 0, 1.1, 1.1, F.y, F.y + 0.6); }
  // an Adirondack chair (timber slats, wide arms, a raked back) with its seat
  function adirondack(K, x, z, yaw, i) { var F = new Fr(K, x, gh(x, z), z, yaw), c = [0x8a5a3a, 0x2f6b4a, 0xe9e1d0, 0x6b4a8a][i % 4];
    for (var k = 0; k < 5; k++) F.box("wood", c, 0.6, 0.03, 0.09, 0, 0.36 - k * 0.012, 0.22 - k * 0.11, 0, 0.12, 0);
    for (var b = 0; b < 5; b++) F.box("wood", c, 0.1, 0.85, 0.025, -0.24 + b * 0.12, 0.72, -0.34, 0, -0.42, 0);
    [-1, 1].forEach(function (sd) { F.box("wood", c, 0.11, 0.025, 0.72, sd * 0.38, 0.6, 0.0); F.box("wood", c, 0.05, 0.6, 0.05, sd * 0.38, 0.3, 0.3); F.box("wood", c, 0.05, 0.38, 0.05, sd * 0.32, 0.19, -0.3); F.box("wood", c, 0.04, 0.05, 0.75, sd * 0.31, 0.3, -0.02, 0, 0.12, 0); });
    solF(F, 0, 0, 0.75, 0.75, 0, 0.4, true, 0); }
  function bins(K, x, z, yaw) { var F = new Fr(K, x, gh(x, z), z, yaw); [[0x1c1f24, 0], [0x2b5aa8, 1], [0x2f7a3e, 2]].forEach(function (b, i) { var bx = (i - 1) * 0.62; F.box("std", b[0], 0.56, 0.92, 0.56, bx, 0.46, 0, 0, 0, 0, [0.5, 0.15, 0]); F.box("std", 0x2a2b2d, 0.6, 0.06, 0.6, bx, 0.95, 0, 0, 0, 0, [0.5, 0.3, 0]); F.box("std", 0x0c0c0c, 0.3, 0.02, 0.08, bx, 0.985, 0.08, 0, 0, 0, [0.8, 0, 0]); F.aquad(REG["bin_" + i], 0.4, 0.4, bx, 0.6, 0.285, 0, 0.15); }); solF(F, 0, 0, 1.9, 0.62, 0, 1.0); }
  function banner(K, x, z, col) { var F = new Fr(K, x, gh(x, z), z, 0); F.cyl("std", 0x2a2b2d, 0.06, 0.07, 5.8, 0, 2.9, 0, 8, PM_STEEL); [5.2, 2.0].forEach(function (y) { F.box("std", 0x2a2b2d, 1.1, 0.04, 0.04, 0.58, y, 0, 0, 0, 0, PM_STEEL); });
    var r = REG["banner_" + col]; F.aquad(r, 0.95, 3.1, 0.58, 3.6, 0.012, 0, 0.3); F.aquad(r, 0.95, 3.1, 0.58, 3.6, -0.012, PI, 0.3); sol(x, z, 0, 0.2, 0.2, F.y, F.y + 5.8); }
  function board(K, b) { var F = new Fr(K, b.x, gh(b.x, b.z), b.z, b.face || 0); F.box("std", 0x3a3d40, 2.9, 0.4, 0.7, 0, 0.2, 0, 0, 0, 0, [0.8, 0.1, 0]); [-1.32, 1.32].forEach(function (x) { F.box("wood", COL.timberD, 0.18, 3.6, 0.22, x, 1.8, 0); }); F.box("std", 0x111213, 2.5, 3.0, 0.16, 0, 2.05, 0, 0, 0, 0, [0.5, 0.2, 0]); F.box("wood", COL.timber, 2.95, 0.22, 0.32, 0, 3.66, 0);
    [0.085, -0.085].forEach(function (z, i) { var q = new THREE.PlaneGeometry(2.3, 2.3 * 1280 / 1024); F.geo("board", 0xffffff, q, 0, 2.05, z, i ? PI : 0, 0, 0, 1, 1, 1, [0.5, 0, 1]); }); solF(F, 0, 0, 2.9, 0.5, 0, 3.7); }
  function wayfind(K, wf, i) { var F = new Fr(K, wf.x, gh(wf.x, wf.z), wf.z, wf.face || 0); F.box("wood", COL.timberD, 0.22, 2.9, 0.22, -0.9, 1.45, 0); F.box("wood", COL.timberD, 0.22, 2.9, 0.22, 0.9, 1.45, 0); F.box("std", 0x24170e, 1.65, 1.25, 0.08, 0, 1.95, 0, 0, 0, 0, [0.8, 0, 0]);
    F.aquad(REG["way_" + i + "_f"], 1.5, 1.125, 0, 1.95, 0.045, 0, 0.45); F.aquad(REG["way_" + i + "_b"], 1.5, 1.125, 0, 1.95, -0.045, PI, 0.45); F.box("std", 0x4dde6f, 1.65, 0.06, 0.1, 0, 2.6, 0, 0, 0, 0, PM_EMIT_H); solF(F, 0, 0, 2.1, 0.3, 0, 2.9); }
  function infoSign(K, p) { var F = new Fr(K, p.x, gh(p.x, p.z), p.z, PI); F.box("std", 0x8f8174, 3.2, 0.5, 0.8, 0, 0.25, 0, 0, 0, 0, [0.9, 0, 0]); F.box("std", 0x2a1d14, 2.9, 1.5, 0.22, 0, 1.25, 0, 0, 0, 0, [0.7, 0.2, 0]); F.aquad(REG.info, 2.75, 1.375, 0, 1.25, 0.115, 0, 0.6); F.aquad(REG.info, 2.75, 1.375, 0, 1.25, -0.115, PI, 0.6); solF(F, 0, 0, 3.2, 0.8, 0, 2.0); }
  function dropoff(K, KS) {
    var D = C("dropoff", null); if (!D) return; drape(KS, "asphalt", D.poly, 3, 0.07, 6);
    var gaps = [[-208, -202], [-162.5, -157.5]], kx = -250; var segs = []; gaps.forEach(function (g) { segs.push([kx, g[0]]); kx = g[1]; }); segs.push([kx, -150]);
    segs.forEach(function (s) { for (var x = s[0]; x < s[1] - 0.01; x += 4) { var x2 = Math.min(s[1], x + 4), xm = (x + x2) / 2; var F = new Fr(K, xm, gh(xm, D.kerb), D.kerb, 0); F.box("std", COL.concrete, x2 - x, 0.34, 0.32, 0, 0.08, 0, 0, 0, 0, [0.9, 0, 0]); } });
    for (var x = -246; x < -180; x += 6) { var F2 = new Fr(K, x + 1.5, gh(x + 1.5, -174.5) + 0.075, -174.5, 0); F2.box("std", 0xe9e6dc, 3.0, 0.012, 0.14, 0, 0, 0, 0, 0, 0, [0.85, 0, 0]); }
    var sh = D.shelter, F = new Fr(K, sh.x, gh(sh.x, sh.z), sh.z, PI); [[-sh.w / 2 + 0.2, -sh.d / 2 + 0.2], [sh.w / 2 - 0.2, -sh.d / 2 + 0.2], [-sh.w / 2 + 0.2, sh.d / 2 - 0.2], [sh.w / 2 - 0.2, sh.d / 2 - 0.2]].forEach(function (p) { F.box("std", 0x2a2b2d, 0.12, 2.8, 0.12, p[0], 1.4, p[1], 0, 0, 0, PM_STEEL); solF(F, p[0], p[1], 0.2, 0.2, 0, 2.8); });
    var roof = new THREE.CylinderGeometry(sh.d * 0.9, sh.d * 0.9, sh.w + 0.6, 24, 1, true, PI / 2 - 0.62, 1.24); roof.rotateZ(PI / 2); F.geo("fabric", 0xf3f0e8, roof, 0, 2.85 - sh.d * 0.9 + 0.35, 0, 0, 0, 0, 1, 1, 1, PM_FAB, { aSw: [0, 0, 0] });
    F.box("std", 0x9fb6bf, sh.w - 0.5, 1.9, 0.03, 0, 1.25, -sh.d / 2 + 0.2, 0, 0, 0, [0.06, 0.5, 0]); F.box("wood", COL.timberL, sh.w - 1.4, 0.06, 0.45, 0, 0.46, -sh.d / 2 + 0.55); F.box("std", 0x2a2b2d, sh.w - 1.4, 0.4, 0.06, 0, 0.23, -sh.d / 2 + 0.55, 0, 0, 0, PM_STEEL);
    for (var s = 0; s < 4; s++) solF(F, -sh.w / 2 + 1.4 + s * (sh.w - 2.8) / 3, -sh.d / 2 + 0.55, 0.55, 0.45, 0, 0.47, true, 0);
    F.box("std", 0x2a2b2d, 0.12, 3.4, 0.12, sh.w / 2 + 0.9, 1.7, 0.3, 0, 0, 0, PM_STEEL); F.aquad(REG.shuttle, 1.6, 0.8, sh.w / 2 + 0.9, 3.0, 0.37, 0, 0.6); F.aquad(REG.shuttle, 1.6, 0.8, sh.w / 2 + 0.9, 3.0, 0.23, PI, 0.6);
    (D.bollards || []).forEach(function (bx) { var F3 = new Fr(K, bx, gh(bx, -167.2), -167.2, 0); F3.cyl("std", 0x2a2b2d, 0.11, 0.13, 0.95, 0, 0.47, 0, 10, PM_STEEL); F3.cyl("std", 0xffe2b0, 0.115, 0.115, 0.05, 0, 0.82, 0, 10, PM_EMIT); sol(bx, -167.2, 0, 0.26, 0.26, F3.y, F3.y + 0.95); });
    FE.lamps.push({ x: sh.x, y: gh(sh.x, sh.z) + 2.5, z: sh.z, c: 0xfff0d8, k: 8, d: 12, tag: "drop" });
  }

  // ───────────────────────── the crowd: people baked from the client's own rigs (two poses per motion, blended in the shader) ─────────────────────────
  // models/fest_crowd.bin holds, for the male and female body, a decimated mesh (about 1,900 and 1,650 triangles, clustered on the
  // bind pose) and its positions in two frames of each motion (idle, chat, dance1, dance2, sit). Every person is an instance:
  // clothing, skin and hair colours per instance by body region (from the rig's bone weights), a phase and a rate, a zone and a
  // rank; a zone's level (from the schedule) decides in the vertex shader how many of its people are there. Eight draws in all.
  var CR = FE.crowd || (FE.crowd = { data: null, loading: false, meshes: [], inst: [], g: null, lvl: [0, 0, 0, 0, 0], tgt: [0, 0, 0, 0, 0], u: null, bubble: null, bubbleAt: 0, nextBubble: 0 });
  var MOTIONS = { stand: "idle", idle: "idle", dance: "dance", dance2: "dance2", sit: "sit" };
  function loadCrowd() { if (CR.data || CR.loading) return; CR.loading = true; var url = C("crowd.file", "/models/fest_crowd.bin") + "?v=" + (window.BUILD || "dev"); try { if (window.AV) url = window.AV(url); } catch (e) {}
    fetch(url).then(function (r) { if (!r.ok) throw new Error("crowd " + r.status); return r.arrayBuffer(); }).then(function (buf) { var dv = new DataView(buf); var magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)); if (magic !== "FCR1") throw new Error("crowd magic"); var jl = dv.getUint32(4, true); var meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl))); CR.data = { meta: meta, buf: buf, base: 8 + jl }; FE.n.crowdBytes = buf.byteLength; }).catch(function (e) { note("crowd load", e); CR.loading = false; CR.failed = true; }); }
  function crowdGeo(body, motion) {
    var D = CR.data, m = D.meta.bodies[body], q = 1 / D.meta.q, base = D.base; if (!m || !m.poses[motion]) return null;
    var idx = new Uint16Array(D.buf.slice(base + m.idx[0], base + m.idx[0] + m.idx[1])), reg = new Uint8Array(D.buf, base + m.reg[0], m.reg[1]);
    var P = m.poses[motion].map(function (r) { var a = new Int16Array(D.buf.slice(base + r[0], base + r[0] + r[1])), f = new Float32Array(a.length); for (var i = 0; i < a.length; i++) f[i] = a[i] * q; return f; });
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P[0], 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
    var g2 = new THREE.BufferGeometry(); g2.setAttribute("position", new THREE.BufferAttribute(P[1], 3)); g2.setIndex(new THREE.BufferAttribute(idx, 1)); g2.computeVertexNormals();
    g.setAttribute("posB", new THREE.BufferAttribute(P[1], 3)); g.setAttribute("nrmB", g2.attributes.normal); var rf = new Float32Array(reg.length); for (var k = 0; k < reg.length; k++) rf[k] = reg[k]; g.setAttribute("reg", new THREE.BufferAttribute(rf, 1));
    g.computeBoundingSphere(); return g;
  }
  function crowdMat() {
    if (MAT.crowd) return MAT.crowd; CR.u = { uZ: { value: [0, 0, 0, 0, 0] }, uHide: { value: new THREE.Vector4(0, 0, 0, 0) } };
    var m = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 }); m.name = "fest_crowd";
    m.onBeforeCompile = function (sh) { sh.uniforms.uT = U.uT; sh.uniforms.uZ = CR.u.uZ; sh.uniforms.uHide = CR.u.uHide;
      sh.vertexShader = "attribute vec3 posB;\nattribute vec3 nrmB;\nattribute float reg;\nattribute vec3 iSk;\nattribute vec3 iSh;\nattribute vec3 iPa;\nattribute vec3 iHa;\nattribute vec4 iPar;\nuniform float uT;\nuniform float uZ[5];\nuniform vec4 uHide;\nvarying vec3 vFc;\n" +
        sh.vertexShader.replace("#include <beginnormal_vertex>", "float fw = 0.5 + 0.5 * sin(uT * iPar.y + iPar.x);\nvec3 objectNormal = normalize(mix(normal, nrmB, fw));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif")
          .replace("#include <begin_vertex>", "vec3 transformed = mix(position, posB, fw);\n{ int zi = int(iPar.z + 0.5); float lv = zi == 0 ? uZ[0] : zi == 1 ? uZ[1] : zi == 2 ? uZ[2] : zi == 3 ? uZ[3] : uZ[4]; float on = step(iPar.w, lv);\n#ifdef USE_INSTANCING\n vec2 io = vec2(instanceMatrix[3][0], instanceMatrix[3][2]); on *= step(uHide.w, length(io - uHide.xz));\n#endif\n transformed *= on; }\n" +
            "vFc = reg < 0.5 ? iSk : reg < 1.5 ? iSh : reg < 2.5 ? iPa : reg < 3.5 ? vec3(0.055, 0.05, 0.048) : reg < 4.5 ? iHa : iSk;");
      sh.fragmentShader = "varying vec3 vFc;\n" + sh.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vFc;"); };
    m.customProgramCacheKey = function () { return "fest_crowd"; }; MAT.crowd = m;
    var bc = document.createElement("canvas"); bc.width = bc.height = 64; var x = bc.getContext("2d"), gr = x.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, "rgba(0,0,0,0.5)"); gr.addColorStop(0.6, "rgba(0,0,0,0.22)"); gr.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    var bt = new THREE.CanvasTexture(bc); var b = new THREE.MeshBasicMaterial({ map: bt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); b.name = "fest_blob";
    b.onBeforeCompile = function (sh) { sh.uniforms.uZ = CR.u.uZ; sh.uniforms.uHide = CR.u.uHide; sh.vertexShader = "attribute vec4 iPar;\nuniform float uZ[5];\nuniform vec4 uHide;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n{ int zi = int(iPar.z + 0.5); float lv = zi == 0 ? uZ[0] : zi == 1 ? uZ[1] : zi == 2 ? uZ[2] : zi == 3 ? uZ[3] : uZ[4]; float on = step(iPar.w, lv);\n#ifdef USE_INSTANCING\n vec2 io = vec2(instanceMatrix[3][0], instanceMatrix[3][2]); on *= step(uHide.w, length(io - uHide.xz));\n#endif\n transformed *= on; }"); };
    b.customProgramCacheKey = function () { return "fest_blob"; }; MAT.blob = b; return m;
  }
  // where everyone stands: [x, z, yaw, zone, rank, motion, body]
  function crowdSpots() {
    var R = rng(70707), out = [], cnt = C("crowd.counts", {}), Z = { stage: 0, bars: 1, trucks: 2, picnic: 3, lawn: 4 };
    var add = function (x, z, yaw, zone, rank, motion) { out.push([x, z, yaw + (R() - 0.5) * 0.5, Z[zone], clamp(rank, 0.001, 0.999), motion, R() < 0.5 ? "m" : "f"]); };
    var beds = C("site.beds", []) || []; var near = function (x, z, r) { if (nearStrip(x, z, 0.35)) return true; for (var b = 0; b < beds.length; b++) { var bd = beds[b]; if (Math.hypot(x - bd.c[0], z - bd.c[1]) < bd.r + 0.6) return true; } for (var i = 0; i < out.length; i++) if (Math.abs(out[i][0] - x) < r && Math.abs(out[i][1] - z) < r && Math.hypot(out[i][0] - x, out[i][1] - z) < r) return true; for (var j = 0; j < SOL.length; j++) { var s = SOL[j]; if (s.seat) continue; if (Math.abs(s.x - x) < s.hw + s.hd + r && Math.abs(s.z - z) < s.hw + s.hd + r) { var c = Math.cos(s.ry), sn = Math.sin(s.ry), dx = x - s.x, dz = z - s.z; var lx = dx * c - dz * sn, lz = dx * sn + dz * c; if (Math.abs(lx) < s.hw + r * 0.6 && Math.abs(lz) < s.hd + r * 0.6) return true; } } return false; };
    // the dance floor: rows facing the stage, nearest the stage fill first
    var D = FE.dance; if (D) { var fx = Math.sin(D.yaw), fz = Math.cos(D.yaw), px = fz, pz = -fx, n = 0, want = cnt.stage || 100; var face = Math.atan2(-fx, -fz);
      for (var a = -D.d / 2 + 0.8; a < D.d / 2 && n < want * 2; a += 1.05) for (var b = -D.w / 2 + 0.6; b < D.w / 2; b += 1.0) { var x = D.x + fx * a + px * b + (R() - 0.5) * 0.45, z = D.z + fz * a + pz * b + (R() - 0.5) * 0.45; if (near(x, z, 0.55)) continue; var dist = (a + D.d / 2) / D.d, rk = dist * 0.65 + R() * 0.35; var mo = R(); add(x, z, face, "stage", rk, mo < 0.45 ? "dance" : mo < 0.82 ? "dance2" : "stand"); n++; } }
    // bars: an arc in front of each counter
    (C("site.bars", []) || []).forEach(function (B, bi) { var c = Math.cos(B.face), s = Math.sin(B.face), cz = B.small ? 1.0 : B.d / 2 + 0.6, k = B.small ? 8 : Math.round((cnt.bars || 50) * 0.45);
      for (var i = 0, tries = 0; i < k && tries < 400; tries++) { var lx = (R() - 0.5) * (B.w + 2.5), lz = cz + 0.9 + R() * 4.2; var x = B.x + lx * c + lz * s, z = B.z - lx * s + lz * c; if (near(x, z, 0.62)) continue; var tx = B.x + lx * 0.6 * c + cz * s, tz = B.z - lx * 0.6 * s + cz * c; var rk = (lz - cz) / 5.5 * 0.6 + R() * 0.4; if (R() < 0.45 && lz > cz + 1.8) { var a = R() * TAU, ox = Math.cos(a) * 0.55, oz = Math.sin(a) * 0.55; if (near(x + ox, z + oz, 0.5) || near(x - ox, z - oz, 0.5)) continue; add(x + ox, z + oz, Math.atan2(-ox, -oz), "bars", rk, "stand"); add(x - ox, z - oz, Math.atan2(ox, oz), "bars", rk, "stand"); i += 2; continue; } add(x, z, Math.atan2(tx - x, tz - z), "bars", rk, "stand"); i++; } });
    // bars: standing circles a little further out, drinks in hand
    (C("site.bars", []) || []).forEach(function (B) { if (B.small) return; var c = Math.cos(B.face), s = Math.sin(B.face); for (var i = 0, tries = 0; i < (cnt.barGroups || 5) && tries < 300; tries++) { var lx = (R() - 0.5) * (B.w + 6), lz = B.d / 2 + 5 + R() * 5; var gx = B.x + lx * c + lz * s, gz = B.z - lx * s + lz * c; if (near(gx, gz, 1.4)) continue; var m = 3 + Math.floor(R() * 2), rr = 0.75 + m * 0.1, rk = 0.15 + R() * 0.85; for (var k = 0; k < m; k++) { var a = k / m * TAU + R() * 0.3, x = gx + Math.cos(a) * rr, z = gz + Math.sin(a) * rr; add(x, z, Math.atan2(gx - x, gz - z), "bars", rk, "stand"); } i++; } });
    // trucks: a queue at each window, people eating nearby
    (C("site.trucks", []) || []).forEach(function (T) { var c = Math.cos(T.face), s = Math.sin(T.face), w = function (lx, lz) { return [T.x + lx * c + lz * s, T.z - lx * s + lz * c]; }; var wx = -3.4 + 0.26 * 5.6;
      for (var q = 0; q < 6; q++) { var p = w(wx + Math.sin(q * 0.7) * 0.4, 1.9 + q * 0.95); var p0 = w(wx, 1.2); add(p[0], p[1], Math.atan2(p0[0] - p[0], p0[1] - p[1]), "trucks", q / 6 * 0.5 + R() * 0.1, "idle"); }
      for (var i = 0, tries = 0; i < (cnt.truckGroups || 4) && tries < 300; tries++) { var lx = -3.5 + R() * 8, lz = 4 + R() * 6; var gc = w(lx, lz); if (near(gc[0], gc[1], 1.4)) continue; var m = 2 + Math.floor(R() * 3), rr = 0.65 + m * 0.1, rk = 0.2 + R() * 0.8; for (var k = 0; k < m; k++) { var a = k / m * TAU + R() * 0.4, x = gc[0] + Math.cos(a) * rr, z = gc[1] + Math.sin(a) * rr; add(x, z, Math.atan2(gc[0] - x, gc[1] - z), "trucks", rk, "stand"); } i++; } });
    // picnic: the bench seats (sitting, facing the table)
    SOL.forEach(function (sd, i) { if (!sd.seat || !sd.picnic) return; add(sd.x, sd.z, sd.face, "picnic", R(), "sit"); out[out.length - 1][2] = sd.face; out[out.length - 1][7] = sd; });
    // the lawn: small circles of people talking
    var lawn = smoothClosed(C("site.lawn", []), 4), want2 = cnt.lawn || 60, got = 0;
    for (var tries2 = 0; got < want2 && tries2 < 600; tries2++) { var bb = C("site.bounds"); var gx = lerp(-229, -171, R()), gz = lerp(-152, -76, R()); if (!inPoly(lawn, gx, gz) || near(gx, gz, 1.6)) continue; var m = 2 + Math.floor(R() * 4), rr = 0.75 + m * 0.12, rk = R(); for (var k2 = 0; k2 < m && got < want2; k2++) { var a2 = k2 / m * TAU + R() * 0.4, x2 = gx + Math.cos(a2) * rr, z2 = gz + Math.sin(a2) * rr; add(x2, z2, Math.atan2(gx - x2, gz - z2), "lawn", clamp(rk + (R() - 0.5) * 0.2, 0, 1), R() < 0.75 ? "stand" : "idle"); got++; } }
    // the plaza: more circles on the decomposed granite, clear of the furniture, the lawn and the dance floor
    var bnd = C("site.bounds", [-245, -165, -132, -30]), want3 = cnt.plaza || 0, got3 = 0;
    for (var tries3 = 0; got3 < want3 && tries3 < 1500; tries3++) { var hx2 = lerp(bnd[0] + 2, bnd[2] - 2, R()), hz2 = lerp(bnd[1] + 2, bnd[3] - 2, R()); if (inPoly(lawn, hx2, hz2) || onFloor(hx2, hz2) || near(hx2, hz2, 2.0)) continue; var m3 = 2 + Math.floor(R() * 3), r3 = 0.7 + m3 * 0.12, rk3 = R(); for (var k3 = 0; k3 < m3 && got3 < want3; k3++) { var a3 = k3 / m3 * TAU + R() * 0.4, x3 = hx2 + Math.cos(a3) * r3, z3 = hz2 + Math.sin(a3) * r3; add(x3, z3, Math.atan2(hx2 - x3, hz2 - z3), "lawn", clamp(rk3 + (R() - 0.5) * 0.2, 0, 1), R() < 0.8 ? "stand" : "idle"); got3++; } }
    return out;
  }
  // every person is a record; each (body, motion) has a near mesh (about 1,300 triangles a person) and a far one (about 430).
  // Twice a second (or when you move 4 m, a zone level moves, or you sit down) the visible people are written into the two
  // meshes by their distance to the camera: only the people a zone needs are drawn, each at the detail its distance needs.
  var NEAR_D = 32;
  function buildCrowd() {
    if (CR.g || !CR.data) return; var t0 = nowMs(); crowdMat(); var spots = crowdSpots(), pal = C("crowd.palette", {}), R = rng(4242); var g = new THREE.Group(); g.name = "fest crowd"; g.userData.noCull = true; CR.g = g; CR.spots = spots;
    var hx = function (s) { return new THREE.Color("#" + s).multiplyScalar(0.72); }, pick = function (a) { return a[Math.floor(R() * a.length)]; };
    var N = spots.length, MT = CR.mt = new Float32Array(N * 16), CO = CR.co = new Float32Array(N * 12), PA = CR.pa = new Float32Array(N * 4), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
    spots.forEach(function (s, i) { var y = gh(s[0], s[1]) + 0.06; s.y = y; var ss = (s[6] === "f" ? 0.97 : 1.0) * (0.94 + R() * 0.1); sc.set(ss, ss, ss); q.setFromAxisAngle(up, s[2]); m4.compose(new THREE.Vector3(s[0], y, s[1]), q, sc); m4.toArray(MT, i * 16);
      hx(pick(pal.skin || ["e0b48e"])).toArray(CO, i * 12); hx(pick(pal.shirt || ["3a4a5e"])).toArray(CO, i * 12 + 3); hx(pick(pal.pants || ["2b3a4a"])).toArray(CO, i * 12 + 6); hx(pick(pal.hair || ["2a2a2a"])).toArray(CO, i * 12 + 9);
      var mo = s[5]; PA[i * 4] = R() * TAU; PA[i * 4 + 1] = mo === "dance" || mo === "dance2" ? 5.6 + R() * 1.6 : mo === "sit" ? 0.9 + R() * 0.5 : 1.0 + R() * 0.8; PA[i * 4 + 2] = s[3]; PA[i * 4 + 3] = s[4]; });
    var by = {}; spots.forEach(function (s, i) { var k = s[6] + ":" + MOTIONS[s[5]]; (by[k] || (by[k] = [])).push(i); });
    var B = C("site.bounds", [-245, -165, -132, -30]), sph = new THREE.Sphere(new THREE.Vector3((B[0] + B[2]) / 2, gh((B[0] + B[2]) / 2, (B[1] + B[3]) / 2) + 1, (B[1] + B[3]) / 2), 95);
    var mk = function (geo, mat, n, name, attrs) { var im = new THREE.InstancedMesh(geo, mat, n); im.name = name; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); attrs.forEach(function (a) { var at = new THREE.InstancedBufferAttribute(new Float32Array(n * a[1]), a[1]); at.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(a[0], at); }); im.count = 0; im.boundingSphere = sph.clone(); im.castShadow = false; im.receiveShadow = true; im.userData.shSet = true; g.add(im); CR.meshes.push(im); return im; };
    var AT = [["iSk", 3], ["iSh", 3], ["iPa", 3], ["iHa", 3], ["iPar", 4]];
    CR.groups = Object.keys(by).map(function (k) { var parts = k.split(":"), ids = by[k]; var gF = crowdGeo(parts[0], parts[1]), gL = crowdGeo(parts[0] + "_lo", parts[1]) || crowdGeo(parts[0], parts[1]); if (!gF) return null; return { k: k, ids: ids, full: mk(gF, MAT.crowd, ids.length, "fest crowd " + k, AT), low: mk(gL, MAT.crowd, ids.length, "fest crowd lo " + k, AT) }; }).filter(Boolean);
    var bq = new THREE.PlaneGeometry(1.0, 1.0); bq.rotateX(-PI / 2); var bm = new THREE.InstancedMesh(bq, MAT.blob, N); bm.name = "fest crowd blobs"; bm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); var bat = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4); bat.setUsage(THREE.DynamicDrawUsage); bq.setAttribute("iPar", bat); bm.count = 0; bm.boundingSphere = sph.clone(); bm.castShadow = false; bm.receiveShadow = false; bm.renderOrder = 2; g.add(bm); CR.blob = bm;
    scene.add(g); FE.n.crowd = N; FE.n.crowdMeshes = CR.meshes.length + 1; FE.n.crowdMs = Math.round(nowMs() - t0); CR.last = null; crowdUpdate(true);
    try { var W = window.PLAN_PERF; if (W && W.warmGroup) W.warmGroup(g, { name: "fest crowd" }); } catch (e) {}
  }
  var _bm = new THREE.Matrix4();
  function crowdUpdate(force) {
    if (!CR.groups) return; var cam = camera.position, L = CR.last, hide = CR.hideAt; var key = CR.lvl.map(function (v) { return Math.round(v * 50); }).join(",") + "|" + (hide ? hide[0].toFixed(1) + "," + hide[1].toFixed(1) : "");
    if (!force && L && Math.abs(L.x - cam.x) + Math.abs(L.z - cam.z) < 4 && L.key === key) return; CR.last = { x: cam.x, z: cam.z, key: key }; var t0 = nowMs();
    var MT = CR.mt, CO = CR.co, PA = CR.pa, S = CR.spots, nb = 0, bmA = CR.blob.instanceMatrix.array, bpA = CR.blob.geometry.attributes.iPar.array, tris = 0;
    CR.groups.forEach(function (G) { var nf = 0, nl = 0; var F = G.full, Lo = G.low, fa = F.geometry.attributes, la = Lo.geometry.attributes;
      for (var j = 0; j < G.ids.length; j++) { var i = G.ids[j], s = S[i]; if (s[4] > CR.lvl[s[3]] + 0.002) continue; if (hide && Math.abs(s[0] - hide[0]) < 0.45 && Math.abs(s[1] - hide[1]) < 0.45) continue;
        var d = Math.hypot(s[0] - cam.x, s[1] - cam.z), M = d < NEAR_D ? F : Lo, A = d < NEAR_D ? fa : la, o = d < NEAR_D ? nf++ : nl++;
        M.instanceMatrix.array.set(MT.subarray(i * 16, i * 16 + 16), o * 16); A.iSk.array.set(CO.subarray(i * 12, i * 12 + 3), o * 3); A.iSh.array.set(CO.subarray(i * 12 + 3, i * 12 + 6), o * 3); A.iPa.array.set(CO.subarray(i * 12 + 6, i * 12 + 9), o * 3); A.iHa.array.set(CO.subarray(i * 12 + 9, i * 12 + 12), o * 3); A.iPar.array.set(PA.subarray(i * 4, i * 4 + 4), o * 4);
        if (d < 80) { _bm.makeTranslation(s[0], s.y + 0.04, s[1]); _bm.toArray(bmA, nb * 16); bpA[nb * 4 + 2] = s[3]; bpA[nb * 4 + 3] = 0; nb++; } }
      [[F, fa, nf], [Lo, la, nl]].forEach(function (q) { q[0].count = q[2]; if (q[2]) { q[0].instanceMatrix.needsUpdate = true; ["iSk", "iSh", "iPa", "iHa", "iPar"].forEach(function (k) { q[1][k].needsUpdate = true; }); } }); tris += nf * (F.geometry.index.count / 3) + nl * (Lo.geometry.index.count / 3); });
    CR.blob.count = nb; if (nb) { CR.blob.instanceMatrix.needsUpdate = true; CR.blob.geometry.attributes.iPar.needsUpdate = true; } FE.n.crowdTris = Math.round(tris); FE.n.crowdShown = nb; FE.n.crowdUpd = (FE.n.crowdUpd || 0) + 1; FE.n.crowdUpdMs = +(nowMs() - t0).toFixed(2);
  }
  // ambient lines: a bubble over someone in the busiest zone near you
  function bubbleFrame(now) {
    if (CR.bubble && now - CR.bubbleAt > 5500) { scene.remove(CR.bubble); try { CR.bubble.material.map.dispose(); CR.bubble.material.dispose(); } catch (e) {} CR.bubble = null; }
    if (!CR.spots || CR.bubble || now < CR.nextBubble || !player || FE.noBubbles) return; CR.nextBubble = now + 9000 + Math.random() * 7000;
    var px = player.position.x, pz = player.position.z, best = null, bd = 16, names = ZONES, fx = 0, fz = -1; try { fx = -Math.sin(yaw); fz = -Math.cos(yaw); } catch (e) {}
    for (var i = 0; i < CR.spots.length; i++) { var s = CR.spots[i]; if (s[4] > CR.lvl[s[3]]) continue; var dx = s[0] - px, dz = s[1] - pz, d = Math.hypot(dx, dz); if (d < bd && d > 4 && (dx * fx + dz * fz) > d * 0.3 && Math.random() < 0.35) { bd = d; best = s; } }
    if (!best) return; var L = C("lines." + names[best[3]], []); if (!L.length || typeof makeBubble !== "function") return;
    try { var b = makeBubble(L[Math.floor(Math.random() * L.length)]); b.position.set(best[0], gh(best[0], best[1]) + (best[5] === "sit" ? 1.75 : 2.3), best[1]); scene.add(b); CR.bubble = b; CR.bubbleAt = now; FE.n.bubbles = (FE.n.bubbles || 0) + 1; } catch (e) { note("bubble", e); }
  }

  // ───────────────────────── the staff: a few rigged people from the client (host, DJ, bartenders, cooks), built when you come near ─────────────────────────
  var ST = FE.staff || (FE.staff = { list: [], built: false, idx: 0, plan: null });
  function staffPlan() {
    if (ST.plan) return ST.plan; var S = C("staff", {}), out = [], site = C("site", {}); var Fs = FE.stageF;
    var put1 = function (id, x, y, z, yaw, talk) { var A = S[id]; if (!A) return; out.push({ id: id, A: A, x: x, y: y, z: z, yaw: yaw, talk: !!talk }); };
    if (site.host) put1("jordan", site.host.x, gh(site.host.x, site.host.z), site.host.z, site.host.face || 0, true);
    if (Fs) { var p = Fs.w(0, 0.05); put1("djsol", p[0], Fs.y + (C("site.stage.h", 1.2)), p[1], Fs.yaw); }
    (site.bars || []).forEach(function (B, i) { var c = Math.cos(B.face), s = Math.sin(B.face), lz = B.small ? -1.0 : B.d / 2 - 1.05, lx = B.small ? 0 : -1.2; put1(["mara", "theo", "ines"][i], B.x + lx * c + lz * s, gh(B.x, B.z) + (B.small ? 0 : 0.08), B.z - lx * s + lz * c, B.face); });
    (site.trucks || []).forEach(function (T, i) { if (!T.F) return; var p2 = T.F.w(T.win[0], 0.15); put1(["ray", "lupe", "ben", "gio"][i], p2[0], T.F.y + 0.9, p2[1], T.face); });
    return (ST.plan = out);
  }
  function staffFrame() {
    if (typeof avatar !== "function" || !player) return; var P = staffPlan(); var c = C("hub", { x: -190, z: -112 }); var d = Math.hypot(player.position.x - c.x, player.position.z - c.z);
    if (ST.idx < P.length && d < 170) { var s = P[ST.idx++]; try { var A = s.A; var g = avatar("fest_" + s.id, s.talk ? A.name : "", A.look || {}, A.hat || null, null); g.position.set(s.x, s.y, s.z); g.rotation.y = s.yaw; g.traverse(function (o) { if (o.isMesh) o.castShadow = false; }); if (!s.talk) try { g.userData.label.visible = false; } catch (e) {} scene.add(g); s.g = g;
        if (s.talk) { var talk = (A.talk || []).map(function (q) { return { t: q.t, o: q.o }; }); var cst = { id: s.id, name: A.name, role: A.role, pos: [s.x, s.z], look: A.look, hat: null, outfit: null, greet: A.greet || ["Welcome."], talk: talk, kw: [], g: g, rot: s.yaw }; CAST.push(cst); hotspots.push({ x: s.x, z: s.z, r: 4, t: A.name, k: A.role + " · press E to talk", p: talk[0] ? talk[0].t : "", play: "npc:" + s.id }); s.cast = cst; }
        ST.list.push(s); FE.n.staff = ST.list.length; } catch (e) { note("staff " + s.id, e); } }
    var dj = eventAt(hourNow()); var djOn = !!(dj && dj.id === "djset");
    ST.list.forEach(function (s) { if (!s.g) return; var dd = Math.hypot(s.g.position.x - player.position.x, s.g.position.z - player.position.z); s.g.visible = dd < 140; if (s.id === "djsol") { var u = s.g.userData; if (djOn && !(u.dance && u.dance.until === Infinity)) u.dance = { clip: "dance2", until: Infinity }; else if (!djOn && u.dance) u.dance = null; } });
  }
  function staffAnim(dt) { if (FRAME_N % 2) return; ST.list.forEach(function (s) { if (!s.g || s.cast || !s.g.visible) return; try { animateWalk(s.g, 0, dt * 2); } catch (e) {} }); }

  // ───────────────────────── interaction: the dance battle on the floor, prompts, stamps ─────────────────────────
  function onFloor(x, z) { var D = FE.dance; if (!D) return false; var fx = Math.sin(D.yaw), fz = Math.cos(D.yaw), dx = x - D.x, dz = z - D.z; var a = dx * fx + dz * fz, b = dx * fz - dz * fx; return Math.abs(a) < D.d / 2 && Math.abs(b) < D.w / 2; }
  function busy() { try { return (typeof riding !== "undefined" && riding) || (typeof SIT !== "undefined" && SIT.on) || (typeof inside !== "undefined" && inside) || (typeof cartMode !== "undefined" && cartMode) || (typeof DANCE !== "undefined" && DANCE.on) || (typeof FLY !== "undefined" && FLY.on); } catch (e) { return false; } }
  function award(id) { try { var PP = window.PLAN_PROGRESS; if (PP && PP.award && id) PP.award("stamp", { id: id }); } catch (e) {} }
  function handleE() {
    if (!FE.ready || !player || busy()) return false;
    if (onFloor(player.position.x, player.position.z) && typeof startDance === "function") { FE.danceOn = true; try { startDance(); } catch (e) { note("dance", e); FE.danceOn = false; return false; } award(C("progress.dance", "")); FE.n.dances = (FE.n.dances || 0) + 1; return true; }
    return false;
  }
  function promptFrame() { try { if (!FE.ready || !player || busy()) return; var el = $id("prompt"), t = $id("prompt-t"); if (!el || !t) return; if (onFloor(player.position.x, player.position.z)) { t.innerHTML = "<b>E</b> &nbsp;" + C("prompts.dance", "dance battle"); el.classList.add("on"); } } catch (e) { note("prompt", e); } }
  function install() {
    if (FE.installed) return; FE.installed = true; var o = FE.orig = {};
    try { o.openNearest = openNearest; openNearest = function () { try { if (handleE()) return; } catch (e) { note("E", e); } return o.openNearest.apply(this, arguments); }; } catch (e) { note("wrap E", e); }
    try { o.updateZone = updateZone; updateZone = function () { var r = o.updateZone.apply(this, arguments); promptFrame(); return r; }; } catch (e) { note("wrap zone", e); }
    // the dance battle ends when you walk 70 m from the Bowl: while it runs here, the floor in front of the Side Stage stands in for the Bowl
    try { o.updateDance = updateDance; updateDance = function () { if (!FE.danceOn) return o.updateDance.apply(this, arguments); if (typeof DANCE === "undefined" || !DANCE.on) { FE.danceOn = false; return o.updateDance.apply(this, arguments); } var real = SITES.concert, D = FE.dance; SITES.concert = { cx: D.x, cz: D.z, hype: FE.hype || 0 }; try { return o.updateDance.apply(this, arguments); } finally { FE.hype = SITES.concert && SITES.concert.hype; SITES.concert = real; if (!DANCE.on) FE.danceOn = false; } }; } catch (e) { note("wrap dance", e); }
  }
  var ARR = FE.arr || (FE.arr = { g: false, d: false });
  function stampFrame() { if (!player) return; var x = player.position.x, z = player.position.z, b = C("site.bounds", [-245, -165, -132, -30]);
    if (!ARR.g && x > b[0] && x < b[2] && z > b[1] && z < b[3]) { ARR.g = true; award(C("progress.grounds", "")); }
    if (!ARR.d && x > -250 && x < -150 && z > -181 && z < -167) { ARR.d = true; award(C("progress.dropoff", "")); } }

  // ───────────────────────── the frame: night glow, the schedule, crowd levels, lamps, staff, bubbles, the toast ─────────────────────────
  var FR = FE.fr || (FE.fr = { t: 0, k: 0 });
  function frameHook(dt, now) {
    if (FE.off || !FE.ready) return; dt = Math.min(dt || 0.016, 0.1); FR.k++;
    try {
      var n = clamp((nightK() - 0.02) * 3.2, 0, 1); U.uT.value = (U.uT.value + dt) % 10000; U.uNight.value = n; U.uEm.value = 0.25 + 3.4 * n; U.uEmA.value = 0.1 + 0.85 * n; U.uGlow.value = 0.28 * n; U.uDay.value = 1 - n; U.uScreen.value = 1.25 + 0.9 * n;
      var cam = camera.position, hb = C("hub", { x: -190, z: -112 }), dc = Math.hypot(cam.x - hb.x, cam.z - hb.z);
      if (FE.main) FE.main.visible = dc < 1100; if (FE.flames) FE.flames.visible = dc < 320; U.uBeam.value = n * clamp(CR.lvl[0] * 1.3, 0, 1); if (FE.beams) FE.beams.visible = U.uBeam.value > 0.01 && dc < 700; if (FE.glows) FE.glows.visible = n > 0.02 && dc < 700;
      if (CR.g) CR.g.visible = dc < C("crowd.near", 260) && !(typeof inside !== "undefined" && inside);
      // crowd levels follow the schedule (eased), people at a seat you sit on step aside
      if (FR.k % 15 === 1) { var L = levels(hourNow()), qk = FE.qk || (FE.qk = (function () { try { return QUAL.level === "low" ? 0.5 : QUAL.level === "medium" ? 0.7 : 1; } catch (e) { return 1; } })()); ZONES.forEach(function (z, i) { CR.tgt[i] = (L[z] || 0) * qk; }); }
      for (var i = 0; i < 5; i++) { CR.lvl[i] += (CR.tgt[i] - CR.lvl[i]) * Math.min(1, dt * 0.6); if (CR.u) CR.u.uZ.value[i] = CR.lvl[i]; }
      CR.hideAt = (typeof SIT !== "undefined" && SIT.on && player) ? [player.position.x, player.position.z] : null; if (FR.k % 15 === 2 && CR.g && CR.g.visible) crowdUpdate(false);
      if (!CR.g && CR.data && dc < 600) buildCrowd(); else if (!CR.data && !CR.loading && !CR.failed && dc < 900) loadCrowd();
      // pooled lamps: real light only through the client's light pool (these lamps are hidden; the pool reads them)
      (FE.lightObjs || []).forEach(function (l) { l.intensity = dc < 220 ? l.userData.k0 * n : 0; });
      if (FR.k % 60 === 7) { redrawBoard(false); redrawScreen(false); }
      if (FR.k % 10 === 3) toastFrame(); if (FR.k % 30 === 11) stampFrame(); if (FR.k % 20 === 5 && dc < 220) staffFrame(); staffAnim(dt);
      if (FR.k % 12 === 9 && dc < 200) bubbleFrame(nowMs());
    } catch (e) { note("frame", e); }
  }

  // ───────────────────────── landscaping (polish pass): dense desert beds round the lawn edge and along the walks ─────────────────────────
  // Laid out once in the terrain hook (so the instanced kinds go in before the client builds its instancing): palo verdes in bloom,
  // bushes, prickly pear and boulders from the existing kinds; brittlebush, agave rosettes and desert grass tufts procedural, merged
  // into the grounds' one std mesh at defer (about 70,000 triangles in all), on a strip of dark gravel.
  function polyEdgeDist(poly, x, z) { var best = 1e9; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var a = poly[j], b = poly[i]; var vx = b[0] - a[0], vz = b[1] - a[1]; var t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1), 0, 1); best = Math.min(best, Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t)); } return best; }
  // what stands where (from the config, before any solid exists): discs [x, z, r]
  function occupants() {
    if (FE.occ) return FE.occ; var s = C("site", {}), o = [], P = s.picnic || {}; (P.lawn || []).concat(P.plaza || []).forEach(function (p) { o.push([p[0], p[1], 2.0]); });
    (s.poles || []).concat(s.plazaPoles || []).forEach(function (p) { o.push([p[0], p[1], 0.9]); }); (s.firebowls || []).forEach(function (p) { o.push([p[0], p[1], 1.6]); }); (s.bins || []).forEach(function (p) { o.push([p[0], p[1], 1.6]); }); (s.banners || []).forEach(function (p) { o.push([p[0], p[1], 1.0]); });
    (s.boards || []).concat(s.wayfinding || []).forEach(function (p) { o.push([p.x, p.z, 2.2]); }); if (s.info) o.push([s.info.x, s.info.z, 2.6]); if (s.host) o.push([s.host.x, s.host.z, 1.8]); (s.lounges || []).forEach(function (l) { o.push([l.x, l.z, l.r + 1.5]); }); (s.props || []).forEach(function (p) { o.push([p[1], p[2], 1.2]); });
    (s.trucks || []).forEach(function (T) { var c = Math.cos(T.face), sn = Math.sin(T.face); for (var lx = -3.6; lx <= 4.8; lx += 1.2) { o.push([T.x + lx * c, T.z - lx * sn, 2.0]); o.push([T.x + lx * c + 4 * sn, T.z - lx * sn + 4 * c, 2.0]); } });
    (s.bars || []).forEach(function (B) { o.push([B.x, B.z, Math.max(B.w, B.d) / 2 + 2.6]); var c = Math.cos(B.face), sn = Math.sin(B.face); o.push([B.x + 4.5 * sn, B.z + 4.5 * c, 4.0]); });
    if (s.stage) { var st = s.stage, f = st.face, dn = s.dance || { w: 22, d: 15, ahead: 13.5 }; o.push([st.x, st.z, 10.5]); for (var a = -dn.d / 2; a <= dn.d / 2; a += 3) for (var b = -dn.w / 2; b <= dn.w / 2; b += 3) o.push([st.x + f[0] * (dn.ahead + a) + f[1] * b, st.z + f[1] * (dn.ahead + a) - f[0] * b, 2.2]); }
    (s.beds || []).forEach(function (B) { o.push([B.c[0], B.c[1], B.r + 0.6]); }); return (FE.occ = o);
  }
  function occupied(x, z, r) { var o = occupants(); for (var i = 0; i < o.length; i++) { var q = o[i]; if (Math.abs(q[0] - x) < q[2] + r && Math.abs(q[1] - z) < q[2] + r && Math.hypot(q[0] - x, q[1] - z) < q[2] + r) return true; } return false; }
  function genBeds() {
    if (FE.strips) return FE.strips; var out = [], lawn = smoothClosed(C("site.lawn", []), 5), b = C("site.bounds", [-245, -165, -132, -30]);
    var inB = function (x, z, m) { return x > b[0] + m && x < b[2] - m && z > b[1] + m && z < b[3] - m; };
    // round the lawn: 6.5 m beds every 11 m, 2.2 m outside the lawn edge
    var cx = 0, cz = 0; lawn.forEach(function (p) { cx += p[0]; cz += p[1]; }); cx /= lawn.length; cz /= lawn.length;
    var dense = [], acc = 0; for (var i = 0; i < lawn.length; i++) { var p = lawn[i], q = lawn[(i + 1) % lawn.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); for (var t = 0; t < L; t += 1) { var x = p[0] + (q[0] - p[0]) * t / L, z = p[1] + (q[1] - p[1]) * t / L; var tx = (q[0] - p[0]) / L, tz = (q[1] - p[1]) / L, nx = tz, nz = -tx; if (nx * (x - cx) + nz * (z - cz) < 0) { nx = -nx; nz = -nz; } dense.push([x + nx * 2.7, z + nz * 2.7, acc]); acc++; } }
    for (var s0 = 2; s0 < dense.length - 9; s0 += 12) { var seg = dense.slice(s0, s0 + 9); while (seg.length > 3 && !seg.every(function (q) { return inB(q[0], q[1], 1.4) && !occupied(q[0], q[1], 1.6) && polyEdgeDist(lawn, q[0], q[1]) > 1.6 && !inPoly(lawn, q[0], q[1]); })) seg = seg.slice(1, seg.length - 1); if (seg.length > 3) out.push({ pts: seg.map(function (q) { return [q[0], q[1]]; }), w: 3.0, kind: "edge" }); }
    // along the walks out of the grounds, both sides, 1.7 m clear of the walk
    (C("paths", []) || []).forEach(function (P) { if (!/link|market/.test(P.id)) return; [-1, 1].forEach(function (sd) { var run = []; var flush = function () { if (run.length >= 4) out.push({ pts: run, w: 2.4, kind: "walk" }); run = []; };
      for (var i = 0; i < P.pts.length - 1; i++) { var a = P.pts[i], c = P.pts[i + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]), ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L, off = sd * (P.w / 2 + 1.7); for (var t = 0.5; t < L; t += 1) { var x = a[0] + ux * t - uz * off, z = a[1] + uz * t + ux * off; if (inB(x, z, -1.5) || z > 5.5 || occupied(x, z, 1.0) || Math.abs(x + 118) < 6 && z > -85) { flush(); continue; } run.push([x, z]); } } flush(); }); });
    // planting islands in the open plaza: round beds of 2.6 to 3.8 m, 4 m apart from everything else
    var isl = FE.islands = [], Ri = rng(808), far = function (x, z, r) { for (var i = 0; i < isl.length; i++) if (Math.hypot(isl[i].c[0] - x, isl[i].c[1] - z) < isl[i].r + r + 4) return false; for (var j = 0; j < out.length; j++) { var P = out[j].pts; for (var k = 0; k < P.length; k++) if (Math.hypot(P[k][0] - x, P[k][1] - z) < r + out[j].w / 2 + 3) return false; } return true; };
    for (var tries = 0; tries < 900 && isl.length < (C("site.islands", 16)); tries++) { var r = 2.6 + Ri() * 1.2, x = lerp(b[0] + r + 1.5, b[2] - r - 1.5, Ri()), z = lerp(b[1] + r + 1.5, b[3] - r - 1.5, Ri()); if (inPoly(lawn, x, z) || polyEdgeDist(lawn, x, z) < r + 1.8 || occupied(x, z, r + 0.9) || !far(x, z, r)) continue; isl.push({ c: [x, z], r: r }); }
    FE.n.strips = out.length; FE.n.islands = isl.length; return (FE.strips = out);
  }
  function stripPoly(S) { var P = S.pts, l = [], r = []; for (var i = 0; i < P.length; i++) { var a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], tx = b[0] - a[0], tz = b[1] - a[1], L = Math.hypot(tx, tz) || 1, nx = -tz / L, nz = tx / L, w = S.w / 2 * (i === 0 || i === P.length - 1 ? 0.55 : 1); l.push([P[i][0] + nx * w, P[i][1] + nz * w]); r.push([P[i][0] - nx * w, P[i][1] - nz * w]); } return smoothClosed(l.concat(r.reverse()), 2); }
  function nearStrip(x, z, r) { var I = FE.islands || []; for (var ii = 0; ii < I.length; ii++) if (Math.hypot(I[ii].c[0] - x, I[ii].c[1] - z) < I[ii].r + r) return true; var S = FE.strips || []; for (var i = 0; i < S.length; i++) { var P = S[i].pts; for (var j = 0; j < P.length; j++) if (Math.abs(P[j][0] - x) < S[i].w / 2 + r && Math.abs(P[j][1] - z) < S[i].w / 2 + r) return true; } return false; }
  // the terrain hook part: instanced kinds now, procedural plants listed for the defer build
  function landPlant(put1, canPut2, R) {
    var S = genBeds(), proc = FE.landProc = FE.landProc || [], pick = function (a) { return a[Math.floor(R() * a.length)]; };
    var rocks = ["land_rock0", "land_rock1", "land_rockL0", "land_rockL1", "land_rrock0"].filter(canPut2), bushes = ["bush1", "bush2"].filter(canPut2), pears = [], tree = canPut2("paloverde") ? "paloverde" : null;
    S.forEach(function (St, si) { var P = St.pts, sinceTree = si % 3 === 0 ? 99 : 4;
      for (var i = 0; i < P.length; i++) { var a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], tx = b[0] - a[0], tz = b[1] - a[1], L = Math.hypot(tx, tz) || 1, nx = -tz / L, nz = tx / L;
        for (var k = 0; k < 3; k++) { var off = (R() - 0.5) * St.w * 0.8, x = P[i][0] + nx * off + (R() - 0.5) * 0.5, z = P[i][1] + nz * off + (R() - 0.5) * 0.5, q = R(), rot = R() * TAU;
          if (tree && sinceTree > 9 && k === 0 && R() < 0.35) { put1(tree, x, z, 0.75 + R() * 0.35); sinceTree = 0; continue; }
          if (q < 0.34) proc.push(["grass", x, z, rot, 0.8 + R() * 0.5]); else if (q < 0.62) proc.push(["brittle", x, z, rot, 0.75 + R() * 0.5]); else if (q < 0.74) proc.push(["agave", x, z, rot, 0.7 + R() * 0.6]);
          else if (q < 0.82) { if (rocks.length) put1(pick(rocks), x, z, 0.5 + R() * 0.6); else proc.push(["rock", x, z, rot, 0.7 + R() * 0.9]); } else if (q < 0.86 && bushes.length) put1(pick(bushes), x, z, 0.45 + R() * 0.35); else if (q < 0.9 && pears.length) put1(pick(pears), x, z, 0.6 + R() * 0.3); else proc.push(["grass", x, z, rot, 1.0 + R() * 0.4]); }
        sinceTree++; } });
    (FE.islands || []).forEach(function (I, ii) { var n = Math.round(I.r * I.r * 2.2); if (tree && ii % 2 === 0) put1(tree, I.c[0] + (R() - 0.5), I.c[1] + (R() - 0.5), 0.8 + R() * 0.35); else if (canPut2("saguaro_mid")) put1(ii % 4 === 1 ? "saguaro_mid" : "saguaro", I.c[0] + (R() - 0.5), I.c[1] + (R() - 0.5), 0.8 + R() * 0.3);
      for (var k = 0; k < n; k++) { var a = R() * TAU, d = I.r * Math.sqrt(0.08 + R() * 0.85), x = I.c[0] + Math.cos(a) * d, z = I.c[1] + Math.sin(a) * d, q = R(), rot = R() * TAU;
        if (q < 0.32) proc.push(["grass", x, z, rot, 0.8 + R() * 0.5]); else if (q < 0.6) proc.push(["brittle", x, z, rot, 0.8 + R() * 0.5]); else if (q < 0.78) proc.push(["agave", x, z, rot, 0.75 + R() * 0.6]); else if (q < 0.88) { if (rocks.length) put1(pick(rocks), x, z, 0.6 + R() * 0.7); else proc.push(["rock", x, z, rot, 0.8 + R() * 1.0]); } else if (q < 0.94 && pears.length) put1(pick(pears), x, z, 0.6 + R() * 0.3); else if (bushes.length) put1(pick(bushes), x, z, 0.45 + R() * 0.3); } });
    FE.n.landProc = proc.length;
  }
  function brittleK(F, s, R) { var g = new THREE.IcosahedronGeometry(0.42, 1); F.geo("stdNS", R() < 0.5 ? 0x67704f : 0x737c5c, g, 0, 0.2 * s, 0, R() * TAU, 0, 0, s, 0.62 * s, s, [0.95, 0, 0]);
    for (var i = 0; i < 14; i++) { var a = R() * TAU, e = 0.3 + R() * 1.1, r = 0.42 * s; F.sph("stdNS", 0xe8b416, 0.055 * s, Math.cos(a) * Math.cos(e) * r, 0.2 * s + Math.sin(e) * r * 0.62 + 0.02, Math.sin(a) * Math.cos(e) * r, 4, 1, [0.75, 0, 0.12]); } }
  function agaveK(F, s, R) { var n = 15; for (var i = 0; i < n; i++) { var Lh = (0.42 + R() * 0.25) * s, g = new THREE.ConeGeometry(0.06 * s, Lh, 3); g.translate(0, Lh / 2, 0); var inner = i % 3 === 0; F.geo("stdNS", inner ? 0x86a29a : 0x6f8c85, g, 0, 0, 0, i / n * TAU + R() * 0.3, inner ? 0.35 : 0.8 + R() * 0.45, 0, 1, 1, 1, [0.6, 0, 0]); } }
  function rockK(F, s, R) { var g = new THREE.IcosahedronGeometry(0.32, 0), p = g.attributes.position; for (var i = 0; i < p.count; i++) { var k = 0.8 + 0.4 * fh3(p.getX(i), p.getY(i), p.getZ(i)); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k); } g.computeVertexNormals(); F.geo("std", R() < 0.5 ? 0xa48c72 : 0x8e7a66, g, 0, 0.12 * s, 0, R() * TAU, 0, 0, s, s, s, [0.95, 0, 0]); }
  function fh3(x, y, z) { var v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return v - Math.floor(v); }
  function grassK(F, s, R) { for (var t = 0; t < 4; t++) { var ox = (R() - 0.5) * 0.5, oz = (R() - 0.5) * 0.5; for (var i = 0; i < 6; i++) { var Lh = (0.35 + R() * 0.3) * s, g = new THREE.ConeGeometry(0.016, Lh, 3); g.translate(0, Lh / 2, 0); F.geo("stdNS", R() < 0.55 ? 0xbfae74 : 0x98a062, g, ox, 0, oz, R() * TAU, 0.12 + R() * 0.45, 0, 1, 1, 1, [0.95, 0, 0]); } } }
  // the plants are built once as a few prototypes (four of each, merged), then every plant is one transformed copy
  function landProtos() { if (FE.protos) return FE.protos; var R = rng(5150), P = { brittle: [], agave: [], grass: [], rock: [] };
    Object.keys(P).forEach(function (k) { for (var v = 0; v < 4; v++) { var PK = new Kit(), F = new Fr(PK, 0, 0, 0, 0); if (k === "brittle") brittleK(F, 1, R); else if (k === "agave") agaveK(F, 1, R); else if (k === "rock") rockK(F, 1, R); else grassK(F, 1, R); P[k].push(mergeList(PK.L[k === "rock" ? "std" : "stdNS"] || [])); } });
    return (FE.protos = P); }
  function landBuild(K, KS) { (FE.strips || []).forEach(function (S) { drape(KS, "bed", stripPoly(S), 1.5, 0.12, 3); }); (FE.islands || []).forEach(function (I, i) { drape(KS, "bed", smoothClosed(circlePoly(I.c[0], I.c[1], I.r, 10, 0.22, 91 + i), 3), 1.5, 0.12, 3); });
    var P = landProtos(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    (FE.landProc || []).forEach(function (p, i) { var pr = P[p[0]][i % 4]; if (!pr) return; q.setFromAxisAngle(up, p[3]); m4.compose(new THREE.Vector3(p[1], gh(p[1], p[2]) + 0.1, p[2]), q, new THREE.Vector3(p[4], p[4], p[4])); var g = pr.clone(); g.applyMatrix4(m4); var bk = p[0] === "rock" ? "std" : "stdNS"; (K.L[bk] || (K.L[bk] = [])).push(g); K.tris += g.attributes.position.count / 3; }); }

  // ───────────────────────── the drop-off bay follows the south kerb of Terminal Drive ─────────────────────────
  function roadZ(x) { return x <= -160 ? -203.5 + (x + 310) / 150 * 23.5 : -180 + (x + 160) / 186 * 5; }
  function dropPoly() { var D = C("dropoff", {}), k = D.kerb || -168, out = []; for (var x = -250; x <= -150; x += 10) out.push([x, Math.min(k - 3.5, roadZ(x) + 6.2)]); out.push([-150, k]); out.push([-250, k]); return out; }
  // ───────────────────────── world hook: keep-outs, clearing, paths, hubs, zone, info points ─────────────────────────
  var VEG = /^(bush\d|mesquite|ocotillo|saguaro.*|paloverde|ironwood|desertwillow|barrel_cactus|prickly_pear|cholla|organ_pipe|agave_cluster|yucca_cluster|boulder|fanpalm.*|datepalm|canarypalm|ph_(rock|boulder|shrub|succulent|stones|sandrocks)_?\d*|lamp)$/;
  function footRects() { var b = C("site.bounds", [-245, -165, -132, -30]); var r = [[b[0] - 1.5, b[1] - 1.5, b[2] + 1.5, b[3] + 1.5], [-251, -188, -149, -166]]; (C("paths", []) || []).forEach(function (p) { p.pts.forEach(function (q) { r.push([q[0] - p.w / 2 - 1, q[1] - p.w / 2 - 1, q[0] + p.w / 2 + 1, q[1] + p.w / 2 + 1]); }); }); return r; }
  function inFoot(x, z) { var R = FE.foot || (FE.foot = footRects()); for (var i = 0; i < R.length; i++) { var r = R[i]; if (x > r[0] && x < r[2] && z > r[1] && z < r[3]) return true; } return false; }
  function clearSite() { var removed = 0, keys = new Set(); for (var k in PLACE) { if (!VEG.test(k)) continue; var L = PLACE[k], out = []; for (var i = 0; i < L.length; i++) { var e = L[i]; if (!e.fest && inFoot(e[0], e[2])) { keys.add(Math.round(e[0] * 100) + ":" + Math.round(e[2] * 100)); removed++; } else out.push(e); } if (out.length !== L.length) { L.length = 0; Array.prototype.push.apply(L, out); } }
    if (keys.size) for (var j = COLLIDERS.length - 1; j >= 0; j--) { var c = COLLIDERS[j]; if (keys.has(Math.round(c[0] * 100) + ":" + Math.round(c[1] * 100))) COLLIDERS.splice(j, 1); } FE.n.cleared = (FE.n.cleared || 0) + removed; }
  function keepouts() { var b = C("site.bounds", [-245, -165, -132, -30]); for (var x = b[0] + 6; x < b[2] + 6; x += 11) for (var z = b[1] + 6; z < b[3] + 6; z += 11) KEEPOUT.push([Math.min(x, b[2]), Math.min(z, b[3]), 9]); for (var x2 = -246; x2 <= -150; x2 += 10) KEEPOUT.push([x2, -174, 8]); (C("paths", []) || []).forEach(function (p) { p.pts.forEach(function (q) { KEEPOUT.push([q[0], q[1], p.w / 2 + 1.5]); }); }); }
  function worldHook() {
    if (FE.off || !window.PLAN || FE.world) return; if (!cfg()) { note("cfg", "no plan/festival.json"); return; } FE.world = true; var t0 = nowMs();
    try { clearSite(); } catch (e) { note("clear", e); } try { keepouts(); } catch (e) { note("keepouts", e); }
    try { var PMs = planMats(); (C("paths", []) || []).forEach(function (p) { var n0 = ROADS.length; var rg = ribbon(p.pts, p.w, PMs.dg, 0.1); scene.add(rg); if (ROADS.length > n0) ROADS[ROADS.length - 1].fest = p.id; FE.n.paths = (FE.n.paths || 0) + 1; }); } catch (e) { note("paths", e); }
    try { var H = C("hub", null); if (H) { planAddHub(H.name, H.x, H.z); planNavCats(); } } catch (e) { note("hub", e); }
    try { var lawn = C("site.lawn", []), b = C("site.bounds"); zoneRings.push({ name: C("names.grounds", "The Festival Grounds"), label: C("names.short", "Festival Grounds"), center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], r: 70, k: C("names.kicker", ""), poly: [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], col: "#4dde6f33", plan: "festival", noLabel: true }); } catch (e) { note("zone", e); }
    try { var hs = function (key, x, z, r) { var d = C("info." + key, null); if (!d) return; var h = { x: x, z: z, r: r, t: d.t, k: d.k, p: d.p, fest: key }; hotspots.push(h); (FE.hs = FE.hs || []).push(h); };
      var I = C("site.info", { x: -190, z: -161 }); hs("grounds", I.x, I.z, 4); var sh = C("dropoff.shelter", { x: -205, z: -170.5 }); hs("dropoff", sh.x, sh.z, 4.5);
      var st = C("site.stage", null); if (st) { var c = Math.cos(Math.atan2(st.face[0], st.face[1])), s = Math.sin(Math.atan2(st.face[0], st.face[1])); hs("stage", st.x + 9.5 * c + 3 * s, st.z - 9.5 * s + 3 * c, 3.5); } } catch (e) { note("hotspots", e); }
    install(); FE.n.worldMs = Math.round(nowMs() - t0);
  }
  // ───────────────────────── terrain hook: desert planting in beds, along the campus edges and the paths; parked carts ─────────────────────────
  function terrainHook() {
    if (FE.off || !FE.world || FE.planted) return; FE.planted = true; var R = rng(20261002), n = 0, t0 = nowMs();
    var near = ["agave_cluster", "barrel_cactus", "yucca_cluster", "ph_succulent_1", "bush1", "bush2", "bush1", "bush2", "agave_cluster"].filter(canPut);
    var rocks = ["ph_boulder_1", "ph_rock_1", "ph_rock_3", "ph_rock_3"].filter(canPut);
    var tall = ["saguaro_mid", "saguaro", "saguaro_young", "paloverde", "ocotillo"].filter(canPut);
    var pick = function (a) { return a[Math.floor(R() * a.length)]; };
    var HEAVY = { agave_cluster: "agave", yucca_cluster: "agave", barrel_cactus: "brittle", ph_succulent_1: "grass", prickly_pear: "brittle", land_pear: "brittle", ph_rock_1: "rock", ph_rock_3: "rock" };
    var put1 = function (k, x, z, sc) { if (!k) return; if (HEAVY[k]) { (FE.landProc = FE.landProc || []).push([HEAVY[k], x, z, R() * TAU, (sc || 1) * (HEAVY[k] === "agave" ? 1.3 : HEAVY[k] === "rock" ? 1.6 : 1.1)]); return; } try { put(k, x, z, R() * TAU, sc); var L = PLACE[k]; if (L && L.length) { L[L.length - 1].fest = 1; L[L.length - 1].keep = true; } n++; } catch (e) { note("put " + k, e); } };
    (C("site.beds", []) || []).forEach(function (B, i) { var c = B.c, r = B.r; put1(i % 2 === 1 && canPut("paloverde") ? "paloverde" : pick(["saguaro_mid", "saguaro", "saguaro_young"].filter(canPut)), c[0] + (R() - 0.5) * r * 0.5, c[1] + (R() - 0.5) * r * 0.5, 0.85 + R() * 0.35);
      var m = Math.round(r * 1.1); for (var k = 0; k < m; k++) { var a = R() * TAU, d = r * (0.35 + R() * 0.55); put1(R() < 0.75 ? pick(near) : pick(rocks), c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d, 0.7 + R() * 0.5); } });
    try { landPlant(put1, canPut, R); } catch (e) { note("land", e); }
    (C("site.perimeter", []) || []).forEach(function (P) { var A = P.from, B = P.to, L = Math.hypot(B[0] - A[0], B[1] - A[1]), ux = (B[0] - A[0]) / L, uz = (B[1] - A[1]) / L; for (var t = 1.5; t < L; t += 4.2 + R() * 2.6) { var off = (R() - 0.5) * P.w; var x = A[0] + ux * t - uz * off, z = A[1] + uz * t + ux * off; var q = R(); put1(q < 0.16 ? pick(tall) : q < 0.3 ? pick(rocks) : pick(near), x, z, 0.75 + R() * 0.55); } });
    // either side of the walks out of the grounds
    (C("paths", []) || []).forEach(function (p) { if (p.pts.length < 3) return; for (var i = 0; i < p.pts.length - 1; i++) { var a = p.pts[i], b = p.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); var ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L; for (var t = 1; t < L; t += 4.5 + R() * 2.5) [-1, 1].forEach(function (sd) { if (R() < 0.45) return; var off = sd * (p.w / 2 + 1.2 + R() * 1.5), x = a[0] + ux * t - uz * off, z = a[1] + uz * t + ux * off; if (x > -246 && x < -131 && z > -166 && z < -29) return; put1(R() < 0.12 ? pick(tall) : R() < 0.3 ? pick(rocks) : pick(near), x, z, 0.7 + R() * 0.4); }); } });
    (C("site.props", []) || []).forEach(function (q) { if (canPut(q[0])) put1(q[0], q[1], q[2], q[4] || 1); var L = PLACE[q[0]]; if (L && L.length) L[L.length - 1][3] = q[3] || 0; });
    (C("site.lounges", []) || []).forEach(function (Lg) { for (var i = 0; i < Lg.n; i++) { var a = i / Lg.n * TAU + 0.3, x = Lg.x + Math.cos(a) * Lg.r, z = Lg.z + Math.sin(a) * Lg.r; (FE.lounge = FE.lounge || []).push([x, z, Math.atan2(Lg.x - x, Lg.z - z)]); } });
    try { if (canPut("cart")) (C("dropoff.carts", []) || []).forEach(function (c) { put("cart", c[0], c[1], c[2], 1); }); } catch (e) { note("carts", e); }
    FE.n.planted = n; FE.n.terrainMs = Math.round(nowMs() - t0);
  }
  // ───────────────────────── defer hook: build everything at its final height ─────────────────────────
  function deferHook() {
    if (FE.off || !FE.world || FE.ready) return; var t0 = nowMs(), site = C("site", {}); makeMats(); FE.lamps = [];
    var step = function (name, fn) { var t = nowMs(); try { fn(); } catch (e) { note(name, e); } FE.n["ms_" + name] = Math.round(nowMs() - t); };
    var K = new Kit(), KS = new Kit(), KF = new Kit(), KB = new Kit(), KG = new Kit(); FE.KB = KB; FE.KG = KG; FE.F0 = new Fr(K, 0, 0, 0, 0); var main = new THREE.Group(); main.name = "fest grounds"; FE.main = main;
    var b = site.bounds;
    step("surfaces", function () { drape(KS, "dg", rectPoly(b[0] - 1, b[1] - 0.5, b[2] + 1, b[3] + 0.5, 4), 3, 0.06, 4); var lp = smoothClosed(site.lawn, 5), lg = drape(KS, "lawn", lp, 2.5, 0.1, 3.2); if (lg) { var tb = (site.picnic && site.picnic.lawn) || [], pl = site.poles || [], pa = lg.attributes.position, lw = new Float32Array(pa.count * 2); for (var vi = 0; vi < pa.count; vi++) { var vx = pa.getX(vi), vz = pa.getZ(vi), w = 0; tb.forEach(function (t) { var d = Math.hypot(vx - t[0], vz - t[1]); if (d < 2.8) w = Math.max(w, 0.75 * (1 - d / 2.8)); }); pl.forEach(function (t) { var d = Math.hypot(vx - t[0], vz - t[1]); if (d < 1.6) w = Math.max(w, 0.6 * (1 - d / 1.6)); }); lw[vi * 2] = polyEdgeDist(lp, vx, vz); lw[vi * 2 + 1] = w; } lg.setAttribute("aLw", new THREE.BufferAttribute(lw, 2)); }
      (site.beds || []).forEach(function (B, i) { drape(KS, "bed", smoothClosed(circlePoly(B.c[0], B.c[1], B.r, 9, 0.25, 31 + i), 3), 1.5, 0.13, 3); }); });
    step("land", function () { landBuild(K, KS); });
    step("stage", function () { stage(K, site.stage); var D = FE.dance; var fx = Math.sin(D.yaw), fz = Math.cos(D.yaw), px = fz, pz = -fx, q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (s) { return [D.x + fx * s[0] * D.d / 2 + px * s[1] * D.w / 2, D.z + fz * s[0] * D.d / 2 + pz * s[1] * D.w / 2]; }); drape(KS, "stone", q, 2.5, 0.14, 2.2); });
    step("dropoff", function () { var D = C("dropoff", {}); D.poly = dropPoly(); dropoff(K, KS); });
    step("bars", function () { (site.bars || []).forEach(function (B) { pergola(K, B); }); });
    step("trucks", function () { (site.trucks || []).forEach(function (T) { truck(K, T); }); });
    step("picnic", function () { var R = rng(99), s0 = SOL.length; var P = site.picnic || {}; (P.lawn || []).concat(P.plaza || []).forEach(function (p, i) { var F = picnic(K, p[0], p[1], (i % 2 ? 0.12 : -0.1) + (R() - 0.5) * 0.25, true, R); }); for (var si = s0; si < SOL.length; si++) if (SOL[si].seat) SOL[si].picnic = true; });
    step("poles", function () { var P = site.poles || [], tops = P.map(function (p) { var F = pole(K, p[0], p[1], 9.0, 0.17); return V(p[0], F.y + 8.75, p[1]); });
      (site.drapes || []).forEach(function (d, i) { var A = tops[d[0]], B = tops[d[1]]; if (!A || !B) return; var col = d[2] === "v" ? [0x34127a, 0x40188f, 0x2c0f68][i % 3] : [0x0c6328, 0x117232, 0x0a5622][i % 3]; var g = drapeG(A, B, 2.3, Math.min(3.0, A.distanceTo(B) * 0.11), 11 + i, col); FE.F0.geo("fabric", "keep", g, 0, 0, 0, 0, 0, 0, 1, 1, 1, PM_FAB); FE.n.drapes = (FE.n.drapes || 0) + 1; });
      (site.festoons || []).forEach(function (f) { var A = tops[f[0]], B = tops[f[1]]; if (!A || !B) return; var a = A.clone(), bb = B.clone(); a.y += f[2] - 8.75; bb.y += f[2] - 8.75; festoon(K, a, bb, 0.9, 0.85); });
      var PP = site.plazaPoles || [], pt = PP.map(function (p) { var F = pole(K, p[0], p[1], 5.6, 0.12); return V(p[0], F.y + 5.2, p[1]); }); (site.plazaFestoons || []).forEach(function (f) { var A = pt[f[0]], B = pt[f[1]]; if (A && B) festoon(K, A, B, 0.75, 0.8); }); });
    step("firebowls", function () { (site.firebowls || []).forEach(function (p, i) { firebowl(K, KF, p[0], p[1], i * 1.37 + 0.4); FE.lamps.push({ x: p[0], y: gh(p[0], p[1]) + 1.4, z: p[1], c: 0xff9a4a, k: 5, d: 9, tag: "fire" }); }); });
    step("lounges", function () { (FE.lounge || []).forEach(function (l, i) { adirondack(K, l[0], l[1], l[2], i); }); });
    step("furniture", function () { (site.bins || []).forEach(function (p, i) { bins(K, p[0], p[1], (i * 1.3) % TAU); }); (site.banners || []).forEach(function (p) { banner(K, p[0], p[1], p[2]); }); (site.boards || []).forEach(function (bd) { board(K, bd); }); (site.wayfinding || []).forEach(function (w, i) { wayfind(K, w, i); }); if (site.info) infoSign(K, site.info); });
    step("merge", function () { KS.build(main, true); FE.n.tris = Math.round(K.tris + KS.tris); K.build(main); var fl = new THREE.Group(); fl.name = "fest flames"; KF.build(fl, true); fl.traverse(function (o) { if (o.isMesh) { o.renderOrder = 3; o.castShadow = false; } }); main.add(fl); FE.flames = fl; var bg = new THREE.Group(); bg.name = "fest beams"; KB.build(bg, true); bg.traverse(function (o) { if (o.isMesh) { o.renderOrder = 4; o.castShadow = false; o.receiveShadow = false; } }); main.add(bg); FE.beams = bg; var gg = new THREE.Group(); gg.name = "fest glow"; KG.build(gg, true); gg.traverse(function (o) { if (o.isMesh) { o.renderOrder = 2; o.castShadow = false; o.receiveShadow = false; } }); main.add(gg); FE.glows = gg; scene.add(main); });
    step("lamps", function () { FE.lightObjs = FE.lamps.map(function (L) { var l = new THREE.PointLight(L.c, 0, L.d * 1.3, 1.4); l.position.set(L.x, L.y, L.z); l.userData.k0 = L.k * 4.0; l.userData.tag = L.tag; scene.add(l); return l; }); });
    step("perf", function () { var W = window.PLAN_PERF; if (W && W.warmGroup) W.warmGroup(main, { name: "fest grounds" }); });
    var nm = 0; main.traverse(function (o) { if (o.isMesh) nm++; }); FE.n.meshes = nm; FE.n.solids = SOL.length; FE.n.deferMs = Math.round(nowMs() - t0); FE.ready = true; loadCrowd();
  }

  // ───────────────────────── hooks, API, debug ─────────────────────────
  FE.api = { eventAt: eventAt, nextEvent: nextEvent, levels: levels, onFloor: onFloor, buildCrowd: buildCrowd, showToast: showToast };
  FE.debug = {
    // pin the in-game hour (the harness way): timeOffset so that dayT() is h / 24
    hour: function (h) { try { timeOffset = (h / 24) * DAY_SECONDS - ((Date.now() / 1000) % DAY_SECONDS); } catch (e) {} return hourNow(); },
    levels: function () { return { lvl: CR.lvl.slice(), tgt: CR.tgt.slice(), ev: (eventAt(hourNow()) || {}).id || "quiet" }; },
    full: function () { for (var i = 0; i < 5; i++) { CR.lvl[i] = CR.tgt[i] = 1; } return true; },
    stats: function () { var o = { n: FE.n, errs: FE.errs.slice(), crowd: CR.spots ? CR.spots.length : 0, staff: ST.list.length, lamps: (FE.lightObjs || []).length }; return o; }
  };
  (function hookAll() {
    var set = function (phase, name, fn) { var list = window.PLAN_HOOKS[phase]; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name: name, fn: fn }); };
    set("world", "festWorld", function () { worldHook(); });
    set("terrain", "festTerrain", function () { terrainHook(); });
    set("defer", "festDefer", function () { deferHook(); });
    set("frame", "festFrame", function (dt, now) { frameHook(dt, now); });
  })();
})();
