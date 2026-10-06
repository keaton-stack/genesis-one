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
