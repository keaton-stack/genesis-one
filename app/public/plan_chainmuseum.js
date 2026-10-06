// R17 (5 Oct 2026): THE GENESIS BLOCK MUSEUM, Expanse Works and Maker Row (S3_WORKS), between the airside fence and the Maker Row sheds.
//   A chain of nine linked blocks parallel to the runway: the Lobby, then eight galleries in order of time (ledgers, cryptography,
//   digital cash and proof of work, Block Zero, smart contracts, proof of history, real-world assets, giving on chain), joined by glass
//   links. Board-formed concrete blocks with perforated bronze screens (dot-matrix hex) over clerestory glass, a basalt hero block
//   (Block Zero), year lettering on every fascia, a light pulse running block to block at night, Genesis Plaza with the Genesis Stone
//   (the real block 0 hash carved round it), the Timeline Walk with bronze years, golf-cart bays, the path to Hangar Road.
//   Inside (built near, time sliced): terrazzo floors, a lit chain line through every room, panels with the history, replicas and
//   sculptures, a docent, roaming visitors (PLAN_ROAM), sittable benches, the Block Zero show, the hash kiosk (SHA-256 computed live:
//   type a word, mine a nonce, break a three-block chain, re-hash the real genesis header), the proof of history ring (a real running
//   SHA-256 chain), the ledger wall and the follow-a-donation map.
// Local frame: x along the chain (+x north-east), z across it (+z south-east, toward the sheds), y up from the graded pad G.
// Classic script, loaded before plan_fill_a.js and client.js; hooks into window.PLAN_HOOKS { terrain, world, defer, frame, interior }
// and wraps openNearest by bare name (E at the kiosk and the map). No new real lights (lamps are sources for the client's pool),
// merged geometry per material, shared materials. ?cm=0 turns the module off. window.PLAN_CHAINMUSEUM: n, errs, site, api, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_CHAINMUSEUM = window.PLAN_CHAINMUSEUM || { v: "r17-0", errs: [], n: {} };
(function () {
  "use strict";
  var CM = window.PLAN_CHAINMUSEUM; CM.v = "r17-1"; CM.errs = CM.errs || []; CM.n = CM.n || {};
  if (/[?&]cm=0\b/.test(location.search)) { CM.off = true; return; }
  var PI = Math.PI, TAU = PI * 2;
  function note(tag, e) { try { if (CM.errs.length < 60) CM.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (CM.errs.length <= 6) console.warn("plan_chainmuseum " + tag, e); } catch (x) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function nowMs() { return performance.now(); }
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function has(k) { try { return !!(MODELS[k] && (MODELS[k].parts || MODELS[k]._pp)); } catch (e) { return false; } }
  function canPut(k) { try { return has(k) && !!MODEL_SPECS[k]; } catch (e) { return false; } }
  function $id(id) { return document.getElementById(id); }
  function V3(x, y, z) { return new THREE.Vector3(x, y, z); }
  function mobile() { try { return ASSET.tier === "m"; } catch (e) { return false; } }
  function qual() { try { return localStorage.getItem("g1:quality") || "high"; } catch (e) { return "high"; } }
  function tierN() { var q = qual(); return q === "ultra" ? 3 : q === "high" ? 2 : q === "medium" ? 1 : 0; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function au(u) { try { if (window.AV) return window.AV(u); } catch (e) {} return u; }
  function busy() { try { return (typeof riding !== "undefined" && riding) || (typeof inside !== "undefined" && inside) || (typeof DANCE !== "undefined" && DANCE.on) || (typeof FLY !== "undefined" && FLY.on) || (typeof golf !== "undefined" && golf.playing); } catch (e) { return false; } }
  function stamp(id) { try { var PP = window.PLAN_PROGRESS; if (PP && PP.award && id) PP.award("stamp", { id: id }); } catch (e) {} }

  // ───────────────────────── config: plan/chainmuseum.json ─────────────────────────
  var CFG = CM.cfg || null;
  function cfgUrl() { return au("/plan/chainmuseum.json?v=" + (window.BUILD || "dev")); }
  if (!CFG) { try { fetch(cfgUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && !CFG) CFG = CM.cfg = d; }).catch(function (e) { note("cfg fetch", e); }); } catch (e) { note("cfg", e); } }
  function cfg() { if (CFG) return CFG; try { var x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = CM.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); } return CFG; }
  function C(path, dflt) { var o = cfg(); if (!o) return dflt; var p = path.split("."); for (var i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }

  // ───────────────────────── geometry kit: parts per material, each with a vertex colour, merged once ─────────────────────────
  var _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1);
  var _cc = {};
  function rgb(c) { if (Array.isArray(c)) return c; if (typeof c === "number" || typeof c === "string") { var k = String(c); if (_cc[k]) return _cc[k]; var q = new THREE.Color(c); return (_cc[k] = [q.r, q.g, q.b]); } return [1, 1, 1]; }
  function Kit() { this.m = {}; this.tris = 0; }
  Kit.prototype.add = function (b, g, col, m4) {
    if (g.index) g = g.toNonIndexed(); if (m4) g.applyMatrix4(m4); if (!g.attributes.normal) g.computeVertexNormals();
    var n = g.attributes.position.count; if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.color) { var c = rgb(col === undefined ? 0xffffff : col), ca = new Float32Array(n * 3); for (var i = 0; i < n; i++) { ca[i * 3] = c[0]; ca[i * 3 + 1] = c[1]; ca[i * 3 + 2] = c[2]; } g.setAttribute("color", new THREE.BufferAttribute(ca, 3)); }
    (this.m[b] || (this.m[b] = [])).push(g); this.tris += n / 3; return g; };
  Kit.prototype.place = function (b, g, col, x, y, z, ry, rx, rz, sx, sy, sz) { _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(x || 0, y || 0, z || 0), _q, _v2.set(sx || 1, sy || 1, sz || 1)); return this.add(b, g, col, _m4); };
  // a box with world-scale uv (t metres a repeat); the uv of each face follows its own two axes, so tiling textures never stretch
  Kit.prototype.box = function (b, col, w, h, d, x, y, z, ry, t, rx, rz) { var g = new THREE.BoxGeometry(w, h, d); uvBox(g, w, h, d, t || 1.0, x, y, z, (ry || 0) + (rx || 0) * 3 + (rz || 0) * 7); return this.place(b, g, col, x, y, z, ry, rx, rz); };
  Kit.prototype.cyl = function (b, col, r0, r1, h, x, y, z, seg, open, ry, rx, rz) { return this.place(b, new THREE.CylinderGeometry(r0, r1, h, seg || 12, 1, !!open), col, x, y, z, ry, rx, rz); };
  Kit.prototype.sph = function (b, col, r, x, y, z, seg, sx, sy, sz) { return this.place(b, new THREE.SphereGeometry(r, seg || 10, Math.max(5, (seg || 10) >> 1)), col, x, y, z, 0, 0, 0, sx, sy, sz); };
  Kit.prototype.tube = function (b, col, A, B, r, seg) { var d = _v3.subVectors(B, A), L = d.length(); if (L < 1e-4) return null; var g = new THREE.CylinderGeometry(r, r, L, seg || 8, 1, true); _q.setFromUnitVectors(_v1.set(0, 1, 0), d.clone().normalize()); _m4.compose(_v2.addVectors(A, B).multiplyScalar(0.5), _q, _s1); return this.add(b, g, col, _m4); };
  Kit.prototype.plane = function (b, col, w, h, x, y, z, ry, rx, uv) { var g = new THREE.PlaneGeometry(w, h); if (uv) { var U = g.attributes.uv; for (var i = 0; i < U.count; i++) U.setXY(i, uv[0] + U.getX(i) * (uv[2] - uv[0]), uv[1] + U.getY(i) * (uv[3] - uv[1])); } return this.place(b, g, col, x, y, z, ry, rx); };
  Kit.prototype.merge = function () { var out = {}; for (var k in this.m) { var g = mergeAll(this.m[k]); if (g) out[k] = g; } return out; };
  Kit.prototype.build = function (grp, bases, opts) { opts = opts || {}; var out = [], geos = this.merge(); for (var b in geos) { var mt = bases[b]; if (!mt) { note("base", b); continue; } var me = new THREE.Mesh(geos[b], mt); me.name = "cm " + b; me.castShadow = !!opts.cast && !mt.transparent && !(opts.noCast && opts.noCast[b]); me.receiveShadow = opts.receive !== false && !mt.transparent; me.userData.shSet = true; if (mt.transparent) me.renderOrder = 2; if (mt.userData && mt.userData.noShadow) me.castShadow = false; if (!me.castShadow) me.userData.noShadow = true; grp.add(me); out.push(me); } this.m = {}; return out; };
  function mergeAll(list) {
    if (!list || !list.length) return null; var n = 0; list.forEach(function (g) { n += g.attributes.position.count; }); if (!n) return null;
    var P = new Float32Array(n * 3), N = new Float32Array(n * 3), Uu = new Float32Array(n * 2), Cc = new Float32Array(n * 3), o = 0;
    list.forEach(function (g) { var c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); Uu.set(g.attributes.uv.array, o * 2); if (g.attributes.color) Cc.set(g.attributes.color.array, o * 3); else Cc.fill(1, o * 3, (o + c) * 3); o += c; g.dispose(); });
    var r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(Uu, 2)); r.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
    r.computeBoundingBox(); r.computeBoundingSphere(); return r; }
  // world-scale uv on a box: the face's own axes in the site frame (plus the box position, so neighbouring boxes continue the pattern)
  // (a rotated box keeps its own axes; an unrotated one continues the pattern of its neighbours)
  function uvBox(g, w, h, d, t, x, y, z, rot) { var uv = g.attributes.uv, P = g.attributes.position, R0 = Math.abs(rot || 0) > 1e-4, ox = R0 ? 0 : (x || 0), oy = R0 ? 0 : (y || 0), oz = R0 ? 0 : (z || 0);
    for (var i = 0; i < uv.count; i++) { var f = (i / 4) | 0, px = P.getX(i) + ox, py = P.getY(i) + oy, pz = P.getZ(i) + oz;
      var u, v; if (f < 2) { u = (f === 0 ? -1 : 1) * pz; v = py; } else if (f < 4) { u = px; v = (f === 2 ? -1 : 1) * pz; } else { u = (f === 4 ? 1 : -1) * px; v = py; } uv.setXY(i, u / t, v / t); } }
  // a white vertex colour on a plain geometry (every basic material of the module uses vertex colours: one program per family)
  function withColor(g) { if (!g.attributes.color) g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)); return g; }
  function rbox(w, h, d, r, seg) { seg = seg || 2; var g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2); var p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3(); var hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
    for (var i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); c.set(clamp(v.x, -hw, hw), clamp(v.y, -hh, hh), clamp(v.z, -hd, hd)); var dd = v.clone().sub(c); if (dd.lengthSq() > 1e-10) { dd.setLength(r); v.copy(c).add(dd); } p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); return g; }
  function lathe(prof, seg) { return new THREE.LatheGeometry(prof.map(function (q) { return new THREE.Vector2(Math.max(0.0001, q[0]), q[1]); }), seg || 12); }
  // a flat quad on the ground (y), corners in the site frame, with world-scale uv (t metres a repeat); faces up whatever the corner order
  function flatQuad(K, b, col, pts, y, t) { var a = 0; for (var i = 0; i < 4; i++) { var p0 = pts[i], p1 = pts[(i + 1) % 4]; a += p0[0] * p1[1] - p1[0] * p0[1]; } var q = a > 0 ? [0, 3, 2, 0, 2, 1] : [0, 1, 2, 0, 2, 3];
    var P = [], U = []; q.forEach(function (k) { P.push(pts[k][0], y, pts[k][1]); U.push(pts[k][0] / t, -pts[k][1] / t); });
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); var Nn = []; for (var j = 0; j < 6; j++) Nn.push(0, 1, 0); g.setAttribute("normal", new THREE.Float32BufferAttribute(Nn, 3)); return K.add(b, g, col); }

  // ───────────────────────── textures: my PBR sets (KTX2 on desktop, the _m copies on the mobile tier) and the repo's shared sets ─────────────────────────
  var TXC = CM.tex = CM.tex || {};
  function ph(rgba, srgb) { var t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }
  function aniso() { var t = tierN(); return t >= 3 ? 16 : t >= 2 ? 8 : 4; }
  // a texture slot that is filled when the file arrives (materials keep one program: the placeholder already has the map)
  function slotTex(name, kind) {
    if (TXC[name]) return TXC[name]; var srgb = kind === "colour", alpha = kind === "rgba";
    var t = ph(kind === "normal" ? [128, 128, 255, 255] : [255, 255, 255, 255], srgb || alpha); t.userData.cmSlot = name; t.userData.avShared = true; TXC[name] = t;
    var mats = []; t.userData.mats = mats;
    var apply = function (src) { try { src.wrapS = src.wrapT = THREE.RepeatWrapping; src.anisotropy = aniso(); src.colorSpace = (srgb || alpha) ? THREE.SRGBColorSpace : THREE.NoColorSpace; src.userData.avShared = true; src.needsUpdate = true; TXC[name] = src; mats.forEach(function (m) { for (var k in m.u) if (m.u[k] === name) m.m[k] = src; m.m.needsUpdate = true; }); CM.n.tex = (CM.n.tex || 0) + 1; } catch (e) { note("tex apply " + name, e); } };
    var ext = alpha ? "png" : "jpg", tries = 0;
    var jpg = function (m) { new THREE.TextureLoader().load(au("/tex/" + name + (m ? "_m." : ".") + ext + "?v=" + (window.BUILD || "dev")), apply, undefined, function (e) { note("tex " + name, e); }); };
    var k = null; try { k = !mobile() && typeof ktx2Loader === "function" ? ktx2Loader() : null; } catch (e) { k = null; }
    if (k) { var one = function () { tries++; k.load(au("/tex/" + name + ".ktx2?v=" + (window.BUILD || "dev")), apply, undefined, function (e) { if (tries < 2) { setTimeout(one, 2500); return; } note("ktx2 " + name + " (jpg instead)", e); jpg(false); }); }; one(); }
    else jpg(mobile() && /^cm_/.test(name));   // my sets have _m copies beside them; the repo's own sets go through the client's tex_m rewrite
    return t; }
  // a standard material whose maps are slots: { map: "cm_conc", normalMap: "cm_conc_n", roughnessMap: "cm_conc_r" }
  function slotMat(maps, o) { var m = new THREE.MeshStandardMaterial(o); var u = {}; for (var k in maps) { var kind = k === "map" ? (o && o.alphaTest ? "rgba" : "colour") : k === "normalMap" ? "normal" : "data"; var t = slotTex(maps[k], kind); m[k] = TXC[maps[k]]; u[k] = maps[k]; if (t.userData.mats) t.userData.mats.push({ m: m, u: u }); } m.userData.avShared = true; return m; }
  function std(o) { var m = new THREE.MeshStandardMaterial(o); m.userData.avShared = true; return m; }
  function basic(o) { var m = new THREE.MeshBasicMaterial(o); m.userData.avShared = true; return m; }

  // ───────────────────────── the shared material families (one program each) ─────────────────────────
  var MX = CM.mats = CM.mats || null;
  function mats() {
    if (MX) return MX; var M = {};
    try {
      var PMs = typeof planMats === "function" ? planMats() : null;
      M.conc = slotMat({ map: "cm_conc", normalMap: "cm_conc_n", roughnessMap: "cm_conc_r" }, { color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.9, 0.9) });
      M.basalt = slotMat({ map: "cm_basalt", normalMap: "cm_basalt_n", roughnessMap: "cm_basalt_r" }, { color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.8, 0.8) });
      M.screen = slotMat({ map: "cm_perf", normalMap: "cm_perf_n", roughnessMap: "cm_perf_r" }, { color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0.82, alphaTest: 0.5, side: THREE.DoubleSide, normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 1.1, emissive: 0xff8a30, emissiveIntensity: 0 });
      // the repo's shared sets (the same texture objects the client already holds: no new GPU memory)
      var stone = PMs && PMs.stone, dg = PMs && PMs.dg;
      M.trav = std({ map: stone ? stone.map : TEX.travertine, normalMap: stone ? stone.normalMap : null, roughnessMap: stone ? stone.roughnessMap : null, color: 0xffffff, vertexColors: true, roughness: 1, normalScale: new THREE.Vector2(0.7, 0.7) });
      M.terr = std({ map: dg ? dg.map : TEX.terrazzo, normalMap: dg ? dg.normalMap : null, roughnessMap: dg ? dg.roughnessMap : null, color: 0xffffff, vertexColors: true, roughness: 0.62, normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: 1.25 });
      M.wood = std({ map: TEX.wood, normalMap: TEX.woodN, roughnessMap: TEX.woodR, color: 0xffffff, vertexColors: true, roughness: 0.85, normalScale: new THREE.Vector2(0.6, 0.6) });
      // metal and paint: a white map and the repo's fine stipple detail normal with a roughness breakup (the one PBR program family, 1 m a repeat)
      var dN = (typeof TEX !== "undefined" && TEX.detailN) || flatN(), dR = mobile() ? flatR() : slotTex("detail_r", "data"), wM = whiteT();   // no extra map on the low tier
      M.metal = std({ map: wM, normalMap: dN, roughnessMap: dR, color: 0xffffff, vertexColors: true, roughness: 0.42, metalness: 0.75, normalScale: new THREE.Vector2(0.22, 0.22), envMapIntensity: 1.2 });
      M.paint = std({ map: wM, normalMap: dN, roughnessMap: dR, color: 0xffffff, vertexColors: true, roughness: 0.74, metalness: 0.0, normalScale: new THREE.Vector2(0.32, 0.32) });
      M.glass = std({ color: 0xffffff, vertexColors: true, roughness: 0.04, metalness: 0.15, transparent: true, opacity: 0.24, depthWrite: false, envMapIntensity: 1.6 }); M.glass.userData.noShadow = true;
      M.glow = basic({ color: 0xffffff, vertexColors: true, toneMapped: true }); M.glow.userData.noShadow = true;
      M.add = basic({ map: whiteT(), color: 0xffffff, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5, toneMapped: true }); M.add.userData.noShadow = true;
      M.lantern = basic({ map: whiteT(), color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.0, depthWrite: false, toneMapped: true }); M.lantern.userData.noShadow = true;
    } catch (e) { note("mats", e); }
    return (MX = CM.mats = M); }

  // ───────────────────────── the site: a chain of nine blocks parallel to the runway ─────────────────────────
  // Local frame (the chain's): x north-east along the runway, z south-east toward the Maker Row sheds, y up from the pad G.
  // The airside fence runs at z -26.7, the shed fronts at z 58.7, Hangar Road at z 88; the Bench Grove (plan_land) sits at x -56..-67.
  var SITE = CM.site = CM.site || null;
  function resolveSite() {
    if (SITE) return SITE; var c = cfg() || {}, s = c.site || {};
    var S = { cx: s.cx || 237, cz: s.cz || 329, th: s.rot || 0.8582, zc: s.chainZ || 4, T: 0.4, LINK: 2.4, LW: 4.0, LH: 3.9, DW: 3.6, DH: 3.4 };
    S.c = Math.cos(S.th); S.s = Math.sin(S.th);
    var defs = [["lobby", 15, 14, 8.6], ["g1", 9.6, 12, 6.2], ["g2", 9.6, 12, 6.6], ["g3", 9.6, 12, 7.0], ["g4", 11.2, 12.6, 10.2], ["g5", 9.6, 12, 7.4], ["g6", 9.6, 12, 7.8], ["g7", 9.6, 12, 8.2], ["g8", 11.2, 12.6, 9.0]];
    var x = 63.5; S.blocks = []; S.links = [];
    defs.forEach(function (d, i) { var w = d[1], b = { id: d[0], i: i, w: w, d: d[2], h: d[3], x0: x - w, x1: x, cx: x - w / 2, z0: S.zc - d[2] / 2, z1: S.zc + d[2] / 2 }; S.blocks.push(b); x -= w;
      if (i < defs.length - 1) { S.links.push({ i: i, x1: x, x0: x - S.LINK, cx: x - S.LINK / 2 }); x -= S.LINK; } });
    S.x0 = S.blocks[S.blocks.length - 1].x0; S.x1 = S.blocks[0].x1;   // -50.7 .. 63.5
    var L = S.blocks[0];
    S.plaza = [38.5, L.z1, 71, 36];         // Genesis Plaza, in front of the Lobby (x0, z0, x1, z1)
    S.exitT = [S.x0 - 6.2, S.zc - 6, S.x0, S.zc + 7];   // the exit terrace off Gallery 8's south-west door
    S.walkZ = 17.2; S.walkW = 3.0;          // the Timeline Walk (travertine) along the south-east side
    S.stone = [54.5, 25.5];                 // the Genesis Stone
    S.carts = [[44.5, 43.0], [47.4, 43.0], [50.3, 43.0], [53.2, 43.0]];   // golf-cart bays beside the path, nose to the plaza
    S.path = [[35.75, 85.0], [35.75, 50.5], [41.0, 36.4]];   // to Hangar Road through the gap between two Maker Row sheds
    S.hub = l2wS(S, 52, 31);
    S.keep = [[-57.5, -21], [72, -21], [72, 56], [-57.5, 56]];
    // the pad level: the mean ground under the chain (the world hooks run before the terrain hooks, so it is taken from the height grid here)
    S.G = null; SITE = CM.site = S; try { var sum = 0, n = 0; S.blocks.forEach(function (b) { for (var u = b.x0; u <= b.x1; u += 3) for (var v = b.z0; v <= b.z1; v += 3) { var w = l2wS(S, u, v); sum += gridH(w[0], w[1]); n++; } }); if (n) S.G = Math.round((sum / n) * 100) / 100; } catch (e) { note("pad level", e); } if (!(S.G > -100)) S.G = 18.6; return S; }
  function l2wS(S, lx, lz) { return [S.cx + lx * S.c + lz * S.s, S.cz - lx * S.s + lz * S.c]; }
  function l2w(lx, lz) { return [SITE.cx + lx * SITE.c + lz * SITE.s, SITE.cz - lx * SITE.s + lz * SITE.c]; }
  function w2l(x, z) { var dx = x - SITE.cx, dz = z - SITE.cz; return [dx * SITE.c - dz * SITE.s, dx * SITE.s + dz * SITE.c]; }
  function yawW(fl) { return fl + SITE.th; }          // a local facing (sin f, cos f in x, z) to a world yaw
  function blockAt(lx, lz, m) { m = m || 0; var B = SITE.blocks; for (var i = 0; i < B.length; i++) { var b = B[i]; if (lx > b.x0 - m && lx < b.x1 + m && lz > b.z0 - m && lz < b.z1 + m) return b; } return null; }
  function linkAt(lx, lz, m) { m = m || 0; var L = SITE.links; for (var i = 0; i < L.length; i++) { var k = L[i]; if (lx > k.x0 - m && lx < k.x1 + m && Math.abs(lz - SITE.zc) < SITE.LW / 2 + m) return k; } return null; }
  // inside the walls (the camera, the people, the zone): a block's inner box or a link's corridor, under the roof
  function inMuseum(x, y, z) { if (!SITE || SITE.G === null) return false; var q = w2l(x, z), h = y - SITE.G, T = SITE.T; var b = blockAt(q[0], q[1], -T); if (b) return h > -1 && h < b.h - 0.55; var k = linkAt(q[0], q[1], -0.2); if (k && Math.abs(q[1] - SITE.zc) < SITE.DW / 2) return h > -1 && h < SITE.LH - 0.35; return false; }
  function chainDist(lx, lz) { var dx = Math.max(SITE.x0 - lx, 0, lx - SITE.x1), dz = Math.max(SITE.zc - 7 - lz, 0, lz - (SITE.zc + 7)); return Math.hypot(dx, dz); }
  function inRect(lx, lz, r, m) { m = m || 0; return lx > r[0] - m && lx < r[2] + m && lz > r[1] - m && lz < r[3] + m; }
  function inLot(lx, lz, m) { m = m || 0; return chainDist(lx, lz) < 1.2 + m || inRect(lx, lz, SITE.plaza, m) || inRect(lx, lz, SITE.exitT, m) || (lx > SITE.x0 - 6 - m && lx < SITE.plaza[0] + 1 + m && Math.abs(lz - SITE.walkZ) < SITE.walkW / 2 + 1.0 + m); }
  function siteDist(x, z) { var q = w2l(x, z); return Math.max(0, chainDist(q[0], q[1]) - 6); }
  function segDist(px, pz, a, b) { var vx = b[0] - a[0], vz = b[1] - a[1], L2 = vx * vx + vz * vz || 1, t = clamp(((px - a[0]) * vx + (pz - a[1]) * vz) / L2, 0, 1); return Math.hypot(px - a[0] - vx * t, pz - a[1] - vz * t); }
  function pathDist(lx, lz) { var P = SITE.path, d = 1e9; for (var i = 0; i < P.length - 1; i++) d = Math.min(d, segDist(lx, lz, P[i], P[i + 1])); return d; }
  // what the clearing removes: the chain, the plaza, the exit terrace and its connector, the walk band, the cart bays (the Bench Grove to the west stays)
  function inClear(lx, lz) { var S = SITE; return chainDist(lx, lz) < 2.6 || inRect(lx, lz, S.plaza, 1.6) || inRect(lx, lz, S.exitT, 1.0) || (lx > S.exitT[0] && lx < S.plaza[0] && Math.abs(lz - S.walkZ) < S.walkW / 2 + 1.2) || (lx > -54.6 && lx < -50.6 && lz > S.exitT[3] - 0.5 && lz < S.walkZ) || inRect(lx, lz, [42.0, 39.6, 56.0, 46.4], 1.0) || pathDist(lx, lz) < 2.2; }
  function inKeep(lx, lz) { var k = SITE.keep; return lx > k[0][0] && lx < k[1][0] && lz > k[0][1] && lz < k[2][1]; }

  // ───────── terrain hook: one level pad under the chain, the plaza and the walk, blended out over 14 m; the site keep-out ─────────
  function gridH(x, z) { try { return sampleGrid(H, T, x, z); } catch (e) { return getH(x, z); } }
  function terrainHook() {
    if (CM.off || !window.PLAN) return; var S = resolveSite(); if (!S) return; var t0 = nowMs();
    try { if (typeof H !== "undefined" && H && T) { var cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1), blend = 14, cnt = 0;
        var corners = [[S.x0 - 30, -26], [S.x1 + 22, -26], [S.x1 + 22, 60], [S.x0 - 30, 60]].map(function (q) { return l2w(q[0], q[1]); });
        var X0 = Math.min.apply(null, corners.map(function (q) { return q[0]; })), X1 = Math.max.apply(null, corners.map(function (q) { return q[0]; })), Z0 = Math.min.apply(null, corners.map(function (q) { return q[1]; })), Z1 = Math.max.apply(null, corners.map(function (q) { return q[1]; }));
        for (var r = Math.max(0, Math.floor((Z0 - T.zmin) / ch)); r <= Math.min(T.rows - 1, Math.ceil((Z1 - T.zmin) / ch)); r++) for (var c = Math.max(0, Math.floor((X0 - T.xmin) / cw)); c <= Math.min(T.cols - 1, Math.ceil((X1 - T.xmin) / cw)); c++) {
          var x = T.xmin + c * cw, z = T.zmin + r * ch, q = w2l(x, z);
          var d = Math.min(chainDist(q[0], q[1]) - 9.5, rectDist(q[0], q[1], S.plaza) - 2.5, rectDist(q[0], q[1], S.exitT) - 3);
          d = Math.min(d, Math.abs(q[1] - S.walkZ) - 3.5 + (q[0] > S.plaza[0] || q[0] < S.x0 - 7 ? 99 : 0));
          if (d >= blend) continue; var k = d <= 0 ? 1 : 1 - sstep(0, blend, d), vi = r * T.cols + c; H[vi] = H[vi] + (S.G - H[vi]) * k; cnt++; }
        CM.n.graded = cnt; } } catch (e) { note("grade", e); }
    keepout(); planterSoil(S);
    try { var Rr = 0, Rc = 0; for (var kk in PLACE) { var Lk = PLACE[kk]; for (var i = 0; i < Lk.length; i++) { var e = Lk[i]; if (siteDist(e[0], e[2]) > 32) continue; if (e.cm) { if (typeof e.cmY === "number") { e[1] = e.cmY; Rc++; } else e[1] = getH(e[0], e[2]); continue; } var g = getH(e[0], e[2]); if (Math.abs(g - e[1]) > 0.02 && Math.abs(g - e[1]) < 6) { e[1] = g; Rr++; } } } CM.n.reseated = Rr; CM.n.cmY = Rc; } catch (e) { note("reseat", e); }
    CM.n.terrainMs = Math.round(nowMs() - t0); }
  // the planters' soil in the client's walk grid, so every seating pass puts their trees on the soil (not 0.5 m down in the box)
  function planterSoil(S) { if (CM.n.soil || typeof walkAdd !== "function") return; try { var P = []; [[41.5, 14.2], [68.5, 14.2], [41.5, 33.6], [68.5, 33.6]].forEach(function (q) { var c = [[-1.25, -1.25], [1.25, -1.25], [1.25, 1.25], [-1.25, 1.25]].map(function (d) { var w = l2w(q[0] + d[0], q[1] + d[1]); return [w[0], S.G + 0.505, w[1]]; }); [0, 1, 2, 0, 2, 3].forEach(function (k) { P.push(c[k][0], c[k][1], c[k][2]); }); });
      var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); walkAdd(g); g.dispose(); CM.n.soil = 4; } catch (e) { note("soil", e); } }
  function keepout() { if (CM.n.keep) return; var S = SITE; try { planKeepout(S.keep.map(function (q) { return l2w(q[0], q[1]); })); CM.n.keep = 1; } catch (e) { note("keepout", e); }
    try { S.blocks.forEach(function (b) { for (var u = b.x0 + 2; u <= b.x1 - 1; u += 5) for (var v = b.z0 + 2; v <= b.z1 - 1; v += 5) { var w = l2w(u, v); KEEPOUT.push([w[0], w[1], 4.5]); } }); for (var x = S.plaza[0]; x <= S.plaza[2]; x += 7) for (var z = S.plaza[1]; z <= S.plaza[3]; z += 7) { var w2 = l2w(x, z); KEEPOUT.push([w2[0], w2[1], 4.5]); } } catch (e) { note("keepouts", e); } }
  function rectDist(lx, lz, r) { var dx = Math.max(r[0] - lx, 0, lx - r[2]), dz = Math.max(r[1] - lz, 0, lz - r[3]); return Math.hypot(dx, dz); }

  // ───────── world hook: clearing, keep-outs, the hub, the zone, info points, paths, engine planting, lamps and carts ─────────
  var VEG = /^(bush\d|mesquite|ocotillo|saguaro.*|paloverde|ironwood|desertwillow|barrel_cactus|prickly_pear|cholla|organ_pipe|agave_cluster|yucca_cluster|boulder|ph_(rock|boulder|shrub|succulent|stones|sandrocks)_?\d*|e1_.*|lux_lamp|lamp)$/;
  function clearLot() { var removed = 0, keys = new Set();
    for (var k in PLACE) { if (!VEG.test(k)) continue; var L = PLACE[k], out = []; for (var i = 0; i < L.length; i++) { var e = L[i]; var q = w2l(e[0], e[2]); if (!e.cm && inClear(q[0], q[1])) { keys.add(Math.round(e[0] * 100) + ":" + Math.round(e[2] * 100)); removed++; } else out.push(e); } if (out.length !== L.length) { L.length = 0; Array.prototype.push.apply(L, out); } }
    if (keys.size) for (var j = COLLIDERS.length - 1; j >= 0; j--) { var c = COLLIDERS[j]; if (keys.has(Math.round(c[0] * 100) + ":" + Math.round(c[1] * 100))) COLLIDERS.splice(j, 1); }
    CM.n.cleared = (CM.n.cleared || 0) + removed; }
  // the engine may file a kind under a variant (saguaro as saguaro_mid): find the new entry by its position
  function lastPut(x, z) { for (var kk in PLACE) { var L = PLACE[kk], e = L[L.length - 1]; if (e && e[0] === x && e[2] === z) return e; } return null; }
  function put1(k, lx, lz, ry, sc) { if (!canPut(k)) return null; var w = l2w(lx, lz); put(k, w[0], w[1], ry, sc); var e = lastPut(w[0], w[1]); if (e) e.cm = 1; CM.n.put = (CM.n.put || 0) + 1; return e; }
  function plantSite(S) { var R = rng(2009), low = ["agave_cluster", "yucca_cluster", "barrel_cactus", "bush2", "ph_succulent_1", "ph_succulent_2", "prickly_pear"].filter(canPut), n0 = CM.n.put || 0;
    var tall = ["paloverde", "mesquite", "ironwood", "desertwillow"].filter(canPut);
    // beds between the chain and the Timeline Walk (low, so the facades stay in view), with an ocotillo or a saguaro now and then
    for (var x = S.x0 + 2; x < S.plaza[0] - 1; x += 3.1) { if (R() < 0.18) continue; var z = S.zc + 7.6 + R() * 2.4; put1(low[(R() * low.length) | 0], x + R(), z, R() * TAU, 0.7 + R() * 0.5); }
    [[S.x0 + 8, 12.2, "ocotillo"], [-18, 12.4, "saguaro"], [9, 12.0, "ocotillo"], [30.5, 12.3, "saguaro_mid"], [-36, 12.0, "ocotillo"]].forEach(function (q) { put1(q[2], q[0], q[1], R() * TAU, 0.95); });
    // the far side of the walk: shade trees and beds, so the walk has shade at 17:40 and a desert edge toward the sheds
    for (var x2 = S.x0 + 3; x2 < S.plaza[0] - 2; x2 += 9.5) { put1(tall[(R() * tall.length) | 0], x2 + R() * 2, S.walkZ + 4.6 + R() * 1.4, R() * TAU, 0.85 + R() * 0.3); put1(low[(R() * low.length) | 0], x2 + 4 + R() * 2, S.walkZ + 3.4 + R(), R() * TAU, 0.8); }
    // the runway side: a few clusters on the gravel apron toward the fence
    for (var x3 = S.x0 + 4; x3 < S.x1 - 2; x3 += 7.5) { if (R() < 0.35) continue; put1(low[(R() * low.length) | 0], x3 + R() * 2, S.zc - 10.8 - R() * 4, R() * TAU, 0.8 + R() * 0.4); }
    // Genesis Plaza: four shade trees at the corners of the stone court, agave round the totem
    [[41.5, 14.2], [68.5, 14.2], [41.5, 33.6], [68.5, 33.6]].forEach(function (q, i) { var e = put1(canPut("paloverde") ? "paloverde" : tall[0], q[0], q[1], R() * TAU, 0.95 + 0.1 * i); if (e) { e[1] = e.cmY = S.G + 0.5; } });
    [[41.3, 50.6], [41.6, 47.8], [38.9, 51.4]].forEach(function (q) { put1(low[0] || "agave_cluster", q[0], q[1], R() * TAU, 0.9); });
    CM.n.planted = (CM.n.put || 0) - n0; }
  function lampsCarts(S) { var R = rng(31);
    var lamp = function (lx, lz, y) { var w = l2w(lx, lz); try { if (has("lamp")) { put("lamp", w[0], w[1], 0, 1); var L = PLACE.lamp; var e = L && L[L.length - 1]; if (e) { e.cm = 1; if (y !== undefined) e[1] = y; } } } catch (e2) { note("lamp", e2); } };
    [[40.2, 18.5], [40.2, 30.0], [70.0, 18.5], [70.0, 30.0]].forEach(function (q) { lamp(q[0], q[1]); }); [[33.4, 52.0], [33.4, 81.0]].forEach(function (q) { lamp(q[0], q[1]); });
    for (var x = S.x0 + 5; x < S.plaza[0] - 3; x += 14) lamp(x, S.walkZ - 2.2);
    // golf carts first: four bays, three carts parked (nose toward the plaza), one bay free
    S.carts.forEach(function (q, i) { if (i === 2 || !has("cart")) return; var w = l2w(q[0], q[1]); var ry = yawW(PI) + (R() - 0.5) * 0.1; try { put("cart", w[0], w[1], ry); var ec = lastPut(w[0], w[1]); if (ec) ec.cm = 1; var mk = new THREE.Object3D(); mk.position.set(w[0], getH(w[0], w[1]), w[1]); mk.rotation.y = ry; (SITES.parked = SITES.parked || []).push(mk); CM.n.carts = (CM.n.carts || 0) + 1; } catch (e) { note("cart", e); } }); }
  // the paths: to Hangar Road through the gap between two Maker Row sheds, and the Timeline Walk (travertine, the client's ribbons and walk grid)
  function paths(S) { try { var M0 = planMats(); var p = S.path.map(function (q) { return l2w(q[0], q[1]); }); var r1 = planRibbon(p, 3.2, { mat: M0.stone, lift: 0.18, tile: 3 }, "cm_path"); if (r1) r1.cm = true;
      CM.n.paths = 1; } catch (e) { note("paths", e); } }
  function worldHook() {
    if (CM.off || !window.PLAN) return; var S = resolveSite(); if (!S) { note("site", "no site"); return; } var t0 = nowMs();
    keepout();
    try { clearLot(); } catch (e) { note("clear", e); }
    try { planAddHub(C("names.hub", "Genesis Block Museum"), S.hub[0], S.hub[1]); planNavCats(); } catch (e) { note("hub", e); }
    try { var poly = [[S.x0 - 7, S.zc - 9], [S.x1 + 1, S.zc - 9], [S.x1 + 1, S.plaza[1]], [S.plaza[2], S.plaza[1]], [S.plaza[2], S.plaza[3]], [S.plaza[0], S.plaza[3]], [S.plaza[0], S.walkZ + 2], [S.x0 - 7, S.walkZ + 2]].map(function (q) { return l2w(q[0], q[1]); }); S.outline = poly; var cz = l2w(8, 10); zoneRings.push({ name: C("names.zone", "The Genesis Block Museum"), label: C("names.short", "Genesis Block Museum"), center: cz, r: 64, k: C("lobby.info.k", ""), poly: poly, col: "#4dde6f55", plan: "chainmuseum" }); } catch (e) { note("zone", e); }
    try { var hs = function (d, lx, lz, r, tag) { if (!d) return null; var w = l2w(lx, lz); var h = { x: w[0], z: w[1], r: r, t: d.t, k: d.k, p: d.p, cm: tag }; hotspots.push(h); (CM.hsList = CM.hsList || []).push(h); return h; };
      var L = S.blocks[0]; hs(C("lobby.info", null), L.cx - 2.5, S.zc + 1.5, 3.2, "lobby");
      (C("galleries", []) || []).forEach(function (g, i) { var b = S.blocks[i + 1]; if (!b) return; hs(g.info, b.cx + (b.w / 2 - 2.2), S.zc + 3.6, 2.6, g.id); });
      hs(C("plaza.stone", null), S.stone[0] - 2.4, S.stone[1] - 1.6, 3.4, "stone"); hs(C("plaza.totem", null), 40.2, 47.4, 2.6, "totem"); hs(C("plaza.walk", null), 4, S.walkZ, 3.0, "walk"); } catch (e) { note("hotspots", e); }
    try { paths(S); } catch (e) { note("paths", e); }
    try { plantSite(S); } catch (e) { note("plant", e); }
    try { lampsCarts(S); } catch (e) { note("lamps", e); }
    try { siteSolids(); } catch (e) { note("solids", e); }
    installOverrides(); CM.n.worldMs = Math.round(nowMs() - t0); }

  // ───────────────────────── lettering: one canvas atlas for every exterior word (fascias, the totem, the stone, the years) ─────────────────────────
  // 2048 x 1024, sixteen strips of 1024 x 128 (two a row). White on transparent: the letter colour comes from the vertex colour (bronze by day),
  // the glow at night from the material's emissive. Strip i: uv [u0, v0, u1, v1].
  var LT = CM.lt = CM.lt || null;
  var FONT = "'Space Grotesk', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif", MONO = "'JetBrains Mono', Consolas, 'Courier New', monospace", DISP = "Anton, Impact, 'Arial Narrow Bold', 'Segoe UI', sans-serif";
  function stripUV(i) { var col = i % 2, row = (i / 2) | 0; return [col * 0.5, 1 - (row + 1) / 8, col * 0.5 + 0.5, 1 - row / 8]; }
  function letters() {
    if (LT) return LT; var lo = tierN() < 1 || mobile(); var W = lo ? 1024 : 2048, Hh = W / 2, sw = W / 2, sh = Hh / 8;
    var cv = document.createElement("canvas"); cv.width = W; cv.height = Hh; var x = cv.getContext("2d");
    var put = function (i, text, o) { o = o || {}; var col = i % 2, row = (i / 2) | 0, x0 = col * sw, y0 = row * sh; x.save(); x.beginPath(); x.rect(x0, y0, sw, sh); x.clip();
      var px = (o.size || 0.62) * sh; x.font = (o.weight || "600") + " " + px + "px " + (o.font || FONT); x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle";
      var ls = o.ls || 0.08; var chars = String(text).split(""), widths = chars.map(function (c) { return x.measureText(c).width; }), tot = widths.reduce(function (a, b) { return a + b; }, 0) + ls * px * (chars.length - 1), maxW = sw * 0.96;
      var sc = tot > maxW ? maxW / tot : 1; x.translate(x0 + sw / 2, y0 + sh / 2 + px * 0.04); x.scale(sc, 1); var cx = -tot / 2; x.textAlign = "left";
      for (var k = 0; k < chars.length; k++) { x.fillText(chars[k], cx, 0); cx += widths[k] + ls * px; } x.restore(); };
    var drawAll = function () { x.clearRect(0, 0, W, Hh); var G = C("galleries", []) || [];
    put(0, C("lobby.fascia", "THE GENESIS BLOCK MUSEUM"), { size: 0.6, ls: 0.14 });
    G.forEach(function (g, i) { put(1 + i, (g.year || "") + "  ·  " + (g.name || ""), { size: 0.56, ls: 0.12 }); });
    put(9, C("lobby.sub", "FROM CLAY TO CHAIN"), { size: 0.5, ls: 0.3 });
    put(10, C("names.museum", "The Genesis Block Museum").toUpperCase(), { size: 0.46, ls: 0.1 });
    var hash = C("plaza.inscription", "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f");
    for (var f = 0; f < 4; f++) put(11 + f, hash.slice(f * 16, f * 16 + 16), { size: 0.62, ls: 0.16, font: MONO, weight: "600" });
    put(15, C("fascia.plaza", "GENESIS PLAZA") + "  ·  " + C("fascia.walk", "THE TIMELINE WALK"), { size: 0.44, ls: 0.2 }); };
    drawAll(); var tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso(); tex.userData.avShared = true;
    var mat = std({ map: tex, normalMap: flatN(), roughnessMap: flatR(), color: 0xffffff, vertexColors: true, alphaTest: 0.45, roughness: 0.5, metalness: 0.45, emissive: 0xffd9a0, emissiveIntensity: 0, side: THREE.DoubleSide, envMapIntensity: 1.2 });   // the screen family (one program)
    // the bronze years in the Timeline Walk: a small second canvas (12 plates, 6 x 2)
    var pc = document.createElement("canvas"); pc.width = lo ? 512 : 1024; pc.height = pc.width / 4; var y = pc.getContext("2d"); var pw = pc.width / 6, phh = pc.height / 2;
    var drawPlates = function () { (C("walkYears", []) || []).forEach(function (yr, i) { var cx = (i % 6) * pw, cy = ((i / 6) | 0) * phh; y.fillStyle = "#5b3c22"; y.fillRect(cx, cy, pw, phh); y.strokeStyle = "#e0b070"; y.lineWidth = Math.max(2, pw * 0.03); y.strokeRect(cx + pw * 0.05, cy + phh * 0.08, pw * 0.9, phh * 0.84); y.fillStyle = "#f0c88a"; y.font = "700 " + Math.round(phh * 0.46) + "px " + FONT; y.textAlign = "center"; y.textBaseline = "middle"; y.fillText(yr, cx + pw / 2, cy + phh * 0.54); }); };
    drawPlates();
    var ptex = new THREE.CanvasTexture(pc); ptex.colorSpace = THREE.SRGBColorSpace; ptex.anisotropy = aniso(); ptex.userData.avShared = true;
    var pmat = std({ map: ptex, color: 0xffffff, vertexColors: true, roughness: 0.35, metalness: 0.8, normalMap: TXC.cm_conc_n || slotTex("cm_conc_n", "normal"), roughnessMap: TXC.cm_conc_r || slotTex("cm_conc_r", "data"), envMapIntensity: 1.2 });
    try { if (document.fonts && document.fonts.status !== "loaded" && document.fonts.ready) document.fonts.ready.then(function () { try { drawAll(); drawPlates(); tex.needsUpdate = true; ptex.needsUpdate = true; CM.n.letters2 = 1; } catch (e) { note("letters redraw", e); } }); } catch (e) {}
    LT = CM.lt = { tex: tex, mat: mat, ptex: ptex, pmat: pmat, W: W }; return LT; }
  // a lettering strip as a plane, sized by height (the strip's text is centred, so the width is the strip's aspect at that height)
  var FLAT = {}; function whiteT() { return FLAT.w || (FLAT.w = ph([255, 255, 255, 255], true)); } function flatN() { return FLAT.n || (FLAT.n = ph([128, 128, 255, 255], false)); } function flatR() { return FLAT.r || (FLAT.r = ph([255, 255, 255, 255], false)); }
  function letterPlane(K, i, h, x, y, z, ry, col) { var uv = stripUV(i); var w = h * 8; K.plane("letters", col || 0xc8925a, w, h, x, y, z, ry, 0, uv); return w; }
  function plateUV(i) { var c = i % 6, r = (i / 6) | 0; return [c / 6, 1 - (r + 1) / 2, (c + 1) / 6, 1 - r / 2]; }

  // ───────────────────────── walls with openings: boxes for every solid span, recorded as collision solids too ─────────────────────────
  // axis "x": a wall along x at the plane z (outer face), growing inward by T in the direction sg; openings [[a0, a1, y0, y1]] along x.
  function wallSpans(a0, a1, y0, y1, ops) { var bp = [a0, a1]; ops.forEach(function (o) { if (o[1] > a0 && o[0] < a1) { bp.push(clamp(o[0], a0, a1), clamp(o[1], a0, a1)); } }); bp.sort(function (p, q) { return p - q; }); var out = [];
    for (var i = 0; i < bp.length - 1; i++) { var s0 = bp[i], s1 = bp[i + 1]; if (s1 - s0 < 1e-3) continue; var mid = (s0 + s1) / 2, cuts = ops.filter(function (o) { return mid > o[0] && mid < o[1]; }).map(function (o) { return [o[2], o[3]]; }).sort(function (p, q) { return p[0] - q[0]; });
      var y = y0; cuts.forEach(function (c) { if (c[0] > y + 1e-3) out.push([s0, s1, y, Math.min(c[0], y1)]); y = Math.max(y, c[1]); }); if (y < y1 - 1e-3) out.push([s0, s1, y, y1]); } return out; }
  function wall(K, base, col, axis, a0, a1, plane, sg, T, y0, y1, ops, sol, tUV) {
    wallSpans(a0, a1, y0, y1, ops || []).forEach(function (s) { var L = s[1] - s[0], Hh = s[3] - s[2], m = (s[0] + s[1]) / 2, my = (s[2] + s[3]) / 2, pc = plane + sg * T / 2;
      if (axis === "x") K.box(base, col, L, Hh, T, m, my, pc, 0, tUV || 2.0); else K.box(base, col, T, Hh, L, pc, my, m, 0, tUV || 2.0);
      if (sol && s[2] < 2.2) { if (axis === "x") sol.push([m, pc, L, T + 0.04, s[2], s[3], 0]); else sol.push([pc, m, T + 0.04, L, s[2], s[3], 0]); } }); }

  // ───────────────────────── the exterior: nine blocks, eight glass links, Genesis Plaza, the Timeline Walk, the cart bays ─────────────────────────
  var EX = CM.ex = CM.ex || { g: null };
  function blockCol(b) { return b.id === "g4" ? 0xffffff : [0xf2ece2, 0xeae2d4, 0xf0e8da, 0xe8e0d2, 0xffffff, 0xece4d6, 0xf2eadc, 0xe6ddcf, 0xefe7d9][b.i]; }
  function dryKit() { var nop = function () { return null; }; return { m: {}, tris: 0, add: nop, place: nop, box: nop, cyl: nop, sph: nop, tube: nop, plane: nop, dry: true }; }
  // dry: only the collision solids (the world hook needs them before anything is drawn), no geometry, no materials
  function buildExterior(dry) {
    if (!dry && EX.g) return EX.g; var S = SITE, T = S.T, zc = S.zc, sol = [];
    var M = dry ? null : mats(), LTx = dry ? null : letters(), K = dry ? dryKit() : new Kit();
    var bronze = 0x9a6a40, steel = 0x2b2d30, dark = 0x1c1d1f;
    var lanternK = dry ? dryKit() : new Kit(), glowK = dry ? dryKit() : new Kit();
    S.blocks.forEach(function (b) {
      var w = b.w, h = b.h, x0 = b.x0, x1 = b.x1, z0 = b.z0, z1 = b.z1, cx = b.cx, hero = b.id === "g4", lobby = b.id === "lobby", last = b.id === "g8";
      var base = hero ? "basalt" : "conc", col = blockCol(b), clT = 3.6, clB = h - 1.3;
      // long walls (NW at z0 growing +z, SE at z1 growing -z): lower wall, clerestory between corner piers, fascia
      [[z0, 1], [z1, -1]].forEach(function (q) { var zp = q[0], sg = q[1], ops = [];
        if (lobby && sg < 0) ops.push([x0 + 1.2, x1 - 1.2, 0, h - 1.6]); else if (!hero) ops.push([x0 + 0.9, x1 - 0.9, clT, clB]);
        if (hero) ops.push([x0 + 0.6, x1 - 0.6, 3.5, 3.72]);   // Block Zero: a lit seam all round instead of glass
        wall(K, base, col, "x", x0, x1, zp, sg, T, 0, h, ops, sol);
        // basalt plinth band, proud of the face
        K.box("basalt", 0xffffff, w + 0.1, 0.42, 0.07, cx, 0.21, zp - sg * 0.035, 0, 2.0);
        if (hero) { glowK.box("glow", 0xffa53a, w - 1.2, 0.2, 0.05, cx, 3.61, zp + sg * 0.12); return; }
        if (lobby && sg < 0) return;
        // clerestory glass, mullions, the lantern glow behind, the perforated bronze screen in front on stand-offs
        var gw = w - 1.8, gh = clB - clT; K.box("glass", 0xcfe0e6, gw, gh, 0.03, cx, (clT + clB) / 2, zp + sg * T * 0.5);
        for (var mx = x0 + 0.9; mx <= x1 - 0.9 + 1e-3; mx += gw / Math.max(1, Math.round(gw / 1.6))) K.box("metal", steel, 0.07, gh, 0.12, mx, (clT + clB) / 2, zp + sg * T * 0.5);
        lanternK.plane("lantern", 0xffc98a, gw - 0.1, gh - 0.1, cx, (clT + clB) / 2, zp + sg * (T * 0.5 - 0.035), sg > 0 ? PI : 0);
        var sx0 = x0 + 0.75, sx1 = x1 - 0.75, sy0 = clT - 0.15, sy1 = clB + 0.12, zs = zp - sg * 0.3;
        var sc = new THREE.PlaneGeometry(sx1 - sx0, sy1 - sy0); var U = sc.attributes.uv; for (var i = 0; i < U.count; i++) U.setXY(i, (U.getX(i) * (sx1 - sx0) + b.i * 0.37) / 1.6, (U.getY(i) * (sy1 - sy0)) / 1.6);
        K.place("screen", sc, 0xffffff, (sx0 + sx1) / 2, (sy0 + sy1) / 2, zs, sg > 0 ? PI : 0);
        K.box("metal", bronze, sx1 - sx0 + 0.06, 0.06, 0.06, (sx0 + sx1) / 2, sy0 - 0.03, zs, 0); K.box("metal", bronze, sx1 - sx0 + 0.06, 0.06, 0.06, (sx0 + sx1) / 2, sy1 + 0.03, zs, 0);
        for (var bx = sx0 + 0.4; bx < sx1; bx += 1.8) { K.box("metal", steel, 0.05, 0.05, 0.3, bx, sy0 + 0.25, zp - sg * 0.15, 0); K.box("metal", steel, 0.05, 0.05, 0.3, bx, sy1 - 0.25, zp - sg * 0.15, 0); } });
      // end walls (NE at x1 growing -x, SW at x0 growing +x) with the link doorways (and the exit beyond Gallery 8)
      var dop = [zc - S.DW / 2, zc + S.DW / 2, 0, S.DH];
      wall(K, base, col, "z", z0 + T, z1 - T, x1, -1, T, 0, h, b.i > 0 ? [dop] : [], sol);
      wall(K, base, col, "z", z0 + T, z1 - T, x0, 1, T, 0, h, [dop], sol);
      [[x1, -1], [x0, 1]].forEach(function (q) { K.box("basalt", 0xffffff, 0.07, 0.42, b.d - 2 * T, q[0] - q[1] * 0.035, 0.21, (z0 + z1) / 2, 0, 2.0); });
      // roof slab inside the parapet, metal coping on the walls, the roof deck finish
      K.box(base, col, w - 2 * T + 0.02, 0.3, b.d - 2 * T + 0.02, cx, h - 0.27, (z0 + z1) / 2, 0, 2.4);
      K.box("paint", 0x8f887d, w - 2 * T - 0.2, 0.04, b.d - 2 * T - 0.2, cx, h - 0.1, (z0 + z1) / 2, 0);
      K.box("metal", dark, w + 0.04, 0.05, T + 0.06, cx, h + 0.025, z0 + T / 2, 0); K.box("metal", dark, w + 0.04, 0.05, T + 0.06, cx, h + 0.025, z1 - T / 2, 0);
      K.box("metal", dark, T + 0.06, 0.05, b.d - 2 * T, x0 + T / 2, h + 0.025, (z0 + z1) / 2, 0); K.box("metal", dark, T + 0.06, 0.05, b.d - 2 * T, x1 - T / 2, h + 0.025, (z0 + z1) / 2, 0);
      // the chain line of light along the top of the south-east and north-west parapets (dark bronze by day)
      glowK.box("glow", 0x5cf07e, w, 0.09, 0.09, cx, h + 0.095, z1 - 0.06, 0); glowK.box("glow", 0x5cf07e, w, 0.09, 0.09, cx, h + 0.095, z0 + 0.06, 0);
      // lettering: the year and the name on both fascias (the Lobby: the museum's name on the canopy, its motto on the fascia)
      var li = lobby ? 9 : b.i, lh = lobby ? 0.5 : 0.74, ly = h - 0.72, lcol = hero ? 0xf2a33a : 0x5e4026;
      if (!lobby) { letterPlane(K, li, lh, cx, ly, z1 + 0.02, 0, lcol); letterPlane(K, li, lh, cx, ly, z0 - 0.02, PI, lcol); } else { letterPlane(K, 9, lh, cx, ly, z0 - 0.02, PI, lcol); }
      if (lobby) buildLobbyFront(K, glowK, b, sol); else if (!K.dry) solarRoof(K, b);
      if (last) { K.box("conc", 0xefe7d9, 1.6, 0.3, S.DW + 1.6, x0 - 0.8, S.DH + 0.45, zc, 0, 2.4); glowK.box("glow", 0xfff1d8, 0.9, 0.03, S.DW + 0.8, x0 - 0.8, S.DH + 0.29, zc, 0); }
    });
    // the glass links: a slim roof, glass both sides, a lit hash pointer under the roof, the chain line on top
    S.links.forEach(function (k) { var L = k.x1 - k.x0 + 2 * T, cx = k.cx, LH = S.LH, LW = S.LW;
      K.box("conc", 0xefe7d9, L + 0.3, 0.32, LW + 0.5, cx, LH - 0.16, zc, 0, 2.4);
      K.box("metal", dark, L + 0.34, 0.05, LW + 0.54, cx, LH + 0.025, zc, 0);
      [-1, 1].forEach(function (sd) { var zg = zc + sd * (LW / 2 - 0.05); K.box("glass", 0xd6e6ea, L, LH - 0.36, 0.03, cx, (LH - 0.36) / 2 + 0.04, zg, 0); K.box("metal", steel, L + 0.02, 0.08, 0.08, cx, 0.06, zg, 0); K.box("metal", steel, L + 0.02, 0.06, 0.08, cx, LH - 0.35, zg, 0); [k.x0 + 0.04, k.x1 - 0.04].forEach(function (px) { K.box("metal", steel, 0.08, LH - 0.36, 0.1, px, (LH - 0.36) / 2 + 0.02, zg, 0); }); sol.push([cx, zg, k.x1 - k.x0 + 0.1, 0.16, 0, LH - 0.36, 0]); });
      glowK.box("glow", 0x7ef0a0, L - 0.2, 0.025, 0.12, cx, LH - 0.335, zc, 0); glowK.box("glow", 0x4dde6f, L + 0.3, 0.05, 0.05, cx, LH + 0.075, zc + LW / 2 + 0.2, 0); glowK.box("glow", 0x4dde6f, L + 0.3, 0.05, 0.05, cx, LH + 0.075, zc - LW / 2 - 0.2, 0); });
    buildGrounds(K, glowK, sol); if (EX.logos2) EX.logos = (EX.logos || []).concat(EX.logos2);
    if (dry) return sol;
    var g = new THREE.Group(); g.name = "cm exterior"; g.position.set(S.cx, S.G, S.cz); g.rotation.y = S.th; g.userData.noBatch = true;
    var meshes = K.build(g, { conc: M.conc, basalt: M.basalt, screen: M.screen, glass: M.glass, metal: M.metal, paint: M.paint, letters: LTx.mat, trav: M.trav, terr: M.terr, wood: M.wood, plates: LTx.pmat }, { cast: true, noCast: { trav: 1, terr: 1, plates: 1 } });
    var lm = lanternK.build(g, { lantern: M.lantern }, {}); var gm = glowK.build(g, { glow: M.glow }, {});
    buildWashes(g, S);
    var lgm = logoMat(); if (lgm) (EX.logos || []).forEach(function (q) { var me = new THREE.Mesh(withColor(new THREE.PlaneGeometry(q[4] * 2, q[4])), lgm); me.position.set(q[0], q[1], q[2]); me.rotation.y = q[3]; me.name = "cm logo"; g.add(me); }); EX.lantern = lm[0] || null; EX.glow = gm[0] || null; EX.solids = sol; EX.meshes = meshes.length + lm.length + gm.length; EX.tris = Math.round(K.tris + lanternK.tris + glowK.tris);
    // the pulse: a short bright run of light that travels the chain line from the Lobby to Gallery 8, block to block
    var pg = withColor(new THREE.BoxGeometry(4.2, 0.16, 0.16));
    EX.pulse = [0, 1].map(function () { var pm = new THREE.Mesh(pg, M.add); pm.name = "cm pulse"; pm.visible = false; pm.renderOrder = 4; g.add(pm); return pm; });
    EX.chainPath = chainPath();
    // pool lamps (sources for the client's pool, no new real lights): under the canopy, up at the stone, at the exit
    EX.lights = []; var addL = function (kind, col, k, dist, x, y, z, tx, tz) { var l = kind === "spot" ? new THREE.SpotLight(col, 0, dist, 0.55, 0.6, 1.4) : new THREE.PointLight(col, 0, dist, 1.4); l.position.set(x, y, z); l.userData.k0 = k; if (kind === "spot") { var tg = new THREE.Object3D(); tg.position.set(tx, 0.8, tz); g.add(tg); l.target = tg; } g.add(l); EX.lights.push(l); return l; };
    var L0 = S.blocks[0]; addL("point", 0xffd8a8, 5, 16, L0.cx - 3, 4.6, L0.z1 + 3.0); addL("point", 0xffd8a8, 5, 16, L0.cx + 3.5, 4.6, L0.z1 + 3.0);
    addL("spot", 0xffe2b8, 9, 18, S.stone[0] - 3.5, 0.3, S.stone[1] + 3.5, S.stone[0], S.stone[1]); addL("point", 0xffd0a0, 4, 14, S.x0 - 2.5, 3.2, zc);
    g.updateMatrixWorld(true); scene.add(g); EX.g = g;
    try { if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(g, { name: "cm exterior" }); } catch (e) {}
    return g; }
  // wall washers: a small fixture at the foot of the facade and an additive wash up the concrete (night only); the Lobby glows from afar
  var WASHT = null;
  function washTex() { if (WASHT) return WASHT; var c = document.createElement("canvas"); c.width = 64; c.height = 256; var x = c.getContext("2d"); for (var yy = 0; yy < 256; yy++) { var v = 1 - yy / 256; var a = Math.pow(v, 1.6); var gr = x.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, "rgba(255,214,160,0)"); gr.addColorStop(0.5, "rgba(255,214,160," + a + ")"); gr.addColorStop(1, "rgba(255,214,160,0)"); x.fillStyle = gr; x.fillRect(0, 255 - yy, 64, 1); } WASHT = new THREE.CanvasTexture(c); WASHT.colorSpace = THREE.SRGBColorSpace; WASHT.userData.avShared = true; return WASHT; }
  function buildWashes(g, S) { var K = new Kit(), Fk = new Kit(); var wash = function (x, z, ry, w, h) { var nx = Math.sin(ry), nz = Math.cos(ry); var pg = new THREE.PlaneGeometry(w, h); K.place("wash", pg, 0xffffff, x + nx * 0.05, h / 2 + 0.02, z + nz * 0.05, ry); Fk.box("metal", 0x1c1d1f, 0.22, 0.08, 0.14, x + nx * 0.16, 0.04, z + nz * 0.16, ry); Fk.box("glow", 0xffe2b0, 0.16, 0.012, 0.08, x + nx * 0.16, 0.085, z + nz * 0.16, ry); };
    S.blocks.forEach(function (b) { if (b.id === "lobby") return; var n = Math.max(2, Math.round(b.w / 3.2)); for (var i = 0; i < n; i++) { var x = b.x0 + (i + 0.5) * b.w / n; wash(x, b.z1, 0, 2.6, Math.min(4.2, b.h * 0.6)); if (i % 2 === 0) wash(x, b.z0, PI, 2.6, Math.min(3.6, b.h * 0.5)); } });
    var L0 = S.blocks[0]; [-1, 1].forEach(function (sd) { wash(L0.x1, S.zc + sd * 3.6, PI / 2, 2.2, 4.0); });
    var M = mats(); EX.washMat = basic({ map: washTex(), color: 0xffffff, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: true }); EX.washMat.userData.noShadow = true;
    var wm = K.build(g, { wash: EX.washMat }, {}); EX.wash = wm[0] || null; if (EX.wash) { EX.wash.renderOrder = 3; EX.wash.visible = false; } Fk.build(g, { metal: M.metal, glow: M.glow }, { cast: false });
    // the Lobby from afar at night: a warm plane behind the curtain wall while the rooms are not built
    var lg = withColor(new THREE.PlaneGeometry(L0.w - 2.6, L0.h - 1.8)); var lm = new THREE.Mesh(lg, M.lantern); lm.position.set(L0.cx, (L0.h - 1.6) / 2, L0.z1 - S.T - 0.3); lm.name = "cm lobby glow"; lm.visible = false; g.add(lm); EX.lobbyGlow = lm; }
  // the chain line as a path for the pulse: along the south-east parapet tops of the blocks and the links, NE to SW
  function chainPath() { var S = SITE, pts = []; S.blocks.forEach(function (b, i) { pts.push([b.x1, b.h + 0.075, b.z1 - 0.06]); pts.push([b.x0, b.h + 0.075, b.z1 - 0.06]); var k = S.links[i]; if (k) { pts.push([k.x1, S.LH + 0.075, S.zc + S.LW / 2 + 0.2]); pts.push([k.x0, S.LH + 0.075, S.zc + S.LW / 2 + 0.2]); } }); var L = 0; for (var j = 1; j < pts.length; j++) L += Math.abs(pts[j][0] - pts[j - 1][0]); return { pts: pts, L: L }; }
  function pulseAt(d) { var P = EX.chainPath.pts, acc = 0; for (var j = 1; j < P.length; j++) { var seg = Math.abs(P[j][0] - P[j - 1][0]); if (acc + seg >= d) { var t = seg > 0 ? (d - acc) / seg : 0; return [lerp(P[j - 1][0], P[j][0], t), P[j - 1][1], P[j - 1][2]]; } acc += seg; } var q = P[P.length - 1]; return [q[0], q[1], q[2]]; }

  // photovoltaic rows on a gallery roof: tilted 22 degrees toward true south (local -th), aluminium frames, low legs
  function solarRoof(K, b) { var S = SITE, a = -S.th, tilt = 0.38, pw = 1.0, pl = 1.5, y0 = b.h - 0.08, nx = Math.sin(a), nz = Math.cos(a);
    var rows = [], ix0 = b.x0 + 1.0, ix1 = b.x1 - 1.0, iz0 = b.z0 + 1.2, iz1 = b.z1 - 1.2; for (var u = ix0 + 0.9; u < ix1 - 0.6; u += 2.4) for (var v = iz0 + 0.7; v < iz1 - 0.4; v += 2.1) rows.push([u, v]);
    rows.forEach(function (q, i) { var x = q[0], z = q[1]; K.box("metal", 0x172030, pl, 0.035, pw, x, y0 + 0.42, z, a, 0, tilt); K.box("metal", 0xb9bec4, pl + 0.04, 0.045, 0.035, x + nx * (pw / 2) * Math.cos(tilt), y0 + 0.42 - (pw / 2) * Math.sin(tilt), z + nz * (pw / 2) * Math.cos(tilt), a);
      [-1, 1].forEach(function (sd) { var lx = x + Math.cos(a) * sd * (pl / 2 - 0.15), lz = z - Math.sin(a) * sd * (pl / 2 - 0.15); K.box("metal", 0x8a8f95, 0.05, 0.42, 0.05, lx - nx * 0.3, y0 + 0.21, lz - nz * 0.3, a); K.box("metal", 0x8a8f95, 0.05, 0.22, 0.05, lx + nx * 0.3, y0 + 0.11, lz + nz * 0.3, a); }); }); }
  // the Lobby's front: a glazed south-east facade, the entrance, a deep canopy on two columns with the museum's name, the logo on the north-east wall
  function buildLobbyFront(K, glowK, b, sol) { var S = SITE, T = S.T, x0 = b.x0, x1 = b.x1, z1 = b.z1, h = b.h, cx = b.cx, steel = 0x2b2d30, gw = x1 - x0 - 2.4, gh = h - 1.6, door = [cx - 2.1, cx + 2.1];
    // curtain wall: glass with mullions every 1.5 m and a transom at 3.1 m, open at the entrance
    var segs = [[x0 + 1.2, door[0]], [door[1], x1 - 1.2]]; segs.forEach(function (sg) { var L = sg[1] - sg[0]; K.box("glass", 0xd2e2e8, L, gh, 0.03, (sg[0] + sg[1]) / 2, gh / 2, z1 - T / 2); sol.push([(sg[0] + sg[1]) / 2, z1 - T / 2, L, 0.2, 0, gh, 0]); });
    K.box("glass", 0xd2e2e8, door[1] - door[0], gh - 3.1, 0.03, cx, 3.1 + (gh - 3.1) / 2, z1 - T / 2);
    for (var mx = x0 + 1.2; mx <= x1 - 1.2 + 1e-3; mx += gw / Math.round(gw / 1.5)) K.box("metal", steel, 0.08, gh, 0.16, mx, gh / 2, z1 - T / 2);
    K.box("metal", steel, gw, 0.1, 0.16, cx, 3.1, z1 - T / 2); K.box("metal", steel, gw, 0.12, 0.18, cx, gh, z1 - T / 2);
    // the two door leaves slid open to the sides (glass with a steel frame)
    [-1, 1].forEach(function (sd) { var dx = cx + sd * 2.95; K.box("glass", 0xd2e2e8, 1.9, 2.95, 0.03, dx, 1.5, z1 - T / 2 - 0.12); K.box("metal", steel, 1.95, 0.06, 0.06, dx, 2.98, z1 - T / 2 - 0.12); K.box("metal", steel, 0.04, 1.2, 0.06, dx - sd * 0.85, 1.05, z1 - T / 2 - 0.2); });
    // canopy: a thin cantilevered slab 6.5 m deep on two slender columns, downlights, the name on its fascia
    var cd = 6.5, cw = b.w + 3, cy = 5.0; K.box("conc", 0xf4ece0, cw, 0.36, cd, cx, cy + 0.18, z1 + cd / 2 - 0.2, 0, 2.4); K.box("paint", 0x8f887d, cw - 0.3, 0.03, cd - 0.3, cx, cy + 0.375, z1 + cd / 2 - 0.2, 0); [[cw + 0.04, 0.06, 0.06, 0, -cd / 2], [cw + 0.04, 0.06, 0.06, 0, cd / 2], [0.06, 0.06, cd + 0.04, -cw / 2, 0], [0.06, 0.06, cd + 0.04, cw / 2, 0]].forEach(function (e) { K.box("metal", 0x1c1d1f, e[0], e[1], e[2], cx + e[3], cy + 0.39, z1 + cd / 2 - 0.2 + e[4], 0); });
    [-1, 1].forEach(function (sd) { var px = cx + sd * (cw / 2 - 1.4), pz = z1 + cd - 1.0; K.cyl("metal", 0x2b2d30, 0.11, 0.13, cy, px, cy / 2, pz, 14); K.cyl("basalt", 0xffffff, 0.3, 0.3, 0.24, px, 0.12, pz, 14); sol.push([px, pz, 0.36, 0.36, 0, cy, 0]); });
    for (var i = 0; i < 5; i++) for (var j = 0; j < 2; j++) glowK.cyl("glow", 0xfff0d8, 0.16, 0.16, 0.02, cx - 6 + i * 3, cy - 0.005, z1 + 1.6 + j * 2.8, 16);
    letterPlane(K, 0, 0.62, cx, cy + 0.18, z1 + cd - 0.2 + 0.02, 0, 0xc0905a);
    // the GIVEBACK logo on the north-east end wall (2:1, sized by height), and the museum's name over it
    // the GIVEBACK logo (2:1, sized by height) on dark basalt panels: the north-east end wall, the plaza fascia over the canopy, the totem
    var lh = 2.4; K.box("basalt", 0x9a9a9a, 0.06, lh + 0.5, lh * 2 + 0.6, x1 + 0.03, h * 0.5, S.zc, 0, 2.0); K.box("basalt", 0x9a9a9a, 2.9, 1.2, 0.06, cx, h - 0.82, z1 + 0.03, 0, 2.0);
    EX.logos = [[x1 + 0.065, h * 0.5, S.zc, PI / 2, lh], [cx, h - 0.82, z1 + 0.065, 0, 1.05], [40.2 + 0.262, 1.9, 48.8, PI / 2, 0.5], [40.2 - 0.262, 1.9, 48.8, -PI / 2, 0.5]];
    letterPlane(K, 10, 0.42, x1 + 0.02, h * 0.5 + lh / 2 + 0.55, S.zc, PI / 2, 0xb88350); }
  var LOGO = null;
  function logoMat() { if (LOGO) return LOGO; try { var t = new THREE.TextureLoader().load(au("/tex/cm_logo.png?v=" + (window.BUILD || "dev"))); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso(); t.userData.avShared = true; LOGO = basic({ map: t, transparent: true, vertexColors: true, depthWrite: true, color: 0xf2f2f2, toneMapped: true }); LOGO.userData.noShadow = true; } catch (e) { note("logo", e); } return LOGO; }

  // ───────── the grounds: Genesis Plaza, the Genesis Stone, planters, benches, the totem, the walk and its years, the exit terrace, the cart bays ─────────
  function bench(K, x, z, ry, len, sol, face) { var c = Math.cos(ry), s = Math.sin(ry), P = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; };
    [-1, 1].forEach(function (sd) { var p = P(sd * (len / 2 - 0.35), 0); K.box("conc", 0xe9e1d3, 0.36, 0.42, 0.5, p[0], 0.21, p[1], ry, 1.2); });
    for (var i = 0; i < 4; i++) { var p2 = P(0, -0.18 + i * 0.12); K.box("wood", 0xd9b48a, len, 0.05, 0.1, p2[0], 0.445, p2[1], ry, 1.2); }
    if (sol) sol.push([x, z, len, 0.55, 0, 0.47, ry, true, face]); }
  function buildGrounds(K, glowK, sol) { var S = SITE, zc = S.zc, P = S.plaza, y = 0.008;
    // Genesis Plaza: honed travertine with a basalt border, a bronze line from the path to the doors
    flatQuad(K, "trav", 0xd9c8ae, [[P[0], P[1]], [P[2], P[1]], [P[2], P[3]], [P[0], P[3]]], y, 2.4);
    [[P[0], P[1], P[2], P[1] + 0.6], [P[0], P[3] - 0.6, P[2], P[3]], [P[0], P[1], P[0] + 0.6, P[3]], [P[2] - 0.6, P[1], P[2], P[3]]].forEach(function (r) { K.box("basalt", 0xffffff, r[2] - r[0], 0.06, r[3] - r[1], (r[0] + r[2]) / 2, y + 0.005, (r[1] + r[3]) / 2, 0, 2.0); });
    var L0 = S.blocks[0]; var a = [S.path[2][0] + 0.4, P[3] - 0.6], bq = [L0.cx, L0.z1 + 0.3]; var dx = bq[0] - a[0], dz = bq[1] - a[1], dl = Math.hypot(dx, dz);
    for (var bt = 0.12; bt < 0.95; bt += 0.11) { var bxx2 = a[0] + dx * bt, bzz2 = a[1] + dz * bt, ang2 = Math.atan2(dx, dz); [[0.5, 0.04, 0, 0.23], [0.5, 0.04, 0, -0.23], [0.04, 0.5, 0.23, 0], [0.04, 0.5, -0.23, 0]].forEach(function (e) { var ox = e[2] * Math.cos(ang2) + e[3] * Math.sin(ang2), oz = -e[2] * Math.sin(ang2) + e[3] * Math.cos(ang2); K.box("metal", 0xb07a48, e[0], 0.012, e[1], bxx2 + ox, y + 0.004, bzz2 + oz, ang2); }); } K.box("metal", 0xb07a48, 0.16, 0.012, dl, (a[0] + bq[0]) / 2, y + 0.004, (a[1] + bq[1]) / 2, Math.atan2(dx, dz)); glowK.box("glow", 0x4dde6f, 0.05, 0.01, dl, (a[0] + bq[0]) / 2, y + 0.012, (a[1] + bq[1]) / 2, Math.atan2(dx, dz));
    // the Genesis Stone: a 2.2 m basalt cube on a plinth, the block 0 hash in bronze round its four faces, uplit at night
    var st = S.stone, cs = 2.2; K.box("basalt", 0xffffff, 3.4, 0.45, 3.4, st[0], 0.225, st[1], 0, 2.0); K.box("basalt", 0xe8e8e8, cs, cs, cs, st[0], 0.45 + cs / 2, st[1], 0, 2.0);
    for (var f = 0; f < 4; f++) { var ang = f * PI / 2, nx = Math.sin(ang), nz = Math.cos(ang); K.plane("letters", 0xd8a868, cs * 0.92, cs * 0.92 / 8, st[0] + nx * (cs / 2 + 0.012), 0.45 + cs * 0.62, st[1] + nz * (cs / 2 + 0.012), ang, 0, stripUV(11 + f)); }
    sol.push([st[0], st[1], 3.4, 3.4, 0, 0.45 + cs, 0]); glowK.box("glow", 0xffc070, 3.0, 0.02, 0.05, st[0], 0.46, st[1] + 1.66, 0); glowK.box("glow", 0xffc070, 3.0, 0.02, 0.05, st[0], 0.46, st[1] - 1.66, 0);
    // benches round the stone and along the plaza
    [[st[0], st[1] + 4.8, PI, PI], [st[0] - 4.8, st[1], PI / 2, -PI / 2 + PI], [st[0] + 4.8, st[1], -PI / 2, PI / 2 + PI]].forEach(function (q) { bench(K, q[0], q[1], q[2], 2.4, sol, yawW(q[3])); });
    // planters under the four shade trees (the trees are engine instances)
    [[41.5, 14.2], [68.5, 14.2], [41.5, 33.6], [68.5, 33.6]].forEach(function (q) { K.box("conc", 0xe6ddcf, 2.8, 0.5, 2.8, q[0], 0.25, q[1], 0, 1.2); K.box("paint", 0x6b4a33, 2.5, 0.02, 2.5, q[0], 0.505, q[1], 0); sol.push([q[0], q[1], 2.8, 2.8, 0, 0.5, 0]); });
    // the totem at the path's mouth: basalt, the name in bronze both sides, the GIVEBACK logo
    var tx = 40.2, tz = 48.8; K.box("basalt", 0xffffff, 0.5, 3.4, 1.3, tx, 1.7, tz, 0, 2.0); K.box("metal", 0x1c1d1f, 0.56, 0.06, 1.36, tx, 3.43, tz, 0);
    [-1, 1].forEach(function (sd) { K.plane("letters", 0xc8925a, 1.2, 0.15, tx + sd * 0.26, 2.75, tz, sd * PI / 2, 0, stripUV(10)); }); sol.push([tx, tz, 0.6, 1.4, 0, 3.4, 0]);
    // the wayfinding monolith on Hangar Road, where the path turns in (on the natural grade)
    var mx = 39.0, mz = 81.5, my = gAt(mx, mz); K.box("basalt", 0xffffff, 0.45, 2.6, 1.1, mx, my + 1.3, mz, 0, 2.0); K.box("metal", 0x1c1d1f, 0.5, 0.05, 1.15, mx, my + 2.625, mz, 0);
    [-1, 1].forEach(function (sd) { K.plane("letters", 0xc8925a, 1.0, 0.125, mx + sd * 0.232, my + 2.15, mz, sd * PI / 2, 0, stripUV(10)); }); sol.push([mx, mz, 0.5, 1.2, my, my + 2.6, 0]);
    EX.logos2 = [[mx + 0.232, my + 1.55, mz, PI / 2, 0.42], [mx - 0.232, my + 1.55, mz, -PI / 2, 0.42]];
    // the Timeline Walk (travertine, flush) with bronze years, and the connector and exit terrace at Gallery 8's south-west door
    var wz0 = S.walkZ - S.walkW / 2, wz1 = S.walkZ + S.walkW / 2, wx0 = S.exitT[0], wx1 = P[0];
    flatQuad(K, "trav", 0xd6c4a8, [[wx0, wz0], [wx1, wz0], [wx1, wz1], [wx0, wz1]], y, 2.4);
    flatQuad(K, "trav", 0xd6c4a8, [[-54.4, S.exitT[3]], [-50.8, S.exitT[3]], [-50.8, wz0], [-54.4, wz0]], y, 2.4);
    var E = S.exitT; flatQuad(K, "trav", 0xd9c8ae, [[E[0], E[1]], [E[2], E[1]], [E[2], E[3]], [E[0], E[3]]], y, 2.4);
    [[wx0, wz0 - 0.15, wx1, wz0], [wx0, wz1, wx1, wz1 + 0.15]].forEach(function (r) { K.box("basalt", 0xffffff, r[2] - r[0], 0.05, 0.15, (r[0] + r[2]) / 2, y + 0.006, (r[1] + r[3]) / 2, 0, 2.0); });
    var yrs = C("walkYears", []) || []; var span = (wx1 - 2) - (wx0 + 4); yrs.forEach(function (yr, i) { var px = (wx1 - 2) - span * (i / Math.max(1, yrs.length - 1)); K.plane("plates", 0xffffff, 0.84, 0.42, px, y + 0.008, S.walkZ, PI / 2, -PI / 2, plateUV(i)); });
    for (var bxx = wx0 + 10; bxx < wx1 - 4; bxx += 19) bench(K, bxx, wz1 + 1.1, PI, 2.4, sol, yawW(PI));
    // beds between the chain and the walk: dark decomposed granite mulch with a steel edge
    flatQuad(K, "terr", 0x8a6a4e, [[S.x0, zc + 6.3], [P[0], zc + 6.3], [P[0], wz0 - 0.2], [S.x0, wz0 - 0.2]], y - 0.005, 3);
    K.box("metal", 0x3a2a20, P[0] - S.x0, 0.06, 0.04, (S.x0 + P[0]) / 2, y + 0.02, wz0 - 0.22, 0);
    // the runway side: a gravel apron with a steel edge
    flatQuad(K, "terr", 0xb59a78, [[S.x0 - 1, zc - 7.2], [S.x1 + 1, zc - 7.2], [S.x1 + 1, zc - 10.0], [S.x0 - 1, zc - 10.0]], y - 0.005, 3);
    // the golf-cart bays: a draped pad of decomposed granite with painted lines and a small sign
    var cb = [42.0, 39.6, 56.0, 46.4]; drapeQuad(K, "terr", 0xd9c09a, cb, 0.05, 3); for (var i = 0; i <= 4; i++) { var lx = 43.05 + i * 2.9; var gy = gAt(lx, 43.0) + 0.07; K.box("paint", 0xf2efe8, 0.1, 0.01, 4.6, lx, gy, 43.0, 0); }
    K.box("metal", 0x2b2d30, 0.06, 1.6, 0.06, 41.6, gAt(41.6, 40.0) + 0.8, 40.0, 0); K.box("paint", 0x1f4f2e, 0.7, 0.45, 0.04, 41.6, gAt(41.6, 40.0) + 1.45, 40.0, 0); }
  // terrain-following quad (the cart bays sit on the natural grade): a grid every 2 m at ground + lift, y relative to the pad
  function gAt(lx, lz) { var w = l2w(lx, lz); return getH(w[0], w[1]) - SITE.G; }
  function drapeQuad(K, b, col, r, lift, t) { var nx = Math.max(1, Math.ceil((r[2] - r[0]) / 2)), nz = Math.max(1, Math.ceil((r[3] - r[1]) / 2)), P = [], U = [], Nn = [];
    var vx = function (i) { return r[0] + (r[2] - r[0]) * i / nx; }, vz = function (j) { return r[1] + (r[3] - r[1]) * j / nz; };
    for (var i = 0; i < nx; i++) for (var j = 0; j < nz; j++) { var q = [[vx(i), vz(j)], [vx(i), vz(j + 1)], [vx(i + 1), vz(j)], [vx(i + 1), vz(j)], [vx(i), vz(j + 1)], [vx(i + 1), vz(j + 1)]]; q.forEach(function (p) { P.push(p[0], gAt(p[0], p[1]) + lift, p[1]); U.push(p[0] / t, -p[1] / t); Nn.push(0, 1, 0); }); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.setAttribute("normal", new THREE.Float32BufferAttribute(Nn, 3)); return K.add(b, g, col); }

  // ───────────────────────── the panel atlases, drawn from plan/chainmuseum.json (a few slots a step) ─────────────────────────
  // A: 4096 x 2048 on ultra and high (2048 x 1024 on medium, low and mobile): 12 x 4 slots of 340 x 460 (a panel is 1.7 x 2.3 m, 200 px a metre).
  //   0..2 the Lobby, 3 + 4i + j gallery i panel j, 35 + i gallery i title.
  // B: 1360 x 920 (half on medium and low): 4 x 2 object slots: 0 clay tablet, 1 ledger pages, 2 the 1990s screen (top 268 px), 3 the proof of
  //   work board, 4 contract code, 5 the whitepaper, 6 the deed, 7 spare
  var AT = CM.atlas = CM.atlas || null;
  function slotUV(i) { var c = i % 12, r = (i / 12) | 0; var u0 = (c * 340) / 4096, u1 = ((c + 1) * 340) / 4096, v1 = 1 - (r * 460) / 2048, v0 = 1 - ((r + 1) * 460) / 2048; return [u0, v0, u1, v1]; }
  function slotUVB(i) { var c = i % 4, r = (i / 4) | 0; return [c / 4, 1 - (r + 1) / 2, (c + 1) / 4, 1 - r / 2]; }
  function subUV(uv, f0, f1) { var h = uv[3] - uv[1]; return [uv[0], uv[3] - h * f1, uv[2], uv[3] - h * f0]; }
  function wrapText(x, text, maxW) { var words = String(text || "").split(/\s+/), lines = [], cur = ""; words.forEach(function (w) { var t = cur ? cur + " " + w : w; if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }); if (cur) lines.push(cur); return lines; }
  function hexA(h, a) { var c = new THREE.Color(h); return "rgba(" + Math.round(c.r * 255) + "," + Math.round(c.g * 255) + "," + Math.round(c.b * 255) + "," + a + ")"; }
  function hiAtlas() { return tierN() >= 2 && !mobile(); }
  function newAtlas() { var sc0 = hiAtlas() ? 0.5 : 0.25; var mk = function (w, h, sc) { var cv = document.createElement("canvas"); cv.width = Math.round(w * sc); cv.height = Math.round(h * sc); var x = cv.getContext("2d"); x.scale(sc, sc); x.fillStyle = "#101315"; x.fillRect(0, 0, w, h); var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso(); t.userData.avShared = true; return { cv: cv, x: x, t: t }; };
    var A = mk(4096, 2048, sc0), B = mk(1360, 920, hiAtlas() ? 1 : 0.5);   // A is the far copy of every panel (the near layer takes over in the room you are in)
    var self = basic({ map: A.t, color: 0xd9d9d9, vertexColors: true, transparent: true, toneMapped: true }); self.userData.noShadow = true;
    var bself = basic({ map: B.t, color: 0xd9d9d9, vertexColors: true, transparent: true, toneMapped: true }); bself.userData.noShadow = true;
    var blit = std({ map: B.t, normalMap: flatN(), roughnessMap: flatR(), color: 0xffffff, vertexColors: true, roughness: 0.8, metalness: 0 });
    return { A: A, B: B, self: self, bself: bself, blit: blit, done: {}, doneB: {}, n: 0 }; }
  // draw the next few slots (A then B); true when everything is drawn
  function atlasStep(At, budgetMs) { var t0 = nowMs(), any = false; for (var i = 0; i < 43; i++) { if (At.done[i]) continue; drawSlot(At, i); any = true; if (nowMs() - t0 > budgetMs) break; }
    if (nowMs() - t0 <= budgetMs) for (var j = 0; j < 7; j++) { if (At.doneB[j]) continue; drawSlotB(At, j); any = true; if (nowMs() - t0 > budgetMs) break; }
    var full = Object.keys(At.done).length >= 43 && Object.keys(At.doneB).length >= 7; if (full) { At.A.t.needsUpdate = true; At.B.t.needsUpdate = true; } return full; }   // one upload each, when complete
  function drawSlot(At, i) { var x = At.A.x, c = i % 12, r = (i / 12) | 0, X = c * 340, Y = r * 460; x.save(); x.beginPath(); x.rect(X, Y, 340, 460); x.clip(); x.translate(X, Y);
    try { var G = C("galleries", []) || [];
      if (i <= 2) panel(x, (C("lobby.panels", []) || [])[i], "#4dde6f", "THE GENESIS BLOCK MUSEUM");
      else if (i <= 34) { var gi = ((i - 3) / 4) | 0, pj = (i - 3) % 4, g = G[gi]; if (g) panel(x, g.panels[pj], g.accent, "GALLERY " + g.n + "  \u00b7  " + g.year); }
      else { var g2 = G[i - 35]; if (g2) titlePanel(x, g2); }
    } catch (e) { note("slot " + i, e); } x.restore(); At.done[i] = true; At.n++; }
  // the near layer: two canvases (one on medium and low) given to the room the camera is in and its nearest neighbour, a slot a frame
  function newNear() { var hi = hiAtlas(), n = hi ? 2 : 1, out = []; for (var i = 0; i < n; i++) { var cv = document.createElement("canvas"); cv.width = hi ? 2048 : 1024; cv.height = cv.width / 2; var x = cv.getContext("2d"); var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso(); t.userData.avShared = true; t.userData.cmKeep = true; out.push({ cv: cv, x: x, t: t, sc: cv.width / 1360, bi: -1, k: 0, ready: false }); } return out; }
  function drawNearSlot(N, slots, k) { var x = N.x, sc = N.sc; x.save(); x.setTransform(sc, 0, 0, sc, k * 340 * sc, 0); x.beginPath(); x.rect(0, 0, 340, 460); x.clip();
    try { var i = slots[k], G = C("galleries", []) || []; if (i <= 2) panel(x, (C("lobby.panels", []) || [])[i], "#4dde6f", "THE GENESIS BLOCK MUSEUM"); else if (i <= 34) { var gi = ((i - 3) / 4) | 0, pj = (i - 3) % 4, g = G[gi]; if (g) panel(x, g.panels[pj], g.accent, "GALLERY " + g.n + "  \u00b7  " + g.year); } else { var g2 = G[i - 35]; if (g2) titlePanel(x, g2); } } catch (e) { note("near slot", e); } x.restore(); }
  function drawSlotB(At, i) { var x = At.B.x, c = i % 4, r = (i / 4) | 0, X = c * 340, Y = r * 460; x.save(); x.beginPath(); x.rect(X, Y, 340, 460); x.clip(); x.translate(X, Y);
    try { [tabletTex, ledgerTex, crtTex, hashBoard, codeTex, paperTex, deedTex][i](x); } catch (e) { note("slotB " + i, e); } x.restore(); At.doneB[i] = true; }
  function panel(x, d, accent, foot) { if (!d) return; var W = 340, Hh = 460; var gr = x.createLinearGradient(0, 0, 0, Hh); gr.addColorStop(0, "#1a1f21"); gr.addColorStop(1, "#0f1214"); x.fillStyle = gr; x.fillRect(0, 0, W, Hh);
    x.fillStyle = accent || "#4dde6f"; x.fillRect(0, 0, W, 7); x.fillRect(20, 20, 4, 54);
    x.fillStyle = accent || "#4dde6f"; x.textBaseline = "top"; var k = String(d.k || "").toUpperCase(), fk = 15; x.font = "600 " + fk + "px " + FONT; while (x.measureText(k).width > W - 50 && fk > 10) { fk -= 0.5; x.font = "600 " + fk + "px " + FONT; } x.fillText(k, 34, 22);
    x.fillStyle = "#f4ecdc"; x.font = "600 29px " + FONT; var tl = wrapText(x, d.t, W - 54); tl.slice(0, 2).forEach(function (l, j) { x.fillText(l, 34, 42 + j * 33); });
    var y0 = 42 + Math.min(2, tl.length) * 33 + 18; x.fillStyle = "rgba(244,236,220,0.18)"; x.fillRect(20, y0 - 9, W - 40, 1);
    x.fillStyle = "#e6dfcf"; x.font = "400 17px " + FONT; var bl = wrapText(x, d.p, W - 44); bl.slice(0, 14).forEach(function (l, j) { x.fillText(l, 22, y0 + j * 24); });
    x.fillStyle = "rgba(230,223,207,0.5)"; x.font = "600 12px " + FONT; x.fillText(foot || "", 22, Hh - 26); }
  function titlePanel(x, g) { var W = 340, Hh = 460; x.fillStyle = "#121618"; x.fillRect(0, 0, W, Hh); var a = g.accent || "#4dde6f";
    x.fillStyle = hexA(a, 0.12); x.fillRect(0, 0, W, Hh); x.fillStyle = a; x.fillRect(0, Hh - 10, W, 10);
    x.font = "400 210px " + DISP; x.textBaseline = "alphabetic"; x.fillStyle = a; x.fillText(String(g.n), 24, 220);
    x.fillStyle = "#f4ecdc"; x.font = "600 30px " + FONT; x.textBaseline = "top"; wrapText(x, g.title, W - 48).slice(0, 3).forEach(function (l, j) { x.fillText(l, 26, 248 + j * 35); });
    x.fillStyle = a; x.font = "600 17px " + FONT; x.fillText(String((g.info && g.info.k) || g.year).toUpperCase(), 26, 362);
    x.fillStyle = "rgba(244,236,220,0.55)"; x.font = "600 13px " + FONT; x.fillText("THE GENESIS BLOCK MUSEUM", 26, 410); }
  // printed objects (lit, on the replicas): a clay tablet face, a merchant's ledger spread, a 1990s terminal, a hash board, contract code
  function tabletTex(x) { var R = rng(3200); x.fillStyle = "#9c6b46"; x.fillRect(0, 0, 340, 460); for (var k = 0; k < 900; k++) { x.fillStyle = "rgba(" + (R() < 0.5 ? "60,36,20" : "200,160,120") + "," + (0.05 + R() * 0.08) + ")"; x.fillRect(R() * 340, R() * 460, 2 + R() * 5, 2 + R() * 5); }
    for (var row = 0; row < 15; row++) { var yy = 24 + row * 28; x.fillStyle = "rgba(50,28,14,0.45)"; x.fillRect(16, yy + 22, 308, 1.5); for (var c = 0; c < 9; c++) { if (R() < 0.18) continue; var xx = 22 + c * 34 + R() * 6; x.fillStyle = "rgba(48,26,12,0.75)"; x.beginPath(); x.moveTo(xx, yy + 4); x.lineTo(xx + 9 + R() * 6, yy + 7); x.lineTo(xx + 2, yy + 11); x.closePath(); x.fill(); if (R() < 0.6) { x.fillRect(xx + 3, yy + 9, 1.5, 9 + R() * 5); } if (R() < 0.4) { x.beginPath(); x.moveTo(xx + 12, yy + 3); x.lineTo(xx + 18, yy + 9); x.lineTo(xx + 12, yy + 12); x.closePath(); x.fill(); } } } }
  function ledgerTex(x) { var R = rng(1494); x.fillStyle = "#e8dcc0"; x.fillRect(0, 0, 340, 460); x.fillStyle = "rgba(120,90,50,0.12)"; for (var k = 0; k < 400; k++) x.fillRect(R() * 340, R() * 460, 1 + R() * 3, 1 + R() * 3);
    x.strokeStyle = "rgba(150,40,30,0.55)"; x.lineWidth = 1.2; [40, 236, 286].forEach(function (cx) { x.beginPath(); x.moveTo(cx, 18); x.lineTo(cx, 446); x.stroke(); });
    x.strokeStyle = "rgba(70,90,120,0.28)"; for (var y = 40; y < 450; y += 17) { x.beginPath(); x.moveTo(12, y); x.lineTo(328, y); x.stroke(); }
    x.fillStyle = "rgba(40,28,18,0.82)"; x.font = "italic 600 13px Georgia, 'Times New Roman', serif"; x.fillText("Per", 14, 34); x.fillText("A", 254, 34);
    for (var y2 = 54; y2 < 440; y2 += 17) { if (R() < 0.2) continue; var w = 60 + R() * 120; x.fillRect(48, y2 - 6, w, 1.6); if (R() < 0.6) x.fillRect(48 + w + 8, y2 - 6, 20 + R() * 30, 1.6); x.fillText(String(((R() * 90) | 0) + 10), 244, y2); x.fillText(String((R() * 12) | 0), 294, y2); } }
  function crtTex(x) { x.fillStyle = "#06120a"; x.fillRect(0, 0, 340, 268); x.fillStyle = "#5dff8a"; x.font = "600 14px " + MONO; x.textBaseline = "top";
    ["$ hashcash -m -b 20 cypher@list", "minting a stamp ...", "trying 0 ... 1048575", "found after 312,906 tries", "", "X-Hashcash: 970301:", "  cypher@list:8f2a1c1d4b", "", "SHA-1 of the stamp begins", "  00000 (20 zero bits)", "", "$ _"].forEach(function (l, j) { x.fillText(l, 14, 14 + j * 20); });
    for (var y = 0; y < 268; y += 3) { x.fillStyle = "rgba(0,0,0,0.22)"; x.fillRect(0, y, 340, 1); } var g = x.createRadialGradient(170, 134, 40, 170, 134, 230); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.55)"); x.fillStyle = g; x.fillRect(0, 0, 340, 268); }
  function hashBoard(x) { x.fillStyle = "#0d1012"; x.fillRect(0, 0, 340, 460); x.fillStyle = "#d18b4f"; x.font = "700 18px " + FONT; x.textBaseline = "top"; x.fillText("PROOF OF WORK", 20, 18); x.fillStyle = "rgba(230,223,207,0.7)"; x.font = "500 13px " + FONT; x.fillText("find a nonce: the hash must start with 000", 20, 44);
    var R = rng(97); x.font = "500 14px " + MONO; for (var j = 0; j < 14; j++) { var n = j < 13 ? j * 317 + ((R() * 300) | 0) : 4914; var h = ""; for (var q = 0; q < 14; q++) h += "0123456789abcdef"[(R() * 16) | 0]; if (j === 13) h = "000" + h.slice(3); x.fillStyle = j === 13 ? "#5dff8a" : "rgba(230,223,207,0.75)"; x.fillText("nonce " + String(n).padStart(5, " ") + "  " + h + "..", 20, 76 + j * 25); }
    x.fillStyle = "#5dff8a"; x.font = "700 15px " + FONT; x.fillText("found: hard to find, instant to check", 20, 432); }
  function codeTex(x) { x.fillStyle = "#0e0f1a"; x.fillRect(0, 0, 340, 460); x.textBaseline = "top"; x.fillStyle = "#8f8ff0"; x.font = "700 18px " + FONT; x.fillText("A CONTRACT IN PLAIN WORDS", 20, 18);
    var L = ["contract VendingMachine {", "  on pay(coins):", "    require coins == cost", "    deliver(item)", "    record(buyer, item, time)", "}", "", "contract GiftRoute {", "  recipient = verified", "  on gift(amount):", "    require signed(giver)", "    send(amount, recipient)", "    record(giver, recipient, time)", "}"];
    x.font = "500 14px " + MONO; L.forEach(function (l, j) { x.fillStyle = /contract|on |require/.test(l) ? "#b9b9ff" : "#e6dfcf"; x.fillText(l, 20, 56 + j * 24); }); x.fillStyle = "rgba(230,223,207,0.55)"; x.font = "500 12px " + FONT; x.fillText("everyone runs it, everyone agrees on the result", 20, 428); }

  function paperTex(x) { var R = rng(2008); x.fillStyle = "#f3efe6"; x.fillRect(0, 0, 340, 460); x.fillStyle = "#1d1d1d"; x.textAlign = "center"; x.textBaseline = "top";
    x.font = "600 17px Georgia, 'Times New Roman', serif"; x.fillText("Bitcoin: A Peer-to-Peer", 170, 30); x.fillText("Electronic Cash System", 170, 52); x.font = "400 12px Georgia, 'Times New Roman', serif"; x.fillText("Satoshi Nakamoto", 170, 84); x.fillText("31 October 2008", 170, 100);
    x.textAlign = "left"; x.fillStyle = "rgba(30,30,30,0.5)"; for (var j = 0; j < 7; j++) { var w = j === 6 ? 120 : 250 + R() * 20; x.fillRect(45, 128 + j * 10, w, 3); }
    for (var k = 0; k < 3; k++) { var bx = 30 + k * 100; x.strokeStyle = "#333"; x.lineWidth = 1.2; x.strokeRect(bx, 214, 82, 56); x.fillStyle = "#333"; x.font = "500 10px " + FONT; x.fillText("Block", bx + 26, 220); x.strokeRect(bx + 8, 236, 30, 12); x.strokeRect(bx + 44, 236, 30, 12); x.fillText("Prev", bx + 10, 254); x.fillText("Tx", bx + 54, 254); if (k < 2) { x.beginPath(); x.moveTo(bx + 82, 242); x.lineTo(bx + 108, 242); x.stroke(); } }
    x.fillStyle = "rgba(30,30,30,0.5)"; for (var j2 = 0; j2 < 12; j2++) { var w2 = j2 % 6 === 5 ? 90 : 245 + R() * 25; x.fillRect(45, 292 + j2 * 11, w2, 3); }
    x.fillStyle = "rgba(30,30,30,0.6)"; x.font = "400 10px " + FONT; x.textAlign = "center"; x.fillText("1", 170, 440); }
  function deedTex(x) { var R = rng(1928); x.fillStyle = "#efe6cf"; x.fillRect(0, 0, 340, 460); x.strokeStyle = "#8a6a3a"; x.lineWidth = 3; x.strokeRect(12, 12, 316, 436); x.lineWidth = 1; x.strokeRect(18, 18, 304, 424);
    x.fillStyle = "#3a2a18"; x.textAlign = "center"; x.textBaseline = "top"; x.font = "600 20px Georgia, 'Times New Roman', serif"; x.fillText("DEED OF RECORD", 170, 40); x.font = "400 12px Georgia, 'Times New Roman', serif"; x.fillText("A specimen, for display", 170, 70);
    x.fillStyle = "rgba(58,42,24,0.45)"; for (var j = 0; j < 12; j++) x.fillRect(40, 100 + j * 13, 230 + R() * 30, 3);
    x.fillStyle = "#1d2a22"; x.fillRect(40, 286, 120, 120); x.fillStyle = "#efe6cf"; for (var a = 0; a < 12; a++) for (var b = 0; b < 12; b++) if (R() < 0.5 || (a < 3 && b < 3) || (a > 8 && b < 3) || (a < 3 && b > 8)) x.fillRect(46 + a * 9, 292 + b * 9, 8, 8);
    x.fillStyle = "#3a2a18"; x.textAlign = "left"; x.font = "500 11px " + MONO; x.fillText("TOKEN RECORD", 175, 296); x.fillText("4dde...6f0a", 175, 314); x.font = "400 11px " + FONT; x.fillText("the ledger keeps", 175, 340); x.fillText("the record;", 175, 354); x.fillText("the law decides", 175, 368); x.fillText("what it means", 175, 382);
    x.fillStyle = "#9a2a20"; x.beginPath(); x.arc(270, 410, 22, 0, TAU); x.fill(); x.fillStyle = "#c84a3a"; x.beginPath(); x.arc(270, 410, 14, 0, TAU); x.fill(); }

  // ───────────────────────── live canvases: Block Zero's walls and show, the kiosk screen, the proof of history display, the ledger wall, the map ─────────────────────────
  function liveTex(w, h) { var cv = document.createElement("canvas"); cv.width = w; cv.height = h; var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.userData.avShared = true; return { cv: cv, x: cv.getContext("2d"), t: t }; }
  function hexRain(lo) { var s = lo ? 256 : 512, L = liveTex(s, s), x = L.x, R = rng(9); x.fillStyle = "#2a1506"; x.fillRect(0, 0, s, s); var gr0 = x.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s * 0.7); gr0.addColorStop(0, "rgba(255,170,60,0.55)"); gr0.addColorStop(1, "rgba(120,50,10,0)"); x.fillStyle = gr0; x.fillRect(0, 0, s, s); var cell = s / 32; x.font = "600 " + Math.round(cell * 0.82) + "px " + MONO; x.textAlign = "center"; x.textBaseline = "middle";
    for (var c = 0; c < 32; c++) { var head = R() * 32, len = 6 + R() * 16; for (var r = 0; r < 32; r++) { var d = ((head - r) + 32) % 32, k = d < len ? 1 - d / len : 0; var a = 0.28 + k * 0.72; x.fillStyle = d < 0.9 ? "rgba(255,236,190," + a + ")" : "rgba(255,176,70," + a + ")"; x.fillText("0123456789abcdef"[(R() * 16) | 0], c * cell + cell / 2, r * cell + cell / 2); } }
    L.t.wrapS = L.t.wrapT = THREE.RepeatWrapping; L.t.generateMipmaps = true; L.t.minFilter = THREE.LinearMipmapLinearFilter; L.t.needsUpdate = true; return L; }
  function drawShow(L, cap, k) { var x = L.x, w = L.cv.width, h = L.cv.height; x.clearRect(0, 0, w, h); x.fillStyle = "rgba(5,6,7,0.0)"; x.fillRect(0, 0, w, h); if (!cap) { L.t.needsUpdate = true; return; }
    x.globalAlpha = k; x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "#f2a33a"; var f0 = Math.round(h * 0.15); x.font = "600 " + f0 + "px " + FONT; while (x.measureText(cap[0]).width > w * 0.92 && f0 > 10) { f0 -= 2; x.font = "600 " + f0 + "px " + FONT; } x.fillText(cap[0], w / 2, h * 0.3);
    var t = cap[1], mono = /^[0-9a-f]{20,}$/.test(t); x.fillStyle = "#fbe7c4"; var fs = Math.round(h * (mono ? 0.12 : 0.2)); x.font = (mono ? "600 " : "500 ") + fs + "px " + (mono ? MONO : FONT); var mw = w * 0.94; while (x.measureText(t).width > mw && fs > 10) { fs -= 2; x.font = (mono ? "600 " : "500 ") + fs + "px " + (mono ? MONO : FONT); } x.fillText(t, w / 2, h * 0.66); x.globalAlpha = 1; L.t.needsUpdate = true; }

  // ───────────────────────── the interior: nine rooms and eight links, built near (time sliced), solids registered once at load ─────────────────────────
  var IN = CM.inn = CM.inn || { L: null, sb: null, solidsDone: false };
  var R_BUILD = 170, R_DROP = 280;
  function accentOf(i) { var g = (C("galleries", []) || [])[i]; return g && g.accent ? g.accent : "#4dde6f"; }
  // a panel: a dark frame and the printed face (self-lit atlas plane), 1.7 x 2.3 m, its foot at y0; (x, z) on the wall face, ry the facing
  function hrUV(k) { return [k / 4, 1 - 460 / 680, (k + 1) / 4, 1]; }   // the near canvas: four slots of 340 x 460 (x 1.5) side by side, 2048 x 1024
  function nearPlane(L, slot, w, h, x, y, z, ry) { var bi = L.bi, k = (L.hrK[bi] = (L.hrK[bi] || 0)); var c = Math.sin(ry), s = Math.cos(ry); (L.H[bi] || (L.H[bi] = L.dry ? dryKit() : new Kit())).plane("near", 0xffffff, w, h, x + c * 0.004, y, z + s * 0.004, ry, 0, hrUV(k)); (L.hrSlots[bi] = L.hrSlots[bi] || []).push(slot); L.hrK[bi] = k + 1; }
  function panelAt(L, slot, x, z, ry, y0, sc) { sc = sc || 1; var K = L.K, w = 1.7 * sc, h = 2.3 * sc, c = Math.sin(ry), s = Math.cos(ry);
    K.box("metal", 0x15171a, w + 0.1, h + 0.1, 0.05, x - c * 0.0, y0 + h / 2, z - s * 0.0, ry); L.A.plane("atlas", 0xffffff, w, h, x + c * 0.03, y0 + h / 2, z + s * 0.03, ry, 0, slotUV(slot)); nearPlane(L, slot, w, h, x + c * 0.03, y0 + h / 2, z + s * 0.03, ry);
    L.pools.push([x + c * 0.9, z + s * 0.9, 1.15, 0.12]); }
  function objPlane(L, kit, slot, w, h, x, y, z, ry, rx) { L[kit].plane(kit === "B" ? "atlasB" : "atlasBs", 0xffffff, w, h, x, y, z, ry, rx || 0, slotUVB(slot)); }
  function bench2(L, x, z, ry, len, faceL) { var K = L.K, c = Math.cos(ry), s = Math.sin(ry), P = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; };
    [-1, 1].forEach(function (sd) { var p = P(sd * (len / 2 - 0.3), 0); K.box("metal", 0x1c1d1f, 0.08, 0.42, 0.46, p[0], 0.21, p[1], ry); });
    K.place("wood", rbox(len, 0.07, 0.5, 0.025, 1), 0xc9a27a, x, 0.455, z, ry); L.sol.push([x, z, len, 0.52, 0, 0.49, ry, true, yawW(faceL)]); aoPad(L, x, z, len + 0.5, 0.9, ry); }
  function trackLights(L, b, zs, nper) { var K = L.K, y = b.h - 0.75; zs.forEach(function (tz) { K.box("metal", 0x15171a, b.w - 1.4, 0.05, 0.06, b.cx, y, tz, 0); for (var i = 0; i < nper; i++) { var tx = b.x0 + 1.2 + (b.w - 2.4) * (i + 0.5) / nper; K.cyl("metal", 0x1c1d1f, 0.07, 0.09, 0.22, tx, y - 0.16, tz, 10); L.G.cyl("glow", 0xfff1da, 0.065, 0.065, 0.01, tx, y - 0.275, tz, 10); }
      K.tube("metal", 0x15171a, V3(b.cx - b.w * 0.3, y, tz), V3(b.cx - b.w * 0.3, b.h - 0.42, tz), 0.008, 3); K.tube("metal", 0x15171a, V3(b.cx + b.w * 0.3, y, tz), V3(b.cx + b.w * 0.3, b.h - 0.42, tz), 0.008, 3); }); }
  // the shell of a room: terrazzo, skirting, the dark exhibit lining with its accent line, the chain line in the floor, track lights, a title totem, 4 panels
  function roomShell(L, b, gi) { var S = SITE, T = S.T, K = L.K, G = L.G, ix0 = b.x0 + T, ix1 = b.x1 - T, iz0 = b.z0 + T, iz1 = b.z1 - T, zc = S.zc, acc = gi >= 0 ? accentOf(gi) : "#4dde6f", hero = b.id === "g4";
    L.strips.push([b.cx, iz0, ix1 - ix0, PI], [b.cx, iz1, ix1 - ix0, 0], [ix1, (iz0 + iz1) / 2, iz1 - iz0, PI / 2], [ix0, (iz0 + iz1) / 2, iz1 - iz0, -PI / 2]);
    flatQuad(K, "terr", hero ? 0x8f8a84 : 0xf1ebe0, [[ix0, iz0], [ix1, iz0], [ix1, gi < 0 ? b.z1 + 0.02 : iz1], [ix0, gi < 0 ? b.z1 + 0.02 : iz1]], 0.01, 3.0); if (b.id === "g8") flatQuad(K, "terr", 0xf1ebe0, [[b.x0 - 0.02, zc - S.DW / 2], [ix0, zc - S.DW / 2], [ix0, zc + S.DW / 2], [b.x0 - 0.02, zc + S.DW / 2]], 0.01, 3.0);
    [[ix0, ix1, iz0 + 0.02, 0], [ix0, ix1, iz1 - 0.02, 0]].forEach(function (q) { K.box("metal", 0x1a1b1d, q[1] - q[0], 0.1, 0.03, (q[0] + q[1]) / 2, 0.08, q[2], 0); });
    [ix0 + 0.02, ix1 - 0.02].forEach(function (qx) { K.box("metal", 0x1a1b1d, 0.03, 0.1, iz1 - iz0, qx, 0.08, (iz0 + iz1) / 2, 0); });
    if (!hero) [iz0 + 0.03, iz1 - 0.03].forEach(function (qz, k) { if (gi < 0 && k) return; K.box("paint", gi < 0 ? 0x2a2f2c : 0x24282b, ix1 - ix0 - 0.7, 3.3, 0.04, b.cx, 1.75, qz, 0); G.box("glow", acc, ix1 - ix0 - 0.7, 0.03, 0.03, b.cx, 3.42, qz + (k ? -0.03 : 0.03), 0); });
    // the chain line: a lit strip along the room's axis with chevrons toward the next block (-x)
    G.box("glow", 0x4dde6f, ix1 - ix0, 0.006, 0.05, b.cx, 0.015, zc, 0); for (var cxv = ix1 - 0.8; cxv > ix0 + 0.4; cxv -= 1.6) { [-1, 1].forEach(function (sd) { G.box("glow", 0x4dde6f, 0.22, 0.006, 0.035, cxv + 0.08, 0.015, zc + sd * 0.07, sd * 0.6); }); }
    trackLights(L, b, [zc - 3.2, zc + 3.2], 3);
    if (gi < 0) return;
    // the title totem just inside the entry (seen as you come through the door), double sided
    var tx = ix1 - 1.55, tz = zc + 2.75; K.box("basalt", 0xffffff, 0.22, 2.75, 1.86, tx, 1.375, tz, 0, 2.0); L.A.plane("atlas", 0xffffff, 1.7, 2.3, tx + 0.115, 1.5, tz, PI / 2, 0, slotUV(35 + gi)); L.A.plane("atlas", 0xffffff, 1.7, 2.3, tx - 0.115, 1.5, tz, -PI / 2, 0, slotUV(35 + gi)); L.sol.push([tx, tz, 0.3, 1.9, 0, 2.75, 0]);
    // the four panels (left wall first as you walk toward -x: the south-east wall is on your left)
    var px = [b.cx + 2.15, b.cx - 2.15]; panelAt(L, 3 + gi * 4 + 0, px[0], iz1 - 0.05, PI, 0.62); panelAt(L, 3 + gi * 4 + 1, px[0], iz0 + 0.05, 0, 0.62); panelAt(L, 3 + gi * 4 + 2, px[1], iz1 - 0.05, PI, 0.62); panelAt(L, 3 + gi * 4 + 3, px[1], iz0 + 0.05, 0, 0.62);
    L.panels.push({ gi: gi, j: 0, x: px[0], z: iz1 - 1.25 }, { gi: gi, j: 1, x: px[0], z: iz0 + 1.25 }, { gi: gi, j: 2, x: px[1], z: iz1 - 1.25 }, { gi: gi, j: 3, x: px[1], z: iz0 + 1.25 });
    // two warm pool lamps (sources for the client's pool)
    L.lamps.push(["point", 0xffe2bf, 4.2, 11, b.cx + 1.8, b.h - 1.2, zc - 1.5], ["point", 0xffe2bf, 4.2, 11, b.cx - 1.8, b.h - 1.2, zc + 1.5]); }
  function aoPad(L, x, z, w, d, ry) { L.ao.push([x, z, w, d, ry || 0]); }
  function plinth(L, x, z, w, d, h, col) { aoPad(L, x, z, w + 0.7, d + 0.7); L.K.box("paint", col || 0xece6dc, w, h, d, x, h / 2, z, 0); L.K.box("metal", 0x15171a, w + 0.01, 0.06, d + 0.01, x, 0.03, z, 0); L.sol.push([x, z, w, d, 0, h, 0]); }
  function vitrine(L, x, z, w, d, y0, h) { var K = L.K; K.box("glass", 0xe8f2f4, w, h, d, x, y0 + h / 2, z, 0); K.box("metal", 0x15171a, w + 0.02, 0.025, d + 0.02, x, y0 + h, z, 0); }

  // ───────── the rooms' contents ─────────
  function lobbyRoom(L, b) { var S = SITE, K = L.K, G = L.G, zc = S.zc, T = S.T, ix0 = b.x0 + T, ix1 = b.x1 - T, iz0 = b.z0 + T, iz1 = b.z1 - T;
    roomShell(L, b, -1);
    // the welcome desk (basalt top, oak front) with the docent behind it, the GIVEBACK logo on the wall behind
    var dx = 59.9, dz0 = 0.4, dz1 = 5.0, dl = dz1 - dz0; K.box("basalt", 0xffffff, 0.75, 1.0, dl, dx, 0.5, (dz0 + dz1) / 2, 0, 2.0); K.box("basalt", 0xffffff, 0.95, 0.06, dl + 0.12, dx, 1.03, (dz0 + dz1) / 2, 0, 2.0); G.box("glow", 0x4dde6f, 0.02, 0.03, dl - 0.2, dx - 0.39, 0.92, (dz0 + dz1) / 2, 0); L.sol.push([dx, (dz0 + dz1) / 2, 0.95, dl + 0.1, 0, 1.06, 0]); aoPad(L, dx, (dz0 + dz1) / 2, 1.6, dl + 0.7);
    L.docent = [61.3, 2.7, -PI / 2]; L.logoIn = [ix1 - 0.07, 4.9, zc, -PI / 2, 1.7]; K.box("basalt", 0x8a8a8a, 0.05, 2.3, 4.0, ix1 - 0.03, 4.9, zc, 0, 2.0);
    // the three welcome panels on the north-west wall
    [[52.2, 0], [55.3, 1], [58.4, 2]].forEach(function (q) { panelAt(L, q[1], q[0], iz0 + 0.05, 0, 0.62); L.panels.push({ gi: -1, j: q[1], x: q[0], z: iz0 + 1.25 }); });
    // the hanging chain: nine blocks in the galleries' colours on cables, a light that runs block to block
    var n = 9, y = 5.7; L.chain = []; for (var i = 0; i < n; i++) { var x = ix1 - 1.6 - i * ((ix1 - ix0 - 3.2) / (n - 1)), col = i === 0 ? 0xf4ecdc : accentOf(i - 1); K.box("metal", 0x15171a, 0.6, 0.6, 0.6, x, y, zc, 0); G.box("glow", col, 0.52, 0.52, 0.62, x, y, zc, 0); G.box("glow", col, 0.62, 0.52, 0.52, x, y, zc, 0); K.tube("metal", 0x15171a, V3(x, y + 0.3, zc), V3(x, b.h - 0.42, zc), 0.006, 3); L.chain.push(x);
      if (i < n - 1) { var x2 = ix1 - 1.6 - (i + 1) * ((ix1 - ix0 - 3.2) / (n - 1)); K.box("metal", 0x6a5a48, x - x2 - 0.6, 0.08, 0.08, (x + x2) / 2, y, zc, 0); } }
    // benches facing the glass and the plaza; a timeline band on the north-west wall above the panels
    bench2(L, 51.6, 8.7, 0, 2.4, 0); bench2(L, 61.0, 8.7, 0, 2.4, 0);
    L.mural = [ix0 + 0.045, 5.35, zc, PI / 2, 10.0, 3.333]; K.box("metal", 0x15171a, 0.04, 3.333 + 0.14, 10.14, ix0 + 0.02, 5.35, zc, 0); L.G.box("glow", 0xffe2b0, 0.03, 0.02, 9.6, ix0 + 0.06, 3.6, zc, 0);
    L.lamps.push(["spot", 0xffe6c8, 7, 16, 54.2, 7.7, zc, ix0, zc, 5.3]);
    L.lamps.push(["point", 0xffe6c8, 5, 14, 53, 6.6, 2.5], ["point", 0xffe6c8, 5, 14, 59.5, 6.6, 6.0]); }
  function g1Room(L, b) { var K = L.K, S = SITE, zc = S.zc, cx = b.cx; roomShell(L, b, 0);
    // clay tablets in a vitrine (replicas), a merchant's ledger on a lectern, a khipu in a tall case
    var vx = cx + 1.0, vz = zc + 3.1; plinth(L, vx, vz, 1.5, 0.8, 0.95); vitrine(L, vx, vz, 1.4, 0.7, 0.95, 0.55);
    [[-0.45, 0.12, 0.2], [-0.05, -0.1, -0.15], [0.35, 0.14, 0.35], [0.5, -0.16, -0.4]].forEach(function (q) { K.place("paint", rbox(0.22, 0.05, 0.3, 0.02, 1), 0x9c6b46, vx + q[0], 0.99, vz + q[1], q[2]); objPlane(L, "B", 0, 0.2, 0.28, vx + q[0], 1.017, vz + q[1], q[2], -PI / 2); });
    var lx = cx + 0.6, lz = zc - 3.0; K.box("metal", 0x1c1d1f, 0.12, 1.0, 0.12, lx, 0.5, lz, 0); K.box("wood", 0x6a4a30, 0.9, 0.05, 0.62, lx, 1.04, lz, 0, 1.2, 0.25); objPlane(L, "B", 1, 0.38, 0.52, lx - 0.2, 1.08, lz + 0.01, 0, -PI / 2 + 0.25); objPlane(L, "B", 1, 0.38, 0.52, lx + 0.2, 1.08, lz + 0.01, 0, -PI / 2 + 0.25); L.sol.push([lx, lz, 0.9, 0.7, 0, 1.1, 0]);
    var kx = cx - 2.4, kz = zc + 3.1; plinth(L, kx, kz, 0.9, 0.9, 0.4); vitrine(L, kx, kz, 0.85, 0.85, 0.4, 2.0); K.tube("wood", 0x7a5a3a, V3(kx - 0.36, 2.1, kz), V3(kx + 0.36, 2.1, kz), 0.018, 6);
    var R = rng(1450), cols = [0xc9a26a, 0xe8dcc0, 0x8a5a3a, 0xb58a50, 0x6a4a30, 0xd8c8a0]; for (var i = 0; i < 12; i++) { var cx2 = kx - 0.33 + i * 0.06, len = 0.7 + R() * 0.75, col = cols[(R() * cols.length) | 0]; K.tube("paint", col, V3(cx2, 2.1, kz), V3(cx2, 2.1 - len, kz + (R() - 0.5) * 0.06), 0.008, 4); for (var k = 0; k < 3; k++) K.sph("paint", col, 0.016, cx2, 2.1 - len * (0.3 + k * 0.22), kz, 6); }
    bench2(L, cx - 2.2, zc - 3.0, 0, 2.2, PI); }
  function g2Room(L, b) { var K = L.K, G = L.G, S = SITE, zc = S.zc, cx = b.cx; roomShell(L, b, 1);
    // the Merkle tree: eight leaves, their parents, one root, every branch a lit line
    var mx = cx + 0.6, mz = zc + 3.2; plinth(L, mx, mz, 2.6, 0.7, 0.35, 0x2a2e31); var lv = [[], [], [], []];
    for (var i = 0; i < 8; i++) lv[0].push([mx - 1.05 + i * 0.3, 0.75]); for (var r = 1; r < 4; r++) for (var j = 0; j < lv[r - 1].length / 2; j++) { var a = lv[r - 1][j * 2], c2 = lv[r - 1][j * 2 + 1]; lv[r].push([(a[0] + c2[0]) / 2, a[1] + 0.55]); }
    lv.forEach(function (row, ri) { row.forEach(function (p, k) { var s = ri === 3 ? 0.3 : 0.17; K.box("metal", 0x15171a, s + 0.03, s + 0.03, s + 0.03, p[0], p[1], mz, 0); G.box("glow", ri === 3 ? 0x7ef0a0 : 0x7fb2c9, s, s, s + 0.04, p[0], p[1], mz, 0); if (ri > 0) { var ch = lv[ri - 1]; [ch[k * 2], ch[k * 2 + 1]].forEach(function (q) { G.tube("glow", 0x9fd2e9, V3(q[0], q[1] + 0.09, mz), V3(p[0], p[1] - 0.09, mz), 0.012, 4); }); } }); });
    K.tube("metal", 0x15171a, V3(mx - 1.05, 0.35, mz), V3(mx - 1.05, 0.66, mz), 0.012, 4); K.tube("metal", 0x15171a, V3(mx + 1.05, 0.35, mz), V3(mx + 1.05, 0.66, mz), 0.012, 4);
    // the key pair: a public key (open, silver) and a private key (gold) over a lock
    var px = cx + 0.4, pz = zc - 3.1; plinth(L, px, pz, 1.4, 0.7, 0.95, 0x2a2e31); K.cyl("metal", 0x9aa0a6, 0.26, 0.26, 0.12, px, 1.15, pz, 24, false, 0, PI / 2); K.box("metal", 0x15171a, 0.07, 0.16, 0.13, px, 1.15, pz, 0);
    [[-0.45, 0xd8dcdf], [0.45, 0xd8a868]].forEach(function (q) { K.place("metal", new THREE.TorusGeometry(0.09, 0.022, 8, 18), q[1], px + q[0], 1.35, pz, 0); K.tube("metal", q[1], V3(px + q[0], 1.26, pz), V3(px + q[0], 0.98, pz), 0.02, 6); K.box("metal", q[1], 0.08, 0.025, 0.03, px + q[0] + 0.04, 1.02, pz, 0); });
    // the timestamp chain: five tags on a rod, each ringed to the last
    var tx = cx - 2.4, tz = zc + 3.2; K.box("metal", 0x15171a, 0.05, 2.2, 0.05, tx - 0.9, 1.1, tz, 0); K.box("metal", 0x15171a, 0.05, 2.2, 0.05, tx + 0.9, 1.1, tz, 0); K.box("metal", 0x15171a, 1.85, 0.04, 0.04, tx, 2.2, tz, 0); L.sol.push([tx, tz, 1.9, 0.3, 0, 2.2, 0]);
    for (var k2 = 0; k2 < 5; k2++) { var xx = tx - 0.72 + k2 * 0.36; K.box("paint", 0xe8dcc0, 0.26, 0.34, 0.012, xx, 1.75, tz, 0); G.box("glow", 0x7fb2c9, 0.18, 0.012, 0.014, xx, 1.66, tz, 0); if (k2 < 4) K.place("metal", new THREE.TorusGeometry(0.04, 0.008, 6, 12), 0xb8bcc0, xx + 0.18, 1.86, tz, PI / 2); K.tube("metal", 0x9aa0a6, V3(xx, 2.2, tz), V3(xx, 1.92, tz), 0.004, 3); }
    bench2(L, cx - 2.2, zc - 3.0, 0, 2.2, PI); }
  function g3Room(L, b) { var K = L.K, G = L.G, S = SITE, zc = S.zc, cx = b.cx; roomShell(L, b, 2);
    // a 1990s workstation: desk, beige monitor, keyboard, the Hashcash session on screen
    var wx = cx + 0.8, wz = zc + 3.1; K.box("wood", 0xb08a62, 1.6, 0.05, 0.8, wx, 0.74, wz, 0, 1.2); [[-0.74, -0.35], [0.74, -0.35], [-0.74, 0.35], [0.74, 0.35]].forEach(function (q) { K.box("metal", 0x2a2c30, 0.04, 0.72, 0.04, wx + q[0], 0.36, wz + q[1], 0); }); L.sol.push([wx, wz, 1.6, 0.8, 0, 0.77, 0]);
    K.place("paint", rbox(0.48, 0.42, 0.46, 0.04, 1), 0xd9d2bf, wx, 0.98, wz + 0.1, 0); K.box("paint", 0xcfc6b0, 0.36, 0.06, 0.28, wx, 0.8, wz + 0.1, 0); L.Bs.plane("atlasBs", 0xffffff, 0.38, 0.3, wx, 1.0, wz - 0.135, PI, 0, subUV(slotUVB(2), 0, 268 / 460)); K.box("paint", 0xd9d2bf, 0.46, 0.025, 0.16, wx, 0.78, wz - 0.28, 0);
    K.box("paint", 0xd9d2bf, 0.18, 0.4, 0.42, wx + 0.5, 0.97, wz + 0.05, 0);
    // the proof of work board: nonce after nonce until the hash starts with 000
    var hx = cx + 0.3, hz = zc - 3.15; K.box("metal", 0x15171a, 1.16, 1.56, 0.08, hx, 1.62, hz, 0); [-0.45, 0.45].forEach(function (dx2) { K.box("metal", 0x15171a, 0.06, 0.86, 0.06, hx + dx2, 0.43, hz, 0); }); L.Bs.plane("atlasBs", 0xffffff, 1.03, 1.4, hx, 1.62, hz + 0.045, 0, 0, slotUVB(3)); L.sol.push([hx, hz, 1.2, 0.3, 0, 2.4, 0]);
    // bit gold: proof-of-work strings chained one to the next (gold blocks rising on a plinth)
    var bx = cx - 2.3, bz = zc + 3.1; plinth(L, bx, bz, 1.2, 0.7, 0.9, 0x2a2e31); for (var i = 0; i < 6; i++) { var xx = bx - 0.45 + i * 0.18, yy = 1.0 + i * 0.07; K.box("metal", 0xd4a64a, 0.13, 0.13, 0.13, xx, yy, bz, 0, 0, 0.2); if (i < 5) K.tube("metal", 0xb88a3a, V3(xx, yy, bz), V3(xx + 0.18, yy + 0.07, bz), 0.012, 4); }
    bench2(L, cx - 2.2, zc - 3.0, 0, 2.2, PI); }
  function g4Room(L, b) { var K = L.K, G = L.G, S = SITE, zc = S.zc, cx = b.cx, T = S.T, iz0 = b.z0 + T, iz1 = b.z1 - T; roomShell(L, b, 3);
    // Block Zero: a 1.6 m block hovering over a lit ring, its faces the hex rain, the show wall on the north-west side, benches
    var qx = cx + 0.4, qz = zc + 0.1; L.cube = [qx, 1.95, qz]; K.cyl("basalt", 0xffffff, 1.35, 1.45, 0.22, qx, 0.11, qz, 40, false, 0, 0, 0); G.place("glow", new THREE.RingGeometry(1.5, 1.58, 48).rotateX(-PI / 2), 0xf2a33a, qx, 0.04, qz); G.place("glow", new THREE.RingGeometry(1.0, 1.04, 48).rotateX(-PI / 2), 0xffd28a, qx, 0.225, qz); L.sol.push([qx, qz, 2.4, 2.4, 0, 0.22, 0]); aoPad(L, qx, qz, 3.6, 3.6); L.sol.push([qx, qz, 1.7, 1.7, 0.22, 2.9, 0]);
    L.washes = [[b.x0 + T + 0.04, zc - 3.6, PI / 2], [b.x0 + T + 0.04, zc + 3.6, PI / 2], [b.x1 - T - 0.04, zc - 3.6, -PI / 2], [b.x1 - T - 0.04, zc + 3.6, -PI / 2], [cx - 3.4, iz1 - 0.04, PI], [cx + 3.4, iz1 - 0.04, PI]]; L.pools.push([qx, qz, 2.2, 0.32]);
    L.show = [cx, 2.65, iz0 + 0.06, 7.2, 3.1]; K.box("metal", 0x0d0e10, 7.5, 3.4, 0.06, cx, 2.65, iz0 + 0.03, 0);
    bench2(L, cx - 1.5, zc - 2.75, 0, 2.2, PI); bench2(L, cx + 1.9, zc - 2.75, 0, 2.2, PI); L.showSeats = [[cx - 1.5, zc - 2.75], [cx + 1.9, zc - 2.75]];
    // the kiosk: a standing terminal, its screen toward the aisle
    var kx = cx - 3.2, kz = zc + 3.9; L.kiosk = [kx, kz, kx, kz - 0.9]; K.box("basalt", 0xffffff, 0.8, 1.05, 0.55, kx, 0.525, kz, 0, 2.0); K.box("metal", 0x15171a, 0.86, 0.62, 0.08, kx, 1.32, kz - 0.18, 0, 0, 0.45); L.kioskScr = [kx, 1.32, kz - 0.225, 0.74, 0.5]; G.box("glow", 0xf2a33a, 0.7, 0.02, 0.02, kx, 1.06, kz - 0.28, 0); L.sol.push([kx, kz, 0.8, 0.6, 0, 1.1, 0]); aoPad(L, kx, kz, 1.4, 1.2);
    // the whitepaper on the south-east wall between the panels
    K.box("metal", 0x15171a, 1.36, 1.8, 0.04, cx, 1.85, iz1 - 0.04, 0); objPlane(L, "B", 5, 1.24, 1.68, cx, 1.85, iz1 - 0.065, PI);
    L.lamps.push(["spot", 0xffd9a8, 9, 14, qx + 2.2, b.h - 1.0, qz - 2.0, qx, qz]); }
  function g5Room(L, b) { var K = L.K, G = L.G, S = SITE, zc = S.zc, cx = b.cx; roomShell(L, b, 4);
    // the vending machine idea: pay the right coins and it delivers
    var vx = cx + 1.0, vz = zc + 3.25; K.place("paint", rbox(1.05, 1.95, 0.8, 0.04, 1), 0x4a4aa8, vx, 0.975, vz, 0); K.box("glass", 0xe8f2f4, 0.7, 1.3, 0.02, vx - 0.12, 1.15, vz - 0.41, 0); var cols = [0xf2a33a, 0x4dde6f, 0xe0526a, 0x7fb2c9, 0xf4ecdc];
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) K.box("paint", cols[(r + c) % cols.length], 0.12, 0.2, 0.1, vx - 0.36 + c * 0.16, 0.65 + r * 0.3, vz - 0.3, 0);
    K.box("metal", 0x15171a, 0.2, 0.9, 0.02, vx + 0.38, 1.25, vz - 0.405, 0); G.box("glow", 0x8f8ff0, 0.12, 0.05, 0.02, vx + 0.38, 1.5, vz - 0.415, 0); G.box("glow", 0x4dde6f, 0.06, 0.06, 0.02, vx + 0.38, 1.25, vz - 0.415, 0); L.sol.push([vx, vz, 1.05, 0.8, 0, 1.95, 0]); aoPad(L, vx, vz, 1.7, 1.4);
    // a shared computer: twenty-five nodes on rods, all agreeing (they pulse together)
    var nx = cx + 0.4, nz = zc - 3.1; plinth(L, nx, nz, 1.6, 1.6, 0.5, 0x2a2e31); L.nodes = [];
    for (var i = 0; i < 5; i++) for (var j = 0; j < 5; j++) { var x = nx - 0.6 + i * 0.3, z = nz - 0.6 + j * 0.3, h = 0.95 + ((i * 7 + j * 3) % 5) * 0.12; K.tube("metal", 0x9aa0a6, V3(x, 0.5, z), V3(x, h - 0.08, z), 0.006, 3); K.box("metal", 0x15171a, 0.15, 0.15, 0.15, x, h, z, 0); L.nodes.push([x, h, z]); }
    // the contract code on a stand
    var cxx = cx - 2.35, czz = zc + 3.15; K.box("metal", 0x15171a, 1.3, 1.75, 0.06, cxx, 1.65, czz, 0); [-0.55, 0.55].forEach(function (dx) { K.box("metal", 0x15171a, 0.05, 0.8, 0.05, cxx + dx, 0.4, czz, 0); }); L.Bs.plane("atlasBs", 0xffffff, 1.18, 1.6, cxx, 1.65, czz - 0.035, PI, 0, slotUVB(4)); L.sol.push([cxx, czz, 1.3, 0.3, 0, 2.5, 0]);
    bench2(L, cx - 2.2, zc - 3.0, 0, 2.2, PI); }
  function g6Room(L, b) { var K = L.K, G = L.G, S = SITE, zc = S.zc, cx = b.cx, T = S.T, iz0 = b.z0 + T; roomShell(L, b, 5);
    // the proof of history clock: 64 segments on a 1.75 m ring, the newest hash glows; its count and hash in the middle
    var rx = cx, ry0 = 2.35, rz = zc + 3.55, R0 = 1.75; L.ring = [rx, ry0, rz, R0]; K.box("basalt", 0xffffff, 1.2, 0.5, 0.7, rx, 0.25, rz, 0, 2.0); K.box("metal", 0x15171a, 0.12, ry0 - R0 - 0.1, 0.12, rx, 0.5 + (ry0 - R0 - 0.5) / 2, rz, 0); L.sol.push([rx, rz, 1.2, 0.7, 0, 0.5, 0]);
    K.place("metal", new THREE.TorusGeometry(R0, 0.06, 8, 96), 0x15171a, rx, ry0, rz + 0.02, 0); K.place("metal", new THREE.TorusGeometry(R0 - 0.26, 0.025, 6, 96), 0x15171a, rx, ry0, rz + 0.02, 0);
    for (var i = 0; i < 64; i++) { var a = i / 64 * TAU, x = rx + Math.sin(a) * (R0 - 0.13), y = ry0 + Math.cos(a) * (R0 - 0.13); G.box("glow", 0x1d3a26, 0.1, 0.17, 0.03, x, y, rz - 0.02, 0, 0, 0, -a); }
    L.ringScr = [rx, ry0, rz - 0.035, 2.4];
    // the running chain on the north-west wall
    L.pohWall = [cx, 2.0, iz0 + 0.07, 5.6, 1.75]; K.box("metal", 0x0d0e10, 5.8, 1.95, 0.05, cx, 2.0, iz0 + 0.045, 0);
    bench2(L, cx - 1.0, zc - 1.95, 0, 2.2, 0); }
  function g7Room(L, b) { var K = L.K, G = L.G, S = SITE, zc = S.zc, cx = b.cx; roomShell(L, b, 6);
    // parcels as records: a model of the land, every parcel a tile; a cursor moves from record to record
    var mx = cx + 0.6, mz = zc + 3.15; K.box("basalt", 0xffffff, 2.6, 0.82, 1.5, mx, 0.41, mz, 0, 2.0); K.box("basalt", 0xffffff, 2.66, 0.05, 1.56, mx, 0.845, mz, 0, 2.0); K.box("basalt", 0xffffff, 2.44, 0.04, 1.26, mx, 0.89, mz, 0, 2.0); L.land = [mx, 0.912, mz, 2.4, 1.2]; L.sol.push([mx, mz, 2.66, 1.56, 0, 0.92, 0]); aoPad(L, mx, mz, 3.3, 2.2);
    L.tiles = []; var R = rng(7); for (var i = 0; i < 11; i++) for (var j = 0; j < 5; j++) { if (R() < 0.45) continue; var x = mx - 1.05 + i * 0.21, z = mz - 0.42 + j * 0.21; if (Math.abs(z - (mz - 0.62 + 0.45 * 1.2)) < 0.1) continue; var h = 0.012 + R() * 0.03; K.box("glass", 0xd8f5e0, 0.17, h, 0.17, x, 0.915 + h / 2, z, 0); L.tiles.push([x, 0.915 + h + 0.004, z]); }
    L.here = [mx - 1.2 + 0.482 * 2.4, 0.93, mz - 0.6 + 0.536 * 1.2];
    // the deed and its token on a lectern
    var dx = cx + 0.5, dz = zc - 3.05; K.box("metal", 0x1c1d1f, 0.12, 1.0, 0.12, dx, 0.5, dz, 0); K.box("wood", 0x6a4a30, 0.9, 0.05, 0.62, dx, 1.04, dz, 0, 1.2, 0.25); objPlane(L, "B", 6, 0.42, 0.56, dx - 0.12, 1.08, dz + 0.01, 0, -PI / 2 + 0.25); K.cyl("metal", 0xd8a868, 0.11, 0.11, 0.025, dx + 0.28, 1.085, dz + 0.02, 24, false, 0, 0.25); G.cyl("glow", 0x4dde6f, 0.06, 0.06, 0.004, dx + 0.28, 1.1, dz + 0.02, 6, false, 0, 0.25); L.sol.push([dx, dz, 0.9, 0.7, 0, 1.1, 0]);
    bench2(L, cx - 2.2, zc - 3.0, 0, 2.2, PI); }
  function g8Room(L, b) { var K = L.K, G = L.G, S = SITE, zc = S.zc, cx = b.cx, T = S.T, iz0 = b.z0 + T, ix0 = b.x0 + T; roomShell(L, b, 7);
    // the ledger wall (north-west), the map table (follow a donation), the logo over the exit
    L.ledger = [cx, 2.3, iz0 + 0.07, 8.0, 2.6]; K.box("metal", 0x0d0e10, 8.3, 2.9, 0.05, cx, 2.3, iz0 + 0.045, 0);
    var mx = cx + 0.9, mz = zc + 3.0; L.map = [mx, mz, 2.9, 1.6]; K.box("basalt", 0xffffff, 3.1, 0.86, 1.8, mx, 0.43, mz, 0, 2.0); K.box("basalt", 0xffffff, 3.16, 0.05, 1.86, mx, 0.885, mz, 0, 2.0); L.sol.push([mx, mz, 3.16, 1.86, 0, 0.92, 0]); aoPad(L, mx, mz, 3.8, 2.5); G.box("glow", 0x4dde6f, 3.1, 0.02, 0.02, mx, 0.78, mz - 0.91, 0);
    L.logoG8 = [ix0 + 0.07, 4.9, zc, PI / 2, 1.3]; K.box("basalt", 0x8a8a8a, 0.05, 1.8, 3.2, ix0 + 0.03, 4.9, zc, 0, 2.0);
    bench2(L, cx - 1.6, zc - 2.0, 0, 2.4, PI); }
  // the glass links: terrazzo, the chain line, a soffit light
  function linkRoom(L, k) { var S = SITE, K = L.K, G = L.G, zc = S.zc, x0 = k.x0 - S.T, x1 = k.x1 + S.T; flatQuad(K, "terr", 0xf1ebe0, [[x0, zc - S.LW / 2 + 0.08], [x1, zc - S.LW / 2 + 0.08], [x1, zc + S.LW / 2 - 0.08], [x0, zc + S.LW / 2 - 0.08]], 0.01, 3.0); G.box("glow", 0x4dde6f, x1 - x0, 0.006, 0.05, k.cx, 0.015, zc, 0); }
  var ROOMS = { lobby: lobbyRoom, g1: g1Room, g2: g2Room, g3: g3Room, g4: g4Room, g5: g5Room, g6: g6Room, g7: g7Room, g8: g8Room };
  function* buildInteriorSteps(L) { var S = SITE; for (var i = 0; i < S.blocks.length; i++) { var b = S.blocks[i]; L.bi = i; try { ROOMS[b.id](L, b); } catch (e) { note("room " + b.id, e); } yield i; } S.links.forEach(function (k) { linkRoom(L, k); }); yield -1; }
  function newL(dry) { var L = { sol: [], panels: [], pools: [], lamps: [], ao: [], strips: [], tris: 0, dry: !!dry, H: {}, hrK: {}, hrSlots: {}, bi: 0 }; if (dry) { L.K = L.G = L.A = L.B = L.Bs = dryKit(); return L; }
    var g = new THREE.Group(); g.name = "cm interior"; g.position.set(SITE.cx, SITE.G, SITE.cz); g.rotation.y = SITE.th; g.userData.noBatch = true; g.userData.interior = true; L.g = g; L.K = new Kit(); L.G = new Kit(); L.A = new Kit(); L.B = new Kit(); L.Bs = new Kit(); return L; }

  // ───────────────────────── SHA-256 (FIPS 180-4), synchronous, so the kiosk can hash and mine inside the frame budget ─────────────────────────
  var SHA_K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  var SHA_W = new Uint32Array(64), SHA_H = new Uint32Array(8);
  function sha256(bytes) { var l = bytes.length, nb = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(nb); m.set(bytes); m[l] = 0x80; var bits = l * 8, hi = Math.floor(bits / 4294967296), lo = bits >>> 0;
    m[nb - 1] = lo & 255; m[nb - 2] = (lo >>> 8) & 255; m[nb - 3] = (lo >>> 16) & 255; m[nb - 4] = (lo >>> 24) & 255; m[nb - 5] = hi & 255; m[nb - 6] = (hi >>> 8) & 255; m[nb - 7] = (hi >>> 16) & 255; m[nb - 8] = (hi >>> 24) & 255;
    var H = SHA_H, W = SHA_W, K = SHA_K; H[0] = 0x6a09e667; H[1] = 0xbb67ae85; H[2] = 0x3c6ef372; H[3] = 0xa54ff53a; H[4] = 0x510e527f; H[5] = 0x9b05688c; H[6] = 0x1f83d9ab; H[7] = 0x5be0cd19;
    for (var o = 0; o < nb; o += 64) { var t;
      for (t = 0; t < 16; t++) W[t] = ((m[o + 4 * t] << 24) | (m[o + 4 * t + 1] << 16) | (m[o + 4 * t + 2] << 8) | m[o + 4 * t + 3]) >>> 0;
      for (t = 16; t < 64; t++) { var x = W[t - 15], y = W[t - 2]; var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3), s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10); W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0; }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) { var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0; H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0; }
    var out = new Uint8Array(32); for (var i = 0; i < 8; i++) { out[i * 4] = H[i] >>> 24; out[i * 4 + 1] = (H[i] >>> 16) & 255; out[i * 4 + 2] = (H[i] >>> 8) & 255; out[i * 4 + 3] = H[i] & 255; } return out; }
  var _te = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  function utf8(s) { if (_te) return _te.encode(String(s)); var o = [], t = unescape(encodeURIComponent(String(s))); for (var i = 0; i < t.length; i++) o.push(t.charCodeAt(i)); return new Uint8Array(o); }
  function hex(b) { var s = ""; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16); return s; }
  function unhex(h) { var o = new Uint8Array(h.length >> 1); for (var i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; }
  function shaHex(s) { return hex(sha256(utf8(s))); }
  function bitsDiff(a, b) { if (!a || !b) return 0; var n = 0; for (var i = 0; i < a.length; i += 2) { var x = parseInt(a.substr(i, 2), 16) ^ parseInt(b.substr(i, 2), 16); while (x) { n += x & 1; x >>= 1; } } return n; }
  // block 0: version 1, previous hash zero, the Merkle root, 2009-01-03 18:15:05 UTC, bits 0x1d00ffff, nonce 2083236893; hashed twice, shown byte reversed
  var GENESIS_HDR = "01000000" + "0000000000000000000000000000000000000000000000000000000000000000" + "3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a" + "29ab5f49" + "ffff001d" + "1dac2b7c";
  function genesisHash() { var h = sha256(sha256(unhex(GENESIS_HDR))); var r = new Uint8Array(32); for (var i = 0; i < 32; i++) r[i] = h[31 - i]; return hex(r); }
  CM.sha = { sha256: sha256, shaHex: shaHex, genesisHash: genesisHash, hdr: GENESIS_HDR };

  // ───────────────────────── finishing the interior: merge, live screens, animated pieces, pool lamps ─────────────────────────
  var POOLT = null;
  function poolTex() { if (POOLT) return POOLT; var c = document.createElement("canvas"); c.width = c.height = 128; var x = c.getContext("2d"); var g = x.createRadialGradient(64, 64, 2, 64, 64, 63); g.addColorStop(0, "rgba(255,236,205,1)"); g.addColorStop(0.45, "rgba(255,222,180,0.42)"); g.addColorStop(1, "rgba(255,210,160,0)"); x.fillStyle = g; x.fillRect(0, 0, 128, 128); POOLT = new THREE.CanvasTexture(c); POOLT.colorSpace = THREE.SRGBColorSpace; POOLT.userData.avShared = true; return POOLT; }
  var STRIPT = null;
  function stripTex() { if (STRIPT) return STRIPT; var c = document.createElement("canvas"); c.width = 16; c.height = 128; var x = c.getContext("2d"); var g = x.createLinearGradient(0, 128, 0, 0); g.addColorStop(0, "rgba(255,255,255,0.85)"); g.addColorStop(0.25, "rgba(255,255,255,0.4)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 16, 128); STRIPT = new THREE.CanvasTexture(c); STRIPT.colorSpace = THREE.SRGBColorSpace; STRIPT.userData.avShared = true; return STRIPT; }
  function liveMesh(L, w, h, pw, ph, x, y, z, ry, rx, name) { var T0 = liveTex(pw, ph); var m = basic({ map: T0.t, color: 0xe0e0e0, vertexColors: true, transparent: true, toneMapped: true }); m.userData.noShadow = true; var me = new THREE.Mesh(withColor(new THREE.PlaneGeometry(w, h)), m); me.position.set(x, y, z); me.rotation.set(rx || 0, ry || 0, 0, "YXZ"); me.name = "cm " + name; me.userData.noShadow = true; L.g.add(me); L.live[name] = { T: T0, m: me, at: 0 }; return L.live[name]; }
  function finishL(L) {
    var M = mats(), At = AT || (AT = CM.atlas = newAtlas()); L.live = {}; L.anim = {};
    var cast = tierN() >= 2;
    var meshes = L.K.build(L.g, { conc: M.conc, basalt: M.basalt, metal: M.metal, paint: M.paint, glass: M.glass, terr: M.terr, wood: M.wood, trav: M.trav }, { cast: cast, noCast: { terr: 1, glass: 1 } });
    if (L.washes && L.washes.length) L.washes.forEach(function (q) { var nx = Math.sin(q[2]), nz = Math.cos(q[2]); L.G.box("glow", 0xffd9a0, 0.3, 0.05, 0.12, q[0] + nx * 0.1, 0.03, q[1] + nz * 0.1, q[2]); });
    L.G.build(L.g, { glow: M.glow }, {}); L.A.build(L.g, { atlas: At.self }, {});
    L.near = {}; if (!CM.near) CM.near = newNear(); Object.keys(L.H).forEach(function (bi) { var m = basic({ map: CM.near[0].t, color: 0xd9d9d9, vertexColors: true, transparent: true, toneMapped: true }); m.userData.noShadow = true; var ms = L.H[bi].build(L.g, { near: m }, {}); if (ms[0]) { ms[0].visible = false; ms[0].renderOrder = 1; L.near[bi] = { mesh: ms[0], mat: m, slots: L.hrSlots[bi] }; } }); CM.near.forEach(function (N) { N.bi = -1; N.k = 0; N.ready = false; }); L.B.build(L.g, { atlasB: At.blit }, { cast: false }); L.Bs.build(L.g, { atlasBs: At.bself }, {});
    // warm washes up the walls (Block Zero): the exterior wash texture, a quiet indoor level
    if (L.washes && L.washes.length) { var WK = new Kit(); L.washes.forEach(function (q) { var nx = Math.sin(q[2]), nz = Math.cos(q[2]); WK.place("w", new THREE.PlaneGeometry(2.4, 4.2), 0xffffff, q[0] + nx * 0.02, 2.12, q[1] + nz * 0.02, q[2]); }); if (!L.washMat) { L.washMat = basic({ map: washTex(), color: 0xffffff, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.32, toneMapped: true }); L.washMat.userData.noShadow = true; } var wm2 = WK.build(L.g, { w: L.washMat }, {}); if (wm2[0]) wm2[0].renderOrder = 3; }
    // floor light pools (additive, brighter at night) under the panels and the track lights
    var PK = new Kit(); L.pools.forEach(function (p) { var g = new THREE.PlaneGeometry(p[2] * 2, p[2] * 2); g.rotateX(-PI / 2); PK.place("pool", g, [p[3] * 4, p[3] * 3.6, p[3] * 3.1], p[0], 0.025, p[1]); });
    // contact occlusion: soft dark strips along the walls and pads under the furniture (normal blending, black through the gradients)
    var AK = new Kit(), SK = new Kit(); L.ao.forEach(function (q) { var g = new THREE.PlaneGeometry(q[2], q[3]); g.rotateX(-PI / 2); AK.place("ao", g, 0x000000, q[0], 0.02, q[1], q[4]); });
    L.strips.forEach(function (q) { var g = new THREE.PlaneGeometry(q[2], 0.75); var off = 0.375; var nx = -Math.sin(q[3]), nz = -Math.cos(q[3]); SK.place("strip", g, 0x000000, q[0] + nx * off, 0.018, q[1] + nz * off, q[3], -PI / 2); });
    if (!L.aoMat) { L.aoMat = basic({ map: poolTex(), color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, opacity: 0.42, toneMapped: true }); L.aoMat.userData.noShadow = true; L.stripMat = basic({ map: stripTex(), color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, opacity: 0.5, toneMapped: true }); L.stripMat.userData.noShadow = true; }
    AK.build(L.g, { ao: L.aoMat }, {}); SK.build(L.g, { strip: L.stripMat }, {});
    if (!L.poolMat) { L.poolMat = basic({ map: poolTex(), color: 0xffffff, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true }); L.poolMat.userData.noShadow = true; } PK.build(L.g, { pool: L.poolMat }, {});
    // Block Zero: the hovering block (its faces the hex rain), the show wall, the kiosk screen
    var lo = tierN() < 1 || mobile(); if (L.cube) { var hr = hexRain(lo); var cm = basic({ map: hr.t, color: 0xffd9a0, vertexColors: true, transparent: true, toneMapped: true }); cm.userData.noShadow = true; var cg = new THREE.Group(); var core = new THREE.Mesh(withColor(new THREE.BoxGeometry(1.5, 1.5, 1.5)), cm); core.userData.noShadow = true; cg.add(core); var fk = new Kit(), e2 = 0.8; [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (q) { fk.box("metal", 0x2a2016, 0.07, 1.62, 0.07, q[0] * e2, 0, q[1] * e2, 0); fk.box("metal", 0x2a2016, 1.62, 0.07, 0.07, 0, q[0] * e2, q[1] * e2, 0); fk.box("metal", 0x2a2016, 0.07, 0.07, 1.62, q[0] * e2, q[1] * e2, 0, 0); }); fk.build(cg, { metal: M.metal }, { cast: false }); cg.position.set(L.cube[0], L.cube[1], L.cube[2]); cg.name = "cm block0"; L.g.add(cg); L.anim.cube = cg; L.anim.cubeTex = hr; }
    if (L.show) liveMesh(L, L.show[3], L.show[4], lo ? 512 : 1024, lo ? 220 : 440, L.show[0], L.show[1], L.show[2], 0, 0, "show");
    if (L.kioskScr) liveMesh(L, L.kioskScr[3], L.kioskScr[4], 384, 260, L.kioskScr[0], L.kioskScr[1] + 0.008, L.kioskScr[2] - 0.006, PI, -0.45, "kiosk");
    if (L.ringScr) { var rs = liveMesh(L, 2.3, 2.3, 384, 384, L.ringScr[0], L.ringScr[1], L.ringScr[2], PI, 0, "ring"); rs.m.material.transparent = true; }
    if (L.pohWall) liveMesh(L, L.pohWall[3], L.pohWall[4], lo ? 512 : 1024, lo ? 160 : 320, L.pohWall[0], L.pohWall[1], L.pohWall[2], 0, 0, "poh");
    if (L.ledger) liveMesh(L, L.ledger[3], L.ledger[4], lo ? 640 : 1152, lo ? 208 : 375, L.ledger[0], L.ledger[1], L.ledger[2], 0, 0, "ledger");
    if (L.map) liveMesh(L, L.map[2], L.map[3], lo ? 512 : 832, lo ? 282 : 459, L.map[0], 0.913, L.map[1], PI, -PI / 2, "map");
    // the proof of history ring: a bright head and a short trail that step round the 64 segments
    if (L.ring) { var hk = new Kit(); for (var t = 0; t < 4; t++) hk.box("glow", [1, 0.5 + t * 0.15, 1], 0.1, 0.17, 0.035, 0, 0, 0, 0); L.anim.ringHeads = []; for (var t2 = 0; t2 < 4; t2++) { var hm = new THREE.Mesh(withColor(new THREE.BoxGeometry(0.11, 0.18, 0.036)), basic({ color: new THREE.Color(0x4dde6f).multiplyScalar(1.4 - t2 * 0.3), vertexColors: true, toneMapped: true })); hm.material.userData.noShadow = true; L.g.add(hm); L.anim.ringHeads.push(hm); } }
    // the hanging chain's running light, the shared computer's pulse, the land model's cursor
    var addM = function (geo, col, name) { var me = new THREE.Mesh(withColor(geo), basic({ map: whiteT(), color: col, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true })); me.material.userData.noShadow = true; me.name = "cm " + name; me.renderOrder = 4; L.g.add(me); return me; };
    if (L.chain) { L.anim.chainRun = addM(new THREE.BoxGeometry(0.66, 0.66, 0.66), 0xffffff, "chain run"); }
    if (L.nodes) { var nk = new Kit(); L.nodes.forEach(function (p) { nk.box("glow", 0xffffff, 0.12, 0.12, 0.155, p[0], p[1], p[2], 0); }); var ng = nk.merge().glow; if (ng) { var nm = new THREE.Mesh(ng, basic({ color: 0x8f8ff0, vertexColors: true, toneMapped: true })); nm.material.userData.noShadow = true; nm.name = "cm nodes"; L.g.add(nm); L.anim.nodes = nm; } }
    if (L.tiles && L.tiles.length) { L.anim.cursor = addM(new THREE.BoxGeometry(0.19, 0.03, 0.19), 0x4dde6f, "cursor"); L.anim.cursorAt = 0; }
    if (L.land) { var la = L.land; if (!CM.landMat) { CM.landMat = slotMat({ map: "cm_land" }, { color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0, normalMap: flatN(), roughnessMap: flatR() }); patchIndoor(CM.landMat); } var lg2 = withColor(new THREE.PlaneGeometry(la[3], la[4])); lg2.rotateX(-PI / 2); var lme = new THREE.Mesh(lg2, CM.landMat); lme.position.set(la[0], la[1], la[2]); lme.name = "cm land"; lme.receiveShadow = true; lme.userData.noShadow = true; L.g.add(lme); }
    if (L.here) { L.anim.here = addM(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16), 0x4dde6f, "here"); L.anim.here.position.set(L.here[0], L.here[1], L.here[2]); }
    if (L.mural) { var mu = L.mural; if (!CM.muralMat) { CM.muralMat = slotMat({ map: "cm_mural" }, { color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0, normalMap: flatN(), roughnessMap: flatR() }); patchIndoor(CM.muralMat); } var mm = new THREE.Mesh(withColor(new THREE.PlaneGeometry(mu[4], mu[5])), CM.muralMat); mm.position.set(mu[0], mu[1], mu[2]); mm.rotation.y = mu[3]; mm.name = "cm mural"; mm.receiveShadow = true; mm.userData.noShadow = true; L.g.add(mm); }
    // the GIVEBACK logo inside (the Lobby, over Gallery 8's exit)
    var lg = logoMat(); [L.logoIn, L.logoG8].forEach(function (q) { if (!q || !lg) return; var me = new THREE.Mesh(withColor(new THREE.PlaneGeometry(q[4] * 2, q[4])), lg); me.position.set(q[0], q[1], q[2]); me.rotation.y = q[3]; me.name = "cm logo in"; L.g.add(me); });
    // pool lamps: sources for the client's light pool (no new real lights)
    L.lights = []; L.lamps.forEach(function (q) { var l = q[0] === "spot" ? new THREE.SpotLight(q[1], 0, q[3], 0.6, 0.55, 1.3) : new THREE.PointLight(q[1], 0, q[3], 1.4); l.position.set(q[4], q[5], q[6]); l.userData.k0 = q[2]; if (q[0] === "spot") { var tg = new THREE.Object3D(); tg.position.set(q[7], q[9] !== undefined ? q[9] : 0.6, q[8]); L.g.add(tg); l.target = tg; } L.g.add(l); L.lights.push(l); });
    // per-panel E hotspots: the full text in the info card
    try { L.hs = []; L.panels.forEach(function (p) { var d = p.gi < 0 ? (C("lobby.panels", []) || [])[p.j] : ((C("galleries", []) || [])[p.gi] || {}).panels[p.j]; if (!d) return; var w = l2w(p.x, p.z); var h = { x: w[0], z: w[1], r: 1.35, t: d.t, k: d.k, p: d.p, cm: "panel" }; hotspots.push(h); L.hs.push(h); }); } catch (e) { note("panel hotspots", e); }
    scene.add(L.g); L.g.updateMatrixWorld(true); L.tris = Math.round(L.K.tris + L.G.tris + L.A.tris + L.B.tris + L.Bs.tris);
    try { if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(L.g, { name: "cm interior" }); } catch (e) {}
    return L; }
  function disposeL() { var L = IN.L; if (!L) return; try { scene.remove(L.g); L.g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map && o.material.map.userData && !o.material.map.userData.cmKeep && o.material.map !== POOLT && !(AT && (o.material.map === AT.A.t || o.material.map === AT.B.t)) && o.material.map !== (LOGO && LOGO.map)) { o.material.map.dispose(); } });
      (L.hs || []).forEach(function (h) { var i = hotspots.indexOf(h); if (i >= 0) hotspots.splice(i, 1); }); } catch (e) { note("dispose", e); }
    IN.L = null; CM.n.disposes = (CM.n.disposes || 0) + 1; try { LIGHTS.dirty = true; } catch (e) {} }
  var FONT0 = 0; function fontsReady() { try { if (!FONT0) FONT0 = nowMs(); if (!document.fonts || document.fonts.status === "loaded") return true; return nowMs() - FONT0 > 12000; } catch (e) { return true; } }
  function interiorFrame() {
    var px = player.position.x, pz = player.position.z, d = siteDist(px, pz), flying = typeof FLY !== "undefined" && FLY.on;
    if (!IN.L && !IN.sb && d < R_BUILD && !flying) { var L = newL(false); IN.sb = { L: L, it: buildInteriorSteps(L), t0: nowMs() }; if (!AT) AT = CM.atlas = newAtlas(); }
    if (AT && !AT.ready && fontsReady()) { AT.ready = atlasStep(AT, inMuseum(px, player.position.y + 1, pz) ? 12 : 4); }
    if (IN.sb) { var sb = IN.sb, r; try { var hurry = inMuseum(px, player.position.y + 1, pz); if (!hurry && window.PLAN_PERF && PLAN_PERF.step) r = PLAN_PERF.step(sb.it); else { do { r = sb.it.next(); } while (!r.done); } } catch (e) { note("build", e); IN.sb = null; return; }
      if (r && r.done) { var t1 = nowMs(); IN.L = finishL(sb.L); CM.n.builds = (CM.n.builds || 0) + 1; CM.n.buildMs = Math.round(nowMs() - sb.t0); CM.n.finishMs = Math.round(nowMs() - t1); IN.sb = null; } }
    if (IN.L && d > R_DROP) disposeL(); }

  // ───────────────────────── the live screens and moving pieces (drawn only when seen) ─────────────────────────
  var LV = CM.lv = CM.lv || { poh: { n: 0, h: null, rows: [], at: 0 }, ledger: { blocks: [], next: 0, at: 0, n: 1000 }, show: { i: 0, at: 0, seen: 0 }, map: { on: false, t: 0, step: -1 }, kiosk: { last: "", hash: "" } };
  var GIFTS = ["a school library", "a food program", "a shelter", "a church pantry", "a clinic", "a scholarship", "a local team", "a water project", "a youth club", "a food truck giveaway", "a reading program", "a community garden"];
  function ledgerAdd(label, mine) { var B = LV.ledger.blocks, prev = B.length ? B[B.length - 1].h : "0".repeat(64); LV.ledger.n++; var h = shaHex(prev + "|" + label + "|" + LV.ledger.n); B.push({ n: LV.ledger.n, h: h, label: label, mine: !!mine, t: nowMs() }); if (B.length > 12) B.shift(); }
  function drawLedger(Lv, dt) { var x = Lv.T.x, W = Lv.T.cv.width, Hh = Lv.T.cv.height, B = LV.ledger.blocks; x.fillStyle = "#07090a"; x.fillRect(0, 0, W, Hh);
    x.strokeStyle = "rgba(77,222,111,0.06)"; x.lineWidth = 1; for (var gx = 0; gx < W; gx += W / 48) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, Hh); x.stroke(); } for (var gy = 0; gy < Hh; gy += Hh / 16) { x.beginPath(); x.moveTo(0, gy); x.lineTo(W, gy); x.stroke(); }
    var s = W / 1536, bw = 170 * s, bh = 230 * s, gap = 70 * s, y0 = Hh * 0.5 - bh / 2 + 18 * s; var age = B.length ? (nowMs() - B[B.length - 1].t) / 900 : 1, slide = (1 - Math.min(1, age)) * (bw + gap);
    x.font = "600 " + Math.round(22 * s) + "px " + FONT; x.fillStyle = "#4dde6f"; x.textBaseline = "top"; x.textAlign = "left"; x.fillText(C("galleries", [])[7] ? "THE LEDGER WALL" : "", 28 * s, 22 * s); x.fillStyle = "rgba(230,223,207,0.55)"; x.font = "500 " + Math.round(15 * s) + "px " + FONT; x.fillText("each block holds the hash of the one before it (an illustration)", 28 * s, 52 * s);
    for (var i = B.length - 1, k = 0; i >= 0; i--, k++) { var b = B[i], bx = W - 40 * s - bw - k * (bw + gap) + slide; if (bx + bw < 0) break; var fresh = i === B.length - 1 ? Math.max(0, 1 - age) : 0;
      x.fillStyle = b.mine ? "rgba(242,163,58,0.16)" : "rgba(77,222,111," + (0.08 + fresh * 0.25) + ")"; x.strokeStyle = b.mine ? "#f2a33a" : "#4dde6f"; x.lineWidth = 2 * s; roundRect(x, bx, y0, bw, bh, 12 * s); x.fill(); x.stroke();
      x.fillStyle = b.mine ? "#f2a33a" : "#4dde6f"; x.font = "600 " + Math.round(20 * s) + "px " + FONT; x.fillText("BLOCK " + b.n, bx + 14 * s, y0 + 14 * s);
      x.fillStyle = "#e6dfcf"; x.font = "500 " + Math.round(14 * s) + "px " + MONO; x.fillText(b.h.slice(0, 12), bx + 14 * s, y0 + 48 * s); x.fillText(b.h.slice(12, 24), bx + 14 * s, y0 + 66 * s); x.fillStyle = "rgba(230,223,207,0.5)"; x.fillText("prev " + (i > 0 ? B[i - 1].h.slice(0, 7) : "0000000"), bx + 14 * s, y0 + 96 * s);
      x.fillStyle = "#f4ecdc"; x.font = "500 " + Math.round(15 * s) + "px " + FONT; wrapText(x, (b.mine ? "Mined by you: " : "A gift to ") + b.label, bw - 26 * s).slice(0, 3).forEach(function (l, j) { x.fillText(l, bx + 14 * s, y0 + 130 * s + j * 20 * s); });
      if (i > 0) { var ax = bx - 4 * s, ay = y0 + bh / 2; x.strokeStyle = "rgba(77,222,111,0.85)"; x.lineWidth = 3 * s; x.beginPath(); x.moveTo(ax, ay); x.lineTo(ax - gap + 10 * s, ay); x.stroke(); x.beginPath(); x.moveTo(ax - gap + 8 * s, ay); x.lineTo(ax - gap + 22 * s, ay - 8 * s); x.lineTo(ax - gap + 22 * s, ay + 8 * s); x.closePath(); x.fillStyle = "#4dde6f"; x.fill(); } }
    Lv.T.t.needsUpdate = true; }
  function roundRect(x, X, Y, W, Hh, r) { x.beginPath(); x.moveTo(X + r, Y); x.lineTo(X + W - r, Y); x.quadraticCurveTo(X + W, Y, X + W, Y + r); x.lineTo(X + W, Y + Hh - r); x.quadraticCurveTo(X + W, Y + Hh, X + W - r, Y + Hh); x.lineTo(X + r, Y + Hh); x.quadraticCurveTo(X, Y + Hh, X, Y + Hh - r); x.lineTo(X, Y + r); x.quadraticCurveTo(X, Y, X + r, Y); x.closePath(); }
  function pohTick() { var P = LV.poh; if (!P.h) P.h = sha256(utf8("Genesis One")); P.h = sha256(P.h); P.n++; P.rows.unshift([P.n, hex(P.h)]); if (P.rows.length > 7) P.rows.pop(); }
  function drawRing(Lv) { var x = Lv.T.x, W = Lv.T.cv.width, P = LV.poh; x.clearRect(0, 0, W, W); x.fillStyle = "rgba(5,8,6,0.92)"; x.beginPath(); x.arc(W / 2, W / 2, W * 0.36, 0, TAU); x.fill(); x.textAlign = "center"; x.textBaseline = "middle";
    x.fillStyle = "#4dde6f"; x.font = "600 " + Math.round(W * 0.05) + "px " + FONT; x.fillText("PROOF OF HISTORY", W / 2, W * 0.27); x.fillStyle = "#f4ecdc"; x.font = "600 " + Math.round(W * 0.085) + "px " + MONO; x.fillText(String(P.n).padStart(6, "0"), W / 2, W * 0.38);
    var h = P.rows[0] ? P.rows[0][1] : ""; x.fillStyle = "rgba(230,223,207,0.8)"; x.font = "500 " + Math.round(W * 0.042) + "px " + MONO; for (var r = 0; r < 4; r++) x.fillText(h.slice(r * 16, r * 16 + 16), W / 2, W * (0.5 + r * 0.058)); x.fillStyle = "rgba(77,222,111,0.7)"; x.font = "500 " + Math.round(W * 0.034) + "px " + FONT; x.fillText("each hash is SHA-256 of the last", W / 2, W * 0.76); Lv.T.t.needsUpdate = true; }
  function drawPohWall(Lv) { var x = Lv.T.x, W = Lv.T.cv.width, Hh = Lv.T.cv.height, P = LV.poh, s = W / 1280; x.fillStyle = "#060807"; x.fillRect(0, 0, W, Hh); x.textBaseline = "top"; x.textAlign = "left";
    x.fillStyle = "#4dde6f"; x.font = "600 " + Math.round(22 * s) + "px " + FONT; x.fillText("A RUNNING CHAIN OF SHA-256, COMPUTED HERE", 26 * s, 18 * s); x.fillStyle = "rgba(230,223,207,0.55)"; x.font = "500 " + Math.round(14 * s) + "px " + FONT; x.fillText("it can only be computed one step at a time, so its order proves that time passed", 26 * s, 48 * s);
    P.rows.forEach(function (rw, i) { var y = 86 * s + i * 42 * s, a = 1 - i * 0.12; x.fillStyle = "rgba(77,222,111," + a + ")"; x.font = "600 " + Math.round(18 * s) + "px " + MONO; x.fillText("#" + String(rw[0]).padStart(6, "0"), 26 * s, y); x.fillStyle = "rgba(244,236,220," + a + ")"; x.font = "500 " + Math.round(18 * s) + "px " + MONO; x.fillText(rw[1], 150 * s, y); if (i < P.rows.length - 1) { x.fillStyle = "rgba(77,222,111," + a * 0.6 + ")"; x.fillText("↑", 110 * s, y + 20 * s); } }); Lv.T.t.needsUpdate = true; }
  function drawKiosk(Lv) { var x = Lv.T.x, W = Lv.T.cv.width, Hh = Lv.T.cv.height, K0 = LV.kiosk; x.fillStyle = "#0b0d0e"; x.fillRect(0, 0, W, Hh); x.textAlign = "left"; x.textBaseline = "top"; x.fillStyle = "#f2a33a"; x.font = "600 30px " + FONT; x.fillText((C("hash.title", "Hash a block")).toUpperCase(), 22, 20); x.fillStyle = "rgba(230,223,207,0.7)"; x.font = "500 16px " + FONT; x.fillText(C("hash.sub", ""), 22, 60);
    var w = K0.last || ["clay", "ledger", "genesis", "giving"][((nowMs() / 2600) | 0) % 4], h = K0.hash || shaHex(w); x.fillStyle = "#f4ecdc"; x.font = "600 26px " + MONO; x.fillText("“" + w.slice(0, 16) + "”", 22, 100); x.fillStyle = "#5dff8a"; x.font = "500 17px " + MONO; for (var r = 0; r < 4; r++) x.fillText(h.slice(r * 16, r * 16 + 16), 22, 146 + r * 22); x.fillStyle = "#f2a33a"; x.font = "600 15px " + FONT; x.fillText("PRESS E", W - 100, Hh - 30); Lv.T.t.needsUpdate = true; }
  function drawMap(Lv) { var x = Lv.T.x, W = Lv.T.cv.width, Hh = Lv.T.cv.height, s = W / 1024, Mp = LV.map, nodes = C("donation.nodes", ["GIVER", "SIGNED", "TREASURY", "PROTOCOL", "RECIPIENT"]); x.fillStyle = "#0a1610"; x.fillRect(0, 0, W, Hh);
    x.strokeStyle = "rgba(77,222,111,0.08)"; x.lineWidth = 1; for (var gx = 0; gx < W; gx += 32 * s) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, Hh); x.stroke(); } for (var gy = 0; gy < Hh; gy += 32 * s) { x.beginPath(); x.moveTo(0, gy); x.lineTo(W, gy); x.stroke(); }
    x.textAlign = "left"; x.textBaseline = "top"; x.fillStyle = "#4dde6f"; x.font = "600 " + Math.round(30 * s) + "px " + FONT; x.fillText((C("donation.title", "Follow a donation")).toUpperCase(), 30 * s, 24 * s); x.fillStyle = "rgba(244,236,220,0.6)"; x.font = "500 " + Math.round(16 * s) + "px " + FONT; x.fillText(Mp.on ? "a demo gift, hop by hop (an illustration)" : "press E at the table to send a demo gift", 30 * s, 64 * s);
    var P = nodes.map(function (n, i) { return [100 * s + i * (W - 200 * s) / (nodes.length - 1), Hh * 0.55 + (i % 2 ? -50 : 40) * s]; }); var prog = Mp.on ? Mp.t / 3.2 : -1;
    for (var i = 0; i < P.length - 1; i++) { var lit = prog > i; x.strokeStyle = lit ? "#4dde6f" : "rgba(77,222,111,0.3)"; x.lineWidth = (lit ? 5 : 3) * s; x.setLineDash(lit ? [] : [10 * s, 8 * s]); x.beginPath(); x.moveTo(P[i][0], P[i][1]); x.lineTo(P[i + 1][0], P[i + 1][1]); x.stroke(); } x.setLineDash([]);
    P.forEach(function (p, i) { var on = prog >= i - 0.02 && prog >= 0; x.fillStyle = on ? "#4dde6f" : "#14251a"; x.strokeStyle = "#4dde6f"; x.lineWidth = 3 * s; x.beginPath(); x.arc(p[0], p[1], 30 * s, 0, TAU); x.fill(); x.stroke(); x.fillStyle = on ? "#0a1610" : "#4dde6f"; x.font = "600 " + Math.round(18 * s) + "px " + MONO; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(String(i + 1), p[0], p[1]); x.fillStyle = "#f4ecdc"; x.font = "600 " + Math.round(16 * s) + "px " + FONT; x.fillText(nodes[i], p[0], p[1] + (i % 2 ? -52 : 52) * s); });
    if (prog >= 0 && prog < P.length - 1) { var k = Math.floor(prog), f = prog - k, a = P[k], b = P[Math.min(P.length - 1, k + 1)], dx = a[0] + (b[0] - a[0]) * f, dy = a[1] + (b[1] - a[1]) * f; var gr = x.createRadialGradient(dx, dy, 0, dx, dy, 34 * s); gr.addColorStop(0, "rgba(244,205,90,1)"); gr.addColorStop(1, "rgba(244,205,90,0)"); x.fillStyle = gr; x.beginPath(); x.arc(dx, dy, 34 * s, 0, TAU); x.fill(); }
    if (Mp.sig) { x.textAlign = "left"; x.textBaseline = "top"; x.fillStyle = "rgba(244,236,220,0.7)"; x.font = "500 " + Math.round(14 * s) + "px " + MONO; x.fillText("signature  " + Mp.sig, 30 * s, Hh - 44 * s); }
    Lv.T.t.needsUpdate = true; }
  // which rooms get the near canvases: the one the camera is in (or nearest) and its nearest neighbour along the chain
  function nearFrame() { var L = IN.L, NN = CM.near; if (!L || !NN || !L.near) return; var cam = camera.position, q = w2l(cam.x, cam.z), S = SITE; if (chainDist(q[0], q[1]) > 14) { NN.forEach(function (N) { if (N.bi >= 0 && L.near[N.bi]) L.near[N.bi].mesh.visible = false; }); return; }
    var order = S.blocks.map(function (b, i) { return [i, Math.max(0, Math.abs(q[0] - b.cx) - b.w / 2)]; }).sort(function (a, b) { return a[1] - b[1]; }).map(function (a) { return a[0]; }).filter(function (i) { return !!L.near[i]; }); var want = order.slice(0, NN.length);
    NN.forEach(function (N) { if (N.bi >= 0 && want.indexOf(N.bi) < 0) { if (L.near[N.bi]) L.near[N.bi].mesh.visible = false; N.bi = -1; N.ready = false; } });
    want.forEach(function (bi) { if (NN.some(function (N) { return N.bi === bi; })) return; var free = NN.filter(function (N) { return N.bi < 0; })[0]; if (!free) return; free.bi = bi; free.k = 0; free.ready = false; free.x.setTransform(1, 0, 0, 1, 0, 0); free.x.fillStyle = "#101315"; free.x.fillRect(0, 0, free.cv.width, free.cv.height); });
    NN.forEach(function (N) { if (N.ready && N.bi >= 0 && L.near[N.bi]) L.near[N.bi].mesh.visible = true; });
    if (!fontsReady()) return; for (var i = 0; i < NN.length; i++) { var N = NN[i]; if (N.bi < 0 || N.ready) continue; var R0 = L.near[N.bi]; if (N.k < R0.slots.length) { drawNearSlot(N, R0.slots, N.k); N.k++; } if (N.k >= R0.slots.length) { N.ready = true; N.t.needsUpdate = true; R0.mat.map = N.t; R0.mesh.visible = true; } break; } }
  function liveFrame(dt) { var L = IN.L; if (!L || !L.g.visible) return; nearFrame(); var t = nowMs() / 1000, cam = camera.position, q = w2l(cam.x, cam.z), inside = inMuseum(cam.x, cam.y, cam.z);
    var near = function (lx, lz, r) { return Math.hypot(q[0] - lx, q[1] - lz) < r; };
    // Block Zero: the block turns and breathes, its rain scrolls; the show wall tells the story (faster while you sit)
    if (L.anim.cube && near(L.cube[0], L.cube[2], 40)) { var cg = L.anim.cube; cg.rotation.y += dt * 0.18; cg.position.y = L.cube[1] + Math.sin(t * 0.8) * 0.06; var tx = L.anim.cubeTex.t; tx.offset.y = (t * 0.06) % 1; }
    var lsh = L.live.show; if (lsh && near(L.show[0], L.show[2], 30)) { var S0 = LV.show, seat = showSeat(), per = seat ? 4.2 : 6.5, caps = C("galleries", [])[3] ? C("galleries", [])[3].show || [] : []; if (t - S0.at > per) { S0.at = t; S0.i = (S0.i + 1) % Math.max(1, caps.length); if (seat) { S0.seen++; if (S0.seen >= 3) stamp(C("progress.blockzero", "p_cm_blockzero")); } else S0.seen = 0; }
      var k = clamp((t - S0.at) / 0.6, 0, 1) * clamp((per - (t - S0.at)) / 0.6, 0, 1); var kq = Math.round(k * 20); if ((FRAME_N & 1) === 0 && (kq !== S0.kq || S0.ci !== S0.i)) { S0.kq = kq; S0.ci = S0.i; drawShow(lsh.T, caps[S0.i], k); } }   // only while it fades
    var lk = L.live.kiosk; if (lk && near(L.kiosk[0], L.kiosk[1], 18) && t - lk.at > 0.5) { lk.at = t; drawKiosk(lk); }
    // proof of history: a real running SHA-256 chain, four ticks a second
    if (L.ring && near(L.ring[0], L.ring[2], 34)) { var P = LV.poh; if (t - P.at > 0.34) { P.at = t; pohTick(); if (L.live.ring) drawRing(L.live.ring); if (L.live.poh) drawPohWall(L.live.poh); }
      var R0 = L.ring[3] - 0.13; L.anim.ringHeads.forEach(function (hm, i) { var a = ((P.n - i) % 64) / 64 * TAU; hm.position.set(L.ring[0] + Math.sin(a) * R0, L.ring[1] + Math.cos(a) * R0, L.ring[2] - 0.045); hm.rotation.z = -a; }); }
    // the ledger wall: a new block every few seconds, slid in from the right
    var ll = L.live.ledger; if (ll && near(L.ledger[0], L.ledger[2], 30)) { var Lg = LV.ledger; if (!Lg.blocks.length) for (var i = 0; i < 7; i++) ledgerAdd(GIFTS[i % GIFTS.length]); if (t - Lg.at > 3.6) { Lg.at = t; ledgerAdd(GIFTS[(Lg.n * 7) % GIFTS.length]); } var lb = Lg.blocks[Lg.blocks.length - 1], sliding = lb && nowMs() - lb.t < 1000; if (((FRAME_N % 3) === 0 && sliding) || Lg.drawnN !== Lg.n) { if (!sliding) Lg.drawnN = Lg.n; drawLedger(ll, dt); } }   // redrawn while a block slides in
    var lm = L.live.map; if (lm && near(L.map[0], L.map[1], 26)) { mapFrame(dt); var mk = LV.map.on ? 1 : 0; if ((LV.map.on && (FRAME_N & 1) === 0) || LV.map.drawn !== mk + ":" + (LV.map.sig || "")) { LV.map.drawn = mk + ":" + (LV.map.sig || ""); drawMap(lm); } }
    // the Lobby's hanging chain: a light that runs block to block; the shared computer pulses as one; the land model's cursor
    if (L.anim.chainRun && near(56, SITE.zc, 30)) { var n = L.chain.length, p = (t * 0.9) % (n + 1.5), j = Math.min(n - 1, Math.floor(p)); var cr = L.anim.chainRun; cr.position.set(L.chain[j], 5.7, SITE.zc); var f = p - j; cr.material.opacity = p > n ? 0 : 0.55 * Math.sin(Math.min(1, f) * PI); }
    if (L.anim.nodes && near(-8.3, SITE.zc, 26)) { var pk = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * 2.4), 3); L.anim.nodes.material.color.setRGB(0.56 * pk + 0.1, 0.56 * pk + 0.1, 0.94 * pk + 0.15); }
    if (L.anim.here) L.anim.here.material.opacity = 0.55 + 0.45 * Math.sin(t * 3.2);
    if (L.anim.cursor && near(-32.3, SITE.zc, 26)) { if (t - L.anim.cursorAt > 1.1) { L.anim.cursorAt = t; var tl = L.tiles[(Math.random() * L.tiles.length) | 0]; L.anim.cursor.position.set(tl[0], tl[1] + 0.012, tl[2]); } L.anim.cursor.material.opacity = 0.5 + 0.4 * Math.sin(t * 6); }
    void inside; }
  function showSeat() { try { if (!(typeof SIT !== "undefined" && SIT.on) || !IN.L || !IN.L.showSeats) return false; var q = w2l(player.position.x, player.position.z); return IN.L.showSeats.some(function (s) { return Math.abs(q[0] - s[0]) < 1.3 && Math.abs(q[1] - s[1]) < 0.7; }); } catch (e) { return false; } }

  // ───────────────────────── the hash kiosk (E at the terminal in Gallery 4): a DOM card, SHA-256 computed live ─────────────────────────
  var HK = CM.hk = CM.hk || { on: false, el: null, prev: "", mine: null, chain: null };
  function hkCss() { if ($id("cm-css")) return; var st = document.createElement("style"); st.id = "cm-css"; st.textContent = [
    "#cm-hk{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(760px,94vw);max-height:90vh;overflow:auto;z-index:60;background:rgba(8,13,8,.96);border:1px solid #2fae57;border-radius:14px;color:#f5f1e6;font:15px/1.45 'Space Grotesk',system-ui,sans-serif;padding:22px 24px;box-shadow:0 20px 60px rgba(0,0,0,.6)}",
    "#cm-hk h2{margin:0;font:400 34px/1 Anton,Impact,sans-serif;letter-spacing:.04em;color:#4dde6f}#cm-hk .sub{opacity:.7;margin:4px 0 14px}#cm-hk .sec{border-top:1px solid rgba(77,222,111,.25);padding-top:12px;margin-top:12px}",
    "#cm-hk input{width:100%;box-sizing:border-box;background:#0a1610;border:1px solid #2fae57;border-radius:8px;color:#f5f1e6;font:600 18px 'JetBrains Mono',monospace;padding:9px 12px;outline:none}#cm-hk input:focus{border-color:#4dde6f}",
    "#cm-hk .hx{font:500 15px/1.5 'JetBrains Mono',monospace;word-break:break-all;color:#cfeedd;background:#0a1610;border-radius:8px;padding:8px 10px;margin-top:8px}#cm-hk .hx b{color:#f4cd5a;font-weight:600}#cm-hk .hx i{font-style:normal;color:#4dde6f}",
    "#cm-hk .k{font:600 12px 'JetBrains Mono',monospace;letter-spacing:.08em;color:#4dde6f;text-transform:uppercase;margin-bottom:6px}#cm-hk .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px}",
    "#cm-hk button{background:#4dde6f;color:#0a1610;border:0;border-radius:8px;font:600 14px 'Space Grotesk',sans-serif;padding:8px 14px;cursor:pointer}#cm-hk button.g{background:transparent;color:#4dde6f;border:1px solid #2fae57}",
    "#cm-hk .blks{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:8px}#cm-hk .blk{border:1px solid #2fae57;border-radius:10px;padding:8px;font:500 12px/1.4 'JetBrains Mono',monospace;word-break:break-all}#cm-hk .blk.bad{border-color:#ff9180;background:rgba(255,145,128,.08)}#cm-hk .blk input{font-size:13px;padding:5px 7px;margin:4px 0}",
    "#cm-hk .ok{color:#4dde6f}#cm-hk .no{color:#ff9180}#cm-hk .x{position:absolute;right:14px;top:12px}",
    "#cm-cap{position:fixed;left:50%;bottom:9vh;transform:translateX(-50%);width:min(640px,92vw);z-index:55;background:rgba(8,13,8,.92);border:1px solid #2fae57;border-left:5px solid #4dde6f;border-radius:10px;color:#f5f1e6;font:15px/1.45 'Space Grotesk',system-ui,sans-serif;padding:12px 16px;pointer-events:none;transition:opacity .35s}#cm-cap b{display:block;font:600 12px 'JetBrains Mono',monospace;letter-spacing:.1em;color:#4dde6f;text-transform:uppercase;margin-bottom:3px}"].join("\n"); document.head.appendChild(st); }
  function hkKeys(e) { if (!HK.on) return; var tg = e.target; if (e.code === "Escape") { closeKiosk(); e.preventDefault(); e.stopImmediatePropagation(); return; } if (tg && tg.tagName === "INPUT" && HK.el && HK.el.contains(tg)) return; e.stopImmediatePropagation(); }
  function openKiosk() { if (HK.on) return true; hkCss(); var H0 = C("hash", {}) || {}; var el = document.createElement("div"); el.id = "cm-hk";
    el.innerHTML = "<button class='g x' data-a='close'>" + esc(H0.close || "Close") + "</button><h2>" + esc(H0.title || "Hash a block") + "</h2><div class='sub'>" + esc(H0.sub || "") + "</div>" +
      "<div class='k'>" + esc(H0.type || "Type anything") + "</div><input id='cm-w' maxlength='64' autocomplete='off' spellcheck='false' placeholder='" + esc(H0.placeholder || "") + "'><div class='hx' id='cm-h'></div><div class='sub' id='cm-d' style='margin:6px 0 0'></div>" +
      "<div class='sec'><div class='k'>" + esc(H0.mine || "Mine it") + "</div><div class='sub' style='margin:0'>" + esc(H0.target || "") + "</div><div class='row'><button data-a='mine'>" + esc(H0.mine || "Mine it") + "</button><span id='cm-m'></span></div><div class='hx' id='cm-mh' style='display:none'></div></div>" +
      "<div class='sec'><div class='k'>" + esc(H0.chain || "") + "</div><div class='blks' id='cm-c'></div><div class='row'><button class='g' data-a='remine'>Re-mine all</button></div></div>" +
      "<div class='sec'><div class='k'>" + esc(H0.genesis || "") + "</div><div class='row'><button data-a='gen'>" + esc(H0.genesis || "") + "</button></div><div id='cm-g'></div></div>";
    document.body.appendChild(el); HK.el = el; HK.on = true; try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
    if (!HK.keysOn) { HK.keysOn = true; addEventListener("keydown", hkKeys, true); addEventListener("keyup", function (e) { if (HK.on && !(e.target && e.target.tagName === "INPUT")) e.stopImmediatePropagation(); }, true); }
    var w = $id("cm-w"); w.addEventListener("input", function () { hkHash(w.value); }); w.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.code === "Enter") hkMine(); }); w.addEventListener("keyup", function (e) { e.stopPropagation(); });
    el.addEventListener("click", function (e) { var a = e.target && e.target.getAttribute && e.target.getAttribute("data-a"); if (a === "close") closeKiosk(); else if (a === "mine") hkMine(); else if (a === "remine") hkChainInit(true); else if (a === "gen") hkGenesis(); });
    ["mousedown", "pointerdown", "wheel"].forEach(function (ev) { el.addEventListener(ev, function (e) { e.stopPropagation(); }); });
    w.value = HK.prev || "genesis"; hkHash(w.value); hkChainInit(false); setTimeout(function () { try { w.focus(); w.select(); } catch (e) {} }, 30); return true; }
  function closeKiosk() { if (!HK.on) return; HK.on = false; HK.mine = null; try { HK.el.remove(); } catch (e) {} HK.el = null; }
  function hkHash(word) { var h = shaHex(word), d = HK.lastHash ? bitsDiff(HK.lastHash, h) : 0; var out = ""; for (var i = 0; i < 64; i++) { var ch = h[i]; out += HK.lastHash && HK.lastHash[i] !== ch ? "<b>" + ch + "</b>" : ch; } var el = $id("cm-h"); if (el) el.innerHTML = out;
    var dd = $id("cm-d"); if (dd) dd.textContent = HK.lastHash ? d + " / 256 " + C("hash.bits", "") : ""; HK.lastHash = h; HK.prev = word; LV.kiosk.last = word; LV.kiosk.hash = h; if (word && word.length) stamp(C("progress.hash", "p_cm_hash")); }
  // mining: find a nonce so SHA-256(previous hash | word | nonce) starts with 000; a few hundred tries a frame so you can watch it run
  function hkMine() { var w = ($id("cm-w") || {}).value || ""; var prev = LV.ledger.blocks.length ? LV.ledger.blocks[LV.ledger.blocks.length - 1].h : "0".repeat(64); HK.mine = { w: w, prev: prev, n: 0, t0: nowMs() }; var m = $id("cm-m"); if (m) m.textContent = C("hash.mining", "Mining") + " ..."; }
  function hkMineFrame() { var M0 = HK.mine; if (!M0) return; var t0 = nowMs(); while (nowMs() - t0 < 3) { var h = shaHex(M0.prev + "|" + M0.w + "|" + M0.n); if (h.slice(0, 3) === "000") { HK.mine = null; var m = $id("cm-m"); if (m) m.innerHTML = "<span class='ok'>" + esc(C("hash.mined", "Mined")) + "</span> nonce " + M0.n + " &middot; " + M0.n + " tries &middot; " + Math.round(nowMs() - M0.t0) + " ms"; var mh = $id("cm-mh"); if (mh) { mh.style.display = ""; mh.innerHTML = "<i>000</i>" + h.slice(3) + "<br><span style='opacity:.6'>" + esc(C("hash.added", "")) + "</span>"; }
        ledgerAdd(M0.w.slice(0, 18) || "a word", true); stamp(C("progress.mine", "p_cm_mine")); return; } M0.n++; } var m2 = $id("cm-m"); if (m2) m2.textContent = C("hash.mining", "Mining") + " ... nonce " + M0.n; }
  // three linked blocks: edit one and the links after it break until they are mined again
  function hkMineBlock(b) { b.nonce = 0; while (true) { var h = shaHex(b.prev + "|" + b.data + "|" + b.nonce); if (h.slice(0, 3) === "000") { b.hash = h; return; } b.nonce++; if (b.nonce > 400000) { b.hash = h; return; } } }
  function hkChainInit(remine) { if (!HK.chain || remine) { var old = HK.chain; HK.chain = [0, 1, 2].map(function (i) { return { data: old ? old[i].data : ["Gift to a school", "Gift to a food bank", "Gift to a shelter"][i], prev: "", nonce: 0, hash: "" }; }); var prev = "0".repeat(64); HK.chain.forEach(function (b) { b.prev = prev; hkMineBlock(b); prev = b.hash; }); } hkChainDraw(); }
  function hkChainDraw() { var box = $id("cm-c"); if (!box || !HK.chain) return; var html = ""; HK.chain.forEach(function (b, i) { var cur = shaHex(b.prev + "|" + b.data + "|" + b.nonce), linkOk = i === 0 ? b.prev === "0".repeat(64) : b.prev === shaHex(HK.chain[i - 1].prev + "|" + HK.chain[i - 1].data + "|" + HK.chain[i - 1].nonce), ok = cur.slice(0, 3) === "000" && linkOk;
      html += "<div class='blk" + (ok ? "" : " bad") + "'><div class='k' style='margin:0'>Block " + (i + 1) + "</div><input data-i='" + i + "' value='" + esc(b.data) + "'>prev <span class='" + (linkOk ? "ok" : "no") + "'>" + b.prev.slice(0, 10) + "</span><br>nonce " + b.nonce + "<br>hash <span class='" + (cur.slice(0, 3) === "000" ? "ok" : "no") + "'>" + cur.slice(0, 14) + "</span><br>" + (ok ? "<span class='ok'>valid</span>" : "<span class='no'>broken</span>") + "</div>"; });
    box.innerHTML = html; Array.prototype.forEach.call(box.querySelectorAll("input"), function (inp) { inp.addEventListener("keydown", function (e) { e.stopPropagation(); }); inp.addEventListener("keyup", function (e) { e.stopPropagation(); }); inp.addEventListener("change", function () { var i = +inp.getAttribute("data-i"); HK.chain[i].data = inp.value.slice(0, 40); hkChainDraw(); }); }); }
  function hkGenesis() { var g = genesisHash(), el = $id("cm-g"); if (!el) return; var hdr = GENESIS_HDR; el.innerHTML = "<div class='sub' style='margin:8px 0 0'>" + esc(C("hash.genesisNote", "")) + "</div><div class='hx'>" + hdr.slice(0, 8) + " " + hdr.slice(8, 72) + " " + hdr.slice(72, 136) + " " + hdr.slice(136, 144) + " " + hdr.slice(144, 152) + " " + hdr.slice(152) + "</div><div class='hx'><i>" + g.slice(0, 10) + "</i>" + g.slice(10) + "</div><div class='sub ok' style='margin:4px 0 0'>" + (g.slice(0, 10) === "0000000000" ? esc(C("hash.zeros", "")) : "") + "</div>"; stamp(C("progress.blockzero", "p_cm_blockzero")); }

  // ───────────────────────── follow a donation (E at the map table in Gallery 8) ─────────────────────────
  var CAP = { el: null, at: 0 };
  function caption(head, text) { hkCss(); if (!CAP.el) { CAP.el = document.createElement("div"); CAP.el.id = "cm-cap"; document.body.appendChild(CAP.el); } CAP.el.innerHTML = "<b>" + esc(head) + "</b>" + esc(text); CAP.el.style.opacity = "1"; CAP.at = nowMs(); }
  function captionOff() { if (CAP.el) CAP.el.style.opacity = "0"; }
  function startDonation() { var Mp = LV.map; Mp.on = true; Mp.t = 0; Mp.step = -1; Mp.sig = null; var seed = shaHex("gift|" + Date.now()); var B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz", sig = ""; for (var i = 0; i < 44; i++) sig += B58[parseInt(seed.substr((i * 3) % 60, 3), 16) % 58]; Mp.sig = sig.slice(0, 10) + "..." + sig.slice(-8) + "  (demo)"; return true; }
  function mapFrame(dt) { var Mp = LV.map; if (!Mp.on) return; var steps = C("donation.steps", []) || []; Mp.t += dt; var st = Math.min(steps.length - 1, Math.floor(Mp.t / 3.2)); if (st !== Mp.step) { Mp.step = st; var s = steps[st]; if (s) caption((st + 1) + " / " + steps.length + "  " + s.n, s.p); }
    var q = w2l(player.position.x, player.position.z), L = IN.L; if (L && L.map && Math.hypot(q[0] - L.map[0], q[1] - L.map[1]) > 9) { Mp.on = false; captionOff(); return; }
    if (Mp.t > steps.length * 3.2 + 0.6) { Mp.on = false; caption(C("donation.title", ""), C("donation.done", "")); setTimeout(captionOff, 4200); stamp(C("progress.donation", "p_cm_donation")); try { setStatus(C("status.mapDone", "")); } catch (e) {} } }

  // ───────────────────────── E at the kiosk and the map table; the prompt ─────────────────────────
  function atKiosk() { var L = IN.L; if (!L || !L.kiosk || !player) return false; var q = w2l(player.position.x, player.position.z); return Math.hypot(q[0] - L.kiosk[2], q[1] - L.kiosk[3]) < 1.5 && Math.abs(player.position.y - SITE.G) < 1.2; }
  function atMap() { var L = IN.L; if (!L || !L.map || !player) return false; var q = w2l(player.position.x, player.position.z); return Math.abs(q[0] - L.map[0]) < L.map[2] / 2 + 1.1 && Math.abs(q[1] - L.map[1]) < L.map[3] / 2 + 1.1 && Math.abs(player.position.y - SITE.G) < 1.2; }
  function handleE() { if (CM.off || !SITE || !CM.ready) return false; if (HK.on) { closeKiosk(); return true; } if (typeof SIT !== "undefined" && SIT.on) return false; if (busy()) return false; if (atKiosk()) return openKiosk(); if (atMap() && !LV.map.on) return startDonation(); return false; }
  function promptFrame() { try { if (HK.on || !CM.ready || busy() || (typeof SIT !== "undefined" && SIT.on)) return; var k = atKiosk() ? C("prompts.hash", "hash a block") : atMap() && !LV.map.on ? C("prompts.map", "follow a donation") : null; if (!k) return; var el2 = $id("prompt"), t = $id("prompt-t"); if (!el2 || !t) return; t.innerHTML = "<b>E</b> &nbsp;" + esc(k); el2.classList.add("on"); } catch (e) { note("prompt", e); } }

  // ───────────────────────── indoors: one shared shader patch cuts the sky's share (hemisphere and environment) inside the rooms ─────────────────────────
  // and adds a warm house term at night, so the pool lamps, the emissive fixtures and the light through the screens carry the rooms.
  var CMU = CM.u = CM.u || { uCmF: { value: new THREE.Vector4() }, uCmP: { value: new THREE.Vector4(0, 0, 0.42, 0.1) }, uCmB: { value: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function () { return new THREE.Vector4(0, 0, 0, 0); }) }, uCmL: { value: new THREE.Vector4() } };
  function indoorObc(sh) { for (var k in CMU) sh.uniforms[k] = CMU[k];
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vCmW;").replace("#include <project_vertex>", "#include <project_vertex>\n{ vec4 cmWp = vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\ncmWp = instanceMatrix * cmWp;\n#endif\nvCmW = ( modelMatrix * cmWp ).xyz; }");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vCmW; uniform vec4 uCmF; uniform vec4 uCmP; uniform vec4 uCmB[9]; uniform vec4 uCmL;\n" +
      "float cmInside( vec3 w ) { vec2 d = w.xz - uCmF.xy; float lx = d.x * uCmF.z - d.y * uCmF.w, lz = d.x * uCmF.w + d.y * uCmF.z, ly = w.y - uCmP.x, az = abs( lz - uCmP.y );\n" +
      "  if ( lx < uCmB[8].x - 0.3 || lx > uCmB[0].y + 0.3 || az > 7.5 || ly > 10.8 || ly < -0.6 ) return 0.0; float k = 0.0;\n" +
      "  for ( int i = 0; i < 9; i ++ ) { vec4 b = uCmB[i]; float m = min( min( lx - b.x, b.y - lx ), min( b.z - az, b.w - ly ) ); k = max( k, smoothstep( 0.12, 0.32, m ) ); }\n" +
      "  k = max( k, smoothstep( 0.02, 0.2, min( uCmL.x - az, uCmL.y - ly ) ) ); return k; }\n" +
      // a macro tone and roughness breakup in world space (two octaves of value noise), so the 2 m concrete repeat never reads as tiles
      "float cmH( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }\n" +
      "float cmN( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f ); return mix( mix( cmH( i ), cmH( i + vec2( 1.0, 0.0 ) ), f.x ), mix( cmH( i + vec2( 0.0, 1.0 ) ), cmH( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }\n" +
      "float cmMacro( vec3 w ) { vec2 q = vec2( w.x + w.y * 0.61, w.z - w.y * 0.37 ); return cmN( q * 0.23 ) * 0.65 + cmN( q * 0.9 + 17.0 ) * 0.35; }")
      .replace("#include <map_fragment>", "#include <map_fragment>\n{ float cmM = cmMacro( vCmW ); diffuseColor.rgb *= 0.94 + 0.12 * cmM; }")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp( roughnessFactor * ( 0.93 + 0.14 * cmMacro( vCmW + 3.1 ) ), 0.03, 1.0 );")
      .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\n{ float cmK = cmInside( vCmW ); reflectedLight.indirectDiffuse *= mix( 1.0, uCmP.z, cmK ); reflectedLight.indirectSpecular *= mix( 1.0, uCmP.z * 0.9, cmK ); reflectedLight.indirectDiffuse += cmK * uCmP.w * vec3( 1.0, 0.85, 0.66 ) * BRDF_Lambert( material.diffuseColor ); }"); }
  function indoorKey() { return "cm-indoor-r17a"; }
  function patchIndoor(m) { if (!m || m.userData.cmIndoor) return; m.userData.cmIndoor = true; var own = m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey; m.onBeforeCompile = indoorObc; if (own) m.customProgramCacheKey = indoorKey; m.needsUpdate = true; }   // with the cascades on, the client's material class already keys the program by the hook
  function indoorUniforms() { var S = SITE; CMU.uCmF.value.set(S.cx, S.cz, S.c, S.s); CMU.uCmP.value.x = S.G; CMU.uCmP.value.y = S.zc; S.blocks.forEach(function (b, i) { CMU.uCmB.value[i].set(b.x0, b.x1, b.d / 2, b.h); }); CMU.uCmL.value.set(S.LW / 2, S.LH, 0, 0); }

  // ───────────────────────── the solids: every wall, glass, column, plinth, case, desk and bench (seats), registered at load ─────────────────────────
  function siteSolids() { if (IN.solidsDone) return; IN.solidsDone = true; var S = SITE, t0 = nowMs(), list = [];
    try { list = buildExterior(true) || []; } catch (e) { note("ext solids", e); }
    try { var L = newL(true), it = buildInteriorSteps(L), r; do { r = it.next(); } while (!r.done); list = list.concat(L.sol); IN.dryL = { kiosk: L.kiosk, map: L.map, showSeats: L.showSeats, docent: L.docent, panels: L.panels }; } catch (e) { note("int solids", e); }
    IN.solids = []; list.forEach(function (q) { var w = l2w(q[0], q[1]); var sd = addSolid(w[0], w[1], S.th + (q[6] || 0), q[2], q[3], S.G + q[4] - 0.2, S.G + q[5], "chainmuseum"); if (sd) { if (q[7]) { sd.seat = true; if (typeof q[8] === "number") sd.face = q[8]; } else if (q[5] - q[4] > 1.0) sd.noStep = true; IN.solids.push(sd); } });
    CM.n.solids = IN.solids.length; CM.n.seats = IN.solids.filter(function (s) { return s.seat; }).length; CM.n.solidsMs = Math.round(nowMs() - t0); }

  // ───────────────────────── people: Lena at the welcome desk (a talk card), and a few visitors who roam the rooms (PLAN_ROAM) ─────────────────────────
  var STAFF = CM.staff = CM.staff || { list: [] };
  function buildDocent() { var D = C("docent", null); if (!D || typeof avatar !== "function" || STAFF.done || !IN.dryL || !IN.dryL.docent) return; if (siteDist(player.position.x, player.position.z) > 160) return; STAFF.done = true;
    try { var at = IN.dryL.docent, w = l2w(at[0], at[1]); var look = { body: "f", skin: "b07a55", shirt: "1f3d2a", pants: "23262b", hair: 7, hairc: "1d1410", shoes: "1c1f24" };
      var g = avatar(D.id, D.name, look, null, null); g.position.set(w[0], SITE.G + 0.03, w[1]); g.rotation.y = yawW(at[2]); try { g.userData.label.scale.set(1.7, 0.43, 1); } catch (e) {} scene.add(g);
      var talk = (D.talk || []).map(function (q) { return { t: q.t, o: q.o }; }); var c = { id: D.id, name: D.name, role: D.role, pos: [w[0], w[1]], look: look, hat: null, outfit: null, greet: D.greet || ["Welcome."], talk: talk, kw: [], g: g, rot: g.rotation.y };
      CAST.push(c); var hp = l2w(at[0] - 2.0, at[1]); var hs = { x: hp[0], z: hp[1], r: 2.6, t: c.name, k: c.role + " · press E to talk", p: talk[0] ? talk[0].t : "", play: "npc:" + c.id }; hotspots.push(hs); STAFF.list.push(c); STAFF.hs = hs; CM.n.staff = STAFF.list.length; } catch (e) { note("docent", e); } }
  function staffFrame(dt) { var cam = camera.position; STAFF.list.forEach(function (c) { var dd = Math.hypot(c.g.position.x - cam.x, c.g.position.z - cam.z); c.g.visible = dd < 70; if (c.g.visible && (FRAME_N & 1) === 0) try { animateWalk(c.g, 0, dt * 2); } catch (e) {} }); }
  function roamArea() { var RO = window.PLAN_ROAM; if (!RO || !RO.area || RO.off || CM.roamArea || !IN.solidsDone || !IN.dryL) return; var S = SITE, RC = C("roam", {}) || {}, zc = S.zc;
    var P = function (lx, lz, kind, line, faceL, tag, dur) { var w = l2w(lx, lz); return { kind: kind, line: line, x: w[0], z: w[1], face: yawW(faceL), tag: tag, dur: dur }; };
    var corners = [[S.x0 - 8, -10], [S.plaza[2] + 2, -10], [S.plaza[2] + 2, 56], [S.x0 - 8, 56]].map(function (q) { return l2w(q[0], q[1]); });
    var box = [Math.min.apply(null, corners.map(function (q) { return q[0]; })), Math.min.apply(null, corners.map(function (q) { return q[1]; })), Math.max.apply(null, corners.map(function (q) { return q[0]; })), Math.max.apply(null, corners.map(function (q) { return q[1]; }))];
    var walkable = function (lx, lz) { return chainDist(lx, lz) < 0.01 || inRect(lx, lz, S.plaza, 0) || inRect(lx, lz, S.exitT, 0) || (lx > S.exitT[0] && lx < S.plaza[0] + 0.5 && Math.abs(lz - S.walkZ) < S.walkW / 2) || (lx > S.exitT[0] && lx < S.exitT[0] + 3.4 && lz > S.exitT[3] - 0.5 && lz < S.walkZ) || (pathDist(lx, lz) < 1.45 && lz > 35 && lz < 57); };
    var def = { id: "chainmuseum", max: 6, box: box, perCat: true, pull: 3, people: (RC.people || []).slice(), lines: RC.lines || {},
      ready: function () { return !!CM.ready && IN.solidsDone; },
      levels: [{ base: function (x, z) { var q = w2l(x, z); return walkable(q[0], q[1]) ? SITE.G + 0.01 : planGroundAt(x, z); }, exact: true, block: function (x, z) { var q = w2l(x, z); if (!walkable(q[0], q[1])) return true; var b = blockAt(q[0], q[1], 0); if (!b && !linkAt(q[0], q[1], 0) && chainDist(q[0], q[1]) < 0.01) return true; return false; } }],
      entries: function () { return [P(35.75, 54, "", "", PI, "path"), P(S.exitT[0] + 1.5, S.walkZ, "", "", PI / 2, "walk")]; },
      seeds: function () { return def.entries().concat([P(56, zc + 4.5), P(4.5, zc - 1.6), P(-45, zc)]); },
      pois: function () { var out = []; (IN.dryL.panels || []).forEach(function (p) { var toward = p.z > zc ? 0 : PI; out.push(P(p.x, p.z + (p.z > zc ? -0.1 : 0.1), "look", p.gi < 0 ? "lobby" : "look", toward, p.gi < 0 ? "lobby" : "g" + p.gi, [8, 18])); });
        S.blocks.forEach(function (b, i) { if (i === 0) return; out.push(P(b.cx + 1.0, zc + 1.6, "chat", "chat", PI / 2, "aisle" + i, [12, 24])); });
        out.push(P(4.9, zc - 1.6, "look", "look", 0, "block0", [10, 20]), P(-20.3, zc + 1.5, "look", "look", 0, "ring", [10, 18]), P(-45.1, zc - 1.0, "look", "look", PI, "ledger", [10, 20]), P(-44.2, zc + 1.4, "look", "look", 0, "map", [8, 16]));
        out.push(P(51.5, 22.5, "look", "plaza", PI / 2, "stone", [8, 16]), P(57.0, 29.5, "chat", "plaza", PI, "plaza", [12, 22]), P(-20, S.walkZ, "look", "plaza", 0, "walk", [6, 12]), P(56.5, zc + 2.0, "look", "lobby", PI / 2, "desk", [6, 12]));
        return out; },
      seatInfo: function (s) { if (s.tag !== "chainmuseum") return null; return { kind: "sit", line: "sit", tag: "bench" }; },
      weight: function (p, h) { var k = p.kind, t = p.tag || ""; if (h < 8 || h > 21) return k === "sit" ? 0.4 : t === "stone" || t === "plaza" || t === "walk" ? 1.0 : 0.3; if (t.charAt(0) === "g" || t === "lobby") return 1.4; if (t === "block0" || t === "ring" || t === "ledger" || t === "map") return 1.8; if (k === "sit") return 0.8; return 1.0; },
      count: function (h) { return h < 8 || h > 21 ? 2 : h > 10 && h < 18 ? 6 : 4; },
      dur: { sit: [25, 60], chat: [14, 30], look: [8, 18] },
      visible: function (c) { var p = c.g.position; if (!IN.L) return !inMuseum(p.x, p.y + 1, p.z); return true; },
      sameZone: function (c) { var p = c.g.position, cam = camera.position; return inMuseum(p.x, p.y + 1, p.z) === inMuseum(cam.x, cam.y, cam.z); } };
    try { CM.roamArea = RO.area(def); } catch (e) { note("roam", e); } }

  // ───────────────────────── the camera in the rooms: kept inside the walls, first person when tight ─────────────────────────
  var FR = CM.fr = CM.fr || { inCam: false };
  function camHook(dt) {
    if (CM.off || !SITE || !CM.ready || window.__cam) return false;
    try { if (busy() || HK.on) { FR.inCam = false; return false; } if (typeof SIT !== "undefined" && SIT.on && !FR.inCam) return false;
      var px = player.position.x, py = player.position.y, pz = player.position.z; if (!inMuseum(px, py + 1, pz)) { if (FR.inCam) { FR.inCam = false; try { player.userData.walk.visible = true; } catch (e) {} } return false; }
      FR.inCam = true; var fwd = [-Math.sin(yaw), -Math.cos(yaw)], by = typeof bobY === "number" ? bobY : 0, cy0 = py - by + 1.9, maxD = cartMode ? 7 : 5.5, dist = 0;
      for (var d = 0.2; d <= maxD; d += 0.2) { var cx = px - fwd[0] * d, cz = pz - fwd[1] * d; if (!inMuseum(cx, cy0 + d * 0.15 - 0.6, cz)) break; dist = d; }
      if (FR.fp === undefined) FR.fp = dist < 1.3; else if (FR.fp && dist > 2.1) FR.fp = false; else if (!FR.fp && dist < 1.1) FR.fp = true;
      CAM.dist += (dist - CAM.dist) * smoothK(dt, 10); var sd = Math.min(dist, CAM.dist);
      if (FR.fp && !cartMode) { camera.position.set(px, py - by + 1.62, pz); CAM.init = false; camera.lookAt(px + fwd[0] * 10, camera.position.y - pitch * 6, pz + fwd[1] * 10); player.userData.walk.visible = false; }
      else { var cy = cy0 + pitch * 1.4 + sd * 0.15; camera.position.lerp(camTarget.set(px - fwd[0] * sd, cy, pz - fwd[1] * sd), smoothK(dt, 24)); camLook(px, py + 1.3, pz, dt, 30); player.userData.walk.visible = true; }
      return true; } catch (e) { note("cam", e); return false; } }

  // ───────────────────────── every frame ─────────────────────────
  var VIS = CM.vis = CM.vis || { g: {}, stamped: {} };
  function frameHook(dt, now) {
    if (CM.off || !SITE || !CM.ready) return; dt = Math.min(dt || 0.016, 0.1);
    try {
      var nk = clamp((nightK() - 0.02) * 3.2, 0, 1), cam = camera.position, qc = w2l(cam.x, cam.z), dc = Math.max(0, chainDist(qc[0], qc[1])), px = player.position.x, pz = player.position.z, qp = w2l(px, pz);
      var inCamM = inMuseum(cam.x, cam.y, cam.z), inPl = inMuseum(px, player.position.y + 1, pz); CM.zone = inCamM ? "in" : dc < 60 ? "near" : null;
      if ((FRAME_N % 20) === 0 || CM.nk === undefined) { CM.nk = nk; var M = mats(); CMU.uCmP.value.w = 0.1 + 0.55 * nk; if (M.lantern) M.lantern.opacity = 0.9 * nk; if (EX.lantern) EX.lantern.visible = nk > 0.02; if (M.screen) M.screen.emissiveIntensity = 0.1 * nk * nk; if (EX.washMat) { EX.washMat.opacity = 0.85 * nk; if (EX.wash) EX.wash.visible = nk > 0.02 && dc < 900; } if (EX.lobbyGlow) EX.lobbyGlow.visible = nk > 0.02 && !(IN.L && IN.L.g.visible); if (M.glow) M.glow.color.setScalar(0.62 + 0.5 * nk); if (LT && LT.mat) LT.mat.emissiveIntensity = 0.0 + 0.55 * nk;
        if (EX.lights) EX.lights.forEach(function (l) { l.intensity = dc < 160 ? l.userData.k0 * nk : 0; }); if (IN.L) { IN.L.lights.forEach(function (l) { var on = dc < 70 || inCamM; l.intensity = on ? l.userData.k0 * (0.7 + 0.6 * nk) : 0; }); if (IN.L.poolMat) IN.L.poolMat.color.setScalar(0.45 + 1.2 * nk); } }
      interiorFrame();
      if (CM.abOff) { if (EX.g) EX.g.visible = false; if (IN.L) IN.L.g.visible = false; } else { if (EX.g && !EX.g.visible) EX.g.visible = true; if (IN.L) { IN.L.g.visible = inCamM || dc < 90; liveFrame(dt); } }
      // the pulse along the chain line (night, and at dusk); a second one follows half a chain behind
      if (EX.pulse) { var on = nk > 0.05 && dc < 700; var Lc = EX.chainPath.L, sp = 9, t = (nowMs() / 1000 * sp) % (Lc + 20); EX.pulse.forEach(function (pm, i) { var d = (t + i * Lc / 2) % (Lc + 20); pm.visible = on && d < Lc; if (pm.visible) { var p = pulseAt(d); pm.position.set(p[0], p[1] + 0.02, p[2]); pm.material.opacity = 0.8 * nk; } }); }
      hkMineFrame(); promptFrame(); staffFrame(dt);
      if (nowMs() > (FR.staffAt || 0)) { FR.staffAt = nowMs() + 2000; try { buildDocent(); } catch (e) { note("staff", e); } try { roamArea(); } catch (e) { note("roam", e); } }
      // stamps: inside the museum, each gallery visited (the whole chain), Lena's talk card
      if (inPl) { if (!VIS.stamped.museum) { VIS.stamped.museum = 1; stamp(C("progress.museum", "p_cm_museum")); } var b = blockAt(qp[0], qp[1], -0.4); if (b && b.i > 0 && !VIS.g[b.id]) { VIS.g[b.id] = 1; if (Object.keys(VIS.g).length >= 8 && !VIS.stamped.walk) { VIS.stamped.walk = 1; stamp(C("progress.chain", "p_cm_chain")); } } }
      if (!VIS.stamped.docent) { try { if (typeof talkNpc !== "undefined" && talkNpc && talkNpc.id === C("docent.id", "cm_docent")) { VIS.stamped.docent = 1; stamp(C("progress.docent", "p_cm_docent")); } } catch (e) {} }
      if (HK.on && !inPl) closeKiosk();
      if (dc < 140 && (FRAME_N % 90) === 0) nearBlock();
    } catch (e) { note("frame", e); } }

  // ───────────────────────── defer: the exterior, warm-up; the client's near-player pebbles kept off the paving ─────────────────────────
  function deferHook() {
    if (CM.off || !window.PLAN || !SITE || SITE.G === null) return; var t0 = nowMs(); var step = function (name, fn) { var t = nowMs(); try { fn(); } catch (e) { note(name, e); } CM.n["ms_" + name] = Math.round(nowMs() - t); };
    step("indoor", function () { indoorUniforms(); var M = mats(); ["conc", "basalt", "trav", "terr", "wood", "metal", "paint", "glass", "screen"].forEach(function (k) { patchIndoor(M[k]); }); var LTm = letters(); patchIndoor(LTm.mat); patchIndoor(LTm.pmat); [M.trav, M.terr].forEach(function (m) { if (m) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4; } }); });
    step("exterior", function () { buildExterior(false); });
    step("solids", function () { siteSolids(); });
    step("warm", function () { warmSample(); });
    nearBlock(); installOverrides(); CM.ready = true; CM.n.deferMs = Math.round(nowMs() - t0); }
  function nearBlock() { try { if (typeof NEAR === "undefined" || !NEAR.blocked || NEAR.blocked.cm) return; var b0 = NEAR.blocked, S = SITE; var f = function (x, z) { if (Math.abs(x - S.cx) < 95 && Math.abs(z - S.cz) < 95) { var q = w2l(x, z); if (inLot(q[0], q[1], 1.2)) return true; } return b0(x, z); }; for (var k in b0) f[k] = b0[k]; f.cm = true; NEAR.blocked = f; NEAR.at = [1e9, 1e9]; CM.n.nearWrap = (CM.n.nearWrap || 0) + 1; } catch (e) { note("near", e); } }
  // every interior material on a tiny mesh, compiled behind the loading screen (the rooms then open without compiling)
  function warmSample() { try { var M = mats(), At = AT || (AT = CM.atlas = newAtlas()), g = new THREE.Group(); g.name = "cm warm"; var geo = new THREE.BoxGeometry(0.1, 0.1, 0.1); geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
      [M.conc, M.basalt, M.trav, M.terr, M.wood, M.metal, M.paint, M.glass, M.glow, M.add, M.lantern, At.self, At.bself, At.blit, logoMat(), M.screen, letters().mat].forEach(function (m) { if (!m) return; var me = new THREE.Mesh(geo, m); me.receiveShadow = true; me.castShadow = !m.transparent; g.add(me); });
      g.position.set(SITE.cx, SITE.G - 40, SITE.cz); scene.add(g); CM.warm = g; if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(g, { name: "cm warm" }); setTimeout(function () { try { scene.remove(g); } catch (e) {} }, 30000); } catch (e) { note("warm", e); } }
  var OV = CM.ov = CM.ov || {};
  function installOverrides() { if (OV.done) return; OV.done = true; try { var on = openNearest; openNearest = function () { try { if (handleE()) return; } catch (e) { note("E", e); } return on.apply(this, arguments); }; OV.openNearest = true; } catch (e) { note("ov openNearest", e); } }

  // ───────────────────────── API, debug, hooks ─────────────────────────
  CM.api = { resolveSite: resolveSite, l2w: l2w, w2l: w2l, inMuseum: inMuseum, openKiosk: openKiosk, closeKiosk: closeKiosk, startDonation: startDonation, sha256: shaHex, genesisHash: genesisHash, ledgerAdd: ledgerAdd };
  CM.debug = {
    cam: function (lx, y, lz, tx, ty, tz, fov) { var a = l2w(lx, lz), b = l2w(tx, tz); window.__cam = [a[0], SITE.G + y, a[1], b[0], SITE.G + ty, b[1], fov || 0]; try { updateCulling(true); } catch (e) {} return window.__cam; },
    at: function (lx, lz, faceL) { var w = l2w(lx, lz); player.position.set(w[0], SITE.G + 0.03, w[1]); if (faceL !== undefined) yaw = yawW(faceL) + PI; return [Math.round(w[0] * 10) / 10, Math.round(w[1] * 10) / 10]; },
    build: function () { if (IN.L) return true; var L = newL(false), it = buildInteriorSteps(L), r, ts = [], t1; do { t1 = nowMs(); r = it.next(); ts.push(+(nowMs() - t1).toFixed(1)); } while (!r.done); if (!AT) AT = CM.atlas = newAtlas(); while (!atlasStep(AT, 50)) {} AT.ready = true; t1 = nowMs(); IN.L = finishL(L); ts.push(+(nowMs() - t1).toFixed(1)); return { steps: ts, tris: L.tris, meshes: L.g.children.length }; },
    drop: function () { disposeL(); return true; },
    counts: function () { var o = {}; [["exterior", EX.g], ["interior", IN.L && IN.L.g]].forEach(function (q) { if (!q[1]) return; var m = 0, tr = 0; q[1].traverse(function (x) { if (x.isMesh) { m++; var gi = x.geometry, cnt = gi.index ? gi.index.count : gi.attributes.position.count; tr += cnt / 3; } }); o[q[0]] = { meshes: m, tris: Math.round(tr) }; }); o.solids = (IN.solids || []).length; o.seats = CM.n.seats; return o; },
    kiosk: function () { return openKiosk(); }, donate: function () { return startDonation(); }, vis: VIS
  };
  (function hookAll() {
    var set = function (phase, name, fn) { var list = window.PLAN_HOOKS[phase]; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name: name, fn: fn }); };
    set("terrain", "cmTerrain", function () { terrainHook(); });
    // the site keep-out first of all (the world hooks run before the terrain hooks, and plan_enrich plants in its world hook): unshifted
    (function () { var list = window.PLAN_HOOKS.world; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === "cmEarly") return; list.unshift({ name: "cmEarly", fn: function () { try { if (CM.off || !window.PLAN) return; if (resolveSite()) keepout(); } catch (e) { note("early keep-out", e); } } }); })();
    set("world", "cmWorld", function () { worldHook(); });
    set("defer", "cmDefer", function () { deferHook(); });
    set("frame", "cmFrame", function (dt, now) { frameHook(dt, now); });
    set("interior", "cmCam", function (dt) { return camHook(dt); });
  })();
})();
