// R19 SE: seats and beds. plan_seat.js (R19, 6 Oct 2026) puts real animation and a seat camera on the client's sit system
// (SOLIDS with .seat, nearestSeat / sitDown / standUp / poseNow in client.js): press E near any chair, stool, bench, sofa, log,
// bleacher, bed, bunk, daybed, sun lounger, hammock, treatment table or hot tub ledge and you walk up to it, turn, sit or lie
// down (authored transitions on the game's 24-joint rig), settle into a breathing idle, and the camera eases into a close
// third-person framing made for that seat (over the shoulder at a bar, out at the view from a lounger, over the pillow at the
// room from a bed). Move or press E again to stand or get up; the camera eases back to the normal follow camera.
// Clips: models/se_seat_m.glb / se_seat_f.glb (28 clips each: sit, stool, lie and recline families, every one authored at two
// seat heights that are blended to the real seat; tools in genesis_data/v2/scripts/r19se). Data: plan/seat.json (contact
// metrics per body and family, the camera framings, prompts and status lines).
// How it plays the clips: an adapter samples them itself and writes the bone pose after the mixer has run (the last frame
// hook), so the client's locomotion blend is untouched; when AN's animation API lands (HANDOFF_R19_ANIM_API.md) the adapter
// is the one place to switch. Multiplayer: the seated pose travels in the existing `pose` field ("seat:<family><idle><phase>
// .<height>.<dx>.<dz>.<side>.<inset>", within logic.js's pose pattern), so other players see the same sit, idle and stand.
// Cost: no meshes, no materials, no programs, no lights; two 350 KB clip files loaded after the world; per seated character
// about 25 quaternion samples a frame. ?seat=0 turns the module off (the R18 instant sit exactly).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var SE = window.PLAN_SEAT = window.PLAN_SEAT || {};
  SE.v = "r19-se-1"; SE.errs = SE.errs || []; SE.n = SE.n || { sits: 0, lies: 0, remote: 0, stands: 0, aborts: 0, beds: 0 };
  if (/[?&]seat=0\b/.test(location.search)) { SE.off = true; return; }
  var nWarn = 0;
  function note(where, e) { if (SE.errs.length < 40) SE.errs.push(where + ": " + (e && e.message ? e.message : e)); if (++nWarn <= 20) try { console.warn("plan_seat " + where, e); } catch (x) {} }
  function now() { return performance.now(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sm(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
  function lerp(a, b, u) { return a + (b - a) * u; }
  var TAU = Math.PI * 2, HP = Math.PI / 2;
  function wrapA(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
  var BN = ["Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase", "Spine02", "Spine01", "Spine", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "neck", "Head", "head_end", "headfront", "RightShoulder", "RightArm", "RightForeArm", "RightHand"];
  var NB = BN.length;
  var D = null; SE.dataP = fetch((window.AV || String)("/plan/seat.json?v=" + (window.BUILD || "dev"))).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { D = SE.data = j; }).catch(function (e) { note("data", e); });

  // ───────────────────────── clips: sampled by the module itself (interpolants on the glTF tracks) ─────────────────────────
  var LIB = SE.lib = { m: null, f: null, walk: {} }, LD = null;
  function loadLib(b) {
    if (LIB[b] || LIB["_" + b]) return; LIB["_" + b] = 1;
    try { if (!LD) LD = gltfLoader(); var url = (D && D.files && D.files[b]) || ("/models/se_seat_" + b + ".glb");
      LD.load(url + "?v=" + (window.BUILD || "dev"), function (g) { var L = {}; (g.animations || []).forEach(function (c) { L[c.name] = recOf(c); }); LIB[b] = L; SE.n["lib_" + b] = Object.keys(L).length; }, undefined, function (e) { note("clips " + b, e); });
    } catch (e) { note("load", e); } }
  function recOf(clip) {
    var r = { dur: clip.duration, q: new Array(NB), p: null };
    clip.tracks.forEach(function (t) { var dot = t.name.lastIndexOf("."), bn = t.name.slice(0, dot), pr = t.name.slice(dot + 1), i = BN.indexOf(bn); if (i < 0) return;
      if (pr === "quaternion") r.q[i] = t.createInterpolant(); else if (pr === "position" && i === 0) r.p = t.createInterpolant(); });
    return r; }
  function walkRec(b) { if (LIB.walk[b] !== undefined) return LIB.walk[b]; var C = typeof CHAR !== "undefined" && CHAR[b]; var c = C && C.clips && C.clips.walk; LIB.walk[b] = c ? recOf(c) : null; return LIB.walk[b]; }
  function Pose() { return { q: new Float32Array(NB * 4), p: new Float32Array(3), hasP: false }; }
  var _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  function sampleInto(rec, t, out) {
    if (!rec) return false; t = clamp(t, 0, rec.dur);
    for (var i = 0; i < NB; i++) { var ip = rec.q[i]; if (!ip) continue; var v = ip.evaluate(t); out.q[i * 4] = v[0]; out.q[i * 4 + 1] = v[1]; out.q[i * 4 + 2] = v[2]; out.q[i * 4 + 3] = v[3]; }
    if (rec.p) { var p = rec.p.evaluate(t); out.p[0] = p[0]; out.p[1] = p[1]; out.p[2] = p[2]; out.hasP = true; } return true; }
  function mixInto(a, b, w, out) {   // out = slerp(a, b, w) per joint, positions lerped
    for (var i = 0; i < NB; i++) { var k = i * 4; _qa.set(a.q[k], a.q[k + 1], a.q[k + 2], a.q[k + 3]); _qb.set(b.q[k], b.q[k + 1], b.q[k + 2], b.q[k + 3]); _qa.slerp(_qb, w); out.q[k] = _qa.x; out.q[k + 1] = _qa.y; out.q[k + 2] = _qa.z; out.q[k + 3] = _qa.w; }
    for (var j = 0; j < 3; j++) out.p[j] = lerp(a.p[j], b.p[j], w); out.hasP = a.hasP || b.hasP; return out; }
  // a family clip at a seat height: the two authored heights blended (identical timing, so any blend is a valid clip)
  var _pa = Pose(), _pb = Pose();
  function famPose(L, name, wH, t, out) { var A = L[name + "_a"], B = L[name + "_b"]; if (!A || !B) return false; sampleInto(A, t, _pa); sampleInto(B, t, _pb); mixInto(_pa, _pb, wH, out); return true; }
  function durOf(L, name) { var A = L && L[name + "_a"]; return A ? A.dur : 1; }

  // ───────────────────────── bones of a character, the snapshot, writing the pose ─────────────────────────
  function bonesOf(g) { var u = g.userData; if (u.seB && u.seB.walk === u.walk && u.seB.mixer === u.mixer && u.seB.b[0] && u.seB.b[0].parent) return u.seB.b;
    var b = new Array(NB); if (u.walk) u.walk.traverse(function (o) { if (o.isBone) { var i = BN.indexOf(o.name); if (i >= 0 && !b[i]) b[i] = o; } }); u.seB = { walk: u.walk, mixer: u.mixer, b: b }; return b; }
  function snapOf(B, out) { for (var i = 0; i < NB; i++) { var o = B[i]; if (!o) continue; var k = i * 4; out.q[k] = o.quaternion.x; out.q[k + 1] = o.quaternion.y; out.q[k + 2] = o.quaternion.z; out.q[k + 3] = o.quaternion.w; } if (B[0]) { out.p[0] = B[0].position.x; out.p[1] = B[0].position.y; out.p[2] = B[0].position.z; out.hasP = true; } return out; }
  function writePose(B, P, w) {   // w = 1: the pose exactly; w < 1: from whatever the mixer wrote this frame toward it
    for (var i = 0; i < NB; i++) { var o = B[i]; if (!o) continue; var k = i * 4; _qb.set(P.q[k], P.q[k + 1], P.q[k + 2], P.q[k + 3]); if (w >= 1) o.quaternion.copy(_qb); else o.quaternion.slerp(_qb, w); }
    if (B[0] && P.hasP) { if (w >= 1) B[0].position.set(P.p[0], P.p[1], P.p[2]); else B[0].position.lerp(_v1.set(P.p[0], P.p[1], P.p[2]), w); } }

  // ───────────────────────── seat analysis: family, framing, height, the bed geometry ─────────────────────────
  function solidsNear(x, z, r) { var out = []; var S = SOLIDS; for (var i = 0; i < S.length; i++) { var o = S[i]; if (Math.abs(o.x - x) < r + o.hw + o.hd && Math.abs(o.z - z) < r + o.hw + o.hd) out.push(o); } return out; }
  function axesOf(sd) { var c = Math.cos(sd.ry), s = Math.sin(sd.ry); return { lx: [c, -s], lz: [s, c] }; }
  function extentAlong(sd, d) { var A = axesOf(sd); return sd.hw * Math.abs(A.lx[0] * d[0] + A.lx[1] * d[1]) + sd.hd * Math.abs(A.lz[0] * d[0] + A.lz[1] * d[1]); }
  function inBox(o, x, z, m) { var L = solidLocal(o, x, z); return Math.abs(L[0]) <= o.hw + (m || 0) && Math.abs(L[1]) <= o.hd + (m || 0); }
  function faceVec(a) { return [Math.sin(a), Math.cos(a)]; }
  // the home bed's foot seat sits on the end of a mattress solid: the bed is the union of both
  function mattressOf(sd) {   // R14 homes: bed() registers a W x 0.7 seat at the foot and a (W + 0.1) x (L - 0.7) mattress solid 0.2 higher behind it
    var sl = 2 * Math.max(sd.hw, sd.hd), ss = 2 * Math.min(sd.hw, sd.hd); if (ss < 0.6 || ss > 0.8 || sl < 0.85 || sl > 2.2) return null; var sLongZ = sd.hd >= sd.hw, best = null;
    solidsNear(sd.x, sd.z, 1.6).forEach(function (o) { if (o === sd || o.seat || o.tag !== sd.tag) return; var dr = Math.abs(wrapA(o.ry - sd.ry)); if (dr > 0.05 && Math.abs(dr - Math.PI) > 0.05) return;
      var dy = o.y1 - sd.y1; if (dy < 0.1 || dy > 0.32 || Math.abs(o.y0 - sd.y0) > 0.1) return;
      var oW = sLongZ ? 2 * o.hd : 2 * o.hw, oL = sLongZ ? 2 * o.hw : 2 * o.hd; if (Math.abs(oW - sl) > 0.25 || oL < 1.1 || oL > 2.2) return;
      var Lc = solidLocal(sd, o.x, o.z), off = sLongZ ? Lc[0] : Lc[1], lat = sLongZ ? Lc[1] : Lc[0]; if (Math.abs(lat) > 0.12 || Math.abs(Math.abs(off) - (ss / 2 + oL / 2)) > 0.15) return; best = o; }); return best; }
  function infoOf(sd) {
    if (sd._se && sd._se.v === SOLIDS.length + ":" + (sd.face || 0)) return sd._se;
    var I = { v: SOLIDS.length + ":" + (sd.face || 0) }; var h = sd.y1 - sd.y0, L = 2 * Math.max(sd.hw, sd.hd), W = 2 * Math.min(sd.hw, sd.hd);
    I.floor = sd.y0; if (h > 0.95) { I.floor = sd.y1 - 0.46; h = 0.46; I.cam = "bleacher"; }   // grandstand rows and plinth benches: the feet go on the step below
    I.H = h;
    if (sd.tub !== undefined || sd.bath || sd.pool) { I.fam = "sit"; I.idle = "tub"; I.cam = "tub"; }
    else if (sd.table !== undefined || sd.lie === 2) { I.fam = "lie"; I.cam = "bed"; }
    else if (sd.lie === 1) { I.fam = "rec"; I.cam = "lounger"; }
    else if (sd.lie === true) { I.fam = L > 1.6 && sd.y1 - sd.y0 > 0.6 ? "lie" : "rec"; I.cam = L > 1.6 && sd.y1 - sd.y0 > 0.6 ? "hammock" : "lounger"; }
    else {
      var mt = (sd.tag === "room" || sd.rh) && L < 2.3 ? mattressOf(sd) : null;
      if (mt) { I.fam = "lie"; I.cam = "bed"; I.mat = mt; I.H = h - 0.03; }   // R19b: the duvet's visible top is 3 cm under the foot seat (rooms_homes bed(): seat mh + 0.1, duvet top mh + 0.07); v1 lifted 6 cm and the body hovered
      else if (L >= 1.8 && W >= 0.8 && h > 0.3 && h < 0.8) { I.fam = "lie"; I.cam = "bed"; }   // bunks and plain beds registered as one seat
      else if (h >= 0.6) { I.fam = "stool"; I.cam = "stool"; }
      else { I.fam = "sit"; I.cam = I.cam || (L >= 1.15 ? (W >= 0.55 && h < 0.47 ? "sofa" : "bench") : "chair"); }
    }
    I.idle = I.idle || (I.fam === "stool" ? "stool" : "sit");
    I.prompt = (D && D.prompt && D.prompt[I.cam]) || (I.fam === "lie" ? "lie down" : I.fam === "rec" ? "stretch out" : "sit down");
    sd._se = I; return I; }
  SE.infoOf = infoOf;
  // a backrest behind the seat (a taller solid touching its back edge) and a counter in front (a bar)
  function backOf(sd, face) { var f = faceVec(face), hd = extentAlong(sd, f), bx = sd.x - f[0] * (hd + 0.08), bz = sd.z - f[1] * (hd + 0.08); var hit = null;
    solidsNear(bx, bz, 0.5).forEach(function (o) { if (o === sd || o.seat) return; if (o.y1 < sd.y1 + 0.22 || o.y0 > sd.y1 + 0.1) return; if (inBox(o, bx, bz, 0.12) || inBox(o, sd.x - f[0] * hd, sd.z - f[1] * hd, 0.04)) hit = o; }); return hit; }
  function counterOf(sd, face) { var f = faceVec(face), hd = extentAlong(sd, f), hit = null; for (var d = 0.15; d <= 0.75 && !hit; d += 0.15) { var x = sd.x + f[0] * (hd + d), z = sd.z + f[1] * (hd + d);
      solidsNear(x, z, 0.3).forEach(function (o) { if (hit || o === sd || o.seat) return; if (o.y1 < sd.y1 + 0.18 || o.y1 > sd.y1 + 0.55 || o.y0 > sd.y1) return; if (inBox(o, x, z, 0.05)) hit = o; }); } return hit; }
  // where on the seat: slots along a long seat, away from other sitters
  function takenAt(x, z, me) { try { for (var it of avatars) { var g = it[1].g; if (!g || !g.visible || g === me) continue; if (Math.hypot(g.position.x - x, g.position.z - z) < 0.42) return true; } } catch (e) {}
    try { var R = window.PLAN_ROAM; if (R && R.near && R.near(x, z, 0.35)) return true; } catch (e) {} return false; }

  // ───────────────────────── the player's seat state ─────────────────────────
  var ST = SE.st = null;   // { sd, I, fam, idle, cam, wH, H, ph: 'in'|'idle'|'out', t, ... }
  var EK = { at: 0 };
  window.addEventListener("keydown", function (e) { if (e.code === "KeyE" && !e.repeat) EK.at = now(); }, true);
  try { document.addEventListener("pointerdown", function (e) { var t = e.target; if (t && t.closest && t.closest("#tbtns")) EK.at = now(); }, true); } catch (e) {}
  function userWantsUp() { try { if (keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD || keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight || keys.Space || (joy && joy.active)) return true; } catch (e) {} return now() - EK.at < 400; }
  function bodyOf(g) { return g.userData.body === "f" ? "f" : "m"; }
  function kSOf(g) { var C = typeof CHAR !== "undefined" && CHAR[bodyOf(g)]; return (C ? C.scale : 1) * (g.userData.hf || 1); }
  function metaOf(b, fam, wH) { var M = D && D.meta && D.meta[b]; var A = M && M[fam + "_a"], B = M && M[fam + "_b"]; if (!A || !B) return null;
    function L2(a, b2) { return [lerp(a[0], b2[0], wH), lerp(a[1], b2[1], wH)]; }
    var o = { H: lerp(A.H, B.H, wH), hip: L2(A.hip, B.hip), cz: lerp(A.cz, B.cz, wH), bz: lerp(A.bz, B.bz, wH), head: L2(A.head, B.head), t1: A.t1, dd: A.dd, du: A.du, t2: A.t2 };
    if (A.edge) o.edge = { hip: L2(A.edge.hip, B.edge.hip), cz: lerp(A.edge.cz, B.edge.cz, wH) }; return o; }
  var HR = { sit: [0.38, 0.52], stool: [0.64, 0.82], lie: [0.42, 0.68], rec: [0.30, 0.46] };
  function wHOf(fam, H) { var r = HR[fam]; return clamp((H - r[0]) / (r[1] - r[0]), 0, 1); }

  // the seat plan: everything a sitter (us or a remote player) needs, in the player's frame (+z = the facing)
  function planSit(sd, I, face, from) {
    var f = faceVec(face), r = [Math.cos(face), -Math.sin(face)], hd = extentAlong(sd, f), hl = extentAlong(sd, r), P = { fam: I.fam, idle: I.idle, cam: I.cam, H: I.H, dx: 0, dz: 0, side: 0, inset: 0 };
    if (I.fam === "lie" || I.fam === "rec") return planLie(sd, I, face, from, P);
    if (hl > 0.42) { var n = Math.max(1, Math.floor((2 * hl + 0.05) / 0.62)), step = (2 * hl) / n, best = null, bd = 1e9; var want = from ? (from.x - sd.x) * r[0] + (from.z - sd.z) * r[1] : 0;
      for (var i = 0; i < n; i++) { var s = -hl + step * (i + 0.5); var x = sd.x + r[0] * s, z = sd.z + r[1] * s; var d = Math.abs(s - want) + (takenAt(x, z, player) ? 50 : 0); if (d < bd) { bd = d; best = s; } } P.slot = best; }
    var bk = I.fam === "sit" && I.idle !== "tub" ? backOf(sd, face) : null; P.back = !!bk;
    if (I.fam === "stool") { var ct = counterOf(sd, face); if (ct) { P.idle = "bar"; P.cam = "bar"; P.bar = ct.y1 - sd.y1; } }
    P.contact = bk ? -hd : (hd > 0.32 ? -hd + 0.26 : 0);   // along the facing from the seat centre: the back plane on the backrest, or the cushion
    return P; }
  function planLie(sd, I, face, from, P) {
    // the bed: its box (the seat, or the seat with its mattress), its long axis, the head end, the side we get on from
    var host = !I.mat && 2 * Math.max(sd.hw, sd.hd) < 1.5 ? hostOf(sd) : null;
    var bx = I.mat ? unionBox(sd, I.mat) : host ? { x: host.x, z: host.z, ry: host.ry, hw: host.hw, hd: host.hd, y1: sd.y1 } : { x: sd.x, z: sd.z, ry: sd.ry, hw: sd.hw, hd: sd.hd, y1: sd.y1 };
    var A = axesOf(bx), longZ = bx.hd >= bx.hw, ax = longZ ? A.lz : A.lx, hl = longZ ? bx.hd : bx.hw, hw = longZ ? bx.hw : bx.hd, sx = longZ ? A.lx : A.lz;
    var fv = faceVec(typeof sd.face === "number" ? sd.face : face), along = fv[0] * ax[0] + fv[1] * ax[1], head;
    if (Math.abs(along) > 0.7) head = along > 0 ? [-ax[0], -ax[1]] : [ax[0], ax[1]];   // a seat facing along the bed faces the foot end
    else { head = headEndOf(bx, ax, hl) || [-ax[0], -ax[1]]; }
    // the near side: toward where we stand
    var px = from ? from.x : player.position.x, pz = from ? from.z : player.position.z, sgn = ((px - bx.x) * sx[0] + (pz - bx.z) * sx[1]) >= 0 ? 1 : -1; var n = [sx[0] * sgn, sx[1] * sgn];
    if (I.cam === "hammock" || I.fam === "rec") { /* a lounger: get on from whichever side is free */ }
    P.face = Math.atan2(n[0], n[1]);
    // the lying anchor (hips): on a wide bed the near half's centre line, along the bed so the head is on the pillow
    var M = metaOf(bodyOf(player), P.fam, wHOf(P.fam, I.H)) || { head: [0, -1.1], hip: [0, -0.5] }; var kS = kSOf(player); var hh = Math.abs(M.head[1] - M.hip[1]) * kS;
    var inset = hw > 0.62 ? Math.min(hw - 0.42, hw * 0.5) : 0; var sh = clamp(hl - 0.3 - hh, -hl + 0.6, hl - 0.6);
    var ax2 = [head[0], head[1]]; var Ax = bx.x + ax2[0] * sh + n[0] * inset, Az = bx.z + ax2[1] * sh + n[1] * inset;
    // T0: where the hips' final point sits during the edge sit (0.38 in from the edge), and the slide in to the anchor
    var edgeIn = hw - 0.38; P.inset = Math.max(0, edgeIn - inset);
    P.ax = Ax; P.az = Az; P.top = sd.y1 + (I.mat ? -0.03 : 0);
    var hl_ = [head[0], head[1]]; var bl = [hl_[0] * Math.cos(P.face) - hl_[1] * Math.sin(P.face), hl_[0] * Math.sin(P.face) + hl_[1] * Math.cos(P.face)];   // the head direction in the player's frame (x, z)
    P.side = bl[0] >= 0 ? -1 : 1;   // turn so the feet (+z of the body) end toward the foot end (minus the head direction)
    P.headW = head; return P; }
  function hostOf(sd) { var best = null; solidsNear(sd.x, sd.z, 1.3).forEach(function (o) { if (o === sd || o.seat) return; var L = 2 * Math.max(o.hw, o.hd); if (L < 1.6 || L > 2.6 || o.y1 < sd.y1 - 0.3 || o.y1 > sd.y1 + 0.45) return; if (!inBox(o, sd.x, sd.z, 0.05)) return; if (!best || L > 2 * Math.max(best.hw, best.hd)) best = o; }); return best; }
  function unionBox(a, b) { var A = axesOf(a), longZ = (a.hd >= a.hw) === (b.hd >= b.hw); var ax = (a.hd >= a.hw) ? A.lz : A.lx; var pts = [];
    [a, b].forEach(function (o) { var Ao = axesOf(o); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { pts.push([o.x + Ao.lx[0] * o.hw * q[0] + Ao.lz[0] * o.hd * q[1], o.z + Ao.lx[1] * o.hw * q[0] + Ao.lz[1] * o.hd * q[1]]); }); });
    var c = [(a.x + b.x) / 2, (a.z + b.z) / 2]; var lo = [1e9, 1e9], hi = [-1e9, -1e9];
    pts.forEach(function (p) { var L = solidLocal({ x: c[0], z: c[1], ry: a.ry }, p[0], p[1]); lo[0] = Math.min(lo[0], L[0]); lo[1] = Math.min(lo[1], L[1]); hi[0] = Math.max(hi[0], L[0]); hi[1] = Math.max(hi[1], L[1]); });
    var mx = (lo[0] + hi[0]) / 2, mz = (lo[1] + hi[1]) / 2, cc = Math.cos(a.ry), ss = Math.sin(a.ry);
    return { x: c[0] + mx * cc + mz * ss, z: c[1] - mx * ss + mz * cc, ry: a.ry, hw: (hi[0] - lo[0]) / 2, hd: (hi[1] - lo[1]) / 2, y1: a.y1 }; }
  function headEndOf(bx, ax, hl) {   // a headboard: a tall solid at one short end
    var best = null; [1, -1].forEach(function (s) { var x = bx.x + ax[0] * s * (hl + 0.08), z = bx.z + ax[1] * s * (hl + 0.08);
      solidsNear(x, z, 0.4).forEach(function (o) { if (best || o.seat) return; if (o.y1 < bx.y1 + 0.25) return; if (inBox(o, x, z, 0.12)) best = [ax[0] * s, ax[1] * s]; }); }); return best; }

  // ───────────────────────── a sitter (the player or a remote avatar): its state and the per-frame pose ─────────────────────────
  function makeSt(g, P, remote) {
    var b = bodyOf(g), wH = wHOf(P.fam, P.H); var M = metaOf(b, P.fam, wH);
    var st = { g: g, P: P, b: b, wH: wH, M: M, ph: "in", t: 0, ta: 0, tw: 0, snap: snapOf(bonesOf(g), Pose()), snapW: 1, pose: Pose(), last: Pose(), remote: !!remote, t0: now() };
    st.idleName = P.idle === "tub" ? "tub_idle" : P.idle === "bar" ? "stool_bar" : P.fam === "stool" ? "stool_idle" : P.fam + "_idle";
    st.inName = (P.fam === "stool" ? "stool" : P.fam) + "_down"; st.outName = (P.fam === "stool" ? "stool" : P.fam) + "_up";
    return st; }
  // the walk group's place (player frame) for clip time t in the state's phase: sit families keep the root fixed; lying
  // families turn about the final hips point and slide in from the edge
  function placeWalk(st, w, kS) {
    var P = st.P, M = st.M; if (!M) return; var y = -M.H * kS; var u = st.g.userData;
    if (P.fam === "sit" || P.fam === "stool") {
      // the body's back plane (bz, from the root) on the backrest, or the buttock contact (cz) on the cushion
      var rootZ = P.back ? P.contact - M.bz * kS + 0.02 : P.contact - M.cz * kS; var rootX = P.slotL || 0;
      var tx = rootX + (P.dx || 0), tz = rootZ + (P.dz || 0);
      w.position.set(tx, y + (P.dy || 0), tz); w.rotation.set(0, 0, 0); st.root = [tx, tz]; return; }
    // lie / recline: a(t) is the turn, s(t) the slide from the edge to the anchor
    var a = 0, s = 0, t = st.t;
    if (st.ph === "in") { var u2 = clamp((t - M.t1) / (M.dd - M.t1), 0, 1); a = sm((u2 - 0.22) / 0.6); s = sm((u2 - 0.1) / 0.75); }   /* R19b: the turn waits until the feet are off the floor and ends as the legs settle */
    else if (st.ph === "idle") { a = 1; s = 1; }
    else { var T2 = M.t2; var u3 = clamp(t / T2, 0, 1); a = 1 - sm((u3 - 0.04) / 0.55); s = 1 - sm((u3 - 0.08) / 0.6); }   /* the turn back is done before the feet reach the floor */
    var A = P.side * HP * a; var hz = M.hip[1] * kS; var Tz = (P.inset || 0) * (1 - s) + (P.dz || 0), Tx = P.dx || 0;
    // world = T + R(A) * (p - Phip): the walk origin is T - R(A) * Phip
    var c = Math.cos(A), sn = Math.sin(A); w.position.set(Tx - (sn * hz), y + (P.dy || 0), Tz - (c * hz)); w.rotation.set(0, A, 0); st.root = [w.position.x, w.position.z]; }
  // one frame of a sitter; returns false when it is done (released)
  var _wp = Pose();
  function stepSt(st, dt) {
    var g = st.g, u = g.userData, B = bonesOf(g); var L = LIB[st.b]; if (!L || !u.walk) return true; var kS = kSOf(g); var P = st.P;
    if (st.M === null || st.M === undefined) st.M = metaOf(st.b, P.fam, st.wH); if (!st.M) return true;
    st.t += dt; var name, t;
    if (st.ph === "in") {
      // the approach: walk the body from where it stood to the seat's stand spot, turning to face away from it
      var ta = st.ta || 0;
      if (st.app && st.tw < ta) { st.tw = Math.min(ta, st.tw + dt); var ua = sm(st.tw / ta); var W0 = st.app;
        placeWalk(st, u.walk, kS); var tx = u.walk.position.x, tz = u.walk.position.z, ty = u.walk.position.y, tr = u.walk.rotation.y;
        u.walk.position.set(lerp(W0.x, tx, ua), lerp(W0.y, ty, sm(st.tw / ta * 1.5)), lerp(W0.z, tz, ua)); u.walk.rotation.set(0, tr + wrapA(W0.r - tr) * (1 - sm(st.tw / (ta * 0.85))), 0);
        famPose(L, st.inName, st.wH, 0, st.pose); var wr = walkRec(st.b); var wk = Math.sin(Math.PI * clamp(st.tw / ta, 0, 1)) * (st.appD > 0.2 ? 1 : 0.5);
        if (wr && wk > 0.01) { st.wt = (st.wt || 0.3) + dt * 1.15; sampleInto(wr, st.wt % wr.dur, _wp); _wp.hasP = false; for (var j = 0; j < 3; j++) _wp.p[j] = st.pose.p[j]; mixInto(st.pose, _wp, wk * 0.85, st.pose); }
        st.t = 0; finish(st, B, dt); return true; }
      name = st.inName; t = st.t; if (t >= durOf(L, name)) { st.ph = "idle"; st.t = 0; name = st.idleName; t = 0; }
    } else if (st.ph === "idle") { name = st.idleName; var di = durOf(L, name); t = st.t % di; }
    else if (st.ph === "out") { name = st.outName; t = st.t; if (t >= durOf(L, name)) { return false; } }
    famPose(L, name, st.wH, t, st.pose); placeWalk(st, u.walk, kS); finish(st, B, dt); return true; }
  function finish(st, B, dt) {
    // blend out of the snapshot (the pose the character had when the state began) over 0.35 s
    if (st.snapW > 0) { st.snapW = Math.max(0, st.snapW - dt / 0.35); mixInto(st.pose, st.snap, sm(st.snapW), st.last); writePose(B, st.last, 1); }
    else { writePose(B, st.pose, 1); var tmp = st.last; st.last = st.pose; st.pose = tmp; }
    st.g.userData.sitOff = true; }
  function restart(st, ph) { st.snap = snapOf(bonesOf(st.g), st.snap); st.snapW = 1; st.ph = ph; st.t = 0; }
  function release(g, hard) {
    var u = g.userData; if (u.walk) { u.walk.rotation.set(0, 0, 0); if (!(g === player && typeof cartMode !== "undefined" && cartMode)) u.walk.position.set(0, 0, 0); }
    u.sitOff = false;
    try { if (u.w && u.acts) { u.w.sit = 0; u.w.idle = 1; if (u.acts.sit) u.acts.sit.setEffectiveWeight(0); if (u.acts.idle) u.acts.idle.setEffectiveWeight(1); } } catch (e) {} }

  // ───────────────────────── wrapping the client's sit system ─────────────────────────
  var WR = SE.wr = SE.wr || { done: false };
  function install() {
    if (WR.done) return; if (typeof sitDown !== "function" || typeof standUp !== "function" || typeof nearestSeat !== "function") return; WR.done = true;
    var oSit = sitDown, oStand = standUp, oNear = nearestSeat, oPose = typeof poseNow === "function" ? poseNow : null, oZone = typeof updateZone === "function" ? updateZone : null;
    WR.oSit = oSit; WR.oStand = oStand;
    sitDown = window.sitDown = function (sd) {
      var g = player, pre = null; try { if (g && g.userData.walk && g.userData.mixer && !SE.off && LIB[bodyOf(g)] && D && bonesOf(g)[0]) { pre = { x: g.position.x, y: g.position.y, z: g.position.z, r: g.rotation.y, from: { x: g.position.x, z: g.position.z }, wy: g.userData.walk.position.y }; } } catch (e) { note("pre", e); }
      if (ST) { try { release(player); } catch (e) {} ST = SE.st = null; }
      var r = oSit.apply(this, arguments); if (!pre || !SIT.on) return r;
      try { begin(sd, pre); } catch (e) { note("begin", e); ST = SE.st = null; try { release(player); sitOffset(player); } catch (x) {} }
      return r; };
    standUp = window.standUp = function () {
      if (!ST || !SIT.on) { if (ST) { endNow(); } return oStand.apply(this, arguments); }
      if (ST.ph === "out") return;   // already getting up
      if (ST.ph === "in" && ST.app && ST.tw < ST.ta) { var sc = ST; ST = SE.st = null; standFinish(sc); return; }
      if (WR.forceStand || !userWantsUp()) { endNow(); return oStand.apply(this, arguments); }
      restart(ST, "out"); ST.camOut = now(); SE.n.stands++; return; };
    var NBC = { at: 0, x: 0, z: 0, v: null };
    nearestSeat = window.nearestSeat = function () { var r = oNear.apply(this, arguments); try { if (!SE.off && D && typeof inside !== "undefined" && inside) { var t = now(), px = player.position.x, pz = player.position.z;
          if (t - NBC.at > 160 || Math.abs(px - NBC.x) + Math.abs(pz - NBC.z) > 0.25) { NBC.at = t; NBC.x = px; NBC.z = pz; NBC.v = nearestBed(r); } if (NBC.v && (!r || NBC.v !== r)) { var sdr = r ? Math.hypot(r.x - px, r.z - pz) : 9; var L = solidLocal(NBC.v, px, pz); var db = Math.hypot(Math.max(0, Math.abs(L[0]) - NBC.v.hw), Math.max(0, Math.abs(L[1]) - NBC.v.hd)); if (db < sdr) return NBC.v; } } } catch (e) { note("near", e); } return r; };
    if (oPose) poseNow = window.poseNow = function () { var r = oPose.apply(this, arguments); try { if (r === "sit" && ST) return poseStr(ST); } catch (e) {} return r; };
    if (oZone) updateZone = window.updateZone = function () { var r = oZone.apply(this, arguments); try { zonePrompt(); } catch (e) { note("zone", e); } return r; };
    SE.n.installed = 1; }
  function endNow() { if (!ST) return; try { release(player, true); } catch (e) {} camRelease(); ST = SE.st = null; }
  // a free-standing bed solid that is not registered as a seat (a mattress or a bunk), when no proper seat is closer
  function nearestBed(seat) {
    if (typeof inside === "undefined" || !inside) return null; var px = player.position.x, pz = player.position.z, py = player.position.y; var sd0 = seat ? Math.hypot(seat.x - px, seat.z - pz) : 9, best = null, bd = Math.min(1.5, sd0 - 0.05);
    if (seat && infoOf(seat).fam === "lie") return null;
    var S = SOLIDS; for (var i = 0; i < S.length; i++) { var o = S[i]; if (o.seat || o.tag !== "room") continue; var L = 2 * Math.max(o.hw, o.hd), W = 2 * Math.min(o.hw, o.hd), h = o.y1 - o.y0; if (L < 1.85 || L > 2.5 || W < 0.85 || W > 2.2 || h < 0.35 || h > 0.75 || Math.abs(o.y0 - py) > 0.5) continue;
      var Lc = solidLocal(o, px, pz); var d = Math.max(0, Math.hypot(Math.max(0, Math.abs(Lc[0]) - o.hw), Math.max(0, Math.abs(Lc[1]) - o.hd))); if (d >= bd) continue;
      var bxx = { x: o.x, z: o.z, ry: o.ry, hw: o.hw, hd: o.hd, y1: o.y1 }; var A = axesOf(o), longZ = o.hd >= o.hw; if (!headEndOf(bxx, longZ ? A.lz : A.lx, longZ ? o.hd : o.hw)) continue;   // a bed has a headboard; a table does not
      bd = d; best = o; }
    if (best) { best._seBed = true; SE.n.beds++; } return best; }
  function poseStr(st) { var P = st.P; var f = P.fam === "sit" ? "s" : P.fam === "stool" ? "t" : P.fam === "lie" ? "l" : "r"; var id = P.idle === "tub" ? "t" : P.idle === "bar" ? "b" : "i"; var ph = st.ph === "out" ? "u" : "i";
    function cm(v) { return String(Math.round((v || 0) * 100)); }
    return "seat:" + f + id + ph + "." + cm(P.H) + "." + cm(P.dx) + "." + cm(P.dz) + "." + (P.side || 0) + "." + cm(P.inset) + "." + (P.back ? 1 : 0) + "." + cm(P.contact); }
  function parsePose(s) { var m = /^seat:([stlr])([itb])([iu])\.(-?\d+)\.(-?\d+)\.(-?\d+)\.(-?1|0)\.(-?\d+)\.(-?\d+)\.(-?\d+)$/.exec(s || ""); if (!m) return null;
    var fam = { s: "sit", t: "stool", l: "lie", r: "rec" }[m[1]]; return { fam: fam, idle: m[2] === "t" ? "tub" : m[2] === "b" ? "bar" : fam === "stool" ? "stool" : "sit", up: m[3] === "u", H: +m[4] / 100, slotL: 0, dx: +m[5] / 100, dz: +m[6] / 100, side: +m[7], inset: +m[8] / 100, back: +m[9] > 0, contact: +m[10] / 100 }; }
  SE.parsePose = parsePose;

  // the player sat down (the client has placed the player on the seat and turned them): plan, approach, animate
  function begin(sd, pre) {
    var I = infoOf(sd), face = player.rotation.y; var P = planSit(sd, I, face, pre.from);
    if (P.face !== undefined) { player.rotation.y = P.face; face = P.face; }
    // the client put player.position on the seat (slid along a long bench); our slot and the lying anchor are offsets from it
    var f = faceVec(face), r = [Math.cos(face), -Math.sin(face)];
    if (I.fam === "lie" || I.fam === "rec") { var dxw = P.ax - player.position.x, dzw = P.az - player.position.z, c0 = Math.cos(face), s0 = Math.sin(face); P.dx = dxw * c0 - dzw * s0; P.dz = dxw * s0 + dzw * c0; P.dy = (P.top - sd.y1); SIT.y = sd.y1; player.position.y = SIT.y; }
    else { var cx = sd.x + (P.slot !== undefined ? r[0] * P.slot : 0), cz = sd.z + (P.slot !== undefined ? r[1] * P.slot : 0); if (P.slot !== undefined) { player.position.x = cx; player.position.z = cz; } else { cx = player.position.x; cz = player.position.z; }
      P.contact += -((player.position.x - sd.x) * f[0] + (player.position.z - sd.z) * f[1]); P.slotL = 0; P.dy = 0; SIT.y = sd.y1; player.position.y = SIT.y; }
    var st = makeSt(player, P, false); st.sd = sd;
    // where the body is now, in the player's (new) frame: the approach starts there
    var dx = pre.x - player.position.x, dz = pre.z - player.position.z, c = Math.cos(-face), s = Math.sin(-face);
    st.app = { x: dx * c + dz * s, y: (pre.y - player.position.y) + (pre.wy || 0), z: -dx * s + dz * c, r: wrapA(pre.r - face) };
    var kS = kSOf(player); var tmp = { position: new THREE.Vector3(), rotation: new THREE.Euler() }; placeWalk(st, tmp, kS);
    st.appD = Math.hypot(st.app.x - tmp.position.x, st.app.z - tmp.position.z); st.ta = clamp(0.25 + st.appD / 1.3 + Math.abs(wrapA(st.app.r - tmp.rotation.y)) * 0.12, 0.3, 1.25); st.tw = 0;
    ST = SE.st = st; if (I.fam === "lie" || I.fam === "rec") SE.n.lies++; else SE.n.sits++;
    try { if (window.PLAN_SPA) PLAN_SPA.sat = null; } catch (e) {}
    try { var stl = D && D.status; var k = P.idle === "tub" ? "tub" : P.fam === "lie" ? "lie" : P.fam === "rec" ? "rec" : "sit"; if (stl && stl[k] && !(sd.spa && (sd.lie || sd.table !== undefined))) setStatus(stl[k]); } catch (e) {}
    camBegin(st); }

  // ───────────────────────── the frame: the player's state machine, remote sitters, the bone pose last ─────────────────────────
  var REM = SE.rem = new Map();
  function frameHook(dt) {
    if (SE.off || typeof player === "undefined" || !player) return; dt = Math.min(dt || 0.016, 0.1); install();
    if (!LIB.m) loadLib("m"); if (!LIB.f) loadLib("f");
    keepLast();
    if (ST) {
      if (!SIT.on || ST.g !== player) { SE.n.aborts++; endNow(); }
      else {
        try { if (window.PLAN_SPA) PLAN_SPA.sat = null; } catch (e) {}
        var alive = stepSt(ST, SE.paused ? 0 : dt);
        // the camera runs before this hook (with the mixer's pose still on the bones): it frames the head we posed last frame
        try { var Bh = bonesOf(player); if (Bh[17] && alive) { Bh[17].updateWorldMatrix(true, false); (CM.headW || (CM.headW = new THREE.Vector3())).setFromMatrixPosition(Bh[17].matrixWorld); CM.headAt = now(); } } catch (e) {}
        if (!alive) { var st = ST; ST = SE.st = null; standFinish(st); }
      } }
    if (SE.rel) relFrame(dt);
    try { remoteFrame(dt); } catch (e) { note("remote", e); } }
  // after the stand clip: the client's own stand up (and every wrapper's: r14out and the rest) moves the player; the body
  // keeps its place and is blended home, so nothing jumps
  function standFinish(st) {
    var g = player, u = g.userData, w = u.walk; var wp = new THREE.Vector3(); w.updateMatrixWorld(true); w.getWorldPosition(wp); var ry0 = g.rotation.y + w.rotation.y;
    WR.forceStand = true; try { WR.oStand.apply(window, []); } catch (e) { note("stand", e); } WR.forceStand = false;
    release(g); var c = Math.cos(-g.rotation.y), s = Math.sin(-g.rotation.y), dx = wp.x - g.position.x, dz = wp.z - g.position.z;
    SE.rel = { g: g, x: dx * c + dz * s, z: -dx * s + dz * c, y: 0, r: wrapA(ry0 - g.rotation.y), k: 0, pose: st.last, snapW: 1 };
    camRelease(); }
  function relFrame(dt) { var R = SE.rel, g = R.g, u = g.userData; R.k += dt / 0.35; if (R.k >= 1 || SIT.on) { if (!SIT.on && u.walk) { u.walk.position.set(0, 0, 0); u.walk.rotation.set(0, 0, 0); } SE.rel = null; return; }
    var e = 1 - sm(R.k); if (u.walk) { u.walk.position.set(R.x * e, 0, R.z * e); u.walk.rotation.set(0, R.r * e, 0); } writePose(bonesOf(g), R.pose, e); }
  // other players: the pose field says what they sit on and how; their avatar is already moved and turned by the client
  function remoteFrame(dt) {
    if (typeof view === "undefined" || !view || !view.players || typeof avatars === "undefined") return; var seen = 0;
    for (var it of avatars) { var id = it[0], a = it[1], g = a && a.g; if (!g || !g.userData.walk) continue; var p = view.players[id]; var ps = p && typeof p.pose === "string" && p.pose.indexOf("seat:") === 0 ? p.pose : null; var R = REM.get(id);
      if (!ps) { if (R) { if (R.st && R.st.ph !== "out" && R.st.ph !== "done") { restart(R.st, "out"); } if (R.st && R.st.ph !== "done") { if (!stepSt(R.st, dt)) { release(g); REM.delete(id); } } else { release(g); REM.delete(id); } } continue; }
      if (!g.visible || camera.position.distanceToSquared(g.position) > 140 * 140) continue;
      var P = parsePose(ps); if (!P || !g.userData.mixer || !bonesOf(g)[0]) continue; seen++;
      if (!R || R.key !== ps.replace(/^seat:(..)[iu]/, "$1") || R.g !== g) { if (R && R.g === g) release(g); R = { key: ps.replace(/^seat:(..)[iu]/, "$1"), g: g, st: makeSt(g, P, true) }; R.st.snapW = 1; REM.set(id, R); }
      if (P.up && R.st.ph !== "out") restart(R.st, "out");
      if (!LIB[R.st.b]) { loadLib(R.st.b); continue; }
      if (R.st.ph === "out" && R.st.t >= durOf(LIB[R.st.b], R.st.outName) - 0.02) { famPose(LIB[R.st.b], R.st.outName, R.st.wH, R.st.t, R.st.pose); writePose(bonesOf(g), R.st.pose, 1); placeWalk(R.st, g.userData.walk, kSOf(g)); continue; }
      stepSt(R.st, dt); }
    SE.n.remote = seen; }
  function keepLast() { var L = PLAN_HOOKS.frame; if (L[L.length - 1] !== HOOK) { var i = L.indexOf(HOOK); if (i >= 0) L.splice(i, 1); L.push(HOOK); } }

  // ───────────────────────── the prompt ─────────────────────────
  function zonePrompt() {
    var pt = document.getElementById("prompt-t"), pr = document.getElementById("prompt"); if (!pt || !pr || typeof player === "undefined" || !player) return;
    if (ST && SIT.on) { var tx = "<b>E</b> &nbsp;" + ((D && D.prompt && D.prompt[ST.P.fam === "lie" || ST.P.fam === "rec" ? "getup" : "stand"]) || "stand up"); if (pt.innerHTML !== tx) pt.innerHTML = tx; pr.classList.add("on"); return; }
    if (SIT.on || (typeof riding !== "undefined" && riding) || (typeof cartMode !== "undefined" && cartMode) || (typeof golf !== "undefined" && golf.playing)) return;
    var sd = nearestSeat(); if (!sd) return; var I = infoOf(sd); var txt = "<b>E</b> &nbsp;" + I.prompt;
    if (pr.classList.contains("on")) { if (/sit down/.test(pt.textContent)) pt.innerHTML = txt; return; }
    pt.innerHTML = txt; pr.classList.add("on"); }

  // ───────────────────────── the seat camera ─────────────────────────
  var CM = SE.cam = { on: false };
  function camBegin(st) { CM.on = true; CM.t0 = now(); CM.st = st; CM.from = camera.position.clone(); CM.look0 = (CAM && CAM.init ? CAM.look.clone() : camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(6).add(camera.position)); CM.yaw0 = yaw; CM.pitch0 = pitch; CM.d = null; CM.pos = camera.position.clone(); CM.look = CM.look0.clone(); CM.out = 0; }
  function camRelease() { if (!CM.on) return; CM.on = false;
    try { var px = player.position.x, pz = player.position.z; var dx = camera.position.x - px, dz = camera.position.z - pz; yaw = Math.atan2(dx, dz); CAM.dist = Math.max(2.5, Math.hypot(dx, dz)); CAM.look.copy(CM.look); CAM.init = true; pitch = clamp(pitch, -0.2, 0.5); } catch (e) {} }
  var _head = new THREE.Vector3(), _cp = new THREE.Vector3(), _lk = new THREE.Vector3(), _hp = new THREE.Vector3();
  function camHook(dt) {
    if (SE.dbgCam && ST) { camera.position.copy(SE.dbgCam.pos); camera.lookAt(SE.dbgCam.look); return true; }
    if (!CM.on || !ST || SE.off || (typeof FPV !== "undefined" && FPV) || (typeof VRX !== "undefined" && VRX.on)) return false; var st = ST; var P = st.P; dt = Math.min(dt || 0.016, 0.1);
    if (CM.headW && now() - (CM.headAt || 0) < 500) _head.copy(CM.headW); else _head.copy(player.position).setY(player.position.y + 0.75);
    var pre = (D && D.cam && D.cam[P.cam]) || { o: [0.45, 0.3, -1.45], l: [0, -0.35, 2.6] }; var face = player.rotation.y; var dyaw = clamp(wrapA(yaw - CM.yaw0), -1.25, 1.25), dp = clamp(pitch - CM.pitch0, -0.45, 0.55);
    var lying = P.fam === "lie" || P.fam === "rec"; var f, r;
    if (lying) { var hd = P.headW || [0, 1]; f = hd; r = [Math.sin(face), Math.cos(face)]; }   // the bed frame: f = toward the head end, r = out the near side
    else { f = [Math.sin(face), Math.cos(face)]; r = [-Math.cos(face), Math.sin(face)]; }
    var o = pre.o, l = pre.l; var ox = r[0] * o[0] + f[0] * o[2], oz = r[1] * o[0] + f[1] * o[2], oy = o[1] + dp * 0.9; var lx = r[0] * l[0] + f[0] * l[2], lz = r[1] * l[0] + f[1] * l[2], ly = l[1] - dp * 1.6;
    var ca = Math.cos(dyaw), sa = Math.sin(dyaw); var rx = ox * ca + oz * sa, rz = -ox * sa + oz * ca; var qx = lx * ca + lz * sa, qz = -lx * sa + lz * ca;
    // stand up: drift toward a plain follow framing behind the player
    var outK = st.ph === "out" && st.camOut ? sm((now() - st.camOut) / 1000 / Math.max(0.6, durOf(LIB[st.b], st.outName))) : 0;
    if (outK > 0) { var bf = [Math.sin(face), Math.cos(face)]; rx = lerp(rx, -bf[0] * 3.4, outK); rz = lerp(rz, -bf[1] * 3.4, outK); oy = lerp(oy, 1.0, outK); qx = lerp(qx, bf[0] * 3, outK); qz = lerp(qz, bf[1] * 3, outK); ly = lerp(ly, -0.25, outK); }
    // collision: march out from the head, stop before a wall, a room's bounds, furniture taller than the camera, the ground
    // the framing's own line first; when a wall or a tall piece is in the way, the other shoulder, then higher and steeper
    nearSet(); var cand = CM.cand || (CM.cand = [[1, 1, 0], [-1, 1, 0], [1, 1.55, 0.55], [-1, 1.55, 0.55], [0.4, 2.1, 0.75]]), pick = null, bestFree = -1, full = 1, free = 1;
    for (var ci = 0; ci < cand.length; ci++) { var C = cand[ci]; var cx = rx, cz = rz; if (C[0] < 0) { var mx0 = r[0] * o[0] * 2 * (1 - outK), mz0 = r[1] * o[0] * 2 * (1 - outK); cx = rx - (mx0 * ca + mz0 * sa); cz = rz - (-mx0 * sa + mz0 * ca); }
      var hy = oy * C[1] + C[2] * 0.6, hk = 1 - C[2] * 0.35; cx *= hk; cz *= hk; var fl = Math.hypot(cx, hy, cz), fr = rayFree(cx, hy, cz, fl, st.sd);
      if (fr >= fl - 0.01 || fr >= 1.1) { pick = [cx, hy, cz]; full = fl; free = fr; break; } if (fr > bestFree) { bestFree = fr; pick = [cx, hy, cz]; full = fl; free = fr; } }
    rx = pick[0]; oy = pick[1]; rz = pick[2]; free = Math.max(free, 0.8); CM.dbg = { ci: ci, free: +free.toFixed(2), full: +full.toFixed(2), head: _head.toArray().map(function (v) { return +v.toFixed(2); }) };
    CM.d = CM.d === null ? free : CM.d + (free - CM.d) * (1 - Math.exp(-dt * (free < CM.d ? 16 : 3))); var sc = CM.d / Math.max(full, 1e-3);
    _cp.set(_head.x + rx * sc, _head.y + oy * sc, _head.z + rz * sc); _lk.set(_head.x + qx, _head.y + ly, _head.z + qz);
    var e = sm((now() - CM.t0) / 1300); var k2 = 1 - Math.exp(-dt * 9);
    if (e < 1) { CM.pos.lerpVectors(CM.from, _cp, e); CM.look.lerpVectors(CM.look0, _lk, sm((now() - CM.t0) / 1000)); }
    else { CM.pos.lerp(_cp, k2); CM.look.lerp(_lk, k2); }
    camera.position.copy(CM.pos); camera.lookAt(CM.look); try { CAM.look.copy(CM.look); CAM.init = true; } catch (x) {}
    if (player.userData.walk) player.userData.walk.visible = true;
    return true; }
  // the solids and colliders near the head, gathered every 12 frames (the full lists are tens of thousands long)
  var NEAR = { at: -99, x: 0, z: 0, s: [], c: [] };
  function nearSet() { var f = typeof FRAME_N !== "undefined" ? FRAME_N : 0; if (f - NEAR.at < 12 && Math.abs(_head.x - NEAR.x) + Math.abs(_head.z - NEAR.z) < 0.8) return; NEAR.at = f; NEAR.x = _head.x; NEAR.z = _head.z; NEAR.s.length = 0; NEAR.c.length = 0;
    var S = SOLIDS, R = 4.2; for (var i = 0; i < S.length; i++) { var o = S[i], m = R + o.hw + o.hd; if (Math.abs(o.x - _head.x) < m && Math.abs(o.z - _head.z) < m) NEAR.s.push(o); }
    var CL = typeof COLLIDERS !== "undefined" ? COLLIDERS : []; for (var j = 0; j < CL.length; j++) { var c = CL[j]; if (c[2] < 2.5) continue; var mm = R + c[2]; if (Math.abs(c[0] - _head.x) < mm && Math.abs(c[1] - _head.z) < mm) NEAR.c.push(c); } }
  function rayFree(dx, dy, dz, full, own) { var N = 14; for (var i = 1; i <= N; i++) { var k = i / N; if (blocked(_head.x + dx * k, _head.y + dy * k, _head.z + dz * k, own)) return Math.max(0, full * (i - 1) / N - 0.12); } return full; }
  SE.blockedAt = function (x, y, z) { return blocked(x, y, z, ST && ST.sd); };
  function blocked(x, y, z, own) {
    try { if (typeof inside !== "undefined" && inside && inside.door && inside.door.e) { var e = inside.door.e, h = inside.half - 0.22; var lx = (x - e[0]) * Math.cos(e[3]) - (z - e[2]) * Math.sin(e[3]), lz = (x - e[0]) * Math.sin(e[3]) + (z - e[2]) * Math.cos(e[3]); if (Math.abs(lx) > h || Math.abs(lz) > h + 1.2) return true; } } catch (e2) {}
    try { if (y < getH(x, z) + 0.3 && !(typeof inside !== "undefined" && inside)) return true; } catch (e3) {}
    var S = NEAR.s; for (var i = 0; i < S.length; i++) { var o = S[i]; if (o === own || Math.abs(o.x - x) > o.hw + o.hd + 0.2 || Math.abs(o.z - z) > o.hw + o.hd + 0.2) continue; if (y > o.y1 + 0.08 || y < o.y0 - 0.05) continue; if (inBox(o, x, z, 0.1)) return true; }
    if (!(typeof inside !== "undefined" && inside)) { var CL = NEAR.c; for (var j = 0; j < CL.length; j++) { var c = CL[j]; if (c[2] < 2.5) continue; var dx = x - c[0], dz = z - c[1]; if (dx * dx + dz * dz < c[2] * c[2] * 0.9) return true; } }
    return false; }

  var HOOK = { name: "seatFrame", fn: frameHook };
  PLAN_HOOKS.frame.push(HOOK);
  PLAN_HOOKS.interior.push({ name: "seatCam", fn: camHook });
  // ───────────────────────── debug / shots ─────────────────────────
  SE.debug = {
    state: function () { var s = ST; return s ? { ph: s.ph, t: +s.t.toFixed(2), fam: s.P.fam, idle: s.idleName, cam: s.P.cam, H: +s.P.H.toFixed(2), wH: +s.wH.toFixed(2), side: s.P.side, back: s.P.back, pose: poseStr(s) } : null; },
    sitAt: function (sd) { if (SIT.on) { WR.forceStand = true; try { standUp(); } finally { WR.forceStand = false; } } sitDown(sd); return SE.debug.state(); },
    pause: function (on) { SE.paused = !!on; },
    seek: function (ph, t) { var s = ST; if (!s) return null; s.ph = ph; s.t = t; s.snapW = 0; s.tw = s.ta; CM.t0 = now() - 5000; return SE.debug.state(); },
    cam: function (p, l) { SE.dbgCam = p ? { pos: new THREE.Vector3(p[0], p[1], p[2]), look: new THREE.Vector3(l[0], l[1], l[2]) } : null; },
    lib: function () { return { m: LIB.m ? Object.keys(LIB.m).length : 0, f: LIB.f ? Object.keys(LIB.f).length : 0 }; }
  };
})();
