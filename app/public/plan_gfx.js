// plan_gfx.js: the graphics pass (round 3, GFX). Classic script loaded before client.js; reaches client globals by bare name
// at hook time only. Everything is tier-aware:
//   tier 0  low quality, or any phone / weak machine (the "m" asset tier): only what costs nothing or saves work (one instanced
//           cloud draw instead of 70 sprites, the analytic sky, the grading curve, the storm's sky and light changes)
//   tier 1  medium on a desktop: + layered terrain (no per-layer normals), a cheap stable AO, probe reflections on polished
//           floors, sun shafts, a fitted and texel-snapped shadow camera
//   tier 2  high and ultra: + terrain detail normals, the full AO, screen-space floor reflections, heat shimmer, golden-hour rays
// ?gfx=0 turns the whole module off (the client then runs exactly as before). PLAN_GFX.uninstall() / install() switch it at
// runtime (A/B measurements). API for other modules: PLAN_GFX.addReflectiveFloor(meshOrGroup, opts), PLAN_GFX.addSunShaft(opts).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
// R21 RP (render pipeline): the canvas without its own 4x MSAA and preserved drawing buffer. Every tier draws the scene into a
// render target and writes the canvas with one full-screen pass (FXAA, SMAA or the TAA resolve before it), so the canvas MSAA
// (4 samples of colour and depth at the canvas size, resolved every frame) and the preserved buffer (a copy every frame) bought
// nothing. Where the scene is drawn straight to the canvas, the look is kept: photo mode (H) draws into a 4x MSAA target with the
// canvas's own output (ACES and sRGB in the shader, 8-bit samples, the same programs) and blits it over; VR's layer still gets its
// MSAA (three asks the context attributes for it); a snapshot (canvas.toDataURL / toBlob) draws a frame first in the same task.
// ?rpaa=0 (or ?rp=0): the R20 canvas. The context attributes are fixed at creation, so this one has no runtime switch.
(function () {
  "use strict";
  var Q = location.search, DEF = false;   // DEF: on by default (until proven, ?rpaa=1 opts in)
  if (/[?&](rp|rpaa)=0(&|$)/.test(Q) || !(DEF || /[?&]rpaa=1(&|$)/.test(Q)) || !window.THREE || !THREE.WebGLRenderer || THREE.WebGLRenderer.__rpaa) return;
  var RP = window.PLAN_RP = window.PLAN_RP || { v: "r21", sw: {}, errs: [], govKnobs: [] };
  var AA = RP.aa = { on: false, photo: 0, rt: null, n: { photo: 0, shots: 0, blitFail: 0 } };
  var Orig = THREE.WebGLRenderer;
  var Wrapped = function (p) {
    p = Object.assign({}, p || {}); var askAA = p.antialias === true, askPDB = p.preserveDrawingBuffer === true;
    if (askAA || askPDB) { p.antialias = false; p.preserveDrawingBuffer = false; }
    var R = new Orig(p); if (!(askAA || askPDB)) return R;
    AA.on = true; AA.askAA = askAA; AA.askPDB = askPDB; AA.R = R;
    try {   // three's XR manager reads antialias from the context attributes for the layer's own MSAA
      var gl = R.getContext(), gca = gl.getContextAttributes.bind(gl);
      gl.getContextAttributes = function () { var a = gca(); if (a && askAA) { a = Object.assign({}, a); a.antialias = true; } return a; };
    } catch (e) { RP.errs.push("aa attrs: " + e.message); }
    try {   // snapshots: the drawing buffer is not preserved, so draw a frame in the same task first
      var cv = R.domElement, td = cv.toDataURL, tb = cv.toBlob;
      var redraw = function () { try { if (!AA.inFrame && typeof renderFrame === "function") { AA.n.shots++; renderFrame(); } } catch (e) { RP.errs.push("aa redraw: " + e.message); } };
      cv.toDataURL = function () { redraw(); return td.apply(cv, arguments); };
      if (tb) cv.toBlob = function () { redraw(); return tb.apply(cv, arguments); };
    } catch (e) { RP.errs.push("aa snapshot: " + e.message); }
    try {   // photo mode: the scene straight to the canvas; drawn through a 4x MSAA target with the canvas's output instead
      var r0 = R.render;
      R.render = function (sc, cam) {
        if (askAA && AA.on && sc && sc.isScene === true && this.getRenderTarget() === null && !this.xr.isPresenting && document.body.classList.contains("photo")) { try { if (photoFrame(this, r0, sc, cam)) return; } catch (e) { RP.errs.push("aa photo: " + e.message); AA.n.blitFail++; } }
        return r0.apply(this, arguments);
      };
    } catch (e) { RP.errs.push("aa photo hook: " + e.message); }
    return R;
  };
  function photoFrame(R, r0, sc, cam) {
    var w = R.domElement.width, h = R.domElement.height, rt = AA.rt;
    if (!rt || rt.width !== w || rt.height !== h) { if (rt) rt.dispose(); rt = AA.rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, depthBuffer: true, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
      rt.texture.internalFormat = "RGBA8";   // the shader writes sRGB (as for the canvas); the samples and their resolve stay as written
      rt.isXRRenderTarget = true; }        // three applies the renderer's tone mapping and output colour space only for the canvas or an XR target
    R.setRenderTarget(rt); r0.call(R, sc, cam); R.setRenderTarget(null);
    var fb = R.properties.get(rt).__webglFramebuffer; if (!fb) return false; var gl = R.getContext(), st = R.state;
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, fb); st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, null); R.setRenderTarget(null); AA.n.photo++; AA.photo = performance.now(); return true;
  }
  // the photo target is freed a few seconds after photo mode ends
  setInterval(function () { if (AA.rt && performance.now() - AA.photo > 5000) { AA.rt.dispose(); AA.rt = null; } }, 3000);
  Wrapped.prototype = Orig.prototype; try { Object.setPrototypeOf(Wrapped, Orig); } catch (e) {} Wrapped.__rpaa = true; Wrapped.Orig = Orig;
  THREE.WebGLRenderer = Wrapped;
})();
(function () {
  "use strict";
  var HK = window.PLAN_HOOKS;
  var OFF = /[?&]gfx=0\b/.test(location.search);
  var prev = window.PLAN_GFX;
  var hot = !!(prev && prev.installed);            // re-evaluated inside a running game (development): swap in place
  if (hot) { try { prev.uninstall(true); } catch (e) { console.warn("[gfx] uninstall", e); } }
  var ORIG = window.__GFX_ORIG = window.__GFX_ORIG || {};
  var IID = (Date.now() % 100000).toString(36);   // this evaluation of the module (a re-evaluation must compile its own programs)
  var pending = (prev && prev.pending) || { floors: [], shafts: [] };   // API calls made before the module was ready

  var GX = window.PLAN_GFX = {
    version: 3, errs: [], n: {}, on: !OFF, installed: false, tier: -1, bootTier: -1, pending: pending,
    r6off: /[?&]r6=0/.test(location.search),   // R6 (HANDOFF_R6_RENDER.md): ?r6=0 restores the R5 behaviour of the R6 changes here
    storm: { k: 0, force: null, gust: 0, flash: 0, dir: [0.55, 0, 0.83], day: -1, next: 0, bolt: null, seq: null, probeK: 0, probeAt: 0 },
    floors: [], shafts: [], obj: {}, mats: {},
    // tunables (live-editable while developing)
    K: {
      sky: [2.0, 1.75, 0.0035, 0.82],   // Preetham: turbidity, rayleigh, mie coefficient, mie g (clear high-desert air)
      skyExpo: 0.42, skyKnee: 0.78, skyCap: 1.12, envDesat: 0.25, envK: 0.9,
      cloudN: 64, stormCells: 6, rainN: 10, dustN: 6,
      aoRadius: 0.62, heat: 0.003, ssr: 0.6, shaft: 1.3,
      // R4 sky: the Moon (size x real, brightness), the map (black point, gamma, gain, saturation), the catalogue stars, the night key light
      // R15 (HANDOFF_R15_NIGHT.md): a natural star field (no procedural grain, no high-pass faint stars, a naked-eye limiting magnitude,
      // a steeper brightness law, point-sharp stars in canvas pixels) and a brighter, readable night (key, fill, probe, grade pivot, twilight fill)
      sk: { moonScale: 3.0, moonLit: 1.5, moonTele: 1.0, moonSky: 0.8, airglow: 1.0, glowScale: 1.2, glowBlack: 0.0058, glowBlackMoon: 0.0025, glowBlackTw: 0.006, glowGamma: 2.0, glowGain: 12.0, glowSat: 1.7, glowShoulder: 2.2, glowLocal: 0.12, glowSoft: 1.2, glowDens: 0.5, pebbleDark: 0.12, dither: 0.03, starLim: 6.5, starMaxLow: 7.0, starMoonLim: 1.8, starGain: 9.0, starPow: 0.62, starCap: 8.0, starSat: 1.15, starWhite: 5600, planetGlow: 0.6, starSigma: 0.55, starWing: 0.5, zodi: 0.035, moonHalo: 0.022, airglowBand: 1.0, adaptUp: 0.22, adaptT: 1.3, starKey: 0.15, starFill: 0.8, liftDark: 0.0015, moonKey: 0.48, moonFill: 0.72, twFill: 1.15, twKey: 0.0, twEnv: 0.03, nightPiv: 0.28, twPiv: 0.3, nightExpo: 1.03, moonExpo: 1.0, fogNight: [0.011, 0.02, 0.046], fogMoon: [0.06, 0.068, 0.085], envNight: 0.035, starCol: [0.7, 0.78, 0.95], moonCol: [0.86, 0.9, 1.0], fillCol: [0.4, 0.47, 0.64], fillNeutral: 0.85, nightCloud0: 0.04, nightCloud1: 0.35, conLine: 0.7, skySat: 1.15, trailGain: 1.0, teleGain: 2.2, teleLim: 5.0, teleMip: 0.5, teleBlack: 0.003, teleMapGain: 0.7, planetTele: [1, 1, 1, 1, 1] }
    }
  };
  function note(w, e) { var m = w + ": " + (e && e.message ? e.message : e); if (GX.errs.length < 40) GX.errs.push(m); if (GX.errs.length <= 8) console.warn("[gfx] " + m); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function hash1(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function hook(phase, name, fn) { var a = HK[phase]; if (!a) return; for (var i = a.length - 1; i >= 0; i--) if (a[i] && a[i].name === name) a.splice(i, 1); a.push({ name: name, fn: fn }); }
  function unhook(phase, name) { var a = HK[phase]; if (!a) return; for (var i = a.length - 1; i >= 0; i--) if (a[i] && a[i].name === name) a.splice(i, 1); }

  // ── public API (safe to call at any time; queued until the module is ready; no-ops when off or on tier 0) ──
  GX.addReflectiveFloor = function (obj, opts) { var h = { obj: obj, opts: opts || {}, id: "f" + (pending.floors.length + GX.floors.length + 1), removed: false, remove: function () { h.removed = true; try { removeFloor(h); } catch (e) {} } }; if (!GX.on) return h; if (!GX.installed) { pending.floors.push(h); return h; } try { addFloor(h); } catch (e) { note("addReflectiveFloor", e); } return h; };
  GX.addSunShaft = function (opts) { var h = { opts: opts || {}, removed: false, remove: function () { h.removed = true; try { removeShaft(h); } catch (e) {} } }; if (!GX.on) return h; if (!GX.installed) { pending.shafts.push(h); return h; } try { addShaft(h); } catch (e) { note("addSunShaft", e); } return h; };
  GX.setStorm = function (k) { GX.storm.force = k === null || k === undefined ? null : clamp(+k, 0, 1); return GX.storm.force; };
  // window.PLAN_SKY (the stargazing API, R4): created here so it exists (inert) even with ?gfx=0; kept across a hot reload
  var PS_API = (window.PLAN_SKY && window.PLAN_SKY._gfx) ? window.PLAN_SKY : { _gfx: 1, _q: [] }; window.PLAN_SKY = PS_API;
  PS_API.version = 1; PS_API.ready = false; PS_API.mapReady = false; PS_API.lightK = 1; PS_API._q = PS_API._q || [];
  PS_API.onReady = function (cb) { if (PS_API.ready) { try { cb(PS_API); } catch (e) {} } else PS_API._q.push(cb); };
  ['setStargaze', 'constellations', 'timeLapse', 'setDate', 'meteor', 'dirTo', 'altAz', 'telescopeView', 'moon', 'now', 'humid'].forEach(function (k) { PS_API[k] = function () { return null; }; });
  PS_API.targets = function () { return []; }; PS_API.planets = function () { return []; }; PS_API.state = function () { return { ready: false, off: OFF }; };
  if (OFF) { GX.disabled = true; return; }

  // tier: 0 low / phone, 1 medium desktop, 2 high and ultra
  function tierNow() { try { var lv = QUAL.level, mob = typeof ASSET !== "undefined" && ASSET.tier === "m"; if (lv === "low") return 0; if (lv === "medium") return mob ? 0 : 1; return mob ? 1 : 2; } catch (e) { return 0; } }

  // ═════════════════════════ shared GLSL ═════════════════════════
  var GLSL_NOISE = [
    "float gHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "float gHash3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }",
    "float gNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y); }",
    "float gNoise3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(gHash3(i), gHash3(i + vec3(1, 0, 0)), f.x), mix(gHash3(i + vec3(0, 1, 0)), gHash3(i + vec3(1, 1, 0)), f.x), f.y), mix(mix(gHash3(i + vec3(0, 0, 1)), gHash3(i + vec3(1, 0, 1)), f.x), mix(gHash3(i + vec3(0, 1, 1)), gHash3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }"
  ].join("\n");

  // ═════════════════════════ sky: Preetham scattering tuned for high-desert clarity, twilight, stars, moon, Milky Way ═════════════════════════
  var SKY_FRAG = [
    "uniform float uShift; uniform sampler2D tMilky; uniform float kDusk; uniform float kNight; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow;",
    "uniform vec3 uMoonDir; uniform float uStorm; uniform float uFlash; uniform float uTime; uniform vec4 uSkyK; uniform float uSkyExpo; uniform vec3 uKnee; uniform float uEnv; uniform vec3 uStormCol; uniform vec3 uFlashDir; uniform float uGfx;",
    // R4: the sky matrix (world -> J2000), the NASA star map (stretched luminance + chroma), the Moon, meteors, the telescope switches
    "uniform mat3 uW2E; uniform sampler2D tSkyG; uniform sampler2D tSkyC; uniform sampler2D tMoon; uniform vec4 uMap; uniform vec4 uMap2; uniform vec4 uMap3; uniform vec4 uMap4; uniform vec4 uNightK; uniform vec3 uMoonSun; uniform vec3 uMoonN; uniform vec4 uMoonP; uniform vec3 uMoonTint; uniform vec4 uMetA[2]; uniform vec4 uMetB[2]; uniform vec4 uTele; uniform vec4 uZodi; uniform vec4 uSkyX;",
    "varying vec3 vDir;",
    GLSL_NOISE,
    "const float PI = 3.141592653589793;",
    "vec3 preetham(vec3 d, vec3 s){",
    "  float sunE = 1000.0 * max(0.0, 1.0 - exp(-((1.6110731556870734 - acos(clamp(s.y, -1.0, 1.0))) / 1.5)));",
    "  vec3 betaR = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5) * uSkyK.y;",
    "  vec3 betaM = 0.434 * (0.2 * uSkyK.x) * 10E-18 * vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14) * uSkyK.z;",
    "  float zen = acos(max(0.0, d.y)); float inv = 1.0 / (cos(zen) + 0.15 * pow(93.885 - zen * 180.0 / PI, -1.253));",
    "  vec3 Fex = exp(-(betaR * 8.4E3 * inv + betaM * 1.25E3 * inv));",
    "  float cosT = dot(d, s); float rP = 0.05968310365946075 * (1.0 + pow(cosT * 0.5 + 0.5, 2.0));",
    "  float g = uSkyK.w, g2 = g * g; float mP = 0.07957747154594767 * (1.0 - g2) / pow(max(1e-4, 1.0 - 2.0 * g * cosT + g2), 1.5);",
    "  vec3 rr = (betaR * rP + betaM * mP) / (betaR + betaM);",
    "  vec3 Lin = pow(sunE * rr * (1.0 - Fex), vec3(1.5)); Lin *= mix(vec3(1.0), pow(sunE * rr * Fex, vec3(0.5)), clamp(pow(1.0 - s.y, 5.0), 0.0, 1.0));",
    "  return (Lin + 0.1 * Fex) * 0.04 + vec3(0.0, 0.0003, 0.00075); }",
    // luminance knee: keeps the bright horizon band under the bloom threshold without flattening the blue zenith
    "vec3 knee(vec3 c){ float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); if (l <= uKnee.x) return c; float l2 = uKnee.x + (uKnee.y - uKnee.x) * (1.0 - exp(-(l - uKnee.x) / max(1e-3, uKnee.y - uKnee.x))); return c * (l2 / l); }",
    // procedural stars in the J2000 frame: the fallback until the catalogue is in (uMap2.y) and the faint field in the telescope (uTele.z cells)
    "vec3 stars(vec3 d, float sc, float thr){ vec3 p = d * sc; vec3 id = floor(p); float h = gHash3(id); if (h < thr) return vec3(0.0);",
    "  vec3 sp = (id + 0.25 + 0.5 * vec3(gHash3(id + 1.3), gHash3(id + 2.7), gHash3(id + 5.1))) / sc; vec3 sd = normalize(sp); float a = length(d - sd);",
    "  float px = max(length(fwidth(d)), 1e-7); float u = (h - thr) / max(1.0 - thr, 1e-4); float sz = px * (0.5 + 0.3 * u); float b = pow(u, 6.0) * 1.8 + 0.035 + 0.05 * gHash3(id + 7.1);",
    "  vec3 col = mix(vec3(1.0, 0.88, 0.76), vec3(0.74, 0.86, 1.12), smoothstep(0.25, 0.6, gHash3(id + 3.3))); return col * b * exp(-a * a / (sz * sz)); }",
    // the procedural Milky Way (until the star map is in), laid on the real galactic plane so the cross-fade does not move it
    "vec3 milkyP(vec3 e){ const vec3 NGP = vec3(-0.86766, -0.19807, 0.45599); const vec3 GC = vec3(-0.05487, -0.87343, -0.48385); float band = dot(e, NGP); float k = exp(-band * band * 16.0);",
    "  float c = pow(max(0.0, dot(e, GC)), 3.0); float n1 = gNoise3(e * 6.0) * 0.55 + gNoise3(e * 15.0 + 3.7) * 0.3 + gNoise3(e * 38.0) * 0.15; float lane = smoothstep(0.28, 0.62, gNoise3(e * 9.0 + 9.1)) * exp(-band * band * 70.0);",
    "  float m = k * (0.25 + 0.75 * smoothstep(0.35, 0.85, n1)) * (1.0 - 0.7 * lane) * (0.55 + 0.9 * c); return vec3(0.62, 0.64, 0.78) * m * 0.11 + vec3(0.8, 0.66, 0.5) * c * k * 0.03; }",
    // the NASA map: equirectangular J2000, centred on 0h, RA increasing to the left; seam-safe gradients, sharp near the pole
    "vec3 skyMap(vec3 e, out float L){ float ra = atan(e.y, e.x); float dec = asin(clamp(e.z, -1.0, 1.0)); float u1 = 0.5 - ra * 0.15915494; float u2 = fract(u1 + 0.5); float v = 0.5 - dec * 0.31830989;",
    "  vec2 gx = vec2(dFdx(u1), dFdx(v)), gy = vec2(dFdy(u1), dFdy(v)); float ax = dFdx(u2), ay = dFdy(u2); if (max(abs(ax), abs(ay)) < max(abs(gx.x), abs(gy.x))) { gx.x = ax; gy.x = ay; }",
    "  float vl = max(max(abs(gx.y), abs(gy.y)), 1e-7) * 16.0; gx.x = clamp(gx.x, -vl, vl); gy.x = clamp(gy.x, -vl, vl); ",
    // R5: the glow is a real photograph (ESO/S. Brunier, the Milky Way panorama, star-free, reprojected to J2000): its luminance
    // tSkyG (sRGB(Y x scale), 8k / 4k / 2k) and its colour tSkyC (chroma). R15: the NASA map (its high-pass faint stars and the
    // procedural grain it drove) is gone: those thousands of soft points were the "too many, blurry" stars. Reads: the photo's
    // luminance + a wide read (local contrast), chroma (3 reads, were 5)
    "  vec2 uv = vec2(u1, v); float gY, gW; vec3 ch; float lod0 = log2(max(max(length(gx * uMap4.xy), length(gy * uMap4.xy)), 1e-4));",
    "  if (uTele.x > 0.5) { gY = textureLod(tSkyG, uv, max(uTele.w - 1.0, 0.0)).r; gW = textureLod(tSkyG, uv, uTele.w + 3.0).r; ch = textureLod(tSkyC, uv, max(uTele.w - 2.0, 0.0)).rgb; }",
    "  else { vec2 gs = gx * uMap3.x, gt = gy * uMap3.x; gY = textureGrad(tSkyG, uv, gs, gt).r; ch = textureGrad(tSkyC, uv, gs, gt).rgb; gW = textureLod(tSkyG, uv, max(lod0 + 4.0, 3.6)).r; }",
    // decode (sRGB curve, / scale), black point, local contrast against the wide read (the lanes sink, the star clouds lift), the tone
    // curve (the photo is display-referred: a power curve maps it to scene light so the core reaches the bloom and the body stays dim)
    "  gY = gY <= 0.04045 ? gY / 12.92 : pow((gY + 0.055) / 1.055, 2.4); gW = gW <= 0.04045 ? gW / 12.92 : pow((gW + 0.055) / 1.055, 2.4);",
    "  float y = max(gY * uMap4.w - uMap.y, 0.0), yw = max(gW * uMap4.w - uMap.y, 0.0); y *= pow(clamp((y + 0.0015) / (yw + 0.0015), 0.3, 3.0), uMap3.y);",
    "  float G = uMap.w * pow(y, uMap.z); G = G / (1.0 + G / uMap2.z);",
    // the star density (the photo's own light: the Milky Way is unresolved starlight): drives the telescope's resolved faint field only
    "  L = clamp((sqrt(y) - uMap3.w) * uMap3.z, 0.0, 0.55);",
    // colour: the photograph's own (saturation uMap2.x), with a processed long exposure's touch of violet-blue in the faint body
    "  vec3 c = ch / max(dot(ch, vec3(0.2126, 0.7152, 0.0722)), 0.03); c = max(mix(vec3(1.0), c, uMap2.x), 0.0);",
    "  float t2 = smoothstep(0.04, 1.1, G); c *= mix(vec3(0.95, 0.88, 1.16), vec3(1.04, 0.97, 0.97), max(t2, uTele.x));",
    "  return c * G; }",
    // meteors: a streak along a great circle with a bright head (two slots, uniform-driven, no draw call)
    "vec3 meteor(vec3 d, vec4 A, vec4 B){ vec3 a = A.xyz, b = B.xyz; vec3 n = normalize(cross(a, b)); float off = dot(d, n); float px = max(length(fwidth(d)), 1e-6);",
    "  float w = exp(-off * off / (px * px * 1.3)); if (w < 0.004) return vec3(0.0); vec3 dp = normalize(d - n * off); float tot = acos(clamp(dot(a, b), -1.0, 1.0));",
    "  float s = atan(dot(cross(a, dp), n), dot(a, dp)) / max(tot, 1e-4); float hd = A.w; float body = smoothstep(hd - 0.5, hd, s) * step(s, hd) * smoothstep(0.0, 0.04, s); float head = exp(-pow((s - hd) * tot / (px * 1.5), 2.0)) * step(0.0, s);",
    "  vec3 col = mix(vec3(0.86, 0.92, 1.0), vec3(0.62, 1.0, 0.72), smoothstep(1.8, 3.5, B.w)); return col * w * (body * 0.55 + head * 1.5) * B.w; }",
    // R5: the towns' light domes, seen from the site (31.342 N, 109.506 W): Agua Prieta (about 90,000 people) 4.4 km to the
    // west-south-west and south-west, Douglas 3.7 km to the west, Bisbee 42 km and Sierra Vista 77 km to the west-north-west,
    // Tucson 170 km to the north-west; brightness by Walker's law (population x distance^-2.5, compressed), the near towns wide and tall
    "float gDome(float az, float h, float az0, float w, float ht, float k){ float da = mod(az - az0 + 3.14159265, 6.2831853) - 3.14159265; return k * exp(-da * da / (w * w)) * exp(-h / ht); }",
    "vec3 lightDomes(vec3 d, float h){ float az = atan(d.x, -d.z); float o = gDome(az, h, 4.18, 0.62, 0.075, 1.0) + gDome(az, h, 3.75, 0.38, 0.05, 0.45) + gDome(az, h, 4.76, 0.42, 0.06, 0.55)",
    "  + gDome(az, h, 5.0, 0.07, 0.025, 0.22) + gDome(az, h, 5.32, 0.09, 0.02, 0.12); return vec3(1.0, 0.74, 0.47) * o * 0.032; }",
    // the zodiacal light: sunlight on the interplanetary dust, a cone along the ecliptic from the real Sun (uZodi.xyz; the ecliptic
    // pole is uMoonN), brightness after Leinert et al. (elongation 30 deg = 1, 60 deg = 0.22, 90 deg = 0.09), wider far from the Sun; the gegenschein
    "float zodi(vec3 d){ float ed = degrees(acos(clamp(dot(d, uZodi.xyz), -1.0, 1.0))); float bd = abs(degrees(asin(clamp(dot(d, uMoonN), -1.0, 1.0))));",
    "  return pow(30.0 / max(ed, 14.0), 2.2) * exp(-bd / (7.0 + 0.22 * ed)) + 0.05 * exp(-((180.0 - ed) * (180.0 - ed) + bd * bd) / 128.0); }",
    "vec3 meteors(vec3 d){ vec3 o = vec3(0.0); if (uMetB[0].w > 0.0) o += meteor(d, uMetA[0], uMetB[0]); if (uMetB[1].w > 0.0) o += meteor(d, uMetA[1], uMetB[1]); return o; }",
    "void main(){ vec3 d = normalize(vDir); vec3 s = normalize(sunDir); float sy = s.y; float h = max(d.y, 0.0);",
    // day: single scattering, eye-adapted scale from the CPU, knee
    "  vec3 dayC = knee(preetham(vec3(d.x, max(d.y, 0.0), d.z), s) * uSkyExpo);",
    // twilight: the warm band toward the sun, the belt of Venus opposite, deep blue above
    "  vec3 hd = normalize(vec3(s.x, 0.0, s.z) + 1e-5); vec3 dh = normalize(vec3(d.x, 0.0, d.z) + 1e-5); float toward = dot(dh, hd) * 0.5 + 0.5;",
    "  float tw = smoothstep(-0.34, -0.03, sy) * (1.0 - smoothstep(0.03, 0.2, sy));",
    "  float venus = smoothstep(-0.12, -0.02, sy) * (1.0 - smoothstep(0.0, 0.06, h)) * pow(1.0 - toward, 3.0);",
    "  vec3 band = (mix(vec3(0.16, 0.19, 0.36), vec3(1.0, 0.46, 0.2), pow(toward, 2.4) * smoothstep(-0.3, -0.04, sy)) + vec3(0.3, 0.16, 0.24) * venus) * (1.0 - smoothstep(0.0, 0.28, h));",
    "  vec3 top = mix(vec3(0.05, 0.08, 0.2), vec3(0.09, 0.12, 0.26), pow(toward, 3.0)); vec3 twC = mix(band + top * smoothstep(0.0, 0.28, h), top, smoothstep(0.28, 0.9, h)) * (0.1 + 0.9 * smoothstep(-0.34, 0.0, sy));",
    // night: a navy gradient with airglow near the horizon (uNightK.z), the towns' glow to the south (uNightK.w), the moonlit sky (uNightK.y)
    "  vec3 nightC = mix(vec3(0.0168, 0.0323, 0.0711), vec3(0.0063, 0.0131, 0.0279), pow(smoothstep(-0.02, 0.5, d.y), 0.6)) * uNightK.z * (1.0 - 0.65 * uTele.x);",
    "  nightC += lightDomes(d, h) * uNightK.w;",
    // the airglow band: brightest some 10 degrees up (van Rhijn), the green oxygen line, slow drifting waves (not in the probe)
    "  nightC += vec3(0.55, 1.0, 0.52) * 0.0045 * uSkyX.y * smoothstep(-0.01, 0.06, d.y) * exp(-h / 0.3) * (0.65 + 0.7 * gNoise(vec2(atan(d.x, -d.z) * 2.2 + uTime * 0.003, h * 3.0))) * uNightK.z * (1.0 - uEnv);",
    // the probe only: the night sky's diffuse light (a cool sky, brighter toward the horizon: the ambient and the soft sky rim on every PBR surface)
    "  nightC += vec3(0.82, 0.9, 1.12) * uMap2.w * uEnv * (0.7 + 0.6 * (1.0 - smoothstep(0.0, 0.45, h)));",
    // the probe only (above): starlight and airglow as ambient fill
    "  if (uNightK.y > 0.0 && uTele.x < 0.5) { vec3 M0 = normalize(uMoonDir); float cm = max(dot(d, M0), 0.0); nightC += (vec3(0.016, 0.03, 0.068) * (0.7 + 0.5 * (1.0 - smoothstep(0.0, 0.5, h))) + vec3(0.05, 0.058, 0.07) * (pow(cm, 12.0) * 0.5 + pow(cm, 120.0) * 1.2)) * uNightK.y; }",
    // the stars and the Milky Way (not in the light probe): extinction and reddening by airmass, faded at the horizon
    "  float nk = kNight * (1.0 - uStorm * 0.9) * uNightK.x; vec3 bgS = vec3(0.0);",
    "  if (nk > 0.001 && uEnv < 0.5) { vec3 e = normalize(uW2E * d);",
    "    float altD = degrees(asin(clamp(d.y, -1.0, 1.0))); float X = 1.0 / (max(d.y, 0.0) + 0.50572 * pow(max(altD + 6.07995, 0.5), -1.6364)); vec3 ext = exp(-vec3(0.07, 0.11, 0.2) * (min(X, 40.0) - 1.0)) * smoothstep(-0.012, 0.035, d.y);",
    "    vec3 mw = vec3(0.0); float L = 0.0; if (uMap.x > 0.001) mw = skyMap(e, L) * uMap.x; if (uMap.x < 0.999) mw += milkyP(e) * (1.0 - uMap.x);",
    "    vec3 st = vec3(0.0); if (uMap2.y > 0.001) st += stars(e, 190.0, 0.991) * uMap2.y; if (uTele.x > 0.5 && uTele.z > 1.0) st += stars(e, uTele.z, 1.0 - clamp(0.1 + 2.5 * L, 0.1, 0.55)) * 0.7;",
    "    bgS = (mw + st) * ext * nk; if (uZodi.w > 0.0) bgS += vec3(1.0, 0.93, 0.82) * zodi(d) * uZodi.w * ext * nk; nightC += bgS; if (uMetB[0].w + uMetB[1].w > 0.0) nightC += meteors(d) * ext * kNight * (1.0 - uStorm); }",
    "  vec3 sky = dayC * (1.0 - tw) + twC * tw; sky = mix(sky, nightC, kNight);",
    // the Moon at its real place: a lit sphere with the NASA LRO albedo, the phase from the real Sun, earthshine on the dark side, a halo
    "  { vec3 M = normalize(uMoonDir); float md = dot(d, M); float mr = uMoonP.x; float mvis = uMoonP.z * (1.0 - uStorm * 0.95); if (mvis > 0.001 && md > cos(min(mr * 9.0, 1.5))) { float ang = acos(clamp(md, -1.0, 1.0));",
    "      if (uEnv < 0.5) sky += uMoonTint * (exp(-ang / (mr * 1.7)) * 0.05 + exp(-ang / (mr * 7.0)) * 0.012) * uMoonP.y * mvis * (1.0 - 0.9 * uTele.x);",
    "      if (ang < mr * 1.05) { vec3 Np = normalize(uMoonN - M * dot(uMoonN, M)); vec3 Lx = cross(M, Np); vec2 q = vec2(dot(d, Lx), dot(d, Np)) / mr; float q2 = dot(q, q);",
    "        if (q2 < 1.0) { float z = sqrt(1.0 - q2); vec3 n = Lx * q.x + Np * q.y - M * z; float lat = asin(clamp(q.y, -1.0, 1.0)); float lon = atan(q.x, z);",
    "          float alb = texture2D(tMoon, vec2(0.5 + lon * 0.15915494, 0.5 - lat * 0.31830989)).g; alb = pow(alb, 1.55) * 1.5; float mu = dot(n, normalize(uMoonSun));",
    "          float lit = smoothstep(-0.015, 0.05, mu) * (0.8 + 0.2 * sqrt(max(mu, 0.0))); float pxm = max(length(fwidth(d)), 1e-7);",
    "          vec3 moon = vec3(1.0, 0.97, 0.92) * alb * (lit * uMoonP.w + 0.014 * (1.0 - uMoonP.y)); float mX = 1.0 / (max(M.y, 0.0) + 0.50572 * pow(max(degrees(asin(clamp(M.y, -1.0, 1.0))) + 6.07995, 0.5), -1.6364)); moon *= exp(-vec3(0.06, 0.12, 0.24) * (min(mX, 30.0) - 1.0) * (1.0 - uTele.x * 0.6)); float edge = smoothstep(1.0, max(0.0, 1.0 - 1.6 * pxm / mr), sqrt(q2));",
    "          sky = mix(sky, max(sky - bgS * kNight, vec3(0.0)) + moon, edge * mvis); } } } }",
    // R5: the 22 degree halo round the Moon on humid nights (ice crystals: red inside, a whiter blue outside), and a wider aureole
    "  if (uSkyX.x > 0.001) { float hd2 = degrees(acos(clamp(dot(d, normalize(uMoonDir)), -1.0, 1.0))); float ring = exp(-pow((hd2 - 22.2) / 1.0, 2.0)) * (0.35 + 0.65 * smoothstep(21.0, 22.0, hd2));",
    "    vec3 hc = mix(vec3(1.0, 0.78, 0.62), vec3(0.82, 0.9, 1.08), smoothstep(21.6, 23.6, hd2)); sky += (hc * ring + vec3(0.7, 0.75, 0.85) * 0.25 * exp(-hd2 / 9.0)) * uSkyX.x * (1.0 - uStorm) * (1.0 - uEnv * 0.5); }",
    // the sun disc and its glow (bounded, as before: the bloom and flare were tuned to it)
    "  float sd = max(dot(d, s), 0.0); sky += sunCol * glow * (1.0 - uStorm * 0.97) * (pow(sd, 900.0) * 2.6 + pow(sd, 60.0) * 0.18 * (1.0 - smoothstep(0.1, 0.5, sy)) + pow(sd, 8.0) * 0.12);",
    // the monsoon: a slate deck, lighter toward the horizon, a brighter rim away from the storm, lightning lights the deck
    "  if (uStorm > 0.001) { float tS = dot(dh, normalize(uFlashDir)) * 0.5 + 0.5; float rim = smoothstep(0.55, 0.1, tS) * (1.0 - smoothstep(0.0, 0.3, h)); vec3 deck = uStormCol * (0.55 + 0.6 * (1.0 - smoothstep(0.0, 0.5, h))) * mix(1.6, 0.8, tS) + uStormCol * rim * 2.5;",
    "    float n = gNoise(vec2(atan(d.z, d.x) * 6.0, h * 9.0) + uTime * 0.02) * 0.5 + gNoise(vec2(atan(d.z, d.x) * 17.0, h * 25.0) - uTime * 0.03) * 0.5; deck *= 0.82 + 0.3 * n;",
    "    sky = mix(sky, deck, uStorm * mix(0.6, 0.97, smoothstep(0.2, 0.75, tS))); sky += vec3(0.75, 0.8, 1.0) * uFlash * (0.25 + 0.75 * pow(max(0.0, dot(d, normalize(uFlashDir + vec3(0.0, 0.25, 0.0)))), 6.0)) * uStorm; }",
    "  if (uEnv > 0.5) { float l = dot(sky, vec3(0.2126, 0.7152, 0.0722)); sky = mix(sky, vec3(l), uKnee.z); }",
    "  sky *= 1.0 + (gHash(gl_FragCoord.xy) - 0.5) * uMap4.z * kNight; if (uEnv < 0.5 && uTele.x < 0.5) sky *= uSkyX.z;",
    "  gl_FragColor = vec4(max(sky, vec3(0.0)), 1.0); }"
  ].join("\n");
  // the view direction from the camera (the dome is centred on the world origin, kilometres from the player: no parallax on the stars)
  var SKY_VERT = "varying vec3 vDir; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vDir = w.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * w; }";

  // CPU copy of the scattering (fog / haze colour, the eye-adapted scale)
  function preethamCPU(d, s, K) {
    var sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(clamp(s[1], -1, 1))) / 1.5)));
    var bR = [5.804542996261093E-6 * K[1], 1.3562911419845635E-5 * K[1], 3.0265902468824876E-5 * K[1]];
    var c = 0.434 * 0.2 * K[0] * 10E-18 * K[2]; var bM = [1.8399918514433978E14 * c, 2.7798023919660528E14 * c, 4.0790479543861094E14 * c];
    var zen = Math.acos(Math.max(0, d[1])); var inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - zen * 180 / Math.PI, -1.253));
    var cosT = d[0] * s[0] + d[1] * s[1] + d[2] * s[2]; var rP = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
    var g = K[3], g2 = g * g; var mP = 0.07957747154594767 * (1 - g2) / Math.pow(Math.max(1e-4, 1 - 2 * g * cosT + g2), 1.5); var out = [0, 0, 0];
    for (var i = 0; i < 3; i++) { var Fex = Math.exp(-(bR[i] * 8.4E3 * inv + bM[i] * 1.25E3 * inv)); var rr = (bR[i] * rP + bM[i] * mP) / (bR[i] + bM[i]); var Lin = Math.pow(sunE * rr * (1 - Fex), 1.5); Lin *= 1 + (Math.pow(sunE * rr * Fex, 0.5) - 1) * clamp(Math.pow(1 - s[1], 5), 0, 1); out[i] = (Lin + 0.1 * Fex) * 0.04 + [0, 0.0003, 0.00075][i]; }
    return out;
  }
  function lum(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function kneeCPU(c) { var k = GX.K, l = lum(c); if (l <= k.skyKnee) return c; var l2 = k.skyKnee + (k.skyCap - k.skyKnee) * (1 - Math.exp(-(l - k.skyKnee) / (k.skyCap - k.skyKnee))); return [c[0] * l2 / l, c[1] * l2 / l, c[2] * l2 / l]; }

  function installSky() {
    if (typeof skyMat === "undefined") return;
    if (!ORIG.skyFrag) ORIG.skyFrag = skyMat.fragmentShader;
    var U = skyMat.uniforms;
    U.uMoonDir = { value: new THREE.Vector3(-0.55, 0.62, 0) }; U.uStorm = { value: 0 }; U.uFlash = { value: 0 }; U.uTime = { value: 0 }; U.uSkyK = { value: new THREE.Vector4().fromArray(GX.K.sky) };
    U.uSkyExpo = { value: GX.K.skyExpo }; U.uKnee = { value: new THREE.Vector3(GX.K.skyKnee, GX.K.skyCap, GX.K.envDesat) }; U.uEnv = { value: 0 }; U.uStormCol = { value: new THREE.Color(0.2, 0.22, 0.26) }; U.uFlashDir = { value: new THREE.Vector3(0.55, 0, 0.83) }; U.uGfx = { value: 1 };
    skInstallUniforms(); if (!ORIG.skyVert) ORIG.skyVert = skyMat.vertexShader;
    skyMat.fragmentShader = SKY_FRAG; skyMat.vertexShader = SKY_VERT; skyMat.needsUpdate = true;
    // the probe renders the sky too: a slightly desaturated, eye-adapted copy lights the world (uEnv), then the flag drops again
    if (!ORIG.updateEnvironment) ORIG.updateEnvironment = updateEnvironment;
    var ue = ORIG.updateEnvironment;
    updateEnvironment = function (now, force) { var U2 = skyMat.uniforms; if (U2.uEnv) U2.uEnv.value = 1; try { return ue(now, force); } finally { if (U2.uEnv) U2.uEnv.value = 0; } };
    // the old star points are drawn in the sky shader now (2 draws saved)
    try { stars.visible = false; stars2.visible = false; } catch (e) {}
    GX.n.sky = 1;
    try { skInstall(); } catch (e) { skNote("install", e); }
  }
  function uninstallSky() {
    if (typeof skyMat === "undefined" || !ORIG.skyFrag) return;
    skyMat.fragmentShader = ORIG.skyFrag; if (ORIG.skyVert) skyMat.vertexShader = ORIG.skyVert; skyMat.needsUpdate = true; try { skUninstall(); } catch (e) {}
    if (ORIG.updateEnvironment) updateEnvironment = ORIG.updateEnvironment;
    try { stars.visible = true; stars2.visible = true; } catch (e) {}
  }

  // ═════════════════════════ clouds: every cumulus, storm cell, rain shaft and dust front in ONE instanced draw ═════════════════════════
  function noiseTexture() {
    var S = 128, data = new Uint8Array(S * S * 4); var oct = [4, 8, 16, 32];
    for (var c = 0; c < 4; c++) { var n = oct[c], g = new Float32Array(n * n); for (var i = 0; i < n * n; i++) g[i] = hash1(i * 7.31 + c * 101.7);
      for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) { var fx = x / S * n, fy = y / S * n, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        var s = function (a, b) { return g[((b % n) + n) % n * n + ((a % n) + n) % n]; }; var v = (s(x0, y0) * (1 - tx) + s(x0 + 1, y0) * tx) * (1 - ty) + (s(x0, y0 + 1) * (1 - tx) + s(x0 + 1, y0 + 1) * tx) * ty; data[(y * S + x) * 4 + c] = Math.round(v * 255); } }
    var t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
  }
  var CLOUD_VERT = [
    "attribute vec4 iPos; attribute vec4 iSz; uniform vec2 uDrift; varying vec2 vUv; varying vec4 vI; varying vec3 vB0; varying vec3 vB1; varying vec3 vB2; varying float vDist; varying float vH;",
    "void main(){ vec3 c = iPos.xyz; if (iPos.w < 0.5) { c.x = mod(c.x + uDrift.x + 30000.0, 60000.0) - 30000.0; } vec3 toC = c - cameraPosition; float dist = length(toC); vec3 F = toC / max(dist, 1.0);",
    "  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]); vec3 U = normalize(mix(vec3(0.0, 1.0, 0.0) - F * F.y, camUp, smoothstep(0.82, 0.97, abs(F.y)))); if (iPos.w > 1.5) U = vec3(0.0, 1.0, 0.0);",
    "  vec3 R = normalize(cross(F, U)); vec3 wp = c + R * position.x * iSz.x + U * (position.y + (iPos.w > 1.5 ? 0.5 : 0.0)) * iSz.y;",
    "  vUv = uv; vI = vec4(iPos.w, iSz.z, iSz.w, iSz.x / max(iSz.y, 1.0)); vB0 = R; vB1 = U; vB2 = -F; vDist = dist; vH = wp.y;",
    "  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }"
  ].join("\n");
  var CLOUD_FRAG = [
    "uniform sampler2D tNoise; uniform vec3 uLDir; uniform vec3 uLCol; uniform vec3 uAmbT; uniform vec3 uAmbB; uniform vec3 uHaze; uniform float uHazeK; uniform float uDay; uniform float uStorm; uniform float uFlash; uniform vec3 uFlashP; uniform float uTime; uniform float uGust; uniform vec3 uStormCol; uniform vec3 uSDir; uniform float uFadeK;",
    "varying vec2 vUv; varying vec4 vI; varying vec3 vB0; varying vec3 vB1; varying vec3 vB2; varying float vDist; varying float vH;",
    GLSL_NOISE,
    "float nz(vec2 p){ return texture2D(tNoise, p).r; } float nz2(vec2 p){ return texture2D(tNoise, p).g; } float nz3(vec2 p){ return texture2D(tNoise, p).b; }",
    "void main(){ float type = vI.x, seed = vI.y, alphaI = vI.z, asp = vI.w; vec2 q = vUv * 2.0 - 1.0; vec3 sb = vec3(dot(uLDir, vB0), dot(uLDir, vB1), dot(uLDir, vB2));",
    "  vec3 col; float a;",
    "  if (type < 0.5) {",
    // cumulus: a union of puffs, eroded by noise, a flat base; lit from the blended puff normals
    "    vec2 p = vec2(q.x * asp, q.y); float dmax = 0.0, wsum = 0.0; vec3 nsum = vec3(0.0);",
    "    for (int k = 0; k < PUFFS; k++) { float fk = float(k); float h1 = fract(sin(seed * 12.9 + fk * 78.2) * 43758.5), h2 = fract(sin(seed * 39.3 + fk * 11.7) * 24634.6), h3 = fract(sin(seed * 5.7 + fk * 91.1) * 9876.5);",
    "      float xx = (fk / float(PUFFS - 1) * 2.0 - 1.0) * asp * 0.7 + (h1 - 0.5) * 0.3; float cx = xx / (asp * 0.8); float r = 0.3 + 0.32 * (1.0 - cx * cx) * (0.6 + 0.4 * h2); vec2 cc = vec2(xx, -0.52 + r * (0.7 + 0.3 * h3));",
    "      vec2 dq = (p - cc) / r; float dd = 1.0 - dot(dq, dq); if (dd > 0.0) { float w = dd * dd; nsum += w * vec3(dq, sqrt(dd)); wsum += w; } dmax = max(dmax, dd); }",
    "    vec3 n = wsum > 0.0 ? normalize(nsum) : vec3(0.0, 0.0, 1.0);",
    "    vec2 np = p * 0.3 + vec2(seed * 3.1, seed * 1.7); float b1 = nz(np), b2 = nz2(np * 1.9 + 0.3), b3 = nz3(np * 3.7 + uTime * 0.0015); float er = (b1 - 0.5) * 0.52 + (b2 - 0.5) * 0.34 + (b3 - 0.5) * 0.12;",
    "    float dens = dmax + er * (0.4 + 0.5 * (1.0 - dmax)); dens *= smoothstep(-0.98, -0.8, q.y) * smoothstep(1.0, 0.84, abs(q.x)) * smoothstep(1.0, 0.86, q.y) * smoothstep(-0.6, -0.46, p.y + er * 0.1);",
    "    a = smoothstep(0.0, 0.42, dens) * alphaI; if (a < 0.003) discard;",
    "    n = normalize(n + vec3(b2 - 0.5, b3 - 0.5, 0.0) * 0.7 * (1.0 - 0.5 * clamp(dmax, 0.0, 1.0)));",
    "    float wrapD = clamp(dot(n, sb) * 0.5 + 0.5, 0.0, 1.0); float hgt = clamp(q.y * 0.5 + 0.5, 0.0, 1.0); float base = mix(0.5, 1.0, smoothstep(0.0, 0.6, hgt)) * (0.8 + 0.2 * clamp(dmax, 0.0, 1.0));",
    "    float rim = pow(1.0 - smoothstep(0.0, 0.3, dens), 2.0) * pow(max(0.0, -sb.z), 4.0) * 1.1;",
    "    vec3 amb = mix(uAmbB, uAmbT, clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * base;",
    "    col = amb + uLCol * (wrapD * mix(0.7, 1.0, hgt) + rim) * uDay;",
    "    float tws = dot(normalize(-vB2.xz + 1e-5), normalize(uSDir.xz + 1e-5)); col = mix(col, uStormCol * mix(0.8, 1.6, hgt) + uLCol * wrapD * 0.1, uStorm * mix(0.62, 0.9, smoothstep(-0.3, 0.6, tws))); col += vec3(0.7, 0.75, 0.9) * uFlash * uStorm * 0.3;",
    "  } else if (type < 1.5) {",
    // storm cell (cumulonimbus): a flat dark base, a billowing column, a wide anvil; the lit side faces the sun, lightning glows inside
    "    vec2 p = vec2(q.x * asp, q.y); float y = q.y; vec2 np = p * 0.35 + vec2(seed * 2.3, seed * 1.1); float b1 = nz(np), b2 = nz2(np * 2.1 + 0.7), b3 = nz3(np * 4.3 + uTime * 0.001);",
    "    float er = (b1 - 0.5) * 0.55 + (b2 - 0.5) * 0.3 + (b3 - 0.5) * 0.18; float aT = smoothstep(0.3, 0.55, y);",
    "    float W = mix(asp * (0.5 + 0.08 * sin(y * 5.0 + seed)) + 0.12 * (1.0 - smoothstep(-0.9, 0.0, y)), asp * (0.9 + 0.08 * b1), aT) * (1.0 + er * 0.3);",
    "    float hx = abs(p.x) / max(W, 0.05); float top = 0.7 + 0.08 * b2; float vert = smoothstep(-0.95, -0.84, y + er * 0.03) * smoothstep(top, top - 0.1 - 0.08 * aT, y);",
    "    float dens = (1.0 - hx * hx) * vert + er * 0.35 * vert; a = smoothstep(0.0, 0.85, dens) * smoothstep(-1.0, -0.5, y) * alphaI * uStorm * 0.85; if (a < 0.003) discard;",
    "    vec3 n = normalize(vec3(clamp(p.x / max(W, 0.05), -1.0, 1.0) * 0.9 + (b2 - 0.5) * 0.8, (y - 0.25) * 0.8 + (b3 - 0.5) * 0.6, sqrt(max(0.05, 1.0 - hx * hx))));",
    "    float hgt = clamp(y * 0.5 + 0.5, 0.0, 1.0); float lit = clamp(dot(n, sb) * 0.6 + 0.4, 0.0, 1.0);",
    "    col = uStormCol * mix(0.75, 1.3, smoothstep(0.1, 0.9, hgt)) * (0.9 + 0.2 * b2) + uLCol * lit * lit * mix(0.02, 0.28, smoothstep(0.4, 0.95, hgt)) * uDay;",
    "    vec3 wp = cameraPosition - vB2 * vDist; float fd = length(wp.xz - uFlashP.xz); col += vec3(0.78, 0.84, 1.0) * uFlash * (0.3 + 1.2 * (1.0 - hgt)) * smoothstep(0.2, 0.8, dens) * (0.6 + 0.4 * b3) * exp(-fd / 3500.0);",
    "  } else if (type < 2.5) {",
    // rain shaft: streaks falling out of the base, soft sides, fading into the ground
    "    float prof = exp(-q.x * q.x * 2.2); float st = nz(vec2(q.x * 3.5 + seed, q.y * 0.35 + uTime * 0.09)) * 0.6 + nz2(vec2(q.x * 9.0 + seed * 2.0, q.y * 0.9 + uTime * 0.23)) * 0.4;",
    "    float vert = smoothstep(1.0, 0.62, q.y) * smoothstep(-1.0, -0.55, q.y); float drift = (nz3(vec2(seed, q.y * 0.3 + uTime * 0.01)) - 0.5) * 0.4;",
    "    a = prof * vert * (0.45 + 0.55 * smoothstep(0.2, 0.75, st + drift * 0.3)) * 0.85 * alphaI * uStorm; if (a < 0.003) discard;",
    "    col = uStormCol * 0.75 + uLCol * pow(max(0.0, -sb.z), 3.0) * 0.3 * uDay + vec3(0.7, 0.75, 0.9) * uFlash * 0.5;",
    "  } else {",
    // dust front (haboob): a low, heavy wall of desert dust rolling ahead of the outflow
    "    vec2 p = vec2(q.x * asp * 0.3, q.y); float n1 = nz(p * 0.5 + vec2(seed + uTime * 0.004, 0.0)) * 0.6 + nz2(p * 1.3 + vec2(-uTime * 0.007, seed)) * 0.4;",
    "    float prof = smoothstep(1.0, 0.7, abs(q.x)) * (1.0 - smoothstep(-0.2 + n1 * 0.9, 0.75, q.y)) * smoothstep(-1.0, -0.85, q.y);",
    "    a = prof * smoothstep(0.2, 0.7, n1 + 0.15) * 0.8 * alphaI * uStorm * uGust; if (a < 0.003) discard;",
    "    col = vec3(0.62, 0.48, 0.34) * (uAmbT * 0.5 + uLCol * 0.55 * uDay * (0.6 + 0.4 * clamp(sb.y + 0.5, 0.0, 1.0)));",
    "  }",
    "  float hz = 1.0 - exp(-vDist * uHazeK); col = mix(col, uHaze, hz * (type > 2.5 ? 0.5 : type > 0.5 ? 0.3 : 0.85)); a *= 1.0 - smoothstep(26000.0, 36000.0, vDist); if (type < 0.5) a *= mix(0.55, 1.0, uDay) * (1.0 - 0.45 * uStorm);",
    "  gl_FragColor = vec4(col, a * uFadeK); }"
  ].join("\n");

  var CL = null;
  function installClouds() {
    if (typeof DETAILS === "undefined" || typeof scene === "undefined") return;
    var nC = GX.K.cloudN, nS = GX.K.stormCells, nR = GX.K.rainN, nD = GX.K.dustN, N = nC + nS + nR + nD;
    var base = new THREE.PlaneGeometry(1, 1); var geo = new THREE.InstancedBufferGeometry(); geo.index = base.index; geo.setAttribute("position", base.attributes.position); geo.setAttribute("uv", base.attributes.uv);
    var pos = new Float32Array(N * 4), sz = new Float32Array(N * 4), list = []; var r = 0.5;
    function rnd() { r = hash1(r * 91.3 + 17.1); return r; }
    // fair-weather cumulus: a loose ring round the basin, thicker over the ranges (east and south-east), a few near
    for (var i = 0; i < nC; i++) { var ang = rnd() * 6.283, dist = 3000 + Math.pow(rnd(), 0.7) * 25000; var w = 1100 + rnd() * 2100; var hgt = w * (0.42 + rnd() * 0.22); list.push({ p: [Math.cos(ang) * dist, 2300 + rnd() * 1500 + hgt * 0.35, Math.sin(ang) * dist], t: 0, w: w, h: hgt, seed: rnd() * 97, a: 0.82 + rnd() * 0.18 }); }
    GX.storm.cells = [];
    for (var j = 0; j < nS; j++) { var sh = 7000 + rnd() * 3500; list.push({ p: [0, 0, 0], t: 1, w: sh * (1.0 + rnd() * 0.45), h: sh, seed: rnd() * 97, a: 1, cell: j, off: [((j + 0.5) / nS - 0.5) * 30000 + (rnd() - 0.5) * 2500, (rnd() - 0.5) * 9000] }); }
    for (var k = 0; k < nR; k++) { list.push({ p: [0, 0, 0], t: 2, w: 1300 + rnd() * 1700, h: 2600, seed: rnd() * 97, a: 0.6 + rnd() * 0.4, cell: k % nS }); }
    for (var q = 0; q < nD; q++) { list.push({ p: [0, 0, 0], t: 3, w: 4000 + rnd() * 3000, h: 420 + rnd() * 260, seed: rnd() * 97, a: 1, off: [(q - nD / 2) * 3600 + (rnd() - 0.5) * 1500, rnd() * 1800] }); }
    geo.setAttribute("iPos", new THREE.InstancedBufferAttribute(pos, 4)); geo.setAttribute("iSz", new THREE.InstancedBufferAttribute(sz, 4)); geo.attributes.iPos.setUsage(THREE.DynamicDrawUsage); geo.attributes.iSz.setUsage(THREE.DynamicDrawUsage); geo.instanceCount = N;
    var mat = new THREE.ShaderMaterial({ uniforms: { tNoise: { value: noiseTexture() }, uLDir: { value: new THREE.Vector3(0, 1, 0) }, uLCol: { value: new THREE.Color(1, 1, 1) }, uAmbT: { value: new THREE.Color(0.5, 0.6, 0.75) }, uAmbB: { value: new THREE.Color(0.35, 0.36, 0.4) }, uHaze: { value: new THREE.Color(0.8, 0.8, 0.8) }, uHazeK: { value: 0.00004 }, uDay: { value: 1 }, uStorm: { value: 0 }, uFlash: { value: 0 }, uFlashP: { value: new THREE.Vector3() }, uTime: { value: 0 }, uGust: { value: 0 }, uStormCol: { value: new THREE.Color(0.2, 0.22, 0.26) }, uSDir: { value: new THREE.Vector3(1, 0, 0) }, uDrift: { value: new THREE.Vector2() } },
      defines: { PUFFS: GX.bootTier >= 1 ? 7 : 5 }, vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false, depthTest: true, fog: false, side: THREE.DoubleSide });
    mat.uniforms.uFadeK = { value: 1 };
    var mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = -1; mesh.userData.noCull = true; mesh.userData.noShadow = true; mesh.name = "gfx_clouds";
    CL = { mesh: mesh, list: list, pos: pos, sz: sz, N: N, drift: 0, sortAt: 0, camAt: new THREE.Vector3(1e9, 0, 0) };
    // the 70 sprite billboards go away (the client loop over DETAILS.cumulus sees an empty list)
    ORIG.cumulus = ORIG.cumulus || DETAILS.cumulus; for (var s = 0; s < ORIG.cumulus.length; s++) ORIG.cumulus[s].visible = false; DETAILS.cumulus = [];
    scene.add(mesh); GX.obj.clouds = mesh; placeStormObjects(); writeClouds(true); GX.n.clouds = N;
  }
  function uninstallClouds() {
    if (!CL) return; if (CL.mesh.parent) CL.mesh.parent.remove(CL.mesh); CL.mesh.geometry.dispose(); CL.mesh.material.dispose(); CL = null;
    if (ORIG.cumulus && typeof DETAILS !== "undefined") { for (var s = 0; s < ORIG.cumulus.length; s++) ORIG.cumulus[s].visible = true; DETAILS.cumulus = ORIG.cumulus; }
  }
  // storm cells, rain shafts and the dust front sit round the storm centre (the storm's bearing is fixed for the day)
  function placeStormObjects() {
    if (!CL) return; var sd = GX.storm.dir, cx = sd[0], cz = sd[2]; var px = -cz, pz = cx; var D0 = 21000;
    var gh = function (x, z) { try { return getH(x, z); } catch (e) { return 1200; } };
    var cells = [];
    for (var i = 0; i < CL.list.length; i++) { var e = CL.list[i];
      if (e.t === 1) { var along = D0 + e.off[1], lat = e.off[0]; var x = cx * along + px * lat, z = cz * along + pz * lat; e.p = [x, Math.max(0, gh(x, z)) + 1600 + e.h * 0.5, z]; cells[e.cell] = e; }
    }
    for (var k = 0; k < CL.list.length; k++) { var r = CL.list[k];
      if (r.t === 2) { var c = cells[r.cell]; if (!c) continue; var ox = (hash1(r.seed) - 0.5) * c.w * 0.7, x2 = c.p[0] + px * ox, z2 = c.p[2] + pz * ox; var g = Math.max(0, gh(x2, z2)); var top = c.p[1] - c.h * 0.5 + 250; r.p = [x2, g - 60, z2]; r.h = Math.max(600, top - g + 60); }
      if (r.t === 3) { var al = 6200 + r.off[1], la = r.off[0]; var x3 = cx * al + px * la, z3 = cz * al + pz * la; r.p = [x3, Math.max(0, gh(x3, z3)) - 30, z3]; }
    }
    GX.storm.cellsAt = cells.map(function (c) { return c ? c.p.slice() : null; });
  }
  function writeClouds(force) {
    if (!CL) return; var cam = camera.position; var now = performance.now();
    if (!force && now - CL.sortAt < 400 && CL.camAt.distanceToSquared(cam) < 250000) return; CL.sortAt = now; CL.camAt.copy(cam);
    var L = CL.list, idx = []; for (var i = 0; i < L.length; i++) { var e = L[i]; var x = e.t === 0 ? ((e.p[0] + CL.drift + 30000) % 60000 + 60000) % 60000 - 30000 : e.p[0]; var dx = x - cam.x, dy = e.p[1] - cam.y, dz = e.p[2] - cam.z; idx.push([dx * dx + dy * dy + dz * dz, i]); }
    idx.sort(function (a, b) { return b[0] - a[0]; });
    for (var k = 0; k < idx.length; k++) { var e2 = L[idx[k][1]]; CL.pos[k * 4] = e2.p[0]; CL.pos[k * 4 + 1] = e2.p[1]; CL.pos[k * 4 + 2] = e2.p[2]; CL.pos[k * 4 + 3] = e2.t; CL.sz[k * 4] = e2.w; CL.sz[k * 4 + 1] = e2.h; CL.sz[k * 4 + 2] = e2.seed; CL.sz[k * 4 + 3] = e2.a; }
    var g = CL.mesh.geometry; g.attributes.iPos.needsUpdate = true; g.attributes.iSz.needsUpdate = true;
  }

  // ═════════════════════════ the day: storm schedule, sky, light, grading (runs right after the client's updateSky) ═════════════════════════
  var TMP = { c: null, v: null };
  function stormLevel() {
    var st = GX.storm; if (st.force !== null && st.force !== undefined) return st.force;
    var tAbs = Date.now() / 1000 + timeOffset; var day = Math.floor(tAbs / DAY_SECONDS); var t = tAbs / DAY_SECONDS - day;
    if (st.day !== day) { st.day = day; st.today = hash1(day * 1.618 + 0.3) < 0.38; st.start = (13.4 + hash1(day * 3.7 + 1.1) * 2.6) / 24; st.len = (1.3 + hash1(day * 5.3 + 2.9) * 1.3) / 24; var az = 0.35 + hash1(day * 7.1 + 0.7) * 1.4; st.dir = [Math.cos(az), 0, Math.sin(az)]; placeStormObjects(); }
    if (!st.today) return 0; var ramp = 0.35 / 24; return sstep(st.start, st.start + ramp, t) * (1 - sstep(st.start + st.len - ramp, st.start + st.len, t));
  }
  // grading keyframes: [sat, contrast, shadow tint rgb, highlight tint rgb, white balance rgb, lift, dark saturation, contrast pivot]
  // R15: the contrast pivoted on 0.5 in display-linear light subtracted (contrast - 1) x 0.5 from every pixel: at night and in the
  // blue hour that crushed everything under 37 to 46 of 255 to black (the "far too dark" night). After sunset the pivot moves down
  // to the night's own mid level (K.sk.twPiv, K.sk.nightPiv); by day it is 0.5 as before (the day is unchanged)
  var GR = {
    noon: [1.14, 1.08, [0.95, 0.98, 1.06], [1.05, 1.0, 0.95], [1.02, 1.0, 0.98], 0.0, 1.14, 0.5],
    day: [1.12, 1.09, [0.93, 0.97, 1.08], [1.06, 1.0, 0.93], [1.02, 1.0, 0.98], 0.0, 1.12, 0.5],
    golden: [1.16, 1.1, [0.91, 0.94, 1.08], [1.08, 1.0, 0.88], [1.05, 1.0, 0.93], 0.0, 1.16, 0.5],
    blue: [1.04, 1.06, [0.86, 0.94, 1.16], [1.02, 0.98, 1.02], [0.92, 0.97, 1.1], 0.004, 0.9, 0.3],
    night: [1.08, 1.04, [0.9, 0.97, 1.12], [1.02, 1.0, 0.98], [0.94, 0.98, 1.06], 0.007, 0.72, 0.28],
    storm: [0.82, 1.05, [0.92, 0.97, 1.06], [1.0, 1.0, 1.0], [0.95, 0.99, 1.04], 0.003, 0.78, 0.5]
  };
  function lerpG(a, b, t) { var o = []; for (var i = 0; i < a.length; i++) { if (Array.isArray(a[i])) { o.push([mix(a[i][0], b[i][0], t), mix(a[i][1], b[i][1], t), mix(a[i][2], b[i][2], t)]); } else o.push(mix(a[i], b[i], t)); } return o; }
  function gradeFor(el, am, S) {
    var g;
    if (el > 0.55) g = GR.noon; else if (el > 0.22) g = lerpG(GR.day, GR.noon, sstep(0.22, 0.55, el)); else if (el > -0.02) g = lerpG(GR.golden, GR.day, sstep(-0.02, 0.22, el)); else if (el > -0.2) g = lerpG(GR.blue, GR.golden, sstep(-0.2, -0.02, el)); else g = lerpG(GR.night, GR.blue, sstep(-0.42, -0.2, el));
    if (am && el > -0.05) g = lerpG(g, GR.day, 0.35 * (1 - sstep(0.3, 0.6, el)));   // mornings are cleaner and cooler than evenings
    if (S > 0) g = lerpG(g, GR.storm, S * 0.85);
    return g;
  }
  var ST = { lastT: 0, flashT: 0, flashes: [], nextStrike: 0, gustPh: 0 };
  // the client's lights report intensity x PI (legacy scale): scale the stored value, never the reported one
  function lscale(l, k, add) { var v = l._intensity === undefined ? 1 : l._intensity; l.intensity = v * k + (add || 0); }
  function afterSky(dt) {
    var t = dayT(), el = -Math.cos(t * 6.283), az = t * 6.283; var U = skyMat.uniforms; var now = performance.now();
    var sdir = [Math.cos(az), el, Math.sin(az) * 0.45]; var sl = Math.hypot(sdir[0], sdir[1], sdir[2]); sdir = [sdir[0] / sl, sdir[1] / sl, sdir[2] / sl];
    var mdir = [-Math.cos(az) * 0.55, 0.62, -Math.sin(az) * 0.45]; var ml = Math.hypot(mdir[0], mdir[1], mdir[2]); mdir = [mdir[0] / ml, mdir[1] / ml, mdir[2] / ml];
    var S = GX.storm.k = stormLevel(); var st = GX.storm;
    // gusts and lightning
    ST.gustPh += (dt || 0) * (0.35 + 0.4 * S); st.gust = S * clamp(0.45 + 0.55 * Math.sin(ST.gustPh) * Math.sin(ST.gustPh * 0.37 + 1.3), 0, 1);
    var flash = 0; if (S > 0.55 && now > ST.nextStrike) { ST.nextStrike = now + 3500 + Math.random() * 8000; ST.flashT = now; ST.pulses = [0, 90 + Math.random() * 60, 230 + Math.random() * 120]; strike(); }
    if (ST.pulses) { var e = now - ST.flashT; for (var i = 0; i < ST.pulses.length; i++) { var x = e - ST.pulses[i]; if (x >= 0 && x < 160) flash = Math.max(flash, (i === 0 ? 1 : 0.7) * Math.exp(-x / 45)); } if (e > 800) ST.pulses = null; }
    if (st.hold) { if (!BOLT || !BOLT.visible || !st.holdBolt) { strike(); st.holdBolt = true; } flash = st.hold; } else st.holdBolt = false;
    st.flash = flash * S;
    // sky uniforms
    var sd = st.dir; var sy = sdir[1];
    var zen = preethamCPU([0, 1, 0], sdir, GX.K.sky); var zl = Math.max(1e-4, lum(zen)); var ref = 0.6;
    var adapt = clamp(Math.pow(ref / zl, 0.62), 1, 14); var skyE = GX.K.skyExpo * adapt;
    U.uSkyExpo.value = skyE; U.uSkyK.value.fromArray(GX.K.sky); U.uKnee.value.set(GX.K.skyKnee, GX.K.skyCap, GX.K.envDesat); U.uMoonDir.value.fromArray(mdir); U.uStorm.value = S; U.uFlash.value = st.flash * 0.55; U.uTime.value = now / 1000; U.uFlashDir.value.set(sd[0], 0, sd[2]);
    var day = clamp((el + 0.12) / 0.4, 0, 1), nightK = 1 - day;
    U.uStormCol.value.setRGB(0.05 + 0.03 * day, 0.056 + 0.032 * day, 0.068 + 0.036 * day).multiplyScalar(0.3 + 0.7 * day);
    // horizon colour of the model (perpendicular to the sun, where the eye mostly looks): fog and aerial haze take it
    var ph = Math.hypot(sdir[0], sdir[2]) || 1; var pxh = -sdir[2] / ph, pzh = sdir[0] / ph; var dl = Math.hypot(pxh, 0.04, pzh);
    var hzA = kneeCPU(preethamCPU([pxh / dl, 0.04 / dl, pzh / dl], sdir, GX.K.sky).map(function (v) { return v * skyE; }));
    var hzB = kneeCPU(preethamCPU([-pxh / dl, 0.04 / dl, -pzh / dl], sdir, GX.K.sky).map(function (v) { return v * skyE; }));
    var hz = [(hzA[0] + hzB[0]) * 0.5, (hzA[1] + hzB[1]) * 0.5, (hzA[2] + hzB[2]) * 0.5];
    var tw = sstep(-0.34, -0.03, sy) * (1 - sstep(0.03, 0.2, sy));
    if (!TMP.c) { TMP.c = new THREE.Color(); TMP.c2 = new THREE.Color(); TMP.c3 = new THREE.Color(); TMP.c4 = new THREE.Color(); TMP.c5 = new THREE.Color(); TMP.v = new THREE.Vector3(); }
    var dayHz = TMP.c.setRGB(hz[0], hz[1], hz[2]);
    // keep the desert's warm dust in the low haze: a third of the client's art-directed ramp stays
    var old = TMP.c2.copy(scene.fog.color);
    var hazeDay = TMP.c3.copy(dayHz).lerp(old, 0.28 + 0.3 * tw);
    var wDay = day * (1 - tw * 0.6);
    var fogC = TMP.c4.copy(old).lerp(hazeDay, wDay);
    if (S > 0) fogC.lerp(TMP.c5.setRGB(0.3, 0.28, 0.25).multiplyScalar(0.35 + 0.65 * day), S * 0.8);
    scene.fog.color.copy(fogC);
    if (typeof POST !== "undefined" && POST.hazeCol) { POST.hazeCol.lerp(fogC, 0.85); if (S > 0) POST.sunCol.multiplyScalar(1 - 0.85 * S); }
    // R4: the real sky (matrices, the Moon, planets, meteors, stargazing); the real Moon lights the clouds
    try { skUpdate(dt || 0, el, S, U.kNight.value); if (SK.moon) mdir = SK.moon.dir; } catch (e) { if (!SK.upErr) { SK.upErr = 1; skNote("update", e); } }
    // light: the storm dims the key light and cools the fill; a strike lights everything for a moment
    var keyK = (1 - 0.78 * S) * (SK.keyDir ? SK.keyK : 1); var fl = st.flash;
    try { if (CSMX.on && CSMX.csm) { for (var li = 0; li < CSMX.csm.lights.length; li++) lscale(CSMX.csm.lights[li], keyK, 0); } else lscale(sun, keyK, 0); } catch (e) {}
    if (SK.keyDir) skKeyDir(SK.keyDir);
    lscale(hemi, (1 - 0.3 * S) * (SK.fillK || 1), fl * 0.45); if (S > 0) hemi.color.lerp(TMP.c.setRGB(0.66, 0.72, 0.82), S * 0.6); if (fl > 0) hemi.color.lerp(TMP.c.setRGB(0.85, 0.9, 1.0), clamp(fl, 0, 1));
    if (typeof POST !== "undefined") { POST.exposure *= 1 + fl * 0.15; }
    // R5: the eye adapts a little when the player looks up at a dark sky (the forward vector's height, smoothed over about a second)
    var inRoom = false; try { inRoom = typeof inside !== "undefined" && !!inside && !(SK.sg && SK.sg.on); } catch (e) {}
    try { var me = camera.matrixWorld.elements; var fy = -me[9]; var at = inRoom ? 1 : 1 + GX.K.sk.adaptUp * sstep(0.08, 0.75, fy) * (SK.dark || 0) * (1 - 0.8 * (SK.moonBright || 0)) * (1 - S);
      SK.adapt = SK.adapt === undefined ? at : SK.adapt + (at - SK.adapt) * Math.min(1, (dt || 0) / GX.K.sk.adaptT); if (typeof POST !== "undefined" && SK.adapt > 0 && SK.adapt < 3) POST.exposure *= SK.adapt; } catch (e) {}
    // R15: the eye's night adaptation, a gentle exposure lift once the night is dark (more on a moonless night, none in a room: the
    // interiors keep their own light); the sky's own brightness is held where it was (the sky shader divides its night by the lift)
    try { var nE = inRoom ? 1 : 1 + (mix(GX.K.sk.nightExpo, GX.K.sk.moonExpo, SK.moonBright || 0) - 1) * sstep(0.25, 1.0, U.kNight.value) * (1 - 0.7 * S);
      SK.nE = SK.nE === undefined ? nE : SK.nE + (nE - SK.nE) * Math.min(1, (dt || 0) / 0.6); if (typeof POST !== "undefined" && SK.nE > 0.5 && SK.nE < 2) POST.exposure *= SK.nE; } catch (e) {}
    // R7: a glazed interior (the Market Hall vault) can ask for less exposure by day: window.PLAN_EXPO_K() returns a factor (1 = none),
    // smoothed over 0.8 s and applied in proportion to daylight, so night is untouched
    try { var ik = typeof window.PLAN_EXPO_K === "function" ? +window.PLAN_EXPO_K() : 1; if (!(ik > 0.3 && ik <= 1.5)) ik = 1; SK.ik = SK.ik === undefined ? ik : SK.ik + (ik - SK.ik) * Math.min(1, (dt || 0) / 0.8);
      if (typeof POST !== "undefined" && SK.ik !== 1) POST.exposure *= 1 + (SK.ik - 1) * clamp(typeof day === "number" ? day : 1, 0, 1); } catch (e) {}
    try { cloudA.material.opacity = Math.min(0.95, cloudA.material.opacity + S * 0.4 * day); cloudB.material.opacity = Math.min(0.9, cloudB.material.opacity + S * 0.5 * day); cloudA.material.color.lerp(TMP.c.setRGB(0.16, 0.17, 0.19), S * 0.8); cloudB.material.color.copy(cloudA.material.color); } catch (e) {}
    // clouds: light, ambient and haze
    if (CL) { var cu = CL.mesh.material.uniforms; var lightDir = el > -0.04 ? sdir : mdir; cu.uLDir.value.fromArray(lightDir);
      var sc = sun.color; var sunUp = sstep(-0.06, 0.1, el); var goldK = sstep(0.35, 0.02, el) * sunUp;
      cu.uLCol.value.setRGB(1.0, 0.94 - 0.28 * goldK, 0.86 - 0.5 * goldK).multiplyScalar(0.85 * sunUp * (1 - 0.7 * S)); if (el <= -0.04) cu.uLCol.value.setRGB(0.045, 0.052, 0.07).multiplyScalar(nightK * (1 - S) * (1 + 7 * (SK.moonBright || 0)));
      cu.uAmbT.value.setRGB(zen[0], zen[1], zen[2]).multiplyScalar(skyE * 0.9).lerp(TMP.c.setRGB(0.55, 0.58, 0.64), 0.35); cu.uAmbT.value.multiplyScalar(0.35 + 0.65 * day);
      if (nightK > 0) cu.uAmbT.value.lerp(TMP.c.setRGB(0.012, 0.015, 0.024), nightK);
      if (tw > 0) cu.uAmbT.value.lerp(TMP.c.setRGB(0.26, 0.26, 0.38), tw * 0.5 * day);
      cu.uAmbB.value.copy(cu.uAmbT.value).multiplyScalar(0.62).lerp(TMP.c.setRGB(0.5, 0.42, 0.34).multiplyScalar(day), 0.25);
      cu.uHaze.value.copy(fogC); cu.uDay.value = 0.35 + 0.65 * day; cu.uStorm.value = S; cu.uFlash.value = st.flash; cu.uTime.value = now / 1000; cu.uGust.value = 0.35 + 0.65 * st.gust; cu.uStormCol.value.copy(U.uStormCol.value); cu.uSDir.value.set(sd[0], 0, sd[2]);
      CL.drift += (dt || 0) * 2.4; cu.uDrift.value.set(CL.drift, 0); }
    // grading
    GX.grade = gradeFor(el, t < 0.5, S);
    if (GX.post && GX.post.fin) { var F = POST.mFinal.uniforms; var G = GX.grade; F.uGSat.value = G[0]; F.uGSatLo.value = G[6] === undefined ? G[0] : G[6]; F.uGCon.value = G[1]; F.uGSh.value.fromArray(G[2]); F.uGHi.value.fromArray(G[3]); F.uGWB.value.fromArray(G[4]); F.uGLift.value = G[5]; if (F.uGPiv) F.uGPiv.value = G[7] === undefined ? 0.5 : G[7];
      F.uFlash.value = st.flash; }
    if (S > 0 && typeof POST !== "undefined" && POST.mFinal) { POST.mFinal.uniforms.uFog.value.x += 0.00035 * S * (0.4 + 0.6 * st.gust); POST.mFinal.uniforms.uHazeK.value += 0.00007 * S; }
    if (GX.post && GX.post.rays) { POST.mRays.uniforms.uGfxK.value = (1 + 0.9 * sstep(0.35, 0.05, el) * sstep(-0.05, 0.04, el)) * (1 - 0.9 * S); }
    st.el = el; st.sdir = sdir; st.day = st.day; GX.sun = { el: el, dir: sdir, moon: mdir, day: day, night: nightK, tw: tw };
    // medium tier: the single shadow map is fitted ahead of the camera and snapped to its texels (no swimming edges when walking)
    if (GX.tier === 1) fitShadow();
  }
  var FS = { m: null, inv: null, v: null };
  function fitShadow() {
    try { if (CSMX.on || !sun.castShadow || typeof player === "undefined" || !player) return; } catch (e) { return; }
    if (!FS.m) { FS.m = new THREE.Matrix4(); FS.inv = new THREE.Matrix4(); FS.v = new THREE.Vector3(); FS.f = new THREE.Vector3(); }
    var sc = sun.shadow.camera; var half = sc.right; var fwd = camera.getWorldDirection(FS.f); var fl = Math.hypot(fwd.x, fwd.z) || 1;
    var shift = half * 0.42; var tx = player.position.x + fwd.x / fl * shift, tz = player.position.z + fwd.z / fl * shift, ty = player.position.y;
    var dir = FS.v.copy(sun.position).sub(sun.target.position); var dl = dir.length(); if (dl < 1) return; dir.divideScalar(dl);
    // light-space basis; snap the target to whole texels
    FS.m.lookAt(new THREE.Vector3(0, 0, 0), dir.clone().negate(), new THREE.Vector3(0, 1, 0)); FS.inv.copy(FS.m).invert();
    var p = new THREE.Vector3(tx, ty, tz).applyMatrix4(FS.inv); var texel = (2 * half) / sun.shadow.mapSize.x; p.x = Math.floor(p.x / texel) * texel; p.y = Math.floor(p.y / texel) * texel; p.applyMatrix4(FS.m);
    sun.target.position.copy(p); sun.position.copy(p).addScaledVector(dir, dl); sun.target.updateMatrixWorld();
  }

  // ═════════════════════════ lightning ═════════════════════════
  var BOLT = null;
  function strike() {
    if (!BOLT) { var g = new THREE.BufferGeometry(); var m = new THREE.ShaderMaterial({ uniforms: { uA: { value: 0 } }, vertexShader: "attribute float aW; varying float vW; void main(){ vW = aW; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }", fragmentShader: "uniform float uA; varying float vW; void main(){ float c = 1.0 - abs(vW); gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * (0.6 + 2.2 * pow(c, 3.0)), c * uA); }", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      BOLT = new THREE.Mesh(g, m); BOLT.frustumCulled = false; BOLT.visible = false; BOLT.name = "gfx_bolt"; BOLT.userData.noCull = true; scene.add(BOLT); GX.obj.bolt = BOLT; }
    var cells = GX.storm.cellsAt || []; var c = cells[Math.floor(Math.random() * cells.length)]; if (!c) return;
    var gy = 1200; try { gy = getH(c[0], c[2]); } catch (e) {}
    var top = c[1] - 2500, x = c[0] + (Math.random() - 0.5) * 2000, z = c[2] + (Math.random() - 0.5) * 2000; var pts = []; var n = 22; var y0 = top, y1 = gy;
    var cx = x, cz = z; for (var i = 0; i <= n; i++) { var f = i / n; pts.push([cx, mix(y0, y1, f), cz]); cx += (Math.random() - 0.5) * 420; cz += (Math.random() - 0.5) * 420; }
    // a camera-facing ribbon (60 m wide: about two pixels at 14 km)
    var cam = camera.position; var pos = [], w = [], idx = []; var W = 70;
    for (var k = 0; k < pts.length; k++) { var p = pts[k], q = pts[Math.min(pts.length - 1, k + 1)], o = pts[Math.max(0, k - 1)]; var tx = q[0] - o[0], ty = q[1] - o[1], tz = q[2] - o[2]; var vx = cam.x - p[0], vy = cam.y - p[1], vz = cam.z - p[2];
      var sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx; var sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
      pos.push(p[0] - sx * W, p[1] - sy * W, p[2] - sz * W, p[0] + sx * W, p[1] + sy * W, p[2] + sz * W); w.push(-1, 1); if (k < pts.length - 1) { var a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    var g2 = BOLT.geometry; g2.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g2.setAttribute("aW", new THREE.Float32BufferAttribute(w, 1)); g2.setIndex(idx); g2.computeBoundingSphere();
    BOLT.userData.at = performance.now(); BOLT.visible = true; GX.storm.lastStrike = [x, z]; if (CL) CL.mesh.material.uniforms.uFlashP.value.set(x, top, z);
    // thunder, delayed and low (only when the player has sound on)
    try { var d = Math.hypot(x - camera.position.x, z - camera.position.z); var delay = 1200 + Math.min(6000, d / 3.4); setTimeout(thunder, delay); } catch (e) {}
  }
  function thunder() {
    try { if (typeof soundOn === "undefined" || !soundOn) return; var c = actx(); var dur = 3.2; var b = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate); var d = b.getChannelData(0); var last = 0;
      for (var i = 0; i < d.length; i++) { var t = i / d.length; last = last * 0.985 + (Math.random() * 2 - 1) * 0.015; d[i] = last * 7 * Math.pow(1 - t, 1.6) * (0.6 + 0.4 * Math.sin(t * 37)); }
      var src = c.createBufferSource(); src.buffer = b; var f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 180; var g = c.createGain(); g.gain.value = 0.9 * (VOL.sfx || 0.5) * (VOL.master || 1); src.connect(f); f.connect(g); g.connect(c.destination); src.start(); } catch (e) {}
  }
  function updateBolt(now) { if (!BOLT || !BOLT.visible) return; if (GX.storm.hold) { BOLT.material.uniforms.uA.value = GX.storm.hold; return; } var e = now - BOLT.userData.at; var a = 0; var P = ST.pulses || [0]; for (var i = 0; i < P.length; i++) { var x = e - P[i]; if (x >= 0 && x < 130) a = Math.max(a, Math.exp(-x / 60)); } BOLT.material.uniforms.uA.value = a * GX.storm.k; if (e > 700) BOLT.visible = false; }
  // gusts lift dust round the player (medium and up)
  function stormDust(dt) {
    var S = GX.storm.k; if (S < 0.2 || GX.tier < 1 || typeof FX === "undefined" || !FX.dust || typeof player === "undefined" || !player || inside) return;
    ST.dustAcc = (ST.dustAcc || 0) + dt * GX.storm.gust * 12; var D = FX.dust; var sd = GX.storm.dir; var wx = -sd[0], wz = -sd[2];
    while (ST.dustAcc > 1) { ST.dustAcc -= 1; var a = Math.random() * 6.283, r = 10 + Math.random() * 26; var x = player.position.x + Math.cos(a) * r - wx * 8, z = player.position.z + Math.sin(a) * r - wz * 8; var y = 0; try { y = getH(x, z); } catch (e) {}
      emitDust(x, y, z, 1, 1.5, 0.6); var i = D.i; D.vel[i * 3] = wx * (5 + Math.random() * 5); D.vel[i * 3 + 2] = wz * (5 + Math.random() * 5); D.vel[i * 3 + 1] = 0.3 + Math.random() * 1.2; }
  }

  // ═════════════════════════ post: grading, heat shimmer, floor reflections, AO, golden-hour rays ═════════════════════════
  function rep(src, a, b, what) { if (src.indexOf(a) < 0) { note("post patch", what + " anchor missing"); return src; } return src.split(a).join(b); }
  var FIN_UNI = "uniform float uGSat; uniform float uGSatLo; uniform float uGCon; uniform vec3 uGSh; uniform vec3 uGHi; uniform vec3 uGWB; uniform float uGLift; uniform float uFlash; uniform vec3 uGfxCam; uniform mat4 uGfxVP; uniform float uHeatK; uniform vec4 uHS[16]; uniform float uHSN; uniform vec4 uFlY[4]; uniform vec4 uFlB[4]; uniform float uFlN; uniform float uSsrK; uniform vec2 uAoPx; uniform float uBloomK; uniform float uSkyGradeK; uniform float uGSatSky; uniform float uGPiv;\n";
  // NaN / Inf by the exponent bits: ANGLE's D3D11 back end (FXC) folds isnan()/isinf() to false, so the client's scrubs never fired
  // on Windows GPUs, and HLSL min(NaN, 64.0) = 64 turned every NaN pixel into a full-strength bloom source (the white halos)
  var GLSL_BAD = "bool gfxBad(vec3 c){ uvec3 b = floatBitsToUint(c) & uvec3(0x7f800000u); return any(equal(b, uvec3(0x7f800000u))); }\n";
  var NAN_OLD = "if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);", NAN_NEW = "if (gfxBad(c)) c = vec3(0.0);";
  var FIN_FN = [
    "bool gfxBad(vec3 c){ uvec3 b = floatBitsToUint(c) & uvec3(0x7f800000u); return any(equal(b, uvec3(0x7f800000u))); }",
    "vec3 gfxWorld(vec2 uv, float lin){ vec3 pv = vec3((uv * 2.0 - 1.0) * uTan * lin, -lin); return uGfxCam + uCamRot * pv; }",
    "float gfxLin(vec2 uv){ float z = texture2D(tDepth, uv).x; return 2.0 * uNear * uFar / (uFar + uNear - (z * 2.0 - 1.0) * (uFar - uNear)); }",
    // heat haze: the hot air over the runway, integrated along the view ray (grazing sight lines through the first metres count)
    "float gfxHeat(vec2 uv, float lin){ if (uHeatK <= 0.0 || lin > 60000.0 || lin < 35.0) return 0.0; vec3 dir = normalize(gfxWorld(uv, lin) - uGfxCam); float acc = 0.0; float tMax = min(lin, 1800.0);",
    "  for (int i = 0; i < 7; i++) { float t = mix(40.0, tMax, (float(i) + 0.5) / 7.0); if (t > tMax) break; vec3 P = uGfxCam + dir * t; float best = 0.0;",
    "    for (int k = 0; k < 8; k++) { if (float(k) >= uHSN) break; vec4 A = uHS[k * 2], B = uHS[k * 2 + 1]; vec2 ab = B.xy - A.xy; float h = clamp(dot(P.xz - A.xy, ab) / max(dot(ab, ab), 1.0), 0.0, 1.0); float dxz = length(P.xz - A.xy - ab * h); float gy = mix(A.z, B.z, h);",
    "      best = max(best, smoothstep(A.w, A.w * 0.55, dxz) * smoothstep(3.2, 0.2, P.y - gy) * step(gy - 0.5, P.y) * B.w); }",
    "    acc += best; } return acc / 7.0 * uHeatK * smoothstep(30.0, 120.0, lin); }",
    // floor reflections: pixels on a registered polished floor march their reflected ray through the depth buffer
    "vec3 gfxFloor(vec3 c, vec2 uv, float lin){ if (uFlN < 0.5 || lin > 90.0) return c; vec3 P = gfxWorld(uv, lin); int fi = -1; for (int i = 0; i < 4; i++) { if (float(i) >= uFlN) break; vec4 fy = uFlY[i], fb = uFlB[i]; vec2 dd = P.xz - fb.xy; float cw = cos(fy.w), sw = sin(fy.w); vec2 lq = vec2(cw * dd.x - sw * dd.y, sw * dd.x + cw * dd.y); if (abs(P.y - fy.x) < 0.006 + lin * 0.0003 && abs(lq.x) < fb.z && abs(lq.y) < fb.w) { fi = i; } } if (fi < 0) return c;",
    "  vec4 fy = uFlY[0]; for (int i = 0; i < 4; i++) if (i == fi) fy = uFlY[i]; vec3 V = normalize(P - uGfxCam); vec3 R = vec3(V.x, -V.y, V.z); float t = 0.12; float tPrev = 0.0; vec2 huv = vec2(-1.0); float ht = 0.0;",
    "  for (int i = 0; i < 26; i++) { tPrev = t; t = t * 1.24 + 0.05; vec3 Q = P + R * t; vec4 cp = uGfxVP * vec4(Q, 1.0); if (cp.w <= 0.05) break; vec2 q = cp.xy / cp.w * 0.5 + 0.5; if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) break; float sz = gfxLin(q); float dz = cp.w - sz;",
    "    if (dz > 0.02 && dz < 0.3 + t * 0.12) { float a = tPrev, b = t; for (int k = 0; k < 5; k++) { float m = (a + b) * 0.5; vec4 cm = uGfxVP * vec4(P + R * m, 1.0); vec2 qm = cm.xy / cm.w * 0.5 + 0.5; if (cm.w - gfxLin(qm) > 0.02) b = m; else a = m; } vec4 ch = uGfxVP * vec4(P + R * b, 1.0); huv = ch.xy / ch.w * 0.5 + 0.5; ht = b; break; } }",
    "  if (huv.x < 0.0) return c; vec2 blur = uPx * (1.0 + ht * 0.6); vec3 rc = (texture2D(tCol, huv).rgb * 2.0 + texture2D(tCol, huv + vec2(blur.x, 0.0)).rgb + texture2D(tCol, huv - vec2(blur.x, 0.0)).rgb + texture2D(tCol, huv + vec2(0.0, blur.y)).rgb + texture2D(tCol, huv - vec2(0.0, blur.y)).rgb) / 6.0;",
    "  if (gfxBad(rc)) return c; vec2 e = min(huv, 1.0 - huv); float edge = smoothstep(0.0, 0.08, min(e.x, e.y)); float cosV = clamp(-V.y, 0.0, 1.0); float fres = 0.06 + 0.94 * pow(1.0 - cosV, 5.0);",
    "  float w = fy.y * uSsrK * edge * (1.0 - smoothstep(6.0, 22.0, ht)) * (0.35 + 0.65 * fres); return mix(c, rc * fy.z, clamp(w, 0.0, 0.85)); }",
    // AO upsampling that respects depth edges (no dark halo round a near silhouette against the far ground or the sky)
    "float gfxAO(vec2 uv, float lin0){ vec2 px = uAoPx; float acc = 0.0, tw = 0.0; for (int i = 0; i < 4; i++) { vec2 o = (vec2(float(i - (i / 2) * 2), float(i / 2)) * 2.0 - 1.0) * px * 0.75; float zl = gfxLin(uv + o); float w = 1.0 / (0.02 + abs(zl - lin0) / max(lin0, 0.5)); acc += texture2D(tAO, uv + o).r * w; tw += w; } return acc / max(tw, 1e-4); }",
    // grading: saturation, contrast, split tone and white balance per time of day (keyframes in plan_gfx.js)
    "vec3 gfxGrade(vec3 c, float sky){ float sk = sky * uSkyGradeK; c *= mix(uGWB, vec3(1.0), sk * 0.6); float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, mix(mix(uGSatLo, uGSat, smoothstep(0.06, 0.4, l)), mix(1.0, uGSatSky, smoothstep(0.03, 0.22, l)), sk)); vec3 c0 = c; c = mix((c - uGPiv) * uGCon + uGPiv, c0, sk); l = clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0); c = mix(c * uGSh, c * uGHi, smoothstep(0.12, 0.82, l)); c += uGLift * (1.0 - c) * (1.0 - sk); return c; }"
  ].join("\n") + "\n";

  GX.glsl = { uni: FIN_UNI, fn: FIN_FN };   // R16: plan_post.js builds its high / ultra passes on these (heat, floors, grade)
  // stable AO: a 4x4 interleaved pattern (no per-frame noise), horizon-style occlusion, then a 4x4 depth-aware box that cancels the pattern
  var AO_FRAG = [
    "varying vec2 vUv; uniform sampler2D tDepth; uniform vec2 uPx; uniform float uNear; uniform float uFar; uniform float uAspect; uniform vec2 uTan; uniform float uTime; uniform float uDirs; uniform float uRad;",
    "float lin(vec2 uv){ float z = texture2D(tDepth, uv).x; return 2.0 * uNear * uFar / (uFar + uNear - (z * 2.0 - 1.0) * (uFar - uNear)); }",
    "vec3 vpos(vec2 uv){ float z = lin(uv); return vec3((uv * 2.0 - 1.0) * uTan * z, -z); }",
    "float bayer4(vec2 p){ p = mod(p, 4.0); float x = p.x, y = p.y; float b = mod(x, 2.0) * 2.0 + mod(y, 2.0) * 3.0 - 4.0 * mod(x, 2.0) * mod(y, 2.0); float a = floor(x / 2.0) * 2.0 + floor(y / 2.0) * 3.0 - 4.0 * floor(x / 2.0) * floor(y / 2.0); return (b * 4.0 + a) / 16.0; }",
    "void main(){ float z = lin(vUv); if (z > 240.0) { gl_FragColor = vec4(1.0); return; }",
    "  vec3 P = vpos(vUv); vec3 px1 = vpos(vUv + vec2(uPx.x, 0.0)), px0 = vpos(vUv - vec2(uPx.x, 0.0)), py1 = vpos(vUv + vec2(0.0, uPx.y)), py0 = vpos(vUv - vec2(0.0, uPx.y));",
    "  vec3 dx = abs(px1.z - P.z) < abs(P.z - px0.z) ? px1 - P : P - px0; vec3 dy = abs(py1.z - P.z) < abs(P.z - py0.z) ? py1 - P : P - py0; vec3 N = normalize(cross(dx, dy));",
    "  float R = uRad + z * 0.006; vec2 rUv = vec2(R / (z * uTan.x * 2.0), R / (z * uTan.y * 2.0)); float jit = bayer4(gl_FragCoord.xy); float rot = jit * 6.2832; float jr = fract(jit * 7.0 + 0.5);",
    "  float occ = 0.0, cnt = 0.0; for (int d = 0; d < 6; d++) { if (float(d) >= uDirs) break; float a = rot + float(d) * 6.2832 / uDirs; vec2 dir = vec2(cos(a), sin(a));",
    "    for (int st = 1; st <= 3; st++) { float t = (float(st) - 1.0 + jr) / 3.0 + 0.08; vec2 uv2 = vUv + dir * rUv * t; if (uv2.x < 0.0 || uv2.y < 0.0 || uv2.x > 1.0 || uv2.y > 1.0) continue; vec3 V = vpos(uv2) - P; float len = length(V); float h = dot(V, N) / max(len, 1e-4); float fall = 1.0 - smoothstep(R * 0.7, R * 1.5, len); occ += max(0.0, h - 0.15) * fall; cnt += 1.0; } }",
    "  float ao = clamp(1.0 - occ / max(cnt, 1.0) * 2.1, 0.0, 1.0); ao = mix(ao, 1.0, smoothstep(120.0, 240.0, z)); gl_FragColor = vec4(vec3(ao), 1.0); }"
  ].join("\n");
  var AOBLUR_FRAG = [
    "varying vec2 vUv; uniform sampler2D tCol; uniform sampler2D tDepth; uniform vec2 uPx; uniform float uNear; uniform float uFar;",
    "float lin(vec2 uv){ float z = texture2D(tDepth, uv).x; return 2.0 * uNear * uFar / (uFar + uNear - (z * 2.0 - 1.0) * (uFar - uNear)); }",
    "void main(){ float z0 = lin(vUv); vec2 h = uPx; float acc = 0.0, tw = 0.0;",
    "  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) { vec2 uv = vUv + vec2(float(i) - 1.5, float(j) - 1.5) * h; float zz = lin(uv); float w = max(0.0, 1.0 - abs(zz - z0) / (0.04 * z0 + 0.05)); acc += texture2D(tCol, uv).r * w; tw += w; }",
    "  gl_FragColor = vec4(vec3(tw > 0.001 ? acc / tw : 1.0), 1.0); }"
  ].join("\n");

  function installPost() {
    if (typeof POST === "undefined" || !POST.mFinal) return false;
    GX.post = { fin: false, ao: false, rays: false };
    var F = POST.mFinal;
    if (!ORIG.finFrag) ORIG.finFrag = F.fragmentShader;
    var src = ORIG.finFrag;
    var ok = src.indexOf("float amp = 0.0;") >= 0 && src.indexOf("float ao = texture2D(tAO, vUv).r;") >= 0 && src.indexOf("float l = luma(c); c = mix(vec3(l), c, 1.18); c = (c - 0.5) * 1.1 + 0.5; c = mix(c * vec3(0.9, 0.96, 1.12), c * vec3(1.08, 1.0, 0.9), smoothstep(0.12, 0.82, l));") >= 0 && src.indexOf("void main(){") >= 0;
    if (ok) {
      src = rep(src, "uniform float uAoK;", "uniform float uAoK;\n" + FIN_UNI, "uniforms");
      src = rep(src, "void main(){", FIN_FN + "void main(){", "functions");
      src = rep(src, "float amp = 0.0; uvh += vec2(sin(vUv.y * 90.0 + uTime * 2.7) + sin(vUv.y * 41.0 - uTime * 1.9), cos(vUv.x * 70.0 + uTime * 2.2)) * amp;",
        "float amp = gfxHeat(vUv, lin0); if (amp > 0.0) { vec2 wob = vec2(sin(vUv.y * 170.0 + uTime * 5.1 + sin(vUv.x * 60.0 + uTime * 1.3) * 2.0) + 0.6 * sin(vUv.y * 310.0 - uTime * 7.3), cos(vUv.x * 120.0 + vUv.y * 40.0 - uTime * 4.2)) * amp; if (gfxLin(vUv + wob) > lin0 * 0.8) uvh += wob; }", "heat");
      src = rep(src, "float ao = texture2D(tAO, vUv).r;", "c = gfxFloor(c, vUv, lin0); float ao = uAoK > 0.0 ? gfxAO(vUv, lin0) : 1.0;", "ao");
      src = rep(src, "float l = luma(c); c = mix(vec3(l), c, 1.18); c = (c - 0.5) * 1.1 + 0.5; c = mix(c * vec3(0.9, 0.96, 1.12), c * vec3(1.08, 1.0, 0.9), smoothstep(0.12, 0.82, l));", "c = gfxGrade(c, isSky);", "grade");
      src = rep(src, "c += texture2D(tBloom, vUv).rgb * 0.3", "c += texture2D(tBloom, vUv).rgb * 0.3 * uBloomK", "bloom");
      src = rep(src, "if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0); c = aces(c * uExposure * 1.05);", "if (gfxBad(c)) c = vec3(0.0); c = aces(min(c, vec3(6.0e4)) * uExposure * 1.05);", "scrub");
      var U = F.uniforms; U.uGSat = { value: 1.18 }; U.uGSatLo = { value: 1.18 }; U.uGCon = { value: 1.1 }; U.uGSh = { value: new THREE.Vector3(0.9, 0.96, 1.12) }; U.uGHi = { value: new THREE.Vector3(1.08, 1.0, 0.9) }; U.uGWB = { value: new THREE.Vector3(1, 1, 1) }; U.uGLift = { value: 0 }; U.uFlash = { value: 0 };
      U.uGfxCam = { value: new THREE.Vector3() }; U.uGfxVP = { value: new THREE.Matrix4() }; U.uHeatK = { value: 0 }; U.uHS = { value: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(function () { return new THREE.Vector4(); }) }; U.uHSN = { value: 0 };
      U.uFlY = { value: [0, 1, 2, 3].map(function () { return new THREE.Vector4(); }) }; U.uFlB = { value: [0, 1, 2, 3].map(function () { return new THREE.Vector4(); }) }; U.uFlN = { value: 0 }; U.uSsrK = { value: 0 }; U.uAoPx = { value: new THREE.Vector2(1 / 640, 1 / 360) }; U.uBloomK = { value: 1 }; U.uSkyGradeK = { value: 0 }; U.uGSatSky = { value: 1.15 }; U.uGPiv = { value: 0.5 };
      F.fragmentShader = src; F.needsUpdate = true; GX.post.fin = true;
    } else note("post", "mFinal changed: grading, heat and floor reflections skipped");
    // AO
    if (POST.mAO && POST.mAOBlur) {
      if (!ORIG.aoFrag) { ORIG.aoFrag = POST.mAO.fragmentShader; ORIG.aoBlurFrag = POST.mAOBlur.fragmentShader; }
      var A = POST.mAO.uniforms; A.uDirs = { value: 6 }; A.uRad = { value: GX.K.aoRadius }; POST.mAO.fragmentShader = AO_FRAG; POST.mAO.needsUpdate = true;
      var B = POST.mAOBlur.uniforms; B.uNear = { value: camera.near }; B.uFar = { value: camera.far }; POST.mAOBlur.fragmentShader = AOBLUR_FRAG; POST.mAOBlur.needsUpdate = true; GX.post.ao = true;
    }
    // the bloom's bright pass: a NaN or Inf pixel must never feed the bloom (on D3D it came out at the 64.0 clamp: white halos)
    if (POST.mBright) { if (!ORIG.brightFrag) ORIG.brightFrag = POST.mBright.fragmentShader; var bs = ORIG.brightFrag; if (bs.indexOf(NAN_OLD) >= 0 && bs.indexOf("void main(){") >= 0) { POST.mBright.fragmentShader = bs.split(NAN_OLD).join(NAN_NEW).replace("void main(){", GLSL_BAD + "void main(){"); POST.mBright.needsUpdate = true; GX.post.bright = true; } else note("post", "bright pass changed: NaN guard skipped"); }
    // rays: a golden-hour boost and the storm's cut
    if (POST.mRays) { if (!ORIG.raysFrag) ORIG.raysFrag = POST.mRays.fragmentShader; var rs = ORIG.raysFrag; if (rs.indexOf("r * uStrength") >= 0) { POST.mRays.uniforms.uGfxK = { value: 1 }; POST.mRays.fragmentShader = rs.replace("uniform float uStrength;", "uniform float uStrength; uniform float uGfxK;").replace("r * uStrength", "r * uStrength * uGfxK").split(NAN_OLD).join(NAN_NEW).replace("void main(){", GLSL_BAD + "void main(){"); POST.mRays.needsUpdate = true; GX.post.rays = true; } }
    // medium gets a cheap AO (4 directions); the quality table is a shared object, restored on uninstall
    if (!ORIG.qMed) ORIG.qMed = { ao: QUAL_DEF.medium.ao, aoK: QUAL_DEF.medium.aoK };
    return true;
  }
  function uninstallPost() {
    if (typeof POST === "undefined" || !POST.mFinal) return;
    if (ORIG.finFrag) { POST.mFinal.fragmentShader = ORIG.finFrag; POST.mFinal.needsUpdate = true; }
    if (ORIG.aoFrag) { POST.mAO.fragmentShader = ORIG.aoFrag; POST.mAO.needsUpdate = true; POST.mAOBlur.fragmentShader = ORIG.aoBlurFrag; POST.mAOBlur.needsUpdate = true; }
    if (ORIG.raysFrag) { POST.mRays.fragmentShader = ORIG.raysFrag; POST.mRays.needsUpdate = true; }
    if (ORIG.brightFrag) { POST.mBright.fragmentShader = ORIG.brightFrag; POST.mBright.needsUpdate = true; }
    if (ORIG.qMed) { QUAL_DEF.medium.ao = ORIG.qMed.ao; if (ORIG.qMed.aoK === undefined) delete QUAL_DEF.medium.aoK; else QUAL_DEF.medium.aoK = ORIG.qMed.aoK; }
    GX.post = null;
  }
  // per-tier switches that can change with the quality setting
  function applyTier() {
    var T = GX.tier;
    try { if (GX.post && GX.post.ao) { QUAL_DEF.medium.ao = T >= 1; QUAL_DEF.medium.aoK = 0.42; POST.mAO.uniforms.uDirs.value = T >= 2 ? 6 : 4; } } catch (e) {}
    if (CL) CL.mesh.visible = true;
  }

  // per frame, just before the client renders: camera-dependent uniforms (the camera is final here)
  var RF = { vp: null, t0: 0 };
  function beforeRender() {
    if (!GX.installed) return; var T = GX.tier;
    lightGuard(performance.now());
    camera.updateMatrixWorld(); if (!RF.vp) RF.vp = new THREE.Matrix4();
    writeClouds(false);
    if (GX.post && GX.post.fin) { var F = POST.mFinal.uniforms; F.uGfxCam.value.copy(camera.position); RF.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); F.uGfxVP.value.copy(RF.vp); F.uCamRot.value.setFromMatrix4(camera.matrixWorld);
      { var tv = Math.tan(camera.fov * Math.PI / 360); F.uTan.value.set(tv * camera.aspect, tv); }
      var w = renderer.domElement.width, h = renderer.domElement.height; F.uAoPx.value.set(2 / Math.max(1, w), 2 / Math.max(1, h));
      // heat shimmer: high tiers, the midday heat, never in a storm
      var el = GX.sun ? GX.sun.el : 0; var camAbove = camera.position.y - (typeof getH === "function" ? getH(camera.position.x, camera.position.z) : 0); F.uHeatK.value = T >= 2 && RW && camAbove < 40 ? GX.K.heat * sstep(0.45, 0.8, el) * (1 - GX.storm.k) : 0;
      if (RW) { for (var hi = 0; hi < RW.segs.length && hi < 8; hi++) { var sg = RW.segs[hi]; F.uHS.value[hi * 2].set(sg[0], sg[1], sg[2], sg[6]); F.uHS.value[hi * 2 + 1].set(sg[3], sg[4], sg[5], sg[7]); } F.uHSN.value = Math.min(8, RW.segs.length); }
      floorsUniforms(F, T); }
    if (POST.mAOBlur && GX.post && GX.post.ao) { POST.mAOBlur.uniforms.uNear.value = camera.near; POST.mAOBlur.uniforms.uFar.value = camera.far; }
    updateShafts();
  }
  var RW = null;
  function runwayInfo() {
    // the runway and the longest asphalt segments (taxiways, the taxi-streets, the drag strip): [ax, az, ay, bx, bz, by, half width, strength]
    try { var R = window.PLAN && PLAN.runway; if (!R) return; var a = R.ne, b = R.sw; var segs = [[a[0], a[1], getH(a[0], a[1]), b[0], b[1], getH(b[0], b[1]), 34, 1]]; var more = [];
      (PLAN.roads || []).forEach(function (o) { if (!(o.class === "taxilane" || /asphalt/i.test(o.surface || "")) || !o.pts) return; for (var i = 1; i < o.pts.length; i++) { var p0 = o.pts[i - 1], p1 = o.pts[i]; var L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); if (L >= 140) more.push([p0[0], p0[1], getH(p0[0], p0[1]), p1[0], p1[1], getH(p1[0], p1[1]), (o.width || 15) * 0.5 + 6, 0.7, L]); } });
      more.sort(function (p, q) { return q[8] - p[8]; }); more.slice(0, 7).forEach(function (m) { segs.push(m.slice(0, 8)); }); RW = { segs: segs, set: false }; GX.n.heatSegs = segs.length; } catch (e) { note("runway", e); }
  }


  // ═════════════════════════ R4 SKY: the real sky over Douglas, Arizona (31.34 N, 109.51 W) ═════════════════════════
  // NASA SVS Deep Star Maps 2020 (public domain) for the Milky Way and the faint stars, the brightest 5,044 stars as crisp points
  // (d3-celestial, BSD), the Moon (NASA CGI Moon Kit) and the five naked-eye planets from a low-precision ephemeris, meteors,
  // satellites, IAU constellation figures, a telescope view and a stargazing mode (window.PLAN_SKY, see HANDOFF_R4_SKY.md).
  // World frame: x east, y up, z south (north is -z, the plan's convention). The day light (the client's sun) is untouched.
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var SK = GX.sky = {
    lat: 31.3441, lon: -109.5063, date: null, tlOff: 0, tl: null, tier: -1, res: "", jd: 0, lst: 0,
    E2W: [1, 0, 0, 0, 1, 0, 0, 0, 1], W2E: null, sun: null, moon: null, planets: [], stars: null, starN: 0,
    mapK: 0, mapWant: 0, sg: { on: false, k: 0, opts: {} }, conK: 0, conOn: false, lightK: 1, met: [null, null], metNext: 0, sat: [null, null], satNext: 0,
    keyK: 1, tele: [], errs: [], loaded: {}, bytes: 0
  };
  function skNote(w, e) { note("sky " + w, e); }
  function skJD(ms) { return ms / 86400000 + 2440587.5; }
  function v3n(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function v3cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function radec(raDeg, decDeg) { var a = raDeg * D2R, d = decDeg * D2R, c = Math.cos(d); return [c * Math.cos(a), c * Math.sin(a), Math.sin(d)]; }
  function m3mul(A, B) { var o = []; for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) o.push(A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]); return o; }
  function m3v(M, v) { return [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]]; }
  function m3t(M) { return [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]; }
  var EPS0 = 23.4392911 * D2R, CE = Math.cos(EPS0), SE = Math.sin(EPS0);
  function ecl2eq(v) { return [v[0], v[1] * CE - v[2] * SE, v[1] * SE + v[2] * CE]; }
  function kepler(M, e) { var E = M + e * Math.sin(M) * (1 + e * Math.cos(M)); for (var i = 0; i < 6; i++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); return E; }
  // the sky's own time: the game's hour on tonight's date in Arizona (MST, no daylight saving). The night runs from game noon to game
  // noon, so the date only steps at midday (the stars and the Moon never jump at night). PLAN_SKY.setDate() or ?skydate= override it.
  function skyMs() {
    var gh = 12; try { gh = dayT() * 24; } catch (e) {}
    var base = SK.date;
    if (base === null || base === undefined) { var d = new Date(Date.now() - 19 * 3600000); base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
    return base + 7 * 3600000 + (gh >= 12 ? gh : gh + 24) * 3600000 + SK.tlOff;
  }
  // precession J2000 -> date (IAU 1976), Greenwich mean sidereal time
  function precess(T) {
    var as = D2R / 3600; var z0 = (2306.2181 * T + 0.30188 * T * T) * as, z = (2306.2181 * T + 1.09468 * T * T) * as, th = (2004.3109 * T - 0.42665 * T * T) * as;
    var cz0 = Math.cos(z0), sz0 = Math.sin(z0), cz = Math.cos(z), sz = Math.sin(z), ct = Math.cos(th), st = Math.sin(th);
    return [cz0 * ct * cz - sz0 * sz, -sz0 * ct * cz - cz0 * sz, -st * cz, cz0 * ct * sz + sz0 * cz, -sz0 * ct * sz + cz0 * cz, -st * sz, cz0 * st, -sz0 * st, ct];
  }
  function gmst(jd) { var d = jd - 2451545.0, T = d / 36525; var g = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - T * T * T / 38710000; return (((g % 360) + 360) % 360) * D2R; }
  // J2000 equatorial -> world (x east, y up, z south) at the site for a given local sidereal time
  function skyMatrix(jd, lstExtra) {
    var T = (jd - 2451545.0) / 36525; var lst = gmst(jd) + SK.lon * D2R + (lstExtra || 0); SK.lst = lst;
    var cl = Math.cos(lst), sl = Math.sin(lst), ph = SK.lat * D2R, cp = Math.cos(ph), sp = Math.sin(ph);
    var Rz = [cl, sl, 0, -sl, cl, 0, 0, 0, 1];
    var Menu = [0, 1, 0, cp, 0, sp, sp, 0, -cp];
    return m3mul(Menu, m3mul(Rz, precess(T)));
  }
  // the Sun (low precision; ecliptic of date, general precession removed -> J2000)
  function sunPos(jd) {
    var n = jd - 2451545.0, T = n / 36525; var L = (280.460 + 0.9856474 * n) * D2R, g = (357.528 + 0.9856003 * n) * D2R;
    var lam = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R - 1.396971 * T * D2R;
    return { eq: ecl2eq([Math.cos(lam), Math.sin(lam), 0]), r: 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g) };
  }
  // the Moon (Schlyter's elements with the main perturbations; about 2 arcmin), geocentric J2000 and distance in Earth radii
  function moonPos(jd) {
    var d = jd - 2451543.5, T = (jd - 2451545.0) / 36525;
    var N = (125.1228 - 0.0529538083 * d) * D2R, i = 5.1454 * D2R, w = (318.0634 + 0.1643573223 * d) * D2R, a = 60.2666, e = 0.0549;
    var M = ((115.3654 + 13.0649929509 * d) % 360) * D2R; var E = kepler(M, e);
    var xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(E); var v = Math.atan2(yv, xv), r = Math.hypot(xv, yv);
    var xh = r * (Math.cos(N) * Math.cos(v + w) - Math.sin(N) * Math.sin(v + w) * Math.cos(i)), yh = r * (Math.sin(N) * Math.cos(v + w) + Math.cos(N) * Math.sin(v + w) * Math.cos(i)), zh = r * Math.sin(v + w) * Math.sin(i);
    var lon = Math.atan2(yh, xh), lat = Math.atan2(zh, Math.hypot(xh, yh));
    var Ms = (356.0470 + 0.9856002585 * d) * D2R, ws = (282.9404 + 4.70935E-5 * d) * D2R, Ls = Ms + ws, Lm = M + w + N, D = Lm - Ls, F = Lm - N, S = Math.sin;
    lon += (-1.274 * S(M - 2 * D) + 0.658 * S(2 * D) - 0.186 * S(Ms) - 0.059 * S(2 * M - 2 * D) - 0.057 * S(M - 2 * D + Ms) + 0.053 * S(M + 2 * D) + 0.046 * S(2 * D - Ms) + 0.041 * S(M - Ms) - 0.035 * S(D) - 0.031 * S(M + Ms) - 0.015 * S(2 * F - 2 * D) + 0.011 * S(M - 4 * D)) * D2R;
    lat += (-0.173 * S(F - 2 * D) - 0.055 * S(M - F - 2 * D) - 0.046 * S(M + F - 2 * D) + 0.033 * S(F + 2 * D) + 0.017 * S(2 * M + F)) * D2R;
    r += -0.58 * Math.cos(M - 2 * D) - 0.46 * Math.cos(2 * D);
    lon -= 1.396971 * T * D2R;
    var cb = Math.cos(lat); return { eq: ecl2eq([cb * Math.cos(lon), cb * Math.sin(lon), Math.sin(lat)]), r: r };
  }
  // planets: JPL "Keplerian elements for approximate positions of the major planets" (1800 to 2050), J2000 ecliptic
  var PLAN_EL = {
    Mercury: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.25032350, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081],
    Venus: [0.72333566, 0.00000390, 0.00677672, -0.00004107, 3.39467605, -0.00078890, 181.97909950, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
    Earth: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0, 0],
    Mars: [1.52371034, 0.00001847, 0.09339410, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
    Jupiter: [5.20288700, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
    Saturn: [9.53667594, -0.00125060, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794]
  };
  // per planet: [radius arcsec at 1 AU, magnitude: [H, k1, k2, k3] for 5 log(r D) + k1 i + k2 i^2 + k3 i^3, colour rgb, pole RA, pole Dec, oblateness]
  var PLAN_INFO = {
    Mercury: [3.37, [-0.42, 0.038, -0.000273, 0.000002], [0.86, 0.8, 0.74], 281.01, 61.45, 0],
    Venus: [8.41, [-4.40, 0.0009, 0.000239, -0.00000065], [1.0, 0.96, 0.86], 272.76, 67.16, 0],
    Mars: [4.68, [-1.52, 0.016, 0, 0], [1.0, 0.66, 0.44], 317.68, 52.89, 0.006],
    Jupiter: [98.44, [-9.40, 0.005, 0, 0], [1.0, 0.94, 0.84], 268.06, 64.50, 0.065],
    Saturn: [82.73, [-8.88, 0.044, 0, 0], [1.0, 0.92, 0.74], 40.59, 83.54, 0.098]
  };
  var PLAN_NAMES = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
  function helio(name, T) {
    var E = PLAN_EL[name]; var a = E[0] + E[1] * T, e = E[2] + E[3] * T, I = (E[4] + E[5] * T) * D2R, L = (E[6] + E[7] * T) * D2R, wb = (E[8] + E[9] * T) * D2R, O = (E[10] + E[11] * T) * D2R;
    var w = wb - O, M = L - wb; M = M - 2 * Math.PI * Math.floor((M + Math.PI) / (2 * Math.PI)); var Ea = kepler(M, e);
    var xp = a * (Math.cos(Ea) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(Ea);
    var cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
    return [(cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp, (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp, (sw * sI) * xp + (cw * sI) * yp];
  }
  function planetPos(jd) {
    var T = (jd - 2451545.0) / 36525; var Ee = helio("Earth", T); var Re = Math.hypot(Ee[0], Ee[1], Ee[2]); var out = [];
    for (var i = 0; i < PLAN_NAMES.length; i++) {
      var nm = PLAN_NAMES[i], P = helio(nm, T); var r = Math.hypot(P[0], P[1], P[2]);
      var g = [P[0] - Ee[0], P[1] - Ee[1], P[2] - Ee[2]]; var dl = Math.hypot(g[0], g[1], g[2]);
      // light time
      var P2 = helio(nm, T - dl * 0.0057755 / 36525); g = [P2[0] - Ee[0], P2[1] - Ee[1], P2[2] - Ee[2]]; dl = Math.hypot(g[0], g[1], g[2]);
      var ci = clamp((r * r + dl * dl - Re * Re) / (2 * r * dl), -1, 1), ph = Math.acos(ci) * R2D; var I = PLAN_INFO[nm], H = I[1];
      var mag = H[0] + 5 * Math.log10(r * dl) + H[1] * ph + H[2] * ph * ph + H[3] * ph * ph * ph;
      var eq = v3n(ecl2eq(g)); var sunFrom = v3n(ecl2eq([-P2[0], -P2[1], -P2[2]]));
      if (nm === "Saturn") { var pole = radec(I[3], I[4]); var B = Math.asin(clamp(-v3dot(pole, eq), -1, 1)); mag += -2.6 * Math.abs(Math.sin(B)) + 1.25 * Math.sin(B) * Math.sin(B); }
      out.push({ name: nm, eq: eq, dist: dl, r: r, phase: ph, illum: (1 + ci) / 2, mag: mag, radius: I[0] / dl / 3600 * D2R, sun: sunFrom, col: I[2], pole: radec(I[3], I[4]), obl: I[5] });
    }
    return out;
  }
  // Jupiter's four Galilean moons (Meeus ch. 44, low accuracy): apparent X (west) and Y (north) in Jupiter radii
  function galilean(jd) {
    var d = jd - 2451545.0; var V = (172.74 + 0.00111588 * d) * D2R, M = (357.529 + 0.9856003 * d) * D2R, N = (20.020 + 0.0830853 * d) * D2R + 0.329 * D2R * Math.sin(V), J = (66.115 + 0.9025179 * d) * D2R - 0.329 * D2R * Math.sin(V);
    var A = (1.915 * Math.sin(M) + 0.020 * Math.sin(2 * M)) * D2R, B = (5.555 * Math.sin(N) + 0.168 * Math.sin(2 * N)) * D2R, K = J + A - B;
    var R = 1.00014 - 0.01671 * Math.cos(M) - 0.00014 * Math.cos(2 * M), r = 5.20872 - 0.25208 * Math.cos(N) - 0.00611 * Math.cos(2 * N);
    var Dl = Math.sqrt(r * r + R * R - 2 * r * R * Math.cos(K)), psi = Math.asin(R / Dl * Math.sin(K)); var t = d - Dl / 173;
    var u1 = (163.8069 + 203.4058646 * t) * D2R + psi - B, u2 = (358.4140 + 101.2916335 * t) * D2R + psi - B, u3 = (5.7176 + 50.2345180 * t) * D2R + psi - B, u4 = (224.8092 + 21.4879800 * t) * D2R + psi - B;
    var G = (331.18 + 50.310482 * t) * D2R, Hh = (87.45 + 21.569231 * t) * D2R;
    u1 += 0.473 * D2R * Math.sin(2 * (u1 - u2)); u2 += 1.065 * D2R * Math.sin(2 * (u2 - u3)); u3 += 0.165 * D2R * Math.sin(G); u4 += 0.843 * D2R * Math.sin(Hh);
    var rr = [5.9057 - 0.0244 * Math.cos(2 * (u1 - u2)), 9.3966 - 0.0882 * Math.cos(2 * (u2 - u3)), 14.9883 - 0.0216 * Math.cos(G), 26.3627 - 0.1939 * Math.cos(Hh)], uu = [u1, u2, u3, u4];
    return uu.map(function (u, k) { return { name: ["Io", "Europa", "Ganymede", "Callisto"][k], x: rr[k] * Math.sin(u), y: -rr[k] * Math.cos(u) * 0.05, front: Math.cos(u) < 0 ? 0 : 1, mag: [5.0, 5.3, 4.6, 5.6][k] }; });
  }
  // B-V colour index -> linear RGB (Ballesteros temperature, a blackbody fit), luminance normalised
  // star colour from B-V: temperature (Ballesteros 2012), chromaticity on the Planckian locus (Kim et al. 2002), linear sRGB white
  // at K.sk.starWhite (5,600 K, a photographer's daylight balance) (sun-like stars white, A and B stars blue-white, K and M stars orange), saturation K.sk.starSat
  function bvRGB(bv) {
    bv = clamp(bv, -0.4, 2.0); var T = clamp(4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)), 1700, 25000);
    var c = planckRGB(T), w = planckRGB(GX.K.sk.starWhite || 5600); c = [c[0] / w[0], c[1] / w[1], c[2] / w[2]];
    var l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; var k = GX.K.sk.starSat === undefined ? 0.8 : GX.K.sk.starSat;
    c = [mix(l, c[0], k), mix(l, c[1], k), mix(l, c[2], k)].map(function (x) { return Math.max(x, 0.02); }); l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return [c[0] / l, c[1] / l, c[2] / l];
  }
  function planckRGB(T) {
    var t = 1 / T, x = T < 4000 ? -0.2661239e9 * t * t * t - 0.2343589e6 * t * t + 0.8776956e3 * t + 0.179910 : -3.0258469e9 * t * t * t + 2.1070379e6 * t * t + 0.2226347e3 * t + 0.240390;
    var y = T < 2222 ? -1.1063814 * x * x * x - 1.34811020 * x * x + 2.18555832 * x - 0.20219683 : T < 4000 ? -0.9549476 * x * x * x - 1.37418593 * x * x + 2.09137015 * x - 0.16748867 : 3.0817580 * x * x * x - 5.87338670 * x * x + 3.75112997 * x - 0.37001483;
    var X = x / y, Z = (1 - x - y) / y; return [Math.max(0, 3.2406 * X - 1.5372 - 0.4986 * Z), Math.max(0, -0.9689 * X + 1.8758 + 0.0415 * Z), Math.max(0, 0.0557 * X - 0.2040 + 1.0570 * Z)];
  }


  // ── data: background loads with retries (a busy server drops files); images decode off the main thread (createImageBitmap) ──
  var SKDIR = "/tex/sky/";
  function skFetch(url, kind, tries) {
    tries = tries || 0;
    return fetch((window.AV || String)(url + (url.indexOf("?") < 0 ? "?v=" + (window.BUILD || "dev") : ""))).then(function (r) { if (!r.ok) throw new Error(url + " " + r.status); return kind === "json" ? r.json() : r.arrayBuffer().then(function (b) { SK.bytes += b.byteLength; return b; }); })
      .catch(function (e) { if (tries < 4) return new Promise(function (res) { setTimeout(res, 800 * (tries + 1)); }).then(function () { return skFetch(url, kind, tries + 1); }); throw e; });
  }
  function skImage(url) {
    return skFetch(url, "buf").then(function (buf) {
      var blob = new Blob([buf], { type: "image/jpeg" });
      if (typeof createImageBitmap === "function") return createImageBitmap(blob, { imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: "none" });
      return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = URL.createObjectURL(blob); });
    });
  }
  // every sky texture is addressed top-down (v = 0 is the image's top row): flipY off for bitmaps and images alike
  function skTex(img, o) {
    var t = new THREE.Texture(img); o = o || {}; t.flipY = false; t.format = o.red ? THREE.RedFormat : THREE.RGBAFormat; t.colorSpace = o.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = o.clampS ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = o.mips !== false; t.minFilter = o.mips === false ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    try { t.anisotropy = Math.min(o.aniso || 1, renderer.capabilities.getMaxAnisotropy()); } catch (e) {}
    if (img) t.needsUpdate = true; return t;
  }
  function px1(rgb) { var t = new THREE.DataTexture(new Uint8Array([rgb[0], rgb[1], rgb[2], 255]), 1, 1); t.needsUpdate = true; return t; }
  var SKT = ORIG.skt = ORIG.skt || { L: null, G: null, C: null, moon: null, moon2: null, img: {} };   // kept across a hot reload
  if (SKT.v !== 15) { if (SKT.v !== 5) { [SKT.G, SKT.C].forEach(function (t) { try { if (t && t.dispose) t.dispose(); } catch (e) {} }); SKT.G = SKT.C = null; } try { if (SKT.L && SKT.L.dispose) SKT.L.dispose(); } catch (e) {} SKT.L = null; SKT.v = 15; }   // R15: the photo maps (R5) only; the NASA map is no longer loaded

  // ── the catalogue stars, the planets and two satellite slots: one Points draw, transformed on the GPU by the sky matrix ──
  var STAR_VERT = [
    "attribute vec3 aCol; attribute vec3 aMag; uniform mat3 uE2W; uniform float uLim; uniform float uGain; uniform float uVis; uniform float uTime; uniform float uPR; uniform vec3 uMoonDir; uniform vec2 uMoon; uniform vec4 uTeleS; uniform vec4 uStarK; uniform float uWing;",
    "varying vec3 vC; varying float vR; varying float vHalo; varying float vSig;",
    "void main(){ vec3 d = normalize(uE2W * position); float h = d.y; float kind = aMag.y;",
    "  float altD = degrees(asin(clamp(h, -1.0, 1.0))); float X = 1.0 / (max(h, 0.0) + 0.50572 * pow(max(altD + 6.07995, 0.5), -1.6364)); X = min(X, 40.0);",
    "  float m = aMag.x + 0.18 * (X - 1.0) - uTeleS.x; float lim = uLim + uTeleS.y;",
    // the Moon washes out its neighbourhood and hides what is behind its disc
    "  float ca = dot(d, normalize(uMoonDir)); float ang = acos(clamp(ca, -1.0, 1.0)); lim -= uMoon.y * (1.6 * exp(-ang / 0.09) + 0.6 * exp(-ang / 0.5)); float occ = step(uMoon.x * 1.03, ang);",
    "  float vis = smoothstep(lim + 0.3, lim - 0.7, m) * smoothstep(-0.008, 0.02, h) * uVis * occ; if (kind > 0.5) vis *= aMag.z;",
    // R15: brightness follows flux^uStarK.x (0.62, was 0.34: a naked-eye hierarchy, a few bright stars and many faint ones), capped at uStarK.w
    "  float f = pow(10.0, -0.4 * (m - 1.0)); float b = min(pow(f, uStarK.x), uStarK.w) * vis;",
    // scintillation: stars twinkle more near the horizon (planets hardly), with a little colour flicker for the bright ones
    "  float tw = 1.0; float sd = fract(sin(dot(position.xy, vec2(127.1, 311.7)) + position.z * 74.7) * 43758.5); vec3 fl = vec3(1.0);",
    "  if (kind < 0.5) { float amp = 0.05 + 0.55 * pow(1.0 - smoothstep(0.03, 0.75, h), 2.0); amp *= 1.0 - uTeleS.z * 0.7; float n = sin(uTime * (6.0 + 9.0 * sd) + sd * 50.0) * 0.6 + sin(uTime * (13.0 + 11.0 * fract(sd * 7.3)) + sd * 17.0) * 0.4; tw = 1.0 + amp * n;",
    "    fl = 1.0 + vec3(0.18, -0.06, -0.16) * amp * sin(uTime * (9.0 + 7.0 * sd) + sd * 9.0) * smoothstep(0.3, 1.5, b); }",
    "  else if (kind < 1.5) { tw = 1.0 + 0.04 * sin(uTime * 7.0 + sd * 40.0) * (1.0 - smoothstep(0.1, 0.5, h)); }",
    "  b *= max(tw, 0.0); vec3 ext = exp(-vec3(0.07, 0.12, 0.24) * (X - 1.0));",
    "  vC = aCol * fl * ext * b * uGain; vHalo = smoothstep(0.8, 4.5, b); if (kind > 0.5 && kind < 1.5) vHalo = max(vHalo, min(1.0, uStarK.y * smoothstep(-1.2, -4.2, m)));",
    // R15: the core is a Gaussian integrated over each canvas pixel (sigma' = sqrt(sigma^2 + 1/12), normalised: the pixels share the
    // star's light, so it is point-sharp at every pixel ratio and tier, never a square and never a blur); sigma is in canvas pixels; the
    // light scales with the pixel ratio squared (the same star at any resolution); bright stars a little wider, with a faint glare wing
    "  float sg = uStarK.z * (1.0 + 0.15 * vHalo); vSig = sqrt(sg * sg + 0.0833); vC *= uPR * uPR;",
    "  float sz = 6.0 * vSig + 2.0 + 12.0 * vHalo * uPR; vR = sz; gl_PointSize = sz;",
    "  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + d * 70000.0, 1.0); if (b < 0.004 || (kind > 0.5 && kind < 1.5 && uTeleS.w > 0.5)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }"
  ].join("\n");
  var STAR_FRAG = [
    "uniform float uPR; uniform float uWing; varying vec3 vC; varying float vR; varying float vHalo; varying float vSig;",
    "void main(){ vec2 p = (gl_PointCoord - 0.5) * vR; float rp2 = dot(p, p); float s2 = vSig * vSig;",
    "  float core = exp(-rp2 / (2.0 * s2)) / (6.2831853 * s2);",
    "  float wing = 0.0; if (vHalo > 0.0) { float rr = sqrt(rp2) / uPR; wing = vHalo * uWing * (0.03 * exp(-rr / 0.9) + 0.004 * exp(-rr / 2.8)) / (uPR * uPR) * smoothstep(vR * 0.5, vR * 0.32, sqrt(rp2)); }",
    "  vec3 c = vC * (core + wing); if (max(c.r, max(c.g, c.b)) < 0.0015) discard; gl_FragColor = vec4(c, 1.0); }"
  ].join("\n");
  function skStarMat() {
    return new THREE.ShaderMaterial({
      uniforms: { uE2W: { value: new THREE.Matrix3() }, uLim: { value: 6.5 }, uGain: { value: 1 }, uVis: { value: 0 }, uTime: { value: 0 }, uPR: { value: 1 }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uMoon: { value: new THREE.Vector2(0.005, 0) }, uTeleS: { value: new THREE.Vector4(0, 0, 0, 0) }, uStarK: { value: new THREE.Vector4(0.72, 0.6, 0.55, 6.0) }, uWing: { value: 0.5 } },
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false
    });
  }
  var NPL = 5, NSAT = 2;
  function skBuildStars(buf) {
    var dv = new DataView(buf); var n = dv.getUint32(0, true);
    // phones and low quality keep the stars to magnitude 7 (the file is sorted by magnitude), desktop all 41,411 to magnitude 8
    if (SK.tier < 1) { var lim = GX.K.sk.starMaxLow; for (var q = 0; q < n; q++) if (dv.getInt16(4 + q * 8 + 4, true) / 100 > lim) { n = q; break; } }
    var N = n + NPL + NSAT;
    var pos = new Float32Array(N * 3), col = new Float32Array(N * 3), mag = new Float32Array(N * 3), list = [];
    for (var i = 0; i < n; i++) {
      var o = 4 + i * 8; var ra = dv.getUint16(o, true) / 65535 * 360, dec = dv.getInt16(o + 2, true) / 32767 * 90, m = dv.getInt16(o + 4, true) / 100, bv = dv.getInt16(o + 6, true) / 1000;
      var v = radec(ra, dec), c = bvRGB(bv); pos.set(v, i * 3); col.set(c, i * 3); mag[i * 3] = m; mag[i * 3 + 1] = 0; mag[i * 3 + 2] = 1; if (m < 4.6) list.push([v, m, c]);
    }
    for (var k = n; k < N; k++) { pos.set([0, 0, -1], k * 3); col.set([1, 1, 1], k * 3); mag[k * 3] = 30; mag[k * 3 + 1] = k < n + NPL ? 1 : 2; mag[k * 3 + 2] = 0; }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("aCol", new THREE.BufferAttribute(col, 3)); g.setAttribute("aMag", new THREE.BufferAttribute(mag, 3));
    g.attributes.position.setUsage(THREE.DynamicDrawUsage); g.attributes.aMag.setUsage(THREE.DynamicDrawUsage); g.attributes.aCol.setUsage(THREE.DynamicDrawUsage);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    SK.starN = n; SK.bright = list; return g;
  }
  function skStarsObject(geo) {
    var mat = skStarMat(); var pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = -2; pts.userData.noCull = true; pts.userData.noShadow = true; pts.name = "sky_stars";
    return pts;
  }
  // write the planets (and the satellites) into their slots of the Points buffer (a few floats per frame)
  function skWriteMovers() {
    var S = SK.pts; if (!S) return; var g = S.geometry, P = g.attributes.position, C = g.attributes.aCol, M = g.attributes.aMag; var n = SK.starN;
    for (var i = 0; i < NPL; i++) { var p = SK.planets[i]; var j = n + i; if (!p) continue; P.array.set(p.eq, j * 3); C.array.set(p.col, j * 3); M.array[j * 3] = p.mag; M.array[j * 3 + 2] = SK.planetOn ? 1 : 0; }
    for (var s = 0; s < NSAT; s++) { var st = SK.sat[s], j2 = n + NPL + s; if (st && st.eq) { P.array.set(st.eq, j2 * 3); M.array[j2 * 3] = st.mag; M.array[j2 * 3 + 2] = st.a; } else { M.array[j2 * 3 + 2] = 0; } }
    P.clearUpdateRanges(); P.addUpdateRange(n * 3, (NPL + NSAT) * 3); P.needsUpdate = true; C.clearUpdateRanges(); C.addUpdateRange(n * 3, (NPL + NSAT) * 3); C.needsUpdate = true; M.clearUpdateRanges(); M.addUpdateRange(n * 3, (NPL + NSAT) * 3); M.needsUpdate = true;
  }

  // ── constellations: IAU figures as anti-aliased screen-space quads (one draw) and the names as text quads from a canvas atlas (one draw) ──
  var CON_VERT = [
    "attribute vec3 iA; attribute vec3 iB; uniform mat3 uE2W; uniform vec2 uVP; uniform float uW; uniform float uGap; varying float vS; varying float vA; varying float vE;",
    "vec4 clipOf(vec3 e){ vec3 d = normalize(uE2W * e); return projectionMatrix * viewMatrix * vec4(cameraPosition + d * 70000.0, 1.0); }",
    "void main(){ vec3 dA = normalize(uE2W * iA), dB = normalize(uE2W * iB); vA = min(smoothstep(-0.02, 0.1, dA.y), smoothstep(-0.02, 0.1, dB.y));",
    // leave a small gap at each star (planetarium style)
    "  float L = acos(clamp(dot(iA, iB), -1.0, 1.0)); float g = min(uGap / max(L, 1e-4), 0.3); vec3 a = normalize(mix(iA, iB, g)), b = normalize(mix(iA, iB, 1.0 - g));",
    "  vec4 ca = clipOf(a), cb = clipOf(b); float e = 1.0; if (ca.w < 1.0 && cb.w < 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }",
    "  if (ca.w < 1.0) ca = mix(ca, cb, (1.0 - ca.w) / (cb.w - ca.w)); if (cb.w < 1.0) cb = mix(cb, ca, (1.0 - cb.w) / (ca.w - cb.w));",
    "  vec2 sa = ca.xy / ca.w * uVP * 0.5, sb = cb.xy / cb.w * uVP * 0.5; vec2 t = sb - sa; float tl = length(t); vec2 dir = tl > 1e-3 ? t / tl : vec2(1.0, 0.0); vec2 nrm = vec2(-dir.y, dir.x);",
    "  float side = position.y; float end = position.x; vec4 c = end < 0.5 ? ca : cb; vec2 s = (end < 0.5 ? sa : sb) + nrm * side * (uW * 0.5 + 1.0);",
    "  vS = side * (uW * 0.5 + 1.0); vE = e; gl_Position = vec4(s / (uVP * 0.5) * c.w, c.z, c.w); }"
  ].join("\n");
  var CON_FRAG = "uniform float uK; uniform float uW; uniform vec3 uCol; varying float vS; varying float vA; varying float vE; void main(){ float a = clamp(uW * 0.5 + 0.5 - abs(vS), 0.0, 1.0) * uK * vA; if (a < 0.004) discard; gl_FragColor = vec4(uCol * a, 1.0); }";
  var LAB_VERT = [
    "attribute vec3 iD; attribute vec4 iUV; attribute vec3 iSz; uniform mat3 uE2W; uniform vec2 uVP; uniform float uScale; varying vec2 vUv; varying float vA; varying float vKind;",
    "void main(){ vec3 d = normalize(uE2W * iD); vA = smoothstep(0.0, 0.12, d.y); vKind = iSz.z; vec4 c = projectionMatrix * viewMatrix * vec4(cameraPosition + d * 70000.0, 1.0); if (c.w < 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }",
    "  vec2 off = (position.xy + vec2(iSz.z > 0.5 ? 0.62 : 0.0, iSz.z > 0.5 ? 0.5 : 0.0)) * iSz.xy * uScale; vUv = vec2(mix(iUV.x, iUV.z, position.x + 0.5), mix(iUV.w, iUV.y, position.y + 0.5));",
    "  gl_Position = vec4(c.xy / c.w + off / (uVP * 0.5), c.z / c.w, 1.0); }"
  ].join("\n");
  var LAB_FRAG = "uniform sampler2D tAtlas; uniform float uK; uniform vec3 uCol; uniform vec3 uCol2; varying vec2 vUv; varying float vA; varying float vKind; void main(){ float a = texture2D(tAtlas, vUv).r * uK * vA; if (a < 0.01) discard; gl_FragColor = vec4((vKind > 0.5 ? uCol2 : uCol) * a, 1.0); }";
  var STAR_NAMES = [["Polaris", 37.95, 89.26], ["Sirius", 101.29, -16.72], ["Vega", 279.23, 38.78], ["Arcturus", 213.92, 19.18], ["Capella", 79.17, 46.0], ["Rigel", 78.63, -8.2], ["Betelgeuse", 88.79, 7.41], ["Procyon", 114.83, 5.22], ["Aldebaran", 68.98, 16.51], ["Antares", 247.35, -26.43], ["Altair", 297.7, 8.87], ["Deneb", 310.36, 45.28], ["Spica", 201.3, -11.16], ["Regulus", 152.09, 11.97], ["Fomalhaut", 344.41, -29.62], ["Pollux", 116.33, 28.03], ["Castor", 113.65, 31.89], ["Canopus", 95.99, -52.7], ["Achernar", 24.43, -57.24], ["Bellatrix", 81.28, 6.35], ["Mizar", 200.98, 54.93], ["Dubhe", 165.93, 61.75], ["Alnilam", 84.05, -1.2], ["Mira", 34.84, -2.98], ["Algol", 47.04, 40.96], ["Shaula", 263.4, -37.1], ["Rasalhague", 263.73, 12.56], ["Hamal", 31.79, 23.46], ["Denebola", 177.26, 14.57], ["Alphard", 141.9, -8.66]];
  function skBuildConst(data) {
    var segs = []; var L = data.lines; for (var k in L) L[k].forEach(function (line) { for (var i = 1; i < line.length; i++) segs.push([radec(line[i - 1][0], line[i - 1][1]), radec(line[i][0], line[i][1])]); });
    var base = new THREE.InstancedBufferGeometry(); base.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3)); base.setIndex([0, 1, 2, 0, 2, 3]);
    var A = new Float32Array(segs.length * 3), B = new Float32Array(segs.length * 3); segs.forEach(function (s, i) { A.set(s[0], i * 3); B.set(s[1], i * 3); });
    base.setAttribute("iA", new THREE.InstancedBufferAttribute(A, 3)); base.setAttribute("iB", new THREE.InstancedBufferAttribute(B, 3)); base.instanceCount = segs.length; base.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    var lm = new THREE.ShaderMaterial({ uniforms: { uE2W: { value: new THREE.Matrix3() }, uVP: { value: new THREE.Vector2(1280, 720) }, uW: { value: 1.4 }, uGap: { value: 0.5 * D2R }, uK: { value: 0 }, uCol: { value: new THREE.Color(0.32, 0.46, 0.72) } }, vertexShader: CON_VERT, fragmentShader: CON_FRAG, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false });
    var lines = new THREE.Mesh(base, lm); lines.frustumCulled = false; lines.renderOrder = -2; lines.userData.noCull = true; lines.userData.noShadow = true; lines.name = "sky_const_lines"; lines.visible = false;
    // the names: a canvas atlas (constellations in spaced capitals, bright stars in italics)
    var items = data.names.map(function (n) { return { t: n[1].toUpperCase().split("").join(" "), d: radec(n[2], n[3]), k: 0, rank: n[4] }; }).concat(STAR_NAMES.map(function (s) { return { t: s[0], d: radec(s[1], s[2]), k: 1, rank: 1 }; }));
    var cv = document.createElement("canvas"); cv.width = 2048; cv.height = 1024; var x = cv.getContext("2d"); x.fillStyle = "#000"; x.fillRect(0, 0, 2048, 1024); x.fillStyle = "#fff"; x.textBaseline = "middle";
    var px = 6, py = 4, rowH = 34; var uv = [];
    items.forEach(function (it) { x.font = it.k ? "italic 500 23px Georgia, serif" : "600 21px 'Segoe UI', system-ui, sans-serif"; var w = Math.ceil(x.measureText(it.t).width) + 8; if (px + w > 2044) { px = 6; py += rowH; } x.fillText(it.t, px + 4, py + rowH / 2); it.uv = [px / 2048, py / 1024, (px + w) / 2048, (py + rowH) / 1024]; it.w = w; px += w + 6; });
    var tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.NoColorSpace; tex.flipY = false; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
    var lg = new THREE.InstancedBufferGeometry(); lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3)); lg.setIndex([0, 1, 2, 0, 2, 3]);
    var D = new Float32Array(items.length * 3), U = new Float32Array(items.length * 4), Z = new Float32Array(items.length * 3);
    items.forEach(function (it, i) { D.set(it.d, i * 3); U.set([it.uv[0], it.uv[1], it.uv[2], it.uv[3]], i * 4); var s = it.k ? 0.62 : (it.rank === 1 ? 0.78 : it.rank === 2 ? 0.66 : 0.58); Z.set([it.w * s, rowH * s, it.k], i * 3); });
    lg.setAttribute("iD", new THREE.InstancedBufferAttribute(D, 3)); lg.setAttribute("iUV", new THREE.InstancedBufferAttribute(U, 4)); lg.setAttribute("iSz", new THREE.InstancedBufferAttribute(Z, 3)); lg.instanceCount = items.length; lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    var tm = new THREE.ShaderMaterial({ uniforms: { tAtlas: { value: tex }, uE2W: { value: lm.uniforms.uE2W.value }, uVP: { value: lm.uniforms.uVP.value }, uScale: { value: 1 }, uK: { value: 0 }, uCol: { value: new THREE.Color(0.42, 0.58, 0.86) }, uCol2: { value: new THREE.Color(0.86, 0.8, 0.62) } }, vertexShader: LAB_VERT, fragmentShader: LAB_FRAG, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false });
    var labels = new THREE.Mesh(lg, tm); labels.frustumCulled = false; labels.renderOrder = -2; labels.userData.noCull = true; labels.userData.noShadow = true; labels.name = "sky_const_names"; labels.visible = false;
    SK.conNames = items.length; return { lines: lines, labels: labels };
  }

  // ── star trails for the time-lapse: each bright star as an arc of line segments rotated about the pole on the GPU (one draw, only while used) ──
  var TRAIL_VERT = [
    "attribute vec3 aCol; attribute float aS; uniform mat3 uE2W; uniform vec3 uPole; uniform float uAng; uniform float uK; varying vec3 vC;",
    "void main(){ float a = aS * uAng; vec3 v = position * cos(a) + cross(uPole, position) * sin(a) + uPole * dot(uPole, position) * (1.0 - cos(a)); vec3 d = normalize(uE2W * v);",
    "  float fade = smoothstep(1.0, 0.75, aS) * smoothstep(-0.01, 0.06, d.y); vC = aCol * fade * uK;",
    "  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + d * 70000.0, 1.0); }"
  ].join("\n");
  function skBuildTrails() {
    var L = (SK.bright || []).filter(function (s) { return s[1] < (GX.tier >= 1 ? 4.6 : 3.8); }); var SEG = 28, n = L.length * SEG * 2;
    var pos = new Float32Array(n * 3), col = new Float32Array(n * 3), s = new Float32Array(n); var o = 0;
    L.forEach(function (st) { var b = Math.min(Math.pow(Math.pow(10, -0.4 * (st[1] - 1)), 0.5), 2.2) * 0.55; for (var k = 0; k < SEG; k++) for (var e = 0; e < 2; e++) { pos.set(st[0], o * 3); col.set([st[2][0] * b, st[2][1] * b, st[2][2] * b], o * 3); s[o] = (k + e) / SEG; o++; } });
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("aCol", new THREE.BufferAttribute(col, 3)); g.setAttribute("aS", new THREE.BufferAttribute(s, 1)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    var m = new THREE.ShaderMaterial({ uniforms: { uE2W: { value: SK.pts.material.uniforms.uE2W.value }, uPole: { value: new THREE.Vector3(0, 0, 1) }, uAng: { value: 0 }, uK: { value: 0 } }, vertexShader: TRAIL_VERT, fragmentShader: "varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }", transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false });
    var ls = new THREE.LineSegments(g, m); ls.frustumCulled = false; ls.renderOrder = -2; ls.userData.noCull = true; ls.userData.noShadow = true; ls.name = "sky_trails"; ls.visible = false; return ls;
  }

  // ── install: the sky uniforms (bound to 1 px stand-ins, so nothing recompiles when the real textures arrive), the small data now ──
  function setM3(m, A) { m.set(A[0], A[1], A[2], A[3], A[4], A[5], A[6], A[7], A[8]); return m; }
  function skInstallUniforms() {
    var U = skyMat.uniforms;
    U.uW2E = { value: new THREE.Matrix3() }; U.tSkyG = { value: px1([0, 0, 0]) }; U.tSkyC = { value: px1([255, 255, 255]) }; U.tMoon = { value: px1([140, 140, 140]) };
    U.uMap = { value: new THREE.Vector4(0, 0.1, 2.2, 1.1) }; U.uMap2 = { value: new THREE.Vector4(1.5, 1, 1, 0) }; U.uMap3 = { value: new THREE.Vector4(1, 0.2, 0.8, 0.1) }; U.uMap4 = { value: new THREE.Vector4(2048, 1024, 0.03, 0) }; U.uNightK = { value: new THREE.Vector4(1, 0, 1, 1) };
    U.uMoonSun = { value: new THREE.Vector3(1, 0, 0) }; U.uMoonN = { value: new THREE.Vector3(0, 1, 0) }; U.uMoonP = { value: new THREE.Vector4(0.0072, 0.5, 0, 2.0) }; U.uMoonTint = { value: new THREE.Color(0.55, 0.6, 0.72) };
    U.uMetA = { value: [new THREE.Vector4(), new THREE.Vector4()] }; U.uMetB = { value: [new THREE.Vector4(1, 0, 0, 0), new THREE.Vector4(1, 0, 0, 0)] }; U.uTele = { value: new THREE.Vector4(0, 0, 400, 0) }; U.uZodi = { value: new THREE.Vector4(0, -1, 0, 0) }; U.uSkyX = { value: new THREE.Vector4(0, 1, 1, 0) };
  }
  function skInstall() {
    SK.tier = GX.bootTier; var maxT = 4096; try { maxT = renderer.capabilities.maxTextureSize; } catch (e) {}
    SK.res = SK.tier >= 2 && maxT >= 8192 ? "8k" : SK.tier >= 1 ? "4k" : "2k"; SK.cres = SK.tier >= 1 ? "2k" : "1k";
    SK.planetOn = true; SK.satOn = SK.tier >= 1; SK.metOn = true;
    var m = /[?&]skydate=(\d{4})-(\d{2})-(\d{2})/.exec(location.search); if (m) SK.date = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    if (!SK.pts && !SK.loading) {
      SK.loading = true;
      skFetch(SKDIR + "stars.bin", "buf").then(function (buf) {
        if (!GX.installed) return; SK.pts = skStarsObject(skBuildStars(buf)); scene.add(SK.pts); SK.trails = skBuildTrails(); scene.add(SK.trails); SK.loaded.stars = 1; skMarkReady();
      }).catch(function (e) { skNote("stars", e); });
      skFetch(SKDIR + "const.json", "json").then(function (d) { if (!GX.installed) return; SK.con = skBuildConst(d); scene.add(SK.con.lines); scene.add(SK.con.labels); SK.loaded.con = 1; }).catch(function (e) { skNote("constellations", e); });
      skImage(SKDIR + "moon_1k.jpg").then(function (im) { if (!GX.installed) return; SKT.moon = skTex(im, { srgb: false, clampS: true }); skyMat.uniforms.tMoon.value = SKT.moon; SK.loaded.moon = 1; }).catch(function (e) { skNote("moon", e); });
    } else if (SK.pts) { scene.add(SK.pts); if (SK.trails) scene.add(SK.trails); if (SK.con) { scene.add(SK.con.lines); scene.add(SK.con.labels); } }
    if (SKT.moon && SKT.moon.isTexture) skyMat.uniforms.tMoon.value = SKT.moon; if (SKT.G && SKT.C) { skyMat.uniforms.tSkyG.value = SKT.G; skyMat.uniforms.tSkyC.value = SKT.C; SK.mapState = 4; SK.mapWant = SK.mapK = 1; PS_API.mapReady = true; }
    GX.n.skyR4 = SK.res;
    // the image credits, visible in the settings panel (ESO asks for its credit line in a visible place; CC BY 4.0)
    try { var st = document.getElementById("settings"); if (st && !document.getElementById("gfx-sky-credit")) { var cr = document.createElement("div"); cr.id = "gfx-sky-credit"; cr.className = "k mono"; cr.style.cssText = "margin-top:10px;opacity:.55;font-size:10px;line-height:1.4";
      cr.textContent = "Night sky: Milky Way photograph ESO/S. Brunier (CC BY 4.0); star maps NASA/GSFC SVS; star catalogue d3-celestial (Hipparcos); Moon NASA LRO; telescope views NASA, ESA, Hubble (CC BY 4.0)."; st.appendChild(cr); } } catch (e) {}
  }
  function skUninstall() {
    [SK.pts, SK.trails, SK.con && SK.con.lines, SK.con && SK.con.labels].forEach(function (o) { if (o && o.parent) o.parent.remove(o); });
    SK.tele.slice().forEach(function (t) { try { t.dispose(); } catch (e) {} }); if (SK.teleWarm) { try { SK.teleWarm.dispose(); } catch (e) {} SK.teleWarm = null; }
    sgRestore();
  }
  function skMarkReady() { if (SK.loaded.stars) { PS_API.ready = true; var q = PS_API._q.splice(0); q.forEach(function (f) { try { f(PS_API); } catch (e) { skNote("onReady", e); } }); } }
  // the big map: after the loading screen has gone (plus a moment), decoded off-thread, uploaded in two quiet frames, cross-faded in
  function skLoadOff() { var L = document.getElementById("load"); return !L || L.classList.contains("off"); }
  // R21 RP: the two maps (8k / 4k grey, 2k colour) were each uploaded in one texImage2D from an ImageBitmap: three converts the
  // bitmap to the texture's format on the main thread (RGBA to R8 for the grey map), 33 to 39 ms frames in play. Now a worker
  // decodes the JPEG (createImageBitmap, the same decoder and flags as before), draws it 1:1 into an OffscreenCanvas and hands back
  // the bytes (only the red channel for the grey map); they go up in strips of about 2 MB a frame into an immutable texture
  // (texStorage2D) made the way three makes it (format, sRGB, wrap, filters, anisotropy), the mip chain is built on the GPU at the
  // end, and three is given the finished texture to bind. Without a worker or OffscreenCanvas, or on any error, the R20 path runs.
  // Opt-in (?rpsky=1) until proven; ?rp=0: the R20 path.
  var SKW = { on: /[?&]rpsky=1(&|$)/.test(location.search) && !/[?&]rp=0(&|$)/.test(location.search) && typeof Worker === "function" && typeof OffscreenCanvas === "function" && typeof createImageBitmap === "function", w: null, id: 0, cb: {}, n: { strips: 0, ms: 0, msMax: 0 } };
  GX.skw = SKW;
  SKW.verify = function (which) {   // test: "G" or "C"; resolves { px, diff, maxd }
    var t = which === "C" ? SKT.C : SKT.G; if (!t) return Promise.resolve("no map"); var R = renderer, gl = R.getContext(), url = SKDIR + (which === "C" ? "sky_gc_" + SK.cres : "sky_gl_" + SK.res) + ".jpg";
    return skImage(url).then(function (im) { var o = which === "C" ? { srgb: true } : { red: true }; var t2 = skTex(im, o); t2.generateMipmaps = false; t2.minFilter = THREE.LinearFilter; R.initTexture(t2);
      var rd = function (tx, w, h) { var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx, 0); var a = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); return a; };
      var w = t.image.width, h = Math.min(512, t.image.height), A = rd(R.properties.get(t).__webglTexture, w, h), B = rd(R.properties.get(t2).__webglTexture, w, h); R.setRenderTarget(R.getRenderTarget());
      var n = 0, mx = 0; for (var i = 0; i < A.length; i++) { if ((i & 3) === 3) continue; var d = Math.abs(A[i] - B[i]); if (d) { n++; if (d > mx) mx = d; } }
      t2.dispose(); try { im.close(); } catch (e) {} return { which: which, w: w, rows: h, diff: n, maxd: mx }; });
  };
  var SKW_SRC = "self.onmessage=function(e){var d=e.data;createImageBitmap(new Blob([d.buf],{type:'image/jpeg'}),{imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'}).then(function(b){var w=b.width,h=b.height,c=new OffscreenCanvas(w,h),x=c.getContext('2d',{willReadFrequently:true});x.imageSmoothingEnabled=false;x.drawImage(b,0,0);b.close();var px=x.getImageData(0,0,w,h).data,out;if(d.red){out=new Uint8Array(w*h);for(var i=0,j=0;i<out.length;i++,j+=4)out[i]=px[j];}else out=new Uint8Array(px.buffer);self.postMessage({id:d.id,w:w,h:h,data:out},[out.buffer]);}).catch(function(er){self.postMessage({id:d.id,err:String(er&&er.message||er)});});};";
  function skwDecode(url, red) {
    return skFetch(url, "buf").then(function (buf) { return new Promise(function (res, rej) {
      if (!SKW.w) { SKW.w = new Worker(URL.createObjectURL(new Blob([SKW_SRC], { type: "text/javascript" }))); SKW.w.onmessage = function (e) { var f = SKW.cb[e.data.id]; delete SKW.cb[e.data.id]; if (f) f(e.data); }; }
      var id = ++SKW.id; SKW.cb[id] = function (r) { if (r.err) rej(new Error(r.err)); else res(r); }; SKW.w.postMessage({ id: id, buf: buf, red: red }, [buf]); }); });
  }
  // an immutable texture of the decoded bytes, filled a strip a frame; done() hands it to three
  function skwTex(r, o) {
    var R = renderer, gl = R.getContext(), t = skTex(null, o); t.image = { width: r.w, height: r.h, data: null };
    var levels = 1 + Math.floor(Math.log2(Math.max(r.w, r.h))), ifmt = o.red ? gl.R8 : (o.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8), fmt = o.red ? gl.RED : gl.RGBA, bpp = o.red ? 1 : 4;
    var tex = gl.createTexture(); R.state.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, levels, ifmt, r.w, r.h);
    var rows = Math.max(1, Math.floor(2097152 / (r.w * bpp))), y = 0;
    return { t: t, done: false, step: function () {
      var t0 = performance.now(); R.state.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      try { gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE); } catch (e) {}
      var hh = Math.min(rows, r.h - y); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, r.w, hh, fmt, gl.UNSIGNED_BYTE, r.data.subarray(y * r.w * bpp, (y + hh) * r.w * bpp)); y += hh; SKW.n.strips++;
      if (y >= r.h) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, t.wrapS === THREE.RepeatWrapping ? gl.REPEAT : gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        try { var ex = R.extensions.get("EXT_texture_filter_anisotropic"); if (ex && t.anisotropy > 1) gl.texParameterf(gl.TEXTURE_2D, ex.TEXTURE_MAX_ANISOTROPY_EXT, t.anisotropy); } catch (e) {}
        var P = R.properties.get(t); P.__webglTexture = tex; P.__webglInit = true; P.__version = t.version;   // three binds it as its own
        t.addEventListener("dispose", function () { try { gl.deleteTexture(tex); } catch (e) {} R.properties.remove(t); });
        r.data = null; this.done = true; }
      var ms = performance.now() - t0; SKW.n.ms += ms; if (ms > SKW.n.msMax) SKW.n.msMax = ms; } };
  }
  function skMapStep(now) {
    if (SK.mapState === undefined) SK.mapState = 0;
    // R5: the sky maps' ImageBitmaps are closed after upload, so a lost-and-restored WebGL context cannot re-upload them: drop the
    // textures, fall back to the procedural sky and fetch the maps again (the browser cache makes it quick)
    if (!SK.cxHook && renderer && renderer.domElement) { SK.cxHook = 1; renderer.domElement.addEventListener("webglcontextrestored", function () { try { if (SK.mapState !== 4) return; var U0 = skyMat.uniforms; U0.tSkyG.value = px1([0, 0, 0]); U0.tSkyC.value = px1([255, 255, 255]); [SKT.G, SKT.C].forEach(function (t) { try { if (t) t.dispose(); } catch (e) {} }); SKT.G = SKT.C = null; SK.mapK = SK.mapWant = 0; SK.offAt = 0; SK.mapState = 0; PS_API.mapReady = false; } catch (e) { skNote("restore", e); } }, false); }
    // desktop: once the map is in, the telescope's programs are compiled in the background (a hidden view keeps them alive), so the
    // first telescopeView() does not stall on shader links
    if (SK.mapState === 4 && !SK.warm && SK.tier >= 1 && SK.pts && now - (SK.mapT0 || 0) > 12000) { SK.warm = 1; try { var W = new TeleView([0, 1, 0], 1, { live: false, size: 16 }); var wi = SK.tele.indexOf(W); if (wi >= 0) SK.tele.splice(wi, 1); SK.teleWarm = W;
      (renderer.compileAsync ? renderer.compileAsync(W.scene, W.cam) : Promise.resolve(renderer.compile(W.scene, W.cam))).then(function () { renderer.compile(W.qs, W.qc); W.quad.material = W.scr; renderer.compile(W.qs, W.qc); W.quad.material = W.fin; SK.warmed = 1; }).catch(function (e) { skNote("tele warm", e); }); } catch (e) { skNote("tele warm", e); } }
    if (SK.mapState === 0) { if (!skLoadOff()) { SK.offAt = 0; return; } if (!SK.offAt) SK.offAt = now; if (now - SK.offAt < 2500 && !SK.mapNow) return; SK.mapState = 1; SK.mapT0 = now;
      if (SKW.on) { Promise.all([skwDecode(SKDIR + "sky_gc_" + SK.cres + ".jpg", false), skwDecode(SKDIR + "sky_gl_" + SK.res + ".jpg", true)]).then(function (r) { SK.mapRaw = r; SK.mapState = 6; })
          .catch(function (e) { skNote("map worker", e); SKW.on = false; SK.mapState = 0; SK.mapNow = true; }); return; }   /* any failure: the R20 path from the start */
      Promise.all([null, skImage(SKDIR + "sky_gc_" + SK.cres + ".jpg"), skImage(SKDIR + "sky_gl_" + SK.res + ".jpg")]).then(function (r) { SK.mapImgs = r; SK.mapState = 3; }).catch(function (e) { skNote("map", e); SK.mapState = 9; });
      return; }
    if (SK.mapState === 6) { try { busyGuard(); } catch (e) { return; }
      try { if (!SK.upG) { SK.upG = skwTex(SK.mapRaw[1], { red: true, aniso: SK.tier >= 2 ? 8 : SK.tier >= 1 ? 4 : 1 }); SK.upC = skwTex(SK.mapRaw[0], { srgb: true }); }
        var u = !SK.upG.done ? SK.upG : SK.upC; u.step();
        if (SK.upG.done && SK.upC.done) { SKT.G = SK.upG.t; SKT.C = SK.upC.t; SK.upG = SK.upC = null; SK.mapRaw = null; var U6 = skyMat.uniforms; U6.tSkyG.value = SKT.G; U6.tSkyC.value = SKT.C; SK.mapWant = 1; SK.mapState = 4; SK.mapMs = Math.round(now - SK.mapT0); PS_API.mapReady = true; } }
      catch (e) { skNote("map strips", e); SKW.on = false; SK.upG = SK.upC = null; SK.mapRaw = null; SK.mapState = 0; SK.mapNow = true; }
      return; }
    if (SK.mapState === 3) { try { busyGuard(); } catch (e) { return; } SKT.G = skTex(SK.mapImgs[2], { red: true, aniso: SK.tier >= 2 ? 8 : SK.tier >= 1 ? 4 : 1 }); try { renderer.initTexture(SKT.G); } catch (e) { skNote("upload G", e); } SK.mapState = 5; return; }
    if (SK.mapState === 5) { SKT.C = skTex(SK.mapImgs[1], { srgb: true }); try { renderer.initTexture(SKT.C); } catch (e) { skNote("upload C", e); }
      var U = skyMat.uniforms; U.tSkyG.value = SKT.G; U.tSkyC.value = SKT.C; SK.mapWant = 1; SK.mapState = 4; SK.mapMs = Math.round(now - SK.mapT0);
      SK.mapImgs.forEach(function (im) { try { if (im && im.close) im.close(); } catch (e) {} }); SK.mapImgs = null; PS_API.mapReady = true; }
  }
  // a heavy moment (a camera cut in the fly-in, an interior entry) postpones the upload by a frame
  function busyGuard() { try { if (typeof FLY !== "undefined" && FLY.on && FLY.cutAt && performance.now() - FLY.cutAt < 1500) throw 0; } catch (e) { if (e === 0) throw e; } }

  // ── the per-frame update (inside the client's updateSky, after the GFX sky): matrices, bodies, uniforms, the night key light ──
  var SKC = { m3: null, v: null, frame: 0 };
  function skUpdate(dt, el, S, nightK) {
    var U = skyMat.uniforms; var now = performance.now(); var K = GX.K.sk; SKC.frame++;
    var dtR = SKC.last ? clamp((now - SKC.last) / 1000, 0, 0.5) : 0; SKC.last = now;   // fades run on wall time (slow frames do not stretch them)
    if (!SKC.m3) { SKC.m3 = new THREE.Matrix3(); SKC.v = new THREE.Vector3(); }
    skMapStep(now);
    // stargazing and time-lapse smoothing
    var sg = SK.sg; var sgT = sg.on ? 1 : 0; var fade = Math.max(0.2, sg.opts.fade || 2.0); sg.k += clamp(sgT - sg.k, -dtR / fade, dtR / fade); var g = sstep(0, 1, sg.k);
    skTimeLapse(dtR);
    SK.mapK += clamp(SK.mapWant - SK.mapK, -dtR / 2.5, dtR / 2.5);
    var conT = SK.conOn ? 1 : 0; SK.conK += clamp(conT - SK.conK, -dtR / 0.8, dtR / 0.8);
    // time, matrices
    var ms = skyMs(); var jd = skJD(ms); SK.jd = jd; SK.ms = ms;
    var E2W = SK.E2W = skyMatrix(jd); var W2E = SK.W2E = m3t(E2W); setM3(U.uW2E.value, W2E);
    // Sun, Moon (topocentric), planets
    var sn = sunPos(jd), mo = moonPos(jd); var sunW = v3n(m3v(E2W, sn.eq));
    var mg = m3v(E2W, mo.eq); var mtx = [mg[0] * mo.r, mg[1] * mo.r - 1, mg[2] * mo.r]; var mdist = Math.hypot(mtx[0], mtx[1], mtx[2]); var mt = [mtx[0] / mdist, mtx[1] / mdist, mtx[2] / mdist];
    var elong = Math.acos(clamp(v3dot(sn.eq, mo.eq), -1, 1)); var illum = (1 - Math.cos(elong)) / 2; var ph = 180 - elong * R2D;
    var eclN = [0, -SE, CE]; var waxing = v3dot(v3cross(sn.eq, mo.eq), eclN) > 0;
    var mrad = 1737.4 / (mdist * 6378.14);
    SK.moon = { dir: mt, illum: illum, radius: mrad, alt: Math.asin(clamp(mt[1], -1, 1)) * R2D, az: (Math.atan2(mt[0], -mt[2]) * R2D + 360) % 360, waxing: waxing, mag: -12.73 + 0.026 * Math.abs(ph) + 4e-9 * Math.pow(ph, 4), eq: mo.eq, dist: mdist };
    SK.sunW = sunW; SK.sun = { dir: sunW, alt: Math.asin(clamp(sunW[1], -1, 1)) * R2D, eq: sn.eq };
    if (SKC.frame % 3 === 1 || !SK.planets.length) { SK.planets = planetPos(jd); SK.moons = galilean(jd); }
    var moonUp = sstep(-0.025, 0.06, mt[1]); var moonB = Math.pow(illum, 1.35) * sstep(-0.03, 0.3, mt[1]);
    SK.moonBright = moonB;
    // sky uniforms: the Moon
    U.uMoonDir.value.fromArray(mt); U.uMoonSun.value.fromArray(sunW); var mn = m3v(E2W, eclN); U.uMoonN.value.fromArray(mn);
    U.uMoonP.value.set(mrad * K.moonScale, illum, clamp(mix(0.5, 1, sstep(0.0, 0.4, nightK)) * moonUp, 0, 1), K.moonLit);
    // the night: stars, map, moonlit sky, airglow
    var dark = sstep(-0.1, -0.36, el) * sstep(0.05, 0.9, nightK); SK.dark = dark;
    var vis = sstep(0.0, 0.3, nightK) * (1 - S);
    U.uNightK.value.set(1 + 0.4 * g, moonB * nightK * (1 - S * 0.7) * K.moonSky, K.airglow, 1);
    U.uMap.value.set(SK.mapK, K.glowBlack + K.glowBlackMoon * moonB + K.glowBlackTw * (1 - sstep(0.3, 0.9, nightK)), K.glowGamma, K.glowGain * (1 + 0.35 * g) * (1 - 0.85 * moonB) * Math.pow(dark, 1.6));
    var twK = (1 - dark) * sstep(0.02, -0.06, el); SK.twK = twK;   // R15: the twilight after sunset (1 until the stars come out, 0 in the dark)
    U.uMap2.value.set(K.glowSat, SK.pts ? 0 : 1, K.glowShoulder, K.envNight * (0.5 + 0.5 * moonB) + (K.twEnv || 0) * twK);
    var tw2 = SK.res === "8k" ? 8192 : SK.res === "4k" ? 4096 : 2048; U.uMap3.value.set(K.glowSoft || 1, K.glowLocal, K.glowDens * 1.6, 0.1); U.uMap4.value.set(tw2, tw2 / 2, K.dither, 1 / K.glowScale);
    // R5: the zodiacal light from the real Sun once it is well down (and the game's night is dark), weaker under the Moon; the 22 degree
    // halo on humid nights (deterministic per date: a third of the monsoon nights, one in ten otherwise); the airglow band
    { var sd2 = sstep(-0.22, -0.33, sunW[1]); U.uZodi.value.set(sunW[0], sunW[1], sunW[2], K.zodi * dark * sd2 * (1 - 0.8 * moonB) * (1 - S));
      var dn = Math.floor(ms / 86400000 - 0.29); if (SK.humidDay !== dn) { SK.humidDay = dn; var mo = new Date(ms).getUTCMonth(); var hr = Math.abs(Math.sin(dn * 12.9898) * 43758.5453) % 1; SK.humidK = hr < (mo >= 6 && mo <= 8 ? 0.33 : 0.1) ? 0.6 + 0.4 * (hr * 7 % 1) : 0; }
      U.uSkyX.value.set(K.moonHalo * (SK.humidSet !== undefined && SK.humidSet !== null ? SK.humidSet : (SK.humidK || 0)) * moonB * moonUp * nightK, K.airglowBand * (1 - 0.7 * moonB), 1 / (SK.nE || 1), 0); }
    // moonless nights are dark like the photo (only the warm pockets of artificial light), the grade's lift follows the Moon
    GR.night[5] = mix(K.liftDark, 0.007, Math.max(moonB, 1 - nightK)); GR.night[7] = K.nightPiv; GR.blue[7] = K.twPiv; GR.storm[7] = mix(K.nightPiv, 0.5, sstep(-0.2, 0.05, el));
    // the distant haze at night: the client's ramp keeps a purple dusk until 21:00; once it is dark the haze is the night sky's navy
    try { var fh = SKC.fh || (SKC.fh = new THREE.Color()); fh.setRGB(mix(K.fogNight[0], K.fogMoon[0], moonB), mix(K.fogNight[1], K.fogMoon[1], moonB), mix(K.fogNight[2], K.fogMoon[2], moonB)); var fk = dark * (1 - S) * 0.9; scene.fog.color.lerp(fh, fk); if (typeof POST !== "undefined" && POST.hazeCol) POST.hazeCol.lerp(fh, fk); } catch (e) {}
    try { var pk = mix(K.pebbleDark, 1, Math.max(moonB, 1 - nightK)); if (NEAR.pebbles) NEAR.pebbles.material.emissive.multiplyScalar(pk); if (NEAR.rocks) NEAR.rocks.material.emissive.multiplyScalar(pk); } catch (e) {}
    // meteors
    if (!SK.showerAt || now - SK.showerAt > 1000) { SK.shower = skShower(ms); SK.showerAt = now; }
    skMeteors(dt, now, nightK, S, E2W, moonB);
    // the catalogue stars, the planets, the satellites
    if (SK.pts) {
      var P = SK.pts.material.uniforms; setM3(P.uE2W.value, E2W);
      P.uLim.value = mix(0.6, K.starLim - K.starMoonLim * moonB + 0.45 * g, Math.pow(dark, 0.8)); P.uGain.value = K.starGain * (1 + 0.3 * g) / (SK.nE || 1); P.uVis.value = vis; P.uTime.value = now / 1000; if (P.uStarK) P.uStarK.value.set(K.starPow, K.planetGlow, K.starSigma, K.starCap); if (P.uWing) P.uWing.value = K.starWing;
      try { P.uPR.value = renderer.getPixelRatio(); } catch (e) {}
      P.uMoonDir.value.fromArray(mt); P.uMoon.value.set(mrad * K.moonScale, moonB * moonUp);
      skSatellites(dt, now, el, nightK, W2E); skWriteMovers();
      SK.pts.visible = vis > 0.001 || SK.tele.length > 0;
    }
    if (SK.con) {
      var cu = SK.con.lines.material.uniforms, lu = SK.con.labels.material.uniforms; setM3(cu.uE2W.value, E2W);
      var dw = renderer.domElement.width, dh = renderer.domElement.height; cu.uVP.value.set(dw, dh); var pr = 1; try { pr = renderer.getPixelRatio(); } catch (e) {}
      cu.uW.value = 1.3 * pr; lu.uScale.value = pr; var ck = SK.conK * (0.25 + 0.75 * sstep(0.0, 0.5, nightK)) * (1 - 0.6 * S); cu.uK.value = ck * K.conLine; lu.uK.value = ck;
      SK.con.lines.visible = SK.con.labels.visible = ck > 0.003;
    }
    if (SK.trails) skTrailUniforms(E2W);
    // the night key light: the real Moon when it is up (scaled by its phase), a soft high sky light when it is down
    SK.keyDir = null; SK.keyK = 1; SK.fillK = 1;
    if (el < -0.02) {
      var phaseK = K.starKey + (1 - K.starKey) * Math.pow(illum, 1.5); var up = sstep(0.0, 0.16, mt[1]);
      var md = [mt[0], Math.max(mt[1], 0.12), mt[2]]; md = v3n(md); var skyD = v3n([0.22, 0.95, 0.2]);
      var kd = v3n([mix(skyD[0], md[0], up), mix(skyD[1], md[1], up), mix(skyD[2], md[2], up)]);
      SK.keyDir = kd; SK.keyK = mix(K.starKey, phaseK * K.moonKey, up); SK.fillK = mix(K.starFill, K.moonFill, up); var sc = K.starCol, mc = K.moonCol; SK.keyCol = [mix(sc[0], mc[0], up), mix(sc[1], mc[1], up), mix(sc[2], mc[2], up)];
      // R15: after sunset the fill follows the twilight sky (it rises from 1 to K.twFill while the client's fill falls, so the blue hour
      // stays lit), then eases to the night's fill once the stars are out; continuous at the hand-over (1 at el = -0.02)
      var twF = mix(1, K.twFill, sstep(-0.02, -0.12, el)); SK.fillK = mix(SK.fillK, twF, 1 - dark); SK.keyK = mix(SK.keyK, Math.max(SK.keyK, K.twKey || 0), (1 - dark) * sstep(-0.02, -0.08, el));
    }
    try { var nf = sstep(0.1, 0.9, nightK) * K.fillNeutral; if (nf > 0) hemi.color.lerp(SKC.c || (SKC.c = new THREE.Color()), 0).lerp(SKC.c.setRGB(K.fillCol[0], K.fillCol[1], K.fillCol[2]), nf); } catch (e) {}
    // stargazing: the world's artificial light, the bloom, the clouds
    SK.lightK = 1 - (1 - (sg.opts.lights === undefined ? 0.35 : sg.opts.lights)) * g; PS_API.lightK = SK.lightK; skLights(SK.lightK);
    if (CL) { var cu2 = CL.mesh.material.uniforms; if (cu2.uFadeK) cu2.uFadeK.value = (1 - g * (sg.opts.clouds === "keep" ? 0 : 1) * (1 - sstep(0.1, 0.5, S))) * mix(1, mix(K.nightCloud0, K.nightCloud1, moonB), nightK * (1 - S)); }
    if (GX.post && GX.post.fin && POST.mFinal.uniforms.uBloomK) { var F = POST.mFinal.uniforms; F.uBloomK.value = 1 - (1 - (sg.opts.bloom === undefined ? 0.75 : sg.opts.bloom)) * g; F.uSkyGradeK.value = sstep(0.05, 0.6, nightK); F.uGSatSky.value = K.skySat * (1 + 0.08 * g); }
    for (var ti = 0; ti < SK.tele.length; ti++) { var tv = SK.tele[ti]; if (tv.live) tv._due = true; }
  }
  // stargazing dims the world's artificial light: every emissive material, additive glow and point / spot light is scaled just
  // for the frame's render and restored right after it (nothing compounds, other modules keep driving their own values)
  var SGL = { mats: [], lights: [], at: 0, saved: null, buf: [] };
  function sgScan() {
    var mats = new Set(), lights = [];
    // only lights that render (the client's light pool; its source lights are hidden and copied into the pool every frame)
    scene.traverse(function (o) { if (o.isPointLight || o.isSpotLight) { if (o.visible) lights.push(o); return; } var m = o.material; if (!m) return; var arr = Array.isArray(m) ? m : [m];
      for (var i = 0; i < arr.length; i++) { var x = arr[i]; if (!x || x.isShaderMaterial) continue; if (x.emissive && x.emissiveIntensity > 0 && x.emissive.r + x.emissive.g + x.emissive.b > 0.02) mats.add(x); else if (x.isMeshBasicMaterial && x.blending === THREE.AdditiveBlending) mats.add(x); } });
    SGL.mats = Array.from(mats); SGL.lights = lights; SGL.at = performance.now();
  }
  // R5 fix (the black world with white halos): the client's Light.intensity getter reports the STORED value x 1.7 (point, spot)
  // while its setter stores what it is given, so saving .intensity and writing it back multiplied every light by 1.7 per stargazing
  // frame until it overflowed to Infinity; in the shader Infinity x 0 = NaN for every lit pixel. Lights are scaled and restored
  // through the stored field (_intensity) now, and a missed restore is completed before the next apply.
  function sgApply(k) {
    if (SGL.saved) sgRestore();
    if (!(k < 0.999)) return; if (!SGL.at || performance.now() - SGL.at > 4000) { try { sgScan(); } catch (e) { skNote("stargaze scan", e); } }
    var S = SGL.saved = SGL.buf; S.length = 0;   // one array, reused (no allocation per frame)
    for (var i = 0; i < SGL.mats.length; i++) { var m = SGL.mats[i]; if (m.isMeshBasicMaterial) { S.push(m, 0, m.opacity); m.opacity *= k; } else { S.push(m, 1, m.emissiveIntensity); m.emissiveIntensity *= k; } }
    for (var j = 0; j < SGL.lights.length; j++) { var l = SGL.lights[j]; if (l._intensity !== undefined) { S.push(l, 3, l._intensity); l._intensity = l._intensity * k; } else { S.push(l, 2, l.intensity); l.intensity = l.intensity * k; } }
  }
  function sgRestore() { var S = SGL.saved; if (!S) return; SGL.saved = null; for (var i = 0; i < S.length; i += 3) { var o = S[i], t = S[i + 1], v = S[i + 2]; if (t === 0) o.opacity = v; else if (t === 1) o.emissiveIntensity = v; else if (t === 3) o._intensity = v; else o.intensity = v; } }
  // guard: a light whose stored value is not finite (or absurd) is switched off and reported, so one bad value can never turn
  // every lit pixel into NaN; the rendered pool every frame (11 lights), every source light every 2 s
  var LG = { at: 0, n: 0 };
  function lgCol(c) { var s = c.r + c.g + c.b; return s >= 0 && s < 1e5; }
  function lgBad(l) { var v = l._intensity !== undefined ? l._intensity : l.intensity; return !(v >= 0 && v < 1e5) || !lgCol(l.color) || (l.groundColor && !lgCol(l.groundColor)); }
  function lgFix(l, where) { if (l._intensity !== undefined) l._intensity = 0; else l.intensity = 0; if (!lgCol(l.color)) l.color.setRGB(1, 1, 1); if (l.groundColor && !lgCol(l.groundColor)) l.groundColor.setRGB(0.2, 0.2, 0.2); LG.n++; if (LG.n <= 3 || (LG.n % 100) === 0) note("light guard", where + " light reset (" + (l.name || l.type) + "), " + LG.n + " so far"); }
  function lightGuard(now) {
    try {
      // the key, fill and moon lights and the cascades, the fog and the haze colours (one bad value would blacken every lit pixel)
      if (typeof hemi !== "undefined" && hemi && lgBad(hemi)) lgFix(hemi, "fill");
      if (typeof sun !== "undefined" && sun && lgBad(sun)) lgFix(sun, "key");
      if (typeof CSMX !== "undefined" && CSMX.on && CSMX.csm) { var CL2 = CSMX.csm.lights; for (var ci = 0; ci < CL2.length; ci++) if (lgBad(CL2[ci])) lgFix(CL2[ci], "cascade"); var ld = CSMX.csm.lightDirection; if (!(Math.abs(ld.x) + Math.abs(ld.y) + Math.abs(ld.z) > 1e-6)) { ld.set(-0.22, -0.95, -0.2).normalize(); note("light guard", "cascade direction reset"); } }
      if (scene.fog && !lgCol(scene.fog.color)) { scene.fog.color.setRGB(0.02, 0.03, 0.06); note("light guard", "fog colour reset"); }
      if (typeof POST !== "undefined" && POST.hazeCol && !lgCol(POST.hazeCol)) { POST.hazeCol.setRGB(0.02, 0.03, 0.06); note("light guard", "haze colour reset"); }
      if (!(scene.environmentIntensity >= 0 && scene.environmentIntensity < 100)) { scene.environmentIntensity = 0.7; note("light guard", "environment intensity reset"); }
      if (typeof LIGHTS === "undefined" || !LIGHTS.ready) return;
      var P = LIGHTS.pool, Q = LIGHTS.spool, i;
      for (i = 0; i < P.length; i++) if (lgBad(P[i])) lgFix(P[i], "pooled");
      for (i = 0; i < Q.length; i++) if (lgBad(Q[i])) lgFix(Q[i], "pooled spot");
      if (now - LG.at > 2000) { LG.at = now; var S = LIGHTS.src || []; for (i = 0; i < S.length; i++) if (lgBad(S[i])) lgFix(S[i], "source"); }
    } catch (e) {}
  }
  function skLights(k) { if (k < 0.999) { try { WIN.u.uNight.value *= k; } catch (e) {} } }

  // ── meteors: sporadic ones now and then, many more during the real showers (radiating from the real radiant) ──
  var SHOWERS = [["Quadrantids", 1, 3, 12, 28, 110, 230.1, 48.5, 1.2], ["Lyrids", 4, 22, 8, 8, 18, 271.4, 33.6, 2], ["Eta Aquariids", 5, 6, 17, 22, 50, 338, -1, 5], ["Delta Aquariids", 7, 30, 18, 24, 25, 340, -16, 6], ["Perseids", 8, 12, 26, 12, 100, 48.2, 58.1, 3],
    ["Draconids", 10, 8, 2, 2, 10, 262, 54, 1], ["Orionids", 10, 21, 19, 17, 20, 95.3, 15.6, 5], ["Leonids", 11, 17, 11, 13, 15, 152.3, 21.6, 3], ["Geminids", 12, 14, 10, 6, 150, 113.2, 32.2, 2], ["Ursids", 12, 22, 5, 4, 10, 217, 75.3, 1.5]];
  // [name, peak month, peak day, days active before, days after, ZHR, radiant RA, Dec, profile width (days)]
  function skShower(ms) {
    var best = null, bz = 0; var d = new Date(ms - 7 * 3600000); var y = d.getUTCFullYear();
    SHOWERS.forEach(function (s) { [y - 1, y, y + 1].forEach(function (yy) { var pk = Date.UTC(yy, s[1] - 1, s[2], 12) + 7 * 3600000; var dd = (ms - pk) / 86400000; if (dd < -s[3] || dd > s[4]) return; var z = s[5] * Math.exp(-Math.abs(dd) / s[8]); if (z > bz) { bz = z; best = { name: s[0], zhr: z, peakZhr: s[5], ra: s[6], dec: s[7], days: dd }; } }); });
    return best;
  }
  function skMeteors(dt, now, nightK, S, E2W, moonB) {
    var U = skyMat.uniforms; var met = SK.met;
    for (var i = 0; i < 2; i++) { var m = met[i]; var B = U.uMetB.value[i]; if (!m) { B.w = 0; continue; } var t = m.hold !== undefined ? m.hold : (now - m.t0) / 1000 / m.dur; if (t >= 1) { met[i] = null; B.w = 0; continue; }
      U.uMetA.value[i].set(m.a[0], m.a[1], m.a[2], t); B.set(m.b[0], m.b[1], m.b[2], m.br * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.6)); }
    if (!SK.metOn || nightK < 0.5 || S > 0.3) return;
    if (!SK.metNext) SK.metNext = now + 5000 + Math.random() * 20000;
    if (now < SK.metNext) return;
    var sh = SK.shower; var radW = null, z = 0;
    if (sh) { radW = v3n(m3v(E2W, radec(sh.ra, sh.dec))); z = sh.zhr * Math.max(0.12, radW[1]); }
    var rate = (1 + z / 12) / 60 * (1 - 0.5 * moonB) * (SK.sg.on ? 1.3 : 1);   // per real second
    SK.metNext = now + (-Math.log(1 - Math.random() * 0.999) / rate) * 1000;
    var slot = met[0] ? (met[1] ? -1 : 1) : 0; if (slot < 0) return;
    var useSh = radW && radW[1] > -0.05 && Math.random() < z / 12 / (1 + z / 12);
    for (var tries = 0; tries < 12; tries++) {
      var a, dir;
      if (useSh) { var rho = (10 + Math.random() * 60) * D2R, pa = Math.random() * Math.PI * 2; var t1 = v3n(v3cross(radW, Math.abs(radW[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), t2 = v3cross(radW, t1);
        var off = [t1[0] * Math.cos(pa) + t2[0] * Math.sin(pa), t1[1] * Math.cos(pa) + t2[1] * Math.sin(pa), t1[2] * Math.cos(pa) + t2[2] * Math.sin(pa)];
        a = v3n([radW[0] * Math.cos(rho) + off[0] * Math.sin(rho), radW[1] * Math.cos(rho) + off[1] * Math.sin(rho), radW[2] * Math.cos(rho) + off[2] * Math.sin(rho)]); dir = v3n(v3cross(v3cross(radW, a), a)); dir = [-dir[0], -dir[1], -dir[2]];
        if (v3dot(dir, v3n([a[0] - radW[0], a[1] - radW[1], a[2] - radW[2]])) < 0) dir = [-dir[0], -dir[1], -dir[2]]; }
      else { var az = Math.random() * Math.PI * 2, alt = (22 + Math.random() * 60) * D2R; a = [Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)]; var q = Math.random() * Math.PI * 2; var e1 = v3n(v3cross(a, [0, 1, 0])), e2 = v3cross(e1, a); dir = v3n([e1[0] * Math.cos(q) + e2[0] * Math.sin(q), e1[1] * Math.cos(q) + e2[1] * Math.sin(q) - 0.25, e1[2] * Math.cos(q) + e2[2] * Math.sin(q)]); }
      var L = (4 + Math.random() * 16) * D2R; var b = v3n([a[0] * Math.cos(L) + dir[0] * Math.sin(L), a[1] * Math.cos(L) + dir[1] * Math.sin(L), a[2] * Math.cos(L) + dir[2] * Math.sin(L)]);
      if (a[1] < 0.2 || b[1] < 0.1) continue;
      var r = Math.random(); met[slot] = { a: a, b: b, t0: now, dur: 0.22 + L * R2D / 28 + Math.random() * 0.25, br: 0.5 + 3.4 * Math.pow(r, 6), shower: useSh ? sh.name : "" }; SK.metCount = (SK.metCount || 0) + 1; break;
    }
  }
  // ── satellites: now and then a steady point crossing the early or late night sky, sometimes fading into the Earth's shadow ──
  function skSatellites(dt, now, el, nightK, W2E) {
    for (var i = 0; i < NSAT; i++) { var s = SK.sat[i]; if (!s) continue; var t = (now - s.t0) / 1000 * s.w; if (t > Math.PI) { SK.sat[i] = null; continue; }
      var th = t - Math.PI / 2; var w = [s.c[0] * Math.cos(th) + s.tg[0] * Math.sin(th), s.c[1] * Math.cos(th) + s.tg[1] * Math.sin(th), s.c[2] * Math.cos(th) + s.tg[2] * Math.sin(th)];
      s.eq = m3v(W2E, w); s.a = (1 - sstep(s.ecl - 0.06, s.ecl + 0.06, t / Math.PI)) * sstep(0, 0.04, t / Math.PI) * sstep(0.3, 0.6, nightK); }
    if (!SK.satOn || nightK < 0.4 || el < -0.62) return;   // satellites shine in sunlight: the first and last hours of the night
    if (!SK.satNext) SK.satNext = now + 15000 + Math.random() * 40000; if (now < SK.satNext) return; SK.satNext = now + 40000 + Math.random() * 70000;
    var slot = !SK.sat[0] ? 0 : !SK.sat[1] ? 1 : -1; if (slot < 0) return;
    var A0 = Math.random() * Math.PI * 2, hm = (20 + Math.random() * 65) * D2R; var c = [Math.sin(A0) * Math.cos(hm), Math.sin(hm), -Math.cos(A0) * Math.cos(hm)]; var tg = [Math.cos(A0), 0, Math.sin(A0)]; if (Math.random() < 0.5) tg = [-tg[0], 0, -tg[2]];
    SK.sat[slot] = { c: c, tg: tg, t0: now, w: (0.6 + Math.random() * 0.6) * D2R, mag: 2.6 + Math.random() * 2, ecl: Math.random() < 0.55 ? 0.5 + Math.random() * 0.45 : 2, a: 0, eq: null };
  }
  // ── time-lapse: the sky turns faster for a while; star trails draw the arc it swept; afterwards the sky eases back to the clock ──
  function skTimeLapse(dt) {
    var T = SK.tl; var trK = 0;
    if (T) {
      var now = performance.now(); var active = !T.stopAt || now < T.stopAt;
      if (active) { var add = dt * 1000 * (T.speed - 1) * 60; SK.tlOff += add; T.swept += add; T.k = Math.min(1, T.k + dt / 0.6); }
      else if (!T.keep) { SK.tlOff *= Math.exp(-dt / 0.45); if (Math.abs(SK.tlOff) < 20000) SK.tlOff = 0; T.k = Math.max(0, T.k - dt / 1.6); if (T.k <= 0 && SK.tlOff === 0) SK.tl = null; }
      else { T.k = Math.max(0, T.k - dt / 2.5); if (T.k <= 0) SK.tl = null; }
      trK = T.trails ? T.k : 0; SK.trailAng = Math.min(T.swept / 86164090.5 * 2 * Math.PI, (T.maxHours || 3) / 23.934 * 2 * Math.PI);
    }
    SK.trailK = trK;
  }
  function skTrailUniforms(E2W) {
    var u = SK.trails.material.uniforms; u.uK.value = SK.trailK * GX.K.sk.trailGain; SK.trails.visible = SK.trailK > 0.002 && SK.trailAng > 0.002;
    if (!SK.trails.visible) return; var P = precess((SK.jd - 2451545.0) / 36525); u.uPole.value.set(P[6], P[7], P[8]).normalize(); u.uAng.value = SK.trailAng;
  }

  // ── telescope views: the sky re-rendered through a narrow field (the map at full resolution, crisp catalogue and procedural faint stars,
  //    the Moon with the 2k LRO map, planets as lit discs, NASA/ESA images for the showcase deep-sky objects), tracked on the target ──
  var DSO_IMG = {   // file, RA, Dec (image centre, deg), width, height (arcmin), north rotation (deg, + = image north left of vertical), black level, gain, mask
    M42: ["tele_m42.jpg", 83.79054, -5.41398, 30.03, 30.03, 0, 0.1, 0.62, 0], M31: ["tele_m31.jpg", 10.75225, 41.26087, 362, 234.12, 1.9, 0.08, 0.8, 1], M13: ["tele_m13.jpg", 250.4198, 36.45978, 3.53, 3.53, 0, 0.03, 0.9, 0]
  };
  var PLEIADES = [[56.871, 24.105, 1.0], [57.291, 24.053, 0.45], [56.219, 24.113, 0.6], [56.457, 24.368, 0.7], [56.582, 23.948, 1.0], [56.302, 24.467, 0.35], [57.297, 24.137, 0.25]];
  var DSO_VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
  var DSO_FRAG = [
    "uniform sampler2D tImg; uniform vec4 uP; uniform vec2 uAsp; uniform vec2 uSt[7]; uniform float uStW[7]; varying vec2 vUv;", GLSL_NOISE,
    "void main(){ vec2 q = vUv * 2.0 - 1.0; vec3 c = vec3(0.0); float m = 1.0;",
    "  if (uP.z < 1.5) { vec3 t = texture2D(tImg, vec2(vUv.x, 1.0 - vUv.y)).rgb; t = pow(t, vec3(2.2)); c = max(t - uP.x, 0.0) / (1.0 - uP.x); c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 0.72);",
    "    if (uP.z < 0.5) m = smoothstep(0.98, 0.62, length(q)); else { vec2 e = vec2(q.x * uAsp.x, q.y * uAsp.y); float a = radians(35.0 + 90.0); vec2 r = vec2(cos(a) * e.x - sin(a) * e.y, sin(a) * e.x + cos(a) * e.y); m = smoothstep(1.0, 0.55, length(r / vec2(1.75, 0.62))); }",
    "  } else if (uP.z < 2.5) {",
    // the Pleiades' blue reflection nebula: glow round the bright members, streaked
    "    float s = 0.0; for (int i = 0; i < 7; i++) { vec2 d = q - uSt[i]; float r = length(d); s += uStW[i] * (exp(-r / 0.07) * 0.75 + exp(-r / 0.22) * 0.2); }",
    "    float n = gNoise(vec2(q.x * 3.0 + q.y * 5.0, q.y * 2.0 - q.x * 1.5) * 4.0) * 0.6 + gNoise(q * 23.0) * 0.4; float str = 0.6 + 0.8 * smoothstep(0.3, 0.8, gNoise(vec2(q.x * 9.0 + q.y * 14.0, q.x * 2.0 - q.y * 3.0)));",
    "    c = vec3(0.32, 0.5, 1.0) * s * n * str * 0.09; m = smoothstep(1.0, 0.7, length(q));",
    "  } else { float r = length(q); c = vec3(1.0, 0.95, 0.86) * (exp(-r * r / 0.004) * 0.12 + exp(-r / 0.08) * 0.035 + exp(-r / 0.25) * 0.006);",
    "    float px = fwidth(q.x); for (int k = 0; k < 2; k++) { float sc = k == 0 ? 90.0 : 180.0; vec2 g = q * sc; vec2 id = floor(g); float h = gHash(id + float(k) * 17.0); vec2 sp = (id + 0.2 + 0.6 * vec2(gHash(id + 3.1), gHash(id + 7.7))) / sc; float rs = length(sp);",
    "      float dens = clamp(1.6 / (1.0 + pow(rs / 0.06, 2.0)) - 0.02, 0.0, 0.92) * (1.0 - smoothstep(0.55, 0.95, rs)); if (h < dens) { float d = length(q - sp); float sz = max(px * 0.8, 0.0015); float b = 0.25 + 0.75 * pow(gHash(id + 5.3), 3.0); c += mix(vec3(1.0, 0.86, 0.66), vec3(0.8, 0.88, 1.0), gHash(id + 9.9)) * b * exp(-d * d / (sz * sz)) * (k == 0 ? 1.0 : 0.55); } } }",
    "  gl_FragColor = vec4(c * m * uP.y * uP.w, 1.0); }"
  ].join("\n");
  var PLA_FRAG = [
    "uniform sampler2D tImg; uniform float uType; uniform vec3 uSunL; uniform float uObl; uniform float uSinB; uniform float uK; uniform float uR; varying vec2 vUv;", GLSL_NOISE,
    "vec3 globe(vec2 q, out float a){ vec2 g = vec2(q.x, q.y / (1.0 - uObl)); float r2 = dot(g, g); a = 0.0; if (r2 >= 1.0) return vec3(0.0); float z = sqrt(1.0 - r2); vec3 n = vec3(g, z);",
    "  float px = fwidth(q.x) * 1.5; a = smoothstep(1.0, 1.0 - 2.0 * px, sqrt(r2)); float mu = dot(n, normalize(uSunL)); float lit = smoothstep(-0.03, 0.06, mu) * (0.35 + 0.65 * pow(max(mu, 0.0), 0.5)); float limb = pow(z, 0.35); vec3 col;",
    "  float lat = asin(clamp(g.y, -1.0, 1.0));",
    "  if (uType < 0.5) col = vec3(0.62, 0.58, 0.54) * (0.8 + 0.3 * gNoise(g * 9.0));",
    "  else if (uType < 1.5) col = vec3(0.98, 0.95, 0.86) * (0.95 + 0.05 * gNoise(g * 4.0));",
    "  else if (uType < 2.5) { float lon = atan(g.x, z); float alb = gNoise(vec2(lon * 2.2 + 1.3, lat * 3.0)) * 0.6 + gNoise(vec2(lon * 6.0, lat * 7.0)) * 0.4; col = mix(vec3(0.78, 0.42, 0.24), vec3(0.42, 0.26, 0.18), smoothstep(0.45, 0.7, alb)); col = mix(col, vec3(0.95, 0.94, 0.92), smoothstep(1.2, 1.32, abs(lat))); }",
    "  else if (uType < 3.5) { col = texture2D(tImg, vec2(0.5 + q.x * 0.4954, 0.5 - q.y * 0.4954)).rgb; col = pow(col, vec3(2.2)) * 1.25; limb = 1.0; }",
    "  else { float b = sin(lat * 15.0) * 0.5 + 0.5; float b2 = sin(lat * 37.0 + 1.0) * 0.5 + 0.5; col = mix(vec3(0.86, 0.76, 0.56), vec3(0.74, 0.62, 0.44), b * 0.55 + b2 * 0.2); col = mix(col, vec3(0.62, 0.66, 0.68), smoothstep(1.05, 1.35, abs(lat)) * 0.6); }",
    "  return col * lit * limb; }",
    // Saturn's rings: C, B, the Cassini division, A with the Encke gap, at the real opening angle; in front of or behind the globe
    "vec4 rings(vec2 q, out float zr){ zr = -1e3; float sb = uSinB; if (abs(sb) < 0.002) sb = 0.002 * sign(sb + 1e-6); float cb = sqrt(1.0 - sb * sb); float z = -q.y * cb / sb; float r = length(vec3(q, z)); zr = z;",
    "  float px = fwidth(q.x) * 1.2 / max(abs(sb), 0.02); float A = smoothstep(2.03 - px, 2.03 + px, r) * smoothstep(2.27 + px, 2.27 - px, r) * (1.0 - 0.8 * exp(-pow((r - 2.214) / 0.008, 2.0))) * 0.62;",
    "  float Bv = smoothstep(1.53 - px, 1.53 + px, r) * smoothstep(1.95 + px, 1.95 - px, r) * (0.85 + 0.15 * sin(r * 60.0)); float Cv = smoothstep(1.24, 1.26, r) * smoothstep(1.53, 1.51, r) * 0.16;",
    "  float a = clamp(A + Bv + Cv, 0.0, 1.0); return vec4(vec3(0.92, 0.86, 0.72) * (A * 1.0 + Bv * 1.15 + Cv), a); }",
    "void main(){ vec2 q = (vUv * 2.0 - 1.0) * uR; float ga; vec3 g = globe(q, ga); vec4 col = vec4(g, ga);",
    "  if (uType > 3.5) { float zr; vec4 rg = rings(q, zr); float zg = ga > 0.0 ? sqrt(max(0.0, 1.0 - dot(vec2(q.x, q.y / (1.0 - uObl)), vec2(q.x, q.y / (1.0 - uObl))))) : -1e3; if (zr > zg || ga <= 0.0) col.rgb = mix(col.rgb, rg.rgb, rg.a); col.a = max(col.a, rg.a);",
    "  }",
    "  if (col.a < 0.01) discard; gl_FragColor = vec4(col.rgb * uK, col.a); }"
  ].join("\n");
  var TELE_FIN = [
    "uniform sampler2D tCol; uniform float uExpo; uniform float uMask; varying vec2 vUv;",
    "vec3 agx(vec3 v){ const mat3 inset = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104); const mat3 outset = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);",
    "  v = inset * max(v, 0.0); v = clamp(log2(max(v, 1e-10)), -12.47393, 4.026069); v = (v + 12.47393) / (4.026069 + 12.47393); vec3 x2 = v * v, x4 = x2 * x2; v = 15.5 * x4 * x2 - 40.14 * x4 * v + 31.96 * x4 - 6.868 * x2 * v + 0.4298 * x2 + 0.1191 * v - 0.00232; v = outset * v; return pow(max(v, 0.0), vec3(2.2)); }",
    "void main(){ vec3 c = texture2D(tCol, vUv).rgb; if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0); c = agx(c * uExpo); float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, 0.92) * vec3(0.97, 0.98, 1.05);",
    "  float r = length(vUv - 0.5) * 2.0; float m = uMask > 0.5 ? smoothstep(1.0, 0.975, r) : 1.0; c *= m * mix(1.0, 0.78, smoothstep(0.55, 1.0, r) * uMask); gl_FragColor = vec4(c, max(m, 1.0 - uMask)); }"
  ].join("\n");
  var TELE_SCREEN = "uniform sampler2D tCol; varying vec2 vUv; void main(){ vec4 c = texture2D(tCol, vUv); vec3 s = mix(c.rgb * 12.92, 1.055 * pow(c.rgb, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c.rgb)); gl_FragColor = vec4(s, c.a); }";
  var TDEF = { Moon: 0.75, Mercury: 0.02, Venus: 0.05, Mars: 0.025, Jupiter: 0.15, Saturn: 0.045, M42: 0.6, M31: 3.4, M45: 1.7, M13: 0.3, "Milky Way core": 14, Polaris: 0.6 };
  function skTeleImg(file) { if (SKT.img[file]) return SKT.img[file]; var t = new THREE.Texture(); t.colorSpace = THREE.NoColorSpace; SKT.img[file] = t; skImage(SKDIR + file).then(function (im) { t.image = im; t.flipY = false; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true; t.userData.ok = 1; }).catch(function (e) { skNote("tele " + file, e); }); return t; }
  function quadBasis(obj, c, north, dist, w, h, rotDeg) {
    var Z = [-c[0], -c[1], -c[2]]; var N = v3n([north[0] - c[0] * v3dot(north, c), north[1] - c[1] * v3dot(north, c), north[2] - c[2] * v3dot(north, c)]); var X = v3cross(c, N);
    if (rotDeg) { var a = -rotDeg * D2R, ca = Math.cos(a), sa = Math.sin(a); var N2 = [N[0] * ca + X[0] * sa, N[1] * ca + X[1] * sa, N[2] * ca + X[2] * sa]; X = v3cross(c, N2); N = N2; }
    var m = new THREE.Matrix4().makeBasis(new THREE.Vector3(X[0], X[1], X[2]), new THREE.Vector3(N[0], N[1], N[2]), new THREE.Vector3(Z[0], Z[1], Z[2]));
    obj.matrixAutoUpdate = false; obj.matrix.copy(m).setPosition(c[0] * dist, c[1] * dist, c[2] * dist); obj.matrix.scale(new THREE.Vector3(2 * dist * Math.tan(w / 2), 2 * dist * Math.tan(h / 2), 1)); obj.matrixWorldNeedsUpdate = true;
  }
  function TeleView(target, fov, opts) {
    var T = this; opts = opts || {}; T.opts = opts; T.size = opts.size || 512; T.live = opts.live !== false; T.mask = opts.mask !== false; T.up = opts.up || "north";
    var HF = THREE.HalfFloatType; T.rt = new THREE.WebGLRenderTarget(T.size, T.size, { type: HF, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    T.out = new THREE.WebGLRenderTarget(T.size, T.size, { colorSpace: THREE.SRGBColorSpace, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false }); T.texture = T.out.texture;
    T.cam = new THREE.PerspectiveCamera(1, 1, 10, 200000); T.scene = new THREE.Scene();
    var sky = new THREE.Mesh(new THREE.SphereGeometry(150000, 32, 16), skyMat); sky.frustumCulled = false; T.scene.add(sky); T.skyMesh = sky;
    if (SK.pts) { T.pts = new THREE.Points(SK.pts.geometry, SK.pts.material); T.pts.frustumCulled = false; T.scene.add(T.pts); }
    // Jupiter's moons (steady points) and the planet discs, the deep-sky showcases
    var mg = new THREE.BufferGeometry(); mg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3)); mg.setAttribute("aCol", new THREE.BufferAttribute(new Float32Array([1, 0.98, 0.92, 1, 0.98, 0.92, 1, 0.96, 0.9, 1, 0.98, 0.95]), 3)); mg.setAttribute("aMag", new THREE.BufferAttribute(new Float32Array([2.6, 3, 1, 2.9, 3, 1, 2.3, 3, 1, 3.2, 3, 1]), 3));
    if (SK.pts) { T.gm = new THREE.Points(mg, SK.pts.material); T.gm.frustumCulled = false; T.gm.visible = false; T.scene.add(T.gm); }
    T.pl = PLAN_NAMES.map(function (nm, i) { var m = new THREE.ShaderMaterial({ uniforms: { tImg: { value: i === 3 ? skTeleImg("tele_jupiter.jpg") : px1([0, 0, 0]) }, uType: { value: i }, uSunL: { value: new THREE.Vector3(0, 0, 1) }, uObl: { value: PLAN_INFO[nm][5] }, uSinB: { value: 0.1 }, uK: { value: 1 }, uR: { value: i === 4 ? 2.35 : 1.02 } }, vertexShader: DSO_VERT, fragmentShader: PLA_FRAG, transparent: true, depthWrite: false, depthTest: false });
      var q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m); q.frustumCulled = false; q.renderOrder = 5; q.visible = false; T.scene.add(q); return q; });
    T.dso = [];
    Object.keys(DSO_IMG).forEach(function (k) { var D = DSO_IMG[k]; var m = new THREE.ShaderMaterial({ uniforms: { tImg: { value: skTeleImg(D[0]) }, uP: { value: new THREE.Vector4(D[6], D[7], D[8], 0) }, uAsp: { value: new THREE.Vector2(1, D[4] / D[3]) }, uSt: { value: [] }, uStW: { value: [] } }, vertexShader: DSO_VERT, fragmentShader: DSO_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
      for (var s = 0; s < 7; s++) { m.uniforms.uSt.value.push(new THREE.Vector2()); m.uniforms.uStW.value.push(0); }
      var q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m); q.frustumCulled = false; q.renderOrder = 3; T.scene.add(q); T.dso.push({ k: k, q: q, D: D, eq: radec(D[1], D[2]) }); });
    // the Pleiades' nebula and the unresolved light of M13 (procedural)
    [["M45", 56.75, 24.12, 110, 2], ["M13g", 250.4235, 36.4613, 16, 3]].forEach(function (p) { var m = new THREE.ShaderMaterial({ uniforms: { tImg: { value: px1([0, 0, 0]) }, uP: { value: new THREE.Vector4(0, 1, p[4], 0) }, uAsp: { value: new THREE.Vector2(1, 1) }, uSt: { value: [] }, uStW: { value: [] } }, vertexShader: DSO_VERT, fragmentShader: DSO_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
      var c0 = radec(p[1], p[2]); for (var s = 0; s < 7; s++) { var st = PLEIADES[s]; var dra = (st[0] - p[1]) * Math.cos(p[2] * D2R), dde = st[1] - p[2]; m.uniforms.uSt.value.push(new THREE.Vector2(-dra / (p[3] / 120), dde / (p[3] / 120))); m.uniforms.uStW.value.push(st[2]); }
      var q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m); q.frustumCulled = false; q.renderOrder = 2; T.scene.add(q); T.dso.push({ k: p[0], q: q, D: [null, p[1], p[2], p[3], p[3], 0], eq: c0 }); });
    T.fin = new THREE.ShaderMaterial({ uniforms: { tCol: { value: T.rt.texture }, uExpo: { value: 1 }, uMask: { value: T.mask ? 1 : 0 } }, vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }", fragmentShader: TELE_FIN, depthTest: false, depthWrite: false });
    T.scr = new THREE.ShaderMaterial({ uniforms: { tCol: { value: T.out.texture } }, vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }", fragmentShader: TELE_SCREEN, transparent: true, depthTest: false, depthWrite: false });
    T.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), T.fin); T.quad.frustumCulled = false; T.qs = new THREE.Scene(); T.qs.add(T.quad); T.qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    if (!SKT.moon2 && SK.tier >= 1) { SKT.moon2 = 1; skImage(SKDIR + "moon_2k.jpg").then(function (im) { SKT.moon2 = skTex(im, { srgb: false, clampS: true }); }).catch(function (e) { SKT.moon2 = null; skNote("moon 2k", e); }); }
    T.set(target, fov); SK.tele.push(T);
  }
  TeleView.prototype.set = function (target, fov) {
    var T = this; T.target = target; var nm = typeof target === "string" ? skResolve(target) : null; T.name = nm ? nm.name : null;
    if (!nm && Array.isArray(target)) { T.fixedW = v3n(target); T.eqTrack = this.opts.track ? m3v(SK.W2E || m3t(SK.E2W), T.fixedW) : null; }
    T.fov = fov || (T.name && TDEF[T.name]) || (nm && nm.kind === "star" ? 0.5 : 1.0); T.cam.fov = T.fov; T.cam.updateProjectionMatrix();
    T.expo = this.opts.exposure || (T.name === "Moon" ? 0.75 : T.name === "Milky Way core" ? 0.85 : nm && nm.kind === "planet" ? 0.9 : nm && nm.kind === "dso" ? 2.4 : 1.4); T._due = true; return T;
  };
  TeleView.prototype.dir = function () { var T = this; if (T.name) { var d = skDirOf(T.name); if (d) return d; } if (T.eqTrack) return v3n(m3v(SK.E2W, T.eqTrack)); return T.fixedW || [0, 1, 0]; };
  TeleView.prototype.render = function () {
    var T = this; if (T.disposed || !GX.installed) return T; var U = skyMat.uniforms; var c = T.dir(); T.lastDir = c; var E2W = SK.E2W; var K = GX.K.sk;
    var fovR = T.fov * D2R; var north = T.up === "zenith" ? [0, 1, 0] : v3n(m3v(E2W, [0, 0, 1]));
    T.cam.position.set(0, 0, 0); T.cam.up.set(north[0], north[1], north[2]); if (Math.abs(v3dot(north, c)) > 0.999) T.cam.up.set(0, 0, -1); T.cam.lookAt(c[0], c[1], c[2]); T.cam.updateMatrixWorld();
    // planets and Jupiter's moons
    for (var i = 0; i < T.pl.length; i++) { var q = T.pl[i], p = SK.planets[i]; if (!p) { q.visible = false; continue; } var pw = v3n(m3v(E2W, p.eq)); var ang = Math.acos(clamp(v3dot(pw, c), -1, 1)); var R = p.radius; var span = i === 4 ? 2.35 : 1.02;
      q.visible = ang < fovR * 0.75 + R * span && R * 2 / fovR > 0.004; if (!q.visible) continue; var pole = v3n(m3v(E2W, p.pole)); quadBasis(q, pw, pole, 50000, 2 * R * span, 2 * R * span, 0);
      var Z = [-pw[0], -pw[1], -pw[2]]; var N = v3n([pole[0] - pw[0] * v3dot(pole, pw), pole[1] - pw[1] * v3dot(pole, pw), pole[2] - pw[2] * v3dot(pole, pw)]); var X = v3cross(pw, N); var sw = v3n(m3v(E2W, p.sun));
      var u = q.material.uniforms; u.uSunL.value.set(v3dot(sw, X), v3dot(sw, N), v3dot(sw, Z)); u.uSinB.value = v3dot(pole, Z); u.uK.value = K.planetTele[i];
      if (i === 3 && T.gm) { var G = SK.moons || [], P = T.gm.geometry.attributes.position, M2 = T.gm.geometry.attributes.aMag; var Eeq = v3n(m3v(SK.W2E, X)), Neq = v3n(m3v(SK.W2E, N)), ceq = p.eq;
        for (var g = 0; g < 4; g++) { var mm = G[g]; if (!mm) continue; var dx = mm.x * R, dy = mm.y * R; P.array.set(v3n([ceq[0] + Eeq[0] * dx + Neq[0] * dy, ceq[1] + Eeq[1] * dx + Neq[1] * dy, ceq[2] + Eeq[2] * dx + Neq[2] * dy]), g * 3); M2.array[g * 3 + 2] = (mm.front || Math.abs(mm.x) > 1.05) ? 1 : 0; }
        P.needsUpdate = true; M2.needsUpdate = true; T.gm.visible = true; } }
    if (T.gm && !T.pl[3].visible) T.gm.visible = false;
    for (var k = 0; k < T.dso.length; k++) { var o = T.dso[k], D = o.D; var dw = v3n(m3v(E2W, o.eq)); var a2 = Math.acos(clamp(v3dot(dw, c), -1, 1)); var wR = D[3] / 60 * D2R, hR = D[4] / 60 * D2R;
      o.q.visible = a2 < fovR + Math.max(wR, hR) && wR / fovR > 0.02; if (!o.q.visible) continue; quadBasis(o.q, dw, north, 60000, wR, hR, D[5]); var img = o.q.material.uniforms.tImg.value; o.q.material.uniforms.uP.value.w = (D[0] && !(img.userData && img.userData.ok)) ? 0 : (o.k === "M13" ? sstep(0.4, 0.08, T.fov) : 1) * 1; }
    // the sky in telescope mode
    var sv = { tele: U.uTele.value.clone(), mp: U.uMoonP.value.clone(), mt: U.tMoon.value, env: U.uEnv ? U.uEnv.value : 0 }; var P2 = SK.pts && SK.pts.material.uniforms; var sv2 = P2 && P2.uTeleS.value.clone(); var svVis = P2 && P2.uVis.value;
    var cell = 512 / Math.max(fovR, 1e-4) / 14; cell = T.fov < 0.25 ? 0 : Math.min(8192, Math.pow(2, Math.round(Math.log2(cell))));
    U.uTele.value.set(1, fovR, cell, skTeleLod(fovR, T.size)); U.uMoonP.value.x = SK.moon ? SK.moon.radius : sv.mp.x; U.uMoonP.value.w = K.moonTele; if (SKT.moon2 && SKT.moon2.isTexture) U.tMoon.value = SKT.moon2;
    var svMap = U.uMap.value.clone(); U.uMap.value.y = Math.min(0.05, svMap.y + K.teleBlack); U.uMap.value.w = svMap.w * K.teleMapGain;
    var svPR = P2 ? P2.uPR.value : 1; if (P2) { P2.uTeleS.value.set(K.teleGain, K.teleLim, 1, 1); P2.uVis.value = Math.max(svVis, 0.15 * sstep(0.0, 0.3, U.kNight.value)); P2.uPR.value = 1; }
    var r = renderer, prevT = r.getRenderTarget(), prevAC = r.autoClear; var cc = new THREE.Color(); r.getClearColor(cc); var ca = r.getClearAlpha();
    try {
      r.setRenderTarget(T.rt); r.setClearColor(0x000000, 1); r.autoClear = true; r.render(T.scene, T.cam);
      T.fin.uniforms.uExpo.value = T.expo * (POST && POST.exposure ? POST.exposure / 0.7 : 1); T.quad.material = T.fin; r.setRenderTarget(T.out); r.render(T.qs, T.qc);
    } catch (e) { skNote("tele render", e); }
    finally { r.setRenderTarget(prevT); r.setClearColor(cc, ca); r.autoClear = prevAC; U.uTele.value.copy(sv.tele); U.uMap.value.copy(svMap); U.uMoonP.value.copy(sv.mp); U.tMoon.value = sv.mt; if (P2) { P2.uTeleS.value.copy(sv2); P2.uVis.value = svVis; P2.uPR.value = svPR; } }
    T._due = false; T.frames = (T.frames || 0) + 1; return T;
  };
  // draw the eyepiece on the game canvas after the frame (no read-back): rect in CSS pixels {x, y, size} (default: centred)
  TeleView.prototype.show = function (rect) { this.screen = rect || {}; this.live = true; return this; };
  TeleView.prototype.hide = function () { this.screen = null; return this; };
  TeleView.prototype.drawScreen = function () {
    var T = this; if (!T.screen) return; var r = renderer; var pr = r.getPixelRatio(); var W = r.domElement.width, H = r.domElement.height; var s = (T.screen.size || Math.min(W, H) / pr * 0.62) * pr;
    var x = T.screen.x !== undefined ? T.screen.x * pr : (W - s) / 2, y = T.screen.y !== undefined ? H - T.screen.y * pr - s : (H - s) / 2;
    var vp = new THREE.Vector4(); r.getViewport(vp); var sc = r.getScissorTest(); var prevT = r.getRenderTarget(), prevAC = r.autoClear;
    try { r.setRenderTarget(null); r.autoClear = false; r.setViewport(x / pr, y / pr, s / pr, s / pr); T.quad.material = T.scr; r.render(T.qs, T.qc); }
    catch (e) { skNote("tele screen", e); } finally { T.quad.material = T.fin; r.setViewport(vp); r.setScissorTest(sc); r.setRenderTarget(prevT); r.autoClear = prevAC; }
  };
  TeleView.prototype.toCanvas = function (cv) {
    var T = this; var n = T.size; var buf = new Uint8Array(n * n * 4); renderer.readRenderTargetPixels(T.out, 0, 0, n, n, buf); cv = cv || document.createElement("canvas"); cv.width = cv.height = n; var x = cv.getContext("2d"); var id = x.createImageData(n, n);
    for (var y = 0; y < n; y++) id.data.set(buf.subarray((n - 1 - y) * n * 4, (n - y) * n * 4), y * n * 4); x.putImageData(id, 0, 0); return cv;
  };
  TeleView.prototype.info = function () { var T = this; var d = T.lastDir || T.dir(); return { name: T.name, fov: T.fov, alt: Math.asin(clamp(d[1], -1, 1)) * R2D, az: (Math.atan2(d[0], -d[2]) * R2D + 360) % 360, frames: T.frames || 0 }; };
  TeleView.prototype.dispose = function () { var T = this; if (T.disposed) return; T.disposed = true; var i = SK.tele.indexOf(T); if (i >= 0) SK.tele.splice(i, 1); T.rt.dispose(); T.out.dispose(); T.fin.dispose(); T.scr.dispose(); T.skyMesh.geometry.dispose(); T.pl.forEach(function (q) { q.geometry.dispose(); q.material.dispose(); }); T.dso.forEach(function (o) { o.q.geometry.dispose(); o.q.material.dispose(); }); if (T.gm) T.gm.geometry.dispose(); T.quad.geometry.dispose(); };

  // ── names: the Moon, the planets, the showcase deep-sky objects, the Milky Way core, Polaris and the bright stars ──
  var DSO_LIST = [["M42", "Orion Nebula", 83.8221, -5.3911, 65, 4.0], ["M31", "Andromeda Galaxy", 10.6847, 41.2690, 190, 3.4], ["M45", "Pleiades", 56.75, 24.12, 110, 1.6], ["M13", "Hercules Globular Cluster", 250.4235, 36.4613, 20, 5.8],
    ["Milky Way core", "Galactic Center (Sagittarius)", 266.405, -28.936, 1200, 0], ["M8", "Lagoon Nebula", 270.9042, -24.3867, 90, 6.0], ["M44", "Beehive Cluster", 130.1, 19.67, 95, 3.7], ["M57", "Ring Nebula", 283.3963, 33.0292, 1.4, 8.8], ["M51", "Whirlpool Galaxy", 202.4696, 47.1952, 11, 8.4]];
  var ALIAS = { "orion nebula": "M42", "great orion nebula": "M42", andromeda: "M31", "andromeda galaxy": "M31", pleiades: "M45", "seven sisters": "M45", m13: "M13", "hercules cluster": "M13", "hercules globular cluster": "M13", "great hercules cluster": "M13",
    core: "Milky Way core", "milky way": "Milky Way core", "milky way core": "Milky Way core", "galactic center": "Milky Way core", "galactic centre": "Milky Way core", "lagoon nebula": "M8", "beehive": "M44", "ring nebula": "M57", "whirlpool": "M51", "north star": "Polaris", luna: "Moon" };
  function skResolve(name) {
    if (!name) return null; var s = String(name).trim(); var low = s.toLowerCase(); if (ALIAS[low]) { s = ALIAS[low]; low = s.toLowerCase(); }
    if (low === "moon") return { name: "Moon", kind: "moon" };
    for (var i = 0; i < PLAN_NAMES.length; i++) if (PLAN_NAMES[i].toLowerCase() === low) return { name: PLAN_NAMES[i], kind: "planet", i: i };
    for (var j = 0; j < DSO_LIST.length; j++) { var D = DSO_LIST[j]; if (D[0].toLowerCase() === low || D[1].toLowerCase() === low) return { name: D[0], kind: "dso", eq: radec(D[2], D[3]), title: D[1], size: D[4], mag: D[5] }; }
    for (var k = 0; k < STAR_NAMES.length; k++) if (STAR_NAMES[k][0].toLowerCase() === low) return { name: STAR_NAMES[k][0], kind: "star", eq: radec(STAR_NAMES[k][1], STAR_NAMES[k][2]) };
    return null;
  }
  function skDirOf(name) {
    var r = skResolve(name); if (!r) return null;
    if (r.kind === "moon") return SK.moon ? SK.moon.dir.slice() : null;
    if (r.kind === "planet") { var p = SK.planets[r.i]; return p ? v3n(m3v(SK.E2W, p.eq)) : null; }
    return v3n(m3v(SK.E2W, r.eq));
  }
  function altaz(d) { return { alt: Math.asin(clamp(d[1], -1, 1)) * R2D, az: (Math.atan2(d[0], -d[2]) * R2D + 360) % 360 }; }
  function raOf(eq) { return { ra: (Math.atan2(eq[1], eq[0]) * R2D + 360) % 360, dec: Math.asin(clamp(eq[2], -1, 1)) * R2D }; }
  function skTargets() {
    var out = []; function add(o, d, eq) { var h = altaz(d); var c = raOf(eq); o.alt = +h.alt.toFixed(2); o.az = +h.az.toFixed(2); o.dir = d.map(function (x) { return +x.toFixed(5); }); o.up = h.alt > 0; o.ra = +c.ra.toFixed(3); o.dec = +c.dec.toFixed(3); out.push(o); }
    if (SK.moon) add({ name: "Moon", kind: "moon", mag: +SK.moon.mag.toFixed(1), illum: +SK.moon.illum.toFixed(3), phase: skPhaseName(), size: +(SK.moon.radius * 2 * R2D * 60).toFixed(1), fov: TDEF.Moon }, SK.moon.dir, SK.moon.eq);
    SK.planets.forEach(function (p) { add({ name: p.name, kind: "planet", mag: +p.mag.toFixed(1), illum: +p.illum.toFixed(3), size: +(p.radius * 2 * R2D * 3600).toFixed(1), fov: TDEF[p.name], visible: SK.planetOn }, v3n(m3v(SK.E2W, p.eq)), p.eq); });
    DSO_LIST.forEach(function (D) { var eq = radec(D[2], D[3]); add({ name: D[0], title: D[1], kind: "dso", mag: D[5], size: D[4], fov: TDEF[D[0]] || Math.max(0.3, D[4] / 60 * 1.6) }, v3n(m3v(SK.E2W, eq)), eq); });
    STAR_NAMES.forEach(function (s) { var eq = radec(s[1], s[2]); add({ name: s[0], kind: "star", fov: 0.5 }, v3n(m3v(SK.E2W, eq)), eq); });
    return out;
  }
  function skPhaseName() { var m = SK.moon; if (!m) return ""; var k = m.illum; if (k < 0.03) return "new moon"; if (k > 0.97) return "full moon"; if (Math.abs(k - 0.5) < 0.06) return m.waxing ? "first quarter" : "last quarter"; return (m.waxing ? "waxing " : "waning ") + (k < 0.5 ? "crescent" : "gibbous"); }

  // ── window.PLAN_SKY: the stargazing API (see HANDOFF_R4_SKY.md) ──
  PS_API.humid = function (k) { SK.humidSet = k === undefined ? null : k; return SK.humidSet === null ? (SK.humidK || 0) : SK.humidSet; };   // the 22 degree halo: a humid night (0..1), null for the date's own
  PS_API.setStargaze = function (on, opts) { SK.sg.on = !!on; SK.sg.opts = opts || {}; if (on && opts && opts.constellations) SK.conOn = true; return SK.sg.on; };
  PS_API.constellations = function (on) { if (on !== undefined) SK.conOn = !!on; return SK.conOn; };
  PS_API.targets = function () { if (!SK.moon) return []; try { return skTargets(); } catch (e) { skNote("targets", e); return []; } };
  PS_API.dirTo = function (name) { if (!SK.moon) return null; var d = skDirOf(name); return d ? d.slice() : null; };
  // R16 integration: the real Sun for the client's light (written into a THREE.Vector3, no allocation); false until the sky is ready
  PS_API.sunInto = function (v) { var s = SK.sunW; if (!s || !SK.moon || !v) return false; v.set(s[0], s[1], s[2]); return true; };
  PS_API.altAz = function (name) { if (!SK.moon) return null; var d = skDirOf(name); return d ? altaz(d) : null; };
  PS_API.telescopeView = function (target, fov, opts) { if (!GX.installed) return null; try { var t = new TeleView(target, fov, opts); t.render(); return t; } catch (e) { skNote("telescopeView", e); return null; } };
  PS_API.timeLapse = function (o) {
    if (o === false || o === null || o === 0) { if (SK.tl) SK.tl.stopAt = performance.now(); return null; }
    if (typeof o === "number") o = { speed: o }; o = o || {}; var now = performance.now();
    SK.tl = { speed: Math.max(1, o.speed || 40), stopAt: o.seconds === 0 ? 0 : now + (o.seconds || 8) * 1000, trails: o.trails !== false, keep: !!o.keep, maxHours: o.maxHours || 3, swept: 0, k: SK.tl ? SK.tl.k : 0 };
    return SK.tl;
  };
  PS_API.setDate = function (d) { if (d === null || d === undefined) SK.date = null; else { var t = typeof d === "string" ? Date.parse(d.length <= 10 ? d + "T00:00:00Z" : d) : +d; var dd = new Date(t); SK.date = Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate()); } return SK.date; };
  PS_API.now = function () { var d = new Date(SK.ms || Date.now()); return { utc: d.toISOString(), local: new Date((SK.ms || Date.now()) - 7 * 3600000).toISOString().replace("Z", "-07:00"), jd: SK.jd, lstHours: ((SK.lst * R2D / 15) % 24 + 24) % 24, moon: SK.moon ? { illum: SK.moon.illum, phase: skPhaseName(), alt: SK.moon.alt, az: SK.moon.az } : null, shower: SK.shower || null, timeLapse: !!SK.tl }; };
  PS_API.moon = function () { return SK.moon ? { dir: SK.moon.dir.slice(), illum: SK.moon.illum, phase: skPhaseName(), alt: SK.moon.alt, az: SK.moon.az, radiusDeg: SK.moon.radius * R2D } : null; };
  PS_API.planets = function () { if (!SK.moon) return []; return SK.planets.map(function (p) { var d = v3n(m3v(SK.E2W, p.eq)); var h = altaz(d); return { name: p.name, dir: d, alt: h.alt, az: h.az, mag: p.mag, illum: p.illum, sizeArcsec: p.radius * 2 * R2D * 3600 }; }); };
  // a meteor now: random (sporadic or from tonight's shower), or placed {az, alt, len, angle (deg, 0 = straight down), bright, hold (0..1 frozen)}
  PS_API.meteor = function (o) { if (!o) { SK.metNext = performance.now(); return true; } var A = (o.az || 180) * D2R, E = (o.alt || 45) * D2R; var a = [Math.sin(A) * Math.cos(E), Math.sin(E), -Math.cos(A) * Math.cos(E)]; var e1 = v3n(v3cross(a, [0, 1, 0])), e2 = v3cross(e1, a); var q = (o.angle === undefined ? 30 : o.angle) * D2R; var dir = [e1[0] * Math.sin(q) - e2[0] * Math.cos(q), e1[1] * Math.sin(q) - e2[1] * Math.cos(q), e1[2] * Math.sin(q) - e2[2] * Math.cos(q)]; var L = (o.len || 12) * D2R;
    var b = v3n([a[0] * Math.cos(L) + dir[0] * Math.sin(L), a[1] * Math.cos(L) + dir[1] * Math.sin(L), a[2] * Math.cos(L) + dir[2] * Math.sin(L)]); var slot = SK.met[0] ? 1 : 0; SK.met[slot] = { a: a, b: b, t0: performance.now(), dur: o.dur || 0.8, br: o.bright || 1.5, hold: o.hold, shower: "" }; return SK.met[slot]; };
  PS_API.state = function () { return { ready: PS_API.ready, mapReady: !!PS_API.mapReady, res: SK.res, mapMs: SK.mapMs, stargaze: SK.sg.k, constellations: SK.conK, timeLapse: SK.tl ? SK.tl.k : 0, lightK: SK.lightK, tele: SK.tele.length, bytes: SK.bytes, meteors: SK.metCount || 0, stars: SK.starN, errs: SK.errs.length ? SK.errs : GX.errs.filter(function (e) { return /^sky /.test(e); }) }; };
  PS_API.K = GX.K.sk;

  // the night key light: the client points it at its own (fixed-path) moon; the real Moon (or the soft sky light) replaces the direction
  function skKeyDir(kd) {
    try {
      if (CSMX.on && CSMX.csm) { CSMX.csm.lightDirection.set(-kd[0], -kd[1], -kd[2]); }
      else if (typeof player !== "undefined" && player) { sun.position.copy(player.position).addScaledVector(TMP.v.set(kd[0], kd[1], kd[2]), 700); if (sun.position.y < player.position.y + 40) sun.position.y = player.position.y + 40; }
      else { sun.position.set(kd[0] * 900, Math.max(30, kd[1] * 900), kd[2] * 900); }
      var kc = SK.keyCol; if (kc) { if (CSMX.on && CSMX.csm) CSMX.csm.lights.forEach(function (l) { l.color.setRGB(kc[0], kc[1], kc[2]); }); else sun.color.setRGB(kc[0], kc[1], kc[2]); }
    } catch (e) {}
  }
  // the map's level of detail in the eyepiece: native for wide fields (the dust lanes), only the smooth local glow for narrow ones
  function skTeleLod(fovR, size) { var mapW = SK.res === "8k" ? 8192 : SK.res === "4k" ? 4096 : 2048; var tex = Math.max(1, fovR / (2 * Math.PI / mapW)); var fd = fovR * R2D; return mix(Math.max(0, Math.log2(tex / size)), Math.log2(tex) + GX.K.sk.teleMip, sstep(4, 0.8, fd)); }
  function skBeforeRender() { for (var i = 0; i < SK.tele.length; i++) { var t = SK.tele[i]; if (t._due && (t.live || !t.frames)) t.render(); } sgApply(SK.lightK); }
  function skAfterRender() { sgRestore(); for (var i = 0; i < SK.tele.length; i++) if (SK.tele[i].screen) SK.tele[i].drawScreen(); }

  // ═════════════════════════ install / uninstall ═════════════════════════
  function wrapGlobals() {
    if (!ORIG.updateSky) ORIG.updateSky = updateSky; if (!ORIG.renderFrame) ORIG.renderFrame = renderFrame; if (!ORIG.initPost) ORIG.initPost = initPost;
    var us = ORIG.updateSky, rf = ORIG.renderFrame, ip = ORIG.initPost;
    updateSky = function (dt) { us(dt); if (!GX.installed) return; try { afterSky(dt || 0); } catch (e) { if (!GX.skyErr) { GX.skyErr = 1; note("afterSky", e); } } };
    renderFrame = function () { var sv = typeof POST !== "undefined" ? POST.sunVis : 0; try { beforeRender(); skBeforeRender(); if (GX.storm.k > 0 && typeof POST !== "undefined") POST.sunVis = sv * (1 - GX.storm.k); } catch (e) { if (!GX.rfErr) { GX.rfErr = 1; note("beforeRender", e); } } try { var pp = window.PLAN_POST; if (!(pp && pp.render && pp.render(rf))) rf(); } finally { if (typeof POST !== "undefined") POST.sunVis = sv; try { sgRestore(); } catch (e) {} } try { skAfterRender(); } catch (e) {} };
    initPost = function () { ip(); try { if (GX.installed) { installPost(); applyTier(); } } catch (e) { note("installPost", e); } };
  }
  function unwrapGlobals() { if (ORIG.updateSky) updateSky = ORIG.updateSky; if (ORIG.renderFrame) renderFrame = ORIG.renderFrame; if (ORIG.initPost) initPost = ORIG.initPost; }

  function worldHook() {
    if (GX.installed) return; GX.installed = true; GX.tier = GX.bootTier = tierNow();
    try { wrapGlobals(); } catch (e) { note("wrap", e); }
    try { installSky(); } catch (e) { note("sky", e); }
    try { installClouds(); } catch (e) { note("clouds", e); }
    try { if (GX.bootTier >= 1) installTerrain(); } catch (e) { note("terrain", e); }
    runwayInfo();
  }
  function deferHook() {
    try { if (GX.bootTier >= 1) installRoads(); } catch (e) { note("roads", e); }
    try { siteFloorsAndShafts(); } catch (e) { note("site floors", e); }
    // API calls queued before the module was ready
    var pf = pending.floors.splice(0), ps = pending.shafts.splice(0); pf.forEach(function (h) { if (!h.removed) try { addFloor(h); } catch (e) { note("floor", e); } }); ps.forEach(function (h) { if (!h.removed) try { addShaft(h); } catch (e) { note("shaft", e); } });
  }
  function frameHook(dt, now) {
    if (!GX.installed) return; var T = tierNow(); if (T !== GX.tier) { GX.tier = T; applyTier(); }
    updateBolt(now); stormDust(dt);
    // GBANK is built in another module's defer hook: if it was not there yet when ours ran, pick it up now (once a second, a few times)
    if (!SITE.gb && (SITE.tries || 0) < 30 && (FRAME_N % 60) === 0) { SITE.tries = (SITE.tries || 0) + 1; try { siteFloorsAndShafts(); } catch (e) {} }
    interiorWatch();
    probeStep();
    // the probe follows the storm (it lights everything): refresh when the storm level moved, at most once a second
    var st = GX.storm; if (Math.abs(st.k - st.probeK) > 0.06 && now - st.probeAt > 1000) { st.probeK = st.k; st.probeAt = now; try { updateEnvironment(now, true); } catch (e) {} }
  }
  GX.install = function () { if (GX.installed) return; worldHook(); deferHook(); try { installPost(); applyTier(); } catch (e) { note("post", e); } };
  GX.uninstall = function (forReload) {
    if (!GX.installed) return; GX.installed = false;
    try { sgRestore(); } catch (e) {}
    try { uninstallPost(); } catch (e) { note("un post", e); }
    try { uninstallClouds(); } catch (e) { note("un clouds", e); }
    try { uninstallSky(); } catch (e) { note("un sky", e); }
    try { uninstallTerrain(); } catch (e) { note("un terrain", e); }
    try { uninstallRoads(); } catch (e) { note("un roads", e); }
    try { clearFloors(); } catch (e) { note("un floors", e); }
    try { clearShafts(); } catch (e) { note("un shafts", e); }
    try { if (BOLT) { scene.remove(BOLT); BOLT = null; } } catch (e) {}
    SITE.gb = null; IN.hs = []; IN.g = null;
    try { unwrapGlobals(); } catch (e) { note("un wrap", e); }
    if (!forReload) { try { updateEnvironment(performance.now(), true); } catch (e) {} }
  };


  // ═════════════════════════ terrain: layered desert ground (packed ground, loose sand, gravel, caliche crust), slope and noise masks, height blend ═════════════════════════
  // Textures: Poly Haven CC0 (dry_ground_01, dense_sand, rocky_trail_02), 1K, credited in /tex/CREDITS.txt. Loaded only on tiers 1 and 2.
  var LAYER_MEANS = { cal: [0.5169, 0.4763, 0.4133], lse: [0.5768, 0.5035, 0.39], grv: [0.5314, 0.4212, 0.3217] };
  var TR = { tex: null, ready: 0, mats: [] };
  // a busy server can drop a file: retry a few times before the layers give up (they stay off, the ground keeps its old look)
  function layerTex(path, isN) {
    var t = new THREE.Texture(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = isN ? THREE.NoColorSpace : THREE.SRGBColorSpace; try { t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); } catch (e) {}
    var tries = 0; var go = function () { tries++; new THREE.ImageLoader().load(path + (tries > 1 ? "?r=" + tries : ""), function (img) { t.image = img; t.needsUpdate = true; TR.ready++; applyTerrainReady(); }, undefined, function () { if (tries < 4) setTimeout(go, 2500 * tries); else note("texture " + path, "load failed"); }); };
    go(); return t; }
  function applyTerrainReady() { if (!TR.sh) return; var need = GX.bootTier >= 2 ? 6 : 3; TR.sh.uniforms.uGfxT.value.x = TR.ready >= need ? GX.bootTier : 0; }
  var TERRAIN_PARS = [
    "uniform sampler2D tCal; uniform sampler2D tCalN; uniform sampler2D tLse; uniform sampler2D tLseN; uniform sampler2D tGrv; uniform sampler2D tGrvN; uniform vec4 uGfxT; uniform vec3 uCalM; uniform vec3 uLseM; uniform vec3 uGrvM;",
    "vec2 gfxNrm = vec2(0.0); float gfxWsum = 0.0;",
    "vec2 gfxRot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }",
    "vec3 gfxLayers(vec3 base, vec3 wp, vec3 wn, float dist){",
    "  if (uGfxT.x < 0.5) return base; float fade = 1.0 - smoothstep(uGfxT.y * 0.55, uGfxT.y, dist); if (fade <= 0.0) return base;",
    "  vec2 w2 = vec2(wp.x, -wp.z); float slope = 1.0 - clamp(wn.y, 0.0, 1.0);",
    "  float m1 = cnoise(w2 * 0.011 + 3.1) * 0.6 + cnoise(w2 * 0.041 + 7.7) * 0.4; float m2 = cnoise(w2 * 0.008 + 11.3) * 0.6 + cnoise(w2 * 0.033 + 1.9) * 0.4; float m3 = cnoise(w2 * 0.016 + 5.5) * 0.55 + cnoise(w2 * 0.06 + 2.2) * 0.45;",
    "  vec2 uc = gfxRot(w2, 0.61) / 3.7, ul = gfxRot(w2, -1.13) / 2.2, ug = gfxRot(w2, 2.27) / 2.7;",
    "  vec3 cal = sRGBTransferOETF(texture2D(tCal, uc)).rgb, lse = sRGBTransferOETF(texture2D(tLse, ul)).rgb, grv = sRGBTransferOETF(texture2D(tGrv, ug)).rgb;",
    "  float wC = smoothstep(0.46, 0.7, m2) * (1.0 - smoothstep(0.015, 0.07, slope)); float wL = smoothstep(0.5, 0.74, m1) * (1.0 - smoothstep(0.03, 0.12, slope)); float wG = max(smoothstep(0.5, 0.76, m3) * smoothstep(0.012, 0.08, slope), 0.55 * smoothstep(0.62, 0.8, m3));",
    "  float hB = dot(base, vec3(0.333)) / 0.5, hC = dot(cal, vec3(0.333)) / dot(uCalM, vec3(0.333)), hL = dot(lse, vec3(0.333)) / dot(uLseM, vec3(0.333)), hG = dot(grv, vec3(0.333)) / dot(uGrvM, vec3(0.333));",
    "  vec4 a = vec4(hB, hC, hL, hG) * 0.3 + vec4(0.62, wC, wL, wG); float ma = max(max(a.x, a.y), max(a.z, a.w)) - 0.14; vec4 b = max(a - ma, 0.0); b /= max(1e-4, b.x + b.y + b.z + b.w);",
    "  float bl = dot(base, vec3(0.333)); vec3 calT = cal / uCalM * vec3(1.05, 1.0, 0.92) * bl; vec3 lseT = lse / uLseM * vec3(1.16, 1.0, 0.8) * bl; vec3 grvT = grv / uGrvM * vec3(0.8, 0.7, 0.6) * bl;",
    "  vec3 col = base * b.x + calT * b.y + lseT * b.z + grvT * b.w;",
    "  if (uGfxT.x > 1.5) { vec2 nC = gfxRot(texture2D(tCalN, uc).xy * 2.0 - 1.0, -0.61), nL = gfxRot(texture2D(tLseN, ul).xy * 2.0 - 1.0, 1.13), nG = gfxRot(texture2D(tGrvN, ug).xy * 2.0 - 1.0, -2.27); float nf = 1.0 - smoothstep(40.0, 140.0, dist); gfxNrm = (nC * b.y * 1.1 + nL * b.z * 0.8 + nG * b.w * 1.2) * nf; gfxWsum = (b.y + b.z + b.w) * nf; }",
    "  return mix(base, col, fade); }",
    // macro variation: broad brightness and hue drift so no two hundred metres of desert read the same
    "vec3 gfxMacro(vec3 wp){ vec2 w2 = wp.xz; float m = cnoise(w2 * 0.0042 + 2.7) * 0.6 + cnoise(w2 * 0.0013 + 8.1) * 0.4; return vec3(0.93 + 0.14 * m, 0.94 + 0.12 * m, 0.95 + 0.1 * m); }"
  ].join("\n");
  function wrapObc(m, tag, patch) {
    // chain after the material's own hook; give the program a key of its own (two wrapped materials must never share a program)
    var base = m._userObc !== undefined ? m._userObc : (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ? m.onBeforeCompile : null);
    var k0 = m.customProgramCacheKey(); if (!m.userData.gfxOrig) m.userData.gfxOrig = { obc: base, key: Object.prototype.hasOwnProperty.call(m, "customProgramCacheKey") ? m.customProgramCacheKey : null };
    m.onBeforeCompile = function (sh, r) { if (base) base.call(this, sh, r); try { patch(sh); } catch (e) { note("patch " + tag, e); } };
    m.customProgramCacheKey = function () { return k0 + "|gfx:" + tag + ":" + IID; }; m.needsUpdate = true;
  }
  function unwrapObc(m) { var o = m.userData.gfxOrig; if (!o) return; m.onBeforeCompile = o.obc || THREE.Material.prototype.onBeforeCompile; if (o.key) m.customProgramCacheKey = o.key; else delete m.customProgramCacheKey; delete m.userData.gfxOrig; m.needsUpdate = true; }
  function installTerrain() {
    if (window.PLAN_TERRAIN && PLAN_TERRAIN.owns && PLAN_TERRAIN.owns()) { GX.n.terrain = "plan_terrain"; return; }   // R16: plan_terrain.js shades the ground (?trn=0 gives it back)
    if (typeof GROUND_MATS === "undefined" || !GROUND_MATS[0]) return; var gm = GROUND_MATS[0];
    if (!TR.tex) { TR.ready = 0; TR.tex = { cal: layerTex("/tex/gfx_caliche.jpg"), lse: layerTex("/tex/gfx_sand.jpg"), grv: layerTex("/tex/gfx_gravel.jpg") }; if (GX.bootTier >= 2) { TR.tex.calN = layerTex("/tex/gfx_caliche_n.jpg", true); TR.tex.lseN = layerTex("/tex/gfx_sand_n.jpg", true); TR.tex.grvN = layerTex("/tex/gfx_gravel_n.jpg", true); } }
    var blank = TR.tex.cal;
    wrapObc(gm, "terrain" + GX.bootTier, function (sh) {
      var f = sh.fragmentShader; var A1 = "vec3 closeCol = grd * 0.92 * mix(vec3(1.0), grd2 * 1.5, 0.4) * mix(vec3(1.0), det * 1.5, 0.3);";
      var A2 = "diffuseColor.rgb = mix(diffuseColor.rgb, closeCol * 0.78 * clamp(aerialTint, 0.55, 1.15), near * 0.85);";
      var A3 = "mN3.xy * 0.55) * normalScale * nk, 1.0));";
      if (f.indexOf(A1) < 0 || f.indexOf(A2) < 0) { note("terrain", "ground shader changed: layers skipped"); return; }
      sh.uniforms.tCal = { value: TR.tex.cal }; sh.uniforms.tLse = { value: TR.tex.lse }; sh.uniforms.tGrv = { value: TR.tex.grv }; sh.uniforms.tCalN = { value: TR.tex.calN || blank }; sh.uniforms.tLseN = { value: TR.tex.lseN || blank }; sh.uniforms.tGrvN = { value: TR.tex.grvN || blank };
      sh.uniforms.uGfxT = { value: new THREE.Vector4(0, 300, 0, 0) }; sh.uniforms.uCalM = { value: new THREE.Vector3().fromArray(LAYER_MEANS.cal) }; sh.uniforms.uLseM = { value: new THREE.Vector3().fromArray(LAYER_MEANS.lse) }; sh.uniforms.uGrvM = { value: new THREE.Vector3().fromArray(LAYER_MEANS.grv) };
      // the prelude (cnoise) is added by the client in the common chunk; declare ours right after it
      f = f.replace("float cloudShade(vec2 wp, float t){", TERRAIN_PARS + "\nfloat cloudShade(vec2 wp, float t){");
      f = f.replace(A1, A1 + " closeCol = gfxLayers(closeCol, vWP, vWN, dist);");
      f = f.replace(A2, A2 + " diffuseColor.rgb *= gfxMacro(vWP);");
      if (f.indexOf(A3) >= 0) f = f.replace(A3, "mN3.xy * 0.55) * normalScale * nk * (1.0 - gfxWsum * 0.55) + gfxNrm * normalScale, 1.0));");
      sh.fragmentShader = f; TR.sh = sh; applyTerrainReady();
    });
    TR.mats.push(gm); GX.n.terrain = GX.bootTier;
  }
  function uninstallTerrain() { TR.mats.forEach(unwrapObc); TR.mats = []; TR.sh = null; }
  // dirt roads: wheel tracks with tread marks and packed, darker lanes where the carts run (the client lays the rut ribbons)
  var ROADS_T = { mats: [] };
  var ROAD_FRAG = "{ float ax = vMapUv.x; float al = vMapUv.y; float dd = length(vViewPosition); float nearT = 1.0 - smoothstep(30.0, 80.0, dd); float tr = exp(-pow((ax - 0.31) / 0.05, 2.0)) + exp(-pow((ax - 0.69) / 0.05, 2.0)); float wob = sin(al * 0.9 + ax * 3.0) * 0.012; float tr2 = exp(-pow((ax - 0.24 - wob) / 0.03, 2.0)) * 0.6 + exp(-pow((ax - 0.76 + wob) / 0.03, 2.0)) * 0.6; float tread = smoothstep(0.35, 0.65, fract(al * 26.0 + abs(ax - 0.5) * 4.0)); diffuseColor.rgb *= 1.0 - tr * (0.07 + 0.08 * tread * nearT) - tr2 * 0.05; diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.04, 1.0, 0.95), (1.0 - tr) * 0.3); }";
  function installRoads() {
    if (window.PLAN_TERRAIN && PLAN_TERRAIN.ownsRoads && PLAN_TERRAIN.ownsRoads()) { GX.n.roads = "plan_terrain"; return; }   // R16: plan_terrain.js shades the dirt roads
    if (typeof EDGE_MATS === "undefined") return; var n = 0;
    EDGE_MATS.forEach(function (m) { if (!m || m.userData.gfxOrig) return; wrapObc(m, "road", function (sh) { if (sh.fragmentShader.indexOf("#include <map_fragment>") < 0) return; sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n" + ROAD_FRAG); }); ROADS_T.mats.push(m); n++; });
    GX.n.roads = n;
  }
  function uninstallRoads() { ROADS_T.mats.forEach(unwrapObc); ROADS_T.mats = []; }
  // ═════════════════════════ polished floors: screen-space reflections (tier 2) over a box-projected room probe (tiers 1 and 2) ═════════════════════════
  var _v = null;
  // R9x (HANDOFF_R9_HITCHES.md 5.2): the same scan with the vertex reads, the matrix and the cross product written out on the arrays
  // (the same arithmetic in the same order as Vector3's fromBufferAttribute, applyMatrix4, subVectors, crossVectors, length and
  // divideScalar, so the result is bit-identical); it was 80 ms of the FBO's walk-in frame. ?r9x=0: the Vector3 loop above.
  var R9XF = !!(window.R9 && R9.part("x"));
  var FPV = null;
  function fpSlowMesh(o, groups) {   // the Vector3 loop of floorPlanes for one mesh (an interleaved, half-float or normalized position)
    if (!FPV) FPV = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]; var a = FPV[0], b = FPV[1], c = FPV[2], e1 = FPV[3], e2 = FPV[4], n = FPV[5];
    var pa = o.geometry.attributes.position, ix = o.geometry.index, m = o.matrixWorld; var cnt = ix ? ix.count : pa.count;
    for (var i = 0; i + 2 < cnt; i += 3) { var i0 = ix ? ix.getX(i) : i, i1 = ix ? ix.getX(i + 1) : i + 1, i2 = ix ? ix.getX(i + 2) : i + 2; a.fromBufferAttribute(pa, i0).applyMatrix4(m); b.fromBufferAttribute(pa, i1).applyMatrix4(m); c.fromBufferAttribute(pa, i2).applyMatrix4(m);
      e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2); var ar = n.length() * 0.5; if (ar < 1e-4) continue; n.divideScalar(ar * 2); if (n.y < 0.985) continue; var y = (a.y + b.y + c.y) / 3; var k = Math.round(y * 25);
      var gr = groups[k] || (groups[k] = { y: 0, area: 0, box: [1e9, -1e9, 1e9, -1e9], meshes: [] }); gr.y += y * ar; gr.area += ar; gr.box[0] = Math.min(gr.box[0], a.x, b.x, c.x); gr.box[1] = Math.max(gr.box[1], a.x, b.x, c.x); gr.box[2] = Math.min(gr.box[2], a.z, b.z, c.z); gr.box[3] = Math.max(gr.box[3], a.z, b.z, c.z); if (gr.meshes.indexOf(o) < 0) gr.meshes.push(o); }
  }
  function floorPlanesFast(obj, want) {
    var groups = {}; obj.updateMatrixWorld(true);
    obj.traverse(function (o) { if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || o.isInstancedMesh) return; if (want && !want(o)) return; var pa = o.geometry.attributes.position, ix = o.geometry.index, m = o.matrixWorld;
      if (pa.isInterleavedBufferAttribute || pa.isFloat16BufferAttribute || pa.normalized || !pa.array || pa.itemSize < 3 || (ix && (ix.isInterleavedBufferAttribute || !ix.array || ix.itemSize !== 1))) { fpSlowMesh(o, groups); return; }
      var A = pa.array, s = pa.itemSize, I = ix ? ix.array : null, e = m.elements, cnt = ix ? ix.count : pa.count, seen = {};
      var e0 = e[0], e1 = e[1], e2 = e[2], e3 = e[3], e4 = e[4], e5 = e[5], e6 = e[6], e7 = e[7], e8 = e[8], e9 = e[9], e10 = e[10], e11 = e[11], e12 = e[12], e13 = e[13], e14 = e[14], e15 = e[15];
      for (var i = 0; i + 2 < cnt; i += 3) { var i0 = I ? I[i] : i, i1 = I ? I[i + 1] : i + 1, i2 = I ? I[i + 2] : i + 2, x, y, z, w, j;
        j = i0 * s; x = A[j]; y = A[j + 1]; z = A[j + 2]; w = 1 / (e3 * x + e7 * y + e11 * z + e15); var ax = (e0 * x + e4 * y + e8 * z + e12) * w, ay = (e1 * x + e5 * y + e9 * z + e13) * w, az = (e2 * x + e6 * y + e10 * z + e14) * w;
        j = i1 * s; x = A[j]; y = A[j + 1]; z = A[j + 2]; w = 1 / (e3 * x + e7 * y + e11 * z + e15); var bx = (e0 * x + e4 * y + e8 * z + e12) * w, by = (e1 * x + e5 * y + e9 * z + e13) * w, bz = (e2 * x + e6 * y + e10 * z + e14) * w;
        j = i2 * s; x = A[j]; y = A[j + 1]; z = A[j + 2]; w = 1 / (e3 * x + e7 * y + e11 * z + e15); var cx = (e0 * x + e4 * y + e8 * z + e12) * w, cy = (e1 * x + e5 * y + e9 * z + e13) * w, cz = (e2 * x + e6 * y + e10 * z + e14) * w;
        var ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
        var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; var ar = Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5; if (ar < 1e-4) continue; if (ny * (1 / (ar * 2)) < 0.985) continue;
        var yy = (ay + by + cy) / 3; var k = Math.round(yy * 25);
        var gr = groups[k] || (groups[k] = { y: 0, area: 0, box: [1e9, -1e9, 1e9, -1e9], meshes: [] }); gr.y += yy * ar; gr.area += ar; gr.box[0] = Math.min(gr.box[0], ax, bx, cx); gr.box[1] = Math.max(gr.box[1], ax, bx, cx); gr.box[2] = Math.min(gr.box[2], az, bz, cz); gr.box[3] = Math.max(gr.box[3], az, bz, cz); if (!seen[k]) { seen[k] = 1; if (gr.meshes.indexOf(o) < 0) gr.meshes.push(o); } } });
    var out = []; for (var k2 in groups) { var g = groups[k2]; g.y /= g.area; out.push(g); } out.sort(function (p, q) { return q.area - p.area; }); return out;
  }
  function floorPlanes(obj, want) {
    if (R9XF) return floorPlanesFast(obj, want);
    // upward faces of every mesh under obj, grouped by height: [{ y, area, box: [x0, x1, z0, z1] }] (largest first)
    var groups = {}; var a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    obj.updateMatrixWorld(true);
    obj.traverse(function (o) { if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || o.isInstancedMesh) return; if (want && !want(o)) return; var pa = o.geometry.attributes.position, ix = o.geometry.index, m = o.matrixWorld; var cnt = ix ? ix.count : pa.count;
      for (var i = 0; i + 2 < cnt; i += 3) { var i0 = ix ? ix.getX(i) : i, i1 = ix ? ix.getX(i + 1) : i + 1, i2 = ix ? ix.getX(i + 2) : i + 2; a.fromBufferAttribute(pa, i0).applyMatrix4(m); b.fromBufferAttribute(pa, i1).applyMatrix4(m); c.fromBufferAttribute(pa, i2).applyMatrix4(m);
        e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2); var ar = n.length() * 0.5; if (ar < 1e-4) continue; n.divideScalar(ar * 2); if (n.y < 0.985) continue; var y = (a.y + b.y + c.y) / 3; var k = Math.round(y * 25);
        var gr = groups[k] || (groups[k] = { y: 0, area: 0, box: [1e9, -1e9, 1e9, -1e9], meshes: [] }); gr.y += y * ar; gr.area += ar; gr.box[0] = Math.min(gr.box[0], a.x, b.x, c.x); gr.box[1] = Math.max(gr.box[1], a.x, b.x, c.x); gr.box[2] = Math.min(gr.box[2], a.z, b.z, c.z); gr.box[3] = Math.max(gr.box[3], a.z, b.z, c.z); if (gr.meshes.indexOf(o) < 0) gr.meshes.push(o); } });
    var out = []; for (var k2 in groups) { var g = groups[k2]; g.y /= g.area; out.push(g); } out.sort(function (p, q) { return q.area - p.area; }); return out;
  }
  function addFloor(h) {
    var o = h.opts || {}; var obj = h.obj; if (!obj) return;
    var planes = o.y !== undefined && o.box ? [{ y: o.y, area: 1, box: o.box.slice(), meshes: obj.isMesh ? [obj] : [] }] : floorPlanes(obj, o.filter);
    var minA = o.minArea || 6; var list = planes.filter(function (p, i) { return p.area >= minA && i < (o.maxPlanes || 2); }); if (!list.length) { note("floor", "no upward faces on " + (obj.name || obj.type)); return; }
    h.planes = list.map(function (p, i) { var c = [(p.box[0] + p.box[1]) / 2, (p.box[2] + p.box[3]) / 2], hf = [(p.box[1] - p.box[0]) / 2, (p.box[3] - p.box[2]) / 2], yaw = 0; if (i === 0 && o.half && o.center) { c = o.center.slice(); hf = o.half.slice(); yaw = o.yaw || 0; } return { y: p.y, box: p.box, c: c, half: hf, yaw: yaw, strength: o.strength === undefined ? 0.5 : o.strength, tint: o.tint === undefined ? 0.92 : o.tint, obj: obj, meshes: p.meshes, h: h }; });
    h.planes.forEach(function (p) { GX.floors.push(p); });
    if (o.probe !== false && GX.tier >= 1) setupProbe(h, list[0]);
    GX.n.floors = GX.floors.length;
  }
  function removeFloor(h) { if (!h.planes) return; GX.floors = GX.floors.filter(function (p) { return p.h !== h; }); if (h.probe) disposeProbe(h); h.planes = null; }
  function clearFloors() { var hs = []; GX.floors.forEach(function (p) { if (hs.indexOf(p.h) < 0) hs.push(p.h); }); hs.forEach(removeFloor); GX.floors = []; }
  function visibleChain(o) { while (o) { if (!o.visible) return false; if (o.parent === null) return o === scene; o = o.parent; } return false; }
  function floorsUniforms(F, T) {
    if (!F.uFlN) return; var cam = camera.position, list = [];
    for (var i = 0; i < GX.floors.length; i++) { var p = GX.floors[i], bx = p.box; var dx = Math.max(bx[0] - cam.x, 0, cam.x - bx[1]), dz = Math.max(bx[2] - cam.z, 0, cam.z - bx[3]); var d = Math.hypot(dx, dz); if (d > 45 || cam.y - p.y > 30 || cam.y < p.y - 0.5) continue; if (!visibleChain(p.meshes[0] || p.obj)) continue; list.push([d, p]); }
    list.sort(function (a, b) { return a[0] - b[0]; }); var n = Math.min(4, list.length);
    for (var k = 0; k < n; k++) { var q = list[k][1]; F.uFlY.value[k].set(q.y, q.strength, q.tint, q.yaw); F.uFlB.value[k].set(q.c[0], q.c[1], q.half[0] - 0.05, q.half[1] - 0.05); }
    F.uFlN.value = T >= 2 ? n : 0; F.uSsrK.value = GX.K.ssr;
  }
  // the room probe: a 128 px cube captured one face per frame from the middle of the room (only the room's own meshes: layer 3),
  // the sky probe behind it; the floor samples it through a box projection so reflections sit where the walls really are
  var PROBES = [], PQ = [];
  var BOXPROJ_PARS = "uniform mat3 uBoxRot; uniform vec3 uBoxPos; uniform vec3 uBMin; uniform vec3 uBMax; uniform vec3 uBCap; varying vec3 vGfxWP;\nvec3 gfxBox(vec3 v){ vec3 nd = uBoxRot * normalize(v); vec3 lp = uBoxRot * (vGfxWP - uBoxPos); vec3 inv = 1.0 / (nd + sign(nd) * 1e-5 + vec3(1e-6)); vec3 t1 = (uBMax - lp) * inv, t0 = (uBMin - lp) * inv; vec3 tf = max(t0, t1); float t = max(0.0, min(min(tf.x, tf.y), tf.z)); vec3 hit = lp + nd * t; return transpose(uBoxRot) * (hit - uBCap); }\n";
  function setupProbe(h, plane) {
    var o = h.opts || {}; var obj = h.obj; var cap = o.capture || topGroup(obj); if (!cap) return;
    var rt = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    var cc = new THREE.CubeCamera(0.2, 300, rt); cc.coordinateSystem = renderer.coordinateSystem; cc.updateCoordinateSystem(); cc.layers.set(3); cc.children.forEach(function (c) { c.layers.set(3); });
    // the room frame: yaw from the option (rooms are rotated), else axis aligned
    var yaw = o.yaw || 0; var bx = plane.box; var hgt = o.height || 6; var cx = (bx[0] + bx[1]) / 2, cz = (bx[2] + bx[3]) / 2;
    var half = o.half || [(bx[1] - bx[0]) / 2, (bx[3] - bx[2]) / 2]; var ctr = o.center || [cx, cz];
    var pos = new THREE.Vector3(ctr[0], plane.y + hgt / 2, ctr[1]); var capP = new THREE.Vector3(ctr[0], plane.y + Math.min(1.7, hgt * 0.4), ctr[1]);
    var rot = new THREE.Matrix3().set(Math.cos(yaw), 0, -Math.sin(yaw), 0, 1, 0, Math.sin(yaw), 0, Math.cos(yaw));   // world -> room local (inverse of rotation.y = yaw)
    var P = { h: h, rt: rt, cc: cc, cap: cap, face: -1, pos: pos, capP: capP, rot: rot, half: half, hgt: hgt, mats: [], at: -1, night: -1, storm: -1 };
    cc.position.copy(capP); cc.updateMatrixWorld(true);
    cap.traverse(function (q) { if (q.isMesh || q.isPoints || q.isLight) q.layers.enable(3); }); lightsOnLayer3();
    // the floor meshes: a material clone per mesh carrying the probe and the box projection
    (h.planes || []).forEach(function (pl) { pl.meshes.forEach(function (m) { if (m.userData.gfxProbe) return; var src = m.material; if (!src || Array.isArray(src) || !src.isMeshStandardMaterial) return; var cl = src.clone(); var sob = src._userObc !== undefined ? src._userObc : (src.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ? src.onBeforeCompile : null); if (sob) cl.onBeforeCompile = sob;
      if (o.roughness !== undefined) cl.roughness = Math.min(cl.roughness, o.roughness);
      cl.envMapIntensity = o.envK || 1.0;
      var lmin = new THREE.Vector3(-half[0], -hgt / 2, -half[1]), lmax = new THREE.Vector3(half[0], hgt / 2, half[1]); var lcap = capP.clone().sub(pos).applyMatrix3(rot);
      wrapObc(cl, "boxproj", function (sh) { sh.uniforms.uBoxRot = { value: rot }; sh.uniforms.uBoxPos = { value: pos }; sh.uniforms.uBMin = { value: lmin }; sh.uniforms.uBMax = { value: lmax }; sh.uniforms.uBCap = { value: lcap };
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vGfxWP;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvGfxWP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
        var chunk = THREE.ShaderChunk.envmap_physical_pars_fragment.replace("reflectVec = inverseTransformDirection( reflectVec, viewMatrix );", "reflectVec = inverseTransformDirection( reflectVec, viewMatrix );\n\t\treflectVec = gfxBox( reflectVec );");
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + BOXPROJ_PARS).replace("#include <envmap_physical_pars_fragment>", chunk); });
      m.userData.gfxProbe = { src: src }; m.material = cl; P.mats.push([m, cl]); }); });
    h.probe = P; PROBES.push(P); queueProbe(P);
  }
  function lightsOnLayer3() { try { [hemi, sun, moon].forEach(function (l) { l.layers.enable(3); }); if (CSMX.csm) CSMX.csm.lights.forEach(function (l) { l.layers.enable(3); }); LIGHTS.pool.forEach(function (l) { l.layers.enable(3); }); LIGHTS.spool.forEach(function (l) { l.layers.enable(3); }); } catch (e) {} }
  function topGroup(o) { var p = o; while (p && p.parent && p.parent !== scene) p = p.parent; return p; }
  function queueProbe(P) { if (PQ.indexOf(P) < 0) PQ.push(P); P.face = 0; }
  function disposeProbe(h) { var P = h.probe; if (!P) return; P.mats.forEach(function (x) { var m = x[0]; if (m.userData.gfxProbe) { m.material = m.userData.gfxProbe.src; delete m.userData.gfxProbe; } x[1].dispose(); }); P.rt.dispose(); var i = PROBES.indexOf(P); if (i >= 0) PROBES.splice(i, 1); i = PQ.indexOf(P); if (i >= 0) PQ.splice(i, 1); h.probe = null; }
  function probeStep() {
    // re-capture a probe when the light has moved on (dusk, night, the storm); capture only near the camera
    var cam = camera.position;
    for (var i = 0; i < PROBES.length; i++) { var P = PROBES[i]; var fm = P.h.planes && P.h.planes[0] && (P.h.planes[0].meshes[0] || P.h.planes[0].obj); var vis = !!fm && visibleChain(fm); if (!vis) { P.visPrev = false; continue; } if (!P.visPrev) { P.visPrev = true; if (P.at >= 0 || PQ.indexOf(P) < 0) queueProbe(P); } if (PQ.indexOf(P) >= 0) continue; var near = cam.distanceTo(P.capP) < 70; if (!near) continue; var sn = GX.sun ? GX.sun.night : 0; if (P.at < 0 || Math.abs(sn - P.night) > 0.12 || Math.abs(GX.storm.k - P.storm) > 0.25) queueProbe(P); }
    if (!PQ.length) return; var Q = PQ[0]; if (cam.distanceTo(Q.capP) > 90 || !Q.visPrev) { PQ.shift(); return; }
    var bg = scene.background, fog = scene.fog, sv = [], fd = fog && fog.isFogExp2 && !GX.r6off ? fog.density : null;
    try {
      // R6: no fog in the room probe by a zero density, not by removing the fog: a scene without fog is another shader program for
      // every material the probe sees (about 140 extra programs, each compiled and linked once per session)
      scene.background = typeof envTex !== "undefined" && envTex ? envTex : null; if (fd !== null) fog.density = 0; else scene.fog = null;
      SH.meshes.forEach(function (m) { sv.push([m, m.visible]); m.visible = false; });
      var prevRT = renderer.getRenderTarget(), prevAU = renderer.shadowMap.autoUpdate, prevNU = renderer.shadowMap.needsUpdate; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
      renderer.setRenderTarget(Q.rt, Q.face); renderer.render(scene, Q.cc.children[Q.face]); renderer.setRenderTarget(prevRT); renderer.shadowMap.needsUpdate = prevNU; renderer.shadowMap.autoUpdate = prevAU;
    } catch (e) { note("probe", e); PQ.shift(); } finally { scene.background = bg; scene.fog = fog; if (fd !== null) fog.density = fd; sv.forEach(function (x) { x[0].visible = x[1]; }); }
    Q.face++; if (Q.face >= 6) { Q.rt.texture.needsPMREMUpdate = true; Q.mats.forEach(function (x) { if (x[1].envMap !== Q.rt.texture) { x[1].envMap = Q.rt.texture; x[1].needsUpdate = true; } }); Q.at = performance.now(); Q.night = GX.sun ? GX.sun.night : 0; Q.storm = GX.storm.k; PQ.shift(); GX.n.probeCaptures = (GX.n.probeCaptures || 0) + 1; }
  }

  // ═════════════════════════ sun shafts: light volumes through windows and doors (tiers 1 and 2) ═════════════════════════
  // opts: { quads: [[[x,y,z] x4], ...] world corners of each opening (or quad: one), floorY, inward: [x,y,z] (into the room), maxLen: 40, k: 1, obj: Object3D (shown only while visible) }
  var SH = { meshes: [], list: [] };
  var SHAFT_VERT = "attribute float aI; varying vec3 vW; varying float vI; void main(){ vI = aI; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }";
  var SHAFT_FRAG = [
    "uniform vec4 uPl[84]; uniform vec3 uCol; uniform float uK; uniform float uTime; uniform float uLen; varying vec3 vW; varying float vI;", GLSL_NOISE,
    "void main(){ vec3 ro = cameraPosition; vec3 rd = normalize(vW - ro); float t0 = 0.0, t1 = 1e5; int base = int(vI + 0.5) * 7; bool inside = true;",
    "  for (int k = 0; k < 7; k++) { vec4 pl = uPl[base + k]; float dn = dot(pl.xyz, rd); float dist = dot(pl.xyz, ro) + pl.w; if (dist > 0.0) inside = false; if (abs(dn) < 1e-6) { if (dist > 0.0) discard; } else { float t = -dist / dn; if (dn < 0.0) t0 = max(t0, t); else t1 = min(t1, t); } }",
    "  if (inside == gl_FrontFacing) discard; float th = t1 - t0; if (th <= 0.0) discard;",
    "  vec3 mid = ro + rd * (t0 + t1) * 0.5; vec4 wpl = uPl[base]; float along = max(0.0, -(dot(wpl.xyz, mid) + wpl.w)); float fall = exp(-along / (uLen * 0.55));",
    "  float dust = 0.65 + 0.7 * gNoise3(mid * 0.9 + vec3(0.0, uTime * 0.05, uTime * 0.02)) * gNoise3(mid * 2.7 - vec3(uTime * 0.03, 0.0, 0.0));",
    "  float dens = (1.0 - exp(-th * 0.22)) * fall * dust; gl_FragColor = vec4(uCol * uK * dens, 1.0); }"
  ].join("\n");
  function addShaft(h) {
    var o = h.opts || {}; var quads = o.quads || (o.quad ? [o.quad] : []); if (!quads.length) return; if (quads.length > 12) quads = quads.slice(0, 12);
    var geo = new THREE.BufferGeometry(); var n = quads.length; geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 8 * 3), 3)); var ai = new Float32Array(n * 8); for (var i = 0; i < n; i++) for (var j = 0; j < 8; j++) ai[i * 8 + j] = i; geo.setAttribute("aI", new THREE.BufferAttribute(ai, 1));
    var idx = []; var F6 = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]; for (var q = 0; q < n; q++) F6.forEach(function (f) { var b = q * 8; idx.push(b + f[0], b + f[1], b + f[2], b + f[0], b + f[2], b + f[3]); }); geo.setIndex(idx);
    var pl = []; for (var p = 0; p < 84; p++) pl.push(new THREE.Vector4(0, 0, 0, 1));
    var mat = new THREE.ShaderMaterial({ uniforms: { uPl: { value: pl }, uCol: { value: new THREE.Color(1, 0.9, 0.75) }, uK: { value: 0 }, uTime: { value: 0 }, uLen: { value: o.maxLen || 40 } }, vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    var mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.userData.noCull = true; mesh.userData.noShadow = true; mesh.visible = false; mesh.name = "gfx_shaft";
    scene.add(mesh); var S = { h: h, mesh: mesh, quads: quads.map(function (qd) { return qd.map(function (v) { return new THREE.Vector3(v[0], v[1], v[2]); }); }), floorY: o.floorY, inward: new THREE.Vector3().fromArray(o.inward || [0, 0, -1]).normalize(), maxLen: o.maxLen || 40, k: o.k === undefined ? 1 : o.k, obj: o.obj || null, dir: new THREE.Vector3(9, 9, 9) };
    h.shaft = S; SH.list.push(S); SH.meshes.push(mesh); GX.n.shafts = SH.list.length;
  }
  function removeShaft(h) { var S = h.shaft; if (!S) return; if (S.mesh.parent) S.mesh.parent.remove(S.mesh); S.mesh.geometry.dispose(); S.mesh.material.dispose(); SH.list.splice(SH.list.indexOf(S), 1); SH.meshes.splice(SH.meshes.indexOf(S.mesh), 1); h.shaft = null; }
  function clearShafts() { SH.list.slice().forEach(function (S) { removeShaft(S.h); }); }
  var _L = null, _c = null;
  function buildPrisms(S, L) {
    var pos = S.mesh.geometry.attributes.position, pl = S.mesh.material.uniforms.uPl.value; var P = [], tmp = new THREE.Vector3(), e = new THREE.Vector3(), nn = new THREE.Vector3();
    for (var q = 0; q < S.quads.length; q++) { var W = S.quads[q]; var ctr = new THREE.Vector3(); W.forEach(function (w) { ctr.add(w); }); ctr.multiplyScalar(0.25);
      var ends = W.map(function (w) { var t = L.y < -0.02 ? (w.y - S.floorY) / -L.y : S.maxLen; t = Math.min(t, S.maxLen * 1.6); return w.clone().addScaledVector(L, Math.max(0.1, t)); });
      for (var i = 0; i < 4; i++) { pos.setXYZ(q * 8 + i, W[i].x, W[i].y, W[i].z); pos.setXYZ(q * 8 + 4 + i, ends[i].x, ends[i].y, ends[i].z); }
      var b = q * 7; var setP = function (k, n, pt) { pl[b + k].set(n.x, n.y, n.z, -n.dot(pt)); };
      // 0: the window plane (outside = the outdoor side), 1: the floor, 2: the far cap, 3..6: the sides (normals point away from the quad centre)
      nn.copy(S.inward).negate(); setP(0, nn, W[0]); setP(1, new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, S.floorY, 0)); nn.copy(L); setP(2, nn, ctr.clone().addScaledVector(L, S.maxLen));
      for (var s = 0; s < 4; s++) { var A = W[s], B2 = W[(s + 1) % 4]; e.subVectors(B2, A); nn.crossVectors(e, L).normalize(); tmp.subVectors(ctr, A); if (nn.dot(tmp) > 0) nn.negate(); setP(3 + s, nn, A); } }
    pos.needsUpdate = true; S.mesh.geometry.computeBoundingSphere();
  }
  function updateShafts() {
    if (!SH.list.length) return; var T = GX.tier; var sun = GX.sun; var now = performance.now();
    if (!_L) { _L = new THREE.Vector3(); _c = new THREE.Color(); }
    for (var i = 0; i < SH.list.length; i++) { var S = SH.list[i]; var on = T >= 1 && sun && sun.el > 0.02 && (!S.obj || visibleChain(S.obj)) && camera.position.distanceTo(S.quads[0][0]) < 120;
      if (on) { _L.set(-sun.dir[0], -sun.dir[1], -sun.dir[2]).normalize(); var face = _L.dot(S.inward); on = face > 0.06 && _L.y < -0.03; }
      S.mesh.visible = !!on; if (!on) continue;
      if (S.dir.distanceToSquared(_L) > 2e-5) { S.dir.copy(_L); buildPrisms(S, _L); }
      var gold = sstep(0.4, 0.05, sun.el); var U = S.mesh.material.uniforms; U.uTime.value = now / 1000;
      U.uCol.value.setRGB(1.0, 0.9 - 0.2 * gold, 0.76 - 0.36 * gold); U.uK.value = GX.K.shaft * S.k * 0.55 * sstep(0.02, 0.12, sun.el) * (1 - GX.storm.k) * sstep(0.06, 0.3, _L.dot(S.inward)) * (1 + 0.6 * gold); }
  }

  // ═════════════════════════ where the floors and shafts go: GBANK (in the world), the Solport terminal (the FBO room) ═════════════════════════
  var SITE = { gb: null, term: null };
  function siteFloorsAndShafts() {
    // GBANK: the hall floor is polished travertine; light enters through the front and south glazing
    try {
      var GBx = window.PLAN_GBANK; var hall = scene.getObjectByName("gbank_hall"); if (GBx && GBx.site && hall && !SITE.gb) { var S = GBx.site; var yF = S.B + 0.612;
        var capGroups = ["gbank_ex", "gbank_hall", "gbank_suite", "gbank_dyn", "gbank_rs"].map(function (n) { return scene.getObjectByName(n); }).filter(Boolean);
        var holder = new THREE.Group(); holder.name = "gfx_gbank_capture";
        var fh = GX.addReflectiveFloor(hall, { strength: 0.55, roughness: 0.2, height: 5.6, yaw: S.yaw, half: [16, 11], center: [S.cx, S.cz], filter: function (m) { var mt = m.material; return mt && !Array.isArray(mt) && mt.roughness !== undefined && mt.roughness <= 0.45; }, minArea: 40, maxPlanes: 1, capture: capGroups[0] });
        capGroups.forEach(function (g) { g.traverse(function (q) { if (q.isMesh || q.isPoints || q.isLight) q.layers.enable(3); }); });
        var W = function (lx, ly, lz) { var w = __gbW(S, lx, lz); return [w[0], S.B + ly, w[1]]; };
        // one shaft per glazing bay (the bronze mullions stand every ~2 m and leave dark gaps between the beams)
        var strips = function (a0, a1, skip) { var out = [], n = Math.max(1, Math.round((a1 - a0) / 2.05)), w = (a1 - a0) / n; for (var i = 0; i < n; i++) { var s0 = a0 + i * w + 0.12, s1 = a0 + (i + 1) * w - 0.12; if (skip && s1 > skip[0] && s0 < skip[1]) continue; out.push([s0, s1]); } return out; };
        var quads = strips(-11.2, 16, [-2.7, 2.7]).map(function (b) { return [W(b[0], 0.75, 11), W(b[1], 0.75, 11), W(b[1], 6.0, 11), W(b[0], 6.0, 11)]; });
        var inF = [-S.sn, 0, -S.cs];   // local -z (into the hall from the front) in world
        var sh1 = GX.addSunShaft({ quads: quads, floorY: yF, inward: inF, maxLen: 34, k: 1, obj: hall });
        var q2 = strips(0.3, 10.9).map(function (b) { return [W(16, 0.75, b[0]), W(16, 0.75, b[1]), W(16, 6.0, b[1]), W(16, 6.0, b[0])]; });
        var sh2 = GX.addSunShaft({ quads: q2, floorY: yF, inward: [-S.cs, 0, S.sn], maxLen: 34, k: 1, obj: hall });
        SITE.gb = { floor: fh, shafts: [sh1, sh2] }; GX.n.gbank = 1; }
    } catch (e) { note("gbank site", e); }
  }
  function __gbW(S, lx, lz) { return [S.cx + lx * S.cs + lz * S.sn, S.cz - lx * S.sn + lz * S.cs]; }
  // rooms entered through a door (the terminal): floors and shafts come and go with the room
  var IN = { g: null, hs: [] };
  function interiorWatch() {
    var g = typeof inside !== "undefined" && inside ? inside.g : null; if (g === IN.g) return;
    IN.hs.forEach(function (h) { h.remove(); }); IN.hs = []; IN.g = g; if (!g || GX.tier < 1) return;
    try {
      var kind = inside.door.kind, e = inside.door.e, half = inside.half; if (kind !== "terminal") return;
      var yF = e[1] + 0.05, rot = e[3], cs = Math.cos(rot), sn = Math.sin(rot); var W = function (lx, ly, lz) { return [e[0] + lx * cs + lz * sn, e[1] + ly, e[2] - lx * sn + lz * cs]; };
      // the visible floor (the terminal module lays its own terrazzo over the room's plane): the largest upward surface within 0.4 m of the door level
      var bb = new THREE.Box3(); var fil = function (m) { if (!visibleChain(m)) return false; var mt = m.material; if (!mt || Array.isArray(mt) || !mt.isMeshStandardMaterial || mt.transparent) return false; if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); bb.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld); return bb.min.y < e[1] + 0.4 && bb.max.y < e[1] + 1.2; };
      IN.hs.push(GX.addReflectiveFloor(g, { strength: 0.6, roughness: 0.16, height: 9.5, yaw: rot, half: [half, half], center: [e[0], e[2]], capture: g, maxPlanes: 1, minArea: 60, filter: fil }));
      var quads = []; for (var k = -4; k < 4; k++) { var x0 = k * (half / 4.5) + 0.35, x1 = (k + 1) * (half / 4.5) - 0.35; if (x1 > -4.2 && x0 < 4.2) continue; quads.push([W(x0, 0.4, half - 0.25), W(x1, 0.4, half - 0.25), W(x1, 8.6, half - 0.25), W(x0, 8.6, half - 0.25)]); }
      IN.hs.push(GX.addSunShaft({ quads: quads, floorY: yF, inward: [-sn, 0, -cs], maxLen: 46, k: 1, obj: g }));
    } catch (err) { note("interior", err); }
  }

  // R9p (HANDOFF_R9_HITCHES.md): a floor's probe-lit material is a new shader program (and new PMREM programs) the moment its room
  // probe has captured its six faces, so the first visit to the GBANK hall and the FBO stalled 0.2 to 2 s at that moment. plan_perf
  // calls this behind the loading screen: each probe's floor materials get a stand-in cube of the same size and format for one
  // compile and one 4 px draw (draw(meshes, group) is plan_perf's), then their own environment back. Nothing on screen changes.
  GX.r9warmProbes = async function (draw) {
    if (!(window.R9 && R9.part("p"))) return 0; var n = 0;
    try { if (!GX.r9cube) GX.r9cube = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      var T = GX.r9cube.texture;
      for (var i = 0; i < PROBES.length; i++) { var P = PROBES[i], list = [];
        P.mats.forEach(function (x) { var cl = x[1]; if (!cl || cl.envMap === P.rt.texture) return; list.push([x[0], cl, cl.envMap]); cl.envMap = T; cl.needsUpdate = true; });
        if (!list.length) continue; T.needsPMREMUpdate = true;
        try { await draw(list.map(function (q) { return q[0]; }), P.cap); n += list.length; } finally { list.forEach(function (q) { q[1].envMap = q[2]; q[1].needsUpdate = true; }); } }
    } catch (e) { note("r9 warm probes", e); }
    GX.n.r9warmProbes = (GX.n.r9warmProbes || 0) + n; return n;
  };
  GX.r9watch = interiorWatch;   // R9y: plan_perf builds the FBO once, hidden, to prepare its programs (HANDOFF_R9_HITCHES.md 5.2)
  GX._dbg = { GR: GR, TR: TR, SH: SH, PROBES: PROBES, IN: IN, SITE: SITE, CL: function () { return CL; }, floorsUniforms: floorsUniforms };
  // ═════════════════════════ registration (last: every table above is initialised by now) ═════════════════════════
  hook("world", "gfxWorld", worldHook); hook("defer", "gfxDefer", deferHook); hook("frame", "gfxFrame", frameHook);
  var running = false; try { running = typeof FRAME_N !== "undefined" && FRAME_N > 0 && typeof POST !== "undefined" && !!POST.mFinal; } catch (e) {}
  if (hot || running) { GX.install(); try { updateSky(0); updateEnvironment(performance.now(), true); } catch (e) {} }
})();
