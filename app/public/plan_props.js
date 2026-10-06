// R16 (Agent V, vehicles and props): runtime material upgrades for the golf carts, the parked cars, the stagecoach and the street
// furniture (benches, lamps and lanterns, posts and pillars, pergolas, planters, fences, the porch furniture). Classic script, loaded before
// client.js; every client global is read by bare name at hook time. HANDOFF_R16_PROPS.md has the full story.
//   ?vp=0 everything off (the R15 look) · ?vpcart=0 carts · ?vpcoach=0 stagecoach · ?vpprop=0 street furniture · ?vpcar=0 parked cars
//   ?vpbs=0 body shop clear coat · ?vpdet=0 the near detail normals (ultra) · ?vplite=1 the high-tier path on ultra · ?vpporch=0 porch
//   furniture · ?vpe1=1 also plan_enrich's posts, lanterns and pillars (off by default: 4 more programs)
// Tiers: ultra gets everything; high the same materials without the near triplanar detail normals; medium and low are untouched
// (nothing is loaded there, 0 bytes). No new lights: head and tail lamps are emissive, picked up by the bloom.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_PROPS = window.PLAN_PROPS || { v: "r16-0", errs: [], n: {} };
(function () {
  "use strict";
  var VP = window.PLAN_PROPS; VP.v = "r16-9"; VP.errs = VP.errs || []; VP.n = VP.n || {};
  var Q = location.search;
  function sw(k) { return !new RegExp("[?&]" + k + "=0(?![\\w])").test(Q); }
  var qual = ""; try { qual = localStorage.getItem("g1:quality") || ""; } catch (e) {}
  if (!qual) qual = ((navigator.hardwareConcurrency || 8) <= 4 || /Android|iPhone|iPad/i.test(navigator.userAgent)) ? "medium" : "high";
  VP.tier = qual === "ultra" ? 2 : qual === "high" ? 1 : 0;
  if (VP.tier === 2 && /[?&]vplite=1\b/.test(Q)) VP.tier = 1;
  VP.on = sw("vp") && VP.tier > 0;
  VP.sw = { cart: sw("vpcart"), coach: sw("vpcoach"), prop: sw("vpprop"), car: sw("vpcar"), bs: sw("vpbs"), det: sw("vpdet") && VP.tier === 2, porch: sw("vpporch"),
    e1: /[?&]vpe1=1/.test(Q) };   // plan_enrich's posts, lanterns and pillars: 4 programs (two parameter variants of two families), opt-in for the program budget
  VP.n.tier = VP.tier; VP.n.on = VP.on;
  if (!VP.on) return;
  function note(w, e) { try { VP.errs.push(w + ": " + (e && e.message || e)); if (VP.errs.length > 40) VP.errs.shift(); console.warn("plan_props " + w, e); } catch (x) {} }
  function cnt(k, d) { VP.n[k] = (VP.n[k] || 0) + (d === undefined ? 1 : d); }
  function au(u) { try { if (window.AV) return window.AV(u); } catch (e) {} return u; }

  // ───────────────────────── shared textures and uniforms ─────────────────────────
  // vp_grime: R dust blotches, G fine speckle, B rust patches, A vertical streak runs (tileable, 512); vp_flake_n: metallic flake
  // normals (256); vp_grain_n: wood fibre and ring normals without plank seams (512); vp_cart_mask: the cart's materials in its own
  // uv layout (R paint, G bright metal, B rubber, A lamp lens); vp_cart_ao: the cart's ambient occlusion baked in Blender (1024)
  var TX = VP.tex = {};
  var LOADK = VP.loadK = {};   // texture name -> { value: 0 | 1 } (1 once the image is in)
  function tex(name, srgb, repeat) {
    if (TX[name]) return TX[name]; var k = LOADK[name] = LOADK[name] || { value: 0 };
    var t = new THREE.TextureLoader().load(au("/tex/" + name + "?v=" + (window.BUILD || 0)), function () { k.value = 1; cnt("texLoaded"); }, undefined, function (e) { note("texture " + name, e && e.type || e); });
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; else t.flipY = false;   // the model maps are in the glTF uv frame (v down)
    t.anisotropy = VP.tier === 2 ? 8 : 4; t.name = name; t.userData.avShared = true; t.userData.bsShared = true; TX[name] = t; return t; }
  var U = VP.u = null;
  function uni() {
    if (U) return U;
    var night = (typeof WIN !== "undefined" && WIN.u && WIN.u.uNight) || { value: 0 };
    U = VP.u = { uVpNight: night, tVpAO: { value: tex("vp_cart_ao.jpg", false, false) }, uVpAOK: LOADK["vp_cart_ao.jpg"], tVpMask: { value: tex("vp_cart_mask.png", false, false) }, uVpMaskK: LOADK["vp_cart_mask.png"], tVpGrime: { value: tex("vp_grime.png", false, true) }, tVpFlake: { value: tex("vp_flake_n.png", false, true) }, tVpGrain: { value: tex("vp_grain_n.png", false, true) },
      uVpDustC: { value: new THREE.Color(0xc2ae94).convertSRGBToLinear() }, uVpRustC: { value: new THREE.Color(0x7a4024).convertSRGBToLinear() }, uVpK: { value: 1 } };
    return U;
  }

  // ───────────────────────── GLSL ─────────────────────────
  var V_HEAD = "varying vec3 vVpO; varying vec3 vVpON; varying vec3 vVpW; varying vec3 vVpWN;\n#ifdef VP_AXES\nvarying vec3 vVpAX; varying vec3 vVpAY; varying vec3 vVpAZ;\n#endif\n#ifdef VP_ROOFH\nvarying float vVpRoof;\n#endif\n";
  var V_BODY = [
    "vVpO = position; vVpON = objectNormal;",
    "{ vec4 vpw = vec4(transformed, 1.0);",
    "#ifdef USE_BATCHING",
    "  vpw = batchingMatrix * vpw;",
    "#endif",
    "#ifdef USE_INSTANCING",
    "  vpw = instanceMatrix * vpw;",
    "#endif",
    "  vVpW = (modelMatrix * vpw).xyz; vVpWN = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz); }",
    "#ifdef VP_AXES",
    "{ mat3 vpm = mat3(modelMatrix);",
    "#ifdef USE_INSTANCING",
    "  vpm = vpm * mat3(instanceMatrix);",
    "#endif",
    "  mat3 vpv = mat3(viewMatrix) * vpm; vVpAX = normalize(vpv[0]); vVpAY = normalize(vpv[1]); vVpAZ = normalize(vpv[2]); }",
    "#endif",
    "#ifdef VP_ROOFH",
    "#ifdef USE_BATCHING",
    "  vVpRoof = fract(float(getIndirectIndex(gl_DrawID)) * 0.6180339 + 0.13);",
    "#else",
    "  vVpRoof = -1.0;",
    "#endif",
    "#endif"].join("\n");
  var F_COMMON = [
    "varying vec3 vVpO; varying vec3 vVpON; varying vec3 vVpW; varying vec3 vVpWN;",
    "#ifdef VP_AXES",
    "varying vec3 vVpAX; varying vec3 vVpAY; varying vec3 vVpAZ;",
    "#endif",
    "#ifdef VP_ROOFH",
    "varying float vVpRoof;",
    "#endif",
    "uniform sampler2D tVpGrime; uniform float uVpNight; uniform float uVpK; uniform vec3 uVpDustC; uniform vec3 uVpRustC;",
    "float vpLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }",
    "vec3 vpTriW(vec3 n) { vec3 b = pow(abs(n), vec3(4.0)); return b / max(dot(b, vec3(1.0)), 1e-4); }",
    "vec4 vpTri(sampler2D t, vec3 p, vec3 w) { return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z; }",
    // whiteout-style triplanar detail normal: the object (or world) space normal n bent by a tangent space map on the three planes
    "vec3 vpTriN(sampler2D t, vec3 p, vec3 n, vec3 w, float k) {",
    "  vec3 tx = texture2D(t, p.zy).xyz * 2.0 - 1.0, ty = texture2D(t, p.xz).xyz * 2.0 - 1.0, tz = texture2D(t, p.xy).xyz * 2.0 - 1.0;",
    "  vec3 d = vec3(0.0, tx.y, tx.x) * w.x + vec3(ty.x, 0.0, ty.y) * w.y + vec3(tz.x, tz.y, 0.0) * w.z; return normalize(n + d * k); }",
    // a tangent frame from a view space normal (the flake and grain directions only need to be consistent, not aligned)
    "void vpFrame(vec3 N, out vec3 T, out vec3 B) { T = normalize(cross(N, abs(N.y) < 0.92 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))); B = cross(N, T); }"].join("\n");

  // ── the golf cart: one physical (clear coat) material family for the stock carts, every colour, the parked and the batched carts ──
  // classes: paint, bright metal and rubber from the mask; the lamp lens from the mask's alpha; roof, seat, struts and trim from the
  // texel colour and the model frame (as plan_bodyshop's segmentation): paint takes the colour uniform (or the batch colour), metallic
  // flake under a clear coat; rims anodised alloy; tyres rubber; desert dust on the lower body, the tyres, the sills and in the cavities;
  // sun fade on the up-facing paint; head lamps and tail lamps lit at night when the cart is in use
  var CART_F_HEAD = [
    "uniform vec3 uVpPaint; uniform vec4 uVpFin; uniform vec4 uVpCart; uniform vec4 uVpCart2; uniform sampler2D tVpFlake; uniform sampler2D tVpAO; uniform sampler2D tVpMask; uniform float uVpAOK; uniform float uVpMaskK;",
    "float vpP = 0.0, vpMe = 0.0, vpRu = 0.0, vpLens = 0.0, vpTail = 0.0, vpDust = 0.0, vpCC = 0.0, vpR = 0.6, vpM = 0.0, vpRoofW = 0.0, vpStrut = 0.0; vec4 vpGr = vec4(0.5);"].join("\n");
  // uVpFin: x base roughness under the coat, y metalness, z clear coat, w flake strength; uVpCart: x mean paint luminance (sRGB) of the
  // texture, y dust amount, z lamps on (0/1), w sun fade; uVpCart2: x flake tiling (1/m), y tail lamp z (rear panel), z ao strength
  var CART_F_COLOR = [
    "vec3 vpBC = vec3(-1.0);",
    "#if defined( USE_COLOR )",
    "  vpBC = vColor.rgb;",
    "#endif",
    "{ vec4 mk = texture2D(tVpMask, vMapUv) * uVpMaskK; vpP = mk.r; vpMe = mk.g; vpRu = mk.b; float lensM = mk.a;",
    "  vec3 tc = diffuseColor.rgb; vec3 s = sqrt(max(tc, vec3(0.0))); float lum = dot(s, vec3(0.299, 0.587, 0.114)); float mx = max(s.r, max(s.g, s.b)), mn = min(s.r, min(s.g, s.b)); float sat = (mx - mn) / (mx + 1e-4);",
    "  vec3 p = vVpO; vec3 on = normalize(vVpON); float ax = abs(p.x); vpP *= 1.0 - vpRu; float rest = clamp(1.0 - vpP - vpMe - vpRu, 0.0, 1.0);",
    "  vpRoofW = rest * smoothstep(1.76, 1.82, p.y);",
    "  float seat = rest * (1.0 - vpRoofW) * step(0.42, lum) * step(0.03, s.r - s.b) * step(0.5, p.y) * step(p.y, 1.42) * step(-1.3, p.z) * step(p.z, 0.3) * step(ax, 0.64);",
    "  float lensR = step(1.0, p.z) * step(0.22, ax) * step(ax, 0.5) * step(0.46, p.y) * step(p.y, 0.74) * smoothstep(0.4, 0.58, lum) * (1.0 - smoothstep(0.18, 0.3, sat)); vpLens = clamp(max(lensM, lensR) * (1.0 - vpP) * (1.0 - vpRu), 0.0, 1.0);",
    "  vpStrut = clamp(rest - vpRoofW - seat - vpLens, 0.0, 1.0) * step(0.5, lum) * step(sat, 0.22) * step(0.7, p.y);",
    "  float trim = clamp(rest - vpRoofW - seat - vpLens - vpStrut, 0.0, 1.0);",
    // tail lamps: two small lenses on the rear panel (the scan has none)
    "  vec2 tq = vec2(ax - 0.46, p.y - 0.56); vpTail = (1.0 - smoothstep(0.0, 0.012, length(max(abs(tq) - vec2(0.062, 0.03), 0.0)))) * step(p.z, uVpCart2.y) * smoothstep(-0.3, -0.55, on.z) * clamp(1.0 - vpRu - vpMe, 0.0, 1.0);",
    "  vec3 pc = vpBC.r >= 0.0 ? vpBC : uVpPaint; float det = clamp(lum / max(uVpCart.x, 0.05), 0.72, 1.2); vec3 paintC = pc * mix(1.0, det, 0.38);",
    "#ifdef VP_ROOFH",
    "  if (vVpRoof >= 0.0) { vec3 rc = vVpRoof < 0.45 ? vec3(0.85, 0.85, 0.80) : vVpRoof < 0.62 ? vec3(0.58, 0.47, 0.30) : vVpRoof < 0.8 ? vec3(0.012, 0.012, 0.014) : vVpRoof < 0.9 ? vec3(0.02, 0.17, 0.05) : vec3(0.3, 0.014, 0.01); tc = mix(tc, rc * clamp(lum / 0.85, 0.75, 1.1), vpRoofW); }",
    "#endif",
    "  vec3 alb = tc; float rg = 0.6, me = 0.0, cc = 0.0;",
    "  alb = mix(alb, paintC, vpP); rg = mix(rg, uVpFin.x, vpP); me = mix(me, uVpFin.y, vpP); cc += vpP * uVpFin.z;",
    "  alb = mix(alb, vec3(0.56, 0.57, 0.6) * mix(0.85, 1.1, clamp(lum * 1.4, 0.0, 1.0)), vpMe); rg = mix(rg, 0.24, vpMe); me = mix(me, 1.0, vpMe);",
    "  alb = mix(alb, min(tc, vec3(0.04)) + 0.008, vpRu); rg = mix(rg, 0.86, vpRu);",
    "  rg = mix(rg, 0.4, vpRoofW); cc += vpRoofW * 0.45;",
    "  rg = mix(rg, 0.46, seat); cc += seat * 0.22;",
    "  alb = mix(alb, max(tc * 1.15, vec3(0.32)), vpLens); rg = mix(rg, 0.12, vpLens); me = mix(me, 0.55, vpLens); cc += vpLens;",
    "  rg = mix(rg, 0.34, vpStrut); cc += vpStrut * 0.3;",
    "  alb = mix(alb, max(tc, vec3(0.012)), trim); rg = mix(rg, 0.56, trim);",
    "  alb = mix(alb, vec3(0.13, 0.008, 0.006), vpTail); rg = mix(rg, 0.1, vpTail); cc = mix(cc, 1.0, vpTail);",
    // dust: the lower body and wheels, the sills and floor, the cavities; streaks run down the panels
    "  vec3 gw = vpTriW(on); vpGr = vpTri(tVpGrime, p * 1.7, gw);",
    "  float low = 1.0 - smoothstep(0.04, 0.46, p.y); float up = smoothstep(0.55, 0.95, normalize(vVpWN).y);",
    "  vpDust = uVpCart.y * clamp(low * (0.3 + 0.75 * vpGr.r) * (0.55 + 0.45 * vpGr.a) * (1.0 - vpRu * 0.55) + up * 0.14 * vpGr.r * (1.0 - vpRoofW * 0.5) + vpRu * 0.07 * (0.5 + vpGr.r), 0.0, 1.0);",
    "  float fade = uVpCart.w * vpP * up; alb = mix(alb, mix(alb, vec3(vpLum(alb)), 0.22) * 1.12 + 0.006, fade);",
    "  alb = mix(alb, mix(uVpDustC, vec3(vpLum(uVpDustC)), vpRu * 0.5) * (0.82 + 0.36 * vpGr.g), vpDust * mix(0.78, 0.6, vpRu));",
    "  rg = mix(rg, 0.94, vpDust); me *= 1.0 - vpDust; cc *= 1.0 - vpDust * 0.9;",
    "  diffuseColor.rgb = mix(tc, alb, uVpK); vpR = rg; vpM = me; vpCC = cc * uVpK; }"].join("\n");
  var CART_F_RM = "roughnessFactor = mix(roughnessFactor, vpR, uVpK); metalnessFactor = mix(metalnessFactor, vpM, uVpK);";
  var CART_F_N = [
    "{ float smk = (vpP * 0.88 + vpMe * 0.55 + (vpRoofW + vpStrut) * 0.6 + vpLens) * uVpK; normal = normalize(mix(normal, nonPerturbedNormal, clamp(smk, 0.0, 1.0)));",
    "  if (vpP > 0.01 && uVpFin.w > 0.0) { vec3 fa = abs(normalize(vVpON)); vec2 fuv = fa.x > fa.y && fa.x > fa.z ? vVpO.zy : fa.y > fa.z ? vVpO.xz : vVpO.xy; vec3 f = texture2D(tVpFlake, fuv * uVpCart2.x).xyz * 2.0 - 1.0;",
    "    vec3 T, B; vpFrame(nonPerturbedNormal, T, B); normal = normalize(mix(normal, normalize(nonPerturbedNormal + (T * f.x + B * f.y) * uVpFin.w), vpP * (1.0 - vpDust) * uVpK)); } }"].join("\n");
  var CART_F_EM = "totalEmissiveRadiance += (vpLens * vec3(1.0, 0.93, 0.8) * 3.4 + vpTail * vec3(1.0, 0.06, 0.03) * 2.6) * uVpNight * uVpCart.z * uVpK;";
  var CART_F_AO = [
    "{ float vpAo = mix(1.0, texture2D(tVpAO, vMapUv).r, uVpAOK * uVpK); reflectedLight.indirectDiffuse *= vpAo; reflectedLight.indirectSpecular *= mix(1.0, vpAo, 0.75);",
    "#ifdef USE_CLEARCOAT",
    "  clearcoatSpecularIndirect *= mix(1.0, vpAo, 0.6);",
    "#endif",
    "}"].join("\n");
  var CART_F_CC = [
    "#ifdef USE_CLEARCOAT",
    "  material.clearcoat = clamp(vpCC, 0.0, 1.0); material.clearcoatRoughness = min(max(0.035 + vpDust * 0.6, 0.0525) + geometryRoughness, 1.0);",
    "#endif"].join("\n");

  // ── the body shop's custom looks (plan_bodyshop.js materials, cloned from this cart material): the clear coat per region ──
  var BS_F_CC = [
    "#ifdef USE_CLEARCOAT",
    "{ float vpR0 = floor(vBsr + 0.5); float k = vpR0 == 1.0 ? (1.0 - smoothstep(0.45, 0.72, uFin.x)) * (uFin.y > 0.95 ? 0.35 : 1.0) : vpR0 == 2.0 ? 0.45 : vpR0 == 8.0 ? 1.0 : vpR0 == 3.0 ? 0.18 : vpR0 == 7.0 ? 0.3 : 0.0; material.clearcoat *= k * uVpK; material.clearcoatRoughness = min(max(0.04, 0.0525) + geometryRoughness, 1.0);",
    "  totalEmissiveRadiance += (vpR0 == 8.0 ? vec3(1.0, 0.93, 0.8) * 3.2 : vec3(0.0)) * uNight * uVpK; }",
    "#endif"].join("\n");

  // ── the stagecoach: lacquered red and yellow panels and wheels, black iron, leather, bare wood; wood grain under the paint and in
  // the bare wood (object space triplanar, so it travels with the coach), edge wear, desert dust on the wheels and the running gear,
  // rust in the iron's cavities ──
  var COACH_F_HEAD = "uniform vec4 uVpCo; uniform vec4 uVpCo2; uniform sampler2D tVpGrain; float vpPa = 0.0, vpIr = 0.0, vpLe = 0.0, vpWo = 0.0, vpDust = 0.0, vpRust = 0.0, vpCC = 0.0, vpR = 0.6, vpM = 0.0; vec4 vpGr = vec4(0.5);";
  // uVpCo: x dust, y rust, z grain strength (ultra), w clear coat; uVpCo2: x grain tiling (1/m), y model height
  var COACH_F_COLOR = [
    "{ vec3 tc = diffuseColor.rgb; vec3 s = sqrt(max(tc, vec3(0.0))); float lum = dot(s, vec3(0.299, 0.587, 0.114)); float mx = max(s.r, max(s.g, s.b)), mn = min(s.r, min(s.g, s.b)); float sat = (mx - mn) / (mx + 1e-4);",
    "  float mt = metalness;",
    "#if defined( USE_METALNESSMAP )",
    "  mt *= texture2D(metalnessMap, vMetalnessMapUv).b;",
    "#elif defined( USE_ROUGHNESSMAP ) && defined( VP_ORM )",
    "  mt *= texture2D(roughnessMap, vRoughnessMapUv).b;",
    "#endif",
    "  float red = smoothstep(0.06, 0.18, s.r - max(s.g, s.b) * 1.1) * step(0.22, s.r);",
    "  float yel = smoothstep(0.04, 0.14, min(s.r, s.g) - s.b - 0.05) * step(0.38, s.r) * step(0.26, s.g);",
    "  vpIr = clamp((1.0 - smoothstep(0.11, 0.2, lum)) * (1.0 - smoothstep(0.3, 0.55, sat)) + smoothstep(0.15, 0.3, mt), 0.0, 1.0);",
    "  vpPa = max(red, yel) * (1.0 - vpIr);",
    "  vpLe = (1.0 - vpPa) * (1.0 - vpIr) * step(s.b, s.g + 0.02) * step(s.g, s.r + 0.02) * smoothstep(0.12, 0.28, sat) * (1.0 - smoothstep(0.32, 0.5, lum));",
    "  vpWo = clamp(1.0 - vpPa - vpIr - vpLe, 0.0, 1.0);",
    "  vec3 p = vVpO; vec3 on = normalize(vVpON); vec3 gw = vpTriW(on); vpGr = vpTri(tVpGrime, p * 1.2, gw);",
    "  float low = 1.0 - smoothstep(0.1, 1.05, p.y); float up = smoothstep(0.55, 0.95, normalize(vVpWN).y);",
    "  vpDust = uVpCo.x * clamp(low * (0.32 + 0.8 * vpGr.r) * (0.6 + 0.4 * vpGr.a) + up * 0.35 * vpGr.r, 0.0, 1.0);",
    "  vpRust = uVpCo.y * vpIr * smoothstep(0.35, 0.75, vpGr.b * 0.8 + low * 0.35 + vpGr.r * 0.2);",
    "  vec3 alb = tc; alb = mix(alb, alb * vec3(1.04, 0.98, 0.94) + vec3(0.004), vpPa * up * 0.6);",   // sun on the lacquer
    "  alb = mix(alb, uVpRustC * (0.65 + 0.7 * vpGr.g), vpRust * 0.85);",
    "  alb = mix(alb, uVpDustC * (0.8 + 0.4 * vpGr.g), vpDust * 0.8);",
    "  float rg = mix(mix(mix(0.74, 0.42, vpPa), 0.5, vpIr), 0.6, vpLe); rg = mix(rg, 0.9, max(vpDust, vpRust)); float me = vpIr * (1.0 - vpRust) * (1.0 - vpDust) * 0.85;",
    "  vpCC = uVpCo.w * vpPa * (1.0 - vpDust) * uVpK; diffuseColor.rgb = mix(tc, alb, uVpK); vpR = rg; vpM = me; }"].join("\n");
  var COACH_F_N = [
    "{",
    "#if defined( USE_NORMALMAP_TANGENTSPACE )",
    "  float wear = smoothstep(0.32, 0.7, length(mapN.xy)) * smoothstep(0.35, 0.8, vpGr.g) * vpPa; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.1, 0.06), wear * 0.75 * uVpK); vpR = mix(vpR, 0.8, wear); vpCC *= 1.0 - wear;",
    "#endif",
    "#ifdef VP_DETAIL",
    "  float dk = uVpCo.z * uVpK * (1.0 - smoothstep(5.0, 18.0, length(vViewPosition)));",
    "  if (dk > 0.001) { vec3 on = normalize(vVpON); vec3 w = vpTriW(on); vec3 pg = vVpO * uVpCo2.x; vec3 n2 = vpTriN(tVpGrain, pg, on, w, 1.0) - on;",
    "    vec3 dv = vVpAX * n2.x + vVpAY * n2.y + vVpAZ * n2.z; normal = normalize(normal + dv * dk * (vpWo * 1.0 + vpPa * 0.35 + vpLe * 0.25) * (1.0 - vpDust * 0.6)); }",
    "#endif",
    "}"].join("\n");
  var COACH_F_RM = "\n#if !defined( USE_METALNESSMAP ) && defined( USE_ROUGHNESSMAP ) && defined( VP_ORM )\n metalnessFactor *= texture2D(roughnessMap, vRoughnessMapUv).b;\n#endif\n roughnessFactor = mix(roughnessFactor, vpR, uVpK); metalnessFactor = mix(metalnessFactor, vpM, uVpK);";
  var COACH_F_CC = [
    "#ifdef USE_CLEARCOAT",
    "  material.clearcoat = clamp(vpCC, 0.0, 1.0); material.clearcoatRoughness = min(max(0.09, 0.0525) + geometryRoughness, 1.0);",
    "#endif"].join("\n");

  // ── street furniture (benches, lamps, pillars, pergolas, planters, fences, the module posts and lanterns): world space (the props
  // never move), so the dust settles on what faces up, near the ground and in the cavities (the model's own AO); iron rusts in its
  // cavities and low down; painted and wooden tops fade in the sun; near the camera a triplanar detail normal (wood grain or fine
  // grit) carries the surface past the texture's own resolution (ultra) ──
  var PROP_F_HEAD = "uniform vec4 uVpA; uniform vec4 uVpB; uniform sampler2D tVpDet; float vpDust = 0.0, vpRust = 0.0, vpMetW = 0.0; vec4 vpGr = vec4(0.5);";
  // uVpA: x dust, y rust, z sun fade, w detail strength; uVpB: x model height, y detail tiling (1/m), z roughness floor, w metal tint
  var PROP_F_COLOR = [
    "{ vec3 tc = diffuseColor.rgb; float lum = vpLum(tc);",
    "  float mt = metalness;",
    "#if defined( USE_METALNESSMAP )",
    "  mt *= texture2D(metalnessMap, vMetalnessMapUv).b;",
    "#elif defined( USE_ROUGHNESSMAP ) && defined( VP_ORM )",
    "  mt *= texture2D(roughnessMap, vRoughnessMapUv).b;",
    "#endif",
    "  float aoT = 1.0;",
    "#ifdef USE_AOMAP",
    "  aoT = texture2D(aoMap, vAoMapUv).r;",
    "#endif",
    "  float metW = smoothstep(0.2, 0.5, mt);",
    "#ifdef VP_ATLAS4",
    "  { float t4 = floor((1.0 - vMapUv.y) * 4.0) * 4.0 + floor(vMapUv.x * 4.0); metW = (t4 == 8.0 || t4 == 9.0) ? 1.0 : 0.0; }",
    "#endif",
    "  vpMetW = metW;",
    "  vec3 wn = normalize(vVpWN); vec3 w = vpTriW(wn); vpGr = vpTri(tVpGrime, vVpW * 0.85, w);",
    "  float up = smoothstep(0.45, 0.95, wn.y); float base = 1.0 - smoothstep(0.0, 0.3 + uVpB.x * 0.06, vVpO.y);",
    "  vpDust = uVpA.x * clamp(up * (0.22 + 0.62 * vpGr.r) + base * (0.25 + 0.5 * vpGr.r) * (0.6 + 0.4 * vpGr.a) + (1.0 - aoT) * 0.5 * vpGr.r, 0.0, 1.0);",
    "  vpRust = uVpA.y * metW * smoothstep(0.3, 0.75, (1.0 - aoT) * 1.1 + vpGr.b * 0.75 + base * 0.3);",
    "  vec3 alb = tc; float fade = uVpA.z * up * (1.0 - metW); alb = mix(alb, mix(alb, vec3(lum), 0.3) * 1.1 + 0.012, fade);",
    "  alb = mix(alb, uVpRustC * (0.65 + 0.7 * vpGr.g), vpRust * 0.8);",
    "  alb = mix(alb, uVpDustC * (0.82 + 0.36 * vpGr.g), vpDust * 0.75);",
    "  diffuseColor.rgb = mix(tc, alb, uVpK); }"].join("\n");
  var PROP_F_RM = "\n#if !defined( USE_METALNESSMAP ) && defined( USE_ROUGHNESSMAP ) && defined( VP_ORM )\n metalnessFactor *= texture2D(roughnessMap, vRoughnessMapUv).b;\n#endif\n#ifdef VP_ATLAS4\n metalnessFactor = mix(metalnessFactor, 0.8, vpMetW * uVpK); roughnessFactor = mix(roughnessFactor, 0.46, vpMetW * uVpK);\n#endif\n roughnessFactor = mix(roughnessFactor, clamp(max(roughnessFactor * (0.9 + 0.2 * vpGr.g), uVpB.z), 0.04, 1.0), uVpK); roughnessFactor = mix(roughnessFactor, 0.94, max(vpDust, vpRust) * uVpK); metalnessFactor *= 1.0 - max(vpDust, vpRust * 0.85) * uVpK;";
  var PROP_F_N = [
    "#ifdef VP_DETAIL",
    "{ float dk = uVpA.w * uVpK * (1.0 - smoothstep(4.0, 16.0, length(vViewPosition))) * (1.0 - vpDust * 0.5);",
    "  if (dk > 0.001) { vec3 wn = normalize(vVpWN); vec3 w = vpTriW(wn); vec3 n2 = vpTriN(tVpDet, vVpW * uVpB.y, wn, w, 1.0) - wn; normal = normalize(normal + mat3(viewMatrix) * n2 * dk); } }",
    "#endif"].join("\n");

  function rep(src, find, add, before) { if (src.indexOf(find) < 0) { cnt("miss:" + find.slice(10, 40)); return src; } return src.replace(find, before ? add + "\n" + find : find + "\n" + add); }
  function patchCommon(sh, defs) {
    var u = uni(); for (var k in u) sh.uniforms[k] = u[k];
    var d = (defs || []).map(function (x) { return "#define " + x + "\n"; }).join("");
    sh.vertexShader = rep(sh.vertexShader, "#include <common>", d + V_HEAD); sh.vertexShader = rep(sh.vertexShader, "#include <begin_vertex>", V_BODY);
    sh.fragmentShader = rep(sh.fragmentShader, "#include <common>", d + F_COMMON);
  }
  function cartPatch(sh, M) {
    patchCommon(sh, M.roofH ? ["VP_ROOFH"] : []); for (var k in M.u) sh.uniforms[k] = M.u[k];
    var f = sh.fragmentShader; f = rep(f, "#include <common>", CART_F_HEAD);
    f = f.replace("#include <color_fragment>", CART_F_COLOR);
    f = rep(f, "#include <metalnessmap_fragment>", CART_F_RM); f = rep(f, "#include <normal_fragment_maps>", CART_F_N);
    f = rep(f, "#include <emissivemap_fragment>", CART_F_EM); f = rep(f, "#include <lights_physical_fragment>", CART_F_CC); f = rep(f, "#include <aomap_fragment>", CART_F_AO);
    sh.fragmentShader = f;
  }
  function coachPatch(sh, M) {
    patchCommon(sh, ["VP_AXES"].concat(VP.sw.det ? ["VP_DETAIL"] : []).concat(M.orm ? ["VP_ORM"] : [])); for (var k in M.u) sh.uniforms[k] = M.u[k];
    var f = sh.fragmentShader; f = rep(f, "#include <common>", COACH_F_HEAD); f = rep(f, "#include <color_fragment>", COACH_F_COLOR);
    f = rep(f, "#include <metalnessmap_fragment>", COACH_F_RM); f = rep(f, "#include <normal_fragment_maps>", COACH_F_N); f = rep(f, "#include <lights_physical_fragment>", COACH_F_CC);
    sh.fragmentShader = f;
  }
  function propPatch(sh, M) {
    patchCommon(sh, (VP.sw.det ? ["VP_DETAIL"] : []).concat(M.atlas ? ["VP_ATLAS4"] : []).concat(M.orm ? ["VP_ORM"] : [])); for (var k in M.u) sh.uniforms[k] = M.u[k];
    var f = sh.fragmentShader; f = rep(f, "#include <common>", PROP_F_HEAD); f = rep(f, "#include <color_fragment>", PROP_F_COLOR);
    f = rep(f, "#include <metalnessmap_fragment>", PROP_F_RM); f = rep(f, "#include <normal_fragment_maps>", PROP_F_N);
    sh.fragmentShader = f;
  }
  function bsPatchVp(sh) { var u = uni(); sh.uniforms.uVpK = u.uVpK; sh.uniforms.tVpAO = u.tVpAO; sh.uniforms.uVpAOK = u.uVpAOK; sh.fragmentShader = rep(sh.fragmentShader, "#include <common>", "uniform float uVpK; uniform sampler2D tVpAO; uniform float uVpAOK;"); sh.fragmentShader = rep(sh.fragmentShader, "#include <lights_physical_fragment>", BS_F_CC); sh.fragmentShader = rep(sh.fragmentShader, "#include <aomap_fragment>", CART_F_AO.replace("uVpAOK * uVpK", "uVpAOK * uVpK * step(vBsr, 9.5)")); }

  // ───────────────────────── materials ─────────────────────────
  // a physical copy of a standard material (maps, colours, flags), CSM-wrapped like every other material on high and ultra
  function toPhysical(src) { var m = new THREE.MeshPhysicalMaterial(); THREE.MeshStandardMaterial.prototype.copy.call(m, src); m.defines = Object.assign({}, src.defines || {}, { STANDARD: "", PHYSICAL: "" }); m.name = (src.name || "") + "+vp"; return m; }
  // per-material onBeforeCompile with the same source text for every material of a family (one shared program); the CSM wrapper keys
  // programs on that text. The closure carries the material's own uniforms.
  function obcCart(M) { return function (sh) { VP.patch.cart(sh, M); }; }
  function obcCoach(M) { return function (sh) { VP.patch.coach(sh, M); }; }
  function obcProp(M) { return function (sh, r) { if (M.prev) M.prev(sh, r); VP.patch.prop(sh, M); }; }
  VP.patch = { cart: cartPatch, coach: coachPatch, prop: propPatch, bs: bsPatchVp };
  function chainUser(m, fn) { var u = m._userObc !== undefined ? m._userObc : (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ? m.onBeforeCompile : null); m.onBeforeCompile = u ? function (sh, r) { u(sh, r); fn(sh, r); } : fn; }
  function warm(mats, name, inst) {
    try { var P = window.PLAN_PERF; if (!P || !P.warmGroup || !mats.length) return; var g = new THREE.Group(); g.name = "vp warm " + name; g.visible = false;
      var geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3)); geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3)); geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(6), 2)); geo.setAttribute("tangent", new THREE.BufferAttribute(new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]), 4));
      mats.forEach(function (m) { var o = inst ? new THREE.InstancedMesh(geo, m, 1) : new THREE.Mesh(geo, m); o.frustumCulled = false; g.add(o); });
      P.warmGroup(g, { detached: true, name: "vp " + name }); cnt("warm:" + name); } catch (e) { note("warm " + name, e); }
  }
  var OLD2NEW = VP.map = new Map();   // replaced material -> its upgrade (scene fix-up)
  var NEW2OLD = VP.back = new Map();   // upgrade -> the material it replaced (the in-session A/B, VP.api.ab)
  function rec(nm, old) { if (nm && old) NEW2OLD.set(nm, old); return nm; }

  // ── carts ──
  var CART = VP.cart = { base: null, mats: {}, paintLum: 0.3, green: null };
  var FIN_STOCK = [0.32, 0.06, 1.0, 0.2];   // metallic flake under a gloss clear coat
  function cartUniforms(paint, fin, lamps, dust) { return { uVpPaint: { value: paint.clone() }, uVpFin: { value: new THREE.Vector4(fin[0], fin[1], fin[2], fin[3]) },
    uVpCart: { value: new THREE.Vector4(CART.paintLum, dust, lamps, 0.15) }, uVpCart2: { value: new THREE.Vector4(VP.tier === 2 ? 26 : 18, -1.04, 1, 0) } }; }
  function makeCartMat(src, paint, fin, lamps, dust, opt) {
    var m = toPhysical(src); m._vpOk = true; m.clearcoat = 1; m.clearcoatRoughness = 0.04; m.envMapIntensity = 1.0; m.roughness = 0.6; m.metalness = 0.0; m.roughnessMap = null; m.metalnessMap = null; m.emissiveMap = null; m.emissive = new THREE.Color(0x000000); m.emissiveIntensity = 1;
    m.aoMap = null; m.aoMapIntensity = 1;
    var M = { u: cartUniforms(paint, fin, lamps, dust), roofH: !!(opt && opt.roofH) }; m.userData.vpU = M.u; m.userData.vp = "cart"; m.onBeforeCompile = obcCart(M);
    if (opt && opt.key) { var ck = opt.key; m.customProgramCacheKey = function () { return ck; }; }
    return m;
  }
  // the texture's mean paint colour (the green islands), from a 64 px copy of the albedo
  function measurePaint(map) {
    try { var img = map && map.image; if (!img || !img.width) return; var cv = document.createElement("canvas"); cv.width = cv.height = 64; var x = cv.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, 64, 64); var d = x.getImageData(0, 0, 64, 64).data, r = 0, g = 0, b = 0, n = 0, L = 0;
      for (var i = 0; i < d.length; i += 4) { var R = d[i] / 255, G = d[i + 1] / 255, B = d[i + 2] / 255; if (G - Math.max(R, B) > 0.06) { r += R; g += G; b += B; L += 0.299 * R + 0.587 * G + 0.114 * B; n++; } }
      if (n > 20) { var c0 = new THREE.Color(r / n, g / n, b / n), hs = { h: 0, s: 0, l: 0 }; c0.getHSL(hs); c0.setHSL(hs.h, Math.min(1, hs.s * 1.22), Math.min(0.9, hs.l * 1.06)); CART.green = c0.convertSRGBToLinear(); CART.paintLum = L / n; } } catch (e) { note("measure", e); }
  }
  // a CART_COLORS entry as a paint colour: the client's hue shift (hueShiftTexture) applied to the measured green
  function paintFor(ci) {
    var c = (typeof CART_COLORS !== "undefined" && CART_COLORS[ci]) || {}; var g = (CART.green || new THREE.Color(0x1f7a35).convertSRGBToLinear()).clone(); if (c.hue === undefined) return g;
    var s = g.clone().convertLinearToSRGB(), hsl = { h: 0, s: 0, l: 0 }; s.getHSL(hsl);
    if (c.hue === null) s.setHSL(hsl.h, hsl.s * 0.05, Math.min(0.97, 0.55 + hsl.l * 0.5)); else if (c.hue === "black") s.setHSL(hsl.h, hsl.s * 0.1, hsl.l * 0.22); else s.setHSL(((c.hue % 360) + 360) % 360 / 360, Math.min(1, hsl.s * (c.sat || 1)), Math.min(0.95, hsl.l * (c.light || 1)));
    return s.convertSRGBToLinear();
  }
  function finFor(ci) { var c = (typeof CART_COLORS !== "undefined" && CART_COLORS[ci]) || {}; if (c.hue === "black") return [0.62, 0.0, 0.25, 0.0]; if (c.hue === null) return [0.28, 0.12, 1.0, 0.12]; return FIN_STOCK; }
  function cartColorMat(ci) { ci = ci | 0; if (CART.mats[ci]) return CART.mats[ci]; if (!CART.base) return null; var m = makeCartMat(CART.src, paintFor(ci), finFor(ci), 1, 0.25); m.name = "vp_cart_" + ci; m.userData.vpCi = ci; CART.mats[ci] = m; cnt("cartColors"); return m; }
  function upCart() {
    if (!VP.sw.cart || CART.base) return; var mm = MODELS.cart; if (!mm || mm.proxy || !mm.parts || !mm.parts[0]) return; var src = mm.parts[0].material; if (!src || src._vpOk) return;
    measurePaint(src.map); CART.src = src;
    var base = makeCartMat(src, CART.green || new THREE.Color(0x1f7a35).convertSRGBToLinear(), FIN_STOCK, 0, 0.38); base.name = "vp_cart";
    // the body shop clones the base for every custom look: its clones get the clear coat per region (one shared program)
    // (?vpbs=0: the body shop gets the R15 standard material to clone, as before; anyone else always gets a plain clone)
    base.clone = function () { if (!VP.sw.bs) { var st = ""; try { st = new Error().stack || ""; } catch (e) {} if (st.indexOf("plan_bodyshop") >= 0) return CART.src.clone(); }
      var c = THREE.MeshPhysicalMaterial.prototype.clone.call(this); bsWrap(c); return c; };
    CART.lamps = makeCartMat(src, CART.green || new THREE.Color(0x1f7a35).convertSRGBToLinear(), FIN_STOCK, 1, 0.3); CART.lamps.name = "vp_cart_lit";
    CART.base = base; mm.parts[0].material = base; OLD2NEW.set(src, base); rec(base, src); rec(CART.lamps, src); cnt("cart");
  }
  // a clone of the cart base: the body shop's look materials get the clear coat per region; any other clone (plan_perf's compile
  // stand-ins, the interiors' indoor copies, which re-attach the source's own hooks) stays exactly what a normal clone would be.
  // The patch is keyed on the user onBeforeCompile being the body shop's (its closure calls bsPatch), so the two never share a program.
  function bsWrap(c) {
    c._vpBs = true; var isBs = function (u) { return !!u && String(u).indexOf("bsPatch(") >= 0; };
    Object.defineProperty(c, "onBeforeCompile", { configurable: true,
      get: function () { var u = c._userObc || null, cs = c._csmObc || null; if (!u && !cs) return THREE.Material.prototype.onBeforeCompile; if (!u) return cs;
        var g = c.__vpG; if (g && g.u === u) return g; var bs = isBs(u) && VP.sw.bs; g = function (sh, r) { if (cs) cs(sh, r); u(sh, r); if (bs) { VP.patch.bs(sh); } }; g.u = u; c.__vpG = g; if (bs && !c._vpOk) { c._vpOk = true; c.userData.vp = "bs"; cnt("bsWrapped"); } return g; },
      set: function (fn) { c._userObc = fn && fn !== THREE.Material.prototype.onBeforeCompile ? fn : null; } });
    c.customProgramCacheKey = function () { var u = c._userObc || null, csm = !!(c.defines && c.defines.USE_CSM); return (isBs(u) ? "vpbs2|" : "") + (csm ? "csm" + (u ? "|" + u.toString() : "") : (u ? u.toString() : "")); };
  }

  // ── the stagecoach ──
  var COACH = VP.coach = { mat: null };
  function coachUniforms(h) { return { uVpCo: { value: new THREE.Vector4(0.85, 0.75, VP.tier === 2 ? 0.55 : 0, 0.55) }, uVpCo2: { value: new THREE.Vector4(2.2, h || 3.25, 0, 0) } }; }
  function makeCoachMat(src, h) { var m = toPhysical(src); m._vpOk = true; m.clearcoat = 1; m.clearcoatRoughness = 0.1; m.envMapIntensity = 1.0; m.roughness = 1; m.metalness = 1; var orm = trimMaps(m); var M = { u: coachUniforms(h), orm: orm }; Object.defineProperty(m.userData, "vpM", { value: M, enumerable: false }); m.userData.vpU = M.u; m.userData.vp = "coach"; m.onBeforeCompile = obcCoach(M); m.name = (src.name || "coach") + "+vp"; return m; }
  function upCoachModel(m) { if (!VP.sw.coach || !m || m.proxy || !m.parts) return false; var p = m.parts[0]; if (!p || !p.material || p.material._vpOk) return false; var nm = rec(makeCoachMat(p.material, m.height), p.material); OLD2NEW.set(p.material, nm); p.material = nm; COACH.mat = nm; cnt("coach"); return true; }

  // ── street furniture ──
  // per kind: [dust, rust, sun fade, detail strength, detail texture ("grain" wood fibre | "grit" fine cast surface), tiling (1/m), roughness floor]
  var PROPK = VP.kinds = {
    bench_lux: [0.55, 0.5, 0.35, 0.6, "grain", 2.4, 0.35], lounge_chair: [0.35, 0.3, 0.3, 0.35, "grit", 3.0, 0.3], pergola: [0.6, 0.55, 0.3, 0.5, "grain", 1.6, 0.4],
    planter_lux: [0.6, 0.25, 0.2, 0.55, "grit", 2.2, 0.55], lux_lamp: [0.4, 0.65, 0.1, 0.4, "grit", 3.0, 0.3], lamp: [0.45, 0.6, 0.25, 0.45, "grain", 1.4, 0.4],
    lantern: [0.4, 0.6, 0.1, 0.4, "grit", 2.0, 0.35], stone_pillar: [0.55, 0.5, 0.15, 0.55, "grit", 1.6, 0.55], fence_lux: [0.6, 0.55, 0.3, 0.5, "grain", 1.6, 0.45],
    ph_streetlamp_1: [0.4, 0.6, 0.1, 0.4, "grit", 2.2, 0.3], ph_streetlamp_2: [0.4, 0.6, 0.1, 0.4, "grit", 2.2, 0.3], ph_planter_1: [0.55, 0.3, 0.2, 0.5, "grit", 2.5, 0.5],
    ph_planter_2: [0.55, 0.3, 0.2, 0.5, "grit", 2.5, 0.5], ph_planter_3: [0.55, 0.3, 0.2, 0.5, "grit", 2.5, 0.5], ph_picnic: [0.6, 0.4, 0.35, 0.6, "grain", 2.0, 0.5],
    ph_patioset: [0.45, 0.45, 0.25, 0.45, "grit", 2.5, 0.35], term_planter: [0.5, 0.3, 0.2, 0.45, "grit", 2.0, 0.5], frontier_well: [0.7, 0.7, 0.25, 0.5, "grain", 1.4, 0.5],
    corten: [0.4, 0.2, 0.0, 0.4, "grit", 1.4, 0.5], rover: [0.5, 0.0, 0.0, 0.0, "grit", 2.0, 0.3], jetlamp: [0.0, 0.0, 0.0, 0.0, "grit", 2.0, 0.0],
    // the module-built kinds (plan_enrich, plan_land, plan_fill_a): their shared materials are cloned per kind
    e1_bench: [0.55, 0.5, 0.35, 0.6, "grain", 2.6, 0.45], e1_ptable: [0.5, 0.45, 0.35, 0.6, "grain", 2.6, 0.45], e1_tpost: [0.65, 0.6, 0.3, 0.6, "grain", 2.0, 0.55],
    e1_lantern: [0.45, 0.55, 0.0, 0.5, "grit", 4.0, 0.38], e1_spost: [0.4, 0.55, 0.0, 0.45, "grit", 3.0, 0.38], e1_pillar: [0.55, 0.5, 0.15, 0.6, "grit", 1.8, 0.6],
    e1_opost: [0.55, 0.3, 0.1, 0.55, "grit", 2.5, 0.55], e1_planter: [0.55, 0.3, 0.15, 0.55, "grit", 2.0, 0.6],
    // the Frontier Ranch's parked stagecoach (one instance) shares the furniture program; the Main Street coach (plan_rides) has its own
    stagecoach: [0.85, 0.75, 0.25, 0.55, "grain", 2.2, 0.42]
  };
  delete PROPK.jetlamp; delete PROPK.rover;
  function detTex(kind) { return kind === "grain" ? uni().tVpGrain.value : (typeof TEX !== "undefined" && TEX.detailN) || uni().tVpGrain.value; }
  // the emissive map of a prop is the albedo at intensity 0 (only buildings glow): dropped; a metalness map that is the roughness
  // map's own texture (glTF ORM) is dropped and read through the roughness sampler (VP_ORM); returns whether it did that
  function trimMaps(m) { if (m.emissiveMap && m.emissiveMap === m.map && !(m.emissiveIntensity > 0)) m.emissiveMap = null; var orm = false;
    if (m.metalnessMap && m.roughnessMap && (m.metalnessMap === m.roughnessMap || (m.metalnessMap.source && m.metalnessMap.source === m.roughnessMap.source))) { m.metalnessMap = null; orm = true; } return orm; }
  function userObc(src) { return src._userObc !== undefined ? src._userObc : (src.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ? src.onBeforeCompile : null); }
  function makePropMat(src, k, h) {
    var c = PROPK[k]; var prev = userObc(src); var m = src.clone(); var orm = trimMaps(m);
    var M = { orm: orm, u: { uVpA: { value: new THREE.Vector4(c[0], c[1], c[2], VP.sw.det ? c[3] : 0) }, uVpB: { value: new THREE.Vector4(h || 1, c[5], c[6], 0) }, tVpDet: { value: detTex(c[4]) } }, prev: prev };
    m.userData.vpU = M.u; m.userData.vp = "prop"; Object.defineProperty(m.userData, "vpM", { value: M, enumerable: false }); m.onBeforeCompile = obcProp(M); m.name = (src.name || k) + "+vp";
    var key = "vpprop1|" + (prev ? prev.toString() : "-") + (m.defines && m.defines.USE_CSM ? "|csm" : "") + (orm ? "|orm" : ""); m.customProgramCacheKey = function () { return key; };
    m._vpOk = true; return m;
  }
  var MODK = /^(e1_|land_|fa_)/;   // module-built kinds: their materials are shared with the module's other meshes
  var GLOW = function (src) { try { if (typeof M !== "undefined" && src === M.lampGlow) return true; } catch (e) {} return !src.map && src.emissive && (src.emissive.r + src.emissive.g + src.emissive.b) > 0.05; };
  function upPorches() {
    if (!VP.sw.prop || !VP.sw.porch) return; var PP = window.PLAN_PORCHES; var A = PP && PP.mat && PP.mat.atlas; if (!A || A._vpOk || !A.isMeshStandardMaterial) return;
    PROPK.rp_atlas = PROPK.rp_atlas || [0.55, 0.6, 0.35, 0.55, "grain", 2.2, 0.5];
    var nm = makePropMat(A, "rp_atlas", 1.2); nm.userData.vpKind = "rp_atlas"; var MM = nm.userData.vpM; if (MM) MM.atlas = true;
    var key = nm.customProgramCacheKey() + "|atlas4"; nm.customProgramCacheKey = function () { return key; };
    OLD2NEW.set(A, nm); rec(nm, A); PP.mat.atlas = nm; cnt("porchAtlas");
    // plan_porches builds its batches over many frames from its defer: batches made before this point take the upgrade too
    try { var G = scene.getObjectByName("rp_porches"); if (G) G.traverse(function (o) { if (o.material === A) { o.material = nm; cnt("porchFixed"); } }); } catch (e) { note("porches", e); }
  }
  function upPropModel(k, m, coach) {
    if ((coach ? !VP.sw.coach : !VP.sw.prop) || !PROPK[k] || !m || m.proxy || !m.parts) return false; var did = 0, shared = MODK.test(k); if (shared && !VP.sw.e1) return false;
    m.parts.forEach(function (p, i) { var src = p.material; if (!src || !src.isMeshStandardMaterial || src._vpOk || src.transparent || GLOW(src)) return;
      var nm = rec(makePropMat(src, k, m.height), src); nm.userData.vpKind = k; if (!shared) OLD2NEW.set(src, nm);
      if (shared) { (INST[k] || []).forEach(function (im) { if (im.material === src) im.material = nm; }); try { INSTSET.forEach(function (S) { if (S.kind !== k) return; [S.insts, S.far, S.far2].forEach(function (L) { (L || []).forEach(function (im) { if (im.material === src) im.material = nm; }); }); }); } catch (e) {} }
      p.material = nm; did++; });
    if (did) cnt("prop:" + k); return did > 0;
  }

  // ───────────────────────── when to apply ─────────────────────────
  function streamPrep(k, fn) { var PS = window.PLAN_STREAM; if (!PS) return; PS.prep = PS.prep || {}; var prev = PS.prep[k]; PS.prep[k] = function (full) { if (prev) { try { prev(full); } catch (e) { note("prep prev " + k, e); } } try { fn(full); } catch (e) { note("prep " + k, e); } }; }
  function upAll() {
    if (typeof MODELS === "undefined") return; if (typeof ASSET !== "undefined" && ASSET.tier === "m") { VP.on = false; return; }
    try { uni(); } catch (e) { note("textures", e); }   // start the downloads now (they apply when in, see LOADK)
    try { upCart(); } catch (e) { note("cart", e); }
    if (VP.sw.coach) { var cm = MODELS.stagecoach; if (cm && !cm.proxy) { try { upPropModel("stagecoach", cm, true); } catch (e) { note("coach", e); } } else if (!COACH.prep) { COACH.prep = true; streamPrep("stagecoach", function (full) { upPropModel("stagecoach", full, true); }); } }
    if (VP.sw.prop) for (var k in PROPK) { if (k === "rover" || k === "stagecoach") continue; var m = MODELS[k]; if (!m) continue; if (m.proxy) { if (!PROPK[k].prep) { PROPK[k].prep = true; (function (kk) { streamPrep(kk, function (full) { upPropModel(kk, full); }); })(k); } continue; } try { upPropModel(k, m); } catch (e) { note("prop " + k, e); } }
  }
  // every mesh in the scene that still holds a replaced material gets its upgrade (models built before the terrain phase, the
  // instanced sets, their far LODs); the client's cart colours and the parked shuttles and loop carts
  function fixScene() {
    var n = 0; scene.traverse(function (o) { if (!o.isMesh || !o.material || Array.isArray(o.material)) return; var nm = OLD2NEW.get(o.material); if (nm) { o.material = nm; n++; } }); cnt("fixed", n);
    if (CART.base && typeof TEXVAR !== "undefined") { var tv = new Map(); TEXVAR.forEach(function (v, k) { var mm = /^cart:(\d+):mat$/.exec(k); if (mm && v && v.isMaterial) tv.set(v, +mm[1]); });
      if (tv.size) scene.traverse(function (o) { if (o.isMesh && tv.has(o.material)) { var cm = cartColorMat(tv.get(o.material)); if (cm) { o.material = cm; cnt("fixedColor"); } } }); }
  }
  // the carts that move (the site shuttles, the loop carts) keep their lamps on at night
  function litCarts() {
    if (!CART.base || !CART.lamps) return; var roots = [];
    try { (SITES.carts || []).forEach(function (c) { if (c && c.g) roots.push(c.g); }); } catch (e) {}
    try { NPC.forEach(function (q) { if (q && q.kind === "loop" && q.g) roots.push(q.g); }); } catch (e) {}
    roots.forEach(function (g) { g.traverse(function (o) { if (o.isMesh && o.material === CART.base) { o.material = CART.lamps; cnt("litCarts"); } }); });
  }
  function overrideCartColors() {
    if (!CART.base || typeof cartMaterial !== "function" || cartMaterial.vp) return; var orig = cartMaterial;
    var w = function (ci) { if (!VP.on || !CART.base) return orig(ci); return cartColorMat(ci) || orig(ci); }; w.vp = true; w.orig = orig; cartMaterial = w; cnt("cartMaterialWrapped");
  }
  // the Solar Cart Park's batched carts and parked cars (plan_solarpark.js): their materials become physical with the clear coat
  function upSolar() {
    var SP = window.PLAN_SOLAR; if (!SP || SP.off) return; var MATS = null;
    try { var g = SP.groups && SP.groups.carts; if (g && VP.sw.cart && CART.src && !SP.vpCarts) { SP.vpCarts = true; var old = null; g.traverse(function (o) { if (o.isBatchedMesh && o.material && !o.material._vpOk) old = o.material; });
        if (old) { var m = makeCartMat(CART.src, CART.green || new THREE.Color(0x1f7a35).convertSRGBToLinear(), FIN_STOCK, 0, 0.4, { roofH: true }); m.map = old.map; m.normalMap = old.normalMap; if (old.normalScale) m.normalScale.copy(old.normalScale); m.name = "vp_sp_cart"; rec(m, old); g.traverse(function (o) { if (o.isBatchedMesh && o.material === old) o.material = m; }); cnt("solarCarts"); } } } catch (e) { note("solar carts", e); }
    try { var gc = SP.groups && SP.groups.cars; if (gc && VP.sw.car && !SP.vpCars) { SP.vpCars = true; var oc = null; gc.traverse(function (o) { if (o.isBatchedMesh && o.material && !o.material._vpOk) oc = o.material; }); if (oc) { var mc = makeCarMat(oc); rec(mc, oc); gc.traverse(function (o) { if (o.isBatchedMesh && o.material === oc) o.material = mc; }); cnt("solarCars"); } } } catch (e) { note("solar cars", e); }
  }
  // parked cars: the paint (bright unsaturated texels, recoloured per car) under a clear coat with flake; dark glass with a sharp
  // reflection; rubber; a little dust low down
  var CAR_F = [
    "{ vec3 tc = diffuseColor.rgb; vec3 s = sqrt(max(tc, vec3(0.0))); float lum = dot(s, vec3(0.299, 0.587, 0.114)); float sat = max(s.r, max(s.g, s.b)) - min(s.r, min(s.g, s.b));",
    "  float paint = smoothstep(0.24, 0.42, lum) * (1.0 - smoothstep(0.07, 0.16, sat));",
    "  vec3 cc0 = vec3(1.0);",
    "#if defined( USE_COLOR )",
    "  cc0 = vColor.rgb;",
    "#endif",
    "  vec3 alb = mix(tc, cc0 * (0.25 + lum * 0.95), paint);",
    "  float glass = (1.0 - paint) * (1.0 - smoothstep(0.12, 0.3, lum)) * step(0.55, vVpO.y) * smoothstep(0.0, 0.05, s.b - s.r + 0.02);",
    "  float rub = (1.0 - paint) * (1.0 - glass) * (1.0 - smoothstep(0.05, 0.14, lum)) * (1.0 - step(0.75, vVpO.y));",
    "  vec3 gw = vpTriW(normalize(vVpON)); vpGr = vpTri(tVpGrime, vVpO * 1.3, gw); float low = 1.0 - smoothstep(0.05, 0.6, vVpO.y);",
    "  vpDust = 0.6 * clamp(low * (0.3 + 0.8 * vpGr.r) + rub * 0.3, 0.0, 1.0);",
    "  alb = mix(alb, vec3(0.012, 0.014, 0.018), glass); alb = mix(alb, uVpDustC * (0.85 + 0.3 * vpGr.g), vpDust * 0.7);",
    "  vpR = mix(mix(mix(0.5, 0.32, paint), 0.04, glass), 0.85, rub); vpR = mix(vpR, 0.92, vpDust); vpM = mix(mix(0.0, 0.45, paint), 0.0, glass) * (1.0 - vpDust); vpCC = (paint + glass) * (1.0 - vpDust * 0.9); vpP = paint;",
    "  diffuseColor.rgb = mix(tc, alb, uVpK); vpCC *= uVpK; }"].join("\n");
  function carPatch(sh) {
    patchCommon(sh, []); var f = sh.fragmentShader; f = rep(f, "#include <common>", "uniform sampler2D tVpFlake; float vpDust = 0.0, vpCC = 0.0, vpR = 0.5, vpM = 0.0, vpP = 0.0; vec4 vpGr = vec4(0.5);");
    f = f.replace("#include <color_fragment>", CAR_F); f = rep(f, "#include <metalnessmap_fragment>", "roughnessFactor = mix(roughnessFactor, vpR, uVpK); metalnessFactor = mix(metalnessFactor, vpM, uVpK);");
    f = rep(f, "#include <normal_fragment_maps>", "{ vec3 fa = abs(normalize(vVpON)); vec2 fuv = fa.x > fa.y && fa.x > fa.z ? vVpO.zy : fa.y > fa.z ? vVpO.xz : vVpO.xy; vec3 fl = texture2D(tVpFlake, fuv * 22.0).xyz * 2.0 - 1.0; vec3 T, B; vpFrame(nonPerturbedNormal, T, B); normal = normalize(mix(normal, normalize(nonPerturbedNormal + (T * fl.x + B * fl.y) * 0.18), vpP * uVpK)); }");
    f = rep(f, "#include <lights_physical_fragment>", "#ifdef USE_CLEARCOAT\n material.clearcoat = clamp(vpCC, 0.0, 1.0); material.clearcoatRoughness = min(0.0525 + geometryRoughness, 1.0);\n#endif");
    sh.fragmentShader = f;
  }
  VP.patch.car = carPatch;
  function makeCarMat(src) { var m = toPhysical(src); m._vpOk = true; m.clearcoat = 1; m.clearcoatRoughness = 0.04; m.roughness = 1; m.metalness = 1; m.envMapIntensity = 1.0; m.userData.vp = "car"; m.onBeforeCompile = function (sh) { VP.patch.car(sh); }; m.customProgramCacheKey = function () { return "vp_car_v1"; }; m.name = "vp_sp_car"; return m; }
  // the stagecoach of plan_rides.js: its deform clones get the coach patch after their own (wheels), keyed apart
  // the rides' vehicles (plan_rides.js): their deform clones were made at the world build, when the stagecoach and the rover were
  // still stream proxies, so they kept the proxy's low resolution texture after the full model swapped in (the texel audit's magnified
  // Main Street stagecoach). Once the full model is in: the full material (the coach upgraded) with their wheel deform chained first.
  var ridePend = [];
  function upRides() {
    var PR = window.PLAN_RIDES; if (!PR || !PR.lines) return;
    PR.lines.forEach(function (L) { var kind = L.id === "coach" ? "stagecoach" : L.id === "rover" ? "rover" : null; if (!kind || !L.veh) return; if (kind === "stagecoach" ? !VP.sw.coach : !VP.sw.prop) return;
      var mm = MODELS[kind]; if (!mm || mm.proxy || !mm.parts || !mm.parts.length) return;
      L.veh.forEach(function (V) { (V.meshes || []).forEach(function (me, i) { var m = me.material; if (!m || m._vpOk || !m.isMeshStandardMaterial || me.userData.vpPend) return;
        var part = mm.parts[i] || mm.parts[0], full = part.material, base = NEW2OLD.get(full) || full; if (!base || !base.isMeshStandardMaterial) return;
        if (kind !== "stagecoach") {   // the rover: the full model's textures into its own material, slot for slot (same program, nothing to compile)
          var sw2 = 0; ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"].forEach(function (k) { if (m[k] && base[k] && m[k] !== base[k] && m[k].colorSpace === base[k].colorSpace) { m[k] = base[k]; sw2++; } });
          m._vpOk = true; if (sw2) cnt("ride:rover"); return; }
        var nm = makeCoachMat(base, mm.height); if (!nm) return;
        var theirs = userObc(m), mine = kind === "stagecoach" ? userObc(nm) : null;
        nm.onBeforeCompile = function (sh, r) { if (theirs) theirs(sh, r); if (mine) mine(sh, r); }; var ck0 = m.customProgramCacheKey ? m.customProgramCacheKey() : "rides"; var ck = mine ? ck0 + "|vp1" + (nm.userData.vpM && nm.userData.vpM.orm ? "|orm" : "") : ck0; nm.customProgramCacheKey = function () { return ck; };
        nm._vpOk = true; rec(nm, m); if (!VP.ready) me.material = nm; else { me.userData.vpPend = true; ridePend.push([me, nm]); } cnt("ride:" + kind); }); }); });
    // in play: the new program compiles in the idle warm-up first, the vehicles take it a few seconds later
    if (ridePend.length && !ridePend.t) { ridePend.t = 1; warm(ridePend.map(function (q) { return q[1]; }), "rides", false); setTimeout(function () { ridePend.forEach(function (q) { q[0].material = q[1]; delete q[0].userData.vpPend; }); ridePend.length = 0; ridePend.t = 0; }, 4000); }
  }
  // the body shop: a look material made before the base was swapped (none in a normal boot) is left as it was
  function bsCheck() { try { var BS = window.PLAN_BODYSHOP; if (!BS || !BS.geo || !BS.geo.cart || !CART.base) return; if (BS.geo.cart.base !== CART.base && BS.geo.cart.base && BS.geo.cart.base.userData.vp !== "cart") { BS.geo.cart.base = CART.base; cnt("bsBase"); } } catch (e) { note("bs", e); } }

  // TAA (plan_post.js): the vehicles that move are registered as movers (the top-level ones are tracked anyway; this makes it explicit
  // and covers a rider's cart inside its avatar): the shuttles, the loop carts, the shared carts, the plan_rides coaches and rovers,
  // and every avatar on a cart
  function movers() {
    var PPm = window.PLAN_POST; if (!PPm || typeof PPm.mover !== "function") return; var n = 0, add = function (o) { if (o && o.isObject3D && o.parent) { PPm.mover(o); n++; } };
    try { (SITES.carts || []).forEach(function (c) { add(c && c.g); }); } catch (e) {}
    try { NPC.forEach(function (q) { if (q && q.kind === "loop") add(q.g); }); } catch (e) {}
    try { if (typeof VEH !== "undefined") for (var id in VEH) { var v = VEH[id]; if (v && v.g) add(v.g); } } catch (e) {}
    try { var PR = window.PLAN_RIDES; if (PR && PR.lines) PR.lines.forEach(function (L) { (L.veh || []).forEach(function (V) { add(V && V.g); }); }); } catch (e) {}
    try { if (typeof player !== "undefined" && player && player.userData && player.userData.cartG && player.userData.cartG.visible) add(player); if (typeof avatars !== "undefined") avatars.forEach(function (a) { if (a && a.g && a.g.userData && a.g.userData.cartG && a.g.userData.cartG.visible) add(a.g); }); } catch (e) {}
    VP.n.movers = n;
  }
  var H = window.PLAN_HOOKS;
  H.terrain.push({ name: "propsTerrain", fn: function () { if (!VP.on) return; var t0 = performance.now(); upAll(); VP.n.msTerrain = Math.round(performance.now() - t0); } });
  H.defer.push({ name: "propsDefer", fn: function () { if (!VP.on) return; var t0 = performance.now(); try { upAll(); upPorches(); overrideCartColors(); fixScene(); litCarts(); upSolar(); upRides(); bsCheck(); } catch (e) { note("defer", e); } VP.n.msDefer = Math.round(performance.now() - t0); VP.ready = true; } });
  // late: the solar park builds its carts and cars in its own defer and the rides their vehicles; a few frames later check once more,
  // then every 2 s for body shop bases and stream-swapped kinds (cheap: a few object reads)
  var FR = 0;
  H.frame.push({ name: "propsFrame", fn: function () { if (!VP.on || !VP.ready) return; FR++; if (FR === 30 || FR === 240) { try { upRides(); litCarts(); } catch (e) { note("late", e); } } if (FR % 30 === 0 && !VP.n.porchAtlas && FR < 30000) { try { upPorches(); } catch (e) { note("porches", e); } } if (FR % 120 === 0) { bsCheck(); try { upSolar(); upRides(); } catch (e) { note("late", e); } } if (FR % 120 === 60) movers(); } });
  VP.api = { cartColorMat: cartColorMat, paintFor: paintFor, upAll: upAll, fixScene: fixScene, setK: function (k) { uni().uVpK.value = k; },
    live: function () { upAll(); upPorches(); overrideCartColors(); fixScene(); litCarts(); upSolar(); upRides(); bsCheck(); VP.ready = true; return VP.n; },
    // in-session A/B: every mesh holding an upgrade gets the material it replaced (false) and back (true); the body shop's looks keep theirs
    ab: function (on) { var n = 0; scene.traverse(function (o) { if (!(o.isMesh || o.isBatchedMesh)) return; var m = o.material; if (!m || Array.isArray(m)) return;
        if (!on) { var old = NEW2OLD.get(m) || (m.userData.vpCi !== undefined && cartMaterial.orig ? cartMaterial.orig(m.userData.vpCi) : null); if (old && m._vpOk) { o.userData.vpNew = m; o.material = old; n++; } }
        else if (o.userData.vpNew) { o.material = o.userData.vpNew; delete o.userData.vpNew; n++; } }); VP.abOn = !!on; return n; },
    test: { makeCartMat: makeCartMat, makeCoachMat: makeCoachMat, makePropMat: makePropMat, makeCarMat: makeCarMat, bsWrap: bsWrap, cart: CART } };
})();
