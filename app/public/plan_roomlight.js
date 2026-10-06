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
  RL.v = "r18i2-1"; RL.errs = []; RL.n = { rooms: 0, auto: 0, fix: 0, caps: 0, capMs: 0, capMax: 0, envHit: 0, envMiss: 0, envEvict: 0, bakes: 0, bakeMs: 0, shafts: 0, frames: 0, poolMs: 0 };
  RL.on = !/[?&]rl=0\b/.test(QS);
  function qOn(k) { return new RegExp("[?&]" + k + "=1(?![0-9])").test(QS); }
  function qOff(k) { return new RegExp("[?&]" + k + "=0\\b").test(QS); }
  // R16 (Agent I, HANDOFF_R16_INTERIORS.md): ?ri=0 is R15 exactly (the kit's own shaders as before, the capture off by default, no
  // surface pass). The room capture is on by default on high and ultra (decided at the world hook, when the tier is known; ?rle=0 off,
  // ?rle=1 on every tier); ?ris=0 the surface pass alone.
  RL.r16 = RL.on && !qOff("ri");
  RL.part = { pool: RL.on && !qOff("rlp"), env: RL.on && qOn("rle"), floor: RL.on && !qOff("rlf"), bake: RL.on && !qOff("rlb"), atmo: RL.on && !qOff("rla"), grade: RL.on && !qOff("rlg"), surf: RL.r16 && !qOff("ris"), prop: RL.r16 && !qOff("rip") };
  function hiTier() { try { return typeof QUAL !== "undefined" && (QUAL.level === "ultra" || QUAL.level === "high"); } catch (e) { return false; } }
  RL.tierPick = function () { if (RL.tierDone) return; RL.tierDone = true; RL.hi = hiTier(); try { RL.lite = QUAL.level !== "ultra"; } catch (e) { RL.lite = true; } if (RL.r16 && !qOff("rle") && !qOn("rle") && RL.hi) RL.part.env = RL.on; if (!RL.hi) { RL.part.surf = false; RL.part.prop = false; } };
  RL.set = function (o) { for (var k in o) if (k in RL.part) RL.part[k] = !!o[k] && RL.on; RL.dirty = true; return RL.part; };
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
    var kind = ins.door && ins.door.kind; if (SKIP[kind]) return null;
    try { R = autoRoom(ins); } catch (e) { note("auto room " + kind, e); R = null; } if (R) g.userData.rlRoom = R; return R;
  }
  // a room the client built (a generic room, or a walk-in that set `inside`) and no module described
  function autoRoom(ins) {
    var g = ins.g, kind = ins.door && ins.door.kind, half = ins.half || 5, hgt = 4.4;
    try { var th = typeof THEME !== "undefined" && THEME[kind]; if (th && th.hgt) hgt = th.hgt; } catch (e) {}
    var type = /saloon/.test(kind) ? "saloon" : /hotel/.test(kind) ? "hotel" : kind === "diner" ? "diner" : kind === "bank" ? "bank" : kind === "chapel" ? "chapel" : kind === "barn" ? "barn" : kind === "gallery" || kind === "artpav" ? "gallery"
      : kind === "villa" ? "villa" : kind === "ranch" ? "ranch" : kind === "lakehouse" ? "lodge" : kind === "glamp" ? "glamp" : /clubhouse|restaurant/.test(kind) ? "club" : /hangar/.test(kind) ? "hangar" : kind === "dome" ? "dome" : "cozy";
    var box = [-half, half, 0, hgt, -half, half], lamp = null, fill = null; for (var i = 0; i < g.children.length; i++) { var o = g.children[i]; if (o.isPointLight && !lamp) lamp = o; else if (o.isHemisphereLight && !fill) fill = o; }
    if (ins.int3 || ins.hgr) { // a walk-in interior: its own frame is the building's; measure the room from its meshes
      try { var bb = new THREE.Box3(); g.updateMatrixWorld(true); var inv = new THREE.Matrix4().copy(g.matrixWorld).invert(); g.traverse(function (o) { var gs = o.isMesh && o.geometry && !o.isSkinnedMesh ? (o.geometry.boundingBox || o.geometry.boundingSphere) : null; if (!gs) return;   // the bounds three already has (no vertex pass on a 700k triangle walk-in)
          if (gs.isBox3) _bb.copy(gs); else { _bb.min.copy(gs.center).subScalar(gs.radius); _bb.max.copy(gs.center).addScalar(gs.radius); } _bb.applyMatrix4(_m4.multiplyMatrices(inv, o.matrixWorld)); if (_bb.max.x - _bb.min.x < 60 && _bb.max.z - _bb.min.z < 60) bb.union(_bb); });
        if (!bb.isEmpty()) box = [bb.min.x, bb.max.x, Math.max(bb.min.y, -0.5), Math.min(bb.max.y, 14), bb.min.z, bb.max.z]; } catch (e) { note("walk-in box", e); }
      type = ins.hgr ? "hangar" : (ins.int3 && ins.int3.kind === "hangarhome2") || kind === "hangarhome2" ? "hangar" : "club"; }
    var R = new Room({ id: "auto:" + kind + ":" + (ins.door ? ins.door.i : 0), type: type, mod: ins.int3 || ins.hgr ? "walk" : "auto", g: g, box: box, lamp: lamp, fill: fill, own: true, env: !(ins.int3 || ins.hgr) }); if (!(ins.int3 || ins.hgr)) R.genericWins = !/hangar/.test(kind); else R.noDoorShaft = true;   // walk-ins are entered without a fade and carry up to 0.7 M triangles: no capture (a hangar's materials carry their own probe)
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
  function envKeyOf(R) { return R.envKey + ":" + (nightK() > 0.5 ? "n" : "d"); }
  function lightsOnLayer(L) { var a = []; try { a.push(hemi, sun, moon); } catch (e) {} try { var P = window.PLAN_PERF; if (P) a.push(P.hemi, P.hemi2); } catch (e) {} try { LIGHTS.pool.forEach(function (l) { a.push(l); }); LIGHTS.spool.forEach(function (l) { a.push(l); }); } catch (e) {} try { if (CSMX.csm) CSMX.csm.lights.forEach(function (l) { a.push(l); }); } catch (e) {}
    for (var i = 0; i < a.length; i++) if (a[i] && a[i].layers) a[i].layers.enable(L); }
  function envBegin(R) {
    if (!RL.part.env || !R.env || !R.capRoot || typeof pmrem === "undefined" || !pmrem || typeof renderer === "undefined") return;
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
    var ei = scene.environmentIntensity; if (ENV.setI < 0 || Math.abs(ei - ENV.setI) > 1e-6) { var sk = window.PLAN_ROOMS && PLAN_ROOMS.sky; ENV.skyI = sk && sk.on && Math.abs(ei - sk.set) < 1e-6 ? sk.base : ei; } var Lk = lookR(R); ENV.setI = Lk.env * (R.k && R.k.env || 1) * (1 + 0.6 * nightK()); scene.environmentIntensity = ENV.setI;
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
    ATMO.mat.uniforms.uK.value = R.noShaft ? 0 : 0.085 * day * Lk.shaft * (1 + 0.6 * gold); ATMO.mat.uniforms.uT.value = now / 1000;
    ATMO.dmat.uniforms.uCol.value.copy(col); ATMO.dmat.uniforms.uK.value = R.noDust ? 0 : 0.85 * day * Lk.dust; ATMO.dmat.uniforms.uT.value = now / 1000; try { ATMO.dmat.uniforms.uPx.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360)); } catch (e) {}
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
    try { if (typeof POST !== "undefined" && POST.exposure > 0) POST.exposure *= 1 + (Lk.ex * (1 + 0.2 * nightK()) - 1) * k; } catch (e) {}   // the client drops the exposure at night for the sky; a lit room keeps most of it
    try { var F = POST && POST.mFinal && POST.mFinal.uniforms; if (!F || !F.uGSat) return; GRD.on = true;
      for (var i = 0; i < GKEYS.length; i++) { var n = GKEYS[i], u = F[n]; if (!u) continue; var v = u.value; if (GRD.set[n] === undefined || Math.abs(v - GRD.set[n]) > 1e-6) GRD.base[n] = v; var m = n === "uGCon" ? Lk.con : Lk.sat; GRD.set[n] = GRD.base[n] * (1 + (m - 1) * k); u.value = GRD.set[n]; }
      var wb = F.uGWB && F.uGWB.value; if (wb) { if (!GRD.wbSet || !wb.equals(GRD.wbSet)) { GRD.wbBase = (GRD.wbBase || new THREE.Vector3()).copy(wb); } wb.set(GRD.wbBase.x * (1 + (Lk.wb[0] - 1) * k), GRD.wbBase.y * (1 + (Lk.wb[1] - 1) * k), GRD.wbBase.z * (1 + (Lk.wb[2] - 1) * k)); GRD.wbSet = (GRD.wbSet || new THREE.Vector3()).copy(wb); }
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
    var B0 = "return PI * envMapColor.rgb * envMapIntensity;"; if (env.indexOf(B0) >= 0) env = env.replace(B0, "return PI * envMapColor.rgb * mix( envMapIntensity, uRiOn.z, uRiOn.y );"); else miss++;
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
    SURF.n.miss = miss; PATCH = { nfm: nfm, env: env, pars: PARS, det: DET + "\n" + PROP, ok: miss === 0, lite: lite }; return PATCH;
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
    sh.fragmentShader = fs.replace("#include <common>", "#include <common>\n" + P.pars.replace("RI_VARY", vary)).replace("#include <envmap_physical_pars_fragment>", P.env).replace("#include <normal_fragment_maps>", P.nfm + "\n" + P.det);
  }
  function surfKey() { var p = this.userData.riPrevKey ? this.userData.riPrevKey.call(this) : ""; return p + (RL.lite ? "|ri18p1h" : "|ri18p1"); }
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

  // ───────────────────────── the frame ─────────────────────────
  function enterRoom(R) { CUR.R = R; CUR.at = performance.now(); POOLX.snap = true; R.stamp++; if (!R.ready) { R.ready = true; } try { if (RL.atmoBegin) RL.atmoBegin(R); } catch (e) { note("atmo begin", e); } envBegin(R); try { floorBegin(R); } catch (e) { note("floor begin", e); } }
  function leaveRoom(R) { try { if (RL.atmoEnd) RL.atmoEnd(R); } catch (e) { note("atmo end", e); } floorEnd(); fillEnd(); envRestore(); if (ENV.job) { envJobEnd(ENV.job); ENV.job = null; } ENV.active = null; CUR.R = null; }
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
    if (R) { try { fillFrame(R); } catch (e) { note("fill", e); } try { var sk = lookR(R).sky * (R.k && R.k.sky !== undefined ? R.k.sky : 1); if (sk !== 1 && typeof hemi !== "undefined" && hemi && hemi._intensity !== undefined) hemi._intensity *= sk; } catch (e) {}   /* the stored value (the client reports it x PI) */ try { envStep(); envFrame(R); } catch (e) { note("env", e); } try { if (RL.atmoFrame) RL.atmoFrame(R, dt, now); } catch (e) { note("atmo", e); } }
    if (RL.r16) { try { surfFrame(R); if (SURF.Q.length) surfIdle(now); } catch (e) { note("surf", e); } }
    if (RL.part.prop && RL.part.surf && (RL.n.xT === undefined || (now - RL.n.xT > 5000 && now - (RL.n.x0 || now) < 90000))) { if (RL.n.x0 === undefined) RL.n.x0 = now; RL.n.xT = now; try { var xt = performance.now(); RL.xScan(); RL.n.xMs = Math.max(RL.n.xMs || 0, performance.now() - xt); } catch (e) { note("xscan", e); } }
    gradeFrame(R, dt);
  }
  function unhook(phase, name) { var a = window.PLAN_HOOKS[phase]; if (!a) return; for (var i = a.length - 1; i >= 0; i--) if (a[i] && a[i].name === name) a.splice(i, 1); }
  RL.uninstall = function () { try { if (CUR.R) leaveRoom(CUR.R); } catch (e) {} gradeEnd(); try { RL.envDrop(); } catch (e) {} if (POOLX.wrapped && POOLX.orig) { if (updateLightPool && updateLightPool.__rlWrap) updateLightPool = window.updateLightPool = POOLX.orig; POOLX.wrapped = false; } unhook("frame", "planRoomLight"); unhook("world", "planRoomLightInstall");
    try { if (RL.atmoDrop) RL.atmoDrop(); } catch (e) {} try { if (typeof inside !== "undefined" && inside && inside.g) { inside.g.userData.rlRoom = null; inside.g.userData.rlTried = 0; } } catch (e) {} };
  if (PREV && window.__rlqAll) for (var qi = 0; qi < window.__rlqAll.length; qi++) window.PLAN_RLQ.push(window.__rlqAll[qi]);
  window.__rlqAll = [];
  if (RL.on) {
    window.PLAN_HOOKS.frame.push({ name: "planRoomLight", fn: frame });
    window.PLAN_HOOKS.world.push({ name: "planRoomLightInstall", fn: function () { RL.tierPick(); installPool(); drainQ(); RL.envPrep(); try { RL.kitWarm(); } catch (e) { note("kit warm", e); } if (RL.part.surf) { for (var dk in DK) detTex(dk); propTex(); }
      window.PLAN_HOOKS.world.push({ name: "planRoomLightX", fn: function () { try { RL.xScan(); } catch (e) { note("xscan", e); } } }); } });   // runs after every module's world hook (the list is read live)
  }
  if (PREV && RL.on) { try { if (typeof scene !== "undefined" && scene && typeof renderer !== "undefined") { RL.tierPick(); installPool(); drainQ(); RL.envPrep(); RL.kitWarm(); if (RL.part.surf) { for (var dk2 in DK) detTex(dk2); propTex(); } } } catch (e) { note("hot install", e); } }
  RL.state = function () { var R = CUR.R; return { room: R && R.id, type: R && R.type, fix: R && R.fix.length, slots: SP.map(function (s) { return s.c ? +(s.k).toFixed(2) : 0; }), spots: SS.map(function (s) { return s.c ? +(s.k).toFixed(2) : 0; }), env: !!(ENV.active && ENV.active.R === R), cache: ENV.cache.size, n: RL.n, part: RL.part, errs: RL.errs.length }; };
})();
