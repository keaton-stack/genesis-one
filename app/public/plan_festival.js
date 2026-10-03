// R7 FESTIVAL (2 Oct 2026): the Solport Convention Center campus. The Festival Grounds (a lawn and decomposed granite plaza,
// open-air timber bars under pergolas with string lights, the Side Stage with an LED screen, truss and DJ booth, picnic tables
// under white umbrellas, violet and green drapes strung between tall timber poles, food trucks with the green Giveback truck,
// fire bowls, saguaros, palo verdes, agave beds, boulders, bins, wayfinding and schedule boards), the campus paths (to Link Plaza
// and the Landside Walk, the arena forecourt and the Market Hall), the shuttle drop-off off Terminal Drive with a shuttle stop
// and parked carts, perimeter desert planting, and the campus event life (an in-game schedule on the boards, the LED screen and
// a HUD toast; R10: a few real people who roam the campus (PLAN_ROAM, below); a few rigged staff; ambient lines;
// a dance battle on the floor in front of the Side Stage; seats at every picnic table; passport stamps and an info point).
// Classic script, loaded before client.js; hooks into window.PLAN_HOOKS { world, terrain, defer, frame }. All names, copy,
// positions and the schedule: plan/festival.json. R10 (3 Oct 2026): the baked crowd (models/fest_crowd.bin) is gone.
// Performance: no real lights (a few lamps feed the client's light pool), every static part merged into one mesh per material
// (nine materials in all). The roaming people are the client's own rigged avatars (see PLAN_ROAM at the end of this file).
// ?fest=0 turns the module off. window.PLAN_FESTIVAL: n (counters), errs, cfg, api, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var FE = window.PLAN_FESTIVAL = window.PLAN_FESTIVAL || {};
  FE.errs = FE.errs || []; FE.n = FE.n || {}; FE.ver = "r10";
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

  // ───────────────────────── R10: the people who roam the campus (PLAN_ROAM, the engine at the end of this file) ─────────────────────────
  // Replaces the R7 baked crowd (models/fest_crowd.bin, 844 instanced people). Six to ten of the client's rigged avatars by the hour
  // (a couple more for the Sunset DJ Set): they walk the grounds, the walks, the forecourt and the drop-off, queue at the trucks,
  // stand at the bars, sit at the picnic tables, the lounge chairs, the bar stools and the forecourt benches, dance at the DJ set,
  // gather at the fire bowls after dark, talk in pairs, read the boards, step into the arena lobby (plan_convention's routes) and,
  // for the keynote, take a few front-row seats in the hall and leave when it ends. Names and lines: festival.json "roam".
  var CR = FE.crowd || (FE.crowd = { lvl: [0, 0, 0, 0, 0], tgt: [0, 0, 0, 0, 0] });
  function campusArea() {
    var RO = window.PLAN_ROAM; if (!RO || !RO.area || RO.off || FE.roamArea) return; var site = C("site", {}), RC = C("roam", {}), beds = site.beds || [];
    var conv = function () { var P = window.PLAN_CONV; return P && P.ready && P.api && P.api.roam ? P.api.roam() : null; };
    var EVS = null, evs = function () { if (EVS) return EVS; var E = sched().filter(function (e) { return e.id === "keynote"; })[0]; EVS = E ? [{ id: "keynote", from: E.start - 0.5, start: E.start, end: E.end, max: 9, keep: 1 }] : []; return EVS; };
    var gb = site.bounds || [-245, -165, -132, -30], lawnP = smoothClosed(site.lawn || [], 5);
    var lift = function (x, z) { if (x > gb[0] - 1 && x < gb[2] + 1 && z > gb[1] - 0.5 && z < gb[3] + 0.5) return onFloor(x, z) ? 0.14 : inPoly(lawnP, x, z) ? 0.1 : 0.06; if (x > -314 && x < -250 && z > -142 && z < -38) return 0.05; return 0; };
    var PH = null, plantHash = function () { if (PH) return PH; PH = {}; (FE.landProc || []).forEach(function (q) { var r = 0.55 * (q[4] || 1) + 0.3, x0 = Math.floor((q[1] - r) / 4), x1 = Math.floor((q[1] + r) / 4), z0 = Math.floor((q[2] - r) / 4), z1 = Math.floor((q[2] + r) / 4); for (var ix = x0; ix <= x1; ix++) for (var iz = z0; iz <= z1; iz++) (PH[ix + "," + iz] = PH[ix + "," + iz] || []).push([q[1], q[2], r]); }); return PH; };
    var hourId = function (h) { var e = eventAt(h); return e ? e.id : "quiet"; };
    var def = { id: "campus", max: 10, box: [-305, -181, -113, 10], perCat: true, pull: 4, people: (RC.names || []).map(function (n) { return { name: n }; }), lines: Object.assign({}, C("lines", {}), RC.lines || {}),
      ready: function () { var P = window.PLAN_CONV; return FE.ready && (!P || P.off || P.ready); },
      // the standing height: the ground plus the drawn surface over it (the grounds' decomposed granite, the lawn, the dance floor's pavers)
      levels: [{ base: function (x, z) { return planGroundAt(x, z) + lift(x, z); }, exact: true, block: function (x, z) {
        var V = conv(); if (V) { if (V.inside(x, z)) return true; for (var i = 0; i < V.beds.length; i++) { var b = V.beds[i]; if (x > b[0] - 0.3 && x < b[2] + 0.3 && z > b[1] - 0.3 && z < b[3] + 0.3) return true; } }
        for (var j = 0; j < beds.length; j++) { var B = beds[j]; if (Math.hypot(x - B.c[0], z - B.c[1]) < B.r + 0.35) return true; }
        // the procedural plants (brittlebush, agave, grass, rocks) of the beds, the perimeter and the walks' edges have no collision of their own
        var H = plantHash(), key = Math.floor(x / 4) + "," + Math.floor(z / 4), L = H[key]; if (L) for (var m = 0; m < L.length; m++) if (Math.hypot(x - L[m][0], z - L[m][1]) < L[m][2]) return true;
        if (nearStrip(x, z, 0.3)) return true; if (z > 9.4) return true; if (x > -121 && (z < -81 || z > -65)) return true; return false; } }],
      entries: function () { var sh = C("dropoff.shelter", { x: -205, z: -170.5 }); return [{ x: sh.x + 3.5, z: sh.z - 1.2, face: PI, tag: "shuttle" }, { x: -119.5, z: -73, face: -PI / 2, tag: "link" }, { x: -241.6, z: 6.6, face: PI, tag: "hall", hand: "market" }, { x: -176.6, z: 6.6, face: PI, tag: "hall", hand: "market" }]; },
      seeds: function () { var h = C("hub", { x: -190, z: -112 }); return def.entries().concat([{ x: h.x, z: h.z }, { x: -262, z: -90 }]); },
      pois: function () { var out = [], R = rng(1717), add = function (p) { out.push(p); };
        // the bars: along each counter
        (site.bars || []).forEach(function (B) { var c = Math.cos(B.face), s = Math.sin(B.face), cz = B.small ? 1.0 : B.d / 2 + 0.6, n = B.small ? 2 : 4; for (var i = 0; i < n; i++) { var lx = -B.w * 0.35 + B.w * 0.7 * i / (n - 1), lz = cz + 0.75; add({ kind: "bar", line: "bars", x: B.x + lx * c + lz * s, z: B.z - lx * s + lz * c, face: Math.atan2(-s, -c), tag: B.id }); } });
        // the trucks: two places at each serving window
        (site.trucks || []).forEach(function (T) { if (!T.F || !T.win) return; var w = T.F.w(T.win[0], T.win[1]); [[-0.3, 2.3], [0.7, 3.3]].forEach(function (q) { var p = T.F.w(T.win[0] + q[0], T.win[1] + q[1]); add({ kind: "order", line: "trucks", x: p[0], z: p[1], face: Math.atan2(w[0] - p[0], w[1] - p[1]), tag: T.id }); }); });
        // the dance floor (the DJ set): facing the stage
        var D = FE.dance; if (D) { var fx = Math.sin(D.yaw), fz = Math.cos(D.yaw), px = fz, pz = -fx, face = Math.atan2(-fx, -fz); for (var a = 0; a < 3; a++) for (var b = 0; b < 4; b++) { var aa = -D.d / 2 + 2.5 + a * (D.d - 5) / 2, bb = -D.w / 2 + 3 + b * (D.w - 6) / 3; add({ kind: "dance", line: "stage", x: D.x + fx * aa + px * bb + (R() - 0.5), z: D.z + fz * aa + pz * bb + (R() - 0.5), face: face + (R() - 0.5) * 0.5 }); } }
        // the fire bowls after dark
        (site.firebowls || []).forEach(function (p) { for (var i = 0; i < 2; i++) { var an = R() * TAU; add({ kind: "fire", line: "fire", x: p[0] + Math.sin(an) * 2.0, z: p[1] + Math.cos(an) * 2.0, face: an + PI }); } });
        // talking in pairs on the lawn and the plaza, in the sails' shade on the forecourt
        var lawn = smoothClosed(site.lawn || [], 4), bnd = site.bounds || [-245, -165, -132, -30];
        for (var t = 0, n = 0; t < 500 && n < 10; t++) { var x = -229 + R() * 58, z = -152 + R() * 76; if (!inPoly(lawn, x, z) || onFloor(x, z)) continue; add({ kind: "chat", line: "lawn", x: x, z: z, face: R() * TAU, tag: "lawn" }); n++; }
        for (var t2 = 0, n2 = 0; t2 < 500 && n2 < 8; t2++) { var x2 = bnd[0] + 4 + R() * (bnd[2] - bnd[0] - 8), z2 = -70 + R() * 36; if (inPoly(lawn, x2, z2) || onFloor(x2, z2)) continue; add({ kind: "chat", line: "picnic", x: x2, z: z2, face: R() * TAU, tag: "plaza" }); n2++; }
        [[-272, -63], [-262, -117], [-292, -126], [-292, -54]].forEach(function (q) { add({ kind: "chat", line: "forecourt", x: q[0] + 1.5, z: q[1], face: R() * TAU, tag: "sail" }); });
        // reading the schedule boards, the wayfinding signs, the grounds' sign
        (site.boards || []).concat(site.wayfinding || []).forEach(function (bd) { [0, PI].forEach(function (o) { var f = (bd.face || 0) + o; add({ kind: "look", line: "lawn", x: bd.x + Math.sin(f) * 2.2, z: bd.z + Math.cos(f) * 2.2, face: f + PI, dur: [5, 10], tag: "sign" }); }); });
        // the shuttle stop, a look along each walk, the arena's media wall from the promenade
        var sh = C("dropoff.shelter", { x: -205, z: -170.5 }); add({ kind: "wait", line: "shuttle", x: sh.x - 3, z: sh.z - 1.2, face: PI, dur: [10, 22], tag: "shuttle" });
        [[-121, -73, PI / 2], [-182, -20, PI], [-236, -20, PI], [-205, -166, PI]].forEach(function (q) { add({ kind: "look", line: "lawn", x: q[0], z: q[1], face: q[2], dur: [4, 9], tag: "walk" }); });
        [[-262, -95], [-266, -86], [-270, -92], [-258, -84]].forEach(function (q) { add({ kind: "look", line: "forecourt", x: q[0], z: q[1], face: -PI / 2, dur: [8, 16], tag: "ledwall" }); });
        // the arena's lobby and the keynote's front rows: scripted routes from plan_convention
        var V = conv(); if (V) { V.lobby.forEach(function (p) { add(p); }); V.keynote.forEach(function (p) { add(p); }); }
        return out; },
      seatInfo: function (s) { if (s.fest) { if (s.picnic) return { kind: "sit", line: "picnic", tag: "picnic" }; var bar = (site.bars || []).some(function (B) { return Math.hypot(B.x - s.x, B.z - s.z) < 8; }); return { kind: "sit", line: bar ? "bars" : s.z < -166 ? "shuttle" : "lawn", tag: bar ? "stool" : s.z < -166 ? "shelter" : "lounge" }; }
        if (s.tag === "conv") { var V = conv(); if (!V || V.inside(s.x, s.z)) return null; return { kind: "sit", line: "forecourt", tag: "bench" }; } return null; },
      // the share of each kind of place by the hour (divided by how many of that kind there are)
      weight: function (p, h) { var id = hourId(h), n = nightK(), k = p.kind, t = p.tag;
        if (p.lobby) return h > 7 && h < 19 ? 0.45 : 0.08;
        if (k === "dance") return id === "djset" ? 14 : 0;
        if (k === "fire") return n > 0.25 ? 2.6 : 0.05;
        if (k === "bar") return (t === "cart" ? 0.5 : 1.0) * (id === "social" || id === "djset" ? 2.6 : id === "market" ? 1.6 : id === "quiet" ? 0.6 : 0.8);
        if (k === "order") return id === "lunch" ? 2.2 : id === "coffee" ? (t === "coffee" ? 5 : 0.6) : id === "quiet" ? 0.08 : 0.7;
        if (k === "sit") return t === "picnic" ? (id === "lunch" || id === "social" ? 3.2 : 1.0) : t === "lounge" ? (n > 0.25 ? 1.6 : 0.6) : t === "stool" ? (id === "social" || id === "djset" ? 1.4 : 0.5) : t === "bench" ? 1.6 : 0.5;
        if (k === "chat") return t === "lawn" ? 1.6 : t === "plaza" ? 1.2 : 1.2;
        if (k === "look") return t === "ledwall" ? 1.3 : t === "sign" ? 0.6 : 0.7;
        if (k === "wait") return 0.5; return 0.5; },
      // after an order at a truck, often a seat at a picnic table nearby
      next: function (A, c, last) { if (!last || last.kind !== "order" || Math.random() > 0.65) return null; var x = c.g.position.x, z = c.g.position.z, L = A.pois.filter(function (p) { return p.tag === "picnic" && !p.by && !p.bad && Math.hypot(p.x - x, p.z - z) < 45; }); return L.length ? L[Math.floor(Math.random() * L.length)] : null; },
      count: function (h) { var id = hourId(h), E = evs()[0]; if (E && h >= E.from && h < E.end) return 10; return id === "djset" ? 10 : id === "lunch" || id === "social" ? 9 : id === "builders" || id === "market" ? 8 : id === "coffee" ? 7 : 6; },
      events: evs,
      dur: { sit: [25, 70], chat: [15, 40], bar: [15, 35], order: [8, 16], dance: [40, 90], fire: [30, 70], look: [6, 14], wait: [10, 25], browse: [10, 20] },
      visible: function (c) { var V = conv(), p = c.g.position; return !V || V.vis(p.x, p.y, p.z); },
      sameZone: function (c) { var V = conv(), p = c.g.position; return !V || V.zone(p.x, p.y + 1, p.z) === V.camZone(); } };
    FE.roamArea = RO.area(def); }

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
      // the event levels follow the schedule (eased): they set how hard the stage beams work after dark
      if (FR.k % 15 === 1) { var L = levels(hourNow()), qk = FE.qk || (FE.qk = (function () { try { return QUAL.level === "low" ? 0.5 : QUAL.level === "medium" ? 0.7 : 1; } catch (e) { return 1; } })()); ZONES.forEach(function (z, i) { CR.tgt[i] = (L[z] || 0) * qk; }); }
      for (var i = 0; i < 5; i++) CR.lvl[i] += (CR.tgt[i] - CR.lvl[i]) * Math.min(1, dt * 0.6);
      if (!FE.roamArea && FR.k % 30 === 13) campusArea();
      // pooled lamps: real light only through the client's light pool (these lamps are hidden; the pool reads them)
      (FE.lightObjs || []).forEach(function (l) { l.intensity = dc < 220 ? l.userData.k0 * n : 0; });
      if (FR.k % 60 === 7) { redrawBoard(false); redrawScreen(false); }
      if (FR.k % 10 === 3) toastFrame(); if (FR.k % 30 === 11) stampFrame(); if (FR.k % 20 === 5 && dc < 220) staffFrame(); staffAnim(dt);
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
    var nm = 0; main.traverse(function (o) { if (o.isMesh) nm++; }); FE.n.meshes = nm; FE.n.solids = SOL.length; FE.n.deferMs = Math.round(nowMs() - t0); FE.ready = true;
  }

  // ───────────────────────── hooks, API, debug ─────────────────────────
  FE.api = { eventAt: eventAt, nextEvent: nextEvent, levels: levels, onFloor: onFloor, showToast: showToast };
  FE.debug = {
    // pin the in-game hour (the harness way): timeOffset so that dayT() is h / 24
    hour: function (h) { try { timeOffset = (h / 24) * DAY_SECONDS - ((Date.now() / 1000) % DAY_SECONDS); } catch (e) {} return hourNow(); },
    levels: function () { return { lvl: CR.lvl.slice(), tgt: CR.tgt.slice(), ev: (eventAt(hourNow()) || {}).id || "quiet" }; },
    full: function () { for (var i = 0; i < 5; i++) { CR.lvl[i] = CR.tgt[i] = 1; } return true; },
    stats: function () { var o = { n: FE.n, errs: FE.errs.slice(), roam: window.PLAN_ROAM && PLAN_ROAM.stats ? PLAN_ROAM.stats().campus : null, staff: ST.list.length, lamps: (FE.lightObjs || []).length }; return o; }
  };
  (function hookAll() {
    var set = function (phase, name, fn) { var list = window.PLAN_HOOKS[phase]; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name: name, fn: fn }); };
    set("world", "festWorld", function () { worldHook(); });
    set("terrain", "festTerrain", function () { terrainHook(); });
    set("defer", "festDefer", function () { deferHook(); });
    set("frame", "festFrame", function (dt, now) { frameHook(dt, now); });
  })();
})();
// ───────────────────────── R10 (3 Oct 2026): PLAN_ROAM, a few real people who roam the campus and the Market Hall ─────────────────────────
// Replaces the R7 baked crowds (the festival's 844 instanced people, the Market Hall's 1,065 posed shoppers, the arena's seated
// audience). Each area registers with PLAN_ROAM.area(def): plan_festival the Solport Summit campus (forecourt, grounds, paths,
// drop-off, the arena lobby and the keynote's front rows through plan_convention), plan_market the Market Hall (both levels) and
// the Weekend Market. An area gives its box, its walkable levels, places to go (seats, counters, stalls, bars, the dance floor,
// chat spots, scripted routes into the arena), entries, and a target count by the hour (6 to 10). The engine rasterises the
// client's SOLIDS and COLLIDERS plus the area's own keep-outs (beds, the arena's glass) into a 0.5 m walk grid per level (once,
// time sliced), finds paths with a time-sliced A* (stairs are links between levels), and drives the client's own rigged avatars
// the way the client's wanderers do: avatar(), animateWalk() (walk, idle, sit and dance clips, the mixer slowed by distance and
// out of view, the far body LOD), npcSay() and makeBubble().
// Performance: avatars are pooled (built one at a time, never disposed), not drawn or animated past 150 m, behind walls (arena
// interiors, through plan_convention) or off area, cast no shadows (the client's contact blob instead), skinned bounds come from
// R9s (one sphere per rig), the grid and path work is held to about 2.5 ms of a frame. ?roam=0 turns it off.
// window.PLAN_ROAM: n, errs, A (areas), area(def), stats(), near(x, z, r), debug.
(function () {
  "use strict";
  var RO = window.PLAN_ROAM = window.PLAN_ROAM || {}; RO.errs = RO.errs || []; RO.n = RO.n || {}; RO.A = RO.A || {}; RO.ver = "r10";
  if (/[?&]roam=0\b/.test(location.search)) { RO.off = true; RO.area = function () { return null; }; RO.stats = function () { return { off: true }; }; RO.near = function () { return false; }; return; }
  var PI = Math.PI, TAU = PI * 2, CELL = 0.5, STEPUP = 0.45, HEAD = 1.85, RAD = 0.32, SQ2 = Math.SQRT2;
  var DRAW = 110, LABEL = 22, ACT_IN = 420, ACT_OUT = 520;
  function note(tag, e) { try { if (RO.errs.length < 50) RO.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (RO.errs.length <= 6) console.warn("plan_roam " + tag, e); } catch (x) {} }
  function now() { return performance.now(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hour() { try { return dayT() * 24; } catch (e) { return 12; } }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function angTo(a, b) { var d = b - a; return Math.atan2(Math.sin(d), Math.cos(d)); }
  function lowTier() { try { return QUAL.level === "low"; } catch (e) { return false; } }
  function inClient() { try { return !!inside; } catch (e) { return false; } }

  RO.area = function (def) { if (!def || !def.id) return null; var A = RO.A[def.id]; if (A) { A.def = def; return A; } A = RO.A[def.id] = { id: def.id, def: def, st: "wait", gen: null, G: null, pois: [], npcs: [], jobs: [], job: null, on: false, spawnAt: 0, n: { paths: 0, fails: 0, warps: 0, spawned: 0, left: 0, said: 0 }, ev: {} }; return A; };

  // ───────── the walk grid: per level a walkable flag and a standing height per 0.5 m cell ─────────
  function cellIx(G, x, z) { var ix = Math.floor((x - G.x0) / CELL), iz = Math.floor((z - G.z0) / CELL); if (ix < 0 || iz < 0 || ix >= G.nx || iz >= G.nz) return -1; return iz * G.nx + ix; }
  function cx(G, j) { return G.x0 + ((j % G.nx) + 0.5) * CELL; }
  function cz(G, j) { return G.z0 + (Math.floor(j / G.nx) + 0.5) * CELL; }
  // every cell whose centre lies in a solid's footprint grown by r: fn(j)
  function forCells(G, s, r, fn) { var c = Math.cos(s.ry || 0), sn = Math.sin(s.ry || 0), ex = Math.abs(s.hw * c) + Math.abs(s.hd * sn) + r, ez = Math.abs(s.hw * sn) + Math.abs(s.hd * c) + r;
    var ix0 = Math.max(0, Math.floor((s.x - ex - G.x0) / CELL)), ix1 = Math.min(G.nx - 1, Math.floor((s.x + ex - G.x0) / CELL)), iz0 = Math.max(0, Math.floor((s.z - ez - G.z0) / CELL)), iz1 = Math.min(G.nz - 1, Math.floor((s.z + ez - G.z0) / CELL));
    for (var iz = iz0; iz <= iz1; iz++) { var z = G.z0 + (iz + 0.5) * CELL - s.z; for (var ix = ix0; ix <= ix1; ix++) { var x = G.x0 + (ix + 0.5) * CELL - s.x, lx = x * c - z * sn, lz = x * sn + z * c; if (Math.abs(lx) <= s.hw + r && Math.abs(lz) <= s.hd + r) fn(iz * G.nx + ix); } } }
  function forCircle(G, x0, z0, r, fn) { var ix0 = Math.max(0, Math.floor((x0 - r - G.x0) / CELL)), ix1 = Math.min(G.nx - 1, Math.floor((x0 + r - G.x0) / CELL)), iz0 = Math.max(0, Math.floor((z0 - r - G.z0) / CELL)), iz1 = Math.min(G.nz - 1, Math.floor((z0 + r - G.z0) / CELL));
    for (var iz = iz0; iz <= iz1; iz++) for (var ix = ix0; ix <= ix1; ix++) { var dx = G.x0 + (ix + 0.5) * CELL - x0, dz = G.z0 + (iz + 0.5) * CELL - z0; if (dx * dx + dz * dz <= r * r) fn(iz * G.nx + ix); } }
  function* gridGen(A) {
    var d = A.def, b = d.box, nx = Math.ceil((b[2] - b[0]) / CELL), nz = Math.ceil((b[3] - b[1]) / CELL), N = nx * nz, t = now(), t0 = t, i, k;
    var G = { x0: b[0], z0: b[1], nx: nx, nz: nz, N: N, lv: [], links: new Map() }; yield "big";
    var sol = []; for (i = 0; i < SOLIDS.length; i++) { var s = SOLIDS[i], e = s.hw + s.hd + RAD + 0.5; if (s.x + e < b[0] || s.x - e > b[2] || s.z + e < b[1] || s.z - e > b[3]) continue; if (d.skipSolid && d.skipSolid(s)) continue; sol.push(s); }
    yield "big"; sol.sort(function (p, q) { return p.y1 - q.y1; }); yield "big";
    var col = []; for (i = 0; i < COLLIDERS.length; i++) { var c = COLLIDERS[i]; if (c[0] + c[2] + 1 < b[0] || c[0] - c[2] - 1 > b[2] || c[1] + c[2] + 1 < b[1] || c[1] - c[2] - 1 > b[3]) continue; col.push(c); }
    yield 0;
    for (var li = 0; li < d.levels.length; li++) {
      var LV = d.levels[li], W = new Uint8Array(N), Y = new Float32Array(N); G.lv.push({ W: W, Y: Y });
      for (var iz = 0; iz < nz; iz++) { var z = b[1] + (iz + 0.5) * CELL; for (var ix = 0; ix < nx; ix++) { var x = b[0] + (ix + 0.5) * CELL, j = iz * nx + ix, y = LV.base ? LV.base(x, z) : NaN; if (y === y) { Y[j] = y; W[j] = 1; } else Y[j] = -1e9; } if (now() - t > 2) { yield 0; t = now(); } }
      // floors: a solid whose top is a step over the cell (a slab, a tread, a kerb) or in the level's band raises it; the tops go in order
      for (k = 0; k < sol.length; k++) { (function (s) { if (s.seat) return; var top = s.y1; forCells(G, s, 0, function (j) { if (LV.band) { if (top >= LV.band[0] && top <= LV.band[1] && top > Y[j]) { Y[j] = top; W[j] = 1; } } else if (W[j] && top > Y[j] && top <= Y[j] + STEPUP) Y[j] = top; }); })(sol[k]); if ((k & 3) === 3 && now() - t > 2) { yield 0; t = now(); } }
      // blocks: anything between a step and head height over the cell, grown by the body's radius; seats always (people sit, not walk, on them)
      for (k = 0; k < sol.length; k++) { (function (s) { forCells(G, s, RAD, function (j) { if (!W[j]) return; var st = Y[j]; if (s.y0 >= st + HEAD) return; if (s.seat ? s.y1 > st + 0.1 : s.y1 > st + STEPUP) W[j] = 0; }); })(sol[k]); if ((k & 3) === 3 && now() - t > 2) { yield 0; t = now(); } }
      if (li === 0) for (k = 0; k < col.length; k++) { forCircle(G, col[k][0], col[k][1], col[k][2] + RAD, function (j) { W[j] = 0; }); if ((k & 15) === 15 && now() - t > 2) { yield 0; t = now(); } }
      if (LV.block) for (var j2 = 0; j2 < N; j2++) { if (W[j2] && LV.block(cx(G, j2), cz(G, j2), Y[j2])) W[j2] = 0; if ((j2 & 255) === 255 && now() - t > 2) { yield 0; t = now(); } }
    }
    // links between levels (stairs): both ends snapped to a walkable cell
    (d.links ? d.links() : []).forEach(function (L) { var a = snap(G, L.a.l, L.a.x, L.a.z, 1.5), c = snap(G, L.b.l, L.b.x, L.b.z, 1.5); if (a < 0 || c < 0) { A.n.badLinks = (A.n.badLinks || 0) + 1; return; } var na = L.a.l * N + a, nb = L.b.l * N + c, len = 0; for (var q = 1; q < L.pts.length; q++) len += Math.hypot(L.pts[q][0] - L.pts[q - 1][0], L.pts[q][2] - L.pts[q - 1][2]);
      var add = function (from, to, pts) { var l = G.links.get(from) || []; l.push({ to: to, cost: len / CELL, pts: pts }); G.links.set(from, l); }; add(na, nb, L.pts); add(nb, na, L.pts.slice().reverse()); });
    // keep what can be reached from the area's seeds (the entries, the hub): islands behind walls drop out
    var LN = N * G.lv.length, mark = new Uint8Array(LN), Q = new Int32Array(LN), qh = 0, qt = 0;
    (d.seeds ? d.seeds() : []).forEach(function (p) { var j = snap(G, p.l || 0, p.x, p.z, 2); if (j >= 0) { var nd = (p.l || 0) * N + j; if (!mark[nd]) { mark[nd] = 1; Q[qt++] = nd; } } });
    var NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (qh < qt) { var nd2 = Q[qh++], l2 = (nd2 / N) | 0, j3 = nd2 - l2 * N, Wl = G.lv[l2].W, Yl = G.lv[l2].Y, jx = j3 % nx, jz = (j3 / nx) | 0;
      for (var m = 0; m < 8; m++) { var ax = jx + NB[m][0], az = jz + NB[m][1]; if (ax < 0 || az < 0 || ax >= nx || az >= nz) continue; var jn = az * nx + ax; if (!Wl[jn] || Math.abs(Yl[jn] - Yl[j3]) > STEPUP) continue; if (m >= 4 && (!Wl[jz * nx + ax] || !Wl[az * nx + jx])) continue; var nn = l2 * N + jn; if (!mark[nn]) { mark[nn] = 1; Q[qt++] = nn; } }
      var lk = G.links.get(nd2); if (lk) for (var q2 = 0; q2 < lk.length; q2++) if (!mark[lk[q2].to]) { mark[lk[q2].to] = 1; Q[qt++] = lk[q2].to; }
      if ((qh & 1023) === 1023 && now() - t > 2) { yield 0; t = now(); } }
    var walk = 0; for (var l3 = 0; l3 < G.lv.length; l3++) { var W3 = G.lv[l3].W; for (var j4 = 0; j4 < N; j4++) { if (W3[j4] && !mark[l3 * N + j4]) W3[j4] = 0; if (W3[j4]) walk++; } }
    // the search buffers (one search at a time per area)
    G.gS = new Float32Array(LN); G.par = new Int32Array(LN); G.seen = new Uint32Array(LN); G.closed = new Uint32Array(LN); G.gen = 0; G.hI = new Int32Array(LN + 1024); G.hF = new Float32Array(LN + 1024);
    A.G = G; yield "big"; var tp = now(); buildPois(A); A.n.poiMs = +(now() - tp).toFixed(1); A.n.cells = N; A.n.walk = walk; A.n.levels = G.lv.length; A.n.gridMs = Math.round(now() - t0); A.n.solids = sol.length; A.n.colliders = col.length;
  }
  // the nearest walkable cell within r metres of (x, z) on level l, or -1
  function snap(G, l, x, z, r) { var Lv = G.lv[l]; if (!Lv) return -1; var j = cellIx(G, x, z); if (j >= 0 && Lv.W[j]) return j; var best = -1, bd = 1e9, n = Math.ceil(r / CELL), ix = Math.floor((x - G.x0) / CELL), iz = Math.floor((z - G.z0) / CELL);
    for (var dz = -n; dz <= n; dz++) for (var dx = -n; dx <= n; dx++) { var ax = ix + dx, az = iz + dz; if (ax < 0 || az < 0 || ax >= G.nx || az >= G.nz) continue; var jj = az * G.nx + ax; if (!Lv.W[jj]) continue; var ddx = G.x0 + (ax + 0.5) * CELL - x, ddz = G.z0 + (az + 0.5) * CELL - z, dd = ddx * ddx + ddz * ddz; if (dd < bd && dd <= r * r) { bd = dd; best = jj; } } return best; }
  function walkable(A, l, x, z) { var G = A.G; if (!G || !G.lv[l]) return false; var j = cellIx(G, x, z); return j >= 0 && !!G.lv[l].W[j]; }
  // standing height on level l at (x, z): bilinear over the walkable cell centres round it
  function hAt(A, l, x, z) { var G = A.G, Lv = G.lv[l], fx = (x - G.x0) / CELL - 0.5, fz = (z - G.z0) / CELL - 0.5, ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, s = 0, w = 0, j0 = cellIx(G, x, z), y0 = j0 >= 0 ? Lv.Y[j0] : -1e9;
    for (var k = 0; k < 4; k++) { var ax = ix + (k & 1), az = iz + (k >> 1); if (ax < 0 || az < 0 || ax >= G.nx || az >= G.nz) continue; var j = az * G.nx + ax, y = Lv.Y[j]; if (y < -1e8 || (y0 > -1e8 && Math.abs(y - y0) > 0.3)) continue; var wk = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? tz : 1 - tz); s += y * wk; w += wk; } return w > 0 ? s / w : y0; }
  // a straight walk on one level: every sample walkable and no step taller than a stair
  function los(A, l, x0, z0, x1, z1) { var G = A.G, Lv = G.lv[l], L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / (CELL * 0.45))), py = null;
    for (var i = 0; i <= n; i++) { var t = i / n, j = cellIx(G, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t); if (j < 0 || !Lv.W[j]) return false; var y = Lv.Y[j]; if (py !== null && Math.abs(y - py) > STEPUP) return false; py = y; } return true; }

  // ───────── paths: a weighted A* over the cells of every level and the links, a few thousand nodes a frame ─────────
  function heapPush(G, n, f) { var i = G.hn++; if (i >= G.hI.length) { G.hn--; return; } while (i > 0) { var p = (i - 1) >> 1; if (G.hF[p] <= f) break; G.hI[i] = G.hI[p]; G.hF[i] = G.hF[p]; i = p; } G.hI[i] = n; G.hF[i] = f; }
  function heapPop(G) { var top = G.hI[0], n = --G.hn; if (n > 0) { var x = G.hI[n], f = G.hF[n], i = 0; for (;;) { var a = 2 * i + 1, c = a + 1; if (a >= n) break; var m = c < n && G.hF[c] < G.hF[a] ? c : a; if (G.hF[m] >= f) break; G.hI[i] = G.hI[m]; G.hF[i] = G.hF[m]; i = m; } G.hI[i] = x; G.hF[i] = f; } return top; }
  function jobStart(A, J) { var G = A.G, N = G.N; G.gen++; G.hn = 0; var s = J.sl * N + J.sj; J.goal = J.gl * N + J.gj; J.gx = J.gj % G.nx; J.gz = (J.gj / G.nx) | 0; G.gS[s] = 0; G.seen[s] = G.gen; G.par[s] = -1; heapPush(G, s, 0); J.s = s; J.exp = 0; J.on = true; }
  var NB8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]];
  function jobRun(A, J, until) { var G = A.G, N = G.N, nx = G.nx, nz = G.nz, gen = G.gen;
    while (G.hn > 0) { if ((J.exp & 127) === 127 && now() > until) return false; var n = heapPop(G); if (G.closed[n] === gen) continue; G.closed[n] = gen; J.exp++; if (n === J.goal) { J.found = true; return true; } if (J.exp > (J.maxExp || 160000)) return true;
      var l = (n / N) | 0, j = n - l * N, Lv = G.lv[l], W = Lv.W, Y = Lv.Y, jx = j % nx, jz = (j / nx) | 0, g0 = G.gS[n];
      for (var m = 0; m < 8; m++) { var ax = jx + NB8[m][0], az = jz + NB8[m][1]; if (ax < 0 || az < 0 || ax >= nx || az >= nz) continue; var jn = az * nx + ax; if (!W[jn] || Math.abs(Y[jn] - Y[j]) > STEPUP) continue; if (m >= 4 && (!W[jz * nx + ax] || !W[az * nx + jx])) continue; relax(G, J, n, l * N + jn, g0 + NB8[m][2], ax, az, gen); }
      var lk = G.links.get(n); if (lk) for (var q = 0; q < lk.length; q++) { var t = lk[q].to, tj = t % N; relax(G, J, n, t, g0 + lk[q].cost, tj % nx, (tj / nx) | 0, gen); } }
    return true; }
  function relax(G, J, from, to, g, ax, az, gen) { if (G.closed[to] === gen) return; if (G.seen[to] === gen && G.gS[to] <= g) return; G.seen[to] = gen; G.gS[to] = g; G.par[to] = from; var dx = Math.abs(ax - J.gx), dz = Math.abs(az - J.gz), h = dx + dz + (SQ2 - 2) * Math.min(dx, dz); heapPush(G, to, g + h * 1.25); }
  // the node chain to points: cell centres (string-pulled per level) and the links' own points (with their heights)
  function jobPath(A, J) { var G = A.G, N = G.N, chain = [], n = J.goal, guard = 0; while (n >= 0 && guard++ < 200000) { chain.push(n); if (n === J.s) break; n = G.par[n]; } chain.reverse();
    var out = [], run = []; var flush = function () { if (!run.length) return; var l = run[0][2], i = 0, keep = [run[0]];
      while (i < run.length - 1) { var step = Math.min(40, run.length - 1 - i), j = i + 1; while (step >= 1) { var k = i + step; if (los(A, l, run[i][0], run[i][1], run[k][0], run[k][1])) { j = k; break; } step = step >> 1; } keep.push(run[j]); i = j; }
      var fin = [keep[0]]; for (var q = 1; q < keep.length; q++) { var a = fin[fin.length - 1], nx2 = keep[q + 1]; if (nx2 && los(A, l, a[0], a[1], nx2[0], nx2[1])) continue; fin.push(keep[q]); }
      fin.forEach(function (p) { out.push({ x: p[0], z: p[1], l: l }); }); run = []; };
    for (var k = 0; k < chain.length; k++) { var nd = chain[k], l = (nd / N) | 0, j = nd - l * N; if (k > 0) { var prev = chain[k - 1], pl = (prev / N) | 0; var lk = G.links.get(prev), link = null; if (lk) for (var q = 0; q < lk.length; q++) if (lk[q].to === nd) link = lk[q]; if (link && (pl !== l || Math.hypot(cx(G, prev % N) - cx(G, j), cz(G, prev % N) - cz(G, j)) > CELL * 2)) { flush(); link.pts.forEach(function (p) { out.push({ x: p[0], y: p[1], z: p[2], l: -1, s: !!p[3] }); }); } }
      run.push([cx(G, j), cz(G, j), l]); }
    flush(); return out; }
  function pathJobs(A, until) { if (!A.G) return; for (var guard = 0; guard < 8 && now() < until; guard++) { var J = A.job; if (!J) { J = A.job = A.jobs.shift(); if (!J) return; if (J.dead) { A.job = null; continue; } jobStart(A, J); }
      var done = false; try { done = jobRun(A, J, until); } catch (e) { note("path", e); done = true; J.found = false; } if (!done) return; A.job = null; A.n.paths++; var pts = null; if (J.found) { try { pts = jobPath(A, J); } catch (e) { note("path pts", e); } } else A.n.fails++; if (!J.dead) J.cb(pts); } }
  function requestPath(A, l0, x0, z0, l1, x1, z1, cb) { var G = A.G; var sj = snap(G, l0, x0, z0, 2.5), gj = snap(G, l1, x1, z1, 1.6); if (sj < 0 || gj < 0) { cb(null); return null; } var J = { sl: l0, sj: sj, gl: l1, gj: gj, cb: cb }; A.jobs.push(J); return J; }

  // ───────── places: POIs from the area (seats get an approach cell and a seated pose) ─────────
  function seatPoi(A, s, kind, extra) {
    var face = typeof s.face === "number" ? s.face : null, long = s.hw > s.hd, cands = [];
    var dirs = face !== null ? [face, face + PI, face + PI / 2, face - PI / 2] : (long ? [s.ry, s.ry + PI] : [s.ry + PI / 2, s.ry - PI / 2]);
    var l = extra && extra.l || 0, dep = face !== null ? Math.max(s.hw, s.hd) : (long ? s.hd : s.hw);
    for (var i = 0; i < dirs.length; i++) { var f = dirs[i], ax = s.x + Math.sin(f) * (dep + 0.42), az = s.z + Math.cos(f) * (dep + 0.42); if (walkable(A, l, ax, az)) { cands.push([ax, az, f]); break; } }
    if (!cands.length) return null; var c = cands[0], sitFace = face !== null ? face : c[2];
    var p = { kind: kind || "sit", l: l, x: c[0], z: c[1], face: sitFace, seat: s, sx: s.x, sz: s.z, sy: s.y1, back: Math.min(face !== null ? (Math.abs(Math.cos(angTo(sitFace, s.ry || 0))) > 0.7 ? s.hd : s.hw) : dep, 0.32) - 0.03 };
    if (extra) for (var k in extra) if (p[k] === undefined || k === "w" || k === "dur" || k === "tag") p[k] = extra[k]; return p; }
  function buildPois(A) { var d = A.def, out = [];
    (d.pois ? d.pois(A) : []).forEach(function (p) { if (!p) return; if (p.seatSolid) { var sp = seatPoi(A, p.seatSolid, p.kind, p); if (sp) out.push(sp); return; } if (p.via) { out.push(p); return; } var j = snap(A.G, p.l || 0, p.x, p.z, 1.2); if (j < 0) return; p.l = p.l || 0; out.push(p); });
    // every other seat in the box on a walkable level becomes a place to sit (the module's filter decides)
    if (d.seats !== false) for (var i = 0; i < SOLIDS.length; i++) { var s = SOLIDS[i]; if (!s.seat || s.roamSkip) continue; var b = d.box; if (s.x < b[0] || s.x > b[2] || s.z < b[1] || s.z > b[3]) continue; var info = d.seatInfo ? d.seatInfo(s) : { l: 0 }; if (!info) continue; var q = seatPoi(A, s, info.kind || "sit", info); if (q) out.push(q); }
    // chat spots come in pairs (two people facing each other)
    out.forEach(function (p, i) { p.i = i; p.by = null; if (p.kind === "chat" && !p.pair && p.mate !== false) { var ang = typeof p.face === "number" ? p.face : Math.random() * TAU, ox = Math.sin(ang) * 1.1, oz = Math.cos(ang) * 1.1; if (walkable(A, p.l, p.x + ox, p.z + oz)) { var q2 = { kind: "chat", l: p.l, x: p.x + ox, z: p.z + oz, face: ang + PI, w: p.w, tag: p.tag, pair: p, i: out.length }; p.pair = q2; p.face = ang; out.push(q2); } } });
    A.pois = out; A.n.pois = out.length; var by = {}; A.catN = {}; out.forEach(function (p) { p.cat = p.kind + ":" + (p.tag || ""); A.catN[p.cat] = (A.catN[p.cat] || 0) + 1; by[p.kind] = (by[p.kind] || 0) + 1; }); A.n.poiKinds = by; }

  // ───────── the people: the client's avatars, pooled per area ─────────
  var SKINS = ["f3d9c0", "e8c19a", "d9a877", "c98f63", "a86f46", "8d5a3b", "6b4226", "4f3020"], PANTS = ["2b3a4a", "1c1f24", "6d5a3e", "3a3d42", "c8bca4", "4a5a6a", "263040", "5a4632"];
  var SHIRTS = ["f5f1e6", "2a7a3e", "c0462d", "3a6ea5", "e0b040", "1c1f24", "6a3a8a", "8a4a2a", "2f8f8a", "9a3b52", "d8d0f0", "e07a30", "4dde6f", "8a8f98"], HAIRC = ["1c1512", "3a2416", "6b4226", "c9a24d", "2a2a2a", "8a6a48", "15100c"];
  var HAIRS_F = [2, 4, 6, 8, 9, 10, 11, 0, 7], HAIRS_M = [1, 3, 5, 6, 7, 0, 11, 1, 3], HATS = ["hat_cap", "hat_trucker", "hat_cowboy", "hat_beanie"], OUTFITS = ["outfit_desert", "outfit_ranch"];
  // a look per person: the palettes walked with strides that never repeat a neighbour's shirt, trousers or skin; some wear their own
  // hair (the wigs are the heaviest part of a near person), one in four a hat, one in seven an outfit
  function lookFor(A, k) { var p = (A.def.people || [])[k] || {}, f = p.body ? p.body === "f" : k % 2 === 0, o = 0; for (var q = 0; q < A.id.length; q++) o += A.id.charCodeAt(q) * (q + 1); o = o % 97;
    var look = { body: f ? "f" : "m", skin: p.skin || SKINS[(k * 3 + o) % SKINS.length], shirt: p.shirt || SHIRTS[(k * 5 + o * 3) % SHIRTS.length], pants: p.pants || PANTS[(k * 3 + o + 1) % PANTS.length], hair: p.hair !== undefined ? p.hair : (k >> 1) % 2 ? 0 : (f ? HAIRS_F : HAIRS_M)[(k * 2 + o) % 9], hairc: p.hairc || HAIRC[(k * 4 + o) % HAIRC.length], shoes: p.shoes || (k % 3 ? "f5f1e6" : "2a2320") };
    var hat = p.hat !== undefined ? p.hat : (k % 4 === 1 ? HATS[((k >> 2) + o) % HATS.length] : null), outfit = p.outfit !== undefined ? p.outfit : (k % 7 === 3 ? OUTFITS[(k + o) % 2] : null); return { look: look, hat: hat, outfit: outfit, name: p.name || ("Guest " + (k + 1)) }; }
  function makeNpc(A, k) { var L = lookFor(A, (A.nb = (A.nb || 0) + 1) - 1); var g = avatar("roam_" + k, L.name, L.look, L.hat, L.outfit); try { g.userData.label.scale.set(1.4, 0.36, 1); } catch (e) {}
    var c = { A: A, k: k, g: g, name: L.name, st: "off", poi: null, path: null, pi: 0, sp: rnd(1.08, 1.42), t: 0, l: 0, y: 0, lastSay: 0, bub: null, bubAt: 0, sh: 0, said: 0, kindLast: "" }; noShadow(c); A.n.built = (A.n.built || 0) + 1; return c; }
  // no shadow casting (the wig and hat meshes load a moment later, so this runs a few times); once the wig is in, its programs and
  // uploads are prepared through plan_perf's warm-up queue (compiled in parallel, not at first sight)
  function noShadow(c) { c.g.traverse(function (o) { if (o.isMesh) { o.castShadow = false; o.userData.shSet = true; } }); var b = c.g.userData.blob; if (b) b.visible = !c.g.userData.sit; c.sh++; if (c.sh === 3 && !c.warm) { c.warm = true; try { if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(c.g, { name: "roam person" }); } catch (e) {} } }
  function hideNpc(c) { var g = c.g; if (g.parent) g.parent.remove(g); c.st = "off"; release(c); c.path = null; dropBubble(c); if (g.userData.sitOff) try { sitClear(g); } catch (e) {} g.userData.sit = false; g.userData.dance = null; if (g.userData.label) g.userData.label.position.y = 2.3; c.warp = false; c.ev = null; c.leaving = false; c.at = null; }
  function release(c) { if (c.poi) { if (c.poi.by === c) c.poi.by = null; c.poi = null; } }
  function dropBubble(c) { if (!c.bub) return; c.g.remove(c.bub); try { c.bub.material.map.dispose(); c.bub.material.dispose(); } catch (e) {} c.bub = null; }
  // the client's speech bubble, wrapped to two lines (its own cuts a long line short)
  function makeBub(text) { var cv = document.createElement("canvas"); cv.width = 512; cv.height = 150; var x = cv.getContext("2d"); x.font = "500 28px 'Space Grotesk', system-ui, sans-serif"; x.textAlign = "center";
    var lines = [""]; text.split(" ").forEach(function (w) { var cur = lines[lines.length - 1], t = cur ? cur + " " + w : w; if (cur && x.measureText(t).width > 456) lines.push(w); else lines[lines.length - 1] = t; }); lines = lines.slice(0, 2);
    var w = 36 + Math.max.apply(null, lines.map(function (l) { return Math.min(470, x.measureText(l).width); })), h = 20 + 36 * lines.length, y0 = 75 - h / 2; x.fillStyle = "rgba(245,241,230,.95)"; x.beginPath(); if (x.roundRect) x.roundRect(256 - w / 2, y0, w, h, 16); else x.rect(256 - w / 2, y0, w, h); x.fill();
    x.fillStyle = "#0a1610"; lines.forEach(function (l, i) { x.fillText(l, 256, y0 + 38 + i * 36); }); var tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false })); sp.scale.set(4.4, 1.29, 1); sp.position.y = 3.2; return sp; }
  function bubble(c, text) { dropBubble(c); var b = makeBub(text); if (c.g.userData.sit) b.position.y = 2.5; c.g.add(b); c.bub = b; c.bubAt = now(); c.A.n.said++; }

  // ───────── choosing where to go ─────────
  function freePoi(p) { if (p.by || p.bad) return false; if (p.seat) { try { if (SIT.on && Math.abs(player.position.x - p.sx) < 0.6 && Math.abs(player.position.z - p.sz) < 0.6) return false; } catch (e) {} } return true; }
  function choose(A, c, h) { var d = A.def, best = null, tot = 0, cand = [], x = c.g.position.x, z = c.g.position.z;
    for (var i = 0; i < A.pois.length; i++) { var p = A.pois[i]; if (p.ev || !freePoi(p)) continue; var w = d.weight ? d.weight(p, h, c) : (p.w || 1); if (!(w > 0)) continue; if (d.perCat) w /= A.catN[p.cat] || 1; var px = p.via ? p.via[0][0] : p.x, pz = p.via ? p.via[0][2] : p.z, dd = Math.hypot(px - x, pz - z);
      w *= dd < 6 ? 0.25 : dd < 160 ? 1 : 0.4; if (p.kind === c.kindLast) w *= 0.35; if (A.pin) { var dp = Math.hypot(px - A.pin[0], pz - A.pin[1]); if (dp < 70) w *= 1 + (A.def.pull || 2.5) * (1 - dp / 70); } if (p.kind === "chat" && p.pair && p.pair.by) w *= 6; cand.push([p, w]); tot += w; }
    var r = Math.random() * tot; for (var k = 0; k < cand.length; k++) { r -= cand[k][1]; if (r <= 0) { best = cand[k][0]; break; } } return best || (cand.length ? cand[0][0] : null); }
  // send c to p: a grid path to p (or to the start of p's scripted route), then the route
  function goTo(A, c, p, then) { release(c); c.poi = p; p.by = c; c.st = "plan"; c.t = 0; c.warp = false; var x = c.g.position.x, z = c.g.position.z, tx = p.via ? p.via[0][0] : p.x, tz = p.via ? p.via[0][2] : p.z, tl = p.via ? (p.viaL || 0) : p.l;
    c.job = requestPath(A, c.l, x, z, tl, tx, tz, function (pts) { c.job = null; if (c.poi !== p || c.st !== "plan") return; if (!pts || !pts.length) { p.bad = (p.bad || 0) + 1; release(c); c.st = "act"; c.t = rnd(1.5, 3); return; }
      if (p.via) p.via.forEach(function (q) { pts.push({ x: q[0], y: q[1], z: q[2], l: -1, s: !!q[3] }); }); c.path = pts; c.pi = 0; c.st = "walk"; c.then = then || null; }); if (!c.job && c.st === "plan") { c.st = "act"; c.t = 2; } }
  function nextPlace(A, c, h) { var leaving = c.poi; if (leaving && leaving.via && c.at === leaving) { c.path = leaving.via.slice().reverse().map(function (q) { return { x: q[0], y: q[1], z: q[2], l: -1, s: !!q[3] }; }); c.pi = 0; c.st = "walk"; c.back = true; release(c); c.at = null; return; }
    c.at = null; var p = A.def.next ? A.def.next(A, c, leaving, h) : null; if (!p) p = choose(A, c, h); if (!p) { c.st = "act"; c.t = rnd(3, 6); return; } goTo(A, c, p); }
  function arrive(A, c) { var p = c.poi; c.path = null; c.at = p; c.back = false; if (!p) { c.st = "act"; c.t = rnd(2, 5); return; } c.st = "act"; var D = p.exit ? [0, 0] : p.dur || A.def.dur && A.def.dur[p.kind] || [8, 20]; c.t = rnd(D[0], D[1]); c.kindLast = p.kind; c.l = p.l >= 0 ? p.l : c.l;
    if (p.seat || p.sitAt) { c.sit0 = [c.g.position.x, c.g.position.y, c.g.position.z]; c.sitK = 0; }
    if (p.kind === "dance") { c.g.userData.dance = { clip: pick(["dance1", "dance2", "dance3", "dance4"]), until: Infinity }; }
    if (p.ev && !c.ev) c.t = rnd(2, 6); }
  function standUp(c) { var g = c.g, u = g.userData; if (u.sitOff) try { sitClear(g); } catch (e) {} u.sit = false; u.dance = null; var p = c.at; if (p && p.via) { var q = p.via[p.via.length - 1]; g.position.set(q[0], q[1], q[2]); } else if (p && (p.seat || p.sitAt)) g.position.set(p.x, hAt(c.A, p.l || 0, p.x, p.z), p.z); var b = u.blob; if (b) b.visible = true; if (u.label) u.label.position.y = 2.3; c.sitK = -1; }

  // ───────── every frame ─────────
  var FR = RO.fr = RO.fr || { k: 0 };
  function camIn(A) { var b = A.def.box, cp = camera.position, dx = Math.max(b[0] - cp.x, 0, cp.x - b[2]), dz = Math.max(b[1] - cp.z, 0, cp.z - b[3]); return Math.hypot(dx, dz); }
  function areaFrame(A, dt, h, until) {
    var d = A.def; if (!d.ready || !d.ready()) return; var dist = camIn(A), wantOn = dist < (A.on ? ACT_OUT : ACT_IN) && !inClient() && !(d.off && d.off());
    if (A.st === "wait" && (dist < 760 || (FR.t0 && now() - FR.t0 > 40000))) { A.st = "grid"; A.gen = gridGen(A); }
    if (A.st === "grid") { var tg = now(); try { while (now() < until) { var r = A.gen.next(); if (r.done) { A.gen = null; A.st = "ready"; break; } if (r.value === "big") break; } } catch (e) { note("grid " + A.id, e); A.st = "fail"; } tg = now() - tg; if (tg > (RO.n.tGrid || 0)) RO.n.tGrid = +tg.toFixed(2); return; }
    if (A.st !== "ready") return;
    // the client measures its sit pose once per body on the first sit (a skinned pass over the rig): done here, one body a frame, before anyone sits
    if ((FR.fit || 0) < 2 && typeof sitFitOf === "function" && typeof CHAR !== "undefined" && CHAR.m && CHAR.f && CHAR.m.clips && CHAR.m.clips.sit && CHAR.f.clips && CHAR.f.clips.sit) { try { sitFitOf({ userData: { body: FR.fit ? "f" : "m" } }); } catch (e) {} FR.fit = (FR.fit || 0) + 1; return; }
    if (!wantOn) { if (A.on) { A.npcs.forEach(hideNpc); A.on = false; A.jobs.length = 0; A.job = null; } return; }
    if (!A.on) { A.on = true; A.first = true; A.spawnAt = 0; }
    var tq = now(); pathJobs(A, until); tq = now() - tq; if (tq > (RO.n.tPath || 0)) RO.n.tPath = +tq.toFixed(2);
    var pb = d.box, pp = player.position; A.pin = pp.x > pb[0] && pp.x < pb[2] && pp.z > pb[1] && pp.z < pb[3] ? [pp.x, pp.z] : null;
    // the low tier keeps two fewer (never under six), except while an event needs its people (the keynote's seats)
    var target = d.count ? d.count(h) : 8, inEv = d.events && d.events().some(function (E) { return h >= E.from && h < E.end; }); if (lowTier() && !inEv) target = Math.max(6, target - 2); A.target = target;
    var live = A.npcs.filter(function (c) { return c.st !== "off" && !c.leaving; }).length;
    // arrivals: fill up quietly (in place while nobody sees the spot, else from an entry out of view), one person at a time
    if (live < target && now() > A.spawnAt && typeof avatar === "function" && typeof CHAR !== "undefined" && CHAR.m && CHAR.f && CHAR.m.clips && CHAR.m.clips.sit) {
      A.spawnAt = now() + (A.first ? 120 : rnd(2500, 6000)); var c = null; for (var i = 0; i < A.npcs.length; i++) if (A.npcs[i].st === "off") { c = A.npcs[i]; break; }
      // a free avatar from another area's pool before a new one is built (the pools stay small whichever way people move)
      if (!c) for (var ok in RO.A) { var B = RO.A[ok]; if (B === A) continue; for (var bi = 0; bi < B.npcs.length && !c; bi++) if (B.npcs[bi].st === "off") { c = B.npcs[bi]; B.npcs.splice(bi, 1); c.A = A; A.npcs.push(c); } if (c) break; }
      if (!c && A.npcs.length < (d.max || 10) && (RO.n.built || 0) < (RO.maxBuilt || 22)) { try { var tm = now(); c = makeNpc(A, RO.n.built || 0); tm = now() - tm; if (tm > (RO.n.tMake || 0)) RO.n.tMake = +tm.toFixed(2); A.npcs.push(c); RO.n.built = (RO.n.built || 0) + 1; } catch (e) { note("npc", e); } }
      if (c) { var ts = now(); spawn(A, c, h); ts = now() - ts; if (ts > (RO.n.tSpawn || 0)) RO.n.tSpawn = +ts.toFixed(2); } if (live + 1 >= target) A.first = false; }
    // departures: someone out of view walks to an entry and is gone
    if (live > target && FR.k % 90 === 7) { var cand = A.npcs.filter(function (c2) { return c2.st !== "off" && !c2.leaving && !c2.ev && !c2.g.userData.sit; }); if (cand.length) leave(A, pick(cand)); }
    if (d.events) eventFrame(A, h);
    var tn = now(); for (var j = 0; j < A.npcs.length; j++) { var c3 = A.npcs[j]; if (c3.st === "off") continue; try { npcFrame(A, c3, dt, h); } catch (e) { note("npc frame", e); } } tn = now() - tn; if (tn > (RO.n.tNpc || 0)) RO.n.tNpc = +tn.toFixed(2);
    ambient(A, h); }
  function spawn(A, c, h) { var d = A.def, cp = camera.position, p = null, inPlace = A.first;
    if (inPlace) { for (var t = 0; t < 30 && !p; t++) { var q = choose(A, c, h); if (q && !q.via && Math.hypot(q.x - cp.x, q.z - cp.z) > 45) p = q; } }
    if (p) { c.l = p.l; c.g.position.set(p.x, hAt(A, p.l, p.x, p.z), p.z); c.g.rotation.y = typeof p.face === "number" ? p.face : Math.random() * TAU; if (!c.g.parent) scene.add(c.g); c.poi = p; p.by = c; arrive(A, c); c.t *= Math.random(); c.y = c.g.position.y; A.n.spawned++; return; }
    var E = (d.entries ? d.entries() : []).filter(function (e) { var y = hAt(A, e.l || 0, e.x, e.z); return Math.hypot(e.x - cp.x, e.z - cp.z) > 30 && !npcInView(new THREE.Vector3(e.x, y + 1, e.z)); }); if (!E.length) { A.spawnAt = now() + 1500; return; }
    var e = pick(E); c.l = e.l || 0; c.g.position.set(e.x, hAt(A, c.l, e.x, e.z), e.z); c.y = c.g.position.y; c.g.rotation.y = e.face || 0; if (!c.g.parent) scene.add(c.g); c.st = "act"; c.t = 0.1; c.at = null; c.leaving = false; A.n.spawned++; }
  function leave(A, c) { var E = A.def.entries ? A.def.entries() : []; if (!E.length) { hideNpc(c); return; } var x = c.g.position.x, z = c.g.position.z, best = null, bd = 1e9; E.forEach(function (e) { var dd = Math.hypot(e.x - x, e.z - z); if (dd < bd) { bd = dd; best = e; } });
    if (c.g.userData.sit || c.g.userData.dance) standUp(c); c.leaving = true; var p = { kind: "exit", l: best.l || 0, x: best.x, z: best.z, exit: true, hand: best.hand || null }; goTo(A, c, p); A.n.left++; }
  function liveN(A) { var n = 0; for (var i = 0; i < A.npcs.length; i++) if (A.npcs[i].st !== "off" && !A.npcs[i].leaving) n++; return n; }
  // an exit into the next area hands the person over (the campus to the Market Hall and back) when that area has room
  function transfer(c, B) { var A = c.A; if (!B || B === A || !B.on || B.st !== "ready" || liveN(B) >= (B.target || 0)) return false; var i = A.npcs.indexOf(c); if (i < 0) return false; A.npcs.splice(i, 1); release(c); c.A = B; c.l = 0; c.at = null; c.leaving = false; c.st = "act"; c.t = 0.2; c.path = null; B.npcs.push(c); A.n.out = (A.n.out || 0) + 1; B.n.inn = (B.n.inn || 0) + 1; return true; }
  var _v = new THREE.Vector3();
  function npcFrame(A, c, dt, h) {
    var g = c.g, u = g.userData, cp = camera.position, d = Math.hypot(g.position.x - cp.x, g.position.z - cp.z), vis = d < DRAW && (!A.def.visible || A.def.visible(c)); if (A.def.hideAll && A.def.hideAll()) vis = false;
    var inV = vis && npcInView(_v.set(g.position.x, g.position.y + 1, g.position.z));
    // warps: on the way to (or from) an event seat, someone nobody sees can skip the walk
    if ((c.warp || (c.ev && hour() >= c.ev.start)) && c.st === "walk" && !inV && d > 30 && c.path && c.path.length) { var last = c.path[c.path.length - 1]; g.position.set(last.x, last.y !== undefined ? last.y : hAt(A, c.poi ? c.poi.l : 0, last.x, last.z), last.z); A.n.warps++; c.warp = false; c.path = null; if (c.back) { c.st = "act"; c.t = 0.05; c.back = false; c.at = null; } else arrive(A, c); }
    if (c.st === "walk") walkStep(A, c, dt, d);
    else if (c.st === "act") { c.t -= dt; var tt = now(); actStep(A, c, dt, d, h); tt = now() - tt; if (tt > (RO.n.tAct || 0)) RO.n.tAct = +tt.toFixed(2); if (c.t <= 0) { if (c.at && c.at.exit) { if (!inV || d > 60 || c.t < -20) { if (c.at.hand && transfer(c, RO.A[c.at.hand])) return; hideNpc(c); } return; } if (c.ev && c.at && c.at.ev && hour() < c.ev.end) { c.t = 2; } else { if (u.sit || u.dance) standUp(c); nextPlace(A, c, h); } } }
    else if (c.st === "plan") { c.t += dt; if (c.t > 8) { if (c.job) c.job.dead = true; c.job = null; release(c); c.st = "act"; c.t = 1; } }
    if (g.visible !== vis) g.visible = vis; if (!vis) return;
    if (c.sh < 6 && (FRAME_N + c.k) % 60 === 0) { var tw = now(); noShadow(c); tw = now() - tw; if (tw > (RO.n.tWarm || 0)) RO.n.tWarm = +tw.toFixed(2); }
    var lab = u.label; if (lab) { var lv = d < LABEL && !(c.at && c.at.quiet && c.st === "act") && (!A.def.sameZone || A.def.sameZone(c)); if (lab.visible !== lv) lab.visible = lv; }
    if (c.bub && (now() - c.bubAt > 5200 || d > 30)) dropBubble(c);
    var sp = c.st === "walk" && !c.wait ? c.sp : 0, ta = now(); try { animateWalk(g, sp, dt); } catch (e) { note("anim", e); } ta = now() - ta; if (ta > (RO.n.tAnim || 0)) RO.n.tAnim = +ta.toFixed(2);
    // a hello when you walk up to someone standing about (once in a while, like the client's wanderers)
    var dpl = player ? Math.hypot(g.position.x - player.position.x, g.position.z - player.position.z) : 1e9;
    if (dpl < 3.2 && c.st === "act" && !u.sit && !u.dance && now() - c.lastSay > 40000 && Math.abs(player.position.y - g.position.y) < 1.5) { c.lastSay = now(); var L = A.def.lines && (A.def.lines.hello || A.def.lines.any); if (L && L.length && typeof npcSay === "function") { try { npcSay({ g: g, name: c.name }, pick(L)); c.bub = g.userData.bubble; c.bubAt = now(); g.userData.bubble = null; } catch (e) {} } c.t = Math.max(c.t, 3); }
  }
  function walkStep(A, c, dt, d) { var g = c.g, P = c.path; if (!P || c.pi >= P.length) { arrive(A, c); return; } var tgt = P[c.pi], px = g.position.x, pz = g.position.z, dx = tgt.x - px, dz = tgt.z - pz, L = Math.hypot(dx, dz);
    // somebody in the way (the player or another walker a step ahead): wait a moment
    c.wait = false; if (c.waitT === undefined) c.waitT = 0; var fx = L > 1e-4 ? dx / L : 0, fz = L > 1e-4 ? dz / L : 0;
    if (player && c.waitT < 2.5) { var bx = player.position.x - px, bz = player.position.z - pz, ahead = bx * fx + bz * fz; if (ahead > 0 && ahead < 1.1 && Math.abs(bx * fz - bz * fx) < 0.55 && Math.abs(player.position.y - g.position.y) < 1.5) c.wait = true; }
    if (!c.wait && c.waitT < 2.5) for (var i = 0; i < A.npcs.length; i++) { var o = A.npcs[i]; if (o === c || o.st === "off") continue; var ox = o.g.position.x - px, oz = o.g.position.z - pz; if (Math.abs(ox) > 1.2 || Math.abs(oz) > 1.2) continue; var ah = ox * fx + oz * fz; if (ah > 0.15 && ah < 0.95 && Math.abs(ox * fz - oz * fx) < 0.5 && (o.st !== "walk" || o.k < c.k)) { c.wait = true; break; } }
    if (c.wait) { c.waitT += dt; return; } c.waitT = Math.max(0, c.waitT - dt * 0.5);
    var step = c.sp * dt; if (L <= step + 0.05) { g.position.x = tgt.x; g.position.z = tgt.z; c.pi++; if (tgt.l >= 0) c.l = tgt.l; } else { g.position.x += fx * step; g.position.z += fz * step; }
    var y; if (tgt.y !== undefined) { var pr = c.pi > 0 ? P[c.pi - 1] : null; if (tgt.y !== undefined && pr && pr.y !== undefined) { var seg = Math.hypot(tgt.x - pr.x, tgt.z - pr.z) || 1, k = clamp(1 - Math.hypot(tgt.x - g.position.x, tgt.z - g.position.z) / seg, 0, 1); y = pr.y + (tgt.y - pr.y) * k; } else y = tgt.y; if (d < 60 && tgt.s) { try { var sy = surfaceAt(g.position.x, g.position.z, y + STEPUP); if (sy > y - 0.25 && sy < y + 0.25) y = sy; } catch (e) {} } }
    else { y = hAt(A, c.l, g.position.x, g.position.z); var LV = A.def.levels[c.l]; if (d < 40 && LV.base && LV.exact) { var by = LV.base(g.position.x, g.position.z); if (Math.abs(by - y) < 0.12) y = by; } }
    if (y > -1e8) { g.position.y = Math.abs(y - g.position.y) > 1.2 ? y : g.position.y + (y - g.position.y) * Math.min(1, dt * 14); }
    if (L > 0.05) { var want = Math.atan2(fx, fz); g.rotation.y += angTo(g.rotation.y, want) * Math.min(1, dt * 7); }
    if (c.pi >= P.length) { if (c.back) { c.back = false; c.warp = false; c.st = "act"; c.t = 0.05; c.at = null; } else arrive(A, c); } }
  function actStep(A, c, dt, d, h) { var g = c.g, u = g.userData, p = c.at;
    if (p && (p.seat || p.sitAt) && c.sitK >= 0 && c.sitK < 1) { c.sitK = Math.min(1, c.sitK + dt * 3); var s0 = c.sit0, sx = p.sitAt ? p.sitAt[0] : p.sx, sy = p.sitAt ? p.sitAt[1] : p.sy, sz = p.sitAt ? p.sitAt[2] : p.sz, k = c.sitK;
      g.position.set(s0[0] + (sx - s0[0]) * k, s0[1] + (sy - s0[1]) * k, s0[2] + (sz - s0[2]) * k); g.rotation.y += angTo(g.rotation.y, p.face) * Math.min(1, dt * 10); if (k >= 1 && !u.sit) { g.rotation.y = p.face; u.sit = true; try { sitOffset(g, p.back !== undefined ? p.back : 0.22); } catch (e) {} if (u.blob) u.blob.visible = false; if (u.label) u.label.position.y = 1.7; } return; }
    if (u.sit) return; var face = p && typeof p.face === "number" ? p.face : null;
    if (p && p.kind === "chat" && p.pair && p.pair.by && p.pair.by.at === p.pair) { var o = p.pair.by.g.position; face = Math.atan2(o.x - g.position.x, o.z - g.position.z); }
    if (player && !u.dance && (!p || p.kind !== "chat")) { var dpl = Math.hypot(player.position.x - g.position.x, player.position.z - g.position.z); if (dpl < 3.5 && Math.abs(player.position.y - g.position.y) < 1.5) face = Math.atan2(player.position.x - g.position.x, player.position.z - g.position.z); }
    if (face !== null) g.rotation.y += angTo(g.rotation.y, face) * Math.min(1, dt * 3); }
  // ambient lines: now and then someone you can see says something that fits where they are (a bubble, not the chat log)
  function ambient(A, h) { if (!A.def.lines || now() < (A.sayAt || 0)) return; A.sayAt = now() + rnd(7000, 13000); var cp = camera.position, best = null, bd = 1e9;
    for (var i = 0; i < A.npcs.length; i++) { var c = A.npcs[i]; if (c.st !== "act" || !c.at || c.at.quiet || c.bub || !c.g.visible) continue; var d = Math.hypot(c.g.position.x - cp.x, c.g.position.z - cp.z); if (d < 3 || d > 24) continue; if (A.def.sameZone && !A.def.sameZone(c)) continue; if (!npcInView(_v.set(c.g.position.x, c.g.position.y + 1, c.g.position.z))) continue; var sc = d + Math.random() * 10; if (c.at.kind === "chat" && c.at.pair && c.at.pair.by) sc -= 8; if (sc < bd) { bd = sc; best = c; } }
    if (!best) return; var L = A.def.lines[best.at.line || best.at.kind] || A.def.lines.any; if (!L || !L.length) return; bubble(best, pick(L)); }
  // events (the keynote): a few people are sent to the event's seats before it starts, sit through it, then go on with their day
  function eventFrame(A, h) { (A.def.events() || []).forEach(function (E) { var on = h >= E.from && h < E.end, st = A.ev[E.id] || (A.ev[E.id] = { sent: 0 });
      if (!on) { A.npcs.forEach(function (c) { if (c.ev === E) { c.ev = null; c.warp = true; if (c.at && c.at.ev && c.st === "act") c.t = Math.min(c.t, rnd(2, 25)); } }); st.sent = 0; return; }
      if (FR.k % 30 !== 3) return; var seats = A.pois.filter(function (p) { return p.ev === E.id; }), busy = A.npcs.filter(function (c) { return c.ev === E; }).length; if (busy >= Math.min(E.max, seats.length)) return;
      var free = seats.filter(function (p) { return !p.by; }); if (!free.length) return; var cand = A.npcs.filter(function (c) { return c.st !== "off" && !c.ev && !c.leaving; }); if (cand.length <= (E.keep || 0)) return;
      var c = pick(cand), p = pick(free); if (c.g.userData.sit || c.g.userData.dance) standUp(c); c.ev = E; c.warp = h >= E.start - 0.05; goTo(A, c, p); st.sent++; }); }

  // ───────── hooks: the frame, seats the player can take, a door near people ─────────
  RO.near = function (x, z, r) { for (var k in RO.A) { var A = RO.A[k]; if (!A.on) continue; for (var i = 0; i < A.npcs.length; i++) { var c = A.npcs[i]; if (c.st === "off") continue; var p = c.g.position; if (Math.abs(p.x - x) < r && Math.abs(p.z - z) < r) return true; } } return false; };
  function seatTaken(sd) { for (var k in RO.A) { var A = RO.A[k]; if (!A.on) continue; for (var i = 0; i < A.npcs.length; i++) { var c = A.npcs[i], p = c.at || c.poi; if (c.st === "off" || !p || !(p.seat || p.sitAt)) continue; var sx = p.sitAt ? p.sitAt[0] : p.sx, sz = p.sitAt ? p.sitAt[2] : p.sz; if (Math.abs(sx - sd.x) < 0.4 && Math.abs(sz - sd.z) < 0.4) return true; } } return false; }
  function install() { if (FR.inst) return; FR.inst = true; try { var o = nearestSeat; nearestSeat = function () { var r = o.apply(this, arguments); try { if (r && seatTaken(r)) return null; } catch (e) {} return r; }; FR.o = o; } catch (e) { note("wrap seat", e); } }
  function frameHook(dt) {
    if (RO.off || typeof SOLIDS === "undefined" || !player || !camera) return; dt = Math.min(dt || 0.016, 0.1); FR.k++; if (!FR.t0) FR.t0 = now(); install();
    var t = now(), until = t + (RO.budget || 2.5), h = hour();
    for (var k in RO.A) { try { areaFrame(RO.A[k], dt, h, until); } catch (e) { note("area " + k, e); } }
    RO.n.ms = +(now() - t).toFixed(2); if (RO.n.ms > (RO.n.msMax || 0)) RO.n.msMax = RO.n.ms; }
  (function hook() { window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] }; var L = window.PLAN_HOOKS.frame; for (var i = 0; i < L.length; i++) if (L[i] && L[i].name === "roamFrame") { L[i].fn = frameHook; return; } L.push({ name: "roamFrame", fn: frameHook }); })();

  RO.stats = function () { var o = { ms: RO.n.ms, msMax: RO.n.msMax, errs: RO.errs.length }; for (var k in RO.A) { var A = RO.A[k], s = {}; A.npcs.forEach(function (c) { s[c.st] = (s[c.st] || 0) + 1; }); var vis = A.npcs.filter(function (c) { return c.st !== "off" && c.g.visible; }).length;
      var sit = A.npcs.filter(function (c) { return c.st !== "off" && c.g.userData.sit; }).length; o[k] = { st: A.st, on: A.on, target: A.target, built: A.npcs.length, states: s, visible: vis, sitting: sit, n: A.n }; } return o; };
  RO.debug = {
    // the walk grid of an area as a PNG data URL (level l): walkable cells light, heights tinted, POIs red, entries blue
    png: function (id, l, scale) { var A = RO.A[id]; if (!A || !A.G) return null; var G = A.G, Lv = G.lv[l || 0], s = scale || 2, cv = document.createElement("canvas"); cv.width = G.nx * s; cv.height = G.nz * s; var x = cv.getContext("2d"), im = x.createImageData(G.nx, G.nz), lo = 1e9, hi = -1e9;
      for (var j = 0; j < G.N; j++) if (Lv.W[j]) { lo = Math.min(lo, Lv.Y[j]); hi = Math.max(hi, Lv.Y[j]); } for (var j2 = 0; j2 < G.N; j2++) { var o = j2 * 4; if (Lv.W[j2]) { var k = (Lv.Y[j2] - lo) / Math.max(0.1, hi - lo); im.data[o] = 120 + 120 * k; im.data[o + 1] = 200; im.data[o + 2] = 120 + 100 * (1 - k); } else { im.data[o] = 30; im.data[o + 1] = 30; im.data[o + 2] = 34; } im.data[o + 3] = 255; }
      var c0 = document.createElement("canvas"); c0.width = G.nx; c0.height = G.nz; c0.getContext("2d").putImageData(im, 0, 0); x.imageSmoothingEnabled = false; x.drawImage(c0, 0, 0, G.nx * s, G.nz * s);
      A.pois.forEach(function (p) { if ((p.l || 0) !== (l || 0) && !p.via) return; var px = p.via ? p.via[0][0] : p.x, pz = p.via ? p.via[0][2] : p.z; x.fillStyle = p.seat ? "#ff9f1a" : p.via ? "#c040ff" : "#ff3030"; x.fillRect((px - G.x0) / CELL * s - s, (pz - G.z0) / CELL * s - s, s * 2, s * 2); });
      (A.def.entries ? A.def.entries() : []).forEach(function (e) { x.fillStyle = "#30a0ff"; x.fillRect((e.x - G.x0) / CELL * s - 2 * s, (e.z - G.z0) / CELL * s - 2 * s, s * 4, s * 4); });
      A.npcs.forEach(function (c) { if (c.st === "off") return; x.fillStyle = "#ffffff"; x.fillRect((c.g.position.x - G.x0) / CELL * s - s, (c.g.position.z - G.z0) / CELL * s - s, s * 2, s * 2); if (c.path) { x.strokeStyle = "rgba(255,255,255,0.7)"; x.beginPath(); c.path.forEach(function (q, i) { var qx = (q.x - G.x0) / CELL * s, qz = (q.z - G.z0) / CELL * s; if (i) x.lineTo(qx, qz); else x.moveTo(qx, qz); }); x.stroke(); } });
      return cv.toDataURL("image/png"); },
    npcs: function (id) { var A = RO.A[id]; if (!A) return null; return A.npcs.map(function (c) { var p = c.g.position; return { name: c.name, st: c.st, l: c.l, x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1), poi: c.poi ? c.poi.kind + (c.poi.tag ? ":" + c.poi.tag : "") : null, at: c.at ? c.at.kind : null, vis: c.g.visible, sit: !!c.g.userData.sit, ev: c.ev ? c.ev.id : null, path: c.path ? c.path.length - c.pi : 0 }; }); },
    // check every path point and the ground under each person against the walk grid
    audit: function (id) { var A = RO.A[id]; if (!A || !A.G) return null; var bad = []; A.npcs.forEach(function (c) { if (c.st === "off" || !c.path) return; for (var i = 1; i < c.path.length; i++) { var a = c.path[i - 1], b = c.path[i]; if (a.l < 0 || b.l < 0 || a.l !== b.l) continue; if (!los(A, a.l, a.x, a.z, b.x, b.z)) bad.push([c.name, i, a.x.toFixed(1), a.z.toFixed(1), b.x.toFixed(1), b.z.toFixed(1)]); } }); return bad; },
    check: function (secs) { return new Promise(function (res) { var t0 = now(), n = 0, bad = [], f = function () { for (var k in RO.A) { var A = RO.A[k]; if (!A.G || !A.on) continue; A.npcs.forEach(function (c) { if (c.st !== "walk" || !c.path) return; var tg = c.path[Math.min(c.pi, c.path.length - 1)], pr = c.path[Math.max(0, c.pi - 1)]; if (tg.l < 0 || (pr && pr.l < 0)) return; n++; var p = c.g.position; if (snap(A.G, c.l, p.x, p.z, 0.36) < 0 && bad.length < 40) bad.push([k, c.name, +p.x.toFixed(2), +p.z.toFixed(2), c.l]); }); } if (now() - t0 < secs * 1000) requestAnimationFrame(f); else res({ samples: n, off: bad.length, bad: bad }); }; requestAnimationFrame(f); }); },
    follow: function (id, name) { var A = RO.A[id]; if (!A) return null; for (var i = 0; i < A.npcs.length; i++) if (A.npcs[i].name === name || (name === undefined && A.npcs[i].st === "walk")) return A.npcs[i]; return null; },
    send: function (id, name, kind, tag, near) { var A = RO.A[id]; if (!A) return null; var c = RO.debug.follow(id, name); if (!c) return null; var L = A.pois.filter(function (p) { return p.kind === kind && (!tag || p.tag === tag) && freePoi(p) && (!near || Math.hypot((p.x || p.via[0][0]) - near[0], (p.z || p.via[0][2]) - near[1]) < near[2]); }); if (!L.length) return "no " + kind; if (c.g.userData.sit || c.g.userData.dance) standUp(c); goTo(A, c, pick(L)); return c.name; },
    los: function (id, l, x0, z0, x1, z1) { return los(RO.A[id], l, x0, z0, x1, z1); }, walkable: function (id, l, x, z) { return walkable(RO.A[id], l, x, z); }, h: function (id, l, x, z) { return hAt(RO.A[id], l, x, z); }
  };
})();
