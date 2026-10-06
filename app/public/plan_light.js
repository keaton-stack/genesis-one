// R16 (Agent L): sun, sky and shadow lighting. Classic script, loaded after plan_perf.js and before client.js, so the shader chunk
// patches below are in place before any program compiles. Reaches client globals (renderer, scene, camera, CSMX, QUAL, hemi, inside,
// LIGHTS, FRAME_N) by bare name at call time only. No new lights, no new samplers: every new term rides on the existing light pool,
// the existing cascade samplers and a handful of uniforms that only the cascaded (high, ultra) materials receive.
//
// 1. Sun shadows (high and ultra, the cascaded tiers):
//    - contact-hardening soft shadows on the first cascade (PCSS-lite: a 5 tap rotated blocker search, then three's bilinear PCF
//      with its footprint scaled to the penumbra the blocker distance and the Sun's angular size give; contact edges stay crisp);
//    - per-cascade bias from each cascade's own texel size plus a slope-scaled term on every cascade (the client used 0.32 m normal
//      offset and 0.47 m depth bias on every cascade: everything under about 30 cm lost its shadow near the camera);
//    - wider cascade blends (the 27 m seam on ultra blended over 0.2 m) with the shadow cameras widened to match;
//    - a 4096 first cascade on ultra; the two far cascades on a 4 tap bilinear PCF (pays for the search in compile time).
// 2. Ambient (cascaded tiers): a top-down occluder map (the existing shadow machinery renders the casters around the player from
//    above into a 1024 map, copied into a spare strip of the last cascade's texture, so no material gets a new sampler) gives sky
//    visibility under porches, eaves, arcades, canopies and trees: the occluded sky light and its reflections are taken out and
//    replaced by the warm light the overhang's underside bounces down. Specular horizon occlusion for normal-mapped surfaces.
//    The hemisphere fill's ground colour is coupled to the light the sunlit caliche actually reflects (every tier: it is a colour).
// 3. Sun colour across the day from a small clear-air transmittance model (Douglas, AZ, about 1,200 m, dry October air), mixed
//    with the art-directed ramp: near neutral at 10:00, golden (not red) at 17:40; night is left to B's R15 key and fill.
// 4. Night light pools: the additive glow decals under the lamps (flat discs of constant colour) become light-like decals that
//    multiply the surface they fall on (the ground's own texture shows through, warm), with an inverse-square, cosine-cubed profile.
// Switches: ?light=0 (everything), ?pcss=0, ?lbias=0, ?cblend=0, ?c4k=0, ?sko=0 (sky occlusion), ?bounce=0, ?specocc=0, ?suncol=0,
// ?lpool=0. Live: PLAN_LIGHT.K (knobs), PLAN_LIGHT.set(name, on), PLAN_LIGHT.state().
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_LIGHT = window.PLAN_LIGHT || { v: "r16-0", errs: [], n: {} };
(function () {
  "use strict";
  var L = window.PLAN_LIGHT; L.v = "r16-L2"; L.errs = L.errs || []; L.n = L.n || {};
  var Q = location.search;
  function on(k) { return !(new RegExp("[?&]" + k + "=0\\b")).test(Q); }
  function note(tag, e) { try { if (L.errs.length < 24) L.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); } catch (x) {} }
  L.on = on("light") && !!window.THREE && !!THREE.ShaderChunk;   // ?light=0 turns all of it off
  if (!L.on) return;
  var SW = L.sw = { pcss: on("pcss"), bias: on("lbias"), blend: on("cblend"), c4k: on("c4k"), sko: on("sko"), bounce: on("bounce"), spec: on("specocc"), sun: on("suncol"), pool: on("lpool") };
  var K = L.K = {
    // shadows: the Sun's angular diameter used for the penumbra (the real Sun is 0.53 deg; a little more reads as the sky's own
    // softening), the farthest blocker the search looks for (m), filter radius limits (texels), slope bias (texels), slope cap,
    // normal offset and constant depth bias per cascade (texels of that cascade), the cascade blend (share of the boundary depth)
    sunDeg: 1.1, searchM: 14, maxR: 9, minR: 1.35, slopeB: 0.9, slopeMax: 6, nb: 1.05, db: 0.8, blend: 0.085, taps: 16,
    // sky occlusion: map size (m) and resolution, push off walls (m), ring radius (m), the occluder height ramp (m above the point:
    // starts, full, fades from, fades to), strength on diffuse sky light and on reflections, re-render distance (m) and age (s)
    soSize: 96, soRes: 1024, soPush: 0.55, soRing: 1.25, soH: [0.55, 1.6, 6, 26], soDiff: 0.9, soSpec: 0.85, soMove: 22, soAge: 45, soMinR: 1.0, soNight: 0.2,
    // the light an overhang's underside sends down, as a share of the ground bounce
    under: 0.42,
    // ground bounce: caliche albedo (linear), share of the open ground in sun, mix with the client's fixed ground colour
    gndAlb: [0.46, 0.37, 0.27], gndLit: 0.8, bounceMix: 0.6, bounceMax: 2.4,
    // horizon occlusion of reflections (normal maps)
    horizon: 1.15,
    // sun colour: mix of the physical colour into the art ramp, pressure (atm), aerosol optical depth at 550 nm, Angstrom exponent
    sunMix: 0.75, sunLow: 0.2, press: 0.87, aod: 0.07, ang: 1.1, sunI: 1.0,
    // night pools: strength and warmth of the light-like decals
    poolK: 1.0, poolGain: 14.0, poolCap: 8.0, poolH: 0.7, poolWarm: [1.0, 0.92, 0.82], poolDecay: 1.0
  };
  var V3 = function () { return new THREE.Vector3(); };
  // shared uniforms (every cascaded material gets these objects, so one write reaches all of them)
  var U = L.U = {
    plShK: { value: new THREE.Vector4(0, 0, 0, 0) },    // x: search depth (normalised), y: max radius, z: noise frame, w: min radius
    plShK2: { value: new THREE.Vector4(0, 0, 0, 0) },   // x: sun cone (2 tan(a/2)), y: slope cap, z: slope bias (texels), w: taps
    plCasc: { value: new THREE.Vector4(0, 0, 0, 0) },   // x: cascade blend, z: horizon occlusion
    plAO: { value: new THREE.Vector4(0, 0, 0, 0) },     // x: sky occlusion (diffuse), y: (reflections), w: map valid
    plHm0: { value: new THREE.Vector4(0, 0, 1, 0) },    // x: west edge, y: south edge (z max), z: 1 / size, w: camera height
    plHm1: { value: new THREE.Vector4(0.5, 1 / 3, 0, 2 / 3) },   // the strip's place in the last cascade's texture
    plHmK: { value: new THREE.Vector4(1, 160, 0.55, 1.25) },     // x: near, y: depth range, z: push, w: ring radius
    plHmS: { value: new THREE.Vector4(0.55, 1.6, 6, 26) },
    plUnder: { value: new THREE.Color(0, 0, 0) }
  };

  // ═══════════════════════ shader chunks (global; every addition is inside #ifdef USE_CSM, so low and medium compile as before) ═══════════════════════
  // Compile cost was measured in isolation (scratchpad r16L/lab: three r170, the game's light counts, ANGLE D3D11, cold compiles): the
  // blocker search adds 5 taps on the first cascade only, and the two far cascades (32 cm and 1.08 m texels on ultra) take a 4 tap
  // bilinear PCF instead of three's 16 tap one, so the shadow part is compile-neutral (x1.01 to 1.03); the sky term (ultra only) adds
  // about 7 to 10 per cent.
  var SC = THREE.ShaderChunk;
  var TOP = ["#ifdef USE_CSM", "uniform vec4 plCasc;", "#define PL_NEAR 1", "#define PL_FAR 2", "#if CSM_CASCADES >= 4", "#define PL_SKY 1", "#endif", "#endif"].join("\n");
  var PEN_TAPS = (function () { var o = []; for (var k = 0; k < 4; k++) { var a = k * 2.399963 + 0.5, r = Math.sqrt((k + 0.5) / 4); o.push([r * Math.cos(a), r * Math.sin(a), r]); } return o; })();
  var PARS = ["#if defined( USE_CSM ) && defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0",
    "uniform vec4 plShK; uniform vec4 plShK2; uniform vec4 plAO; uniform vec4 plHm0; uniform vec4 plHm1; uniform vec4 plHmK; uniform vec4 plHmS; uniform vec3 plUnder;",
    "float plNL = 1.0; float plS = 1.0; float plSB = 0.0; vec2 plRot = vec2( 1.0, 0.0 );",
    // contact hardening: a 5 tap blocker search (rotated per pixel) gives the penumbra; the caller's PCF footprint is scaled to it
    "float plPen( sampler2D sm, float sRad, float sBias, vec4 sc ) {",
    "  float on = step( 50000.0, sRad ); float kPen = max( sRad - 100000.0, 1.0 ); float minR = max( plShK.w, 1.0 ), maxR = max( plShK.y, minR );",
    "  float tanT = min( sqrt( max( 1.0 - plNL * plNL, 0.0 ) ) / max( plNL, 0.02 ), plShK2.y ); float cone = tanT * plShK2.x / kPen; plSB = cone * plShK2.z * on;",
    "  vec3 c = sc.xyz / sc.w; c.z += sBias - plSB;",
    "  float sr = clamp( plShK.x * kPen * 0.5, 1.0, maxR );",
    "  vec2 tx = sr / vec2( textureSize( sm, 0 ) ); float cb = sr * cone;",
    "  float zb = 0.0, nb = 0.0, z, b; vec2 d;",
    "  z = unpackRGBAToDepth( textureLod( sm, c.xy, 0.0 ) ); b = step( z, c.z ); zb += z * b; nb += b;"].concat(PEN_TAPS.map(function (t) { var x = t[0].toFixed(4), y = t[1].toFixed(4);
      return "  d = vec2( " + x + " * plRot.x - " + y + " * plRot.y, " + x + " * plRot.y + " + y + " * plRot.x ); z = unpackRGBAToDepth( textureLod( sm, c.xy + d * tx, 0.0 ) ); b = step( z, c.z - " + t[2].toFixed(3) + " * cb ); zb += z * b; nb += b;"; })).concat([
    "  float pr = ( c.z - zb / max( nb, 1.0 ) ) * kPen * 0.5;",
    "  return mix( 1.0, clamp( pr / minR, 1.0, maxR / minR ), on * step( 0.5, nb ) );",
    "}",
    // the slope-scaled depth bias for the other cascades (no taps: the receiver's angle to the Sun and the cascade's texel size)
    "float plSlope( float sRad ) { float on = step( 50000.0, sRad ); float kPen = max( sRad - floor( sRad / 100000.0 ) * 100000.0, 1.0 ); float tanT = min( sqrt( max( 1.0 - plNL * plNL, 0.0 ) ) / max( plNL, 0.02 ), plShK2.y ); return on * tanT * plShK2.x / kPen * plShK2.z; }",
    // far cascades: one bilinear PCF cell (4 taps; texel aligned, so the strip cascade's taller texture keeps its grid)
    "float plShadow4( sampler2D sm, vec2 smSize, float sInt, float sBias, vec4 sc ) {",
    "  vec3 c = sc.xyz / sc.w; c.z += sBias;",
    "  if ( c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0 ) return 1.0;",
    "  vec2 t = 1.0 / smSize; vec2 p = c.xy * smSize - 0.5; vec2 f = fract( p ); vec2 uv = ( floor( p ) + 0.5 ) * t;",
    "  float a = step( c.z, unpackRGBAToDepth( textureLod( sm, uv, 0.0 ) ) ), b = step( c.z, unpackRGBAToDepth( textureLod( sm, uv + vec2( t.x, 0.0 ), 0.0 ) ) );",
    "  float d = step( c.z, unpackRGBAToDepth( textureLod( sm, uv + vec2( 0.0, t.y ), 0.0 ) ) ), e = step( c.z, unpackRGBAToDepth( textureLod( sm, uv + t, 0.0 ) ) );",
    "  return mix( 1.0, mix( mix( a, b, f.x ), mix( d, e, f.x ), f.y ), sInt );",
    "}",
    "#endif"]).join("\n");
  var GS_HEAD = "float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {";
  var FRAG_PHYS = ["#if defined( USE_CSM ) && defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0 && NUM_DIR_LIGHTS > 0",
    "plNL = dot( nonPerturbedNormal, directionalLights[ 0 ].direction ); { float plA = 6.2831853 * fract( 52.9829189 * fract( dot( gl_FragCoord.xy + plShK.z * vec2( 5.588238, 3.1913 ), vec2( 0.06711056, 0.00583715 ) ) ) ); plRot = vec2( cos( plA ), sin( plA ) ); }",
    "#endif"].join("\n");
  // sky visibility under overhangs from the top-down occluder map in the last cascade's spare strip (5 taps), the occluded sky light
  // and its reflections taken out, the overhang underside's warm bounce put in; then horizon occlusion of reflections
  var ZT = function (o) { return "unpackRGBAToDepth( textureLod( directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS - 1 ], ( plU" + o + " ) * plHm1.xy + plHm1.zw, 0.0 ) )"; };
  var FRAG_END = ["#if defined( USE_CSM ) && defined( PL_SKY ) && defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0 && defined( RE_IndirectDiffuse )",
    "if ( plAO.w > 0.5 ) {",
    "  mat3 plVR = mat3( viewMatrix );",
    "  vec3 plWp = ( geometryPosition - viewMatrix[ 3 ].xyz ) * plVR; vec3 plNw = geometryNormal * plVR;",
    "  vec2 plB = plWp.xz + plNw.xz * plHmK.z;",
    "  vec2 plU = vec2( plB.x - plHm0.x, plHm0.y - plB.y ) * plHm0.z; float plR = plHmK.w * plHm0.z;",
    "  float plE = 1.0 - smoothstep( 0.38, 0.48, max( abs( plU.x - 0.5 ), abs( plU.y - 0.5 ) ) ); plU = clamp( plU, 0.02, 0.98 );",
    "  float plH = plHm0.w - plHmK.x - plWp.y; vec4 plZ;",
    "  plZ.x = " + ZT(" + vec2( plR, 0.0 )") + ";",
    "  plZ.y = " + ZT(" - vec2( plR, 0.0 )") + ";",
    "  plZ.z = " + ZT(" + vec2( 0.0, plR )") + ";",
    "  plZ.w = " + ZT(" - vec2( 0.0, plR )") + ";",
    "  float plZ0 = " + ZT("") + ";",
    "  vec4 plD = plH - plZ * plHmK.y; float plD0 = plH - plZ0 * plHmK.y;",
    "  vec4 plC = smoothstep( vec4( plHmS.x ), vec4( plHmS.y ), plD ) * ( 1.0 - 0.55 * clamp( ( plD - plHmS.z ) / ( plHmS.w - plHmS.z ), 0.0, 1.0 ) );",
    "  float plC0 = smoothstep( plHmS.x, plHmS.y, plD0 ) * ( 1.0 - 0.55 * clamp( ( plD0 - plHmS.z ) / ( plHmS.w - plHmS.z ), 0.0, 1.0 ) );",
    "  float plOcc = ( 0.4 * plC0 + 0.15 * ( plC.x + plC.y + plC.z + plC.w ) ) * plE;",
    "  float plO = plOcc * clamp( 0.5 + 0.5 * plNw.y, 0.0, 1.0 ) * plAO.x;",
    "  irradiance = irradiance * ( 1.0 - plO ) + plUnder * plO;",
    "  #if defined( RE_IndirectSpecular )",
    "  iblIrradiance *= 1.0 - plO;",
    "  radiance *= 1.0 - plOcc * clamp( 0.3 + 0.7 * dot( reflect( - geometryViewDir, geometryNormal ), viewMatrix[ 1 ].xyz ), 0.0, 1.0 ) * plAO.y;",
    "  #endif",
    "}",
    "#endif",
    "#if defined( USE_CSM ) && defined( RE_IndirectSpecular )",
    "if ( plCasc.z > 0.0 ) { vec3 plRv = reflect( - geometryViewDir, geometryNormal ); float plHo = clamp( 1.0 + plCasc.z * dot( plRv, nonPerturbedNormal ), 0.0, 1.0 ); radiance *= plHo * plHo; }",
    "#endif"].join("\n");
  var CH = L.ch = { ok: [], margin: 0, calls: 0, want: (function () { var m = /[?&]plch=([^&#]*)/.exec(Q); return (m ? decodeURIComponent(m[1]) : "shadow,nl,ambient,begin").split(","); })() };
  function want(k) { return CH.want.indexOf(k) >= 0; }
  function patchChunks() {
    try {
      var s = SC.shadowmap_pars_fragment;
      if (want("shadow") && s.indexOf("plPen") < 0) { if (s.indexOf(GS_HEAD) < 0) throw new Error("getShadow signature not found"); SC.shadowmap_pars_fragment = TOP + "\n" + s.replace(GS_HEAD, PARS + "\n" + GS_HEAD); CH.ok.push("shadow"); }
      if (want("nl") && SC.lights_physical_fragment.indexOf("plNL") < 0) { SC.lights_physical_fragment = SC.lights_physical_fragment + "\n" + FRAG_PHYS; CH.ok.push("nl"); }
      if (want("ambient") && SC.lights_fragment_end.indexOf("plOcc") < 0) { SC.lights_fragment_end = FRAG_END + "\n" + SC.lights_fragment_end; CH.ok.push("ambient"); }
    } catch (e) { note("chunks", e); }
  }
  // the cascaded loop (R6's rewrite in plan_perf, or three's own): the blend margin is widened, and each cascade's shadow call is
  // chosen at compile time (unrolled loop index): PCSS-lite on the first, three's PCF on the middle ones, the 4 tap PCF on the far
  // ones. plan_perf is told the result is its own, so its world-hook re-run leaves it alone.
  var MARGIN_OLD = /margin = 0\.25 \* pow\( closestEdge, 2\.0 \);/g, MARGIN_NEW = "margin = max( 0.25 * pow( closestEdge, 2.0 ), plCasc.x * closestEdge );";
  var CALL = /directLight\.color \*= \( directLight\.visible && receiveShadow \) \? getShadow\( directionalShadowMap\[ i \], directionalLightShadow\.shadowMapSize, directionalLightShadow\.shadowIntensity, directionalLightShadow\.shadowBias, directionalLightShadow\.shadowRadius, vDirectionalShadowCoord\[ i \] \) : 1\.0;/g;
  var CA = function (sz, bias) { return "directionalShadowMap[ i ], " + sz + ", directionalLightShadow.shadowIntensity, " + bias + ", directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ]"; };
  var CALL_NEW = ["", "#if ( UNROLLED_LOOP_INDEX < PL_NEAR )",
    "plS = plPen( directionalShadowMap[ i ], directionalLightShadow.shadowRadius, directionalLightShadow.shadowBias, vDirectionalShadowCoord[ i ] );",
    "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( " + CA("directionalLightShadow.shadowMapSize / plS", "directionalLightShadow.shadowBias - plSB") + " ) : 1.0;",
    "#elif ( UNROLLED_LOOP_INDEX < PL_FAR )",
    "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( " + CA("directionalLightShadow.shadowMapSize", "directionalLightShadow.shadowBias - plSlope( directionalLightShadow.shadowRadius )") + " ) : 1.0;",
    "#else",
    "directLight.color *= ( directLight.visible && receiveShadow ) ? plShadow4( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias - plSlope( directionalLightShadow.shadowRadius ), vDirectionalShadowCoord[ i ] ) : 1.0;",
    "#endif", ""].join("\n");
  function patchBegin() {
    try {
      var P6 = window.PLAN_PERF && PLAN_PERF.r6; if (P6 && typeof P6.chunks === "function") P6.chunks();
      if (!want("begin")) return; var c = SC.lights_fragment_begin; if (c.indexOf("plCasc.x") >= 0) return;
      var nm = (c.match(MARGIN_OLD) || []).length, nc = (c.match(CALL) || []).length; if (!nm || !nc) { note("begin", "margin " + nm + " calls " + nc); return; }
      // only inside the cascaded fade block: the plain directional loop below it (Lambert, Phong, non-cascaded materials) keeps its call
      var a = c.indexOf("#if defined( USE_SHADOWMAP ) && defined( CSM_FADE )"), b = a >= 0 ? c.indexOf("#elif defined (USE_SHADOWMAP)", a) : -1; if (a < 0 || b < a) { note("begin", "no fade block"); return; }
      var blk = c.slice(a, b), nb = (blk.match(CALL) || []).length; if (!nb) { note("begin", "no call in the fade block"); return; }
      var m = c.slice(0, a).replace(MARGIN_OLD, MARGIN_NEW) + blk.replace(MARGIN_OLD, MARGIN_NEW).replace(CALL, CALL_NEW) + c.slice(b).replace(MARGIN_OLD, MARGIN_NEW); nc = nb;
      SC.lights_fragment_begin = m; CH.margin = nm; CH.calls = nc; if (P6 && P6.ch && P6.ch.mine) P6.ch.mine = m;
    } catch (e) { note("begin", e); }
  }
  patchChunks();

  // ═══════════════════════ the cascaded shadow helper (client.js builds it with new THREE.CSM at load) ═══════════════════════
  var CS = L.cs = { csm: null, last: null, strip: false, c4k: false, n: { mats: 0 } };
  var UPV = new THREE.Vector3(0, 1, 0), _m1 = new THREE.Matrix4(), _m1i = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _bb = new THREE.Box3(), _c = new THREE.Vector3(), _o = new THREE.Vector3();
  var _lsf = { vertices: { near: [V3(), V3(), V3(), V3()], far: [V3(), V3(), V3(), V3()] } };
  var VSC = new THREE.Matrix4().makeScale(1, 2 / 3, 1);
  function blendMargin(ld, csm) { var a = Math.abs(ld); return Math.max(0.25 * a * a, (SW.blend ? K.blend : 0) * a); }
  function attach(csm) {
    CS.csm = csm; var n = csm.lights.length;
    // every cascaded material gets the shared uniforms when it compiles (the helper's own hook stores each shader in this map)
    var sh = csm.shaders, set0 = sh.set;
    sh.set = function (m, s) { if (s && s.uniforms) { for (var k in U) s.uniforms[k] = U[k]; CS.n.mats++; } return set0.call(this, m, s); };
    // the last cascade's texture gets a spare strip on top (2048 x 1024 more) for the sky-occlusion map
    if (SW.sko && n >= 4) { try { var last = csm.lights[n - 1], vp = new THREE.Vector4(0, 0, 1, 2 / 3); last.shadow.mapSize.set(last.shadow.mapSize.x, Math.round(last.shadow.mapSize.x * 1.5)); last.shadow.getViewport = function () { return vp; }; var um = last.shadow.updateMatrices; last.shadow.updateMatrices = function (l, v) { um.call(this, l, v); this.matrix.premultiply(VSC); }; if (last.shadow.map) { last.shadow.map.dispose(); last.shadow.map = null; } CS.last = last; CS.strip = true; } catch (e) { note("strip", e); CS.strip = false; } }
    // ultra: the first cascade at 4096
    if (SW.c4k && n >= 4) { try { csm.lights[0].shadow.mapSize.set(4096, 4096); if (csm.lights[0].shadow.map) { csm.lights[0].shadow.map.dispose(); csm.lights[0].shadow.map = null; } CS.c4k = true; } catch (e) { note("c4k", e); } }
    patchBegin();
  }
  if (THREE.CSM) {
    var Base = THREE.CSM;
    THREE.CSM = class extends Base {
      constructor(o) { super(o); try { attach(this); } catch (e) { note("attach", e); } }
      // snapping to each light's own texel size (the first cascade may be 4096 while the helper thinks 2048)
      update() {
        var cam = this.camera, fr = this.frustums; _m1.lookAt(_o.set(0, 0, 0), this.lightDirection, UPV); _m1i.copy(_m1).invert();
        for (var i = 0; i < fr.length; i++) { var l = this.lights[i], s = l.shadow.camera; var tw = (s.right - s.left) / l.shadow.mapSize.x, th = (s.top - s.bottom) / l.shadow.mapSize.x;
          _m2.multiplyMatrices(_m1i, cam.matrixWorld); fr[i].toSpace(_m2, _lsf); _bb.makeEmpty(); for (var j = 0; j < 4; j++) { _bb.expandByPoint(_lsf.vertices.near[j]); _bb.expandByPoint(_lsf.vertices.far[j]); }
          _bb.getCenter(_c); _c.z = _bb.max.z + this.lightMargin; _c.x = Math.floor(_c.x / tw) * tw; _c.y = Math.floor(_c.y / th) * th; _c.applyMatrix4(_m1);
          l.position.copy(_c); l.target.position.copy(_c); l.target.position.x += this.lightDirection.x; l.target.position.y += this.lightDirection.y; l.target.position.z += this.lightDirection.z; }
      }
      // the shadow cameras widened by the blend margin the shader uses (the helper's own formula when the blend is off)
      updateShadowBounds() {
        var fr = this.frustums;
        for (var i = 0; i < fr.length; i++) { var s = this.lights[i].shadow.camera, f = fr[i], nv = f.vertices.near, fv = f.vertices.far, p1 = fv[0], p2 = p1.distanceTo(fv[2]) > p1.distanceTo(nv[2]) ? fv[2] : nv[2]; var w = p1.distanceTo(p2);
          if (this.fade) { var cam = this.camera, far = Math.max(cam.far, this.maxFar), ld = f.vertices.far[0].z / (far - cam.near); w += blendMargin(ld, this) * (far - cam.near); }
          s.left = -w / 2; s.right = w / 2; s.top = w / 2; s.bottom = -w / 2; s.updateProjectionMatrix(); }
      }
    };
  }

  // ═══════════════════════ per frame (after the client's sky and cascades, before the render) ═══════════════════════
  function G(name) { try { return (0, eval)(name); } catch (e) { return undefined; } }
  var R = null, csmX = null, TMPc = null;
  var ST = L.st = { frame: 0, tier: "", pcssN: 0, inst: false };
  function tierNow() { try { return QUAL.level || ""; } catch (e) { return ""; } }
  function taaOn() { var P = window.PLAN_POST; return !!(P && P.active && P.sw && P.sw.taa); }
  function shadowsFrame() {
    var c = CS.csm; if (!c) return; var n = c.lights.length; var cone = 2 * Math.tan(K.sunDeg * Math.PI / 360); ST.pcssN = SW.pcss ? 1 : 0;
    for (var i = 0; i < n; i++) { var l = c.lights[i], s = l.shadow.camera; var tex = (s.right - s.left) / l.shadow.mapSize.x, range = s.far - s.near; if (!(tex > 0) || !(range > 0)) continue;
      if (SW.bias) { l.shadow.normalBias = K.nb * tex; l.shadow.bias = -(K.db * tex) / range; } else { l.shadow.normalBias = 0.32; l.shadow.bias = -0.00018; }
      var kp = Math.min(99000, range * cone / tex); l.shadow.radius = i < ST.pcssN ? 100000 + kp : (SW.bias ? 200000 + kp : 1.5); }
    var range0 = c.lights[0].shadow.camera.far - c.lights[0].shadow.camera.near;
    U.plShK.value.set(K.searchM / range0, K.maxR, taaOn() ? (ST.frame % 64) : 0, K.minR);
    U.plShK2.value.set(cone, K.slopeMax, SW.bias ? K.slopeB : 0, 0);
    U.plCasc.value.set(SW.blend ? K.blend : 0, 0, SW.spec ? K.horizon : 0, 0);
  }

  // ── sky occlusion: the casters around the player drawn from above with the shadow machinery (same depth programs as the
  //    cascades, so no new program), then copied into the last cascade's spare strip after every redraw of either ──
  var SO = L.so = { light: null, cx: 1e9, cz: 1e9, at: -1e9, ok: false, top: 0, dirty: false, want: 0, n: { renders: 0, blits: 0, ms: 0, msMax: 0, calls: 0, skip: 0 } };
  function soLight() {
    if (SO.light) return SO.light; var l = new THREE.DirectionalLight(0xffffff, 0); l.name = "plSkyOcc"; l.castShadow = true; l.shadow.mapSize.set(K.soRes, K.soRes);
    var c = l.shadow.camera; c.left = -K.soSize / 2; c.right = K.soSize / 2; c.top = K.soSize / 2; c.bottom = -K.soSize / 2; c.near = 1; c.far = 161; c.up.set(0, 0, -1); c.updateProjectionMatrix(); l.shadow.autoUpdate = false; l.__p3csm = true; SO.light = l; return l;
  }
  function soBlit() {
    var c = CS.csm; if (!c || !CS.last || !SO.light) return false; var dst = CS.last.shadow.map, src = SO.light.shadow.map; if (!dst || !src) return false;
    if (dst.height < dst.width * 1.4) return false; var y0 = Math.round(dst.height * 2 / 3);
    var P = R.properties, sf = P.get(src).__webglFramebuffer, df = P.get(dst).__webglFramebuffer; if (!sf || !df) return false;
    var gl = R.getContext(), st = R.state, prev = R.getRenderTarget(), cf = R.getActiveCubeFace(), ml = R.getActiveMipmapLevel();
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, sf); st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, df);
    gl.blitFramebuffer(0, 0, K.soRes, K.soRes, 0, y0, K.soRes, y0 + K.soRes, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, null); R.setRenderTarget(prev, cf, ml); SO.n.blits++; return true;
  }
  var GROUNDS = { list: [], at: -1e9 };
  function grounds(now) {   // the terrain meshes stay out of the occluder map (a slope must not read as a roof)
    if (now - GROUNDS.at < 15000) return GROUNDS.list; GROUNDS.at = now; var gm = G("GROUND_MATS"); var set = new Set(gm || []); var out = [];
    try { scene.traverse(function (o) { if (o.isMesh && o.material && set.has(o.material)) out.push(o); }); } catch (e) {} GROUNDS.list = out; return out;
  }
  function soRender(now, s0, smObj, scn, cam) {
    var l = soLight(), p = (G("player") || camera).position; var step = K.soSize / K.soRes; var cx = Math.round(p.x / step) * step, cz = Math.round(p.z / step) * step;
    var gy = 0; try { gy = getH(cx, cz); } catch (e) {} var top = gy + 80;
    l.position.set(cx, top, cz); l.target.position.set(cx, top - 10, cz); l.updateMatrixWorld(true); l.target.updateMatrixWorld(true);
    var t0 = performance.now(), sm = R.shadowMap, nu = sm.needsUpdate, gl = grounds(now), hid = [];
    for (var i = 0; i < gl.length; i++) if (gl[i].visible) { gl[i].visible = false; hid.push(gl[i]); }
    var c0 = R.info.render.calls;
    try { sm.needsUpdate = true; l.shadow.needsUpdate = true; SO.inPass = true; s0.call(smObj, [l], scn, cam); } finally { SO.inPass = false; sm.needsUpdate = nu; for (var j = 0; j < hid.length; j++) hid[j].visible = true; }
    SO.n.calls = R.info.render.calls - c0;
    SO.cx = cx; SO.cz = cz; SO.top = top; SO.at = now; SO.n.renders++; var ms = performance.now() - t0; SO.n.ms = Math.round(ms * 10) / 10; SO.n.msMax = Math.max(SO.n.msMax, SO.n.ms);
    U.plHm0.value.set(cx - K.soSize / 2, cz + K.soSize / 2, 1 / K.soSize, top); U.plHmK.value.set(l.shadow.camera.near, l.shadow.camera.far - l.shadow.camera.near, K.soPush, K.soRing);
    SO.ok = soBlit();
  }
  function soFrame(now) {
    var ins = false; try { ins = !!inside; } catch (e) {}
    if (!SW.sko || !CS.strip || ins || !R.shadowMap.enabled) { U.plAO.value.set(0, 0, 0, 0); return; }
    var p = (G("player") || camera).position; var moved = Math.hypot(p.x - SO.cx, p.z - SO.cz);
    if (moved > K.soMove || now - SO.at > K.soAge * 1000 || SO.dirty || (!SO.ok && now - SO.at > 2000)) { SO.dirty = false; SO.want = now; }
    var hs = U.plHmS.value; hs.set(K.soH[0], K.soH[1], K.soH[2], K.soH[3]); U.plHmK.value.z = K.soPush; U.plHmK.value.w = K.soRing;
    var dk = 1; try { var tt = dayT(), sel = -Math.cos(tt * 6.283); dk = Math.max(0, Math.min(1, (sel + 0.1) / 0.1)); } catch (e) {} var nk = K.soNight + (1 - K.soNight) * dk;   // B's night fill is for readability, not sky light
    U.plAO.value.set(K.soDiff * nk, SW.spec ? K.soSpec * nk : 0, 0, SO.ok && moved < K.soSize * 0.35 ? 1 : 0);
  }
  function wrapDraw() {
    if (R.__plLd) return; R.__plLd = true; var rbd = R.renderBufferDirect;
    R.renderBufferDirect = function (cam, sc, geo, mat, obj, grp) {
      if (SO.inPass === true && sc === null && obj && SO.light && cam === SO.light.shadow.camera) {
        if (obj.isSkinnedMesh === true || obj.isPoints === true || obj.isLine === true) { SO.n.skip++; return; }
        var bs = geo && geo.boundingSphere; if (bs && bs.radius * obj.matrixWorld.getMaxScaleOnAxis() < K.soMinR) { SO.n.skip++; return; }
      }
      return rbd.apply(this, arguments);
    };
  }
  function wrapShadowRender() {
    var sm = R.shadowMap; if (sm.__plL) return; sm.__plL = true; var s0 = sm.render;
    var mainScene = G("scene");
    sm.render = function (lights, scn, cam) {
      var last = CS.last, due = false; if (last && !SO.inPass && (sm.autoUpdate || sm.needsUpdate) && lights && lights.indexOf(last) >= 0 && (last.shadow.autoUpdate || last.shadow.needsUpdate)) due = true;
      var r = s0.apply(this, arguments); if (due && SO.light && SO.light.shadow.map) { try { SO.ok = soBlit(); } catch (e) { note("blit", e); } }
      if (SO.want && !SO.inPass && scn === mainScene && cam && cam.isPerspectiveCamera) { var w = SO.want; SO.want = 0; try { soRender(w, s0, this, scn, cam); } catch (e) { note("soRender", e); SO.ok = false; SO.at = w; } }
      return r;
    };
  }

  // ── colour: the Sun through clear dry air, the caliche bounce ──
  var COL = L.col = { sun: [1, 1, 1], el: 0, gnd: [0, 0, 0], base: null };
  // the direct Sun's colour relative to a 60 degree Sun (the eye and the grade are balanced to the high desert Sun): Rayleigh, aerosol
  // and ozone optical depths in three bands, Kasten-Young air mass; 10:00 comes out near white, 17:40 golden
  function airMass(el) { var zd = 90 - Math.max(el, 0.004) * 180 / Math.PI; return Math.min(38, 1 / (Math.cos(zd * Math.PI / 180) + 0.50572 * Math.pow(Math.max(96.07995 - zd, 0.5), -1.6364))); }
  var AM_REF = airMass(Math.PI / 3);
  function sunPhys(el, out) {
    var dm = airMass(el) - AM_REF, lam = [0.61, 0.55, 0.465];   // band centres (um) for linear sRGB R, G, B
    for (var i = 0; i < 3; i++) { var tr = 0.0088 * Math.pow(lam[i], -4.05) * K.press, ta = K.aod * Math.pow(lam[i] / 0.55, -K.ang), to = i === 1 ? 0.012 : i === 0 ? 0.008 : 0.002; out[i] = Math.exp(-(tr + ta + to) * dm); }
    var m = Math.max(out[0], out[1], out[2]); out[0] /= m; out[1] /= m; out[2] /= m; return m;
  }
  var SP = [0, 0, 0];
  function colourFrame() {
    var c = CS.csm; var keyLights = c ? c.lights : [G("sun")]; var k0 = keyLights[0]; if (!k0) return;
    var t = 0.5; try { t = dayT(); } catch (e) {} var sel = -Math.cos(t * 6.283), az = t * 6.283; var dir = _o.set(Math.cos(az), sel, Math.sin(az) * 0.45).normalize();
    var useMoon = sel < -0.02; var elRad = Math.asin(Math.max(-1, Math.min(1, dir.y))); COL.el = elRad;
    var dayW = useMoon ? 0 : Math.max(0, Math.min(1, (elRad - 0.01) / 0.05));   // the Sun is the key light (B's night key is left alone)
    if (SW.sun && dayW > 0) {
      sunPhys(elRad, SP); var lowK = Math.max(0, Math.min(1, (elRad - 0.087) / 0.436)); var a = K.sunMix * dayW * (K.sunLow + (1 - K.sunLow) * lowK * lowK * (3 - 2 * lowK));   // full weight from 30 degrees, K.sunLow of it at 5 degrees and below: golden hour keeps more of the art ramp's warmth
      for (var i = 0; i < keyLights.length; i++) { var l = keyLights[i], col = l.color; col.setRGB(col.r + (SP[0] - col.r) * a, col.g + (SP[1] - col.g) * a, col.b + (SP[2] - col.b) * a); if (K.sunI !== 1) l._intensity = (l._intensity === undefined ? 1 : l._intensity) * (1 + (K.sunI - 1) * dayW); }
      COL.sun[0] = SP[0]; COL.sun[1] = SP[1]; COL.sun[2] = SP[2];
    }
    // the ground bounce: what the open caliche reflects (sun on the ground plus the sky's fill), as the hemisphere fill's ground colour
    var ins = false; try { ins = !!inside; } catch (e) {}
    var h = G("hemi"); if (!h || ins) return; if (!COL.base) COL.base = h.groundColor.clone();
    var hI = h.intensity; if (!(hI > 0.01)) return;
    var kc = k0.color, kI = k0.intensity * Math.max(0, dir.y) * K.gndLit; var sky = h.color;
    var a = K.gndAlb, w = SW.bounce ? K.bounceMix * Math.max(0, Math.min(1, (elRad + 0.05) / 0.15)) : 0;
    var gr = a[0] * (kc.r * kI + sky.r * hI) / hI, gg = a[1] * (kc.g * kI + sky.g * hI) / hI, gb = a[2] * (kc.b * kI + sky.b * hI) / hI; var mx = Math.max(gr, gg, gb); if (mx > K.bounceMax) { gr *= K.bounceMax / mx; gg *= K.bounceMax / mx; gb *= K.bounceMax / mx; }
    var b = COL.base; h.groundColor.setRGB(b.r + (gr - b.r) * w, b.g + (gg - b.g) * w, b.b + (gb - b.b) * w);
    COL.gnd[0] = h.groundColor.r; COL.gnd[1] = h.groundColor.g; COL.gnd[2] = h.groundColor.b;
    // the underside of an overhang: lit by that bounce (its albedo about 0.45), in irradiance units for the shader
    var u = K.under; U.plUnder.value.setRGB(h.groundColor.r * hI * u, h.groundColor.g * hI * u, h.groundColor.b * hI * u);
  }

  // ── night pools: the additive glow decals under lamps become light-like (they multiply what they fall on) ──
  var PL = L.pool = { mats: new Map(), skip: new Set(), at: -1e9, n: 0, tex: null };
  function poolTex() {
    if (PL.tex) return PL.tex; var N = 128, d = new Uint8Array(N * N * 4);
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) { var u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1, r = Math.hypot(u, v); var h = K.poolH;   // lamp height as a share of the pool radius
      var e = Math.pow(h * h / (h * h + r * r), 1.5); var win = r >= 1 ? 0 : Math.pow(1 - Math.pow(r, 4), 2); var val = Math.max(0, Math.min(1, e * win)); var o = (y * N + x) * 4; d[o] = d[o + 1] = d[o + 2] = Math.round(255 * Math.pow(val, 1 / 2.2)); d[o + 3] = 255; }
    var t = new THREE.DataTexture(d, N, N); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; PL.tex = t; return t;
  }
  function flatGeo(g) {   // ground decals: the first triangles face up (the uplight beams on trunks face sideways)
    try { var pa = g.attributes.position, ix = g.index; if (!pa) return false; var n = Math.min(8, Math.floor((ix ? ix.count : pa.count) / 3)); if (!n) return false; var up = 0;
      for (var t = 0; t < n; t++) { var i0 = ix ? ix.getX(t * 3) : t * 3, i1 = ix ? ix.getX(t * 3 + 1) : t * 3 + 1, i2 = ix ? ix.getX(t * 3 + 2) : t * 3 + 2;
        var ax = pa.getX(i1) - pa.getX(i0), ay = pa.getY(i1) - pa.getY(i0), az = pa.getZ(i1) - pa.getZ(i0), bx = pa.getX(i2) - pa.getX(i0), by = pa.getY(i2) - pa.getY(i0), bz = pa.getZ(i2) - pa.getZ(i0);
        var nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, l = Math.hypot(nx, ny, nz); if (l > 0 && Math.abs(ny) / l > 0.9) up++; }
      return up >= n * 0.75; } catch (e) { return false; }
  }
  function poolScan(now) {
    if (now - PL.at < 20000) return; PL.at = now;
    try { scene.traverse(function (o) { if (!o.isMesh || !o.material || Array.isArray(o.material)) return; var m = o.material; if (PL.mats.has(m) || PL.skip.has(m)) return;
      if (!m.isMeshBasicMaterial || m.blending !== THREE.AdditiveBlending || m.depthWrite || !m.map || !m.color) { return; }
      if (!flatGeo(o.geometry)) { PL.skip.add(m); return; }
      PL.mats.set(m, { map: m.map, color: m.color.clone(), name: ((o.name || "") + " " + (m.name || "")).trim().slice(0, 40) }); }); } catch (e) { note("poolScan", e); }
    PL.n = PL.mats.size;
  }
  function poolFrame(now) {
    if (!SW.pool) return; poolScan(now); var tex = poolTex(), g = K.poolK * K.poolGain;
    PL.mats.forEach(function (rec, m) {
      // light-like: dst + dst * src (the lit surface under the pool brightens in proportion to its own colour); the profile is the
      // lamp's inverse square and cosine cubed falloff, the strength follows the module's own fade (its opacity)
      if (m.blending !== THREE.CustomBlending) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.DstColorFactor; m.blendDst = THREE.OneFactor; }
      if (m.map !== tex) m.map = tex;
      var k = Math.min(K.poolCap, g * Math.max(0, Math.min(1, m.opacity))); var w = K.poolWarm; m.color.setRGB(rec.color.r * w[0] * k, rec.color.g * w[1] * k, rec.color.b * w[2] * k);
    });
    // the pooled point lights: inverse-square falloff (decay 2) at the same light a third of the way out
    if (K.poolDecay > 0) { var P = G("LIGHTS"); if (P && P.pool) for (var i = 0; i < P.pool.length; i++) { var l = P.pool[i]; var I = l._intensity; if (!(I > 0) || !(l.distance > 0) || !(l.decay < 2)) continue; var dr = Math.max(0.5, l.distance * 0.33); var d2 = l.decay + (2 - l.decay) * K.poolDecay; l._intensity = I * Math.pow(dr, d2 - l.decay); l.decay = d2; } }
  }
  function poolRestore() { PL.mats.forEach(function (rec, m) { m.blending = THREE.AdditiveBlending; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendEquation = THREE.AddEquation; m.map = rec.map; m.color.copy(rec.color); }); }

  function frame(dt, now) {
    if (!L.on) return; ST.frame++;
    if (!R) { R = G("renderer"); if (!R) return; }
    if (!ST.inst) { ST.inst = true; try { wrapShadowRender(); wrapDraw(); } catch (e) { note("wrap", e); } }
    ST.tier = tierNow(); now = now || performance.now();
    try { shadowsFrame(); } catch (e) { note("shadows", e); }
    try { soFrame(now); } catch (e) { note("so", e); }
    try { colourFrame(); } catch (e) { note("colour", e); }
    try { poolFrame(now); } catch (e) { note("pool", e); }
  }
  window.PLAN_HOOKS.frame.push({ name: "planLight", fn: frame });

  // ── live A/B ──
  L.set = function (k, v) { if (!(k in SW)) return "no switch " + k; SW[k] = !!v; if (k === "pool" && !v) poolRestore(); if (k === "sko") SO.dirty = true; if (k === "bounce" && !v && COL.base) { try { hemi.groundColor.copy(COL.base); } catch (e) {} } if (k === "c4k" && CS.csm) { try { var l0 = CS.csm.lights[0]; l0.shadow.mapSize.set(v ? 4096 : 2048, v ? 4096 : 2048); if (l0.shadow.map) { l0.shadow.map.dispose(); l0.shadow.map = null; } R.shadowMap.needsUpdate = true; } catch (e) { note("c4k", e); } } return k + " " + SW[k]; };
  L.all = function (v) { for (var k in SW) L.set(k, v); return SW; };
  L.state = function () { var c = CS.csm; return { v: L.v, sw: SW, errs: L.errs, chunks: CH.ok, margin: CH.margin, mats: CS.n.mats, strip: CS.strip, c4k: CS.c4k, tier: ST.tier, pcssN: ST.pcssN, so: { ok: SO.ok, n: SO.n, c: [SO.cx, SO.cz] }, col: COL, pools: PL.n,
    lights: c ? c.lights.map(function (l) { var s = l.shadow.camera; return { tex: +((s.right - s.left) / l.shadow.mapSize.x).toFixed(4), nb: +l.shadow.normalBias.toFixed(4), bias: +l.shadow.bias.toExponential(2), rad: Math.round(l.shadow.radius), map: l.shadow.map ? [l.shadow.map.width, l.shadow.map.height] : null }; }) : null }; };
})();
