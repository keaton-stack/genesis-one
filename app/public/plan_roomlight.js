// R15 (Agent G, 5 Oct 2026): the shared interior lighting kit (HANDOFF_R15_ROOMLIGHT.md). Classic script, loaded before client.js;
// reaches client globals by bare name at hook time only. Every room the player can be in uses it: the R14 shops, venues and
// homes (through plan_rooms.js), the client's generic rooms, the walk-ins of plan_interiors.js and plan_hangars.js, the Dome Suites
// and Grand Vaults, the Market Hall, the keynote hall and the body shop (each registers itself through window.PLAN_RLQ).
//
// What it does, all of it without a new light or a new lit program:
//  1. POOL: the client keeps 8 point and 3 spot lights (LIGHTS.pool / LIGHTS.spool, nearest lamps first). Indoors the outdoor
//     lamps are useless, so while the player is in a room the pool is filled from the room's own fixtures (chandeliers, pendants,
//     sconces, lamps, the fire, neon): real, local, coloured light with specular highlights, at no extra cost (the shader loops
//     over all eleven slots anyway). Fixtures come from the module (the venues' fixture list, registered lights) or are found in
//     the room's glowing meshes (clustered by area). Slots fade when the choice changes; flames flicker.
//  2. ENV: the room is captured once into a 256 cube (only the room, the pool lit) and pre-filtered with the client's own PMREM
//     generator (the sky's size, so every program key stays the same), then used as scene.environment while inside: metals,
//     glass, polished floors and lacquer reflect the room instead of the sky. Cached per room type and hour (LRU), disposed on
//     eviction.
//  3. BAKE: rooms that bake nothing get vertex-colour AO and a warm bounce from a heightfield of their furniture (build time).
//  4. ATMO: daylight shafts through the room's windows (one additive draw, soft noise, scaled by the sun) and dust motes in them
//     (one points draw); the fill turns cool by day against the warm practicals.
//  5. GRADE: a gentle exposure, contrast, saturation and white balance per room type through the post pass's uniforms (set by
//     plan_gfx every frame; scaled here after it, so nothing accumulates and leaving restores them).
// Switches: ?rl=0 turns all of it off (nothing is wrapped); ?rlp=0 pool, ?rle=1 environment (off by default since the R15
// integration: the room capture compiled a second program variant of every material in the room on first entry, a 0.4 to 0.8 s
// hitch), ?rlf=0 the reflective floors, ?rlb=0 bake, ?rla=0 atmosphere,
// ?rlg=0 grading. PLAN_RL.set({ pool: false, ... }) flips the runtime parts in a running game (A/B in one session).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_RLQ = window.PLAN_RLQ || [];
(function () {
  "use strict";
  var QS = location.search;
  var PREV = window.PLAN_RL; if (PREV && PREV.uninstall) { try { PREV.uninstall(); } catch (e) {} }   // evaluated again in a running game (development): swap in place
  var RL = window.PLAN_RL = {};
  RL.v = "r19li-1"; RL.errs = []; RL.n = { rooms: 0, auto: 0, fix: 0, caps: 0, capMs: 0, capMax: 0, envHit: 0, envMiss: 0, envEvict: 0, bakes: 0, bakeMs: 0, shafts: 0, frames: 0, poolMs: 0 };
  RL.on = !/[?&]rl=0\b/.test(QS);
  function qOn(k) { return new RegExp("[?&]" + k + "=1(?![0-9])").test(QS); }
  function qOff(k) { return new RegExp("[?&]" + k + "=0\\b").test(QS); }
  // R16 (Agent I, HANDOFF_R16_INTERIORS.md): ?ri=0 is R15 exactly (the kit's own shaders as before, the capture off by default, no
  // surface pass). The room capture is on by default on high and ultra (decided at the world hook, when the tier is known; ?rle=0 off,
  // ?rle=1 on every tier); ?ris=0 the surface pass alone.
  RL.r16 = RL.on && !qOff("ri");
  RL.part = { pool: RL.on && !qOff("rlp"), env: RL.on && qOn("rle"), floor: RL.on && !qOff("rlf"), bake: RL.on && !qOff("rlb"), atmo: RL.on && !qOff("rla"), grade: RL.on && !qOff("rlg"), surf: RL.r16 && !qOff("ris"), prop: RL.r16 && !qOff("rip") };
  function hiTier() { try { return typeof QUAL !== "undefined" && (QUAL.level === "ultra" || QUAL.level === "high"); } catch (e) { return false; } }
  RL.tierPick = function () { if (RL.tierDone) return; RL.tierDone = true; RL.hi = hiTier(); try { RL.lite = QUAL.level !== "ultra"; } catch (e) { RL.lite = true; } if (RL.r16 && !qOff("rle") && !qOn("rle") && RL.hi) RL.part.env = RL.on; if (!RL.hi) { RL.part.surf = false; RL.part.prop = false; } try { LI.hi = !!(RL.hi && RL.part.surf && RL.part.li); LI.NF = RL.lite ? 16 : 24; liU(); } catch (e) { note("li tier", e); } };
  RL.set = function (o) { for (var k in o) if (k in RL.part) RL.part[k] = !!o[k] && RL.on; RL.dirty = true; if ("li" in o) { try { if (!RL.part.li && LI.R) LI.end(); if (ENV.job) { envJobEnd(ENV.job); ENV.job = null; } ENV.active = null; ENV.deferR = null; if (CUR.R) envBegin(CUR.R); } catch (e) { note("li set", e); } } return RL.part; };
  var TAU = Math.PI * 2;
  function note(w, e) { if (RL.errs.length < 40) RL.errs.push(w + ": " + ((e && e.message) || e)); if (RL.errs.length <= 5) try { console.warn("plan_roomlight " + w, e); } catch (x) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function nightK() { try { return typeof night === "number" ? clamp(night, 0, 1) : 0; } catch (e) { return 0; } }

  // ───────────────────────── the looks: one entry per room type ─────────────────────────
  // ex exposure, con contrast, sat saturation, wb white balance (multiplies the post pass's), fill the room's hemisphere fill,
  // lamp the room's central lamp (as a pool source), fix the fixtures, env the room environment's intensity, cool the share of the
  // fill turned to window daylight by day, shaft the daylight shafts, dust the motes, day the fixtures' share by day
  // A look is the module's light balance (MOD: how the room was built decides how much of its own fill and sky it keeps) times the
  // room type's relative light (L) and the type's grade (G). fill / lamp / fix / env / sky / win: the room's hemisphere fill, its
  // central lamp, the fixtures, the room environment, the sky's share, the window fills; ex / con / sat / wb the grade; cool the
  // share of the fill turned to window daylight by day; shaft / dust the atmosphere; day the fixtures' share by day.
  var MOD = RL.MOD = {
    shops:  { fill: 0.55, lamp: 0.3, fix: 1.9, env: 0.62, sky: 0.7, win: 1.0, irr: 1.0 },
    venues: { fill: 1.0, lamp: 0.85, fix: 1.25, env: 0.8, sky: 0.9, win: 0.7, irr: 1.6 },   // their materials carry an indoor ao map (0.36 of the indirect light) and a baked fixture light
    homes:  { fill: 0.65, lamp: 0.5, fix: 1.7, env: 0.7, sky: 0.75, win: 1.0, irr: 0.8 },
    auto:   { fill: 0.55, lamp: 0.5, fix: 1.6, env: 0.65, sky: 0.75, win: 1.0, irr: 1.0 },
    walk:   { fill: 1.0, lamp: 1.0, fix: 1.0, env: 0.65, sky: 1.0, win: 0, irr: 1.0 }
  };
  var GBASE = { ex: 1.04, con: 1.05, sat: 1.03, wb: [1.02, 1.0, 0.97], cool: 0.3, shaft: 1.0, dust: 1.0, day: 0.85, refl: 0.2, fill: 1, lamp: 1, fix: 1, env: 1, sky: 1, win: 1, irr: 0.75 };   // irr (R16): the room capture's bounce light (diffuse) with the surface pass
  var T = RL.T = {
    base:     {},
    saloon:   { ex: 1.04, con: 1.08, sat: 1.0, wb: [1.03, 1.0, 0.96], fill: 1.0, fix: 1.1, env: 0.6, refl: 0.2, shaft: 1.15, dust: 1.3, day: 0.95 },
    tavern:   { refl: 0.2, ex: 1.0, con: 1.08, sat: 1.05, wb: [1.05, 0.99, 0.93], fill: 0.9, fix: 1.1, win: 0.85, shaft: 1.1, dust: 1.2, day: 0.95 },
    hotel:    { refl: 0.42, ex: 1.03, con: 1.06, sat: 1.03, wb: [1.03, 1.0, 0.95], shaft: 0.95, dust: 0.8 },
    diner:    { refl: 0.59, ex: 1.04, con: 1.08, sat: 1.07, wb: [1.0, 1.0, 1.01], fill: 1.1, lamp: 1.2, fix: 0.95, env: 1.4, irr: 0.9, sky: 1.1, win: 1.2, cool: 0.4, shaft: 0.75, dust: 0.5, day: 0.8 },
    crisp:    { refl: 0.56, ex: 1.04, con: 1.07, sat: 1.05, wb: [1.01, 1.0, 0.99], fill: 1.05, env: 1.35, irr: 0.9, sky: 1.05, win: 1.1, cool: 0.4, shaft: 0.85, dust: 0.6 },
    bank:     { refl: 0.53, ex: 1.03, con: 1.06, sat: 1.0, wb: [1.03, 1.0, 0.96], env: 1.1, shaft: 1.0, dust: 0.9 },
    chapel:   { refl: 0.17, ex: 1.06, con: 1.08, sat: 1.04, wb: [1.04, 0.99, 0.93], fill: 1.35, fix: 1.25, sky: 0.95, win: 0.8, shaft: 1.5, dust: 1.6, day: 1.0 },
    barn:     { refl: 0, ex: 1.02, con: 1.07, sat: 1.04, wb: [1.05, 0.99, 0.92], fix: 1.1, env: 0.8, shaft: 1.35, dust: 1.6, day: 0.9 },
    gallery:  { refl: 0.45, ex: 1.04, con: 1.04, sat: 0.97, wb: [0.995, 1.0, 1.01], fill: 1.15, lamp: 1.2, fix: 0.9, env: 1.1, irr: 1.2, sky: 1.15, win: 1.1, cool: 0.45, shaft: 0.6, dust: 0.4, day: 0.95 },
    warm:     { refl: 0.22, ex: 1.02, con: 1.07, sat: 1.04, wb: [1.04, 0.99, 0.94], fill: 0.95, fix: 1.05, win: 0.9, shaft: 1.1, dust: 1.2, day: 0.9 },
    cozy:     { ex: 1.03, con: 1.06, sat: 1.03, wb: [1.03, 1.0, 0.95], shaft: 1.0, dust: 0.9 },
    brand:    { refl: 0.42, ex: 1.04, con: 1.07, sat: 1.04, wb: [0.99, 1.01, 0.99], env: 1.3, cool: 0.4, shaft: 0.85, dust: 0.6, day: 0.9 },
    villa:    { refl: 0.45, ex: 1.0, con: 1.08, sat: 1.03, wb: [1.03, 1.0, 0.96], fill: 0.85, fix: 1.1, sky: 0.85, win: 1.1, cool: 0.45, shaft: 1.0, dust: 0.7, day: 0.75 },
    ranch:    { refl: 0.2, ex: 1.02, con: 1.07, sat: 1.04, wb: [1.04, 0.99, 0.94], shaft: 1.15, dust: 1.1 },
    lodge:    { refl: 0.22, irr: 0.85, ex: 1.03, con: 1.07, sat: 0.97, wb: [1.03, 0.995, 0.95], fill: 1.05, fix: 1.05, win: 0.9, shaft: 1.25, dust: 1.2, day: 0.9 },
    glamp:    { refl: 0, ex: 1.03, con: 1.06, sat: 1.03, wb: [1.04, 0.99, 0.94], env: 0.8, shaft: 0.8, dust: 1.0, day: 0.8 },
    club:     { refl: 0, ex: 1.0, con: 1.06, sat: 1.04, wb: [1.04, 1.0, 0.95], fill: 0.85, lamp: 1.0, shaft: 1.0, dust: 0.8, day: 0.9 },
    hangar:   { refl: 0, ex: 1.0, con: 1.05, sat: 1.0, wb: [0.99, 1.0, 1.02], fill: 0.85, cool: 0.45, shaft: 0.9, dust: 1.0, day: 0.9 },
    dome:     { refl: 0, ex: 0.99, con: 1.04, sat: 1.03, wb: [1.02, 1.0, 0.97], shaft: 0, dust: 0.6, day: 0.9 },
    vault:    { refl: 0, ex: 0.98, con: 1.07, sat: 1.04, wb: [1.03, 0.995, 0.95], shaft: 0, dust: 0.8, day: 0.95 },
    market:   { refl: 0, ex: 1.0, con: 1.04, sat: 1.04, wb: [1.03, 1.0, 0.96], shaft: 0, dust: 0, day: 0.9 },
    keynote:  { refl: 0, ex: 0.99, con: 1.06, sat: 1.02, wb: [1.0, 1.0, 1.01], shaft: 0, dust: 0.5, day: 0.95 },
    bodyshop: { refl: 0, ex: 1.0, con: 1.06, sat: 1.02, wb: [0.995, 1.0, 1.015], env: 1.1, shaft: 0, dust: 0.7, day: 0.95 }
  };
  for (var tk in T) { var o0 = {}, t0 = T[tk]; for (var bk in GBASE) o0[bk] = GBASE[bk]; for (var ok in t0) o0[ok] = t0[ok]; T[tk] = o0; }
  var LKEYS = ["fill", "lamp", "fix", "env", "sky", "win", "irr"];
  // the R14 shops' trades to a look
  var TRADE = { soda: "crisp", candy: "crisp", coffee: "cozy", bakery: "cozy", diner: "diner", tavern: "tavern", gift: "cozy", outfit: "cozy", giveback: "brand", hats: "warm", leather: "warm", smithy: "warm",
    hardware: "warm", mercantile: "warm", garden: "cozy", toys: "cozy", gallery: "gallery", photo: "gallery", bikes: "crisp", records: "warm", barber: "crisp", makers: "warm", books: "warm", apothecary: "warm",
    office: "warm", sheriff: "warm", museum: "warm", market: "cozy", restroom: "crisp", stall: "brand" };
  var LC = {};
  function look(type, mod) { var key = type + "|" + (mod || "auto"), o = LC[key]; if (o && o._v === RL.lv) return o; var t = T[type] || T.base, m = MOD[mod] || MOD.auto; o = {}; for (var k in t) o[k] = t[k]; for (var i = 0; i < LKEYS.length; i++) o[LKEYS[i]] = (t[LKEYS[i]] === undefined ? 1 : t[LKEYS[i]]) * (m[LKEYS[i]] === undefined ? 1 : m[LKEYS[i]]); o._v = RL.lv; LC[key] = o; return o; }
  RL.lv = 1; RL.retune = function () { RL.lv++; return RL.lv; };   // after editing RL.T or RL.MOD in a running game
  function lookR(R) { if (R._lk && R._lkv === RL.lv) return R._lk; R._lk = look(R.type, R.mod); R._lkv = RL.lv; return R._lk; }
  RL.look = look;

  // ───────────────────────── rooms and fixtures ─────────────────────────
  // a room: { id, type, M (room frame -> world), Mi, box [x0, x1, y0, y1, z0, z1] in the room frame, fix: fixtures (world),
  //   own: also take the module's own pool lights inside the box, lamp / fill (the room's lights, scaled by the look),
  //   test(): the player is in it (walk-ins), wins: windows [[ax, c, a0, a1, b0, b1], ...] (plan_rooms portal format) }
  var _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _c = new THREE.Color();
  function Room(o) {
    this.id = o.id || ("room" + (++RL.n.rooms)); this.type = o.type || "base"; this.M = new THREE.Matrix4(); this.Mi = new THREE.Matrix4();
    if (o.M) this.M.copy(o.M); else if (o.g) { o.g.updateMatrixWorld(true); this.M.copy(o.g.matrixWorld); if (o.y0) this.M.multiply(new THREE.Matrix4().makeTranslation(0, o.y0, 0)); }
    this.Mi.copy(this.M).invert(); this.box = o.box || [-5, 5, 0, 4.5, -5, 5]; this.fix = []; this.own = o.own !== false; this.lamp = o.lamp || null; this.fill = o.fill || null; this.test = o.test || null;
    this.wins = o.wins || []; this.g = o.g || null; this.env = o.env !== false; this.envKey = o.envKey || this.type; this.keepOut = o.keepOut || 0; this.capRoot = o.capRoot || o.g || null; this.stamp = 0; this.ready = false;
    this.k = o.k || null; this.mod = o.mod || "auto"; this.lookK = o.look || null; this.noShaft = !!o.noShaft; this.noDust = !!o.noDust; this.hgt = this.box[3] - this.box[2];
  }
  // a fixture in the room frame: c [r, g, b] (0..1), k the pool intensity (before the look), r range, o: { spot: [tx, ty, tz] (room
  // frame), ang, pen, decay, fl (flicker 1 lamp, 2 flame), pri (0..1), day (share by day, default the look's) }
  Room.prototype.light = function (x, y, z, c, k, r, o) {
    o = o || {}; _v.set(x, y, z).applyMatrix4(this.M); var f = { p: _v.clone(), c: new THREE.Color(c[0], c[1], c[2]), k: k, r: r || 6, d: o.decay || 1.45, fl: o.fl || 0, pri: o.pri || 0, ph: Math.random() * 100, day: o.day, s: null, key: null, lx: x, ly: y, lz: z };
    if (o.spot) { _v2.set(o.spot[0], o.spot[1], o.spot[2]).applyMatrix4(this.M); f.s = { t: _v2.clone(), a: o.ang || 0.75, pen: o.pen === undefined ? 0.6 : o.pen }; }
    f.key = f; this.fix.push(f); RL.n.fix++; return f;
  };
  Room.prototype.inBox = function (p, pad) { _v2.copy(p).applyMatrix4(this.Mi); var b = this.box; pad = pad || 0; return _v2.x > b[0] - pad && _v2.x < b[1] + pad && _v2.y > b[2] - pad - 0.5 && _v2.y < b[3] + pad && _v2.z > b[4] - pad && _v2.z < b[5] + pad; };
  RL.Room = Room;
  // merge fixtures closer than d metres (a wagon wheel of oil lamps becomes one light at its middle, with their summed power)
  function mergeFix(R, d) {
    var F = R.fix, out = [];
    for (var i = 0; i < F.length; i++) { var f = F[i], m = null; for (var j = 0; j < out.length; j++) { var q = out[j]; if (!q.s === !f.s && q.fl === f.fl && !q.win === !f.win && q.p.distanceTo(f.p) < d) { m = q; break; } }
      if (!m) { out.push(f); continue; } var w0 = m.k, w1 = f.k, w = w0 + w1 || 1; m.p.multiplyScalar(w0 / w).addScaledVector(f.p, w1 / w); m.c.multiplyScalar(w0 / w); _c.copy(f.c).multiplyScalar(w1 / w); m.c.add(_c); m.k = Math.min(w, Math.max(w0, w1) * 1.6); m.r = Math.max(m.r, f.r); m.pri = Math.max(m.pri, f.pri); }
    R.fix = out;
  }

  // fixtures found in the room's glowing meshes: unlit vertex-colour families (bulbs, shades, neon, coves) and strongly emissive
  // standard materials without an emissive map (the client's glow spheres); clustered on a 0.9 m grid by emitting area
  function isGlow(m, o) {
    if (!m || m.visible === false || (o.userData && (o.userData.rlNoFix || o.userData.rvOwn === undefined && false))) return 0;
    if (m.userData && m.userData.rlGlow !== undefined) return m.userData.rlGlow;
    if (m.isMeshBasicMaterial) { if (m.transparent || m.alphaTest > 0 || m.colorWrite === false || m.blending !== THREE.NormalBlending && m.blending !== THREE.AdditiveBlending) return 0; if (!m.vertexColors) return 0; var nm = m.name || ""; if (/vista|sign|blob|shade|shaft|glass|caster/i.test(nm)) return 0; return 1; }
    if (m.isMeshStandardMaterial && m.emissive && !m.emissiveMap && !m.transparent) { var e = Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * m.emissiveIntensity; return e > 0.75 ? Math.min(1.5, e / 1.4) : 0; }
    return 0;
  }
  var _m4 = new THREE.Matrix4(), _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
  RL.glowFix = function (R, root, opt) {
    opt = opt || {}; var t0 = performance.now(), cell = opt.cell || 0.9, cells = new Map(), b = R.box; root.updateMatrixWorld(true);
    root.traverse(function (o) {
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || !o.geometry) return; var vis = true, q = o; while (q && q !== root) { if (!q.visible) { vis = false; break; } q = q.parent; } if (!vis) return;
      var m = o.material; if (Array.isArray(m)) return; var gk = isGlow(m, o); if (!gk) return;
      var G = o.geometry, P = G.attributes.position, C = G.attributes.color, I = G.index; if (!P) return; _m4.multiplyMatrices(R.Mi, o.matrixWorld);
      var base = m.isMeshBasicMaterial ? m.color : _c.copy(m.emissive).multiplyScalar(Math.min(1, m.emissiveIntensity)); var br = base.r, bg = base.g, bb = base.b;
      var ntri = I ? I.count / 3 : P.count / 3; if (ntri > 60000) return;
      for (var t = 0; t < ntri; t++) {
        var a = I ? I.getX(t * 3) : t * 3, b2 = I ? I.getX(t * 3 + 1) : t * 3 + 1, c2 = I ? I.getX(t * 3 + 2) : t * 3 + 2;
        _p0.fromBufferAttribute(P, a).applyMatrix4(_m4); _p1.fromBufferAttribute(P, b2).applyMatrix4(_m4); _p2.fromBufferAttribute(P, c2).applyMatrix4(_m4);
        var cx = (_p0.x + _p1.x + _p2.x) / 3, cy = (_p0.y + _p1.y + _p2.y) / 3, cz = (_p0.z + _p1.z + _p2.z) / 3;
        if (cx < b[0] - 0.3 || cx > b[1] + 0.3 || cz < b[4] - 0.3 || cz > b[5] + 0.3 || cy < b[2] - 0.3 || cy > b[3] + 0.3) continue;
        var area = _e1.subVectors(_p1, _p0).cross(_e2.subVectors(_p2, _p0)).length() * 0.5; if (!(area > 0)) continue;
        var vr = br, vg = bg, vb = bb; if (C && m.vertexColors) { vr *= C.getX(a); vg *= C.getY(a); vb *= C.getZ(a); }
        var lum = 0.2126 * vr + 0.7152 * vg + 0.0722 * vb; if (lum < 0.18) continue;   // dark glass, unlit bulbs, the off state of a switch
        var key = Math.floor(cx / cell) + "," + Math.floor(cy / cell) + "," + Math.floor(cz / cell); var s = cells.get(key); if (!s) { s = { a: 0, x: 0, y: 0, z: 0, r: 0, g: 0, b: 0 }; cells.set(key, s); }
        var w = area * gk; s.a += w; s.x += cx * w; s.y += cy * w; s.z += cz * w; s.r += vr * w; s.g += vg * w; s.b += vb * w;
      }
    });
    var n = 0, list = []; cells.forEach(function (s) { if (s.a < (opt.minA || 0.004)) return; list.push(s); });
    list.sort(function (a, b) { return b.a - a.a; });
    for (var i = 0; i < list.length && n < (opt.max || 40); i++) { var s = list[i], x = s.x / s.a, y = s.y / s.a, z = s.z / s.a, mx = Math.max(s.r, s.g, s.b) || 1;
      var col = [s.r / mx, s.g / mx, s.b / mx], lum = clamp((0.2126 * s.r + 0.7152 * s.g + 0.0722 * s.b) / s.a, 0.2, 1.6);
      var k = clamp(0.35 + 2.4 * Math.sqrt(s.a), 0.4, 2.6) * (0.55 + 0.45 * lum) * (opt.k || 1); var yy = Math.min(y - 0.12, R.box[3] - 0.25);   // just under the shade
      var fx = R.light(x, yy, z, col, k, clamp(2.6 + 6 * Math.sqrt(s.a), 3, 8.5) * (opt.r || 1), { pri: y > 2.0 ? 0.25 : 0, decay: 1.5 }); if (y > 2.1 && y > R.box[2] + (R.box[3] - R.box[2]) * 0.5 && !opt.noHang) fx.hang = true; n++; }
    RL.n.auto += n; RL.n.autoMs = +(performance.now() - t0).toFixed(1); return n;
  };

  // ───────────────────────── which room the player is in ─────────────────────────
  var WALK = RL.walks = [];   // rooms that are walked into without the client's door (registered through window.PLAN_RLQ)
  RL.walk = function (o) { var w = { o: o, R: null, at: 0 }; WALK.push(w); return w; };
  function drainQ() { var q = window.PLAN_RLQ; while (q.length) { var o = q.shift(); if (window.__rlqAll) window.__rlqAll.push(o); try { if (o && o.walk) RL.walk(o); else if (o && typeof o.fn === "function") o.fn(RL); } catch (e) { note("queue", e); } } }
  var CUR = { R: null, at: 0, k: 0 };
  RL.cur = function () { return CUR.R; };
  var SKIP = { terminal: 1, arcade: 1 };   // the FBO is Agent F's; the arcade keeps its own neon
  function insideRoom() {
    var ins = null; try { ins = typeof inside !== "undefined" ? inside : null; } catch (e) { return null; } if (!ins || !ins.g) return null;
    var g = ins.g, R = g.userData.rlRoom; if (R) return R; if (g.userData.rlTried) return null; g.userData.rlTried = 1;
    var kind = ins.door && ins.door.kind; if (kind === "terminal" && DR.on && ins.half) { try { DR.dynFor(g, "fbo", [-ins.half, ins.half, 0, 8, -ins.half, ins.half], "hotel"); } catch (e) {} } if (SKIP[kind] && !(kind === "terminal" && RL.part.li)) return null;
    try { R = autoRoom(ins); } catch (e) { note("auto room " + kind, e); R = null; } if (R) g.userData.rlRoom = R; return R;
  }
  // a room the client built (a generic room, or a walk-in that set `inside`) and no module described
  function autoRoom(ins) {
    var g = ins.g, kind = ins.door && ins.door.kind, half = ins.half || 5, hgt = kind === "terminal" ? 9.5 : 4.4;
    try { var th = typeof THEME !== "undefined" && THEME[kind]; if (th && th.hgt) hgt = th.hgt; } catch (e) {}
    var type = /saloon/.test(kind) ? "saloon" : /hotel/.test(kind) ? "hotel" : kind === "diner" ? "diner" : kind === "bank" ? "bank" : kind === "chapel" ? "chapel" : kind === "barn" ? "barn" : kind === "gallery" || kind === "artpav" ? "gallery"
      : kind === "villa" ? "villa" : kind === "ranch" ? "ranch" : kind === "lakehouse" ? "lodge" : kind === "glamp" ? "glamp" : /clubhouse|restaurant/.test(kind) ? "club" : /hangar/.test(kind) ? "hangar" : kind === "dome" ? "dome" : "cozy";
    var box = [-half, half, 0, hgt, -half, half], lamp = null, fill = null; for (var i = 0; i < g.children.length; i++) { var o = g.children[i]; if (o.isPointLight && !lamp) lamp = o; else if (o.isHemisphereLight && !fill) fill = o; }
    if (ins.int3 || ins.hgr) { // a walk-in interior: its own frame is the building's; measure the room from its meshes
      try { var bb = new THREE.Box3(); g.updateMatrixWorld(true); var inv = new THREE.Matrix4().copy(g.matrixWorld).invert(); g.traverse(function (o) { var gs = o.isMesh && o.geometry && !o.isSkinnedMesh ? (o.geometry.boundingBox || o.geometry.boundingSphere) : null; if (!gs) return;   // the bounds three already has (no vertex pass on a 700k triangle walk-in)
          if (gs.isBox3) _bb.copy(gs); else { _bb.min.copy(gs.center).subScalar(gs.radius); _bb.max.copy(gs.center).addScalar(gs.radius); } _bb.applyMatrix4(_m4.multiplyMatrices(inv, o.matrixWorld)); if (_bb.max.x - _bb.min.x < 60 && _bb.max.z - _bb.min.z < 60) bb.union(_bb); });
        if (!bb.isEmpty()) box = [bb.min.x, bb.max.x, Math.max(bb.min.y, -0.5), Math.min(bb.max.y, 14), bb.min.z, bb.max.z]; } catch (e) { note("walk-in box", e); }
      type = ins.hgr ? "hangar" : (ins.int3 && ins.int3.kind === "hangarhome2") || kind === "hangarhome2" ? "hangar" : "club"; if (DR.on && !ins.hgr && type === "club") { try { DR.dynFor(g, "walk:" + kind + ":" + (ins.door ? ins.door.i : 0), box, "club"); } catch (e) {} } }
    var R = new Room({ id: "auto:" + kind + ":" + (ins.door ? ins.door.i : 0), type: type, mod: ins.int3 || ins.hgr ? "walk" : "auto", g: g, box: box, lamp: lamp, fill: fill, own: true, env: !(ins.int3 || ins.hgr) }); if (!(ins.int3 || ins.hgr)) R.genericWins = !/hangar|terminal/.test(kind); else R.noDoorShaft = true; if (kind === "terminal") { R.env = false; R.liKeepEnv = true; R.type = "hotel"; } if (ins.int3 && RL.part.li) { try { liWalkIn(R, ins.int3); } catch (e) { note("li walk-in", e); } }   // walk-ins are entered without a fade and carry up to 0.7 M triangles: no capture (a hangar's materials carry their own probe)
    if (!(ins.int3 || ins.hgr)) { R.floorY = 0.05; try { RL.glowFix(R, g, { k: 0.9 }); mergeFix(R, 0.9); winFix(R); } catch (e) { note("auto fix", e); } try { RL.creaseAO(R, g, { box: [-half + 0.1, half - 0.1, 0.05, hgt, -half + 0.1, half - 0.1], skip: [2] }); } catch (e) { note("auto ao", e); } }
    RL.n.autoRooms = (RL.n.autoRooms || 0) + 1; return R;
  }
  var _bb = new THREE.Box3();
  // the R14 rooms (plan_rooms.js calls this once its build has run): fixtures from the module, then the room's glowing meshes
  RL.fromCtx = function (ctx, type, opt) {
    opt = opt || {}; var g = ctx.g, half = ctx.half, hgt = ctx.hgt || 4.4, y0 = opt.y0 || 0;
    var R = new Room({ id: ctx.id + ":" + (ctx.door ? ctx.door.i : 0), type: type, mod: opt.mod, g: g, y0: y0, box: opt.box || [-half, half, 0, hgt, -half, half], lamp: ctx.lamp, fill: ctx.fill, own: true, wins: ctx.portals ? ctx.portals.slice() : [] });
    if (opt.fix) opt.fix(R); if (!opt.noGlow) { try { RL.glowFix(R, g, opt.glow || {}); } catch (e) { note("glow " + ctx.id, e); } } mergeFix(R, opt.merge || 0.85); try { winFix(R); } catch (e) { note("win fix", e); }
    g.userData.rlRoom = R; RL.n.ctxRooms = (RL.n.ctxRooms || 0) + 1; return R;
  };
  // plan_rooms.js hands every R14 room here once its build has run; the module that built it says what the fixtures are
  var VKIND = { saloon: "saloon", hotel: "hotel", diner: "diner", bank: "bank", chapel: "chapel", barn: "barn", gallery: "gallery" };
  RL.ctxRoom = function (ctx) {
    if (!RL.on || !ctx || !ctx.g) return null; var id = ctx.id || "", kind = ctx.kind, nm = ctx.name || "";
    try {
      if (id === "r14_shops") { var S = window.PLAN_ROOMS_SHOPS, tr = S && S.last && S.last.trade; var Rs = RL.fromCtx(ctx, TRADE[tr] || "cozy", { mod: "shops", glow: { k: 1.0 } });
        Rs.floorY = 0.052; try { var hh = ctx.half; RL.creaseAO(Rs, ctx.g, { box: [-(hh - 0.1), hh - 0.1, 0.052, ctx.hgt || 4.4, -hh + 0.1, hh - 0.55], skip: [2] }); } catch (e) { note("shop ao", e); } return Rs; }
      if (id.indexOf("rv_") === 0) { var V = window.PLAN_ROOMS_VENUES, cur = V && V.cur, type = VKIND[kind] || "warm";
        if (kind === "hotel" && /lodge/i.test(nm)) type = "lodge"; else if (kind === "hotel" && /courthouse/i.test(nm)) type = "bank"; else if (kind === "bank" && /land office|assay/i.test(nm)) type = "warm"; else if (kind === "barn" && /cart|rover|shuttle/i.test(nm)) type = "hangar";
        var F = cur && cur.R ? cur.R.F : 0.15;
        var Rv = RL.fromCtx(ctx, type, { mod: "venues", noGlow: true, merge: 0.95, fix: function (R) { var L = cur && cur.g === ctx.g && cur.plan && cur.plan.L; if (!L) return; for (var i = 0; i < L.length; i++) { var q = L[i]; var hot = q[6] >= 1.2 && q[1] < 1.2; R.light(q[0], q[1] + F, q[2], [q[3], q[4], q[5]], q[6] * 1.55, clamp(q[7] * 2.3, 3.2, 9), { pri: q[1] > 2.2 ? 0.2 : 0, fl: hot ? 2 : 0, decay: 1.4 }); } } }); if (Rv) Rv.floorY = F; return Rv; }
      if (id.indexOf("homes:") === 0) { var hk = id.slice(6), Rh = RL.fromCtx(ctx, hk === "lakehouse" ? "lodge" : hk, { mod: "homes", glow: { k: 1.0 } }); try { var HC = window.PLAN_RH && PLAN_RH.cur; if (Rh && HC && HC.g === ctx.g && typeof HC.FY === "number") Rh.floorY = HC.FY; } catch (e) {} return Rh; }
      return RL.fromCtx(ctx, "cozy", { mod: "auto" });
    } catch (e) { note("ctx room " + id, e); return null; }
  };
  RL.envOwns = function () { return !!ENV.onTex; };
  // the Market Hall's glazed nave (its box as plan_market.js gives it): the look only; its lamps stay the client's nearest-first pool
  window.PLAN_RLQ.push({ walk: true, id: "market", find: function () {
    var MK = window.PLAN_MARKET; if (!MK || MK.off) return null; var c = camera.position; if (c.x < -465 || c.x > -140 || c.z < 8 || c.z > 46) return null;
    var gy = 0; try { gy = typeof planGroundAt === "function" ? planGroundAt(c.x, c.z) : getH(c.x, c.z); } catch (e) {} if (c.y > gy + 20) return null;
    var R = MK.rlRoom; if (!R) { R = MK.rlRoom = new Room({ id: "market", type: "market", mod: "walk", M: new THREE.Matrix4().makeTranslation(-302.5, gy, 27), box: [-162.5, 162.5, -1, 20, -19, 19], own: true, env: false }); R.pool = false; R.noShaft = true; R.noDust = true; R.noDoorShaft = true; } return R; } });

  // daylight through the windows (0 at night, in a storm less), and the window fill lights: a soft cool light just inside each big
  // opening, so a room is brighter by its windows and falls off toward the back (the uniform hemisphere fill is turned down)
  function daylight() { var el = 0.5, S = 0; try { var G = window.PLAN_GFX; if (G && G.sun) el = G.sun.el; else el = 0.5 - nightK(); S = G && G.storm ? G.storm.k || 0 : 0; } catch (e) {} return sstep(-0.06, 0.22, el) * (1 - 0.7 * S); }
  RL.daylight = daylight;
  function winFix(R) {
    var ops = openings(R), made = [];
    for (var i = 0; i < ops.length; i++) { var o = ops[i], C = o, nx = o[4][0], nz = o[4][1]; var w = Math.hypot(C[1][0] - C[0][0], C[1][2] - C[0][2]), h = C[2][1] - C[1][1], area = w * h; if (area < 0.7) continue;
      var x = (C[0][0] + C[1][0]) / 2 + nx * 0.9, y = Math.min(R.box[3] - 0.4, (C[0][1] + C[2][1]) / 2 + 0.2), z = (C[0][2] + C[1][2]) / 2 + nz * 0.9, near = null;
      for (var j = 0; j < made.length; j++) if (Math.hypot(made[j].lx - x, made[j].lz - z) < 2.2) { near = made[j]; break; }
      if (near) { near.k = Math.min(near.k + 0.4 * Math.sqrt(area), 2.4); continue; }
      var f = R.light(x, y, z, [0.86, 0.92, 1.0], Math.min(0.5 + 0.6 * Math.sqrt(area), 2.0), clamp(3.5 + 1.2 * Math.sqrt(area), 4, 7), { decay: 1.7, pri: 0.5 }); f.win = true; made.push(f); }
    return made.length;
  }

  // ───────────────────────── 1. the pool ─────────────────────────
  var SP = [], SS = [];   // slot state: { f: fixture key (a fixture or a light), k: fade 0..1 }
  for (var si = 0; si < 8; si++) SP.push({ f: null, k: 0 }); for (var sj = 0; sj < 3; sj++) SS.push({ f: null, k: 0 });
  var CP = [], CS = [];   // candidate lists (reused)
  var _lw = new THREE.Vector3(), _lt = new THREE.Vector3();
  function srcOK(l) { if (!(l._intensity > 0.0001) || !isFinite(l._intensity)) return false; var p = l.parent; while (p) { if (!p.visible) return false; if (p === scene) return true; p = p.parent; } return false; }
  function flick(f, now) { if (!f.fl) return 1; var t = now * 0.001 + f.ph; if (f.fl === 1) return 0.94 + 0.06 * Math.sin(t * 2.1) * Math.sin(t * 5.3 + 1.3); return 0.82 + 0.1 * Math.sin(t * 9.7) + 0.08 * Math.sin(t * 23.1 + f.ph) * Math.sin(t * 3.3); }
  function byS(a, b) { return b.s - a.s; }
  function pick(slots, cands, n, dt, snap) {
    cands.sort(byS); var nw = Math.min(n, cands.length), want = cands; var i, j;
    for (i = 0; i < slots.length; i++) { var S = slots[i]; S.c = null; if (!S.f) continue; for (j = 0; j < nw; j++) if (want[j].key === S.f) { S.c = want[j]; want[j].used = true; break; } }
    for (i = 0; i < slots.length; i++) { var S2 = slots[i]; if (S2.c) { S2.k = snap ? 1 : Math.min(1, S2.k + dt * 4); continue; } if (S2.f) { S2.k = snap ? 0 : S2.k - dt * 4; if (S2.k > 0) { S2.c = S2.last; continue; } S2.f = null; S2.k = 0; } }
    for (j = 0; j < nw; j++) { if (want[j].used) continue; for (i = 0; i < slots.length; i++) if (!slots[i].f) { slots[i].f = want[j].key; slots[i].c = want[j]; slots[i].k = snap ? 1 : 0; break; } }
    for (i = 0; i < slots.length; i++) if (slots[i].c) slots[i].last = slots[i].c;
  }
  var POOLX = { orig: null, wrapped: false, snap: true, room: null };
  function poolRoom(R, dt, now) {
    if (LI.active(R)) return poolLI(R, dt, now);
    var t0 = performance.now(); if (LIGHTS.dirty || now - LIGHTS.at > 4000) collectLights();
    var cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, Lk = lookR(R), nt = nightK(), dayK = (R.k && R.k.day !== undefined ? R.k.day : Lk.day), fixK = Lk.fix * (R.k && R.k.fix || 1) * (dayK + (1 - dayK) * nt) * (1 + 0.6 * nt);
    CP.length = 0; CS.length = 0; var i, dl0 = daylight(), winK = Lk.win * (R.k && R.k.win !== undefined ? R.k.win : 1) * dl0;
    for (i = 0; i < R.fix.length; i++) { var f = R.fix[i]; var I = f.win ? f.k * winK : f.k * fixK * flick(f, now); if (!(I > 0.001)) continue; var d = Math.hypot(f.p.x - cx, f.p.y - cy, f.p.z - cz); var c = f._cand || (f._cand = { key: f, f: f, l: null, s: 0, used: false, sp: false });
      c.s = I * (1 + f.pri) / (1 + (d / Math.max(2.5, f.r)) * (d / Math.max(2.5, f.r))); c.I = I; c.used = false; c.sp = !!f.s || (!!f.hang && !f.win); (c.sp ? CS : CP).push(c); }
    if (R.own) for (i = 0; i < LIGHTS.src.length; i++) { var l = LIGHTS.src[i]; if (!srcOK(l)) continue; l.getWorldPosition(_lw); var isLamp = l === R.lamp; if (!isLamp && !R.inBox(_lw, 0.6)) continue;
      var dl = Math.hypot(_lw.x - cx, _lw.y - cy, _lw.z - cz), reach = l.distance || 50; if (!(dl <= reach * 1.5 + 25)) continue; var c2 = l.userData._rlc || (l.userData._rlc = { key: l, f: null, l: l, s: 0, used: false, p: new THREE.Vector3() });
      c2.p.copy(_lw); c2.I = l._intensity * (isLamp ? Lk.lamp * (R.k && R.k.lamp || 1) : 1); c2.s = c2.I * (isLamp ? 0.6 : 1) / (1 + (dl / Math.max(2.5, reach * 0.5)) * (dl / Math.max(2.5, reach * 0.5))); c2.used = false; (l.isSpotLight ? CS : CP).push(c2); }
    // points that do not fit the spot slots become points, spots beyond the point slots are dropped
    if (CS.length > 3) { CS.sort(byS); for (i = 3; i < CS.length; i++) if (CS[i].f) { CS[i].sp = false; CP.push(CS[i]); } CS.length = 3; }
    if (R.mod === "walk" && !CP.length && !CS.length) return false;   // a walk-in whose own lights are all off keeps the client's nearest-first pool
    var snap = POOLX.snap; POOLX.snap = false; pick(SP, CP, 8 - (R.keepOut || 0), dt, snap); pick(SS, CS, 3, dt, snap);
    for (i = 0; i < 8; i++) { var pl = LIGHTS.pool[i], S = SP[i]; if (!pl) continue; var cc = S.c; if (!cc || !(S.k > 0)) { pl.intensity = 0; continue; }
      if (cc.f) { var F = cc.f; pl.position.copy(F.p); pl.color.copy(F.c); pl.intensity = cc.I * S.k * (F.hang ? 0.7 : 1); pl.distance = F.r; pl.decay = F.d; }
      else { var L = cc.l; pl.position.copy(cc.p); pl.color.copy(L.color); pl.intensity = cc.I * S.k; pl.distance = L.distance; pl.decay = L.decay; } }
    for (i = 0; i < 3; i++) { var sl = LIGHTS.spool[i], S3 = SS[i]; if (!sl) continue; var c3 = S3.c; if (!c3 || !(S3.k > 0)) { sl.intensity = 0; continue; }
      if (c3.f) { var F3 = c3.f; sl.position.copy(F3.p); sl.color.copy(F3.c); if (F3.s) { sl.intensity = c3.I * S3.k; sl.distance = F3.r; sl.decay = F3.d; sl.angle = F3.s.a; sl.penumbra = F3.s.pen; sl.target.position.copy(F3.s.t); }
        else { sl.intensity = c3.I * S3.k * 1.9; sl.distance = F3.r * 1.15; sl.decay = F3.d; sl.angle = 1.0; sl.penumbra = 0.85; sl.target.position.set(F3.p.x, F3.p.y - 3, F3.p.z); } sl.target.updateMatrixWorld(); }
      else { var L3 = c3.l; sl.position.copy(c3.p); sl.color.copy(L3.color); sl.intensity = c3.I * S3.k; sl.distance = L3.distance; sl.decay = L3.decay; sl.angle = L3.angle; sl.penumbra = L3.penumbra; L3.target.getWorldPosition(_lt); sl.target.position.copy(_lt); sl.target.updateMatrixWorld(); } }
    RL.n.poolMs = +(performance.now() - t0).toFixed(3); return true;
  }
  var LASTT = 0;
  function installPool() {
    if (POOLX.wrapped || typeof updateLightPool !== "function" || typeof LIGHTS === "undefined") return false; POOLX.wrapped = true;
    var cur0 = updateLightPool, orig = cur0.__rlWrap ? (window.__rlPoolOrig || null) : cur0; if (typeof orig !== "function") { POOLX.wrapped = false; note("pool", "no original light pool"); return false; } window.__rlPoolOrig = POOLX.orig = orig;
    var wrap = function () {
      var R = null; try { R = RL.part.pool && LIGHTS.ready && CUR.R && CUR.R.pool !== false ? CUR.R : null; } catch (e) { R = null; }
      if (!R) { if (POOLX.room) { POOLX.room = null; for (var i = 0; i < 8; i++) { SP[i].f = null; SP[i].k = 0; } for (var j = 0; j < 3; j++) { SS[j].f = null; SS[j].k = 0; } } return orig.apply(this, arguments); }
      var now = performance.now(), dt = LASTT ? Math.min(0.1, (now - LASTT) / 1000) : 0.016; LASTT = now; if (POOLX.room !== R) { POOLX.room = R; POOLX.snap = true; }
      try { if (poolRoom(R, dt, now) === false) { POOLX.room = null; return orig.apply(this, arguments); } } catch (e) { note("pool", e); POOLX.room = null; return orig.apply(this, arguments); }
    };
    wrap.__rlWrap = true; updateLightPool = window.updateLightPool = wrap;
    return true;
  }

  // ───────────────────────── the room's own lights and the sky's share, per look ─────────────────────────
  // the fill (a hemisphere light) is scaled every frame from the value its module last set (modules that retune it per frame keep
  // working, a value set once is not scaled twice); by day part of it turns to window daylight, cooler than the practicals
  var FILL = { l: null, base: 0, set: -1, col: new THREE.Color(), colSet: new THREE.Color(), gc: new THREE.Color(), gcSet: new THREE.Color() };
  var COOL = new THREE.Color(0.78, 0.86, 1.0);
  function fillFrame(R) {
    var l = R.fill; if (!l || !l.isHemisphereLight) { fillEnd(); return; } var Lk = lookR(R), nt = nightK();
    if (FILL.l !== l) { fillEnd(); FILL.l = l; FILL.set = -1; }
    var v = l._intensity === undefined ? l.intensity : l._intensity; if (FILL.set < 0 || Math.abs(v - FILL.set) > 1e-6) FILL.base = v;
    if (FILL.set < 0 || !l.color.equals(FILL.colSet)) FILL.col.copy(l.color); FILL.set = FILL.base * Lk.fill * (R.k && R.k.fill || 1); l.intensity = FILL.set;
    var ck = Lk.cool * (1 - nt) * (RL.part.atmo ? 1 : 0); l.color.copy(FILL.col).lerp(COOL, ck); FILL.colSet.copy(l.color);
  }
  function fillEnd() { var l = FILL.l; if (l) { try { var v = l._intensity === undefined ? l.intensity : l._intensity; if (Math.abs(v - FILL.set) < 1e-6) l.intensity = FILL.base; if (l.color.equals(FILL.colSet)) l.color.copy(FILL.col); } catch (e) {} } FILL.l = null; FILL.set = -1; }

  // ───────────────────────── 2. the room environment ─────────────────────────
  var ENV = RL.env = { cache: new Map(), max: 4, cube: null, cam: null, job: null, active: null, sky: null, skyI: 0, setI: -1, onTex: null, LAYER: 27 };
  function envKeyOf(R) { return R.envKey + ":" + (nightK() > 0.5 ? "n" : "d") + (LI.active(R) ? ":li" : ""); }
  function lightsOnLayer(L) { var a = []; try { a.push(hemi, sun, moon); } catch (e) {} try { var P = window.PLAN_PERF; if (P) a.push(P.hemi, P.hemi2); } catch (e) {} try { LIGHTS.pool.forEach(function (l) { a.push(l); }); LIGHTS.spool.forEach(function (l) { a.push(l); }); } catch (e) {} try { if (CSMX.csm) CSMX.csm.lights.forEach(function (l) { a.push(l); }); } catch (e) {}
    for (var i = 0; i < a.length; i++) if (a[i] && a[i].layers) a[i].layers.enable(L); }
  function envBegin(R) {
    if (!RL.part.env || !R.env || !R.capRoot || typeof pmrem === "undefined" || !pmrem || typeof renderer === "undefined") return;
    if (LI.need(R) && !R.liFail && !LI.active(R)) { ENV.deferR = R; return; }   // R19 LI: the capture waits for the room's own light
    var key = envKeyOf(R), hit = ENV.cache.get(key); if (hit) { ENV.cache.delete(key); ENV.cache.set(key, hit); RL.n.envHit++; ENV.active = { R: R, key: key, rt: hit.rt, nt: hit.nt }; return; }
    RL.n.envMiss++; ENV.job = { R: R, key: key, face: 0, t: 0, nt: nightK(), meshes: null }; try { ENV.max = typeof QUAL !== "undefined" && (QUAL.level === "low" || QUAL.level === "medium") ? 2 : RL.r16 ? 3 : 4; } catch (e) {}   // 6 MB a room on the GPU; fewer kept on the lower tiers (R16: 3 on high and ultra, the capture is on by default there)
  }
  // the capture, two faces a frame (behind the door's fade), then the pre-filter on the next frame.
  // R16: every program the capture draws with must be the main pass's own. three keys a program on the light counts of the render (and
  // on nothing else that differs here: the cube target has the main target's colour space, no tone mapping, the scene's fog and
  // environment), and it draws the next frame's shadow pass with the light state the last render of the scene left (setupLights comes
  // after the shadow pass): R15 left out the room's own fill (a hemisphere light inside the room group, not on the capture layer), so
  // every lit room material and the depth materials of the next shadow pass compiled a second time (12 programs, 0.4 to 0.8 s).
  // Now the capture sees exactly the lights the main pass sees (the scene's lights, the room's, every hemisphere light plan_perf
  // counts), and the counts are compared first (a mismatch skips the capture: no program is ever made for it). R15's CubeCamera was
  // also never oriented (three r170 needs updateCoordinateSystem), so its six faces were one view.
  function lightSig(list, mask) { var s = [0, 0, 0, 0, 0, 0, 0, 0];
    function v(o) { if (o.visible === false) return; if (o.isLight && (o.layers.mask & mask) !== 0) { var c = o.castShadow ? 1 : 0; if (o.isDirectionalLight) { s[0]++; s[1] += c; } else if (o.isPointLight) { s[2]++; s[3] += c; } else if (o.isSpotLight) { s[4]++; s[5] += c; } else if (o.isHemisphereLight) s[6]++; else s[7]++; } var ch = o.children; for (var i = 0; i < ch.length; i++) v(ch[i]); }
    for (var i = 0; i < list.length; i++) v(list[i]); return s.join(","); }
  RL.lightSig = function () { return lightSig(scene.children, camera.layers.mask); };
  // R16: a face is drawn into a 2D target with exactly the main pass's formats (half-float colour, a depth texture, as the post
  // target and the R9 warm-up target have) and blitted into the cube: drawing into the cube target itself (a depth renderbuffer) made
  // the driver build its own variant of each room program on the first capture (a 500 to 600 ms first step at the saloon and the
  // store, measured); this way every draw of the capture reuses the main pass's variants. ENV.blit = false: the old path.
  function capFace(r, cam, face) {
    var rt2 = ENV.rt2; if (!rt2) { rt2 = ENV.rt2 = new THREE.WebGLRenderTarget(256, 256, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true, stencilBuffer: false, generateMipmaps: false }); rt2.depthTexture = new THREE.DepthTexture(256, 256, THREE.UnsignedIntType); rt2.texture.userData.noWarm = true; }
    r.setRenderTarget(rt2); r.render(scene, cam);
    var gl = r.getContext(), P = r.properties, dF = P.get(ENV.cube).__webglFramebuffer; if (!dF) { r.setRenderTarget(ENV.cube, face); dF = P.get(ENV.cube).__webglFramebuffer; }
    var sF = P.get(rt2).__webglFramebuffer; if (!sF || !dF || !dF[face]) { ENV.blit = false; r.setRenderTarget(ENV.cube, face); r.render(scene, cam); return; }
    r.state.bindFramebuffer(gl.READ_FRAMEBUFFER, sF); r.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dF[face]); r.state.buffers.color.setMask(true); r.state.setScissorTest(false);   // a blit obeys the colour mask and the scissor test
    gl.blitFramebuffer(0, 0, 256, 256, 0, 0, 256, 256, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    r.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null); r.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }
  function envStep() {
    var J = ENV.job; if (!J) return; if (CUR.R !== J.R) { envJobEnd(J); ENV.job = null; return; }
    var t0 = performance.now(), L = ENV.LAYER;
    try {
      if (!ENV.cube) { ENV.cube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: !RL.r16 }); ENV.cube.texture.userData.noWarm = true; ENV.cam = new THREE.CubeCamera(0.05, 80, ENV.cube); if (RL.r16) { ENV.cam.coordinateSystem = renderer.coordinateSystem; ENV.cam.updateCoordinateSystem(); } ENV.cam.layers.set(L); ENV.cam.children.forEach(function (c) { c.layers.set(L); }); }
      var roots = Array.isArray(J.R.capRoot) ? J.R.capRoot : [J.R.capRoot];
      if (!J.meshes) { J.meshes = []; J.lights = []; for (var ri = 0; ri < roots.length; ri++) roots[ri].traverse(function (o) {
          if (o.isLight) { if (RL.r16 && !o.layers.isEnabled(L)) { o.layers.enable(L); J.lights.push(o); } return; }
          if ((o.isMesh || o.isPoints) && !o.isSkinnedMesh && o.visible && !o.layers.isEnabled(L) && !(RL.r16 && o.userData && o.userData.rlNoCap)) { o.layers.enable(L); J.meshes.push(o); } });
        if (RL.r16) { try { var HS = window.PLAN_PERF && PLAN_PERF.hemis; if (HS) HS.forEach(function (h) { if (!h.layers.isEnabled(L)) { h.layers.enable(L); J.lights.push(h); } }); } catch (e) {} } }
      if (J.face < 6) {
        var b = J.R.box, cx = (b[0] + b[1]) / 2, cz = (b[4] + b[5]) / 2; _v.set(cx, b[2] + Math.min(1.7, (b[3] - b[2]) * 0.45), cz).applyMatrix4(J.R.M); ENV.cam.position.copy(_v); ENV.cam.updateMatrixWorld(true); lightsOnLayer(L);
        // only the room and the lights are walked (three visits the whole scene graph for every render, 13,000 objects outdoors)
        var tops = [], ok = true; for (var ti = 0; ti < roots.length; ti++) { var top = roots[ti]; while (top.parent && top.parent !== scene) top = top.parent; if (top.parent !== scene) ok = false; else if (tops.indexOf(top) < 0) tops.push(top); }
        var kids = scene.children, red = null; if (ok && tops.length) { red = tops.slice(); for (var q = 0; q < kids.length; q++) { var ko = kids[q]; if (ko.isLight && red.indexOf(ko) < 0) red.push(ko); }
          if (RL.r16 && J.lights) for (var qh = 0; qh < J.lights.length; qh++) { var hl = J.lights[qh]; if (!hl.isHemisphereLight) continue; var ht = hl; while (ht.parent && ht.parent !== scene) ht = ht.parent; if (ht.parent === scene && red.indexOf(ht) < 0 && !hiddenUp(hl)) red.push(hl); } }
        if (RL.r16 && J.face === 0) { var sm = lightSig(kids, camera.layers.mask), sc = lightSig(red || kids, 1 << L); RL.n.sig = sm + (sm === sc ? "" : " / " + sc); if (sm !== sc || !red) { note("env capture", "light counts differ, skipped (" + sm + " / " + sc + ")"); J.R.env = false; envJobEnd(J); ENV.job = null; return; } }
        var r = renderer, prt = r.getRenderTarget(), su = r.shadowMap.autoUpdate, sn = r.shadowMap.needsUpdate, ac = r.autoClear, cc = ENV.cc || (ENV.cc = new THREE.Color()); r.getClearColor(cc); var ca = r.getClearAlpha();
        var nt = nightK(); try { _c.copy(scene.fog.color).multiplyScalar(1.6 * (1 - nt) + 0.02); } catch (e) { _c.setRGB(0.6, 0.65, 0.75); } r.setClearColor(_c, 1);
        r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = false; r.autoClear = true;
        if (red) scene.children = red;
        try { var cams = ENV.cam.children; for (var k = 0; k < 2 && J.face < 6; k++, J.face++) { if (RL.r16 && ENV.blit !== false) capFace(r, cams[J.face], J.face); else { r.setRenderTarget(ENV.cube, J.face); r.render(scene, cams[J.face]); } } }
        finally { if (red) scene.children = kids; r.setRenderTarget(prt); r.shadowMap.autoUpdate = su; r.shadowMap.needsUpdate = sn; r.autoClear = ac; r.setClearColor(cc, ca); }
      } else {
        var rt = pmrem.fromCubemap(ENV.cube.texture); rt.texture.userData.noWarm = true; rt.texture.name = "rl env " + J.key;
        ENV.cache.set(J.key, { rt: rt, nt: J.nt }); while (ENV.cache.size > ENV.max) { var k0 = ENV.cache.keys().next().value, ev = ENV.cache.get(k0); ENV.cache.delete(k0); if (!ENV.active || ENV.active.rt !== ev.rt) { try { ev.rt.dispose(); } catch (e) {} } else ENV.zombie = ev.rt; RL.n.envEvict++; }
        ENV.active = { R: J.R, key: J.key, rt: rt, nt: J.nt }; envJobEnd(J); ENV.job = null; RL.n.caps++;
      }
    } catch (e) { note("env capture", e); envJobEnd(J); ENV.job = null; }
    var dt = performance.now() - t0; RL.n.capMs += dt; if (dt > RL.n.capMax) RL.n.capMax = +dt.toFixed(1); (RL.n.capLog = RL.n.capLog || []).push(+dt.toFixed(1)); if (RL.n.capLog.length > 24) RL.n.capLog.shift();
  }
  // the pre-filter's cube program is made while the loading screen is up (the client only ever pre-filters scenes, never cubes)
  RL.envPrep = function () { try { if (RL.part.env && typeof pmrem !== "undefined" && pmrem && pmrem.compileCubemapShader) { pmrem.compileCubemapShader(); RL.n.envPrep = 1; } } catch (e) { note("env prep", e); } };
  function envJobEnd(J) { if (J && J.meshes) { for (var i = 0; i < J.meshes.length; i++) J.meshes[i].layers.disable(ENV.LAYER); J.meshes = null; } if (J && J.lights) { for (var j = 0; j < J.lights.length; j++) J.lights[j].layers.disable(ENV.LAYER); J.lights = null; } }
  function hiddenUp(o) { for (var k = 0; o && k < 64; k++) { if (o.visible === false) return true; o = o.parent; } return false; }
  // while inside: the room's environment replaces the sky's (the client's updateEnvironment swaps in a new sky every few seconds;
  // it is put back each frame), at the look's intensity
  function envFrame(R) {
    var A = ENV.active; if (!A || A.R !== R || !RL.part.env) { envRestore(); return; }
    if (Math.abs(nightK() - A.nt) > 0.3 && !ENV.job) { ENV.active = null; envBegin(R); return; }
    var tex = A.rt.texture; if (scene.environment !== tex) { if (scene.environment !== ENV.onTex) ENV.sky = scene.environment; scene.environment = tex; ENV.onTex = tex; }
    var ei = scene.environmentIntensity; if (ENV.setI < 0 || Math.abs(ei - ENV.setI) > 1e-6) { var sk = window.PLAN_ROOMS && PLAN_ROOMS.sky; ENV.skyI = sk && sk.on && Math.abs(ei - sk.set) < 1e-6 ? sk.base : ei; } var Lk = lookR(R); ENV.setI = LI.active(R) ? 1.0 : Lk.env * (R.k && R.k.env || 1) * (1 + 0.6 * nightK()); scene.environmentIntensity = ENV.setI;
  }
  function envRestore() {
    if (ENV.onTex) { try { if (scene.environment === ENV.onTex) scene.environment = (typeof envTex !== "undefined" && envTex) || ENV.sky; if (ENV.setI >= 0 && Math.abs(scene.environmentIntensity - ENV.setI) < 1e-6) scene.environmentIntensity = ENV.skyI; } catch (e) {} ENV.onTex = null; ENV.setI = -1; }
    if (ENV.zombie) { try { ENV.zombie.dispose(); } catch (e) {} ENV.zombie = null; }
  }
  RL.envDrop = function () { envRestore(); ENV.active = null; ENV.cache.forEach(function (v) { try { v.rt.dispose(); } catch (e) {} }); ENV.cache.clear(); if (ENV.cube) { ENV.cube.dispose(); ENV.cube = null; ENV.cam = null; } if (ENV.rt2) { if (ENV.rt2.depthTexture) ENV.rt2.depthTexture.dispose(); ENV.rt2.dispose(); ENV.rt2 = null; } return true; };

  // ───────────────────────── 4. atmosphere: daylight shafts and dust motes ─────────────────────────
  // The windows (plan_rooms portals, or the client's six side windows in a generic room, plus the door) are swept along the sun's
  // direction to the floor: the prism's sides are one additive draw with soft edges, a falloff along the beam and slow noise; motes
  // drift inside the same prisms (one points draw). Both are shared, fixed-size buffers (no per-room allocation), rebuilt only when
  // the sun has moved; their strength follows the sun's height, which side it is on and the look.
  var ATMO = RL.atmo = { g: null, sh: null, du: null, mat: null, dmat: null, R: null, at: 0, dir: new THREE.Vector3(), k: 0, n: 0, nd: 0, MAXQ: 64, MAXD: 520 };
  var SH_VS = "attribute vec2 aTE; attribute float aW; varying vec2 vTE; varying float vW; varying vec3 vP; varying float vD; void main(){ vTE = aTE; vW = aW; vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; vec4 mv = viewMatrix * wp; vD = -mv.z; gl_Position = projectionMatrix * mv; }";
  var SH_FS = "uniform vec3 uCol; uniform float uK; uniform float uT; varying vec2 vTE; varying float vW; varying vec3 vP; varying float vD;" +
    "float h3(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }" +
    "float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y), mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }" +
    "void main(){ float t = vTE.x, e = vTE.y; float edge = smoothstep(0.0, 0.22, e) * smoothstep(1.0, 0.78, e); float fall = pow(1.0 - t, 1.35) * smoothstep(0.0, 0.06, t);" +
    " float nz = 0.55 + 0.45 * n3(vP * vec3(1.7, 0.9, 1.7) + vec3(0.0, uT * 0.06, uT * 0.035)); float near = smoothstep(0.25, 1.6, vD);" +
    " float a = uK * vW * edge * fall * nz * near; if (a < 0.002) discard; gl_FragColor = vec4(uCol * a, 1.0); }";
  var DU_VS = "attribute vec4 aS; uniform float uT; uniform float uPx; varying float vA; void main(){ vec3 p = position; float s = aS.x * 6.2831;" +
    " p += vec3(sin(uT * (0.11 + 0.07 * aS.y) + s) * 0.14, -mod(uT * (0.008 + 0.012 * aS.z) + aS.y, 1.0) * 0.35 + 0.17, cos(uT * (0.09 + 0.05 * aS.z) + s * 1.3) * 0.14);" +
    " vec4 mv = modelViewMatrix * vec4(p, 1.0); float d = -mv.z; vA = aS.w * smoothstep(0.3, 1.2, d) * (1.0 - smoothstep(6.0, 11.0, d)) * (0.55 + 0.45 * sin(uT * (0.6 + aS.z) + s * 3.0));" +
    " gl_PointSize = clamp(uPx * (0.005 + 0.006 * aS.z) / max(d, 0.1), 1.0, 5.0); gl_Position = projectionMatrix * mv; }";
  var DU_FS = "uniform vec3 uCol; uniform float uK; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; float a = (1.0 - r) * vA * uK; if (r > 1.0 || a < 0.003) discard; gl_FragColor = vec4(uCol * a, 1.0); }";
  // R16: the kit's own shaders are raw shaders: three keys a RawShaderMaterial on its source only (no light counts, fog, colour space or
  // tone mapping), so the one program warmed behind the loading screen is the one every room draws with, whatever the room's lights.
  // (A ShaderMaterial re-keys on the light state, and a transparent double-sided one does it twice a frame: the R15 warm-up registration
  // compiled them for the outdoor state and the first room compiled them again.) Output is the same: these shaders never applied a
  // colour space or tone mapping, and the main pass draws into a linear target on every tier.
  var RAW_HEAD = "precision highp float;\n";
  var SH_VS_R = RAW_HEAD + "uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix; attribute vec3 position;\n" + SH_VS;
  var DU_VS_R = RAW_HEAD + "uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; attribute vec3 position;\n" + DU_VS;
  var AO_VS_R = RAW_HEAD + "uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; attribute vec3 position; attribute vec3 color; varying vec3 vC; void main(){ vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
  var AO_FS_R = RAW_HEAD + "varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }";
  function kitMat(o, vs, fs, vsR, fsR) { if (RL.r16) { o.vertexShader = vsR; o.fragmentShader = RAW_HEAD + fsR; return new THREE.RawShaderMaterial(o); } o.vertexShader = vs; o.fragmentShader = fs; o.fog = false; o.toneMapped = false; return new THREE.ShaderMaterial(o); }
  function atmoInit() {
    if (ATMO.g) return; var g = ATMO.g = new THREE.Group(); g.name = "rl atmo"; g.userData.noSolid = true; g.userData.noCull = true; g.userData.avShared = true;
    var MQ = ATMO.MAXQ, sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MQ * 4 * 3), 3)); sg.setAttribute("aTE", new THREE.BufferAttribute(new Float32Array(MQ * 4 * 2), 2)); sg.setAttribute("aW", new THREE.BufferAttribute(new Float32Array(MQ * 4), 1));
    var idx = new Uint16Array(MQ * 6); for (var q = 0; q < MQ; q++) { idx[q * 6] = q * 4; idx[q * 6 + 1] = q * 4 + 1; idx[q * 6 + 2] = q * 4 + 2; idx[q * 6 + 3] = q * 4; idx[q * 6 + 4] = q * 4 + 2; idx[q * 6 + 5] = q * 4 + 3; } sg.setIndex(new THREE.BufferAttribute(idx, 1)); sg.setDrawRange(0, 0); sg.userData.avShared = true;
    ATMO.mat = kitMat({ uniforms: { uCol: { value: new THREE.Color(1, 0.9, 0.74) }, uK: { value: 0 }, uT: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }, SH_VS, SH_FS, SH_VS_R, SH_FS);
    ATMO.mat.name = "rl_shaft"; ATMO.mat.userData.avShared = true; ATMO.mat.userData.noWarm = true;
    var sh = ATMO.sh = new THREE.Mesh(sg, ATMO.mat); sh.frustumCulled = false; sh.renderOrder = 4; sh.userData.noSolid = true; sh.userData.rlNoCap = true; sh.matrixAutoUpdate = false; sh.castShadow = false; sh.receiveShadow = false; sh.name = "rl shafts"; g.add(sh);
    var MD = ATMO.MAXD, dg = new THREE.BufferGeometry(); dg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MD * 3), 3)); dg.setAttribute("aS", new THREE.BufferAttribute(new Float32Array(MD * 4), 4)); dg.setDrawRange(0, 0); dg.userData.avShared = true;
    ATMO.dmat = kitMat({ uniforms: { uCol: { value: new THREE.Color(1, 0.92, 0.8) }, uK: { value: 0 }, uT: { value: 0 }, uPx: { value: 900 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }, DU_VS, DU_FS, DU_VS_R, DU_FS);
    ATMO.dmat.name = "rl_dust"; ATMO.dmat.userData.avShared = true; ATMO.dmat.userData.noWarm = true;
    var du = ATMO.du = new THREE.Points(dg, ATMO.dmat); du.frustumCulled = false; du.renderOrder = 5; du.userData.noSolid = true; du.userData.rlNoCap = true; du.matrixAutoUpdate = false; du.name = "rl dust"; g.add(du);
  }
  // the three kit programs, compiled and drawn once with the main pass's colour and depth formats (the driver's own variant), in a
  // scene of their own (a raw program depends on nothing the main scene holds), at the world hook behind the loading screen
  RL.kitWarm = function () {
    if (!RL.r16 || RL.n.kitWarm || typeof renderer === "undefined" || !renderer) return; RL.n.kitWarm = -1; var t0 = performance.now(), geo = [], rt = null;
    try {
      atmoInit(); var am = aoMat(); var sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
      var tri = new THREE.BufferGeometry(); tri.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, -1, 0.01, 0, -1, 0, 0.01, -1]), 3)); tri.setAttribute("aTE", new THREE.BufferAttribute(new Float32Array(6), 2)); tri.setAttribute("aW", new THREE.BufferAttribute(new Float32Array(3), 1)); tri.setAttribute("color", new THREE.BufferAttribute(new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]), 3));
      var pt = new THREE.BufferGeometry(); pt.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, -1]), 3)); pt.setAttribute("aS", new THREE.BufferAttribute(new Float32Array(4), 4)); geo.push(tri, pt);
      [new THREE.Mesh(tri, ATMO.mat), new THREE.Points(pt, ATMO.dmat), new THREE.Mesh(tri, am)].forEach(function (o) { o.frustumCulled = false; sc.add(o); });
      rt = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true, stencilBuffer: false }); rt.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
      var prt = renderer.getRenderTarget(), ar = renderer.info.autoReset; try { renderer.setRenderTarget(rt); renderer.render(sc, cam); } finally { renderer.setRenderTarget(prt); renderer.info.autoReset = ar; }
      try { if (window.PLAN_PERF && PLAN_PERF.pinPrograms) PLAN_PERF.pinPrograms(); } catch (e) {}
      RL.n.kitWarm = +(performance.now() - t0).toFixed(1);
    } catch (e) { note("kit warm", e); }
    finally { for (var i = 0; i < geo.length; i++) geo[i].dispose(); if (rt) { if (rt.depthTexture) rt.depthTexture.dispose(); rt.dispose(); } }
  };
  // the room's openings in its own frame: [[x0, y0, z0], [x1, y1, z1], [x2, y2, z2], [x3, y3, z3], inward normal [nx, nz]]
  function openings(R) {
    var out = [], b = R.box, hx = b[1], hz = b[5], W = R.wins && R.wins.length ? R.wins : null;
    function rect(ax, c, a0, a1, y0, y1) { if (ax === "x") { var nz = c > 0 ? -1 : 1; out.push([[a0, y0, c], [a1, y0, c], [a1, y1, c], [a0, y1, c], [0, nz]]); } else { var nx = c > 0 ? -1 : 1; out.push([[c, y0, a0], [c, y0, a1], [c, y1, a1], [c, y1, a0], [nx, 0]]); } }
    if (W) for (var i = 0; i < W.length; i++) { var p = W[i]; if (p[5] - p[4] < 0.3 || p[3] - p[2] < 0.25) continue; rect(p[0], p[1], p[2], p[3], Math.max(0.05, p[4]), Math.min(b[3] - 0.05, p[5])); }
    else if (R.genericWins) { var h = hx - 0.08; for (var s = -1; s <= 1; s += 2) for (var k = -1; k <= 1; k++) rect("z", s * h, k * hz * 0.5 - 0.7, k * hz * 0.5 + 0.7, 1.3, 2.5); }
    if (R.door !== false && !R.noDoorShaft) rect("x", hz, -1.0, 1.0, 0.05, 2.4);
    return out;
  }
  var _sd = new THREE.Vector3(), _ld = new THREE.Vector3();
  function sunDirRoom(R, out) {   // the direction the light travels (from the sun into the room), in the room frame
    var ok = false; try { var G = window.PLAN_GFX && PLAN_GFX.sun; if (G && G.dir) { _sd.set(G.dir[0], G.dir[1], G.dir[2]); ok = true; } } catch (e) {}
    if (!ok) { try { _sd.copy(sun.position).sub(sun.target.position).normalize(); } catch (e) { return null; } }
    out.copy(_sd).negate(); _m4.copy(R.M); _m4.setPosition(0, 0, 0); var inv = _m4.clone().invert(); out.applyMatrix4(inv).normalize(); return _sd.y;
  }
  var RNG = 1; function rnd() { RNG = (RNG * 16807) % 2147483647; return (RNG - 1) / 2147483646; }
  function atmoBuild(R) {
    var L = _ld, el = sunDirRoom(R, L); var sg = ATMO.sh.geometry, P = sg.attributes.position.array, TE = sg.attributes.aTE.array, WW = sg.attributes.aW.array; var nq = 0, b = R.box, floorY = b[2] + 0.02, maxLen = 9;
    var D = ATMO.du.geometry, DP = D.attributes.position.array, DS = D.attributes.aS.array, nd = 0; RNG = 7 + (R.stamp | 0);
    var ops = el === null || !(L.y < -0.04) ? [] : openings(R), Lk = lookR(R);
    for (var i = 0; i < ops.length && nq < ATMO.MAXQ - 4; i++) {
      var o = ops[i], nx = o[4][0], nz = o[4][1], facing = L.x * nx + L.z * nz, Dx = L.x, Dy = L.y, Dz = L.z, ml = maxLen, w;
      if (facing >= 0.08) w = Math.min(1, facing * 1.6) * sstep(-0.04, 0.12, -L.y);   // the sun through this opening
      else { w = 0.3; Dx = nx * 0.92; Dy = -0.38; Dz = nz * 0.92; ml = 2.4; }   // the sun is on the other side of the wall: a soft haze of sky light just inside it
      var C = o.slice(0, 4), E = [];
      for (var j = 0; j < 4; j++) { var c = C[j], t = (c[1] - floorY) / Math.max(0.05, -Dy); t = Math.min(t, ml); var ex = c[0] + Dx * t, ey = c[1] + Dy * t, ez = c[2] + Dz * t;
        ex = clamp(ex, b[0] + 0.05, b[1] - 0.05); ez = clamp(ez, b[4] + 0.05, b[5] - 0.05); E.push([ex, Math.max(floorY, ey), ez]); }
      for (var f = 0; f < 4; f++) { var a0 = C[f], a1 = C[(f + 1) % 4], e1 = E[(f + 1) % 4], e0 = E[f], v = nq * 4;
        P.set([a0[0], a0[1], a0[2], a1[0], a1[1], a1[2], e1[0], e1[1], e1[2], e0[0], e0[1], e0[2]], v * 3);
        TE.set([0, 0, 0, 1, 1, 1, 1, 0], v * 2); WW[v] = WW[v + 1] = WW[v + 2] = WW[v + 3] = w * (f === 0 || f === 2 ? 1 : 0.8); nq++; }
      var area = Math.hypot(C[1][0] - C[0][0], C[1][2] - C[0][2]) * (C[2][1] - C[1][1]), nm = Math.min(ATMO.MAXD - nd, Math.round(70 * Math.sqrt(area) * w * Lk.dust));
      for (var m = 0; m < nm; m++) { var u = rnd(), vv = rnd(), tt = Math.pow(rnd(), 0.8) * 0.85; var sx = C[0][0] + (C[1][0] - C[0][0]) * u, sy = C[0][1] + (C[3][1] - C[0][1]) * vv, sz = C[0][2] + (C[1][2] - C[0][2]) * u;
        var ln = (sy - floorY) / Math.max(0.05, -Dy); ln = Math.min(ln, ml) * tt; DP[nd * 3] = sx + Dx * ln; DP[nd * 3 + 1] = sy + Dy * ln; DP[nd * 3 + 2] = sz + Dz * ln;
        DS[nd * 4] = rnd(); DS[nd * 4 + 1] = rnd(); DS[nd * 4 + 2] = rnd(); DS[nd * 4 + 3] = w * (1 - tt) * (0.5 + 0.5 * rnd()); nd++; }
    }
    sg.attributes.position.needsUpdate = true; sg.attributes.aTE.needsUpdate = true; sg.attributes.aW.needsUpdate = true; sg.setDrawRange(0, nq * 6);
    D.attributes.position.needsUpdate = true; D.attributes.aS.needsUpdate = true; D.setDrawRange(0, nd); ATMO.n = nq; ATMO.nd = nd; RL.n.shafts = nq / 4;
    ATMO.sh.matrix.copy(R.M); ATMO.sh.matrixWorldNeedsUpdate = true; ATMO.du.matrix.copy(R.M); ATMO.du.matrixWorldNeedsUpdate = true; ATMO.dir.copy(L); ATMO.at = performance.now();
  }
  RL.atmoBegin = function (R) { if (!RL.part.atmo || R.noShaft && R.noDust) return; atmoInit(); ATMO.R = R; var host = R.g || scene; if (ATMO.g.parent !== host) { if (ATMO.g.parent) ATMO.g.parent.remove(ATMO.g); host.add(ATMO.g); }
    if (R.g) { ATMO.g.matrixAutoUpdate = false; _m4.copy(R.g.matrixWorld).invert(); ATMO.g.matrix.copy(_m4); ATMO.g.updateMatrixWorld(true); } else { ATMO.g.matrixAutoUpdate = false; ATMO.g.matrix.identity(); ATMO.g.updateMatrixWorld(true); }
    try { atmoBuild(R); } catch (e) { note("atmo build", e); } };
  RL.atmoEnd = function (R) { if (!ATMO.g) return; if (ATMO.g.parent) ATMO.g.parent.remove(ATMO.g); ATMO.R = null; ATMO.mat.uniforms.uK.value = 0; ATMO.dmat.uniforms.uK.value = 0; };
  RL.atmoDrop = function () { if (!ATMO.g) return; RL.atmoEnd(); ATMO.sh.geometry.dispose(); ATMO.du.geometry.dispose(); ATMO.mat.dispose(); ATMO.dmat.dispose(); ATMO.g = null; };
  RL.atmoFrame = function (R, dt, now) {
    if (!ATMO.g || ATMO.R !== R) return; if (!RL.part.atmo) { ATMO.mat.uniforms.uK.value = 0; ATMO.dmat.uniforms.uK.value = 0; return; }
    if (now - ATMO.at > 2000) { var L = _v; if (sunDirRoom(R, L) !== null && L.angleTo(ATMO.dir) > 0.008) { try { atmoBuild(R); } catch (e) { note("atmo build", e); } } else ATMO.at = now; }
    var el = 0; try { el = PLAN_GFX.sun ? PLAN_GFX.sun.el : -ATMO.dir.y; } catch (e) { el = -ATMO.dir.y; } var S = 0; try { S = PLAN_GFX.storm ? PLAN_GFX.storm.k || 0 : 0; } catch (e) {}
    var day = sstep(-0.02, 0.16, el) * (1 - 0.85 * S), gold = sstep(0.35, 0.04, el) * sstep(-0.03, 0.06, el), Lk = lookR(R);
    var col = ATMO.mat.uniforms.uCol.value; col.setRGB(1.0, 0.9 - 0.18 * gold, 0.74 - 0.34 * gold);
    var liK = LI.active(R) ? (LI.S.sunN > 0 ? 1 : 0.3) : 1;
    ATMO.mat.uniforms.uK.value = R.noShaft ? 0 : 0.085 * day * Lk.shaft * (1 + 0.6 * gold) * liK; ATMO.mat.uniforms.uT.value = now / 1000;
    ATMO.dmat.uniforms.uCol.value.copy(col); ATMO.dmat.uniforms.uK.value = R.noDust ? 0 : 0.85 * day * Lk.dust * liK; ATMO.dmat.uniforms.uT.value = now / 1000; try { ATMO.dmat.uniforms.uPx.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360)); } catch (e) {}
  };

  // ───────────────────────── 3. baked occlusion: crease strips ─────────────────────────
  // Rooms that bake no occlusion of their own (the shops, the client's generic rooms) get soft dark gradients where the walls meet the
  // floor and the ceiling and down the corners, a little warm (the floor's bounce): one multiply-blended mesh per room, built once
  // with the room, never touched per frame.
  var AOM = null;
  function aoMat() { if (AOM) return AOM; var o = { transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    if (RL.r16) { o.vertexShader = AO_VS_R; o.fragmentShader = AO_FS_R; AOM = new THREE.RawShaderMaterial(o); } else { o.vertexColors = true; o.toneMapped = false; o.fog = false; AOM = new THREE.MeshBasicMaterial(o); }   // R16: raw (see kitMat), the same output into the linear main target
    AOM.name = "rl_ao"; AOM.userData.avShared = true; AOM.userData.noSolid = true; AOM.userData.noWarm = true; return AOM; }
  RL.creaseAO = function (R, host, opt) {
    if (!RL.part.bake || !host) return null; opt = opt || {}; var t0 = performance.now(), b = opt.box || R.box, x0 = b[0], x1 = b[1], y0 = b[2] + 0.004, y1 = b[3] - 0.004, z0 = b[4], z1 = b[5];
    var P = [], C = [], I = [], k = opt.k || 0.42, F = opt.fw || 0.75, W = opt.ww || 0.7, CW = opt.cw || 0.5, TW = opt.tw || 0.5;
    var D = [1 - k * 0.92, 1 - k * 0.97, 1 - k], D2 = [1 - k * 0.7 * 0.92, 1 - k * 0.7 * 0.97, 1 - k * 0.7], WH = [1, 1, 1];
    function quad(a, b2, c, d, ca, cb, cc, cd) { var n = P.length / 3; P.push(a[0], a[1], a[2], b2[0], b2[1], b2[2], c[0], c[1], c[2], d[0], d[1], d[2]); C.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2], cd[0], cd[1], cd[2]); I.push(n, n + 1, n + 2, n, n + 2, n + 3); }
    var walls = [[[x0, z0], [x1, z0], [0, 1]], [[x1, z0], [x1, z1], [-1, 0]], [[x1, z1], [x0, z1], [0, -1]], [[x0, z1], [x0, z0], [1, 0]]], skip = opt.skip || [];
    for (var wi = 0; wi < 4; wi++) { if (skip.indexOf(wi) >= 0) continue; var A = walls[wi][0], B = walls[wi][1], n = walls[wi][2], ux = B[0] - A[0], uz = B[1] - A[1], L = Math.hypot(ux, uz); ux /= L; uz /= L;
      var a0 = [A[0] + n[0] * 0.012, A[1] + n[1] * 0.012], b0 = [B[0] + n[0] * 0.012, B[1] + n[1] * 0.012];
      quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0] + n[0] * F, y0, B[1] + n[1] * F], [A[0] + n[0] * F, y0, A[1] + n[1] * F], D, D, WH, WH);                       // the floor along the wall
      quad([a0[0], y0, a0[1]], [b0[0], y0, b0[1]], [b0[0], y0 + W, b0[1]], [a0[0], y0 + W, a0[1]], D, D, WH, WH);                                                 // the wall above the floor
      quad([A[0], y1, A[1]], [B[0], y1, B[1]], [B[0] + n[0] * TW, y1, B[1] + n[1] * TW], [A[0] + n[0] * TW, y1, A[1] + n[1] * TW], D2, D2, WH, WH);             // the ceiling along the wall
      quad([a0[0], y1, a0[1]], [b0[0], y1, b0[1]], [b0[0], y1 - TW, b0[1]], [a0[0], y1 - TW, a0[1]], D2, D2, WH, WH);                                             // the wall under the ceiling
      quad([a0[0], y0, a0[1]], [a0[0] + ux * CW, y0, a0[1] + uz * CW], [a0[0] + ux * CW, y1, a0[1] + uz * CW], [a0[0], y1, a0[1]], D2, WH, WH, D2);             // the corner at A
      quad([b0[0], y0, b0[1]], [b0[0] - ux * CW, y0, b0[1] - uz * CW], [b0[0] - ux * CW, y1, b0[1] - uz * CW], [b0[0], y1, b0[1]], D2, WH, WH, D2); }           // the corner at B
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I); g.computeBoundingSphere();
    var m = new THREE.Mesh(g, aoMat()); m.name = "rl crease ao"; m.renderOrder = 2; m.castShadow = false; m.receiveShadow = false; m.userData.noSolid = true; m.userData.rlNoFix = true;
    if (host === R.g) { if (R.y0) m.position.y = R.y0; } else { m.matrixAutoUpdate = false; m.matrix.copy(R.M); }
    host.add(m); RL.n.bakes++; RL.n.bakeMs = +(RL.n.bakeMs + performance.now() - t0).toFixed(2); return m;
  };

  // ───────────────────────── reflective floors (plan_gfx's screen-space floor reflections: high and ultra, no new program) ─────────────────────────
  var FLR = { h: null, R: null };
  // the room's floor height (room frame): given by the module that built the room (a scan of the room's triangles cost up to 0.1 s)
  function floorY(R) { return R.floorY === undefined ? null : R.floorY; }
  function floorBegin(R) {
    floorEnd(); var G = window.PLAN_GFX; if (!RL.part.floor || !G || !G.addReflectiveFloor || !(G.tier >= 2) || R.noFloor) return; var k = lookR(R).refl; if (!(k > 0.01)) return;
    var y = floorY(R); if (y === null || y === undefined) return; var b = R.box, cx = (b[0] + b[1]) / 2, cz = (b[4] + b[5]) / 2; _v.set(cx, y, cz).applyMatrix4(R.M); var wy = _v.y;
    var yaw = Math.atan2(R.M.elements[8], R.M.elements[0]), hx = (b[1] - b[0]) / 2 - 0.15, hz = (b[5] - b[4]) / 2 - 0.15, rr = Math.hypot(hx, hz);
    // plan_gfx tests the rectangle in a frame turned by its yaw: the room's own yaw (x across, z toward the door)
    try { FLR.h = G.addReflectiveFloor(R.g || scene, { y: wy, box: [_v.x - rr, _v.x + rr, _v.z - rr, _v.z + rr], center: [_v.x, _v.z], half: [hx, hz], yaw: yaw, strength: k, tint: 0.9, probe: false, minArea: 0.5 });   /* plan_gfx gives a given plane area 1 */ FLR.R = R; RL.n.floors = (RL.n.floors || 0) + 1; } catch (e) { note("floor", e); FLR.h = null; }
  }
  function floorEnd() { if (FLR.h) { try { FLR.h.remove(); } catch (e) {} FLR.h = null; FLR.R = null; } }

  // ───────────────────────── 5. grading ─────────────────────────
  var GRD = { on: false, k: 0, base: {}, set: {} };
  var GKEYS = ["uGSat", "uGSatLo", "uGCon"];
  function gradeFrame(R, dt) {
    var want = RL.part.grade && R ? 1 : 0; GRD.k += (want - GRD.k) * Math.min(1, (dt || 0.016) * 6); if (want && GRD.k > 0.98) GRD.k = 1; if (!want && GRD.k < 0.01) { gradeEnd(); return; }
    var Lk = R ? lookR(R) : GRD.lk || look("base", "auto"); if (R) GRD.lk = Lk; if (R) { GRD.type = R.type; GRD.mod = R.mod; } var k = GRD.k;
    try { if (typeof POST !== "undefined" && POST.exposure > 0) { if (R && LI.active(R)) { POST.exposure *= 1 + (0.9 / Math.max(0.5, 0.9 - 0.2 * nightK()) * Lk.ex - 1) * k; MT.base = POST.exposure; POST.exposure *= 1 + (MT.C - 1) * k; } else POST.exposure *= 1 + (Lk.ex * (1 + 0.2 * nightK()) - 1) * k; } } catch (e) {}   // the client drops the exposure at night for the sky; a lit room keeps most of it
    try { var F = POST && POST.mFinal && POST.mFinal.uniforms; if (!F || !F.uGSat) return; GRD.on = true;
      for (var i = 0; i < GKEYS.length; i++) { var n = GKEYS[i], u = F[n]; if (!u) continue; var v = u.value; if (GRD.set[n] === undefined || Math.abs(v - GRD.set[n]) > 1e-6) GRD.base[n] = v; var m = n === "uGCon" ? Lk.con : Lk.sat; GRD.set[n] = GRD.base[n] * (1 + (m - 1) * k); u.value = GRD.set[n]; }
      var wb = F.uGWB && F.uGWB.value; if (wb) { if (!GRD.wbSet || !wb.equals(GRD.wbSet)) { GRD.wbBase = (GRD.wbBase || new THREE.Vector3()).copy(wb); } var lw = R && LI.active(R) && LI.wbAdj ? LI.wbAdj : null; wb.set(GRD.wbBase.x * (1 + (Lk.wb[0] * (lw ? lw[0] : 1) - 1) * k), GRD.wbBase.y * (1 + (Lk.wb[1] - 1) * k), GRD.wbBase.z * (1 + (Lk.wb[2] * (lw ? lw[2] : 1) - 1) * k)); GRD.wbSet = (GRD.wbSet || new THREE.Vector3()).copy(wb); }
    } catch (e) { note("grade", e); }
  }
  function gradeEnd() { if (!GRD.on) return; try { var F = POST.mFinal.uniforms; for (var i = 0; i < GKEYS.length; i++) { var n = GKEYS[i]; if (F[n] && GRD.set[n] !== undefined && Math.abs(F[n].value - GRD.set[n]) < 1e-6) F[n].value = GRD.base[n]; } if (F.uGWB && GRD.wbSet && F.uGWB.value.equals(GRD.wbSet)) F.uGWB.value.copy(GRD.wbBase); } catch (e) {} GRD.on = false; GRD.set = {}; GRD.base = {}; GRD.wbSet = null; GRD.k = 0; }

  // ───────────────────────── 6. R16: surfaces (the room materials' PBR pass, high and ultra) ─────────────────────────
  // Every standard material of the R14 rooms (the venues' family, the shops' textured and plain families, the homes') gets one shader
  // pass, the same for all of them (one program per family, patched before it is first compiled, so the unpatched one is never made):
  //  - roughness from the normal map's alpha (authored per surface from its height and colour, below: grooves, grout and stains
  //    rougher, worn tops smoother), read from the normal map's own texel (no new fetch);
  //  - a micro-detail layer within 9 m (fine normal and roughness grain: wood pores, plaster, stone pits, metal scratches, fabric
  //    weave, leather pebble) projected on the room's own axes, plus a large soft smudge in the roughness (fingerprints, wear);
  //  - box-projected reflections of the room's own capture (the reflection sits where the walls are, as an interior reflection probe
  //    does) and the capture's irradiance as the room's bounce light (its own colour: red damask, green walls, warm floors), at the
  //    look's level instead of the sky's.
  // Textured materials without a normal map (the homes) get one derived from their colour (a worker, off the main thread); the
  // venues' and shops' painted normal maps get the roughness alpha the same way. ?ris=0: off.
  var SURF = RL.surf = { U: null, tex: {}, ready: 0, n: { mats: 0, skip: 0, compiled: 0, miss: 0, derive: 0, deriveMs: 0, swaps: 0, freed: 0, queued: 0 }, Q: [], wait: new Map(), done: new Map(), fly: new Map(), wk: null, busy: 0, seen: new WeakSet() };
  SURF.U = PREV && PREV.surf && PREV.surf.U ? PREV.surf.U : { uRiRot: { value: new THREE.Matrix3() }, uRiPos: { value: new THREE.Vector3() }, uRiMin: { value: new THREE.Vector3(-5, -1, -5) }, uRiMax: { value: new THREE.Vector3(5, 4, 5) }, uRiCap: { value: new THREE.Vector3() }, uRiOn: { value: new THREE.Vector4(0, 0, 1, 0) }, uRiPr: { value: new THREE.Vector4(0, 0, 0, 0) } };
  var DK = { wood: [4.0, 0.5, 0.55, 0.34], plaster: [2.5, 0.55, 0.3, 0.12], stone: [3.0, 0.34, 0.6, 0.42], metal: [5.0, 0.26, 0.8, 0.45], fabric: [8.0, 0.7, 0.2, 0.06], leather: [6.0, 0.6, 0.45, 0.2] };   // tiles a metre, normal, roughness grain, smudge
  // roughness alpha: [groove gain, darker-than-around gain, offset]; derived normal strength (colour-derived maps only)
  var RC = { wood: [0.55, 0.55, 0, 2.6], plaster: [0.3, 0.35, 0, 1.4], stone: [1.1, 0.35, 0, 3.4], metal: [0.9, 0.3, 0.02, 1.2], fabric: [0.3, 0.2, 0, 2.2], leather: [0.5, 0.3, 0, 2.0], photo: [0, 0, 0, 0] };
  if (!SURF.U.uRiPr) SURF.U.uRiPr = { value: new THREE.Vector4(0, 0, 0, 0) };
  if (PREV && PREV.surf && PREV.surf.tex) { SURF.tex = PREV.surf.tex; SURF.ready = PREV.surf.ready; SURF.seen = PREV.surf.seen || SURF.seen; }   // a module evaluated again (development) keeps the shared uniforms the patched programs read
  function detTex(kind) { var t = SURF.tex[kind]; if (t) return t; try { t = new THREE.TextureLoader().load((window.AV || String)("/tex/rl_det_" + kind + ".png?v=" + (window.BUILD || "r16i")), function () { SURF.ready++; }, undefined, function () { note("detail " + kind, "load failed"); }); } catch (e) { note("detail " + kind, e); t = new THREE.Texture(); }
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; t.name = "rl_det_" + kind; t.userData.avShared = true; SURF.tex[kind] = t; try { if (window.PLAN_ROOMS && PLAN_ROOMS.warm) PLAN_ROOMS.warm(t); } catch (e) {} return t; }
  // ── R18 (Agent I2): the prop layer. One shared 512 px pattern map (tex/rl_prop.png: R wood figure, G brushed metal, B weave, A mottle)
  // gives the plain (untextured) families of the R14 rooms real surfaces: wood grain on warm-hued paint and satin (furniture, crates,
  // shelves, frames), brush and mottle on painted pieces, brushed streaks, scratches and tarnish on metal, a weave on cloth, glaze
  // pooling on ceramics; plus, on every box the kits build (riE: face-local metres and half sizes), a rounded edge in the normal
  // (bevel highlights), edge wear and macro grime. Same shader text for every family (no new program), one fetch (two on ultra).
  function propTex() { var t = SURF.tex.prop; if (t) return t; try { t = new THREE.TextureLoader().load((window.AV || String)("/tex/rl_prop.png?v=" + (window.BUILD || "r18i2")), function () { SURF.propReady = true; }, undefined, function () { note("prop map", "load failed"); }); } catch (e) { note("prop map", e); t = new THREE.Texture(); }
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = RL.lite ? 4 : 8; t.name = "rl_prop"; t.userData.avShared = true; SURF.tex.prop = t; try { if (window.PLAN_ROOMS && PLAN_ROOMS.warm) PLAN_ROOMS.warm(t); } catch (e) {} return t; }
  RL.propTex = propTex;
  // [class, strength, scale, wear] [bevel, radius m, grime]: class 1 wood or paint by the colour's hue, 2 metal, 3 cloth, 4 glaze,
  // 5 leather and vinyl, 6 paint only, 7 a bottle (a printed paper label on the body band its lathe uvs mark: u = style + around, v 1..2); 0 = no pattern (textured families keep their maps and only get the bevels and grime)
  var PC = RL.PC = {
    paint: [1, 1, 1, 1], satin: [1, 0.9, 1, 0.8], matte: [1, 1, 1, 1], gloss: [1, 0.75, 1, 0.6], cloth: [3, 1, 1, 0.3], ceramic: [4, 1, 1, 0.2],
    brass: [2, 0.8, 1, 0.6], copper: [2, 0.9, 1, 0.7], gold: [2, 0.5, 1, 0.4], chrome: [2, 0.35, 1.4, 0.3], steel: [2, 0.8, 1, 0.5], iron: [2, 1.1, 0.8, 0.9], metal: [2, 0.9, 1, 0.6], bottleG: [7, 1, 1, 0],
    // the walk-ins' own (plan_interiors.js, ri_): upholstery, lacquer, stone, metals
    ebony: [1, 1, 1, 0.6], slate: [6, 0.8, 1, 0.3], hearth: [6, 0.8, 1, 0.3], blackL: [5, 1, 1, 0.5], green: [3, 1, 1, 0.3], navy: [3, 1, 1, 0.3], cream: [3, 1, 1, 0.3], rust: [3, 1, 1, 0.3], sage: [3, 1, 1, 0.3], char: [3, 1, 1, 0.3], teal: [3, 1, 1, 0.3], linen: [3, 0.8, 1, 0.2],
    bronze: [2, 0.9, 1, 0.6], brushed: [2, 0.9, 1, 0.4], white: [6, 0.7, 1, 0.5], black: [6, 0.7, 1, 0.6], pot: [4, 1.2, 1, 0.3]
  };
  // per-module overrides by full name (the hangars' painted tool chests, bins, cartons, upholstery)
  var PCX = RL.PCX = { rg_navy: [6, 0.9, 1, 0.7], rg_stellar: [6, 0.9, 1, 0.7], rg_red: [6, 0.9, 1, 0.8], rg_yellow: [6, 0.9, 1, 0.8], rg_orange: [6, 0.9, 1, 0.8], rg_white: [6, 0.8, 1, 0.6], rg_black: [6, 0.8, 1, 0.6],
    rg_truss: [2, 0.7, 0.8, 0.5], rg_dado: [2, 0.8, 1, 0.6], rg_housing: [2, 0.8, 1, 0.5], rg_rubber: [5, 1, 1, 0.2], rg_box: [6, 1.3, 1, 0.9], rg_bin: [6, 0.8, 1, 0.6], rg_bin2: [6, 0.8, 1, 0.6], rg_fabric: [3, 1, 1, 0.3], rg_fabric2: [3, 1, 1, 0.3] };
  function propCat(nm, m) {
    var k = nm.replace(/^(rv |rs_|rh_|ri_|rg_)/, ""), tex = !!(m.map && !tinyTex(m.map)), c = !tex && (PCX[nm] || PC[k]) ? (PCX[nm] || PC[k]) : [0, 0, 1, 0];
    if (/^(r[ig]_)(lamp|lampC|lampW|shade|strip|ember|line|brand|photos|bottles|books|wine|shop|art\d|rug\d|plate_|menu_|easel|leaf|soil|housing)/.test(nm)) return [[0, 0, 1, 0], [0, 0, 0, 0]];
    if (/mirror|sheet_|^art|^stock|^sign|^screen|^paint(Air|Chir)$|^mural|^retablo|^wanted|^tack|^bottles|^logo|^books|^keys|^pianokeys|^clock|^topo|^flag|^rug|^runner|lamp|neon|candle|ember|glow|fire|glass/.test(k)) return [[0, 0, 1, 0], [0, 0, 0, 0]];
    if (c[0] === 7) return [c, [0, 0, 0, 0]]; var bev = c[0] === 2 ? 0.9 : c[0] === 3 ? 0.35 : 0.75, rad = c[0] === 3 ? 0.03 : c[0] === 2 ? 0.006 : 0.011; if (c[0] === 3) bev = 1;
    return [c, [bev, rad, tex ? 0.6 : 1, 0]];
  }
  // a material's family by its module's name for it: [detail kind, normal, grain, smudge, roughness-alpha kind]
  function surfCat(nm) {
    var k = nm.replace(/^(rv |rs_|rh_|ri_|rg_)/, "");
    if (/^sheet_|^art$|^stock$|^paint(Air|Chir)$|^mural|^retablo|^art[ABC]$|^wanted|^tack|^bottles|^logo|^books|^keys|^pianokeys|^clock|^topo|^flagAZ|^sign|^screen|^facade/.test(k)) return ["plaster", 0.06, 0.1, 0.05, "photo"];
    if (/lamp|neon|candle|ember|glow|fire/.test(k)) return ["plaster", 0, 0, 0, "photo"];
    if (/mirror/.test(k)) return ["metal", 0.12, 0.25, 1.4, "photo"];   // an old silvered mirror: its own fake as the tarnish, smudges
    if (/bottle|glass/.test(k)) return ["stone", 0.03, 0.1, 0.5, "photo"];
    if (/plank|oak|barn|pine|bark|latill|^strip|^grain|^bead|shiplap|^wood|^logs|walnut|ebony|burl/.test(k)) return ["wood", 1, 1, 1, "wood"];
    if (/^tin$|brass|copper|chrome|iron|steel|gold|^metal|mirror/.test(k)) return ["metal", 1, 1, 1, "metal"];
    if (/marble|inlay|checker|^hex|terra|saltillo|^stone|brick|concrete|ceramic|trav/.test(k)) return ["stone", 1, 1, 1, "stone"];
    if (/tufted|vinyl|leather/.test(k)) return ["leather", 1, 1, 1, "leather"];
    if (/felt|cloth|^rug|runner|^hay|canvas|fabric|weave/.test(k)) return ["fabric", 1, 1, 1, "fabric"];
    if (/plaster|damask|stripe|diamond|paint|satin|gloss|matte|pegboard/.test(k)) return ["plaster", 1, 1, 1, "plaster"];
    return ["plaster", 0.5, 0.6, 0.6, "plaster"];
  }
  var PATCH = null;
  function buildPatch() {
    if (PATCH) return PATCH; var C = THREE.ShaderChunk, nfm = C.normal_fragment_maps, env = C.envmap_physical_pars_fragment, miss = 0, lite = !!RL.lite, PATCH_LITE = lite;   // high: the cheaper version (decided with the tier, as the key is)
    var A0 = "vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;"; if (nfm.indexOf(A0) >= 0) nfm = nfm.replace(A0, "vec4 riNA = texture2D( normalMap, vNormalMapUv ); vec3 mapN = riNA.xyz * 2.0 - 1.0;"); else miss++;
    var B0 = "return PI * envMapColor.rgb * envMapIntensity;"; if (env.indexOf(B0) >= 0) env = env.replace(B0, "return PI * envMapColor.rgb * mix( envMapIntensity, uRiOn.z, uRiOn.y );"); else miss++; var envLi = env.replace("mix( envMapIntensity, uRiOn.z, uRiOn.y );", "mix( envMapIntensity, uRiOn.z, uRiOn.y ) * ( 1.0 - uLiOn.y );");
    var B1 = "reflectVec = inverseTransformDirection( reflectVec, viewMatrix );"; if (env.indexOf(B1) >= 0) env = env.replace(B1, B1 + "\n\t\treflectVec = riBox( reflectVec );"); else miss++;
    var PARS = [
      "uniform mat3 uRiRot; uniform vec3 uRiPos; uniform vec3 uRiMin; uniform vec3 uRiMax; uniform vec3 uRiCap; uniform vec4 uRiOn;",
      "uniform sampler2D tRiD; uniform vec4 uRiM; uniform vec4 uRiS;",
      "uniform sampler2D tRiP; uniform vec4 uRiP; uniform vec4 uRiQ; uniform vec4 uRiPr; RI_VARY",
      "vec3 riWP() { return ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz + cameraPosition; }",
      "vec3 riBox( vec3 v ) { if ( uRiOn.x < 0.5 ) return v; vec3 lp = uRiRot * ( riWP() - uRiPos ), nd = uRiRot * v;",
      "  vec3 dd = vec3( nd.x >= 0.0 ? max( nd.x, 1e-4 ) : min( nd.x, -1e-4 ), nd.y >= 0.0 ? max( nd.y, 1e-4 ) : min( nd.y, -1e-4 ), nd.z >= 0.0 ? max( nd.z, 1e-4 ) : min( nd.z, -1e-4 ) );",
      "  vec3 tf = max( ( uRiMax - lp ) / dd, ( uRiMin - lp ) / dd ); float t = max( 0.0, min( min( tf.x, tf.y ), tf.z ) );",
      "  return normalize( transpose( uRiRot ) * ( lp + nd * t - uRiCap ) ); }"].join("\n");
    var DET = [
      "#ifdef USE_NORMALMAP_TANGENTSPACE",
      "\troughnessFactor *= mix( 1.0, 0.5 + riNA.a, uRiM.w );",
      "#endif",
      "{",
      lite ? "\tfloat riK = uRiOn.w * ( 1.0 - smoothstep( 1.5, 6.0, length( vViewPosition ) ) );" : "\tfloat riK = uRiOn.w * ( 1.0 - smoothstep( 3.0, 11.0, length( vViewPosition ) ) );",
      "\tvec3 riL = uRiRot * ( riWP() - uRiPos );",
      "\tvec3 riG = uRiRot * normalize( ( vec4( nonPerturbedNormal, 0.0 ) * viewMatrix ).xyz ); vec3 riA = abs( riG );",
      "\tvec2 riUV; vec3 riT, riB;",
      "\tif ( riA.y >= riA.x && riA.y >= riA.z ) { riUV = riL.xz; riT = vec3( 1.0, 0.0, 0.0 ); riB = vec3( 0.0, 0.0, 1.0 ); }",
      "\telse if ( riA.x >= riA.z ) { riUV = riL.zy; riT = vec3( 0.0, 0.0, 1.0 ); riB = vec3( 0.0, 1.0, 0.0 ); }",
      "\telse { riUV = riL.xy; riT = vec3( 1.0, 0.0, 0.0 ); riB = vec3( 0.0, 1.0, 0.0 ); }",
      "\tvec4 riD = texture2D( tRiD, riUV * uRiS.x );",
      lite ? "\tfloat riSm = 0.0;" : "\tfloat riSm = ( texture2D( tRiD, riUV * ( uRiS.x * uRiS.y ) + vec2( 0.37, 0.61 ) ).a - 0.625 ) * 2.6667;",   // high: no smudge layer (one fetch less)
      "\tmat3 riR = transpose( uRiRot ); vec3 riTv = ( viewMatrix * vec4( riR * riT, 0.0 ) ).xyz, riBv = ( viewMatrix * vec4( riR * riB, 0.0 ) ).xyz;",
      "\tvec2 riDN = ( riD.xy * 2.0 - 1.0 ) * ( uRiM.x * riK );",
      "\tnormal = normalize( normal + riDN.x * riTv + riDN.y * riBv );",
      "\troughnessFactor = clamp( roughnessFactor * ( 1.0 + uRiM.y * riK * ( riD.b * 2.0 - 1.0 ) + uRiM.z * uRiOn.w * riSm ), 0.03, 1.0 );",
      "}"].join("\n");
    var PROP = [
      "if ( uRiPr.x + uRiPr.y > 0.0 && ( uRiP.x > 0.5 ? uRiP.y > 0.0 : ( vRiE.w > 1.5 && uRiQ.x + uRiQ.z > 0.0 ) ) ) {",
      "\tvec3 pL = uRiRot * ( riWP() - uRiPos ); vec3 pG = uRiRot * normalize( ( vec4( nonPerturbedNormal, 0.0 ) * viewMatrix ).xyz ); vec3 pA = abs( pG );",
      "\tbool pBox = vRiE.w > 1.5; vec2 pH = abs( vec2( vRiE.z, vRiE.w - 2.0 ) ); vec2 pUV; float pSd = 0.0;",
      // a box face: its own metres, the pattern's x (the grain) along the face's longer side, an offset per face plane and size
      "\tif ( pBox ) { pUV = pH.x >= pH.y ? vRiE.xy : vRiE.yx; pSd = fract( sin( dot( vec3( dot( pL, pG ), pH ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ); }",
      // anything else: the room's axes (grain upright on sides: legs, posts, turned work; along the room on tops)
      "\telse if ( pA.y >= pA.x && pA.y >= pA.z ) pUV = pL.xz; else if ( pA.x >= pA.z ) pUV = pL.yz; else pUV = pL.yx;",
      "\tpUV += pSd * vec2( 7.31, 3.17 );",
      "\tfloat pCl = uRiP.x, pK = uRiP.y * uRiPr.x; vec2 pS = ( pCl < 1.5 || pCl > 5.5 ) ? vec2( 1.15, 1.9 ) : pCl < 2.5 ? vec2( 0.9, 2.6 ) : pCl < 3.5 ? vec2( 3.4, 3.4 ) : vec2( 1.3, 1.3 );",
      "\tvec4 pT = pCl > 0.5 ? texture2D( tRiP, pUV * pS * uRiP.z ) : vec4( 0.5 );",
      PATCH_LITE ? "\tfloat pM = 0.5;" : "\tfloat pM = uRiPr.z > 0.5 ? texture2D( tRiP, ( pBox ? pUV : pL.xz + pL.y * 0.37 ) * 0.17 + vec2( 0.41, 0.23 ) ).a : 0.5;",
      "\tvec3 pC = diffuseColor.rgb; float pMx = max( pC.r, max( pC.g, pC.b ) ), pMn = min( pC.r, min( pC.g, pC.b ) ), pSat = ( pMx - pMn ) / max( pMx, 1e-4 ), pGr = pC.g / max( pC.r, 1e-4 );",
      // wood by hue: warm (r >= g >= b), saturated but not a red or orange enamel, any brightness up to pale pine
      "\tfloat pWd = pCl < 1.5 && pBox ? step( pC.b, pC.g * 1.04 ) * step( pC.g, pC.r * 1.02 ) * smoothstep( 0.14, 0.32, pSat ) * ( 1.0 - smoothstep( 0.8, 0.95, pSat ) ) * smoothstep( 0.22, 0.38, pGr ) * ( 1.0 - smoothstep( 0.86, 0.97, pGr ) ) : 0.0;",
      // the bevel: face-local derivatives give the face's axes; a rounded edge of radius r tilts the normal outward (fades when sub-pixel)
      "\tfloat pE = 0.0;",
      "\tif ( pBox && vRiE.z > 0.0 && uRiPr.y > 0.0 && uRiQ.x > 0.0 ) {",
      "\t\tvec3 pP = - vViewPosition, d1 = dFdx( pP ), d2 = dFdy( pP ); vec2 e1 = dFdx( vRiE.xy ), e2 = dFdy( vRiE.xy );",
      "\t\tvec3 q1 = cross( d2, nonPerturbedNormal ), q2 = cross( nonPerturbedNormal, d1 ); vec3 tU = q1 * e1.x + q2 * e2.x, tV = q1 * e1.y + q2 * e2.y;",
      "\t\ttU *= inversesqrt( max( dot( tU, tU ), 1e-24 ) ); tV *= inversesqrt( max( dot( tV, tV ), 1e-24 ) );",
      "\t\tfloat pr = min( uRiQ.y, ( pCl > 2.5 && pCl < 3.5 ? 0.5 : 0.4 ) * min( pH.x, pH.y ) ); vec2 fw = fwidth( vRiE.xy ); float vis = smoothstep( 0.7, 1.8, pr / max( max( fw.x, fw.y ), 1e-6 ) );",
      "\t\tvec2 pd = pH - abs( vRiE.xy ); vec2 pb = 1.0 - smoothstep( vec2( 0.0 ), vec2( pr ), pd ); pb *= pb * ( 2.0 - pb );",
      "\t\tnormal = normalize( normal + ( sign( vRiE.x ) * pb.x * tU + sign( vRiE.y ) * pb.y * tV ) * ( 0.95 * uRiQ.x * vis * uRiPr.y ) );",
      "\t\tpE = max( pb.x, pb.y ) * vis * uRiPr.y; pE = max( pE, ( 1.0 - smoothstep( 0.0, pr * 3.5, min( pd.x, pd.y ) ) ) * 0.45 * vis * uRiPr.y );",
      "\t}",
      "\tfloat pMod = 1.0, pRo = 1.0, pWear = uRiP.w * pE * smoothstep( 0.25, 0.75, pT.a );",
      "\tif ( pCl > 0.5 && pCl < 1.5 || pCl > 5.5 ) {",
      "\t\tfloat wg = 0.5 + 0.62 * pT.r, pn = 1.0 + 0.3 * ( pT.a - 0.5 ) + 0.08 * ( pT.g - 0.5 );",
      "\t\tpMod = mix( pn, wg, pWd ); pRo = mix( 1.0 + 0.32 * ( pT.a - 0.5 ), 1.0 + 0.35 * ( 0.72 - pT.r ), pWd );",
      "\t\tdiffuseColor.rgb *= mix( vec3( 1.0 ), mix( vec3( 1.0 ), vec3( 1.04, 0.98, 0.9 ), pWd ) * pMod, pK );",
      "\t\tdiffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * mix( 1.38, 1.22, pWd ) + 0.015, pWear * pK );",   // worn edges: paint thinned to its ground, varnish rubbed
      "\t\troughnessFactor *= mix( 1.0, pRo, pK ) * ( 1.0 + 0.25 * pWear * pK );",
      "\t} else if ( pCl < 2.5 ) {",
      "\t\tdiffuseColor.rgb *= 1.0 + pK * ( 0.2 * ( pT.g - 0.5 ) - 0.22 * smoothstep( 0.45, 0.9, pM ) );",
      "\t\troughnessFactor *= mix( 1.0, ( 0.62 + 0.75 * pT.g ) * ( 1.0 + 0.5 * smoothstep( 0.5, 0.95, pM ) ) * ( 1.0 - 0.45 * pE ), pK );",
      "\t} else if ( pCl < 3.5 ) {",
      "\t\tdiffuseColor.rgb *= mix( 1.0, ( 0.7 + 0.46 * pT.b ) * ( 1.0 + 0.22 * ( pT.a - 0.5 ) ), pK ); roughnessFactor = mix( roughnessFactor, max( roughnessFactor, 0.82 + 0.15 * pT.b ), pK );",
      "\t} else if ( pCl < 4.5 ) {",
      "\t\tdiffuseColor.rgb *= 1.0 + pK * 0.1 * ( pT.a - 0.5 ); roughnessFactor *= mix( 1.0, 0.75 + 0.5 * pT.a, pK );",
      "\t} else {",
      "\t\tdiffuseColor.rgb *= 1.0 + pK * 0.24 * ( pT.a - 0.5 ); roughnessFactor *= mix( 1.0, 0.8 + 0.4 * pT.a + 0.2 * pE, pK );",
      "\t}",
      // a bottle's label: paper in one of six styles, a border, a title in blocks, small print (anti-aliased by its footprint)
      "#ifdef USE_MAP",
      "	if ( pCl > 6.5 && pK > 0.0 ) { vec2 lu = vec2( fract( vMapUv.x ), vMapUv.y - 1.0 ); float sty = mod( floor( vMapUv.x ), 6.0 );",
      "		if ( lu.y > 0.14 && lu.y < 0.82 && lu.x > 0.04 && lu.x < 0.6 ) { vec2 q = vec2( ( lu.x - 0.04 ) / 0.56, ( lu.y - 0.14 ) / 0.68 );",
      "			vec3 pap = sty < 1.5 ? vec3( 0.72, 0.6, 0.38 ) : sty < 2.5 ? vec3( 0.82, 0.78, 0.68 ) : sty < 3.5 ? vec3( 0.42, 0.06, 0.04 ) : sty < 4.5 ? vec3( 0.05, 0.05, 0.06 ) : vec3( 0.6, 0.66, 0.5 );",
      "			vec3 ink = sty > 2.5 && sty < 4.5 ? vec3( 0.75, 0.56, 0.22 ) : vec3( 0.06, 0.04, 0.03 );",
      "			float aa = clamp( 1.6 - fwidth( q.x * 22.0 ) * 2.0, 0.0, 1.0 ), aa2 = clamp( 1.6 - fwidth( q.x * 9.0 ) * 2.0, 0.0, 1.0 );",
      "			float brd = 1.0 - step( 0.05, q.x ) * step( q.x, 0.95 ) * step( 0.06, q.y ) * step( q.y, 0.94 );",
      "			float row = step( 0.56, q.y ) * step( q.y, 0.76 ) * step( 0.14, q.x ) * step( q.x, 0.86 ); float lt = row * mix( 0.5, step( 0.3, fract( q.x * 9.0 + sty * 0.21 ) ) * step( fract( q.x * 9.0 + sty * 0.21 ), 0.86 ), aa2 );",
      "			float sm = step( 0.2, q.y ) * step( q.y, 0.46 ) * step( 0.18, q.x ) * step( q.x, 0.82 ) * mix( 0.3, step( 0.55, fract( q.y * 11.0 ) ) * step( 0.32, fract( q.x * 22.0 + floor( q.y * 11.0 ) * 0.37 ) ), aa );",
      "			float em = 1.0 - smoothstep( 0.08, 0.11, length( ( q - vec2( 0.5, 0.86 ) ) * vec2( 1.0, 2.4 ) ) );",
      "			diffuseColor.rgb = mix( pap, ink, clamp( max( max( brd * 0.85, lt ), max( sm * 0.75, em * 0.8 ) ), 0.0, 1.0 ) ) * ( 0.88 + 0.24 * pT.a ); roughnessFactor = 0.68; metalnessFactor = 0.0; } }",
      "#endif",
      // macro grime and handling: a soft large blotch darkens and roughens (ultra)
      "\tfloat pGm = uRiQ.z * uRiPr.z * smoothstep( 0.42, 0.92, pM );",
      "\tif ( uRiPr.w > 0.5 ) diffuseColor.rgb = vec3( pE, pWd, pBox ? 0.6 : 0.0 );",
      "\tdiffuseColor.rgb *= ( 1.0 - 0.2 * pGm ) * ( pBox && pCl > 0.5 ? 1.0 + 0.1 * ( pSd - 0.5 ) * pK : 1.0 ); roughnessFactor = clamp( roughnessFactor * ( 1.0 + 0.18 * pGm ), 0.03, 1.0 );",
      "}"].join("\n");
    SURF.n.miss = miss; PATCH = { nfm: nfm, env: env, envLi: envLi, pars: PARS, det: DET + "\n" + PROP, ok: miss === 0, lite: lite }; return PATCH;
  }
  // (the material is passed in: the client's CSM material classes chain hooks and older ones drop "this")
  function surfOBC(m, sh, r) {
    var u = m.userData.riU; if (m.userData.riPrev) { try { m.userData.riPrev.call(m, sh, r); } catch (e) { note("surf prev", e); } } if (!u) return; var P = buildPatch(); if (!P.ok) return;
    for (var k in SURF.U) sh.uniforms[k] = SURF.U[k]; sh.uniforms.tRiD = u.tRiD; sh.uniforms.uRiM = u.uRiM; sh.uniforms.uRiS = u.uRiS;
    sh.uniforms.tRiP = u.tRiP || { value: propTex() }; sh.uniforms.uRiP = u.uRiP || { value: new THREE.Vector4() }; sh.uniforms.uRiQ = u.uRiQ || { value: new THREE.Vector4() };
    var vs = sh.vertexShader, vary = "varying vec4 vRiE;";
    if (vs.indexOf("#include <common>") >= 0 && vs.indexOf("#include <begin_vertex>") >= 0) sh.vertexShader = vs.replace("#include <common>", "#include <common>\nattribute vec4 riE;\nvarying vec4 vRiE;").replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvRiE = riE;");
    else vary = "const vec4 vRiE = vec4( 0.0 );";
    var fs = sh.fragmentShader;
    if (fs.indexOf("#include <normal_fragment_maps>") < 0 || fs.indexOf("#include <envmap_physical_pars_fragment>") < 0 || fs.indexOf("#include <common>") < 0) { SURF.n.miss++; return; }
    var useLi = LI.hi && liCan(fs);   // R19 LI: the room's own sources (lights_fragment_begin / end)
    sh.fragmentShader = fs.replace("#include <common>", "#include <common>\n" + P.pars.replace("RI_VARY", vary)).replace("#include <envmap_physical_pars_fragment>", useLi ? P.envLi : P.env).replace("#include <normal_fragment_maps>", P.nfm + "\n" + P.det);
    if (useLi) liPatch(sh, true);
  }
  function surfKey() { var p = this.userData.riPrevKey ? this.userData.riPrevKey.call(this) : ""; return p + (RL.lite ? "|ri18p1h" : "|ri18p1") + (LI.hi ? "|li19" : ""); }
  function tinyTex(t) { var im = t && (t.image || (t.source && t.source.data)) || {}; return !((im.width || 0) > 8); }
  var FLATN = null;   // a flat normal with a neutral roughness alpha: the placeholder until a derived map is ready
  function flatN() { if (FLATN) return FLATN; FLATN = new THREE.DataTexture(new Uint8Array([128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255, 128]), 2, 2); FLATN.needsUpdate = true; FLATN.wrapS = FLATN.wrapT = THREE.RepeatWrapping; FLATN.userData.avShared = true; FLATN.name = "rl flat normal"; return FLATN; }
  // patch one material (only before its first compile: a material that already has a program keeps it, so nothing compiles twice)
  RL.surfMat = function (m, opt) {
    if (!RL.part.surf || !RL.tierDone || !m || SURF.seen.has(m)) return false; SURF.seen.add(m);
    if (!m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.transparent || m.alphaTest > 0 || m.userData.riU || m.userData.riNo) { SURF.n.skip++; return false; }
    var nm = m.name || ""; if (!(opt && opt.cat) && (!/^(rv |rs_|rh_|ri_|rg_)/.test(nm) || /^rs_facade/.test(nm))) { SURF.n.skip++; return false; }
    try { var pr = renderer.properties.get(m); if (pr && pr.currentProgram) { SURF.n.compiled++; return false; } } catch (e) {}
    var c = surfCat(nm), d = DK[c[0]]; var u = { tRiD: { value: detTex(c[0]) }, uRiM: { value: new THREE.Vector4(d[1] * c[1], d[2] * c[2], d[3] * c[3], 0) }, uRiS: { value: new THREE.Vector4(d[0], 0.083, 0, 0) } };
    var pc = opt && opt.cat ? [opt.cat, opt.flat ? [0, 0, 0, 0] : [opt.cat[0] === 2 ? 0.9 : opt.cat[0] === 3 ? 1 : 0.75, opt.cat[0] === 3 ? 0.03 : opt.cat[0] === 2 ? 0.006 : 0.011, 1, 0]] : propCat(nm, m); u.tRiP = { value: propTex() }; u.uRiP = { value: new THREE.Vector4(pc[0][0], pc[0][1], pc[0][2], pc[0][3]) }; u.uRiQ = { value: new THREE.Vector4(pc[1][0], pc[1][1], pc[1][2], pc[1][3]) };
    m.userData.riU = u; m.userData.riCat = c; m.userData.riProp = pc;
    // the client's CSM material class (high, ultra) runs its own hook first and keeps one user hook (_userObc): chain only that one
    if ("_csmObc" in m || "_userObc" in m) { if (m._userObc) m.userData.riPrev = m._userObc; } else if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) m.userData.riPrev = m.onBeforeCompile;
    if (m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) m.userData.riPrevKey = m.customProgramCacheKey;
    m.onBeforeCompile = function (sh, r) { surfOBC(m, sh, r); }; m.customProgramCacheKey = surfKey;
    if (/mirror/.test(nm)) { m.roughness = Math.min(m.roughness, 0.045); m.metalness = 1; m.emissiveIntensity *= 0.22; if (m.userData.k0) m.userData.k0 *= 0.22; }   // a real mirror now: the room's box-projected capture, its painted fake as the tarnish
    if (m.map && (!m.normalMap || tinyTex(m.normalMap))) { m.normalMap = flatN(); u.uRiM.value.w = 1; }   // no normal map (the homes) or a flat placeholder: one derived from the colour follows
    if (m.map && c[4] !== "photo") surfQueue(m, c[4]);
    m.needsUpdate = true; SURF.n.mats++; return true;
  };
  // everything a module has made so far (its cache: materials two levels deep), or a built room
  RL.surfScan = function (x) { if (!RL.part.surf || !x) return 0; var n = 0; function one(m) { if (m && m.isMaterial && RL.surfMat(m)) n++; }
    if (x.isObject3D) { x.traverse(function (o) { var ms = o.material; if (!ms) return; if (Array.isArray(ms)) ms.forEach(one); else one(ms); }); return n; }
    if (x.isMaterial) { one(x); return n; } for (var k in x) { var v = x[k]; if (v && v.isMaterial) one(v); } return n; };
  // ── the derived maps: normal (from the painter's own normal map, or from the colour's luminance) plus the roughness alpha ──
  var WK_SRC = [
    "self.onmessage = function (e) { var d = e.data, W = d.w, H = d.h, N = W * H, t0 = Date.now();",
    " var oc = new OffscreenCanvas(W, H), cx = oc.getContext('2d', { willReadFrequently: true }); cx.drawImage(d.a, 0, 0, W, H); var A = cx.getImageData(0, 0, W, H).data; if (d.a.close) d.a.close();",
    " var NM = null; if (d.n) { cx.clearRect(0, 0, W, H); cx.drawImage(d.n, 0, 0, W, H); NM = cx.getImageData(0, 0, W, H).data; if (d.n.close) d.n.close(); }",
    " var L = new Float32Array(N); for (var i = 0; i < N; i++) L[i] = (0.2126 * A[i * 4] + 0.7152 * A[i * 4 + 1] + 0.0722 * A[i * 4 + 2]) / 255;",
    " function blur(s, r) { var t = new Float32Array(N), o = new Float32Array(N), k = 1 / (2 * r + 1); for (var y = 0; y < H; y++) { var row = y * W, acc = 0; for (var x = -r; x <= r; x++) acc += s[row + ((x % W) + W) % W]; for (var x2 = 0; x2 < W; x2++) { t[row + x2] = acc * k; acc += s[row + (x2 + r + 1) % W] - s[row + ((x2 - r) % W + W) % W]; } }",
    "   for (var x3 = 0; x3 < W; x3++) { var acc2 = 0; for (var y2 = -r; y2 <= r; y2++) acc2 += t[(((y2 % H) + H) % H) * W + x3]; for (var y3 = 0; y3 < H; y3++) { o[y3 * W + x3] = acc2 * k; acc2 += t[((y3 + r + 1) % H) * W + x3] - t[(((y3 - r) % H + H) % H) * W + x3]; } } return o; }",
    " var nx = new Float32Array(N), ny = new Float32Array(N), cav = new Float32Array(N), q = d.q;",
    " if (NM) { for (var j = 0; j < N; j++) { nx[j] = NM[j * 4] / 127.5 - 1; ny[j] = NM[j * 4 + 1] / 127.5 - 1; }",
    "   for (var y4 = 0; y4 < H; y4++) for (var x4 = 0; x4 < W; x4++) { var p = y4 * W + x4, xp = y4 * W + (x4 + 1) % W, xm = y4 * W + (x4 - 1 + W) % W, yp = ((y4 + 1) % H) * W + x4, ym = ((y4 - 1 + H) % H) * W + x4; cav[p] = (-(nx[xp] - nx[xm]) + (ny[yp] - ny[ym])) * 2.5; } }",
    " else { var hb = blur(L, 1), hl = blur(L, Math.max(4, W >> 5)); var h = new Float32Array(N); for (var j2 = 0; j2 < N; j2++) h[j2] = hb[j2] - hl[j2];",
    "   var hc = blur(h, 3); for (var y5 = 0; y5 < H; y5++) for (var x5 = 0; x5 < W; x5++) { var p2 = y5 * W + x5, xp2 = (x5 + 1) % W, xm2 = (x5 - 1 + W) % W, yp2 = ((y5 + 1) % H) * W, ym2 = ((y5 - 1 + H) % H) * W, y0 = y5 * W;",
    "     var dx = (h[ym2 + xp2] + 2 * h[y0 + xp2] + h[yp2 + xp2]) - (h[ym2 + xm2] + 2 * h[y0 + xm2] + h[yp2 + xm2]), dy = (h[yp2 + xm2] + 2 * h[yp2 + x5] + h[yp2 + xp2]) - (h[ym2 + xm2] + 2 * h[ym2 + x5] + h[ym2 + xp2]);",
    "     var vx = -dx * q[3] * (W / 256), vy = dy * q[3] * (W / 256), l = 1 / Math.sqrt(vx * vx + vy * vy + 1); nx[p2] = vx * l; ny[p2] = vy * l; cav[p2] = (hc[p2] - h[p2]) * 9; } }",
    " var lb = blur(L, Math.max(3, W >> 6)), out = new Uint8Array(N * 4);",
    " for (var y6 = 0; y6 < H; y6++) { var dst = (H - 1 - y6) * W; for (var x6 = 0; x6 < W; x6++) { var s = y6 * W + x6, o4 = (dst + x6) * 4; var X = nx[s], Y = ny[s], Z = Math.sqrt(Math.max(0, 1 - X * X - Y * Y));",
    "   var c1 = Math.max(-1, Math.min(1, cav[s])), c2 = Math.max(-1, Math.min(1, (lb[s] - L[s]) * 3)); var a = 0.5 + 0.5 * (q[0] * c1 + q[1] * c2) + q[2]; a = a < 0.25 ? 0.25 : a > 1 ? 1 : a;",
    "   out[o4] = (X * 0.5 + 0.5) * 255 + 0.5; out[o4 + 1] = (Y * 0.5 + 0.5) * 255 + 0.5; out[o4 + 2] = (Z * 0.5 + 0.5) * 255 + 0.5; out[o4 + 3] = a * 255 + 0.5; } }",
    " self.postMessage({ id: d.id, w: W, h: H, buf: out.buffer, ms: Date.now() - t0 }, [out.buffer]); };"].join("\n");
  function imgOf(t) { var im = t && (t.image || (t.source && t.source.data)); if (!im) return null; if (typeof HTMLCanvasElement !== "undefined" && im instanceof HTMLCanvasElement) return im.width > 8 ? im : null; if (typeof HTMLImageElement !== "undefined" && im instanceof HTMLImageElement) return im.complete && im.naturalWidth > 8 ? im : null; if (typeof ImageBitmap !== "undefined" && im instanceof ImageBitmap) return im.width > 8 ? im : null; return null; }
  function canRead(t) { var im = t && (t.image || (t.source && t.source.data)); return !!im && !t.isCompressedTexture && !t.isDataTexture && ((typeof HTMLCanvasElement !== "undefined" && im instanceof HTMLCanvasElement) || (typeof HTMLImageElement !== "undefined" && im instanceof HTMLImageElement) || (typeof ImageBitmap !== "undefined" && im instanceof ImageBitmap)); }
  function surfQueue(m, rk) { if (m.map.flipY === false || !canRead(m.map) || tinyTex(m.map) || (m.normalMap && m.normalMap !== FLATN && (m.normalMap.flipY === false || !canRead(m.normalMap)))) { if (m.normalMap === FLATN) m.userData.riU.uRiM.value.w = 1; return; } var key = m.map.uuid + "|" + (m.normalMap && m.normalMap !== FLATN ? m.normalMap.uuid : "-") + "|" + rk; var L = SURF.wait.get(key); if (!L) { L = []; SURF.wait.set(key, L); SURF.Q.push({ key: key, m: m, map: m.map, nrm: m.normalMap && m.normalMap !== FLATN ? m.normalMap : null, rk: rk, t: 0 }); SURF.n.queued++; } L.push(m); var D = SURF.done.get(key); if (D) surfApply(key, D); }
  function surfApply(key, tex) { var L = SURF.wait.get(key) || []; for (var i = 0; i < L.length; i++) { var m = L[i], old = m.normalMap; if (old === tex) continue; m.normalMap = tex; m.userData.riU.uRiM.value.w = 1; SURF.n.swaps++; if (old && old !== FLATN) surfFree(old); } }
  // a painter's normal map nothing draws with any more goes from the GPU (its canvas stays with the module, for its own use)
  function surfFree(old) { var used = false; try { var chk = function (c) { if (!c || used) return; for (var k in c) { var v = c[k]; if (v && v.isMaterial && v.normalMap === old) { used = true; return; } } }; var V = window.PLAN_ROOMS_VENUES, S = window.PLAN_ROOMS_SHOPS, H = window.PLAN_RH; chk(V && V.MT); chk(S && S.mat); chk(H && H.mt); } catch (e) {} if (!used) { old.userData.noWarm = true; try { old.dispose(); } catch (e) {} SURF.n.freed++; } }
  function surfWorker() { if (SURF.wk || SURF.wkBad) return SURF.wk; try { if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") { SURF.wkBad = true; return null; } var u = URL.createObjectURL(new Blob([WK_SRC], { type: "text/javascript" })); SURF.wk = new Worker(u);
      SURF.wk.onmessage = function (e) { var d = e.data, J = SURF.fly.get(d.id); SURF.fly.delete(d.id); if (SURF.busy && SURF.busy.id === d.id) SURF.busy = 0; if (!J) return; try { var t = new THREE.DataTexture(new Uint8Array(d.buf), d.w, d.h, THREE.RGBAFormat); t.wrapS = J.map.wrapS; t.wrapT = J.map.wrapT; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; t.name = "rl nrm " + (J.map.name || J.key.slice(0, 8)); t.userData.avShared = true; t.needsUpdate = true; t.onUpdate = function (tx) { if (tx.image && tx.image.data) tx.image = { width: tx.image.width, height: tx.image.height, data: null }; };   // the pixels live on the GPU once uploaded: the 1 to 4 MB array goes (120 MB of heap for the 39 maps otherwise)
          SURF.done.set(J.key, t); surfApply(J.key, t); SURF.n.derive++; SURF.n.deriveMs += d.ms; try { if (window.PLAN_ROOMS && PLAN_ROOMS.warm) PLAN_ROOMS.warm(t); } catch (x) {} } catch (x) { note("surf map", x); } };
      SURF.wk.onerror = function (e) { note("surf worker", e && e.message || "error"); SURF.busy = 0; SURF.fly.clear(); }; } catch (e) { note("surf worker", e); SURF.wkBad = true; } return SURF.wk; }
  var SID = 0;
  function surfIdle(now) {   // one job at a time; the decode and the work happen off the main thread
    if (SURF.fly.size) SURF.fly.forEach(function (J, id) { if (now - J.t > 60000) SURF.fly.delete(id); });
    if (!SURF.Q.length || SURF.busy && now - SURF.busy.t < 8000 || SURF.fly.size > 1) return; SURF.busy = 0; var wk = surfWorker(); if (!wk) { SURF.Q.length = 0; return; }
    for (var i = 0; i < SURF.Q.length; i++) { var J = SURF.Q[i], a = imgOf(J.map), n = J.nrm ? imgOf(J.nrm) : null; if (!a || (J.nrm && !n)) continue; SURF.Q.splice(i, 1);
      var sz = J.nrm ? Math.min(1024, n.width || 512) : Math.min(J.rk === "wood" || J.rk === "stone" ? 1024 : 512, Math.max(256, a.width || 512)); var W = sz, H = Math.max(64, Math.round(sz * ((a.height || sz) / (a.width || sz)))); if (J.nrm) H = Math.min(1024, n.height || W);   // floors and walls of wood and stone at up to 1024, the rest 512
      J.id = ++SID; J.t = now; SURF.busy = J; SURF.fly.set(J.id, J); var q = RC[J.rk] || RC.plaster;   // a late answer still lands (in flight by id)
      Promise.all([createImageBitmap(a, { resizeWidth: W, resizeHeight: H, resizeQuality: "high" }), n ? createImageBitmap(n, { resizeWidth: W, resizeHeight: H, resizeQuality: "high" }) : null]).then(function (bm) { var tr = [bm[0]]; if (bm[1]) tr.push(bm[1]); wk.postMessage({ id: J.id, w: W, h: H, a: bm[0], n: bm[1], q: q }, tr); }, function (e) { note("surf bitmap", e); SURF.fly.delete(J.id); SURF.busy = 0; });
      return; }
  }
  // the shared uniforms: the room frame (detail axes, the probe's box) and whether the room's own capture is what the scene shows
  var _m3 = new THREE.Matrix3(), _bc = new THREE.Vector3();
  function surfFrame(R) {
    var U = SURF.U, on = U.uRiOn.value; on.w = RL.part.surf && SURF.ready >= 6 ? 1 : 0;
    var pr = U.uRiPr.value, po = RL.part.surf && RL.part.prop; pr.x = po && SURF.propReady ? 1 : 0; pr.y = po ? 1 : 0; pr.z = po && !RL.lite ? 1 : 0; pr.w = RL.propDbg ? 1 : 0;
    if (!R) { if (on.x || on.y) { on.x = 0; on.y = 0; U.uRiRot.value.identity(); U.uRiPos.value.set(0, 0, 0); } return; }
    if (SURF.R !== R) { SURF.R = R; _m3.setFromMatrix4(R.Mi); U.uRiRot.value.copy(_m3); var b = R.box; _bc.set((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2); U.uRiPos.value.copy(_bc).applyMatrix4(R.M);
      U.uRiMin.value.set(b[0] - _bc.x, b[2] - _bc.y - 0.02, b[4] - _bc.z); U.uRiMax.value.set(b[1] - _bc.x, b[3] - _bc.y, b[5] - _bc.z); U.uRiCap.value.set(0, b[2] + Math.min(1.7, (b[3] - b[2]) * 0.45) - _bc.y, 0); }
    var A = ENV.active, own = !!(A && A.R === R && scene.environment === A.rt.texture); var Lk = lookR(R);
    on.x = own && RL.part.surf ? 1 : 0; on.y = own && RL.part.surf ? 1 : 0; on.z = (Lk.irr === undefined ? 0.75 : Lk.irr) * (R.k && R.k.irr || 1) * (1 + 0.3 * nightK());
  }
  RL.surfFrame = surfFrame;
  // development: after evaluating this file again in a running game, re-patch every room material with the new shader text
  RL.devRepatch = function () { var n = 0, v = (RL.devN = (RL.devN || 0) + 1); var one = function (m) { if (!m || !m.isMaterial || !m.userData.riU) return; m.onBeforeCompile = function (sh, r) { surfOBC(m, sh, r); }; m.customProgramCacheKey = function () { return surfKey.call(m) + "|dev" + v; }; m.needsUpdate = true; n++; };
    [window.PLAN_ROOMS_VENUES && PLAN_ROOMS_VENUES.MT, window.PLAN_ROOMS_SHOPS && PLAN_ROOMS_SHOPS.mat, window.PLAN_RH && PLAN_RH.mt].forEach(function (c) { if (c) for (var k in c) one(c[k]); }); try { if (inside && inside.g) inside.g.traverse(function (o) { if (o.material && !Array.isArray(o.material)) one(o.material); }); } catch (e) {} return n; };
  var XMOD = ["PLAN_LIBRARY", "PLAN_CHAINMUSEUM", "PLAN_MERCADO", "PLAN_RODEO", "PLAN_SPORTSCLUB", "PLAN_FLIGHTACADEMY", "PLAN_DOMES", "PLAN_MARKET", "PLAN_CONV", "PLAN_BODYSHOP", "PLAN_TERMINAL"];
  function xCat(n) { n = (n || "").toLowerCase(); if (/glass|water|lamp|emit|glow|bulb|lens|leaf|ember|wire|far|shade|sign|screen|neon|ball|marks|pool|tub/.test(n)) return null;
    if (/chrome/.test(n)) return [2, 0.35, 1.4, 0.3]; if (/iron|steel|bronze|brass|metal|inox|tin\b|copper|gold|hub|band|strut|pipe/.test(n)) return [2, 0.85, 1, 0.6]; if (/cloth|linen|fabric|felt|carpet|soft/.test(n)) return [3, 1, 1, 0.3];
    if (/ceramic|enamel|glaze/.test(n)) return [4, 1, 1, 0.3]; if (/leather|rubber/.test(n)) return [5, 1, 1, 0.4]; if (/paint|plain|matte|composite|corten|basalt|pot\b|dark|bright/.test(n)) return [6, 0.85, 1, 0.6]; return null; }
  RL.xScan = function () { if (!RL.part.surf || !RL.part.prop || !RL.tierDone) return 0; var n = 0, seen = new Set();
    var walk = function (o, d) { if (!o || typeof o !== "object" || seen.has(o) || d > 3) return; seen.add(o); if (o.isMaterial) { if (o.isMeshStandardMaterial && !o.isMeshPhysicalMaterial && !o.transparent && !(o.alphaTest > 0) && !o.emissiveMap && (!o.map || tinyTex(o.map)) && !o.userData.riU && !SURF.seen.has(o) && !(o.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile && !("_csmObc" in o)) && !o._userObc) { var c = (o.emissive && o.emissive.getHex()) ? null : xCat(o.name); if (RL.surfMat(o, { cat: c || [0, 0, 1, 0], flat: !c })) n++; } return; }
      if (o.isObject3D || o.isTexture || o.isBufferGeometry || ArrayBuffer.isView(o) || Array.isArray(o) && o.length > 200) return; var i = 0; for (var k in o) { if (++i > 400) break; try { walk(o[k], d + 1); } catch (e) {} } };
    for (var j = 0; j < XMOD.length; j++) { try { walk(window[XMOD[j]], 0); } catch (e) {} } RL.n.xMats = (RL.n.xMats || 0) + n; return n; };
  RL.propOn = function () { return !!(RL.part.surf && RL.part.prop && RL.tierDone); };

  // ───────────────────────── 7. R19 (Agent IN3): hot tub and pool water ─────────────────────────
  // Every hot tub, plunge pool and backyard pool drew its water as a flat disc or plane over a shell with no floor and no inner
  // wall (the dome barrel tubs, the pyramid tubs, the spa's mineral tubs, the homes' pools, a hand-built tub): one colour
  // painted over the basin (the pools' plane was even blended over the deck), and from a seat or close by (the camera's near plane
  // cuts the water) the deck, the gravel and the ground beyond showed through. Now one opaque lit water program for all of them:
  //  - the surface is opaque (depth written, never sorted) and shows the basin under it: the refracted view ray is traced against
  //    the basin (a cylinder or an oriented box, with a bench ring in the tubs) and the wall or floor it meets is shaded (tile and
  //    grout, cedar staves, stone) with depth absorption and in-scatter (Beer-Lambert per channel, per water type), caustics on the
  //    floor by day, LED glow at night where the tub has LEDs;
  //  - a scrolling ripple normal (tex/rl_water.png, two scales) with three's own Fresnel environment reflection and sun glint;
  //  - every tub gets a real floor and an inward-facing inner wall (shell geometry in the same program), so nothing behind shows
  //    through from any angle, close up or from a seat;
  //  - per-vertex basin data (aWa..aWd, object space), so one program serves every tub and pool, instanced (the pyramids) or merged.
  // ?rlw=0 off (the modules' own water exactly); PLAN_RL.set({ water: false }) flips it in a running game (A/B in one session).
  var WAT = RL.water = { on: RL.on && !qOff("rlw"), mat: null, U: null, list: [], shells: [], n: { meshes: 0, basins: 0, shells: 0, scans: 0, ms: 0 }, tex: null, warm: 0 };
  RL.part.water = WAT.on;
  // water types: absorption per metre (linear rgb) and in-scatter colour: 0 pool (clear, chlorinated), 1 mineral tub (spa), 2 LED tub
  var WTYPE = [[0.30, 0.062, 0.040, 0.020, 0.115, 0.165], [0.52, 0.17, 0.19, 0.040, 0.105, 0.090], [0.58, 0.14, 0.075, 0.016, 0.085, 0.135]];
  function waterTex() { if (WAT.tex) return WAT.tex; var t; try { t = new THREE.TextureLoader().load((window.AV || String)("/tex/rl_water.png?v=" + (window.BUILD || "r19in")), undefined, undefined, function () { note("water map", "load failed"); }); } catch (e) { note("water map", e); t = new THREE.Texture(); }
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; t.name = "rl_water"; t.userData.avShared = true; WAT.tex = t; return t; }
  var W_VS_H = "attribute vec4 aWa; attribute vec4 aWb; attribute vec4 aWc; attribute vec4 aWd;\nvarying vec3 vWo; varying vec3 vWcam; varying vec4 vWa; varying vec4 vWb; varying vec4 vWc; varying vec4 vWd; varying vec3 vWX; varying vec3 vWY; varying vec3 vWZ;\n";
  var W_VS_M = "{ mat4 wM = modelMatrix;\n#ifdef USE_INSTANCING\n wM = modelMatrix * instanceMatrix;\n#endif\n vWo = position; vWcam = (inverse(wM) * vec4(cameraPosition, 1.0)).xyz; vWa = aWa; vWb = aWb; vWc = aWc; vWd = aWd;\n mat4 vM = viewMatrix * wM; vWX = normalize((vM * vec4(1.0, 0.0, 0.0, 0.0)).xyz); vWY = normalize((vM * vec4(0.0, 1.0, 0.0, 0.0)).xyz); vWZ = normalize((vM * vec4(0.0, 0.0, 1.0, 0.0)).xyz); }\n";
  var W_FS_H = [
    "uniform float uWTime; uniform float uWNight; uniform float uWDay; uniform vec3 uWLed; uniform sampler2D tWN; uniform float uWK;",
    "varying vec3 vWo; varying vec3 vWcam; varying vec4 vWa; varying vec4 vWb; varying vec4 vWc; varying vec4 vWd; varying vec3 vWX; varying vec3 vWY; varying vec3 vWZ;",
    "float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y); }",
    // the shell's albedo at a basin point q (basin frame, y up from the water line), face 0 wall, 1 floor, 2 bench; pat 0 stone, 1 tile, 2 cedar, 3 dark shell
    "vec3 wShell(vec3 q, float face, float pat, vec3 base, float R, float cyl) {",
    "  float ang = atan(q.z, q.x); vec2 st = face > 0.5 ? q.xz : vec2(cyl > 0.5 ? ang * R : (abs(q.x) > abs(q.z) ? q.z : q.x), q.y);",
    "  vec3 c = base; float m = wNoise(st * 9.0) * 0.5 + wNoise(st * 23.0) * 0.5;",
    "  if (pat > 2.5) { c *= 0.85 + 0.25 * m; }",
    "  else if (pat > 1.5) { float bw = face > 0.5 ? 0.11 : 0.105; float sx = (face > 0.5 ? st.x : st.x) / bw; float id = floor(sx); float fx = fract(sx); float gr = wNoise(vec2(id * 7.1, st.y * 3.0)) * 0.6 + wNoise(vec2(fx * 2.0 + id, st.y * 38.0)) * 0.4;",
    "    c *= (0.78 + 0.32 * wHash(vec2(id, 3.0))) * (0.85 + 0.25 * gr); c *= mix(0.55, 1.0, smoothstep(0.0, 0.06, fx) * smoothstep(1.0, 0.94, fx)); }",
    "  else if (pat > 0.5) { vec2 tc = st / 0.124; vec2 tf = fract(tc); vec2 ti = floor(tc); float g = min(min(tf.x, 1.0 - tf.x), min(tf.y, 1.0 - tf.y));",
    "    c *= 0.93 + 0.12 * wHash(ti); c = mix(c * vec3(0.72, 0.76, 0.78), c, smoothstep(0.03, 0.07, g)); if (face > 0.5 && abs(q.x) < 0.1 && cyl < 0.5) c *= 0.55; }",
    "  else { c *= 0.82 + 0.3 * m; }",
    "  return c; }",
    // trace the refracted ray from the surface point p (basin frame) along d into the basin; returns the hit (xyz) and the face
    "vec4 wTrace(vec3 p, vec3 d, float cyl, float R, float hz, float dep, float bR, float bD) {",
    "  float tF = (-dep - p.y) / min(d.y, -1e-4); float t = tF; float face = 1.0;",
    "  if (cyl > 0.5) { float a = dot(d.xz, d.xz) + 1e-6, b = 2.0 * dot(p.xz, d.xz), c = dot(p.xz, p.xz) - R * R; float disc = max(b * b - 4.0 * a * c, 0.0); float tW = (-b + sqrt(disc)) / (2.0 * a); if (tW < t) { t = tW; face = 0.0; }",
    "    if (bD > 0.01) { float tB = (-bD - p.y) / min(d.y, -1e-4); vec2 hb = p.xz + d.xz * tB; if (tB < t && dot(hb, hb) > bR * bR) { t = tB; face = 2.0; } } }",
    "  else { float tx = (sign(d.x) * R - p.x) / (abs(d.x) > 1e-5 ? d.x : 1e-5); float tz = (sign(d.z) * hz - p.z) / (abs(d.z) > 1e-5 ? d.z : 1e-5); float tW = min(abs(tx), abs(tz)); if (tW < t) { t = tW; face = 0.0; } }",
    "  return vec4(p + d * max(t, 0.0), face); }",
  ].join("\n");
  // the main block (after the normal is set up, before lighting): sets diffuseColor, roughnessFactor, normal and emissive
  var W_FS_M = [
    "float wRole = mod(floor(vWa.w / 2.0), 2.0); float wCyl = mod(vWa.w, 2.0); float wPat = floor(vWa.w / 4.0); int wTy = int(vWd.z + 0.5);",
    "vec3 wSig = wTy == 0 ? vec3(" + WTYPE[0].slice(0, 3).join(", ") + ") : wTy == 1 ? vec3(" + WTYPE[1].slice(0, 3).join(", ") + ") : vec3(" + WTYPE[2].slice(0, 3).join(", ") + ");",
    "vec3 wSca = wTy == 0 ? vec3(" + WTYPE[0].slice(3).join(", ") + ") : wTy == 1 ? vec3(" + WTYPE[1].slice(3).join(", ") + ") : vec3(" + WTYPE[2].slice(3).join(", ") + ");",
    "float wca = cos(vWb.z), wsa = sin(vWb.z); mat2 wRot = mat2(wca, -wsa, wsa, wca);",
    "vec3 wP = vWo - vWa.xyz; wP.xz = wRot * wP.xz; vec3 wCam = vWcam - vWa.xyz; wCam.xz = wRot * wCam.xz; vec3 wV = normalize(wP - wCam);",
    "vec3 wLed = uWLed * vWc.a * uWNight; vec3 wE = vec3(0.0);",
    "if (wRole < 0.5) {",
    "  vec2 wq = vWo.xz; float wt = uWTime; float rk = wTy == 0 ? 1.0 : 0.6;",
    "  vec4 n1 = texture2D(tWN, wq * 0.42 + vec2(wt * 0.021, wt * 0.013)); vec4 n2 = texture2D(tWN, wq * 0.91 * mat2(0.8, 0.6, -0.6, 0.8) - vec2(wt * 0.017, -wt * 0.026));",
    "  vec2 nxy = ((n1.xy * 2.0 - 1.0) * 0.6 + (n2.xy * 2.0 - 1.0) * 0.4) * 0.16 * rk * uWK; vec3 nO = normalize(vec3(nxy.x, 1.0, nxy.y));",
    "  vec3 nB = nO; nB.xz = wRot * nB.xz;",
    "  if (wV.y > -0.02) { diffuseColor.rgb = wSca * 0.6; } else {",
    "    vec3 wRd = refract(wV, nB, 0.752); if (dot(wRd, wRd) < 0.5) wRd = vec3(wV.x, -abs(wV.y), wV.z);",
    "    vec4 H = wTrace(vec3(wP.x, 0.0, wP.z), wRd, wCyl, vWb.x, vWb.y, vWb.w, vWd.x, vWd.y);",
    "    float L = distance(H.xyz, vec3(wP.x, 0.0, wP.z)) + (-H.y) * 0.9; vec3 T = exp(-wSig * L);",
    "    vec3 sh = wShell(H.xyz, H.w, wPat, vWc.rgb, vWb.x, wCyl);",
    "    float cz = texture2D(tWN, H.xz * 0.55 + vec2(wt * 0.03, -wt * 0.022)).a * texture2D(tWN, H.xz * 0.8 - vec2(wt * 0.024, wt * 0.019)).a;",
    "    float caus = H.w > 0.5 ? cz * 3.2 * uWDay * exp(-0.5 * -H.y) : cz * 1.2 * uWDay * smoothstep(-0.8, 0.0, H.y);",
    "    float ao = H.w > 0.5 ? 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.18, (wCyl > 0.5 ? vWb.x - length(H.xz) : min(vWb.x - abs(H.x), vWb.y - abs(H.z))))) : 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.16, vWb.w + H.y));",
    "    vec3 col = sh * ao * (1.0 + caus) * T + wSca * (1.0 - T);",
    "    float Fr = 0.02 + 0.98 * pow(1.0 - clamp(-dot(wV, nB), 0.0, 1.0), 5.0);",
    "    diffuseColor.rgb = col * (1.0 - Fr);",
    "    wE = wLed * (0.55 * (1.0 - T.b) + 0.45 * T * (0.6 + 0.8 * cz)) * (1.0 - Fr); }",
    "  normal = normalize(vWX * nO.x + vWY * nO.y + vWZ * nO.z);",
    "  roughnessFactor = 0.035; metalnessFactor = 0.0;",
    "} else {",
    "  vec3 q = wP; float face = abs(q.y + vWb.w) < 0.012 ? 1.0 : 0.0; vec3 sh = wShell(q, face, wPat, vWc.rgb, vWb.x, wCyl);",
    "  if (q.y > 0.0) { float wet = 1.0 - smoothstep(0.0, 0.05, q.y); diffuseColor.rgb = sh * (1.0 - 0.35 * wet); roughnessFactor = mix(0.62, 0.22, wet); }",
    "  else { float Lw = wCam.y > 0.0 ? (-q.y) / max(-wV.y, 0.05) : distance(q, wCam); vec3 T = exp(-wSig * (Lw - q.y * 0.9)); diffuseColor.rgb = sh * T + wSca * (1.0 - T); roughnessFactor = 0.3; wE = wLed * 0.5 * (1.0 - T.b); }",
    "  metalnessFactor = 0.0;",
    "}",
  ].join("\n");
  function wHook(sh) {
    sh.uniforms.uWTime = WAT.U.uWTime; sh.uniforms.uWNight = WAT.U.uWNight; sh.uniforms.uWDay = WAT.U.uWDay; sh.uniforms.uWLed = WAT.U.uWLed; sh.uniforms.tWN = WAT.U.tWN; sh.uniforms.uWK = WAT.U.uWK;
    var vs = sh.vertexShader, fs = sh.fragmentShader;
    if (vs.indexOf("#include <begin_vertex>") < 0 || fs.indexOf("#include <roughnessmap_fragment>") < 0 || fs.indexOf("#include <metalnessmap_fragment>") < 0 || fs.indexOf("#include <normal_fragment_maps>") < 0 || fs.indexOf("#include <emissivemap_fragment>") < 0) { WAT.n.miss = (WAT.n.miss || 0) + 1; return; }
    sh.vertexShader = W_VS_H + vs.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + W_VS_M);
    // the water block runs after roughness and metalness are read (it overrides both) and after the normal maps (it sets the normal)
    fs = fs.replace("void main() {", W_FS_H + "\nvoid main() {");
    fs = fs.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n{\n" + W_FS_M + "\ntotalEmissiveRadiance += wE;\n}");
    sh.fragmentShader = fs; WAT.n.compiled = (WAT.n.compiled || 0) + 1;
  }
  function waterMat() {
    if (WAT.mat) return WAT.mat;
    WAT.U = { uWTime: { value: 0 }, uWNight: { value: 0 }, uWDay: { value: 1 }, uWLed: { value: new THREE.Color(0x38c8ff) }, tWN: { value: waterTex() }, uWK: { value: 1 } };
    var m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, envMapIntensity: 1.0 });
    m.name = "rl_water"; m.userData.avShared = true; m.userData.noSolid = true; m.userData.rlNoFix = true; m.userData.rlWater = true;
    m.onBeforeCompile = wHook; WAT.mat = m; try { if (window.PLAN_ROOMS && PLAN_ROOMS.warm) PLAN_ROOMS.warm(m, "rl_water"); } catch (e) {} return m;
  }
  // ── basins: connected parts of a water geometry (union-find over its index), each a disc (cylinder) or a rectangle (box) ──
  function parts(geo) {
    var P = geo.attributes.position, n = P.count, I = geo.index, par = new Int32Array(n); for (var i = 0; i < n; i++) par[i] = i;
    var find = function (a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    var join = function (a, b) { a = find(a); b = find(b); if (a !== b) par[b] = a; };
    if (I) { for (var t = 0; t < I.count; t += 3) { join(I.getX(t), I.getX(t + 1)); join(I.getX(t), I.getX(t + 2)); } } else for (var t2 = 0; t2 < n; t2 += 3) { join(t2, t2 + 1); join(t2, t2 + 2); }
    // a non-indexed disc shares no vertex between its triangles: weld by position first (1 mm)
    if (!I) { var map = new Map(); for (var k = 0; k < n; k++) { var key = Math.round(P.getX(k) * 1000) + "," + Math.round(P.getY(k) * 1000) + "," + Math.round(P.getZ(k) * 1000); var o = map.get(key); if (o === undefined) map.set(key, k); else join(o, k); } }
    var G = new Map(); for (var v = 0; v < n; v++) { var r = find(v), g = G.get(r); if (!g) G.set(r, g = []); g.push(v); }
    var out = []; G.forEach(function (vs) { var cx = 0, cy = 0, cz = 0; vs.forEach(function (q) { cx += P.getX(q); cy += P.getY(q); cz += P.getZ(q); }); cx /= vs.length; cy /= vs.length; cz /= vs.length;
      var dmax = 0, dmin = 1e9; vs.forEach(function (q) { var d = Math.hypot(P.getX(q) - cx, P.getZ(q) - cz); if (d > dmax) dmax = d; if (d > 1e-3 && d < dmin) dmin = d; });
      var b = { vs: vs, cx: cx, cy: cy, cz: cz, R: dmax, cyl: vs.length >= 10 && dmin > dmax * 0.85 };
      if (!b.cyl) { // a rectangle: its axes from the longest edge out of the first vertex's triangle fan, its half sizes from the projections
        var best = 0, ang = 0; for (var a = 0; a < vs.length; a++) for (var c = a + 1; c < vs.length; c++) { var dx = P.getX(vs[c]) - P.getX(vs[a]), dz = P.getZ(vs[c]) - P.getZ(vs[a]); var L = Math.hypot(dx, dz); if (L > 1e-3 && L < b.R * 2 - 1e-3 && L > best) { best = L; ang = Math.atan2(dz, dx); } if (vs.length > 40) break; }
        var ca = Math.cos(ang), sa = Math.sin(ang), hx = 0, hz = 0; vs.forEach(function (q) { var dx = P.getX(q) - cx, dz = P.getZ(q) - cz; hx = Math.max(hx, Math.abs(dx * ca + dz * sa)); hz = Math.max(hz, Math.abs(-dx * sa + dz * ca)); });
        b.ang = ang; b.hx = hx; b.hz = hz; }
      out.push(b); });
    return out;
  }
  // write the basin attributes on a water geometry. spec(b) -> { dep, bR, bD, type, pat, shell: hex, led, shell geometry: true }
  var _wc = new THREE.Color();
  function basinAttrs(geo, list, specOf, role) {
    var n = geo.attributes.position.count, A = new Float32Array(n * 4), B = new Float32Array(n * 4), C = new Float32Array(n * 4), D = new Float32Array(n * 4);
    list.forEach(function (b) { var s = b.s || (b.s = specOf(b)); _wc.set(s.shell); var code = (b.cyl ? 0 : 1) + 2 * (role || 0) + 4 * (s.pat || 0);
      // the shader rotates the basin frame by -ang (wRot maps world xz into the box axes)
      var ang = b.cyl ? 0 : b.ang, R = b.cyl ? b.R : b.hx, HZ = b.cyl ? 0 : b.hz;
      b.vs.forEach(function (v) { A[v * 4] = b.cx; A[v * 4 + 1] = b.cy; A[v * 4 + 2] = b.cz; A[v * 4 + 3] = code; B[v * 4] = R; B[v * 4 + 1] = HZ; B[v * 4 + 2] = ang; B[v * 4 + 3] = s.dep; C[v * 4] = _wc.r; C[v * 4 + 1] = _wc.g; C[v * 4 + 2] = _wc.b; C[v * 4 + 3] = s.led || 0; D[v * 4] = s.bR || 0; D[v * 4 + 1] = s.bD || 0; D[v * 4 + 2] = s.type || 0; D[v * 4 + 3] = 0; }); });
    geo.setAttribute("aWa", new THREE.BufferAttribute(A, 4)); geo.setAttribute("aWb", new THREE.BufferAttribute(B, 4)); geo.setAttribute("aWc", new THREE.BufferAttribute(C, 4)); geo.setAttribute("aWd", new THREE.BufferAttribute(D, 4));
  }
  // the tub's own floor and inner wall (inward), from the floor up to top (metres over the water line, may be 0), in the basin frame
  function shellGeo(b, top, seg) {
    var s = b.s, dep = s.dep, R = b.R - 0.004, pos = [], idx = [], y0 = b.cy - dep, y1 = b.cy + top; seg = seg || 40;
    if (b.cyl) { pos.push(b.cx, y0 + 0.002, b.cz); for (var i = 0; i <= seg; i++) { var a = i / seg * TAU; pos.push(b.cx + Math.cos(a) * R, y0 + 0.002, b.cz + Math.sin(a) * R); } for (var j = 1; j <= seg; j++) idx.push(0, j + 1, j);
      var w0 = pos.length / 3; for (var k = 0; k <= seg; k++) { var a2 = k / seg * TAU, x = b.cx + Math.cos(a2) * R, z = b.cz + Math.sin(a2) * R; pos.push(x, y0, z, x, y1, z); } for (var q = 0; q < seg; q++) { var v = w0 + q * 2; idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); } }
    else { var ca = Math.cos(b.ang), sa = Math.sin(b.ang), hx = b.hx - 0.004, hz = b.hz - 0.004; var cn = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(function (p) { return [b.cx + p[0] * ca - p[1] * sa, b.cz + p[0] * sa + p[1] * ca]; });
      pos.push(cn[0][0], y0 + 0.002, cn[0][1], cn[1][0], y0 + 0.002, cn[1][1], cn[2][0], y0 + 0.002, cn[2][1], cn[3][0], y0 + 0.002, cn[3][1]); idx.push(0, 2, 1, 0, 3, 2);
      for (var e = 0; e < 4; e++) { var A = cn[e], B2 = cn[(e + 1) % 4], w1 = pos.length / 3; pos.push(A[0], y0, A[1], A[0], y1, A[1], B2[0], y0, B2[1], B2[0], y1, B2[1]); idx.push(w1, w1 + 2, w1 + 1, w1 + 1, w1 + 2, w1 + 3); } }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  // patch one water mesh: the module's material is kept on userData (to switch back), the basins get their data, the tubs a shell
  function patchMesh(o, specOf, tag) {
    if (!o || !o.isMesh || o.userData.rlW) return false; var geo = o.geometry; if (!geo || !geo.attributes.position) return false;
    var t0 = performance.now(), list = parts(geo); if (!list.length) return false;
    basinAttrs(geo, list, specOf, 0);
    o.userData.rlW = { orig: o.material, tag: tag, basins: list.length }; o.material = waterMat(); o.castShadow = false; o.receiveShadow = true; o.renderOrder = 0;
    // the shells (tubs only): one mesh beside the water, the same matrix (instanced like it when it is instanced)
    var sg = [], sl = []; list.forEach(function (b) { if (!b.s.shell3) return; var g = shellGeo(b, b.s.top || 0, b.cyl ? 40 : 4); basinAttrsFixed(g, b); sg.push(g); });
    if (sg.length) { var mg = mergeGeos(sg); if (mg) { var sm; if (o.isInstancedMesh) { sm = new THREE.InstancedMesh(mg, waterMat(), o.count); sm.instanceMatrix = o.instanceMatrix; sm.count = o.count; } else sm = new THREE.Mesh(mg, waterMat());
        sm.name = "rl tub shell " + tag; sm.matrixAutoUpdate = o.matrixAutoUpdate; sm.position.copy(o.position); sm.quaternion.copy(o.quaternion); sm.scale.copy(o.scale); sm.updateMatrix(); sm.castShadow = false; sm.receiveShadow = true; sm.frustumCulled = o.frustumCulled; sm.userData.noSolid = true; sm.userData.rlNoFix = true; sm.userData.rlWShell = o;
        if (o.parent) o.parent.add(sm); o.userData.rlW.shell = sm; WAT.shells.push(sm); WAT.n.shells++; } }
    WAT.list.push(o); WAT.n.meshes++; WAT.n.basins += list.length; WAT.n.ms = +(WAT.n.ms + performance.now() - t0).toFixed(1); return true;
  }
  function basinAttrsFixed(g, b) { var n = g.attributes.position.count, all = []; for (var i = 0; i < n; i++) all.push(i); basinAttrs(g, [{ vs: all, cx: b.cx, cy: b.cy, cz: b.cz, R: b.R, cyl: b.cyl, hx: b.hx, hz: b.hz, ang: b.ang, s: b.s }], null, 1); }
  function mergeGeos(list) { if (list.length === 1) return list[0]; var tot = 0, ti = 0; list.forEach(function (g) { tot += g.attributes.position.count; ti += g.index.count; }); var out = new THREE.BufferGeometry(), names = Object.keys(list[0].attributes), I = new Uint32Array(ti), off = 0, io = 0;
    names.forEach(function (nm) { var sz = list[0].attributes[nm].itemSize, arr = new Float32Array(tot * sz), o2 = 0; list.forEach(function (g) { arr.set(g.attributes[nm].array, o2); o2 += g.attributes[nm].array.length; }); out.setAttribute(nm, new THREE.BufferAttribute(arr, sz)); });
    list.forEach(function (g) { var ia = g.index.array; for (var k = 0; k < ia.length; k++) I[io++] = ia[k] + off; off += g.attributes.position.count; g.dispose(); }); out.setIndex(new THREE.BufferAttribute(I, 1)); out.computeBoundingSphere(); return out; }
  // ── which meshes are water, and what their basins are (depths are the modules' own: water line to the shell's floor) ──
  var W_SPECS = {
    // dome barrel tub: cedar staves, a seat ring 0.4 m under the water; the plunge pool: tiled, 1.05 m
    dm_water: function (b) { return b.cyl ? { dep: 0.84, bR: 0.55, bD: 0.4, type: 2, pat: 2, shell: 0x8a5a3a, led: 0.9, shell3: true, top: 0.02 } : { dep: 1.05, type: 0, pat: 1, shell: 0xd9e4e2, led: 0.35 }; },
    // pyramid tub: a dark shell, LEDs, shallow (0.34 m to its floor)
    sg_water: function (b) { return { dep: 0.34, type: 2, pat: 3, shell: 0x3a3d40, led: 1.0, shell3: true, top: 0.08 }; },
    // the spa's mineral tubs: honed stone, a bench ring 0.24 m down where the guests sit (0.5 m out)
    "sp tub water": function (b) { return { dep: 0.56, bR: 0.42, bD: 0.24, type: 1, pat: 0, shell: 0x9a9184, led: 0, shell3: true, top: 0.0 }; },
    // the homes' pools (client.js): white tile, 1.4 m
    pool: function (b) { return { dep: 1.4, type: 0, pat: 1, shell: 0xe3eeee, led: 0 }; },
    // a hand-built cedar tub (build mode)
    prop: function (b) { return { dep: 0.72, bR: 0.5, bD: 0.36, type: 2, pat: 2, shell: 0x8a5a3a, led: 0.6, shell3: true, top: 0.12 }; }
  };
  function specFor(o) { var m = o.material, nm = m && m.name || ""; if (W_SPECS[nm]) return [W_SPECS[nm], nm]; try { if (typeof POOL_MAT !== "undefined" && POOL_MAT && m === POOL_MAT) return [W_SPECS.pool, "pool"]; } catch (e) {} return null; }
  // a scan of the scene for water we have not patched (the modules build theirs at the world hook, the client's pools just before
  // the defer hook; the dome near sets are rebuilt when a cluster is rebuilt): cheap, and only while something is still unpatched
  WAT.scan = function () {
    if (!WAT.on || !RL.part.water) return 0; var t0 = performance.now(), k = 0; WAT.n.scans++;
    try { scene.traverse(function (o) { if (!o.isMesh || o.userData.rlW || o.userData.rlWShell) return; var sp = specFor(o); if (!sp) return; if (patchMesh(o, sp[0], sp[1])) k++; }); } catch (e) { note("water scan", e); }
    WAT.n.scanMs = +(performance.now() - t0).toFixed(1); return k;
  };
  // warm both variants (merged and instanced) the way the main pass draws them, behind the loading screen
  WAT.warmUp = function () { if (WAT.warm >= 2) return; try { var P = window.PLAN_PERF, g = new THREE.Group(); var geo = new THREE.PlaneGeometry(0.1, 0.1); geo.rotateX(-PI2); basinAttrs(geo, parts(geo), W_SPECS.pool, 0);
      var a = new THREE.Mesh(geo, waterMat()), b = new THREE.InstancedMesh(geo, waterMat(), 1); a.receiveShadow = b.receiveShadow = true; g.add(a); g.add(b); g.position.copy(camera.position); g.updateMatrixWorld(true);
      var t0 = performance.now(); if (P && P.compileGroup) P.compileGroup(g, false); else renderer.compile(g, camera, scene); WAT.warm = 2; WAT.n.warmMs = +(performance.now() - t0).toFixed(1); } catch (e) { note("water warm", e); } };
  var PI2 = Math.PI / 2;
  // switch back and forth (A/B): the modules' materials return, the shells hide
  WAT.apply = function (on) { WAT.list.forEach(function (o) { var w = o.userData.rlW; if (!w) return; o.material = on ? waterMat() : w.orig; if (w.shell) w.shell.visible = on; }); };
  // the frame: one clock, the night and daylight factors, the LED colour (the dome's tub colour)
  var WFT = { t: 0, at: 0 };
  WAT.frame = function (dt, now) {
    if (!WAT.mat || !WAT.U) return; WFT.t += Math.min(dt || 0.016, 0.1); WAT.U.uWTime.value = WFT.t;
    if (now - WFT.at > 250) { WFT.at = now; var nk = nightK(); WAT.U.uWNight.value = sstep(0.35, 0.85, nk); WAT.U.uWDay.value = daylight(); }
    // the instanced variant (the pyramids' tubs) the way the main pass draws it outdoors: once the world is up, the pool lights are
    // in and the player has been outside a while (a warm at the defer hook had other light counts and was a wasted program)
    if (WAT.warm < 2 && WAT.t0 && now - WAT.t0 > 12000) { var ins0 = null; try { ins0 = inside; } catch (e) {} if (!ins0) WAT.warmUp(); }
    if (RL.part.water !== WAT.applied) { WAT.applied = RL.part.water; WAT.apply(RL.part.water); }
    // late builds (a dome cluster rebuilt, a module that builds after the world hook): every 6 s for the first 45 s, then every 30 s
    if (RL.part.water && now - (WAT.lastScan || 0) > (now - (WAT.t0 || now) < 45000 ? 6000 : 30000)) { WAT.lastScan = now; if (!WAT.t0) WAT.t0 = now; WAT.scan(); }
  };
  // the build-mode cedar tub (client.js makeProp): a closed timber drum with a translucent disc on its lid (it z-fought the lid and
  // showed the wood through). Rebuilt as a coopered tub: an open drum, a rim, the water 0.12 m under the rim, a floor and inner wall
  function wrapMakeProp() {
    var orig = window.makeProp; if (typeof orig !== "function" || orig.__rlw) return false;
    var W = function (kind, ghost) { var g = orig.apply(this, arguments); if (kind !== "hottub" || ghost || !WAT.on) return g; try { fixPropTub(g); } catch (e) { note("prop tub", e); } return g; };
    W.__rlw = true; W.orig = orig; window.makeProp = W; try { makeProp = W; } catch (e) {} return true;
  }
  function fixPropTub(g) {
    var wood = null, water = null; g.children.forEach(function (c) { if (!c.isMesh || !c.geometry || !c.geometry.parameters) return; var p = c.geometry.parameters; if (p.radiusTop === 1.1) wood = c; else if (p.radiusTop === 0.95) water = c; }); if (!wood || !water) return;
    var R0 = 1.1, R1 = 1.0, H = 0.9, wl = 0.78;
    wood.geometry.dispose(); wood.geometry = new THREE.CylinderGeometry(R0, R1, H, 28, 1, true); var rim = new THREE.Mesh(new THREE.RingGeometry(0.94, R0 + 0.01, 32, 1).rotateX(-PI2), wood.material); rim.position.set(0, H + 0.003, 0); g.add(rim);
    var disc = new THREE.CircleGeometry(0.94, 32).rotateX(-PI2); water.geometry.dispose(); water.geometry = disc; water.position.set(0, wl, 0); water.material.dispose();
    var b = { vs: [], cx: 0, cy: 0, cz: 0, R: 0.94, cyl: true, s: W_SPECS.prop() }; for (var i = 0; i < disc.attributes.position.count; i++) b.vs.push(i); basinAttrs(disc, [b], null, 0); water.material = waterMat(); water.userData.rlW = { orig: null, tag: "prop" }; water.castShadow = false; water.receiveShadow = true;
    var sg = shellGeo(b, b.s.top, 32); basinAttrsFixed(sg, b); var sm = new THREE.Mesh(sg, waterMat()); sm.position.copy(water.position); sm.name = "rl tub shell prop"; sm.userData.noSolid = true; g.add(sm);
    WAT.n.props = (WAT.n.props || 0) + 1;
  }
  WAT.wrapMakeProp = wrapMakeProp;
  // ───────────────────────── 8. R19 (Agent IN3): set dressing, trim and window treatments for every room ─────────────────────────
  // The rooms were furnished but sparse: bare walls, empty corners, clear table tops, bare windows, no trim in many. When a room is
  // built (the R14 shops, venues and homes through ctxRoom, the walk-ins through RL.dressRoom) the room is read once: its triangles
  // in the room frame give the real wall planes (with their openings: doors and windows are gaps in the wall at sill and lintel
  // height), the ceiling, and an occupancy grid (0.2 m cells, four height bands) of everything already there; the room's solids give
  // the furniture, the seats and their clearances. Then, only where there is room for it and never on a seat, a door path or a
  // hotspot:
  //  - framed art on free wall spans (six paintings in the atlas, a moulded frame and a mat), centred over low furniture;
  //  - potted plants in free corners (with a small solid);
  //  - table clutter: book stacks, vases with stems, candles, bowls, papers, a glowing table lamp beside seating (a pool fixture);
  //  - rugs under seating groups that stand on bare floor, a runner inside the door;
  //  - curtains (pleated panels, a rod and finials) at windows that have none;
  //  - baseboards and crown where the walls have none.
  // Everything is one merged mesh in one shared program (tex/rl_dress.png atlas, vertex colours, per-vertex roughness, metalness and
  // glow), warmed behind the loading screen; the layout is cached per room (LRU), so a second entry costs nothing.
  // ?rld=0 off; PLAN_RL.set({ dress: false }) hides it in a running game.
  var PI = Math.PI;
  var DR = RL.dress = { on: RL.on && !qOff("rld"), mat: null, tex: null, cache: new Map(), n: { rooms: 0, ms: 0, last: null, warm: 0 }, meshes: [] };
  RL.part.dress = DR.on;
  function dressTex() { if (DR.tex) return DR.tex; var t; try { t = new THREE.TextureLoader().load((window.AV || String)("/tex/rl_dress.png?v=" + (window.BUILD || "r19in")), undefined, undefined, function () { note("dress map", "load failed"); }); } catch (e) { note("dress map", e); t = new THREE.Texture(); }
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = RL.lite ? 4 : 8; t.name = "rl_dress"; t.userData.avShared = true; DR.tex = t; try { if (window.PLAN_ROOMS && PLAN_ROOMS.warm) PLAN_ROOMS.warm(t); } catch (e) {} return t; }
  var DU = { uGlowK: { value: 1.6 } };
  function dHook(sh) { sh.uniforms.uGlowK = DU.uGlowK;
    sh.vertexShader = "attribute vec3 aD;\nvarying vec3 vD;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvD = aD;");
    sh.fragmentShader = "uniform float uGlowK;\nvarying vec3 vD;\n" + sh.fragmentShader.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = vD.y;").replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = vD.z;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vD.x * uGlowK;"); DR.n.compiled = (DR.n.compiled || 0) + 1; if (LI.hi) liPatch(sh, false); }
  function dressMat() { if (DR.mat) return DR.mat; var m = new THREE.MeshStandardMaterial({ map: dressTex(), vertexColors: true, roughness: 0.75, metalness: 0, envMapIntensity: 0.7 }); m.name = "rl_dress"; m.userData.avShared = true; m.userData.noSolid = true; m.userData.rlGlow = 0; m.onBeforeCompile = dHook; DR.mat = m; try { if (window.PLAN_ROOMS && PLAN_ROOMS.warm) PLAN_ROOMS.warm(m, "rl_dress"); } catch (e) {} return m; }
  DR.warmUp = function () { if (DR.n.warm) return; try { var g = new THREE.Group(), geo = new THREE.BoxGeometry(0.05, 0.05, 0.05); var n = geo.attributes.position.count; geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3)); geo.setAttribute("aD", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
      var me = new THREE.Mesh(geo, dressMat()); me.receiveShadow = true; g.add(me); g.position.copy(camera.position); g.updateMatrixWorld(true); var t0 = performance.now(), P = window.PLAN_PERF; if (P && P.compileGroup) P.compileGroup(g, false); else renderer.compile(g, camera, scene); DR.n.warm = +(performance.now() - t0).toFixed(1) || 0.1; } catch (e) { note("dress warm", e); } };
  // atlas rects (u0, v0, u1, v1), three's flipped v: pixel rect x0, y0, x1, y1 of the 1024 image
  function AR(x0, y0, x1, y1) { return [x0 / 1024, 1 - y1 / 1024, x1 / 1024, 1 - y0 / 1024]; }
  var AT = { art: [AR(4, 4, 252, 252), AR(260, 4, 508, 252), AR(516, 4, 764, 252), AR(4, 260, 252, 508), AR(260, 260, 508, 508), AR(516, 260, 764, 508)], books: AR(768, 0, 1024, 256), leaf: AR(772, 260, 1020, 508),
    rug: [AR(0, 512, 512, 768), AR(512, 512, 1024, 768)], linen: AR(0, 768, 256, 1024), mag: AR(256, 768, 512, 896), news: AR(256, 896, 512, 1024), shade: AR(512, 768, 768, 1024), wood: AR(768, 768, 1024, 1024), plain: AR(520, 900, 540, 920) };
  // ── the builder: one set of arrays in the room frame ──
  function DB() { this.p = []; this.n = []; this.u = []; this.c = []; this.d = []; this.i = []; this.nv = 0; }
  var _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _de = new THREE.Euler(), _ds = new THREE.Vector3(), _dp = new THREE.Vector3(), _dn = new THREE.Matrix3(), _dv = new THREE.Vector3();
  DB.prototype.geo = function (g, x, y, z, ry, rx, uvr, col, D, sc) {   // any three geometry: its own uvs mapped into an atlas rect
    _de.set(rx || 0, ry || 0, 0, "YXZ"); _dq.setFromEuler(_de); _ds.set(sc ? sc[0] : 1, sc ? sc[1] : 1, sc ? sc[2] : 1); _dm.compose(_dp.set(x, y, z), _dq, _ds); _dn.getNormalMatrix(_dm);
    var P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, i0 = this.nv, r = uvr || AT.plain;
    for (var i = 0; i < P.count; i++) { _dv.fromBufferAttribute(P, i).applyMatrix4(_dm); this.p.push(_dv.x, _dv.y, _dv.z); _dv.fromBufferAttribute(N, i).applyMatrix3(_dn).normalize(); this.n.push(_dv.x, _dv.y, _dv.z);
      var uu = U ? U.getX(i) : 0.5, vv = U ? U.getY(i) : 0.5; this.u.push(r[0] + (r[2] - r[0]) * uu, r[1] + (r[3] - r[1]) * vv); this.c.push(col[0], col[1], col[2]); this.d.push(D[0], D[1], D[2]); }
    if (g.index) { var a = g.index.array; for (var k = 0; k < a.length; k++) this.i.push(a[k] + i0); } else for (var k2 = 0; k2 < P.count; k2++) this.i.push(i0 + k2);
    this.nv += P.count; return this; };
  var DGC = {}; function dg(key, mk) { return DGC[key] || (DGC[key] = mk()); }
  function boxG() { return dg("box", function () { return new THREE.BoxGeometry(1, 1, 1); }); }
  DB.prototype.box = function (w, h, d, x, y, z, ry, uvr, col, D) { return this.geo(boxG(), x, y, z, ry, 0, uvr, col, D, [w, h, d]); };
  function rgbOf(hex, k) { var c = new THREE.Color(hex); k = k || 1; return [c.r * k, c.g * k, c.b * k]; }
  var DM = { matte: [0, 0.82, 0], satin: [0, 0.45, 0], gloss: [0, 0.18, 0], metal: [0, 0.32, 1], glow: [1, 0.6, 0], paper: [0, 0.9, 0], leaf: [0, 0.6, 0], cloth: [0, 0.95, 0] };
  // ── the room read: walls, openings, ceiling, occupancy ──
  var CELL = 0.2;
  // the triangles of a room in its frame (sampled to a budget), collected in steps (the walk-in and venue zones build at idle)
  function Collector(roots, frame, half, yLo, yHi, budget) { this.roots = roots; this.frame = frame; this.half = half; this.yLo = yLo; this.yHi = yHi; this.budget = budget || 160000; this.T = null; this.k = 0; this.t = 0; this.mi = 0; this.tris = []; this.done = false; }
  Collector.prototype.step = function (ms) { var t0 = performance.now(), me = this, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), H = this.half + 0.45;
    if (!this.T) { this.frame.updateMatrixWorld(true); this.inv = new THREE.Matrix4().copy(this.frame.matrixWorld).invert(); var T = [], tot = 0;
      this.roots.forEach(function (g) { g.updateMatrixWorld(true); g.traverse(function (o) { if (!o.isMesh || o.isSkinnedMesh || !o.geometry || o.userData.rlDress) return; var vis = true, q = o; while (q && q !== g) { if (!q.visible) { vis = false; break; } q = q.parent; } if (!vis) return; var m = Array.isArray(o.material) ? o.material[0] : o.material; if (!m || m.transparent || m.blending !== THREE.NormalBlending || m.userData && m.userData.rlWater) return; var G = o.geometry; if (!G.attributes.position) return;
        if (me.roots.length > 1 || g !== me.frame) { if (!G.boundingSphere) G.computeBoundingSphere(); var bs = G.boundingSphere, cc = bs.center.clone().applyMatrix4(o.matrixWorld).applyMatrix4(me.inv); if (!o.isInstancedMesh && (Math.abs(cc.x) > H + bs.radius || Math.abs(cc.z) > H + bs.radius)) return; }
        var I = G.index; tot += (I ? I.count : G.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); T.push(o); }); });
      this.T = T; this.stride = Math.max(1, Math.ceil(tot / this.budget)); }
    while (this.k < this.T.length) { var o = this.T[this.k], G = o.geometry, P = G.attributes.position, I = G.index, n = I ? I.count / 3 : P.count / 3;
      if (!this.ms) { this.ms = []; if (o.isInstancedMesh) { for (var q = 0; q < o.count; q++) { var im = new THREE.Matrix4(); o.getMatrixAt(q, im); this.ms.push(new THREE.Matrix4().multiplyMatrices(this.inv, o.matrixWorld).multiply(im)); } } else this.ms.push(new THREE.Matrix4().multiplyMatrices(this.inv, o.matrixWorld)); this.mi = 0; this.t = 0; }
      var st = n > 2000 ? this.stride : 1;
      while (this.mi < this.ms.length) { var mm = this.ms[this.mi]; for (; this.t < n; this.t += st) { var i0 = I ? I.getX(this.t * 3) : this.t * 3, i1 = I ? I.getX(this.t * 3 + 1) : this.t * 3 + 1, i2 = I ? I.getX(this.t * 3 + 2) : this.t * 3 + 2; a.fromBufferAttribute(P, i0).applyMatrix4(mm);
          if (a.x < -H - 3 || a.x > H + 3 || a.z < -H - 3 || a.z > H + 3 || a.y < this.yLo || a.y > this.yHi) { if (((this.t / st) & 1023) === 0 && performance.now() - t0 > ms) return false; continue; }
          b.fromBufferAttribute(P, i1).applyMatrix4(mm); c.fromBufferAttribute(P, i2).applyMatrix4(mm); this.tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); if (((this.t / st) & 1023) === 0 && performance.now() - t0 > ms) { this.t += st; return false; } }
        this.mi++; this.t = 0; }
      this.ms = null; this.k++; }
    this.done = true; return true; };
  function readRoom(g, half, F, hgt0, cands, opt) { opt = opt || {}; var hx = opt.hx || half, hz = opt.hz || half; cands = cands || []; var CM = new Map(); cands.forEach(function (s) { s._ta = 0; s._ab = 0; var r = Math.hypot(s.w, s.d) / 2; for (var x = s.x - r; x <= s.x + r + CELL; x += CELL) for (var z = s.z - r; z <= s.z + r + CELL; z += CELL) { var key = Math.floor(x / CELL) + "," + Math.floor(z / CELL), l = CM.get(key); if (!l) CM.set(key, l = []); if (l.indexOf(s) < 0) l.push(s); } });
    var t0 = performance.now(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3();
    var tris = opt.tris; if (!tris) { var col = new Collector([g], g, half, -1e9, 1e9); col.step(1e9); tris = col.tris; } var stride = opt.stride || 1;
    var nt = tris.length / 9;
    if (F === null || F === undefined) { var fl = new Map(); for (var f9 = 0; f9 < nt; f9++) { var q9f = f9 * 9; a.set(tris[q9f], tris[q9f + 1], tris[q9f + 2]); b.set(tris[q9f + 3], tris[q9f + 4], tris[q9f + 5]); c.set(tris[q9f + 6], tris[q9f + 7], tris[q9f + 8]); var cxf = (a.x + b.x + c.x) / 3, czf = (a.z + b.z + c.z) / 3; if (Math.abs(cxf) > hx || Math.abs(czf) > hz) continue; nn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)); var arf = nn.length() / 2; if (!(arf > 1e-5) || nn.y / (2 * arf) < 0.95) continue; var kf = Math.round((a.y + b.y + c.y) / 3 * 50); fl.set(kf, (fl.get(kf) || 0) + arf); }
      var fb = 0; F = 0; fl.forEach(function (w, k) { if (w > fb) { fb = w; F = k / 50; } }); }
    // walls: per side, the plane with the most inward-facing area in the outer part of the room
    var SIDES = [{ ax: 0, s: -1 }, { ax: 0, s: 1 }, { ax: 2, s: -1 }, { ax: 2, s: 1 }], H = SIDES.map(function () { return new Map(); }), ceil = new Map();
    for (var i = 0; i < nt; i++) { var o9 = i * 9; a.set(tris[o9], tris[o9 + 1], tris[o9 + 2]); b.set(tris[o9 + 3], tris[o9 + 4], tris[o9 + 5]); c.set(tris[o9 + 6], tris[o9 + 7], tris[o9 + 8]); nn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)); var ar = nn.length() / 2; if (!(ar > 1e-5)) continue; nn.divideScalar(ar * 2);
      var cy = (a.y + b.y + c.y) / 3 - F; if (nn.y < -0.9 && cy > 1.8) { var kc = Math.round(cy * 50); ceil.set(kc, (ceil.get(kc) || 0) + ar); }
      if (Math.abs(nn.y) > 0.3 || cy < 0.1 || cy > 4.5) continue;
      for (var sI = 0; sI < 4; sI++) { var S = SIDES[sI], nc = S.ax === 0 ? nn.x : nn.z; if (nc * -S.s < 0.9) continue; var pc = S.ax === 0 ? (a.x + b.x + c.x) / 3 : (a.z + b.z + c.z) / 3; var lim = S.ax === 0 ? hx : hz; if (pc * S.s < lim * 0.35 || pc * S.s > lim + 0.3) continue; var k = Math.round(pc * 100); H[sI].set(k, (H[sI].get(k) || 0) + ar); } }
    var hc = hgt0 || 4.4, cbest = 0; ceil.forEach(function (w, k) { if (w > cbest) { cbest = w; hc = k / 50; } }); if (cbest < 1.5) hc = hgt0 || 4.4;
    var walls = SIDES.map(function (S, sI) { var best = 0, kb = null; H[sI].forEach(function (w, k) { if (w > best) { best = w; kb = k; } }); if (best < 1.2) return null; return { ax: S.ax, s: S.s, c: kb / 100, w: best }; });
    // coverage along each wall (0.1 m bins over -half..half): low (0.05..0.25), mid (1.3..1.9), top (hc - 0.35 .. hc - 0.1); and trim found on it
    var NB = Math.ceil(2 * half / 0.1); walls.forEach(function (W) { if (!W) return; W.low = new Uint8Array(NB); W.mid = new Uint8Array(NB); W.top = new Uint8Array(NB); W.baseB = new Uint8Array(NB); W.crownB = new Uint8Array(NB); W.hasArt = new Uint8Array(NB); });
    var nx0 = Math.ceil(2 * half / CELL), occ = new Uint8Array(nx0 * nx0);   // bits: 1 floor decor, 2 low, 4 mid, 8 high
    var cellOf = function (x, z) { var ix = Math.floor((x + half) / CELL), iz = Math.floor((z + half) / CELL); return ix < 0 || iz < 0 || ix >= nx0 || iz >= nx0 ? -1 : iz * nx0 + ix; };
    var mark = function (x0, x1, z0, z1, bits) { var i0 = Math.max(0, Math.floor((Math.max(x0, -half) + half) / CELL)), i1 = Math.min(nx0 - 1, Math.floor((Math.min(x1, half - 1e-4) + half) / CELL)), j0 = Math.max(0, Math.floor((Math.max(z0, -half) + half) / CELL)), j1 = Math.min(nx0 - 1, Math.floor((Math.min(z1, half - 1e-4) + half) / CELL)); if (i1 < i0 || j1 < j0) return; if ((i1 - i0 + 1) * (j1 - j0 + 1) > 900) return; for (var j = j0; j <= j1; j++) for (var ii = i0; ii <= i1; ii++) occ[j * nx0 + ii] |= bits; };
    var bandBits = function (y0, y1) { var bits = 0; if (y0 < 0.06 && y1 > 0.004) bits |= 1; if (y0 < 1.3 && y1 > 0.06) bits |= 2; if (y0 < 2.3 && y1 > 1.3) bits |= 4; if (y1 > 2.3) bits |= 8; return bits; };
    for (var t2 = 0; t2 < nt; t2++) { var q9 = t2 * 9; var ax = tris[q9], ay = tris[q9 + 1] - F, az = tris[q9 + 2], bx = tris[q9 + 3], by = tris[q9 + 4] - F, bz = tris[q9 + 5], cx = tris[q9 + 6], cy2 = tris[q9 + 7] - F, cz = tris[q9 + 8];
      a.set(ax, ay, az); b.set(bx, by, bz); c.set(cx, cy2, cz); nn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)); var L = nn.length(); if (!(L > 1e-7)) continue; nn.divideScalar(L);
      var y0 = Math.min(ay, by, cy2), y1 = Math.max(ay, by, cy2), x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx), z0 = Math.min(az, bz, cz), z1 = Math.max(az, bz, cz);
      if (nn.y > 0.9 && y1 < 0.012) continue;                       // the floor
      if (nn.y < -0.9 && y0 > hc - 0.05) continue;                  // the ceiling
      var tcx = (ax + bx + cx) / 3, tcz = (az + bz + cz) / 3; if (Math.abs(tcx) > hx + 0.35 || Math.abs(tcz) > hz + 0.35) continue; var outside = false; for (var w0 = 0; w0 < 4; w0++) { var Wq = walls[w0]; if (Wq && (Wq.ax === 0 ? tcx : tcz) * Wq.s > Wq.c * Wq.s + 0.03) { outside = true; break; } } if (outside) continue;
      var onWall = false;
      for (var w = 0; w < 4; w++) { var W = walls[w]; if (!W) continue; var lo = W.ax === 0 ? x0 : z0, hi = W.ax === 0 ? x1 : z1, dist = W.s > 0 ? W.c - hi : lo - W.c; var nc2 = W.ax === 0 ? nn.x : nn.z;
        if (Math.abs(dist) < 0.025 && hi - lo < 0.05 && nc2 * -W.s > 0.8) { onWall = true; var s0 = W.ax === 0 ? z0 : x0, s1 = W.ax === 0 ? z1 : x1, b0 = Math.max(0, Math.floor((s0 + half) / 0.1)), b1 = Math.min(NB - 1, Math.floor((s1 + half) / 0.1));
          for (var bb = b0; bb <= b1; bb++) { if (y0 < 0.1 && y1 > 0.2) W.low[bb] = 1; if (y0 < 1.35 && y1 > 1.85) W.mid[bb] = 1; if (y0 < hc - 0.35 && y1 > hc - 0.12) W.top[bb] = 1; } break; }
        var sA = W.ax === 0 ? z0 : x0, sB = W.ax === 0 ? z1 : x1, bA = Math.max(0, Math.floor((sA + half) / 0.1)), bB = Math.min(NB - 1, Math.floor((sB + half) / 0.1)); if (dist > -0.01 && dist < 0.12 && y1 < 0.3 && y0 < 0.06) for (var q1 = bA; q1 <= bB; q1++) W.baseB[q1] = 1; if (dist > -0.01 && dist < 0.25 && y0 > hc - 0.35) for (var q2 = bA; q2 <= bB; q2++) W.crownB[q2] = 1;
        if (dist > -0.01 && dist < 0.15 && y1 > 1.15 && y0 < 2.4 && y1 - y0 > 0.12 && Math.abs(nc2) > 0.8) { var s2 = W.ax === 0 ? z0 : x0, s3 = W.ax === 0 ? z1 : x1; for (var b2 = Math.max(0, Math.floor((s2 + half) / 0.1)); b2 <= Math.min(NB - 1, Math.floor((s3 + half) / 0.1)); b2++) W.hasArt[b2] = 1; } }
      if (onWall) continue; var bits = bandBits(y0, y1); if (bits) { mark(x0, x1, z0, z1, bits); if (DR.dbgCell && (bits & 4)) { var dcx = -half + (DR.dbgCell[0] + 0.5) * CELL, dcz = -half + (DR.dbgCell[1] + 0.5) * CELL; if (x0 <= dcx && x1 >= dcx && z0 <= dcz + 0.1 && z1 >= dcz - 0.1 && DR.dbgT.length < 12) DR.dbgT.push([+x0.toFixed(2), +x1.toFixed(2), +y0.toFixed(2), +y1.toFixed(2), +z0.toFixed(2), +z1.toFixed(2), +nn.x.toFixed(2), +nn.y.toFixed(2), +nn.z.toFixed(2)]); } }
      if (CM.size) { var tx = (ax + bx + cx) / 3, ty = (ay + by + cy2) / 3, tz = (az + bz + cz) / 3, lst = CM.get(Math.floor(tx / CELL) + "," + Math.floor(tz / CELL)); if (lst) for (var li = 0; li < lst.length; li++) { var sq = lst[li], ddx = tx - sq.x, ddz = tz - sq.z, cr = Math.cos(sq.ry), sr = Math.sin(sq.ry), llx = ddx * cr - ddz * sr, llz = ddx * sr + ddz * cr; if (Math.abs(llx) > sq.w / 2 || Math.abs(llz) > sq.d / 2) continue;
        if (nn.y > 0.9 && ty < sq.y1 + 0.03 && ty > sq.y1 - 0.25) { sq._ta += L / 2; sq._tw = (sq._tw || 0) + L / 2; sq._ty = (sq._ty || 0) + ty * L / 2; } else if (ty > sq.y1 + 0.02 && ty < sq.y1 + 0.6 && Math.abs(llx) < sq.w / 2 - 0.05 && Math.abs(llz) < sq.d / 2 - 0.05) sq._ab++; } } }
    if (hx < half - 0.05 || hz < half - 0.05) for (var oj = 0; oj < nx0; oj++) for (var oi = 0; oi < nx0; oi++) { var ocx = -half + (oi + 0.5) * CELL, ocz = -half + (oj + 0.5) * CELL; if (Math.abs(ocx) > hx || Math.abs(ocz) > hz) occ[oj * nx0 + oi] |= 31; }
    return { half: half, hx: hx, hz: hz, F: F, hc: hc, walls: walls, occ: occ, nx: nx0, cellOf: cellOf, mark: mark, NB: NB, tris: nt, stride: stride, ms: +(performance.now() - t0).toFixed(1) };
  }
  // runs of set (or clear) bins: [[b0, b1], ...]
  function runsOf(arr, val, minLen) { var out = [], s = -1; for (var i = 0; i <= arr.length; i++) { var on = i < arr.length && (val ? arr[i] : !arr[i]); if (on && s < 0) s = i; if (!on && s >= 0) { if (i - s >= minLen) out.push([s, i - 1]); s = -1; } } return out; }
  function hashS(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rngOf(seed) { var s = seed >>> 0 || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  // ── the plan: what goes where (room frame, y up from the floor) ──
  function planRoom(Rd, info, rnd, th) {
    var half = Rd.half, occ = Rd.occ, nx = Rd.nx, out = { art: [], plants: [], tops: [], rugs: [], curtains: [], trim: [], lamps: [], solids: [], flamps: [] };
    var free = function (x0, x1, z0, z1, bits, frac) { var i0 = Math.floor((x0 + half) / CELL), i1 = Math.floor((x1 + half) / CELL), j0 = Math.floor((z0 + half) / CELL), j1 = Math.floor((z1 + half) / CELL), n = 0, f = 0; for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) { n++; if (i < 0 || j < 0 || i >= nx || j >= nx) continue; if (!(occ[j * nx + i] & bits)) f++; } return n ? f / n >= (frac || 1) : false; };
    // keep-outs: the door path, seats (and the space in front), hotspots
    var KEEP = 16;
    var keep = function (x0, x1, z0, z1) { Rd.mark(x0, x1, z0, z1, KEEP); };
    if (info.frontDoor !== false) keep(-1.0, 1.0, half - 3.0, half + 0.2);
    info.seats.forEach(function (s) { keep(s.x - s.ex - 0.45, s.x + s.ex + 0.45, s.z - s.ez - 0.45, s.z + s.ez + 0.45); });
    info.spots.forEach(function (s) { keep(s.x - 0.45, s.x + 0.45, s.z - 0.45, s.z + 0.45); });
    info.solids.forEach(function (s) { Rd.mark(s.x - s.ex, s.x + s.ex, s.z - s.ez, s.z + s.ez, bandBitsOf(s.y0, s.y1)); });
    function bandBitsOf(y0, y1) { var b = 0; if (y0 < 1.3 && y1 > 0.06) b |= 2; if (y0 < 2.3 && y1 > 1.3) b |= 4; return b; }
    var W = Rd.walls, hc = Rd.hc;
    // a point along a wall: wall i, coordinate along it (s), offset inward (d) -> room x, z and the facing angle (into the room)
    var wpt = function (Wl, s, d) { if (Wl.ax === 0) return [Wl.c - Wl.s * d, s, Wl.s > 0 ? -PI2 : PI2]; return [s, Wl.c - Wl.s * d, Wl.s > 0 ? PI : 0]; };
    var wfree = function (Wl, s0, s1, d0, d1, bits) { var p0 = wpt(Wl, s0, d0), p1 = wpt(Wl, s1, d1); return free(Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1]), bits | KEEP); };
    var wfreeA = function (Wl, s0, s1, d0, d1, bits) { var p0 = wpt(Wl, s0, d0), p1 = wpt(Wl, s1, d1); return free(Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1]), bits); };
    var wmark = function (Wl, s0, s1, d0, d1, bits) { var p0 = wpt(Wl, s0, d0), p1 = wpt(Wl, s1, d1); Rd.mark(Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1]), bits); };
    W.forEach(function (Wl) { if (!Wl) return; var both = new Uint8Array(Rd.NB); for (var b = 0; b < Rd.NB; b++) both[b] = !Wl.low[b] && !Wl.mid[b] && Math.abs(-half + (b + 0.5) * 0.1) < (Wl.ax === 0 ? Rd.hz : Rd.hx) ? 1 : 0; runsOf(both, 1, 8).forEach(function (r) { var s0 = -half + r[0] * 0.1 - 0.2, s1 = -half + (r[1] + 1) * 0.1 + 0.2, p0 = wpt(Wl, s0, 0), p1 = wpt(Wl, s1, 2.4); keep(Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1])); }); });
    // 1. windows: a gap in the wall at eye height with wall under it (a sill); doors have no wall under them
    W.forEach(function (Wl, wi) { if (!Wl) return; var gaps = runsOf(Wl.mid, 0, 5); gaps.forEach(function (gp) { var lowN = 0; for (var b = gp[0]; b <= gp[1]; b++) lowN += Wl.low[b]; if (lowN < (gp[1] - gp[0] + 1) * 0.6) return; var s0 = -half + gp[0] * 0.1, s1 = -half + (gp[1] + 1) * 0.1; if (s1 - s0 > 4.5) return;
        // already dressed: something within 0.25 m of the wall beside the window at mid height
        if (!wfree(Wl, s0 - 0.6, s0 - 0.3, 0.22, 0.32, 4) && !wfree(Wl, s1 + 0.3, s1 + 0.6, 0.22, 0.32, 4)) return;
        var full = wfree(Wl, s0 - 0.5, s0 - 0.2, 0.22, 0.32, 2) && wfree(Wl, s1 + 0.2, s1 + 0.5, 0.22, 0.32, 2);
        out.curtains.push({ w: wi, s0: s0, s1: s1, y0: full ? 0.02 : 0.85, y1: Math.min(hc - 0.12, 2.75) }); wmark(Wl, s0 - 0.5, s1 + 0.5, 0, 0.3, 4); }); });
    // 2. trim where the walls have none
    W.forEach(function (Wl, wi) { if (!Wl) return; var lowRuns = runsOf(Wl.low, 1, 4), topRuns = runsOf(Wl.top, 1, 6), lowLen = lowRuns.reduce(function (a2, r) { return a2 + r[1] - r[0] + 1; }, 0);
      var bcov = 0; for (var q3 = 0; q3 < Rd.NB; q3++) if (Wl.low[q3] && Wl.baseB[q3]) bcov++; if (bcov < lowLen * 0.3) lowRuns.forEach(function (r) { out.trim.push({ w: wi, kind: "base", s0: -half + r[0] * 0.1, s1: -half + (r[1] + 1) * 0.1 }); });
      var topLen = topRuns.reduce(function (a2, r) { return a2 + r[1] - r[0] + 1; }, 0); var ccov = 0; for (var q4 = 0; q4 < Rd.NB; q4++) if (Wl.top[q4] && Wl.crownB[q4]) ccov++; if (ccov < topLen * 0.3 && hc < 6.5) topRuns.forEach(function (r) { out.trim.push({ w: wi, kind: "crown", s0: -half + r[0] * 0.1, s1: -half + (r[1] + 1) * 0.1 }); }); });
    W.forEach(function (Wl, wi) { if (!Wl) return; runsOf(Wl.mid, 0, 25).forEach(function (gp) { var s0 = -half + gp[0] * 0.1, s1 = -half + (gp[1] + 1) * 0.1, lowN = 0; for (var b = gp[0]; b <= gp[1]; b++) lowN += Wl.low[b]; if (lowN > (gp[1] - gp[0] + 1) * 0.3) return; if (Wl.ax === 2 && Wl.s > 0 && s0 < 1.4 && s1 > -1.4) return; if (s1 - s0 > 14) return;
        var okL = wfree(Wl, s0 - 0.5, s0 - 0.15, 0.22, 0.32, 2 | 4), okR = wfree(Wl, s1 + 0.15, s1 + 0.5, 0.22, 0.32, 2 | 4); if (!okL && !okR) return; out.curtains.push({ w: wi, s0: s0, s1: s1, y0: 0.02, y1: Math.min(hc - 0.15, 3.3), sheer: true, L: okL, R: okR }); wmark(Wl, s0 - 0.5, s1 + 0.5, 0, 0.3, 2 | 4); }); });
    // 3. art on free wall: mid band free within 0.3 m, the wall there (mid coverage), no art already
    var arts = 0, artK = Math.floor(rnd() * 6);
    W.forEach(function (Wl, wi) { if (!Wl) return; var ok = new Uint8Array(Rd.NB); for (var b = 0; b < Rd.NB; b++) { var s = -half + (b + 0.5) * 0.1; ok[b] = Wl.mid[b] && !Wl.hasArt[b] && wfreeA(Wl, s - 0.05, s + 0.05, 0.22, 0.36, 4) ? 1 : 0; }
      runsOf(ok, 1, 9).forEach(function (r) { var s0 = -half + r[0] * 0.1 + 0.25, s1 = -half + (r[1] + 1) * 0.1 - 0.25, L = s1 - s0; if (L < 0.6 || arts >= 10) return;
        var n = L > 7.5 ? 3 : L > 4.2 ? 2 : 1, wA = Math.min(L > 2.2 ? 1.6 : 1.2, L / n - 0.5); if (wA < 0.5) { n = 1; wA = Math.min(1.1, L); } if (wA < 0.45) return;
        for (var k = 0; k < n && arts < 10; k++) { var sc = s0 + L * (k + 0.5) / n; var lowFree = wfree(Wl, sc - wA / 2, sc + wA / 2, 0.22, 0.5, 2); var hA = wA * (wA > 1.2 ? 0.62 + 0.15 * rnd() : 0.75 + 0.3 * rnd()); var yc = Math.max(lowFree ? 1.55 : 1.62, 1.34 + hA / 2); if (yc + hA / 2 > hc - 0.35) hA = (hc - 0.35 - yc) * 2; if (hA < 0.35) continue;
          out.art.push({ w: wi, s: sc, wA: wA, hA: hA, y: yc, i: (artK + arts) % 6 }); arts++; wmark(Wl, sc - wA / 2 - 0.1, sc + wA / 2 + 0.1, 0, 0.3, 4); } }); });
    // 4. plants in free corners
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) { var A = W[i], B = W[j]; if (!A || !B || A.ax !== 0 || B.ax !== 2) continue; if (out.plants.length >= 4) break; var x = A.c - A.s * 0.42, z = B.c - B.s * 0.42; if (z > half - 1.2 && Math.abs(x) < 1.6) continue;
      if (!free(x - 0.32, x + 0.32, z - 0.32, z + 0.32, 2 | 4 | KEEP)) continue; out.plants.push({ x: x, z: z, h: 1.1 + rnd() * 0.6, k: Math.floor(rnd() * 3) }); Rd.mark(x - 0.4, x + 0.4, z - 0.4, z + 0.4, 2 | 4); }
    // 5. table tops (solids that are tables, desks or counters, not seats, not already dressed)
    var tops = (info.cands || []).filter(function (s) { if (s._ta < s.w * s.d * 0.5 || s._ab > 10) return false; return !info.solids.some(function (o) { return o !== s && Math.abs(o.w - s.w) < 0.06 && Math.abs(o.d - s.d) < 0.06 && Math.hypot(o.x - s.x, o.z - s.z) < 1.2 && Math.abs(o.y1 - s.y1) > 0.1; }); });
    tops.forEach(function (s) { if (out.tops.length >= 12) return; var near = info.seats.some(function (q) { return Math.hypot(q.x - s.x, q.z - s.z) < Math.max(s.w, s.d) / 2 + 1.0; }); out.tops.push({ s: s, near: near, k: Math.floor(rnd() * 4), lampOk: /^(hotel|villa|lodge|ranch|glamp|cozy|bank|club|warm)$/.test(info.type || "") }); });
    W.forEach(function (Wl) { if (!Wl) return; var last = -1e9; for (var sw = -half + 0.8; sw < half - 0.8 && out.plants.length < 7; sw += 0.4) { if (sw - last < 3.6) continue; var p = wpt(Wl, sw, 0.55); if (Wl.ax === 2 && Wl.s > 0 && Math.abs(sw) < 2.2) continue; if (!free(p[0] - 0.3, p[0] + 0.3, p[1] - 0.3, p[1] + 0.3, 2 | 4 | KEEP)) continue; if (out.plants.some(function (q0) { return Math.hypot(q0.x - p[0], q0.z - p[1]) < 2.0; })) continue; if (!Wl.low[Math.floor((sw + half) / 0.1)]) continue;
        out.plants.push({ x: p[0], z: p[1], h: 1.0 + rnd() * 0.7, k: Math.floor(rnd() * 3) }); Rd.mark(p[0] - 0.4, p[0] + 0.4, p[1] - 0.4, p[1] + 0.4, 2 | 4); last = sw; } });
    info.seats.filter(function (q) { return q.r > 0.45 && /^(hotel|villa|lodge|ranch|glamp|cozy|club|warm)$/.test(info.type || ""); }).forEach(function (q) { if (out.flamps.length >= 2) return; var c0 = Math.cos(q.ry), s0 = Math.sin(q.ry), hl = q.w / 2 + 0.35; [[hl, -q.d * 0.25], [-hl, -q.d * 0.25]].some(function (o) { var x = q.x + o[0] * c0 + o[1] * s0, z = q.z - o[0] * s0 + o[1] * c0; if (Math.abs(x) > half - 0.3 || Math.abs(z) > half - 0.3) return false; if (!free(x - 0.18, x + 0.18, z - 0.18, z + 0.18, 2 | 4)) return false; if (info.seats.some(function (q2) { return q2 !== q && Math.abs(q2.x - x) < q2.ex + 0.2 && Math.abs(q2.z - z) < q2.ez + 0.2; })) return false; out.flamps.push({ x: x, z: z }); Rd.mark(x - 0.25, x + 0.25, z - 0.25, z + 0.25, 2 | 4); return true; }); });
    // 6. rugs under seat groups on bare floor
    var groups = []; info.seats.forEach(function (s) { var gq = null; for (var gi = 0; gi < groups.length; gi++) if (groups[gi].some(function (q) { return Math.hypot(q.x - s.x, q.z - s.z) < 2.4; })) { gq = groups[gi]; break; } if (gq) gq.push(s); else groups.push([s]); });
    groups.forEach(function (gq) { if (gq.length < 2 || out.rugs.length >= 2) return; var x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; gq.forEach(function (s) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }); var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = clamp(x1 - x0 + 0.6, 1.6, 3.6), d = clamp(z1 - z0 + 0.6, 1.4, 2.8);
      if (Math.abs(cx) + w / 2 > half - 0.3 || Math.abs(cz) + d / 2 > half - 0.3) return; if (!free(cx - w / 2 - 0.5, cx + w / 2 + 0.5, cz - d / 2 - 0.5, cz + d / 2 + 0.5, 1)) return; if (/^(saloon|diner|gallery|chapel|barn|hangar)$/.test(info.type || "")) return; out.rugs.push({ x: cx, z: cz, w: w, d: d, k: out.rugs.length % 2, ry: w >= d ? 0 : PI2 }); Rd.mark(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, 1); });
    if (half >= 5.5 && /^(hotel|villa|lodge|ranch|glamp|cozy|bank|club|warm)$/.test(info.type || "")) { var sizes = [[4.2, 2.9], [3.4, 2.4], [2.6, 1.8]]; for (var si = 0; si < sizes.length && out.rugs.length < (half > 9 ? 2 : 1); si++) { var rw = sizes[si][0], rd = sizes[si][1]; for (var gx = -half + rw / 2 + 0.6; gx <= half - rw / 2 - 0.6 && out.rugs.length < (half > 9 ? 2 : 1); gx += 0.6) for (var gz = -half + rd / 2 + 0.6; gz <= half - rd / 2 - 1.8; gz += 0.6) {
        if (!free(gx - rw / 2, gx + rw / 2, gz - rd / 2, gz + rd / 2, 1 | 2) || !free(gx - rw / 2 - 0.8, gx + rw / 2 + 0.8, gz - rd / 2 - 0.8, gz + rd / 2 + 0.8, 1)) continue; if (out.rugs.some(function (r0) { return Math.abs(r0.x - gx) < (r0.w + rw) / 2 + 1.2 && Math.abs(r0.z - gz) < (r0.d + rd) / 2 + 1.2; })) continue; out.rugs.push({ x: gx, z: gz, w: rw, d: rd, k: out.rugs.length % 2, ry: 0 }); Rd.mark(gx - rw / 2, gx + rw / 2, gz - rd / 2, gz + rd / 2, 1); break; } } }
    DR.dbg = { sol: info.solids.filter(function (q) { return q.ex > 1.5 || q.ez > 1.5; }).map(function (q) { return [+q.x.toFixed(1), +q.z.toFixed(1), +q.ex.toFixed(1), +q.ez.toFixed(1), +q.y0.toFixed(1), +q.y1.toFixed(1)]; }), walls: W.map(function (Wl) { if (!Wl) return null; var m = 0, l = 0, t = 0, ha = 0, ok = 0; for (var b = 0; b < Rd.NB; b++) { m += Wl.mid[b]; l += Wl.low[b]; t += Wl.top[b]; ha += Wl.hasArt[b]; var s = -half + (b + 0.5) * 0.1; if (Wl.mid[b] && !Wl.hasArt[b] && wfreeA(Wl, s - 0.05, s + 0.05, 0.22, 0.36, 4)) ok++; } return { c: +Wl.c.toFixed(2), ax: Wl.ax, s: Wl.s, mid: m, low: l, top: t, art: ha, ok: ok }; }), seats: info.seats.length, solids: info.solids.length, cands: (info.cands || []).map(function (q) { return [+q.w.toFixed(1), +q.d.toFixed(1), +q.y1.toFixed(2), +q._ta.toFixed(2), q._ab]; }), hc: hc };
    return out;
  }
  // ── the geometry ──
  var LEAFG = null; function leafG() { if (LEAFG) return LEAFG; var g = new THREE.PlaneGeometry(1, 1, 1, 4); var P = g.attributes.position; for (var i = 0; i < P.count; i++) { var y = P.getY(i) + 0.5; P.setY(i, y); P.setZ(i, -0.18 * y * y); var w = Math.sin(Math.PI * Math.min(1, y)) * 0.9 + 0.1; P.setX(i, P.getX(i) * w); } g.computeVertexNormals(); return (LEAFG = g); }
  function plant(D, p, rnd) { var x = p.x, z = p.z, h = p.h; var pot = [[0, 0], [0.17, 0], [0.2, 0.04], [0.23, 0.36], [0.255, 0.38], [0.255, 0.42], [0.22, 0.42], [0.2, 0.37], [0, 0.37]];
    var pc = [rgbOf(0xb4623e), rgbOf(0xe9e4da), rgbOf(0x3a3a38)][p.k]; D.geo(dg("pot", function () { return new THREE.LatheGeometry(pot.map(function (q) { return new THREE.Vector2(q[0], q[1]); }), 20); }), x, 0, z, 0, 0, AT.plain, pc, p.k === 1 ? DM.gloss : DM.matte);
    D.geo(dg("soil", function () { var c = new THREE.CircleGeometry(0.205, 16); c.rotateX(-PI2); return c; }), x, 0.36, z, 0, 0, AT.plain, rgbOf(0x3a2a1e), DM.matte);
    var n = 14 + Math.floor(rnd() * 8); for (var i = 0; i < n; i++) { var ang = i * 2.39996 + rnd() * 0.5, tilt = 0.12 + (i / n) * 0.9 + rnd() * 0.15, L = (0.5 + rnd() * 0.5) * h * (1 - tilt * 0.3), W = 0.1 + rnd() * 0.09; var gc = 0.7 + rnd() * 0.45;
      D.geo(leafG(), x + Math.sin(ang) * 0.05, 0.36, z + Math.cos(ang) * 0.05, ang, -tilt, AT.leaf, [gc, gc, gc], DM.leaf, [W * 2.2, L, L]); } }
  function artPiece(D, Wl, a, th) { var c = Wl.ax === 0 ? [Wl.c - Wl.s * 0.012, a.s] : [a.s, Wl.c - Wl.s * 0.012], ry = Wl.ax === 0 ? (Wl.s > 0 ? -PI2 : PI2) : (Wl.s > 0 ? PI : 0); var fw = 0.05, dep = 0.035, w = a.wA, h = a.hA, y = a.y;
    var fc = th.frame, mat = th.frameM; var off = function (d) { return Wl.ax === 0 ? [c[0] - Wl.s * d, c[1]] : [c[0], c[1] - Wl.s * d]; };
    var o1 = off(dep / 2), lx = Math.cos(ry), lz = -Math.sin(ry);   // the frame's local +x in the room
    D.box(w + 2 * fw, fw, dep, o1[0], y + h / 2 + fw / 2, o1[1], ry, AT.wood, fc, mat); D.box(w + 2 * fw, fw, dep, o1[0], y - h / 2 - fw / 2, o1[1], ry, AT.wood, fc, mat);
    D.box(fw, h, dep, o1[0] + lx * (w / 2 + fw / 2), y, o1[1] + lz * (w / 2 + fw / 2), ry, AT.wood, fc, mat); D.box(fw, h, dep, o1[0] - lx * (w / 2 + fw / 2), y, o1[1] - lz * (w / 2 + fw / 2), ry, AT.wood, fc, mat);
    var o2 = off(0.008); D.box(w, h, 0.012, o2[0], y, o2[1], ry, AT.plain, rgbOf(0xeee6d6), DM.paper);   // the mat
    var mt = Math.min(w, h) * 0.09, o3 = off(0.016), r = AT.art[a.i]; var aw = w - 2 * mt, ah = h - 2 * mt, asp = aw / ah, ru = r[2] - r[0], rv = r[3] - r[1];
    var cu = asp >= 1 ? [r[0], r[1] + rv * (1 - 1 / asp) / 2, r[2], r[3] - rv * (1 - 1 / asp) / 2] : [r[0] + ru * (1 - asp) / 2, r[1], r[2] - ru * (1 - asp) / 2, r[3]];
    D.geo(dg("quad", function () { return new THREE.PlaneGeometry(1, 1); }), o3[0], y, o3[1], ry, 0, cu, [1, 1, 1], DM.satin, [aw, ah, 1]); }
  function curtain(D, Wl, cu, th) { var ry = Wl.ax === 0 ? (Wl.s > 0 ? -PI2 : PI2) : (Wl.s > 0 ? PI : 0), lx = Math.cos(ry), lz = -Math.sin(ry); var dIn = 0.1, y0 = cu.y0, y1 = cu.y1, H = y1 - y0;
    var at = function (s, d) { return Wl.ax === 0 ? [Wl.c - Wl.s * d, s] : [s, Wl.c - Wl.s * d]; };
    // the panels: pleated (a sine in depth across the width), gathered either side of the opening
    var pw = cu.sheer ? 0.6 : 0.42, folds = cu.sheer ? 7 : 5, seg = folds * 4, col = cu.sheer ? [Math.min(1, th.curtain[0] * 0.5 + 0.5), Math.min(1, th.curtain[1] * 0.5 + 0.5), Math.min(1, th.curtain[2] * 0.5 + 0.5)] : th.curtain; [[cu.s0 - pw / 2 + 0.08, -1], [cu.s1 + pw / 2 - 0.08, 1]].filter(function (q) { return !cu.sheer || (q[1] < 0 ? cu.L : cu.R); }).forEach(function (q) { var g = new THREE.PlaneGeometry(pw, H, seg, 1), P = g.attributes.position; for (var i = 0; i < P.count; i++) { var u = (P.getX(i) / pw + 0.5) * folds * TAU; P.setZ(i, Math.sin(u) * 0.035); } g.computeVertexNormals(); var p = at(q[0], dIn);
      D.geo(g, p[0], y0 + H / 2, p[1], ry, 0, AT.linen, col, DM.cloth, [1, 1, 1]); g.dispose(); var pb = at(q[0], dIn + 0.001); D.geo(dg("quad", function () { return new THREE.PlaneGeometry(1, 1); }), pb[0], y0 + H / 2, pb[1], ry + PI, 0, AT.linen, [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8], DM.cloth, [pw, H, 1]); });
    // the rod and finials
    var ra = cu.s0 - pw - 0.05, rb = cu.s1 + pw + 0.05, pr = at((ra + rb) / 2, dIn + 0.03); D.geo(dg("rod", function () { var c = new THREE.CylinderGeometry(0.014, 0.014, 1, 8); c.rotateZ(PI2); return c; }), pr[0], y1 + 0.04, pr[1], ry, 0, AT.plain, th.rod, DM.metal, [rb - ra, 1, 1]);
    [ra, rb].forEach(function (s) { var pf = at(s, dIn + 0.03); D.geo(dg("fin", function () { return new THREE.SphereGeometry(0.03, 8, 6); }), pf[0], y1 + 0.04, pf[1], 0, 0, AT.plain, th.rod, DM.metal); var pk = at(s + (s === ra ? 0.05 : -0.05), (dIn + 0.03) / 2); D.box(0.02, 0.04, dIn + 0.02, pk[0], y1 + 0.04, pk[1], ry, AT.plain, th.rod, DM.metal); }); }
  function trimRun(D, Wl, t, Rd, th) { var ry = Wl.ax === 0 ? (Wl.s > 0 ? -PI2 : PI2) : (Wl.s > 0 ? PI : 0), L = t.s1 - t.s0, sm = (t.s0 + t.s1) / 2; if (L < 0.3) return;
    var at = function (d) { return Wl.ax === 0 ? [Wl.c - Wl.s * d, sm] : [sm, Wl.c - Wl.s * d]; };
    if (t.kind === "base") { var p = at(0.012); D.box(L, 0.13, 0.024, p[0], 0.065, p[1], ry, AT.wood, th.base, th.baseM); var p2 = at(0.026); D.box(L, 0.02, 0.012, p2[0], 0.12, p2[1], ry, AT.wood, th.base, th.baseM); }
    else { var hc = Rd.hc; var p3 = at(0.03); D.box(L, 0.1, 0.06, p3[0], hc - 0.05, p3[1], ry, AT.plain, th.crown, DM.satin); var p4 = at(0.075); D.box(L, 0.04, 0.03, p4[0], hc - 0.02, p4[1], ry, AT.plain, th.crown, DM.satin); var p5 = at(0.008); D.box(L, 0.03, 0.016, p5[0], hc - 0.115, p5[1], ry, AT.plain, th.crown, DM.satin); } }
  function floorLamp(D, p, lamps) { D.geo(dg("flbase", function () { return new THREE.CylinderGeometry(0.14, 0.16, 0.03, 18); }), p.x, 0.015, p.z, 0, 0, AT.plain, rgbOf(0x2a2622), DM.metal); D.geo(dg("flpole", function () { return new THREE.CylinderGeometry(0.012, 0.012, 1.42, 8); }), p.x, 0.74, p.z, 0, 0, AT.plain, rgbOf(0x8a6a3a), DM.metal);
    D.geo(dg("flshade", function () { return new THREE.CylinderGeometry(0.17, 0.23, 0.3, 20, 1, true); }), p.x, 1.55, p.z, 0, 0, AT.shade, [1, 0.93, 0.8], [0.6, 0.9, 0]); D.geo(dg("flshadeI", function () { var g = new THREE.CylinderGeometry(0.168, 0.228, 0.3, 20, 1, true); g.scale(-1, 1, 1); return g; }), p.x, 1.55, p.z, 0, 0, AT.shade, [1, 0.85, 0.6], [1.3, 0.9, 0]); lamps.push([p.x, 1.5, p.z]); }
  function rug(D, r) { D.box(r.w, 0.012, r.d, r.x, 0.006, r.z, r.ry, AT.rug[r.k], [1, 1, 1], DM.cloth); }
  function topItems(D, t, rnd, lamps, F) { var s = t.s, y = s._tw ? s._ty / s._tw + 0.002 : s.y1, c = Math.cos(s.ry), sn = Math.sin(s.ry), L = function (lx, lz) { return [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c]; }; var hw = s.w / 2 - 0.14, hd = s.d / 2 - 0.14; if (hw < 0.05 || hd < 0.05) return;
    var spot = function (fx, fz) { return L(fx * hw, fz * hd); };
    var books = function (p, n) { for (var i = 0; i < n; i++) { var bw = 0.15 + rnd() * 0.07, bd = 0.21 + rnd() * 0.06, bh = 0.025 + rnd() * 0.02, u = rnd(); var col = [0.7 + rnd() * 0.3, 0.7 + rnd() * 0.3, 0.7 + rnd() * 0.3]; var r = [AT.books[0] + (AT.books[2] - AT.books[0]) * u, AT.books[1], AT.books[0] + (AT.books[2] - AT.books[0]) * Math.min(1, u + 0.06), AT.books[3]];
        D.box(bw, bh, bd, p[0], y + bh / 2 + i * 0.035, p[1], s.ry + (rnd() - 0.5) * 0.5, r, col, DM.satin); } };
    var vase = function (p) { var g = dg("vase", function () { return new THREE.LatheGeometry([[0, 0], [0.05, 0], [0.065, 0.06], [0.05, 0.16], [0.03, 0.22], [0.035, 0.24], [0, 0.24]].map(function (q) { return new THREE.Vector2(q[0], q[1]); }), 14); }); var vc = [rgbOf(0x2f5d6b), rgbOf(0xd9cdb6), rgbOf(0x8a3a2a)][Math.floor(rnd() * 3)]; D.geo(g, p[0], y, p[1], 0, 0, AT.plain, vc, DM.gloss);
      for (var k = 0; k < 5; k++) { var a = rnd() * TAU, tl = 0.15 + rnd() * 0.35; D.geo(leafG(), p[0], y + 0.2, p[1], a, -tl, AT.leaf, [0.9, 0.95, 0.9], DM.leaf, [0.1, 0.32, 0.32]); } var fl = [rgbOf(0xf2e6c8), rgbOf(0xe8a23a), rgbOf(0xc24a5a)][Math.floor(rnd() * 3)]; for (var f = 0; f < 3; f++) { var a3 = rnd() * TAU; D.geo(dg("bud", function () { return new THREE.SphereGeometry(0.03, 8, 6); }), p[0] + Math.sin(a3) * 0.07, y + 0.42 + rnd() * 0.06, p[1] + Math.cos(a3) * 0.07, 0, 0, AT.plain, fl, DM.satin); } };
    var candle = function (p) { D.geo(dg("cand", function () { return new THREE.CylinderGeometry(0.03, 0.03, 0.14, 10); }), p[0], y + 0.07, p[1], 0, 0, AT.plain, rgbOf(0xf3ead8), DM.satin); D.geo(dg("cdl", function () { return new THREE.CylinderGeometry(0.055, 0.06, 0.012, 12); }), p[0], y + 0.006, p[1], 0, 0, AT.plain, rgbOf(0xb08a4a), DM.metal); D.geo(dg("flm", function () { return new THREE.SphereGeometry(0.012, 6, 5); }), p[0], y + 0.155, p[1], 0, 0, AT.plain, rgbOf(0xffc070), DM.glow, [1, 1.8, 1]); };
    var bowl = function (p) { D.geo(dg("bowl", function () { return new THREE.LatheGeometry([[0, 0], [0.06, 0], [0.13, 0.07], [0.125, 0.075], [0.055, 0.012], [0, 0.012]].map(function (q) { return new THREE.Vector2(q[0], q[1]); }), 18); }), p[0], y, p[1], 0, 0, AT.plain, rgbOf(0xc8b89a), DM.gloss); for (var k = 0; k < 4; k++) D.geo(dg("frt", function () { return new THREE.SphereGeometry(0.035, 8, 6); }), p[0] + (rnd() - 0.5) * 0.09, y + 0.05, p[1] + (rnd() - 0.5) * 0.09, 0, 0, AT.plain, [rgbOf(0xd8862a), rgbOf(0xb83a2a), rgbOf(0xd8c24a)][k % 3], DM.satin); };
    var papers = function (p) { D.box(0.22, 0.004, 0.3, p[0], y + 0.002, p[1], s.ry + (rnd() - 0.5) * 0.6, AT.news, [1, 1, 1], DM.paper); D.box(0.21, 0.004, 0.28, p[0] + 0.04, y + 0.006, p[1] - 0.02, s.ry + (rnd() - 0.5) * 0.6, AT.mag, [1, 1, 1], DM.paper); };
    var lamp = function (p) { D.geo(dg("lbase", function () { return new THREE.LatheGeometry([[0, 0], [0.08, 0], [0.08, 0.02], [0.03, 0.05], [0.05, 0.16], [0.02, 0.28], [0.012, 0.42], [0, 0.42]].map(function (q) { return new THREE.Vector2(q[0], q[1]); }), 14); }), p[0], y, p[1], 0, 0, AT.plain, rgbOf(0x6a5a48), DM.gloss);
      D.geo(dg("lshade", function () { return new THREE.CylinderGeometry(0.11, 0.17, 0.2, 18, 1, true); }), p[0], y + 0.5, p[1], 0, 0, AT.shade, [1, 0.93, 0.8], [0.55, 0.9, 0]); D.geo(dg("lshadeI", function () { var g = new THREE.CylinderGeometry(0.108, 0.168, 0.2, 18, 1, true); g.scale(-1, 1, 1); return g; }), p[0], y + 0.5, p[1], 0, 0, AT.shade, [1, 0.85, 0.6], [1.2, 0.9, 0]);
      lamps.push([p[0], y + 0.48, p[1]]); };
    var small = s.w * s.d < 0.75;
    if (small) { if (t.near && lamps.length < 3 && t.lampOk) lamp(spot(0.1, 0)); else if (t.k % 2) vase(spot(0, 0)); else { books(spot(-0.3, 0.2), 2 + Math.floor(rnd() * 2)); candle(spot(0.5, -0.4)); } return; }
    var long = s.w > s.d * 1.8 || s.d > s.w * 1.8;
    if (t.k === 0) { vase(spot(0, 0)); candle(spot(-0.55, 0.2)); candle(spot(0.55, -0.2)); }
    else if (t.k === 1) { bowl(spot(0, 0)); books(spot(0.7, 0.5), 2); }
    else if (t.k === 2) { books(spot(-0.6, -0.3), 3); papers(spot(0.2, 0.3)); if (long) vase(spot(0.75, -0.2)); }
    else { candle(spot(-0.3, 0)); candle(spot(0.0, 0.1)); candle(spot(0.3, -0.05)); if (long) bowl(spot(-0.75, 0)); } }
  // per room type: frame, curtain, trim colours
  function themeOf(type, rnd) { var T = {
      saloon: { frame: rgbOf(0x5a3a22), curtain: rgbOf(0x7a1e1a), base: rgbOf(0x4a2e1a), crown: rgbOf(0x5a3a22) }, hotel: { frame: rgbOf(0xb8913e, 1), curtain: rgbOf(0x6e2c24), base: rgbOf(0x3a2618), crown: rgbOf(0xe8dcc4) },
      bank: { frame: rgbOf(0xa98a4a), curtain: rgbOf(0x2c4a3a), base: rgbOf(0x2a2420), crown: rgbOf(0xe8e0cc) }, diner: { frame: rgbOf(0xc8ccd0), curtain: rgbOf(0xb83a32), base: rgbOf(0x222222), crown: rgbOf(0xf2f2ee) },
      villa: { frame: rgbOf(0x2a2622), curtain: rgbOf(0xe8e0d0), base: rgbOf(0xf2ede4), crown: rgbOf(0xf4f0e8) }, ranch: { frame: rgbOf(0x6a4a2e), curtain: rgbOf(0xc8b494), base: rgbOf(0x5a3c24), crown: rgbOf(0x6a4a2e) },
      lodge: { frame: rgbOf(0x4a3220), curtain: rgbOf(0x8a5a3a), base: rgbOf(0x4a3220), crown: rgbOf(0x4a3220) }, glamp: { frame: rgbOf(0x8a6a48), curtain: rgbOf(0xe0d4bc), base: rgbOf(0x8a6a48), crown: rgbOf(0x8a6a48) },
      gallery: { frame: rgbOf(0x1e1e1e), curtain: rgbOf(0xe8e6e0), base: rgbOf(0xf0eee8), crown: rgbOf(0xf4f2ee) }, chapel: { frame: rgbOf(0x8a6a3a), curtain: rgbOf(0x6a2a2a), base: rgbOf(0x3a2a1e), crown: rgbOf(0xe0d4bc) } };
    var t = T[type] || { frame: rgbOf(0x4a3828), curtain: rgbOf(0xcdbfa6), base: rgbOf(0x4a3828), crown: rgbOf(0xeee6d6) }; var o = {}; for (var k in t) o[k] = t[k]; o.frameM = (type === "hotel" || type === "bank" || type === "chapel") ? DM.metal : DM.satin; o.baseM = DM.satin; o.rod = rgbOf(type === "diner" || type === "gallery" ? 0xb8bcc0 : 0x7a5a32); return o; }
  // build (or reuse) the dressing of a room: g the room group (its frame), key the cache key, F the floor, info { seats, solids, spots, hgt }
  function dressBuild(g, key, half, F, type, info, R, opt) {
    var t0 = performance.now(), hit = DR.cache.get(key), plan, geo;
    if (hit) { DR.cache.delete(key); DR.cache.set(key, hit); geo = hit.geo; plan = hit.plan; }
    else { info.cands = info.solids.filter(function (s) { return !s.seat && s.y1 > 0.5 && s.y1 < 1.15 && Math.min(s.w, s.d) >= 0.4 && Math.max(s.w, s.d) < 4 && s.w * s.d < 7; }); var Rd = readRoom(g, half, F, info.hgt, info.cands, opt); DR.lastRd = Rd; var rnd = rngOf(hashS(key));  plan = planRoom(Rd, info, rnd, null); var th = themeOf(type, rnd);
      var D = new DB(), lamps = []; plan.rugs.forEach(function (r) { rug(D, r); }); plan.trim.forEach(function (t) { trimRun(D, Rd.walls[t.w], t, Rd, th); }); plan.curtains.forEach(function (c) { curtain(D, Rd.walls[c.w], c, th); }); plan.art.forEach(function (a) { artPiece(D, Rd.walls[a.w], a, th); });
      plan.plants.forEach(function (p) { plant(D, p, rnd); }); plan.flamps.forEach(function (p) { floorLamp(D, p, lamps); }); plan.tops.forEach(function (t) { topItems(D, t, rnd, lamps, F); }); plan.lamps = lamps;
      if (!D.nv) geo = null; else { geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(D.p, 3)); geo.setAttribute("normal", new THREE.Float32BufferAttribute(D.n, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(D.u, 2)); geo.setAttribute("color", new THREE.Float32BufferAttribute(D.c, 3)); geo.setAttribute("aD", new THREE.Float32BufferAttribute(D.d, 3)); geo.setIndex(D.nv > 65535 ? new THREE.Uint32BufferAttribute(D.i, 1) : new THREE.Uint16BufferAttribute(D.i, 1)); geo.computeBoundingSphere(); geo.userData.avShared = true; }
      plan.read = { ms: Rd.ms, tris: Rd.tris, stride: Rd.stride, hc: Rd.hc, walls: Rd.walls.map(function (W) { return W ? [W.ax, W.s, +W.c.toFixed(2), Math.round(W.w)] : null; }) };
      DR.cache.set(key, { geo: geo, plan: plan }); while (DR.cache.size > 6) { var k0 = DR.cache.keys().next().value, old = DR.cache.get(k0); DR.cache.delete(k0); if (old.geo && !DR.meshes.some(function (m) { return m.geometry === old.geo && m.parent; })) old.geo.dispose(); } }
    try { if (info.ao && R && plan.read && !g.userData.rlAO && RL.creaseAO) { var Wd = plan.read.walls; if (Wd[0] && Wd[1] && Wd[2] && Wd[3]) { g.userData.rlAO = RL.creaseAO(R, g, { box: [Wd[0][2], Wd[1][2], F, F + plan.read.hc, Wd[2][2], Wd[3][2]], skip: [2], k: 0.36 }); } } } catch (e) { note("dress ao", e); }
    var mesh = null; if (geo) { mesh = new THREE.Mesh(geo, dressMat()); mesh.name = "rl dress"; mesh.position.y = F; mesh.userData.rlDress = true; mesh.userData.noSolid = true; mesh.userData.rlNoFix = true; mesh.receiveShadow = true; mesh.castShadow = false; mesh.visible = !!RL.part.dress; g.add(mesh); DR.meshes = DR.meshes.filter(function (m) { return m.parent; }); DR.meshes.push(mesh); }
    // the plants' solids and the lamps (pool fixtures), every entry (the client clears room solids on the way out)
    try { if (typeof addSolid === "function") { g.updateMatrixWorld(true); var e = new THREE.Vector3(); plan.plants.forEach(function (p) { e.set(p.x, F, p.z).applyMatrix4(g.matrixWorld); addSolid(e.x, e.z, 0, 0.5, 0.5, e.y - 0.2, e.y + 1.2, info.solidTag || "room"); }); } } catch (x) { note("dress solids", x); }
    if (R && plan.lamps) plan.lamps.forEach(function (l) { R.light(l[0], l[1] + F, l[2], [1, 0.78, 0.5], 0.9, 3.6, { decay: 1.6 }); });
    DR.n.rooms++; var ms = +(performance.now() - t0).toFixed(1); DR.n.last = { key: key, ms: ms, cached: !!hit, art: plan.art.length, plants: plan.plants.length, tops: plan.tops.length, rugs: plan.rugs.length, curtains: plan.curtains.length, trim: plan.trim.length, lamps: (plan.lamps || []).length, read: plan.read, tris: geo ? geo.index.count / 3 : 0 }; DR.n.ms = Math.max(DR.n.ms, ms); return mesh;
  }
  // how much already stands on each table top (a dressed table is left alone)
  function aboveCounts(g, solids, F) { var out = []; if (!solids.length) return out; var inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), v = new THREE.Vector3(), cnt = solids.map(function () { return 0; });
    g.traverse(function (o) { if (!o.isMesh || !o.geometry || o.userData.rlDress || o.isInstancedMesh) return; var P = o.geometry.attributes.position; if (!P) return; var mm = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), st = Math.max(1, Math.floor(P.count / 20000));
      for (var i = 0; i < P.count; i += st) { v.fromBufferAttribute(P, i).applyMatrix4(mm); var y = v.y - F; for (var k = 0; k < solids.length; k++) { var s = solids[k]; if (y < s.y1 + 0.02 || y > s.y1 + 0.6) continue; var dx = v.x - s.x, dz = v.z - s.z, c = Math.cos(s.ry), sn = Math.sin(s.ry), lx = dx * c - dz * sn, lz = dx * sn + dz * c; if (Math.abs(lx) < s.w / 2 - 0.05 && Math.abs(lz) < s.d / 2 - 0.05) cnt[k] += st; } } });
    solids.forEach(function (s, k) { out.push({ s: s, n: cnt[k] }); }); return out; }
  // the room's solids, seats and hotspots in its frame (from the client's SOLIDS: tag "room", inside the room square)
  function roomInfo(g, half, F, spots, hgt, zo) { var inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), v = new THREE.Vector3(), out = { seats: [], solids: [], spots: [], hgt: hgt }, yaw0 = 0;
    try { var q = new THREE.Quaternion(), sc = new THREE.Vector3(), pp = new THREE.Vector3(); g.matrixWorld.decompose(pp, q, sc); yaw0 = new THREE.Euler().setFromQuaternion(q, "YXZ").y; } catch (e) {}
    var gy = g.matrixWorld.elements[13];
    try { for (var i = 0; i < SOLIDS.length; i++) { var s = SOLIDS[i]; if (!zo && s.tag !== "room" && !(typeof s.tag === "string" && s.tag.indexOf("room:") === 0)) continue; if (zo && s.tag === "dress") continue; v.set(s.x, 0, s.z).applyMatrix4(inv); if (Math.abs(v.x) > (zo ? zo.hx : half) - 0.05 || Math.abs(v.z) > (zo ? zo.hz : half) - 0.05) continue; if (zo && (s.y1 < F + 0.05 || s.y0 > F + 2.5)) continue; var w = s.hw * 2, d = s.hd * 2; if (w > 2 * half - 0.6 && d > 2 * half - 0.6) continue; if (Math.max(w, d) > half * 1.2 && Math.min(w, d) < 0.6) continue;   // the room's wall solids   // the room's own floor slab
        var o = { x: v.x, z: v.z, w: w, d: d, ry: (s.ry || 0) - yaw0, y0: s.y0 - gy - F, y1: s.y1 - gy - F, seat: !!s.seat, r: Math.max(w, d) / 2 }; var cr0 = Math.abs(Math.cos(o.ry)), sr0 = Math.abs(Math.sin(o.ry)); o.ex = (w * cr0 + d * sr0) / 2; o.ez = (w * sr0 + d * cr0) / 2; if (o.seat) out.seats.push(o); else out.solids.push(o); } } catch (e) { note("dress info", e); }
    (spots || []).forEach(function (s) { out.spots.push({ x: s.x, z: s.z }); }); return out; }
  // the R14 rooms (called from ctxRoom with the room it made)
  // the R14 rooms (called from ctxRoom with the room it made): a room seen before builds at once from the cache; a new one is read in
  // 6 ms steps over the next frames (under the entry fade), so the entry frame pays nothing
  RL.dressCtx = function (ctx, R, type) { if (!DR.on || !ctx || !ctx.g || !ctx.half) return null; try { var F = R && typeof R.floorY === "number" ? R.floorY : 0.05; var key = (ctx.id || "r") + ":" + (ctx.kind || "") + ":" + (ctx.door ? ctx.door.i : 0) + ":" + ctx.half.toFixed(2); if (R) R.drKey = key;
      var info = roomInfo(ctx.g, ctx.half, F, ctx.spots, ctx.hgt); info.type = type || (R && R.type) || "cozy"; info.ao = /^homes:/.test(ctx.id || "") && !/glamp/.test(ctx.id || "");
      if (DR.cache.has(key) || DR.sync) return dressBuild(ctx.g, key, ctx.half, F, info.type, info, R);
      DR.pend = { g: ctx.g, key: key, half: ctx.half, F: F, info: info, R: R, col: new Collector([ctx.g], ctx.g, ctx.half, -1e9, 1e9), t0: performance.now(), ms: 0 }; return null; } catch (e) { note("dress " + (ctx.id || ""), e); return null; } };
  DR.pendTick = function () { var P = DR.pend; if (!P) return; if (!P.g.parent) { DR.pend = null; return; } var t0 = performance.now(), done = false; try { done = P.col.step(6); } catch (e) { note("dress read", e); DR.pend = null; return; } P.ms += performance.now() - t0;
    if (!done) return; DR.pend = null; try { var t1 = performance.now(); dressBuild(P.g, P.key, P.half, P.F, P.info.type, P.info, P.R, { tris: P.col.tris, stride: P.col.stride }); P.ms += performance.now() - t1; DR.n.last.pms = +P.ms.toFixed(1); DR.n.last.frames = Math.round((performance.now() - P.t0) / 16.7); } catch (e) { note("dress build", e); } };
  // a walk-in or venue room: a group whose frame is the room's (box half size, floor), registered by a module or by RL.dressZone
  RL.dressRoom = function (g, key, half, F, type, hgt, R) { if (!DR.on || !g) return null; try { var info = roomInfo(g, half, F, [], hgt); info.type = type; return dressBuild(g, key, half, F, type, info, R); } catch (e) { note("dress room " + key, e); return null; } };
  DR.apply = function (on) { DR.meshes.forEach(function (m) { m.visible = on; }); };
  var _ctxRoom0 = RL.ctxRoom; RL.ctxRoom = function (ctx) { var R = _ctxRoom0(ctx); if (R && DR.on) { try { RL.dressCtx(ctx, R, R.type); } catch (e) { note("dress ctx", e); } } return R; };

  // ── zones: rooms of the venue modules and walk-ins, by their own site frames; read at idle as the player comes near (in 4 ms
  //    steps inside the frame), built before the door, shown while near ──
  var ZONES = DR.zones = [];
  DR.zone = function (o) { ZONES.push({ o: o, st: 0, col: null, holder: null, mesh: null, err: 0 }); };
  function zoneFrame(z) { var h = new THREE.Object3D(); h.position.set(z.x, 0, z.z); h.rotation.y = z.yaw; h.name = "rl dress zone " + z.id; h.userData.rlDress = true; h.updateMatrixWorld(true); return h; }
  DR.zoneTick = function (now) { if (!DR.on || !ZONES.length) return; var cam = camera.position, busy = null;
    for (var i = 0; i < ZONES.length; i++) { var Z = ZONES[i]; if (Z.st < 0) continue; var z = Z.z; if (!z) { try { z = Z.z = Z.o.def(); } catch (e) { z = null; } if (!z) { if (++Z.err > 20) Z.st = -1; continue; } }
      var d = Math.hypot(cam.x - z.x, cam.z - z.z), R0 = Math.max(z.hx, z.hz);
      if (Z.dyn && !Z.dyn.parent) { if (Z.holder && Z.holder.parent) Z.holder.parent.remove(Z.holder); ZONES.splice(i, 1); i--; continue; }
      if (Z.holder) Z.holder.visible = !!RL.part.dress && d < R0 + 90;
      if (Z.st === 0 && d < R0 + 45 && !busy) { var roots = []; try { roots = Z.o.roots(); } catch (e) {} if (!roots.length) continue; Z.holder = zoneFrame(z); scene.add(Z.holder); Z.col = new Collector(roots, Z.holder, Math.max(z.hx, z.hz), (z.y0 !== undefined ? z.y0 : -1e9), (z.y1 !== undefined ? z.y1 : 1e9), 90000); Z.st = 1; Z.t0 = now; Z.ms = 0; }
      if (Z.st === 1 && !busy) { busy = Z; var t0 = performance.now(); var done = false; try { done = Z.col.step(4); } catch (e) { note("zone read " + z.id, e); Z.st = -1; continue; } Z.ms += performance.now() - t0;
        if (done) { try { var tr = Z.col.tris, half = Math.max(z.hx, z.hz); var F = z.F !== undefined ? z.F : floorOf(tr, z.hx, z.hz); var info = roomInfo(Z.holder, half, F, [], z.hgt, z); info.type = z.type; info.frontDoor = false; info.solidTag = "dress";
            var t1 = performance.now(); Z.mesh = dressBuild(Z.holder, "zone:" + z.id, half, F, z.type, info, null, { tris: tr, stride: Z.col.stride, hx: z.hx, hz: z.hz }); Z.ms += performance.now() - t1; Z.col = null; Z.st = 2; DR.n.zones = (DR.n.zones || 0) + 1; Z.res = DR.n.last; Z.res.zms = +Z.ms.toFixed(1); } catch (e) { note("zone build " + z.id, e); Z.st = -1; } } } } };
  function floorOf(tris, hx, hz) { var fl = new Map(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3(); for (var f9 = 0; f9 < tris.length; f9 += 9) { a.set(tris[f9], tris[f9 + 1], tris[f9 + 2]); b.set(tris[f9 + 3], tris[f9 + 4], tris[f9 + 5]); c.set(tris[f9 + 6], tris[f9 + 7], tris[f9 + 8]); var cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3; if (Math.abs(cx) > hx || Math.abs(cz) > hz) continue; nn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)); var ar = nn.length() / 2; if (!(ar > 1e-5) || nn.y / (2 * ar) < 0.95) continue; var k = Math.round((a.y + b.y + c.y) / 3 * 50); fl.set(k, (fl.get(k) || 0) + ar); }
    var best = 0, F = 0; fl.forEach(function (w, k) { if (w > best) { best = w; F = k / 50; } }); return F; }
  // a rectangle of a module's site frame (x0, x1, z0, z1 local; l2w = o + x * (c, -s) + z * (s, c)) as a zone
  function rectZone(id, ox, oz, c, sn, r, type, hgt, extra) { var lx = (r[0] + r[1]) / 2, lz = (r[2] + r[3]) / 2; var z = { id: id, x: ox + lx * c + lz * sn, z: oz - lx * sn + lz * c, yaw: Math.atan2(sn, c), hx: (r[1] - r[0]) / 2, hz: (r[3] - r[2]) / 2, type: type, hgt: hgt || 5 }; for (var k in extra || {}) z[k] = extra[k]; return z; }
  function rootsBy(re) { return function () { var out = []; scene.children.forEach(function (o) { if (re.test(o.name || "")) out.push(o); }); return out; }; }
  // the most visited venue rooms
  DR.zone({ roots: rootsBy(/^lb[ _]/), def: function () { var S = window.PLAN_LIBRARY && PLAN_LIBRARY.site; if (!S || !S.rr) return null; return rectZone("library", S.ox, S.oz, S.c, S.s, S.rr, "library", 8, { y0: S.G - 1, y1: S.G + 9 }); } });
  DR.zone({ roots: rootsBy(/^cm[ _]/), def: function () { var S = window.PLAN_CHAINMUSEUM && PLAN_CHAINMUSEUM.site, B = S && S.blocks && S.blocks.filter(function (b) { return b.id === "lobby"; })[0]; if (!B) return null; return rectZone("museum", S.cx, S.cz, S.c, S.s, [B.x0, B.x1, B.z0, B.z1], "museum", B.h); } });
  DR.zone({ roots: rootsBy(/^ro_saloon/), def: function () { var P = window.PLAN_RODEO, S = P && P.site, Sa = P && P.L && P.L.saloon; if (!Sa) return null; return rectZone("rodeo", S.O[0], S.O[1], S.U[0], -S.U[1], [Sa.u0, Sa.u1, Sa.v0, Sa.v1], "saloon", 7, { F: S.YA + S.dS, y0: S.YA - 1, y1: S.YA + S.dS + 8 }); } });
  ["lobby", "brief", "class", "lounge"].forEach(function (rm) { DR.zone({ roots: rootsBy(/^fa2 academy/), def: function () { var S = window.PLAN_FLIGHTACADEMY && PLAN_FLIGHTACADEMY.site, W = S && S.W, r = S && S.rooms && S.rooms[rm]; if (!r) return null; return rectZone("academy_" + rm, S.cx, S.cz, S.cs, S.sn, [r[0], r[1], W.z0, W.z1], rm === "lounge" ? "club" : rm === "lobby" ? "hotel" : "cozy", W.h, { y0: S.G - 1, y1: S.G + 7 }); } }); });
  ["lounge", "reception"].forEach(function (rm) { DR.zone({ roots: rootsBy(/^spa_/), def: function () { var P = window.PLAN_SPA, S = P && P.site, r = P && P.rooms && P.rooms.filter(function (q) { return q.id === rm; })[0]; if (!r) return null; return rectZone("spa_" + rm, S.ox, S.oz, S.c, S.s, r.r, "villa", r.h, { F: S.G, y0: S.G - 1, y1: S.G + r.h + 1 }); } }); });
  // a room the client entered that no module dressed (walk-ins, the FBO hall): a zone over its measured box, in its group's frame
  DR.dynFor = function (g, id, box, type) { if (!DR.on || !g || g.userData.rlDressZ) return; g.userData.rlDressZ = 1; try { g.updateMatrixWorld(true); var cx = (box[0] + box[1]) / 2, cz = (box[4] + box[5]) / 2, p = new THREE.Vector3(cx, 0, cz).applyMatrix4(g.matrixWorld), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pp = new THREE.Vector3(); g.matrixWorld.decompose(pp, q, sc); var yaw = new THREE.Euler().setFromQuaternion(q, "YXZ").y;
      var z = { id: id, x: p.x, z: p.z, yaw: yaw, hx: Math.min(30, (box[1] - box[0]) / 2 - 0.1), hz: Math.min(30, (box[5] - box[4]) / 2 - 0.1), type: type, hgt: Math.min(12, box[3] - box[2]), y0: pp.y + box[2] - 1, y1: pp.y + box[3] + 1 };
      for (var i = ZONES.length - 1; i >= 0; i--) if (ZONES[i].z && ZONES[i].z.id === id) { if (ZONES[i].holder && ZONES[i].holder.parent) ZONES[i].holder.parent.remove(ZONES[i].holder); ZONES.splice(i, 1); }
      ZONES.push({ o: { roots: function () { return [g]; } }, z: z, st: 0, col: null, holder: null, mesh: null, err: 0, dyn: g }); } catch (e) { note("dress dyn " + id, e); } };
  // ───────────────────────── 9. R19 (Agent LI): every bit of interior light comes from a source ─────────────────────────
  // The user: "interior lighting should always come from some light source that generates depth, not just a general light inside
  // buildings that doesnt originate anywhere". Before R19 a room was lit mostly by light with no origin: the sky's hemisphere light
  // and the room's own hemisphere fill (both uniform over the room), the sky's (or the capture's) diffuse environment, a central
  // lamp with no fixture under it, the venues' vertex bake of virtual fixtures and their additive floor pools; the sun never came
  // in at all (the building's own shadow covered the room). Now, while the player is in a room (?rli=0 off; PLAN_RL.set({ li: false })):
  //  - FIXTURES: every fixture is a light at the fixture, by kind (chandelier, pendant, ceiling light, sconce, table and floor lamp,
  //    candle, oil lamp, fire, neon), in physical units: lumens to candela over an emission profile per kind (a shade throws its
  //    light down, a table lamp up and down, a sconce washes the wall), a colour temperature per kind, inverse-square falloff;
  //  - DAYLIGHT through the room's actual openings (portals, the glass in its walls, the door): the sky and the sunlit ground beyond
  //    each opening light the room as area lights (the polygon's exact form factor: brightest at the opening, falling off into the
  //    room), and the sun comes through them, its patch cut by a shadow map of the room (walls, roof, frames, curtains, furniture,
  //    characters); openings that a neighbour shades from the sun get no patch;
  //  - BOUNCE: an irradiance volume baked once per room from those same sources (one bounce off the floor, walls, ceiling and
  //    furniture tops, each with its own colour; L1 per 0.8 m cell), read per pixel on high and ultra, and at the camera as the
  //    hemisphere light (the only one left) for characters and on low and medium;
  //  - SHADOWS AND OCCLUSION: the sun, the key window and the key fixture have shadow maps of the room (rendered with the cascades'
  //    own depth programs, one map a frame); every other fixture is shadowed by the furniture's height field (tables and chairs
  //    throw shadows from every lamp); furniture contact occlusion darkens the bounce under and around it;
  //  - EXPOSURE: the eye adapts to the room's own light (its mean illuminance, in lux, from the bake): night rooms are lit by their
  //    lamps alone, day rooms mostly by their windows (the lamps then read as small warm pools), the sun patch the brightest thing.
  // Light counts never change (the pool's 8 point and 3 spot slots, the 3 hemisphere lights): no program is made for a room. Room
  // materials (the R16 surface pass, high and ultra) evaluate all of it in one shader block; everything else (characters, glass,
  // low and medium) sees the pool, which now holds the nearest fixtures, the key window and the sun beam, at the same intensities.
  var LI = RL.li = { on: false, hi: false, ok: false, R: null, st: 0, ready: 0, G: 0, Gs: 0, NF: 24, NW: 6, cache: new Map(), errs: 0,
    n: { begins: 0, cached: 0, bakeMs: 0, bakeFrames: 0, stepMax: 0, sunBakes: 0, sunMs: 0, shR: 0, shMs: 0, shMax: 0, shCalls: 0, upl: 0, fix: 0, wins: 0, glass: 0, sunWins: 0, patches: 0, cells: 0, frameMs: 0 } };
  RL.part.li = RL.on && !qOff("rli");
  RL.liBake = function () { return !!(RL.on && RL.part.li); };   // the room modules ask: no virtual-fixture bake, no additive light pools, no fixed daylight cards
  var LV = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4(), m3: new THREE.Matrix3(), col: new THREE.Color() };
  function v4s(n) { var a = []; for (var i = 0; i < n; i++) a.push(new THREE.Vector4()); return a; }
  function liU() {
    if (LI.U) return LI.U; var NF = LI.NF, NW = LI.NW;
    LI.U = { uLiOn: { value: new THREE.Vector4() }, uLiMx: { value: new THREE.Vector4() }, uLiCnt: { value: new THREE.Vector4() }, uLiRot: { value: new THREE.Matrix3() }, uLiPos: { value: new THREE.Vector3() }, uLiFl: { value: new THREE.Vector4() },
      uLiFP: { value: v4s(NF) }, uLiFC: { value: v4s(NF) }, uLiFR: { value: v4s(NF) }, uLiWC: { value: v4s(NW * 4) }, uLiWN: { value: v4s(NW) }, uLiSky: { value: new THREE.Vector4() }, uLiGnd: { value: new THREE.Vector4() },
      uLiSunD: { value: new THREE.Vector4() }, uLiSunC: { value: new THREE.Vector4() }, tLiSh: { value: null }, uLiShM: { value: [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()] }, uLiShT: { value: v4s(3) }, uLiShK: { value: v4s(3) }, uLiShP: { value: v4s(3) },
      uLiShA: { value: new THREE.Vector4(0.5 / 2048, 0, 0, 0) }, tLiVol: { value: null }, uLiVo: { value: new THREE.Vector4() }, uLiVs: { value: new THREE.Vector4(1, 1, 1, 1) }, uLiAoT: { value: new THREE.Vector4() }, uLiAoR: { value: new THREE.Vector4() } };
    return LI.U;
  }
  // ── the shader (room materials, high and ultra): uniforms after <common>, functions after <packing>, the lights in
  //    lights_fragment_begin (the pool's points and spots and the cascaded sun step aside for the room's own sources), the bounce
  //    in place of the hemisphere lights and the environment's diffuse part, the contact occlusion before lights_fragment_end ──
  function liDecl() { return ["#define LI_NF " + LI.NF, "#define LI_NW " + LI.NW,
    "uniform vec4 uLiOn; uniform vec4 uLiMx; uniform vec4 uLiCnt; uniform mat3 uLiRot; uniform vec3 uLiPos; uniform vec4 uLiFl;",
    "uniform vec4 uLiFP[ LI_NF ]; uniform vec4 uLiFC[ LI_NF ]; uniform vec4 uLiFR[ LI_NF ];",
    "uniform vec4 uLiWC[ LI_NW * 4 ]; uniform vec4 uLiWN[ LI_NW ]; uniform vec4 uLiSky; uniform vec4 uLiGnd; uniform vec4 uLiSunD; uniform vec4 uLiSunC;",
    "uniform sampler2D tLiSh; uniform mat4 uLiShM[ 3 ]; uniform vec4 uLiShT[ 3 ]; uniform vec4 uLiShK[ 3 ]; uniform vec4 uLiShP[ 3 ]; uniform vec4 uLiShA;",
    "uniform highp sampler3D tLiVol; uniform vec4 uLiVo; uniform vec4 uLiVs; uniform vec4 uLiAoT; uniform vec4 uLiAoR;"].join("\n"); }
  var LI_FN = [
    "const vec2 LI_PD[ 8 ] = vec2[ 8 ]( vec2( -0.613, 0.354 ), vec2( 0.17, -0.89 ), vec2( 0.795, 0.42 ), vec2( -0.25, -0.33 ), vec2( 0.31, 0.21 ), vec2( -0.84, -0.43 ), vec2( 0.05, 0.93 ), vec2( 0.62, -0.38 ) );",
    "vec3 liWP() { return ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz + cameraPosition; }",
    // a shadow map of the atlas: 8 taps rotated per pixel (the TAA resolves them), outside its frustum the point is lit
    // the bias follows the light's own direction at the point (the apex of a spot, the sun's direction) and, for a spot, the size of
    // a texel there (it grows with the distance from the apex)
    "float liShadow( const in int k, const in vec3 wp, const in vec3 nw, const in float ndl0 ) {",
    "\tvec4 K = uLiShK[ k ]; if ( K.z < 0.5 ) return 1.0; vec4 Q = uLiShP[ k ]; vec3 ldir = Q.w > 0.5 ? Q.xyz - wp : Q.xyz; float dl = Q.w > 0.5 ? length( ldir ) : 1.0; ldir /= max( length( ldir ), 1e-5 );",
    "\tfloat ndl = clamp( dot( nw, ldir ), 0.0, 1.0 ), sn = sqrt( max( 0.0, 1.0 - ndl * ndl ) );",
    "\tvec4 sc = uLiShM[ k ] * vec4( wp + nw * ( K.w * dl * ( 0.6 + 2.2 * sn ) ), 1.0 ); sc.xyz /= sc.w;",
    "\tif ( sc.x <= 0.002 || sc.x >= 0.998 || sc.y <= 0.002 || sc.y >= 0.998 || sc.z >= 1.0 || sc.z <= 0.0 ) return 1.0;",
    "\tvec4 T = uLiShT[ k ]; float z = sc.z - K.y * ( 1.0 + 3.0 * sn / max( ndl, 0.2 ) ); vec2 uv = T.xy + sc.xy * T.zw, lo = T.xy + uLiShA.x, hi = T.xy + T.zw - uLiShA.x;",
    "\tfloat a = 6.2831853 * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ); vec2 cs = vec2( cos( a ), sin( a ) ) * K.x; float s = 0.0;",
    "\tfor ( int i = 0; i < 8; i ++ ) { vec2 o = LI_PD[ i ]; o = vec2( o.x * cs.x - o.y * cs.y, o.x * cs.y + o.y * cs.x ); s += step( z, unpackRGBAToDepth( texture2D( tLiSh, clamp( uv + o, lo, hi ) ) ) ); }",
    "\treturn s * 0.125; }",
    // the furniture tile: r contact occlusion, g the top of what stands there, b its underside (metres / 2.55 over the floor)
    "vec4 liAo( const in vec2 xz ) { vec2 u = ( xz - uLiAoR.xy ) * uLiAoR.zw; if ( uLiAoT.z <= 0.0 || u.x < 0.0 || u.y < 0.0 || u.x > 1.0 || u.y > 1.0 ) return vec4( 1.0, 0.0, 0.0, 1.0 ); return texture2D( tLiSh, uLiAoT.xy + clamp( u, 0.002, 0.998 ) * uLiAoT.zw ); }",
    // the bounce: L1 irradiance per channel (three slabs of the volume), in the room's frame
    "vec3 liVol( const in vec3 nw ) {",
    "\tvec3 L = uLiRot * ( liWP() - uLiPos ); vec3 q = clamp( ( L - uLiVo.xyz ) * uLiVs.xyz, 0.0, 1.0 ); float e = 0.5 / uLiVs.w, zc = clamp( q.z, e, 1.0 - e );",
    "\tvec4 R = texture( tLiVol, vec3( q.xy, zc / 3.0 ) ), G = texture( tLiVol, vec3( q.xy, ( zc + 1.0 ) / 3.0 ) ), B = texture( tLiVol, vec3( q.xy, ( zc + 2.0 ) / 3.0 ) );",
    "\tvec3 n = uLiRot * nw; return max( vec3( R.x + dot( R.yzw, n ), G.x + dot( G.yzw, n ), B.x + dot( B.yzw, n ) ), vec3( 0.0 ) ); }"].join("\n");
  var LI_DIRECT = [
    "#if defined( RE_Direct )",
    "if ( uLiOn.x > 0.5 ) {",
    "\tvec3 liP = liWP(); vec3 liN = normalize( ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz );",
    "\tvec3 liL = uLiRot * ( liP - uLiPos ); bool liLow = uLiFl.z > 0.5 && liL.y - uLiFl.x < uLiFl.w;",
    "\tint liNF = int( uLiCnt.x + 0.5 ), liKF = int( uLiCnt.y + 0.5 ) - 1;",
    // the fixtures: candela x the kind's profile, inverse square to the cut-off, the key one shadowed by its map, the rest by the furniture
    "\tfor ( int k = 0; k < LI_NF; k ++ ) {",
    "\t\tif ( k >= liNF ) break;",
    "\t\tvec4 P = uLiFP[ k ]; vec3 lv = P.xyz - liP; float d2 = max( dot( lv, lv ), 1e-4 ), d = sqrt( d2 ); vec3 ld = lv / d;",
    "\t\tfloat ndl = dot( liN, ld ); if ( ndl <= 0.0 || d >= P.w ) continue;",
    "\t\tvec4 C = uLiFC[ k ]; float cd = ld.y, pr = 1.0;",
    "\t\tif ( C.w > 2.5 ) pr = 0.3 + 0.7 * abs( cd ); else if ( C.w > 1.5 ) pr = 0.22 + 0.78 * sqrt( abs( cd ) ); else if ( C.w > 0.5 ) pr = 0.06 + 0.94 * smoothstep( 0.1, 0.72, cd );",
    "\t\tfloat vis = 1.0;",
    "\t\tif ( k == liKF ) vis = liShadow( 1, liP, liN, ndl );",
    "\t\telse if ( liLow && uLiFR[ k ].w > 0.5 ) { vec3 F = uLiFR[ k ].xyz;",
    "\t\t\tfor ( int t = 0; t < 2; t ++ ) { float hh = t == 0 ? 0.47 : 0.77, yh = uLiFl.x + hh;",
    "\t\t\t\tif ( liL.y < yh - 0.02 && F.y > yh + 0.05 ) { vec4 A = liAo( mix( liL.xz, F.xz, ( yh - liL.y ) / ( F.y - liL.y ) ) ); if ( A.g * 2.55 >= hh - 0.05 && A.b * 2.55 <= hh ) vis *= 0.12; } } }",
    "\t\tif ( vis <= 0.0 ) continue;",
    "\t\tdirectLight.color = C.rgb * ( pow2( saturate( 1.0 - pow4( d / P.w ) ) ) / d2 * pr * vis ); directLight.direction = normalize( ( viewMatrix * vec4( ld, 0.0 ) ).xyz ); directLight.visible = true;",
    "\t\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );",
    "\t}",
    // the openings: sky above and the sunlit ground below, the polygon's form factor (diffuse; their reflections are the room capture's)
    "\tint liNW = int( uLiCnt.z + 0.5 ), liKW = int( uLiCnt.w + 0.5 ) - 1;",
    "\tfor ( int w = 0; w < LI_NW; w ++ ) {",
    "\t\tif ( w >= liNW ) break;",
    "\t\tvec4 WN = uLiWN[ w ]; vec3 c0 = uLiWC[ w * 4 ].xyz, c1 = uLiWC[ w * 4 + 1 ].xyz, c2 = uLiWC[ w * 4 + 2 ].xyz, c3 = uLiWC[ w * 4 + 3 ].xyz;",
    "\t\tif ( dot( liP - c0, WN.xyz ) < 0.01 ) continue;",
    "\t\tvec3 r0 = normalize( c0 - liP ), r1 = normalize( c1 - liP ), r2 = normalize( c2 - liP ), r3 = normalize( c3 - liP );",
    "\t\tvec3 F = acos( clamp( dot( r0, r1 ), -1.0, 1.0 ) ) * normalize( cross( r0, r1 ) ) + acos( clamp( dot( r1, r2 ), -1.0, 1.0 ) ) * normalize( cross( r1, r2 ) ) + acos( clamp( dot( r2, r3 ), -1.0, 1.0 ) ) * normalize( cross( r2, r3 ) ) + acos( clamp( dot( r3, r0 ), -1.0, 1.0 ) ) * normalize( cross( r3, r0 ) );",
    "\t\tF *= 0.5; if ( dot( F, WN.xyz ) > 0.0 ) F = - F;",
    "\t\tfloat ff = dot( F, liN ); if ( ff <= 0.0 ) continue;",
    "\t\tfloat up = normalize( ( c0 + c2 ) * 0.5 - liP ).y; vec3 Lr = mix( uLiGnd.rgb, uLiSky.rgb, smoothstep( -0.3, 0.3, up ) ) * WN.w;",
    "\t\tif ( w == liKW ) ff *= liShadow( 2, liP, liN, clamp( ff / max( length( F ), 1e-4 ), 0.0, 1.0 ) );",
    "\t\treflectedLight.directDiffuse += Lr * ff * BRDF_Lambert( material.diffuseColor );",
    "\t}",
    // the sun through the openings: its map holds the room (walls, roof, frames, curtains, furniture, characters) and caps over the
    // openings that a neighbour shades
    "\tif ( uLiSunD.w > 0.5 ) { float ndl = dot( liN, uLiSunD.xyz ); if ( ndl > 0.0 ) { float vis = liShadow( 0, liP, liN, ndl ); if ( vis > 0.0 ) {",
    "\t\tdirectLight.color = uLiSunC.rgb * vis; directLight.direction = normalize( ( viewMatrix * vec4( uLiSunD.xyz, 0.0 ) ).xyz ); directLight.visible = true;",
    "\t\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight ); } } }",
    "}",
    "#endif"].join("\n");
  var LI_VOL = "#if defined( RE_IndirectDiffuse )\n\tif ( uLiOn.z > 0.0 ) irradiance += liVol( normalize( ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz ) ) * uLiOn.z;\n#endif\n";
  var LI_END = [
    "#if defined( RE_IndirectDiffuse )",
    "if ( uLiOn.w > 0.0 ) {",
    "\tvec3 liLe = uLiRot * ( liWP() - uLiPos ); float liHe = liLe.y - uLiFl.x; vec4 liAe = liAo( liLe.xz ); float liNy = normalize( ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz ).y;",
    "\tfloat liAoK = mix( 1.0, liAe.r, uLiOn.w * ( 1.0 - smoothstep( 0.1, 0.95, liHe ) ) );",
    "\tif ( liNy > 0.5 && liHe < liAe.g * 2.55 - 0.05 && liHe >= liAe.b * 2.55 - 0.02 ) liAoK *= mix( 1.0, 0.5, uLiOn.w );",
    "\tirradiance *= liAoK; iblIrradiance *= liAoK;",
    "\t#if defined( RE_IndirectSpecular )",
    "\tradiance *= mix( 1.0, liAoK, 0.65 );",
    "\t#endif",
    "}",
    "#endif"].join("\n");
  // lights_fragment_begin with the room's sources (computed from the chunk as it stands at the program's compile: other modules
  // rewrite it, plan_perf and plan_light; the anchors are checked once at the tier pick, a miss leaves LI on its low path)
  var LIC = { src: null, out: null, miss: 0, csm: 0 };
  function liBegin(src) {
    if (LIC.src === src && LIC.out) return LIC.out; var s = src, miss = 0;
    var A1 = "{\n\tpointLight = pointLights[ i ];"; if (s.indexOf(A1) >= 0) s = s.replace(A1, A1 + " if ( uLiOn.x > 0.5 ) continue;"); else miss |= 1;
    var A2 = "{\n\tspotLight = spotLights[ i ];"; if (s.indexOf(A2) >= 0) s = s.replace(A2, A2 + " if ( uLiOn.x > 0.5 ) continue;"); else miss |= 2;
    var A3 = "irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );"; if (s.indexOf(A3) >= 0) s = s.split(A3).join("irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * ( 1.0 - uLiOn.y );"); else miss |= 4;
    var A4 = "if ( csmHit ) {"; if (s.indexOf(A4) >= 0) { s = s.replace(A4, "csmCol *= 1.0 - uLiOn.x * ( 1.0 - uLiMx.x ); " + A4); LIC.csm = 1; } else LIC.csm = 0;
    var A5 = "#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )"; if (s.indexOf(A5) >= 0) s = s.replace(A5, LI_DIRECT + "\n" + A5); else miss |= 16;
    var A6 = /#if defined\( RE_IndirectSpecular \)\s*vec3 radiance = vec3\( 0\.0 \);/; var m6 = s.match(A6); if (m6) s = s.replace(m6[0], LI_VOL + m6[0]); else miss |= 32;
    LIC.src = src; LIC.out = s; LIC.miss = miss; return s;
  }
  LI.check = function () { try { liBegin(THREE.ShaderChunk.lights_fragment_begin); } catch (e) { LIC.miss = 64; } return LIC.miss; };
  // the shader patch for one program (the surface pass and the dressing call it); false: left as it was
  function liCan(fs) { if (!LI.hi || !fs) return false; if (fs.indexOf("#include <common>") < 0 || fs.indexOf("#include <packing>") < 0 || fs.indexOf("#include <lights_fragment_begin>") < 0 || fs.indexOf("#include <lights_fragment_end>") < 0) return false; liBegin(THREE.ShaderChunk.lights_fragment_begin); return LIC.miss === 0; }
  LI.can = liCan;
  function liPatch(sh, envDone) {
    if (!sh || !liCan(sh.fragmentShader)) { LI.n.patchMiss = (LI.n.patchMiss || 0) + 1; return false; } var fs = sh.fragmentShader, lb = liBegin(THREE.ShaderChunk.lights_fragment_begin);
    fs = fs.replace("#include <common>", "#include <common>\n" + liDecl()).replace("#include <packing>", "#include <packing>\n" + LI_FN).replace("#include <lights_fragment_begin>", lb).replace("#include <lights_fragment_end>", LI_END + "\n#include <lights_fragment_end>");
    if (!envDone && fs.indexOf("#include <envmap_physical_pars_fragment>") >= 0) { var env = THREE.ShaderChunk.envmap_physical_pars_fragment, B0 = "return PI * envMapColor.rgb * envMapIntensity;"; if (env.indexOf(B0) >= 0) fs = fs.replace("#include <envmap_physical_pars_fragment>", env.replace(B0, "return PI * envMapColor.rgb * envMapIntensity * ( 1.0 - uLiOn.y );")); }
    sh.fragmentShader = fs; var U = liU(); for (var k in U) sh.uniforms[k] = U[k]; LI.n.progs = (LI.n.progs || 0) + 1; return true;
  }
  LI.patch = liPatch;

  // ── fixtures: kind, lumens, colour temperature, emission profile ──
  // [lumens, kelvin (0: its own colour), profile 0 all round, 1 a shade (down), 2 a sconce (up and down), 3 a lamp shade (open top
  // and bottom)]; the module's own strength for the fixture scales the lumens within a factor of about 1.6 either way
  var LK = { candle: [14, 1850, 0], oil: [90, 2000, 0], fire: [2600, 1900, 0], chand: [2600, 2700, 0], pend: [950, 2700, 1], ceil: [1500, 3000, 1], sconce: [480, 2700, 2], table: [820, 2700, 3], floor: [1500, 2700, 3], neon: [260, 0, 0], bulb: [700, 2700, 0] };
  var LKREF = { candle: 0.6, oil: 1.0, fire: 2.0, chand: 2.5, pend: 1.4, ceil: 1.6, sconce: 1.2, table: 1.2, floor: 1.4, neon: 1.2, bulb: 1.2 };
  var CRISP = { crisp: 3500, diner: 3500, gallery: 3000, bank: 3000, brand: 3500, hangar: 4000, bodyshop: 4000 };
  function profF(t, c) { var a = Math.abs(c); return t === 3 ? 0.3 + 0.7 * a : t === 2 ? 0.22 + 0.78 * Math.sqrt(a) : t === 1 ? 0.06 + 0.94 * sstep(0.1, 0.72, c) : 1; }
  var PROFM = [1, 1, 1, 1]; (function () { for (var t = 0; t < 4; t++) { var s = 0, N = 400; for (var i = 0; i < N; i++) s += profF(t, -1 + (i + 0.5) * 2 / N); PROFM[t] = s / N; } })();
  var KCOL = {};
  function kelvinRGB(K) { var key = Math.round(K / 50); if (KCOL[key]) return KCOL[key]; var t = K / 100, r, g, b; r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592); g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    var c = [r, g, b].map(function (v) { v = clamp(v, 0, 255) / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); var m = Math.max(c[0], c[1], c[2]) || 1; return (KCOL[key] = [c[0] / m, c[1] / m, c[2] / m]); }
  LI.kelvin = kelvinRGB;
  function liKind(S, f) {
    var c = f.c, mx = Math.max(c.r, c.g, c.b) || 1, mn = Math.min(c.r, c.g, c.b), sat = (mx - mn) / mx, warm = c.r >= c.g * 0.97 && c.g >= c.b * 0.97, y = f.ly - S.F, H = S.H - S.F;
    if (!warm && sat > 0.35) return "neon";
    if (f.fl === 2) return f.k >= 1.6 && y < 1.1 ? "fire" : "candle";
    if (f.fl === 1) return "oil";
    var wall = Math.min(f.lx - S.x0, S.x1 - f.lx, f.lz - S.z0, S.z1 - f.lz) < 0.5;
    if (y > 2.1) { if (wall) return "sconce"; if (y > H - 0.35) return "ceil"; return f.k >= 2.0 && !f.s ? "chand" : "pend"; }
    if (f.hang || f.s) return "pend";
    if (wall && y > 1.2) return "sconce";
    if (y < 1.35) return "table";
    return "floor";
  }
  // the room's fixtures as light sources (room frame and world), by kind; the client's central lamp and the window fills are not
  // fixtures (a lamp with nothing under it, a fill with no opening: they were the sourceless light)
  function liFixtures(R, S) {
    var out = [], b = R.box, type = R.type, kc = CRISP[type] || 0;
    for (var i = 0; i < R.fix.length; i++) { var f = R.fix[i]; if (f.win) continue; var kind = liKind(S, f), K = LK[kind]; if (!K) continue;
      var s = Math.pow(clamp(f.k / (LKREF[kind] || 1.2), 0.45, 2.4), 0.6), lm = K[0] * s, kel = K[1]; if (kc && (kind === "ceil" || kind === "pend")) kel = kc;
      var c = f.c, mx = Math.max(c.r, c.g, c.b) || 1, own = [c.r / mx, c.g / mx, c.b / mx], col;
      if (!kel) col = own; else { var kr = kelvinRGB(kel); col = [kr[0] * 0.65 + own[0] * 0.35, kr[1] * 0.65 + own[1] * 0.35, kr[2] * 0.65 + own[2] * 0.35]; var m2 = Math.max(col[0], col[1], col[2]) || 1; col = [col[0] / m2, col[1] / m2, col[2] / m2]; }
      var I = lm / (4 * Math.PI * PROFM[K[2]]);   // candela on the profile's axis
      out.push({ f: f, kind: kind, lm: lm, I: I, prof: K[2], col: col, lum: 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2], lx: f.lx, ly: f.ly, lz: f.lz, p: f.p.clone(), fl: f.fl, ph: f.ph, hf: f.ly - S.F > 0.9 ? 1 : 0 }); }
    // the eye's white balance under lamplight: the fixtures' mean colour is pulled most of the way back toward white (a 2700 K room
    // reads warm, not orange); flames, neon and screens keep their own colour relative to it
    var wr = 0, wg = 0, wb = 0; for (var q = 0; q < out.length; q++) { var o = out[q]; if (o.kind === "neon") continue; wr += o.col[0] * o.lm; wg += o.col[1] * o.lm; wb += o.col[2] * o.lm; }
    if (wg > 0) { var cr = Math.pow(wg / Math.max(wr, 1e-6), 0.5), cb = Math.pow(wg / Math.max(wb, 1e-6), 0.5); cr = clamp(cr, 0.6, 1.6); cb = clamp(cb, 0.6, 2.2); S.wb = [cr, 1, cb];
      for (var q2 = 0; q2 < out.length; q2++) { var c = out[q2].col, m = 0; c[0] *= cr; c[2] *= cb; m = Math.max(c[0], c[1], c[2]) || 1; c[0] /= m; c[1] /= m; c[2] /= m; out[q2].lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; } }
    liScreens(R, S, out); out.sort(function (a, c2) { return c2.lm - a.lm; }); return out;
  }
  // screens, lit signs and menu boards (an emissive map): a Lambertian panel of about 150 nits per unit of emission, as a weak
  // light just in front of it, in its own colour
  function liScreens(R, S, out) {
    var bb = new THREE.Box3(), n = 0;
    liEach(R, S, function (o) { if (n >= 6 || o.userData.rlDress) return;
      var m = Array.isArray(o.material) ? o.material[0] : o.material; if (!m || !m.emissiveMap || !m.emissive) return; var e = Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * (m.emissiveIntensity || 0); if (e < 0.3) return;
      var G = o.geometry; if (!G.boundingBox) G.computeBoundingBox(); bb.copy(G.boundingBox).applyMatrix4(LV.m.multiplyMatrices(R.Mi, o.matrixWorld)); var dx = bb.max.x - bb.min.x, dy = bb.max.y - bb.min.y, dz = bb.max.z - bb.min.z, A = Math.max(dx * dy, dz * dy, dx * dz);
      if (A < 0.12 || A > 12 || Math.max(dx, dz) > (S.x1 - S.x0) * 0.8) return; var cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, cz = (bb.min.z + bb.max.z) / 2, w = nearWall(S, cx, cz, 0.6);
      if (w >= 0) { var W = wallOf(S, w); if (W.ax === 0) cx += W.n[0] * 0.25; else cz += W.n[1] * 0.25; }
      var ta = texAvg(m.emissiveMap) || [0.5, 0.5, 0.5], col = [m.emissive.r * ta[0], m.emissive.g * ta[1], m.emissive.b * ta[2]], mx = Math.max(col[0], col[1], col[2]); if (!(mx > 0.02)) return; col = [col[0] / mx, col[1] / mx, col[2] / mx];
      var lm = clamp(470 * A * Math.min(e, 2.5) * mx, 30, 900), p = LV.a.set(cx, cy, cz).applyMatrix4(R.M).clone();
      out.push({ f: null, kind: "screen", lm: lm, I: lm / (4 * Math.PI), prof: 0, col: col, lum: 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2], lx: cx, ly: cy, lz: cz, p: p, fl: 0, ph: 0, hf: 0 }); n++; });
  }

  // ── the room's geometry for the light: floor, ceiling, wall planes (the dressing's room read when it has one), the openings ──
  // an opening: { w: wall 0..3 (x0, x1, z0, z1), s0, s1 (along the wall), y0, y1 (room frame), door, n: inward [nx, nz] }
  function wallOf(S, w) { return w === 0 ? { ax: 0, c: S.x0, n: [1, 0] } : w === 1 ? { ax: 0, c: S.x1, n: [-1, 0] } : w === 2 ? { ax: 2, c: S.z0, n: [0, 1] } : { ax: 2, c: S.z1, n: [0, -1] }; }
  function opCorners(S, o) { var W = wallOf(S, o.w), c = W.c + (W.ax === 0 ? W.n[0] : W.n[1]) * 0.005; if (W.ax === 0) return [[c, o.y0, o.s0], [c, o.y0, o.s1], [c, o.y1, o.s1], [c, o.y1, o.s0]]; return [[o.s0, o.y0, c], [o.s1, o.y0, c], [o.s1, o.y1, c], [o.s0, o.y1, c]]; }
  function addOp(S, o) { if (o.s1 - o.s0 < 0.25 || o.y1 - o.y0 < 0.3) return; for (var i = 0; i < S.ops.length; i++) { var q = S.ops[i]; if (q.w === o.w && o.s0 < q.s1 + 0.15 && o.s1 > q.s0 - 0.15 && o.y0 < q.y1 + 0.15 && o.y1 > q.y0 - 0.15) { q.s0 = Math.min(q.s0, o.s0); q.s1 = Math.max(q.s1, o.s1); q.y0 = Math.min(q.y0, o.y0); q.y1 = Math.max(q.y1, o.y1); q.door = q.door || o.door; q.src += "+" + o.src; return; } }
    o.n = wallOf(S, o.w).n; S.ops.push(o); }
  // which wall a point (room frame) lies on, within d metres
  function nearWall(S, x, z, d) { var b = [Math.abs(x - S.x0), Math.abs(x - S.x1), Math.abs(z - S.z0), Math.abs(z - S.z1)], k = 0; for (var i = 1; i < 4; i++) if (b[i] < b[k]) k = i; return b[k] < d ? k : -1; }
  // glass in the room's walls: the panes are the windows (one cluster per window along each wall)
  function glassOps(R, S) {
    var n0 = S.ops.length, cl = [[], [], [], []], a = LV.a, bb = new THREE.Box3();
    liEach(R, S, function (o) { if (o.isSkinnedMesh || o.userData.rlDress) return;
      var m = Array.isArray(o.material) ? o.material[0] : o.material; if (!m) return; var nm = m.name || ""; var glass = /glass|window|pane/i.test(nm) || (m.transparent && m.opacity < 0.75 && m.blending === THREE.NormalBlending && !m.map && (m.roughness === undefined || m.roughness < 0.3)); if (!glass || /shaft|glow|vista|sign|shade|case/i.test(nm)) return;
      var G = o.geometry, P = G.attributes.position, I = G.index; if (!P) return; var nt = I ? I.count / 3 : P.count / 3; if (nt > 40000) return; LV.m.multiplyMatrices(R.Mi, o.matrixWorld);
      var ms = [LV.m.clone()]; if (o.isInstancedMesh) { ms = []; for (var qi = 0; qi < o.count; qi++) { var im = new THREE.Matrix4(); o.getMatrixAt(qi, im); ms.push(new THREE.Matrix4().multiplyMatrices(LV.m, im)); } }
      for (var mi = 0; mi < ms.length; mi++) for (var t = 0; t < nt; t++) { bb.makeEmpty(); for (var v = 0; v < 3; v++) { var ix = I ? I.getX(t * 3 + v) : t * 3 + v; a.fromBufferAttribute(P, ix).applyMatrix4(ms[mi]); bb.expandByPoint(a); }
        var cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2, w = nearWall(S, cx, cz, 0.45); if (w < 0 || cx < S.x0 - 0.6 || cx > S.x1 + 0.6 || cz < S.z0 - 0.6 || cz > S.z1 + 0.6 || bb.max.y < S.F || bb.min.y > S.H) continue; var thin = w < 2 ? bb.max.x - bb.min.x : bb.max.z - bb.min.z; if (thin > 0.12) continue;
        var s0 = w < 2 ? bb.min.z : bb.min.x, s1 = w < 2 ? bb.max.z : bb.max.x, y0 = bb.min.y, y1 = bb.max.y; if (y1 - y0 < 0.05 || s1 - s0 < 0.03) continue; var L = cl[w], hit = null;
        for (var k = 0; k < L.length; k++) { var c = L[k]; if (s0 < c.s1 + 0.2 && s1 > c.s0 - 0.2 && y0 < c.y1 + 0.2 && y1 > c.y0 - 0.2) { hit = c; break; } }
        if (hit) { hit.s0 = Math.min(hit.s0, s0); hit.s1 = Math.max(hit.s1, s1); hit.y0 = Math.min(hit.y0, y0); hit.y1 = Math.max(hit.y1, y1); } else L.push({ s0: s0, s1: s1, y0: y0, y1: y1 }); } });
    for (var w2 = 0; w2 < 4; w2++) cl[w2].forEach(function (c) { if ((c.s1 - c.s0) * (c.y1 - c.y0) >= 0.25) addOp(S, { w: w2, s0: c.s0, s1: c.s1, y0: Math.max(S.F, c.y0), y1: Math.min(S.H - 0.02, c.y1), door: c.y0 < S.F + 0.2, src: "glass" }); });
    return S.ops.length - n0;
  }
  // the room's portals (plan_rooms format: ax "x" = the plane z = c, "z" = the plane x = c) and the client's front door gap
  function portalOps(R, S) { var W = R.wins || [], n0 = S.ops.length;
    for (var i = 0; i < W.length; i++) { var p = W[i], w; if (p[5] - p[4] < 0.3 || p[3] - p[2] < 0.25) continue; if (p[0] === "x") w = Math.abs(p[1] - S.z0) < Math.abs(p[1] - S.z1) ? 2 : 3; else w = Math.abs(p[1] - S.x0) < Math.abs(p[1] - S.x1) ? 0 : 1;
      addOp(S, { w: w, s0: p[2], s1: p[3], y0: Math.max(S.F, p[4]), y1: Math.min(S.H - 0.02, p[5]), door: p[4] < S.F + 0.2, src: "portal" }); }
    if (R.genericWins) { for (var s = 0; s < 2; s++) for (var k = -1; k <= 1; k++) addOp(S, { w: s, s0: k * (S.z1 - S.z0) * 0.25 - 0.7, s1: k * (S.z1 - S.z0) * 0.25 + 0.7, y0: 1.3, y1: 2.5, door: false, src: "generic" }); }
    if (R.door !== false && !R.noDoorShaft && !R.liNoDoor) addOp(S, { w: 3, s0: -1.05, s1: 1.05, y0: S.F, y1: Math.min(S.H - 0.05, S.F + 2.35), door: true, src: "door" });
    return S.ops.length - n0; }
  // the surfaces' colours (linear albedo) from the room's own materials: the floor, the walls, the ceiling and the furniture
  var TAVG = new Map();
  function srgb2lin(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function texAvg(t) { if (!t) return null; var hit = TAVG.get(t.uuid); if (hit !== undefined) return hit; var im = t.image || (t.source && t.source.data), out = null;
    try { var okImg = im && (im.width || 0) > 1 && !t.isDataTexture && !t.isCompressedTexture && (typeof HTMLImageElement === "undefined" || !(im instanceof HTMLImageElement) || im.complete);
      if (okImg) { var cv = LI.cv || (LI.cv = document.createElement("canvas")); cv.width = 4; cv.height = 4; var x = cv.getContext("2d", { willReadFrequently: true }); x.clearRect(0, 0, 4, 4); x.drawImage(im, 0, 0, 4, 4); var d = x.getImageData(0, 0, 4, 4).data, r = 0, g = 0, b = 0;
        var lin = t.colorSpace !== THREE.LinearSRGBColorSpace; for (var i = 0; i < 64; i += 4) { r += lin ? srgb2lin(d[i] / 255) : d[i] / 255; g += lin ? srgb2lin(d[i + 1] / 255) : d[i + 1] / 255; b += lin ? srgb2lin(d[i + 2] / 255) : d[i + 2] / 255; } out = [r / 16, g / 16, b / 16]; } } catch (e) { out = null; }
    TAVG.set(t.uuid, out); return out; }
  function liAlbedo(R, S) {
    var acc = { f: [0, 0, 0, 0], w: [0, 0, 0, 0], c: [0, 0, 0, 0], u: [0, 0, 0, 0] }, bb = new THREE.Box3(), nTex = 0;
    { liEach(R, S, function (o) { if (o.isSkinnedMesh || o.userData.rlDress) return;
        var m = Array.isArray(o.material) ? o.material[0] : o.material; if (!m || m.transparent || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return;
        var G = o.geometry; if (!G.boundingBox) G.computeBoundingBox(); bb.copy(G.boundingBox).applyMatrix4(LV.m.multiplyMatrices(R.Mi, o.matrixWorld)); var dx = bb.max.x - bb.min.x, dy = bb.max.y - bb.min.y, dz = bb.max.z - bb.min.z; if (!(dx < 80 && dz < 80)) return;
        var cls, A; if (dy < 0.3 && bb.min.y < S.F + 0.2 && dx * dz > 1.5) { cls = "f"; A = dx * dz; } else if (dy < 0.4 && bb.max.y > S.H - 0.5 && dx * dz > 1.5) { cls = "c"; A = dx * dz; } else if (dy > (S.H - S.F) * 0.5 && Math.max(dx, dz) > Math.min(S.x1 - S.x0, S.z1 - S.z0) * 0.5) { cls = "w"; A = Math.max(dx, dz) * dy; } else { cls = "u"; A = (dx * dz + dy * (dx + dz)) * 0.5; }
        var c = [m.color.r, m.color.g, m.color.b]; if (m.map) { var ta = nTex < 24 ? texAvg(m.map) : null; nTex++; if (ta) { c[0] *= ta[0]; c[1] *= ta[1]; c[2] *= ta[2]; } else { c[0] *= 0.45; c[1] *= 0.4; c[2] *= 0.35; } }
        if (m.vertexColors && G.attributes.color) { var C = G.attributes.color, n = C.count, st = Math.max(1, Math.floor(n / 48)), r = 0, g = 0, b = 0, k = 0; for (var i = 0; i < n; i += st) { r += C.getX(i); g += C.getY(i); b += C.getZ(i); k++; } if (k) { c[0] *= r / k; c[1] *= g / k; c[2] *= b / k; } }
        var X = acc[cls]; X[0] += c[0] * A; X[1] += c[1] * A; X[2] += c[2] * A; X[3] += A; }); }
    function fin(X, d) { if (!(X[3] > 0.5)) return d.slice(); return [clamp(X[0] / X[3], 0.03, 0.85), clamp(X[1] / X[3], 0.03, 0.85), clamp(X[2] / X[3], 0.03, 0.85)]; }
    S.alb = { f: fin(acc.f, [0.2, 0.13, 0.08]), w: fin(acc.w, [0.5, 0.45, 0.38]), c: fin(acc.c, [0.6, 0.57, 0.52]), u: fin(acc.u, [0.25, 0.18, 0.12]) }; return S.alb;
  }
  // the furniture (the room's solids, room frame), and its tile: r contact occlusion, g the top, b the underside
  function liSolids(R, S) {
    var out = []; try { var inv = R.Mi, v = LV.a, yaw0 = Math.atan2(R.M.elements[8], R.M.elements[0]), gy = R.M.elements[13];
      for (var i = 0; i < SOLIDS.length; i++) { var s = SOLIDS[i]; if (!R.liFilter && s.tag !== "room" && s.tag !== "dress" && !(typeof s.tag === "string" && s.tag.indexOf("room:") === 0)) continue; v.set(s.x, gy, s.z).applyMatrix4(inv); if (v.x < S.x0 - 0.2 || v.x > S.x1 + 0.2 || v.z < S.z0 - 0.2 || v.z > S.z1 + 0.2) continue;
        var w = s.hw * 2, d = s.hd * 2; if (w > (S.x1 - S.x0) * 0.8 && d > (S.z1 - S.z0) * 0.8) continue; if (Math.max(w, d) > 4.5 && Math.min(w, d) < 0.5) continue; var y0 = s.y0 - gy - S.F, y1 = s.y1 - gy - S.F; if (y1 < 0.08 || y0 > 2.4 || y1 - y0 > 3.2) continue;
        out.push({ x: v.x, z: v.z, w: w, d: d, ry: (s.ry || 0) - yaw0, y0: Math.max(0, y0), y1: Math.min(2.5, y1), seat: !!s.seat }); } } catch (e) { note("li solids", e); }
    S.sol = out; return out;
  }
  function liAoTile(S) {
    var N = 256, sx = (S.x1 - S.x0) / N, sz = (S.z1 - S.z0) / N, top = new Float32Array(N * N), bot = new Float32Array(N * N).fill(9), occ = new Float32Array(N * N);
    for (var i = 0; i < S.sol.length; i++) { var s = S.sol[i], c = Math.cos(s.ry), sn = Math.sin(s.ry), ex = (Math.abs(c) * s.w + Math.abs(sn) * s.d) / 2, ez = (Math.abs(sn) * s.w + Math.abs(c) * s.d) / 2;
      var i0 = Math.max(0, Math.floor((s.x - ex - S.x0) / sx)), i1 = Math.min(N - 1, Math.floor((s.x + ex - S.x0) / sx)), j0 = Math.max(0, Math.floor((s.z - ez - S.z0) / sz)), j1 = Math.min(N - 1, Math.floor((s.z + ez - S.z0) / sz));
      for (var j = j0; j <= j1; j++) for (var k = i0; k <= i1; k++) { var px = S.x0 + (k + 0.5) * sx - s.x, pz = S.z0 + (j + 0.5) * sz - s.z, lx = px * c - pz * sn, lz = px * sn + pz * c; if (Math.abs(lx) > s.w / 2 || Math.abs(lz) > s.d / 2) continue; var q = j * N + k; if (s.y1 > top[q]) top[q] = s.y1; if (s.y0 < bot[q]) bot[q] = s.y0; occ[q] = Math.max(occ[q], clamp(s.y1 / 0.7, 0.35, 1)); } }
    // the occlusion: what stands there and around it (two box blurs of about 0.3 m), stronger right under it
    var r = Math.max(1, Math.round(0.3 / Math.min(sx, sz))), A = new Float32Array(N * N), B = new Float32Array(N * N);
    function blur(src, dst, horiz) { for (var y = 0; y < N; y++) { var acc = 0, cnt = 0; for (var x = -r; x < N + r; x++) { var xa = x + r, xr = x - r - 1; if (xa < N && xa >= 0) { acc += horiz ? src[y * N + xa] : src[xa * N + y]; cnt++; } if (xr >= 0 && xr < N) { acc -= horiz ? src[y * N + xr] : src[xr * N + y]; cnt--; } if (x >= 0 && x < N) { if (horiz) dst[y * N + x] = acc / Math.max(1, cnt); else dst[x * N + y] = acc / Math.max(1, cnt); } } } }
    blur(occ, A, true); blur(A, B, false); blur(B, A, true); blur(A, B, false);
    var px8 = new Uint8Array(N * N * 4); for (var q2 = 0; q2 < N * N; q2++) { var o2 = Math.max(B[q2] * 0.62, occ[q2] * 0.4); px8[q2 * 4] = Math.round(255 * clamp(1 - o2, 0, 1)); px8[q2 * 4 + 1] = Math.round(clamp(top[q2] / 2.55, 0, 1) * 255); px8[q2 * 4 + 2] = Math.round(clamp((bot[q2] > 8 ? 0 : bot[q2]) / 2.55, 0, 1) * 255); px8[q2 * 4 + 3] = 255; }
    S.ao = { N: N, px: px8 }; return S.ao;
  }

  // ── the bounce: surface patches lit by the sources, gathered into an L1 irradiance volume ──
  // patch: x y z, nx ny nz, area, albedo rgb; direct light on it per source class: fixtures (lux, rgb), sky and ground through the
  // openings (lux per cd/m2 of sky or ground beyond), the sun (per unit of sun, recomputed as the sun moves)
  var PS = 18;   // floats a patch: 0-2 position, 3-5 normal, 6 area, 7-9 albedo, 10-12 fixtures (lux rgb), 13 sky, 14 ground, 15 sun,
  // 16 transmission (a canvas wall or roof passes daylight through), 17 spare
  function inOp(S, w, s, y) { for (var i = 0; i < S.ops.length; i++) { var o = S.ops[i]; if (o.w === w && s > o.s0 && s < o.s1 && y > o.y0 && y < o.y1) return o; } return null; }
  function liPatches(S) {
    var P = [], ex = S.x1 - S.x0, ez = S.z1 - S.z0, eh = S.H - S.F, sz = clamp(Math.sqrt(ex * ez) / 13, 0.85, 1.7);
    function grid(n0, n1, f) { for (var i = 0; i < n0; i++) for (var j = 0; j < n1; j++) f((i + 0.5) / n0, (j + 0.5) / n1); }
    var nx = Math.max(2, Math.round(ex / sz)), nz = Math.max(2, Math.round(ez / sz)), ny = Math.max(2, Math.round(eh / sz)), A = ex * ez / (nx * nz), af = S.alb.f, ac = S.alb.c, aw = S.alb.w, au = S.alb.u;
    grid(nx, nz, function (u, v) { P.push(S.x0 + u * ex, S.F + 0.01, S.z0 + v * ez, 0, 1, 0, A, af[0], af[1], af[2], 0, 0, 0, 0, 0, 0, 0, 0); });
    grid(nx, nz, function (u, v) { P.push(S.x0 + u * ex, S.H - 0.01, S.z0 + v * ez, 0, -1, 0, A, ac[0], ac[1], ac[2], 0, 0, 0, 0, 0, 0, S.trans || 0, 0); });
    for (var w = 0; w < 4; w++) { var W = wallOf(S, w), len = W.ax === 0 ? ez : ex, ns = Math.max(2, Math.round(len / sz)), Aw = len * eh / (ns * ny), lo = W.ax === 0 ? S.z0 : S.x0;
      for (var i = 0; i < ns; i++) for (var j = 0; j < ny; j++) { var s = lo + (i + 0.5) / ns * len, y = S.F + (j + 0.5) / ny * eh; if (inOp(S, w, s, y)) continue; var cc = W.c + (W.ax === 0 ? W.n[0] : W.n[1]) * 0.01;
        if (W.ax === 0) P.push(cc, y, s, W.n[0], 0, 0, Aw, aw[0], aw[1], aw[2], 0, 0, 0, 0, 0, 0, S.trans || 0, 0); else P.push(s, y, cc, 0, 0, W.n[1], Aw, aw[0], aw[1], aw[2], 0, 0, 0, 0, 0, 0, S.trans || 0, 0); } }
    for (var k = 0; k < S.sol.length; k++) { var o = S.sol[k], at = o.w * o.d; if (at < 0.15 || o.y1 < 0.3 || o.y1 > 1.6) continue; P.push(o.x, S.F + o.y1 + 0.01, o.z, 0, 1, 0, at, au[0], au[1], au[2], 0, 0, 0, 0, 0, 0, 0, 0); }
    S.P = new Float32Array(P); S.np = P.length / PS; LI.n.patches = S.np; return S.np;
  }
  // the form factor vector of an opening seen from p (Lambert's polygon formula; E = L (F . n)), into out
  var _r = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], _cr = new THREE.Vector3();
  function ffVec(C, px, py, pz, out) { out.set(0, 0, 0); for (var i = 0; i < 4; i++) _r[i].set(C[i][0] - px, C[i][1] - py, C[i][2] - pz).normalize();
    for (var j = 0; j < 4; j++) { var a = _r[j], b = _r[(j + 1) & 3]; _cr.crossVectors(a, b); var l = _cr.length(); if (l < 1e-6) continue; out.addScaledVector(_cr, Math.acos(clamp(a.dot(b), -1, 1)) / l); }
    return out.multiplyScalar(0.5); }
  // direct light on every patch from the fixtures and the openings (the sun is its own pass)
  function liDirectPatches(S) {
    var P = S.P, F = S.fx, ff = LV.d;
    for (var j = 0; j < S.np; j++) { var o = j * PS, px = P[o], py = P[o + 1], pz = P[o + 2], nx = P[o + 3], ny = P[o + 4], nz = P[o + 5], er = 0, eg = 0, eb = 0;
      for (var k = 0; k < F.length; k++) { var f = F[k], dx = f.lx - px, dy = f.ly - py, dz = f.lz - pz, d2 = Math.max(dx * dx + dy * dy + dz * dz, 0.04), d = Math.sqrt(d2), cn = (dx * nx + dy * ny + dz * nz) / d; if (cn <= 0) continue; var e = f.I * profF(f.prof, -dy / d) * cn / d2; er += e * f.col[0]; eg += e * f.col[1]; eb += e * f.col[2]; }
      var es = 0, eg2 = 0;
      for (var w = 0; w < S.ops.length; w++) { var op = S.ops[w], C = op.C; if ((px - C[0][0]) * op.n[0] + (pz - C[0][2]) * op.n[1] < 0.02) continue; ffVec(C, px, py, pz, ff); if (ff.x * op.n[0] + ff.z * op.n[1] > 0) ff.negate(); var e2 = ff.x * nx + ff.y * ny + ff.z * nz; if (e2 <= 0) continue;
        var up = ((C[0][1] + C[2][1]) / 2 - py) / Math.max(0.05, Math.hypot((C[0][0] + C[2][0]) / 2 - px, (C[0][1] + C[2][1]) / 2 - py, (C[0][2] + C[2][2]) / 2 - pz)), ws = sstep(-0.3, 0.3, up); es += e2 * ws; eg2 += e2 * (1 - ws); }
      P[o + 10] = er; P[o + 11] = eg; P[o + 12] = eb; P[o + 13] = es; P[o + 14] = eg2; }
  }
  // the sun on the patches (per unit of perpendicular sun): the ray to the sun leaves the room through an opening the sun reaches
  function liSunPatches(S, sd) {
    var P = S.P, n = 0; if (!sd) { for (var j0 = 0; j0 < S.np; j0++) P[j0 * PS + 15] = 0; return 0; }
    for (var j = 0; j < S.np; j++) { var o = j * PS, cn = P[o + 3] * sd.x + P[o + 4] * sd.y + P[o + 5] * sd.z; P[o + 15] = 0; if (cn <= 0) continue; var px = P[o], py = P[o + 1], pz = P[o + 2];
      // the exit through the box's walls and ceiling
      var tb = 1e9, wall = -1; if (sd.x < -1e-4) { var t0 = (S.x0 - px) / sd.x; if (t0 < tb) { tb = t0; wall = 0; } } if (sd.x > 1e-4) { var t1 = (S.x1 - px) / sd.x; if (t1 < tb) { tb = t1; wall = 1; } }
      if (sd.z < -1e-4) { var t2 = (S.z0 - pz) / sd.z; if (t2 < tb) { tb = t2; wall = 2; } } if (sd.z > 1e-4) { var t3 = (S.z1 - pz) / sd.z; if (t3 < tb) { tb = t3; wall = 3; } } if (sd.y > 1e-4) { var t4 = (S.H - py) / sd.y; if (t4 < tb) { tb = t4; wall = -1; } }
      if (wall < 0) continue; var qy = py + sd.y * tb, qs = wall < 2 ? pz + sd.z * tb : px + sd.x * tb, op = inOp(S, wall, qs, qy); if (!op || !(op.sun > 0.5)) continue; P[o + 15] = cn * op.sun; n++; }
    return n;
  }
  // the volume: cells of about 0.8 m over the room, 4 coefficients per channel per source class (fixtures, sky, ground, sun)
  function liCells(S) { var ex = S.x1 - S.x0, ez = S.z1 - S.z0, eh = S.H - S.F, c = clamp(Math.cbrt(ex * ez * eh / 3200), 0.62, 1.4);
    S.nx = clamp(Math.round(ex / c), 2, 30); S.nz = clamp(Math.round(ez / c), 2, 30); S.ny = clamp(Math.round(eh / c), 2, 12); S.nc = S.nx * S.ny * S.nz; S.cx = ex / S.nx; S.cy = eh / S.ny; S.cz = ez / S.nz;
    S.V = new Float32Array(S.nc * 36); S.VS = new Float32Array(S.nc * 12); LI.n.cells = S.nc; }
  // gather the patches' radiance into cells [c0, c1) (sun: the sun class only). On the first slice the patches' own radiance is made:
  // the direct light they reflect plus, for a canvas, the daylight it passes (Lambertian transmission of the sky, the ground and the
  // sun on its outer side), then two passes of patch-to-patch transfer carry it on (the second and third bounces: light that reaches
  // the back of a room off the sunlit floor and the walls the windows light). Self-contained (it also runs in the worker).
  function liGather(S, c0, c1, sun) {
    var P = S.P, np = S.np, PZ = 18, V = sun ? S.VS : S.V, nx = S.nx, ny = S.ny, stride = sun ? 12 : 36, NC = sun ? 3 : 9, OF = sun ? 9 : 0, key = sun ? "srcS" : "srcA", PI = Math.PI;
    if (c0 === 0 || !S[key]) {
      var src = new Float32Array(np * NC), tr = S.tr || [0, 0, 0], sd = S.sd || [0, -1, 0], j, o, s;
      for (j = 0; j < np; j++) { o = j * PZ; s = j * NC; var ar = P[o + 7] / PI, ag = P[o + 8] / PI, ab = P[o + 9] / PI, T = P[o + 16];
        if (!sun) { src[s] = ar * P[o + 10]; src[s + 1] = ag * P[o + 11]; src[s + 2] = ab * P[o + 12]; src[s + 3] = ar * P[o + 13]; src[s + 4] = ag * P[o + 13]; src[s + 5] = ab * P[o + 13]; src[s + 6] = ar * P[o + 14]; src[s + 7] = ag * P[o + 14]; src[s + 8] = ab * P[o + 14];
          if (T > 0) { var up = (1 - P[o + 4]) / 2, dn = 1 - up; for (var c = 0; c < 3; c++) { src[s + 3 + c] += T * tr[c] * up; src[s + 6 + c] += T * tr[c] * dn; } } }
        else { src[s] = ar * P[o + 15]; src[s + 1] = ag * P[o + 15]; src[s + 2] = ab * P[o + 15];
          if (T > 0) { var cs = -(P[o + 3] * sd[0] + P[o + 4] * sd[1] + P[o + 5] * sd[2]); if (cs > 0) for (var c1s = 0; c1s < 3; c1s++) src[s + c1s] += T * tr[c1s] * cs / PI; } } }
      var tot = new Float32Array(src), cur = src, Ei = new Float32Array(np * NC);
      for (var it = 0; it < 2; it++) { var nxt = new Float32Array(np * NC);
        for (var i = 0; i < np; i++) { var oi = i * PZ, xi = P[oi], yi = P[oi + 1], zi = P[oi + 2], nix = P[oi + 3], niy = P[oi + 4], niz = P[oi + 5], si = i * NC, e = [0, 0, 0, 0, 0, 0, 0, 0, 0];
          for (var j2 = 0; j2 < np; j2++) { if (j2 === i) continue; var oj = j2 * PZ, dx = P[oj] - xi, dy = P[oj + 1] - yi, dz = P[oj + 2] - zi, ci = dx * nix + dy * niy + dz * niz; if (ci <= 0) continue; var cj = -(dx * P[oj + 3] + dy * P[oj + 4] + dz * P[oj + 5]); if (cj <= 0) continue;
            var d2 = dx * dx + dy * dy + dz * dz, f = P[oj + 6] * ci * cj / (d2 * Math.max(d2, P[oj + 6] * 0.6)), sj = j2 * NC; if (f > 1.5) f = 1.5; for (var q = 0; q < NC; q++) e[q] += cur[sj + q] * f; }
          for (var q2 = 0; q2 < NC; q2++) { Ei[si + q2] += e[q2]; nxt[si + q2] = P[oi + 7 + (q2 % 3)] / PI * e[q2]; tot[si + q2] += nxt[si + q2]; } }
        cur = nxt; }
      S[key] = tot; S[sun ? "EiS" : "EiA"] = Ei;
    }
    var B = S[key];
    for (var ci2 = c0; ci2 < c1; ci2++) { var ix = ci2 % nx, iy = Math.floor(ci2 / nx) % ny, iz = Math.floor(ci2 / (nx * ny)); var x = S.x0 + (ix + 0.5) * S.cx, y = S.F + (iy + 0.5) * S.cy, z = S.z0 + (iz + 0.5) * S.cz, b = ci2 * stride;
      for (var k = 0; k < stride; k++) V[b + k] = 0;
      for (var j3 = 0; j3 < np; j3++) { var o2 = j3 * PZ, s2 = j3 * NC;
        var ddx = P[o2] - x, ddy = P[o2 + 1] - y, ddz = P[o2 + 2] - z, dd2 = ddx * ddx + ddy * ddy + ddz * ddz; if (dd2 < 1e-6) continue; var d = Math.sqrt(dd2), wx = ddx / d, wy = ddy / d, wz = ddz / d, cp = -(wx * P[o2 + 3] + wy * P[o2 + 4] + wz * P[o2 + 5]); if (cp <= 0) continue;
        var dw = Math.min(1.6, P[o2 + 6] * cp / Math.max(dd2, P[o2 + 6] * 0.6)), a0 = 0.25 * dw, a1 = 0.5 * dw;
        for (var c3 = 0; c3 < NC; c3++) { var L3 = B[s2 + c3]; if (L3 === 0) continue; var q3 = b + c3 * 4; V[q3] += L3 * a0; V[q3 + 1] += L3 * a1 * wx; V[q3 + 2] += L3 * a1 * wy; V[q3 + 3] += L3 * a1 * wz; } } }
  }
  // half floats for the volume texture
  var _hf = new Float32Array(1), _hu = new Uint32Array(_hf.buffer);
  function toHalf(v) { _hf[0] = v; var x = _hu[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff; if (e <= 0) return s; if (e > 30) return s | 0x7bff; return s | (e << 10) | (m >>> 13); }
  // the current mix (game units): fixtures x G, sky and ground radiance x G, the sun at its display level; into the texture and
  // the CPU copy the hemisphere probe reads
  function liCombine(S, k) {
      // (the second and third bounces are gathered; what is left after them, about (0.6 x albedo) cubed, as a small series factor)
    if (!(S.mb > 0)) { var sa = 0, sr = 0; for (var j = 0; j < S.np; j++) { var o9 = j * PS, A9 = S.P[o9 + 6]; sa += A9; sr += A9 * (0.2126 * S.P[o9 + 7] + 0.7152 * S.P[o9 + 8] + 0.0722 * S.P[o9 + 9]); } var rho = sa > 0 ? sr / sa : 0.3, r3 = Math.pow(0.6 * rho, 3); S.rho = rho; S.mb = clamp(1 + r3 / (1 - 0.6 * rho), 1, 1.3); }
    var mb = S.mb, n = S.nc, V = S.V, VS = S.VS, out = S.mix || (S.mix = new Float32Array(n * 12)), sk = k.sky, gd = k.gnd, G = k.G * mb, su = [k.sun[0] * mb, k.sun[1] * mb, k.sun[2] * mb];
    for (var i = 0; i < n; i++) { var b = i * 36, bs = i * 12, o = i * 12;
      for (var c = 0; c < 3; c++) { var sc = sk[c] * G, gc = gd[c] * G, sn = su[c]; for (var q = 0; q < 4; q++) out[o + c * 4 + q] = V[b + c * 4 + q] * G + V[b + 12 + c * 4 + q] * sc + V[b + 24 + c * 4 + q] * gc + VS[bs + c * 4 + q] * sn; } }
    var tex = S.tex; if (!tex) { var data = new Uint16Array(S.nx * S.ny * S.nz * 3 * 4); tex = S.tex = new THREE.Data3DTexture(data, S.nx, S.ny, S.nz * 3); tex.format = THREE.RGBAFormat; tex.type = THREE.HalfFloatType; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping; tex.unpackAlignment = 1; tex.generateMipmaps = false; tex.name = "rl li volume"; tex.userData.noWarm = true; }
    // texel (ix, iy, slab * nz + iz): the volume's y is the texture's y (rows), slabs of z for the three channels
    var D = tex.image.data, nx = S.nx, ny = S.ny, nz = S.nz;
    for (var iz = 0; iz < nz; iz++) for (var iy = 0; iy < ny; iy++) for (var ix = 0; ix < nx; ix++) { var ci = ix + nx * (iy + ny * iz), oo = ci * 12;
      for (var ch = 0; ch < 3; ch++) { var t = ((ch * nz + iz) * ny + iy) * nx + ix, d = t * 4; D[d] = toHalf(out[oo + ch * 4]); D[d + 1] = toHalf(out[oo + ch * 4 + 1]); D[d + 2] = toHalf(out[oo + ch * 4 + 2]); D[d + 3] = toHalf(out[oo + ch * 4 + 3]); } }
    // the eye's white balance in the room: its mean bounce colour, pulled a third of the way back to white (the grade applies it)
    var sr = 0, sg = 0, sb = 0; for (var i2 = 0; i2 < n; i2++) { sr += out[i2 * 12]; sg += out[i2 * 12 + 4]; sb += out[i2 * 12 + 8]; }
    if (sg > 1e-6) { var wr = clamp(Math.pow(sg / Math.max(sr, 1e-6), 0.2), 0.85, 1.1), wb = clamp(Math.pow(sg / Math.max(sb, 1e-6), 0.2), 0.9, 1.2); LI.wbAdj = [wr, 1, wb]; }
    tex.needsUpdate = true; LI.n.upl++; return out;
  }
  // the L1 irradiance at a point (room frame), trilinear over the CPU copy: [c0 rgb, c1 (rgb x xyz)]
  var PRB = { c0: [0, 0, 0], c1: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] };
  function liProbe(S, x, y, z) { var M = S.mix; if (!M) return null; var fx = clamp((x - S.x0) / S.cx - 0.5, 0, S.nx - 1), fy = clamp((y - S.F) / S.cy - 0.5, 0, S.ny - 1), fz = clamp((z - S.z0) / S.cz - 0.5, 0, S.nz - 1);
    var x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz), x1 = Math.min(S.nx - 1, x0 + 1), y1 = Math.min(S.ny - 1, y0 + 1), z1 = Math.min(S.nz - 1, z0 + 1), tx = fx - x0, ty = fy - y0, tz = fz - z0;
    for (var c = 0; c < 3; c++) { PRB.c0[c] = 0; PRB.c1[c][0] = PRB.c1[c][1] = PRB.c1[c][2] = 0; }
    for (var k = 0; k < 8; k++) { var ix = k & 1 ? x1 : x0, iy = k & 2 ? y1 : y0, iz = k & 4 ? z1 : z0, w = (k & 1 ? tx : 1 - tx) * (k & 2 ? ty : 1 - ty) * (k & 4 ? tz : 1 - tz); if (w <= 0) continue; var o = (ix + S.nx * (iy + S.ny * iz)) * 12;
      for (var c2 = 0; c2 < 3; c2++) { PRB.c0[c2] += M[o + c2 * 4] * w; PRB.c1[c2][0] += M[o + c2 * 4 + 1] * w; PRB.c1[c2][1] += M[o + c2 * 4 + 2] * w; PRB.c1[c2][2] += M[o + c2 * 4 + 3] * w; } }
    return PRB; }

  // ── the sun's reach: whether a neighbour (a building's collider, a tall solid) stands between an opening and the sun ──
  function liSunVis(S, op, sdW) {
    var C = op.C, hits = 0, n = 0, p = LV.b, hs = Math.hypot(sdW.x, sdW.z); if (sdW.y <= 0.02) return 0; if (hs < 1e-3) return 1; var ux = sdW.x / hs, uz = sdW.z / hs, rise = sdW.y / hs;
    var CL = []; try { CL = typeof COLLIDERS !== "undefined" ? COLLIDERS : []; } catch (e) {} var SL = []; try { SL = typeof SOLIDS !== "undefined" ? SOLIDS : []; } catch (e) {}
    for (var k = 0; k < 5; k++) { var u = k === 0 ? 0.5 : k & 1 ? 0.2 : 0.8, v = k === 0 ? 0.5 : k & 2 ? 0.25 : 0.8; p.set(C[0][0] + (C[1][0] - C[0][0]) * u, C[0][1] + (C[3][1] - C[0][1]) * v, C[0][2] + (C[1][2] - C[0][2]) * u).applyMatrix4(S.M); p.x -= op.nw.x * 0.3; p.z -= op.nw.z * 0.3; n++; var blocked = false;
      for (var i = 0; i < CL.length && !blocked; i++) { var c = CL[i], r = c[2] || 0; if (r < 1.8) continue; var dx = c[0] - p.x, dz = c[1] - p.z, t = dx * ux + dz * uz; if (t < -r || t > 40 + r) continue; var qx = dx - ux * t, qz = dz - uz * t; if (qx * qx + qz * qz > r * r) continue; var gy = 0; try { gy = typeof planGroundAt === "function" ? planGroundAt(c[0], c[1]) : getH(c[0], c[1]); } catch (e) {} if (p.y + rise * Math.max(0, t - r) < gy + 7.5) blocked = true; }
      for (var j = 0; j < SL.length && !blocked; j++) { var s = SL[j]; if (s.tag === "room" || s.tag === "dress" || s.y1 - s.y0 < 1.6 || Math.max(s.hw, s.hd) < 0.8) continue; var ddx = s.x - p.x, ddz = s.z - p.z; if (ddx * ddx + ddz * ddz > 900) continue;
        var cr = Math.cos(s.ry || 0), sr = Math.sin(s.ry || 0), lx = (p.x - s.x) * cr - (p.z - s.z) * sr, lz = (p.x - s.x) * sr + (p.z - s.z) * cr, dlx = ux * cr - uz * sr, dlz = ux * sr + uz * cr, t0 = 0, t1 = 40;
        if (Math.abs(dlx) < 1e-6) { if (Math.abs(lx) > s.hw) continue; } else { var a1 = (-s.hw - lx) / dlx, a2 = (s.hw - lx) / dlx; t0 = Math.max(t0, Math.min(a1, a2)); t1 = Math.min(t1, Math.max(a1, a2)); }
        if (Math.abs(dlz) < 1e-6) { if (Math.abs(lz) > s.hd) continue; } else { var b1 = (-s.hd - lz) / dlz, b2 = (s.hd - lz) / dlz; t0 = Math.max(t0, Math.min(b1, b2)); t1 = Math.min(t1, Math.max(b1, b2)); }
        if (t1 <= t0) continue; var ya = p.y + rise * t0, yb = p.y + rise * t1; if (ya < s.y1 && yb > s.y0) blocked = true; }
      if (blocked) hits++; }
    return 1 - hits / n;
  }
  // ── shadow maps: the sun (orthographic over the room), the key fixture (a wide frustum down), the key opening (from outside
  //    it, looking in); drawn by three's shadow pass (the cascades' depth programs) into their maps, one a frame, then copied into
  //    one atlas the room materials read (tiles 0, 1, 2; the furniture tile in the fourth corner) ──
  var SH = LI.sh = { atlas: null, A: 2048, size: 1024, L: [null, null, null], want: [0, 0, 0], fr: [-99, -99, -99], ok: [0, 0, 0], key: [null, null, null], cast: [], actors: [], actAt: 0, list: [], caps: null, aoUp: null, moved: 0, lastAct: 0, tiles: [[0, 0], [1024, 0], [0, 1024]], aoTile: [1024, 1024], rr: 0 };
  function shAtlas() {
    if (SH.atlas) return SH.atlas; var rt = new THREE.WebGLRenderTarget(SH.A, SH.A, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
    rt.texture.name = "rl li atlas"; rt.texture.userData.noWarm = true; rt.texture.userData.avShared = true; SH.atlas = rt; var U = liU(); U.tLiSh.value = rt.texture; U.uLiShA.value.x = 0.5 / SH.A;
    for (var i = 0; i < 3; i++) { var t = SH.tiles[i]; U.uLiShT.value[i].set(t[0] / SH.A, t[1] / SH.A, SH.size / SH.A, SH.size / SH.A); } U.uLiAoT.value.set(SH.aoTile[0] / SH.A, SH.aoTile[1] / SH.A, 256 / SH.A, 256 / SH.A);
    SH.clear = true; return rt; }
  function shClear() { if (!SH.clear || !SH.atlas) return; SH.clear = false; var r = renderer, prt = r.getRenderTarget(), cc = LV.col; r.getClearColor(cc); var ca = r.getClearAlpha(); try { r.setRenderTarget(SH.atlas); r.setClearColor(0xffffff, 1); r.clear(true, false, false); } finally { r.setRenderTarget(prt); r.setClearColor(cc, ca); } }
  function shLight(i) { var l = SH.L[i]; if (l) return l; l = i === 0 ? new THREE.DirectionalLight(0xffffff, 0) : new THREE.SpotLight(0xffffff, 0, 30, 1.2, 0.5, 2); l.name = "rl li shadow " + i; l.castShadow = true; l.shadow.mapSize.set(SH.size, SH.size); l.shadow.autoUpdate = false; l.shadow.bias = 0; l.shadow.normalBias = 0; l.__p3csm = true; l.userData.pooled = true; l.shadow.camera.near = 0.05; SH.L[i] = l; return l; }
  function shBlit(i) { var l = SH.L[i], src = l && l.shadow.map; if (!src || !SH.atlas) return false; var P = renderer.properties, sf = P.get(src).__webglFramebuffer, df = P.get(SH.atlas).__webglFramebuffer; if (!sf || !df) return false;
    var gl = renderer.getContext(), st = renderer.state, prt = renderer.getRenderTarget(), cf = renderer.getActiveCubeFace(), ml = renderer.getActiveMipmapLevel(), T = SH.tiles[i];
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, sf); st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, df); st.buffers.color.setMask(true); st.setScissorTest(false); gl.blitFramebuffer(0, 0, SH.size, SH.size, T[0], T[1], T[0] + SH.size, T[1] + SH.size, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, null); renderer.setRenderTarget(prt, cf, ml); return true; }
  // the furniture tile into the atlas (texSubImage2D on the atlas's own storage)
  function shAoUpload(S) { if (!SH.atlas || !S.ao) return false; var P = renderer.properties.get(SH.atlas.texture), tx = P && P.__webglTexture; if (!tx) return false; var gl = renderer.getContext(), st = renderer.state;
    st.activeTexture(gl.TEXTURE0); st.bindTexture(gl.TEXTURE_2D, tx); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, SH.aoTile[0], SH.aoTile[1], S.ao.N, S.ao.N, gl.RGBA, gl.UNSIGNED_BYTE, S.ao.px); st.bindTexture(gl.TEXTURE_2D, null); SH.aoFor = S; return true; }
  // the room's casters: opaque lit meshes (no glass, no glow, no painted vistas); characters standing in the room
  function shCasters(R, S) { var out = []; liEach(R, S, function (o) { var m = Array.isArray(o.material) ? o.material[0] : o.material; if (!m || m.transparent || m.alphaTest > 0 || m.alphaMap || m.displacementMap || m.blending !== THREE.NormalBlending || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return;   // (alpha-tested and displaced ones would need depth programs of their own)
      if (o.userData.rlWater || (m.emissive && !m.emissiveMap && Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * m.emissiveIntensity > 0.6)) return; if (/glass|vista|glow|shaft|neon|bulb/i.test(m.name || "")) return; out.push(o); }); return out; }
  var ACT = new WeakMap();
  function isActor(o) { var v = ACT.get(o); if (v !== undefined) return v; v = false; try { o.traverse(function (q) { if (q.isSkinnedMesh) v = true; }); } catch (e) {} ACT.set(o, v); return v; }
  function shActors(R, S, now) { if (now - SH.actAt < 500) return SH.actors; SH.actAt = now; var out = [], ch = scene.children, p = LV.c;
    for (var i = 0; i < ch.length; i++) { var o = ch[i]; if (o === R.g || (R.liRoots && R.liRoots.indexOf(o) >= 0) || o.isLight || !o.visible || o.isInstancedMesh) continue; p.copy(o.position).applyMatrix4(R.Mi); if (p.x < S.x0 - 0.3 || p.x > S.x1 + 0.3 || p.z < S.z0 - 0.3 || p.z > S.z1 + 0.3 || p.y < S.F - 1.5 || p.y > S.H + 1) continue; if (!isActor(o)) continue; out.push(o); }
    SH.actors = out; return out; }
  // caps over the openings the sun cannot reach (a neighbour shades them): thin boxes, in the sun's map only
  var CAPM = null;
  function shCaps(S) { if (SH.caps) { SH.caps.children.forEach(function (c) { c.geometry.dispose(); }); } var g = SH.caps || (SH.caps = new THREE.Group()); g.clear(); if (!CAPM) { CAPM = new THREE.MeshStandardMaterial({ color: 0x000000 }); CAPM.name = "rl li cap"; CAPM.userData.avShared = true; }
    for (var i = 0; i < S.ops.length; i++) { var o = S.ops[i]; if (o.sun > 0.5) continue; var W = wallOf(S, o.w), wd = o.s1 - o.s0 + 0.1, h = o.y1 - o.y0 + 0.1, geo = W.ax === 0 ? new THREE.BoxGeometry(0.03, h, wd) : new THREE.BoxGeometry(wd, h, 0.03); var m = new THREE.Mesh(geo, CAPM); m.castShadow = true; m.receiveShadow = false;
      var cpos = LV.a.set(W.ax === 0 ? W.c - W.n[0] * 0.08 : (o.s0 + o.s1) / 2, (o.y0 + o.y1) / 2, W.ax === 0 ? (o.s0 + o.s1) / 2 : W.c - W.n[1] * 0.08).applyMatrix4(S.M); m.position.copy(cpos); m.quaternion.setFromRotationMatrix(LV.m.extractRotation(S.M)); g.add(m); }
    g.updateMatrixWorld(true); return g; }
  // set up the three lights' cameras for the room (on entry, when the sun moves, when the key fixture or opening changes)
  function shSetSun(S, sdW) { var l = shLight(0), c = LV.a.set((S.x0 + S.x1) / 2, (S.F + S.H) / 2, (S.z0 + S.z1) / 2).applyMatrix4(S.M), rr = 0.5, f = LV.b.copy(sdW).negate(), q = LV.c, zmin = 1e9, zmax = -1e9;
    for (var k = 0; k < 8; k++) { q.set(k & 1 ? S.x1 + 0.4 : S.x0 - 0.4, k & 2 ? S.H + 0.6 : S.F - 0.2, k & 4 ? S.z1 + 0.4 : S.z0 - 0.4).applyMatrix4(S.M).sub(c); var z = q.dot(f); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); q.addScaledVector(f, -z); rr = Math.max(rr, q.length()); }
    var cam = l.shadow.camera; cam.left = -rr; cam.right = rr; cam.top = rr; cam.bottom = -rr; cam.near = 0.5; cam.far = zmax - zmin + 3; cam.updateProjectionMatrix();
    l.position.copy(c).addScaledVector(f, zmin - 2); l.target.position.copy(c); l.updateMatrixWorld(true); l.target.updateMatrixWorld(true);
    var K = liU().uLiShK.value[0]; K.x = 1.6 / SH.A; K.y = 0.02 / cam.far; K.w = 1.2 * 2 * rr / SH.size; liU().uLiShP.value[0].set(sdW.x, sdW.y, sdW.z, 0); SH.want[0] = 1; SH.ok[0] = 0; SH.sunR = rr; }
  function shSetFix(S, fx) { var l = shLight(1); l.position.copy(fx.p); l.target.position.copy(fx.p).y -= 3; l.angle = 1.22; l.penumbra = 0; l.distance = Math.max(6, (S.H - S.F) * 3.2); l.shadow.camera.near = 0.32; l.shadow.camera.far = l.distance; l.shadow.camera.fov = 2 * l.angle * 180 / Math.PI; l.shadow.camera.aspect = 1; l.shadow.camera.updateProjectionMatrix(); l.shadow.focus = 1; l.updateMatrixWorld(true); l.target.updateMatrixWorld(true);
    var K = liU().uLiShK.value[1]; K.x = 2.2 / SH.A; K.y = 0.00035; K.w = 1.2 * 2 * Math.tan(l.angle) / SH.size; liU().uLiShP.value[1].set(fx.p.x, fx.p.y, fx.p.z, 1); SH.want[1] = 1; SH.ok[1] = 0; }
  function shSetWin(S, op) { var l = shLight(2), C = op.C, cx = (C[0][0] + C[2][0]) / 2, cy = (C[0][1] + C[2][1]) / 2, cz = (C[0][2] + C[2][2]) / 2, wd = Math.hypot(C[1][0] - C[0][0], C[1][2] - C[0][2]), h = C[2][1] - C[1][1], D = Math.max(1.2, 0.75 * Math.max(wd, h));
    var c = LV.a.set(cx, cy, cz).applyMatrix4(S.M), nw = op.nw; l.position.copy(c).addScaledVector(nw, -D); l.target.position.copy(c).addScaledVector(nw, 3); l.angle = Math.min(1.35, Math.atan(0.5 * Math.hypot(wd, h) / D) + 0.5); l.penumbra = 0; l.distance = 40; l.shadow.camera.near = Math.max(0.2, D - 0.4); l.shadow.camera.far = 40; l.shadow.camera.fov = 2 * l.angle * 180 / Math.PI; l.shadow.camera.aspect = 1; l.shadow.camera.updateProjectionMatrix(); l.updateMatrixWorld(true); l.target.updateMatrixWorld(true);
    var K = liU().uLiShK.value[2]; K.x = 6 / SH.A; K.y = 0.00045; K.w = 1.4 * 2 * Math.tan(l.angle) / SH.size; liU().uLiShP.value[2].set(l.position.x, l.position.y, l.position.z, 1); SH.want[2] = 1; SH.ok[2] = 0; }
  // inside the main render, after the scene's own shadow pass: one of the room's maps, the most overdue
  function shPass(prev, smObj, scn, cam) {
    var R = LI.R, S = LI.S; if (!R || !S || !LI.hi || !RL.part.li || !SH.atlas || LI.st < 2) return; var pick = -1, age = -1;
    for (var i = 0; i < 3; i++) { if (!SH.want[i] || !SH.key[i]) continue; var a = FRAME_N - SH.fr[i]; if (a > age) { age = a; pick = i; } } if (pick < 0) return;
    var l = SH.L[pick]; if (!l) return; var t0 = performance.now(), kids = scene.children, list = SH.list, flip = SH.cast; list.length = 0; var rts = liRoots(R); for (var rr = 0; rr < rts.length; rr++) list.push(rts[rr]); for (var k = 0; k < SH.actors.length; k++) if (SH.actors[k].parent === scene) list.push(SH.actors[k]); if (pick === 0 && SH.caps && SH.caps.children.length) list.push(SH.caps);
    for (var j = 0; j < flip.length; j++) { var o = flip[j]; o.userData._liCs = o.castShadow; o.castShadow = true; }
    var su = smObj.autoUpdate, sn = smObj.needsUpdate, c0 = renderer.info.render.calls;
    try { scene.children = list; smObj.needsUpdate = true; l.shadow.needsUpdate = true; prev.call(smObj, [l], scn, cam); }
    catch (e) { note("li shadow", e); SH.want[pick] = 0; }
    finally { scene.children = kids; for (var j2 = 0; j2 < flip.length; j2++) flip[j2].castShadow = flip[j2].userData._liCs; smObj.autoUpdate = su; smObj.needsUpdate = sn; }
    if (shBlit(pick)) { liU().uLiShM.value[pick].copy(l.shadow.matrix); SH.ok[pick] = 1; liU().uLiShK.value[pick].z = 1; }
    SH.fr[pick] = FRAME_N; SH.want[pick] = 0; var ms = performance.now() - t0; LI.n.shR++; LI.n.shMs = +ms.toFixed(2); if (ms > LI.n.shMax) LI.n.shMax = +ms.toFixed(2); LI.n.shCalls = renderer.info.render.calls - c0;
  }
  // the depth programs the room maps can need (front, back and double sided casters, plain and instanced), made once outdoors
  // inside the main render with the main pass's light state, so a first room never compiles one
  function shWarm(prev, smObj, scn) {
    SH.warmed = true; var t0 = performance.now(), g = new THREE.Group(), geo = new THREE.BoxGeometry(0.2, 0.2, 0.2), mats = [], kids = scene.children;
    // and the same with an alpha-tested map (leaves, cut-outs, fringes: three gives those casters a depth material of their own)
    var at = SH.atTex || (SH.atTex = (function () { var t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; t.userData.avShared = true; return t; })());
    try { [THREE.FrontSide, THREE.DoubleSide, THREE.BackSide, -1, -2, -3].forEach(function (sd0, i) { var cut = sd0 < 0, sd = cut ? [THREE.FrontSide, THREE.DoubleSide, THREE.BackSide][-sd0 - 1] : sd0; var m = new THREE.MeshStandardMaterial(cut ? { side: sd, map: at, alphaTest: 0.5 } : { side: sd }); mats.push(m); var a = new THREE.Mesh(geo, m); a.castShadow = true; a.position.set(i * 0.3, 0, 0); g.add(a); var im = new THREE.InstancedMesh(geo, m, 1); im.castShadow = true; im.setMatrixAt(0, new THREE.Matrix4().makeTranslation(i * 0.3, 0.3, 0)); im.frustumCulled = false; g.add(im);
        var sg = SH.skGeo || (SH.skGeo = (function () { var q = new THREE.BoxGeometry(0.2, 0.2, 0.2), nv = q.attributes.position.count; q.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(nv * 4), 4)); var w = new Float32Array(nv * 4); for (var v = 0; v < nv; v++) w[v * 4] = 1; q.setAttribute("skinWeight", new THREE.Float32BufferAttribute(w, 4)); return q; })());
        var bone = new THREE.Bone(), sk = new THREE.SkinnedMesh(sg, m); sk.add(bone); sk.bind(new THREE.Skeleton([bone])); sk.castShadow = true; sk.frustumCulled = false; sk.position.set(i * 0.3, -0.3, 0); g.add(sk); });   // characters (skinned), on each side
      g.position.copy(camera.position).add(new THREE.Vector3(0, -50, 0)); g.updateMatrixWorld(true); var l = shLight(0), cam = l.shadow.camera; cam.left = cam.bottom = -2; cam.right = cam.top = 2; cam.near = 0.1; cam.far = 10; cam.updateProjectionMatrix(); l.position.copy(g.position).y += 5; l.target.position.copy(g.position); l.updateMatrixWorld(true); l.target.updateMatrixWorld(true);
      var su = smObj.autoUpdate, sn = smObj.needsUpdate; try { scene.children = [g]; smObj.needsUpdate = true; l.shadow.needsUpdate = true; prev.call(smObj, [l], scn, camera); } finally { scene.children = kids; smObj.autoUpdate = su; smObj.needsUpdate = sn; } }
    catch (e) { note("li warm", e); } finally { geo.dispose(); mats.forEach(function (m) { m.dispose(); }); g.children.forEach(function (o) { if (o.isInstancedMesh) o.dispose(); if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose(); }); if (SH.skGeo) { SH.skGeo.dispose(); SH.skGeo = null; } }
    LI.n.warmMs = +(performance.now() - t0).toFixed(1); }
  function shInstall() { if (SH.inst || typeof renderer === "undefined" || !renderer) return; var sm = renderer.shadowMap; if (sm.__liW) { SH.inst = true; return; } sm.__liW = true; SH.inst = true; var prev = sm.render, mainScene = scene;
    if (!scene.onAfterRender || scene.onAfterRender === THREE.Object3D.prototype.onAfterRender) scene.onAfterRender = function () { try { liAfter(); } catch (e) {} };
    sm.render = function (lights, scn, cam) { var r = prev.apply(this, arguments); if (scn === mainScene && cam === camera && !SH.busy) { SH.busy = true; try { if (!SH.warmed && LI.hi && FRAME_N > 30 && !LI.R) shWarm(prev, this, scn); liRenderTime(); shPass(prev, this, scn, cam); } catch (e) { note("li pass", e); } finally { SH.busy = false; } } return r; }; }

  // ── the room's light, per room: prepared once (cached, LRU 6), then lived in ──
  var C_OUT = 5.4 / 100000;   // game units per lux outdoors: the cascaded key light at full sun (1.72 x PI) is 100 klux
  function sunDirW(out) { try { var G = window.PLAN_GFX && PLAN_GFX.sun; if (G && G.dir) return out.set(G.dir[0], G.dir[1], G.dir[2]).normalize(); } catch (e) {} try { if (CSMX.csm) return out.copy(CSMX.csm.lightDirection).negate().normalize(); } catch (e) {} return out.set(0, 1, 0); }
  function liGeom(R) {
    var b = R.box, S = { id: R.id, type: R.type, M: R.M.clone(), Mi: R.Mi.clone(), F: typeof R.floorY === "number" ? R.floorY : b[2], H: b[3], x0: b[0], x1: b[1], z0: b[4], z1: b[5], ops: [], src: "box" };
    var hit = R.drKey && DR.cache.get(R.drKey), rd = hit && hit.plan && hit.plan.read;
    if (rd && rd.walls) { var W = rd.walls; if (W[0] && W[1] && W[1][2] - W[0][2] > 2) { S.x0 = W[0][2]; S.x1 = W[1][2]; } if (W[2] && W[3] && W[3][2] - W[2][2] > 2) { S.z0 = W[2][2]; S.z1 = W[3][2]; } if (rd.hc > 1.8 && rd.hc < 14) S.H = S.F + rd.hc; S.src = "read"; }
    if (!(S.H - S.F > 1.8)) S.H = S.F + 4.4; S.hz = (S.z1 - S.z0) / 2; if (R.mod === "walk") R.liFilter = true; return S;
  }
  // the module's own lights inside the room become fixtures when the room has none of its own (the walk-ins)
  function liOwnFix(R, S) { var n = 0; try { for (var i = 0; i < LIGHTS.src.length; i++) { var l = LIGHTS.src[i]; if (!(l._intensity > 0.001)) continue; var p = LV.a; l.getWorldPosition(p); var q = LV.b.copy(p).applyMatrix4(R.Mi); if (q.x < S.x0 - 0.3 || q.x > S.x1 + 0.3 || q.z < S.z0 - 0.3 || q.z > S.z1 + 0.3 || q.y < S.F - 0.3 || q.y > S.H + 0.5) continue;
      var f = R.light(q.x, q.y, q.z, [l.color.r, l.color.g, l.color.b], clamp(l._intensity * 1.4, 0.4, 3), l.distance || 6, {}); f.own = true; n++; } } catch (e) { note("li own", e); } return n; }
  function liPrepare(R) {
    var t0 = performance.now(), S = liGeom(R); var ex = S.x1 - S.x0, ez = S.z1 - S.z0; if (!(ex > 1.5 && ez > 1.5) || ex > 60 || ez > 60) return null;
    if (R.liFix0) R.fix = R.liFix0.slice(); else R.liFix0 = R.fix.slice(); S.walk = R.mod === "walk";
    var nf = 0; for (var i = 0; i < R.fix.length; i++) if (!R.fix[i].win) nf++; if ((nf < 2 || R.liZone) && R.own) { liOwnFix(R, S); if (R.liZone) mergeFix(R, 0.9); }
    try { LI.n.glowMore = liGlowMore(R, S); } catch (e) { note("li glow more", e); }
    S.fx = liFixtures(R, S); if (!S.fx.length && R.lamp) { try { R.lamp.getWorldPosition(LV.a); LV.b.copy(LV.a).applyMatrix4(R.Mi); var lf = R.light(LV.b.x, Math.min(LV.b.y, S.H - 0.1), LV.b.z, [1, 0.86, 0.7], 1.6, 6, {}); lf.own = true; S.fx = liFixtures(R, S); } catch (e) {} }   // a room with no fixture of its own keeps one ceiling light where its lamp was
    portalOps(R, S); LI.n.glass = glassOps(R, S);
    var sdW = sunDirW(LV.d), T = 1;
    for (var k = 0; k < S.ops.length; k++) { var o = S.ops[k]; o.C = opCorners(S, o); o.nw = new THREE.Vector3(o.n[0], 0, o.n[1]).transformDirection(S.M); o.area = (o.s1 - o.s0) * (o.y1 - o.y0); o.T = /glass/.test(o.src) && !o.door ? 0.85 : 1; o.sun = 0; }
    S.ops.sort(function (a, c) { return c.area - a.area; }); if (S.ops.length > LI.NW) S.ops.length = LI.NW;
    // the openings the atmosphere's shafts and dust should use (R15 used the module's portals, the client's six windows or the door)
    if (!(R.wins && R.wins.length) && S.ops.length) { R.wins = S.ops.map(function (o) { return o.w < 2 ? ["z", wallOf(S, o.w).c, o.s0, o.s1, o.y0, o.y1] : ["x", wallOf(S, o.w).c, o.s0, o.s1, o.y0, o.y1]; }); R.liWins = true; }
    liAlbedo(R, S); liCanvasPrep(R, S); liSolids(R, S); liAoTile(S); liPatches(S); liDirectPatches(S); liCells(S);
    S.job = { c: 0, sun: false }; S.sunAt = -1; S.sunDir = new THREE.Vector3(0, -1, 0); S.prepMs = +(performance.now() - t0).toFixed(1);
    LI.n.fix = S.fx.length; LI.n.wins = S.ops.length; return S;
  }
  // the sun class: which openings the sun reaches (neighbours), the sunlit patches, then a gather of only those
  function liSunUpdate(S, sdW) {
    var t0 = performance.now(), n = 0; for (var k = 0; k < S.ops.length; k++) { var o = S.ops[k]; var fac = -(sdW.x * o.nw.x + sdW.z * o.nw.z); o.sun = sdW.y > 0.03 && fac > 0.02 ? liSunVis(S, o, sdW) : 0; if (o.sun > 0.5) n++; }
    var sd = LV.c.copy(sdW).transformDirection(S.Mi); S.sd = [sd.x, sd.y, sd.z]; S.sunUp = sdW.y > 0.03; liSunPatches(S, sdW.y > 0.03 && n ? sd : null); S.sunDir.copy(sdW); S.sunAt = performance.now(); S.sunN = n; LI.n.sunWins = n; LI.n.sunBakes++;
    if (LI.hi) { try { shCaps(S); } catch (e) { note("li caps", e); } }
    S.job.sun = true; S.job.sc = 0; LI.n.sunMs = +(performance.now() - t0).toFixed(1);
  }
  // one slice of the bake (the static gather, then the sun's)
  // the gather runs in a worker (plain arrays in, the volume's coefficients out); the stepped main-thread path is the fallback
  var LW = { wk: null, bad: false, id: 0, busy: null };
  function liWorker() {
    if (LW.wk || LW.bad) return LW.wk;
    try { if (typeof Worker === "undefined" || typeof Blob === "undefined") { LW.bad = true; return null; }
      var src = "var PS = " + PS + ";\nvar liGather = " + liGather.toString() + ";\nself.onmessage = function (e) { var d = e.data, S = d.S; S.V = new Float32Array(S.nc * 36); S.VS = new Float32Array(S.nc * 12); liGather(S, 0, S.nc, d.sun); var out = d.sun ? S.VS : S.V, ei = d.sun ? S.EiS : S.EiA, sr = d.sun ? S.srcS : S.srcA; self.postMessage({ id: d.id, sun: d.sun, V: out, Ei: ei, B: sr }, [out.buffer, ei.buffer, sr.buffer]); };";
      LW.wk = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      LW.wk.onmessage = function (e) { var m = e.data, J = LW.busy; LW.busy = null; if (!J || J.id !== m.id) return; var S = J.S; if (m.sun) { S.VS = m.V; S.EiS = m.Ei; S.srcS = m.B; S.job.sun = false; } else { S.V = m.V; S.EiA = m.Ei; S.srcA = m.B; S.job.c = S.nc; } S.job.wait = false; S.mixAt = 0; LI.n.wkMs = Math.round(performance.now() - J.t0); };
      LW.wk.onerror = function (e) { LW.bad = true; var J = LW.busy; LW.busy = null; if (J) J.S.job.wait = false; note("li worker", (e && e.message) || "error"); };
    } catch (e) { LW.bad = true; LW.wk = null; } return LW.wk;
  }
  function liPost(S, sun) { var J = S.job, id = ++LW.id, Sd = { P: new Float32Array(S.P), np: S.np, nx: S.nx, ny: S.ny, nz: S.nz, nc: S.nc, x0: S.x0, F: S.F, z0: S.z0, cx: S.cx, cy: S.cy, cz: S.cz, tr: S.tr || null, sd: S.sd || null }; J.wait = true; LW.busy = { id: id, S: S, t0: performance.now() };
    try { LW.wk.postMessage({ id: id, sun: sun, S: Sd }, [Sd.P.buffer]); } catch (e) { LW.bad = true; LW.busy = null; J.wait = false; note("li post", e); } }
  function liStep(S, budget) {
    var t0 = performance.now(), J = S.job; if (!J) return true;
    var W = !LW.bad && liWorker(); if (W && !LW.bad) { if (J.wait) return false; if (LW.busy) return false; if (J.c < S.nc) { liPost(S, false); return false; } if (J.sun) { liPost(S, true); return false; } return true; }
    if (J.c < S.nc) { var per = Math.max(1, Math.floor(16000 / Math.max(1, S.np))); while (J.c < S.nc && performance.now() - t0 < budget) { var c1 = Math.min(S.nc, J.c + per); liGather(S, J.c, c1, false); J.c = c1; } if (J.c < S.nc) return false; }
    if (J.sun) { var per2 = Math.max(4, Math.floor(60000 / Math.max(1, S.sunN ? S.np : 1))); while (J.sc < S.nc && performance.now() - t0 < budget) { var c2 = Math.min(S.nc, J.sc + per2); liGather(S, J.sc, c2, true); J.sc = c2; } if (J.sc < S.nc) return false; J.sun = false; }
    return true;
  }
  // the light levels now: the sky and the ground beyond the openings, the sun, the eye's adaptation to the room (lux to game units)
  var LK0 = { sky: [0, 0, 0], gnd: [0, 0, 0], sun: [0, 0, 0], G: 0, Eavg: 0, day: 0, sunLux: 0, sunDisp: 0, T: 0 }, VW = new Float32Array(4096), VV = new Float32Array(4096), PIX = [];
  function liLevels(S, dt, snap) {
    var k = LK0, nt = nightK(), day = 1 - nt, sdW = sunDirW(LV.d), el = sdW.y; k.day = day;
    var skyE = Math.PI * 0.53 * day * daylight() + 0.004, sc = LV.col.setHSL(0.6, 0.5, 0.52 + 0.36 * day), Ls = skyE / (Math.PI * C_OUT);
    var raw = 0; try { raw = CSMX.csm ? CSMX.csm.lights[0]._intensity : sun._intensity; } catch (e) {} var sunLux = el > 0.02 ? 100000 * clamp(raw / 1.72, 0, 1.2) * sstep(0.02, 0.08, el) : 0;
    var Lg = (sunLux * Math.max(0, el) + skyE / C_OUT) / Math.PI; k.sky[0] = sc.r * Ls; k.sky[1] = sc.g * Ls; k.sky[2] = sc.b * Ls; k.gnd[0] = 0.4 * Lg; k.gnd[1] = 0.33 * Lg; k.gnd[2] = 0.25 * Lg;
    // the eye adapts to what it looks at: the room's surfaces weighted by how much of the view they fill (facing the camera, in
    // front of it, near), each by the light that falls on it (a small sun patch counts for less than its lux)
    var P = S.P, ls = 0.2126 * k.sky[0] + 0.7152 * k.sky[1] + 0.0722 * k.sky[2], lg = 0.2126 * k.gnd[0] + 0.7152 * k.gnd[1] + 0.0722 * k.gnd[2], sa = 0, se = 0;
    var cp = LV.b.copy(camera.position).applyMatrix4(S.Mi), cd = LV.c; camera.getWorldDirection(cd); cd.transformDirection(S.Mi);
    for (var j = 0; j < S.np; j++) { var o = j * PS, dx = P[o] - cp.x, dy = P[o + 1] - cp.y, dz = P[o + 2] - cp.z, d2 = dx * dx + dy * dy + dz * dz + 0.5, dd = Math.sqrt(d2), fc = -(dx * P[o + 3] + dy * P[o + 4] + dz * P[o + 5]) / dd; if (fc <= 0) continue;
      var fw = (dx * cd.x + dy * cd.y + dz * cd.z) / dd, w = P[o + 6] * fc / d2 * (fw > 0.35 ? 1 : 0.12), al = 0.2126 * P[o + 7] + 0.7152 * P[o + 8] + 0.0722 * P[o + 9];
      var A9 = S.EiA, B9 = S.EiS, s9 = j * 9, s3 = j * 3, ind = 0; if (A9) ind = 0.2126 * A9[s9] + 0.7152 * A9[s9 + 1] + 0.0722 * A9[s9 + 2] + 0.2126 * (A9[s9 + 3] * k.sky[0] + A9[s9 + 6] * k.gnd[0]) + 0.7152 * (A9[s9 + 4] * k.sky[1] + A9[s9 + 7] * k.gnd[1]) + 0.0722 * (A9[s9 + 5] * k.sky[2] + A9[s9 + 8] * k.gnd[2]); if (B9 && S.sunN) ind += sunLux * (S.walk ? 0.25 : 1) * (0.2126 * B9[s3] + 0.7152 * B9[s3 + 1] + 0.0722 * B9[s3 + 2]);
      var v = (0.3 + al) * (0.2126 * P[o + 10] + 0.7152 * P[o + 11] + 0.0722 * P[o + 12] + ls * P[o + 13] + lg * P[o + 14] + (S.walk ? 0.03 : 0.12) * sunLux * P[o + 15] + ind); w *= fw > 0.35 ? 0.4 + fw * fw : 1; VW[j] = w; VV[j] = v; sa += w; se += w * Math.log(1 + v); }
    // exposed for the darker part of the view, as a photographer exposes an interior (the windows are let go bright): the log
    // average with its bright outliers clipped, pulled toward the weighted 35th percentile (more by day, when windows are in view)
    var lm = sa > 0 ? se / sa : 0, cap = Math.exp(lm) * 4, sa2 = 0, se2 = 0, ix = PIX; ix.length = 0; for (var j2 = 0; j2 < S.np; j2++) { if (!(VW[j2] > 0)) continue; sa2 += VW[j2]; se2 += VW[j2] * Math.log(1 + Math.min(VV[j2], cap)); ix.push(j2); }
    ix.sort(function (a2, b2) { return VV[a2] - VV[b2]; }); var acc = 0, e35 = 0, pq = 0.35 - 0.1 * sstep(0.05, 0.6, daylight()); for (var j3 = 0; j3 < ix.length; j3++) { acc += VW[ix[j3]]; if (acc >= sa2 * pq) { e35 = VV[ix[j3]]; break; } } for (var j4 = 0; j4 < ix.length; j4++) VW[ix[j4]] = 0;
    var dk = sstep(0.05, 0.6, daylight()), lA = sa2 > 0 ? se2 / sa2 : 0, lP = Math.log(1 + e35), kp = 0.35 + 0.6 * dk, Eavg = Math.exp(lA + kp * (lP - lA)) - 1, T = 0.54 + 0.3 * dk; k.Eavg = Eavg; k.T = T;
    var pa = 0.8 + 0.12 * (1 - sstep(25, 500, Eavg)), Gt = T / (Math.pow(Math.max(Eavg, 0.6), pa) * Math.pow(120, 1 - pa)); if (snap || !(LI.Gs > 0)) LI.Gs = Gt; else LI.Gs += (Gt - LI.Gs) * Math.min(1, dt * 1.6); k.G = LI.Gs;
    var sd = Math.min(sunLux * k.G, 12 * T), scol = LV.col; try { scol.copy(CSMX.csm ? CSMX.csm.lights[0].color : sun.color); } catch (e) { scol.setRGB(1, 0.95, 0.9); } k.sun[0] = scol.r * sd; k.sun[1] = scol.g * sd; k.sun[2] = scol.b * sd; k.sunLux = sunLux; k.sunDisp = sd;
    return k;
  }
  LI.levels = function () { return LK0; };
  LI.need = function (R) { return !!(RL.part.li && R && liRoots(R).length && R.pool !== false && !R.liFail); };
  LI.begin = function (R) { LI.end(); if (!LI.need(R)) return; LI.R = R; LI.st = 1; LI.t0 = performance.now(); LI.f0 = RL.n.frames; LI.S = null; LI.ramp = 0; LI.n.begins++; LI.keyF = null; LI.keyW = null; SH.want = [0, 0, 0]; SH.ok = [0, 0, 0]; SH.key = [null, null, null]; SH.actAt = 0; var U = liU(); U.uLiOn.value.set(0, 0, 0, 0); for (var i = 0; i < 3; i++) U.uLiShK.value[i].z = 0; };
  LI.end = function () { liCanvasEnd(); if (!LI.R) return; var U = liU(); U.uLiOn.value.set(0, 0, 0, 0); U.uLiSunD.value.w = 0; U.uLiCnt.value.set(0, 0, 0, 0); for (var i = 0; i < 3; i++) U.uLiShK.value[i].z = 0; liRestore(); if (LI.R.liWins) { LI.R.wins = []; LI.R.liWins = false; } LI.R = null; LI.S = null; LI.st = 0; SH.actors = []; SH.cast = []; };
  LI.active = function (R) { return LI.st === 3 && LI.R === R && !!LI.S && RL.part.li; };
  // every frame in the room: the slices of the bake, then the uniforms, the key lights and their maps
  LI.frame = function (R, dt, now) {
    if (LI.R !== R) LI.begin(R); if (!LI.R) return; var t0 = performance.now();
    if (LI.st === 1) { var waited = RL.n.frames - LI.f0; if ((DR.pend && DR.pend.g === R.g && waited < 120) || waited < 2) return;
      var ck = R.id + (nightK() > 0.5 ? ":n" : ":d"), hit = LI.cache.get(ck); if (hit && hit.fxN === (R.liFix0 ? R.liFix0.length : R.fix.length)) { LI.cache.delete(ck); LI.cache.set(ck, hit); LI.S = hit; LI.n.cached++; if (!(R.wins && R.wins.length) && hit.wins) { R.wins = hit.wins; R.liWins = true; } }
      else { var S0 = null, n0 = R.fix.length; try { S0 = liPrepare(R); } catch (e) { note("li prepare", e); } if (!S0) { R.liFail = true; LI.st = 0; LI.R = null; try { if (ENV.deferR === R) { ENV.deferR = null; envBegin(R); } } catch (e) {} return; } S0.fxN = R.liFix0 ? R.liFix0.length : n0; S0.wins = R.liWins ? R.wins : null; LI.S = S0; LI.cache.set(R.id + (nightK() > 0.5 ? ":n" : ":d"), S0); while (LI.cache.size > 6) { var k0 = LI.cache.keys().next().value, ev = LI.cache.get(k0); LI.cache.delete(k0); if (ev && ev.tex && ev !== LI.S) ev.tex.dispose(); } }
      LI.st = 2; LI.S.sunAt = -1; if (LI.hi) { shAtlas(); SH.cast = shCasters(R, LI.S); } try { if (R.liWins && RL.atmoBegin) RL.atmoBegin(R); } catch (e) { note("li atmo", e); } }
    var S = LI.S; if (!S) return; var sdW = sunDirW(LV.a);
    if (S.sunAt < 0 || (now - S.sunAt > 2500 && S.sunDir.angleTo(sdW) > 0.006)) liSunUpdate(S, sdW.clone());
    if (S.job && (S.job.c < S.nc || S.job.sun)) { var t1 = performance.now(); var done = liStep(S, LI.st === 2 ? 6 : 3); var ms = performance.now() - t1; LI.n.stepMax = Math.max(LI.n.stepMax, +ms.toFixed(1)); LI.n.bakeMs += ms; if (LI.st === 2 && !done) { LI.n.bakeFrames++; return; } if (done) S.mixAt = 0; }
    var snap = LI.st === 2, k = liLevels(S, dt, snap);
    if (snap || now - (S.mixAt || 0) > 400 || Math.abs(k.G - (S.mixG || 0)) > 0.03 * S.mixG) { liCombine(S, k); S.mixAt = now; S.mixG = k.G; }
    if (LI.st === 2) { LI.st = 3; LI.ramp = 0; LI.readyMs = Math.round(performance.now() - LI.t0); try { if (ENV.deferR === R) { ENV.deferR = null; envBegin(R); } } catch (e) { note("li env", e); } }
    LI.ramp = Math.min(1, LI.ramp + dt * 2.5);
    try { liCanvasFrame(S, k); } catch (e) { note("li canvas", e); }
    if (LI.hi) liUniforms(R, S, k, now); LI.n.frameMs = +(performance.now() - t0).toFixed(2);
  };
  // the room materials' uniforms (high and ultra), and which fixture and opening carry the shadow maps
  function liUniforms(R, S, k, now) {
    var U = liU(), cam = camera.position, G = k.G, F = S.fx, nF = Math.min(F.length, LI.NF), best = -1, bs = 0;
    U.uLiRot.value.setFromMatrix4(S.Mi); U.uLiPos.value.set(S.M.elements[12], S.M.elements[13], S.M.elements[14]); U.uLiFl.value.set(S.F, S.H, 1, 1.25);
    for (var i = 0; i < nF; i++) { var f = F[i], I = f.I * G * (f.fl ? flick(f, now) : 1), r = clamp(Math.sqrt(I / 0.0012), 1.5, 32);
      U.uLiFP.value[i].set(f.p.x, f.p.y, f.p.z, r); U.uLiFC.value[i].set(f.col[0] * I, f.col[1] * I, f.col[2] * I, f.prof); U.uLiFR.value[i].set(f.lx, f.ly, f.lz, f.hf);
      if (f.kind !== "candle" && f.kind !== "neon") { var d2 = (f.p.x - cam.x) * (f.p.x - cam.x) + (f.p.y - cam.y) * (f.p.y - cam.y) + (f.p.z - cam.z) * (f.p.z - cam.z), sc = f.I / (1 + d2 / 16) * (f.ly - S.F > 1.6 ? 1.5 : 1); if (sc > bs) { bs = sc; best = i; } } }
    // the key fixture changes only for a clearly better one (its shadow map is redrawn)
    if (LI.keyF !== null && LI.keyF < nF && best >= 0 && best !== LI.keyF) { var f0 = F[LI.keyF], d0 = (f0.p.x - cam.x) * (f0.p.x - cam.x) + (f0.p.y - cam.y) * (f0.p.y - cam.y) + (f0.p.z - cam.z) * (f0.p.z - cam.z), s0 = f0.I / (1 + d0 / 16) * (f0.ly - S.F > 1.6 ? 1.5 : 1); if (bs < s0 * 1.35) best = LI.keyF; }
    if (best >= 0 && best !== LI.keyF) { LI.keyF = best; SH.key[1] = F[best]; shSetFix(S, F[best]); }
    // the key opening: the largest by day (its sky light carries the map); the sun's map whenever the sun comes in
    var day = k.day > 0.02 && k.sky[1] > 1, nW = S.ops.length, kw = -1; if (day) { var ba = 0; for (var w = 0; w < nW; w++) { var o = S.ops[w], a = o.area * (o.door ? 0.6 : 1) * o.T; if (a > ba) { ba = a; kw = w; } } }
    if (kw >= 0 && SH.key[2] !== S.ops[kw]) { SH.key[2] = S.ops[kw]; shSetWin(S, S.ops[kw]); } if (kw < 0) { SH.key[2] = null; U.uLiShK.value[2].z = 0; }
    var walk = R.mod === "walk", sunOn = !walk && S.sunN > 0 && k.sunDisp > 0.01; U.uLiMx.value.set(walk ? 1 : 0, 0, 0, 0); if (sunOn && (SH.key[0] !== S || SH.sunAt !== S.sunAt)) { SH.key[0] = S; SH.sunAt = S.sunAt; shSetSun(S, S.sunDir); } if (!sunOn) { SH.key[0] = null; U.uLiShK.value[0].z = 0; }
    for (var w2 = 0; w2 < nW; w2++) { var op = S.ops[w2], C = op.C; for (var c = 0; c < 4; c++) U.uLiWC.value[w2 * 4 + c].set(C[c][0], C[c][1], C[c][2], 1).applyMatrix4(S.M); U.uLiWN.value[w2].set(op.nw.x, op.nw.y, op.nw.z, op.T); }
    U.uLiSky.value.set(k.sky[0] * G, k.sky[1] * G, k.sky[2] * G, 0); U.uLiGnd.value.set(k.gnd[0] * G, k.gnd[1] * G, k.gnd[2] * G, 0);
    U.uLiSunD.value.set(S.sunDir.x, S.sunDir.y, S.sunDir.z, sunOn && SH.ok[0] ? 1 : 0); U.uLiSunC.value.set(k.sun[0], k.sun[1], k.sun[2], 0);
    U.uLiCnt.value.set(nF, LI.keyF !== null && SH.ok[1] ? LI.keyF + 1 : 0, day ? nW : 0, kw >= 0 && SH.ok[2] ? kw + 1 : 0);
    var ex = S.x1 - S.x0, ez = S.z1 - S.z0, eh = S.H - S.F; U.uLiVo.value.set(S.x0, S.F, S.z0, 0); U.uLiVs.value.set(1 / ex, 1 / eh, 1 / ez, S.nz); U.tLiVol.value = S.tex; U.uLiAoR.value.set(S.x0, S.z0, 1 / ex, 1 / ez);
    U.uLiOn.value.set(1, 1, LI.ramp, 1);
    // the shadow maps: due when their light moved (set above), and while characters move in the room (each map about every
    // third frame then), at least every second
    var act = shActors(R, S, now), mv = 0; for (var q = 0; q < act.length; q++) { var ap = act[q].position; mv += ap.x * 1.7 + ap.y * 3.1 + ap.z * 2.3 + act[q].rotation.y; } try { if (player && player.visible) { mv += player.position.x + player.position.z * 1.3 + player.rotation.y; } } catch (e) {}
    var moving = Math.abs(mv - SH.lastAct) > 0.004; SH.lastAct = mv; if (moving) SH.movedAt = now;
    for (var s = 0; s < 3; s++) if (SH.key[s] && (FRAME_N - SH.fr[s] > 60 || (now - (SH.movedAt || 0) < 400 && FRAME_N - SH.fr[s] >= 3))) SH.want[s] = 1;
    if (SH.aoFor !== S) { shClear(); shAoUpload(S); }
  }

  // ── the pool while LI lights the room: the nearest fixtures (points), the sun's beam through its opening, the key opening's sky
  //    light and the key downlight (spots); what characters, glass and the low tiers see (room materials on high and ultra skip it) ──
  var PCAND = [];
  function poolLI(R, dt, now) {
    var S = LI.S, k = LK0, G = k.G, cam = camera.position, F = S.fx, i; PCAND.length = 0;
    for (i = 0; i < F.length; i++) { var f = F[i], d2 = (f.p.x - cam.x) * (f.p.x - cam.x) + (f.p.y - cam.y) * (f.p.y - cam.y) + (f.p.z - cam.z) * (f.p.z - cam.z), I = f.I * G * (f.prof === 1 ? 0.8 : f.prof === 0 ? 1 : 0.65) * (f.fl ? flick(f, now) : 1); f._pI = I; f._ps = I / (1 + d2 / 12); PCAND.push(f); }
    PCAND.sort(function (a, b) { return b._ps - a._ps; });
    // spots: [0] the sun's beam, [1] the key opening's sky light, [2] the strongest downlight not taken by a point
    var used = 0, sp = LIGHTS.spool, pl = LIGHTS.pool, sl;
    var sunOp = null, sa = 0; if (k.sunDisp > 0.01 && R.mod !== "walk") for (i = 0; i < S.ops.length; i++) { var o = S.ops[i]; if (!(o.sun > 0.5)) continue; var fa = -(S.sunDir.x * o.nw.x + S.sunDir.z * o.nw.z), a = o.area * fa; if (fa > 0.02 && a > sa) { sa = a; sunOp = o; } }
    sl = sp[0]; if (sl) { if (sunOp) { var C = sunOp.C, c = LV.a.set((C[0][0] + C[2][0]) / 2, (C[0][1] + C[2][1]) / 2, (C[0][2] + C[2][2]) / 2).applyMatrix4(S.M), D = 25, hw = 0.5 * Math.hypot(C[1][0] - C[0][0], C[1][2] - C[0][2], C[2][1] - C[1][1]);
        sl.position.copy(c).addScaledVector(S.sunDir, D); sl.target.position.copy(c).addScaledVector(S.sunDir, -3); sl.target.updateMatrixWorld(); sl.color.setRGB(k.sun[0], k.sun[1], k.sun[2]); var m = Math.max(k.sun[0], k.sun[1], k.sun[2]) || 1; sl.color.multiplyScalar(1 / m);
        sl.intensity = m * D * D * sunOp.T / 1.7; sl.distance = 0; sl.decay = 2; sl.angle = Math.atan(hw * 1.05 / D); sl.penumbra = 0.25; } else sl.intensity = 0; }
    var kw = null; if (k.day > 0.02) { var ba = 0; for (i = 0; i < S.ops.length; i++) { var q = S.ops[i], aa = q.area * (q.door ? 0.6 : 1) * q.T; if (aa > ba) { ba = aa; kw = q; } } }
    sl = sp[1]; if (sl) { if (kw) { var C2 = kw.C, c2 = LV.a.set((C2[0][0] + C2[2][0]) / 2, (C2[0][1] + C2[2][1]) / 2, (C2[0][2] + C2[2][2]) / 2).applyMatrix4(S.M), wd = Math.hypot(C2[1][0] - C2[0][0], C2[1][2] - C2[0][2]), h = C2[2][1] - C2[1][1], D2 = 0.8 * Math.max(wd, h) + 0.4, L = LV.col.setRGB((k.sky[0] + k.gnd[0]) * 0.5, (k.sky[1] + k.gnd[1]) * 0.5, (k.sky[2] + k.gnd[2]) * 0.5).multiplyScalar(G * kw.T), mL = Math.max(L.r, L.g, L.b) || 1;
        sl.position.copy(c2).addScaledVector(kw.nw, -D2); sl.target.position.copy(c2).addScaledVector(kw.nw, 2.5); sl.target.updateMatrixWorld(); sl.color.copy(L).multiplyScalar(1 / mL); sl.intensity = mL * wd * h / 1.7; sl.distance = 30; sl.decay = 2; sl.angle = Math.min(1.35, Math.atan(0.5 * Math.hypot(wd, h) / D2) * 1.25 + 0.25); sl.penumbra = 0.9; } else sl.intensity = 0; }
    var down = null; for (i = 0; i < PCAND.length && i < 12; i++) { var fd = PCAND[i]; if (fd.kind === "pend" || fd.kind === "ceil" || fd.kind === "chand") { down = fd; break; } }
    sl = sp[2]; if (sl) { if (down) { sl.position.copy(down.p); sl.target.position.copy(down.p).y -= 3; sl.target.updateMatrixWorld(); sl.color.setRGB(down.col[0], down.col[1], down.col[2]); sl.intensity = down.I * G * (down.fl ? flick(down, now) : 1) / 1.7; sl.distance = clamp(Math.sqrt(down.I * G / 0.0012), 2, 32); sl.decay = 2; sl.angle = down.prof === 1 ? 0.95 : 1.25; sl.penumbra = 0.7; } else sl.intensity = 0; }
    // points: the next eight (the downlight above is a spot already)
    var pi = 0; for (i = 0; i < PCAND.length && pi < pl.length; i++) { var fp = PCAND[i]; if (fp === down) continue; var p = pl[pi++]; p.position.copy(fp.p); p.color.setRGB(fp.col[0], fp.col[1], fp.col[2]); p.intensity = fp._pI / 1.7; p.distance = clamp(Math.sqrt(fp._pI / 0.0012), 1.5, 32); p.decay = 2; }
    for (; pi < pl.length; pi++) pl[pi].intensity = 0;
    RL.n.poolMs = 0; return true;
  }
  // at render time (inside the main render, before three gathers the lights): the hemisphere lights carry the bounce at the camera
  // (the only fill left, and it comes from the room's sources), the room's own fill is off, the environment keeps its reflections
  var HSV = { on: false, pos: new THREE.Vector3(), col: new THREE.Color(), gcol: new THREE.Color(), I: 0, fill: null, fillI: 0 };
  function liRenderTime() {
    var R = LI.R; if (!R || !LI.active(R)) { if (HSV.on) liRestore(); return; } var S = LI.S;
    if (!HSV.on) { HSV.on = true; HSV.pos.copy(hemi.position); HSV.col.copy(hemi.color); HSV.gcol.copy(hemi.groundColor); HSV.I = hemi._intensity; HSV.fill = R.fill && R.fill.isHemisphereLight ? R.fill : null; HSV.fillI = HSV.fill ? HSV.fill._intensity : 0; }
    var p = LV.b.copy(camera.position).applyMatrix4(S.Mi), P = liProbe(S, clamp(p.x, S.x0, S.x1), clamp(p.y, S.F + 0.3, S.H - 0.3), clamp(p.z, S.z0, S.z1)); if (!P) return;
    // the L1 bounce as one hemisphere light along its luminance-weighted direction (room frame to world)
    var dx = 0.2126 * P.c1[0][0] + 0.7152 * P.c1[1][0] + 0.0722 * P.c1[2][0], dy = 0.2126 * P.c1[0][1] + 0.7152 * P.c1[1][1] + 0.0722 * P.c1[2][1], dz = 0.2126 * P.c1[0][2] + 0.7152 * P.c1[1][2] + 0.0722 * P.c1[2][2], dl = Math.hypot(dx, dy, dz);
    var d = dl > 1e-6 ? LV.c.set(dx / dl, dy / dl, dz / dl) : LV.c.set(0, 1, 0), hk = LI.hi && ENV.onTex ? 0.45 : 1.0, s = [0, 0, 0], g = [0, 0, 0];
    for (var c = 0; c < 3; c++) { var a = P.c1[c][0] * d.x + P.c1[c][1] * d.y + P.c1[c][2] * d.z; a = clamp(a, -P.c0[c], P.c0[c]); s[c] = Math.max(0, (P.c0[c] + a) * hk * LI.ramp); g[c] = Math.max(0, (P.c0[c] - a) * hk * LI.ramp); }
    d.transformDirection(S.M); hemi.position.copy(d); hemi.color.setRGB(s[0], s[1], s[2]); hemi.groundColor.setRGB(g[0], g[1], g[2]); hemi._intensity = 1 / Math.PI; hemi.updateMatrixWorld();
    if (HSV.fill) HSV.fill._intensity = 0;
    if (!ENV.onTex && !HSV.envSet && !R.liKeepEnv) { HSV.envI = scene.environmentIntensity; scene.environmentIntensity = HSV.envI * 0.15; HSV.envSet = true; }   // the sky's environment (low, medium): its reflections only, a little; put back after the render
    LI.n.probe = [+s[1].toFixed(3), +g[1].toFixed(3)];
  }
  function liAfter() { if (HSV.envSet) { scene.environmentIntensity = HSV.envI; HSV.envSet = false; } }
  function liRestore() { if (!HSV.on) return; HSV.on = false; try { hemi.position.copy(HSV.pos); hemi.color.copy(HSV.col); hemi.groundColor.copy(HSV.gcol); hemi._intensity = HSV.I; hemi.updateMatrixWorld(); if (HSV.fill && HSV.fill._intensity === 0) HSV.fill._intensity = HSV.fillI; } catch (e) {} HSV.fill = null; }
  // for other modules (characters): the bounce at a world point (L1: c0 rgb and the c1 vectors per channel, world frame), the
  // current light level and whether LI lights the current room; the shadow atlas and its matrices are LI.U (tLiSh, uLiShM, ...)
  LI.probeAt = function (p) { var S = LI.S; if (!S || LI.st !== 3) return null; var q = LV.b.copy(p).applyMatrix4(S.Mi), P = liProbe(S, clamp(q.x, S.x0, S.x1), clamp(q.y, S.F + 0.2, S.H - 0.2), clamp(q.z, S.z0, S.z1)); if (!P) return null;
    var o = { c0: P.c0.slice(), c1: [] }; for (var c = 0; c < 3; c++) { var v = new THREE.Vector3(P.c1[c][0], P.c1[c][1], P.c1[c][2]).transformDirection(S.M).multiplyScalar(Math.hypot(P.c1[c][0], P.c1[c][1], P.c1[c][2])); o.c1.push([v.x, v.y, v.z]); } return o; };
  LI.on = function () { return !!(LI.R && LI.st === 3 && RL.part.li); };
  LI.state = function () { var S = LI.S; return { st: LI.st, meter: LI.meter ? LI.meter() : null, room: LI.R && LI.R.id, hi: LI.hi, ready: LI.readyMs, G: +(LK0.G || 0).toPrecision(3), Eavg: Math.round(LK0.Eavg || 0), T: LK0.T, sunLux: Math.round(LK0.sunLux), sunDisp: +(LK0.sunDisp || 0).toFixed(2), fix: S && S.fx.length, kinds: S && S.fx.map(function (f) { return f.kind + ":" + Math.round(f.lm); }).slice(0, 24), ops: S && S.ops.map(function (o) { return [o.w, +o.s0.toFixed(2), +o.s1.toFixed(2), +o.y0.toFixed(2), +o.y1.toFixed(2), o.src, +o.sun.toFixed(2)]; }), alb: S && S.alb, geo: S && [S.x0, S.x1, S.F, S.H, S.z0, S.z1, S.src].map(function (v) { return typeof v === "number" ? +v.toFixed(2) : v; }), cells: S && [S.nx, S.ny, S.nz], patches: S && S.np, sol: S && S.sol.length, keyF: LI.keyF, sh: SH.ok.slice(), shFr: SH.fr.map(function (f) { return FRAME_N - f; }), n: LI.n, probe: LI.n.probe, miss: LIC.miss, csm: LIC.csm }; };

  // ── which objects a room is: its group (the R14 rooms, the client's rooms, the walk-ins), its module's capture root (the domes and
  //    vaults), or the venue's groups (the zones), where only what stands inside the room's box counts ──
  function liRoots(R) { if (!R) return []; if (R.liRoots) return R.liRoots; if (R.g) return [R.g]; if (R.capRoot) return Array.isArray(R.capRoot) ? R.capRoot : [R.capRoot]; return []; }
  var _eb = new THREE.Vector3();
  function liEach(R, S, fn) {
    var roots = liRoots(R), filt = !!R.liFilter, B = S || null;
    for (var i = 0; i < roots.length; i++) { var root = roots[i]; if (!root || !root.traverse) continue; root.updateMatrixWorld(true);
      root.traverse(function (o) { if (!o.isMesh || !o.geometry) return; var q = o; while (q && q !== root) { if (!q.visible) return; q = q.parent; }
        if (filt && B) { var G = o.geometry; if (!G.boundingSphere) G.computeBoundingSphere(); var bs = G.boundingSphere; _eb.copy(bs.center).applyMatrix4(o.matrixWorld).applyMatrix4(R.Mi); var rr = bs.radius * o.matrixWorld.getMaxScaleOnAxis();
          if (rr > 60 || _eb.x < B.x0 - 1.5 - rr || _eb.x > B.x1 + 1.5 + rr || _eb.z < B.z0 - 1.5 - rr || _eb.z > B.z1 + 1.5 + rr || _eb.y > B.H + 2 + rr || _eb.y < B.F - 2 - rr) return; }
        fn(o); }); }
  }
  LI.roots = liRoots;
  // ── the venue rooms of the R17 modules (the dressing's zones: the library reading room, the museum lobby, the Copper rodeo
  //    saloon, the flight academy's lobby, briefing room, classroom and lounge, the spa's lounge and reception): rooms of their own once
  //    the dressing has read them, entered by standing in them (no door, no fade: the open world stays drawn, so the cascaded sun and
  //    the building's own walls light them, and LI adds the fixtures, the openings' sky and the bounce) ──
  var LZ = LI.zones = { rooms: new Map(), ids: { library: 1, museum: 1, rodeo: 1, academy_lobby: 1, academy_brief: 1, academy_class: 1, academy_lounge: 1, spa_lounge: 1, spa_reception: 1 } };
  function zoneRoom(Z) {
    var z = Z.z; if (!z || !LZ.ids[z.id] || Z.st !== 2 || !Z.holder) return null; var R = LZ.rooms.get(z.id); if (R) return R;
    var F = Z.mesh ? Z.mesh.position.y : (z.F !== undefined ? z.F : 0), hit = DR.cache.get("zone:" + z.id), hc = hit && hit.plan && hit.plan.read && hit.plan.read.hc > 1.8 ? hit.plan.read.hc : (z.hgt || 5);
    Z.holder.updateMatrixWorld(true); var roots = []; try { roots = Z.o.roots(); } catch (e) {} if (!roots.length) return null;
    R = new Room({ id: "zone:" + z.id, type: z.type === "club" ? "club" : z.type === "villa" ? "villa" : z.type === "saloon" ? "saloon" : z.type === "hotel" ? "hotel" : "warm", mod: "walk", M: Z.holder.matrixWorld, box: [-z.hx, z.hx, F, F + hc, -z.hz, z.hz], own: true, env: false });
    R.floorY = F; R.liRoots = roots; R.liFilter = true; R.liZone = true; R.drKey = "zone:" + z.id; R.noDoorShaft = true; R.liNoDoor = true;
    try { roots.forEach(function (rt) { RL.glowFix(R, rt, { k: 0.9 }); }); mergeFix(R, 0.9); } catch (e) { note("zone fix " + z.id, e); }
    LZ.rooms.set(z.id, R); return R;
  }
  RL.walk({ id: "li zones", find: function () {
    if (!RL.part.li || !DR.zones || !DR.zones.length) return null; var p = null; try { p = player && player.position; } catch (e) {} if (!p) return null;
    for (var i = 0; i < DR.zones.length; i++) { var Z = DR.zones[i]; if (Z.st !== 2 || !Z.z || !LZ.ids[Z.z.id]) continue; var R = zoneRoom(Z); if (!R) continue;
      var q = LV.a.copy(p).applyMatrix4(R.Mi); if (q.x > R.box[0] + 0.15 && q.x < R.box[1] - 0.15 && q.z > R.box[4] + 0.15 && q.z < R.box[5] - 0.15 && q.y > R.box[2] - 0.6 && q.y < R.box[3]) return R; }
    return null; } });
  // ── a canvas tent: its walls and roof pass daylight (transmission about a fifth, warm-white), in the bake and in its own glow ──
  var CANV = { mats: [], on: false };
  function liCanvasPrep(R, S) { if (!(R.type === "glamp" || R.liCanvas)) return; S.trans = 0.2; S.tr = [1, 0.94, 0.84]; S.canvasMats = [];
    liEach(R, null, function (o) { var m = Array.isArray(o.material) ? o.material[0] : o.material; if (m && m.isMeshStandardMaterial && /canvas/i.test(m.name || "") && S.canvasMats.indexOf(m) < 0) S.canvasMats.push(m); }); }
  function liCanvasFrame(S, k) {
    var M = S.canvasMats; if (!M || !M.length) return; var sdy = S.sd ? Math.max(0, S.sd[1]) : 0, G = k.G;
    // the light the canvas passes, seen from inside: T x (the sky over its outer side, a little ground, the sun on it) / PI
    var L = S.trans * ((0.2126 * k.sky[0] + 0.7152 * k.sky[1] + 0.0722 * k.sky[2]) * 0.7 + (0.2126 * k.gnd[0] + 0.7152 * k.gnd[1] + 0.0722 * k.gnd[2]) * 0.3 + (S.sunUp && S.sunN !== undefined ? k.sunLux * (0.35 + 0.4 * sdy) / Math.PI : 0)) * G;
    L = Math.min(L, 3); for (var i = 0; i < M.length; i++) { var m = M[i]; if (!m.userData.liE) { m.userData.liE = [m.emissive.clone(), m.emissiveIntensity]; CANV.mats.push(m); } m.emissive.setRGB(S.tr[0] * L, S.tr[1] * L, S.tr[2] * L); m.emissiveIntensity = 1; } CANV.on = true;
  }
  function liCanvasEnd() { if (!CANV.on) return; CANV.on = false; for (var i = 0; i < CANV.mats.length; i++) { var m = CANV.mats[i], e = m.userData.liE; if (e) { m.emissive.copy(e[0]); m.emissiveIntensity = e[1]; delete m.userData.liE; } } CANV.mats.length = 0; }
  // a walk-in's room in its model frame (metres): the first room rectangle of its type, its door as the opening on the front wall
  function liWalkIn(R, h) {
    var T = window.PLAN_INTERIORS && PLAN_INTERIORS.TYPES && PLAN_INTERIORS.TYPES[h.kind]; if (!T || !T.rooms || !T.rooms[0] || !h.e) return false; var s = h.s || 1, r = T.rooms[0], e = h.e, M = new THREE.Matrix4().makeRotationY(e[3]); M.setPosition(e[0], e[1], e[2]);
    R.M.copy(M); R.Mi.copy(M).invert(); R.box = [r[0] * s, r[2] * s, r[4] * s, (r[5] || r[4] + 4.5) * s, r[1] * s, r[3] * s]; R.hgt = R.box[3] - R.box[2]; R.floorY = r[4] * s; R.liNoDoor = true;
    var D = T.door; if (D) R.wins = [["x", r[3] * s, D.x0 * s, D.x1 * s, D.y0 * s, (D.y0 + D.h) * s]]; R.liWalkIn = true; return true;
  }
  // the venues' and walk-ins' own glowing things (light strips, lit panels, bare bulbs drawn unlit) become fixtures too: every
  // light the eye sees in the room gives light (their materials are flagged for the glow scan only while it runs)
  function liGlowMore(R, S) {
    if (!R.liFilter) return 0; var mats = [], n0 = R.fix.length;
    if (!R.liZone) { try { liRoots(R).forEach(function (rt) { RL.glowFix(R, rt, { k: 0.9 }); }); mergeFix(R, 0.9); } catch (e) { note("li glow std", e); } }   // the walk-ins and domes had only their module's lights
    liEach(R, S, function (o) { var m = Array.isArray(o.material) ? o.material[0] : o.material; if (!m || m.userData.rlGlow !== undefined || mats.indexOf(m) >= 0) return; mats.push(m); m.userData.rlGlow = 0; var nm = m.name || ""; if (m.transparent || /sign|screen|vista|sky|glass|water|shaft|label|text|logo|menu|map|board|poster|photo|art/i.test(nm)) return;
      var k = 0; if (m.isMeshBasicMaterial && !m.vertexColors && !m.map) { var c = m.color, l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; if (l > 0.55) k = Math.min(1.2, l); }
      else if (m.isMeshStandardMaterial && m.emissive) { var e = Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * m.emissiveIntensity; if (m.emissiveMap ? e > 0.9 : e > 0.45 && e <= 0.75) k = Math.min(1.4, e / 1.2); }
      if (k > 0) m.userData.rlGlow = k; });
    try { liRoots(R).forEach(function (rt) { RL.glowFix(R, rt, { k: 0.8, max: 30 }); }); mergeFix(R, 0.9); } catch (e) { note("li glow", e); }
    for (var i = 0; i < mats.length; i++) delete mats[i].userData.rlGlow; return R.fix.length - n0;
  }
  // the eye's adaptation, measured: the frame as drawn (the scene target, before the exposure) is metered on a 48 x 27 grid of
  // log luminance a few times a second (an asynchronous read, no stall), its windows and lamps let go (the brightest fifth and
  // the black floor of the histogram dropped), centre weighted. The camera's exposure then opens until the room reads at a
  // photographer's interior key, a little short of it (dark rooms stay darker than bright ones) and never past a few stops: the
  // windows go bright and the room stays readable, as an eye adapted to an interior sees it. Every light is still the sources'
  // own; only the camera changes. ?rlm=0: off (the modelled adaptation alone).
  var MT = LI.mt = { on: !qOff("rlm"), C: 1, Ct: 1, snap: true, busy: false, at: 0, n: 0, Lm: 0, rt: null, mat: null, qs: null, qc: null, buf: null, warmed: false, base: 0, frames: 0, err: 0 };
  var MW = 48, MH = 27;
  function mtMake() {
    if (MT.rt) return true; if (typeof renderer === "undefined" || !renderer || typeof POST === "undefined" || !POST) return false;
    MT.rt = new THREE.WebGLRenderTarget(MW, MH, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
    MT.mat = new THREE.ShaderMaterial({ uniforms: { tCol: { value: null }, uCell: { value: new THREE.Vector2(1 / MW, 1 / MH) } }, depthTest: false, depthWrite: false,
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }",
      fragmentShader: "uniform sampler2D tCol; uniform vec2 uCell; varying vec2 vUv;\n" +
        "float lg( vec2 p ) { vec3 c = texture2D( tCol, p ).rgb; float l = dot( max( c, vec3( 0.0 ) ), vec3( 0.2126, 0.7152, 0.0722 ) ); return log2( max( l, 1e-5 ) ); }\n" +
        "void main() { vec2 o = uCell * 0.25; float s = lg( vUv + vec2( -o.x, -o.y ) ) + lg( vUv + vec2( o.x, -o.y ) ) + lg( vUv + vec2( -o.x, o.y ) ) + lg( vUv + vec2( o.x, o.y ) );\n" +
        "  gl_FragColor = vec4( clamp( ( s * 0.25 + 14.0 ) / 18.0, 0.0, 1.0 ), 0.0, 0.0, 1.0 ); }" });
    var q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), MT.mat); q.frustumCulled = false; MT.qs = new THREE.Scene(); MT.qs.add(q); MT.qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); MT.buf = new Uint8Array(MW * MH * 4);
    MT.wt = new Float32Array(MW * MH); for (var y = 0; y < MH; y++) for (var x = 0; x < MW; x++) { var u = (x + 0.5) / MW - 0.5, v = (y + 0.5) / MH - 0.52; MT.wt[y * MW + x] = 0.35 + Math.exp(-(u * u * 5 + v * v * 7)); }
    MT.ix = new Array(MW * MH); for (var i = 0; i < MW * MH; i++) MT.ix[i] = i; MT.lv = new Float32Array(MW * MH); return true;
  }
  function mtDraw() {
    var prevT = renderer.getRenderTarget(), at = renderer.autoClear; MT.mat.uniforms.tCol.value = POST.rt.texture; renderer.autoClear = true; renderer.setRenderTarget(MT.rt); renderer.render(MT.qs, MT.qc); renderer.setRenderTarget(prevT); renderer.autoClear = at;
  }
  // the histogram: the windows, lamps and blacks let go, the rest centre weighted
  function mtRead(buf) {
    var N = MW * MH, lv = MT.lv, ix = MT.ix, wt = MT.wt, W = 0; for (var i = 0; i < N; i++) { lv[i] = buf[i * 4] / 255 * 18 - 14; W += wt[i]; }
    ix.sort(function (a, b) { return lv[a] - lv[b]; }); var acc = 0, s = 0, sw = 0; for (var j = 0; j < N; j++) { var k = ix[j], w = wt[k], a0 = acc / W; acc += w; var a1 = acc / W; if (a1 < 0.06 || a0 > 0.8) continue; s += w * lv[k]; sw += w; }
    return sw > 0 ? Math.pow(2, s / sw) : 0;
  }
  // the target: the scene's metered level times the exposure lands at the interior key, three quarters of the way by day, half at night
  function mtTarget(Lm) {
    var e = MT.base || 1, dk = sstep(0.05, 0.6, daylight()), key = 0.1 + 0.05 * dk, pk = 0.5 + 0.25 * dk, cmax = 1.8 + 2.0 * dk;
    if (!(Lm > 0)) return 1; return clamp(Math.pow(key / (Lm * e), pk), 0.85, cmax);
  }
  // every frame: the boot draws the meter once (its program made before any room); in a lit room a read every eighth frame
  function liMeter(R, dt) {
    if (!MT.on || typeof POST === "undefined" || !POST || !POST.rt || !POST.on) { MT.C = 1; return; }
    if (!MT.warmed) { if (FRAME_N > 30 && mtMake()) { try { mtDraw(); } catch (e) { MT.on = false; note("li meter", e); } MT.warmed = true; } return; }
    var on = R && LI.active(R) && LI.ramp > 0.2; if (!on) { MT.C = 1; MT.Ct = 1; MT.snap = true; MT.frames = 0; return; }
    MT.frames++; if (!MT.busy && (MT.frames % 8) === 1) {
      try { mtDraw(); var ra = renderer.readRenderTargetPixelsAsync; MT.busy = true;
        if (typeof ra === "function") { ra.call(renderer, MT.rt, 0, 0, MW, MH, MT.buf).then(function () { MT.busy = false; if (!LI.active(CUR.R)) return; MT.Lm = mtRead(MT.buf); MT.Ct = mtTarget(MT.Lm); MT.n++; if (MT.snap) { MT.C = MT.Ct; MT.snap = false; } }, function () { MT.busy = false; MT.err++; }); }
        else { renderer.readRenderTargetPixels(MT.rt, 0, 0, MW, MH, MT.buf); MT.busy = false; MT.Lm = mtRead(MT.buf); MT.Ct = mtTarget(MT.Lm); MT.n++; if (MT.snap) { MT.C = MT.Ct; MT.snap = false; } }
      } catch (e) { MT.busy = false; if (++MT.err > 10) MT.on = false; note("li meter", e); } }
    // the eye opens slowly and closes faster (about a second toward a darker room, half a second toward a brighter one)
    var r = MT.Ct > MT.C ? 1.1 : 2.2; MT.C += (MT.Ct - MT.C) * Math.min(1, (dt || 0.016) * r);
  }
  LI.meter = function () { return { on: MT.on, C: +MT.C.toFixed(3), Ct: +MT.Ct.toFixed(3), Lm: +(MT.Lm || 0).toPrecision(3), base: +(MT.base || 0).toPrecision(3), n: MT.n, err: MT.err, async: typeof renderer !== "undefined" && typeof renderer.readRenderTargetPixelsAsync === "function" }; };

  // ───────────────────────── the frame ─────────────────────────
  function enterRoom(R) { CUR.R = R; CUR.at = performance.now(); POOLX.snap = true; R.stamp++; if (!R.ready) { R.ready = true; } try { if (RL.atmoBegin) RL.atmoBegin(R); } catch (e) { note("atmo begin", e); } envBegin(R); try { floorBegin(R); } catch (e) { note("floor begin", e); } }
  function leaveRoom(R) { try { LI.end(); ENV.deferR = null; } catch (e) { note("li end", e); } try { if (RL.atmoEnd) RL.atmoEnd(R); } catch (e) { note("atmo end", e); } floorEnd(); fillEnd(); envRestore(); if (ENV.job) { envJobEnd(ENV.job); ENV.job = null; } ENV.active = null; CUR.R = null; }
  function resolve() {
    if (!RL.on) return null; var R = insideRoom(); if (R) return R;
    try { if (typeof inside !== "undefined" && inside) return null; } catch (e) {}
    for (var i = 0; i < WALK.length; i++) { var w = WALK[i]; try { if (w.o.find) { var Rf = w.o.find(RL); if (Rf) return Rf; continue; } if (!w.R && w.o.make) { var now = performance.now(); if (now - w.at < 1500) continue; w.at = now; w.R = w.o.make(RL); if (!w.R) continue; } if (w.R && w.o.test && w.o.test(w.R)) return w.R; } catch (e) { note("walk " + (w.o.id || i), e); w.o.test = null; } }
    return null;
  }
  var BUSY = false;
  function frame(dt, now) { if (BUSY) return; BUSY = true; try { frame0(dt, now); } finally { BUSY = false; } }
  function frame0(dt, now) {
    if (!RL.on) return; RL.n.frames++; if (window.PLAN_RLQ.length) drainQ(); if (!POOLX.wrapped) installPool();
    var R = null; try { R = resolve(); } catch (e) { note("resolve", e); }
    if (R !== CUR.R) { if (CUR.R) leaveRoom(CUR.R); if (R) enterRoom(R); }
    if (R && LI.R && !RL.part.li) { try { LI.end(); } catch (e) {} }
    var liOn = R && LI.active(R); if (liOn) { try { fillEnd(); } catch (e) {} }
    if (R && !liOn) { try { fillFrame(R); } catch (e) { note("fill", e); } try { var sk = lookR(R).sky * (R.k && R.k.sky !== undefined ? R.k.sky : 1); if (sk !== 1 && typeof hemi !== "undefined" && hemi && hemi._intensity !== undefined) hemi._intensity *= sk; } catch (e) {}   /* the stored value (the client reports it x PI) */ try { envStep(); envFrame(R); } catch (e) { note("env", e); } try { if (RL.atmoFrame) RL.atmoFrame(R, dt, now); } catch (e) { note("atmo", e); } }
    if (RL.part.li) { try { liMeter(R, dt); } catch (e) { note("li meter", e); } }
    if (R && RL.part.li) { try { LI.frame(R, dt, now); } catch (e) { note("li frame", e); if (++LI.errs > 20) { R.liFail = true; LI.end(); } } try { if (liOn) { envStep(); envFrame(R); if (RL.atmoFrame) RL.atmoFrame(R, dt, now); } } catch (e) { note("li env", e); } }
    if (RL.r16) { try { surfFrame(R); if (SURF.Q.length) surfIdle(now); } catch (e) { note("surf", e); } }
    if (RL.part.prop && RL.part.surf && (RL.n.xT === undefined || (now - RL.n.xT > 5000 && now - (RL.n.x0 || now) < 90000))) { if (RL.n.x0 === undefined) RL.n.x0 = now; RL.n.xT = now; try { var xt = performance.now(); RL.xScan(); RL.n.xMs = Math.max(RL.n.xMs || 0, performance.now() - xt); } catch (e) { note("xscan", e); } }
    try { if (WAT.on) WAT.frame(dt, now); } catch (e) { note("water", e); }
    if (RL.part.dress !== DR.applied) { DR.applied = RL.part.dress; try { DR.apply(RL.part.dress); } catch (e) { note("dress apply", e); } } try { if (DR.on) { if (DR.pend) DR.pendTick(); else if (RL.n.frames & 1) DR.zoneTick(now); } } catch (e) { note("dress zones", e); }
    gradeFrame(R, dt);
  }
  function unhook(phase, name) { var a = window.PLAN_HOOKS[phase]; if (!a) return; for (var i = a.length - 1; i >= 0; i--) if (a[i] && a[i].name === name) a.splice(i, 1); }
  RL.uninstall = function () { try { if (CUR.R) leaveRoom(CUR.R); } catch (e) {} try { WAT.list.forEach(function (o) { var w = o.userData.rlW; if (!w) return; if (w.orig) o.material = w.orig; if (w.shell && w.shell.parent) w.shell.parent.remove(w.shell); delete o.userData.rlW; }); unhook("defer", "planRoomLightWater"); } catch (e) {} gradeEnd(); try { RL.envDrop(); } catch (e) {} if (POOLX.wrapped && POOLX.orig) { if (updateLightPool && updateLightPool.__rlWrap) updateLightPool = window.updateLightPool = POOLX.orig; POOLX.wrapped = false; } unhook("frame", "planRoomLight"); unhook("world", "planRoomLightInstall");
    try { if (RL.atmoDrop) RL.atmoDrop(); } catch (e) {} try { if (typeof inside !== "undefined" && inside && inside.g) { inside.g.userData.rlRoom = null; inside.g.userData.rlTried = 0; } } catch (e) {} };
  if (PREV && window.__rlqAll) for (var qi = 0; qi < window.__rlqAll.length; qi++) window.PLAN_RLQ.push(window.__rlqAll[qi]);
  window.__rlqAll = [];
  if (RL.on) {
    window.PLAN_HOOKS.frame.push({ name: "planRoomLight", fn: frame });
    window.PLAN_HOOKS.defer.push({ name: "planRoomLightWater", fn: function () { try { if (WAT.on) WAT.scan(); } catch (e) { note("water defer", e); } } });
    window.PLAN_HOOKS.world.push({ name: "planRoomLightInstall", fn: function () { RL.tierPick(); installPool(); try { if (RL.part.li) shInstall(); } catch (e) { note("li install", e); } drainQ(); RL.envPrep(); try { RL.kitWarm(); } catch (e) { note("kit warm", e); } if (WAT.on) { try { waterMat(); WAT.wrapMakeProp(); } catch (e) { note("water init", e); } } if (DR.on) { try { dressMat(); } catch (e) { note("dress init", e); } } if (RL.part.surf) { for (var dk in DK) detTex(dk); propTex(); }
      window.PLAN_HOOKS.world.push({ name: "planRoomLightX", fn: function () { try { RL.xScan(); } catch (e) { note("xscan", e); } } }); } });   // runs after every module's world hook (the list is read live)
  }
  if (PREV && RL.on) { try { if (typeof scene !== "undefined" && scene && typeof renderer !== "undefined") { RL.tierPick(); installPool(); drainQ(); RL.envPrep(); RL.kitWarm(); if (RL.part.surf) { for (var dk2 in DK) detTex(dk2); propTex(); } } } catch (e) { note("hot install", e); } }
  RL.state = function () { var R = CUR.R; return { li: LI.state ? LI.state() : null, room: R && R.id, type: R && R.type, fix: R && R.fix.length, slots: SP.map(function (s) { return s.c ? +(s.k).toFixed(2) : 0; }), spots: SS.map(function (s) { return s.c ? +(s.k).toFixed(2) : 0; }), env: !!(ENV.active && ENV.active.R === R), cache: ENV.cache.size, n: RL.n, part: RL.part, errs: RL.errs.length }; };
})();
