/* plan_charshade.js (R19, Agent CH): characters answer the light like the rest of the world.
   Classic script, loaded after plan_charfx.js and before client.js. It patches the R16 character programs (plan_charfx.js) at
   runtime, on top of their own onBeforeCompile, before their first compile: no new program kinds (the R16 programs are replaced
   one for one), no new textures, lights, draws or passes. HANDOFF_R19_CHARSHADE.md.
   What R16 left out (measured, section 1 of the handoff): its look was built for the sun alone. In shade, under the sky and in
   rooms, where most characters stand most of the time, the cloth had no sheen at all (direct light only), the hair lost 55 per
   cent of its reflections and the clothes 25 per cent, the skin had one broad lobe from the environment and the metal texels of
   the glTF rigs were forced to F0 0.04 (black buckles). World props reflect the same probe in full.
   - Environment (the probe the world uses: the sky PMREM outdoors, the room capture indoors, same intensity), through three's own
     single lookup with its normal and roughness chosen by class (no extra lookup): skin a sharper lobe (the sun's dual lobe) and
     smoother oily zones (forehead, nose ridge, cheekbones); hair the fibre normal round the strand tangent (R shifted to the root,
     TRT tinted toward the tip) instead of the 55 per cent cut, grooms too; cloth the Charlie sheen integrated over the sky and the
     room (three's IBL sheen fit), cotton and denim at full reflection; leather a polished lobe.
   - Direct: skin back-scatter through thin parts against a low Sun (ears, nose, fingers glow warm at golden hour), hair
     transmission through the bundle, the Kajiya-Kay highlights and the cloth sheen brighter. (?chslite=1 also adds the sheen and
     the fibre highlight to the lite model of the room lamps past the first three; off by default for its compile cost.)
   - Eyes: a sharp wet cornea reflection of the probe, the eyeball and the recessed iris darker toward the limbus at grazing view
     (an iris parallax look; resampling the iris along the view ray broke the generators' small eye charts into shards).
   - Metal texels of the glTF rigs (ORM metalness) keep their metal F0 and roughness.
   - Coverage: the char rigs (player, remote players, NPCs, roaming people, crowds, cast), the R16 glTF rigs, Maytrixxx, the hats
     and scalp shells, the grooms, and the R19 partner rigs charfx does not list (Joe, the booth host: CSM fix, regions, model).
   - Low and medium (no R16 model): the clothes' F0 from the glTF (0.067, plastic) is set to 0.04 by a uniform; no new program.
   Pass 2 (the coordinator's review): skin vellus sheen (the face's edges catch a low Sun), a warmer terminator, oily zones and
     pore detail that carry further; the hair band kept at 3 to 5 m (R16 faded it with distance), grooms with per-strand normals,
     darker roots and a brighter band; fold and crease shading from a per-vertex curvature attribute (aChsC, computed at load) with
     specular occlusion; denim and twill thread glints; contact occlusion under the feet (a soft disc, high and ultra); at night an
     emitters probe (festoons, LED lines, glowing lamp heads and the lamps the 11-slot pool drops) lights characters near the
     camera's subject as one more light; in rooms the characters take plan_roomlight's per-room lights (Agent LI: every fixture, the
     openings, the sun patch, the bounce volume, the furniture occlusion) through LI's own shader pieces.
   Switches: ?chs=0 all off (R16 exactly); runtime PLAN_CHARSHADE.ab(false/true) (uniform A/B, no recompile), .set(i, v);
   ?chsli=0 (no room lights for characters), PLAN_CHARSHADE.ep.K (the probe calibration); ?chsdbg=1 compiles the debug views (.debug.view(1) specular, 2 environment specular, 3 diffuse, 4 oil / metal / eye, 5 classes). */
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_CHARSHADE = window.PLAN_CHARSHADE || { v: "r19-0", errs: [], n: {} };
(function () {
  "use strict";
  var CS = window.PLAN_CHARSHADE; CS.v = "r19-2"; CS.errs = CS.errs || []; CS.n = { mats: 0, rigs: 0, tint: 0, ext: 0, groom: 0, late: 0, miss: 0, low: 0 };
  var Q = location.search;
  function flag(k, d) { var m = Q.match(new RegExp("[?&]" + k + "=(\\d+)")); return m ? +m[1] : d; }
  function note(where, e) { if (CS.errs.length < 30) CS.errs.push(where + ": " + (e && e.message ? e.message : e)); try { console.warn("plan_charshade " + where, e); } catch (x) {} }
  var CF = window.PLAN_CHARFX;
  var LV = "high"; try { LV = localStorage.getItem("g1:quality") || (((navigator.hardwareConcurrency || 8) <= 4 || /Android|iPhone|iPad|Quest|Pico/i.test(navigator.userAgent)) ? "medium" : "high"); } catch (e) {}
  CS.level = LV; CS.tier = LV === "ultra" ? 2 : LV === "high" ? 1 : 0;
  CS.on = flag("chs", 1) !== 0 && !!window.THREE && !!CF;
  if (!CS.on) return;
  var H = window.PLAN_HOOKS; H.plan = H.plan || [];

  // ───────── low and medium: parameters only (the client's char materials, no R16 model there) ─────────
  if (CS.tier === 0 || !CF.on) {
    if (CF.on) return;   // a high tier with ?chfx=0: leave R15 exactly
    var lowTint = function () {
      if (CS._lt || typeof window.tintMaterial !== "function") return !!CS._lt; var orig = window.tintMaterial; CS._lt = orig;
      window.tintMaterial = function (mat, look) { var m = orig.apply(this, arguments);
        try { var nm = (m.name || "").toLowerCase(); if (nm !== "skin" && nm !== "hair" && nm !== "eyes" && m.isMeshPhysicalMaterial && m.specularColor) { var c = m.specularColor; var mx = Math.max(c.r, c.g, c.b); if (mx > 1.2) c.multiplyScalar(1.19 / mx); m.roughness = 0.84; CS.n.low++; } } catch (e) { note("low tint", e); }
        return m; };
      return true;
    };
    H.plan.push({ name: "charshadeLow", fn: function () { lowTint(); return false; } }); H.world.push({ name: "charshadeLowW", fn: function () { lowTint(); return false; } });
    CS.mode = "low"; return;
  }
  CS.mode = "full";

  // ───────── shared uniforms (strengths 0..1: zero gives the R16 look exactly, without a recompile) ─────────
  var K0 = [1, 1, 1, 1], K20 = [1, 1, 0, 1], K30 = [1, 1, 1, 1];
  var U = CS.U = { k: { value: new THREE.Vector4().fromArray(K0) }, k2: { value: new THREE.Vector4().fromArray(K20) }, k3: { value: new THREE.Vector4().fromArray(K30) },
    n: { value: new THREE.Vector4(0, 1, 0, 0) }, nc: { value: new THREE.Vector4(0, 0, 0, 0) }, np: { value: new THREE.Vector4(0, 0, 0, 0) } };
  // k3: x folds (curvature cavity, skin detail reach), y the emitters probe, z the room lights (LI), w skin sheen, back-light width, thread glints
  // k: x environment lobes, y skin extras, z hair extras, w cloth extras; k2: x eyes, y back-scatter and transmission, z debug view, w rig metal

  // ───────── GLSL ─────────
  var F_COMMON = "\nuniform vec4 uChsK; uniform vec4 uChsK2; uniform vec4 uChsK3; uniform vec4 uChsN; uniform vec4 uChsNC; uniform vec4 uChsNP; float chsOil = 0.0; float chsMet = 0.0; vec3 chsNL = vec3(0.0, 0.0, 1.0); float chsRL = 1.0; float chsAA = 1.0; float chsCav = 1.0; float chsGl = 0.0;\n";
  // per vertex: the mean curvature of the bind-pose surface (1/m, signed: folds and creases negative), from aChsC (added at load)
  var V_COMMON = "#include <common>\nattribute float aChsC; varying float vChsC;";
  var V_BEGIN = "#include <begin_vertex>\nvChsC = aChsC;";
  var F_VARY = "\nvarying float vChsC;\n";
  // after charfx's direct model: helpers and the additions to its light functions
  var F_PARS = [
    // three's fit of the Charlie sheen integrated over the environment (Estevez and Kulla 2017, as IBLSheenBRDF)
    "float chsSheenDG(float nv, float r) { float r2 = r * r; float a = r < 0.25 ? -339.2 * r2 + 161.4 * r - 25.9 : -8.48 * r2 + 14.3 * r - 9.95; float b = r < 0.25 ? 44.0 * r2 - 23.7 * r + 3.26 : 1.97 * r2 - 3.27 * r + 0.72; return saturate((exp(a * nv + b) + (r < 0.25 ? 0.0 : 0.1 * (r - 0.25))) * RECIPROCAL_PI); }",
    "vec3 chsBS = vec3(0.0); vec3 chsTT = vec3(0.0);",
    // skin back-scatter (light through ears, nose and fingers when the light is behind) and hair transmission through the bundle
    "void chsDirect(vec3 lc, vec3 L, vec3 V, vec3 N, float nv, inout ReflectedLight rl) {",
    "  float back = saturate(dot(V, -L)); float b2 = back * back; float b4 = b2 * b2;",
    "  rl.directDiffuse += lc * chsBS * (mix(b4, b2, 0.35 * uChsK3.w) * (0.3 + 0.7 * (1.0 - nv) * (1.0 - nv)));",
    "  rl.directSpecular += lc * chsTT * (mix(b4 * b2, b4, uChsK3.w) * (0.4 + 0.6 * saturate(1.0 - abs(dot(chT, L)))));",
    // the denim twill glints: single threads catching the light, object-space cells, their density kept as a mean below a pixel
    "  if (chsGl > 0.001) { vec3 H = normalize(L + V); float nh = saturate(dot(N, H)); float nl = saturate(dot(N, L)); rl.directSpecular += lc * (chsGl * nl * pow(nh, 160.0) * 1.6); }",
    "}",
    // the lite model (pool lights past the first three): the cloth sheen and the hair's primary highlight
    "void chsLite(vec3 lc, vec3 L, vec3 V, vec3 N, float nl, float nv, inout ReflectedLight rl) {",
    "  vec3 H = normalize(L + V); float nh = saturate(dot(N, H)); float nlc = saturate(nl);",
    "  float sh = (2.0 + chShInv) * pow(max(1.0 - nh * nh, 0.0078125), chShInv * 0.5) * 0.159155 * saturate(1.0 / (4.0 * (nlc + nv - nlc * nv) + 1e-4));",
    "  float h1 = dot(normalize(chT + N * chS1), H); float kk = pow(max(0.0, 1.0 - h1 * h1), chE1) * chK1 * smoothstep(-0.2, 0.3, nl);",
    "  rl.directSpecular += lc * (nlc * chShCK * sh * uChsK.w + kk * uChsK.z);",
    "}",
    ""
  ].join("\n");
  var A_DIR = "  reflectedLight.directSpecular += directLight.color * (nlc * (F * (D * chVS(chAv, nlc, nv)) + chShCK * sh) + kk);\n}";
  var A_LITE = "chDG(chAv, nh) * chVS(chAv, nlc, nv) * (1.0 - chHrD));\n}";
  // the oily zones of the face (bind space landmarks of charfx: head centre, eye line), skin a little smoother, rig metal kept
  var PRE_PHYS = [
    "{ float chsF = smoothstep(0.25, 0.5, normalize(vChN).z) * chSk; float dx = abs(vChP.x - uChHead.x), dy = vChP.y - uChEye.y;",
    "  float fore = smoothstep(0.012, 0.03, dy) * (1.0 - smoothstep(0.06, 0.085, dy)) * (1.0 - smoothstep(0.032, 0.052, dx));",
    "  float nose = (1.0 - smoothstep(0.008, 0.017, dx)) * smoothstep(-0.062, -0.048, dy) * (1.0 - smoothstep(-0.012, 0.0, dy));",
    "  float chk = smoothstep(0.018, 0.03, dx) * (1.0 - smoothstep(0.05, 0.066, dx)) * smoothstep(-0.046, -0.036, dy) * (1.0 - smoothstep(-0.02, -0.008, dy));",
    "  chsOil = chsF * max(fore, max(nose, chk * 0.6));",
    "  roughnessFactor = mix(roughnessFactor, max(0.28, roughnessFactor - 0.05 - 0.14 * chsOil), chSk * uChK.y * uChsK.y); }",
    // folds and creases: the cavity of the curvature (cloth fully, skin and hair less), for the indirect light, the reflections
    // (specular occlusion) and part of the direct light; denim and twill thread glints
    "{ float cv = clamp(1.0 + min(vChsC, 0.0) * 0.0065, 0.42, 1.0); chsCav = mix(1.0, cv, uChsK3.x * clamp(chCl + 0.6 * chSk + 0.35 * chHr, 0.0, 1.0));",
    "  float tw = chCl * (chDen + 0.35 * step(1.5, chLay) * step(chLay, 2.5));",
    "  if (tw > 0.001) { float fpx = length(fwidth(vChP)) * 700.0; float g = step(0.955, chH3(floor(vChP * 700.0) + 0.37)); chsGl = mix(g, 0.045, smoothstep(0.4, 1.6, fpx)) * tw * uChsK3.w; } }",
    // the eyeball and the recessed iris: darker toward the limbus and at grazing view (the depth the iris sits at under the cornea)
    "{ float ev = saturate(dot(normalize(vNormal), normalize(vViewPosition))); float ir = 1.0 - smoothstep(0.18, 0.45, dot(chBase.rgb, vec3(0.333)));",
    "  diffuseColor.rgb *= 1.0 - chEy * uChsK2.x * (0.22 + 0.3 * ir) * (1.0 - ev) * (1.0 - ev); }",
    "#ifdef CH_RIG",
    "{ chsMet = smoothstep(0.45, 0.8, metalnessFactor) * (1.0 - chSk) * (1.0 - chHr) * uChsK2.w; roughnessFactor = mix(roughnessFactor, clamp(roughnessFactor, 0.25, 0.6), chsMet); }",
    "#endif",
    "#include <lights_physical_fragment>"
  ].join("\n");
  var A_MATSET = "chK2C = chHrD * chHrK * 0.4 * material.diffuseColor; }";
  var POST_MATSET = [
    // hair: the highlight band kept at distance (R16 faded it with the normal's screen derivative: gone past 2 to 3 m), widened
    // there instead (the lobe a pixel integrates); brighter R and TRT
    "{ chE1 *= mix(1.0, mix(0.55, 1.0, chsAA), uChsK.z); chE2 *= mix(1.0, mix(0.7, 1.0, chsAA), uChsK.z);",
    "  chK1 *= 1.0 + 0.9 * uChsK.z; chK2C *= 1.0 + 0.9 * uChsK.z; chShCK *= 1.0 + 0.6 * uChsK.w;",
    // skin: the vellus sheen (the fine hair on skin catches grazing light: the face's edges at golden hour), a warmer terminator
    "  { float vs = chSkD * uChsK3.w * (1.0 - step(0.01, chShK)); chShCK += sqrt(max(material.diffuseColor, vec3(0.0))) * (0.34 * vs); chShR = mix(chShR, 0.3, vs); chShInv = 1.0 / max(chShR * chShR, 0.01);",
    "    chScC *= 1.0 + 0.9 * uChsK.y; chWr += chSkD * vec3(0.06, 0.0, -0.02) * uChsK.y; chWrI = 1.0 / (1.0 + chWr); }",
    "#ifdef CH_RIG",
    "  material.specularColor = mix(material.specularColor, diffuseColor.rgb, chsMet); chKd *= 1.0 - chsMet;",
    "#endif",
    "  vec3 al = max(material.diffuseColor, vec3(0.0));",
    "  chsBS = chSkD * al * vec3(1.0, 0.42, 0.24) * 0.55 * uChsK2.y;",
    "  chsTT = chHrD * chHrK * sqrt(al) * mix(al, vec3(1.0, 0.9, 0.75), 0.25) * 1.4 * uChsK2.y; }",
    ""
  ].join("\n");
  // environment: the R16 line replaced; with uChsK.x = 0 the result is the R16 line exactly
  var A_ENDL = "reflectedLight.indirectSpecular *= 1.0 - 0.55 * chHr * uChK.w - 0.25 * chCl * uChK.z;";
  // the probe lookup of three itself (lights_fragment_maps) takes its normal and roughness by class, so no second lookup is needed:
  // skin and leather a sharper lobe (between R16's lobe and a 0.68x one: the dual lobe of the sun, the oily zones sharper), hair the
  // fibre normal around the strand tangent (toward the viewer, shifted toward the root), eyes the wet cornea at 0.05
  var PRE_MAPS = [
    "{ vec3 V = geometryViewDir, N = geometryNormal; float k = uChsK.x; float sk = chSk * uChK.y, hr = chHr * uChK.w, cl = chCl * uChK.z; float lth = cl * step(3.5, chLay);",
    "  float rS = material.roughness * mix(1.0, 0.68, (0.3 + 0.25 * chsOil) * uChsK.y), rLe = material.roughness * mix(1.0, 0.6, 0.3 * uChsK.w);",
    "  chsRL = mix(material.roughness, rS, sk) ; chsRL = mix(chsRL, rLe, lth); chsNL = N;",
    "  if (hr > 0.5) { vec3 Nf = V - chT * dot(chT, V); float lf = length(Nf); Nf = lf > 1e-4 ? Nf / lf : N; chsNL = normalize(mix(N, normalize(normalize(mix(N, Nf, 0.6)) - chT * chS1), uChsK.z)); chsRL = mix(material.roughness, clamp(material.roughness * 1.05, 0.26, 0.7), uChsK.z); }",
    "  chsRL = mix(chsRL, 0.05, step(0.5, chEy) * uChsK2.x); chsRL = clamp(mix(material.roughness, chsRL, k), 0.03, 1.0); chsNL = normalize(mix(N, chsNL, k)); }",
    ""
  ].join("\n");
  var PROBE = [
    // the emitters probe (festoons, LED lines, glowing lamp heads, lamps the pool drops; plan_charshade.js gathers them each few
    // frames round the camera's subject): its directional part as one more light on the full model, the rest as irradiance
    "if (uChsNP.w > 0.0 && uChsK3.y > 0.0) { vec3 wp = (vec4(geometryPosition, 0.0) * viewMatrix).xyz + cameraPosition; float fd = 1.0 - smoothstep(uChsNP.w * 0.55, uChsNP.w, distance(wp, uChsNP.xyz));",
    "  if (fd > 0.001) { IncidentLight chsIL; chsIL.direction = normalize((viewMatrix * vec4(uChsN.xyz, 0.0)).xyz); chsIL.color = uChsNC.rgb * (fd * uChsK3.y); chsIL.visible = true;",
    "    RE_Direct_Ch(chsIL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight); irradiance += uChsNC.rgb * (uChsN.w * fd * uChsK3.y); } }",
    ""
  ].join("\n");
  var ENDL = [
    "{ vec3 chsB = reflectedLight.indirectSpecular; vec3 chsR16 = chsB * (1.0 - 0.55 * chHr * uChK.w - 0.25 * chCl * uChK.z); vec3 chsN = chsR16;",
    "  if (uChsK.x > 0.001) { float nv = saturate(dot(geometryNormal, geometryViewDir));",
    "    float sk = chSk * uChK.y, hr = chHr * uChK.w, cl = chCl * uChK.z; float lth = cl * step(3.5, chLay); float hw = step(0.5, hr);",
    "    vec3 add = chsB * max(0.0, 1.0 - hr - cl) + lth * chsB;",
    // hair: R plus TRT (tinted toward the tip, the same radiance), broken by the strand noise; the R16 cut where the fibre lobe is off
    "    add += hr * mix(chsB * 0.45, mix(chsB * 0.45, chsB * (0.7 + material.diffuseColor * 4.0) * (0.55 + 0.45 * chHrK) * 0.85, hw), uChsK.z);",
    // cloth: full reflection of cotton and denim, the sheen lobe from the sky and the room (irradiance: hemisphere and probe)
    "    add += (cl - lth) * chsB * mix(0.75, 0.95, uChsK.w);",
    "    add += chEy * chsB * (0.6 * uChsK2.x * step(0.5, chEy));",
    "    add += max(irradiance + iblIrradiance, vec3(0.0)) * chShCK * (chsSheenDG(nv, max(chShR, 0.07)) * uChsK.w);",
    "    chsN = mix(chsR16, add, uChsK.x); }",
    // the cavity: indirect light in full, part of the direct light, the reflections through Lagarde's specular occlusion
    "  float so = saturate(pow(saturate(dot(geometryNormal, geometryViewDir)) + chsCav, exp2(-16.0 * material.roughness - 1.0)) - 1.0 + chsCav);",
    "  reflectedLight.indirectSpecular = chsN * so; reflectedLight.indirectDiffuse *= chsCav; reflectedLight.directDiffuse *= mix(1.0, chsCav, 0.4); }",
    ""
  ].join("\n");
  var DBG = "if (uChsK2.z > 0.5) { outgoingLight = uChsK2.z < 1.5 ? totalSpecular : uChsK2.z < 2.5 ? reflectedLight.indirectSpecular : uChsK2.z < 3.5 ? totalDiffuse : uChsK2.z < 4.5 ? vec3(chsOil, chsMet, chEy) : vec3(chSk, chHr, chCl); }\n#include <opaque_fragment>";

  // compile cost (cold, salted, in game; HANDOFF 4): the lite-model additions and the debug views cost about 15 per cent of a
  // character program and are off by default (?chslite=1, ?chsdbg=1)
  CS.parts = { lite: flag("chslite", 0), dir: flag("chsdir", 1), dbg: flag("chsdbg", 0), li: flag("chsli", 1), lifull: flag("chslifull", 0) };
  function rep(src, a, b, what, all) { if (CS.parts[what] === 0) return src; var i = src.indexOf(a); if (i < 0) { CS.n.miss++; if (!CS._missed) CS._missed = {}; if (!CS._missed[what]) { CS._missed[what] = 1; note("anchor", what); } return src; } return all ? src.split(a).join(b) : src.slice(0, i) + b + src.slice(i + a.length); }
  function bind(sh) { sh.uniforms.uChsK = U.k; sh.uniforms.uChsK2 = U.k2; sh.uniforms.uChsK3 = U.k3; sh.uniforms.uChsN = U.n; sh.uniforms.uChsNC = U.nc; sh.uniforms.uChsNP = U.np; }
  // charfx's own lines: the hair highlight's distance fade, the skin detail's strength and fade
  var A_HRK = "chRg = (sn - 0.5) * 0.1; chHrK = (0.6 + 0.7 * sn2) * nAA; }";
  var B_HRK = "chRg = (sn - 0.5) * 0.1; chHrK = mix((0.6 + 0.7 * sn2) * nAA, mix(0.8, 0.6 + 0.7 * sn2, nAA), uChsK.z); chsAA = nAA; }";
  var A_SKD = "chSk > 0.5 ? 0.42 * uChK.y :", B_SKD = "chSk > 0.5 ? mix(0.42, 0.58, uChsK3.x) * uChK.y :";
  var A_VIS = "float vis = kDet * (1.0 - smoothstep(6.0, 40.0, fp));", B_VIS = "float vis = kDet * (1.0 - smoothstep(mix(6.0, 10.0, uChsK3.x), mix(40.0, 64.0, uChsK3.x), fp));";

  // ───────── rooms: plan_roomlight's per-room lights (Agent LI): every fixture of the room (up to 24, its kind's profile, inverse
  // square, the key one shadowed), the openings, the sun patch, the bounce volume and the furniture contact occlusion, as the room
  // surfaces get them; LI's own patch is borrowed (a small shader through PLAN_RL.li.patch gives its pieces), so this follows LI's code ─────────
  var LP = { src: null, parts: null };
  function liOk() {
    if (CS.parts.li === 0) return false; var RL = window.PLAN_RL; if (!RL || !RL.li || typeof RL.li.patch !== "function") return false;
    try { if (typeof QUAL !== "undefined" && RL.tierPick) RL.tierPick(); } catch (e) {} return !!RL.li.hi;
  }
  function between(s, a, b) { var i = s.indexOf(a); if (i < 0) return null; i += a.length; var j = s.indexOf(b, i); return j < 0 ? null : s.slice(i, j); }
  function liParts() {
    var lfb = THREE.ShaderChunk.lights_fragment_begin; if (LP.src === lfb) return LP.parts; LP.src = lfb; LP.parts = null;
    var M = ["#include <common>", "//CHSM1", "#include <packing>", "//CHSM2", "#include <envmap_physical_pars_fragment>", "//CHSM3", "#include <lights_fragment_begin>", "//CHSM4", "#include <lights_fragment_end>", "//CHSM5"].join("\n");
    var sh = { fragmentShader: M, vertexShader: "", uniforms: {} };
    try { if (!window.PLAN_RL.li.patch(sh, false)) return null; } catch (e) { note("li parts", e); return null; }
    var f = sh.fragmentShader, P = { decl: between(f, "#include <common>\n", "\n//CHSM1"), fn: between(f, "#include <packing>\n", "\n//CHSM2"), env: between(f, "//CHSM2\n", "\n//CHSM3"),
      lb: between(f, "//CHSM3\n", "\n//CHSM4"), end: between(f, "//CHSM4\n", "\n#include <lights_fragment_end>"), U: sh.uniforms };
    if (!P.decl || !P.fn || !P.lb || P.end === null || P.lb.indexOf("uLiOn") < 0) { note("li parts", "pieces"); return null; }
    if (P.env && P.env.indexOf("#include") >= 0) P.env = null;
    // the room's lights for characters follow uChsK3.z as well (zero: the pool, as in R16; the A/B shots)
    var G = function (t) { return t ? t.split("uLiOn.").join("( uLiOn * uChsK3.z ).") : t; }; P.lb = G(P.lb); P.end = G(P.end); P.env = G(P.env);
    // compile cost: inside LI's block the fixtures and the sun patch take charfx's lite model (wrap diffuse, one GGX lobe) for
    // characters, and only the sun patch keeps its shadow map (the key fixture's and key window's are the room's); the full model
    // and three shadow lookups inlined there, in loops the compiler unrolled to their maximum count, tripled a character program's
    // compile time (HANDOFF 4); the loops run to the room's own count instead
    if (CS.parts.lifull !== 1) { var i0 = P.lb.indexOf("vec3 liP = liWP();"), i1 = P.lb.indexOf("#if ( NUM_RECT_AREA_LIGHTS > 0 )", i0); if (i0 > 0 && i1 > i0) P.lb = P.lb.slice(0, i0) + P.lb.slice(i0, i1).split("RE_Direct( directLight,").join("RE_Direct_ChLite( directLight,").replace("if ( k == liKF ) vis = liShadow( 1, liP, liN, ndl );", "if ( k < 0 ) vis = 1.0;").replace("if ( w == liKW ) ff *= liShadow( 2, liP, liN, clamp( ff / max( length( F ), 1e-4 ), 0.0, 1.0 ) );", "").replace("for ( int k = 0; k < LI_NF; k ++ ) {\n\t\tif ( k >= liNF ) break;", "for ( int k = 0; k < min( liNF, LI_NF ); k ++ ) {").replace("for ( int w = 0; w < LI_NW; w ++ ) {\n\t\tif ( w >= liNW ) break;", "for ( int w = 0; w < min( liNW, LI_NW ); w ++ ) {") + P.lb.slice(i1); }
    LP.parts = P; CS.n.liParts = (CS.n.liParts || 0) + 1; return P;
  }
  CS.liParts = liParts;
  // the R16 character program (char rigs, glTF rigs, scalp and hats): charfx has already rewritten the source
  function injectCh(sh, kind, lp) {
    var fs = sh.fragmentShader; if (fs.indexOf("RE_Direct_Ch") < 0 || fs.indexOf("uniform vec4 uChsK;") >= 0) return false;
    fs = rep(fs, "#include <common>", "#include <common>" + F_COMMON + F_VARY, "common");
    if (sh.vertexShader.indexOf("aChsC") < 0) sh.vertexShader = sh.vertexShader.replace("#include <common>", V_COMMON).replace("#include <begin_vertex>", V_BEGIN);
    if (kind !== "ext") { fs = rep(fs, A_HRK, B_HRK, "hrk"); fs = rep(fs, A_SKD, B_SKD, "skd"); fs = rep(fs, A_VIS, B_VIS, "vis"); }
    if (lp) {
      fs = rep(fs, "#include <common>", "#include <common>\n" + lp.decl, "li decl"); fs = rep(fs, "#include <packing>", "#include <packing>\n" + lp.fn, "li fn");
      if (lp.env) fs = rep(fs, "#include <envmap_physical_pars_fragment>", lp.env, "li env");
      fs = rep(fs, "#include <lights_fragment_end>", lp.end + "\n#include <lights_fragment_end>", "li end");
      for (var k in lp.U) sh.uniforms[k] = lp.U[k]; CS.n.liProgs = (CS.n.liProgs || 0) + 1;
    }
    fs = rep(fs, "void RE_Direct_Ch(", F_PARS + "void RE_Direct_Ch(", "pars");
    if (CS.parts.dir) fs = rep(fs, A_DIR, A_DIR.slice(0, -2) + "\n  chsDirect(directLight.color, L, V, N, nv, reflectedLight);\n}", "direct");
    if (CS.parts.lite) fs = rep(fs, A_LITE, A_LITE.slice(0, -2) + "\n  chsLite(directLight.color, L, V, N, nl, nv, reflectedLight);\n}", "lite");
    if (kind !== "ext") fs = rep(fs, "#include <lights_physical_fragment>", PRE_PHYS, "prephys");
    fs = rep(fs, A_MATSET, A_MATSET + "\n" + POST_MATSET, "matset");
    fs = rep(fs, A_ENDL, ENDL, "endl");
    var MP = THREE.ShaderChunk.lights_fragment_maps || "", A_MP = "getIBLRadiance( geometryViewDir, geometryNormal, material.roughness )";
    if (MP.indexOf(A_MP) >= 0) fs = rep(fs, "#include <lights_fragment_maps>", PRE_MAPS + (CS.parts.probe === 0 ? "" : PROBE) + MP.replace(A_MP, "getIBLRadiance( geometryViewDir, chsNL, chsRL )"), "maps"); else note("anchor", "maps chunk");
    fs = rep(fs, "#include <opaque_fragment>", DBG, "dbg");
    sh.fragmentShader = fs; bind(sh); return true;
  }
  CS.injectCh = injectCh;
  function shade(m, kind) {
    if (!m || m.__chs || !m.__chfx) return m;
    var wrapped = "_csmObc" in m, prev = wrapped ? m._userObc : m.onBeforeCompile, key0 = m.customProgramCacheKey;
    // with the room lights, charfx builds its light loops from LI's lights_fragment_begin (swapped in for that one call)
    m.onBeforeCompile = function (sh, r) { var lp = kind !== "ext" && liOk() ? liParts() : null, sv = THREE.ShaderChunk.lights_fragment_begin;
      if (lp) THREE.ShaderChunk.lights_fragment_begin = lp.lb;
      try { if (prev) prev.call(this, sh, r); } finally { if (lp) THREE.ShaderChunk.lights_fragment_begin = sv; }
      try { injectCh(sh, kind, lp); } catch (e) { note("inject", e); } };
    m.customProgramCacheKey = function () { return (typeof key0 === "function" ? key0.call(this) : "") + "|chs2" + (kind !== "ext" && liOk() ? "li" : ""); };
    m.__chs = true; m.userData.chs = kind; m.__chsPrev = prev; m.__chsKey0 = key0; m.needsUpdate = true; CS.n.mats++; return m;
  }
  CS.shade = shade;

  // the procedural grooms (plan_avatar.js): their R11 / R16 hair cards keep 0.22 of their reflections; give them the fibre lobes
  var G_ENDL = "reflectedLight.indirectSpecular *= 0.22 * avSm;";
  var G_MAPS = [
    "{ float k = uChsK.x * uChsK.z; vec3 V = geometryViewDir, N = geometryNormal, T = avT; vec3 Nf = V - T * dot(T, V); float lf = length(Nf); Nf = lf > 1e-4 ? Nf / lf : N;",
    "  chsNL = normalize(mix(N, normalize(normalize(mix(N, Nf, 0.7)) + T * 0.07), k)); chsRL = mix(material.roughness, 0.42, k); }",
    ""
  ].join("\n");
  var G_NEW = [
    "{ vec3 chsB = reflectedLight.indirectSpecular; float k = uChsK.x * uChsK.z;",
    "  reflectedLight.indirectSpecular = mix(chsB * 0.22 * avSm, chsB * (1.0 + max(material.diffuseColor, vec3(0.0)) * 4.0) * (0.35 + 0.65 * avSm) * 0.6, k); }"
  ].join("\n");
  function injectGroom(sh) {
    var fs = sh.fragmentShader; if (fs.indexOf(G_ENDL) < 0 || fs.indexOf("uniform vec4 uChsK;") >= 0) return false;
    fs = rep(fs, "#include <common>", "#include <common>" + F_COMMON, "g common"); fs = rep(fs, G_ENDL, G_NEW, "g endl");
    // the cards read as strands: a per-strand tilt of the normal round the fibre (cards no longer shade as flat sheets), roots darker
    // than tips (the depth of the bundle), the highlight band brighter and kept (widened) at distance, less alpha growth with the mip
    fs = rep(fs, "#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nchsAA = saturate(1.0 - 4.0 * length(fwidth(normal))); normal = normalize(normal + cross(avT, normal) * ((avId - 0.5) * 0.55 * uChsK.z) + avT * ((avNz - 1.0) * 0.4 * uChsK.z));", "g strands");
    fs = rep(fs, "avSm = mix(0.18, 1.0, smoothstep(0.62, 0.97, avTx.r)); }", "avSm = mix(0.18, 1.0, smoothstep(0.62, 0.97, avTx.r)); }\ndiffuseColor.rgb *= mix(1.0, 0.7 + 0.3 * smoothstep(0.0, 0.55, vAvH.x), 0.8 * uChsK.z);", "g roots");
    fs = rep(fs, "(1.0 + lod * 0.32)", "(1.0 + lod * mix(0.32, 0.22, uChsK.z))", "g alpha");
    fs = rep(fs, "0.5 * uShade.x)", "0.5 * uShade.x * mix(1.0, mix(0.55, 1.0, chsAA), uChsK.z))", "g e1");
    fs = rep(fs, "0.5 * uShade.y)", "0.5 * uShade.y * mix(1.0, mix(0.6, 1.0, chsAA), uChsK.z))", "g e2");
    fs = rep(fs, "(s1 * uSpec.x + s2 * uSpec.y * avNz * material.diffuseColor * 3.0)", "(s1 * uSpec.x * mix(1.0, 2.4, uChsK.z) + s2 * uSpec.y * avNz * material.diffuseColor * mix(3.0, 4.8, uChsK.z))", "g spec");
    fs = rep(fs, "* sqrt(avDc) * avDc * 1.6", "* sqrt(avDc) * avDc * mix(1.6, 2.6, uChsK2.y)", "g trans");
    var MP = THREE.ShaderChunk.lights_fragment_maps || "", A_MP = "getIBLRadiance( geometryViewDir, geometryNormal, material.roughness )";
    if (MP.indexOf(A_MP) >= 0) fs = rep(fs, "#include <lights_fragment_maps>", G_MAPS + MP.replace(A_MP, "getIBLRadiance( geometryViewDir, chsNL, chsRL )"), "g maps");
    sh.fragmentShader = fs; bind(sh); return true;
  }
  function shadeGroom(m) {
    if (!m || m.__chs || !m.isMeshStandardMaterial) return m;
    var wrapped = "_csmObc" in m, prev = wrapped ? m._userObc : m.onBeforeCompile, key0 = m.customProgramCacheKey;
    m.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r); try { injectGroom(sh); } catch (e) { note("groom", e); } };
    var src = prev ? prev.toString() : "";
    m.customProgramCacheKey = function () { var k = typeof key0 === "function" && key0 !== THREE.Material.prototype.customProgramCacheKey ? key0.call(this) : src; return k + "|chsg1"; };
    m.__chs = true; m.userData.chs = "groom"; m.needsUpdate = true; CS.n.groom++; return m;
  }

  // ───────── install: outermost wrappers (after charfx's), so every R16 material is shaded before its first compile ─────────
  function wrapPatch() {   // plan_maytrixxx (and any module) calls PLAN_CHARFX.patch directly
    if (CS._pt || typeof CF.patch !== "function") return; var o = CF.patch; CS._pt = o;
    CF.patch = function (m, opt) { var r = o.apply(this, arguments); try { shade(r || m, opt && opt.kind === "rig" ? "rig" : "char"); } catch (e) { note("patch", e); } return r; };
  }
  function wrapExt() {   // plan_avatar's scalp shell and hats take the lighting model inside their own hook
    if (CS._ex || typeof CF.ext !== "function") return; var o = CF.ext; CS._ex = o;
    CF.ext = function (sh, kind) { var r = o.apply(this, arguments); if (r) { try { if (injectCh(sh, "ext")) CS.n.ext++; } catch (e) { note("ext", e); } } return r; };
  }
  function wrapGroom() {
    var AV = window.PLAN_AVATAR; if (CS._hm || !AV || typeof AV.hairMat !== "function") return; var o = AV.hairMat; CS._hm = o;
    AV.hairMat = function () { var m = o.apply(this, arguments); try { shadeGroom(m); } catch (e) { note("hairMat", e); } return m; };
  }
  function wrapTint() {
    if (CS._tint || !CF._tint || typeof window.tintMaterial !== "function") return !!CS._tint; var o = window.tintMaterial; CS._tint = o;
    window.tintMaterial = function () { var m = o.apply(this, arguments); try { if (shade(m, "char") === m && m.__chs) CS.n.tint++; } catch (e) { note("tint", e); } return m; };
    return true;
  }
  // people rigs outside charfx's list (the R19 partners: Joe of Freedom Air, the booth host): the same R16 rig step as charfx's own
  // (CSM material, body regions from the bones, per-rig skin chroma from the atlas: scratchpad r19ch/skinref.py), then shaded
  var XR = CS.XR = {
    joe: { cb: -0.0515, cr: 0.0919, sd: 0.0157, y10: 0.537, y90: 0.8, torso: 3, legs: 2, h: 1.78 },
    host: { cb: -0.0806, cr: 0.0965, sd: 0.0122, y10: 0.242, y90: 0.659, torso: 3, legs: 2, h: 1.7 }
  };
  var XR_RE = /\/(models|models_m)\/(?:lod\/)?(joe|host)\.glb/;
  function regionAttr(mesh) {
    var g = mesh.geometry; if (!g || g.getAttribute("aCh")) return; var si = g.getAttribute("skinIndex"), sw = g.getAttribute("skinWeight"); if (!si || !sw || !mesh.skeleton) return;
    var cls = mesh.skeleton.bones.map(function (b) { var n = b.name || ""; return /^(Head|head|neck|Neck|HeadTop)/.test(n) ? 0 : /(Hand|ForeArm|Thumb|Index|Middle|Ring|Pinky)/.test(n) ? 1 : /(Foot|Toe)/.test(n) ? 2 : /(UpLeg|Leg)/.test(n) ? 3 : -1; });
    var n = si.count, out = new Uint8Array(n * 4), acc = [0, 0, 0, 0];
    for (var i = 0; i < n; i++) { acc[0] = acc[1] = acc[2] = acc[3] = 0; for (var k = 0; k < 4; k++) { var w = sw.getComponent(i, k); if (w <= 0) continue; var c = cls[si.getComponent(i, k)]; if (c >= 0) acc[c] += w; } for (k = 0; k < 4; k++) out[i * 4 + k] = Math.max(0, Math.min(255, Math.round(acc[k] * 255))); }
    g.setAttribute("aCh", new THREE.BufferAttribute(out, 4, true));
  }
  function rigU(R, mesh) {
    var g = mesh.geometry, P = g.getAttribute("position"), A = g.getAttribute("aCh"); if (!g.boundingBox) g.computeBoundingBox(); var bb = g.boundingBox, hgt = bb.max.y - bb.min.y, sc = hgt > 0.01 ? R.h / hgt : 1;
    var top = -1e9, sx = 0, sy = 0, sz = 0, nh = 0, hx = 0, hy = R.h - 0.12, hz = 0;
    if (A) for (var i = 0; i < P.count; i += 3) { if (A.getX(i) < 0.6) continue; var y = P.getY(i) * sc; if (y > top) top = y; sx += P.getX(i) * sc; sy += y; sz += P.getZ(i) * sc; nh++; }
    if (nh > 20) { hx = sx / nh; hy = sy / nh; hz = sz / nh - 0.01; } else top = bb.max.y * sc;
    var eyeY = top - 0.125;
    return { s: { value: sc }, skin: { value: new THREE.Vector4(R.cb, R.cr, Math.max(0.026, R.sd * 2.6), 0) }, lum: { value: new THREE.Vector4(R.y10, R.y90, 0, 0) }, cls: { value: new THREE.Vector4(R.torso, R.legs, 4, 0) },
      head: { value: new THREE.Vector4(hx, hy, hz, 0) }, eye: { value: new THREE.Vector4(eyeY + 0.025, eyeY, 0, 0) } };
  }
  function extraRig(name, gltf) {
    var R = XR[name], seen = new Map(); CS.n.xrig = (CS.n.xrig || 0) + 1;
    gltf.scene.traverse(function (o) {
      if (!o.isSkinnedMesh || !o.material || Array.isArray(o.material)) return;
      try { regionAttr(o); var m0 = o.material, m = seen.get(m0);
        if (!m) { m = m0; if ((!CF.sw || CF.sw.csm) && typeof wrapMat === "function" && !("_csmObc" in m0)) { var w = wrapMat(m0); if (w && "_csmObc" in w) m = w; }
          CF.patch(m, { kind: "rig", rig: name, u: rigU(R, o) }); m.userData.chRig = name; seen.set(m0, m); }
        o.material = m; } catch (e) { note("rig " + name, e); }
    });
  }
  function rigScene(gltf, url) { if (!gltf || !gltf.scene) return; var xm = XR_RE.exec(url || ""); if (xm) extraRig(xm[2], gltf); curvQueue(gltf.scene); gltf.scene.traverse(function (o) { if (!o.isMesh || !o.material || Array.isArray(o.material)) return; var m = o.material; if (m.__chfx && !m.__chs) { shade(m, m.userData.chfx === "rig" ? "rig" : "char"); CS.n.rigs++; } }); }
  function wrapLoader() {
    if (CS._gl || !CF._gl || typeof window.gltfLoader !== "function") return !!CS._gl; var orig = window.gltfLoader; CS._gl = orig;
    window.gltfLoader = function () {
      var l = orig.apply(this, arguments); if (!l || l.__chs) return l; var ld = l.load; l.__chs = true;
      l.load = function (url, onLoad, onProgress, onError) { return ld.call(this, url, function (gltf) { try { rigScene(gltf, url); } catch (e) { note("rig", e); } if (onLoad) onLoad(gltf); }, onProgress, onError); };
      return l;
    };
    return true;
  }
  wrapPatch(); wrapExt(); wrapGroom();
  function install() { try { var a = wrapTint(), b = wrapLoader(); wrapBlob(); if (a && b) CS.installed = true; } catch (e) { note("install", e); } return false; }
  // pushed (not unshifted): charfx's own install runs first in each list, so these wrappers sit outside its own
  H.plan.push({ name: "charshadePlan", fn: install }); H.terrain.push({ name: "charshadeTerrain", fn: install }); H.world.push({ name: "charshadeWorld", fn: install });
  // safety net: an R16 material that reached the scene some other way (counted; it compiles once more)
  function sweep() { try { if (typeof scene === "undefined") return; scene.traverse(function (o) { if (!o.isSkinnedMesh) return; var m = o.material; if (m && !Array.isArray(m) && m.__chfx && !m.__chs) { shade(m, m.userData.chfx === "rig" ? "rig" : "char"); CS.n.late++; } if (m && m.__chs && !o.geometry.getAttribute("aChsC") && !CSEEN.has(o.geometry)) { CSEEN.add(o.geometry); CQ.push(o.geometry); } }); } catch (e) { note("sweep", e); } }
  H.defer.push({ name: "charshadeDefer", fn: function () { install(); sweep(); return false; } });
  CS.sweep = sweep; CS.install = install;

  // ───────── curvature per vertex (folds, creases): one geometry a frame, from the welded bind-pose surface ─────────
  var CQ = [], CSEEN = new WeakSet();
  function curvQueue(root) { if (!root) return; root.traverse(function (o) { if (o.isSkinnedMesh && o.geometry && !CSEEN.has(o.geometry) && !o.geometry.getAttribute("aChsC")) { CSEEN.add(o.geometry); CQ.push(o.geometry); } }); }
  function curvAttr(g) {
    var P = g.getAttribute("position"), Nn = g.getAttribute("normal"); if (!P || !Nn) return; var n = P.count; if (!g.boundingBox) g.computeBoundingBox(); var bb = g.boundingBox, hgt = Math.max(1e-4, bb.max.y - bb.min.y);
    var q = 2e4 / hgt, map = new Map(), wi = new Int32Array(n), nw = 0, px = [], py = [], pz = [], nx = [], ny = [], nz = [];
    for (var i = 0; i < n; i++) { var x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = Math.round(x * q) + "," + Math.round(y * q) + "," + Math.round(z * q); var w = map.get(k);
      if (w === undefined) { w = nw++; map.set(k, w); px.push(x); py.push(y); pz.push(z); nx.push(0); ny.push(0); nz.push(0); } wi[i] = w; nx[w] += Nn.getX(i); ny[w] += Nn.getY(i); nz[w] += Nn.getZ(i); }
    for (w = 0; w < nw; w++) { var l = Math.hypot(nx[w], ny[w], nz[w]) || 1; nx[w] /= l; ny[w] /= l; nz[w] /= l; }
    var S = new Float32Array(nw), C = new Float32Array(nw), I = g.index, tn = I ? I.count : n;
    var edge = function (a, b) { var dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a], d2 = dx * dx + dy * dy + dz * dz; if (d2 < 1e-14) return; var c = ((nx[b] - nx[a]) * dx + (ny[b] - ny[a]) * dy + (nz[b] - nz[a]) * dz) / d2; S[a] += c; C[a]++; S[b] += c; C[b]++; };
    for (var t = 0; t + 2 < tn; t += 3) { var a = wi[I ? I.getX(t) : t], b = wi[I ? I.getX(t + 1) : t + 1], c = wi[I ? I.getX(t + 2) : t + 2]; edge(a, b); edge(b, c); edge(c, a); }
    var sc = hgt / 1.75, out = new Float32Array(n); for (i = 0; i < n; i++) { w = wi[i]; out[i] = C[w] ? Math.max(-250, Math.min(250, S[w] / C[w] * sc)) : 0; }
    g.setAttribute("aChsC", new THREE.BufferAttribute(out, 1)); CS.n.curv = (CS.n.curv || 0) + 1;
  }
  function curvStep() { var t0 = performance.now(); while (CQ.length && performance.now() - t0 < 6) { var g = CQ.shift(); try { curvAttr(g); } catch (e) { note("curv", e); } } }
  CS.curvQueue = curvQueue;

  // ───────── the emitters probe: the light of the glowing things round the camera's subject that the 11-slot light pool drops ─────────
  // (festoon bulbs, LED lines, glowing lamp heads and signs: every emissive surface as small Lambertian emitters, emissive radiance x
  // area x cos / d^2; and the lamps beyond the pool's nearest eight), summed at the subject: the directional part becomes one light of
  // the character model, the rest irradiance. Indoors LI's room lights take over (the probe is off).
  var EP = CS.ep = { list: [], at: -1e9, c: new THREE.Vector3(1e9, 0, 0), frame: 0, K: 2.5, R: 18, n: 0, ms: 0, tris: 0 };
  var _v = new THREE.Vector3(), _b = new THREE.Box3(), _m = new THREE.Matrix4(), _c = new THREE.Vector3(), _s = new THREE.Vector3();
  function epBuild(o, m) {
    var g = o.geometry, P = g && g.getAttribute("position"); if (!P) return null; var I = g.index, tn = I ? I.count / 3 : P.count / 3; var step = Math.max(1, Math.ceil(tn / 2500));
    var inst = o.isInstancedMesh ? Math.min(o.count, 64) : 1, istep = o.isInstancedMesh ? Math.max(1, Math.floor(o.count / inst)) : 1, two = m.side === THREE.DoubleSide;
    var L = Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * m.emissiveIntensity * (m.emissiveMap ? 0.6 : 1); var col = [m.emissive.r / Math.max(1e-4, Math.max(m.emissive.r, m.emissive.g, m.emissive.b)), m.emissive.g / Math.max(1e-4, Math.max(m.emissive.r, m.emissive.g, m.emissive.b)), m.emissive.b / Math.max(1e-4, Math.max(m.emissive.r, m.emissive.g, m.emissive.b))];
    var pos = [], an = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), M = new THREE.Matrix4();
    for (var ii = 0; ii < inst; ii++) { if (o.isInstancedMesh) { o.getMatrixAt(ii * istep, M); M.premultiply(o.matrixWorld); } else M.copy(o.matrixWorld);
      for (var t = 0; t < tn; t += step) { var i0 = I ? I.getX(t * 3) : t * 3, i1 = I ? I.getX(t * 3 + 1) : t * 3 + 1, i2 = I ? I.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(P, i0).applyMatrix4(M); b.fromBufferAttribute(P, i1).applyMatrix4(M); c.fromBufferAttribute(P, i2).applyMatrix4(M);
        e1.subVectors(b, a); e2.subVectors(c, a); e1.cross(e2).multiplyScalar(0.5 * step * istep); if (e1.lengthSq() < 1e-12) continue;
        pos.push((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3); an.push(e1.x, e1.y, e1.z); } }
    return { o: o, L: L, col: col, two: two, pos: new Float32Array(pos), an: new Float32Array(an) };
  }
  var EPC = new WeakMap();
  function epGather(c) {
    var out = [], R2 = 45 * 45; scene.traverse(function (o) {
      if (!o.isMesh || o.isSkinnedMesh || !o.visible || !o.material || Array.isArray(o.material)) return; var m = o.material; if (!m.emissive || !(m.emissiveIntensity > 0) || m.transparent) return;
      var L = Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * m.emissiveIntensity; if (L < 0.25) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); var bs = o.geometry.boundingSphere; if (!bs) return; _v.copy(bs.center).applyMatrix4(o.matrixWorld); var r = bs.radius * o.matrixWorld.getMaxScaleOnAxis();
      if (_v.distanceToSquared(c) > (45 + r) * (45 + r)) return; for (var p = o.parent; p && p !== scene; p = p.parent) if (!p.visible) return;
      var E = EPC.get(o); if (!E || E.mat !== m) { E = epBuild(o, m); if (!E) return; E.mat = m; EPC.set(o, E); } E.L = L * (m.emissiveMap ? 0.6 : 1); out.push(E); });
    EP.list = out; EP.at = performance.now(); EP.c.copy(c); EP.n = out.length; var t = 0; out.forEach(function (E) { t += E.pos.length / 3; }); EP.tris = t;
  }
  var PROBE_V = new THREE.Vector3(), PROBE_S = new THREE.Vector3();
  function epUpdate() {
    if (typeof scene === "undefined" || typeof camera === "undefined" || !U.k3.value.y) { U.np.value.w = 0; return; }
    var t0 = performance.now(); var c = _c;
    if (typeof inside !== "undefined" && inside) { U.np.value.w = 0; return; }
    if (window.__cam && window.__cam.length >= 6) c.set(__cam[3], __cam[4], __cam[5]); else if (typeof player !== "undefined" && player) c.set(player.position.x, player.position.y + 1.45, player.position.z); else return;
    if (performance.now() - EP.at > 4000 || EP.c.distanceTo(c) > 10) epGather(c);
    var V = PROBE_V.set(0, 0, 0), S = PROBE_S.set(0, 0, 0), sl = 0, R2 = 32 * 32;
    for (var e = 0; e < EP.list.length; e++) { var E = EP.list[e], P = E.pos, A = E.an, L = E.L, cr = E.col;
      for (var i = 0; i < P.length; i += 3) { var dx = P[i] - c.x, dy = P[i + 1] - c.y, dz = P[i + 2] - c.z, d2 = dx * dx + dy * dy + dz * dz; if (d2 > R2) continue; var d = Math.sqrt(Math.max(d2, 0.09));
        var ce = -(A[i] * dx + A[i + 1] * dy + A[i + 2] * dz) / d; if (E.two) ce = Math.abs(ce); if (ce <= 0) continue; var w = L * ce / Math.max(d2, 0.09);
        S.x += w * cr[0]; S.y += w * cr[1]; S.z += w * cr[2]; var lu = w * (0.2126 * cr[0] + 0.7152 * cr[1] + 0.0722 * cr[2]); sl += lu; V.x += lu * dx / d; V.y += lu * dy / d; V.z += lu * dz / d; } }
    // the lamps the pool does not carry (its eight nearest points and three spots are lights already)
    try { var pl = LIGHTS.pool, sp = LIGHTS.spool; for (var j = 0; j < LIGHTS.src.length; j++) { var l = LIGHTS.src[j], I0 = l._intensity !== undefined ? l._intensity : l.intensity; if (!(I0 > 0.001)) continue;
        l.getWorldPosition(_v); var inPool = false, arr = l.isSpotLight ? sp : pl; for (var q = 0; q < arr.length; q++) if (arr[q].intensity > 0 && arr[q].position.distanceToSquared(_v) < 1e-4) { inPool = true; break; } if (inPool) continue;
        var dx2 = _v.x - c.x, dy2 = _v.y - c.y, dz2 = _v.z - c.z, dd2 = dx2 * dx2 + dy2 * dy2 + dz2 * dz2, dd = Math.sqrt(dd2); if (dd > 40) continue;
        var fall = 1 / Math.max(Math.pow(dd, l.decay || 2), 0.01); if (l.distance > 0) { var r4 = Math.pow(dd / l.distance, 4); fall *= Math.pow(Math.max(0, 1 - r4), 2); } if (fall <= 0) continue;
        var w2 = I0 * fall; S.x += w2 * l.color.r; S.y += w2 * l.color.g; S.z += w2 * l.color.b; var lu2 = w2 * (0.2126 * l.color.r + 0.7152 * l.color.g + 0.0722 * l.color.b); sl += lu2; V.x += lu2 * dx2 / dd; V.y += lu2 * dy2 / dd; V.z += lu2 * dz2 / dd; } } catch (x) {}
    var vl = V.length(); if (!(sl > 1e-5) || !(vl > 1e-6)) { U.np.value.w = 0; EP.ms = performance.now() - t0; return; }
    var dirK = Math.min(1, vl / sl), K = EP.K; U.n.value.set(V.x / vl, V.y / vl, V.z / vl, (1 - dirK) * 0.5 / Math.max(dirK, 0.05));
    U.nc.value.set(S.x * dirK * K, S.y * dirK * K, S.z * dirK * K, sl); U.np.value.set(c.x, c.y, c.z, EP.R); EP.ms = performance.now() - t0;
  }
  CS.epUpdate = epUpdate;

  // ───────── contact occlusion under the feet (high, ultra; where the client's blob shadow is off): a soft disc on the ground ─────────
  var FT = CS.foot = { list: [], mat: null, geo: null, op: 0.62, n: 0 };
  function footMat() { if (FT.mat) return FT.mat; var cv = document.createElement("canvas"); cv.width = cv.height = 128; var x = cv.getContext("2d"); var gr = x.createRadialGradient(64, 64, 2, 64, 64, 62); gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(0.35, "rgba(0,0,0,0.34)"); gr.addColorStop(0.7, "rgba(0,0,0,0.1)"); gr.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; FT.mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, opacity: FT.op }); FT.mat.name = "chsFoot"; FT.geo = new THREE.PlaneGeometry(0.82, 0.82); FT.geo.rotateX(-Math.PI / 2); return FT.mat; }
  function wrapBlob() {
    if (CS._bl || typeof window.addBlob !== "function") return !!CS._bl; var o = window.addBlob; CS._bl = o;
    window.addBlob = function (g) { var r = o.apply(this, arguments); try { if (g && !g.userData.chsFoot) { var d = new THREE.Mesh(FT.geo || (footMat(), FT.geo), footMat()); d.position.y = 0.02; d.renderOrder = 2; d.frustumCulled = false; d.userData.noSolid = true; d.userData.noShadow = true; d.castShadow = false; d.visible = false; d.name = "chs foot"; g.add(d); g.userData.chsFoot = d; FT.list.push(g); }
        curvQueue(g); } catch (e) { note("foot", e); } return r; };
    return true;
  }
  var _hp = new THREE.Vector3(), _gp = new THREE.Vector3();
  function footStep() {
    if (!FT.list.length || typeof camera === "undefined") return; var cp = camera.position, keep = [], n = 0;
    for (var i = 0; i < FT.list.length; i++) { var g = FT.list[i], d = g.userData.chsFoot; if (!g.parent || !d) continue; keep.push(g);
      var b = g.userData.blob, show = g.visible && !(b && b.visible) && !g.userData.sit && CS.abOn !== false; if (show) { g.getWorldPosition(_gp); show = _gp.distanceToSquared(cp) < 40 * 40; }
      if (show) { var h = g.userData.chsHips; if (h === undefined) { h = null; g.traverse(function (q) { if (!h && q.isBone && /hips$/i.test(q.name)) h = q; }); g.userData.chsHips = h; }
        if (h) { h.getWorldPosition(_hp); show = _hp.y - _gp.y > 0.72 * (g.scale.y || 1); } }   // seated or lying: no disc under the seat
      d.visible = !!show; if (show) n++; }
    FT.list = keep; FT.n = n;
  }
  H.frame.push({ name: "charshadeFrame", fn: function () { try { EP.frame++; curvStep(); if (EP.frame % 4 === 0) epUpdate(); if (EP.frame % 6 === 0) footStep(); } catch (e) { note("frame", e); } return false; } });

  // ───────── runtime ─────────
  CS.ab = function (on) { if (on) { U.k.value.fromArray(K0); U.k2.value.set(K20[0], K20[1], U.k2.value.z, K20[3]); U.k3.value.fromArray(K30); } else { U.k.value.set(0, 0, 0, 0); U.k2.value.set(0, 0, U.k2.value.z, 0); U.k3.value.set(0, 0, 0, 0); } CS.abOn = !!on; if (CS.foot) CS.foot.mat.opacity = on ? CS.foot.op : 0; return on; };
  CS.set = function (i, v) { var a = U.k.value.toArray().concat(U.k2.value.toArray(), U.k3.value.toArray()); a[i] = v; U.k.value.fromArray(a.slice(0, 4)); U.k2.value.fromArray(a.slice(4, 8)); U.k3.value.fromArray(a.slice(8)); return a; };
  CS.debug = { view: function (n) { U.k2.value.z = +n || 0; return U.k2.value.z; },
    count: function () { var o = {}; scene.traverse(function (x) { if (!x.isSkinnedMesh || !x.material) return; var m = x.material; var k = (m.userData && m.userData.chs) || (m.__chfx ? "chfxOnly" : "other"); o[k] = (o[k] || 0) + 1; }); return o; } };
})();
