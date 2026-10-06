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
  RL.v = "r15g-1"; RL.errs = []; RL.n = { rooms: 0, auto: 0, fix: 0, caps: 0, capMs: 0, capMax: 0, envHit: 0, envMiss: 0, envEvict: 0, bakes: 0, bakeMs: 0, shafts: 0, frames: 0, poolMs: 0 };
  RL.on = !/[?&]rl=0\b/.test(QS);
  function qOn(k) { return new RegExp("[?&]" + k + "=1(?![0-9])").test(QS); }
  function qOff(k) { return new RegExp("[?&]" + k + "=0\\b").test(QS); }
  RL.part = { pool: RL.on && !qOff("rlp"), env: RL.on && qOn("rle"), floor: RL.on && !qOff("rlf"), bake: RL.on && !qOff("rlb"), atmo: RL.on && !qOff("rla"), grade: RL.on && !qOff("rlg") };
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
    shops:  { fill: 0.55, lamp: 0.3, fix: 1.9, env: 0.62, sky: 0.7, win: 1.0 },
    venues: { fill: 1.0, lamp: 0.85, fix: 1.25, env: 0.8, sky: 0.9, win: 0.7 },   // their materials carry an indoor ao map (0.36 of the indirect light) and a baked fixture light
    homes:  { fill: 0.65, lamp: 0.5, fix: 1.7, env: 0.7, sky: 0.75, win: 1.0 },
    auto:   { fill: 0.55, lamp: 0.5, fix: 1.6, env: 0.65, sky: 0.75, win: 1.0 },
    walk:   { fill: 1.0, lamp: 1.0, fix: 1.0, env: 0.65, sky: 1.0, win: 0 }
  };
  var GBASE = { ex: 1.04, con: 1.05, sat: 1.03, wb: [1.02, 1.0, 0.97], cool: 0.3, shaft: 1.0, dust: 1.0, day: 0.85, refl: 0.2, fill: 1, lamp: 1, fix: 1, env: 1, sky: 1, win: 1 };
  var T = RL.T = {
    base:     {},
    saloon:   { ex: 1.04, con: 1.08, sat: 1.0, wb: [1.03, 1.0, 0.96], fill: 1.0, fix: 1.1, env: 0.6, refl: 0.2, shaft: 1.15, dust: 1.3, day: 0.95 },
    tavern:   { refl: 0.2, ex: 1.0, con: 1.08, sat: 1.05, wb: [1.05, 0.99, 0.93], fill: 0.9, fix: 1.1, win: 0.85, shaft: 1.1, dust: 1.2, day: 0.95 },
    hotel:    { refl: 0.42, ex: 1.03, con: 1.06, sat: 1.03, wb: [1.03, 1.0, 0.95], shaft: 0.95, dust: 0.8 },
    diner:    { refl: 0.59, ex: 1.04, con: 1.08, sat: 1.07, wb: [1.0, 1.0, 1.01], fill: 1.1, lamp: 1.2, fix: 0.95, env: 1.2, sky: 1.1, win: 1.2, cool: 0.4, shaft: 0.75, dust: 0.5, day: 0.8 },
    crisp:    { refl: 0.56, ex: 1.04, con: 1.07, sat: 1.05, wb: [1.01, 1.0, 0.99], fill: 1.05, env: 1.15, sky: 1.05, win: 1.1, cool: 0.4, shaft: 0.85, dust: 0.6 },
    bank:     { refl: 0.53, ex: 1.03, con: 1.06, sat: 1.0, wb: [1.03, 1.0, 0.96], env: 1.1, shaft: 1.0, dust: 0.9 },
    chapel:   { refl: 0.17, ex: 1.06, con: 1.08, sat: 1.04, wb: [1.04, 0.99, 0.93], fill: 1.35, fix: 1.25, sky: 0.95, win: 0.8, shaft: 1.5, dust: 1.6, day: 1.0 },
    barn:     { refl: 0, ex: 1.02, con: 1.07, sat: 1.04, wb: [1.05, 0.99, 0.92], fix: 1.1, env: 0.8, shaft: 1.35, dust: 1.6, day: 0.9 },
    gallery:  { refl: 0.45, ex: 1.04, con: 1.04, sat: 0.97, wb: [0.995, 1.0, 1.01], fill: 1.15, lamp: 1.2, fix: 0.9, env: 1.1, sky: 1.15, win: 1.1, cool: 0.45, shaft: 0.6, dust: 0.4, day: 0.95 },
    warm:     { refl: 0.22, ex: 1.02, con: 1.07, sat: 1.04, wb: [1.04, 0.99, 0.94], fill: 0.95, fix: 1.05, win: 0.9, shaft: 1.1, dust: 1.2, day: 0.9 },
    cozy:     { ex: 1.03, con: 1.06, sat: 1.03, wb: [1.03, 1.0, 0.95], shaft: 1.0, dust: 0.9 },
    brand:    { refl: 0.42, ex: 1.04, con: 1.07, sat: 1.04, wb: [0.99, 1.01, 0.99], env: 1.1, cool: 0.4, shaft: 0.85, dust: 0.6, day: 0.9 },
    villa:    { refl: 0.45, ex: 1.0, con: 1.08, sat: 1.03, wb: [1.03, 1.0, 0.96], fill: 0.85, fix: 1.1, sky: 0.85, win: 1.1, cool: 0.45, shaft: 1.0, dust: 0.7, day: 0.75 },
    ranch:    { refl: 0.2, ex: 1.02, con: 1.07, sat: 1.04, wb: [1.04, 0.99, 0.94], shaft: 1.15, dust: 1.1 },
    lodge:    { refl: 0.22, ex: 1.03, con: 1.07, sat: 1.0, wb: [1.03, 0.995, 0.95], fill: 1.05, fix: 1.05, win: 0.9, shaft: 1.25, dust: 1.2, day: 0.9 },
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
  var LKEYS = ["fill", "lamp", "fix", "env", "sky", "win"];
  // the R14 shops' trades to a look
  var TRADE = { soda: "crisp", candy: "crisp", coffee: "cozy", bakery: "cozy", diner: "diner", tavern: "tavern", gift: "cozy", outfit: "cozy", giveback: "brand", hats: "warm", leather: "warm", smithy: "warm",
    hardware: "warm", mercantile: "warm", garden: "cozy", toys: "cozy", gallery: "gallery", photo: "gallery", bikes: "crisp", records: "warm", barber: "crisp", makers: "warm", books: "warm", apothecary: "warm",
    office: "warm", sheriff: "warm", museum: "warm", market: "cozy", restroom: "crisp", stall: "brand" };
  var LC = {};
  function look(type, mod) { var key = type + "|" + (mod || "auto"), o = LC[key]; if (o && o._v === RL.lv) return o; var t = T[type] || T.base, m = MOD[mod] || MOD.auto; o = {}; for (var k in t) o[k] = t[k]; for (var i = 0; i < LKEYS.length; i++) o[LKEYS[i]] = (t[LKEYS[i]] === undefined ? 1 : t[LKEYS[i]]) * m[LKEYS[i]]; o._v = RL.lv; LC[key] = o; return o; }
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
    RL.n.envMiss++; ENV.job = { R: R, key: key, face: 0, t: 0, nt: nightK(), meshes: null }; try { ENV.max = typeof QUAL !== "undefined" && (QUAL.level === "low" || QUAL.level === "medium") ? 2 : 4; } catch (e) {}   // 6 MB a room on the GPU; fewer kept on the lower tiers
  }
  // the capture, two faces a frame (behind the door's fade), then the pre-filter on the next frame
  function envStep() {
    var J = ENV.job; if (!J) return; if (CUR.R !== J.R) { envJobEnd(J); ENV.job = null; return; }
    var t0 = performance.now(), L = ENV.LAYER;
    try {
      if (!ENV.cube) { ENV.cube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.LinearSRGBColorSpace }); ENV.cube.texture.userData.noWarm = true; ENV.cam = new THREE.CubeCamera(0.05, 80, ENV.cube); ENV.cam.layers.set(L); ENV.cam.children.forEach(function (c) { c.layers.set(L); }); }
      var roots = Array.isArray(J.R.capRoot) ? J.R.capRoot : [J.R.capRoot];
      if (!J.meshes) { J.meshes = []; for (var ri = 0; ri < roots.length; ri++) roots[ri].traverse(function (o) { if ((o.isMesh || o.isPoints) && !o.isSkinnedMesh && o.visible && !o.layers.isEnabled(L)) { o.layers.enable(L); J.meshes.push(o); } }); }
      if (J.face < 6) {
        var b = J.R.box, cx = (b[0] + b[1]) / 2, cz = (b[4] + b[5]) / 2; _v.set(cx, b[2] + Math.min(1.7, (b[3] - b[2]) * 0.45), cz).applyMatrix4(J.R.M); ENV.cam.position.copy(_v); ENV.cam.updateMatrixWorld(true); lightsOnLayer(L);
        var r = renderer, prt = r.getRenderTarget(), su = r.shadowMap.autoUpdate, sn = r.shadowMap.needsUpdate, ac = r.autoClear, cc = ENV.cc || (ENV.cc = new THREE.Color()); r.getClearColor(cc); var ca = r.getClearAlpha();
        var nt = nightK(); try { _c.copy(scene.fog.color).multiplyScalar(1.6 * (1 - nt) + 0.02); } catch (e) { _c.setRGB(0.6, 0.65, 0.75); } r.setClearColor(_c, 1);
        r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = false; r.autoClear = true;
        // only the room and the lights are walked (three visits the whole scene graph for every render, 13,000 objects outdoors)
        var tops = [], ok = true; for (var ti = 0; ti < roots.length; ti++) { var top = roots[ti]; while (top.parent && top.parent !== scene) top = top.parent; if (top.parent !== scene) ok = false; else if (tops.indexOf(top) < 0) tops.push(top); }
        var kids = scene.children, red = null; if (ok && tops.length) { red = tops.slice(); for (var q = 0; q < kids.length; q++) { var ko = kids[q]; if (ko.isLight && red.indexOf(ko) < 0) red.push(ko); } scene.children = red; }
        try { var cams = ENV.cam.children; for (var k = 0; k < 2 && J.face < 6; k++, J.face++) { r.setRenderTarget(ENV.cube, J.face); r.render(scene, cams[J.face]); } }
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
  function envJobEnd(J) { if (J && J.meshes) { for (var i = 0; i < J.meshes.length; i++) J.meshes[i].layers.disable(ENV.LAYER); J.meshes = null; } }
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
  RL.envDrop = function () { envRestore(); ENV.active = null; ENV.cache.forEach(function (v) { try { v.rt.dispose(); } catch (e) {} }); ENV.cache.clear(); if (ENV.cube) { ENV.cube.dispose(); ENV.cube = null; ENV.cam = null; } return true; };

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
  function atmoInit() {
    if (ATMO.g) return; var g = ATMO.g = new THREE.Group(); g.name = "rl atmo"; g.userData.noSolid = true; g.userData.noCull = true; g.userData.avShared = true;
    var MQ = ATMO.MAXQ, sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MQ * 4 * 3), 3)); sg.setAttribute("aTE", new THREE.BufferAttribute(new Float32Array(MQ * 4 * 2), 2)); sg.setAttribute("aW", new THREE.BufferAttribute(new Float32Array(MQ * 4), 1));
    var idx = new Uint16Array(MQ * 6); for (var q = 0; q < MQ; q++) { idx[q * 6] = q * 4; idx[q * 6 + 1] = q * 4 + 1; idx[q * 6 + 2] = q * 4 + 2; idx[q * 6 + 3] = q * 4; idx[q * 6 + 4] = q * 4 + 2; idx[q * 6 + 5] = q * 4 + 3; } sg.setIndex(new THREE.BufferAttribute(idx, 1)); sg.setDrawRange(0, 0); sg.userData.avShared = true;
    ATMO.mat = new THREE.ShaderMaterial({ uniforms: { uCol: { value: new THREE.Color(1, 0.9, 0.74) }, uK: { value: 0 }, uT: { value: 0 } }, vertexShader: SH_VS, fragmentShader: SH_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false });
    ATMO.mat.name = "rl_shaft"; ATMO.mat.userData.avShared = true; ATMO.mat.userData.noWarm = true;
    var sh = ATMO.sh = new THREE.Mesh(sg, ATMO.mat); sh.frustumCulled = false; sh.renderOrder = 4; sh.userData.noSolid = true; sh.matrixAutoUpdate = false; sh.castShadow = false; sh.receiveShadow = false; sh.name = "rl shafts"; g.add(sh);
    var MD = ATMO.MAXD, dg = new THREE.BufferGeometry(); dg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MD * 3), 3)); dg.setAttribute("aS", new THREE.BufferAttribute(new Float32Array(MD * 4), 4)); dg.setDrawRange(0, 0); dg.userData.avShared = true;
    ATMO.dmat = new THREE.ShaderMaterial({ uniforms: { uCol: { value: new THREE.Color(1, 0.92, 0.8) }, uK: { value: 0 }, uT: { value: 0 }, uPx: { value: 900 } }, vertexShader: DU_VS, fragmentShader: DU_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    ATMO.dmat.name = "rl_dust"; ATMO.dmat.userData.avShared = true; ATMO.dmat.userData.noWarm = true;
    var du = ATMO.du = new THREE.Points(dg, ATMO.dmat); du.frustumCulled = false; du.renderOrder = 5; du.userData.noSolid = true; du.matrixAutoUpdate = false; du.name = "rl dust"; g.add(du);
  }
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
  function aoMat() { if (AOM) return AOM; AOM = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false, fog: false });
    AOM.name = "rl_ao"; AOM.userData.avShared = true; AOM.userData.noSolid = true; return AOM; }
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
    gradeFrame(R, dt);
  }
  function unhook(phase, name) { var a = window.PLAN_HOOKS[phase]; if (!a) return; for (var i = a.length - 1; i >= 0; i--) if (a[i] && a[i].name === name) a.splice(i, 1); }
  RL.uninstall = function () { try { if (CUR.R) leaveRoom(CUR.R); } catch (e) {} gradeEnd(); try { RL.envDrop(); } catch (e) {} if (POOLX.wrapped && POOLX.orig) { if (updateLightPool && updateLightPool.__rlWrap) updateLightPool = window.updateLightPool = POOLX.orig; POOLX.wrapped = false; } unhook("frame", "planRoomLight"); unhook("world", "planRoomLightInstall");
    try { if (RL.atmoDrop) RL.atmoDrop(); } catch (e) {} try { if (typeof inside !== "undefined" && inside && inside.g) { inside.g.userData.rlRoom = null; inside.g.userData.rlTried = 0; } } catch (e) {} };
  if (PREV && window.__rlqAll) for (var qi = 0; qi < window.__rlqAll.length; qi++) window.PLAN_RLQ.push(window.__rlqAll[qi]);
  window.__rlqAll = [];
  if (RL.on) {
    window.PLAN_HOOKS.frame.push({ name: "planRoomLight", fn: frame });
    window.PLAN_HOOKS.world.push({ name: "planRoomLightInstall", fn: function () { installPool(); drainQ(); RL.envPrep(); } });
  }
  RL.state = function () { var R = CUR.R; return { room: R && R.id, type: R && R.type, fix: R && R.fix.length, slots: SP.map(function (s) { return s.c ? +(s.k).toFixed(2) : 0; }), spots: SS.map(function (s) { return s.c ? +(s.k).toFixed(2) : 0; }), env: !!(ENV.active && ENV.active.R === R), cache: ENV.cache.size, n: RL.n, part: RL.part, errs: RL.errs.length }; };
})();
