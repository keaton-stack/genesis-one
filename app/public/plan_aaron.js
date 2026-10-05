// R13: Aaron (streaming on a gimbal) and his sidekick Everette at Arrivals Court.
// plan_aaron.js (R13, 4 Oct 2026): two rigged real-person likenesses under the Sun Gate shell, at the Arrivals Court end
// of the Sun Gate Walk (9 to 12 m from the FBO landside door, where every arrival walks out):
//   Aaron streams live on a phone on a hand-held 3-axis gimbal (an emissive stream overlay: LIVE, a viewer count, hearts,
//   chat; a red LIVE light), talks to the camera, turns to you as you walk up, waves, flips the phone round so you are on
//   the stream, and now and then points at the camera. Everette, his sidekick, grooves beside him and does the robot when
//   you ask (talk card button "Ask Everette to dance", and the E prompt says so).
// Dialogue and placement: app/public/plan/aaron.json (editable, no code change). Models: models/aaron.glb, everette.glb
// (+ models_m/, models/lod/), clips models/aaron_anim.glb, everette_anim.glb, screens models/aaron_screen.jpg,
// everette_screen.jpg. Classic script, loaded before client.js; client functions and consts are reached by bare name at
// call time. Performance: no lights (the phone screen and the LIVE light are unlit materials), skinned spheres from R9s
// (frustum culling on), hidden past 150 m and inside interiors, far LOD past 30 m, mixers and the screen throttled by
// distance, everything warmed through PLAN_PERF.warmGroup. ?aaron=0 turns the module off.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var AA = window.PLAN_AARON = window.PLAN_AARON || {};
  AA.v = "r13-1"; AA.errs = AA.errs || []; AA.n = AA.n || {};
  if (/[?&]aaron=0\b/.test(location.search)) { AA.off = true; return; }
  var nWarn = 0;
  function note(where, e) { if (AA.errs.length < 30) AA.errs.push(where + ": " + (e && e.message ? e.message : e)); if (++nWarn <= 20) try { console.warn("plan_aaron " + where, e); } catch (x) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function now() { return performance.now(); }
  var TAU = Math.PI * 2;
  function wrapA(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
  function pick(list) { return list && list.length ? list[Math.floor(Math.random() * list.length)] : ""; }

  // ───────────────────────── data (plan/aaron.json; these defaults only cover a failed fetch) ─────────────────────────
  var DEF = {
    spot: { aaron: [106.7, -112.6, -1.42], everette: [108.25, -112.15, -1.62] },
    files: { aaron: "/models/aaron.glb", aaron_m: "/models_m/aaron.glb", aaron_lod: "/models/lod/aaron.glb", aaron_anim: "/models/aaron_anim.glb", aaron_screen: "/models/aaron_screen.jpg",
      everette: "/models/everette.glb", everette_m: "/models_m/everette.glb", everette_lod: "/models/lod/everette.glb", everette_anim: "/models/everette_anim.glb", everette_screen: "/models/everette_screen.jpg" },
    range: { show: 150, lod: 30, greet: 9, leave: 15, label: 18 },
    progress: { stamp_stream: "p_aaron_stream", stamp_robot: "p_everette_robot" },
    aaron: { id: "aaron", name: "Aaron", role: "Giveback · live on Kick and X", prompt: "talk to Aaron · you're on his stream", talk: [{ t: "Hey! I'm Aaron with Giveback. Say hi to the stream!", o: [["Thanks, Aaron", null]] }], greet: ["Say hi to the stream!"], stream: ["We're live!"], bye: ["Thanks for stopping by!"], film: ["Look at him go!"] },
    everette: { id: "everette", name: "Everette", role: "Aaron's sidekick · The Great Walk", prompt: "talk to Everette · ask him to dance", talk: [{ t: "Hey now! I'm Everette.", o: [["Ask Everette to dance", 1], ["Thanks", null]] }, { t: "Here we go!", act: "dance", o: [["Thanks", null]] }], greet: ["Hey hey!"], ambient: ["Every day is a blessing."], after_dance: ["Beep boop!"] },
    screen: { chat: ["hi from the stream!", "say hi!"], label: "LIVE on Kick + X" }
  };
  var D = DEF;
  function cfg(k) { return (D && D[k]) || DEF[k]; }
  AA.dataP = fetch((window.AV || String)("/plan/aaron.json?v=" + (window.BUILD || "dev"))).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.aaron && j.everette) { D = j; AA.data = j; refreshTalk(); } }).catch(function (e) { note("data", e); });

  // ───────────────────────── the two characters: talk cards, hotspots and colliders first, the rigs stream in ─────────────────────────
  var TALK = window.PLAN_TALK = window.PLAN_TALK || {};
  var CH = AA.ch = {};
  var V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), Q1 = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), M1 = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0), SC = new THREE.Vector3();
  function groundY(x, z) { try { return typeof planGroundAt === "function" ? planGroundAt(x, z) : getH(x, z); } catch (e) { try { return getH(x, z); } catch (e2) { return 0; } } }
  function makeChar(key) {
    var d = cfg(key), sp = cfg("spot")[key]; if (!sp) return null;
    var root = new THREE.Group(); root.name = "r13 " + key; root.position.set(sp[0], groundY(sp[0], sp[1]), sp[1]); root.rotation.y = sp[2]; scene.add(root);
    var c = CH[key] = { key: key, id: d.id, root: root, home: sp, yaw: sp[2], rig: null, lod: null, acts: {}, lacts: {}, cur: null, one: null, state: key === "aaron" ? "stream" : "groove", t: 0, next: 4 + Math.random() * 6, greeted: false, look: 0, lookYaw: 0, bubT: 0, shownAt: 0 };
    var T = TALK[d.id] = { id: d.id, name: d.name, role: d.role, talk: d.talk, greet: d.greet || [], kw: [], g: root, r13: key };
    var fx = Math.sin(sp[2]), fz = Math.cos(sp[2]);
    var hs = { x: sp[0] + fx * 0.9, z: sp[1] + fz * 0.9, r: key === "aaron" ? 3.4 : 3.1, t: d.name, k: d.role + " · press E to talk", p: (d.talk && d.talk[0] && d.talk[0].t) || "", play: "npc:" + d.id, r13: key };
    hotspots.push(hs); c.hs = hs; c.T = T;
    try { COLLIDERS.push([sp[0], sp[1], 0.3]); } catch (e) { note("collider", e); }
    c.label = makeLabel(d.name); c.label.scale.set(1.7, 0.43, 1); c.label.position.y = key === "aaron" ? 2.2 : 2.17; c.label.visible = false; root.add(c.label);
    return c;
  }
  function refreshTalk() {
    ["aaron", "everette"].forEach(function (k) { var c = CH[k], d = cfg(k); if (!c) return; c.T.name = d.name; c.T.role = d.role; c.T.talk = d.talk; c.T.greet = d.greet || []; c.hs.t = d.name; c.hs.k = d.role + " · press E to talk"; c.hs.p = (d.talk && d.talk[0] && d.talk[0].t) || "";
      var sp = cfg("spot")[k]; if (sp && (sp[0] !== c.home[0] || sp[1] !== c.home[1] || sp[2] !== c.home[2])) { c.home = sp; c.yaw = sp[2]; c.root.position.set(sp[0], groundY(sp[0], sp[1]), sp[1]); c.root.rotation.y = sp[2]; c.hs.x = sp[0] + Math.sin(sp[2]) * 0.9; c.hs.z = sp[1] + Math.cos(sp[2]) * 0.9; c.yReady = false;
        try { for (var i = COLLIDERS.length - 1; i >= 0; i--) if (COLLIDERS[i].r13 === k) { COLLIDERS[i][0] = sp[0]; COLLIDERS[i][1] = sp[1]; } } catch (e) {} } });
  }

  // ───────────────────────── loading ─────────────────────────
  function mobile() { try { return typeof ASSET !== "undefined" && /models_m/.test(ASSET.models); } catch (e) { return false; } }
  var LD = null;
  function loadGLB(url) { return new Promise(function (res, rej) { try { if (!LD) LD = gltfLoader(); LD.load(url + "?v=" + (window.BUILD || "dev"), res, undefined, rej); } catch (e) { rej(e); } }); }
  function loadAll() {
    if (AA.loading) return; AA.loading = true; AA.n.t0 = Math.round(now()); var F = cfg("files"), mob = mobile();
    var go = function (k) { return Promise.all([loadGLB(F[k + "_anim"]), loadGLB(mob && F[k + "_m"] ? F[k + "_m"] : F[k])]).then(function (r) { setupRig(CH[k], r[1], r[0]); }); };
    go("aaron").then(function () { return go("everette"); }).then(function () { AA.n.readyMs = Math.round(now() - AA.n.t0); AA.ready = true;
      setTimeout(function () { ["aaron", "everette"].forEach(function (k) { if (F[k + "_lod"]) loadGLB(F[k + "_lod"]).then(function (gl) { setupLod(CH[k], gl); }).catch(function (e) { note(k + " lod", e); }); }); }, 8000);
    }).catch(function (e) { note("load", e); });
  }
  function prepMeshes(g, shadow) {
    var an = 1; try { an = MAX_ANISO || 1; } catch (e) {}
    var ms = []; g.traverse(function (o) { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = shadow; o.receiveShadow = true; o.frustumCulled = true; ms.push(o); var m = o.material; if (m && m.map && an > 1) { m.map.anisotropy = an; m.map.needsUpdate = true; } } });
    return ms;
  }
  function clipsOf(anim) { var out = {}; (anim.animations || []).forEach(function (cl) { cl.tracks = cl.tracks.filter(function (t) { return !/\.scale$/.test(t.name); }); out[cl.name] = cl; }); return out; }
  var ONCE = { wave: 1, point: 1, robot: 1 };
  function actionsFor(mixer, clips) { var a = {}; for (var n in clips) { var act = mixer.clipAction(clips[n]); if (ONCE[n]) { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; } a[n] = act; } return a; }
  function setupRig(c, gl, anim) {
    var g = gl.scene; g.name = "r13 rig " + c.key; c.meshes = prepMeshes(g, true); c.rig = g; c.root.add(g);
    c.clips = clipsOf(anim); c.mixer = new THREE.AnimationMixer(g); c.acts = actionsFor(c.mixer, c.clips);
    c.mixer.addEventListener("finished", function (ev) { if (c.one && ev.action === c.acts[c.one]) { var was = c.one; c.one = null; onOneDone(c, was); } });
    c.bones = { hand: g.getObjectByName("RightHand"), fore: g.getObjectByName("RightForeArm"), head: g.getObjectByName("Head"), chest: g.getObjectByName("Spine") };
    if (c.key === "aaron") { try { buildLenses(c); } catch (e) { note("lenses", e); }
      c.meshes.forEach(function (m) { var d = m.morphTargetDictionary; if (d && d.smile !== undefined && m.morphTargetInfluences) c.morph = { m: m, i: d.smile, w: 0.2, laughT: 4 + Math.random() * 4, laugh: 0, peak: 0 }; var mt = m.material; if (mt && mt.roughness !== undefined) mt.roughness = 1.12; }); }   // R13b: matte skin (roughness x 1.12 on the baked 0.72)
    play(c, c.key === "aaron" ? "idle" : "groove", 0); c.mixer.update(0.001); g.updateMatrixWorld(true);
    if (c.key === "aaron") try { buildGimbal(c); } catch (e) { note("gimbal", e); }
    try { if (window.PLAN_PERF && PLAN_PERF.warmGroup) { PLAN_PERF.warmGroup(c.root, { name: "r13 " + c.key }); if (c.gim) PLAN_PERF.warmGroup(c.gim.A, { name: "r13 gimbal" }); } } catch (e) { note("warm", e); }
    c.shownAt = now(); AA.n[c.key] = 1;
  }
  function setupLod(c, gl) {
    if (!c || !c.rig) return; var g = gl.scene; g.name = "r13 lod " + c.key; prepMeshes(g, false); g.visible = false; c.root.add(g); c.lod = g;
    c.lmixer = new THREE.AnimationMixer(g); c.lacts = actionsFor(c.lmixer, c.clips); c.lbones = { hand: g.getObjectByName("RightHand"), fore: g.getObjectByName("RightForeArm") };
    try { if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(c.root, { name: "r13 lod " + c.key }); } catch (e) {}
    AA.n[c.key + "Lod"] = 1;
  }
  function play(c, name, fade) {
    if (fade === undefined) fade = 0.35; var a = c.acts[name]; if (!a) return;
    c.one = ONCE[name] ? name : null; if (c.cur === name && !ONCE[name]) return;
    var prev = c.cur ? c.acts[c.cur] : null; a.reset(); a.setEffectiveTimeScale(1); a.setEffectiveWeight(1); a.enabled = true;
    if (prev && prev !== a && fade > 0) { a.play(); prev.crossFadeTo(a, fade, false); } else { if (prev && prev !== a) prev.stop(); a.play(); }
    c.cur = name;
    if (c.lmixer && c.lacts[name]) { var la = c.lacts[name]; for (var k in c.lacts) if (c.lacts[k] !== la) c.lacts[k].stop(); la.reset(); la.play(); }
  }
  function onOneDone(c, was) {
    if (c.key === "everette" && was === "robot") { c.state = "groove"; play(c, "groove", 0.5); say(c, pick(cfg("everette").after_dance)); award(cfg("progress").stamp_robot); AA.n.robots = (AA.n.robots || 0) + 1; return; }
    play(c, base(c), 0.4);
  }
  function base(c) {
    if (c.key === "aaron") return c.state === "talk" ? "talk" : c.state === "film" ? "groove" : "idle";
    return c.state === "talk" ? "talk" : c.state === "idle" ? "idle" : "groove";
  }

  // ───────────────────────── R13b: lenses in Aaron's glasses (thin tinted glass with a slight reflection) ─────────────────────────
  function buildLenses(c) {
    var L = cfg("glasses"), hb = c.bones.head; if (!L || !L.lenses || !hb) return; c.root.updateMatrixWorld(true);
    var inv = new THREE.Matrix4().copy(hb.matrixWorld).invert().multiply(c.rig.matrixWorld), geos = [];
    L.lenses.forEach(function (ln) { var w = L.w, h = L.h, r = L.r || 0.006, sh = new THREE.Shape(), x0 = ln[0] - w / 2, y0 = ln[1] - h / 2;
      sh.moveTo(x0 + r, y0); sh.lineTo(x0 + w - r, y0); sh.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r); sh.lineTo(x0 + w, y0 + h - r); sh.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
      sh.lineTo(x0 + r, y0 + h); sh.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r); sh.lineTo(x0, y0 + r); sh.quadraticCurveTo(x0, y0, x0 + r, y0);
      var gg = new THREE.ShapeGeometry(sh, 6), p = gg.attributes.position; for (var i = 0; i < p.count; i++) { var x = p.getX(i); p.setZ(i, L.z - L.wrap * x * x); } gg.computeVertexNormals(); geos.push(gg); });
    var gm = mergeUV(geos); gm.applyMatrix4(inv); gm.computeBoundingSphere();
    var mat = new THREE.MeshStandardMaterial({ color: 0x0e1418, transparent: true, opacity: 0.14, roughness: 0.04, metalness: 0.1, depthWrite: false });
    var lm = new THREE.Mesh(gm, mat); lm.name = "r13 lenses"; lm.castShadow = false; lm.renderOrder = 2; hb.add(lm); c.lens = lm;
  }
  // R13b: the smile morph eases between a relaxed friendly smile (0) and a bigger one (1): subtle while he talks to the stream,
  // up when he greets, waves, points or laughs, a laugh now and then while you talk with him
  function smileFrame(c, dt) {
    var M = c.morph; if (!M) return; var tgt;
    if (c.one === "wave") tgt = 0.55; else if (c.one === "point") tgt = 0.45;
    else if (c.state === "film") tgt = 0.42; else if (c.state === "talk") tgt = 0.28; else if (c.state === "near") tgt = 0.35;
    else tgt = 0.1 + 0.15 * (0.5 + 0.5 * Math.sin(c.t * 0.83)) * (0.5 + 0.5 * Math.sin(c.t * 0.31 + 1.1));
    if (c.state === "talk" || c.state === "film" || c.state === "near") { M.laughT -= dt; if (M.laughT <= 0) { M.laughT = 5 + Math.random() * 5; M.laugh = 1.3; } }
    if (M.laugh > 0) { M.laugh -= dt; tgt = Math.max(tgt, 0.5); }
    if (M.peak > 0) { M.peak -= dt; tgt = Math.max(tgt, 0.55); }   // capped: above about 0.6 the morph presses the lips into a tight grin
    M.w += (tgt - M.w) * Math.min(1, dt * (tgt > M.w ? 4.5 : 2.2)); M.m.morphTargetInfluences[M.i] = M.w;
  }
  AA.smile = function (p) { var M = CH.aaron && CH.aaron.morph; if (M) M.peak = p || 2.5; return !!M; };
  // ───────────────────────── the gimbal and the phone (Aaron's right hand) ─────────────────────────
  function part(list, geo, col, m) { geo = geo.index ? geo.toNonIndexed() : geo; if (m) geo.applyMatrix4(m); var n = geo.attributes.position.count, c = new Float32Array(n * 3); for (var i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; } geo.setAttribute("color", new THREE.BufferAttribute(c, 3)); list.push(geo); }
  function merge(list) { var n = 0; list.forEach(function (g) { n += g.attributes.position.count; }); var P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), o = 0;
    list.forEach(function (g) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); C.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); });
    var out = new THREE.BufferGeometry(); out.setAttribute("position", new THREE.BufferAttribute(P, 3)); out.setAttribute("normal", new THREE.BufferAttribute(N, 3)); out.setAttribute("color", new THREE.BufferAttribute(C, 3)); out.computeBoundingSphere(); return out; }
  function T(x, y, z, rx, rz) { var m = new THREE.Matrix4(); if (rx) m.makeRotationX(rx); else if (rz) m.makeRotationZ(rz); m.setPosition(x, y, z); return m; }
  function buildGimbal(c) {
    var BLK = [0.03, 0.03, 0.033], RUB = [0.05, 0.05, 0.055], MET = [0.1, 0.1, 0.11], DRK = [0.07, 0.07, 0.078];
    var a = [];   // the handle, its rod and the pan motor (follows the hand)
    part(a, new THREE.CylinderGeometry(0.0175, 0.0185, 0.13, 14), RUB, T(0, 0, 0)); part(a, new THREE.CylinderGeometry(0.02, 0.02, 0.012, 14), BLK, T(0, -0.071, 0));
    part(a, new THREE.CylinderGeometry(0.0195, 0.0195, 0.01, 14), BLK, T(0, 0.07, 0)); part(a, new THREE.BoxGeometry(0.012, 0.016, 0.006), DRK, T(0, 0.035, 0.018));
    part(a, new THREE.CylinderGeometry(0.0095, 0.0095, 0.15, 10), MET, T(0, 0.15, 0)); part(a, new THREE.CylinderGeometry(0.023, 0.021, 0.034, 16), DRK, T(0, 0.24, 0));
    var b = [];   // the stabilised head: arm, roll motor, clamp and the phone (screen +Z)
    part(b, new THREE.BoxGeometry(0.06, 0.012, 0.018), DRK, T(0.022, 0.004, -0.012)); part(b, new THREE.BoxGeometry(0.016, 0.07, 0.018), DRK, T(0.045, 0.035, -0.012)); part(b, new THREE.CylinderGeometry(0.02, 0.02, 0.026, 16), DRK, T(0.045, 0.075, -0.012, Math.PI / 2));
    part(b, new THREE.BoxGeometry(0.03, 0.05, 0.014), BLK, T(0.0, 0.085, -0.012)); part(b, new THREE.BoxGeometry(0.162, 0.078, 0.009), BLK, T(0, 0.085, 0.0));
    part(b, new THREE.BoxGeometry(0.012, 0.03, 0.004), MET, T(-0.06, 0.085, -0.0055));
    var mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.15 });
    var A = new THREE.Mesh(merge(a), mat), B = new THREE.Mesh(merge(b), mat); A.name = "r13 gimbal"; B.name = "r13 gimbal head"; A.castShadow = false; B.castShadow = false;
    B.position.set(0, 0.258, 0); A.add(B);
    // the screen and the LIVE light: one unlit canvas texture (the light is a strip of the same canvas)
    var cv = document.createElement("canvas"); cv.width = 512; cv.height = 256; var tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    var smat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff }); smat.color.setScalar(1.15);
    var sg = new THREE.PlaneGeometry(0.152, 0.070); var uv = sg.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) > 0.5 ? 1 : 1 - 240 / 256);
    var lg = new THREE.PlaneGeometry(0.009, 0.009); var uv2 = lg.attributes.uv; for (var j = 0; j < uv2.count; j++) { uv2.setX(j, 0.02 + uv2.getX(j) * 0.02); uv2.setY(j, uv2.getY(j) > 0.5 ? 0.04 : 0.008); }
    lg.translate(-0.066, 0.129, 0.0049); var lgb = lg.clone(); lgb.rotateY(Math.PI); lgb.translate(0, 0, -0.0005);   // the light shows front and back
    sg.translate(0, 0.085, 0.0047);
    var sgeo = mergeUV([sg, lg, lgb]); var S = new THREE.Mesh(sgeo, smat); S.name = "r13 phone screen"; S.castShadow = false; B.add(S);
    scene.add(A); A.visible = false;
    var img = new Image(); var F = cfg("files"); img.src = (window.AV || String)(F.aaron_screen + "?v=" + (window.BUILD || "dev")); var img2 = new Image(); img2.src = (window.AV || String)(F.everette_screen + "?v=" + (window.BUILD || "dev"));
    c.gim = { A: A, B: B, S: S, cv: cv, x: cv.getContext("2d"), tex: tex, img: img, img2: img2, mode: "self", qB: new THREE.Quaternion(), cal: null, viewers: 120 + Math.floor(Math.random() * 90), hearts: [], chat: [], chatT: 0, drawT: 0, frame: 0 };
    calibrate(c); drawScreen(c, 0, true);
  }
  function mergeUV(list) { var gs = list.map(function (g) { return g.index ? g.toNonIndexed() : g; }); var n = 0; gs.forEach(function (g) { n += g.attributes.position.count; }); var P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), o = 0;
    gs.forEach(function (g) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); U.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; });
    var out = new THREE.BufferGeometry(); out.setAttribute("position", new THREE.BufferAttribute(P, 3)); out.setAttribute("normal", new THREE.BufferAttribute(N, 3)); out.setAttribute("uv", new THREE.BufferAttribute(U, 2)); out.computeBoundingSphere(); return out; }
  // the handle sits in the fist: measured once from the hold pose (the idle clip at t 0), then it rides the hand bone
  function calibrate(c) {
    var b = c.bones; if (!b.hand || !b.fore) return; c.rig.updateMatrixWorld(true);
    var hp = new THREE.Vector3(), hq = new THREE.Quaternion(), fp = new THREE.Vector3(); b.hand.matrixWorld.decompose(hp, hq, SC); fp.setFromMatrixPosition(b.fore.matrixWorld);
    var dir = hp.clone().sub(fp).normalize(); var grip = hp.clone().addScaledVector(dir, 0.072); grip.y -= 0.012;
    var yaw = c.root.rotation.y; var want = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, yaw, 0, "YXZ"));
    var inv = hq.clone().invert(); c.gim.cal = { q: inv.clone().multiply(want), p: grip.sub(hp).applyQuaternion(inv) };
  }
  function gimbalFrame(c, dt, near) {
    var G = c.gim; if (!G || !G.cal) return; var useLod = c.lod && c.lod.visible, hb = useLod ? c.lbones.hand : c.bones.hand; if (!hb) return;
    hb.matrixWorld.decompose(V1, Q1, SC); G.A.quaternion.copy(Q1).multiply(G.cal.q); V2.copy(G.cal.p).applyQuaternion(Q1); G.A.position.copy(V1).add(V2);
    if (!near) return;
    // stabilised head: the screen (+Z) looks at the target (Aaron's face, the visitor, or Everette), with a gimbal's smooth lag
    G.A.updateMatrixWorld(true); V3.setFromMatrixPosition(G.B.matrixWorld);
    var tg = V2; var E = CH.everette;
    if (G.mode === "show" && player) tg.set(player.position.x, player.position.y + 1.55, player.position.z);
    else if (G.mode === "film" && E && E.root) tg.set(E.root.position.x, E.root.position.y + 1.25, E.root.position.z);
    else if (c.bones.head) { tg.setFromMatrixPosition(c.bones.head.matrixWorld); tg.y += 0.06; }
    M1.lookAt(tg, V3, UP); Q2.setFromRotationMatrix(M1); G.A.getWorldQuaternion(Q1); Q1.invert().multiply(Q2);
    G.qB.slerp(Q1, 1 - Math.exp(-dt * 5.5)); G.B.quaternion.copy(G.qB);
  }
  // the stream overlay: camera view, LIVE pill, viewers, hearts, chat, the LIVE light strip
  var USERS = ["solport_fan", "zone_saturday", "desert_dee", "jet_jay", "walk_with_us", "kindness_kev", "az_amy", "rv_rider"];
  function drawScreen(c, dt, force) {
    var G = c.gim; if (!G) return; var x = G.x, W = 512, H = 240, t = now() / 1000; G.frame++;
    var mode = G.mode, img = mode === "film" ? G.img2 : G.img;
    if (mode === "show") { var gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#7fb2e6"); gr.addColorStop(0.62, "#e9dcc4"); gr.addColorStop(1, "#c9b391"); x.fillStyle = gr; x.fillRect(0, 0, W, H);
      x.fillStyle = "rgba(255,255,255,.85)"; x.beginPath(); x.ellipse(256, -40, 300, 95, 0, 0, TAU); x.fill();
      x.fillStyle = "#0a1610"; x.font = "800 40px 'Space Grotesk', system-ui, sans-serif"; x.textAlign = "center"; x.fillText("YOU'RE LIVE!", 256, 128);
      var nm = ""; try { nm = (localStorage.getItem("g1:name") || "").slice(0, 18); } catch (e) {} x.font = "600 22px 'Space Grotesk', system-ui, sans-serif"; x.fillStyle = "#1d7a45"; x.fillText(nm ? "say hi, " + nm + "!" : "say hi to the stream!", 256, 160); }
    else if (img && img.complete && img.naturalWidth) x.drawImage(img, 0, 0, W, H);
    else { x.fillStyle = "#1a2a22"; x.fillRect(0, 0, W, H); }
    // LIVE pill and the viewer count
    x.textAlign = "left"; x.fillStyle = "#e5262d"; rr(x, 12, 12, 64, 28, 6); x.fill(); x.fillStyle = "#fff"; x.font = "800 18px 'Space Grotesk', system-ui, sans-serif"; x.fillText("LIVE", 24, 32);
    if (Math.random() < dt * 1.6) G.viewers = Math.max(60, G.viewers + Math.round((Math.random() - 0.38) * 6));
    x.fillStyle = "rgba(0,0,0,.55)"; rr(x, 82, 12, 92, 28, 6); x.fill(); x.fillStyle = "#fff"; x.font = "600 16px 'Space Grotesk', system-ui, sans-serif"; x.fillText("● " + G.viewers, 92, 31);
    x.textAlign = "right"; x.fillStyle = "rgba(0,0,0,.45)"; rr(x, W - 150, 12, 138, 24, 6); x.fill(); x.fillStyle = "#4DDE6F"; x.font = "600 14px 'Space Grotesk', system-ui, sans-serif"; x.fillText((cfg("screen").label || "LIVE"), W - 20, 29);
    // chat, bottom left
    G.chatT -= dt; if (G.chatT <= 0 || !G.chat.length) { G.chatT = 1.6 + Math.random() * 2.4; G.chat.push([pick(USERS), pick(cfg("screen").chat)]); if (G.chat.length > 3) G.chat.shift(); }
    x.textAlign = "left"; for (var i = 0; i < G.chat.length; i++) { var yy = H - 14 - (G.chat.length - 1 - i) * 24; x.fillStyle = "rgba(0,0,0,.5)"; var line = G.chat[i][0] + "  " + G.chat[i][1]; x.font = "600 15px 'Space Grotesk', system-ui, sans-serif"; var w = Math.min(300, x.measureText(line).width + 16); rr(x, 10, yy - 17, w, 22, 6); x.fill(); x.fillStyle = "#9ff0b4"; x.fillText(G.chat[i][0], 18, yy); x.fillStyle = "#fff"; x.fillText(G.chat[i][1], 18 + x.measureText(G.chat[i][0] + "  ").width, yy); }
    // hearts rising on the right
    var rate = mode === "self" ? 1.4 : 3.2; if (Math.random() < dt * rate) G.hearts.push({ x: W - 40 - Math.random() * 40, y: H - 20, v: 40 + Math.random() * 30, s: 12 + Math.random() * 9, c: ["#ff4f6d", "#ff8fa3", "#4DDE6F", "#f4cd5a"][Math.floor(Math.random() * 4)], a: 1, ph: Math.random() * 6 });
    for (var h = G.hearts.length - 1; h >= 0; h--) { var q = G.hearts[h]; q.y -= q.v * dt; q.a -= dt * 0.45; if (q.a <= 0 || q.y < 20) { G.hearts.splice(h, 1); continue; } heart(x, q.x + Math.sin(t * 3 + q.ph) * 6, q.y, q.s, q.c, q.a); }
    // the LIVE light (bottom strip of the canvas, mapped onto the small light on the phone): blinks once a second
    x.fillStyle = "#000"; x.fillRect(0, 240, W, 16); x.fillStyle = (t % 1) < 0.55 ? "#ff2a2a" : "#5a0a0a"; x.fillRect(0, 244, 40, 12);
    G.tex.needsUpdate = true;
  }
  function rr(x, a, b, w, h, r) { x.beginPath(); if (x.roundRect) x.roundRect(a, b, w, h, r); else x.rect(a, b, w, h); }
  function heart(x, cx, cy, s, col, a) { x.globalAlpha = clamp(a, 0, 1); x.fillStyle = col; x.beginPath(); x.moveTo(cx, cy + s * 0.35); x.bezierCurveTo(cx - s, cy - s * 0.35, cx - s * 0.45, cy - s, cx, cy - s * 0.45); x.bezierCurveTo(cx + s * 0.45, cy - s, cx + s, cy - s * 0.35, cx, cy + s * 0.35); x.fill(); x.globalAlpha = 1; }

  // ───────────────────────── speech: a two-line bubble per character (one canvas, redrawn on change) ─────────────────────────
  function say(c, text) {
    if (!text || !c || !player) return; if (Math.hypot(player.position.x - c.root.position.x, player.position.z - c.root.position.z) > 26) return;
    if (!c.bub) { var cv = document.createElement("canvas"); cv.width = 512; cv.height = 150; var tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })); sp.scale.set(2.5, 0.73, 1); sp.position.y = 2.62; sp.renderOrder = 5; c.root.add(sp); c.bub = { cv: cv, x: cv.getContext("2d"), tex: tex, sp: sp }; }
    var B = c.bub, x = B.x; x.clearRect(0, 0, 512, 150); x.font = "500 27px 'Space Grotesk', system-ui, sans-serif"; x.textAlign = "center";
    var words = String(text).split(" "), lines = [""]; words.forEach(function (w) { var tl = lines[lines.length - 1] ? lines[lines.length - 1] + " " + w : w; if (x.measureText(tl).width > 450 && lines[lines.length - 1]) { if (lines.length < 2) lines.push(w); else lines[1] = (lines[1] + " " + w); } else lines[lines.length - 1] = tl; });
    if (lines[1] && x.measureText(lines[1]).width > 450) { while (lines[1].length > 3 && x.measureText(lines[1] + "...").width > 450) lines[1] = lines[1].slice(0, -1); lines[1] += "..."; }
    var w = 0; lines.forEach(function (l) { w = Math.max(w, x.measureText(l).width); }); w += 40; var h = 26 + lines.length * 36;
    x.fillStyle = "rgba(245,241,230,.95)"; rr(x, 256 - w / 2, 140 - h, w, h, 18); x.fill(); x.fillStyle = "#0a1610"; lines.forEach(function (l, i) { x.fillText(l, 256, 140 - h + 40 + i * 36); });
    B.tex.needsUpdate = true; B.sp.visible = true; c.bubT = now(); for (var ok in CH) { var o2 = CH[ok]; if (o2 !== c && o2.bub && o2.bub.sp.visible) o2.bub.sp.visible = false; }   // one speaker at a time, no overlapping bubbles try { logLine(c.T.name, text); } catch (e) {}
  }
  function award(id) { try { var PP = window.PLAN_PROGRESS; if (id && PP && PP.award) PP.award("stamp", { id: id }); } catch (e) {} }

  // ───────────────────────── talk card: the "act" pages (Ask Everette to dance) and the green button ─────────────────────────
  function startRobot() {
    var E = CH.everette; if (!E || !E.rig || E.state === "robot") return false;
    E.state = "robot"; play(E, "robot", 0.25); E.t = 0; AA.n.robotT = Math.round(now()); setTimeout(function () { say(CH.aaron, pick(cfg("aaron").film)); }, 1800); return true;
  }
  AA.startRobot = startRobot;
  function onShow(c, idx) {
    if (!c || !c.r13) return; var node = c.talk && c.talk[idx];
    if (node && node.act === "dance" && c.r13 === "everette") startRobot();
    try { var box = document.getElementById("talk-o"); if (box && node && node.o) for (var i = 0; i < box.children.length && i < node.o.length; i++) { var nx = node.o[i][1], tgt = nx !== null && nx !== undefined ? c.talk[nx] : null; if (tgt && tgt.act === "dance") { var b = box.children[i]; b.style.background = "#f4cd5a"; b.style.color = "#20170a"; b.style.fontWeight = "800"; b.style.boxShadow = "0 0 0 2px rgba(244,205,90,.35), 0 6px 18px rgba(244,205,90,.25)"; } } } catch (e) {}   // the button that starts the dance stands out in gold
  }
  function install() {
    if (AA.installed) return; AA.installed = true;
    try { if (typeof showTalk === "function") { var st0 = showTalk; showTalk = function (c, idx) { var r = st0.apply(this, arguments); try { onShow(c, idx); } catch (e) { note("talk", e); } return r; }; } } catch (e) { note("wrap talk", e); }
    try { if (typeof updateZone === "function") { var uz0 = updateZone; updateZone = function () { var r = uz0.apply(this, arguments); try { promptFrame(); } catch (e) { note("prompt", e); } return r; }; } } catch (e) { note("wrap zone", e); }
  }
  function promptFrame() {
    if (!player || (typeof inside !== "undefined" && inside)) return; var el = document.getElementById("prompt"), t = document.getElementById("prompt-t"); if (!el || !t || !el.classList.contains("on")) return;
    var nh = typeof nearestHotspot === "function" ? nearestHotspot() : null; if (!nh || !nh.r13) return; var d = cfg(nh.r13); var want = "<b>E</b> &nbsp;" + (d.prompt || ("talk to " + d.name));
    if (t.innerHTML.indexOf(nh.t) >= 0 && t.innerHTML !== want && !/<b>F<\/b>/.test(t.innerHTML)) t.innerHTML = want;
  }

  // ───────────────────────── the frame: behaviour, LOD, throttled mixers, the gimbal and the screen ─────────────────────────
  function face(c, yaw, dt, rate) { var d = wrapA(yaw - c.yaw); var st = (rate || 2.4) * dt; c.yaw += Math.abs(d) < st ? d : Math.sign(d) * st; c.root.rotation.y = c.yaw; }
  function yawTo(c, x, z) { return Math.atan2(x - c.root.position.x, z - c.root.position.z); }
  function headLook(c, dt, active, yawWant) {
    var hb = c.bones.head; if (!hb) return; c.look += ((active ? 1 : 0) - c.look) * Math.min(1, dt * 3); var d = clamp(wrapA(yawWant - c.yaw), -0.8, 0.8); c.lookYaw += (d - c.lookYaw) * Math.min(1, dt * 4);
    if (c.look < 0.02) return; Q1.setFromAxisAngle(UP, c.lookYaw * 0.65 * c.look); hb.quaternion.multiply(Q1);
  }
  var FR = { k: 0 };
  function frame(dt, tnow) {
    if (!player || !CH.aaron) return; dt = Math.min(dt || 0.016, 0.1); FR.k++;
    var R = cfg("range"), A = CH.aaron, E = CH.everette, inside0 = false; try { inside0 = !!inside; } catch (e) {}
    var cam = camera.position, P = player.position;
    for (var key in CH) { var c = CH[key]; if (!c.rig) continue;
      if (!c.yReady) { try { if (typeof XG === "undefined" || XG.walkReady) { c.root.position.y = groundY(c.home[0], c.home[1]); c.yReady = true; } } catch (e) { c.yReady = true; } }
      var dc = Math.hypot(cam.x - c.root.position.x, cam.z - c.root.position.z); var vis = !inside0 && dc < R.show; c.root.visible = vis; c.dc = dc;
      var far = vis && c.lod && dc > R.lod; c.rig.visible = vis && !far; if (c.lod) c.lod.visible = far;
      if (c.label) c.label.visible = vis && dc < R.label && dc > 5; if (c.bub && c.bub.sp.visible && now() - c.bubT > 6500) c.bub.sp.visible = false;
      var sh = dc < 45; if (c.meshes && c.sh !== sh) { c.sh = sh; c.meshes.forEach(function (m) { m.castShadow = sh; }); } }
    if (A.gim) A.gim.A.visible = A.root.visible && A.dc < 60;
    if (!A.root.visible && !(E && E.root.visible)) {   // out of sight: forget the greeting (a visitor who comes back is greeted again)
      if (A.greeted) { A.greeted = false; A.state = "stream"; if (A.gim) A.gim.mode = "self"; } if (E && E.greeted) E.greeted = false; return; }
    var talk = null; try { talk = talkNpc; } catch (e) {}
    var dA = Math.hypot(P.x - A.root.position.x, P.z - A.root.position.z), dE = E ? Math.hypot(P.x - E.root.position.x, P.z - E.root.position.z) : 99;
    // Everette
    if (E && E.rig) { E.t += dt; var talkE = talk && talk === E.T;
      if (E.state === "robot") face(E, yawTo(E, P.x, P.z), dt, 1.5);
      else if (talkE) { if (E.state !== "talk") { E.state = "talk"; if (!E.one) play(E, "talk"); } face(E, yawTo(E, P.x, P.z), dt); }
      else { if (E.state === "talk") { E.state = "groove"; if (!E.one) play(E, "groove"); }
        if (dE < R.greet && !E.greeted) { E.greeted = true; play(E, "wave", 0.3); setTimeout(function () { say(E, pick(cfg("everette").greet)); }, 3600); }
        if (dE > R.leave) E.greeted = false;
        var wantE = dE < R.greet + 3 ? yawTo(E, P.x, P.z) : E.home[2]; face(E, wantE, dt, 1.6);
        if (!E.one) { E.next -= dt; if (E.next <= 0) { if (E.state === "groove" && Math.random() < 0.35) { E.state = "idle"; play(E, "idle", 0.6); E.next = 5 + Math.random() * 4; } else { E.state = "groove"; play(E, "groove", 0.6); E.next = 14 + Math.random() * 12; if (dE < 20 && Math.random() < 0.5) say(E, pick(cfg("everette").ambient)); } } } } }
    // Aaron
    if (A.rig) { A.t += dt; var G = A.gim, talkA = talk && talk === A.T;
      if (E && E.state === "robot") { if (A.state !== "film") { A.state = "film"; if (!A.one) play(A, "groove"); } if (G) G.mode = "film"; face(A, yawTo(A, E.root.position.x, E.root.position.z) + 0.35, dt, 1.8); }
      else if (talkA) { if (A.state !== "talk") { A.state = "talk"; if (!A.one) play(A, "talk"); } if (G) G.mode = "show"; face(A, yawTo(A, P.x, P.z), dt); }
      else {
        if (A.state === "talk" || A.state === "film") { A.state = dA < R.greet ? "near" : "stream"; if (!A.one) play(A, "idle"); if (G) G.mode = A.greeted && dA < R.greet && !(A.flipIn > 0) ? "show" : "self"; }
        if (dA < R.greet) {
          if (!A.greeted) { A.greeted = true; A.state = "near"; play(A, "wave", 0.3); if (A.morph) A.morph.peak = 3.2; say(A, pick(cfg("aaron").greet)); A.pointIn = 6 + Math.random() * 5; A.flipIn = 2.4; }
          if (A.flipIn > 0) { A.flipIn -= dt; if (A.flipIn <= 0 && G) { G.mode = "show"; award(cfg("progress").stamp_stream); AA.n.flips = (AA.n.flips || 0) + 1; } }
          face(A, yawTo(A, P.x, P.z), dt, 2.0);
          A.pointIn -= dt; if (A.pointIn <= 0 && !A.one) { A.pointIn = 9 + Math.random() * 7; play(A, "point", 0.25); }
        } else {
          if (A.greeted && dA > R.leave) { A.greeted = false; A.state = "stream"; if (dA < 24) say(A, pick(cfg("aaron").bye)); }
          if (!A.greeted) { if (G) G.mode = "self"; face(A, A.home[2] + 0.18 * Math.sin(A.t * 0.21), dt, 1.2);
            A.next -= dt; if (A.next <= 0) { A.next = 13 + Math.random() * 11; if (dA < 22) say(A, pick(cfg("aaron").stream)); } }
          else face(A, yawTo(A, P.x, P.z), dt, 2.0);
        }
      } }
    // mixers by distance (every frame within 25 m, every 2nd to 60 m, every 4th beyond), then the head look and the gimbal
    for (var k2 in CH) { var c2 = CH[k2]; if (!c2.rig || !c2.root.visible) continue; var step = c2.dc < 25 ? 1 : c2.dc < 60 ? 2 : 4; c2.acc = (c2.acc || 0) + dt; if (FR.k % step) continue; var adt = c2.acc; c2.acc = 0;
      if (c2.lod && c2.lod.visible) { if (c2.lmixer) c2.lmixer.update(adt); c2.mixer.update(adt); }
      else { c2.mixer.update(adt); var lookOn = c2.dc < 12 && c2.state !== "robot" && c2.state !== "film" && !c2.one; var dp = Math.hypot(P.x - c2.root.position.x, P.z - c2.root.position.z); headLook(c2, adt, lookOn && dp < 8, yawTo(c2, P.x, P.z)); }
      if (c2 === A) { if (A.morph && A.dc < 30) smileFrame(A, adt); if (A.lens) A.lens.visible = A.dc < 16 && A.rig.visible; if (A.gim) { A.root.updateMatrixWorld(true); gimbalFrame(A, adt, A.dc < 40); } } }
    if (A.gim && A.dc < 40) { var gd = A.dc < 15 ? 1 / 12 : 0.5; A.gim.drawT += dt; if (A.gim.drawT >= gd) { drawScreen(A, A.gim.drawT); A.gim.drawT = 0; } }
  }
  AA.frame = frame;
  AA.debug = {
    robot: function () { return startRobot(); },
    state: function () { var o = {}; for (var k in CH) { var c = CH[k]; o[k] = { state: c.state, cur: c.cur, one: c.one, ready: !!c.rig, lod: !!c.lod, vis: c.root.visible, dc: Math.round(c.dc || 0), pos: [+c.root.position.x.toFixed(2), +c.root.position.y.toFixed(2), +c.root.position.z.toFixed(2)], yaw: +c.yaw.toFixed(2) }; } if (CH.aaron && CH.aaron.gim) o.gim = CH.aaron.gim.mode; return o; },
    mode: function (m) { if (CH.aaron && CH.aaron.gim) CH.aaron.gim.mode = m; return m; },
    play: function (k, n) { var c = CH[k]; if (c) play(c, n, 0.2); return !!c; },
    pause: function (on) { AA.paused = !!on; return AA.paused; },
    pose: function (k, n, t) { var c = CH[k]; if (!c || !c.acts[n]) return false; play(c, n, 0); c.acts[n].time = t; c.mixer.update(0); return true; }
  };

  // ───────────────────────── hooks ─────────────────────────
  var H = window.PLAN_HOOKS;
  H.world.push({ name: "planAaronWorld", fn: function () { try { makeChar("aaron"); makeChar("everette"); try { COLLIDERS[COLLIDERS.length - 2].r13 = "aaron"; COLLIDERS[COLLIDERS.length - 1].r13 = "everette"; } catch (e) {} install(); loadAll(); } catch (e) { note("world", e); } } });
  H.frame.push({ name: "planAaronFrame", fn: function (dt, t) { if (AA.paused) return; try { frame(dt, t); } catch (e) { if (!AA.frameErr) { AA.frameErr = 1; note("frame", e); } } } });
})();
