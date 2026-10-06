// R16 Agent F, foliage: every tree, shrub, cactus, grass and ground-cover material of every module, patched at runtime.
// Classic script loaded before client.js; reaches client globals (MODELS, MODEL_SPECS, INSTSET, QUAL, camera, renderer, DETAILS,
// COVER, NEAR, updateCulling, FRAME_N, dayT) by bare name at call time. Nothing here edits another file. HANDOFF_R16_FOLIAGE.md.
//
// What it does (one shader program per base material config, so nothing splits; per-kind behaviour lives in uniforms):
//   wind     three levels in the vertex shader: trunk bend along a world wind with travelling gusts, branch bob that grows away
//            from the trunk, leaf flutter on the cards; phase from the instance position, frequency from the plant's height
//   light    leaf and grass translucency inside RE_Direct (the shadowed sun, part of the open sun scattering through the
//            canopy, and the night lamps), canopy (bent) normals turned to the viewer, canopy AO and specular occlusion, a
//            canopy-bounce tint on the sky light, a backlit spine halo on cacti, a waxy bloom on agave, a dusty sheen on mesquite
//   alpha    cutout alpha test on the GLB leaf cards (their clear texels hold light colour); coverage kept down the mips on
//            the colour-bled grass atlas; hashed alpha only with ?folhash=1 (Agent P: cutouts are cleaner under its TAA)
//   distance LOD cross-fade (band instances drawn in both tiers, complementary dither), dissolve before the range cull
//   ground   bunchgrass clumps round the camera on open desert (high 26 m, ultra 34 m) that grow in; the client's tufts get
//            the same atlas and grow in by distance instead of drawing to the horizon
//   material metalness 0 and no dead texture fetches on plants (the night-glow emissive map, the metalness map), roughness to
//            the R16 standard per species, per-plant colour variation, a world-space bark detail layer within 11 m
// Switches: ?fol=0 off; ?folwind=0 ?foltr=0 ?folbent=0 ?folalpha=0 ?follod=0 ?folmat=0 ?folgc=0 ?foltex=0 single parts;
// ?folhash=1 hashed alpha; ?folab=1 keeps pristine copies so PLAN_FOLIAGE.ab(false/true) switches the module live (same-session A/B).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_FOLIAGE = window.PLAN_FOLIAGE || { v: "r16-0", errs: [], n: {} };
(function () {
  "use strict";
  var FO = window.PLAN_FOLIAGE; FO.v = "r16-1"; FO.errs = FO.errs || []; FO.n = FO.n || {};
  var Q = location.search || "";
  var sw = function (k) { return !new RegExp("[?&]" + k + "=0\\b").test(Q); };
  if (!sw("fol")) { FO.off = true; return; }
  var K = FO.K = {
    wind: sw("folwind"), tr: sw("foltr"), bent: sw("folbent"), alpha: sw("folalpha"), lod: sw("follod"), mat: sw("folmat"), gc: sw("folgc"), tex: sw("foltex"),
    hash: /[?&]folhash=1\b/.test(Q) ? 1 : 0, ab: /[?&]folab=1\b/.test(Q),
    // the wind: from the south-west toward the north-east (Douglas, October afternoons), x east, z south
    windDir: [0.74, 0, -0.67], gust: 0.8, mipScale: 0.22,
  };
  function err(where, e) { var s = where + ": " + ((e && e.message) || e); if (FO.errs.length < 40) FO.errs.push(s); try { console.warn("PLAN_FOLIAGE " + s); } catch (x) {} }
  function cnt(k, v) { FO.n[k] = (FO.n[k] || 0) + (v === undefined ? 1 : v); }

  // ───────────────────────── shared uniforms (O(1) per frame) ─────────────────────────
  var U = FO.U = {
    uFolT: { value: 0 },
    uFolWind: { value: null },   // THREE.Vector4: xyz world wind direction, w gust strength
    uFolA: { value: null },      // x mip coverage scale, y hashed alpha (0/1), zw per-frame noise offset
    tFolBark: { value: null },   // tex/fo_bark_n.png (high, ultra): RGB normal, A height
  };
  function initShared() { if (U.uFolWind.value) return; U.uFolWind.value = new THREE.Vector4(K.windDir[0], 0, K.windDir[2], K.wind ? K.gust : 0); U.uFolA.value = new THREE.Vector4(K.alpha ? K.mipScale : 0, 0, 0, 0); }

  // ───────────────────────── GLSL ─────────────────────────
  var VP = [
    "uniform float uFolT; uniform vec4 uFolWind; uniform vec4 uFolK; uniform vec4 uFolC; uniform vec4 uFolE; uniform vec4 uFolF; uniform vec4 uFolG; uniform float uFolTier;",
    "varying float vFolAO; varying float vFolX; varying float vFolR; varying vec3 vFolW; varying vec3 vFolN; varying float vFolV;",
  ].join("\n");
  // after beginnormal_vertex: canopy (bent) normals for card foliage (uFolC.w = how far the card normal turns to the canopy)
  var VN = [
    "if ( uFolC.w > 0.0 ) { vec3 folQ = ( position - uFolC.xyz ) / max( uFolE.xyz * uFolE.xyz, vec3( 0.0025 ) ); objectNormal = normalize( mix( objectNormal, normalize( folQ + vec3( 0.0, 1e-4, 0.0 ) ), uFolC.w ) ); }",
  ].join("\n");
  // after begin_vertex: wind, distance fades, canopy AO
  var VB = [
    "{",
    "  mat3 folR = mat3( modelMatrix ); vec3 folIP = modelMatrix[ 3 ].xyz;",
    "  #ifdef USE_INSTANCING",
    "  folR = folR * mat3( instanceMatrix ); folIP = ( modelMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 ) ).xyz;",
    "  #endif",
    "  float folS = max( length( folR[ 0 ] ), 1e-4 );",
    "  { vec4 folWp = vec4( position, 1.0 );",
    "  #ifdef USE_INSTANCING",
    "    folWp = instanceMatrix * folWp;",
    "  #endif",
    "    vFolW = ( modelMatrix * folWp ).xyz; vFolN = normalize( folR * objectNormal ); }",
    "  float folH = max( uFolK.y, 0.25 ); vec3 folP = transformed; float folh = clamp( folP.y / folH, 0.0, 1.6 );",
    "  float folRnd = fract( sin( dot( folIP.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); vFolV = folRnd;",
    "  float folD = distance( cameraPosition.xz, folIP.xz );",
    // LOD cross-fade value (same for both tiers at the same distance) and the dissolve before the range cull
    "  vFolX = 1.0 - smoothstep( uFolF.x, uFolF.y, folD );",
    "  float folRc = uFolF.w; if ( uFolF.z > 0.0 ) folRc = min( folRc, uFolF.z * folS );",
    "  vFolR = 1.0 - smoothstep( folRc * 0.86, folRc, folD );",
    // canopy AO: inside and under the canopy darker (indirect light only)
    "  float folQn = length( ( position - uFolC.xyz ) / max( uFolE.xyz, vec3( 0.05 ) ) );",
    "  vFolAO = mix( 1.0, mix( 0.42, 1.0, smoothstep( 0.2, 1.05, folQn ) ) * mix( 0.72, 1.0, clamp( folh * 1.4, 0.0, 1.0 ) ), uFolE.w );",
    "  if ( uFolK.x > 0.0 && uFolWind.w > 0.0 ) {",
    "    vec3 folW = normalize( transpose( folR ) * vec3( uFolWind.x, 0.0, uFolWind.z ) + vec3( 1e-5 ) ); folW.y = 0.0; folW = normalize( folW + vec3( 1e-5, 0.0, 0.0 ) );",
    "    vec3 folSide = vec3( -folW.z, 0.0, folW.x );",
    "    float folAl = dot( folIP.xz, uFolWind.xz ); float folT = uFolT;",
    "    float folG = uFolWind.w * ( 0.58 + 0.42 * sin( folAl * 0.043 - folT * 1.21 + 2.0 * sin( folAl * 0.0093 + folT * 0.173 ) ) );",
    "    float folTy = uFolK.w; float folTk = folTy < 0.5 ? 1.0 : folTy < 1.5 ? 2.0 : folTy < 2.5 ? 3.0 : 0.0;",
    "    float folWt = 6.9 / sqrt( folH * folS + 0.6 );",
    "    float folAmp = uFolK.x * folTk * 0.022 * folH;",
    "    float folOsc = 0.62 + 0.38 * sin( folT * folWt + folRnd * 6.2832 );",
    "    vec3 folDsp = ( folW * ( folG * folAmp * folOsc ) + folSide * ( folG * folAmp * 0.22 * sin( folT * folWt * 1.43 + folRnd * 4.0 ) ) ) * folh * folh;",
    "    float folRr = clamp( length( folP.xz - uFolC.xz ) / max( max( uFolE.x, uFolE.z ), 0.25 ), 0.0, 1.4 );",
    "    float folPhB = folRnd * 6.2832 + dot( folP, vec3( 0.71, 0.53, 0.67 ) ) * 1.7;",
    "    float folBa = uFolK.x * folTk * 0.011 * folH * folRr * folh * ( 0.35 + 0.65 * folG );",
    "    folDsp += vec3( 0.0, folBa * sin( folT * folWt * 2.6 + folPhB ), 0.0 ) + folW * ( folBa * 0.6 * sin( folT * folWt * 2.1 + folPhB * 1.3 ) );",
    "    if ( uFolK.z > 0.0 ) { float folPhL = dot( folP, vec3( 4.3, 3.1, 5.7 ) ) + folRnd * 17.0; folDsp += objectNormal * ( uFolK.z * 0.016 / folS * ( 0.3 + 0.7 * folG ) * sin( folT * 15.7 + folPhL ) * ( 0.6 + 0.4 * sin( folT * 4.3 + folPhL * 0.37 ) ) ); }",
    "    transformed += folDsp;",
    "  }",
    // grass: grows in from nothing over its fade band (no pop, nothing drawn past it)
    "  if ( uFolG.y > 0.0 ) { float folGc = 1.0 - smoothstep( uFolG.x, uFolG.y, folD ); transformed *= folGc; }",
    "}",
  ].join("\n");

  var FP = [
    "uniform vec4 uFolTr; uniform vec4 uFolTint; uniform vec4 uFolA; uniform vec4 uFolM; uniform float uFolTier; uniform vec4 uFolBk; uniform sampler2D tFolBark; uniform vec4 uFolG;",
    "varying float vFolAO; varying float vFolX; varying float vFolR; varying vec3 vFolW; varying vec3 vFolN; varying float vFolV;",
    "float folIgn( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }",
  ].join("\n");
  // RE_Direct wrapper: translucency (leaves, grass), the spine halo (cacti), the waxy/dusty sheen; every light (sun, cascades, lamps)
  var FL = [
    "void RE_Direct_Fol( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {",
    "  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );",
    "  if ( uFolTr.x > 0.0 ) {",
    "    vec3 folL = directLight.direction; vec3 folV = geometryViewDir; vec3 folN = geometryNormal; float folVL = saturate( dot( folV, - folL ) );",
    "    if ( uFolTr.w < 1.5 ) {",
    "      float folBk = saturate( dot( - folN, folL ) * 0.65 + 0.35 );",
    "      float folFw = pow( folVL, uFolTr.y );",
    "      vec3 folLc = directLight.color;",
    "      #if NUM_DIR_LIGHTS > 0",
    "      if ( dot( folL, directionalLights[ 0 ].direction ) > 0.9999 ) folLc = mix( directLight.color, directionalLights[ 0 ].color, 0.22 * vFolAO );",
    "      #endif",
    "      vec3 folTc = material.diffuseColor * mix( vec3( 1.0 ), material.diffuseColor * 2.6, 0.6 );",
    "      reflectedLight.directDiffuse += folLc * folTc * uFolTint.rgb * ( ( uFolTr.z + folFw ) * folBk * uFolTr.x );",
    "    } else {",
    "      float folFr = pow( 1.0 - saturate( dot( folN, folV ) ), 3.0 );",
    "      reflectedLight.directDiffuse += directLight.color * uFolTint.rgb * ( folFr * ( 0.12 + 1.6 * folVL * folVL ) * uFolTr.x * saturate( dot( folN, folL ) * 0.5 + 0.6 ) );",
    "    }",
    "  }",
    "  if ( uFolM.x > 0.0 ) {",   // a soft bloom / dust lobe at grazing angles (agave wax, dusty mesquite leaves)
    "    float folNL = saturate( dot( geometryNormal, directLight.direction ) ); float folFr2 = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 2.5 );",
    "    reflectedLight.directDiffuse += directLight.color * vec3( 0.93, 0.95, 1.0 ) * ( folFr2 * folNL * uFolM.x * 0.32 );",
    "  }",
    "}",
    "#undef RE_Direct",
    "#define RE_Direct RE_Direct_Fol",
  ].join("\n");
  // early in main: LOD cross-fade and the range dissolve (before any texture fetch)
  var FD = [
    "{ float folN0 = folIgn( gl_FragCoord.xy + uFolA.zw );",
    "  if ( uFolTier < 0.5 ? ( folN0 >= vFolX ) : ( folN0 < vFolX ) ) discard;",
    "  if ( vFolR < 0.999 && folIgn( gl_FragCoord.yx * 1.37 + uFolA.wz + 3.7 ) >= vFolR ) discard; }",
  ].join("\n");
  // bark detail near the camera: world-space biplanar (trunks are vertical), whiteout blend, cavities darker and rougher
  var FB = [
    "if ( uFolBk.x > 0.0 ) { float folDk = uFolBk.x * ( 1.0 - smoothstep( 3.0, 11.0, length( vViewPosition ) ) );",
    "  if ( folDk > 0.003 ) { vec3 folNw = normalize( vFolN ); vec2 folB = pow( abs( folNw.xz ) + 1e-3, vec2( 3.0 ) ); folB /= max( folB.x + folB.y, 1e-4 );",
    "    vec4 folTx = texture2D( tFolBark, vFolW.zy * uFolBk.y ), folTz = texture2D( tFolBark, vFolW.xy * uFolBk.y );",
    "    vec3 folX = folTx.xyz * 2.0 - 1.0, folZ = folTz.xyz * 2.0 - 1.0; folX = vec3( folX.xy + folNw.zy, folNw.x ); folZ = vec3( folZ.xy + folNw.xy, folNw.z );",
    "    vec3 folNd = normalize( folX.zyx * folB.x + folZ.xyz * folB.y );",
    "    normal = normalize( normal + ( viewMatrix * vec4( folNd - folNw, 0.0 ) ).xyz * ( folDk * uFolBk.z ) );",
    "    float folHt = folTx.a * folB.x + folTz.a * folB.y; diffuseColor.rgb *= mix( 1.0, 0.64 + 0.52 * folHt, folDk * uFolBk.w ); roughnessFactor = min( 1.0, roughnessFactor + ( 1.0 - folHt ) * 0.14 * folDk ); } }",
  ].join("\n");
  // the alpha test: coverage kept down the mip chain, hashed around the threshold while TAA runs
  var FA = [
    "#ifdef USE_ALPHATEST",
    "{ float folAl = diffuseColor.a;",
    "  #ifdef USE_MAP",
    "  if ( uFolG.z > 0.0 ) { vec2 folTs = vec2( textureSize( map, 0 ) ); vec2 folDx = dFdx( vMapUv * folTs ), folDy = dFdy( vMapUv * folTs ); float folMip = max( 0.0, 0.5 * log2( max( dot( folDx, folDx ), dot( folDy, folDy ) ) ) ); folAl *= 1.0 + folMip * uFolG.z; }",
    "  #endif",
    "  float folTh = alphaTest; if ( uFolA.y > 0.5 ) folTh = clamp( alphaTest + ( folIgn( gl_FragCoord.xy * 1.13 + uFolA.zw * 1.71 + 11.0 ) - 0.5 ) * 0.62, 0.04, 0.96 );",
    "  if ( folAl < folTh ) discard; }",
    "#endif",
  ].join("\n");

  // ───────────────────────── per-material state ─────────────────────────
  var ST = FO.ST = new WeakMap();   // material -> { u (uniforms), chain (previous onBeforeCompile kept), key, kind, role }
  var PATCHED = FO.patched = [];
  function userObc(m) { if ("_csmObc" in m || m._userObc !== undefined) return m._userObc || null; var f = m.onBeforeCompile; return f && f !== THREE.Material.prototype.onBeforeCompile ? f : null; }
  function isSwayObc(f) { if (!f) return false; var s = String(f); return s.indexOf("uSway") >= 0 && s.indexOf("SWAY.t") >= 0; }
  function newU() {
    return { uFolK: { value: new THREE.Vector4(0, 4, 0, 3) }, uFolC: { value: new THREE.Vector4(0, 2, 0, 0) }, uFolE: { value: new THREE.Vector4(2, 2, 2, 0) },
      uFolF: { value: new THREE.Vector4(1e7, 2e7, 0, 1e9) }, uFolG: { value: new THREE.Vector4(0, 0, 0, 0) }, uFolTier: { value: 0 },
      uFolTr: { value: new THREE.Vector4(0, 6, 0, 0) }, uFolTint: { value: new THREE.Vector4(1, 1, 1, 0) }, uFolM: { value: new THREE.Vector4(0, 0, 0, 0) }, uFolBk: { value: new THREE.Vector4(0, 1.8, 1, 0.6) } };
  }
  function applyShader(sh, st) {
    var u = st.u; for (var k in u) sh.uniforms[k] = u[k]; sh.uniforms.uFolT = U.uFolT; sh.uniforms.uFolWind = U.uFolWind; sh.uniforms.uFolA = U.uFolA;
    sh.uniforms.tFolBark = U.tFolBark;
    var v = sh.vertexShader, f = sh.fragmentShader;
    if (v.indexOf("#include <begin_vertex>") < 0 || f.indexOf("#include <lights_physical_pars_fragment>") < 0) { st.bad = true; cnt("badShader"); return; }
    v = v.replace("#include <common>", "#include <common>\n" + VP).replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\n" + VN).replace("#include <begin_vertex>", "#include <begin_vertex>\n" + VB);
    f = f.replace("#include <common>", "#include <common>\n" + FP).replace("#include <lights_physical_pars_fragment>", "#include <lights_physical_pars_fragment>\n" + FL)
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n" + FD)
      .replace("#include <color_fragment>", "#include <color_fragment>\nif ( uFolM.y > 0.0 ) { float folVv = vFolV - 0.5; diffuseColor.rgb *= max( vec3( 0.0 ), vec3( 1.0 ) + folVv * uFolM.y * vec3( 0.55, 0.32, -0.6 ) + ( fract( vFolV * 7.31 ) - 0.5 ) * uFolM.y * 0.35 ); }")
      .replace("#include <aomap_fragment>", "#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= vFolAO; reflectedLight.indirectSpecular *= vFolAO * vFolAO;\nif ( uFolM.z > 0.0 ) reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, vec3( dot( reflectedLight.indirectDiffuse, vec3( 0.3, 0.59, 0.11 ) ) ) * vec3( 1.04, 1.06, 0.84 ), uFolM.z );")
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n#if !defined( FLAT_SHADED ) && !defined( USE_NORMALMAP )\nif ( uFolTint.w > 0.5 ) { normal = normalize( vNormal ); vec3 folVd = normalize( vViewPosition ); float folNv = dot( normal, folVd ); if ( folNv < 0.0 ) normal = normalize( normal - 2.0 * folNv * folVd ); nonPerturbedNormal = normal; }\n#endif")
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" + FB);
    if (K.alpha) f = f.replace("#include <alphatest_fragment>", FA);
    sh.vertexShader = v; sh.fragmentShader = f; cnt("compiled");
  }
  var KEYV = "fol1";
  // patch a material in place: our hook replaces the client's old sway hook (same job, done better), any other hook is kept and runs first
  function patch(m, kind, role) {
    if (!m || !m.isMeshStandardMaterial) return null; var st = ST.get(m); if (st) { if (kind && !st.kind) { st.kind = kind; st.role = role; } return st; }
    var prev = userObc(m), chain = isSwayObc(prev) ? null : prev; st = { u: newU(), chain: chain, kind: kind || "", role: role || "", sway: 0 };
    st.key = KEYV + (K.alpha ? "a" : "") + (chain ? "|" + String(chain) : ""); ST.set(m, st);
    if (K.ab) { try { var pc = m.clone(); pc.defines = Object.assign({}, m.defines || {}); if (prev) pc.onBeforeCompile = prev; st.pristine = pc; } catch (e) { err("pristine", e); } }
    m.onBeforeCompile = function folObc(sh, r) { if (st.chain) st.chain(sh, r); applyShader(sh, st); };
    m.customProgramCacheKey = function () { return st.key; };
    m.needsUpdate = true; PATCHED.push(m); cnt("patched"); return st;
  }
  // a clone for one instancing set and tier: the same program (same key and code), its own uniforms
  function cloneFor(m, tier) {
    var st = ST.get(m); if (!st) return m; var c = m.clone(); c.defines = Object.assign({}, m.defines || {}); c.name = m.name;
    var u2 = Object.assign({}, st.u, { uFolF: { value: st.u.uFolF.value.clone() }, uFolTier: { value: tier } });
    var s2 = { u: u2, chain: st.chain, kind: st.kind, role: st.role, key: st.key, src: m, tier: tier, pristine: st.pristine };
    ST.set(c, s2); c.onBeforeCompile = function folObc(sh, r) { if (s2.chain) s2.chain(sh, r); applyShader(sh, s2); }; c.customProgramCacheKey = function () { return s2.key; };
    cnt("clones"); return c;
  }
  FO.patch = patch;

  // ───────────────────────── what a plant is ─────────────────────────
  // type: 0 tree, 1 shrub, 2 grass, 3 rigid (cacti, succulents: no wind)
  var SPEC = {
    paloverde:    { t: 0, leafR: 0.62, barkR: 0.86, tr: 0.36, tint: [1.08, 1.2, 0.52], bk: 0.3 },
    mesquite:     { t: 0, leafR: 0.72, barkR: 0.92, tr: 0.30, tint: [1.05, 1.12, 0.6], dust: 0.35, bk: 1 },
    ironwood:     { t: 0, leafR: 0.70, barkR: 0.92, tr: 0.26, tint: [1.0, 1.08, 0.66], dust: 0.45, bk: 0.9 },
    desertwillow: { t: 0, leafR: 0.58, barkR: 0.9, tr: 0.36, tint: [1.08, 1.22, 0.5], bk: 0.85 },
    cottonwood:   { t: 0, leafR: 0.55, barkR: 0.9, tr: 0.4, tint: [1.1, 1.22, 0.45], bk: 1 },
    ash:          { t: 0, leafR: 0.6, barkR: 0.9, tr: 0.36 }, orchard: { t: 0, leafR: 0.6, barkR: 0.9, tr: 0.34 }, sycamore: { t: 0, leafR: 0.6, barkR: 0.85, tr: 0.38 }, willow: { t: 0, leafR: 0.58, barkR: 0.9, tr: 0.38 },
    fanpalm:      { t: 0, leafR: 0.5, barkR: 0.88, tr: 0.3, bend: 0.35, tint: [1.08, 1.12, 0.6] }, fanpalm2: { t: 0, leafR: 0.5, barkR: 0.88, tr: 0.3, bend: 0.35 },
    datepalm:     { t: 0, leafR: 0.5, barkR: 0.88, tr: 0.3, bend: 0.35 }, canarypalm: { t: 0, leafR: 0.5, barkR: 0.88, tr: 0.3, bend: 0.35 },
    bush1:        { t: 1, leafR: 0.7, barkR: 0.9, tr: 0.34, tint: [1.06, 1.14, 0.58] }, bush2: { t: 1, leafR: 0.72, barkR: 0.9, tr: 0.34, tint: [1.08, 1.12, 0.55] },
    ocotillo:     { t: 1, bodyR: 0.82, tr: 0.18, flutter: 0 }, yucca_cluster: { t: 1, bodyR: 0.62, tr: 0.22, stiff: 0.5, wax: 0.25 },
    agave_cluster:{ t: 3, bodyR: 0.48, tr: 0.16, wax: 0.7, tint: [0.9, 1.0, 0.85] },
    fa_agave0:    { t: 3, bodyR: 0.48, tr: 0.16, wax: 0.7 }, fa_agave1: { t: 3, bodyR: 0.48, tr: 0.16, wax: 0.7 },
    saguaro:      { t: 3, bodyR: 0.6, spine: 0.55 }, saguaro_young: { t: 3, bodyR: 0.6, spine: 0.6 }, saguaro_mid: { t: 3, bodyR: 0.6, spine: 0.55 }, saguaro_giant: { t: 3, bodyR: 0.6, spine: 0.5 },
    organ_pipe:   { t: 3, bodyR: 0.62, spine: 0.55 }, barrel_cactus: { t: 3, bodyR: 0.62, spine: 0.75 }, cholla: { t: 3, bodyR: 0.66, spine: 1.0 }, prickly_pear: { t: 3, bodyR: 0.58, spine: 0.45, wax: 0.2 },
    ph_quiver_1:  { t: 3, bodyR: 0.62, wax: 0.3 }, ph_quiver_2: { t: 3, bodyR: 0.62, wax: 0.3 },
    ph_succulent_1: { t: 3, bodyR: 0.55, tr: 0.2 }, ph_succulent_2: { t: 1, bodyR: 0.7, leafR: 0.62, tr: 0.3, stiff: 0.6 }, ph_succulent_3: { t: 3, bodyR: 0.5 },
    land_sagy0: { t: 3, bodyR: 0.6, spine: 0.55 }, land_sagy1: { t: 3, bodyR: 0.6, spine: 0.55 }, land_cholla0: { t: 3, bodyR: 0.66, spine: 1.0 }, land_cholla1: { t: 3, bodyR: 0.66, spine: 1.0 },
    land_barrel: { t: 3, bodyR: 0.62, spine: 0.75 }, land_pear: { t: 3, bodyR: 0.58, spine: 0.45 },
  };
  var SHRUB_RE = /^ph_shrub_\d$/;
  function specOf(kind) {
    var k = String(kind || "").replace(/^e1_/, ""); if (SPEC[k]) return SPEC[k];
    if (SHRUB_RE.test(k)) return { t: 1, leafR: 0.68, barkR: 0.9, tr: 0.32 };
    var sp = (typeof MODEL_SPECS !== "undefined" && MODEL_SPECS[kind]) || {};
    if (/lamp|lantern|light|post|pole|bollard|sign|flag|banner/i.test(k)) return null;
    if (/saguaro|organ|barrel|cholla|cactus|pear|sagy/i.test(k)) return { t: 3, bodyR: 0.62, spine: 0.55 };
    if (/agave|aloe|succulent|quiver/i.test(k)) return { t: 3, bodyR: 0.52, wax: 0.4 };
    if (/palm/i.test(k)) return { t: 0, leafR: 0.5, barkR: 0.88, tr: 0.3, bend: 0.35 };
    if (sp.sway && sp.prop) return /tree|wood|willow|mesquite|verde|ash|elm|oak/i.test(k) ? { t: 0, leafR: 0.62, barkR: 0.9, tr: 0.32 } : { t: 1, leafR: 0.7, barkR: 0.9, tr: 0.3 };
    return null;
  }
  FO.specOf = specOf;
  function isLeaf(m) { return !!m && (m.alphaTest > 0.05 || /leaf|leaves|frond|twig|needle|flower/i.test(m.name || "")); }
  // fill a material's per-kind uniforms (values only: the code is the same for every plant)
  function setupKind(m, kind, model, partGeo) {
    var sp = specOf(kind); if (!sp) return false; var st = patch(m, kind, null); if (!st) return false;
    var leaf = isLeaf(m), u = st.u, H = Math.max(0.3, (model && model.height) || 2), spec = (typeof MODEL_SPECS !== "undefined" && MODEL_SPECS[kind]) || {};
    st.role = leaf ? "leaf" : sp.t === 3 ? "body" : "bark"; st.kind = kind; st.t = sp.t;
    var sway = K.wind ? (sp.t === 3 ? 0 : (spec.sway || st.sway || 0.5) * (sp.stiff || 1)) : 0;
    u.uFolK.value.set(sway, H, leaf && sp.flutter !== 0 && sp.t !== 3 ? (sp.t === 1 ? 0.7 : 1) : 0, sp.t);
    // the canopy: the leaf parts' bounds (all parts of the model when there is no leaf part); computed once per model
    var cb = canopyOf(model); if (cb) { u.uFolC.value.set(cb[0], cb[1], cb[2], 0); u.uFolE.value.set(cb[3], cb[4], cb[5], 0); }
    var cardLeaf = leaf && !m.normalMap && (sp.t === 0 || sp.t === 1);
    if (K.bent && cardLeaf) { u.uFolC.value.w = sp.bend !== undefined ? sp.bend : 0.6; u.uFolTint.value.w = 1; u.uFolM.value.z = 0.35; }
    if (K.bent && (sp.t === 0 || sp.t === 1)) u.uFolE.value.w = leaf ? 1 : 0.7;   // canopy AO for leaves, a little on the trunk under the crown
    var tq = tierQ();
    if (K.tr && tq >= 2) {
      if (leaf && sp.tr) { u.uFolTr.value.set(sp.tr * 0.75, sp.t === 1 ? 5 : 6, 0.1, 1); var ti = sp.tint || [1.06, 1.16, 0.56]; u.uFolTint.value.set(ti[0], ti[1], ti[2], u.uFolTint.value.w); }
      else if (sp.spine) { u.uFolTr.value.set(sp.spine * 0.55, 2, 0, 2); u.uFolTint.value.set(0.95, 0.86, 0.62, u.uFolTint.value.w); }
      else if (sp.tr && sp.t !== 0) { u.uFolTr.value.set(sp.tr, 4, 0.06, 1); var t2 = sp.tint || [1.0, 1.08, 0.7]; u.uFolTint.value.set(t2[0], t2[1], t2[2], u.uFolTint.value.w); }
      if (sp.wax || (leaf && sp.dust)) u.uFolM.value.x = leaf ? (sp.dust || sp.wax || 0) * 0.5 : sp.wax;
    }
    if (K.tex && tq >= 2 && !leaf && sp.t === 0 && sp.bk) { u.uFolBk.value.x = sp.bk; barkTex(); }
    if (K.mat) { tuneMat(m, sp, leaf); u.uFolM.value.y = leaf ? (sp.t === 1 ? 0.42 : 0.36) : sp.t === 3 ? 0.14 : 0.12; }
    return true;
  }
  var CANOPY = new WeakMap();
  function canopyOf(model) {
    if (!model || !model.parts) return null; var c = CANOPY.get(model); if (c !== undefined) return c;
    var bb = new THREE.Box3(), any = false, all = new THREE.Box3(), anyA = false;
    try { for (var i = 0; i < model.parts.length; i++) { var p = model.parts[i], g = p.geometry; if (!g || !g.attributes || !g.attributes.position) continue; if (!g.boundingBox) g.computeBoundingBox(); if (!g.boundingBox) continue; all.union(g.boundingBox); anyA = true; if (isLeaf(p.material)) { bb.union(g.boundingBox); any = true; } } } catch (e) { err("canopy", e); }
    var b = any ? bb : anyA ? all : null; if (!b) { CANOPY.set(model, null); return null; }
    var ctr = new THREE.Vector3(), sz = new THREE.Vector3(); b.getCenter(ctr); b.getSize(sz);
    c = [ctr.x, ctr.y, ctr.z, Math.max(0.15, sz.x / 2), Math.max(0.15, sz.y / 2), Math.max(0.15, sz.z / 2)]; CANOPY.set(model, c); return c;
  }
  function barkTex() { if (U.tFolBark.value || FO.barkLoading) return; FO.barkLoading = true;
    try { new THREE.TextureLoader().load("/tex/fo_bark_n.png?v=" + (window.BUILD || 0), function (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = tierQ() >= 3 ? 16 : 8; t.name = "fo_bark_n"; t.needsUpdate = true; U.tFolBark.value = t; cnt("barkTex"); }, undefined, function (e) { err("bark tex", e && e.type || e); }); } catch (e) { err("bark tex", e); } }
  // the material standard: plants are dielectric; the night-glow map and the metalness map are dead fetches on a plant
  function tuneMat(m, sp, leaf) {
    var st = ST.get(m); if (!st || st.tuned) return; st.tuned = true;
    if (m.emissiveMap && m.emissiveMap === m.map && !(m.emissiveIntensity > 0)) { m.emissiveMap = null; m.emissive.setRGB(0, 0, 0); cnt("deadEmissive"); }
    if (m.metalnessMap) { m.metalnessMap = null; cnt("deadMetal"); } m.metalness = 0;
    var r = leaf ? sp.leafR : sp.t === 3 || sp.t === 1 && !sp.barkR ? sp.bodyR : sp.barkR; if (r === undefined) r = leaf ? 0.65 : sp.bodyR || 0.88;
    if (m.roughnessMap) { st.r0 = m.roughness; m.roughness = r / 0.82; } else m.roughness = r;   // a roughness map's green averages about 0.8 on these scans
    if (leaf) m.envMapIntensity = Math.min(m.envMapIntensity === undefined ? 1 : m.envMapIntensity, 0.55);
  }

  // ───────────────────────── the instancing sets ─────────────────────────
  var SETS = FO.sets = new Map();   // INSTSET entry -> { kind, sp, parts: [{ near, far, srcN, srcF }] }
  function tierQ() { try { var l = QUAL.level; return l === "ultra" ? 3 : l === "high" ? 2 : l === "medium" ? 1 : 0; } catch (e) { return 2; } }
  function bandW(lodR) { return Math.max(5, Math.min(14, lodR * 0.2)); }
  function setUniformsFor(S, st) {
    var u = st.u, range = 1; try { range = QUAL.q && QUAL.q.range ? Math.max(0.6, QUAL.q.range) : 1; } catch (e) {}
    if (bandOn() && S.far && S.lodR) { var w = bandW(S.lodR); u.uFolF.value.x = S.lodR; u.uFolF.value.y = S.lodR + w; } else { u.uFolF.value.x = 1e7; u.uFolF.value.y = 2e7; }
    if (K.lod) { u.uFolF.value.w = S.R || 1e9; u.uFolF.value.z = S.pxK ? S.pxK * range : 0; } else { u.uFolF.value.w = 1e9; u.uFolF.value.z = 0; }
  }
  // every set of a plant kind: own near and far material clones (one program), the uniforms of that set
  function scanSets() {
    if (typeof INSTSET === "undefined" || typeof MODELS === "undefined") return 0; var added = 0;
    for (var i = 0; i < INSTSET.length; i++) { var S = INSTSET[i]; var sp = specOf(S.kind); if (!sp) continue; var m = MODELS[S.kind]; if (!m || !m.parts) continue;
      var rec = SETS.get(S); if (!rec) { rec = { kind: S.kind, sp: sp, parts: [] }; SETS.set(S, rec); added++; }
      try { syncSet(S, rec, m); } catch (e) { err("sync " + S.kind, e); } }
    return added;
  }
  function syncSet(S, rec, m) {
    var tiers = [S.insts || [], S.far || [], S.far2 || []];
    for (var t = 0; t < 3; t++) { var L = tiers[t]; for (var j = 0; j < L.length; j++) { var inst = L[j]; var cur = inst.material; if (!cur || Array.isArray(cur)) continue; var cs = ST.get(cur);
        if (cs && cs.set === S && cs.tier === (t ? 1 : 0)) { setUniformsFor(S, cs); continue; }   // already ours for this set and tier
        var src = cs && cs.src ? cs.src : cur; var part = m.parts[j] || m.parts[m.parts.length - 1];
        if (!ST.get(src)) { if (!setupKind(src, S.kind, m, part && part.geometry)) continue; } else { var s0 = ST.get(src); if (!s0.kind || !s0.role) setupKind(src, S.kind, m); }
        var c = rec.cache && rec.cache.get(src.uuid + ":" + (t ? 1 : 0));
        if (!c) { c = cloneFor(src, t ? 1 : 0); var cst = ST.get(c); cst.set = S; (rec.cache || (rec.cache = new Map())).set(src.uuid + ":" + (t ? 1 : 0), c); }
        setUniformsFor(S, ST.get(c)); inst.material = c; cnt("assigned"); } }
  }
  FO.scanSets = scanSets;

  // ───────────────────────── the LOD cross-fade band: band instances drawn in the near tier too ─────────────────────────
  // The engine puts an instance in exactly one tier (near closer than lodR, far beyond). In the band [lodR, lodR + w] the far
  // instances are also appended to the near tier's buffer (after the engine's n near instances, capacity is the whole list);
  // the near clone dithers them out and the far clone dithers them in with the complementary mask, so the switch is a dissolve.
  function bandOn() { return K.lod && tierQ() >= 2; }
  function bandPass(vers) {
    if (!FO.active || !bandOn()) return; var cx = camera.position.x, cz = camera.position.z; var t0 = performance.now(), nb = 0, up = 0, grids = 0;
    SETS.forEach(function (rec, S) { if (!S.far || !S.far.length || !S.lodR || !S.insts || !S.insts.length) return; var n = S.n | 0; if (n < 0) n = 0;
      var i0 = S.insts[0], st0 = ST.get(i0.material); if (!st0 || st0.set !== S) return;   // our clone is on (the stream swap puts the original back until the next sync)
      if (!S.far[0] || !ST.get(S.far[0].material) || ST.get(S.far[0].material).set !== S) return;   // and on the far tier
      // the ring [lodR, lodR + w] from a 16 m grid of the set's placements (closer than 320 m the engine frustum-tests nothing, so
      // every placement in the ring is in its far tier); the grids are built a few sets a pass
      var G = rec.grid; if (!G || rec.gridN !== S.list.length) { if (grids++ >= 1) return; G = bandGrid(rec, S); }
      var w = bandW(S.lodR), Rb = S.lodR + w, R0 = S.lodR * S.lodR, R1 = Rb * Rb, list = S.list, B = rec.band || (rec.band = new Int32Array(64)), k = 0, GC0 = 16, hid = typeof HIDDEN !== "undefined" && HIDDEN.size > 0;
      var c0x = Math.floor((cx - Rb) / GC0), c1x = Math.floor((cx + Rb) / GC0), c0z = Math.floor((cz - Rb) / GC0), c1z = Math.floor((cz + Rb) / GC0);
      for (var gx = c0x; gx <= c1x; gx++) for (var gz = c0z; gz <= c1z; gz++) { var x0 = gx * GC0, z0 = gz * GC0, nx = Math.max(x0, Math.min(cx, x0 + GC0)) - cx, nz = Math.max(z0, Math.min(cz, z0 + GC0)) - cz; if (nx * nx + nz * nz > R1) continue;
        var fx = Math.max(Math.abs(cx - x0), Math.abs(cx - x0 - GC0)), fz = Math.max(Math.abs(cz - z0), Math.abs(cz - z0 - GC0)); if (fx * fx + fz * fz < R0) continue;
        var cell = G.get(gx * 100003 + gz); if (!cell) continue;
        for (var q = 0; q < cell.length; q++) { var i = cell[q], e = list[i], dx = e[0] - cx, dz = e[2] - cz, d2 = dx * dx + dz * dz; if (d2 <= R0 || d2 >= R1) continue; if (hid && HIDDEN.has(S.kind + ":" + i)) continue;
          if (k >= B.length) { var B2 = new Int32Array(B.length * 2); B2.set(B); B = rec.band = B2; } B[k++] = i; } }
      var engineWrote = vers && vers.get(S) !== i0.instanceMatrix.version;
      var same = !engineWrote && k === rec.bk && rec.bn === n && rec.bv === i0.instanceMatrix.version; if (same) { for (var a = 0; a < k; a++) if (B[a] !== rec.bprev[a]) { same = false; break; } }
      if (same) { nb += k; return; } if (!rec.bprev || rec.bprev.length < B.length) rec.bprev = new Int32Array(B.length); rec.bprev.set(B.subarray(0, k)); rec.bk = k; rec.bn = n;
      var M = S.mats; for (var p = 0; p < S.insts.length; p++) { var inst = S.insts[p], att = inst.instanceMatrix, arr = att.array, cap = arr.length / 16; var kk = Math.max(0, Math.min(k, cap - n));
        for (var bb = 0; bb < kk; bb++) { var o = (n + bb) * 16, s = B[bb] * 16; for (var jj = 0; jj < 16; jj++) arr[o + jj] = M[s + jj]; }
        var was = inst.count; inst.count = n + kk; inst.visible = inst.count > 0;
        if (!engineWrote && att.addUpdateRange && kk > 0) { att.clearUpdateRanges(); att.addUpdateRange(n * 16, kk * 16); }
        if (kk > 0 || was !== inst.count) { att.needsUpdate = true; up++; } }
      rec.bv = i0.instanceMatrix.version; nb += k; });
    FO.n.band = nb; FO.n.bandUp = (FO.n.bandUp || 0) + up; var ms = performance.now() - t0; FO.n.bandMs = Math.round(ms * 100) / 100; if (ms > (FO.n.bandMax || 0)) FO.n.bandMax = Math.round(ms * 100) / 100;
  }
  function bandGrid(rec, S) { var L = S.list, G = new Map(), C = 16; for (var i = 0; i < L.length; i++) { var e = L[i], key = Math.floor(e[0] / C) * 100003 + Math.floor(e[2] / C), a = G.get(key); if (!a) G.set(key, a = []); a.push(i); } rec.grid = G; rec.gridN = L.length; cnt("grids"); return G; }
  var VERS = new Map();
  function wrapCulling() {
    if (FO.wrapped || typeof updateCulling !== "function") return; var orig = updateCulling; FO.origCulling = orig;
    var w = function (force) { var on = FO.active && bandOn(); if (on) { VERS.clear(); SETS.forEach(function (rec, S) { if (S.insts && S.insts[0]) VERS.set(S, S.insts[0].instanceMatrix.version); }); }
      var r = orig.apply(this, arguments); if (on) { try { bandPass(VERS); } catch (e) { if (!FO.bandErr) { FO.bandErr = 1; err("band", e); } } } return r; };
    w.folWrapped = true; try { updateCulling = w; FO.wrapped = true; } catch (e) { err("wrap culling", e); }
  }

  // streamed models: their materials are set up before plan_perf's warm-up compiles them (R9p prep hook)
  function prepHooks() {
    var SP = window.PLAN_STREAM_PREP = window.PLAN_STREAM_PREP || {}; if (typeof MODEL_SPECS === "undefined") return;
    Object.keys(MODEL_SPECS).forEach(function (k) { if (!specOf(k)) return; var prev = SP[k]; if (prev && prev.fol) return;
      var f = function (full) { if (prev) { try { prev(full); } catch (e) { err("prep chain " + k, e); } } try { (full && full.parts || []).forEach(function (p) { setupKind(p.material, k, full, p.geometry); }); cnt("prepped"); } catch (e) { err("prep " + k, e); } };
      f.fol = true; SP[k] = f; });
  }
  // the grass tufts (client buildDetails): grass wind, translucency, grow-in by distance
  function setupTufts() {
    var tm = typeof DETAILS !== "undefined" && DETAILS && DETAILS.tuftMat; if (!tm || FO.tufts) return; var st = patch(tm, "tuft", "leaf"); if (!st) return; FO.tufts = tm;
    st.kind = "tuft"; st.role = "leaf"; st.t = 2; var u = st.u; u.uFolK.value.set(K.wind ? 1.25 : 0, 1.1, 0, 2); u.uFolC.value.set(0, -0.6, 0, K.bent ? 0.55 : 0); u.uFolE.value.set(0.7, 1.4, 0.7, K.bent ? 0.55 : 0); u.uFolTint.value.w = K.bent ? 1 : 0; u.uFolM.value.z = 0.2;
    if (K.tr && tierQ() >= 2) { u.uFolTr.value.set(0.42, 4, 0.12, 1); u.uFolTint.value.set(1.12, 1.08, 0.62, u.uFolTint.value.w); }
    if (K.mat) { tm.roughness = 0.82; u.uFolM.value.y = 0.6; }
    if (K.gc) { tm.transparent = false; tm.depthWrite = true; tm.needsUpdate = true; }
    tuftFade(); try { tuftTex(); } catch (e) { err("tuft tex", e); }
  }
  function tuftTex() { var tm = FO.tufts; if (!tm || !GC.texOk || !GC.tex || FO.tuftTexOn || !K.gc || tierQ() < 2) return; var t = GC.tex.clone(); t.repeat.set(0.5, 1); t.offset.set(0, 0); t.needsUpdate = true; FO.tuftTexOld = tm.map; tm.map = t; FO.tuftTexOn = true; cnt("tuftTex"); tuftFade(); }
  function tuftFade() { var tm = FO.tufts; if (!tm) return; var st = ST.get(tm); if (!st) return; var q = tierQ(); var far = !K.gc ? 0 : q >= 3 ? 150 : q === 2 ? 120 : q === 1 ? 95 : 75; st.u.uFolG.value.set(far * 0.62, far, FO.tuftTexOn && K.alpha ? K.mipScale : 0, 0); }

  // ───────────────────────── near ground cover: bunchgrass round the camera that grows in (high, ultra) ─────────────────────────
  // Dormant October grama and a taller seed-headed bunchgrass on open desert ground only (the R8 rule the near pebbles use:
  // no walk, cover, plaza, road, runway, golf or building footprint under it), hashed per 1.7 m cell so a place always has the
  // same clumps, patchy (a low-frequency mask leaves bare caliche between drifts). The cells are tested once and cached; a refill
  // after 3 m of camera travel only tests the new cells, at most GC.budget a frame. The clumps grow in over the outer band.
  var GC = FO.gc = { on: false, R: 0, C: 1.7, cache: new Map(), at: [1e9, 1e9], meshes: [], mat: null, n: 0, more: false, budget: 420, fills: 0, tested: 0, ms: 0, maxMs: 0 };
  function hash3(a, b, c) { var v = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return v - Math.floor(v); }
  function vnoise(x, z) { var ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz; var sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    var a = hash3(ix, iz, 5), b = hash3(ix + 1, iz, 5), c = hash3(ix, iz + 1, 5), d = hash3(ix + 1, iz + 1, 5); return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz; }
  function gcTex() {
    if (GC.tex || GC.texFail) return GC.tex; var t = new THREE.TextureLoader().load("/tex/fo_grass.png?v=" + (window.BUILD || 0), function () { GC.texOk = true; cnt("gcTex"); try { tuftTex(); } catch (e) { err("tuft tex", e); } }, undefined, function (e) { GC.texFail = true; err("grass tex", e && e.type || e); });
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.name = "fo_grass"; GC.tex = t; return t;
  }
  function gcGeo(v) {
    var pos = [], uv = [], nrm = [], idx = []; for (var q = 0; q < 3; q++) { var a = q * Math.PI / 3, dx = Math.cos(a) * 0.5, dz = Math.sin(a) * 0.5, b = q * 4, u0 = v * 0.5, u1 = u0 + 0.5;
      pos.push(-dx, 0, -dz, dx, 0, dz, dx, 1, dz, -dx, 1, -dz); uv.push(u0, 0, u1, 0, u1, 1, u0, 1); var nx = -Math.sin(a), nz = Math.cos(a); for (var j = 0; j < 4; j++) nrm.push(nx, 0, nz); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3)); g.setIndex(idx); g.computeBoundingSphere(); return g;
  }
  function gcBuild() {
    if (GC.on || !K.gc || tierQ() < 2 || typeof THREE === "undefined" || !GC.texOk) return; var q = tierQ(); GC.R = q >= 3 ? 34 : 26; var cap = Math.ceil(Math.PI * GC.R * GC.R / (GC.C * GC.C) * 0.9) + 16;
    var mat = new THREE.MeshStandardMaterial({ map: GC.tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.84, metalness: 0 }); mat.name = "fo_grass"; GC.mat = mat;
    var st = patch(mat, "fo_grass", "leaf"); if (!st) return; st.t = 2; var u = st.u; u.uFolK.value.set(K.wind ? 1.4 : 0, 1, 0, 2); u.uFolC.value.set(0, -0.9, 0, K.bent ? 0.6 : 0); u.uFolE.value.set(0.6, 1.25, 0.6, K.bent ? 0.6 : 0); u.uFolTint.value.w = K.bent ? 1 : 0; u.uFolM.value.z = 0.2;
    if (K.tr) { u.uFolTr.value.set(0.46, 4, 0.12, 1); u.uFolTint.value.set(1.12, 1.06, 0.6, u.uFolTint.value.w); } u.uFolG.value.set(GC.R * 0.62, GC.R * 0.98, K.alpha ? K.mipScale : 0, 0); if (K.mat) u.uFolM.value.y = 0.7;
    for (var v = 0; v < 2; v++) { var im = new THREE.InstancedMesh(gcGeo(v), mat, cap); im.frustumCulled = false; im.count = 0; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.castShadow = q >= 3; im.receiveShadow = true; im.name = "fo_grass" + v; im.userData.noInst = true; im.userData.fol = true; scene.add(im); GC.meshes.push(im); }
    GC.cap = cap; GC.on = true; cnt("gcBuilt");
  }
  function gcDesert(x, z) {
    try { if (typeof onLand === "function" && !onLand(x, z)) return false; if (typeof distToRunway === "function" && distToRunway(x, z) < 20) return false;
      if (typeof golfSurface === "function" && golfSurface(x, z) !== "rough") return false; if (typeof pondAt === "function" && pondAt(x, z)) return false;
      if (typeof PLAZAS !== "undefined") for (var i = 0; i < PLAZAS.length; i++) { var pq = PLAZAS[i]; var dx = x - pq[0], dz = z - pq[1], r = pq[2] + 0.8; if (dx * dx + dz * dz < r * r) return false; }
      if (typeof planNearRoad === "function" && planNearRoad(x, z, 1.8)) return false; if (typeof NEAR !== "undefined" && NEAR.blocked && NEAR.blocked(x, z)) return false;
      if (typeof nearDesertAt === "function" && !nearDesertAt(x, z)) return false; return true; } catch (e) { return false; }
  }
  function gcCell(cx, cz) {
    var C = GC.C, pn = vnoise(cx * C / 15, cz * C / 15) * 0.7 + vnoise(cx * C / 5.5 + 17, cz * C / 5.5) * 0.3; var p = Math.max(0, Math.min(0.9, (pn - 0.34) * 2.1));
    if (hash3(cx, cz, 1) > p) return 0; var x = (cx + 0.15 + hash3(cx, cz, 2) * 0.7) * C, z = (cz + 0.15 + hash3(cx, cz, 3) * 0.7) * C; GC.tested++;
    if (!gcDesert(x, z)) return 0; var y = getH(x, z); var vv = hash3(cx, cz, 4) < 0.62 ? 0 : 1; var s = (vv ? 0.62 : 0.5) + hash3(cx, cz, 6) * (vv ? 0.42 : 0.38) * (0.75 + p * 0.4);
    return [x, y - 0.03, z, hash3(cx, cz, 7) * 6.2832, s, s * (vv ? 1.05 + hash3(cx, cz, 8) * 0.45 : 0.62 + hash3(cx, cz, 8) * 0.35), vv];
  }
  function gcFill(force) {
    if (!GC.on) return; var px = camera.position.x, pz = camera.position.z; if (!force && !GC.more && Math.hypot(px - GC.at[0], pz - GC.at[1]) < 3) return;
    var t0 = performance.now(); GC.at = [px, pz]; GC.more = false; var R = GC.R, C = GC.C, R2 = R * R, bud = GC.budget; var c0x = Math.floor((px - R) / C), c1x = Math.floor((px + R) / C), c0z = Math.floor((pz - R) / C), c1z = Math.floor((pz + R) / C);
    var n = [0, 0], A = [GC.meshes[0].instanceMatrix.array, GC.meshes[1].instanceMatrix.array], cap = GC.cap;
    for (var cx = c0x; cx <= c1x; cx++) for (var cz = c0z; cz <= c1z; cz++) { var x0 = (cx + 0.5) * C - px, z0 = (cz + 0.5) * C - pz; if (x0 * x0 + z0 * z0 > R2) continue; var key = cx * 100003 + cz, v = GC.cache.get(key);
      if (v === undefined) { if (bud-- <= 0) { GC.more = true; continue; } v = gcCell(cx, cz); GC.cache.set(key, v); } if (!v) continue; var vv = v[6]; if (n[vv] >= cap) continue;
      var o = n[vv] * 16, M = A[vv], c = Math.cos(v[3]), s = Math.sin(v[3]), sc = v[4], sy = v[5]; M[o] = sc * c; M[o + 1] = 0; M[o + 2] = -sc * s; M[o + 3] = 0; M[o + 4] = 0; M[o + 5] = sy; M[o + 6] = 0; M[o + 7] = 0; M[o + 8] = sc * s; M[o + 9] = 0; M[o + 10] = sc * c; M[o + 11] = 0; M[o + 12] = v[0]; M[o + 13] = v[1]; M[o + 14] = v[2]; M[o + 15] = 1; n[vv]++; }
    for (var i = 0; i < 2; i++) { var im = GC.meshes[i]; im.count = n[i]; im.instanceMatrix.needsUpdate = true; im.visible = n[i] > 0 && !inside; }
    GC.n = n[0] + n[1]; GC.fills++;
    if (GC.cache.size > 9000) { var keep = (R * 2.2) * (R * 2.2); GC.cache.forEach(function (val, kk) { var ccx = Math.round(kk / 100003), ccz = kk - ccx * 100003; var dx = (ccx + 0.5) * C - px, dz = (ccz + 0.5) * C - pz; if (dx * dx + dz * dz > keep) GC.cache.delete(kk); }); }
    var ms = performance.now() - t0; GC.ms = Math.round(ms * 100) / 100; if (ms > GC.maxMs) GC.maxMs = GC.ms;
  }
  function gcFrame() {
    if (!K.gc) return; if (!GC.on) { if (tierQ() >= 2 && typeof COVER !== "undefined" && COVER.ready && typeof camera !== "undefined") { try { if (!GC.tex) gcTex(); gcBuild(); } catch (e) { err("gc build", e); K.gc = false; } } return; }
    var hide = (typeof inside !== "undefined" && inside) || (typeof FLY !== "undefined" && FLY.on) || tierQ() < 2; if (hide) { for (var i = 0; i < GC.meshes.length; i++) GC.meshes[i].visible = false; GC.hid = true; return; }
    if (GC.hid) { GC.hid = false; gcFill(true); return; } gcFill(false);
  }

  // ───────────────────────── frame: O(1) uniforms, periodic set sync, the TAA flag ─────────────────────────
  var lastScan = 0, t0 = 0, lastTier = -1, lastRange = -1;
  function taaOn() {
    if (K.hash === 1) return true; if (K.hash === 0) return false; if (FO.taa !== undefined && FO.taa !== null) return !!FO.taa;
    try { var P = window.PLAN_POST; if (P) { if (typeof P.taaOn === "function") return !!P.taaOn(); if (P.sw && P.active !== undefined) return !!(P.active && !P.off && P.enabled !== false && P.sw.taa); if (P.taa !== undefined) return !!(P.taa && (P.taa.on === undefined ? P.taa : P.taa.on)); } } catch (e) {}
    try { var G = window.PLAN_GFX; if (G && G.taa !== undefined) return !!(G.taa && (G.taa.on === undefined ? G.taa : G.taa.on)); } catch (e) {}
    return false;
  }
  function windStrength(now) {
    // calmer mornings and nights, a breezy afternoon, a slow wander; a dust storm (plan_gfx) blows harder
    var h = 12; try { h = dayT() * 24; } catch (e) {} var day = 0.5 + 0.5 * Math.sin((h - 9.5) / 24 * 6.2832);
    var wander = 0.85 + 0.15 * Math.sin(now * 0.000071) * Math.sin(now * 0.000029 + 1.3);
    var storm = 0; try { var G = window.PLAN_GFX; if (G && G.storm && G.storm.k) storm = G.storm.k; } catch (e) {}
    return K.gust * (0.45 + 0.55 * day) * wander * (1 + storm * 1.4);
  }
  function frameHook(dt, now) {
    if (!FO.active) return; now = now || performance.now();
    U.uFolT.value = now / 1000; var w = U.uFolWind.value; if (w) { w.w = K.wind ? windStrength(now) : 0; }
    var a = U.uFolA.value; if (a) { var on = K.alpha && FO.hashOn; a.y = on ? 1 : 0; var f = FO.hashOn ? (FRAME_N % 64) * 5.588238 : 0; a.z = f; a.w = f * 0.618; }
    if ((FRAME_N % 30) === 7) { FO.hashOn = K.alpha && taaOn(); }
    if ((FRAME_N % 60) === 11) { var tq = tierQ(), rg = 1; try { rg = QUAL.q.range; } catch (e) {} if (tq !== lastTier || rg !== lastRange) { lastTier = tq; lastRange = rg; tuftFade(); SETS.forEach(function (rec, S) { rec.cache && rec.cache.forEach(function (c) { setUniformsFor(S, ST.get(c)); }); }); } }
    var age = now - t0, every = age < 240000 ? 2000 : 10000; if (now - lastScan > every) { lastScan = now; try { var n = scanSets(); if (n) cnt("lateSets", n); } catch (e) { err("scan", e); } try { setupTufts(); } catch (e) { err("tufts", e); } }
    try { gcFrame(); } catch (e) { if (!FO.gcErr) { FO.gcErr = 1; err("gc", e); } }
  }

  // ───────────────────────── install ─────────────────────────
  function worldHook() {
    try { initShared(); prepHooks(); FO.active = true; t0 = performance.now(); FO.progAtWorld = renderer && renderer.info && renderer.info.programs ? renderer.info.programs.length : -1; } catch (e) { err("world", e); }
    // boot models: every plant kind's materials, before anything compiles them
    try { if (typeof MODELS !== "undefined") for (var k in MODELS) { if (!specOf(k)) continue; var m = MODELS[k]; if (!m || !m.parts) continue; for (var i = 0; i < m.parts.length; i++) setupKind(m.parts[i].material, k, m, m.parts[i].geometry); if (m._pp) for (var j = 0; j < m._pp.length; j++) setupKind(m._pp[j].material, k, m, m._pp[j].geometry); } } catch (e) { err("boot kinds", e); }
  }
  function deferHook() {
    try { setupTufts(); } catch (e) { err("tufts", e); }
    try { if (K.gc && tierQ() >= 2) gcTex(); } catch (e) { err("gc tex", e); }
    try { scanSets(); } catch (e) { err("sets", e); }
    try { wrapCulling(); } catch (e) { err("culling", e); }
    FO.progAtDefer = renderer && renderer.info && renderer.info.programs ? renderer.info.programs.length : -1;
  }
  PLAN_HOOKS.world.push({ name: "foliage", fn: worldHook });
  PLAN_HOOKS.defer.push({ name: "foliage", fn: deferHook });
  PLAN_HOOKS.frame.push({ name: "foliage", fn: frameHook });

  // ───────────────────────── A/B and debug ─────────────────────────
  // ab(false): every plant mesh back to its pristine (unpatched) material, the band off; ab(true): back to ours. Needs ?folab=1.
  FO.ab = function (on) {
    if (!K.ab) return "boot with ?folab=1"; var n = 0; FO.abOff = !on;
    SETS.forEach(function (rec, S) { [S.insts || [], S.far || [], S.far2 || []].forEach(function (L) { L.forEach(function (inst) { var m = inst.material, st = ST.get(m); if (!st) return;
      if (!on) { if (st.pristine) { inst.userData.folMat = m; inst.material = st.pristine; n++; } } }); }); });
    if (on) { SETS.forEach(function (rec, S) { [S.insts || [], S.far || [], S.far2 || []].forEach(function (L) { L.forEach(function (inst) { if (inst.userData.folMat) { inst.material = inst.userData.folMat; delete inst.userData.folMat; n++; } }); }); }); }
    if (FO.tufts) { var tst = ST.get(FO.tufts); if (tst && tst.pristine) { var tuft = null; scene.traverse(function (o) { if (o.isInstancedMesh && (o.material === FO.tufts || o.material === tst.pristine)) tuft = o; }); if (tuft) tuft.material = on ? FO.tufts : tst.pristine; } }
    FO.active = !!on; if (!on) { SETS.forEach(function (rec, S) { if (S.insts) S.insts.forEach(function (inst) { inst.count = Math.max(0, S.n | 0); }); rec.bk = -1; }); } else { cullAt = 0; }
    for (var gi = 0; gi < GC.meshes.length; gi++) GC.meshes[gi].visible = !!on && GC.n > 0; if (on && GC.on) gcFill(true);
    return n;
  };
  FO.stat = function () { var o = { v: FO.v, active: !!FO.active, K: K, n: FO.n, errs: FO.errs.slice(0, 10), sets: SETS.size, patched: PATCHED.length, hash: !!FO.hashOn, tier: tierQ(), progAtWorld: FO.progAtWorld, progAtDefer: FO.progAtDefer, progs: renderer && renderer.info.programs ? renderer.info.programs.length : -1, wind: U.uFolWind.value ? U.uFolWind.value.toArray().map(function (x) { return +x.toFixed(3); }) : null }; return o; };
})();
