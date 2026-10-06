// R16 (Agent T, terrain and ground): PBR desert ground, dirt roads and path materials. Classic script, loaded before client.js.
// See genesis_data/masterplan/HANDOFF_R16_TERRAIN.md.
//  - The ground (GROUND_MATS[0], also the Genesis Park patches): eight PBR layers in two texture arrays (tex/tr_alb.ktx2: sRGB albedo +
//    height, 2048 px; tex/tr_nrm.ktx2: normal x/z, roughness, AO, 1024 px): packed caliche, loose sand, wash gravel, cracked desert
//    pavement, dry grass litter, rock outcrop, decomposed granite, wheel-track tread. Height-blended with slope, noise and aerial-photo
//    masks, a second rotated sample of the base layer against tiling, a micro-detail normal near the camera (ultra), triplanar rock on
//    slopes, procedural hummock relief to 700 m; the aerial macro map (ground.jpg) stays the far colour and a weak near tint.
//  - Dirt roads and trails (the client's EDGE_MATS): packed caliche continuous with the ground, two wheel lanes with tire tread, a loose
//    gravel crown and berms, rut depressions in the normal; the client's dark overlay ruts are hidden. M.dirt (path shoulders) follows.
//  - Paths: decomposed granite (PM.dg, red PM.redg, chip seal PM.chip) from the DG layer in world space; travertine (PM.stone) a tumbled
//    ashlar set on the promenades' 4.5 m repeat (tex/tr_trav*.ktx2, 2048 px) with a pore micro-normal near the camera.
// Tiers: ultra and high the full set (ultra adds the micro normal and 16x anisotropy), medium the albedo array only at 1024 px
// (the client's own normal map stays), low unchanged. ?trn=0 gives the ground and the roads back to plan_gfx.js; ?trnroads=0,
// ?trnpaths=0 for the parts; ?trnktx=0 forces the _m JPEG arrays; PLAN_TERRAIN.set(false) toggles at runtime (A/B in one session).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var QS = location.search;
  var OFF = /[?&]trn=0\b/.test(QS), ROADS_OFF = OFF || /[?&]trnroads=0\b/.test(QS), PATHS_OFF = OFF || /[?&]trnpaths=0\b/.test(QS), NO_KTX = /[?&]trnktx=0\b/.test(QS);
  var FORCE_T = (QS.match(/[?&]trntier=(\d)/) || [])[1];
  var OLD = window.PLAN_TERRAIN && window.PLAN_TERRAIN.installed ? window.PLAN_TERRAIN : null;
  var TR = window.PLAN_TERRAIN = { v: "r16-1", errs: [], n: { mats: 0, roads: 0, paths: 0 }, on: !OFF, installed: false, tier: -1 };
  function note(w, e) { var s = w + ": " + ((e && (e.message || e)) || "?"); if (TR.errs.length < 40) TR.errs.push(s); try { console.warn("PLAN_TERRAIN " + s); } catch (x) {} }
  function au(u) { try { if (window.AV) return window.AV(u); } catch (e) {} return u; }

  // ── tiers: 0 off (low, and medium on the phone tier), 1 medium subset, 2 high, 3 ultra ──
  function tierOf() {
    if (FORCE_T !== undefined) return +FORCE_T;
    var L = "high", mob = false; try { L = QUAL.level; } catch (e) {} try { mob = ASSET.tier === "m"; } catch (e) {}
    if (L === "low") return 0; if (mob) return L === "medium" ? 0 : 1; return L === "medium" ? 1 : L === "ultra" ? 3 : 2;
  }

  // ── the layers: [name, tile metres, rotation, normal strength, height bias, albedo gain, roughness offset] ──
  var LAY = [["caliche", 2.6, 0.61, 1.0, 0.0, 1.0, 0.0], ["sand", 3.2, -1.13, 0.5, -0.16, 1.0, 0.0], ["gravel", 1.7, 2.27, 1.15, 0.08, 1.0, 0.0], ["pavement", 2.2, 0.97, 1.0, 0.0, 1.0, 0.0],
    ["grass", 2.4, -0.42, 0.9, 0.04, 1.0, 0.0], ["rock", 3.4, 1.71, 1.2, 0.12, 1.0, 0.0], ["dg", 1.3, 0.0, 0.9, 0.0, 1.0, 0.0], ["tread", 1.5, 0.0, 1.0, 0.0, 1.0, 0.0]];
  var NL = 8;
  // ── shared uniforms (every patched program points at these objects) ──
  var U = TR.U = {
    tTrA: { value: null }, tTrB: { value: null },
    uTrnQ: { value: null },   // x tier, y layer fade distance (m), z normal strength, w debug mode
    uTrnS: { value: [] },     // per layer: xy (cos, sin) / tile, z normal strength, w height bias
    uTrnC: { value: [] },     // per layer: rgb albedo gain, a roughness offset
    uTrnM: { value: null },   // xyz the aerial map's mean colour (linear), w near aerial tint
    uTrnE: { value: null },   // x textures ready (0/1), y global albedo gain, z relief strength, w micro normal strength
    uTrnRd: { value: null },  // roads: x spare, y fade distance, z rut depth (m), w wheel-lane strength
    uTrnRG: { value: null },  // roads: rgb gain of the 35 per cent desaturated dirt photo to the road's mean colour
    uTrnRC: { value: null },  // roads (per material): rgb gain of the caliche layer to the same mean, a caliche share
    uTrnRF: { value: null },  // roads (per material): rgb the caliche share's mean colour (the far road)
    uTrnP: { value: null }    // paths: rgb tint (set per material), a fade distance
  };
  function v4(x, y, z, w) { return new THREE.Vector4(x, y, z, w); }
  function initUniforms() {
    if (U.uTrnQ.value) return;
    U.uTrnQ.value = v4(0, 160, 1.0, 0); U.uTrnM.value = v4(0.38, 0.29, 0.17, 0.22); U.uTrnE.value = v4(0, 1.0, 1.0, 0.55);
    U.uTrnRd.value = v4(1, 110, 0.03, 0.75); U.uTrnP.value = v4(1, 1, 1, 90);
    // the road's mean colour: 60 per cent toward the R15 dirt (linear 0.219/0.132/0.077) from the R16 caliche road (0.370/0.268/0.165),
    // linear 0.280/0.186/0.112 (sRGB 144/120/94); the dirt photo desaturated 20 per cent, then this gain
    U.uTrnRG.value = v4(1.29, 1.3, 1.16, 0); U.uTrnRC.value = v4(0.634, 0.535, 0.462, 0.15); U.uTrnRF.value = v4(0.28, 0.186, 0.112, 0);
    U.uTrnS.value = LAY.map(function (L) { return v4(Math.cos(L[2]) / L[1], Math.sin(L[2]) / L[1], L[3], L[4]); });
    U.uTrnC.value = LAY.map(function (L) { return v4(L[5], L[5], L[5], L[6]); });
    U.tTrA.value = placeholder(true); U.tTrB.value = placeholder(false);
  }
  function placeholder(srgb) {
    var d = new Uint8Array(4 * NL); for (var i = 0; i < NL; i++) { if (srgb) { d[i * 4] = 182; d[i * 4 + 1] = 160; d[i * 4 + 2] = 132; d[i * 4 + 3] = 128; } else { d[i * 4] = 128; d[i * 4 + 1] = 128; d[i * 4 + 2] = 240; d[i * 4 + 3] = 255; } }
    var t = new THREE.DataArrayTexture(d, 1, 1, NL); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; t.name = "trn_placeholder"; return t;
  }

  // ── textures: KTX2 arrays on the desktop tiers, the _m JPEG strips (512 px) on the phone tier or when KTX2 fails ──
  var TX = window.__TRN_TX = window.__TRN_TX || { a: null, b: null, state: "", t0: 0, ms: 0, src: "" };
  function aniso(t) { var mx = 4; try { mx = renderer.capabilities.getMaxAnisotropy(); } catch (e) {} return Math.min(mx, t >= 3 ? 16 : t >= 2 ? 8 : 4); }
  function setTex(a, b, src) {
    var t = TR.tier;
    [a, b].forEach(function (x) { if (!x) return; x.wrapS = x.wrapT = THREE.RepeatWrapping; x.magFilter = THREE.LinearFilter; x.minFilter = THREE.LinearMipmapLinearFilter; x.anisotropy = aniso(t); x.userData.avShared = true; x.needsUpdate = true; });
    if (a) { a.name = "tr_alb"; TX.a = a; U.tTrA.value = a; } if (b) { b.name = "tr_nrm"; TX.b = b; U.tTrB.value = b; }
    var ready = !!TX.a && (t < 2 || !!TX.b); if (ready && U.uTrnE.value) { U.uTrnE.value.x = 1; TX.state = "ready"; TX.ms = Math.round(performance.now() - TX.t0); TX.src = src; TR.n.texMs = TX.ms; TR.n.texSrc = src; }
  }
  function dropTop(t) {   // medium: the 2048 px albedo array is uploaded from its second level (1024 px)
    try { if (!t.mipmaps || t.mipmaps.length < 2) return t; t.mipmaps = t.mipmaps.slice(1); t.image = { width: t.mipmaps[0].width, height: t.mipmaps[0].height, depth: t.image.depth }; } catch (e) { note("drop mip", e); } return t;
  }
  function loadKtx(t) {
    var k = null; try { k = typeof ktx2Loader === "function" ? ktx2Loader() : null; } catch (e) { k = null; }
    if (!k || NO_KTX) return false;
    var need = t >= 2 ? 2 : 1, got = {}, failed = false, tries = {};
    function one(nm, file) {
      tries[nm] = (tries[nm] || 0) + 1;
      k.load(au("/tex/" + file + "?v=" + (window.BUILD || "dev") + (tries[nm] > 1 ? "&r=" + tries[nm] : "")), function (tex) {
        if (failed) return; if (nm === "a" && t < 2) dropTop(tex); got[nm] = tex;
        if (Object.keys(got).length === need) setTex(got.a, got.b || null, "ktx2");
      }, undefined, function (e) { if (failed) return; if (tries[nm] < 2) { setTimeout(function () { one(nm, file); }, 2500); return; } failed = true; note("ktx2 " + file, e); loadJpg(t); });
    }
    one("a", "tr_alb.ktx2"); if (t >= 2) one("b", "tr_nrm.ktx2"); return true;
  }
  // the _m strips: tr_alb_m.jpg (albedo), tr_aux_m.jpg (R height, G roughness, B AO), tr_nrm_m.jpg (R normal x, G normal z); 8 layers of 512 px stacked vertically
  function loadJpg(t) {
    if (TX.jpg) return; TX.jpg = true; var S = 512, names = ["tr_alb_m.jpg", "tr_aux_m.jpg"].concat(t >= 2 ? ["tr_nrm_m.jpg"] : []), img = {}, n = 0;
    names.forEach(function (nm) { var im = new Image(); im.decoding = "async"; im.onload = function () { img[nm] = im; if (++n === names.length) setTimeout(build, 0); }; im.onerror = function () { note("jpg " + nm, "load failed"); }; im.src = au("/tex/" + nm + "?v=" + (window.BUILD || "dev")); });
    function px(im) { var c = document.createElement("canvas"); c.width = S; c.height = S * NL; var x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0, S, S * NL); return x.getImageData(0, 0, S, S * NL).data; }
    function build() {
      try {
        var al = px(img["tr_alb_m.jpg"]), ax = px(img["tr_aux_m.jpg"]), nr = t >= 2 ? px(img["tr_nrm_m.jpg"]) : null, N = S * S * NL;
        var A = new Uint8Array(N * 4), B = nr ? new Uint8Array(N * 4) : null;
        for (var i = 0; i < N; i++) { var j = i * 4; A[j] = al[j]; A[j + 1] = al[j + 1]; A[j + 2] = al[j + 2]; A[j + 3] = ax[j]; if (B) { B[j] = nr[j]; B[j + 1] = nr[j + 1]; B[j + 2] = ax[j + 1]; B[j + 3] = ax[j + 2]; } }
        var ta = new THREE.DataArrayTexture(A, S, S, NL); ta.colorSpace = THREE.SRGBColorSpace; ta.generateMipmaps = true;
        var tb = B ? new THREE.DataArrayTexture(B, S, S, NL) : null; if (tb) tb.generateMipmaps = true;
        setTex(ta, tb, "jpg_m");
      } catch (e) { note("jpg build", e); }
    }
  }
  function loadTextures(t) {
    if (t < 1 || TX.state) return; TX.state = "loading"; TX.t0 = performance.now();
    var mob = false; try { mob = ASSET.tier === "m"; } catch (e) {}
    if (mob || !loadKtx(t)) loadJpg(t);
  }

  // ═════════════════ GLSL ═════════════════
  var COMMON = [
    "uniform highp sampler2DArray tTrA; uniform highp sampler2DArray tTrB;",
    "uniform vec4 uTrnQ; uniform vec4 uTrnS[8]; uniform vec4 uTrnC[8]; uniform vec4 uTrnM; uniform vec4 uTrnE;",
    "vec2 trnUV(vec2 p, vec4 s) { return vec2(s.x * p.x - s.y * p.y, s.y * p.x + s.x * p.y); }",
    "vec2 trnRot(vec2 n, vec4 s) { vec2 c = s.xy * inversesqrt(dot(s.xy, s.xy)); return vec2(c.x * n.x + c.y * n.y, -c.y * n.x + c.x * n.y); }",
    "vec4 trnTA(vec2 p, int i, vec2 dx, vec2 dy) { vec4 s = uTrnS[i]; return textureGrad(tTrA, vec3(trnUV(p, s), float(i)), trnUV(dx, s), trnUV(dy, s)); }",
    "vec4 trnTB(vec2 p, int i, vec2 dx, vec2 dy) { vec4 s = uTrnS[i]; return textureGrad(tTrB, vec3(trnUV(p, s), float(i)), trnUV(dx, s), trnUV(dy, s)); }",
    "vec3 trnHeat(float rho) { float l = log2(max(rho, 1e-6)); return l < -2.0 ? vec3(1.0, 0.0, 0.0) : l < -1.0 ? mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 0.85, 0.0), l + 2.0) : l < -0.35 ? mix(vec3(1.0, 0.85, 0.0), vec3(0.0, 0.85, 0.15), (l + 1.0) / 0.65) : l < 1.5 ? mix(vec3(0.0, 0.85, 0.15), vec3(0.0, 0.45, 1.0), clamp((l + 0.35) / 1.85, 0.0, 1.0)) : vec3(0.0, 0.25, 1.0); }",
    "float trnRho(vec2 dx, vec2 dy, float px) { return max(length(dx * px), length(dy * px)); }",
    "float trnHash(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }"
  ].join("\n");

  // the ground: called in the client's map_fragment block after its plaza loop (plz, pavd known); writes the near albedo into col
  var GROUND = [
    "vec2 trnNw = vec2(0.0); float trnRgh = 0.96; float trnAO = 1.0; vec3 trnDbg = vec3(0.0); float trnFade = 0.0;",
    "void trnGround(inout vec3 col, float dist, float plz, float pavd, vec2 muv) {",
    "  vec3 macro = col; vec2 p = vWP.xz; vec3 dwx = dFdx(vWP), dwy = dFdy(vWP); vec2 dpx = dwx.xz, dpy = dwy.xz; vec3 wn = normalize(vWN); float slope = 1.0 - clamp(wn.y, 0.0, 1.0);",
    "  float fade = (1.0 - smoothstep(uTrnQ.y * 0.5, uTrnQ.y, dist)) * uTrnE.x; trnFade = fade;",
    "  vec3 mrel = clamp(macro / uTrnM.xyz, vec3(0.55), vec3(1.6)); float mlum = dot(mrel, vec3(0.3, 0.5, 0.2));",
    "  float veg = clamp((1.0 - mlum) * 2.4 + (mrel.g - mrel.r) * 1.2, 0.0, 1.0);",
    // broad drift (both near and far) and the hummock relief of the creosote flats (coppice mounds, a few metres across), to 700 m
    "  float mv = cnoise(p * 0.0061 + 2.7) * 0.6 + cnoise(p * 0.019 + 8.1) * 0.4; vec3 drift = vec3(0.94 + 0.12 * mv, 0.95 + 0.1 * mv, 0.965 + 0.07 * mv);",
    "  { float rf = (1.0 - smoothstep(300.0, 700.0, dist)) * uTrnE.z * uTrnE.x; if (rf > 0.0) { vec2 q = p * 0.19; float h0 = cnoise(q), hx = cnoise(q + vec2(0.07, 0.0)), hz = cnoise(q + vec2(0.0, 0.07)); vec2 q2 = p * 0.047 + 3.1; float g0 = cnoise(q2), gx = cnoise(q2 + vec2(0.05, 0.0)), gz = cnoise(q2 + vec2(0.0, 0.05));",
    "    trnNw = -(vec2(hx - h0, hz - h0) / 0.07 * 0.19 * 0.16 + vec2(gx - g0, gz - g0) / 0.05 * 0.047 * 0.5) * rf; } }",
    "  vec2 mdx = dFdx(muv), mdy = dFdy(muv); if (uTrnQ.w > 0.5) trnDbg = uTrnQ.w > 2.5 && smoothstep(700.0, 40.0, dist) > 0.5 ? trnHeat(trnRho(mdx * 480.0, mdy * 480.0, 2048.0)) : trnHeat(trnRho(mdx, mdy, 2048.0));",
    "  if (fade <= 0.001) { col = macro * drift; return; }",
    "  float n1 = cnoise(p * 0.031 + 1.7), n2 = cnoise(p * 0.083 + 5.3), n3 = cnoise(p * 0.23 + 9.1), n4 = cnoise(p * 0.0105 + 3.3);",
    "  float w[7]; w[0] = 0.55;",
    "  w[1] = smoothstep(0.52, 0.8, n1 * 0.55 + n3 * 0.2 + (mlum - 1.0) * 0.35 + 0.22) * (1.0 - smoothstep(0.05, 0.14, slope));",
    "  w[2] = max(smoothstep(0.62, 0.86, n2 * 0.65 + n4 * 0.35), smoothstep(0.07, 0.22, slope) * 0.85);",
    "  w[3] = smoothstep(0.6, 0.82, n4 * 0.6 + n2 * 0.3 + n3 * 0.1) * (1.0 - smoothstep(0.02, 0.06, slope));",
    "  w[4] = smoothstep(0.62, 0.88, veg * 0.45 + n2 * 0.3 + n1 * 0.2 + n3 * 0.15) * (1.0 - smoothstep(0.1, 0.3, slope));",
    "  w[5] = max(smoothstep(0.26, 0.45, slope), smoothstep(0.88, 0.97, n4 * 0.5 + n1 * 0.5) * 0.8);",
    "  w[6] = plz * 1.25; if (plz > 0.0) { for (int i = 1; i < 6; i++) w[i] *= 1.0 - plz; w[0] *= 1.0 - plz * 0.6; }",
    "  vec4 A[7]; float a[7]; float am = 0.0;",
    "  for (int i = 0; i < 7; i++) { A[i] = vec4(0.0); a[i] = -1.0; if (w[i] <= 0.01) continue; A[i] = trnTA(p, i, dpx, dpy); a[i] = w[i] + A[i].a * 0.5 + uTrnS[i].w; am = max(am, a[i]); }",
    // against tiling: the base layer again, rotated a quarter turn and scaled, mixed in by a 7 m noise (high and ultra, within 90 m)
    "  float tA = 0.0; vec4 sB = vec4(-uTrnS[0].y, uTrnS[0].x, 0.0, 0.0) * 0.61; vec2 o0 = vec2(0.37, 0.71);",
    "  if (uTrnQ.x > 1.5 && dist < 90.0 && w[0] > 0.01) { tA = smoothstep(0.36, 0.64, cnoise(p * 0.14 + 4.4)) * (1.0 - smoothstep(60.0, 90.0, dist));",
    "    if (tA > 0.01) { vec4 Ab = textureGrad(tTrA, vec3(trnUV(p, sB) + o0, 0.0), trnUV(dpx, sB), trnUV(dpy, sB)); A[0] = mix(A[0], Ab, tA); a[0] = w[0] + A[0].a * 0.5; am = max(am, a[0]); } }",
    "  float b[7]; float bs = 0.0; for (int i = 0; i < 7; i++) { b[i] = max(a[i] - am + 0.24, 0.0); bs += b[i]; } for (int i = 0; i < 7; i++) b[i] /= max(bs, 1e-4);",
    "  vec3 lay = vec3(0.0); float hgt = 0.0; for (int i = 0; i < 7; i++) { if (b[i] <= 0.0) continue; lay += A[i].rgb * uTrnC[i].rgb * b[i]; hgt += A[i].a * b[i]; }",
    // paved plazas: 0.6 m pavers in running bond, aggregate from the DG layer, per-paver tint, sand joints, bevelled edges
    "  float pk = plz > 0.0 ? clamp(pavd / max(plz, 1e-3), 0.0, 1.0) * plz : 0.0; vec2 pvN = vec2(0.0); float pvR = 0.0;",
    "  if (pk > 0.01) { vec2 q = p / 0.6; q.x += 0.5 * mod(floor(q.y), 2.0); vec2 cl = floor(q), f = fract(q); float ex = min(f.x, 1.0 - f.x), ez = min(f.y, 1.0 - f.y); float e = min(ex, ez);",
    "    float jt = 1.0 - smoothstep(0.006, 0.02, e); float hs = trnHash(cl); vec3 pv = vec3(0.52, 0.49, 0.45) * (0.88 + 0.22 * hs) * (0.8 + 0.4 * A[6].rgb / vec3(0.4, 0.31, 0.21));",
    "    lay = mix(lay, mix(pv, vec3(0.33, 0.29, 0.23), jt), pk); pvN = vec2((f.x < 0.5 ? -1.0 : 1.0) * (1.0 - smoothstep(0.0, 0.035, ex)), (f.y < 0.5 ? -1.0 : 1.0) * (1.0 - smoothstep(0.0, 0.035, ez))) * 0.45 * pk; pvR = mix(-0.12, 0.02, jt) * pk; }",
    "  lay *= mix(vec3(1.0), mrel, uTrnM.w) * uTrnE.y;",
    "  col = mix(macro, lay, fade) * drift;",
    "  if (uTrnQ.x > 1.5) {",
    "    vec2 nn = vec2(0.0); float rg = 0.0, ao = 0.0, ws = 0.0;",
    "    for (int i = 0; i < 7; i++) { if (b[i] <= 0.03) continue; vec4 B = trnTB(p, i, dpx, dpy); vec2 ni = trnRot(B.rg * 2.0 - 1.0, uTrnS[i]);",
    "      if (i == 0 && tA > 0.01) { vec4 Bb = textureGrad(tTrB, vec3(trnUV(p, sB) + o0, 0.0), trnUV(dpx, sB), trnUV(dpy, sB)); ni = mix(ni, trnRot(Bb.rg * 2.0 - 1.0, sB), tA); B.ba = mix(B.ba, Bb.ba, tA); }",
    "      nn += ni * uTrnS[i].z * b[i]; rg += (B.b + uTrnC[i].a) * b[i]; ao += B.a * b[i]; ws += b[i]; }",
    "    rg /= max(ws, 1e-3); ao /= max(ws, 1e-3);",
    // triplanar rock on slopes: the side projections replace the stretched top projection for albedo and normal
    "    if (b[5] > 0.05 && slope > 0.2) { vec3 tw = pow(abs(wn), vec3(4.0)); tw /= (tw.x + tw.y + tw.z); vec4 s5 = uTrnS[5]; float sc = length(s5.xy); vec3 rc = vec3(0.0); vec2 rn = vec2(0.0);",
    "      if (tw.x > 0.05) { vec2 u = vec2(vWP.z, vWP.y) * sc, ux = vec2(dwx.z, dwx.y) * sc, uy = vec2(dwy.z, dwy.y) * sc; vec4 Ax = textureGrad(tTrA, vec3(u, 5.0), ux, uy); vec4 Bx = textureGrad(tTrB, vec3(u, 5.0), ux, uy); rc += Ax.rgb * tw.x; rn += vec2(0.0, Bx.r * 2.0 - 1.0) * tw.x; }",
    "      if (tw.z > 0.05) { vec2 u = vec2(vWP.x, vWP.y) * sc, ux = vec2(dwx.x, dwx.y) * sc, uy = vec2(dwy.x, dwy.y) * sc; vec4 Az = textureGrad(tTrA, vec3(u, 5.0), ux, uy); vec4 Bz = textureGrad(tTrB, vec3(u, 5.0), ux, uy); rc += Az.rgb * tw.z; rn += vec2(Bz.r * 2.0 - 1.0, 0.0) * tw.z; }",
    "      float side = (tw.x + tw.z) * b[5] * fade; col = mix(col, rc / max(tw.x + tw.z, 1e-3) * uTrnE.y * drift, side); nn = mix(nn, rn * 1.2, side); }",
    // micro detail within 14 m (ultra): the DG layer's grit as a fine normal and cavity
    "    if (uTrnQ.x > 2.5 && dist < 14.0) { float mk = (1.0 - smoothstep(5.0, 14.0, dist)) * uTrnE.w * (1.0 - b[1] * 0.6); vec2 mu = p * 3.1; vec4 Bm = textureGrad(tTrB, vec3(mu, 6.0), dpx * 3.1, dpy * 3.1); nn += (Bm.rg * 2.0 - 1.0) * mk; ao *= mix(1.0, Bm.a, 0.45 * mk); }",
    "    trnNw += (nn + pvN) * fade; trnRgh = mix(0.96, clamp(rg + pvR, 0.4, 1.0), fade); trnAO = mix(1.0, ao, fade);",
    "  } else { trnRgh = mix(0.96, 0.94 + pvR, fade); trnAO = mix(1.0, mix(0.8, 1.0, hgt), fade); trnNw += pvN * fade; }",
    "  col *= mix(1.0, trnAO, 0.55);",
    "  if (uTrnQ.w > 0.5 && uTrnQ.w < 2.5) { int dm = 0; float bm = 0.0; for (int i = 0; i < 7; i++) if (b[i] > bm) { bm = b[i]; dm = i; }",
    "    if (uTrnQ.w < 1.5) { if (fade > 0.25) { vec4 s = uTrnS[dm]; float px = dm == 0 || dm == 1 || dm == 3 || dm == 4 || dm == 5 ? 2048.0 : 2048.0; float r0 = trnRho(trnUV(dpx, s), trnUV(dpy, s), px); trnDbg = trnHeat(uTrnQ.x > 2.5 && dist < 14.0 ? min(r0, trnRho(dpx * 3.1, dpy * 3.1, 1024.0)) : r0); } }",
    "    else trnDbg = b[0] * vec3(0.95, 0.85, 0.6) + b[1] * vec3(1.0, 1.0, 0.2) + b[2] * vec3(0.55) + b[3] * vec3(0.25, 0.12, 0.05) + b[4] * vec3(0.2, 0.8, 0.1) + b[5] * vec3(0.85, 0.2, 0.1) + b[6] * vec3(0.2, 0.45, 1.0); }",
    "}"
  ].join("\n");

  var ANCH = {
    common: "float cloudShade(vec2 wp, float t){",
    close0: "vec3 grd = sRGBTransferOETF(texture2D(groundMap, vMapUv * 480.0)).rgb;",
    close1: "diffuseColor.rgb = mix(diffuseColor.rgb, closeCol * 0.78 * clamp(aerialTint, 0.55, 1.15), near * 0.85);",
    plz0: "if (plz > 0.0) { float gm = sRGBTransferOETF(texture2D(groundMap, vMapUv * 190.0)).g;",
    plz1: "diffuseColor.rgb = mix(diffuseColor.rgb, packed, plz * 0.88); }",
    near0: "{ float near2 = smoothstep(70.0, 6.0, dist) * (1.0 - plz * 0.85);",
    near1: "diffuseColor.rgb *= 1.0 + near2 * ((rip - 0.5) * 0.16 + (grain - 0.5) * 0.14); }",
    rock0: "vec3 rock = sRGBTransferOETF(texture2D(rockMap, vMapUv * 300.0)).rgb;",
    rock1: "diffuseColor.rgb = mix(diffuseColor.rgb, rock, smoothstep(0.12, 0.35, slope) * 0.8);",
    nrm0: "vec3 mN1 = texture2D(normalMap, vMapUv * 1400.0).xyz * 2.0 - 1.0;",
    nrm1: "#ifdef USE_NORMALMAP_TANGENTSPACE\n normal = normalize( tbn * mapN );\n#endif",
    rough: "roughnessFactor = mix(roughnessFactor, 0.3, wet);"
  };
  function cut(f, a, b, rep) { var i = f.indexOf(a); if (i < 0) return null; var j = f.indexOf(b, i); if (j < 0) return null; return f.slice(0, i) + rep + f.slice(j + b.length); }
  function patchGround(sh) {
    var f = sh.fragmentShader, g;
    for (var k in ANCH) if (f.indexOf(ANCH[k]) < 0) { note("ground", "anchor " + k + " missing: ground left as is"); TR.n.groundSkip = k; return false; }
    for (var u in U) sh.uniforms[u] = U[u];
    f = f.replace(ANCH.common, COMMON + "\n" + GROUND + "\n" + ANCH.common);
    // the close layers (sand2, detail) go: the macro colour stays in diffuseColor until trnGround; grd stays defined for the (unused) lake code
    g = cut(f, ANCH.close0, ANCH.close1, "vec3 grd = vec3(0.62, 0.55, 0.45);"); if (!g) return false; f = g;
    g = cut(f, ANCH.plz0, ANCH.plz1, "trnGround(diffuseColor.rgb, dist, plz, pavd, vMapUv);"); if (!g) return false; f = g;
    g = cut(f, ANCH.near0, ANCH.near1, ""); if (!g) return false; f = g;
    g = cut(f, ANCH.rock0, ANCH.rock1, ""); if (!g) return false; f = g;
    // normals: the layer normals in world space on the terrain normal (medium keeps one tap of the client's normal map)
    g = cut(f, ANCH.nrm0, ANCH.nrm1, "vec3 mapN = vec3(0.0, 0.0, 1.0); if (uTrnQ.x < 1.5) { vec3 mN1 = texture2D(normalMap, vMapUv * 1400.0).xyz * 2.0 - 1.0; mapN = normalize(vec3(mN1.xy * 0.8 * normalScale * nk, 1.0)); }\n#ifdef USE_NORMALMAP_TANGENTSPACE\n normal = normalize( tbn * mapN );\n#endif\n { vec3 tw0 = normalize(vWN); vec3 tN = normalize(tw0 + vec3(trnNw.x, 0.0, trnNw.y) * uTrnQ.z); if (uTrnQ.x > 1.5) normal = normalize((viewMatrix * vec4(tN, 0.0)).xyz); else normal = normalize(normal + (viewMatrix * vec4(tN - tw0, 0.0)).xyz); }"); if (!g) return false; f = g;
    f = f.replace(ANCH.rough, "roughnessFactor = trnRgh; " + ANCH.rough);
    f = f.replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\n reflectedLight.indirectDiffuse *= trnAO; reflectedLight.indirectSpecular *= trnAO * trnAO;");
    f = f.replace("#include <dithering_fragment>", "#include <dithering_fragment>\n if (uTrnQ.w > 0.5) gl_FragColor = vec4(trnDbg, 1.0);");
    sh.fragmentShader = f; TR.n.groundCompiles = (TR.n.groundCompiles || 0) + 1; return true;
  }

  // dirt roads and trails (the client's EDGE_MATS: u across 0..1, v = metres along / width) and M.dirt (the path shoulders).
  // R16b (coordinator review): the road is the R15 dirt photo again (this material's own map, normal and roughness maps, world space
  // at 3.6, 9 and 16 m), desaturated 20 per cent and graded 60 per cent of the way from the caliche to the R15 brown, embedded gravel,
  // compacted wheel lanes (slightly darker, smoother, tread, small stones left in them), hoof and boot scuffs and a grit normal near.
  var ROAD = [
    "uniform vec4 uTrnRd; uniform vec4 uTrnRG; uniform vec4 uTrnRC; uniform vec4 uTrnRF; varying vec3 vTrW; varying vec3 vTrN;",
    "vec2 trnRN = vec2(0.0); float trnRK = 0.0; float trnRR = 1.0;",
    "vec2 trnR2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }",
    "float trnLane(float x, float c, float hw) { float e = abs(abs(x) - c); return 1.0 - smoothstep(hw * 0.55, hw, e); }",
    // a hoof (0.12 x 0.13 m) or boot (0.09 x 0.2 m) dent with a pushed-up lip in some 0.5 m cells of the road frame (x across, s along)
    "float trnScuff(vec2 r) { vec2 ci = floor(r / 0.5), cf = fract(r / 0.5); float h = trnH1(ci + 13.7); if (h > 0.42) return 0.0;",
    "  vec2 cen = vec2(trnH1(ci + 1.3), trnH1(ci + 7.9)) * 0.5 + 0.25; vec2 d = (cf - cen) * 0.5 / mix(vec2(0.045, 0.1), vec2(0.06, 0.065), step(0.18, h));",
    "  float r2 = dot(d, d); return -exp(-r2 * 2.2) + 0.35 * exp(-(r2 - 1.4) * (r2 - 1.4) * 3.0); }",
    "void trnRoad(inout vec3 col, float u, float v, float dist, float mode) {",
    "  vec2 p = vTrW.xz; vec2 dpx = dFdx(p), dpy = dFdy(p); float dux = dFdx(u), duy = dFdy(u), dvx = dFdx(v), dvy = dFdy(v);",
    "  float det = dpx.x * dpy.y - dpx.y * dpy.x; det = abs(det) > 1e-10 ? det : 1e-10;",
    "  vec2 gu = vec2(dpy.y * dux - dpx.y * duy, dpx.x * duy - dpy.x * dux) / det, gv = vec2(dpy.y * dvx - dpx.y * dvy, dpx.x * dvy - dpy.x * dvx) / det;",
    "  float wid = clamp(1.0 / max(length(gu), 1e-3), 0.8, 40.0); vec2 acr = normalize(gu + vec2(1e-6)), alg = normalize(gv + vec2(1e-6));",
    "  float ef = mix(0.86, 1.0, smoothstep(0.045, 0.22, min(u, 1.0 - u)));",   // the client's darker ragged edge
    // the far road: the dirt photo at 16 m (R15's scale: large stones that still read at distance) in the R16 grade; one tap
    "  vec2 q3 = trnR2(p, 2.03) / 16.0 + vec2(0.57, 0.13); vec2 g3x = trnR2(dpx, 2.03) / 16.0, g3y = trnR2(dpy, 2.03) / 16.0;",
    "#ifdef USE_MAP",
    "  vec3 d3 = textureGrad(map, q3, g3x, g3y).rgb;",
    "#else",
    "  vec3 d3 = col;",
    "#endif",
    "  float l3 = dot(d3, vec3(0.2126, 0.7152, 0.0722)); col = mix(mix(vec3(l3), d3, 0.8) * uTrnRG.rgb, uTrnRF.rgb, uTrnRC.a) * ef;",
    "  float fade = (1.0 - smoothstep(uTrnRd.y * 0.5, uTrnRd.y, dist)) * uTrnE.x; if (fade <= 0.001) return;",
    "  float x = (u - 0.5) * wid, s = v * wid; float edm = min(u, 1.0 - u) * wid;",
    "  float lane = 0.0, crown = 0.0, berm = 0.0, dl = 0.0, ridge = 0.0;",
    "  if (mode > 1.5) { berm = 1.0; }",   // shoulders: loose material all over
    "  else if ((mode > 0.5 || wid > 5.0) && wid > 2.6) { float c = wid * 0.19, hw = clamp(wid * 0.035, 0.17, 0.3); lane = trnLane(x, c, hw); dl = (trnLane(x + 0.02, c, hw) - trnLane(x - 0.02, c, hw)) / 0.04;",
    "    float e = abs(abs(x) - c); ridge = smoothstep(hw * 0.85, hw * 1.15, e) * (1.0 - smoothstep(hw * 1.15, hw * 2.0, e)); float cw = max(0.3, wid * 0.08); crown = exp(-(x / cw) * (x / cw)); berm = 1.0 - smoothstep(0.2, 1.1, edm); }",
    "  else { float tw = max(0.3, wid * 0.2); lane = (1.0 - smoothstep(tw * 0.5, tw, abs(x))) * 0.8; berm = 1.0 - smoothstep(0.1, 0.6, edm); }",
    // the near road: the dirt photo at 2.4 m and 6.3 m, the caliche layer for continuity with the ground, graded to the same mean
    "  vec2 q1 = trnR2(p, 0.37) / 3.6; vec2 g1x = trnR2(dpx, 0.37) / 3.6, g1y = trnR2(dpy, 0.37) / 3.6;",
    "  vec2 q2 = trnR2(p, -1.21) / 9.0 + vec2(0.31, 0.77); vec2 g2x = trnR2(dpx, -1.21) / 9.0, g2y = trnR2(dpy, -1.21) / 9.0;",
    "#ifdef USE_MAP",
    "  vec3 d1 = textureGrad(map, q1, g1x, g1y).rgb, d2 = textureGrad(map, q2, g2x, g2y).rgb;",
    "#else",
    "  vec3 d1 = d3, d2 = d3;",
    "#endif",
    // 3.6 m and 9 m near, the 9 m and 16 m scales take over with distance so stones keep reading in the middle distance
    "  float mk = smoothstep(0.3, 0.7, trnNoise(p * 0.19 + 2.1)), fm = smoothstep(6.0, 30.0, dist); vec3 ds = mix(mix(d1, d2, mk * 0.5), mix(d2, d3, 0.5), fm);",
    "  float ld = dot(ds, vec3(0.2126, 0.7152, 0.0722)); vec3 dirt = mix(vec3(ld), ds, 0.8) * uTrnRG.rgb * pow(clamp(ld / 0.13, 0.2, 4.0), 0.3);",
    "  vec4 A0 = trnTA(p, 0, dpx, dpy); vec3 rc = mix(dirt, A0.rgb * uTrnRC.rgb, uTrnRC.a);",
    "  float hd = clamp(dot(d1, vec3(0.333)) * 3.5, 0.0, 1.0);",   // the dirt photo's light stones read high
    // embedded gravel: patches everywhere, more on the crown and the berms, fewer in the lanes (but some small stones stay in them)
    "  float n2 = trnNoise(p * 0.7 + 3.3), n3 = trnNoise(p * 2.3 + 1.1), n4 = trnNoise(p * 0.13 + 8.8);",
    "  float wg = max(max(crown * 0.85, berm * 0.8), 0.34 + 0.4 * smoothstep(0.45, 0.8, n4 * 0.6 + n2 * 0.4)) * smoothstep(0.05, 0.6, n2 * 0.7 + n3 * 0.3 + 0.2) * (1.0 - 0.35 * lane);",
    "  vec4 A2 = vec4(0.0); float b2 = 0.0;",
    "  if (wg > 0.02) { A2 = trnTA(p, 2, dpx, dpy); float a0 = 0.62 + hd * 0.4, a2 = wg + A2.a * 0.55; float am = max(a0, a2); float bb0 = max(a0 - am + 0.2, 0.0); b2 = max(a2 - am + 0.2, 0.0); b2 /= max(bb0 + b2, 1e-4); rc = mix(rc, A2.rgb * uTrnRC.rgb * 1.05, b2); }",
    // the wheel lanes: compacted, slightly darker and smoother, the tread layer laid along the road; a loose lip beside each lane
    "  vec2 tuv = vec2(x, s) / 1.5; vec2 tdx = vec2(dux, dvx) * wid / 1.5, tdy = vec2(duy, dvy) * wid / 1.5;",
    "  if (lane > 0.02) { vec4 A7 = textureGrad(tTrA, vec3(tuv, 7.0), tdx, tdy); rc = mix(rc, mix(rc, A7.rgb * uTrnRC.rgb, 0.35) * 0.85, lane * uTrnRd.w); }",
    "  rc *= (1.0 + ridge * 0.05) * (0.94 + 0.12 * n2) * (0.95 + 0.1 * trnNoise(p * 0.09 + 7.7));",
    // hoof and boot scuffs within 28 m on the travelled part (20 mm dents with a lip)
    "  vec2 sN = vec2(0.0); if (dist < 28.0 && mode < 1.5 && uTrnQ.x > 1.5) { vec2 r = vec2(x, s); float h0 = trnScuff(r), hx = trnScuff(r + vec2(0.01, 0.0)), hz = trnScuff(r + vec2(0.0, 0.01));",
    "    float k = (1.0 - smoothstep(14.0, 28.0, dist)) * (1.0 - berm); vec2 g = vec2(hx - h0, hz - h0) / 0.01 * 0.02; sN = -(acr * g.x + alg * g.y) * k; rc *= 1.0 + h0 * 0.16 * k; }",
    "  vec2 nn = vec2(0.0); float rg = 0.93 - 0.03 * lane, ao = 1.0;",
    "  if (uTrnQ.x > 1.5) {",
    "#ifdef USE_NORMALMAP",
    "    vec2 nA = textureGrad(normalMap, q1, g1x, g1y).xy * 2.0 - 1.0, nB = textureGrad(normalMap, q2, g2x, g2y).xy * 2.0 - 1.0, nC = textureGrad(normalMap, q3, g3x, g3y).xy * 2.0 - 1.0;",
    "    nn = mix(mix(trnR2(nA, -0.37), trnR2(nB, 1.21), mk * 0.5), mix(trnR2(nB, 1.21), trnR2(nC, -2.03), 0.5), fm) * (1.0 - 0.3 * lane) * 1.1;",
    "#endif",
    "#ifdef USE_ROUGHNESSMAP",
    "    rg = mix(textureGrad(roughnessMap, q1, g1x, g1y).g, 0.95, 0.3) - 0.035 * lane;",
    "#endif",
    "    if (b2 > 0.0) { vec4 B2 = trnTB(p, 2, dpx, dpy); nn = mix(nn, trnRot(B2.rg * 2.0 - 1.0, uTrnS[2]) * uTrnS[2].z, b2); rg = mix(rg, B2.b, b2); ao = mix(1.0, B2.a, b2); }",
    "    if (lane > 0.02) { vec4 B7 = textureGrad(tTrB, vec3(tuv, 7.0), tdx, tdy); vec2 tn = B7.rg * 2.0 - 1.0; nn += (acr * tn.x + alg * tn.y) * lane * 0.5; }",
    // grit within 22 m (the DG layer's fine normal and cavity): no smooth patch near the camera
    "    float mg = 1.0 - smoothstep(10.0, 22.0, dist); if (mg > 0.0) { vec4 Bm = textureGrad(tTrB, vec3(p * 3.1, 6.0), dpx * 3.1, dpy * 3.1); nn += (Bm.rg * 2.0 - 1.0) * 0.6 * mg; ao *= mix(1.0, Bm.a, 0.45 * mg); }",
    "    rc *= mix(1.0, ao, 0.5); }",
    "  col = mix(col, rc * ef, fade); trnRK = fade; trnRR = rg; trnRN = (nn + sN + acr * (dl * uTrnRd.z)) * fade;",   // the rut walls: the lanes pressed 3 cm into the road
    "}"
  ].join("\n");
  var NOISE = "float trnH1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } float trnNoise(vec2 p){ vec2 i = floor(p), q = fract(p); q = q * q * (3.0 - 2.0 * q); return mix(mix(trnH1(i), trnH1(i + vec2(1, 0)), q.x), mix(trnH1(i + vec2(0, 1)), trnH1(i + vec2(1, 1)), q.x), q.y); }";
  var EDGE_END = "diffuseColor.rgb *= mix(0.86, 1.0, smoothstep(0.045, 0.22, edge)); }";
  function patchRoad(sh, mode) {
    var f = sh.fragmentShader, vtx = sh.vertexShader;
    if (vtx.indexOf("#include <begin_vertex>") < 0 || f.indexOf("#include <map_fragment>") < 0 || f.indexOf("void main() {") < 0) { note("road", "chunks missing"); return false; }
    for (var u in U) sh.uniforms[u] = U[u];
    sh.uniforms.uTrnMode = { value: mode };
    sh.vertexShader = vtx.replace("#include <common>", "#include <common>\nvarying vec3 vTrW; varying vec3 vTrN;").replace("#include <begin_vertex>", "#include <begin_vertex>\n{ vec4 tw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n tw = instanceMatrix * tw;\n#endif\n vTrW = (modelMatrix * tw).xyz; vTrN = normalize(mat3(modelMatrix) * normal); }");
    // after every pars chunk (the road code samples this material's map, normalMap and roughnessMap); value noise of its own
    f = f.replace("void main() {", COMMON + "\nuniform float uTrnMode;\n" + NOISE + "\n" + ROAD + "\nvoid main() {");
    var call = "\n trnRoad(diffuseColor.rgb, vMapUv.x, vMapUv.y, length(vViewPosition), uTrnMode);";
    if (f.indexOf(EDGE_END) >= 0) f = f.replace(EDGE_END, EDGE_END + call); else f = f.replace("#include <map_fragment>", "#include <map_fragment>" + call);
    f = f.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, trnRR, trnRK);");
    f = f.replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n if (trnRK > 0.0 && uTrnQ.x > 1.5) { vec3 tw0 = normalize(vTrN); vec3 tN = normalize(tw0 + vec3(trnRN.x, 0.0, trnRN.y)); normal = normalize(mix(normal, (viewMatrix * vec4(tN, 0.0)).xyz, trnRK)); }");
    sh.fragmentShader = f; return true;
  }

  // paths: decomposed granite (and its red and chip-seal variants) from the DG layer in world space; travertine per-paver variation
  var PATH = [
    "uniform vec4 uTrnP; varying vec3 vTrW; varying vec3 vTrN; uniform float uTrnMode; uniform float uTrnSt;",
    "vec2 trnPN = vec2(0.0); float trnPK = 0.0; float trnPR = 1.0;",
    "void trnPath(inout vec3 col, float dist, vec2 muv) {",
    "  vec2 p = vTrW.xz; vec2 dpx = dFdx(p), dpy = dFdy(p); float fade = (1.0 - smoothstep(uTrnP.a * 0.5, uTrnP.a, dist)) * uTrnE.x;",
    "  if (uTrnMode < 0.5) {",   // decomposed granite: the albedo everywhere (no far change), the normal and roughness near
    "    if (uTrnE.x < 0.5) return; vec4 A = trnTA(p, 6, dpx, dpy); float pv = trnNoise(p * 0.31) * 0.6 + trnNoise(p * 1.7 + 4.1) * 0.4;",   // compaction and fines: a few metres of patchiness
    "    col = A.rgb * uTrnP.rgb * uTrnE.y * (0.9 + 0.18 * pv); trnPK = fade;",
    "    if (uTrnQ.x > 1.5 && fade > 0.0) { vec4 B = trnTB(p, 6, dpx, dpy); trnPN = trnRot(B.rg * 2.0 - 1.0, uTrnS[6]) * uTrnS[6].z * fade; trnPR = B.b; col *= mix(1.0, B.a, 0.5 * fade); } else trnPR = 0.9;",
    "  } else {",   // travertine pavers (3 x 3 per texture repeat): each stone its own tint and finish, pores from the rock layer near
    "    if (uTrnSt < 0.5) { vec2 cl = floor(muv * 3.0); float hs = trnHash(cl), hs2 = trnHash(cl + 17.3); col *= vec3(0.93 + 0.12 * hs, 0.93 + 0.11 * hs, 0.93 + 0.09 * hs) * mix(vec3(1.0), vec3(1.03, 1.0, 0.95), hs2); trnPR = 0.8 + 0.12 * hs2; }",
    "    else trnPR = -1.0;",   // the ashlar set carries its own per-stone tint and finish (tex/tr_trav*.ktx2)
    "    trnPK = fade;",
    "    if (uTrnQ.x > 1.5 && fade > 0.0 && uTrnE.x > 0.5) { vec2 mu = p / 0.9; vec4 B = textureGrad(tTrB, vec3(mu, 5.0), dpx / 0.9, dpy / 0.9); trnPN = (B.rg * 2.0 - 1.0) * 0.55 * fade; col *= mix(1.0, B.a, 0.35 * fade); }",
    "  }",
    "}"
  ].join("\n");
  function patchPath(sh, mode) {
    var f = sh.fragmentShader, vtx = sh.vertexShader;
    if (vtx.indexOf("#include <begin_vertex>") < 0 || f.indexOf("#include <map_fragment>") < 0) { note("path", "chunks missing"); return false; }
    for (var u in U) sh.uniforms[u] = U[u];
    sh.uniforms.uTrnMode = { value: mode };
    sh.vertexShader = vtx.replace("#include <common>", "#include <common>\nvarying vec3 vTrW; varying vec3 vTrN;").replace("#include <begin_vertex>", "#include <begin_vertex>\n{ vec4 tw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n tw = instanceMatrix * tw;\n#endif\n vTrW = (modelMatrix * tw).xyz; vTrN = normalize(mat3(modelMatrix) * normal); }");
    f = f.replace("#include <common>", "#include <common>\n" + COMMON + "\n" + NOISE + "\n" + PATH);
    f = f.replace("#include <map_fragment>", "#include <map_fragment>\n trnPath(diffuseColor.rgb, length(vViewPosition), vMapUv);");
    f = f.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n if (trnPR >= 0.0) roughnessFactor = mix(roughnessFactor, trnPR, trnPK);");
    f = f.replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n if (trnPK > 0.0 && uTrnQ.x > 1.5) normal = normalize(normal + (viewMatrix * vec4(trnPN.x, 0.0, trnPN.y, 0.0)).xyz);");
    sh.fragmentShader = f; return true;
  }

  // ═════════════════ material wrapping ═════════════════
  function own(m, k) { return Object.prototype.hasOwnProperty.call(m, k); }
  function baseObc(m) { if (m._userObc !== undefined) return m._userObc; var o = m.onBeforeCompile; return o && o !== THREE.Material.prototype.onBeforeCompile ? o : null; }
  var WR = TR.wrapped = [];
  var KV = OLD ? "h" + ((Math.random() * 1e9) | 0).toString(36) : "1";   // a hot-reloaded copy compiles its own programs (the key changes)
  function wrap(m, tag, patch, uni) {
    if (!m || m.userData.trnOrig) return false;
    var base = baseObc(m);
    m.userData.trnOrig = { obc: base, key: own(m, "customProgramCacheKey") ? m.customProgramCacheKey : null };
    m.onBeforeCompile = function (sh, r) { if (base) base.call(this, sh, r); if (!TR.on) return; try { patch(sh); if (uni) for (var k in uni) sh.uniforms[k] = uni[k]; } catch (e) { note("patch " + tag, e); } };
    keyWrap(m, tag); m.needsUpdate = true; WR.push(m); return true;
  }
  function keyWrap(m, tag) {
    var k0 = m.customProgramCacheKey; if (k0 && k0._trn) return;
    var f = function () { return (k0 ? k0.call(this) : "") + "|trn:" + tag + ":" + (TR.on ? 1 : 0) + ":" + KV; }; f._trn = true; m.customProgramCacheKey = f;
  }
  function unwrap(m) { var o = m.userData.trnOrig; if (!o) return; m.onBeforeCompile = o.obc || THREE.Material.prototype.onBeforeCompile; if (o.key) m.customProgramCacheKey = o.key; else delete m.customProgramCacheKey; delete m.userData.trnOrig; m.needsUpdate = true; }

  // can we patch the ground? run the client's own hook on a stock shader and look for every anchor (the client may change)
  function dryRun(m) {
    if (TR.dry !== undefined) return TR.dry; TR.dry = false;
    try { var base = baseObc(m); if (!base) { note("ground", "no client hook"); return false; }
      var sh = { uniforms: {}, defines: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader }; var keep = m.userData.sh;
      try { base.call(m, sh, typeof renderer !== "undefined" ? renderer : null); } finally { m.userData.sh = keep; }
      var miss = Object.keys(ANCH).filter(function (k) { return sh.fragmentShader.indexOf(ANCH[k]) < 0; });
      if (miss.length) { note("ground", "anchors missing: " + miss.join(",")); TR.n.dryMiss = miss; return false; }
      TR.dry = true; } catch (e) { note("dry run", e); TR.dry = false; }
    return TR.dry;
  }
  TR.owns = function () { if (OFF) return false; var t = TR.tier >= 0 ? TR.tier : tierOf(); if (t < 1) return false; try { if (typeof GROUND_MATS === "undefined" || !GROUND_MATS[0]) return false; return dryRun(GROUND_MATS[0]); } catch (e) { return false; } };
  TR.ownsRoads = function () { if (ROADS_OFF) return false; var t = TR.tier >= 0 ? TR.tier : tierOf(); return t >= 1 && TR.owns(); };

  function installGround() {
    var m = GROUND_MATS[0]; if (!m || !TR.owns()) return false;
    TR.groundMat = m; wrap(m, "ground", patchGround); TR.n.mats++; return true;
  }
  function installRoads() {
    if (!TR.ownsRoads() || typeof EDGE_MATS === "undefined") return 0; var n = 0;
    // per material: dirt roads 15 per cent caliche, trails (M.track) lighter and 30 per cent caliche, the shoulders in between
    var RU = { road: [0.634, 0.535, 0.462, 0.15], trail: [0.71, 0.599, 0.517, 0.3], shoulder: [0.66, 0.557, 0.48, 0.28] }, L0 = [0.441, 0.348, 0.243];
    var uni = function (k) { var c = RU[k]; return { uTrnRC: { value: v4(c[0], c[1], c[2], c[3]) }, uTrnRF: { value: v4(L0[0] * c[0], L0[1] * c[1], L0[2] * c[2], 0) } }; };
    EDGE_MATS.forEach(function (m, src) { var mode = (typeof M !== "undefined" && src === M.track) ? 0 : 1; if (wrap(m, "road", function (sh) { patchRoad(sh, mode); }, uni(mode ? "road" : "trail"))) n++; });
    if (typeof M !== "undefined" && M.dirt && wrap(M.dirt, "road", function (sh) { patchRoad(sh, 2); }, uni("shoulder"))) n++;
    TR.n.roads = n; return n;
  }
  function installPaths() {
    if (PATHS_OFF || TR.tier < 1 || typeof PM === "undefined" || !PM.stone) return 0; var n = 0;
    var tint = { dg: [1.0, 1.0, 1.0], redg: [1.32, 0.82, 0.62], chip: [0.8, 0.82, 0.86] };
    ["dg", "redg", "chip"].forEach(function (k) { var m = PM[k]; if (!m) return; var t = tint[k]; var uni = { uTrnP: { value: v4(t[0], t[1], t[2], 90) } }; if (wrap(m, "path", function (sh) { patchPath(sh, 0); }, uni)) n++; });
    var st = TR.stoneU = { uTrnP: { value: v4(1, 1, 1, 60) }, uTrnSt: { value: 0 } };
    if (wrap(PM.stone, "path", function (sh) { patchPath(sh, 1); }, st)) { n++; try { loadTrav(TR.tier); } catch (e) { note("trav", e); } }
    TR.n.paths = n; return n;
  }
  // travertine (PM.stone): tumbled ashlar courses on a 4.5 m repeat (the promenades' tile), 2048 px albedo, 1024 px normal and roughness
  function loadTrav(t) {
    var m = PM.stone; if (!m || TR.trav) return; TR.trav = "loading";
    var mob = false; try { mob = ASSET.tier === "m"; } catch (e) {}
    var k = null; try { k = !mob && !NO_KTX && typeof ktx2Loader === "function" ? ktx2Loader() : null; } catch (e) { k = null; }
    var got = {}, names = { a: "tr_trav", n: "tr_trav_n", r: "tr_trav_r" };
    function done() {
      if (!(got.a && got.n && got.r)) return;
      [got.a, got.n, got.r].forEach(function (x) { x.wrapS = x.wrapT = THREE.RepeatWrapping; x.anisotropy = aniso(t); x.minFilter = THREE.LinearMipmapLinearFilter; x.magFilter = THREE.LinearFilter; x.needsUpdate = true; x.userData.avShared = true; });
      got.a.colorSpace = THREE.SRGBColorSpace; got.n.colorSpace = got.r.colorSpace = THREE.NoColorSpace;
      TR.travOld = { map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, color: m.color.getHex(), ns: m.normalScale.x };
      m.map = got.a; m.normalMap = got.n; m.roughnessMap = got.r; m.color.setHex(0xf3e9dc); m.normalScale.set(1, 1); TR.stoneU.uTrnSt.value = 1; TR.trav = k ? "ktx2" : "jpg_m";
    }
    Object.keys(names).forEach(function (key) {
      var fail = function (e) { note("trav " + key, e); TR.trav = "failed"; };
      if (k) k.load(au("/tex/" + names[key] + ".ktx2?v=" + (window.BUILD || "dev")), function (tx) { got[key] = tx; done(); }, undefined, fail);
      else new THREE.TextureLoader().load(au("/tex/" + names[key] + "_m.jpg?v=" + (window.BUILD || "dev")), function (tx) { got[key] = tx; done(); }, undefined, fail);
    });
  }
  // the client's overlay ruts (two dark translucent strips per dirt road) give way to the shaded wheel lanes
  function hideOverlayRuts() {
    if (!TR.n.roads || TR.rutMesh) return; var hit = null;
    try { scene.traverse(function (o) { if (hit || !o.isMesh || !o.material || Array.isArray(o.material)) return; var m = o.material; if (m.transparent && Math.abs(m.opacity - 0.34) < 1e-3 && m.color && m.color.getHex() === 0x2f241a && m.polygonOffsetFactor === -3) hit = o; }); } catch (e) {}
    if (hit) { TR.rutMesh = hit; hit.visible = !TR.on; TR.n.rutsHidden = 1; }
  }

  function applyTier() {
    var t = TR.tier; if (!U.uTrnQ.value) return;
    U.uTrnQ.value.x = t; U.uTrnQ.value.y = t >= 3 ? 190 : t >= 2 ? 150 : 110;
    U.uTrnE.value.w = t >= 3 ? 0.55 : 0.0; U.uTrnRd.value.y = t >= 3 ? 130 : 100;
  }

  // ═════════════════ hooks ═════════════════
  function worldHook() {
    if (OFF) return; TR.tier = tierOf(); if (TR.tier < 1) { TR.n.tier = TR.tier; return; }
    try { initUniforms(); applyTier(); loadTextures(TR.tier); } catch (e) { note("init", e); }
    try { installGround(); } catch (e) { note("install ground", e); }
    TR.installed = true; TR.n.tier = TR.tier;
  }
  function deferHook() {
    if (OFF || TR.tier < 1) return;
    try { installRoads(); } catch (e) { note("install roads", e); }
    try { installPaths(); } catch (e) { note("install paths", e); }
    // plan_crossing sets the ground's program key in its own defer hook: keep ours on top of it
    try { if (TR.groundMat) keyWrap(TR.groundMat, "ground"); } catch (e) {}
  }
  var FN = 0;
  function frameHook() {
    if (!TR.installed) return; FN++;
    if (FN < 600 && (FN % 30) === 0) hideOverlayRuts();
    if ((FN % 90) === 0) { var t = tierOf(); if (t !== TR.tier && t >= 1 && TX.a && (t < 2 || TX.b)) { TR.tier = t; applyTier(); } }
  }

  // ═════════════════ API ═════════════════
  TR.set = function (on) {   // runtime A/B: the client's own ground and roads (without plan_gfx's layers) against these
    TR.on = !!on; WR.forEach(function (m) { m.needsUpdate = true; }); if (TR.rutMesh) TR.rutMesh.visible = !TR.on; travSwap(TR.on); return TR.on;
  };
  function travSwap(on) {
    var m = typeof PM !== "undefined" && PM.stone, o = TR.travOld; if (!m || !o) return;
    if (!TR.travNew) TR.travNew = { map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap };
    var s = on ? TR.travNew : o; if (m.map === s.map) return; m.map = s.map; m.normalMap = s.normalMap; m.roughnessMap = s.roughnessMap; m.color.setHex(on ? 0xf3e9dc : o.color); m.normalScale.set(on ? 1 : o.ns, on ? 1 : o.ns); TR.stoneU.uTrnSt.value = on ? 1 : 0;
  }
  TR.dbg = function (mode) { if (U.uTrnQ.value) U.uTrnQ.value.w = mode || 0; return mode || 0; };   // 1 texel density heat (mipviz colours), 2 layer weights, 3 the R15 close layer's density
  TR.state = function () {
    var mb = 0; if (TX.a) { var a = TX.a.image || {}; mb += (a.width || 0) * (a.height || 0) * NL * (TX.a.isCompressedArrayTexture ? 1 : 4) * 4 / 3; } if (TX.b) { var b = TX.b.image || {}; mb += (b.width || 0) * (b.height || 0) * NL * (TX.b.isCompressedArrayTexture ? 1 : 4) * 4 / 3; }
    return { v: TR.v, on: TR.on, tier: TR.tier, tex: TX.state, src: TX.src, texMs: TX.ms, gpuMB: Math.round(mb / 1048576 * 10) / 10, n: TR.n, errs: TR.errs.slice(0, 8) };
  };
  TR.uninstall = function () { try { travSwap(false); } catch (e) {} WR.splice(0).forEach(unwrap); if (TR.rutMesh) TR.rutMesh.visible = true; TR.installed = false; };
  TR.LAY = LAY;

  // hot reload (development): the previous copy gives its materials back, keeps its textures; then this copy installs at once
  if (OLD) { try { OLD.uninstall(); } catch (e) {} }
  var HK = window.PLAN_HOOKS;
  ["world", "defer", "frame"].forEach(function (ph) { HK[ph] = (HK[ph] || []).filter(function (h) { return !(h && h.name && /^trn/.test(h.name)); }); });
  HK.world.push({ name: "trnWorld", fn: worldHook }); HK.defer.push({ name: "trnDefer", fn: deferHook }); HK.frame.push({ name: "trnFrame", fn: frameHook });
  if (OLD && typeof GROUND_MATS !== "undefined" && GROUND_MATS[0]) { TR.dry = undefined; worldHook(); deferHook(); if (TX.a) setTex(TX.a, TX.b, TX.src || "kept"); }
})();
