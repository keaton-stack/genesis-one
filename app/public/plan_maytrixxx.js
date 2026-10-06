// R18 MX: Maytrixxx, a rigged real-person likeness in the Lobby of the Genesis Block Museum (plan_chainmuseum.js).
// plan_maytrixxx.js (R18, 6 Oct 2026): she stands in the Lobby's west corner by the door to Gallery 1, off the entrance flow,
// turns to face you as you come in, greets you, talks with her hands and, press E, "enlightens" you in a short talk card
// on breaking the matrix: new forms of love, impact and currency, and how the museum's story of record keeping leads to
// the on-chain giving ledger. Two pages run a one-off green code rain around her, two an open-palms gesture.
// Data (placement, ranges, every line of dialogue): app/public/plan/maytrixxx.json (editable, no code change).
// Models: models/mx_maytrixxx.glb (+ models_m/, models/lod/), clips models/mx_maytrixxx_anim.glb (idle with a weight
// shift, talk, greet, offer). Self-contained: nothing in any other file is changed; the museum is read through
// window.PLAN_CHAINMUSEUM (site, api.l2w), the talk card through the client's showTalk / updateZone (wrapped by bare
// name, as plan_aaron.js does) and the R16 character lighting through PLAN_CHARFX.patch (its glTF rig list is
// closure-local, so this module repeats its rig step for her: CSM material, body regions, rig uniforms).
// Performance: no lights (the code rain is one additive basic material, drawn only during the effect), frustum culling on,
// hidden past 70 m and inside interiors, far LOD past 24 m, mixer throttled by distance, all of it warmed through
// PLAN_PERF.warmGroup behind the loading screen. ?mx=0 turns the module off.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var MX = window.PLAN_MAYTRIXXX = window.PLAN_MAYTRIXXX || {};
  MX.v = "r18-mx-1"; MX.errs = MX.errs || []; MX.n = MX.n || {};
  if (/[?&]mx=0\b/.test(location.search)) { MX.off = true; return; }
  var nWarn = 0;
  function note(where, e) { if (MX.errs.length < 30) MX.errs.push(where + ": " + (e && e.message ? e.message : e)); if (++nWarn <= 20) try { console.warn("plan_maytrixxx " + where, e); } catch (x) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function now() { return performance.now(); }
  var TAU = Math.PI * 2;
  function wrapA(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
  function pick(list) { return list && list.length ? list[Math.floor(Math.random() * list.length)] : ""; }

  // ───────────────────────── data (plan/maytrixxx.json; these defaults only cover a failed fetch) ─────────────────────────
  var DEF = {
    spot: { lx: 50.35, lz: 0.55, face: 0.62 },
    files: { body: "/models/mx_maytrixxx.glb", body_m: "/models_m/mx_maytrixxx.glb", lod: "/models/lod/mx_maytrixxx.glb", anim: "/models/mx_maytrixxx_anim.glb" },
    range: { show: 70, lod: 24, greet: 7, leave: 12, label: 16, look: 8 },
    id: "mx_maytrixxx", name: "Maytrixxx", role: "Giveback · your guide out of the old code", prompt: "talk to Maytrixxx · take the red pill",
    greet: ["Welcome to the real world. Well, almost."], ambient: ["Follow the green light."], bye: ["Take the green light with you."],
    talk: [{ t: "There you are. I'm Maytrixxx.", o: [["Thanks, Maytrixxx", null]] }],
    progress: { stamp_talk: "p_mx_awake" }
  };
  var D = DEF;
  function cfg(k) { return (D && D[k] !== undefined) ? D[k] : DEF[k]; }
  MX.dataP = fetch((window.AV || String)("/plan/maytrixxx.json?v=" + (window.BUILD || "dev"))).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.talk && j.talk.length) { D = j; MX.data = j; refreshTalk(); } }).catch(function (e) { note("data", e); });

  var V1 = new THREE.Vector3(), Q1 = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  var CH = MX.ch = null;
  function cm() { var C = window.PLAN_CHAINMUSEUM; return C && !C.off && C.site && C.site.G !== null && C.site.G !== undefined && C.api && C.api.l2w ? C : null; }

  // ───────────────────────── placement (the museum's local frame: x along the chain, z toward the plaza) ─────────────────────────
  function where() { var C = cm(); if (!C) return null; var sp = cfg("spot"), w = C.api.l2w(sp.lx, sp.lz); return { x: w[0], z: w[1], y: C.site.G + 0.02, yaw: sp.face + C.site.th }; }
  function makeChar() {
    if (CH) return CH; var W = where(); if (!W) return null;
    var root = new THREE.Group(); root.name = "mx maytrixxx"; root.position.set(W.x, W.y, W.z); root.rotation.y = W.yaw; root.visible = false; scene.add(root);
    var c = CH = MX.ch = { root: root, home: W, yaw: W.yaw, rig: null, lod: null, acts: {}, lacts: {}, cur: null, one: null, state: "idle", t: 0, next: 18, greeted: false, look: 0, lookYaw: 0, bubT: 0, dc: 999 };
    var T = window.PLAN_TALK = window.PLAN_TALK || {};
    c.T = T[cfg("id")] = { id: cfg("id"), name: cfg("name"), role: cfg("role"), talk: cfg("talk"), greet: cfg("greet") || [], kw: [], g: root, mx: 1 };
    var fx = Math.sin(W.yaw), fz = Math.cos(W.yaw);
    c.hs = { x: W.x + fx * 0.9, z: W.z + fz * 0.9, r: 2.8, t: cfg("name"), k: cfg("role") + " · press E to talk", p: (cfg("talk")[0] || {}).t || "", play: "npc:" + cfg("id"), mx: 1 };
    hotspots.push(c.hs);
    try { var col = [W.x, W.z, 0.32]; col.mx = 1; COLLIDERS.push(col); c.col = col; } catch (e) { note("collider", e); }
    c.label = makeLabel(cfg("name")); c.label.scale.set(1.45, 0.37, 1); c.label.position.y = 1.97; c.label.visible = false; root.add(c.label);
    MX.n.placed = 1; return c;
  }
  function refreshTalk() {
    var c = CH; if (!c) return; c.T.name = cfg("name"); c.T.role = cfg("role"); c.T.talk = cfg("talk"); c.T.greet = cfg("greet") || [];
    c.hs.t = cfg("name"); c.hs.k = cfg("role") + " · press E to talk"; c.hs.p = (cfg("talk")[0] || {}).t || "";
    var W = where(); if (W && (Math.abs(W.x - c.home.x) > 0.01 || Math.abs(W.z - c.home.z) > 0.01 || Math.abs(W.yaw - c.home.yaw) > 0.001)) { c.home = W; c.yaw = W.yaw; c.root.position.set(W.x, W.y, W.z); c.root.rotation.y = W.yaw;
      c.hs.x = W.x + Math.sin(W.yaw) * 0.9; c.hs.z = W.z + Math.cos(W.yaw) * 0.9; if (c.col) { c.col[0] = W.x; c.col[1] = W.z; } }
  }

  // ───────────────────────── the R16 character lighting for her rig (PLAN_CHARFX's glTF rig step, repeated here) ─────────────────────────
  // skin chroma reference (YCbCr of the sRGB albedo, measured on her cheeks and nose after the mx_post skin pass), cloth: torso 1 knit
  // (the tee), legs 2 twill (denim); her upper arms are bare, so the Arm bones join the hands and forearms region (charfx classes skin there)
  var RIGP = { cb: -0.0985, cr: 0.1370, sd: 0.0180, y10: 0.41, y90: 0.73, torso: 1, legs: 2, h: 1.68 };
  function regionAttr(mesh) {
    var g = mesh.geometry; if (!g || g.getAttribute("aCh")) return; var si = g.getAttribute("skinIndex"), sw = g.getAttribute("skinWeight"); if (!si || !sw || !mesh.skeleton) return;
    var cls = mesh.skeleton.bones.map(function (b) { var n = b.name || ""; return /^(Head|head|neck|Neck|HeadTop)/.test(n) ? 0 : /(Hand|Arm|Thumb|Index|Middle|Ring|Pinky)/.test(n) ? 1 : /(Foot|Toe)/.test(n) ? 2 : /(UpLeg|Leg)/.test(n) ? 3 : -1; });
    var n = si.count, out = new Uint8Array(n * 4), acc = [0, 0, 0, 0];
    for (var i = 0; i < n; i++) { acc[0] = acc[1] = acc[2] = acc[3] = 0; for (var k = 0; k < 4; k++) { var w = sw.getComponent(i, k); if (w <= 0) continue; var cc = cls[si.getComponent(i, k)]; if (cc >= 0) acc[cc] += w; } for (k = 0; k < 4; k++) out[i * 4 + k] = Math.max(0, Math.min(255, Math.round(acc[k] * 255))); }
    g.setAttribute("aCh", new THREE.BufferAttribute(out, 4, true));
  }
  function rigUniforms(mesh) {
    var R = RIGP, g = mesh.geometry, P = g.getAttribute("position"), A = g.getAttribute("aCh"); if (!g.boundingBox) g.computeBoundingBox(); var bb = g.boundingBox, hgt = bb.max.y - bb.min.y, s = hgt > 0.01 ? R.h / hgt : 1;
    var top = -1e9, sx = 0, sy = 0, sz = 0, nh = 0, hx = 0, hy = R.h - 0.12, hz = 0;
    if (A) for (var i = 0; i < P.count; i += 3) { if (A.getX(i) < 0.6) continue; var y = P.getY(i) * s; if (y > top) top = y; sx += P.getX(i) * s; sy += y; sz += P.getZ(i) * s; nh++; }
    if (nh > 20) { hx = sx / nh; hy = sy / nh; hz = sz / nh - 0.01; } else top = bb.max.y * s;
    var eyeY = top - 0.125;
    return { s: { value: s }, skin: { value: new THREE.Vector4(R.cb, R.cr, Math.max(0.026, R.sd * 2.6), 0) }, lum: { value: new THREE.Vector4(R.y10, R.y90, 0, 0) }, cls: { value: new THREE.Vector4(R.torso, R.legs, 4, 0) },
      head: { value: new THREE.Vector4(hx, hy, hz, 0) }, eye: { value: new THREE.Vector4(eyeY + 0.025, eyeY, 0, 0) } };
  }
  function charfx(g) {
    var CF = window.PLAN_CHARFX; if (!CF || !CF.on || typeof CF.patch !== "function") return; var seen = new Map();
    g.traverse(function (o) {
      if (!o.isSkinnedMesh || !o.material || Array.isArray(o.material)) return;
      try { regionAttr(o); var m0 = o.material, m = seen.get(m0);
        if (!m) { m = m0; if ((!CF.sw || CF.sw.csm) && typeof wrapMat === "function" && !("_csmObc" in m0)) { var w = wrapMat(m0); if (w && "_csmObc" in w) m = w; }
          CF.patch(m, { kind: "rig", rig: "mx_maytrixxx", u: rigUniforms(o) }); m.userData.chRig = "mx_maytrixxx"; seen.set(m0, m); MX.n.fxMats = (MX.n.fxMats || 0) + 1; }
        o.material = m; } catch (e) { note("charfx", e); }
    });
  }

  // ───────────────────────── loading (behind the loading screen, like plan_aaron) ─────────────────────────
  function mobile() { try { return typeof ASSET !== "undefined" && /models_m/.test(ASSET.models); } catch (e) { return false; } }
  var LD = null;
  function loadGLB(url) { return new Promise(function (res, rej) { try { if (!LD) LD = gltfLoader(); LD.load(url + "?v=" + (window.BUILD || "dev"), res, undefined, rej); } catch (e) { rej(e); } }); }
  function loadAll() {
    if (MX.loading || !CH) return; MX.loading = true; MX.n.t0 = Math.round(now()); var F = cfg("files"), mob = mobile();
    Promise.all([loadGLB(F.anim), loadGLB(mob && F.body_m ? F.body_m : F.body)]).then(function (r) { setupRig(CH, r[1], r[0]); MX.n.readyMs = Math.round(now() - MX.n.t0); MX.ready = true;
      setTimeout(function () { if (F.lod) loadGLB(F.lod).then(function (gl) { setupLod(CH, gl); }).catch(function (e) { note("lod", e); }); }, 6000);
    }).catch(function (e) { note("load", e); });
  }
  function prepMeshes(g, shadow) {
    var an = 1; try { an = MAX_ANISO || 1; } catch (e) {}
    var ms = []; g.traverse(function (o) { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = shadow; o.receiveShadow = true; o.frustumCulled = true; ms.push(o); var m = o.material; if (m && m.map && an > 1) { m.map.anisotropy = an; m.map.needsUpdate = true; } } });
    return ms;
  }
  function clipsOf(anim) { var out = {}; (anim.animations || []).forEach(function (cl) { cl.tracks = cl.tracks.filter(function (t) { return !/\.scale$/.test(t.name); }); out[cl.name] = cl; }); return out; }
  var ONCE = { greet: 1, offer: 1 };
  function actionsFor(mixer, clips) { var a = {}; for (var n in clips) { var act = mixer.clipAction(clips[n]); if (ONCE[n]) { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; } a[n] = act; } return a; }
  function setupRig(c, gl, anim) {
    var g = gl.scene; g.name = "mx rig"; charfx(g); c.meshes = prepMeshes(g, true); c.rig = g; c.root.add(g);
    c.meshes.forEach(function (m) { var mt = m.material; if (mt && mt.roughness !== undefined) mt.roughness = Math.max(mt.roughness, 0.78); });   // matte skin, as R13b did for Aaron
    c.clips = clipsOf(anim); c.mixer = new THREE.AnimationMixer(g); c.acts = actionsFor(c.mixer, c.clips);
    c.mixer.addEventListener("finished", function (ev) { if (c.one && ev.action === c.acts[c.one]) { c.one = null; play(c, base(c), 0.45); } });
    c.bones = { head: g.getObjectByName("Head"), chest: g.getObjectByName("Spine") };
    play(c, "idle", 0); c.acts.idle && (c.acts.idle.time = Math.random() * 8); c.mixer.update(0.001); g.updateMatrixWorld(true);
    try { buildRain(c); } catch (e) { note("rain", e); }
    try { if (window.PLAN_PERF && PLAN_PERF.warmGroup) { c.root.visible = true; PLAN_PERF.warmGroup(c.root, { name: "mx maytrixxx" }); } } catch (e) { note("warm", e); }
    MX.n.rig = 1;
  }
  function setupLod(c, gl) {
    if (!c || !c.rig) return; var g = gl.scene; g.name = "mx lod"; charfx(g); prepMeshes(g, false); g.visible = false; c.root.add(g); c.lod = g;
    c.lmixer = new THREE.AnimationMixer(g); c.lacts = actionsFor(c.lmixer, c.clips); if (c.cur && c.lacts[c.cur]) c.lacts[c.cur].play();
    try { if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(c.root, { name: "mx lod" }); } catch (e) {}
    MX.n.lod = 1;
  }
  function play(c, name, fade) {
    if (fade === undefined) fade = 0.4; var a = c.acts[name]; if (!a) return;
    c.one = ONCE[name] ? name : null; if (c.cur === name && !ONCE[name]) return;
    var prev = c.cur ? c.acts[c.cur] : null; a.reset(); a.setEffectiveTimeScale(1); a.setEffectiveWeight(1); a.enabled = true;
    if (prev && prev !== a && fade > 0) { a.play(); prev.crossFadeTo(a, fade, false); } else { if (prev && prev !== a) prev.stop(); a.play(); }
    c.cur = name;
    if (c.lmixer && c.lacts[name]) { var la = c.lacts[name]; for (var k in c.lacts) if (c.lacts[k] !== la) c.lacts[k].stop(); la.reset(); la.play(); }
  }
  function base(c) { return c.state === "talk" ? "talk" : "idle"; }

  // ───────────────────────── the green code rain: one additive cylinder of falling glyphs (GIVEBACK green), a few seconds long ─────────────────────────
  function buildRain(c) {
    var cv = document.createElement("canvas"); cv.width = 256; cv.height = 512; var x = cv.getContext("2d"); x.fillStyle = "#000"; x.fillRect(0, 0, 256, 512);
    var GL = "01GIVEBACK0123456789ABCDEF$#<>{}[]=+".split(""); x.font = "bold 15px 'JetBrains Mono', monospace"; x.textAlign = "center";
    for (var col = 0; col < 16; col++) { var len = 8 + Math.floor(Math.random() * 20), y0 = Math.floor(Math.random() * 32);
      for (var r = 0; r < 32; r++) { var k = (r - y0 + 32) % 32; if (k > len) continue; var f = 1 - k / len; x.fillStyle = k === 0 ? "rgba(214,255,224," + 0.95 + ")" : "rgba(77,222,111," + (0.15 + 0.75 * f * f).toFixed(3) + ")"; x.fillText(GL[Math.floor(Math.random() * GL.length)], col * 16 + 8, 512 - r * 16 - 3); } }
    var tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(3, 1);
    var mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    var geo = new THREE.CylinderGeometry(0.62, 0.62, 2.3, 28, 1, true); geo.translate(0, 1.15, 0);
    var m = new THREE.Mesh(geo, mat); m.name = "mx code rain"; m.castShadow = false; m.receiveShadow = false; m.renderOrder = 3; m.frustumCulled = true; c.root.add(m);
    c.rain = { m: m, mat: mat, tex: tex, t: -1, dur: 4.2 }; m.visible = true;   // visible for the warm-up (opacity 0), hidden on the first frame
  }
  function rain() { var c = CH; if (!c || !c.rain) return false; c.rain.t = 0; c.rain.m.visible = true; MX.n.rain = (MX.n.rain || 0) + 1; return true; }
  function rainFrame(c, dt) {
    var R = c.rain; if (!R) return; if (R.t < 0) { if (R.m.visible) R.m.visible = false; return; }
    R.t += dt; var u = R.t / R.dur; if (u >= 1) { R.t = -1; R.m.visible = false; R.mat.opacity = 0; return; }
    R.mat.opacity = 0.85 * Math.min(1, u * 5) * Math.min(1, (1 - u) * 2.5); R.tex.offset.y -= dt * 0.55; R.m.rotation.y += dt * 0.15;
  }
  MX.rain = rain;

  // ───────────────────────── speech: a two-line bubble (one canvas, redrawn on change) ─────────────────────────
  function rr(x, a, b, w, h, r) { x.beginPath(); if (x.roundRect) x.roundRect(a, b, w, h, r); else x.rect(a, b, w, h); }
  function say(c, text) {
    if (!text || !c || !player) return; if (Math.hypot(player.position.x - c.root.position.x, player.position.z - c.root.position.z) > 20) return;
    if (!c.bub) { var cv = document.createElement("canvas"); cv.width = 512; cv.height = 150; var tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })); sp.scale.set(2.3, 0.67, 1); sp.position.y = 2.42; sp.renderOrder = 5; c.root.add(sp); c.bub = { cv: cv, x: cv.getContext("2d"), tex: tex, sp: sp }; }
    var B = c.bub, x = B.x; x.clearRect(0, 0, 512, 150); x.font = "500 27px 'Space Grotesk', system-ui, sans-serif"; x.textAlign = "center";
    var words = String(text).split(" "), lines = [""]; words.forEach(function (w) { var tl = lines[lines.length - 1] ? lines[lines.length - 1] + " " + w : w; if (x.measureText(tl).width > 450 && lines[lines.length - 1]) { if (lines.length < 2) lines.push(w); else lines[1] = (lines[1] + " " + w); } else lines[lines.length - 1] = tl; });
    if (lines[1] && x.measureText(lines[1]).width > 450) { while (lines[1].length > 3 && x.measureText(lines[1] + "...").width > 450) lines[1] = lines[1].slice(0, -1); lines[1] += "..."; }
    var w = 0; lines.forEach(function (l) { w = Math.max(w, x.measureText(l).width); }); w += 40; var h = 26 + lines.length * 36;
    x.fillStyle = "rgba(245,241,230,.95)"; rr(x, 256 - w / 2, 140 - h, w, h, 18); x.fill(); x.fillStyle = "#4DDE6F"; x.fillRect(256 - w / 2 + 18, 140 - h, w - 36, 3); x.fillStyle = "#0a1610"; lines.forEach(function (l, i) { x.fillText(l, 256, 140 - h + 40 + i * 36); });
    B.tex.needsUpdate = true; B.sp.visible = true; c.bubT = now(); try { logLine(cfg("name"), text); } catch (e) {}
  }
  function award(id) { try { var PP = window.PLAN_PROGRESS; if (id && PP && PP.award) PP.award("stamp", { id: id }); } catch (e) {} }

  // ───────────────────────── talk card: the act pages (code rain, open palms) and the E prompt ─────────────────────────
  function onShow(c, idx) {
    if (!c || !c.mx || !CH) return; var node = c.talk && c.talk[idx]; if (!node) return; MX.n.page = idx; MX.n.pages = (MX.n.pages || 0) + 1;
    if (node.act === "rain") rain();
    if (node.act === "offer" && CH.rig && CH.acts.offer) { CH.state = "talk"; play(CH, "offer", 0.3); }
    if (node.stamp) award((cfg("progress") || {}).stamp_talk);   // the closing page ("stamp": true in the json)
    try { var box = document.getElementById("talk-o"); if (box && node.o) for (var i = 0; i < box.children.length && i < node.o.length; i++) { if (/red pill/i.test(node.o[i][0])) { var b = box.children[i]; b.style.background = "#c8302f"; b.style.color = "#fff"; b.style.fontWeight = "800"; b.style.boxShadow = "0 0 0 2px rgba(200,48,47,.35), 0 6px 18px rgba(200,48,47,.25)"; } } } catch (e) {}   // the red pill stands out
  }
  function install() {
    if (MX.installed) return; MX.installed = true;
    try { if (typeof showTalk === "function") { var st0 = showTalk; showTalk = function (c, idx) { var r = st0.apply(this, arguments); try { onShow(c, idx); } catch (e) { note("talk", e); } return r; }; } } catch (e) { note("wrap talk", e); }
    try { if (typeof updateZone === "function") { var uz0 = updateZone; updateZone = function () { var r = uz0.apply(this, arguments); try { promptFrame(); } catch (e) { note("prompt", e); } return r; }; } } catch (e) { note("wrap zone", e); }
  }
  function promptFrame() {
    if (!player || !CH) return; var el = document.getElementById("prompt"), t = document.getElementById("prompt-t"); if (!el || !t || !el.classList.contains("on")) return;
    var nh = typeof nearestHotspot === "function" ? nearestHotspot() : null; if (!nh || !nh.mx) return; var want = "<b>E</b> &nbsp;" + cfg("prompt");
    if (t.innerHTML.indexOf(nh.t) >= 0 && t.innerHTML !== want && !/<b>F<\/b>/.test(t.innerHTML)) t.innerHTML = want;
  }

  // ───────────────────────── the frame: behaviour, LOD, the throttled mixer, the head look ─────────────────────────
  function face(c, yaw, dt, rate) { var d = wrapA(yaw - c.yaw); var st = (rate || 2.2) * dt; c.yaw += Math.abs(d) < st ? d : Math.sign(d) * st; c.root.rotation.y = c.yaw; }
  function yawTo(c, x, z) { return Math.atan2(x - c.root.position.x, z - c.root.position.z); }
  function headLook(c, dt, active, yawWant) {
    var hb = c.bones && c.bones.head; if (!hb) return; c.look += ((active ? 1 : 0) - c.look) * Math.min(1, dt * 3); var d = clamp(wrapA(yawWant - c.yaw), -0.55, 0.55); c.lookYaw += (d - c.lookYaw) * Math.min(1, dt * 4);
    if (c.look < 0.02) return; Q1.setFromAxisAngle(UP, c.lookYaw * 0.6 * c.look); hb.quaternion.multiply(Q1);
  }
  var FR = { k: 0 };
  function frame(dt) {
    FR.k++; if (!CH) { if (FR.k % 30 === 0 && cm()) { makeChar(); loadAll(); } return; }
    if (!player) return; dt = Math.min(dt || 0.016, 0.1); var c = CH, R = cfg("range"), cam = camera.position, P = player.position, inside0 = false; try { inside0 = !!inside; } catch (e) {}
    var dc = Math.hypot(cam.x - c.root.position.x, cam.z - c.root.position.z); c.dc = dc; var vis = !!c.rig && !inside0 && dc < R.show; c.root.visible = vis;
    if (!vis) { if (c.greeted && dc > R.show) c.greeted = false; return; }
    var far = !!c.lod && dc > R.lod; c.rig.visible = !far; if (c.lod) c.lod.visible = far;
    if (c.label) c.label.visible = dc < R.label && dc > 4.5; if (c.bub && c.bub.sp.visible && now() - c.bubT > 6500) c.bub.sp.visible = false;
    var sh = dc < 30; if (c.meshes && c.sh !== sh) { c.sh = sh; c.meshes.forEach(function (m) { m.castShadow = sh; }); }
    c.t += dt; var talk = null; try { talk = talkNpc; } catch (e) {} var talking = !!talk && talk === c.T;
    var dp = Math.hypot(P.x - c.root.position.x, P.z - c.root.position.z);
    if (talking) {
      if (c.state !== "talk") { c.state = "talk"; if (!c.one) play(c, "talk", 0.45); }
      face(c, yawTo(c, P.x, P.z), dt, 2.4);
      if (dp > 10) try { closeTalk(); } catch (e) {}
    } else {
      if (c.state === "talk") { c.state = "idle"; if (!c.one) play(c, "idle", 0.6); }
      if (dp < R.greet && !c.greeted) { c.greeted = true; play(c, "greet", 0.3); say(c, pick(cfg("greet"))); c.next = 16 + Math.random() * 10; }
      if (c.greeted && dp > R.leave) { c.greeted = false; if (dp < 18) say(c, pick(cfg("bye"))); }
      face(c, dp < R.look + 2 ? yawTo(c, P.x, P.z) : c.home.yaw, dt, dp < R.look + 2 ? 1.8 : 1.0);
      c.next -= dt; if (c.next <= 0) { c.next = 20 + Math.random() * 14; if (dp < 14 && !c.one) say(c, pick(cfg("ambient"))); }
    }
    // the mixer by distance (every frame within 20 m, every 2nd to 45 m, every 4th beyond), then the head look and the rain
    var step = dc < 20 ? 1 : dc < 45 ? 2 : 4; c.acc = (c.acc || 0) + dt; rainFrame(c, dt); if (FR.k % step) return; var adt = c.acc; c.acc = 0;
    if (far) { if (c.lmixer) c.lmixer.update(adt); c.mixer.update(adt); }
    else { c.mixer.update(adt); headLook(c, adt, dp < R.look && !c.one, yawTo(c, P.x, P.z)); }
  }
  MX.frame = frame;
  MX.debug = {
    state: function () { var c = CH; if (!c) return { placed: false, cm: !!cm() }; return { state: c.state, cur: c.cur, one: c.one, ready: !!c.rig, lod: !!c.lod, vis: c.root.visible, dc: Math.round(c.dc || 0), pos: [+c.root.position.x.toFixed(2), +c.root.position.y.toFixed(2), +c.root.position.z.toFixed(2)], yaw: +c.yaw.toFixed(3), rain: c.rain ? c.rain.t : null }; },
    play: function (n) { if (CH && CH.rig) { play(CH, n, 0.2); return true; } return false; },
    pose: function (n, t) { var c = CH; if (!c || !c.acts[n]) return false; play(c, n, 0); c.acts[n].time = t; c.mixer.update(0); return true; },
    pause: function (on) { MX.paused = !!on; return MX.paused; },
    talk: function (i) { var c = CH; if (!c) return false; try { showTalk(c.T, i || 0); return true; } catch (e) { return String(e); } },
    face: function (yaw) { if (CH) { CH.yaw = yaw; CH.root.rotation.y = yaw; } return yaw; },
    rain: rain
  };

  // ───────────────────────── hooks ─────────────────────────
  var H = window.PLAN_HOOKS;
  H.world.push({ name: "planMaytrixxxWorld", fn: function () { try { install(); if (cm()) { makeChar(); loadAll(); } } catch (e) { note("world", e); } } });
  H.frame.push({ name: "planMaytrixxxFrame", fn: function (dt) { if (MX.paused) return; try { frame(dt); } catch (e) { if (!MX.frameErr) { MX.frameErr = 1; note("frame", e); } } } });
})();
