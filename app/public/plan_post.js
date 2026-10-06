// plan_post.js (R16, Agent P: post-processing and image quality). Classic script, loaded before client.js; reaches client globals
// (renderer, scene, camera, POST, QUAL, FRAME_N, night, ...) by bare name at call time only.
// High and ultra only (PLAN_GFX tier 2). plan_gfx.js's renderFrame wrapper calls PLAN_POST.render(rf) in place of the client's
// renderFrame; it returns false (and the client's own pipeline draws the frame) on low and medium, in VR, photo mode, ?nopost,
// before its programs are ready, or when switched off. Passes on high and ultra:
//   main scene (sub-pixel jitter)  ->  GTAO + contact shadows (half res, temporal)  ->  scene composite (AO, contact shadows,
//   floor reflections, aerial perspective and height fog with sun in-scatter)  ->  TAA resolve (depth reprojection, tracked
//   movers, variance clipping)  ->  god rays (client pass)  ->  mip-chain bloom (energy conserving)  ->  final (heat shimmer,
//   CAS sharpen, bloom, rays, flare, exposure, tone mapping, the plan_gfx grade, per-time-of-day 3D LUT, vignette, dither).
// Switches: ?p16=0 everything off (the R15 pipeline), ?taa=0 (SMAA fallback), ?gtao=0 (the R15 4-tap AO path is not used either:
// no AO), ?pbloom=0 (the client's threshold bloom), ?atmo=0 (the client's haze and fog), ?lut=0, ?cas=0, ?cshadow=0,
// ?tm=agx|aces|neutral|punchy (tone mapping, default agx). Live: PLAN_POST.set("taa", false), PLAN_POST.enable(false), PLAN_POST.K.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var QS = location.search;
  function qp(k) { var m = new RegExp("[?&]" + k + "=([^&#]*)").exec(QS); return m ? decodeURIComponent(m[1]) : null; }
  function qon(k) { return qp(k) !== "0"; }
  var prevPP = window.PLAN_POST;
  if (prevPP && prevPP.dispose) { try { prevPP.dispose(); } catch (e) {} }
  var TMS = { agx: 0, aces: 1, neutral: 2, punchy: 3 };
  var PP = window.PLAN_POST = {
    v: "r16", errs: [], n: { frames: 0, resets: 0, objs: 0, objMax: 0, built: 0, fallbacks: 0 },
    off: qp("p16") === "0" || qp("gfx") === "0",
    enabled: true, ready: false, active: false,
    sw: { taa: qon("taa"), gtao: qon("gtao"), bloom: qon("pbloom"), atmo: qon("atmo"), lut: qon("lut"), cas: qon("cas"), cs: qon("cshadow") },
    tm: TMS[qp("tm")] !== undefined ? TMS[qp("tm")] : 0,
    // tunables (live-editable)
    K: {
      // TAA: blend weight of the new frame (still / moving at taaVel px a frame), clip box width in sigmas (still / movers and
      // disocclusions), the reconstruction filter's sharpness (exp(-k d^2) over the 3x3 jittered samples; 0 = centre sample only)
      taaA: 0.085, taaAMove: 0.16, taaVel: 10, taaG: 1.15, taaGDyn: 0.75, taaFilt: 0, taaADyn: 0.22, taaADis: 0.3, taaN: 8,
      trackR: 90, trackMax: 8,
      // GTAO: world radius (m), slices and steps per side (ultra / high), the largest screen radius (half-res px), the falloff
      // share, the temporal blend, the distance it fades out, the strength, its weight on brightly lit pixels (AO is ambient
      // occlusion: the sun's direct light is not occluded by it), the albedo for the multi-bounce fit
      aoR: 1.35, aoS: [2, 2], aoN: [6, 4], aoMaxPx: 90, aoFall: 0.6, aoT: 0.12, aoFar: 260, aoK: 0.75, aoLit: 0.28, aoL0: 0.3, aoL1: 1.2, aoAlb: 0.42,
      // contact shadows (ultra): ray length scale (m), strength on sunlit pixels
      csLen: 0.55, csK: 0.55,
      // bloom: mips (ultra / high), scatter between levels, strength (lerp toward the bloom: energy conserving)
      bMips: [6, 5], bScatter: 0.68, bK: 0.05,
      // aerial perspective: Rayleigh scale (x the sea-level coefficients, 1,200 m of air above Douglas removed), aerosol (x the
      // client's haze coefficient), aerosol scale height (m), Mie g, the sun's in-scatter strength, ambient in-scatter tint
      atR: 0.62, atM: 0.42, atH: 1500, atG: 0.72, atSun: 1.1, atAmb: 1.0,
      // final: CAS sharpness (0..1), dither (in 1/255), LUT strength
      cas: 0.55, dither: 1.0, lutK: 1.0
    }
  };
  if (PP.off) return;
  function note(w, e) { var m = w + ": " + (e && e.message ? e.message : e); if (PP.errs.length < 40) PP.errs.push(m); if (PP.errs.length <= 8) console.warn("[post] " + m); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function halton(i, b) { var f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

  // ═════════════════════════ shaders ═════════════════════════
  var VS = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
  var COMMON = [
    "float p16Lin(float z){ return 2.0 * uNear * uFar / (uFar + uNear - (z * 2.0 - 1.0) * (uFar - uNear)); }",
    "bool p16Bad(vec3 c){ uvec3 b = floatBitsToUint(c) & uvec3(0x7f800000u); return any(equal(b, uvec3(0x7f800000u))); }",
    "float p16Ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }"
  ].join("\n") + "\n";

  // TAA resolve (full res, HDR): depth reprojection with the previous unjittered view-projection, the tracked movers' own rigid
  // motion (world-space boxes), 3x3 neighbourhood in tonemapped YCoCg, variance clipping, Catmull-Rom history, a reconstruction
  // filter over the jittered samples; alpha keeps "this pixel was a mover" for the next frame's disocclusion test
  var TAA_FS = [
    "varying vec2 vUv; uniform sampler2D tCur; uniform sampler2D tHist; uniform sampler2D tDepth; uniform vec2 uPx; uniform vec2 uSize; uniform vec2 uJit;",
    "uniform float uNear; uniform float uFar; uniform vec2 uTan; uniform mat3 uCamRot; uniform vec3 uCamPos; uniform mat4 uPrevVP; uniform float uReset; uniform vec4 uTaaK; uniform vec4 uTaaK2; uniform vec2 uTaaK3;",
    "uniform float uObjN; uniform mat4 uObjInv[8]; uniform mat4 uObjPrev[8]; uniform vec4 uObjMin[8]; uniform vec4 uObjMax[8];",
    COMMON,
    "float mx3(vec3 c){ return max(c.r, max(c.g, c.b)); }",
    "vec3 tmap(vec3 c){ return c / (1.0 + mx3(c)); }",
    "vec3 itmap(vec3 c){ return c / max(1.0 - mx3(c), 1.0 / 4096.0); }",
    "vec3 toY(vec3 c){ return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }",
    "vec3 fromY(vec3 c){ return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }",
    "vec3 fetchC(vec2 uv){ vec3 c = textureLod(tCur, uv, 0.0).rgb; if (p16Bad(c)) c = vec3(0.0); return max(c, vec3(0.0)); }",
    "vec4 histCR(vec2 uv){ vec2 sp = uv * uSize; vec2 tc = floor(sp - 0.5) + 0.5; vec2 f = sp - tc;",
    "  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)); vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f); vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)); vec2 w3 = f * f * (-0.5 + 0.5 * f);",
    "  vec2 w12 = w1 + w2; vec2 t0 = (tc - 1.0) * uPx; vec2 t3 = (tc + 2.0) * uPx; vec2 t12 = (tc + w2 / w12) * uPx;",
    "  float a = w12.x * w0.y, b = w0.x * w12.y, c = w12.x * w12.y, d = w3.x * w12.y, e = w12.x * w3.y;",
    "  vec4 r = textureLod(tHist, vec2(t12.x, t0.y), 0.0) * a + textureLod(tHist, vec2(t0.x, t12.y), 0.0) * b + textureLod(tHist, t12, 0.0) * c + textureLod(tHist, vec2(t3.x, t12.y), 0.0) * d + textureLod(tHist, vec2(t12.x, t3.y), 0.0) * e;",
    "  return max(r / (a + b + c + d + e), vec4(0.0)); }",
    "vec3 clipBox(vec3 mn, vec3 mx, vec3 q){ vec3 ce = 0.5 * (mx + mn), ex = 0.5 * (mx - mn) + 1e-6; vec3 v = q - ce; vec3 a = abs(v / ex); float m = max(a.x, max(a.y, a.z)); return m > 1.0 ? ce + v / m : q; }",
    "void main(){",
    "  float z = textureLod(tDepth, vUv, 0.0).x; float lin = p16Lin(z); bool sky = z >= 0.9999995 || lin > 60000.0;",
    "  vec3 P = vec3((vUv * 2.0 - 1.0) * uTan * lin, -lin); vec3 X = uCamPos + uCamRot * (sky ? normalize(P) * 100000.0 : P); vec3 Xp = X; float dyn = 0.0;",
    "  if (!sky) { for (int i = 0; i < 8; i++) { if (float(i) >= uObjN) break; vec3 l = (uObjInv[i] * vec4(X, 1.0)).xyz; if (all(greaterThanEqual(l, uObjMin[i].xyz)) && all(lessThanEqual(l, uObjMax[i].xyz))) { Xp = (uObjPrev[i] * vec4(l, 1.0)).xyz; dyn = 1.0; break; } } }",
    "  vec4 pc = uPrevVP * vec4(Xp, 1.0); vec2 puv = pc.w > 1e-4 ? pc.xy / pc.w * 0.5 + 0.5 : vec2(-1.0);",
    "  vec3 m1 = vec3(0.0), m2 = vec3(0.0), cf = vec3(0.0), cC = vec3(0.0), mn = vec3(1e4), mx = vec3(-1e4); float ws = 0.0;",
    "  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 o = vec2(float(i), float(j)); vec3 y = toY(tmap(fetchC(vUv + o * uPx))); m1 += y; m2 += y * y; mn = min(mn, y); mx = max(mx, y);",
    "    vec2 d = o - uJit; float w = exp(-uTaaK2.x * dot(d, d)); cf += y * w; ws += w; if (i == 0 && j == 0) cC = y; }",
    "  m1 /= 9.0; m2 /= 9.0; vec3 sig = sqrt(max(m2 - m1 * m1, vec3(0.0)));",
    "  vec3 cur = uTaaK2.x > 0.0 ? cf / ws : cC;",
    "  bool off = puv.x < 0.0 || puv.y < 0.0 || puv.x > 1.0 || puv.y > 1.0;",
    "  vec4 h = off ? vec4(0.0) : histCR(puv); float hdyn = clamp(h.a, 0.0, 1.0); vec3 hy = toY(tmap(h.rgb));",
    "  float dis = (1.0 - dyn) * smoothstep(0.08, 0.5, hdyn); float g = mix(uTaaK.z, uTaaK.w, max(dyn, dis));",
    "  vec3 bMin = m1 - g * sig, bMax = m1 + g * sig;",
    "  float wide = max(sky ? 1.0 : 0.0, smoothstep(2.5, 6.0, mx.x / max(m1.x, 1e-3)) * (1.0 - dyn));",   // stars, far lamps and windows: a sub-pixel point is one outlier among nine, which a variance box clips away
    "  hy = clipBox(mix(bMin, mn, wide), mix(bMax, mx, wide), hy);",
    "  float speed = length((puv - vUv) * uSize); float a = mix(uTaaK.x, uTaaK.y, clamp(speed / uTaaK2.w, 0.0, 1.0)); a = max(a, dyn * uTaaK2.y); a = max(a, dis * uTaaK2.z);",
    "  if (off || uReset > 0.5) a = 1.0;",
    "  vec3 r = clamp(fromY(mix(hy, cur, a)), vec3(0.0), vec3(0.9995));",
    "  gl_FragColor = vec4(itmap(r), dyn); }"
  ].join("\n");

  // GTAO (Jimenez et al. 2016, after XeGTAO) at half res with interleaved-gradient slice rotation that changes every frame, plus
  // screen-space contact shadows toward the sun, then a temporal blend with the reprojected history (rejected on depth mismatch).
  // Out: r = visibility, g = contact shadow, b = linear depth (for the bilateral upsample and the next frame's test)
  var GTAO_FS = [
    "varying vec2 vUv; uniform sampler2D tDepth; uniform sampler2D tHist; uniform vec2 uFullPx; uniform vec2 uHalfSize; uniform float uNear; uniform float uFar; uniform vec2 uTan;",
    "uniform mat3 uCamRot; uniform vec3 uCamPos; uniform mat4 uPrevVP; uniform float uReset; uniform vec4 uAoP; uniform vec4 uAoP2; uniform vec4 uCs;",
    COMMON,
    "vec3 vpL(vec2 uv, float l){ return vec3((uv * 2.0 - 1.0) * uTan * l, -l); }",
    "vec3 vp(vec2 uv){ return vpL(uv, p16Lin(textureLod(tDepth, uv, 0.0).x)); }",
    "float facos(float x){ float ax = abs(x); float r = (-0.156583 * ax + 1.5707963) * sqrt(max(0.0, 1.0 - ax)); return x >= 0.0 ? r : 3.14159265 - r; }",
    "void main(){",
    "  float z = textureLod(tDepth, vUv, 0.0).x; float lin = p16Lin(z);",
    "  if (z >= 0.9999995 || lin > uAoP2.w) { gl_FragColor = vec4(1.0, 0.0, lin, 1.0); return; }",
    "  vec3 P = vpL(vUv, lin); vec3 V = normalize(-P);",
    "  vec3 pr = vp(vUv + vec2(uFullPx.x, 0.0)), pl = vp(vUv - vec2(uFullPx.x, 0.0)), pu = vp(vUv + vec2(0.0, uFullPx.y)), pd = vp(vUv - vec2(0.0, uFullPx.y));",
    "  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl; vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd; vec3 N = normalize(cross(dx, dy)); if (dot(N, V) < 0.0) N = -N;",
    "  float pxm = uHalfSize.y / (2.0 * uTan.y * lin); float rPx = min(uAoP.x * pxm, uAoP2.x); float rW = rPx / pxm; float fr = max(uAoP2.y * rW, 1e-3); float fMul = -1.0 / fr; float fAdd = (rW - fr) / fr + 1.0;",
    "  float n0 = p16Ign(gl_FragCoord.xy + uAoP.w * vec2(5.588238, 3.927)); float n1 = p16Ign(gl_FragCoord.yx * vec2(1.13, 0.87) + uAoP.w * vec2(2.71, 7.03) + 17.0);",
    "  float vis = 0.0; float minS = min(1.4 / max(rPx, 1.0), 0.5);",
    "  for (int s = 0; s < 4; s++) { if (float(s) >= uAoP.y) break; float phi = (float(s) + n0) / uAoP.y * 3.14159265; vec2 om = vec2(cos(phi), sin(phi));",
    "    vec3 dv = vec3(om, 0.0); vec3 od = dv - dot(dv, V) * V; vec3 ax = normalize(cross(od, V) + vec3(1e-6)); vec3 pn = N - ax * dot(N, ax); float pnl = length(pn) + 1e-5;",
    "    float cn = clamp(dot(pn, V) / pnl, 0.0, 1.0); float na = sign(dot(od, pn)) * facos(cn); float lo0 = cos(na + 1.5707963), lo1 = cos(na - 1.5707963); float h0c = lo0, h1c = lo1;",
    "    vec2 omUv = om * rPx / uHalfSize;",
    "    for (int k = 0; k < 8; k++) { if (float(k) >= uAoP.z) break; float t = (float(k) + n1) / uAoP.z; t = t * t + minS; vec2 o = omUv * t;",
    "      vec3 d0 = vp(vUv + o) - P; float l0 = length(d0); float c0 = mix(lo0, dot(d0, V) / max(l0, 1e-4), clamp(l0 * fMul + fAdd, 0.0, 1.0)); h0c = max(h0c, c0);",
    "      vec3 d1 = vp(vUv - o) - P; float l1 = length(d1); float c1 = mix(lo1, dot(d1, V) / max(l1, 1e-4), clamp(l1 * fMul + fAdd, 0.0, 1.0)); h1c = max(h1c, c1); }",
    "    float h0 = -facos(h1c), h1 = facos(h0c); h0 = na + clamp(h0 - na, -1.5707963, 1.5707963); h1 = na + clamp(h1 - na, -1.5707963, 1.5707963); float sn = sin(na);",
    "    vis += pnl * 0.25 * ((cn + 2.0 * h0 * sn - cos(2.0 * h0 - na)) + (cn + 2.0 * h1 * sn - cos(2.0 * h1 - na))); }",
    "  float ao = clamp(vis / uAoP.y, 0.0, 1.25); ao = mix(ao, 1.0, smoothstep(uAoP2.w * 0.55, uAoP2.w, lin));",
    "  float cs = 0.0;",
    "  if (uCs.w > 0.0 && lin < 70.0) { vec3 L = uCs.xyz; if (dot(N, L) > 0.04) { float len = uCs.w * mix(0.5, 3.2, smoothstep(2.0, 60.0, lin)); float th = 0.05 + 0.012 * lin; vec3 Q0 = P + N * (0.006 + 0.0025 * lin);",
    "    for (int k = 0; k < 10; k++) { float t = (float(k) + n1) / 10.0; vec3 Q = Q0 + L * (len * t * t + 0.004 * lin); if (Q.z > -uNear) break; vec2 q = Q.xy / (-Q.z * uTan) * 0.5 + 0.5; if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) break;",
    "      float dz = -Q.z - p16Lin(textureLod(tDepth, q, 0.0).x); if (dz > 0.003 * lin + 0.004 && dz < th) { cs = 1.0; break; } }",
    "    cs *= 1.0 - smoothstep(45.0, 70.0, lin); } }",
    "  vec3 X = uCamPos + uCamRot * P; vec4 pc = uPrevVP * vec4(X, 1.0); vec2 puv = pc.w > 1e-4 ? pc.xy / pc.w * 0.5 + 0.5 : vec2(-1.0); vec4 h = textureLod(tHist, puv, 0.0);",
    "  bool ok = uReset < 0.5 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0 && abs(h.b - pc.w) < 0.035 * pc.w + 0.04;",
    "  gl_FragColor = vec4(ok ? mix(h.r, ao, uAoP2.z) : ao, ok ? mix(h.g, cs, 0.22) : cs, lin, 1.0); }"
  ].join("\n");

  // bloom: 13-tap downsample (Karis average on the first level), 3x3 tent upsample lerped into the level above (weights sum to 1)
  var BDOWN_FS = [
    "varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uSrcPx; uniform float uFirst;",
    "vec3 s(vec2 o){ return textureLod(tSrc, vUv + o * uSrcPx, 0.0).rgb; }",
    "float kw(vec3 c){ return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }",
    "void main(){ vec3 a = s(vec2(-2.0, -2.0)), b = s(vec2(0.0, -2.0)), c = s(vec2(2.0, -2.0)), d = s(vec2(-1.0, -1.0)), e = s(vec2(1.0, -1.0)), f = s(vec2(-2.0, 0.0)), g = s(vec2(0.0)), h = s(vec2(2.0, 0.0)), i = s(vec2(-1.0, 1.0)), j = s(vec2(1.0, 1.0)), k = s(vec2(-2.0, 2.0)), l = s(vec2(0.0, 2.0)), m = s(vec2(2.0, 2.0)); vec3 r;",
    "  if (uFirst > 0.5) { vec3 b0 = (d + e + i + j) * 0.25, b1 = (a + b + f + g) * 0.25, b2 = (b + c + g + h) * 0.25, b3 = (f + g + k + l) * 0.25, b4 = (g + h + l + m) * 0.25; float w0 = kw(b0) * 0.5, w1 = kw(b1) * 0.125, w2 = kw(b2) * 0.125, w3 = kw(b3) * 0.125, w4 = kw(b4) * 0.125;",
    "    r = (b0 * w0 + b1 * w1 + b2 * w2 + b3 * w3 + b4 * w4) / (w0 + w1 + w2 + w3 + w4); }",
    "  else r = (d + e + i + j) * 0.125 + (a + c + k + m) * 0.03125 + (b + f + h + l) * 0.0625 + g * 0.125;",
    "  gl_FragColor = vec4(min(max(r, vec3(0.0)), vec3(6.0e4)), 1.0); }"
  ].join("\n");
  var BUP_FS = [
    "varying vec2 vUv; uniform sampler2D tLow; uniform sampler2D tCur; uniform vec2 uLowPx; uniform float uScatter;",
    "void main(){ vec2 p = uLowPx; vec3 t = (textureLod(tLow, vUv + vec2(-p.x, -p.y), 0.0).rgb + textureLod(tLow, vUv + vec2(p.x, -p.y), 0.0).rgb + textureLod(tLow, vUv + vec2(-p.x, p.y), 0.0).rgb + textureLod(tLow, vUv + vec2(p.x, p.y), 0.0).rgb) * 0.0625",
    "  + (textureLod(tLow, vUv + vec2(0.0, -p.y), 0.0).rgb + textureLod(tLow, vUv + vec2(0.0, p.y), 0.0).rgb + textureLod(tLow, vUv + vec2(-p.x, 0.0), 0.0).rgb + textureLod(tLow, vUv + vec2(p.x, 0.0), 0.0).rgb) * 0.125 + textureLod(tLow, vUv, 0.0).rgb * 0.25;",
    "  gl_FragColor = vec4(mix(textureLod(tCur, vUv, 0.0).rgb, t, uScatter), 1.0); }"
  ].join("\n");

  // the client's final pass uniforms (shared value holders) and the declarations both full-res passes need for plan_gfx's GLSL
  var CL_UNI = "varying vec2 vUv; uniform sampler2D tCol; uniform sampler2D tDepth; uniform sampler2D tBloom; uniform sampler2D tRays; uniform sampler2D tAO; uniform vec2 uPx; uniform vec2 uSun; uniform float uSunVis; uniform vec3 uSunCol; uniform vec3 uHaze; uniform float uHazeK; uniform mat3 uCamRot; uniform vec2 uTan; uniform float uCamY; uniform vec3 uFog; uniform float uNight; uniform float uTime; uniform float uNear; uniform float uFar; uniform float uExposure; uniform float uHeat; uniform float uUnder; uniform float uFxaa; uniform float uAoK;\n";
  var CL_KEYS = ["uSun", "uSunVis", "uSunCol", "uHaze", "uHazeK", "uCamRot", "uTan", "uCamY", "uFog", "uNight", "uTime", "uNear", "uFar", "uExposure", "uHeat", "uUnder", "uFxaa", "uAoK"];

  // scene composite (full res, before TAA so every depth-dependent term is resolved with the image): floor reflections, the
  // bilateral AO upsample, contact shadows, then aerial perspective (Rayleigh with its blue extinction, aerosol with a
  // Henyey-Greenstein sun lobe, the client's ground haze layer) integrated along the view ray through exponential height density
  function compFS(G) {
    return [CL_UNI, G.uni,
      "uniform sampler2D tAO2; uniform vec2 uAoSize; uniform vec4 uAoK4; uniform float uAoAlb; uniform vec2 uCsK; uniform vec3 uSunW; uniform vec3 uSunL; uniform vec4 uAtm; uniform vec4 uAtm2; uniform float uAtmOn;",
      G.fn,
      "float p16Lin(float z){ return 2.0 * uNear * uFar / (uFar + uNear - (z * 2.0 - 1.0) * (uFar - uNear)); }",
      "vec4 aoUp(vec2 uv, float lin0){ vec2 p = uv * uAoSize - 0.5; vec2 b = floor(p + 0.5); vec4 acc = vec4(0.0); float tw = 0.0;",
      "  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 q = clamp(b + vec2(float(i), float(j)), vec2(0.0), uAoSize - 1.0); vec4 t = texelFetch(tAO2, ivec2(q), 0); vec2 dd = abs(q - p);",
      "    float w = max(0.0, 1.5 - dd.x) * max(0.0, 1.5 - dd.y) * exp(-abs(t.b - lin0) / (0.025 * lin0 + 0.03)); acc += t * w; tw += w; }",
      "  return tw > 1e-4 ? acc / tw : vec4(1.0, 0.0, lin0, 1.0); }",
      "float odH(float y0, float dy, float dist, float k){ float e0 = exp(-k * y0); float kd = k * dy; return abs(kd) < 1e-3 ? e0 * dist : e0 * (1.0 - exp(-kd)) / kd * dist; }",
      "vec3 atmo(vec3 c, vec2 uv, float lin, float isSky){",
      "  vec3 ld = normalize(vec3((uv.x - 0.5) * 2.0 * uTan.x, (uv.y - 0.5) * 2.0 * uTan.y, -1.0)); vec3 vd = uCamRot * ld;",
      "  float dist = isSky > 0.5 ? 5000.0 : min(60000.0, lin / max(0.05, -ld.z)); float dy = vd.y * dist; float y0 = uCamY - uAtm.w;",
      "  vec3 tR = vec3(5.8e-6, 13.5e-6, 33.1e-6) * uAtm.x * odH(y0, dy, dist, 1.0 / 8000.0) * (1.0 - isSky);",
      "  float tM = uHazeK * uAtm.y * odH(y0, dy, dist, 1.0 / uAtm.z) * (1.0 - isSky);",
      "  float dF = min(dist, 5000.0); float tF = min(uFog.x * odH(clamp(uCamY - uFog.z, -30.0, 400.0), vd.y * dF, dF, uFog.y), 1.609);",
      "  vec3 tau = tR + vec3(tM + tF); vec3 T = exp(-tau); float mu = dot(vd, uSunW); float g = uAtm2.x;",
      "  float hg = (1.0 - g * g) / (12.566371 * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5)) * 12.566371;",
      "  vec3 shM = vec3(tM + tF) / max(tau, vec3(1e-7)); vec3 shR = tR / max(tau, vec3(1e-7));",
      "  vec3 S = uHaze * uAtm2.z * (shM + shR * (0.75 + 0.5 * mu * mu)) + uSunL * (shM * hg * 0.08 + shR * 0.04 * (1.0 + mu * mu)) * uAtm2.y;",
      "  return c * T + S * (1.0 - T); }",
      "vec3 p16Haze(vec3 c, vec2 uv, float lin, float isSky){",   // the client's haze and height fog (?atmo=0)
      "  float haze = (1.0 - exp(-lin * uHazeK)) * (1.0 - isSky) * 0.5; vec2 sd = uv - uSun; float sunF = exp(-dot(sd, sd) * 2.2) * uSunVis; vec3 hazeCol = mix(uHaze, uSunCol, sunF * 0.75); c = mix(c, hazeCol, haze);",
      "  vec3 ld = normalize(vec3((uv.x - 0.5) * 2.0 * uTan.x, (uv.y - 0.5) * 2.0 * uTan.y, -1.0)); vec3 vd = uCamRot * ld; float dist = isSky > 0.5 ? 5000.0 : min(5000.0, lin / max(0.05, -ld.z)); float dy = vd.y * dist; float k = uFog.y; float e0 = exp(-k * clamp(uCamY - uFog.z, -30.0, 400.0)); float integ = abs(dy) < 0.5 ? e0 * dist : e0 * (1.0 - exp(-k * dy)) / (k * dy) * dist; float fog = clamp(1.0 - exp(-uFog.x * max(integ, 0.0)), 0.0, 0.8); return mix(c, hazeCol * vec3(1.03, 0.97, 0.9), fog); }",
      "void main(){ vec3 c = texture2D(tCol, vUv).rgb; if (gfxBad(c)) c = vec3(0.0); float z = texture2D(tDepth, vUv).x; float lin = p16Lin(z); float isSky = step(60000.0, lin);",
      "  c = gfxFloor(c, vUv, lin);",
      "  if (uAoK4.x > 0.0 && isSky < 0.5) { vec4 a = aoUp(vUv, lin); float v = clamp(a.r, 0.0, 1.0);",
      "    float ka = 2.0404 * uAoAlb - 0.3324, kb = -4.7951 * uAoAlb + 0.6417, kc = 2.7552 * uAoAlb + 0.6903; v = max(v, ((v * ka + kb) * v + kc) * v);",
      "    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722)) * uExposure; float lit = smoothstep(uAoK4.z, uAoK4.w, lum);",
      "    c *= mix(1.0, v, uAoK4.x * mix(1.0, uAoK4.y, lit));",
      "    c *= 1.0 - uCsK.x * clamp(a.g, 0.0, 1.0) * uCsK.y * lit; }",
      "  c = uAtmOn > 0.5 ? atmo(c, vUv, lin, isSky) : p16Haze(c, vUv, lin, isSky);",
      "  gl_FragColor = vec4(max(c, vec3(0.0)), 1.0); }"
    ].join("\n");
  }

  // final: heat shimmer, CAS (AMD FidelityFX contrast adaptive sharpening, on tonemapped weights), energy-conserving bloom, the
  // client's rays, flare and sun glare, exposure, tone mapping (AgX as in R15 / ACES Hill fit / Khronos PBR Neutral / AgX punchy),
  // plan_gfx's grade, vignette, sRGB, the time-of-day 3D LUT (two keyframes blended), dither
  function finFS(G) {
    return [CL_UNI, G.uni,
      "uniform highp sampler3D tLutA; uniform highp sampler3D tLutB; uniform float uLutT; uniform float uLutK; uniform float uTM; uniform float uCasK; uniform float uBloomPB; uniform float uBloomAdd; uniform float uDither;",
      G.fn,
      "float p16Lin(float z){ return 2.0 * uNear * uFar / (uFar + uNear - (z * 2.0 - 1.0) * (uFar - uNear)); }",
      "float p16Ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }",
      "vec3 agx(vec3 v){ const mat3 inset = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104); const mat3 outset = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);",
      "  v = inset * max(v, 0.0); v = clamp(log2(max(v, 1e-10)), -12.47393, 4.026069); v = (v + 12.47393) / (4.026069 + 12.47393); vec3 x2 = v * v, x4 = x2 * x2; v = 15.5 * x4 * x2 - 40.14 * x4 * v + 31.96 * x4 - 6.868 * x2 * v + 0.4298 * x2 + 0.1191 * v - 0.00232;",
      "  if (uTM > 2.5) { float l = dot(v, vec3(0.2126, 0.7152, 0.0722)); v = pow(max(v, 0.0), vec3(1.35)); float l2 = dot(v, vec3(0.2126, 0.7152, 0.0722)); v = l2 + 1.4 * (v - l2); }",
      "  v = outset * v; return pow(max(v, 0.0), vec3(2.2)); }",
      "vec3 acesHill(vec3 c){ const mat3 mi = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777)); const mat3 mo = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));",
      "  c = mi * (c / 0.6); vec3 a = c * (c + 0.0245786) - 0.000090537; vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081; return clamp(mo * (a / b), 0.0, 1.0); }",
      "vec3 pbrNeutral(vec3 c){ float x = min(c.r, min(c.g, c.b)); float off = x < 0.08 ? x - 6.25 * x * x : 0.04; c -= off; float pk = max(c.r, max(c.g, c.b)); if (pk < 0.76) return c; float d = 0.24; float np = 1.0 - d * d / (pk + d - 0.76); c *= np / pk; float g = 1.0 - 1.0 / (0.15 * (pk - np) + 1.0); return mix(c, vec3(np), g); }",
      "vec3 tonemap(vec3 c){ vec3 r; if (uTM < 0.5 || uTM > 2.5) r = agx(c); else if (uTM < 1.5) r = acesHill(c); else r = pbrNeutral(c); return r; }",
      "vec3 casS(vec2 uv){ vec3 e = texture2D(tCol, uv).rgb; if (uCasK <= 0.0) return e; vec3 b = texture2D(tCol, uv + vec2(0.0, uPx.y)).rgb, d = texture2D(tCol, uv - vec2(uPx.x, 0.0)).rgb, f = texture2D(tCol, uv + vec2(uPx.x, 0.0)).rgb, h = texture2D(tCol, uv - vec2(0.0, uPx.y)).rgb;",
      "  vec3 tb = b / (1.0 + b), td = d / (1.0 + d), te = e / (1.0 + e), tf = f / (1.0 + f), th = h / (1.0 + h); vec3 mn = min(te, min(min(tb, td), min(tf, th))), mx = max(te, max(max(tb, td), max(tf, th)));",
      "  vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0)); vec3 w = amp * (-1.0 / mix(8.0, 5.0, uCasK));",
      "  vec3 r = (e + (b + d + f + h) * w) / (1.0 + 4.0 * w); vec3 lo = min(e, min(min(b, d), min(f, h))), hi = max(e, max(max(b, d), max(f, h))); return clamp(r, lo, hi); }",
      "void main(){ float z0 = texture2D(tDepth, vUv).x; float lin0 = p16Lin(z0); vec2 uvh = vUv;",
      "  { float amp = gfxHeat(vUv, lin0); if (amp > 0.0) { vec2 wob = vec2(sin(vUv.y * 170.0 + uTime * 5.1 + sin(vUv.x * 60.0 + uTime * 1.3) * 2.0) + 0.6 * sin(vUv.y * 310.0 - uTime * 7.3), cos(vUv.x * 120.0 + vUv.y * 40.0 - uTime * 4.2)) * amp; if (gfxLin(vUv + wob) > lin0 * 0.8) uvh += wob; } }",
      "  vec3 c = casS(uvh); float isSky = step(60000.0, lin0); vec2 sd = vUv - uSun;",
      "  { vec3 bl = texture2D(tBloom, vUv).rgb; c = mix(c, bl, uBloomPB * uBloomK) + bl * uBloomAdd * uBloomK; }",
      "  vec3 rays = texture2D(tRays, vUv).rgb; c += rays * uSunCol * 1.1;",
      "  { float occ = clamp(texture2D(tRays, uSun).r * 3.0, 0.0, 1.0) * uSunVis; if (occ > 0.001) { vec2 asp = vec2(uTan.x / uTan.y, 1.0); vec2 toC = vec2(0.5) - uSun; vec3 fl = vec3(0.0); for (int i = 1; i <= 5; i++) { float fi = float(i); vec2 gp = uSun + toC * (fi * 0.42); float r = 0.012 + 0.022 * fi; vec2 d = (vUv - gp) * asp; float g = smoothstep(r, r * 0.5, length(d)); vec3 tint = mix(vec3(1.0, 0.82, 0.55), vec3(0.55, 0.8, 1.0), fi / 5.0); fl += tint * g * (0.06 / fi); } vec2 hd = (vUv - uSun) * asp; float hl = length(hd); float halo = smoothstep(0.36, 0.31, hl) * smoothstep(0.25, 0.3, hl); fl += vec3(0.95, 0.7, 0.5) * halo * 0.04; float streak = exp(-abs(hd.y) * 160.0) * exp(-abs(hd.x) * 5.5); fl += uSunCol * streak * 0.22; c += fl * occ; } }",
      "  vec2 fd = sd * vec2(1.0, 0.62); c += uSunCol * exp(-dot(fd, fd) * 700.0) * 0.55 * uSunVis * clamp(rays.r * 3.0, 0.0, 1.0);",
      "  if (uUnder > 0.0) { float wob = sin(vUv.y * 40.0 + uTime * 2.0) * 0.004 * uUnder; c = mix(c, texture2D(tCol, vUv + vec2(wob, 0.0)).rgb, 0.5 * uUnder); c = mix(c, c * vec3(0.35, 0.7, 0.8) + vec3(0.0, 0.05, 0.08), uUnder); c = mix(c, vec3(0.05, 0.25, 0.3), uUnder * (1.0 - exp(-lin0 * 0.02))); }",
      "  if (gfxBad(c)) c = vec3(0.0); c = tonemap(min(c, vec3(6.0e4)) * uExposure * 1.05);",
      "  c = gfxGrade(c, isSky);",
      "  c *= mix(0.8, 1.0, smoothstep(1.3, 0.4, length((vUv - 0.5) * vec2(1.25, 1.0)))); c = max(c, 0.0);",
      "  vec3 s = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));",
      "  if (uLutK > 0.0) { vec3 q = clamp(s, 0.0, 1.0) * (31.0 / 32.0) + 0.5 / 32.0; s = mix(s, mix(texture(tLutA, q).rgb, texture(tLutB, q).rgb, uLutT), uLutK); }",
      "  s += (p16Ign(gl_FragCoord.xy + fract(uTime * 7.0) * 64.0) - 0.5) * uDither / 255.0;",
      "  gl_FragColor = vec4(s, 1.0); }"
    ].join("\n");
  }

  // ═════════════════════════ time-of-day LUTs (32^3, display space) ═════════════════════════
  // Look-dev against Douglas, AZ high desert in October (1,200 m, dry air): a deep clean blue sky, warm caliche and adobe, olive
  // creosote and mesquite, blue-violet distance; golden hour warm keys over cool blue shadows. The analytic grade (plan_gfx) keeps
  // white balance, contrast and the night pivot (R15); the LUT adds what curves cannot: hue-selective saturation, a filmic S on
  // the display values and split toning. Night is the identity (R15's night look is untouched).
  var LOOKS = {
    noon: { con: 0.10, sat: 0.98, sky: 1.06, warm: 1.05, green: 0.95, gHue: 0.008, sh: [0.995, 1.0, 1.012], hi: [1.008, 1.0, 0.99], toe: 0.010 },
    day: { con: 0.12, sat: 1.0, sky: 1.08, warm: 1.07, green: 0.96, gHue: 0.009, sh: [0.99, 1.0, 1.018], hi: [1.01, 1.0, 0.985], toe: 0.012 },
    golden: { con: 0.15, sat: 1.04, sky: 1.03, warm: 1.12, green: 0.95, gHue: 0.012, sh: [0.965, 0.995, 1.05], hi: [1.035, 1.0, 0.95], toe: 0.014 },
    blue: { con: 0.07, sat: 0.98, sky: 1.02, warm: 1.02, green: 0.95, gHue: 0.006, sh: [0.985, 0.995, 1.03], hi: [1.0, 1.0, 1.0], toe: 0.006 },
    night: { con: 0, sat: 1, sky: 1, warm: 1, green: 1, gHue: 0, sh: [1, 1, 1], hi: [1, 1, 1], toe: 0 },
    storm: { con: 0.06, sat: 0.92, sky: 0.95, warm: 0.98, green: 0.95, gHue: 0.004, sh: [0.99, 1.0, 1.02], hi: [1.0, 1.0, 1.0], toe: 0.004 }
  };
  var LUT_ORDER = ["noon", "day", "golden", "blue", "night", "storm"];
  function hueW(h, c, w) { var d = Math.abs(h - c); if (d > 0.5) d = 1 - d; return d >= w ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d / w); }
  function buildLut(L) {
    var N = 32, data = new Uint8Array(N * N * N * 4), p = 0;
    for (var b = 0; b < N; b++) for (var g = 0; g < N; g++) for (var r = 0; r < N; r++) {
      var c = [r / (N - 1), g / (N - 1), b / (N - 1)];
      // filmic S around the mid tones (fixed ends), a lifted toe
      for (var k = 0; k < 3; k++) { var x = c[k]; var s = x * x * (3 - 2 * x); c[k] = x + (s - x) * L.con; c[k] = c[k] + L.toe * (1 - c[k]) * (1 - sstep(0, 0.25, c[k])); }
      var l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      // split tone: shadows toward L.sh, highlights toward L.hi (weights on display luminance)
      var wh = sstep(0.25, 0.85, l), wsh = 1 - sstep(0.05, 0.5, l);
      for (k = 0; k < 3; k++) c[k] *= mix(1, L.sh[k], wsh) * mix(1, L.hi[k], wh);
      // hue-selective saturation (HSV hue): sky blues, warm earth (sand, adobe, rust), greens toward olive
      var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), dl = mx - mn, h = 0;
      if (dl > 1e-5) { if (mx === c[0]) h = ((c[1] - c[2]) / dl) / 6; else if (mx === c[1]) h = ((c[2] - c[0]) / dl + 2) / 6; else h = ((c[0] - c[1]) / dl + 4) / 6; if (h < 0) h += 1; }
      var chroma = dl / Math.max(mx, 1e-5);
      var wSky = hueW(h, 0.575, 0.09), wWarm = hueW(h, 0.075, 0.07), wGreen = hueW(h, 0.25, 0.11);
      var sat = L.sat * mix(1, L.sky, wSky) * mix(1, L.warm, wWarm) * mix(1, L.green, wGreen);
      sat = mix(1, sat, sstep(0.02, 0.15, chroma));
      l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      for (k = 0; k < 3; k++) c[k] = l + (c[k] - l) * sat;
      if (wGreen > 0 && L.gHue) { c[0] += L.gHue * wGreen * chroma; c[2] -= L.gHue * 0.5 * wGreen * chroma; }
      data[p++] = Math.round(clamp(c[0], 0, 1) * 255); data[p++] = Math.round(clamp(c[1], 0, 1) * 255); data[p++] = Math.round(clamp(c[2], 0, 1) * 255); data[p++] = 255;
    }
    var t = new THREE.Data3DTexture(data, N, N, N); t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; return t;
  }
  // the keyframe pair for the moment (same elevations as plan_gfx's grade keyframes)
  function lutPair(el, S) {
    var a, b, t;
    if (el > 0.55) { a = "noon"; b = "noon"; t = 0; } else if (el > 0.22) { a = "day"; b = "noon"; t = sstep(0.22, 0.55, el); } else if (el > -0.02) { a = "golden"; b = "day"; t = sstep(-0.02, 0.22, el); }
    else if (el > -0.2) { a = "blue"; b = "golden"; t = sstep(-0.2, -0.02, el); } else { a = "night"; b = "blue"; t = sstep(-0.42, -0.2, el); }
    if (S > 0.25) { b = "storm"; a = t > 0.5 ? b : a; t = sstep(0.25, 0.7, S); }
    return [a, b, t];
  }

  // ═════════════════════════ state ═════════════════════════
  var ST = { built: false, building: false, failed: false, w: 0, h: 0, frame: 0, ping: 0, reset: true, hasPrev: false, gen: 0, luts: {}, lutQ: LUT_ORDER.slice(), bm: 0 };
  var M = {}; var T = { taa: [null, null], ao: [null, null], comp: null, bd: [], bu: [] };
  var V = { vp: null, pvp: null, rot: null, pos: null, ppos: null, fwd: null, pfwd: null, sunV: null };
  var TR = { sel: [], pool: [], m4: null, m4b: null, v: null, v2: null, q: null, box: null };
  PP.st = ST; PP.T = T; PP.M = M;

  function mkRT(w, h, lin) { return new THREE.WebGLRenderTarget(w, h, { minFilter: lin ? THREE.LinearFilter : THREE.NearestFilter, magFilter: lin ? THREE.LinearFilter : THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false, stencilBuffer: false }); }
  function tierIdx() { try { return QUAL.level === "ultra" ? 0 : 1; } catch (e) { return 1; } }
  function wanted() {
    if (!PP.enabled || ST.failed) return false;
    try {
      if (typeof POST === "undefined" || !POST.rt || !POST.on || !POST.mFinal) return false;
      if (typeof VRX !== "undefined" && VRX.on) return false;
      if (document.body.classList.contains("photo")) return false;
      var G = window.PLAN_GFX; if (!G || !G.installed || !G.post || !G.post.fin || !G.glsl || G.tier < 2) return false;
      if (QUAL.level !== "high" && QUAL.level !== "ultra") return false;
    } catch (e) { return false; }
    return true;
  }

  // ═════════════════════════ build (materials, programs) ═════════════════════════
  function sharedUniforms(extra) {
    var U = {}, F = POST.mFinal.uniforms;
    for (var k in F) if (Object.prototype.hasOwnProperty.call(F, k)) U[k] = F[k];   // the same value holders: plan_gfx and the client keep driving them
    U.tCol = { value: null }; U.tDepth = { value: null }; U.tBloom = { value: null }; U.tRays = { value: null }; U.tAO = { value: null }; U.uPx = { value: new THREE.Vector2(1, 1) };
    for (var e in extra) U[e] = extra[e]; return U;
  }
  function v4a() { var a = []; for (var i = 0; i < 8; i++) a.push(new THREE.Vector4()); return a; }
  function m4a() { var a = []; for (var i = 0; i < 8; i++) a.push(new THREE.Matrix4()); return a; }
  function build() {
    var G = PLAN_GFX.glsl; var near = camera.near, far = camera.far;
    var sm = function (fs, uni, name) { var m = new THREE.ShaderMaterial({ uniforms: uni, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false }); m.name = "post16_" + name; return m; };
    M.taa = sm(TAA_FS, { tCur: { value: null }, tHist: { value: null }, tDepth: { value: null }, uPx: { value: new THREE.Vector2() }, uSize: { value: new THREE.Vector2() }, uJit: { value: new THREE.Vector2() }, uNear: { value: near }, uFar: { value: far }, uTan: { value: new THREE.Vector2(1, 1) },
      uCamRot: { value: new THREE.Matrix3() }, uCamPos: { value: new THREE.Vector3() }, uPrevVP: { value: new THREE.Matrix4() }, uReset: { value: 1 }, uTaaK: { value: new THREE.Vector4() }, uTaaK2: { value: new THREE.Vector4() }, uTaaK3: { value: new THREE.Vector2() },
      uObjN: { value: 0 }, uObjInv: { value: m4a() }, uObjPrev: { value: m4a() }, uObjMin: { value: v4a() }, uObjMax: { value: v4a() } }, "taa");
    M.ao = sm(GTAO_FS, { tDepth: { value: null }, tHist: { value: null }, uFullPx: { value: new THREE.Vector2() }, uHalfSize: { value: new THREE.Vector2() }, uNear: { value: near }, uFar: { value: far }, uTan: { value: new THREE.Vector2(1, 1) },
      uCamRot: { value: new THREE.Matrix3() }, uCamPos: { value: new THREE.Vector3() }, uPrevVP: { value: new THREE.Matrix4() }, uReset: { value: 1 }, uAoP: { value: new THREE.Vector4() }, uAoP2: { value: new THREE.Vector4() }, uCs: { value: new THREE.Vector4() } }, "gtao");
    M.bd = sm(BDOWN_FS, { tSrc: { value: null }, uSrcPx: { value: new THREE.Vector2() }, uFirst: { value: 0 } }, "bdown");
    M.bu = sm(BUP_FS, { tLow: { value: null }, tCur: { value: null }, uLowPx: { value: new THREE.Vector2() }, uScatter: { value: 0.7 } }, "bup");
    M.comp = sm(compFS(G), sharedUniforms({ tAO2: { value: null }, uAoSize: { value: new THREE.Vector2(1, 1) }, uAoK4: { value: new THREE.Vector4() }, uAoAlb: { value: 0.42 }, uCsK: { value: new THREE.Vector2() }, uSunW: { value: new THREE.Vector3(0, 1, 0) }, uSunL: { value: new THREE.Color(0, 0, 0) }, uAtm: { value: new THREE.Vector4() }, uAtm2: { value: new THREE.Vector4() }, uAtmOn: { value: 1 } }), "comp");
    var id = lutFor("night");
    M.fin = sm(finFS(G), sharedUniforms({ tLutA: { value: id }, tLutB: { value: id }, uLutT: { value: 0 }, uLutK: { value: 0 }, uTM: { value: PP.tm }, uCasK: { value: 0 }, uBloomPB: { value: 0 }, uBloomAdd: { value: 0 }, uDither: { value: 1 } }), "final");
    ST.gfxGen = PLAN_GFX.post; ST.built = true; PP.n.built++;
    // the other keyframe LUTs: one per task (each is about 30 ms of script), behind the loading screen
    var step = function () { if (!ST.lutQ.length) return; try { lutFor(ST.lutQ.shift()); } catch (e) { note("lut", e); } setTimeout(step, 30); }; setTimeout(step, 30);
  }
  function lutFor(name) { if (!ST.luts[name]) ST.luts[name] = buildLut(LOOKS[name]); return ST.luts[name]; }
  // programs are compiled in parallel (KHR_parallel_shader_compile) behind the loading screen; the pipeline starts once they link
  function compileAll() {
    if (ST.building) return; ST.building = true; var R = renderer, prt = R.getRenderTarget();
    var mk = function (list) { var s = new THREE.Scene(); list.forEach(function (m) { var q = new THREE.Mesh(POST.quad.geometry, m); q.frustumCulled = false; s.add(q); }); return s; };
    var tmp = mkRT(4, 4, true); var cw = window.PLAN_PERF && PLAN_PERF.cw; var ps = [];
    try {
      if (cw) cw.mine++;
      R.setRenderTarget(tmp); ps.push(R.compileAsync ? R.compileAsync(mk([M.taa, M.ao, M.bd, M.bu, M.comp]), POST.qcam) : Promise.resolve(R.compile(mk([M.taa, M.ao, M.bd, M.bu, M.comp]), POST.qcam)));
      R.setRenderTarget(null); ps.push(R.compileAsync ? R.compileAsync(mk([M.fin]), POST.qcam) : Promise.resolve(R.compile(mk([M.fin]), POST.qcam)));
    } catch (e) { note("compile", e); ST.failed = true; } finally { if (cw) cw.mine--; R.setRenderTarget(prt); }
    var done = function () { tmp.dispose(); var bad = linkCheck([M.taa, M.ao, M.bd, M.bu, M.comp, M.fin]); if (bad.length) { bad.forEach(function (b) { note("link", b); }); ST.failed = true; return; } ST.warm = [[M.ao, 0], [M.comp, 0], [M.taa, 0], [M.bd, 0], [M.bu, 0], [M.fin, 1]]; ST.linkedAt = performance.now(); };
    Promise.all(ps).then(done).catch(function (e) { note("compile wait", e); done(); });
  }

  // three's own checks are off in production (?shadercheck=0, BUILD != dev): a program that failed would draw nothing, so the
  // pipeline only starts when every one of its programs linked (otherwise the client's pipeline keeps drawing)
  function linkCheck(mats) {
    var gl = renderer.getContext(), bad = [];
    mats.forEach(function (m) { try { var pr = renderer.properties.get(m).currentProgram; if (!pr || !pr.program) { bad.push(m.name + ": no program"); return; }
      if (!gl.getProgramParameter(pr.program, gl.LINK_STATUS)) { var lg = (gl.getProgramInfoLog(pr.program) || "") + " " + (pr.fragmentShader ? gl.getShaderInfoLog(pr.fragmentShader) || "" : ""); bad.push(m.name + ": " + lg.slice(0, 600)); } } catch (e) { bad.push(m.name + ": " + e.message); } });
    return bad;
  }
  // one first draw per frame into a 4 px target of the pass's own format (the canvas for the final pass), before the pipeline starts
  function warmStep() {
    var R = renderer, it = ST.warm.shift(); if (!it) { ST.warm = null; ST.ready = PP.ready = true; ST.readyAt = performance.now(); return; }
    if (!ST.warmRT) ST.warmRT = mkRT(4, 4, true); var prt = R.getRenderTarget(), vp = new THREE.Vector4(), sc = new THREE.Vector4(), st = R.getScissorTest(); R.getViewport(vp); R.getScissor(sc);
    try { POST.quad.material = it[0]; if (it[1]) { R.setRenderTarget(null); R.setViewport(0, 0, 4, 4); R.setScissor(0, 0, 4, 4); R.setScissorTest(true); } else R.setRenderTarget(ST.warmRT); R.render(POST.qscene, POST.qcam); }
    catch (e) { note("warm", e); }
    finally { if (it[1]) { R.setViewport(vp); R.setScissor(sc); R.setScissorTest(st); } R.setRenderTarget(prt); }
    if (!ST.warm.length) { ST.warm = null; ST.warmRT.dispose(); ST.warmRT = null; ST.ready = PP.ready = true; ST.readyAt = performance.now(); }
  }
  // ═════════════════════════ targets ═════════════════════════
  function freeTargets() { [T.taa[0], T.taa[1], T.ao[0], T.ao[1], T.comp].concat(T.bd, T.bu).forEach(function (t) { if (t) t.dispose(); }); T.taa = [null, null]; T.ao = [null, null]; T.comp = null; T.bd = []; T.bu = []; }
  function ensureTargets(w, h) {
    var nb = PP.K.bMips[tierIdx()] || 5;
    if (w === ST.w && h === ST.h && T.comp && T.bd.length === nb) return;
    freeTargets(); ST.w = w; ST.h = h;
    T.taa = [mkRT(w, h, true), mkRT(w, h, true)]; T.comp = mkRT(w, h, true);
    var hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1); T.ao = [mkRT(hw, hh, true), mkRT(hw, hh, true)];
    for (var i = 0; i < nb; i++) { var bw = Math.max(1, w >> (i + 1)), bh = Math.max(1, h >> (i + 1)); T.bd.push(mkRT(bw, bh, true)); if (i < nb - 1) T.bu.push(mkRT(bw, bh, true)); }
    ST.reset = true;
  }
  // the client's SMAA targets (three full-res 8-bit buffers) are not used while the TAA runs: dropped, rebuilt when it stops
  function smaaTargets(want) {
    try { if (!want && POST.ldr) { ["ldr", "sEdges", "sWeights"].forEach(function (k) { if (POST[k]) { POST[k].dispose(); POST[k] = null; } }); ST.smaaFreed = true; }
      else if (want && !POST.ldr && POST.resizeSmaa) { POST.resizeSmaa(); ST.smaaFreed = false; } } catch (e) { note("smaa targets", e); }
  }

  // ═════════════════════════ movers (TAA): the nearest moving top-level objects and their rigid motion ═════════════════════════
  function trackInit() { if (TR.m4) return; TR.m4 = new THREE.Matrix4(); TR.m4b = new THREE.Matrix4(); TR.v = new THREE.Vector3(); TR.v2 = new THREE.Vector3(); TR.q = new THREE.Quaternion(); TR.box = new THREE.Box3(); for (var i = 0; i < 16; i++) TR.pool.push({ o: null, d2: 0, p: new Float64Array(10) }); }
  var REG = new Set();
  PP.mover = function (o, on) { if (!o || !o.isObject3D) return REG.size; if (on === false) REG.delete(o); else REG.add(o); return REG.size; };
  function trackPre() {
    trackInit(); try { if (FLY.on && FLY.g && FLY.g.isObject3D) REG.add(FLY.g); } catch (e) {}   // the flight cabin moves with the camera
    REG.forEach(function (o) { if (!o.parent) { REG.delete(o); return; } var w = o.__p16w || (o.__p16w = new Float64Array(16)); w.set(o.matrixWorld.elements); }); var sel = TR.sel; sel.length = 0; var ch = scene.children, cp = camera.position, R2 = PP.K.trackR * PP.K.trackR, max = PP.K.trackMax, pi = 0;
    for (var i = 0; i < ch.length; i++) {
      var o = ch[i]; if (o.isLight || o.isCamera) continue; var p = o.position, q = o.quaternion, s = o.scale, st = o.__p16;
      if (!st) { st = o.__p16 = new Float64Array(10); st[0] = p.x; st[1] = p.y; st[2] = p.z; st[3] = q.x; st[4] = q.y; st[5] = q.z; st[6] = q.w; st[7] = s.x; st[8] = s.y; st[9] = s.z; continue; }
      if (st[0] === p.x && st[1] === p.y && st[2] === p.z && st[3] === q.x && st[4] === q.y && st[5] === q.z && st[6] === q.w && st[7] === s.x && st[8] === s.y && st[9] === s.z) continue;
      if (o.visible && !o.isInstancedMesh && (o.isMesh || o.children.length > 0)) {
        var dx = p.x - cp.x, dy = p.y - cp.y, dz = p.z - cp.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < R2 && (sel.length < max || (sel.length > 0 && d2 < sel[sel.length - 1].d2))) {
          var slot = sel.length < max ? TR.pool[pi++] : sel.pop(); slot.o = o; slot.d2 = d2; slot.p.set(st);
          var j = sel.length; sel.push(slot); while (j > 0 && sel[j - 1].d2 > d2) { sel[j] = sel[j - 1]; sel[j - 1] = slot; j--; }
        }
      }
      st[0] = p.x; st[1] = p.y; st[2] = p.z; st[3] = q.x; st[4] = q.y; st[5] = q.z; st[6] = q.w; st[7] = s.x; st[8] = s.y; st[9] = s.z;
    }
  }
  // the mover's box in its own frame, from its meshes' bounding spheres (cheap and conservative), cached for 2 s
  function localBox(o, now) {
    var c = o.__p16b; if (c && now - c.t < 2000 && c.n === o.children.length) return c;
    var inv = TR.m4b.copy(o.matrixWorld).invert(), box = TR.box.makeEmpty(), v = TR.v, n = 0;
    o.traverseVisible(function (m) { if (!(m.isMesh || m.isPoints) || m.isInstancedMesh || !m.geometry) return; var g = m.geometry; var bs = g.boundingSphere; if (!bs) { try { g.computeBoundingSphere(); bs = g.boundingSphere; } catch (e) { return; } } if (!bs || !(bs.radius > 0)) return;
      TR.m4.multiplyMatrices(inv, m.matrixWorld); v.copy(bs.center).applyMatrix4(TR.m4); var r = bs.radius * TR.m4.getMaxScaleOnAxis(); if (!(r < 60)) return; box.expandByPoint(TR.v2.set(v.x - r, v.y - r, v.z - r)); box.expandByPoint(TR.v2.set(v.x + r, v.y + r, v.z + r)); n++; });
    c = o.__p16b = { t: now, n: o.children.length, ok: n > 0 && !box.isEmpty(), mn: box.min.clone(), mx: box.max.clone() };
    if (c.ok) { var sz = TR.v.subVectors(c.mx, c.mn); if (sz.x > 40 || sz.y > 40 || sz.z > 40) c.ok = false; var mg = TR.v2.copy(sz).multiplyScalar(0.04).addScalar(0.04); c.mn.sub(mg); c.mx.add(mg); }
    return c;
  }
  function trackPost(U, now) {
    var sel = TR.sel, n = 0;
    if (REG.size) { var cp = camera.position, R2 = PP.K.trackR * PP.K.trackR, add = 0;
      REG.forEach(function (o) { var w = o.__p16w; if (!w || !o.visible || o.parent === scene) return; var e = o.matrixWorld.elements, mv = false; for (var i = 0; i < 16; i++) if (e[i] !== w[i]) { mv = true; break; } if (!mv) return;
        var dx = e[12] - cp.x, dy = e[13] - cp.y, dz = e[14] - cp.z, d2 = dx * dx + dy * dy + dz * dz; if (d2 < R2) { sel.push({ o: o, d2: d2, w: w }); add++; } });
      if (add) sel.sort(function (a, b) { return a.d2 - b.d2; }); }
    for (var i = 0; i < sel.length && n < 8; i++) { var o = sel[i].o, p = sel[i].p; var b = localBox(o, now); if (!b.ok) continue;
      U.uObjInv.value[n].copy(o.matrixWorld).invert(); if (sel[i].w) U.uObjPrev.value[n].fromArray(sel[i].w); else { TR.q.set(p[3], p[4], p[5], p[6]); U.uObjPrev.value[n].compose(TR.v.set(p[0], p[1], p[2]), TR.q, TR.v2.set(p[7], p[8], p[9])); }
      U.uObjMin.value[n].set(b.mn.x, b.mn.y, b.mn.z, 0); U.uObjMax.value[n].set(b.mx.x, b.mx.y, b.mx.z, 0); n++; }
    U.uObjN.value = n; PP.n.objs = n; if (n > PP.n.objMax) PP.n.objMax = n;
  }

  // ═════════════════════════ the frame ═════════════════════════
  function pass(mat, target) { POST.quad.material = mat; renderer.setRenderTarget(target); renderer.render(POST.qscene, POST.qcam); }
  function sunWorld(out) {
    try { if (CSMX.on && CSMX.csm) { out.copy(CSMX.csm.lightDirection).negate().normalize(); return out; } } catch (e) {}
    try { out.copy(sun.position).sub(sun.target.position).normalize(); return out; } catch (e) {} return out.set(0, 1, 0);
  }
  function frameMine() {
    var R = renderer, w = R.domElement.width, h = R.domElement.height, K = PP.K, sw = PP.sw, ti = tierIdx(), now = performance.now();
    if (!V.vp) { V.vp = new THREE.Matrix4(); V.pvp = new THREE.Matrix4(); V.rot = new THREE.Matrix3(); V.pos = new THREE.Vector3(); V.ppos = new THREE.Vector3(); V.fwd = new THREE.Vector3(); V.pfwd = new THREE.Vector3(); V.sunV = new THREE.Vector3(); V.sunW = new THREE.Vector3(); V.m3 = new THREE.Matrix3(); }
    ensureTargets(w, h);
    var taa = sw.taa; if (taa !== ST.taaWas) { smaaTargets(!taa); if (taa) ST.reset = true; ST.taaWas = taa; } else if (taa && POST.ldr) smaaTargets(false);   // the client's resize rebuilds them
    if (QUAL.q.refl > 0 && (FRAME_N % QUAL.q.refl) === 0 && !FLY.on) renderReflection();
    var tj = performance.now(); if (taa) trackPre(); else TR.sel.length = 0; PP.n.trackMs = mix(PP.n.trackMs || 0, performance.now() - tj, 0.05);
    // sub-pixel jitter (Halton 2,3): the content moves by (jx, jy) pixels
    var jx = 0, jy = 0, pm = camera.projectionMatrix.elements, p8 = pm[8], p9 = pm[9];
    if (taa) { var k = (ST.frame % Math.max(1, K.taaN)) + 1; jx = halton(k, 2) - 0.5; jy = halton(k, 3) - 0.5; ST.jx = jx; ST.jy = jy; pm[8] = p8 - 2 * jx / w; pm[9] = p9 - 2 * jy / h; camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert(); }
    R.setRenderTarget(POST.rt); var ts = performance.now();
    try { R.render(scene, camera); } finally { if (taa) { pm[8] = p8; pm[9] = p9; camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert(); } }
    var tp = performance.now(); PP.n.sceneMs = mix(PP.n.sceneMs || 0, tp - ts, 0.05);
    if (!POST.black) { POST.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); POST.black.needsUpdate = true; POST.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); POST.white.needsUpdate = true; }
    // this frame's camera (unjittered) and a cut test (fast travel, a snap): the history is dropped
    camera.updateMatrixWorld(); V.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); V.rot.setFromMatrix4(camera.matrixWorld); V.pos.setFromMatrixPosition(camera.matrixWorld); camera.getWorldDirection(V.fwd);
    if (ST.hasPrev && (V.pos.distanceTo(V.ppos) > 14 || V.fwd.dot(V.pfwd) < 0.82)) ST.reset = true;
    if (!ST.hasPrev) { V.pvp.copy(V.vp); ST.reset = true; }
    if (ST.reset) PP.n.resets++;
    var tv = Math.tan(camera.fov * Math.PI / 360), tanX = tv * camera.aspect, ping = ST.ping, pong = 1 - ping, depth = POST.rt.depthTexture;
    // GTAO + contact shadows (half res)
    var aoOn = sw.gtao && QUAL.q.ao;
    if (aoOn) { var A = M.ao.uniforms; A.tDepth.value = depth; A.tHist.value = T.ao[pong].texture; A.uFullPx.value.set(1 / w, 1 / h); A.uHalfSize.value.set(T.ao[ping].width, T.ao[ping].height); A.uNear.value = camera.near; A.uFar.value = camera.far; A.uTan.value.set(tanX, tv);
      A.uCamRot.value.copy(V.rot); A.uCamPos.value.copy(V.pos); A.uPrevVP.value.copy(V.pvp); A.uReset.value = ST.reset ? 1 : 0;
      A.uAoP.value.set(K.aoR, K.aoS[ti], K.aoN[ti], ST.frame % 64); A.uAoP2.value.set(K.aoMaxPx * (T.ao[ping].height / 540), K.aoFall, K.aoT, K.aoFar);
      var csOn = sw.cs && ti === 0 && GSUN().el > 0.02; if (csOn) { sunWorld(V.sunW); V.m3.setFromMatrix4(camera.matrixWorldInverse); V.sunV.copy(V.sunW).applyMatrix3(V.m3).normalize(); A.uCs.value.set(V.sunV.x, V.sunV.y, V.sunV.z, K.csLen); } else A.uCs.value.set(0, 1, 0, 0);
      pass(M.ao, T.ao[ping]); }
    // scene composite
    var C = M.comp.uniforms, gs = GSUN();
    C.tCol.value = POST.rt.texture; C.tDepth.value = depth; C.uPx.value.set(1 / w, 1 / h); C.tAO2.value = aoOn ? T.ao[ping].texture : null; C.uAoSize.value.set(T.ao[ping].width, T.ao[ping].height);
    C.uAoK4.value.set(aoOn ? K.aoK : 0, K.aoLit, K.aoL0, K.aoL1); C.uAoAlb.value = K.aoAlb; C.uCsK.value.set(aoOn && sw.cs && ti === 0 ? K.csK : 0, sstep(0.02, 0.15, gs.el) * (1 - (PLAN_GFX.storm ? PLAN_GFX.storm.k : 0)));
    sunWorld(C.uSunW.value); var sunUp = sstep(-0.04, 0.12, gs.el); C.uSunL.value.copy(POST.sunCol).multiplyScalar(sunUp);
    var gy = C.uFog.value.z + 8; C.uAtm.value.set(K.atR, K.atM, K.atH, gy); C.uAtm2.value.set(K.atG, K.atSun, K.atAmb, 0); C.uAtmOn.value = sw.atmo ? 1 : 0;
    pass(M.comp, T.comp);
    // TAA
    var col = T.comp.texture;
    if (taa) { var U = M.taa.uniforms; U.tCur.value = T.comp.texture; U.tHist.value = T.taa[pong].texture; U.tDepth.value = depth; U.uPx.value.set(1 / w, 1 / h); U.uSize.value.set(w, h); U.uJit.value.set(jx, jy); U.uNear.value = camera.near; U.uFar.value = camera.far; U.uTan.value.set(tanX, tv);
      U.uCamRot.value.copy(V.rot); U.uCamPos.value.copy(V.pos); U.uPrevVP.value.copy(V.pvp); U.uReset.value = ST.reset ? 1 : 0;
      U.uTaaK.value.set(K.taaA, K.taaAMove, K.taaG, K.taaGDyn); U.uTaaK2.value.set(K.taaFilt, K.taaADyn, K.taaADis, K.taaVel); trackPost(U, now);
      pass(M.taa, T.taa[ping]); col = T.taa[ping].texture; }
    // god rays (the client's pass, on the resolved image)
    var Ry = POST.mRays.uniforms; Ry.tCol.value = col; Ry.tDepth.value = depth; Ry.uStrength.value = POST.sunVis * 0.9; if (QUAL.q.rays) pass(POST.mRays, POST.rays);
    // bloom
    var bloomTex = POST.black, pb = 0;
    if (QUAL.q.bloom) {
      if (sw.bloom) { var nb = T.bd.length, src = col, sw0 = w, sh0 = h, D = M.bd.uniforms;
        for (var i = 0; i < nb; i++) { D.tSrc.value = src; D.uSrcPx.value.set(1 / sw0, 1 / sh0); D.uFirst.value = i === 0 ? 1 : 0; pass(M.bd, T.bd[i]); src = T.bd[i].texture; sw0 = T.bd[i].width; sh0 = T.bd[i].height; }
        var Up = M.bu.uniforms; Up.uScatter.value = K.bScatter; var low = T.bd[nb - 1];
        for (var u = nb - 2; u >= 0; u--) { Up.tLow.value = low.texture; Up.tCur.value = T.bd[u].texture; Up.uLowPx.value.set(1 / low.width, 1 / low.height); pass(M.bu, T.bu[u]); low = T.bu[u]; }
        bloomTex = T.bu.length ? T.bu[0].texture : T.bd[0].texture; pb = K.bK; }
      else { POST.mBright.uniforms.tCol.value = col; pass(POST.mBright, POST.bA); POST.mBlur.uniforms.tCol.value = POST.bA.texture; POST.mBlur.uniforms.uDir.value.set(1, 0); pass(POST.mBlur, POST.bB); POST.mBlur.uniforms.tCol.value = POST.bB.texture; POST.mBlur.uniforms.uDir.value.set(0, 1); pass(POST.mBlur, POST.bA); bloomTex = POST.bA.texture; pb = -1; }
    }
    // final
    var F = M.fin.uniforms; F.tCol.value = col; F.tDepth.value = depth; F.uPx.value.set(1 / w, 1 / h); F.tRays.value = QUAL.q.rays ? POST.rays.texture : POST.black; F.tBloom.value = bloomTex;
    F.uBloomPB.value = pb >= 0 ? pb : 0; F.uBloomAdd.value = pb < 0 ? 0.3 : 0; F.uSunVis.value = POST.sunVis; F.uNight.value = night; F.uTime.value = now / 1000; F.uExposure.value = POST.exposure; F.uHeat.value = POST.heat || 0;
    F.uUnder.value = (typeof WATER !== "undefined" && WATER && camera.position.y < LAKE.level && waterDepthAt(camera.position.x, camera.position.z) > 0) ? 1 : 0;
    F.uTM.value = PP.tm; F.uCasK.value = sw.cas && taa ? K.cas : 0; F.uDither.value = K.dither;
    var lp = lutPair(gs.el, PLAN_GFX.storm ? PLAN_GFX.storm.k : 0); if (sw.lut && ST.luts[lp[0]] && ST.luts[lp[1]]) { F.tLutA.value = ST.luts[lp[0]]; F.tLutB.value = ST.luts[lp[1]]; F.uLutT.value = lp[2]; F.uLutK.value = K.lutK; } else F.uLutK.value = 0;
    var smaa = !taa && POST.smaa && QUAL.q.smaa && POST.ldr;
    if (!smaa) pass(M.fin, null);
    else { pass(M.fin, POST.ldr); var S = POST.smaa; S.edges.uniforms.tDiffuse.value = POST.ldr.texture; pass(S.edges, POST.sEdges); S.weights.uniforms.tDiffuse.value = POST.sEdges.texture; pass(S.weights, POST.sWeights); S.blend.uniforms.tDiffuse.value = POST.sWeights.texture; S.blend.uniforms.tColor.value = POST.ldr.texture; pass(S.blend, null); }
    // next frame
    PP.n.postMs = mix(PP.n.postMs || 0, performance.now() - tp, 0.05);   // JS of the passes after the scene (submission only)
    V.pvp.copy(V.vp); V.ppos.copy(V.pos); V.pfwd.copy(V.fwd); ST.hasPrev = true; ST.reset = false; ST.ping = pong; ST.frame++; PP.n.frames++;
  }
  function GSUN() { var g = window.PLAN_GFX && PLAN_GFX.sun; return g || { el: 0.5 }; }

  // ═════════════════════════ entry points ═════════════════════════
  // called by plan_gfx.js's renderFrame wrapper; true = this module drew the frame
  PP.render = function (rf) {
    if (!wanted()) { if (PP.active) { PP.active = false; smaaTargets(true); ST.taaWas = undefined; ST.hasPrev = false; } return false; }
    if (!ST.built || ST.gfxGen !== PLAN_GFX.post) { try { build(); ST.building = false; ST.ready = PP.ready = false; } catch (e) { note("build", e); ST.failed = true; return false; } }
    if (!ST.ready) { if (ST.warm) warmStep(); else if (!ST.building) compileAll(); return false; }
    try { PP.active = true; frameMine(); return true; }
    catch (e) { note("frame", e); PP.n.fallbacks++; ST.failed = true; PP.active = false; try { smaaTargets(true); } catch (e2) {} return false; }
  };
  PP.jitter = function () { return PP.active && PP.sw.taa ? [ST.jx || 0, ST.jy || 0, ST.frame] : [0, 0, ST.frame]; };
  PP.enable = function (on) { PP.enabled = !!on; ST.hasPrev = false; return PP.enabled; };
  PP.set = function (k, v) { if (k === "tm") { PP.tm = typeof v === "number" ? v : (TMS[v] !== undefined ? TMS[v] : 0); return PP.tm; } if (k in PP.sw) { PP.sw[k] = !!v; ST.reset = true; return PP.sw[k]; } if (k in PP.K) { PP.K[k] = v; return v; } return undefined; };
  PP.state = function () { return { active: PP.active, ready: ST.ready, built: ST.built, failed: ST.failed, frame: ST.frame, size: [ST.w, ST.h], sw: PP.sw, tm: PP.tm, objs: PP.n.objs, luts: Object.keys(ST.luts).length, errs: PP.errs.slice(0, 6), n: PP.n }; };
  PP.dispose = function () { try { freeTargets(); } catch (e) {} for (var k in M) { try { M[k].dispose(); } catch (e) {} } for (var l in ST.luts) { try { ST.luts[l].dispose(); } catch (e) {} } try { smaaTargets(true); } catch (e) {} PP.enabled = false; };
  // build and compile as soon as the client's post and plan_gfx's grade exist (behind the loading screen), so the first frame of
  // the pipeline never waits on a link
  (function (a) { for (var i = a.length - 1; i >= 0; i--) if (a[i] && a[i].name === "post16") a.splice(i, 1); })(window.PLAN_HOOKS.frame);
  window.PLAN_HOOKS.frame.push({ name: "post16", fn: function () { if (ST.ready || ST.building || ST.failed || !wanted()) return; try { if (!ST.built) build(); compileAll(); } catch (e) { note("prebuild", e); ST.failed = true; } } });
})();
