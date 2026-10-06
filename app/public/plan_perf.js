// plan_perf.js: the performance pass (P1B, 30 Sep 2026). Classic script, loaded after the other plan_*.js and before client.js.
// window.PLAN_PERF:
//   - a frame clock and a toggleable overlay (F3, or ?perf=1): fps, frame-time graph, worst frame of the last 10 s, draw calls,
//     triangles, geometries, textures, programs, JS heap, load time;
//   - an anonymous session summary (avg fps, p95 frame time, long frames, load time, tier, GPU string), kept in localStorage
//     ("g1:perf", the last 10 sessions) and sent to window.PERF_ENDPOINT with sendBeacon when a deployment defines one;
//   - shader pre-compilation behind the loading screen: the whole scene plus a hidden sample of every interior (the hangar,
//     clubhouse, restaurant and hangar-home interiors, the FBO terminal and the other client rooms), with and without fog;
//   - an idle-time GPU warm-up queue (programs with compileAsync, textures with initTexture, geometry buffers with a 4 px render)
//     for interiors built ahead of the player and for lazily loaded model kinds;
//   - the per-frame budget the interior modules use for their staged (generator) builds: PLAN_PERF.step(iterator);
//   - indoor portal culling: inside the FBO, a hangar, the GBANK hall or a walk-in interior, outside objects and instances that
//     cannot be seen through the room's openings are not drawn (nor cast shadows), and the shadow map updates less often;
//   - two fixes for whole-scene shader recompiles: a spare hemisphere light keeps the light count constant when a room or the
//     fly-in cabin adds its fill light, and the key light keeps its shadow flag through the sun/moon hand-over.
// ?perf=0 turns the module off; ?pcull=0, ?pwarm=0, ?ppre=0, ?pfix=0 switch single parts off (A/B tests).
// P3 (1 Oct 2026, HANDOFF_P3.md): world matrices only where something moved (bones only after their mixer ran, far people asleep:
// PLAN_PERF.sleep), the shadow cascades take turns, flat transparent double-sided planes in one pass, bone roots out of the render
// walks. ?p3=0 turns every P3 part off (here, in client.js and in plan_stream.js); ?pmw=0, ?psh=0, ?pfs=0, ?pbv=0 single parts.
// R5 (1 Oct 2026, HANDOFF_R5_STABILITY.md, the section at the end of this file): no frame ever waits for a shader link (the 10 to 45 s
// "page unresponsive" freezes), a stability watchdog in the F3 overlay and the summary (long tasks, heap trend, GPU memory, links,
// context), WebGL context loss handling. ?r5=0 turns R5 off, ?pns=0 only the link guard.
// R6 (2 Oct 2026, HANDOFF_R6_RENDER.md, the last section and marked parts above): far fewer and smaller shader programs, less to draw
// (shadow cascades, sub-pixel meshes, building LOD, static batches). ?r6=0 turns R6 off.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var Q = location.search;
  var P = window.PLAN_PERF = window.PLAN_PERF || {};
  P.errs = P.errs || []; P.n = P.n || {};
  P.off = /[?&]perf=0\b/.test(Q);
  P.K = { budget: 3.5, cull: !/[?&]pcull=0\b/.test(Q), warm: !/[?&]pwarm=0\b/.test(Q), pre: !/[?&]ppre=0\b/.test(Q), fix: !/[?&]pfix=0\b/.test(Q),
    preHold: 15000, longMs: 50, hitchMs: 100, shadowEveryIn: 4, cullHz: 10, r6: !/[?&]r6=0\b/.test(Q), r6wu: !/[?&]r6wu=0\b/.test(Q) };   // r6: HANDOFF_R6_RENDER.md (?r6=0 off)
  function note(tag, e) { try { if (P.errs.length < 40) P.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (P.errs.length <= 5) console.warn("[perf] " + tag, e); } catch (x) {} }
  P.note = note;
  if (P.off) return;
  function G(name) { try { return eval(name); } catch (e) { return undefined; } }   // a client global that may not exist yet (TDZ before client.js runs)
  var now = function () { return performance.now(); };

  // ───────────────────────── P3 (1 Oct 2026): world matrices only where something moved ─────────────────────────
  // three recomputes the world matrix of every object in every render: the scene root auto-updates, which forces its whole tree
  // (about 35,000 objects here, most of them the crowd's bones: 8 to 10 ms a frame on a fast desktop). Same results, less work: an
  // object's local matrix is recomposed only when its position, rotation or scale changed (with matrixAutoUpdate off: when its
  // matrix was edited), its world matrix only when that happened, when its parent's world matrix changed (a version number), or when
  // asked (matrixWorldNeedsUpdate, force). A skinned mesh inverts its bind matrix only when its world matrix changed.
  // ?pmw=0 keeps three's own methods.
  // Most of the 35,000 objects are the crowd (about 730 rigged people, 42 objects each, 24 of them bones), and the cost is mostly
  // the walk itself (about 250 ns an object), so two kinds of subtree are not walked when nothing in them can have moved:
  //   - a skeleton's bones between two updates of the animation mixer that drives them (people further away update every 2nd to
  //     8th frame); any mixer update, a bone's parent moving, something added under a bone, and a slow round (every 32nd frame)
  //     walk them again;
  //   - a far person (PLAN_PERF.sleep(g, true), called by the client when a person is beyond its 200 m draw range and hidden):
  //     only the group's own matrix is kept current (its position is still read); what was still drawn inside (badges, hats,
  //     a bike) is hidden until it wakes. On waking every part checks its own matrix again.
  // The per-object caches live in typed arrays indexed by object id (no properties are added to the objects).
  P.K.mw = !/[?&](pmw|p3)=0\b/.test(Q);
  // R16 (HANDOFF_R16_PERF.md): S16H.mw skips the subtree of an invisible object (not a bone) in this walk except every 16th frame, when it
  // changed itself or when its children changed (?s16mw=0 off); S16H.check / S16H.flush are the shadow-merge watch (R16 section at the end)
  var S16H = P.s16h = { mw: !/[?&](s16|s16mw|p3)=0\b/.test(Q), check: null, flush: null, skipped: 0 };
  var MW = P.mw = { cap: 0, LC: null, WV: null, PV: null, BI: null, BR: null, AF: null, CF: null, SLP: null, LIM: 524288, MAN: new WeakMap(), HID: new WeakMap(), MR: new WeakMap(), MU: 1, V: 1, fr: 0, sleeping: 0 };
  function mwGrow(n) {
    var cap = Math.max(65536, MW.cap || 0); while (cap <= n) cap *= 2; if (cap > MW.LIM) cap = MW.LIM; if (cap <= MW.cap) return;   /* R5: ids are never reused, so the caches stop at MW.LIM ids (64 MB); later objects take three's own methods */
    function g(Old, T, k, fill) { var a = new T(cap * k); if (fill !== undefined) a.fill(fill); if (Old) a.set(Old); return a; }
    MW.LC = g(MW.LC, Float64Array, 10, NaN); MW.WV = g(MW.WV, Float64Array, 1); MW.PV = g(MW.PV, Float64Array, 1, -1); MW.BI = g(MW.BI, Float64Array, 1, -1);
    MW.BR = g(MW.BR, Uint8Array, 1); MW.AF = g(MW.AF, Float64Array, 1); MW.CF = g(MW.CF, Float64Array, 1, -1); MW.SLP = g(MW.SLP, Uint8Array, 1); MW.S16 = g(MW.S16, Uint8Array, 1); MW.NC = g(MW.NC, Int32Array, 1, -1); MW.cap = cap;   /* R16: S16 member flags, NC children count of a hidden object at its last walk */
  }
  (function fastMatrices() {
    if (!P.K.mw || !window.THREE || !THREE.Object3D || THREE.Object3D.prototype.__p3mw) return;
    var O = THREE.Object3D.prototype; O.__p3mw = true; mwGrow(65535); var umw0 = O.updateMatrixWorld, uwm0 = O.updateWorldMatrix;
    function local(o, id) {   // true when the local matrix changed since its last world update
      if (o.matrixAutoUpdate === true) {
        var p = o.position, q = o.quaternion, s = o.scale, L = MW.LC, b = id * 10;
        if (L[b] === p.x && L[b + 1] === p.y && L[b + 2] === p.z && L[b + 3] === q._x && L[b + 4] === q._y && L[b + 5] === q._z && L[b + 6] === q._w && L[b + 7] === s.x && L[b + 8] === s.y && L[b + 9] === s.z) return false;
        o.updateMatrix(); L[b] = p.x; L[b + 1] = p.y; L[b + 2] = p.z; L[b + 3] = q._x; L[b + 4] = q._y; L[b + 5] = q._z; L[b + 6] = q._w; L[b + 7] = s.x; L[b + 8] = s.y; L[b + 9] = s.z;
        return true;
      }
      MW.LC[id * 10] = NaN;   // a matrix set by hand: compare the matrix itself
      var e = o.matrix.elements, c = MW.MAN.get(o);   /* R5: keyed by the object (WeakMap): a removed object's entry goes with it */
      if (c !== undefined && c[0] === e[0] && c[1] === e[1] && c[2] === e[2] && c[3] === e[3] && c[4] === e[4] && c[5] === e[5] && c[6] === e[6] && c[7] === e[7] && c[8] === e[8] && c[9] === e[9] && c[10] === e[10] && c[11] === e[11] && c[12] === e[12] && c[13] === e[13] && c[14] === e[14] && c[15] === e[15]) return false;
      if (c === undefined) MW.MAN.set(o, c = new Float64Array(16)); for (var i = 0; i < 16; i++) c[i] = e[i];
      return true;
    }
    function world(o, id, par) { if (o.matrixWorldAutoUpdate === true) { if (par === null) o.matrixWorld.copy(o.matrix); else o.matrixWorld.multiplyMatrices(par.matrixWorld, o.matrix); } MW.WV[id] = ++MW.V; MW.PV[id] = par !== null ? MW.WV[par.id] : 0; }
    var umw = function (force) {
      var id = this.id, par = this.parent; if (id >= MW.cap || (par !== null && par.id >= MW.cap)) { mwGrow(Math.max(id, par !== null ? par.id : 0)); if (id >= MW.cap || (par !== null && par.id >= MW.cap)) return umw0.call(this, force); }
      var d = local(this, id) || force === true || this.matrixWorldNeedsUpdate === true || (par !== null && MW.PV[id] !== MW.WV[par.id]);
      if (d) { world(this, id, par); this.matrixWorldNeedsUpdate = false; force = true; }
      var sf = MW.S16[id]; if ((sf & 7) !== 0 && S16H.check !== null) S16H.check(this, id, sf, d);   /* R16: a merged mesh's member or one of its parents */
      if (MW.SLP[id] === 1) return;   // a far person asleep: its own matrix only
      if (MW.BR[id] === 1) { if (!d && MW.AF[id] <= MW.CF[id] && ((id + MW.fr) & 31) !== 0) return; MW.CF[id] = MW.MU; }   // bones: only after their mixer ran
      var ch = this.children;
      /* R16: nothing under an invisible object is drawn; its subtree is walked when it changed itself, when its children changed, and every
         16th frame (staggered), so a direct reader of a hidden object's world matrix is never more than 16 frames behind (bones always) */
      if (this.visible === false && d === false && S16H.mw === true && this.isBone !== true && ((id + MW.fr) & 15) !== 0) { if (MW.NC[id] === ch.length) { S16H.skipped++; return; } MW.NC[id] = ch.length; }
      for (var i = 0, l = ch.length; i < l; i++) { var c = ch[i]; if (c.matrixWorldAutoUpdate === true || force === true) c.updateMatrixWorld(force); }
      if (par === null && S16H.flush !== null && this.isScene === true) S16H.flush(this);
    };
    O.updateMatrixWorld = umw;
    O.updateWorldMatrix = function (updateParents, updateChildren) {
      var id = this.id, par = this.parent; if (id >= MW.cap || (par !== null && par.id >= MW.cap)) { mwGrow(Math.max(id, par !== null ? par.id : 0)); if (id >= MW.cap || (par !== null && par.id >= MW.cap)) return uwm0.call(this, updateParents, updateChildren); }
      if (updateParents === true && par !== null) par.updateWorldMatrix(true, false);
      if (local(this, id) || MW.WV[id] === 0 || this.matrixWorldNeedsUpdate === true || (par !== null && MW.PV[id] !== MW.WV[par.id])) world(this, id, par);
      if (updateChildren === true) { var ch = this.children; for (var i = 0, l = ch.length; i < l; i++) ch[i].updateWorldMatrix(false, true); }
    };
    var SM = THREE.SkinnedMesh && THREE.SkinnedMesh.prototype;
    if (SM && Object.prototype.hasOwnProperty.call(SM, "updateMatrixWorld")) {
      var AB = THREE.AttachedBindMode || "attached", DB = THREE.DetachedBindMode || "detached", smb = SM.bind, smw0 = SM.updateMatrixWorld;
      SM.updateMatrixWorld = function (force) {
        if (this.id >= MW.cap) return smw0.call(this, force);
        umw.call(this, force); var id = this.id; if (MW.BI[id] === MW.WV[id]) return; MW.BI[id] = MW.WV[id];
        if (this.bindMode === AB) this.bindMatrixInverse.copy(this.matrixWorld).invert(); else if (this.bindMode === DB) this.bindMatrixInverse.copy(this.bindMatrix).invert();
      };
      SM.bind = function () { var r = smb.apply(this, arguments); if (this.id < MW.cap) MW.BI[this.id] = -1; return r; };
    }
    // every mixer update marks the root bones under its root as moved (any mixer, whoever drives it)
    var AM = THREE.AnimationMixer && THREE.AnimationMixer.prototype;
    if (AM && AM.update) { var mup = AM.update;
      AM.update = function () { var r = mup.apply(this, arguments); var ids = MW.MR.get(this); if (ids === undefined) { ids = mixerRoots(this); MW.MR.set(this, ids); } MW.MU++; for (var i = 0; i < ids.length; i++) MW.AF[ids[i]] = MW.MU; return r; };
    }
    function mixerRoots(m) { var ids = [], root = null; try { root = m.getRoot(); } catch (e) {} if (root && root.traverse) root.traverse(function (o) { if (o.isBone && !(o.parent && o.parent.isBone)) { if (o.id >= MW.cap) mwGrow(o.id); if (o.id >= MW.cap) return; MW.BR[o.id] = 1; MW.CF[o.id] = -1; ids.push(o.id); } }); return ids; }
    P.n.mw = 1;
  })();
  // a far person: only its group's own matrix stays current; whatever was still drawn inside is hidden until it wakes
  P.sleep = function (g, on) {
    try { if (!P.K.mw || !MW.cap || !g || !g.isObject3D) return; var id = g.id; if (id >= MW.cap) mwGrow(id); if (id >= MW.cap) return;
      if (on) { if (MW.SLP[id] === 1) return; var hid = []; g.traverse(function (o) { if (o === g) return; if (o.isBone && !(o.parent && o.parent.isBone)) { if (o.visible) { o.visible = false; hid.push(o); } return; } if (o.visible && !o.isLight && (o.isMesh || o.isSprite || o.isPoints || o.isLine) && !o.isSkinnedMesh) { o.visible = false; hid.push(o); } });
        MW.HID.set(g, hid); MW.SLP[id] = 1; MW.sleeping++; }
      else { if (MW.SLP[id] !== 1) return; MW.SLP[id] = 0; MW.sleeping--; var h = MW.HID.get(g); MW.HID.delete(g); if (h) for (var i = 0; i < h.length; i++) if (h[i].visible === false && h[i].parent) h[i].visible = true; g.updateMatrixWorld(); }
    } catch (e) { note("sleep", e); }
  };
  // P3: three draws a transparent double-sided material in two passes (back faces, then front faces), and each pass flips
  // material.side and sets needsUpdate, so both draws resolve the shader program again (the crowd's 1,500 badge planes: about 60
  // program look-ups and 30 extra draws a frame). For a flat mesh the one double-sided pass gives exactly the same pixels, so a
  // material seen only on flat, plain (not instanced, skinned or morphed) meshes is drawn in one pass. ?pfs=0 or ?p3=0: off.
  // (Tried and dropped: sorting opaque draws by program first cut program switches from about 490 to 230 a frame but made every
  // session 10 to 20 per cent slower, so three's own order stays. No state is kept on materials either: the flags below live in
  // WeakMaps.)
  P.K.fs = !/[?&](pfs|p3)=0\b/.test(Q);
  (function singlePassFlat() {
    if (!P.K.fs || !window.THREE || !THREE.Material || THREE.Material.prototype.__p3fs) return;
    var MP = THREE.Material.prototype, DS = THREE.DoubleSide, FLAT = new WeakMap(), FS = new WeakMap(), MINE = new WeakSet(), obr = MP.onBeforeRender, cpy = MP.copy; MP.__p3fs = true;
    function flat(g) { var f = FLAT.get(g); if (f !== undefined) return f; f = false; try { if (!g.boundingBox) g.computeBoundingBox(); var b = g.boundingBox, x = b.max.x - b.min.x, y = b.max.y - b.min.y, z = b.max.z - b.min.z, mx = Math.max(x, y, z); f = mx > 0 && Math.min(x, y, z) <= mx * 1e-5; } catch (e) {} FLAT.set(g, f); return f; }
    MP.onBeforeRender = function (r, s, c, geo, obj) {
      if (this.transparent === true && this.side === DS) { var st = FS.get(this);
        if (st !== 2 && st !== 3) {
          if (st === undefined && this.forceSinglePass !== false) FS.set(this, 3);   // the author's own choice: hands off
          else { var ok = !!obj && !obj.isInstancedMesh && !obj.isSkinnedMesh && !obj.morphTargetInfluences && !!geo && flat(geo);
            if (ok && st === undefined) { this.forceSinglePass = true; FS.set(this, 1); MINE.add(this); P.n.singlePass = (P.n.singlePass || 0) + 1; }
            else if (!ok) { if (st === 1) { this.forceSinglePass = false; MINE.delete(this); } FS.set(this, 2); } } } }
      return obr.apply(this, arguments);
    };
    MP.copy = function (src) { var r = cpy.apply(this, arguments); if (src && MINE.has(src)) this.forceSinglePass = false; return r; };
  })();
  // P3: bones are never drawn, but the renderer walks them in every pass (the main view and each shadow cascade): the crowd's 17,500
  // bones are half the scene. The root bone of a skeleton in the scene is taken out of those walks (visible = false) when nothing
  // but bones hangs under it; skinning reads the bones' world matrices, which are updated whether a bone is visible or not. Anything
  // later added under a bone shows its root again for good, and a copy of a hidden bone is visible. ?pbv=0 or ?p3=0: off.
  P.K.bv = !/[?&](pbv|p3)=0\b/.test(Q);
  var BV = { q: [], seen: new WeakSet(), hid: 0, st: new WeakMap(), tries: new WeakMap() };   // st: 1 hidden here, 2 has attachments
  (function boneWalks() {
    if (!P.K.bv || !window.THREE || !THREE.Bone || !THREE.SkinnedMesh) return;
    var SMP = THREE.SkinnedMesh.prototype, bind0 = SMP.bind, BP = THREE.Bone.prototype, O = THREE.Object3D.prototype, add0 = O.add, copy0 = O.copy;
    SMP.bind = function (sk) { var r = bind0.apply(this, arguments); try { if (sk && sk.bones && !BV.seen.has(sk)) { BV.seen.add(sk); BV.q.push(sk); } } catch (e) {} return r; };
    BP.add = function () { var r = add0.apply(this, arguments); try { for (var i = 0; i < arguments.length; i++) { var o = arguments[i]; if (o && !o.isBone) { var p = this; while (p.parent && p.parent.isBone) p = p.parent; if (BV.st.get(p) === 1) { p.visible = true; BV.hid--; } BV.st.set(p, 2); if (MW.cap && p.id < MW.cap) MW.AF[p.id] = ++MW.MU; break; } } } catch (e) {} return r; };
    BP.copy = function (src) { var r = copy0.apply(this, arguments); if (src && BV.st.get(src) === 1) this.visible = true; return r; };
  })();
  function onlyBones(root) { var ok = true; root.traverse(function (o) { if (!o.isBone) ok = false; }); return ok; }
  function inScene(o) { while (o.parent) o = o.parent; return o === G("scene"); }
  function boneStep() {
    var q = BV.q; if (!q.length) return; var n = Math.min(q.length, 48);
    for (var i = 0; i < n; i++) { var sk = q.shift(), B = sk.bones, wait = false;
      for (var j = 0; j < B.length; j++) { var b = B[j]; if (!b) continue; var root = b; while (root.parent && root.parent.isBone) root = root.parent; if (BV.st.has(root)) continue;
        if (!inScene(root)) { wait = true; continue; } if (onlyBones(root)) { root.visible = false; BV.st.set(root, 1); BV.hid++; } else BV.st.set(root, 2); }
      if (wait) { var tr = (BV.tries.get(sk) || 0) + 1; BV.tries.set(sk, tr); if (tr < 400) q.push(sk); } }
    P.n.boneRoots = BV.hid;
  }

  // ───────────────────────── frame clock (own rAF: works with or without the plan hooks) ─────────────────────────
  var NB = 1024;
  var FT = P.ft = { dt: new Float32Array(NB), at: new Float64Array(NB), i: 0, n: 0, last: 0, hist: new Uint32Array(256), cnt: 0, sum: 0, long: 0, hitch: 0, worst: 0 };
  function tick(t) {
    requestAnimationFrame(tick);
    var dt = FT.last ? t - FT.last : 0; FT.last = t;
    try { if (!P.installed) tryInstall(); } catch (e) {}
    if (!dt || document.hidden || dt > 10000) return;   // a background tab or a debugger pause is not a frame
    FT.dt[FT.i] = dt; FT.at[FT.i] = t; FT.i = (FT.i + 1) % NB; if (FT.n < NB) FT.n++;
    if (P.readyAt && !P.paused) { FT.cnt++; FT.sum += dt; FT.hist[Math.min(255, dt | 0)]++; if (dt > P.K.longMs) FT.long++; if (dt > P.K.hitchMs) FT.hitch++; if (dt > FT.worst) FT.worst = dt; }
    if (OV.on) { try { drawOverlay(t); } catch (e) { note("overlay", e); OV.on = false; } }
    if (P.installed && (FT.cnt & 127) === 0) { try { pinPrograms(); } catch (e) {} }
    if (WQ.length && t - WQ.idleAt > 400) { try { runQueue(1.5); } catch (e) { note("queue", e); } }   // no idle time for a while: a small slice anyway
  }
  requestAnimationFrame(tick);
  function recent(ms, t) { var w = 0, s = 0, c = 0; for (var k = 0; k < FT.n; k++) { var j = (FT.i - 1 - k + NB) % NB; if (t - FT.at[j] > ms) break; var d = FT.dt[j]; if (d > w) w = d; s += d; c++; } return { worst: w, avg: c ? s / c : 0, n: c }; }
  function pct(p) { var tot = FT.cnt; if (!tot) return 0; var k = tot * p, a = 0; for (var i = 0; i < 256; i++) { a += FT.hist[i]; if (a >= k) return i + 1; } return 256; }

  // ───────────────────────── overlay (F3 or ?perf=1) ─────────────────────────
  var OV = P.ov = { on: /[?&]perf=1\b/.test(Q), el: null, cv: null, cx: null, txt: null, at: 0 };
  function mkOverlay() {
    if (OV.el || !document.body) return; var d = document.createElement("div"); d.id = "perfov";
    d.style.cssText = "position:fixed;left:8px;bottom:112px;z-index:99999;background:rgba(8,13,8,0.84);color:#e8f5ea;font:11px/1.4 'JetBrains Mono',ui-monospace,Consolas,monospace;padding:6px 8px 7px;border:1px solid rgba(77,222,111,0.45);border-radius:6px;pointer-events:none;white-space:pre;min-width:240px";
    var t = document.createElement("div"); var c = document.createElement("canvas"); c.width = 240; c.height = 56; c.style.cssText = "display:block;margin-top:5px;width:240px;height:56px";
    d.appendChild(t); d.appendChild(c); document.body.appendChild(d); OV.el = d; OV.txt = t; OV.cv = c; OV.cx = c.getContext("2d");
  }
  P.toggle = function (on) { OV.on = on === undefined ? !OV.on : !!on; if (OV.on) mkOverlay(); if (OV.el) OV.el.style.display = OV.on ? "" : "none"; return OV.on; };
  addEventListener("keydown", function (e) { if (e.code !== "F3" || e.repeat) return; var t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return; e.preventDefault(); P.toggle(); }, true);
  function fmtN(v) { return v >= 1e6 ? (v / 1e6).toFixed(2) + " M" : v >= 1e4 ? Math.round(v / 1e3) + " k" : String(v); }
  function drawOverlay(t) {
    if (!OV.el) mkOverlay(); if (!OV.el) return;
    var c = OV.cx, W = 240, H = 56, top = 50; c.clearRect(0, 0, W, H); c.fillStyle = "rgba(255,255,255,0.06)"; c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(77,222,111,0.35)"; c.fillRect(0, H - 16.7 * H / top, W, 1); c.fillStyle = "rgba(244,205,90,0.35)"; c.fillRect(0, H - 33.3 * H / top, W, 1);
    for (var k = 0; k < W && k < FT.n; k++) { var j = (FT.i - 1 - k + NB) % NB, d = FT.dt[j]; var h = Math.min(H, d * H / top); c.fillStyle = d < 18 ? "#4DDE6F" : d < 34 ? "#f4cd5a" : "#ff9180"; c.fillRect(W - 1 - k, H - h, 1, h); }
    if (t - OV.at < 250) return; OV.at = t;
    var r1 = recent(1000, t), r10 = recent(10000, t); var inf = (typeof renderer !== "undefined" && renderer) ? renderer.info : null;
    var mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + " / " + Math.round(performance.memory.jsHeapSizeLimit / 1048576) + " MB" : "n/a";
    var lines = [
      "fps " + (r1.avg ? (1000 / r1.avg).toFixed(1) : "-") + "   frame " + r1.avg.toFixed(1) + " ms",
      "worst 10 s " + Math.round(r10.worst) + " ms   long " + FT.long + "   hitch " + FT.hitch,
      "draws " + RI.calls + "   tris " + fmtN(RI.tri),
      inf ? "geo " + inf.memory.geometries + "   tex " + inf.memory.textures + "   prog " + (inf.programs ? inf.programs.length : 0) : "",
      "heap " + mem,
      "load " + (P.loadMs ? (P.loadMs / 1000).toFixed(1) + " s" : "-") + "   pre " + (P.n.preMs ? (P.n.preMs / 1000).toFixed(1) + " s" : "-") + "   tier " + (G("QUAL") ? G("QUAL").level : "?"),
      "queue " + WQ.length + (IC.kind ? "   in " + IC.kind + ": -" + IC.nObj + " obj -" + IC.nInst + " inst" : "")
    ];
    try { if (P.r5 && P.r5.lines) lines = lines.concat(P.r5.lines()); } catch (e) {}
    OV.txt.textContent = lines.filter(Boolean).join("\n");
  }

  // ───────────────────────── session summary (anonymous) ─────────────────────────
  var SID = Math.random().toString(36).slice(2, 10);
  function gpuName() { if (P.gpu !== undefined) return P.gpu; try { var gl = renderer.getContext(); var x = gl.getExtension("WEBGL_debug_renderer_info"); P.gpu = String(x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).slice(0, 160); } catch (e) { P.gpu = null; } return P.gpu; }
  P.summary = function () {
    var q = G("QUAL");
    return { v: 1, sid: SID, at: new Date().toISOString().slice(0, 19), build: window.BUILD || null, secs: P.readyAt ? Math.round((now() - P.readyAt) / 1000) : 0, frames: FT.cnt,
      fps: FT.sum ? +(1000 * FT.cnt / FT.sum).toFixed(1) : 0, avgMs: FT.cnt ? +(FT.sum / FT.cnt).toFixed(2) : 0, p95: pct(0.95), p99: pct(0.99), long: FT.long, hitch: FT.hitch, worst: Math.round(FT.worst),
      loadMs: P.loadMs ? Math.round(P.loadMs) : null, preMs: P.n.preMs || null, tier: q ? q.level : null, gpu: gpuName(), mobile: /Android|iPhone|iPad/i.test(navigator.userAgent), cores: navigator.hardwareConcurrency || null,
      w: innerWidth, h: innerHeight, dpr: +(devicePixelRatio || 1).toFixed(2), programs: (typeof renderer !== "undefined" && renderer.info.programs) ? renderer.info.programs.length : null, r5: P.r5 && P.r5.summary ? P.r5.summary() : null };
  };
  P.sessions = function () { try { return JSON.parse(localStorage.getItem("g1:perf") || "[]"); } catch (e) { return []; } };
  function save(final) {
    if (!P.readyAt || FT.cnt < 30) return; var s = P.summary();
    try { var list = P.sessions().filter(function (o) { return o && o.sid !== SID; }); list.push(s); while (list.length > 10) list.shift(); localStorage.setItem("g1:perf", JSON.stringify(list)); } catch (e) {}
    if (final && window.PERF_ENDPOINT && navigator.sendBeacon && !P.sent) { try { P.sent = navigator.sendBeacon(window.PERF_ENDPOINT, JSON.stringify(s)); } catch (e) {} }
  }
  P.save = save;
  addEventListener("pagehide", function () { save(true); });
  document.addEventListener("visibilitychange", function () { if (document.hidden) save(true); });
  setInterval(function () { save(false); }, 60000);

  // ───────────────────────── per-frame render totals, light-count and shadow-flag stabilisers ─────────────────────────
  var RI = P.ri = { calls: 0, tri: 0 };
  function wrapRender() {
    if (P.rf || typeof renderFrame !== "function") return; var orig = renderFrame; P.rf = orig;
    renderFrame = function () {
      try { preRender(); } catch (e) { note("pre-render", e); }
      var inf = renderer.info, ar = inf.autoReset; inf.autoReset = false; inf.reset();
      P.inFrame = (P.inFrame || 0) + 1; try { return orig.apply(this, arguments); } finally { P.inFrame--; RI.calls = inf.render.calls; RI.tri = inf.render.triangles; inf.autoReset = ar; }
    };
  }
  // the client's rooms and the fly-in cabin each carry a fill HemisphereLight: adding one changes the scene's hemisphere light count,
  // which is part of every lit shader's program key, so every material on screen recompiled on entering the FBO (109 programs).
  // A spare (black, intensity 0) hemisphere light stands in whenever no room fill is shown: the count never changes.
  // R6: every hemisphere light anywhere in the scene is counted (a registry filled by Object3D.add), and two spares (on every layer,
  // so the room probes and the warm-up cameras count them too) keep the total at three: the scene's own, plus a room fill and the
  // cabin fill at most. Before, passes saw one, two or three (the probes did not see the spare, the cabin warm-up hid it): 168 of
  // the 756 programs at load were the same materials with another hemisphere count.
  var HEMIS = P.hemis = new Set(), HT = 3;
  (function hemiReg() {
    if (!P.K.r6 || !P.K.fix || !window.THREE || !THREE.Object3D || THREE.Object3D.prototype.__r6h) return; var O = THREE.Object3D.prototype, a0 = O.add; O.__r6h = true;
    var got = 0, reg = function (q) { if (q.isHemisphereLight && !q.userData.perf) { HEMIS.add(q); got++; } }, r0 = O.remove, has = function (q) { if (q.isHemisphereLight && HEMIS.has(q)) got++; };
    // a subtree with a fill light can be added under any parent; the spares are settled at once (a room entered mid-frame used to be
    // drawn, or compiled, once with four hemisphere lights before the next frame's check)
    var sc0 = null, both = function (q) { reg(q); hideLamp(q); };
    O.add = function () { got = 0; var root = this, k = 0; while (root.parent !== null && k++ < 64) root = root.parent; if (sc0 === null) { try { sc0 = scene; } catch (e) {} } var main = root === sc0 && sc0 !== null, fn = main ? both : reg;
      for (var i = 0; i < arguments.length; i++) { var o = arguments[i]; if (!o) continue; if (o.isLight === true) fn(o); else if (o.children && o.children.length && !o.isBone && o.traverse) { try { o.traverse(fn); } catch (e) {} } }
      var r = a0.apply(this, arguments); if (got && P.hemi2) { try { hemiFix(); } catch (e) {} } return r; };
    O.remove = function () { got = 0; for (var i = 0; i < arguments.length; i++) { var o = arguments[i]; if (o && o.traverse && !o.isBone && HEMIS.size) { try { o.traverse(has); } catch (e) {} } } var r = r0.apply(this, arguments); if (got && P.hemi2) { try { hemiFix(); } catch (e) {} } return r; };
  })();
  // R6: the client draws point and spot lights only through its pool (8 point and 3 spot lights that take the nearest sources'
  // values); every other point or spot light in the scene is hidden by collectLights, which runs when scene.add brings lights or
  // every 4 s. A lamp added inside a group (an interior, a dome, a pyramid, a room's props) stayed visible until then, so for up to
  // 4 s the scene had 11 to 18 point lights instead of 8, and every material in view compiled again for that count: about 500 of
  // the 1,330 programs of a 25 minute session, each a full lit shader. Now such a light is hidden the moment it reaches the main
  // scene (any parent, see hemiReg below), and every frame for the lights the client has collected (in case a module shows one
  // again); lights in other scenes (the telescope view, previews) are untouched. (A first version used a visible accessor on the
  // light classes: exact, but it made three's per-object visible check polymorphic and cost about 4 per cent of the frame on low.)
  function hideLamp(q) { if ((q.isPointLight === true || q.isSpotLight === true) && q.visible === true && !(q.userData && q.userData.pooled)) { q.visible = false; P.n.lampsHidden = (P.n.lampsHidden || 0) + 1; } }
  var LSRC = null;
  function lampsFrame() { if (!P.K.r6) return; if (LSRC === null) { var LG = G("LIGHTS"); if (!LG) return; LSRC = LG; } var src = LSRC.src; for (var i = 0; i < src.length; i++) { var l = src[i]; if (l.visible === true) l.visible = false; } }
  function hemiInit() { if (P.hemi || !P.K.fix || typeof scene === "undefined") return; var mk = function (nm) { var h = new THREE.HemisphereLight(0x000000, 0x000000, 0); h.name = nm; h.userData.pooled = true; h.userData.perf = true; h.layers.enable(30); if (P.K.r6) h.layers.mask = 0xffffffff; scene.add(h); return h; };
    P.hemi = mk("perf spare hemi"); if (P.K.r6) { P.hemi2 = mk("perf spare hemi 2"); try { scene.traverse(function (o) { if (o.isHemisphereLight && !o.userData.perf) HEMIS.add(o); }); } catch (e) {} } }
  function countHemi(g) { var c = g.userData.perfHemi; if (c && c.n === g.children.length) return c.k; var k = 0; g.traverse(function (o) { if (o.isHemisphereLight && o.visible) k++; }); g.userData.perfHemi = { n: g.children.length, k: k }; return k; }
  function shown(o) { var sc = typeof scene !== "undefined" ? scene : null; for (var k = 0; o && k < 64; k++) { if (!o.visible) return false; if (o === sc) return true; o = o.parent; } return false; }
  function hemiFix() {
    if (!P.hemi) return; var need = 0;
    if (P.hemi2) {   // R6
      HEMIS.forEach(function (h) { var r = h; while (r.parent) r = r.parent; if (r !== scene) { HEMIS.delete(h); return; } if (shown(h)) need++; });   // out of the scene: dropped (found again when its group is added back)
      var w1 = need < HT, w2 = need < HT - 1; if (P.hemi.visible !== w1) P.hemi.visible = w1; if (P.hemi2.visible !== w2) P.hemi2.visible = w2; return;
    }
    try { var ins = inside; if (ins && ins.g && ins.g.parent && ins.g.visible) need += countHemi(ins.g); } catch (e) {}
    try { var F = FLY; if (F && F.g && F.g.parent && F.g.visible) need += countHemi(F.g); } catch (e) {}
    var want = need === 0; if (P.hemi.visible !== want) P.hemi.visible = want;
  }
  P.hemiFix = hemiFix;
  // medium and low tiers (no CSM): the client turns sun.castShadow off for the moment the key light hands over from the sun to
  // the moon (and back), which recompiles every lit material twice a day. Keep the flag; the light is at zero there anyway.
  function sunFix() { if (!P.K.fix) return; try { if (CSMX.on) return; if (sun.parent && renderer.shadowMap.enabled && !sun.castShadow) sun.castShadow = true; } catch (e) {} }
  function preRender() {
    MW.fr++; hemiFix(); sunFix(); try { lampsFrame(); } catch (e) {}
    if (IC.kind && P.K.shadowEveryIn > 1 && !FLY.on && renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = (FRAME_N % P.K.shadowEveryIn) === 0;   // indoors: the outside's shadows at a steady quarter rate
    try { shadowTurns(); } catch (e) { note("shadow turns", e); }
    try { boneStep(); } catch (e) { note("bones", e); }
  }
  // P3: on the cascaded tiers outdoors the cascades take turns. The client drew all three every second frame (the far cascade alone
  // draws about as much as the main pass); now the near cascade is drawn every second frame as before and the middle and far ones
  // every fourth, one cascade a frame. While the client wants shadows every frame (rides, ultra) the near cascade is drawn every
  // frame and the others in turn. A cascade that is not redrawn keeps its own light matrix, so its shadows stay exactly where they
  // were drawn (static casters are exact; a moving caster's shadow in the middle and far range lags by up to three frames). A camera
  // jump (fast travel, a cut) redraws all of them. Other shadow-casting lights keep the client's cadence. Indoors plan_perf's quarter
  // rate applies to the whole set. ?psh=0: the client's cadence.
  P.K.shTurns = !/[?&](psh|p3)=0\b/.test(Q);
  var SHT = { f: -1, want: true, due: [], keep: [], cam: null, far: 0, last: [] }, R6TURN = [1, 2, 1, 3, 1, 2];
  // R6: the far cascades (81 m and more on ultra) hold only what is far away; while the camera has not moved 1.5 m or turned 1.5
  // degrees and the sun has not moved since a far cascade was last drawn, drawing it again gives the same map (up to the far people
  // and vehicles, refreshed at least every 2 s). Standing still, that drawing (1,300 draws on ultra) was the slowest frame.
  function farMark(i, cp, csm) { var r = SHT.last[i] || (SHT.last[i] = { p: new THREE.Vector3(), q: new THREE.Quaternion(), d: new THREE.Vector3(), t: 0 }); r.p.copy(cp); r.q.copy(camera.quaternion); r.d.copy(csm.lightDirection); r.t = now(); }
  function farStill(i, cp, csm) { var r = SHT.last[i]; if (!r || now() - r.t > 2000) return false; return r.p.distanceToSquared(cp) < 2.25 && r.q.angleTo(camera.quaternion) < 0.026 && r.d.dot(csm.lightDirection) > 0.99999; }
  function shadowTurns() {
    var c = G("CSMX"), csm = c && c.csm, sm = renderer.shadowMap; if (!csm) return;
    var L = csm.lights, n = L.length, i; SHT.f = FRAME_N; SHT.want = sm.needsUpdate || sm.autoUpdate; SHT.on = false;
    if (!P.K.shTurns || !sm.enabled || IC.kind || n < 2) { for (i = 0; i < n; i++) L[i].shadow.autoUpdate = true; return; }
    var every = 2; try { every = (FLY.on || SITES.ride || SITES.bride) ? 1 : (QUAL.q.shadowEvery || 1); } catch (e) {}
    var cp = camera.position; if (!SHT.cam) SHT.cam = cp.clone();
    var all = SHT.cam.distanceToSquared(cp) > 400 || c.lastFar !== SHT.far; SHT.cam.copy(cp); SHT.far = c.lastFar;
    var f = FRAME_N, due = SHT.due;
    for (i = 0; i < n; i++) due[i] = all;
    if (every <= 1) { due[0] = true; due[n === 4 && P.K.r6 ? R6TURN[f % 6] : 1 + f % (n - 1)] = true; }   /* R6: on ultra the middle cascade every 2nd frame, the next every 3rd, the far one (1,300 draws, static at that range) every 6th */
    else { var slot = f % (2 * (n - 1)); if (slot % 2 === 0) due[0] = true; else due[1 + (slot >> 1)] = true; }
    if (P.K.r6 && !all) for (i = 2; i < n; i++) if (due[i] && farStill(i, cp, csm)) due[i] = false;   /* R6: a far cascade is not redrawn while the view and the sun stand still (at most 2 s) */
    for (i = 0; i < n; i++) { var s = L[i].shadow; L[i].__p3csm = true; s.autoUpdate = false; if (due[i]) { s.needsUpdate = true; if (P.K.r6) farMark(i, cp, csm); } }
    sm.needsUpdate = true; SHT.on = true;
  }
  // the client's own cadence for the other shadow-casting lights (the gate is now open every frame)
  function wrapShadowMap() {
    var sm = renderer.shadowMap; if (sm.__p3) return; sm.__p3 = true; var SR0 = sm.render;
    sm.render = function (lights, sc, cam) {
      if (SHT.on && SHT.f === FRAME_N && !SHT.want && lights.length) { var keep = SHT.keep; keep.length = 0; for (var i = 0; i < lights.length; i++) if (lights[i].__p3csm) keep.push(lights[i]); if (keep.length !== lights.length) return SR0.call(this, keep, sc, cam); }
      return SR0.call(this, lights, sc, cam);
    };
  }

  // ───────────────────────── idle-time work queue: GPU warm-up in small slices ─────────────────────────
  // a task returns false to stay at the head of the queue (waiting, e.g. for a parallel compile), "later" to go to the back, anything else when done
  var WQ = P.wq = []; WQ.idleAt = 0; var idleOn = false;
  var ric = window.requestIdleCallback ? function (f, o) { return requestIdleCallback(f, o); } : function (f) { return setTimeout(function () { f({ timeRemaining: function () { return 4; }, didTimeout: false }); }, 30); };
  function runOne() { var f = WQ[0], r; try { r = f(); } catch (e) { note("task", e); r = true; } if (r === false) return false; WQ.shift(); if (r === "later") WQ.push(f); return true; }
  function runQueue(budget) { var t0 = now(), k = WQ.length; while (WQ.length && k-- > 0 && now() - t0 < budget) if (!runOne()) break; }
  function idleStep(dl) { var t0 = now(), k = WQ.length, ran = false; while (WQ.length && k-- > 0 && dl.timeRemaining() > 1.5 && now() - t0 < 8) { ran = true; if (!runOne()) break; } if (ran) WQ.idleAt = now(); if (WQ.length) ric(idleStep, { timeout: 1000 }); else idleOn = false; }
  function kick() { if (idleOn || !WQ.length) return; idleOn = true; ric(idleStep, { timeout: 1000 }); }
  P.queue = function (fn) { WQ.push(fn); kick(); };
  // a staged (generator) build stepped inside the per-frame budget; at least one stage per call
  P.step = function (it, ms) { var t0 = now(), r; do { r = it.next(); } while (!r.done && now() - t0 < (ms || P.K.budget)); P.n.steps = (P.n.steps || 0) + 1; return r; };
  P.drain = function (it) { var r; do { r = it.next(); } while (!r.done); return r.value; };

  function mainRT() { try { return POST.on && POST.rt && !document.body.classList.contains("photo") ? POST.rt : null; } catch (e) { return null; } }
  // compile a group's materials the way the main pass will draw them: lights from the scene (the group's own point and spot
  // lights are pooled by the client, so they never count), the post target's colour space, fog or (the room probes) no fog
  function compileGroup(g, async, noFog) {
    if (noFog && P.K.r6) return async ? Promise.resolve() : undefined;   // R6: the probes keep the fog (zero density), so there is no fog-free variant to prepare
    var hid = []; g.traverse(function (o) { if ((o.isPointLight || o.isSpotLight) && !o.userData.pooled && o.visible) { hid.push(o); o.visible = false; } });
    var fog = scene.fog, prt = renderer.getRenderTarget(), tm = renderer.toneMapping, rt = mainRT(), res;
    try { if (noFog) scene.fog = null; renderer.setRenderTarget(rt); if (!rt) renderer.toneMapping = THREE.ACESFilmicToneMapping; hemiFix(); CW.mine++; try { res = async ? renderer.compileAsync(g, camera, scene) : renderer.compile(g, camera, scene); } finally { CW.mine--; } }
    finally { renderer.setRenderTarget(prt); renderer.toneMapping = tm; scene.fog = fog; for (var i = 0; i < hid.length; i++) hid[i].visible = true; }
    return res;
  }
  P.compileGroup = compileGroup;
  // R6: renderer.compile / compileAsync called by the client and the modules. The cabin warm-up and the fly-in compiled the whole
  // scene with no render target set, that is for the screen's colour space, which the post-processed main pass never draws in:
  // about 190 programs at every load that nothing used. With the main pass's target (and the hemisphere spares settled) they are
  // the main pass's own programs. Calls made with a target, and plan_perf's own, are left as they are.
  var CW = P.cw = { mine: 0, n: 0 };
  function wrapCompile() {
    var R = renderer; if (!P.K.r6 || !R || R.__r6c) return; R.__r6c = true; var c0 = R.compile, rr0 = R.render, SC = G("scene");
    R.render = function (sc) { if (sc === SC) hemiFix(); return rr0.apply(this, arguments); };   // every pass of the main scene sees the settled spares
    R.compile = function () { if (CW.mine > 0) return c0.apply(this, arguments); var prt = this.getRenderTarget(), rt = prt === null ? mainRT() : null; CW.n++;
      try { hemiFix(); if (rt) this.setRenderTarget(rt); return c0.apply(this, arguments); } finally { if (rt) this.setRenderTarget(prt); } };
  }
  // a room's materials are cloned on every entry and disposed on the way out (the gfx floor probes, the FBO's model copies); three.js
  // then deletes a program nobody uses, and the next entry compiles it again. Every program gets one extra user: compiled once per session.
  function pinPrograms() { var ps = renderer.info.programs || [], n = 0; for (var i = 0; i < ps.length; i++) { var p = ps[i]; if (!p.perfPin) { p.perfPin = true; p.usedTimes++; n++; } } P.n.pinned = (P.n.pinned || 0) + n; }
  P.pinPrograms = pinPrograms;
  // programs issued by compile() link in the driver; the first use blocks until they have. Do that wait here, in slices.
  var DONEP = new WeakSet();
  function finishSome(until) { var ps = renderer.info.programs || [], left = 0; for (var i = 0; i < ps.length; i++) { var p = ps[i]; if (DONEP.has(p)) continue; if (now() > until) { left++; continue; } try { if (p.isReady && !p.isReady()) { left++; continue; } p.getUniforms(); } catch (e) {} DONEP.add(p); } return left; }
  function texturesOf(g) { var out = new Set(); g.traverse(function (o) { var ms = o.material; if (!ms) return; ms = Array.isArray(ms) ? ms : [ms]; for (var i = 0; i < ms.length; i++) { var m = ms[i]; for (var k in m) { var v = m[k]; if (v && v.isTexture && !v.isRenderTargetTexture && !v.isVideoTexture) out.add(v); } if (m.uniforms) for (var u in m.uniforms) { var w = m.uniforms[u] && m.uniforms[u].value; if (w && w.isTexture && !w.isRenderTargetTexture && !w.isVideoTexture) out.add(w); } } }); return Array.from(out); }
  function texReady(t) { var im = t.image; if (!im || t.version === 0) return false; if (t.isCompressedTexture || t.isDataTexture || t.isData3DTexture || t.isDataArrayTexture) return true; if (Array.isArray(im)) return im.length > 0 && im.every(function (x) { return x && x.complete !== false && (x.width || x.image); }); return im.complete !== false && !!(im.width || im.videoWidth || im.data); }
  function texPending(t) { try { return renderer.properties.get(t).__version !== t.version; } catch (e) { return false; } }
  // geometry buffers: a 4 px render of just these meshes (layer 30; every scene light is on layer 30 too, so the program is the main pass's)
  var GEOW = new WeakSet(), WR = { rt: null, cam: null };
  function lightsOn30() { var L = [hemi, sun, moon, P.hemi]; try { LIGHTS.pool.forEach(function (l) { L.push(l); }); LIGHTS.spool.forEach(function (l) { L.push(l); }); } catch (e) {} try { if (CSMX.csm) CSMX.csm.lights.forEach(function (l) { L.push(l); }); } catch (e) {} try { if (inside && inside.g) inside.g.traverse(function (o) { if (o.isHemisphereLight) L.push(o); }); } catch (e) {} for (var i = 0; i < L.length; i++) if (L[i] && L[i].layers) L[i].layers.enable(30); }
  // R9w: the 4 px warm-up target has the main pass's formats (half-float colour, a 32-bit depth texture) so that the driver's own
  // shader variants for that target are built during the warm-up and not at the mesh's first real draw (a 200 to 650 ms GPU stall
  // each). ?r9w=0: the plain 8-bit target of before.
  var R9W = !!(window.R9 && window.R9.part("w"));
  function r9WarmRT() { var rt = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true, stencilBuffer: false }); rt.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType); return rt; }
  function warmMeshes(list, attach) {
    var rt = mainRT(); if (!rt) { list.forEach(function (m) { GEOW.add(m.geometry); }); return; }   // no post target (low tier): a 4 px render would compile another variant
    if (!WR.rt) { WR.rt = R9W ? r9WarmRT() : new THREE.WebGLRenderTarget(4, 4); WR.cam = new THREE.PerspectiveCamera(60, 1, 0.1, 10); WR.cam.layers.set(30); }
    lightsOn30(); var added = false; if (attach && !attach.parent) { scene.add(attach); added = true; }
    var sv = [], anc = [];
    for (var i = 0; i < list.length; i++) { var m = list[i]; var root = m; while (root.parent) root = root.parent; if (root !== scene) continue; sv.push([m, m.layers.mask, m.frustumCulled, m.visible]); m.layers.enable(30); m.frustumCulled = false; m.visible = true; for (var p = m.parent; p && p !== scene; p = p.parent) if (!p.visible) { anc.push(p); p.visible = true; } }
    var su = renderer.shadowMap.autoUpdate, sn = renderer.shadowMap.needsUpdate, bg = scene.background, prt = renderer.getRenderTarget(), ar = renderer.info.autoReset;
    try { renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; scene.background = null; renderer.info.autoReset = true; hemiFix(); renderer.setRenderTarget(WR.rt); P.inFrame = (P.inFrame || 0) + 1; try { if (sv.length) renderer.render(scene, WR.cam); } finally { P.inFrame--; } }   /* R5: a mesh whose program is still linking is uploaded at its first real draw instead of waiting here */
    finally { renderer.setRenderTarget(prt); scene.background = bg; renderer.shadowMap.autoUpdate = su; renderer.shadowMap.needsUpdate = sn; renderer.info.autoReset = ar;
      for (var j = 0; j < sv.length; j++) { var s = sv[j]; s[0].layers.mask = s[1]; s[0].frustumCulled = s[2]; s[0].visible = s[3]; } for (var k = 0; k < anc.length; k++) anc[k].visible = false; if (added) scene.remove(attach); }
    for (var q = 0; q < list.length; q++) GEOW.add(list[q].geometry); P.n.geoWarm = (P.n.geoWarm || 0) + list.length;
  }
  // warm a group built ahead of the player (hidden): programs, then textures one per slot, then geometry in ~60k-vertex batches
  function inScene(g) { var r = g; while (r.parent) r = r.parent; return r === G("scene"); }
  function drawSoon(g, opts, name) {
    if (!opts.detached) return true; var k = (/^(?:stream|lazy) (.+)$/.exec(name || "") || [])[1]; if (!k) return false;
    try { var PL = G("PLACE"); if (PL && PL[k] && PL[k].length) return true; } catch (e) {}
    if (window.R9 && R9.part("x")) { try { var PTm = window.PLAN_TERMINAL; if (PTm && PTm.tset && PTm.tset.indexOf(k) >= 0) { P.n.r9tset = (P.n.r9tset || 0) + 1; return true; } } catch (e) {} }   // R9x: the FBO's furniture set is drawn at the first walk-in: its textures and buffers go up now, a slot at a time, not in the walk-in frame
    try { var IS = G("INSTSET"); for (var i = 0; i < IS.length; i++) if (IS[i].kind === k && IS[i].list && IS[i].list.length) return true; } catch (e) {}
    return false;
  }
  P.warmGroup = function (g, opts) {
    if (!P.K.warm || !g) return; opts = opts || {}; var st = { t0: 0, done: false }; var name = opts.name || g.name || "group";
    WQ.push(function () { if (P.K.r6 && !st.t0 && !(G("scene") || {}).environment && now() - (st.w0 || (st.w0 = now())) < 20000) return false;   /* R6: not before the sky's environment map exists (a standard material compiled without it is another program, used by nothing) */
      if (!st.t0) { st.t0 = now(); try { Promise.all([compileGroup(g, true), compileGroup(g, true, true)]).then(function () { st.done = true; }, function () { st.done = true; }); pinPrograms(); } catch (e) { note("warm compile " + name, e); st.done = true; } return false; } return st.done || now() - st.t0 > 15000; });
    // R6 (coordinator request): the warm-up uploads textures and geometry only for what will be drawn: a group in the scene (an
    // interior built ahead of the player) or a streamed / lazily loaded kind that is placed in the world. A kind used only inside
    // rooms (furniture, arcade cabinets) and a sample built and disposed again get their programs compiled and nothing uploaded
    // (they upload at their first real draw): 0.6 to 0.8 GB of GPU memory that was never drawn. ?r6wu=0: the R5 behaviour.
    if (P.K.r6 && P.K.r6wu && !drawSoon(g, opts, name)) { P.n.warmCompileOnly = (P.n.warmCompileOnly || 0) + 1; kick(); return; }
    WQ.push(function () { if (P.K.r6 && !opts.detached && !inScene(g)) return true; texturesOf(g).forEach(function (t) { WQ.splice(1, 0, function () { if (texReady(t) && texPending(t)) { renderer.initTexture(t); P.n.texWarm = (P.n.texWarm || 0) + 1; } return true; }); }); return true; });
    var meshes = null, mi = 0;
    WQ.push(function () { if (P.K.r6 && !opts.detached && !inScene(g)) return true; if (!meshes) { meshes = []; g.traverse(function (o) { if ((o.isMesh || o.isPoints || o.isLine) && o.geometry && !GEOW.has(o.geometry) && o.onBeforeRender === THREE.Object3D.prototype.onBeforeRender) meshes.push(o); }); }
      var t1 = now(); while (mi < meshes.length && now() - t1 < 2) { var batch = [], verts = 0; while (mi < meshes.length && verts < 60000) { var m = meshes[mi++]; if (GEOW.has(m.geometry)) continue; batch.push(m); verts += m.geometry.attributes.position ? m.geometry.attributes.position.count : 0; } if (batch.length) warmMeshes(batch, opts.detached ? g : null); }
      if (mi >= meshes.length) { P.n.warmed = (P.n.warmed || 0) + 1; P.n.lastWarm = name + " " + Math.round(now() - st.t0) + " ms"; return true; } return false; });
    kick();
  };

  // ───────────────────────── lazily loaded kinds: warmed off the critical path once they land ─────────────────────────
  var WARMED = {};
  function warmKinds(kinds) {
    (kinds || []).forEach(function (k) { if (WARMED[k] || !MODELS[k] || !MODELS[k].parts) return; WARMED[k] = 1; var m = MODELS[k]; var g = makeModel(k); g.visible = false; g.name = "perf lazy " + k;
      if (m.lodGeos && m.lodGeos.length) m.lodGeos.forEach(function (geo, i) { g.add(new THREE.Mesh(geo, (m.parts[i] || m.parts[m.parts.length - 1]).material)); });
      P.warmGroup(g, { detached: true, name: "lazy " + k }); });
    P.n.lazyWarm = Object.keys(WARMED).length;
  }
  P.warmKinds = warmKinds;
  function wrapLazy() {
    var f = window.PLAN_LOAD_KINDS; if (typeof f !== "function" || f.perf) return;
    var w = function (kinds) { var p = f.apply(this, arguments); try { if (p && p.then) p.then(function (got) { try { warmKinds(Array.isArray(got) ? got : kinds); } catch (e) { note("lazy warm", e); } }, function () {}); } catch (e) {} return p; };
    w.perf = true; w.orig = f; window.PLAN_LOAD_KINDS = w;
  }

  // ───────────────────────── shader pre-compilation behind the loading screen ─────────────────────────
  // The client hides #load when the world is built. The first time it does, we put it back (in the same task, before a paint),
  // build a hidden sample of every interior, compile the whole scene and wait for the programs to link, then let it go.
  // A new player (the fly-in starts at once) is not held: the same work runs in idle time after the flight.
  // ───────────────────────── R18 LD: the loading experience and the warm hold (HANDOFF_R18_LOADING.md) ─────────────────────────
  // After a hard refresh the first minutes of play lagged badly (ultra, cold cache: 3 fps for the first 10 s after the loading screen,
  // 13 fps to 30 s, frames up to 2.7 s): everything round the spawn drew for the first time as the player looked round (textures and
  // buffers uploaded at their first draw, 290 MB in 10 s), and the stream swapped the nearby kinds in behind it. The loading screen
  // now holds until the game is warm (watchLoad below, after the R9 shader pass):
  //   1. the view set (every kind placed within reach of the spawn in the first minutes) streams in full, 3 downloads at a time,
  //      started together with the shader pass;
  //   2. two camera sweeps round the spawn behind the loading screen: every direction is drawn once (programs, textures, buffers,
  //      shadow casters), the second after the view set is in;
  //   3. the warm-up queue runs with a frame budget instead of idle slices, every program links, the FBO furniture prep (R9y) runs;
  //   4. a settle window: LD.K.settleN frames in a row under LD.K.settleMs (100 ms, a hitch) with no new program.
  // Real progress on the bar and in the step list, an "Enter now" button after 15 s, a cap of LD.K.cap after the world is built.
  // ?ld=0: the R9 hold of before (no stream, no sweeps, no settle); ?ldcap=<s> another cap.
  var LD = P.ld = { on: !/[?&]ld=0\b/.test(Q), K: { cap: 50000, go: 15000, viewB: 520, viewP: 300, viewS: 160, conc: 3, qBudget: 22, texBudget: 18, texR: 420, settleN: 40, settleMs: 100, settleMax: 7000, sweepMs: 4200 }, n: {}, skip: false, active: false, v: 0, step: "", sweep: null, settle: null };
  (function () { var m = /[?&]ldcap=(\d+)/.exec(Q); if (m) LD.K.cap = +m[1] * 1000; })();
  var LDW = { build: [0, 0.38], shaders: [0.38, 0.27], warm: [0.65, 0.35] }, LDS = ["world", "shaders", "stream", "tex", "warm"];
  function ldEl(id) { return document.getElementById(id); }
  function ldBar(phase, f) { var w = LDW[phase]; if (!w) return; f = Math.max(0, Math.min(1, f || 0)); var v = w[0] + w[1] * f; if (v < LD.v) v = LD.v; LD.v = v;
    try { var b = ldEl("loadbar"), t = ldEl("ldpct"); if (b) b.style.width = (v * 100).toFixed(1) + "%"; if (t) t.textContent = Math.floor(v * 100) + "%"; } catch (e) {} }
  function ldStep(k) { if (LD.step === k) return; LD.step = k; var i0 = k === "done" ? LDS.length : LDS.indexOf(k); try { var L = ldEl("ldsteps"); if (!L) return; L.querySelectorAll("li").forEach(function (li) { var i = LDS.indexOf(li.getAttribute("data-k")); li.classList.toggle("ok", i < i0); li.classList.toggle("on", i === i0); }); } catch (e) {} }
  function ldMsg(s) { try { var m = ldEl("loadmsg"); if (m && s) m.textContent = s; } catch (e) {} }
  // the client's setLoad (world build, 0 to 1) and plan_perf's shader pass report here
  LD.build = function (p, m) { ldStep("world"); ldBar("build", p); if (m) ldMsg(m); };
  LD.shaders = function (s) { ldStep("shaders"); var m = /(\d+)%/.exec(s || ""), f = m ? +m[1] / 100 : 0; ldBar("shaders", /interiors/.test(s || "") ? 0.35 * f : /graphics \d/.test(s || "") ? 0.4 + 0.6 * f : 0.05); ldMsg(s); };
  (function ldBind() {
    var b = ldEl("ldgo"); if (b) b.addEventListener("click", function () { if (LD.skip) return; LD.skip = true; LD.n.skipAt = Math.round(now()); b.textContent = "Entering"; b.disabled = true; });
    var iv = setInterval(function () { var L = ldEl("load"); if (!L) return; if (L.classList.contains("off") && PRE.state >= 2) { clearInterval(iv); L.classList.remove("ld-can-go"); return; } L.classList.toggle("ld-can-go", now() > LD.K.go && PRE.state >= 1 && !LD.skip); }, 250);
  })();
  function ldSettled(PSm, k) { var s = PSm.st[k]; return s === "full" || s === "failed" || s === "dormant"; }
  // per frame while the hold runs (the perf frame hook): the sweep turns the view, the warm-up queue gets a budget, the settle counts
  var LDF = { pg: -1, last: 0 };
  // the textures of every kind streamed in full for the hold (the boot set and the view set) are uploaded a few a frame as the kinds
  // land: they are drawn in the first minutes anyway, and R6 drops a KTX2 texture's transcoded data from the heap 10 s after its
  // upload (a texture never uploaded keeps it, and the heap is already near 3 GB of its 4 GB limit while the world streams)
  var LDT = { seen: {}, q: [], n: 0, ms: 0 };
  function ldTexScan(PSm) { var ks = (PSm.bootKinds || []).concat(PSm.hold ? PSm.hold.ks : []);
    for (var i = 0; i < ks.length; i++) { var k = ks[i]; if (LDT.seen[k] || PSm.st[k] !== "full") continue; LDT.seen[k] = 1; var m = MODELS[k]; if (!m || !m.parts) continue;
      m.parts.forEach(function (pt) { var ms = Array.isArray(pt.material) ? pt.material : [pt.material]; ms.forEach(function (mt) { if (!mt) return; for (var key in mt) { var v = mt[key]; if (v && v.isTexture && !v.isRenderTargetTexture && !v.isVideoTexture && !LDTS.has(v)) { LDTS.add(v); LDT.q.push(v); } } }); }); } }
  function ldTexUp(budget) { var t0 = now(), n = 0; while (LDT.q.length && (n === 0 || now() - t0 < budget)) { var tx = LDT.q.shift(); try { if (texReady(tx) && texPending(tx)) { renderer.initTexture(tx); LDT.n++; n++; } } catch (e) { note("ld tex", e); } } LDT.ms += now() - t0; }
  // and the textures of everything else drawn in the scene within LD.K.texR of the spawn (the modules' own meshes; hidden groups
  // are left to their first draw): the first steps away from the spawn drew them for the first time (330 MB in the first 10 s)
  var LDTS = new Set();
  function ldTexScene() { var t0 = now(), sc = G("scene"), c = new THREE.Vector3(), R2 = LD.K.texR * LD.K.texR, px = 0, pz = 0, n = 0; try { px = player.position.x; pz = player.position.z; } catch (e) {} if (!sc) return;
    sc.traverseVisible(function (o) { var ms = o.material; if (!ms || !(o.isMesh || o.isPoints || o.isSprite)) return; if (!o.isInstancedMesh) { c.setFromMatrixPosition(o.matrixWorld); var dx = c.x - px, dz = c.z - pz; if (dx * dx + dz * dz > R2) return; }
      ms = Array.isArray(ms) ? ms : [ms]; for (var i = 0; i < ms.length; i++) { var mt = ms[i]; if (!mt) continue; for (var key in mt) { var v = mt[key]; if (v && v.isTexture && !v.isRenderTargetTexture && !v.isVideoTexture && !LDTS.has(v)) { LDTS.add(v); LDT.q.push(v); n++; } } } });
    LD.n.texScene = (LD.n.texScene || 0) + n; LD.n.texSceneMs = (LD.n.texSceneMs || 0) + Math.round(now() - t0); }
  LD.tex = LDT;
  function ldFrame() {
    var t = now(), dt = LDF.last ? t - LDF.last : 0; LDF.last = t;
    var PSm = window.PLAN_STREAM; if (LD.on && ((PSm && PSm.hold) || LD.active)) {   /* from the start of the shader pass: the view set's textures go up as it lands, and the heap guard */ try { if (PSm && PSm.st) ldTexScan(PSm); ldTexUp(LD.K.texBudget); } catch (e) { note("ld tex", e); }
      try { var mem = performance.memory; if (mem && mem.jsHeapSizeLimit) { var hi = mem.usedJSHeapSize > 0.66 * mem.jsHeapSizeLimit; if (PSm && PSm.hold) PSm.K.conc = hi ? 1 : LD.K.conc; if (hi) LD.n.heapHigh = (LD.n.heapHigh || 0) + 1; LD.n.heapMax = Math.max(LD.n.heapMax || 0, Math.round(mem.usedJSHeapSize / 1048576)); } } catch (e) {} }
    if (!LD.active) return;
    var sw = LD.sweep; if (sw) { var f = Math.min(1, (t - sw.t0) / LD.K.sweepMs); try { yaw = sw.yaw0 + f * Math.PI * 2; } catch (e) {} if (f >= 1) sw.done = true; }
    try { runQueue(LD.K.qBudget); } catch (e) { note("ld queue", e); }
    var pg = renderer.info.programs ? renderer.info.programs.length : 0, st = LD.settle;
    if (st) { if (dt > 0 && dt < LD.K.settleMs && pg === LDF.pg && !sw) st.n++; else st.n = 0; st.best = Math.max(st.best || 0, st.n); }
    LDF.pg = pg;
  }
  async function ldHold() {
    var t0 = now(), base = P.n.clientReadyMs || t0, cap = base + LD.K.cap, PSm = window.PLAN_STREAM, ks = [], yaw0 = 0, ry0 = 0, sweeps = 0, got = 0;
    LD.active = true; LD.n.h0 = Math.round(t0); try { yaw0 = yaw; ry0 = player.rotation.y; } catch (e) {}
    try { ks = PSm && PSm.hold ? PSm.hold.ks : []; } catch (e) {}
    try {
      for (;;) {
        var t = now(); if (LD.skip || t > cap) { LD.n.end = LD.skip ? "enter now" : "cap"; break; }
        got = 0; for (var i = 0; i < ks.length; i++) if (ldSettled(PSm, ks[i])) got++;
        var fs = ks.length ? got / ks.length : 1;
        if (!LD.sweep && sweeps < 2 && (sweeps === 0 || fs >= 1)) { try { yaw0 = yaw; } catch (e) {} LD.sweep = { t0: t, yaw0: yaw0 }; try { ldTexScene(); } catch (e) { note("ld tex scene", e); } }
        if (LD.sweep && LD.sweep.done) { sweeps++; LD.sweep = null; try { yaw = yaw0; } catch (e) {} LD.n["sweep" + sweeps] = Math.round(t - t0); }
        var left = finishSome(t + 3), q = WQ.length;
        if (fs < 1) { ldStep("stream"); ldMsg("Streaming the land around you (" + got + " of " + ks.length + ")"); }
        else if (sweeps < 2 || LD.sweep) { ldStep("tex"); ldMsg("Drawing every direction once: textures, shadows, materials"); }
        else { ldStep("warm"); if (!LD.settle) { LD.settle = { n: 0, t0: t }; LD.n.settle0 = Math.round(t - t0); } ldMsg(left || q || LDT.q.length ? "Final warm-up (" + (left + q + LDT.q.length) + " left)" : "Final warm-up: waiting for a steady frame rate");
          if ((LD.settle.n >= LD.K.settleN && !left && !q && !LDT.q.length) || t - LD.settle.t0 > LD.K.settleMax) { LD.n.end = LD.settle.n >= LD.K.settleN ? "warm" : "settle timeout"; LD.n.settleBest = LD.settle.best || 0; break; } }
        var sf = LD.settle ? Math.min(1, LD.settle.n / LD.K.settleN) : 0;
        ldBar("warm", 0.55 * fs + 0.25 * (Math.min(2, sweeps + (LD.sweep ? 0.5 : 0)) / 2) + 0.2 * sf);
        await sleep(100);
      }
    } finally {
      if (LD.settle) LD.n.settleBest = LD.settle.best || 0;
      LD.sweep = null; LD.settle = null; LD.active = false; try { yaw = yaw0; player.rotation.y = ry0; CAM.snap = 2; } catch (e) {}
      try { if (PSm && PSm.holdView) PSm.holdView(null, false); } catch (e) { note("ld view off", e); }
      LD.n.holdMs = Math.round(now() - t0); LD.n.texUp = LDT.n; LD.n.texMs = Math.round(LDT.ms); LD.n.view = ks.length; LD.n.got = got; LD.n.sweeps = sweeps; LD.n.totalMs = Math.round(now());
      ldBar("warm", 1); ldStep("done"); ldMsg("Welcome to Genesis");
    }
  }
  // the view set starts streaming with the shader pass (downloads and transcodes run in workers while the rooms are sampled)
  function ldStart() { if (!LD.on) return; var PSm = window.PLAN_STREAM; try { if (PSm && PSm.live && PSm.viewSet && PSm.holdView && !PSm.done) { var ks = PSm.viewSet(LD.K.viewB, LD.K.viewP, LD.K.viewS); PSm.holdView(ks, true, LD.K.conc); LD.n.viewKinds = ks.length; } } catch (e) { note("ld view", e); } }
  P.ldHold = ldHold;

  var PRE = P.pre = { state: 0 };
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function nextFrame() { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); }
  function both(g) { compileGroup(g, false); compileGroup(g, false, true); pinPrograms(); }
  // the client's own rooms (the FBO terminal, the arcade, then one of each other enterable kind, most common first): entered and
  // left again in one task, so no frame ever draws the player in there; the player, view and camera are put back afterwards
  // R9p: content first drawn long after load, compiled (waiting for the link) and drawn once into the warm-up target behind the
  // loading screen: the flight's gates and runway aids (plan_flight builds them once; they wait hidden between flights anyway) and
  // a stand-in for the client's fireworks (the first one of a session was a new program and a 110 ms stall)
  // wait (a frame at a time, at most ms) until the programs of these objects have linked; a material disposed meanwhile is skipped
  // (three's compileAsync polls a disposed material's program and throws, so it is not used here)
  async function r9Ready(objs, ms) { var t0 = now(), ms0 = []; objs.forEach(function (o) { var m = o.material; (Array.isArray(m) ? m : [m]).forEach(function (x) { if (x && ms0.indexOf(x) < 0) ms0.push(x); }); });
    for (;;) { var left = 0; for (var i = 0; i < ms0.length; i++) { var cp = null; try { cp = renderer.properties.get(ms0[i]).currentProgram; } catch (e) {} if (cp && cp.isReady && !cp.isReady()) left++; } if (!left || now() - t0 > ms) return left; await nextFrame(); } }
  async function r9WarmExtras() {
    var roots = [], tmp = null; var FLm = window.PLAN_FLIGHT; if (FLm && FLm.r9prep) { try { roots = roots.concat(FLm.r9prep()); } catch (e) { note("pre flight", e); } }
    try { var pg = new THREE.BufferGeometry(); pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3)); tmp = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })); tmp.frustumCulled = false; tmp.name = "r9 warm points"; scene.add(tmp); roots.push(tmp); } catch (e) { note("pre points", e); }
    try { roots.forEach(function (r) { compileGroup(r, false); }); var list = []; roots.forEach(function (r) { r.traverse(function (o) { if (o.isMesh || o.isLine || o.isSprite || o.isPoints) list.push(o); }); });
      await r9Ready(list, 6000); warmMeshes(list, null); pinPrograms(); P.n.r9extras = list.length;
    } finally { if (tmp) { scene.remove(tmp); tmp.geometry.dispose(); tmp.material.dispose(); } }
  }
  // R9p: probe-lit floors (plan_gfx) compiled with a stand-in probe and drawn once into the warm-up target while the loading screen is up
  async function r9WarmProbes() { var GXm = window.PLAN_GFX; if (!GXm || !GXm.r9warmProbes) return 0;
    return GXm.r9warmProbes(async function (meshes, grp) { var roots = []; meshes.forEach(function (m) { var r = m; while (r.parent && r.parent !== scene) r = r.parent; if (roots.indexOf(r) < 0) roots.push(r); });
      roots.forEach(function (r) { compileGroup(r, false); }); await r9Ready(meshes, 6000); warmMeshes(meshes, null); pinPrograms(); }); }
  async function sampleRooms(say, deadline) {
    if (typeof enterInterior !== "function" || inside || (FLY && FLY.on) || riding) return;
    var IN = window.PLAN_INTERIORS, H = window.PLAN_HANGARS; var skip = {}; try { for (var t in IN.api.TYPES) skip[t] = 1; } catch (e) {} try { skip.hangar_exec = 1; } catch (e) {}
    var kinds = DOOR_KINDS.filter(function (k) { return !skip[k] && PLACE[k] && PLACE[k].length && MODELS[k]; });
    kinds.sort(function (a, b) { var pa = a === "terminal" ? 1e6 : a === "arcade" ? 1e5 : PLACE[a].length, pb = b === "terminal" ? 1e6 : b === "arcade" ? 1e5 : PLACE[b].length; return pb - pa; });
    var n = 0, t0 = now();
    for (var i = 0; i < kinds.length; i++) {
      if (now() > deadline || LD.skip) break; var k = kinds[i], e = PLACE[k][0];
      say("Preparing the graphics: " + (k === "terminal" ? "the terminal" : k === "arcade" ? "the arcade" : "interiors " + Math.round(100 * i / kinds.length) + "%"));
      var keep = { p: player.position.clone(), yaw: yaw, pitch: pitch, ry: player.rotation.y, cp: camera.position.clone(), cq: camera.quaternion.clone() };
      try { enterInterior({ kind: k, i: 0, e: e, r: MODELS[k].radius * e[4] }); if (inside && inside.g) { try { collectLights(); } catch (x) {} both(inside.g); n++; } } catch (err) { note("pre room " + k, err); }
      if (k === "terminal" && inside && inside.g) { await nextFrame(); await nextFrame(); pinPrograms(); if (window.R9 && R9.part("p")) { try { await r9WarmProbes(); } catch (e) { note("pre probes fbo", e); } } }   // two frames in the FBO behind the loading screen: the gfx floor probe and the hall pay their first-time costs here
      try { if (inside) leaveInterior(); } catch (err) { note("pre leave " + k, err); }
      player.position.copy(keep.p); yaw = keep.yaw; pitch = keep.pitch; player.rotation.y = keep.ry; camera.position.copy(keep.cp); camera.quaternion.copy(keep.cq);
      await nextFrame();
    }
    try { lastSent.at = 0; pushMove(true); } catch (x) {} try { updateCulling(true); } catch (x) {}
    P.n.preRooms = n; P.n.preRoomsMs = Math.round(now() - t0);
  }
  // the module interiors (hangars, clubhouse, restaurant, hangar home): one hidden sample of each, compiled with and without fog,
  // then disposed. This also pays their one-off costs (canvas surfaces, porch rasters, materials) here instead of on approach.
  function sampleModules() {
    var t0 = now(), n = 0;
    var IN = window.PLAN_INTERIORS;
    if (IN && IN.api && IN.list && IN.list.length && !IN.off) {
      var seen = {}; var act = IN.active; if (act) seen[act.kind] = 1;
      IN.list.forEach(function (h) { if (seen[h.kind] || h.L) return; seen[h.kind] = 1; try { var L = IN.api.build(h); if (L && L.g) { L.g.visible = true; both(L.g); n++; } } catch (e) { note("pre int3 " + h.kind, e); } try { IN.api.dispose(h); } catch (e) { note("pre int3 dispose", e); } IN.active = act || null; });
    }
    var H = window.PLAN_HANGARS;
    if (H && H.api && H.list && H.list.length && !H.off && !H.active) {
      var h = H.list.find(function (q) { return !q.L; });
      if (h) { try { var L2 = H.api.buildInterior(h); if (L2 && L2.g) { L2.g.visible = true; both(L2.g); n++; } } catch (e) { note("pre hangar", e); } try { H.api.disposeInterior(h); } catch (e) { note("pre hangar dispose", e); } }
    }
    // R6: the Dome Suites (one of each size, the model suite too), the three Grand Vaults and one Stargazer Pyramid: their interiors
    // were compiled on approach (about 20 programs a session after the loading screen); built here once, compiled, disposed
    var lvl = (G("QUAL") || {}).level; if (P.K.r6 && (lvl === "high" || lvl === "ultra")) {   /* the cascaded tiers only: on low and medium the builds cost more load time than the compiles save */
      var DM = window.PLAN_DOMES, SGm = window.PLAN_STARGAZE;
      if (DM && DM.api && DM.site && !DM.off) { var seenD = {};
        (DM.site.suites || []).forEach(function (Q2) { var k = Q2.size + (Q2.model ? "m" : ""); if (seenD[k] || Q2.L) return; seenD[k] = 1; try { var L3 = DM.api.buildInterior(Q2); if (L3 && L3.g) { L3.g.visible = true; both(L3.g); n++; Q2.L = L3; } } catch (e) { note("pre dome " + k, e); } try { if (Q2.L) DM.api.disposeInterior(Q2); } catch (e) { note("pre dome dispose", e); } Q2.L = null; });
        (DM.site.vaults || []).forEach(function (V) { if (V.L) return; try { var L4 = DM.api.buildVaultInterior(V); if (L4 && L4.g) { L4.g.visible = true; both(L4.g); n++; V.L = L4; } } catch (e) { note("pre vault", e); } try { if (V.L) DM.api.disposeVault(V); } catch (e) { note("pre vault dispose", e); } V.L = null; }); }
      if (SGm && SGm.api && SGm.site && !SGm.off) { var Py = (SGm.site.pyr || []).filter(function (q) { return q.open && !q.L; })[0];
        if (Py) { try { var L5 = SGm.api.buildInterior(Py); if (L5 && L5.g) { L5.g.visible = true; both(L5.g); n++; Py.L = L5; } } catch (e) { note("pre pyramid", e); } try { if (Py.L) SGm.api.disposeInterior(Py); } catch (e) { note("pre pyramid dispose", e); } Py.L = null; } }
    }
    try { LIGHTS.dirty = true; } catch (e) {}
    P.n.preModules = n; P.n.preModulesMs = Math.round(now() - t0);
  }
  function sampleCabin() { try { if (FLY.warm || FLY.on || typeof warmCabin !== "function") return; if (P.hemi && !P.hemi2) P.hemi.visible = false; warmCabin(); } catch (e) { note("pre cabin", e); } hemiFix(); }
  // R9x (HANDOFF_R9_HITCHES.md 5.1): the action prompt (#prompt, a one-line pill with backdrop-filter: blur(10px)) gets a different
  // Skia blur program for each size class of its blurred backdrop: the browser builds one the first time a pill of that width is
  // composited. The short prompts inside an interior ("sit down", "step outside") need one nothing else uses, and it was built as you
  // walked into your first interior, freezing the whole frame for 0.2 to 2.6 s (GPU process: GrGaussianConvolutionFragmentProcessor
  // with a mirrored subset in y, D3D11 pixel shader link). Behind the loading screen we show invisible stand-ins of the prompt
  // (0.4 per cent opaque, above the loading screen so they really are composited), one for every width from 96 to 820 px in half
  // pixel steps, a batch at a time, so every one of those programs is built while the loading screen is up. ?r9x=0 turns it off.
  async function r9WarmPrompt() {
    var pr = document.getElementById("prompt"), ld = document.getElementById("load"); if (!pr || !ld || ld.classList.contains("off")) return 0;
    var cs = getComputedStyle(pr), tpl = pr.cloneNode(true), b0 = pr.querySelector("b"), b1 = tpl.querySelector("b"), i, j;
    for (i = 0; i < cs.length; i++) tpl.style.setProperty(cs[i], cs.getPropertyValue(cs[i]));
    if (b0 && b1) { var bs = getComputedStyle(b0); for (i = 0; i < bs.length; i++) b1.style.setProperty(bs[i], bs.getPropertyValue(bs[i])); }
    tpl.removeAttribute("id"); tpl.querySelectorAll("[id]").forEach(function (e) { e.removeAttribute("id"); }); tpl.setAttribute("aria-hidden", "true");
    var t = tpl.querySelector("span") || tpl; t.innerHTML = "<b" + (b1 ? ' style="' + b1.getAttribute("style").replace(/"/g, "&quot;") + '"' : "") + ">E</b> &nbsp;";
    var h = Math.round(pr.getBoundingClientRect().height) || 39, st = tpl.style;
    [["opacity", "0.004"], ["transition", "none"], ["animation", "none"], ["z-index", "31"], ["transform", "translateX(-50%)"], ["box-sizing", "border-box"], ["height", h + "px"], ["min-height", "0"], ["max-width", "none"], ["white-space", "nowrap"], ["overflow", "hidden"], ["pointer-events", "none"], ["display", "block"], ["visibility", "visible"]].forEach(function (kv) { st.setProperty(kv[0], kv[1], "important"); });
    var W = []; for (var w = 96; w <= 820; w += 0.5) W.push(w);
    var BATCH = 80, n = 0, t0 = now();
    for (i = 0; i < W.length; i += BATCH) {
      if (ld.classList.contains("off") || now() - t0 > 8000) break;
      var els = []; for (j = i; j < Math.min(W.length, i + BATCH); j++) { var c = tpl.cloneNode(true); c.style.setProperty("width", W[j] + "px", "important"); document.body.appendChild(c); els.push(c); n++; }
      await nextFrame(); await nextFrame(); await nextFrame();
      els.forEach(function (e) { e.remove(); });
    }
    P.n.r9prompt = n; P.n.r9promptMs = Math.round(now() - t0); return n;
  }
  // R9y (HANDOFF_R9_HITCHES.md 5.2): the FBO's furniture set (plan_terminal's TSET) loads lazily, 16 to 27 s after it is asked for,
  // so the boot's room sample never saw it. On the first walk-in the room then needed about six new programs at once (the set's
  // materials, and the box-projected copies plan_gfx makes of the floor-level materials for its room probe, before and after the
  // probe's first capture). Three of them at 1.1 s each tied up the driver and a frame waited 0.1 to 0.9 s. Once the set has
  // landed, while the player is outdoors, we build the room once in a single task (as the boot's sample does: entered and left in
  // the same task, so no frame ever draws it; the screen fade, the sound and the network move are held for that task), keep a
  // compile stand-in of every material it uses (and each probe copy a second time with a probe-sized cube), and then compile one
  // program at a time, the next only when the last has linked. Walking in then finds them all ready. ?r9y=0 turns it off.
  var R9Y = P.r9y = { st: 0, jobs: null, i: 0, cur: null, t: 0, n: { built: 0, jobs: 0, compiled: 0, skipped: 0, ms: 0, waitMs: 0 } };
  function r9yOn() { return !!(window.R9 && R9.part("y")); }
  function r9yCalm() { try { if (inside || riding || (FLY && FLY.on) || document.hidden) return false; if (typeof ARC !== "undefined" && ARC.on) return false; if (typeof golf !== "undefined" && golf.playing) return false; if (typeof cartMode !== "undefined" && cartMode) return false; if (typeof SIT !== "undefined" && SIT.on) return false; if (typeof airborne !== "undefined" && airborne) return false; var L = document.getElementById("load"); if (L && !L.classList.contains("off") && !LD.active) return false; } catch (e) { return false; } return true; }
  function r9yClone(m) {   // a stand-in that compiles to the same program: the same parameters, hooks and program key
    var c = m.clone(); var own = function (k) { return Object.prototype.hasOwnProperty.call(m, k); };
    if (own("onBeforeCompile")) c.onBeforeCompile = m.onBeforeCompile; if (own("customProgramCacheKey")) c.customProgramCacheKey = m.customProgramCacheKey; if (m._userObc !== undefined) c._userObc = m._userObc; c.name = m.name; return c;
  }
  function r9yBuild() {
    var e = PLACE.terminal[0], door = { kind: "terminal", i: 0, e: e, r: MODELS.terminal.radius * e[4] }, GXm = window.PLAN_GFX, jobs = [], seen = new Set(), t0 = now();
    var keep = { p: player.position.clone(), yaw: yaw, pitch: pitch, ry: player.rotation.y, cp: camera.position.clone(), cq: camera.quaternion.clone() };
    var W = window, held = {}; ["fade", "sfx", "pushMove", "updateCulling", "spawnHallWalkers", "solidifyGroup"].forEach(function (k) { if (typeof W[k] === "function") { held[k] = W[k]; W[k] = function () {}; } });   // held for this one task: the screen fade, the sound, the network move, and what only a real visit needs (culling, the hall's people, the room's collision)
    var cube = null; try { if (GXm && !GXm.r9cube) GXm.r9cube = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }); cube = GXm && GXm.r9cube ? GXm.r9cube.texture : null; } catch (x) {}
    P.inFrame = (P.inFrame || 0) + 1;
    try {
      enterInterior(door); R9Y.n.enterMs = Math.round(now() - t0);
      if (inside && inside.g) {
        try { if (GXm && GXm.r9watch) GXm.r9watch(); } catch (x) { note("r9y floor", x); }
        inside.g.updateMatrixWorld(true);
        inside.g.traverse(function (o) { if (!o.isMesh || o.isSkinnedMesh || o.isBatchedMesh || !o.geometry) return; var ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach(function (m) { if (!m || !m.isMaterial) return; var key = m.uuid + (o.isInstancedMesh ? "|i" + (o.instanceColor ? "c" : "") : ""); if (seen.has(key)) return; seen.add(key);
            var c = r9yClone(m), px = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, c, 1) : new THREE.Mesh(o.geometry, c);
            if (o.isInstancedMesh && o.instanceColor) px.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
            px.castShadow = o.castShadow; px.receiveShadow = o.receiveShadow; px.frustumCulled = false; px.matrixAutoUpdate = false; px.matrix.copy(o.matrixWorld); px.matrixWorld.copy(o.matrixWorld);
            var g = new THREE.Group(); g.name = "r9y stand-in"; g.add(px); var env0 = c.envMap;
            jobs.push({ g: g, m: c, env: env0 });
            var probe = false; try { probe = !!(o.userData && o.userData.gfxProbe) || /gfx:boxproj/.test(m.customProgramCacheKey()); } catch (x) {}
            if (probe && cube && c.isMeshStandardMaterial) jobs.push({ g: g, m: c, env: cube, cube: true });   // the same copy after the probe's first capture
          }); });
      }
    } catch (x) { note("r9y build", x); }
    finally {
      var tl = now(); try { if (inside) leaveInterior(); } catch (x) { note("r9y leave", x); } R9Y.n.leaveMs = Math.round(now() - tl);
      try { if (GXm && GXm.r9watch) GXm.r9watch(); } catch (x) {}
      P.inFrame--;
      for (var k in held) W[k] = held[k];
      player.position.copy(keep.p); yaw = keep.yaw; pitch = keep.pitch; player.rotation.y = keep.ry; camera.position.copy(keep.cp); camera.quaternion.copy(keep.cq);
    }
    R9Y.jobs = jobs; R9Y.i = 0; R9Y.n.built++; R9Y.n.jobs = jobs.length; R9Y.n.buildMs = Math.round(now() - t0);
  }
  function r9yReady(m) { var cp = null; try { cp = renderer.properties.get(m).currentProgram; } catch (e) {} return !cp || !cp.isReady || cp.isReady(); }
  function r9yFrame() {
    if (R9Y.st >= 3 || !r9yOn()) return; var PTm = window.PLAN_TERMINAL;
    if (!R9Y.fw) { R9Y.fw = true; var f0 = window.fade; if (typeof f0 === "function") window.fade = function () { R9Y.fadeAt = now(); return f0.apply(this, arguments); }; }   // a door's fade to black: the build can hide behind it
    if (R9Y.st === 0) {
      if (!(P.readyAt || LD.active) || !PTm || !PTm.tsetDone || (PTm.tsetMissing && PTm.tsetMissing().length)) return;
      if (!(PLACE.terminal && PLACE.terminal.length && MODELS.terminal)) { R9Y.st = 3; return; }
      if (!r9yCalm()) { R9Y.since = 0; try { if (inside && inside.door && inside.door.kind === "terminal") R9Y.st = 3; } catch (e) {} return; }   // walked in first: nothing left to prepare
      var tn = now(); if (!R9Y.since) R9Y.since = tn; var black = R9Y.fadeAt && tn - R9Y.fadeAt > 200 && tn - R9Y.fadeAt < 300;   // the fade is fully dark 0.25 s after it starts
      if (!black && !LD.active && tn - R9Y.since < 20000) return;   // otherwise at most 20 s of calm later: one 45 ms task, against a 0.1 to 0.9 s stall at the walk-in
      R9Y.n.hidden = black; R9Y.st = 1; R9Y.t0 = tn; r9yBuild(); if (!R9Y.jobs || !R9Y.jobs.length) R9Y.st = 3; return;
    }
    if (R9Y.st === 1) {
      try { if (inside && inside.door && inside.door.kind === "terminal") { r9yDone(); return; } } catch (e) {}   // walked in meanwhile: the room compiles the rest itself
      if (R9Y.cur) { if (!r9yReady(R9Y.cur.m) && now() - R9Y.t < 8000) return; R9Y.n.waitMs += Math.round(now() - R9Y.t); pinPrograms(); R9Y.cur = null; }
      if (!r9yCalm()) return;
      var j = R9Y.jobs[R9Y.i++]; if (!j) { r9yDone(); return; }
      var np = renderer.info.programs.length;
      try { if (j.m.envMap !== j.env) { j.m.envMap = j.env; j.m.needsUpdate = true; } if (j.cube && !R9Y.pm) { j.env.needsPMREMUpdate = true; R9Y.pm = true; } compileGroup(j.g, false); } catch (e) { note("r9y compile", e); }
      if (renderer.info.programs.length > np) { R9Y.n.compiled++; R9Y.cur = j; R9Y.t = now(); } else R9Y.n.skipped++;
    }
  }
  function r9yDone() { pinPrograms(); (R9Y.jobs || []).forEach(function (j) { try { j.m.dispose(); } catch (e) {} }); R9Y.jobs = null; R9Y.cur = null; R9Y.st = 3; R9Y.n.ms = Math.round(now() - (R9Y.t0 || now())); }
  P.r9yFrame = r9yFrame;
  async function runPre(hold) { P.inFrame = (P.inFrame || 0) + 1; try { return await runPre0(hold); } finally { P.inFrame--; } }   /* R5: the pre-compile renders never wait for a link either */
  async function runPre0(hold) {
    var t0 = now(), msg = document.getElementById("loadmsg"), deadline = t0 + P.K.preHold;
    var say = function (s) { if (hold && msg) { if (LD.on) LD.shaders(s); else msg.textContent = s; } };
    var c0 = renderer.info.programs.length; say("Preparing the graphics"); await nextFrame();
    if (hold) { try { await sampleRooms(say, t0 + P.K.preHold * 0.55); } catch (e) { note("pre rooms", e); } }
    try { sampleModules(); } catch (e) { note("pre modules", e); }
    if (hold) sampleCabin();
    if (hold && window.R9 && R9.part("p")) { try { await r9WarmProbes(); } catch (e) { note("pre probes", e); } }
    if (hold && window.R9 && R9.part("p")) { try { await r9WarmExtras(); } catch (e) { note("pre extras", e); } }   // R9p: the GBANK hall floor (the FBO's is done inside sampleRooms)
    try { collectLights(); } catch (e) {}
    try { compileGroup(scene, false); } catch (e) { note("pre scene", e); }
    P.n.preIssued = renderer.info.programs.length - c0;
    var pw = null; if (hold && window.R9 && R9.part("x")) { try { pw = r9WarmPrompt().catch(function (e) { note("pre prompt", e); }); } catch (e) { note("pre prompt", e); } }   // R9x: every width of the action prompt's blurred pill, invisibly, behind the loading screen, while the driver links the scene's programs
    if (P.r5 && P.r5.on && P.r5.ns && P.r5.ns.par) deadline = Math.max(deadline, now() + 45000);   /* R5: nothing blocks now, so the loading screen waits (animated) while the driver links, up to 45 s */
    for (;;) { var left = finishSome(now() + 40); var tot = renderer.info.programs.length; say("Preparing the graphics " + Math.round(100 * (tot - left) / Math.max(1, tot)) + "%"); if (!left || now() > deadline || LD.skip) break; await sleep(left ? 16 : 0); }
    if (pw) { try { await pw; } catch (e) {} }
    P.n.preMs = Math.round(now() - t0); P.n.prePrograms = renderer.info.programs.length; pinPrograms();
    if (finishSome(0) > 0) P.queue(function () { return finishSome(now() + 3) === 0 ? true : "later"; });
  }
  P.runPre = runPre;
  function ready() { if (P.readyAt) return; P.readyAt = now(); P.loadMs = P.readyAt; try { if (PRE.mo) PRE.mo.disconnect(); } catch (e) {} try { preCands(); } catch (e) {} }
  function watchLoad() {
    var el = document.getElementById("load"); if (!el || !window.MutationObserver || PRE.mo) return;
    PRE.mo = new MutationObserver(function () {
      if (!el.classList.contains("off")) return;
      if (PRE.state === 0) {
        PRE.state = 1; P.n.clientReadyMs = Math.round(now());
        if (!P.K.pre || !window.PLAN) { PRE.state = 2; ready(); return; }
        var fly = false; try { fly = !!FLY.on; } catch (e) {}
        if (fly) {   // a new player: the fly-in has started; compile in idle time and sample the interiors once the flight is over
          ready(); P.queue(function () { try { compileGroup(scene, true); } catch (e) { note("pre scene", e); } return true; });
          P.queue(function () { try { if (FLY.on) return false; } catch (e) {} try { sampleModules(); } catch (e) { note("pre modules", e); } PRE.state = 2; return true; });
          return;
        }
        el.classList.remove("off"); ldStart();   // R18 LD: the view set streams while the shaders compile
        runPre(true).catch(function (e) { note("pre", e); }).then(function () { if (LD.on) return ldHold(); }).catch(function (e) { note("ld hold", e); }).then(function () { PRE.state = 2; el.classList.add("off"); });
        return;
      }
      if (PRE.state === 2) ready();
    });
    PRE.mo.observe(el, { attributes: true, attributeFilter: ["class"] });
  }

  // ───────────────────────── install (the world hook; a legacy world without hooks installs on the first frame) ─────────────────────────
  function tryInstall() { if (P.installed) return; if (typeof renderFrame !== "function" || typeof player === "undefined" || !player) return; install(); }
  function install() {
    if (P.installed) return; P.installed = true;
    try { hemiInit(); } catch (e) { note("hemi", e); }
    try { wrapCompile(); } catch (e) { note("wrap compile", e); }
    try { wrapRender(); } catch (e) { note("wrap render", e); }
    try { wrapShadowMap(); } catch (e) { note("wrap shadow map", e); }    try { wrapLazy(); } catch (e) { note("wrap lazy", e); }
    try { wrapCulling(); } catch (e) { note("wrap culling", e); }
    try { watchLoad(); } catch (e) { note("watch load", e); }
    try { if (typeof warmCabin === "function" && !warmCabin.perf) { var wc = warmCabin; warmCabin = function () { if (P.hemi && !P.hemi2) P.hemi.visible = false; var R = renderer, r0 = R.render, stub = P.K.r6 && P.K.r6wu && !FLY.on; if (stub) R.render = function () {}; try { return wc.apply(this, arguments); } finally { if (stub) R.render = r0; hemiFix(); } }   /* R6: the cabin's programs are compiled (renderer.compile); its 8 px test render, which uploaded every texture of the cabin and the scene for a flight that may never happen, is skipped */; warmCabin.perf = true; } } catch (e) { note("wrap cabin", e); }
    if (!P.readyAt) { try { if (document.getElementById("load").classList.contains("off")) ready(); } catch (e) {} }
  }
  P.install = install;
  (function hookAll() {
    var set = function (phase, name, fn) { var list = window.PLAN_HOOKS[phase]; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name: name, fn: fn }); };
    set("world", "perfWorld", function () { install(); });
    set("frame", "perfFrame", function (dt, t) { try { cullFrame(t); } catch (e) { note("cull frame", e); } try { r9yFrame(); } catch (e) { note("r9y", e); } try { ldFrame(); } catch (e) { note("ld frame", e); } });
  })();

  // ───────────────────────── indoor portal culling ─────────────────────────
  // Inside a room the outside is seen only through its openings (glass walls, windows, open doors, skylights). Each opening is a
  // rectangle in the room's frame; from the camera position it makes a pyramid (four planes through the camera and the opening's
  // edges, plus the opening's own plane). An outside object (a top-level scene object, or one instance of an instanced kind) is
  // drawn only when its bounding sphere reaches into a pyramid, or into the room's own box. The test depends on the camera's
  // position only (not its direction), so turning around never pops anything in. Hidden objects get layer mask 0 (no main pass,
  // no shadow pass) and their mask back on the way out; instances are dropped from the instance buffers the client fills.
  var IC = P.ic = { kind: null, key: null, sig: 0, quads: [], boxes: [], np: 0, all: true, at: 0, cam: new THREE.Vector3(1e9, 0, 0), M: new THREE.Matrix4(), inv: new THREE.Matrix4(), invS: 1, cands: [], nObj: 0, nInst: 0, roots: [] };
  var PL = new Float64Array(64 * 20), _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _mc = new THREE.Vector3(), _s = new THREE.Sphere(), _bx = new THREE.Box3(), _m4 = new THREE.Matrix4();
  function roomKey() { try { var ins = inside; if (ins) { if (ins.hgr) return ins.hgr; if (ins.int3) return ins.int3; if (ins.g) return ins.g; } } catch (e) {} var GB = window.PLAN_GBANK; if (GB && GB.site && (GB.zoneNow === 2 || GB.zoneNow === 3)) return GB;
    var RH = P.rooms; if (RH) for (var i = 0; i < RH.length; i++) { try { var rk = RH[i].key(); if (rk) return rk; } catch (e) {} }   // R4: module rooms (PLAN_PERF.rooms [{ name, key() }], the key has perfRoom(R) and perfSig())
    return null; }
  function roomSig(k) { try { if (inside && inside.hgr === k) return k.open > 0.02 ? 2 : 1; } catch (e) {} if (k && typeof k.perfSig === "function") { try { return k.perfSig(); } catch (e) { return 0; } } if (k && k.zoneNow) return k.zoneNow; return 0; }
  // rectangles in a room frame: ax "x" = the plane z = c (a: x, b: y), "z" = the plane x = c (a: z, b: y), "y" = the plane y = c (a: x, b: z)
  function R(ax, c, a0, a1, b0, b1) { return { ax: ax, c: c, a0: Math.min(a0, a1), a1: Math.max(a0, a1), b0: Math.min(b0, b1), b1: Math.max(b0, b1) }; }
  function mergeRects(list) { var out = []; list.forEach(function (r) { for (var i = 0; i < out.length; i++) { var o = out[i]; if (o.ax === r.ax && Math.abs(o.c - r.c) < 0.35) { o.a0 = Math.min(o.a0, r.a0); o.a1 = Math.max(o.a1, r.a1); o.b0 = Math.min(o.b0, r.b0); o.b1 = Math.max(o.b1, r.b1); return; } } out.push(R(r.ax, r.c, r.a0, r.a1, r.b0, r.b1)); }); return out; }
  function rectQuad(r, M) { var p = r.ax === "x" ? [[r.a0, r.b0, r.c], [r.a1, r.b0, r.c], [r.a1, r.b1, r.c], [r.a0, r.b1, r.c]] : r.ax === "z" ? [[r.c, r.b0, r.a0], [r.c, r.b0, r.a1], [r.c, r.b1, r.a1], [r.c, r.b1, r.a0]] : [[r.a0, r.c, r.b0], [r.a1, r.c, r.b0], [r.a1, r.c, r.b1], [r.a0, r.c, r.b1]]; return p.map(function (v) { return new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(M); }); }
  // thin transparent meshes (glass) as openings, in the room frame `inv`
  function glassRects(meshes, inv) { var out = []; meshes.forEach(function (m) { var g = m.geometry; if (!g) return; if (!g.boundingBox) g.computeBoundingBox(); _bx.copy(g.boundingBox).applyMatrix4(_m4.multiplyMatrices(inv, m.matrixWorld)); var sx = _bx.max.x - _bx.min.x, sy = _bx.max.y - _bx.min.y, sz = _bx.max.z - _bx.min.z, mn = Math.min(sx, sy, sz); if (mn > 0.6 || Math.max(sx, sy, sz) < 0.5) return;
    if (mn === sz) out.push(R("x", (_bx.min.z + _bx.max.z) / 2, _bx.min.x, _bx.max.x, _bx.min.y, _bx.max.y)); else if (mn === sx) out.push(R("z", (_bx.min.x + _bx.max.x) / 2, _bx.min.z, _bx.max.z, _bx.min.y, _bx.max.y)); else out.push(R("y", (_bx.min.y + _bx.max.y) / 2, _bx.min.x, _bx.max.x, _bx.min.z, _bx.max.z)); }); return out; }
  // the room the camera is in: its frame, its boxes (the camera must be in one of them) and its openings
  function describe(k) {
    if (k && typeof k.perfRoom === "function") { var Dm = k.perfRoom(R); if (Dm) return Dm; }   // R4: a module room describes itself
    var D = { kind: null, M: new THREE.Matrix4(), boxes: [], rects: [], roots: [] };
    if (inside && inside.hgr === k && k.L) { var L = k.L; D.kind = "hangar"; L.g.updateMatrixWorld(true); D.M.copy(L.g.matrixWorld); D.roots.push(L.g);
      D.boxes.push([L.xL - 0.3, L.xR + 0.3, -1, L.Hc + 1.5, L.zB - 0.3, L.zF + 0.6]);
      D.rects.push(R("z", L.xL, L.zB + 1, L.zF - 1, L.Hc - 0.95, L.Hc - 0.15), R("z", L.xR, L.zB + 1, L.zF - 1, L.Hc - 0.95, L.Hc - 0.15));   // the clerestory glazing
      if (k.open > 0.02) D.rects.push(R("x", L.zF, L.x0, L.x1, (L.fy || 0) - 0.5, L.dTop + 0.3));   // the hangar door
      return D; }
    if (inside && inside.int3 === k && k.L) { var L3 = k.L, T = L3.T; D.kind = "interior " + k.kind; L3.g.updateMatrixWorld(true); D.M.copy(L3.g.matrixWorld); D.roots.push(L3.g);
      (T.rooms || []).forEach(function (r) { D.boxes.push([r[0] - 0.3, r[2] + 0.3, r[4] - 1, r[5] + 0.6, r[1] - 0.3, r[3] + 0.3]); });
      if (!L3.ports || !L3.ports.length) return null;   // a module without recorded openings: no culling
      L3.ports.forEach(function (p) { D.rects.push(p[0] === "x" ? R("x", p[1], p[2], p[3], p[4], p[5]) : R("z", p[1], p[2], p[3], p[4], p[5])); });
      var Dd = T.door; if (Dd) D.rects.push(R("x", Dd.zw !== undefined ? Dd.zw : Dd.z, Dd.x0, Dd.x1, Dd.y0, Dd.y0 + Dd.h));
      return D; }
    if (inside && inside.g === k && inside.door) { var kind = inside.door.kind, half = inside.half, g = inside.g; D.kind = "room " + kind; g.updateMatrixWorld(true); D.M.copy(g.matrixWorld); D.roots.push(g);
      var isT = kind === "terminal", isA = kind === "arcade", isM = kind === "manor", isH = kind === "hangar" || kind === "hangarhome" || kind === "hangarhome2";
      var hgt = isT ? 9.5 : isA ? ((window.ARCADE_ROOM && ARCADE_ROOM.hgt) || 8) : isM ? 6.2 : 7.2;
      D.boxes.push([-half - 0.3, half + 0.3, -1, hgt + 0.6, -half - 0.3, half + 0.3]);
      if (isT || isA || isM) D.rects.push(R("x", half, -half, half, 0, hgt));   // the glass front
      else { var dw = isH ? half * 1.2 : 2.2; D.rects.push(R("x", half, -dw / 2, dw / 2, 0, 2.6)); if (!isH) [-1, 0, 1].forEach(function (kk) { [-1, 1].forEach(function (sd) { D.rects.push(R("z", sd * (half - 0.08), kk * half * 0.5 - 0.75, kk * half * 0.5 + 0.75, 1.25, 2.55)); }); }); }
      if (isT) { D.rects.push(R("y", hgt, -26.5, 26.5, -half, half)); try { if (TERM.landZ !== undefined) D.rects.push(R("z", half, TERM.landZ - 2.6, TERM.landZ + 2.6, 0, 4.2)); } catch (e) {} }   // skylights, the landside door
      return D; }
    if (k && k.site && k.zoneNow) { var S = k.site; D.kind = "gbank " + (k.zoneNow === 2 ? "hall" : "suite"); D.M.makeRotationY(Math.atan2(S.sn, S.cs)).setPosition(S.cx, S.B, S.cz);
      D.boxes.push([-17.5, 17.5, -1.5, 30, -12.6, 12.6]);
      var inv = new THREE.Matrix4().copy(D.M).invert(), gl = [];
      scene.children.forEach(function (o) { if (!/^gbank_/.test(o.name || "")) return; D.roots.push(o); o.traverse(function (q) { var mt = q.material; if (q.isMesh && mt && !Array.isArray(mt) && mt.transparent && mt.opacity < 0.5) gl.push(q); }); });
      D.rects = glassRects(gl, inv); return D; }
    return null;
  }
  function enterIndoor(k, sig) {
    var D = null; try { D = describe(k); } catch (e) { note("describe", e); }
    if (IC.kind) showAll();
    IC.key = k; IC.sig = sig; if (!D || !D.rects.length) { IC.kind = null; IC.quads = []; return; }
    IC.kind = D.kind; IC.M.copy(D.M); IC.inv.copy(D.M).invert(); IC.invS = 1 / Math.max(1e-6, D.M.getMaxScaleOnAxis()); IC.boxes = D.boxes; IC.roots = D.roots;
    var rects = mergeRects(D.rects).slice(0, 64); IC.quads = rects.map(function (r) { return rectQuad(r, D.M); }); IC.nRects = rects.length;
    collectCands(); IC.cam.set(1e9, 0, 0); IC.at = 0; P.n.indoor = (P.n.indoor || 0) + 1;
  }
  function leaveIndoor() { showAll(); IC.kind = null; IC.key = null; IC.quads = []; IC.np = 0; IC.nObj = 0; IC.nInst = 0; try { updateCulling(true); } catch (e) {} }
  // ── planes from the camera through every opening; false: the camera is outside the room boxes or standing in an opening (draw all)
  function buildPlanes(C) {
    IC.np = 0; if (!IC.quads.length) return false;
    _v.copy(C).applyMatrix4(IC.inv); var inBox = false; for (var b = 0; b < IC.boxes.length; b++) { var B = IC.boxes[b]; if (_v.x > B[0] && _v.x < B[1] && _v.y > B[2] && _v.y < B[3] && _v.z > B[4] && _v.z < B[5]) { inBox = true; break; } } if (!inBox) return false;
    for (var i = 0; i < IC.quads.length; i++) { var q = IC.quads[i], o = IC.np * 20;
      _mc.copy(q[0]).add(q[1]).add(q[2]).add(q[3]).multiplyScalar(0.25); _a.subVectors(q[1], q[0]); _b.subVectors(q[3], q[0]); _n.crossVectors(_a, _b).normalize();
      var dc = _n.dot(_mc) - _n.dot(C); if (dc < 0) { _n.negate(); dc = -dc; } if (dc < 0.08) return false;
      PL[o] = _n.x; PL[o + 1] = _n.y; PL[o + 2] = _n.z; PL[o + 3] = -_n.dot(_mc);
      for (var k = 0; k < 4; k++) { _a.subVectors(q[k], C); _b.subVectors(q[(k + 1) & 3], C); _n.crossVectors(_a, _b); var len = _n.length(); if (len < 1e-9) return false; _n.multiplyScalar(1 / len); if (_n.dot(_mc) - _n.dot(C) < 0) _n.negate(); var j = o + 4 + k * 4; PL[j] = _n.x; PL[j + 1] = _n.y; PL[j + 2] = _n.z; PL[j + 3] = -_n.dot(C); }
      IC.np++; }
    return IC.np > 0;
  }
  function inRoom(x, y, z, r) { var e = IC.inv.elements; var lx = e[0] * x + e[4] * y + e[8] * z + e[12], ly = e[1] * x + e[5] * y + e[9] * z + e[13], lz = e[2] * x + e[6] * y + e[10] * z + e[14], rl = r * IC.invS;
    for (var b = 0; b < IC.boxes.length; b++) { var B = IC.boxes[b]; if (lx > B[0] - rl && lx < B[1] + rl && ly > B[2] - rl && ly < B[3] + rl && lz > B[4] - rl && lz < B[5] + rl) return true; } return false; }
  function seen(x, y, z, r) {
    if (IC.all) return true; if (inRoom(x, y, z, r)) return true;
    for (var i = 0; i < IC.np; i++) { var o = i * 20, ok = true; for (var k = 0; k < 5; k++) { var j = o + k * 4; if (PL[j] * x + PL[j + 1] * y + PL[j + 2] * z + PL[j + 3] < -r) { ok = false; break; } } if (ok) return true; }
    return false;
  }
  P.seen = seen;
  // ── top-level scene objects: a bounding sphere in the object's own frame (moving groups carry it along), cached per object
  var CANDS = new WeakMap(), INSTM = new Set();
  function candOf(o) {
    var c = CANDS.get(o); if (c && c.nc === o.children.length) return c;
    _bx.makeEmpty(); var meshes = [], dyn = false;
    o.traverse(function (q) { if (!(q.isMesh || q.isPoints || q.isLine || q.isSprite)) return; meshes.push(q); var sp = null;
      if (q.isInstancedMesh) { if (!q.boundingSphere) q.computeBoundingSphere(); sp = q.boundingSphere; } else if (q.geometry) { if (!q.geometry.boundingSphere) q.geometry.computeBoundingSphere(); sp = q.geometry.boundingSphere; }
      if (q.isSkinnedMesh) dyn = true; if (!sp || !(sp.radius >= 0) || !isFinite(sp.radius)) return; _s.copy(sp).applyMatrix4(q.matrixWorld); _bx.expandByPoint(_v.copy(_s.center).addScalar(-_s.radius)); _bx.expandByPoint(_v.copy(_s.center).addScalar(_s.radius)); });
    if (_bx.isEmpty() || !meshes.length) c = { nc: o.children.length, empty: true, r: 0 };
    else { _bx.getBoundingSphere(_s); var lc = _s.center.clone().applyMatrix4(_m4.copy(o.matrixWorld).invert()); c = { nc: o.children.length, lc: lc, r: _s.radius * (dyn ? 1.5 : 1) + 0.5, meshes: meshes, hid: false }; }
    CANDS.set(o, c); return c;
  }
  // a candidate is a top-level object or, for a big group (the park, the site's signs), each of its children, down three levels;
  // a single object bigger than 700 m is always drawn
  function excluded(o) { return o.isLight || o.isCamera || INSTM.has(o) || (o.userData && (o.userData.noCull || o.userData.interior || o.userData.perf)); }
  function gather(o, depth, out, pend, t0) {
    if (excluded(o)) return;
    if (pend && !CANDS.has(o) && now() - t0 > 6) { pend.push([o, depth]); return; }
    var c = candOf(o); if (c.empty) return;
    if (c.r > 60 && depth < 3 && !o.isMesh && o.children.length > 1 && o.children.length <= 800) { for (var i = 0; i < o.children.length; i++) gather(o.children[i], depth + 1, out, pend, t0); return; }
    if (c.r <= 700) out.push(o);
  }
  function collectCands() {
    INSTM.clear(); try { INSTSET.forEach(function (S) { [S.insts, S.far, S.far2].forEach(function (a) { (a || []).forEach(function (m) { INSTM.add(m); }); }); }); } catch (e) {}
    var roots = new Set(IC.roots); var t0 = now(); IC.cands = []; IC.pend = [];
    for (var i = 0; i < scene.children.length; i++) { var o = scene.children[i]; if (roots.has(o) || o === player) continue; gather(o, 0, IC.cands, IC.pend, t0); }
  }
  // sphere cache filled in idle time after load, so entering a room never pays for it
  function preCands() { var st = scene.children.slice().map(function (o) { return [o, 0]; }); P.queue(function () { var t0 = now(); while (st.length && now() - t0 < 2) { var it = st.pop(), o = it[0]; if (excluded(o)) continue; try { var c = candOf(o); if (!c.empty && c.r > 60 && it[1] < 3 && !o.isMesh && o.children.length > 1 && o.children.length <= 800) for (var i = 0; i < o.children.length; i++) st.push([o.children[i], it[1] + 1]); } catch (e) {} } return st.length === 0 ? true : "later"; }); }
  P.preCands = preCands;
  function hideC(c) { var ms = c.meshes; for (var i = 0; i < ms.length; i++) { var m = ms[i]; if (m.layers.mask !== 0) { m.userData.perfMask = m.layers.mask; m.layers.mask = 0; } } c.hid = true; }
  function showC(c) { var ms = c.meshes; for (var i = 0; i < ms.length; i++) { var m = ms[i]; if (m.layers.mask === 0 && m.userData.perfMask !== undefined) { m.layers.mask = m.userData.perfMask; m.userData.perfMask = undefined; } } c.hid = false; }
  function showAll() { for (var i = 0; i < IC.cands.length; i++) { var c = CANDS.get(IC.cands[i]); if (c && c.hid) showC(c); } IC.nObj = 0; }
  function updateObjects() {
    if (IC.pend && IC.pend.length) { var t0 = now(); while (IC.pend.length && now() - t0 < 2) { var pp = IC.pend.pop(); gather(pp[0], pp[1], IC.cands, null, t0); } }
    var n = 0; for (var i = 0; i < IC.cands.length; i++) { var o2 = IC.cands[i], c = CANDS.get(o2); if (!c || c.empty) continue; if (!o2.parent) { if (c.hid) showC(c); continue; }
      _v.copy(c.lc).applyMatrix4(o2.matrixWorld); var vis = seen(_v.x, _v.y, _v.z, c.r); if (vis) { if (c.hid) showC(c); } else { if (!c.hid) hideC(c); n++; } }
    IC.nObj = n;
  }
  // ── instanced kinds: after the client's own culling, drop what no opening shows from each tier's instance buffer
  function filterTier(S, insts, idx, n) {
    if (!insts || !insts.length || !idx) return 0; var keep = S.perfKeep || (S.perfKeep = new Int32Array(S.list.length)); if (keep.length < S.list.length) keep = S.perfKeep = new Int32Array(S.list.length);
    var m = 0, h = 0; for (var k = 0; k < n; k++) { var i = idx[k], e = S.list[i], s = e[4], hh = S.h * s; if (seen(e[0], e[1] + hh * 0.5, e[2], S.rad * s * 1.4 + hh * 0.6)) { keep[m++] = i; h = (h + Math.imul(i + 1, 2654435761)) | 0; } }
    for (var q = 0; q < insts.length; q++) { var inst = insts[q], pk = inst.userData.perfPk, ver = inst.instanceMatrix.version;
      var clientWrote = !pk || pk.ver !== ver; if (clientWrote ? m === n : (pk.m === m && pk.h === h)) { if (clientWrote) inst.userData.perfPk = null; continue; }
      var arr = inst.instanceMatrix.array, src = S.mats; for (var k2 = 0; k2 < m; k2++) { var a = keep[k2] * 16, b = k2 * 16; for (var j = 0; j < 16; j++) arr[b + j] = src[a + j]; }
      inst.count = m; inst.visible = m > 0; inst.instanceMatrix.needsUpdate = true; inst.userData.perfPk = { ver: inst.instanceMatrix.version, m: m, h: h }; }
    return n - m;
  }
  function filterInst() { var c = 0; for (var s = 0; s < INSTSET.length; s++) { var S = INSTSET[s]; c += filterTier(S, S.insts, S.idx, S.n || 0); if (S.far) c += filterTier(S, S.far, S.idxF, S.nf || 0); if (S.far2) c += filterTier(S, S.far2, S.idxF2, S.nf2 || 0); } IC.nInst = c; }
  function wrapCulling() {
    if (P.uc || typeof updateCulling !== "function") return; var orig = updateCulling; P.uc = orig;
    updateCulling = function () { var r = orig.apply(this, arguments); if (IC.kind) { try { filterInst(); } catch (e) { note("cull inst", e); } } return r; };
  }
  function cullFrame(t) {
    if (!P.installed) return;
    var k = P.K.cull ? roomKey() : null;
    if (!k) { if (IC.kind || IC.key) leaveIndoor(); return; }
    var sig = roomSig(k); if (k !== IC.key || sig !== IC.sig) enterIndoor(k, sig);
    if (!IC.kind) return;
    var C = camera.position; if ((C.distanceToSquared(IC.cam) > 0.1225 && t - IC.at > 1000 / P.K.cullHz) || t - IC.at > 1000) { IC.at = t; IC.cam.copy(C); IC.all = !buildPlanes(C); updateObjects(); try { updateCulling(false); } catch (e) { note("cull update", e); } }
  }
  P.cullStats = function () { return { kind: IC.kind, rects: IC.nRects || 0, planes: IC.np, all: IC.all, cands: IC.cands.length, hiddenObjects: IC.nObj, hiddenInstances: IC.nInst }; };
})();

// ───────────────────────── R5 (1 Oct 2026, HANDOFF_R5_STABILITY.md): stability ─────────────────────────
// 1. No shader stalls. three.js links a shader program the first time something is drawn with it, and that first use waits on the
//    main thread until the driver has compiled it. On Windows (ANGLE over D3D11) with hundreds of programs queued behind it (the boot
//    pre-compile, the warm-up queue, a new area), one first use froze the page for 10 to 45 s ("page unresponsive"). With
//    KHR_parallel_shader_compile a draw of the main frame whose program is still linking is now skipped (that object appears a moment
//    later, when its program is ready); the main frame never waits for a link. Renders outside the frame (probes, PMREM) and nested
//    renders keep three's behaviour. ?pns=0 turns this part off.
// 2. Watchdog for the F3 overlay and the session summary: long tasks over 200 ms (with the script the browser blames), the JS heap and
//    its trend, an estimate of the GPU memory the page holds (every WebGL buffer, texture and renderbuffer allocation is counted as it
//    happens, and freed ones are taken off), shader programs still linking and the slowest links, draws skipped, the WebGL context
//    state. PLAN_PERF.r5.hist keeps one sample a minute (4 hours).
// 3. WebGL context loss: a short notice while three.js restores the context and uploads everything again; the client's environment
//    map and the shadow maps are redrawn. If the context does not come back, a Reload button (after a second loss: Low quality too).
// ?r5=0 turns every R5 part off (here and in client.js).
(function () {
  "use strict";
  var P = window.PLAN_PERF; if (!P || P.off || P.r5) return;
  var Q = location.search;
  var W = P.r5 = { on: !/[?&]r5=0\b/.test(Q), n: { skips: 0, lost: 0, restored: 0, long200: 0, long1s: 0, worstLong: 0, worstWho: "", nrMax: 0, firstMax: 0, firstSlow: 0, upMax: 0, upSlow: 0, upWho: "" }, longs: [], hist: [], last: null,
    gl: { buf: 0, tex: 0, rb: 0, nb: 0, nt: 0, nr: 0, peak: 0 }, links: { n: 0, done: 0, pend: 0, max: 0, slow: [] } };
  if (!W.on) return;
  var now = function () { return performance.now(); };
  function note(tag, e) { try { if (P.note) P.note("r5 " + tag, e); } catch (x) {} }
  function G(name) { try { return (0, eval)(name); } catch (e) { return undefined; } }
  var MB = 1048576;

  // ── GPU memory: every WebGL allocation counted as it happens (the browser has no API for it) ──
  var LP = new Map();
  (function glTrack() {
    var C = window.WebGL2RenderingContext; if (!C || !C.prototype || C.prototype.__r5gl) return; var PR = C.prototype; PR.__r5gl = true;
    var M = W.gl, recs = new WeakMap(), lv = new WeakMap();
    var FR = typeof FinalizationRegistry === "function" ? new FinalizationRegistry(function (r) { M[r.k] -= r.b; M["n" + r.k.charAt(0)]--; }) : null;
    function setB(o, k, b) { if (!o) return; var r = recs.get(o); if (!r) { r = { k: k, b: 0 }; recs.set(o, r); M["n" + k.charAt(0)]++; if (FR) FR.register(o, r, r); } M[k] += b - r.b; r.b = b; var t = M.buf + M.tex + M.rb; if (t > M.peak) M.peak = t; }
    function del(o, k) { var r = o && recs.get(o); if (!r) return; M[k] -= r.b; r.b = 0; recs.delete(o); if (FR) FR.unregister(r); M["n" + k.charAt(0)]--; }
    var BPP = { 0x8058: 4, 0x8C43: 4, 0x8051: 4, 0x8C41: 4, 0x881A: 8, 0x8814: 16, 0x881B: 8, 0x8815: 16, 0x8229: 1, 0x822B: 2, 0x822D: 2, 0x822E: 4, 0x822F: 4, 0x8230: 8, 0x81A6: 4, 0x81A5: 2, 0x8CAC: 4, 0x88F0: 4, 0x8CAD: 8, 0x1908: 4, 0x1907: 4, 0x1909: 1, 0x190A: 2, 0x1906: 1, 0x8C3A: 4, 0x8059: 4, 0x8056: 2, 0x8D62: 2, 0x8057: 2,
      0x83F0: 0.5, 0x83F1: 0.5, 0x83F2: 1, 0x83F3: 1, 0x8C4C: 0.5, 0x8C4D: 0.5, 0x8C4E: 1, 0x8C4F: 1, 0x8E8C: 1, 0x8E8D: 1, 0x8E8E: 1, 0x8E8F: 1, 0x9274: 0.5, 0x9275: 0.5, 0x9278: 1, 0x9279: 1, 0x8D64: 0.5, 0x93B0: 1, 0x93D0: 1, 0x8DBB: 0.5, 0x8DBD: 1 };
    function bpp(f, ty) { if (f === 0x1908 && ty === 0x1406) return 16; if (f === 0x1908 && (ty === 0x140B || ty === 0x8D61)) return 8; return BPP[f] || 4; }
    var BB = { 0x8892: 0x8894, 0x8893: 0x8895, 0x8A11: 0x8A28, 0x8F36: 0x8F36, 0x8F37: 0x8F37, 0x88EB: 0x88ED, 0x88EC: 0x88EF, 0x8C8E: 0x8C8F };
    function texOf(gl, t) { return gl.getParameter((t >= 0x8515 && t <= 0x851A) || t === 0x8513 ? 0x8514 : t === 0x806F ? 0x806A : t === 0x8C1A ? 0x8C1D : 0x8069); }
    function after(name, fn) { var o = PR[name]; if (typeof o !== "function") return; PR[name] = function () { var r = o.apply(this, arguments); try { fn.call(this, arguments); } catch (e) {} return r; }; }
    function before(name, fn) { var o = PR[name]; if (typeof o !== "function") return; PR[name] = function () { try { fn.call(this, arguments); } catch (e) {} return o.apply(this, arguments); }; }
    before("deleteBuffer", function (a) { del(a[0], "buf"); }); before("deleteTexture", function (a) { del(a[0], "tex"); }); before("deleteRenderbuffer", function (a) { del(a[0], "rb"); });
    before("deleteProgram", function (a) { LP.delete(a[0]); });
    after("bufferData", function (a) { var d = a[1], b = typeof d === "number" ? d : d ? (a[4] ? a[4] * (d.BYTES_PER_ELEMENT || 1) : d.byteLength - (a[3] || 0) * (d.BYTES_PER_ELEMENT || 1)) : 0; setB(this.getParameter(BB[a[0]] || 0x8894), "buf", b); });
    after("texStorage2D", function (a) { var b = 0; for (var l = 0; l < a[1]; l++) b += Math.max(1, a[3] >> l) * Math.max(1, a[4] >> l) * bpp(a[2]); if (a[0] === 0x8513) b *= 6; setB(texOf(this, a[0]), "tex", b); });
    after("texStorage3D", function (a) { var b = 0; for (var l = 0; l < a[1]; l++) b += Math.max(1, a[3] >> l) * Math.max(1, a[4] >> l) * bpp(a[2]) * (a[0] === 0x806F ? Math.max(1, a[5] >> l) : a[5]); setB(texOf(this, a[0]), "tex", b); });
    function level(gl, a, b) { var t = texOf(gl, a[0]); if (!t) return; var m = lv.get(t); if (!m) { m = new Map(); lv.set(t, m); } m.set(a[0] * 32 + a[1], b); var s = 0; m.forEach(function (v) { s += v; }); setB(t, "tex", s); }
    after("texImage2D", function (a) { var w, h, ty; if (a.length >= 8) { w = a[3]; h = a[4]; ty = a[7]; } else { var s = a[5]; ty = a[4]; w = s ? (s.videoWidth || s.naturalWidth || s.width || s.displayWidth || 0) : 0; h = s ? (s.videoHeight || s.naturalHeight || s.height || s.displayHeight || 0) : 0; } level(this, a, w * h * bpp(a[2], ty)); });
    after("texImage3D", function (a) { level(this, a, a[3] * a[4] * a[5] * bpp(a[2], a[8])); });
    after("compressedTexImage2D", function (a) { var d = a[6]; level(this, a, d && d.byteLength ? (a[8] || d.byteLength - (a[7] || 0)) : a[3] * a[4]); });
    after("renderbufferStorage", function (a) { setB(this.getParameter(0x8CA7), "rb", a[2] * a[3] * bpp(a[1])); });
    after("renderbufferStorageMultisample", function (a) { setB(this.getParameter(0x8CA7), "rb", a[3] * a[4] * bpp(a[2]) * Math.max(1, a[1])); });
    after("linkProgram", function (a) { W.links.n++; LP.set(a[0], now()); });
    ["texImage2D", "texSubImage2D", "compressedTexSubImage2D", "texImage3D", "texSubImage3D"].forEach(function (name) { var o = PR[name]; if (typeof o !== "function") return; PR[name] = function () { var t = now(); try { return o.apply(this, arguments); } finally { var d = now() - t; if (d > 30) { W.n.upSlow++; if (d > W.n.upMax) { W.n.upMax = Math.round(d); var a = arguments, s = a.length === 6 ? a[5] : a.length === 9 && name === "texImage2D" ? a[8] : null; W.n.upWho = name + " " + (s && (s.width || s.naturalWidth) ? (s.width || s.naturalWidth) + "x" + (s.height || s.naturalHeight) + " " + String(s.src || s.constructor && s.constructor.name || "").split("/").pop().slice(0, 30) : (a[3] || "") + "x" + (a[4] || "")); } } } }; });
  })();
  // link times (non-blocking COMPLETION_STATUS polls): the slowest programs are named in the overlay
  function pollLinks(gl) {
    var L = W.links; if (!LP.size) { L.pend = 0; return; } var t = now();
    LP.forEach(function (t0, p) { var v = null; try { v = gl.getProgramParameter(p, 0x91B1); } catch (e) {} if (v === null) { LP.delete(p); return; } if (!v) return; LP.delete(p); L.done++; var ms = Math.round(t - t0); if (ms > L.max) L.max = ms;
      if (ms >= 400) { L.slow.push({ p: p, ms: ms, at: Math.round(t0) }); L.slow.sort(function (a, b) { return b.ms - a.ms; }); if (L.slow.length > 8) L.slow.length = 8; } });
    L.pend = LP.size;
  }
  function progName(p) { try { var ps = renderer.info.programs; for (var i = 0; i < ps.length; i++) if (ps[i].program === p) return ps[i].name || ps[i].type || "?"; } catch (e) {} return "?"; }

  // ── no shader stalls ──
  var NS = W.ns = { on: !/[?&]pns=0\b/.test(Q), par: false, depth: 0, arr: null, NR: { r5: "program linking" }, fs: 0 };
  function guard(p) {
    if (!p || p.__r5g || typeof p.isReady !== "function" || typeof p.getUniforms !== "function") return; p.__r5g = true;
    var gu = p.getUniforms, ok = false, t0 = 0;
    p.getUniforms = function () { if (!ok) { if (NS.on && NS.depth === 1 && P.inFrame > 0 && !p.isReady() && !pmremTarget()) { if (!t0) t0 = now(); if (now() - t0 < 60000) throw NS.NR; } ok = true; var t1 = now(), u = gu.apply(this, arguments), d = now() - t1; if (d > W.n.firstMax) W.n.firstMax = Math.round(d); if (d > 50) W.n.firstSlow++; return u; } return gu.apply(this, arguments); };   // after a minute (a driver that never reports completion) three's own wait applies
  }
  // PMREM (environment maps) renders once into its cube-UV targets: those keep three's wait, a skipped draw there would stay
  function pmremTarget() { try { var rt = renderer.getRenderTarget(); return !!(rt && rt.texture && rt.texture.mapping === THREE.CubeUVReflectionMapping); } catch (e) { return false; } }
  function nsInstall(R) {
    if (!R || !R.info || !R.extensions) return; var arr = R.info.programs; if (!arr || arr === NS.arr) return;
    try { NS.par = !!R.extensions.has("KHR_parallel_shader_compile"); } catch (e) { NS.par = false; } if (!NS.par) return;   // without the extension every program is "ready": nothing to do
    NS.arr = arr; var push0 = Array.prototype.push;
    arr.push = function () { for (var i = 0; i < arguments.length; i++) guard(arguments[i]); return push0.apply(this, arguments); };
    for (var i = 0; i < arr.length; i++) guard(arr[i]);
    if (!R.__r5rbd) { var rbd = R.renderBufferDirect; R.__r5rbd = rbd;
      R.renderBufferDirect = function () { if (NS.depth === 0 && this.info.programs !== NS.arr) nsInstall(this);   /* a restored context has a new program list: guard it before its first draw */
        NS.depth++; try { return rbd.apply(this, arguments); } catch (e) { if (e === NS.NR) { W.n.skips++; NS.fs++; return; } throw e; } finally { NS.depth--; } }; }
  }

  // ── long tasks (with the script the browser blames, where Long Animation Frames are available) ──
  function addLong(t, d, who) {
    if (!P.readyAt || t < P.readyAt) return; W.n.long200++; if (d >= 1000) W.n.long1s++; if (d > W.n.worstLong) { W.n.worstLong = Math.round(d); W.n.worstWho = who || ""; }
    W.longs.push({ t: Math.round(t), d: Math.round(d), who: who || "" }); if (W.longs.length > 30) W.longs.shift();
  }
  var LOAF = false;
  try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (e.duration < 200) return; var s = (e.scripts || []).slice().sort(function (a, b) { return b.duration - a.duration; })[0]; var who = s ? ((s.sourceFunctionName || s.invoker || "?") + " " + String(s.sourceURL || "").split("/").pop().split("?")[0] + ":" + (s.sourceCharPosition || 0)) : "render/GPU"; addLong(e.startTime, e.duration, who); }); }).observe({ type: "long-animation-frame", buffered: false }); LOAF = true; } catch (e) {}
  if (!LOAF) { try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (e.duration >= 200) addLong(e.startTime, e.duration, ""); }); }).observe({ type: "longtask", buffered: false }); } catch (e) {} }

  // ── sampler: every 2 s (links, programs still linking), one stored sample a minute ──
  var lastMin = 0;
  function sample() {
    var R = G("renderer"); if (!R) return; nsInstall(R);
    // a program's first use reads its info logs to report shader errors: two more round trips to the GPU process per program, each
    // waiting behind whatever the driver is busy with. Off in deployed builds (three's advice for production), on in dev; ?shadercheck=0/1
    if (!W.csSet && R.debug) { W.csSet = true; var dev = !window.BUILD || window.BUILD === "dev"; if (/[?&]shadercheck=0\b/.test(Q) || (!dev && !/[?&]shadercheck=1\b/.test(Q))) R.debug.checkShaderErrors = false; W.n.shaderCheck = R.debug.checkShaderErrors; }
    try { var F = G("frame"); if (typeof F === "function" && !F.__r5) { var w = function () { P.inFrame = (P.inFrame || 0) + 1; try { return F.apply(this, arguments); } finally { P.inFrame--; } }; w.__r5 = true; (0, eval)("frame") === F && (window.frame = w); } } catch (e) { note("frame wrap", e); }   /* the whole client frame (its hooks render probes too) */
    var gl = null; try { gl = R.getContext(); } catch (e) {}
    if (gl && NS.par) pollLinks(gl);
    var nr = 0; try { var ps = R.info.programs; for (var i = 0; i < ps.length; i++) if (ps[i].isReady && !ps[i].isReady()) nr++; } catch (e) {} if (nr > W.n.nrMax) W.n.nrMax = nr;
    var heap = 0; try { heap = performance.memory ? performance.memory.usedJSHeapSize / MB : 0; } catch (e) {}
    var lost = false; try { lost = gl ? gl.isContextLost() : false; } catch (e) {}
    var s = { t: Math.round(now() / 1000), heap: Math.round(heap), gpu: Math.round((W.gl.buf + W.gl.tex + W.gl.rb) / MB), geo: 0, tex: 0, prog: 0, nr: nr, skips: W.n.skips, lost: lost, long: W.n.long200 };
    try { s.geo = R.info.memory.geometries; s.tex = R.info.memory.textures; s.prog = R.info.programs.length; } catch (e) {}
    W.last = s;
    if (now() - lastMin >= 60000) { lastMin = now(); W.hist.push(s); if (W.hist.length > 240) W.hist.shift(); }
  }
  setInterval(function () { try { sample(); } catch (e) { note("sample", e); } }, 2000);
  function trend() { var h = W.hist; if (h.length < 3) return null; var a = h[Math.max(0, h.length - 6)], b = h[h.length - 1]; var dt = (b.t - a.t) / 60; return dt > 0 ? (b.heap - a.heap) / dt : null; }

  W.lines = function () {
    var s = W.last; if (!s) return [];
    var tr = trend(), L = W.links, out = [];
    out.push("gpu ~" + (s.gpu >= 1024 ? (s.gpu / 1024).toFixed(2) + " GB" : s.gpu + " MB") + "   heap " + s.heap + " MB" + (tr !== null ? " (" + (tr >= 0 ? "+" : "") + tr.toFixed(0) + "/min)" : ""));
    out.push("long>200ms " + W.n.long200 + (W.n.worstLong ? "   worst " + (W.n.worstLong / 1000).toFixed(1) + " s" : "") + (W.n.worstWho ? "  " + W.n.worstWho.slice(0, 34) : ""));
    out.push("shaders linking " + s.nr + "   skipped draws " + W.n.skips + (L.max >= 400 ? "   slowest " + (L.max / 1000).toFixed(1) + " s" : ""));
    if (W.n.firstSlow || W.n.upSlow) out.push("slow first use " + W.n.firstSlow + " (max " + W.n.firstMax + " ms)   uploads " + W.n.upSlow + " (max " + W.n.upMax + " ms)");
    out.push("context " + (s.lost ? "LOST" : "ok") + (W.n.lost ? "   losses " + W.n.lost + " restored " + W.n.restored : ""));
    return out;
  };
  W.summary = function () { var s = W.last || {}; return { heapMB: s.heap || null, gpuMB: s.gpu || null, gpuPeakMB: Math.round(W.gl.peak / MB), long200: W.n.long200, long1s: W.n.long1s, worstLongMs: W.n.worstLong, worstLongWho: W.n.worstWho.slice(0, 80), lost: W.n.lost, restored: W.n.restored, skips: W.n.skips, linkMaxMs: W.links.max, linking: s.nr || 0, linkingMax: W.n.nrMax, firstUseMaxMs: W.n.firstMax, firstUseSlow: W.n.firstSlow, uploadMaxMs: W.n.upMax, uploadSlow: W.n.upSlow, uploadWho: W.n.upWho, heapTrend: trend() }; };
  W.slowLinks = function () { return W.links.slow.map(function (x) { return { ms: x.ms, at: x.at, name: progName(x.p) }; }); };

  // ── WebGL context loss: a notice, three.js restores, the client's environment map and shadows are redrawn; else a Reload button ──
  var CX = W.cx = { el: null, timer: 0, lostAt: 0 };
  function banner(html, buttons) {
    if (!document.body) return; var d = CX.el;
    if (!d) { d = CX.el = document.createElement("div"); d.id = "r5ctx"; d.style.cssText = "position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:100000;max-width:440px;padding:16px 20px;background:rgba(8,13,8,0.94);color:#f5f1e6;border:1px solid rgba(77,222,111,0.55);border-radius:10px;font:14px/1.45 'Space Grotesk',system-ui,sans-serif;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.5)"; document.body.appendChild(d); }
    d.innerHTML = html; d.style.display = "";
    (buttons || []).forEach(function (b) { var x = document.createElement("button"); x.textContent = b[0]; x.style.cssText = "margin:12px 6px 0;padding:7px 16px;border-radius:6px;border:1px solid #4DDE6F;background:" + (b[2] ? "#4DDE6F;color:#0a1610" : "transparent;color:#4DDE6F") + ";font:600 13px 'Space Grotesk',system-ui,sans-serif;cursor:pointer"; x.onclick = b[1]; d.appendChild(x); });
  }
  function hideBanner() { if (CX.el) CX.el.style.display = "none"; }
  function reload() { try { if (P.save) P.save(true); } catch (e) {} location.reload(); }
  function onLost() {
    W.n.lost++; CX.lostAt = now(); clearTimeout(CX.timer);
    banner("<b>Graphics paused</b><br>The graphics driver reset the 3D view. Restoring it now, this takes a few seconds.");
    CX.timer = setTimeout(function () {
      var gl = null; try { gl = renderer.getContext(); } catch (e) {} if (gl && !gl.isContextLost()) return;
      var btn = [["Reload", reload, true]]; if (W.n.lost >= 2) btn.push(["Low quality and reload", function () { try { localStorage.setItem("g1:quality", "low"); } catch (e) {} reload(); }]);
      banner("<b>The 3D view could not be restored</b><br>Reload to continue. You come back where you were.", btn);
    }, 15000);
  }
  function onRestored() {
    W.n.restored++; clearTimeout(CX.timer);
    try { var R = renderer; setTimeout(function () { try { nsInstall(R); } catch (e) {} }, 0); R.shadowMap.needsUpdate = true; } catch (e) { note("restore", e); }   // three re-creates its program list after this listener
    try { (0, eval)("envAt = -1e9"); } catch (e) {}   // the client's sky probe is redrawn on the next frame
    setTimeout(function () {   // the one-time room probes (hangars, walk-in interiors) are drawn again; the FBO's on its next check
      try { if (window.PLAN_HANGARS && PLAN_HANGARS.restoreEnv) PLAN_HANGARS.restoreEnv(); } catch (e) { note("restore hangars env", e); }
      try { if (window.PLAN_INTERIORS && PLAN_INTERIORS.restoreEnv) PLAN_INTERIORS.restoreEnv(); } catch (e) { note("restore interiors env", e); }
      try { if (window.PLAN_TERMINAL) PLAN_TERMINAL.envNight = -9; } catch (e) {}
    }, 500);
    try { if (P.pinPrograms) setTimeout(function () { try { P.pinPrograms(); } catch (e) {} }, 3000); } catch (e) {}
    banner("<b>Graphics restored</b><br>Some objects may take a moment to reappear."); CX.timer = setTimeout(hideBanner, 4000);
  }
  function hookCanvas() { var c = document.getElementById("gl"); if (!c || c.__r5cx) return !!c; c.__r5cx = true; c.addEventListener("webglcontextlost", function () { try { onLost(); } catch (e) { note("lost", e); } }, false); c.addEventListener("webglcontextrestored", function () { try { onRestored(); } catch (e) { note("restored", e); } }, false); return true; }
  if (!hookCanvas()) addEventListener("DOMContentLoaded", hookCanvas);
  W.test = function (ms) { var x = renderer.getContext().getExtension("WEBGL_lose_context"); if (!x) return "no WEBGL_lose_context"; x.loseContext(); setTimeout(function () { x.restoreContext(); }, ms || 2000); return "lost; restoring in " + (ms || 2000) + " ms"; };
})();

// ───────────────────────── R6 (2 Oct 2026, HANDOFF_R6_RENDER.md): fewer and smaller shader programs, less to draw ─────────────────────────
// The R5 guard stopped the long freezes, but every new program still cost a compile in the GPU process (ANGLE over D3D11), queued
// behind the others: 750 programs at load, 1,000 to 1,400 after a session, each lit one about 100 KB of fragment shader.
// 1. Fewer programs (in the first part of this file): a point or spot light outside the client's pool is never visible to the
//    renderer (lamps added inside groups used to count for up to 4 s: 11 to 18 point lights instead of 8, a full recompile each);
//    every hemisphere light is counted and two spares keep the count constant in every pass; renderer.compile without a target
//    compiles for the main pass's target; the room probes keep the fog (zero density) instead of a fog-free variant of everything.
//    750 programs at load became about 320.
// 2. Smaller programs (here): point and spot lights without shadows are lit in a plain loop instead of one unrolled copy per light,
//    and the cascaded sun is evaluated once with the cascades' blended shadow (same result: the cascades are one light and the direct
//    term is linear in its colour). 15 inlined lighting evaluations per lit shader become 3.
// 3. Less to draw: see "less to draw" below (shadow cascades, sub-pixel meshes, building LOD distance, static batches); the far
//    cascade is redrawn every 6th frame on ultra (shadowTurns, first part).
// ?r6=0 turns R6 off (here, in the first part of this file and in plan_gfx.js); ?r6ch=0 only the chunk rewrite.
(function () {
  "use strict";
  var P = window.PLAN_PERF; if (!P || P.off || P.r6) return;
  var Q = location.search;
  var S = P.r6 = { on: !!(P.K && P.K.r6), n: {}, errs: [] };
  if (!S.on) return;
  function note(tag, e) { try { if (S.errs.length < 20) S.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (P.note) P.note("r6 " + tag, e); } catch (x) {} }

  // ── the light loops ──
  var CH = S.ch = { on: !/[?&]r6ch=0\b/.test(Q), orig: null, mine: null, rep: [] };
  function rewrite(c) {
    var rep = [];
    c = c.replace(/#pragma unroll_loop_start\s*for \( int i = 0; i < NUM_POINT_LIGHTS; i \+\+ \) \{[\s\S]*?#pragma unroll_loop_end/, function (blk) { rep.push("point");
      return "#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0\n" + blk + "\n#else\nfor ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {\n\tpointLight = pointLights[ i ];\n\tgetPointLightInfo( pointLight, geometryPosition, directLight );\n\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n}\n#endif"; });
    c = c.replace(/#pragma unroll_loop_start\s*for \( int i = 0; i < NUM_SPOT_LIGHTS; i \+\+ \) \{[\s\S]*?#pragma unroll_loop_end/, function (blk) { rep.push("spot");
      return "#if ( defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0 ) || NUM_SPOT_LIGHT_MAPS > 0\n" + blk + "\n#else\nfor ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {\n\tspotLight = spotLights[ i ];\n\tgetSpotLightInfo( spotLight, geometryPosition, directLight );\n\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n}\n#endif"; });
    var a = c.indexOf("#if defined( USE_SHADOWMAP ) && defined( CSM_FADE )"), b = a >= 0 ? c.indexOf("#elif defined (USE_SHADOWMAP)", a) : -1;
    if (a >= 0 && b > a && c.slice(a, b).indexOf("ReflectedLight prevLight = reflectedLight;") > 0) { rep.push("csm");
      c = c.slice(0, a) + [
        "#if defined( USE_SHADOWMAP ) && defined( CSM_FADE )",
        "\t\tvec2 cascade; float cascadeCenter; float closestEdge; float margin; float csmx; float csmy; vec3 csmCol = vec3( 0.0 ); bool csmHit = false;",
        "\t\t#pragma unroll_loop_start",
        "\t\tfor ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {",
        "\t\t\t#if ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )",
        "\t\t\t\tcascade = CSM_cascades[ i ]; cascadeCenter = ( cascade.x + cascade.y ) / 2.0; closestEdge = linearDepth < cascadeCenter ? cascade.x : cascade.y;",
        "\t\t\t\tmargin = 0.25 * pow( closestEdge, 2.0 ); csmx = cascade.x - margin / 2.0; csmy = cascade.y + margin / 2.0;",
        "\t\t\t\tif ( linearDepth >= csmx && ( linearDepth < csmy || UNROLLED_LOOP_INDEX == CSM_CASCADES - 1 ) ) {",
        "\t\t\t\t\tdirectionalLight = directionalLights[ i ]; getDirectionalLightInfo( directionalLight, directLight );",
        "\t\t\t\t\tfloat dist = min( linearDepth - csmx, csmy - linearDepth ); float ratio = clamp( dist / margin, 0.0, 1.0 );",
        "\t\t\t\t\tvec3 prevColor = directLight.color; directionalLightShadow = directionalLightShadows[ i ];",
        "\t\t\t\t\tdirectLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;",
        "\t\t\t\t\tbool shouldFadeLastCascade = UNROLLED_LOOP_INDEX == CSM_CASCADES - 1 && linearDepth > cascadeCenter;",
        "\t\t\t\t\tdirectLight.color = mix( prevColor, directLight.color, shouldFadeLastCascade ? ratio : 1.0 );",
        "\t\t\t\t\tbool shouldBlend = UNROLLED_LOOP_INDEX != CSM_CASCADES - 1 || UNROLLED_LOOP_INDEX == CSM_CASCADES - 1 && linearDepth < cascadeCenter;",
        "\t\t\t\t\tcsmCol += directLight.color * ( shouldBlend ? ratio : 1.0 ); csmHit = true;",
        "\t\t\t\t}",
        "\t\t\t#endif",
        "\t\t}",
        "\t\t#pragma unroll_loop_end",
        "\t\tif ( csmHit ) { getDirectionalLightInfo( directionalLights[ 0 ], directLight ); directLight.color = csmCol; directLight.visible = true; RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight ); }",
        "\t"].join("\n") + c.slice(b);
    }
    CH.rep = rep; return c;
  }
  function chunks() {
    if (!CH.on || !window.THREE || !THREE.ShaderChunk) return; var SC = THREE.ShaderChunk, cur = SC.lights_fragment_begin; if (cur === CH.mine) return;
    try { CH.orig = cur; CH.mine = rewrite(cur); SC.lights_fragment_begin = CH.mine; S.n.chunks = CH.rep.join(","); } catch (e) { note("chunks", e); }
  }
  S.chunks = chunks;
  chunks();   // now (three's own chunk), again once the cascaded shadows have put theirs in (client.js at load), and on every world hook
  var HK = window.PLAN_HOOKS; if (HK && HK.world) HK.world.push({ name: "r6World", fn: function () { chunks(); } });
  // ── less to draw (R6.3): every draw of a frame passes here first ──
  // a. Shadow cascades (cascaded tiers): an instanced kind's instance buffer is kept nearest-first, so the near cascades draw only
  //    the instances whose shadow can reach them (distance <= cascade range + shadow length + size); the middle cascade draws the
  //    buildings with their far-LOD mesh and the far cascades with their lightest one (the same shapes the main view uses at that
  //    range); a single object smaller than two shadow texels of a cascade is not drawn into it (five in the two far cascades,
  //    which start 81 m out on ultra, where people are not drawn either).
  //    Before, every cascade drew every instance in range at full detail: 17 to 39 million triangles a frame in the shadow passes.
  // b. The main view: a mesh whose bounding sphere covers under 0.75 px (lit, not emissive; 0.35 px otherwise) is not drawn (small
  //    animals at a kilometre, props on the horizon); it is under a pixel either way, and no longer sparkles.
  // c. Buildings switch to their far LOD (24k triangles instead of 80k) at 60 per cent of the old distance (115 to 140 m instead of
  //    190 to 230 m) on the high and ultra tiers. ?r6d=0 turns a to c off; ?r6s=0, ?r6p=0, ?r6l=0 single parts.
  var D = S.d = { on: !/[?&]r6d=0\b/.test(Q), sh: !/[?&]r6s=0\b/.test(Q), px: !/[?&]r6p=0\b/.test(Q), lod: !/[?&]r6l=0\b/.test(Q), n: { skipSh: 0, cutSh: 0, lodSh: 0, skipPx: 0, sorts: 0 },
    cams: new Map(), csm: null, far: [0, 0, 0, 0], texel: [0, 0, 0, 0], tanEl: 1, K: 1, sorted: new WeakMap(), tier: new WeakMap(), sortAt: 0, sortCam: [1e9, 1e9], installed: false, indoor: false, cam: null, scene: null };
  var GC = {}, CONST = { scene: 1, camera: 1, renderer: 1, INSTSET: 1, CSMX: 1, QUAL: 1, MODEL_SPECS: 1 };   // client.js consts: resolved once (an eval per lookup per frame added up)
  function G(name) { var v = GC[name]; if (v !== undefined) return v; try { v = (0, eval)(name); } catch (e) { return undefined; } if (v !== undefined && v !== null && CONST[name]) GC[name] = v; return v; }
  function tierOf(S2, t) { return t === 0 ? S2.insts : t === 1 ? S2.far : S2.far2; }
  // nearest-first instance buffers (outdoors; indoors plan_perf's portal culling owns them)
  var R9G = !!(window.R9 && window.R9.part("g"));
  function sortInst(force) {
    if (D.csm === null) return;   /* the order only serves the cascades: nothing to do without them (low, medium) */
    var IS = G("INSTSET"), cam = G("camera"); if (!IS || !cam) return; var ic = P.ic; if (ic && ic.kind) { D.indoor = true; return; } D.indoor = false;
    var cx = cam.position.x, cz = cam.position.z, t = performance.now(); var moved = Math.hypot(cx - D.sortCam[0], cz - D.sortCam[1]);
    var all = force || (moved > 12 && t - D.sortAt > 400); if (all) { D.sortAt = t; D.sortCam[0] = cx; D.sortCam[1] = cz; }
    for (var s = 0; s < IS.length; s++) { var S2 = IS[s];
      for (var tt = 0; tt < 3; tt++) { var arr = tierOf(S2, tt); if (!arr || !arr.length) continue; var m0 = arr[0], n = m0.count, rec = D.sorted.get(m0);
        for (var q = 0; q < arr.length; q++) if (!D.tier.has(arr[q])) D.tier.set(arr[q], { S: S2, t: tt, i: q });
        if (!all && rec && rec.ver === m0.instanceMatrix.version && rec.n === n) continue;
        if (!n || !m0.visible) { D.sorted.set(m0, { ver: m0.instanceMatrix.version, n: n, d: null, x: cx, z: cz }); continue; }
        var src = m0.instanceMatrix.array, dd = new Float32Array(n), same = true, ordI;
        if (R9G) {   /* R9g: the same stable order by distance, sorted as indices into typed arrays (was one small array per instance per sort) */
          var KY = D.r9k && D.r9k.length >= n ? D.r9k : (D.r9k = new Float64Array(Math.max(n, 1024))), IX = D.r9i && D.r9i.length >= n ? D.r9i : (D.r9i = new Uint32Array(Math.max(n, 1024)));
          for (var k = 0; k < n; k++) { var b = k * 16, dx = src[b + 12] - cx, dz = src[b + 14] - cz; KY[k] = dx * dx + dz * dz; IX[k] = k; }
          ordI = IX.subarray(0, n); ordI.sort(function (a, c) { return (KY[a] - KY[c]) || (a - c); }); for (var k2 = 0; k2 < n; k2++) { dd[k2] = Math.sqrt(KY[ordI[k2]]); if (ordI[k2] !== k2) same = false; }
        } else { var ord = new Array(n);
          for (var k = 0; k < n; k++) { var b = k * 16, dx = src[b + 12] - cx, dz = src[b + 14] - cz; ord[k] = [dx * dx + dz * dz, k]; }
          ord.sort(function (a, c) { return a[0] - c[0]; }); for (var k2 = 0; k2 < n; k2++) { dd[k2] = Math.sqrt(ord[k2][0]); if (ord[k2][1] !== k2) same = false; } }
        if (!same) { var tmp = D.tmp && D.tmp.length >= n * 16 ? D.tmp : (D.tmp = new Float32Array(Math.max(n * 16, 4096)));
          for (var q2 = 0; q2 < arr.length; q2++) { var a2 = arr[q2].instanceMatrix.array; for (var k3 = 0; k3 < n; k3++) { var f = (R9G ? ordI[k3] : ord[k3][1]) * 16, g = k3 * 16; for (var j = 0; j < 16; j++) tmp[g + j] = a2[f + j]; } for (var j2 = 0; j2 < n * 16; j2++) a2[j2] = tmp[j2]; arr[q2].instanceMatrix.needsUpdate = true; } }
        D.sorted.set(m0, { ver: m0.instanceMatrix.version, n: n, d: dd, x: cx, z: cz }); D.n.sorts++; } }
  }
  function upper(d, v) { var lo = 0, hi = d.length; while (lo < hi) { var mid = (lo + hi) >> 1; if (d[mid] <= v) lo = mid + 1; else hi = mid; } return lo; }
  // per frame: the cascades' ranges and texel sizes, the sun's shadow length factor, the main view's pixel scale
  function frameSetup() {
    var c = G("CSMX"), csm = c && c.csm, cam = G("camera"), R = G("renderer"); if (!cam || !R) return;
    if (csm && D.sh && R.shadowMap.enabled) { if (D.csm !== csm) { D.csm = csm; D.cams.clear(); csm.lights.forEach(function (l, i) { D.cams.set(l.shadow.camera, i); }); }
      var far = Math.min(cam.far, csm.maxFar), br = csm.breaks || []; for (var i = 0; i < csm.lights.length; i++) { var sc = csm.lights[i].shadow.camera; D.far[i] = (br[i] || 1) * far * 1.15 + 4; D.texel[i] = (sc.right - sc.left) / Math.max(1, csm.lights[i].shadow.mapSize.x); }
      var ld = csm.lightDirection; var hz = Math.hypot(ld.x, ld.z); D.tanEl = Math.max(0.12, hz > 1e-6 ? -ld.y / hz : 10); }
    else { D.csm = null; D.cams.clear(); }
    D.K = (R.domElement.height / 2) / Math.tan(cam.fov * Math.PI / 360); D.cam = cam; D.scene = G("scene");
  }
  var _sp = new THREE.Vector3();
  // R10 (VR, plan_vr.js): the eye cameras. In the headset a mesh more than 30 m away and under 3 px (radius) of an eye is not drawn (vrPx times the desktop
  // limit; draw submission, twice per frame, is what bounds the VR frame), and each eye skips what lies outside its own frustum.
  var _ep = new THREE.Vector3(), _efm = new THREE.Matrix4(), _esp = new THREE.Sphere(); D.vrPx = +((Q.match(/[?&]vrpx=([0-9.]+)/) || [])[1]) || 4; D.n.skipEye = 0;
  function eyeOut(cam, c, r) { var f = R0.info.render.frame; if (cam.__r10f !== f || !cam.__r10fr) { cam.__r10f = f; cam.__r10fr = (cam.__r10fr || new THREE.Frustum()).setFromProjectionMatrix(_efm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)); } _esp.center.copy(c); _esp.radius = r; return !cam.__r10fr.intersectsSphere(_esp); }
  var R0 = null;
  function lit(m) { return !!m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) && !m.emissiveMap && !(m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) * (m.emissiveIntensity === undefined ? 1 : m.emissiveIntensity) > 0.02); }
  function lodGeo(S2, tt, i, ci) {   // the geometry a tier's part i is drawn with in cascade ci (null: as it is; false: not at all)
    if (!D.lod) return null; var want = ci >= 2 ? 2 : ci === 1 && tt === 0 ? 1 : 0; if (want <= tt) return null;
    for (var w = want; w > tt; w--) { var arr = tierOf(S2, w); if (!arr || !arr.length) continue; if (!arr[0].visible || !(arr[0].count > 0)) continue;   // uploaded: drawn in the main view this frame
      return i < arr.length ? arr[i].geometry : false; }
    return null;
  }
  // client.js (R6 memory) drops geometry arrays a minute after upload and reads them back from the GPU if anything touches them: nothing
  // here reads a dropped array (bounds are computed only while the data is there, batches skip such meshes)
  function dropped(geo) { var a = geo.attributes; for (var k in a) if (a[k] && a[k].r6free) return true; return !!(geo.index && geo.index.r6free); }
  function wrapDraw(R) {
    if (D.installed || !R) return; D.installed = true; R0 = R; var rbd = R.renderBufferDirect;
    R.renderBufferDirect = function (cam, sc, geo, mat, obj, grp) {
      if (sc === null && D.csm !== null && obj && cam.isOrthographicCamera === true) { var ci = D.cams.get(cam);
        if (ci !== undefined) {
          if (obj.isInstancedMesh === true) { var tf = D.tier.get(obj);
            if (tf !== undefined) { var m0 = tierOf(tf.S, tf.t)[0], rec = D.sorted.get(m0), cnt = obj.count, sub = null;
              if (ci <= 1 && !D.indoor && rec && rec.d && rec.ver === m0.instanceMatrix.version && rec.n === m0.count) { var sz = tf.S.h * 1.6; var lim = D.far[ci] + sz / D.tanEl + tf.S.rad * 1.6 + Math.hypot(D.cam.position.x - rec.x, D.cam.position.z - rec.z); var k = upper(rec.d, lim); if (k < cnt) { D.n.cutSh += cnt - k; cnt = k; } }
              if (cnt <= 0) { D.n.skipSh++; return; }
              sub = lodGeo(tf.S, tf.t, tf.i, ci); if (sub === false) { D.n.skipSh++; return; }
              if (sub || cnt !== obj.count) { var c0 = obj.count; obj.count = cnt; if (sub) D.n.lodSh++; try { return rbd.call(this, cam, sc, sub || geo, mat, obj, grp); } finally { obj.count = c0; } } } }
          else if (geo && obj.isMesh === true) { if (ci >= 2 && obj.isSkinnedMesh === true) { D.n.skipSh++; return; } var bs = geo.boundingSphere; if (bs === null && !dropped(geo)) { geo.computeBoundingSphere(); bs = geo.boundingSphere; } if (bs && bs.radius * obj.matrixWorld.getMaxScaleOnAxis() < (ci >= 2 ? 5 : 2) * D.texel[ci]) { D.n.skipSh++; return; } } } }
      else if (D.px && (cam === D.cam || cam.r10eye === true) && sc === D.scene && obj && obj.isMesh === true && obj.isInstancedMesh !== true && geo) { var bs2 = geo.boundingSphere; if (bs2 === null && !dropped(geo)) { geo.computeBoundingSphere(); bs2 = geo.boundingSphere; }
        if (bs2) { _sp.copy(bs2.center).applyMatrix4(obj.matrixWorld); var eye = cam.r10eye === true, cpos = eye ? _ep.setFromMatrixPosition(cam.matrixWorld) : cam.position, dist = _sp.distanceTo(cpos), rad = bs2.radius * obj.matrixWorld.getMaxScaleOnAxis();
          if (eye && obj.isSkinnedMesh !== true && eyeOut(cam, _sp, rad)) { D.n.skipEye++; return; }   /* R10: three culls against both eyes' joint frustum; each eye draws only what is in its own */
          if (dist > 30) { var px = rad / dist * D.K; if (px < (lit(mat) ? 0.75 : 0.35) * (eye ? D.vrPx : 1)) { D.n.skipPx++; return; } } } }
      return rbd.apply(this, arguments);
    };
  }
  // buildings' far LOD distance (high and ultra)
  function lodDist() {
    if (!D.lod) return; var IS = G("INSTSET"), Qs = G("QUAL"), SP = G("MODEL_SPECS"); if (!IS || !Qs) return; var hiT = Qs.level === "high" || Qs.level === "ultra" || !!(window.PLAN_VR && window.PLAN_VR.on);   /* R10: in VR (medium or low draw range) the buildings keep the short far-LOD distance */
    for (var s = 0; s < IS.length; s++) { var S2 = IS[s]; if (!S2.far || S2.lodR === undefined) continue; var sp = SP && SP[S2.kind]; if (sp && sp.prop) continue;
      if (S2.r6lod0 === undefined || S2.lodR !== S2.r6lodSet) S2.r6lod0 = S2.lodR;
      var want = hiT ? Math.max(90, S2.r6lod0 * 0.6) : S2.r6lod0; if (S2.lodR !== want) { S2.lodR = want; S2.r6lodSet = want; D.n.lodSet = (D.n.lodSet || 0) + 1; } }
  }
  // d. The near cascades walk only what is near: three's shadow pass walks the whole scene (13,000 objects) for every cascade it
  //    draws, two a frame on ultra; the near and middle cascades are now drawn in a pass of their own during which the top-level
  //    objects that cannot cast into them (farther than the cascade's range plus the longest shadow plus their own size) are set
  //    aside (visible = false for that pass only, so their subtrees are not walked). ?r6n=0 turns it off.
  var NR = D.nr = { on: !/[?&]r6n=0\b/.test(Q), bs: new WeakMap(), q: 0, hid: [], n: { passes: 0, hidden: 0 } };
  var _bx = new THREE.Box3(), _sv = new THREE.Vector3(), _m4 = new THREE.Matrix4();
  function topSphere(o) {   // the object's bounding sphere in its own frame (moving objects carry it), cached 15 s; null while not yet measured
    var c = NR.bs.get(o), t = performance.now(); if (c && c.nc === o.children.length && t - c.at < 15000) return c; if (NR.budget <= 0) return c && c.nc === o.children.length ? c : null; var t0 = t;
    // instanced and skinned content changes its extent without its own matrix moving (instance counts, people walking): never set aside
    _bx.makeEmpty(); var dyn = false; try { o.updateMatrixWorld(); o.traverse(function (q) { if (q.isSkinnedMesh || q.isInstancedMesh || q.isPoints || q.isBatchedMesh) dyn = true; if (dyn || !(q.isMesh || q.isLine || q.isSprite)) return; var g = q.geometry; if (!g) return; if (!g.boundingBox) { if (dropped(g)) { if (!g.boundingSphere) { dyn = true; return; } g.boundingBox = new THREE.Box3(); g.boundingSphere.getBoundingBox(g.boundingBox); } else g.computeBoundingBox(); } var bb = g.boundingBox.clone().applyMatrix4(q.matrixWorld); _bx.union(bb); }); } catch (e) { c = { nc: o.children.length, never: true, at: t }; NR.bs.set(o, c); return c; }
    if (dyn) c = { nc: o.children.length, never: true, at: t };
    else if (_bx.isEmpty()) c = { nc: o.children.length, empty: true, at: t };
    else { var sph = _bx.getBoundingSphere(new THREE.Sphere()); c = { nc: o.children.length, lc: sph.center.clone().applyMatrix4(_m4.copy(o.matrixWorld).invert()), r: sph.radius + 2, never: sph.radius > 500 || !isFinite(sph.radius), at: t }; }
    NR.bs.set(o, c); NR.budget -= performance.now() - t0; return c;
  }
  function nearAside(ci) {   // set aside what cannot cast into cascade ci; returns the list to put back
    var sc = D.scene, cam = D.cam, hid = NR.hid; hid.length = 0; if (!sc || !cam) return hid; var lim = D.far[ci] + 40 / D.tanEl, cx = cam.position.x, cz = cam.position.z, ch = sc.children;
    for (var i = 0; i < ch.length; i++) { var o = ch[i]; if (o.visible !== true || o.isLight || o.isCamera || o.isBone) continue; var c = topSphere(o); if (!c || c.never || c.empty) continue;
      _sv.copy(c.lc).applyMatrix4(o.matrixWorld); var d = Math.hypot(_sv.x - cx, _sv.z - cz) - c.r; if (d > lim) { o.visible = false; hid.push(o); } }
    return hid;
  }
  function wrapShadow(R) {
    var sm = R.shadowMap; if (sm.__r6) return; sm.__r6 = true; var s0 = sm.render, near = [], rest = [];
    sm.render = function (lights, scn, cam) {
      if (!NR.on || D.csm === null || !lights || lights.length < 2 || D.indoor || !(sm.autoUpdate || sm.needsUpdate)) return s0.apply(this, arguments);
      near.length = 0; rest.length = 0; for (var i = 0; i < lights.length; i++) { var l = lights[i], ci = D.cams.get(l.shadow && l.shadow.camera), due = l.shadow.autoUpdate || l.shadow.needsUpdate; if (ci !== undefined && ci <= 1 && due) near.push(l); else rest.push(l); }
      if (!near.length) return s0.apply(this, arguments);
      NR.budget = 1.5; var nu = sm.needsUpdate, r;
      for (var k = 0; k < near.length; k++) { var ci2 = D.cams.get(near[k].shadow.camera), hid = nearAside(ci2); NR.n.passes++; NR.n.hidden += hid.length; sm.needsUpdate = nu; try { r = s0.call(this, [near[k]], scn, cam); } finally { for (var j = 0; j < hid.length; j++) hid[j].visible = true; } }
      if (rest.length) { sm.needsUpdate = nu; r = s0.call(this, rest, scn, cam); }
      return r;
    };
  }
  // e. Static batches: a top-level group whose meshes have not moved, changed or been toggled for 20 s has the meshes that share a
  //    material (and shadow flags, within a 48 m cell) drawn as one merged mesh; the originals stay in place, hidden, for raycasts
  //    and for the way back. Any later change to one of them (moved, shown, hidden, another material or geometry, a child added or
  //    removed) puts the originals back for good. Rooms, interiors, people, vehicles, lights, transparent, skinned and instanced
  //    meshes are never merged. ?r6b=0 turns it off.
  var BT = D.bt = { on: !/[?&]r6b=0\b/.test(Q), q: [], seen: new WeakSet(), live: [], rr: 0, n: { groups: 0, merged: 0, meshes: 0, draws: 0, reverts: 0, skipped: 0, verts: 0 } };
  var NOB = /^(perf|player|avatar|r6)/i;
  var _bm = new THREE.Matrix4(), _bi = new THREE.Matrix4();
  function sigOf(m, g, own) {   // the mesh relative to the group: matrix, visibility (its own and its ancestors' up to the group), material and geometry
    _bm.multiplyMatrices(_bi, m.matrixWorld); var e = _bm.elements, v = own === undefined ? m.visible : own, p = m.parent; while (p && p !== g) { if (!p.visible) { v = false; break; } p = p.parent; }
    return (v ? 1 : 2) + e[0] * 1.3 + e[1] * 2.3 + e[2] * 2.9 + e[4] * 3.1 + e[5] * 1.7 + e[6] * 3.7 + e[8] * 4.1 + e[9] * 4.3 + e[10] * 1.9 + e[12] * 0.11 + e[13] * 0.13 + e[14] * 0.17 + (m.material ? m.material.id : 0) * 1e-3 + (m.geometry ? m.geometry.id : 0) * 1e-5; }
  function eligible(g) {   // the meshes of a top-level group that could be merged (none: people, rooms, interiors, skinned or LOD content)
    if (!g || !g.isObject3D || g.isMesh || g.isLight || g.isCamera || !g.children.length || NOB.test(g.name || "")) return null; var ud = g.userData || {};
    if (ud.interior || ud.walk || ud.id !== undefined || ud.r5ids || ud.r6batch || ud.noBatch || ud.door || ud.ride) return null;
    try { if (inside && inside.g === g) return null; } catch (e) {} try { if (FLY && FLY.g === g) return null; } catch (e) {}
    var ok = true, meshes = [], nodes = 0;
    g.traverse(function (o) { if (!ok) return; nodes++; if (o.isCamera || o.isSkinnedMesh || o.isBone || o.isLOD) { ok = false; return; }
      if (!o.isMesh || o.isInstancedMesh || o.children.length) return;   // a mesh with children (a lamp with its light) stays as it is: hiding it would hide them
      if (o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || o.onAfterRender !== THREE.Object3D.prototype.onAfterRender) return;
      if (o.userData && (o.userData.door || o.userData.walk || o.userData.anim || o.userData.spin || o.userData.sway || o.userData.r6batch)) return;
      var mt = o.material; if (!mt || Array.isArray(mt) || mt.transparent || mt.alphaHash || mt.isShaderMaterial || mt.isRawShaderMaterial) return; var geo = o.geometry; if (!geo || !geo.isBufferGeometry || geo.morphAttributes.position || geo.groups.length > 1 || !geo.attributes.position || geo.attributes.position.isInterleavedBufferAttribute || geo.attributes.position.count > 6000 || dropped(geo)) return; if (o.morphTargetInfluences) return; meshes.push(o); });   // big meshes are one draw anyway: not copied
    if (!ok || meshes.length < 2 || nodes > 6000) return null; return meshes;
  }
  function attrKey(geo) { var k = []; for (var n in geo.attributes) { var a = geo.attributes[n]; if (a.isInterleavedBufferAttribute) return null; k.push(n + a.itemSize + (a.normalized ? "n" : "") + (a.array.constructor.name)); } return k.sort().join(","); }
  function mergeInto(g, list) {   // list of meshes (same material and flags): one geometry in g's frame
    var key = attrKey(list[0].geometry); if (!key) return null; for (var i = 1; i < list.length; i++) if (attrKey(list[i].geometry) !== key) return null;
    var names = Object.keys(list[0].geometry.attributes), nv = 0, ni = 0; list.forEach(function (m) { var p = m.geometry.attributes.position; nv += p.count; ni += m.geometry.index ? m.geometry.index.count : p.count; });
    if (nv > 400000) return null;
    var out = new THREE.BufferGeometry(), arrs = {}; names.forEach(function (n) { var a = list[0].geometry.attributes[n]; arrs[n] = new a.array.constructor(nv * a.itemSize); });
    var idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), vo = 0, io = 0; var inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), M = new THREE.Matrix4(), N = new THREE.Matrix3(), v = new THREE.Vector3();
    list.forEach(function (m) { var geo = m.geometry, cnt = geo.attributes.position.count; M.multiplyMatrices(inv, m.matrixWorld); N.getNormalMatrix(M);
      names.forEach(function (n) { var a = geo.attributes[n], s = a.itemSize, dst = arrs[n];
        if (n === "position") { for (var i = 0; i < cnt; i++) { v.fromBufferAttribute(a, i).applyMatrix4(M); dst[(vo + i) * 3] = v.x; dst[(vo + i) * 3 + 1] = v.y; dst[(vo + i) * 3 + 2] = v.z; } }
        else if (n === "normal" || (n === "tangent" && s >= 3)) { for (var j = 0; j < cnt; j++) { v.set(a.getX(j), a.getY(j), a.getZ(j)); if (n === "normal") v.applyMatrix3(N).normalize(); else v.transformDirection(M); dst[(vo + j) * s] = v.x; dst[(vo + j) * s + 1] = v.y; dst[(vo + j) * s + 2] = v.z; if (s === 4) dst[(vo + j) * s + 3] = a.getW(j); } }
        else if (a.normalized || !(a.array instanceof Float32Array)) { var src = a.array; for (var k = 0; k < cnt * s; k++) dst[vo * s + k] = src[k]; }
        else { for (var k2 = 0; k2 < cnt; k2++) for (var c = 0; c < s; c++) dst[(vo + k2) * s + c] = a.getComponent(k2, c); } });
      if (geo.index) { var ix = geo.index.array; for (var q = 0; q < ix.length; q++) idx[io + q] = ix[q] + vo; io += ix.length; } else { for (var q2 = 0; q2 < cnt; q2++) idx[io + q2] = vo + q2; io += cnt; }
      vo += cnt; });
    names.forEach(function (n) { var a = list[0].geometry.attributes[n]; out.setAttribute(n, new THREE.BufferAttribute(arrs[n], a.itemSize, a.normalized)); });
    out.setIndex(new THREE.BufferAttribute(idx, 1)); out.computeBoundingSphere(); out.computeBoundingBox();
    var m0 = list[0], mm = new THREE.Mesh(out, m0.material); mm.name = "r6 batch"; mm.castShadow = m0.castShadow; mm.receiveShadow = m0.receiveShadow; mm.layers.mask = m0.layers.mask; mm.renderOrder = m0.renderOrder; mm.userData.r6batch = true; mm.userData.noShadow = m0.userData.noShadow; mm.userData.shSet = true;
    BT.n.verts += nv; return mm;
  }
  function snap(meshes, g, hs) { _bi.copy(g.matrixWorld).invert(); var s = new Float64Array(meshes.length + 1); for (var i = 0; i < meshes.length; i++) s[i] = sigOf(meshes[i], g, hs && hs.has(meshes[i]) ? true : undefined); var nodes = 0; g.traverse(function () { nodes++; }); s[meshes.length] = nodes; return s; }
  function batch(g, meshes) {
    var cells = new Map(); g.updateMatrixWorld(true);
    meshes.forEach(function (m) { if (!m.visible || dropped(m.geometry)) return; var p = m.parent, vis = true; while (p && p !== g) { if (!p.visible) { vis = false; break; } p = p.parent; } if (!vis) return; var bs = m.geometry.boundingSphere || (m.geometry.computeBoundingSphere(), m.geometry.boundingSphere); _sv.copy(bs.center).applyMatrix4(m.matrixWorld);
      var k = m.material.id + "|" + (m.castShadow ? 1 : 0) + (m.receiveShadow ? 1 : 0) + "|" + m.layers.mask + "|" + m.renderOrder + "|" + Math.floor(_sv.x / 48) + "," + Math.floor(_sv.z / 48); var L = cells.get(k); if (!L) cells.set(k, L = []); L.push(m); });
    var made = [], hidden = [];
    var tb = performance.now(); cells.forEach(function (L) { if (L.length < 2 || BT.n.verts > 800000 || performance.now() - tb > 4) return; var mm = null;   /* at most ~4 ms in one frame: the rest of the group stays as it is */ try { mm = mergeInto(g, L); } catch (e) { note("batch merge", e); } if (!mm) return; made.push(mm); L.forEach(function (m) { m.visible = false; hidden.push(m); }); });
    if (!made.length) return null; made.forEach(function (mm) { g.add(mm); }); var E = { g: g, made: made, hidden: hidden, meshes: meshes, sig: null };
    E.hset = new Set(hidden); E.sig = snap(meshes, g, E.hset); BT.n.groups++; BT.n.merged += hidden.length; BT.n.draws += made.length; return E;
  }
  function unbatch(E, why) { try { E.made.forEach(function (mm) { if (mm.parent) mm.parent.remove(mm); mm.geometry.dispose(); }); E.hidden.forEach(function (m) { m.visible = true; }); } catch (e) { note("unbatch", e); } E.g.userData.noBatch = true; BT.n.reverts++; BT.last = why; }
  function checkSome() {   // a few live batches a frame: still in the scene and unchanged?
    var L = BT.live; if (!L.length) return; var k = Math.min(L.length, 6);
    for (var i = 0; i < k; i++) { BT.rr = (BT.rr + 1) % L.length; var E = L[BT.rr]; if (!E) continue; var r = E.g; while (r.parent) r = r.parent;
      if (r !== D.scene) { E.made.forEach(function (mm) { mm.geometry.dispose(); if (mm.parent) mm.parent.remove(mm); }); E.hidden.forEach(function (m) { m.visible = true; }); L.splice(BT.rr, 1); return; }
      // the hidden originals are expected hidden (visible false); compare with that
      var s = E.sig, ms = E.meshes, bad = false, hs = E.hset || (E.hset = new Set(E.hidden)); _bi.copy(E.g.matrixWorld).invert(); for (var j = 0; j < ms.length && !bad; j++) { var m = ms[j]; if (hs.has(m) && m.visible) { bad = true; break; } if (sigOf(m, E.g, hs.has(m) ? true : undefined) !== s[j]) bad = true; }
      if (!bad) { var nodes = 0; E.g.traverse(function () { nodes++; }); if (nodes !== s[ms.length]) bad = true; }
      if (bad) { unbatch(E, "changed"); L.splice(BT.rr, 1); return; } }
  }
  function batchStep() {   // candidates: snapshot now, merge if unchanged 20 s later (a little each idle slice)
    var sc = D.scene; if (!sc || !BT.on) return; var t = performance.now();
    if (!BT.scanAt || t - BT.scanAt > 30000) { BT.scanAt = t; for (var i = 0; i < sc.children.length; i++) { var g = sc.children[i]; if (BT.seen.has(g)) continue; BT.seen.add(g); BT.q.push({ g: g, at: t, sig: null, meshes: null }); } }
    var t0 = performance.now(), n = 0;
    while (BT.q.length && performance.now() - t0 < 2 && n < 40) { var c = BT.q[0]; if (t - c.at < (c.sig ? 20000 : 0)) break; BT.q.shift(); n++;
      if (!c.sig) { var ms = eligible(c.g); if (!ms) { BT.n.skipped++; continue; } c.meshes = ms; c.g.updateMatrixWorld(true); c.sig = snap(ms, c.g); c.at = t; BT.q.push(c); continue; }
      var r = c.g; while (r.parent) r = r.parent; if (r !== sc || c.g.userData.noBatch) continue;
      var s2 = snap(c.meshes, c.g), keep = []; for (var j = 0; j < c.meshes.length; j++) if (s2[j] === c.sig[j]) keep.push(c.meshes[j]);   // what moved or changed in the window stays out
      if (s2[c.meshes.length] !== c.sig[c.meshes.length] || keep.length < 2) { c.sig = s2; c.at = t; c.tries = (c.tries || 0) + 1; if (c.tries < 4) BT.q.push(c); continue; }
      var E = null; try { E = batch(c.g, keep); } catch (e) { note("batch", e); } if (E) BT.live.push(E); }
  }
  P.r6batchStats = function () { return BT.n; };
  function dInstall() {
    if (!D.on || !P.installed) return false; var R = G("renderer"); if (!R) return false;
    try { wrapDraw(R); } catch (e) { note("wrap draw", e); }
    try { wrapShadow(R); } catch (e) { note("wrap shadow", e); }
    try { var uc = G("updateCulling"); if (typeof uc === "function" && !uc.r6) { window.__r6uc = function () { var r = uc.apply(this, arguments); try { sortInst(false); } catch (e) { note("sort", e); } return r; }; window.__r6uc.r6 = true; updateCulling = window.__r6uc; } } catch (e) { note("wrap culling", e); }
    return true;
  }
  if (D.on && HK && HK.frame) HK.frame.push({ name: "r6Draw", fn: function () { if (!D.installed) { if (!dInstall()) return; } try { frameSetup(); if ((D.f = (D.f || 0) + 1) % 30 === 1) lodDist(); sortInst(false); } catch (e) { note("draw frame", e); } if (BT.on && P.readyAt && performance.now() - P.readyAt > 10000) { try { checkSome(); if ((D.f & 7) === 0) batchStep(); } catch (e) { note("batch frame", e); } } } });
  var tries = 0; (function early() { chunks(); if (++tries < 400 && !(typeof CSMX !== "undefined" && CSMX && CSMX.csm)) setTimeout(early, 25); else chunks(); })();
})();
// ───────────────────────────── R9: hitches (HANDOFF_R9_HITCHES.md) ─────────────────────────────
// Brief frame freezes found with CPU profiles of a scripted ultra tour on the real GPU, fixed without changing what is drawn.
// ?r9=0 turns every R9 part off (client.js and the plan modules too), ?r9<letter>=0 one part. R9.n counts, R9.errs errors.
(function () {
  "use strict";
  var R9 = window.R9; if (!R9 || !R9.on || typeof THREE === "undefined") return;
  R9.errs = R9.errs || []; R9.n = R9.n || {};
  function note(w, e) { try { R9.errs.push(w + ": " + (e && e.message || e)); if (R9.errs.length > 40) R9.errs.shift(); console.warn("R9 " + w, e); } catch (x) {} }
  R9.note = note;
  // R9s: a skinned mesh's bounding sphere. three computes it on the CPU the first time the mesh is culled, by skinning every vertex
  // (85 to 100 ms in one frame for the people of an interior, a crowd or a hall). The sphere is now computed once per geometry from
  // at most about 2,500 of its vertices, skinned the same way, made 15 per cent larger, and every mesh drawing that geometry (each
  // clone of the same rig) copies it. Only culling reads it: three keeps the first frame's pose anyway, so a person is never culled
  // while on screen.
  if (R9.part("s") && THREE.SkinnedMesh) {
    var SM = THREE.SkinnedMesh.prototype, c0 = SM.computeBoundingSphere, SPH = new WeakMap(), _sv = new THREE.Vector3();
    SM.computeBoundingSphere = function () {
      try {
        var g = this.geometry, pos = g && g.getAttribute ? g.getAttribute("position") : null;
        if (!pos || !this.skeleton || pos.isInterleavedBufferAttribute) return c0.apply(this, arguments);
        if (this.boundingSphere === null) this.boundingSphere = new THREE.Sphere();
        var hit = SPH.get(g); if (hit) { this.boundingSphere.copy(hit); R9.n.skinHit = (R9.n.skinHit || 0) + 1; return; }
        var t0 = performance.now(), S = this.boundingSphere, n = pos.count, step = Math.max(1, Math.ceil(n / 2500)); S.makeEmpty();
        for (var i = 0; i < n; i += step) { this.getVertexPosition(i, _sv); S.expandByPoint(_sv); }
        if (n > 0) { this.getVertexPosition(n - 1, _sv); S.expandByPoint(_sv); }
        S.radius *= 1.15; SPH.set(g, S.clone()); R9.n.skin = (R9.n.skin || 0) + 1; R9.n.skinMs = (R9.n.skinMs || 0) + (performance.now() - t0);
      } catch (e) { note("skin sphere", e); return c0.apply(this, arguments); }
    };
  }
  // R9m: vertex loops. three transforms and bounds geometry one vertex at a time through generic accessors (getX, setXYZ, a scratch
  // vector); streaming a model in (loadOne: clone, applyMatrix4, bounds for every part) took 50 to 67 ms in one task every few
  // seconds while walking. For plain float attributes the same arithmetic, in the same order, now runs on the array directly
  // (bit-identical results); anything else (normalized, interleaved, other array types, morph targets) keeps three's own code.
  if (R9.part("m") && THREE.BufferAttribute && THREE.Box3 && THREE.BufferGeometry) {
    var BA = THREE.BufferAttribute.prototype, am0 = BA.applyMatrix4, an0 = BA.applyNormalMatrix, td0 = BA.transformDirection;
    var plain = function (a) { return a && !a.normalized && a.itemSize >= 3 && a.array instanceof Float32Array; };
    BA.applyMatrix4 = function (m) { if (!plain(this)) return am0.call(this, m); var A = this.array, s = this.itemSize, n = this.count, e = m.elements;
      var e0 = e[0], e1 = e[1], e2 = e[2], e3 = e[3], e4 = e[4], e5 = e[5], e6 = e[6], e7 = e[7], e8 = e[8], e9 = e[9], e10 = e[10], e11 = e[11], e12 = e[12], e13 = e[13], e14 = e[14], e15 = e[15];
      for (var i = 0, o = 0; i < n; i++, o += s) { var x = A[o], y = A[o + 1], z = A[o + 2], w = 1 / (e3 * x + e7 * y + e11 * z + e15); A[o] = (e0 * x + e4 * y + e8 * z + e12) * w; A[o + 1] = (e1 * x + e5 * y + e9 * z + e13) * w; A[o + 2] = (e2 * x + e6 * y + e10 * z + e14) * w; }
      R9.n.xf = (R9.n.xf || 0) + 1; return this; };
    BA.applyNormalMatrix = function (m) { if (!plain(this)) return an0.call(this, m); var A = this.array, s = this.itemSize, n = this.count, e = m.elements;
      var e0 = e[0], e1 = e[1], e2 = e[2], e3 = e[3], e4 = e[4], e5 = e[5], e6 = e[6], e7 = e[7], e8 = e[8];
      for (var i = 0, o = 0; i < n; i++, o += s) { var x = A[o], y = A[o + 1], z = A[o + 2]; var X = e0 * x + e3 * y + e6 * z, Y = e1 * x + e4 * y + e7 * z, Z = e2 * x + e5 * y + e8 * z; var k = 1 / (Math.sqrt(X * X + Y * Y + Z * Z) || 1); A[o] = X * k; A[o + 1] = Y * k; A[o + 2] = Z * k; }
      return this; };
    BA.transformDirection = function (m) { if (!plain(this)) return td0.call(this, m); var A = this.array, s = this.itemSize, n = this.count, e = m.elements;
      var e0 = e[0], e1 = e[1], e2 = e[2], e4 = e[4], e5 = e[5], e6 = e[6], e8 = e[8], e9 = e[9], e10 = e[10];
      for (var i = 0, o = 0; i < n; i++, o += s) { var x = A[o], y = A[o + 1], z = A[o + 2]; var X = e0 * x + e4 * y + e8 * z, Y = e1 * x + e5 * y + e9 * z, Z = e2 * x + e6 * y + e10 * z; var k = 1 / (Math.sqrt(X * X + Y * Y + Z * Z) || 1); A[o] = X * k; A[o + 1] = Y * k; A[o + 2] = Z * k; }
      return this; };
    var B3 = THREE.Box3.prototype, sb0 = B3.setFromBufferAttribute;
    B3.setFromBufferAttribute = function (a) { if (!plain(a)) return sb0.call(this, a); var A = a.array, s = a.itemSize, n = a.count, x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (var i = 0, o = 0; i < n; i++, o += s) { var x = A[o], y = A[o + 1], z = A[o + 2]; x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z); x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z); }
      this.min.set(x0, y0, z0); this.max.set(x1, y1, z1); return this; };
    var BG = THREE.BufferGeometry.prototype, cs0 = BG.computeBoundingSphere, _bb = new THREE.Box3();
    BG.computeBoundingSphere = function () { var p = this.attributes.position; if (!plain(p) || this.morphAttributes.position) return cs0.apply(this, arguments);
      if (this.boundingSphere === null) this.boundingSphere = new THREE.Sphere(); var c = this.boundingSphere.center; _bb.setFromBufferAttribute(p); _bb.getCenter(c);
      var A = p.array, s = p.itemSize, n = p.count, cx = c.x, cy = c.y, cz = c.z, r2 = 0;
      for (var i = 0, o = 0; i < n; i++, o += s) { var dx = cx - A[o], dy = cy - A[o + 1], dz = cz - A[o + 2]; r2 = Math.max(r2, dx * dx + dy * dy + dz * dz); }
      this.boundingSphere.radius = Math.sqrt(r2); if (isNaN(this.boundingSphere.radius)) console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.', this); };
  }
})();
// ───────────────────────────── R16: performance headroom (HANDOFF_R16_PERF.md) ─────────────────────────────
// The ultra frame at the street views is CPU bound, and about 90 per cent of it is inside renderer.render: the draws themselves
// (three's program, uniform and vertex-array work per draw, about half), the shadow cascades (a fifth), the world-matrix walk (an
// eighth) and the culling walk. The plan hooks of all modules together are under 3 per cent. Nothing here changes what is drawn.
// a. (in P3's walk, first part of this file) the world-matrix walk skips the subtree of an invisible object: 80 per cent of the
//    17,000 objects of the scene are under one (rooms built ahead, hidden people and rides, far groups).   ?s16mw=0
// b. Shadow casters merged (?s16sm=0): static plain meshes that cast shadows are drawn into the shadow maps as one position-only
//    mesh per 48 m cell instead of one draw each. A depth pass only needs positions and the face side, so this merge crosses
//    materials and groups. The originals keep every flag and are still drawn in the main view; only their own shadow draws are
//    skipped while their merged mesh draws, and a cascade draws a merged mesh only where R6's size rule would draw all of its meshes.
// c. Same-material merge for the main view (?s16sc=0): static opaque meshes that share a material (the same object, so any later
//    change to it shows on both), shadow flag, draw order and vertex layout are drawn as one mesh per 48 m cell and size class; the
//    originals' own draws are skipped while it draws. Only materials without a shader hook (an object-space effect would see the
//    merged frame), only where R6's sub-pixel rule would draw every one of them; anywhere else the originals draw as before.
// Exact (b and c): P3's walk watches every merged mesh and each parent up to its top-level object, and as soon as one of them moves,
// is shown or hidden, changes its material (or that material's hook, side or transparency), geometry, layers, shadow or draw flags,
// or a parent loses or gains a child, that cell goes back to its originals before anything of that frame is drawn. A top-level group
// the client shows and hides by distance gets cells of its own, which follow its visibility. Groups whose content keeps changing are
// left alone after three tries. Nothing is merged indoors (plan_perf's portal culling owns the outside then) or in VR.
// ?s16=0 turns R16 off. PLAN_PERF.s16: counters, errors (errs), stats(), runtime switches for A/B: mw(bool), sm.set(bool), sc.set(bool).
(function () {
  "use strict";
  var P = window.PLAN_PERF; if (!P || P.off || !P.s16h || typeof THREE === "undefined") return;
  var Q = location.search, H = P.s16h, MW = P.mw;
  var S = P.s16 = { v: "r16.7", on: !/[?&]s16=0\b/.test(Q), n: {}, errs: [] };
  function note(tag, e) { try { if (S.errs.length < 20) S.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (P.note) P.note("s16 " + tag, e); } catch (x) {} }
  if (!S.on) { H.mw = false; return; }
  S.mw = function (on) { if (on !== undefined) H.mw = !!on; return H.mw; };
  var CC = {}; function C(name) { var v = CC[name]; if (v !== undefined) return v; try { v = (0, eval)(name); } catch (e) { return undefined; } if (v !== undefined && v !== null) CC[name] = v; return v; }   // client consts, resolved once
  function V(name) { try { return (0, eval)(name); } catch (e) { return undefined; } }   // client lets
  var ok3 = !!P.n.mw && !!MW && !!MW.cap;   // the watch needs P3's walk
  var SM = S.sm = { on: ok3 && !/[?&]s16sm=0\b/.test(Q), user: true, act: false, n: { entries: 0, members: 0, verts: 0, skipMember: 0, proxyDraw: 0, proxySkip: 0 }, byId: new Map() };
  var SC = S.sc = { on: ok3 && !/[?&]s16sc=0\b/.test(Q), user: true, act: false, n: { entries: 0, members: 0, verts: 0, skipMember: 0, mergedDraw: 0, mergedSkip: 0 }, byId: new Map() };
  SM.set = function (on) { SM.user = !!on; return SM.user; }; SC.set = function (on) { SC.user = !!on; return SC.user; };
  var W = S.w = { layer: 21, cell: 48, maxR: 60, maxV: 6000, maxNV: 300000, wait: 12000, start: 32000, scanAt: 0, q0: [], q1: [], pend: new Map(), topE: new Map(), seen: new WeakSet(), tries: new WeakMap(), rec: new WeakMap(), live: [], dirty: [], box: null, mats: [], thr: [0, 0, 0, 0, 0, 0, 0, 0], det: null, detAt: 0, ic: false, shOn: false, spPass: false,
    n: { reverts: 0, scans: 0, tops: 0, skipTop: 0, mirror: 0, buildMs: 0, checkCalls: 0, lastWhy: "" } };
  var BIT = 1 << W.layer, FLIP = [THREE.BackSide, THREE.FrontSide, THREE.DoubleSide];   // three's shadow side of a FrontSide, BackSide, DoubleSide material
  var O3 = THREE.Object3D.prototype, OBS = O3.onBeforeShadow, OAS = O3.onAfterShadow, OBR = O3.onBeforeRender, OAR = O3.onAfterRender, MATP = THREE.Material.prototype;
  var NOB = /^(perf|player|avatar|r6|s16)/i, ATTR = { position: 3, normal: 3, uv: 2, uv1: 2, uv2: 2, color: 0, tangent: 4 };
  function rec(o) { var R = W.rec.get(o); if (!R) { R = { m: null, c: null, a: null }; W.rec.set(o, R); } return R; }
  function topOK(o) {
    if (!o || o === W.box || o.isLight || o.isCamera || o.isBone || NOB.test(o.name || "")) return false; var ud = o.userData || {};
    if (ud.interior || ud.walk || ud.id !== undefined || ud.r5ids || ud.door || ud.ride || ud.perf || ud.noBatch || ud.s16) return false;
    if (o.matrixWorldAutoUpdate !== true || o.id >= MW.cap) return false;
    try { var ins = V("inside"); if (ins && (ins.g === o || ins.int3 === o || ins.hgr === o)) return false; } catch (e) {} try { if (FLY && FLY.g === o) return false; } catch (e) {}
    return true;
  }
  function dropped(g) { var a = g.attributes; for (var k in a) if (a[k] && a[k].r6free) return true; return !!(g.index && g.index.r6free); }
  function geoOK(g) { if (!g || !g.isBufferGeometry || g.morphAttributes.position || dropped(g)) return false; var pa = g.attributes.position; if (!pa || pa.isInterleavedBufferAttribute || pa.itemSize < 3 || pa.count > W.maxV || pa.count < 3) return false; if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false; if (g.index && g.index.isInterleavedBufferAttribute) return false; return true; }
  function userHook(m) { if (m._userObc) return true; if (m._csmObc !== undefined) return false; return m.onBeforeCompile !== MATP.onBeforeCompile; }
  // b: a plain shadow caster drawn by three's plain depth material
  function shOK(q) {
    if (q.castShadow !== true || q.layers.mask !== 1 || q.customDepthMaterial !== undefined || q.onBeforeShadow !== OBS || q.onAfterShadow !== OAS || q.onBeforeRender !== OBR || q.onAfterRender !== OAR || q.morphTargetInfluences) return false;
    var m = q.material; if (!m || Array.isArray(m) || m.visible !== true || m.wireframe === true) return false;
    if (m.alphaTest > 0 || (m.displacementMap && m.displacementScale !== 0) || (m.clippingPlanes && m.clippingPlanes.length)) return false;
    return geoOK(q.geometry);
  }
  // c: an opaque mesh whose material has no shader hook, in a vertex layout the merge can copy exactly
  function attrKey(g) { var k = []; for (var n in g.attributes) { var a = g.attributes[n]; if (ATTR[n] === undefined || a.isInterleavedBufferAttribute || (ATTR[n] && a.itemSize !== ATTR[n])) return null; k.push(n + a.itemSize); } return k.sort().join(","); }
  function mainOK(q) {
    if (q.layers.mask !== 1 || q.onBeforeRender !== OBR || q.onAfterRender !== OAR || q.morphTargetInfluences || !(q.matrixWorld.determinant() > 0)) return false;
    var m = q.material; if (!m || Array.isArray(m) || m.visible !== true || m.transparent === true || m.wireframe === true || m.isShaderMaterial || m.transmission > 0 || m.depthTest !== true || m.depthWrite !== true) return false;   /* draw order matters without depth */
    for (var gp = q.parent; gp; gp = gp.parent) if (gp.isGroup && gp.renderOrder !== 0) return false;   /* a group's draw order would be lost */
    if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshBasicMaterial)) return false;
    if (userHook(m) || !geoOK(q.geometry) || attrKey(q.geometry) === null) return false; return true;
  }
  function collect(top, outS, outC) {
    var nodes = 0, ok = true;
    (function walk(q, vis) {
      if (!ok) return; if (++nodes > 12000) { ok = false; return; } if (q.isCamera || q.isLOD) { ok = false; return; }
      var ud = q.userData; if (ud && (ud.walk || ud.door || ud.ride || ud.anim || ud.spin || ud.sway || ud.s16p || ud.interior)) return;
      if (q.matrixWorldAutoUpdate !== true || q.id >= MW.cap) return; var v = vis && q.visible === true; if (!v) return;
      if (q.isMesh === true && q.isInstancedMesh !== true && q.isSkinnedMesh !== true && q.isBatchedMesh !== true) { if (SM.on && W.shOn && shOK(q)) outS.push(q); if (SC.on && mainOK(q)) outC.push(q); }
      var ch = q.children; for (var i = 0; i < ch.length; i++) walk(ch[i], v);
    })(top, true);
    return ok;
  }
  function snapOf(m) { return { e: Float64Array.from(m.matrixWorld.elements), mat: m.material, geo: m.geometry, pv: m.geometry.attributes.position.version, par: m.parent }; }
  function same(m, s) { if (m.material !== s.mat || m.geometry !== s.geo || m.parent !== s.par || m.geometry.attributes.position.version !== s.pv) return false; var e = m.matrixWorld.elements; for (var i = 0; i < 16; i++) if (e[i] !== s.e[i]) return false; return true; }
  function chainOK(m, top) { for (var p = m; p; p = p.parent) { if (p.visible !== true || p.matrixWorldAutoUpdate !== true || p.id >= MW.cap) return false; if (p === top) return true; } return false; }
  function detailSet() { var t = performance.now(); if (W.det && t - W.detAt < 5000) return W.det; var s = new Set(); try { var DL = C("DETAIL"); if (DL) for (var i = 0; i < DL.length; i++) if (DL[i] && DL[i].g) s.add(DL[i].g); } catch (e) {} W.det = s; W.detAt = t; return s; }
  var _c = new THREE.Vector3();
  function shClass(r) { var c = 0; for (var i = 0; i < 4; i++) { if (r >= W.thr[i]) c = i + 1; else break; } return c; }   // cascades R6's size rule draws it in (0: none)
  function effSide(m) { return m.shadowSide !== null && m.shadowSide !== undefined ? m.shadowSide : FLIP[m.side]; }
  function place(top, ms, kind) {
    var own = ms.length >= 8 || detailSet().has(top), t = performance.now();
    for (var i = 0; i < ms.length; i++) { var m = ms[i], g = m.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); var bs = g.boundingSphere; if (!bs || !isFinite(bs.radius)) continue;
      _c.copy(bs.center).applyMatrix4(m.matrixWorld); var r = bs.radius * m.matrixWorld.getMaxScaleOnAxis(); if (r > W.maxR) continue; var cell = (own ? "t" + top.id + ":" : "c") + Math.floor(_c.x / W.cell) + "," + Math.floor(_c.z / W.cell), key, extra;
      if (kind === "s") { var cls = shClass(r); if (cls === 0) continue; var side = effSide(m.material); key = "s|" + cell + "|" + side + "|" + cls; extra = { side: side }; }
      else { var sz = Math.max(0, Math.min(12, Math.floor(Math.log2(Math.max(r, 0.02) / 0.02)))); key = "c|" + cell + "|" + m.material.id + "|" + (m.receiveShadow ? 1 : 0) + "|" + m.renderOrder + "|" + attrKey(g) + "|" + sz; extra = { mat: m.material, rs: m.receiveShadow, ro: m.renderOrder, ak: attrKey(g) }; }
      var p = W.pend.get(key); if (!p) { p = { key: key, kind: kind, top: own ? top : null, ms: [], at: t, x: extra }; W.pend.set(key, p); }
      p.ms.push(m); p.at = t; }
  }
  function shMaterial(side) { var m = W.mats[side]; if (!m) { m = W.mats[side] = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }); m.name = "s16 shadow caster"; m.shadowSide = side; m.side = side; m.userData.s16 = true; } return m; }
  function box() { if (W.box && W.box.parent) return W.box; var sc = C("scene"); if (!sc) return null; var b = W.box = new THREE.Group(); b.name = "perf s16 merged"; b.userData.s16 = true; b.userData.noCull = true; b.userData.noBatch = true; b.userData.perf = true; b.userData.noInst = true; b.matrixAutoUpdate = false; sc.add(b); return b; }
  // the members still usable at build time (in the scene, visible all the way up, unchanged), the same vertex layout for c
  function liveMembers(p, okf, byId) { var out = [], nv = 0, ni = 0, sc = C("scene");
    for (var i = 0; i < p.ms.length; i++) { var m = p.ms[i]; if (byId.has(m.id) || !okf(m)) continue; var top = m; while (top.parent && top.parent !== sc) top = top.parent; if (top.parent !== sc || !chainOK(m, top)) continue; if (p.kind === "c" && (m.material !== p.x.mat || m.receiveShadow !== p.x.rs || m.renderOrder !== p.x.ro || attrKey(m.geometry) !== p.x.ak)) continue;
      var g = m.geometry, c = g.attributes.position.count; if (nv + c > W.maxNV) break; nv += c; ni += g.index ? g.index.count : c; out.push(m); }
    return { ms: out, nv: nv, ni: ni };
  }
  var _m4 = new THREE.Matrix4(), _n3 = new THREE.Matrix3();
  function build(p) {
    var L = liveMembers(p, p.kind === "s" ? shOK : mainOK, p.kind === "s" ? SM.byId : SC.byId), ms = L.ms, nv = L.nv, ni = L.ni; if (ms.length < 2) return null; var bx = box(); if (!bx) return null;
    // a local origin near the cell (positions stay small in float)
    var ox = 0, oy = 0, oz = 0; for (var q0 = 0; q0 < ms.length; q0++) { var g0 = ms[q0].geometry; if (!g0.boundingSphere) g0.computeBoundingSphere(); _c.copy(g0.boundingSphere.center).applyMatrix4(ms[q0].matrixWorld); ox += _c.x; oy += _c.y; oz += _c.z; } ox = Math.round(ox / ms.length); oy = Math.round(oy / ms.length); oz = Math.round(oz / ms.length);
    var geo = new THREE.BufferGeometry(), names = p.kind === "s" ? ["position"] : Object.keys(ms[0].geometry.attributes), out = {};
    for (var a = 0; a < names.length; a++) { var nm = names[a], isz = ms[0].geometry.attributes[nm].itemSize; out[nm] = new Float32Array(nv * isz); }
    var idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), vo = 0, io = 0, rmin = Infinity, rmax = 0;
    for (var k = 0; k < ms.length; k++) { var mm = ms[k], gg = mm.geometry, cnt = gg.attributes.position.count;
      _m4.copy(mm.matrixWorld); var e = _m4.elements; e[12] -= ox; e[13] -= oy; e[14] -= oz; _n3.getNormalMatrix(_m4); var n3 = _n3.elements;
      var e0 = e[0], e1 = e[1], e2 = e[2], e4 = e[4], e5 = e[5], e6 = e[6], e8 = e[8], e9 = e[9], e10 = e[10], e12 = e[12], e13 = e[13], e14 = e[14];
      for (var a2 = 0; a2 < names.length; a2++) { var n = names[a2], at = gg.attributes[n], s = at.itemSize, D = out[n], A = at.array, plain = !at.normalized && A instanceof Float32Array && !at.isInterleavedBufferAttribute, v, x, y, z, w;
        if (n === "position") { for (v = 0; v < cnt; v++) { if (plain) { w = v * s; x = A[w]; y = A[w + 1]; z = A[w + 2]; } else { x = at.getX(v); y = at.getY(v); z = at.getZ(v); } w = (vo + v) * 3; D[w] = e0 * x + e4 * y + e8 * z + e12; D[w + 1] = e1 * x + e5 * y + e9 * z + e13; D[w + 2] = e2 * x + e6 * y + e10 * z + e14; } }
        else if (n === "normal") { for (v = 0; v < cnt; v++) { x = at.getX(v); y = at.getY(v); z = at.getZ(v); var X = n3[0] * x + n3[3] * y + n3[6] * z, Y = n3[1] * x + n3[4] * y + n3[7] * z, Z = n3[2] * x + n3[5] * y + n3[8] * z, l = Math.sqrt(X * X + Y * Y + Z * Z) || 1; w = (vo + v) * 3; D[w] = X / l; D[w + 1] = Y / l; D[w + 2] = Z / l; } }
        else if (n === "tangent") { for (v = 0; v < cnt; v++) { x = at.getX(v); y = at.getY(v); z = at.getZ(v); w = (vo + v) * 4; D[w] = e0 * x + e4 * y + e8 * z; D[w + 1] = e1 * x + e5 * y + e9 * z; D[w + 2] = e2 * x + e6 * y + e10 * z; D[w + 3] = at.getW(v); } }
        else { for (v = 0; v < cnt; v++) { w = (vo + v) * s; D[w] = at.getX(v); if (s > 1) D[w + 1] = at.getY(v); if (s > 2) D[w + 2] = at.getZ(v); if (s > 3) D[w + 3] = at.getW(v); } } }
      var flip = p.kind === "s" && mm.matrixWorld.determinant() < 0, ix = gg.index ? gg.index.array : null, nn = gg.index ? gg.index.count : cnt;   /* c takes only meshes with a positive determinant */
      for (var t = 0; t + 2 < nn; t += 3) { var i0 = ix ? ix[t] : t, i1 = ix ? ix[t + 1] : t + 1, i2 = ix ? ix[t + 2] : t + 2; idx[io++] = i0 + vo; if (flip) { idx[io++] = i2 + vo; idx[io++] = i1 + vo; } else { idx[io++] = i1 + vo; idx[io++] = i2 + vo; } }
      vo += cnt; if (!gg.boundingSphere) gg.computeBoundingSphere(); var bs = gg.boundingSphere, rr = bs ? bs.radius * mm.matrixWorld.getMaxScaleOnAxis() : 0; if (rr < rmin) rmin = rr; if (rr > rmax) rmax = rr; }
    for (var a3 = 0; a3 < names.length; a3++) { var ba = new THREE.BufferAttribute(out[names[a3]], ms[0].geometry.attributes[names[a3]].itemSize); ba.r6keep = true; geo.setAttribute(names[a3], ba); }   /* r6keep: client.js's R6 memory pass leaves these arrays alone (a revert disposes them without a read-back) */
    var bi = new THREE.BufferAttribute(io === idx.length ? idx : idx.slice(0, io), 1); bi.r6keep = true; geo.setIndex(bi); geo.computeBoundingSphere();
    var mesh;
    if (p.kind === "s") { mesh = new THREE.Mesh(geo, shMaterial(p.x.side)); mesh.name = "s16 shadow caster"; mesh.layers.mask = BIT; mesh.castShadow = true; mesh.receiveShadow = false; mesh.userData.s16p = true; }
    else { mesh = new THREE.Mesh(geo, p.x.mat); mesh.name = "s16 merged"; mesh.layers.mask = 1; mesh.castShadow = false; mesh.receiveShadow = p.x.rs; mesh.renderOrder = p.x.ro; mesh.userData.s16c = true; mesh.userData.noShadow = true; }
    mesh.userData.r6batch = true; mesh.userData.shSet = true; mesh.position.set(ox, oy, oz); mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
    var E = { key: p.key, kind: p.kind, top: p.top, ms: ms, anc: [], tops: new Set(), mesh: mesh, rmin: rmin, rmax: rmax, nv: nv, dead: false, dirty: false, mat: p.kind === "c" ? p.x.mat : null, cx: ox + geo.boundingSphere.center.x, cy: oy + geo.boundingSphere.center.y, cz: oz + geo.boundingSphere.center.z, R: geo.boundingSphere.radius };
    if (p.kind === "s") mesh.__s16e = E; else mesh.__s16c = E; if (p.top) mesh.visible = p.top.visible === true; if (mesh.id < MW.cap) MW.S16[mesh.id] = p.kind === "s" ? 8 : 16;   /* the draw test reads these flags */
    // watch every member and every parent up to (and with) its top-level object
    var byId = p.kind === "s" ? SM.byId : SC.byId, bit = p.kind === "s" ? 1 : 4;
    for (var j = 0; j < ms.length; j++) { var q = ms[j], R = rec(q), mt = q.material, ga = q.geometry, vs = [];
      for (var an2 in ga.attributes) vs.push(ga.attributes[an2], ga.attributes[an2].version); if (ga.index) vs.push(ga.index, ga.index.version);
      var M = { e: E, mat: mt, geo: ga, vs: vs, wv: MW.WV[q.id], mw: Float64Array.from(q.matrixWorld.elements), side: mt.side, ss: mt.shadowSide, dm: mt.displacementMap || null, par: q.parent, rs: q.receiveShadow, ro: q.renderOrder };
      if (p.kind === "s") R.m = M; else R.c = M; MW.S16[q.id] |= bit; byId.set(q.id, E);
      for (var an = q.parent; an && an.parent; an = an.parent) { var Ra = rec(an); if (!Ra.a) Ra.a = { nc: an.children.length, par: an.parent, vis: an.visible === true, es: [] };
        else if (Ra.a.nc !== an.children.length || Ra.a.par !== an.parent || Ra.a.vis !== (an.visible === true)) { for (var z2 = 0; z2 < Ra.a.es.length; z2++) dirty(Ra.a.es[z2], "parent before build"); Ra.a.nc = an.children.length; Ra.a.par = an.parent; Ra.a.vis = an.visible === true; }
        if (Ra.a.es.indexOf(E) < 0) { Ra.a.es.push(E); E.anc.push(an); } MW.S16[an.id] |= 2; if (!an.parent.parent) E.tops.add(an); }
      if (!q.parent.parent) E.tops.add(q); }
    E.tops.forEach(function (tp) { var TL = W.topE.get(tp); if (!TL) { TL = []; W.topE.set(tp, TL); } TL.push(E); });
    bx.add(mesh); W.live.push(E); var K = p.kind === "s" ? SM : SC; K.n.entries++; K.n.members += ms.length; K.n.verts += nv; return E;
  }
  function dirty(E, why) { if (E.dead || E.dirty) return; E.dirty = true; E.why = why; W.dirty.push(E); }
  function revert(E) {
    if (E.dead) return; E.dead = true; W.n.reverts++; W.n.lastWhy = E.kind + " " + (E.why || "");
    try { if (E.mesh.parent) E.mesh.parent.remove(E.mesh); E.mesh.geometry.dispose(); if (E.mesh.id < MW.cap) MW.S16[E.mesh.id] = 0; } catch (e) { note("revert mesh", e); }
    var byId = E.kind === "s" ? SM.byId : SC.byId, bit = E.kind === "s" ? 1 : 4;
    for (var i = 0; i < E.ms.length; i++) { var m = E.ms[i], R = W.rec.get(m); if (R) { if (E.kind === "s" && R.m && R.m.e === E) R.m = null; if (E.kind === "c" && R.c && R.c.e === E) R.c = null; if (m.id < MW.cap) MW.S16[m.id] &= ~bit; if (!R.m && !R.c && !R.a) W.rec.delete(m); } if (byId.get(m.id) === E) byId.delete(m.id); }
    for (var j = 0; j < E.anc.length; j++) { var a = E.anc[j], Ra = W.rec.get(a); if (!Ra || !Ra.a) continue; var k = Ra.a.es.indexOf(E); if (k >= 0) Ra.a.es.splice(k, 1); if (!Ra.a.es.length) { Ra.a = null; if (a.id < MW.cap) MW.S16[a.id] &= ~2; if (!Ra.m && !Ra.c) W.rec.delete(a); } }
    var li = W.live.indexOf(E); if (li >= 0) W.live.splice(li, 1);
    E.tops.forEach(function (tp) { var TL = W.topE.get(tp); if (TL) { var q = TL.indexOf(E); if (q >= 0) TL.splice(q, 1); if (!TL.length) W.topE.delete(tp); } var n = (W.tries.get(tp) || 0) + 1; W.tries.set(tp, n); if (n < 4) W.seen.delete(tp); });   // a later scan looks at it again
  }
  function memberBad(o, id, M, sh) {
    var mt = o.material, lm = o.layers.mask;
    if (o.visible !== true || mt !== M.mat || o.geometry !== M.geo || o.parent !== M.par || (lm !== 1 && !(lm === 0 && W.ic === true)) || mt.visible !== true || mt.wireframe === true) return true;
    if (sh) { if (o.castShadow !== true || o.customDepthMaterial !== undefined || mt.side !== M.side || mt.shadowSide !== M.ss || mt.alphaTest > 0 || (mt.displacementMap || null) !== M.dm) return true; }
    else if (o.receiveShadow !== M.rs || o.renderOrder !== M.ro || mt.transparent === true || mt.depthTest !== true || mt.depthWrite !== true || userHook(mt)) return true;
    var vs = M.vs; for (var i = 0; i < vs.length; i += 2) if (vs[i].version !== vs[i + 1]) return true;
    if (MW.WV[id] !== M.wv) { var e = o.matrixWorld.elements, c = M.mw; for (var k = 0; k < 16; k++) if (e[k] !== c[k]) return true; M.wv = MW.WV[id]; }
    return false;
  }
  // P3's walk calls this for every flagged object (a merged mesh: 1 shadow / 4 main, a parent of one: 2), right after its world matrix was settled
  H.check = function (o, id, f, d) {
    var R = W.rec.get(o); if (R === undefined) { MW.S16[id] &= ~7; return; } W.n.checkCalls++;
    if (R.m !== null && R.m.e.dead === false && R.m.e.dirty === false && memberBad(o, id, R.m, true)) dirty(R.m.e, "member");
    if (R.c !== null && R.c.e.dead === false && R.c.e.dirty === false && memberBad(o, id, R.c, false)) dirty(R.c.e, "member");
    var A = R.a;
    if (A !== null) {
      if (o.children.length !== A.nc || o.parent !== A.par) { for (var j = 0; j < A.es.length; j++) dirty(A.es[j], "children"); }
      else if (A.vis !== (o.visible === true)) { A.vis = o.visible === true; for (var k = 0; k < A.es.length; k++) { var E = A.es[k]; if (E.top === o) { E.mesh.visible = A.vis; W.n.mirror++; } else dirty(E, "shown or hidden"); } }
    }
  };
  // at the end of the main scene's walk, before anything is drawn: a top-level object taken out of the scene (no longer walked) and
  // every changed cell go back to their originals
  H.flush = function (scn) {
    if (W.live.length === 0 && W.dirty.length === 0) return; if (scn !== C("scene")) return;
    if (W.box && W.box.parent !== scn) { for (var b = 0; b < W.live.length; b++) dirty(W.live[b], "box removed"); }
    W.topE.forEach(function (TL, tp) { if (tp.parent !== scn) for (var i = 0; i < TL.length; i++) dirty(TL[i], "top removed"); });
    if (W.dirty.length === 0) return; var DL = W.dirty; W.dirty = []; for (var k = 0; k < DL.length; k++) { try { revert(DL[k]); } catch (e) { note("revert", e); } } };
  // the draws: a merged mesh draws (and its members do not) where R6's rules would draw every one of its members
  var R0 = null, D6 = null, D6p = null;
  function thr(cam) { if (D6 === null) return 0; var ci = D6.cams.get(cam); return ci === undefined ? 0 : W.thr[ci]; }
  function lit(m) { return (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) && !m.emissiveMap && !(m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) * (m.emissiveIntensity === undefined ? 1 : m.emissiveIntensity) > 0.02); }
  function useMain(E, cam) {   // R6's sub-pixel rule (main camera only): every member is either within 30 m or covers enough pixels
    if (cam.r10eye === true) return false; if (D6p === null || cam !== D6p.cam) return true;
    var p = cam.position, dx = E.cx - p.x, dy = E.cy - p.y, dz = E.cz - p.z, dm = Math.sqrt(dx * dx + dy * dy + dz * dz) + E.R; if (dm <= 30) return true;
    return E.rmin / dm * D6p.K >= (lit(E.mat) ? 0.75 : 0.35);
  }
  function wrap(R) {
    if (R0) return; R0 = R; var rbd0 = R.renderBufferDirect, sm = R.shadowMap, s0 = sm.render;
    R.renderBufferDirect = function (cam, sc, geo, mat, obj, grp) {
      var f = obj.id < MW.cap ? MW.S16[obj.id] : 0;
      if (sc === null) { if (SM.act === true && W.spPass === true) {
        if ((f & 1) !== 0) { var E = SM.byId.get(obj.id); if (E !== undefined && E.dead === false && E.rmin >= thr(cam)) { SM.n.skipMember++; return; } }
        else if ((f & 8) !== 0 && obj.__s16e !== undefined) { if (!(obj.__s16e.rmin >= thr(cam))) { SM.n.proxySkip++; return; } SM.n.proxyDraw++; } } }
      else if (SC.act === true) {
        if ((f & 8) !== 0) return;   // a merged shadow caster is depth only
        if ((f & 4) !== 0) { var E2 = SC.byId.get(obj.id); if (E2 !== undefined && E2.dead === false && useMain(E2, cam)) { SC.n.skipMember++; return; } }
        else if ((f & 16) !== 0 && obj.__s16c !== undefined) { if (!useMain(obj.__s16c, cam)) { SC.n.mergedSkip++; return; } SC.n.mergedDraw++; } }
      else if ((f & 24) !== 0) return;   // switched off (or a merged shadow caster in a colour pass): the originals draw
      return rbd0.apply(this, arguments);
    };
    sm.render = function (lights, scn, cam) {   // three tests a caster's layers against the camera of the render: merged casters draw (and their members do not) only where that camera has their layer
      W.spPass = SM.act === true && W.live.length !== 0 && !!cam && (cam.layers.mask & BIT) !== 0;
      if (SM.act !== true && W.live.length !== 0) { var hid = []; for (var j = 0; j < W.live.length; j++) { var me = W.live[j].mesh; if (W.live[j].kind === "s" && me.layers.mask !== 0) { me.layers.mask = 0; hid.push(me); } } try { return s0.apply(this, arguments); } finally { for (var k = 0; k < hid.length; k++) hid[k].layers.mask = BIT; } }
      return s0.apply(this, arguments);
    };
  }
  function frame() {
    if (!P.readyAt) return; var R = C("renderer"), sc = C("scene"); if (!R || !sc) return; if (!R0) wrap(R);
    var d = P.r6 && P.r6.d; D6 = d && d.on && d.sh && d.csm ? d : null; D6p = d && d.on && d.px && d.cam ? d : null;
    for (var i = 0; i < 4; i++) W.thr[i] = D6 && D6.texel[i] ? (i >= 2 ? 5 : 2) * D6.texel[i] : 0;
    W.ic = !!(P.ic && P.ic.kind); var ok = !W.ic && sc.matrixWorldAutoUpdate === true && !(window.PLAN_VR && window.PLAN_VR.on);
    W.shOn = R.shadowMap.enabled === true; SM.act = SM.on && SM.user && ok && W.shOn; SC.act = SC.on && SC.user && ok;
    if (SM.on && W.live.length !== 0) { var cam = C("camera"); if (cam && (cam.layers.mask & BIT) === 0) cam.layers.mask |= BIT; }   /* its shadow passes test casters against it */   /* no shadow maps (low): nothing to merge for them */
    var t = performance.now(); if (t - P.readyAt < W.start || (!SM.user && !SC.user) || W.ic) return;
    try {   /* each step its own small budget, the oldest work first: due cells are built, then waited snapshots placed, then new tops read */
      var t0 = performance.now();
      if (W.pend.size) { var due = null; W.pend.forEach(function (p) { if (!due && t - p.at > 1500) due = p; }); if (due) { W.pend.delete(due.key); build(due); W.n.buildMs += performance.now() - t0; } }
      var t1 = performance.now();
      while (W.q1.length && t - W.q1[0].at > W.wait && performance.now() - t1 < 1.5) { var c = W.q1.shift(); if (c.o.parent !== sc) continue; var bad = new Set();
        for (var k = 0; k < c.all.length; k++) { var m = c.all[k]; if (!same(m, c.snap[k]) || !chainOK(m, c.o)) bad.add(m); }
        var ks = c.s.filter(function (m) { return !bad.has(m) && shOK(m); }), kc = c.c.filter(function (m) { return !bad.has(m) && mainOK(m); }); if (ks.length) place(c.o, ks, "s"); if (kc.length) place(c.o, kc, "c"); }
      if (t - W.scanAt > 4000) { W.scanAt = t; W.n.scans++; var ch = sc.children; for (var j = 0; j < ch.length; j++) { var o = ch[j]; if (W.seen.has(o)) continue; W.seen.add(o); if (topOK(o)) W.q0.push(o); } }
      var t2 = performance.now();
      while (W.q0.length && performance.now() - t2 < 1.5) { var top = W.q0.shift(); if (top.parent !== sc) continue; var a = [], b = []; if (!collect(top, a, b) || (a.length === 0 && b.length === 0)) { W.n.skipTop++; continue; } W.n.tops++; var all = a.concat(b.filter(function (m) { return a.indexOf(m) < 0; })); W.q1.push({ o: top, s: a, c: b, all: all, snap: all.map(snapOf), at: t }); }
    } catch (e) { note("frame", e); }
  }
  S.stats = function () { var o = { live: W.live.length, q0: W.q0.length, q1: W.q1.length, pend: W.pend.size, smAct: SM.act, scAct: SC.act, skippedWalk: H.skipped }; [["w", W.n], ["sm", SM.n], ["sc", SC.n]].forEach(function (x) { for (var k in x[1]) o[x[0] + "." + k] = typeof x[1][k] === "number" ? Math.round(x[1][k] * 10) / 10 : x[1][k]; }); return o; };
  SM.stats = S.stats;
  var HK = window.PLAN_HOOKS; if ((SM.on || SC.on) && HK && HK.frame) HK.frame.push({ name: "s16Frame", fn: function () { try { frame(); } catch (e) { note("frame hook", e); } } });
})();
