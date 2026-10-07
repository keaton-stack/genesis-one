// R13 (4 Oct 2026): COPPER CANYON CUSTOMS, the custom body shop for golf carts and bikes in the Motor Yard, and its Customizer.
//   - the shop (local frame u east, v south from the building centre; plan/bodyshop.json "site"): a 54 x 36 m desert-industrial
//     showroom garage of rammed earth and corrugated steel under a barrel roof, a 12.5 m roll-up door, a neon sign on a roof frame,
//     a forecourt of show carts. Inside (built near, time sliced, drawn only from inside or through the glass): the reveal bay with
//     a 7 m turntable under a lighting ring, three service bays with two-post lifts (a cart up on one), a paint booth with an
//     overspray glow, a wrap and decal station, a wheel and tyre wall, a parts wall, a lounge (sofas, an arcade cabinet, a merch
//     counter), the showroom turntable with the build of the week, polished concrete, tool chests, hoses, neon tubes, murals.
//   - the Customizer (E on the turntable): your cart (or bike) in the studio-lit bay, drag to turn, wheel to zoom, categories with
//     thumbnails, a live preview, the total, Buy and apply, Undo and Stock. Paint (30 colours, 6 finishes, two-tone), roof colour
//     and style, seats, rims, rim finish, tyres, stance, emblems, decals and wraps, a plate and a side label, eleven accessories,
//     underglow, flags, horns. Bikes: frame, fenders, rims, tyres, grips, seat, basket, decals.
//   - every cart and bike is drawn by one shared material family (one program, a stable key) driven by uniforms, a decal atlas
//     (tex/bs_decals.png) and a text atlas for plates and labels; region ids per vertex come from the model's own texture and
//     shape (segmented once at load). Wheels and accessories are cached merged meshes. Everyone sees everyone's look: the room
//     keeps it per player (logic.js "bodyshop": me.cl, me.bl, me.bso), shared carts take their driver's look, parked carts their sitter's.
// Classic script, loaded before client.js; hooks into window.PLAN_HOOKS { terrain, world, defer, frame, interior } and overrides a few
// client functions by bare name at run time (cartMaterial, applyCartLook, setCartVisual, updateRideDecals, makeBikeModel,
// cartSeatLocal, showEmote, playAt, openNearest). No new real lights (lamps through the client's light pool), instancing, shared
// materials. ?bs=0 turns the module off. window.PLAN_BODYSHOP: n (counters), errs, cfg, site, api, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var BS = window.PLAN_BODYSHOP = window.PLAN_BODYSHOP || {};
  BS.errs = BS.errs || []; BS.n = BS.n || { builds: 0, disposes: 0, mats: 0, wheels: 0, accs: 0, dress: 0 }; BS.ver = "r13";
  if (/[?&]bs=0\b/.test(location.search)) { BS.off = true; return; }
  var PI = Math.PI, TAU = PI * 2;
  function note(tag, e) { try { if (BS.errs.length < 50) BS.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (BS.errs.length <= 6) console.warn("plan_bodyshop " + tag, e); } catch (x) {} }
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
  function lowTier() { try { return ASSET.tier === "m"; } catch (e) { return false; } }
  function qual() { try { return localStorage.getItem("g1:quality") || "high"; } catch (e) { return "high"; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function hexC(h) { var c = new THREE.Color(); try { c.set("#" + String(h).replace("#", "")); c.convertSRGBToLinear(); } catch (e) {} return c; }   // the look colours match their swatches (the game keeps hex values as authored, so they are converted here)
  function au(u) { try { if (window.AV) return window.AV(u); } catch (e) {} return u; }

  // ───────────────────────── config: plan/bodyshop.json ─────────────────────────
  var CFG = BS.cfg || null;
  function cfgUrl() { return au("/plan/bodyshop.json?v=" + (window.BUILD || "dev")); }
  if (!CFG) { try { fetch(cfgUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && !CFG) CFG = BS.cfg = d; }).catch(function (e) { note("cfg fetch", e); }); } catch (e) { note("cfg", e); } }
  function cfg() { if (CFG) return CFG; try { var x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = BS.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); } return CFG; }
  function C(path, dflt) { var o = cfg(); if (!o) return dflt; var p = path.split("."); for (var i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }
  function CAT(k) { return C("catalog." + k, []) || []; }
  function CP(k, d) { return C("copy." + k, d === undefined ? "" : d); }

  // ───────────────────────── geometry kit (as plan_convention): parts per base, each with a colour, merged once ─────────────────────────
  var _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();
  var _cc = {};
  function rgb(c) { if (Array.isArray(c)) return c; if (typeof c === "number" || typeof c === "string") { var k = String(c); if (_cc[k]) return _cc[k]; var q = new THREE.Color(c); return (_cc[k] = [q.r, q.g, q.b]); } return [1, 1, 1]; }
  function Kit() { this.m = {}; this.tris = 0; }
  Kit.prototype.add = function (b, g, col, m4) {
    if (g.index) g = g.toNonIndexed(); if (m4) g.applyMatrix4(m4); if (!g.attributes.normal) g.computeVertexNormals();
    var n = g.attributes.position.count; if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.color) { var c = rgb(col === undefined ? 0xffffff : col), ca = new Float32Array(n * 3); for (var i = 0; i < n; i++) { ca[i * 3] = c[0]; ca[i * 3 + 1] = c[1]; ca[i * 3 + 2] = c[2]; } g.setAttribute("color", new THREE.BufferAttribute(ca, 3)); }
    (this.m[b] || (this.m[b] = [])).push(g); this.tris += n / 3; return g; };
  Kit.prototype.place = function (b, g, col, x, y, z, ry, rx, rz, sx, sy, sz) { _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(x || 0, y || 0, z || 0), _q, _v2.set(sx || 1, sy || 1, sz || 1)); return this.add(b, g, col, _m4); };
  Kit.prototype.box = function (b, col, w, h, d, x, y, z, ry, t, rx, rz) { var g = new THREE.BoxGeometry(w, h, d); if (t) uvBox(g, w, h, d, t); return this.place(b, g, col, x, y, z, ry, rx, rz); };
  Kit.prototype.cyl = function (b, col, r0, r1, h, x, y, z, seg, open, ry, rx, rz) { return this.place(b, new THREE.CylinderGeometry(r0, r1, h, seg || 12, 1, !!open), col, x, y, z, ry, rx, rz); };
  Kit.prototype.sph = function (b, col, r, x, y, z, seg, sx, sy, sz) { return this.place(b, new THREE.SphereGeometry(r, seg || 10, Math.max(5, (seg || 10) >> 1)), col, x, y, z, 0, 0, 0, sx, sy, sz); };
  Kit.prototype.tube = function (b, col, A, B, r, seg) { var d = _v3.subVectors(B, A), L = d.length(); if (L < 1e-4) return null; var g = new THREE.CylinderGeometry(r, r, L, seg || 8, 1, true); _q.setFromUnitVectors(_v1.set(0, 1, 0), d.clone().normalize()); _m4.compose(_v2.addVectors(A, B).multiplyScalar(0.5), _q, _s1); return this.add(b, g, col, _m4); };
  Kit.prototype.plane = function (b, col, w, h, x, y, z, ry, rx, uv) { var g = new THREE.PlaneGeometry(w, h); if (uv) { var U = g.attributes.uv; for (var i = 0; i < U.count; i++) U.setXY(i, uv[0] + U.getX(i) * (uv[2] - uv[0]), uv[1] + U.getY(i) * (uv[3] - uv[1])); } return this.place(b, g, col, x, y, z, ry, rx); };
  Kit.prototype.merge = function () { var out = {}; for (var k in this.m) { var g = mergeAll(this.m[k]); if (g) out[k] = g; } return out; };
  Kit.prototype.build = function (grp, bases, opts) { opts = opts || {}; var out = [], geos = this.merge(); for (var b in geos) { var mt = bases[b]; if (!mt) { note("base", b); continue; } var me = new THREE.Mesh(geos[b], mt); me.name = "bs " + b; me.castShadow = !!opts.cast && !mt.transparent; me.receiveShadow = opts.receive !== false && !mt.transparent; me.userData.shSet = true; if (mt.transparent) me.renderOrder = 2; grp.add(me); out.push(me); } this.m = {}; return out; };
  function mergeAll(list) {
    if (!list || !list.length) return null; var n = 0; list.forEach(function (g) { n += g.attributes.position.count; }); if (!n) return null; var extra = {}; list.forEach(function (g) { for (var k in g.attributes) if (k !== "position" && k !== "normal" && k !== "uv" && k !== "color") extra[k] = g.attributes[k].itemSize; });
    var P = new Float32Array(n * 3), N = new Float32Array(n * 3), Uu = new Float32Array(n * 2), Cc = new Float32Array(n * 3), X = {}, o = 0; for (var k in extra) X[k] = new Float32Array(n * extra[k]);
    list.forEach(function (g) { var c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); Uu.set(g.attributes.uv.array, o * 2); if (g.attributes.color) Cc.set(g.attributes.color.array, o * 3); else Cc.fill(1, o * 3, (o + c) * 3); for (var k2 in X) if (g.attributes[k2]) X[k2].set(g.attributes[k2].array, o * extra[k2]); o += c; });
    var r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(Uu, 2)); r.setAttribute("color", new THREE.BufferAttribute(Cc, 3)); for (var k3 in X) r.setAttribute(k3, new THREE.BufferAttribute(X[k3], extra[k3]));
    r.computeBoundingBox(); r.computeBoundingSphere(); return r; }
  function uvBox(g, w, h, d, t) { var uv = g.attributes.uv; var dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (var f = 0; f < 6; f++) for (var k = 0; k < 4; k++) { var i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } }
  var RBX = {};
  function rbox(w, h, d, r, seg) { var key = [w, h, d, r, seg].join(":"); if (RBX[key]) return RBX[key].clone(); seg = seg || 2; var g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2); var p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3(); var hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
    for (var i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); c.set(clamp(v.x, -hw, hw), clamp(v.y, -hh, hh), clamp(v.z, -hd, hd)); var dd = v.clone().sub(c); if (dd.lengthSq() > 1e-10) { dd.setLength(r); v.copy(c).add(dd); } p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); RBX[key] = g; return g.clone(); }
  function lathe(prof, seg) { return new THREE.LatheGeometry(prof.map(function (q) { return new THREE.Vector2(Math.max(0.0001, q[0]), q[1]); }), seg || 12); }
  function std(o) { var m = new THREE.MeshStandardMaterial(o); return m; }
  function texL(url, srgb, rep) { var t = new THREE.TextureLoader().load(au(url)); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = rep === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping; t.anisotropy = 8; return t; }
  function tname(n, ext) { return "/tex/" + n + (lowTier() ? "_m" : "") + "." + (ext || "jpg"); }

  // ───────────────────────── the catalog: looks, the items a look uses, prices and rank gates (mirror of logic.js) ─────────────────────────
  // A cart look (server me.cl) is an object of small integers, 0 = stock (left out), plus a plate (pl) and a side label (lb).
  var CART_KEYS = { p: 29, p2: 29, f: 5, t: 4, r: 11, rs: 6, s: 11, sp: 5, s2: 11, w: 7, wc: 9, ty: 4, l: 2, e: 8, d: 10, dc: 9, a: 2047, u: 5, fl: 7, h: 4 };
  var BIKE_KEYS = { f: 11, fe: 11, w: 7, t: 2, g: 7, s: 7, b: 1, d: 4, dc: 9 };
  var RANK_NAMES = ["Passenger", "Pilot", "Captain", "Tower"];
  function cleanLook(o, keys, cart) { if (!o || typeof o !== "object") return null; var r = {}; for (var k in keys) { var v = o[k]; if (Number.isInteger(v) && v > 0 && v <= keys[k]) r[k] = v; } if (cart) { if (typeof o.pl === "string" && o.pl) r.pl = o.pl; if (typeof o.lb === "string" && o.lb) r.lb = o.lb; } return Object.keys(r).length ? r : null; }
  function lookKey(o) { if (!o) return ""; var ks = Object.keys(o).sort(), s = ""; for (var i = 0; i < ks.length; i++) s += ks[i] + "=" + o[ks[i]] + ";"; return s; }
  // the ids a look uses (stock and free choices left out): logic.js bsItems
  function itemsOf(cart, bike) {
    var out = [], P = CAT("prices") || {}; var add = function (id) { if (P[id] && out.indexOf(id) < 0) out.push(id); };
    if (cart) { var c = cart; if (c.p) add("p" + c.p); if (c.t) { add("t" + c.t); if (c.p2) add("p" + c.p2); } if (c.f) add("f" + c.f); if (c.r) add("r" + c.r); if (c.rs) add("rs" + c.rs);
      if (c.s) add("s" + c.s); if (c.sp) { add("sp" + c.sp); if (c.s2) add("s" + c.s2); } if (c.w) add("w" + c.w); if (c.wc) add("wc" + c.wc); if (c.ty) add("ty" + c.ty); if (c.l) add("l" + c.l);
      if (c.e) add("e" + c.e); if (c.d) add("d" + c.d); if (c.pl) add("pl"); if (c.lb) add("lb"); if (c.h) add("h" + c.h); for (var b = 0; b < 11; b++) if ((c.a || 0) & (1 << b)) add("a" + b); }
    if (bike) { var k = bike; if (k.f) add("bf" + k.f); if (k.fe) add("bf" + k.fe); if (k.w) add("bw" + k.w); if (k.t) add("bt" + k.t); if (k.g) add("bg" + k.g); if (k.s) add("bs" + k.s); if (k.b) add("bb"); if (k.d) add("bd" + k.d); }
    return out; }
  // ownership: the server's bit set (me.bso, hex) in the order of logic.js BS_ITEMS, which is the order of catalog.prices
  var IDX = null; function idxOf(id) { if (!IDX) { IDX = {}; Object.keys(CAT("prices") || {}).forEach(function (k, i) { IDX[k] = i; }); } return IDX[id]; }
  function me() { try { return view && view.players ? view.players[ME] : null; } catch (e) { return null; } }
  function owned(id) { var m = me(), h = (m && m.bso) || "", i = idxOf(id); if (i === undefined) return true; var d = parseInt(h[i >> 2] || "0", 16); return ((d >> (i & 3)) & 1) === 1; }
  function priceOf(id) { var p = (CAT("prices") || {})[id]; return p ? p[0] : 0; }
  function rankReq(id) { var p = (CAT("prices") || {})[id]; return p ? p[1] : 0; }
  function myRank() { try { if (window.PLAN_PROGRESS && PLAN_PROGRESS.rank) return PLAN_PROGRESS.rank().index | 0; } catch (e) {} var m = me(); return m && m.pr && Number.isInteger(m.pr.r) ? m.pr.r : 0; }
  function coins() { var m = me(); return m ? m.coins || 0 : 0; }
  // the cost of a look against what you own, and what stops it (rank)
  function quote(cart, bike) { var ids = itemsOf(cart, bike), need = ids.filter(function (id) { return !owned(id); }), cost = 0, locked = [], r = myRank(); need.forEach(function (id) { cost += priceOf(id); if (rankReq(id) > r) locked.push(id); }); return { need: need, cost: cost, locked: locked, ok: !locked.length && cost <= coins() }; }
  // reward paints 24..29 come from the passport (client-side unlock, as the cart card)
  function paintOk(i) { if (i < 24) return true; var P = CAT("paints")[i]; if (!P || !P[2]) return true; try { return !!(window.PLAN_PROGRESS && PLAN_PROGRESS.has && PLAN_PROGRESS.has(P[2])); } catch (e) { return false; } }
  // plate and label texts (logic.js rules, so the screen can say no before the room does)
  var BAD = ["fuck", "fuk", "fck", "shit", "cunt", "bitch", "nigg", "niga", "faggot", "whore", "slut", "rapist", "nazi", "hitler", "porn", "penis", "vagina", "dildo", "jizz", "asshole", "bastard", "motherf", "retard", "wetback", "tranny", "cocksuck", "pussy", "twat", "wank", "bollock", "titties", "boobs", "cocaine", "heroin", "kike"];
  var BADW = ["ass", "arse", "cum", "sex", "sexy", "spic", "chink", "gook", "fag", "fags", "hoe", "hoes", "tit", "tits", "dick", "dicks", "cock", "rape", "kkk", "anal", "anus", "piss", "crap", "douche", "stfu", "wtf", "kys", "meth", "weed", "milf", "horny", "boob", "suck", "sucks", "nude", "nudes"];
  var SWAP = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "@": "a", "$": "s", "!": "i" };
  function rude(text) { var w = [""]; String(text).toLowerCase().split("").forEach(function (ch) { var c = SWAP[ch] || ch; if (c >= "a" && c <= "z") w[w.length - 1] += c; else if (w[w.length - 1]) w.push(""); }); w = w.filter(Boolean); var all = w.join(""); for (var i = 0; i < BAD.length; i++) if (all.indexOf(BAD[i]) >= 0) return true; for (var j = 0; j < w.length; j++) if (BADW.indexOf(w[j]) >= 0) return true; return false; }
  function plateText(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").slice(0, 7).trim(); }
  function labelText(s) { return String(s || "").replace(/[^A-Za-z0-9 .'!&-]/g, "").replace(/\s+/g, " ").slice(0, 14).trim(); }
  BS.cat = { itemsOf: itemsOf, quote: quote, owned: owned, priceOf: priceOf, rankReq: rankReq, myRank: myRank, rude: rude, cleanLook: cleanLook, lookKey: lookKey, CART_KEYS: CART_KEYS, BIKE_KEYS: BIKE_KEYS };

  // ───────────────────────── regions: the model's triangles sorted by what they are (paint, roof, seat, rims, tyres, trim...) ─────────────────────────
  // The cart and the bike are scanned models whose texture is a mosaic of tiny islands, so a recolour cannot work in uv space. Each
  // triangle is classed once from the colour of its texels (four samples) and where it sits (wheel cylinders, the canopy height, the
  // seat box), a pass fills body panels from their neighbours, and the triangles are written out unindexed, sorted by region, with a
  // region id per vertex (attribute bsr). The stock wheels come last so a cart on custom wheels draws a shorter range of the same
  // buffers (one upload for both). Region ids: 0 keep, 1 paint, 2 roof (bike: fenders), 3 seat, 4 stock rim, 5 stock tyre, 6 trim,
  // 7 roof struts, 8 headlights, 9 grips (bike); 10+ are the parts this module builds (wheels, accessories, plate).
  var GEO = BS.geo = BS.geo || {};
  var WHEELS = { cart: [[0.9804, 0.272, 0.2693], [-0.7835, 0.2897, 0.2832]], bike2: [[0.6174, 0.3817, 0.3809], [-0.6049, 0.4158, 0.395]] };
  function texPixels(tex, size) { var img = tex && tex.image; if (!img || !img.width) return null; var cv = document.createElement("canvas"); cv.width = cv.height = size; var x = cv.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, size, size); return { d: x.getImageData(0, 0, size, size).data, n: size }; }
  function* segment(kind) {
    var m = MODELS[kind]; if (!m || !m.parts || !m.parts[0]) return null; var part = m.parts[0], src = part.geometry, mat = part.material;
    var px = texPixels(mat.map, 256); if (!px) return null; yield 0;
    var P = src.attributes.position.array, U = src.attributes.uv.array, N = src.attributes.normal.array, TA = src.attributes.tangent ? src.attributes.tangent.array : null, I = src.index ? src.index.array : null;
    var F = I ? I.length / 3 : src.attributes.position.count / 3, vi = function (f, k) { return I ? I[f * 3 + k] : f * 3 + k; };
    var reg = new Uint8Array(F), cx = new Float32Array(F * 3), col = new Float32Array(F * 3), area = new Float32Array(F), n = px.n, D = px.d;
    var samp = function (u, v, o) { var x = clamp(Math.floor(u * n), 0, n - 1), y = clamp(Math.floor(v * n), 0, n - 1), i = (y * n + x) * 4; o[0] += D[i] / 255; o[1] += D[i + 1] / 255; o[2] += D[i + 2] / 255; };
    var acc = [0, 0, 0], W = WHEELS[kind] || WHEELS.cart, isBike = kind !== "cart", t0 = nowMs();
    for (var f = 0; f < F; f++) {
      var a = vi(f, 0), b = vi(f, 1), c = vi(f, 2); acc[0] = acc[1] = acc[2] = 0;
      samp(U[a * 2], U[a * 2 + 1], acc); samp(U[b * 2], U[b * 2 + 1], acc); samp(U[c * 2], U[c * 2 + 1], acc); samp((U[a * 2] + U[b * 2] + U[c * 2]) / 3, (U[a * 2 + 1] + U[b * 2 + 1] + U[c * 2 + 1]) / 3, acc);
      var r = acc[0] / 4, g = acc[1] / 4, bl = acc[2] / 4; col[f * 3] = r; col[f * 3 + 1] = g; col[f * 3 + 2] = bl;
      var x = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, y = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, z = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3; cx[f * 3] = x; cx[f * 3 + 1] = y; cx[f * 3 + 2] = z;
      var e1x = P[b * 3] - P[a * 3], e1y = P[b * 3 + 1] - P[a * 3 + 1], e1z = P[b * 3 + 2] - P[a * 3 + 2], e2x = P[c * 3] - P[a * 3], e2y = P[c * 3 + 1] - P[a * 3 + 1], e2z = P[c * 3 + 2] - P[a * 3 + 2];
      area[f] = 0.5 * Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
      var lum = 0.299 * r + 0.587 * g + 0.114 * bl, mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), sat = (mx - mn) / (mx + 1e-5), ax = Math.abs(x);
      var wd = 9, wk = 0; for (var k = 0; k < W.length; k++) { var dd = Math.hypot(z - W[k][0], y - W[k][1]) / W[k][2]; if (dd < wd) { wd = dd; wk = k; } }
      var R = 0;
      if (!isBike) {
        var green = g - Math.max(r, bl) > 0.025 || (g > Math.max(r, bl) * 1.25 && g > 0.035 && lum < 0.2), inw = ax > 0.425 && wd < 1.03;
        if (green) R = 1; if (y > 1.80) R = 2;
        if (r > bl + 0.04 && lum > 0.45 && !green && y > 0.55 && y < 1.4 && z > -1.25 && z < 0.25 && ax < 0.62) R = 3;
        if (inw) R = wd < 0.66 && lum > 0.25 ? 4 : 5;
        if (!R && lum < 0.16) R = 6;
        if (!R && lum > 0.55 && sat < 0.18 && y > 0.75 && y <= 1.8) R = 7;
        if (!R && z > 1.0 && y > 0.35 && y < 0.75 && lum > 0.25 && lum < 0.75 && sat < 0.2) R = 8;
      } else {
        var light = lum > 0.55 && sat < 0.22, inb = wd < 1.04 && ax < 0.22, yc = W[wk][1];
        if (bl > r + 0.08 && g > r + 0.08 && sat > 0.25) R = 1;
        if (inb && wd > 0.8 && lum < 0.35) R = 5;
        if (!R && light && wd > 0.88 && wd < 1.35 && y > yc && ax < 0.2) R = 2;
        if (!R && inb && wd <= 0.88 && light) R = 4;
        if (!R && light && y > 0.86 && z < -0.12 && z > -0.62) R = 3;
        if (!R && light && y > 1.0 && z > 0.05 && ax > 0.17) R = 9;
      }
      reg[f] = R; if ((f & 4095) === 4095 && nowMs() - t0 > 6) { yield 1; t0 = nowMs(); }
    }
    // cart body panels: an unclassed triangle whose neighbours (sharing a corner position) are mostly paint is paint
    if (!isBike) {
      var key = new Map(), vid = new Int32Array(F * 3), nv = 0;
      for (var f2 = 0; f2 < F; f2++) for (var k2 = 0; k2 < 3; k2++) { var q = vi(f2, k2), kk = Math.round(P[q * 3] * 200) + "," + Math.round(P[q * 3 + 1] * 200) + "," + Math.round(P[q * 3 + 2] * 200); var id = key.get(kk); if (id === undefined) { id = nv++; key.set(kk, id); } vid[f2 * 3 + k2] = id; }
      yield 1; var v2t = new Array(nv); for (var f3 = 0; f3 < F; f3++) for (var k3 = 0; k3 < 3; k3++) { var w = vid[f3 * 3 + k3]; (v2t[w] || (v2t[w] = [])).push(f3); }
      for (var it = 0; it < 2; it++) { var chg = []; for (var f4 = 0; f4 < F; f4++) { if (reg[f4]) continue; var tot = 0, body = 0, seen = {}; for (var k4 = 0; k4 < 3; k4++) { var L = v2t[vid[f4 * 3 + k4]]; for (var j = 0; j < L.length; j++) { var o = L[j]; if (o === f4 || seen[o]) continue; seen[o] = 1; tot += area[o]; if (reg[o] === 1) body += area[o]; } } if (tot > 0 && body > 0.5 * tot) chg.push(f4); } chg.forEach(function (q2) { reg[q2] = 1; }); yield 1; }
    }
    // write out: sorted by region, the stock wheels (4, 5) last
    var order = [0, 1, 2, 3, 6, 7, 8, 9, 4, 5], cnt = new Int32Array(16); for (var f5 = 0; f5 < F; f5++) cnt[reg[f5]]++;
    var VN = F * 3, oP = new Float32Array(VN * 3), oN = new Float32Array(VN * 3), oU = new Float32Array(VN * 2), oT = new Float32Array(VN * 4), oR = new Float32Array(VN), o3 = 0, bodyV = 0, ranges = {};
    for (var oi = 0; oi < order.length; oi++) { var rr = order[oi], start = o3; if (rr === 4) bodyV = o3; for (var f6 = 0; f6 < F; f6++) { if (reg[f6] !== rr) continue; for (var k6 = 0; k6 < 3; k6++) { var s6 = vi(f6, k6); oP[o3 * 3] = P[s6 * 3]; oP[o3 * 3 + 1] = P[s6 * 3 + 1]; oP[o3 * 3 + 2] = P[s6 * 3 + 2]; oN[o3 * 3] = N[s6 * 3]; oN[o3 * 3 + 1] = N[s6 * 3 + 1]; oN[o3 * 3 + 2] = N[s6 * 3 + 2]; oU[o3 * 2] = U[s6 * 2]; oU[o3 * 2 + 1] = U[s6 * 2 + 1]; if (TA) { oT[o3 * 4] = TA[s6 * 4]; oT[o3 * 4 + 1] = TA[s6 * 4 + 1]; oT[o3 * 4 + 2] = TA[s6 * 4 + 2]; oT[o3 * 4 + 3] = TA[s6 * 4 + 3]; } else { oT[o3 * 4] = 1; oT[o3 * 4 + 3] = 1; } oR[o3] = rr; o3++; } } ranges[rr] = [start, o3 - start]; yield 1; }
    var full = new THREE.BufferGeometry(); full.setAttribute("position", new THREE.BufferAttribute(oP, 3)); full.setAttribute("normal", new THREE.BufferAttribute(oN, 3)); full.setAttribute("uv", new THREE.BufferAttribute(oU, 2)); full.setAttribute("tangent", new THREE.BufferAttribute(oT, 4)); full.setAttribute("bsr", new THREE.BufferAttribute(oR, 1));
    full.computeBoundingBox(); full.computeBoundingSphere(); full.userData.bsKeep = true;
    var body = new THREE.BufferGeometry(); for (var an in full.attributes) body.setAttribute(an, full.attributes[an]); body.setDrawRange(0, bodyV); body.boundingBox = full.boundingBox; body.boundingSphere = full.boundingSphere; body.userData.bsKeep = true;
    var out = { kind: kind, full: full, body: body, bodyV: bodyV, ranges: ranges, counts: Array.prototype.slice.call(cnt, 0, 10), base: mat, wheels: W, tris: F };
    if (isBike) { var G = (typeof BIKE_GEO !== "undefined" && BIKE_GEO[kind]) || { crank: [0.30, -0.05] }; out.crank = splitCrank(full, G); }
    BS.n["seg_" + kind] = out.counts.join(",");
    return out;
  }
  // the bike's crank turns (client bikeSplit): the same test on the sorted buffers, two geometries sharing nothing but being small
  function splitCrank(full, G) {
    var P = full.attributes.position.array, n = full.attributes.position.count, inC = function (i) { var x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; return Math.abs(x) > 0.062 && Math.abs(x) < 0.2 && y > 0.1 && y < 0.5 && Math.abs(z - G.crank[1]) < 0.3; };
    var bodyI = [], crankI = [], fx = 0, fn = 0; for (var t = 0; t < n; t += 3) { if (inC(t) && inC(t + 1) && inC(t + 2)) { crankI.push(t, t + 1, t + 2); for (var k = 0; k < 3; k++) if (P[(t + k) * 3 + 2] > G.crank[1] + 0.06) { fx += P[(t + k) * 3]; fn++; } } else bodyI.push(t, t + 1, t + 2); }
    var mk = function (ids, dy, dz) { var g = new THREE.BufferGeometry(); for (var an in full.attributes) { var A = full.attributes[an], sz = A.itemSize, arr = new Float32Array(ids.length * sz); for (var i = 0; i < ids.length; i++) for (var c = 0; c < sz; c++) arr[i * sz + c] = A.array[ids[i] * sz + c]; if (an === "position") for (var j = 0; j < ids.length; j++) { arr[j * 3 + 1] -= dy; arr[j * 3 + 2] -= dz; } g.setAttribute(an, new THREE.BufferAttribute(arr, sz)); } g.computeBoundingBox(); g.computeBoundingSphere(); g.userData.bsKeep = true; return g; };
    return { body: mk(bodyI, 0, 0), crank: mk(crankI, G.crank[0], G.crank[1]), fwdSide: fn && fx / fn < 0 ? -1 : 1 };
  }
  // run once per kind, time sliced in the frame (a few ms a frame), or all at once when something needs it now
  var SEGQ = BS.segq = BS.segq || { jobs: {} };
  function segReady(kind) { return !!GEO[kind]; }
  function segStart(kind) { if (GEO[kind] || SEGQ.jobs[kind] || !has(kind)) return; SEGQ.jobs[kind] = segment(kind); }
  function segStep(budget) { var t0 = nowMs(); for (var k in SEGQ.jobs) { var it = SEGQ.jobs[k]; for (;;) { var r; try { r = it.next(); } catch (e) { note("segment " + k, e); delete SEGQ.jobs[k]; break; } if (r.done) { if (r.value) GEO[k] = r.value; else note("segment " + k, "no texture"); delete SEGQ.jobs[k]; break; } if (nowMs() - t0 > budget) return; } } }
  function segNow(kind) { segStart(kind); var it = SEGQ.jobs[kind]; if (!it) return GEO[kind] || null; for (;;) { var r = it.next(); if (r.done) { if (r.value) GEO[kind] = r.value; delete SEGQ.jobs[kind]; break; } } return GEO[kind] || null; }

  // ───────────────────────── the vehicle look material: one shader for every custom cart and bike, its look in uniforms ─────────────────────────
  // A clone of the model's own PBR material (map, normal, roughness and metalness maps) patched by one onBeforeCompile whose text is
  // the same for every look, so all looks share one program (and its shadow variants). Per look: colours, finish, pattern and decal
  // ids, the text atlas slots; shared: the decal atlas, the text atlas, night and time.
  var GU = BS.gu = BS.gu || { uNight: { value: 0 }, uTime: { value: 0 }, tDec: { value: null }, tTxt: { value: null }, uBsBox: { value: new THREE.Vector4(0, 0, -1, -1) }, uBsIn: { value: new THREE.Vector4(0, 0, 0.32, 0) }, uBsRoof: { value: new THREE.Vector3(8, 13, 27) } };
  // indoors (inside the shop's walls and under its vault) the sky's share of the light (hemisphere and environment) is cut, so the pooled lamps,
  // the neon and the emissive set the mood; one shared patch, the same text for every material that takes it
  var IND_VS = "varying vec3 vBsW;\n", IND_VS_BODY = "vBsW = (modelMatrix * vec4(transformed, 1.0)).xyz;";
  var IND_FS = "varying vec3 vBsW; uniform vec4 uBsBox; uniform vec4 uBsIn; uniform vec3 uBsRoof;\nfloat bsIndoor() { vec2 bd = abs(vBsW.xz - uBsBox.xy); float u = (vBsW.x - uBsBox.x) / uBsRoof.z; float rh = uBsIn.x + uBsRoof.x + (uBsRoof.y - uBsRoof.x) * max(0.0, 1.0 - u * u) + 0.01; return step(bd.x, uBsBox.z) * step(bd.y, uBsBox.w) * step(uBsIn.x - 0.6, vBsW.y) * step(vBsW.y, rh); }\n";
  var IND_FS_BODY = "{ float bsk = bsIndoor(); reflectedLight.indirectDiffuse *= mix(1.0, uBsIn.z, bsk); reflectedLight.indirectSpecular *= mix(1.0, mix(uBsIn.z * 0.6, 0.85, metalnessFactor), bsk); reflectedLight.indirectDiffuse += material.diffuseColor * vec3(1.0, 0.9, 0.78) * uBsIn.w * bsk; }\n";
  function indoorPatch(sh) { sh.uniforms.uBsBox = GU.uBsBox; sh.uniforms.uBsIn = GU.uBsIn; sh.uniforms.uBsRoof = GU.uBsRoof; sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + IND_VS).replace("#include <project_vertex>", "#include <project_vertex>\n" + IND_VS_BODY); sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + IND_FS).replace("#include <aomap_fragment>", IND_FS_BODY + "#include <aomap_fragment>"); }
  function indoorObc(sh) { indoorPatch(sh); }
  var VS_HEAD = "attribute float bsr;\nvarying float vBsr; varying vec3 vOP; varying vec3 vON; varying vec2 vBsUv;\nuniform float uLift; uniform float uWS; uniform vec3 uWF; uniform vec3 uWR; uniform float uTime; uniform float uKind;\n";
  var VS_BODY = [
    "vBsr = bsr; vOP = position; vON = normal; vBsUv = uv;",
    "if (bsr > 3.5 && bsr < 5.5 && uWS != 1.0) { vec3 wc = position.z > 0.1 ? uWF : uWR; vec2 d = transformed.zy - wc.xy; transformed.zy = wc.xy + d * uWS; transformed.y += wc.z * (uWS - 1.0); }",
    "if ((bsr < 3.5 || (bsr > 5.5 && bsr < 9.5) || bsr > 13.5) && uKind < 0.5) transformed.y += uLift;",
    "if (bsr > 16.5 && bsr < 17.5) { float k = uv.x; transformed.x += sin(uTime * 7.0 + k * 6.0 + position.y * 3.0) * 0.045 * k; transformed.z += cos(uTime * 5.0 + k * 5.0) * 0.02 * k; }"
  ].join("\n");
  var FS_HEAD = [
    "varying float vBsr; varying vec3 vOP; varying vec3 vON; varying vec2 vBsUv;",
    "uniform vec3 uC1; uniform vec3 uC2; uniform vec4 uFin; uniform float uSplit; uniform vec3 uRoof; uniform float uRoofS; uniform vec3 uSeat; uniform vec3 uSeat2; uniform float uSeatS;",
    "uniform vec3 uRim; uniform vec2 uRimM; uniform float uTyre; uniform vec2 uBand; uniform vec4 uDec; uniform vec3 uDecC; uniform vec4 uLab; uniform vec3 uLabC; uniform vec4 uPlt; uniform vec3 uWF; uniform vec3 uWR; uniform float uKind; uniform vec3 uGrip; uniform vec3 uGlow;",
    "uniform float uNight; uniform float uTime; uniform sampler2D tDec; uniform sampler2D tTxt;",
    "float bsH(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }",
    "vec4 bsWrap(float s, vec2 uv) { uv = clamp(uv, 0.0, 1.0); vec2 o = vec2(mod(s, 2.0) * 0.5, floor(s / 2.0) * 0.16650); return texture2D(tDec, o + vec2((6.0 + uv.x * 1012.0) / 2048.0, (6.0 + (1.0 - uv.y) * 329.0) / 2048.0)); }",
    "vec4 bsEmb(float k, vec2 uv) { if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0); return texture2D(tDec, vec2((k * 256.0 + 4.0 + uv.x * 248.0) / 2048.0, (1364.0 + 4.0 + (1.0 - uv.y) * 248.0) / 2048.0)); }",
    "vec4 bsFlag(float k, vec2 uv) { uv = clamp(uv, 0.02, 0.98); return texture2D(tDec, vec2((k * 256.0 + uv.x * 256.0) / 2048.0, (1620.0 + (1.0 - uv.y) * 128.0) / 2048.0)); }",
    "vec4 bsTxt(vec4 r, vec2 uv) { if (r.z <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0); return texture2D(tTxt, r.xy + vec2(uv.x, 1.0 - uv.y) * r.zw); }"
  ].join("\n");
  // the look, applied after the maps and the normal, before the lights read diffuseColor, roughness and metalness
  var FS_BODY = [
    "{ float R = floor(vBsr + 0.5); vec3 tc = diffuseColor.rgb; float lum = dot(tc, vec3(0.299, 0.587, 0.114)); vec3 p = vOP; vec3 n = normalize(vON); float sx = p.x >= 0.0 ? 1.0 : -1.0;",
    "  vec3 vdir = normalize(vViewPosition); float fres = pow(1.0 - clamp(abs(dot(normal, vdir)), 0.0, 1.0), 2.0); float nk = 1.0;",
    "  float bikeK = uKind;",
    "  if (R == 1.0) {",
    "    float det = clamp(lum / (bikeK > 0.5 ? 0.30 : 0.21), 0.6, 1.3); float t2 = 0.0;",
    "    if (uSplit == 1.0) t2 = 1.0 - smoothstep(0.425, 0.445, p.y); else if (uSplit == 2.0) t2 = smoothstep(0.40, 0.43, p.z); else if (uSplit == 3.0) t2 = smoothstep(0.9, -1.0, p.z); else if (uSplit == 4.0) t2 = smoothstep(0.50, 0.515, p.y) * (1.0 - smoothstep(0.60, 0.615, p.y));",
    "    vec3 pc = mix(uC1, uC2, t2);",
    "    float ws = smoothstep(0.45, 0.75, abs(n.x)), wt = smoothstep(0.55, 0.85, n.y) * (1.0 - ws), wf = clamp(1.0 - ws - wt, 0.0, 1.0); float d = uDec.x;",
    "    vec2 uS = bikeK > 0.5 ? vec2((0.75 - p.z * sx) / 1.5 , (p.y - 0.2) / 0.85) : vec2((1.25 - p.z) / 2.5, (p.y - 0.12) / 0.8); vec2 uT = vec2((1.25 - p.z) / 2.5, 0.5 + p.x / 1.3); vec2 uF = vec2(0.5 + p.x / 1.3, (p.y - 0.12) / 0.8);",
    "    if (d == 1.0) { float ax = abs(p.x); float st = step(0.045, ax) * (1.0 - step(0.13, ax)) + step(0.152, ax) * (1.0 - step(0.165, ax)); pc = mix(pc, uDecC, st * (1.0 - ws)); }",
    "    else if (d == 2.0) { float yy = p.y - 0.635 - 0.025 * smoothstep(0.2, 1.1, p.z); float l1 = 1.0 - smoothstep(0.0035, 0.0065, abs(yy)); float l2 = 1.0 - smoothstep(0.0025, 0.0045, abs(yy + 0.022)); float hood = (1.0 - smoothstep(0.004, 0.007, abs(abs(p.x) - 0.24 - 0.04 * sin(p.z * 9.0)))) * step(0.35, p.z); pc = mix(pc, uDecC, clamp((l1 + l2) * ws + hood * wt, 0.0, 1.0)); }",
    "    else if (d >= 3.0 && d <= 5.0 || d >= 9.0) { float sl = d >= 9.0 ? d - 3.0 : d - 3.0; vec4 k = bsWrap(sl, uS); pc = mix(pc, uDecC, k.a * ws); if (d == 3.0) { vec4 k2 = bsWrap(0.0, vec2(uT.x * 1.6 - 0.1, uT.y)); pc = mix(pc, uDecC, k2.a * wt * step(0.3, p.z)); } }",
    "    else if (d >= 6.0 && d <= 8.0) { float sl = d - 3.0; vec2 rp = d == 6.0 ? vec2(1.0) : vec2(1.6, 1.0); vec4 a = bsWrap(sl, fract(uS * rp)); vec4 b = bsWrap(sl, fract(uT * rp * vec2(1.0, 0.6))); vec4 c = bsWrap(sl, fract(uF * rp)); if (d == 6.0) { b = bsWrap(sl, vec2(uT.x, 0.75 + 0.2 * uT.y)); c = bsWrap(sl, vec2(uF.x, 0.35 + uF.y * 0.6)); } vec3 wc = a.rgb * ws + b.rgb * wt + c.rgb * wf; pc = mix(pc, wc, 0.96); }",
    "    float e = uDec.y; if (e > 0.5) { vec4 em = vec4(0.0); if (bikeK < 0.5) { em = bsEmb(e - 1.0, vec2(p.x / 0.25 + 0.5, (p.y - 0.665) / 0.25 + 0.5)) * step(0.5, n.z) * step(0.85, p.z); vec4 es = bsEmb(e - 1.0, vec2(0.5 + (0.5 - p.z) * sx / 0.19, (p.y - 0.60) / 0.19 + 0.5)) * ws * step(0.3, p.z); em = em.a > es.a ? em : es; } else { em = bsEmb(e - 1.0, vec2(0.5 + (0.08 - p.z) * sx / 0.16, (p.y - 0.62) / 0.16 + 0.5)) * ws; } pc = mix(pc, em.rgb, em.a); }",
    "    if (uLab.z > 0.0) { vec4 tx = bikeK < 0.5 ? bsTxt(uLab, vec2(0.5 + (-0.2 - p.z) * sx / 0.52, (p.y - 0.40) / 0.13 + 0.5)) * ws : bsTxt(uLab, vec2(0.5 + (0.0 - p.z) * sx / 0.5, (p.y - 0.70) / 0.125 + 0.5)) * ws; pc = mix(pc, uLabC, tx.a); }",
    "    diffuseColor.rgb = pc * mix(1.0, det, 0.55); roughnessFactor = uFin.x; metalnessFactor = uFin.y; nk = 0.22;",
    "    if (uFin.z > 0.0) { vec3 sh = vec3(dot(pc, vec3(0.1, 0.6, 0.3)), dot(pc, vec3(0.3, 0.1, 0.6)), dot(pc, vec3(0.6, 0.3, 0.1))); diffuseColor.rgb = mix(diffuseColor.rgb, sh * 1.15 + 0.06, fres * uFin.z * 0.85); }",
    "    if (uFin.w > 0.0) { float sp = step(0.982, bsH(floor(p * 700.0))); diffuseColor.rgb += sp * uFin.w * 0.35; roughnessFactor = mix(roughnessFactor, 0.08, sp * uFin.w); }",
    "    if (uFin.y > 0.95) diffuseColor.rgb = mix(pc, vec3(0.93), 0.45);",
    "  } else if (R == 2.0) {",
    "    float det = clamp(lum / 0.85, 0.7, 1.15); vec3 rc = uRoof * det; float top = smoothstep(0.6, 0.85, n.y); float rs = uRoofS; roughnessFactor = 0.6; metalnessFactor = 0.0;",
    "    if (bikeK < 0.5) {",
    "    if (rs == 1.0) { vec2 c = fract(vec2(p.x * 6.4 + 0.5, p.z * 6.4)); float gl = step(0.06, c.x) * step(0.06, c.y); vec3 cell = mix(vec3(0.04, 0.07, 0.16), vec3(0.08, 0.13, 0.28), bsH(floor(vec3(p.x * 6.4, 0.0, p.z * 6.4)))); rc = mix(rc, mix(vec3(0.75, 0.78, 0.8), cell, gl), top); roughnessFactor = mix(0.6, 0.12, top); metalnessFactor = mix(0.0, 0.5, top); }",
    "    else if (rs == 2.0) { float s = step(0.5, fract(p.x * 3.4 + 0.5)); rc = mix(rc, mix(vec3(0.95, 0.94, 0.9), rc, s), top); }",
    "    else if (rs == 3.0) { float w = step(0.5, fract((p.x + p.z) * 22.0)) * 0.5 + step(0.5, fract((p.x - p.z) * 22.0)) * 0.5; rc = mix(rc, vec3(0.05 + 0.05 * w), max(top, 0.6)); roughnessFactor = 0.32; metalnessFactor = 0.25; }",
    "    else if (rs == 4.0) { float pk = floor(p.x * 8.0 + 4.0); float gr = bsH(vec3(pk, 0.0, 0.0)); float gn = 0.85 + 0.15 * sin(p.z * 60.0 + gr * 20.0 + sin(p.z * 9.0 + gr * 7.0) * 2.0); vec3 wd = mix(vec3(0.47, 0.29, 0.15), vec3(0.62, 0.41, 0.22), gr) * gn; float gap = step(0.04, fract(p.x * 8.0 + 4.0)); rc = mix(rc, wd * mix(0.4, 1.0, gap), max(top, 0.5)); roughnessFactor = 0.7; }",
    "    else if (rs == 5.0) { vec4 lg = bsEmb(0.0, vec2(p.x / 1.0 + 0.5, (-0.15 - p.z) / 1.0 + 0.5)); rc = mix(rc, lg.rgb, lg.a * top); }",
    "    else if (rs == 6.0) { float ck = mod(floor(p.x * 5.0 + 8.0) + floor(p.z * 5.0 + 8.0), 2.0); rc = mix(rc, mix(vec3(0.06), vec3(0.95), ck), top); }",
    "    }",
    "    diffuseColor.rgb = rc; nk = 0.4;",
    "  } else if (R == 3.0) {",
    "    float det = clamp(lum / 0.8, 0.6, 1.2); vec3 sc = uSeat; float ss = uSeatS; vec2 q = vec2(p.x, p.y + p.z);",
    "    if (ss == 1.0) { vec2 g = abs(fract(vec2(q.x + q.y, q.x - q.y) * 9.0) - 0.5); float l = 1.0 - smoothstep(0.03, 0.07, min(g.x, g.y)); sc = mix(sc, sc * 0.55, l); }",
    "    else if (ss == 2.0) { float g = abs(fract(p.x * 10.0) - 0.5); sc = sc * (0.72 + 0.28 * smoothstep(0.04, 0.2, g)); }",
    "    else if (ss == 3.0) { float ins = 1.0 - smoothstep(0.14, 0.16, abs(abs(p.x) - 0.31)); sc = mix(sc, uSeat2, ins); }",
    "    else if (ss == 4.0) { float ck = mod(floor(q.x * 12.0 + 20.0) + floor(q.y * 12.0 + 20.0), 2.0); sc = mix(sc, uSeat2, ck); }",
    "    else if (ss == 5.0) { float b = floor(q.y * 16.0 + 40.0); float m = mod(b, 7.0); vec3 sp = m < 1.0 ? uSeat2 : m < 2.0 ? vec3(0.8, 0.2, 0.15) : m < 3.0 ? vec3(0.95, 0.9, 0.8) : m < 4.0 ? vec3(0.1, 0.55, 0.55) : m < 5.0 ? vec3(0.9, 0.65, 0.15) : m < 6.0 ? uSeat : vec3(0.35, 0.12, 0.3); sc = sp; }",
    "    diffuseColor.rgb = sc * det; roughnessFactor = 0.62; metalnessFactor = 0.0; nk = 0.5;",
    "  } else if (R == 4.0 || R == 10.0) {",
    "    float det = R == 4.0 ? clamp(lum / 0.8, 0.55, 1.15) : 1.0; diffuseColor.rgb = uRim * det; metalnessFactor = uRimM.x; roughnessFactor = uRimM.y; nk = 0.3;",
    "  } else if (R == 5.0 || R == 11.0) {",
    "    vec3 wc = (bikeK > 0.5 ? p.z > 0.0 : p.z > 0.1) ? uWF : uWR; float rr = length(p.zy - wc.xy) / wc.z; float side = smoothstep(0.45, 0.75, abs(n.x));",
    "    vec3 tcol = R == 5.0 ? tc : vec3(0.045, 0.045, 0.05); if (R == 5.0) tcol = mix(tc, vec3(0.05), 0.25);",
    "    if (uTyre == 1.0) tcol = mix(tcol, vec3(0.93, 0.92, 0.88), side * step(uBand.x, rr) * (1.0 - step(uBand.y, rr)));",
    "    else if (uTyre == 2.0) tcol = mix(tcol, vec3(0.75, 0.08, 0.06), side * step(uBand.y - 0.05, rr) * (1.0 - step(uBand.y, rr)));",
    "    else if (uTyre == 3.0) tcol = mix(tcol, vec3(0.86, 0.8, 0.66), side * step(uBand.x, rr) * (1.0 - step(uBand.y, rr)));",
    "    diffuseColor.rgb = tcol; roughnessFactor = 0.85; metalnessFactor = 0.0;",
    "  } else if (R == 7.0) { diffuseColor.rgb = uRoof * clamp(lum / 0.85, 0.65, 1.1); roughnessFactor = 0.35; metalnessFactor = 0.3;",
    "  } else if (R == 8.0) { totalEmissiveRadiance += vec3(1.0, 0.95, 0.82) * (0.05 + uNight * 2.2) * (bikeK < 0.5 ? 1.0 : 0.0);",
    "  } else if (R == 9.0) { diffuseColor.rgb = uGrip * clamp(lum / 0.85, 0.6, 1.1); roughnessFactor = 0.7; metalnessFactor = 0.0;",
    "  } else if (R == 12.0) { diffuseColor.rgb = vec3(0.72, 0.08, 0.06); roughnessFactor = 0.35; metalnessFactor = 0.2;",
    "  } else if (R == 13.0) { diffuseColor.rgb = vec3(0.86, 0.88, 0.9); roughnessFactor = 0.12; metalnessFactor = 1.0;",
    "  } else if (R == 14.0) { diffuseColor.rgb = vec3(0.035, 0.036, 0.04); roughnessFactor = 0.55; metalnessFactor = 0.35;",
    "  } else if (R == 15.0) { diffuseColor.rgb = vec3(0.9, 0.91, 0.93); roughnessFactor = 0.08; metalnessFactor = 1.0;",
    "  } else if (R == 16.0) { diffuseColor.rgb = vec3(0.85, 0.9, 1.0); roughnessFactor = 0.2; metalnessFactor = 0.0; totalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * (0.35 + uNight * 3.5);",
    "  } else if (R == 17.0) { vec4 fl = bsFlag(uDec.z, vBsUv); diffuseColor.rgb = fl.rgb; roughnessFactor = 0.9; metalnessFactor = 0.0; totalEmissiveRadiance += fl.rgb * uNight * 0.12;",
    "  } else if (R == 18.0) { diffuseColor.rgb = uC1; roughnessFactor = 0.4; metalnessFactor = 0.05;",
    "  } else if (R == 19.0) { diffuseColor.rgb = vec3(0.92, 0.92, 0.9); roughnessFactor = 0.45; metalnessFactor = 0.0;",
    "  } else if (R == 20.0) { float g2 = step(0.5, fract(vBsUv.x * 60.0)) * step(0.5, fract(vBsUv.y * 14.0)); diffuseColor.rgb = vec3(0.03 + 0.03 * g2); roughnessFactor = 0.7; metalnessFactor = 0.2; totalEmissiveRadiance += uGlow * step(0.94, vBsUv.y) * (0.4 + uNight * 2.0);",
    "  } else if (R == 21.0) { diffuseColor.rgb = vec3(1.0, 0.35, 0.05); totalEmissiveRadiance += vec3(1.0, 0.3, 0.05) * (0.1 + uNight * 0.8); roughnessFactor = 0.3;",
    "  } else if (R == 22.0) { vec4 pt = bsTxt(uPlt, vBsUv); diffuseColor.rgb = pt.a > 0.0 ? pt.rgb : vec3(0.95); roughnessFactor = 0.4; metalnessFactor = 0.2; totalEmissiveRadiance += diffuseColor.rgb * uNight * 0.15;",
    "  } else if (R == 23.0) { diffuseColor.rgb = vec3(0.25, 0.2, 0.15); roughnessFactor = 0.8; metalnessFactor = 0.0;",
    "  } else if (R == 24.0) { diffuseColor.rgb = vec3(0.04); totalEmissiveRadiance += vec3(0.25, 0.6, 1.0) * (0.5 + 0.3 * sin(uTime * 2.0)); roughnessFactor = 0.1;",
    "  } else if (R == 25.0) { diffuseColor.rgb = uGlow * 0.3; totalEmissiveRadiance += uGlow * (1.2 + uNight * 2.5); roughnessFactor = 0.3; }",
    "  normal = normalize(mix(nonPerturbedNormal, normal, R >= 10.0 ? 0.0 : nk)); }"
  ].join("\n");
  function bsPatch(sh, U) {
    for (var k in U) sh.uniforms[k] = U[k]; sh.uniforms.uNight = GU.uNight; sh.uniforms.uTime = GU.uTime; sh.uniforms.tDec = GU.tDec; sh.uniforms.tTxt = GU.tTxt;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + VS_HEAD).replace("#include <begin_vertex>", "#include <begin_vertex>\n" + VS_BODY);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + FS_HEAD).replace("#include <lights_physical_fragment>", FS_BODY + "\n#include <lights_physical_fragment>"); indoorPatch(sh); sh.fragmentShader = sh.fragmentShader.replace("#include <aomap_fragment>", "if (vBsr < 9.5) {\n#include <aomap_fragment>\n}");
  }
  function mkObc(U) { return function (sh) { bsPatch(sh, U); }; }
  function newU() { return { uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uFin: { value: new THREE.Vector4(0.3, 0.1, 0, 0) }, uSplit: { value: 0 }, uRoof: { value: new THREE.Color(0xf1eee4) }, uRoofS: { value: 0 }, uSeat: { value: new THREE.Color(0xe8dcc0) }, uSeat2: { value: new THREE.Color(0xffffff) }, uSeatS: { value: 0 },
    uRim: { value: new THREE.Color(0xc9ccd0) }, uRimM: { value: new THREE.Vector2(0.8, 0.3) }, uTyre: { value: 0 }, uBand: { value: new THREE.Vector2(0.62, 0.8) }, uDec: { value: new THREE.Vector4(0, 0, 0, 0) }, uDecC: { value: new THREE.Color(0xffffff) }, uLab: { value: new THREE.Vector4(0, 0, 0, 0) }, uLabC: { value: new THREE.Color(0xffffff) }, uPlt: { value: new THREE.Vector4(0, 0, 0, 0) },
    uLift: { value: 0 }, uWS: { value: 1 }, uWF: { value: new THREE.Vector3(0.9804, 0.272, 0.2693) }, uWR: { value: new THREE.Vector3(-0.7835, 0.2897, 0.2832) }, uKind: { value: 0 }, uGrip: { value: new THREE.Color(0xf2f1ec) }, uGlow: { value: new THREE.Color(0x4dde6f) } }; }
  // the finish table: roughness, metalness, pearl, flake
  var FIN = [[0.26, 0.12, 0, 0], [0.82, 0.0, 0, 0], [0.32, 0.62, 0, 0.55], [0.24, 0.22, 1.0, 0.15], [0.05, 1.0, 0, 0], [0.16, 0.5, 0.35, 1.0]];
  var RIMM = [[0.85, 0.3], [1.0, 0.05], [0.2, 0.18], [1.0, 0.2], [0.85, 0.32], [0.9, 0.35], [0.1, 0.35], [0.3, 0.28], [0.3, 0.25], [1.0, 0.25]];
  var BAND = [[0.62, 0.8], [0.62, 0.8], [0.62, 0.8], [0.62, 0.8], [0.62, 0.8]];
  function palHex(list, i, d) { var L = CAT(list); var e = L[i] || L[0]; return e ? e[1] : d; }
  // write a look into a uniform set (cart or bike)
  function setU(U, look, kind, txt) {
    var L = look || {}; U.uKind.value = kind === "cart" ? 0 : 1;
    if (kind === "cart") {
      var pc = hexC(palHex("paints", L.p || 0, "2a8a45")); U.uC1.value.copy(pc); U.uC2.value.copy(hexC(palHex("paints", L.p2 || 0, "f2f0ea")));
      var F = FIN[L.f || 0] || FIN[0]; U.uFin.value.set(F[0], F[1], F[2], F[3]); U.uSplit.value = L.t || 0;
      var rh = palHex("roofs", L.r || 0, "f1eee4"); U.uRoof.value.copy(rh === "match" ? pc : hexC(rh)); U.uRoofS.value = L.rs || 0;
      U.uSeat.value.copy(hexC(palHex("seats", L.s || 0, "e8dcc0"))); U.uSeat2.value.copy(hexC(palHex("seats", L.s2 || 0, "f4f2ee"))); U.uSeatS.value = L.sp || 0;
      var wh = palHex("rimColors", L.wc || 0, "c9ccd0"); U.uRim.value.copy(wh === "match" ? pc : hexC(wh)); var M = RIMM[L.wc || 0] || RIMM[0]; U.uRimM.value.set(M[0], M[1]);
      U.uTyre.value = L.ty === 1 ? 1 : L.ty === 2 ? 2 : 0; var custom = !!(L.w || L.ty === 3 || L.ty === 4); U.uBand.value.set(custom ? (L.ty === 4 ? 0.87 : 0.76) : 0.62, custom ? (L.ty === 4 ? 0.94 : 0.87) : 0.8);
      U.uDec.value.set(L.d || 0, L.e || 0, L.fl || 0, 0); U.uDecC.value.copy(hexC(palHex("decalColors", L.dc || 0, "f5f5f2")));
      U.uLift.value = L.l === 1 ? 0.15 : L.l === 2 ? -0.045 : 0; U.uWS.value = L.l === 1 && !custom ? 1.12 : 1; if (custom) { var wsp = wheelSpec(L); U.uWF.value.set(wsp.zf, wsp.R, wsp.R); U.uWR.value.set(wsp.zr, wsp.R, wsp.R); } else { U.uWF.value.set(0.9804, 0.272, 0.2693); U.uWR.value.set(-0.7835, 0.2897, 0.2832); }
      U.uGlow.value.copy(hexC(palHex("glow", L.u || 0, "4dde6f")));
      var lc = L.dc !== undefined && L.d ? U.uDecC.value : (pc.r * 0.3 + pc.g * 0.59 + pc.b * 0.11 > 0.5 ? new THREE.Color(0x141414) : new THREE.Color(0xf5f5f2)); U.uLabC.value.copy(lc);
      var ls = txt && txt.lab ? txt.lab : null, ps = txt && txt.plt ? txt.plt : null; U.uLab.value.set(ls ? ls[0] : 0, ls ? ls[1] : 0, ls ? ls[2] : 0, ls ? ls[3] : 0); U.uPlt.value.set(ps ? ps[0] : 0, ps ? ps[1] : 0, ps ? ps[2] : 0, ps ? ps[3] : 0);
    } else {
      var bp = CAT("bikePaint"); var fc = hexC((bp[L.f || 0] || bp[0] || [0, "2a9d9a"])[1]); U.uC1.value.copy(fc); U.uC2.value.copy(fc); var fe = L.fe === undefined ? 1 : L.fe; U.uRoof.value.copy(hexC((bp[fe] || bp[1] || [0, "f2f1ec"])[1])); U.uRoofS.value = 0;
      U.uFin.value.set(L.f === 11 ? 0.05 : 0.28, L.f === 11 ? 1.0 : L.f === 10 ? 0.75 : 0.12, 0, 0); U.uSplit.value = 0;
      var br = CAT("bikeRims"); U.uRim.value.copy(hexC((br[L.w || 0] || br[0] || [0, "f2f2ee"])[1])); var mm = L.w === 2 || L.w === 3 ? [1.0, 0.12] : L.w === 4 ? [0.85, 0.3] : [0.15, 0.35]; U.uRimM.value.set(mm[0], mm[1]);
      U.uTyre.value = L.t === 1 ? 1 : L.t === 2 ? 3 : 0; U.uBand.value.set(0.84, 0.95);
      var bg = CAT("bikeGrips"); U.uGrip.value.copy(hexC((bg[L.g || 0] || bg[0] || [0, "f2f1ec"])[1])); var bs = CAT("bikeSeats"); var sh = (bs[L.s || 0] || bs[0] || [0, "f2f1ec"])[1]; U.uSeat.value.copy(sh === "serape" ? new THREE.Color(0xc0462d) : hexC(sh)); U.uSeat2.value.copy(new THREE.Color(0x1d6b6b)); U.uSeatS.value = sh === "serape" ? 5 : 0;
      var dmap = [0, 3, 2, 5, 9]; U.uDec.value.set(dmap[L.d || 0] || 0, 0, 0, 0); U.uDecC.value.copy(hexC(palHex("decalColors", L.dc || 0, "f5f5f2")));
      U.uLift.value = 0; U.uWS.value = 1; var W = WHEELS.bike2; U.uWF.value.set(W[0][0], W[0][1], W[0][2]); U.uWR.value.set(W[1][0], W[1][1], W[1][2]); U.uLab.value.set(0, 0, 0, 0); U.uPlt.value.set(0, 0, 0, 0);
    }
  }
  // the atlases: decals (a file) and text (a canvas of 64 slots, 256 x 64, reference counted by their text)
  function decalTex() { if (GU.tDec.value) return GU.tDec.value; var t = new THREE.TextureLoader().load(au(lowTier() ? "/tex/bs_decals_m.png" : "/tex/bs_decals.png")); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.userData.bsShared = true; GU.tDec.value = t; return t; }
  var TXT = BS.txt = BS.txt || { cv: null, tex: null, slots: {}, free: [], n: 0, dirty: false };
  function txtTex() { if (TXT.tex) return TXT.tex; var cv = TXT.cv = document.createElement("canvas"); cv.width = 1024; cv.height = 1024; for (var i = 63; i >= 0; i--) TXT.free.push(i); var t = TXT.tex = new THREE.CanvasTexture(cv); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.userData.bsShared = true; GU.tTxt.value = t; return t; }
  // a slot holds one text: "L|text" a side label (white on clear), "P|text" a plate (the plate graphic)
  function txtSlot(key) { if (!key) return null; txtTex(); var s = TXT.slots[key]; if (s) { s.ref++; return s.r; } var i = TXT.free.pop(); if (i === undefined) { var lru = null; for (var k in TXT.slots) if (TXT.slots[k].ref <= 0 && (!lru || TXT.slots[k].at < TXT.slots[lru].at)) lru = k; if (!lru) return null; i = TXT.slots[lru].i; delete TXT.slots[lru]; }
    var col = i % 4, row = (i / 4) | 0, x0 = col * 256, y0 = row * 64, x = TXT.cv.getContext("2d"); x.clearRect(x0, y0, 256, 64); var txt = key.slice(2);
    if (key[0] === "P") { x.fillStyle = "#f4efe2"; x.beginPath(); if (x.roundRect) x.roundRect(x0 + 3, y0 + 3, 250, 58, 7); else x.rect(x0 + 3, y0 + 3, 250, 58); x.fill(); x.strokeStyle = "#b8643a"; x.lineWidth = 4; x.stroke(); x.fillStyle = "#b8643a"; x.font = "700 10px 'JetBrains Mono', monospace"; x.textAlign = "center"; x.fillText("SOLPORT  ·  GENESIS", x0 + 128, y0 + 15); x.fillStyle = "#16223f"; x.font = "700 34px 'Space Grotesk', system-ui, sans-serif"; x.fillText(txt, x0 + 128, y0 + 50, 236); }
    else { x.fillStyle = "#ffffff"; x.textAlign = "center"; x.textBaseline = "middle"; var fs = 46; x.font = "400 " + fs + "px Anton, Impact, sans-serif"; while (fs > 18 && x.measureText(txt).width > 244) { fs -= 2; x.font = "400 " + fs + "px Anton, Impact, sans-serif"; } x.fillText(txt, x0 + 128, y0 + 34, 248); x.textBaseline = "alphabetic"; }
    TXT.tex.needsUpdate = true; var r = [x0 / 1024, y0 / 1024, 256 / 1024, 64 / 1024]; TXT.slots[key] = { i: i, ref: 1, r: r, at: nowMs() }; TXT.n++; return r; }
  function txtRelease(key) { var s = key && TXT.slots[key]; if (s) { s.ref--; s.at = nowMs(); } }
  // materials: one per distinct look (shared program), reference counted; the preview has its own and changes uniforms in place
  var MATS = BS.mats = BS.mats || {};
  function baseMat(kind) { var G = GEO[kind]; return G ? G.base : null; }
  function makeMat(kind, look) {
    var base = baseMat(kind === "bike" ? "bike2" : kind); if (!base) return null; var U = newU(); var txt = { lab: null, plt: null, keys: [] };
    if (kind === "cart" && look) { if (look.lb) { txt.keys.push("L|" + look.lb); txt.lab = txtSlot("L|" + look.lb); } if (look.pl) { txt.keys.push("P|" + look.pl); txt.plt = txtSlot("P|" + look.pl); } }
    decalTex(); txtTex(); setU(U, look, kind, txt);
    var m = base.clone(); m.onBeforeCompile = mkObc(U); m.name = "bs_vehicle"; m.userData.bsU = U; m.userData.bsTxt = txt.keys; m.userData.bsShared = true; if (m.envMapIntensity !== undefined) m.envMapIntensity = 1.0; BS.n.mats++; return m; }
  function matFor(kind, look) { var key = kind + "|" + lookKey(look); var e = MATS[key]; if (e) { e.ref++; e.at = nowMs(); return e.m; } var m = makeMat(kind, look); if (!m) return null; MATS[key] = { m: m, ref: 1, at: nowMs(), key: key }; m.userData.bsKey = key; return m; }
  function matRelease(m) { if (!m || !m.userData.bsKey) return; var e = MATS[m.userData.bsKey]; if (e) { e.ref--; e.at = nowMs(); } }
  // unused looks go after a while (their text slots with them); the material's program stays (it is shared)
  function matSweep() { var t = nowMs(); for (var k in MATS) { var e = MATS[k]; if (e.ref <= 0 && t - e.at > 30000) { (e.m.userData.bsTxt || []).forEach(txtRelease); try { e.m.dispose(); } catch (x) {} delete MATS[k]; BS.n.matFree = (BS.n.matFree || 0) + 1; } } }

  // ───────────────────────── parts: custom wheels and the bolt-on accessories, merged per choice and cached ─────────────────────────
  // Every part carries the same attributes as the segmented model (position, normal, uv, tangent, bsr) so it draws with the look's own
  // material: one program for the whole vehicle. Positions are in the cart's frame (front +z, driver side +x, ground y 0).
  function RB() { this.L = []; this.tris = 0; }
  RB.prototype.add = function (g, reg, m4) { if (g.index) g = g.toNonIndexed(); if (m4) g.applyMatrix4(m4); if (!g.attributes.normal) g.computeVertexNormals(); var n = g.attributes.position.count;
    if (m4 && m4.determinant() < 0) { var P = g.attributes.position.array, N = g.attributes.normal.array, Uv = g.attributes.uv ? g.attributes.uv.array : null; for (var t = 0; t < n; t += 3) for (var c = 0; c < 3; c++) { var a = (t + 1) * 3 + c, b = (t + 2) * 3 + c, q = P[a]; P[a] = P[b]; P[b] = q; q = N[a]; N[a] = N[b]; N[b] = q; } if (Uv) for (var t2 = 0; t2 < n; t2 += 3) for (var c2 = 0; c2 < 2; c2++) { var a2 = (t2 + 1) * 2 + c2, b2 = (t2 + 2) * 2 + c2, q2 = Uv[a2]; Uv[a2] = Uv[b2]; Uv[b2] = q2; } }
    g.userData.reg = reg; this.L.push(g); this.tris += n / 3; return g; };
  RB.prototype.at = function (g, reg, x, y, z, rx, ry, rz, sx, sy, sz) { _e.set(rx || 0, ry || 0, rz || 0, "XYZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(x || 0, y || 0, z || 0), _q, _v2.set(sx || 1, sy || 1, sz || 1)); return this.add(g, reg, _m4); };
  RB.prototype.box = function (reg, w, h, d, x, y, z, rx, ry, rz) { return this.at(new THREE.BoxGeometry(w, h, d), reg, x, y, z, rx, ry, rz); };
  RB.prototype.cylX = function (reg, r0, r1, len, x, y, z, seg, open) { var g = new THREE.CylinderGeometry(r0, r1, len, seg || 16, 1, !!open); g.rotateZ(-PI / 2); return this.at(g, reg, x, y, z); };
  RB.prototype.tube = function (reg, A, B, r, seg) { var d = _v3.subVectors(B, A), L = d.length(); if (L < 1e-4) return null; var g = new THREE.CylinderGeometry(r, r, L, seg || 8, 1, true); _q.setFromUnitVectors(_v1.set(0, 1, 0), d.clone().normalize()); _m4.compose(_v2.addVectors(A, B).multiplyScalar(0.5), _q, _s1); return this.add(g, reg, _m4); };
  RB.prototype.path = function (reg, pts, r, seg) { for (var i = 0; i < pts.length - 1; i++) this.tube(reg, pts[i], pts[i + 1], r, seg); for (var j = 1; j < pts.length - 1; j++) this.at(new THREE.SphereGeometry(r, seg || 8, 4), reg, pts[j].x, pts[j].y, pts[j].z); };
  RB.prototype.merge = function () { var n = 0; this.L.forEach(function (g) { n += g.attributes.position.count; }); if (!n) return null; var P = new Float32Array(n * 3), N = new Float32Array(n * 3), Uu = new Float32Array(n * 2), Tt = new Float32Array(n * 4), Rr = new Float32Array(n), o = 0;
    this.L.forEach(function (g) { var c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) Uu.set(g.attributes.uv.array, o * 2); for (var i = 0; i < c; i++) { Tt[(o + i) * 4] = 1; Tt[(o + i) * 4 + 3] = 1; Rr[o + i] = g.userData.reg; } o += c; });
    var r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(Uu, 2)); r.setAttribute("tangent", new THREE.BufferAttribute(Tt, 4)); r.setAttribute("bsr", new THREE.BufferAttribute(Rr, 1)); r.computeBoundingBox(); r.computeBoundingSphere(); r.userData.bsKeep = true; this.L = []; return r; };

  // ── wheels: eight rim designs on five tyres, four wheels in one mesh ──
  function wheelSpec(L) { L = L || {}; var ty = L.ty | 0, R = ty === 3 ? 0.3 : 0.276; if (L.l === 1) R *= 1.12; var rr = ty === 4 ? R * 0.8 : ty === 3 ? R * 0.56 : R * 0.64, w = ty === 3 ? 0.235 : ty === 4 ? 0.2 : 0.19; return { R: R, rr: rr, w: w, x: 0.528 + (ty === 3 ? 0.022 : 0) + (L.l === 1 ? 0.03 : 0), zf: 0.9804, zr: -0.7835, design: L.w | 0, ty: ty }; }
  function wheelOne(B, S, m4) {
    // one wheel at the origin, axle along x, its face toward +x; m4 places (and mirrors) it
    var R = S.R, rr = S.rr, w = S.w, xo = w * 0.32, seg = 40, k, a, add = function (g, reg) { B.add(g, reg, m4); }, at = function (g, reg, x, y, z, rx) { _e.set(rx || 0, 0, 0, "XYZ"); _q.setFromEuler(_e); var mm = new THREE.Matrix4().compose(_v1.set(x, y, z), _q, _s1); mm.premultiply(m4); B.add(g, reg, mm); };
    var latheX = function (prof, s) { var g = lathe(prof, s || seg); g.rotateZ(-PI / 2); return g; };
    // tyre: a rounded section from the rim's bead to the tread
    var h = w / 2, sw = R - rr; add(latheX([[rr + 0.004, -h * 0.82], [rr + sw * 0.35, -h], [R - 0.03, -h * 0.98], [R - 0.008, -h * 0.75], [R, -h * 0.4], [R, h * 0.4], [R - 0.008, h * 0.75], [R - 0.03, h * 0.98], [rr + sw * 0.35, h], [rr + 0.004, h * 0.82]]), 11);
    if (S.ty === 3) { for (k = 0; k < 30; k++) for (var row = 0; row < 2; row++) { a = (k + row * 0.5) / 30 * TAU; var bx = (row ? 1 : -1) * w * 0.22, g = new THREE.BoxGeometry(w * 0.4, 0.034, 0.075); var mm = new THREE.Matrix4().makeRotationX(-a); mm.setPosition(bx, Math.cos(a) * (R - 0.004), Math.sin(a) * (R - 0.004)); mm.premultiply(m4); B.add(g, 11, mm); } }
    else for (var gi = -1; gi <= 1; gi++) add(latheX([[R + 0.001, gi * h * 0.28 - 0.006], [R + 0.001, gi * h * 0.28 + 0.006]], 40), 14);
    // barrel, lip, back plate, brake
    add(latheX([[rr, -h * 0.85], [rr, h * 0.62]], 32), 10);
    add(new THREE.TorusGeometry(rr, 0.011, 6, 36).rotateY(PI / 2).translate(h * 0.62, 0, 0), S.design === 7 || S.design === 4 ? 15 : 10);
    add(new THREE.CircleGeometry(rr * 0.98, 24).rotateY(-PI / 2).translate(-h * 0.6, 0, 0), 14);
    add(new THREE.CylinderGeometry(rr * 0.7, rr * 0.7, 0.012, 24).rotateZ(PI / 2).translate(xo - 0.05, 0, 0), 14);
    at(new THREE.BoxGeometry(0.035, 0.07, 0.05), 12, xo - 0.04, rr * 0.55, -rr * 0.25, 0.4);
    // the face
    var D = S.design, face = function (r0, r1, wdt0, wdt1, ang, th, reg, twist) { var L = r1 - r0, g = new THREE.BoxGeometry(th, L, 1, 1, 3, 1); var p = g.attributes.position; for (var i = 0; i < p.count; i++) { var y = p.getY(i), t = (y + L / 2) / L, wz = lerp(wdt0, wdt1, t); p.setZ(i, p.getZ(i) * wz + (twist || 0) * t * t * L); p.setY(i, y + r0 + L / 2); } g.computeVertexNormals(); g.rotateX(ang); g.translate(xo, 0, 0); add(g, reg); };
    if (D === 0) { for (k = 0; k < 8; k++) face(0.045, rr - 0.008, 0.05, 0.035, k / 8 * TAU, 0.022, 10); }
    else if (D === 1) { for (k = 0; k < 5; k++) face(0.045, rr - 0.008, 0.07, 0.045, k / 5 * TAU, 0.03, 10); }
    else if (D === 2) { for (k = 0; k < 10; k++) { face(0.045, rr - 0.008, 0.014, 0.012, k / 10 * TAU, 0.016, 10, 0.06); face(0.045, rr - 0.008, 0.014, 0.012, k / 10 * TAU + 0.31, 0.016, 10, -0.06); } }
    else if (D === 3) { for (k = 0; k < 12; k++) face(0.05, rr - 0.006, 0.028, 0.04, k / 12 * TAU, 0.02, 10, 0.09); }
    else if (D === 4) { add(latheX([[0.05, xo + 0.014], [rr * 0.6, xo + 0.004], [rr - 0.004, xo - 0.006]], 36), 10); for (k = 0; k < 8; k++) { a = k / 8 * TAU; at(new THREE.CylinderGeometry(0.018, 0.018, 0.01, 12).rotateZ(PI / 2), 14, xo + 0.012, Math.cos(a) * rr * 0.62, Math.sin(a) * rr * 0.62); } }
    else if (D === 5) { for (k = 0; k < 5; k++) { face(0.045, rr - 0.008, 0.022, 0.018, k / 5 * TAU - 0.11, 0.024, 10); face(0.045, rr - 0.008, 0.022, 0.018, k / 5 * TAU + 0.11, 0.024, 10); } }
    else if (D === 6) { add(latheX([[0.05, xo + 0.01], [rr - 0.01, xo - 0.004]], 36), 10); for (k = 0; k < 6; k++) { a = k / 6 * TAU + 0.26; at(new THREE.BoxGeometry(0.012, 0.05, 0.06), 14, xo + 0.009, Math.cos(a) * rr * 0.55, Math.sin(a) * rr * 0.55, -a); } add(new THREE.TorusGeometry(rr - 0.012, 0.016, 6, 36).rotateY(PI / 2).translate(xo + 0.008, 0, 0), 14); for (k = 0; k < 16; k++) { a = k / 16 * TAU; at(new THREE.CylinderGeometry(0.007, 0.007, 0.016, 6).rotateZ(PI / 2), 13, xo + 0.024, Math.cos(a) * (rr - 0.012), Math.sin(a) * (rr - 0.012)); } }
    else if (D === 7) { for (k = 0; k < 36; k++) { a = k / 36 * TAU; var a2 = a + (k % 2 ? 0.55 : -0.55), ox = k % 2 ? 0.018 : -0.012; var A = _v1.set(xo + ox, Math.cos(a) * 0.045, Math.sin(a) * 0.045).clone().applyMatrix4(m4), Bp = _v2.set(xo - 0.01, Math.cos(a2) * (rr - 0.008), Math.sin(a2) * (rr - 0.008)).clone().applyMatrix4(m4); B.tube(13, A, Bp, 0.0032, 4); } at(new THREE.BoxGeometry(0.02, 0.17, 0.035), 13, xo + 0.05, 0, 0, 0.6); at(new THREE.BoxGeometry(0.02, 0.17, 0.035), 13, xo + 0.05, 0, 0, -0.97); }
    // hub, cap and lug nuts
    add(new THREE.CylinderGeometry(0.048, 0.052, 0.035, 20).rotateZ(PI / 2).translate(xo + 0.012, 0, 0), D === 2 || D === 6 ? 13 : 10);
    add(new THREE.CylinderGeometry(0.026, 0.03, 0.02, 16).rotateZ(PI / 2).translate(xo + 0.036, 0, 0), 13);
    for (k = 0; k < 5; k++) { a = k / 5 * TAU; at(new THREE.CylinderGeometry(0.0065, 0.0065, 0.016, 6).rotateZ(PI / 2), 13, xo + 0.032, Math.cos(a) * 0.036, Math.sin(a) * 0.036); }
  }
  var WCACHE = BS.wcache = BS.wcache || {};
  function wheelGeo(L) { var S = wheelSpec(L), key = [S.design, S.ty, L && L.l === 1 ? 1 : 0].join(":"); if (WCACHE[key]) return WCACHE[key]; var B = new RB(), t0 = nowMs();
    [[1, S.zf], [-1, S.zf], [1, S.zr], [-1, S.zr]].forEach(function (q) { var m4 = new THREE.Matrix4().makeTranslation(q[0] * S.x, S.R, q[1]); if (q[0] < 0) m4.multiply(new THREE.Matrix4().makeScale(-1, 1, 1)); wheelOne(B, S, m4); });
    var g = B.merge(); g.userData.spec = S; WCACHE[key] = g; BS.n.wheels++; BS.n.wheelMs = Math.round((nowMs() - t0) * 10) / 10; return g; }

  // ── accessories: the bits of look.a, merged per set (plus the plate and the lift kit) ──
  function roofY(z) { return 1.856 + (z + 1.2) * 0.0855; }
  function accPart(B, bit, L) {
    var x, z, k;
    if (bit === 0) { var y0 = roofY(0.7) + 0.03; B.box(14, 0.98, 0.07, 0.09, 0, y0 + 0.035, 0.7); for (k = 0; k < 8; k++) B.box(16, 0.09, 0.045, 0.01, -0.42 + k * 0.12, y0 + 0.035, 0.75); [-0.4, 0.4].forEach(function (bx) { B.box(14, 0.03, 0.05, 0.03, bx, y0 - 0.01, 0.68); }); }
    else if (bit === 2) { [-0.42, 0.42].forEach(function (rx) { var A = V3(rx, roofY(-1.08) + 0.07, -1.08), Bq = V3(rx, roofY(0.62) + 0.07, 0.62); B.tube(14, A, Bq, 0.014, 8); [-1.0, -0.2, 0.55].forEach(function (lz) { B.box(14, 0.025, 0.07, 0.025, rx, roofY(lz) + 0.035, lz); }); }); [-0.9, -0.3, 0.3].forEach(function (cz) { B.tube(14, V3(-0.42, roofY(cz) + 0.07, cz), V3(0.42, roofY(cz) + 0.07, cz), 0.011, 6); }); }
    else if (bit === 3) { var cx = -0.77, cy = 0.74, cz = -0.2; B.at(rbox(0.3, 0.27, 0.42, 0.03, 2), 18, cx, cy, cz); B.at(rbox(0.31, 0.06, 0.43, 0.02, 2), 19, cx, cy + 0.155, cz); B.box(14, 0.02, 0.05, 0.3, cx + 0.155, cy + 0.08, cz); B.box(14, 0.14, 0.03, 0.03, -0.66, cy - 0.12, cz - 0.15); B.box(14, 0.14, 0.03, 0.03, -0.66, cy - 0.12, cz + 0.15); B.tube(14, V3(cx - 0.11, cy + 0.2, cz - 0.12), V3(cx - 0.11, cy + 0.2, cz + 0.12), 0.008, 6); }
    else if (bit === 4) { var sy = roofY(0.5) - 0.18; B.at(rbox(0.92, 0.12, 0.13, 0.03, 2), 14, 0, sy, 0.5); var gr = new THREE.PlaneGeometry(0.86, 0.09); var U = gr.attributes.uv; B.at(gr, 20, 0, sy, 0.5655); [-0.36, 0.36].forEach(function (bx) { B.box(14, 0.03, 0.12, 0.03, bx, sy + 0.1, 0.5); }); }
    else if (bit === 5) { var px = 0.5, pz = -1.16, pb = roofY(pz), top = pb + 1.55; B.tube(14, V3(px, pb, pz), V3(px, top, pz), 0.011, 6); B.at(new THREE.SphereGeometry(0.02, 8, 4), 15, px, top + 0.01, pz);
      var fw = 0.58, fh = 0.38, fg = new THREE.PlaneGeometry(fw, fh, 12, 4); fg.rotateY(PI / 2); fg.translate(0, 0, -fw / 2); var P = fg.attributes.position, Uv = fg.attributes.uv; for (var i = 0; i < P.count; i++) Uv.setXY(i, -P.getZ(i) / fw, Uv.getY(i)); B.at(fg.clone(), 17, px + 0.006, top - fh / 2 - 0.02, pz); var fb = fg.clone(); fb.rotateY(PI); fb.translate(0, 0, -fw); var Pb = fb.attributes.position, Ub = fb.attributes.uv; for (var j = 0; j < Pb.count; j++) Ub.setXY(j, -Pb.getZ(j) / fw, Ub.getY(j)); B.at(fb, 17, px - 0.006, top - fh / 2 - 0.02, pz); }
    else if (bit === 6) { var gz = 1.29; B.path(14, [V3(-0.42, 0.22, gz - 0.08), V3(-0.42, 0.74, gz), V3(0.42, 0.74, gz), V3(0.42, 0.22, gz - 0.08)], 0.02, 8); B.tube(14, V3(-0.42, 0.42, gz - 0.03), V3(0.42, 0.42, gz - 0.03), 0.018, 8); [-0.16, 0.16].forEach(function (bx) { B.tube(14, V3(bx, 0.42, gz - 0.03), V3(bx, 0.74, gz), 0.016, 8); }); [-0.42, 0.42].forEach(function (bx) { B.tube(14, V3(bx, 0.3, gz - 0.06), V3(bx * 0.9, 0.32, 1.1), 0.014, 6); }); }
    else if (bit === 7) { [-1, 1].forEach(function (sd) { B.box(15, 0.13, 0.025, 1.08, sd * 0.655, 0.25, 0.13); B.box(14, 0.13, 0.04, 1.1, sd * 0.655, 0.225, 0.13); [-0.3, 0.55].forEach(function (bz) { B.box(14, 0.09, 0.03, 0.04, sd * 0.6, 0.27, bz); }); }); }
    else if (bit === 8) { [[0.62, 1], [-1.12, -1]].forEach(function (q) { [-1, 1].forEach(function (sd) { B.box(14, 0.18, 0.24, 0.012, sd * 0.53, 0.19, q[0]); B.box(21, 0.06, 0.02, 0.004, sd * 0.53, 0.26, q[0] - 0.008 * q[1]); }); }); }
    else if (bit === 9) { var z0 = -1.3, z1 = -1.62, by = 0.42, bh = 0.27, bw = 0.33; for (k = 0; k <= 6; k++) { var tx = -bw + k * (bw * 2 / 6); B.tube(15, V3(tx, by, z0), V3(tx, by + bh, z0), 0.005, 4); B.tube(15, V3(tx, by, z1), V3(tx, by + bh, z1), 0.005, 4); B.tube(15, V3(tx, by, z0), V3(tx, by, z1), 0.005, 4); } for (k = 0; k <= 4; k++) { var tz = z0 + k * (z1 - z0) / 4; [-bw, bw].forEach(function (sx2) { B.tube(15, V3(sx2, by, tz), V3(sx2, by + bh, tz), 0.005, 4); }); }
      [by, by + bh * 0.5, by + bh].forEach(function (ty) { B.path(15, [V3(-bw, ty, z0), V3(-bw, ty, z1), V3(bw, ty, z1), V3(bw, ty, z0)], 0.006, 4); }); B.tube(14, V3(-0.2, by, z0), V3(-0.2, 0.38, -1.22), 0.012, 6); B.tube(14, V3(0.2, by, z0), V3(0.2, 0.38, -1.22), 0.012, 6); }
    else if (bit === 10) { var W = [0.234, 1.227, 0.352]; B.tube(14, V3(W[0], W[1] - 0.12, W[2] + 0.07), V3(W[0] - 0.13, W[1] - 0.05, W[2] + 0.12), 0.008, 6); B.at(rbox(0.085, 0.16, 0.014, 0.008, 1), 14, W[0] - 0.16, W[1] - 0.01, W[2] + 0.13, -0.45, 0.25, 0); var sc = new THREE.PlaneGeometry(0.072, 0.14); B.at(sc, 24, W[0] - 0.16, W[1] - 0.01 - 0.003, W[2] + 0.13 - 0.008, -0.45 + PI, 0.25 + PI, 0); }
  }
  var ACACHE = BS.acache = BS.acache || {};
  function accGeo(L) { L = L || {}; var a = (L.a || 0) & 2045, plate = !!L.pl, lift = L.l === 1, key = a + ":" + (plate ? 1 : 0) + ":" + (lift ? 1 : 0); if (!a && !plate && !lift) return null; if (ACACHE[key]) return ACACHE[key]; var B = new RB(), t0 = nowMs();
    for (var b = 0; b < 11; b++) if (b !== 1 && a & (1 << b)) accPart(B, b, L);
    if (plate) { B.box(14, 0.34, 0.1, 0.012, 0, 0.385, -1.248); var pg = new THREE.PlaneGeometry(0.32, 0.08); pg.rotateY(PI); B.at(pg, 22, 0, 0.385, -1.256); }
    if (lift) { [[0.9804], [-0.7835]].forEach(function (q) { [-1, 1].forEach(function (sd) { var cx = sd * 0.36, A = V3(cx, 0.28, q[0]), Bq = V3(cx, 0.6, q[0] - 0.05 * Math.sign(q[0])); var n = 9; for (var i = 0; i < n; i++) { var t0 = i / n, t1 = (i + 1) / n, a0 = t0 * 6 * TAU, a1 = t1 * 6 * TAU; B.tube(12, V3(cx + Math.cos(a0) * 0.04, lerp(A.y, Bq.y, t0), q[0] + Math.sin(a0) * 0.04), V3(cx + Math.cos(a1) * 0.04, lerp(A.y, Bq.y, t1), q[0] + Math.sin(a1) * 0.04), 0.008, 4); } B.tube(14, A, Bq, 0.014, 6); B.box(14, 0.12, 0.08, 0.16, sd * 0.42, 0.46 - 0.15, q[0] * 0.98); }); }); }
    var g = B.merge(); if (!g) return null; ACACHE[key] = g; BS.n.accs++; BS.n.accMs = Math.round((nowMs() - t0) * 10) / 10; return g; }
  // ── underglow: a soft additive pool under the body (one geometry, one material per colour) ──
  var GLOW = BS.glow = BS.glow || { geo: null, mats: {} };
  function glowMat(i) { if (GLOW.mats[i]) return GLOW.mats[i]; if (!GLOW.tex) { var cv = document.createElement("canvas"); cv.width = 64; cv.height = 128; var x = cv.getContext("2d"); var g = x.createRadialGradient(32, 64, 4, 32, 64, 62); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.save(); x.scale(1, 1); x.fillRect(0, 0, 64, 128); x.restore(); GLOW.tex = new THREE.CanvasTexture(cv); GLOW.tex.userData.bsShared = true; }
    var m = new THREE.MeshBasicMaterial({ map: GLOW.tex, vertexColors: true, color: hexC(palHex("glow", i, "4dde6f")), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }); m.name = "bs_glow"; m.userData.bsShared = true; GLOW.mats[i] = m; return m; }
  function glowGeo() { if (GLOW.geo) return GLOW.geo; var g = new THREE.PlaneGeometry(1.9, 3.3); g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)); g.rotateX(-PI / 2); g.translate(0, 0.035, 0.1); g.userData.bsKeep = true; GLOW.geo = g; return g; }
  function glowStrip(B) { [-1, 1].forEach(function (sd) { B.box(25, 0.02, 0.012, 1.0, sd * 0.56, 0.2, 0.1); }); B.box(25, 0.8, 0.012, 0.02, 0, 0.2, 1.1); B.box(25, 0.8, 0.012, 0.02, 0, 0.3, -1.18); }
  // ── the bike's front basket ──
  var BKB = BS.bkb = BS.bkb || {};
  function bikeBasket() { if (BKB.g) return BKB.g; var B = new RB(), x0 = 0.17, y0 = 0.82, y1 = 1.04, z0 = 0.3, z1 = 0.62; B.box(23, x0 * 2, 0.012, z1 - z0, 0, y0, (z0 + z1) / 2); for (var k = 0; k <= 8; k++) { var tz = z0 + k * (z1 - z0) / 8; [-x0, x0].forEach(function (sx) { B.tube(23, V3(sx, y0, tz), V3(sx, y1, tz), 0.006, 4); }); } for (var j = 0; j <= 6; j++) { var tx = -x0 + j * x0 / 3; B.tube(23, V3(tx, y0, z0), V3(tx, y1, z0), 0.006, 4); B.tube(23, V3(tx, y0, z1), V3(tx, y1, z1), 0.006, 4); } [y0 + 0.07, y0 + 0.14, y1].forEach(function (ty) { B.path(23, [V3(-x0, ty, z0), V3(-x0, ty, z1), V3(x0, ty, z1), V3(x0, ty, z0), V3(-x0, ty, z0)], 0.008, 4); }); B.tube(14, V3(0, y0, z0), V3(0, 1.08, 0.22), 0.01, 6); BKB.g = B.merge(); return BKB.g; }

  // ───────────────────────── dressing: a cart or bike group takes a look (and gives it back) ─────────────────────────
  // A cart group is the client's makeModel("cart") (the avatar's personal cart, a shared cart, a parked cart, a show cart): its one
  // mesh gets the segmented geometry (the full range, or the range without the stock wheels) and the look's material; wheels,
  // accessories and the underglow are child meshes of the same group sharing that material. Undress puts the model's own back.
  function shareMark(o) { if (o && o.userData) { o.userData.avShared = true; o.userData.bsShared = true; } return o; }
  function baseMeshOf(g) { var u = g.userData; if (u.bsBase && u.bsBase.parent === g) return u.bsBase; var m = MODELS.cart, src = m && m.parts && m.parts[0], best = null; for (var i = 0; i < g.children.length; i++) { var c = g.children[i]; if (!c.isMesh) continue; if (src && (c.geometry === src.geometry || c.userData.bsBaseMesh)) { best = c; break; } if (!best && !c.isSprite && c.geometry && c.geometry.attributes.position.count > 20000) best = c; } if (best) { u.bsBase = best; best.userData.bsBaseMesh = true; best.userData.bsGeo0 = best.userData.bsGeo0 || best.geometry; best.userData.bsMat0 = best.userData.bsMat0 || best.material; } return best; }
  function childMesh(g, slot, geo, mat) { var u = g.userData, me = u[slot]; if (!geo) { if (me) { g.remove(me); u[slot] = null; } return null; } if (!me) { me = new THREE.Mesh(geo, mat); me.name = "bs " + slot; var b = u.bsBase; if (b) { me.layers.mask = b.layers.mask; me.castShadow = b.castShadow; me.receiveShadow = b.receiveShadow; } me.userData.shSet = true; me.userData.bsPart = true; g.add(me); u[slot] = me; } else { me.geometry = geo; me.material = mat; } return me; }
  function hideDecals(g, owner) { var u = owner && owner.userData; if (!u || !u.decals) return; for (var i = 0; i < u.decals.length; i++) { var d = u.decals[i]; if (d.parent === g) d.visible = !g.userData.bsKey; } }
  function dressCart(g, look, owner) {
    if (!g) return false; var u = g.userData; look = cleanLook(look, CART_KEYS, true); var key = look ? lookKey(look) : "";
    if (u.bsKey === key && (u.bsPend === undefined || u.bsPend === null)) return true;
    if (!look) { undressCart(g, owner); return true; }
    var G = GEO.cart; if (!G) { segStart("cart"); u.bsPend = look; return false; } u.bsPend = null;
    var base = baseMeshOf(g); if (!base) return false; var mat = matFor("cart", look); if (!mat) return false; var custom = !!(look.w || look.ty === 3 || look.ty === 4);
    var old = u.bsMat; base.geometry = custom ? G.body : G.full; base.material = mat; u.bsMat = mat; if (old && old !== mat) matRelease(old);
    childMesh(g, "bsWheels", custom ? wheelGeo(look) : null, mat); childMesh(g, "bsAcc", accGeo(look), mat); childMesh(g, "bsGlow", (look.a || 0) & 2 ? glowGeo() : null, glowMat(look.u || 0));
    u.bsKey = key; u.bsLook = look; u.bsLift = look.l === 1 ? 0.15 : look.l === 2 ? -0.045 : 0; u.cartColor = -1; hideDecals(g, owner); BS.n.dress++; return true; }
  function undressCart(g, owner) { var u = g.userData; if (!u.bsKey && !u.bsMat) { u.bsPend = null; return; } var base = baseMeshOf(g); if (base) { base.geometry = base.userData.bsGeo0 || base.geometry; base.material = base.userData.bsMat0 || base.material; } if (u.bsMat) matRelease(u.bsMat); u.bsMat = null; ["bsWheels", "bsAcc", "bsGlow"].forEach(function (s) { childMesh(g, s, null); }); u.bsKey = ""; u.bsLook = null; u.bsLift = 0; u.bsPend = null; u.cartColor = undefined; hideDecals(g, owner);
    try { if (owner && owner.userData && owner.userData.cartG === g && view && view.players) { var id = owner === player ? ME : owner.userData.id, p = view.players[id]; if (p) origApplyCartLook(owner, p.look); } } catch (e) {} }
  // a bike group: the client's makeBikeModel output (body + crank); a custom look swaps in the segmented halves and a material
  function dressBike(g, look) {
    if (!g) return false; var u = g.userData; look = cleanLook(look, BIKE_KEYS, false); var key = look ? lookKey(look) : "";
    if (u.bsKey === key && !u.bsPend) return true;
    if (!look) { if (u.bsKey) { (u.bsMeshes || []).forEach(function (m) { m.geometry = m.userData.bsGeo0; m.material = m.userData.bsMat0; }); childMesh(g, "bsAcc", null); if (u.bsMat) matRelease(u.bsMat); u.bsMat = null; } u.bsKey = ""; return true; }
    var G = GEO.bike2; if (!G) { segStart("bike2"); u.bsPend = look; return false; } u.bsPend = null;
    if (u.model !== "bike2") return false;
    var mat = matFor("bike", look); if (!mat) return false; var ms = u.bsMeshes; if (!ms) { ms = []; for (var i = 0; i < g.children.length; i++) { var c = g.children[i]; if (c.isMesh && !c.userData.bsPart) { c.userData.bsGeo0 = c.geometry; c.userData.bsMat0 = c.material; ms.push(c); } } u.bsMeshes = ms; }
    var body = ms.filter(function (m) { return m !== u.crank; })[0]; if (body) { body.geometry = G.crank ? G.crank.body : G.full; body.material = mat; } if (u.crank && G.crank) { u.crank.geometry = G.crank.crank; u.crank.material = mat; }
    var old = u.bsMat; u.bsMat = mat; if (old && old !== mat) matRelease(old); childMesh(g, "bsAcc", look.b ? bikeBasket() : null, mat); var bb = u.bsAcc; if (bb && ms[0]) { bb.layers.mask = ms[0].layers.mask; bb.castShadow = true; }
    u.bsKey = key; u.bsLook = look; BS.n.dress++; return true; }

  // ───────────────────────── who wears what: every avatar's personal cart and bike, shared carts by their driver, parked carts by their sitter ─────────────────────────
  var SY = BS.sy = BS.sy || { at: 0, veh: {}, park: [] };
  function lookOf(id) { try { if (id === ME && PV.on) return PV.cart; var p = view && view.players && view.players[id]; return p ? p.cl || null : null; } catch (e) { return null; } }
  function bikeOf(id) { try { if (id === ME && PV.on) return PV.bike; var p = view && view.players && view.players[id]; return p ? p.bl || null : null; } catch (e) { return null; } }
  function syncFrame() {
    if (!view || !view.players || typeof player === "undefined" || !player) return; if (!GEO.cart) { segStart("cart"); return; }
    var t = nowMs(), full = t - SY.at > 400; if (full) SY.at = t;
    // avatars (player included): the personal cart and bike
    var each = function (g, id) { var u = g.userData; if (!u || !u.cartG) return; var cl = lookOf(id); if (cl !== u.bsCl || u.cartG.userData.bsPend) { u.bsCl = cl; dressCart(u.cartG, cl, g); }
      if (u.bikeG) { var bl = bikeOf(id); if (bl !== u.bsBl || u.bikeG !== u.bsBikeG || u.bikeG.userData.bsPend) { u.bsBl = bl; u.bsBikeG = u.bikeG; if (bl && u.bikeG.userData.model !== "bike2" && u.rideKind && u.rideKind !== "cart") { /* the custom bike is the Wide Ride */ try { var wasV = u.bikeG.visible; g.remove(u.bikeG); var nb = makeBikeModel(1); nb.traverse(function (q) { if (q.isMesh) q.castShadow = true; q.layers.mask = g.layers.mask; }); g.add(nb); u.bikeG = nb; u.bsBikeG = nb; nb.visible = wasV; } catch (e) { note("bike swap", e); } } dressBike(u.bikeG, bl); } }
      var lift = u.cartG.userData.bsLift || 0; if (u.bsRideLift === undefined || u.bsRideLift === null) u.bsSeatLift = lift; };
    each(player, ME); if (typeof avatars !== "undefined") avatars.forEach(function (a, id) { if (a && a.g) each(a.g, id); });
    if (!full) return;
    // shared carts take their driver's look
    if (typeof VEH !== "undefined" && view.vehicles) for (var vid in VEH) { var V = VEH[vid], v = view.vehicles[vid]; if (!V || !v || V.kind !== "cart") continue; var drv = v.driver && view.players[v.driver] && view.players[v.driver].veh === vid ? v.driver : null; var cl = drv ? lookOf(drv) : null; if (SY.veh[vid] !== cl || V.g.userData.bsPend) { SY.veh[vid] = cl; dressCart(V.g, cl, null); }
      var lift = V.g.userData.bsLift || 0; [v.driver].concat(v.riders || []).forEach(function (pid) { if (!pid) return; var a = pid === ME ? player : (avatars.get(pid) || {}).g; if (a && view.players[pid] && view.players[pid].veh === vid) { a.userData.bsRideLift = lift; a.userData.bsSeatLift = lift; } }); }
    // riders in someone's personal cart sit at that cart's height; everyone else at their own
    var seatOf = function (g, p) { var u = g.userData; if (p && p.pose && p.pose.indexOf("ride:") === 0) { var did = p.pose.slice(5), dg = did === ME ? player : (avatars.get(did) || {}).g; u.bsRideLift = dg && dg.userData.cartG ? dg.userData.cartG.userData.bsLift || 0 : 0; u.bsSeatLift = u.bsRideLift; } else if (!p || !p.veh) { u.bsRideLift = null; } };
    seatOf(player, view.players[ME]); avatars.forEach(function (a, id) { if (a && a.g) seatOf(a.g, view.players[id]); });
    // parked carts (the Star Cinema lot): whoever sits in one
    var P = (typeof SITES !== "undefined" && SITES.parked) || []; if (P.length) { var want = new Map(); var mine = SITES.park ? SITES.park : null; if (mine) want.set(mine, lookOf(ME));
      for (var id in view.players) { if (id === ME) continue; var p = view.players[id]; if (!p || p.pose !== "park" || !p.cl) continue; var best = null, bd = 2.6; for (var i = 0; i < P.length; i++) { var d = Math.hypot(P[i].position.x - p.x, P[i].position.z - p.z); if (d < bd) { bd = d; best = P[i]; } } if (best && !want.has(best)) want.set(best, p.cl); }
      for (var j = 0; j < P.length; j++) { var c = P[j], wl = want.get(c) || null; if (c.userData.bsCl !== wl || c.userData.bsPend) { c.userData.bsCl = wl; dressCart(c, wl, null); } } }
  }

  // ───────────────────────── client overrides (by bare name, at run time) ─────────────────────────
  var origApplyCartLook = function () {};
  var OV = BS.ov = BS.ov || { done: false };
  function installOverrides() {
    if (OV.done) return; OV.done = true;
    try { var acl = applyCartLook; origApplyCartLook = acl; applyCartLook = function (g, look) { var cg = g && g.userData && g.userData.cartG; if (cg && (cg.userData.bsKey || cg.userData.bsPend)) return; return acl.apply(this, arguments); }; OV.applyCartLook = true; } catch (e) { note("ov applyCartLook", e); }
    try { var csl = cartSeatLocal; cartSeatLocal = function (g, i, out) { var r = csl.apply(this, arguments); var l = g && g.userData ? g.userData.bsSeatLift : 0; if (l && r) r.y += l; return r; }; OV.cartSeatLocal = true; } catch (e) { note("ov cartSeatLocal", e); }
    try { var urd = updateRideDecals; updateRideDecals = function (g) { var r = urd.apply(this, arguments); try { var u = g.userData; if (u.cartG) hideDecals(u.cartG, g); } catch (e) {} return r; }; OV.updateRideDecals = true; } catch (e) { note("ov updateRideDecals", e); }
    try { var scv = setCartVisual; setCartVisual = function (g, on, kind) { var r = scv.apply(this, arguments); try { var u = g.userData; if (u.bikeG && u.bikeG !== u.bsBikeG) { u.bsBl = undefined; } } catch (e) {} return r; }; OV.setCartVisual = true; } catch (e) { note("ov setCartVisual", e); }
    try { var se = showEmote; showEmote = function (g, p) { var h = p && p.emote === "horn" && p.cl && p.cl.h ? p.cl.h : 0; HORN.next = h ? { h: h, g: g } : null; try { return se.apply(this, arguments); } finally { HORN.next = null; } }; OV.showEmote = true; } catch (e) { note("ov showEmote", e); }
    try { var pa = playAt; playAt = function (name, x, z) { if (name === "horn" && HORN.next) { hornPlay(HORN.next.h, x, z); HORN.next = null; return; } return pa.apply(this, arguments); }; OV.playAt = true; } catch (e) { note("ov playAt", e); }
    try { var on = openNearest; openNearest = function () { try { if (handleE()) return; } catch (e) { note("E", e); } return on.apply(this, arguments); }; OV.openNearest = true; } catch (e) { note("ov openNearest", e); }
  }
  // ── horns: a few synthesised sounds (no files), heard by everyone near the driver ──
  var HORN = BS.horn = BS.horn || { next: null };
  function hornPlay(h, x, z) {
    try { if (typeof soundOn !== "undefined" && !soundOn) return; var d = player ? Math.hypot(x - player.position.x, z - player.position.z) : 0; if (d > 140) return; var c = actx(), k = Math.max(0, 1 - d / 140) * VOL.sfx * 2.2 * VOL.master * 0.5, t0 = c.currentTime;
      var voice = function (f, at, dur, type, vol, f1) { var o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t0 + at); if (f1) o.frequency.linearRampToValueAtTime(f1, t0 + at + dur); g.gain.setValueAtTime(0.0001, t0 + at); g.gain.linearRampToValueAtTime(vol * k, t0 + at + 0.02); g.gain.setValueAtTime(vol * k, t0 + at + dur - 0.04); g.gain.linearRampToValueAtTime(0.0001, t0 + at + dur); o.connect(g).connect(c.destination); o.start(t0 + at); o.stop(t0 + at + dur + 0.02); };
      if (h === 1) { voice(180, 0, 0.32, "sawtooth", 0.16, 420); voice(420, 0.34, 0.42, "sawtooth", 0.16, 160); }
      else if (h === 2) { [233, 277, 349].forEach(function (f) { voice(f, 0, 0.9, "sawtooth", 0.09); }); }
      else if (h === 3) { voice(523, 0, 0.18, "square", 0.07); voice(659, 0.2, 0.18, "square", 0.07); voice(784, 0.4, 0.34, "square", 0.07); }
      else if (h === 4) { voice(1250, 0, 0.09, "square", 0.06, 1500); voice(1250, 0.14, 0.09, "square", 0.06, 1500); }
    } catch (e) { note("horn", e); } }

  // ───────────────────────── the site: a 54 x 36 m shop on a graded pad between the drag strip and the Fingers Lap trail ─────────────────────────
  // Local frame: u east, v south from the building centre (cx, cz), y up from the pad G. The front (north, v -18) faces the Motor Yard,
  // the Paddock and the Cart Course; the forecourt runs north of it. The roof is a barrel vault across the width (eaves 8 m, crown 13 m).
  var SITE = BS.site = BS.site || null;
  function resolveSite() { if (SITE) return SITE; var c = cfg(); if (!c) return null; var s = c.site || {};
    var S = { cx: s.cx || -376, cz: s.cz || 422, W: s.w || 54, D: s.d || 36, eave: 8.0, crown: 13.0, G: s.pad || 11.4, fc: s.forecourt || [-404, 374, -357, 404], hub: s.hub || [-380, 386], door: [12.5, 7.0], rev: s.reveal || [0, -6.5], show: s.showroom || [-19.5, -10.5] };
    S.hw = S.W / 2; S.hd = S.D / 2; S.wallT = 0.5; S.glass = [[-25.2, -8.6], [8.6, 25.2]]; S.glassY = [0.45, 5.9];
    S.bays = [[-23.0, 11], [-15.5, 11], [-8.0, 11]]; S.booth = [1.0, 5.4, 13.0, 16.8]; S.wrap = [15.4, 5.4, 26.2, 16.8]; S.lounge = [11.5, -16.5, 25.5, -4.5]; S.merch = [19.5, -2.8];
    return (SITE = BS.site = S); }
  function l2w(u, v) { return [SITE.cx + u, SITE.cz + v]; }
  function w2l(x, z) { return [x - SITE.cx, z - SITE.cz]; }
  function roofH(u) { var S = SITE, k = u / S.hw; return S.eave + (S.crown - S.eave) * Math.max(0, 1 - k * k); }
  function inBldg(x, z, m) { var q = w2l(x, z); m = m || 0; return Math.abs(q[0]) < SITE.hw + m && Math.abs(q[1]) < SITE.hd + m; }
  function inFore(x, z, m) { var f = SITE.fc; m = m || 0; return x > f[0] - m && x < f[2] + m && z > f[1] - m && z < f[3] + m; }
  function inLot(x, z, m) { return inBldg(x, z, m) || inFore(x, z, m); }
  function lotDist(x, z) { var S = SITE, q = w2l(x, z), dx = Math.max(Math.abs(q[0]) - S.hw, 0), dz = Math.max(Math.abs(q[1]) - S.hd, 0), db = Math.hypot(dx, dz); var f = S.fc, fx = Math.max(f[0] - x, 0, x - f[2]), fz = Math.max(f[1] - z, 0, z - f[3]); return Math.min(db, Math.hypot(fx, fz)); }
  // inside the walls (the camera, the people, the zone)
  function inShop(x, y, z) { var S = SITE, q = w2l(x, z), h = y - S.G; return Math.abs(q[0]) < S.hw - S.wallT && Math.abs(q[1]) < S.hd - S.wallT && h > -1 && h < roofH(q[0]) - 0.6; }
  var VEG = /^(bush\d|mesquite|ocotillo|saguaro.*|paloverde|ironwood|desertwillow|barrel_cactus|prickly_pear|cholla|organ_pipe|agave_cluster|yucca_cluster|boulder|lamp|ph_(rock|boulder|shrub|succulent|stones|sandrocks)_?\d*|e1_.*|lux_lamp)$/;
  function clearLot() { var removed = 0, keys = new Set();
    for (var k in PLACE) { if (!VEG.test(k)) continue; var L = PLACE[k], out = []; for (var i = 0; i < L.length; i++) { var e = L[i]; if (!e.bs && inLot(e[0], e[2], 2)) { keys.add(Math.round(e[0] * 100) + ":" + Math.round(e[2] * 100)); removed++; } else out.push(e); } if (out.length !== L.length) { L.length = 0; Array.prototype.push.apply(L, out); } }
    if (keys.size) for (var j = COLLIDERS.length - 1; j >= 0; j--) { var c = COLLIDERS[j]; if (keys.has(Math.round(c[0] * 100) + ":" + Math.round(c[1] * 100))) COLLIDERS.splice(j, 1); }
    BS.n.cleared = (BS.n.cleared || 0) + removed; }
  // ───────── terrain hook: one level pad under the shop and the forecourt, blended out over 12 m ─────────
  function gridH(x, z) { try { return sampleGrid(H, T, x, z); } catch (e) { return getH(x, z); } }
  function terrainHook() {
    if (BS.off || !window.PLAN) return; var S = resolveSite(); if (!S) return; var t0 = nowMs();
    try { if (typeof H !== "undefined" && H && T) { var cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1), blend = 12, cnt = 0;
        var x0 = Math.min(S.cx - S.hw, S.fc[0]) - blend - 2, x1 = Math.max(S.cx + S.hw, S.fc[2]) + blend + 2, z0 = Math.min(S.cz - S.hd, S.fc[1]) - blend - 2, z1 = S.cz + S.hd + blend + 2;
        for (var r = Math.max(0, Math.floor((z0 - T.zmin) / ch)); r <= Math.min(T.rows - 1, Math.ceil((z1 - T.zmin) / ch)); r++) for (var c = Math.max(0, Math.floor((x0 - T.xmin) / cw)); c <= Math.min(T.cols - 1, Math.ceil((x1 - T.xmin) / cw)); c++) {
          var x = T.xmin + c * cw, z = T.zmin + r * ch, d = lotDist(x, z) - 1.0; if (d >= blend) continue; var k = d <= 0 ? 1 : 1 - sstep(0, blend, d), vi = r * T.cols + c; H[vi] = H[vi] + (S.G - H[vi]) * k; cnt++; }
        BS.n.graded = cnt; } } catch (e) { note("grade", e); }
    try { var Rr = 0; for (var kk in PLACE) { var Lk = PLACE[kk]; for (var i = 0; i < Lk.length; i++) { var e = Lk[i]; if (lotDist(e[0], e[2]) > 14) continue; var g = getH(e[0], e[2]); if (Math.abs(g - e[1]) > 0.02 && Math.abs(g - e[1]) < 6) { e[1] = g; Rr++; } } } BS.n.reseated = Rr; } catch (e) { note("reseat", e); }
    try { plantLot(S); } catch (e) { note("plant", e); }
    BS.n.terrainMs = Math.round(nowMs() - t0); }
  // desert planting round the forecourt edge and the building's foot: saguaros, agave, yucca, barrel cactus, ocotillo (existing kinds)
  function plantLot(S) { var R = rng(1313), n = 0, put1 = function (k, x, z, sc) { if (!canPut(k)) return; put(k, x, z, R() * TAU, sc); var L = PLACE[k]; if (L && L.length) L[L.length - 1].bs = 1; n++; };
    var f = S.fc; [[f[0] + 1.5, f[1] + 1.5, "saguaro", 1.0], [f[0] + 1.6, f[3] - 3.5, "saguaro_mid", 0.95], [f[2] - 1.5, f[1] + 1.8, "saguaro", 1.1], [f[2] + 2.5, f[3] - 6, "saguaro_young", 1.0], [S.cx - S.hw - 2.6, S.cz - 8, "saguaro", 0.9], [S.cx + S.hw + 2.4, S.cz + 6, "saguaro_mid", 1.0], [S.cx + S.hw + 2.4, S.cz - 12, "saguaro", 0.9]].forEach(function (q) { put1(q[2], q[0], q[1], q[3]); });
    var low = ["agave_cluster", "yucca_cluster", "barrel_cactus", "bush2", "ph_succulent_1"].filter(canPut);
    for (var i = 0; i < 26; i++) { var t = i / 26, x, z; if (i % 2) { x = f[0] + 0.8 + R() * 1.4; z = lerp(f[1] + 4, f[3] - 2, t); } else { x = f[2] - 0.6 - R() * 1.4; z = lerp(f[1] + 4, f[3] - 6, t); } put1(low[i % low.length], x, z, 0.7 + R() * 0.5); }
    for (var j = 0; j < 14; j++) { var side = j % 2 ? -1 : 1, xx = S.cx + side * (S.hw + 1.3 + R() * 1.6), zz = S.cz - S.hd + 2 + R() * (S.D - 4); put1(low[(j + 2) % low.length], xx, zz, 0.7 + R() * 0.4); }
    BS.n.planted = n; }
  // ───────── world hook: clearing, keep-outs, the hub, the zone, info points, staff spots ─────────
  function worldHook() {
    if (BS.off || !window.PLAN) return; var S = resolveSite(); if (!S) { note("site", "no plan/bodyshop.json"); return; } var t0 = nowMs();
    try { clearLot(); } catch (e) { note("clear", e); }
    try { for (var u = -S.hw; u <= S.hw; u += 9) for (var v = -S.hd; v <= S.hd; v += 9) { var w = l2w(u, v); KEEPOUT.push([w[0], w[1], 8]); } var f = S.fc; for (var x = f[0]; x <= f[2]; x += 8) for (var z = f[1]; z <= f[3]; z += 8) KEEPOUT.push([x, z, 6]); } catch (e) { note("keepouts", e); }
    try { planAddHub(C("names.shop", "Copper Canyon Customs"), S.hub[0], S.hub[1]); planNavCats(); } catch (e) { note("hub", e); }
    try { var bx0 = S.cx - S.hw - 1.5, bx1 = S.cx + S.hw + 1.5, bz0 = S.cz - S.hd, bz1 = S.cz + S.hd + 1.5, f0 = S.fc; var poly = [[f0[0] - 1, f0[1] - 1], [f0[2] + 1, f0[1] - 1], [f0[2] + 1, bz0], [bx1, bz0], [bx1, bz1], [bx0, bz1], [bx0, bz0], [f0[0] - 1, bz0]]; S.outline = poly; zoneRings.push({ name: C("names.shop", "Copper Canyon Customs"), label: C("names.short", "Copper Canyon Customs"), center: [S.cx, S.cz - 8], r: 46, k: C("info.forecourt.k", ""), poly: poly, col: "#e0642a55", plan: "bodyshop" }); } catch (e) { note("zone", e); }
    try { var hs = function (key, u, v, r) { var d = C("info." + key, null); if (!d) return null; var w = l2w(u, v); var h = { x: w[0], z: w[1], r: r, t: d.t, k: d.k, p: d.p, bs: key }; hotspots.push(h); (BS.hsList = BS.hsList || []).push(h); return h; };
      hs("forecourt", -4.5, -S.hd - 9, 6); hs("bays", -15.5, 3.5, 4.5); hs("booth", 7, 3.5, 3.5); hs("wrap", 20.5, 3.5, 3.5); hs("wheels", -24.5, -7, 3.5); hs("parts", 24.0, -12, 3.0); hs("showroom", S.show[0] + 3.6, S.show[1] + 3.4, 3.0); hs("lounge", 14.5, -8.5, 3.0); } catch (e) { note("hotspots", e); }
    installOverrides(); BS.n.worldMs = Math.round(nowMs() - t0); }

  // ───────────────────────── materials: a few shared bases with stable programs (vertex colours tint every piece) ─────────────────────────
  var MX = BS.mx = BS.mx || null;
  function canvasTex(w, h, draw, srgb) { var cv = document.createElement("canvas"); cv.width = w; cv.height = h; var x = cv.getContext("2d"); draw(x, w, h); var t = new THREE.CanvasTexture(cv); if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.userData.bsShared = true; t.userData.avShared = true; return t; }
  var FONT = { d: "Anton, Impact, sans-serif", s: "'Space Grotesk', system-ui, sans-serif", m: "'JetBrains Mono', ui-monospace, monospace" };
  function mats() {
    if (MX) return MX; var lt = lowTier(); var sh = function (m) { m.userData.avShared = true; m.userData.bsShared = true; return m; };
    var sand = texL(lt ? "/tex/conv_sandstone_m.jpg" : "/tex/conv_sandstone.jpg", true), sandN = texL(lt ? "/tex/conv_sandstone_n_m.jpg" : "/tex/conv_sandstone_n.jpg", false);
    var cor = texL("/tex/corrugated.jpg", true), corN = texL("/tex/corrugated_n.jpg", false), conc = texL(tname("bs_concrete"), true);
    var wood = texL("/tex/wood.jpg", true);
    MX = BS.mx = {
      earth: sh(std({ map: sand, normalMap: sandN, normalScale: new THREE.Vector2(0.8, 0.8), color: 0xffffff, roughness: 0.93, metalness: 0, vertexColors: true })),
      corr: sh(std({ map: cor, normalMap: corN, normalScale: new THREE.Vector2(1, 1), color: 0xffffff, roughness: 0.48, metalness: 0.55, vertexColors: true })),
      steel: sh(std({ color: 0xffffff, roughness: 0.45, metalness: 0.62, vertexColors: true })),
      chrome: sh(std({ color: 0xffffff, roughness: 0.1, metalness: 1.0, vertexColors: true })),
      paint: sh(std({ color: 0xffffff, roughness: 0.42, metalness: 0.12, vertexColors: true })),
      rubber: sh(std({ color: 0xffffff, roughness: 0.92, metalness: 0, vertexColors: true })),
      fabric: sh(std({ color: 0xffffff, roughness: 0.96, metalness: 0, vertexColors: true })),
      wood: sh(std({ map: wood, color: 0xffffff, roughness: 0.72, metalness: 0, vertexColors: true })),
      floor: sh(std({ map: conc, color: 0xffffff, roughness: 0.22, metalness: 0.0, vertexColors: true, envMapIntensity: 0.4 })),
      apron: sh(std({ map: conc, color: 0xffffff, roughness: 0.78, metalness: 0.0, vertexColors: true })),
      glass: sh(std({ color: 0x9fb4bc, roughness: 0.04, metalness: 0.3, transparent: true, opacity: 0.26, depthWrite: false, envMapIntensity: 1.2, vertexColors: true })),
      glow: sh(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })),
      add: sh(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })),
      neon: sh(new THREE.MeshBasicMaterial({ map: texL(tname("bs_neon"), true, false), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })),
      muralA: sh(std({ map: texL(tname("bs_mural_a"), true, false), roughness: 0.85, metalness: 0, vertexColors: true })),
      muralB: sh(std({ map: texL(tname("bs_mural_b"), true, false), roughness: 0.85, metalness: 0, vertexColors: true })),
      chest: sh(std({ map: texL(tname("bs_toolchest"), true, false), roughness: 0.32, metalness: 0.3, vertexColors: true })),
      signs: null, pool: null
    };
    // canvas sign sheet (1024 x 1024): side lettering, the monument, bay numbers, the wall neons, the merch board, the build placard
    var sgn = canvasTex(1024, 1024, drawSigns); MX.signs = sh(std({ map: sgn, roughness: 0.6, metalness: 0.1, vertexColors: true })); MX.signGlow = sh(new THREE.MeshBasicMaterial({ map: sgn, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    // a soft round pool (light on the floor, glows, the overspray)
    var pt = canvasTex(128, 128, function (x, w, h) { var g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,0.5)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
    MX.pool = sh(new THREE.MeshBasicMaterial({ map: pt, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    // the turntable top: brushed dark metal with radial lines and the shop ring
    var tt = canvasTex(512, 512, function (x, w, h) { x.fillStyle = "#26282b"; x.fillRect(0, 0, w, h); for (var i = 0; i < 180; i++) { var a = i / 180 * TAU; x.strokeStyle = i % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.18)"; x.lineWidth = 2; x.beginPath(); x.moveTo(256, 256); x.lineTo(256 + Math.cos(a) * 256, 256 + Math.sin(a) * 256); x.stroke(); } [250, 236, 120, 60].forEach(function (r, j) { x.strokeStyle = j < 2 ? "#b8643a" : "rgba(255,255,255,0.12)"; x.lineWidth = j < 2 ? 5 : 3; x.beginPath(); x.arc(256, 256, r, 0, TAU); x.stroke(); }); x.fillStyle = "#b8643a"; x.font = "400 30px " + FONT.d; x.textAlign = "center"; x.fillText("COPPER CANYON CUSTOMS", 256, 196); x.save(); x.translate(256, 256); x.rotate(PI); x.fillText("THE REVEAL BAY", 0, -60); x.restore(); });
    MX.turn = sh(std({ map: tt, roughness: 0.3, metalness: 0.7, vertexColors: true }));
    ["earth", "corr", "steel", "chrome", "paint", "rubber", "fabric", "wood", "floor", "glass", "muralA", "muralB", "chest", "signs", "turn"].forEach(function (k) { if (MX[k]) MX[k].onBeforeCompile = indoorObc; });
    return MX; }
  // the sign sheet: rows of 1024 x 128 (8 rows): 0 side lettering, 1 services line, 2 monument, 3 "NO JOB TOO WILD", 4 bay numbers, 5 PAINT / WRAP / WHEELS / PARTS, 6 merch, 7 build of the week
  function drawSigns(x, W, H) {
    var row = function (i, bg, fg, text, font, sub) { var y = i * 128; x.fillStyle = bg; x.fillRect(0, y, W, 128); x.fillStyle = fg; x.textAlign = "center"; x.textBaseline = "middle"; x.font = font; x.fillText(text, W / 2, y + (sub ? 50 : 66), W - 40); if (sub) { x.font = "600 26px " + FONT.m; x.fillText(sub, W / 2, y + 102, W - 40); } x.textBaseline = "alphabetic"; };
    row(0, "#1b1d20", "#d8874e", "COPPER CANYON CUSTOMS", "400 92px " + FONT.d);
    row(1, "#1b1d20", "#e9e2d3", "CUSTOM CARTS  ·  BIKES  ·  PAINT  ·  WRAPS", "400 64px " + FONT.d);
    row(2, "#3b2a1e", "#e7a36a", "COPPER CANYON CUSTOMS", "400 86px " + FONT.d, "MOTOR YARD  ·  SOLPORT  ·  GENESIS");
    row(3, "#000000", "#ff5aa5", "NO JOB TOO WILD", "400 96px " + FONT.d);
    var y4 = 4 * 128; x.fillStyle = "#000"; x.fillRect(0, y4, W, 128); x.font = "400 104px " + FONT.d; x.textAlign = "center"; x.textBaseline = "middle"; ["BAY 1", "BAY 2", "BAY 3"].forEach(function (t, i) { x.fillStyle = ["#2ae0e0", "#f4cd5a", "#ff8a2a"][i]; x.fillText(t, (i + 0.5) * W / 3, y4 + 66); });
    var y5 = 5 * 128; x.fillStyle = "#000"; x.fillRect(0, y5, W, 128); x.font = "400 80px " + FONT.d; ["PAINT", "WRAP", "WHEELS", "PARTS"].forEach(function (t, i) { x.fillStyle = ["#ff5aa5", "#9be33c", "#2ae0e0", "#f4cd5a"][i]; x.fillText(t, (i + 0.5) * W / 4, y5 + 66); });
    row(6, "#000000", "#4dde6f", "MERCH  ·  GIVEBACK  ·  SHOP", "400 84px " + FONT.d);
    row(7, "#f4efe2", "#16223f", "BUILD OF THE WEEK", "400 78px " + FONT.d, "EVERY PART ON IT IS IN THE CUSTOMIZER");
    x.textBaseline = "alphabetic"; }
  function signUV(row, a, b) { var v0 = 1 - (row + 1) / 8, v1 = 1 - row / 8; return [a === undefined ? 0 : a, v0, b === undefined ? 1 : b, v1]; }

  // ───────────────────────── the exterior: rammed earth, corrugated steel, the barrel roof, the glass front, the door, the sign, the forecourt ─────────────────────────
  var EX = BS.ex = BS.ex || {};
  function buildExterior() {
    var S = SITE, M = mats(), K = new Kit(), sol = [], R = rng(77), hw = S.hw, hd = S.hd, T = S.wallT;
    var earthT = 2.6, eTint = function () { var k = 0.92 + R() * 0.1; return [0.93 * k, 0.8 * k, 0.66 * k]; };
    // rammed earth: the long walls, the back, the front piers and the base course (in layers, each lift a little different)
    var earthWall = function (x0, x1, z0, z1, y0, y1) { var lifts = Math.max(1, Math.round((y1 - y0) / 0.9)); for (var i = 0; i < lifts; i++) { var a = y0 + (y1 - y0) * i / lifts, b = y0 + (y1 - y0) * (i + 1) / lifts; K.box("earth", eTint(), x1 - x0, b - a, z1 - z0, (x0 + x1) / 2, (a + b) / 2, (z0 + z1) / 2, 0, earthT); } };
    earthWall(-hw, hw, hd - T, hd, 0, 3.6); earthWall(-hw, -hw + T, -hd, hd, 0, 3.6); earthWall(hw - T, hw, -hd, hd, 0, 3.6);
    [[-hw, -25.2], [-8.6, -6.6], [6.6, 8.6], [25.2, hw]].forEach(function (q) { earthWall(q[0], q[1], -hd, -hd + T + 0.1, 0, 7.6); });
    [[-25.2, -8.6], [8.6, 25.2]].forEach(function (q) { earthWall(q[0], q[1], -hd, -hd + T, 0, 0.45); });
    // corrugated upper walls: strips so the gables follow the vault; a few weathered copper panels
    var corrStrip = function (u0, u1, vv, y0, y1, face) { var c = R() < 0.18 ? [0.86, 0.58, 0.42] : (R() < 0.5 ? [0.8, 0.83, 0.86] : [0.7, 0.73, 0.76]); var g = new THREE.PlaneGeometry(u1 - u0, y1 - y0); var U = g.attributes.uv; for (var i = 0; i < U.count; i++) U.setXY(i, U.getX(i) * (u1 - u0) / 1.6, U.getY(i) * (y1 - y0) / 1.6); K.place("corr", g, c, (u0 + u1) / 2, (y0 + y1) / 2, vv, face); };
    for (var u = -hw; u < hw - 0.01; u += 1.5) { var u1 = Math.min(hw, u + 1.5), top = roofH((u + u1) / 2);
      corrStrip(u, u1, hd + 0.01, 3.6, top, 0); var bot = Math.abs((u + u1) / 2) < 6.6 ? 7.6 : ((u + u1) / 2 > -25.2 && (u + u1) / 2 < -8.6) || ((u + u1) / 2 > 8.6 && (u + u1) / 2 < 25.2) ? 5.9 : 7.6; corrStrip(u, u1, -hd - 0.01, bot, top, PI); }
    var sideStrip = function (v, v1, sd, y0, y1, inner) { var c = inner ? [0.42, 0.44, 0.47] : (R() < 0.15 ? [0.86, 0.58, 0.42] : (R() < 0.5 ? [0.8, 0.83, 0.86] : [0.7, 0.73, 0.76])); var g = new THREE.PlaneGeometry(v1 - v, y1 - y0); var U = g.attributes.uv; for (var i = 0; i < U.count; i++) U.setXY(i, U.getX(i) * (v1 - v) / 1.6, U.getY(i) * (y1 - y0) / 1.6); K.place("corr", g, c, sd * (inner ? hw - T - 0.01 : hw + 0.01), (y0 + y1) / 2, (v + v1) / 2, (inner ? -sd : sd) * PI / 2); };
    for (var v = -hd; v < hd - 0.01; v += 1.5) { var v1 = Math.min(hd, v + 1.5); [-1, 1].forEach(function (sd) { var cl = v > -hd + 1.9 && v1 < hd - 1.9; if (cl) { sideStrip(v, v1, sd, 3.6, 6.15); sideStrip(v, v1, sd, 7.35, S.eave); sideStrip(v, v1, sd, 3.6, 6.15, true); sideStrip(v, v1, sd, 7.35, S.eave, true); } else { sideStrip(v, v1, sd, 3.6, S.eave); sideStrip(v, v1, sd, 3.6, S.eave, true); } }); }
    // inside faces of the gables (dark, the room's walls above the rammed earth) and the vault's underside
    for (var ui = -hw + T; ui < hw - T - 0.01; ui += 1.5) { var ui1 = Math.min(hw - T, ui + 1.5), topi = roofH((ui + ui1) / 2) - 0.03, mu = (ui + ui1) / 2; var gi = new THREE.PlaneGeometry(ui1 - ui, topi - 3.6); K.place("corr", gi, [0.42, 0.44, 0.47], mu, (3.6 + topi) / 2, hd - T - 0.01, PI);
      var boti = Math.abs(mu) < 6.6 ? 7.6 : (mu > -25.2 && mu < -8.6) || (mu > 8.6 && mu < 25.2) ? 5.9 : 7.6; var gn = new THREE.PlaneGeometry(ui1 - ui, topi - boti); K.place("corr", gn, [0.42, 0.44, 0.47], mu, (boti + topi) / 2, -hd + T + 0.11, 0); }
    var ceilG = function (u0, u1) { var g = roofG(u0, u1); var P = g.attributes.position, Nn = g.attributes.normal; for (var i = 0; i < P.count; i++) { P.setY(i, P.getY(i) - 0.1); Nn.setXYZ(i, -Nn.getX(i), -Nn.getY(i), -Nn.getZ(i)); } var ix = g.index.array; for (var t = 0; t < ix.length; t += 3) { var q = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = q; } return g; };
    // the clerestory: a glass band high on both long walls
    [-1, 1].forEach(function (sd) { K.box("glass", 0xffffff, 0.04, 1.1, S.D - 4, sd * (hw + 0.03), 6.75, 0); for (var v2 = -hd + 2; v2 <= hd - 2 + 0.01; v2 += 2.4) K.box("steel", 0x2a2c30, 0.08, 1.2, 0.08, sd * (hw + 0.06), 6.75, v2); K.box("steel", 0x2a2c30, 0.1, 0.08, S.D - 4, sd * (hw + 0.06), 7.32, 0); K.box("steel", 0x2a2c30, 0.1, 0.08, S.D - 4, sd * (hw + 0.06), 6.18, 0); });
    // the barrel roof: corrugated over the vault, ribs along the curve, a crown vent, gutters, trims
    var roofG = function (u0, u1) { var nu = 2, g = new THREE.BufferGeometry(), P = [], Nn = [], Uu = [], I = [], v0 = -hd - 0.7, v3 = hd + 0.7; for (var i = 0; i <= nu; i++) { var uu = lerp(u0, u1, i / nu), y = roofH(uu) + 0.06, k = uu / hw, dy = -2 * (S.crown - S.eave) * k / hw, nl = Math.hypot(dy, 1); [v0, v3].forEach(function (vv, j) { P.push(uu, y, vv); Nn.push(-dy / nl, 1 / nl, 0); Uu.push(j ? (v3 - v0) / 1.6 : 0, uu / 1.6); }); } for (var q = 0; q < nu; q++) { var a = q * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(Nn, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(Uu, 2)); g.setIndex(I); return g; };
    for (var ur = -hw - 0.6; ur < hw + 0.59; ur += 1.8) { var c2 = R() < 0.1 ? [0.82, 0.6, 0.46] : [0.84 + R() * 0.06, 0.86 + R() * 0.06, 0.88 + R() * 0.05]; K.add("corr", roofG(ur, Math.min(hw + 0.6, ur + 1.8)), c2); }
    for (var uc = -hw; uc < hw - 0.01; uc += 1.8) K.add("corr", ceilG(uc, Math.min(hw, uc + 1.8)), [0.3, 0.31, 0.33]);
    for (var ri = -hd; ri <= hd + 0.01; ri += 6) { for (var uq = -hw; uq < hw; uq += 1.5) { var a1 = V3(uq, roofH(uq) + 0.1, ri), a2 = V3(uq + 1.5, roofH(uq + 1.5) + 0.1, ri); K.tube("steel", 0x3a3d42, a1, a2, 0.05, 6); } }
    [-1, 1].forEach(function (sd) { K.box("steel", 0x2b2d31, 0.25, 0.22, S.D + 1.4, sd * (hw + 0.55), S.eave - 0.05, 0); });
    for (var gu = -hw; gu < hw; gu += 1.5) [-1, 1].forEach(function (sd) { var y0 = roofH(gu) + 0.09, y1 = roofH(gu + 1.5) + 0.09, mid = (y0 + y1) / 2, len = Math.hypot(1.5, y1 - y0); K.place("steel", new THREE.BoxGeometry(len, 0.14, 0.18), 0x2b2d31, gu + 0.75, mid, sd * (hd + 0.7), 0, 0, Math.atan2(y1 - y0, 1.5)); });
    K.box("steel", 0x44484e, 3.0, 0.5, S.D - 6, 0, S.crown + 0.25, 0); for (var vv2 = -hd + 4; vv2 <= hd - 4; vv2 += 7) K.cyl("steel", 0x8a8f96, 0.4, 0.45, 1.2, 9, S.crown - 0.2 + 0.6, vv2, 12);
    // the glass front: two showroom bays of glass, black steel mullions and transoms, a steel canopy over each
    S.glass.forEach(function (q) { var w = q[1] - q[0], cx = (q[0] + q[1]) / 2; K.box("glass", 0xffffff, w, S.glassY[1] - S.glassY[0], 0.03, cx, (S.glassY[0] + S.glassY[1]) / 2, -hd + 0.15); for (var m = q[0]; m <= q[1] + 0.01; m += w / 8) K.box("steel", 0x1c1d20, 0.09, S.glassY[1] - S.glassY[0] + 0.1, 0.14, m, (S.glassY[0] + S.glassY[1]) / 2, -hd + 0.15); [S.glassY[0], 4.3, S.glassY[1]].forEach(function (yy) { K.box("steel", 0x1c1d20, w, 0.1, 0.16, cx, yy, -hd + 0.15); });
      K.box("steel", 0x2b2d31, w + 0.6, 0.14, 2.8, cx, 6.25, -hd - 1.3); for (var t = 0; t < 4; t++) { var tx = q[0] + 0.6 + t * (w - 1.2) / 3; K.tube("steel", 0x1c1d20, V3(tx, 6.3, -hd - 2.6), V3(tx, 7.6, -hd - 0.1), 0.025, 6); } sol.push([cx, -hd + 0.15, w, 0.3, 0, 6]); });
    // the roll-up door, open: the drum housing, the guides, the header; the jambs are the earth piers
    K.cyl("steel", 0x30343a, 0.5, 0.5, 13.4, 0, 7.75, -hd + 0.55, 18, false, 0, 0, PI / 2); K.box("steel", 0x1c1d20, 13.4, 0.35, 0.3, 0, 7.15, -hd + 0.1); [-1, 1].forEach(function (sd) { K.box("steel", 0x3a3e44, 0.18, 7.0, 0.24, sd * 6.38, 3.5, -hd + 0.4); }); for (var sl = 0; sl < 6; sl++) K.box("corr", [0.75, 0.78, 0.82], 12.6, 0.16, 0.06, 0, 6.9 - sl * 0.15, -hd + 0.7);
    // the sign: a dark steel board on struts in the gable, the neon over it (additive), "NO JOB TOO WILD" under the canopy
    var sw = 8.4, sh2 = sw / 1.514; K.box("steel", 0x0d0e10, sw + 0.5, sh2 + 0.4, 0.18, 0, 7.95 + sh2 / 2, -hd - 0.55); [-1, 1].forEach(function (sd) { K.tube("steel", 0x1c1d20, V3(sd * sw * 0.35, 8.2, -hd - 0.5), V3(sd * sw * 0.35, 8.4, -hd + 0.2), 0.05, 6); K.tube("steel", 0x1c1d20, V3(sd * sw * 0.35, 7.95 + sh2, -hd - 0.5), V3(sd * sw * 0.35, roofH(sd * sw * 0.35) - 0.4, -hd + 1.5), 0.05, 6); });
    K.plane("neonP", 0xffffff, sw, sh2, 0, 7.95 + sh2 / 2, -hd - 0.66, PI, 0); EX.signY = 7.95 + sh2 / 2;
    K.plane("signs", 0xffffff, 6.2, 0.78, -16.9, 6.75, -hd - 0.06, PI, 0, signUV(3)); K.plane("signs", 0xffffff, 6.2, 0.78, 16.9, 6.75, -hd - 0.06, PI, 0, signUV(1));
    [-1, 1].forEach(function (sd) { K.plane("signs", 0xffffff, 26, 3.25, sd * (hw + 0.06), 5.6, 0, sd * PI / 2, 0, signUV(0)); K.plane("signs", 0xffffff, 18, 1.0, sd * (hw + 0.06), 4.05, 0, sd * PI / 2, 0, signUV(1)); });
    // the forecourt: stained concrete with joints and painted bays, three show plinths with lit rims, the monument, lamp posts, bunting
    var f = S.fc, fx0 = f[0] - S.cx, fx1 = f[2] - S.cx, fz0 = f[1] - S.cz, fz1 = -hd; var fg = new THREE.PlaneGeometry(fx1 - fx0, fz1 - fz0); fg.rotateX(-PI / 2); var FU = fg.attributes.uv; for (var i2 = 0; i2 < FU.count; i2++) FU.setXY(i2, FU.getX(i2) * (fx1 - fx0) / 7, FU.getY(i2) * (fz1 - fz0) / 7); K.place("apron", fg, [0.86, 0.8, 0.74], (fx0 + fx1) / 2, 0.03, (fz0 + fz1) / 2);
    for (var jx = fx0 + 6; jx < fx1; jx += 6) K.box("steel", 0x2a2826, 0.04, 0.005, fz1 - fz0, jx, 0.034, (fz0 + fz1) / 2); for (var jz = fz0 + 6; jz < fz1; jz += 6) K.box("steel", 0x2a2826, fx1 - fx0, 0.005, 0.04, (fx0 + fx1) / 2, 0.034, jz);
    for (var lane = -1; lane <= 1; lane += 2) K.box("glow", 0xe8c24a, 0.14, 0.006, fz1 - fz0 - 2, lane * 6.9, 0.036, (fz0 + fz1) / 2);
    EX.plinths = [[-17.5, -hd - 9.5], [-17.0, -hd - 21.0], [12.5, -hd - 15.0]].map(function (p) { K.cyl("steel", 0x24262a, 2.3, 2.4, 0.2, p[0], 0.1, p[1], 40); K.cyl("glow", 0xff8a2a, 2.36, 2.36, 0.04, p[0], 0.2, p[1], 40, true); sol.push([p[0], p[1], 4.2, 4.2, 0, 0.2]); return p; });
    var mon = [-21.0, -hd - 27.6]; K.box("earth", [0.9, 0.76, 0.6], 8.2, 2.3, 0.9, mon[0], 1.15, mon[1], 0, earthT); K.plane("signs", 0xffffff, 7.6, 0.95, mon[0], 1.42, mon[1] - 0.46, PI, 0, signUV(2)); K.plane("signs", 0xffffff, 7.6, 0.95, mon[0], 1.42, mon[1] + 0.46, 0, 0, signUV(2)); sol.push([mon[0], mon[1], 8.2, 0.9, 0, 2.3]);
    var poles = [[fx0 + 1.2, fz0 + 1.5], [fx1 - 1.2, fz0 + 1.5], [fx0 + 1.2, fz1 - 2.5], [fx1 - 1.2, fz1 - 2.5], [-7.4, fz0 + 1.5], [7.4, fz0 + 1.5]]; EX.lamps = [];
    poles.forEach(function (p) { K.cyl("steel", 0x1c1d20, 0.09, 0.12, 6.5, p[0], 3.25, p[1], 8); K.box("steel", 0x1c1d20, 0.9, 0.12, 0.3, p[0], 6.45, p[1]); K.box("glow", 0xfff1d0, 0.7, 0.04, 0.22, p[0], 6.38, p[1]); EX.lamps.push([p[0], 6.1, p[1]]); sol.push([p[0], p[1], 0.3, 0.3, 0, 6.5]); });
    var bunt = function (A, B) { var n = Math.max(6, Math.round(A.distanceTo(B) / 0.55)), cols = [0xe0642a, 0x2ab3b0, 0xf4cd5a, 0xe8508f, 0x4dde6f, 0xf5f1e6]; for (var k = 0; k < n; k++) { var t0 = k / n, t1 = (k + 0.7) / n, P0 = A.clone().lerp(B, t0), P1 = A.clone().lerp(B, t1); P0.y -= Math.sin(t0 * PI) * 0.9; P1.y -= Math.sin(t1 * PI) * 0.9; var mid = P0.clone().lerp(P1, 0.5); mid.y -= 0.32; var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute([P0.x, P0.y, P0.z, P1.x, P1.y, P1.z, mid.x, mid.y, mid.z, P1.x, P1.y, P1.z, P0.x, P0.y, P0.z, mid.x, mid.y, mid.z], 3)); g.computeVertexNormals(); K.add("paint", g, cols[k % cols.length]); } };
    [[0, 4], [1, 5], [4, 2], [5, 3]].forEach(function (pp) { var a = poles[pp[0]], b = poles[pp[1]]; bunt(V3(a[0], 6.0, a[1]), V3(b[0], 6.0, b[1])); }); bunt(V3(-25, 7.4, -hd - 0.3), V3(poles[2][0], 6.0, poles[2][1])); bunt(V3(25, 7.4, -hd - 0.3), V3(poles[3][0], 6.0, poles[3][1]));
    // tyre stacks, a few barrels and an air compressor by the wall
    [[-26.3, -hd - 3.2], [-25.0, -hd - 3.4], [25.3, -hd - 3.0]].forEach(function (p, i) { for (var k = 0; k < 4 + (i % 2); k++) K.place("rubber", new THREE.TorusGeometry(0.29, 0.12, 8, 18), 0x161618, p[0], 0.12 + k * 0.24, p[1], 0, PI / 2); sol.push([p[0], p[1], 0.8, 0.8, 0, 1.2]); });
    [[26.0, -hd - 5.0, 0xb8643a], [26.6, -hd - 5.9, 0x2a7a8a]].forEach(function (b) { K.cyl("paint", b[2], 0.29, 0.29, 0.88, b[0], 0.44, b[1], 14); sol.push([b[0], b[1], 0.6, 0.6, 0, 0.9]); });
    // collision: the long walls, the back, the front piers, the glass (above), the plinths, the monument, the poles
    sol.push([0, hd - T / 2, S.W, T, 0, S.eave], [-hw + T / 2, 0, T, S.D, 0, S.eave], [hw - T / 2, 0, T, S.D, 0, S.eave]); [[-hw, -25.2], [-8.6, -6.6], [6.6, 8.6], [25.2, hw]].forEach(function (q) { sol.push([(q[0] + q[1]) / 2, -hd + 0.3, q[1] - q[0], 0.6, 0, 7.6]); });
    var g0 = new THREE.Group(); g0.name = "bs_exterior"; g0.position.set(S.cx, S.G, S.cz); g0.userData.noBatch = true;
    var bases = { earth: M.earth, corr: M.corr, steel: M.steel, glass: M.glass, glow: M.glow, signs: M.signs, apron: M.apron, paint: M.paint, rubber: M.rubber, neonP: M.neon };
    EX.meshes = K.build(g0, bases, { cast: true }); EX.meshes.forEach(function (m) { var b = m.name.slice(3); m.castShadow = b === "earth" || b === "corr" || b === "steel"; m.receiveShadow = b !== "glow" && b !== "neonP" && b !== "glass"; if (b === "apron") m.userData.noCull = true; });
    // night: warm pools on the forecourt under the lamps, an LED line along the glass, soffit lights under the canopies (additive, faded in by night)
    var pk = new Kit(); EX.lamps.forEach(function (p) { var g = new THREE.PlaneGeometry(13, 13); g.rotateX(-PI / 2); pk.place("pool", g, [0.42, 0.34, 0.24], p[0], 0.05, p[2]); }); (EX.plinths || []).forEach(function (p) { var g = new THREE.PlaneGeometry(7, 7); g.rotateX(-PI / 2); pk.place("pool", g, [0.5, 0.26, 0.1], p[0], 0.22, p[1]); });
    S.glass.forEach(function (q) { var g = new THREE.PlaneGeometry(q[1] - q[0], 3.2); g.rotateX(-PI / 2); pk.place("pool", g, [0.36, 0.3, 0.22], (q[0] + q[1]) / 2, 0.05, -hd - 1.2); var g2 = new THREE.PlaneGeometry(q[1] - q[0], 2.6); g2.rotateX(-PI / 2); pk.place("pool", g2, [0.3, 0.24, 0.16], (q[0] + q[1]) / 2, 0.06, -hd - 1.3); }); var pdoor = new THREE.PlaneGeometry(13, 7); pdoor.rotateX(-PI / 2); pk.place("pool", pdoor, [0.45, 0.3, 0.2], 0, 0.05, -hd - 3);
    var poolEx = M.pool.clone(); poolEx.userData.avShared = true; poolEx.opacity = 0; EX.poolMat = poolEx; var pm2 = new THREE.Mesh(pk.merge().pool, poolEx); pm2.name = "bs ext pools"; pm2.renderOrder = 2; g0.add(pm2);
    var colBox = function (w, h, d, hex) { var g = new THREE.BoxGeometry(w, h, d), c = new THREE.Color(hex), ca = new Float32Array(g.attributes.position.count * 3); for (var i = 0; i < ca.length; i += 3) { ca[i] = c.r; ca[i + 1] = c.g; ca[i + 2] = c.b; } g.setAttribute("color", new THREE.BufferAttribute(ca, 3)); return g; };
    S.glass.forEach(function (q) { var gl = new THREE.Mesh(colBox(q[1] - q[0], 0.05, 0.06, 0xffc890), M.glow); gl.position.set((q[0] + q[1]) / 2, 0.47, -hd - 0.02); g0.add(gl); var sf = new THREE.Mesh(colBox(q[1] - q[0] - 1, 0.03, 0.18, 0xfff0d8), M.glow); sf.position.set((q[0] + q[1]) / 2, 6.17, -hd - 2.0); g0.add(sf); });
    // the neon's glow round the sign at night (a larger, faint copy)
    var hg = new THREE.PlaneGeometry(sw * 1.18, sh2 * 1.22); hg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(hg.attributes.position.count * 3).fill(0.55), 3)); var halo = new THREE.Mesh(hg, M.neon); halo.rotation.y = PI; halo.position.set(0, EX.signY, -hd - 0.7); halo.userData.bsHalo = true; g0.add(halo); EX.halo = halo;
    EX.tris = Math.round(K.tris); scene.add(g0); g0.updateMatrixWorld(true); EX.g = g0;
    // solids in world space
    EX.solids = []; sol.forEach(function (q) { var w = l2w(q[0], q[1]); var sd = addSolid(w[0], w[1], 0, q[2], q[3], S.G + q[4] - 0.3, S.G + q[5], "bodyshop"); if (sd) EX.solids.push(sd); });
    // lamps through the client's light pool: the forecourt posts after dark, the sign
    EX.lights = []; var addL = function (col, k, dist, u, y, v) { var l = new THREE.PointLight(col, 0, dist, 1.4); l.position.set(u, y, v); l.userData.k0 = k; g0.add(l); EX.lights.push(l); return l; };
    EX.lamps.forEach(function (p, i) { if (i < 4) addL(0xffd9a8, 9, 26, p[0], p[1] - 0.4, p[2]); }); addL(0xff7a5a, 6, 22, 0, EX.signY - 1, -hd - 4);
    try { LIGHTS.dirty = true; } catch (e) {}
    return g0; }

  // ───────────────────────── the interior: built near (time sliced), drawn from inside or through the glass, disposed far ─────────────────────────
  var IN = BS.in = BS.in || { L: null, sb: null };
  var R_BUILD = 120, R_DROP = 190;
  function rimToKit(K, B, rimCol, tyreCol, m4) {
    // wheel parts (RB, regions) as Kit pieces with colours: metal on the chrome base, rubber on the rubber base
    B.L.forEach(function (g) { var r = g.userData.reg, base = r === 11 ? "rubber" : r === 14 ? "steel" : r === 12 ? "paint" : "chrome", col = r === 11 ? tyreCol : r === 14 ? 0x2a2c30 : r === 12 ? 0xb8221c : r === 13 || r === 15 ? 0xe8eaee : rimCol; var g2 = g.clone(); if (m4) g2.applyMatrix4(m4); K.add(base, g2, col); }); B.L = []; }
  function* buildInteriorSteps(L) {
    var S = SITE, M = mats(), K = L.dry ? dryKit() : new Kit(), sol = L.solids, R = rng(4242), hw = S.hw, hd = S.hd, iw = hw - S.wallT, id = hd - S.wallT; L.carts = []; L.lights = []; L.anim = {};
    var so = function (u, v, w, d, y0, y1, ry, seat, face) { L.sol.push([u, v, w, d, y0, y1, ry || 0, seat, face]); };
    // ── floor: polished concrete, painted bay lines, the drive aisle, the reveal ring ──
    var fg = new THREE.PlaneGeometry(iw * 2, id * 2); fg.rotateX(-PI / 2); var FU = fg.attributes.uv; for (var i = 0; i < FU.count; i++) FU.setXY(i, FU.getX(i) * iw * 2 / 6, FU.getY(i) * id * 2 / 6); K.place("floor", fg, [0.62, 0.58, 0.54], 0, 0.02, 0);
    S.bays.forEach(function (b) { [[-2.8, 0], [2.8, 0]].forEach(function (q) { K.box("glow", 0xd9a520, 0.1, 0.004, 11.5, b[0] + q[0], 0.026, 11); }); K.box("glow", 0xd9a520, 5.7, 0.004, 0.1, b[0], 0.026, 5.25); });
    for (var du = -24; du <= 24; du += 3) K.box("glow", 0xe9e2d3, 1.6, 0.004, 0.12, du, 0.026, 3.2);
    K.place("glow", new THREE.RingGeometry(4.25, 4.42, 64).rotateX(-PI / 2), 0xff8a2a, S.rev[0], 0.028, S.rev[1]);
    yield 1;
    // ── the reveal bay: the turntable (its own mesh, it turns), the light ring overhead, beams, the LED backdrop, light pillars ──
    var tg = new THREE.CylinderGeometry(3.5, 3.5, 0.05, 72); var tu = tg.attributes.uv, tp = tg.attributes.position; for (var t = 0; t < tu.count; t++) tu.setXY(t, 0.5 + tp.getX(t) / 7.0, 0.5 - tp.getZ(t) / 7.0); tg.translate(0, 0.035, 0);
    var ca = new Float32Array(tg.attributes.position.count * 3).fill(1); tg.setAttribute("color", new THREE.BufferAttribute(ca, 3));
    if (!L.dry) { var turn = new THREE.Mesh(tg, M.turn); turn.position.set(S.rev[0], 0, S.rev[1]); turn.receiveShadow = true; turn.name = "bs turntable"; L.g.add(turn); L.anim.turn = turn; }
    var rr2 = 4.9, ry2 = 7.4; for (var k = 0; k < 24; k++) { var a0 = k / 24 * TAU, a1 = (k + 1) / 24 * TAU; K.tube("steel", 0x1c1d20, V3(S.rev[0] + Math.cos(a0) * rr2, ry2, S.rev[1] + Math.sin(a0) * rr2), V3(S.rev[0] + Math.cos(a1) * rr2, ry2, S.rev[1] + Math.sin(a1) * rr2), 0.07, 6); K.tube("steel", 0x1c1d20, V3(S.rev[0] + Math.cos(a0) * rr2, ry2 + 0.5, S.rev[1] + Math.sin(a0) * rr2), V3(S.rev[0] + Math.cos(a1) * rr2, ry2 + 0.5, S.rev[1] + Math.sin(a1) * rr2), 0.05, 6); if (k % 2 === 0) K.tube("steel", 0x1c1d20, V3(S.rev[0] + Math.cos(a0) * rr2, ry2, S.rev[1] + Math.sin(a0) * rr2), V3(S.rev[0] + Math.cos(a1) * rr2, ry2 + 0.5, S.rev[1] + Math.sin(a1) * rr2), 0.03, 4); }
    [0, PI / 2, PI, 1.5 * PI].forEach(function (a) { K.tube("steel", 0x2a2c30, V3(S.rev[0] + Math.cos(a) * rr2, ry2 + 0.5, S.rev[1] + Math.sin(a) * rr2), V3(S.rev[0] + Math.cos(a) * rr2, roofH(S.rev[0] + Math.cos(a) * rr2) - 0.2, S.rev[1] + Math.sin(a) * rr2), 0.015, 4); });
    var beams = new Kit(); for (var f = 0; f < 12; f++) { var af = f / 12 * TAU, fx = S.rev[0] + Math.cos(af) * rr2, fz = S.rev[1] + Math.sin(af) * rr2; K.cyl("steel", 0x101113, 0.16, 0.2, 0.36, fx, ry2 - 0.25, fz, 10); K.cyl("glow", f % 3 ? 0xfff2dc : 0xffb070, 0.15, 0.15, 0.02, fx, ry2 - 0.44, fz, 10);
      var tx2 = S.rev[0] + Math.cos(af + PI) * 1.2, tz2 = S.rev[1] + Math.sin(af + PI) * 1.2, A = V3(fx, ry2 - 0.45, fz), Bv = V3(tx2, 0.05, tz2), d = Bv.clone().sub(A), Lb = d.length(), cg = new THREE.CylinderGeometry(0.13, 1.25, Lb, 14, 1, true); cg.translate(0, -Lb / 2, 0); _q.setFromUnitVectors(_v1.set(0, -1, 0), d.normalize()); _m4.compose(A, _q, _s1); beams.add("add", cg, f % 3 ? [0.05, 0.045, 0.04] : [0.07, 0.04, 0.02], _m4); }
    if (!L.dry) { var bm = beams.merge().add; var beamMat = M.add.clone(); beamMat.userData.avShared = true; var beamMesh = new THREE.Mesh(bm, beamMat); beamMesh.name = "bs beams"; beamMesh.renderOrder = 3; L.g.add(beamMesh); L.anim.beams = beamMesh; }
    // the floor pools under the ring (additive) and round the room's fixtures
    var pools = new Kit(), pool = function (u, v, r, col) { var g = new THREE.PlaneGeometry(r * 2, r * 2); g.rotateX(-PI / 2); pools.place("pool", g, col, u, 0.03, v); };
    pool(S.rev[0], S.rev[1], 5.5, [0.32, 0.26, 0.2]); pool(S.show[0], S.show[1], 3.6, [0.22, 0.2, 0.18]);
    // LED backdrop behind the turntable (the shop's neon on black), framed
    var bw = 11, bh = bw / 1.514 * 0.72; K.box("steel", 0x0b0c0e, bw + 0.4, bh + 0.4, 0.3, S.rev[0], 0.6 + bh / 2, S.rev[1] + 6.3); K.plane("neonP", 0xffffff, bw * 0.86, bh * 0.92, S.rev[0], 0.6 + bh / 2, S.rev[1] + 6.13, PI, 0); [-1, 1].forEach(function (sd) { K.box("steel", 0x1c1d20, 0.2, bh + 0.6, 0.5, S.rev[0] + sd * (bw / 2 + 0.2), 0.3 + bh / 2, S.rev[1] + 6.3); }); so(S.rev[0], S.rev[1] + 6.3, bw + 0.8, 0.5, 0, 0.6 + bh + 0.2);
    var pil = new Kit(); [[-6.2, -12.2], [6.2, -12.2], [-6.2, 0.9], [6.2, 0.9]].forEach(function (p) { pil.cyl("glow", 0xffffff, 0.06, 0.06, 6.2, p[0], 3.25, p[1], 8); K.cyl("steel", 0x1c1d20, 0.14, 0.18, 0.3, p[0], 0.15, p[1], 10); K.cyl("steel", 0x1c1d20, 0.14, 0.14, 0.2, p[0], 6.42, p[1], 10); so(p[0], p[1], 0.3, 0.3, 0, 6.4); });
    if (!L.dry) { var pilMat = M.glow.clone(); pilMat.userData.avShared = true; var pilMesh = new THREE.Mesh(pil.merge().glow, pilMat); pilMesh.name = "bs pillars"; L.g.add(pilMesh); L.anim.pil = pilMesh; }
    yield 1;
    // ── the service bays: two-post lifts (one up with a cart on it), tool chests, hose reels, air drops, a bench, a balancer ──
    S.bays.forEach(function (b, bi) { var up = bi === 1, ah = up ? 1.85 : 0.1, col = [0xb8221c, 0x1f4f9a, 0xb8221c][bi];
      [-1, 1].forEach(function (sd) { var px = b[0] + sd * 1.95; K.box("paint", col, 0.36, 4.3, 0.42, px, 2.15, b[1]); K.box("steel", 0x2a2c30, 0.6, 0.05, 0.7, px, 0.025, b[1]); K.box("steel", 0x30343a, 0.12, 0.5, 0.16, px - sd * 0.24, ah + 0.18, b[1]); so(px, b[1], 0.5, 0.6, 0, 4.3);
        [-1, 1].forEach(function (fz) { var A = V3(px - sd * 0.24, ah + 0.06, b[1]), Bq = V3(b[0] + sd * 0.55, ah + 0.06, b[1] + fz * 1.05); K.tube("steel", 0x3a3e44, A, Bq, 0.05, 6); K.cyl("rubber", 0x18181a, 0.09, 0.09, 0.06, Bq.x, ah + 0.11, Bq.z, 10); }); });
      K.box("paint", col, 4.3, 0.24, 0.3, b[0], 4.45, b[1]); K.box("steel", 0x1c1d20, 0.08, 0.6, 0.06, b[0] - 1.95, 1.2, b[1] + 0.25);
      var cpos = up ? [b[0], ah + 0.12, b[1]] : [b[0], 0.02, b[1]]; L.carts.push({ where: bi === 1 ? "lift" : bi === 0 ? "bay1" : "bay3", u: cpos[0], y: cpos[1], v: cpos[2], ry: bi === 2 ? 0.25 : PI, skip: bi === 2 });
      if (up) so(b[0], b[1], 1.3, 2.6, ah + 0.1, ah + 2.3); else if (bi === 0) so(b[0], b[1], 1.4, 2.6, 0, 1.6);
      // hose reel and air drop
      K.place("paint", new THREE.TorusGeometry(0.26, 0.05, 8, 20), 0xf2c21a, b[0] + 2.6, 2.4, id - 0.12); K.cyl("steel", 0x2a2c30, 0.12, 0.12, 0.16, b[0] + 2.6, 2.4, id - 0.1, 12, false, 0, PI / 2); var hp = []; for (var hk = 0; hk <= 10; hk++) { var tt = hk / 10; hp.push(V3(b[0] + 2.6 - tt * 0.6, 2.15 - Math.sin(tt * PI) * 0.4 - tt * 1.9, id - 0.2 - tt * 0.4)); } for (var hh = 0; hh < hp.length - 1; hh++) K.tube("paint", 0xf2c21a, hp[hh], hp[hh + 1], 0.02, 5);
      var ax = b[0] - 2.5, az = b[1] - 5.2, ay = roofH(ax) - 0.3; K.tube("steel", 0x8a8f96, V3(ax, ay, az), V3(ax, 2.7, az), 0.025, 5); for (var c = 0; c < 26; c++) { var a3 = c / 26 * 6 * TAU, a4 = (c + 1) / 26 * 6 * TAU; K.tube("rubber", 0x1a6fbf, V3(ax + Math.cos(a3) * 0.09, 2.7 - c * 0.03, az + Math.sin(a3) * 0.09), V3(ax + Math.cos(a4) * 0.09, 2.7 - (c + 1) * 0.03, az + Math.sin(a4) * 0.09), 0.012, 4); }
      K.plane("signGlow", 0xffffff, 2.4, 0.9, b[0], 5.6, id - 0.06, PI, 0, signUV(4, bi / 3, (bi + 1) / 3)); });
    // tool chests between the bays (the generated chest front) with top boxes
    [-26.5 + 0.9, -19.25, -11.75, -4.4].forEach(function (u, ci) { var w = ci === 0 ? 1.1 : 1.45, h = 1.15, d = 0.62, v = id - 0.45; var fr = new THREE.PlaneGeometry(w, h); K.place("chest", fr, 0xffffff, u, 0.12 + h / 2, v - d / 2 - 0.002, PI); K.box("paint", 0xb21d1a, w, h, d, u, 0.12 + h / 2, v); K.box("chrome", 0xd8dce0, w + 0.02, 0.03, d + 0.02, u, 0.12 + h + 0.015, v); [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sz) { K.cyl("rubber", 0x111111, 0.05, 0.05, 0.04, u + sx * (w / 2 - 0.08), 0.06, v + sz * (d / 2 - 0.08), 8, false, 0, 0, PI / 2); }); });
      if (ci !== 0) { var tf = new THREE.PlaneGeometry(w * 0.9, 0.5); var U2 = tf.attributes.uv; for (var q2 = 0; q2 < U2.count; q2++) U2.setXY(q2, U2.getX(q2), 0.55 + U2.getY(q2) * 0.4); K.place("chest", tf, 0xffffff, u, 1.3 + 0.25 + 0.01, v - d / 2 + 0.05 - 0.002, PI); K.box("paint", 0xb21d1a, w * 0.9, 0.5, d * 0.85, u, 1.56, v + 0.05); } so(u, v, w + 0.1, d + 0.1, 0, ci ? 1.82 : 1.3); });
    // the bench along the west wall, pegboard and tools; a wheel balancer and a tyre changer in bay 3
    K.box("wood", 0x8a5a36, 0.8, 0.06, 9.0, -iw + 0.45, 0.92, 11.4, 0, 1.2); K.box("steel", 0x2a2c30, 0.7, 0.85, 8.8, -iw + 0.45, 0.45, 11.4); K.box("steel", 0x3a3e44, 0.04, 1.6, 9.0, -iw + 0.04, 1.9, 11.4); for (var tl = 0; tl < 22; tl++) { var tz = 7.2 + tl * 0.38, th = 0.2 + R() * 0.25; K.box(R() < 0.5 ? "chrome" : "paint", R() < 0.5 ? 0xcfd3d8 : [0xb8221c, 0x1f4f9a, 0xf2c21a][tl % 3], 0.03, th, 0.04 + R() * 0.03, -iw + 0.08, 1.6 + R() * 0.6, tz); } K.box("steel", 0x30343a, 0.2, 0.18, 0.3, -iw + 0.6, 1.04, 8.0); so(-iw + 0.45, 11.4, 0.9, 9.0, 0, 1.0);
    var b3 = S.bays[2]; K.box("paint", 0x2a5aa8, 0.9, 1.0, 0.7, b3[0] + 1.2, 0.5, b3[1] + 3.3); K.cyl("chrome", 0xc8ccd2, 0.32, 0.32, 0.12, b3[0] + 1.2, 1.22, b3[1] + 3.3, 20, false, 0, 0, PI / 2); K.box("paint", 0xb8221c, 0.8, 0.9, 0.8, b3[0] - 1.0, 0.45, b3[1] + 3.4); K.cyl("steel", 0x30343a, 0.36, 0.36, 0.08, b3[0] - 1.0, 0.95, b3[1] + 3.4, 20); so(b3[0] + 1.2, b3[1] + 3.3, 1.0, 0.8, 0, 1.4); so(b3[0] - 1.0, b3[1] + 3.4, 0.9, 0.9, 0, 1.0);
    [[S.bays[0][0] + 1.0, S.bays[0][1] + 2.2], [S.bays[0][0] - 1.1, S.bays[0][1] + 2.4]].forEach(function (p) { K.place("rubber", new THREE.TorusGeometry(0.27, 0.11, 8, 18), 0x161618, p[0], 0.11, p[1], 0, PI / 2); K.cyl("chrome", 0xc9ccd0, 0.17, 0.17, 0.15, p[0], 0.11, p[1], 16); });
    yield 1;
    // ── the paint booth: a framed glass box, filter-light ceiling, a cart in it, the overspray glow, the exhaust ──
    var B0 = S.booth, bx = (B0[0] + B0[2]) / 2, bz = (B0[1] + B0[3]) / 2, bW = B0[2] - B0[0], bD = B0[3] - B0[1], bH = 4.4;
    K.box("steel", 0xdedad2, bW, 0.04, bD, bx, 0.03, bz); for (var gx = B0[0] + 0.6; gx < B0[2] - 0.5; gx += 1.2) K.box("steel", 0x3a3e44, 0.5, 0.012, bD - 1.2, gx, 0.06, bz);
    [[B0[0], B0[1]], [B0[2], B0[1]], [B0[0], B0[3]], [B0[2], B0[3]], [bx, B0[3]], [B0[0], bz], [B0[2], bz]].forEach(function (p) { K.box("steel", 0xe8e6e0, 0.16, bH, 0.16, p[0], bH / 2, p[1]); });
    K.box("glass", 0xffffff, 0.03, bH - 0.3, bD, B0[0], bH / 2, bz); K.box("glass", 0xffffff, 0.03, bH - 0.3, bD, B0[2], bH / 2, bz); K.box("glass", 0xffffff, bW, bH - 0.3, 0.03, bx, bH / 2, B0[3]); [[B0[0], bx - 2.2], [bx + 2.2, B0[2]]].forEach(function (q) { K.box("glass", 0xffffff, q[1] - q[0], bH - 0.3, 0.03, (q[0] + q[1]) / 2, bH / 2, B0[1]); }); K.box("glass", 0xffffff, 4.4, 0.6, 0.03, bx, bH - 0.3, B0[1]);
    K.box("steel", 0xe8e6e0, bW + 0.2, 0.3, bD + 0.2, bx, bH + 0.15, bz); for (var fx2 = 0; fx2 < 4; fx2++) K.box("glow", 0xf4f8ff, bW / 4 - 0.25, 0.02, bD - 0.6, B0[0] + bW * (fx2 + 0.5) / 4, bH - 0.01, bz);
    K.cyl("steel", 0x9aa0a6, 0.55, 0.55, roofH(bx) - bH - 0.4, bx + 3, (roofH(bx) + bH) / 2, bz + 3, 14); K.plane("signGlow", 0xffffff, 2.6, 1.0, bx, bH + 0.85, B0[1] - 0.12, PI, 0, signUV(5, 0, 0.25));
    [[B0[0], bz, 0.2, bD], [B0[2], bz, 0.2, bD], [bx, B0[3], bW, 0.2], [(B0[0] + bx - 2.2) / 2, B0[1], bx - 2.2 - B0[0], 0.2], [(bx + 2.2 + B0[2]) / 2, B0[1], B0[2] - bx - 2.2, 0.2]].forEach(function (q) { so(q[0], q[1], q[2], q[3], 0, bH); });
    L.carts.push({ where: "booth", u: bx, y: 0.06, v: bz + 0.4, ry: 0.5 }); so(bx, bz + 0.4, 1.6, 2.7, 0, 2.0, 0.5);
    var mist = new Kit(); for (var m = 0; m < 14; m++) { var mu = bx + (R() - 0.5) * 6, mv = bz + 0.4 + (R() - 0.5) * 6, my = 0.6 + R() * 2.4, ms = 1.4 + R() * 1.6, g = new THREE.PlaneGeometry(ms, ms); var col2 = R() < 0.6 ? [0.32, 0.08, 0.18] : [0.26, 0.12, 0.22]; mist.place("pool", g, col2, mu, my, mv, R() * PI); mist.place("pool", g.clone(), col2, mu, my, mv, R() * PI + PI / 2); }
    if (!L.dry) { var mistMat = M.pool.clone(); mistMat.userData.avShared = true; var mistMesh = new THREE.Mesh(mist.merge().pool, mistMat); mistMesh.name = "bs overspray"; mistMesh.renderOrder = 4; L.g.add(mistMesh); L.anim.mist = mistMesh; }
    yield 1;
    // ── the wrap and decal station: a vinyl roll rack, the plotter, a work table, a cart half wrapped ──
    var W0 = S.wrap, wx = (W0[0] + W0[2]) / 2; var cols = [0xe0642a, 0x2ab3b0, 0xf4cd5a, 0xe8508f, 0x6a2bd8, 0x9be33c, 0x141414, 0xf2f0ea, 0xb8643a, 0x1f5fae, 0xc8322a, 0x8a8f96];
    for (var sh = 0; sh < 3; sh++) { var sy = 0.5 + sh * 0.85; K.box("steel", 0x2a2c30, 0.55, 0.04, 9, iw - 0.32, sy - 0.12, 11.2); for (var rl = 0; rl < 12; rl++) K.cyl("paint", cols[(rl + sh * 5) % cols.length], 0.11, 0.11, 0.62, iw - 0.32, sy, 7.0 + rl * 0.72, 12, false, 0, 0, PI / 2); } [7.0 - 0.5, 11.2, 15.3].forEach(function (pz) { K.box("steel", 0x2a2c30, 0.06, 2.5, 0.06, iw - 0.32, 1.25, pz); }); so(iw - 0.32, 11.2, 0.7, 9.2, 0, 2.5);
    K.box("paint", 0xd8dadd, 2.6, 0.55, 0.7, wx - 1.8, 1.0, id - 0.6); K.box("steel", 0x1c1d20, 2.4, 0.08, 0.05, wx - 1.8, 1.05, id - 0.96); K.box("glow", 0x4dde6f, 0.08, 0.04, 0.02, wx - 0.75, 1.2, id - 0.96); [-1.1, 1.1].forEach(function (dx) { K.box("steel", 0x2a2c30, 0.06, 0.75, 0.6, wx - 1.8 + dx, 0.38, id - 0.6); }); so(wx - 1.8, id - 0.6, 2.7, 0.8, 0, 1.3);
    K.box("wood", 0xa07a52, 2.8, 0.06, 1.5, wx - 0.6, 0.9, 7.4, 0, 1.4); K.box("steel", 0x2a2c30, 2.7, 0.86, 1.4, wx - 0.6, 0.44, 7.4); K.box("paint", 0xe8508f, 1.6, 0.004, 0.9, wx - 0.9, 0.935, 7.4); K.box("paint", 0x111111, 0.12, 0.02, 0.06, wx + 0.2, 0.95, 7.2); so(wx - 0.6, 7.4, 2.9, 1.6, 0, 0.95);
    L.carts.push({ where: "wrap", u: wx - 0.8, y: 0.02, v: 12.4, ry: -0.35 }); so(wx - 0.8, 12.4, 1.6, 2.7, 0, 2.0, -0.35); K.plane("signGlow", 0xffffff, 2.6, 1.0, wx, 5.4, id - 0.06, PI, 0, signUV(5, 0.25, 0.5));
    yield 1;
    // ── the wheel and tyre wall (west, north part): rims on pegs, tyres racked under them ──
    K.box("steel", 0x23262a, 0.08, 4.6, 17.5, -iw + 0.05, 3.25, -7.2); for (var row = 0; row < 4; row++) for (var col = 0; col < 9; col++) { var L2 = { w: (row * 9 + col) % 8, ty: [0, 4, 3, 1][row], l: 0 }; var S2 = wheelSpec(L2); var B2 = new RB(); var mm = new THREE.Matrix4().makeTranslation(-iw + 0.2 + S2.w * 0.3, 1.45 + row * 1.1, -15.2 + col * 2.0); if (L.dry) continue; wheelOne(B2, S2, mm); var rimc = [0xd8dce0, 0x1a1a1c, 0xd8a930, 0x8a5a2e, 0x3e4247, 0xf2f2f0, 0xc0262a, 0xb8643a, 0xe8eaee][(col + row * 2) % 9]; rimToKit(K, B2, rimc, 0x151517); if (col % 3 === 2) yield 1; }
    for (var tr = 0; tr < 3; tr++) { K.box("steel", 0x2a2c30, 0.9, 0.05, 17.5, -iw + 0.6, 0.22 + tr * 0.0, -7.2); } for (var ty2 = 0; ty2 < 14; ty2++) { K.place("rubber", new THREE.TorusGeometry(0.28, 0.11, 8, 18), 0x161618, -iw + 0.7, 0.55, -15.6 + ty2 * 1.2, PI / 2, 0); } so(-iw + 0.5, -7.2, 1.1, 17.6, 0, 1.0); K.plane("signGlow", 0xffffff, 3.2, 1.0, -iw + 0.12, 6.4, -7.2, PI / 2, 0, signUV(5, 0.5, 0.75));
    K.plane("signGlow", 0xffffff, 9.0, 1.15, -iw + 0.12, 7.25, 8.0, PI / 2, 0, signUV(3));
    yield 1;
    // ── the parts wall (east, north part): slatwall, shelves of light bars, coolers, speaker bars, flags, baskets, boxes ──
    K.box("steel", 0x2b2e33, 0.08, 4.4, 12.5, iw - 0.05, 3.0, -10.4); for (var sl2 = 0; sl2 < 22; sl2++) K.box("steel", 0x3a3e44, 0.02, 0.03, 12.5, iw - 0.1, 0.9 + sl2 * 0.2, -10.4);
    for (var shf = 0; shf < 4; shf++) { var syy = 0.9 + shf * 1.05; K.box("steel", 0x1c1d20, 0.5, 0.04, 12.2, iw - 0.32, syy, -10.4); for (var it2 = 0; it2 < 8; it2++) { var pz2 = -16.0 + it2 * 1.55, kind = (it2 + shf) % 5;
        if (kind === 0) { K.box("steel", 0x101113, 0.12, 0.08, 1.1, iw - 0.3, syy + 0.06, pz2); for (var ld = 0; ld < 6; ld++) K.box("glow", 0xeaf2ff, 0.01, 0.05, 0.12, iw - 0.37, syy + 0.06, pz2 - 0.45 + ld * 0.18); }
        else if (kind === 1) { K.place("paint", rbox(0.42, 0.34, 0.6, 0.04, 2), [0x2ab3b0, 0xe0642a, 0xf2f0ea, 0x4dde6f][(it2 + shf) % 4], iw - 0.34, syy + 0.19, pz2); K.place("paint", rbox(0.43, 0.06, 0.61, 0.02, 1), 0xf2f0ea, iw - 0.34, syy + 0.38, pz2); }
        else if (kind === 2) { K.place("steel", rbox(0.16, 0.13, 1.0, 0.04, 2), 0x111214, iw - 0.3, syy + 0.09, pz2); K.box("glow", [0xff4fb0, 0x2ae0e0, 0xa050ff][it2 % 3], 0.005, 0.02, 0.9, iw - 0.385, syy + 0.15, pz2); }
        else if (kind === 3) { for (var bxk = 0; bxk < 3; bxk++) K.box("paint", [0xb08a5c, 0xa07a4c, 0xc09a6a][bxk], 0.4, 0.3, 0.42, iw - 0.32, syy + 0.17 + (bxk === 2 ? 0.3 : 0), pz2 - 0.25 + (bxk === 2 ? 0.25 : bxk * 0.5)); }
        else { for (var wb = 0; wb < 5; wb++) K.tube("chrome", 0xd8dce0, V3(iw - 0.5, syy + 0.04, pz2 - 0.3 + wb * 0.15), V3(iw - 0.5, syy + 0.34, pz2 - 0.3 + wb * 0.15), 0.006, 4); K.box("chrome", 0xd8dce0, 0.34, 0.01, 0.62, iw - 0.36, syy + 0.04, pz2); } } }
    so(iw - 0.32, -10.4, 0.7, 12.6, 0, 4.2); K.plane("signGlow", 0xffffff, 3.2, 1.0, iw - 0.12, 5.6, -10.4, -PI / 2, 0, signUV(5, 0.75, 1.0));
    // flags in a bin by the parts wall (the decal atlas' flags)
    for (var fl = 0; fl < 8; fl++) { var fx3 = iw - 1.0 - (fl % 2) * 0.2, fz3 = -3.6 - fl * 0.12; K.tube("steel", 0x1c1d20, V3(fx3, 0.3, fz3), V3(fx3 + 0.05, 2.3 + (fl % 3) * 0.12, fz3), 0.01, 4); var fgq = new THREE.PlaneGeometry(0.55, 0.36); fgq.translate(-0.275, 0, 0); var fu = fgq.attributes.uv; for (var q3 = 0; q3 < fu.count; q3++) fu.setXY(q3, (fl * 256 + fu.getX(q3) * 256) / 2048, (1620 + (1 - fu.getY(q3)) * 128) / 2048); K.place("flags", fgq, 0xffffff, fx3 + 0.04, 2.1 + (fl % 3) * 0.12, fz3, 0.4 + fl * 0.3); var fb = fgq.clone(); K.place("flags", fb, 0xffffff, fx3 + 0.04, 2.1 + (fl % 3) * 0.12, fz3, 0.4 + fl * 0.3 + PI); }
    K.cyl("paint", 0x2a2c30, 0.3, 0.26, 0.6, iw - 1.05, 0.3, -4.0, 14); so(iw - 1.05, -4.0, 0.6, 0.6, 0, 0.6);
    yield 1;
    // ── the lounge: a rug, two sofas facing the turntable, a coffee table, the arcade cabinet, the merch counter and shelves ──
    var Lg = S.lounge, lx = (Lg[0] + Lg[2]) / 2, lz = (Lg[1] + Lg[3]) / 2; var rug = new THREE.PlaneGeometry(8, 6, 8, 1); rug.rotateX(-PI / 2); var rc = [[0.62, 0.22, 0.14], [0.86, 0.66, 0.36], [0.16, 0.45, 0.45], [0.9, 0.85, 0.75]]; K.place("fabric", rug, rc[0], lx - 0.5, 0.03, lz); for (var st = 0; st < 7; st++) K.box("fabric", rc[1 + st % 3], 0.18, 0.004, 6, lx - 4 + 0.9 + st * 1.05, 0.035, lz);
    var sofa = function (cx, cz, ry, len) { var c = Math.cos(ry), s = Math.sin(ry), P = function (lx2, lz2) { return [cx + lx2 * c + lz2 * s, cz - lx2 * s + lz2 * c]; }; var col3 = 0x6a3a22, p0 = P(0, 0); K.place("fabric", rbox(len, 0.42, 0.95, 0.08, 2), col3, p0[0], 0.25, p0[1], ry); var p1 = P(0, 0.4); K.place("fabric", rbox(len, 0.62, 0.22, 0.08, 2), col3, p1[0], 0.62, p1[1], ry); [-1, 1].forEach(function (sd) { var p2 = P(sd * (len / 2 - 0.1), 0); K.place("fabric", rbox(0.22, 0.6, 0.95, 0.07, 2), col3, p2[0], 0.36, p2[1], ry); }); for (var cu = 0; cu < 3; cu++) { var p3 = P(-len / 3 + cu * len / 3, -0.06); K.place("fabric", rbox(len / 3 - 0.06, 0.14, 0.75, 0.06, 2), 0x7a4428, p3[0], 0.52, p3[1], ry); }
      for (var se = 0; se < 3; se++) { var p4 = P(-len / 3 + se * len / 3, -0.08); so(p4[0], p4[1], len / 3 - 0.1, 0.6, 0, 0.55, ry, true, ry + PI); } var pb = P(0, 0.38); so(pb[0], pb[1], len, 0.25, 0, 0.95, ry); };
    sofa(lx + 1.2, lz - 1.8, PI / 2 + 0.22, 2.6); sofa(lx + 1.2, lz + 1.8, PI / 2 - 0.22, 2.6); K.box("wood", 0x5a3a22, 0.8, 0.06, 1.5, lx - 0.6, 0.42, lz, 0, 1.2); K.box("steel", 0x1c1d20, 0.6, 0.38, 1.3, lx - 0.6, 0.2, lz); so(lx - 0.6, lz, 0.8, 1.5, 0, 0.45);
    // two arcade cabinets (procedural: the shop's own materials, no new programs)
    [[lx + 4.4, Lg[1] + 1.0, 0x1a1530, 0xff4fb0, 0x2ae0e0], [lx + 3.2, Lg[1] + 1.0, 0x1f2a1a, 0x9be33c, 0xf4cd5a]].forEach(function (q) { var cx = q[0], cz = q[1]; K.box("paint", q[2], 0.78, 1.78, 0.82, cx, 0.89, cz); K.box("paint", q[3], 0.8, 0.06, 0.84, cx, 0.5, cz); K.box("glow", q[3], 0.7, 0.22, 0.04, cx, 1.66, cz + 0.42); K.place("glow", new THREE.BoxGeometry(0.62, 0.5, 0.02), q[4], cx, 1.25, cz + 0.36, 0, -0.25); K.place("paint", new THREE.BoxGeometry(0.78, 0.06, 0.32), 0x111214, cx, 0.95, cz + 0.52, 0, 0.35); [-0.15, 0.12].forEach(function (dx) { K.cyl("paint", 0xd0302a, 0.025, 0.025, 0.05, cx + dx, 1.0, cz + 0.55, 8); }); so(cx, cz, 0.85, 0.9, 0, 1.8); });
    L.models = [];
    var Mc = S.merch; K.box("wood", 0x7a4a2a, 4.8, 0.06, 0.9, Mc[0], 1.08, Mc[1], 0, 1.2); K.box("steel", 0x1c1d20, 4.6, 1.02, 0.8, Mc[0], 0.52, Mc[1]); K.plane("signGlow", 0xffffff, 4.2, 0.55, Mc[0], 0.62, Mc[1] - 0.41, PI, 0, signUV(6)); K.box("glass", 0xffffff, 1.6, 0.4, 0.6, Mc[0] - 1.4, 1.32, Mc[1]); so(Mc[0], Mc[1], 4.9, 1.0, 0, 1.1);
    for (var sh2 = 0; sh2 < 3; sh2++) { var yy = 1.3 + sh2 * 0.62; K.box("wood", 0x8a5a36, 4.6, 0.04, 0.4, Mc[0], yy, Mc[1] + 2.2); for (var tee = 0; tee < 9; tee++) { var cx2 = Mc[0] - 2.0 + tee * 0.5; if (sh2 === 1) { K.sph("paint", [0x4dde6f, 0x1c1f24, 0xf5f1e6, 0xb8643a][tee % 4], 0.12, cx2, yy + 0.06, Mc[1] + 2.15, 10, 1, 0.6, 1); K.box("paint", [0x4dde6f, 0x1c1f24, 0xf5f1e6, 0xb8643a][tee % 4], 0.2, 0.012, 0.1, cx2, yy + 0.03, Mc[1] + 2.0); } else K.box("fabric", [0x4dde6f, 0x1c1f24, 0xf5f1e6, 0xe0642a, 0x2a7a3e][(tee + sh2) % 5], 0.36, 0.12, 0.3, cx2, yy + 0.08, Mc[1] + 2.2); } } so(Mc[0], Mc[1] + 2.2, 4.7, 0.5, 0, 2.6);
    var lgq = new THREE.PlaneGeometry(2.4, 1.2); var lu = lgq.attributes.uv; for (var q4 = 0; q4 < lu.count; q4++) lu.setXY(q4, (lu.getX(q4) * 256) / 2048, (1620 + (1 - lu.getY(q4)) * 128) / 2048); K.place("flags", lgq, 0xffffff, Mc[0], 3.6, Mc[1] + 2.45, PI);
    yield 1;
    // ── the showroom turntable (the build of the week) by the west glass ──
    var sp = S.show; K.cyl("steel", 0x1a1b1e, 2.7, 2.8, 0.28, sp[0], 0.14, sp[1], 48); K.place("glow", new THREE.TorusGeometry(2.72, 0.035, 6, 64).rotateX(PI / 2), 0x2ae0e0, sp[0], 0.27, sp[1]);
    var sg = new THREE.CylinderGeometry(2.5, 2.5, 0.04, 56); var su = sg.attributes.uv, sp2 = sg.attributes.position; for (var s3 = 0; s3 < su.count; s3++) su.setXY(s3, 0.5 + sp2.getX(s3) / 5.0, 0.5 - sp2.getZ(s3) / 5.0); sg.translate(0, 0.3, 0); sg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(sg.attributes.position.count * 3).fill(1), 3));
    var sdisc = new THREE.Group(); sdisc.position.set(sp[0], 0, sp[1]); if (!L.dry) { var sm = new THREE.Mesh(sg, M.turn); sm.receiveShadow = true; sdisc.add(sm); L.g.add(sdisc); L.anim.show = sdisc; }
    L.carts.push({ where: "showroom", u: 0, y: 0.32, v: 0, ry: 0, parent: sdisc }); so(sp[0], sp[1], 4.0, 4.0, 0, 0.3); so(sp[0], sp[1], 4.0, 4.0, 0, 0.3, PI / 4); so(sp[0], sp[1], 2.9, 2.9, 0.3, 2.2);
    K.box("steel", 0x1c1d20, 0.06, 1.1, 0.06, sp[0] + 3.1, 0.55, sp[1] - 2.2); K.place("signs", new THREE.PlaneGeometry(1.2, 0.3), 0xffffff, sp[0] + 3.1, 1.15, sp[1] - 2.24, PI, 0); if (!L.dry) { var lastQ = K.m.signs[K.m.signs.length - 1]; var uvq = lastQ.attributes.uv; var r7 = signUV(7); for (var q5 = 0; q5 < uvq.count; q5++) uvq.setXY(q5, r7[0] + uvq.getX(q5) * (r7[2] - r7[0]), r7[1] + uvq.getY(q5) * (r7[3] - r7[1])); }
    yield 1;
    // ── the vault: arched steel ribs, three long neon tubes, high-bay lamps, two murals on the back wall, fans ──
    for (var rv = -hd + 3; rv <= hd - 3 + 0.01; rv += 6) { for (var ru = -iw; ru < iw - 0.01; ru += 1.5) { var u2 = Math.min(iw, ru + 1.5); K.tube("steel", 0x2a2c30, V3(ru, roofH(ru) - 0.35, rv), V3(u2, roofH(u2) - 0.35, rv), 0.09, 6); } K.tube("steel", 0x2a2c30, V3(-iw, S.eave - 0.6, rv), V3(iw, S.eave - 0.6, rv), 0.05, 6); for (var ku = -18; ku <= 18; ku += 9) K.tube("steel", 0x2a2c30, V3(ku, S.eave - 0.6, rv), V3(ku, roofH(ku) - 0.35, rv), 0.04, 4); }
    var neon = new Kit(); [[-1, 0x2ae0e0, -11.5], [1, 0xff4fb0, -3.0], [0, 0xff8a2a, 5.0]].forEach(function (q) { neon.cyl("glow", q[1], 0.045, 0.045, 44, 0, 6.6 + q[0] * 0.15, q[2], 8, false, 0, 0, PI / 2); for (var hgr = -20; hgr <= 20; hgr += 10) K.tube("steel", 0x1c1d20, V3(hgr, 6.62 + q[0] * 0.15, q[2]), V3(hgr, roofH(hgr) - 0.4, q[2]), 0.006, 3); });
    if (!L.dry) { var neonG = neon.merge().glow; K.m.glow = K.m.glow || []; K.m.glow.push(neonG); }
    var lamps = [[-16, -9], [-16, 4], [0, 8], [16, -9], [16, 4], [-19, 12], [7, 11], [20.5, 11]]; lamps.forEach(function (p) { var ly = roofH(p[0]) - 1.6; K.cyl("steel", 0x1c1d20, 0.42, 0.25, 0.35, p[0], ly, p[1], 14); K.cyl("glow", 0xfff6e8, 0.4, 0.4, 0.02, p[0], ly - 0.18, p[1], 14); K.tube("steel", 0x1c1d20, V3(p[0], ly + 0.15, p[1]), V3(p[0], roofH(p[0]) - 0.35, p[1]), 0.01, 3); pool(p[0], p[1], 3.0, [0.16, 0.15, 0.13]); });
    var mur = function (base, u, w) { var h = w / 2.336; var g = new THREE.PlaneGeometry(w, h); K.place(base, g, 0xffffff, u, 4.0 + h / 2, id - 0.03, PI); K.box("steel", 0x1c1d20, w + 0.3, 0.12, 0.12, u, 4.0 - 0.06, id - 0.08); K.box("steel", 0x1c1d20, w + 0.3, 0.12, 0.12, u, 4.0 + h + 0.06, id - 0.08); }; mur("muralA", -14.5, 13); mur("muralB", 14.0, 12);
    [[-10, 0], [10, 0]].forEach(function (p) { var fy = roofH(p[0]) - 1.2; K.cyl("steel", 0x1c1d20, 0.12, 0.12, 0.3, p[0], fy, p[1], 10); for (var bl = 0; bl < 5; bl++) K.place("steel", new THREE.BoxGeometry(1.6, 0.02, 0.28), 0x2a2c30, p[0], fy - 0.1, p[1], bl / 5 * TAU, 0.12); K.tube("steel", 0x1c1d20, V3(p[0], fy, p[1]), V3(p[0], roofH(p[0]) - 0.35, p[1]), 0.02, 4); });
    yield 1;
    if (L.dry) { (L.models || []).forEach(function (q) { so(q[1], q[2], 0.9, 0.9, 0, 1.9); }); return true; }
    // merge per base, one base a step
    var bases = { floor: M.floor, earth: M.earth, corr: M.corr, steel: M.steel, chrome: M.chrome, paint: M.paint, rubber: M.rubber, fabric: M.fabric, wood: M.wood, glass: M.glass, glow: M.glow, signs: M.signs, signGlow: M.signGlow, chest: M.chest, muralA: M.muralA, muralB: M.muralB, neonP: M.neon, flags: M.flags || flagsMat(), pool: M.pool };
    var keys = Object.keys(K.m); for (var kb = 0; kb < keys.length; kb++) { var b = keys[kb], gg = mergeAll(K.m[b]); K.m[b] = null; if (!gg) continue; var mt = bases[b]; if (!mt) { note("base", b); continue; } var me = new THREE.Mesh(gg, mt); me.name = "bs in " + b; me.castShadow = b === "steel" || b === "paint" || b === "chrome" || b === "fabric" || b === "wood" || b === "rubber"; me.receiveShadow = b !== "glow" && b !== "signGlow" && b !== "glass" && b !== "neonP" && b !== "pool"; me.userData.shSet = true; if (mt.transparent) me.renderOrder = 2; L.g.add(me); L.tris += gg.attributes.position.count / 3; yield 1; }
    var pm = pools.merge().pool; if (pm) { var poolMat = M.pool.clone(); poolMat.userData.avShared = true; L.anim.poolMat = poolMat; var pme = new THREE.Mesh(pm, poolMat); pme.name = "bs pools"; pme.renderOrder = 2; L.g.add(pme); }
    // pooled lamps: three spots on the turntable, one on the showroom, points for the bays, booth, wrap, lounge, merch, wheel wall
    var addL = function (kind, col, k, dist, u, y, v, tu, tv, ang) { var l = kind === "spot" ? new THREE.SpotLight(col, 0, dist, ang || 0.5, 0.55, 1.2) : new THREE.PointLight(col, 0, dist, 1.3); l.position.set(u, y, v); l.userData.k0 = k; if (kind === "spot") { var tg2 = new THREE.Object3D(); tg2.position.set(tu, 0.3, tv); L.g.add(tg2); l.target = tg2; } L.g.add(l); L.lights.push(l); return l; };
    L.spots = [0, 1, 2].map(function (i) { var a = i / 3 * TAU + 0.5; return addL("spot", i === 1 ? 0xffd2a0 : 0xfff4e6, 7, 16, S.rev[0] + Math.cos(a) * 4.6, 7.0, S.rev[1] + Math.sin(a) * 4.6, S.rev[0], S.rev[1], 0.42); });
    addL("spot", 0xfff0dc, 5, 14, sp[0] + 2.5, 6.5, sp[1] - 2.0, sp[0], sp[1], 0.45);
    [[S.bays[0][0], 9], [S.bays[2][0], 9], [bx, bz]].forEach(function (p, i) { addL("point", i === 2 ? 0xff6aa8 : 0xfff2e2, i === 2 ? 6 : 5, i === 2 ? 12 : 18, p[0], i === 2 ? 3.2 : 5.0, p[1]); });
    addL("point", 0xf4f8ff, 4.5, 16, wx, 5.0, 10); addL("point", 0xffd9a8, 4.5, 14, lx, 3.6, lz); addL("point", 0xfff0dc, 4, 14, -iw + 3, 4.6, -7.2);
    // the carts: show carts dressed with their looks (bay 3 stays empty)
    var shows = C("showCarts", []) || []; L.carts.forEach(function (c) { if (c.skip) return; var e = shows.filter(function (q) { return q.where === c.where; })[0] || shows[0]; if (!has("cart")) return; var g = makeModel("cart"); g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); g.position.set(c.u, c.y, c.v); g.rotation.y = c.ry; (c.parent || L.g).add(g); c.g = g; c.look = e ? e.look : null; dressCart(g, c.look, null); });
    yield 1;
    // the arcade cabinets (the client's models) in the lounge
    (L.models || []).forEach(function (q) { if (!has(q[0])) return; var g = makeModel(q[0]); var bb = new THREE.Box3().setFromObject(g), hh = bb.max.y - bb.min.y; if (hh > 0.01) g.scale.setScalar(1.95 / hh); g.position.set(q[1], -bb.min.y * (hh > 0.01 ? 1.95 / hh : 1), q[2]); g.rotation.y = q[3]; g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); L.g.add(g); });
    try { LIGHTS.dirty = true; } catch (e) {}
    return true;
  }
  function flagsMat() { var M = mats(); if (M.flags) return M.flags; M.flags = std({ map: decalTex(), roughness: 0.85, metalness: 0, vertexColors: true }); M.flags.onBeforeCompile = indoorObc; M.flags.userData.avShared = true; return M.flags; }
  function newL() { var g = new THREE.Group(); g.name = "bs_interior"; g.position.set(SITE.cx, SITE.G, SITE.cz); g.userData.noBatch = true; g.userData.interior = true; return { g: g, solids: [], sol: [], lights: [], carts: [], tris: 0 }; }
  function finishL(L) { scene.add(L.g); L.g.updateMatrixWorld(true); try { var fl = L.g.children.filter(function (o) { return o.name === "bs in floor"; })[0]; if (fl && window.PLAN_GFX && PLAN_GFX.addReflectiveFloor) L.refl = PLAN_GFX.addReflectiveFloor(fl, { strength: 0.6, tint: 0.95, probe: false }); } catch (e) { note("floor reflections", e); } try { if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(L.g, { name: "bs interior" }); } catch (e) {} return L; }
  function disposeL() { var L = IN.L; if (!L) return; try { if (L.refl && L.refl.remove) L.refl.remove(); } catch (e) {} try { scene.remove(L.g); (L.carts || []).forEach(function (c) { if (c.g) undressCart(c.g, null); }); L.g.traverse(function (o) { if ((o.isMesh || o.isInstancedMesh) && o.geometry && !o.userData.bsPart && !(o.geometry.userData && o.geometry.userData.bsKeep) && !o.userData.bsBaseMesh) o.geometry.dispose(); }); } catch (e) { note("dispose", e); } IN.L = null; BS.n.disposes++; try { LIGHTS.dirty = true; } catch (e) {} }
  // the interior solids are registered once at load (the people's walk grid needs them), whether or not the rooms are built
  // a kit that builds nothing (the solids pass)
  function dryKit() { var nop = function () { return null; }; return { m: {}, tris: 0, add: nop, place: nop, box: nop, cyl: nop, sph: nop, tube: nop, plane: nop }; }
  // the interior solids are registered once at load (the people's walk grid needs them), whether or not the rooms are built
  function interiorSolids() { if (IN.solidsDone) return; IN.solidsDone = true; var L = newL(); L.dry = true; var it = buildInteriorSteps(L), r, t0 = nowMs(); try { do { r = it.next(); } while (!r.done); } catch (e) { note("solids pass", e); }
    var S = SITE; IN.solids = []; L.sol.forEach(function (q) { var w = l2w(q[0], q[1]); var sd = addSolid(w[0], w[1], q[6] || 0, q[2], q[3], S.G + q[4] - 0.2, S.G + q[5], "bodyshop"); if (sd) { if (q[7]) { sd.seat = true; if (typeof q[8] === "number") sd.face = q[8]; } IN.solids.push(sd); } }); BS.n.solidsMs = Math.round(nowMs() - t0); BS.n.solids = IN.solids.length; }
  function interiorFrame() {
    var S = SITE, px = player.position.x, pz = player.position.z, d = lotDist(px, pz), flying = typeof FLY !== "undefined" && FLY.on;
    if (!IN.L && !IN.sb && d < R_BUILD && !flying) { var L = newL(); IN.sb = { L: L, it: buildInteriorSteps(L), t0: nowMs() }; }
    if (IN.sb) { var sb = IN.sb, r; try { var hurry = inShop(px, player.position.y + 1, pz); if (!hurry && window.PLAN_PERF && PLAN_PERF.step) r = PLAN_PERF.step(sb.it); else { do { r = sb.it.next(); } while (!r.done); } } catch (e) { note("build", e); IN.sb = null; return; } if (r && r.done) { IN.L = finishL(sb.L); BS.n.builds++; BS.n.buildMs = Math.round(nowMs() - sb.t0); IN.sb = null; } }
    if (IN.L && d > R_DROP && !CU.on) disposeL();
  }

  // ───────────────────────── people: Dusty at the counter (talk card), and a few mechanics who roam the floor (PLAN_ROAM) ─────────────────────────
  var STAFF = BS.staff = BS.staff || { list: [] };
  function buildStaff() {
    var ST = C("staff", null); if (!ST || typeof avatar !== "function" || STAFF.done) return; var near = lotDist(player.position.x, player.position.z) < 150; if (!near) return; STAFF.done = true;
    Object.keys(ST).forEach(function (id) { var A = ST[id]; if (CAST.some(function (c) { return c.id === id; })) return; var at = A.at || [20.5, -1.7], w = l2w(at[0], at[1]);
      var g = avatar("bs_" + id, A.name, A.look || {}, A.hat || null, A.outfit || null); g.position.set(w[0], SITE.G + 0.02, w[1]); g.rotation.y = A.face || 0; try { g.userData.label.scale.set(1.7, 0.43, 1); } catch (e) {} scene.add(g);
      var talk = (A.talk || []).map(function (q) { return { t: q.t, o: q.o }; }); var c = { id: id, name: A.name, role: A.role, pos: [w[0], w[1]], look: A.look, hat: null, outfit: null, greet: A.greet || ["Welcome."], talk: talk, kw: [], g: g, rot: g.rotation.y };
      CAST.push(c); var hs = { x: w[0], z: w[1], r: 3.2, t: c.name, k: c.role + " · press E to talk", p: talk[0] ? talk[0].t : "", play: "npc:" + c.id }; hotspots.push(hs); (BS.hsList = BS.hsList || []).push(hs); STAFF.list.push(c); BS.n.staff = STAFF.list.length; }); }
  function staffFrame(dt) { var cam = camera.position; STAFF.list.forEach(function (c) { var dd = Math.hypot(c.g.position.x - cam.x, c.g.position.z - cam.z); c.g.visible = dd < 70 && (!!IN.L) && (BS.zone === "in" || dd < 40); if (c.g.visible && (FRAME_N & 1) === 0) try { animateWalk(c.g, 0, dt * 2); } catch (e) {} }); }
  // the roaming crew: three to five of the client's rigged people at the lifts, the booth, the wrap table, the walls, the lounge
  function roamArea() {
    var RO = window.PLAN_ROAM; if (!RO || !RO.area || RO.off || BS.roamArea) return; var S = SITE, RC = C("roam", {}), iw = S.hw - S.wallT - 0.6, id = S.hd - S.wallT - 0.6;
    var P = function (u, v, kind, line, face, tag, dur) { var w = l2w(u, v); return { kind: kind, line: line, x: w[0], z: w[1], face: face, tag: tag, dur: dur }; };
    var def = { id: "bodyshop", max: 5, box: [S.cx - S.hw - 2, S.fc[1] - 2, S.cx + S.hw + 2, S.cz + S.hd + 2], perCat: true, pull: 3,
      people: (RC.people || []).slice(), lines: RC.lines || {},
      ready: function () { return !!BS.ready && IN.solidsDone; },
      levels: [{ base: function (x, z) { return inLot(x, z, 0.5) ? SITE.G + 0.02 : planGroundAt(x, z); }, exact: true, block: function (x, z) { var q = w2l(x, z); if (!inLot(x, z, 0.5)) return true; var tq = Math.hypot(q[0] - S.rev[0], q[1] - S.rev[1]); if (tq < 3.7) return true; return false; } }],
      entries: function () { var a = l2w(-3, -S.hd - 3), b = l2w(3, -S.hd - 3); return [{ x: a[0], z: a[1], face: PI, tag: "door" }, { x: b[0], z: b[1], face: PI, tag: "door" }]; },
      seeds: function () { return def.entries().concat([P(0, 2.5), P(-15, 2.5), P(15, 2.5)]); },
      pois: function () { var out = [];
        S.bays.forEach(function (b, i) { out.push(P(b[0] - 1.2, b[1] - 1.6, "look", "bays", -PI / 2 + 0.6, "bay" + i, [10, 22])); out.push(P(b[0] + 1.3, b[1] + 1.8, "look", "bays", PI / 2 + 0.4, "bay" + i, [10, 22])); });
        [-19.25, -11.75, -4.4].forEach(function (u) { out.push(P(u, S.hd - 1.8, "look", "bays", PI, "chest", [6, 12])); });
        out.push(P(7.0, 4.4, "look", "booth", PI, "booth", [8, 16])); out.push(P(3.0, 4.3, "look", "booth", PI - 0.3, "booth", [8, 16]));
        out.push(P(19.6, 6.0, "browse", "wrap", 0, "wrap", [10, 20])); out.push(P(22.6, 6.1, "browse", "wrap", 0, "wrap", [10, 20])); out.push(P(iw - 1.0, 10.5, "look", "wrap", PI / 2, "rolls", [6, 12]));
        out.push(P(-iw + 1.4, -10.5, "look", "parts", -PI / 2, "wheels", [6, 12])); out.push(P(-iw + 1.4, -4.0, "look", "parts", -PI / 2, "wheels", [6, 12])); out.push(P(iw - 1.3, -12.0, "look", "parts", PI / 2, "parts", [6, 12])); out.push(P(iw - 1.3, -7.5, "look", "parts", PI / 2, "parts", [6, 12]));
        out.push(P(S.show[0] + 3.2, S.show[1] + 1.4, "look", "show", -PI / 2 - 0.4, "show", [8, 14])); out.push(P(-4.8, -12.5, "look", "show", 0.8, "reveal", [8, 14]));
        out.push(P(-6, 3.0, "chat", "bays", 0, "aisle", [12, 24])); out.push(P(10.5, 2.4, "chat", "lounge", 0, "aisle", [12, 24]));
        var f = S.fc; [[(S.fc[0] + S.fc[2]) / 2 - S.cx + 2, -S.hd - 12], [-11, -S.hd - 16]].forEach(function (q) { out.push(P(q[0], q[1], "look", "show", 0, "fore", [8, 14])); });
        return out; },
      seatInfo: function (s) { if (s.tag !== "bodyshop") return null; return { kind: "sit", line: "lounge", tag: "sofa" }; },
      weight: function (p, h) { var k = p.kind, t = p.tag || ""; if (h < 7 || h > 21) return k === "sit" ? 0.3 : 0.15; if (t.indexOf("bay") === 0) return 2.2; if (t === "booth" || t === "wrap") return 1.6; if (k === "sit") return 0.7; if (t === "fore") return 0.6; return 1.0; },
      count: function (h) { return h < 7 || h > 21 ? 2 : h > 10 && h < 18 ? 5 : 4; },
      dur: { sit: [25, 60], chat: [14, 30], look: [8, 18], browse: [10, 20] },
      visible: function (c) { var p = c.g.position; if (!IN.L) return !inShop(p.x, p.y + 1, p.z); return true; },
      sameZone: function (c) { var p = c.g.position, a = inShop(p.x, p.y + 1, p.z), b = BS.zone === "in"; return a === b; } };
    BS.roamArea = RO.area(def); }

  // ───────────────────────── the Customizer: your cart (or bike) on the turntable, studio-lit, a live preview, the total, Buy and apply ─────────────────────────
  // The vehicle on the turntable is your own avatar's: a preview material (uniforms changed in place, no new material per click) and
  // the cached wheel and accessory meshes, so a change shows the same frame. The look you leave with is what the room stores.
  var PV = BS.pv = BS.pv || { on: false, cart: null, bike: null, mat: null, bmat: null };
  var CU = BS.cu = BS.cu || { on: false, mode: "cart", cat: "paint", ang: 0.7, pitch: 0.18, zoom: 0.45, zoomT: 0.45, drag: false, lx: 0, ly: 0, hist: [], built: false, pending: null, reveal: null, fr: null };
  var CART_CATS = [["paint", "Paint"], ["roof", "Roof"], ["seats", "Seats"], ["wheels", "Wheels"], ["stance", "Stance"], ["badges", "Emblems"], ["graphics", "Decals"], ["extras", "Extras"], ["horn", "Horn"]];
  var BIKE_CATS = [["bframe", "Frame"], ["bwheels", "Wheels"], ["bseat", "Grips, seat"], ["bextras", "Basket, decals"]];
  var THUMBS = { url: "/tex/bs_thumbs.jpg", cols: 8, rows: 4, ok: null };
  function thumbOk() { if (THUMBS.ok !== null) return THUMBS.ok; THUMBS.ok = false; var im = new Image(); im.onload = function () { THUMBS.ok = true; if (CU.on) renderPanel(); }; im.src = au(THUMBS.url + "?v=" + (window.BUILD || "dev")); return false; }
  function thumbCss(row, col) { return "background-image:url(" + au(THUMBS.url + "?v=" + (window.BUILD || "dev")) + ");background-size:" + (THUMBS.cols * 100) + "% " + (THUMBS.rows * 100) + "%;background-position:" + (col / (THUMBS.cols - 1) * 100) + "% " + (row / (THUMBS.rows - 1) * 100) + "%"; }
  function atlasCss(x, y, w, h) { var u = au(lowTier() ? "/tex/bs_decals_m.png" : "/tex/bs_decals.png"); return "background-image:url(" + u + ");background-size:" + (2048 / w * 100) + "% " + (2048 / h * 100) + "%;background-position:" + (x / (2048 - w) * 100) + "% " + (y / (2048 - h) * 100) + "%"; }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function css() {
    if ($id("bsc-css")) return; var s = el("style"); s.id = "bsc-css";
    s.textContent = [
      "#bsc{position:fixed;inset:0;z-index:60;pointer-events:none;display:none;font-family:'Space Grotesk',system-ui,sans-serif;color:var(--cream,#f5f1e6)}#bsc.on{display:block}",
      "body.bsc-on .hud,body.bsc-on #mm,body.bsc-on #compass,body.bsc-on #hint,body.bsc-on #radio,body.bsc-on #log,body.bsc-on #prompt,body.bsc-on div:has(> #p2streamt){display:none!important}",
      "#bsc .bsc-rail,#bsc .bsc-panel,#bsc .bsc-bar,#bsc .bsc-top,#bsc .bsc-zoom,#bsc .bsc-msg{pointer-events:auto}",
      ".bsc-top{position:absolute;left:24px;top:20px}.bsc-top .k{font:600 10px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.2em;color:#e0642a;text-transform:uppercase;margin-bottom:6px}.bsc-top h2{margin:0;font:400 34px Anton,Impact,sans-serif;letter-spacing:.05em;text-shadow:0 2px 18px rgba(0,0,0,.5)}",
      ".bsc-rail{position:absolute;left:24px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:5px;padding:8px;background:var(--glass,rgba(10,22,16,.72));border:1px solid var(--line2,rgba(245,241,230,.12));border-radius:14px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}",
      ".bsc-mode{display:flex;gap:4px;margin-bottom:4px}.bsc-mode button{flex:1;padding:8px 6px;border-radius:9px;border:1px solid var(--line2,rgba(245,241,230,.12));background:transparent;color:var(--dim,#9aa59c);cursor:pointer;font:600 10px 'JetBrains Mono',monospace;letter-spacing:.14em;text-transform:uppercase}.bsc-mode button.on{color:#e0642a;border-color:#e0642a;background:rgba(224,100,42,.12)}",
      ".bsc-cat{display:flex;align-items:center;gap:10px;min-width:168px;padding:9px 12px;border-radius:10px;border:1px solid transparent;background:transparent;color:var(--dim,#9aa59c);cursor:pointer;font:600 11px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;text-align:left;transition:all .15s}",
      ".bsc-cat i{font-style:normal;display:inline-grid;place-items:center;width:22px;height:22px;border-radius:6px;border:1px solid var(--line2,rgba(245,241,230,.12));font-size:10px;color:var(--cream,#f5f1e6)}.bsc-cat:hover{color:var(--cream,#f5f1e6);background:rgba(245,241,230,.05)}.bsc-cat.on{color:#e0642a;border-color:#e0642a;background:rgba(224,100,42,.12)}.bsc-cat.on i{border-color:#e0642a;color:#e0642a}",
      ".bsc-panel{position:absolute;right:24px;top:20px;bottom:92px;width:min(440px,40vw);display:flex;flex-direction:column;background:rgba(14,10,8,.86);border:1px solid rgba(224,100,42,.35);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);overflow:hidden}",
      ".bsc-panel::before,.bsc-panel::after{content:'';position:absolute;width:14px;height:14px;pointer-events:none}.bsc-panel::before{left:-1px;top:-1px;border-top:2px solid #e0642a;border-left:2px solid #e0642a;border-top-left-radius:4px}.bsc-panel::after{right:-1px;bottom:-1px;border-bottom:2px solid #e0642a;border-right:2px solid #e0642a;border-bottom-right-radius:4px}",
      ".bsc-ph{padding:18px 20px 10px;border-bottom:1px solid var(--line2,rgba(245,241,230,.12))}.bsc-ph h3{margin:0;font:400 24px Anton,Impact,sans-serif;letter-spacing:.05em}.bsc-ph .s{color:var(--dim,#9aa59c);font-size:12px;margin-top:4px;line-height:1.45}",
      ".bsc-body{flex:1;overflow-y:auto;padding:12px 20px 18px;scrollbar-width:thin;scrollbar-color:rgba(224,100,42,.45) transparent}",
      ".bsc-lab{margin:14px 0 8px;color:var(--dim,#9aa59c);font:600 9.5px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase}.bsc-lab:first-child{margin-top:2px}.bsc-lab b{color:#e0642a;font-weight:600;margin-left:6px}",
      ".bsc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.bsc-grid.g4{grid-template-columns:repeat(4,1fr)}",
      ".bsc-tile{position:relative;padding:0;border-radius:12px;border:1px solid var(--line2,rgba(245,241,230,.12));background:rgba(245,241,230,.04);color:var(--cream,#f5f1e6);cursor:pointer;overflow:hidden;transition:transform .12s,border-color .12s,box-shadow .12s;text-align:left}",
      ".bsc-tile .im{display:grid;place-items:center;aspect-ratio:1/1;background:#14100d center/cover no-repeat;color:var(--dim,#9aa59c);font:600 20px 'Space Grotesk',sans-serif}.bsc-tile.wide .im{aspect-ratio:2/1}",
      ".bsc-tile span{display:block;padding:6px 8px 2px;font:600 11px 'Space Grotesk',system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bsc-tile em{display:block;padding:0 8px 7px;font:600 9px 'JetBrains Mono',monospace;letter-spacing:.08em;font-style:normal;color:var(--dim,#9aa59c)}.bsc-tile em.own{color:#4dde6f}.bsc-tile em.new{color:#f4cd5a}.bsc-tile em.lk{color:#ff9180}",
      ".bsc-tile:hover{transform:translateY(-2px);border-color:rgba(224,100,42,.6)}.bsc-tile.on{border-color:#e0642a;box-shadow:0 0 0 2px rgba(224,100,42,.35),0 8px 22px rgba(0,0,0,.35)}.bsc-tile.on span{color:#e0642a}.bsc-tile.lock .im{opacity:.45}.bsc-tile.lock::after{content:'LOCKED';position:absolute;left:7px;top:7px;padding:2px 6px;border-radius:4px;background:rgba(14,10,8,.85);color:#f4cd5a;font:600 8.5px 'JetBrains Mono',monospace;letter-spacing:.14em}",
      ".bsc-sw{display:flex;flex-wrap:wrap;gap:8px}.bsc-sw button{position:relative;width:34px;height:34px;border-radius:50%;border:2px solid rgba(255,255,255,.16);cursor:pointer;padding:0;transition:transform .12s,box-shadow .12s}.bsc-sw button:hover{transform:scale(1.1)}.bsc-sw button.on{border-color:#e0642a;box-shadow:0 0 0 2px rgba(224,100,42,.4),0 0 14px rgba(224,100,42,.35)}.bsc-sw button.lock{opacity:.4}.bsc-sw button.lock::after{content:'';position:absolute;inset:11px;border-radius:2px;background:#f4cd5a}.bsc-sw button.nw::before{content:'';position:absolute;right:-2px;top:-2px;width:9px;height:9px;border-radius:50%;background:#f4cd5a;border:1px solid #14100d}",
      ".bsc-tog{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--line2,rgba(245,241,230,.12));background:rgba(245,241,230,.04);color:var(--cream,#f5f1e6);cursor:pointer;width:100%;margin-bottom:7px;font:600 13px 'Space Grotesk',system-ui,sans-serif;text-align:left}.bsc-tog small{display:block;color:var(--dim,#9aa59c);font:500 11px 'Space Grotesk',sans-serif;margin-top:2px}.bsc-tog em{font-style:normal;font:600 10px 'JetBrains Mono',monospace;letter-spacing:.12em;color:var(--dim,#9aa59c);white-space:nowrap}.bsc-tog.on{border-color:#e0642a}.bsc-tog.on em{color:#e0642a}.bsc-tog.lock{opacity:.55}",
      ".bsc-in{width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--line2,rgba(245,241,230,.15));background:rgba(0,0,0,.35);color:var(--cream,#f5f1e6);font:600 15px 'Space Grotesk',sans-serif;letter-spacing:.06em;outline:none}.bsc-in:focus{border-color:#e0642a}.bsc-note{color:var(--dim,#9aa59c);font-size:11.5px;line-height:1.5;margin-top:10px}.bsc-err{color:#ff9180;font-size:12px;margin-top:6px;min-height:15px}",
      ".bsc-bar{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:8px;background:rgba(14,10,8,.82);border:1px solid rgba(224,100,42,.35);border-radius:999px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}",
      ".bsc-bar .btn{padding:10px 18px;border-radius:999px;white-space:nowrap}.bsc-bar .tot{padding:0 10px;font:600 11px 'JetBrains Mono',monospace;letter-spacing:.1em;white-space:nowrap;text-align:right}.bsc-bar .tot b{display:block;font:400 22px Anton,Impact,sans-serif;letter-spacing:.04em;color:#f4cd5a}.bsc-bar .tot small{color:var(--dim,#9aa59c)}.bsc-bar .hint{color:var(--dim,#9aa59c);font:600 9.5px 'JetBrains Mono',monospace;letter-spacing:.12em;white-space:nowrap}.bsc-bar .hint kbd{display:inline-block;padding:1px 6px;border:1px solid rgba(224,100,42,.5);background:rgba(224,100,42,.12);color:#e0642a;border-radius:4px;margin:0 2px}",
      ".bsc-bar .buy{background:#e0642a!important;color:#14100d!important;border-color:#e0642a!important}.bsc-bar .buy[disabled]{opacity:.45;cursor:not-allowed}",
      ".bsc-zoom{position:absolute;left:24px;bottom:20px;display:flex;gap:6px;padding:8px;background:var(--glass,rgba(10,22,16,.72));border:1px solid var(--line2,rgba(245,241,230,.12));border-radius:999px}.bsc-zoom button{width:70px;padding:9px 0;border-radius:999px;border:1px solid var(--line2,rgba(245,241,230,.12));background:transparent;color:var(--dim,#9aa59c);cursor:pointer;font:600 10px 'JetBrains Mono',monospace;letter-spacing:.14em;text-transform:uppercase}.bsc-zoom button.on{color:#e0642a;border-color:#e0642a}",
      ".bsc-msg{position:absolute;left:50%;bottom:84px;transform:translateX(-50%);max-width:560px;padding:9px 16px;border-radius:12px;background:rgba(14,10,8,.86);border:1px solid rgba(255,145,128,.5);color:#ffcfc6;font-size:12.5px;display:none;text-align:center}.bsc-msg.on{display:block}.bsc-msg.ok{border-color:rgba(77,222,111,.5);color:#c8f7d3}",
      "#bsc-rev{position:fixed;inset:0;z-index:61;pointer-events:none;display:grid;place-items:center;opacity:0;transition:opacity .5s}#bsc-rev.on{opacity:1}#bsc-rev div{text-align:center;transform:translateY(-18vh)}#bsc-rev h1{margin:0;font:400 min(9vw,96px) Anton,Impact,sans-serif;letter-spacing:.06em;color:#fff;text-shadow:0 0 30px rgba(255,138,42,.85),0 0 80px rgba(255,79,176,.55)}#bsc-rev p{margin:6px 0 0;font:600 13px 'JetBrains Mono',monospace;letter-spacing:.3em;color:#f4cd5a;text-transform:uppercase}",
      "@media (max-width:860px){.bsc-rail{top:auto;bottom:92px;transform:none;flex-direction:row;flex-wrap:wrap;max-width:calc(100vw - 48px)}.bsc-cat{min-width:0}.bsc-cat b{display:none}.bsc-panel{left:24px;right:24px;width:auto;top:auto;height:40vh;bottom:150px}.bsc-zoom{display:none}.bsc-top h2{font-size:24px}.bsc-bar .hint{display:none}}"
    ].join("\n"); document.head.appendChild(s); }
  function build() {
    if (CU.built) return true; css(); var C0 = el("div"); C0.id = "bsc"; document.body.appendChild(C0);
    C0.appendChild(el("div", "bsc-top", "<div class='k'>" + esc(C("names.shop", "Copper Canyon Customs")) + "</div><h2>" + esc(CP("title", "The Customizer")) + "</h2>"));
    var rail = el("div", "bsc-rail"); rail.id = "bsc-rail"; C0.appendChild(rail);
    var panel = el("div", "bsc-panel"); var ph = el("div", "bsc-ph"); ph.id = "bsc-ph"; var body = el("div", "bsc-body"); body.id = "bsc-body"; panel.appendChild(ph); panel.appendChild(body); C0.appendChild(panel);
    var zoom = el("div", "bsc-zoom"); [["Close", 0], ["Mid", 0.45], ["Wide", 1]].forEach(function (z) { var b = el("button", "", z[0]); b.dataset.z = z[1]; b.onclick = function () { CU.zoomT = z[1]; syncUI(); }; zoom.appendChild(b); }); C0.appendChild(zoom);
    var msg = el("div", "bsc-msg"); msg.id = "bsc-msg"; C0.appendChild(msg);
    var bar = el("div", "bsc-bar"); var undo = el("button", "btn ghost", esc(CP("undo", "Undo"))); undo.id = "bsc-undo"; undo.onclick = doUndo; var stock = el("button", "btn ghost", esc(CP("reset", "Stock"))); stock.onclick = doStock; stock.title = "Back to the stock look";
    var hint = el("div", "hint", "<kbd>Drag</kbd> turn <kbd>Wheel</kbd> zoom <kbd>1-9</kbd> category"); var tot = el("div", "tot"); tot.id = "bsc-tot"; var buy = el("button", "btn buy", esc(CP("buy", "Buy and apply"))); buy.id = "bsc-buy"; buy.onclick = doBuy; var done = el("button", "btn ghost", esc(CP("done", "Done"))); done.onclick = function () { closeCustom(true); };
    [undo, stock, hint, tot, buy, done].forEach(function (b) { bar.appendChild(b); }); C0.appendChild(bar);
    var rev = el("div"); rev.id = "bsc-rev"; rev.innerHTML = "<div><h1>" + esc(CP("reveal", "Your ride is ready")) + "</h1><p>" + esc(CP("revealSub", "Copper Canyon Customs")) + "</p></div>"; document.body.appendChild(rev);
    CU.built = true; return true; }
  function renderRail() { var R0 = $id("bsc-rail"); if (!R0) return; R0.innerHTML = ""; var md = el("div", "bsc-mode"); [["cart", "Cart"], ["bike", "Bike"]].forEach(function (m) { var b = el("button", CU.mode === m[0] ? "on" : "", m[1]); b.onclick = function () { setMode(m[0]); }; md.appendChild(b); }); R0.appendChild(md);
    (CU.mode === "cart" ? CART_CATS : BIKE_CATS).forEach(function (c, i) { var b = el("button", "bsc-cat" + (CU.cat === c[0] ? " on" : ""), "<i>" + (i + 1) + "</i><b>" + esc(c[1]) + "</b>"); b.dataset.c = c[0]; b.onclick = function () { setCat(c[0]); }; R0.appendChild(b); }); }
  function cur() { return CU.mode === "cart" ? CU.look : CU.bike; }
  function setMode(m) { if (m === CU.mode) return; if (m === "bike") { CU.mode = "bike"; CU.cat = "bframe"; vehicleFor("bike"); } else { CU.mode = "cart"; CU.cat = "paint"; vehicleFor("cart"); } CU.zoomT = m === "bike" ? 0.6 : 0.45; CU.ang = (CU.turn || 0) + (m === "bike" ? 1.35 : 0.75); renderRail(); renderPanel(); try { sfx("ui"); } catch (e) {} }
  function setCat(c) { CU.cat = c; CU.zoomT = { paint: 0.45, roof: 0.6, seats: 0.15, wheels: 0.2, stance: 0.8, badges: 0.3, graphics: 0.5, extras: 0.75, horn: 0.45, bframe: 0.6, bwheels: 0.5, bseat: 0.4, bextras: 0.55 }[c] || 0.45; renderRail(); renderPanel(); try { sfx("ui"); } catch (e) {} }
  // a change: remember the last look for Undo, apply the preview, refresh the total
  function setL(k, v) { var L = cur(); CU.hist.push([CU.mode, JSON.stringify(L || {})]); if (CU.hist.length > 60) CU.hist.shift(); if (v === 0 || v === null || v === undefined || v === "") delete L[k]; else L[k] = v; previewNow(); if (k === "t" || k === "sp" || k === "a" || k === "d" || k === "pl" || k === "lb") { if (k !== "pl" && k !== "lb") renderPanel(); else syncUI(); } else syncUI(); try { sfx("ui"); } catch (e) {} if (k === "h" && v) try { hornPlay(v, player.position.x, player.position.z); } catch (e) {} }
  function doUndo() { var h = CU.hist.pop(); if (!h) return; var L = JSON.parse(h[1]); if (h[0] === "cart") CU.look = L; else CU.bike = L; if (h[0] !== CU.mode) setMode(h[0]); previewNow(); renderPanel(); }
  function doStock() { CU.hist.push([CU.mode, JSON.stringify(cur() || {})]); if (CU.mode === "cart") CU.look = {}; else CU.bike = {}; previewNow(); renderPanel(); }
  function previewNow() { PV.cart = cleanLook(CU.look, CART_KEYS, true); PV.bike = cleanLook(CU.bike, BIKE_KEYS, false); try { if (CU.mode === "cart") dressPreviewCart(player.userData.cartG, PV.cart); else if (player.userData.bikeG) dressPreviewBike(player.userData.bikeG, PV.bike); } catch (e) { note("preview", e); } }
  // the preview material: one per mode, its uniforms rewritten on every change; text slots follow the plate and label
  function dressPreviewCart(g, look) {
    if (!g || !GEO.cart) return; var u = g.userData, base = baseMeshOf(g); if (!base) return; var L = look || {}; var custom = !!(L.w || L.ty === 3 || L.ty === 4);
    if (!PV.mat) { PV.mat = makeMat("cart", {}); PV.mat.userData.bsKey = null; } var U = PV.mat.userData.bsU, txt = { lab: null, plt: null };
    var keys = []; if (L.lb) { keys.push("L|" + L.lb); } if (L.pl) { keys.push("P|" + L.pl); } var old = PV.txt || []; keys.forEach(function (k) { if (old.indexOf(k) < 0) txtSlot(k); }); old.forEach(function (k) { if (keys.indexOf(k) < 0) txtRelease(k); }); PV.txt = keys;
    if (L.lb) txt.lab = TXT.slots["L|" + L.lb] ? TXT.slots["L|" + L.lb].r : null; if (L.pl) txt.plt = TXT.slots["P|" + L.pl] ? TXT.slots["P|" + L.pl].r : null; setU(U, L, "cart", txt);
    if (u.bsMat && u.bsMat !== PV.mat) matRelease(u.bsMat); u.bsMat = PV.mat; base.geometry = custom ? GEO.cart.body : GEO.cart.full; base.material = PV.mat;
    childMesh(g, "bsWheels", custom ? wheelGeo(L) : null, PV.mat); childMesh(g, "bsAcc", accGeo(L), PV.mat); childMesh(g, "bsGlow", (L.a || 0) & 2 ? glowGeo() : null, glowMat(L.u || 0));
    u.bsKey = "preview:" + lookKey(L); u.bsLift = L.l === 1 ? 0.15 : L.l === 2 ? -0.045 : 0; player.userData.bsSeatLift = u.bsLift; player.userData.bsCl = PV.cart; hideDecals(g, player); }
  function dressPreviewBike(g, look) {
    if (!g || !GEO.bike2) return; var u = g.userData; if (u.model !== "bike2") return; if (!PV.bmat) { PV.bmat = makeMat("bike", {}); PV.bmat.userData.bsKey = null; } setU(PV.bmat.userData.bsU, look || {}, "bike", null);
    var ms = u.bsMeshes; if (!ms) { ms = []; for (var i = 0; i < g.children.length; i++) { var c = g.children[i]; if (c.isMesh && !c.userData.bsPart) { c.userData.bsGeo0 = c.geometry; c.userData.bsMat0 = c.material; ms.push(c); } } u.bsMeshes = ms; }
    var body = ms.filter(function (m) { return m !== u.crank; })[0], G = GEO.bike2; if (body) { body.geometry = G.crank ? G.crank.body : G.full; body.material = PV.bmat; } if (u.crank && G.crank) { u.crank.geometry = G.crank.crank; u.crank.material = PV.bmat; }
    if (u.bsMat && u.bsMat !== PV.bmat) matRelease(u.bsMat); u.bsMat = PV.bmat; childMesh(g, "bsAcc", look && look.b ? bikeBasket() : null, PV.bmat); u.bsKey = "preview:" + lookKey(look || {}); player.userData.bsBl = PV.bike; player.userData.bsBikeG = g; }
  // put the player's own cart (or bike) on the turntable
  function vehicleFor(kind) {
    try { if (kind === "bike") { if (!(cartMode && RIDEV.kind !== "cart")) { if (cartMode) toggleCart(); mountBike(1); } var u = player.userData; if (u.bikeG && u.bikeG.userData.model !== "bike2") { var wasV = u.bikeG.visible; player.remove(u.bikeG); var nb = makeBikeModel(1); nb.traverse(function (q) { if (q.isMesh) q.castShadow = true; q.layers.mask = player.layers.mask; }); player.add(nb); u.bikeG = nb; nb.visible = wasV; } }
      else { if (cartMode && RIDEV.kind !== "cart") toggleCart(); if (!cartMode) toggleCart(); } } catch (e) { note("vehicle", e); }
    previewNow(); }
  function sw(list, val, onPick, keyFn, lockFn, newFn) { var w = el("div", "bsc-sw"); list.forEach(function (c, i) { var hex = c[1] === "match" ? null : c[1]; var lk = lockFn ? lockFn(i) : null; var b = el("button", (i === (val || 0) ? "on" : "") + (lk ? " lock" : "") + (!lk && newFn && newFn(i) ? " nw" : "")); b.style.background = hex ? "#" + hex : "conic-gradient(#e0642a,#2ab3b0,#f4cd5a,#e8508f,#e0642a)"; b.title = c[0] + (lk ? " · " + lk : newFn && newFn(i) ? " · new" : ""); b.onclick = function () { onPick(i); }; w.appendChild(b); }); return w; }
  function tag(id) { if (!id) return ["Free", "own"]; var pr = priceOf(id), rk = rankReq(id); if (owned(id)) return [CP("owned", "Owned"), "own"]; if (rk > myRank()) return [CP("rank", "Reach {rank} to unlock").replace("{rank}", RANK_NAMES[rk]), "lk"]; if (rk && !pr) return [CP("earned", "Earned at {rank}").replace("{rank}", RANK_NAMES[rk]), "own"]; return [pr + " GB", "new"]; }
  function lockOf(id) { if (!id || owned(id)) return null; var rk = rankReq(id); return rk > myRank() ? CP("rank", "Reach {rank} to unlock").replace("{rank}", RANK_NAMES[rk]) : null; }
  function tiles(items, sel, onPick, idFn, imFn, wide, cols4) { var g = el("div", "bsc-grid" + (cols4 ? " g4" : "")); items.forEach(function (it, i) { var id = idFn ? idFn(i) : null, tg = tag(i ? id : null), lk = i && lockOf(id); var b = el("button", "bsc-tile" + (i === (sel || 0) ? " on" : "") + (lk ? " lock" : "") + (wide ? " wide" : "")); var im = el("i", "im"); var st = imFn ? imFn(i) : null; if (st && st.css) im.setAttribute("style", st.css); else if (st && st.txt) im.textContent = st.txt; b.appendChild(im); b.appendChild(el("span", "", esc(it[0]))); b.appendChild(el("em", tg[1], esc(i === 0 && !id ? CP("free", "Free") : tg[0]))); b.title = it[0] + (it[1] && it[1].length > 6 ? " · " + it[1] : "") + (lk ? " · " + lk : ""); b.onclick = function () { onPick(i); }; g.appendChild(b); }); return g; }
  function lab(t, v) { return el("div", "bsc-lab", esc(t) + (v ? "<b>" + esc(v) + "</b>" : "")); }
  function thumb(row) { return function (i) { if (!thumbOk()) return { txt: "" + (i || "·") }; return { css: thumbCss(row, i) }; }; }
  function renderPanel() {
    var P = $id("bsc-body"), H = $id("bsc-ph"); if (!P) return; var c = CU.cat, L = cur() || {}; var cp = C("copy.cats." + c, [c, ""]); P.innerHTML = ""; H.innerHTML = "<h3>" + esc(cp[0]) + "</h3><div class='s'>" + esc(cp[1]) + "</div>";
    var paintLock = function (i) { if (i >= 24) return paintOk(i) ? null : "Earn it in your Sol Passport"; return i >= 10 ? lockOf("p" + i) : null; }, paintNew = function (i) { return i >= 10 && i < 24 && !owned("p" + i); };
    if (c === "paint") { var pp = CAT("paints"); P.appendChild(lab("Colour", (pp[L.p || 0] || [""])[0])); P.appendChild(sw(pp, L.p, function (i) { if (i >= 24 && !paintOk(i)) return msg("Earn this one in your Sol Passport (J).", false); setL("p", i); }, null, paintLock, paintNew));
      P.appendChild(lab("Finish")); P.appendChild(tiles(CAT("finishes"), L.f, function (i) { setL("f", i); }, function (i) { return "f" + i; }, function (i) { return { css: "background:" + ["linear-gradient(135deg,#fff 0,#e0642a 30%,#7a2e10 100%)", "linear-gradient(135deg,#b8643a,#a4572f)", "radial-gradient(circle at 30% 30%,#ffd2b0,#b8643a 45%,#3b1a0a)", "linear-gradient(135deg,#ffd6e8,#e0642a 40%,#8a7ad8 75%,#2ab3b0)", "linear-gradient(160deg,#fff,#9aa0a6 35%,#2a2c30 55%,#fff 75%,#6a7078)", "radial-gradient(circle at 40% 35%,#ff9a6a,#8e1b24 55%,#2a0508)"][i] }; }, false, true));
      P.appendChild(lab("Two-tone")); P.appendChild(tiles(CAT("split"), L.t, function (i) { setL("t", i); }, function (i) { return "t" + i; }, function (i) { var a = "#" + ((CAT("paints")[L.p || 0] || [0, "2a8a45"])[1]), b = "#" + ((CAT("paints")[L.p2 || 5] || [0, "f2f0ea"])[1]); return { css: "background:" + [a, "linear-gradient(180deg," + a + " 55%," + b + " 55%)", "linear-gradient(90deg," + a + " 60%," + b + " 60%)", "linear-gradient(90deg," + b + "," + a + ")", "linear-gradient(180deg," + a + " 40%," + b + " 40% 55%," + a + " 55%)"][i] }; }, false, false));
      if (L.t) { P.appendChild(lab("Second colour", (CAT("paints")[L.p2 || 0] || [""])[0])); P.appendChild(sw(CAT("paints"), L.p2, function (i) { if (i >= 24 && !paintOk(i)) return; setL("p2", i); }, null, paintLock, paintNew)); } }
    else if (c === "roof") { P.appendChild(lab("Canopy colour", (CAT("roofs")[L.r || 0] || [""])[0])); P.appendChild(sw(CAT("roofs"), L.r, function (i) { setL("r", i); }, null, function (i) { return i ? lockOf("r" + i) : null; }, function (i) { return i && !owned("r" + i); })); P.appendChild(lab("Canopy top")); P.appendChild(tiles(CAT("roofStyles"), L.rs, function (i) { setL("rs", i); }, function (i) { return "rs" + i; }, thumb(1))); P.appendChild(el("div", "bsc-note", "The roof struts take the canopy colour.")); }
    else if (c === "seats") { P.appendChild(lab("Upholstery", (CAT("seats")[L.s || 0] || [""])[0])); P.appendChild(sw(CAT("seats"), L.s, function (i) { setL("s", i); }, null, function (i) { return i ? lockOf("s" + i) : null; }, function (i) { return i && !owned("s" + i); })); P.appendChild(lab("Pattern")); P.appendChild(tiles(CAT("seatStyles"), L.sp, function (i) { setL("sp", i); }, function (i) { return "sp" + i; }, thumb(2))); if (L.sp === 3 || L.sp === 4 || L.sp === 5) { P.appendChild(lab("Second colour")); P.appendChild(sw(CAT("seats"), L.s2, function (i) { setL("s2", i); }, null, function (i) { return i ? lockOf("s" + i) : null; })); } }
    else if (c === "wheels") { P.appendChild(lab("Rims")); P.appendChild(tiles(CAT("rims"), L.w, function (i) { setL("w", i); }, function (i) { return "w" + i; }, thumb(0), false, true)); P.appendChild(lab("Rim finish", (CAT("rimColors")[L.wc || 0] || [""])[0])); P.appendChild(sw(CAT("rimColors"), L.wc, function (i) { setL("wc", i); }, null, function (i) { return i ? lockOf("wc" + i) : null; }, function (i) { return i && !owned("wc" + i); })); P.appendChild(lab("Tyres")); P.appendChild(tiles(CAT("tyres"), L.ty, function (i) { setL("ty", i); }, function (i) { return "ty" + i; }, function (i) { return thumbOk() ? { css: thumbCss(3, i) } : { txt: "" + i }; })); }
    else if (c === "stance") { P.appendChild(tiles(CAT("stance"), L.l, function (i) { setL("l", i); }, function (i) { return "l" + i; }, function (i) { return thumbOk() ? { css: thumbCss(3, 5 + i) } : { txt: ["=", "^", "v"][i] }; })); P.appendChild(el("div", "bsc-note", "A lift kit adds springs, spacers and taller tyres; lowered drops the body close to the ground.")); }
    else if (c === "badges") { P.appendChild(tiles(CAT("emblems"), L.e, function (i) { setL("e", i); }, function (i) { return "e" + i; }, function (i) { return i ? { css: atlasCss((i - 1) * 256, 1364, 256, 256) } : { txt: "None" }; })); P.appendChild(el("div", "bsc-note", "On the nose and on both sides of the front cowl.")); }
    else if (c === "graphics") { P.appendChild(lab("Decal or wrap")); var wraps = [null, null, null, [0, 0], [1024, 0], [0, 341], [1024, 341], [0, 682], [1024, 682], [0, 1023], [1024, 1023]];
      P.appendChild(tiles(CAT("decals"), L.d, function (i) { setL("d", i); }, function (i) { return "d" + i; }, function (i) { var w = wraps[i]; if (w) return { css: atlasCss(w[0], w[1], 1024, 341) + ";background-color:#3a2a20" }; return { txt: ["None", "| |", "~"][i] }; }, true));
      P.appendChild(lab("Decal colour", (CAT("decalColors")[L.dc || 0] || [""])[0])); P.appendChild(sw(CAT("decalColors"), L.dc, function (i) { setL("dc", i); }));
      P.appendChild(lab("Number plate", L.pl ? tag("pl")[0] : priceOf("pl") + " GB")); var ip = el("input", "bsc-in"); ip.maxLength = 7; ip.placeholder = "YOUR PLATE"; ip.value = L.pl || ""; var e1 = el("div", "bsc-err"); ip.oninput = function () { var v = plateText(ip.value); if (ip.value !== v && ip.value.toUpperCase() !== v) ip.value = v; if (v && rude(v)) { e1.textContent = CP("rude", "Please pick a friendlier word."); return; } e1.textContent = ""; clearTimeout(CU.tP); CU.tP = setTimeout(function () { setL("pl", v || null); }, 250); }; P.appendChild(ip); P.appendChild(e1);
      P.appendChild(lab("Side label", L.lb ? tag("lb")[0] : priceOf("lb") + " GB")); var il = el("input", "bsc-in"); il.maxLength = 14; il.placeholder = "Name or number"; il.value = L.lb || ""; var e2 = el("div", "bsc-err"); il.oninput = function () { var v = labelText(il.value); if (v && rude(v)) { e2.textContent = CP("rude", "Please pick a friendlier word."); return; } e2.textContent = ""; clearTimeout(CU.tL); CU.tL = setTimeout(function () { setL("lb", v || null); }, 250); }; P.appendChild(il); P.appendChild(e2); P.appendChild(el("div", "bsc-note", esc(CP("plateHint", "")) + ". " + esc(CP("labelHint", "")) + ".")); }
    else if (c === "extras") { CAT("accessories").forEach(function (A, b) { var id = "a" + b, on = !!((L.a || 0) & (1 << b)), lk = lockOf(id), tg = tag(id); var t = el("button", "bsc-tog" + (on ? " on" : "") + (lk ? " lock" : ""), "<div>" + esc(A[0]) + "<small>" + esc(A[1]) + "</small></div><em>" + (on ? "ON · " : "") + esc(tg[0]) + "</em>"); t.onclick = function () { setL("a", ((L.a || 0) ^ (1 << b)) || null); renderPanel(); }; P.appendChild(t); });
      if ((L.a || 0) & 2) { P.appendChild(lab("Underglow colour")); P.appendChild(sw(CAT("glow"), L.u, function (i) { setL("u", i); })); } if ((L.a || 0) & 32) { P.appendChild(lab("Flag")); P.appendChild(tiles(CAT("flags"), L.fl, function (i) { setL("fl", i); }, null, function (i) { return { css: atlasCss(i * 256, 1620, 256, 128) }; }, true, true)); } }
    else if (c === "horn") { P.appendChild(tiles(CAT("horns"), L.h, function (i) { setL("h", i); }, function (i) { return "h" + i; }, function (i) { return { txt: ["♪", "♫", "♬", "♩", "♪♪"][i] }; })); P.appendChild(el("div", "bsc-note", "Click to hear it. Press H while you drive.")); }
    else if (c === "bframe") { var bp = CAT("bikePaint"), bl = function (i) { return i > 1 ? lockOf("bf" + i) : null; }, bn = function (i) { return i > 1 && !owned("bf" + i); }; P.appendChild(lab("Frame", (bp[L.f || 0] || [""])[0])); P.appendChild(sw(bp, L.f, function (i) { setL("f", i); }, null, bl, bn)); P.appendChild(lab("Fenders", (bp[L.fe === undefined ? 1 : L.fe] || [""])[0])); P.appendChild(sw(bp, L.fe === undefined ? 1 : L.fe, function (i) { setL("fe", i === 1 ? null : i); }, null, bl, bn)); }
    else if (c === "bwheels") { P.appendChild(lab("Rims", (CAT("bikeRims")[L.w || 0] || [""])[0])); P.appendChild(sw(CAT("bikeRims"), L.w, function (i) { setL("w", i); }, null, function (i) { return i ? lockOf("bw" + i) : null; }, function (i) { return i && !owned("bw" + i); })); P.appendChild(lab("Tyre walls")); P.appendChild(tiles(CAT("bikeTyres"), L.t, function (i) { setL("t", i); }, function (i) { return "bt" + i; }, function (i) { return { css: "background:radial-gradient(circle,#14100d 34%," + ["#111", "#f2f0ea", "#e0d4b4"][i] + " 35% 52%,#111 53% 70%,transparent 71%)" }; })); }
    else if (c === "bseat") { P.appendChild(lab("Grips", (CAT("bikeGrips")[L.g || 0] || [""])[0])); P.appendChild(sw(CAT("bikeGrips"), L.g, function (i) { setL("g", i); }, null, function (i) { return i ? lockOf("bg" + i) : null; }, function (i) { return i && !owned("bg" + i); })); P.appendChild(lab("Saddle", (CAT("bikeSeats")[L.s || 0] || [""])[0])); P.appendChild(sw(CAT("bikeSeats"), L.s, function (i) { setL("s", i); }, null, function (i) { return i ? lockOf("bs" + i) : null; }, function (i) { return i && !owned("bs" + i); })); }
    else if (c === "bextras") { var on = !!L.b, tb = tag("bb"); var t2 = el("button", "bsc-tog" + (on ? " on" : ""), "<div>Front basket<small>Woven, on the handlebar</small></div><em>" + (on ? "ON · " : "") + esc(tb[0]) + "</em>"); t2.onclick = function () { setL("b", on ? null : 1); renderPanel(); }; P.appendChild(t2); P.appendChild(lab("Frame decals")); P.appendChild(tiles(CAT("bikeDecals"), L.d, function (i) { setL("d", i); }, function (i) { return "bd" + i; }, function (i) { var w = [null, [0, 0], null, [0, 341], [0, 1023]][i]; return w ? { css: atlasCss(w[0], w[1], 1024, 341) + ";background-color:#3a2a20" } : { txt: ["None", "", "~"][i] }; }, true)); P.appendChild(lab("Decal colour")); P.appendChild(sw(CAT("decalColors"), L.dc, function (i) { setL("dc", i); })); }
    syncUI(); }
  function msg(t, ok) { var m = $id("bsc-msg"); if (!m) return; m.textContent = t || ""; m.classList.toggle("on", !!t); m.classList.toggle("ok", !!ok); clearTimeout(CU.mT); if (t) CU.mT = setTimeout(function () { m.classList.remove("on"); }, 4200); }
  function syncUI() { var q = quote(cleanLook(CU.look, CART_KEYS, true), cleanLook(CU.bike, BIKE_KEYS, false)), t = $id("bsc-tot"), b = $id("bsc-buy"); var changed = lookKey(cleanLook(CU.look, CART_KEYS, true)) !== lookKey(CU.saved) || lookKey(cleanLook(CU.bike, BIKE_KEYS, false)) !== lookKey(CU.savedB);
    if (t) t.innerHTML = "<small>" + (q.need.length ? q.need.length + " new" : "Total") + "</small><b>" + q.cost + " GB</b><small>Balance " + coins() + "</small>";
    if (b) { b.disabled = !changed || !q.ok || !!CU.pending; b.textContent = CU.pending ? "Applying" : q.cost ? CP("buy", "Buy and apply") : CP("apply", "Apply"); b.title = q.locked.length ? CP("locked", "") : q.cost > coins() ? CP("poor", "") : ""; }
    var u = $id("bsc-undo"); if (u) u.disabled = !CU.hist.length;
    document.querySelectorAll("#bsc .bsc-zoom button").forEach(function (z) { z.classList.toggle("on", Math.abs(+z.dataset.z - CU.zoomT) < 0.05); }); }
  function doBuy() {
    var cl = cleanLook(CU.look, CART_KEYS, true), bl = cleanLook(CU.bike, BIKE_KEYS, false), q = quote(cl, bl); if (q.locked.length) return msg(CP("locked", ""), false); if (q.cost > coins()) return msg(CP("poor", ""), false);
    if (cl && ((cl.pl && rude(cl.pl)) || (cl.lb && rude(cl.lb)))) return msg(CP("rude", ""), false);
    if (!view || view.bsv !== 1) return msg("The shop's register is offline for a moment. Try again shortly.", false);
    var act0 = { t: "bodyshop" }; if (lookKey(cl) !== lookKey(CU.saved)) act0.cart = cl; if (lookKey(bl) !== lookKey(CU.savedB)) act0.bike = bl; if (act0.cart === undefined && act0.bike === undefined) return;
    CU.pending = { at: nowMs(), cart: act0.cart !== undefined ? lookKey(cl) : null, bike: act0.bike !== undefined ? lookKey(bl) : null, cost: q.cost, first: !(me() && me().cl) && !!cl, firstBike: !(me() && me().bl) && !!bl }; act(act0); try { sfx("buy"); } catch (e) {} syncUI(); }
  function pendingFrame() { var P = CU.pending; if (!P) return; var m = me(); if (!m) return; var okC = P.cart === null || lookKey(m.cl || null) === P.cart, okB = P.bike === null || lookKey(m.bl || null) === P.bike;
    if (okC && okB) { CU.pending = null; CU.saved = m.cl || null; CU.savedB = m.bl || null; CU.hist = []; msg(CP("saved", "Applied."), true); startReveal(P.first); if (P.first) stamp(C("progress.first", "p_bs_first")); if (P.firstBike || (P.bike !== null && P.bike)) stamp(C("progress.bike", "p_bs_bike")); var nA = 0; for (var b = 0; b < 11; b++) if (((m.cl && m.cl.a) || 0) & (1 << b)) nA++; if (nA >= 5) stamp(C("progress.loaded", "p_bs_loaded")); renderPanel(); BS.n.bought = (BS.n.bought || 0) + 1; return; }
    if (nowMs() - P.at > 4000) { CU.pending = null; msg("The register said no. Check your coins and rank, then try again.", false); syncUI(); } }
  // the reveal: the room goes dark, the turntable spins up, the ring's spots hit the cart, confetti, the title
  var RV = BS.rv = BS.rv || { t0: 0, on: false, conf: null };
  function startReveal(big) { RV.on = true; RV.t0 = nowMs(); RV.big = !!big; var r = $id("bsc-rev"); if (r) { r.classList.add("on"); setTimeout(function () { r.classList.remove("on"); }, big ? 3800 : 2400); } try { sfx("rank"); } catch (e) {} confetti(big ? 420 : 200); }
  // confetti: one mesh of 420 small quads on the shop's glow material, moved on the CPU (no instancing, so no new program at the reveal)
  function confetti(n) { try { var S = SITE, w = l2w(S.rev[0], S.rev[1]), N = 420; if (!RV.conf) { var P = new Float32Array(N * 12), Cc = new Float32Array(N * 12), I = []; var cols = [0xe0642a, 0x2ab3b0, 0xf4cd5a, 0xe8508f, 0x4dde6f, 0xffffff, 0xa050ff]; for (var i = 0; i < N; i++) { var c = new THREE.Color(cols[i % cols.length]); for (var k = 0; k < 4; k++) { Cc[i * 12 + k * 3] = c.r; Cc[i * 12 + k * 3 + 1] = c.g; Cc[i * 12 + k * 3 + 2] = c.b; } var o = i * 4; I.push(o, o + 1, o + 2, o, o + 2, o + 3, o, o + 2, o + 1, o, o + 3, o + 2); }
        var g = new THREE.BufferGeometry(); var pa = new THREE.BufferAttribute(P, 3); pa.setUsage(THREE.DynamicDrawUsage); g.setAttribute("position", pa); g.setAttribute("color", new THREE.BufferAttribute(Cc, 3)); g.setIndex(I); var me = new THREE.Mesh(g, mats().glow); me.frustumCulled = false; me.name = "bs confetti"; RV.conf = { me: me, pa: pa, p: [] }; }
      var C1 = RV.conf; C1.p = []; for (var k2 = 0; k2 < n; k2++) { var a = Math.random() * TAU, sp = 2 + Math.random() * 5; C1.p.push({ x: w[0] + Math.cos(a) * 0.8, y: S.G + 1.2, z: w[1] + Math.sin(a) * 0.8, vx: Math.cos(a) * sp * 0.5, vy: 5 + Math.random() * 6, vz: Math.sin(a) * sp * 0.5, r: Math.random() * TAU, rv: (Math.random() - 0.5) * 12 }); } C1.me.geometry.setDrawRange(0, n * 12); if (!C1.me.parent) scene.add(C1.me); C1.t0 = nowMs(); } catch (e) { note("confetti", e); } }
  var _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _ce = new THREE.Euler(), _cv = new THREE.Vector3(), _cs = new THREE.Vector3(1, 1, 1);
  function revealFrame(dt) { var C1 = RV.conf; if (C1 && C1.me.parent) { var age = (nowMs() - C1.t0) / 1000; if (age > 7) { scene.remove(C1.me); } else { var A = C1.pa.array; for (var i = 0; i < C1.p.length; i++) { var p = C1.p[i]; p.vy -= 5.5 * dt; p.vx *= 1 - dt * 0.6; p.vz *= 1 - dt * 0.6; if (p.vy < -1.4) p.vy = -1.4; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.r += p.rv * dt; if (p.y < SITE.G + 0.02) { p.y = SITE.G + 0.02; p.vy = 0; p.vx = p.vz = 0; p.rv = 0; }
      var cr = Math.cos(p.r), sr = Math.sin(p.r), c7 = Math.cos(p.r * 0.7), ax = cr * 0.035, ay = sr * 0.02, az = sr * 0.035, bx = -sr * 0.03 * c7, by = 0.055 * c7, bz = cr * 0.03, o = i * 12; A[o] = p.x - ax - bx; A[o + 1] = p.y - ay - by; A[o + 2] = p.z - az - bz; A[o + 3] = p.x + ax - bx; A[o + 4] = p.y + ay - by; A[o + 5] = p.z + az - bz; A[o + 6] = p.x + ax + bx; A[o + 7] = p.y + ay + by; A[o + 8] = p.z + az + bz; A[o + 9] = p.x - ax + bx; A[o + 10] = p.y - ay + by; A[o + 11] = p.z - az + bz; } C1.pa.needsUpdate = true; } }
    if (RV.on && nowMs() - RV.t0 > 4500) RV.on = false; }
  function revealK() { if (!RV.on) return 0; var t = (nowMs() - RV.t0) / 1000; return t < 0.5 ? t / 0.5 : t < 3.2 ? 1 : Math.max(0, 1 - (t - 3.2) / 1.3); }
  // open and close
  function openCustom() {
    if (CU.on || !SITE || !GEO.cart) return false; if (!build()) return false; var m = me(); CU.saved = m && m.cl ? m.cl : null; CU.savedB = m && m.bl ? m.bl : null;
    CU.look = Object.assign({}, CU.saved || {}); CU.bike = Object.assign({}, CU.savedB || {}); CU.hist = []; CU.wasCart = cartMode; CU.wasKind = RIDEV.kind; CU.mode = cartMode && RIDEV.kind !== "cart" ? "bike" : "cart"; CU.cat = CU.mode === "cart" ? "paint" : "bframe";
    CU.on = true; PV.on = true; CU.ang = (CU.turn || 0) + (CU.mode === "bike" ? 1.35 : 0.75); CU.pitch = 0.16; CU.zoom = CU.zoomT = 0.45; CU.camInit = false; CU.fr = null; try { for (var k in keys) keys[k] = false; } catch (e) {} if (document.exitPointerLock) document.exitPointerLock();
    vehicleFor(CU.mode); segStart("bike2"); $id("bsc").classList.add("on"); document.body.classList.add("bsc-on"); renderRail(); renderPanel(); thumbOk(); prebuild(); stamp(C("progress.shop", "p_bs_shop")); BS.n.opened = (BS.n.opened || 0) + 1; return true; }
  function closeCustom() { if (!CU.on) return; CU.on = false; PV.on = false; var C0 = $id("bsc"); if (C0) C0.classList.remove("on"); document.body.classList.remove("bsc-on");
    // what the room has is what you wear; the preview material goes back to the per-look cache
    try { var u = player.userData; u.bsCl = undefined; u.bsBl = undefined; if (u.cartG) { u.cartG.userData.bsKey = "x"; u.cartG.userData.bsMat = null; } if (u.bikeG) { u.bikeG.userData.bsKey = "x"; u.bikeG.userData.bsMat = null; } (PV.txt || []).forEach(txtRelease); PV.txt = []; } catch (e) {}
    try { if (player.userData.label) player.userData.label.visible = typeof FPV !== "undefined" ? !FPV : true; } catch (e) {}
    try { if (!CU.wasCart && cartMode) toggleCart(); else if (CU.wasCart && CU.wasKind === "cart" && RIDEV.kind !== "cart") { toggleCart(); toggleCart(); } } catch (e) {} BS.zoneHold = nowMs(); }
  // prepare every rim and tyre the screen can show, a few a frame, so a click never builds
  function prebuild() { CU.pre = []; for (var w = 0; w < 8; w++) for (var t = 0; t < 5; t++) for (var l = 0; l < 2; l++) CU.pre.push({ w: w, ty: t, l: l }); }
  function prebuildFrame() { if (!CU.pre || !CU.pre.length) return; var t0 = nowMs(); while (CU.pre.length && nowMs() - t0 < 4) { var L = CU.pre.shift(); if (L.w || L.ty === 3 || L.ty === 4) wheelGeo(L); } if (!CU.pre.length) { for (var a = 0; a < 11; a++) accGeo({ a: 1 << a }); } }
  // input: drag to turn, wheel to zoom, keys for categories (the game never sees them while the screen is open)
  addEventListener("pointerdown", function (e) { if (!CU.on || e.target.tagName !== "CANVAS") return; CU.drag = true; CU.lx = e.clientX; CU.ly = e.clientY; }, true);
  addEventListener("pointermove", function (e) { if (!CU.on || !CU.drag) return; CU.ang -= (e.clientX - CU.lx) * 0.0085; CU.pitch = clamp(CU.pitch + (e.clientY - CU.ly) * 0.004, -0.05, 0.75); CU.lx = e.clientX; CU.ly = e.clientY; }, true);
  addEventListener("pointerup", function () { CU.drag = false; }, true);
  addEventListener("wheel", function (e) { if (!CU.on || e.target.tagName !== "CANVAS") return; CU.zoomT = clamp(CU.zoomT + (e.deltaY > 0 ? 0.12 : -0.12), 0, 1); syncUI(); e.preventDefault(); e.stopImmediatePropagation(); }, { capture: true, passive: false });
  addEventListener("keydown", function (e) { if (!CU.on) return; if (e.target && e.target.tagName === "INPUT" && e.target.type !== "range") { if (e.code === "Escape") { e.target.blur(); e.preventDefault(); } e.stopImmediatePropagation(); return; }
    var c = e.code, cats = CU.mode === "cart" ? CART_CATS : BIKE_CATS, dg = /^Digit([1-9])$/.exec(c); if (c === "Escape") closeCustom(); else if (dg && cats[+dg[1] - 1]) setCat(cats[+dg[1] - 1][0]); else if (c === "KeyQ") CU.ang += 0.25; else if (c === "KeyE") CU.ang -= 0.25; else if (c === "KeyW") CU.zoomT = clamp(CU.zoomT - 0.15, 0, 1); else if (c === "KeyS") CU.zoomT = clamp(CU.zoomT + 0.15, 0, 1); else if (c === "KeyZ" && (e.ctrlKey || e.metaKey)) doUndo(); else if (c === "Tab") { var i = cats.findIndex(function (x) { return x[0] === CU.cat; }); setCat(cats[(i + (e.shiftKey ? cats.length - 1 : 1)) % cats.length][0]); }
    e.stopImmediatePropagation(); e.preventDefault(); }, true);
  addEventListener("keyup", function (e) { if (CU.on) { e.stopImmediatePropagation(); } }, true);
  // the camera: a slow orbit round the turntable, framed left of the panel; the turntable turns the vehicle
  var _ct2 = new THREE.Vector3(), _cp2 = new THREE.Vector3();
  function customCamera(dt) {
    if (!CU.on) return false; var S = SITE, w = l2w(S.rev[0], S.rev[1]), z = (CU.zoom += (CU.zoomT - CU.zoom) * Math.min(1, dt * 6)); var bike = CU.mode === "bike";
    var ty = S.G + (bike ? 0.6 : 0.85) + (1 - z) * 0.05, dist = bike ? lerp(2.6, 5.6, z) : lerp(3.3, 8.2, z); if (!CU.drag) CU.ang += dt * 0.05; var a = CU.ang, pitch = CU.pitch;
    var fov = camera.fov, aspect = innerWidth / Math.max(1, innerHeight), tf = Math.tan(fov * PI / 360), now = nowMs(); if (!CU.fr || now - CU.frAt > 500) { var L0 = 0, R0 = innerWidth; if (innerWidth > 860) { var rl = document.querySelector("#bsc .bsc-rail"), pn = document.querySelector("#bsc .bsc-panel"); if (rl) L0 = Math.max(0, rl.getBoundingClientRect().right); if (pn) R0 = Math.min(innerWidth, pn.getBoundingClientRect().left); if (R0 - L0 < innerWidth * 0.3) { L0 = 0; R0 = innerWidth; } } CU.fr = { cx: (L0 + R0) / 2, w: R0 - L0 }; CU.frAt = now; }
    var ndc = CU.fr.cx / innerWidth * 2 - 1, off = -ndc * dist * tf * aspect; var right = _v1.set(Math.cos(a), 0, -Math.sin(a));
    _ct2.set(w[0], ty, w[1]); _cp2.set(w[0] + Math.sin(a) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, w[1] + Math.cos(a) * Math.cos(pitch) * dist).addScaledVector(right, off); var look = _ct2.clone().addScaledVector(right, off);
    if (!CU.camInit) { camera.position.copy(_cp2); CU.camInit = true; } else camera.position.lerp(_cp2, Math.min(1, dt * 8)); camera.lookAt(look); if (Math.abs(camera.fov - 40) > 0.1) { camera.fov = 40; camera.updateProjectionMatrix(); } return true; }
  // the vehicle sits on the turntable's centre and turns with it
  function customHold(dt) { if (!CU.on) return; var S = SITE, w = l2w(S.rev[0], S.rev[1]); var sp = RV.on ? 0.25 + revealK() * 2.4 : 0.22; if (!CU.freeze) CU.turn = (CU.turn || 0) + dt * sp; try { player.position.set(w[0], S.G + 0.06, w[1]); player.rotation.y = CU.turn; if (typeof cartSpeed !== "undefined") cartSpeed = 0; } catch (e) {} if (IN.L && IN.L.anim.turn) IN.L.anim.turn.rotation.y = CU.turn; }
  // studio light: three of the pooled point lights as key, fill and rim round the turntable (no new lights)
  var _sv2 = new THREE.Vector3(), _sr2 = new THREE.Vector3(), _su2 = new THREE.Vector3(0, 1, 0);
  function customLight() { if (!CU.on || typeof LIGHTS === "undefined" || !LIGHTS.pool || LIGHTS.pool.length < 3) return; var S = SITE, w = l2w(S.rev[0], S.rev[1]), tgt = _v2.set(w[0], S.G + 0.9, w[1]); _sv2.subVectors(camera.position, tgt); _sv2.y = 0; if (_sv2.lengthSq() < 1e-6) _sv2.set(0, 0, 1); _sv2.normalize(); _sr2.crossVectors(_su2, _sv2).normalize(); var L = LIGHTS.pool, rk = revealK();
    var set = function (l, side, up, fwd, I, col) { l.position.copy(tgt).addScaledVector(_sr2, side).addScaledVector(_su2, up).addScaledVector(_sv2, fwd); l.color.setHex(col); l.intensity = I; l.distance = 12; l.decay = 1.5; };
    set(L[0], -2.2, 2.2, 2.4, 5.5 * (1 - rk * 0.6), 0xfff1e0); set(L[1], 2.6, 0.8, 1.8, 1.6, 0xdfe9ff); set(L[2], 0.8, 2.6, -2.6, 6 + rk * 4, 0xffe2c4); }

  // ───────────────────────── E, the prompt, stamps ─────────────────────────
  function onTurntable() { if (!SITE || !player) return false; var S = SITE, w = l2w(S.rev[0], S.rev[1]); return Math.hypot(player.position.x - w[0], player.position.z - w[1]) < 3.7 && Math.abs(player.position.y - S.G) < 1.2; }
  function busy() { try { return (typeof riding !== "undefined" && riding) || (typeof SIT !== "undefined" && SIT.on) || (typeof inside !== "undefined" && inside) || (typeof DANCE !== "undefined" && DANCE.on) || (typeof FLY !== "undefined" && FLY.on) || (typeof golf !== "undefined" && golf.playing); } catch (e) { return false; } }
  function handleE() { if (BS.off || !SITE || !BS.ready) return false; if (CU.on) { closeCustom(); return true; } if (!onTurntable()) return false; if (typeof riding !== "undefined" && riding) { try { setStatus("park the shared cart outside: your own cart (C) or your bike rolls onto the turntable", true); } catch (e) {} return true; } if (busy()) return false; if (!GEO.cart) { segNow("cart"); } return openCustom(); }
  function promptFrame() { try { if (CU.on || !BS.ready || busy() || !onTurntable()) return; var el2 = $id("prompt"), t = $id("prompt-t"); if (!el2 || !t) return; t.innerHTML = "<b>E</b> &nbsp;" + esc(cartMode && RIDEV.kind !== "cart" ? C("prompts.customBike", "open the Customizer (bike)") : C("prompts.custom", "open the Customizer")); el2.classList.add("on"); } catch (e) { note("prompt", e); } }
  function stamp(id) { try { var PP = window.PLAN_PROGRESS; if (PP && PP.award && id) PP.award("stamp", { id: id }); } catch (e) {} }

  // ───────────────────────── the camera in the shop: kept inside the walls, first person when tight ─────────────────────────
  var FR = BS.fr = BS.fr || { inCam: false };
  function camHook(dt) {
    if (BS.off || !SITE || !BS.ready || window.__cam) return false;
    try { if (CU.on) return customCamera(dt); if (busy()) { FR.inCam = false; return false; }
      var px = player.position.x, py = player.position.y, pz = player.position.z; if (!inShop(px, py + 1, pz)) { if (FR.inCam) { FR.inCam = false; try { player.userData.walk.visible = true; } catch (e) {} } return false; }
      FR.inCam = true; var fwd = [-Math.sin(yaw), -Math.cos(yaw)], by = typeof bobY === "number" ? bobY : 0, carK = cartMode ? 1 : 0, cy0 = py - by + 1.9 + carK * 0.6, maxD = cartMode ? 8 : 6.5, dist = 0;
      for (var d = 0.2; d <= maxD; d += 0.2) { var cx = px - fwd[0] * d, cz = pz - fwd[1] * d; if (!inShop(cx, cy0 + d * 0.15 - 1, cz)) break; dist = d; }
      if (FR.fp === undefined) FR.fp = dist < 1.3; else if (FR.fp && dist > 2.1) FR.fp = false; else if (!FR.fp && dist < 1.1) FR.fp = true;
      CAM.dist += (dist - CAM.dist) * smoothK(dt, 10); var sd = Math.min(dist, CAM.dist);
      if (FR.fp && !cartMode) { camera.position.set(px, py - by + 1.62, pz); CAM.init = false; camera.lookAt(px + fwd[0] * 10, camera.position.y - pitch * 6, pz + fwd[1] * 10); player.userData.walk.visible = false; }
      else { var cy = cy0 + pitch * 1.4 + sd * 0.15; camera.position.lerp(camTarget.set(px - fwd[0] * sd, cy, pz - fwd[1] * sd), smoothK(dt, 24)); camLook(px, py + 1.3, pz, dt, 30); player.userData.walk.visible = true; }
      return true; } catch (e) { note("cam", e); return false; } }

  // ───────────────────────── every frame ─────────────────────────
  var LT = BS.lt = BS.lt || { at: 0 };
  function frameHook(dt, now) {
    if (BS.off || !SITE || !BS.ready) return; dt = Math.min(dt || 0.016, 0.1);
    try {
      var n = clamp((nightK() - 0.02) * 3.2, 0, 1); GU.uNight.value = n; GU.uBsIn.value.w = 0.05 + 0.3 * n; GU.uTime.value = (GU.uTime.value + dt) % 3600;
      segStep(CU.on ? 8 : 3); syncFrame(); pendingFrame(); revealFrame(dt); if (CU.on) { prebuildFrame(); customHold(dt); try { if (player.userData.label) player.userData.label.visible = false; } catch (e) {} }
      var cam = camera.position, dc = lotDist(cam.x, cam.z), dp = lotDist(player.position.x, player.position.z);
      BS.zone = inShop(cam.x, cam.y, cam.z) ? "in" : dc < 60 ? "near" : null;
      if (dp < R_DROP + 20 || IN.L || IN.sb) interiorFrame();
      // what is drawn: the interior from inside or close by (the glass and the door), the exterior always
      if (IN.L) { var vis = BS.zone === "in" || dc < 75; IN.L.g.visible = vis; var A = IN.L.anim, t = GU.uTime.value;
        if (vis) { if (A.turn && !CU.on) A.turn.rotation.y += dt * 0.12; if (A.show) A.show.rotation.y += dt * 0.25; if (A.mist) { A.mist.rotation.y = Math.sin(t * 0.15) * 0.3; A.mist.position.y = Math.sin(t * 0.6) * 0.08; }
          var rk = revealK(), dim = CU.on ? 0.12 : 1; if (A.beams) A.beams.material.opacity = clamp((0.55 + 0.45 * Math.sin(t * 0.8)) * dim + rk * 0.35, 0, 1); if (A.pil) { var hcol = (t * 0.05) % 1; A.pil.material.color.setHSL(hcol, 0.9, 0.55 + rk * 0.3); } }
        IN.L.lights.forEach(function (l, i) { var on = vis && dc < 90; var k = l.userData.k0 * (i < 3 ? (CU.on ? 1.4 + revealK() * 2 : 0.9 + 0.5 * n) : (0.75 + 0.95 * n)); l.intensity = on ? k : 0; if (l.isPointLight) l.distance = (l.userData.d0 || (l.userData.d0 = l.distance)) * (1 + 0.35 * n); }); if (IN.L.anim.poolMat) IN.L.anim.poolMat.color.setScalar(1 + 1.6 * n); }
      if (EX.lights) EX.lights.forEach(function (l, i) { l.intensity = dc < 160 ? l.userData.k0 * (i === EX.lights.length - 1 ? 0.35 + 0.65 * n : n) : 0; }); if (EX.poolMat) EX.poolMat.opacity = n;
      if (EX.halo) { EX.halo.visible = n > 0.05 && dc < 600; } if (MX && MX.neon) MX.neon.opacity = 0.75 + 0.25 * n + 0.04 * Math.sin(GU.uTime.value * 13) * n;
      if (GLOW.mats) for (var gk in GLOW.mats) GLOW.mats[gk].opacity = 0.32 + 0.6 * n;
      if (CU.on) customLight();
      if (nowMs() > (FR.staffAt || 0)) { FR.staffAt = nowMs() + 2000; try { buildStaff(); } catch (e) { note("staff", e); } try { roamArea(); } catch (e) { note("roam", e); } }
      staffFrame(dt); promptFrame(); if (dp < 140 && (FRAME_N % 90) === 0) nearBlock();
      if (!FR.stamped && inShop(player.position.x, player.position.y + 1, player.position.z)) { FR.stamped = true; stamp(C("progress.shop", "p_bs_shop")); }
      if (nowMs() > (LT.sweep || 0)) { LT.sweep = nowMs() + 5000; matSweep(); }
    } catch (e) { note("frame", e); } }

  // ───────────────────────── defer hook: the exterior, the interior solids, warm-up, indoor culling ─────────────────────────
  function deferHook() {
    if (BS.off || !window.PLAN || !SITE) return; var t0 = nowMs(); var step = function (name, fn) { var t = nowMs(); try { fn(); } catch (e) { note(name, e); } BS.n["ms_" + name] = Math.round(nowMs() - t); };
    step("exterior", function () { buildExterior(); });
    step("solids", function () { interiorSolids(); });
    step("textures", function () { decalTex(); txtTex(); flagsMat(); });
    step("show", function () { buildForecourtCarts(); });
    step("perf", function () { perfRooms(); warmSample(); try { var W = window.PLAN_PERF; if (W && W.warmGroup && EX.g) W.warmGroup(EX.g, { name: "bs exterior" }); } catch (e) {} });
    try { var S = SITE; GU.uBsBox.value.set(S.cx, S.cz, S.hw - 0.4, S.hd - 0.4); GU.uBsIn.value.set(S.G, 0, 0.5, 0); GU.uBsRoof.value.set(S.eave, S.crown, S.hw); } catch (e) { note("indoor", e); }
    nearBlock(); segStart("cart"); segStart("bike2"); installOverrides(); BS.groups = [EX.g]; BS.n.deferMs = Math.round(nowMs() - t0); BS.ready = true; }
  // the client's near-player pebble and rock scatter stays off the pad and out of the shop
  function nearBlock() { try { if (typeof NEAR === "undefined" || !NEAR.blocked || NEAR.blocked.bs) return; var b0 = NEAR.blocked; var f = function (x, z) { return inLot(x, z, 1.5) || b0(x, z); }; f.bs = true; NEAR.blocked = f; NEAR.at = [1e9, 1e9]; BS.n.nearWrap = (BS.n.nearWrap || 0) + 1; } catch (e) { note("near", e); } }
  // three show carts on the forecourt plinths (their looks: bodyshop.json showCarts fore1..3) and the bike by the door
  function buildForecourtCarts() { var shows = C("showCarts", []) || [], S = SITE; EX.carts = []; (EX.plinths || []).forEach(function (p, i) { var e = shows.filter(function (q) { return q.where === "fore" + (i + 1); })[0]; if (!e || !has("cart")) return; var g = makeModel("cart"); g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); g.position.set(p[0], 0.21, p[1]); g.rotation.y = [0.9, -0.6, 2.4][i]; EX.g.add(g); EX.carts.push({ g: g, look: e.look }); });
    if (has("bike2")) { var bk = makeBikeModel(1); bk.position.set(-4.3, 0.03, -S.hd - 2.2); bk.rotation.y = 1.9; bk.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); EX.g.add(bk); EX.bike = bk; }
    var dressAll = function () { if (!GEO.cart) { setTimeout(dressAll, 400); return; } EX.carts.forEach(function (c) { dressCart(c.g, c.look, null); }); if (EX.bike && GEO.bike2) dressBike(EX.bike, C("showBike", null)); else if (EX.bike) setTimeout(dressAll, 400); }; dressAll(); }
  // every material of the shop (and the vehicle look family) on a tiny mesh, compiled behind the loading screen
  function warmSample() { try { var M = mats(), g = new THREE.Group(); g.name = "bs warm"; var geo = new THREE.BoxGeometry(0.1, 0.1, 0.1); geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
      ["floor", "earth", "corr", "steel", "chrome", "paint", "rubber", "fabric", "wood", "glass", "glow", "signs", "signGlow", "chest", "muralA", "muralB", "neon", "pool", "add", "turn", "apron"].forEach(function (k) { if (M[k]) { var me = new THREE.Mesh(geo, M[k]); me.receiveShadow = true; me.castShadow = true; g.add(me); } }); g.add(new THREE.Mesh(geo, flagsMat()));
      g.position.set(SITE.cx, SITE.G - 40, SITE.cz); scene.add(g); BS.warm = g; if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(g, { name: "bs warm" }); setTimeout(function () { try { scene.remove(g); } catch (e) {} }, 30000); } catch (e) { note("warm", e); } }
  // indoor culling (plan_perf): inside the shop the world is seen only through the glass front and the door
  function perfRooms() { var W = window.PLAN_PERF; if (!W) return; W.rooms = W.rooms || []; if (W.rooms.some(function (r) { return r.name === "bodyshop"; })) return; var S = SITE;
    var frame = function () { return new THREE.Matrix4().makeTranslation(S.cx, S.G, S.cz); };
    var K0 = { perfSig: function () { return 1; }, perfRoom: function (R) { var rects = [R("x", -S.hd, S.glass[0][0], S.glass[0][1], S.glassY[0], S.glassY[1]), R("x", -S.hd, -6.4, 6.4, 0, 7.0), R("x", -S.hd, S.glass[1][0], S.glass[1][1], S.glassY[0], S.glassY[1]), R("z", -S.hw, -S.hd + 2, S.hd - 2, 6.2, 7.3), R("z", S.hw, -S.hd + 2, S.hd - 2, 6.2, 7.3)]; return { kind: "bodyshop", M: frame(), boxes: [[-S.hw, S.hw, -1, S.crown + 0.5, -S.hd, S.hd]], rects: rects, roots: [IN.L && IN.L.g, EX.g].filter(Boolean) }; } };
    W.rooms.push({ name: "bodyshop", key: function () { if (!SITE || !BS.ready || !IN.L) return null; var c = camera.position; return inShop(c.x, c.y, c.z) ? K0 : null; } }); }

  // ───────────────────────── API, debug, hooks ─────────────────────────
  BS.api = { resolveSite: resolveSite, l2w: l2w, w2l: w2l, inShop: inShop, dressCart: dressCart, dressBike: dressBike, openCustom: openCustom, closeCustom: closeCustom, quote: quote, wheelGeo: wheelGeo, accGeo: accGeo, segNow: segNow, matFor: matFor, setU: setU, cleanLook: cleanLook };
  BS.debug = {
    cam: function (u, y, v, tu, ty, tv, fov) { var a = l2w(u, v), b = l2w(tu, tv); window.__cam = [a[0], SITE.G + y, a[1], b[0], SITE.G + ty, b[1], fov || 0]; try { updateCulling(true); } catch (e) {} return window.__cam; },
    at: function (u, v, yawW) { var w = l2w(u, v); player.position.set(w[0], SITE.G + 0.03, w[1]); if (yawW !== undefined) yaw = yawW; return [w[0], w[1]]; },
    build: function () { if (IN.L) return true; var L = newL(), it = buildInteriorSteps(L), r, ts = [], t1; do { t1 = nowMs(); r = it.next(); ts.push(+(nowMs() - t1).toFixed(1)); } while (!r.done); IN.L = finishL(L); return { steps: ts, tris: Math.round(L.tris), meshes: L.g.children.length }; },
    drop: function () { disposeL(); return true; },
    counts: function () { var o = { mats: Object.keys(MATS).length, wheels: Object.keys(WCACHE).length, accs: Object.keys(ACACHE).length, txt: Object.keys(TXT.slots).length, geo: Object.keys(GEO) }; [["exterior", EX.g], ["interior", IN.L && IN.L.g]].forEach(function (q) { if (!q[1]) return; var m = 0, tr = 0; q[1].traverse(function (x) { if (x.isMesh) { m++; var gi = x.geometry, cnt = gi.index ? gi.index.count : (gi.drawRange && gi.drawRange.count < Infinity ? gi.drawRange.count : gi.attributes.position.count); tr += (x.isInstancedMesh ? x.count : 1) * cnt / 3; } }); o[q[0]] = { meshes: m, tris: Math.round(tr) }; }); o.solids = (IN.solids || []).length + (EX.solids || []).length; return o; },
    show: function (g, look) { return dressCart(g, look, null); }, preview: function (look, mode) { if (mode && mode !== CU.mode) setMode(mode); if (mode === "bike") CU.bike = look || {}; else CU.look = look || {}; previewNow(); return true; }, reveal: function (big) { startReveal(big); return true; }, open: function () { return openCustom(); }, close: function () { closeCustom(); return true; }
  };
  (function hookAll() {
    var set = function (phase, name, fn) { var list = window.PLAN_HOOKS[phase]; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name: name, fn: fn }); };
    set("world", "bsWorld", function () { worldHook(); });
    set("terrain", "bsTerrain", function () { terrainHook(); });
    set("defer", "bsDefer", function () { deferHook(); });
    set("frame", "bsFrame", function (dt, now) { frameHook(dt, now); });
    set("interior", "bsCam", function (dt) { return camHook(dt); });
  })();
  // R15 (plan_roomlight.js, HANDOFF_R15_ROOMLIGHT.md): inside the workshop the interior light kit takes over: its own pooled work lights
  // only, the look; the customizer keeps its studio light
  (window.PLAN_RLQ = window.PLAN_RLQ || []).push({ walk: true, id: "bodyshop", find: function (RL) {
    if (BS.off || !SITE || !BS.ready || !IN.L || !IN.L.g || typeof player === "undefined" || !player) return null; var p = player.position; if (!CU.on && !inShop(p.x, p.y, p.z)) return null;
    var R = IN.L.rlRoom; if (R) return R; var S = SITE;
    R = IN.L.rlRoom = new RL.Room({ id: "bodyshop", type: "bodyshop", mod: "walk", M: new THREE.Matrix4().makeTranslation(S.cx, S.G, S.cz), box: [-S.hw, S.hw, 0, S.crown || 8, -S.hd, S.hd], capRoot: IN.L.g, own: true, env: false }); R.noShaft = true; R.noDoorShaft = true; return R; } });
})();
