// R15 (5 Oct 2026): crisp rebuilt exteriors for the homes and rural kinds (casitas, villas, ranches, homes, barns, sheds, glamps).
//   The old models were AI-scanned meshes with one baked 2048 to 4096 px atlas each (80k triangles, blurry and blotchy up close).
//   Every kind here is rebuilt as a procedural shell on the measured footprint, door, porch decks, posts and fronts
//   (plan/porches.json and the R14 rooms stay valid), drawn with ONE shell material that samples two texture arrays
//   (tex/xh_alb.jpg albedo, tex/xh_nrm.jpg normal xy + roughness; 23 seamless 1024 px layers: plaster, adobe, board-formed
//   concrete, rammed earth, ledgestone, fieldstone, ashlar, cedar, charred timber, board and batten, barn boards, weathered
//   planks, logs, cedar shakes, standing seam, corrugated, clay tile, canvas, steel, timber, smooth concrete, glass, travertine),
//   and ONE glass material (interior-mapped rooms behind real panes, sky reflections by day, warm lit rooms at night).
//   Variety per home without extra draws: the instance position hashes to a colourway (8 per palette slot), material swaps
//   (feature walls, cladding, roofing) and geometry variants (parapets, vigas, chimneys, penthouse or roof deck, cupolas),
//   the unused variants collapse in the vertex shader (and in the shadow depth shader).
//   The client's instancing, culling, LOD tiers, colliders, doors, HIDDEN rooms and porches are untouched: the module only
//   replaces MODELS[kind].parts / lodGeos / farGeos before the instancing is built, and tells the streamer the kind is full
//   (the old 10 to 16 MB model files are never downloaded). ?xh=0 turns the module off; ?xhab=1 keeps the old models
//   streaming as well, so PLAN_XH.ab(false / true) swaps old and new in the same session (A/B for screenshots and perf).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var XH = window.PLAN_XH = window.PLAN_XH || {};
  XH.errs = XH.errs || []; XH.n = XH.n || {}; XH.ver = "r15";
  if (/[?&]xh=0\b/.test(location.search)) { XH.off = true; return; }
  var ABMODE = /[?&]xhab=1\b/.test(location.search); XH.abMode = ABMODE;
  var ONLY = (function () { var m = location.search.match(/[?&]xhk=([a-z0-9_,]+)/); return m ? m[1].split(",") : null; })();
  function note(tag, e) { try { if (XH.errs.length < 40) XH.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (XH.errs.length <= 6) console.warn("plan_ext_homes " + tag, e); } catch (x) {} }
  function au(u) { try { if (window.AV) return window.AV(u); } catch (e) {} return u; }
  var PI = Math.PI;

  // ───────────────────────── texture arrays (fetched at script load, decoded off the main thread) ─────────────────────────
  // layer order = scratchpad r15h/mktex.py LAYERS
  var LNAMES = ["plaster", "adobe", "concrete", "rammed", "ledgestone", "fieldstone", "ashlar", "cedar", "charred", "batten", "barnred", "planks", "logs", "shakes", "seam", "corrugated", "claytile", "canvas", "steel", "timber", "smooth", "glass", "travertine", "hewn", "rust", "saltillo", "doors"];
  var L = {}; LNAMES.forEach(function (n, i) { L[n] = i; });
  // tile size (m per texture repeat), tint strength (0 natural, 1 full), metalness
  var LTILE = { plaster: 3.2, adobe: 2.6, concrete: 1.25, rammed: 1.7, ledgestone: 1.5, fieldstone: 1.6, ashlar: 2.2, cedar: 1.3, charred: 1.15, batten: 1.6, barnred: 2.0, planks: 2.2, logs: 1.8, shakes: 1.4, seam: 2.7, corrugated: 1.5, claytile: 1.3, canvas: 2.2, steel: 1.2, timber: 1.6, smooth: 3.0, glass: 2.0, travertine: 1.8, hewn: 1.6, rust: 2.4, saltillo: 1.8, doors: 1.0 };
  var LTK = { plaster: 1, adobe: 1, batten: 1, seam: 1, corrugated: 0.85, canvas: 1, steel: 1, timber: 1, smooth: 0.25, concrete: 0.15, cedar: 0.25, planks: 0.2, barnred: 0.15, logs: 0.2, shakes: 0.15 };
  var LMET = { steel: 0.55, seam: 0.45, corrugated: 0.4, glass: 0.0, rust: 0.12 };
  // per-layer flags: 1 decal (no per-home offset), 2 boards along v, 4 boards along u, 8 weathering patches, 16 lumpy plaster, 32 heavy base grime
  var LFLG = { doors: 1, planks: 10, logs: 10, cedar: 10, shakes: 10, batten: 12, barnred: 12, charred: 4, timber: 8, hewn: 8, adobe: 48, plaster: 48, rammed: 16 };
  var LBRD = { planks: 10, logs: 7, cedar: 9, shakes: 9, batten: 5, barnred: 8, charred: 8 };   // boards per texture repeat (a tone per board)
  var LOW = false; try { LOW = localStorage.getItem("g1:quality") === "low"; } catch (e) {}
  var TX = XH.tx = { a: null, n: null, ready: 0, low: LOW, want: 2, t0: performance.now() };
  function arrTex(bm, srgb) {
    var n = LNAMES.length, w = bm.width, h = Math.round(bm.height / n);
    var t = new THREE.DataArrayTexture(null, w, h, n); t.image = { data: bm, width: w, height: h, depth: n };
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.flipY = false; t.unpackAlignment = 1;
    t.anisotropy = 8; t.name = srgb ? "xh_alb" : "xh_nrm"; t.userData.avShared = true; t.needsUpdate = true; return t;
  }
  function fetchArr(name, srgb, key) {
    var url = au("/tex/" + name + (TX.low ? "_m" : "") + ".jpg?v=" + (window.BUILD || "dev"));
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("http " + r.status + " " + name); return r.blob(); })
      .then(function (b) { return createImageBitmap(b, { imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: "none" }); })
      .then(function (bm) { var t = arrTex(bm, srgb); TX[key] = t; TX.ready++; if (U.tXA) U[key === "a" ? "tXA" : "tXN"].value = t; XH.n.texMs = Math.round(performance.now() - TX.t0); return t; })
      .catch(function (e) { note("tex " + name, e); });
  }
  var U = XH.u = { tXA: { value: null }, tXN: { value: null } };   // shared uniform objects (every shell material and the depth material)
  // desktop tier: KTX2 arrays (BC7 on the GPU) through the client's KTX2 loader, the JPEG arrays as the fallback; low tier: the _m JPEGs
  var KTXON = !/[?&]xhktx=0\b/.test(location.search);
  // the KTX2 arrays come in chunks of 9 layers (every file far under the 25 MiB per-asset limit); the transcoded chunks are joined
  // level by level into one compressed array texture (layers are contiguous within a level), so the shader keeps one sampler
  var KCH = 3;
  function ktxArr(name, srgb, key) {
    var kl = null; try { kl = typeof ktx2Loader === "function" ? ktx2Loader() : null; } catch (e) { kl = null; }
    if (!kl) return fetchArr(name, srgb, key);
    var parts = [], got = 0, dead = false, tries = 0;
    // a dropped download (a busy server) is tried once more after 3 s; then the JPEG array loads instead (noted in XH.n, not an error)
    var fail = function (e) { if (dead) return; dead = true; parts.forEach(function (p) { try { p && p.dispose(); } catch (x) {} }); parts = []; got = 0;
      if (++tries < 2) { setTimeout(function () { dead = false; load(); }, 3000); return; }
      TX.ktxFail = (TX.ktxFail || 0) + 1; XH.n.ktxFallback = name + ": " + (e && e.message ? e.message : String(e)); fetchArr(name, srgb, key); };
    var merge = function () {
      try {
        var f = parts[0], depth = 0; parts.forEach(function (p) { depth += p.image.depth || 1; if (p.format !== f.format || p.image.width !== f.image.width || p.mipmaps.length !== f.mipmaps.length) throw new Error("chunk mismatch"); });
        if (depth !== LNAMES.length) throw new Error("layers " + depth);
        var mips = f.mipmaps.map(function (m0, li) { var tot = 0; parts.forEach(function (p) { tot += p.mipmaps[li].data.byteLength; }); var d = new Uint8Array(tot), o = 0; parts.forEach(function (p) { d.set(p.mipmaps[li].data, o); o += p.mipmaps[li].data.byteLength; }); return { data: d, width: m0.width, height: m0.height }; });
        var t = new THREE.CompressedArrayTexture(mips, f.image.width, f.image.height, depth, f.format, f.type);
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = mips.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.anisotropy = 8; t.flipY = false; t.generateMipmaps = false;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.name = name; t.userData.avShared = true; t.needsUpdate = true;
        t.onUpdate = function () { try { t.mipmaps.forEach(function (mm) { mm.data = null; }); } catch (e) {} };   // R6: the transcoded data is not kept after the upload
        parts.forEach(function (p) { try { p.dispose(); } catch (x) {} }); parts.length = 0;
        TX[key] = t; TX.ready++; TX.ktx = (TX.ktx || 0) + 1; if (U.tXA) U[key === "a" ? "tXA" : "tXN"].value = t; XH.n.texMs = Math.round(performance.now() - TX.t0);
        try { renderer.initTexture(t); } catch (e) {}
      } catch (e) { tries = 9; fail(e); }
    };
    var load = function () { try { for (var c = 0; c < KCH; c++) (function (c) { kl.load(au("/tex/" + name + "_" + c + ".ktx2?v=" + (window.BUILD || "dev")), function (t) { if (dead) { try { t.dispose(); } catch (x) {} return; } parts[c] = t; if (++got === KCH) merge(); }, undefined, fail); })(c); } catch (e) { fail(e); } };
    load();
  }
  function startTex() { if (TX.started) return; TX.started = true; TX.t0 = performance.now(); if (TX.low || !KTXON) { fetchArr("xh_alb", true, "a"); fetchArr("xh_nrm", false, "n"); } else { ktxArr("xh_alb", true, "a"); ktxArr("xh_nrm", false, "n"); } }
  XH.startTex = startTex;
  try { if (TX.low || !KTXON) startTex(); } catch (e) { note("tex start", e); }

  // ───────────────────────── palettes, material swaps, variant groups ─────────────────────────
  // tint slots (8 colourways each, sRGB hex; the hashed instance picks one per slot)
  var PAL = [
    null,
    [0xdcae82, 0xc99364, 0xe6c49a, 0xbd7d55, 0xd9a273, 0xeed8b8, 0xc8a07a, 0xae7350],   // 1 adobe walls
    [0xf3eee5, 0xebe2d2, 0xdfd2bd, 0xd6c8b0, 0xc8beaf, 0xeee0cb, 0xd2c1a8, 0xf7f4ee],   // 2 stucco
    [0xe9e5da, 0xe2d8c3, 0xb4bfac, 0x9fb1b7, 0xd6c59e, 0x7a382c, 0x5f6d58, 0xc7c2b5],   // 3 paint on boards
    [0x3d4245, 0x787d81, 0x9aa0a3, 0x5e4838, 0x7d4430, 0x2b2d2f, 0x53625a, 0xa07a5c],   // 4 metal roofing
    [0x222427, 0x2e3135, 0x4c3d30, 0xece9e2, 0x222427, 0x3c3732, 0x5d6165, 0x26282b],   // 5 steel trim and frames
    [0x2f7377, 0x7e3024, 0x3f5c76, 0x7a5434, 0xa8582f, 0x32503f, 0xcf9440, 0x51402f],   // 6 doors and accents
    [0x9a6a46, 0x6a4630, 0xb48a62, 0x7a6d5d, 0x88563a, 0xa98764, 0x55443a, 0x978672],   // 7 timber stain
    [0xf1eadb, 0xe8dfcf, 0xdcd3c3, 0xf5f1e8, 0xd4cbb9, 0xece5d6, 0xe1d8c6, 0xf3ecdd],   // 8 canvas
    [0xd8d1c4, 0xcfc4b2, 0xe2dccf, 0xc4b8a6, 0xd6cbb8, 0xbfb6a8, 0xdcd4c4, 0xcac0ae]    // 9 smooth concrete and plinths
  ];
  // material swap slots (100 + slot): four layer options each
  var SWAP = [
    null,
    ["concrete", "rammed", "ledgestone", "ashlar"],     // 1 villa ground floor feature walls
    ["plaster", "cedar", "charred", "plaster"],          // 2 villa upper floor
    ["planks", "batten", "logs", "batten"],             // 3 ranch walls
    ["seam", "shakes", "rust", "corrugated"],           // 4 ranch roof
    ["barnred", "batten", "planks", "barnred"],          // 5 barn walls
    ["corrugated", "rust", "seam", "shakes"],           // 6 barn roof
    ["corrugated", "seam", "corrugated", "batten"],     // 7 shed walls
    ["ashlar", "ledgestone", "plaster", "concrete"],     // 8 home base storey
    ["smooth", "fieldstone", "adobe", "smooth"],        // 9 casita plinth
    ["claytile", "seam", "claytile", "shakes"],         // 10 home pitched roof
    ["fieldstone", "ledgestone", "ashlar", "fieldstone"], // 11 chimneys
    ["cedar", "charred", "cedar", "rammed"],             // 12 villa wing cladding
    ["seam", "corrugated", "rust", "seam"],             // 13 shed roof
    ["smooth", "saltillo", "smooth", "saltillo"]        // 14 casita porch floor
  ];
  // geometry variant groups: options per group (the hashed instance picks one; a vertex carries the bitmask of options it is in)
  var VARN = [1, 3, 2, 3, 2, 2, 2, 2, 3, 2, 2, 2, 3, 2, 1, 1];
  XH.cfg = { PAL: PAL, SWAP: SWAP, VARN: VARN, LNAMES: LNAMES };
  function col(h) { var c = new THREE.Color(h); return c; }
  function uniformsOnce() {
    if (U.uPal) return U;
    var pal = []; for (var s = 0; s < 12; s++) for (var k = 0; k < 8; k++) { var row = PAL[s]; pal.push(row ? col(row[k]) : new THREE.Color(1, 1, 1)); }
    var swap = []; for (var s2 = 0; s2 < 16; s2++) { var r2 = SWAP[s2]; swap.push(r2 ? new THREE.Vector4(L[r2[0]], L[r2[1]], L[r2[2]], L[r2[3]]) : new THREE.Vector4(0, 0, 0, 0)); }
    var varn = []; for (var g = 0; g < 4; g++) varn.push(new THREE.Vector4(VARN[g * 4], VARN[g * 4 + 1], VARN[g * 4 + 2], VARN[g * 4 + 3]));
    var tile = [], tk = []; for (var q = 0; q < 7; q++) { var v1 = [], v2 = []; for (var j = 0; j < 4; j++) { var nm = LNAMES[q * 4 + j]; v1.push(nm ? 1 / (LTILE[nm] || 2) : 0.5); v2.push(nm ? (LTK[nm] !== undefined ? LTK[nm] : 0) : 0); } tile.push(new THREE.Vector4(v1[0], v1[1], v1[2], v1[3])); tk.push(new THREE.Vector4(v2[0], v2[1], v2[2], v2[3])); }
    var met = [], flg = [], brd = []; for (var q3 = 0; q3 < 7; q3++) { var f4 = [], b4 = []; for (var j3 = 0; j3 < 4; j3++) { var nm3 = LNAMES[q3 * 4 + j3]; f4.push(nm3 && LFLG[nm3] ? LFLG[nm3] : 0); b4.push(nm3 && LBRD[nm3] ? LBRD[nm3] : 0); } flg.push(new THREE.Vector4(f4[0], f4[1], f4[2], f4[3])); brd.push(new THREE.Vector4(b4[0], b4[1], b4[2], b4[3])); }
    for (var q2 = 0; q2 < 7; q2++) { var v3 = []; for (var j2 = 0; j2 < 4; j2++) { var nm2 = LNAMES[q2 * 4 + j2]; v3.push(nm2 && LMET[nm2] ? LMET[nm2] : 0); } met.push(new THREE.Vector4(v3[0], v3[1], v3[2], v3[3])); }
    U.uPal = { value: pal }; U.uSwap = { value: swap }; U.uVarN = { value: varn }; U.uTile = { value: tile }; U.uTk = { value: tk }; U.uMet = { value: met }; U.uFlg = { value: flg }; U.uBrd = { value: brd };
    try { U.uNight = WIN.u.uNight; U.uTime = WIN.u.uTime; } catch (e) { U.uNight = { value: 0 }; U.uTime = { value: 0 }; }
    try { U.tRoom = { value: texLoader0.load(au("/tex/room.jpg")) }; U.tRoom.value.colorSpace = THREE.SRGBColorSpace; U.tRoom.value.anisotropy = 4; } catch (e) { U.tRoom = { value: null }; note("room tex", e); }
    return U;
  }

  // ───────────────────────── GLSL ─────────────────────────
  // aXH: x = layer (or 100 + swap slot), y = tint slot, z = variant code (group * 256 + option mask; 0 = always), w = flags (1 glass-like window face)
  var GL_HASH = [
    "float xhH(vec2 p) { p = floor(p * 2.0) + 0.5; return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
    "float xhPick(float h, float k, float n) { return floor(fract(h * k + k * 0.618) * n * 0.9999); }",
    "vec2 xhInstXZ() {",
    "#ifdef USE_INSTANCING",
    " return (modelMatrix * instanceMatrix[3]).xz;",
    "#else",
    " return modelMatrix[3].xz;",
    "#endif",
    "}",
    "bool xhKeep(float code, float h) { if (code < 0.5) return true; int c = int(code + 0.5); int g = c >> 8; int msk = c & 255; float n = uVarN[g >> 2][g & 3]; int ch = int(xhPick(h, 3.17 + float(g) * 1.31, n)); return ((msk >> ch) & 1) == 1; }"
  ].join("\n");
  var GL_VPARS = "attribute vec4 aXH; attribute float aXE; uniform vec4 uVarN[4]; uniform vec4 uSwap[16]; uniform vec3 uPal[96]; uniform vec4 uTile[7]; uniform vec4 uTk[7]; uniform vec4 uMet[7]; uniform vec4 uFlg[7];\nvarying vec3 vXUV; flat varying vec4 vXT; varying vec3 vXP; flat varying float vXF; flat varying float vXE;\n" + GL_HASH;
  var GL_VMAIN = [
    "{ vec2 xip = xhInstXZ(); float xh = xhH(xip);",
    "  if (!xhKeep(aXH.z, xh)) transformed = vec3(0.0);",
    "  float lay = aXH.x; if (lay > 99.5) { int s = int(lay - 99.5); lay = uSwap[s][int(xhPick(xh, 2.39 + float(s) * 0.77, 4.0))]; }",
    "  int li = int(lay + 0.5); float til = uTile[li >> 2][li & 3]; float tk = uTk[li >> 2][li & 3];",
    "  vec3 tc = vec3(1.0); int ts = int(aXH.y + 0.5); if (ts > 0) tc = uPal[ts * 8 + int(xhPick(xh, 3.71 + float(ts) * 1.13, 8.0))];",
    "  vXT = vec4(mix(vec3(1.0), tc, tk), uMet[li >> 2][li & 3]);",
    "  vec2 off = vec2(fract(xh * 7.31), fract(xh * 3.17)) * 4.0; if ((int(uFlg[li >> 2][li & 3] + 0.5) & 1) != 0) off = vec2(0.0); vXE = aXE;",
    "  vXUV = vec3(uv * til + off, lay); vXF = aXH.w;",
    "  vXP = vec3(position.y, xip.x + position.x * 0.7 + position.z * 0.3, xip.y + position.z * 0.7 - position.x * 0.3); }"
  ].join("\n");
  var GL_FPARS = [
    "precision highp sampler2DArray; uniform sampler2DArray tXA; uniform sampler2DArray tXN; uniform float uNight; uniform float uTime;",
    "varying vec3 vXUV; flat varying vec4 vXT; varying vec3 vXP; flat varying float vXF; flat varying float vXE; uniform vec4 uFlg[7]; uniform vec4 uBrd[7];",
    "vec3 xhBump(vec3 p, vec3 n, float h) { vec3 sx = dFdx(p), sy = dFdy(p); vec3 r1 = cross(sy, n), r2 = cross(n, sx); float det = dot(sx, r1); vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2); return normalize(abs(det) * n - g); }",
    "float xhN2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5); float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5); float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5); float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }",
    "vec3 xhPerturb(vec3 N, vec3 p, vec2 uv, vec2 nxy) { vec3 dp1 = dFdx(p), dp2 = dFdy(p); vec2 du1 = dFdx(uv), du2 = dFdy(uv); vec3 q1 = cross(dp2, N), q2 = cross(N, dp1); vec3 T = q1 * du1.x + q2 * du2.x; vec3 B = q1 * du1.y + q2 * du2.y; float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12)); vec3 tn = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy)))); return normalize(T * im * tn.x + B * im * tn.y + N * tn.z); }"
  ].join("\n");
  var GL_FMAP = [
    "vec4 xA = texture(tXA, vXUV); vec3 xN = texture(tXN, vXUV).xyz;",
    "int xli = int(vXUV.z + 0.5); int xfl = int(uFlg[xli >> 2][xli & 3] + 0.5); float xnb = uBrd[xli >> 2][xli & 3]; vec2 xw = vec2(vXP.y + vXP.z, vXP.x);",
    "float xmac = 0.9 + 0.2 * xhN2(vXP.yz * 0.35) + 0.06 * xhN2(vXP.yz * 1.7);",
    "vec3 xc = xA.rgb * vXT.rgb;",
    "if (xnb > 0.5) { float bc = (xfl & 4) != 0 ? vXUV.x : vXUV.y; float bi = floor(bc * xnb); float bh = fract(sin(bi * 91.7 + vXUV.z * 13.1 + floor(vXP.y * 0.1) * 3.7) * 43758.5); float bh2 = fract(bh * 7.7); xc *= (0.8 + 0.36 * bh) * vec3(1.0, 1.0 - 0.05 * bh2, 1.0 - 0.1 * bh2); }",
    "float xwt = 0.0; if ((xfl & 8) != 0) { xwt = smoothstep(0.5, 0.78, xhN2(xw * 0.45 + 31.0) * 0.65 + xhN2(xw * 1.9 + 7.0) * 0.35); float xg0 = dot(xc, vec3(0.3, 0.59, 0.11)); xc = mix(xc, vec3(xg0) * vec3(1.05, 1.04, 1.02) * 1.2, xwt * 0.72); }",
    "float xgk = (xfl & 32) != 0 ? 1.0 : 0.72; float xgh = 0.3 + 0.42 * xhN2(vec2(xw.x * 1.6, 3.0)) + 0.14 * xhN2(vec2(xw.x * 6.0, 9.0)); float xg = (1.0 - smoothstep(xgh * 0.45, xgh, vXP.x)) * step(vXF, 0.5);",
    "xc = mix(xc, xc * vec3(0.6, 0.52, 0.44), xg * 0.62 * xgk);",
    "float xao = 1.0; if (vXE < 90.0) xao = 1.0 - 0.38 * smoothstep(vXE - 1.2, vXE, vXP.x) * step(vXP.x, vXE + 0.03);",
    "if (vXF > 1.5 && vXF < 2.5) xc = mix(xc, vec3(dot(xc, vec3(0.3, 0.59, 0.11))) * 1.14, 0.3) * 1.05;",
    "diffuseColor.rgb *= xc * xmac * xao; float xrAdd = xwt * 0.08 + xg * 0.08;"
  ].join("\n");
  var GL_FEMIS = [
    "if (vXF > 0.5 && vXF < 1.5) { float wr = fract(sin(dot(floor(vXP.yz * 0.6), vec2(41.3, 17.9))) * 4375.5); float wl = step(0.4, wr) * uNight; vec3 wc = mix(vec3(1.0, 0.62, 0.32), vec3(1.0, 0.78, 0.5), fract(wr * 7.0)); totalEmissiveRadiance += wc * wl * 0.55; }"
  ].join("\n");
  function shellObc(sh) {
    var u = uniformsOnce(); for (var k in u) sh.uniforms[k] = u[k];
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + GL_VPARS).replace("#include <begin_vertex>", "#include <begin_vertex>\n" + GL_VMAIN);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + GL_FPARS)
      .replace("#include <map_fragment>", "#include <map_fragment>\n" + GL_FMAP)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor = clamp(xN.b + xrAdd, 0.04, 1.0); ")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\n metalnessFactor = vXT.a; ")
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n normal = xhPerturb(normal, -vViewPosition, vXUV.xy, (xN.xy * 2.0 - 1.0) * (faceDirection > 0.0 ? 1.0 : -1.0)); if ((xfl & 16) != 0) normal = xhBump(-vViewPosition, normal, 0.016 * (xhN2(xw * 1.3) + 0.45 * xhN2(xw * 3.7 + 5.0)));")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + GL_FEMIS);
  }
  var MAT = XH.mat = {};
  function shellMat() {
    if (MAT.shell) return MAT.shell;
    var m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: 0.7 });
    m.name = "xh_shell"; m.userData.avShared = true; m.onBeforeCompile = shellObc; m.customProgramCacheKey = function () { return "xh_shell_2"; };
    return (MAT.shell = m);
  }
  function depthMat() {
    if (MAT.depth) return MAT.depth;
    var m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); m.name = "xh_depth"; m.userData.avShared = true;
    m.onBeforeCompile = function (sh) { var u = uniformsOnce(); sh.uniforms.uVarN = u.uVarN;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 aXH; uniform vec4 uVarN[4];\n" + GL_HASH).replace("#include <begin_vertex>", "#include <begin_vertex>\n{ float xh = xhH(xhInstXZ()); if (!xhKeep(aXH.z, xh)) transformed = vec3(0.0); }"); };
    m.customProgramCacheKey = function () { return "xh_depth_1"; };
    return (MAT.depth = m);
  }
  // glass: opaque panes with a room behind them (interior mapping: back wall photo, side walls, floor, ceiling), sky reflections
  // by day from the environment, warm lit rooms at night (about 6 in 10). aXG: x, y = pane size (m), z = seed, w = sill height
  function glassObc(sh) {
    var u = uniformsOnce(); sh.uniforms.uNight = u.uNight; sh.uniforms.tRoom = u.tRoom; sh.uniforms.uTime = u.uTime;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 aXG; varying vec3 vGW; varying vec3 vGN; varying vec4 vGP; flat varying float vGS;\n" + GL_HASH.replace(/uVarN\[g >> 2\]\[g & 3\]/, "1.0"))
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n{ vec4 gw = vec4(transformed, 1.0); vec3 gn = objectNormal;\n#ifdef USE_INSTANCING\n gw = instanceMatrix * gw; gn = mat3(instanceMatrix) * gn;\n#endif\n vGW = (modelMatrix * gw).xyz; vGN = normalize(mat3(modelMatrix) * gn); vGP = vec4(uv * aXG.xy, aXG.xy); vGS = fract(aXG.z + xhH(xhInstXZ()) * 13.7) + floor(aXG.w * 100.0 + 0.5); }");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight; uniform float uTime; uniform sampler2D tRoom; varying vec3 vGW; varying vec3 vGN; varying vec4 vGP; flat varying float vGS;")
      .replace("#include <emissivemap_fragment>", [
        "#include <emissivemap_fragment>",
        "{ float seed = fract(vGS); float sill = floor(vGS) / 100.0; vec3 Nw = normalize(vGN); vec3 Uw = normalize(cross(vec3(0.0, 1.0, 0.0), Nw)); vec3 Vd = normalize(vGW - cameraPosition);",
        "  vec3 d = vec3(dot(Vd, Uw), Vd.y, -dot(Vd, Nw)); d.z = max(d.z, 0.05); vec2 sz = vGP.zw; float W = max(sz.x, 1.2), D = 3.2 + seed * 1.6; float yF = -sill, yC = yF + 2.9;",
        "  vec3 p0 = vec3(vGP.x - (sz.x - W) * 0.5, vGP.y, 0.0);",
        "  float tx = d.x > 0.0 ? (W - p0.x) / d.x : -p0.x / min(d.x, -1e-4); float ty = d.y > 0.0 ? (yC - p0.y) / d.y : (yF - p0.y) / min(d.y, -1e-4); float tz = (D - p0.z) / d.z;",
        "  float t = min(tx, min(ty, tz)); vec3 hp = p0 + d * t; float lit = step(0.38, fract(seed * 7.13)); vec3 rc; float depthK = 1.0 - 0.45 * clamp(hp.z / D, 0.0, 1.0);",
        "  vec3 wallC = mix(vec3(0.82, 0.74, 0.64), vec3(0.72, 0.76, 0.74), step(0.6, fract(seed * 3.3)));",
        "  if (t == tz) { vec2 ruv = vec2(fract(seed * 5.1) * 0.45 + hp.x / W * 0.55, clamp((hp.y - yF) / 2.9, 0.0, 1.0)); if (fract(seed * 9.7) > 0.5) ruv.x = 1.0 - ruv.x; rc = texture2D(tRoom, ruv).rgb * 0.9; }",
        "  else if (t == tx) rc = wallC * (0.75 + 0.25 * clamp((hp.y - yF) / 2.9, 0.0, 1.0));",
        "  else if (d.y < 0.0) rc = mix(vec3(0.42, 0.30, 0.20), vec3(0.62, 0.55, 0.46), step(0.5, fract(seed * 2.7))) * (0.8 + 0.2 * fract(hp.x * 1.3));",
        "  else rc = vec3(0.86, 0.83, 0.78);",
        "  rc *= depthK;",
        "  vec2 pq = vGP.xy / max(sz, vec2(0.01)); float cur = step(0.55, fract(seed * 4.3)) * (smoothstep(0.30, 0.0, pq.x) + smoothstep(0.70, 1.0, pq.x)) * 0.85; rc = mix(rc, vec3(0.93, 0.9, 0.84) * (0.75 + 0.25 * sin(pq.x * 90.0)), cur);",
        "  float dayK = 0.30 * (1.0 - uNight); float nightK = uNight * mix(0.025, 0.95, lit); vec3 lamp = mix(vec3(1.0, 0.70, 0.42), vec3(1.0, 0.82, 0.6), fract(seed * 11.0));",
        "  diffuseColor.rgb = vec3(0.015); totalEmissiveRadiance += rc * (dayK + nightK * lamp * 1.25); }"
      ].join("\n"));
  }
  function glassMat() {
    if (MAT.glass) return MAT.glass;
    var m = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.06, metalness: 0.0, envMapIntensity: 1.25 }); m.name = "xh_glass"; m.userData.avShared = true; m.userData.glass = true;
    m.onBeforeCompile = glassObc; m.customProgramCacheKey = function () { return "xh_glass_1"; };
    return (MAT.glass = m);
  }

  // ───────────────────────── geometry kit (model frame: x right seen from the front, y up, z toward the front) ─────────────────────────
  // M = { L: layer index or 100 + swap slot, t: tint slot, rot: boards run the other way, s: uv scale } ; CUR = variant code and flags
  var CUR = { v: 0, f: 0, top: 99 };   // top: the height of the overhang over the faces being built (eave occlusion), 99 = none
  function VAR(g, mask) { CUR.v = g ? g * 256 + mask : 0; }
  function Geo() { return { p: [], n: [], u: [], x: [], e: [], i: [], c: 0 }; }
  function GGeo() { return { p: [], n: [], u: [], g: [], i: [], c: 0 }; }
  function vt(G, x, y, z, nx, ny, nz, u, v, M) { G.p.push(x, y, z); G.n.push(nx, ny, nz); G.u.push(u, v); G.x.push(M.L, M.t || 0, CUR.v, M.f !== undefined ? M.f : CUR.f); G.e.push(M.top !== undefined ? M.top : CUR.top); return G.c++; }
  // a rectangle on the plane through O spanned by unit axes A (along) and B (up), normal N = A x B; a in [a0, a1], b in [b0, b1]
  function rect(G, O, A, B, N, a0, a1, b0, b1, M) {
    if (a1 - a0 < 1e-4 || b1 - b0 < 1e-4) return;
    var s = M.s || 1, r = !!M.rot, k = G.c;
    var P = function (a, b) { return [O[0] + A[0] * a + B[0] * b, O[1] + A[1] * a + B[1] * b, O[2] + A[2] * a + B[2] * b]; };
    var cs = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];
    for (var i = 0; i < 4; i++) { var q = P(cs[i][0], cs[i][1]); var uu = (r ? cs[i][1] : cs[i][0]) * s, vv = (r ? -cs[i][0] : cs[i][1]) * s; vt(G, q[0], q[1], q[2], N[0], N[1], N[2], uu + (M.uo || 0), vv + (M.vo || 0), M); }
    G.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  // a rectangle with explicit uvs (decals such as the carved doors): u0..u1 across, v0..v1 up
  function rectUV(G, O, A, B, N, a0, a1, b0, b1, u0, u1, v0, v1, M) {
    var k = G.c; var P = function (a, b) { return [O[0] + A[0] * a + B[0] * b, O[1] + A[1] * a + B[1] * b, O[2] + A[2] * a + B[2] * b]; };
    [[a0, b0, u0, v0], [a1, b0, u1, v0], [a1, b1, u1, v1], [a0, b1, u0, v1]].forEach(function (c) { var q = P(c[0], c[1]); vt(G, q[0], q[1], q[2], N[0], N[1], N[2], c[2], c[3], M); });
    G.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  // a free quad (corners CCW seen from the normal side) with uvs from a local frame: uv = (dot(p - O, A), dot(p - O, B))
  function quad4(G, P0, P1, P2, P3, A, B, O, M) {
    var e1 = [P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]], e2 = [P3[0] - P0[0], P3[1] - P0[1], P3[2] - P0[2]];
    var N = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; var l = Math.hypot(N[0], N[1], N[2]) || 1; N = [N[0] / l, N[1] / l, N[2] / l];
    var s = M.s || 1, k = G.c, r = !!M.rot; [P0, P1, P2, P3].forEach(function (p) { var dx = p[0] - O[0], dy = p[1] - O[1], dz = p[2] - O[2]; var a = dx * A[0] + dy * A[1] + dz * A[2], b = dx * B[0] + dy * B[1] + dz * B[2]; vt(G, p[0], p[1], p[2], N[0], N[1], N[2], (r ? b : a) * s, (r ? -a : b) * s, M); });
    G.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  // a quad with a given normal (for faces that may degenerate into triangles, like gambrel gable pieces)
  function quadN(G, P0, P1, P2, P3, N, A, B, O, M) {
    var s = M.s || 1, k = G.c; [P0, P1, P2, P3].forEach(function (p) { var dx = p[0] - O[0], dy = p[1] - O[1], dz = p[2] - O[2]; vt(G, p[0], p[1], p[2], N[0], N[1], N[2], (dx * A[0] + dy * A[1] + dz * A[2]) * s, (dx * B[0] + dy * B[1] + dz * B[2]) * s, M); });
    G.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  function tri3(G, P0, P1, P2, A, B, O, M) {
    var e1 = [P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]], e2 = [P2[0] - P0[0], P2[1] - P0[1], P2[2] - P0[2]];
    var N = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; var l = Math.hypot(N[0], N[1], N[2]) || 1; N = [N[0] / l, N[1] / l, N[2] / l];
    var s = M.s || 1, k = G.c; [P0, P1, P2].forEach(function (p) { var dx = p[0] - O[0], dy = p[1] - O[1], dz = p[2] - O[2]; vt(G, p[0], p[1], p[2], N[0], N[1], N[2], (dx * A[0] + dy * A[1] + dz * A[2]) * s, (dx * B[0] + dy * B[1] + dz * B[2]) * s, M); });
    G.i.push(k, k + 1, k + 2);
  }
  var XP = [1, 0, 0], XN = [-1, 0, 0], YP = [0, 1, 0], YN = [0, -1, 0], ZP = [0, 0, 1], ZN = [0, 0, -1], O0 = [0, 0, 0];
  // the six faces of an axis box; skip: string of faces to leave out ("t" top, "b" bottom, "f" +z, "k" -z, "r" +x, "l" -x); MS: per-face materials
  function box(G, x0, x1, y0, y1, z0, z1, M, skip, MS) {
    skip = skip || ""; MS = MS || {};
    if (skip.indexOf("f") < 0) rect(G, [0, 0, z1], XP, YP, ZP, x0, x1, y0, y1, MS.f || M);
    if (skip.indexOf("k") < 0) rect(G, [0, 0, z0], XN, YP, ZN, -x1, -x0, y0, y1, MS.k || M);
    if (skip.indexOf("r") < 0) rect(G, [x1, 0, 0], ZN, YP, XP, -z1, -z0, y0, y1, MS.r || M);
    if (skip.indexOf("l") < 0) rect(G, [x0, 0, 0], ZP, YP, XN, z0, z1, y0, y1, MS.l || M);
    if (skip.indexOf("t") < 0) rect(G, [0, y1, 0], XP, ZN, YP, x0, x1, -z1, -z0, MS.t || M);
    if (skip.indexOf("b") < 0) rect(G, [0, y0, 0], XP, ZP, YN, x0, x1, z0, z1, MS.b || M);
  }
  // an oriented box: centre c, unit axes a (length), b (up), half sizes
  function obox(G, c, a, b, ha, hb, hc, M) {
    var n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    var P = function (sa, sb, sc) { return [c[0] + a[0] * ha * sa + b[0] * hb * sb + n[0] * hc * sc, c[1] + a[1] * ha * sa + b[1] * hb * sb + n[1] * hc * sc, c[2] + a[2] * ha * sa + b[2] * hb * sb + n[2] * hc * sc]; };
    var neg = function (v) { return [-v[0], -v[1], -v[2]]; };
    quad4(G, P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), a, b, c, M);
    quad4(G, P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), neg(a), b, c, M);
    quad4(G, P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1), a, neg(n), c, M);
    quad4(G, P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), a, n, c, M);
    quad4(G, P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), neg(n), b, c, M);
    quad4(G, P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), n, b, c, M);
  }
  // a beam between two points (square section w x h, b axis = up projected)
  function beam(G, p, q, w, h, M) {
    var d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], l = Math.hypot(d[0], d[1], d[2]); if (l < 1e-4) return; d = [d[0] / l, d[1] / l, d[2] / l];
    var up = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]; var dot = up[0] * d[0] + up[1] * d[1] + up[2] * d[2]; var b = [up[0] - d[0] * dot, up[1] - d[1] * dot, up[2] - d[2] * dot]; var bl = Math.hypot(b[0], b[1], b[2]); b = [b[0] / bl, b[1] / bl, b[2] / bl];
    obox(G, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], d, b, l / 2, h / 2, w / 2, M);
  }
  // vertical cylinder (posts, vigas use cylX / cylZ)
  function cylY(G, x, z, y0, y1, r, seg, M, cap) {
    var k0 = G.c, s = M.s || 1; for (var i = 0; i <= seg; i++) { var a = i / seg * PI * 2, cx = Math.cos(a), sz = Math.sin(a); vt(G, x + cx * r, y0, z + sz * r, cx, 0, sz, a * r * s, y0 * s, M); vt(G, x + cx * r, y1, z + sz * r, cx, 0, sz, a * r * s, y1 * s, M); }
    for (var j = 0; j < seg; j++) { var b = k0 + j * 2; G.i.push(b, b + 1, b + 3, b, b + 3, b + 2); }
    if (cap) { var kc = G.c; vt(G, x, y1, z, 0, 1, 0, 0, 0, M); for (var m = 0; m <= seg; m++) { var a2 = m / seg * PI * 2; vt(G, x + Math.cos(a2) * r, y1, z + Math.sin(a2) * r, 0, 1, 0, Math.cos(a2) * r * s, Math.sin(a2) * r * s, M); } for (var t = 0; t < seg; t++) G.i.push(kc, kc + 2 + t, kc + 1 + t); }
  }
  // horizontal cylinder along z (vigas poking out of a wall), from z0 to z1 at (x, y)
  function cylZ(G, x, y, z0, z1, r, seg, M) {
    var k0 = G.c, s = M.s || 1; for (var i = 0; i <= seg; i++) { var a = i / seg * PI * 2, cx = Math.cos(a), cy = Math.sin(a); vt(G, x + cx * r, y + cy * r, z0, cx, cy, 0, a * r * s, z0 * s, M); vt(G, x + cx * r, y + cy * r, z1, cx, cy, 0, a * r * s, z1 * s, M); }
    for (var j = 0; j < seg; j++) { var b = k0 + j * 2; G.i.push(b, b + 3, b + 1, b, b + 2, b + 3); }
    var kc = G.c; vt(G, x, y, z1, 0, 0, 1, 0.5, 0.5, M); for (var m = 0; m <= seg; m++) { var a2 = m / seg * PI * 2; vt(G, x + Math.cos(a2) * r, y + Math.sin(a2) * r, z1, 0, 0, 1, 0.5 + Math.cos(a2) * 0.5, 0.5 + Math.sin(a2) * 0.5, M); } for (var t = 0; t < seg; t++) G.i.push(kc, kc + 1 + t, kc + 2 + t);
  }
  // horizontal cylinder along x from xa (in the wall) to xb (the cut end, capped), at (y, z)
  function cylX(G, xa, xb, y, z, r, seg, M) {
    var k0 = G.c, s = M.s || 1, dir = xb > xa ? 1 : -1; for (var i = 0; i <= seg; i++) { var a = i / seg * PI * 2, cy = Math.cos(a), cz = Math.sin(a); vt(G, xa, y + cy * r, z + cz * r, 0, cy, cz, a * r * s, xa * s, M); vt(G, xb, y + cy * r, z + cz * r, 0, cy, cz, a * r * s, xb * s, M); }
    for (var j = 0; j < seg; j++) { var b = k0 + j * 2; if (dir > 0) G.i.push(b, b + 3, b + 1, b, b + 2, b + 3); else G.i.push(b, b + 1, b + 3, b, b + 3, b + 2); }
    var kc = G.c; vt(G, xb, y, z, dir, 0, 0, 0.5, 0.5, M); for (var m = 0; m <= seg; m++) { var a2 = m / seg * PI * 2; vt(G, xb, y + Math.cos(a2) * r, z + Math.sin(a2) * r, dir, 0, 0, 0.5 + Math.cos(a2) * 0.5, 0.5 + Math.sin(a2) * 0.5, M); } for (var t = 0; t < seg; t++) { if (dir > 0) G.i.push(kc, kc + 1 + t, kc + 2 + t); else G.i.push(kc, kc + 2 + t, kc + 1 + t); }
  }
  // a wall plane with rectangular holes: O, A (along, seen from outside left to right), B = up, N = outward normal
  // holes: [a0, a1, b0, b1, depth]; the reveals (jambs, head, sill) go in by depth with the reveal material R
  function wallH(G, O, A, N, a0, a1, b0, b1, holes, M, R) {
    var B = YP; holes = (holes || []).filter(function (h) { return h[1] > a0 && h[0] < a1 && h[3] > b0 && h[2] < b1; });
    var xs = [a0, a1]; holes.forEach(function (h) { xs.push(Math.max(a0, h[0]), Math.min(a1, h[1])); }); xs = xs.filter(function (v, i, s) { return s.indexOf(v) === i; }).sort(function (p, q) { return p - q; });
    for (var i = 0; i < xs.length - 1; i++) { var c0 = xs[i], c1 = xs[i + 1]; if (c1 - c0 < 1e-4) continue; var mid = (c0 + c1) / 2;
      var cov = holes.filter(function (h) { return h[0] < mid && h[1] > mid; }).map(function (h) { return [Math.max(b0, h[2]), Math.min(b1, h[3])]; }).sort(function (p, q) { return p[0] - q[0]; });
      var y = b0; cov.forEach(function (cv) { if (cv[0] > y) rect(G, O, A, B, N, c0, c1, y, cv[0], M); y = Math.max(y, cv[1]); }); if (y < b1) rect(G, O, A, B, N, c0, c1, y, b1, M); }
    var RM = R || M;
    holes.forEach(function (h) { var d = h[4] || 0.2; var nn = [-N[0], -N[1], -N[2]];
      var at = function (a, b) { return [O[0] + A[0] * a + B[0] * b, O[1] + A[1] * a + B[1] * b, O[2] + A[2] * a + B[2] * b]; };
      // left jamb faces +A, right jamb faces -A, head faces down, sill faces up; each spans the depth into the wall
      rect(G, at(h[0], 0), nn, B, A, 0, d, h[2], h[3], RM);
      rect(G, at(h[1], 0), N, B, [-A[0], -A[1], -A[2]], -d, 0, h[2], h[3], RM);
      var hd = at(0, h[3]); rect(G, hd, A, N, YN, h[0], h[1], -d, 0, RM);
      var sl = at(0, h[2]); rect(G, sl, A, nn, YP, h[0], h[1], 0, d, RM); });
  }
  // a window unit set into a hole: glass pane at depth d, frame bars and mullions (proud of the glass), a sill outside
  function winUnit(G, GG, O, A, N, a0, a1, b0, b1, d, FM, opt) {
    opt = opt || {}; var B = YP; var fw = opt.fw || 0.06, cols = opt.cols || 1, rows = opt.rows || 1; var q = opt.q || 0;
    var at = function (a, b, z) { return [O[0] + A[0] * a + N[0] * z, O[1] + b, O[2] + A[2] * a + N[2] * z]; };
    if (q === 0) { var gp = at(0, 0, -d); glassPane(GG, gp, A, N, a0, a1, b0, b1, opt.seed || 0, opt.sill !== undefined ? opt.sill : b0); }
    else { rect(G, at(0, 0, -d), A, B, N, a0, a1, b0, b1, { L: L.glass, t: 0, f: 1 }); }
    if (q >= 2) return;
    var fz = -d + 0.03, fd = 0.06;
    // outer frame
    beam(G, at(a0, b0 + fw / 2, fz), at(a1, b0 + fw / 2, fz), fd, fw, FM); beam(G, at(a0, b1 - fw / 2, fz), at(a1, b1 - fw / 2, fz), fd, fw, FM);
    beam(G, at(a0 + fw / 2, b0, fz), at(a0 + fw / 2, b1, fz), fd, fw, FM); beam(G, at(a1 - fw / 2, b0, fz), at(a1 - fw / 2, b1, fz), fd, fw, FM);
    var mw = opt.mw || fw * 0.7;
    for (var c = 1; c < cols; c++) { var a = a0 + (a1 - a0) * c / cols; beam(G, at(a, b0, fz), at(a, b1, fz), fd * 0.8, mw, FM); }
    for (var r = 1; r < rows; r++) { var b = b0 + (b1 - b0) * r / rows; beam(G, at(a0, b, fz), at(a1, b, fz), fd * 0.8, mw, FM); }
    if (opt.sillM) { var sz0 = 0.06; box2(G, at(0, 0, 0), A, N, a0 - 0.05, a1 + 0.05, b0 - 0.07, b0, -d, sz0, opt.sillM); }
  }
  // a box in a wall frame (A along, N out): a range, y range, depth range (n0, n1 along N)
  function box2(G, O, A, N, a0, a1, y0, y1, n0, n1, M) {
    if (Math.abs(N[2]) > 0.5) { var s = N[2] > 0 ? 1 : -1; var x0 = O[0] + A[0] * a0, x1 = O[0] + A[0] * a1; box(G, Math.min(x0, x1), Math.max(x0, x1), O[1] + y0, O[1] + y1, O[2] + Math.min(n0 * s, n1 * s), O[2] + Math.max(n0 * s, n1 * s), M); }
    else { var s2 = N[0] > 0 ? 1 : -1; var z0 = O[2] + A[2] * a0, z1 = O[2] + A[2] * a1; box(G, O[0] + Math.min(n0 * s2, n1 * s2), O[0] + Math.max(n0 * s2, n1 * s2), O[1] + y0, O[1] + y1, Math.min(z0, z1), Math.max(z0, z1), M); }
  }
  function glassPane(GG, O, A, N, a0, a1, b0, b1, seed, sill) {
    var k = GG.c, w = a1 - a0, h = b1 - b0; var cs = [[a0, b0, 0, 0], [a1, b0, 1, 0], [a1, b1, 1, 1], [a0, b1, 0, 1]];
    for (var i = 0; i < 4; i++) { var c = cs[i]; GG.p.push(O[0] + A[0] * c[0], O[1] + c[1], O[2] + A[2] * c[0]); GG.n.push(N[0], N[1], N[2]); GG.u.push(c[2], c[3]); GG.g.push(w, h, seed, Math.min(0.99, Math.max(0, sill) / 3)); GG.c++; }
    GG.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  // the four walls of an axis box with holes per face. faces: { f: [holes], k: [...], r: [...], l: [...] } in face coordinates
  // (a from the left corner seen from outside, b = y). skip: faces to leave out. Returns the face frames for window placement.
  function walls(G, x0, x1, z0, z1, y0, y1, M, holes, R, skip) {
    holes = holes || {}; skip = skip || ""; var F = faceFrames(x0, x1, z0, z1);
    ["f", "k", "r", "l"].forEach(function (k) { if (skip.indexOf(k) >= 0) return; var f = F[k]; wallH(G, f.O, f.A, f.N, 0, f.len, y0, y1, holes[k], M, R); });
    return F;
  }
  function faceFrames(x0, x1, z0, z1) {
    return { f: { O: [x0, 0, z1], A: XP, N: ZP, len: x1 - x0 }, k: { O: [x1, 0, z0], A: XN, N: ZN, len: x1 - x0 }, r: { O: [x1, 0, z1], A: ZN, N: XP, len: z1 - z0 }, l: { O: [x0, 0, z0], A: ZP, N: XN, len: z1 - z0 } };
  }
  // windows into the holes of a face frame
  function windows(G, GG, f, list, FM, q, sillM, seed0) {
    (list || []).forEach(function (h, i) { if (h[5] === "door") return; var d = (h[4] || 0.2) * 0.75; winUnit(G, GG, f.O, f.A, f.N, h[0], h[1], h[2], h[3], d, FM, { q: q, cols: h[6] || 1, rows: h[7] || 1, sillM: h[2] > 0.3 ? sillM : null, seed: ((seed0 || 0) * 0.137 + i * 0.311) % 1, sill: h[2], fw: h[8] || 0.06 }); });
  }
  // a door leaf in a hole (panelled timber or a glass door with a steel frame)
  function doorUnit(G, GG, f, h, DM, FM, q, glass) {
    var d = (h[4] || 0.2) * 0.8, O = f.O, A = f.A, N = f.N; var at = function (a, b, z) { return [O[0] + A[0] * a + N[0] * z, O[1] + b, O[2] + A[2] * a + N[2] * z]; };
    if (glass) { winUnit(G, GG, O, A, N, h[0], h[1], h[2], h[3], d, FM, { q: q, cols: 1, rows: 1, fw: 0.07, seed: 0.77, sill: 0 }); if (q < 2) beam(G, at(h[0] + 0.12, h[2] + 1.05, -d + 0.09), at(h[0] + 0.12, h[2] + 1.85, -d + 0.09), 0.04, 0.04, FM); return; }
    rect(G, at(0, 0, -d), A, YP, N, h[0], h[1], h[2], h[3], DM);
    if (q >= 1) return;
    // stiles, rails and a handle proud of the leaf
    var w = h[1] - h[0]; [0.08, w - 0.08].forEach(function (a) { beam(G, at(h[0] + a, h[2], -d + 0.025), at(h[0] + a, h[3], -d + 0.025), 0.05, 0.12, DM); });
    [h[2] + 0.1, h[2] + 1.0, h[3] - 0.1].forEach(function (b) { beam(G, at(h[0] + 0.08, b, -d + 0.025), at(h[1] - 0.08, b, -d + 0.025), 0.05, 0.12, DM); });
    beam(G, at(h[1] - 0.16, h[2] + 0.98, -d + 0.07), at(h[1] - 0.16, h[2] + 1.12, -d + 0.07), 0.03, 0.03, { L: L.steel, t: 5 });
  }
  // a gable roof along x: eaves at z = +-(hw + over), from y0 at the eave to the ridge at yr; thickness t; ends overhang by ox
  function gable(G, x0, x1, zc, hw, y0, yr, t, RM, SM, FM, opt) {
    opt = opt || {}; var ox = opt.ox || 0; var over = opt.over || 0; var X0 = x0 - ox, X1 = x1 + ox;
    var run = hw + over, dz = run, dy = yr - y0; var sl = Math.hypot(dz, dy); var ca = dz / sl, sa = dy / sl;
    [1, -1].forEach(function (s) {
      var e0 = [X0, y0, zc + s * run], e1 = [X1, y0, zc + s * run], r0 = [X0, yr, zc], r1 = [X1, yr, zc];
      var A = [s > 0 ? 1 : -1, 0, 0], Bv = [0, sa, -s * ca];   // along the eave, up the slope
      // top (roof cover): CCW seen from above-outside
      if (s > 0) quad4(G, e0, e1, r1, r0, XP, [0, -sa, s * ca], r0, RM); else quad4(G, e1, e0, r0, r1, XN, [0, -sa, s * ca], r0, RM);
      // underside (soffit), offset down by t
      var off = function (p) { return [p[0], p[1] - t / ca, p[2]]; };
      if (s > 0) quad4(G, off(r0), off(r1), off(e1), off(e0), XP, [0, sa, -s * ca], r0, SM); else quad4(G, off(r1), off(r0), off(e0), off(e1), XN, [0, sa, -s * ca], r0, SM);
      // fascia at the eave
      var f0 = off(e0), f1 = off(e1); if (s > 0) quad4(G, f0, f1, e1, e0, XP, YP, e0, FM); else quad4(G, f1, f0, e0, e1, XN, YP, e0, FM);
      // barge edges at the ends
      quad4(G, s > 0 ? off(e0) : off(r0), s > 0 ? e0 : r0, s > 0 ? r0 : e0, s > 0 ? off(r0) : off(e0), ZP, YP, e0, FM);
      quad4(G, s > 0 ? off(r1) : off(e1), s > 0 ? r1 : e1, s > 0 ? e1 : r1, s > 0 ? off(e1) : off(r1), ZN, YP, e1, FM);
    });
    if (opt.ridge) beam(G, [X0, yr + 0.03, zc], [X1, yr + 0.03, zc], 0.22, 0.1, opt.ridge);
    if (opt.gutter) [1, -1].forEach(function (s) { var gz = zc + s * (run + 0.06); beam(G, [X0, y0 - t - 0.04, gz], [X1, y0 - t - 0.04, gz], 0.13, 0.11, opt.gutter); });
  }
  // the gable end triangles (wall material) under a gable along x, at x = xe facing dir (+1 / -1)
  function gableEnd(G, xe, dir, zc, hw, y0, yr, M) {
    var a = [xe, y0, zc + hw], b = [xe, y0, zc - hw], c = [xe, yr, zc];
    if (dir > 0) tri3(G, a, b, c, ZN, YP, [xe, 0, zc + hw], M); else tri3(G, b, a, c, ZP, YP, [xe, 0, zc - hw], M);
  }
  // a flat slab (roof plate, canopy): top with T, underside with S, edges with E
  function slab(G, x0, x1, y0, y1, z0, z1, T, S, E) { box(G, x0, x1, y0, y1, z0, z1, E, "", { t: T, b: S }); }
  // a quad whose normal is turned away from the reference point C (robust orientation for slabs and plates)
  function qOut(G, P0, P1, P2, P3, A, B, O, M, C) {
    var e1 = [P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]], e2 = [P3[0] - P0[0], P3[1] - P0[1], P3[2] - P0[2]]; var n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    var m = [(P0[0] + P2[0]) / 2 - C[0], (P0[1] + P2[1]) / 2 - C[1], (P0[2] + P2[2]) / 2 - C[2]];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) quad4(G, P3, P2, P1, P0, A, B, O, M); else quad4(G, P0, P1, P2, P3, A, B, O, M);
  }
  // a plate between four top corners (CCW or not), thickness t straight down: top RM, underside SM, edges FM
  function plate(G, P, t, RM, SM, FM, A, B) {
    var c = [0, 0, 0]; P.forEach(function (p) { c[0] += p[0] / 4; c[1] += p[1] / 4; c[2] += p[2] / 4; }); c[1] -= t / 2;
    var D = P.map(function (p) { return [p[0], p[1] - t, p[2]]; }); A = A || XP; if (!B || B === 'auto') { var bx = P[0][0] - P[3][0], by = P[0][1] - P[3][1], bz = P[0][2] - P[3][2], bl = Math.hypot(bx, by, bz) || 1; B = [bx / bl, by / bl, bz / bl]; }
    qOut(G, P[0], P[1], P[2], P[3], A, B, P[0], RM, c); qOut(G, D[0], D[1], D[2], D[3], A, B, P[0], SM, c);
    for (var i = 0; i < 4; i++) { var j = (i + 1) % 4; var dx = P[j][0] - P[i][0], dz = P[j][2] - P[i][2], l = Math.hypot(dx, dz) || 1; qOut(G, D[i], D[j], P[j], P[i], [dx / l, 0, dz / l], YP, P[i], FM, c); }
  }
  // a shed (mono-pitch) roof: low edge along z0 at y0, high edge along z1 at y1 (overhangs already in the numbers)
  function shedRoof(G, x0, x1, z0, z1, y0, y1, t, RM, SM, FM) {
    var dz = z1 - z0, dy = y1 - y0, l = Math.hypot(dz, dy) || 1;
    plate(G, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1]], t, RM, SM, FM, XP, [0, -dy / l, -dz / l]);
  }
  function toGeo(G) {
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(G.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(G.n, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(G.u, 2));
    g.setAttribute("aXH", new THREE.Float32BufferAttribute(G.x, 4)); g.setAttribute("aXE", new THREE.Float32BufferAttribute(G.e, 1)); g.setIndex(G.c > 65535 ? new THREE.Uint32BufferAttribute(G.i, 1) : new THREE.Uint16BufferAttribute(G.i, 1)); g.computeBoundingBox(); g.computeBoundingSphere(); g.userData.avShared = true; return g;
  }
  function toGlass(GG) {
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(GG.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(GG.n, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(GG.u, 2));
    g.setAttribute("aXG", new THREE.Float32BufferAttribute(GG.g, 4)); g.setIndex(GG.c > 65535 ? new THREE.Uint32BufferAttribute(GG.i, 1) : new THREE.Uint16BufferAttribute(GG.i, 1)); g.computeBoundingBox(); g.computeBoundingSphere(); g.userData.avShared = true; return g;
  }

  // ───────────────────────── kinds ─────────────────────────
  // every builder: (q) -> { G, GG } in the model frame of MODELS[kind] (x across the front, z toward the front, y up from the base)
  // q 0 = near (full detail, glass panes), 1 = LOD (windows as glass faces, fewer details), 2 = far (masses and roofs)
  function M_(Lr, t, extra) { var o = { L: Lr, t: t || 0 }; if (extra) for (var k in extra) o[k] = extra[k]; return o; }
  function hz(face, F, m0, m1) { var f = F[face]; if (face === "f") return [m0 - f.O[0], m1 - f.O[0]]; if (face === "k") return [f.O[0] - m1, f.O[0] - m0]; if (face === "r") return [f.O[2] - m1, f.O[2] - m0]; return [m0 - f.O[2], m1 - f.O[2]]; }
  // holes in model coordinates -> face coordinates: [m0, m1, y0, y1, depth, kind, cols, rows]
  function holesFor(F, spec) { var out = {}; for (var k in spec) out[k] = spec[k].map(function (h) { var a = hz(k, F, h[0], h[1]); return [a[0], a[1], h[2], h[3], h[4] || 0.25, h[5] || "win", h[6] || 1, h[7] || 1, h[8]]; }); return out; }

  // CASITA (135): adobe casita on a slab porch under a viga roof. Porch (porches.json): deck x -3.73..3.52, z 1.91..3.85 at 0.226,
  // ceiling 4.19, posts (-3.4, 3.7) and (3.4, 3.85), door corridor x -1.0..0.45, planter x 0.85..3.95, z 2.95..4.25, body z -4.45..1.91.
  function buildCasita(q) {
    var G = Geo(), GG = GGeo(); CUR.v = 0; CUR.f = 0;
    var WALL = M_(L.adobe, 1), PL = M_(109, 9), TRIM = M_(L.timber, 7), DOOR = M_(L.timber, 6, { rot: true }), VIGA = M_(L.hewn, 0, { rot: true }), ROOF = M_(L.smooth, 9), SLAB = M_(114, 9), SOIL = M_(L.fieldstone, 0), REV = M_(L.adobe, 1, { f: 2 }), CARVE = M_(L.doors, 0);
    var x0 = -3.95, x1 = 3.95, z0 = -4.45, z1 = 1.91, yT = 5.55;
    var F = faceFrames(x0, x1, z0, z1);
    var H = holesFor(F, {
      f: [[-0.8, 0.25, 0.226, 2.38, 0.32, "door"], [-2.6, -1.55, 0.95, 2.28, 0.32, "win", 1, 2], [1.0, 2.35, 0.95, 2.28, 0.32, "win", 2, 2]],
      r: [[-3.2, -2.55, 1.0, 2.25, 0.32, "win", 1, 2], [-1.0, -0.35, 1.0, 2.25, 0.32, "win", 1, 2]],
      l: [[-2.1, -1.1, 1.05, 2.15, 0.32, "win", 1, 2]],
      k: [[0.6, 1.6, 1.75, 2.35, 0.32, "win", 2, 1]]
    });
    if (q >= 2) { box(G, x0, x1, -0.4, yT, z0, z1, WALL, "b"); ["f", "r", "l", "k"].forEach(function (k) { H[k].forEach(function (h) { var f = F[k]; rect(G, [f.O[0] + f.N[0] * 0.01, 0, f.O[2] + f.N[2] * 0.01], f.A, YP, f.N, h[0], h[1], h[2], h[3], h[5] === "door" ? DOOR : M_(L.glass, 0, { f: 1 })); }); }); }
    else {
      CUR.top = 4.19; walls(G, x0, x1, z0, z1, -0.4, yT, WALL, { f: H.f }, REV, "krl"); CUR.top = 99; walls(G, x0, x1, z0, z1, -0.4, yT, WALL, { k: H.k, r: H.r, l: H.l }, REV, "f");
      // soft, worn corners (a rounded arris)
      if (q === 0) [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].forEach(function (c) { obox(G, [c[0], (yT - 0.4) / 2, c[1]], [0.7071, 0, 0.7071], YP, 0.1, (yT + 0.4) / 2, 0.1, M_(L.adobe, 1, { f: 2 })); });
      // windows and the door
      ["r", "l", "k", "f"].forEach(function (k) { windows(G, GG, F[k], H[k], TRIM, q, M_(L.smooth, 9), k.charCodeAt(0) * 0.01); });
      // the door per home (variant group 12): painted planks, a mesquite plank door with iron straps, a carved panel door
      VAR(12, 1); doorUnit(G, GG, F.f, H.f[0], DOOR, TRIM, q, false);
      [[2, 0.0, 0.5], [4, 0.5, 1.0]].forEach(function (dv) { VAR(12, dv[0]); var hd = H.f[0], dd = 0.32 * 0.8; rectUV(G, [x0, 0, z1 - dd], XP, YP, ZP, hd[0], hd[1], hd[2], hd[3], dv[1], dv[2], 0, 1, CARVE); if (q === 0) box2(G, F.f.O, XP, ZP, hd[1] - 0.2, hd[1] - 0.12, 1.15, 1.32, -dd, -dd + 0.06, M_(L.steel, 5)); });
      VAR(0);
      // lintels over the openings (timber) on the front
      if (q === 0) H.f.forEach(function (h) { var f = F.f; box2(G, f.O, f.A, f.N, h[0] - 0.12, h[1] + 0.12, h[3], h[3] + 0.2, -0.02, 0.06, VIGA); });
      // plinth band (slightly proud), swapped per home: smooth, fieldstone, adobe
      box(G, x0 - 0.03, x1 + 0.03, -0.4, 0.32, z0 - 0.03, z1 - 0.01, PL, "tb");
    }
    // roof plate inside the parapet and the parapet coping (variant group 1: flat cap, corner piers, raised front crest)
    box(G, x0 + 0.3, x1 - 0.3, yT - 0.25, yT - 0.2, z0 + 0.3, z1 - 0.3, ROOF, "bfklr");
    if (q < 2) { // inner faces of the parapet
      rect(G, [0, 0, z1 - 0.3], XN, YP, ZN, -(x1 - 0.3), -(x0 + 0.3), yT - 0.2, yT, WALL); rect(G, [0, 0, z0 + 0.3], XP, YP, ZP, x0 + 0.3, x1 - 0.3, yT - 0.2, yT, WALL);
      rect(G, [x1 - 0.3, 0, 0], ZP, YP, XN, z0 + 0.3, z1 - 0.3, yT - 0.2, yT, WALL); rect(G, [x0 + 0.3, 0, 0], ZN, YP, XP, -(z1 - 0.3), -(z0 + 0.3), yT - 0.2, yT, WALL); }
    var cap = function (a0, a1, c0, c1, y0, y1) { box(G, a0, a1, y0, y1, c0, c1, WALL, "b"); };
    VAR(1, 1); cap(x0 - 0.02, x1 + 0.02, z0 - 0.02, z1 + 0.02, yT, yT + 0.17);
    VAR(1, 2); cap(x0 - 0.02, x1 + 0.02, z0 - 0.02, z1 + 0.02, yT, yT + 0.12); [[x0, z0], [x1 - 0.75, z0], [x0, z1 - 0.75], [x1 - 0.75, z1 - 0.75]].forEach(function (c) { cap(c[0] - 0.03, c[0] + 0.78, c[1] - 0.03, c[1] + 0.78, yT + 0.12, yT + 0.45); });
    VAR(1, 4); cap(x0 - 0.02, x1 + 0.02, z0 - 0.02, z1 + 0.02, yT, yT + 0.12); cap(-1.4, 1.4, z1 - 0.32, z1 + 0.02, yT + 0.12, yT + 0.38); cap(-0.7, 0.7, z1 - 0.32, z1 + 0.02, yT + 0.38, yT + 0.46);
    VAR(0);
    // canales (scuppers) on the side walls and vigas (variant group 2)
    if (q < 2) { [[x1, 1], [x0, -1]].forEach(function (c) { var xs = c[0], s = c[1]; box(G, Math.min(xs, xs + s * 0.55), Math.max(xs, xs + s * 0.55), yT - 0.42, yT - 0.3, -2.1, -1.85, M_(L.timber, 7)); }); }
    if (q === 0) { VAR(2, 2); for (var vz = -3.9; vz < 1.5; vz += 0.92) { cylX(G, x1, x1 + 0.42, yT - 0.75, vz, 0.1, 8, VIGA); cylX(G, x0, x0 - 0.42, yT - 0.75, vz, 0.1, 8, VIGA); } VAR(0); }
    // chimney (variant group 3: none, back left, back right): a kiva stack with a rounded cap
    [[2, -3.55], [4, 2.85]].forEach(function (c) { VAR(3, c[0]); var cx = c[1]; box(G, cx, cx + 0.72, yT - 0.2, yT + 1.05, z0 + 0.25, z0 + 0.95, WALL, "b"); box(G, cx + 0.06, cx + 0.66, yT + 1.05, yT + 1.2, z0 + 0.31, z0 + 0.89, M_(L.smooth, 9), "b"); if (q === 0) box(G, cx + 0.22, cx + 0.5, yT + 1.2, yT + 1.32, z0 + 0.47, z0 + 0.73, M_(L.steel, 5), "b"); });
    VAR(0);
    // porch: slab, posts with corbels, the viga beam, the porch roof (adobe fascia, latilla ceiling)
    box(G, -3.73, 3.52, -0.4, 0.226, 1.91, 3.85, SLAB, "kb", { t: M_(L.smooth, 9) });
    var py = 4.19;
    [[-3.4, 3.7], [3.4, 3.85]].forEach(function (p) {
      if (q >= 2) box(G, p[0] - 0.13, p[0] + 0.13, 0.2, py, p[1] - 0.13, p[1] + 0.13, VIGA, "b"); else cylY(G, p[0], p[1], 0.2, py - 0.18, 0.135, q === 0 ? 10 : 6, M_(L.timber, 7));
      if (q < 2) box(G, p[0] - 0.42, p[0] + 0.42, py - 0.2, py, p[1] - 0.12, p[1] + 0.12, VIGA); });
    // front beam on the posts, the porch roof mass above it (stepped back from the posts)
    box(G, -3.9, 3.9, py, py + 0.26, 3.6, 4.1, VIGA, "");
    box(G, x0, x1, py + 0.26, 4.88, 1.91, 4.22, WALL, "bk", { t: ROOF });
    if (q < 2) { rect(G, [0, py + 0.26, 0], XP, ZP, YN, x0, x1, 1.91, 4.22, M_(L.timber, 7, { rot: true })); // latilla ceiling
      box(G, x0 - 0.02, x1 + 0.02, 4.88, 4.98, 1.88, 4.25, WALL, "b"); }
    if (q < 2) { for (var vx = -3.4; vx <= 3.45; vx += 0.85) cylZ(G, vx, py + 0.13, 3.95, 4.62, 0.11, q === 0 ? 8 : 5, VIGA); }
    // planter in front of the right bay (adobe walls, a soil top)
    box(G, 0.85, 3.95, -0.3, 0.72, 2.95, 4.25, WALL, "b", { t: SOIL });
    if (q < 2) box(G, 0.82, 3.98, 0.72, 0.8, 2.92, 4.28, M_(L.smooth, 9), "b", { t: SOIL });
    return { G: G, GG: GG };
  }

  // glass-faced openings on a face frame (q 0: real panes; q 1-2: glass faces), plus steel frames
  function glazeAll(G, GG, F, H, FM, q, seed) { ["f", "k", "r", "l"].forEach(function (k) { if (!H[k]) return; if (q >= 2) { H[k].forEach(function (h) { var f = F[k]; if (h[5] === "skip") return; rect(G, [f.O[0] + f.N[0] * 0.01, 0, f.O[2] + f.N[2] * 0.01], f.A, YP, f.N, h[0], h[1], h[2], h[3], M_(L.glass, 0, { f: 1 })); }); } else windows(G, GG, F[k], H[k].filter(function (h) { return h[5] !== "skip"; }), FM, q, null, seed + k.charCodeAt(0) * 0.013); }); }
  // simple furniture for the villa's dining set (the porch module makes the seats real; the drawn pieces were baked into the old model)
  function chair(G, x, z, ry, y0, WM, CM) { var c = Math.cos(ry), s = Math.sin(ry); var P = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; };
    var sc = P(0, 0); box(G, sc[0] - 0.23, sc[0] + 0.23, y0 + 0.42, y0 + 0.47, sc[1] - 0.23, sc[1] + 0.23, CM);
    [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].forEach(function (l) { var p = P(l[0], l[1]); box(G, p[0] - 0.025, p[0] + 0.025, y0, y0 + 0.42, p[1] - 0.025, p[1] + 0.025, WM); });
    var b = P(0, -0.21); var ax = Math.abs(c) > 0.5; box(G, b[0] - (ax ? 0.22 : 0.025), b[0] + (ax ? 0.22 : 0.025), y0 + 0.47, y0 + 0.9, b[1] - (ax ? 0.025 : 0.22), b[1] + (ax ? 0.025 : 0.22), WM); }
  // VILLA (42): desert-modern, two storeys and a roof pavilion; front wing of glass under a cantilevered roof, a pergola patio
  // with the dining set (porches.json seats: chairs at z 3.4 / 5.15, table x -5.25..-3.35, sideboard, the built-in bench at x -1.62)
  function buildVilla(q) {
    var G = Geo(), GG = GGeo(); CUR.v = 0; CUR.f = 0;
    var FEAT = M_(101, 2), UPPER = M_(102, 2), WING = M_(112, 2), STEEL = M_(L.steel, 5), CED = M_(L.cedar, 0), SOFF = M_(L.cedar, 0, { rot: true }), TOP = M_(L.smooth, 9), PAVE = M_(L.travertine, 0), WOOD = M_(L.timber, 7), CUSH = M_(L.canvas, 8);
    // ground floor block A
    var ax0 = -8.8, ax1 = 8.5, az0 = -8.9, az1 = 2.4, g1 = 3.4;
    var FA = faceFrames(ax0, ax1, az0, az1);
    var HA = holesFor(FA, {
      f: [[-7.1, -4.55, 0.25, 2.95, 0.22, "win", 3, 1], [-4.15, -0.95, 0.25, 2.95, 0.22, "win", 3, 1], [-0.1, 6.7, -0.4, g1, 0.05, "skip"], [7.0, 8.2, 0.6, 2.9, 0.22, "win", 1, 1]],
      k: [[-7.6, -4.4, 0.6, 2.9, 0.22, "win", 3, 1], [-3.1, 0.1, 0.6, 2.9, 0.22, "win", 3, 1], [1.4, 4.6, 0.6, 2.9, 0.22, "win", 3, 1], [5.6, 7.8, 0.9, 2.9, 0.22, "win", 2, 1]],
      r: [[-7.6, -5.0, 0.6, 2.9, 0.22, "win", 2, 1], [-3.6, -0.9, 0.6, 2.9, 0.22, "win", 2, 1]],
      l: [[-7.2, -4.2, 0.6, 2.9, 0.22, "win", 2, 1], [-2.6, 0.6, 0.6, 2.9, 0.22, "win", 2, 1]]
    });
    // upper floor C
    var cx0 = -8.4, cx1 = 8.0, cz0 = -8.3, cz1 = 2.2, g2 = 6.5;
    var FC = faceFrames(cx0, cx1, cz0, cz1);
    var HC = holesFor(FC, {
      f: [[-7.7, -4.3, 3.75, 6.05, 0.22, "win", 3, 1], [-3.9, -0.6, 3.75, 6.05, 0.22, "win", 3, 1], [6.9, 7.7, 3.9, 6.0, 0.22, "win", 1, 1]],
      k: [[-7.0, -3.4, 3.9, 6.0, 0.22, "win", 3, 1], [-2.6, 1.0, 3.9, 6.0, 0.22, "win", 3, 1], [2.0, 5.6, 3.9, 6.0, 0.22, "win", 3, 1]],
      r: [[-7.2, -4.4, 3.9, 6.0, 0.22, "win", 2, 1], [-3.0, -0.4, 3.9, 6.0, 0.22, "win", 2, 1]],
      l: [[-6.6, -3.4, 3.9, 6.0, 0.22, "win", 2, 1], [-2.2, 1.0, 3.9, 6.0, 0.22, "win", 2, 1]]
    });
    // wing B (two storeys of glass between solid ends)
    var bx0 = -0.1, bx1 = 6.7, bz0 = 2.4, bz1 = 7.8;
    var FB = faceFrames(bx0, bx1, bz0, bz1);
    var HB = holesFor(FB, {
      f: [[0.2, 1.4, 0.0, 2.8, 0.24, "door"], [1.75, 6.35, 0.25, 3.0, 0.24, "win", 4, 1], [0.2, 6.35, 3.75, 6.1, 0.24, "win", 5, 1]],
      r: [[3.0, 7.2, 0.4, 3.0, 0.24, "win", 3, 1], [3.0, 7.3, 3.8, 6.1, 0.24, "win", 3, 1]],
      l: [[3.0, 6.0, 0.25, 3.0, 0.24, "win", 2, 1], [2.9, 7.4, 3.8, 6.1, 0.24, "win", 3, 1]],
      k: []
    });
    if (q >= 2) {
      box(G, ax0, ax1, -0.4, g1, az0, az1, FEAT, "b"); box(G, cx0, cx1, g1, g2, cz0, cz1, UPPER, "b"); box(G, bx0, bx1, -0.4, g2, bz0, bz1, WING, "bk");
      glazeAll(G, GG, FA, HA, STEEL, 2, 0); glazeAll(G, GG, FC, HC, STEEL, 2, 0); glazeAll(G, GG, FB, HB, STEEL, 2, 0);
    } else {
      walls(G, ax0, ax1, az0, az1, -0.4, g1, FEAT, HA, STEEL);
      walls(G, cx0, cx1, cz0, cz1, g1, g2, UPPER, HC, STEEL);
      walls(G, bx0, bx1, bz0, bz1, -0.4, g2, WING, HB, STEEL, "k");
      glazeAll(G, GG, FA, HA, STEEL, q, 0.1); glazeAll(G, GG, FC, HC, STEEL, q, 0.4); glazeAll(G, GG, FB, { f: HB.f.slice(1), r: HB.r, l: HB.l }, STEEL, q, 0.7);
      doorUnit(G, GG, FB.f, HB.f[0], STEEL, STEEL, q, true);
      // the slab edge between the storeys (a steel and concrete band) and the roof of A outside C
      box(G, ax0 - 0.12, ax1 + 0.12, g1 - 0.12, g1 + 0.18, az0 - 0.12, az1 + 0.12, STEEL, "", { t: TOP, b: SOFF });
    }
    // roof over C, a thin cantilevered plate with a cedar soffit and a steel fascia
    slab(G, cx0 - 0.6, cx1 + 0.6, g2, g2 + 0.3, cz0 - 0.6, cz1 + 0.75, TOP, q < 2 ? SOFF : TOP, STEEL);
    // wing roof (cantilevered to the street) and the ground floor canopy (variant group 5: slab or steel louvres)
    slab(G, bx0 - 0.3, bx1 + 0.3, g2 - 0.02, g2 + 0.33, bz0, 9.3, TOP, q < 2 ? SOFF : TOP, STEEL);
    VAR(5, 1); slab(G, bx0, bx1, 3.2, 3.42, bz1, 9.0, TOP, q < 2 ? SOFF : TOP, STEEL);
    VAR(5, 2); if (q < 2) { for (var lz = bz1 + 0.12; lz < 9.0; lz += 0.24) box(G, bx0, bx1, 3.24, 3.42, lz, lz + 0.07, STEEL, "b"); box(G, bx0, bx1, 3.3, 3.42, 8.88, 9.0, STEEL); box(G, bx0, bx1, 3.3, 3.42, bz1, bz1 + 0.1, STEEL); } else slab(G, bx0, bx1, 3.25, 3.42, bz1, 9.0, STEEL, STEEL, STEEL);
    VAR(0);
    // roof pavilion (variant group 4: a glass penthouse, or a roof deck with a steel pergola and a stair box)
    var px0 = 0.8, px1 = 6.4, pz0 = -6.0, pz1 = -0.8, g3 = g2 + 0.3, g4 = 9.0;
    VAR(4, 1);
    var FP = faceFrames(px0, px1, pz0, pz1); var HP = holesFor(FP, { f: [[1.2, 6.0, g3 + 0.2, g4 - 0.25, 0.2, "win", 4, 1]], r: [[-5.5, -1.3, g3 + 0.2, g4 - 0.25, 0.2, "win", 3, 1]], l: [[-5.5, -1.3, g3 + 0.2, g4 - 0.25, 0.2, "win", 3, 1]], k: [] });
    if (q >= 2) { box(G, px0, px1, g3, g4, pz0, pz1, UPPER, "b"); glazeAll(G, GG, FP, HP, STEEL, 2, 0); } else { walls(G, px0, px1, pz0, pz1, g3, g4, UPPER, HP, STEEL); glazeAll(G, GG, FP, HP, STEEL, q, 0.9); }
    slab(G, px0 - 0.45, px1 + 0.45, g4, g4 + 0.19, pz0 - 0.45, pz1 + 0.55, TOP, q < 2 ? SOFF : TOP, STEEL);
    VAR(4, 2);
    box(G, px0, px0 + 1.8, g3, g4 - 0.4, pz0, pz0 + 2.2, UPPER, "b");
    if (q < 2) { [[px0 + 2.2, pz1], [px1, pz1], [px1, pz0], [px0 + 2.2, pz0]].forEach(function (p) { box(G, p[0] - 0.08, p[0] + 0.08, g3, g4 - 0.2, p[1] - 0.08, p[1] + 0.08, STEEL, "b"); });
      box(G, px0 + 2.1, px1 + 0.1, g4 - 0.32, g4 - 0.2, pz1 - 0.1, pz1 + 0.06, STEEL); box(G, px0 + 2.1, px1 + 0.1, g4 - 0.32, g4 - 0.2, pz0 - 0.06, pz0 + 0.1, STEEL);
      for (var sx = px0 + 2.3; sx < px1; sx += 0.42) box(G, sx, sx + 0.08, g4 - 0.2, g4 - 0.08, pz0, pz1, CED);
      // glass balustrade round the deck edge (glass faces) on a steel shoe
      [[cx0 + 0.1, cx1 - 0.1, cz1 - 0.15, cz1 - 0.05]].forEach(function (b) { box(G, b[0], b[1], g3, g3 + 1.05, b[2], b[3], M_(L.glass, 0, { f: 0 })); }); }
    VAR(0);
    // patio: travertine deck under a pergola (posts at the front corners, perimeter beams, cedar slats)
    box(G, -7.45, -0.2, -0.4, 0.25, 2.45, 6.35, PAVE, "kb");
    var pg0 = 2.95, pg1 = 3.32;
    [[-7.25, 6.15], [-0.4, 6.15]].forEach(function (p) { box(G, p[0] - 0.09, p[0] + 0.09, 0.25, pg0, p[1] - 0.09, p[1] + 0.09, STEEL, "b"); });
    box(G, -7.45, -0.2, pg0, pg1, 6.05, 6.25, STEEL); box(G, -7.45, -7.25, pg0, pg1, 2.4, 6.25, STEEL); box(G, -0.4, -0.2, pg0, pg1, 2.4, 6.25, STEEL);
    if (q < 2) for (var sz = 2.6; sz < 6.05; sz += (q === 0 ? 0.3 : 0.6)) box(G, -7.25, -0.4, pg1 - 0.16, pg1, sz, sz + 0.07, CED);
    // the dining set, the sideboard and the built-in bench (where the porch module's seats and solids are)
    if (q === 0) {
      box(G, -5.25, -3.35, 0.97, 1.01, 3.6, 4.9, M_(L.timber, 7)); [[-5.1, 3.75], [-3.5, 3.75], [-5.1, 4.75], [-3.5, 4.75]].forEach(function (l) { box(G, l[0] - 0.04, l[0] + 0.04, 0.25, 0.97, l[1] - 0.04, l[1] + 0.04, STEEL); });
      [[-4.75, 5.15, PI], [-3.9, 5.15, PI], [-3.2, 5.15, PI], [-4.9, 3.4, 0], [-3.9, 3.4, 0], [-3.2, 3.4, 0], [-3.0, 4.25, -PI / 2]].forEach(function (c) { chair(G, c[0], c[1], c[2], 0.25, STEEL, M_(L.canvas, 8)); });
      box(G, -6.125, -5.675, 0.25, 1.05, 3.45, 4.95, M_(L.timber, 7)); box(G, -6.15, -5.65, 1.05, 1.09, 3.42, 4.98, M_(L.smooth, 9));
      box(G, -1.82, -1.42, 0.25, 0.47, 2.85, 6.35, M_(L.smooth, 9)); box(G, -1.84, -1.4, 0.47, 0.56, 2.85, 6.35, CUSH); box(G, -1.42, -1.28, 0.25, 1.0, 2.85, 6.35, WOOD);
    } else if (q === 1) { box(G, -5.25, -3.35, 0.25, 1.01, 3.6, 4.9, M_(L.timber, 7)); box(G, -1.82, -1.28, 0.25, 0.9, 2.85, 6.35, WOOD); }
    // planters along the wing front and a low wall at the patio edge
    if (q < 2) { box(G, 1.6, 6.5, -0.3, 0.55, 8.15, 8.85, M_(L.smooth, 9), "b", { t: M_(L.fieldstone, 0) }); box(G, -7.45, -5.2, -0.3, 0.7, 6.4, 6.7, FEAT, "b"); }
    return { G: G, GG: GG };
  }

  // a porch along a wall: deck, posts, beam, rafters, knee braces, a shed roof plate (all in model coordinates)
  function porch(G, q, o) {
    var s = o.side;   // +1 front (+z), -1 back
    var DECK = M_(L.planks, 0, { rot: true }), POST = M_(L.hewn, 0, { rot: true }), ROOF = o.RM, SOFF = M_(L.planks, 0), FAS = M_(L.hewn, 0);
    var zw = o.zw, ze = o.ze, za = Math.min(zw, ze), zb = Math.max(zw, ze);
    box(G, o.x0, o.x1, -0.4, o.h, za, zb, DECK, s > 0 ? "kb" : "fb");
    if (q < 2) { // joist skirt and a nosing board
      box(G, o.x0 - 0.03, o.x1 + 0.03, o.h - 0.06, o.h + 0.02, s > 0 ? zb - 0.05 : za - 0.02, s > 0 ? zb + 0.02 : za + 0.05, FAS); }
    o.posts.forEach(function (p) { box(G, p[0] - 0.14, p[0] + 0.14, o.h, o.beamY, p[1] - 0.14, p[1] + 0.14, POST, "b");
      if (q === 0) { // heavy knee braces to the beam, both ways along the porch, and a stone pad under the post
        [-1, 1].forEach(function (d) { beam(G, [p[0], o.beamY - 0.75, p[1]], [p[0] + d * 0.75, o.beamY + 0.02, p[1]], 0.13, 0.15, POST); }); } });
    var bz = o.posts.reduce(function (a, p) { return a + p[1]; }, 0) / o.posts.length;
    box(G, o.x0 - 0.2, o.x1 + 0.2, o.beamY - 0.06, o.beamY + 0.26, bz - 0.15, bz + 0.15, FAS);
    if (q < 2) box(G, o.x0, o.x1, o.yw - 0.42, o.yw - 0.18, Math.min(zw, zw + s * 0.16), Math.max(zw, zw + s * 0.16), FAS);   // ledger on the wall
    // the roof plate from the wall (yw) to past the beam (ye)
    var zr0 = zw, zr1 = ze + s * 0.25; var yr0 = o.yw, yr1 = o.ye;
    shedRoof(G, o.x0 - 0.3, o.x1 + 0.3, zr1, zr0, yr1, yr0, 0.12, ROOF, SOFF, FAS);
    if (q < 2) for (var x = o.x0 + 0.2; x < o.x1; x += (q === 0 ? 0.9 : 1.8)) { var zt = ze + s * 0.42; var y0 = o.yw - 0.2, y1 = o.yw - 0.2 + (yr1 - yr0) * (zt - zw) / (zr1 - zw); beam(G, [x, y0, zw], [x, y1, zt], 0.09, 0.17, FAS); }   // rafters, their tails past the eave
  }
  // RANCH (41): long single-storey ranch house under a gable, full-length front and back porches (porches.json: decks at 0.35,
  // posts measured), a fieldstone chimney at one end (variant group 6), walls of weathered planks, board and batten or logs
  function buildRanch(q) {
    var G = Geo(), GG = GGeo(); CUR.v = 0; CUR.f = 0;
    var WALL = M_(103, 3), TRIM = M_(L.hewn, 0), DOOR = M_(L.timber, 6, { rot: true }), STONE = M_(111, 0), RM = M_(104, 4), FAS = M_(L.hewn, 0), PL = M_(L.fieldstone, 0);
    var x0 = -8.95, x1 = 8.95, z0 = -3.48, z1 = 3.67, yw = 4.0;
    var F = faceFrames(x0, x1, z0, z1);
    var bays = [[-7.04, 0], [-3.89, 0], [2.76, 0], [6.26, 0]];
    var Hs = { f: [[-0.55, 0.55, 0.35, 2.45, 0.2, "door"]], k: [[-0.48, 0.62, 0.35, 2.45, 0.2, "door"]], r: [[-2.6, -1.4, 1.0, 2.35, 0.2, "win", 2, 2]], l: [[-0.6, 0.6, 1.0, 2.35, 0.2, "win", 2, 2]] };
    bays.forEach(function (b) { Hs.f.push([b[0] - 0.58, b[0] + 0.58, 1.0, 2.4, 0.2, "win", 2, 2]); Hs.k.push([-b[0] - 0.58, -b[0] + 0.58, 1.0, 2.4, 0.2, "win", 2, 2]); });
    var H = holesFor(F, Hs);
    if (q >= 2) { box(G, x0, x1, -0.4, yw, z0, z1, WALL, "b"); ["f", "k", "r", "l"].forEach(function (k) { H[k].forEach(function (h) { var f = F[k]; rect(G, [f.O[0] + f.N[0] * 0.01, 0, f.O[2] + f.N[2] * 0.01], f.A, YP, f.N, h[0], h[1], h[2], h[3], h[5] === "door" ? DOOR : M_(L.glass, 0, { f: 1 })); }); }); }
    else {
      CUR.top = yw - 0.2; walls(G, x0, x1, z0, z1, -0.4, yw, WALL, { f: H.f, k: H.k }, TRIM, "rl"); CUR.top = 99; walls(G, x0, x1, z0, z1, -0.4, yw, WALL, { r: H.r, l: H.l }, TRIM, "fk");
      ["f", "k", "r", "l"].forEach(function (k) { windows(G, GG, F[k], H[k], TRIM, q, TRIM, k.charCodeAt(0) * 0.02); });
      doorUnit(G, GG, F.f, H.f[0], DOOR, TRIM, q, false); doorUnit(G, GG, F.k, H.k[0], DOOR, TRIM, q, false);
      // trim boards round the openings and at the corners
      if (q === 0) { ["f", "k", "r", "l"].forEach(function (k) { var f = F[k]; H[k].forEach(function (h) { box2(G, f.O, f.A, f.N, h[0] - 0.1, h[1] + 0.1, h[3], h[3] + 0.12, 0, 0.05, TRIM); if (h[5] !== "door") { box2(G, f.O, f.A, f.N, h[0] - 0.1, h[0], h[2], h[3], 0, 0.04, TRIM); box2(G, f.O, f.A, f.N, h[1], h[1] + 0.1, h[2], h[3], 0, 0.04, TRIM); } }); });
        [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].forEach(function (c) { box(G, c[0] - 0.08, c[0] + 0.08, 0.3, yw, c[1] - 0.08, c[1] + 0.08, TRIM, "b"); }); }
      box(G, x0 - 0.04, x1 + 0.04, -0.4, 0.38, z0 - 0.04, z1 + 0.04, PL, "tb");
    }
    // gable ends and the main roof (ridge along x)
    var zc = 0.1, hw = 3.85, yr = 6.05;
    gableEnd(G, x1, 1, zc, hw - 0.25, yw, yr - 0.15, WALL); gableEnd(G, x0, -1, zc, hw - 0.25, yw, yr - 0.15, WALL);
    gable(G, x0, x1, zc, hw, yw - 0.05, yr, 0.16, RM, M_(L.planks, 0), FAS, { ox: 0.35, over: 0.12, ridge: q < 2 ? M_(L.steel, 4) : null });
    // front and back porches (measured posts)
    porch(G, q, { side: 1, x0: -8.75, x1: 8.5, zw: z1, ze: 5.75, h: 0.35, beamY: 3.13, yw: yw - 0.02, ye: 3.42, RM: RM, posts: [[-8.54, 5.6], [-5.54, 5.59], [-2.24, 5.59], [1.06, 5.57], [4.46, 5.57], [8.06, 5.56]] });
    porch(G, q, { side: -1, x0: -8.75, x1: 8.75, zw: z0, ze: -5.7, h: 0.35, beamY: 3.13, yw: yw - 0.02, ye: 3.42, RM: RM, posts: [[8.04, -5.57], [4.44, -5.56], [1.04, -5.55], [-2.26, -5.56], [-5.56, -5.51], [-8.56, -5.53]] });
    // chimney at one end (variant group 6)
    [[1, 1], [2, -1]].forEach(function (c) { VAR(6, c[0]); var s = c[1]; var ca = s > 0 ? 7.95 : -9.0, cb = s > 0 ? 9.0 : -7.95;
      box(G, ca, cb, -0.4, 4.7, 0.35, 2.45, STONE, "b"); var sa = s > 0 ? 8.05 : -8.95, sb = s > 0 ? 8.95 : -8.05;
      box(G, sa, sb, 4.7, 7.42, 0.65, 2.15, STONE, "b"); box(G, sa - 0.06, sb + 0.06, 7.42, 7.57, 0.59, 2.21, M_(L.smooth, 9), "b"); });
    VAR(0);
    return { G: G, GG: GG };
  }
  // a hip roof over a rectangle: ridge along x (or a pyramid), eaves at y0 with overhang ov, ridge at yr
  function hipRoof(G, x0, x1, z0, z1, y0, yr, ov, RM, SM, FM) {
    var X0 = x0 - ov, X1 = x1 + ov, Z0 = z0 - ov, Z1 = z1 + ov; var hw = (Z1 - Z0) / 2, zc = (Z0 + Z1) / 2; var r0 = Math.min(X0 + hw, (X0 + X1) / 2), r1 = Math.max(X1 - hw, (X0 + X1) / 2);
    var R0 = [r0, yr, zc], R1 = [r1, yr, zc], A = [X0, y0, Z1], B = [X1, y0, Z1], C = [X1, y0, Z0], D = [X0, y0, Z0], ctr = [(X0 + X1) / 2, y0, zc];
    qOut(G, A, B, R1, R0, XP, [0, -0.707, 0.707], R0, RM, ctr); qOut(G, C, D, R0, R1, XN, [0, -0.707, -0.707], R0, RM, ctr);
    var t1 = function (P, Q, R) { var e1 = [Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]], e2 = [R[0] - P[0], R[1] - P[1], R[2] - P[2]]; var n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; var m = [(P[0] + Q[0] + R[0]) / 3 - ctr[0], (P[1] + Q[1] + R[1]) / 3 - ctr[1], (P[2] + Q[2] + R[2]) / 3 - ctr[2]]; if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) tri3(G, P, R, Q, ZN, YP, P, RM); else tri3(G, P, Q, R, ZN, YP, P, RM); };
    t1(B, C, R1); t1(D, A, R0);
    // fascia band round the eaves and a flat soffit
    box(G, X0, X1, y0 - 0.2, y0, Z0, Z1, FM, "t", { b: SM });
  }
  // HOME (12): two-storey desert-modern home (the old model stood 40 degrees off its lot; this one is square to the street):
  // stone or concrete ground floor, stucco upper floor, a timber screened balcony, a single-storey wing, roof per home
  // (variant group 8: parapet, hipped clay tile, shed metal)
  function buildHome(q) {
    var G = Geo(), GG = GGeo(); CUR.v = 0; CUR.f = 0;
    var BASE = M_(108, 2), UP = M_(L.plaster, 2), STEEL = M_(L.steel, 5), TRIM = M_(L.timber, 7), CED = M_(L.cedar, 0), TOP = M_(L.smooth, 9), DOOR = M_(L.timber, 6, { rot: true });
    var x0 = -5.6, x1 = 3.4, z0 = -6.2, z1 = 3.8, g1 = 3.3, g2 = 6.3;
    var FA = faceFrames(x0, x1, z0, z1);
    var HA = holesFor(FA, { f: [[-1.1, 0.0, 0.0, 2.35, 0.25, "door"], [0.8, 2.9, 0.6, 2.75, 0.25, "win", 2, 1], [-4.9, -2.6, 0.9, 2.6, 0.25, "win", 2, 1]], k: [[-2.8, -0.4, 0.9, 2.6, 0.25, "win", 2, 1], [1.4, 3.6, 0.9, 2.6, 0.25, "win", 2, 1]], l: [[-4.8, -2.6, 0.9, 2.6, 0.25, "win", 2, 1], [-0.6, 1.6, 0.9, 2.6, 0.25, "win", 2, 1]], r: [] });
    var HU = holesFor(FA, { f: [[-4.7, -2.0, 3.65, 5.9, 0.25, "win", 2, 1], [-1.2, 1.2, 3.9, 5.7, 0.25, "win", 2, 1], [1.8, 2.9, 4.0, 5.6, 0.25, "win", 1, 1]], k: [[-3.6, -1.2, 4.0, 5.7, 0.25, "win", 2, 1], [0.6, 3.0, 4.0, 5.7, 0.25, "win", 2, 1]], l: [[-4.6, -2.4, 4.0, 5.7, 0.25, "win", 2, 1], [-0.4, 1.8, 4.0, 5.7, 0.25, "win", 2, 1]], r: [[-1.2, 1.0, 4.0, 5.7, 0.25, "win", 2, 1], [-5.0, -3.2, 4.0, 5.7, 0.25, "win", 1, 1]] });
    var wx0 = 3.4, wx1 = 6.4, wz0 = -3.2, wz1 = 3.2;
    var FW = faceFrames(wx0, wx1, wz0, wz1); var HW = holesFor(FW, { f: [[3.7, 6.1, 0.7, 2.6, 0.25, "win", 3, 1]], r: [[-2.6, -0.2, 0.9, 2.6, 0.25, "win", 2, 1], [0.6, 2.4, 0.9, 2.6, 0.25, "win", 2, 1]], k: [[3.9, 5.9, 1.2, 2.5, 0.25, "win", 2, 1]], l: [] });
    if (q >= 2) { box(G, x0, x1, -0.4, g1, z0, z1, BASE, "b"); box(G, x0, x1, g1, g2, z0, z1, UP, "b"); box(G, wx0, wx1, -0.4, 3.5, wz0, wz1, UP, "bl"); glazeAll(G, GG, FA, HA, STEEL, 2, 0); glazeAll(G, GG, FA, HU, STEEL, 2, 0); glazeAll(G, GG, FW, HW, STEEL, 2, 0); }
    else {
      walls(G, x0, x1, z0, z1, -0.4, g1, BASE, HA, STEEL); walls(G, x0, x1, z0, z1, g1, g2, UP, HU, STEEL); walls(G, wx0, wx1, wz0, wz1, -0.4, 3.5, UP, HW, STEEL, "l");
      glazeAll(G, GG, FA, { f: HA.f.slice(1), k: HA.k, l: HA.l }, STEEL, q, 0.2); glazeAll(G, GG, FA, HU, STEEL, q, 0.5); glazeAll(G, GG, FW, HW, STEEL, q, 0.8);
      doorUnit(G, GG, FA.f, HA.f[0], DOOR, STEEL, q, false);
      box(G, x0 - 0.06, x1 + 0.06, g1 - 0.08, g1 + 0.12, z0 - 0.06, z1 + 0.06, STEEL, "", { t: TOP, b: TOP });
    }
    // balcony over the entry: slab on two steel posts, a timber slat screen (front) and a steel rail
    box(G, -5.2, 1.6, g1 - 0.25, g1, z1, 5.25, TOP, "", { f: STEEL, l: STEEL, r: STEEL });
    [[-5.05, 5.1], [1.45, 5.1]].forEach(function (p) { box(G, p[0] - 0.07, p[0] + 0.07, 0, g1 - 0.25, p[1] - 0.07, p[1] + 0.07, STEEL, "b"); });
    if (q < 2) { for (var sx = -5.15; sx < 1.6; sx += (q === 0 ? 0.16 : 0.48)) box(G, sx, sx + 0.07, g1, g1 + 1.1, 5.12, 5.22, CED, "b"); box(G, -5.2, 1.6, g1 + 1.1, g1 + 1.16, 5.08, 5.25, STEEL); }
    else box(G, -5.2, 1.6, g1, g1 + 1.1, 5.12, 5.22, CED, "b");
    // roofs (variant group 8)
    VAR(8, 1); box(G, x0 - 0.03, x1 + 0.03, g2, g2 + 0.45, z0 - 0.03, z1 + 0.03, UP, "b", { t: TOP }); if (q < 2) box(G, x0 - 0.06, x1 + 0.06, g2 + 0.45, g2 + 0.53, z0 - 0.06, z1 + 0.06, STEEL, "b");
    VAR(8, 2); hipRoof(G, x0, x1, z0, z1, g2, g2 + 2.2, 0.6, M_(110, 4), M_(L.cedar, 0, { rot: true }), STEEL);
    VAR(8, 4); shedRoof(G, x0 - 0.7, x1 + 0.7, z1 + 0.9, z0 - 0.7, g2 + 0.05, g2 + 1.35, 0.22, M_(L.seam, 4), M_(L.cedar, 0, { rot: true }), STEEL);
    VAR(0);
    // wing roof with parapet; planter beds
    box(G, wx0, wx1 + 0.03, 3.5, 3.85, wz0 - 0.03, wz1 + 0.03, UP, "b", { t: TOP }); if (q < 2) box(G, wx0, wx1 + 0.06, 3.85, 3.92, wz0 - 0.06, wz1 + 0.06, STEEL, "b");
    if (q < 2) { box(G, 3.6, 6.3, -0.3, 0.5, 3.45, 4.15, M_(108, 2), "b", { t: M_(L.fieldstone, 0) }); box(G, -5.5, -2.0, -0.3, 0.45, 5.6, 6.2, M_(108, 2), "b", { t: M_(L.fieldstone, 0) }); }
    return { G: G, GG: GG };
  }
  // a gambrel profile along z (barn): returns the five points of half-width w at the eave y0, knuckle (wk, yk), ridge yr
  // BARN (15): gambrel barn of red boards, white board and batten, or weathered planks, big sliding doors front and back,
  // a hay door, a lean-to, a cupola on some (variant group 9), rusty corrugated or standing seam roofs
  function buildBarn(q) {
    var G = Geo(), GG = GGeo(); CUR.v = 0; CUR.f = 0;
    var WALL = M_(105, 3), TRIM = M_(L.batten, 0, { rot: false }), RM = M_(106, 4), FAS = M_(L.batten, 0), DOOR = M_(105, 3), PL = M_(L.fieldstone, 0), STEEL = M_(L.steel, 5);
    var w = 6.6, z0 = -9.6, z1 = 9.6, ye = 6.0, wk = 4.3, yk = 10.4, yr = 14.25;
    var F = faceFrames(-w, w, z0, z1);
    var H = holesFor(F, { f: [[-2.4, 2.4, 0.0, 4.4, 0.18, "door"]], k: [[-2.4, 2.4, 0.0, 4.4, 0.18, "door"]], r: [], l: [] });
    var sideWins = [-7.0, -3.2, 0.8, 4.6]; H.r = sideWins.map(function (z) { var a = hz("r", F, z - 0.45, z + 0.45); return [a[0], a[1], 2.3, 3.1, 0.15, "win", 2, 2]; }); H.l = sideWins.map(function (z) { var a = hz("l", F, z - 0.45, z + 0.45); return [a[0], a[1], 2.3, 3.1, 0.15, "win", 2, 2]; });
    if (q >= 2) { box(G, -w, w, -0.4, ye, z0, z1, WALL, "b"); }
    else { walls(G, -w, w, z0, z1, -0.4, ye, WALL, H, TRIM); ["r", "l"].forEach(function (k) { windows(G, GG, F[k], H[k], TRIM, q, TRIM, 0.3); });
      box(G, -w - 0.04, w + 0.04, -0.4, 0.5, z0 - 0.04, z1 + 0.04, PL, "tb");
      [[-w, z0], [w, z0], [-w, z1], [w, z1]].forEach(function (c) { box(G, c[0] - 0.1, c[0] + 0.1, 0.4, ye, c[1] - 0.1, c[1] + 0.1, TRIM, "b"); }); }
    // the gambrel gable walls (front and back) above the eave line
    [[z1, 1], [z0, -1]].forEach(function (c) { var z = c[0], s = c[1]; var pts = [[-w, ye], [-wk, yk], [0, yr], [wk, yk], [w, ye]];
      var O = [0, 0, z]; var A = s > 0 ? XP : XN; for (var i = 0; i < 4; i++) { var a = pts[i], b = pts[i + 1]; var P0 = [a[0], ye, z], P1 = [b[0], ye, z], P2 = [b[0], b[1], z], P3 = [a[0], a[1], z]; if (a[1] === ye && b[1] === ye) continue;
        if (s > 0) quadN(G, P0, P1, P2, P3, ZP, A, YP, O, WALL); else quadN(G, P1, P0, P3, P2, ZN, A, YP, O, WALL); } });
    // roof: four slopes per side along z, with an overhang at the gables
    var oz0 = z0 - 0.5, oz1 = z1 + 0.5, t = 0.14;
    [[-1], [1]].forEach(function (c) { var s = c[0];
      plate(G, [[s * (w + 0.35), ye - 0.15, oz1], [s * (w + 0.35), ye - 0.15, oz0], [s * wk, yk, oz0], [s * wk, yk, oz1]], t, RM, M_(L.planks, 0), FAS, ZN, 'auto');
      plate(G, [[s * wk, yk, oz1], [s * wk, yk, oz0], [0, yr, oz0], [0, yr, oz1]], t, RM, M_(L.planks, 0), FAS, ZN, 'auto'); });
    if (q < 2) beam(G, [0, yr + 0.02, oz0], [0, yr + 0.02, oz1], 0.3, 0.12, STEEL);
    // sliding doors on a track (front and back), X bracing, the hay door and its hood
    [[z1, 1], [z0, -1]].forEach(function (c) { var z = c[0], s = c[1]; var zz = z + s * 0.06;
      box(G, -2.5, 2.5, 0, 4.45, Math.min(zz, zz + s * 0.08), Math.max(zz, zz + s * 0.08), M_(105, 3, { rot: true }));
      if (q < 2) { var zf = zz + s * 0.1; [[-2.5, 0], [0, 2.5]].forEach(function (d) { beam(G, [d[0] + 0.1, 0.15, zf], [d[1] - 0.1, 4.3, zf], 0.05, 0.16, TRIM); beam(G, [d[0] + 0.1, 4.3, zf], [d[1] - 0.1, 0.15, zf], 0.05, 0.16, TRIM); box(G, d[0], d[1], 0.05, 0.22, Math.min(zf, zf - s * 0.04), Math.max(zf, zf - s * 0.04), TRIM); box(G, d[0], d[1], 4.25, 4.45, Math.min(zf, zf - s * 0.04), Math.max(zf, zf - s * 0.04), TRIM); box(G, d[0], d[0] + 0.18, 0.05, 4.45, Math.min(zf, zf - s * 0.04), Math.max(zf, zf - s * 0.04), TRIM); box(G, d[1] - 0.18, d[1], 0.05, 4.45, Math.min(zf, zf - s * 0.04), Math.max(zf, zf - s * 0.04), TRIM); });
        box(G, -5.0, 5.0, 4.55, 4.7, Math.min(zz, zz + s * 0.18), Math.max(zz, zz + s * 0.18), STEEL); }
      box(G, -1.0, 1.0, 7.4, 9.3, Math.min(zz, zz + s * 0.07), Math.max(zz, zz + s * 0.07), M_(105, 3, { rot: true }));
      if (q < 2) { box(G, -1.15, 1.15, 9.3, 9.42, Math.min(zz, zz + s * 0.12), Math.max(zz, zz + s * 0.12), TRIM); box(G, -1.15, 1.15, 7.28, 7.4, Math.min(zz, zz + s * 0.12), Math.max(zz, zz + s * 0.12), TRIM); box(G, -0.3, 0.3, yk + 1.5, yk + 1.7, Math.min(z, z + s * 1.0), Math.max(z, z + s * 1.0), TRIM); } });
    // lean-to on one side (variant group 9: left, right) with a shed roof
    [[1, -1], [2, 1]].forEach(function (c) { VAR(9, c[0]); var s = c[1]; var xa = s > 0 ? w : -9.8, xb = s > 0 ? 9.8 : -w;
      box(G, xa, xb, -0.4, 3.4, -5.5, 1.5, WALL, "b"); var xo = s > 0 ? 9.9 : -9.9;
      plate(G, [[xo, 3.35, 1.8], [xo, 3.35, -5.8], [s * w, 4.75, -5.8], [s * w, 4.75, 1.8]], 0.12, RM, M_(L.planks, 0), FAS, ZN, 'auto');
      if (q < 2) { var a2 = s > 0 ? [9.8, 1.5] : [-9.8, -5.5]; box(G, s > 0 ? 7.6 : -8.8, s > 0 ? 8.8 : -7.6, 0, 2.5, 1.5, 1.58, M_(105, 3, { rot: true })); } });
    // cupola on the ridge (variant group 10)
    VAR(10, 2); box(G, -0.75, 0.75, yr - 0.6, yr + 1.0, -0.75, 0.75, TRIM, "b"); if (q < 2) { box(G, -0.6, 0.6, yr + 0.2, yr + 0.8, -0.78, 0.78, M_(L.charred, 0)); box(G, -0.78, 0.78, yr + 0.2, yr + 0.8, -0.6, 0.6, M_(L.charred, 0)); }
    hipRoof(G, -0.75, 0.75, -0.75, 0.75, yr + 1.0, yr + 1.75, 0.18, RM, FAS, FAS);
    VAR(0);
    return { G: G, GG: GG };
  }
  // SHED (32): a steel workshop shed with a roll-up door and a personnel door under a little canopy, gable roof along z
  function buildShed(q) {
    var G = Geo(), GG = GGeo(); CUR.v = 0; CUR.f = 0;
    var WALL = M_(107, 4), RM = M_(113, 4), STEEL = M_(L.steel, 5), ROLL = M_(L.corrugated, 9, { rot: true }), DOOR = M_(L.steel, 6), PL = M_(L.smooth, 9);
    var w = 5.3, z0 = -9.8, z1 = 9.8, ye = 5.2, yr = 7.75;
    var F = faceFrames(-w, w, z0, z1);
    var H = holesFor(F, { f: [[-2.6, 2.6, 0.0, 4.4, 0.16, "door"], [-4.5, -3.5, 0.0, 2.2, 0.12, "door"]], k: [[-1.0, 1.0, 1.4, 2.4, 0.12, "win", 2, 1]], r: [], l: [] });
    var clr = [-7.0, -3.0, 1.0, 5.0]; H.r = clr.map(function (z) { var a = hz("r", F, z - 1.2, z + 1.2); return [a[0], a[1], 3.6, 4.5, 0.12, "win", 4, 1]; }); H.l = clr.map(function (z) { var a = hz("l", F, z - 1.2, z + 1.2); return [a[0], a[1], 3.6, 4.5, 0.12, "win", 4, 1]; });
    // clerestory bands only on some sheds (variant group 11); the others are blank sides
    if (q >= 2) box(G, -w, w, -0.4, ye, z0, z1, WALL, "b");
    else {
      walls(G, -w, w, z0, z1, -0.4, ye, WALL, { f: H.f, k: H.k }, STEEL, "rl");
      VAR(11, 1); walls(G, -w, w, z0, z1, -0.4, ye, WALL, {}, STEEL, "fk");
      VAR(11, 2); walls(G, -w, w, z0, z1, -0.4, ye, WALL, { r: H.r, l: H.l }, STEEL, "fk"); windows(G, GG, F.r, H.r, STEEL, q, null, 0.2); windows(G, GG, F.l, H.l, STEEL, q, null, 0.6);
      VAR(0); windows(G, GG, F.k, H.k, STEEL, q, null, 0.4);
      // roll-up door (corrugated, horizontal), the personnel door, a steel frame round the big opening, a base plinth
      var f = F.f; rect(G, [0, 0, z1 - 0.12], XP, YP, ZP, -2.6, 2.6, 0, 4.4, ROLL); if (q === 0) box(G, -2.75, 2.75, 4.4, 4.75, z1 - 0.05, z1 + 0.2, STEEL);
      rect(G, [0, 0, z1 - 0.1], XP, YP, ZP, -4.5, -3.5, 0, 2.2, DOOR);
      box(G, -4.8, -3.2, 2.45, 2.55, z1, z1 + 0.9, STEEL); if (q === 0) { beam(G, [-4.75, 2.45, z1 + 0.85], [-4.75, 3.2, z1], 0.04, 0.04, STEEL); beam(G, [-3.25, 2.45, z1 + 0.85], [-3.25, 3.2, z1], 0.04, 0.04, STEEL); box(G, -4.15, -3.85, 2.3, 2.42, z1, z1 + 0.18, M_(L.glass, 0, { f: 1 })); }
      box(G, -w - 0.05, w + 0.05, -0.4, 0.3, z0 - 0.05, z1 + 0.05, PL, "tb");
      // downpipes at the corners
      if (q === 0) [[-w - 0.08, z0 + 0.3], [w + 0.08, z0 + 0.3], [-w - 0.08, z1 - 0.3], [w + 0.08, z1 - 0.3]].forEach(function (p) { box(G, p[0] - 0.05, p[0] + 0.05, 0.1, ye - 0.1, p[1] - 0.05, p[1] + 0.05, STEEL); });
    }
    // gable ends (along z: the ridge runs along z, so the gables face +z and -z)
    [[z1, 1], [z0, -1]].forEach(function (c) { var z = c[0], s = c[1]; var P0 = [-w, ye, z], P1 = [w, ye, z], P2 = [0, yr - 0.1, z]; if (s > 0) tri3(G, P0, P1, P2, XP, YP, [0, 0, z], WALL); else tri3(G, P1, P0, P2, XN, YP, [0, 0, z], WALL); });
    [[-1], [1]].forEach(function (c) { var s = c[0]; plate(G, [[s * (w + 0.45), ye - 0.08, z1 + 0.45], [s * (w + 0.45), ye - 0.08, z0 - 0.45], [0, yr, z0 - 0.45], [0, yr, z1 + 0.45]], 0.12, RM, STEEL, STEEL, ZN, 'auto'); });
    if (q < 2) { beam(G, [0, yr + 0.03, z0 - 0.45], [0, yr + 0.03, z1 + 0.45], 0.35, 0.08, STEEL); [-1, 1].forEach(function (s) { beam(G, [s * (w + 0.5), ye - 0.2, z0 - 0.45], [s * (w + 0.5), ye - 0.2, z1 + 0.45], 0.14, 0.12, STEEL); }); }
    return { G: G, GG: GG };
  }

  // a conical frustum strip (outward), r0 at y0 to r1 at y1, centred at (cx, cz); uv u = arc length at r0, v = slant length
  function ring(G, cx, cz, r0, y0, r1, y1, seg, M, inward) {
    var k0 = G.c, s = M.s || 1, sl = Math.hypot(r1 - r0, y1 - y0) || 1; var ny = (r0 - r1) / sl, nr = (y1 - y0) / sl;
    for (var i = 0; i <= seg; i++) { var a = i / seg * PI * 2, c = Math.cos(a), sn = Math.sin(a); var f = inward ? -1 : 1;
      vt(G, cx + c * r0, y0, cz + sn * r0, f * c * nr, f * ny, f * sn * nr, a * r0 * s, 0, M); vt(G, cx + c * r1, y1, cz + sn * r1, f * c * nr, f * ny, f * sn * nr, a * r0 * s, sl * s, M); }
    for (var j = 0; j < seg; j++) { var b = k0 + j * 2; if (inward) G.i.push(b, b + 3, b + 1, b, b + 2, b + 3); else G.i.push(b, b + 1, b + 3, b, b + 3, b + 2); }
  }
  function disc(G, cx, cz, r, y, seg, M, down) {
    var kc = G.c, s = M.s || 1; vt(G, cx, y, cz, 0, down ? -1 : 1, 0, cx * s, cz * s, M);
    for (var m = 0; m <= seg; m++) { var a = m / seg * PI * 2; vt(G, cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, 0, down ? -1 : 1, 0, (cx + Math.cos(a) * r) * s, (cz + Math.sin(a) * r) * s, M); }
    for (var t = 0; t < seg; t++) { if (down) G.i.push(kc, kc + 1 + t, kc + 2 + t); else G.i.push(kc, kc + 2 + t, kc + 1 + t); }
  }
  // GLAMP (10): a canvas bell tent on a round timber deck (porches.json: deck r 5.35 at 0.74, door x -1.3..1.3, a step at z 5.62,
  // corner poles at (+-4.1, +-2.95)): canvas wall and a sagging cone roof, four raked masts with guy cables, rolled door flaps
  function buildGlamp(q) {
    var G = Geo(), GG = GGeo(); CUR.v = 0; CUR.f = 0;
    var CAN = M_(L.canvas, 8), DECK = M_(L.planks, 0), SKIRT = M_(L.timber, 7), POLE = M_(L.timber, 7), STEEL = M_(L.steel, 5), DARK = M_(L.canvas, 7);
    var seg = q === 0 ? 28 : q === 1 ? 16 : 10, hd = 0.74;
    // deck: boards on top, a timber skirt
    disc(G, 0, 0, 5.35, hd, seg, DECK); ring(G, 0, 0, 5.35, -0.3, 5.35, hd, seg, SKIRT);
    if (q < 2) { ring(G, 0, 0, 5.42, hd - 0.08, 5.42, hd + 0.02, seg, SKIRT); disc(G, 0, 0, 5.42, hd + 0.02, seg, SKIRT); }
    box(G, -1.25, 1.25, -0.2, 0.3, 5.3, 5.87, DECK, "b");
    // canvas wall and roof
    var rw = 3.0, yw = 2.75;
    ring(G, 0, 0, rw, hd, rw, yw, seg, CAN);
    ring(G, 0, 0, rw + 0.35, yw - 0.12, 1.55, 4.35, seg, CAN); ring(G, 0, 0, 1.55, 4.35, 0.22, 5.7, seg, CAN);
    if (q < 2) { ring(G, 0, 0, rw + 0.35, yw - 0.12, rw + 0.35, yw - 0.32, seg, CAN); ring(G, 0, 0, rw + 0.35, yw - 0.32, rw, yw - 0.32, seg, CAN, false); }
    cylY(G, 0, 0, 5.6, 6.3, 0.07, 8, POLE, true);
    // the door: a dark opening with the flaps rolled up at both sides, and mesh windows round the wall
    var dz = rw + 0.03; rect(G, [0, 0, dz], XP, YP, ZP, -0.95, 0.95, hd, 2.45, DARK);
    if (q < 2) { cylY(G, -1.05, dz + 0.05, hd, 2.5, 0.09, 8, CAN, true); cylY(G, 1.05, dz + 0.05, hd, 2.5, 0.09, 8, CAN, true);
      // a timber door frame and an entry awning on two poles (outside the door corridor and clear of the deck chairs)
      box(G, -1.2, -1.08, hd, 2.6, dz - 0.05, dz + 0.07, POLE); box(G, 1.08, 1.2, hd, 2.6, dz - 0.05, dz + 0.07, POLE); box(G, -1.2, 1.2, 2.5, 2.62, dz - 0.05, dz + 0.07, POLE);
    }
    // the sail: a doubly curved canvas between two spar heads at the deck front and two points on the tent, sagging in the middle
    var SP = [[-2.75, 4.5], [2.75, 4.5]]; var tops = SP.map(function (p) { return [p[0] * 1.18, 4.55, 6.05]; });
    SP.forEach(function (p, i) { beam(G, [p[0], hd, p[1]], tops[i], 0.17, 0.17, POLE); if (q === 0) { box(G, p[0] - 0.16, p[0] + 0.16, hd, hd + 0.1, p[1] - 0.16, p[1] + 0.16, STEEL); beam(G, tops[i], [p[0] * 1.55, 0.02, 5.0], 0.022, 0.022, STEEL); beam(G, tops[i], [p[0] * 1.2, 0.02, 5.25], 0.022, 0.022, STEEL); } });
    var C0 = [-1.9, 2.82, 2.65], C1 = [1.9, 2.82, 2.65], C2 = tops[1], C3 = tops[0]; var nu = q === 0 ? 10 : 4, nv = q === 0 ? 6 : 3;
    var sail = function (u, v) { var a = [C0[0] + (C1[0] - C0[0]) * u, C0[1] + (C1[1] - C0[1]) * u, C0[2] + (C1[2] - C0[2]) * u], b = [C3[0] + (C2[0] - C3[0]) * u, C3[1] + (C2[1] - C3[1]) * u, C3[2] + (C2[2] - C3[2]) * u]; var sag = 0.55 * (1 - Math.pow(2 * u - 1, 2)) * (1 - Math.pow(2 * v - 1, 2)); return [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v - sag, a[2] + (b[2] - a[2]) * v]; };
    for (var iu = 0; iu < nu; iu++) for (var iv = 0; iv < nv; iv++) { var p00 = sail(iu / nu, iv / nv), p10 = sail((iu + 1) / nu, iv / nv), p11 = sail((iu + 1) / nu, (iv + 1) / nv), p01 = sail(iu / nu, (iv + 1) / nv); quad4(G, p00, p01, p11, p10, XP, ZP, C0, CAN); quad4(G, p00, p10, p11, p01, XP, ZP, C0, CAN); }
    if (q === 0) { beam(G, C0, C3, 0.03, 0.03, STEEL); beam(G, C1, C2, 0.03, 0.03, STEEL); beam(G, C3, C2, 0.03, 0.03, STEEL); }
    [[1.0, 1], [2.2, 1], [-1.0, 1], [-2.2, 1], [PI, 1]].forEach(function (w, i) { var a = PI / 2 + w[0]; var c = Math.cos(a), sn = Math.sin(a); var px = c * (rw + 0.05), pz = sn * (rw + 0.05); var A = [-sn, 0, c], N = [c, 0, sn];
      if (q < 2) rect(G, [px, 0, pz], A, YP, N, -0.5, 0.5, 1.45, 2.25, M_(L.glass, 0, { f: 1 })); });
    // four raked masts from the deck corners, guy cables to the roof
    [[-4.1, -2.95], [4.1, -2.95], [-4.1, 2.95], [4.1, 2.95]].forEach(function (p) { var top = [p[0] * 1.22, 8.85, p[1] * 1.22];
      if (q >= 2) beam(G, [p[0], hd, p[1]], top, 0.2, 0.2, POLE); else { beam(G, [p[0], hd, p[1]], top, 0.22, 0.22, POLE); box(G, p[0] - 0.2, p[0] + 0.2, hd, hd + 0.12, p[1] - 0.2, p[1] + 0.2, STEEL); }
      if (q < 2) { beam(G, top, [p[0] * 0.38, 4.02, p[1] * 0.38], 0.025, 0.025, STEEL); beam(G, top, [p[0] * 0.65, yw - 0.1, p[1] * 0.65], 0.025, 0.025, STEEL); } });
    // string lights ring under the eave at night (glass-like faces glow)
    if (q === 0) for (var i = 0; i < 18; i++) { var a = i / 18 * PI * 2; box(G, Math.cos(a) * (rw + 0.3) - 0.04, Math.cos(a) * (rw + 0.3) + 0.04, yw - 0.42, yw - 0.34, Math.sin(a) * (rw + 0.3) - 0.04, Math.sin(a) * (rw + 0.3) + 0.04, M_(L.glass, 0, { f: 1 })); }
    return { G: G, GG: GG };
  }

  // a timber deck railing along a line (posts every ~1.5 m, a top rail and two rails), y0 = deck top
  function railing(G, a, b, y0, M, q) {
    var dx = b[0] - a[0], dz = b[1] - a[1], L0 = Math.hypot(dx, dz); if (L0 < 0.2) return; var n = Math.max(1, Math.round(L0 / 1.5));
    for (var i = 0; i <= n; i++) { var x = a[0] + dx * i / n, z = a[1] + dz * i / n; box(G, x - 0.06, x + 0.06, y0, y0 + 1.05, z - 0.06, z + 0.06, M, "b"); }
    beam(G, [a[0], y0 + 1.05, a[1]], [b[0], y0 + 1.05, b[1]], 0.14, 0.07, M);
    if (q < 2) { beam(G, [a[0], y0 + 0.7, a[1]], [b[0], y0 + 0.7, b[1]], 0.05, 0.07, M); beam(G, [a[0], y0 + 0.35, a[1]], [b[0], y0 + 0.35, b[1]], 0.05, 0.07, M); }
  }
  // LAKEHOUSE (7): a log lodge on stilts under a big shed roof, a glass front to the decks, a river-rock chimney, a screened annex.
  // porches.json: lower deck x 6.0..11.7, z 5.3..9.7 at 1.76 (its stair at x 11.75, z 7.5, drawn by the porch module), main deck
  // x -3.0..6.0, z 5.0..10.1 at 1.95, body x -8.0..8.7, z -10.1..4.9
  function buildLake(q) {
    var G = Geo(), GG = GGeo(); CUR.v = 0; CUR.f = 0; CUR.top = 99;
    var LOG = M_(L.logs, 7), RIM = M_(L.hewn, 0), DECK = M_(L.planks, 0, { rot: true }), POST = M_(L.hewn, 0), RAIL = M_(L.timber, 7), ROCK = M_(L.fieldstone, 0), TRIM = M_(L.timber, 7), DOOR = M_(L.doors, 0), ROOF = M_(104, 4), SOFF = M_(L.cedar, 0, { rot: true }), FOOT = M_(L.smooth, 9);
    var x0 = -8.0, x1 = 8.7, z0 = -10.1, z1 = 4.9, yf = 1.95, yw = 5.4, yFront = 7.5, yBack = 5.95;
    var roofAt = function (z) { return yBack + (yFront - yBack) * (z - z0) / (z1 - z0); };
    // stilts on footings under the house and the decks
    var stilt = function (x, z, top) { if (q < 2) box(G, x - 0.22, x + 0.22, -0.3, 0.15, z - 0.22, z + 0.22, FOOT, "b"); box(G, x - 0.11, x + 0.11, 0.15, top, z - 0.11, z + 0.11, POST, "bt"); };
    for (var sx = x0 + 0.3; sx <= x1 - 0.2; sx += (x1 - x0 - 0.5) / 5) for (var sz = z0 + 0.3; sz <= z1 - 0.2; sz += (z1 - z0 - 0.5) / 4) if (q < 2 || Math.abs(sz - z0) < 0.5 || Math.abs(sz - z1) < 0.5) stilt(sx, sz, yf - 0.4);
    if (q < 2) { [[-2.8, 9.9], [1.5, 9.9], [5.8, 9.9], [-2.8, 7.4], [11.5, 9.5], [11.5, 5.5], [8.8, 9.5]].forEach(function (p) { stilt(p[0], p[1], (p[0] > 6 ? 1.76 : yf) - 0.15); }); }
    // floor platform: rim joists of hewn timber
    box(G, x0 - 0.1, x1 + 0.1, yf - 0.42, yf, z0 - 0.1, z1, RIM, "", { t: DECK });
    // log walls; the side walls rise under the roof slope
    var F = faceFrames(x0, x1, z0, z1);
    var H = holesFor(F, {
      f: [[-1.6, -0.45, yf, yf + 2.2, 0.3, "door"], [0.1, 6.1, yf + 0.35, yw - 0.25, 0.3, "win", 4, 1], [-6.6, -3.8, yf + 0.6, yw - 0.4, 0.3, "win", 2, 1], [6.9, 8.1, yf + 0.6, yw - 0.4, 0.3, "win", 1, 1]],
      k: [[-6.0, -3.6, yf + 0.8, yw - 0.6, 0.3, "win", 2, 1], [-1.2, 1.2, yf + 0.8, yw - 0.6, 0.3, "win", 2, 1], [3.6, 6.0, yf + 0.8, yw - 0.6, 0.3, "win", 2, 1]],
      r: [[-3.6, -1.2, yf + 0.7, yw - 0.5, 0.3, "win", 2, 1], [-8.4, -6.2, yf + 0.7, yw - 0.5, 0.3, "win", 2, 1]],
      l: [[-8.6, -6.6, yf + 0.7, yw - 0.5, 0.3, "win", 2, 1], [0.4, 2.6, yf + 0.7, yw - 0.5, 0.3, "win", 2, 1]]
    });
    if (q >= 2) { box(G, x0, x1, yf, yw, z0, z1, LOG, "b"); ["f", "k", "r", "l"].forEach(function (k) { H[k].forEach(function (h) { var f = F[k]; rect(G, [f.O[0] + f.N[0] * 0.01, 0, f.O[2] + f.N[2] * 0.01], f.A, YP, f.N, h[0], h[1], h[2], h[3], h[5] === "door" ? M_(L.timber, 6) : M_(L.glass, 0, { f: 1 })); }); }); }
    else {
      walls(G, x0, x1, z0, z1, yf, yw, LOG, { k: H.k, r: H.r, l: H.l }, TRIM, "f");
      walls(G, x0, x1, z0, z1, yf, yw, LOG, { f: H.f }, TRIM, "krl");
      ["f", "k", "r", "l"].forEach(function (k) { windows(G, GG, F[k], H[k], TRIM, q, TRIM, 0.21 + k.charCodeAt(0) * 0.017); });
      // the carved door (decal) in its hole, a handle
      var hd = H.f[0], fd = F.f; var dd = 0.24; rectUV(G, [fd.O[0], 0, fd.O[2] - dd], XP, YP, ZP, hd[0], hd[1], hd[2], hd[3], 0.5, 1.0, 0.0, 1.0, DOOR);
      // saddle-notched log ends at the four corners
      if (q === 0) [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].forEach(function (c) { for (var y = yf + 0.15; y < yw; y += 0.42) { box(G, c[0] - 0.32, c[0] + 0.32, y, y + 0.3, c[1] - 0.14, c[1] + 0.14, M_(L.hewn, 0)); box(G, c[0] - 0.14, c[0] + 0.14, y + 0.21, y + 0.51, c[1] - 0.32, c[1] + 0.32, M_(L.hewn, 0)); } });
    }
    // gable-like walls above the logs under the shed roof (sides) and the clerestory front
    var yfz1 = roofAt(z1) - 0.18, yfz0 = roofAt(z0) - 0.18;
    quadN(G, [x1, yw, z1], [x1, yw, z0], [x1, yfz0, z0], [x1, yfz1, z1], XP, ZN, YP, [x1, 0, z1], LOG);
    quadN(G, [x0, yw, z0], [x0, yw, z1], [x0, yfz1, z1], [x0, yfz0, z0], XN, ZP, YP, [x0, 0, z0], LOG);
    quadN(G, [x1, yw, z0], [x0, yw, z0], [x0, yfz0, z0], [x1, yfz0, z0], ZN, XN, YP, [x1, 0, z0], LOG);
    // the front above the logs: a band of clerestory glass between hewn posts
    var FC = { O: [x0, 0, z1], A: XP, N: ZP, len: x1 - x0 }; var HC = [[0.6, 15.9, yw + 0.12, yfz1 - 0.12, 0.2, "win", 8, 1]];
    if (q >= 2) rect(G, [x0, 0, z1 + 0.01], XP, YP, ZP, 0.6, 15.9, yw + 0.12, yfz1 - 0.12, M_(L.glass, 0, { f: 1 }));
    else { CUR.top = yfz1 + 0.05; wallH(G, FC.O, FC.A, FC.N, 0, FC.len, yw, yfz1, HC, LOG, TRIM); CUR.top = 99; windows(G, GG, FC, HC, TRIM, q, null, 0.63); }
    // the shed roof plate, a cedar soffit, a steel ridge flashing, deep overhangs
    shedRoof(G, x0 - 0.7, x1 + 0.7, z0 - 0.7, z1 + 0.9, roofAt(z0 - 0.7), roofAt(z1 + 0.9) + 0.02, 0.28, ROOF, q < 2 ? SOFF : ROOF, RIM);
    if (q === 0) for (var bx = x0 - 0.5; bx <= x1 + 0.6; bx += 1.65) beam(G, [bx, roofAt(z1) - 0.32, z1 - 0.2], [bx, roofAt(z1 + 0.85) - 0.32, z1 + 0.85], 0.16, 0.26, RIM);   // purlin tails at the front eave
    // river-rock chimney on the west wall, through the roof
    box(G, x0 - 1.25, x0, 0.0, 9.0, -3.6, -1.3, ROCK, "b"); if (q < 2) { box(G, x0 - 1.35, x0 + 0.1, 9.0, 9.18, -3.7, -1.2, M_(L.smooth, 9), "b"); box(G, x0 - 0.95, x0 - 0.35, 9.18, 9.6, -2.8, -2.1, M_(L.steel, 5), "b"); }
    // screened annex on the west (on the same stilts), a lower shed roof
    var ax0 = -11.8, ax1 = x0;
    box(G, ax0, ax1, yf - 0.42, yf, -9.6, -4.4, RIM, "", { t: DECK });
    if (q < 2) { [[ax0 + 0.2, -9.4], [ax0 + 0.2, -4.6], [ax0 + 0.2, -7.0]].forEach(function (p) { stilt(p[0], p[1], yf - 0.4); }); }
    var FA = faceFrames(ax0, ax1, -9.6, -4.4); var HA = holesFor(FA, { l: [[-9.2, -4.8, yf + 0.5, yf + 2.1, 0.12, "win", 4, 1]], f: [[ax0 + 0.4, ax1 - 0.4, yf + 0.5, yf + 2.1, 0.12, "win", 3, 1]], k: [[ax0 + 0.4, ax1 - 0.4, yf + 0.5, yf + 2.1, 0.12, "win", 3, 1]], r: [] });
    if (q >= 2) box(G, ax0, ax1, yf, yf + 2.6, -9.6, -4.4, M_(L.planks, 0), "b");
    else { walls(G, ax0, ax1, -9.6, -4.4, yf, yf + 2.6, M_(L.planks, 0), HA, TRIM, "r"); windows(G, GG, FA.l, HA.l, TRIM, q, null, 0.4); ["f", "k"].forEach(function (k) { windows(G, GG, FA[k], HA[k], TRIM, q, null, 0.5); }); }
    shedRoof(G, ax0 - 0.5, ax1, -10.0, -4.0, yf + 2.75, yf + 3.15, 0.18, ROOF, SOFF, RIM);
    // decks (planks on hewn rims), stilts, railings with the openings to the stair, the house and the other deck
    box(G, 6.0, 11.7, 1.76 - 0.35, 1.76, 5.3, 9.7, RIM, "", { t: DECK });
    box(G, -3.0, 6.0, yf - 0.35, yf, 5.0, 10.1, RIM, "", { t: DECK });
    railing(G, [-3.0, 5.0], [-3.0, 10.1], yf, RAIL, q); railing(G, [-3.0, 10.1], [6.0, 10.1], yf, RAIL, q);
    railing(G, [6.0, 9.7], [11.7, 9.7], 1.76, RAIL, q); railing(G, [11.7, 9.7], [11.7, 8.25], 1.76, RAIL, q); railing(G, [11.7, 6.75], [11.7, 5.3], 1.76, RAIL, q); railing(G, [11.7, 5.3], [8.7, 5.3], 1.76, RAIL, q);
    return { G: G, GG: GG };
  }

  // ───────────────────────── install: before the client builds the instancing ─────────────────────────
  var BUILDERS = XH.builders = { casita: buildCasita };
  try { if (typeof buildVilla === "function") BUILDERS.villa = buildVilla; } catch (e) {}
  try { if (typeof buildRanch === "function") BUILDERS.ranch = buildRanch; } catch (e) {}
  try { if (typeof buildHome === "function") BUILDERS.home = buildHome; } catch (e) {}
  try { if (typeof buildBarn === "function") BUILDERS.barn = buildBarn; } catch (e) {}
  try { if (typeof buildShed === "function") BUILDERS.shed = buildShed; } catch (e) {}
  try { if (typeof buildGlamp === "function") BUILDERS.glamp = buildGlamp; } catch (e) {}
  try { if (typeof buildLake === "function") BUILDERS.lakehouse = buildLake; } catch (e) {}
  var BUILT = XH.built = {}, ORIG = XH.orig = {};
  function buildKind(k) {
    var t0 = performance.now(); var out = { lv: [] };
    for (var q = 0; q < 3; q++) { var r = BUILDERS[k](q); out.lv.push({ shell: toGeo(r.G), glass: q === 0 && r.GG.c ? toGlass(r.GG) : null, tris: r.G.i.length / 3 }); }
    out.ms = Math.round((performance.now() - t0) * 10) / 10; return out;
  }
  function stream() { return window.PLAN_STREAM || null; }
  function install(k) {
    var m = MODELS[k]; if (!m || !BUILDERS[k]) return false;
    var B = BUILT[k] || (BUILT[k] = buildKind(k));
    var parts = [{ geometry: B.lv[0].shell, material: shellMat() }]; if (B.lv[0].glass) parts.push({ geometry: B.lv[0].glass, material: glassMat(), noShadow: true, noReceive: true });
    var old = m.proxy ? m._pp : m.parts; ORIG[k] = { parts: old, proxy: !!m.proxy, lodGeos: m.lodGeos, farGeos: m.farGeos };
    Object.defineProperty(m, "parts", { value: parts, writable: true, enumerable: true, configurable: true });
    if (m.proxy) { if (!ABMODE) { try { Object.defineProperty(m, "_pp", { value: parts, writable: true, enumerable: false, configurable: true }); } catch (e) {} } delete m.proxy; }
    m.lodGeos = [B.lv[1].shell]; m.farGeos = { geos: [B.lv[2].shell], cell: 1, dist: 420 }; m.xh = true;
    var PS = stream(); if (PS && PS.st && !ABMODE) PS.st[k] = "full";
    // the stand-in's arrays are not needed any more (R6 kept them for the swap that will not happen)
    if (!ABMODE && ORIG[k].proxy && old) old.forEach(function (p) { try { if (window.R6MEM && R6MEM.release) R6MEM.release(p.geometry); p.geometry.dispose(); if (p.material && p.material.userData && p.material.userData.p2proxy) { if (p.material.map) p.material.map.dispose(); p.material.dispose(); } } catch (e) {} });
    XH.n[k] = { tris: B.lv.map(function (l) { return l.tris; }), ms: B.ms, glass: B.lv[0].glass ? B.lv[0].glass.index.count / 6 : 0, n: (PLACE[k] || []).length };
    return true;
  }
  var KINDS = XH.kinds = Object.keys(BUILDERS).filter(function (k) { return !ONLY || ONLY.indexOf(k) >= 0; });
  function worldHook() {
    if (!window.PLAN || XH.done) return; XH.done = true; var t0 = performance.now(); try { startTex(); } catch (e) { note("tex", e); }
    uniformsOnce(); var did = [];
    KINDS.forEach(function (k) { try { if (PLACE[k] && PLACE[k].length && install(k)) did.push(k); } catch (e) { note("install " + k, e); } });
    // casitas: an agave in the front planter (the old model had one baked in), seated on the planter's soil
    try { if (did.indexOf("casita") >= 0 && MODELS.agave_cluster && MODEL_SPECS.agave_cluster) { var np = 0; (PLACE.casita || []).slice().forEach(function (e) { var c = Math.cos(e[3]), s = Math.sin(e[3]), k = e[4] || 1, lx = 2.4, lz = 3.6; var wx = e[0] + (lx * c + lz * s) * k, wz = e[2] + (-lx * s + lz * c) * k; put("agave_cluster", wx, wz, e[3] + (e[0] * 7.1 % 6.28), 0.62 * k); var L2 = PLACE.agave_cluster; var a = L2[L2.length - 1]; a[1] = e[1] + 0.78 * k; a.seated = true; a.xh = true; np++; }); XH.n.agaves = np; } } catch (e) { note("agaves", e); }
    XH.installed = did; XH.n.worldMs = Math.round(performance.now() - t0);
    // A/B mode: the old models stream in as before; keep ours to swap back in
    if (ABMODE) { XH.mine = {}; did.forEach(function (k) { XH.mine[k] = MODELS[k].parts; }); }
  }
  window.PLAN_HOOKS.world.unshift({ name: "xhWorld", fn: worldHook });
  // after the instancing: the shadow depth material that collapses the unused variants, on every tier of our kinds
  function depthPass() {
    var dm = depthMat(), n = 0;
    try { INSTSET.forEach(function (S) { if (!MODELS[S.kind] || !MODELS[S.kind].xh) return; [S.insts, S.far, S.far2].forEach(function (Lst) { (Lst || []).forEach(function (im) { if (im.material === MAT.shell) { if (im.customDepthMaterial !== dm) { im.customDepthMaterial = dm; n++; } } else if (im.customDepthMaterial === dm) im.customDepthMaterial = undefined; }); }); }); } catch (e) { note("depth", e); }
    return n;
  }
  XH.depthPass = depthPass;
  function deferHook() {
    try { XH.n.depth = depthPass(); } catch (e) { note("defer", e); }
    // upload the arrays behind the loading screen
    try { if (TX.a && renderer.initTexture) renderer.initTexture(TX.a); if (TX.n && renderer.initTexture) renderer.initTexture(TX.n); } catch (e) { note("initTexture", e); }
  }
  window.PLAN_HOOKS.defer.push({ name: "xhDefer", fn: deferHook });
  var fc = 0;
  window.PLAN_HOOKS.frame.push({ name: "xhFrame", fn: function () { if ((++fc & 255) === 0) { depthPass(); if (TX.a && !TX.upA) { try { renderer.initTexture(TX.a); renderer.initTexture(TX.n); TX.upA = true; } catch (e) {} } } } });

  // ───────────────────────── A/B (same session), stats, previews ─────────────────────────
  XH.ab = function (on) {
    if (!ABMODE) return "boot with ?xhab=1 for A/B";
    var res = {};
    (XH.installed || []).forEach(function (k) { var S = INSTSET.find(function (q) { return q.kind === k; }); if (!S) return; var mine = XH.mine[k], m = MODELS[k];
      var full = m.parts !== mine ? m.parts : null; if (!XH.full) XH.full = {}; if (full) XH.full[k] = { parts: full, lod: m.lodGeos }; var F = XH.full[k];
      var use = on ? mine : (F ? F.parts : null); if (!use) { res[k] = "old model not streamed yet"; return; }
      if (!XH.empty) XH.empty = new THREE.BufferGeometry(); S.insts.forEach(function (im, i) { var p = use[i]; im.geometry = p ? p.geometry : XH.empty; im.material = p ? p.material : use[0].material; });
      var lodG = on ? [BUILT[k].lv[1].shell] : (F && F.lod); (S.far || []).forEach(function (im, i) { if (lodG && lodG[i]) { im.geometry = lodG[i]; im.material = use[i] ? use[i].material : use[0].material; } });
      if (S.far2) { var g2 = on ? [BUILT[k].lv[2].shell] : null; S.far2.forEach(function (im, i) { if (g2 && g2[i]) { im.geometry = g2[i]; im.material = use[0].material; } else if (!on) { im.material = use[0].material; } }); }
      S.n = -1; S.nf = -1; S.nf2 = -1; res[k] = on ? "new" : "old"; });
    depthPass(); try { updateCulling(true); } catch (e) {} return res;
  };
  XH.stats = function () { var o = { installed: XH.installed, n: XH.n, errs: XH.errs.slice(0, 8), tex: { a: !!TX.a, n: !!TX.n, low: TX.low, ms: XH.n.texMs } }; return o; };
  // studio preview of a kind with a chosen variant hash position (x, z), non-instanced (the hash uses the mesh position)
  XH.mesh = function (k, lv) { var B = BUILT[k]; if (!B) return null; var g = new THREE.Group(); var l = B.lv[lv || 0]; g.add(new THREE.Mesh(l.shell, shellMat())); if (l.glass) g.add(new THREE.Mesh(l.glass, glassMat())); return g; };
})();
