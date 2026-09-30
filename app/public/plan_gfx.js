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
    storm: { k: 0, force: null, gust: 0, flash: 0, dir: [0.55, 0, 0.83], day: -1, next: 0, bolt: null, seq: null, probeK: 0, probeAt: 0 },
    floors: [], shafts: [], obj: {}, mats: {},
    // tunables (live-editable while developing)
    K: {
      sky: [2.0, 1.75, 0.0035, 0.82],   // Preetham: turbidity, rayleigh, mie coefficient, mie g (clear high-desert air)
      skyExpo: 0.42, skyKnee: 0.78, skyCap: 1.12, envDesat: 0.25, envK: 0.9,
      cloudN: 64, stormCells: 6, rainN: 10, dustN: 6,
      aoRadius: 0.62, heat: 0.003, ssr: 0.6, shaft: 1.3
    }
  };
  function note(w, e) { var m = w + ": " + (e && e.message ? e.message : e); GX.errs.push(m); if (GX.errs.length <= 8) console.warn("[gfx] " + m); }
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
    "vec3 stars(vec3 d){ vec3 p = d * 190.0; vec3 id = floor(p); float h = gHash3(id); if (h < 0.991) return vec3(0.0);",
    "  vec3 sp = (id + 0.25 + 0.5 * vec3(gHash3(id + 1.3), gHash3(id + 2.7), gHash3(id + 5.1))) / 190.0; vec3 sd = normalize(sp); float a = length(d - sd);",
    "  float px = max(length(fwidth(d)), 1e-5); float sz = px * 0.6; float b = pow((h - 0.991) / 0.009, 4.0) * 1.3 + 0.06;",
    "  float tw = 0.72 + 0.28 * sin(uTime * (2.0 + 5.0 * gHash3(id + 9.1)) + h * 90.0); tw = mix(1.0, tw, 0.5 + 0.5 * (1.0 - smoothstep(0.05, 0.5, d.y)));",
    "  vec3 col = mix(vec3(1.0, 0.82, 0.64), vec3(0.72, 0.82, 1.0), gHash3(id + 3.3));",
    "  return col * b * tw * exp(-a * a / (sz * sz)) * smoothstep(0.0, 0.12, d.y); }",
    "vec3 milky(vec3 d){ vec3 n = normalize(vec3(0.32, 0.5, 0.8)); float band = dot(d, n); float k = exp(-band * band * 16.0);",
    "  vec3 core = normalize(vec3(-0.62, 0.35, 0.7)); float c = pow(max(0.0, dot(d, core)), 3.0);",
    "  float n1 = gNoise3(d * 6.0) * 0.55 + gNoise3(d * 15.0 + 3.7) * 0.3 + gNoise3(d * 38.0) * 0.15; float lane = smoothstep(0.28, 0.62, gNoise3(d * 9.0 + 9.1)) * exp(-band * band * 70.0);",
    "  float m = k * (0.25 + 0.75 * smoothstep(0.35, 0.85, n1)) * (1.0 - 0.7 * lane) * (0.55 + 0.9 * c);",
    "  return vec3(0.62, 0.64, 0.78) * m * 0.11 + vec3(0.8, 0.66, 0.5) * c * k * 0.03; }",
    "void main(){ vec3 d = normalize(vDir); vec3 s = normalize(sunDir); float sy = s.y; float h = max(d.y, 0.0);",
    // day: single scattering, eye-adapted scale from the CPU, knee
    "  vec3 dayC = knee(preetham(vec3(d.x, max(d.y, 0.0), d.z), s) * uSkyExpo);",
    // twilight: the warm band toward the sun, the belt of Venus opposite, deep blue above
    "  vec3 hd = normalize(vec3(s.x, 0.0, s.z) + 1e-5); vec3 dh = normalize(vec3(d.x, 0.0, d.z) + 1e-5); float toward = dot(dh, hd) * 0.5 + 0.5;",
    "  float tw = smoothstep(-0.34, -0.03, sy) * (1.0 - smoothstep(0.03, 0.2, sy));",
    "  float venus = smoothstep(-0.12, -0.02, sy) * (1.0 - smoothstep(0.0, 0.06, h)) * pow(1.0 - toward, 3.0);",
    "  vec3 band = (mix(vec3(0.16, 0.19, 0.36), vec3(1.0, 0.46, 0.2), pow(toward, 2.4) * smoothstep(-0.3, -0.04, sy)) + vec3(0.3, 0.16, 0.24) * venus) * (1.0 - smoothstep(0.0, 0.28, h));",
    "  vec3 top = mix(vec3(0.05, 0.08, 0.2), vec3(0.09, 0.12, 0.26), pow(toward, 3.0)); vec3 twC = mix(band + top * smoothstep(0.0, 0.28, h), top, smoothstep(0.28, 0.9, h)) * (0.1 + 0.9 * smoothstep(-0.34, 0.0, sy));",
    // night: airglow near the horizon, stars, Milky Way, moon
    "  vec3 nightC = mix(vec3(0.085, 0.095, 0.13), vec3(0.011, 0.015, 0.034), smoothstep(-0.02, 0.55, d.y));",
    // the towns to the south (Douglas, Agua Prieta) leave a faint warm dome on the horizon
    "  nightC += vec3(0.05, 0.034, 0.018) * pow(max(0.0, dh.z), 2.0) * (1.0 - smoothstep(0.0, 0.16, h));",
    "  float sa = uShift * 6.28318; vec3 dr = vec3(d.x * cos(sa) - d.z * sin(sa), d.y, d.x * sin(sa) + d.z * cos(sa));",
    "  float nk = kNight * (1.0 - uStorm * 0.9);",
    "  if (nk > 0.001 && uEnv < 0.5) { nightC += (milky(dr) + stars(dr)) * nk; }",
    "  vec3 sky = dayC * (1.0 - tw) + twC * tw; sky = mix(sky, nightC, kNight);",
    // the moon: a lit sphere, phase from the real sun direction, maria, a soft halo
    "  { vec3 M = normalize(uMoonDir); float md = dot(d, M); float mr = 0.0115; if (md > 0.99) { float ang = acos(clamp(md, -1.0, 1.0)); float mvis = smoothstep(0.35, 0.8, kNight + 0.25 * (1.0 - smoothstep(0.1, 0.4, sy))) * (1.0 - uStorm * 0.95);",
    "      sky += vec3(0.55, 0.6, 0.72) * exp(-ang * 55.0) * 0.08 * mvis; if (ang < mr * 1.15) { vec3 mR = normalize(cross(M, vec3(0.0, 1.0, 0.0))); vec3 mU = cross(mR, M); vec2 q = vec2(dot(d, mR), dot(d, mU)) / mr; float q2 = dot(q, q);",
    "        if (q2 < 1.0) { vec3 n = mR * q.x + mU * q.y + M * sqrt(1.0 - q2); float lit = smoothstep(-0.06, 0.12, dot(n, s)); float mar = 0.72 + 0.28 * smoothstep(0.35, 0.7, gNoise(q * 2.2 + 3.0)) - 0.1 * smoothstep(0.55, 0.8, gNoise(q * 6.0 + 1.0));",
    "          vec3 moon = vec3(1.0, 0.97, 0.9) * mar * (lit * 1.6 + 0.015) * (0.9 + 0.1 * sqrt(1.0 - q2)); float edge = smoothstep(1.0, 0.9, q2); sky = mix(sky, moon, edge * mvis); } } } }",
    // the sun disc and its glow (bounded, as before: the bloom and flare were tuned to it)
    "  float sd = max(dot(d, s), 0.0); sky += sunCol * glow * (1.0 - uStorm * 0.97) * (pow(sd, 900.0) * 2.6 + pow(sd, 60.0) * 0.18 * (1.0 - smoothstep(0.1, 0.5, sy)) + pow(sd, 8.0) * 0.12);",
    // the monsoon: a slate deck, lighter toward the horizon, a brighter rim away from the storm, lightning lights the deck
    "  if (uStorm > 0.001) { float tS = dot(dh, normalize(uFlashDir)) * 0.5 + 0.5; float rim = smoothstep(0.55, 0.1, tS) * (1.0 - smoothstep(0.0, 0.3, h)); vec3 deck = uStormCol * (0.55 + 0.6 * (1.0 - smoothstep(0.0, 0.5, h))) * mix(1.6, 0.8, tS) + uStormCol * rim * 2.5;",
    "    float n = gNoise(vec2(atan(d.z, d.x) * 6.0, h * 9.0) + uTime * 0.02) * 0.5 + gNoise(vec2(atan(d.z, d.x) * 17.0, h * 25.0) - uTime * 0.03) * 0.5; deck *= 0.82 + 0.3 * n;",
    "    sky = mix(sky, deck, uStorm * mix(0.6, 0.97, smoothstep(0.2, 0.75, tS))); sky += vec3(0.75, 0.8, 1.0) * uFlash * (0.25 + 0.75 * pow(max(0.0, dot(d, normalize(uFlashDir + vec3(0.0, 0.25, 0.0)))), 6.0)) * uStorm; }",
    "  if (uEnv > 0.5) { float l = dot(sky, vec3(0.2126, 0.7152, 0.0722)); sky = mix(sky, vec3(l), uKnee.z); }",
    "  gl_FragColor = vec4(max(sky, vec3(0.0)), 1.0); }"
  ].join("\n");

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
    skyMat.fragmentShader = SKY_FRAG; skyMat.needsUpdate = true;
    // the probe renders the sky too: a slightly desaturated, eye-adapted copy lights the world (uEnv), then the flag drops again
    if (!ORIG.updateEnvironment) ORIG.updateEnvironment = updateEnvironment;
    var ue = ORIG.updateEnvironment;
    updateEnvironment = function (now, force) { var U2 = skyMat.uniforms; if (U2.uEnv) U2.uEnv.value = 1; try { return ue(now, force); } finally { if (U2.uEnv) U2.uEnv.value = 0; } };
    // the old star points are drawn in the sky shader now (2 draws saved)
    try { stars.visible = false; stars2.visible = false; } catch (e) {}
    GX.n.sky = 1;
  }
  function uninstallSky() {
    if (typeof skyMat === "undefined" || !ORIG.skyFrag) return;
    skyMat.fragmentShader = ORIG.skyFrag; skyMat.needsUpdate = true;
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
    "uniform sampler2D tNoise; uniform vec3 uLDir; uniform vec3 uLCol; uniform vec3 uAmbT; uniform vec3 uAmbB; uniform vec3 uHaze; uniform float uHazeK; uniform float uDay; uniform float uStorm; uniform float uFlash; uniform vec3 uFlashP; uniform float uTime; uniform float uGust; uniform vec3 uStormCol; uniform vec3 uSDir;",
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
    "  gl_FragColor = vec4(col, a); }"
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
  // grading keyframes: [sat, contrast, shadow tint rgb, highlight tint rgb, white balance rgb, lift]
  var GR = {
    noon: [1.14, 1.08, [0.95, 0.98, 1.06], [1.05, 1.0, 0.95], [1.02, 1.0, 0.98], 0.0, 1.14],
    day: [1.12, 1.09, [0.93, 0.97, 1.08], [1.06, 1.0, 0.93], [1.02, 1.0, 0.98], 0.0, 1.12],
    golden: [1.16, 1.1, [0.91, 0.94, 1.08], [1.08, 1.0, 0.88], [1.05, 1.0, 0.93], 0.0, 1.16],
    blue: [1.04, 1.06, [0.86, 0.94, 1.16], [1.02, 0.98, 1.02], [0.92, 0.97, 1.1], 0.004, 0.9],
    night: [1.05, 1.08, [0.86, 0.95, 1.16], [1.0, 1.0, 1.03], [0.88, 0.96, 1.12], 0.004, 0.72],
    storm: [0.82, 1.05, [0.92, 0.97, 1.06], [1.0, 1.0, 1.0], [0.95, 0.99, 1.04], 0.003, 0.78]
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
    // light: the storm dims the key light and cools the fill; a strike lights everything for a moment
    var keyK = 1 - 0.78 * S; var fl = st.flash;
    try { if (CSMX.on && CSMX.csm) { for (var li = 0; li < CSMX.csm.lights.length; li++) lscale(CSMX.csm.lights[li], keyK, 0); } else lscale(sun, keyK, 0); } catch (e) {}
    lscale(hemi, 1 - 0.3 * S, fl * 0.45); if (S > 0) hemi.color.lerp(TMP.c.setRGB(0.66, 0.72, 0.82), S * 0.6); if (fl > 0) hemi.color.lerp(TMP.c.setRGB(0.85, 0.9, 1.0), clamp(fl, 0, 1));
    if (typeof POST !== "undefined") { POST.exposure *= 1 + fl * 0.15; }
    try { cloudA.material.opacity = Math.min(0.95, cloudA.material.opacity + S * 0.4 * day); cloudB.material.opacity = Math.min(0.9, cloudB.material.opacity + S * 0.5 * day); cloudA.material.color.lerp(TMP.c.setRGB(0.16, 0.17, 0.19), S * 0.8); cloudB.material.color.copy(cloudA.material.color); } catch (e) {}
    // clouds: light, ambient and haze
    if (CL) { var cu = CL.mesh.material.uniforms; var lightDir = el > -0.04 ? sdir : mdir; cu.uLDir.value.fromArray(lightDir);
      var sc = sun.color; var sunUp = sstep(-0.06, 0.1, el); var goldK = sstep(0.35, 0.02, el) * sunUp;
      cu.uLCol.value.setRGB(1.0, 0.94 - 0.28 * goldK, 0.86 - 0.5 * goldK).multiplyScalar(0.85 * sunUp * (1 - 0.7 * S)); if (el <= -0.04) cu.uLCol.value.setRGB(0.045, 0.052, 0.07).multiplyScalar(nightK * (1 - S));
      cu.uAmbT.value.setRGB(zen[0], zen[1], zen[2]).multiplyScalar(skyE * 0.9).lerp(TMP.c.setRGB(0.55, 0.58, 0.64), 0.35); cu.uAmbT.value.multiplyScalar(0.35 + 0.65 * day);
      if (nightK > 0) cu.uAmbT.value.lerp(TMP.c.setRGB(0.012, 0.015, 0.024), nightK);
      if (tw > 0) cu.uAmbT.value.lerp(TMP.c.setRGB(0.26, 0.26, 0.38), tw * 0.5 * day);
      cu.uAmbB.value.copy(cu.uAmbT.value).multiplyScalar(0.62).lerp(TMP.c.setRGB(0.5, 0.42, 0.34).multiplyScalar(day), 0.25);
      cu.uHaze.value.copy(fogC); cu.uDay.value = 0.35 + 0.65 * day; cu.uStorm.value = S; cu.uFlash.value = st.flash; cu.uTime.value = now / 1000; cu.uGust.value = 0.35 + 0.65 * st.gust; cu.uStormCol.value.copy(U.uStormCol.value); cu.uSDir.value.set(sd[0], 0, sd[2]);
      CL.drift += (dt || 0) * 2.4; cu.uDrift.value.set(CL.drift, 0); }
    // grading
    GX.grade = gradeFor(el, t < 0.5, S);
    if (GX.post && GX.post.fin) { var F = POST.mFinal.uniforms; var G = GX.grade; F.uGSat.value = G[0]; F.uGSatLo.value = G[6] === undefined ? G[0] : G[6]; F.uGCon.value = G[1]; F.uGSh.value.fromArray(G[2]); F.uGHi.value.fromArray(G[3]); F.uGWB.value.fromArray(G[4]); F.uGLift.value = G[5];
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
  var FIN_UNI = "uniform float uGSat; uniform float uGSatLo; uniform float uGCon; uniform vec3 uGSh; uniform vec3 uGHi; uniform vec3 uGWB; uniform float uGLift; uniform float uFlash; uniform vec3 uGfxCam; uniform mat4 uGfxVP; uniform float uHeatK; uniform vec4 uHS[16]; uniform float uHSN; uniform vec4 uFlY[4]; uniform vec4 uFlB[4]; uniform float uFlN; uniform float uSsrK; uniform vec2 uAoPx;\n";
  var FIN_FN = [
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
    "  if (any(isnan(rc)) || any(isinf(rc))) return c; vec2 e = min(huv, 1.0 - huv); float edge = smoothstep(0.0, 0.08, min(e.x, e.y)); float cosV = clamp(-V.y, 0.0, 1.0); float fres = 0.06 + 0.94 * pow(1.0 - cosV, 5.0);",
    "  float w = fy.y * uSsrK * edge * (1.0 - smoothstep(6.0, 22.0, ht)) * (0.35 + 0.65 * fres); return mix(c, rc * fy.z, clamp(w, 0.0, 0.85)); }",
    // AO upsampling that respects depth edges (no dark halo round a near silhouette against the far ground or the sky)
    "float gfxAO(vec2 uv, float lin0){ vec2 px = uAoPx; float acc = 0.0, tw = 0.0; for (int i = 0; i < 4; i++) { vec2 o = (vec2(float(i - (i / 2) * 2), float(i / 2)) * 2.0 - 1.0) * px * 0.75; float zl = gfxLin(uv + o); float w = 1.0 / (0.02 + abs(zl - lin0) / max(lin0, 0.5)); acc += texture2D(tAO, uv + o).r * w; tw += w; } return acc / max(tw, 1e-4); }",
    // grading: saturation, contrast, split tone and white balance per time of day (keyframes in plan_gfx.js)
    "vec3 gfxGrade(vec3 c){ c *= uGWB; float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, mix(uGSatLo, uGSat, smoothstep(0.06, 0.4, l))); c = (c - 0.5) * uGCon + 0.5; l = clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0); c = mix(c * uGSh, c * uGHi, smoothstep(0.12, 0.82, l)); c += uGLift * (1.0 - c); return c; }"
  ].join("\n") + "\n";

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
      src = rep(src, "float l = luma(c); c = mix(vec3(l), c, 1.18); c = (c - 0.5) * 1.1 + 0.5; c = mix(c * vec3(0.9, 0.96, 1.12), c * vec3(1.08, 1.0, 0.9), smoothstep(0.12, 0.82, l));", "c = gfxGrade(c);", "grade");
      var U = F.uniforms; U.uGSat = { value: 1.18 }; U.uGSatLo = { value: 1.18 }; U.uGCon = { value: 1.1 }; U.uGSh = { value: new THREE.Vector3(0.9, 0.96, 1.12) }; U.uGHi = { value: new THREE.Vector3(1.08, 1.0, 0.9) }; U.uGWB = { value: new THREE.Vector3(1, 1, 1) }; U.uGLift = { value: 0 }; U.uFlash = { value: 0 };
      U.uGfxCam = { value: new THREE.Vector3() }; U.uGfxVP = { value: new THREE.Matrix4() }; U.uHeatK = { value: 0 }; U.uHS = { value: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(function () { return new THREE.Vector4(); }) }; U.uHSN = { value: 0 };
      U.uFlY = { value: [0, 1, 2, 3].map(function () { return new THREE.Vector4(); }) }; U.uFlB = { value: [0, 1, 2, 3].map(function () { return new THREE.Vector4(); }) }; U.uFlN = { value: 0 }; U.uSsrK = { value: 0 }; U.uAoPx = { value: new THREE.Vector2(1 / 640, 1 / 360) };
      F.fragmentShader = src; F.needsUpdate = true; GX.post.fin = true;
    } else note("post", "mFinal changed: grading, heat and floor reflections skipped");
    // AO
    if (POST.mAO && POST.mAOBlur) {
      if (!ORIG.aoFrag) { ORIG.aoFrag = POST.mAO.fragmentShader; ORIG.aoBlurFrag = POST.mAOBlur.fragmentShader; }
      var A = POST.mAO.uniforms; A.uDirs = { value: 6 }; A.uRad = { value: GX.K.aoRadius }; POST.mAO.fragmentShader = AO_FRAG; POST.mAO.needsUpdate = true;
      var B = POST.mAOBlur.uniforms; B.uNear = { value: camera.near }; B.uFar = { value: camera.far }; POST.mAOBlur.fragmentShader = AOBLUR_FRAG; POST.mAOBlur.needsUpdate = true; GX.post.ao = true;
    }
    // rays: a golden-hour boost and the storm's cut
    if (POST.mRays) { if (!ORIG.raysFrag) ORIG.raysFrag = POST.mRays.fragmentShader; var rs = ORIG.raysFrag; if (rs.indexOf("r * uStrength") >= 0) { POST.mRays.uniforms.uGfxK = { value: 1 }; POST.mRays.fragmentShader = rs.replace("uniform float uStrength;", "uniform float uStrength; uniform float uGfxK;").replace("r * uStrength", "r * uStrength * uGfxK"); POST.mRays.needsUpdate = true; GX.post.rays = true; } }
    // medium gets a cheap AO (4 directions); the quality table is a shared object, restored on uninstall
    if (!ORIG.qMed) ORIG.qMed = { ao: QUAL_DEF.medium.ao, aoK: QUAL_DEF.medium.aoK };
    return true;
  }
  function uninstallPost() {
    if (typeof POST === "undefined" || !POST.mFinal) return;
    if (ORIG.finFrag) { POST.mFinal.fragmentShader = ORIG.finFrag; POST.mFinal.needsUpdate = true; }
    if (ORIG.aoFrag) { POST.mAO.fragmentShader = ORIG.aoFrag; POST.mAO.needsUpdate = true; POST.mAOBlur.fragmentShader = ORIG.aoBlurFrag; POST.mAOBlur.needsUpdate = true; }
    if (ORIG.raysFrag) { POST.mRays.fragmentShader = ORIG.raysFrag; POST.mRays.needsUpdate = true; }
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

  // ═════════════════════════ install / uninstall ═════════════════════════
  function wrapGlobals() {
    if (!ORIG.updateSky) ORIG.updateSky = updateSky; if (!ORIG.renderFrame) ORIG.renderFrame = renderFrame; if (!ORIG.initPost) ORIG.initPost = initPost;
    var us = ORIG.updateSky, rf = ORIG.renderFrame, ip = ORIG.initPost;
    updateSky = function (dt) { us(dt); if (!GX.installed) return; try { afterSky(dt || 0); } catch (e) { if (!GX.skyErr) { GX.skyErr = 1; note("afterSky", e); } } };
    renderFrame = function () { var sv = typeof POST !== "undefined" ? POST.sunVis : 0; try { beforeRender(); if (GX.storm.k > 0 && typeof POST !== "undefined") POST.sunVis = sv * (1 - GX.storm.k); } catch (e) { if (!GX.rfErr) { GX.rfErr = 1; note("beforeRender", e); } } try { rf(); } finally { if (typeof POST !== "undefined") POST.sunVis = sv; } };
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
    if (typeof EDGE_MATS === "undefined") return; var n = 0;
    EDGE_MATS.forEach(function (m) { if (!m || m.userData.gfxOrig) return; wrapObc(m, "road", function (sh) { if (sh.fragmentShader.indexOf("#include <map_fragment>") < 0) return; sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n" + ROAD_FRAG); }); ROADS_T.mats.push(m); n++; });
    GX.n.roads = n;
  }
  function uninstallRoads() { ROADS_T.mats.forEach(unwrapObc); ROADS_T.mats = []; }
  // ═════════════════════════ polished floors: screen-space reflections (tier 2) over a box-projected room probe (tiers 1 and 2) ═════════════════════════
  var _v = null;
  function floorPlanes(obj, want) {
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
    var bg = scene.background, fog = scene.fog, sv = [];
    try {
      scene.background = typeof envTex !== "undefined" && envTex ? envTex : null; scene.fog = null;
      SH.meshes.forEach(function (m) { sv.push([m, m.visible]); m.visible = false; });
      var prevRT = renderer.getRenderTarget(), prevAU = renderer.shadowMap.autoUpdate, prevNU = renderer.shadowMap.needsUpdate; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
      renderer.setRenderTarget(Q.rt, Q.face); renderer.render(scene, Q.cc.children[Q.face]); renderer.setRenderTarget(prevRT); renderer.shadowMap.needsUpdate = prevNU; renderer.shadowMap.autoUpdate = prevAU;
    } catch (e) { note("probe", e); PQ.shift(); } finally { scene.background = bg; scene.fog = fog; sv.forEach(function (x) { x[0].visible = x[1]; }); }
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

  GX._dbg = { TR: TR, SH: SH, PROBES: PROBES, IN: IN, SITE: SITE, CL: function () { return CL; }, floorsUniforms: floorsUniforms };
  // ═════════════════════════ registration (last: every table above is initialised by now) ═════════════════════════
  hook("world", "gfxWorld", worldHook); hook("defer", "gfxDefer", deferHook); hook("frame", "gfxFrame", frameHook);
  var running = false; try { running = typeof FRAME_N !== "undefined" && FRAME_N > 0 && typeof POST !== "undefined" && !!POST.mFinal; } catch (e) {}
  if (hot || running) { GX.install(); try { updateSky(0); updateEnvironment(performance.now(), true); } catch (e) {} }
})();
