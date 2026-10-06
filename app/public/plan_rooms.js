// R14: the shared interior hook. The early buildings (stores, saloons, hotels, the diner, banks, barns, the chapel, galleries,
// villas, ranches, lakehouses) all enter through client.js's generic box room: enterInterior builds a shell from THEME, then
// furnish(g, kind, half) and furnishVariant(g, door, half) drop in a few boxes. This module lets other modules take over the
// inside of any of those rooms without editing client.js:
//
//   PLAN_ROOMS.register(id, test, spec)
//     id    a unique string (re-registering the same id replaces it)
//     test  function (door, info) -> true when this spec handles the room; info = { kind, name, b } (b = the plan.json building)
//     spec  { theme: optional THEME-style entry for this room ({ wall, floor, ceil, light: [color, intensity], hgt }),
//             build: function (ctx) called INSTEAD of the generic furniture,
//             solids: "manual" (optional: never auto-solid the build's meshes, see COLLISION below) }
//   ctx = { g, door, kind, name, b, half, hgt, shell, lamp, fill, H, e }
//     g      the room group (local frame: x across, z from the back wall (-half) to the front door (+half), y up from the floor)
//     e      the door's PLACE entry [x, y, z, yaw, scale] (the room's world frame)
//     shell  the meshes enterInterior already built (walls, floor, ceiling, windows, beams) before furnishing; a build may
//            hide them (set visible = false; keep them in g so R5 frees them on the way out, and their walls still collide)
//     lamp / fill  the room's one PointLight and HemisphereLight: tune colour, intensity, distance and position, never add lights
//
// H (all positions in the room's local frame, metres; ry / face in radians, 0 = facing +z, the door):
//   H.add(obj, x, y, z, ry)                       add to g
//   H.solid(x, z, w, d, ry, y0, y1)              block walking: a box w (along x) by d (along z), from y0 (0) to y1 (2.2) over the
//                                                floor. Registered with the client (addSolid, tag "room", cleared on the way out).
//   H.seat(x, z, w, d, ry, y1, face, out)        a seat: E sits you on it at height y1 facing `face` (local; omit to let the client
//                                                pick), `out` where you stand up: "back" (behind the seat, away from `face`: stools
//                                                and chairs at counters and tables), "front", [lx, lz], or omit (client default:
//                                                0.55 m forward). Returns the client solid.
//   H.spot(x, z, r, prompt, fn, opt)             an E interaction within r metres: prompt is the HUD line ("talk to Rosa"), fn()
//                                                runs on E. opt: { face: true } only when the player looks at it (wins over seats),
//                                                { y0, y1 } height band. Spots win over the client's generic room shop.
//   H.portal(ax, c, a0, a1, b0, b1)              an opening the outside is seen through (plan_perf portal culling): ax "x" = the
//                                                plane z = c (a: x range, b: y range), "z" = the plane x = c (a: z, b: y). The door
//                                                gap is always included. Without any portal the client's default openings are used.
//   H.after(fn)                                  fn(ctx) once enterInterior has finished (player placed, client shadow flags set)
//   H.frame(fn)                                  fn(dt, now, ctx) every frame while the player is in this room
//   H.leave(fn)                                  fn(ctx) when the player leaves (before R5 frees the room)
//   H.l2w(lx, lz) -> [x, z]                      local to world; H.w2l(x, z) -> [lx, lz]
// ctx.shadows = "near" (default) | "live": in a room only the near sun cascade is redrawn (every fourth frame, as plan_perf does
//   indoors); the middle and far cascades keep the maps drawn before the door (they only hold the street seen through the windows,
//   and redrawing all four was most of a 50 ms frame inside). "live" leaves plan_perf's indoor cadence for every cascade.
// ctx.door0 = [z, halfWidth]: E "steps outside" only past local z (and within |x| < halfWidth) instead of the client's front 3.5 m.
// ctx.sky = 0..1 (default 1): the share of the sky's light (the global hemisphere and the environment map) let into the room, so
//   the room's own lamp, fill and emissive fixtures carry it. ctx.tip: the HUD line when nothing is near. ctx.venue = false: E
//   away from every spot does not open the client's generic room shop (VENUE[kind]).
//
// COLLISION: after enterInterior furnishes, the client turns every non-instanced mesh in the room into a solid box
// (solidifyGroup). A merged mesh (one per material) would become one box over the whole room, so once a build calls H.solid or
// H.seat (or sets spec.solids = "manual") the build's own meshes are marked userData.noSolid and only the registered solids
// collide (a mesh with userData.solid = true still gets its box). A build that registers nothing keeps the old behaviour, except
// that meshes whose footprint is over 3.5 m (merged batches, rugs, ceilings) are skipped. The hidden shell walls still collide.
//
// Rules for builders (see BRIEF_R14_INTERIORS.md): no new real lights, shared materials with stable cache keys (mark shared
// geometries, materials and textures userData.avShared = true, or R5 disposes them with the room), merge or instance repeated
// things, no per-frame allocations. ?rooms=0 turns every registered builder off (the generic rooms come back).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var RM = window.PLAN_ROOMS = window.PLAN_ROOMS || { specs: [], errs: [], cur: null, n: { built: 0, generic: 0 } };
  RM.v = "r15-1"; RM.room = null; RM.n.solids = RM.n.solids || 0; RM.n.seats = RM.n.seats || 0; RM.n.spots = RM.n.spots || 0; RM.n.ms = RM.n.ms || 0;
  RM.off = /[?&]rooms=0\b/.test(location.search);
  function note(w, e) { if (RM.errs.length < 40) RM.errs.push(w + ": " + ((e && e.message) || e)); }
  RM.register = function (id, test, spec) {
    for (var i = 0; i < RM.specs.length; i++) if (RM.specs[i].id === id) { RM.specs.splice(i, 1); break; }
    RM.specs.push({ id: id, test: test, spec: spec || {} });
  };
  // the plan.json building a door belongs to: the nearest building of the same kind within a few metres of the door's origin
  RM.info = function (door) {
    var info = { kind: door && door.kind, name: null, b: null };
    try {
      if (door && door._r14b !== undefined) { info.b = door._r14b; info.name = info.b && info.b.name || null; return info; }
      var P = typeof PLAN !== "undefined" ? PLAN : window.PLAN, bs = P && P.buildings, e = door && door.e, best = null, bd = 1e9;
      var kinds = door && door.kind === "storefront_sl" ? { store: 1, storefront_sl: 1 } : null;
      if (bs && e) for (var i = 0; i < bs.length; i++) { var b = bs[i]; if (kinds ? !kinds[b.kind] : b.kind !== door.kind) continue; var d = Math.hypot(b.x - e[0], b.z - e[2]); if (d < bd) { bd = d; best = b; } }
      if (best && bd < 8) { info.b = best; info.name = best.name || null; }
      if (door) door._r14b = info.b;
    } catch (e2) { note("info", e2); }
    return info;
  };
  RM.find = function (door) {
    if (RM.off || !door) return null; var info = RM.info(door);
    for (var i = RM.specs.length - 1; i >= 0; i--) { var s = RM.specs[i]; try { if (s.test(door, info)) return { s: s, info: info }; } catch (e) { note("test " + s.id, e); } }
    return null;
  };

  // ───────────────────────── the room frame ─────────────────────────
  function l2w(e, lx, lz) { var c = Math.cos(e[3]), s = Math.sin(e[3]); return [e[0] + lx * c + lz * s, e[2] - lx * s + lz * c]; }
  function w2l(e, x, z) { var dx = x - e[0], dz = z - e[2], c = Math.cos(e[3]), s = Math.sin(e[3]); return [dx * c - dz * s, dx * s + dz * c]; }
  RM.l2w = l2w; RM.w2l = w2l;

  function makeH(ctx) {
    var g = ctx.g, e = ctx.e;
    function solid(x, z, w, d, ry, y0, y1) {
      ctx.manual = true; if (y0 === undefined || y0 === null) y0 = 0; if (y1 === undefined || y1 === null) y1 = 2.2;
      if (typeof addSolid !== "function") { (g.userData.r14solids = g.userData.r14solids || []).push([x, z, w, d, ry || 0, y0, y1]); return null; }
      var p = l2w(e, x, z); var sd = addSolid(p[0], p[1], e[3] + (ry || 0), w, d, e[1] + y0, e[1] + y1, "room"); if (sd) { RM.n.solids++; ctx.solids.push(sd); } return sd;
    }
    return {
      add: function (obj, x, y, z, ry) { obj.position.set(x || 0, y || 0, z || 0); if (ry) obj.rotation.y = ry; g.add(obj); return obj; },
      solid: solid,
      seat: function (x, z, w, d, ry, y1, face, out) {
        var sd = solid(x, z, w, d, ry, 0, y1 === undefined ? 0.46 : y1); if (!sd) return null; sd.seat = true; RM.n.seats++;
        if (typeof face === "number") sd.face = e[3] + face;
        if (out) { var o = null; if (Array.isArray(out)) o = out; else if (typeof face === "number") { var k = out === "front" ? 1 : -1, dd = (Math.max(w, d) > 1.2 ? Math.min(w, d) : Math.max(w, d)) / 2 + 0.42; o = [x + Math.sin(face) * dd * k, z + Math.cos(face) * dd * k]; } if (o) sd.r14out = l2w(e, o[0], o[1]); }
        ctx.seats.push(sd); return sd;
      },
      spot: function (x, z, r, prompt, fn, opt) { var s = { x: x, z: z, r: r || 1.4, prompt: prompt, fn: fn, o: opt || {} }; ctx.spots.push(s); RM.n.spots++; return s; },
      portal: function (ax, c, a0, a1, b0, b1) { ctx.portals.push([ax, c, a0, a1, b0, b1]); },
      after: function (fn) { ctx.afters.push(fn); }, frame: function (fn) { ctx.frames.push(fn); }, leave: function (fn) { ctx.leaves.push(fn); },
      l2w: function (lx, lz) { return l2w(e, lx, lz); }, w2l: function (x, z) { return w2l(e, x, z); }
    };
  }
  // the openings for plan_perf's indoor portal culling (the room group describes itself: perfRoom)
  function perfRoomFor(ctx) {
    return function (R) {
      var g = ctx.g, half = ctx.half, D = { kind: "room r14 " + ctx.kind, M: new THREE.Matrix4(), boxes: [], rects: [], roots: [g] };
      g.updateMatrixWorld(true); D.M.copy(g.matrixWorld); D.boxes.push([-half - 0.3, half + 0.3, -1, Math.max(ctx.hgt, 4) + 1.5, -half - 0.3, half + 0.3]);
      D.rects.push(R("x", half, -1.15, 1.15, 0, 2.6));
      for (var i = 0; i < ctx.portals.length; i++) { var p = ctx.portals[i]; D.rects.push(R(p[0], p[1], p[2], p[3], p[4], p[5])); }
      return D;
    };
  }

  // ───────────────────────── E, the prompt, sitting, the sky share ─────────────────────────
  var _fv = { x: 0, z: 0 };
  function nearSpot(ctx, facedOnly) {
    if (!ctx || !ctx.spots.length || typeof player === "undefined" || !player) return null;
    var q = w2l(ctx.e, player.position.x, player.position.z), py = player.position.y - ctx.e[1], best = null, bd = 1e9;
    var fy = (typeof yaw === "number" ? yaw : 0); _fv.x = -Math.sin(fy); _fv.z = -Math.cos(fy);   // the camera's forward (world)
    var c = Math.cos(ctx.e[3]), s = Math.sin(ctx.e[3]); var flx = _fv.x * c - _fv.z * s, flz = _fv.x * s + _fv.z * c;   // in the room frame
    for (var i = 0; i < ctx.spots.length; i++) { var sp = ctx.spots[i]; if (facedOnly && !sp.o.face) continue; if (sp.o.y0 !== undefined && (py < sp.o.y0 || py > sp.o.y1)) continue;
      var dx = sp.x - q[0], dz = sp.z - q[1], d = Math.hypot(dx, dz); if (d > sp.r) continue;
      if (sp.o.face && d > 0.3 && (dx * flx + dz * flz) / d < 0.45) continue; var k = d - (sp.o.face ? 0.6 : 0); if (k < bd) { bd = k; best = sp; } }
    return best;
  }
  RM.nearSpot = function () { return nearSpot(RM.room, false); };
  function seatOf(ctx) { if (!ctx || !player) return null; var best = null, bd = 1e9; for (var i = 0; i < ctx.seats.length; i++) { var sd = ctx.seats[i]; var d = Math.hypot(sd.x - player.position.x, sd.z - player.position.z); if (d < Math.max(sd.hw, sd.hd) + 0.35 && d < bd && Math.abs(sd.y1 - player.position.y) < 0.3) { bd = d; best = sd; } } return best; }
  function inRoom() { var c = RM.room; try { return c && typeof inside !== "undefined" && inside && inside.g === c.g ? c : null; } catch (e) { return null; } }
  var SKY = RM.sky = { on: false, base: 0, set: 0 };
  function frame(dt, now) {
    var c = inRoom();
    if (!c) { SHW.on = false; if (SKY.on) { try { if (Math.abs(scene.environmentIntensity - SKY.set) < 1e-6) scene.environmentIntensity = SKY.base; } catch (e) {} SKY.on = false; } if (RM.room && !RM.room.left) endRoom(RM.room); return; }
    if (!SHW.wrapped) shadowWrap(); SHW.on = true;
    try { var f = c.sky; if (window.PLAN_RL && PLAN_RL.envOwns && PLAN_RL.envOwns()) { if (SKY.on) { if (Math.abs(scene.environmentIntensity - SKY.set) < 1e-6) scene.environmentIntensity = SKY.base; SKY.on = false; } if (typeof f === "number" && f < 1 && typeof hemi !== "undefined" && hemi) hemi._intensity *= f; }   // R15: the room's own environment (plan_roomlight.js) replaces the sky's share
      else if (typeof f === "number" && f < 1) { var ei = scene.environmentIntensity; if (!SKY.on || Math.abs(ei - SKY.set) > 1e-6) SKY.base = ei; SKY.set = SKY.base * f; scene.environmentIntensity = SKY.set; SKY.on = true; if (typeof hemi !== "undefined" && hemi) { if (window.PLAN_RL && PLAN_RL.on && hemi._intensity !== undefined) hemi._intensity *= f; else hemi.intensity *= f; } } } catch (e) { note("sky", e); }   // R15: the client reports a hemisphere light's intensity x PI, so "*= f" multiplied it by PI f (about 1); the kit scales the stored value
    for (var i = 0; i < c.frames.length; i++) { try { c.frames[i](dt, now, c); } catch (e) { note("frame", e); c.frames.splice(i, 1); i--; } }
    try { // the HUD line: a faced spot, then a seat, then the nearest spot, then the door
      var el = document.getElementById("prompt-t"); if (!el || (typeof SIT !== "undefined" && SIT.on)) return; var sp = nearSpot(c, true) || ((typeof nearestSeat === "function" && nearestSeat()) ? null : nearSpot(c, false));
      if (sp) { el.innerHTML = "<b>E</b> &nbsp;" + sp.prompt; return; }
      if (typeof nearestSeat === "function" && nearestSeat()) return; if (inside.atDoor()) { el.innerHTML = "<b>E</b> &nbsp;step outside"; return; }
      if (c.tip || c.venue === false) el.innerHTML = c.tip || "look around · the door is behind you";
    } catch (e) { note("prompt", e); }
  }
  function endRoom(c) { if (!c || c.left) return; c.left = true; for (var i = 0; i < c.leaves.length; i++) { try { c.leaves[i](c); } catch (e) { note("leave", e); } } if (RM.room === c) RM.room = null; }

  function install() {
    if (RM.installed || typeof enterInterior !== "function" || typeof furnish !== "function" || typeof themeMaterials !== "function") return false;
    RM.installed = true;
    var origEnter = enterInterior, origFurnish = furnish, origVariant = furnishVariant, origTheme = themeMaterials;
    // the room being built: set for the duration of enterInterior so furnish / themeMaterials know which door it is
    enterInterior = window.enterInterior = function (door, land) {
      var prev = RM.cur; var me = RM.cur = door ? { door: door, hit: RM.find(door) } : null; var r;
      try { r = origEnter.apply(this, arguments); } finally { RM.cur = prev; }
      // solids of other modules standing inside the room's footprint (a porch module's building body box, say) are parked while
      // the player is in here, as the client parks the building's own colliders; they go back on the way out
      try { if (typeof inside !== "undefined" && inside && inside.g && inside.door === door && !inside.r14park && door && door.kind !== "terminal" && door.kind !== "arcade" && typeof SOLIDS !== "undefined") { var hf = inside.half + 0.3, e0 = door.e, park = [];
        for (var si = SOLIDS.length - 1; si >= 0; si--) { var sd = SOLIDS[si]; if (typeof sd.tag === "string" && (sd.tag === "room" || sd.tag.indexOf("room:") === 0 || sd.tag.indexOf("prop") === 0)) continue; var lq = w2l(e0, sd.x, sd.z); if (Math.abs(lq[0]) < hf && Math.abs(lq[1]) < hf && sd.y0 < e0[1] + 3 && sd.y1 > e0[1] + 0.2) { park.push(sd); SOLIDS.splice(si, 1); } }
        if (park.length) { inside.r14park = park; RM.n.parked = park.length; if (typeof R9SG !== "undefined") R9SG.ver++; } } } catch (e3) { note("park", e3); }
      var ctx = me && me.ctx; if (ctx && typeof inside !== "undefined" && inside && inside.g === ctx.g) {
        RM.room = ctx; if (ctx.portals.length) ctx.g.perfRoom = perfRoomFor(ctx);
        if (ctx.door0) { var dz = ctx.door0; inside.atDoor = function () { var q = w2l(ctx.e, player.position.x, player.position.z); return q[1] > dz[0] && Math.abs(q[0]) < dz[1]; }; }
        for (var i = 0; i < ctx.afters.length; i++) { try { ctx.afters[i](ctx); } catch (e) { note("after", e); } }
        try { if (window.PLAN_RL && PLAN_RL.ctxRoom) PLAN_RL.ctxRoom(ctx); } catch (e) { note("roomlight", e); }   // R15: the room's fixtures, environment and look (plan_roomlight.js)
      }
      return r;
    };
    themeMaterials = window.themeMaterials = function (kind) {
      var c = RM.cur, th = c && c.hit && c.hit.s.spec.theme;
      if (!th || typeof THEME === "undefined" || kind !== c.door.kind) return origTheme.apply(this, arguments);
      var saved = THEME[kind]; THEME[kind] = th; try { return origTheme.call(this, kind); } finally { THEME[kind] = saved; }
    };
    furnish = window.furnish = function (g, kind, half) {
      var c = RM.cur; if (!c || !c.hit || !c.hit.s.spec.build || kind !== c.door.kind) { RM.n.generic++; return origFurnish.apply(this, arguments); }
      var t0 = performance.now(); var spec = c.hit.s.spec;
      var th = origTheme.call(this, kind); var hgt = (spec.theme && spec.theme.hgt) || (th && th.hgt) || 4.4;
      var lamp = null, fill = null; for (var i = 0; i < g.children.length; i++) { var o = g.children[i]; if (o.isPointLight && !lamp) lamp = o; else if (o.isHemisphereLight && !fill) fill = o; }
      var ctx = { g: g, door: c.door, e: c.door.e, kind: kind, name: c.hit.info.name, b: c.hit.info.b, half: half, hgt: hgt, shell: g.children.slice(), lamp: lamp, fill: fill,
        id: c.hit.s.id, sky: 1, tip: null, venue: true, door0: null, shadows: spec.shadows || "near", manual: spec.solids === "manual", solids: [], seats: [], spots: [], portals: [], afters: [], frames: [], leaves: [], left: false };
      ctx.H = makeH(ctx); var shellSet = new Set(ctx.shell);
      try { spec.build(ctx); RM.n.built++; c.built = true; c.ctx = ctx; }
      catch (e) { note("build " + c.hit.s.id, e); for (var k = 0; k < ctx.solids.length; k++) { var j = SOLIDS.indexOf(ctx.solids[k]); if (j >= 0) SOLIDS.splice(j, 1); } try { origFurnish.apply(this, arguments); } catch (e2) {} return; }
      // the client boxes every mesh after this (solidifyGroup): keep the build's merged meshes out of it (see COLLISION above)
      try { g.traverse(function (o) { if (!o.isMesh || shellSet.has(o) || (o.userData && o.userData.solid === true)) return; var top = o; while (top.parent && top.parent !== g) top = top.parent; if (shellSet.has(top)) return;
        if (ctx.manual) { o.userData.noSolid = true; return; }
        var geo = o.geometry; if (!geo) return; if (!geo.boundingBox) geo.computeBoundingBox(); var bb = geo.boundingBox, sc = o.scale; if ((bb.max.x - bb.min.x) * Math.abs(sc.x) > 3.5 || (bb.max.z - bb.min.z) * Math.abs(sc.z) > 3.5) o.userData.noSolid = true; }); } catch (e) { note("nosolid", e); }
      RM.n.ms = +(performance.now() - t0).toFixed(1); ctx.ms = RM.n.ms;
    };
    furnishVariant = window.furnishVariant = function (g, door, half) { var c = RM.cur; if (c && c.built) return; return origVariant.apply(this, arguments); };
    if (typeof leaveInterior === "function") { var origLeave = leaveInterior; leaveInterior = window.leaveInterior = function () { var c = inRoom(); if (c) endRoom(c); var pk = typeof inside !== "undefined" && inside && inside.r14park; var r = origLeave.apply(this, arguments);
      if (pk && pk.length) { try { for (var i = 0; i < pk.length; i++) SOLIDS.push(pk[i]); if (typeof R9SG !== "undefined") R9SG.ver++; } catch (e) { note("unpark", e); } } return r; }; }
    // E: a spot first (faced spots beat seats), standing up lands where the seat says, and a room can switch off the generic shop
    if (typeof openNearest === "function") { var origOpen = openNearest; openNearest = window.openNearest = function () {
      var c = inRoom(); if (c && !(typeof SIT !== "undefined" && SIT.on)) { try {
        var sp = nearSpot(c, true) || ((typeof nearestSeat === "function" && nearestSeat()) ? null : nearSpot(c, false)); if (sp) { sp.fn(sp); return; }
        if (!(typeof nearestSeat === "function" && nearestSeat()) && c.venue === false && !inside.atDoor()) { if (typeof setStatus === "function") setStatus(c.tip ? c.tip.replace(/<[^>]+>/g, "") : "walk back to the door to step outside"); return; }
      } catch (e) { note("E", e); } }
      return origOpen.apply(this, arguments); }; }
    if (typeof standUp === "function") { var origStand = standUp; standUp = window.standUp = function () {
      var c = inRoom(), sd = c && typeof SIT !== "undefined" && SIT.on ? seatOf(c) : null; var r = origStand.apply(this, arguments);
      try { if (sd && sd.r14out) { var x = sd.r14out[0], z = sd.r14out[1], y0 = c.e[1]; player.position.x = x; player.position.z = z; player.position.y = typeof surfaceAt === "function" ? surfaceAt(x, z, y0 + 0.4) : y0 + 0.05; if (!(player.position.y < y0 + 0.4)) player.position.y = y0 + 0.05; } } catch (e) { note("stand", e); }
      return r; }; }
    return true;
  }
  // ───────────────────────── shadows in a room: the near cascade only (see ctx.shadows) ─────────────────────────
  var SHW = RM.shw = RM.shw || { on: false, n: 0 };
  function shadowWrap() { try { if (SHW.wrapped || typeof renderer === "undefined" || !renderer || !renderer.shadowMap) return; SHW.wrapped = true; var sm = renderer.shadowMap, orig = sm.render;
    sm.render = function () { var c = SHW.on ? inRoom() : null; if (c && c.shadows !== "live") { try { var L = CSMX.csm && CSMX.csm.lights; if (L) for (var i = 1; i < L.length; i++) { var sh = L[i].shadow; if (sh.autoUpdate || sh.needsUpdate) { sh.autoUpdate = false; sh.needsUpdate = false; SHW.n++; } } } catch (e) {} } return orig.apply(this, arguments); }; } catch (e) { note("shadow wrap", e); } }
  // ───────────────────────── the warm-up: every room texture and program resident before the first door ─────────────────────────
  // PLAN_ROOMS.warm(x, name): x is a texture, a material, an Object3D (its materials and their maps), an array or a plain object
  // of those (a module's cache, two levels deep), or a function returning any of them (called again on every scan, so caches
  // that fill at idle are picked up). Items can be added at any time (a stock sheet that has just loaded). Once the world is up,
  // the loading screen's pre-compile is done and the player has been outdoors for a moment, a frame hook spends about 4 ms a
  // frame (at least one item): textures go to the GPU with renderer.initTexture; materials, eight at a time, are compiled the
  // way the main pass draws them (PLAN_PERF.compileGroup: the scene's lights, fog, environment and the post target), waited on
  // without blocking (KHR_parallel_shader_compile), drawn once into a 4 px target with the main pass's formats (the driver's
  // own variant of each program, R9w; on a tier without the post target, a 1 px scissor of the canvas before the frame clears
  // it) and pinned (PLAN_PERF.pinPrograms). Nothing runs while the player is inside, flying or the tab is hidden. A texture or
  // material with userData.noWarm is skipped. ?rwarm=0 turns it off. State: PLAN_ROOMS.warm.n, PLAN_ROOMS.warm.left().
  // The R14 modules are found without edits: PLAN_ROOMS_VENUES.TX / .MT, PLAN_RH.tx / .mt, PLAN_PORCHES.mat; the shops register.
  var WU = RM.wu = RM.wu || { slow: [], items: [], mats: [], matSet: new Set(), texs: [], texSet: new Set(), pend: [], mi: 0, ti: 0, batch: null, outAt: 0, scanAt: 0, dirty: true,
    n: { tex: 0, texMs: 0, texMax: 0, mats: 0, batches: 0, drawMs: 0, stepMax: 0, scans: 0, firstAt: 0, doneAt: 0, waitMs: 0 } };
  WU.on = !/[?&]rwarm=0\b/.test(location.search); WU.decMB = 4; try { var DQ = /[?&]rwdec=(\d+)/.exec(location.search); if (DQ) WU.decMB = +DQ[1]; } catch (e) {}   // ?rwdec=999: upload the decode-only pictures too (testing)
  // opt (optional): { decodeMB: n } a picture texture (an <img>) bigger than n MB on the GPU is only decoded ahead (img.decode(),
  // off the main thread), not uploaded: its first draw is then a plain copy of a few milliseconds and the GPU memory is spent
  // only where the player goes (used for the venues' paintings and props sheets)
  RM.warm = function (x, name, opt) { if (x) { WU.items.push({ x: x, name: name || "", o: opt || null }); WU.dirty = true; } return WU.items.length; };
  RM.warm.n = WU.n;
  // what the R14 caches hold and how much of it is on the GPU (image size x 4 bytes x 4/3 for the mip chain; an estimate)
  RM.warm.audit = function () { try { scan(); } catch (e) {} var o = { n: 0, mb: 0, resident: 0, residentMb: 0, big: [] }; WU.texSet.forEach(function (t) { var im = t.image || {}, w = im.width || im.videoWidth || 0, h = im.height || im.videoHeight || 0, mb = w * h * 4 * (t.generateMipmaps === false ? 1 : 1.333) / 1048576; o.n++; o.mb += mb; var res = false; try { var pr = renderer.properties.get(t); res = !!pr.__webglTexture && pr.__version === t.version; } catch (e) {} if (res) { o.resident++; o.residentMb += mb; if (mb > 8) o.big.push([t.name || (im.src ? String(im.src).split("/").pop().split("?")[0] : im.constructor && im.constructor.name), w, h]); } });
    o.mb = Math.round(o.mb); o.residentMb = Math.round(o.residentMb); return o; };
  RM.warm.left = function () { return { tex: WU.texs.length - WU.ti + WU.pend.length, mats: WU.mats.length - WU.mi + (WU.batch ? WU.batch.mats.length : 0) }; };
  var TEXK = ["map", "normalMap", "emissiveMap", "roughnessMap", "metalnessMap", "aoMap", "alphaMap", "lightMap", "bumpMap", "displacementMap", "specularMap", "clearcoatMap", "clearcoatNormalMap", "sheenColorMap", "transmissionMap"];
  var DEC = new WeakSet(), GO = null;   // GO: the options of the item being gathered
  function addTex(t) { if (!t || !t.isTexture || WU.texSet.has(t) || t.isRenderTargetTexture || t.isVideoTexture || t.isCubeTexture || (t.userData && t.userData.noWarm)) return; WU.texSet.add(t); WU.texs.push(t); if (GO && GO.decodeMB) DEC.add(t); }
  function addMat(m) { if (!m || !m.isMaterial || WU.matSet.has(m) || (m.userData && m.userData.noWarm)) return; WU.matSet.add(m);
    if (m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial || m.isMeshMatcapMaterial) WU.mats.push(m);   // mesh materials get a sample draw; any other kind only its maps
    for (var i = 0; i < TEXK.length; i++) addTex(m[TEXK[i]]); var u = m.uniforms; if (u) for (var k in u) { var v = u[k] && u[k].value; if (v && v.isTexture) addTex(v); } }
  function gather(x, d) {
    if (!x || d > 3) return; if (typeof x === "function") { try { gather(x(), d + 1); } catch (e) { note("warm provider", e); } return; }
    if (x.isTexture) { addTex(x); return; } if (x.isMaterial) { addMat(x); return; }
    if (x.isObject3D) { x.traverse(function (o) { var ms = o.material; if (!ms) return; ms = Array.isArray(ms) ? ms : [ms]; for (var i = 0; i < ms.length; i++) addMat(ms[i]); }); return; }
    if (Array.isArray(x)) { for (var j = 0; j < x.length; j++) gather(x[j], d + 1); return; }
    if (typeof x === "object" && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null)) for (var k in x) { var v = x[k]; if (v && typeof v === "object") gather(v, d + 1); }
  }
  // the other R14 modules' session caches, read only (every value in them is a texture, a material or a { map, nrm } pair)
  RM.warm(function () { var V = window.PLAN_ROOMS_VENUES; return V && !V.off ? [V.TX, V.MT] : null; }, "venues", { decodeMB: 4 });
  RM.warm(function () { var H = window.PLAN_RH; return H && !H.off ? [H.tx, H.mt] : null; }, "homes");
  RM.warm(function () { var P = window.PLAN_PORCHES; return P && !P.off ? [P.mat] : null; }, "porches");
  function scan() { WU.n.scans++; WU.dirty = false; for (var i = 0; i < WU.items.length; i++) { GO = WU.items[i].o; try { gather(WU.items[i].x, 0); } finally { GO = null; } }
    if (WU.pend.length) { var p = WU.pend; WU.pend = []; for (var j = 0; j < p.length; j++) WU.texs.push(p[j]); }
    if (WU.texs.length - WU.ti > 1) { var rest = WU.texs.slice(WU.ti).sort(function (a, b) { return texMB(a) - texMB(b); }); WU.texs.length = WU.ti; for (var r = 0; r < rest.length; r++) WU.texs.push(rest[r]); } }
  function texMB(t) { var im = t.image; return im ? (im.width || 0) * (im.height || 0) * 5.3e-6 : 0; }
  function texReady(t) { var im = t.image; if (!im || t.version === 0) return false; if (t.isCompressedTexture || t.isDataTexture || t.isData3DTexture || t.isDataArrayTexture) return true;
    if (Array.isArray(im)) return im.length > 0 && im.every(function (x) { return x && x.complete !== false && (x.width || x.image); }); return im.complete !== false && !!(im.width || im.videoWidth || im.data); }
  function texPending(t) { try { return renderer.properties.get(t).__version !== t.version; } catch (e) { return false; } }
  function mainRT() { try { return POST.on && POST.rt && !document.body.classList.contains("photo") ? POST.rt : null; } catch (e) { return null; } }
  var WGEO = null;
  function sampleGeo() { if (WGEO) return WGEO; var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, -1, 0.01, 0, -1, 0, 0.01, -1]), 3)); g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2)); g.setAttribute("color", new THREE.BufferAttribute(new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]), 3)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -1), 1); g.userData.avShared = true; return (WGEO = g); }
  function lightsOn30() { var L = []; try { L.push(hemi, sun, moon); } catch (e) {} try { var P = window.PLAN_PERF; if (P) L.push(P.hemi, P.hemi2); } catch (e) {} try { LIGHTS.pool.forEach(function (l) { L.push(l); }); LIGHTS.spool.forEach(function (l) { L.push(l); }); } catch (e) {} try { if (CSMX.csm) CSMX.csm.lights.forEach(function (l) { L.push(l); }); } catch (e) {} for (var i = 0; i < L.length; i++) if (L[i] && L[i].layers) L[i].layers.enable(30); }
  // one render of the batch's sample meshes, the way the main pass will first draw them (formats, lights, fog, environment)
  function drawBatch(g) {
    var rt = mainRT(), t0 = performance.now(); if (!WU.cam) { WU.cam = new THREE.PerspectiveCamera(60, 1, 0.1, 10); WU.cam.layers.set(30); }
    if (rt && !WU.rt) { var r = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: rt.texture ? rt.texture.type : THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true, stencilBuffer: !!rt.stencilBuffer }); if (rt.depthTexture) r.depthTexture = new THREE.DepthTexture(4, 4, rt.depthTexture.type); WU.rt = r; }
    var swap = []; if (!WU.ph) { WU.ph = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); WU.ph.needsUpdate = true; WU.ph.userData.avShared = true; WU.ph.userData.noWarm = true; }
    g.children.forEach(function (o) { var m = o.material; for (var i = 0; i < TEXK.length; i++) { var t = m[TEXK[i]]; if (t && t.isTexture && (!texReady(t) || texPending(t))) { swap.push([m, TEXK[i], t]); m[TEXK[i]] = WU.ph; } } });   // the program is the same (a map is a map); the picture itself goes up later or at its first real draw
    lightsOn30(); scene.add(g); var su = renderer.shadowMap.autoUpdate, sn = renderer.shadowMap.needsUpdate, bg = scene.background, prt = renderer.getRenderTarget(), ar = renderer.info.autoReset, vp = null;
    try { renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; scene.background = null; try { if (window.PLAN_PERF && PLAN_PERF.hemiFix) PLAN_PERF.hemiFix(); } catch (e) {}
      if (rt) { renderer.setRenderTarget(WU.rt); renderer.render(scene, WU.cam); }
      else { vp = [new THREE.Vector4(), new THREE.Vector4(), renderer.getScissorTest()]; renderer.getViewport(vp[0]); renderer.getScissor(vp[1]); renderer.setRenderTarget(null); renderer.setViewport(0, 0, 1, 1); renderer.setScissor(0, 0, 1, 1); renderer.setScissorTest(true); renderer.render(scene, WU.cam); } }
    catch (e) { note("warm draw", e); }
    finally { if (vp) { renderer.setViewport(vp[0]); renderer.setScissor(vp[1]); renderer.setScissorTest(vp[2]); } renderer.setRenderTarget(prt); scene.background = bg; renderer.shadowMap.autoUpdate = su; renderer.shadowMap.needsUpdate = sn; renderer.info.autoReset = ar; scene.remove(g); for (var k = 0; k < swap.length; k++) swap[k][0][swap[k][1]] = swap[k][2]; }
    WU.n.drawMs += performance.now() - t0;
  }
  function startBatch() {
    var ms = []; while (WU.mi < WU.mats.length && ms.length < 8) { var m0 = WU.mats[WU.mi++]; if (WU.n.firstDone) { var pr0 = null; try { pr0 = renderer.properties.get(m0).currentProgram; } catch (e) {} if (pr0) { WU.n.skipped = (WU.n.skipped || 0) + 1; continue; } } ms.push(m0); }   // a material first seen after the first pass that already has a program was made and drawn by a room
    if (!ms.length) return false;
    var g = new THREE.Group(); g.name = "r14 warm"; var geo = sampleGeo(); for (var i = 0; i < ms.length; i++) { var m = new THREE.Mesh(geo, ms[i]); m.frustumCulled = false; m.layers.set(30); m.matrixAutoUpdate = false; m.userData.noSolid = true; g.add(m); }
    var b = WU.batch = { g: g, mats: ms, ready: false, t: performance.now() };
    try { var P = window.PLAN_PERF, pr = P && P.compileGroup ? P.compileGroup(g, true) : renderer.compileAsync(g, camera, scene); if (pr && pr.then) pr.then(function () { b.ready = true; }, function () { b.ready = true; }); else b.ready = true; } catch (e) { note("warm compile", e); b.ready = true; }
    return true;
  }
  function endBatch() { var b = WU.batch; WU.batch = null; drawBatch(b.g); WU.n.mats += b.mats.length; WU.n.batches++; WU.n.waitMs += performance.now() - b.t; try { if (window.PLAN_PERF && PLAN_PERF.pinPrograms) PLAN_PERF.pinPrograms(); } catch (e) {} }
  var WLAST = 0;
  function warmFrame() {
    if (!WU.on || RM.off) return; var now = performance.now(), fdt = WLAST ? now - WLAST : 16; WLAST = now;
    var busy = true; try { busy = !renderer || !scene || !scene.environment || !player || (typeof inside !== "undefined" && !!inside) || (typeof FLY !== "undefined" && FLY.on) || document.hidden || !(typeof FRAME_N === "undefined" || FRAME_N > 40) || !!(window.PLAN_PERF && PLAN_PERF.pre && PLAN_PERF.pre.state !== undefined && PLAN_PERF.pre.state < 2); } catch (e) { busy = true; }
    if (busy) { WU.outAt = 0; return; } if (!WU.outAt) WU.outAt = now; if (now - WU.outAt < 1200) return;   // a moment outdoors first
    if (!WU.go) { var ra = 0; try { ra = (window.PLAN_PERF && PLAN_PERF.readyAt) || 0; } catch (e) {} if (!ra) { if (!WU.ra) WU.ra = now; ra = WU.ra; } if (now - ra < 4000) return; WU.go = true; }   // not in the GPU's busy seconds right after the load
    if (WU.dirty || now - WU.scanAt > (WU.pend.length ? 300 : 1500)) { WU.scanAt = now; scan(); }
    var t0 = now, did = false;
    try {
      while (WU.ti < WU.texs.length && (!did || performance.now() - t0 < 4)) { var t = WU.texs[WU.ti++]; if (t.userData && t.userData.noWarm) continue; if (!texReady(t)) { WU.pend.push(t); continue; } if (!texPending(t)) continue;
        if (texMB(t) > 8 && fdt > 45) { WU.ti--; break; }   // a big picture only after a calm frame (the GPU is not still busy with the last one)
        var im = t.image; if (DEC.has(t) && im && (im.width || 0) * (im.height || 0) * 5.3e-6 > WU.decMB) { if (!im.__r14d && im.decode) { im.__r14d = 1; try { im.decode().then(function () { this.__r14d = 2; }.bind(im), function () { this.__r14d = 2; }.bind(im)); } catch (e) {} WU.n.decoded = (WU.n.decoded || 0) + 1; } continue; }
        if (im && typeof HTMLImageElement !== "undefined" && im instanceof HTMLImageElement && im.__r14d !== 2) { if (!im.__r14d) { im.__r14d = 1; try { im.decode().then(function () { this.__r14d = 2; }.bind(im), function () { this.__r14d = 2; }.bind(im)); } catch (e) { im.__r14d = 2; } } WU.pend.push(t); continue; }   // decoded off the main thread first (a JPEG decoded inside texImage2D was a 30 to 300 ms frame)
        var s = performance.now(); renderer.initTexture(t); var d = performance.now() - s; WU.n.tex++; WU.n.texMs += d; if (d > WU.n.texMax) WU.n.texMax = d; if (d > 12 && WU.slow.length < 24) { var im = t.image || {}; WU.slow.push([t.name || (im.constructor && im.constructor.name) || "?", im.width || 0, im.height || 0, +d.toFixed(1), Math.round(now)]); } did = true; if (!WU.n.firstAt) WU.n.firstAt = Math.round(now); }
      if (!did) { if (WU.batch) { if (WU.batch.ready || now - WU.batch.t > 10000) { endBatch(); did = true; } } else if (startBatch()) did = true; }
      if (did) WU.n.doneAt = Math.round(performance.now()); else if (!WU.n.firstDone && WU.ti >= WU.texs.length && WU.mi >= WU.mats.length && !WU.batch) WU.n.firstDone = Math.round(performance.now());
    } catch (e) { note("warm", e); }
    var dt = performance.now() - t0; if (dt > WU.n.stepMax) WU.n.stepMax = +dt.toFixed(1);
  }
  window.PLAN_HOOKS.frame.push({ name: "planRoomsWarm", fn: warmFrame });

  // client.js defines these functions after the plan modules load: install once they exist
  if (!install()) window.PLAN_HOOKS.world.push({ name: "planRoomsInstall", fn: function () { install(); } });
  window.PLAN_HOOKS.defer.push({ name: "planRoomsInstall2", fn: function () { install(); } });
  window.PLAN_HOOKS.frame.push({ name: "planRoomsFrame", fn: frame });
})();
