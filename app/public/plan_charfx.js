/* plan_charfx.js (R16, Agent C): character shading for the player avatar and every NPC rig.
   Classic script, loaded before client.js (after plan_avatar.js). Client functions are reached by bare name at call time.
   What it does (high and ultra; medium and low are untouched):
   - Skin: per-channel wrap diffuse with a warm scatter band at the terminator (pre-integrated look), diffuse from the smooth
     normal and specular from the detailed one, a dual-lobe GGX specular at F0 0.028 (roughness about 0.5 with variation), a
     pore and microrelief detail normal, warm occlusion in creases.
   - Hair: a Kajiya-Kay style dual highlight (shifted primary, tinted secondary) along the hair flow, broken by strand noise,
     softer image-based specular on the hair.
   - Eyes: a wet cornea (sharp low-roughness lobe), soft sclera, lid occlusion for depth.
   - Cloth: a Charlie sheen lobe, a soft wrap, fabric detail normals by kind (cotton jersey, twill / denim, plain weave,
     leather), denim weft flecks, F0 0.04 (the glTF specular factor 2 made the clothes plastic).
   - The glTF rigs (Aaron, Everette, the R3 people, the partner likenesses) were not CSM materials: each of the four cascade
     lights lit them (four times the sun, the black polo read grey). They are rebuilt as CSM materials (wrapMat).
   Detail layers: /tex/ch_detail.png (5 tileable 512 px layers, procedural, seamless), sampled triplanar in bind space
   (ultra) or on the dominant plane (high), so the fragmented generator atlases show no seams.
   Switches: ?chfx=0 all off; ?chskin=0 ?chhair=0 ?cheye=0 ?chcloth=0 ?chdet=0 (detail normals) ?chcsm=0 (rig CSM fix). */
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_CHARFX = window.PLAN_CHARFX || { v: "r16-0", errs: [], n: {} };
(function () {
  "use strict";
  var CF = window.PLAN_CHARFX; CF.v = "r16-1"; CF.errs = CF.errs || []; CF.n = { tint: 0, rigs: 0, rigMats: 0, csm: 0, repatch: 0, detMs: 0, attr: 0 };
  var Q = location.search;
  function flag(k, d) { var m = Q.match(new RegExp("[?&]" + k + "=(\\d+)")); return m ? +m[1] : d; }
  function note(where, e) { if (CF.errs.length < 30) CF.errs.push(where + ": " + (e && e.message ? e.message : e)); try { console.warn("plan_charfx " + where, e); } catch (x) {} }
  var LV = "high"; try { LV = localStorage.getItem("g1:quality") || (((navigator.hardwareConcurrency || 8) <= 4 || /Android|iPhone|iPad|Quest|Pico/i.test(navigator.userAgent)) ? "medium" : "high"); } catch (e) {}
  CF.level = LV; CF.tier = LV === "ultra" ? 2 : LV === "high" ? 1 : 0;
  CF.on = flag("chfx", 1) !== 0 && CF.tier > 0 && !!window.THREE;
  CF.sw = { skin: flag("chskin", 1), hair: flag("chhair", 1), eye: flag("cheye", 1), cloth: flag("chcloth", 1), det: flag("chdet", 1), csm: flag("chcsm", 1) };
  if (!CF.on) return;

  // ───────── shared uniforms: the detail layers (a flat placeholder until the PNG is in, so programs never change) ─────────
  var NL = 5, DS = 512;
  function flatArray() { var d = new Uint8Array(4 * NL); for (var i = 0; i < NL; i++) { d[i * 4] = 128; d[i * 4 + 1] = 128; d[i * 4 + 2] = 128; d[i * 4 + 3] = 128; } var t = new THREE.DataArrayTexture(d, 1, 1, NL); t.needsUpdate = true; return t; }
  var U = CF.U = { det: { value: flatArray() }, dbg: { value: flag("chdbg", 0) }, eye: { value: CF.sw.eye ? 1 : 0 }, k: { value: new THREE.Vector4(CF.sw.det ? 1 : 0, CF.sw.skin ? 1 : 0, CF.sw.cloth ? 1 : 0, CF.sw.hair ? 1 : 0) } };
  CF.loadDetail = function () {
    if (CF._dp) return CF._dp; var t0 = performance.now();
    var get = function (n) { return fetch("/tex/ch_detail.png?v=" + (window.BUILD || "dev")).then(function (r) { if (!r.ok) throw new Error("ch_detail " + r.status); return r.blob(); })
      .catch(function (e) { if (n <= 0) throw e; return new Promise(function (res) { setTimeout(res, 3000); }).then(function () { return get(n - 1); }); }); };
    CF._dp = get(4)
      .then(function (b) { return createImageBitmap(b, { premultiplyAlpha: "none", colorSpaceConversion: "none" }); })
      .then(function (bm) {
        var w = bm.width, h = bm.height; if (w !== DS || h !== DS * NL) throw new Error("ch_detail size " + w + "x" + h);
        var cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
        var x = cv.getContext("2d", { willReadFrequently: true }); x.drawImage(bm, 0, 0); var px = x.getImageData(0, 0, w, h).data; try { bm.close(); } catch (e) {}
        var t = new THREE.DataArrayTexture(new Uint8Array(px.buffer.slice(0)), DS, DS, NL); t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.colorSpace = THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = CF.tier >= 2 ? 8 : 4; t.needsUpdate = true;
        var old = U.det.value; U.det.value = t; try { old.dispose(); } catch (e) {} CF.n.detMs = Math.round(performance.now() - t0); CF.detail = t; return t;
      }).catch(function (e) { note("detail", e); });
    return CF._dp;
  };

  // ───────── GLSL ─────────
  // vertex: bind-space position (metres) and normal for the triplanar detail and the hair flow; rigs also carry body regions
  var V_COMMON = "#include <common>\nvarying vec3 vChP; varying vec3 vChN; uniform float uChS;\n#ifdef CH_RIG\nattribute vec4 aCh; varying vec4 vChR;\n#endif\n";
  var V_BEGIN = "#include <begin_vertex>\nvChP = position * uChS; vChN = normal;\n#ifdef CH_RIG\nvChR = aCh;\n#endif\n";
  var F_COMMON = [
    "#include <common>",
    "precision highp sampler2DArray;",
    "uniform sampler2DArray uChDet; uniform vec4 uChK; uniform float uChDbg; uniform float uChS; uniform float uChEyeK;",
    "uniform vec4 uChSkin; uniform vec4 uChLum; uniform vec4 uChCls; uniform vec4 uChHead; uniform vec4 uChEye;",
    "varying vec3 vChP; varying vec3 vChN;",
    "#ifdef CH_RIG\nvarying vec4 vChR;\n#endif",
    "float chSk = 0.0, chHr = 0.0, chEy = 0.0, chCl = 0.0, chLay = -1.0, chShK = 0.0, chShR = 0.5, chPore = 0.0, chDen = 0.0, chRg = 0.0, chHrK = 1.0;",
    "vec3 chNs = vec3(0.0, 0.0, 1.0); vec3 chT = vec3(0.0, 1.0, 0.0); vec3 chShC = vec3(0.0); vec4 chBase = vec4(1.0);",
    "float chH3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }",
    "float chN3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(chH3(i), chH3(i + vec3(1, 0, 0)), f.x), mix(chH3(i + vec3(0, 1, 0)), chH3(i + vec3(1, 1, 0)), f.x), f.y), mix(mix(chH3(i + vec3(0, 0, 1)), chH3(i + vec3(1, 0, 1)), f.x), mix(chH3(i + vec3(0, 1, 1)), chH3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }",
    // a bind-space direction to view space through the screen derivatives (least squares in the tangent plane)
    "vec3 chB2V(vec3 tb, vec3 bx, vec3 by, vec3 vx, vec3 vy) { float lx = length(bx), ly = length(by); if (lx < 1e-9 || ly < 1e-9) return vec3(0.0); bx /= lx; vx /= lx; by /= ly; vy /= ly; float a11 = dot(bx, bx), a12 = dot(bx, by), a22 = dot(by, by); float b1 = dot(tb, bx), b2 = dot(tb, by); float det = a11 * a22 - a12 * a12; if (abs(det) < 1e-6) return vec3(0.0); return vx * ((b1 * a22 - b2 * a12) / det) + vy * ((b2 * a11 - b1 * a12) / det); }",
    // the cotangent frame of one projection (Schuler), returns the view-space tangential offset for a tangent-space xy
    "vec3 chOff(vec3 N, vec3 q0, vec3 q1, vec2 s0, vec2 s1, vec2 nxy) { vec3 q1p = cross(q1, N), q0p = cross(N, q0); vec3 T = q1p * s0.x + q0p * s1.x, B = q1p * s0.y + q0p * s1.y; float det = max(dot(T, T), dot(B, B)); float sc = det == 0.0 ? 0.0 : inversesqrt(det); return (T * nxy.x + B * nxy.y) * sc; }",
    ""
  ].join("\n");
  // the lighting model (direct): replaces RE_Direct for these materials
  var F_DIRECT = [
    "#include <lights_physical_pars_fragment>",
    "float chDG(float a2, float nh) { float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d + 1e-7); }",
    "float chVS(float a2, float nl, float nv) { float gv = nl * sqrt(nv * nv * (1.0 - a2) + a2); float gl = nv * sqrt(nl * nl * (1.0 - a2) + a2); return 0.5 / max(gv + gl, 1e-5); }",
    "vec3 chNd = vec3(0.0, 0.0, 1.0); vec3 chWr = vec3(0.0); vec3 chWrI = vec3(1.0); vec3 chScC = vec3(0.0); vec3 chKd = vec3(0.0); vec3 chShCK = vec3(0.0); vec3 chK2C = vec3(0.0);",
    "float chSkD = 0.0, chHrD = 0.0, chA0 = 0.25, chAa = 0.25, chAb = 0.25, chAv = 0.25, chShInv = 2.0, chS1 = 0.0, chS2 = 0.0, chE1 = 10.0, chE2 = 4.0, chK1 = 0.0;",
    "void RE_Direct_Ch(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {",
    "  vec3 L = directLight.direction, V = geometryViewDir, N = geometryNormal;",
    "  float nl = dot(N, L), nlc = saturate(nl), nv = saturate(dot(N, V)); vec3 H = normalize(L + V); float nh = saturate(dot(N, H)), vh = saturate(dot(V, H));",
    "  #ifdef USE_CLEARCOAT",
    "  clearcoatSpecularDirect += saturate(dot(geometryClearcoatNormal, L)) * directLight.color * BRDF_GGX_Clearcoat(L, V, geometryClearcoatNormal, material);",
    "  #endif",
    "  float nlD = mix(nl, dot(chNd, L), chSkD);",
    "  vec3 dW = saturate((vec3(nlD) + chWr) * chWrI) + chScC * (smoothstep(-0.3, 0.05, nlD) - smoothstep(0.05, 0.5, nlD));",
    "  float tl = dot(chT, L); dW = mix(dW, vec3(mix(dW.g, 0.25 + 0.75 * sqrt(max(0.0, 1.0 - tl * tl)) * saturate(nlD * 0.5 + 0.6), 0.45)), chHrD);",
    "  reflectedLight.directDiffuse += directLight.color * dW * chKd;",
    "  vec3 F = F_Schlick(material.specularColor, material.specularF90, vh);",
    "  float D = mix(chDG(chA0, nh), mix(chDG(chAa, nh), chDG(chAb, nh), 0.15), chSkD) * (1.0 - chHrD);",
    "  float sh = (2.0 + chShInv) * pow(max(1.0 - nh * nh, 0.0078125), chShInv * 0.5) * 0.159155 * saturate(1.0 / (4.0 * (nlc + nv - nlc * nv) + 1e-4));",
    "  float h1 = dot(normalize(chT + N * chS1), H), h2 = dot(normalize(chT + N * chS2), H);",
    "  vec3 kk = (pow(max(0.0, 1.0 - h1 * h1), chE1) * chK1 + pow(max(0.0, 1.0 - h2 * h2), chE2) * chK2C) * smoothstep(-0.2, 0.3, nl);",
    "  reflectedLight.directSpecular += directLight.color * (nlc * (F * (D * chVS(chAv, nlc, nv)) + chShCK * sh) + kk);",
    "}",
    "void RE_Direct_ChLite(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {",
    "  vec3 L = directLight.direction, V = geometryViewDir, N = geometryNormal;",
    "  float nl = dot(N, L), nlc = saturate(nl), nv = saturate(dot(N, V)); vec3 H = normalize(L + V); float nh = saturate(dot(N, H)), vh = saturate(dot(V, H));",
    "  #ifdef USE_CLEARCOAT",
    "  clearcoatSpecularDirect += saturate(dot(geometryClearcoatNormal, L)) * directLight.color * BRDF_GGX_Clearcoat(L, V, geometryClearcoatNormal, material);",
    "  #endif",
    "  reflectedLight.directDiffuse += directLight.color * saturate((vec3(mix(nl, dot(chNd, L), chSkD)) + chWr) * chWrI) * chKd;",
    "  reflectedLight.directSpecular += directLight.color * nlc * F_Schlick(material.specularColor, material.specularF90, vh) * (chDG(chAv, nh) * chVS(chAv, nlc, nv) * (1.0 - chHrD));",
    "}",
    "#undef RE_Direct",
    "#define RE_Direct RE_Direct_Ch",
    ""
  ].join("\n");
  // the light loops: point and spot lights take the lite model, the directional (sun cascade) loop the full one
  // (the first three pool lights also take the full model: the studio's key, fill and rim, and the nearest lamps at night)
  var CALL = "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";
  function litBegin() {
    var c = THREE.ShaderChunk.lights_fragment_begin || ""; var i = c.indexOf("#if ( NUM_DIR_LIGHTS > 0 )"); if (i < 0) return null;
    var pre = c.slice(0, i), post = c.slice(i), pp = pre.indexOf("NUM_POINT_LIGHTS; i ++ )"), pc = pp >= 0 ? pre.indexOf(CALL, pp) : -1;
    if (pc >= 0 && PARTS.full) pre = pre.slice(0, pc) + "\n#if ( UNROLLED_LOOP_INDEX < 3 )\nRE_Direct_Ch( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n#else\n" + CALL + "\n#endif\n" + pre.slice(pc + CALL.length);
    return "#undef RE_Direct\n#define RE_Direct RE_Direct_ChLite\n" + pre + (PARTS.full ? "\n#undef RE_Direct\n#define RE_Direct RE_Direct_Ch\n" : "") + post;
  }
  // the per-pixel material classes of each kind (char: the client's four body slots after the tint; rig: one atlas, regions from bones)
  var CLS_CHAR = [
    "{ vec3 b = chBase.rgb; float lum = dot(b, vec3(0.333)); float sat = max(b.r, max(b.g, b.b)) - min(b.r, min(b.g, b.b));",
    "  float skinLike = smoothstep(0.06, 0.16, sat) * step(b.b + 0.015, b.r) * smoothstep(0.16, 0.32, lum) * (1.0 - smoothstep(0.86, 0.95, lum));",
    "  float drk = 1.0 - smoothstep(0.16, 0.36, lum); float shoe = smoothstep(0.095, 0.06, vBodyY / uBodyH);",
    "  if (uSlot < 0.5) { chSk = skinLike * smoothstep(0.14, 0.2, sat) * 0.95 * (1.0 - shoe); chCl = 1.0 - chSk;",
    "    float pants = drk * (1.0 - skinLike) * (1.0 - shoe); chLay = shoe > 0.5 ? 4.0 : (pants > 0.5 ? 2.0 : 1.0);",
    "    float blue = smoothstep(0.02, 0.12, uPants.b - max(uPants.r, uPants.g * 0.9)); chDen = pants * blue; }",
    "  else if (uSlot < 1.5) { float pale = (1.0 - skinLike) * smoothstep(0.3, 0.5, lum) * (1.0 - smoothstep(0.07, 0.15, sat)) * uChK.y;",
    "    float strand = (1.0 - skinLike) * smoothstep(0.0, 0.04, b.b - b.r) * uChK.w;",
    "    diffuseColor.rgb = mix(diffuseColor.rgb, b * (uSkin / vec3(0.91, 0.76, 0.6)), pale);",
    "    diffuseColor.rgb = mix(diffuseColor.rgb, uHair * uHairK * (0.35 + lum * 2.2), strand); chHr = strand; chSk = 1.0 - strand; }",
    "  else if (uSlot < 2.5) { chHr = 1.0; } else { float slE = skinLike * smoothstep(0.1, 0.18, sat); diffuseColor.rgb = mix(diffuseColor.rgb, b * (uSkin / vec3(0.91, 0.76, 0.6)), slE); chSk = slE; chEy = (1.0 - slE) * uChEyeK; } }",
    ""
  ].join("\n");
  var CLS_RIG = [
    "{ vec3 s = pow(max(chBase.rgb, vec3(0.0)), vec3(0.4545)); float Y = dot(s, vec3(0.299, 0.587, 0.114)); vec2 cc = vec2((s.b - Y) * 0.564, (s.r - Y) * 0.713);",
    "  float sat = (max(s.r, max(s.g, s.b)) - min(s.r, min(s.g, s.b))) / max(0.05, max(s.r, max(s.g, s.b)));",
    "  float d = length(cc - uChSkin.xy) / uChSkin.z; float m = exp(-d * d) * smoothstep(uChLum.x * 0.55, uChLum.x * 0.9, Y) * (1.0 - smoothstep(uChLum.y * 1.12, uChLum.y * 1.3 + 0.04, Y));",
    "  float head = vChR.x, hand = vChR.y, foot = vChR.z, leg = vChR.w;",
    "  float hat = uChHead.w > 0.0 ? smoothstep(uChHead.w - 0.006, uChHead.w + 0.006, vChP.y) : 0.0;",
    "  float allow = clamp(head * (1.0 - hat) + hand + leg * uChCls.w, 0.0, 1.0);",
    "  float lip = head * (1.0 - hat) * smoothstep(0.25, 0.55, normalize(vChN).z) * smoothstep(uChSkin.y + 0.012, uChSkin.y + 0.04, cc.y) * smoothstep(-0.13, -0.08, cc.x) * step(0.12, Y);",
    "  chSk = max(m * allow, lip);",
    "  float face = head * (1.0 - hat) * smoothstep(0.25, 0.55, normalize(vChN).z) * (1.0 - smoothstep(uChEye.x - 0.02, uChEye.x + 0.015, vChP.y));",
    "  float wet = face * (1.0 - chSk) * smoothstep(0.55, 0.75, Y) * (1.0 - smoothstep(0.25, 0.5, sat)) * step(abs(vChP.y - uChEye.y), 0.03);",
    "  chEy = wet * uChEyeK;",
    "  chHr = head * (1.0 - hat) * (1.0 - wet) * (1.0 - smoothstep(0.12, 0.4, m)) * (1.0 - smoothstep(0.78, 0.92, Y)) * (1.0 - smoothstep(0.55, 0.8, sat * smoothstep(0.1, 0.3, Y)));",
    "  float glf = uChEye.z * face * (1.0 - step(0.034, abs(vChP.y - uChEye.y))) * (1.0 - chSk) * (1.0 - smoothstep(0.22, 0.4, Y)); chHr *= 1.0 - glf;",
    "  chSk = max(chSk, head * (1.0 - hat) * (1.0 - glf) * max(0.0, 1.0 - chHr - wet)); chCl = max(0.0, 1.0 - chSk - chHr - chEy);",
    "  float torso = max(0.0, 1.0 - head - hand - foot - leg);",
    "  chLay = glf > 0.5 ? -1.0 : foot > 0.5 ? 4.0 : hat > 0.5 ? 2.0 : (leg > torso ? uChCls.y : uChCls.x); }",
    ""
  ].join("\n");
  // after the normal is known: the hair flow, the detail normal, the class parameters (roughness, sheen, albedo detail)
  var DET = [
    "#include <normal_fragment_maps>",
    "chNs = normal;",
    "{ vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition); vec3 bx = dFdx(vChP), by = dFdy(vChP); float nAA = saturate(1.0 - 5.0 * length(fwidth(normal)));",
    // hair flow: away from the crown along the surface (bind space), to view space
    "  if (chHr > 0.001) { vec3 nb = normalize(vChN); vec3 cr = uChHead.xyz + vec3(0.0, 0.065, -0.035); vec3 tb = vChP - cr; tb -= nb * dot(tb, nb); if (dot(tb, tb) < 1e-8) tb = vec3(0.0, -1.0, 0.0) - nb * nb.y;",
    "    vec3 tv = chB2V(normalize(tb), bx, by, q0, q1); tv -= normal * dot(tv, normal); chT = length(tv) > 1e-6 ? normalize(tv) : normalize(cross(normal, vec3(1.0, 0.0, 0.0)));",
    "    float sn = chN3(vChP * 320.0); float sn2 = chN3(vChP * 90.0 + 7.0); chRg = (sn - 0.5) * 0.1; chHrK = (0.6 + 0.7 * sn2) * nAA; }",
    // detail normal: triplanar in bind space (ultra) or the dominant plane (high), layer by class
    "  float lay = chSk > 0.5 ? 0.0 : chLay; float kDet = uChK.x * (chSk > 0.5 ? 0.42 * uChK.y : chCl > 0.4 && lay >= 0.0 ? (lay < 1.5 ? 0.8 : lay < 2.5 ? 0.75 : lay < 3.5 ? 0.6 : 0.55) * uChK.z : 0.0);",
    "  float tile = lay < 0.5 ? 0.03 : lay < 1.5 ? 0.022 : lay < 2.5 ? 0.0224 : lay < 3.5 ? 0.0224 : 0.02;",
    "  vec3 w = pow(abs(normalize(vChN)), vec3(5.0)); w /= max(1e-5, w.x + w.y + w.z);",
    "  vec2 ux = vChP.zy / tile, uy = vChP.xz / tile, uz = vChP.xy / tile;",
    "  vec2 dxx = dFdx(ux), dxy = dFdy(ux), dyx = dFdx(uy), dyy = dFdy(uy), dzx = dFdx(uz), dzy = dFdy(uz);",
    "  float fp = max(length(bx), length(by)) / tile * 512.0;",   // texels per pixel
    "  float vis = kDet * (1.0 - smoothstep(6.0, 40.0, fp));",
    "  float hgt = 0.5, msk = 0.0, fade = vis / max(kDet, 1e-3);",
    "  if (vis > 0.002) {",
    "#if CH_DET > 1",
    "    vec4 tx = textureGrad(uChDet, vec3(ux, lay), dxx, dxy), ty = textureGrad(uChDet, vec3(uy, lay), dyx, dyy), tz = textureGrad(uChDet, vec3(uz, lay), dzx, dzy);",
    "    vec3 off = chOff(normal, q0, q1, dxx, dxy, tx.rg * 2.0 - 1.0) * w.x + chOff(normal, q0, q1, dyx, dyy, ty.rg * 2.0 - 1.0) * w.y + chOff(normal, q0, q1, dzx, dzy, tz.rg * 2.0 - 1.0) * w.z;",
    "    hgt = tx.b * w.x + ty.b * w.y + tz.b * w.z; msk = (tx.a * w.x + ty.a * w.y + tz.a * w.z) * 2.0 - 1.0;",
    "#else",
    "    vec4 tt; vec3 off; if (w.x >= w.y && w.x >= w.z) { tt = textureGrad(uChDet, vec3(ux, lay), dxx, dxy); off = chOff(normal, q0, q1, dxx, dxy, tt.rg * 2.0 - 1.0); } else if (w.y >= w.z) { tt = textureGrad(uChDet, vec3(uy, lay), dyx, dyy); off = chOff(normal, q0, q1, dyx, dyy, tt.rg * 2.0 - 1.0); } else { tt = textureGrad(uChDet, vec3(uz, lay), dzx, dzy); off = chOff(normal, q0, q1, dzx, dzy, tt.rg * 2.0 - 1.0); }",
    "    hgt = tt.b; msk = tt.a * 2.0 - 1.0;",
    "#endif",
    "    normal = normalize(normal + off * vis * faceDirection);",
    "    hgt = mix(0.5, hgt, fade); msk = mix(0.0, msk, fade); }",
    "  float subpx = kDet * smoothstep(3.0, 30.0, fp);",   // detail finer than a pixel becomes roughness
    // class parameters
    "  float lo = chN3(vChP * 38.0) - 0.5;",
    "  if (chSk > 0.001) { chPore = msk; float rS = 0.5 + 0.09 * lo + 0.08 * (msk - 0.25) + 0.04 * subpx;",
    "#ifdef CH_RIG",
    "    rS += 0.12 * (roughnessFactor - 0.72);",
    "#endif",
    "    roughnessFactor = mix(roughnessFactor, clamp(rS, 0.38, 0.66), chSk * uChK.y); diffuseColor.rgb *= 1.0 - chSk * 0.09 * max(0.0, msk) * uChK.x; }",
    "  if (chCl > 0.001) { float rC = lay > 3.5 ? 0.5 + 0.12 * hgt : lay > 1.5 && lay < 2.5 ? 0.82 + 0.08 * hgt : 0.88 + 0.07 * hgt;",
    "    roughnessFactor = mix(roughnessFactor, clamp(rC + 0.04 * lo, 0.3, 1.0), chCl * uChK.z);",
    "    float cav = (lay > 3.5 ? 0.5 : 0.8) * fade * uChK.z; diffuseColor.rgb *= mix(1.0, 0.86 + 0.28 * hgt, chCl * cav);",
    "    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.9 + vec3(0.05, 0.055, 0.06), chCl * chDen * max(0.0, msk) * 0.42 * fade * uChK.z);",
    "    chShK = chCl * uChK.z * (lay > 3.5 ? 0.0 : lay > 1.5 && lay < 2.5 ? 0.45 : 0.75); chShR = lay > 1.5 && lay < 2.5 ? 0.45 : 0.6; chShC = mix(sqrt(max(diffuseColor.rgb, vec3(0.0))), vec3(0.9), 0.25); }",
    "  if (chHr > 0.001) roughnessFactor = mix(roughnessFactor, 0.42 + 0.1 * lo, chHr * uChK.w);",
    "  if (chEy > 0.001) { float lid = 1.0;",
    "#ifndef CH_RIG",
    "    lid = 1.0 - 0.4 * smoothstep(uChEye.y + 0.0015, uChEye.y + 0.0065, vChP.y);",
    "#endif",
    "    diffuseColor.rgb *= mix(1.0, lid, chEy * uChK.x); roughnessFactor = mix(roughnessFactor, 0.06, chEy); }",
    "}",
    ""
  ].join("\n");
  var MATSET = [
    "#include <lights_physical_fragment>",
    "material.specularColor = mix(material.specularColor, vec3(0.028), chSk * uChK.y);",
    "material.specularColor = mix(material.specularColor, vec3(0.04), chCl * uChK.z);",
    "material.specularColor = mix(material.specularColor, vec3(0.046), chHr * uChK.w);",
    "material.specularColor = mix(material.specularColor, vec3(0.025), chEy);",
    "material.specularF90 = 1.0;",
    "{ chSkD = chSk * uChK.y; chHrD = chHr * uChK.w; chNd = normalize(mix(chNs, normal, 0.3));",
    "  chWr = chSkD * vec3(0.38, 0.16, 0.1) + vec3(chCl * 0.14 * uChK.z + chHrD * 0.22 + chEy * 0.12); chWrI = 1.0 / (1.0 + chWr);",
    "  vec3 sc = normalize(material.diffuseColor + 1e-4) * vec3(1.0, 0.52, 0.36); chScC = chSkD * 0.14 * sc / max(0.2, max(sc.r, max(sc.g, sc.b)));",
    "  float shE = chShK * (1.0 - 0.18 * max(chShC.r, max(chShC.g, chShC.b))); chKd = BRDF_Lambert(material.diffuseColor) * (1.0 - 0.3 * shE);",
    "  float r = material.roughness; chA0 = max(pow2(pow2(r)), 1e-5); chAa = max(pow2(pow2(r * 0.75)), 1e-5); chAb = max(pow2(pow2(min(1.0, r * 1.3))), 1e-5); chAv = mix(chA0, chAa, chSkD);",
    "  chShCK = chShC * chShK; chShInv = 1.0 / max(chShR * chShR, 0.01);",
    "  chS1 = -0.07 + chRg; chS2 = 0.11 + chRg; chE1 = 0.5 * mix(110.0, 22.0, r); chE2 = 0.5 * mix(36.0, 9.0, r);",
    "  chK1 = chHrD * chHrK * 0.04 * (0.5 + chE1 / 110.0); chK2C = chHrD * chHrK * 0.4 * material.diffuseColor; }",
    ""
  ].join("\n");
  var ENDL = "#include <lights_fragment_end>\nreflectedLight.indirectSpecular *= 1.0 - 0.55 * chHr * uChK.w - 0.25 * chCl * uChK.z;\n";
  var AOC = "#include <aomap_fragment>\n#ifdef USE_AOMAP\nreflectedLight.indirectDiffuse *= mix(vec3(1.0), pow(vec3(max(ambientOcclusion, 0.02)), vec3(-0.42, 0.0, 0.15)), chSk * uChK.y);\n#endif\n";
  var DBG = "#include <dithering_fragment>\nif (uChDbg > 0.5) { gl_FragColor.rgb = uChDbg < 1.5 ? vec3(chSk, chHr, chCl) + vec3(chEy) * vec3(1.0, 1.0, 0.0) : uChDbg < 2.5 ? normal * 0.5 + 0.5 : vec3(chLay / 4.0); }\n";

  var PARTS = CF.parts = { det: flag("chpdet", 1), full: flag("chpfull", 1) };
  function inject(sh, o) {
    var vs = sh.vertexShader, fs = sh.fragmentShader;
    if (fs.indexOf("RE_Direct_Ch") >= 0) return;   // already in (a chained hook ran twice)
    vs = vs.replace("#include <common>", V_COMMON).replace("#include <begin_vertex>", V_BEGIN);
    fs = fs.replace("#include <common>", F_COMMON).replace("#include <lights_physical_pars_fragment>", F_DIRECT)
      .replace("#include <map_fragment>", "#include <map_fragment>\nchBase = diffuseColor;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + (o.kind === "rig" ? CLS_RIG : CLS_CHAR))
      .replace("#include <normal_fragment_maps>", PARTS.det ? DET : "#include <normal_fragment_maps>\nchNs = normal;").replace("#include <lights_physical_fragment>", MATSET)
      .replace("#include <lights_fragment_end>", ENDL).replace("#include <aomap_fragment>", AOC).replace("#include <dithering_fragment>", DBG);
    var lb = litBegin(); if (lb) fs = fs.replace("#include <lights_fragment_begin>", lb);
    sh.vertexShader = vs; sh.fragmentShader = fs;
    var u = o.u; sh.uniforms.uChDet = U.det; sh.uniforms.uChK = U.k; sh.uniforms.uChDbg = U.dbg; sh.uniforms.uChEyeK = U.eye;
    sh.uniforms.uChS = u.s; sh.uniforms.uChSkin = u.skin; sh.uniforms.uChLum = u.lum; sh.uniforms.uChCls = u.cls; sh.uniforms.uChHead = u.head; sh.uniforms.uChEye = u.eye;
  }
  CF.inject = inject;
  // materials that classify themselves (plan_avatar.js: the scalp shell, the hats and fitted gear) take only the lighting model
  var EXT_CLS = {
    scalp: "chSk = 1.0 - avStub; chNs = normal;",
    hat: "{ float fab = (hK < 4.5 || hK > 7.5) ? 1.0 : 0.0; chCl = fab; chShK = fab * (hK > 0.5 && hK < 1.5 ? 0.7 : hK > 2.5 && hK < 3.5 ? 0.85 : 0.55) * uChK.z; chShR = 0.55; chShC = mix(sqrt(max(diffuseColor.rgb, vec3(0.0))), vec3(0.9), 0.2); chNs = normal; }"
  };
  var EXT_U = null;
  CF.ext = function (sh, kind) {
    var cls = EXT_CLS[kind]; if (!cls || sh.fragmentShader.indexOf("RE_Direct_Ch") >= 0) return false;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", V_COMMON).replace("#include <begin_vertex>", V_BEGIN);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", F_COMMON).replace("#include <lights_physical_pars_fragment>", F_DIRECT)
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" + cls).replace("#include <lights_physical_fragment>", MATSET)
      .replace("#include <lights_fragment_end>", ENDL).replace("#include <dithering_fragment>", DBG);
    var lb = litBegin(); if (lb) sh.fragmentShader = sh.fragmentShader.replace("#include <lights_fragment_begin>", lb);
    var u = EXT_U || (EXT_U = uniformsFor({})); sh.uniforms.uChDet = U.det; sh.uniforms.uChK = U.k; sh.uniforms.uChDbg = U.dbg; sh.uniforms.uChEyeK = U.eye;
    sh.uniforms.uChS = u.s; sh.uniforms.uChSkin = u.skin; sh.uniforms.uChLum = u.lum; sh.uniforms.uChCls = u.cls; sh.uniforms.uChHead = u.head; sh.uniforms.uChEye = u.eye; CF.n.ext = (CF.n.ext || 0) + 1; return true;
  };

  // ───────── patching a material: chain its onBeforeCompile (the CSM class keeps its own hook), a stable program key ─────────
  function uniformsFor(p) {
    p = p || {}; return { s: { value: p.s || 1 }, skin: { value: new THREE.Vector4(p.cb !== undefined ? p.cb : -0.08, p.cr !== undefined ? p.cr : 0.11, Math.max(0.026, (p.sd || 0.015) * 2.6), 0) },
      lum: { value: new THREE.Vector4(p.y10 || 0.3, p.y90 || 0.8, 0, 0) }, cls: { value: new THREE.Vector4(p.torso || 1, p.legs || 2, 4, p.bareLegs ? 1 : 0) },
      head: { value: new THREE.Vector4(p.hx || 0, p.hy || 1.62, p.hz || 0, p.hat || 0) }, eye: { value: new THREE.Vector4(p.brow || 1.7, p.eyeY || 1.64, p.glasses ? 1 : 0, 0) } };
  }
  function patch(m, o) {
    if (!m || m.__chfx || !(m.isMeshStandardMaterial)) return m;
    var wrapped = "_csmObc" in m, prev = wrapped ? m._userObc : (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ? m.onBeforeCompile : null);
    var det = CF.tier >= 2 ? 3 : 1; m.defines = Object.assign({}, m.defines || {}, { CH_DET: det }); if (o.kind === "rig") m.defines.CH_RIG = 1;
    var key = "chfx2|" + o.kind + "|" + (prev ? prev.toString() : "");
    m.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r); inject(sh, o); };
    m.customProgramCacheKey = function () { return (wrapped ? "csm|" : "") + key; };
    m.__chfx = true; m.userData.chfx = o.kind; m.needsUpdate = true; return m;
  }
  CF.patch = patch;

  // ───────── 1. the client's char rigs: every body slot goes through tintMaterial ─────────
  function slotOf(m) { var nm = (m.name || "").toLowerCase(); return nm === "skin" ? 1 : nm === "hair" ? 2 : nm === "eyes" ? 3 : 0; }
  function charParams(look) {
    var bk = look && look.body === "f" ? "f" : "m"; var K = window.PLAN_AVATAR && PLAN_AVATAR.KIT && PLAN_AVATAR.KIT[bk];
    var p = { s: 1 }; if (K && K.c) { p.hx = K.c.x; p.hy = K.c.y; p.hz = K.c.z; } else { p.hy = bk === "f" ? 1.52 : 1.63; }
    if (K && K.eyes) { p.eyeY = K.eyes.y; p.brow = K.eyes.y + 0.025; } else { p.eyeY = bk === "f" ? 1.5 : 1.6; p.brow = p.eyeY + 0.025; }
    return p;
  }
  function wrapTint() {
    if (CF._tint || typeof window.tintMaterial !== "function") return !!CF._tint;
    var orig = window.tintMaterial; CF._tint = orig;
    window.tintMaterial = function (mat, look) {
      var m = orig.apply(this, arguments);
      try { var sl = slotOf(m); if (sl === 1) { m.sheen = 0; m.roughness = 0.5; } else if (sl === 2) { m.anisotropy = 0; m.sheen = 0; m.roughness = 0.45; } else if (sl === 3) { m.clearcoatRoughness = 0.03; m.roughness = 0.08; }
        var o = { kind: "char", u: uniformsFor(charParams(look)) }; patch(m, o); CF.n.tint++; } catch (e) { note("tint", e); }
      return m;
    };
    return true;
  }

  // ───────── 2. the glTF rigs: CSM materials, body regions from the bones, per-rig skin references ─────────
  // skin chroma (YCbCr of the sRGB albedo): the dominant warm cluster of each atlas (scratchpad r16c/skinref.py); cloth: 1 knit, 2 twill, 3 weave, 4 leather
  var RIGS = CF.RIGS = {
    paul: { cb: -0.0493, cr: 0.0812, sd: 0.0184, y10: 0.224, y90: 0.79, torso: 3, legs: 2, h: 1.8 },
    brad: { cb: -0.064, cr: 0.1109, sd: 0.0152, y10: 0.569, y90: 0.76, torso: 3, legs: 2, h: 1.83 },
    beth: { cb: -0.0752, cr: 0.0604, sd: 0.0102, y10: 0.504, y90: 0.873, torso: 3, legs: 2, h: 1.7 },
    will: { cb: -0.0693, cr: 0.1174, sd: 0.0172, y10: 0.261, y90: 0.76, torso: 3, legs: 2, h: 1.8 },
    jake: { cb: -0.0639, cr: 0.1195, sd: 0.0156, y10: 0.556, y90: 0.759, torso: 3, legs: 2, h: 1.8 },
    pilot: { cb: -0.0977, cr: 0.1253, sd: 0.0159, y10: 0.614, y90: 0.804, torso: 2, legs: 2, hatD: 0.1, h: 1.75 },
    linetech: { cb: -0.0664, cr: 0.1101, sd: 0.0165, y10: 0.59, y90: 0.782, torso: 2, legs: 2, h: 1.8 },
    concierge: { cb: -0.0729, cr: 0.1301, sd: 0.0127, y10: 0.607, y90: 0.744, torso: 2, legs: 2, h: 1.82 },
    resident_m: { cb: -0.0726, cr: 0.1178, sd: 0.0171, y10: 0.504, y90: 0.73, torso: 1, legs: 2, h: 1.8 },
    resident_f: { cb: -0.084, cr: 0.0709, sd: 0.0172, y10: 0.283, y90: 0.688, torso: 3, legs: 2, h: 1.68 },
    aaron: { cb: -0.0772, cr: 0.1224, sd: 0.0131, y10: 0.474, y90: 0.647, torso: 1, legs: 2, bareLegs: 1, hatD: 0.095, glasses: 1, h: 1.8 },
    everette: { cb: -0.0657, cr: 0.0869, sd: 0.0164, y10: 0.302, y90: 0.448, torso: 1, legs: 3, bareLegs: 1, hatD: 0.095, h: 1.78 }
  };
  var RIG_RE = /\/(models|models_m)\/(?:lod\/)?(paul|brad|beth|will|jake|pilot|linetech|concierge|resident_m|resident_f|aaron|everette)\.glb/;
  // body regions per vertex (x head and neck, y hands and forearms, z feet, w legs) from the skin weights and the bone names
  function regionAttr(mesh) {
    var g = mesh.geometry; if (!g || g.getAttribute("aCh")) return; var si = g.getAttribute("skinIndex"), sw = g.getAttribute("skinWeight"); if (!si || !sw || !mesh.skeleton) return;
    var cls = mesh.skeleton.bones.map(function (b) { var n = b.name || ""; return /^(Head|head|neck|Neck|HeadTop)/.test(n) ? 0 : /(Hand|ForeArm|Thumb|Index|Middle|Ring|Pinky)/.test(n) ? 1 : /(Foot|Toe)/.test(n) ? 2 : /(UpLeg|Leg)/.test(n) ? 3 : -1; });
    var n = si.count, out = new Uint8Array(n * 4), acc = [0, 0, 0, 0];
    for (var i = 0; i < n; i++) { acc[0] = acc[1] = acc[2] = acc[3] = 0; for (var k = 0; k < 4; k++) { var w = sw.getComponent(i, k); if (w <= 0) continue; var c = cls[si.getComponent(i, k)]; if (c >= 0) acc[c] += w; } for (k = 0; k < 4; k++) out[i * 4 + k] = Math.max(0, Math.min(255, Math.round(acc[k] * 255))); }
    g.setAttribute("aCh", new THREE.BufferAttribute(out, 4, true)); CF.n.attr++;
  }
  // landmarks from the head vertices (bind space): centre, top, eye line, the cap line for rigs that wear one
  function rigParams(name, mesh) {
    var R = RIGS[name] || {}, p = Object.assign({}, R), g = mesh.geometry; var P = g.getAttribute("position"), A = g.getAttribute("aCh");
    if (!g.boundingBox) g.computeBoundingBox(); var bb = g.boundingBox, hgt = bb.max.y - bb.min.y; p.s = hgt > 0.01 ? (R.h || 1.8) / hgt : 1;
    var top = -1e9, sx = 0, sy = 0, sz = 0, nh = 0, zmax = -1e9;
    if (A) for (var i = 0; i < P.count; i += 3) { if (A.getX(i) < 0.6) continue; var y = P.getY(i) * p.s; if (y > top) top = y; sx += P.getX(i) * p.s; sy += y; sz += P.getZ(i) * p.s; nh++; var z = P.getZ(i) * p.s; if (z > zmax) zmax = z; }
    if (nh > 20) { p.hx = sx / nh; p.hy = sy / nh; p.hz = sz / nh - 0.01; } else { p.hx = 0; p.hy = (bb.max.y * p.s) - 0.12; p.hz = 0; top = bb.max.y * p.s; }
    p.eyeY = top - (R.hatD ? 0.15 : 0.125); p.brow = p.eyeY + 0.025; if (R.hatD) p.hat = top - R.hatD; else p.hat = 0;
    return p;
  }
  function onRig(url, gltf) {
    var mm = RIG_RE.exec(url || ""); if (!mm || !gltf || !gltf.scene) return; var name = mm[2]; CF.n.rigs++;
    var seen = new Map();
    gltf.scene.traverse(function (o) {
      if (!o.isSkinnedMesh || !o.material || Array.isArray(o.material)) return;
      try { regionAttr(o); var m0 = o.material, m = seen.get(m0);
        if (!m) { m = m0; if (CF.sw.csm && typeof wrapMat === "function" && THREE.MeshStandardMaterial.prototype && !("_csmObc" in m0)) { var w = wrapMat(m0); if (w && "_csmObc" in w) { m = w; CF.n.csm++; } }
          patch(m, { kind: "rig", rig: name, u: uniformsFor(rigParams(name, o)) }); m.userData.chRig = name; seen.set(m0, m); CF.n.rigMats++; }
        o.material = m; } catch (e) { note("rig " + name, e); }
    });
  }
  function wrapLoader() {
    if (CF._gl || typeof window.gltfLoader !== "function") return !!CF._gl;
    var orig = window.gltfLoader; CF._gl = orig;
    window.gltfLoader = function () {
      var l = orig.apply(this, arguments); if (!l || l.__chfx) return l; var ld = l.load; l.__chfx = true;
      l.load = function (url, onLoad, onProgress, onError) { return ld.call(this, url, function (gltf) { try { onRig(url, gltf); } catch (e) { note("onRig", e); } if (onLoad) onLoad(gltf); }, onProgress, onError); };
      return l;
    };
    return true;
  }

  // ───────── install as early as possible (the plan hook runs before the characters load) ─────────
  function install() { try { var a = wrapTint(), b = wrapLoader(); if (a && b && !CF.installed) { CF.installed = true; CF.loadDetail(); } } catch (e) { note("install", e); } return false; }
  var H = window.PLAN_HOOKS; H.plan = H.plan || [];
  H.plan.unshift({ name: "charfxPlan", fn: install }); H.terrain.unshift({ name: "charfxTerrain", fn: install }); H.world.unshift({ name: "charfxWorld", fn: install });
  CF.install = install;
  CF.debug = {
    view: function (mode) { U.dbg.value = +mode || 0; return U.dbg.value; },
    k: function (det, skin, cloth, hair) { U.k.value.set(det, skin, cloth, hair); return U.k.value.toArray(); },
    count: function () { var o = { char: 0, rig: 0, other: 0 }; scene.traverse(function (x) { if (!x.isSkinnedMesh) return; var m = x.material; if (m && m.userData && m.userData.chfx) o[m.userData.chfx] = (o[m.userData.chfx] || 0) + 1; else o.other++; }); return o; }
  };
})();

/* ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
   R19 AN: PLAN_ANIM, character animation for every rig (all tiers). HANDOFF_R19_ANIM.md, API in HANDOFF_R19_ANIM_API.md.
   - Natural standing idles: three Meshy mocap idles (models/anim_idle3|4|7.glb, each on its own 24-joint rig) plus two mirrored
     variants, retargeted at load onto each rig (char_m, char_f and every glTF rig) with bone-direction matching and two-bone leg
     IK that keeps both feet on the ground, then blended at random (pose-matched entry points, 1.1 to 1.6 s crossfades) so the
     loop never shows. The old Meshy "Idle" (a forward lean with a think gesture, and a 1.1765 Hips scale that made idle people
     17.6 per cent bigger than walking ones) is no longer played.
   - Locomotion for the char rigs: walk (models/anim_walk2.glb, Meshy walking_2) / jog / run as a speed blend space with a shared
     gait phase, every clip's playback rate matched to the ground speed from its measured stance-foot speed (no foot sliding up
     to the run's cadence limit), per-clip ground offsets (the old -0.1 m walk drop is gone), smooth starts and stops,
     turn-in-place shuffles, lean into turns and accelerations, a head look layer, upper-body gestures.
   - glTF rigs (partners, R3 people, host, Aaron, Everette, Maytrixxx, Will): their idle clip files are intercepted at load
     (gltfLoader wrapper) and their idle replaced by a long composed idle retargeted to that rig; their walk clips get walking_2
     time-stretched to the modules' own speed formula (walk_speed 0.72).
   Switches: ?anim=0 (all off, R18 behaviour), ?animrig=0 (glTF rig idles untouched), ?animlook=0, ?animlean=0, ?animik=0.
   ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
window.PLAN_ANIM = window.PLAN_ANIM || { v: "r19-0", errs: [], n: {} };
(function () {
  "use strict";
  var AN = window.PLAN_ANIM; AN.v = "r19-1"; AN.errs = AN.errs || []; AN.n = { rt: 0, rtMs: 0, rigIdle: 0, rigWalk: 0, chars: 0, steps: 0, poses: 0, gestures: 0, swaps: 0 };
  var Q = location.search;
  function flag(k, d) { var m = Q.match(new RegExp("[?&]" + k + "=(\\d+)")); return m ? +m[1] : d; }
  function note(where, e) { if (AN.errs.length < 40) AN.errs.push(where + ": " + (e && e.message ? e.message : e)); try { console.warn("plan_anim " + where, e); } catch (x) {} }
  AN.off = flag("anim", 0) === 0;   /* R20: the user preferred the R18 walk, run and idle, so the R19 engine is opt-in (?anim=1); seats and beds (plan_seat.js) stay */ AN.ready = false; AN.locked = null;
  if (AN.off) { AN.step = function () { return false; }; AN.whenReady = function () { return Promise.resolve(false); }; return; }
  var OPT = { rig: flag("animrig", 1) !== 0, look: flag("animlook", 1) !== 0, lean: flag("animlean", 1) !== 0, ik: flag("animik", 1) !== 0 };
  AN.opt = OPT;
  var T3 = function () { return window.THREE; };
  var LIB_FILES = { idle3: "/models/anim_idle3.glb", idle4: "/models/anim_idle4.glb", idle7: "/models/anim_idle7.glb", walk2: "/models/anim_walk2.glb", walkm: "/models/anim_walkm.glb", walkf: "/models/anim_walkf.glb", turn: "/models/anim_turn.glb" };
  // idle variants: [source clip, mirrored, weight for men, weight for women]
  var IDLES = [["idle3", false, 0.34, 0.22], ["idle4", false, 0.24, 0.2], ["idle4", true, 0.2, 0.2], ["idle7", false, 0.11, 0.19], ["idle7", true, 0.11, 0.19]];
  var LIB = { src: {}, char: {}, rig: {} }; AN.LIB = LIB;
  var ARM_IDLE = { abd: 0.22, elbow: 0.3, wrist: 0.55 }, ARM_WALK = { elbow: 0.42, wrist: 0.5 };
  function palmOf(k) { return LIB.palm && LIB.palm[k] && LIB.palm[k].Left && LIB.palm[k].Right ? LIB.palm[k] : null; }
  function srcPalm(clipKey) { return palmOf(clipKey === "walkf" ? "char_f" : "char_m"); }   // R19 round 2: natural arms (see armRelax)
  var readyRes; var readyP = new Promise(function (r) { readyRes = r; }); AN.whenReady = function () { return readyP; };

  // ───────── rig description: bones in parent-first order, rest locals, rest world (in the root's frame) ─────────
  var LR = /^(Left|Right)/;
  function mirrorName(n) { return n.indexOf("Left") === 0 ? "Right" + n.slice(4) : n.indexOf("Right") === 0 ? "Left" + n.slice(5) : n; }
  function rigOf(root) {
    var THREE = T3(); if (root.userData.__animRig) return root.userData.__animRig;
    var hips = null; root.traverse(function (o) { if (!hips && o.isBone && o.name === "Hips") hips = o; }); if (!hips) return null;
    root.updateMatrixWorld(true); var inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    var names = [], par = [], rp = [], rq = [], rs = [], idx = {};
    (function walk(b, pi) { if (!b.isBone) return; var i = names.length; idx[b.name] = i; names.push(b.name); par.push(pi); rp.push(b.position.clone()); rq.push(b.quaternion.clone()); rs.push(b.scale.x); b.children.forEach(function (c) { walk(c, i); }); })(hips, -1);
    var m0 = new THREE.Matrix4().multiplyMatrices(inv, hips.parent.matrixWorld); var p0 = new THREE.Vector3(), q0 = new THREE.Quaternion(), s0 = new THREE.Vector3(); m0.decompose(p0, q0, s0);
    var R = { names: names, par: par, rp: rp, rq: rq, rs: rs, idx: idx, p0: p0, q0: q0, s0: s0.x, wq: [], wp: [], ws: [] };
    fkInto(R, rq, rp[0], R.wp, R.wq, R.ws);
    R.footY = Math.min(R.wp[idx.LeftFoot] ? R.wp[idx.LeftFoot].y : 0, R.wp[idx.RightFoot] ? R.wp[idx.RightFoot].y : 0);
    R.hipsY = R.wp[0].y; R.legLen = legLen(R);
    root.userData.__animRig = R; return R;
  }
  function legLen(R) { var a = R.idx.LeftUpLeg, b = R.idx.LeftLeg, c = R.idx.LeftFoot; if (a === undefined || b === undefined || c === undefined) return 0.9; return R.wp[a].distanceTo(R.wp[b]) + R.wp[b].distanceTo(R.wp[c]); }
  // forward kinematics: locals (lq per bone, hips local position) -> world positions / rotations / scales in the root frame
  function fkInto(R, lq, hipsP, wp, wq, ws) {
    var THREE = T3(); var n = R.names.length;
    for (var i = 0; i < n; i++) {
      if (!wp[i]) { wp[i] = new THREE.Vector3(); wq[i] = new THREE.Quaternion(); }
      var p = R.par[i], lp = i === 0 ? hipsP : R.rp[i];
      if (p < 0) { wp[i].copy(lp).multiplyScalar(R.s0).applyQuaternion(R.q0).add(R.p0); wq[i].multiplyQuaternions(R.q0, lq[i]); ws[i] = R.s0 * R.rs[i]; }
      else { wp[i].copy(lp).multiplyScalar(ws[p]).applyQuaternion(wq[p]).add(wp[p]); wq[i].multiplyQuaternions(wq[p], lq[i]); ws[i] = ws[p] * R.rs[i]; }
    }
  }
  // a clip sampler on its own rig: per bone a quaternion interpolant, Hips position interpolant
  function samplerOf(clip, R) {
    var THREE = T3(); var S = { q: [], p: null, dur: clip.duration };
    clip.tracks.forEach(function (t) { var dot = t.name.lastIndexOf("."); var bn = t.name.slice(0, dot), pr = t.name.slice(dot + 1); var i = R.idx[bn]; if (i === undefined) { var bs = bn.replace(/^.*[\/|:]/, ""); i = R.idx[bs]; } if (i === undefined) return;
      if (pr === "quaternion") S.q[i] = t.createInterpolant(); else if (pr === "position" && i === 0) S.p = t.createInterpolant(); });
    var tq = R.rq.map(function (q) { return q.clone(); }), tp = new THREE.Vector3();
    S.at = function (t, lq, hp) { for (var i = 0; i < R.names.length; i++) { var it = S.q[i]; if (it) { var v = it.evaluate(t); lq[i].set(v[0], v[1], v[2], v[3]).normalize(); } else lq[i].copy(R.rq[i]); } if (S.p) { var w = S.p.evaluate(t); hp.set(w[0], w[1], w[2]); } else hp.copy(R.rp[0]); };
    S.tq = tq; S.tp = tp; return S;
  }
  // ───────── retargeting: world-delta transfer with bone-direction matching, optional mirror and foot planting ─────────
  var DIRSET = { Spine02: "Spine01", Spine01: "Spine", Spine: "neck", neck: "Head", LeftShoulder: "LeftArm", RightShoulder: "RightArm", LeftArm: "LeftForeArm", RightArm: "RightForeArm", LeftForeArm: "LeftHand", RightForeArm: "RightHand", LeftUpLeg: "LeftLeg", RightUpLeg: "RightLeg", LeftLeg: "LeftFoot", RightLeg: "RightFoot" };
  var FOOT = { LeftFoot: 1, RightFoot: 1, LeftToeBase: 1, RightToeBase: 1 };
  function mq(q) { q.y = -q.y; q.z = -q.z; return q; }   // reflect a world rotation across the x = 0 plane
  // srcRoot: the clip's skeleton (rest); dstRoot: the target skeleton (rest). opts: { mirror, plant, fps, dur, t0, stretch }
  function retarget(clip, srcRoot, dstRoot, opts) {
    var THREE = T3(); opts = opts || {}; var t0 = performance.now();
    var S = rigOf(srcRoot), D = rigOf(dstRoot); if (!S || !D) throw new Error("no Hips");
    var smp = samplerOf(clip, S); var nS = S.names.length, nD = D.names.length;
    var map = D.names.map(function (n) { var j = S.idx[opts.mirror ? mirrorName(n) : n]; return j === undefined ? -1 : j; });
    // corrected destination rest: each limb bone turned so its direction matches the source rest (parents' turns carried down)
    var corr = [], adj = [], tmpV = new THREE.Vector3(), tmpU = new THREE.Vector3(), qq = new THREE.Quaternion();
    for (var i = 0; i < nD; i++) {
      var p = D.par[i]; var q = new THREE.Quaternion().copy(D.wq[i]); if (p >= 0) q.premultiply(adj[p]);
      var cn = DIRSET[D.names[i]]; var j = map[i];
      if (cn && j >= 0 && D.idx[cn] !== undefined) { var sc = S.idx[opts.mirror ? mirrorName(cn) : cn];
        if (sc !== undefined) { tmpV.copy(D.rp[D.idx[cn]]).normalize().applyQuaternion(q); tmpU.copy(S.rp[sc]).normalize().applyQuaternion(S.wq[j]); if (opts.mirror) tmpU.x = -tmpU.x; if (tmpV.lengthSq() > 0.5 && tmpU.lengthSq() > 0.5) { qq.setFromUnitVectors(tmpV, tmpU); q.premultiply(qq); } } }
      corr[i] = q; adj[i] = q.clone().multiply(new THREE.Quaternion().copy(D.wq[i]).invert());
    }
    var invRestS = S.wq.map(function (q) { return q.clone().invert(); });
    // foot reference: the source foot's world rotation in its most planted frame (a generator rest foot is often tipped)
    var fps = opts.fps || 30, dur = opts.dur || clip.duration, nF = Math.max(2, Math.round(dur * fps) + 1);
    var slq = S.rq.map(function (q) { return q.clone(); }), shp = new THREE.Vector3(), swp = [], swq = [], sws = [];
    var footRef = {}, footMin = {};
    for (var f = 0; f < nF; f++) { smp.at(f / fps * (clip.duration / dur), slq, shp); fkInto(S, slq, shp, swp, swq, sws);
      ["Left", "Right"].forEach(function (sd) { var fj = S.idx[sd + "Foot"], tj = S.idx[sd + "ToeBase"]; if (fj === undefined) return; var yf = swp[fj].y;   // the planted frame: the foot joint at its lowest (the generator rigs' toe joints sit below the ground)
        if (footMin[sd + "Foot"] === undefined || yf < footMin[sd + "Foot"]) { footMin[sd + "Foot"] = yf; footRef[sd + "Foot"] = swq[fj].clone().invert(); if (tj !== undefined) footRef[sd + "ToeBase"] = swq[tj].clone().invert(); } }); }
    var k = D.hipsY / Math.max(0.2, S.hipsY); var yawArr = opts.stripYaw ? new Float32Array(nF) : null, yQ = new THREE.Quaternion(), yAx = new THREE.Vector3(0, 1, 0), yV = new THREE.Vector3(), hipRestInv = S.wq[0].clone().invert();
    var times = new Float32Array(nF), Qo = [], Po = new Float32Array(nF * 3); for (i = 0; i < nD; i++) Qo.push(new Float32Array(nF * 4));
    var dlq = D.rq.map(function (q) { return q.clone(); }), dwq = [], dwp = [], dws = [], wqT = [], hp = new THREE.Vector3(), dq = new THREE.Quaternion(), ip = new THREE.Quaternion();
    for (i = 0; i < nD; i++) wqT.push(new THREE.Quaternion());
    var lfo = S.idx.LeftFoot, rfo = S.idx.RightFoot, srcFootGround = Math.min(footMin.LeftFoot === undefined ? 0 : footMin.LeftFoot, footMin.RightFoot === undefined ? 0 : footMin.RightFoot);
    for (f = 0; f < nF; f++) {
      var ts = f / fps; times[f] = ts; smp.at(ts * (clip.duration / dur), slq, shp); fkInto(S, slq, shp, swp, swq, sws);
      // target world rotations
      for (i = 0; i < nD; i++) { j = map[i]; var nm = D.names[i];
        if (j < 0) { wqT[i].copy(D.par[i] >= 0 ? wqT[D.par[i]] : D.q0).multiply(D.rq[i]); continue; }
        if (FOOT[nm] && footRef[opts.mirror ? mirrorName(nm) : nm]) dq.multiplyQuaternions(swq[j], footRef[opts.mirror ? mirrorName(nm) : nm]); else dq.multiplyQuaternions(swq[j], invRestS[j]);
        if (opts.mirror) mq(dq);
        if (FOOT[nm]) wqT[i].multiplyQuaternions(dq, D.wq[i]); else wqT[i].multiplyQuaternions(dq, corr[i]);
      }
      if (yawArr) { yQ.multiplyQuaternions(swq[0], hipRestInv); yV.set(0, 0, 1).applyQuaternion(yQ); var hy = Math.atan2(yV.x, yV.z) * (opts.mirror ? -1 : 1); yawArr[f] = hy; yQ.setFromAxisAngle(yAx, -hy); for (i = 0; i < nD; i++) wqT[i].premultiply(yQ); }
      if (opts.arms) armAbduct(D, wqT, opts.arms);
      // locals
      for (i = 0; i < nD; i++) { var pw = D.par[i] >= 0 ? wqT[D.par[i]] : D.q0; ip.copy(pw).invert(); dlq[i].multiplyQuaternions(ip, wqT[i]); }
      if (opts.arms) armRelax(D, dlq, opts.arms);
      if (opts.arms) armFinish(D, S, dlq, hp, swq, map, opts, dwp, dwq, dws);
      // hips: the source hips offset from its rest, scaled to the target's leg length, in the target's root frame
      tmpV.subVectors(swp[0], S.wp[0]); tmpV.y = (swp[0].y - srcFootGround) - (S.wp[0].y - S.footY); if (opts.mirror) tmpV.x = -tmpV.x; tmpV.multiplyScalar(k); if (yawArr) tmpV.applyQuaternion(yQ);   // height over the clip's own ground, not over the rest pose's (a generator rest can stand higher)
      tmpV.add(D.wp[0]).sub(D.p0).applyQuaternion(ip.copy(D.q0).invert()).divideScalar(D.s0); hp.copy(tmpV);
      if (opts.plant && OPT.ik) plantFeet(D, dlq, hp, dwp, dwq, dws, function (side) { var sj = side === "Left" ? (opts.mirror ? rfo : lfo) : (opts.mirror ? lfo : rfo); if (sj === undefined) return 0; var gm = footMin[(sj === lfo ? "Left" : "Right") + "Foot"]; return (swp[sj].y - (gm === undefined ? srcFootGround : gm)) * k; });
      for (i = 0; i < nD; i++) { var o = Qo[i]; o[f * 4] = dlq[i].x; o[f * 4 + 1] = dlq[i].y; o[f * 4 + 2] = dlq[i].z; o[f * 4 + 3] = dlq[i].w; }
      Po[f * 3] = hp.x; Po[f * 3 + 1] = hp.y; Po[f * 3 + 2] = hp.z;
    }
    // keep quaternion sign continuity (no flips between keys)
    for (i = 0; i < nD; i++) { var a = Qo[i]; for (f = 1; f < nF; f++) { var d = a[f * 4] * a[f * 4 - 4] + a[f * 4 + 1] * a[f * 4 - 3] + a[f * 4 + 2] * a[f * 4 - 2] + a[f * 4 + 3] * a[f * 4 - 1]; if (d < 0) for (var c = 0; c < 4; c++) a[f * 4 + c] = -a[f * 4 + c]; } }
    var tracks = []; for (i = 0; i < nD; i++) tracks.push(new THREE.QuaternionKeyframeTrack(D.names[i] + ".quaternion", times, Qo[i]));
    tracks.push(new THREE.VectorKeyframeTrack(D.names[0] + ".position", times, Po));
    var out = new THREE.AnimationClip((opts.name || clip.name) + (opts.mirror ? "_m" : ""), (nF - 1) / fps, tracks);
    out.userData = { frames: { Q: Qo, P: Po, n: nF, fps: fps }, rig: D }; if (yawArr) { var ya = []; for (f = 0; f < nF; f++) ya.push(yawArr[f] - yawArr[0]); out.userData.yaw = ya; out.userData.yawTotal = ya[nF - 1]; }
    AN.n.rt++; AN.n.rtMs += performance.now() - t0; return out;
  }
  AN.retarget = function (clip, srcRoot, dstRoot, opts) { try { return retarget(clip, srcRoot, dstRoot, opts); } catch (e) { note("retarget", e); return null; } };
  // ───────── arm naturalisation (R19 round 2) ─────────
  // Mocap retargeted from a rig whose arms rest in an A-pose keeps a little of that A-pose, straight elbows and flapping
  // wrists. Three fixes, baked into every retargeted clip: the upper arm is pulled in toward the body past a maximum
  // abduction (the forearm and hand follow); the elbow keeps a minimum flexion about its anatomical hinge; the wrist eases
  // toward its neutral (rest) angle on the forearm, which also takes the twist off the wrist (no candy-wrapper skin, there are
  // no twist bones).
  function armInfo(D) {
    if (D.arm !== undefined) return D.arm; var THREE = T3(); var out = {};
    ["Left", "Right"].forEach(function (sd) { var a = D.idx[sd + "Arm"], fo = D.idx[sd + "ForeArm"], h = D.idx[sd + "Hand"]; if (a === undefined || fo === undefined || h === undefined) return;
      var u = new THREE.Vector3().subVectors(D.wp[fo], D.wp[a]).normalize(); var hw = new THREE.Vector3().crossVectors(u, new THREE.Vector3(0, 0, 1)); if (hw.lengthSq() < 1e-6) return; hw.normalize();
      out[sd] = { a: a, fo: fo, h: h, hinge: hw.applyQuaternion(D.wq[a].clone().invert()), u: D.rp[fo].clone().normalize(), v: D.rp[h].clone().normalize(), side: sd === "Left" ? 1 : -1 }; });
    D.arm = out; return out;
  }
  var AV = null;
  function armAbduct(D, wq, o) {
    var THREE = T3(); var A = armInfo(D); if (!AV) AV = { d: new THREE.Vector3(), z: new THREE.Vector3(0, 0, 1), q: new THREE.Quaternion() }; var maxA = o.abd === undefined ? 0.16 : o.abd;
    for (var sd in A) { var X = A[sd]; AV.d.copy(D.rp[X.fo]).normalize().applyQuaternion(wq[X.a]); var lat = Math.atan2(AV.d.x * X.side, -AV.d.y); if (lat <= maxA || AV.d.y > -0.2) continue;
      AV.q.setFromAxisAngle(AV.z, -(lat - maxA) * X.side); wq[X.a].premultiply(AV.q); wq[X.fo].premultiply(AV.q); wq[X.h].premultiply(AV.q); }
  }
  var AR = null;
  function armRelax(D, lq, o) {
    var THREE = T3(); var A = armInfo(D); if (!AR) AR = { v: new THREE.Vector3(), c: new THREE.Vector3(), q: new THREE.Quaternion() };
    var phiMin = o.elbow === undefined ? 0.3 : o.elbow, wr = o.wrist === undefined ? 0.5 : o.wrist;
    for (var sd in A) { var X = A[sd];
      AR.v.copy(X.v).applyQuaternion(lq[X.fo]); var phi = Math.atan2(AR.c.crossVectors(X.u, AR.v).dot(X.hinge), X.u.dot(AR.v));
      if (phi < phiMin) { AR.q.setFromAxisAngle(X.hinge, phiMin - phi); lq[X.fo].premultiply(AR.q).normalize(); }
      if (wr > 0) { var ri = AR.ri || (AR.ri = new THREE.Quaternion()); ri.copy(D.rq[X.h]).invert(); var rel = AR.rel || (AR.rel = new THREE.Quaternion()); rel.multiplyQuaternions(ri, lq[X.h]);
        var ax = X.ha || (X.ha = D.rp[X.h].clone().normalize().applyQuaternion(D.rq[X.h].clone().invert()));   // the hand's length axis in its own frame
        var tw = AR.tw || (AR.tw = new THREE.Quaternion()); var pr = rel.x * ax.x + rel.y * ax.y + rel.z * ax.z; tw.set(ax.x * pr, ax.y * pr, ax.z * pr, rel.w); if (tw.lengthSq() < 1e-9) tw.identity(); else tw.normalize();
        var sw = AR.sw || (AR.sw = new THREE.Quaternion()); sw.multiplyQuaternions(rel, tw.clone().invert()); sw.slerp(AR.id || (AR.id = new THREE.Quaternion()), wr); lq[X.h].copy(D.rq[X.h]).multiply(sw).multiply(tw).normalize(); } }
  }
  AN.armInfo = armInfo;
  // After the arm fixes: (1) the palm faces the way the mocap's palm faced (the target rig's hand roll in the rest pose can
  // differ, which turned some partners' palms forward into a cupped hand): the hand turns about its length axis, half of it
  // given to the forearm (no twist bones, so the wrist skin is spared); (2) the hand never sinks into the thigh: if the wrist
  // area comes within the thigh's radius, the upper arm swings out about the body's forward axis until it clears.
  var AF = null;
  function armFinish(D, S, lq, hp, swq, map, opts, wp, wq, ws) {
    var THREE = T3(); if (!AF) AF = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), q: new THREE.Quaternion(), r: new THREE.Quaternion(), z: new THREE.Vector3(0, 0, 1), m: new THREE.Vector3() };
    var A = armInfo(D); fkInto(D, lq, hp, wp, wq, ws); var pS = opts.palmS, pT = opts.palmT;
    for (var sd in A) { var X = A[sd];
      if (pS && pT && pS[sd] && pT[sd]) { var js = S.idx[opts.mirror ? mirrorName(sd + "Hand") : sd + "Hand"];
        if (js !== undefined) {
          if (!X.nT) X.nT = pT[sd].n.clone().applyQuaternion(D.wq[X.h].clone().invert());
          var srcN = (opts.mirror ? pS[mirrorName(sd)] : pS[sd]); var nS = srcN.n.clone().applyQuaternion(S.wq[js].clone().invert());
          AF.a.copy(nS).applyQuaternion(swq[js]); if (opts.mirror) AF.a.x = -AF.a.x;   // the mocap palm, in the world
          AF.b.copy(X.nT).applyQuaternion(wq[X.h]);                                    // this rig's palm now
          AF.c.subVectors(wp[X.h], wp[X.fo]).normalize();                             // the forearm axis
          AF.a.addScaledVector(AF.c, -AF.a.dot(AF.c)); AF.b.addScaledVector(AF.c, -AF.b.dot(AF.c));
          if (AF.a.lengthSq() > 1e-4 && AF.b.lengthSq() > 1e-4) { AF.a.normalize(); AF.b.normalize(); var ang = Math.atan2(AF.d.crossVectors(AF.b, AF.a).dot(AF.c), AF.b.dot(AF.a));
            AF.q.setFromAxisAngle(AF.c, ang * 0.5);   // half on the forearm, half on the hand
            var pf = D.par[X.fo] >= 0 ? wq[D.par[X.fo]] : D.q0; var wF = AF.r.copy(AF.q).multiply(wq[X.fo]); lq[X.fo].copy(pf).invert().multiply(wF).normalize();
            var wH = AF.q.clone().multiply(AF.q).multiply(wq[X.h]); var wFnew = wF.clone(); lq[X.h].copy(wFnew).invert().multiply(wH).normalize(); } } }
    }
    // thigh clearance (both sides, after the twists)
    fkInto(D, lq, hp, wp, wq, ws);
    for (sd in A) { X = A[sd]; var ul = D.idx[sd + "UpLeg"], lg = D.idx[sd + "Leg"]; if (ul === undefined || lg === undefined) continue;
      AF.m.subVectors(wp[X.h], wp[X.fo]).multiplyScalar(0.45).add(wp[X.h]);   // a point in the palm
      AF.a.copy(wp[ul]); AF.b.copy(wp[lg]); AF.d.subVectors(AF.b, AF.a); var t = Math.max(0, Math.min(1, AF.c.subVectors(AF.m, AF.a).dot(AF.d) / Math.max(1e-6, AF.d.lengthSq()))); AF.c.copy(AF.a).addScaledVector(AF.d, t);
      var dx = AF.m.x - AF.c.x, dz = AF.m.z - AF.c.z, dist = Math.hypot(dx, dz), need = (D.thighR || (D.thighR = 0.08 * D.legLen + 0.06)); if (dist >= need) continue;
      var armLen = wp[X.a].distanceTo(AF.m); var ang2 = Math.min(0.35, (need - dist) / Math.max(0.2, armLen) + 0.01);
      AF.q.setFromAxisAngle(AF.z, ang2 * X.side); var pa = D.par[X.a] >= 0 ? wq[D.par[X.a]] : D.q0; var wA = AF.r.copy(AF.q).multiply(wq[X.a]); lq[X.a].copy(pa).invert().multiply(wA).normalize(); }
  }
  // ───────── relaxed hands (R19 round 2, v2 after review) ─────────
  // The rigs have no finger bones and the generator sculpted the hands open and flat. Each hand's bind geometry is posed once at
  // load into a relaxed hanging hand: the fingers are found as connected pieces of the mesh past the knuckle line, each one bends
  // toward the palm along its own arc (index about 34 degrees at the tip, pinky about 55: progressively more toward the little
  // finger, so the palm stays about a third open), the fingers fan out a little so the gaps stay, the thumb is curled only
  // slightly and rests alongside the index. Every vertex moves with the finger piece it belongs to (one weight and one bend per
  // piece), so nothing can pull away from its finger. Normals turn with the bend. The geometry is shared, so every clone and
  // every pose gets it; no new bone, program or draw.
  var HAND_CURL = flag("animhand", 1) === 0 ? 0 : 1, HAND_SIGN = flag("animhsign", 0) === 2 ? -1 : flag("animhsign", 0) === 1 ? 1 : 0;
  var HC = { idx: 0.34, pinky: 0.72, thumb: 0.14, thumbIn: 0.12, fan: 0.08 };   // radians at the finger tips; thumb adduction; fan spread
  AN.HC = HC;
  function bendHands(root, tag) {
    if (!HAND_CURL || !root) return 0; var THREE = T3(); var meshes = []; root.updateMatrixWorld(true);
    root.traverse(function (o) { if (o.isSkinnedMesh && o.skeleton && o.geometry && o.geometry.attributes.skinIndex && !o.geometry.userData.__handBent) meshes.push(o); }); if (!meshes.length) return 0;
    var done = 0;
    ["Left", "Right"].forEach(function (sd) {
      var ref = null, ih = -1, ie = -1;
      for (var m = 0; m < meshes.length && !ref; m++) { var bs = meshes[m].skeleton.bones; ih = ie = -1; for (var b = 0; b < bs.length; b++) { if (bs[b].name === sd + "Hand") ih = b; if (bs[b].name === sd + "ForeArm") ie = b; } if (ih >= 0 && ie >= 0) ref = meshes[m]; }
      if (!ref) return;
      var W = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(ref.skeleton.boneInverses[ih]).invert()), E = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(ref.skeleton.boneInverses[ie]).invert());
      var f = new THREE.Vector3().subVectors(W, E).normalize(), v = new THREE.Vector3(), d = new THREE.Vector3();
      var handW = function (mesh, i) { var g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, bs2 = mesh.skeleton.bones, w = 0; for (var c = 0; c < 4; c++) { var j = si.getComponent(i, c); if (bs2[j] && bs2[j].name === sd + "Hand") w += sw.getComponent(i, c); } return w; };
      // every vertex weighted to the hand, in bind space
      var V = []; meshes.forEach(function (mesh, mi) { var P = mesh.geometry.attributes.position; for (var i = 0; i < P.count; i++) { var w = handW(mesh, i); if (w < 0.2) continue; v.fromBufferAttribute(P, i).applyMatrix4(mesh.bindMatrix); V.push({ m: mi, i: i, w: w, p: v.clone() }); } });
      var core = V.filter(function (q) { return q.w >= 0.6; }); if (core.length < 30) return;
      var c0 = new THREE.Vector3(); core.forEach(function (q) { c0.add(q.p); }); c0.multiplyScalar(1 / core.length);
      var a = new THREE.Vector3(0, 1, 0); if (Math.abs(a.dot(f)) > 0.9) a.set(1, 0, 0); a.addScaledVector(f, -a.dot(f)).normalize(); var bb = new THREE.Vector3().crossVectors(f, a);
      var xx = 0, xy = 0, yy = 0, L = 0; core.forEach(function (q) { d.subVectors(q.p, c0); var x = d.dot(a), y = d.dot(bb); xx += x * x; xy += x * y; yy += y * y; L = Math.max(L, d.subVectors(q.p, W).dot(f)); });
      var th = 0.5 * Math.atan2(2 * xy, xx - yy); var l = a.clone().multiplyScalar(Math.cos(th)).addScaledVector(bb, Math.sin(th)).normalize(); var n = new THREE.Vector3().crossVectors(f, l).normalize();
      var sgn = HAND_SIGN || (n.y >= 0 ? 1 : -1); n.multiplyScalar(sgn);   // n: the back of the hand (the A-pose palms face down)
      var sK = L * 0.5, Lf = Math.max(0.03, L - sK); var K = W.clone().addScaledVector(f, sK);
      V.forEach(function (q) { d.subVectors(q.p, K); q.u = d.dot(f); q.wd = d.dot(l); q.h = d.dot(n); });
      // the thumb side: the hand reaches farther sideways on the thumb's side (between the wrist and the finger tips)
      var mxP = 0, mxN = 0; V.forEach(function (q) { if (q.u > -0.6 * sK && q.u < 0.6 * Lf) { mxP = Math.max(mxP, q.wd); mxN = Math.min(mxN, q.wd); } }); var tS = mxP >= -mxN ? 1 : -1, wmax = Math.max(mxP, -mxN, 0.01);
      // finger pieces: the mesh past a cut a little beyond the knuckles, split into connected parts (positions welded at 0.2 mm)
      var uCut = 0.16 * Lf, key = {}, parent = [], gidOf = {}; var find = function (x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      V.forEach(function (q, k) { if (q.u <= uCut) return; var kk = Math.round(q.p.x * 5000) + "," + Math.round(q.p.y * 5000) + "," + Math.round(q.p.z * 5000); if (key[kk] === undefined) { key[kk] = parent.length; parent.push(parent.length); } q.g = key[kk]; gidOf[q.m + ":" + q.i] = q.g; });
      meshes.forEach(function (mesh, mi) { var ix = mesh.geometry.index; if (!ix) return; for (var t = 0; t < ix.count; t += 3) { var A = gidOf[mi + ":" + ix.getX(t)], B = gidOf[mi + ":" + ix.getX(t + 1)], C = gidOf[mi + ":" + ix.getX(t + 2)]; if (A === undefined || B === undefined || C === undefined) continue; var ra = find(A), rb = find(B), rc = find(C); parent[rb] = ra; parent[find(rc)] = ra; } });
      var comps = {}; V.forEach(function (q) { if (q.g === undefined) return; var r = find(q.g); q.c = r; var C = comps[r] || (comps[r] = { n: 0, wd: 0, umax: -1, cen: new THREE.Vector3(), w: 0 }); C.n++; C.wd += q.wd; C.umax = Math.max(C.umax, q.u); C.cen.add(q.p); C.w = Math.max(C.w, q.w); });
      var list = Object.keys(comps).map(function (k) { var C = comps[k]; C.k = k; C.wd /= C.n; C.cen.multiplyScalar(1 / C.n); return C; });
      var big = list.filter(function (C) { return C.n >= 12; }); if (!big.length) return;
      // stray small pieces (a nail shell, a split tip) join the nearest finger
      list.forEach(function (C) { if (C.n >= 12) return; var best = null, bd = 1e9; big.forEach(function (B2) { var dd = B2.cen.distanceTo(C.cen); if (dd < bd) { bd = dd; best = B2; } }); C.join = best; });
      big.sort(function (x, y) { return (x.wd - y.wd) * tS; });   // from the pinky side to the thumb side
      var thumb = null; if (big.length >= 5) thumb = big[big.length - 1]; else if (big.length >= 2) { var lastC = big[big.length - 1], others = big.slice(0, -1).map(function (C) { return C.umax; }).sort(function (x, y) { return x - y; }); if (lastC.umax < 0.75 * others[others.length >> 1]) thumb = lastC; }
      var fingers = big.filter(function (C) { return C !== thumb; }); var fw = []; V.forEach(function (q) { if (q.u > 0.3 * Lf && !(thumb && q.c !== undefined && (comps[q.c] === thumb || comps[q.c].join === thumb))) fw.push(q.wd); }); fw.sort(function (x, y) { return x - y; });
      var wLo = fw.length ? fw[Math.floor(fw.length * 0.08)] : -wmax * 0.6, wHi = fw.length ? fw[Math.floor(fw.length * 0.92)] : wmax * 0.6; var wIx = tS > 0 ? wHi : wLo, wPk = tS > 0 ? wLo : wHi;
      var rankOf = function (wd) { return Math.max(0, Math.min(1, (wd - wIx) / ((wPk - wIx) || 1e-6))); };
      fingers.forEach(function (C) { C.rank = rankOf(C.wd); });
      // the thumb's root: on the thumb side between the wrist and the knuckles
      var thP = K.clone().addScaledVector(f, -0.45 * sK).addScaledVector(l, tS * wmax * 0.55);
      var q4 = new THREE.Quaternion(), qa = new THREE.Quaternion(), out = new THREE.Vector3(), rel = new THREE.Vector3(), fa = new THREE.Vector3(), nv = new THREE.Vector3(), n2 = new THREE.Vector3();
      var byMesh = meshes.map(function () { return []; }); V.forEach(function (q) { byMesh[q.m].push(q); });
      meshes.forEach(function (mesh, mi) {
        var list2 = byMesh[mi]; if (!list2.length) return; var g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal, inv = new THREE.Matrix4().copy(mesh.bindMatrix).invert(), nm = new THREE.Matrix3().setFromMatrix4(mesh.bindMatrix), nmi = new THREE.Matrix3().copy(nm).invert(); var hit = 0;
        if (!g.userData.__handOrig) { g.userData.__handOrig = { P: P.array.slice(), N: N ? N.array.slice() : null }; HANDGEO.push(g); }
        list2.forEach(function (q) {
          var C = q.c !== undefined ? comps[q.c] : null; if (C && C.join) C = C.join; var isThumb = C ? C === thumb : (thumb && q.u > -0.45 * sK && q.wd * tS > 0.55 * wmax);
          // one weight per finger piece (no vertex lags behind its neighbours); a smooth weight below the cut
          var ww = C ? Math.min(1, Math.max(0, (C.w - 0.2) / 0.45)) : Math.min(1, Math.max(0, (q.w - 0.2) / 0.45)); if (ww <= 0) return;
          rel.copy(q.p); var turn = null;
          if (isThumb) {
            // the thumb: in toward the index about its root, a light curl past the knuckle line
            var tw = smooth((q.p.clone().sub(thP).dot(f) + 0.01) / (0.5 * sK)); qa.setFromAxisAngle(n, -tS * HC.thumbIn * tw); rel.sub(thP).applyQuaternion(qa).add(thP); turn = qa.clone();
            if (q.u > 0) { var kt = HC.thumb / Lf, at = Math.min(q.u, Lf * 1.1) * kt, Rt = 1 / kt; d.subVectors(rel, K); var hh = d.dot(n), u2 = d.dot(f), w2 = d.dot(l); var rr = Rt + hh; fa.copy(f).multiplyScalar(Math.cos(at)).addScaledVector(n, -Math.sin(at)); out.copy(K).addScaledVector(n, rr * Math.cos(at) - Rt).addScaledVector(f, rr * Math.sin(at)).addScaledVector(l, w2).addScaledVector(fa, u2 - Math.min(u2, Lf * 1.1)); rel.copy(out); q4.setFromUnitVectors(f, fa); turn.premultiply(q4); }
          } else if (q.u > 0) {
            var rk = rankOf(q.wd); var A = HC.idx + (HC.pinky - HC.idx) * rk, kap = A / Lf, R = 1 / kap;
            var uc = Math.min(q.u, Lf * 1.15), an = uc * kap, rr2 = R + q.h; fa.copy(f).multiplyScalar(Math.cos(an)).addScaledVector(n, -Math.sin(an));
            out.copy(K).addScaledVector(n, rr2 * Math.cos(an) - R).addScaledVector(f, rr2 * Math.sin(an)).addScaledVector(l, q.wd).addScaledVector(fa, q.u - uc);
            // a slight fan: the fingers open sideways about the knuckles, so they never press together
            var fan = HC.fan * (rk - 0.5) * 2 * -tS * smooth(q.u / (0.35 * Lf)); qa.setFromAxisAngle(n, fan); out.sub(K).applyQuaternion(qa).add(K);
            rel.copy(out); q4.setFromUnitVectors(f, fa); turn = qa.clone().multiply(q4);
          } else return;
          v.copy(q.p).lerp(rel, ww).applyMatrix4(inv); P.setXYZ(q.i, v.x, v.y, v.z);
          if (N && turn) { nv.fromBufferAttribute(N, q.i).applyMatrix3(nm).normalize(); n2.copy(nv).applyQuaternion(turn); nv.lerp(n2, ww).normalize().applyMatrix3(nmi).normalize(); N.setXYZ(q.i, nv.x, nv.y, nv.z); }
          hit++;
        });
        if (hit) { P.needsUpdate = true; if (N) N.needsUpdate = true; } done += hit;
      });
      if (tag) { LIB.palm = LIB.palm || {}; var PK = LIB.palm[tag] || (LIB.palm[tag] = {}); if (!PK[sd]) PK[sd] = { n: n.clone().negate(), f: f.clone() }; }
      LIB.hands = LIB.hands || {}; LIB.hands[(tag || "rig") + ":" + sd] = { verts: V.length, len: +L.toFixed(3), pieces: big.length, small: list.length - big.length, thumb: !!thumb, fingers: fingers.length, tS: tS };
    });
    meshes.forEach(function (mesh) { mesh.geometry.userData.__handBent = true; }); AN.n.handVerts = (AN.n.handVerts || 0) + done; return done;
  }
  AN.bendHands = bendHands;
  var HANDGEO = [];
  // A/B: hands(false) puts the sculpted open hands back on every bent geometry, hands(true) the relaxed ones
  AN.hands = function (on) { HANDGEO.forEach(function (g) { var U = g.userData, P = g.attributes.position, N = g.attributes.normal; if (!U.__handBentArr) U.__handBentArr = { P: P.array.slice(), N: N ? N.array.slice() : null }; var src = on ? U.__handBentArr : U.__handOrig; P.array.set(src.P); P.needsUpdate = true; if (N && src.N) { N.array.set(src.N); N.needsUpdate = true; } }); return HANDGEO.length; };
  // two-bone leg IK: each foot to its planted height (source foot height above its ground, scaled), knees keep their bend plane;
  // the hips come down if a foot cannot be reached
  var IKV = null;
  function plantFeet(D, lq, hp, wp, wq, ws, wantY) {
    var THREE = T3(); if (!IKV) IKV = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), t: new THREE.Vector3(), n: new THREE.Vector3(), d: new THREE.Vector3(), e: new THREE.Vector3(), q: new THREE.Quaternion(), r: new THREE.Quaternion(), fw: new THREE.Quaternion() };
    var V = IKV; var sides = ["Left", "Right"];
    for (var pass = 0; pass < 2; pass++) {
      fkInto(D, lq, hp, wp, wq, ws); var drop = 0;
      if (pass === 0) { for (var s = 0; s < 2; s++) { var A = D.idx[sides[s] + "UpLeg"], F = D.idx[sides[s] + "Foot"]; if (A === undefined || F === undefined) continue; var ty = D.footY + Math.max(0, wantY(sides[s])); var dx = wp[F].x - wp[A].x, dz = wp[F].z - wp[A].z, dy = ty - wp[A].y; var need = Math.sqrt(dx * dx + dy * dy + dz * dz) - D.legLen * 0.995; if (need > drop) drop = need; }
        if (drop > 0) { V.d.set(0, -drop, 0).applyQuaternion(V.q.copy(D.q0).invert()).divideScalar(D.s0); hp.add(V.d); continue; } }
      for (s = 0; s < 2; s++) {
        var ia = D.idx[sides[s] + "UpLeg"], ib = D.idx[sides[s] + "Leg"], ic = D.idx[sides[s] + "Foot"]; if (ia === undefined || ib === undefined || ic === undefined) continue;
        fkInto(D, lq, hp, wp, wq, ws); V.fw.copy(wq[ic]);
        V.a.copy(wp[ia]); V.b.copy(wp[ib]); V.c.copy(wp[ic]); V.t.set(V.c.x, D.footY + Math.max(0, wantY(sides[s])), V.c.z);
        var l1 = V.a.distanceTo(V.b), l2 = V.b.distanceTo(V.c); var d = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min(l1 + l2 - 1e-4, V.a.distanceTo(V.t)));
        V.d.subVectors(V.t, V.a).normalize(); V.n.subVectors(V.b, V.a).cross(V.e.subVectors(V.c, V.a)); if (V.n.lengthSq() < 1e-10) V.n.set(1, 0, 0); V.n.normalize();
        var ang = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
        // knee: rotate the hip-to-target direction about the bend normal, on the side the knee already bends to
        V.e.copy(V.d).applyAxisAngle(V.n, ang); var kn1 = V.e.clone().multiplyScalar(l1).add(V.a); V.e.copy(V.d).applyAxisAngle(V.n, -ang); var kn2 = V.e.clone().multiplyScalar(l1).add(V.a);
        var knee = kn1.distanceTo(V.b) < kn2.distanceTo(V.b) ? kn1 : kn2;
        // swing the thigh, then the shin, as world rotations converted to locals
        V.q.setFromUnitVectors(V.e.subVectors(V.b, V.a).normalize(), V.d.subVectors(knee, V.a).normalize()); var pa = D.par[ia] >= 0 ? wq[D.par[ia]] : D.q0;
        var wA = V.r.copy(V.q).multiply(wq[ia]); lq[ia].copy(pa).invert().multiply(wA).normalize();
        fkInto(D, lq, hp, wp, wq, ws);
        V.q.setFromUnitVectors(V.e.subVectors(wp[ic], wp[ib]).normalize(), V.d.subVectors(V.t, wp[ib]).normalize()); var wB = V.r.copy(V.q).multiply(wq[ib]); lq[ib].copy(wq[ia]).invert().multiply(wB).normalize();
        fkInto(D, lq, hp, wp, wq, ws); lq[ic].copy(wq[ib]).invert().multiply(V.fw).normalize();   // the foot keeps its planted world rotation
      }
      break;
    }
  }
  // measures on a rig: the lowest foot height over the cycle (ground offset) and the stance foot speed (ground speed at rate 1)
  function measure(clip, root) {
    var THREE = T3(); var R = rigOf(root); if (!R) return null; var smp = samplerOf(clip, R); var lq = R.rq.map(function (q) { return q.clone(); }), hp = new THREE.Vector3(), wp = [], wq = [], ws = [];
    var n = Math.max(24, Math.round(clip.duration * 120)), L = R.idx.LeftFoot, Rr = R.idx.RightFoot, ys = { l: [], r: [] }, zs = { l: [], r: [] }, minY = 1e9;
    for (var f = 0; f < n; f++) { var t = f / (n - 1) * clip.duration; smp.at(t, lq, hp); fkInto(R, lq, hp, wp, wq, ws); var yl = wp[L].y, yr = wp[Rr].y; ys.l.push(yl); ys.r.push(yr); zs.l.push(wp[L].z - wp[0].z); zs.r.push(wp[Rr].z - wp[0].z); minY = Math.min(minY, yl, yr); }
    var dt = clip.duration / (n - 1), sp = [], ph = 0, lowL = 1e9;
    ["l", "r"].forEach(function (s) { var y = ys[s], z = zs[s], m = Math.min.apply(null, y); for (var f = 1; f < n - 1; f++) if (y[f] < m + 0.02) sp.push(-(z[f + 1] - z[f - 1]) / (2 * dt)); });
    for (f = 0; f < n; f++) if (ys.l[f] < lowL) { lowL = ys.l[f]; ph = f / (n - 1); }
    sp.sort(function (a, b) { return a - b; }); var v = sp.length ? sp[sp.length >> 1] : 0;
    // cycles: left foot forward crossings
    var cyc = 0; for (f = 1; f < n; f++) if ((zs.l[f] - zs.r[f]) > 0 && (zs.l[f - 1] - zs.r[f - 1]) <= 0) cyc++;
    return { off: R.footY - minY, v: v, phase: ph, cycles: Math.max(1, cyc), dur: clip.duration };
  }
  AN.measure = measure;
  // a long composed idle for a glTF rig: the variants in a shuffled order, pose-matched cuts and crossfades, a seamless loop
  function composeIdle(vars, secs, seed, fps) {
    var THREE = T3(); var rnd = mulberry(seed); var R = vars[0].userData.rig; var nb = R.names.length; fps = fps || 24; var FADE = 1.4;
    var nF = Math.round(secs * fps), nL = Math.round(FADE * fps), nT = nF + nL;
    var Q = []; for (var i = 0; i < nb; i++) Q.push(new Float32Array(nT * 4)); var P = new Float32Array(nT * 3);
    // segments: a variant from an entry time for 5 to 12 s; the next one enters at the pose closest to where this one leaves
    var segs = [], t = 0, cur = (rnd() * vars.length) | 0, ct = rnd() * 2;
    while (t < secs + FADE + 2) { var V = vars[cur].userData.frames, d = V.n / V.fps; var len = Math.min(d - ct - FADE - 0.2, 5 + rnd() * 7); if (len < 2) { ct = 0; len = Math.min(d - FADE - 0.2, 6); } segs.push({ v: cur, t0: ct, s: t, len: len }); t += len;
      var nx = (cur + 1 + ((rnd() * (vars.length - 1)) | 0)) % vars.length; ct = bestEntry(vars[cur], ct + len, vars[nx]); cur = nx; }
    var qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    for (var f = 0; f < nT; f++) {
      var tt = f / fps, si = 0; while (si < segs.length - 1 && segs[si + 1].s <= tt) si++;
      var sA = segs[si], into = tt - sA.s, pv = si > 0 ? segs[si - 1] : null, w = pv && into < FADE ? smooth(into / FADE) : 1;
      for (i = 0; i <= nb; i++) {
        sampleFrame(vars[sA.v], sA.t0 + into, i, qa, P, f, w, true);
        if (w < 1) sampleFrame(vars[pv.v], pv.t0 + pv.len + into, i, qb, P, f, 1 - w, false);
        if (i < nb) { if (w < 1) { if (qa.dot(qb) < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w); qb.slerp(qa, w); qa.copy(qb); } qa.toArray(Q[i], f * 4); }
      }
    }
    // seamless loop: the overflow past the end blends into the first frames, so the last frame flows into frame 0
    for (f = 0; f < nL; f++) { w = smooth(f / nL); var o = nF + f; for (i = 0; i < nb; i++) { qa.fromArray(Q[i], o * 4); qb.fromArray(Q[i], f * 4); if (qa.dot(qb) < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w); qa.slerp(qb, w); qa.toArray(Q[i], f * 4); } for (var c = 0; c < 3; c++) P[f * 3 + c] = P[o * 3 + c] * (1 - w) + P[f * 3 + c] * w; }
    for (i = 0; i < nb; i++) { var a = Q[i] = Q[i].slice(0, nF * 4); for (f = 1; f < nF; f++) { var dd = a[f * 4] * a[f * 4 - 4] + a[f * 4 + 1] * a[f * 4 - 3] + a[f * 4 + 2] * a[f * 4 - 2] + a[f * 4 + 3] * a[f * 4 - 1]; if (dd < 0) for (c = 0; c < 4; c++) a[f * 4 + c] = -a[f * 4 + c]; } }
    P = P.slice(0, nF * 3);
    var times = new Float32Array(nF); for (f = 0; f < nF; f++) times[f] = f / fps;
    var tracks = []; for (i = 0; i < nb; i++) tracks.push(new THREE.QuaternionKeyframeTrack(R.names[i] + ".quaternion", times, Q[i])); tracks.push(new THREE.VectorKeyframeTrack(R.names[0] + ".position", times, P));
    var clip = new THREE.AnimationClip("idle", nF / fps, tracks); clip.userData = { frames: { Q: Q, P: P, n: nF, fps: fps }, rig: R }; return clip;
  }
  // one bone of a retargeted clip at time t (linear on the baked frames); i === bone count means the hips position (accumulated)
  function sampleFrame(clip, t, i, q, Pout, f, w, first) {
    var F = clip.userData.frames, n = F.n, x = Math.max(0, Math.min(n - 1.001, t * F.fps)), a = x | 0, u = x - a, b = Math.min(n - 1, a + 1);
    if (i < F.Q.length) { var A = F.Q[i]; var ax = A[a * 4], ay = A[a * 4 + 1], az = A[a * 4 + 2], aw = A[a * 4 + 3], bx = A[b * 4], by = A[b * 4 + 1], bz = A[b * 4 + 2], bw = A[b * 4 + 3]; if (ax * bx + ay * by + az * bz + aw * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; } q.set(ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u, aw + (bw - aw) * u).normalize(); return; }
    for (var c = 0; c < 3; c++) { var v = F.P[a * 3 + c] + (F.P[b * 3 + c] - F.P[a * 3 + c]) * u; Pout[f * 3 + c] = first ? v * w : Pout[f * 3 + c] + v * w; }
  }
  // pose matching: the time in `to` whose pose is closest to `from` at time tf (hips offset, thighs, shins, spine, upper arms)
  var KEYB = ["Hips", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg", "Spine01", "LeftArm", "RightArm"];
  function bestEntry(from, tf, to) {
    var Ff = from.userData.frames, Ft = to.userData.frames, R = from.userData.rig; var fa = Math.max(0, Math.min(Ff.n - 1, Math.round(tf * Ff.fps))); var best = 0, bd = 1e9; var lastOk = Ft.n - Math.round(7 * Ft.fps);
    for (var f = 0; f < Math.max(1, lastOk); f += 3) { var d = 0; for (var k = 0; k < KEYB.length; k++) { var i = R.idx[KEYB[k]]; if (i === undefined) continue; var A = Ff.Q[i], B = Ft.Q[i]; var dot = Math.abs(A[fa * 4] * B[f * 4] + A[fa * 4 + 1] * B[f * 4 + 1] + A[fa * 4 + 2] * B[f * 4 + 2] + A[fa * 4 + 3] * B[f * 4 + 3]); d += 1 - Math.min(1, dot); }
      var px = Ff.P[fa * 3] - Ft.P[f * 3], pz = Ff.P[fa * 3 + 2] - Ft.P[f * 3 + 2]; d += (px * px + pz * pz) * 0.0004; if (d < bd) { bd = d; best = f; } }
    return best / Ft.fps;
  }
  function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ───────── the library ─────────
  function rawLoader() { var THREE = T3(); try { if (AN._gl) return AN._gl(); } catch (e) {} try { return gltfLoader(); } catch (e) { return new THREE.GLTFLoader(); } }
  function loadLib() {
    if (LIB.p) return LIB.p; var q = "?v=" + (window.BUILD || "dev");
    LIB.p = Promise.all(Object.keys(LIB_FILES).map(function (k) { return new Promise(function (res) { var ld = rawLoader(); ld.__animRaw = true; ld.load(LIB_FILES[k] + q, function (gl) { var c = gl.animations && gl.animations[0]; if (c) { c.name = k; LIB.src[k] = { clip: c, root: gl.scene }; rigOf(gl.scene); } res(); }, undefined, function (e) { note("lib " + k, e); res(); }); }); }))
      .then(function () { LIB.ok = !!(LIB.src.idle3 && LIB.src.idle4 && LIB.src.idle7); return LIB.ok; });
    return LIB.p;
  }
  // per char body: idle variants and the walk on that body's rig, measured gaits (old jog / run kept, with ground offsets)
  function charSet(body) {
    if (LIB.char[body]) return LIB.char[body]; var C = (typeof CHAR !== "undefined") && CHAR[body]; if (!C || !LIB.ok) return null; var t0 = performance.now();
    var root = C.scene, set = { idles: [], gait: {}, body: body };
    IDLES.forEach(function (d) { var s = LIB.src[d[0]]; if (!s) return; var c = retarget(s.clip, s.root, root, { mirror: d[1], plant: true, name: d[0], fps: 30, arms: ARM_IDLE, palmS: srcPalm(d[0]), palmT: palmOf("char_" + body) }); if (c) { c.userData.w = body === "f" ? d[3] : d[2]; set.idles.push(c); } });
    if (LIB.src.walk2 || LIB.src.walkm) { var wsrc = (body === "f" && LIB.src.walkf) || LIB.src.walkm || LIB.src.walk2; var w = retarget(wsrc.clip, wsrc.root, root, { name: "walk", fps: 60, plant: true, arms: ARM_WALK, palmS: srcPalm(wsrc === LIB.src.walkf ? "walkf" : "walkm"), palmT: palmOf("char_" + body) }); if (w) set.gait.walk = { clip: w }; }
    if (LIB.src.turn) { set.turnL = retarget(LIB.src.turn.clip, LIB.src.turn.root, root, { name: "turnL", fps: 30, plant: true, arms: ARM_IDLE, stripYaw: true, palmS: srcPalm("turn"), palmT: palmOf("char_" + body) }); set.turnR = retarget(LIB.src.turn.clip, LIB.src.turn.root, root, { name: "turnR", fps: 30, mirror: true, plant: true, arms: ARM_IDLE, stripYaw: true, palmS: srcPalm("turn"), palmT: palmOf("char_" + body) }); }
    if (C.clips.jog) set.gait.jog = { clip: C.clips.jog }; if (C.clips.run) set.gait.run = { clip: C.clips.run };
    for (var g in set.gait) { var m = measure(set.gait[g].clip, root); if (!m) continue; var G = set.gait[g]; G.off = m.off * C.scale; G.v = Math.max(0.3, m.v * C.scale / m.cycles * m.cycles); G.tc = m.dur / m.cycles; G.cycles = m.cycles; G.ph = m.phase; }
    set.idles.forEach(function (c) { var m = measure(c, root); c.userData.off = m ? m.off * C.scale : 0; });
    try { bendHands(root, "char_" + body); if (C.measure && C.measure.geometry) bendHands(C.measure, null); } catch (e) { note("hands " + body, e); }
    set.ms = Math.round(performance.now() - t0); LIB.char[body] = set; return set;
  }
  AN.charSet = charSet;

  // ───────── per character controller (char rigs: the client's avatar() / buildRigged bodies) ─────────
  var GAITS = ["walk", "jog", "run"];
  var RANGE = { walk: [0.6, 1.6], jog: [0.72, 1.4], run: [0.8, 1.55] };
  var V3 = null, Qt = null;
  function initChar(g) {
    var u = g.userData; var set = charSet(u.body || "m"); if (!set) return null; var THREE = T3();
    var mixer = u.mixer, root = mixer.getRoot(); var S = { set: set, idle: [], gait: {}, sp: 0, ph: Math.random() * 4, yaw: g.rotation.y, yawRate: 0, acc: 0, lean: 0, pitch: 0, cur: -1, until: 0, nextCheck: 0, look: { y: 0, p: 0, ty: 0, tp: 0, t: 0 }, rnd: mulberry(((Math.random() * 1e9) | 0) ^ 0x51ED), ts: 0.93 + Math.random() * 0.12, shuffle: 0 };
    set.idles.forEach(function (c, i) { var a = mixer.clipAction(c, root); a.play(); a.setEffectiveWeight(0); a.time = Math.random() * c.duration * 0.5; S.idle.push({ a: a, w: 0, tw: 0, c: c }); });
    for (var k in set.gait) { var G = set.gait[k]; var a = mixer.clipAction(G.clip, root); a.play(); a.setEffectiveWeight(0); a.setEffectiveTimeScale(0); S.gait[k] = { a: a, w: 0, G: G }; }
    S.turn = { w: 0, acc: 0, quiet: 0 }; ['turnL', 'turnR'].forEach(function (tk) { var tc = set[tk]; if (!tc || !tc.userData.yawTotal) return; var ta = mixer.clipAction(tc, root); ta.play(); ta.setEffectiveWeight(0); ta.setEffectiveTimeScale(0); S.turn[tk] = { a: ta, c: tc, Y: Math.abs(tc.userData.yawTotal) }; });
    // the client's old clips: the old idle and walk stay at 0 (the old jog / run actions are reused when they share the clip)
    var A = u.acts; if (A.idle) A.idle.setEffectiveWeight(0); if (A.walk) A.walk.setEffectiveWeight(0);
    var bones = {}; root.traverse(function (o) { if (o.isBone) bones[o.name] = o; }); S.bones = bones; var RR = rigOf(CHAR[u.body || "m"].scene); S.restB = {}; S.legLen = RR ? RR.legLen * ((CHAR[u.body || "m"] || {}).scale || 1) : 0.85; if (RR) for (var bn in bones) { var ri = RR.idx[bn]; if (ri !== undefined) S.restB[bn] = RR.rq[ri].clone(); }
    S.mixer = mixer; try { bendHands(root, "clone_" + (u.body || "m")); } catch (e) { note("hands clone", e); }   // geometry the avatar kit rebuilt for this body (cached, so once)
    pickIdle(S, 0, true); u.an = S; AN.n.chars++; return S;
  }
  function pickIdle(S, now, first) {
    var L = S.idle; if (!L.length) return; var tot = 0, i; for (i = 0; i < L.length; i++) if (i !== S.cur) tot += L[i].c.userData.w || 0.2;
    var r = S.rnd() * tot, nx = 0; for (i = 0; i < L.length; i++) { if (i === S.cur) continue; r -= L[i].c.userData.w || 0.2; if (r <= 0) { nx = i; break; } }
    var prev = S.cur >= 0 ? L[S.cur] : null; var start = first ? S.rnd() * L[nx].c.duration * 0.55 : bestEntry(prev.c, prev.a.time, L[nx].c);
    L[nx].a.time = start; S.cur = nx; S.fade = 1.1 + S.rnd() * 0.5; var room = L[nx].c.duration - start - S.fade - 0.5; S.until = now + Math.max(2.5, Math.min(room, 5 + S.rnd() * 8)); AN.n.swaps++;
    for (i = 0; i < L.length; i++) L[i].tw = i === nx ? 1 : 0;
  }
  var _wp = null;
  AN.step = function (g, speed, dt) {
    var u = g.userData; if (!LIB.ok || !u.mixer || !u.acts) return false;
    if (AN.bypass) { var B0 = u.an; if (B0 && !B0.byp) { B0.byp = true; B0.idle.forEach(function (I) { I.a.setEffectiveWeight(0); }); for (var kb in B0.gait) B0.gait[kb].a.setEffectiveWeight(0); if (u.acts.jog) u.acts.jog.setEffectiveTimeScale(1); if (u.acts.run) u.acts.run.setEffectiveTimeScale(1); if (u.walk) { u.walk.rotation.set(0, 0, 0); } } return false; }   // A/B: the R18 path
    var S = u.an && u.an.mixer === u.mixer ? u.an : initChar(g); if (!S) return false; if (S.byp) { S.byp = false; if (u.acts.idle) u.acts.idle.setEffectiveWeight(0); } AN.n.steps++;
    if (((S.hk = (S.hk || 0) + 1) & 31) === 1) { try { bendHands(u.mixer.getRoot(), "kit_" + (u.body || "m")); } catch (e) {} }   // the avatar kit swaps in its own body geometry after the first frames (cached per look)
    var THREE = T3(); if (!V3) { V3 = new THREE.Vector3(); Qt = new THREE.Quaternion(); _wp = new THREE.Vector3(); }
    var A = u.acts, now = performance.now() / 1000; dt = Math.min(dt, 0.25);
    var air = !!u.air && !!A.jump, sw = !!u.swim && !!A.swim, gf = !!A.golf && u.golfT && u.golfT > performance.now(), st = !!u.sit && !!A.sit, pd = !!u.pedal;
    var dn = u.dance && u.dance.until > performance.now() && A[u.dance.clip] ? u.dance.clip : null; var P = S.pose; var posed = !!(P && P.tw > 0);
    var riding = pd || !!(u.cartG && u.cartG.visible) || !!(u.bikeG && u.bikeG.visible) || !!u.driveIK;
    // speed: eased so starts and stops blend through the walk instead of popping
    var sp0 = Math.max(0, speed || 0); var kS = 1 - Math.exp(-dt * (sp0 > S.sp ? 7 : 5)); S.acc += (((sp0 - S.sp) * kS / Math.max(dt, 1e-3)) - S.acc) * Math.min(1, dt * 5); S.sp += (sp0 - S.sp) * kS; var sp = S.sp;
    // turning: body yaw rate (for the lean and the turn-in-place shuffle)
    var dy = g.rotation.y - S.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); S.yaw = g.rotation.y; S.yawRate += (dy / Math.max(dt, 1e-3) - S.yawRate) * Math.min(1, dt * 8);
    var other = air || sw || gf || st || dn || posed || riding;
    var mov = other ? 0 : smooth((sp - 0.06) / 0.5);
    // gait blend by speed: walk below 1.9 m/s, jog 2.6 to 5.2, run from 7
    var wW = 1 - smooth((sp - 1.9) / 0.9), wR = smooth((sp - 5.2) / 1.8), wJ = Math.max(0, 1 - wW - wR);
    var gw = { walk: wW, jog: wJ, run: wR }; if (!S.gait.jog) { gw.walk += gw.jog; gw.jog = 0; } if (!S.gait.run) { gw.jog += gw.run; gw.run = 0; }
    // turn in place: a short shuffle (the walk at low weight) while the body turns on the spot
    var TT = S.turn, hasTurn = TT && TT.turnL && TT.turnR; var turning = !other && sp < 0.35 && Math.abs(S.yawRate) > 0.9;
    var turn = !hasTurn && turning ? Math.min(0.7, (Math.abs(S.yawRate) - 1.1) * 0.5) : 0; S.shuffle += (Math.max(0, turn) - S.shuffle) * Math.min(1, dt * 6);
    if (hasTurn) { if (turning) { TT.acc += dy; TT.quiet = 0; } else { TT.quiet += dt; if (TT.quiet > 0.35 && TT.w < 0.02) TT.acc = 0; }
      TT.w += ((turning ? Math.min(1, 0.55 + (Math.abs(S.yawRate) - 0.9) * 0.6) : 0) - TT.w) * Math.min(1, dt * (turning ? 7 : 4));
      var side = TT.acc >= 0 ? TT.turnL : TT.turnR, oth = TT.acc >= 0 ? TT.turnR : TT.turnL; var fr = (Math.abs(TT.acc) / side.Y) % 1; side.a.time = fr * side.c.duration; side.a.setEffectiveWeight(TT.w); oth.a.setEffectiveWeight(0); }
    // shared gait phase: cycles per second blended over the gaits, each at the rate that matches the ground speed
    var rate = 0, wsum = 0;
    for (var k in S.gait) { var Gk = S.gait[k], G = Gk.G, w = gw[k] || 0; var r = RANGE[k] || [0.7, 1.4]; var s = Math.max(r[0], Math.min(r[1], (sp > 0.05 ? sp : 0.8) / G.v)); Gk.s = s; rate += w * s / G.tc; wsum += w; }
    if (wsum > 0) rate /= wsum; if (S.shuffle > 0.02) rate = Math.max(rate * mov, Math.abs(S.yawRate) * 0.16);
    S.ph += rate * dt * (mov > 0.01 || S.shuffle > 0.02 ? 1 : 0);
    for (k in S.gait) { Gk = S.gait[k]; G = Gk.G; var cyc = G.cycles || 1; var x = ((S.ph + G.ph * cyc) % cyc + cyc) % cyc; Gk.a.time = x * G.tc; }
    // weights
    var kW = Math.min(1, dt * 7);
    var want = { idle: other ? 0 : 1 - mov, jump: air && !sw && !gf && !st && !posed ? 1 : 0, swim: sw && !posed ? 1 : 0, golf: gf && !posed ? 1 : 0, sit: st && !posed ? 1 : 0 };
    if (pd && !posed) want.idle = 1;   // on a bike the rider sits in the idle and pedalPose drives the legs (the client's rule)
    if (dn && !posed) { for (var n in want) want[n] = 0; }
    ["dance1", "dance2", "dance3", "dance4"].forEach(function (d) { if (A[d]) want[d] = dn === d && !posed ? 1 : 0; });
    var W = u.w || (u.w = {}); for (n in want) { W[n] = (W[n] || 0) + (want[n] - (W[n] || 0)) * Math.min(1, dt * (n === "golf" ? 30 : 9)); if (A[n] && n !== "idle") A[n].setEffectiveWeight(W[n]); }
    if (A.idle) A.idle.setEffectiveWeight(0); if (A.walk) A.walk.setEffectiveWeight(0); if (A.jog && !S.gait.jog) A.jog.setEffectiveWeight(0);
    if (A.jog && S.gait.jog && A.jog !== S.gait.jog.a) A.jog.setEffectiveWeight(0); if (A.run && S.gait.run && A.run !== S.gait.run.a) A.run.setEffectiveWeight(0);
    var gTot = 0; for (k in S.gait) { Gk = S.gait[k]; var tw = other && !(k === "walk" && S.shuffle > 0.02 && !posed) ? 0 : (gw[k] || 0) * mov + (k === "walk" ? S.shuffle * (1 - mov) : 0); Gk.w += (tw - Gk.w) * kW; Gk.a.setEffectiveWeight(Gk.w); gTot += Gk.w; }
    W.walk = S.gait.walk ? S.gait.walk.w : 0; W.jog = S.gait.jog ? S.gait.jog.w : 0; W.run = S.gait.run ? S.gait.run.w : 0;
    // the idle pool: the current variant fades in over its crossfade, the others out; a new variant every 6 to 13 s
    var idleW = W.idle; if (idleW < 0.02) S.stale = true; else if (S.stale) { S.stale = false; pickIdle(S, now, true); for (var i0 = 0; i0 < S.idle.length; i0++) S.idle[i0].w = S.idle[i0].tw; } else if (now > S.until) pickIdle(S, now, false);
    var kI = Math.min(1, dt / (S.fade || 1.2) * 2.2);
    for (var i = 0; i < S.idle.length; i++) { var I = S.idle[i]; I.w += (I.tw - I.w) * kI; var ew = I.w * idleW * (hasTurn ? 1 - TT.w : 1); I.a.setEffectiveWeight(ew); I.a.setEffectiveTimeScale(S.ts); if (ew < 0.002 && I.tw === 0) { /* parked */ } }
    // a pose (PLAN_ANIM.pose): eases in, everything else out
    if (P) { var kP = Math.min(1, dt / Math.max(0.05, P.fade)); P.w += (P.tw - P.w) * kP * 1.6; if (P.tw === 0 && P.w < 0.01) { P.a.stop(); S.pose = null; P.w = 0; } else { var pw = smooth(P.w); P.a.setEffectiveWeight(pw); var keep = 1 - pw; for (i = 0; i < S.idle.length; i++) S.idle[i].a.setEffectiveWeight(S.idle[i].a.getEffectiveWeight() * keep); for (k in S.gait) S.gait[k].a.setEffectiveWeight(S.gait[k].w * keep); for (n in want) if (A[n] && n !== "idle" && A[n] !== P.a) A[n].setEffectiveWeight(W[n] * keep); ["dance1", "dance2", "dance3", "dance4"].forEach(function (d) { if (A[d] && A[d] !== P.a) A[d].setEffectiveWeight((W[d] || 0) * keep); }); P.a.setEffectiveWeight(pw); } }
    u.mixer.update(dt);
    if (u.pedal && u.legBones) pedalPose(g, speed, dt); else if (u.sit && u.driveIK && u.legBones && W.sit > 0.6) cartPose(g);
    // sprint: the run clip's stride is short for 9.6 m/s, so past its cadence limit the thigh swing is lengthened (up to 1.25x)
    if (S.gait.run && S.gait.run.w > 0.05 && sp > 6 && !other) { var fw = 1 + 0.25 * S.gait.run.w * smooth((sp - 6) / 3); var dl = strideWarp(S, "LeftUpLeg", fw), dr = strideWarp(S, "RightUpLeg", fw); S.warpDrop = Math.min(dl, dr) * (S.legLen || 0.85); } else S.warpDrop = 0;
    // ground: each clip's own lowest foot sits on the floor (the old fixed -0.1 m drop sank the jog and the run)
    if (u.walk && !u.pedal && !u.driveIK && !u.sitOff && !riding) { var off = 0, wt = 0; for (k in S.gait) { off -= S.gait[k].w * (S.gait[k].G.off || 0); wt += S.gait[k].w; } for (i = 0; i < S.idle.length; i++) { var ew2 = S.idle[i].a.getEffectiveWeight(); off -= ew2 * (S.idle[i].c.userData.off || 0); } u.walk.position.y = Math.max(-0.14, Math.min(0.12, off - (S.warpDrop || 0))); }
    if (air && !u.wasAir && A.jump) { A.jump.reset(); A.jump.time = 0.12; A.jump.play(); } u.wasAir = air;
    // procedural layers (near only): lean into turns and speed changes, a head look, the gesture blend
    var near = u.__d === undefined || u.__d < 28;
    if (u.walk && OPT.lean && !riding && !u.sitOff && !posed && !st) { var tl = near && !other ? Math.max(-0.16, Math.min(0.16, -S.yawRate * Math.min(sp, 8) * 0.018)) * mov : 0; var tp = near && !other ? Math.max(-0.06, Math.min(0.09, S.acc * 0.022)) * mov : 0; S.lean += (tl - S.lean) * Math.min(1, dt * 5); S.pitch += (tp - S.pitch) * Math.min(1, dt * 4); u.walk.rotation.z = S.lean; u.walk.rotation.x = S.pitch; }
    else if (u.walk && (S.lean || S.pitch) && !riding) { S.lean = S.pitch = 0; u.walk.rotation.z = 0; u.walk.rotation.x = 0; }
    if (S.gest) gestureApply(S, dt);
    if (near && OPT.look && !riding && !dn && !gf && !sw) headLook(g, S, dt, posed || st);
    if (OPT.ik && !other && !riding && !u.sitOff && (u.__d === undefined || u.__d < 14) && fikAllowed(g)) footIK(g, S, dt); else S.fd = 0;
    return true;
  };
  var _sw = null;
  function strideWarp(S, name, f) { var THREE = T3(); var b = S.bones[name]; if (!b) return; if (!S.restB) { S.restB = {}; } var r = S.restB[name]; if (!r) { var R = S.set && S.rigRest; r = S.restB[name] = b.userData.__rest || b.quaternion.clone(); }
    if (!_sw) _sw = { q: new THREE.Quaternion(), ri: new THREE.Quaternion() }; _sw.ri.copy(r).invert(); var q = _sw.q.copy(_sw.ri).multiply(b.quaternion); if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w); var ang = 2 * Math.acos(Math.min(1, q.w)); if (ang < 1e-4) return 0; var sn = Math.sin(ang / 2), na = ang * f; var k = Math.sin(na / 2) / sn; q.set(q.x * k, q.y * k, q.z * k, Math.cos(na / 2)); b.quaternion.copy(r).multiply(q); return Math.max(0, Math.cos(Math.min(ang, 1.4)) - Math.cos(Math.min(na, 1.5))); }
  // ground adaptation (R19 round 2): on sloped or uneven ground each foot is lifted or lowered to the terrain under it and the
  // pelvis comes down by the lower foot's drop (two-bone IK with the knee kept forward), near characters only, outdoors on
  // the terrain (on decks and floors the solid is flat)
  var FK = null;
  // the cost cap: foot IK for the player and the 4 nearest other characters (ranked on the previous frame's requests)
  var FIK = { f: -1, req: [], ok: new Set() };
  function fikAllowed(g) {
    var isP = (typeof player !== "undefined") && g === player; var fn = typeof FRAME_N !== "undefined" ? FRAME_N : 0;
    if (FIK.f !== fn) { FIK.req.sort(function (a, b) { return a[1] - b[1]; }); FIK.ok = new Set(FIK.req.slice(0, 4).map(function (r) { return r[0]; })); FIK.req = []; FIK.f = fn; }
    if (isP) return true; FIK.req.push([g, g.userData.__d || 0]); return FIK.ok.has(g);
  }
  function footIK(g, S, dt) {
    var THREE = T3(); var B = S.bones, u = g.userData; var sides = [["LeftUpLeg", "LeftLeg", "LeftFoot"], ["RightUpLeg", "RightLeg", "RightFoot"]]; if (!B.LeftFoot || !B.RightFoot || typeof planGroundAt !== "function") return;
    if (!FK) FK = { f: [new THREE.Vector3(), new THREE.Vector3()], t: new THREE.Vector3(), pole: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3() };
    var g0; try { g.getWorldPosition(FK.w); g0 = planGroundAt(FK.w.x, FK.w.z); if (typeof inside !== "undefined" && inside) return; } catch (e) { return; } if (!(Math.abs(g0 - FK.w.y) < 0.12)) { S.fd = 0; return; }
    u.walk.updateMatrixWorld(true); var d = [0, 0];
    for (var i = 0; i < 2; i++) { B[sides[i][2]].getWorldPosition(FK.f[i]); var h = 0; try { h = planGroundAt(FK.f[i].x, FK.f[i].z) - g0; } catch (e) {} d[i] = Math.max(-0.3, Math.min(0.3, h)); }
    var drop = Math.max(0, -Math.min(d[0], d[1])); S.fd = (S.fd || 0) + (drop - (S.fd || 0)) * Math.min(1, dt * 10);
    if (S.fd < 0.004 && Math.abs(d[0]) < 0.012 && Math.abs(d[1]) < 0.012) return;
    u.walk.position.y -= S.fd; u.walk.updateMatrixWorld(true); g.getWorldQuaternion(FK.q);
    for (i = 0; i < 2; i++) { FK.t.copy(FK.f[i]); FK.t.y += d[i]; FK.pole.set(i === 0 ? 0.15 : -0.15, 0, 1).applyQuaternion(FK.q); try { ik2(B[sides[i][0]], B[sides[i][1]], B[sides[i][2]], FK.t, FK.pole); } catch (e) {} }
    AN.n.fik = (AN.n.fik || 0) + 1;
  }
  // head look: NPCs glance at the player when close and in front; the player follows the camera's look a little; idles add
  // a few slow glances. Neck 40 per cent, head 60 per cent, as rotations about the body's up and right axes.
  function headLook(g, S, dt, small) {
    var THREE = T3(); var L = S.look, B = S.bones, hd = B.Head, nk = B.neck; if (!hd || !nk) return; var isP = (typeof player !== "undefined") && g === player;
    var ty = 0, tp = 0, yawB = g.rotation.y;
    try {
      if (isP) { var cy = (typeof yaw === "number") ? yaw + Math.PI : yawB; var d = Math.atan2(Math.sin(cy - yawB), Math.cos(cy - yawB)); if (Math.abs(d) < 1.5 && S.sp < 2.5) ty = d * 0.55; }
      else if (typeof player !== "undefined" && player) { if (g.parent && g.parent.isScene) _wp.copy(g.position); else g.getWorldPosition(_wp); var dx = player.position.x - _wp.x, dz = player.position.z - _wp.z, dd = Math.hypot(dx, dz); if (dd < 6 && dd > 0.4) { var a = Math.atan2(dx, dz); var rel = Math.atan2(Math.sin(a - yawB), Math.cos(a - yawB)); if (Math.abs(rel) < 1.7) { ty = rel; tp = Math.atan2(1.6 - 1.55, dd) * 0; } } }
    } catch (e) {}
    if (ty === 0 && S.sp < 0.3) { if (performance.now() / 1000 > L.t) { L.t = performance.now() / 1000 + 2 + S.rnd() * 4; L.gy = S.rnd() < 0.45 ? (S.rnd() - 0.5) * 1.1 : 0; L.gp = (S.rnd() - 0.4) * 0.14; } ty = L.gy || 0; tp = L.gp || 0; }
    var lim = small ? 0.5 : 1.15; ty = Math.max(-lim, Math.min(lim, ty)); tp = Math.max(-0.3, Math.min(0.3, tp));
    var k = Math.min(1, dt * 3.2); L.y += (ty - L.y) * k; L.p += (tp - L.p) * k; if (Math.abs(L.y) < 1e-3 && Math.abs(L.p) < 1e-3) return;
    applyTurn(nk, L.y * 0.4, L.p * 0.4, g); applyTurn(hd, L.y * 0.6, L.p * 0.6, g);
  }
  var _ax = null, _pq = null, _rq = null, _gq = null, _dp = null, _ds = null, _qp = null;
  function applyTurn(bone, yawA, pitchA, g) {
    var THREE = T3(); if (!_ax) { _ax = new THREE.Vector3(); _pq = new THREE.Quaternion(); _rq = new THREE.Quaternion(); _gq = new THREE.Quaternion(); }
    if (!_dp) { _dp = new THREE.Vector3(); _ds = new THREE.Vector3(); } bone.parent.matrixWorld.decompose(_dp, _pq, _ds); if (g.parent && g.parent.isScene) _gq.copy(g.quaternion); else g.getWorldQuaternion(_gq);   // last frame's parent matrix: no matrix walk per bone
    _rq.setFromAxisAngle(_ax.set(0, 1, 0).applyQuaternion(_gq), yawA); if (pitchA) { if (!_qp) _qp = new THREE.Quaternion(); _qp.setFromAxisAngle(_ax.set(1, 0, 0).applyQuaternion(_gq), pitchA); _rq.multiply(_qp); }
    // world-space rotation into the bone's parent frame: q' = inv(Pw) R Pw q
    var inv = Qt.copy(_pq).invert(); bone.quaternion.premultiply(inv.multiply(_rq).multiply(_pq));
  }

  // ───────── poses (for plan_seat.js) and gestures ─────────
  function clipFor(g, clip, opts) {
    var u = g.userData; var body = u.body || "m"; var C = (typeof CHAR !== "undefined") && CHAR[body];
    if (clip === "sit") return C && C.clips.sit;
    if (typeof clip === "string") { var L = LIB.named && LIB.named[clip]; if (!L) return null; var key = clip + "|" + body; LIB.namedRt = LIB.namedRt || {}; if (!LIB.namedRt[key] && C) LIB.namedRt[key] = retarget(L.clip, L.root, C.scene, { name: clip, plant: !!L.plant }); return LIB.namedRt[key]; }
    if (clip && clip.clip && clip.src) { var k2 = (clip.clip.uuid) + "|" + body; LIB.adhoc = LIB.adhoc || {}; if (!LIB.adhoc[k2] && C) LIB.adhoc[k2] = retarget(clip.clip, clip.src, C.scene, { plant: !!clip.plant }); return LIB.adhoc[k2]; }
    return clip && clip.isAnimationClip !== undefined ? clip : (clip && clip.tracks ? clip : null);
  }
  AN.addClip = function (name, clip, srcRoot, plant) { LIB.named = LIB.named || {}; LIB.named[name] = { clip: clip, root: srcRoot, plant: !!plant }; return name; };
  AN.pose = function (g, clip, opts) {
    try { opts = opts || {}; var u = g && g.userData; if (!u || !u.mixer) return null; var S = u.an || initChar(g); if (!S) return null; var c = clipFor(g, clip, opts); if (!c) return null;
      var THREE = T3(); var root = u.mixer.getRoot(); var a = u.mixer.clipAction(c, root); a.reset(); a.setLoop(opts.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = true; a.setEffectiveTimeScale(opts.speed || 1);
      if (opts.t0 === "rand") a.time = Math.random() * c.duration; else if (opts.t0) a.time = opts.t0; a.setEffectiveWeight(0); a.play();
      if (S.pose && S.pose.a !== a) S.pose.a.stop(); S.pose = { a: a, w: S.pose && S.pose.a === a ? S.pose.w : 0, tw: 1, fade: opts.fade === undefined ? 0.45 : opts.fade, name: typeof clip === "string" ? clip : (c.name || "pose"), lock: opts.lock !== false && (typeof player !== "undefined") && g === player };
      if (S.pose.lock) AN.lock(true, "pose"); AN.n.poses++; return { name: S.pose.name, action: a };
    } catch (e) { note("pose", e); return null; }
  };
  AN.release = function (g, opts) { var S = g && g.userData && g.userData.an; if (!S || !S.pose) return false; S.pose.tw = 0; if (opts && opts.fade !== undefined) S.pose.fade = opts.fade; if (S.pose.lock) AN.lock(false, "pose"); return true; };
  AN.posing = function (g) { var S = g && g.userData && g.userData.an; return S && S.pose && S.pose.tw > 0 ? S.pose.name : null; };
  AN.lock = function (on, why) { AN.locked = on ? (why || "lock") : null; return AN.locked; };
  // gestures: upper-body clips (Aaron's authored wave / talk / point, retargeted per body) blended over the idle after the mixer
  var UPPER = ["Spine01", "Spine", "neck", "Head", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand"];
  function gestLib() {
    if (LIB.gp) return LIB.gp; var q = "?v=" + (window.BUILD || "dev");
    LIB.gp = new Promise(function (res) { var ld = rawLoader(); ld.load("/models/aaron_anim.glb" + q, function (gl) { LIB.gsrc = { root: gl.scene, clips: {} }; (gl.animations || []).forEach(function (c) { LIB.gsrc.clips[c.name] = c; }); res(true); }, undefined, function (e) { note("gestures", e); res(false); }); });
    return LIB.gp;
  }
  AN.gesture = function (g, name, opts) {
    opts = opts || {}; var u = g && g.userData; if (!u || !u.mixer) return false; var S = u.an || initChar(g); if (!S) return false;
    gestLib().then(function () { try { var src = LIB.gsrc && LIB.gsrc.clips[name]; if (!src) return; var body = u.body || "m"; var key = name + "|" + body; LIB.gest = LIB.gest || {}; if (!LIB.gest[key]) LIB.gest[key] = retarget(src, LIB.gsrc.root, CHAR[body].scene, { name: name, fps: 30 });
      var c = LIB.gest[key]; if (!c) return; S.gest = { c: c, t: 0, dur: c.duration * (opts.loops || 1), fade: opts.fade || 0.35, w: 0, bones: UPPER.map(function (n) { return [S.bones[n], c.userData.rig.idx[n]]; }).filter(function (b) { return b[0] && b[1] !== undefined; }) }; AN.n.gestures++; } catch (e) { note("gesture", e); } });
    return true;
  };
  function gestureApply(S, dt) {
    var G = S.gest, THREE = T3(); G.t += dt; var w = Math.min(smooth(G.t / G.fade), smooth((G.dur - G.t) / G.fade)); if (G.t >= G.dur) { S.gest = null; return; }
    var tt = G.t % G.c.duration; var q = Qt || new THREE.Quaternion(); for (var i = 0; i < G.bones.length; i++) { sampleFrame(G.c, tt, G.bones[i][1], q); G.bones[i][0].quaternion.slerp(q, w); }
  }

  // ───────── glTF rigs: intercept their idle / walk clip files ─────────
  var RIG_IDLE = /\/models\/(paul|brad|beth|will|jake|joe|pilot|linetech|concierge|resident_m|resident_f|host)_idle\.glb/;
  var RIG_ANIM = /\/models\/(aaron|everette|mx_maytrixxx)_anim\.glb/;
  var RIG_BODY = /\/models(?:_m)?\/(?:lod\/)?(paul|brad|beth|will|jake|joe|pilot|linetech|concierge|resident_m|resident_f|host|aaron|everette|mx_maytrixxx|char_m|char_f|char_m_lod|char_f_lod)\.glb/;   // bodies: their hands are curled as they load, before any copy is made
  var RIG_WALK = /\/models\/(paul|brad|beth|will|jake|joe|pilot|linetech|concierge|resident_m|resident_f|host)_walk\.glb/;
  var WALK_V = 0.72;   // the modules' walk formula: timeScale = speed / 0.72 (plan_interiors, plan_showcase, plan_arrivals)
  function seedOf(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h; }
  function rigIdle(url, gl) {
    var key = (url.match(RIG_IDLE) || url.match(RIG_ANIM) || [])[1]; if (!key || !gl || !gl.scene) return; var t0 = performance.now();
    var vars = IDLES.map(function (d) { var s = LIB.src[d[0]]; return s ? retarget(s.clip, s.root, gl.scene, { mirror: d[1], plant: true, name: d[0], fps: 24, arms: ARM_IDLE, palmS: srcPalm(d[0]), palmT: palmOf(key) }) : null; }).filter(Boolean);
    if (!vars.length) return; var clip = composeIdle(vars, 48, seedOf(key), 24); clip.name = "idle";
    var list = gl.animations || (gl.animations = []); var at = -1; for (var i = 0; i < list.length; i++) if (/idle/i.test(list[i].name)) { at = i; break; }
    if (RIG_IDLE.test(url)) { if (at < 0) at = 0; } if (at < 0) list.unshift(clip); else { clip.name = list[at].name; list[at] = clip; }
    LIB.rig[key] = { ms: Math.round(performance.now() - t0), dur: clip.duration }; AN.n.rigIdle++;
  }
  function rigWalk(url, gl) {
    var key = (url.match(RIG_WALK) || [])[1]; if (!key || !gl || !gl.scene || !(LIB.src.walkm || LIB.src.walk2)) return; var s = (/(beth|resident_f|host|mx_maytrixxx)/.test(key) && LIB.src.walkf) || LIB.src.walkm || LIB.src.walk2; var list = gl.animations || []; var old = list[0];
    // the new walk takes the old clip's place exactly: the same ground speed at rate 1 and the same lowest foot height, so each
    // module's own speed formula and foot-height drop (HOST_DROP, walk_speed 0.72) stay right
    var mOld = old ? measure(old, gl.scene) : null; var vT = mOld && mOld.v > 0.2 ? mOld.v : WALK_V;
    var srcK = s === LIB.src.walkf ? "walkf" : "walkm"; var probe = retarget(s.clip, s.root, gl.scene, { name: "walk", fps: 30, plant: true, arms: ARM_WALK, palmS: srcPalm(srcK), palmT: palmOf(key) }); if (!probe) return; var m = measure(probe, gl.scene); if (!m || !(m.v > 0.2)) return;
    var dur = s.clip.duration * (m.v / vT); var c = retarget(s.clip, s.root, gl.scene, { name: "walk", fps: 30, dur: dur, plant: true, arms: ARM_WALK, palmS: srcPalm(srcK), palmT: palmOf(key) }); if (!c) return;
    if (mOld) { var R = rigOf(gl.scene); var dy = (m.off - mOld.off) / Math.max(1e-6, R.s0); var tr = c.tracks[c.tracks.length - 1]; for (var i = 1; i < tr.values.length; i += 3) tr.values[i] += dy; }
    c.name = old ? old.name : "walk"; if (list.length) list[0] = c; else (gl.animations = [c]); LIB.rig[key + "_walk"] = { v: +vT.toFixed(3), from: +m.v.toFixed(3) }; AN.n.rigWalk++;
  }
  function waitPalm(key) { return new Promise(function (res) { var t0 = performance.now(); (function poll() { if (!key || palmOf(key) || performance.now() - t0 > 6000) res(); else setTimeout(poll, 150); })(); }); }
  function wrapLoader() {
    if (AN._wrapped || typeof window.gltfLoader !== "function") return !!AN._wrapped; var orig = window.gltfLoader; AN._wrapped = true; AN._gl = orig;
    window.gltfLoader = function () {
      var l = orig.apply(this, arguments); if (!l || l.__anim) return l; var ld = l.load; l.__anim = true;
      l.load = function (url, onLoad, onProgress, onError) {
        var su = String(url); var isI = OPT.rig && (RIG_IDLE.test(su) || RIG_ANIM.test(su)), isW = OPT.rig && RIG_WALK.test(su);
        if (RIG_BODY.test(su)) return ld.call(this, url, function (gl) { try { if (gl && gl.scene) bendHands(gl.scene, (su.match(RIG_BODY) || [])[1]); } catch (e) { note("hands " + su, e); } if (onLoad) onLoad(gl); }, onProgress, onError);
        if (!isI && !isW) return ld.call(this, url, onLoad, onProgress, onError);
        return ld.call(this, url, function (gl) { loadLib().then(function () { return waitPalm((su.match(RIG_IDLE) || su.match(RIG_ANIM) || su.match(RIG_WALK) || [])[1]); }).then(function () { try { if (LIB.ok) { if (isI) rigIdle(su, gl); else rigWalk(su, gl); } } catch (e) { note("rig " + su, e); } if (onLoad) onLoad(gl); }); }, onProgress, onError);
      };
      return l;
    };
    return true;
  }
  // gestures on the client's own moments: a wave emote, a hello from an NPC near you, a talk card page
  function wrapMoments() {
    if (AN._moments) return; if (typeof window.showEmote !== "function" || typeof window.npcSay !== "function" || typeof window.showTalk !== "function") return; AN._moments = true;
    var oE = window.showEmote; window.showEmote = function (g, p) { var prev = null; try { prev = emoteShown.get(g.uuid); prev = prev && prev.tick; } catch (e) {} var r = oE.apply(this, arguments); try { if (p && p.emote === "wave" && p.emoteTick && p.emoteTick !== prev && g.userData.acts) AN.gesture(g, "wave"); } catch (e) {} return r; };
    var oS = window.npcSay; window.npcSay = function (c, text) { var r = oS.apply(this, arguments); try { var g = c && c.g; if (g && g.userData.acts && typeof player !== "undefined" && player) { g.getWorldPosition(_wp || (_wp = new (T3().Vector3)())); var d = Math.hypot(player.position.x - _wp.x, player.position.z - _wp.z); var S = g.userData.an; if (d < 11 && S && S.sp < 0.6 && !S.gest) { var now = performance.now(); if (!S.waved || now - S.waved > 60000) { S.waved = now; AN.gesture(g, "wave"); } else if (Math.random() < 0.6) AN.gesture(g, "talk", { loops: 0.5 }); } } } catch (e) { note("npcSay", e); } return r; };
    var oT = window.showTalk; window.showTalk = function (c, idx) { var r = oT.apply(this, arguments); try { var g = c && c.g; if (g && g.userData.acts) AN.gesture(g, "talk", { loops: 0.75 }); } catch (e) {} return r; };
  }
  // CapsLock: walk instead of the default jog (the client's speed line reads PLAN_ANIM.walkMode)
  // movement speed (R19 round 2, the user's call): walking is the default (1.5 m/s), Shift jogs (4.6), CapsLock toggles run mode
  // (default jog, Shift sprints at 9.6). The obby (its gaps are sized for the jog) and the timed Lake Lap keep run mode while
  // they run.
  AN.WALK = 1.5; AN.runMode = false; try { AN.runMode = localStorage.getItem("g1:run") === "1" || flag("animrun", 0) === 1; } catch (e) {}
  AN.walkMode = !AN.runMode;   // kept for the round-1 speed line
  AN.moveSpeed = function (shift) {
    var run = AN.runMode; try { if ((typeof OBBY !== "undefined" && OBBY.running) || (typeof LAP !== "undefined" && LAP.next >= 0)) run = true; } catch (e) {}
    return run ? (shift ? 9.6 : 4.6) : (shift ? 4.6 : AN.WALK);
  };
  try { window.addEventListener("keydown", function (e) { if (e.code !== "CapsLock" || e.repeat) return; var ae = document.activeElement; if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) return; AN.runMode = !AN.runMode; AN.walkMode = !AN.runMode; try { localStorage.setItem("g1:run", AN.runMode ? "1" : "0"); } catch (x) {} try { setStatus(AN.runMode ? "run mode · SHIFT sprints · CapsLock to walk" : "walking · SHIFT to run · CapsLock for run mode"); } catch (x) {} }); } catch (e) {}
  // ───────── install ─────────
  function install() { try { wrapLoader(); loadLib(); } catch (e) { note("install", e); } return false; }
  var H = window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] }; H.plan = H.plan || [];
  H.plan.push({ name: "animPlan", fn: install }); H.terrain.push({ name: "animTerrain", fn: install }); H.world.push({ name: "animWorld", fn: function () { install(); try { wrapMoments(); } catch (e) { note("moments", e); } loadLib().then(function (ok) { if (!ok) { readyRes(false); return; } var later = function (f) { return new Promise(function (r) { setTimeout(function () { try { f(); } catch (e) { note("charSet", e); } r(); }, 0); }); };   // one body per task (each about 30 to 56 ms)
    later(function () { charSet("m"); }).then(function () { return later(function () { charSet("f"); }); }).then(function () { AN.ready = !!LIB.char.m; readyRes(AN.ready); }); }); return false; } });
  try { install(); } catch (e) {}
  AN.debug = {
    idle: function (g, i, t) { var S = g && g.userData && g.userData.an; if (!S) return null; S.cur = i; for (var j = 0; j < S.idle.length; j++) { S.idle[j].tw = S.idle[j].w = j === i ? 1 : 0; } S.idle[i].a.time = t || 0; S.until = 1e12; return S.idle[i].c.name; },
    state: function (g) { var S = g && g.userData && g.userData.an; if (!S) return null; return { sp: +S.sp.toFixed(2), ph: +S.ph.toFixed(2), cur: S.cur, idle: S.idle.map(function (I) { return +I.a.getEffectiveWeight().toFixed(2); }), gait: Object.keys(S.gait).reduce(function (o, k) { o[k] = [+S.gait[k].w.toFixed(2), +(S.gait[k].s || 0).toFixed(2)]; return o; }, {}), yawRate: +S.yawRate.toFixed(2), lean: +S.lean.toFixed(3), pose: S.pose && S.pose.name, walkY: g.userData.walk && +g.userData.walk.position.y.toFixed(3) }; },
    gaits: function (b) { var s = LIB.char[b || "m"]; if (!s) return null; var o = {}; for (var k in s.gait) o[k] = { v: +s.gait[k].v.toFixed(3), tc: +s.gait[k].tc.toFixed(3), cyc: s.gait[k].cycles, off: +s.gait[k].off.toFixed(3), ph: +s.gait[k].ph.toFixed(2) }; o.idles = s.idles.map(function (c) { return [c.name, +c.duration.toFixed(1), +(c.userData.off || 0).toFixed(3)]; }); o.ms = s.ms; return o; }
  };
})();
