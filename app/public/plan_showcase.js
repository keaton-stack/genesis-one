// plan_showcase.js: round 3 set pieces (task R3M, 29 Sep 2026). Classic script loaded before client.js; everything lives in
// this closure and reaches client globals by bare name at hook time (never at load).
//   - the Solport apron: a Stellar Aviation Jet A refueller beside the jet on stand A4 (the Stellar logo is a decal cut from
//     the terminal's own Stellar brand canvas, PLAN_TERMINAL.tx, never generated lettering), a Stellar tug hooked to the
//     nose gear of the jet on stand A5 by a tow bar, Freedom Air's EC130 on a new helipad west of the gate A2 turnaround,
//     and a Pilatus PC-12 on the City apron by the Tower; all on City airport land, clear of the runway, the taxiways and their
//     object-free areas (IMPL2: fuel is only ever on the City's side)
//   - the round 3 rigged people: the Stellar line technician at the refueller, a captain on the FBO forecourt, the
//     concierge at The Landing Clubhouse entrance, two residents walking the Club Walk (walk and idle clips)
//   - two art district sculptures in the Design District sculpture fields (under 6 m, like the rest of the field)
// Model kinds: plan_models_r2.js (PLAN_MODEL_SPECS / PLAN_MODEL_INFO, round 3 block). The rebuilt hero buildings keep their
// own kinds and need nothing here, except the tensile pavilion: walk-under, so its vegetation keep-out lives here.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var HK = window.PLAN_HOOKS;
  var KINDS = ["stellar_fueler", "stellar_tug", "ec130", "pc12", "sculpt_ribbon", "sculpt_mirror"];
  var NEEDS = window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || [];
  KINDS.forEach(function (k) { if (NEEDS.indexOf(k) < 0) NEEDS.push(k); });
  var SC = window.PLAN_SHOWCASE = window.PLAN_SHOWCASE || { v: "r3m-1", errs: [], n: {}, at: {}, rigs: {}, extras: null };
  function note(w, e) { var m = w + ": " + (e && e.message ? e.message : e); if (SC.errs.length < 40) SC.errs.push(m); if (SC.errs.length <= 6) console.warn("[showcase] " + m); }
  function INFO(k) { var I = window.PLAN_MODEL_INFO; return I && I[k] ? I[k] : null; }
  var TAU = Math.PI * 2;

  // ── frames: a placement's local frame (x right, z forward along its yaw), the engine's convention ──
  function frame(x, z, yaw) { return { x: x, z: z, yaw: yaw, c: Math.cos(yaw), s: Math.sin(yaw) }; }
  function l2w(F, lx, lz) { return [F.x + lx * F.c + lz * F.s, F.z - lx * F.s + lz * F.c]; }
  function termF() { var e = PLACE.terminal && PLACE.terminal[0]; return e ? frame(e[0], e[2], e[3]) : null; }
  function bldF(id) {
    try { var r = PLAN_IDX.bld.get(id); if (r && r.e) return frame(r.e[0], r.e[2], r.e[3]); } catch (e) {}
    var P = window.PLAN; if (!P) return null; for (var i = 0; i < P.buildings.length; i++) { var b = P.buildings[i]; if (b.id === id) return frame(b.x, b.z, planYaw(b)); } return null;
  }
  function gy(x, z) { try { return planGroundAt(x, z); } catch (e) { return getH(x, z); } }

  // ── the layout (metres; frames are the plan buildings' own) ──
  // A4 (b0012) is the light jet (nose +Z, left wing +X, wingtip 8.1 m out at z -2.3; nose tip z +7.8). The refueller parks
  // on its left side ahead of the wing, parallel to it, its hose cabinet by the wing root. A5 (b0059) is the mid jet (nose
  // gear at z +8.1): the tug stands ahead of it facing out, a 3.2 m tow bar from its hitch to the nose gear.
  var LAY = {
    fueler: { ref: "b0012", lx: 6.2, lz: 6.4, dyaw: 0 },
    tug:    { ref: "b0059", gear: [0.006, 8.114], bar: 3.2, dyaw: 0 },
    heli:   { term: [-80, 45], pad: 11, dyaw: Math.PI * 0.75 },   // world about (45, 25): 25 m from the client's apron windsock at (70, 20), 35 m from the main taxiway centreline
    pc12:   { w: [-72, -32], yaw: 0.86 + Math.PI / 2 },   // the City apron west of the Tower (site.json apron 2), clear of its taxi lines
    art:    [{ kind: "sculpt_ribbon", at: [[726, 582], [736, 590], [716, 594], [690, 625]], yaw: 0.6, scale: 1 },
             { kind: "sculpt_mirror", at: [[690, 628], [700, 638], [682, 640], [725, 582]], yaw: 3.6, scale: 1 }],
  };
  SC.layout = LAY;

  // ── world hook: static placements (before the scatter, so vegetation keeps off) ──
  function place(kind, x, z, yaw, sc, keep) {
    if (!MODELS[kind]) { SC.n[kind] = "no model"; return null; }
    put(kind, x, z, yaw, sc || 1); var e = PLACE[kind][PLACE[kind].length - 1]; e.showcase = true; SC.at[kind] = e;
    if (keep) KEEPOUT.push([x, z, keep]); SC.n[kind] = "placed"; return e;
  }
  function clearAt(x, z, r) {
    for (var i = 0; i < COLLIDERS.length; i++) { var c = COLLIDERS[i]; if (Math.hypot(c[0] - x, c[1] - z) < c[2] + r) return false; }
    for (var k in PLACE) { var L = PLACE[k], sp = MODEL_SPECS[k], m = MODELS[k]; if (!L || !m || !sp || (sp.prop && m.height < 2.5)) continue; for (var j = 0; j < L.length; j++) { var e = L[j]; if (Math.hypot(e[0] - x, e[2] - z) < m.radius * (e[4] || 1) + r) return false; } }
    return true;
  }
  function world() {
    if (!window.PLAN) return;
    // the tensile pavilions are walk-under (solid 0, mast and platform posts in PLAN_MODEL_INFO.pavilion.posts): keep shrubs
    // out from under them (13 m: the grass tufts test 0.7 of it, and 9.1 m clears the 17.8 m platform's sides)
    try { var pv = PLACE.pavilion || []; for (var i = 0; i < pv.length; i++) KEEPOUT.push([pv[i][0], pv[i][2], 13 * (pv[i][4] || 1)]); SC.n.pavKeep = pv.length; } catch (e) { note("pavilion keep-out", e); }
    try {
      var FA = bldF(LAY.fueler.ref); if (FA) { var p = l2w(FA, LAY.fueler.lx, LAY.fueler.lz); place("stellar_fueler", p[0], p[1], FA.yaw + LAY.fueler.dyaw, 1, 7); }
      var FB = bldF(LAY.tug.ref), mt = MODELS.stellar_tug;
      if (FB && mt) { var half = mt.sz / 2, hz = (INFO("stellar_tug") && INFO("stellar_tug").hitch) ? INFO("stellar_tug").hitch[2] : -half; var lz = LAY.tug.gear[1] + LAY.tug.bar - hz; var q = l2w(FB, LAY.tug.gear[0], lz); var e2 = place("stellar_tug", q[0], q[1], FB.yaw + LAY.tug.dyaw, 1, 4); if (e2) e2.bar = { F: FB, gear: LAY.tug.gear, lz: lz, hz: hz }; }
      var T = termF();
      if (T) { var h = l2w(T, LAY.heli.term[0], LAY.heli.term[1]); SC.heliPad = { x: h[0], z: h[1], r: LAY.heli.pad, yaw: T.yaw + LAY.heli.dyaw }; place("ec130", h[0], h[1], T.yaw + LAY.heli.dyaw, 1, LAY.heli.pad + 2);
        var pc = LAY.pc12.w || l2w(T, LAY.pc12.term[0], LAY.pc12.term[1]); place("pc12", pc[0], pc[1], LAY.pc12.yaw !== undefined ? LAY.pc12.yaw : T.yaw + LAY.pc12.dyaw, 1, 10); }
      LAY.art.forEach(function (a) { var m = MODELS[a.kind]; if (!m) { SC.n[a.kind] = "no model"; return; } var rr = Math.max(4, m.radius * 1.3) + 2; for (var i = 0; i < a.at.length; i++) { var s = a.at[i]; if (clearAt(s[0], s[1], rr)) { place(a.kind, s[0], s[1], a.yaw, a.scale, rr); SC.n[a.kind + "_spot"] = i; return; } } SC.n[a.kind] = "no free spot"; });
    } catch (e) { note("world", e); }
  }
  HK.world.push({ name: "showcaseWorld", fn: world });

  // ── the extras, built on the first frame (after planSeatProps has seated every prop and vehicle) ──
  function mat(o) { return new THREE.MeshStandardMaterial(o); }
  function boxSolid(e, lx, lz, w, d, y0, y1) { var F = frame(e[0], e[2], e[3]); var p = l2w(F, lx, lz); return addSolid(p[0], p[1], e[3], w, d, e[1] + y0, e[1] + y1, "world"); }
  // box solids in the model frame, PLAN_MODEL_INFO.<kind>.solids: [lx, lz, w, d, y0, y1] (y above the placement base)
  var DEF_SOLIDS = { stellar_fueler: [[0, 0, 2.5, 9.3, -0.2, 3.3]], stellar_tug: [[0, 0.1, 1.8, 4.1, -0.2, 1.3]], ec130: [[0, 1.8, 1.9, 6.6, 0, 2.4]], pc12: [[0, 0.5, 2.0, 13.8, 0, 3.4], [0, 0.8, 16.0, 2.2, 1.3, 2.0]] };
  function vehicleSolids() {
    ["stellar_fueler", "stellar_tug", "ec130", "pc12"].forEach(function (k) { var e = SC.at[k]; if (!e) return; var I = INFO(k) || {}, L = I.solids || DEF_SOLIDS[k]; L.forEach(function (b) { boxSolid(e, b[0], b[1], b[2], b[3], b[4], b[5]); }); SC.n[k + "_solids"] = L.length; });
  }
  // the helipad: a concrete disc draped on the apron, a painted H in a circle, eight low perimeter lights lit at night
  function helipad() {
    var P = SC.heliPad; if (!P) return; var R = P.r, g = new THREE.Group(); g.name = "showcase_helipad";
    var c = document.createElement("canvas"); c.width = c.height = 1024; var x = c.getContext("2d");
    var gr = x.createRadialGradient(512, 512, 60, 512, 512, 512); gr.addColorStop(0, "#b9b4aa"); gr.addColorStop(1, "#a7a298"); x.fillStyle = gr; x.fillRect(0, 0, 1024, 1024);
    for (var i = 0; i < 9000; i++) { x.fillStyle = Math.random() < 0.5 ? "rgba(60,55,50,0.10)" : "rgba(255,255,250,0.12)"; x.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2); }
    x.strokeStyle = "#f2efe6"; x.lineWidth = 26; x.beginPath(); x.arc(512, 512, 470, 0, TAU); x.stroke();
    x.strokeStyle = "#f2c230"; x.lineWidth = 16; x.beginPath(); x.arc(512, 512, 300, 0, TAU); x.stroke();
    x.fillStyle = "#f2efe6"; x.fillRect(372, 330, 64, 364); x.fillRect(588, 330, 64, 364); x.fillRect(436, 480, 152, 64);
    var tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    var geo = new THREE.CircleGeometry(R, 48, 0, TAU); geo.rotateX(-Math.PI / 2); var pa = geo.attributes.position, cs = Math.cos(P.yaw), sn = Math.sin(P.yaw), y0 = 1e9;
    for (var v = 0; v < pa.count; v++) { var lx = pa.getX(v), lz = pa.getZ(v); var wx = P.x + lx * cs + lz * sn, wz = P.z - lx * sn + lz * cs; var h = gy(wx, wz); pa.setXYZ(v, wx, h + 0.06, wz); y0 = Math.min(y0, h); }
    geo.computeVertexNormals();
    var m = new THREE.Mesh(geo, mat({ map: tex, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); m.receiveShadow = true; g.add(m);
    var lampM = mat({ color: 0x1a1a1a, emissive: 0xffd24a, emissiveIntensity: 0, roughness: 0.4 }); SC.padLamp = lampM;
    for (var k = 0; k < 8; k++) { var a = k / 8 * TAU, lx2 = Math.cos(a) * (R + 0.4), lz2 = Math.sin(a) * (R + 0.4); var wx2 = P.x + lx2 * cs + lz2 * sn, wz2 = P.z - lx2 * sn + lz2 * cs;
      var l = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.26, 10), lampM); l.position.set(wx2, gy(wx2, wz2) + 0.13, wz2); g.add(l); }
    scene.add(g); SC.n.helipad = 1;
  }
  // the tow bar from the tug's hitch to the mid jet's nose gear
  function towbar() {
    var e = SC.at.stellar_tug; if (!e || !e.bar) return; var B = e.bar, I = INFO("stellar_tug") || {}, hy = I.hitch ? I.hitch[1] : 0.45;
    var a = l2w(B.F, B.gear[0], B.gear[1]), b = l2w(B.F, B.gear[0], B.lz + B.hz);
    var A = new THREE.Vector3(a[0], gy(a[0], a[1]) + 0.32, a[1]), Bv = new THREE.Vector3(b[0], e[1] + hy, b[1]); var L = A.distanceTo(Bv);
    var bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, L, 10), mat({ color: 0xd8d6d0, roughness: 0.5, metalness: 0.5 }));
    bar.position.copy(A).add(Bv).multiplyScalar(0.5); bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize()); bar.castShadow = true; scene.add(bar);
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.5), mat({ color: 0x1c1c1e, roughness: 0.6 })); head.position.copy(A); head.rotation.y = e[3]; scene.add(head); SC.n.towbar = +L.toFixed(2);
  }
  // the Stellar logo on both tank sides: a plane cut from the terminal's own Stellar lightbox canvas (the logo half of
  // "stDoor": white gradient, the blue S roundel, STELLAR, the swoosh and AVIATION); waits until plan_terminal.js has drawn it
  function decal() {
    var e = SC.at.stellar_fueler, I = INFO("stellar_fueler"); if (!e || !I || !I.decal) return true;
    var TX = window.PLAN_TERMINAL && window.PLAN_TERMINAL.tx, t = TX && (TX.stDoor || TX.stLandB || TX.stRoof); if (!t) return false;
    var D = I.decal, u0 = 0.035, u1 = 0.655, v0 = 0.1, v1 = 0.92;   // the logo part of the canvas (left of the FBO divider, above the blue band)
    var w = D.w, h = w * ((v1 - v0) * (t.image ? t.image.height : 384)) / ((u1 - u0) * (t.image ? t.image.width : 1536));
    if (h > D.hmax) { h = D.hmax; w = h * ((u1 - u0) * (t.image ? t.image.width : 1536)) / ((v1 - v0) * (t.image ? t.image.height : 384)); }
    var m = mat({ map: t, roughness: 0.45, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, transparent: false });
    var g = new THREE.Group(); g.position.set(e[0], e[1], e[2]); g.rotation.y = e[3];
    [1, -1].forEach(function (side) {
      var geo = new THREE.PlaneGeometry(w, h); var uv = geo.attributes.uv;
      for (var i = 0; i < uv.count; i++) { var uu = uv.getX(i), vv = uv.getY(i); uv.setXY(i, u0 + (side > 0 ? uu : uu) * (u1 - u0), v0 + vv * (v1 - v0)); }
      var p = new THREE.Mesh(geo, m); p.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2; p.position.set(side * (D.x + 0.012), D.y, D.z); p.receiveShadow = true; g.add(p);
    });
    scene.add(g); SC.n.decal = [+w.toFixed(2), +h.toFixed(2)]; return true;
  }
  // the rebuilt clubhouse and restaurant carry a glass mask in ORM blue (r3_winmask.py) but no separate glass mesh, and the
  // client's WIN.kinds branch now only flags such materials (userData.win: no facade glow at night), so they went black after
  // dark: give them the client's own window hook (winHookBody: glassy panes by day, warm lit rooms at night), chained after
  // the surface-detail and rough-floor hooks loadModels already put on them
  function windowize() {
    ["clubhouse", "restaurant"].forEach(function (k) {
      var m = MODELS[k], I = INFO(k); if (!m || !I || !I.r3 || typeof winHookBody !== "function") return;
      m.parts.forEach(function (pt) { var mat = pt.material; if (!mat || !mat.metalnessMap || mat.userData.r3win) return; mat.userData.r3win = true; mat.userData.win = true; mat.metalness = 1;
        var prev = mat.onBeforeCompile; mat.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r); winHookBody(sh, ""); }; mat.needsUpdate = true; });
      SC.n[k + "_windows"] = 1;
    });
  }
  // the polished sculpture: the generator painted a sky into its albedo; a true mirror steel reflects the game's own sky
  function mirrorSteel() {
    try { var L = INST.sculpt_mirror; if (!L) return; L.forEach(function (inst) { var m = inst.material; if (!m || m.userData.r3steel) return; m.map = null; m.color.setHex(0xe8eaec); m.metalness = 1; m.roughness = 0.07; m.roughnessMap = null; m.metalnessMap = null; m.envMapIntensity = 1.6; m.userData.r3steel = true; m.needsUpdate = true; }); SC.n.mirror = "steel"; } catch (e) { note("mirror steel", e); }
  }

  // ── the rigged people ──
  function rigInfo(k) { var I = INFO(k); return I && I.file && I.installed ? I : null; }
  function loadRig(k, done) {
    var I = rigInfo(k); if (!I) return false; var q = "?v=" + (window.BUILD || "dev"); var mob = false; try { mob = /models_m/.test(ASSET.models); } catch (e) {}
    var an = 1; try { an = MAX_ANISO || 1; } catch (e) {}
    try { gltfLoader().load((mob && I.mobile ? I.mobile : I.file) + q, function (gl) {
      try { var g = gl.scene; g.traverse(function (o) { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; var mm = o.material; if (mm && mm.map && an > 1) { mm.map.anisotropy = an; mm.map.needsUpdate = true; } } });
        var bb = new THREE.Box3().setFromObject(g), hh = bb.max.y - bb.min.y, want = I.height || (I.size && I.size[1]) || 1.8; if (hh > 0.5 && (hh < want * 0.85 || hh > want * 1.15)) g.scale.multiplyScalar(want / hh);
        g.userData.noCull = true; var mixer = new THREE.AnimationMixer(g), R = { g: g, mixer: mixer, clips: {} }, left = 2;
        var fin = function () { if (--left > 0) return; if (!R.clips.idle && !R.clips.walk) { note(k + " clips", "none"); return; } done(R); };
        ["idle", "walk"].forEach(function (c) { if (!I[c]) { fin(); return; } gltfLoader().load(I[c] + q, function (cg) { var cl = cg.animations && cg.animations[0]; if (cl) { cl.tracks = cl.tracks.filter(function (t) { return !/\.scale$/.test(t.name); }); R.clips[c] = mixer.clipAction(cl); } fin(); }, undefined, function () { fin(); }); });
      } catch (err) { note(k + " rig", err); } }, undefined, function (err) { note(k + " load", err); }); } catch (err) { note(k + " rig", err); }
    return true;
  }
  // a person: fixed spot (idle, turning toward a close visitor) or a walker on a path (walk clip, pausing on idle at the ends)
  var PEOPLE = SC.people = [];
  function person(k, o) { var p = { k: k, state: 0, x: o.x, z: o.z, yaw: o.yaw, yaw0: o.yaw, path: o.path || null, lane: o.lane || 0, speed: o.speed || 1.05, t: 0, pause: 0, face: o.face !== false, base: o.base }; PEOPLE.push(p); return p; }
  function peopleSetup() {
    var e, F, p;
    if ((e = SC.at.stellar_fueler)) { F = frame(e[0], e[2], e[3]); p = l2w(F, -2.35, -3.6); person("linetech", { x: p[0], z: p[1], yaw: e[3] - Math.PI / 2 }); }
    var T = termF(); if (T) { p = l2w(T, -24, 41); person("pilot", { x: p[0], z: p[1], yaw: T.yaw + 0.25 }); }
    // the concierge on the clubhouse porch, right of the entrance piers (PLAN_MODEL_INFO.clubhouse: porch floor 0.83, piers at z 10.6)
    var cb = null; try { cb = PLAN_IDX.bld.get("b0036"); } catch (e) {} var ci = INFO("clubhouse");
    if (cb && cb.e && cb.kind === "clubhouse" && ci && ci.floor) { F = frame(cb.e[0], cb.e[2], cb.e[3]); var sc = cb.e[4] || 1; p = l2w(F, 2.9 * sc, 10.4 * sc); person("concierge", { x: p[0], z: p[1], yaw: F.yaw - 0.3, base: cb.e[1] - ((MODELS.clubhouse && MODELS.clubhouse.sink) || 0) - (cb.e.sink || 0) + 0.82 * sc }); }
    else if ((F = bldF("b0036")) && MODELS.clubhouse) { p = l2w(F, 3.4, MODELS.clubhouse.sz / 2 + 1.6); person("concierge", { x: p[0], z: p[1], yaw: F.yaw - 0.25 }); }
    var path = clubWalkLane();
    if (path) { person("resident_m", { x: path[0][0], z: path[0][1], yaw: 0, path: path, lane: 0, speed: 1.02 }); person("resident_f", { x: path[0][0], z: path[0][1], yaw: 0, path: path, lane: 1.05, speed: 1.02 }); }
    SC.n.people = PEOPLE.map(function (q) { return q.k; });
  }
  // the Club Walk (Horizon Line 1) from Arrivals Court to the Flight Deck spur: pick the lane beside the palm median with the
  // most clearance from every collider and solid, out on one side and back on the other (a closed loop)
  function clubWalkLane() {
    var P = window.PLAN; if (!P) return null; var pr = null; for (var i = 0; i < P.promenades.length; i++) if (P.promenades[i].id === "hl1_club_walk") pr = P.promenades[i]; if (!pr) return null;
    var a = pr.pts[0], b = pr.pts[1]; var dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    var t0 = 14, t1 = L - 10, best = null;
    for (var off = 3.5; off <= 9.5; off += 0.5) {
      var worst = 1e9; for (var sgn = -1; sgn <= 1; sgn += 2) for (var t = t0; t <= t1; t += 2) { var x = a[0] + ux * t + nx * off * sgn, z = a[1] + uz * t + nz * off * sgn; worst = Math.min(worst, clearance(x, z)); }
      if (!best || worst > best.c) best = { off: off, c: worst };
    }
    SC.n.walkLane = best; var o = best.off, out = [];
    out.push([a[0] + ux * t0 + nx * o, a[1] + uz * t0 + nz * o]); out.push([a[0] + ux * t1 + nx * o, a[1] + uz * t1 + nz * o]);
    out.push([a[0] + ux * t1 - nx * o, a[1] + uz * t1 - nz * o]); out.push([a[0] + ux * t0 - nx * o, a[1] + uz * t0 - nz * o]);
    return out;
  }
  function clearance(x, z) {
    var c = 1e9; for (var i = 0; i < COLLIDERS.length; i++) { var q = COLLIDERS[i]; var d = Math.hypot(q[0] - x, q[1] - z) - q[2]; if (d < c) c = d; }
    for (var j = 0; j < SOLIDS.length; j++) { var s = SOLIDS[j]; if (Math.abs(s.x - x) > 30 || Math.abs(s.z - z) > 30) continue; var lc = solidLocal(s, x, z); var ex = Math.max(Math.abs(lc[0]) - s.hw, 0), ez = Math.max(Math.abs(lc[1]) - s.hd, 0); var d2 = Math.hypot(ex, ez); if (d2 < c) c = d2; }
    return c;
  }
  // walkers: the path is a closed loop; the lane offsets the second walker sideways (a couple side by side); at each corner
  // they stop, idle a few seconds, turn and go on
  function walkStep(p, dt) {
    var P = p.path, n = P.length; if (p.seg === undefined) { p.seg = 0; p.u = 0; }
    if (p.pause > 0) { p.pause -= dt; return false; }
    var a = P[p.seg], b = P[(p.seg + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]); p.u += p.speed * dt / Math.max(L, 0.01);
    if (p.u >= 1) { p.u = 0; p.seg = (p.seg + 1) % n; if (p.seg % 2 === 0) p.pause = 5 + Math.random() * 6; a = P[p.seg]; b = P[(p.seg + 1) % n]; L = Math.hypot(b[0] - a[0], b[1] - a[1]); }
    var ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L; p.x = a[0] + (b[0] - a[0]) * p.u - uz * p.lane; p.z = a[1] + (b[1] - a[1]) * p.u + ux * p.lane; p.want = Math.atan2(ux, uz); return true;
  }
  function turnTo(p, want, dt, rate) { var err = Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw)), tr = rate * dt; p.yaw += err > tr ? tr : err < -tr ? -tr : err; }
  function peopleFrame(dt) {
    var cx = camera.position.x, cz = camera.position.z;
    for (var i = 0; i < PEOPLE.length; i++) { var p = PEOPLE[i]; var d = Math.hypot(p.x - cx, p.z - cz);
      if (p.state === 0 && d < 260 && rigInfo(p.k)) { p.state = 1; (function (pp) { loadRig(pp.k, function (R) { pp.R = R; scene.add(R.g); pp.state = 2; pp.act = null; SC.rigs[pp.k] = "loaded"; }); })(p); }
      if (p.state !== 2) continue; var g = p.R.g, vis = d < 210 && !inside; if (g.visible !== vis) g.visible = vis;
      var moving = false; if (p.path) moving = walkStep(p, dt);
      var want = moving ? p.want : p.yaw0; if (!moving && p.face) { var dxp = player.position.x - p.x, dzp = player.position.z - p.z; if (Math.hypot(dxp, dzp) < 6) want = Math.atan2(dxp, dzp); }
      turnTo(p, want, dt, moving ? 4 : 2.2);
      var clip = moving && p.R.clips.walk ? p.R.clips.walk : (p.R.clips.idle || p.R.clips.walk); if (p.act !== clip) { if (p.act) p.act.fadeOut(0.3); clip.reset().fadeIn(0.3).play(); if (moving) clip.timeScale = p.speed / ((INFO(p.k) || {}).walk_speed || 0.72); p.act = clip; }
      g.position.set(p.x, p.base !== undefined ? p.base : gy(p.x, p.z), p.z); g.rotation.y = p.yaw; if (vis) p.R.mixer.update(Math.min(dt, 0.1)); }
  }

  // ── frame hook ──
  var built = false, decalDone = false, lastSteel = 0;
  function frameHook(dt, now) {
    if (!window.PLAN) return;
    if (!built) { built = true; try { windowize(); } catch (e) { note("windows", e); } try { vehicleSolids(); } catch (e) { note("solids", e); } try { helipad(); } catch (e) { note("helipad", e); } try { towbar(); } catch (e) { note("towbar", e); } try { peopleSetup(); } catch (e) { note("people", e); } }
    if (!decalDone && (FRAME_N & 31) === 0) { try { decalDone = decal(); } catch (e) { decalDone = true; note("decal", e); } }
    if (now - lastSteel > 3000) { lastSteel = now; mirrorSteel(); }
    if (SC.padLamp) { var nt = 0; try { nt = WIN.u.uNight.value; } catch (e) {} SC.padLamp.emissiveIntensity = nt > 0.3 ? 1.6 + 0.4 * Math.sin(now / 400) : 0; }
    try { peopleFrame(dt || 0.016); } catch (e) { if (!SC.pfErr) { SC.pfErr = 1; note("people frame", e); } }
  }
  HK.frame.push({ name: "showcaseFrame", fn: frameHook });
})();
