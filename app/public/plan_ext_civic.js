// R16 CIVIC EXTERIORS (Agent M, HANDOFF_R16_BUILDINGS.md): the last ten old generated models rebuilt the R15 way.
//   restaurant (5: Market Hall, Border Books, Main Street Grill, the Launch Complex food hall, the Outpost mess hall),
//   clubhouse (2: The Landing Clubhouse, The Golf Clubhouse), artpav (the gallery pavilion) and flagship (2, the signature stays).
//   Each is built procedurally in its placement frame (the measured numbers of the walk-in interiors in plan_interiors.js and of
//   plan/porches.json: walls, doors, glazing bays, terrace and entry heights, pergola posts), written into plan_ext_town.js's chunk
//   buffers (its texture-array material and program; layers 16+ sample the homes array: ledgestone, cedar, timber, travertine,
//   rusted steel, canvas), so the opaque shells add no program and, where a town chunk already exists, no draw.
//   New here: the tensile membranes (one double-sided material: woven detail, seams, edge soiling, sun shining through the fabric,
//   warm uplight glow at night) and fake interiors behind the glass where no real room is shown (the homes' interior-mapped glass).
//   Walk-in interiors (restaurant, clubhouse, plan_interiors.js INT3): the shell keeps the INT3 wall lines, door opening and
//   glazing (the mullions on INT3's own spacing); while INT3's interior is visible (door open or you inside) this module drops its
//   closed door leaves and fake rooms (the real room shows through clear glass); INT3's porch solids come from this module's terrace,
//   steps and posts (PLAN_INTERIORS.porch, the cache plan_interiors.js reads), so what you walk on is what you see.
//   The old models are hidden (the client's SHELLS) and, for these four kinds, never downloaded (the streamer is told they are full).
//   Switches: ?xc=0 off (the old models, as R15), ?xck=restaurant,artpav limits the kinds; PLAN_EXT_CIVIC.ab(false/true) swaps old and
//   new in a running session (?xcab=1 also streams the old models for that). Classic script, loaded before client.js.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_EXT_CIVIC = window.PLAN_EXT_CIVIC || { v: "r16-0", errs: [], n: {} };
(function () {
  "use strict";
  var XC = window.PLAN_EXT_CIVIC; XC.v = "r16m-1"; XC.errs = XC.errs || []; XC.n = XC.n || {};
  function note(tag, e) { try { if (XC.errs.length < 40) XC.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (XC.errs.length <= 6) console.warn("plan_ext_civic " + tag, e); } catch (x) {} }
  var Q = location.search;
  if (/[?&]xc=0\b/.test(Q)) { XC.off = true; XC.why = "?xc=0"; return; }
  var XT = window.PLAN_EXT_TOWN;
  if (!XT || XT.off || !XT.builders || !XT.kit) { XC.off = true; XC.why = "needs plan_ext_town"; return; }
  var ONLY = (Q.match(/[?&]xck=([a-z_,]+)/) || [])[1]; ONLY = ONLY ? ONLY.split(",") : null;
  var ABMODE = /[?&]xcab=1\b/.test(Q);
  var KIT = XT.kit, Acc = KIT.Acc, hex = KIT.hex, shade = KIT.shade, pick = KIT.pick, LY = KIT.LY, WHITE = KIT.WHITE, windowAt = KIT.windowAt, doorAt = KIT.doorAt, signAt = KIT.signAt, shortName = KIT.shortName;
  var PI = Math.PI;
  var KINDS = ["restaurant", "clubhouse", "artpav", "flagship"].filter(function (k) { return !ONLY || ONLY.indexOf(k) >= 0; });
  XC.kinds = KINDS.slice();
  // a homes-array layer (16+) when that array is bound, else the closest town layer
  function XL(nm, fb) { var U = XT.U; return (U && U.tA2 && LY["x_" + nm] !== undefined) ? LY["x_" + nm] : LY[fb]; }

  // ───────────────────────── extra per-chunk buffers: fake-interior panes and membranes ─────────────────────────
  function growF(a, n) { var b = new a.constructor(n); b.set(a); return b; }
  function tfv(t, x, y, z, nx, ny, nz, P, N, i3) { if (t) { var X = x * t.sc, Z = z * t.sc; P[i3] = t.ox + X * t.c + Z * t.s; P[i3 + 1] = t.oy + y * t.sc; P[i3 + 2] = t.oz - X * t.s + Z * t.c; N[i3] = nx * t.c + nz * t.s; N[i3 + 1] = ny; N[i3 + 2] = -nx * t.s + nz * t.c; } else { P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z; N[i3] = nx; N[i3 + 1] = ny; N[i3 + 2] = nz; } }
  // interior panes for the homes' interior-mapped glass: aXG = pane width, height (m), seed, sill height (pane bottom over the floor)
  function IAcc(cap) { cap = cap || 512; this.cap = cap; this.P = new Float32Array(cap * 3); this.N = new Float32Array(cap * 3); this.T = new Float32Array(cap * 2); this.G = new Float32Array(cap * 4); this.n = 0; this.tf = null; }
  IAcc.prototype.grow = function () { var c = this.cap * 2; this.P = growF(this.P, c * 3); this.N = growF(this.N, c * 3); this.T = growF(this.T, c * 2); this.G = growF(this.G, c * 4); this.cap = c; };
  IAcc.prototype.v = function (x, y, z, nx, ny, nz, u, w, g) { if (this.n >= this.cap) this.grow(); var i = this.n; tfv(this.tf, x, y, z, nx, ny, nz, this.P, this.N, i * 3); this.T[i * 2] = u; this.T[i * 2 + 1] = w; this.G.set(g, i * 4); this.n = i + 1; };
  IAcc.prototype.pane = function (o, t, s0, s1, y0, y1, d, seed, sill) { var n = [-t[2], 0, t[0]], self = this, g = [s1 - s0, y1 - y0, seed, sill];
    function P(s, y) { return [o[0] + t[0] * s - n[0] * d, y, o[2] + t[2] * s - n[2] * d]; } var a = P(s0, y0), b = P(s1, y0), c = P(s1, y1), e = P(s0, y1);
    [[a, 0, 0], [b, 1, 0], [c, 1, 1], [a, 0, 0], [c, 1, 1], [e, 0, 1]].forEach(function (q) { self.v(q[0][0], q[0][1], q[0][2], n[0], n[1], n[2], q[1], q[2], g); }); };
  // membranes: muv = metres across the fabric, aMb = edge distance (m), seam coordinate (m), seed, height factor 0 (low) .. 1 (high)
  function MAcc(cap) { cap = cap || 2048; this.cap = cap; this.P = new Float32Array(cap * 3); this.N = new Float32Array(cap * 3); this.T = new Float32Array(cap * 2); this.M = new Float32Array(cap * 4); this.n = 0; this.tf = null; }
  MAcc.prototype.grow = function () { var c = this.cap * 2; this.P = growF(this.P, c * 3); this.N = growF(this.N, c * 3); this.T = growF(this.T, c * 2); this.M = growF(this.M, c * 4); this.cap = c; };
  MAcc.prototype.v = function (p, nr, u, w, m) { if (this.n >= this.cap) this.grow(); var i = this.n; tfv(this.tf, p[0], p[1], p[2], nr[0], nr[1], nr[2], this.P, this.N, i * 3); this.T[i * 2] = u; this.T[i * 2 + 1] = w; this.M.set(m, i * 4); this.n = i + 1; };
  var CX = XC.cx = {};
  function cx(C) { return CX[C.k] || (CX[C.k] = { ip: new IAcc(256), mb: new MAcc(1024), meshes: null }); }

  // ───────────────────────── materials ─────────────────────────
  var U = XC.U = { uNight: { value: 0 } };
  var MAT = XC.mat = {};
  function memMat() {
    if (MAT.mem) return MAT.mem;
    var m = new THREE.MeshStandardMaterial({ color: 0xf1ede3, roughness: 0.62, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.6 });
    m.name = "xc_membrane"; m.userData.avShared = true;
    m.onBeforeCompile = function (sh) {
      var B = window.PLAN_BMAT, det = B && !B.off && B.U ? B.U.tDet : null; sh.uniforms.uNight = U.uNight; if (det) { sh.uniforms.tDet = det; sh.uniforms.uBm = B.U.uBm; }
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec2 muv; attribute vec4 aMb; varying vec2 vMuv; varying vec4 vMb;").replace("#include <uv_vertex>", "#include <uv_vertex>\nvMuv = muv; vMb = aMb;");
      var FP = "#include <common>\nuniform float uNight; varying vec2 vMuv; varying vec4 vMb; float mbEdge; float mbMac;" + (det ? "\nuniform sampler2D tDet; uniform float uBm;" : "");
      var MF = ["#include <map_fragment>",
        "{ float sd = abs(fract(vMb.y / 1.55 + 0.5) - 0.5) * 1.55; float seam = 1.0 - smoothstep(0.01, 0.028, sd); mbEdge = smoothstep(0.05, 1.3, vMb.x);",
        det ? "  mbMac = texture2D(tDet, vMuv * 0.043 + vMb.z).a;" : "  mbMac = 0.5;",
        "  vec3 c = diffuseColor.rgb * (0.95 + 0.1 * mbMac) * mix(0.8, 1.0, mbEdge) * (1.0 - 0.09 * seam) * mix(0.88, 1.0, smoothstep(0.0, 0.3, vMb.w));",
        "  diffuseColor.rgb = c; }"].join("\n");
      var NF = det ? ["#include <normal_fragment_maps>",
        "{ float f = (1.0 - smoothstep(3.0, 15.0, length(vViewPosition))) * uBm; if (f > 0.002) { vec2 a = vMuv * 6.5; vec2 g1 = dFdx(a), g2 = dFdy(a); float wa = textureGrad(tDet, a.yx, g1.yx, g2.yx).b; float wb = textureGrad(tDet, a, g1, g2).b;",
        "  vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition); vec2 s0 = dFdx(vMuv), s1 = dFdy(vMuv); vec3 Nn = normal; vec3 q1p = cross(q1, Nn), q0p = cross(Nn, q0); vec3 T = q1p * s0.x + q0p * s1.x; vec3 Bv = q1p * s0.y + q0p * s1.y; float dt = max(dot(T, T), dot(Bv, Bv)); float sc = dt == 0.0 ? 0.0 : inversesqrt(dt);",
        "  normal = normalize(Nn + (T * (wb - 0.5) + Bv * (wa - 0.5)) * sc * 0.3 * f); } }"].join("\n") : "#include <normal_fragment_maps>";
      var RF = "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + 0.12 * (mbMac - 0.5) + 0.1 * (1.0 - mbEdge), 0.3, 0.95);";
      var EF = ["#include <emissivemap_fragment>",
        "#if NUM_DIR_LIGHTS > 0",
        "{ float back = clamp(-dot(normal, directionalLights[0].direction), 0.0, 1.0); totalEmissiveRadiance += directionalLights[0].color * diffuseColor.rgb * back * 0.075 * (0.7 + 0.3 * mbEdge); }",
        "#endif",
        "totalEmissiveRadiance += vec3(1.0, 0.74, 0.5) * uNight * (0.06 + 0.3 * (1.0 - vMb.w)) * (faceDirection < 0.0 ? 1.0 : 0.55);"].join("\n");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", FP).replace("#include <map_fragment>", MF).replace("#include <normal_fragment_maps>", NF).replace("#include <roughnessmap_fragment>", RF).replace("#include <emissivemap_fragment>", EF);
    };
    m.customProgramCacheKey = function () { return "xc_membrane_1"; };
    return (MAT.mem = m);
  }
  function paneMat() { var H = window.PLAN_XH; if (H && H.mat && H.mat.glass) return H.mat.glass; return null; }

  // ───────────────────────── small geometry helpers (model frame: x right, y up, z out of the front) ─────────────────────────
  // a box spanning s (along t from o), y and a depth d0..d1 into the wall (the town kit's bar, for walls in any direction)
  function bar(A, o, t, sa, sb, ya, yb, d0, d1, L, F, col) { var n = [-t[2], 0, t[0]], sm = (sa + sb) / 2, dm = (d0 + d1) / 2;
    A.obox([o[0] + t[0] * sm - n[0] * dm, (ya + yb) / 2, o[2] + t[2] * sm - n[2] * dm], [t[0], 0, t[2]], [0, 1, 0], Math.abs(sb - sa) / 2, Math.abs(yb - ya) / 2, Math.abs(d1 - d0) / 2, L, F, col); }
  // a segment as a thin square rod (cables, rafters at an angle)
  function rod(A, a, b, w, L, F, col) { var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz); if (len < 1e-3) return; var ax = [dx / len, dy / len, dz / len]; var up = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    var ay = [up[1] * ax[2] - up[2] * ax[1], up[2] * ax[0] - up[0] * ax[2], up[0] * ax[1] - up[1] * ax[0]]; var l2 = Math.hypot(ay[0], ay[1], ay[2]) || 1; ay = [ay[0] / l2, ay[1] / l2, ay[2] / l2];
    A.obox([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], ax, ay, len / 2, w / 2, w / 2, L, F, col); }
  // a round post from a to b (tapered timber masts, steel columns): seg sides, radii r0 at a, r1 at b
  function pole(A, a, b, r0, r1, seg, L, F, col) { var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz); var ax = [dx / len, dy / len, dz / len]; var up = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    var e1 = [up[1] * ax[2] - up[2] * ax[1], up[2] * ax[0] - up[0] * ax[2], up[0] * ax[1] - up[1] * ax[0]]; var l1 = Math.hypot(e1[0], e1[1], e1[2]); e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1]; var e2 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]];
    for (var i = 0; i < seg; i++) { var a0 = i / seg * PI * 2, a1 = (i + 1) / seg * PI * 2; var c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      var n0 = [e1[0] * c0 + e2[0] * s0, e1[1] * c0 + e2[1] * s0, e1[2] * c0 + e2[2] * s0], n1 = [e1[0] * c1 + e2[0] * s1, e1[1] * c1 + e2[1] * s1, e1[2] * c1 + e2[2] * s1];
      var p0 = [a[0] + n0[0] * r0, a[1] + n0[1] * r0, a[2] + n0[2] * r0], p1 = [a[0] + n1[0] * r0, a[1] + n1[1] * r0, a[2] + n1[2] * r0], p2 = [b[0] + n1[0] * r1, b[1] + n1[1] * r1, b[2] + n1[2] * r1], p3 = [b[0] + n0[0] * r1, b[1] + n0[1] * r1, b[2] + n0[2] * r1];
      var u0 = i / seg * 2 * PI * r0 * 0.5, u1 = (i + 1) / seg * 2 * PI * r0 * 0.5, w1 = len * 0.5;
      [[p0, n0, u0, 0], [p1, n1, u1, 0], [p2, n1, u1, w1], [p0, n0, u0, 0], [p2, n1, u1, w1], [p3, n0, u0, w1]].forEach(function (q) { A.v(q[0][0], q[0][1], q[0][2], q[1][0], q[1][1], q[1][2], q[3], q[2], L, F, col); }); } }
  // a box solid in the building frame (the client's walk collision)
  function solid(K, lx, lz, w, d, y0, y1) { try { var t = K.tf; if (!t || typeof addSolid !== "function") return null; var x = t.ox + (lx * t.c + lz * t.s) * t.sc, z = t.oz + (-lx * t.s + lz * t.c) * t.sc; var sd = addSolid(x, z, K.Y, w * t.sc, d * t.sc, t.oy + y0 * t.sc, t.oy + y1 * t.sc, "xc"); if (sd) { (XC.solids = XC.solids || []).push(sd); } return sd; } catch (e) { note("solid", e); return null; } }
  // a glazed bay on INT3's spacing (n = round(len / sp) lights, slim mullions at the light edges, sill and head bars, a transom at
  // 72 per cent when taller than 3 m): clear town glass, and the interior-mapped pane behind it (one room per bay)
  function bay(K, o, t, s0, s1, y0, y1, sp, st) { st = st || {}; var A = K.a, col = st.col || K.trim, m = st.mw || 0.065, d0 = st.d0 === undefined ? -0.02 : st.d0, d1 = st.d1 === undefined ? 0.1 : st.d1, gi = st.gi === undefined ? 0.06 : st.gi;
    var n = Math.max(1, Math.round((s1 - s0) / sp)), w = (s1 - s0) / n;
    for (var i = 0; i <= n; i++) { var sm = s0 + i * w; bar(A, o, t, sm - m / 2, sm + m / 2, y0, y1, d0, d1, LY.metal, 1, col); }
    bar(A, o, t, s0 - 0.02, s1 + 0.02, y0 - 0.07, y0 + 0.02, d0 - 0.04, d1, LY.metal, 1, col); bar(A, o, t, s0 - 0.02, s1 + 0.02, y1 - 0.02, y1 + 0.06, d0, d1, LY.metal, 1, col);
    var yt = y1 - y0 > 3 ? y0 + (y1 - y0) * 0.72 : null; if (yt) bar(A, o, t, s0, s1, yt - 0.03, yt + 0.03, d0, d1, LY.metal, 1, col);
    var g0 = K.g.n, i0 = K.ip ? K.ip.n : 0, nO = [-t[2], 0, t[0]];
    if (!st.noClear) K.g.pane([o[0] - nO[0] * gi, 0, o[2] - nO[2] * gi], t, s0, s1, y0, y1, st.lit === undefined ? K.r() : st.lit);
    if (K.ip && !st.noRoom) K.ip.pane(o, t, s0 + 0.01, s1 - 0.01, y0 + 0.01, y1 - 0.01, gi + 0.04, K.r(), Math.max(0, y0 - (st.floor || 0)));
    if (K.track) { K.track.clear.push([g0, K.g.n - g0]); if (K.ip) K.track.room.push([i0, K.ip.n - i0]); }
    return { n: n, w: w, yt: yt };
  }
  // a Coons-patch tensile sail: corners p00 p10 p01 p11 (u along p00 -> p10), edges bowed inward (sIn) and down (sDn), nu x nv quads.
  // Written to the membrane buffer, a cable along each edge and a steel plate at each corner into the main buffer.
  function sail(K, MB, p00, p10, p01, p11, opt) {
    opt = opt || {}; var nu = opt.nu || 22, nv = opt.nv || 16, sIn = opt.sIn === undefined ? 1.2 : opt.sIn, sDn = opt.sDn === undefined ? 0.35 : opt.sDn, seed = opt.seed || 0;
    var cen = [(p00[0] + p10[0] + p01[0] + p11[0]) / 4, (p00[1] + p10[1] + p01[1] + p11[1]) / 4, (p00[2] + p10[2] + p01[2] + p11[2]) / 4];
    function edge(a, b, k) { var d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]); var m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; var w = [cen[0] - m[0], cen[1] - m[1], cen[2] - m[2]]; var pr = (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / (L * L); w = [w[0] - d[0] * pr, w[1] - d[1] * pr, w[2] - d[2] * pr]; var wl = Math.hypot(w[0], w[1], w[2]) || 1; w = [w[0] / wl, w[1] / wl, w[2] / wl];
      var si = sIn * (k || 1), sd = sDn * (k || 1); return function (t) { var s = 4 * t * (1 - t); return [a[0] + d[0] * t + w[0] * si * s, a[1] + d[1] * t + w[1] * si * s - sd * s, a[2] + d[2] * t + w[2] * si * s]; }; }
    var c0 = edge(p00, p10, opt.kF), c1 = edge(p01, p11, opt.kB), d0 = edge(p00, p01, opt.kL), d1 = edge(p10, p11, opt.kR);
    function S(u, v) { var a = c0(u), b = c1(u), c = d0(v), d = d1(v); var r = []; for (var q = 0; q < 3; q++) r.push((1 - v) * a[q] + v * b[q] + (1 - u) * c[q] + u * d[q] - ((1 - u) * (1 - v) * p00[q] + u * (1 - v) * p10[q] + (1 - u) * v * p01[q] + u * v * p11[q])); return r; }
    var G = [], ymin = 1e9, ymax = -1e9; for (var j = 0; j <= nv; j++) { var row = []; for (var i = 0; i <= nu; i++) { var p = S(i / nu, j / nv); row.push(p); ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); } G.push(row); }
    // arc lengths for metric uvs
    var U = [], V = []; for (var jj = 0; jj <= nv; jj++) { var acc = 0, ur = [0]; for (var ii = 1; ii <= nu; ii++) { var a1 = G[jj][ii], a0 = G[jj][ii - 1]; acc += Math.hypot(a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]); ur.push(acc); } U.push(ur); }
    for (var i2 = 0; i2 <= nu; i2++) { var acc2 = 0, vr = [0]; for (var j2 = 1; j2 <= nv; j2++) { var b1 = G[j2][i2], b0 = G[j2 - 1][i2]; acc2 += Math.hypot(b1[0] - b0[0], b1[1] - b0[1], b1[2] - b0[2]); vr.push(acc2); } V.push(vr); }
    function N(i, j) { var a = G[j][Math.min(nu, i + 1)], b = G[j][Math.max(0, i - 1)], c = G[Math.min(nv, j + 1)][i], d = G[Math.max(0, j - 1)][i]; var du = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dv = [c[0] - d[0], c[1] - d[1], c[2] - d[2]]; var n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]]; var l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l]; if (n[1] < 0) n = [-n[0], -n[1], -n[2]]; return n; }
    function M(i, j) { var eu = Math.min(U[j][i], U[j][nu] - U[j][i]), ev = Math.min(V[i][j], V[i][nv] - V[i][j]); return [Math.min(eu, ev), U[j][i], seed, (G[j][i][1] - ymin) / Math.max(0.01, ymax - ymin)]; }
    var cu = G[nv >> 1][(nu >> 1) + 1], cl = G[nv >> 1][nu >> 1], cv = G[(nv >> 1) + 1][nu >> 1]; var flip = ((cu[2] - cl[2]) * (cv[0] - cl[0]) - (cu[0] - cl[0]) * (cv[2] - cl[2])) < 0;
    for (var j3 = 0; j3 < nv; j3++) for (var i3 = 0; i3 < nu; i3++) { var q = flip ? [[i3, j3], [i3 + 1, j3 + 1], [i3 + 1, j3], [i3, j3], [i3, j3 + 1], [i3 + 1, j3 + 1]] : [[i3, j3], [i3 + 1, j3], [i3 + 1, j3 + 1], [i3, j3], [i3 + 1, j3 + 1], [i3, j3 + 1]];
      q.forEach(function (c) { var ci = c[0], cj = c[1]; MB.v(G[cj][ci], N(ci, cj), U[cj][ci], V[ci][cj], M(ci, cj)); }); }
    // edge cables and corner plates (steel), into the main buffer
    var steel = hex("#3a3b3d"), A = K.a, segs = 14; [[c0, 1], [c1, 1], [d0, 1], [d1, 1]].forEach(function (E) { for (var s = 0; s < segs; s++) rod(A, E[0](s / segs), E[0]((s + 1) / segs), 0.035, LY.metal, 1, steel); });
    [p00, p10, p01, p11].forEach(function (p) { A.box(p[0] - 0.09, p[1] - 0.09, p[2] - 0.09, p[0] + 0.09, p[1] + 0.09, p[2] + 0.09, LY.metal, 1, steel); });
    // far LOD: the same sail coarse, as canvas in the town material
    if (K.f && !opt.noFar) { var F = K.f, cv = XL("canvas", "plaster"), cc = hex("#ece7dc"); var fn = 5; for (var fj = 0; fj < fn; fj++) for (var fi = 0; fi < fn; fi++) { var a = S(fi / fn, fj / fn), b = S((fi + 1) / fn, fj / fn), c = S((fi + 1) / fn, (fj + 1) / fn), d = S(fi / fn, (fj + 1) / fn); var nn = KIT.nrmOf(a, b, c); if (nn[1] < 0) nn = [-nn[0], -nn[1], -nn[2]]; F.q4(a, b, c, d, nn, cv, 0, cc, 0, false); F.q4(d, c, b, a, [-nn[0], -nn[1], -nn[2]], cv, 0, shade(cc, 0.7), 0, false); } }
    return { S: S, c0: c0, c1: c1, d0: d0, d1: d1, ymin: ymin, ymax: ymax };
  }
  // string lights hanging below a curve (emissive bulbs, warm at night)
  function bulbs(A, f, n, drop, col) { var w = hex(col || "#ffd59a"); for (var i = 1; i < n; i++) { var p = f(i / n); var y = p[1] - drop * (1 - Math.pow(2 * i / n - 1, 2)); A.box(p[0] - 0.045, y - 0.07, p[2] - 0.045, p[0] + 0.045, y + 0.02, p[2] + 0.045, LY.trim, 3, w); } }

  // ───────────────────────── INT3 numbers (plan_interiors.js TYPES, model frame at scale 1) ─────────────────────────
  var R = { F: 0.216, X: 7.66, ZB: -8.6, ZF: 5.66, top: 5.36, roof: 4.95,
    front: [[-7.17, -1.55, 0.296, 3.616, 1.4], [0.21, 7.17, 0.296, 3.616, 1.4]], door: [-1.55, 0.21, 3.166], leaves: [-1.41, 0.07, 3.076],
    left: [[1.6, 4.6, 1.116, 3.416, 1.5]], right: [[3.4, 4.9, 1.116, 3.416, 1.5]],
    deck: [-8.35, 7.6, 5.66, 8.7], posts: [-8.13, -3.57, 1.57, 7.13], pz: 8.5, pergola: 3.62, planters: [[-8.35, -6.75, 6.0, 7.45], [6.35, 7.6, 6.0, 7.45]] };
  var CB = { F: 0.83, X: 12.97, ZB: -12.4, ZF: 9.09, roofB: 6.0, roofT: 6.33,
    back: [[-12.22, 12.22, 1.28, 5.43, 2.44]], side: [[-11.2, -8.4, 1.28, 5.03, 1.4], [-7.4, -4.6, 1.28, 5.03, 1.4]],
    front: [[-10.8, -5.4, 1.33, 4.43, 1.35], [-2.7, -1.64, 0.88, 3.73, 2], [0.24, 0.95, 0.88, 3.73, 2], [4.0, 10.6, 1.33, 4.43, 1.32]], door: [-1.64, 0.24, 3.78], leaves: [-1.5, 0.1, 3.68],
    lounge: [-4.45, 4.6, -3.75, 3.65, 6.33, 9.42], piers: [[-3.38, 10.0, 1.25, 1.5], [1.63, 10.0, 1.25, 1.5]],
    steps: [[-4.4, 3.4, 9.09, 11.4, 0.83], [-5.0, 4.0, 9.09, 12.0, 0.58], [-5.6, 4.6, 9.09, 12.6, 0.32]], canopy: [-5.6, 4.6, 9.09, 13.0, 5.9, 6.3] };
  // INT3's porch solids (decks and steps as rows, posts and planters as blocks), from the numbers above
  function porchRows(list, cell) { var rows = []; var zs = 1e9, ze = -1e9; list.forEach(function (r) { zs = Math.min(zs, r[2]); ze = Math.max(ze, r[3]); });
    for (var z = zs + cell / 2; z < ze; z += cell) { var run = null; for (var x = -20 + cell / 2; x < 20; x += cell) { var top = null; list.forEach(function (r) { if (x > r[0] && x < r[1] && z > r[2] && z < r[3] && (top === null || r[4] > top)) top = r[4]; });
        if (run && top !== null && Math.abs(top - run.y) < 0.01) { run.x1 = x + cell / 2; continue; } if (run) rows.push(run); run = top !== null ? { x0: x - cell / 2, x1: x + cell / 2, z: z, d: cell, y: top } : null; } if (run) rows.push(run); }
    return rows; }
  function porchData() { return {
    restaurant: { rows: porchRows([[R.deck[0], R.deck[1], R.deck[2], R.deck[3], R.F]], 0.3), posts: R.posts.map(function (x) { return [x, R.pz, 0.26, 0.26]; }).concat(R.planters.map(function (p) { return [(p[0] + p[1]) / 2, (p[2] + p[3]) / 2, p[1] - p[0], p[3] - p[2]]; })), xc: true },
    clubhouse: { rows: porchRows(CB.steps, 0.3), posts: CB.piers.map(function (p) { return p.slice(); }), xc: true } }; }

  // ───────────────────────── the restaurant ─────────────────────────
  var VENUE = { b0062: ["Market Hall", "Flight Line Market", "modern", "rust"], b0069: ["Border Books", "Books and Cafe", "cream", "sage"], b0126: ["Main Street Grill", "Grill and Bar", "wood", "oxblood"],
    b0181: ["Launch Complex", "Food Hall", "modern", "char"], b0288: ["The Outpost", "Mess Hall", "stone", "rust"] };
  var PANEL = { rust: "#e8c7ae", sage: "#a9b59a", oxblood: "#b8857a", char: "#8f9192" };
  function restaurantBuild(K) {
    var A = K.a, r = K.r, X = cx(K.C); K.ip = paneMat() ? X.ip : null; K.xb.push(X.ip, X.mb); K.frame(K.e[3] + 0.0025);
    var v = VENUE[K.id] || [shortName(K.name) || "Restaurant", "Kitchen and Bar", "modern", "rust"];
    var stucco = hex(pick(r, ["#e9c9a6", "#efd6b6", "#e3b994", "#f0dcc2", "#e6c4a4"])), panel = hex(PANEL[v[3]] || PANEL.rust), steel = hex("#2a2b2c"), conc = hex("#c9c1b4"), walnut = hex("#5a3b26");
    var rust = XL("rust", "corr"), trav = XL("travertine", "terrazzo"), cedar = XL("timber", "wood");
    K.trim = steel; K.noCollapse = true; K.track = { clear: [], room: [] };
    var W = R.X, ZB = R.ZB, ZF = R.ZF, F = R.F, TOP = R.top;
    // plinth and the terrace (travertine pavers on a concrete slab, 0.216 as porches.json and INT3 measured)
    A.box(-W - 0.08, -0.4, ZB - 0.08, W + 0.08, F - 0.02, ZF, LY.concrete, 0, conc, { no: "b" });
    A.box(R.deck[0], -0.4, ZF, R.deck[1], F, R.deck[3], trav, 0, WHITE, { no: "b" });
    A.box(R.deck[0] - 0.05, -0.4, R.deck[3], R.deck[1] + 0.05, F + 0.005, R.deck[3] + 0.06, LY.concrete, 0, conc, { no: "b" });
    // walls: stucco with a concrete base course; weathering-steel rainscreen panels on the sides and back
    var fh = R.front.map(function (b) { return [b[0], b[1], b[2], b[3], 0.1]; }).concat([[R.door[0], R.door[1], F, R.door[2], 0.1, 1]]);
    A.wall([-W, 0, ZF], [1, 0, 0], 2 * W, F - 0.02, TOP, fh.map(function (h) { return [h[0] + W, h[1] + W, h[2], h[3], h[4], h[5]]; }), LY.stucco, 0, stucco, { rev: 0.1, RL: LY.metal, RF: 1, rc: steel });
    var lh = R.left.map(function (b) { return [b[0] - ZB, b[1] - ZB, b[2], b[3], 0.1]; }); A.wall([-W, 0, ZB], [0, 0, 1], ZF - ZB, F - 0.02, TOP, lh, LY.stucco, 0, stucco, { rev: 0.1, RL: LY.metal, RF: 1, rc: steel });
    var rh = R.right.map(function (b) { return [ZF - b[1], ZF - b[0], b[2], b[3], 0.1]; }); A.wall([W, 0, ZF], [0, 0, -1], ZF - ZB, F - 0.02, TOP, rh, LY.stucco, 0, stucco, { rev: 0.1, RL: LY.metal, RF: 1, rc: steel });
    var bk = [[2 * W - 3.2, 2 * W - 2.1, F, 2.4, 0.08, 1]]; A.wall([W, 0, ZB], [-1, 0, 0], 2 * W, F - 0.02, TOP, bk, LY.stucco, 0, stucco, { rev: 0.08, RL: LY.metal, RF: 1, rc: steel });
    // the panels (proud of the stucco on a dark reveal): two each side, three on the back
    function panels(o, t, spans, y0, y1) { spans.forEach(function (s) { bar(A, o, t, s[0], s[1], y0, y1, -0.05, 0.0, rust, 0, panel); bar(A, o, t, s[0] - 0.03, s[1] + 0.03, y0 - 0.03, y1 + 0.03, -0.012, 0.0, LY.metal, 1, steel); }); }
    panels([-W, 0, ZB], [0, 0, 1], [[0.6, 9.4]], 0.9, 4.6); panels([W, 0, ZF], [0, 0, -1], [[2.2, 4.2], [5.2, 13.6]], 0.9, 4.6);
    panels([W, 0, ZB], [-1, 0, 0], [[0.7, 4.9], [5.7, 9.9], [13.6, 14.6]], 0.9, 4.6);
    // the parapet coping and the roof (membrane), roof plant, a kitchen hood
    A.box(-W - 0.06, TOP, ZB - 0.06, W + 0.06, TOP + 0.07, ZB + 0.3, LY.metal, 1, steel); A.box(-W - 0.06, TOP, ZF - 0.3, W + 0.06, TOP + 0.07, ZF + 0.06, LY.metal, 1, steel);
    A.box(-W - 0.06, TOP, ZB, -W + 0.3, TOP + 0.07, ZF, LY.metal, 1, steel); A.box(W - 0.3, TOP, ZB, W + 0.06, TOP + 0.07, ZF, LY.metal, 1, steel);
    A.box(-W + 0.3, R.roof - 0.15, ZB + 0.3, W - 0.3, R.roof, ZF - 0.3, LY.concrete, 0, hex("#77736d"), { no: "b" });
    A.box(-W + 0.3, R.roof, ZB + 0.3, -W + 0.32, TOP, ZF - 0.3, LY.stucco, 0, shade(stucco, 0.92)); A.box(W - 0.32, R.roof, ZB + 0.3, W - 0.3, TOP, ZF - 0.3, LY.stucco, 0, shade(stucco, 0.92));
    A.box(-W + 0.3, R.roof, ZB + 0.3, W - 0.3, TOP, ZB + 0.32, LY.stucco, 0, shade(stucco, 0.92)); A.box(-W + 0.3, R.roof, ZF - 0.32, W - 0.3, TOP, ZF - 0.3, LY.stucco, 0, shade(stucco, 0.92));
    [[-3.6, -5.2], [1.4, -6.0]].forEach(function (p) { A.box(p[0] - 1.0, R.roof, p[1] - 0.7, p[0] + 1.0, R.roof + 1.05, p[1] + 0.7, LY.metal, 1, hex("#b9bcbc")); for (var g = 0; g < 5; g++) A.box(p[0] - 0.92, R.roof + 0.15 + g * 0.17, p[1] + 0.7, p[0] + 0.92, R.roof + 0.2 + g * 0.17, p[1] + 0.72, LY.metal, 1, hex("#6f7272")); });
    A.box(4.2, R.roof, -7.6, 5.6, R.roof + 0.6, -6.4, LY.metal, 1, hex("#9fa3a3")); A.box(4.5, R.roof + 0.6, -7.3, 5.3, R.roof + 1.3, -6.7, LY.metal, 1, hex("#8c9090")); A.box(4.35, R.roof + 1.3, -7.45, 5.45, R.roof + 1.38, -6.55, LY.metal, 1, hex("#5c5f5f"));
    // the chimney: a stucco tower at the front right corner, a steel cap
    var cx0 = W, cx1 = W + 0.95, cz0 = ZF - 0.7, cz1 = ZF + 0.38, CHH = 6.4;
    A.box(cx0, -0.3, cz0, cx1, CHH, cz1, LY.stucco, 0, shade(stucco, 0.97), { no: "b" }); A.box(cx0 - 0.05, CHH, cz0 - 0.05, cx1 + 0.05, CHH + 0.1, cz1 + 0.05, LY.concrete, 0, conc);
    A.box(cx0 + 0.2, CHH + 0.1, cz0 + 0.2, cx1 - 0.2, CHH + 0.5, cz1 - 0.2, LY.metal, 1, steel); A.box(cx0 + 0.1, CHH + 0.5, cz0 + 0.1, cx1 - 0.1, CHH + 0.56, cz1 - 0.1, LY.metal, 1, steel);
    // the storefront: INT3's two glazed bays, the door between them, a steel frame proud of the stucco
    var o = [-W, 0, ZF], t = [1, 0, 0]; R.front.forEach(function (b) { bay(K, o, t, b[0] + W, b[1] + W, b[2], b[3], b[4], { col: steel, floor: F, d1: 0.035, gi: 0.025 }); });
    // the door: a steel frame a little wider than INT3's jambs, walnut leaves with a glass light (dropped while INT3's room shows)
    var ds = R.door[0] + W, de = R.door[1] + W, dy = R.door[2]; bar(A, o, t, ds, ds + 0.12, F, dy, -0.05, 0.035, LY.metal, 1, steel); bar(A, o, t, de - 0.12, de, F, dy, -0.05, 0.035, LY.metal, 1, steel); bar(A, o, t, ds, de, dy - 0.1, dy + 0.02, -0.05, 0.035, LY.metal, 1, steel);
    var ls = R.leaves[0] + W, le = R.leaves[1] + W, ly = R.leaves[2], m0 = A.n, gq0 = K.g.n, lw = (le - ls) / 2;
    for (var l = 0; l < 2; l++) { var a0 = ls + l * lw + 0.005, a1 = a0 + lw - 0.01; bar(A, o, t, a0, a1, F, ly, 0.0, 0.035, cedar, 0, walnut); bar(A, o, t, a0 + 0.12, a1 - 0.12, F + 1.25, ly - 0.25, -0.006, 0.0, LY.metal, 1, steel); K.g.pane([o[0], 0, o[2] + 0.008], t, a0 + 0.14, a1 - 0.14, F + 1.27, ly - 0.27, 0.9);
      bar(A, o, t, l === 0 ? a1 - 0.1 : a0 + 0.06, l === 0 ? a1 - 0.06 : a0 + 0.1, F + 0.8, F + 1.6, -0.02, 0.04, LY.metal, 1, hex("#b08d57")); }
    K.sub = { door: [[m0, A.n - m0], null], doorG: [gq0, K.g.n - gq0] };
    // the side windows (INT3's), steel framed; the back service door
    bay(K, [-W, 0, ZB], [0, 0, 1], R.left[0][0] - ZB, R.left[0][1] - ZB, R.left[0][2], R.left[0][3], R.left[0][4], { col: steel, floor: F, d1: 0.035, gi: 0.025 });
    bay(K, [W, 0, ZF], [0, 0, -1], ZF - R.right[0][1], ZF - R.right[0][0], R.right[0][2], R.right[0][3], R.right[0][4], { col: steel, floor: F, d1: 0.035, gi: 0.025 });
    doorAt(K, [W, 0, ZB], [-1, 0, 0], 2 * W - 3.2, 2 * W - 2.1, F, 2.4, { leaves: 1, inset: 0.08, lc: hex("#6b6e6c"), tc: steel });
    // the pergola: steel posts at the porch module's bays, a front beam and wall ledger, rafters, timber slats on top
    var py = R.pergola, pz = R.pz; R.posts.forEach(function (x) { A.box(x - 0.08, F, pz - 0.08, x + 0.08, py, pz + 0.08, LY.metal, 1, steel); A.box(x - 0.15, F, pz - 0.15, x + 0.15, F + 0.02, pz + 0.15, LY.metal, 1, steel); });
    A.box(R.deck[0], py, pz - 0.09, R.deck[1], py + 0.3, pz + 0.09, LY.metal, 1, steel); A.box(R.deck[0], py, ZF, R.deck[1], py + 0.3, ZF + 0.12, LY.metal, 1, steel);
    for (var rx = R.deck[0] + 0.05; rx <= R.deck[1]; rx += 1.32) A.box(rx - 0.04, py + 0.05, ZF + 0.1, rx + 0.04, py + 0.3, R.deck[3] - 0.1, LY.metal, 1, steel);
    for (var sz = ZF + 0.25; sz < R.deck[3] - 0.05; sz += 0.29) A.box(R.deck[0] - 0.1, py + 0.3, sz - 0.04, R.deck[1] + 0.1, py + 0.44, sz + 0.04, cedar, 0, hex("#c8a27a"));
    // planters at the terrace corners (porches.json keeps them clear): weathering steel, soil
    R.planters.forEach(function (p) { A.box(p[0], F, p[2], p[1], 0.75, p[3], rust, 0, panel, { no: "b" }); A.box(p[0] + 0.06, 0.66, p[2] + 0.06, p[1] - 0.06, 0.7, p[3] - 0.06, XL("rammed", "adobe"), 0, hex("#6a5440"), { no: "b" }); });
    // the name on the fascia over the pergola, gooseneck lamps
    signAt(K, o, t, W - 4.6, W + 3.6, 4.12, 4.9, v[0], v[2], v[1], 0.05);
    [-4.9, 3.9].forEach(function (x) { KIT.gooseneck(K, x, 4.95, ZF, 1); });
    // downspouts
    [[-W - 0.06, ZB + 0.3], [W + 0.06, ZB + 0.3]].forEach(function (p) { A.box(p[0] - 0.06, 0, p[1] - 0.06, p[0] + 0.06, TOP, p[1] + 0.06, LY.metal, 1, hex("#5a5c5c")); });
    // far LOD
    var Fz = K.f; Fz.box(-W, 0, ZB, W, TOP, ZF, LY.stucco, 0, stucco, { no: "b" }); Fz.box(R.deck[0], 0, ZF, R.deck[1], F, R.deck[3], trav, 0, WHITE, { no: "b" }); Fz.box(R.deck[0], py, ZF, R.deck[1], py + 0.4, R.deck[3], cedar, 0, hex("#b08a64"), { no: "b" });
    Fz.box(cx0, 0, cz0, cx1, CHH, cz1, LY.stucco, 0, stucco, { no: "b" }); Fz.box(-W + 0.4, 0.4, ZF, W - 0.4, 3.5, ZF + 0.02, LY.metal, 2, hex("#ffcf8a", 0.12));
    K.ip = null;
  }

  // ───────────────────────── the clubhouse ─────────────────────────
  var CLUB = { b0036: "The Landing Clubhouse", b0292: "The Golf Clubhouse" };
  function clubhouseBuild(K) {
    var A = K.a, r = K.r, X = cx(K.C); K.ip = paneMat() ? X.ip : null; K.xb.push(X.ip, X.mb); K.frame(K.e[3]);
    var ledge = XL("ledgestone", "ashlar"), cedarL = XL("cedar", "clap"), trav = XL("travertine", "terrazzo"), steelL = XL("steel", "metal");
    var cedar = hex(pick(r, ["#e3dcd4", "#ded5cb", "#e8e1d8"])), stone = hex(pick(r, ["#f6f0e6", "#f1e9dc"])), bronze = hex("#3b3027"), steel = hex("#2c2d2e"), soffit = hex("#d9b48f");
    K.trim = bronze; K.noCollapse = true; K.track = { clear: [], room: [] };
    var W = CB.X, ZB = CB.ZB, ZF = CB.ZF, F = CB.F, RB = CB.roofB, RT = CB.roofT;
    // the ledgestone plinth (the floor at 0.83 inside is INT3's)
    A.box(-W - 0.1, -0.4, ZB - 0.1, W + 0.1, F - 0.03, ZF, ledge, 0, stone, { no: "b" });
    // walls: horizontal cedar between ledgestone piers
    function wallZ(o, t, len, holes) { A.wall(o, t, len, F - 0.03, RB, holes, cedarL, 0, cedar, { rev: 0.12, RL: steelL, RF: 0, rc: bronze }); }
    var fz = CB.front.map(function (b) { return [b[0] + W, b[1] + W, b[2], b[3], 0.12]; }).concat([[CB.door[0] + W, CB.door[1] + W, F, CB.door[2], 0.12, 1]]);
    wallZ([-W, 0, ZF], [1, 0, 0], 2 * W, fz);
    wallZ([W, 0, ZB], [-1, 0, 0], 2 * W, CB.back.map(function (b) { return [W - b[1], W - b[0], b[2], b[3], 0.12]; }));
    wallZ([-W, 0, ZB], [0, 0, 1], ZF - ZB, CB.side.map(function (b) { return [b[0] - ZB, b[1] - ZB, b[2], b[3], 0.12]; }));
    wallZ([W, 0, ZF], [0, 0, -1], ZF - ZB, CB.side.map(function (b) { return [ZF - b[1], ZF - b[0], b[2], b[3], 0.12]; }));
    // ledgestone piers proud of the cedar: the corners and between the front window groups
    var pier = function (x0, x1, z0, z1) { A.box(x0, F - 0.03, z0, x1, RB, z1, ledge, 0, stone, { no: "b" }); };
    pier(-W - 0.12, -W + 1.0, ZF - 1.0, ZF + 0.12); pier(W - 1.0, W + 0.12, ZF - 1.0, ZF + 0.12); pier(-W - 0.12, -W + 0.75, ZB - 0.12, ZB + 0.75); pier(W - 0.75, W + 0.12, ZB - 0.12, ZB + 0.75);
    pier(-5.2, -3.0, ZF - 0.05, ZF + 0.12); pier(1.15, 3.8, ZF - 0.05, ZF + 0.12); pier(-W - 0.12, -W + 0.05, -4.4, -3.0); pier(W - 0.05, W + 0.12, -4.4, -3.0);
    // the glazing on INT3's spacing (bronze frames)
    var SH = { col: bronze, floor: F, d1: 0.035, gi: 0.025 };
    CB.front.forEach(function (b) { bay(K, [-W, 0, ZF], [1, 0, 0], b[0] + W, b[1] + W, b[2], b[3], b[4], SH); });
    CB.back.forEach(function (b) { bay(K, [W, 0, ZB], [-1, 0, 0], W - b[1], W - b[0], b[2], b[3], b[4], SH); });
    CB.side.forEach(function (b) { bay(K, [-W, 0, ZB], [0, 0, 1], b[0] - ZB, b[1] - ZB, b[2], b[3], b[4], SH); bay(K, [W, 0, ZF], [0, 0, -1], ZF - b[1], ZF - b[0], b[2], b[3], b[4], SH); });
    // the door frame and the closed glass leaves (bronze), dropped while INT3's room shows
    var o = [-W, 0, ZF], t = [1, 0, 0], ds = CB.door[0] + W, de = CB.door[1] + W, dy = CB.door[2];
    bar(A, o, t, ds, ds + 0.13, F, dy, -0.05, 0.04, LY.metal, 1, bronze); bar(A, o, t, de - 0.13, de, F, dy, -0.05, 0.04, LY.metal, 1, bronze); bar(A, o, t, ds, de, dy - 0.1, dy + 0.02, -0.05, 0.04, LY.metal, 1, bronze);
    var ls = CB.leaves[0] + W, le = CB.leaves[1] + W, ly = CB.leaves[2], m0 = A.n, gq0 = K.g.n, lw = (le - ls) / 2;
    for (var l = 0; l < 2; l++) { var a0 = ls + l * lw + 0.005, a1 = a0 + lw - 0.01; bar(A, o, t, a0, a0 + 0.07, F, ly, 0.0, 0.04, LY.metal, 1, bronze); bar(A, o, t, a1 - 0.07, a1, F, ly, 0.0, 0.04, LY.metal, 1, bronze); bar(A, o, t, a0, a1, F, F + 0.12, 0.0, 0.04, LY.metal, 1, bronze); bar(A, o, t, a0, a1, ly - 0.1, ly, 0.0, 0.04, LY.metal, 1, bronze);
      K.g.pane([o[0], 0, o[2] - 0.02], t, a0 + 0.07, a1 - 0.07, F + 0.12, ly - 0.1, 0.9); bar(A, o, t, l === 0 ? a1 - 0.2 : a0 + 0.17, l === 0 ? a1 - 0.17 : a0 + 0.2, F + 0.6, F + 1.9, -0.06, 0.0, LY.metal, 1, hex("#b08d57")); }
    K.sub = { door: [[m0, A.n - m0], null], doorG: [gq0, K.g.n - gq0] };
    // the main roof: a thin slab with deep overhangs, a steel fascia and a cedar soffit (bottom at 6.0 over INT3's 5.95 ceiling)
    var ox0 = -14.6, ox1 = 14.6, oz0 = -13.2, oz1 = 10.35;
    A.box(ox0, RB, oz0, ox1, RT, oz1, LY.concrete, 0, hex("#8a857c"), { no: "b" });
    A.q4([ox0, RB - 0.005, oz1], [ox1, RB - 0.005, oz1], [ox1, RB - 0.005, oz0], [ox0, RB - 0.005, oz0], [0, -1, 0], cedarL, 0, soffit, 0, false);
    A.box(ox0 - 0.06, RB - 0.12, oz1, ox1 + 0.06, RT + 0.22, oz1 + 0.07, LY.metal, 1, steel); A.box(ox0 - 0.06, RB - 0.12, oz0 - 0.07, ox1 + 0.06, RT + 0.22, oz0, LY.metal, 1, steel);
    A.box(ox0 - 0.07, RB - 0.12, oz0, ox0, RT + 0.22, oz1, LY.metal, 1, steel); A.box(ox1, RB - 0.12, oz0, ox1 + 0.07, RT + 0.22, oz1, LY.metal, 1, steel);
    for (var dl = -12; dl <= 12; dl += 3) { A.box(dl - 0.09, RB - 0.02, oz1 - 0.8, dl + 0.09, RB - 0.005, oz1 - 0.62, LY.trim, 3, hex("#fff0d0")); A.box(dl - 0.09, RB - 0.02, oz0 + 0.62, dl + 0.09, RB - 0.005, oz0 + 0.8, LY.trim, 3, hex("#fff0d0")); }
    // the entry: travertine landing at the floor, two steps down on three sides (INT3's porch rows), ledgestone piers and the canopy
    CB.steps.slice().reverse().forEach(function (s, i) { A.box(s[0], -0.3, s[2], s[1], s[4], s[3], i === 2 ? trav : ledge, 0, i === 2 ? WHITE : stone, { no: "b" }); if (i < 2) A.box(s[0] - 0.02, s[4] - 0.04, s[2], s[1] + 0.02, s[4] + 0.005, s[3] + 0.02, trav, 0, WHITE, { no: "b" }); });
    CB.piers.forEach(function (p) { A.box(p[0] - p[2] / 2, F, p[1] - p[3] / 2, p[0] + p[2] / 2, CB.canopy[4], p[1] + p[3] / 2, ledge, 0, stone, { no: "b" }); });
    var C2 = CB.canopy; A.box(C2[0], C2[4], C2[2], C2[1], C2[5], C2[3], LY.concrete, 0, hex("#8a857c"), { no: "b" }); A.q4([C2[0], C2[4] - 0.005, C2[3]], [C2[1], C2[4] - 0.005, C2[3]], [C2[1], C2[4] - 0.005, C2[2]], [C2[0], C2[4] - 0.005, C2[2]], [0, -1, 0], cedarL, 0, soffit, 0, false);
    A.box(C2[0] - 0.06, C2[4] - 0.1, C2[3], C2[1] + 0.06, C2[5] + 0.12, C2[3] + 0.06, LY.metal, 1, steel); A.box(C2[0] - 0.06, C2[4] - 0.1, C2[2], C2[0], C2[5] + 0.12, C2[3], LY.metal, 1, steel); A.box(C2[1], C2[4] - 0.1, C2[2], C2[1] + 0.06, C2[5] + 0.12, C2[3], LY.metal, 1, steel);
    [-4.2, -1.0, 2.2].forEach(function (x) { A.box(x - 0.1, C2[4] - 0.02, 11.6, x + 0.1, C2[4] - 0.005, 11.8, LY.trim, 3, hex("#fff0d0")); });
    signAt(K, [C2[0], 0, C2[3] + 0.06], [1, 0, 0], 0.6, C2[1] - C2[0] - 0.6, C2[4] - 0.08, C2[5] + 0.1, CLUB[K.id] || shortName(K.name) || "Clubhouse", "modern", "", 0.02);
    // the roof lounge: a glass pavilion on the roof (INT3's room 2), its own thin roof with a deep overhang
    var Lg = CB.lounge; var lo = [[Lg[0], Lg[3], 1, 0, Lg[1] - Lg[0]], [Lg[1], Lg[2], -1, 0, Lg[1] - Lg[0]], [Lg[0], Lg[2], 0, 1, Lg[3] - Lg[2]], [Lg[1], Lg[3], 0, -1, Lg[3] - Lg[2]]];
    lo.forEach(function (w) { var ow = [w[0], 0, w[1]], tw = [w[2], 0, w[3]]; bay(K, ow, tw, 0.12, w[4] - 0.12, Lg[4] + 0.06, Lg[5] - 0.06, 1.5, { col: bronze, floor: Lg[4] }); });
    [[Lg[0], Lg[2]], [Lg[1], Lg[2]], [Lg[0], Lg[3]], [Lg[1], Lg[3]]].forEach(function (p) { A.box(p[0] - 0.14, Lg[4], p[1] - 0.14, p[0] + 0.14, Lg[5], p[1] + 0.14, LY.metal, 1, steel); });
    A.box(Lg[0] - 0.05, Lg[4] - 0.02, Lg[2] - 0.05, Lg[1] + 0.05, Lg[4] + 0.06, Lg[3] + 0.05, LY.metal, 1, steel);
    var l0 = Lg[0] - 1.5, l1 = Lg[1] + 1.5, lz0 = Lg[2] - 1.5, lz1 = Lg[3] + 1.5; A.box(l0, Lg[5], lz0, l1, Lg[5] + 0.32, lz1, LY.concrete, 0, hex("#8a857c"), { no: "b" });
    A.q4([l0, Lg[5] - 0.005, lz1], [l1, Lg[5] - 0.005, lz1], [l1, Lg[5] - 0.005, lz0], [l0, Lg[5] - 0.005, lz0], [0, -1, 0], cedarL, 0, soffit, 0, false);
    A.box(l0 - 0.05, Lg[5] - 0.08, lz1, l1 + 0.05, Lg[5] + 0.4, lz1 + 0.06, LY.metal, 1, steel); A.box(l0 - 0.05, Lg[5] - 0.08, lz0 - 0.06, l1 + 0.05, Lg[5] + 0.4, lz0, LY.metal, 1, steel); A.box(l0 - 0.06, Lg[5] - 0.08, lz0, l0, Lg[5] + 0.4, lz1, LY.metal, 1, steel); A.box(l1, Lg[5] - 0.08, lz0, l1 + 0.06, Lg[5] + 0.4, lz1, LY.metal, 1, steel);
    // roof deck round the lounge (cedar boards) and a glass rail at the front edge of it
    A.box(Lg[0] - 2.6, RT, Lg[2] - 1.8, Lg[1] + 2.6, RT + 0.05, Lg[3] + 2.4, cedarL, 0, shade(cedar, 0.85), { no: "b" });
    // far LOD
    var Fz = K.f; Fz.box(-W, 0, ZB, W, RB, ZF, cedarL, 0, cedar, { no: "b" }); Fz.box(ox0, RB, oz0, ox1, RT + 0.2, oz1, LY.concrete, 0, hex("#8a857c"), { no: "b" }); Fz.box(Lg[0], RT, Lg[2], Lg[1], Lg[5] + 0.3, Lg[3], LY.metal, 2, hex("#ffd59a", 0.2), { no: "b" });
    Fz.box(-W, 0, ZF, W, F, ZF + 0.02, ledge, 0, stone); Fz.box(C2[0], C2[4], C2[2], C2[1], C2[5], C2[3], LY.concrete, 0, hex("#8a857c"), { no: "b" });
    K.ip = null;
  }

  // ───────────────────────── the gallery pavilion (artpav): a raised timber deck, white gallery rooms, a wave of hypar sails ─────────────────────────
  function artpavBuild(K) {
    var A = K.a, r = K.r, X = cx(K.C); K.ip = paneMat() ? X.ip : null; K.xb.push(X.ip, X.mb); K.frame(K.e[3]);
    var deckL = XL("planks", "wood"), timberL = XL("hewn", "wood"), plaster = XL("plaster", "plaster"), rust = XL("rust", "corr"), steelL = XL("steel", "metal");
    var deckC = hex("#dcc6a8"), timber = hex("#c9ad8c"), white = hex("#f3efe7"), steel = hex("#2e2f30"), skirt = hex("#3a342e");
    K.trim = steel; K.track = null;
    var DX = 17, DZ = 7.6, DH = 1.15;
    // the deck on a dark skirt, a timber fascia, boards running across
    A.box(-DX + 0.5, -0.3, -DZ + 0.5, DX - 0.5, DH - 0.2, DZ - 0.5, LY.metal, 1, skirt, { no: "bt" });
    A.box(-DX, DH - 0.24, -DZ, DX, DH, DZ, deckL, 0, deckC, { no: "b", rotTop: true });
    A.box(-DX - 0.06, DH - 0.36, DZ, DX + 0.06, DH + 0.01, DZ + 0.06, timberL, 0, timber); A.box(-DX - 0.06, DH - 0.36, -DZ - 0.06, DX + 0.06, DH + 0.01, -DZ, timberL, 0, timber);
    A.box(-DX - 0.06, DH - 0.36, -DZ, -DX, DH + 0.01, DZ, timberL, 0, timber); A.box(DX, DH - 0.36, -DZ, DX + 0.06, DH + 0.01, DZ, timberL, 0, timber);
    // the front stair (the client's door mat sits at its foot), timber treads and steel stringers
    var SW = 3.2, NS = 6, rise = DH / NS, run = 0.33; for (var s = 0; s < NS; s++) { var y1 = DH - s * rise, z0 = DZ + s * run; A.box(-SW, y1 - rise - 0.05, z0, SW, y1 - rise + 0.04, z0 + run + 0.02, deckL, 0, deckC, { no: "b" }); }
    [-SW - 0.05, SW + 0.05].forEach(function (x) { rod(A, [x, DH, DZ], [x, 0.05, DZ + NS * run], 0.1, LY.metal, 1, steel); });
    // railings: timber posts, cap rail, four steel cables; open at the stair
    var cap = DH + 1.05, rail = function (x0, z0, x1, z1) { var L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 1.9)); for (var i = 0; i <= n; i++) { var x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n; A.box(x - 0.06, DH, z - 0.06, x + 0.06, cap, z + 0.06, timberL, 0, timber); }
      rod(A, [x0, cap + 0.03, z0], [x1, cap + 0.03, z1], 0.1, timberL, 0, timber); for (var c = 1; c <= 4; c++) rod(A, [x0, DH + c * 0.2, z0], [x1, DH + c * 0.2, z1], 0.012, LY.metal, 1, steel); };
    rail(-DX + 0.1, DZ - 0.1, -SW - 0.1, DZ - 0.1); rail(SW + 0.1, DZ - 0.1, DX - 0.1, DZ - 0.1); rail(-DX + 0.1, -DZ + 0.1, DX - 0.1, -DZ + 0.1); rail(-DX + 0.1, -DZ + 0.1, -DX + 0.1, DZ - 0.1); rail(DX - 0.1, -DZ + 0.1, DX - 0.1, DZ - 0.1);
    // three white gallery rooms on the deck, steel-and-glass fronts, the middle one with the doors
    var rooms = [[-14, -6], [-3.2, 3.2], [6, 14]], rz0 = -6.2, rz1 = 1.6, RH = DH + 4.4;
    rooms.forEach(function (rm, ri) { var x0 = rm[0], x1 = rm[1], w = x1 - x0;
      A.wall([x1, 0, rz0], [-1, 0, 0], w, DH, RH, [[1.0, w - 1.0, DH + 3.6, DH + 4.05, 0.12]], plaster, 1, white, { rev: 0.12, RL: steelL, RF: 0, rc: steel });
      bay(K, [x1, 0, rz0], [-1, 0, 0], 1.0, w - 1.0, DH + 3.6, DH + 4.05, 1.8, { col: steel, floor: DH, noClear: true, lit: 0.8 });
      A.wall([x0, 0, rz0], [0, 0, 1], rz1 - rz0, DH, RH, [], plaster, 1, white, { rev: 0 }); A.wall([x1, 0, rz1], [0, 0, -1], rz1 - rz0, DH, RH, [], plaster, 1, white, { rev: 0 });
      // the glass front between two plaster piers
      A.box(x0, DH, rz1 - 0.3, x0 + 0.45, RH, rz1, plaster, 1, white); A.box(x1 - 0.45, DH, rz1 - 0.3, x1, RH, rz1, plaster, 1, white); A.box(x0, RH - 0.55, rz1 - 0.3, x1, RH, rz1, plaster, 1, white);
      var g0 = x0 + 0.45, g1 = x1 - 0.45; if (ri === 1) { bay(K, [x0, 0, rz1 - 0.1], [1, 0, 0], 0.45, w / 2 - 1.0, DH + 0.05, RH - 0.55, 1.4, { col: steel, floor: DH, noClear: true }); bay(K, [x0, 0, rz1 - 0.1], [1, 0, 0], w / 2 + 1.0, w - 0.45, DH + 0.05, RH - 0.55, 1.4, { col: steel, floor: DH, noClear: true });
          doorAt(K, [x0, 0, rz1 - 0.1], [1, 0, 0], w / 2 - 1.0, w / 2 + 1.0, DH, DH + 3.0, { glazed: true, leaves: 2, tc: steel, lc: steel, inset: 0.04 }); A.box(x0 + w / 2 - 1.0, DH + 3.0, rz1 - 0.16, x0 + w / 2 + 1.0, RH - 0.55, rz1 - 0.04, plaster, 1, white); }
      else bay(K, [x0, 0, rz1 - 0.1], [1, 0, 0], 0.45, w - 0.45, DH + 0.05, RH - 0.55, 1.6, { col: steel, floor: DH, noClear: true });
      A.box(x0 - 0.05, RH, rz0 - 0.05, x1 + 0.05, RH + 0.12, rz1 + 0.05, LY.metal, 1, steel); A.box(x0 + 0.1, RH - 0.02, rz0 + 0.1, x1 - 0.1, RH + 0.1, rz1 - 0.1, LY.concrete, 0, hex("#9c968e"));
      // the far LOD room
      K.f.box(x0, DH, rz0, x1, RH, rz1, plaster, 1, white, { no: "b" }); });
    // the name on a low steel plinth by the stair
    signAt(K, [-SW - 3.4, 0, DZ + 0.7], [1, 0, 0], 0, 3.0, 0.35, 0.95, "Gallery Pavilion", "modern", "Design District", 0.04); A.box(-SW - 3.45, 0, DZ + 0.55, -SW - 0.35, 1.0, DZ + 0.7, LY.metal, 1, steel);
    // the masts (raked timber, steel caps), the guys, and the wave: three hypar sails, high and low corners alternating
    var MX = [-18, -6, 6, 18], H = 13.2, Lo = 8.6, MZ = 8.9;
    var top = function (x, front, hi) { var rk = front ? 1 : -1; return [x + (x < -10 ? -0.7 : x > 10 ? 0.7 : 0), hi ? H : Lo, rk * (MZ + 0.9)]; };
    var hiF = [true, false, true, false], hiB = [false, true, false, true], tops = { f: [], b: [] };
    MX.forEach(function (x, i) { [[true, hiF[i]], [false, hiB[i]]].forEach(function (q) { var front = q[0], hi = q[1], tp = top(x, front, hi), base = [x, 0, (front ? 1 : -1) * MZ];
        pole(A, base, tp, 0.2, 0.15, 10, timberL, 0, timber); A.box(base[0] - 0.35, -0.2, base[2] - 0.35, base[0] + 0.35, 0.25, base[2] + 0.35, LY.concrete, 0, hex("#b8b2a6")); A.box(tp[0] - 0.13, tp[1], tp[2] - 0.13, tp[0] + 0.13, tp[1] + 0.35, tp[2] + 0.13, LY.metal, 1, steel);
        var out = (front ? 1 : -1), gx = x < -10 ? -3.5 : x > 10 ? 3.5 : 0; var anc = [x + gx, 0.1, out * (MZ + 4.6)]; rod(A, [tp[0], tp[1] + 0.25, tp[2]], anc, 0.03, LY.metal, 1, steel); A.box(anc[0] - 0.3, -0.1, anc[2] - 0.3, anc[0] + 0.3, 0.2, anc[2] + 0.3, LY.concrete, 0, hex("#b8b2a6"));
        if (gx) { var anc2 = [x + gx * 1.3, 0.1, out * (MZ - 1.0)]; rod(A, [tp[0], tp[1] + 0.25, tp[2]], anc2, 0.03, LY.metal, 1, steel); A.box(anc2[0] - 0.3, -0.1, anc2[2] - 0.3, anc2[0] + 0.3, 0.2, anc2[2] + 0.3, LY.concrete, 0, hex("#b8b2a6")); }
        (front ? tops.f : tops.b).push([tp[0], tp[1] - 0.35, tp[2] - out * 0.25]); }); });
    for (var b = 0; b < 3; b++) { var sl = sail(K, X.mb, tops.f[b], tops.f[b + 1], tops.b[b], tops.b[b + 1], { nu: 24, nv: 18, sIn: 1.5, sDn: 0.5, kL: b === 0 ? 1 : 0.35, kR: b === 2 ? 1 : 0.35, seed: b * 0.37 + 0.1 });
      bulbs(A, sl.c0, 16, 0.45); bulbs(A, sl.c1, 16, 0.45); }
    K.f.box(-DX, 0, -DZ, DX, DH, DZ, deckL, 0, deckC, { no: "b" });
    solid(K, 0, 0, 2 * DX, 2 * DZ, -0.2, DH); MX.forEach(function (x) { solid(K, x, MZ, 0.5, 0.5, 0, 4); solid(K, x, -MZ, 0.5, 0.5, 0, 4); });
    K.ip = null;
  }

  // ───────────────────────── the flagship pavilion: a cedar pavilion under one sweeping sail, a round deck, a courtyard fountain, a fire pit ─────────────────────────
  function flagshipBuild(K) {
    var A = K.a, r = K.r, X = cx(K.C); K.ip = paneMat() ? X.ip : null; K.xb.push(X.ip, X.mb); K.frame(K.e[3]);
    var deckL = XL("planks", "wood"), cedarL = XL("cedar", "clap"), timberL = XL("hewn", "wood"), trav = XL("travertine", "terrazzo"), steelL = XL("steel", "metal"), ledge = XL("ledgestone", "ashlar");
    var deckC = hex("#d9c0a2"), cedar = hex(pick(r, ["#f2e2cf", "#ead6c0"])), timber = hex("#c8a888"), steel = hex("#2f3031"), stone = hex("#e6dccb"), water = hex("#5fb7c4");
    K.trim = timber; K.track = null;
    var DH = 0.45, cz = 6.0, Rd = 7.6;
    // the round deck: a polygon of boards on a stone plinth, a notch at the front for the entry steps (the door mat is at their foot)
    var NSEG = 40, ring = []; for (var i = 0; i <= NSEG; i++) { var a = i / NSEG * PI * 2; ring.push([Math.sin(a) * Rd, cz + Math.cos(a) * Rd]); }
    for (var j = 0; j < NSEG; j++) { var p0 = ring[j], p1 = ring[j + 1]; var nx = (p0[0] + p1[0]) / 2, nz = (p0[1] + p1[1]) / 2 - cz, nl = Math.hypot(nx, nz); A.q4([p0[0], -0.3, p0[1]], [p1[0], -0.3, p1[1]], [p1[0], DH, p1[1]], [p0[0], DH, p0[1]], [nx / nl, 0, nz / nl], ledge, 0, stone, 0, false);
      A.tri([0, DH, cz], [p0[0], DH, p0[1]], [p1[0], DH, p1[1]], [0, 1, 0], deckL, 0, deckC); }
    // entry steps at the front (x -1.8..1.8): down to the ground in two treads
    [[DH - 0.15, cz + Rd - 0.3, cz + Rd + 0.42], [DH - 0.3, cz + Rd + 0.42, cz + Rd + 0.95]].forEach(function (s) { A.box(-1.8, -0.3, s[1], 1.8, s[0], s[2], trav, 0, WHITE, { no: "b" }); });
    // the pavilion: a wedge plan (wide front, narrow back left), cedar walls, a glass front with glulam mullions, a flat roof and fascia
    var FZ = 1.0, BZ = -15, FL = -8.0, FR = 6.5, BL = -8.0, BR = -3.5, WH = 5.0;
    var pp = [[FL - 0.2, FZ + 0.2], [FR + 0.25, FZ + 0.2], [BR + 0.2, BZ - 0.2], [BL - 0.2, BZ - 0.2]];
    [[0, 1, 2], [0, 2, 3]].forEach(function (tq) { var a = pp[tq[0]], b = pp[tq[1]], c = pp[tq[2]]; A.tri([a[0], DH - 0.02, a[1]], [b[0], DH - 0.02, b[1]], [c[0], DH - 0.02, c[1]], [0, 1, 0], deckL, 0, deckC); });
    for (var pe = 0; pe < 4; pe++) { var pa = pp[pe], pb = pp[(pe + 1) % 4], qx = pb[0] - pa[0], qz = pb[1] - pa[1], ql = Math.hypot(qx, qz); A.q4([pa[0], -0.3, pa[1]], [pb[0], -0.3, pb[1]], [pb[0], DH, pb[1]], [pa[0], DH, pa[1]], [-qz / ql, 0, qx / ql], ledge, 0, stone, 0, false); }
    A.wall([BL, 0, BZ], [0, 0, 1], FZ - BZ, DH, WH, [[3.0, 6.0, DH + 0.9, DH + 2.6, 0.1], [9.0, 12.0, DH + 0.9, DH + 2.6, 0.1]], cedarL, 0, cedar, { rev: 0.1, RL: timberL, RF: 0, rc: timber });
    [[3.0, 6.0], [9.0, 12.0]].forEach(function (h) { bay(K, [BL, 0, BZ], [0, 0, 1], h[0], h[1], DH + 0.9, DH + 2.6, 1.5, { col: timber, floor: DH, noClear: true }); });
    var dx = FR - BR, dz = FZ - BZ, dl = Math.hypot(dx, dz), td = [-dx / dl, 0, -dz / dl];
    A.wall([FR, 0, FZ], td, dl, DH, WH, [[2.0, 5.0, DH + 0.9, DH + 2.6, 0.1], [8.0, 11.0, DH + 0.9, DH + 2.6, 0.1]], cedarL, 0, cedar, { rev: 0.1, RL: timberL, RF: 0, rc: timber });
    [[2.0, 5.0], [8.0, 11.0]].forEach(function (h) { bay(K, [FR, 0, FZ], td, h[0], h[1], DH + 0.9, DH + 2.6, 1.5, { col: timber, floor: DH, noClear: true }); });
    A.wall([BR, 0, BZ], [-1, 0, 0], BR - BL, DH, WH, [], cedarL, 0, cedar, { rev: 0 });
    // the glass front: glulam mullions every 1.4 m, the doors in the middle
    var gw = FR - FL; A.box(FL, DH, FZ - 0.25, FL + 0.3, WH, FZ, timberL, 0, timber); A.box(FR - 0.3, DH, FZ - 0.25, FR, WH, FZ, timberL, 0, timber);
    bay(K, [FL, 0, FZ], [1, 0, 0], 0.3, gw / 2 - 1.1, DH + 0.04, WH - 0.1, 1.4, { col: timber, floor: DH, noClear: true, mw: 0.12 }); bay(K, [FL, 0, FZ], [1, 0, 0], gw / 2 + 1.1, gw - 0.3, DH + 0.04, WH - 0.1, 1.4, { col: timber, floor: DH, noClear: true, mw: 0.12 });
    doorAt(K, [FL, 0, FZ], [1, 0, 0], gw / 2 - 1.1, gw / 2 + 1.1, DH, DH + 2.8, { glazed: true, leaves: 2, tc: timber, lc: timber, inset: 0.05 }); A.box(FL + gw / 2 - 1.1, DH + 2.8, FZ - 0.12, FL + gw / 2 + 1.1, WH - 0.1, FZ - 0.02, timberL, 0, timber);
    // the roof: a slab over the wedge with a 0.6 m overhang (cedar soffit), timber fascia
    var rp = [[FL - 0.6, FZ + 0.6], [FR + 0.6, FZ + 0.6], [BR + 0.6, BZ - 0.6], [BL - 0.6, BZ - 0.6]];
    [[0, 1, 2], [0, 2, 3]].forEach(function (tq) { var a = rp[tq[0]], b = rp[tq[1]], c = rp[tq[2]]; A.tri([a[0], WH + 0.3, a[1]], [b[0], WH + 0.3, b[1]], [c[0], WH + 0.3, c[1]], [0, 1, 0], LY.concrete, 0, hex("#8e8a82")); A.tri([a[0], WH, a[1]], [c[0], WH, c[1]], [b[0], WH, b[1]], [0, -1, 0], cedarL, 0, shade(cedar, 0.85)); });
    for (var e = 0; e < 4; e++) { var a1 = rp[e], b1 = rp[(e + 1) % 4], ex = b1[0] - a1[0], ez = b1[1] - a1[1], el = Math.hypot(ex, ez); A.q4([a1[0], WH, a1[1]], [b1[0], WH, b1[1]], [b1[0], WH + 0.3, b1[1]], [a1[0], WH + 0.3, a1[1]], [-ez / el, 0, ex / el], timberL, 0, timber, 0, false); }
    // the courtyard on the deck's front right (travertine on its own plinth past the deck rim), a small bowl fountain, two planters
    var px0 = 1.8, px1 = 6.8, pz0 = 8.2, pz1 = 12.4, CT = DH + 0.02;
    A.box(px0, -0.3, pz0, px1, CT, pz1, trav, 0, WHITE, { no: "b" });
    var fcx = (px0 + px1) / 2, fcz = (pz0 + pz1) / 2; A.cyl(fcx, CT, fcz, 0.62, 0.42, 18, trav, 0, shade(WHITE, 0.92), false); A.cyl(fcx, CT + 0.42, fcz, 0.66, 0.06, 18, trav, 0, WHITE, true);
    A.cyl(fcx, CT + 0.12, fcz, 0.07, 0.62, 8, LY.metal, 1, hex("#6d6a63"), true);
    var gq = K.g, wy = CT + 0.4; for (var fw = 0; fw < 16; fw++) { var fa0 = fw / 16 * PI * 2, fa1 = (fw + 1) / 16 * PI * 2; gq.v(fcx, wy, fcz, 0, 1, 0, 0.5, 0.5, 0.0); gq.v(fcx + Math.sin(fa1) * 0.56, wy, fcz + Math.cos(fa1) * 0.56, 0, 1, 0, 0.5 + Math.sin(fa1) * 0.5, 0.5 + Math.cos(fa1) * 0.5, 0.0); gq.v(fcx + Math.sin(fa0) * 0.56, wy, fcz + Math.cos(fa0) * 0.56, 0, 1, 0, 0.5 + Math.sin(fa0) * 0.5, 0.5 + Math.cos(fa0) * 0.5, 0.0); }
    [[px0 + 0.15, pz1 - 1.15], [px1 - 1.15, pz0 + 0.15]].forEach(function (q) { A.box(q[0], CT, q[1], q[0] + 1.0, CT + 0.55, q[1] + 1.0, ledge, 0, stone, { no: "b" }); A.box(q[0] + 0.08, CT + 0.48, q[1] + 0.08, q[0] + 0.92, CT + 0.52, q[1] + 0.92, XL("rammed", "adobe"), 0, hex("#6a5440"), { no: "b" }); });
    // the fire pit (steel bowl, embers that glow at night) with a curved bench of three blocks
    var fx = -4.3, fzp = 11.0; A.cyl(fx, DH, fzp, 0.62, 0.38, 14, LY.metal, 1, steel, true); A.cyl(fx, DH + 0.38, fzp, 0.48, 0.02, 12, LY.metal, 3, hex("#ff7a2a", 0.9), true);
    for (var bq = 0; bq < 3; bq++) { var ba = PI * 0.15 + bq * PI * 0.32, bx = fx + Math.cos(ba) * 1.7, bz = fzp - Math.sin(ba) * 1.7; A.obox([bx, DH + 0.22, bz], [Math.sin(ba), 0, Math.cos(ba)], [0, 1, 0], 0.7, 0.22, 0.24, timberL, 0, timber); }
    // loungers facing the courtyard
    [2.9, 4.3, 5.7].forEach(function (lx) { A.box(lx - 0.33, DH, 5.6, lx + 0.33, DH + 0.3, 7.6, timberL, 0, timber); A.box(lx - 0.3, DH + 0.3, 5.9, lx + 0.3, DH + 0.38, 7.55, LY.plaster, 1, hex("#efe9dd")); A.obox([lx, DH + 0.62, 5.72], [1, 0, 0], [0, 0.82, -0.57], 0.3, 0.38, 0.05, LY.plaster, 1, hex("#efe9dd")); });
    // the sail: four masts, the tall one at the front right, guys to ground anchors
    var S = { fl: [-9.6, 8.6, 3.6], fr: [8.6, 13.4, 5.0], br: [-1.6, 6.8, -17.4], bl: [-10.2, 5.6, -18.8] };
    var bases = { fl: [-10.2, 0, 4.2], fr: [7.2, DH, 6.6], br: [-1.2, 0, -18.0], bl: [-10.8, 0, -19.4] };
    for (var k in S) { var tp = S[k], bs = bases[k]; pole(A, bs, [tp[0], tp[1] + 0.3, tp[2]], k === "fr" ? 0.26 : 0.18, k === "fr" ? 0.16 : 0.13, 12, timberL, 0, timber); A.box(bs[0] - 0.4, bs[1] - 0.25, bs[2] - 0.4, bs[0] + 0.4, bs[1] + 0.12, bs[2] + 0.4, LY.concrete, 0, hex("#b8b2a6"));
      A.box(tp[0] - 0.14, tp[1] + 0.3, tp[2] - 0.14, tp[0] + 0.14, tp[1] + 0.6, tp[2] + 0.14, LY.metal, 1, steel); }
    [[S.fr, [14.4, 0.1, 9.2]], [S.fr, [10.2, 0.1, 13.6]], [S.fl, [-13.6, 0.1, 6.6]], [S.bl, [-13.0, 0.1, -21.6]], [S.br, [0.8, 0.1, -21.2]]].forEach(function (g) { rod(A, [g[0][0], g[0][1] + 0.4, g[0][2]], g[1], 0.035, LY.metal, 1, steel); A.box(g[1][0] - 0.3, -0.1, g[1][2] - 0.3, g[1][0] + 0.3, 0.2, g[1][2] + 0.3, LY.concrete, 0, hex("#b8b2a6")); });
    var sl = sail(K, X.mb, S.fl, S.fr, S.bl, S.br, { nu: 34, nv: 30, sIn: 2.2, sDn: 0.9, kF: 1.15, kB: 0.85, kL: 0.55, kR: 1.0, seed: (K.i || 0) * 0.31 + 0.6 });
    bulbs(A, sl.c0, 22, 0.5);
    // far LOD
    var Fz = K.f; Fz.box(-Rd, 0, cz - Rd, Rd, DH, cz + Rd, deckL, 0, deckC, { no: "b" }); Fz.box(Math.min(FL, BL), 0, BZ, FR, WH + 0.3, FZ, cedarL, 0, cedar, { no: "b" }); Fz.box(FL, DH, FZ, FR, WH - 0.2, FZ + 0.02, LY.metal, 2, hex("#ffd59a", 0.15));
    K.ip = null;
  }

  var BUILD = { restaurant: restaurantBuild, clubhouse: clubhouseBuild, artpav: artpavBuild, flagship: flagshipBuild };
  KINDS.forEach(function (k) { XT.builders[k] = function (K) {
      var X = cx(K.C), n0 = { ip: X.ip.n, mb: X.mb.n };
      K.onFail = function () { X.ip.n = n0.ip; X.mb.n = n0.mb; };
      K.onRec = function (rec) { rec.xc = { kind: k, ip: [n0.ip, X.ip.n - n0.ip], mb: [n0.mb, X.mb.n - n0.mb], clear: K.track ? K.track.clear.slice() : [], room: K.track ? K.track.room.slice() : [] }; XC.recs.push(rec); };
      BUILD[k](K); }; });
  XC.recs = [];

  // ───────────────────────── meshes per town chunk, the near/far switch is the town module's ─────────────────────────
  var prevChunk = XT.onChunk;
  XT.onChunk = function (C, G) { if (prevChunk) prevChunk(C, G); var X = CX[C.k]; if (!X || X.meshes) return; X.meshes = {}; C.x = C.x || [];
    if (X.ip.n && paneMat()) { var g = new THREE.BufferGeometry(), n = X.ip.n; g.setAttribute("position", new THREE.BufferAttribute(X.ip.P.slice(0, n * 3), 3)); g.setAttribute("normal", new THREE.BufferAttribute(X.ip.N.slice(0, n * 3), 3)); g.setAttribute("uv", new THREE.BufferAttribute(X.ip.T.slice(0, n * 2), 2)); g.setAttribute("aXG", new THREE.BufferAttribute(X.ip.G.slice(0, n * 4), 4)); g.computeBoundingSphere();
      var me = new THREE.Mesh(g, paneMat()); me.name = "xc rooms " + C.k; me.castShadow = false; me.receiveShadow = false; me.userData.noSolid = true; me.matrixAutoUpdate = false; G.add(me); C.x.push(me); X.meshes.ip = me; }
    if (X.mb.n) { var g2 = new THREE.BufferGeometry(), m2 = X.mb.n; g2.setAttribute("position", new THREE.BufferAttribute(X.mb.P.slice(0, m2 * 3), 3)); g2.setAttribute("normal", new THREE.BufferAttribute(X.mb.N.slice(0, m2 * 3), 3)); g2.setAttribute("muv", new THREE.BufferAttribute(X.mb.T.slice(0, m2 * 2), 2)); g2.setAttribute("aMb", new THREE.BufferAttribute(X.mb.M.slice(0, m2 * 4), 4)); g2.computeBoundingSphere();
      var mm = new THREE.Mesh(g2, memMat()); mm.name = "xc membrane " + C.k; mm.castShadow = true; mm.receiveShadow = true; mm.userData.noSolid = true; mm.matrixAutoUpdate = false; G.add(mm); C.x.push(mm); X.meshes.mb = mm; }
    X.ip = { n: X.ip.n }; X.mb = { n: X.mb.n };   // the arrays live in the geometry now
  };

  // ───────────────────────── collapsing vertex ranges (INT3's room showing, a client room in place) ─────────────────────────
  function rng(mesh, r, on, rec, key) { if (!mesh || !r || !r[1]) return; var at = mesh.geometry.attributes.position, a = at.array, s = r[0] * 3, n = r[1] * 3; rec.sv = rec.sv || {}; var sk = key + ":" + r[0];
    if (on) { if (rec.sv[sk]) return; rec.sv[sk] = a.slice(s, s + n); for (var i = 0; i < n; i += 3) { a[s + i] = rec.B.x; a[s + i + 1] = rec.B.y; a[s + i + 2] = rec.B.z; } }
    else { if (!rec.sv[sk]) return; a.set(rec.sv[sk], s); delete rec.sv[sk]; }
    if (at.addUpdateRange) at.addUpdateRange(s, n); at.needsUpdate = true; }   // ranges accumulate until the upload (several buildings may change in one frame)
  function meshesOf(rec) { var X = CX[rec.C.k]; return { main: rec.C.meshes.main, glass: rec.C.meshes.glass, ip: X && X.meshes && X.meshes.ip, mb: X && X.meshes && X.meshes.mb }; }
  // INT3 kinds: the closed door and the fake rooms give way to INT3's (on), the clear glass shows only then
  function int3(rec, on) { var M = meshesOf(rec); if (rec.sub && rec.sub.door) rng(M.main, rec.sub.door[0], on, rec, "d"); if (rec.sub && rec.sub.doorG) rng(M.glass, rec.sub.doorG, on, rec, "dg"); if (M.ip && rec.xc.ip[1]) { rng(M.ip, rec.xc.ip, on, rec, "ip"); rec.xc.clear.forEach(function (c) { rng(M.glass, c, !on, rec, "cl"); }); } }
  // a client room in place (artpav, flagship): its membranes and fake rooms go with the shell
  function inRoom(rec, on) { var M = meshesOf(rec); rng(M.ip, rec.xc.ip, on, rec, "ip"); rng(M.mb, rec.xc.mb, on, rec, "mb"); }
  var curInt = null, curIn = null, ready = false;
  function recByE(e) { for (var i = 0; i < XC.recs.length; i++) if (XC.recs[i].e === e) return XC.recs[i]; return null; }
  function frame() {
    if (!ready) { if (!XC.recs.length || !XC.recs[0].C.meshes.main) return; ready = true; XC.recs.forEach(function (rec) { var M = meshesOf(rec); if (rec.xc.clear.length && M.ip && rec.xc.ip[1]) rec.xc.clear.forEach(function (c) { rng(M.glass, c, true, rec, "cl"); }); }); }
    try { var k = 0; try { k = typeof night === "number" ? night : 0; } catch (e) {} U.uNight.value = k;
      var IN = window.PLAN_INTERIORS, h = IN && IN.active, vis = !!(h && h.L && h.L.g && h.L.g.visible), want = vis ? recByE(h.e) : null;
      if (want && !want.noCollapse) want = null;
      if (want !== curInt) { if (curInt) int3(curInt, false); if (want) int3(want, true); curInt = want; }
      var ins = null; try { ins = inside || null; } catch (e) {} var w2 = ins && ins.door && !ins.int3 ? recByE(ins.door.e) : null;
      if (w2 !== curIn) { if (curIn) inRoom(curIn, false); if (w2) inRoom(w2, true); curIn = w2; }
    } catch (e) { note("frame", e); } }

  // ───────────────────────── world: INT3's porch data, the old models stay unloaded ─────────────────────────
  function worldHook() {
    try { var IN = window.PLAN_INTERIORS; if (IN && !IN.off) { IN.porch = IN.porch || {}; var P = porchData(); if (KINDS.indexOf("restaurant") >= 0) IN.porch.restaurant = P.restaurant; if (KINDS.indexOf("clubhouse") >= 0) IN.porch.clubhouse = P.clubhouse; XC.n.porch = { restaurant: P.restaurant.rows.length, clubhouse: P.clubhouse.rows.length }; } } catch (e) { note("porch", e); }
    // these kinds are drawn by this module now: the streamer leaves their stand-ins in place (no full download, no atlas upload)
    if (!ABMODE) { try { var PS = window.PLAN_STREAM; KINDS.forEach(function (k) { var m = MODELS[k]; if (!m || !PS || !PS.st) return; if (PS.st[k] === "proxy" || PS.st[k] === "dormant" || PS.st[k] === "wait") { PS.st[k] = "full"; (XC.n.unstreamed = XC.n.unstreamed || []).push(k); } }); } catch (e) { note("stream", e); } }
  }
  window.PLAN_HOOKS.world.push({ name: "xcWorld", fn: function () { try { worldHook(); } catch (e) { note("world", e); } } });
  window.PLAN_HOOKS.frame.push({ name: "xcFrame", fn: frame });

  // ───────────────────────── A/B and stats ─────────────────────────
  XC.ab = function (on) { try { XC.recs.forEach(function (rec) { var key = rec.kind + ":" + rec.i; if (on) SHELLS.add(key); else SHELLS.delete(key);
        if (!on) { XT.hideRec(rec, true); var M = meshesOf(rec); rng(M.ip, rec.xc.ip, true, rec, "ab_ip"); rng(M.mb, rec.xc.mb, true, rec, "ab_mb"); } else { XT.hideRec(rec, false); var M2 = meshesOf(rec); rng(M2.ip, rec.xc.ip, false, rec, "ab_ip"); rng(M2.mb, rec.xc.mb, false, rec, "ab_mb"); } });
      XC.abOn = !!on; try { updateCulling(true); } catch (e) {} return on ? "new" : "old"; } catch (e) { return String(e); } };
  XC.stats = function () { var o = { kinds: KINDS, recs: XC.recs.length, n: XC.n, errs: XC.errs.slice(0, 8), chunks: {} }; for (var k in CX) { var X = CX[k]; o.chunks[k] = { ip: X.ip.n, mb: X.mb.n }; } return o; };
})();
