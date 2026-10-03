/* plan_vr.js · R10: a first, simple WebXR VR mode (3 Oct 2026)
   Roam the site in a headset: the Quest Browser on a Quest 3, or a PC headset (Quest Link / Air Link, SteamVR) with Edge or Chrome.
   - "ENTER VR" in the top-right HUD, shown only when navigator.xr reports immersive-vr. Leaving VR restores the normal game exactly.
   - The headset is the player's head: a rig (local-floor space) sits on the avatar so the head is at the avatar's eye height; the
     avatar's body follows the head (walking in the room moves it, through the game's own collision) and is hidden from your own view.
   - Left stick: smooth walk relative to where you look (the game's walking code: collision, terrain, stairs, decks, interiors).
     Left stick click: run. Right stick: 30 degree snap turn. Trigger: the E action of the prompt on screen (doors, seats, talk).
     B or Y: re-centre the eye height (stand up straight, or sit, and press it). A comfort vignette narrows the view while moving.
   - Rendering: the post pipeline (rays, AO, bloom, the graded tone map pass) does not work per eye, so the scene is drawn straight
     into the headset with the renderer's tone mapping: THREE.CustomToneMapping carries the post pass's own AgX curve and plan_gfx's
     time-of-day grade (shared uniforms), at the post pass's exposure (with plan_gfx's eye adaptation); the post pass's haze is
     approximated by a denser scene fog. Custom ShaderMaterials (sky, clouds, stars, signs) get three's tone map and colour space
     includes while in VR, and materials drawn untone-mapped get tone-mapped, as the post pass did for them; all of it is put back
     on the way out, with three's own program bookkeeping, so the desktop draws every material with the program it used before.
     The XR variants of the programs are compiled behind a dark veil with a progress ring.
   - Performance: a lighter profile from the existing quality tiers (QUAL_DEF): the draw distance, grass and shadow settings of
     "low" (no shadows; with ?vrq=medium the cascaded shadows run at 1024 px and a shorter range), no post pass, fixed
     foveation, a framebuffer scale per device; everything restored on exit. ?vrq=low|medium|high|ultra overrides the tier (default low).
   - Multiplayer: the avatar's position and heading come from the rig (the game's own pushMove), so others see you walk and turn.
   ?vr=0 turns the whole mode off (no button). ?vrvig=0 turns the vignette off. PLAN_VR.errs lists any error (empty in every test). */
(function () {
  "use strict";
  var Q = location.search, UA = navigator.userAgent || "";
  var STANDALONE = /OculusBrowser|Quest|Pico|Wolvic|Android/i.test(UA);
  var qp = function (k) { var m = Q.match(new RegExp("[?&]" + k + "=([^&#]*)")); return m ? decodeURIComponent(m[1]) : null; };
  var VR = window.PLAN_VR = {
    on: false, loop: false, tick: false, parked: false, supported: false, busy: false, session: null, xrRT: null, resized: false,
    errs: [], n: { enters: 0, exits: 0, frames: 0, snaps: 0, uses: 0, patched: 0, compiled: 0, veilMs: 0, recenters: 0 },
    dx: 0, dz: 0, rigYaw: 0, calH: 0, cal: false, eyeH: 1.62, ry: null, standalone: STANDALONE,
    K: { off: /[?&]vr=0\b/.test(Q), vig: !/[?&]vrvig=0\b/.test(Q), tier: qp("vrq"), scale: +qp("vrscale") || (STANDALONE ? 0.85 : 1.0), fov: 1.0,
      csmMap: 1024, csmFar: 320, fogK: 2.6, near: 0.25, deadzone: 0.15, snap: Math.PI / 6, veilMax: 20000, compileMs: 8 },
    head: { x: 0, y: 1.6, z: 0, yawL: 0, ok: false }, org: { x: 0, z: 0 }, rigPos: null, rig: null, saved: null, stats: null
  };
  function note(where, e) { var s = where + ": " + (e && e.message ? e.message : String(e)); if (VR.errs.length < 40) VR.errs.push(s); try { console.warn("[vr] " + s); } catch (x) {} }
  var $id = function (id) { return document.getElementById(id); };
  var G = function (name) { try { return (0, eval)(name); } catch (e) { return undefined; } };   // client.js lexical globals, read when needed

  // ───────── support: the button only shows when the browser can open an immersive VR session ─────────
  function check() {
    var b = $id("vrbtn"); var show = function (ok) { VR.supported = !!ok; if (b) b.style.display = ok ? "" : "none"; };
    if (VR.K.off || !navigator.xr || typeof navigator.xr.isSessionSupported !== "function" || window.isSecureContext === false) { show(false); return; }
    try { navigator.xr.isSessionSupported("immersive-vr").then(show, function (e) { show(false); note("support", e); }); } catch (e) { show(false); note("support", e); }
  }
  VR.check = check;
  function wire() {
    var b = $id("vrbtn"); if (b && !b.__r10) { b.__r10 = true; b.addEventListener("click", function () { VR.enter(); }); }
    var x = $id("vrexit"); if (x && !x.__r10) { x.__r10 = true; x.addEventListener("click", function () { VR.exit(); }); }
    check(); try { if (navigator.xr && navigator.xr.addEventListener) navigator.xr.addEventListener("devicechange", check); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire();

  // ───────── enter / exit ─────────
  VR.enter = function () {
    if (VR.K.off || VR.on || VR.busy) return Promise.resolve(false);
    var R = G("renderer"), P = G("player"); if (!R || !P || !navigator.xr) { try { setStatus("the site is still loading · try VR again in a moment", true); } catch (e) {} return Promise.resolve(false); }
    VR.busy = true;
    // the request comes first, inside the click (browsers want the user's gesture for it)
    return navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "bounded-floor", "layers"] }).then(function (s) {
      return start(s).then(function () { VR.busy = false; return true; }, function (e) { note("start", e); try { s.end(); } catch (x) {} finish(); VR.busy = false; try { setStatus("VR could not start: " + (e && e.message ? e.message : e), true); } catch (x) {} return false; });
    }, function (e) { VR.busy = false; note("request", e); try { setStatus("VR could not start: " + (e && e.message ? e.message : e), true); } catch (x) {} return false; });
  };
  VR.look = function (on) { if (on) { install(); VR.lookTest = true; gradeNow(); return true; } VR.lookTest = false; unpatch(); uninject(); return false; };   // test only
  VR.gradeNow = gradeNow;
  VR.exit = function () { var s = VR.session; if (s) { try { return s.end(); } catch (e) { note("end", e); } } return Promise.resolve(); };

  function start(session) {
    var R = renderer;
    VR.session = session; VR.n.enters++; VR.t0 = performance.now();
    save(); install();
    // the reference space: standing (local-floor) where the device has it, else seated (local); the rig puts the eye at the avatar's either way
    return session.requestReferenceSpace("local-floor").then(function () { return "local-floor"; }, function () { return "local"; }).then(function (space) {
      VR.space = space; profile();
      R.xr.enabled = true; R.xr.cameraAutoUpdate = false; R.xr.setReferenceSpaceType(space);
      try { R.xr.setFramebufferScaleFactor(VR.K.scale); } catch (e) { note("scale", e); }
      R.xr.setFoveation(VR.K.fov);
      VR.loop = true; VR.parked = false;   // client.js frame() stops scheduling itself; the session's frames drive it
      R.setAnimationLoop(xrLoop);          // before the session starts, so three's own window loop stops at sessionstart
      R.xr.addEventListener("sessionend", onEnd);
      return R.xr.setSession(session);
    }).then(function () {
      try { if (session.updateTargetFrameRate && session.supportedFrameRates && session.supportedFrameRates.length) { var fr = Array.prototype.slice.call(session.supportedFrameRates); var want = STANDALONE ? 72 : 90; var best = fr.indexOf(want) >= 0 ? want : fr.reduce(function (a, b) { return Math.abs(b - want) < Math.abs(a - want) ? b : a; }); session.updateTargetFrameRate(best).catch(function () {}); VR.rate = best; } } catch (e) {}
      session.addEventListener("select", onSelect);   // hands (no gamepad): a pinch is the trigger
      VR.cal = false; VR.ry = null; VR.head.ok = false; VR.prev = null; VR.veil = 1; VR.veilT = performance.now(); VR.veilDone = 0; VR.cqDone = 0; VR.cbN = 24; VR.cq = compileList(); VR.cqN = VR.cq.length; VR.cq0 = VR.n.compiled; VR.nrMax = 1; VR.prog = 0; VR.rigYaw = yawNow(); VR.on = true;
      document.body.classList.add("xr"); try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
      try { closeCards(); closeChat(); } catch (e) {}
      stats(true);
    });
  }
  function yawNow() { try { return yaw || 0; } catch (e) { return 0; } }
  function onEnd() { VR.n.exits++; finish(); }
  // after the session ends (or a start that failed half way): everything back, and the client's own frame loop running again
  function finish() {
    var R = renderer; try { R.xr.removeEventListener("sessionend", onEnd); } catch (e) {}
    try { if (VR.session) VR.session.removeEventListener("select", onSelect); } catch (e) {}
    VR.on = false; VR.session = null;
    try { R.setAnimationLoop(null); } catch (e) { note("loop", e); }
    try { restore(); } catch (e) { note("restore", e); }
    VR.loop = false; VR.tick = false; VR.xrRT = null;
    if (VR.parked) { VR.parked = false; requestAnimationFrame(function (t) { var f = window.frame; if (typeof f === "function") f(t); }); }
  }

  // ───────── what VR changes, saved on the way in and put back on the way out ─────────
  function save() {
    var R = renderer, C = camera, q = QUAL, S = {};
    S.level = q.level; S.q = q.q; S.dyn = q.dyn; S.dynAcc = q.dynAcc; S.dynN = q.dynN; S.slowAcc = q.slowAcc; S.slowN = q.slowN;
    var CAMo = G("CAM"); S.cam = CAMo ? { pr: CAMo.pr, prBad: CAMo.prBad, prBadAt: CAMo.prBadAt, prS: CAMo.prS ? CAMo.prS.slice() : null, prLast: CAMo.prLast } : null;
    S.pr = R.getPixelRatio(); S.size = R.getSize(new THREE.Vector2()); S.tm = R.toneMapping; S.tme = R.toneMappingExposure; S.rt = R.getRenderTarget();
    S.near = C.near; S.far = C.far; S.fov = C.fov; S.aspect = C.aspect; S.zoom = C.zoom;
    try { S.sunCast = sun.castShadow; S.sunMap = sun.shadow.mapSize.x; } catch (e) {}
    var X = G("CSMX"); if (X && X.csm) S.csm = { far: X.far, lastFar: X.lastFar, maxFar: X.csm.maxFar, maps: X.csm.lights.map(function (l) { return l.shadow.mapSize.x; }) };
    var P = player, u = P.userData; S.walkVis = u.walk ? u.walk.visible : true; S.labelVis = u.label ? u.label.visible : true; S.fpv = !!G("FPV");
    S.keysSR = !!keys.ShiftRight;
    try { S.ranges = INSTSET.map(function (I) { return I.R; }); } catch (e) { S.ranges = null; }
    try { S.grass = NEAR && NEAR.grass ? NEAR.grass.visible : null; } catch (e) { S.grass = null; }
    // three's program bookkeeping of every material on screen: put back on exit, so the desktop draws each material with exactly
    // the program it used before (a re-evaluation would give some materials a new, equivalent program and a compile: plan_gfx's
    // clouds were compiled where no light was counted, and a version bump makes them compile again with the scene's lights)
    S.mp = new Map(); S.sm0 = R.shadowMap.enabled; try { var PRp = R.properties; scene.traverse(function (o) { var ms = o.material; if (!ms) return; if (!Array.isArray(ms)) ms = [ms]; for (var i = 0; i < ms.length; i++) { var m = ms[i]; if (!m || S.mp.has(m) || !PRp.has(m)) continue; var mp = PRp.get(m); if (mp.currentProgram) S.mp.set(m, { sig: msig(m), snap: Object.assign({}, mp) }); } }); } catch (e) { note("snapshot", e); S.mp = null; }
    S.blobs = []; try { scene.traverse(function (o) { var b = o.userData && o.userData.blob; if (b) S.blobs.push([b, b.visible]); }); } catch (e) {}   // the tier switch sets every blob shadow to its default
    VR.saved = S;
  }
  function vrTier() { var t = VR.K.tier; if (t && QUAL_DEF[t]) return t; return "low"; }   // measured: low holds the most frames on PC and on a headset (see HANDOFF_R10_VR); ?vrq=medium adds shadows
  // the VR profile: one of the game's own tiers (draw distance, grass, shadows) through the game's own tier switch; the boot's
  // shadow mode stays (cascades are fixed per boot), at 1024 px per cascade and a shorter range
  function profile() {
    var S = VR.saved, t = vrTier(); VR.tierUsed = t;
    try { if (QUAL.level !== t) applyQuality(t, true); } catch (e) { note("tier", e); }
    try { if (S.q && S.q.csm) QUAL.q = Object.assign({}, QUAL.q, { csm: S.q.csm, csmFar: S.q.csmFar }); } catch (e) {}   // the cascaded tiers' "every lit surface casts" rule stays for things added meanwhile
    var X = G("CSMX"); if (X && X.csm && renderer.shadowMap.enabled) { X.far = Math.min(X.far, VR.K.csmFar); X.lastFar = -1; X.csm.lights.forEach(function (l) { if (l.shadow.mapSize.x !== VR.K.csmMap) { l.shadow.mapSize.set(VR.K.csmMap, VR.K.csmMap); if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; } } l.shadow.needsUpdate = true; }); renderer.shadowMap.needsUpdate = true; }
    camera.near = VR.K.near; camera.updateProjectionMatrix();
    eyeMeasure();
  }
  function restore() {
    var R = renderer, S = VR.saved; if (!S) return; VR.saved = null;
    var patched = unpatch(); uninject(); if (VIG.mesh && VIG.mesh.parent) VIG.mesh.parent.remove(VIG.mesh);
    R.xr.enabled = false; R.xr.cameraAutoUpdate = true;
    try { if (QUAL.level !== S.level) applyQuality(S.level, true); } catch (e) { note("tier back", e); }
    try { if (S.ranges) INSTSET.forEach(function (I, i) { if (S.ranges[i] !== undefined) I.R = S.ranges[i]; }); if (S.grass !== null && NEAR && NEAR.grass) NEAR.grass.visible = S.grass; } catch (e) {}
    for (var bi = 0; bi < S.blobs.length; bi++) S.blobs[bi][0].visible = S.blobs[bi][1];
    QUAL.q = S.q; QUAL.dyn = S.dyn; QUAL.dynAcc = S.dynAcc; QUAL.dynN = S.dynN; QUAL.slowAcc = S.slowAcc; QUAL.slowN = S.slowN;
    var CAMo = G("CAM"); if (CAMo && S.cam) { CAMo.pr = S.cam.pr; CAMo.prBad = S.cam.prBad; CAMo.prBadAt = S.cam.prBadAt; if (S.cam.prS && CAMo.prS) { CAMo.prS.length = 0; Array.prototype.push.apply(CAMo.prS, S.cam.prS); } CAMo.prLast = 0; CAMo.snap = 2; CAMo.init = false; CAMo.fpvInit = false; }
    try { sun.castShadow = S.sunCast; if (sun.shadow.mapSize.x !== S.sunMap) { sun.shadow.mapSize.set(S.sunMap, S.sunMap); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } } sun.shadow.needsUpdate = true; } catch (e) {}
    var X = G("CSMX"); if (X && X.csm && S.csm) { X.far = S.csm.far; X.lastFar = -1; X.csm.lights.forEach(function (l, i) { var m = S.csm.maps[i]; if (l.shadow.mapSize.x !== m) { l.shadow.mapSize.set(m, m); if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; } } l.shadow.needsUpdate = true; }); }   // every cascade redrawn in the first frame back (the turns would leave a new map empty for up to 6 frames)
    R.shadowMap.needsUpdate = true;
    if (R.getPixelRatio() !== S.pr) R.setPixelRatio(S.pr);
    var sz = R.getSize(new THREE.Vector2()); if (VR.resized || sz.x !== S.size.x || sz.y !== S.size.y) { VR.resized = false; try { resize(); } catch (e) { note("resize", e); } }
    try { var el = R.domElement; if (POST.rt && POST.resize && (POST.rt.width !== el.width || POST.rt.height !== el.height)) POST.resize(); } catch (e) { note("post size", e); }
    R.toneMapping = S.tm; R.toneMappingExposure = S.tme; try { R.setRenderTarget(S.rt); } catch (e) {}
    // the programs: a material whose program-relevant fields (maps, flags, defines, shader source, cache key) are as they were gets
    // its pre-VR bookkeeping back, so no desktop program is re-chosen or compiled; a material changed meanwhile goes the normal way
    if (S.mp && S.sm0 === R.shadowMap.enabled) { var PRr = R.properties, ok = 0, skip = 0;
      S.mp.forEach(function (rec, m) { try { if (!PRr.has(m)) { skip++; return; } var mp = PRr.get(m); if (mp.programs !== rec.snap.programs || msig(m) !== rec.sig) { skip++; return; } var v = m.version; Object.assign(mp, rec.snap); mp.__version = v; mp.uniformsList = null; ok++; } catch (e) { skip++; } });
      VR.n.mpBack = ok; VR.n.mpSkip = skip; S.mp = null; }
    var C = camera; C.near = S.near; C.far = S.far; C.fov = S.fov; C.aspect = S.aspect; C.zoom = S.zoom; C.scale.set(1, 1, 1); C.updateProjectionMatrix(); C.updateMatrixWorld(true);
    var u = player.userData; if (u.walk) u.walk.visible = S.walkVis; if (u.label) u.label.visible = S.labelVis; if (u.bubble) u.bubble.visible = true;
    keys.ShiftRight = S.keysSR; var J = G("joy"); if (J && J.id === null) { J.active = false; J.dx = 0; J.dy = 0; }
    VR.dx = VR.dz = 0; document.body.classList.remove("xr");
    try { if (CSMX.csm) CSMX.fov = -1; } catch (e) {}   // the cascades' frustums follow the restored camera at the next frame
  }

  // ───────── the renderer while presenting: other passes keep their own cameras and targets ─────────
  function install() {
    var R = renderer; VIG.init();
    if (!R.__r10) {
      R.__r10 = true; var r0 = R.render, s0 = R.setRenderTarget, b0 = R.renderBufferDirect, MAIN = scene;
      // a pass that ends with setRenderTarget(null) means "back to the screen": in VR the screen is the headset's framebuffer
      R.setRenderTarget = function (rt, face, mip) { if (rt === null && VR.on && VR.xrRT && this.xr.isPresenting) rt = VR.xrRT; return s0.call(this, rt, face, mip); };
      // only the main scene into the headset's framebuffer uses the XR eye cameras; probes, reflections, telescopes, the warm-up
      // target and shadow-free previews render with their own camera, as on the desktop
      R.render = function (sc) { if (!VR.on || !this.xr.isPresenting || (sc === MAIN && this.getRenderTarget() === VR.xrRT)) return r0.apply(this, arguments); var x = this.xr.enabled; this.xr.enabled = false; try { return r0.apply(this, arguments); } finally { this.xr.enabled = x; } };
      var PRb = R.properties;
      R.renderBufferDirect = function (cam, sc, geo, mat) { if ((VR.on || VR.lookTest) && mat && sc !== null) { var rt = this.getRenderTarget(); if (VR.on ? rt === VR.xrRT : rt === null) { if (!PATCHED.has(mat)) patch(mat); inject(PRb.get(mat)); } } return b0.apply(this, arguments); };
    }
    if (!THREE.ShaderChunk.__r10) { var ch = THREE.ShaderChunk.tonemapping_pars_fragment, old = "vec3 CustomToneMapping( vec3 color ) { return color; }"; if (ch.indexOf(old) >= 0) { THREE.ShaderChunk.tonemapping_pars_fragment = ch.replace(old, TONEMAP); THREE.ShaderChunk.__r10 = true; } else note("tonemap", "three's custom tone mapping chunk changed"); }
    VR.rig = VR.rig || new THREE.Object3D(); VR.rigPos = VR.rigPos || new THREE.Vector3();
  }
  // the post pass's tone map and grade (client.js mFinal's AgX curve with plan_gfx's time-of-day grade: gfxGrade outside the sky), as
  // three's custom tone mapping. The grade comes in through shared uniforms added to each material's uniforms at its first XR draw.
  var U10 = { r10Sat: { value: 1.18 }, r10SatLo: { value: 1.18 }, r10Con: { value: 1.1 }, r10Lift: { value: 0 }, r10Sh: { value: new THREE.Vector3(0.9, 0.96, 1.12) }, r10Hi: { value: new THREE.Vector3(1.08, 1.0, 0.9) }, r10WB: { value: new THREE.Vector3(1, 1, 1) } };
  var U10K = Object.keys(U10), UOBJ = new Set();
  function gradeNow() { var g = null; try { g = window.PLAN_GFX && PLAN_GFX.grade; } catch (e) {} if (!g || !g[2]) return; U10.r10Sat.value = g[0]; U10.r10SatLo.value = g[6] === undefined ? g[0] : g[6]; U10.r10Con.value = g[1]; U10.r10Sh.value.fromArray(g[2]); U10.r10Hi.value.fromArray(g[3]); U10.r10WB.value.fromArray(g[4]); U10.r10Lift.value = g[5] || 0; }
  function inject(mp) { var u = mp.uniforms; if (!u || u.r10Sat === U10.r10Sat) return; for (var i = 0; i < U10K.length; i++) u[U10K[i]] = U10[U10K[i]]; UOBJ.add(u); mp.uniformsList = null; }
  function uninject() { UOBJ.forEach(function (u) { for (var i = 0; i < U10K.length; i++) if (u[U10K[i]] === U10[U10K[i]]) delete u[U10K[i]]; }); UOBJ.clear(); }
  var TONEMAP = [
    "uniform float r10Sat; uniform float r10SatLo; uniform float r10Con; uniform float r10Lift; uniform vec3 r10Sh; uniform vec3 r10Hi; uniform vec3 r10WB;",
    "vec3 CustomToneMapping( vec3 color ) {",
    "  const mat3 inset = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);",
    "  const mat3 outset = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);",
    "  vec3 v = inset * max(min(color, vec3(6.0e4)) * toneMappingExposure * 1.05, 0.0); v = clamp(log2(max(v, 1e-10)), -12.47393, 4.026069); v = (v + 12.47393) / (4.026069 + 12.47393);",
    "  vec3 x2 = v * v, x4 = x2 * x2; v = 15.5 * x4 * x2 - 40.14 * x4 * v + 31.96 * x4 - 6.868 * x2 * v + 0.4298 * x2 + 0.1191 * v - 0.00232; v = outset * v; vec3 c = pow(max(v, 0.0), vec3(2.2));",
    "  c *= r10WB; float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, mix(r10SatLo, r10Sat, smoothstep(0.06, 0.4, l))); c = (c - 0.5) * r10Con + 0.5; l = clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);",
    "  c = mix(c * r10Sh, c * r10Hi, smoothstep(0.12, 0.82, l)); c += r10Lift * (1.0 - c); return max(c, 0.0);",
    "}"].join("\n");

  // what selects a material's program, apart from the renderer's state: equal on the way out means its old program is still the right one
  function tid(t) { return t ? t.uuid + "/" + t.format + "/" + t.type + "/" + t.colorSpace + "/" + (t.isCompressedTexture ? 1 : 0) + (t.isCubeTexture ? 1 : 0) + (t.isDataArrayTexture ? 1 : 0) : ""; }
  function msig(m) { var k = [m.type, m.transparent, m.alphaTest, m.side, m.vertexColors, m.flatShading, m.toneMapped, m.fog, m.wireframe, m.dithering, m.premultipliedAlpha, m.alphaHash, m.alphaToCoverage, m.clipping, m.depthPacking, m.combine, m.lights, m.glslVersion,
      tid(m.map), tid(m.normalMap), tid(m.emissiveMap), tid(m.roughnessMap), tid(m.metalnessMap), tid(m.aoMap), tid(m.alphaMap), tid(m.envMap), tid(m.lightMap), tid(m.displacementMap), tid(m.bumpMap), tid(m.specularMap), tid(m.clearcoatMap), tid(m.sheenColorMap), tid(m.transmissionMap), tid(m.iridescenceMap), tid(m.anisotropyMap), tid(m.gradientMap), tid(m.matcap),
      m.normalMapType, m.clearcoat > 0, m.sheen > 0, m.transmission > 0, m.iridescence > 0, m.anisotropy > 0, m.dispersion > 0, m.envMapRotation ? 1 : 0, JSON.stringify(m.defines || null), JSON.stringify(m.extensions || null), m.vertexShader || "", m.fragmentShader || "",
      m.onBeforeCompile ? String(m.onBeforeCompile).length : 0]; try { k.push(m.customProgramCacheKey ? m.customProgramCacheKey() : ""); } catch (e) {} return k.join("|"); }
  // custom shaders written for the linear post target get three's tone map and colour space includes (no-ops there) while in VR;
  // materials the post pass tone-mapped although they are not toneMapped get tone-mapped. Both are put back on exit.
  var PATCHED = new Map();
  function patch(m) {
    var rec = null;
    try {
      if (m.userData && m.userData.r10skip) { PATCHED.set(m, null); return; }
      if (m.isShaderMaterial === true && m.isRawShaderMaterial !== true && m.glslVersion !== THREE.GLSL3 && typeof m.fragmentShader === "string") {
        var f = m.fragmentShader, nc = f.indexOf("colorspace_fragment") < 0, nt = f.indexOf("tonemapping_fragment") < 0, k = f.lastIndexOf("}");
        if ((nc || nt) && k > 0 && /void\s+main\s*\(/.test(f)) { rec = { f: f }; m.fragmentShader = f.slice(0, k) + (nt ? "\n#include <tonemapping_fragment>" : "") + (nc ? "\n#include <colorspace_fragment>" : "") + "\n" + f.slice(k); }
      }
      if (m.toneMapped === false) { rec = rec || {}; rec.tm = true; m.toneMapped = true; }
      if (rec) { m.needsUpdate = true; VR.n.patched++; }
    } catch (e) { note("patch", e); }
    PATCHED.set(m, rec);
  }
  function unpatch() { var done = new Set(); PATCHED.forEach(function (rec, m) { if (!rec) return; try { if (rec.f !== undefined) m.fragmentShader = rec.f; if (rec.tm) m.toneMapped = false; m.needsUpdate = true; done.add(m); } catch (e) {} }); PATCHED.clear(); return done; }
  // behind the veil: the main scene's materials patched and compiled for the headset's target, a few top-level objects a frame
  function compileList() { var L = []; try { var ch = scene.children; for (var i = 0; i < ch.length; i++) L.push(ch[i]); } catch (e) {} return L; }
  // a batch of top-level objects is compiled in one call (three gathers the scene's lights once per call; the batch adds none)
  var CB = null;
  function patchTree(o) { o.traverse(function (q) { var mt = q.material; if (!mt) return; if (Array.isArray(mt)) { for (var i = 0; i < mt.length; i++) if (!PATCHED.has(mt[i])) patch(mt[i]); } else if (!PATCHED.has(mt)) patch(mt); }); }
  function compileStep() {
    var L = VR.cq; if (!L || !L.length) return; var R = renderer, t0 = performance.now();
    if (!CB) { CB = new THREE.Object3D(); CB.list = []; CB.traverse = function (fn) { for (var i = 0; i < this.list.length; i++) this.list[i].traverse(fn); }; CB.traverseVisible = function () {}; }
    var n = VR.cbN || 24; CB.list.length = 0;
    while (L.length && CB.list.length < n) { var o = L.shift(); if (o && o.parent && o !== VIG.mesh) { try { patchTree(o); } catch (e) {} CB.list.push(o); } }
    try { if (CB.list.length) R.compile(CB, camera, scene); } catch (e) { note("compile", e); }
    var ms = performance.now() - t0; VR.n.compiled += CB.list.length; CB.list.length = 0; VR.cbN = Math.max(4, Math.min(400, Math.round(n * Math.min(2, VR.K.compileMs / Math.max(0.3, ms)))));
    if (!L.length) VR.cqDone = performance.now();
  }
  function notReady() { var n = 0; try { var ps = renderer.info.programs; for (var i = 0; i < ps.length; i++) if (ps[i].isReady && !ps[i].isReady()) n++; } catch (e) {} return n; }

  // ───────── the XR frame: pose, controllers, then the client's own frame ─────────
  var E = null, QH = null;
  function xrLoop(t, f) {
    if (!f || !VR.on) return;   // three's window loop between setAnimationLoop and the session start
    var t0 = performance.now(); VR.tick = true; VR.xrRT = renderer.getRenderTarget(); VR.n.frames++;
    try { pose(f); input(f); compileStep(); veil(); } catch (e) { note("pose", e); }
    try { var F = window.frame; F(t); } catch (e) { note("frame", e); } finally { VR.tick = false; }
    stats(false, t0);
  }
  function pose(f) {
    var ref = renderer.xr.getReferenceSpace(); var vp = ref ? f.getViewerPose(ref) : null; var H = VR.head; if (!vp) { H.ok = false; return; }
    var p = vp.transform.position, o = vp.transform.orientation; if (!E) { E = new THREE.Euler(0, 0, 0, "YXZ"); QH = new THREE.Quaternion(); }
    QH.set(o.x, o.y, o.z, o.w); E.setFromQuaternion(QH, "YXZ"); H.x = p.x; H.y = p.y; H.z = p.z; H.yawL = E.y; H.ok = true;
    if (!VR.cal) { VR.cal = true; VR.calH = p.y; VR.org.x = p.x; VR.org.z = p.z; VR.prev = null; }
    // walking in the room: the head's step since the last frame, in world axes, for the walking code (collision and all)
    var c = Math.cos(VR.rigYaw), s = Math.sin(VR.rigYaw); VR.dx = VR.dz = 0;
    if (VR.prev) { var lx = p.x - VR.prev.x, lz = p.z - VR.prev.z; if (lx * lx + lz * lz < 1) { VR.dx = lx * c + lz * s; VR.dz = -lx * s + lz * c; } } else VR.prev = { x: 0, z: 0 };
    VR.prev.x = p.x; VR.prev.z = p.z;
    try { yaw = VR.rigYaw + H.yawL; } catch (e) {}   // the game's view heading is the head's: the walk is relative to where you look, and pushMove sends it
  }
  var IN = { run: false, still: 0, snapArm: true, trig: false, btn: false, prompt: false };
  function axes(gp) { var a = gp.axes || []; return a.length >= 4 ? [a[2], a[3]] : [a[0] || 0, a[1] || 0]; }
  function btn(gp, i) { var b = gp.buttons && gp.buttons[i]; return !!(b && (b.pressed || b.value > 0.6)); }
  function input(f) {
    var src = f.session.inputSources, L = null, Rr = null, J = joy, trig = false, b = false, lclick = false;
    for (var i = 0; i < src.length; i++) { var s = src[i], gp = s.gamepad; if (!gp) continue; if (s.handedness === "left") L = gp; else if (s.handedness === "right") Rr = gp; else if (!L) L = gp; if (btn(gp, 0)) trig = true; if (btn(gp, 5)) b = true; }
    var dz = VR.K.deadzone, mag = 0;
    if (L) { var a = axes(L), x = a[0] || 0, y = a[1] || 0; mag = Math.hypot(x, y); lclick = btn(L, 3);
      if (mag > dz) { var k = Math.min(1, (mag - dz) / (1 - dz)) / mag; J.active = true; J.dx = x * k; J.dy = y * k; } else if (J.id === null || J.id === undefined) { J.active = false; J.dx = 0; J.dy = 0; } }
    else if (J.id === null || J.id === undefined) { J.active = false; J.dx = 0; J.dy = 0; }
    // run: a click of the left stick, until the stick rests
    if (lclick && !IN.lc) { IN.run = !IN.run; IN.still = 0; } IN.lc = lclick; if (mag < dz) { IN.still += 1; if (IN.still > 45) IN.run = false; } else IN.still = 0;   // about 0.5 s at rest ends the run
    keys.ShiftRight = IN.run && mag > dz;
    // snap turn on the right stick
    if (Rr) { var ra = axes(Rr), rx = ra[0] || 0; if (Math.abs(rx) < 0.35) IN.snapArm = true; else if (IN.snapArm && Math.abs(rx) > 0.75) { IN.snapArm = false; VR.rigYaw += rx > 0 ? -VR.K.snap : VR.K.snap; VR.n.snaps++; try { yaw = VR.rigYaw + VR.head.yawL; } catch (e) {} } }
    if (trig && !IN.trig) use(); IN.trig = trig;
    if (b && !IN.btn) { VR.cal = false; VR.n.recenters++; pulse(0.3, 30); } IN.btn = b;
    // a short buzz when an E action becomes available (the prompt itself is on the 2D HUD, which the headset cannot show)
    var pr = $id("prompt"), on = !!(pr && pr.classList.contains("on") && promptE()); if (on && !IN.prompt) pulse(0.18, 22); IN.prompt = on;
  }
  function promptE() { var t = $id("prompt-t"); return !!(t && t.innerHTML.indexOf("<b>E</b>") >= 0); }
  function use() {
    var pr = $id("prompt"); if (!pr || !pr.classList.contains("on") || !promptE()) return false;
    var o = { code: "KeyE", key: "e", bubbles: true }; document.dispatchEvent(new KeyboardEvent("keydown", o)); document.dispatchEvent(new KeyboardEvent("keyup", o));
    VR.n.uses++; pulse(0.45, 40);
    setTimeout(function () { try { if (document.querySelector(".card.on")) closeCards(); } catch (e) {} }, 0);   // an info card cannot be read in the headset
    return true;
  }
  function onSelect(ev) { try { if (ev && ev.inputSource && !ev.inputSource.gamepad) use(); } catch (e) {} }
  function pulse(v, ms) { try { var s = VR.session; if (!s) return; for (var i = 0; i < s.inputSources.length; i++) { var gp = s.inputSources[i].gamepad, h = gp && gp.hapticActuators && gp.hapticActuators[0]; if (h && h.pulse) h.pulse(v, ms); } } catch (e) {} }

  // ───────── the rig (called by client.js frame() after the game has placed its own camera) ─────────
  function eyeMeasure() {
    var u = player.userData, h = null, P = player.position;
    try { if (u.walk) { u.walk.updateMatrixWorld(true); var v = new THREE.Vector3(); u.walk.traverse(function (o) { if (h === null && o.isBone && o.name === "Head") { o.getWorldPosition(v); h = v.y - P.y + 0.1; } }); } } catch (e) {}
    VR.eyeH = h !== null && h > 1.2 && h < 2.1 ? h : 1.62 * (u.hf || 1);
  }
  function seated() { try { return !!(SIT.on || cartMode || RIDE_ON.id || riding || SITES.ride || SITES.park); } catch (e) { return false; } }
  function freeHead() { try { return seated() || !!(SITES.bride || RIDE.on || golf.playing || arcFrozen()); } catch (e) { return false; } }
  function eyeFor() { try { if (SIT.on) return 0.8; if (seated()) return 1.3; } catch (e) {} return VR.eyeH; }
  VR.camera = function (dt, planCam) {
    if (!VR.on) return;
    try {
      var H = VR.head, c = Math.cos(VR.rigYaw), s = Math.sin(VR.rigYaw), F = FLY, cam = !!(planCam || (F && F.on) || towerView);
      VR.mode = cam ? "cam" : "player";
      if (!cam && !freeHead()) { VR.org.x = H.x; VR.org.z = H.z; }   // walking: the head is always over the player
      var ox = VR.org.x, oz = VR.org.z;
      if (!cam) {
        var ty = player.position.y - (bobY || 0) + eyeFor() - VR.calH;
        if (VR.ry === null || Math.abs(ty - VR.ry) > 2.5) VR.ry = ty; else VR.ry += (ty - VR.ry) * (1 - Math.exp(-dt * 18));   // steps and decks ease in over a few frames
        VR.rigPos.set(player.position.x - (ox * c + oz * s), VR.ry, player.position.z - (-ox * s + oz * c));
        bodyFollow(dt);
      } else {   // the fly-in cabin, the tower view, a module's own camera: the head sits where the game put its camera
        var a = camera.position; VR.rigPos.set(a.x - (ox * c + oz * s), a.y - VR.calH, a.z - (-ox * s + oz * c)); VR.ry = null;
      }
      xrCam(); vigFrame(dt);
    } catch (e) { note("camera", e); }
  };
  function bodyFollow(dt) {   // standing still, the body turns after the head once it is more than about 35 degrees off
    try { if (riding || cartMode || SIT.on || RIDE_ON.id || golf.playing) return; if (Math.hypot(mv.x, mv.z) > 0.4) { VR.turning = false; return; }
      var want = yaw + Math.PI, d = Math.atan2(Math.sin(want - player.rotation.y), Math.cos(want - player.rotation.y)); if (Math.abs(d) > 0.6) VR.turning = true;
      if (VR.turning) { player.rotation.y += d * Math.min(1, dt * 5); if (Math.abs(d) < 0.05) VR.turning = false; } } catch (e) {}
  }
  function xrCam() {
    var R = renderer, rig = VR.rig; rig.position.copy(VR.rigPos); rig.rotation.set(0, VR.rigYaw, 0); rig.updateMatrixWorld(true);
    var p0 = camera.parent; camera.parent = rig; try { R.xr.updateCamera(camera); } finally { camera.parent = p0; }
    var cx = R.xr.getCamera(); cx.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale); camera.scale.set(1, 1, 1); camera.updateMatrixWorld(true);
    var cs = cx.cameras; for (var i = 0; i < cs.length; i++) cs[i].r10eye = true;   // plan_perf's sub-pixel filter treats the eyes as the main view
  }
  // the render (client.js renderFrame, inside plan_perf's and plan_gfx's wrappers: the light pool, the spares and the sky still run)
  VR.render = function () {
    var R = renderer, fog = scene.fog, d0 = fog ? fog.density : 0, tm = R.toneMapping, tme = R.toneMappingExposure;
    try {
      if (VR.mode !== "cam") hideSelf();
      if (fog && fog.isFogExp2) fog.density = d0 * VR.K.fogK;   // the post pass's aerial haze and height fog, approximated by the scene fog
      R.toneMapping = THREE.CustomToneMapping; gradeNow(); if (typeof POST !== "undefined" && POST.exposure > 0) R.toneMappingExposure = POST.exposure;   // plan_gfx's eye adaptation, interiors and flashes act on the post exposure
      if (VR.xrRT) R.setRenderTarget(VR.xrRT);
      xrCam(); R.render(scene, camera);
    } catch (e) { note("render", e); } finally { R.toneMapping = tm; R.toneMappingExposure = tme; if (fog && fog.isFogExp2) fog.density = d0; }
  };
  function hideSelf() { var u = player.userData; if (u.walk && u.walk.visible) u.walk.visible = false; if (u.label && u.label.visible) u.label.visible = false; if (u.bubble && u.bubble.visible) u.bubble.visible = false; }

  // ───────── comfort vignette and the loading veil: one inverted sphere around the head, drawn last ─────────
  var VIG = { mesh: null, k: 0, init: function () {
    if (VIG.mesh) return;
    var m = new THREE.ShaderMaterial({ uniforms: { uVig: { value: 0 }, uVeil: { value: 1 }, uProg: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide, fog: false, toneMapped: false,
      vertexShader: "varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      // the loading veil carries a thin ring straight ahead that fills as the headset's shaders compile (Giveback green)
      fragmentShader: "uniform float uVig; uniform float uVeil; uniform float uProg; varying vec3 vD; void main(){ vec3 d = normalize(vD); float ang = degrees(acos(clamp(-d.z, -1.0, 1.0))); float r0 = mix(64.0, 30.0, uVig); float a = smoothstep(r0, r0 + 22.0, ang) * min(1.0, uVig * 1.5); a = max(a, uVeil); vec3 c = vec3(0.018, 0.035, 0.026);" +
        " float ring = (1.0 - smoothstep(0.12, 0.3, abs(ang - 3.2))) * step(0.02, uVeil); float f = fract(atan(d.x, d.y) / 6.2831853 + 1.0); float on = step(f, uProg); c = mix(c, mix(vec3(0.12, 0.2, 0.15), vec3(0.302, 0.871, 0.435), on), ring * min(1.0, uVeil * 1.4)); gl_FragColor = vec4(c, a); }" });
    m.userData.r10skip = true;
    var g = new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 16), m); g.name = "r10 vignette"; g.frustumCulled = false; g.renderOrder = 1e9; g.userData.noBatch = true; g.userData.noShadow = true; g.castShadow = false; g.receiveShadow = false; g.layers.mask = 6;   /* three's left and right eye layers: no probe, reflection or warm-up camera sees it */
    g.onBeforeRender = function () {};   // never merged by plan_perf's static batches
    VIG.mesh = g;
  } };
  function vigFrame(dt) {
    var g = VIG.mesh; if (!g) return; if (!g.parent) scene.add(g);
    var sp = 0; try { sp = cartMode ? Math.abs(cartSpeed) / 10 : Math.hypot(mv.x, mv.z) / 4.6; if (riding) sp = Math.abs(vSpeed || 0) / 12; } catch (e) {}
    var want = VR.K.vig ? Math.min(1, sp) : 0; VIG.k += (want - VIG.k) * (1 - Math.exp(-dt * (want > VIG.k ? 6 : 3)));
    var u = g.material.uniforms; u.uVig.value = VIG.k; u.uVeil.value = VR.veil || 0; u.uProg.value = VR.prog || 0;
    g.visible = VIG.k > 0.01 || (VR.veil || 0) > 0.003; g.position.copy(camera.position); g.quaternion.copy(camera.quaternion); g.updateMatrixWorld(true);
  }
  function veil() {   // dark until the headset's programs are compiled (then everything visible has been drawn once behind it), at most 20 s
    if (!(VR.veil > 0)) return; var el = performance.now() - VR.veilT;
    if (!VR.veilDone) { if ((VR.n.frames % 6) === 0) { VR.nr = notReady(); VR.nrMax = Math.max(VR.nrMax || 1, VR.nr); } var done = !VR.cq || !VR.cq.length, tail = done && VR.cqDone ? performance.now() - VR.cqDone : 0;
      VR.prog = done ? 0.35 + 0.65 * (1 - (VR.nr || 0) / (VR.nrMax || 1)) : 0.35 * (VR.n.compiled - (VR.cq0 || 0)) / Math.max(1, VR.cqN || 1);
      if ((done && el > 600 && (VR.nr === 0 || tail > 4000)) || el > VR.K.veilMax) { VR.veilDone = performance.now(); VR.n.veilMs = Math.round(el); VR.n.veilPending = VR.nr; VR.n.compileMs = VR.cqDone ? Math.round(VR.cqDone - VR.veilT) : null; } return; }
    VR.veil = Math.max(0, 1 - (performance.now() - VR.veilDone) / 700); if (VR.veil === 0) VR.veilDone = 0;
  }

  // ───────── frame timing in VR (the overlay cannot show in the headset: PLAN_VR.stats() in the console, or the harness) ─────────
  function stats(reset, t0) {
    if (reset || !VR.st) VR.st = { iv: [], js: [], last: 0 }; if (reset) return; var S = VR.st, now = performance.now();
    if (S.last) { S.iv.push(now - S.last); if (S.iv.length > 3000) S.iv.shift(); } S.last = now; if (t0) { S.js.push(now - t0); if (S.js.length > 3000) S.js.shift(); }
  }
  VR.stats = function (clear) {
    var S = VR.st || { iv: [], js: [] }; var pc = function (a, p) { if (!a.length) return 0; var b = a.slice().sort(function (x, y) { return x - y; }); return +b[Math.min(b.length - 1, Math.floor(p * b.length))].toFixed(2); };
    var mean = function (a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? +(s / a.length).toFixed(2) : 0; };
    var r = { frames: S.iv.length, interval: { mean: mean(S.iv), p50: pc(S.iv, 0.5), p95: pc(S.iv, 0.95), p99: pc(S.iv, 0.99), max: pc(S.iv, 1) }, js: { mean: mean(S.js), p50: pc(S.js, 0.5), p95: pc(S.js, 0.95), p99: pc(S.js, 0.99), max: pc(S.js, 1) },
      tier: VR.tierUsed, space: VR.space, rate: VR.rate || null, scale: VR.K.scale };
    if (clear) { S.iv.length = 0; S.js.length = 0; S.last = 0; } return r;
  };
})();
