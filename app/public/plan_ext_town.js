// R15 TOWN EXTERIORS (Agent C, 5 Oct 2026): crisp rebuilt exteriors for the town building kinds.
//   The early town models (store, storefront_sl, saloon, hotel, bank, chapel, diner, restaurant, gallery and the rest) were
//   generated meshes with one baked atlas each: blurry, blotchy and fragmented up close. This module draws every placed building
//   of those kinds "the new way": procedural shells built in each building's measured facade frame (the same frame and numbers
//   plan_porches.js uses, so the porch decks, posts, door corridors, the R14 rooms and the shop name boards still fit), clad in a
//   tiling PBR texture array (tex/xt_alb + tex/xt_nrm: lime plaster, clapboard, board and batten, weathered planks, brick,
//   corrugated and standing-seam metal, stucco, terrazzo, painted trim, sandstone ashlar, clay tile, glass block, metal, adobe,
//   concrete), with real window frames, muntins, sills, glazing, doors, cornices, false fronts, porches, awnings, signs, lamps
//   and downspouts, and colourways, trims and silhouettes picked per building so a street never repeats.
//   Drawing: one texture-array material (one program), the client's own glass material for the panes (its program already
//   exists), one sign material; everything merged per 160 m chunk and per material, plus a cheap far LOD per chunk. The old
//   instances are hidden through the client's SHELLS set (never drawn, so their atlases are never uploaded). While the player is
//   inside a building its vertices are collapsed in place (shadows included) and restored on the way out.
//   Classic script, loaded before client.js. ?xt=0 turns it off; ?xtk=store,saloon limits the kinds (testing).
//   window.PLAN_EXT_TOWN: n (counters), errs, stats(), rebuild(), chunks, bld (per building records).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var XT = window.PLAN_EXT_TOWN = window.PLAN_EXT_TOWN || {};
  XT.errs = XT.errs || []; XT.n = XT.n || {}; XT.ver = "r16m-1";
  if (/[?&]xt=0\b/.test(location.search)) { XT.off = true; return; }
  var ONLY = (location.search.match(/[?&]xtk=([a-z_,]+)/) || [])[1]; ONLY = ONLY ? ONLY.split(",") : null;
  var PI = Math.PI;
  function note(tag, e) { try { if (XT.errs.length < 60) XT.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (XT.errs.length <= 8) console.warn("plan_ext_town " + tag, e); } catch (x) {} }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function au(u) { try { if (window.AV) return window.AV(u); } catch (e) {} return u; }
  var LOW = (function () { try { var st = localStorage.getItem("g1:quality"); var weak = (navigator.hardwareConcurrency || 8) <= 4 || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.deviceMemory && navigator.deviceMemory <= 4); return st === "low" || (weak && st !== "high" && st !== "ultra"); } catch (e) { return false; } })();
  XT.low = LOW;
  // R16 (Agent M, HANDOFF_R16_BUILDINGS.md): the building material pass on this module's shells (detail normal and roughness up close,
  // macro tone, base grime and contact occlusion, dust on roofs and ledges, sheet and tile variation, Fresnel glass), high and ultra only
  var TIER = (function () { try { var q = localStorage.getItem("g1:quality"); if (q) return q; } catch (e) {} return ((navigator.hardwareConcurrency || 8) <= 4 || /Android|iPhone|iPad/i.test(navigator.userAgent)) ? "medium" : "high"; })();
  var BM = !/[?&]bmat=0\b/.test(location.search) && (TIER === "high" || TIER === "ultra"); XT.bm = BM; XT.tier = TIER;

  // ───────────────────────── the texture array (loaded as soon as this script runs) ─────────────────────────
  var NL = 16;   // layers in tex/xt_alb.jpg and tex/xt_nrm.jpg (stacked vertically, layer k = rows k*S..)
  var LY = { plaster: 0, clap: 1, batten: 2, wood: 3, brick: 4, corr: 5, seam: 6, stucco: 7, terrazzo: 8, trim: 9, ashlar: 10, rooftile: 11, gblock: 12, metal: 13, adobe: 14, concrete: 15 };
  // per layer: metalness, roughness multiplier, normal strength, paint (the vertex colour tints only the neutral, painted texels)
  var LP = [[0, 1, 1, 1], [0, 1, 1.1, 1], [0, 1, 1.1, 1], [0, 1, 1.2, 0], [0, 1, 1.1, 0], [0.4, 0.95, 1, 0], [0.45, 1, 1, 1], [0, 1, 1, 1], [0, 0.9, 0.8, 0], [0, 1, 0.8, 1], [0, 1, 1.1, 0], [0, 1, 1.1, 0], [0.1, 1, 1, 0], [0.8, 1, 0.6, 1], [0, 1, 1, 1], [0, 1, 1, 0]];
  var IMG = XT.img = XT.img || { a: null, n: null, ready: 0, size: LOW ? 512 : 1024 };
  function loadImg(url, key) { var im = new Image(); im.decoding = "async"; im.crossOrigin = "anonymous"; im.onload = function () { var d = im.decode ? im.decode() : Promise.resolve(); d.then(function () { IMG[key] = im; IMG.ready++; onTexReady(); }, function () { IMG[key] = im; IMG.ready++; onTexReady(); }); }; im.onerror = function (e) { note("tex " + key, url); }; im.src = au(url); }
  // desktop tiers: the two arrays as KTX2 (UASTC, transcoded to BC7: a quarter of the memory), loaded from the world hook through the
  // client's KTX2 loader; the low tier (and any failure) uses the JPEG strips (512 px layers on low)
  function startJpg() { if (IMG.jpg) return; IMG.jpg = true; IMG.started = true; var sfx = LOW ? "_m" : ""; loadImg("/tex/xt_alb" + sfx + ".jpg?v=" + (window.BUILD || "dev"), "a"); loadImg("/tex/xt_nrm" + sfx + ".jpg?v=" + (window.BUILD || "dev"), "n"); }
  if (!IMG.started && LOW) startJpg();
  function loadKtx() { if (IMG.started || IMG.done) return; IMG.started = true; var k = null; try { k = typeof ktx2Loader === "function" ? ktx2Loader() : null; } catch (e) { k = null; } if (!k || /[?&]xtktx=0\b/.test(location.search)) { startJpg(); return; }
    var got = {}, failed = false, tries = {}; function one(nm) { tries[nm] = (tries[nm] || 0) + 1; k.load(au("/tex/xt_" + nm + ".ktx2?v=" + (window.BUILD || "dev") + (tries[nm] > 1 ? "&r=" + tries[nm] : "")), function (t) { if (failed) return; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; try { t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); } catch (e) { t.anisotropy = 4; } t.userData.avShared = true; t.name = "xt_" + nm; t.needsUpdate = true; got[nm] = t;
        if (got.alb && got.nrm && U && !IMG.done) { U.tA.value = got.alb; U.tN.value = got.nrm; IMG.done = true; IMG.ktx = true; XT.n.texAt = Math.round(performance.now()); } }, undefined, function (e) { if (failed) return; if (tries[nm] < 2) { XT.n.ktxRetry = (XT.n.ktxRetry || 0) + 1; setTimeout(function () { one(nm); }, 2500); return; } failed = true; note("ktx2 " + nm, e); startJpg(); }); } one("alb"); one("nrm"); }
  var U = XT.U = XT.U || null;   // shared uniforms of the main material
  function placeholder(srgb, nl) { var NL = nl || 16; var d = new Uint8Array(4 * NL); for (var i = 0; i < NL; i++) { if (srgb) { d[i * 4] = 200; d[i * 4 + 1] = 196; d[i * 4 + 2] = 188; } else { d[i * 4] = 128; d[i * 4 + 1] = 128; d[i * 4 + 2] = 220; } d[i * 4 + 3] = 255; } var t = new THREE.DataArrayTexture(d, 1, 1, NL); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; }
  function arrayTex(img, srgb) { var S = IMG.size; var t = new THREE.DataArrayTexture(img, S, S, NL); t.image = { data: img, width: S, height: S, depth: NL }; t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; try { t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); } catch (e) { t.anisotropy = 4; }
    t.userData.avShared = true; t.name = srgb ? "xt_alb" : "xt_nrm"; t.needsUpdate = true;
    t.onUpdate = function () { try { t.image = { data: null, width: S, height: S, depth: NL }; } catch (e) {} };   // the decoded picture is not kept once it is on the GPU
    return t; }
  function onTexReady() { if (IMG.ready < 2 || !U || IMG.done || !IMG.jpg) return; try { if (typeof THREE === "undefined" || typeof renderer === "undefined") return; IMG.done = true; U.tA.value = arrayTex(IMG.a, true); U.tN.value = arrayTex(IMG.n, false); IMG.a = IMG.n = null; XT.n.texAt = Math.round(performance.now()); } catch (e) { note("tex upload", e); } }

  // ───────────────────────── materials ─────────────────────────
  // hot reload (development): a second copy of this file drops the first one's meshes and materials, keeps its textures
  if (XT.group) { try { scene.remove(XT.group); XT.group.traverse(function (o) { if (o.isMesh) o.geometry.dispose(); }); } catch (e) {} XT.group = null; XT.mat = null; }
  var MAT = XT.mat = XT.mat || null;
  // layers 16.. sample the homes array (plan_ext_homes.js: canvas, ledgestone, cedar, timber, travertine, hewn timber, rusted steel...)
  // for the civic rebuilds (plan_ext_civic.js); per layer: metalness, roughness multiplier, normal strength, uv scale (2 m / tile)
  var XHL = ["plaster", "adobe", "concrete", "rammed", "ledgestone", "fieldstone", "ashlar", "cedar", "charred", "batten", "barnred", "planks", "logs", "shakes", "seam", "corrugated", "claytile", "canvas", "steel", "timber", "smooth", "glass", "travertine", "hewn", "rust", "saltillo", "doors"];
  var XHT = { plaster: 3.2, adobe: 2.6, concrete: 1.25, rammed: 1.7, ledgestone: 1.5, fieldstone: 1.6, ashlar: 2.2, cedar: 1.3, charred: 1.15, batten: 1.6, barnred: 2.0, planks: 2.2, logs: 1.8, shakes: 1.4, seam: 2.7, corrugated: 1.5, claytile: 1.3, canvas: 2.2, steel: 1.2, timber: 1.6, smooth: 3.0, glass: 2.0, travertine: 1.8, hewn: 1.6, rust: 2.4, saltillo: 1.8, doors: 1.0 };
  var XHM = { steel: 0.55, seam: 0.45, corrugated: 0.4, rust: 0.12 };
  XHL.forEach(function (nm, i) { LY["x_" + nm] = 16 + i; });
  function civicUniforms() { var C = window.PLAN_EXT_CIVIC, H = window.PLAN_XH; if (!C || C.off || !H || !H.u || !U || U.tA2) return;
    var l2 = XHL.map(function (nm) { return new THREE.Vector4(XHM[nm] || 0, 1, nm === "canvas" ? 0.7 : 1, 2 / (XHT[nm] || 2)); });
    U.tA2 = H.u.tXA; U.tN2 = H.u.tXN; U.uLay2 = { value: l2 };
    if (!U.tA2.value) { U.tA2.value = placeholder(true, 27); U.tN2.value = placeholder(false, 27); U.ph2 = true; } }
  // detail type per layer: 1 mineral, 2 fibre (wood), 3 metal, 4 none, 5 tile/masonry; the fraction is half the strength
  var DT = { plaster: 1.22, clap: 2.32, batten: 2.32, wood: 2.38, brick: 5.26, corr: 3.28, seam: 3.26, stucco: 1.26, terrazzo: 1.1, trim: 2.22, ashlar: 5.26, rooftile: 5.2, gblock: 0, metal: 3.2, adobe: 1.32, concrete: 1.22 };
  var DTX = { plaster: 1.22, adobe: 1.32, concrete: 1.2, rammed: 1.26, ledgestone: 5.2, fieldstone: 5.2, ashlar: 5.26, cedar: 2.32, charred: 2.26, batten: 2.32, barnred: 2.32, planks: 2.36, logs: 2.32, shakes: 2.32, seam: 3.26, corrugated: 3.28, claytile: 5.2, canvas: 4.0, steel: 3.2, timber: 2.36, smooth: 1.12, glass: 0, travertine: 1.16, hewn: 2.36, rust: 3.3, saltillo: 5.2, doors: 2.2 };
  function bmUniforms() { if (!BM || !U || U.tDet) return; var B = window.PLAN_BMAT; if (!B || B.off || !B.U || !B.U.tDet) return;
    var names = Object.keys(LY).sort(function (a, b) { return LY[a] - LY[b]; }); var tab = new Float32Array(44);
    for (var k in LY) { var i = LY[k]; if (i < 16) tab[i] = DT[k] || 0; else tab[i] = DTX[k.slice(2)] || 0; }
    var v4 = []; for (var j = 0; j < 11; j++) v4.push(new THREE.Vector4(tab[j * 4], tab[j * 4 + 1], tab[j * 4 + 2], tab[j * 4 + 3]));
    U.tDet = B.U.tDet; U.uBm = B.U.uBm; U.uDet = { value: v4 }; U.uBmQ = B.U.uBmQ; }
  function mats() {
    if (MAT) return MAT; MAT = XT.mat = {};
    var lay = []; for (var i = 0; i < NL; i++) lay.push(new THREE.Vector4(LP[i][0], LP[i][1], LP[i][2], LP[i][3]));
    if (!U) U = XT.U = { tA: { value: placeholder(true) }, tN: { value: placeholder(false) }, uLay: { value: lay }, uGlow: { value: 0 } }; else U.uLay.value = lay;
    try { civicUniforms(); } catch (e) { note("civic uniforms", e); }
    try { bmUniforms(); } catch (e) { note("bm uniforms", e); }
    var m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true });
    m.name = "xt_main"; m.userData.avShared = true;
    m.onBeforeCompile = function (sh) {
      var X = window.PLAN_EXT_TOWN.U; sh.uniforms.tA = X.tA; sh.uniforms.tN = X.tN; sh.uniforms.uLay = X.uLay; sh.uniforms.uGlow = X.uGlow;
      var XH2 = !!X.tA2, B = !!(BM && X.tDet);
      if (XH2) { sh.uniforms.tA2 = X.tA2; sh.uniforms.tN2 = X.tN2; sh.uniforms.uLay2 = X.uLay2; }
      if (B) { sh.uniforms.tDet = X.tDet; sh.uniforms.uBm = X.uBm; sh.uniforms.uDet = X.uDet; sh.uniforms.uBmQ = X.uBmQ; }
      var VP = "#include <common>\nattribute vec2 xuv; attribute vec2 aux; varying vec2 vXU; flat varying float vLay; flat varying float vFl;" + (B ? "\nattribute float xhh; varying float vXH; varying vec3 vXW;" : "");
      var VM = "#include <uv_vertex>\nvXU = xuv; vLay = aux.x; vFl = aux.y;" + (B ? "\nvXH = xhh; vXW = (modelMatrix * vec4(position, 1.0)).xyz;" : "");
      sh.vertexShader = sh.vertexShader.replace("#include <common>", VP).replace("#include <uv_vertex>", VM);
      var FP = "#include <common>\nuniform highp sampler2DArray tA; uniform highp sampler2DArray tN; uniform vec4 uLay[16]; uniform float uGlow; varying vec2 vXU; flat varying float vLay; flat varying float vFl; vec4 xtA; vec4 xtN; vec4 xtP; float xtS;";
      if (XH2) FP += "\nuniform highp sampler2DArray tA2; uniform highp sampler2DArray tN2; uniform vec4 uLay2[27];";
      if (B) FP += "\nuniform sampler2D tDet; uniform float uBm; uniform vec4 uDet[11]; uniform vec4 uBmQ; varying float vXH; varying vec3 vXW; float bmF; float bmMac; float bmAO; float bmDust; float bmGr; vec4 bmD; float bmT; float bmSt; vec3 bmWn;\nfloat bmH1(float x) { return fract(sin(x * 91.3458) * 47453.5453); }";
      // albedo / packed normal-roughness from the town array (layers 0..15) or the homes array (16.., the civic rebuilds); explicit
      // gradients so the branch on the flat layer index stays well defined at triangle edges
      var MF = XH2 ? "{ vec2 xg1 = dFdx(vXU), xg2 = dFdy(vXU); if (vLay > 15.5) { int xl = int(vLay - 15.5); xtP = uLay2[xl]; xtS = xtP.w; vec3 xw3 = vec3(vXU * xtS, vLay - 16.0); xtA = textureGrad(tA2, xw3, xg1 * xtS, xg2 * xtS); xtN = textureGrad(tN2, xw3, xg1 * xtS, xg2 * xtS); } else { xtS = 1.0; xtA = textureGrad(tA, vec3(vXU, vLay), xg1, xg2); xtN = textureGrad(tN, vec3(vXU, vLay), xg1, xg2); xtP = uLay[int(vLay + 0.5)]; } } diffuseColor.rgb *= xtA.rgb;"
                   : "xtS = 1.0; xtA = texture(tA, vec3(vXU, vLay)); xtN = texture(tN, vec3(vXU, vLay)); xtP = uLay[int(vLay + 0.5)]; diffuseColor.rgb *= xtA.rgb;";
      if (B) MF += [
        "\n{ int bi = int(vLay + 0.5); float dv = uDet[bi >> 2][bi & 3]; bmT = floor(dv); bmSt = fract(dv) * 2.0;",
        "  bmWn = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz); float bmCam = length(vViewPosition);",
        "  bmF = (1.0 - smoothstep(uBmQ.x, uBmQ.y, bmCam)) * uBm; vec2 bdu = (vXU * xtS * 3.3).yx; vec2 bdg1 = dFdx(bdu), bdg2 = dFdy(bdu); bmD = vec4(0.5); if (bmF > 0.002) bmD = textureGrad(tDet, bdu, bdg1, bdg2);",
        "  bmMac = 0.5; if (uBmQ.z > 0.5) bmMac = texture2D(tDet, vXW.xz * 0.021 + vec2(vXW.y * 0.013, -vXW.y * 0.011)).a;",
        // macro tone (a broad, quiet variation so long walls do not read as one flat colour)
        "  diffuseColor.rgb *= mix(1.0, 0.87 + 0.26 * bmMac, uBm);",
        // sheet / board / tile variation on roofs and metal (a tone per sheet across u)
        // the dirt band at the foot of every wall (splash, dust), irregular top edge, warmer and darker; contact occlusion under it
        "  float wall = 1.0 - smoothstep(0.55, 0.85, abs(bmWn.y)); float gh = 0.45 + 0.45 * bmMac + 0.12 * (bmD.a - 0.5);",
        "  bmGr = (1.0 - smoothstep(gh * 0.35, gh, vXH)) * step(-0.6, vXH) * wall * uBm; vec3 dirt = diffuseColor.rgb * vec3(0.74, 0.66, 0.56) + vec3(0.03, 0.022, 0.014);",
        "  diffuseColor.rgb = mix(diffuseColor.rgb, dirt, bmGr * 0.72);",
        "  bmAO = mix(1.0, mix(0.62, 1.0, smoothstep(0.0, 0.7, vXH)), wall * uBm); bmAO *= mix(1.0, 0.72, smoothstep(-0.55, -0.9, bmWn.y) * uBm);",
        // dust on up-facing surfaces (roofs, sills, copings, deck tops), patchy
        "  bmDust = smoothstep(0.62, 0.96, bmWn.y) * smoothstep(0.15, 0.6, vXH) * (0.22 + 0.5 * smoothstep(0.35, 0.75, bmMac + 0.25 * (bmD.a - 0.5))) * uBm;",
        "  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.56, 0.49, 0.41) * (0.9 + 0.2 * bmD.a), bmDust * 0.45); }"
      ].join("\n");
      var NF = "{ vec2 nxy = (xtN.rg * 2.0 - 1.0) * xtP.z;";
      if (B) NF += " if (bmF > 0.002) { vec2 dn = vec2(0.0); if (bmT > 0.5 && bmT < 1.5) dn = (bmD.gr * 2.0 - 1.0); else if (bmT > 1.5 && bmT < 2.5) dn = vec2(0.0, bmD.b * 2.0 - 1.0) * 0.8 + (bmD.gr * 2.0 - 1.0) * 0.18; else if (bmT > 2.5 && bmT < 3.5) dn = vec2(0.0, bmD.b * 2.0 - 1.0) * 0.35; else if (bmT > 4.5) dn = (bmD.gr * 2.0 - 1.0) * 0.7; nxy += dn * bmSt * bmF; }";
      NF += " float nz = sqrt(max(0.0, 1.0 - dot(nxy, nxy))); vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition); vec2 st0 = dFdx(vXU), st1 = dFdy(vXU); vec3 Nn = normal; vec3 q1p = cross(q1, Nn), q0p = cross(Nn, q0); vec3 Tt = q1p * st0.x + q0p * st1.x; vec3 Bt = q1p * st0.y + q0p * st1.y; float det = max(dot(Tt, Tt), dot(Bt, Bt)); float scl = det == 0.0 ? 0.0 : inversesqrt(det); normal = normalize(Tt * (nxy.x * scl) + Bt * (nxy.y * scl) + Nn * nz); }";
      var RF = "float roughnessFactor = clamp(xtN.b * xtP.y, 0.04, 1.0);";
      if (B) RF += " roughnessFactor = clamp(roughnessFactor * mix(1.0, 0.72 + 0.56 * bmD.a, bmF * 0.85) * mix(1.0, 0.9 + 0.2 * bmMac, uBm) + bmGr * 0.1 + bmDust * 0.35, 0.04, 1.0);";
      var MeF = "float metalnessFactor = xtP.x;";
      if (B) MeF += " metalnessFactor *= 1.0 - bmDust * 0.7;";
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", FP)
        .replace("#include <map_fragment>", MF)
        .replace("#include <color_fragment>", "{ float sat = max(max(xtA.r, xtA.g), xtA.b) - min(min(xtA.r, xtA.g), xtA.b); float pk = mod(vFl, 2.0) > 0.5 ? 1.0 - smoothstep(0.025, 0.08, sat) : 1.0; diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb, pk) * vColor.a; }")
        .replace("#include <roughnessmap_fragment>", RF)
        .replace("#include <metalnessmap_fragment>", MeF)
        .replace("#include <normal_fragment_maps>", NF)
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\nif (vFl > 1.5) totalEmissiveRadiance += xtA.rgb * vColor.rgb * uGlow;");
      if (B) sh.fragmentShader = sh.fragmentShader.replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= bmAO; reflectedLight.indirectSpecular *= mix(1.0, bmAO, 0.7);");
    };
    m.customProgramCacheKey = function () { var X = window.PLAN_EXT_TOWN.U || {}; return "xt_main_r16|" + (X.tA2 ? "xh" : "") + "|" + (BM && X.tDet ? "bm" : ""); };
    MAT.main = m;
    // panes: the client's own window glass (tinted and reflective by day, lit rooms at night); same program as the existing panes
    var gl = new THREE.MeshStandardMaterial({ color: 0xe4ecef, metalness: 0.0, roughness: 0.04, transparent: true, opacity: 0.26, depthWrite: false, envMapIntensity: 2.2 });
    gl.name = "xt_glass"; gl.userData.avShared = true; MAT.glass = gl;
    if (BM) { gl.onBeforeCompile = function (sh) { var X = window.PLAN_EXT_TOWN.U; sh.uniforms.uBm = X.uBm || { value: 1 };
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uBm;").replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\n{ float gNV = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0); float gF = 0.04 + 0.96 * pow(1.0 - gNV, 5.0); diffuseColor.a = mix(diffuseColor.a, min(1.0, diffuseColor.a + (1.0 - diffuseColor.a) * gF * 0.92 + 0.06), uBm); reflectedLight.indirectSpecular *= mix(1.0, 1.25, uBm); reflectedLight.directDiffuse *= 1.0 - gF * uBm; reflectedLight.indirectDiffuse *= 1.0 - gF * uBm; }"); };
      gl.customProgramCacheKey = function () { return "xt_glass_r16"; }; }
    var ct = new THREE.TextureLoader().load(au("/tex/xt_shop" + (LOW ? "_m" : "") + ".jpg?v=" + (window.BUILD || "dev"))); ct.colorSpace = THREE.SRGBColorSpace; ct.anisotropy = 4; ct.userData.avShared = true; ct.name = "xt_shop";
    var cm = new THREE.MeshStandardMaterial({ map: ct, emissive: 0xffe2c0, emissiveMap: ct, emissiveIntensity: 0.1, roughness: 0.9, metalness: 0 }); cm.name = "xt_card"; cm.userData.avShared = true; MAT.card = cm;
    return MAT;
  }

  // ───────────────────────── geometry kit (facade-local metres: x = u across the front, y up, z = v out of the front) ─────────────────────────
  // buffers: typed arrays that double when full; tf = the building transform (facade frame to world) applied as each vertex is written
  function Acc(cap) { cap = cap || 2048; this.cap = cap; this.P = new Float32Array(cap * 3); this.N = new Float32Array(cap * 3); this.T = new Float32Array(cap * 2); this.X = new Float32Array(cap * 2); this.C = new Uint8Array(cap * 4); this.H = new Float32Array(cap); this.n = 0; this.tf = null; }
  function growF(a, n) { var b = new a.constructor(n); b.set(a); return b; }
  Acc.prototype.grow = function () { var c = this.cap * 2; this.P = growF(this.P, c * 3); this.N = growF(this.N, c * 3); this.T = growF(this.T, c * 2); this.X = growF(this.X, c * 2); this.C = growF(this.C, c * 4); this.H = growF(this.H, c); this.cap = c; };
  function c8(v) { return v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0; }
  // one vertex: position, normal, tiling uv (metres / 2), layer, flags, colour (r, g, b, ao)
  Acc.prototype.v = function (x, y, z, nx, ny, nz, u, w, L, F, c) { if (this.n >= this.cap) this.grow(); var i = this.n, t = this.tf, i3 = i * 3, i2 = i * 2, i4 = i * 4, P = this.P, N = this.N;
    if (t) { var X = x * t.sc, Z = z * t.sc; P[i3] = t.ox + X * t.c + Z * t.s; P[i3 + 1] = t.oy + y * t.sc; P[i3 + 2] = t.oz - X * t.s + Z * t.c; N[i3] = nx * t.c + nz * t.s; N[i3 + 1] = ny; N[i3 + 2] = -nx * t.s + nz * t.c; }
    else { P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z; N[i3] = nx; N[i3 + 1] = ny; N[i3 + 2] = nz; }
    this.T[i2] = u; this.T[i2 + 1] = w; this.X[i2] = L; this.X[i2 + 1] = F; this.H[i] = t ? y * t.sc : y; var C = this.C; C[i4] = c8(c[0]); C[i4 + 1] = c8(c[1]); C[i4 + 2] = c8(c[2]); C[i4 + 3] = c8(c[3] === undefined ? 1 : c[3]); this.n = i + 1; };
  // copy a local buffer turned 180 degrees about y (the back verandas, built in their own frame)
  Acc.prototype.addRot180 = function (M) { var col = [0, 0, 0, 0]; for (var i = 0; i < M.n; i++) { col[0] = M.C[i * 4] / 255; col[1] = M.C[i * 4 + 1] / 255; col[2] = M.C[i * 4 + 2] / 255; col[3] = M.C[i * 4 + 3] / 255; this.v(-M.P[i * 3], M.P[i * 3 + 1], -M.P[i * 3 + 2], -M.N[i * 3], M.N[i * 3 + 1], -M.N[i * 3 + 2], M.T[i * 2], M.T[i * 2 + 1], M.X[i * 2], M.X[i * 2 + 1], col); } };
  var S2 = 0.5;   // uv per metre (2 m tiles)
  // a flat quad from four corners (counter-clockwise seen from the front), uv by projecting on the face axes (tangent t)
  Acc.prototype.q4 = function (a, b, c, d, nrm, L, F, col, uo, rot) {
    var tx, ty, tz; if (Math.abs(nrm[1]) > 0.7) { tx = 1; ty = 0; tz = 0; } else { tx = nrm[2]; ty = 0; tz = -nrm[0]; var l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; }
    // bitangent: up for walls, z for floors/roofs
    var bx, by, bz; if (Math.abs(nrm[1]) > 0.7) { bx = 0; by = 0; bz = -1; } else { bx = 0; by = 1; bz = 0; }
    var o = uo || 0; var self = this;
    function V(p) { var u = (p[0] * tx + p[1] * ty + p[2] * tz) * S2 + o, w = (p[0] * bx + p[1] * by + p[2] * bz) * S2; if (rot) { var t0 = u; u = w; w = -t0; } self.v(p[0], p[1], p[2], nrm[0], nrm[1], nrm[2], u, w, L, F, col); }
    V(a); V(b); V(c); V(a); V(c); V(d);
  };
  // a quad with explicit uvs (picture panels)
  Acc.prototype.quv = function (a, b, c, d, nrm, uv, L, F, col) { var self = this; [[a, uv[0], uv[1]], [b, uv[2], uv[1]], [c, uv[2], uv[3]], [a, uv[0], uv[1]], [c, uv[2], uv[3]], [d, uv[0], uv[3]]].forEach(function (q) { self.v(q[0][0], q[0][1], q[0][2], nrm[0], nrm[1], nrm[2], q[1], q[2], L, F, col); }); };
  // the general face: corners and uvs given (for slopes etc.)
  Acc.prototype.tri = function (a, b, c, nrm, L, F, col, uo) { var tx = nrm[2], tz = -nrm[0], l = Math.hypot(tx, tz); if (l < 0.3) { tx = 1; tz = 0; l = 1; } tx /= l; tz /= l; var o = uo || 0; var self = this; [a, b, c].forEach(function (p) { self.v(p[0], p[1], p[2], nrm[0], nrm[1], nrm[2], (p[0] * tx + p[2] * tz) * S2 + o, p[1] * S2, L, F, col); }); };
  function nrmOf(a, b, c) { var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; var l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l]; }
  // axis-aligned box; no: faces to skip ("b" bottom, "t" top, "n" -z, "s" +z, "w" -x, "e" +x); rot: rotate the side uvs (vertical grain)
  Acc.prototype.box = function (x0, y0, z0, x1, y1, z1, L, F, col, opt) {
    opt = opt || {}; var no = opt.no || "", uo = opt.uo || 0, r = !!opt.rot, rt = !!opt.rotTop;
    if (no.indexOf("s") < 0) this.q4([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], L, F, col, uo, r);
    if (no.indexOf("n") < 0) this.q4([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], L, F, col, uo, r);
    if (no.indexOf("e") < 0) this.q4([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], L, F, col, uo, r);
    if (no.indexOf("w") < 0) this.q4([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], L, F, col, uo, r);
    if (no.indexOf("t") < 0) this.q4([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], L, F, col, uo, rt);
    if (no.indexOf("b") < 0) this.q4([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], L, F, col, uo, rt);
  };
  // oriented box: centre c, unit axes ax (length), ay, az, half sizes
  Acc.prototype.obox = function (c, ax, ay, hx, hy, hz, L, F, col) {
    var az = [ax[1] * ay[2] - ax[2] * ay[1], ax[2] * ay[0] - ax[0] * ay[2], ax[0] * ay[1] - ax[1] * ay[0]];
    function P(sx, sy, sz) { return [c[0] + ax[0] * hx * sx + ay[0] * hy * sy + az[0] * hz * sz, c[1] + ax[1] * hx * sx + ay[1] * hy * sy + az[1] * hz * sz, c[2] + ax[2] * hx * sx + ay[2] * hy * sy + az[2] * hz * sz]; }
    var f = [[[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], az], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1], [-az[0], -az[1], -az[2]]], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1], ax], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-ax[0], -ax[1], -ax[2]]], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1], ay], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [-ay[0], -ay[1], -ay[2]]]];
    for (var i = 0; i < 6; i++) { var q = f[i]; var a = P.apply(null, q[0]), b = P.apply(null, q[1]), cc = P.apply(null, q[2]), d = P.apply(null, q[3]); this.q4(a, b, cc, d, q[4], L, F, col, 0, false); }
  };
  // vertical cylinder (posts, downspouts, columns), with a top cap
  Acc.prototype.cyl = function (x, y0, z, r, h, seg, L, F, col, cap) {
    seg = seg || 8; for (var i = 0; i < seg; i++) { var a0 = i / seg * PI * 2, a1 = (i + 1) / seg * PI * 2; var c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      var p0 = [x + c0 * r, y0, z + s0 * r], p1 = [x + c1 * r, y0, z + s1 * r], p2 = [x + c1 * r, y0 + h, z + s1 * r], p3 = [x + c0 * r, y0 + h, z + s0 * r]; var u0 = i / seg * PI * 2 * r * S2, u1 = (i + 1) / seg * PI * 2 * r * S2;
      var self = this; [[p0, c0, s0, u0], [p2, c1, s1, u1], [p1, c1, s1, u1], [p0, c0, s0, u0], [p3, c0, s0, u0], [p2, c1, s1, u1]].forEach(function (q) { self.v(q[0][0], q[0][1], q[0][2], q[1], 0, q[2], q[3], q[0][1] * S2, L, F, col); });
      if (cap) { this.v(x, y0 + h, z, 0, 1, 0, x * S2, z * S2, L, F, col); this.v(p2[0], p2[1], p2[2], 0, 1, 0, p2[0] * S2, -p2[2] * S2, L, F, col); this.v(p3[0], p3[1], p3[2], 0, 1, 0, p3[0] * S2, -p3[2] * S2, L, F, col); } }
  };
  // a wall on the vertical plane through o along tangent t (unit, horizontal), length len, y0..y1, with rectangular holes [s0, s1, h0, h1]
  // (local s and y); reveals of depth rev line every hole (the reveal faces use layer RL); normal = t x up
  Acc.prototype.wall = function (o, t, len, y0, y1, holes, L, F, col, opt) {
    opt = opt || {}; var n = [-t[2], 0, t[0]]; var uo = opt.uo || 0, rot = !!opt.rot; holes = holes || [];
    var ss = [0, len], ys = [y0, y1]; holes.forEach(function (h) { ss.push(Math.max(0, Math.min(len, h[0])), Math.max(0, Math.min(len, h[1]))); ys.push(Math.max(y0, Math.min(y1, h[2])), Math.max(y0, Math.min(y1, h[3]))); });
    ss = ss.sort(function (a, b) { return a - b; }).filter(function (v, i, A) { return i === 0 || v - A[i - 1] > 1e-4; }); ys = ys.sort(function (a, b) { return a - b; }).filter(function (v, i, A) { return i === 0 || v - A[i - 1] > 1e-4; });
    function P(s, y) { return [o[0] + t[0] * s, y, o[2] + t[2] * s]; }
    var base = o[0] * t[0] + o[2] * t[2];
    for (var i = 0; i < ss.length - 1; i++) for (var j = 0; j < ys.length - 1; j++) { var sm = (ss[i] + ss[i + 1]) / 2, ym = (ys[j] + ys[j + 1]) / 2; var inH = false; for (var k = 0; k < holes.length; k++) { var h = holes[k]; if (sm > h[0] && sm < h[1] && ym > h[2] && ym < h[3]) { inH = true; break; } } if (inH) continue;
      this.q4(P(ss[i], ys[j]), P(ss[i + 1], ys[j]), P(ss[i + 1], ys[j + 1]), P(ss[i], ys[j + 1]), n, L, F, col, uo, rot); }
    var rev = opt.rev === undefined ? 0.14 : opt.rev; if (rev > 0) { var RL = opt.RL === undefined ? L : opt.RL, RF = opt.RF === undefined ? F : opt.RF, rc = opt.rc || col; var self = this;
      holes.forEach(function (h) { if (h[4] === 0) return; var d = h[4] || rev; var dn = [-n[0] * d, 0, -n[2] * d];
        function B(p) { return [p[0] + dn[0], p[1], p[2] + dn[2]]; }
        var a = P(h[0], h[2]), b = P(h[1], h[2]), c = P(h[1], h[3]), e = P(h[0], h[3]);
        self.q4(a, B(a), B(e), e, [t[0], 0, t[2]], RL, RF, rc, uo, false);                // left jamb faces +t
        self.q4(B(b), b, c, B(c), [-t[0], 0, -t[2]], RL, RF, rc, uo, false);              // right jamb faces -t
        self.q4(B(e), B(c), c, e, [0, -1, 0], RL, RF, rc, uo, false);                     // head faces down
        if (!h[5]) self.q4(a, b, B(b), B(a), [0, 1, 0], RL, RF, rc, uo, false);           // sill faces up (h[5]: a door, no sill)
      }); }
  };
  // a polygon (local s, y outline, counter-clockwise) extruded from the plane (o, t) back by depth; front, back and edge faces
  Acc.prototype.ext = function (o, t, pts, depth, L, F, col, opt) {
    opt = opt || {}; var n = [-t[2], 0, t[0]]; var holes = opt.holes || []; var tri = THREE.ShapeUtils.triangulateShape(pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), holes.map(function (h) { return h.map(function (p) { return new THREE.Vector2(p[0], p[1]); }); }));
    var outline = pts; pts = pts.concat.apply(pts, holes);
    function P(s, y, d) { return [o[0] + t[0] * s - n[0] * d, y, o[2] + t[2] * s - n[2] * d]; }
    var self = this, uo = opt.uo || 0;
    tri.forEach(function (f) { var a = pts[f[0]], b = pts[f[1]], c = pts[f[2]]; var A = P(a[0], a[1], 0), B = P(b[0], b[1], 0), C = P(c[0], c[1], 0); var nn = nrmOf(A, B, C); if (nn[0] * n[0] + nn[2] * n[2] < 0) { var T = B; B = C; C = T; } self.tri(A, B, C, n, L, F, col, uo);
      if (!opt.noBack) { var A2 = P(a[0], a[1], depth), B2 = P(b[0], b[1], depth), C2 = P(c[0], c[1], depth); var m = [-n[0], 0, -n[2]]; var nb = nrmOf(A2, B2, C2); if (nb[0] * m[0] + nb[2] * m[2] < 0) { var T2 = B2; B2 = C2; C2 = T2; } self.tri(A2, B2, C2, m, L, F, col, uo); } });
    var loops = [outline].concat(holes); if (!opt.noEdge) for (var li = 0; li < loops.length; li++) { var LP0 = loops[li]; for (var i = 0; i < LP0.length; i++) { var p = LP0[i], q = LP0[(i + 1) % LP0.length]; var a2 = P(p[0], p[1], 0), b2 = P(q[0], q[1], 0), c2 = P(q[0], q[1], depth), d2 = P(p[0], p[1], depth); var en = nrmOf(a2, b2, c2); var e1 = [q[0] - p[0], q[1] - p[1]]; // outward edge normal in (s, y): (e1.y, -e1.x) for a ccw outline
      var on = [t[0] * e1[1], -e1[0], t[2] * e1[1]]; var ol = Math.hypot(on[0], on[1], on[2]) || 1; on = [on[0] / ol, on[1] / ol, on[2] / ol]; if (en[0] * on[0] + en[1] * on[1] + en[2] * on[2] < 0) this.q4(b2, a2, d2, c2, on, opt.EL === undefined ? L : opt.EL, F, col, uo, false); else this.q4(a2, b2, c2, d2, on, opt.EL === undefined ? L : opt.EL, F, col, uo, false); } }
  };
  // glass: separate buffers for the client's glass material (uv 0..1 per pane, colour r = a per window random)
  function GAcc(cap) { cap = cap || 512; this.cap = cap; this.P = new Float32Array(cap * 3); this.N = new Float32Array(cap * 3); this.T = new Float32Array(cap * 2); this.C = new Float32Array(cap * 3); this.n = 0; this.tf = null; }
  GAcc.prototype.grow = function () { var c = this.cap * 2; this.P = growF(this.P, c * 3); this.N = growF(this.N, c * 3); this.T = growF(this.T, c * 2); this.C = growF(this.C, c * 3); this.cap = c; };
  GAcc.prototype.v = function (x, y, z, nx, ny, nz, u, w, r) { if (this.n >= this.cap) this.grow(); var i = this.n, t = this.tf, i3 = i * 3, P = this.P, N = this.N;
    if (t) { var X = x * t.sc, Z = z * t.sc; P[i3] = t.ox + X * t.c + Z * t.s; P[i3 + 1] = t.oy + y * t.sc; P[i3 + 2] = t.oz - X * t.s + Z * t.c; N[i3] = nx * t.c + nz * t.s; N[i3 + 1] = ny; N[i3 + 2] = -nx * t.s + nz * t.c; }
    else { P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z; N[i3] = nx; N[i3 + 1] = ny; N[i3 + 2] = nz; }
    this.T[i * 2] = u; this.T[i * 2 + 1] = w; this.C[i3] = r; this.C[i3 + 1] = r; this.C[i3 + 2] = r; this.n = i + 1; };
  GAcc.prototype.quad = function (a, b, c, d, n, uv) { var self = this; [[a, uv[0], uv[1]], [b, uv[2], uv[1]], [c, uv[2], uv[3]], [a, uv[0], uv[1]], [c, uv[2], uv[3]], [d, uv[0], uv[3]]].forEach(function (q) { self.v(q[0][0], q[0][1], q[0][2], n[0], n[1], n[2], q[1], q[2], 1); }); };
  GAcc.prototype.pane = function (o, t, s0, s1, y0, y1, rnd) { var n = [-t[2], 0, t[0]]; var self = this; function P(s, y) { return [o[0] + t[0] * s, y, o[2] + t[2] * s]; }
    var a = P(s0, y0), b = P(s1, y0), c = P(s1, y1), d = P(s0, y1); [[a, 0, 0], [b, 1, 0], [c, 1, 1], [a, 0, 0], [c, 1, 1], [d, 0, 1]].forEach(function (q) { self.v(q[0][0], q[0][1], q[0][2], n[0], n[1], n[2], q[1], q[2], rnd); }); };

  // ───────────────────────── colour helpers and palettes ─────────────────────────
  function hex(h, ao) { var v = parseInt(h.slice(1), 16); var r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255; return [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2), ao === undefined ? 1 : ao]; }   // linear for the vertex colours
  function shade(c, k, ao) { return [c[0] * k, c[1] * k, c[2] * k, ao === undefined ? (c[3] === undefined ? 1 : c[3]) : ao]; }
  function pick(r, a) { return a[Math.floor(r() * a.length) % a.length]; }
  var WHITE = [1, 1, 1, 1];
  var PAL = {
    paint: ["#ece5d3", "#e9dcbc", "#e3cf96", "#b7bf9a", "#a7b7c0", "#9a4433", "#c99a55", "#d8a88a", "#c2d3bd", "#c3beb2", "#7a3127", "#dcc7a0", "#8fa38a", "#d6b77a"],
    trim: ["#f0ebdf", "#3b5a43", "#6a2a24", "#4a3324", "#b58a2e", "#4a6578", "#e6d6b0", "#7a3a26", "#2f4e50", "#efe2c4", "#8a6a3a"],
    earth: ["#cfa77c", "#c49470", "#d7b48c", "#e4cfb0", "#bf8a63", "#d9c3a3", "#efe6d6"],
    plaster: ["#efe7d8", "#ead9bd", "#e7c9a5", "#f3eee4", "#dcb991", "#e9d2b4"],
    sl: ["#f2efe8", "#efe6d2", "#e9eef0", "#f1e3d6", "#e3ede4", "#f4ead6"],
    slTrim: ["#2fae57", "#2b7f9e", "#c0533d", "#d8a43a", "#3a4a8c", "#8a3b6a", "#1f6e5e"]
  };

  // ───────────────────────── the building records, chunks and drawing ─────────────────────────
  var CH = 160; var CHUNKS = XT.chunks = []; var BLD = XT.bld = []; var GROUP = null;
  function inv(e, m) { return { x: e[0], z: e[2], y: e[1] - ((m && m.sink) || 0) - (e.sink || 0), sc: e[4] || 1 }; }
  // append a building's local buffers (facade frame with yaw Y about the building origin) into a chunk accumulator, recording the range
  function chunkOf(x, z) { var k = Math.floor(x / CH) + "," + Math.floor(z / CH); for (var i = 0; i < CHUNKS.length; i++) if (CHUNKS[i].k === k) return CHUNKS[i]; var C = { k: k, x0: Math.floor(x / CH) * CH, z0: Math.floor(z / CH) * CH, main: new Acc(65536), glass: new GAcc(4096), far: new Acc(4096), card: new GAcc(2048), sign: new GAcc(256), meshes: {}, vis: -1, bl: [] }; CHUNKS.push(C); return C; }
  function geoMain(A) { var n = A.n, g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(A.P.slice(0, n * 3), 3)); g.setAttribute("normal", new THREE.BufferAttribute(A.N.slice(0, n * 3), 3)); g.setAttribute("xuv", new THREE.BufferAttribute(A.T.slice(0, n * 2), 2)); g.setAttribute("aux", new THREE.BufferAttribute(A.X.slice(0, n * 2), 2)); if (BM) g.setAttribute("xhh", new THREE.BufferAttribute(A.H.slice(0, n), 1));
    g.setAttribute("color", new THREE.BufferAttribute(A.C.slice(0, n * 4), 4, true)); g.computeBoundingSphere(); g.computeBoundingBox(); return g; }
  function geoGlass(A) { var n = A.n, g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(A.P.slice(0, n * 3), 3)); g.setAttribute("normal", new THREE.BufferAttribute(A.N.slice(0, n * 3), 3)); g.setAttribute("uv", new THREE.BufferAttribute(A.T.slice(0, n * 2), 2)); g.setAttribute("color", new THREE.BufferAttribute(A.C.slice(0, n * 3), 3)); g.computeBoundingSphere(); return g; }

  // ───────────────────────── shared pieces ─────────────────────────
  // a sash or display window in the wall plane (o, t): trim frame, muntins, sill, glass and an interior card behind it
  function windowAt(K, o, t, s0, s1, y0, y1, st) {
    st = st || {}; var A = K.a, G = K.g, n = [-t[2], 0, t[0]], tc = st.tc || K.trim, fw = st.fw || 0.07, fd = st.fd || 0.05; var inset = st.inset === undefined ? 0.1 : st.inset;
    function P(s, y, d) { return [o[0] + t[0] * s - n[0] * d, y, o[2] + t[2] * s - n[2] * d]; }
    function bar(sa, sb, ya, yb, d0, d1, L, col) { var a = P(sa, ya, d0), b = P(sb, ya, d0); // box spanning s, y, depth d0..d1 (d measured into the wall)
      var x0 = Math.min(a[0], b[0], P(sa, ya, d1)[0], P(sb, ya, d1)[0]), x1 = Math.max(a[0], b[0], P(sa, ya, d1)[0], P(sb, ya, d1)[0]), z0 = Math.min(a[2], b[2], P(sa, ya, d1)[2], P(sb, ya, d1)[2]), z1 = Math.max(a[2], b[2], P(sa, ya, d1)[2], P(sb, ya, d1)[2]);
      A.box(x0, ya, z0, x1, yb, z1, L, 1, col, { no: "" }); }
    var gi = inset;   // the glass plane depth into the wall
    // outer casing on the wall face
    if (!st.noCasing) { var cw = st.cw || 0.11; bar(s0 - cw, s0, y0, y1 + cw, -0.035, 0.02, LY.trim, tc); bar(s1, s1 + cw, y0, y1 + cw, -0.035, 0.02, LY.trim, tc); bar(s0 - cw, s1 + cw, y1, y1 + cw + 0.02, -0.05, 0.02, LY.trim, tc);
      if (st.pediment) { bar(s0 - cw - 0.06, s1 + cw + 0.06, y1 + cw + 0.02, y1 + cw + 0.09, -0.11, 0.02, LY.trim, tc); } }
    // sill
    if (!st.noSill) bar(s0 - 0.08, s1 + 0.08, y0 - 0.06, y0, -0.09, gi, st.sillL === undefined ? LY.trim : st.sillL, st.sillC || tc);
    // sash frame (inside the reveal)
    bar(s0, s0 + fw, y0, y1, gi - fd, gi + 0.01, LY.trim, tc); bar(s1 - fw, s1, y0, y1, gi - fd, gi + 0.01, LY.trim, tc); bar(s0, s1, y0, y0 + fw, gi - fd, gi + 0.01, LY.trim, tc); bar(s0, s1, y1 - fw, y1, gi - fd, gi + 0.01, LY.trim, tc);
    // muntins: cols x rows lights; a meeting rail for sash windows
    var cols = st.cols || 1, rows = st.rows || 1, mw = st.mw || 0.035; for (var i = 1; i < cols; i++) { var sm = s0 + fw + (s1 - s0 - 2 * fw) * i / cols; bar(sm - mw / 2, sm + mw / 2, y0 + fw, y1 - fw, gi - fd * 0.7, gi + 0.005, LY.trim, tc); }
    for (var j = 1; j < rows; j++) { var ym = y0 + fw + (y1 - y0 - 2 * fw) * j / rows; bar(s0 + fw, s1 - fw, ym - mw / 2, ym + mw / 2, gi - fd * 0.7, gi + 0.005, LY.trim, tc); }
    if (st.rail) { var yr = (y0 + y1) / 2; bar(s0 + fw, s1 - fw, yr - 0.03, yr + 0.03, gi - fd, gi + 0.01, LY.trim, tc); }
    // glass
    G.pane([o[0] - n[0] * gi, 0, o[2] - n[2] * gi], t, s0 + fw * 0.5, s1 - fw * 0.5, y0 + fw * 0.5, y1 - fw * 0.5, st.lit === undefined ? K.r() : st.lit);
    // interior card: a dim room behind the glass (back wall, floor, ceiling and the jambs), so a window reads as a room, not a mirror
    if (!st.noRoom) { var dd = st.depth || 1.6; var bc = st.roomC || K.roomC; var b0 = P(s0, y0, gi + dd), b1 = P(s1, y0, gi + dd), b2 = P(s1, y1, gi + dd), b3 = P(s0, y1, gi + dd);
      var pn = st.panel === undefined ? K.panel : st.panel; var lit = st.dark ? 0 : 2;
      if (pn !== null && pn !== undefined && K.c) { var qx = pn % 4, qy = pn >> 2, u0 = qx * 0.25 + 0.004, v1 = 1 - qy * 0.25 - 0.004; K.c.quad(b0, b1, b2, b3, n, [u0, v1 - 0.242, u0 + 0.242, v1]); st.shelves = false; }
      else A.q4(b0, b1, b2, b3, n, LY.plaster, 1 | lit, bc, 0, false);
      var f0 = P(s0, y0 + 0.01, gi + 0.02), f1 = P(s1, y0 + 0.01, gi + 0.02); A.q4(f0, f1, [b1[0], y0 + 0.01, b1[2]], [b0[0], y0 + 0.01, b0[2]], [0, 1, 0], LY.wood, lit, shade(bc, 0.8), 0, false);
      A.q4(b3, b2, P(s1, y1, gi + 0.02), P(s0, y1, gi + 0.02), [0, -1, 0], LY.plaster, 1 | lit, shade(bc, 0.6), 0, false);
      A.q4(P(s0, y0, gi + 0.02), b0, b3, P(s0, y1, gi + 0.02), [t[0], 0, t[2]], LY.plaster, 1 | lit, shade(bc, 0.75), 0, false);
      A.q4(b1, P(s1, y0, gi + 0.02), P(s1, y1, gi + 0.02), b2, [-t[0], 0, -t[2]], LY.plaster, 1 | lit, shade(bc, 0.75), 0, false);
      if (st.shelves !== false) { for (var k = 0; k < 3; k++) { var yy = y0 + 0.35 + k * (y1 - y0 - 0.5) / 3; var s0i = s0 + 0.15, s1i = s1 - 0.15; bar(s0i, s1i, yy, yy + 0.04, gi + dd - 0.35, gi + dd - 0.02, LY.wood, shade(WHITE, 0.55));
          // goods: a row of small boxes in shop colours
          var nG = Math.max(2, Math.floor((s1i - s0i) / 0.22)); for (var gq = 0; gq < nG; gq++) { if (K.r() < 0.25) continue; var gs = s0i + (gq + 0.2) * (s1i - s0i) / nG, gw = (s1i - s0i) / nG * (0.5 + 0.3 * K.r()), gh = 0.12 + 0.18 * K.r(); bar(gs, gs + gw, yy + 0.04, yy + 0.04 + gh, gi + dd - 0.3, gi + dd - 0.08, LY.trim, hex(pick(K.r, ["#b8483a", "#d9b44a", "#3e6e8e", "#e8e0d0", "#5b7f4a", "#8a5a3a", "#c76f3a"]), 0.75)); } } } }
  }
  // a door: casing, a recessed leaf (panels or glazed), an optional transom light
  function doorAt(K, o, t, s0, s1, y0, y1, st) {
    st = st || {}; var A = K.a, n = [-t[2], 0, t[0]], tc = st.tc || K.trim, lc = st.lc || K.doorC || tc; var gi = st.inset === undefined ? 0.12 : st.inset;
    function P(s, y, d) { return [o[0] + t[0] * s - n[0] * d, y, o[2] + t[2] * s - n[2] * d]; }
    function bar(sa, sb, ya, yb, d0, d1, L, col) { var p = [P(sa, ya, d0), P(sb, ya, d0), P(sa, ya, d1), P(sb, ya, d1)]; var x0 = Math.min(p[0][0], p[1][0], p[2][0], p[3][0]), x1 = Math.max(p[0][0], p[1][0], p[2][0], p[3][0]), z0 = Math.min(p[0][2], p[1][2], p[2][2], p[3][2]), z1 = Math.max(p[0][2], p[1][2], p[2][2], p[3][2]); A.box(x0, ya, z0, x1, yb, z1, L, 1, col, {}); }
    var cw = 0.12; bar(s0 - cw, s0, y0, y1 + cw, -0.04, 0.02, LY.trim, tc); bar(s1, s1 + cw, y0, y1 + cw, -0.04, 0.02, LY.trim, tc); bar(s0 - cw - 0.03, s1 + cw + 0.03, y1, y1 + cw + 0.03, -0.06, 0.02, LY.trim, tc);
    var yt = st.transom ? y1 - 0.42 : y1; var leaves = st.leaves || ((s1 - s0) > 1.2 ? 2 : 1); var lw = (s1 - s0) / leaves;
    for (var l = 0; l < leaves; l++) { var a0 = s0 + l * lw, a1 = a0 + lw; // stiles and rails
      bar(a0, a0 + 0.1, y0, yt, gi, gi + 0.05, LY.trim, lc); bar(a1 - 0.1, a1, y0, yt, gi, gi + 0.05, LY.trim, lc); bar(a0 + 0.1, a1 - 0.1, y0, y0 + 0.22, gi, gi + 0.05, LY.trim, lc); bar(a0 + 0.1, a1 - 0.1, yt - 0.12, yt, gi, gi + 0.05, LY.trim, lc);
      var ym = y0 + (yt - y0) * 0.45; bar(a0 + 0.1, a1 - 0.1, ym - 0.06, ym + 0.06, gi, gi + 0.05, LY.trim, lc);
      if (st.glazed) { K.g.pane([o[0] - n[0] * (gi + 0.025), 0, o[2] - n[2] * (gi + 0.025)], t, a0 + 0.1, a1 - 0.1, ym + 0.06, yt - 0.12, st.lit === undefined ? 0.9 : st.lit); }
      else { bar(a0 + 0.14, a1 - 0.14, ym + 0.1, yt - 0.16, gi + 0.015, gi + 0.05, LY.trim, shade(lc, 0.85)); }
      bar(a0 + 0.14, a1 - 0.14, y0 + 0.26, ym - 0.1, gi + 0.015, gi + 0.05, LY.trim, shade(lc, 0.85));
      // the knob
      var ks = l === 0 && leaves === 2 ? a1 - 0.14 : (leaves === 2 ? a0 + 0.14 : a1 - 0.14); bar(ks - 0.03, ks + 0.03, y0 + 0.98, y0 + 1.08, gi - 0.05, gi, LY.metal, hex("#b8963e")); }
    // the room behind the door leaf (dark, so an open-looking glazed door reads)
    if (st.glazed) { A.q4(P(s0, y0, gi + 1.4), P(s1, y0, gi + 1.4), P(s1, yt, gi + 1.4), P(s0, yt, gi + 1.4), n, LY.plaster, 3, K.roomC, 0, false); }
    if (st.transom) { var ty0 = yt, ty1 = y1; bar(s0, s1, ty0, ty0 + 0.06, gi - 0.04, gi + 0.04, LY.trim, tc); K.g.pane([o[0] - n[0] * gi, 0, o[2] - n[2] * gi], t, s0 + 0.04, s1 - 0.04, ty0 + 0.06, ty1 - 0.03, 0.95);
      A.q4(P(s0, ty0, gi + 1.2), P(s1, ty0, gi + 1.2), P(s1, ty1, gi + 1.2), P(s0, ty1, gi + 1.2), n, LY.plaster, 3, shade(K.roomC, 0.8), 0, false); }
    // threshold
    bar(s0 - 0.05, s1 + 0.05, y0 - 0.02, y0 + 0.03, -0.06, gi + 0.06, LY.wood, shade(WHITE, 0.8));
  }
  // a gooseneck lamp on a wall (emissive bulb, glow at night)
  function gooseneck(K, x, y, z, dir) { var A = K.a; var c = hex("#2b2b2b"); A.box(x - 0.06, y - 0.06, z, x + 0.06, y + 0.06, z + 0.03, LY.metal, 1, c);
    A.obox([x, y + 0.12, z + 0.2], [0, 0.5, 0.866], [1, 0, 0], 0.24, 0.018, 0.018, LY.metal, 1, c);
    A.obox([x, y + 0.24, z + 0.42], [0, 0, 1], [1, 0, 0], 0.07, 0.11, 0.11, LY.metal, 1, hex("#1e3a2a"));
    A.box(x - 0.05, y + 0.1, z + 0.37, x + 0.05, y + 0.14, z + 0.47, LY.metal, 3, hex("#ffd9a0")); }

  // ───────────────────────── the store (Old West storefront with a false front, boardwalk porch) ─────────────────────────
  // measured: plan/porches.json kinds.store (facade angle, wall line, deck, posts, door corridor, the R14 name board span)
  function porchSide(kind) { try { var C = window.PLAN_PORCHES && PLAN_PORCHES.cfg; var K = C && C.kinds && C.kinds[kind]; if (K && K.sides && K.sides[0]) return { side: K.sides[0], body: K.body, all: K.sides, K: K }; } catch (e) {} return null; }
  var DEF = { store: { a: 0.0947, wall: 3.13, deck: [-4.72, 4.75, 3.13, 5.1], h: 0.305, ceil: 3.12, posts: [[-4.6, 5], [-1.59, 5], [1.62, 5.02], [4.63, 5.04]], door: [0.85, 2.45], body: { u: [-5, 5], v: [-5.25, 3.13], h: 4.4 } } };
  function storeBuild(K) {
    var A = K.a, r = K.r, ps = porchSide("store"), S = ps ? ps.side : DEF.store, body = ps && ps.body ? ps.body : DEF.store.body;
    var WF = S.wall, U0 = body.u[0], U1 = body.u[1], VB = body.v[0], DH = S.h, CE = S.ceil || 3.12; var deck = S.deck, posts = S.posts, dr = S.door;
    K.frame(K.e[3] + (S.a || 0));
    // cladding per building
    var cl = pick(r, ["clap", "clap", "batten", "wood", "brick", "brick", "plaster", "adobe", "clap", "batten"]);
    if (K.dist === "S2_MARKET" && r() < 0.35) cl = pick(r, ["clap", "batten", "plaster"]);
    var wallL = LY[cl] !== undefined ? LY[cl] : LY.clap, paint = cl === "clap" || cl === "batten" || cl === "plaster" || cl === "adobe";
    var wc = cl === "adobe" ? hex(pick(r, PAL.earth)) : cl === "plaster" ? hex(pick(r, PAL.plaster)) : paint ? hex(pick(r, PAL.paint)) : cl === "brick" ? shade(WHITE, 0.85 + 0.2 * r()) : shade(WHITE, 0.9 + 0.15 * r());
    var F = paint ? 1 : 0; K.trim = hex(pick(r, PAL.trim)); if (K.trim[0] + K.trim[1] + K.trim[2] > 2.2 && wc[0] + wc[1] + wc[2] > 2.0) K.trim = hex(pick(r, ["#2f4a36", "#5a1f1c", "#3d5566", "#4a3324"]));
    K.doorC = r() < 0.5 ? K.trim : hex(pick(r, ["#5a3a24", "#6b4528", "#3e2a1c", "#7a5232"])); K.roomC = hex(pick(r, ["#6a5844", "#5e4c3c", "#776350", "#54483e"]), 0.55);
    var ftH = 4.75 + r() * 0.85, shape = pick(r, ["flat", "flat", "step", "gable", "arch", "step"]); if (cl === "adobe") shape = pick(r, ["flat", "arch"]);
    var sideTopF = 3.95, sideTopB = 3.3;
    // ground plinth along the side and back walls, walls from below grade
    var y0 = -0.45;
    // front wall: holes for the two display windows and the door
    var wL = [-3.65, -1.95], wR = [2.85, 4.4], wy = [0.82, 2.62]; var dy1 = 2.55;
    var front = [[wL[0] - U0, wL[1] - U0, wy[0], wy[1]], [dr[0] - U0, dr[1] - U0, DH, dy1, 0.14, 1], [wR[0] - U0, wR[1] - U0, wy[0], wy[1]]];
    A.wall([U0, 0, WF], [1, 0, 0], U1 - U0, y0, sideTopF + 0.05, front, wallL, F, wc, { rev: 0.16, RL: LY.trim, RF: 1, rc: K.trim });
    // false front above the roof line: the shaped parapet (front face, back face, edges)
    var fu0 = U0 - 0.02, fu1 = U1 + 0.02, fy0 = sideTopF + 0.05; var pts;
    if (shape === "flat") pts = [[0, fy0], [fu1 - fu0, fy0], [fu1 - fu0, ftH], [0, ftH]];
    else if (shape === "step") { var w = fu1 - fu0, st1 = ftH - 0.45; pts = [[0, fy0], [w, fy0], [w, st1], [w * 0.78, st1], [w * 0.78, ftH], [w * 0.22, ftH], [w * 0.22, st1], [0, st1]]; }
    else if (shape === "gable") { var w2 = fu1 - fu0, eh = ftH - 0.5; pts = [[0, fy0], [w2, fy0], [w2, eh], [w2 * 0.5 + 1.9, eh], [w2 * 0.5, ftH + 0.35], [w2 * 0.5 - 1.9, eh], [0, eh]]; }
    else { var w3 = fu1 - fu0, eh3 = ftH - 0.35; pts = [[0, fy0], [w3, fy0], [w3, eh3]]; for (var ai = 0; ai <= 10; ai++) { var aa = PI * ai / 10; pts.push([w3 * 0.5 + Math.cos(aa) * 2.4, eh3 + Math.sin(aa) * 0.6]); } pts.push([0, eh3]); }
    A.ext([fu0, 0, WF], [1, 0, 0], pts, 0.16, wallL, F, wc, { EL: LY.trim });
    // cornice cap along the top edge(s) of the parapet, with brackets under the main run
    var capC = K.trim; var topY = shape === "flat" ? ftH : shape === "step" ? ftH : shape === "gable" ? ftH - 0.5 : ftH - 0.35;
    if (shape === "flat" || shape === "step") {
      var cw0 = shape === "step" ? fu0 + (fu1 - fu0) * 0.22 : fu0, cw1 = shape === "step" ? fu0 + (fu1 - fu0) * 0.78 : fu1;
      A.box(cw0 - 0.14, ftH - 0.06, WF - 0.2, cw1 + 0.14, ftH + 0.06, WF + 0.3, LY.trim, 1, capC); A.box(cw0 - 0.08, ftH - 0.24, WF - 0.02, cw1 + 0.08, ftH - 0.06, WF + 0.18, LY.trim, 1, shade(capC, 0.92)); A.box(cw0 - 0.04, ftH - 0.4, WF, cw1 + 0.04, ftH - 0.24, WF + 0.08, LY.trim, 1, capC);
      for (var bx = cw0 + 0.25; bx < cw1 - 0.1; bx += 0.62) A.box(bx - 0.05, ftH - 0.42, WF, bx + 0.05, ftH - 0.24, WF + 0.16, LY.trim, 1, shade(capC, 0.85));
      if (shape === "step") { var sy = ftH - 0.45; [[fu0, cw0], [cw1, fu1]].forEach(function (q) { A.box(q[0] - 0.1, sy - 0.05, WF - 0.18, q[1] + 0.1, sy + 0.05, WF + 0.24, LY.trim, 1, capC); A.box(q[0] - 0.04, sy - 0.2, WF, q[1] + 0.04, sy - 0.05, WF + 0.1, LY.trim, 1, shade(capC, 0.9)); }); }
    } else if (shape === "gable") { var gw = fu1 - fu0, gm = fu0 + gw / 2, ge = ftH - 0.5; [[fu0, gm - 1.9], [gm + 1.9, fu1]].forEach(function (q) { A.box(q[0] - 0.1, ge - 0.05, WF - 0.18, q[1] + 0.02, ge + 0.05, WF + 0.24, LY.trim, 1, capC); });
      var L2 = Math.hypot(1.9, 0.85); [[gm - 1.9, ge, gm, ge + 0.85], [gm, ge + 0.85, gm + 1.9, ge]].forEach(function (q) { var dx = (q[2] - q[0]) / L2, dy = (q[3] - q[1]) / L2; A.obox([(q[0] + q[2]) / 2, (q[1] + q[3]) / 2 + 0.02, WF + 0.03], [dx, dy, 0], [-dy, dx, 0], L2 / 2 + 0.1, 0.06, 0.24, LY.trim, 1, capC); });
    } else { var am = fu0 + (fu1 - fu0) / 2, ae = ftH - 0.35; [[fu0, am - 2.4], [am + 2.4, fu1]].forEach(function (q) { A.box(q[0] - 0.1, ae - 0.05, WF - 0.18, q[1] + 0.02, ae + 0.05, WF + 0.24, LY.trim, 1, capC); });
      for (var ak = 0; ak < 10; ak++) { var a0 = PI * ak / 10, a1 = PI * (ak + 1) / 10; var p0 = [am + Math.cos(a0) * 2.4, ae + Math.sin(a0) * 0.6], p1 = [am + Math.cos(a1) * 2.4, ae + Math.sin(a1) * 0.6]; var mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2, dx = p1[0] - p0[0], dyy = p1[1] - p0[1], ll = Math.hypot(dx, dyy); A.obox([mx, my, WF + 0.03], [dx / ll, dyy / ll, 0], [-dyy / ll, dx / ll, 0], ll / 2 + 0.03, 0.06, 0.22, LY.trim, 1, capC); } }
    // a frieze band and the sign backer behind the R14 name board (board span u -1.95..2.25, y 3.45..4.25)
    A.box(fu0, 3.38, WF, fu1, 3.46, WF + 0.06, LY.trim, 1, K.trim);
    A.box(-1.98, 3.45, WF, 2.28, 4.3, WF + 0.03, LY.trim, 1, shade(K.trim, 0.8)); A.box(-2.06, 3.43, WF, 2.36, 3.49, WF + 0.06, LY.trim, 1, K.trim); A.box(-2.06, 4.28, WF, 2.36, 4.34, WF + 0.06, LY.trim, 1, K.trim);
    // gooseneck lamps over the board
    gooseneck(K, -1.35, 4.42, WF + 0.03); gooseneck(K, 1.65, 4.42, WF + 0.03);
    // side walls (sloped top) and the back wall
    [[U0, -1], [U1, 1]].forEach(function (sd) { var u = sd[0], o = sd[1] < 0 ? [u, 0, VB] : [u, 0, WF], t = sd[1] < 0 ? [0, 0, 1] : [0, 0, -1]; var len = WF - VB;
      var hs = (r() < 0.5 && sd[1] > 0) ? [[len * 0.45, len * 0.45 + 0.9, 1.2, 2.3]] : [];
      A.wall(o, t, len, y0, sideTopB, hs, wallL, F, shade(wc, 0.97), { rev: 0.14, RL: LY.trim, RF: 1, rc: K.trim });
      hs.forEach(function (h) { windowAt(K, o, t, h[0], h[1], h[2], h[3], { cols: 2, rows: 2, noRoom: false, depth: 1.2, shelves: false }); });
      // the sloped strip from sideTopB (back) to sideTopF (front)
      if (sd[1] < 0) A.tri([u, sideTopB, VB], [u, sideTopB, WF], [u, sideTopF, WF], [-1, 0, 0], wallL, F, shade(wc, 0.97)); else A.tri([u, sideTopB, WF], [u, sideTopB, VB], [u, sideTopF, WF], [1, 0, 0], wallL, F, shade(wc, 0.97)); });
    var bdoor = [[U1 - U0 - 2.8, U1 - U0 - 1.85, 0, 2.1, 0.08, 1]]; A.wall([U1, 0, VB], [-1, 0, 0], U1 - U0, y0, sideTopB, bdoor, wallL, F, shade(wc, 0.94), { rev: 0.1, RL: LY.trim, RF: 1, rc: K.trim });
    doorAt(K, [U1, 0, VB], [-1, 0, 0], bdoor[0][0], bdoor[0][1], 0, 2.1, { leaves: 1, inset: 0.08, lc: hex("#5a4030") });
    // foundation strip
    A.box(U0 - 0.06, y0, VB - 0.06, U1 + 0.06, 0.12, VB + 0.02, LY.concrete, 0, shade(WHITE, 0.85), { no: "b" }); A.box(U0 - 0.06, y0, VB, U0 + 0.02, 0.12, WF, LY.concrete, 0, shade(WHITE, 0.85), { no: "bs" }); A.box(U1 - 0.02, y0, VB, U1 + 0.06, 0.12, WF, LY.concrete, 0, shade(WHITE, 0.85), { no: "bs" });
    // roof: a shed roof sloping to the back (corrugated or standing seam), with a fascia and gutter at the back
    var roofL = r() < 0.55 ? LY.corr : LY.seam, roofC = roofL === LY.corr ? (r() < 0.4 ? hex("#c9a080") : shade(WHITE, 0.95)) : hex(pick(r, ["#5d6a5a", "#7a3a2c", "#4a4f55", "#8a8a84"]));
    var rp = [[U0 - 0.12, sideTopB + 0.03, VB - 0.35], [U1 + 0.12, sideTopB + 0.03, VB - 0.35], [U1 + 0.12, sideTopF + 0.03, WF - 0.14], [U0 - 0.12, sideTopF + 0.03, WF - 0.14]];
    var rn = nrmOf(rp[0], rp[3], rp[2]); A.q4(rp[0], rp[3], rp[2], rp[1], rn, roofL, roofL === LY.seam ? 1 : 0, roofC, 0, false);
    A.q4([U0 - 0.12, sideTopB - 0.03, VB - 0.35], [U1 + 0.12, sideTopB - 0.03, VB - 0.35], [U1 + 0.12, sideTopF - 0.03, WF - 0.14], [U0 - 0.12, sideTopF - 0.03, WF - 0.14], [0, -1, 0], LY.wood, 0, shade(WHITE, 0.6), 0, false);
    A.box(U0 - 0.14, sideTopB - 0.16, VB - 0.42, U1 + 0.14, sideTopB + 0.04, VB - 0.34, LY.trim, 1, K.trim);
    A.box(U0 - 0.14, sideTopB - 0.08, VB - 0.52, U1 + 0.14, sideTopB, VB - 0.42, LY.metal, 1, hex("#8d918f"));
    A.cyl(U1 - 0.2, 0, VB - 0.47, 0.045, sideTopB, 8, LY.metal, 1, hex("#8d918f"), false);
    // windows and the door on the front
    var disp = r() < 0.7; [wL, wR].forEach(function (w) { windowAt(K, [U0, 0, WF], [1, 0, 0], w[0] - U0, w[1] - U0, wy[0], wy[1], disp ? { cols: 3, rows: 1, fw: 0.08, depth: 1.8 } : { cols: 2, rows: 3, rail: true, depth: 1.6 }); if (disp) { // kickplate panel under a display window and a transom bar
        A.box(w[0], DH + 0.02, WF, w[1], wy[0] - 0.08, WF + 0.03, LY.trim, 1, shade(K.trim, 0.9)); A.box(w[0] + 0.08, DH + 0.1, WF + 0.03, w[1] - 0.08, wy[0] - 0.16, WF + 0.05, LY.trim, 1, K.trim); } });
    doorAt(K, [U0, 0, WF], [1, 0, 0], dr[0] - U0 + 0.05, dr[1] - U0 - 0.05, DH, dy1, { glazed: true, transom: r() < 0.6, leaves: 2 });
    // boardwalk deck (planks run out from the wall), its skirt board and edge
    var dkC = shade(WHITE, 0.85 + 0.15 * r()); A.box(deck[0], DH - 0.06, deck[2], deck[1], DH, deck[3], LY.wood, 0, dkC, { no: "b", rotTop: true });
    A.box(deck[0] - 0.02, -0.25, deck[3] - 0.05, deck[1] + 0.02, DH - 0.06, deck[3], LY.wood, 0, shade(dkC, 0.7), { no: "bt" }); A.box(deck[0] - 0.02, -0.25, deck[2], deck[0] + 0.03, DH - 0.06, deck[3], LY.wood, 0, shade(dkC, 0.7), { no: "bt" }); A.box(deck[1] - 0.03, -0.25, deck[2], deck[1] + 0.02, DH - 0.06, deck[3], LY.wood, 0, shade(dkC, 0.7), { no: "bt" });
    // posts with knee braces, the header beam, the porch roof
    var postC = r() < 0.5 ? K.trim : shade(WHITE, 0.75), postL = postC === K.trim ? LY.trim : LY.wood, beamY = CE - 0.18;
    posts.forEach(function (p) { A.box(p[0] - 0.075, DH, p[1] - 0.075, p[0] + 0.075, beamY, p[1] + 0.075, postL, postL === LY.trim ? 1 : 0, postC, { rot: true });
      A.box(p[0] - 0.1, DH, p[1] - 0.1, p[0] + 0.1, DH + 0.06, p[1] + 0.1, postL, postL === LY.trim ? 1 : 0, shade(postC, 0.8)); });
    var pv = posts.reduce(function (s, p) { return s + p[1]; }, 0) / posts.length; A.box(deck[0] - 0.1, beamY, pv - 0.09, deck[1] + 0.1, CE, pv + 0.09, postL, postL === LY.trim ? 1 : 0, postC);
    for (var pi = 0; pi < posts.length; pi++) { var p = posts[pi]; [-1, 1].forEach(function (sx) { if ((pi === 0 && sx < 0) || (pi === posts.length - 1 && sx > 0)) return; var bxc = p[0] + sx * 0.25, byc = beamY - 0.25; A.obox([bxc, byc, p[1]], [sx * 0.7071, 0.7071, 0], [-0.7071, sx * 0.7071, 0], 0.33, 0.04, 0.05, postL, postL === LY.trim ? 1 : 0, postC); }); }
    var prL = pick(r, [LY.corr, LY.wood, LY.seam]), prC = prL === LY.seam ? hex(pick(r, ["#5d6a5a", "#7a3a2c", "#4a4f55"])) : shade(WHITE, 0.9);
    var r0 = [deck[0] - 0.22, CE + 0.28, WF + 0.02], r1 = [deck[1] + 0.22, CE + 0.28, WF + 0.02], r2 = [deck[1] + 0.22, CE + 0.02, deck[3] + 0.3], r3 = [deck[0] - 0.22, CE + 0.02, deck[3] + 0.3];
    A.q4(r3, r2, r1, r0, nrmOf(r3, r2, r1), prL, prL === LY.seam ? 1 : 0, prC, 0, prL === LY.wood);
    A.q4([r0[0], r0[1] - 0.06, r0[2]], [r1[0], r1[1] - 0.06, r1[2]], [r2[0], r2[1] - 0.06, r2[2]], [r3[0], r3[1] - 0.06, r3[2]], [0, -1, 0], LY.wood, 0, shade(WHITE, 0.62), 0, false);
    A.box(r3[0], r3[1] - 0.2, r3[2] - 0.04, r2[0], r3[1] + 0.02, r3[2] + 0.02, LY.trim, 1, K.trim); A.box(r3[0] - 0.02, r3[1] - 0.12, r3[2] - 0.04, r3[0] + 0.03, r0[1], r0[2], LY.trim, 1, K.trim); A.box(r2[0] - 0.03, r2[1] - 0.12, r3[2] - 0.04, r2[0] + 0.02, r1[1], r1[2], LY.trim, 1, K.trim);
    // rafters under the porch roof
    { var rdy = r3[1] - r0[1], rdz = r3[2] - r0[2], rl = Math.hypot(rdy, rdz); for (var rx = deck[0] + 0.3; rx < deck[1]; rx += 0.8) A.obox([rx, (r0[1] + r3[1]) / 2 - 0.11, (r0[2] + r3[2]) / 2], [0, rdy / rl, rdz / rl], [0, rdz / rl, -rdy / rl], rl / 2, 0.05, 0.035, LY.wood, 0, shade(WHITE, 0.6)); }
    // far LOD: the body, the false front, the porch roof
    var Fz = K.f; Fz.box(U0, 0, VB, U1, sideTopB, WF, wallL, F, wc, { no: "b" }); Fz.box(U0, sideTopB, WF - 0.16, U1, ftH, WF, wallL, F, wc, { no: "b" }); Fz.box(deck[0], CE, WF, deck[1], CE + 0.25, deck[3] + 0.3, LY.wood, 0, shade(WHITE, 0.8), {}); Fz.box(deck[0], 0, WF, deck[1], DH, deck[3], LY.wood, 0, shade(WHITE, 0.8), { no: "b" });
    Fz.box(wL[0], wy[0], WF, wL[1], wy[1], WF + 0.02, LY.metal, 0, hex("#2a3036")); Fz.box(wR[0], wy[0], WF, wR[1], wy[1], WF + 0.02, LY.metal, 0, hex("#2a3036"));
  }

  // ───────────────────────── the streamline storefronts (the Club Walk) ─────────────────────────
  // measured from the model elevation (model units, scaled by the placement): 7.4 m front, the face at z 5.3, parapet 5.6 (centre 5.86),
  // canopy ledge 3.0..3.36, glass block band 3.42..4.07, sign band 4.1..5.19 (the R14 board at y 4.78, z 5.30), display windows
  // u -3.33..-0.7 and 0.77..3.08 from 0.7 to 2.95, the recessed door u -0.6..0.64; door point z 5.16 (0.86 x radius)
  function sfBuild(K) {
    var A = K.a, r = K.r; K.frame(K.e[3] + (-0.02)); var WF = 5.25, U0 = -3.7, U1 = 3.7, VB = -5.9, y0 = -0.4, PH = 5.62, PC = 5.9;
    var wc = hex(pick(r, PAL.sl)), acc = hex(pick(r, PAL.slTrim)); K.trim = hex(pick(r, ["#e8e6e0", "#d9d6cf", "#2a2a2a"])); K.roomC = hex(pick(r, ["#6c5b4a", "#5d5a55", "#7a6a58"]), 0.6); K.doorC = hex("#c9ccd0");
    var chrome = hex("#d8dcdf");
    // the front: stucco above a terrazzo or tile bulkhead; openings for the windows, the recessed door, the glass block band
    var wL = [-3.33, -0.75], wR = [0.75, 3.1], wy = [0.72, 2.95], dw = [-0.6, 0.62];
    var holes = [[wL[0] - U0, wL[1] - U0, wy[0], wy[1], 0.12], [dw[0] - U0, dw[1] - U0, 0.0, wy[1], 0.9, 1], [wR[0] - U0, wR[1] - U0, wy[0], wy[1], 0.12], [-2.45 - U0, 3.2 - U0, 3.45, 4.05, 0.06]];
    A.wall([U0, 0, WF], [1, 0, 0], U1 - U0, y0, PH, holes, LY.stucco, 1, wc, { rev: 0.12, RL: LY.metal, RF: 1, rc: chrome });
    // the raised centre parapet
    A.box(-1.8, PH, WF - 0.25, 1.8, PC, WF, LY.stucco, 1, wc, { no: "b" }); A.box(-1.86, PC, WF - 0.3, 1.86, PC + 0.06, WF + 0.05, LY.metal, 1, chrome);
    A.box(U0 - 0.03, PH, WF - 0.25, U1 + 0.03, PH + 0.05, WF + 0.03, LY.metal, 1, chrome);
    // speed lines on the left (three chrome bands round the corner) and an accent stripe under the sign band
    [4.2, 4.65, 5.1].forEach(function (y) { A.box(U0 - 0.05, y - 0.05, WF - 1.2, -2.5, y + 0.05, WF + 0.06, LY.metal, 1, chrome); A.box(U0 - 0.06, y - 0.05, WF - 1.2, U0 + 0.01, y + 0.05, WF + 0.06, LY.metal, 1, chrome); });
    A.box(-2.45, 4.08, WF, 3.4, 4.16, WF + 0.05, LY.trim, 1, acc);
    // glass block band
    A.box(-2.45, 3.45, WF - 0.08, 3.2, 4.05, WF - 0.04, LY.gblock, 0, shade(WHITE, 1.0), { no: "nb" });
    // the canopy ledge over the windows (stucco with a chrome edge and an accent stripe)
    A.box(U0 - 0.12, 3.0, WF, U1 + 0.12, 3.36, WF + 0.95, LY.stucco, 1, shade(wc, 0.98)); A.box(U0 - 0.13, 3.14, WF + 0.95, U1 + 0.13, 3.22, WF + 0.97, LY.trim, 1, acc); A.box(U0 - 0.13, 3.0, WF + 0.95, U1 + 0.13, 3.04, WF + 0.97, LY.metal, 1, chrome);
    // canopy soffit downlights (emissive at night)
    [-2.6, -1.3, 1.3, 2.6].forEach(function (x) { A.box(x - 0.09, 2.985, WF + 0.4, x + 0.09, 3.0, WF + 0.58, LY.metal, 3, hex("#ffe3b0")); });
    // bulkhead under the display windows (terrazzo) and a black glass kickplate band
    [wL, wR].forEach(function (w) { A.box(w[0] - 0.05, 0, WF, w[1] + 0.05, wy[0] - 0.02, WF + 0.06, LY.terrazzo, 0, shade(WHITE, 0.95)); A.box(w[0] - 0.05, wy[0] - 0.08, WF + 0.06, w[1] + 0.05, wy[0] - 0.02, WF + 0.09, LY.metal, 1, chrome); });
    // display windows (thin chrome frames, one big light, a low display platform behind)
    [wL, wR].forEach(function (w) { windowAt(K, [U0, 0, WF], [1, 0, 0], w[0] - U0, w[1] - U0, wy[0], wy[1], { cols: 1, rows: 1, fw: 0.05, tc: chrome, noCasing: true, noSill: true, inset: 0.1, depth: 2.2, lit: 0.95 }); });
    // the recessed entry: side glass returns and the door at the back of the recess
    var rd = 0.9; A.box(dw[0], 0, WF - rd, dw[1], 0.02, WF, LY.terrazzo, 0, shade(WHITE, 0.9), { no: "b" });
    doorAt(K, [U0, 0, WF - rd], [1, 0, 0], dw[0] - U0 + 0.04, dw[1] - U0 - 0.04, 0.02, wy[1] - 0.05, { glazed: true, transom: true, leaves: 1, tc: chrome, lc: chrome, inset: 0.04 });
    // side walls with three glass block windows on one side, a stepped roofline; the back wall
    [[U0, -1], [U1, 1]].forEach(function (sd) { var u = sd[0], o = sd[1] < 0 ? [u, 0, VB] : [u, 0, WF], t = sd[1] < 0 ? [0, 0, 1] : [0, 0, -1], len = WF - VB;
      var gb = sd[1] > 0 ? [[2.5, 3.3, 1.4, 3.2, 0.08], [5.0, 5.8, 1.4, 3.2, 0.08], [7.5, 8.3, 1.4, 3.2, 0.08]] : [];
      A.wall(o, t, len, y0, PH - 0.5, gb, LY.stucco, 1, shade(wc, 0.97), { rev: 0.08 });
      gb.forEach(function (h) { var p0 = [o[0] + t[0] * h[0] - (sd[1] > 0 ? 0.08 : -0.08), h[2], o[2] + t[2] * h[0]], p1 = [o[0] + t[0] * h[1], h[3], o[2] + t[2] * h[1]]; A.box(Math.min(p0[0], p1[0]), h[2], Math.min(p0[2], p1[2]), Math.max(p0[0], p1[0]), h[3], Math.max(p0[2], p1[2]), LY.gblock, 0, WHITE, { no: "" }); });
      A.box(sd[1] < 0 ? u - 0.02 : u - 0.25, PH - 0.5, VB, sd[1] < 0 ? u + 0.25 : u + 0.02, PH, WF - 0.25, LY.stucco, 1, wc, { no: "b" }); });
    A.wall([U1, 0, VB], [-1, 0, 0], U1 - U0, y0, PH - 0.5, [[2.2, 3.2, 0, 2.2, 0.08, 1]], LY.stucco, 1, shade(wc, 0.95), { rev: 0.08 }); doorAt(K, [U1, 0, VB], [-1, 0, 0], 2.2, 3.2, 0, 2.2, { leaves: 1, inset: 0.06, lc: hex("#8a8f94"), tc: chrome });
    // roof deck with a coping
    A.box(U0, PH - 0.55, VB, U1, PH - 0.5, WF - 0.25, LY.concrete, 0, shade(WHITE, 0.7), { no: "b" }); A.box(U0 - 0.03, PH - 0.5, VB - 0.03, U1 + 0.03, PH - 0.45, VB + 0.2, LY.metal, 1, chrome);
    // a rooftop vent box
    A.box(1.2, PH - 0.5, -2.5, 2.4, PH + 0.2, -1.4, LY.metal, 1, hex("#b8bcbf"));
    // far LOD
    var Fz = K.f; Fz.box(U0, 0, VB, U1, PH, WF, LY.stucco, 1, wc, { no: "b" }); Fz.box(U0, 3.0, WF, U1, 3.36, WF + 0.95, LY.stucco, 1, wc, {}); Fz.box(wL[0], wy[0], WF, wL[1], wy[1], WF + 0.02, LY.metal, 0, hex("#2a3036")); Fz.box(wR[0], wy[0], WF, wR[1], wy[1], WF + 0.02, LY.metal, 0, hex("#2a3036"));
  }

  // ───────────────────────── painted name signs (one canvas atlas for every sign this module draws) ─────────────────────────
  var SIGN = XT.sign = { cv: null, n: 0, cols: 4, w: 512, h: 128, rows: 16, tex: null };
  function signAtlas() { if (SIGN.cv) return SIGN; var c = document.createElement("canvas"); c.width = SIGN.w * SIGN.cols; c.height = SIGN.h * SIGN.rows; SIGN.cv = c; SIGN.x = c.getContext("2d"); return SIGN; }
  function fitText(x, txt, font, maxW, px) { var s = px; do { x.font = font.replace("{px}", s); if (x.measureText(txt).width <= maxW) break; s -= 2; } while (s > 12); return s; }
  // style: wood (cream letters on dark boards), gold (gold leaf on black), stone (incised on sandstone), enamel (white on red), modern (white sans on charcoal), neon
  function signSlot(text, style, sub) {
    var S = signAtlas(); if (S.n >= S.cols * S.rows) return null; var k = S.n++, cx = (k % S.cols) * S.w, cy = Math.floor(k / S.cols) * S.h, W = S.w, H = S.h, x = S.x; x.save(); x.translate(cx, cy);
    var pal = { wood: ["#3f2a1a", "#f1dcaa", "#1c120a"], gold: ["#16120e", "#e6c15a", "#000"], stone: ["#cdb48f", "#6e5536", "#f3e6cc"], enamel: ["#8e2420", "#f6efe2", "#3d0d0b"], modern: ["#1f2324", "#f3f0e8", "#000"], neon: ["#101216", "#ff5f8f", "#ff5f8f"], cream: ["#efe4c9", "#5a2a1c", "#fff"] }[style] || ["#3f2a1a", "#f1dcaa", "#1c120a"];
    var g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, pal[0]); g.addColorStop(1, shadeHex(pal[0], 0.82)); x.fillStyle = g; x.fillRect(0, 0, W, H);
    if (style === "wood") { for (var i = 0; i < 5; i++) { x.fillStyle = "rgba(0,0,0," + (0.08 + 0.05 * (i % 2)) + ")"; x.fillRect(0, i * H / 5, W, 2); } for (var j = 0; j < 160; j++) { x.fillStyle = "rgba(255,240,210,0.035)"; x.fillRect(Math.random() * W, Math.random() * H, 30 + Math.random() * 80, 1); } }
    if (style === "stone") { for (var j2 = 0; j2 < 400; j2++) { x.fillStyle = "rgba(90,60,30," + (Math.random() * 0.06) + ")"; x.fillRect(Math.random() * W, Math.random() * H, 2, 2); } }
    x.strokeStyle = style === "gold" ? "#b8963e" : style === "stone" ? "rgba(90,66,40,0.6)" : "rgba(255,240,210,0.35)"; x.lineWidth = 4; x.strokeRect(8, 8, W - 16, H - 16);
    var serif = style === "modern" || style === "neon" ? "{px}px Anton, Impact, sans-serif" : "bold {px}px Georgia, 'Times New Roman', serif";
    var t = String(text || "").toUpperCase(); var px = fitText(x, t, serif, W - 56, sub ? 54 : 66); x.textAlign = "center"; x.textBaseline = "middle"; var ty = sub ? H * 0.42 : H * 0.53;
    if (style === "neon") { x.shadowColor = pal[1]; x.shadowBlur = 18; } else if (style === "stone") { x.fillStyle = pal[2]; x.fillText(t, W / 2 + 1, ty + 2); } else { x.fillStyle = pal[2]; x.fillText(t, W / 2 + 3, ty + 3); }
    x.fillStyle = pal[1]; x.fillText(t, W / 2, ty);
    if (sub) { x.shadowBlur = 0; var s2 = String(sub).toUpperCase(); fitText(x, s2, style === "modern" || style === "neon" ? "{px}px 'Space Grotesk', sans-serif" : "bold {px}px Georgia, serif", W - 80, 26); x.fillStyle = pal[1]; x.globalAlpha = 0.85; x.fillText(s2, W / 2, H * 0.78); x.globalAlpha = 1; }
    x.restore();
    var u0 = cx / (S.w * S.cols), u1 = (cx + W) / (S.w * S.cols), v1 = 1 - cy / (S.h * S.rows), v0 = 1 - (cy + H) / (S.h * S.rows); return [u0 + 0.001, v0 + 0.002, u1 - 0.001, v1 - 0.002];
  }
  function shadeHex(h, k) { var v = parseInt(h.slice(1), 16); var r = Math.round(((v >> 16) & 255) * k), g = Math.round(((v >> 8) & 255) * k), b = Math.round((v & 255) * k); return "rgb(" + r + "," + g + "," + b + ")"; }
  // a sign board on a wall plane (o, t) at s0..s1, y0..y1, standing off the wall by d, with a frame in the main material
  function signAt(K, o, t, s0, s1, y0, y1, text, style, sub, d) { d = d === undefined ? 0.06 : d; var uv = signSlot(text, style, sub); if (!uv || !K.s) return; var n = [-t[2], 0, t[0]];
    function P(s, y, dd) { return [o[0] + t[0] * s + n[0] * dd, y, o[2] + t[2] * s + n[2] * dd]; }
    K.s.quad(P(s0, y0, d + 0.012), P(s1, y0, d + 0.012), P(s1, y1, d + 0.012), P(s0, y1, d + 0.012), n, uv);
    var fc = style === "gold" ? hex("#9c7a32") : style === "stone" ? hex("#d9c39c") : hex("#2a1b10"); var fw = 0.07;
    function bar(sa, sb, ya, yb) { var p = [P(sa, ya, 0), P(sb, ya, 0), P(sa, ya, d + 0.03), P(sb, ya, d + 0.03)]; var x0 = Math.min(p[0][0], p[1][0], p[2][0], p[3][0]), x1 = Math.max(p[0][0], p[1][0], p[2][0], p[3][0]), z0 = Math.min(p[0][2], p[1][2], p[2][2], p[3][2]), z1 = Math.max(p[0][2], p[1][2], p[2][2], p[3][2]); K.a.box(x0, ya, z0, x1, yb, z1, LY.trim, 1, fc); }
    bar(s0 - fw, s1 + fw, y0 - fw, y0); bar(s0 - fw, s1 + fw, y1, y1 + fw); bar(s0 - fw, s0, y0, y1); bar(s1, s1 + fw, y0, y1);
    var bk = [P(s0, y0, 0), P(s1, y0, 0), P(s0, y0, d), P(s1, y0, d)]; K.a.box(Math.min(bk[0][0], bk[1][0], bk[2][0], bk[3][0]), y0, Math.min(bk[0][2], bk[1][2], bk[2][2], bk[3][2]), Math.max(bk[0][0], bk[1][0], bk[2][0], bk[3][0]), y1, Math.max(bk[0][2], bk[1][2], bk[2][2], bk[3][2]), LY.trim, 1, shade(fc, 0.8), { no: "s" }); }
  function shortName(nm) { return String(nm || "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim(); }

  // a railing between two points on a deck edge (top rail, bottom rail, balusters), in the main material
  function railing(A, x0, z0, x1, z1, y, h, col, step) { var L = Math.hypot(x1 - x0, z1 - z0); if (L < 0.2) return; var dx = (x1 - x0) / L, dz = (z1 - z0) / L; step = step || 0.16; var ax = [dx, 0, dz], ay = [0, 1, 0];
    A.obox([(x0 + x1) / 2, y + h - 0.03, (z0 + z1) / 2], ax, ay, L / 2, 0.035, 0.05, LY.trim, 1, col); A.obox([(x0 + x1) / 2, y + 0.12, (z0 + z1) / 2], ax, ay, L / 2, 0.025, 0.035, LY.trim, 1, col);
    var n = Math.max(1, Math.floor(L / step)); for (var i = 0; i <= n; i++) { var f = i / n, px = x0 + (x1 - x0) * f, pz = z0 + (z1 - z0) * f; A.box(px - 0.018, y + 0.12, pz - 0.018, px + 0.018, y + h - 0.06, pz + 0.018, LY.trim, 1, col, { no: "tb" }); } }

  // a straight cornice run along the front (crown, frieze, brackets) at top height y, spanning u0..u1 on the wall at v
  function cornice(A, u0, u1, y, v, col, opt) { opt = opt || {}; var p = opt.proj || 0.32;
    A.box(u0 - 0.16, y - 0.07, v - 0.2, u1 + 0.16, y + 0.06, v + p, LY.trim, 1, col); A.box(u0 - 0.1, y - 0.26, v - 0.04, u1 + 0.1, y - 0.07, v + p * 0.62, LY.trim, 1, shade(col, 0.93)); A.box(u0 - 0.05, y - 0.46, v, u1 + 0.05, y - 0.26, v + 0.09, LY.trim, 1, col);
    if (opt.brackets !== false) for (var bx = u0 + 0.3; bx < u1 - 0.15; bx += (opt.bstep || 0.7)) A.box(bx - 0.05, y - 0.5, v, bx + 0.05, y - 0.26, v + p * 0.55, LY.trim, 1, shade(col, 0.86));
    if (opt.dentils) for (var dx = u0 + 0.1; dx < u1 - 0.05; dx += 0.22) A.box(dx - 0.05, y - 0.62, v, dx + 0.05, y - 0.5, v + 0.08, LY.trim, 1, shade(col, 0.92)); }

  // generic wall with evenly spaced windows on a plane (used for sides and backs of the multi-storey venues)
  function sideWindows(K, o, t, len, floors, opt) { opt = opt || {}; floors.forEach(function (fl) { var nW = Math.max(1, Math.floor((len - 1.2) / (opt.bay || 3.2))); var w = opt.ww || 1.0, h = opt.wh || 1.9;
      for (var i = 0; i < nW; i++) { var sc = (i + 0.5) * len / nW; if (opt.skip && opt.skip(sc, fl)) continue; var y0 = fl[0] + (opt.sill || 0.95); fl.holes.push([sc - w / 2, sc + w / 2, y0, y0 + h]); } }); }

  // ───────────────────────── the saloon (two storeys and a false front, a boardwalk under a balcony) ─────────────────────────
  DEF.saloon = { a: -0.0699, wall: 4.03, deck: [-5.6, 5.4, 4.03, 7.08], h: 0.4, ceil: 6.87, posts: [[-5.24, 6.67], [-1.04, 6.58], [5.25, 6.87]], door: [-1.6, 0.75], body: { u: [-6.1, 6.1], v: [-7.3, 4.03], h: 15 } };
  function saloonBuild(K) {
    var A = K.a, r = K.r, ps = porchSide("saloon"), S = ps ? ps.side : DEF.saloon, body = ps && ps.body ? ps.body : DEF.saloon.body;
    K.frame(K.e[3] + (S.a || 0)); var WF = S.wall, U0 = body.u[0], U1 = body.u[1], VB = body.v[0], DH = S.h, CE = S.ceil, deck = S.deck, posts = S.posts, dr = S.door, y0 = -0.45;
    var G1 = 7.0, G2 = 11.0, FT = 13.2 + r() * 1.4; var nm = shortName(K.name);
    var gcl = pick(r, ["brick", "brick", "adobe", "ashlar", "clap", "plaster"]), ucl = gcl === "brick" ? pick(r, ["brick", "wood", "clap"]) : gcl === "ashlar" ? "brick" : pick(r, ["wood", "clap", "batten"]);
    if (/border|windmill/i.test(nm)) { gcl = "adobe"; ucl = "adobe"; } if (/silver|gilded|lily/i.test(nm)) { gcl = "brick"; ucl = "clap"; } if (/tumbleweed|corral|seed|longhorn/i.test(nm)) { gcl = pick(r, ["wood", "batten"]); ucl = gcl; }
    function colFor(cl) { return cl === "adobe" ? hex(pick(r, PAL.earth)) : cl === "plaster" ? hex(pick(r, PAL.plaster)) : (cl === "clap" || cl === "batten") ? hex(pick(r, PAL.paint)) : shade(WHITE, 0.88 + 0.16 * r()); }
    var gL = LY[gcl], uL = LY[ucl], gC = colFor(gcl), uC = ucl === gcl ? gC : colFor(ucl), gF = (gcl === "clap" || gcl === "batten" || gcl === "plaster" || gcl === "adobe") ? 1 : 0, uF = (ucl === "clap" || ucl === "batten" || ucl === "plaster" || ucl === "adobe") ? 1 : 0;
    K.trim = hex(pick(r, PAL.trim)); K.doorC = hex(pick(r, ["#5a3a24", "#6b4528", "#3e2a1c", "#7a5232", "#4d2f1f"])); K.roomC = hex(pick(r, ["#7a5a3a", "#6a4a32", "#5e4634"]), 0.6);
    // ground floor front: the door (bat-wing doors behind a tall opening with a transom), two tall windows
    var wL = [-4.75, -2.75], wR = [1.75, 3.75], wy = [1.15, 4.4], dy1 = 4.0;
    var gh = [[wL[0] - U0, wL[1] - U0, wy[0], wy[1]], [dr[0] - U0 + 0.05, dr[1] - U0 - 0.05, DH, dy1, 0.16, 1], [wR[0] - U0, wR[1] - U0, wy[0], wy[1]]];
    A.wall([U0, 0, WF], [1, 0, 0], U1 - U0, y0, G1, gh, gL, gF, gC, { rev: 0.18, RL: LY.trim, RF: 1, rc: K.trim });
    [wL, wR].forEach(function (w) { windowAt(K, [U0, 0, WF], [1, 0, 0], w[0] - U0, w[1] - U0, wy[0], wy[1], { cols: 2, rows: 3, rail: true, depth: 2.0, pediment: true, inset: 0.14 }); });
    doorAt(K, [U0, 0, WF], [1, 0, 0], dr[0] - U0 + 0.05, dr[1] - U0 - 0.05, DH, dy1, { glazed: true, transom: true, leaves: 2, inset: 0.16 });
    // bat-wing doors a step inside the opening
    (function () { var s0 = dr[0] + 0.12, s1 = dr[1] - 0.12, mid = (s0 + s1) / 2, z = WF - 0.6; [[s0, mid - 0.02], [mid + 0.02, s1]].forEach(function (q) { A.box(q[0], DH + 0.55, z - 0.03, q[1], DH + 1.75, z + 0.03, LY.trim, 1, K.doorC); for (var yy = DH + 0.7; yy < DH + 1.65; yy += 0.12) A.box(q[0] + 0.06, yy, z + 0.03, q[1] - 0.06, yy + 0.05, z + 0.05, LY.trim, 1, shade(K.doorC, 1.15)); }); })();
    // the name painted on a board in the band between the windows and the balcony
    var sty = /gilded|lily|silver|spur|lucky/i.test(nm) ? "gold" : /border/i.test(nm) ? "cream" : "wood"; signAt(K, [U0, 0, WF], [1, 0, 0], 0.9, U1 - U0 - 0.9, 4.9, 6.2, nm, sty, /saloon|tavern/i.test(nm) ? null : "Saloon");
    // upper floor front: three windows and a balcony door in the middle
    var uh = [[-4.6 - U0, -3.3 - U0, 7.6, 9.9], [-0.6 - U0, 0.6 - U0, CE + 0.02, 9.6, 0.12, 1], [3.3 - U0, 4.6 - U0, 7.6, 9.9]];
    A.wall([U0, 0, WF], [1, 0, 0], U1 - U0, G1, G2, uh, uL, uF, uC, { rev: 0.14, RL: LY.trim, RF: 1, rc: K.trim });
    [uh[0], uh[2]].forEach(function (h) { windowAt(K, [U0, 0, WF], [1, 0, 0], h[0], h[1], h[2], h[3], { cols: 2, rows: 2, rail: true, depth: 1.5, panel: null, dark: r() < 0.4, shelves: false }); });
    doorAt(K, [U0, 0, WF], [1, 0, 0], uh[1][0], uh[1][1], CE + 0.02, 9.6, { glazed: true, leaves: 1, inset: 0.12 });
    // a belt course between the floors
    A.box(U0 - 0.04, G1 - 0.12, WF, U1 + 0.04, G1 + 0.06, WF + 0.1, LY.trim, 1, K.trim);
    // false front above the roof, with a shaped top and cornice
    var shape = pick(r, ["flat", "step", "arch", "flat"]); var w = U1 - U0 + 0.04, pts;
    if (shape === "flat") pts = [[0, G2], [w, G2], [w, FT], [0, FT]]; else if (shape === "step") pts = [[0, G2], [w, G2], [w, FT - 0.8], [w * 0.8, FT - 0.8], [w * 0.8, FT], [w * 0.2, FT], [w * 0.2, FT - 0.8], [0, FT - 0.8]];
    else { pts = [[0, G2], [w, G2], [w, FT - 0.6]]; for (var ai = 0; ai <= 12; ai++) { var aa = PI * ai / 12; pts.push([w / 2 + Math.cos(aa) * 3.6, FT - 0.6 + Math.sin(aa) * 0.9]); } pts.push([0, FT - 0.6]); }
    A.ext([U0 - 0.02, 0, WF], [1, 0, 0], pts, 0.2, uL, uF, uC, { EL: LY.trim });
    if (shape === "flat") cornice(A, U0, U1, FT, WF, K.trim, { dentils: r() < 0.5 }); else if (shape === "step") { cornice(A, U0 + w * 0.2, U1 - w * 0.2, FT, WF, K.trim, {}); cornice(A, U0, U0 + w * 0.2, FT - 0.8, WF, K.trim, { brackets: false }); cornice(A, U1 - w * 0.2, U1, FT - 0.8, WF, K.trim, { brackets: false }); }
    else { cornice(A, U0, U0 + w / 2 - 3.6, FT - 0.6, WF, K.trim, { brackets: false }); cornice(A, U0 + w / 2 + 3.6, U1, FT - 0.6, WF, K.trim, { brackets: false }); for (var ak = 0; ak < 12; ak++) { var a0 = PI * ak / 12, a1 = PI * (ak + 1) / 12, cx0 = U0 + w / 2; var p0 = [cx0 + Math.cos(a0) * 3.6, FT - 0.6 + Math.sin(a0) * 0.9], p1 = [cx0 + Math.cos(a1) * 3.6, FT - 0.6 + Math.sin(a1) * 0.9]; var dx = p1[0] - p0[0], dyy = p1[1] - p0[1], ll = Math.hypot(dx, dyy); A.obox([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, WF + 0.05], [dx / ll, dyy / ll, 0], [-dyy / ll, dx / ll, 0], ll / 2 + 0.03, 0.07, 0.25, LY.trim, 1, K.trim); } }
    // a big painted sign across the false front (the house name) or a SALOON board
    signAt(K, [U0, 0, WF], [1, 0, 0], 1.6, U1 - U0 - 1.6, G2 + 0.4, G2 + 1.5, /saloon/i.test(nm) ? "Saloon" : "Saloon", sty === "gold" ? "gold" : "wood", null, 0.05);
    // the balcony over the boardwalk: slab, fascia, railing; posts from the deck to the balcony
    var bC = shade(WHITE, 0.8 + 0.15 * r()), postC = r() < 0.5 ? K.trim : shade(WHITE, 0.72), postL = postC === K.trim ? LY.trim : LY.wood;
    A.box(deck[0] - 0.1, CE - 0.26, WF, deck[1] + 0.1, CE, deck[3] + 0.12, LY.wood, 0, bC, { rotTop: true }); A.box(deck[0] - 0.12, CE - 0.32, deck[3] + 0.08, deck[1] + 0.12, CE + 0.02, deck[3] + 0.16, LY.trim, 1, K.trim);
    railing(A, deck[0] - 0.05, deck[3] + 0.08, deck[1] + 0.05, deck[3] + 0.08, CE, 1.0, K.trim); railing(A, deck[0] - 0.05, WF + 0.05, deck[0] - 0.05, deck[3] + 0.08, CE, 1.0, K.trim); railing(A, deck[1] + 0.05, WF + 0.05, deck[1] + 0.05, deck[3] + 0.08, CE, 1.0, K.trim);
    posts.forEach(function (p) { A.box(p[0] - 0.09, DH, p[1] - 0.09, p[0] + 0.09, CE - 0.26, p[1] + 0.09, postL, postL === LY.trim ? 1 : 0, postC, { rot: true }); [-1, 1].forEach(function (sx) { A.obox([p[0] + sx * 0.3, CE - 0.55, p[1]], [sx * 0.7071, 0.7071, 0], [-0.7071, sx * 0.7071, 0], 0.4, 0.045, 0.06, postL, postL === LY.trim ? 1 : 0, postC); }); });
    // boardwalk
    var dkC = shade(WHITE, 0.85 + 0.15 * r()); A.box(deck[0], DH - 0.06, deck[2], deck[1], DH, deck[3], LY.wood, 0, dkC, { no: "b", rotTop: true }); A.box(deck[0] - 0.02, -0.25, deck[3] - 0.05, deck[1] + 0.02, DH - 0.06, deck[3], LY.wood, 0, shade(dkC, 0.7), { no: "bt" });
    // side walls (two storeys), back wall, flat roof behind the parapet
    var len = WF - VB; [[U0, -1], [U1, 1]].forEach(function (sd) { var u = sd[0], o = sd[1] < 0 ? [u, 0, VB] : [u, 0, WF], t = sd[1] < 0 ? [0, 0, 1] : [0, 0, -1];
      var h1 = [], h2 = []; for (var i = 0; i < 3; i++) { var sc = 1.8 + i * (len - 3.6) / 2; if (r() < 0.7) h1.push([sc - 0.5, sc + 0.5, 1.6, 3.6]); h2.push([sc - 0.5, sc + 0.5, 7.7, 9.6]); }
      A.wall(o, t, len, y0, G1, h1, gL, gF, shade(gC, 0.96), { rev: 0.14, RL: LY.trim, RF: 1, rc: K.trim }); A.wall(o, t, len, G1, G2 + 0.35, h2, uL, uF, shade(uC, 0.96), { rev: 0.12, RL: LY.trim, RF: 1, rc: K.trim });
      h1.concat(h2).forEach(function (h) { windowAt(K, o, t, h[0], h[1], h[2], h[3], { cols: 2, rows: 2, rail: true, depth: 1.2, panel: null, shelves: false, dark: r() < 0.5 }); }); });
    var bh = [[len * 0 + 1.5, 2.5, 0, 2.3, 0.1, 1], [5.0, 6.0, 7.7, 9.6], [8.0, 9.0, 7.7, 9.6]]; A.wall([U1, 0, VB], [-1, 0, 0], U1 - U0, y0, G1, [bh[0]], gL, gF, shade(gC, 0.94), { rev: 0.12, RL: LY.trim, RF: 1, rc: K.trim }); A.wall([U1, 0, VB], [-1, 0, 0], U1 - U0, G1, G2 + 0.35, [bh[1], bh[2]], uL, uF, shade(uC, 0.94), { rev: 0.12, RL: LY.trim, RF: 1, rc: K.trim });
    doorAt(K, [U1, 0, VB], [-1, 0, 0], bh[0][0], bh[0][1], 0, 2.3, { leaves: 1, inset: 0.1 }); [bh[1], bh[2]].forEach(function (h) { windowAt(K, [U1, 0, VB], [-1, 0, 0], h[0], h[1], h[2], h[3], { cols: 2, rows: 2, depth: 1.2, panel: null, shelves: false, dark: true }); });
    A.box(U0, G2 - 0.1, VB, U1, G2, WF - 0.2, LY.concrete, 0, shade(WHITE, 0.55), { no: "b" }); A.box(U0 - 0.05, G2 + 0.35, VB - 0.05, U1 + 0.05, G2 + 0.45, WF - 0.2, LY.trim, 1, K.trim, { no: "b" });
    A.box(U0 - 0.06, y0, VB - 0.06, U1 + 0.06, 0.15, WF, LY.ashlar, 0, shade(WHITE, 0.8), { no: "bs" });
    A.cyl(U1 - 0.2, 0, VB - 0.12, 0.05, G2 + 0.3, 8, LY.metal, 1, hex("#8d918f"), false);
    var Fz = K.f; Fz.box(U0, 0, VB, U1, G1, WF, gL, gF, gC, { no: "b" }); Fz.box(U0, G1, VB, U1, G2, WF, uL, uF, uC, { no: "b" }); Fz.box(U0, G2, WF - 0.2, U1, FT, WF, uL, uF, uC, { no: "b" }); Fz.box(deck[0], CE - 0.26, WF, deck[1], CE + 0.9, deck[3], LY.wood, 0, bC, {});
    [wL, wR].forEach(function (q) { Fz.box(q[0], wy[0], WF, q[1], wy[1], WF + 0.02, LY.metal, 2, hex("#ffcf8a", 0.12)); });
  }

  // ───────────────────────── the hotel (three storeys, a veranda front and back, a roof terrace) ─────────────────────────
  DEF.hotel = { a: 0.005, wall: 9.91, deck: [-10.9, 10.9, 9.91, 13], h: 0.43, ceil: 4.9, posts: [[-10.58, 12.69], [-7.03, 12.72], [-3.63, 12.65], [3.47, 12.76], [6.87, 12.75], [10.47, 12.82]], door: [-1.25, 1.25], body: { u: [-11.3, 11.3], v: [-9.97, 9.91], h: 20 } };
  function verandaFront(K, S, WF, U0, U1, style) { var A = K.a, deck = S.deck, DH = S.h, CE = S.ceil, posts = S.posts, r = K.r;
    var dkC = shade(WHITE, 0.85 + 0.12 * r()); A.box(deck[0], DH - 0.06, deck[2], deck[1], DH, deck[3], LY.wood, 0, dkC, { no: "b", rotTop: true }); A.box(deck[0] - 0.02, -0.3, deck[3] - 0.05, deck[1] + 0.02, DH - 0.06, deck[3], LY.wood, 0, shade(dkC, 0.7), { no: "bt" });
    A.box(deck[0] - 0.02, -0.3, deck[2], deck[0] + 0.03, DH - 0.06, deck[3], LY.wood, 0, shade(dkC, 0.7), { no: "bt" }); A.box(deck[1] - 0.03, -0.3, deck[2], deck[1] + 0.02, DH - 0.06, deck[3], LY.wood, 0, shade(dkC, 0.7), { no: "bt" });
    var pc = style.postC || K.trim, pL = style.postL === undefined ? LY.trim : style.postL, pF = pL === LY.trim ? 1 : 0;
    posts.forEach(function (p) { if (style.round) A.cyl(p[0], DH, p[1], 0.11, CE - 0.25 - DH, 10, pL, pF, pc, false); else A.box(p[0] - 0.1, DH, p[1] - 0.1, p[0] + 0.1, CE - 0.25, p[1] + 0.1, pL, pF, pc, { rot: true }); A.box(p[0] - 0.14, DH, p[1] - 0.14, p[0] + 0.14, DH + 0.1, p[1] + 0.14, pL, pF, shade(pc, 0.85)); A.box(p[0] - 0.13, CE - 0.34, p[1] - 0.13, p[0] + 0.13, CE - 0.25, p[1] + 0.13, pL, pF, shade(pc, 0.9)); });
    var pv = posts.reduce(function (s, p) { return s + p[1]; }, 0) / posts.length; A.box(deck[0] - 0.12, CE - 0.25, pv - 0.12, deck[1] + 0.12, CE, pv + 0.12, LY.trim, 1, pc);
    // shed roof (standing seam or corrugated), plank soffit, fascia
    var rL = style.roofL === undefined ? LY.seam : style.roofL, rC = style.roofC || hex("#5d6a5a"); var r0 = [deck[0] - 0.25, CE + 0.42, WF + 0.02], r1 = [deck[1] + 0.25, CE + 0.42, WF + 0.02], r2 = [deck[1] + 0.25, CE + 0.05, deck[3] + 0.35], r3 = [deck[0] - 0.25, CE + 0.05, deck[3] + 0.35];
    A.q4(r3, r2, r1, r0, nrmOf(r3, r2, r1), rL, rL === LY.seam ? 1 : 0, rC, 0, false); A.q4([r0[0], r0[1] - 0.08, r0[2]], [r1[0], r1[1] - 0.08, r1[2]], [r2[0], r2[1] - 0.08, r2[2]], [r3[0], r3[1] - 0.08, r3[2]], [0, -1, 0], LY.wood, 0, shade(WHITE, 0.7), 0, true);
    A.box(r3[0], r3[1] - 0.24, r3[2] - 0.05, r2[0], r3[1] + 0.03, r3[2] + 0.02, LY.trim, 1, K.trim);
    if (style.rail) railing(A, deck[0] + 0.05, deck[3] - 0.1, (S.door[0] + S.door[1]) / 2 - 2.0, deck[3] - 0.1, DH, 0.85, K.trim), railing(A, (S.door[0] + S.door[1]) / 2 + 2.0, deck[3] - 0.1, deck[1] - 0.05, deck[3] - 0.1, DH, 0.85, K.trim);
  }
  function hotelBuild(K) {
    var A = K.a, r = K.r, ps = porchSide("hotel"), S = ps ? ps.side : DEF.hotel, body = ps && ps.body ? ps.body : DEF.hotel.body, SB = ps && ps.all && ps.all[1] ? ps.all[1] : null;
    K.frame(K.e[3] + (S.a || 0)); var WF = S.wall, U0 = body.u[0], U1 = body.u[1], VB = body.v[0], y0 = -0.45, nm = shortName(K.name);
    var FL = [0, 5.2, 9.4, 13.6], PT = 14.6; var lodge = /lodge/i.test(nm), court = /court/i.test(nm), border = /border/i.test(nm), grand = /grand|copper/i.test(nm);
    var gcl = court ? "ashlar" : border ? "adobe" : lodge ? "stucco" : grand ? "ashlar" : pick(r, ["clap", "brick", "plaster"]); var ucl = court ? "ashlar" : border ? "adobe" : lodge ? "stucco" : grand ? "brick" : (gcl === "brick" ? "brick" : pick(r, ["clap", "clap", "batten"]));
    function colFor(cl) { return cl === "adobe" ? hex(pick(r, PAL.earth)) : cl === "plaster" || cl === "stucco" ? hex(pick(r, PAL.plaster)) : (cl === "clap" || cl === "batten") ? hex(pick(r, PAL.paint)) : shade(WHITE, 0.9 + 0.12 * r()); }
    var gL = LY[gcl], uL = LY[ucl], gC = colFor(gcl), uC = ucl === gcl ? gC : colFor(ucl), pf = function (cl) { return (cl === "clap" || cl === "batten" || cl === "plaster" || cl === "adobe" || cl === "stucco") ? 1 : 0; }, gF = pf(gcl), uF = pf(ucl);
    K.trim = court ? hex("#efe2c4") : lodge ? hex("#3a3330") : hex(pick(r, PAL.trim)); K.doorC = hex(pick(r, ["#5a3a24", "#6b4528", "#3e2a1c"])); K.roomC = hex(pick(r, ["#8a6a4a", "#7a5f48", "#6e5a4a"]), 0.6);
    var W = U1 - U0, bays = [-9.0, -6.0, -3.0, 0, 3.0, 6.0, 9.0], dr = S.door;
    // ground floor: entrance doors and six windows
    var gh = [[dr[0] - U0, dr[1] - U0, S.h, 3.6, 0.2, 1]]; bays.forEach(function (b) { if (Math.abs(b) < 1.5) return; gh.push([b - 0.7 - U0, b + 0.7 - U0, 1.0, 3.7]); });
    A.wall([U0, 0, WF], [1, 0, 0], W, y0, FL[1], gh, gL, gF, gC, { rev: 0.2, RL: LY.trim, RF: 1, rc: K.trim });
    gh.slice(1).forEach(function (h) { windowAt(K, [U0, 0, WF], [1, 0, 0], h[0], h[1], h[2], h[3], { cols: 2, rows: 3, rail: true, depth: 1.8, pediment: !lodge, inset: 0.18, panel: null, shelves: false }); });
    doorAt(K, [U0, 0, WF], [1, 0, 0], dr[0] - U0, dr[1] - U0, S.h, 3.6, { glazed: true, transom: true, leaves: 2, inset: 0.2 });
    // upper floors: seven windows each, iron balconies on the middle bays of the second floor
    for (var f = 1; f < 3; f++) { var holes = []; bays.forEach(function (b) { holes.push([b - 0.65 - U0, b + 0.65 - U0, FL[f] + 0.9, FL[f] + 3.2]); });
      A.wall([U0, 0, WF], [1, 0, 0], W, FL[f], FL[f + 1], holes, uL, uF, uC, { rev: 0.18, RL: LY.trim, RF: 1, rc: K.trim });
      holes.forEach(function (h) { windowAt(K, [U0, 0, WF], [1, 0, 0], h[0], h[1], h[2], h[3], { cols: 2, rows: 2, rail: true, depth: 1.6, pediment: !lodge && f === 1, inset: 0.16, panel: null, shelves: false, dark: r() < 0.35 }); });
      A.box(U0 - 0.05, FL[f] - 0.12, WF, U1 + 0.05, FL[f] + 0.06, WF + 0.12, LY.trim, 1, K.trim); }
    if (!lodge) [-3.0, 0, 3.0].forEach(function (b) { var bx0 = b - 1.0, bx1 = b + 1.0, by = FL[1] + 0.85; A.box(bx0, by - 0.12, WF, bx1, by, WF + 0.7, LY.ashlar, 0, shade(WHITE, 0.9)); railing(A, bx0, WF + 0.68, bx1, WF + 0.68, by, 0.95, hex("#2a2a28"), 0.12); railing(A, bx0, WF + 0.02, bx0, WF + 0.68, by, 0.95, hex("#2a2a28"), 0.12); railing(A, bx1, WF + 0.02, bx1, WF + 0.68, by, 0.95, hex("#2a2a28"), 0.12);
      for (var k2 = 0; k2 < 2; k2++) A.obox([b + (k2 ? 0.7 : -0.7), by - 0.35, WF + 0.25], [0, 0.7071, 0.7071], [1, 0, 0], 0.32, 0.04, 0.04, LY.metal, 1, hex("#2a2a28")); });
    // parapet with a cornice, the name sign over the entrance
    A.wall([U0, 0, WF], [1, 0, 0], W, FL[3], PT, [], uL, uF, uC, { rev: 0 }); cornice(A, U0, U1, PT, WF, K.trim, { dentils: !lodge, brackets: !lodge, bstep: 0.9 });
    var sty = court ? "stone" : lodge ? "modern" : grand ? "gold" : border ? "cream" : "wood"; signAt(K, [U0, 0, WF], [1, 0, 0], W / 2 - 4.2, W / 2 + 4.2, FL[3] + 0.05, FL[3] + 0.85, nm, sty, null, 0.05);
    // the verandas front and back
    var vst = { postC: lodge ? hex("#3a3330") : K.trim, roofL: border ? LY.rooftile : LY.seam, roofC: border ? shade(WHITE, 0.95) : hex(pick(r, ["#5d6a5a", "#6e3a2c", "#4a4f55"])), round: grand || court, rail: !lodge };
    verandaFront(K, S, WF, U0, U1, vst);
    // sides: four bays a floor; back: the back veranda (its own facade frame on the back) with windows above
    var len = WF - VB; [[U0, -1], [U1, 1]].forEach(function (sd) { var u = sd[0], o = sd[1] < 0 ? [u, 0, VB] : [u, 0, WF], t = sd[1] < 0 ? [0, 0, 1] : [0, 0, -1];
      for (var f2 = 0; f2 < 3; f2++) { var hs = []; for (var i = 0; i < 4; i++) { var sc = 2.6 + i * (len - 5.2) / 3; hs.push([sc - 0.6, sc + 0.6, FL[f2] + (f2 ? 0.9 : 1.0), FL[f2] + (f2 ? 3.2 : 3.6)]); }
        A.wall(o, t, len, f2 ? FL[f2] : y0, f2 === 2 ? PT : FL[f2 + 1], hs, f2 ? uL : gL, f2 ? uF : gF, shade(f2 ? uC : gC, 0.96), { rev: 0.16, RL: LY.trim, RF: 1, rc: K.trim });
        hs.forEach(function (h) { windowAt(K, o, t, h[0], h[1], h[2], h[3], { cols: 2, rows: 2, rail: true, depth: 1.4, panel: null, shelves: false, dark: r() < 0.45 }); }); } });
    // back facade (v = VB, facing -v): doors and windows on every floor
    for (var f3 = 0; f3 < 3; f3++) { var hb = []; bays.forEach(function (b) { if (f3 === 0 && Math.abs(b) < 1.5) { hb.push([b - 1.2 - U0, b + 1.2 - U0, 0.43, 3.4, 0.16, 1]); return; } if (f3 === 0 && Math.abs(b) > 8) return; hb.push([b - 0.65 - U0, b + 0.65 - U0, FL[f3] + 0.9, FL[f3] + (f3 ? 3.2 : 3.4)]); });
      // the back wall's tangent runs -u, so the local s of a bay at u = b is U1 - b
      hb = hb.map(function (h) { return [W - h[1], W - h[0], h[2], h[3], h[4], h[5]]; });
      A.wall([U1, 0, VB], [-1, 0, 0], W, f3 ? FL[f3] : y0, f3 === 2 ? PT : FL[f3 + 1], hb, f3 ? uL : gL, f3 ? uF : gF, shade(f3 ? uC : gC, 0.94), { rev: 0.16, RL: LY.trim, RF: 1, rc: K.trim });
      hb.forEach(function (h) { if (h[5]) doorAt(K, [U1, 0, VB], [-1, 0, 0], h[0], h[1], h[2], h[3], { glazed: true, leaves: 2, inset: 0.16 }); else windowAt(K, [U1, 0, VB], [-1, 0, 0], h[0], h[1], h[2], h[3], { cols: 2, rows: 2, rail: true, depth: 1.4, panel: null, shelves: false, dark: r() < 0.5 }); }); }
    if (SB) backVeranda(K, SB, vst);
    A.wall([U1, 0, VB], [-1, 0, 0], W, FL[3], PT, [], uL, uF, shade(uC, 0.94), { rev: 0 });
    // roof: a flat roof with a terrace pergola over the middle
    A.box(U0, FL[3] - 0.1, VB, U1, FL[3] + 0.05, WF, LY.concrete, 0, shade(WHITE, 0.55), { no: "b" }); A.box(U0 - 0.05, PT, VB - 0.05, U1 + 0.05, PT + 0.08, WF + 0.05, LY.trim, 1, K.trim, { no: "b" });
    if (!court) { var pz0 = VB + 5, pz1 = WF - 5, px0 = -6, px1 = 6; [[px0, pz0], [px1, pz0], [px0, pz1], [px1, pz1]].forEach(function (q) { A.box(q[0] - 0.12, FL[3] + 0.05, q[1] - 0.12, q[0] + 0.12, FL[3] + 2.9, q[1] + 0.12, LY.wood, 0, shade(WHITE, 0.7), { rot: true }); });
      for (var px = px0; px <= px1 + 0.01; px += 0.6) A.box(px - 0.05, FL[3] + 2.9, pz0 - 0.3, px + 0.05, FL[3] + 3.1, pz1 + 0.3, LY.wood, 0, shade(WHITE, 0.72)); A.box(px0 - 0.3, FL[3] + 2.75, pz0 - 0.12, px1 + 0.3, FL[3] + 2.9, pz0 + 0.12, LY.wood, 0, shade(WHITE, 0.7)); A.box(px0 - 0.3, FL[3] + 2.75, pz1 - 0.12, px1 + 0.3, FL[3] + 2.9, pz1 + 0.12, LY.wood, 0, shade(WHITE, 0.7)); }
    A.box(U0 - 0.08, y0, VB - 0.08, U1 + 0.08, 0.2, WF, LY.ashlar, 0, shade(WHITE, 0.8), { no: "bs" });
    var Fz = K.f; Fz.box(U0, 0, VB, U1, FL[1], WF, gL, gF, gC, { no: "b" }); Fz.box(U0, FL[1], VB, U1, PT, WF, uL, uF, uC, { no: "b" }); Fz.box(S.deck[0], S.ceil, WF, S.deck[1], S.ceil + 0.4, S.deck[3], LY.seam, 1, vst.roofC, {});
    for (var f4 = 1; f4 < 3; f4++) bays.forEach(function (b) { Fz.box(b - 0.65, FL[f4] + 0.9, WF, b + 0.65, FL[f4] + 3.2, WF + 0.02, LY.metal, 2, hex("#ffcf8a", 0.12)); });
  }
  // the back veranda: built in the back side's own measured frame (as a front veranda), then turned 180 degrees into the front frame
  function backVeranda(K, SB, vst) { var M = new Acc(4096); var K2 = { a: M, r: K.r, trim: K.trim }; verandaFront(K2, SB, SB.wall, 0, 0, vst); K.a.addRot180(M); }

  // ───────────────────────── the bank (masonry, a recessed arched entry on the client's door, a cornice) ─────────────────────────
  function bankBuild(K) {
    var A = K.a, r = K.r, m = K.m, nm = shortName(K.name); K.frame(K.e[3]);
    var U0 = -m.sx / 2 + 0.05, U1 = m.sx / 2 - 0.05, VB = -m.sz / 2 + 0.05, WF = m.sz / 2 - 0.05, y0 = -0.45, W = U1 - U0;
    var doorZ = m.radius * 0.86 - 0.35;   // the client's door point is inside the old box: the entry is a recess back to it
    var G1 = 5.2, G2 = 9.6, PT = 10.6; var land = /land|assay/i.test(nm);
    var gcl = land ? pick(r, ["brick", "plaster"]) : "ashlar", ucl = land ? gcl : pick(r, ["brick", "ashlar", "brick"]);
    var gC = gcl === "plaster" ? hex(pick(r, PAL.plaster)) : shade(WHITE, 0.92 + 0.1 * r()), uC = ucl === gcl ? gC : shade(WHITE, 0.9 + 0.12 * r()); var gF = gcl === "plaster" ? 1 : 0, uF = gF;
    K.trim = hex(land ? pick(r, PAL.trim) : pick(r, ["#e9dcc0", "#d9c7a4", "#efe6d2"])); K.doorC = hex(pick(r, ["#3e2a1c", "#4d2f1f", "#2f3a36"])); K.roomC = hex("#8a7258", 0.6);
    var rec = Math.max(0.6, WF - doorZ), ew = 2.4; // entry recess depth and width
    var gh = [[W / 2 - ew / 2, W / 2 + ew / 2, 0, 4.2, rec, 1], [0.9, 2.3, 1.1, 4.0], [W - 2.3, W - 0.9, 1.1, 4.0]];
    A.wall([U0, 0, WF], [1, 0, 0], W, y0, G1, gh, LY[gcl], gF, gC, { rev: 0.25, RL: LY[gcl], RF: gF, rc: shade(gC, 0.9) });
    // the arch over the entry (voussoirs) and the keystone
    for (var i = 0; i < 9; i++) { var a0 = PI * i / 9, a1 = PI * (i + 1) / 9, am = (a0 + a1) / 2, R0 = ew / 2; var cx = Math.cos(am) * (R0 + 0.2), cy = 4.2 - R0 * 0.25 + Math.sin(am) * (R0 * 0.25 + 0.2); A.obox([cx, cy, WF + 0.06], [Math.cos(am + PI / 2), Math.sin(am + PI / 2), 0], [Math.cos(am), Math.sin(am), 0], 0.16, 0.24, 0.08, LY.ashlar, 0, shade(WHITE, i === 4 ? 1.08 : 0.98)); }
    doorAt(K, [U0, 0, WF - rec], [1, 0, 0], W / 2 - ew / 2 + 0.2, W / 2 + ew / 2 - 0.2, 0.15, 3.3, { glazed: true, transom: true, leaves: 2, inset: 0.05, lc: K.doorC, tc: shade(gC, 0.9) });
    A.box(U0 + W / 2 - ew / 2, 0, WF - rec, U0 + W / 2 + ew / 2, 0.15, WF, LY.ashlar, 0, shade(WHITE, 0.85), { no: "b" });
    // steps up to the entry
    for (var s = 0; s < 2; s++) A.box(U0 + W / 2 - ew / 2 - 0.3, -0.1, WF + s * 0.0, U0 + W / 2 + ew / 2 + 0.3, 0.15 - s * 0.075, WF + 0.35 + s * 0.35, LY.ashlar, 0, shade(WHITE, 0.82), { no: "b" });
    [gh[1], gh[2]].forEach(function (h) { windowAt(K, [U0, 0, WF], [1, 0, 0], h[0], h[1], h[2], h[3], { cols: 2, rows: 3, rail: true, depth: 2.0, pediment: true, inset: 0.24, tc: hex("#2f3a36"), panel: land ? 12 : null, shelves: false }); });
    // pilasters
    [0.45, W - 0.45, W / 2 - ew / 2 - 0.55, W / 2 + ew / 2 + 0.55].forEach(function (pu) { A.box(U0 + pu - 0.28, y0, WF, U0 + pu + 0.28, G2, WF + 0.14, LY.ashlar, 0, shade(WHITE, 0.96)); A.box(U0 + pu - 0.36, G1 - 0.3, WF, U0 + pu + 0.36, G1, WF + 0.2, LY.ashlar, 0, shade(WHITE, 1.02)); });
    A.box(U0 - 0.06, G1 - 0.18, WF, U1 + 0.06, G1 + 0.05, WF + 0.16, LY.ashlar, 0, shade(WHITE, 1.02));
    // upper floor: four windows
    var uh = []; for (var k = 0; k < 4; k++) { var sc = 1.5 + k * (W - 3.0) / 3; uh.push([sc - 0.6, sc + 0.6, G1 + 0.9, G1 + 3.2]); }
    A.wall([U0, 0, WF], [1, 0, 0], W, G1, PT, uh, LY[ucl], uF, uC, { rev: 0.2, RL: LY.ashlar, RF: 0, rc: shade(WHITE, 0.9) });
    uh.forEach(function (h) { windowAt(K, [U0, 0, WF], [1, 0, 0], h[0], h[1], h[2], h[3], { cols: 2, rows: 2, rail: true, depth: 1.5, pediment: true, inset: 0.2, tc: hex("#2f3a36"), panel: null, shelves: false, dark: r() < 0.4 }); });
    cornice(A, U0, U1, PT, WF, K.trim, { dentils: true, brackets: true, bstep: 0.55, proj: 0.4 });
    // the name carved over the entry; a pediment block above the cornice in the middle
    signAt(K, [U0, 0, WF], [1, 0, 0], W / 2 - 3.2, W / 2 + 3.2, G2 - 0.2, G2 + 0.5, nm, "stone", null, 0.04);
    A.box(U0 + W / 2 - 2.4, PT + 0.06, WF - 0.2, U0 + W / 2 + 2.4, PT + 0.9, WF + 0.05, LY.ashlar, 0, shade(WHITE, 0.98)); A.box(U0 + W / 2 - 2.55, PT + 0.9, WF - 0.25, U0 + W / 2 + 2.55, PT + 1.02, WF + 0.12, LY.trim, 1, K.trim);
    // sides and back
    var len = WF - VB; [[U0, -1], [U1, 1]].forEach(function (sd) { var u = sd[0], o = sd[1] < 0 ? [u, 0, VB] : [u, 0, WF], t = sd[1] < 0 ? [0, 0, 1] : [0, 0, -1];
      var h1 = [], h2 = []; for (var i2 = 0; i2 < 4; i2++) { var c2 = 2.2 + i2 * (len - 4.4) / 3; h1.push([c2 - 0.55, c2 + 0.55, 1.4, 3.8]); h2.push([c2 - 0.55, c2 + 0.55, G1 + 0.9, G1 + 3.2]); }
      A.wall(o, t, len, y0, G1, h1, LY[gcl], gF, shade(gC, 0.96), { rev: 0.2 }); A.wall(o, t, len, G1, PT, h2, LY[ucl], uF, shade(uC, 0.96), { rev: 0.2 });
      h1.concat(h2).forEach(function (h) { windowAt(K, o, t, h[0], h[1], h[2], h[3], { cols: 2, rows: 2, depth: 1.3, tc: hex("#2f3a36"), panel: null, shelves: false, dark: r() < 0.5 }); });
      var cu0 = sd[1] < 0 ? u - 0.4 : u, cu1 = sd[1] < 0 ? u : u + 0.4; A.box(cu0, PT - 0.3, VB, cu1, PT + 0.06, WF, LY.trim, 1, K.trim); });
    A.wall([U1, 0, VB], [-1, 0, 0], W, y0, PT, [[W / 2 - 0.6, W / 2 + 0.6, 0, 2.3, 0.12, 1]], LY[ucl], uF, shade(uC, 0.94), { rev: 0.12 }); doorAt(K, [U1, 0, VB], [-1, 0, 0], W / 2 - 0.6, W / 2 + 0.6, 0, 2.3, { leaves: 1, inset: 0.1, lc: hex("#3a3f44") });
    A.box(U0, PT - 0.12, VB, U1, PT, WF, LY.concrete, 0, shade(WHITE, 0.55), { no: "b" });
    A.box(U0 - 0.1, y0, VB - 0.1, U1 + 0.1, 0.3, WF + 0.02, LY.ashlar, 0, shade(WHITE, 0.78), { no: "bs" });
    var Fz = K.f; Fz.box(U0, 0, VB, U1, G1, WF, LY[gcl], gF, gC, { no: "b" }); Fz.box(U0, G1, VB, U1, PT + 0.3, WF, LY[ucl], uF, uC, { no: "b" });
  }

  // ───────────────────────── the chapel (a desert mission chapel: whitewashed adobe, a curved bell gable, clay tile roof) ─────────────────────────
  function chapelBuild(K) {
    var A = K.a, r = K.r, m = K.m; K.frame(K.e[3]); var U0 = -m.sx / 2 + 0.4, U1 = m.sx / 2 - 0.4, VB = -m.sz / 2 + 0.1, WF = m.sz / 2 - 0.05, y0 = -0.45, W = U1 - U0;
    var EH = 6.0, RH = 9.0, doorZ = m.radius * 0.86 - 0.3, rec = Math.max(0.6, WF - doorZ), lime = hex("#f3efe6"), dado = hex("#c9a37c"); K.trim = hex("#5a3a24"); K.doorC = hex("#4a2e1c"); K.roomC = hex("#8a6a4a", 0.6);
    // the facade: an arched door recess, the choir window, and the curved bell gable above the roof
    var fh = [[W / 2 - 1.15, W / 2 + 1.15, 0, 3.3, rec, 1], [W / 2 - 0.45, W / 2 + 0.45, 4.6, 5.5, 0.5]];
    A.wall([U0, 0, WF], [1, 0, 0], W, y0, EH, fh, LY.plaster, 1, lime, { rev: 0.3, RL: LY.plaster, RF: 1, rc: shade(lime, 0.92) });
    windowAt(K, [U0, 0, WF], [1, 0, 0], fh[1][0], fh[1][1], fh[1][2], fh[1][3], { cols: 1, rows: 1, noCasing: true, noSill: true, inset: 0.45, depth: 1.2, panel: null, shelves: false, tc: K.trim });
    // the arch over the door: a half round of plaster voussoirs; the door leaves (planked, studded) at the back of the recess
    for (var i = 0; i < 10; i++) { var a0 = PI * i / 10, a1 = PI * (i + 1) / 10, am = (a0 + a1) / 2; A.obox([Math.cos(am) * 1.3, 3.3 + Math.sin(am) * 0.55, WF + 0.05], [Math.cos(am + PI / 2), Math.sin(am + PI / 2), 0], [Math.cos(am), Math.sin(am), 0], 0.22, 0.17, 0.07, LY.plaster, 1, shade(lime, 0.95)); }
    doorAt(K, [U0, 0, WF - rec], [1, 0, 0], W / 2 - 0.95, W / 2 + 0.95, 0.12, 3.15, { leaves: 2, inset: 0.05, lc: K.doorC, tc: K.trim });
    A.box(U0 + W / 2 - 1.15, -0.1, WF - rec, U0 + W / 2 + 1.15, 0.12, WF + 0.5, LY.ashlar, 0, shade(WHITE, 0.85), { no: "b" });
    var M2 = W / 2, pts = [[0, EH], [W, EH], [W, EH + 0.55], [W - 1.1, EH + 0.55], [W - 1.1, EH + 1.15]];
    for (var k = 1; k <= 8; k++) { var a = PI * 0.5 * k / 8; pts.push([(W - 1.1) - (W - 1.1 - M2 - 1.5) * Math.sin(a), EH + 1.15 + (RH + 0.3 - EH - 1.15) * (1 - Math.cos(a))]); }
    pts.push([M2 + 1.5, RH + 2.3], [M2 + 1.75, RH + 2.3], [M2 + 1.75, RH + 2.55]); for (var k3 = 0; k3 <= 10; k3++) { var a3 = PI * k3 / 10; pts.push([M2 + Math.cos(a3) * 1.45, RH + 2.55 + Math.sin(a3) * 0.95]); }
    pts.push([M2 - 1.75, RH + 2.55], [M2 - 1.75, RH + 2.3], [M2 - 1.5, RH + 2.3]); for (var k2 = 8; k2 >= 1; k2--) { var a2 = PI * 0.5 * k2 / 8; pts.push([1.1 + (M2 - 1.5 - 1.1) * Math.sin(a2), EH + 1.15 + (RH + 0.3 - EH - 1.15) * (1 - Math.cos(a2))]); }
    pts.push([1.1, EH + 1.15], [1.1, EH + 0.55], [0, EH + 0.55]);
    pts = pts.filter(function (p, i2, a) { if (i2 === 0) return true; var q = a[i2 - 1]; return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 0.02; });
    var bell = [[M2 - 0.55, RH + 0.9], [M2 - 0.55, RH + 1.9]]; for (var kb = 9; kb >= 1; kb--) { var ab = PI * kb / 10; bell.push([M2 + Math.cos(ab) * 0.55, RH + 1.9 + Math.sin(ab) * 0.55]); } bell.push([M2 + 0.55, RH + 1.9], [M2 + 0.55, RH + 0.9]);
    A.ext([U0, 0, WF], [1, 0, 0], pts, 0.5, LY.plaster, 1, lime, { EL: LY.plaster, holes: [bell] });
    // the bell on its yoke inside the opening, the cross on the crown
    A.cyl(U0 + M2, RH + 1.15, WF - 0.25, 0.27, 0.55, 12, LY.metal, 1, hex("#9c7a3e"), true); A.cyl(U0 + M2, RH + 1.7, WF - 0.25, 0.16, 0.12, 10, LY.metal, 1, hex("#8a6a32"), true);
    A.box(U0 + M2 - 0.6, RH + 1.86, WF - 0.34, U0 + M2 + 0.6, RH + 1.96, WF - 0.16, LY.wood, 0, shade(WHITE, 0.55));
    A.box(U0 + M2 - 0.05, RH + 3.45, WF - 0.3, U0 + M2 + 0.05, RH + 4.35, WF - 0.2, LY.trim, 1, K.trim); A.box(U0 + M2 - 0.3, RH + 3.98, WF - 0.3, U0 + M2 + 0.3, RH + 4.08, WF - 0.2, LY.trim, 1, K.trim);
    // a moulded band at the eaves line and a framed portal round the door (pilasters, an entablature)
    A.box(U0 - 0.05, EH - 0.12, WF, U1 + 0.05, EH + 0.05, WF + 0.12, LY.plaster, 1, shade(lime, 0.93));
    [-1, 1].forEach(function (sx) { A.box(U0 + M2 + sx * 1.62 - 0.17, 0, WF, U0 + M2 + sx * 1.62 + 0.17, 4.1, WF + 0.13, LY.plaster, 1, shade(lime, 0.96)); A.box(U0 + M2 + sx * 1.62 - 0.22, 0, WF, U0 + M2 + sx * 1.62 + 0.22, 0.45, WF + 0.17, LY.plaster, 1, shade(lime, 0.9)); });
    A.box(U0 + M2 - 1.95, 4.1, WF, U0 + M2 + 1.95, 4.38, WF + 0.2, LY.plaster, 1, shade(lime, 0.94)); A.box(U0 + M2 - 2.05, 4.38, WF, U0 + M2 + 2.05, 4.46, WF + 0.26, LY.plaster, 1, shade(lime, 0.97));
    // dado: a worn earth band at the foot of every wall
    A.box(U0 - 0.03, y0, WF, U1 + 0.03, 0.55, WF + 0.03, LY.adobe, 1, dado, { no: "b" });
    // the nave walls with three deep windows a side, buttresses
    var len = WF - VB; [[U0, -1], [U1, 1]].forEach(function (sd) { var u = sd[0], o = sd[1] < 0 ? [u, 0, VB] : [u, 0, WF], t = sd[1] < 0 ? [0, 0, 1] : [0, 0, -1];
      var hs = [[3.0, 3.8, 3.0, 4.6, 0.45], [7.0, 7.8, 3.0, 4.6, 0.45], [11.0, 11.8, 3.0, 4.6, 0.45]]; A.wall(o, t, len, y0, EH, hs, LY.plaster, 1, shade(lime, 0.97), { rev: 0.45 });
      hs.forEach(function (h) { windowAt(K, o, t, h[0], h[1], h[2], h[3], { cols: 1, rows: 2, noCasing: true, noSill: true, inset: 0.45, depth: 1.0, panel: null, shelves: false, tc: K.trim }); });
      [1.6, 5.5, 9.5, 13.4].forEach(function (bs) { var pz = o[2] + t[2] * bs, px = u + sd[1] * 0.45; var x0 = sd[1] < 0 ? u - 0.9 : u, x1 = sd[1] < 0 ? u : u + 0.9; A.box(Math.min(x0, x1), y0, pz - 0.4, Math.max(x0, x1), 2.2, pz + 0.4, LY.plaster, 1, shade(lime, 0.95)); var top = [[sd[1] < 0 ? u - 0.9 : u + 0.9, 2.2], [u, 4.0]]; A.obox([(sd[1] < 0 ? u - 0.45 : u + 0.45), 3.1, pz], [0, 0, 1], [sd[1] * 0.447, 0.894, 0], 0.4, 0.06, 1.0, LY.plaster, 1, shade(lime, 0.95)); });
      A.box(sd[1] < 0 ? u - 0.03 : u, y0, VB, sd[1] < 0 ? u : u + 0.03, 0.55, WF, LY.adobe, 1, dado, { no: "b" }); });
    A.wall([U1, 0, VB], [-1, 0, 0], W, y0, EH, [[W / 2 - 0.5, W / 2 + 0.5, 0, 2.2, 0.4, 1]], LY.plaster, 1, shade(lime, 0.95), { rev: 0.4 }); doorAt(K, [U1, 0, VB], [-1, 0, 0], W / 2 - 0.5, W / 2 + 0.5, 0, 2.2, { leaves: 1, inset: 0.35, lc: K.doorC });
    A.ext([U1, 0, VB], [-1, 0, 0], [[0, EH], [W, EH], [W / 2, RH]], 0.4, LY.plaster, 1, shade(lime, 0.95), {});
    // the roof: two clay tile slopes, vigas poking out under the eaves
    var ov = 0.45; [[-1, U0 - ov], [1, U1 + ov]].forEach(function (sd) { var ex = sd[1], ry = EH - 0.15 - (ov / (W / 2)) * (RH - EH); var a = [ex, ry, VB - 0.3], b = [ex, ry, WF - 0.45], c = [U0 + W / 2, RH, WF - 0.45], d = [U0 + W / 2, RH, VB - 0.3];
      if (sd[0] < 0) A.q4(a, b, c, d, nrmOf(a, b, c), LY.rooftile, 0, shade(WHITE, 0.95), 0, true); else A.q4(b, a, d, c, nrmOf(b, a, d), LY.rooftile, 0, shade(WHITE, 0.95), 0, true);
      for (var vz = VB + 0.6; vz < WF - 0.8; vz += 1.1) { var vx = sd[0] < 0 ? U0 - 0.35 : U1 + 0.35; A.box(vx - 0.35, EH - 0.55, vz - 0.09, vx + 0.35, EH - 0.37, vz + 0.09, LY.wood, 0, shade(WHITE, 0.75)); } });
    A.box(U0 + W / 2 - 0.15, RH - 0.05, VB - 0.3, U0 + W / 2 + 0.15, RH + 0.12, WF - 0.45, LY.rooftile, 0, shade(WHITE, 0.85));
    var Fz = K.f; Fz.box(U0, 0, VB, U1, EH, WF, LY.plaster, 1, lime, { no: "b" }); Fz.ext([U0, 0, WF], [1, 0, 0], pts, 0.5, LY.plaster, 1, lime, {}); Fz.ext([U0, 0, WF - 0.5], [1, 0, 0], [[0, EH], [W, EH], [W / 2, RH]], WF - 0.5 - VB, LY.rooftile, 0, shade(WHITE, 0.9), {});
  }

  // ───────────────────────── the diner (a 1950s Route 80 diner: stainless panels, a ribbon of windows, a neon canopy) ─────────────────────────
  function dinerBuild(K) {
    var A = K.a, r = K.r, m = K.m; var fa = 0.0898; try { var C0 = window.PLAN_PORCHES && PLAN_PORCHES.cfg && PLAN_PORCHES.cfg.kinds.diner; if (C0 && typeof C0.fa === "number") fa = C0.fa; } catch (e) {}
    K.frame(K.e[3] + fa); var U0 = -m.sx / 2 + 0.3, U1 = m.sx / 2 - 0.3, VB = -m.sz / 2 + 0.2, WF = m.sz / 2 - 0.25, y0 = -0.45, W = U1 - U0, H1 = 3.4, PT = 4.4;
    var steel = hex("#cfd3d6"), red = hex("#b52a2a"), cream = hex("#f1e7cf"), chrome = hex("#e1e5e8"); K.trim = chrome; K.doorC = chrome; K.roomC = hex("#c9b49a", 0.7);
    // ribbon windows along the front with the entrance vestibule in the middle
    var holes = [], ent = [W / 2 - 1.6, W / 2 + 1.6]; for (var s = 0.8; s < W - 0.8; s += 2.25) { var a = s, b = Math.min(W - 0.8, s + 2.05); if (b > ent[0] - 0.2 && a < ent[1] + 0.2) continue; holes.push([a, b, 1.0, 2.85]); }
    holes.push([ent[0], ent[1], 0.0, 2.95, 1.2, 1]);
    A.wall([U0, 0, WF], [1, 0, 0], W, y0, H1, holes, LY.metal, 1, steel, { rev: 0.12, RL: LY.metal, RF: 1, rc: chrome });
    holes.forEach(function (h) { if (h[5]) return; windowAt(K, [U0, 0, WF], [1, 0, 0], h[0], h[1], h[2], h[3], { cols: 1, rows: 1, fw: 0.05, noCasing: true, noSill: true, inset: 0.08, tc: chrome, depth: 2.6, panel: 6, lit: 0.95 }); });
    // enamel bands above and below the windows, a terrazzo bulkhead, chrome rub rails
    A.box(U0 - 0.02, 0, WF, U1 + 0.02, 0.98, WF + 0.05, LY.terrazzo, 0, shade(WHITE, 0.9)); A.box(U0 - 0.02, 0.92, WF + 0.05, U1 + 0.02, 1.0, WF + 0.08, LY.metal, 1, chrome);
    A.box(U0 - 0.02, 2.9, WF, U1 + 0.02, 3.15, WF + 0.06, LY.trim, 1, red); A.box(U0 - 0.02, 3.15, WF + 0.02, U1 + 0.02, 3.2, WF + 0.08, LY.metal, 1, chrome);
    // the entrance: a glass block vestibule pushed forward, double doors, a curved canopy over it
    var e0 = U0 + ent[0], e1 = U0 + ent[1]; A.box(e0 - 0.3, 0, WF, e0, 3.0, WF + 1.2, LY.gblock, 0, WHITE, {}); A.box(e1, 0, WF, e1 + 0.3, 3.0, WF + 1.2, LY.gblock, 0, WHITE, {});
    A.box(e0 - 0.3, 0, WF, e1 + 0.3, 0.02, WF + 1.2, LY.terrazzo, 0, shade(WHITE, 0.95), { no: "b" });
    doorAt(K, [U0, 0, WF - 0.05], [1, 0, 0], ent[0] + 0.3, ent[1] - 0.3, 0.02, 2.5, { glazed: true, leaves: 2, transom: true, tc: chrome, lc: chrome, inset: 0.0 });
    // the canopy: a deep flat roof edge all along the front with the name in neon on its fascia
    A.box(U0 - 0.4, H1, WF - 0.2, U1 + 0.4, H1 + 0.7, WF + 1.4, LY.metal, 1, cream); A.box(U0 - 0.42, H1 + 0.08, WF + 1.4, U1 + 0.42, H1 + 0.2, WF + 1.45, LY.trim, 1, red); A.box(U0 - 0.42, H1 + 0.55, WF + 1.4, U1 + 0.42, H1 + 0.62, WF + 1.45, LY.metal, 1, chrome);
    for (var x = U0 + 1; x < U1 - 0.5; x += 3.0) A.box(x - 0.15, H1 - 0.012, WF + 0.5, x + 0.15, H1, WF + 0.8, LY.metal, 3, hex("#ffe6b8"));
    signAt(K, [U0, 0, WF + 1.45], [1, 0, 0], W / 2 - 5.2, W / 2 + 5.2, H1 + 0.9, H1 + 2.0, "Flight Line Diner", "neon", null, 0.05);
    // a roof blade sign
    A.box(U0 + W / 2 - 0.1, H1 + 0.7, WF - 0.5, U0 + W / 2 + 0.1, PT + 1.6, WF + 0.3, LY.metal, 1, red);
    // sides and back: steel with porthole windows, kitchen door at the back
    var len = WF - VB; [[U0, -1], [U1, 1]].forEach(function (sd) { var u = sd[0], o = sd[1] < 0 ? [u, 0, VB] : [u, 0, WF], t = sd[1] < 0 ? [0, 0, 1] : [0, 0, -1];
      var hs = [[len - 4.6, len - 1.2, 1.0, 2.85]]; A.wall(o, t, len, y0, PT, hs, LY.metal, 1, shade(steel, 0.97), { rev: 0.1 }); hs.forEach(function (h) { windowAt(K, o, t, h[0], h[1], h[2], h[3], { cols: 2, rows: 1, fw: 0.05, noCasing: true, noSill: true, inset: 0.08, tc: chrome, depth: 2.0, panel: 7 }); });
      A.box(sd[1] < 0 ? u - 0.06 : u, 2.9, VB, sd[1] < 0 ? u : u + 0.06, 3.15, WF, LY.trim, 1, red); });
    A.wall([U1, 0, VB], [-1, 0, 0], W, y0, PT, [[3, 4.2, 0, 2.3, 0.1, 1]], LY.metal, 1, shade(steel, 0.92), { rev: 0.1 }); doorAt(K, [U1, 0, VB], [-1, 0, 0], 3, 4.2, 0, 2.3, { leaves: 1, inset: 0.08, lc: hex("#8a8f94"), tc: chrome });
    A.wall([U0, 0, WF], [1, 0, 0], W, H1, PT, [], LY.metal, 1, cream, { rev: 0 });
    A.box(U0, PT - 0.1, VB, U1, PT, WF, LY.concrete, 0, shade(WHITE, 0.6), { no: "b" }); A.box(U0 - 0.05, PT, VB - 0.05, U1 + 0.05, PT + 0.12, WF, LY.metal, 1, chrome, { no: "b" });
    [[-6, -2], [5, 1]].forEach(function (q) { A.box(q[0] - 0.9, PT, q[1] - 0.9, q[0] + 0.9, PT + 1.1, q[1] + 0.9, LY.metal, 1, hex("#b8bcbf")); });
    var Fz = K.f; Fz.box(U0, 0, VB, U1, PT, WF, LY.metal, 1, steel, { no: "b" }); Fz.box(U0 - 0.4, H1, WF - 0.2, U1 + 0.4, H1 + 0.7, WF + 1.4, LY.metal, 1, cream, {}); Fz.box(U0 + 0.8, 1.0, WF, U1 - 0.8, 2.85, WF + 0.02, LY.metal, 2, hex("#ffcf8a", 0.12));
  }

  // ───────────────────────── the gallery (desert modern: board-formed concrete, a weathering steel volume, a tall glass hall) ─────────────────────────
  function galleryBuild(K) {
    var A = K.a, r = K.r, m = K.m; K.frame(K.e[3]); var U0 = -m.sx / 2 + 0.3, U1 = m.sx / 2 - 0.3, VB = -m.sz / 2 + 0.3, WF = m.sz / 2 - 0.2, y0 = -0.45, W = U1 - U0;
    var H1 = 6.6, H2 = 10.8, concrete = hex(pick(r, ["#d8c6a8", "#cdb796", "#e0d2b8"])), corten = hex(pick(r, ["#9a4a26", "#8a4222", "#a65530"])), steel = hex("#2b2d2e"); K.trim = steel; K.doorC = steel; K.roomC = hex("#efe9df", 0.8);
    var hall = [W / 2 - 4.5, W / 2 + 4.5], welcome = /welcome/i.test(K.name);
    // the front: the concrete mass left, the corten volume right, the tall glass hall between them, set back 1.5 m
    var hz = WF - 1.5;
    A.wall([U0, 0, WF], [1, 0, 0], hall[0], y0, H1, [[1.2, hall[0] - 1.2, 1.2, 4.6, 0.25]], LY.concrete, 0, concrete, { rev: 0.25 });
    windowAt(K, [U0, 0, WF], [1, 0, 0], 1.2, hall[0] - 1.2, 1.2, 4.6, { cols: 3, rows: 1, fw: 0.06, noCasing: true, noSill: true, inset: 0.25, tc: steel, depth: 2.4, panel: null, shelves: false });
    A.wall([U0 + hall[1], 0, WF], [1, 0, 0], W - hall[1], y0, H1, [], LY.corr, 0, corten, { rev: 0 });
    // the glass hall: a steel grid of tall lights, the doors in the middle
    var gx0 = U0 + hall[0], gx1 = U0 + hall[1]; A.box(gx0, H2 - 0.5, hz, gx1, H2, hz + 1.6, LY.metal, 1, corten);
    for (var gx = gx0; gx <= gx1 + 0.01; gx += 1.5) A.box(gx - 0.06, 0, hz - 0.06, gx + 0.06, H2 - 0.5, hz + 0.06, LY.metal, 1, steel);
    [3.4, 6.8].forEach(function (yy) { A.box(gx0, yy - 0.05, hz - 0.06, gx1, yy + 0.05, hz + 0.06, LY.metal, 1, steel); });
    K.g.pane([gx0, 0, hz], [1, 0, 0], 0, 3.0, 0, H2 - 0.5, 0.9); K.g.pane([gx0, 0, hz], [1, 0, 0], 6.0, 9.0, 0, H2 - 0.5, 0.9); K.g.pane([gx0, 0, hz], [1, 0, 0], 3.0, 6.0, 3.4, H2 - 0.5, 0.9);
    doorAt(K, [gx0, 0, hz], [1, 0, 0], 3.1, 5.9, 0.02, 3.3, { glazed: true, leaves: 2, tc: steel, lc: steel, inset: 0.0 });
    // the hall interior: a white back wall with art, lit at night
    A.q4([gx0, 0.01, hz - 6], [gx1, 0.01, hz - 6], [gx1, H2 - 0.6, hz - 6], [gx0, H2 - 0.6, hz - 6], [0, 0, 1], LY.plaster, 3, hex("#f4f1ea", 0.85), 0, false); A.q4([gx0, 0.02, hz], [gx1, 0.02, hz], [gx1, 0.02, hz - 6], [gx0, 0.02, hz - 6], [0, 1, 0], LY.terrazzo, 0, shade(WHITE, 0.8), 0, false);
    A.box(gx0, H2 - 0.6, hz - 6, gx1, H2 - 0.5, hz, LY.plaster, 3, hex("#f4f1ea", 0.7), { no: "t" });
    // side returns of the hall set-back, the deep roof overhangs with corten fascias
    A.wall([gx0, 0, hz], [0, 0, 1], WF - hz, y0, H1, [], LY.concrete, 0, shade(concrete, 0.95), { rev: 0 }); A.wall([gx1, 0, WF], [0, 0, -1], WF - hz, y0, H1, [], LY.corr, 0, shade(corten, 0.95), { rev: 0 });
    A.box(U0 - 1.0, H1, VB + 2, U0 + hall[0] + 0.2, H1 + 0.45, WF + 1.4, LY.metal, 1, corten); A.box(U0 + hall[1] - 0.2, H1, VB + 2, U1 + 1.0, H1 + 0.45, WF + 1.4, LY.metal, 1, corten);
    A.q4([U0 - 1.0, H1 - 0.01, WF + 1.4], [U0 + hall[0] + 0.2, H1 - 0.01, WF + 1.4], [U0 + hall[0] + 0.2, H1 - 0.01, VB + 2], [U0 - 1.0, H1 - 0.01, VB + 2], [0, -1, 0], LY.wood, 0, shade(WHITE, 0.75), 0, false);
    A.q4([U0 + hall[1] - 0.2, H1 - 0.01, WF + 1.4], [U1 + 1.0, H1 - 0.01, WF + 1.4], [U1 + 1.0, H1 - 0.01, VB + 2], [U0 + hall[1] - 0.2, H1 - 0.01, VB + 2], [0, -1, 0], LY.wood, 0, shade(WHITE, 0.75), 0, false);
    // the name in steel letters on the concrete
    signAt(K, [U0, 0, WF], [1, 0, 0], 1.0, hall[0] - 1.0, 5.0, 5.9, welcome ? "Welcome House" : shortName(K.name).replace(/Design District /i, ""), "modern", welcome ? "Genesis One" : "Design District", 0.04);
    // sides and back
    var len = WF - VB; [[U0, -1], [U1, 1]].forEach(function (sd) { var u = sd[0], o = sd[1] < 0 ? [u, 0, VB] : [u, 0, WF], t = sd[1] < 0 ? [0, 0, 1] : [0, 0, -1]; var L0 = sd[1] < 0 ? LY.concrete : LY.corr, c0 = sd[1] < 0 ? concrete : corten;
      var hs = [[len * 0.3, len * 0.3 + 5.0, 1.0, 2.6, 0.2], [len * 0.62, len * 0.62 + 5.0, 1.0, 2.6, 0.2]]; A.wall(o, t, len, y0, H1, hs, L0, 0, shade(c0, 0.96), { rev: 0.2, RL: LY.metal, RF: 1, rc: steel });
      hs.forEach(function (h) { windowAt(K, o, t, h[0], h[1], h[2], h[3], { cols: 3, rows: 1, fw: 0.05, noCasing: true, noSill: true, inset: 0.2, tc: steel, depth: 2.0, panel: null, shelves: false }); }); });
    A.wall([U1, 0, VB], [-1, 0, 0], W, y0, H1, [[W / 2 - 1.5, W / 2 + 1.5, 0, 3.0, 0.15, 1]], LY.concrete, 0, shade(concrete, 0.93), { rev: 0.15 }); doorAt(K, [U1, 0, VB], [-1, 0, 0], W / 2 - 1.5, W / 2 + 1.5, 0, 3.0, { leaves: 2, inset: 0.12, lc: hex("#3a3a3a"), tc: steel });
    // the hall's tall volume behind the glass (concrete), its roof, the main roof
    A.box(gx0, H1, VB + 3, gx1, H2 - 0.5, hz - 6, LY.concrete, 0, shade(concrete, 0.97), { no: "b" });
    A.box(U0, H1 - 0.1, VB, U1, H1, WF, LY.concrete, 0, shade(WHITE, 0.55), { no: "b" });
    var Fz = K.f; Fz.box(U0, 0, VB, U1, H1, WF, LY.concrete, 0, concrete, { no: "b" }); Fz.box(gx0, H1, VB + 3, gx1, H2, hz, LY.concrete, 0, concrete, { no: "b" }); Fz.box(gx0, 0, hz, gx1, H2 - 0.5, hz + 0.02, LY.metal, 2, hex("#ffcf8a", 0.12));
  }

  // the window interiors: which stock panel a shop shows (layer, quadrant), by its name
  // atlas panels: 0 jars, 1 fabric, 2 shirts, 3 jackets, 4 hats, 5 boots, 6 pastry, 7 mugs, 8 bottles, 9 taps, 10 souvenirs, 11 jewelry, 12 books, 13 tools, 14 apothecary, 15 plants
  var PANELS = [[/candy|toy|gift|patch|star chart|newsstand|souvenir|record|club store|pilot shop/i, [10, 7]], [/soda|ice cream|fountain/i, [9, 6]], [/coffee|cafe|bakery|deli|diner|noodle|taco|concession|snack|grill|food|kitchen|mess/i, [6, 7]],
    [/tavern|saloon|cider|kettle|spur|lily|longhorn|tumbleweed|lucky|windmill|corral/i, [8, 9]], [/outfit|tailor|apparel|giveback/i, [2, 3]], [/hat|milliner/i, [4]], [/boot|leather|saddl|harness/i, [5]],
    [/mercantile|general store|dry goods|trading|market|feed|seed/i, [0, 1]], [/book|map|print|post office|telegraph|land|office|claims|surveyor|stage|concierge|travel|luggage|box office|bank|assay/i, [12]],
    [/turquoise|jewel/i, [11]], [/hardware|parts|prop|supply|avionic|mining|cycle|bike|maker|farrier|smith|gun|rental/i, [13]], [/apothec|pharmac|tobacc|optic|barber|dentist|undertaker/i, [14]], [/botanical|nursery|florist|garden|beekeep/i, [15]]];
  function shopPanel(name, r) { for (var i = 0; i < PANELS.length; i++) if (PANELS[i][0].test(name || "")) { var L = PANELS[i][1]; return L[Math.floor(r() * L.length) % L.length]; } return [0, 1, 10, 12, 7][Math.floor(r() * 5) % 5]; }
  XT.shopPanel = shopPanel;

  XT.kit = { Acc: Acc, GAcc: GAcc, hex: hex, shade: shade, pick: pick, rng: rng, hash: hash, LY: LY, PAL: PAL, WHITE: WHITE, windowAt: windowAt, doorAt: doorAt, gooseneck: gooseneck, railing: railing, cornice: cornice, signAt: signAt, shortName: shortName, nrmOf: nrmOf, S2: S2, note: note };
  var BUILDERS = XT.builders = { store: storeBuild, storefront_sl: sfBuild, saloon: saloonBuild, hotel: hotelBuild, bank: bankBuild, chapel: chapelBuild, diner: dinerBuild, gallery: galleryBuild };

  // ───────────────────────── world: hide the old instances; defer: build the chunks ─────────────────────────
  function kindsOn() { var ks = Object.keys(BUILDERS); return ONLY ? ks.filter(function (k) { return ONLY.indexOf(k) >= 0; }) : ks; }
  function worldHook() { try { mats(); loadKtx(); } catch (e) { note("tex start", e); } var ks = kindsOn(); XT.kinds = ks.slice(); var n = 0; ks.forEach(function (k) { var L = PLACE[k]; if (!L || !MODELS[k]) return; for (var i = 0; i < L.length; i++) { SHELLS.add(k + ":" + i); n++; } }); XT.n.shelled = n; }
  function nameOf(kind, e) { try { for (var i = 0; i < PLAN_BLD.length; i++) if (PLAN_BLD[i].e === e) return PLAN_BLD[i]; } catch (x) {} return null; }
  function build() {
    var t0 = performance.now(); mats(); onTexReady(); var ks = kindsOn(); var nb = 0; SIGN.cv = null; SIGN.n = 0;
    ks.forEach(function (k) { var L = PLACE[k], m = MODELS[k]; if (!L || !m) return; for (var i = 0; i < L.length; i++) { var e = L[i]; try { var pb = nameOf(k, e); var id = pb ? pb.id : k + i; var B = inv(e, m);
          var C = chunkOf(e[0], e[2]); var K = { kind: k, i: i, e: e, m: m, id: id, name: pb && pb.b ? pb.b.name || "" : "", dist: pb && pb.b ? pb.b.district || "" : "", r: rng(hash(id + ":xt")), a: C.main, g: C.glass, f: C.far, c: C.card, s: C.sign, Y: e[3], trim: WHITE, roomC: shade(WHITE, 0.4, 0.6), C: C, xb: [] };
          var bufs = [C.main, C.glass, C.far, C.card, C.sign], n0 = bufs.map(function (b) { return b.n; });
          K.frame = function (Y) { K.Y = Y; var tf = { c: Math.cos(Y), s: Math.sin(Y), sc: B.sc, ox: B.x, oy: B.y, oz: B.z }; K.tf = tf; bufs.forEach(function (b) { b.tf = tf; }); K.xb.forEach(function (b) { b.tf = tf; }); }; K.frame(e[3]);
          K.panel = /gallery|museum|photo|tintype|studio|welcome/i.test(K.name) ? null : shopPanel(K.name, K.r);
          try { BUILDERS[k](K); } catch (er0) { bufs.forEach(function (b, q) { b.n = n0[q]; b.tf = null; }); if (K.onFail) try { K.onFail(); } catch (x) {} throw er0; }
          bufs.forEach(function (b) { b.tf = null; }); K.xb.forEach(function (b) { b.tf = null; });
          var rg = bufs.map(function (b, q) { return [n0[q], b.n - n0[q]]; }); var rec = { kind: k, i: i, e: e, id: id, B: B, C: C, rm: rg[0], rg: rg[1], rf: rg[2], rc: rg[3], rs: rg[4], noCollapse: !!K.noCollapse, sub: K.sub || null }; if (K.onRec) K.onRec(rec); C.bl.push(rec); BLD.push(rec); nb++; } catch (er) { note("build " + k + " " + i, er); SHELLS.delete(k + ":" + i); } } });
    GROUP = new THREE.Group(); GROUP.name = "xt town exteriors"; GROUP.userData.noCull = true;
    if (SIGN.cv) { var st0 = new THREE.CanvasTexture(SIGN.cv); st0.colorSpace = THREE.SRGBColorSpace; st0.anisotropy = 8; st0.userData.avShared = true; st0.name = "xt_signs"; SIGN.tex = st0;
      MAT.sign = new THREE.MeshStandardMaterial({ map: st0, emissive: 0xfff0d8, emissiveMap: st0, emissiveIntensity: 0.05, roughness: 0.62, metalness: 0 }); MAT.sign.name = "xt_sign"; MAT.sign.userData.avShared = true; }
    CHUNKS.forEach(function (C) { if (C.main.n) { var mm = new THREE.Mesh(geoMain(C.main), MAT.main); mm.castShadow = true; mm.receiveShadow = true; mm.name = "xt " + C.k; mm.userData.noSolid = true; mm.matrixAutoUpdate = false; GROUP.add(mm); C.meshes.main = mm; }
      if (C.glass.n) { var gm = new THREE.Mesh(geoGlass(C.glass), MAT.glass); gm.castShadow = false; gm.receiveShadow = false; gm.renderOrder = 2; gm.name = "xt glass " + C.k; gm.userData.noSolid = true; gm.matrixAutoUpdate = false; GROUP.add(gm); C.meshes.glass = gm; }
      if (C.far.n) { var fm = new THREE.Mesh(geoMain(C.far), MAT.main); fm.castShadow = true; fm.receiveShadow = true; fm.name = "xt far " + C.k; fm.userData.noSolid = true; fm.matrixAutoUpdate = false; fm.visible = false; GROUP.add(fm); C.meshes.far = fm; }
      if (C.card.n) { var cg = geoGlass(C.card); cg.deleteAttribute("color"); var km = new THREE.Mesh(cg, MAT.card); km.castShadow = false; km.receiveShadow = true; km.name = "xt cards " + C.k; km.userData.noSolid = true; km.matrixAutoUpdate = false; GROUP.add(km); C.meshes.card = km; }
      if (C.sign.n && MAT.sign) { var sg = geoGlass(C.sign); sg.deleteAttribute("color"); var sm = new THREE.Mesh(sg, MAT.sign); sm.castShadow = false; sm.receiveShadow = true; sm.name = "xt signs " + C.k; sm.userData.noSolid = true; sm.matrixAutoUpdate = false; GROUP.add(sm); C.meshes.sign = sm; }
      if (XT.onChunk) { try { XT.onChunk(C, GROUP); } catch (ec) { note("chunk hook", ec); } }
      C.main = C.glass = C.far = C.card = C.sign = null; });
    scene.add(GROUP); XT.group = GROUP; XT.n.buildings = nb; XT.n.chunks = CHUNKS.length; XT.n.buildMs = Math.round(performance.now() - t0);
    var tri = 0; GROUP.traverse(function (o) { if (o.isMesh) tri += o.geometry.attributes.position.count / 3; }); XT.n.tris = Math.round(tri);
    lastF = -99; frame();
  }
  // ───────────────────────── frame: near / far per chunk, the room the player is in ─────────────────────────
  var lastF = -99, lastX = 1e9, lastZ = 1e9, hidRec = null;
  function hideRec(rec, on) { // collapse (on) or restore a building's vertices in its chunk meshes
    [["main", "rm"], ["glass", "rg"], ["far", "rf"], ["card", "rc"], ["sign", "rs"]].forEach(function (q) { var me = rec.C.meshes[q[0]], rg = rec[q[1]]; if (!me || !rg || !rg[1]) return; var at = me.geometry.attributes.position, a = at.array, s = rg[0] * 3, n = rg[1] * 3;
      if (on) { rec.save = rec.save || {}; rec.save[q[0]] = a.slice(s, s + n); for (var i = 0; i < n; i += 3) { a[s + i] = rec.B.x; a[s + i + 1] = rec.B.y; a[s + i + 2] = rec.B.z; } }
      else if (rec.save && rec.save[q[0]]) { a.set(rec.save[q[0]], s); delete rec.save[q[0]]; }
      if (at.addUpdateRange) at.addUpdateRange(s, n); at.needsUpdate = true; }); }   // R16: ranges accumulate (several buildings can change in one frame)
  function frame() {
    if (!GROUP) return; try {
      var k = 0; try { k = typeof night === "number" ? night : 0; } catch (e) {} if (U) U.uGlow.value = 0.05 + 2.2 * k; if (MAT && MAT.card) MAT.card.emissiveIntensity = 0.08 + 0.85 * k; if (MAT && MAT.sign) MAT.sign.emissiveIntensity = 0.04 + 0.45 * k;
      var ins = null; try { ins = inside || null; } catch (e) {} var want = null; if (ins && ins.door) { for (var i = 0; i < BLD.length; i++) if (BLD[i].e === ins.door.e && !BLD[i].noCollapse) { want = BLD[i]; break; } }
      if (want !== hidRec) { if (hidRec) hideRec(hidRec, false); if (want) hideRec(want, true); hidRec = want; }
      var cx = camera.position.x, cz = camera.position.z; if (FRAME_N - lastF < 12 && Math.hypot(cx - lastX, cz - lastZ) < 8) return; lastF = FRAME_N; lastX = cx; lastZ = cz;
      var q = QUAL && QUAL.q ? Math.max(0.6, QUAL.q.range || 1) : 1, RN = (LOW ? 150 : 230) * q, RF = 2200 * q;
      CHUNKS.forEach(function (C) { var dx = Math.max(C.x0 - cx, 0, cx - (C.x0 + CH)), dz = Math.max(C.z0 - cz, 0, cz - (C.z0 + CH)); var d = Math.sqrt(dx * dx + dz * dz); var v = d < RN ? 2 : d < RF ? 1 : 0; if (v === C.vis) return; C.vis = v;
        if (C.meshes.main) C.meshes.main.visible = v === 2; if (C.meshes.glass) C.meshes.glass.visible = v === 2; if (C.meshes.card) C.meshes.card.visible = v === 2; if (C.meshes.sign) C.meshes.sign.visible = v === 2; if (C.meshes.far) C.meshes.far.visible = v === 1; if (C.x) for (var xi = 0; xi < C.x.length; xi++) C.x[xi].visible = v === 2; });
    } catch (e) { note("frame", e); } }
  XT.stats = function () { return { n: XT.n, errs: XT.errs.slice(), chunks: CHUNKS.map(function (C) { return [C.k, C.vis, C.bl.length]; }), tex: !!IMG.done }; };
  XT.rebuild = function () { try { if (hidRec) { hideRec(hidRec, false); hidRec = null; } if (GROUP) { scene.remove(GROUP); GROUP.traverse(function (o) { if (o.isMesh) o.geometry.dispose(); }); GROUP = null; } CHUNKS.length = 0; BLD.length = 0; build(); return XT.n; } catch (e) { note("rebuild", e); return String(e); } };
  XT.hideRec = hideRec;
  // A/B in one session: off shows the old models again (SHELLS entries removed, the group hidden); on restores this module
  XT.ab = function (on) { try { if (!GROUP) return "no group"; BLD.forEach(function (rec) { var key = rec.kind + ":" + rec.i; if (on) SHELLS.add(key); else SHELLS.delete(key); }); GROUP.visible = !!on; XT.abOn = !!on; try { updateCulling(true); } catch (e) {} return on ? "on" : "off"; } catch (e) { return String(e); } };

  if (!XT.hooked) { XT.hooked = true; var H = window.PLAN_HOOKS;
    H.world.push({ name: "extTownWorld", fn: function () { try { (XT.impl || {}).world ? XT.impl.world() : worldHook(); } catch (e) { note("world", e); } } });
    H.defer.push({ name: "extTownBuild", fn: function () { try { (XT.impl || {}).build ? XT.impl.build() : build(); } catch (e) { note("defer", e); } } });
    H.frame.push({ name: "extTownFrame", fn: function () { (XT.impl || {}).frame ? XT.impl.frame() : frame(); } }); }
  XT.impl = { world: worldHook, build: build, frame: frame };
})();
