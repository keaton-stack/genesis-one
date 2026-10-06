/* plan_avatar.js (R11): character customization.
   Every body gets a clean head: the sculpted hair submesh and the stray hair cards baked into the head are dropped and a fitted
   scalp shell takes their place (skin coloured from the body's own hairline, stubble or a dense hair base in the shader).
   Hairstyles are procedural hair-card grooms grown on that scalp per body (collision with the measured head, ears and shoulders),
   hats are built on the same head field, and everything is skinned to the body's own skeleton.
   Per-body fit data lives in /models/avatar/kit.json (built offline from the bind pose: see HANDOFF_R11_AVATAR.md). */
(function () {
  "use strict";
  var AV = window.PLAN_AVATAR = window.PLAN_AVATAR || {};
  AV.ver = "r11";
  AV.on = !/[?&]r11=0\b/.test(location.search);
  AV.n = { grooms: 0, groomMs: 0, hats: 0, hatMs: 0, dress: 0, mats: 0, evict: 0 };
  var KIT = AV.KIT = AV.KIT || {};
  var TAU = Math.PI * 2;

  // ───────── kit: the head field per body ─────────
  function prepKit(k, bk) {
    var K = { c: new THREE.Vector3(k.c[0], k.c[1], k.c[2]), eyeY: k.eyeY, eyeZ: k.eyeZ, top: k.top, nt: k.nt, np: k.np, ph0: k.ph0, ph1: k.ph1,
      rin: new Float32Array(k.rin.length), rsc: new Float32Array(k.rsc.length), rout: new Float32Array(k.rout.length), hole: new Uint8Array(k.hole), phb: new Float32Array(k.phb), rimc: k.rimc, removed: k.removed, bones: k.bones, sig: k.sig,
      tor: { y0: k.tor.y0, y1: k.tor.y1, ny: k.tor.ny, na: k.tor.na, r: new Float32Array(k.tor.r.length), rmin: new Float32Array((k.tor.rmin || k.tor.r).length), rvest: new Float32Array((k.tor.rvest || k.tor.r).length) } };
    for (var i = 0; i < k.rin.length; i++) { K.rin[i] = k.rin[i] * 1e-4; K.rout[i] = k.rout[i] * 1e-4; K.rsc[i] = k.rsc[i] * 1e-4; }
    for (var j = 0; j < k.tor.r.length; j++) { K.tor.r[j] = k.tor.r[j] * 1e-3; K.tor.rmin[j] = (k.tor.rmin || k.tor.r)[j] * 1e-3; K.tor.rvest[j] = (k.tor.rvest || k.tor.r)[j] * 1e-3; }
    // the hairline: the sculpt's lowest bald elevation per azimuth, smoothed round the head
    var n = K.nt, s = new Float32Array(n), t = new Float32Array(n); for (i = 0; i < n; i++) s[i] = K.phb[i];
    // (the female sculpt's hair hole runs far down the nape: a wide minimum carried that down past the ears and the scalp covered them)
    var mw = bk === "f" ? 1 : 2, mi = bk === "f" ? 1 : 3; for (var it = 0; it < mi; it++) { for (i = 0; i < n; i++) { var m = 1e9; for (var d = -mw; d <= mw; d++) m = Math.min(m, s[(i + d + n) % n]); t[i] = m; } for (i = 0; i < n; i++) s[i] = (t[(i - 1 + n) % n] + 2 * t[i] + t[(i + 1) % n]) / 4; }
    K.phl = s; K.scol = k.scol ? new Float32Array(k.scol) : null; K.eyes = k.eyes; K.ear = k.ear; K.nose = k.nose; K.wrist = k.wrist; K.neck = k.neck; K.earring = k.earring; K.bonesY = k.bonesY; K.collar = k.collar;
    return K;
  }
  AV.load = function () {
    if (AV._lp) return AV._lp;
    AV._lp = fetch("/models/avatar/kit.json?v=" + (window.BUILD || 0)).then(function (r) { return r.json(); }).then(function (j) { for (var b in j) KIT[b] = prepKit(j[b], b); AV.ready = true; }).catch(function (e) { AV.err = String(e); });
    return AV._lp;
  };
  // bilinear lookups on the (azimuth, elevation) grid; azimuth 0 is the face (+z), elevation up is +
  function gridAt(K, arr, th, ph) {
    var u = (th + Math.PI) / TAU * K.nt, v = (ph - K.ph0) / (K.ph1 - K.ph0) * (K.np - 1);
    if (v < 0) v = 0; if (v > K.np - 1) v = K.np - 1; var i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0; var j1 = Math.min(K.np - 1, j0 + 1);
    var a = ((i0 % K.nt) + K.nt) % K.nt, b = (a + 1) % K.nt;
    return (arr[a * K.np + j0] * (1 - fv) + arr[a * K.np + j1] * fv) * (1 - fu) + (arr[b * K.np + j0] * (1 - fv) + arr[b * K.np + j1] * fv) * fu;
  }
  function lineAt(K, arr, th) { var u = (th + Math.PI) / TAU * K.nt, i0 = Math.floor(u), f = u - i0; var a = ((i0 % K.nt) + K.nt) % K.nt; return arr[a] * (1 - f) + arr[(a + 1) % K.nt] * f; }
  AV.rIn = function (K, th, ph) { return gridAt(K, K.rin, th, ph); };
  AV.rOut = function (K, th, ph) { return gridAt(K, K.rout, th, ph); };
  AV.holeAt = function (K, th, ph) { var i = Math.round((th + Math.PI) / TAU * K.nt) % K.nt, j = Math.round((ph - K.ph0) / (K.ph1 - K.ph0) * (K.np - 1)); j = Math.max(0, Math.min(K.np - 1, j)); return K.hole[((i + K.nt) % K.nt) * K.np + j]; };
  AV.hairline = function (K, th) { return lineAt(K, K.phl, th); };
  // spherical coordinates of a bind-space point about the skull centre
  function sph(K, x, y, z, o) { var dx = x - K.c.x, dy = y - K.c.y, dz = z - K.c.z; var r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6; o.r = r; o.th = Math.atan2(dx, dz); o.ph = Math.asin(Math.max(-1, Math.min(1, dy / r))); return o; }
  function fromSph(K, th, ph, r, out) { var cp = Math.cos(ph); out[0] = K.c.x + r * cp * Math.sin(th); out[1] = K.c.y + r * Math.sin(ph); out[2] = K.c.z + r * cp * Math.cos(th); return out; }
  AV.sph = sph; AV.fromSph = fromSph;
  // the torso field (cylindrical radius about the head's vertical axis, per height and azimuth) for long hair on the shoulders
  function torsoR(K, y, th, inner) { var T = K.tor; var A = inner === "vest" ? T.rvest : inner ? T.rmin : T.r; if (y < T.y0 || y > T.y1) return 0; var v = (y - T.y0) / (T.y1 - T.y0) * (T.ny - 1), u = (th + Math.PI) / TAU * T.na; var j0 = Math.floor(v), fv = v - j0, j1 = Math.min(T.ny - 1, j0 + 1), i0 = Math.floor(u), fu = u - i0; var a = ((i0 % T.na) + T.na) % T.na, b = (a + 1) % T.na;
    return (A[j0 * T.na + a] * (1 - fv) + A[j1 * T.na + a] * fv) * (1 - fu) + (A[j0 * T.na + b] * (1 - fv) + A[j1 * T.na + b] * fv) * fu; }
  AV.torsoR = torsoR;

  // ───────── the clean head: body primitives without the stray hair cards ─────────
  var CLEAN = AV.CLEAN = AV.CLEAN || {};
  function cleanGeo(body, name, geo) {
    if (geo.userData && geo.userData.avClean) return geo; var key = body + ":" + name; if (CLEAN[key] && CLEAN[key].src === geo) return CLEAN[key].geo;
    var K = KIT[body], rm = K && K.removed && K.removed[name]; if (!rm || !rm.length || !geo.index) return geo;
    var idx = geo.index.array; if (K.sig && K.sig[name]) { var sg = K.sig[name], sum = 0; for (var q = 0; q < Math.min(200, idx.length); q++) sum += idx[q]; if (sg[0] !== idx.length || sg[1] !== sum) { AV.n.sigMiss = (AV.n.sigMiss || 0) + 1; AV.sigMiss = AV.sigMiss || {}; AV.sigMiss[key] = [idx.length, sum, geo.uuid.slice(0, 8)]; return geo; } }
    var drop = new Uint8Array(idx.length / 3); for (var i = 0; i < rm.length; i++) drop[rm[i]] = 1;
    var keep = new (idx.constructor)(idx.length - rm.length * 3), k = 0; for (var t = 0; t < drop.length; t++) if (!drop[t]) { keep[k++] = idx[t * 3]; keep[k++] = idx[t * 3 + 1]; keep[k++] = idx[t * 3 + 2]; }
    var g = new THREE.BufferGeometry(); for (var a in geo.attributes) g.setAttribute(a, geo.attributes[a]); g.setIndex(new THREE.BufferAttribute(keep, 1)); g.boundingBox = geo.boundingBox; g.boundingSphere = geo.boundingSphere; g.userData.avClean = true;
    if (AV.earFix && name === "skin" && K.ear && geo.attributes.skinWeight && geo.attributes.skinIndex) earsToHead(K, g);   // experimental, off: did not cure the sculpt's ear lobe tether
    CLEAN[key] = { src: geo, geo: g }; return g;
  }
  // the sculpt weights its ears partly to the neck: as the idle turns the head the lobes smear into thin ribbons. Ears follow the head only.
  function earsToHead(K, g) { var P = g.attributes.position, SI = g.attributes.skinIndex.clone(), SW = g.attributes.skinWeight.clone(), E = K.ear, H = K.bones.Head, n = 0;
    for (var i = 0; i < P.count; i++) { var x = Math.abs(P.getX(i)), y = P.getY(i), z = P.getZ(i); if (y > E.y + 0.04 || z < E.z - 0.06 || z > E.z + 0.026) continue; var low = y < E.ylo - 0.004; if (low ? (x < E.x - 0.017 || y < E.ylo - 0.05) : x < E.x - 0.022) continue;   // the lobe and the thin tether under it too (outside the neck)
      var f = low ? Math.max(0, Math.min(1, (x - (E.x - 0.017)) / 0.004)) : Math.max(0, Math.min(1, (x - (E.x - 0.022)) / 0.008)); var w = [SW.getX(i), SW.getY(i), SW.getZ(i), SW.getW(i)], j = [SI.getX(i), SI.getY(i), SI.getZ(i), SI.getW(i)];
      var h = j.indexOf(H); if (h < 0) { h = 0; for (var k = 1; k < 4; k++) if (w[k] < w[h]) h = k; j[h] = H; w[h] = 0; } var sum = 0; for (k = 0; k < 4; k++) { w[k] = w[k] * (1 - f) + (k === h ? f : 0); sum += w[k]; }
      SI.setXYZW(i, j[0], j[1], j[2], j[3]); SW.setXYZW(i, w[0] / sum, w[1] / sum, w[2] / sum, w[3] / sum); n++; }
    g.setAttribute("skinIndex", SI); g.setAttribute("skinWeight", SW); AV.n.earVerts = n; }
  AV.cleanGeo = cleanGeo;

  // ───────── skinning helper: a mesh in bind space, weighted to the head (and the neck / upper spine below the jaw) ─────────
  function skinAttrs(K, geo, longFall) {
    var P = geo.attributes.position, n = P.count, ji = new Uint16Array(n * 4), wt = new Float32Array(n * 4); var H = K.bones.Head, N = K.bones.neck, S2 = K.bones.Spine02;
    var yJaw = K.eyeY - 0.075, ySh = K.eyeY - 0.21;
    for (var i = 0; i < n; i++) { var y = P.getY(i); var f = longFall ? Math.max(0, Math.min(1, (yJaw - y) / (yJaw - ySh))) : 0; f = f * f * (3 - 2 * f);
      ji[i * 4] = H; ji[i * 4 + 1] = N; ji[i * 4 + 2] = S2; ji[i * 4 + 3] = 0; wt[i * 4] = 1 - f * 0.6; wt[i * 4 + 1] = f * 0.45; wt[i * 4 + 2] = f * 0.15; wt[i * 4 + 3] = 0; }
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(ji, 4)); geo.setAttribute("skinWeight", new THREE.BufferAttribute(u8(wt), 4, true)); return geo;
  }
  AV.skinAttrs = skinAttrs;
  function skinned(geo, mat, bodyMesh) { var m = new THREE.SkinnedMesh(geo, mat); m.position.copy(bodyMesh.position); m.quaternion.copy(bodyMesh.quaternion); m.scale.copy(bodyMesh.scale); m.bind(bodyMesh.skeleton, bodyMesh.bindMatrix); m.frustumCulled = false; m.castShadow = bodyMesh.castShadow !== false; m.receiveShadow = true; m.userData.av = true; m.userData.fullGeo = geo; return m; }
  AV.skinned = skinned;

  // ───────── scalp ─────────
  var SCALP = AV.SCALP = AV.SCALP || {};
  AV.SC = { margin: 0.13, feather: 0.09, lift: 0.0007, rows: 26 };
  function scalpGeo(body) {
    if (SCALP[body]) return SCALP[body]; var K = KIT[body]; if (!K) return null; var SC = AV.SC;
    var NT = 128, R = SC.rows, pos = [], uv = [], col = [], aS = [], aS2 = [], ind = []; var o = [0, 0, 0];
    for (var i = 0; i <= NT; i++) { var th = -Math.PI + TAU * i / NT; var phE = AV.hairline(K, th) - SC.margin; var rc = K.rimc[Math.floor((th + Math.PI) / TAU * K.nt) % K.nt];
      for (var r = 0; r <= R; r++) { var f = r / R; var ph = phE + (Math.PI / 2 - phE) * Math.pow(f, 0.8); if (r === R) ph = Math.PI / 2 - 1e-4;
        var rr = gridAt(K, K.rsc, th, ph) + SC.lift; var hl0 = AV.hairline(K, th); if (!AV.holeAt(K, th, ph)) { var wi = Math.max(0, Math.min(1, (hl0 - 0.01 - ph) / 0.06)); rr = rr * (1 - wi) + (AV.rIn(K, th, ph) + SC.lift) * wi; }   // below the hairline the scalp lies on the skin itself (the dilated skull field made shells round the ears)
        fromSph(K, th, ph, rr, o); pos.push(o[0], o[1], o[2]); uv.push(i / NT, f);
        if (K.scol) { var sc0 = scolAt(K, th, ph); col.push(sc0[0], sc0[1], sc0[2]); } else col.push(rc[0], rc[1], rc[2]); var al = Math.max(0, Math.min(1, (ph - phE) / SC.feather)); al = al * al * (3 - 2 * al); if (AV.holeAt(K, th, ph) || AV.holeAt(K, th, ph - 0.03)) al = 1;
        var hAbove = (ph - phE) * rr; aS.push(al, hAbove, ph, th); aS2.push(ph - AV.hairlineOf(K, body, th, {}), 0); } }
    for (i = 0; i < NT; i++) for (r = 0; r < R; r++) { var a = i * (R + 1) + r, b = a + R + 1; ind.push(a, b, a + 1, a + 1, b, b + 1); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setAttribute("aS", new THREE.Float32BufferAttribute(aS, 4)); g.setAttribute("aS2", new THREE.Float32BufferAttribute(aS2, 2)); g.setIndex(ind); g.computeVertexNormals();
    // outward normals at the seam column match (the grid wraps)
    skinAttrs(K, g, false); return (SCALP[body] = g);
  }
  AV.scalpGeo = scalpGeo;
  // the skin colour field (linear), bilinear like the radius grids
  function scolAt(K, th, ph) { var u = (th + Math.PI) / TAU * K.nt, v = (ph - K.ph0) / (K.ph1 - K.ph0) * (K.np - 1); v = Math.max(0, Math.min(K.np - 1, v)); var i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0, j1 = Math.min(K.np - 1, j0 + 1); var a = ((i0 % K.nt) + K.nt) % K.nt, b = (a + 1) % K.nt; var o = [0, 0, 0];
    for (var c = 0; c < 3; c++) { var A = K.scol; o[c] = (A[(a * K.np + j0) * 3 + c] * (1 - fv) + A[(a * K.np + j1) * 3 + c] * fv) * (1 - fu) + (A[(b * K.np + j0) * 3 + c] * (1 - fv) + A[(b * K.np + j1) * 3 + c] * fv) * fu; } return o; }
  // scalp material: skin from the body's own hairline colour (tinted like the body), stubble / shaved hair / a dense base under longer styles
  function SCALP_OBC(u) { return function (sh) {
    for (var k in u) sh.uniforms[k] = u[k];
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 aS; attribute vec2 aS2; varying vec4 vS; varying vec2 vS2;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvS = aS; vS2 = aS2;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uSkin; uniform vec3 uHair; uniform vec4 uDen; uniform vec2 uFade; uniform vec2 uHL; varying vec4 vS; varying vec2 vS2; float avStub;\nfloat avH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }")
      .replace("#include <color_fragment>", "{ vec3 skinC = vColor * (uSkin / vec3(0.91, 0.76, 0.6)); diffuseColor.rgb = skinC;\n" +
        "  float h = vS.y; float dTop = uDen.x; float fadeK = smoothstep(uFade.x, uFade.y, h); float den = mix(uDen.y, dTop, fadeK) * smoothstep(0.0, 0.006, h + 0.004) * smoothstep(uHL.x, uHL.y, vS2.x);\n" +
        "  vec2 sp = vec2(vS.w * 260.0, vS.z * 240.0); vec2 cell = floor(sp); float n1 = avH(cell); vec2 fp = fract(sp) - 0.5; float dotK = smoothstep(0.42, 0.18, length(fp + (vec2(avH(cell + 3.1), avH(cell + 7.7)) - 0.5) * 0.4));\n" +
        "  float aa = clamp(1.0 - length(fwidth(sp)) * 0.9, 0.0, 1.0); float stub = mix(den, step(1.0 - den, n1) * dotK * 1.6, aa * (1.0 - uDen.z));\n" +
        "  vec3 hc = uHair * mix(0.55 + 0.25 * n1, 0.34 + 0.12 * n1, uDen.z); avStub = clamp(stub * uDen.w, 0.0, 1.0); diffuseColor.rgb = mix(diffuseColor.rgb, hc, avStub); diffuseColor.a *= vS.x; }")
      .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.indirectSpecular *= 1.0 - 0.92 * avStub; reflectedLight.directSpecular *= 1.0 - 0.85 * avStub;")   // hair covered scalp: no grazing angle sheen (it read as a pale bald patch at the parting)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, clamp(uDen.x * 1.2, 0.0, 1.0));");
    if (window.PLAN_CHARFX && PLAN_CHARFX.on && PLAN_CHARFX.ext) PLAN_CHARFX.ext(sh, "scalp");   // R16: the character skin model (plan_charfx.js)
  }; }
  var SCALPMAT = AV.SCALPMAT = AV.SCALPMAT || new Map();
  // den: [top density, bottom density, coverage solid (0 dotted stubble, 1 solid base), strength]; fade: heights (m above the edge) of the fade ramp
  AV.scalpMat = function (skin, hair, den, fade, hl) {
    hl = hl || [-0.06, -0.01]; var key = skin + "|" + hair + "|" + den.join(",") + "|" + fade.join(",") + "|" + hl.join(","); var m = SCALPMAT.get(key); if (m) return m;
    var covered = den[0] > 0.5 && den[2] > 0.5; m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: covered ? 0.8 : 0.55, metalness: 0, transparent: true, depthWrite: true, sheen: covered || (window.PLAN_CHARFX && PLAN_CHARFX.on) ? 0.0 : 0.45, sheenColor: new THREE.Color(0xffb09a), sheenRoughness: 0.6 });
    m.userData.u = { uSkin: { value: new THREE.Color("#" + skin) }, uHair: { value: hairCol(hair, 1) }, uDen: { value: new THREE.Vector4(den[0], den[1], den[2], den[3]) }, uFade: { value: new THREE.Vector2(fade[0], fade[1]) }, uHL: { value: new THREE.Vector2(hl[0], hl[1]) } };
    m.onBeforeCompile = SCALP_OBC(m.userData.u); m.name = "avScalp"; m.userData.avShared = true; AV.n.mats++;
    SCALPMAT.set(key, m); return m;
  };
  function hairCol(hex, k) { var c = new THREE.Color("#" + (hex || "1c1512")); return c.multiplyScalar(k || 1); }
  AV.hairCol = hairCol;
  // ───────── the strand atlas: eight 128 px columns of procedural strands (grey albedo, strand id, coverage) ─────────
  // 0 straight  1 wispy  2 wavy  3 curly  4 coily  5 tuft  6 braid  7 loc
  AV.TEX = { STRAIGHT: 0, WISPY: 1, WAVY: 2, CURLY: 3, COILY: 4, TUFT: 5, BRAID: 6, LOC: 7 };
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  AV.rng = rng;
  AV.atlas = function () {
    if (AV._atlas) return AV._atlas; var t0 = performance.now(); var W = 1024, Hh = 1024, CW = 128;
    var ca = document.createElement("canvas"), cc = document.createElement("canvas"); ca.width = cc.width = W; ca.height = cc.height = Hh;
    var xa = ca.getContext("2d"), xc = cc.getContext("2d"); xa.fillStyle = "#000"; xa.fillRect(0, 0, W, Hh); xc.fillStyle = "rgb(150,128,0)"; xc.fillRect(0, 0, W, Hh); xa.lineCap = xc.lineCap = "round";
    var R = rng(911);
    function strand(col, pts, lw0, a0, lum, id, taper) { // pts: [[x,y],...] in column space, y 0 = root
      var ox = col * CW; for (var i = 1; i < pts.length; i++) { var f = i / (pts.length - 1); var lw = lw0 * (1 - (taper === undefined ? 0.75 : taper) * Math.pow(f, 1.6)); var al = a0 * (1 - 0.5 * Math.pow(f, 2));
        xa.strokeStyle = "rgba(255,255,255," + al.toFixed(3) + ")"; xc.strokeStyle = "rgb(" + Math.round(lum * 255) + "," + Math.round(id * 255) + ",0)"; xa.lineWidth = xc.lineWidth = Math.max(0.35, lw);
        for (var q = 0; q < 2; q++) { var x = q ? xc : xa; x.beginPath(); x.moveTo(ox + pts[i - 1][0], pts[i - 1][1]); x.lineTo(ox + pts[i][0], pts[i][1]); x.stroke(); } } }
    function rootFill(col, h, a) { var g = xa.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(255,255,255," + a + ")"); g.addColorStop(1, "rgba(255,255,255,0)"); xa.fillStyle = g; xa.fillRect(col * CW + 6, 0, CW - 12, h); }
    function wave(col, n, amp, freq, lwA, lwB, lenA, conv, a0, phaseSpread, freq2, amp2) {
      for (var k = 0; k < n; k++) { var x0 = CW / 2 + (R() + R() - 1) * (CW / 2 - 5), len = Hh * (lenA + (1 - lenA) * R()), ph = R() * phaseSpread, lw = lwA + R() * (lwB - lwA), lum = 0.72 + R() * 0.28, id = R(); var pts = [], steps = Math.max(24, Math.round(len / 12)), sway = (R() - 0.5) * 10;
        for (var i = 0; i <= steps; i++) { var f = i / steps, y = f * len; var x = x0 + sway * f + amp * Math.sin(f * len / Hh * TAU * freq + ph) + (amp2 ? amp2 * Math.sin(f * len / Hh * TAU * freq2 + ph * 2.3) : 0); x = x + (CW / 2 - x) * conv * f; pts.push([x, y]); }
        strand(col, pts, lw, a0, lum, id); } }
    // 0 straight: dense clump, tips converge a little
    wave(0, 120, 1.5, 1.2, 1.1, 2.4, 0.7, 0.22, 0.95, 6.28, 0, 0);
    // 1 wispy: sparse fine strands for the outer layer
    wave(1, 46, 3, 1.4, 0.7, 1.4, 0.45, 0.1, 0.85, 6.28, 0, 0);
    // 2 wavy: one wave train shared by the clump
    wave(2, 110, 13, 3.2, 1.1, 2.3, 0.72, 0.2, 0.95, 0.7, 0, 0);
    // 3 curly: tight ringlets
    rootFill(3, 60, 0.3); wave(3, 80, 17, 9.5, 1.6, 2.6, 0.75, 0.15, 0.95, 1.2, 4, 6);
    // 4 coily: dense kinky texture, nearly solid in the middle
    { var g4 = xa.createLinearGradient(0, 0, 0, Hh); g4.addColorStop(0, "rgba(255,255,255,0.75)"); g4.addColorStop(0.75, "rgba(255,255,255,0.55)"); g4.addColorStop(1, "rgba(255,255,255,0)"); xa.fillStyle = g4; xa.fillRect(4 * CW + 18, 0, CW - 36, Hh); }
    wave(4, 150, 5, 38, 1.2, 2.2, 0.7, 0.0, 0.9, 6.28, 7, 9);
    // 5 tuft: wide root converging to a point
    rootFill(5, 140, 0.6); for (var k = 0; k < 75; k++) { var x0 = 4 + R() * (CW - 8), tip = CW / 2 + (R() - 0.5) * 30, len = Hh * (0.75 + 0.25 * R()), pts = []; for (var i = 0; i <= 30; i++) { var f = i / 30; pts.push([x0 + (tip - x0) * Math.pow(f, 1.3) + Math.sin(f * 5 + k) * 1.5, f * len]); } strand(5, pts, 1.6 + R() * 1.6, 0.95, 0.45 + R() * 0.55, R(), 0.85); }
    // 6 braid: interlocking lobes, opaque core
    { var ox = 6 * CW; for (var y = -60; y < Hh + 60; y += 58) for (var sd = -1; sd <= 1; sd += 2) { var cy = y + (sd > 0 ? 29 : 0); for (var q = 0; q < 2; q++) { var x = q ? xc : xa; x.save(); x.translate(ox + CW / 2 + sd * 16, cy); x.rotate(sd * 0.62); x.beginPath(); x.ellipse(0, 0, 25, 44, 0, 0, TAU); if (q) { x.fillStyle = "rgb(" + (150 + sd * 18) + ",120,0)"; x.fill(); } else { x.fillStyle = "#fff"; x.fill(); } x.restore(); } }
      for (var k2 = 0; k2 < 260; k2++) { var yy = R() * Hh, sd2 = R() < 0.5 ? -1 : 1, xx = CW / 2 + sd2 * 16 + (R() - 0.5) * 30; var p2 = []; for (var i2 = 0; i2 <= 6; i2++) { var f2 = i2 / 6; p2.push([xx + Math.cos(sd2 * 0.62 + 1.57) * 30 * (f2 - 0.5) * 2, yy + Math.sin(sd2 * 0.62 + 1.57) * 30 * (f2 - 0.5) * 2]); } strand(6, p2, 1.2, 0.0001, 0.3 + R() * 0.7, R(), 0.2); } }
    // 7 loc: twisted rope with a fuzzy edge
    { xa.fillStyle = "#fff"; xa.fillRect(7 * CW + 14, 0, CW - 28, Hh); for (var y3 = -40; y3 < Hh + 40; y3 += 9) { xc.strokeStyle = "rgb(" + Math.round(110 + R() * 90) + "," + Math.round(R() * 255) + ",0)"; xc.lineWidth = 4 + R() * 4; xc.beginPath(); xc.moveTo(7 * CW + 10, y3); xc.lineTo(7 * CW + CW - 10, y3 + 34); xc.stroke(); }
      for (var k3 = 0; k3 < 160; k3++) { var x3 = R() < 0.5 ? 10 + R() * 10 : CW - 20 + R() * 10, y4 = R() * Hh; strand(7, [[x3, y4], [x3 + (R() - 0.5) * 12, y4 + 20 + R() * 30]], 1, 0.7, 0.5 + R() * 0.4, R()); } }
    var A = xa.getImageData(0, 0, W, Hh).data, Cc = xc.getImageData(0, 0, W, Hh).data, out = new Uint8Array(W * Hh * 4);
    for (var i5 = 0; i5 < W * Hh; i5++) { var yy5 = (i5 / W) | 0, cx5 = ((i5 % W) / CW) | 0; var fade = cx5 < 6 ? Math.min(1, yy5 / 40) : 1; out[i5 * 4] = Cc[i5 * 4]; out[i5 * 4 + 1] = Cc[i5 * 4 + 1]; out[i5 * 4 + 2] = 0; out[i5 * 4 + 3] = Math.round(A[i5 * 4] * fade); }
    var tex = new THREE.DataTexture(out, W, Hh, THREE.RGBAFormat); tex.colorSpace = THREE.NoColorSpace; tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.anisotropy = 8; tex.needsUpdate = true; tex.userData.avShared = true;
    AV.n.atlasMs = Math.round(performance.now() - t0); return (AV._atlas = tex);
  };

  // ───────── hair material: physically based base with a Kajiya-Kay style dual highlight along the strand ─────────
  function HAIR_OBC(u) { return function (sh) {
    for (var k in u) sh.uniforms[k] = u[k];
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec3 aT; attribute vec4 aH; varying vec3 vAvT; varying vec4 vAvH; varying vec3 vAvP;")
      .replace("#include <skinnormal_vertex>", "#include <skinnormal_vertex>\nvec3 avT0 = aT;\n#ifdef USE_SKINNING\navT0 = (skinMatrix * vec4(aT, 0.0)).xyz;\n#endif\nvAvT = normalize(normalMatrix * avT0); vAvH = aH; vAvP = position;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uRoot; uniform vec3 uTip; uniform vec4 uSpec; uniform vec4 uShade; uniform float uVar; uniform float uSoft; varying vec3 vAvT; varying vec4 vAvH; varying vec3 vAvP; vec3 avT; float avNz; float avId; float avSm;\nfloat avH3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }\nfloat avVN3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(avH3(i), avH3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(avH3(i + vec3(0.0, 1.0, 0.0)), avH3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y), mix(mix(avH3(i + vec3(0.0, 0.0, 1.0)), avH3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(avH3(i + vec3(0.0, 1.0, 1.0)), avH3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z); }\nfloat avHs(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat avVN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(avHs(i), avHs(i + vec2(1.0, 0.0)), f.x), mix(avHs(i + vec2(0.0, 1.0)), avHs(i + vec2(1.0, 1.0)), f.x), f.y); }")
      .replace("#include <lights_physical_pars_fragment>", "#include <lights_physical_pars_fragment>\n" +
        "void RE_Direct_Hair(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {\n" +
        "  float dotNL = dot(geometryNormal, directLight.direction); float wrapK = uShade.z; float diffT = clamp((dotNL + wrapK) / (1.0 + wrapK), 0.0, 1.0);\n#ifdef AV_TRANS\n  diffT += 0.1 * (1.0 - diffT);\n#endif\n" +
        "  reflectedLight.directDiffuse += diffT * directLight.color * BRDF_Lambert(material.diffuseColor);\n" +
        "  vec3 avHv = directLight.direction + geometryViewDir; vec3 H = avHv * inversesqrt(max(dot(avHv, avHv), 1e-8)); float avSh = (avId - 0.5) * 0.22; vec3 t1 = avT + geometryNormal * (uSpec.z + avSh); t1 *= inversesqrt(max(dot(t1, t1), 1e-8)); vec3 t2 = avT + geometryNormal * (uSpec.w + avSh * 0.7); t2 *= inversesqrt(max(dot(t2, t2), 1e-8));\n" +
        "  float a1 = clamp(dot(t1, H), -1.0, 1.0), a2 = clamp(dot(t2, H), -1.0, 1.0); float s1 = pow(saturate(1.0 - a1 * a1) + 1e-6, 0.5 * uShade.x); float s2 = pow(saturate(1.0 - a2 * a2) + 1e-6, 0.5 * uShade.y);\n" +
        "  float vis = smoothstep(-0.15, 0.3, dotNL);\n" +
        "  reflectedLight.directSpecular += directLight.color * vis * avSm * (s1 * uSpec.x + s2 * uSpec.y * avNz * material.diffuseColor * 3.0);\n#ifdef AV_TRANS\n  float avTr = pow(saturate(dot(-directLight.direction, geometryViewDir)) + 1e-6, 6.0) * saturate(0.35 - dotNL * 0.65); vec3 avDc = max(material.diffuseColor, vec3(0.0)); reflectedLight.directDiffuse += directLight.color * avTr * sqrt(avDc) * avDc * 1.6;\n#endif\n}\n#undef RE_Direct\n#define RE_Direct RE_Direct_Hair\n")
      .replace("#include <map_fragment>", "vec4 avTx = texture2D(map, vMapUv);\n" +
        "if (vAvH.y < 0.003) { vec3 q = vAvP * 470.0; float n = avVN3(q) * 0.58 + avVN3(q * 2.1 + 7.1) * 0.3 + avVN3(q * 4.2 + 3.3) * 0.12; float cu = 0.5 + 0.5 * sin((n * 6.0 + (q.x + q.y + q.z) * 0.33) * 3.1416); float v = n * 0.7 + cu * 0.4; float px = length(fwidth(q)); float thr = (vAvH.x * vAvH.x * 0.66 + 0.03) * (1.0 - smoothstep(0.45, 1.1, px)); float rim = 1.0 - smoothstep(0.0, 0.16, v - thr); avTx = vec4(0.6 + 0.32 * cu + 0.38 * rim * vAvH.x, n, 0.0, step(thr, v)); }\n" +
        "{ float lod = log2(max(1.0, max(length(dFdx(vMapUv * 1024.0)), length(dFdy(vMapUv * 1024.0))))); float a = avTx.a * (1.0 + lod * 0.32);\n" +
        "  vec3 base = mix(uRoot, uTip, smoothstep(0.0, 1.0, vAvH.x)) * (1.0 + (vAvH.w - 0.5) * 2.0 * uVar); float ao = mix(uShade.w, 1.0, vAvH.z);\n" +
        "  diffuseColor.rgb = base * (0.42 + 0.6 * avTx.r) * ao; diffuseColor.a = uSoft > 0.5 ? (a >= 0.5 ? 0.0 : a * 1.6) : a; avNz = 0.8 + avTx.g * 0.4; avId = avTx.g; avSm = mix(0.18, 1.0, smoothstep(0.62, 0.97, avTx.r)); }")
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = vNormal * inversesqrt(max(dot(vNormal, vNormal), 1e-8)); avT = vAvT * inversesqrt(max(dot(vAvT, vAvT), 1e-8)); if (dot(avT, avT) < 0.25) { vec3 avC = cross(normal, abs(normal.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)); avT = avC * inversesqrt(max(dot(avC, avC), 1e-8)); }")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = 0.6;")
      .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.indirectSpecular *= 0.22 * avSm;\n#ifdef AV_TRANS\n{ vec3 avE = max(irradiance + iblIrradiance, vec3(0.0)) * RECIPROCAL_PI; vec3 avDn = max(material.diffuseColor, vec3(0.0)); vec3 avTn = avDn / max(max(avDn.r, max(avDn.g, avDn.b)), 1e-4);\n  float avLum = dot(avDn, vec3(0.3, 0.59, 0.11)); reflectedLight.indirectDiffuse *= min(2.0, max(1.0, 0.6 / max(avLum, 1e-3))); reflectedLight.indirectSpecular += avE * (0.02 * (0.4 + 0.6 * avSm) * avNz) * mix(vec3(1.0), avTn, 0.7); }\n#endif");   // flat cards at grazing angles mirrored the sky as a flat sheet: keep a little image based specular, broken up by the strands
  }; }
  AV.HAIR_OBC = HAIR_OBC;
  AV.hairSoft = function (hex, style) { var S = Object.assign({}, style || {}, { soft: true }); var m = AV.hairMat(hex, S); return m; };
  var HAIRMAT = AV.HAIRMAT = AV.HAIRMAT || new Map();
  // spec: [primary, secondary, shift1, shift2]; shade: [exp1, exp2, wrap, root occlusion]
  AV.hairMat = function (hex, style) {
    var S = style || {}; var key = hex + "|" + (S.gloss || 1) + "|" + (S.tipK || 1) + "|" + (S.var || 0.035) + "|" + (S.warm || 0) + "|" + (S.soft ? 1 : 0);
    var m = HAIRMAT.get(key); if (m) return m;
    var base = hairCol(hex); if (S.warm) base.lerp(hairCol("2a1b12"), S.warm); var lum = 0.3 * base.r + 0.59 * base.g + 0.11 * base.b;
    base.multiplyScalar(window.PLAN_CHARFX && PLAN_CHARFX.on ? 0.5 : 0.43); var root = base.clone().multiplyScalar(0.55), tip = base.clone().multiplyScalar(1.05 + 0.2 * (1 - Math.min(1, lum * 3)) * (S.tipK || 1)); tip.lerp(new THREE.Color(1, 0.92, 0.8).multiplyScalar(Math.max(tip.r, tip.g, tip.b)), 0.08);
    var gl = S.gloss || 1;
    m = new THREE.MeshStandardMaterial({ map: AV.atlas(), color: 0xffffff, roughness: 0.6, metalness: 0, side: THREE.DoubleSide, alphaTest: S.soft ? 0.06 : 0.5, envMapIntensity: 0.35 }); if (S.soft) { m.transparent = true; m.depthWrite = false; }
    m.userData.u = { uRoot: { value: root }, uTip: { value: tip }, uSpec: { value: new THREE.Vector4(0.026 * gl, 0.045 * gl, -0.06, 0.1) }, uShade: { value: new THREE.Vector4(64, 20, 0.35, 0.7) }, uVar: { value: S.var || 0.035 }, uSoft: { value: S.soft ? 1 : 0 } };
    if (window.PLAN_CHARFX && PLAN_CHARFX.on) m.defines = Object.assign({}, m.defines || {}, { AV_TRANS: 1 });   // R16: back-lit transmission
    m.onBeforeCompile = HAIR_OBC(m.userData.u); m.name = "avHair"; m.userData.avShared = true; AV.n.mats++;
    HAIRMAT.set(key, m); return m;
  };

  // ───────── grooms: hair cards grown on the scalp of each body ─────────
  // A style is a set of layers of strands. Each strand starts on the scalp above the style's hairline, leaves along a flow field
  // (combed back, parted, forward, radial from the crown, up), bends under gravity, curls, and is kept outside the measured head,
  // the ears and the shoulders. Each strand becomes a tapered card lying on the hair surface. Under a hat the strands are pressed to
  // the scalp inside the hat and only what leaves the hat's edge is built ("hat hair").
  var V3 = function (x, y, z) { return [x || 0, y || 0, z || 0]; };
  function vadd(a, b, k) { return [a[0] + b[0] * (k === undefined ? 1 : k), a[1] + b[1] * (k === undefined ? 1 : k), a[2] + b[2] * (k === undefined ? 1 : k)]; }
  function vsub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vcross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function vlen(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function vnorm(a) { var l = vlen(a) || 1e-9; return [a[0] / l, a[1] / l, a[2] / l]; }
  function vmix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function proj(v, n) { var d = vdot(v, n); return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d]; }
  function rotAxis(v, ax, a) { var c = Math.cos(a), s = Math.sin(a), d = vdot(ax, v), cr = vcross(ax, v); return [v[0] * c + cr[0] * s + ax[0] * d * (1 - c), v[1] * c + cr[1] * s + ax[1] * d * (1 - c), v[2] * c + cr[2] * s + ax[2] * d * (1 - c)]; }
  AV.vec = { add: vadd, sub: vsub, dot: vdot, cross: vcross, len: vlen, norm: vnorm, mix: vmix, proj: proj, rot: rotAxis };
  function sstep(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  var _s = { r: 0, th: 0, ph: 0 }, _o = [0, 0, 0];
  // a point on the head surface (the skull with the hole filled) and its outward normal
  function surf(K, th, ph, lift) { var r = gridAt(K, K.rsc, th, ph) + (lift || 0); fromSph(K, th, ph, r, _o); return [_o[0], _o[1], _o[2]]; }
  function surfN(K, th, ph) { var e = 0.02; var a = surf(K, th - e, ph), b = surf(K, th + e, ph), c = surf(K, th, ph - e), d = surf(K, th, ph + e); var n = vnorm(vcross(vsub(b, a), vsub(d, c))); var rad = vnorm(vsub(surf(K, th, ph), [K.c.x, K.c.y, K.c.z])); if (vdot(n, rad) < 0) n = [-n[0], -n[1], -n[2]]; if (Math.abs(ph) > 1.45) n = rad; return n; }
  AV.surf = surf; AV.surfN = surfN;
  // the natural hairline of a style: the sculpt's own (male) or a drawn one (the female sculpt's hair hid her ears and nape)
  var FHL = [[0, 0.52], [25, 0.46], [45, 0.2], [62, -0.02], [80, -0.14], [100, -0.22], [125, -0.36], [150, -0.48], [180, -0.54]];
  function hairlineOf(K, body, th, S) {
    var d = Math.abs(th) * 180 / Math.PI, base;
    if (body === "f") { base = FHL[FHL.length - 1][1]; for (var i = 1; i < FHL.length; i++) if (d <= FHL[i][0]) { var t = (d - FHL[i - 1][0]) / (FHL[i][0] - FHL[i - 1][0]); base = FHL[i - 1][1] + (FHL[i][1] - FHL[i - 1][1]) * t; break; } base = Math.max(base, AV.hairline(K, th) - 0.03); }
    else base = AV.hairline(K, th) - 0.025;
    var fr = Math.max(0, Math.cos(th)); return base + (S.hlFront || 0) * fr * fr + (S.hlAll || 0);
  }
  AV.hairlineOf = hairlineOf;
  // region weights of a root: front, top, side, back, nape
  function regionLen(L, th, ph) {
    var wT = sstep(0.7, 1.2, ph), c = Math.cos(th), s = Math.sin(th); var wF = Math.max(0, c) * Math.max(0, c) * (1 - wT), wB = Math.max(0, -c) * Math.max(0, -c) * (1 - wT), wS = s * s * (1 - wT);
    var nape = sstep(0.15, -0.35, ph) * Math.max(0, -c); var back = L.back * (1 - nape) + (L.nape !== undefined ? L.nape : L.back) * nape;
    var side = L.side; if (L.sideLow !== undefined) side = side + (L.sideLow - side) * sstep(0.3, -0.1, ph);
    return (L.front * wF + L.top * wT + side * wS + back * wB) / Math.max(1e-6, wF + wT + wS + wB);
  }
  // the direction a strand leaves its root, in the tangent plane (plus lift along the normal)
  function flowDir(K, S, p, n, th, ph) {
    var f = S.flow, d;
    if (f === "back") d = proj([0, 0.25, -1], n);
    else if (f === "forward") { var top = sstep(0.55, 0.95, ph); d = vmix(proj([0, -1, 0.15], n), proj([0, 0.1, 1], n), top); }
    else if (f === "up") d = vadd(n, proj([0, 0.3, 0.6], n), 0.35);
    else if (f === "part") { var px = S.part || 0.025; var sgn = p[0] > px ? 1 : -1; var side = proj([sgn, -0.15, -0.25], n); var top = sstep(0.5, 1.0, ph); var dn = proj([0, -1, -0.2], n); d = vmix(dn, side, top); if (S.sweep && p[2] > K.c.z + 0.02 && ph > 0.55) d = vmix(d, proj([sgn > 0 ? 1 : -1, -0.2, 0.35], n), S.sweep); }
    else if (f === "center") { var sg = p[0] >= 0 ? 1 : -1; var fr = Math.max(0, Math.cos(th)); var side = proj([sg, -0.35 - 0.3 * (1 - fr), -0.25 - 0.5 * (1 - fr)], n); d = vmix(proj([0, -1, -0.2], n), side, sstep(0.55, 1.15, ph) * (0.35 + 0.65 * fr)); }
    else if (f === "to") { d = proj(vsub(S._to, p), n); }
    else { // crown: away from the whorl at the back of the crown, then down
      var w = surf(K, Math.PI, 1.15, 0); d = proj(vsub(p, w), n); if (vlen(d) < 1e-4) d = proj([0, 0, -1], n); d = vmix(vnorm(d), vnorm(proj([0, -1, 0], n)), S.down || 0.35); }
    d = vnorm(d); return vnorm(vadd(vmult(d, 1 - (S.lift || 0)), n, (S.lift || 0)));
  }
  function vmult(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  // keep a point outside the head (the outer field includes the ears), the shoulders and a hat's inside
  function collide(K, p, clr, hat, out) {
    sph(K, p[0], p[1], p[2], _s); var hid = false;
    var rmin = gridAt(K, K.rout, _s.th, _s.ph) + clr; if (_s.ph < -0.25) rmin = gridAt(K, K.rsc, _s.th, _s.ph) + clr; // below the jaw only the neck and skull field (ears are higher)
    if (hat && hat.band && !hat.keepTop) { var bph = hat.band(_s.th); if (_s.ph < bph + 0.02 && _s.ph > bph - 0.3) { var rhb = hat.rin(_s.th, bph + 0.025) - 0.004, kb = sstep(bph - 0.3, bph + 0.02, _s.ph); if (rhb > rmin) rmin += (rhb - rmin) * kb; } }   // hair leaving a hat fills the gap under its edge (no cut strand ends between the band and the head)
    var r = _s.r; if (r < rmin) r = rmin;
    if (hat && hat.covers(_s.th, _s.ph)) { var rh = hat.rin(_s.th, _s.ph) - 0.0065; /* well clear of the crown: flat cards on a curved crown poked through near the band */ if (r > rh) r = Math.max(rmin * 0 + gridAt(K, K.rsc, _s.th, _s.ph) + 0.0015, rh); hid = true; }
    if (r !== _s.r) { fromSph(K, _s.th, _s.ph, r, out); } else { out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; }
    // keep the face clear: strands that fall in front of it part to either side (curtains)
    if (out[1] < K.eyeY + 0.03 && out[1] > K.eyeY - 0.16 && out[2] > K.c.z + 0.015) { var hw = (K.faceW || 0.066) - 0.16 * Math.max(0, K.eyeY - 0.03 - out[1]) + clr; if (Math.abs(out[0]) < hw) out[0] = (out[0] >= 0 ? 1 : -1) * hw; }
    if (out[1] < K.eyeY - 0.07) { var dz = out[2] - K.c.z, cyl = Math.hypot(out[0], dz); var az0 = Math.atan2(out[0], dz); var tr = torsoR(K, out[1], az0) + clr + 0.014 + 0.012 * Math.max(0, -Math.cos(az0)) + 0.01 * Math.abs(Math.sin(az0));   /* the idle lifts the shoulders: long hair sits off them */ if (tr > 0.02 && cyl < tr) { var k = tr / (cyl || 1e-6); out[0] *= k; out[2] = K.c.z + dz * k; } }
    return hid;
  }
  AV.collide = collide;
  // grow one strand: returns {P: points, D: directions, H: hidden flags}
  function growStrand(K, S, Ly, root, n, th, ph, rnd, hat) {
    var L = Ly.len * (1 + (rnd() - 0.5) * (S.lenVar !== undefined ? S.lenVar : 0.25)); var nseg = Math.max(3, Math.min(Ly.seg || S.seg || 10, Math.ceil(L / 0.012)));
    var seg = L / nseg, clr = Ly.clr; var d = flowDir(K, S, root, n, th, ph); var jit = S.jitter !== undefined ? S.jitter : 0.18; d = vnorm(vadd(d, [(rnd() - 0.5) * jit, (rnd() - 0.5) * jit, (rnd() - 0.5) * jit]));
    var P = [root.slice()], D = [d], Hd = [hat ? collide(K, root, clr, hat, _o) : false], p = root.slice(); var hug = Ly.hug !== undefined ? Ly.hug : S.hug;
    var co = !!S.coherent; var curlA = (S.curl ? S.curl[0] : 0) * (co ? 0.85 + 0.3 * rnd() : 0.7 + 0.6 * rnd()), curlF = S.curl ? S.curl[1] * (co ? 0.95 + 0.1 * rnd() : 0.85 + 0.3 * rnd()) : 0, curlPh = co ? th * 2.0 + ph * 3.0 + rnd() * 0.6 : rnd() * TAU; var b1 = co ? vnorm(vcross(n, [0, 1, 0.001])) : null;
    for (var i = 1; i <= nseg; i++) { var t = i / nseg; var g = (S.grav || 0) * (Ly.gravK || 1) * Math.min(1, t * 1.6 + 0.2);
      if (S.flow === "to" && S._to) { var to = vsub(S._to, p); var dl = vlen(to); if (dl < 0.01) { P.length = i; break; } d = vnorm(vmix(d, vnorm(to), 0.5)); }
      else d = vnorm(vadd(vmult(d, 1), [0, -1, 0], g * 0.55));
      var q = vadd(p, d, seg); var hid = collide(K, q, clr, hat, _o); q = [_o[0], _o[1], _o[2]];
      if (hug !== undefined && hug !== null) { sph(K, q[0], q[1], q[2], _s); if (_s.ph > -0.35) { var rr = gridAt(K, K.rout, _s.th, _s.ph) + clr + hug; if (_s.r > rr) { fromSph(K, _s.th, _s.ph, _s.r + (rr - _s.r) * 0.8, _o); q = [_o[0], _o[1], _o[2]]; } } }
      if (S.tipCurl && t > 1 - S.tipCurl[0]) { var inw = vnorm(vsub([K.c.x, q[1], K.c.z], q)); q = vadd(q, inw, S.tipCurl[1] * seg * (t - 1 + S.tipCurl[0]) / S.tipCurl[0]); }
      if (S.floorDh !== undefined && P.length >= 3) { sph(K, q[0], q[1], q[2], _s); if (Math.cos(_s.th) < 0.2 && _s.ph < AV.hairline(K, _s.th) - S.floorDh) break; }   // short styles end at the nape hairline (no tails on the neck)
      d = vnorm(vsub(q, p)); p = q; P.push(p); D.push(d); Hd.push(hid); }
    if (curlA > 0) { // helical offset about the core path
      for (var j = 1; j < P.length; j++) { var dj = D[j]; if (!b1) b1 = vnorm(vcross(dj, Math.abs(dj[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])); b1 = vnorm(proj(b1, dj)); var b2 = vcross(dj, b1); var s = j * seg * curlF * TAU + curlPh, a = curlA * Math.min(1, j / 2.5); P[j] = vadd(vadd(P[j], b1, Math.cos(s) * a), b2, Math.sin(s) * a); }
      for (j = 1; j < P.length; j++) { collide(K, P[j], clr * 0.7, hat, _o); P[j] = [_o[0], _o[1], _o[2]]; }
      for (j = 1; j < P.length; j++) D[j] = vnorm(vsub(P[j], P[j - 1])); D[0] = D[1] || D[0]; }
    return { P: P, D: D, H: Hd, L: L };
  }
  // geometry accumulator for cards and tubes
  function Acc() { this.pos = []; this.nrm = []; this.uv = []; this.t = []; this.h = []; this.ind = []; }
  Acc.prototype.v = function (p, n, u, v, t, h) { this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.uv.push(u, v); this.t.push(t[0], t[1], t[2]); this.h.push(h[0], h[1], h[2], h[3]); return this.pos.length / 3 - 1; };
  function i8(a) { var o = new Int8Array(a.length); for (var i = 0; i < a.length; i++) o[i] = Math.max(-127, Math.min(127, Math.round(a[i] * 127))); return o; }
  function u8(a) { var o = new Uint8Array(a.length); for (var i = 0; i < a.length; i++) o[i] = Math.max(0, Math.min(255, Math.round(a[i] * 255))); return o; }
  function u16(a) { var o = new Uint16Array(a.length); for (var i = 0; i < a.length; i++) o[i] = Math.max(0, Math.min(65535, Math.round(a[i] * 65535))); return o; }
  AV.pack = { i8: i8, u8: u8, u16: u16 };
  // the same, a step at a time (each attribute of a large groom costs a few milliseconds; the job runner gives each its own slice)
  Acc.prototype.geoGen = function* () { var g = new THREE.BufferGeometry(), A = this; g.setAttribute("position", new THREE.Float32BufferAttribute(A.pos, 3)); yield 0; g.setAttribute("normal", new THREE.BufferAttribute(i8(A.nrm), 3, true)); yield 0;
    var uv = new Float32Array(A.uv.length); for (var i = 0; i < uv.length; i++) uv[i] = Math.max(0, Math.min(1, A.uv[i])); g.setAttribute("uv", new THREE.BufferAttribute(u16(uv), 2, true)); yield 0; g.setAttribute("aT", new THREE.BufferAttribute(i8(A.t), 3, true)); yield 0;
    g.setAttribute("aH", new THREE.BufferAttribute(u8(A.h), 4, true)); yield 0; g.setIndex(A.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(A.ind, 1) : new THREE.Uint16BufferAttribute(A.ind, 1)); return g; };
  Acc.prototype.geo = function () { var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(i8(this.nrm), 3, true)); g.setAttribute("uv", new THREE.BufferAttribute(u16(this.uv.map(function (x) { return Math.max(0, Math.min(1, x)); })), 2, true)); g.setAttribute("aT", new THREE.BufferAttribute(i8(this.t), 3, true)); g.setAttribute("aH", new THREE.BufferAttribute(u8(this.h), 4, true)); g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.ind, 1) : new THREE.Uint16BufferAttribute(this.ind, 1)); return g; };
  // a tapered card along a strand: lies on the hair surface (its width across the strand, its normal outward)
  function card(acc, K, st, w0, tex, ao, rnd, twist, taper, normalFrom) {
    var P = st.P, D = st.D, H = st.H, n = P.length; if (n < 2) return; var col = tex * 0.125, span = 0.125 * (0.75 + 0.25 * rnd()), u0 = col + (0.125 - span) * rnd() * 0.98 + 0.0012, u1 = u0 + span - 0.0024; var vr = 0.01 + 0.99 * rnd(), cv = rnd(), tw = (rnd() - 0.5) * (twist || 0.5);
    var prev = -1, base = -1; var cen = [K.c.x, K.c.y, K.c.z];
    for (var i = 0; i < n; i++) { var t = i / (n - 1); var p = P[i], d = D[i];
      var out = normalFrom ? normalFrom(p, i) : vnorm(vsub(p, cen)); if (p[1] < K.eyeY - 0.1) out = vnorm(vmix(out, vnorm([p[0], 0, p[2] - K.c.z]), sstep(K.eyeY - 0.1, K.eyeY - 0.2, p[1])));
      var sd = vnorm(vcross(d, out)); if (tw) sd = rotAxis(sd, d, tw * t); var nn = vnorm(vcross(sd, d)); if (vdot(nn, out) < 0) nn = [-nn[0], -nn[1], -nn[2]];
      var w = w0 * (1 - (taper === undefined ? 0.55 : taper) * Math.pow(t, 1.5)) * 0.5; var aoV = ao * (0.55 + 0.45 * sstep(0, 0.5, t));
      var hidden = H[i] && (i === 0 || H[i - 1]) && (i === n - 1 || H[i + 1]);
      if (hidden) { prev = -1; continue; }
      var sn = vnorm(vmix(out, nn, 0.25)); var a = acc.v(vadd(p, sd, -w), sn, u0, t, d, [t, vr, aoV, cv]), b = acc.v(vadd(p, sd, w), sn, u1, t, d, [t, vr, aoV, cv]);
      if (prev >= 0) acc.ind.push(prev, a, prev + 1, prev + 1, a, b); prev = a; }
  }
  // a tube (locs, braids, ponytail core): ring of 6 around the path
  function tube(acc, K, P, D, r0, r1, tex, ao, rnd, sides, bump, twist) {
    sides = sides || 6; var n = P.length; if (n < 2) return; var col = tex * 0.125 + 0.022, cw = 0.081; var b1 = vnorm(vcross(D[0], Math.abs(D[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])); var start = acc.pos.length / 3; var vr = 0.01 + 0.99 * rnd(), cv = rnd(), vlenAcc = 0;
    for (var i = 0; i < n; i++) { var t = i / (n - 1), d = D[i]; b1 = vnorm(proj(b1, d)); var b2 = vcross(d, b1); var r = (r0 + (r1 - r0) * t) * (i === n - 1 ? 0.25 : i === n - 2 ? 0.8 : 1); if (i > 0) vlenAcc += vlen(vsub(P[i], P[i - 1])); if (bump) r *= bump(t, vlenAcc); var tw = twist ? twist * vlenAcc / 0.1 : 0;
      for (var k = 0; k <= sides; k++) { var a = k / sides * TAU + tw; var nr = vadd(vmult(b1, Math.cos(a)), b2, Math.sin(a)); acc.v(vadd(P[i], nr, r), nr, col + cw * k / sides, Math.min(1, vlenAcc / 0.5), d, [t, vr, ao * (0.7 + 0.3 * t), cv]); } }
    for (i = 0; i < n - 1; i++) for (var k2 = 0; k2 < sides; k2++) { var a0 = start + i * (sides + 1) + k2, b0 = a0 + sides + 1; acc.ind.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
  }
  AV.tube = tube; AV.card = card; AV.Acc = Acc;
  // roots: an even (Halton) spread over the scalp above the style's hairline
  function roots(K, body, S, n, seed, filter) {
    var out = [], rnd = rng(seed); var i = 0, tries = 0; var lo = -0.75;
    while (out.length < n && tries < n * 12) { tries++; i++; var u = halton(i + seed % 97, 2), v = halton(i + seed % 97, 3); var th = -Math.PI + TAU * (u + (rnd() - 0.5) * 0.004); var sp = Math.sin(lo) + (1 - Math.sin(lo)) * v; var ph = Math.asin(Math.min(1, sp));
      var hl = hairlineOf(K, body, th, S); if (ph < hl) continue; if (filter && !filter(th, ph)) continue; out.push([th, ph, ph - hl]); }
    return out;
  }
  function halton(i, b) { var f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
  AV.roots = roots;

  // ───────── the styles (look.hair). 0 keeps the body's own sculpted hair. Ids 1-11 keep their old meaning where a name existed. ─────────
  var T = AV.TEX;
  function Lc(front, top, side, back, nape, sideLow) { return { front: front, top: top, side: side, back: back, nape: nape, sideLow: sideLow }; }
  var SCALP_SOLID = { den: [1, 1, 1, 0.95], fade: [0, 0.01] };
  AV.STYLES = [
    { id: 0, key: "original", n: "Original", len: "sculpt", group: "Signature" },
    { id: 1, key: "crop", n: "Textured crop", len: "short", L: Lc(0.06, 0.052, 0.016, 0.022, 0.008, 0.009), flow: "forward", lift: 0.32, grav: 0.18, hug: 0.012, curl: [0.002, 34], jitter: 0.32, lenVar: 0.4, hlFront: 0.02,
      layers: [{ n: 1000, w: 0.017, clr: 0.002, tex: T.TUFT, ao: 0.5, taper: 0.8 }, { n: 650, w: 0.013, clr: 0.005, tex: T.TUFT, ao: 0.8, lenK: 1.1, taper: 0.85 }], scalp: { den: [1, 0.55, 1, 0.95], fade: [0.006, 0.03] }, hatPad: 0.006 },
    { id: 2, key: "ponytail", n: "Ponytail", len: "long", special: "pony", L: Lc(0.3, 0.3, 0.3, 0.3, 0.3), scalp: SCALP_SOLID, hatPad: 0.006, gloss: 1.2 },
    { id: 3, key: "buzz", n: "Buzz cut", len: "short", layers: [], scalp: { den: [0.92, 0.88, 0, 0.85], fade: [0, 0.012] }, hatPad: 0.003 },
    { id: 4, key: "bob", n: "Bob", len: "medium", L: Lc(0.075, 0.19, 0.15, 0.145, 0.09), flow: "center", lift: 0.12, grav: 0.95, hug: 0.016, tipCurl: [0.3, 0.45], long: true, seg: 12, hlFront: 0.01, swingK: 0.7,
      layers: [{ n: 1100, w: 0.027, clr: 0.003, tex: T.STRAIGHT, ao: 0.45 }, { n: 700, w: 0.022, clr: 0.007, tex: T.STRAIGHT, ao: 0.72, lenK: 1.02 }, { n: 240, w: 0.012, clr: 0.011, tex: T.WISPY, ao: 1, lenK: 1.04 }], scalp: SCALP_SOLID, hatPad: 0.008, gloss: 1.2 },
    { id: 5, key: "slick", n: "Slick back", len: "medium", L: Lc(0.12, 0.115, 0.05, 0.075, 0.03, 0.026), flow: "back", lift: 0.1, grav: 0.2, hug: 0.007, jitter: 0.12, floorDh: 0.06,
      layers: [{ n: 1200, w: 0.02, clr: 0.002, tex: T.STRAIGHT, ao: 0.5 }, { n: 700, w: 0.016, clr: 0.005, tex: T.STRAIGHT, ao: 0.78, lenK: 1.03 }, { n: 200, w: 0.008, clr: 0.008, tex: T.WISPY, ao: 1 }], scalp: { den: [1, 0.7, 1, 0.95], fade: [0.004, 0.02] }, hatPad: 0.007, gloss: 1.45 },
    { id: 6, key: "curlytop", n: "Curly top", len: "short", L: Lc(0.052, 0.055, 0.024, 0.028, 0.01), flow: "up", lift: 0.55, grav: 0.12, curl: [0.0065, 26], jitter: 0.5, lenVar: 0.35, hug: 0.03,
      filter: function (th, ph, dh) { return dh > 0.26; }, layers: [{ n: 900, w: 0.022, clr: 0.003, tex: T.CURLY, ao: 0.5, twist: 1.2, taper: 0.4 }, { n: 600, w: 0.018, clr: 0.008, tex: T.CURLY, ao: 0.85, lenK: 1.1, twist: 1.4, taper: 0.4 }], scalp: { den: [1, 0.05, 1, 0.95], fade: [0.016, 0.045] }, hatPad: 0.01, gloss: 0.8 },
    { id: 7, key: "afro", n: "Afro", len: "volume", special: "afro", scalp: SCALP_SOLID, hatPad: 0.025, gloss: 0.1, var: 0.1 },
    { id: 8, key: "long", n: "Long straight", len: "long", L: Lc(0.3, 0.4, 0.38, 0.42, 0.36), flow: "center", partGap: 0.004, lift: 0.08, grav: 1, hug: 0.012, long: true, seg: 14, hlFront: 0.0, lenVar: 0.15,
      layers: [{ n: 1100, w: 0.03, clr: 0.003, tex: T.STRAIGHT, ao: 0.45 }, { n: 700, w: 0.025, clr: 0.007, tex: T.STRAIGHT, ao: 0.72, lenK: 1.02 }, { n: 220, w: 0.013, clr: 0.011, tex: T.WISPY, ao: 1, lenK: 1.03 }], scalp: SCALP_SOLID, hatPad: 0.009, gloss: 1.3 },
    { id: 9, key: "cornrows", n: "Cornrows", len: "short", special: "cornrows", scalp: { den: [0.4, 0.4, 0, 0.75], fade: [0, 0.01] }, hatPad: 0.006 },
    { id: 10, key: "bun", n: "Top bun", len: "long", special: "bun", scalp: SCALP_SOLID, hatPad: 0.006, gloss: 1.2 },
    { id: 11, key: "wavy", n: "Long wavy", len: "long", L: Lc(0.27, 0.36, 0.34, 0.38, 0.33), flow: "center", partGap: 0.004, lift: 0.1, grav: 0.9, hug: 0.016, long: true, seg: 16, lenVar: 0.16, jitter: 0.1,
      coherent: true, curl: [0.012, 3.4],
      layers: [{ n: 700, w: 0.03, clr: 0.0012, tex: T.STRAIGHT, ao: 0.4, taper: 0.55, lenK: 0.95 }, { n: 1900, w: 0.017, clr: 0.003, tex: T.STRAIGHT, ao: 0.62, taper: 0.9 }, { n: 1600, w: 0.014, clr: 0.007, tex: T.STRAIGHT, ao: 0.8, lenK: 1.02, taper: 0.92 }, { n: 1000, w: 0.011, clr: 0.011, tex: T.STRAIGHT, ao: 0.92, lenK: 1.03, taper: 0.94 }, { n: 300, w: 0.008, clr: 0.014, tex: T.WISPY, ao: 1, lenK: 1.04 }], scalp: SCALP_SOLID, hatPad: 0.01, gloss: 1.15 },
    { id: 12, key: "fade", n: "Skin fade", len: "short", L: Lc(0.035, 0.032, 0.01, 0.012, 0.004), flow: "up", lift: 0.3, grav: 0.14, hug: 0.009, jitter: 0.26, filter: function (th, ph, dh) { return dh > 0.3; },
      layers: [{ n: 1250, w: 0.012, clr: 0.002, tex: T.TUFT, ao: 0.55, taper: 0.62 }, { n: 700, w: 0.0095, clr: 0.0045, tex: T.TUFT, ao: 0.85, lenK: 1.08, taper: 0.7 }], scalp: { den: [1, 0.0, 0.7, 0.95], fade: [0.008, 0.04] }, hatPad: 0.004 },
    { id: 13, key: "crew", n: "Crew cut", len: "short", L: Lc(0.032, 0.028, 0.012, 0.014, 0.006, 0.007), flow: "up", lift: 0.3, grav: 0.14, hug: 0.008, jitter: 0.26,
      layers: [{ n: 1500, w: 0.012, clr: 0.002, tex: T.TUFT, ao: 0.55, taper: 0.62 }, { n: 850, w: 0.0095, clr: 0.0045, tex: T.TUFT, ao: 0.85, lenK: 1.08, taper: 0.7 }], scalp: { den: [1, 0.6, 1, 0.95], fade: [0.004, 0.02] }, hatPad: 0.004 },
    { id: 14, key: "sidepart", n: "Side part", len: "medium", L: Lc(0.075, 0.08, 0.024, 0.038, 0.012, 0.013), flow: "part", part: 0.03, lift: 0.18, grav: 0.3, hug: 0.01, jitter: 0.14, floorDh: 0.07,
      layers: [{ n: 1500, w: 0.015, clr: 0.002, tex: T.STRAIGHT, ao: 0.5, taper: 0.88 }, { n: 900, w: 0.012, clr: 0.006, tex: T.STRAIGHT, ao: 0.78, lenK: 1.04, taper: 0.9 }, { n: 120, w: 0.008, clr: 0.006, tex: T.WISPY, ao: 1 }], scalp: { den: [1, 0.6, 1, 0.95], fade: [0.004, 0.022] }, hatPad: 0.006, gloss: 1.4 },
    { id: 15, key: "locs", n: "Locs", len: "long", special: "locs", scalp: { den: [1, 1, 1, 0.95], fade: [0, 0.01] }, hatPad: 0.012, gloss: 0.22, tipK: 2.2, var: 0.3, warm: 0.22,
      L: Lc(0.012, 0.012, 0.01, 0.012, 0.008), flow: "up", lift: 0.2, jitter: 0.4, layers: [{ n: 900, w: 0.012, clr: 0.0015, tex: T.TUFT, ao: 0.45, taper: 0.7 }] },
    { id: 16, key: "pixie", n: "Pixie", len: "short", L: Lc(0.09, 0.075, 0.035, 0.035, 0.016), flow: "part", part: -0.025, sweep: 0.85, lift: 0.16, grav: 0.45, hug: 0.01, jitter: 0.2, floorDh: 0.1,
      layers: [{ n: 1500, w: 0.014, clr: 0.002, tex: T.STRAIGHT, ao: 0.5, taper: 0.88 }, { n: 900, w: 0.011, clr: 0.006, tex: T.STRAIGHT, ao: 0.78, lenK: 1.05, taper: 0.9 }, { n: 140, w: 0.008, clr: 0.006, tex: T.WISPY, ao: 1, lenK: 1.08 }], scalp: SCALP_SOLID, hatPad: 0.006, gloss: 1.2 }
  ];
  AV.STYLE_ORDER = [0, 3, 12, 13, 1, 14, 5, 6, 7, 15, 9, 10, 2, 8, 11, 4, 16];
  AV.style = function (id) { return AV.STYLES[id] || AV.STYLES[0]; };

  function* layerRun(acc, K, body, S, Ly, li, hat, rnd) {
    var SL = Object.assign({}, S, Ly.over || {}); var rs = roots(K, body, S, Ly.n, 1000 + S.id * 31 + li * 7 + (body === "f" ? 3 : 0), S.filter ? function (th, ph) { return S.filter(th, ph, ph - hairlineOf(K, body, th, S)); } : null);
    for (var i = 0; i < rs.length; i++) { var th = rs[i][0], ph = rs[i][1], dh = rs[i][2]; var L = regionLen(S.L, th, ph) * (Ly.lenK || 1) * (0.55 + 0.45 * sstep(0, 0.12, dh)); if (L < 0.004) continue;
      if (S.partGap && ph > 0.55 && Math.cos(th) > -0.2) { var px = Math.cos(ph) * Math.sin(th) * 0.09; if (Math.abs(px - (S.part || 0)) < S.partGap * (0.5 + 0.5 * rnd())) continue; }
      if (hat && hat.covers(th, ph) && L < (hat.minLen || 0.06)) continue;
      var stack = (S.stack !== undefined ? S.stack : (S.long ? 0.012 : 0.004)) * sstep(-0.5, 1.45, ph); var clr = Ly.clr * 0.6 + stack;
      var root = surf(K, th, ph, Ly.clr * 0.4), n = surfN(K, th, ph);
      var st = growStrand(K, SL, { len: L, clr: clr, seg: Ly.seg || S.seg, hug: Ly.hug, gravK: Ly.gravK }, root, n, th, ph, rnd, hat);
      card(acc, K, st, Ly.w * (0.8 + 0.4 * rnd()), Ly.tex, Ly.ao, rnd, Ly.twist, Ly.taper); if ((i & 127) === 127) yield 0; }
  }
  // hair pulled back over the scalp to a point (buns, ponytails)
  function* pulled(acc, K, body, S, to, n, hat, rnd, tex) {
    var SL = Object.assign({}, S, { flow: "to", _to: to, lift: 0.02, grav: 0, jitter: 0.04 }); var rs = roots(K, body, S, n, 4000 + S.id);
    for (var i = 0; i < rs.length; i++) { var th = rs[i][0], ph = rs[i][1]; if (hat && hat.covers(th, ph)) { var e = AV.fromSph(K, th, ph, 1, [0, 0, 0]); } var root = surf(K, th, ph, 0.001), nn = surfN(K, th, ph); var dist = vlen(vsub(to, root)); if (dist < 0.012) continue;
      var st = growStrand(K, SL, { len: dist * 1.7, clr: 0.0022 + 0.002 * rnd(), seg: 14, hug: 0.0015 }, root, nn, th, ph, rnd, hat); card(acc, K, st, 0.02 * (0.8 + 0.4 * rnd()), tex === undefined ? T.STRAIGHT : tex, 0.65 + 0.3 * rnd(), rnd, 0.2, 0.2); if ((i & 127) === 127) yield 0; }
  }
  function tieRing(K, at, axis, r) { var acc = new Acc(); var b1 = vnorm(vcross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), b2 = vcross(axis, b1); var P = [], D = [];
    for (var k = 0; k <= 18; k++) { var a = k / 18 * TAU; P.push(vadd(vadd(at, b1, Math.cos(a) * r), b2, Math.sin(a) * r)); D.push(vnorm(vadd(vmult(b1, -Math.sin(a)), b2, Math.cos(a)))); } tube(acc, K, P, D, 0.0035, 0.0035, T.BRAID, 0.6, rng(5), 6); return acc; }
  var SPECIAL = {
    bun: function* (acc, K, body, S, hat, rnd) {
      var high = !hat || !hat.covers(Math.PI, 1.0); var th0 = Math.PI, ph0 = high ? 1.02 : (hat.bunPh !== undefined ? hat.bunPh : -0.05); var at = surf(K, th0, ph0, 0.002), ax = surfN(K, th0, ph0); if (!high) ax = vnorm(vadd(ax, [0, -0.3, 0], 1));
      yield* pulled(acc, K, body, S, at, 1500, hat, rnd);
      var Rm = body === "f" ? 0.024 : 0.021, rm = body === "f" ? 0.017 : 0.015, B = vadd(at, ax, rm * 0.9); var u = vnorm(vcross(ax, [1, 0, 0])), v = vcross(ax, u);
      for (var k = 0; k < 170; k++) { var psi0 = k * 2.39996, P = [], D = [], N = []; var span = TAU * (0.55 + 0.35 * rnd()), f0 = rnd() * TAU;
        for (var i = 0; i <= 18; i++) { var f = f0 + span * i / 18, psi = psi0 + i * 0.09; var rr = Rm + rm * Math.cos(psi); var p = vadd(vadd(vadd(B, u, rr * Math.cos(f)), v, rr * Math.sin(f)), ax, rm * Math.sin(psi)); P.push(p); var nr = vnorm(vadd(vadd(vmult(u, Math.cos(psi) * Math.cos(f)), v, Math.cos(psi) * Math.sin(f)), ax, Math.sin(psi))); N.push(nr); }
        for (i = 0; i <= 18; i++) D.push(vnorm(vsub(P[Math.min(18, i + 1)], P[Math.max(0, i - 1)])));
        card(acc, K, { P: P, D: D, H: P.map(function () { return false; }) }, 0.013, T.STRAIGHT, 0.75 + 0.25 * rnd(), rnd, 0.2, 0.1, function (p, i) { return N[i]; }); }
      for (k = 0; k < 40; k++) { var a0 = rnd() * TAU, P2 = [], D2 = []; for (i = 0; i <= 8; i++) { var t = i / 8, rr2 = (Rm + rm * 0.4) * (1 - t * 0.9); P2.push(vadd(vadd(vadd(B, u, rr2 * Math.cos(a0 + t * 2)), v, rr2 * Math.sin(a0 + t * 2)), ax, rm * (0.9 + 0.1 * (1 - t)))); } for (i = 0; i <= 8; i++) D2.push(vnorm(vsub(P2[Math.min(8, i + 1)], P2[Math.max(0, i - 1)])));
        card(acc, K, { P: P2, D: D2, H: P2.map(function () { return false; }) }, 0.012, T.STRAIGHT, 0.9, rnd, 0.1, 0.3, function () { return ax; }); }
    },
    pony: function* (acc, K, body, S, hat, rnd, extra) {
      var ph0 = hat && hat.tailPh !== undefined ? hat.tailPh : (body === "f" ? 0.42 : 0.5); var at = surf(K, Math.PI, ph0, 0.002), ax = surfN(K, Math.PI, ph0);
      yield* pulled(acc, K, body, S, at, 1500, hat, rnd);
      // the tail's centre line: out from the tie, then down the back
      var C = [vadd(at, ax, 0.006)], d = vnorm(vadd(ax, [0, -0.25, 0], 1)), seg = 0.02, len = body === "f" ? 0.34 : 0.27; var n = Math.round(len / seg);
      for (var i = 1; i <= n; i++) { d = vnorm(vadd(d, [0, -1, 0], 0.55)); var q = vadd(C[i - 1], d, seg); collide(K, q, 0.028, null, _o); q = [_o[0], _o[1], _o[2]]; d = vnorm(vsub(q, C[i - 1])); C.push(q); }
      var CD = C.map(function (p, i) { return vnorm(vsub(C[Math.min(n, i + 1)], C[Math.max(0, i - 1)])); });
      for (var k = 0; k < 220; k++) { var a = rnd() * TAU, rr = Math.sqrt(rnd()), P = [], D = [], N = []; var b1 = vnorm(vcross(CD[0], [1, 0, 0])), lenK = 0.75 + 0.25 * rnd(); var m = Math.max(3, Math.round(n * lenK));
        for (i = 0; i <= m; i++) { var t = i / n; b1 = vnorm(proj(b1, CD[i])); var b2 = vcross(CD[i], b1); var R0 = 0.011 + 0.018 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.62) * (1 - 0.55 * t); var off = vadd(vmult(b1, Math.cos(a)), b2, Math.sin(a)); P.push(vadd(C[i], off, R0 * rr)); N.push(off); }
        for (i = 0; i <= m; i++) D.push(vnorm(vsub(P[Math.min(m, i + 1)], P[Math.max(0, i - 1)])));
        card(acc, K, { P: P, D: D, H: P.map(function () { return false; }) }, 0.016 * (0.8 + 0.4 * rnd()), k % 5 === 0 ? T.WISPY : T.STRAIGHT, 0.55 + 0.45 * rr, rnd, 0.4, 0.5, function (p, i) { return N[i]; }); }
      extra.tie = tieRing(K, vadd(at, ax, 0.004), ax, 0.012); extra.tieAt = vadd(at, ax, 0.006);
    },
    afro: function* (acc, K, body, S, hat, rnd) {
      // a soft rounded volume: concentric shells over the scalp (the shader cuts each into curly noise, sparser outward), then a fine curly fringe
      var thick = function (th, ph, dh) { var c = Math.cos(th); var top = sstep(0.3, 1.3, ph); var t = 0.056 + 0.018 * top + 0.01 * Math.max(0, -c) - 0.014 * Math.max(0, c) * (1 - top); return t * (0.25 + 0.75 * sstep(-0.02, 0.32, dh)); };
      var NT = 120, NR = 34, NS = 20; var cen = [K.c.x, K.c.y, K.c.z]; var E = [K.c.x, K.c.y + 0.022, K.c.z - 0.01], Re = body === "f" ? 0.121 : 0.128;
      var envT = function (th, ph) { var cp = Math.cos(ph); var d = [cp * Math.sin(th), Math.sin(ph), cp * Math.cos(th)]; var oc = vsub(cen, E); var b = vdot(oc, d), c2 = vdot(oc, oc) - Re * Re; return -b + Math.sqrt(Math.max(0, b * b - c2)); };
      thick = function (th, ph, dh) { var t = envT(th, ph) - gridAt(K, K.rsc, th, ph) - 0.002; t = Math.max(0.012, t) - 0.012 * Math.max(0, Math.cos(th)) * sstep(0.9, 0.2, ph); return t * (0.1 + 0.9 * sstep(-0.03, 0.5, dh)); };   // tapers into the hairline: a rounded shape, not a mushroom cap
      for (var sh = 0; sh < NS; sh++) { var f = (sh + 0.5) / NS; var base = acc.pos.length / 3;
        for (var i = 0; i <= NT; i++) { var th = -Math.PI + TAU * i / NT; var hl = hairlineOf(K, body, th, S);
          for (var r = 0; r <= NR; r++) { var ph = hl - 0.04 + (Math.PI / 2 - 0.001 - hl + 0.04) * (r / NR); var dh = ph - hl; var lump = 0.5 * Math.sin(th * 9 + Math.sin(ph * 7) * 2) * Math.sin(ph * 11 + th * 3) + 0.5 * Math.sin(th * 17 + ph * 13); var rr = gridAt(K, K.rsc, th, ph) + 0.002 + thick(th, ph, dh) * f * (1 + 0.09 * lump * f * f);
            if (hat && hat.covers(th, ph)) rr = Math.min(rr, hat.rin(th, ph) - 0.003);
            var p = fromSph(K, th, ph, rr, [0, 0, 0]); var nr = vnorm(vsub(p, cen)); var tg = vnorm(proj([0, -1, 0], nr)); if (vlen(tg) < 0.1) tg = [0, 0, -1];
            acc.v(p, nr, i / NT, Math.min(1, Math.max(0, r / NR)), tg, [f, 0, 0.55 + 0.45 * f, 0.5]); } }
        for (i = 0; i < NT; i++) for (r = 0; r < NR; r++) { var a = base + i * (NR + 1) + r, b = a + NR + 1; acc.ind.push(a, b, a + 1, a + 1, b, b + 1); }
        yield 0; }
      // the fringe: short, fine curly cards standing a little out of the outer shells
      var rs2 = roots(K, body, S, 1400, 7100);
      for (var k = 0; k < rs2.length; k++) { var th2 = rs2[k][0], ph2 = rs2[k][1], dh2 = rs2[k][2]; if (hat && hat.covers(th2, ph2)) continue; var R = gridAt(K, K.rsc, th2, ph2) + 0.002 + thick(th2, ph2, dh2) * (0.86 + 0.1 * rnd()); var p0 = fromSph(K, th2, ph2, R, [0, 0, 0]); var nr2 = vnorm(vsub(p0, cen)); var tdir = vnorm(vadd(nr2, proj([rnd() - 0.5, rnd() - 0.6, rnd() - 0.5], nr2), 1.2)); var P = [], D = [];
        var Lf = 0.005 + 0.005 * rnd(); for (var j = 0; j <= 4; j++) { P.push(vadd(p0, tdir, Lf * j / 4)); D.push(tdir); }
        card(acc, K, { P: P, D: D, H: [false, false, false, false, false] }, 0.009, T.COILY, 0.95, rnd, 1.0, 0.2, function () { return nr2; }); if ((k & 255) === 255) yield 0; }
    },
    locs: function* (acc, K, body, S, hat, rnd) {
      // rounded locs: a short root cap on the scalp, a tapered tube with a slight twist and segment bumps, each its own shade
      var SL = Object.assign({}, S, { flow: "center", lift: 0.3, grav: 1.0, jitter: 0.2, curl: [0.009, 2.4] }); var rs = roots(K, body, S, 110, 8000); var L0 = body === "f" ? 0.36 : 0.3;
      for (var i = 0; i < rs.length; i++) { var th = rs[i][0], ph = rs[i][1], dh = rs[i][2]; var root = surf(K, th, ph, 0.0015), n = surfN(K, th, ph); var L = L0 * (0.75 + 0.35 * rnd()) * (0.5 + 0.5 * sstep(0, 0.15, dh)) * (Math.cos(th) > 0.45 && ph < 1.15 ? 0.3 : 1);   // the front locs stop above the brows: the face stays clear
        var st = growStrand(K, SL, { len: L, clr: 0.007 + 0.006 * rnd(), seg: 18, hug: null }, root, n, th, ph, rnd, hat); var keep = [], Dk = [];
        for (var j = 0; j < st.P.length; j++) if (!st.H[j] || (j + 1 < st.P.length && !st.H[j + 1])) { keep.push(st.P[j]); Dk.push(st.D[j]); }
        if (keep.length < 2) continue; var r0 = 0.0058 + 0.0016 * rnd(); var shade = rnd(); var start = acc.pos.length / 3;
        tube(acc, K, keep, Dk, r0, r0 * 0.62, T.LOC, 0.55 + 0.45 * rnd(), rnd, 8, function (t, s) { return 1 + 0.13 * Math.sin(s / 0.011 * TAU) * (0.4 + 0.6 * t); }, 0.9 + 1.2 * rnd());
        for (var q = start; q < acc.pos.length / 3; q++) acc.h[q * 4 + 3] = shade;
        if ((i & 31) === 31) yield 0; }
    },
    cornrows: function* (acc, K, body, S, hat, rnd) {
      // rows are meridians from the front hairline over the top to the nape (planes through the skull's front-back axis), then hang as braids
      var rows = body === "f" ? 11 : 9, hang0 = body === "f" ? 0.2 : 0, cen = [K.c.x, K.c.y, K.c.z];
      for (var r = 0; r < rows; r++) { var al = (r / (rows - 1) - 0.5) * 2 * 1.12; var P = [], D = []; var started = false, hang = hang0, p = null, d = null;
        for (var k = 0; k <= 90; k++) { var sA = 0.25 + (Math.PI - 0.25) * k / 90; var dir = [Math.sin(al) * Math.sin(sA), Math.cos(al) * Math.sin(sA), Math.cos(sA)]; var th = Math.atan2(dir[0], dir[2]), ph = Math.asin(dir[1]);
          if (!started) { if (ph >= hairlineOf(K, body, th, S) + 0.02) started = true; else continue; }
          if (ph < -0.3) break; var q = surf(K, th, ph, 0.0034); if (p && vlen(vsub(q, p)) < 0.008) continue; P.push(q); p = q; }
        for (var i = 0; i < P.length; i++) D.push(vnorm(vsub(P[Math.min(P.length - 1, i + 1)], P[Math.max(0, i - 1)])));
        if (P.length > 1) { d = D[D.length - 1]; while (hang > 0) { d = vnorm(vadd(d, [0, -1, 0], 0.45)); var q2 = vadd(p, d, 0.012); collide(K, q2, 0.007, null, _o); q2 = [_o[0], _o[1], _o[2]]; d = vnorm(vsub(q2, p)); p = q2; P.push(p); D.push(d); hang -= 0.012; } }
        var keep = [], Dk = []; for (var j = 0; j < P.length; j++) { sph(K, P[j][0], P[j][1], P[j][2], _s); var hid = !!(hat && hat.covers(_s.th, _s.ph)); if (!hid) { keep.push(P[j]); Dk.push(D[j]); } }
        if (keep.length > 1) tube(acc, K, keep, Dk, 0.0058, 0.0042, T.BRAID, 0.8, rnd, 6); }
    }
  };
  AV.SPECIAL = SPECIAL;
  // build (or fetch) the groom of a style for a body, optionally under a hat
  var GROOMS = AV.GROOMS = AV.GROOMS || new Map();
  function* groomGen(body, id, hat, key) {
    var K = KIT[body]; var S = AV.style(id); var t0 = performance.now(), work = 0, ts = performance.now(); var acc = new Acc(), rnd = rng(77 + id * 13 + (body === "f" ? 5 : 0)), extra = {};
    var it = function* () { if (S.special) yield* SPECIAL[S.special](acc, K, body, S, hat, rnd, extra); if (S.layers) for (var li = 0; li < S.layers.length; li++) yield* layerRun(acc, K, body, S, S.layers[li], li, hat, rnd); }();
    for (;;) { var r = it.next(); if (r.done) break; work += performance.now() - ts; yield 0; ts = performance.now(); }
    work += performance.now() - ts; t0 = work;
    var piv = null; if (S.special === "pony" && extra.tieAt) piv = { mode: "tail", p: extra.tieAt, stiff: 45, damp: 6, follow: 0.72 };
    else if (S.long || S.special === "locs" || (S.special === "cornrows" && body === "f")) piv = { mode: "hang", p: [0, K.eyeY + 0.005, K.c.z - 0.005], y0: K.eyeY - 0.05, y1: K.eyeY - 0.15, k: S.swingK || 1, stiff: 55, damp: 8, follow: 0.7 };
    var geo = null; if (acc.pos.length) { var gq = acc.geoGen(), gr; ts = performance.now(); while (!(gr = gq.next()).done) { work += performance.now() - ts; yield 0; ts = performance.now(); } geo = gr.value; work += performance.now() - ts; yield 0; ts = performance.now(); geo = piv ? skinPivot(K, geo, piv) : skinAttrs(K, geo, false); }
    var tie = extra.tie ? skinAttrs(K, extra.tie.geo(), false) : null;
    var g = { key: key, geo: geo, tie: tie, piv: piv, style: S, refs: 0, used: performance.now(), ms: t0 + (performance.now() - ts), verts: acc.pos.length / 3 };
    if (geo) { geo.computeBoundingSphere(); geo.userData.avShared = true; } if (tie) tie.userData.avShared = true;
    AV.n.grooms++; AV.n.groomMs += g.ms; GROOMS.set(key, g); return g;
  }
  function groomKey(body, id, hat) { return body + ":" + id + ":" + (hat ? hat.key : "-"); }
  AV.groomCached = function (body, id, hat) { var g = GROOMS.get(groomKey(body, id, hat)); if (g) g.used = performance.now(); return g || null; };
  AV.groom = function (body, id, hat) {
    var K = KIT[body]; var S = AV.style(id); if (!K || !S || S.len === "sculpt") return null; var key = groomKey(body, id, hat); var g = GROOMS.get(key); if (g) { g.used = performance.now(); return g; }
    var job = JOBS.get(key); var gen = job ? job.gen : groomGen(body, id, hat, key); var r; do { r = gen.next(); } while (!r.done); if (job) { JOBS.delete(key); job.res(r.value); } return r.value;
  };
  // background builds: a few milliseconds a frame (the frame hook drives them)
  var JOBS = AV.JOBS = AV.JOBS || new Map();
  AV.groomAsync = function (body, id, hat, first) {
    var S = AV.style(id); if (!KIT[body] || !S || S.len === "sculpt") return Promise.resolve(null); var key = groomKey(body, id, hat); var g = GROOMS.get(key); if (g) return Promise.resolve(g);
    var job = JOBS.get(key); if (!job) { job = { key: key, gen: groomGen(body, id, hat, key) }; job.p = new Promise(function (res) { job.res = res; }); JOBS.set(key, job); }
    if (first) { var all = Array.from(JOBS.entries()); JOBS.clear(); JOBS.set(key, job); all.forEach(function (e) { if (e[0] !== key) JOBS.set(e[0], e[1]); }); AV.urgent = performance.now(); }
    return job.p;
  };
  AV.runJobs = function (budget) { var t0 = performance.now(); for (var e of JOBS) { var job = e[1]; for (;;) { var r = job.gen.next(); if (r.done) { JOBS.delete(job.key); job.res(r.value); break; } if (performance.now() - t0 > budget) return; } if (performance.now() - t0 > budget) return; } };

  // ───────── studio lighting for the character screen: three of the client's pooled point lights become key, fill and rim ─────────
  // (no new lights, so no new shader programs); the sun and sky are dimmed for the portrait and a soft cyclorama closes the view.
  var STUDIO = AV.studio = AV.studio || { on: false, k: 0, target: new THREE.Vector3(), dome: null };
  STUDIO.cfg = { key: [4, 0xfff1e0], fill: [1.1, 0xdfe9ff], rim: [5, 0xfff4e8], sun: 0.1, hemi: 0.12, env: 0.45, exposure: 0.98 };
  function studioDome() {
    if (STUDIO.dome) return STUDIO.dome; var cv = document.createElement("canvas"); cv.width = 8; cv.height = 256; var x = cv.getContext("2d"); var g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#151d1a"); g.addColorStop(0.42, "#2b3a34"); g.addColorStop(0.62, "#203029"); g.addColorStop(1, "#0b100e"); x.fillStyle = g; x.fillRect(0, 0, 8, 256);
    var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.userData.avShared = true;
    var m = new THREE.Mesh(new THREE.SphereGeometry(6.5, 40, 20), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false }));
    m.renderOrder = -5; m.frustumCulled = false; m.visible = false; m.name = "avStudioDome"; m.userData.noCull = true; m.userData.noSolid = true; m.layers.enableAll(); STUDIO.dome = m;
    // the studio floor: a soft lit disc with a contact shadow under the feet that fades into the cyclorama (the world itself is hidden while the studio is open)
    var fc = document.createElement("canvas"); fc.width = fc.height = 512; var fx = fc.getContext("2d"); var rg = fx.createRadialGradient(256, 256, 0, 256, 256, 256);
    rg.addColorStop(0, "rgba(58,70,64,1)"); rg.addColorStop(0.35, "rgba(44,56,50,1)"); rg.addColorStop(0.75, "rgba(30,41,36,0.85)"); rg.addColorStop(1, "rgba(30,41,36,0)"); fx.fillStyle = rg; fx.fillRect(0, 0, 512, 512);
    var sg = fx.createRadialGradient(256, 256, 0, 256, 256, 30); sg.addColorStop(0, "rgba(6,9,8,0.75)"); sg.addColorStop(0.55, "rgba(6,9,8,0.4)"); sg.addColorStop(1, "rgba(6,9,8,0)"); fx.fillStyle = sg; fx.beginPath(); fx.ellipse(256, 256, 30, 22, 0, 0, TAU); fx.fill();
    var ft = new THREE.CanvasTexture(fc); ft.colorSpace = THREE.SRGBColorSpace; ft.userData.avShared = true;
    var fl = new THREE.Mesh(new THREE.CircleGeometry(6.2, 64), new THREE.MeshBasicMaterial({ map: ft, transparent: true, depthWrite: false, fog: false }));
    fl.rotation.x = -Math.PI / 2; fl.renderOrder = -4; fl.frustumCulled = false; fl.visible = false; fl.name = "avStudioFloor"; fl.userData.noCull = true; fl.userData.noSolid = true; fl.layers.enableAll(); STUDIO.floor = fl; return m;
  }
  // the world is hidden while the studio is open: everything outside the cyclorama is occluded anyway, and nearby props (lamp posts,
  // sculptures, cabins) would stand inside it. Groups that hold a rendered light or the player are walked into, never hidden, so the
  // light count (and with it every shader program) stays the same.
  function hideWorld(on) {
    if (typeof scene === "undefined") return; if (!on) { for (var o of STUDIO.wh || []) o.visible = true; STUDIO.wh = []; return; }
    var keep = new Set([player, STUDIO.dome, STUDIO.floor].concat(STUDIO.keep || [])); var walkIn = new Set(); var up = function (q) { while (q && q !== scene) { walkIn.add(q); q = q.parent; } };
    scene.traverse(function (q) { if (q.isLight && q.visible) up(q); }); up(player); STUDIO.wh = STUDIO.wh || [];
    var walk = function (g) { for (var c of g.children) { if (keep.has(c) || c.isLight || c.isCamera) continue; if (walkIn.has(c)) { walk(c); continue; } if (c.visible) { c.visible = false; STUDIO.wh.push(c); } } };
    walk(scene); STUDIO.whN = scene.children.length;
  }
  AV.hideWorld = hideWorld;
  AV.studioDome = studioDome;
  var _sv = new THREE.Vector3(), _sr = new THREE.Vector3(), _su = new THREE.Vector3(0, 1, 0);
  // place the key / fill / rim round the target relative to the camera; k fades the setup in and out
  AV.studioApply = function (target, cam, k) {
    if (typeof LIGHTS === "undefined" || !LIGHTS.pool || LIGHTS.pool.length < 3) return; k = k === undefined ? 1 : k; var C = STUDIO.cfg;
    _sv.subVectors(cam.position, target); _sv.y = 0; if (_sv.lengthSq() < 1e-6) _sv.set(0, 0, 1); _sv.normalize(); _sr.crossVectors(_su, _sv).normalize();
    var L = LIGHTS.pool; var set = function (l, side, up, fwd, I, col) { l.position.copy(target).addScaledVector(_sr, side).addScaledVector(_su, up).addScaledVector(_sv, fwd); l.color.setHex(col); l.intensity = I * k + l.intensity * (1 - k); l.distance = 9; l.decay = 1.6; };
    set(L[0], -1.25, 0.95, 1.35, C.key[0], C.key[1]); set(L[1], 1.6, 0.15, 1.1, C.fill[0], C.fill[1]); set(L[2], 0.55, 1.15, -1.5, C.rim[0], C.rim[1]);
    for (var pi = 3; pi < L.length; pi++) L[pi].intensity *= 1 - k; if (LIGHTS.spool) for (pi = 0; pi < LIGHTS.spool.length; pi++) LIGHTS.spool[pi].intensity *= 1 - k;   // the room's own lamps would flatten the portrait
    // the frame hook records the sky's values right after updateSky each frame; restore them, then apply (idempotent between frames)
    var O = STUDIO.orig; if (!O) O = STUDIO.orig = AV.studioRecord();
    if (O.csm && typeof CSMX !== "undefined" && CSMX.csm) CSMX.csm.lights.forEach(function (l, i) { l.intensity = O.csm[i]; }); else if (typeof sun !== "undefined") sun.intensity = O.sun; if (typeof hemi !== "undefined") hemi.intensity = O.hemi; if (typeof POST !== "undefined") { POST.exposure = O.exp; POST.sunVis *= 1 - k; POST.heat *= 1 - k; } if (typeof scene !== "undefined" && O.env !== undefined) scene.environmentIntensity = O.env * (1 - (1 - C.env) * k);
    var dim = 1 - (1 - C.sun) * k; if (typeof CSMX !== "undefined" && CSMX.on && CSMX.csm) for (var i = 0; i < CSMX.csm.lights.length; i++) CSMX.csm.lights[i].intensity *= dim; else if (typeof sun !== "undefined") sun.intensity *= dim;
    if (typeof hemi !== "undefined") hemi.intensity *= 1 - (1 - C.hemi) * k; if (typeof POST !== "undefined") POST.exposure = POST.exposure + (C.exposure - POST.exposure) * k;
    var d = studioDome(); if (!d.parent && typeof scene !== "undefined") scene.add(d); d.position.copy(target); d.position.y -= 0.6; d.visible = k > 0.02; d.material.opacity = 1;
    var fl = STUDIO.floor; if (fl && typeof player !== "undefined" && player) { if (!fl.parent) scene.add(fl); fl.position.set(target.x, (STUDIO.floorY !== undefined ? STUDIO.floorY : player.position.y) + 0.004, target.z); fl.visible = d.visible; }
    if (STUDIO.wh && STUDIO.wh.length) { if (scene.children.length !== STUDIO.whN) hideWorld(true); for (var wi = 0; wi < STUDIO.wh.length; wi++) STUDIO.wh[wi].visible = false; }   // re-applied every frame: a culling pass may have shown a prop again
  };
  AV.studioRecord = function () { return { csm: (typeof CSMX !== "undefined" && CSMX.on && CSMX.csm) ? CSMX.csm.lights.map(function (l) { return l.intensity; }) : null, sun: typeof sun !== "undefined" ? sun.intensity : 0, hemi: typeof hemi !== "undefined" ? hemi.intensity : 0, exp: typeof POST !== "undefined" ? POST.exposure : 1, env: typeof scene !== "undefined" ? scene.environmentIntensity : 1 }; };
  window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
  (function () { var list = window.PLAN_HOOKS.frame, fn = function (dt) { STUDIO.orig = AV.studioRecord(); if (AV.swingUpdate) AV.swingUpdate(dt); if (AV.frame) AV.frame.apply(null, arguments); };
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === "planAvatar") { list[i].fn = fn; return; } list.push({ name: "planAvatar", fn: fn }); })();
  AV.studioOff = function () { if (STUDIO.dome) STUDIO.dome.visible = false; if (STUDIO.floor) STUDIO.floor.visible = false; hideWorld(false); };

  // ───────── hanging hair: a pivot bone under the head keeps long hair, tails and locs falling with gravity, with a little swing ─────────
  // The groom is grown for the bind pose (head upright). The idle and walk clips pitch and turn the head by 15 to 40 degrees, so hair
  // that was rigid on the head stuck out behind. Vertices below the pivot are weighted to a bone that is turned back toward world down.
  var SWING = AV.SWING = AV.SWING || [];
  var _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _DOWN = new THREE.Vector3(0, -1, 0), _sc = new THREE.Vector3();
  // weights for a groom with a pivot: bone 0 = Head, bone 1 = pivot (indices into the mesh's own two-bone skeleton)
  function skinPivot(K, geo, piv) {
    var P = geo.attributes.position, n = P.count, ji = new Uint16Array(n * 4), wt = new Float32Array(n * 4);
    for (var i = 0; i < n; i++) { var x = P.getX(i), y = P.getY(i), z = P.getZ(i); var f;
      if (piv.mode === "tail") { var d = Math.hypot(x - piv.p[0], y - piv.p[1], z - piv.p[2]); f = sstep(0.012, 0.05, d) * (z < piv.p[2] + 0.01 ? 1 : 0); }
      else f = sstep(piv.y0, piv.y1, y) * (piv.k || 1) * (1 - sstep(K.c.z + 0.0, K.c.z + 0.06, z) * 0.85);
      ji[i * 4] = 0; ji[i * 4 + 1] = 1; wt[i * 4] = 1 - f; wt[i * 4 + 1] = f; }
    geo.setAttribute("skinIndex", new THREE.Uint8BufferAttribute(new Uint8Array(ji), 4)); geo.setAttribute("skinWeight", new THREE.BufferAttribute(u8(wt), 4, true)); return geo;
  }
  AV.skinPivot = skinPivot;
  // a hair mesh with its own skeleton [Head, pivot]; the pivot is a child of the clone's head bone
  AV.pivotMesh = function (geo, mat, bodyMesh, K, piv) {
    var sk = bodyMesh.skeleton, H = K.bones.Head, head = sk.bones[H]; var B = bodyMesh.bindMatrix;
    var hbm = new THREE.Matrix4().copy(sk.boneInverses[H]).multiply(B).invert();   // head bone in bind (mesh) space
    var P0 = new THREE.Vector3(piv.p[0], piv.p[1], piv.p[2]); var bone = new THREE.Bone(); bone.name = "avHairPivot";
    var hbmInv = hbm.clone().invert(); var rest = new THREE.Matrix4().copy(hbmInv).multiply(new THREE.Matrix4().makeTranslation(P0.x, P0.y, P0.z));
    rest.decompose(bone.position, bone.quaternion, bone.scale); head.add(bone);
    var Xp = new THREE.Matrix4().makeTranslation(-P0.x, -P0.y, -P0.z).multiply(new THREE.Matrix4().copy(B).invert());
    var skel = new THREE.Skeleton([head, bone], [sk.boneInverses[H].clone(), Xp]);
    var m = new THREE.SkinnedMesh(geo, mat); m.position.copy(bodyMesh.position); m.quaternion.copy(bodyMesh.quaternion); m.scale.copy(bodyMesh.scale); m.bind(skel, B); m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.userData.av = true; m.userData.avOwnSkel = skel; m.userData.fullGeo = geo;
    var S = { bone: bone, head: head, hbm: hbm, hbmInv: hbmInv, P0: P0, dir: new THREE.Vector3(0, -1, 0), vel: new THREE.Vector3(), k: piv.follow || 0.85, mesh: m, stiff: piv.stiff || 60, damp: piv.damp || 9, init: false, out: 0 };
    m.userData.avSwing = S; SWING.push(S); return m;
  };
  // per frame: turn each pivot so the hair below it falls toward world down (spring, for swing)
  AV.swingUpdate = function (dt) {
    dt = Math.min(0.05, dt || 0.016); var cam = typeof camera !== "undefined" ? camera.position : null;
    for (var i = SWING.length - 1; i >= 0; i--) { var S = SWING[i], m = S.mesh;
      var vis = true, root = m; for (var o = m; o; o = o.parent) { if (!o.visible) vis = false; root = o; }
      if (S.dead || (typeof scene !== "undefined" && root !== scene)) { if (++S.out > 120 || S.dead) SWING.splice(i, 1); continue; } S.out = 0; if (!vis) continue;
      S.head.updateWorldMatrix(true, false); _m1.multiplyMatrices(S.head.matrixWorld, S.hbmInv); _m1.decompose(_v1, _q1, _sc); if (cam && _v1.distanceTo(cam) > 45) continue;
      _v2.copy(_DOWN).applyQuaternion(_q2.copy(_q1).invert());   // world down in bind space
      _v2.lerp(_DOWN, 1 - S.k).normalize();
      if (!S.init) { S.dir.copy(_v2); S.vel.set(0, 0, 0); S.init = true; }
      _v3.subVectors(_v2, S.dir).multiplyScalar(S.stiff); _v3.addScaledVector(S.vel, -S.damp); S.vel.addScaledVector(_v3, dt); S.dir.addScaledVector(S.vel, dt).normalize();
      _q2.setFromUnitVectors(_DOWN, S.dir);
      _m2.makeRotationFromQuaternion(_q2); _m2.setPosition(S.P0); _m1.makeTranslation(-S.P0.x, -S.P0.y, -S.P0.z); _m2.multiply(_m1); _m2.premultiply(S.hbmInv); _m1.makeTranslation(S.P0.x, S.P0.y, S.P0.z); _m2.multiply(_m1);
      _m2.decompose(S.bone.position, S.bone.quaternion, S.bone.scale); }
  };

  // ───────── headwear: built on each body's own head field, so every hat fits every head ─────────
  // A hat is a band line round the head (height per azimuth), a crown surface over the hair (head + the style's hair thickness
  // under a hat) and its parts (brim, cuff, visor, cups...). The same band and crown tell the groom what is covered (hat hair).
  // look.hw ids: 0 none, 1 cap, 2 cap backwards, 3 trucker, 4 beanie, 5 bucket, 6 cowboy, 7 aviator headset, 8 captain's cap, 9 headband
  AV.HATS = [
    { id: 0, key: "none", n: "None" },
    { id: 1, key: "cap", n: "Fitted cap", colors: [["1f6b3a", "f5f1e6", "f4cd5a"], ["141414", "f5f1e6", "4dde6f"], ["f5f1e6", "1f6b3a", "1f6b3a"], ["d8c39a", "6b4a2a", "1f6b3a"], ["2f4a7a", "f5f1e6", "f4cd5a"]] },
    { id: 2, key: "capback", n: "Cap, backwards", colors: [["1f6b3a", "f5f1e6", "f4cd5a"], ["141414", "f5f1e6", "4dde6f"], ["f5f1e6", "1f6b3a", "1f6b3a"], ["d8c39a", "6b4a2a", "1f6b3a"], ["c94a3a", "f5f1e6", "f5f1e6"]] },
    { id: 3, key: "trucker", n: "Trucker cap", colors: [["1f6b3a", "f3efe6", "f4cd5a"], ["141414", "f3efe6", "4dde6f"], ["6b4a2a", "e9e2d3", "f4cd5a"], ["2f4a7a", "f3efe6", "f4cd5a"]] },
    { id: 4, key: "beanie", n: "Beanie", colors: [["2b2f36", "2b2f36", "4dde6f"], ["1f6b3a", "1f6b3a", "f5f1e6"], ["c9a24d", "c9a24d", "141414"], ["e9e2d3", "e9e2d3", "1f6b3a"], ["8a2f26", "8a2f26", "f5f1e6"]] },
    { id: 5, key: "bucket", n: "Bucket hat", colors: [["d8c39a", "b8a27a", "1f6b3a"], ["1f2a1f", "141414", "4dde6f"], ["f5f1e6", "d8d2c4", "1f6b3a"], ["556b3a", "44562e", "f4cd5a"]] },
    { id: 6, key: "cowboy", n: "Cowboy hat", colors: [["c8a878", "4a2e1c", "c0c4c8"], ["3a2a1e", "1a1410", "c0c4c8"], ["1a1a1a", "6b4a2a", "f4cd5a"], ["e9dcc0", "6b4a2a", "c0c4c8"]] },
    { id: 7, key: "headset", n: "Aviator headset", colors: [["2b2f36", "1a1c20", "4dde6f"], ["e9e2d3", "2b2f36", "4dde6f"], ["3a4a3a", "1a1c20", "f4cd5a"]] },
    { id: 8, key: "captain", n: "Captain's cap", colors: [["f5f1e6", "141820", "f4cd5a"], ["141820", "141820", "f4cd5a"], ["1f3b2c", "141820", "f4cd5a"]] },
    { id: 9, key: "headband", n: "Sport headband", colors: [["4dde6f", "f5f1e6", "1f6b3a"], ["f5f1e6", "1f6b3a", "1f6b3a"], ["141414", "4dde6f", "4dde6f"], ["c94a3a", "f5f1e6", "f5f1e6"]] }
  ];
  AV.LEGACY_HAT = { hat_cap: 1, hat_trucker: 3, hat_beanie: 4, hat_cowboy: 6, hat_band: 9 };
  // smooth head radius (hats do not follow every bump)
  function rsm(K, th, ph) { if (!K.rsm) { var n = K.nt, m = K.np, a = new Float32Array(K.rout), b = new Float32Array(a.length);
      for (var it = 0; it < 6; it++) { for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) { var s = 0, w = 0; for (var di = -1; di <= 1; di++) for (var dj = -1; dj <= 1; dj++) { var jj = j + dj; if (jj < 0 || jj >= m) continue; var ww = (di || dj) ? 1 : 2; s += a[((i + di + n) % n) * m + jj] * ww; w += ww; } b[i * m + j] = s / w; } var t = a; a = b; b = t; }
      for (i = 0; i < a.length; i++) a[i] = Math.max(a[i], K.rsc[i]); K.rsm = a; }
    return gridAt(K, K.rsm, th, ph); }
  AV.rsm = rsm;
  // the band: elevation of a hat edge given its height above the eyes at the front, side and back
  function bandPh(K, th, hF, hS, hB) { var c = Math.cos(th), s = Math.sin(th); var h = c >= 0 ? hF * c * c + hS * s * s : hB * c * c + hS * s * s; var y = K.eyeY + h; var ph = 0.2; for (var it = 0; it < 4; it++) { var r = rsm(K, th, ph); ph = Math.asin(Math.max(-0.95, Math.min(0.95, (y - K.c.y) / r))); } return ph; }
  AV.bandPh = bandPh;
  // geometry builder with parts: position, normal, uv (pattern space), aP (pattern kind, seam coord, colour slot, ao)
  function HG() { this.p = []; this.n = []; this.uv = []; this.a = []; this.i = []; }
  HG.prototype.v = function (p, n, u, v, kind, seam, slot, ao) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(u, v); this.a.push(kind, seam, slot, ao === undefined ? 1 : ao); return this.p.length / 3 - 1; };
  HG.prototype.grid = function (cols, rows, fn, kind, slot, flip, skip) { var base = this.p.length / 3, o = {}; for (var r = 0; r <= rows; r++) for (var c = 0; c <= cols; c++) { fn(c / cols, r / rows, o); this.v(o.p, o.n || [0, 1, 0], o.u, o.v, kind, o.seam || 0, slot, o.ao); }
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) { if (skip && skip((c + 0.5) / cols, (r + 0.5) / rows)) continue; var a = base + r * (cols + 1) + c, b = a + cols + 1; if (flip) this.i.push(a, b, a + 1, a + 1, b, b + 1); else this.i.push(a, a + 1, b, a + 1, b + 1, b); } return base; };
  HG.prototype.geo = function () { var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute("aP", new THREE.Float32BufferAttribute(this.a, 4)); g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1)); g.computeVertexNormals(); return g; };
  AV.HG = HG;
  var PK = { TWILL: 0, KNIT: 1, CANVAS: 2, FELT: 3, TERRY: 4, LEATHER: 5, PLASTIC: 6, METAL: 7, MESH: 8, CUSHION: 9 };
  AV.PK = PK;
  // a crown shell: azimuth x [band .. top], radius = smooth head + pad + extra(th, s); two surfaces (outside, inside) and the edge between them
  function crown(G, K, o) {
    var NT = o.nt || 72, NS = o.ns || 22, pad = o.pad, thick = o.thick || 0.003, rev = o.rev || 0; var cen = [K.c.x, K.c.y, K.c.z];
    var at = function (u, s, inner, out) { var th = -Math.PI + TAU * u; var phb = o.band(th); if (o.s0) { var s0 = o.s0(th); s = s0 + (1 - s0) * s; } var ph = phb + (Math.PI / 2 - 0.0005 - phb) * Math.pow(s, o.sp || 0.9); var r = rsm(K, th, ph) + pad + (o.extra ? o.extra(th, s, ph) : 0) - (inner ? thick : 0); var p = fromSph(K, th, ph, r, [0, 0, 0]); if (o.warp) o.warp(p, th, s, ph); out.th = th; out.ph = ph; return p; };
    var tmp = {}; var skip = o.hole ? function (u, s) { return o.hole(-Math.PI + TAU * u, s); } : null;
    for (var side = 0; side < 2; side++) { G.grid(NT, NS, function (u, s, out) { var p = at(u, s, side === 1, tmp); out.p = p; out.n = vnorm(vsub(p, cen)); if (side) out.n = [-out.n[0], -out.n[1], -out.n[2]]; out.u = u * 0.6 * TAU * 0.1 * 10; out.v = s * 0.18 * 10; out.seam = tmp.th - rev; out.ao = side ? 0.55 : (o.ao ? o.ao(tmp.th, s) : 1); }, side ? (o.innerKind !== undefined ? o.innerKind : o.kind) : o.kind, side ? (o.innerSlot || 0) : (o.slot || 0), side === 1, skip); }
    // the edge (band and hole rims) is a short strip at the band
    G.grid(NT, 1, function (u, s, out) { var p = at(u, 0, s > 0.5, tmp); out.p = p; out.n = [0, -1, 0]; out.u = u * 6; out.v = s * 0.05; out.seam = 0; out.ao = 0.8; }, o.kind, o.slot || 0, false, skip ? function (u) { return o.hole(-Math.PI + TAU * u, 0.001); } : null);
    return at;
  }
  // a brim: from the band outward; L(th) its length, tilt (radians down), curve(th, t) extra vertical, span of azimuth around th0
  function brim(G, K, o) {
    var NT = o.nt || 40, NR = o.nr || 8, span = o.span, th0 = o.th0 || 0, thick = o.thick || 0.004; var cz = K.c.z;
    var pt = function (u, t, under) { var th = th0 - span + 2 * span * u; var ph = o.band(th); var r = rsm(K, th, ph) + o.pad; var b = fromSph(K, th, ph, r, [0, 0, 0]); var dir = vnorm([b[0] - K.c.x, 0, b[2] - cz]); if (o.dirFn) dir = o.dirFn(th, dir);
      var L = o.L(th), x = t * L; var down = Math.sin(o.tilt) * x + (o.curve ? o.curve(th, t, x) : 0); var p = [b[0] + dir[0] * Math.cos(o.tilt) * x, b[1] - down - (under ? thick : 0), b[2] + dir[2] * Math.cos(o.tilt) * x]; return p; };
    for (var side = 0; side < 2; side++) G.grid(NT, NR, function (u, t, out) { out.p = pt(u, t, side === 1); out.n = side ? [0, -1, 0] : [0, 1, 0]; out.u = u * span * 2 * 0.1 * 10; out.v = t * 0.6; out.seam = t; out.ao = side ? 0.6 : 1; }, o.kind, side ? (o.underSlot !== undefined ? o.underSlot : o.slot || 0) : (o.slot || 0), side === 1);
    // outer edge
    G.grid(NT, 1, function (u, s, out) { out.p = pt(u, 1, s > 0.5); out.n = [0, 0, 1]; out.u = u * 4; out.v = s * 0.04; out.seam = 1; out.ao = 0.8; }, o.kind, o.edgeSlot !== undefined ? o.edgeSlot : (o.slot || 0), true);
    return pt;
  }
  // a tube / torus helper for cords, straps, booms, buttons
  function hTube(G, P, r, kind, slot, sides) { sides = sides || 8; var n = P.length; var D = P.map(function (p, i) { return vnorm(vsub(P[Math.min(n - 1, i + 1)], P[Math.max(0, i - 1)])); }); var b1 = vnorm(vcross(D[0], Math.abs(D[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])); var base = G.p.length / 3;
    for (var i = 0; i < n; i++) { b1 = vnorm(proj(b1, D[i])); var b2 = vcross(D[i], b1); var rr = typeof r === "function" ? r(i / (n - 1)) : r; for (var k = 0; k <= sides; k++) { var a = k / sides * TAU; var nr = vadd(vmult(b1, Math.cos(a)), b2, Math.sin(a)); G.v(vadd(P[i], nr, rr), nr, k / sides, i / (n - 1), kind, 0, slot, 1); } }
    for (i = 0; i < n - 1; i++) for (k = 0; k < sides; k++) { var a0 = base + i * (sides + 1) + k, b0 = a0 + sides + 1; G.i.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0); } }
  function hBlob(G, c, rx, ry, rz, kind, slot, ax) { var base = G.p.length / 3; var NU = 18, NV = 10; for (var j = 0; j <= NV; j++) for (var i = 0; i <= NU; i++) { var th = i / NU * TAU, ph = -Math.PI / 2 + Math.PI * j / NV; var n = [Math.cos(ph) * Math.sin(th), Math.sin(ph), Math.cos(ph) * Math.cos(th)]; var p = [c[0] + n[0] * rx, c[1] + n[1] * ry, c[2] + n[2] * rz]; if (ax) { p = ax(p, n); } G.v(p, n, i / NU, j / NV, kind, 0, slot, 1); }
    for (j = 0; j < NV; j++) for (i = 0; i < NU; i++) { var a = base + j * (NU + 1) + i, b = a + NU + 1; G.i.push(a, a + 1, b, a + 1, b + 1, b); } }
  AV.hTube = hTube; AV.hBlob = hBlob;

  // each hat: build(G, K, pad, body) returns the hat's cover description for the groom
  var HATB = {};
  function capBuild(G, K, pad, body, rev, trucker) {
    var hF = rev ? 0.062 : 0.05, hS = 0.03, hB = rev ? 0.02 : 0.004; var band = function (th) { var t2 = th - (rev ? Math.PI : 0); return bandPh(K, th, rev ? hB : hF, hS, rev ? hF : hB); };
    // forward cap: front at hF, back at hB; backwards: the same cap turned round, so its high front edge (now the brim side) is at the back
    band = function (th) { return rev ? bandPh(K, th, 0.06, 0.03, 0.03) : bandPh(K, th, hF, hS, hB); };
    var back = rev ? 0 : Math.PI, open = rev || trucker; var lim = function (th) { if (!open) return 0; var d = Math.abs(((th - back + Math.PI) % TAU + TAU) % TAU - Math.PI); if (d > 0.42) return 0; return 0.3 * Math.sqrt(Math.max(0, 1 - (d / 0.42) * (d / 0.42))); }; var hole = function (th, s) { return s < lim(th); };   // a fitted cap is closed; the snapback opening is an arch
    var frontDir = rev ? Math.PI : 0;
    var at = crown(G, K, { pad: pad + 0.002, thick: 0.0025, kind: PK.TWILL, innerKind: PK.TWILL, slot: 0, innerSlot: 0, band: band, s0: open ? lim : null, nt: 144, rev: frontDir,
      extra: function (th, s) { var c = Math.cos(th - frontDir); return 0.009 * Math.max(0, c) * Math.max(0, c) * Math.sin(Math.PI * Math.min(1, s * 1.15)) + 0.003 * Math.sin(Math.PI * s); },
      ao: function (th, s) { return 0.85 + 0.15 * s; } });
    if (trucker) { // mesh back panels: re-colour by azimuth in the shader (slot 1 = mesh), see aP.y seam
      for (var i = 0; i < G.a.length; i += 4) { var th = G.a[i + 1]; if (Math.abs(((th + Math.PI) % TAU + TAU) % TAU - Math.PI) > 1.05) { G.a[i] = PK.MESH; G.a[i + 2] = 1; } } }
    brim(G, K, { pad: pad + 0.002, band: band, th0: frontDir, span: 1.12, tilt: rev ? 0.2 : 0.14, kind: PK.TWILL, slot: 0, underSlot: 1, edgeSlot: 0,
      L: function (th) { var d = Math.abs(((th - frontDir + Math.PI) % TAU + TAU) % TAU - Math.PI) / 1.12; return 0.074 * Math.sqrt(Math.max(0, 1 - d * d)) + 0.004; },
      curve: function (th, t, x) { var d = (((th - frontDir + Math.PI) % TAU + TAU) % TAU - Math.PI) / 1.12; return 0.016 * d * d * t; } });
    // the button on top and the strap across the opening
    var top = fromSph(K, 0, Math.PI / 2 - 0.0005, rsm(K, 0, Math.PI / 2 - 0.0005) + pad + 0.002 + 0.003, [0, 0, 0]); hBlob(G, [top[0], top[1] + 0.002, top[2]], 0.007, 0.003, 0.007, PK.TWILL, 0);
    if (open) { var sp = []; for (var k = 0; k <= 10; k++) { var thk = back - 0.42 + 0.84 * k / 10; var ph = band(thk) + 0.02; sp.push(fromSph(K, thk, ph, rsm(K, thk, ph) + pad + 0.003, [0, 0, 0])); } hTube(G, sp, 0.004, PK.LEATHER, 0, 6); }
    return { band: band, surf: surfOf(at), covers: function (th, ph) { return ph > band(th) + 0.02 && !hole(th, (ph - band(th)) / (Math.PI / 2 - band(th))); }, rin: function (th, ph) { return rsm(K, th, ph) + pad - 0.001; }, minLen: 0.07, tailPh: band(Math.PI) + (rev ? -0.08 : 0.05), logo: { th: frontDir, s0: 0.2, s1: 0.48, w: 0.5 } };
  }
  HATB.cap = function (G, K, pad, body) { return capBuild(G, K, pad, body, false, false); };
  HATB.capback = function (G, K, pad, body) { return capBuild(G, K, pad, body, true, false); };
  HATB.trucker = function (G, K, pad, body) { return capBuild(G, K, pad, body, false, true); };
  HATB.beanie = function (G, K, pad, body) {
    var band = function (th) { return bandPh(K, th, 0.03, -0.004, -0.035); };
    var at = crown(G, K, { pad: pad + 0.004, thick: 0.004, kind: PK.KNIT, innerKind: PK.KNIT, slot: 0, band: band, ns: 26, sp: 1.0,
      extra: function (th, s) { var cuff = s < 0.22 ? 0.006 * sstep(0.0, 0.03, s) : 0.002 * (1 - sstep(0.22, 0.27, s)); return cuff + 0.008 * sstep(0.45, 0.9, s) * (0.5 + 0.5 * Math.max(0, -Math.cos(th))); },
      warp: function (p, th, s) { p[1] += 0.004 * sstep(0.6, 1, s); p[2] -= 0.008 * sstep(0.6, 1, s); },
      ao: function (th, s) { return s > 0.21 && s < 0.25 ? 0.6 : 1; } });
    return { band: band, surf: surfOf(at), covers: function (th, ph) { return ph > band(th) + 0.02; }, rin: function (th, ph) { return rsm(K, th, ph) + pad; }, minLen: 0.1, bunPh: band(Math.PI) - 0.15, tailPh: band(Math.PI) - 0.08, logo: { th: 0, s0: 0.05, s1: 0.19, w: 0.32 } };
  };
  HATB.bucket = function (G, K, pad, body) {
    var band = function (th) { return bandPh(K, th, 0.052, 0.034, 0.02); }; var top = K.eyeY + 0.122;
    var at = crown(G, K, { pad: pad + 0.006, thick: 0.003, kind: PK.CANVAS, slot: 0, band: band, ns: 18,
      warp: function (p, th, s) { // straighter sides and a flatter top than the head
        var b = fromSph(K, th, band(th), rsm(K, th, band(th)) + pad + 0.006, [0, 0, 0]); var y = b[1] + (top - b[1]) * Math.sin(Math.min(1, s * 1.2) * Math.PI / 2); var k = 1 - 0.16 * s - (s > 0.8 ? Math.pow((s - 0.8) / 0.2, 1.6) : 0) * 0.84; p[0] = K.c.x + (b[0] - K.c.x) * k; p[2] = K.c.z + (b[2] - K.c.z) * k; p[1] = s > 0.8 ? top + 0.004 * (1 - Math.pow((1 - s) / 0.2, 2)) * 0 : y; } });
    brim(G, K, { pad: pad + 0.006, band: band, th0: 0, span: Math.PI, nt: 72, tilt: 0.42, kind: PK.CANVAS, slot: 0, underSlot: 1, L: function () { return 0.055; } });
    return { band: band, covers: function (th, ph) { return ph > band(th) - 0.03; }, rin: function (th, ph) { return rsm(K, th, ph) + pad + 0.004; }, minLen: 0.08, bunPh: band(Math.PI) - 0.12, tailPh: band(Math.PI) - 0.06, surf: surfOf(at), logo: { th: 0, s0: 0.18, s1: 0.45, w: 0.36 } };
  };
  HATB.cowboy = function (G, K, pad, body) {
    var band = function (th) { return bandPh(K, th, 0.05, 0.04, 0.034); }; var crownH = 0.118;
    var bpt = function (th) { return fromSph(K, th, band(th), rsm(K, th, band(th)) + pad + 0.008, [0, 0, 0]); };
    crown(G, K, { pad: pad + 0.008, thick: 0.003, kind: PK.FELT, slot: 0, band: band, ns: 26,
      warp: function (p, th, s) { var b = bpt(th); var c = Math.cos(th); var h = crownH + 0.01 * (-c); var crease = 0; var pinch = 0.012 * sstep(0.6, 1, s) * Math.max(0, c) * Math.pow(Math.abs(Math.sin(th)), 0.5);
        var k = 1 - 0.13 * s - pinch / 0.08; if (s > 0.85) k *= 1 - (s - 0.85) / 0.15 * 0.85; var yTop = b[1] + h - crease * sstep(0.8, 1, s); var y = s > 0.85 ? yTop + 0.004 * (1 - (s - 0.85) / 0.15) : b[1] + h * (s / 0.85) * (0.95 + 0.05 * s);
        p[0] = K.c.x + (b[0] - K.c.x) * k; p[2] = K.c.z + (b[2] - K.c.z) * k; var cr = 0.03 * Math.exp(-Math.pow(p[0] - K.c.x, 2) / (2 * 0.022 * 0.022)) * sstep(0.72, 0.98, s); p[1] = Math.min(y, yTop + 0.004) - cr; } });
    brim(G, K, { pad: pad + 0.008, band: band, th0: 0, span: Math.PI, nt: 96, nr: 10, tilt: 0.0, kind: PK.FELT, slot: 0, underSlot: 0, thick: 0.004,
      L: function (th) { return 0.088 + 0.006 * Math.abs(Math.cos(th)); }, curve: function (th, t, x) { var s2 = Math.sin(th) * Math.sin(th); return -0.045 * s2 * t * t * t + 0.008 * (1 - s2) * t * t; } });
    // the hatband (leather) with a silver concho
    var hb = []; for (var k = 0; k <= 72; k++) { var th = -Math.PI + TAU * k / 72; var b = bpt(th); var d = vnorm([b[0] - K.c.x, 0, b[2] - K.c.z]); hb.push([b[0] + d[0] * 0.002, b[1] + 0.011, b[2] + d[2] * 0.002]); }
    G.grid(72, 1, function (u, s, out) { var i = Math.round(u * 72); var p = hb[i]; out.p = [p[0], p[1] - 0.011 + s * 0.022, p[2]]; var d = vnorm([p[0] - K.c.x, 0, p[2] - K.c.z]); out.n = d; out.u = u * 8; out.v = s * 0.2; out.seam = 0; out.ao = 1; }, PK.LEATHER, 1, true);
    var cb = bpt(-0.55); var dc = vnorm([cb[0] - K.c.x, 0, cb[2] - K.c.z]); hBlob(G, [cb[0] + dc[0] * 0.005, cb[1] + 0.011, cb[2] + dc[2] * 0.005], 0.009, 0.009, 0.009, PK.METAL, 2, function (p, n) { return [p[0] - dc[0] * Math.max(0, -vdot(n, dc)) * 0.006, p[1], p[2] - dc[2] * Math.max(0, -vdot(n, dc)) * 0.006]; });
    return { band: band, covers: function (th, ph) { return ph > band(th) - 0.03; }, rin: function (th, ph) { return rsm(K, th, ph) + pad + 0.005; }, minLen: 0.08, bunPh: band(Math.PI) - 0.12, tailPh: band(Math.PI) - 0.06 };
  };
  HATB.captain = function (G, K, pad, body) {
    var band = function (th) { return bandPh(K, th, 0.045, 0.036, 0.03); }; var bpt = function (th) { return fromSph(K, th, band(th), rsm(K, th, band(th)) + pad + 0.005, [0, 0, 0]); };
    var at = crown(G, K, { pad: pad + 0.005, thick: 0.003, kind: PK.TWILL, slot: 0, band: band, ns: 20,
      warp: function (p, th, s) { var b = bpt(th); var c = Math.cos(th); var wall = 0.032, flare = 0.011 + 0.006 * Math.max(0, c), lift = 0.06 + 0.016 * Math.max(0, c); var y, k;
        if (s < 0.35) { var t = s / 0.35; y = b[1] + wall * t; k = 1 + 0.06 * t * t; } else if (s < 0.7) { var t2 = (s - 0.35) / 0.35; y = b[1] + wall + (lift - wall) * Math.sin(t2 * Math.PI / 2); k = 1.06 + flare / 0.08 * Math.sin(t2 * Math.PI / 2); } else { var t3 = (s - 0.7) / 0.3; y = b[1] + lift - 0.006 * t3; k = (1.06 + flare / 0.08) * (1 - t3); }
        p[0] = K.c.x + (b[0] - K.c.x) * k; p[2] = K.c.z + (b[2] - K.c.z) * k; p[1] = y; } });
    // black band over the wall, the visor, the gold cord
    G.grid(72, 1, function (u, s, out) { var th = -Math.PI + TAU * u; var b = bpt(th); var d = vnorm([b[0] - K.c.x, 0, b[2] - K.c.z]); out.p = [b[0] + d[0] * 0.0015, b[1] + s * 0.03, b[2] + d[2] * 0.0015]; out.n = d; out.u = u * 8; out.v = s * 0.2; out.seam = 0; out.ao = 1; }, PK.TWILL, 1, true);
    brim(G, K, { pad: pad + 0.006, band: band, th0: 0, span: 1.15, tilt: 0.5, kind: PK.PLASTIC, slot: 1, underSlot: 1, edgeSlot: 1, L: function (th) { var d = th / 1.15; return 0.052 * Math.sqrt(Math.max(0, 1 - d * d)) + 0.003; }, curve: function (th, t) { var d = th / 1.15; return 0.01 * d * d * t; } });
    var cord = []; for (var k = 0; k <= 16; k++) { var th = -1.0 + 2.0 * k / 16; var b = bpt(th); var d = vnorm([b[0] - K.c.x, 0, b[2] - K.c.z]); cord.push([b[0] + d[0] * 0.004, b[1] + 0.008, b[2] + d[2] * 0.004]); } hTube(G, cord, 0.0022, PK.METAL, 2, 6);
    return { band: band, covers: function (th, ph) { return ph > band(th) + 0.02; }, rin: function (th, ph) { return rsm(K, th, ph) + pad + 0.003; }, minLen: 0.08, bunPh: band(Math.PI) - 0.12, tailPh: band(Math.PI) - 0.06, surf: surfOf(at), logo: { th: 0, s0: 0.4, s1: 0.6, w: 0.42, gold: true } };
  };
  HATB.headband = function (G, K, pad, body) { pad = Math.min(0.02, pad * 1.8 + 0.004);
    var lo = function (th) { return bandPh(K, th, 0.03, 0.02, 0.0); }, hi = function (th) { return bandPh(K, th, 0.066, 0.056, 0.036); };
    G.grid(72, 4, function (u, s, out) { var th = -Math.PI + TAU * u; var ph = lo(th) + (hi(th) - lo(th)) * s; var r = rsm(K, th, ph) + pad + 0.002 + 0.004 * Math.sin(Math.PI * s); out.p = fromSph(K, th, ph, r, [0, 0, 0]); out.n = vnorm(vsub(out.p, [K.c.x, K.c.y, K.c.z])); out.u = u * 30; out.v = s * 2; out.seam = th; out.ao = 1; }, PK.TERRY, 0, false);
    return { band: lo, covers: function (th, ph) { return ph > lo(th) && ph < hi(th); }, rin: function (th, ph) { return rsm(K, th, ph) + pad; }, minLen: 0.001, keepTop: true, surf: function (th, s) { var ph = lo(th) + (hi(th) - lo(th)) * s; return fromSph(K, th, ph, rsm(K, th, ph) + pad + 0.002 + 0.004 * Math.sin(Math.PI * s), [0, 0, 0]); }, logo: { th: 0, s0: 0.2, s1: 0.8, w: 0.3 } };
  };
  HATB.headset = function (G, K, pad, body) {
    // the ear position: the widest point of the head at ear height
    var earY = K.eyeY - 0.025, ex = 0; for (var i = 0; i < 20; i++) { var ph = Math.asin((earY - K.c.y) / 0.08); ex = Math.max(ex, rsm(K, Math.PI / 2, ph) * Math.cos(ph)); } var ez = K.c.z - 0.008;
    var cups = []; for (var sd = -1; sd <= 1; sd += 2) {
      var cx = sd * (ex + pad * 0.6 + 0.004); var ax = [sd, 0, 0];
      // shell: an elliptic cylinder capped with a dome, cushion ring toward the head
      G.grid(28, 6, function (u, t, out) { var a = u * TAU; var ry = 0.045, rz = 0.038; var dome = t > 0.6 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.6) / 0.4, 2))) : 1; var d = 0.004 + t * 0.03; out.p = [cx + sd * d, earY + Math.sin(a) * ry * dome, ez + Math.cos(a) * rz * dome]; out.n = t > 0.6 ? vnorm([sd * (t - 0.6) * 3, Math.sin(a) * dome, Math.cos(a) * dome]) : [0, Math.sin(a), Math.cos(a)]; out.u = u * 4; out.v = t; out.seam = 0; out.ao = 1; }, PK.PLASTIC, 0, sd > 0);
      G.grid(28, 1, function (u, t, out) { var a = u * TAU; var k = 0.86 + 0.06 * t; out.p = [cx + sd * (0.0335 + 0.0005), earY + Math.sin(a) * 0.045 * k, ez + Math.cos(a) * 0.038 * k]; out.n = [sd, 0, 0]; out.u = u; out.v = t; out.seam = 0; out.ao = 1; }, PK.METAL, 2, sd < 0);
      var ring = []; for (var k = 0; k <= 28; k++) { var a = k / 28 * TAU; ring.push([cx - sd * 0.003, earY + Math.sin(a) * 0.036, ez + Math.cos(a) * 0.03]); } hTube(G, ring, 0.009, PK.CUSHION, 1, 8);
      cups.push([cx, earY, ez]); }
    // headband over the top (in the plane of the cups, tipped forward a little) with a padded strip
    var arc = []; for (var k2 = 0; k2 <= 30; k2++) { var a2 = -Math.PI / 2 + Math.PI * k2 / 30; var th = a2 < 0 ? -Math.PI / 2 : Math.PI / 2; var ph = Math.PI / 2 - Math.abs(a2); var dir = [Math.sin(a2), Math.cos(a2), 0.06]; dir = vnorm(dir); var thh = Math.atan2(dir[0], dir[2]), phh = Math.asin(dir[1]); var r = rsm(K, thh, phh) + pad + 0.012; arc.push(fromSph(K, thh, phh, r, [0, 0, 0])); }
    arc[0] = [cups[0][0] * 0.98, cups[0][1] + 0.05, cups[0][2]]; arc[30] = [cups[1][0] * 0.98, cups[1][1] + 0.05, cups[1][2]];
    G.grid(30, 3, function (u, t, out) { var i = Math.round(u * 30); var p = arc[i]; var nn = vnorm(vsub(p, [K.c.x, K.c.y, K.c.z])); var w = (t - 0.5) * 0.034; out.p = [p[0], p[1], p[2] + w]; out.n = nn; out.u = u * 3; out.v = t; out.seam = 0; out.ao = 1; }, PK.PLASTIC, 1, false);
    G.grid(30, 3, function (u, t, out) { var i = Math.round(u * 30); var p = arc[i]; var nn = vnorm(vsub(p, [K.c.x, K.c.y, K.c.z])); var w = (t - 0.5) * 0.034; out.p = [p[0] - nn[0] * 0.005, p[1] - nn[1] * 0.005, p[2] + w]; out.n = [-nn[0], -nn[1], -nn[2]]; out.u = u * 3; out.v = t; out.seam = 0; out.ao = 0.7; }, PK.CUSHION, 1, true);
    // the yokes and the microphone boom (left side: the wearer's left is +x)
    for (var s3 = 0; s3 < 2; s3++) { var c = cups[s3]; var top = arc[s3 ? 30 : 0]; hTube(G, [[top[0], top[1], top[2]], [c[0], c[1] + 0.046, c[2]]], 0.003, PK.METAL, 2, 6); }
    var cL = cups[1], mouth = [0.018, K.eyeY - 0.085, K.eyeZ + 0.035]; var boom = []; for (var k3 = 0; k3 <= 14; k3++) { var t = k3 / 14; var p0 = [cL[0] + 0.02, cL[1] - 0.02, cL[2] + 0.02]; var mid = [cL[0] - 0.002, K.eyeY - 0.075, K.eyeZ - 0.01]; var a3 = vmix(vmix(p0, mid, t), vmix(mid, mouth, t), t); boom.push(a3); }
    hTube(G, boom, function (t) { return 0.0028 - 0.0008 * t; }, PK.PLASTIC, 0, 6); hBlob(G, mouth, 0.009, 0.009, 0.011, PK.CUSHION, 1);
    var dOf = function (th, ph) { var cp = Math.cos(ph); return [cp * Math.sin(th), Math.sin(ph), cp * Math.cos(th)]; };
    var inCup = function (th, ph) { var d = dOf(th, ph); if (Math.abs(d[0]) < 0.55) return false; var cx2 = Math.abs(cups[0][0]); var t = (cx2 - K.c.x * 0) / Math.abs(d[0]); var y = K.c.y + d[1] * t, z = K.c.z + d[2] * t; return Math.pow((y - earY) / 0.047, 2) + Math.pow((z - ez) / 0.04, 2) < 1; };
    var covers = function (th, ph) { var d = dOf(th, ph); return (Math.abs(d[2] - 0.06 * d[1]) < 0.2 && ph > 0.25) || inCup(th, ph); };
    return { band: function (th) { return Math.PI / 2; }, covers: covers, rin: function (th, ph) { if (inCup(th, ph)) { var d = dOf(th, ph); return Math.max(rsm(K, th, ph) + 0.002, (Math.abs(cups[0][0]) - 0.006) / Math.abs(d[0])); } return rsm(K, th, ph) + pad + 0.006; }, minLen: 0.001, keepTop: true, cups: cups };
  };
  // hat materials: one program for every hat; the pattern, colour slot and occlusion ride on the aP attribute
  function HAT_OBC(u) { return function (sh) {
    for (var k in u) sh.uniforms[k] = u[k];
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 aP; varying vec4 vHp; varying vec2 vHuv;").replace("#include <uv_vertex>", "#include <uv_vertex>\nvHp = aP; vHuv = uv;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; varying vec4 vHp; varying vec2 vHuv; float hK; float hH; float hRough; float hMetal;\n" +
      "float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\nfloat hn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }\n" +
      "float hAA(vec2 q, float f){ return clamp(1.0 - length(fwidth(q * f)) * 0.8, 0.0, 1.0); }\n" +
      "vec3 hPerturb(vec3 surf_pos, vec3 surf_norm, float h, float k){ vec3 vSigmaX = dFdx(surf_pos); vec3 vSigmaY = dFdy(surf_pos); vec3 R1 = cross(vSigmaY, surf_norm); vec3 R2 = cross(surf_norm, vSigmaX); float fDet = dot(vSigmaX, R1); vec2 dH = vec2(dFdx(h), dFdy(h)) * k; vec3 vGrad = sign(fDet) * (dH.x * R1 + dH.y * R2); return normalize(abs(fDet) * surf_norm - vGrad); }")
      .replace("#include <color_fragment>", "{ float kind = floor(vHp.x + 0.5); float slot = floor(vHp.z + 0.5); vec3 base = slot < 0.5 ? uC0 : slot < 1.5 ? uC1 : uC2; vec2 q = vHuv; hRough = 0.85; hMetal = 0.0; hH = 0.0; float al = 1.0;\n" +
        "  if (kind < 0.5) { hH = (0.5 + 0.5 * sin((q.x + q.y) * 700.0)) * hAA(q, 700.0); float seam = abs(fract(vHp.y * 0.9549 + 0.5) - 0.5); float st = smoothstep(0.012, 0.004, seam); hH -= st * 1.5; base *= 1.0 - 0.18 * st; base *= 0.92 + 0.12 * hn(q * 300.0); }\n" +
        "  else if (kind < 1.5) { float ak = hAA(q, 360.0); float rib = 0.5 + 0.5 * sin(q.x * 360.0); float knit = hn(vec2(q.x * 360.0, q.y * 240.0)); hH = (rib * 0.8 + knit * 0.6) * ak; base *= mix(0.93, 0.78 + 0.3 * rib, ak); hRough = 0.95; }\n" +
        "  else if (kind < 2.5) { hH = (hn(q * 600.0) * 0.6 + 0.4 * sin(q.y * 900.0) * sin(q.x * 900.0)) * hAA(q, 900.0); float ring = smoothstep(0.01, 0.0, abs(fract(q.y * 18.0) - 0.5) - 0.44); hH -= ring; base *= 0.9 + 0.15 * hn(q * 160.0) - 0.15 * ring; hRough = 0.92; }\n" +
        "  else if (kind < 3.5) { hH = hn(q * 520.0) * 0.4; base *= 0.88 + 0.18 * hn(q * 60.0); hRough = 0.88; }\n" +
        "  else if (kind < 4.5) { hH = hn(q * vec2(40.0, 160.0)) + 0.5 * hn(q * 600.0); base *= 0.85 + 0.2 * hH; hRough = 1.0; }\n" +
        "  else if (kind < 5.5) { hH = hn(q * 320.0) * 0.5; base *= 0.85 + 0.2 * hn(q * 40.0); hRough = 0.55; }\n" +
        "  else if (kind < 6.5) { hH = hn(q * 200.0) * 0.08; hRough = 0.32; }\n" +
        "  else if (kind < 7.5) { hRough = 0.32; hMetal = 0.82; }\n" +
        "  else if (kind < 8.5) { float am = hAA(q, 200.0); vec2 cell = fract(q * 200.0) - 0.5; float hole = smoothstep(0.32, 0.26, length(cell)) * am; base *= 1.0 - 0.75 * mix(0.35, hole, am); hH = -hole; hRough = 0.95; }\n" +
        "  else { hH = hn(q * 400.0) * 0.3; base *= 0.9 + 0.1 * hn(q * 80.0); hRough = 0.62; }\n" +
        "  diffuseColor.rgb = base * vHp.w; hK = kind; }")
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = hRough;").replace("#include <metalnessmap_fragment>", "float metalnessFactor = hMetal;")
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = hPerturb(-vViewPosition, normal, hH, 0.0006);");
    if (window.PLAN_CHARFX && PLAN_CHARFX.on && PLAN_CHARFX.ext) PLAN_CHARFX.ext(sh, "hat");   // R16: cloth sheen and wrap on the fabric kinds (plan_charfx.js)
  }; }
  var HATMAT = AV.HATMAT = AV.HATMAT || new Map();
  AV.hatMat = function (hatId, ci) { var H = AV.HATS[hatId]; if (!H || !H.colors) return null; var cols = H.colors[(ci || 0) % H.colors.length]; var key = hatId + ":" + (ci || 0) % H.colors.length; var m = HATMAT.get(key); if (m) return m;
    m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.FrontSide, envMapIntensity: 0.8 });
    m.userData.u = { uC0: { value: hairCol(cols[0]) }, uC1: { value: hairCol(cols[1]) }, uC2: { value: hairCol(cols[2]) } }; m.onBeforeCompile = HAT_OBC(m.userData.u); m.name = "avHat"; m.userData.avShared = true; AV.n.mats++; HATMAT.set(key, m); return m; };
  // a logo decal hugging the front of a crown (the GIVEBACK mark from /tex/gb_logo.png)
  function surfOf(at) { return function (th, s) { return at(((th + Math.PI) / TAU % 1 + 1) % 1, s, false, {}); }; }
  function logoGeo(K, hat, cov, pad) { var L = cov.logo; if (!L || !cov.surf) return null; var G = new HG(); var cen = [K.c.x, K.c.y, K.c.z];
    G.grid(16, 8, function (u, v, out) { var th = L.th + (u - 0.5) * L.w, sv = L.s0 + (L.s1 - L.s0) * v; var p = cov.surf(th, sv); var d = vnorm(vsub(p, cen)); out.p = vadd(p, d, 0.0012); out.n = d; out.u = u; out.v = v; out.seam = 0; out.ao = 1; }, 0, 0, false); return G; }
  // build (or fetch) a hat for a body and a hair thickness class
  var HATG = AV.HATG = AV.HATG || new Map();
  AV.hat = function (body, hatId, pad) {
    var K = KIT[body]; var H = AV.HATS[hatId]; if (!K || !H || !HATB[H.key]) return null; pad = Math.round((pad || 0.005) * 1000) / 1000; var key = body + ":" + hatId + ":" + pad; var h = HATG.get(key); if (h) { h.used = performance.now(); return h; }
    var t0 = performance.now(); var G = new HG(); var cov = HATB[H.key](G, K, pad, body); var geo = skinAttrs(K, G.geo(), false); geo.computeBoundingSphere(); geo.userData.avShared = true;
    var logo = null; if (cov.logo) { var LG = logoGeo(K, H, cov, pad); if (LG) { logo = skinAttrs(K, LG.geo(), false); logo.userData.avShared = true; logo.userData.gold = !!cov.logo.gold; } }
    h = { key: key, geo: geo, logo: logo, cover: cov, used: performance.now(), ms: performance.now() - t0, verts: G.p.length / 3, hatKey: H.key + ":" + pad };
    cov.key = H.key + ":" + pad; AV.n.hats++; AV.n.hatMs += h.ms; HATG.set(key, h); return h;
  };
  var LOGOMAT = {}; AV.logoMat = function (gold) { var k = gold ? "g" : "w"; if (LOGOMAT[k]) return LOGOMAT[k]; var t = typeof LOGO_TEX !== "undefined" ? LOGO_TEX : null; var m = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.08, depthWrite: false, roughness: 0.6, metalness: gold ? 0.8 : 0, color: gold ? 0xf4cd5a : 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); m.name = "avLogo"; m.userData.avShared = true; LOGOMAT[k] = m; return m; };

  // ───────── eyewear and accessories, fitted from each body's landmarks (eyes, nose bridge, ears, neck, wrist) ─────────
  // look.ey: 0 none, 1 aviators, 2 round, 3 rectangular, 4 sport shield.  look.ac bits: 1 gold chain, 2 earrings, 4 watch
  AV.EYEWEAR = [{ id: 0, key: "none", n: "None" }, { id: 1, key: "aviator", n: "Aviators" }, { id: 2, key: "round", n: "Round frames" }, { id: 3, key: "rect", n: "Square frames" }, { id: 4, key: "sport", n: "Sport shield" }];
  AV.ACCS = [{ bit: 1, key: "chain", n: "Gold chain" }, { bit: 2, key: "earrings", n: "Earrings" }, { bit: 4, key: "watch", n: "Watch" }];
  function skinBone(K, geo, bones) { // bones: [[index, weight], ...] or a function(p) -> [[i, w], ...]
    var P = geo.attributes.position, n = P.count, ji = new Uint16Array(n * 4), wt = new Float32Array(n * 4);
    for (var i = 0; i < n; i++) { var b = typeof bones === "function" ? bones(P.getX(i), P.getY(i), P.getZ(i)) : bones; for (var k = 0; k < Math.min(4, b.length); k++) { ji[i * 4 + k] = b[k][0]; wt[i * 4 + k] = b[k][1]; } }
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(ji, 4)); geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(wt, 4)); return geo; }
  AV.skinBone = skinBone;
  // a closed outline -> a flat lens (fan) and the rim tube along it; points in the frame's local plane, then wrapped round the face
  function outline(kind) { var pts = [], N = 40;
    for (var i = 0; i < N; i++) { var a = i / N * TAU, x, y;
      if (kind === "aviator") { x = Math.cos(a) * 0.027; y = Math.sin(a) * 0.022; if (y < 0) { y *= 1.15; x *= 1 - 0.25 * Math.max(0, -Math.sin(a)) * (Math.cos(a) < 0 ? 1.2 : 0.4); } y += 0.002 * Math.cos(a); }
      else if (kind === "round") { x = Math.cos(a) * 0.022; y = Math.sin(a) * 0.021; }
      else { var ex = 4, cx = Math.cos(a), sy = Math.sin(a); x = Math.sign(cx) * Math.pow(Math.abs(cx), 2 / ex) * 0.026; y = Math.sign(sy) * Math.pow(Math.abs(sy), 2 / ex) * 0.0175; }
      pts.push([x, y]); } return pts; }
  AV.glasses = function (body, id) {
    var K = KIT[body]; var E = AV.EYEWEAR[id]; if (!K || !E || !id || !K.eyes) return null; var key = body + ":" + id; var cache = AV.GLASS = AV.GLASS || new Map(); var hit = cache.get(key); if (hit) return hit;
    var ey = K.eyes, cx = (ey.xl - ey.xr) / 2, cy = ey.y + 0.003, fz = Math.max(ey.z, K.nose.z - 0.004) + 0.014; var G = new HG(), L = new HG();
    var wrap = function (x, y) { return [x, y, fz - 2.2 * x * x]; };   // the front follows the face's curve
    var rimR = id === 1 ? 0.0011 : id === 4 ? 0.0016 : id === 2 ? 0.0022 : 0.0026, frameKind = id === 1 ? PK.METAL : PK.PLASTIC, frameSlot = 0;
    var halfW = 0;
    if (id === 4) { // one shield across both eyes with a top bar
      L.grid(30, 6, function (u, v, out) { var x = (u - 0.5) * 0.15, y = cy + 0.022 - v * 0.045 * (1 - 0.35 * Math.pow(Math.abs(u - 0.5) * 2, 3)) + 0.004 * Math.pow(Math.abs(u - 0.5) * 2, 2); if (Math.abs(x) < 0.012) y = Math.max(y, cy + 0.022 - v * 0.03); var p = [x, y, fz + 0.004 - 2.6 * x * x]; out.p = p; out.n = vnorm([x * 4.4, 0, 1]); out.u = u; out.v = v; out.seam = 0; out.ao = 1; }, 0, 0, false);
      var top = []; for (var k = 0; k <= 24; k++) { var x2 = (k / 24 - 0.5) * 0.15; top.push([x2, cy + 0.023, fz + 0.004 - 2.6 * x2 * x2]); } hTube(G, top, 0.0022, PK.PLASTIC, 0, 6); halfW = 0.075;
    } else {
      var ol = outline(E.key); halfW = cx + 0.027;
      for (var sd = -1; sd <= 1; sd += 2) { var ring = ol.map(function (q) { return wrap(sd * cx + q[0] * (sd > 0 ? 1 : -1), cy + q[1]); }); ring.push(ring[0]); hTube(G, ring, rimR, frameKind, frameSlot, 6);
        // lens: a fan from the centre, set just behind the rim
        var c0 = wrap(sd * cx, cy); var base = L.p.length / 3; L.v([c0[0], c0[1], c0[2] - 0.0006], [0, 0, 1], 0.5, 0.5, 0, 0, 0, 1); for (var j = 0; j < ring.length - 1; j++) { var r = ring[j]; L.v([r[0], r[1], r[2] - 0.0006], vnorm([r[0] * 4.4, 0, 1]), 0.5 + (r[0] - c0[0]) * 18, 0.5 + (r[1] - c0[1]) * 18, 0, 0, 0, 1); }
        var nR = ring.length - 1; for (j = 0; j < nR; j++) { if (sd > 0) L.i.push(base, base + 1 + j, base + 1 + (j + 1) % nR); else L.i.push(base, base + 1 + (j + 1) % nR, base + 1 + j); } }
      // bridge (aviators: a double bar)
      var br = []; for (var k2 = 0; k2 <= 8; k2++) { var t = k2 / 8, x3 = -cx + 0.02 + (2 * cx - 0.04) * t; br.push(wrap(x3, cy + 0.008 + 0.004 * Math.sin(Math.PI * t))); } hTube(G, br, rimR * 0.9, frameKind, frameSlot, 6);
      if (id === 1) { var br2 = []; for (k2 = 0; k2 <= 8; k2++) { var t2 = k2 / 8, x4 = -cx + 0.018 + (2 * cx - 0.036) * t2; br2.push(wrap(x4, cy + 0.017)); } hTube(G, br2, rimR * 0.8, frameKind, frameSlot, 6); }
      // nose pads
      for (sd = -1; sd <= 1; sd += 2) hBlob(G, [sd * 0.0085, cy - 0.006, K.nose.z - 0.004], 0.003, 0.005, 0.0015, PK.PLASTIC, 1); }
    // temples: from the hinge back along the side of the head to the ear, with the hook behind it
    var earX = K.ear ? K.ear.x : 0.075, earZ = K.ear ? K.ear.z : K.c.z;
    for (var s2 = -1; s2 <= 1; s2 += 2) { var tp = []; var hx = s2 * halfW, hz = fz - 2.2 * halfW * halfW; for (var k3 = 0; k3 <= 14; k3++) { var t3 = k3 / 14; var z = hz + (earZ - 0.012 - hz) * t3; var th = Math.atan2(s2, 0.0001); var y = cy + 0.004 - 0.003 * t3;
        var ph = Math.asin(Math.max(-1, Math.min(1, (y - K.c.y) / 0.09))); var rr = 0; for (var q = 0; q < 2; q++) { var dz = z - K.c.z; var thq = Math.atan2(s2 * 0.08, dz); rr = gridAt(K, K.rout, thq, ph); } var wx = Math.sqrt(Math.max(0, rr * rr * Math.cos(ph) * Math.cos(ph) - (z - K.c.z) * (z - K.c.z)));
        var x = s2 * Math.max(Math.abs(hx) * (1 - t3) + (wx + 0.004) * t3, wx + 0.003); if (t3 < 0.15) x = hx + (x - hx) * t3 / 0.15; tp.push([x, y, z]); }
      var last = tp[tp.length - 1]; tp.push([last[0] * 0.96, last[1] - 0.012, last[2] - 0.01]); tp.push([last[0] * 0.92, last[1] - 0.022, last[2] - 0.006]); hTube(G, tp, id === 1 ? 0.0011 : 0.0016, frameKind, frameSlot, 6); }
    var H = K.bones.Head; var fg = skinBone(K, G.geo(), [[H, 1]]); var lg = L.p.length ? skinBone(K, L.geo(), [[H, 1]]) : null; fg.userData.avShared = true; if (lg) lg.userData.avShared = true;
    hit = { frame: fg, lens: lg, id: id }; cache.set(key, hit); return hit; };
  var GMAT = {};
  AV.glassMats = function (id) { if (GMAT[id]) return GMAT[id]; var fc = { 1: ["c9a24d", "3a3a3a", "f4cd5a"], 2: ["5a3a22", "c9a24d", "c9a24d"], 3: ["141414", "2a2a2a", "c0c4c8"], 4: ["1a1c20", "1a1c20", "4dde6f"] }[id] || ["141414", "2a2a2a", "c0c4c8"];
    var frame = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0 }); frame.userData.u = { uC0: { value: hairCol(fc[0]) }, uC1: { value: hairCol(fc[1]) }, uC2: { value: hairCol(fc[2]) } }; frame.onBeforeCompile = HAT_OBC(frame.userData.u); frame.name = "avHat"; frame.userData.avShared = true;
    var lc = { 1: [0x1a2a22, 0.82, 0.35], 2: [0xd8e4e0, 0.22, 0.0], 3: [0xdfe8ec, 0.2, 0.0], 4: [0x0e3a2c, 0.86, 0.75] }[id] || [0x1a1a1a, 0.8, 0.2];
    var lens = new THREE.MeshPhysicalMaterial({ color: lc[0], transparent: true, opacity: lc[1], roughness: 0.05, metalness: lc[2], envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03 }); lens.name = "avLens"; lens.userData.avShared = true;
    return (GMAT[id] = { frame: frame, lens: lens }); };
  // the gold chain, the earrings and the watch
  AV.accGeo = function (body, key) {
    var K = KIT[body]; if (!K) return null; var cache = AV.ACCG = AV.ACCG || new Map(); var ck = body + ":" + key; var hit = cache.get(ck); if (hit) return hit; var G = new HG(); var B = K.bones;
    if (key === "chain") { // rests on the base of the neck just above the tee's collar, dips onto the chest at the front
      var col = K.collar, nC = col ? col.length : 0, path = []; var colAt = function (a) { if (!col) return [K.neck.y - 0.01, 0.06]; var u = (a + Math.PI) / TAU * nC, i0 = Math.floor(u) % nC, i1 = (i0 + 1) % nC, f = u - Math.floor(u); return [col[i0][0] * (1 - f) + col[i1][0] * f, col[i0][1] * (1 - f) + col[i1][1] * f]; };
      // a smooth closed curve: the collar ring (low passed, the mesh neckline is jagged), lifted onto the chest at the front, never inside the tee
      var N = 72, Y = [], R = [], D = [], Sf = [], dipA = body === "f" ? 0.05 : 0.062, sm = function (A, it) { for (var q = 0; q < it; q++) { var Bq = A.slice(); for (var k = 0; k < N; k++) A[k] = (Bq[(k + N - 2) % N] + 4 * Bq[(k + N - 1) % N] + 6 * Bq[k] + 4 * Bq[(k + 1) % N] + Bq[(k + 2) % N]) / 16; } };
      for (var k = 0; k < N; k++) { var a = -Math.PI + TAU * k / N; var cl = colAt(a); D[k] = dipA * Math.pow(Math.max(0, Math.cos(a)), 2.5); Y[k] = cl[0] + 0.004; R[k] = cl[1] + 0.0075; }
      sm(Y, 5); sm(R, 5); for (k = 0; k < N; k++) Y[k] -= D[k];
      var surfAt = function (y, a) { var v = torsoR(K, y, a, "vest"); if (Math.abs(a) < 1.1) v = Math.max(v, torsoR(K, y, a, false) * (Math.abs(a) < 0.9 ? 1 : 0)); return v; };
      for (k = 0; k < N; k++) Sf[k] = surfAt(Y[k], -Math.PI + TAU * k / N) + 0.0045;
      var S2 = Sf.map(function (v, k) { return Math.max(Sf[(k + N - 2) % N], Sf[(k + N - 1) % N], v, Sf[(k + 1) % N], Sf[(k + 2) % N]); }); sm(S2, 3);
      for (k = 0; k < N; k++) { var w = Math.min(1, D[k] / 0.016); R[k] = R[k] * (1 - w) + Math.max(S2[k], R[k] * 0.8) * w; } sm(R, 2); for (k = 0; k < N; k++) if (D[k] > 0.003) R[k] = Math.max(R[k], S2[k]);
      var path = []; for (k = 0; k <= N; k++) { var kk = k % N, a1 = -Math.PI + TAU * kk / N; path.push([K.c.x + Math.sin(a1) * R[kk], Y[kk], K.c.z + Math.cos(a1) * R[kk]]); }
      hTube(G, path, 0.0021, PK.METAL, 0, 6);
      // the pendant lies flat on the chest: its plane follows the slope of the tee below the lowest link
      var lo = path[36], yc = lo[1] - 0.02, rs = function (y) { return surfAt(y, 0); }, sl = (rs(yc + 0.008) - rs(yc - 0.008)) / 0.016;
      var tg = vnorm([0, 1, sl]), nn = vnorm([0, -sl, 1]); var cc = vadd([0, yc, K.c.z + rs(yc)], nn, 0.0042); var ex = [1, 0, 0];
      G.grid(20, 1, function (u, s, out) { var a2 = u * TAU; out.p = vadd(vadd(vadd(cc, ex, Math.cos(a2) * 0.0145), tg, Math.sin(a2) * 0.0145), nn, (s - 0.5) * 0.003); out.n = vadd(vmult(ex, Math.cos(a2)), tg, Math.sin(a2)); out.u = u; out.v = s; out.seam = 0; out.ao = 1; }, PK.METAL, 0, false);
      G.grid(20, 1, function (u, s, out) { var a2 = u * TAU; var rr = 0.0145 * s; out.p = vadd(vadd(vadd(cc, ex, Math.cos(a2) * rr), tg, Math.sin(a2) * rr), nn, 0.0015); out.n = nn; out.u = u; out.v = s; out.seam = 0; out.ao = 1; }, PK.METAL, 2, true);
      hTube(G, [[0, lo[1] + 0.001, lo[2]], vadd(cc, tg, 0.0145)], 0.0012, PK.METAL, 0, 5);
      var yTop = K.neck.y - 0.03; hit = { geo: skinBone(K, G.geo(), function (x, y, z) { return [[B.Spine, 1]]; }), coin: cc }; }
    else if (key === "earrings") { var e = K.earring; for (var sd = -1; sd <= 1; sd += 2) { var p0 = [sd * e[0], e[1], e[2]];
        if (body === "f") { var ring = []; for (var k2 = 0; k2 <= 24; k2++) { var a3 = k2 / 24 * TAU; ring.push([p0[0], p0[1] - 0.011 + Math.cos(a3) * 0.011, p0[2] + Math.sin(a3) * 0.011]); } hTube(G, ring, 0.0011, PK.METAL, 0, 6); }
        else { hBlob(G, p0, 0.0024, 0.0024, 0.0016, PK.METAL, 2); } }
      hit = { geo: skinBone(K, G.geo(), [[B.Head, 1]]) }; }
    else if (key === "watch") { var W = K.wrist, ax = W.ax, c0 = W.p, r0 = W.r + 0.002; var b1 = vnorm(vcross(ax, [0, 0, 1])), b2 = vcross(ax, b1);
        // the band (two loops) and the case on the back of the wrist (+x side of the left arm points outward in the A pose)
        for (var bnd = -1; bnd <= 1; bnd += 2) { var loop = []; for (var k3 = 0; k3 <= 28; k3++) { var a4 = k3 / 28 * TAU; loop.push(vadd(vadd(vadd(c0, ax, bnd * 0.004), b1, Math.cos(a4) * r0), b2, Math.sin(a4) * r0 * 0.82)); } hTube(G, loop, 0.0028, PK.LEATHER, 1, 6); }
        var out = vnorm(vadd(b1, b2, 0)); var cpos = vadd(c0, b1, r0 + 0.003); G.grid(24, 1, function (u, s, o2) { var a5 = u * TAU; var p = vadd(vadd(vadd(cpos, ax, Math.cos(a5) * 0.017), b2, Math.sin(a5) * 0.017), b1, (s - 0.5) * 0.007); o2.p = p; o2.n = vadd(vmult(ax, Math.cos(a5)), b2, Math.sin(a5)); o2.u = u; o2.v = s; o2.seam = 0; o2.ao = 1; }, PK.METAL, 2, true);
        G.grid(24, 1, function (u, s, o2) { var a5 = u * TAU; var rr = 0.016 * s; o2.p = vadd(vadd(vadd(cpos, ax, Math.cos(a5) * rr), b2, Math.sin(a5) * rr), b1, 0.0036); o2.n = b1; o2.u = u; o2.v = s; o2.seam = 0; o2.ao = 1; }, PK.PLASTIC, 0, false);
        hit = { geo: skinBone(K, G.geo(), [[B.LeftHand, 0.35], [B.LeftForeArm, 0.65]]) }; }
    if (hit) { hit.geo.userData.avShared = true; cache.set(ck, hit); } return hit; };
  AV.accMat = function (key) { var cols = { chain: ["d4af37", "d4af37", "f4cd5a"], earrings: ["d4af37", "d4af37", "f2f4f8"], watch: ["101418", "3a2a1e", "c0c4c8"] }[key]; var k = "acc:" + key; var m = HATMAT.get(k); if (m) return m;
    m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0 }); m.userData.u = { uC0: { value: hairCol(cols[0]) }, uC1: { value: hairCol(cols[1]) }, uC2: { value: hairCol(cols[2]) } }; m.onBeforeCompile = HAT_OBC(m.userData.u); m.name = "avHat"; m.userData.avShared = true; HATMAT.set(k, m); return m; };


  // ───────── Giveback Store gear fitted to the torso (bandana, scarf, lanyard, backpack, crew vest) ─────────
  // The torso field gives the body's radius round the spine per height and azimuth; weights follow the spine bones by height.
  function spineW(K, y) { var B = K.bones, S0 = K.bonesY; if (!S0) return [[B.Spine, 1]]; var y2 = S0.Spine02, y1 = S0.Spine01, y0 = S0.Spine;
    if (y >= y0) return [[B.Spine, 1]]; if (y >= y1) { var t = (y - y1) / (y0 - y1); return [[B.Spine, t], [B.Spine01, 1 - t]]; } if (y >= y2) { var t2 = (y - y2) / (y1 - y2); return [[B.Spine01, t2], [B.Spine02, 1 - t2]]; } return [[B.Spine02, 1]]; }
  function ring(K, y, a, off, field) { var r = torsoR(K, y, a, field || true); if (r < 0.03) r = 0.06; r += off; return [K.c.x + Math.sin(a) * r, y, K.c.z + Math.cos(a) * r]; }
  AV.gearGeo = function (body, key) {
    var K = KIT[body]; if (!K || !K.neck) return null; var cache = AV.ACCG = AV.ACCG || new Map(); var ck = body + ":g:" + key; var hit = cache.get(ck); if (hit) return hit; var G = new HG(); var B = K.bones; var yN = K.neck.y; var cen = [K.c.x, 0, K.c.z];
    var wNeck = function (x, y, z) { return y > yN - 0.02 ? [[B.neck, 0.5], [B.Spine, 0.5]] : spineW(K, y); };
    if (key === "bandana") { G.grid(48, 3, function (u, s, o) { var a = -Math.PI + TAU * u; var y = yN - 0.03 + s * 0.035 - 0.012 * Math.max(0, Math.cos(a)); var p = ring(K, y, a, 0.009 + 0.003 * Math.sin(Math.PI * s)); o.p = p; o.n = vnorm(vsub(p, [cen[0], p[1], cen[2]])); o.u = u * 6; o.v = s * 0.4; o.seam = 0; o.ao = 1; }, PK.CANVAS, 0, false);
      G.grid(10, 6, function (u, s, o) { var a = (u - 0.5) * 1.1 * (1 - s); var y = yN - 0.042 - s * 0.085; var p = ring(K, y, a, 0.011 + 0.004 * (1 - s)); o.p = p; o.n = vnorm(vsub(p, [cen[0], p[1], cen[2]])); o.u = u; o.v = s; o.seam = 0; o.ao = 0.95; }, PK.CANVAS, 0, false);
      hit = { geo: skinBone(K, G.geo(), wNeck) }; }
    else if (key === "scarf") { var loop = []; for (var k = 0; k <= 40; k++) { var a = -Math.PI + TAU * k / 40; loop.push(ring(K, yN - 0.035 - 0.02 * Math.max(0, Math.cos(a)), a, 0.02)); } hTube(G, loop, 0.017, PK.KNIT, 0, 10);
      for (var sd = -1; sd <= 1; sd += 2) G.grid(4, 10, function (u, s, o) { var a = sd * 0.28 + (u - 0.5) * 0.5; var y = yN - 0.06 - s * 0.24; var p = ring(K, y, a, 0.012 + 0.006 * (sd > 0 ? 1 : 0)); o.p = p; o.n = vnorm(vsub(p, [cen[0], p[1], cen[2]])); o.u = u * 2; o.v = s * 4; o.seam = 0; o.ao = 0.95; }, PK.KNIT, 0, false);
      hit = { geo: skinBone(K, G.geo(), wNeck) }; }
    else if (key === "lanyard") { var cord = []; for (var k2 = 0; k2 <= 48; k2++) { var a2 = -Math.PI + TAU * k2 / 48; var c = Math.max(0, Math.cos(a2)); var y2 = yN - 0.03 - 0.15 * Math.pow(c, 4); cord.push(ring(K, y2, a2 * (1 - 0.35 * c * c), 0.0065)); } hTube(G, cord, 0.0028, PK.CANVAS, 0, 5);
      var yc = yN - 0.18 - 0.045; var pc = ring(K, yc, 0, 0.006); G.grid(1, 1, function (u, s, o) { var p = ring(K, yc - 0.0425 + s * 0.085, (u - 0.5) * 0.75, 0.007); o.p = p; o.n = [0, 0, 1]; o.u = u; o.v = s; o.seam = 0; o.ao = 1; }, PK.PLASTIC, 1, false);
      var LG = new HG(); LG.grid(1, 1, function (u, s, o) { var p = ring(K, yc - 0.03 + s * 0.03, (0.5 - u) * 0.55, 0.0085); o.p = p; o.n = [0, 0, 1]; o.u = u; o.v = s; o.seam = 0; o.ao = 1; }, 0, 0, false);
      hit = { geo: skinBone(K, G.geo(), wNeck), logo: skinBone(K, LG.geo(), wNeck) }; }
    else if (key === "backpack") { var yb = yN - 0.2, H2 = 0.36, W2 = 0.13, D2 = 0.12; var back = K.c.z - torsoR(K, yb, Math.PI, "vest") - 0.008;
      // a rounded box shell (superellipse cross-section), the lid, and straps over the shoulders
      G.grid(32, 10, function (u, s, o) { var a = u * TAU; var cx = Math.cos(a), sz = Math.sin(a); var e = 0.35; var x = Math.sign(cx) * Math.pow(Math.abs(cx), e) * W2, z = Math.sign(sz) * Math.pow(Math.abs(sz), e) * D2 * 0.5; var y = yb - H2 * 0.55 + H2 * s; var top = s > 0.85 ? (s - 0.85) / 0.15 : 0; var k = 1 - 0.25 * top * top; o.p = [x * k, y, back - D2 * 0.5 + z * k]; o.n = vnorm([cx, top * 0.6, sz]); o.u = u * 3; o.v = s * 2; o.seam = 0; o.ao = 1; }, PK.CANVAS, 0, true);
      G.grid(12, 1, function (u, s, o) { var a = u * TAU; o.p = [Math.cos(a) * W2 * 0.93 * s, yb + H2 * 0.45, back - D2 * 0.5 + Math.sin(a) * D2 * 0.45 * s]; o.n = [0, 1, 0]; o.u = u; o.v = s; o.seam = 0; o.ao = 1; }, PK.CANVAS, 1, true);
      G.grid(12, 1, function (u, s, o) { var a = u * TAU; o.p = [Math.cos(a) * W2 * 0.93 * s, yb - H2 * 0.55, back - D2 * 0.5 + Math.sin(a) * D2 * 0.45 * s]; o.n = [0, -1, 0]; o.u = u; o.v = s; o.seam = 0; o.ao = 0.7; }, PK.CANVAS, 0, false);
      for (var sd2 = -1; sd2 <= 1; sd2 += 2) { var st = []; for (var k3 = 0; k3 <= 16; k3++) { var t = k3 / 16; var a3 = sd2 * (Math.PI - t * (Math.PI - 0.62)); var y3 = t < 0.5 ? yb + H2 * 0.4 + (yN - 0.035 - yb - H2 * 0.4) * Math.sin(t * Math.PI) : yN - 0.035 - (yN - 0.035 - (yb - 0.06)) * (t - 0.5) * 2; st.push(ring(K, y3, a3 * (t < 0.5 ? 1 : 1) + sd2 * 0.0, 0.006)); } hTube(G, st, 0.006, PK.CANVAS, 1, 5); }
      var wPack = function (x, y, z) { return spineW(K, Math.max(y, K.bonesY ? K.bonesY.Spine01 : y)); };
      var LP = new HG(); LP.grid(1, 1, function (u, s, o) { o.p = [(u - 0.5) * 0.15, yb - 0.02 + (s - 0.5) * 0.075, back - D2 - 0.0035]; o.n = [0, 0, -1]; o.u = u; o.v = s; o.seam = 0; o.ao = 1; }, 0, 0, true);
      hit = { geo: skinBone(K, G.geo(), wPack), logo: skinBone(K, LP.geo(), wPack) }; }
    else if (key === "vest") { var y0 = K.eyeY - 0.53, y1 = yN - 0.055; var armY = yN - 0.17;
      G.grid(64, 16, function (u, s, o) { var a = -Math.PI + TAU * u; var y = y0 + (y1 - y0) * s; var p = ring(K, y, a, 0.016 + 0.004 * (1 - s), "vest"); o.p = p; o.n = vnorm(vsub(p, [cen[0], p[1], cen[2]])); o.u = u * 8; o.v = s * 4; o.seam = 0; o.ao = 1; }, PK.CANVAS, 0, false, function (u, s) { var a = -Math.PI + TAU * u; var y = y0 + (y1 - y0) * s; if (Math.abs(a) < 0.05) return true; if (y > armY && Math.abs(Math.sin(a)) > 0.72) return true; if (y > yN - 0.1 && Math.abs(Math.cos(a)) > 0.5 && Math.abs(Math.sin(a)) < 0.6) return true; return false; });
      for (var bnd = 0; bnd < 2; bnd++) { var yy = bnd ? y0 + 0.07 : y0 + 0.19; G.grid(64, 1, function (u, s, o) { var a = -Math.PI + TAU * u; var y = yy + s * 0.03; var p = ring(K, y, a, 0.0205, "vest"); o.p = p; o.n = vnorm(vsub(p, [cen[0], p[1], cen[2]])); o.u = u * 8; o.v = s; o.seam = 0; o.ao = 1; }, PK.METAL, 1, false, function (u) { var a = -Math.PI + TAU * u; return Math.abs(a) < 0.05; }); }
      hit = { geo: skinBone(K, G.geo(), function (x, y, z) { return spineW(K, y); }) }; }
    if (hit) { hit.geo.userData.avShared = true; if (hit.logo) hit.logo.userData.avShared = true; cache.set(ck, hit); } return hit; };
  AV.collarGeo = function (body, src) {   // the tee's rib collar: a flat knit band over the neckline (max filtered then low passed, so it covers the mesh's jagged edge)
    var K = KIT[body]; if (!K || !K.collar) return null; var cache = AV.ACCG = AV.ACCG || new Map(); var ck = body + ":collar"; var hit = cache.get(ck); if (hit) return hit; var G = new HG(), B = K.bones, n = K.collar.length, N = 96, Y = [], R = [];
    var sm = function (A, it) { for (var q = 0; q < it; q++) { var Bq = A.slice(); for (var k = 0; k < N; k++) A[k] = (Bq[(k + N - 2) % N] + 4 * Bq[(k + N - 1) % N] + 6 * Bq[k] + 4 * Bq[(k + 1) % N] + Bq[(k + 2) % N]) / 16; } };
    for (var k = 0; k < N; k++) { var a = -Math.PI + TAU * k / N; var u = (a + Math.PI) / TAU * n, i0 = Math.floor(u) % n, i1 = (i0 + 1) % n, f = u - Math.floor(u); Y[k] = K.collar[i0][0] * (1 - f) + K.collar[i1][0] * f; R[k] = K.collar[i0][1] * (1 - f) + K.collar[i1][1] * f; }
    sm(Y, 5);
    var R2 = R.map(function (v, k) { return Math.max(R[(k + N - 2) % N], R[(k + N - 1) % N], v, R[(k + 1) % N], R[(k + 2) % N]); }); sm(R2, 4);
    G.grid(N, 12, function (u, s, out) { var kk = Math.round(u * N) % N, a = -Math.PI + TAU * kk / N, t = s * TAU; var nn = [Math.sin(a), 0, Math.cos(a)], up = vnorm([-nn[0] * 0.3, 1, -nn[2] * 0.3]); var rr = R2[kk] + 0.0024;
      var c = [K.c.x + nn[0] * rr, Y[kk] + 0.0012, K.c.z + nn[2] * rr]; out.p = vadd(vadd(c, nn, 0.0032 * Math.cos(t)), up, 0.0074 * Math.sin(t)); out.n = vnorm(vadd(vmult(nn, Math.cos(t) / 0.0032), up, Math.sin(t) / 0.0074)); out.u = s; out.v = u * 24; out.seam = 0; out.ao = 1; }, PK.KNIT, 0, false);
    var geo = G.geo(); var near = function (x, y, z) { var az = Math.atan2(x - K.c.x, z - K.c.z), kk = Math.round((az + Math.PI) / TAU * N) % N; return Math.abs(y - Y[kk]) < 0.03 && Math.abs(Math.hypot(x - K.c.x, z - K.c.z) - R2[kk]) < 0.03; };
    if (!(src && copySkin(geo, src, near))) skinBone(K, geo, function (x, y, z) { return [[B.neck, 0.15], [B.Spine, 0.85]]; });
    hit = { geo: geo }; hit.geo.userData.avShared = true; cache.set(ck, hit); return hit; };
  // the rib collar moves with the tee itself: each vertex takes the skin weights of the nearest tee vertex (the idle tilts the neck over a spine weighted band)
  function copySkin(geo, src, near) { var sg = src.geometry, SP = sg.attributes.position, SI = sg.attributes.skinIndex, SW = sg.attributes.skinWeight; if (!SP || !SI || !SW) return false;
    var cand = [], cx = [], cy = [], cz = []; for (var i = 0; i < SP.count; i++) { var x0 = SP.getX(i), y = SP.getY(i), z0 = SP.getZ(i); if (near(x0, y, z0)) { cand.push(i); cx.push(x0); cy.push(y); cz.push(z0); } /* only the tee round its neckline */ } if (!cand.length) return false;
    var P = geo.attributes.position, n = P.count, ji = new Uint16Array(n * 4), wt = new Float32Array(n * 4), m = cand.length;
    for (var v = 0; v < n; v++) { var x = P.getX(v), y2 = P.getY(v), z = P.getZ(v), best = -1, bd = 1e9; for (var c = 0; c < m; c++) { var dx = cx[c] - x, dy = cy[c] - y2, dz = cz[c] - z, d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = cand[c]; } }
      for (var k = 0; k < 4; k++) { ji[v * 4 + k] = SI.getX ? [SI.getX(best), SI.getY(best), SI.getZ(best), SI.getW(best)][k] : 0; wt[v * 4 + k] = [SW.getX(best), SW.getY(best), SW.getZ(best), SW.getW(best)][k]; } }
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(ji, 4)); geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(wt, 4)); return true; }
  AV.collarMat = function (hex) { var k = "collar:" + hex; var m = HATMAT.get(k); if (m) return m; m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }); var c0 = hairCol(hex).multiplyScalar(0.94); m.userData.u = { uC0: { value: c0 }, uC1: { value: c0 }, uC2: { value: c0 } }; m.onBeforeCompile = HAT_OBC(m.userData.u); m.name = "avHat"; m.userData.avShared = true; HATMAT.set(k, m); return m; };
  AV.GEARMAP = { gear_bandana: "bandana", gear_scarf: "scarf", gear_lanyard: "lanyard", gear_backpack_gb: "backpack", gear_vest_crew: "vest" };
  AV.gearMat = function (key) { var cols = { bandana: ["b8321c", "f5f1e6", "141414"], scarf: ["d8c39a", "b8a27a", "1f6b3a"], lanyard: ["2a7a3e", "f5f1e6", "4dde6f"], backpack: ["1f6b3a", "14522b", "f4cd5a"], vest: ["ffb300", "d8d8d8", "141414"] }[key]; var k = "gear:" + key; var m = HATMAT.get(k); if (m) return m;
    m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.FrontSide }); m.userData.u = { uC0: { value: hairCol(cols[0]) }, uC1: { value: hairCol(cols[1]) }, uC2: { value: hairCol(cols[2]) } }; m.onBeforeCompile = HAT_OBC(m.userData.u); m.name = "avHat"; m.userData.avShared = true; HATMAT.set(k, m); return m; };

  // ───────── dressing a rigged body (called from client.js buildRigged) ─────────
  // look: { body, hair, hairc, skin, hw, hwc, ey, ac } (hw / ey / ac optional: older looks use the shop hat and gear instead)
  AV.resolve = function (look, legacyHat, gear, body) {
    var l = look || {}; var hair = Number.isInteger(+l.hair) && AV.STYLES[+l.hair] ? +l.hair : 0;
    var hw = Number.isInteger(l.hw) ? l.hw : (AV.LEGACY_HAT[legacyHat] || 0); if (!AV.HATS[hw]) hw = 0;
    var ey = Number.isInteger(l.ey) ? l.ey : (gear && gear.face === "gear_shades" ? 1 : 0); if (!AV.EYEWEAR[ey]) ey = 0;
    var ac = Number.isInteger(l.ac) ? l.ac : ((gear && gear.neck === "gear_chain" ? 1 : 0) | (gear && gear.wrist === "gear_watch" ? 4 : 0));
    var eff = hair; if (hair === 0 && hw) eff = body === "f" ? 10 : 13;   // the sculpted hair cannot go under a hat: a matching hat-hair style instead
    return { hair: hair, eff: eff, hw: hw, hwc: (l.hwc | 0), ey: ey, ac: ac, hairc: l.hairc || "1c1512", skin: l.skin || "e8c19a" };
  };
  AV.errs = AV.errs || [];
  AV.dress = function (g, clone, look, legacyHat, gear, body) { try { return dress0(g, clone, look, legacyHat, gear, body); } catch (e) { if (AV.errs.length < 20) AV.errs.push(String(e && e.stack || e).slice(0, 300)); return null; } };
  function dress0(g, clone, look, legacyHat, gear, body) {
    if (!AV.on || !AV.ready || !KIT[body]) return null; var t0 = performance.now(); var R = AV.resolve(look, legacyHat, gear, body); var K = KIT[body];
    var parts = {}; clone.traverse(function (o) { if (o.isSkinnedMesh) parts[(o.material && o.material.name || "").toLowerCase()] = o; }); var skin = parts.skin || parts.body; if (!skin) return null;
    var S = AV.style(R.eff); var out = { parts: [], hairMeshes: [], hatOn: !!R.hw, R: R, pending: null };
    var root = new THREE.Group(); root.name = "avDress"; skin.parent.add(root); out.root = root;
    var add = function (m, hair) { root.add(m); out.parts.push(m); if (hair) out.hairMeshes.push(m); return m; };
    var hat = R.hw ? AV.hat(body, R.hw, S.hatPad || 0.006) : null;
    var useGroom = function (gr) { if (!gr || !gr.geo) return; var mat = AV.hairMat(R.hairc, S); add(gr.piv ? AV.pivotMesh(gr.geo, mat, skin, K, gr.piv) : AV.skinned(gr.geo, mat, skin), true); if (S.special !== "locs" && S.special !== "cornrows" && AV.softOn !== false) { var sm = AV.hairSoft(R.hairc, S); var ms = gr.piv ? AV.pivotMesh(gr.geo, sm, skin, K, gr.piv) : AV.skinned(gr.geo, sm, skin); ms.castShadow = false; ms.renderOrder = 2; add(ms, true); } if (gr.tie) add(AV.skinned(gr.tie, AV.tieMat(), skin), true); };
    var bare = function () { if (parts.hair && parts.hair.parent) parts.hair.parent.remove(parts.hair); for (var nm in parts) if (nm !== "hair") parts[nm].geometry = AV.cleanGeo(body, nm, parts[nm].geometry); };
    if (R.eff === 0) { // the body's own hair, with a solid scalp under it so its gaps never show the head
      add(AV.skinned(AV.scalpGeo(body), AV.scalpMat(R.skin, R.hairc, [1, 1, 1, 0.85], [0, 0.01], [-0.02, 0.03]), skin), true); }
    else {
      var gr = AV.groomCached(body, R.eff, hat && hat.cover);
      if (!gr && (AV.syncOK || (typeof player !== "undefined" && g === player))) gr = AV.groom(body, R.eff, hat && hat.cover);
      var sc = S.scalp || { den: [1, 1, 1, 0.95], fade: [0, 0.01] };
      if (gr) { bare(); add(AV.skinned(AV.scalpGeo(body), AV.scalpMat(R.skin, R.hairc, sc.den, sc.fade), skin), true); useGroom(gr); }
      else { // build in the background; until then the body keeps its own hair (never a bald frame)
        out.pending = AV.groomAsync(body, R.eff, hat && hat.cover).then(function (g2) { if (!root.parent || out.dead) return; bare(); add(AV.skinned(AV.scalpGeo(body), AV.scalpMat(R.skin, R.hairc, sc.den, sc.fade), skin), true); useGroom(g2); out.pending = null; out.root.traverse(function (o) { o.layers.mask = skin.layers.mask; o.castShadow = skin.castShadow; }); if (out.onReady) out.onReady(); }); } }
    if (hat) { add(AV.skinned(hat.geo, AV.hatMat(R.hw, R.hwc), skin)); if (hat.logo) add(AV.skinned(hat.logo, AV.logoMat(hat.logo.userData.gold), skin)); }
    if (R.ey) { var gl = AV.glasses(body, R.ey); if (gl) { var gm = AV.glassMats(R.ey); add(AV.skinned(gl.frame, gm.frame, skin)); if (gl.lens) { var lm = add(AV.skinned(gl.lens, gm.lens, skin)); lm.castShadow = false; lm.renderOrder = 3; } } }
    for (var i = 0; i < AV.ACCS.length; i++) { var A = AV.ACCS[i]; if (!(R.ac & A.bit)) continue; var ag = AV.accGeo(body, A.key); if (ag) add(AV.skinned(ag.geo, AV.accMat(A.key), skin)); }
    if (look && look.shirt && !(gear && (gear.top === "gear_hoodie_gb"))) { var cg = AV.collarGeo(body, parts.body); if (cg) add(AV.skinned(cg.geo, AV.collarMat(look.shirt), skin)); }
    if (gear) for (var slot of ["neck", "back", "top"]) { var gk = AV.GEARMAP[gear[slot]]; if (!gk || (gk === "chain")) continue; var gg = AV.gearGeo(body, gk); if (!gg) continue; add(AV.skinned(gg.geo, AV.gearMat(gk), skin)); if (gg.logo) add(AV.skinned(gg.logo, AV.logoMat(false), skin)); }
    root.traverse(function (o) { o.layers.mask = skin.layers.mask; });
    AV.n.dress++; AV.n.dressMs = (AV.n.dressMs || 0) + (performance.now() - t0); return out;
  }
  var TIEMAT = null; AV.tieMat = function () { if (TIEMAT) return TIEMAT; TIEMAT = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 }); TIEMAT.name = "avTie"; TIEMAT.userData.avShared = true; return TIEMAT; };
  // the cache keeps what is in use plus a few recent builds; the rest is disposed (memory stays flat while you try styles on)
  AV.evict = function (keep) {
    keep = keep === undefined ? 10 : keep; if (typeof scene === "undefined") return 0; var total = GROOMS.size + HATG.size; if (total <= keep) return 0;
    var used = new Set(); scene.traverse(function (o) { if (o.userData && o.userData.av && o.geometry) used.add(o.geometry); });
    var list = []; GROOMS.forEach(function (g, k) { list.push([g.used, k, GROOMS, g]); }); HATG.forEach(function (h, k) { list.push([h.used, k, HATG, h]); }); list.sort(function (a, b) { return a[0] - b[0]; });
    var n = 0, live = list.length; for (var i = 0; i < list.length && live > keep; i++) { var e = list[i], it = e[3]; var geos = [it.geo, it.tie, it.logo].filter(Boolean); if (geos.some(function (x) { return used.has(x); })) continue; geos.forEach(function (x) { x.dispose(); }); e[2].delete(e[1]); live--; n++; }
    AV.n.evict += n; return n;
  };
  // compile the avatar programs once, behind the loading screen or when the studio opens (no hitch on the first style change)
  AV.prewarm = function (g) { try { if (window.PLAN_PERF && PLAN_PERF.warmGroup && g) { PLAN_PERF.warmGroup(g); return true; } if (typeof renderer !== "undefined" && renderer.compile && g) { renderer.compile(g, camera); return true; } } catch (e) {} return false; };
  AV.frame = function (dt) { if (JOBS.size) AV.runJobs(AV.studio.on ? (performance.now() - (AV.urgent || 0) < 1500 ? 14 : 8) : 2.5); var now = performance.now(); if (!AV._ev || now - AV._ev > 6000) { AV._ev = now; AV.evict(AV.studio.on ? 90 : 28); } if (AV.studioFrame) AV.studioFrame(dt); };

  // ───────── the Character Studio (K or the CHARACTER button) ─────────
  // A framed portrait camera on your own character under studio light, categories down the left, choices on the right,
  // drag to turn, wheel or the zoom buttons for face, upper body or full length, R for a random look, Enter or "Looks good" to save.
  AV.HAIRC = [["0e0c0b", "Black"], ["2a1b12", "Espresso"], ["3a2416", "Dark brown"], ["6b3f22", "Chestnut"], ["8a3b1e", "Auburn"], ["b35a2a", "Copper"], ["9a6a3a", "Caramel"], ["c9a061", "Honey"], ["e0c48a", "Golden blonde"], ["ece2cc", "Platinum"], ["8f8f8f", "Silver"], ["2e8b57", "Emerald"], ["3a6ac9", "Electric blue"], ["d06a9a", "Rose"], ["7a4ad0", "Violet"]];
  AV.SKINS = ["f3d9c0", "e8c19a", "d9a877", "c98f63", "a86f46", "8d5a3b", "6b4226", "4a2c1a"];
  AV.SHIRTS = ["4dde6f", "f5f1e6", "141414", "1f3b2c", "2f4a7a", "c94a3a", "f4cd5a", "d8c39a", "7a4a2e", "8fd8ff", "6e1f24", "e9e2d3"];
  AV.PANTS = ["2b3a4a", "1c1f24", "6d5a3e", "2f4a7a", "8a8f94", "d8c39a", "3a2a1c", "e9e2d3"];
  AV.SHOES = ["f5f1e6", "141414", "4dde6f", "c94a3a", "3a6ac9", "7a4a2e", "f4cd5a", "8a8f94"];
  var ST = AV.ST = AV.ST || { cat: "hair", ang: 0.62, pitch: 0.06, zoom: 0, zoomT: 0, drag: false, lx: 0, ly: 0, look: null, saved: null, built: false, hidden: [], dirty: false };
  var CATS = [["body", "Body", "B"], ["hair", "Hair", "H"], ["haircol", "Hair colour", "C"], ["head", "Headwear", "W"], ["eyes", "Eyewear", "G"], ["acc", "Accessories", "A"], ["outfit", "Outfit", "O"]];
  var ZOOM = { body: 1, hair: 0, haircol: 0, head: 0.12, eyes: 0, acc: 0.45, outfit: 1 };
  function $q(s, r) { return (r || document).querySelector(s); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function css() {
    if ($q("#avs-css")) return; var s = el("style"); s.id = "avs-css";
    s.textContent = [
      "#creator.avs{left:0!important;top:0!important;right:0;bottom:0;width:auto!important;max-height:none!important;transform:none!important;background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important;border-radius:0!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;pointer-events:none;overflow:visible!important}",
      "#creator.avs::before,#creator.avs::after{display:none!important}",
      "body.avs-on .hud,body.avs-on #mm,body.avs-on #compass,body.avs-on #hint,body.avs-on #status,body.avs-on #radio,body.avs-on #log,body.avs-on #prompt,body.avs-on div:has(> #p2streamt){display:none!important}",
      "#creator.avs .avs-rail,#creator.avs .avs-panel,#creator.avs .avs-bar,#creator.avs .avs-zoom,#creator.avs .avs-top{pointer-events:auto}",
      ".avs-top{position:absolute;left:24px;top:20px;display:flex;align-items:flex-end;gap:14px}",
      ".avs-top h2{margin:0;font:400 34px Anton,Impact,sans-serif;letter-spacing:.05em;color:var(--cream);text-shadow:0 2px 18px rgba(0,0,0,.5)}",
      ".avs-top .k{font:600 10px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.2em;color:var(--green);text-transform:uppercase;margin-bottom:7px}",
      ".avs-rail{position:absolute;left:24px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:6px;padding:8px;background:var(--glass);border:1px solid var(--line2);border-radius:14px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}",
      ".avs-cat{display:flex;align-items:center;gap:10px;min-width:168px;padding:10px 12px;border-radius:10px;border:1px solid transparent;background:transparent;color:var(--dim);cursor:pointer;font:600 11px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;text-align:left;transition:all .15s}",
      ".avs-cat i{font-style:normal;display:inline-grid;place-items:center;width:22px;height:22px;border-radius:6px;border:1px solid var(--line2);font-size:10px;color:var(--cream)}",
      ".avs-cat:hover{color:var(--cream);background:rgba(245,241,230,.05)}.avs-cat.on{color:var(--green);border-color:var(--green);background:rgba(77,222,111,.12)}.avs-cat.on i{border-color:var(--green);color:var(--green)}",
      ".avs-panel{position:absolute;right:24px;top:20px;bottom:86px;width:min(420px,40vw);display:flex;flex-direction:column;background:rgba(7,17,12,.86);border:1px solid var(--line);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);overflow:hidden}",
      ".avs-panel::before,.avs-panel::after{content:'';position:absolute;width:14px;height:14px;pointer-events:none}.avs-panel::before{left:-1px;top:-1px;border-top:2px solid var(--green);border-left:2px solid var(--green);border-top-left-radius:4px}.avs-panel::after{right:-1px;bottom:-1px;border-bottom:2px solid var(--green);border-right:2px solid var(--green);border-bottom-right-radius:4px}",
      ".avs-ph{padding:18px 20px 10px;border-bottom:1px solid var(--line2)}.avs-ph h3{margin:0;font:400 24px Anton,Impact,sans-serif;letter-spacing:.05em}.avs-ph .s{color:var(--dim);font-size:12px;margin-top:4px;line-height:1.45}",
      ".avs-body{flex:1;overflow-y:auto;padding:14px 20px 18px;scrollbar-width:thin;scrollbar-color:rgba(77,222,111,.4) transparent}",
      ".avs-lab{margin:14px 0 8px;color:var(--dim);font:600 9.5px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase}.avs-lab:first-child{margin-top:0}.avs-lab b{color:var(--green);font-weight:600;margin-left:6px}",
      ".avs-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}",
      ".avs-tile{position:relative;padding:0;border-radius:12px;border:1px solid var(--line2);background:rgba(245,241,230,.04);color:var(--cream);cursor:pointer;overflow:hidden;transition:transform .12s,border-color .12s,box-shadow .12s;text-align:left}",
      ".avs-tile .im{display:block;aspect-ratio:1/1;background:#0d1512 center/cover no-repeat}.avs-tile .im.none{display:grid;place-items:center;color:var(--dim);font:600 22px 'Space Grotesk',sans-serif}",
      ".avs-tile span{display:block;padding:6px 8px 7px;font:600 11px 'Space Grotesk',system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".avs-tile:hover{transform:translateY(-2px);border-color:rgba(77,222,111,.55)}.avs-tile.on,.avs-tile.kb{border-color:var(--green);box-shadow:0 0 0 2px rgba(77,222,111,.35),0 8px 22px rgba(0,0,0,.35)}.avs-tile.on span{color:var(--green)}",
      ".avs-tile.kb{outline:2px dashed rgba(245,241,230,.5);outline-offset:2px}",
      ".avs-tile.lock{opacity:.42;cursor:not-allowed}.avs-tile.lock::after{content:'LOCKED';position:absolute;left:8px;top:8px;padding:2px 6px;border-radius:4px;background:rgba(7,17,12,.8);color:var(--gold);font:600 9px 'JetBrains Mono',monospace;letter-spacing:.14em}.avs-tog.lock{opacity:.45;cursor:not-allowed}",
      ".avs-sw{display:flex;flex-wrap:wrap;gap:8px}.avs-sw button{width:34px;height:34px;border-radius:50%;border:2px solid rgba(255,255,255,.16);cursor:pointer;padding:0;transition:transform .12s,box-shadow .12s}.avs-sw button:hover{transform:scale(1.1)}.avs-sw button.on{border-color:var(--green);box-shadow:0 0 0 2px rgba(77,222,111,.35),0 0 14px rgba(77,222,111,.35)}",
      ".avs-sw input[type=color]{width:34px;height:34px;border:1px solid var(--line2);border-radius:50%;padding:0;background:none;cursor:pointer}.avs-sw input[type=color]::-webkit-color-swatch-wrapper{padding:2px}.avs-sw input[type=color]::-webkit-color-swatch{border:0;border-radius:50%}",
      ".avs-seg{display:flex;gap:8px}.avs-seg button{flex:1;padding:12px;border-radius:10px;border:1px solid var(--line2);background:rgba(245,241,230,.04);color:var(--cream);cursor:pointer;font:600 14px 'Space Grotesk',system-ui,sans-serif}.avs-seg button.on{border-color:var(--green);color:var(--green);background:rgba(77,222,111,.12)}",
      ".avs-rng{width:100%;accent-color:var(--green)}",
      ".avs-tog{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:12px;border:1px solid var(--line2);background:rgba(245,241,230,.04);color:var(--cream);cursor:pointer;width:100%;margin-bottom:8px;font:600 13px 'Space Grotesk',system-ui,sans-serif}.avs-tog em{font-style:normal;font:600 10px 'JetBrains Mono',monospace;letter-spacing:.14em;color:var(--dim)}.avs-tog.on{border-color:var(--green)}.avs-tog.on em{color:var(--green)}",
      ".avs-note{color:var(--dim);font-size:11.5px;line-height:1.5;margin-top:14px}",
      ".avs-bar{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:8px;background:var(--glass);border:1px solid var(--line2);border-radius:999px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}",
      ".avs-bar .btn{padding:10px 18px;border-radius:999px;white-space:nowrap}.avs-bar .hint{color:var(--dim);font:600 9.5px 'JetBrains Mono',monospace;letter-spacing:.12em;padding:0 8px;white-space:nowrap}.avs-bar .hint kbd{display:inline-block;padding:1px 6px;border:1px solid rgba(77,222,111,.4);background:rgba(77,222,111,.1);color:var(--green);border-radius:4px;margin:0 2px}",
      ".avs-zoom{position:absolute;left:24px;bottom:20px;display:flex;gap:6px;padding:8px;background:var(--glass);border:1px solid var(--line2);border-radius:999px}.avs-zoom button{width:70px;padding:9px 0;border-radius:999px;border:1px solid var(--line2);background:var(--glass);color:var(--dim);cursor:pointer;font:600 10px 'JetBrains Mono',monospace;letter-spacing:.14em;text-transform:uppercase}.avs-zoom button.on{color:var(--green);border-color:var(--green)}",
      "@media (max-width:860px){.avs-zoom{display:none}.avs-rail{top:auto;bottom:86px;transform:none;flex-direction:row;flex-wrap:wrap;max-width:calc(100vw - 48px)}.avs-cat{min-width:0}.avs-cat b{display:none}.avs-panel{left:24px;right:24px;width:auto;top:auto;height:44vh;bottom:150px}.avs-zoom{display:none}.avs-top h2{font-size:24px}}"
    ].join("\n"); document.head.appendChild(s);
  }
  // thumbnails: a sprite sheet rendered offline (models/avatar/thumbs_*.jpg, 6 columns of 128 px)
  AV.THUMB = { hair_m: "/models/avatar/thumbs_hair_m.jpg", hair_f: "/models/avatar/thumbs_hair_f.jpg", head: "/models/avatar/thumbs_head.jpg", eyes: "/models/avatar/thumbs_eyes.jpg" };
  function thumbStyle(sheet, i) { var c = 6; return "background-image:url(" + AV.THUMB[sheet] + "?v=" + (window.BUILD || 0) + ");background-size:" + (c * 100) + "% auto;background-position:" + ((i % c) / (c - 1) * 100) + "% " + "var(--row)"; }
  function thumbRow(i, n) { var c = 6, rows = Math.ceil(n / c); var r = Math.floor(i / c); return rows > 1 ? (r / (rows - 1) * 100) + "%" : "0%"; }
  function curLook() { var lk = (typeof savedLook === "function" && savedLook()) || {}; var me = typeof view !== "undefined" && view && view.players && typeof ME !== "undefined" ? view.players[ME] : null; var R = AV.resolve(lk, me && me.hat, me && me.gear, lk.body === "f" ? "f" : "m");
    return { body: lk.body === "f" ? "f" : "m", skin: lk.skin || "e8c19a", shirt: lk.shirt || "4dde6f", pants: lk.pants || "2b3a4a", shoes: lk.shoes || "f5f1e6", hairc: lk.hairc || "3a2416", height: lk.height || 1, hair: R.hair, hw: R.hw, hwc: R.hwc, ey: R.ey, ac: R.ac, cartc: typeof lk.cartc === "number" ? lk.cartc : 0 }; }
  function serverBits() { var me = typeof view !== "undefined" && view && view.players && typeof ME !== "undefined" ? view.players[ME] : null; return { hat: me ? me.hat || null : null, outfit: me ? me.outfit || null : null, gear: me ? me.gear || null : null }; }
  function applyLook(save) {
    var l = ST.look; if (typeof player === "undefined" || !player) return; var sb = serverBits(); var t0 = performance.now();
    // a style that is not built yet is finished in the background first (a few milliseconds a frame, ahead of the queue); the current look stays until it is ready
    var R = AV.resolve(l, sb.hat, sb.gear, l.body === "f" ? "f" : "m"); var S = AV.style(R.eff); var hat = R.hw ? AV.hat(R.body || (l.body === "f" ? "f" : "m"), R.hw, S.hatPad || 0.006) : null; var bd = l.body === "f" ? "f" : "m";
    if (R.eff && S.len !== "sculpt" && !AV.groomCached(bd, R.eff, hat && hat.cover)) { var want = JSON.stringify(l); ST.waiting = want; AV.groomAsync(bd, R.eff, hat && hat.cover, true).then(function () { if (ST.waiting === want && AV.studio.on) { ST.waiting = null; applyLook(); } }); syncUI(); return; }
    ST.waiting = null;
    AV.syncOK = true; try { buildBody(player, l, sb.hat, sb.outfit, sb.gear); } finally { AV.syncOK = false; }
    ST.applyMs = performance.now() - t0; if (player.userData.walk) player.userData.walk.visible = true; hideLabels(true);
    clearTimeout(ST.saveT); ST.saveT = setTimeout(function () { persist(); }, 600); ST.dirty = true; syncUI();
  }
  AV._apply = function () { applyLook(); };
  function persist() { var l = Object.assign({}, ST.look); for (var k in l) if (l[k] === undefined) delete l[k]; try { localStorage.setItem("g1:look", JSON.stringify(l)); } catch (e) {} ST.sentAt = performance.now(); ST.sent = l; try { act({ t: "look", look: l }); } catch (e) {} }
  AV.pendingLook = function () { return ST.sent && performance.now() - (ST.sentAt || 0) < 5000 ? ST.sent : null; };
  function setL(k, v) { ST.look[k] = v; applyLook(); if (k === "body" || k === "hw") prebuild(); try { if (typeof sfx === "function") sfx("ui"); } catch (e) {} }
  function hideLabels(on) { var u = player && player.userData; if (!u) return; for (var s of [u.label, u.bubble, u.emote, u.blob]) if (s) { if (on) { if (s.userData.avsWas === undefined) s.userData.avsWas = s.visible; s.visible = false; } else if (s.userData.avsWas !== undefined) { s.visible = s.userData.avsWas; delete s.userData.avsWas; } } }
  function hideOthers(on) { if (on) { ST.hidden = []; try { var pp = player.position; scene.children.forEach(function (o) { if (o === player || !o.visible || !o.userData || !o.userData.walk) return; if (o.position.distanceTo(pp) < 6.5) { o.visible = false; ST.hidden.push(o); } }); } catch (e) {} } else { for (var o of ST.hidden) o.visible = true; ST.hidden = []; } }
  function grid(items, sel, onPick, thumb, pre) { var g = el("div", "avs-grid"); items.forEach(function (it, i) { var lk = pre && AV.isUnlocked && !AV.isUnlocked(pre + it.id); var b = el("button", "avs-tile" + (it.id === sel ? " on" : "") + (lk ? " lock" : "")); b.dataset.id = it.id; var im = el("i", "im" + (thumb ? "" : " none")); if (thumb) { im.setAttribute("style", thumbStyle(thumb.sheet, thumb.index(it, i)) + ";--row:" + thumbRow(thumb.index(it, i), thumb.n)); im.style.backgroundPosition = ((thumb.index(it, i) % 6) / 5 * 100) + "% " + thumbRow(thumb.index(it, i), thumb.n); } else im.textContent = it.icon || ""; b.appendChild(im); b.appendChild(el("span", "", it.n)); b.title = lk ? it.n + " (unlock it through quests)" : it.n; b.onclick = function () { if (lk) { try { sfx("ui"); } catch (e) {} return; } onPick(it.id); }; g.appendChild(b); }); return g; }
  function swatches(list, val, onPick, custom) { var w = el("div", "avs-sw"); list.forEach(function (c) { var hex = Array.isArray(c) ? c[0] : c; var b = el("button", hex === val ? "on" : ""); b.style.background = "#" + hex; b.title = Array.isArray(c) ? c[1] : "#" + hex; b.onclick = function () { onPick(hex); }; w.appendChild(b); }); if (custom) { var inp = el("input"); inp.type = "color"; inp.value = "#" + val; inp.title = "Any colour"; inp.oninput = function () { onPick(inp.value.slice(1)); }; w.appendChild(inp); } return w; }
  function lab(t, v) { return el("div", "avs-lab", t + (v ? "<b>" + v + "</b>" : "")); }
  var COPY = { body: ["Body", "Your build, height and skin tone."], hair: ["Hair", "Seventeen cuts, fitted to your head. Each one replaces your hair completely."], haircol: ["Hair colour", "Natural shades from root to tip, plus a few bold ones."], head: ["Headwear", "Caps, a beanie, a bucket hat, an Arizona cowboy hat and Solport flight gear. Your hair tucks under."], eyes: ["Eyewear", "Frames fitted to your eyes and ears."], acc: ["Accessories", "Jewellery and a watch."], outfit: ["Outfit", "Shirt, trousers and shoes."] };
  function renderPanel() {
    var P = $q("#avs-body"), H = $q("#avs-ph"); if (!P) return; var c = ST.cat, L = ST.look; P.innerHTML = ""; H.innerHTML = "<h3>" + COPY[c][0] + "</h3><div class='s'>" + COPY[c][1] + "</div>";
    if (c === "body") { P.appendChild(lab("Body")); var sg = el("div", "avs-seg"); [["m", "Man"], ["f", "Woman"]].forEach(function (b) { var x = el("button", L.body === b[0] ? "on" : "", b[1]); x.onclick = function () { setL("body", b[0]); renderPanel(); }; sg.appendChild(x); }); P.appendChild(sg);
      P.appendChild(lab("Height", Math.round(L.height * (L.body === "f" ? 168 : 178)) + " cm")); var r = el("input", "avs-rng"); r.type = "range"; r.min = 0.88; r.max = 1.12; r.step = 0.01; r.value = L.height; r.oninput = function () { ST.look.height = +r.value; P.querySelector(".avs-lab b").textContent = Math.round(+r.value * (L.body === "f" ? 168 : 178)) + " cm"; clearTimeout(ST.hT); ST.hT = setTimeout(applyLook, 90); }; P.appendChild(r);
      P.appendChild(lab("Skin")); P.appendChild(swatches(AV.SKINS, L.skin, function (h) { setL("skin", h); syncUI(); }, true)); }
    else if (c === "hair") { var order = AV.STYLE_ORDER.map(function (i) { return AV.STYLES[i]; }); P.appendChild(grid(order.map(function (S) { return { id: S.id, n: S.n }; }), L.hair, function (id) { setL("hair", id); syncUI(); }, { sheet: L.body === "f" ? "hair_f" : "hair_m", n: AV.STYLE_ORDER.length, index: function (it, i) { return i; } }, "hair:")); P.appendChild(el("div", "avs-note", "Under a hat your style is pressed under it; long hair, buns and tails come out below.")); }
    else if (c === "haircol") { P.appendChild(lab("Shade")); P.appendChild(swatches(AV.HAIRC.filter(function (c2) { return AV.isUnlocked("hairc:" + c2[0]); }), L.hairc, function (h) { setL("hairc", h); syncUI(); }, true)); }
    else if (c === "head") { P.appendChild(grid(AV.HATS.map(function (H2) { return { id: H2.id, n: H2.n }; }), L.hw, function (id) { ST.look.hwc = 0; setL("hw", id); renderPanel(); }, { sheet: "head", n: AV.HATS.length, index: function (it, i) { return i; } }, "hw:"));
      var H3 = AV.HATS[L.hw]; if (H3 && H3.colors) { P.appendChild(lab("Colourway")); var w = el("div", "avs-sw"); H3.colors.forEach(function (cw, i) { var b = el("button", i === (L.hwc || 0) ? "on" : ""); b.style.background = "linear-gradient(135deg,#" + cw[0] + " 0 55%,#" + cw[1] + " 55% 80%,#" + cw[2] + " 80%)"; b.onclick = function () { setL("hwc", i); renderPanel(); }; w.appendChild(b); }); P.appendChild(w); }
      P.appendChild(el("div", "avs-note", "Studio headwear is yours to wear. Giveback merch from the General Store also shows up here once you own it.")); }
    else if (c === "eyes") { P.appendChild(grid(AV.EYEWEAR.map(function (E) { return { id: E.id, n: E.n }; }), L.ey, function (id) { setL("ey", id); syncUI(); }, { sheet: "eyes", n: AV.EYEWEAR.length, index: function (it, i) { return i; } }, "ey:")); }
    else if (c === "acc") { AV.ACCS.forEach(function (A) { var on = !!(L.ac & A.bit), lk = !AV.isUnlocked("ac:" + A.key); var b = el("button", "avs-tog" + (on ? " on" : "") + (lk ? " lock" : ""), A.n + "<em>" + (lk ? "LOCKED" : on ? "ON" : "OFF") + "</em>"); b.onclick = function () { if (lk) return; setL("ac", (ST.look.ac || 0) ^ A.bit); renderPanel(); }; P.appendChild(b); }); P.appendChild(el("div", "avs-note", "Tees, hoodies, the crew vest, backpacks and scarves are at the General Store on Main Street. Press I for your inventory.")); }
    else if (c === "outfit") { P.appendChild(lab("Shirt")); P.appendChild(swatches(AV.SHIRTS, L.shirt, function (h) { setL("shirt", h); syncUI(); }, true)); P.appendChild(lab("Trousers")); P.appendChild(swatches(AV.PANTS, L.pants, function (h) { setL("pants", h); syncUI(); }, true)); P.appendChild(lab("Shoes")); P.appendChild(swatches(AV.SHOES, L.shoes, function (h) { setL("shoes", h); syncUI(); }, true)); }
    syncUI();
  }
  AV._render = function () { renderPanel(); };
  function syncUI() { document.querySelectorAll("#creator .avs-cat").forEach(function (b) { b.classList.toggle("on", b.dataset.c === ST.cat); }); document.querySelectorAll("#creator .avs-zoom button").forEach(function (b) { b.classList.toggle("on", Math.abs(+b.dataset.z - ST.zoomT) < 0.05); });
    var key = { hair: "hair", head: "hw", eyes: "ey" }[ST.cat]; if (key) document.querySelectorAll("#avs-body .avs-tile").forEach(function (b) { b.classList.toggle("on", +b.dataset.id === ST.look[key]); });
    var swKey = { haircol: "hairc", body: "skin" }[ST.cat]; if (swKey) document.querySelectorAll("#avs-body .avs-sw button").forEach(function (b) { var bg = b.style.background || ""; var m = bg.match(/rgb\(([^)]+)\)/); if (!m) return; var p = m[1].split(",").map(function (x) { return (+x).toString(16).padStart(2, "0"); }).join(""); b.classList.toggle("on", p === ST.look[swKey]); }); }
  function setCat(c) { ST.cat = c; ST.zoomT = ZOOM[c]; renderPanel(); }
  function build() {
    css(); var C = $q("#creator"); if (!C) return false; C.classList.add("avs"); C.innerHTML = "";
    var top = el("div", "avs-top", "<div><div class='k'>Character studio</div><h2>Your character</h2></div>"); C.appendChild(top);
    var rail = el("div", "avs-rail"); CATS.forEach(function (c, i) { var b = el("button", "avs-cat", "<i>" + (i + 1) + "</i><b>" + c[1] + "</b>"); b.dataset.c = c[0]; b.title = c[1] + " (" + (i + 1) + ")"; b.onclick = function () { setCat(c[0]); try { sfx("ui"); } catch (e) {} }; rail.appendChild(b); }); C.appendChild(rail);
    var panel = el("div", "avs-panel"); panel.appendChild(el("div", "avs-ph")); panel.firstChild.id = "avs-ph"; var body = el("div", "avs-body"); body.id = "avs-body"; panel.appendChild(body); C.appendChild(panel);
    var zoom = el("div", "avs-zoom"); [["Face", 0], ["Upper", 0.45], ["Full", 1]].forEach(function (z) { var b = el("button", "", z[0]); b.dataset.z = z[1]; b.onclick = function () { ST.zoomT = z[1]; syncUI(); }; zoom.appendChild(b); }); C.appendChild(zoom);
    var bar = el("div", "avs-bar"); var rnd = el("button", "btn ghost", "Surprise me"); rnd.onclick = randomize; var fly = el("button", "btn ghost", "Replay the fly-in"); fly.id = "replayfly"; fly.title = "Fly into the site again aboard Giveback One"; fly.onclick = function () { closeStudio(true, true); try { if (!FLY.on && !riding && !inside) startFlyIn(); } catch (e) {} };
    var hint = el("div", "hint", "<kbd>Drag</kbd> turn <kbd>Wheel</kbd> zoom <kbd>1-7</kbd> category <kbd>R</kbd> random"); var go = el("button", "btn", "Looks good"); go.id = "c-go"; go.onclick = function () { closeStudio(true); };
    bar.appendChild(rnd); bar.appendChild(hint); bar.appendChild(fly); bar.appendChild(go); C.appendChild(bar); ST.built = true; return true;
  }
  function randomize() { var pick0 = function (a) { return a[Math.floor(Math.random() * a.length)]; }; var pick = function (a, pre, key) { if (!pre) return pick0(a); var ok = a.filter(function (x) { return AV.isUnlocked(pre + (key ? x[key] : Array.isArray(x) ? x[0] : x)); }); return pick0(ok.length ? ok : a); }; var L = ST.look; L.body = Math.random() < 0.5 ? "m" : "f"; L.skin = pick(AV.SKINS); L.hair = pick(AV.STYLE_ORDER.slice(1), "hair:"); L.hairc = pick(AV.HAIRC.slice(0, 11))[0]; if (Math.random() < 0.12) L.hairc = pick(AV.HAIRC.slice(11))[0];
    L.hw = Math.random() < 0.45 ? 1 + Math.floor(Math.random() * 9) : 0; L.hwc = AV.HATS[L.hw] && AV.HATS[L.hw].colors ? Math.floor(Math.random() * AV.HATS[L.hw].colors.length) : 0; L.ey = Math.random() < 0.35 ? 1 + Math.floor(Math.random() * 4) : 0; L.ac = (Math.random() < 0.3 ? 1 : 0) | (Math.random() < 0.4 ? 2 : 0) | (Math.random() < 0.3 ? 4 : 0);
    L.shirt = pick(AV.SHIRTS); L.pants = pick(AV.PANTS); L.shoes = pick(AV.SHOES); L.height = +(0.94 + Math.random() * 0.12).toFixed(2); applyLook(); renderPanel(); try { sfx("ui"); } catch (e) {} }
  // prepare every style of the current body (and the hat on) in the background while the studio is open, so a click is instant
  function prebuild() { var b = ST.look.body; AV.STYLE_ORDER.forEach(function (id) { if (id) { var S = AV.style(id); var h = ST.look.hw ? AV.hat(b, ST.look.hw, S.hatPad || 0.006) : null; AV.groomAsync(b, id, h && h.cover); } });
    var cur = AV.style(ST.look.hair); var pad = cur.hatPad || 0.006; var hi = 1; var hatStep = function () { if (!AV.studio.on || hi >= AV.HATS.length) return; AV.hat(b, hi++, pad); setTimeout(hatStep, 30); }; setTimeout(hatStep, 200); }
  AV.openStudio = function () {
    if (!AV.ready || typeof player === "undefined" || !player) return false; if (!ST.built && !build()) return false; ST.look = curLook(); ST.saved = JSON.parse(JSON.stringify(ST.look)); ST.dirty = false;
    var fw = new THREE.Vector3(); try { var sk = null; player.userData.walk.traverse(function (o) { if (!sk && o.isSkinnedMesh) sk = o; }); sk.updateMatrixWorld(true); fw.set(0, 0, 1).transformDirection(sk.matrixWorld); fw.y = 0; fw.normalize(); } catch (e) { fw.set(0, 0, 1); }
    ST.base = Math.atan2(fw.x, fw.z); ST.ang = 0.62; ST.pitch = 0.05; ST.zoomT = ZOOM[ST.cat]; ST.zoom = ST.zoomT; ST.camInit = false; ST.fov0 = camera.fov; AV.studio.on = true; AV.studio.k = 0;
    try { for (var k in keys) keys[k] = false; } catch (e) {}
    $q("#creator").classList.add("on"); document.body.classList.add("avs-on"); if (document.exitPointerLock) document.exitPointerLock(); hideOthers(true); hideLabels(true); studioDome(); hideWorld(true); applyLook(); renderPanel(); prebuild(); AV.prewarm(player); return true;
  };
  function closeStudio(save, noChain) { if (!AV.studio.on) return; clearTimeout(ST.saveT); if (save !== false) persist(); AV.studio.on = false; AV.studioOff(); hideOthers(false); hideLabels(false); document.body.classList.remove("avs-on"); var C = $q("#creator"); if (C) C.classList.remove("on");
    if (!noChain) try { if (save && !localStorage.getItem("g1:flown")) startFlyIn(); else if (save && !localStorage.getItem("g1:tut")) startTutorial(); } catch (e) {} setTimeout(function () { AV.evict(28); }, 1500); }
  AV.closeStudio = closeStudio;
  // the studio camera: a 3/4 portrait that zooms from the face to full length; the subject sits left of the panel
  var _ct = new THREE.Vector3(), _cp = new THREE.Vector3(), _hd = new THREE.Vector3();
  AV.studioCamera = function (dt) {
    if (!AV.studio.on || typeof player === "undefined" || !player) return false; var C = $q("#creator"); if (!C || !C.classList.contains("on")) { closeStudio(true); return false; }
    ST.zoom += (ST.zoomT - ST.zoom) * Math.min(1, dt * 6); var z = ST.zoom; var hf = (ST.look && ST.look.height) || 1; var bodyF = ST.look && ST.look.body === "f";
    if (!ST.headBone || !ST.headBone.parent || ST.headOf !== player.userData.walk) { ST.headBone = null; ST.headOf = player.userData.walk; player.userData.walk.traverse(function (o) { if (!ST.headBone && o.isBone && o.name === "Head") ST.headBone = o; }); }
    var py = player.position.y, headW = ST.headBone ? ST.headBone.getWorldPosition(_hd).y + (bodyF ? 0.045 : 0.04) * hf : py + (bodyF ? 1.56 : 1.67) * hf;
    var tyFace = headW - 0.07 * hf, tyFull = py + 0.92 * hf; var ty = z < 0.45 ? tyFace + (headW - 0.3 * hf - tyFace) * (z / 0.45) : (headW - 0.3 * hf) + (tyFull - (headW - 0.3 * hf)) * ((z - 0.45) / 0.55);
    var dist = z < 0.45 ? 1.6 + (2.25 - 1.6) * (z / 0.45) : 2.25 + (4.6 - 2.25) * ((z - 0.45) / 0.55); dist *= hf; var fov = camera.fov; dist *= Math.tan(14 * Math.PI / 180) / Math.tan(fov * Math.PI / 360);   // framed as a 28 degree lens at the game's own field of view
    if (!ST.drag) ST.ang += Math.sin(performance.now() / 2600) * dt * 0.025; var a = ST.base + ST.ang; var pitch = ST.pitch + 0.04 * (1 - z);
    _ct.set(player.position.x, ty, player.position.z); var right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    // the subject is centred in the free area between the category rail and the panel (measured from the page, so any window size frames right)
    var aspect = innerWidth / Math.max(1, innerHeight), tf = Math.tan(fov * Math.PI / 360), now = performance.now();
    if (!ST.fr || now - ST.frAt > 500) { var L0 = 0, R0 = innerWidth; if (innerWidth > 860) { var rl = $q("#creator .avs-rail"), pn = $q("#creator .avs-panel"); if (rl) L0 = Math.max(0, rl.getBoundingClientRect().right); if (pn) R0 = Math.min(innerWidth, pn.getBoundingClientRect().left); if (R0 - L0 < innerWidth * 0.3) { L0 = 0; R0 = innerWidth; } } ST.fr = { cx: (L0 + R0) / 2, w: R0 - L0 }; ST.frAt = now; }
    var ndc = ST.fr.cx / innerWidth * 2 - 1, frac = ST.fr.w / innerWidth; dist = Math.max(dist, 0.64 * hf / (2 * tf * aspect * frac) * (1 - z) + dist * z);   // head and shoulders always fit the free width
    var off = -ndc * dist * tf * aspect;
    _cp.set(_ct.x + Math.sin(a) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, _ct.z + Math.cos(a) * Math.cos(pitch) * dist);
    var look = _ct.clone().addScaledVector(right, off);   // the camera looks to the right of the subject: the character sits left of centre, clear of the panel
    _cp.addScaledVector(right, off);
    if (!ST.camInit) { camera.position.copy(_cp); ST.camInit = true; } else camera.position.lerp(_cp, Math.min(1, dt * 10)); camera.lookAt(look);
    if (player.userData.walk) player.userData.walk.visible = true; AV.studio.target = _hd.set(player.position.x, ty, player.position.z); return true;
  };
  AV.studioFrame = function (dt) { if (!AV.studio.on) { if (AV.studio.k > 0) { AV.studio.k = 0; AV.studioOff(); } return; } AV.studio.k = Math.min(1, AV.studio.k + dt * 3); if (AV.studio.target && typeof camera !== "undefined") AV.studioApply(AV.studio.target, camera, AV.studio.k); };
  // input while the studio is open: drag to turn, wheel to zoom, keys for categories and choices (the game never sees them)
  addEventListener("pointerdown", function (e) { if (!AV.studio.on || e.target.tagName !== "CANVAS") return; ST.drag = true; ST.lx = e.clientX; ST.ly = e.clientY; }, true);
  addEventListener("pointermove", function (e) { if (!AV.studio.on || !ST.drag) return; ST.ang -= (e.clientX - ST.lx) * 0.0085; ST.pitch = Math.max(-0.35, Math.min(0.5, ST.pitch + (e.clientY - ST.ly) * 0.004)); ST.lx = e.clientX; ST.ly = e.clientY; }, true);
  addEventListener("pointerup", function () { ST.drag = false; }, true);
  addEventListener("wheel", function (e) { if (!AV.studio.on || e.target.tagName !== "CANVAS") return; ST.zoomT = Math.max(0, Math.min(1, ST.zoomT + (e.deltaY > 0 ? 0.12 : -0.12))); syncUI(); e.preventDefault(); e.stopImmediatePropagation(); }, { capture: true, passive: false });
  addEventListener("keydown", function (e) {
    if (!AV.studio.on) return; if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") && e.target.type !== "range" && e.target.type !== "color") return;
    var c = e.code; if (c === "KeyK" || c === "Escape") { if (c === "Escape") { closeStudio(true); e.stopImmediatePropagation(); e.preventDefault(); } return; }
    var handled = true; var digit = /^Digit([1-7])$/.exec(c);
    if (digit) setCat(CATS[+digit[1] - 1][0]);
    else if (c === "KeyR") randomize();
    else if (c === "KeyQ" || c === "ArrowLeft" && e.shiftKey) ST.ang += 0.25; else if (c === "KeyE" || c === "ArrowRight" && e.shiftKey) ST.ang -= 0.25;
    else if (c === "KeyW" || c === "Equal" || c === "NumpadAdd") { ST.zoomT = Math.max(0, ST.zoomT - 0.15); syncUI(); } else if (c === "KeyS" || c === "Minus" || c === "NumpadSubtract") { ST.zoomT = Math.min(1, ST.zoomT + 0.15); syncUI(); }
    else if (c === "Tab") { var i = CATS.findIndex(function (x) { return x[0] === ST.cat; }); setCat(CATS[(i + (e.shiftKey ? CATS.length - 1 : 1)) % CATS.length][0]); }
    else if (c === "ArrowLeft" || c === "ArrowRight" || c === "ArrowUp" || c === "ArrowDown") { var tiles = Array.prototype.slice.call(document.querySelectorAll("#avs-body .avs-tile, #avs-body .avs-sw button, #avs-body .avs-tog")); if (tiles.length) { var cur = tiles.findIndex(function (t) { return t.classList.contains("kb"); }); if (cur < 0) cur = tiles.findIndex(function (t) { return t.classList.contains("on"); }); var step = c === "ArrowLeft" ? -1 : c === "ArrowRight" ? 1 : (tiles[0].classList.contains("avs-tile") ? 3 : 8) * (c === "ArrowUp" ? -1 : 1); var nx = Math.max(0, Math.min(tiles.length - 1, (cur < 0 ? 0 : cur) + step)); tiles.forEach(function (t) { t.classList.remove("kb"); }); tiles[nx].classList.add("kb"); tiles[nx].scrollIntoView({ block: "nearest" }); } }
    else if (c === "Enter" || c === "Space" || c === "NumpadEnter") { var kb = document.querySelector("#avs-body .kb"); if (kb) kb.click(); else if (c === "Enter") closeStudio(true); }
    else handled = false;
    e.stopImmediatePropagation(); e.preventDefault();   // movement, rides and chat stay off while the studio is open
  }, true);
  // after you save, the server's copy of your look lags a moment: do not rebuild the old look in between
  AV.skipSync = function (p) { var L = AV.pendingLook(); if (!L || !p || !p.look) return false; var keys = ["body", "hair", "hairc", "skin", "shirt", "pants", "shoes", "height", "hw", "hwc", "ey", "ac"]; for (var i = 0; i < keys.length; i++) { var k = keys[i]; var a = L[k], b = p.look[k]; if (a === undefined) continue; if (a !== b && !(k === "height" && Math.abs(a - b) < 1e-6)) return true; } ST.sent = null; return false; };


  // ───────── the catalog (for quests and rewards): every studio item with an id, a name and a category ─────────
  // ids: "hair:<style id>", "hw:<headwear id>", "ey:<eyewear id>", "ac:<key>", "hairc:<hex>". Everything is unlocked unless the
  // catalog entry is flagged locked; PLAN_AVATAR.unlock(id) unlocks it for this player (kept in localStorage "g1:avUnlock").
  // Unlocks gate the studio's choices on this client only (the server keeps validating the look's ranges, not ownership).
  AV.catalog = [];
  AV.STYLES.forEach(function (S) { AV.catalog.push({ id: "hair:" + S.id, cat: "hair", n: S.n, look: { hair: S.id } }); });
  AV.HATS.forEach(function (H) { AV.catalog.push({ id: "hw:" + H.id, cat: "headwear", n: H.n, look: { hw: H.id } }); });
  AV.EYEWEAR.forEach(function (E) { AV.catalog.push({ id: "ey:" + E.id, cat: "eyewear", n: E.n, look: { ey: E.id } }); });
  AV.ACCS.forEach(function (A) { AV.catalog.push({ id: "ac:" + A.key, cat: "accessories", n: A.n, look: { acBit: A.bit } }); });
  AV.HAIRC.forEach(function (c) { AV.catalog.push({ id: "hairc:" + c[0], cat: "haircolour", n: c[1], look: { hairc: c[0] } }); });
  function unlockSet() { if (AV._ul) return AV._ul; var s = new Set(); try { (JSON.parse(localStorage.getItem("g1:avUnlock")) || []).forEach(function (x) { s.add(x); }); } catch (e) {} return (AV._ul = s); }
  AV.item = function (id) { for (var i = 0; i < AV.catalog.length; i++) if (AV.catalog[i].id === id) return AV.catalog[i]; return null; };
  AV.isUnlocked = function (id) { var it = AV.item(id); if (!it) return false; return !it.locked || unlockSet().has(id); };
  AV.unlock = function (id) { var it = AV.item(id); if (!it) return false; var s = unlockSet(); if (!s.has(id)) { s.add(id); try { localStorage.setItem("g1:avUnlock", JSON.stringify(Array.from(s))); } catch (e) {} try { dispatchEvent(new CustomEvent("avatar:unlock", { detail: { id: id, item: it } })); } catch (e) {} if (AV.studio.on && AV._render) AV._render(); } return true; };
  AV.lock = function (id) { var it = AV.item(id); if (it) it.locked = true; return !!it; };   // for a quest that gates an item

  AV.load();
})();
