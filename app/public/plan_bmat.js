// R16 BUILDING MATERIALS (Agent M, HANDOFF_R16_BUILDINGS.md): the building material pass, applied at runtime on every module's
//   building shells. What it adds (high and ultra only; medium and low compile exactly the R15 shaders):
//   - a tileable detail layer (tex/bm_detail: mineral micro normal, wood/metal grain, roughness breakup) faded in within ~20 m,
//     so walls, timber and metal stay crisp up close instead of turning into smooth flat colour;
//   - a broad macro tone and roughness variation (ultra), so long walls and roofs do not read as one flat value;
//   - a grime gradient at the foot of every wall (splash and dust, darker and warmer) and contact occlusion on the indirect
//     light there and under soffits and porch ceilings;
//   - dust on up-facing surfaces (roofs, copings, sills, ledges): lighter, rougher, less metallic;
//   - Fresnel glass: the reflection takes over toward grazing angles, the diffuse fades, as real glass does.
//   plan_ext_town.js (town + the civic rebuilds) and plan_ext_homes.js build this into their own shaders (same uniforms); the other
//   modules' exterior materials (convention campus, Market Hall, domes, body shop, hangars, terminal, the remaining old building
//   models) are patched here by chaining onBeforeCompile (their own hooks run first, the program key keeps them distinct).
//   Switches: ?bmat=0 off (R15 shaders); ?bmatk=1 also patches the other modules' largest material signature (+7 programs, off by
//   default for the program budget); ?bmatx=0 skips the other modules entirely; PLAN_BMAT.ab(false/true)
//   swaps the pass off and on in a running session without recompiling (a uniform), for A/B shots and timing.
//   Classic script, loaded before client.js.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_BMAT = window.PLAN_BMAT || { v: "r16-0", errs: [], n: {} };
(function () {
  "use strict";
  var B = window.PLAN_BMAT; B.v = "r16m-1"; B.errs = B.errs || []; B.n = B.n || {};
  function note(tag, e) { try { if (B.errs.length < 40) B.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (B.errs.length <= 6) console.warn("plan_bmat " + tag, e); } catch (x) {} }
  function au(u) { try { if (window.AV) return window.AV(u); } catch (e) {} return u; }
  var Q = location.search;
  var TIER = (function () { try { var q = localStorage.getItem("g1:quality"); if (q) return q; } catch (e) {} return ((navigator.hardwareConcurrency || 8) <= 4 || /Android|iPhone|iPad/i.test(navigator.userAgent)) ? "medium" : "high"; })();
  B.tier = TIER;
  if (/[?&]bmat=0\b/.test(Q)) { B.off = true; B.why = "?bmat=0"; return; }
  if (TIER !== "high" && TIER !== "ultra") { B.off = true; B.why = "tier " + TIER; return; }
  var ULTRA = TIER === "ultra";
  // shared uniforms (the town, homes and civic shaders bind these same objects)
  function flat() { var t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 128]), 1, 1); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t; }
  // uBmQ: x, y = the detail fade (m from the camera), z = macro layer on (1), w = spare
  B.U = { tDet: { value: flat() }, uBm: { value: 1 }, uBmQ: { value: new THREE.Vector4(ULTRA ? 3.0 : 2.0, ULTRA ? 22.0 : 14.0, ULTRA ? 1.0 : 0.0, 0.0) } };

  // ───────────────────────── the detail map: KTX2 (UASTC, BC7 on the GPU, 1.4 MB) or the PNG fallback ─────────────────────────
  function setTex(t, src) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.colorSpace = THREE.NoColorSpace;
    try { t.anisotropy = Math.min(ULTRA ? 16 : 8, renderer.capabilities.getMaxAnisotropy()); } catch (e) { t.anisotropy = 8; } t.name = "bm_detail"; t.userData.avShared = true; t.needsUpdate = true; B.U.tDet.value = t; B.n.tex = src; B.n.texAt = Math.round(performance.now()); }
  function png() { try { var t = new THREE.TextureLoader().load(au("/tex/bm_detail.png?v=" + (window.BUILD || "dev")), function (tt) { setTex(tt, "png"); }, undefined, function (e) { note("detail png", e); }); } catch (e) { note("detail png", e); } }
  function loadTex() { if (B.texStarted) return; B.texStarted = true; var k = null; try { k = typeof ktx2Loader === "function" ? ktx2Loader() : null; } catch (e) { k = null; }
    if (!k || /[?&]bmktx=0\b/.test(Q)) { png(); return; } var tries = 0;
    var one = function () { tries++; k.load(au("/tex/bm_detail.ktx2?v=" + (window.BUILD || "dev") + (tries > 1 ? "&r=" + tries : "")), function (t) { setTex(t, "ktx2"); }, undefined, function (e) { if (tries < 2) { setTimeout(one, 2500); return; } note("detail ktx2", e); png(); }); };
    one(); }

  // ───────────────────────── the generic exterior patch (other modules' building materials) ─────────────────────────
  // per material uBmK: x detail type (1 mineral, 2 grain), y detail strength, z grime and contact occlusion, w dust
  var GV = "varying vec3 vBmW; varying float vBmH;";
  var GVM = "{ vec4 bw = vec4(transformed, 1.0); vec4 bo = vec4(0.0, 0.0, 0.0, 1.0);\n#ifdef USE_INSTANCING\n bw = instanceMatrix * bw; bo = instanceMatrix * bo;\n#endif\n bw = modelMatrix * bw; bo = modelMatrix * bo; vBmW = bw.xyz; vBmH = bw.y - bo.y; }";
  var GF = "uniform sampler2D tDet; uniform float uBm; uniform vec4 uBmQ; uniform vec4 uBmK; varying vec3 vBmW; varying float vBmH; float bmAO2;";
  var GFM = [
    "{ vec3 gnV = normalize(vNormal); vec3 gn = normalize((vec4(gnV, 0.0) * viewMatrix).xyz); vec3 an = abs(gn); vec2 buv; vec3 bT; vec3 bB;",
    "  if (an.y > an.x && an.y > an.z) { buv = vBmW.xz; bT = vec3(1.0, 0.0, 0.0); bB = vec3(0.0, 0.0, 1.0); } else if (an.x > an.z) { buv = vBmW.zy; bT = vec3(0.0, 0.0, 1.0); bB = vec3(0.0, 1.0, 0.0); } else { buv = vBmW.xy; bT = vec3(1.0, 0.0, 0.0); bB = vec3(0.0, 1.0, 0.0); }",
    "  float bF = (1.0 - smoothstep(uBmQ.x, uBmQ.y, length(vViewPosition))) * uBm * uBmK.y; vec2 bdu = buv * 1.65; vec2 bg1 = dFdx(bdu), bg2 = dFdy(bdu); vec4 bd = vec4(0.5); if (bF > 0.002) bd = textureGrad(tDet, bdu, bg1, bg2);",
    "  float bMac = 0.5; if (uBmQ.z > 0.5) bMac = texture2D(tDet, vBmW.xz * 0.021 + vec2(vBmW.y * 0.013, -vBmW.y * 0.011)).a;",
    "  vec2 dn = uBmK.x < 1.5 ? bd.rg * 2.0 - 1.0 : vec2(0.0, bd.b * 2.0 - 1.0) * 0.8;",
    "  vec3 bnW = normalize((vec4(normal, 0.0) * viewMatrix).xyz); bnW = normalize(bnW + (bT * dn.x + bB * dn.y) * bF * 0.62); normal = normalize((viewMatrix * vec4(bnW, 0.0)).xyz);",
    "  roughnessFactor = clamp(roughnessFactor * mix(1.0, 0.74 + 0.52 * bd.a, bF) * mix(1.0, 0.92 + 0.16 * bMac, uBm), 0.04, 1.0);",
    "  float wall = 1.0 - smoothstep(0.55, 0.85, an.y); float gh = 0.4 + 0.4 * bMac;",
    "  float gr = (1.0 - smoothstep(gh * 0.35, gh, vBmH)) * step(-0.4, vBmH) * wall * uBm * uBmK.z;",
    "  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.74, 0.66, 0.56) + vec3(0.025, 0.018, 0.012), gr * 0.55); roughnessFactor = min(1.0, roughnessFactor + gr * 0.08);",
    "  bmAO2 = mix(1.0, mix(0.66, 1.0, smoothstep(0.0, 0.7, vBmH)), wall * uBm * uBmK.z) * mix(1.0, 0.78, smoothstep(-0.55, -0.9, gn.y) * uBm * uBmK.z);",
    "  float dust = smoothstep(0.62, 0.96, gn.y) * step(2.2, vBmH) * (0.2 + 0.45 * smoothstep(0.35, 0.75, bMac + 0.25 * (bd.a - 0.5))) * uBm * uBmK.w;",
    "  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.56, 0.49, 0.41) * (0.9 + 0.2 * bd.a), dust * 0.42); roughnessFactor = min(1.0, roughnessFactor + dust * 0.3); metalnessFactor *= 1.0 - dust * 0.6;",
    "  diffuseColor.rgb *= mix(1.0, 0.92 + 0.16 * bMac, uBm * uBmQ.z); }"
  ].join("\n");
  var GFE = "#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= bmAO2; reflectedLight.indirectSpecular *= mix(1.0, bmAO2, 0.7);";
  var GLF = "#include <lights_fragment_end>\n{ float gNV = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0); float gF = 0.04 + 0.96 * pow(1.0 - gNV, 5.0); diffuseColor.a = mix(diffuseColor.a, min(1.0, diffuseColor.a + (1.0 - diffuseColor.a) * gF * 0.9 + 0.04), uBm); reflectedLight.indirectSpecular *= mix(1.0, 1.2, uBm); reflectedLight.directDiffuse *= 1.0 - gF * uBm; reflectedLight.indirectDiffuse *= 1.0 - gF * uBm; }";
  function isGlass(m) { return !!m.transparent && (m.opacity === undefined || m.opacity < 0.7) && (/glass|pane|win/i.test(m.name || "") || (m.roughness !== undefined && m.roughness < 0.2)); }
  function kindOf(m) { var nm = (m.name || "") + " " + ((m.map && m.map.name) || ""); if (/wood|timber|cedar|plank|glulam|board|oak|walnut|batten|deck|beam/i.test(nm)) return [2, 0.85]; if (/metal|steel|alu|chrome|iron|zinc|tin|copper|brass|corten/i.test(nm) || m.metalness > 0.5) return [2, 0.4]; if (/glow|emit|neon|led|sign|screen|light|lamp|led/i.test(nm)) return [0, 0]; return [1, 1]; }
  var DONE = new WeakSet();
  function patchMat(m, opt) {
    if (!m || DONE.has(m) || m.userData.bm16 || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) || m.isShaderMaterial) return 0;
    if (m.userData.xhShell || /^xt_|^xh_|^xc_/.test(m.name || "")) return 0;   // built into those modules' own shaders
    if (m.flatShading || m.wireframe) return 0;
    var glass = isGlass(m); if (m.transparent && !glass) return 0;   // fades, decals, foliage cards
    var k = kindOf(m); if (!glass && !k[1]) return 0;
    DONE.add(m); m.userData.bm16 = true;
    // the client's CSM material class keeps the cascade hook and the user hook apart (and calls the user hook without `this`):
    // chain only the user hook, call it on the material itself, and keep the previous program key distinct
    var OBC0 = THREE.Material.prototype.onBeforeCompile, KEY0 = THREE.Material.prototype.customProgramCacheKey, prevU, baseKey;
    var ownKey = Object.prototype.hasOwnProperty.call(m, "customProgramCacheKey") ? m.customProgramCacheKey : null;
    if ("_csmObc" in m) { prevU = m._userObc || null; baseKey = ownKey ? ownKey.call(m) : ("csm" + (prevU ? "|" + prevU.toString() : "")); }
    else { var po = m.onBeforeCompile; prevU = po && po !== OBC0 ? po : null; var pk = ownKey || (m.customProgramCacheKey !== KEY0 ? m.customProgramCacheKey : null); baseKey = pk ? pk.call(m) : (prevU ? prevU.toString() : ""); }
    var uK = { value: new THREE.Vector4(k[0], k[1] * (opt.det === undefined ? 1 : opt.det), opt.grime === false ? 0 : 1, opt.dust === false ? 0 : 1) };
    m.userData.bmK = uK; m.userData.bmPrev = prevU;
    m.onBeforeCompile = function (sh, r) {
      if (prevU) prevU.call(m, sh, r);
      var U = B.U; sh.uniforms.uBm = U.uBm;
      if (glass) { sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uBm;").replace("#include <lights_fragment_end>", GLF); return; }
      sh.uniforms.tDet = U.tDet; sh.uniforms.uBmQ = U.uBmQ; sh.uniforms.uBmK = uK;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + GV).replace("#include <project_vertex>", "#include <project_vertex>\n" + GVM);
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + GF).replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" + GFM).replace("#include <lights_fragment_end>", GFE);
    };
    var key = baseKey + "|bm16" + (glass ? "g" : ""); m.customProgramCacheKey = function () { return key; };
    try { if (renderer && renderer.properties && renderer.properties.has && renderer.properties.has(m)) { m.dispose(); B.n.disposed = (B.n.disposed || 0) + 1; } } catch (e) {}
    m.needsUpdate = true; return 1;
  }
  // which scene groups are building exteriors (top-level children of the scene, by name), and the instanced old building kinds
  var GROUPS = /^(cv |cv_|conv_arena|mk_batch|mk_b_|domes_(?!interior|vault_interior|lights|steam|paths|bollards)|bs_exterior|bs pillars|hangar exterior|hangar doors|gbank_ex|gbank_court|stargaze_exterior|stargaze_observatory|arrivals apron|crossing_portals|sun_gate|frontier_arch|flight_gates|clubwalk_arcade|flight_deck_terrace|sp_park)/i;
  var NOT = /interior|_in_|\bin\b|room|inside|glow|beam|light|steam|path|plaza|walk|ground|grass|lawn|turf|bed|paver|dg\b/i;
  var KINDS = ["terminal", "fbo", "hangar", "hangarhome2", "hangarhome", "manor", "tower", "windmill", "gbarn", "livery", "arcade", "observatory", "bigtent", "amphitheater", "pavilion", "bandshell", "habitat", "hangar_exec", "pilothouse", "lodge_lobby", "mission", "dome", "flightdeck"];
  // program budget: a patched material compiles a new program variant, and a plain standard material usually shares its program
  // with props and characters (so its original stays). The pass therefore goes to the few material signatures (type, map set,
  // flags, instancing) that cover the most building surface: ?bmatk=N signatures. Default 0 (the R16 program budget: one signature
  // patches 9 materials of the Market Hall, the domes, the solar park and the arrivals apron for 7 more programs, ?bmatk=1).
  var KSIG = +((Q.match(/[?&]bmatk=(\d+)/) || [])[1] || 0); B.sigs = null;
  function sig(m, o) { var u = ("_csmObc" in m) ? m._userObc : (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ? m.onBeforeCompile : null);
    return [m.type, !!m.map, !!m.normalMap, !!m.roughnessMap, !!m.metalnessMap, !!m.aoMap, !!m.emissiveMap, !!m.alphaMap, !!m.vertexColors, !!m.transparent, m.side, u ? u.toString().length : 0, o.isInstancedMesh ? "i" : "", isGlass(m) ? "g" : ""].join("|"); }
  function triOf(o) { var g = o.geometry; if (!g || !g.attributes.position) return 0; return (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? Math.max(1, o.count) : 1); }
  function candidates(late) { var C = [];
    if (/[?&]bmatx=0\b/.test(Q)) return C;
    try { scene.children.forEach(function (g) { if (!g || g.userData.bm16 || !GROUPS.test(g.name || "") || NOT.test(g.name || "")) return; g.userData.bm16 = true;
        g.traverse(function (o) { if (!o.isMesh || o.userData.interior || NOT.test(o.name || "")) return; (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { if (m && !m.userData.bm16) C.push([m, o, g]); }); }); }); } catch (e) { note("scan groups", e); }
    try { KINDS.forEach(function (k) { var m = MODELS[k]; if (!m || m.xh || m.bm16) return; var parts = null; try { parts = m.proxy ? null : m.parts; } catch (e) {} if (!parts) return; m.bm16 = true; var S = null; try { S = INSTSET.find(function (q) { return q.kind === k; }); } catch (e) {}
        parts.forEach(function (p, i) { var im = S && S.insts && S.insts[i]; if (p.material) C.push([p.material, im || { isInstancedMesh: true, count: (PLACE[k] || []).length, geometry: p.geometry }, null]); }); }); } catch (e) { note("scan kinds", e); }
    return C; }
  function scan(late) {
    var t0 = performance.now(), mats = 0, groups = {}; var C = candidates(late);
    if (!B.sigs) { var area = {}; C.forEach(function (c) { var m = c[0]; if (!(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) || (m.transparent && !isGlass(m))) return; var k = sig(m, c[1]); area[k] = (area[k] || 0) + triOf(c[1]); });
      B.sigs = Object.keys(area).sort(function (a, b) { return area[b] - area[a]; }).slice(0, KSIG); B.n.sigTris = B.sigs.map(function (k) { return Math.round(area[k]); }); B.n.sigAll = Object.keys(area).length; }
    C.forEach(function (c) { var m = c[0]; if (B.sigs.indexOf(sig(m, c[1])) < 0) return; var r = patchMat(m, {}); mats += r; if (r && c[2]) groups[c[2].name] = c[2]; });
    if (late && mats && window.PLAN_PERF && PLAN_PERF.warmGroup) { for (var gn in groups) { try { PLAN_PERF.warmGroup(groups[gn], { name: "bmat " + gn }); } catch (e) {} } }
    B.n.scans = (B.n.scans || 0) + 1; B.n.mats = (B.n.mats || 0) + mats; B.n.seen = (B.n.seen || 0) + C.length; var gl = Object.keys(groups); if (gl.length) B.n.groups = (B.n.groups || []).concat(gl).filter(function (v, i, A) { return A.indexOf(v) === i; }).slice(0, 40);
    B.n.scanMs = Math.round((performance.now() - t0) * 10) / 10; return mats;
  }
  B.scan = scan; B.patchMat = patchMat;
  // streamed kinds: their full models are patched before the streamer's warm-up compiles them (R9p prep hook), so the swap adds
  // no program at the first draw; the stand-ins (proxies) are left alone
  try { var SP = window.PLAN_STREAM_PREP = window.PLAN_STREAM_PREP || {}; KINDS.forEach(function (k) { var prev = SP[k]; SP[k] = function (full) { if (prev) { try { prev(full); } catch (e) { note("prep chain " + k, e); } } if (B.off || /[?&]bmatx=0\b/.test(Q)) return; try { if (!B.sigs) return; (full.parts || []).forEach(function (p) { if (p.material && B.sigs.indexOf(sig(p.material, { isInstancedMesh: true, geometry: p.geometry })) >= 0) patchMat(p.material, {}); }); B.n.prep = (B.n.prep || 0) + 1; } catch (e) { note("prep " + k, e); } }; }); } catch (e) { note("prep hooks", e); }
  // exteriors that modules build after the defer hook (staged builds): a few late scans, then nothing
  var fc = 0;
  function frame() { fc++; if (fc > 7200 || (fc % 600) !== 0) return; try { scan(true); } catch (e) { note("frame", e); } }
  B.ab = function (on) { B.U.uBm.value = on ? 1 : 0; B.abOn = !!on; return on ? "on" : "off"; };
  B.stats = function () { return { tier: TIER, off: !!B.off, n: B.n, errs: B.errs.slice(0, 8), tex: B.n.tex || "placeholder", uBm: B.U.uBm.value }; };
  if (!B.hooked) { B.hooked = true; var H = window.PLAN_HOOKS;
    H.world.push({ name: "bmatWorld", fn: function () { try { loadTex(); } catch (e) { note("world", e); } } });
    H.defer.push({ name: "bmatDefer", fn: function () { try { scan(); } catch (e) { note("defer", e); } } });
    H.frame.push({ name: "bmatFrame", fn: frame }); }
})();
