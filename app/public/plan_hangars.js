// plan_hangars.js · HGR (29 Sep 2026): the Stellar Aviation hangars. Classic script, loaded before client.js (after plan_rides.js);
// no top-level const/let; everything lives in the IIFE and on window.PLAN_HANGARS.
//
// What it does (PLAN mode only; the legacy world never runs these hooks):
// - every plan building of kind "hangar" (27 in plan.json, plus the Giveback Shop the client places on Hangar Lane) moves from the
//   old weathered bow-truss model to the new executive hangar "hangar_exec" (21 x 8 x 24 m, plan_models_r2.js), keeping its
//   plan position, yaw and scale. The old 10.3 m circle collider (the 21 x 24 box was not covered: corners and the front and back
//   walls could be walked into) becomes oriented wall solids, a door solid while the door is shut, inner circles for the camera
//   pull-in and scatter, and keep-outs so nothing grows in front of a door.
// - on every hangar: a clean champagne fascia over the door with a large STELLAR AVIATION sign (the terminal booth's wordmark,
//   drawn in type), lit at night; the hangar number (H1 ...) on a navy aviation plate; a name plate by the office entrance for
//   the hangars with a use (flight school, museum, workshops); a bronze jamb round the door opening; a glazed one-piece
//   hydraulic hangar door that swings up into a canopy when you walk up to it (or on E) and glows warm at night.
// - the interior of the nearest hangar is built when you come within about 45 m (so the opening door shows the inside) and
//   disposed at 70 m: polished epoxy floor with a Stellar inlay and safety markings, lined walls, trusses and LED high-bays,
//   the parked business jet (jet_light; jet_mid in the large City hangar; the 1928 biplane in the museum), a tug, a ground
//   power unit, tool chests, workbenches, parts racks, fire stations, a stair to a mezzanine with a glass balustrade: crew
//   lounge (sofas, a screen, a coffee bar) and the flight planning office, a Stellar brand wall; the Stellar crew chief with a
//   talk card (plan/hangars.json), the aircraft card on E, seats you can sit in, a hangar hum.
// Walking through the open door sets the client's `inside` (its prompts, seats, talk cards, floor and camera rules) without a
// fade or a teleport; walking back out clears it. The client's enterInterior / leaveInterior / openNearest / updateZone are
// wrapped by bare name in the world hook and fall through to the originals for everything else.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || [];
window.PLAN_TALK = window.PLAN_TALK || {};
window.PLAN_HANGARS = window.PLAN_HANGARS || {};
(function () {
  "use strict";
  var H = window.PLAN_HANGARS;
  var KIND = "hangar_exec";
  H.v = 1; H.errs = H.errs || []; H.list = H.list || []; H.n = H.n || {}; H.cfg = H.cfg || null; H.off = !!H.off;
  ["hangar_exec", "jet_light", "jet_mid", "biplane", "exec_desk", "lounge_chair", "term_planter"].forEach(function (k) { if (window.PLAN_MODEL_NEEDS.indexOf(k) < 0) window.PLAN_MODEL_NEEDS.push(k); });
  function note(tag, e) { try { if (H.errs.length < 40) H.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (H.errs.length <= 5) console.warn("plan_hangars " + tag, e); } catch (x) {} }
  var TAU = Math.PI * 2;
  var cl = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var ease = function (t) { t = cl(t, 0, 1); return t * t * (3 - 2 * t); };

  // ───────────────────────── editable data (plan/hangars.json) with a built-in fallback ─────────────────────────
  var DEF = {
    numbers: {}, signs: { a2_giveback_shop: "GIVEBACK SHOP" }, names: {},
    aircraft: { jet_light: { t: "Light business jet", k: "Parked in {hangar} · Sunfield hangar services", p: "A light business jet: range about 2,000 nautical miles, up to 8 passengers and 2 crew." }, jet_mid: { t: "Midsize business jet", k: "Parked in {hangar}", p: "A midsize business jet: range about 3,000 nautical miles, 8 to 9 passengers." }, biplane: { t: "1928-era biplane", k: "On display in {hangar}", p: "An open-cockpit biplane of the kind that flew in when the field was new." } },
    chief: { name: "Sunfield crew chief", role: "Sunfield · hangar and line services", greet: ["Welcome to Sunfield."], talk: [{ t: "Welcome to the hangar. The Sunfield team looks after the hangars and ground services out here on the Flight Line.", o: [["Thanks", null]] }] }
  };
  function C() { return H.cfg || DEF; }
  try { fetch((window.AV || String)("/plan/hangars.json?v=" + (window.BUILD || "0"))).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && typeof j === "object") { H.cfg = Object.assign({}, DEF, j); try { refreshTalk(); } catch (e) {} try { if (EX.built && H.impl && H.api) H.api.rebuildAll(); } catch (e) { note("json late", e); } } }).catch(function (e) { note("json", e); }); } catch (e) { note("json", e); }

  // ───────────────────────── model anchors (PLAN_MODEL_INFO.hangar_exec, else the measured defaults) ─────────────────────────
  function INFO() {
    var I = window.PLAN_MODEL_INFO && window.PLAN_MODEL_INFO[KIND];
    var d = { size: [21, 8, 24], wall_z: 11.34, door: { x0: -6.753, x1: 9.564, y1: 5.773, z: 10.992 }, tower: { x0: -10.5, x1: -6.753 }, fascia: { y0: 5.93, y1: 7.6 }, roof: 8.0 };
    if (!I) return d; return { size: I.size || d.size, wall_z: I.wall_z || d.wall_z, door: I.door || d.door, tower: I.tower || d.tower, fascia: I.fascia || d.fascia, roof: I.roof || d.roof };
  }

  // ───────────────────────── small canvas and geometry helpers ─────────────────────────
  var FT = { ui: "'Space Grotesk', 'Segoe UI', system-ui, sans-serif", heavy: "'Segoe UI Black', 'Arial Black', 'Helvetica Neue', Arial, sans-serif", cond: "'Bahnschrift', 'DIN Alternate', 'Arial Narrow', 'Segoe UI', sans-serif", mono: "'JetBrains Mono', Consolas, monospace" };
  var TX = H.tx = H.tx || {};
  function cv(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function mkTex(c, rep, lin) { var t = new THREE.CanvasTexture(c); if (!lin) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; try { t.anisotropy = Math.min(8, typeof MAX_ANISO !== "undefined" ? MAX_ANISO : 8); } catch (e) { t.anisotropy = 8; } t.needsUpdate = true; return t; }
  function txt(x, t, px, py, font, color, ls, align, maxW) { x.font = font; x.fillStyle = color; x.textAlign = align || "center"; x.textBaseline = "middle"; try { x.letterSpacing = (ls || 0) + "px"; } catch (e) {} if (maxW) { var w = x.measureText(t).width; if (w > maxW) { x.save(); x.translate(px, py); x.scale(maxW / w, 1); x.fillText(t, 0, 0); x.restore(); try { x.letterSpacing = "0px"; } catch (e) {} return; } } x.fillText(t, px, py); try { x.letterSpacing = "0px"; } catch (e) {} }
  function rrect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.lineTo(a + w - r, b); x.quadraticCurveTo(a + w, b, a + w, b + r); x.lineTo(a + w, b + h - r); x.quadraticCurveTo(a + w, b + h, a + w - r, b + h); x.lineTo(a + r, b + h); x.quadraticCurveTo(a, b + h, a, b + h - r); x.lineTo(a, b + r); x.quadraticCurveTo(a, b, a + r, b); x.closePath(); }
  function panel(key, W, Hh, fn, rep, lin) { if (TX[key]) return TX[key]; var c = cv(W, Hh), x = c.getContext("2d"); try { fn(x, W, Hh); } catch (e) { note("panel " + key, e); } return (TX[key] = mkTex(c, rep, lin)); }
  // the Stellar Aviation wordmark as the terminal's partner booth draws it (plan_terminal.js stellarMark): blue STELLAR with the
  // S roundel, the grey swoosh, AVIATION beneath; light = a pale version for dark grounds
  function stellarMark(x, cx, cy, s, light, sign) {
    if (window.PLAN_TERMINAL && typeof window.PLAN_TERMINAL.stellarMark === "function" && !light && !sign) { try { window.PLAN_TERMINAL.stellarMark(x, cx, cy, s); return; } catch (e) {} }
    var blue = light ? "#8cc0f2" : "#1464b4", grey = light ? "#c9ced3" : "#7c8288";
    x.save(); x.translate(cx, cy); x.scale(s, s);
    var gr = x.createLinearGradient(-300, 0, 300, 0); gr.addColorStop(0, light ? "rgba(210,214,218,0.1)" : "rgba(140,146,152,0.1)"); gr.addColorStop(0.35, light ? "rgba(214,218,222,0.95)" : "rgba(128,134,140,0.95)"); gr.addColorStop(1, light ? "rgba(220,224,228,0.9)" : "rgba(150,156,162,0.9)");
    x.strokeStyle = gr; x.lineCap = "round"; x.lineWidth = 9; x.beginPath(); x.ellipse(-60, 6, 250, 62, -0.06, Math.PI * 1.02, Math.PI * 1.9); x.stroke(); x.lineWidth = 6; x.beginPath(); x.ellipse(-70, 2, 236, 52, -0.04, Math.PI * 0.12, Math.PI * 0.62); x.stroke();
    x.fillStyle = blue; x.beginPath(); x.arc(-232, -2, 46, 0, TAU); x.fill(); x.fillStyle = light ? "#0e2440" : "#ffffff"; x.beginPath(); x.arc(-232, -2, 33, 0, TAU); x.fill(); txt(x, "S", -232, 2, "900 64px " + FT.heavy, blue, 0);
    x.save(); x.scale(1.18, 1); txt(x, "UNFIELD", 30 / 1.18, -2, "900 78px " + FT.heavy, blue, 6, "center", 336); x.restore();
    if (sign) txt(x, "AIRPORT", 104, 66, "600 42px " + FT.ui, "#4f565d", 16, "center"); else txt(x, "AIRPORT", 110, 58, "400 30px " + FT.ui, grey, 11, "center"); x.restore();
  }
  // the bundle has no BufferGeometryUtils: merge position / normal / uv / index ourselves (like the client's mergeMeshes)
  function mergeGeos(list) {
    var nv = 0, ni = 0; for (var i = 0; i < list.length; i++) { var g = list[i]; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    var pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), nrm = new Float32Array(nv * 3), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni); var vo = 0, io = 0, re = null;
    for (var j0 = 0; j0 < list.length; j0++) if (list[j0].attributes.riE) { re = new Float32Array(nv * 4); break; }   // R18: the prop layer's face frame where boxes have it
    for (var j = 0; j < list.length; j++) { var q = list[j]; var c = q.attributes.position.count; pos.set(q.attributes.position.array, vo * 3); if (q.attributes.uv) uv.set(q.attributes.uv.array, vo * 2); if (q.attributes.normal) nrm.set(q.attributes.normal.array, vo * 3); if (re && q.attributes.riE) re.set(q.attributes.riE.array, vo * 4);
      if (q.index) { var ia = q.index.array; for (var k = 0; k < ia.length; k++) idx[io + k] = ia[k] + vo; io += ia.length; } else { for (var k2 = 0; k2 < c; k2++) idx[io + k2] = vo + k2; io += c; } vo += c; }
    var out = new THREE.BufferGeometry(); out.setAttribute("position", new THREE.BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3)); out.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); out.setIndex(new THREE.BufferAttribute(idx, 1)); if (re) out.setAttribute("riE", new THREE.BufferAttribute(re, 4)); out.computeBoundingSphere(); out.computeBoundingBox(); return out;
  }
  H.mergeGeos = mergeGeos;
  function riBox(g, w, h, d) { try { if (!(window.PLAN_RL && PLAN_RL.propOn && PLAN_RL.propOn())) return; } catch (e) { return; } var uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]], re = new Float32Array(uv.count * 4);
    for (var f = 0; f < 6; f++) for (var k = 0; k < 4; k++) { var i = f * 4 + k; re[i * 4] = (uv.getX(i) - 0.5) * dims[f][0]; re[i * 4 + 1] = (uv.getY(i) - 0.5) * dims[f][1]; re[i * 4 + 2] = dims[f][0] / 2; re[i * 4 + 3] = dims[f][1] / 2 + 2; } g.setAttribute("riE", new THREE.BufferAttribute(re, 4)); }
  // geometry kit: primitives collected per material key, merged into one mesh per material
  function Kit() { this.m = new Map(); }
  Kit.prototype.put = function (key, geo) { var a = this.m.get(key); if (!a) { a = []; this.m.set(key, a); } if (geo.index === null) geo = geo; a.push(geo); return geo; };
  Kit.prototype.box = function (key, w, h, d, x, y, z, ry, uvm) { if (!uvm && TILE[key]) uvm = TILE[key]; var g = new THREE.BoxGeometry(w, h, d); riBox(g, w, h, d); if (uvm) uvScaleBox(g, w, h, d, uvm); var m = new THREE.Matrix4().makeRotationY(ry || 0); m.setPosition(x, y, z); g.applyMatrix4(m); return this.put(key, g); };
  Kit.prototype.cyl = function (key, r1, r2, h, x, y, z, seg, rx, rz) { var g = new THREE.CylinderGeometry(r1, r2, h, seg || 12); var m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx || 0, 0, rz || 0)); m.setPosition(x, y, z); g.applyMatrix4(m); return this.put(key, g); };
  // a quad facing +z at its origin, w x h, rotated by ry (and rx), uv in metres / tile when tile is given (else 0..1)
  Kit.prototype.quad = function (key, w, h, x, y, z, ry, rx, tile) { var g = new THREE.PlaneGeometry(w, h); if (tile) { var uv = g.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile[0] + (tile[2] || 0), uv.getY(i) * h / tile[1] + (tile[3] || 0)); } var m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, 0, "YXZ")); m.setPosition(x, y, z); g.applyMatrix4(m); return this.put(key, g); };
  Kit.prototype.build = function (group, mats, opts) { var out = [];
    this.m.forEach(function (list, key) { var mat = mats[key]; if (!mat) { note("kit", new Error("no material " + key)); return; } var one = null; try { one = mergeGeos(list); } catch (e) { note("merge " + key, e); one = null; }
      if (one) { list.forEach(function (g) { g.dispose(); }); var mesh = new THREE.Mesh(one, mat); mesh.castShadow = !(opts && opts.noShadow) && !mat.transparent && !(mat.userData && mat.userData.noShadow); mesh.receiveShadow = true; mesh.userData.hgrKey = key; if (mat.userData && mat.userData.noSolid) mesh.userData.noSolid = true; group.add(mesh); out.push(mesh); }
      else list.forEach(function (g) { var mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; group.add(mesh); out.push(mesh); }); });
    this.m.clear(); return out; };
  var TILE = { walnut: 0.9, stone: 1.0, bench: 1.0, deck: 2.0, liner: 1.2 };
  function uvScaleBox(g, w, h, d, t) { var uv = g.attributes.uv; var dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (var f = 0; f < 6; f++) for (var k = 0; k < 4; k++) { var i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } }

  // ───────────────────────── shared materials (made once) ─────────────────────────
  var MT = null;
  function tiled(path, rx, ry, col, rough, nk) { try { var ld = new THREE.TextureLoader(); var mk = function (p, srgb) { var t = ld.load(p); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }; return new THREE.MeshStandardMaterial({ map: mk(path + ".jpg", true), normalMap: mk(path + "_n.jpg"), roughnessMap: mk(path + "_r.jpg"), color: col || 0xffffff, roughness: rough || 1, normalScale: new THREE.Vector2(nk || 0.6, nk || 0.6) }); } catch (e) { note("tiled " + path, e); return new THREE.MeshStandardMaterial({ color: col || 0xcccccc, roughness: rough || 0.8 }); } }
  function mats() {
    if (MT) return MT; var S = function (o) { return new THREE.MeshStandardMaterial(o); };
    var env = roomEnv();
    MT = {
      epoxy: S({ map: epoxyTex(), color: 0xe4e6e6, roughness: 0.16, metalness: 0.0, envMap: env, envMapIntensity: 0.85 }),
      lineY: S({ color: 0xe6b422, roughness: 0.35, envMap: env, envMapIntensity: 0.5 }), lineW: S({ color: 0xf2f2ef, roughness: 0.35, envMap: env, envMapIntensity: 0.5 }), lineR: S({ color: 0xb8262b, roughness: 0.4, envMap: env, envMapIntensity: 0.5 }),
      inlay: new THREE.MeshStandardMaterial({ map: inlayTex(), transparent: true, roughness: 0.14, metalness: 0.15, envMap: env, envMapIntensity: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false }),
      liner: S({ map: linerTex(), color: 0xf4f3ef, roughness: 0.62, metalness: 0.05, envMap: env, envMapIntensity: 0.5 }),
      dado: S({ color: 0x5b6168, roughness: 0.55, metalness: 0.35, envMap: env, envMapIntensity: 0.6 }),
      deck: S({ map: deckTex(), color: 0xeceeef, roughness: 0.7, metalness: 0.2, envMap: env, envMapIntensity: 0.4 }),
      truss: S({ color: 0xe3e6e9, roughness: 0.5, metalness: 0.35, envMap: env, envMapIntensity: 0.6 }),
      steel: S({ color: 0x3b4148, roughness: 0.45, metalness: 0.6, envMap: env, envMapIntensity: 0.8 }),
      brushed: S({ color: 0xbfc4c9, roughness: 0.28, metalness: 0.9, envMap: env, envMapIntensity: 1.0 }),
      lamp: S({ color: 0xffffff, emissive: 0xf2f6ff, emissiveIntensity: 2.4, roughness: 0.3 }),
      lampW: S({ color: 0xffffff, emissive: 0xffe2b8, emissiveIntensity: 1.8, roughness: 0.3 }),
      housing: S({ color: 0x2c3036, roughness: 0.4, metalness: 0.7 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xd8ecf2, roughness: 0.04, metalness: 0.15, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, envMap: env, envMapIntensity: 1.2 }),
      stellar: S({ color: 0x1464b4, roughness: 0.35, metalness: 0.4, envMap: env, envMapIntensity: 0.8 }),
      navy: S({ color: 0x0f2745, roughness: 0.5, metalness: 0.2, envMap: env, envMapIntensity: 0.5 }),
      chest: S({ map: drawerTex(), color: 0xffffff, roughness: 0.3, metalness: 0.45, envMap: env, envMapIntensity: 0.9 }),
      red: S({ color: 0xc41e24, roughness: 0.35, metalness: 0.2, envMap: env, envMapIntensity: 0.7 }),
      yellow: S({ color: 0xf0b91c, roughness: 0.45, metalness: 0.2, envMap: env, envMapIntensity: 0.5 }),
      orange: S({ color: 0xe0621d, roughness: 0.5, metalness: 0.3, envMap: env, envMapIntensity: 0.5 }),
      rubber: S({ color: 0x17181a, roughness: 0.92 }),
      white: S({ color: 0xf1f1ee, roughness: 0.45, metalness: 0.1, envMap: env, envMapIntensity: 0.6 }),
      bench: S({ color: 0x8a6a48, roughness: 0.55, map: (typeof TEX !== "undefined" && TEX.wood) || null, envMap: env, envMapIntensity: 0.4 }),
      peg: S({ map: pegTex(), roughness: 0.8 }),
      box: S({ color: 0xb0875a, roughness: 0.9 }), bin: S({ color: 0x1c5fa8, roughness: 0.6 }), bin2: S({ color: 0x9aa3ab, roughness: 0.6 }),
      walnut: (typeof TEX !== "undefined" && TEX.wood) ? S({ map: TEX.wood, color: 0x9a7552, roughness: 0.5, metalness: 0.05, envMap: env, envMapIntensity: 0.5 }) : tiled("/tex/jet_walnut", 1, 1, 0x8a735f, 0.55, 0.5),
      leather: tiled("/tex/jet_leather", 1, 1, 0x3b3530, 0.7, 0.6),
      fabric: S({ color: 0x2c3a4f, roughness: 0.95 }), fabric2: S({ color: 0xb9a78a, roughness: 0.95 }),
      rug: tiled("/tex/jet_carpet", 1, 1, 0x7c7468, 1, 0.5),
      stone: tiled("/tex/travertine", 1, 1, 0xefe3cf, 1, 0.5),
      chrome: S({ color: 0xd9dde1, roughness: 0.18, metalness: 1.0, envMap: env, envMapIntensity: 1.2 }),
      black: S({ color: 0x141517, roughness: 0.35, metalness: 0.2 }),
      screen: new THREE.MeshBasicMaterial({ map: screenTex(), toneMapped: false }),
      wx: new THREE.MeshBasicMaterial({ map: wxTex(), toneMapped: false }),
      brand: new THREE.MeshStandardMaterial({ map: brandTex(), emissiveMap: brandTex(), emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.4, transparent: false }),
      window: new THREE.MeshBasicMaterial({ map: windowTex(), toneMapped: true }),
      clere: new THREE.MeshBasicMaterial({ color: 0xd9ecff }),
      label: null
    };
    MT.glass.userData.noSolid = true; MT.inlay.userData.noSolid = true; MT.lamp.userData.noShadow = true; MT.lampW.userData.noShadow = true;
    // R18 (Agent I2): names for the surface pass and prop layer (plan_roomlight.js), applied before any of these compile (?rip=0 / ?ris=0 off)
    try { if (window.PLAN_RL && PLAN_RL.surfMat && PLAN_RL.propOn && PLAN_RL.propOn()) for (var nk in MT) { var m3 = MT[nk]; if (!m3 || !m3.isMeshStandardMaterial || m3.transparent || m3.alphaTest > 0) continue; if (!m3.name) m3.name = "rg_" + nk; PLAN_RL.surfMat(m3); } } catch (e) { note("r18 surf", e); }
    return MT;
  }
  // a warm neutral room as the reflection probe of the interior materials (the sky probe would put blue sky on the epoxy)
  // R5: after a WebGL context loss the one-time room probe is empty: plan_perf calls this on restore to draw it again
  H.restoreEnv = function () { var old = H.env; if (old === undefined) return false; H.env = undefined; var t = roomEnv(); try { scene.traverse(function (o) { var ms = o.material; if (!ms) return; ms = Array.isArray(ms) ? ms : [ms]; for (var i = 0; i < ms.length; i++) if (ms[i] && ms[i].envMap === old) { ms[i].envMap = t; ms[i].needsUpdate = true; } }); if (MT) for (var k in MT) { var m = MT[k]; if (m && m.envMap === old) { m.envMap = t; m.needsUpdate = true; } } } catch (e) { note("restore env", e); } return !!t; };
  function roomEnv() {
    if (H.env !== undefined) return H.env; H.env = null;
    try { var sc = new THREE.Scene(); var c = cv(256, 128), x = c.getContext("2d"); var g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, "#fbfbf8"); g.addColorStop(0.45, "#bfc1c0"); g.addColorStop(0.55, "#8f918f"); g.addColorStop(1, "#5d5f5f"); x.fillStyle = g; x.fillRect(0, 0, 256, 128);
      x.fillStyle = "#ffffff"; for (var i = 0; i < 6; i++) { x.beginPath(); x.ellipse(20 + i * 44, 10, 10, 4, 0, 0, TAU); x.fill(); } x.fillStyle = "rgba(255,244,220,0.9)"; x.fillRect(96, 44, 64, 24);
      var t = mkTex(c); t.mapping = THREE.EquirectangularReflectionMapping; var pm = new THREE.PMREMGenerator(renderer); H.env = pm.fromEquirectangular(t).texture; pm.dispose(); t.dispose(); } catch (e) { note("env", e); H.env = null; }
    return H.env;
  }
  function epoxyTex() { return panel("epoxy", 512, 512, function (x, W, Hh) { x.fillStyle = "#c9cccc"; x.fillRect(0, 0, W, Hh); for (var i = 0; i < 2600; i++) { var a = Math.random(); x.fillStyle = a < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"; var r = 2 + Math.random() * 18; x.beginPath(); x.arc(Math.random() * W, Math.random() * Hh, r, 0, TAU); x.fill(); } for (var j = 0; j < 900; j++) { x.fillStyle = ["rgba(70,74,78,0.5)", "rgba(245,245,240,0.6)", "rgba(120,126,132,0.5)"][j % 3]; x.fillRect(Math.random() * W, Math.random() * Hh, 1.4, 1.4); } }, true); }
  function linerTex() { return panel("liner", 512, 512, function (x, W, Hh) { x.fillStyle = "#f3f2ee"; x.fillRect(0, 0, W, Hh); for (var i = 0; i < 64; i++) { x.fillStyle = i % 2 ? "rgba(0,0,0,0.025)" : "rgba(255,255,255,0.04)"; x.fillRect(0, i * 8, W, 4); } x.fillStyle = "rgba(60,64,70,0.35)"; x.fillRect(0, 0, W, 3); x.fillStyle = "rgba(255,255,255,0.6)"; x.fillRect(0, 3, W, 2); x.fillStyle = "rgba(60,64,70,0.18)"; x.fillRect(0, 0, 2, Hh); }, true); }
  function deckTex() { return panel("deck", 256, 256, function (x, W, Hh) { x.fillStyle = "#e9ebec"; x.fillRect(0, 0, W, Hh); for (var i = 0; i < 4; i++) { var g = x.createLinearGradient(i * 64, 0, i * 64 + 64, 0); g.addColorStop(0, "#c7cacd"); g.addColorStop(0.2, "#f7f8f8"); g.addColorStop(0.5, "#dadcde"); g.addColorStop(0.8, "#f4f5f6"); g.addColorStop(1, "#c4c7ca"); x.fillStyle = g; x.fillRect(i * 64, 0, 64, Hh); } }, true); }
  function drawerTex() { return panel("drawer", 256, 512, function (x, W, Hh) { x.fillStyle = "#1464b4"; x.fillRect(0, 0, W, Hh); var rows = [0, 40, 80, 120, 170, 230, 300, 390, 512]; for (var i = 0; i < rows.length - 1; i++) { x.fillStyle = "rgba(0,0,0,0.35)"; x.fillRect(0, rows[i], W, 3); x.fillStyle = "#c9cfd5"; x.fillRect(W * 0.2, rows[i] + 10, W * 0.6, 6); } x.fillStyle = "rgba(255,255,255,0.12)"; x.fillRect(0, 0, 6, Hh); }); }
  function pegTex() { return panel("peg", 512, 256, function (x, W, Hh) { x.fillStyle = "#d9d6cf"; x.fillRect(0, 0, W, Hh); x.fillStyle = "rgba(60,60,60,0.35)"; for (var i = 8; i < W; i += 16) for (var j = 8; j < Hh; j += 16) x.fillRect(i, j, 3, 3); var tools = [[40, 60, 12, 110, "#c0282d"], [80, 50, 10, 130, "#1b1b1b"], [120, 70, 60, 14, "#9aa1a8"], [200, 40, 14, 120, "#e0621d"], [240, 60, 10, 100, "#1b1b1b"], [290, 50, 80, 16, "#9aa1a8"], [300, 90, 70, 12, "#1464b4"], [400, 40, 12, 140, "#c0282d"], [440, 60, 30, 30, "#f0b91c"]]; tools.forEach(function (t) { x.fillStyle = t[4]; rrect(x, t[0], t[1], t[2], t[3], 4); x.fill(); }); }); }
  function inlayTex() { return panel("inlay", 1024, 1024, function (x, W, Hh) { x.clearRect(0, 0, W, Hh); x.fillStyle = "#0f2745"; x.beginPath(); x.arc(W / 2, Hh / 2, 500, 0, TAU); x.fill(); x.strokeStyle = "#c9a24d"; x.lineWidth = 14; x.beginPath(); x.arc(W / 2, Hh / 2, 486, 0, TAU); x.stroke(); x.lineWidth = 4; x.beginPath(); x.arc(W / 2, Hh / 2, 462, 0, TAU); x.stroke(); stellarMark(x, W / 2 + 22, Hh / 2 - 20, 1.45, true); txt(x, "HANGAR AND GROUND SERVICES", W / 2, Hh / 2 + 190, "600 34px " + FT.ui, "#c9a24d", 10); }); }
  function brandTex() { return panel("brandwall", 2048, 576, function (x, W, Hh) { x.fillStyle = "#fbfaf7"; x.fillRect(0, 0, W, Hh); stellarMark(x, W / 2 + 40, Hh / 2 - 30, 2.6); txt(x, "HANGAR AND GROUND SERVICES · EVERY FLIGHT, ONE FRONT DOOR", W / 2, Hh - 70, "600 40px " + FT.ui, "#6c737a", 10); x.fillStyle = "#1464b4"; x.fillRect(0, Hh - 14, W, 14); }); }
  function screenTex() { return panel("screen", 1024, 576, function (x, W, Hh) { x.fillStyle = "#0b1626"; x.fillRect(0, 0, W, Hh); stellarMark(x, 250, 90, 0.62, true); txt(x, "CREW LOUNGE", W - 60, 70, "600 30px " + FT.ui, "#8cc0f2", 8, "right"); x.fillStyle = "rgba(140,192,242,0.25)"; x.fillRect(40, 150, W - 80, 2);
      var rows = [["FLIGHT", "DESTINATION", "CREW", "STATUS"], ["N28SA", "Los Angeles KLAX", "Ready", "ON TIME"], ["N414G", "Dallas KDFW", "Briefing", "ON TIME"], ["N70ST", "Denver KDEN", "Arriving", "LANDED"], ["N12JF", "Chicago KORD", "Planning", "ON TIME"], ["N91GV", "Seattle KSEA", "Boarding", "BOARDING"]];
      rows.forEach(function (r, i) { var y = 196 + i * 58; var head = i === 0; [60, 260, 610, 820].forEach(function (cx, k) { txt(x, r[k], cx, y, (head ? "600 22px " : "500 30px ") + (k === 0 ? FT.mono : FT.ui), head ? "#6f8fb3" : k === 3 ? (r[k] === "LANDED" ? "#8fd8a3" : "#f4cd5a") : "#eef3f8", head ? 4 : 1, "left"); }); if (!head) { x.fillStyle = "rgba(255,255,255,0.05)"; x.fillRect(40, y + 26, W - 80, 1); } });
      txt(x, "WEATHER  KSNF  CLEAR · WIND 240 AT 8 · VIS 10+", W / 2, Hh - 32, "500 24px " + FT.mono, "#9cc6f2", 2); }); }
  function wxTex() { return panel("wx", 1024, 640, function (x, W, Hh) { x.fillStyle = "#e9e4d6"; x.fillRect(0, 0, W, Hh); x.strokeStyle = "rgba(90,120,160,0.35)"; x.lineWidth = 1; for (var i = 0; i < W; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, Hh); x.stroke(); } for (var j = 0; j < Hh; j += 64) { x.beginPath(); x.moveTo(0, j); x.lineTo(W, j); x.stroke(); }
      x.fillStyle = "rgba(196,170,120,0.35)"; for (var k = 0; k < 9; k++) { x.beginPath(); x.ellipse(120 + k * 100, 200 + Math.sin(k) * 120, 140, 60, k, 0, TAU); x.fill(); }
      x.strokeStyle = "#8a3aa0"; x.lineWidth = 3; x.beginPath(); x.arc(520, 330, 90, 0, TAU); x.stroke(); x.fillStyle = "#1464b4"; x.beginPath(); x.arc(520, 330, 8, 0, TAU); x.fill(); txt(x, "SUNFIELD", 520, 300, "700 22px " + FT.ui, "#1464b4", 3);
      x.strokeStyle = "#c0282d"; x.lineWidth = 4; x.setLineDash([16, 10]); x.beginPath(); x.moveTo(520, 330); x.quadraticCurveTo(300, 200, 90, 120); x.stroke(); x.setLineDash([]); txt(x, "PLANNED ROUTE", 250, 170, "600 18px " + FT.ui, "#c0282d", 3);
      x.fillStyle = "rgba(15,39,69,0.9)"; x.fillRect(0, 0, W, 48); txt(x, "FLIGHT PLANNING · WINDS ALOFT · NOTAMS · WEIGHT AND BALANCE", 24, 25, "600 20px " + FT.ui, "#eef3f8", 3, "left"); }); }
  function windowTex() { return panel("window", 256, 512, function (x, W, Hh) { var g = x.createLinearGradient(0, 0, 0, Hh); g.addColorStop(0, "#9fc8ec"); g.addColorStop(0.55, "#dcebf5"); g.addColorStop(0.62, "#d9c7a4"); g.addColorStop(1, "#b89a70"); x.fillStyle = g; x.fillRect(0, 0, W, Hh); x.fillStyle = "rgba(120,110,95,0.6)"; x.beginPath(); x.moveTo(0, Hh * 0.6); for (var i = 0; i <= 8; i++) x.lineTo(i * W / 8, Hh * (0.57 + 0.03 * Math.sin(i * 1.7))); x.lineTo(W, Hh * 0.62); x.fill(); x.fillStyle = "#3a3024"; x.fillRect(0, 0, 10, Hh); x.fillRect(W - 10, 0, 10, Hh); x.fillRect(0, Hh / 2 - 5, W, 10); }); }

  // ───────────────────────── exterior: fascia, signs, numbers, name plates, jambs, doors (shared by all hangars) ─────────────────────────
  function signTex() { return panel("sign", 2048, 544, function (x, W, Hh) { x.clearRect(0, 0, W, Hh); stellarMark(x, W / 2 + 60, Hh / 2 - 44, 3.0, false, true); }); }
  function textGlowTex(text) { var key = "tglow:" + text; return panel(key, 2048, 384, function (x, W, Hh) { x.fillStyle = "#000"; x.fillRect(0, 0, W, Hh); txt(x, text, W / 2, Hh / 2 + 6, "800 200px " + FT.cond, "#dff7e6", 14, "center", W - 120); x.fillStyle = "#4DDE6F"; x.fillRect(W * 0.3, Hh - 30, W * 0.4, 10); }); }
  function textSignTex(text) { var key = "tsign:" + text; return panel(key, 2048, 384, function (x, W, Hh) { x.clearRect(0, 0, W, Hh); txt(x, text, W / 2, Hh / 2 + 6, "800 200px " + FT.cond, "#1b3a2a", 14, "center", W - 120); x.fillStyle = "#2a7a3e"; x.fillRect(W * 0.3, Hh - 30, W * 0.4, 10); }); }
  function fasciaTex() { return panel("fascia", 512, 128, function (x, W, Hh) { var g = x.createLinearGradient(0, 0, 0, Hh); g.addColorStop(0, "#d8ccb3"); g.addColorStop(1, "#cbbd9f"); x.fillStyle = g; x.fillRect(0, 0, W, Hh); x.fillStyle = "rgba(90,78,58,0.45)"; x.fillRect(0, 0, 2, Hh); x.fillStyle = "rgba(255,255,255,0.35)"; x.fillRect(2, 0, 2, Hh); x.fillStyle = "rgba(90,78,58,0.25)"; x.fillRect(0, Hh - 3, W, 3); }, true); }
  // hangar numbers and name plates live in one atlas each (one draw call for all hangars)
  function numberAtlas(list) { return panel("numbers", 2048, 1024, function (x, W, Hh) { x.clearRect(0, 0, W, Hh); list.forEach(function (n, i) { var cx = (i % 8) * 256, cy = Math.floor(i / 8) * 256; x.fillStyle = "#0f2745"; rrect(x, cx + 8, cy + 8, 240, 240, 18); x.fill(); x.strokeStyle = "#c9a24d"; x.lineWidth = 6; rrect(x, cx + 20, cy + 20, 216, 216, 12); x.stroke(); txt(x, n, cx + 128, cy + 134, "700 " + (n.length > 3 ? 104 : 128) + "px " + FT.cond, "#ffffff", 2, "center", 200); }); }); }
  function plateAtlas(list) { return panel("plates", 2048, 2048, function (x, W, Hh) { x.clearRect(0, 0, W, Hh); list.forEach(function (p, i) { var cx = (i % 2) * 1024, cy = Math.floor(i / 2) * 128; x.fillStyle = "#15191d"; rrect(x, cx + 6, cy + 6, 1012, 116, 10); x.fill(); x.fillStyle = "#c9a24d"; x.fillRect(cx + 24, cy + 22, 6, 84); txt(x, p[0], cx + 52, cy + 48, "700 44px " + FT.cond, "#ffffff", 6, "left", 900); txt(x, p[1], cx + 52, cy + 92, "500 26px " + FT.ui, "#b9c4cf", 4, "left", 900); }); }); }
  function doorGlowTex() { return panel("doorglow", 512, 256, function (x, W, Hh) { var g = x.createLinearGradient(0, 0, 0, Hh); g.addColorStop(0, "#fff1d6"); g.addColorStop(0.35, "#e9c792"); g.addColorStop(1, "#6d5436"); x.fillStyle = g; x.fillRect(0, 0, W, Hh); for (var i = 0; i < 5; i++) { var rg = x.createRadialGradient(60 + i * 98, 18, 2, 60 + i * 98, 18, 70); rg.addColorStop(0, "rgba(255,255,255,0.9)"); rg.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = rg; x.fillRect(0, 0, W, 110); } var b = x.createLinearGradient(0, Hh * 0.6, 0, Hh); b.addColorStop(0, "rgba(255,236,205,0)"); b.addColorStop(1, "rgba(255,236,205,0.35)"); x.fillStyle = b; x.fillRect(0, Hh * 0.6, W, Hh * 0.4); }); }
  function glowTex() { return panel("glow", 128, 128, function (x, W, Hh) { var g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,236,200,0.9)"); g.addColorStop(0.5, "rgba(255,220,170,0.35)"); g.addColorStop(1, "rgba(255,210,160,0)"); x.fillStyle = g; x.fillRect(0, 0, W, Hh); }); }

  var EX = H.ex = H.ex || {};
  function exMats() {
    if (EX.m) return EX.m; var env = null; try { env = scene.environment || null; } catch (e) {}
    EX.m = {
      fascia: new THREE.MeshStandardMaterial({ map: fasciaTex(), color: 0xffffff, roughness: 0.42, metalness: 0.35 }),
      sign: new THREE.MeshStandardMaterial({ map: signTex(), emissiveMap: signTex(), emissive: 0xffffff, emissiveIntensity: 0, transparent: true, alphaTest: 0.05, roughness: 0.3, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      jamb: new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.35, metalness: 0.75 }),
      track: new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.5, metalness: 0.6 }),
      doorFrame: new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.32, metalness: 0.8, side: THREE.DoubleSide }),
      doorGlass: new THREE.MeshStandardMaterial({ color: 0x1b2023, roughness: 0.05, metalness: 0.55, emissiveMap: doorGlowTex(), emissive: 0xffffff, emissiveIntensity: 0, side: THREE.DoubleSide, envMapIntensity: 1.3 }),
      lightF: new THREE.MeshStandardMaterial({ color: 0x2b2d30, emissive: 0xfff0d8, emissiveIntensity: 0, roughness: 0.4, metalness: 0.6 }),
      pool: new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      numbers: null, plates: null, textSigns: {}
    };
    EX.m.doorGlass.userData.noSolid = true; EX.m.pool.userData.noSolid = true;
    return EX.m;
  }

  // one glazed one-piece hydraulic hangar door (model units, pivot at the head of the opening, panel hanging down along -y);
  // frame and glass are separate geometries for two instanced meshes
  function doorGeos(I) {
    var w = I.door.x1 - I.door.x0 - 0.1, h = I.door.y1 - 0.06; var fr = [], gl = [];
    var B = function (bw, bh, bd, x, y, z) { var g = new THREE.BoxGeometry(bw, bh, bd); g.translate(x, y, z); fr.push(g); };
    var n = Math.max(6, Math.round(w / 1.35)); var bayW = w / n; var tr = h * 0.14;
    B(w, 0.16, 0.16, 0, -0.08, 0); B(w, 0.24, 0.18, 0, -h + 0.12, 0); B(0.14, h, 0.16, -w / 2 + 0.07, -h / 2, 0); B(0.14, h, 0.16, w / 2 - 0.07, -h / 2, 0); B(w, 0.1, 0.14, 0, -tr, 0);
    for (var i = 1; i < n; i++) B(0.08, h - 0.2, 0.13, -w / 2 + i * bayW, -h / 2, 0);
    B(w, 0.06, 0.05, 0, -h + 0.02, 0.1);
    var g = new THREE.PlaneGeometry(w - 0.2, h - 0.3); g.translate(0, -h / 2 + 0.02, 0.0); gl.push(g);
    return { frame: mergeGeos(fr), glass: gl[0], w: w, h: h };
  }

  // ───────────────────────── rekind: the plan's hangars onto hangar_exec ─────────────────────────
  function l2w(e, lx, lz) { var c = Math.cos(e[3]), s = Math.sin(e[3]); return [e[0] + lx * c + lz * s, e[2] - lx * s + lz * c]; }
  function w2l(e, x, z) { var dx = x - e[0], dz = z - e[2], c = Math.cos(e[3]), s = Math.sin(e[3]); return [dx * c - dz * s, dx * s + dz * c]; }
  function rekind(tag) {
    var n = 0; var list = PLACE.hangar; if (!list || !list.length || !MODELS[KIND] || !MODEL_SPECS[KIND]) return 0;
    var keep = []; var dst = PLACE[KIND] || (PLACE[KIND] = []);
    for (var i = 0; i < list.length; i++) {
      var e = list[i]; if (e.hgrKeep) { keep.push(e); continue; }
      for (var k = COLLIDERS.length - 1; k >= 0; k--) { var c = COLLIDERS[k]; if (c[0] === e[0] && c[1] === e[2]) COLLIDERS.splice(k, 1); }
      dst.push(e); var rec = e.plan && PLAN_IDX && PLAN_IDX.bld && PLAN_IDX.bld.get(e.plan); if (rec) rec.kind = KIND;
      var h = { i: H.list.length, e: e, id: e.plan || (e.shop ? "a2_giveback_shop" : "hangar_" + H.list.length), s: e[4] || 1, shop: e.shop || null, open: 0, target: 0, manual: null, solids: null, doorSolid: null, fy: 0.05 };
      H.list.push(h); addWorldBits(h); n++;
    }
    PLACE.hangar = keep; H.n["rekind_" + tag] = n; return n;
  }
  // wall solids, the door solid, inner circles for the camera and scatter, keep-outs in front of the door
  function addWorldBits(h) {
    var e = h.e, s = h.s, I = INFO(); var W2 = I.size[0] / 2 * s, D2 = I.size[2] / 2 * s, zw = I.wall_z * s, x0 = I.door.x0 * s, x1 = I.door.x1 * s, top = I.roof * s;
    var y0 = e[1] - 0.5, y1 = e[1] + top; var tag = "hgrw:" + h.i; var sol = h.solids = [];
    var A = function (lx, lz, w, d, a0, a1) { var p = l2w(e, lx, lz); var sd = addSolid(p[0], p[1], e[3], w, d, a0 === undefined ? y0 : e[1] + a0, a1 === undefined ? y1 : e[1] + a1, tag); if (sd) sol.push(sd); return sd; };
    A(0, -D2 + 0.2, W2 * 2, 0.4);                         // back wall
    A(-W2 + 0.2, 0, 0.4, D2 * 2); A(W2 - 0.2, 0, 0.4, D2 * 2);   // side walls
    A((-W2 + x0) / 2, zw - 0.2, x0 + W2, 0.55);            // the office tower front (left of the door)
    A((x1 + W2) / 2, zw - 0.2, W2 - x1, 0.55);             // the pier right of the door
    A((x0 + x1) / 2, zw - 0.2, x1 - x0, 0.5, I.door.y1 * s, undefined);   // the wall over the door (the head)
    h.doorSolid = A((x0 + x1) / 2, I.door.z * s, x1 - x0, 0.45, -0.5, I.door.y1 * s);
    // camera pull-in and scatter: circles inside the shell only (never over the door's walk-in strip)
    var r = Math.min(W2, D2) * 0.5; var cs = [[-W2 * 0.45, -D2 * 0.45], [W2 * 0.45, -D2 * 0.45], [-W2 * 0.45, D2 * 0.05], [W2 * 0.45, D2 * 0.05], [0, -D2 * 0.2]];
    h.cols = []; cs.forEach(function (q) { var p = l2w(e, q[0], q[1]); var c = [p[0], p[1], r]; COLLIDERS.push(c); h.cols.push(c); });
    // nothing grows on the apron in front of the door or round the walls
    try { var kp = l2w(e, (x0 + x1) / 2, zw + 7 * s); KEEPOUT.push([kp[0], kp[1], (x1 - x0) / 2 + 3]); KEEPOUT.push([e[0], e[2], Math.hypot(W2, D2) + 1.5]); } catch (err) { note("keepout", err); }
  }
  // street lamps planted right in front of a hangar door slide along the street to the nearest side of the opening
  function clearDoors() {
    var I = INFO(), n = 0; var lamps = PLACE.lamp || [];
    H.list.forEach(function (h) { var e = h.e, s = h.s; var x0 = I.door.x0 * s, x1 = I.door.x1 * s, zf = I.wall_z * s;
      lamps.forEach(function (q) { if (q.hgrMoved) return; var p = w2l(e, q[0], q[2]); if (p[1] < zf - 0.5 || p[1] > zf + 8 || p[0] < x0 - 1 || p[0] > x1 + 1) return;
        var nx = (p[0] - x0 < x1 - p[0]) ? x0 - 1.4 : x1 + 1.4; if (nx > I.size[0] / 2 * s + 3) nx = x0 - 1.4; var w = l2w(e, nx, p[1]);
        for (var k = COLLIDERS.length - 1; k >= 0; k--) { var c = COLLIDERS[k]; if (c[0] === q[0] && c[1] === q[2]) { c[0] = w[0]; c[1] = w[1]; } }
        q[0] = w[0]; q[2] = w[1]; q[1] = getH(w[0], w[1]); q.seated = false; q.hgrMoved = true; n++; }); });
    H.n.lampsMoved = n; return n;
  }
  function doorSolidOn(h, on) { var sd = h.doorSolid; if (!sd) return; var i = SOLIDS.indexOf(sd); if (on && i < 0) SOLIDS.push(sd); else if (!on && i >= 0) SOLIDS.splice(i, 1); }

  // ───────────────────────── exterior dressing (defer: heights and the apron are final) ─────────────────────────
  function label(h) { var id = h.id; var c = C(); var num = (c.numbers && c.numbers[id]) || ""; var sign = (c.signs && c.signs[id]) || "stellar"; var name = (c.names && c.names[id]) || ""; return { num: num, sign: sign, name: name }; }
  function buildExterior() {
    if (EX.built || !H.list.length) return; EX.built = true; var I = INFO(); var M = exMats();
    var nums = [], plates = []; H.list.forEach(function (h) { h.lab = label(h); if (h.lab.num && nums.indexOf(h.lab.num) < 0) nums.push(h.lab.num); plates.push([(h.lab.num ? h.lab.num + " · " : "") + (h.lab.name || (h.lab.sign === "stellar" ? "SUNFIELD HANGARS" : h.lab.sign)), h.lab.sign === "stellar" ? "Sunfield · hangar and ground services" : h.lab.name ? "Sunfield · The Flight Line" : "Giveback Ventures"]); });
    M.numbers = new THREE.MeshStandardMaterial({ map: numberAtlas(nums), transparent: true, alphaTest: 0.1, roughness: 0.4, metalness: 0.2, emissive: 0xffffff, emissiveMap: numberAtlas(nums), emissiveIntensity: 0 });
    M.plates = new THREE.MeshStandardMaterial({ map: plateAtlas(plates), transparent: true, alphaTest: 0.1, roughness: 0.35, metalness: 0.3, emissive: 0xffffff, emissiveMap: plateAtlas(plates), emissiveIntensity: 0 });
    var groups = { fascia: [], sign: [], jamb: [], track: [], numbers: [], plates: [], lightF: [], pool: [] }; var textSigns = {};
    var put = function (key, geo, e, s, lx, ly, lz) { var m = new THREE.Matrix4().makeRotationY(e[3]); m.scale(new THREE.Vector3(1, 1, 1)); var p = l2w(e, lx, lz); m.setPosition(p[0], e[1] + ly, p[1]); geo.applyMatrix4(m); (groups[key] || (textSigns[key] = textSigns[key] || [])).push(geo); };
    var atlasQuad = function (w, hh, i, cols, rows) { var g = new THREE.PlaneGeometry(w, hh); var uv = g.attributes.uv; var cx = (i % cols) / cols, cy = Math.floor(i / cols) / rows; for (var k = 0; k < uv.count; k++) uv.setXY(k, cx + uv.getX(k) / cols, 1 - cy - (1 - uv.getY(k)) / rows); return g; };
    H.list.forEach(function (h, idx) { try {
      var e = h.e, s = h.s; var zw = I.wall_z * s, x0 = I.door.x0 * s, x1 = I.door.x1 * s, dTop = I.door.y1 * s, dz = I.door.z * s; var W2 = I.size[0] / 2 * s; var fy0 = I.fascia.y0 * s, fy1 = I.fascia.y1 * s;
      // the apron level at the door: the interior floor meets it without a step
      var gy = -1e9; for (var t = 0.15; t <= 0.85; t += 0.35) { var p = l2w(e, x0 + (x1 - x0) * t, zw + 0.6); gy = Math.max(gy, planGroundAt(p[0], p[1])); } h.fy = cl(gy - e[1] + 0.02, 0.05, 0.6);
      // fascia: a clean champagne composite panel over the whole band right of the tower (hides the generator's crumpled band)
      var fw = W2 - x0 + 0.12, fcx = (x0 - 0.12 + W2) / 2; var fg = new THREE.BoxGeometry(fw, fy1 - fy0, 0.08); var uv = fg.attributes.uv; for (var q = 0; q < uv.count; q++) uv.setXY(q, uv.getX(q) * fw / 3.0, uv.getY(q)); fg.translate(0, 0, 0); put("fascia", fg, e, s, fcx, (fy0 + fy1) / 2, zw + 0.06);
      // the sign: centred over the door; the brand wordmark or a set-in-type name
      var sw = Math.min((x1 - x0) * 0.5, 7.4 * s), sh = sw * 544 / 2048; var sgx = (x0 + x1) / 2, sgy = (fy0 + fy1) / 2 + 0.02;
      var sg = new THREE.PlaneGeometry(sw, sh); if (h.lab.sign === "stellar") put("sign", sg, e, s, sgx, sgy, zw + 0.105); else { var key = "ts:" + h.lab.sign; if (!M.textSigns[key]) M.textSigns[key] = new THREE.MeshStandardMaterial({ map: textSignTex(h.lab.sign), emissiveMap: textGlowTex(h.lab.sign), emissive: 0xffffff, emissiveIntensity: 0, transparent: true, alphaTest: 0.05, roughness: 0.35 }); var tg = new THREE.PlaneGeometry(sw * 1.25, sw * 1.25 * 384 / 2048); put(key, tg, e, s, sgx, sgy, zw + 0.105); }
      // hangar number: the navy aviation plate at the right end of the fascia, and on the tower by the entrance
      if (h.lab.num) { var ni = nums.indexOf(h.lab.num); var nsz = Math.min(1.35 * s, fy1 - fy0 - 0.15); put("numbers", atlasQuad(nsz, nsz, ni, 8, 4), e, s, W2 - 0.4 - nsz / 2 - 0.35 * s, (fy0 + fy1) / 2, zw + 0.105); put("numbers", atlasQuad(0.9, 0.9, ni, 8, 4), e, s, (I.tower.x0 * s + x0) / 2, 3.55 * s, zw + 0.03); }
      // name plate beside the office entrance
      put("plates", atlasQuad(2.3, 0.29, idx, 2, 16), e, s, (I.tower.x0 * s + x0) / 2, 2.95 * s, zw + 0.03);
      // bronze jamb and head round the opening (covers the cut edge of the generator shell), a steel threshold track
      put("jamb", new THREE.BoxGeometry(0.24, dTop + 0.12, zw - dz + 0.26), e, s, x0 - 0.02, (dTop + 0.12) / 2, (zw + dz) / 2 + 0.05);
      put("jamb", new THREE.BoxGeometry(0.24, dTop + 0.12, zw - dz + 0.26), e, s, x1 + 0.02, (dTop + 0.12) / 2, (zw + dz) / 2 + 0.05);
      put("jamb", new THREE.BoxGeometry(x1 - x0 + 0.28, 0.2, zw - dz + 0.26), e, s, (x0 + x1) / 2, dTop + 0.04, (zw + dz) / 2 + 0.05);
      put("track", new THREE.BoxGeometry(x1 - x0, 0.03, 0.42), e, s, (x0 + x1) / 2, h.fy + 0.005, dz + 0.1);
      // wall lights over the door and their pool on the apron at night
      for (var k2 = 0; k2 < 3; k2++) { var lx = x0 + (x1 - x0) * (0.2 + 0.3 * k2); put("lightF", new THREE.BoxGeometry(0.5, 0.08, 0.28), e, s, lx, fy0 - 0.02, zw + 0.2); var pg = new THREE.PlaneGeometry(7 * s, 7 * s); pg.rotateX(-Math.PI / 2); var pp = l2w(e, lx, zw + 3.2 * s); var gpy = planGroundAt(pp[0], pp[1]) - e[1] + 0.04; put("pool", pg, e, s, lx, gpy, zw + 3.2 * s); }
    } catch (err) { note("exterior " + h.id, err); } });
    EX.meshes = [];
    var add = function (list, mat, shadow) { if (!list.length) return; var one = mergeGeos(list); var m = new THREE.Mesh(one, mat); m.castShadow = !!shadow; m.receiveShadow = true; m.frustumCulled = true; m.userData.noCull = true; m.name = "hangar exterior"; scene.add(m); EX.meshes.push(m); list.forEach(function (g) { g.dispose(); }); };
    add(groups.fascia, M.fascia, true); add(groups.sign, M.sign, false); add(groups.jamb, M.jamb, true); add(groups.track, M.track, false); add(groups.numbers, M.numbers, false); add(groups.plates, M.plates, false); add(groups.lightF, M.lightF, false); add(groups.pool, M.pool, false);
    for (var k in textSigns) add(textSigns[k], M.textSigns[k], false);
    // the doors: two instanced meshes (frame, glass) for every hangar
    var D = doorGeos(I); EX.door = D; var N = H.list.length;
    EX.frames = new THREE.InstancedMesh(D.frame, M.doorFrame, N); EX.glass = new THREE.InstancedMesh(D.glass, M.doorGlass, N);
    [EX.frames, EX.glass].forEach(function (im) { im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.userData.noCull = true; im.name = "hangar doors"; scene.add(im); });
    H.list.forEach(function (h) { setDoor(h, 0); });
    H.n.exterior = EX.meshes.length; H.n.doors = N;
  }
  var _m4 = null, _q = null, _v = null, _s = null, _r = null, _e = null;
  function setDoor(h, t) {
    if (!EX.frames) return; if (!_m4) { _m4 = new THREE.Matrix4(); _r = new THREE.Matrix4(); _q = new THREE.Quaternion(); _v = new THREE.Vector3(); _s = new THREE.Vector3(); _e = new THREE.Euler(); }
    var I = INFO(), e = h.e, s = h.s; var th = -ease(t) * 1.5; var cx = (I.door.x0 + I.door.x1) / 2 * s, top = I.door.y1 * s, z = I.door.z * s + 0.02;
    var p = l2w(e, cx, z); _e.set(th, e[3], 0, "YXZ"); _q.setFromEuler(_e); _v.set(p[0], e[1] + top, p[1]); _s.set(s, s, s); _m4.compose(_v, _q, _s);
    EX.frames.setMatrixAt(h.i, _m4); EX.glass.setMatrixAt(h.i, _m4); EX.frames.instanceMatrix.needsUpdate = true; EX.glass.instanceMatrix.needsUpdate = true;
  }

  // ───────────────────────── the interior (one hangar at a time, near the player) ─────────────────────────
  function jetFor(h) { if (/b0010/.test(h.id) && has("biplane")) return "biplane"; if (h.s > 1.3 && has("jet_mid")) return "jet_mid"; if (has("jet_light")) return "jet_light"; return has("jet_mid") ? "jet_mid" : null; }
  function has(k) { try { return !!(MODELS[k] && MODELS[k].parts && MODELS[k].parts.length); } catch (e) { return false; } }
  // occupancy of a model below head height, as run-length boxes on a grid (local frame of the model at its placement)
  function occBoxes(kind, cell, maxY) {
    var key = kind + ":" + cell; H.occ = H.occ || {}; if (H.occ[key]) return H.occ[key]; var m = MODELS[kind]; var G = new Map(); var mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    m.parts.forEach(function (pt) { var a = pt.geometry.attributes.position; for (var i = 0; i < a.count; i++) { var y = a.getY(i); if (y > maxY) continue; var x = a.getX(i), z = a.getZ(i); var ix = Math.floor(x / cell), iz = Math.floor(z / cell); G.set(ix + "," + iz, [ix, iz]); } });
    var rows = {}; G.forEach(function (v) { (rows[v[1]] = rows[v[1]] || []).push(v[0]); }); var runs = [];
    for (var iz in rows) { var xs = rows[iz].sort(function (a, b) { return a - b; }); var st = xs[0], pv = xs[0]; for (var k = 1; k <= xs.length; k++) { if (k < xs.length && xs[k] <= pv + 2) { pv = xs[k]; continue; } runs.push([st, pv, +iz]); if (k < xs.length) { st = pv = xs[k]; } } }
    // merge runs with the same x extent (one cell of slack) over consecutive rows into rectangles, so a player walking into the
    // fuselage meets one box face instead of a stack of thin rows that would slide them along it
    runs.sort(function (a, b) { return a[2] - b[2] || a[0] - b[0]; }); var used = new Array(runs.length), out = [];
    for (var i = 0; i < runs.length; i++) { if (used[i]) continue; var r = runs[i], x0 = r[0], x1 = r[1], z0 = r[2], z1 = r[2]; used[i] = true;
      for (var grow = true; grow;) { grow = false; for (var j = i + 1; j < runs.length; j++) { if (used[j] || runs[j][2] !== z1 + 1) continue; if (Math.abs(runs[j][0] - x0) <= 1 && Math.abs(runs[j][1] - x1) <= 1) { x0 = Math.min(x0, runs[j][0]); x1 = Math.max(x1, runs[j][1]); z1 = runs[j][2]; used[j] = true; grow = true; break; } } }
      out.push([(x0 + x1 + 1) / 2 * cell, (z0 + z1 + 1) / 2 * cell, (x1 - x0 + 1) * cell, (z1 - z0 + 1) * cell]); }
    return (H.occ[key] = out);
  }
  function buildInterior(h) { var it = buildSteps(h), r; do { r = it.next(); } while (!r.done); return r.value; }
  // a staged build that stopped half way (the player turned away): take its solids back out
  function abortBuild(h) { var L = h && h.Lb; if (!L) return; L.solids.forEach(function (sd) { var i = SOLIDS.indexOf(sd); if (i >= 0) SOLIDS.splice(i, 1); }); if (L.g.parent) L.g.parent.remove(L.g); h.Lb = null; }
  // the same build in stages: plan_perf.js steps it inside a per-frame budget while the player is still on the way (R_STAGE)
  function* buildSteps(h) {
    var t0 = performance.now(); var I = INFO(), M = mats(); var e = h.e, s = h.s; var K = new Kit();
    var g = new THREE.Group(); g.position.set(e[0], e[1], e[2]); g.rotation.y = e[3]; g.userData.noCull = true; g.userData.hgr = h; g.name = "hangar interior";
    var fy = h.fy; var W2 = I.size[0] / 2 * s, D2 = I.size[2] / 2 * s; var xL = -W2 + 0.42, xR = W2 - 0.42, zB = -D2 + 0.42, zF = I.wall_z * s - 0.42; var x0 = I.door.x0 * s, x1 = I.door.x1 * s, dTop = I.door.y1 * s, dz = I.door.z * s;
    var Hc = (I.roof - 0.9) * s; var xT = I.tower.x1 * s - 0.12; var MZ = 3.3; var zMb = zB + 6.5; var colX = xT - 0.2;
    var L = { g: g, e: e, s: s, fy: fy, xL: xL, xR: xR, zB: zB, zF: zF, x0: x0, x1: x1, dTop: dTop, dz: dz, Hc: Hc, xT: xT, MZ: MZ, zMb: zMb, seats: [], solids: [], lights: [] };
    var solid = function (lx, lz, w, d, a0, a1, ry, seat) { var c = Math.cos(e[3]), sn = Math.sin(e[3]); var x = e[0] + lx * c + lz * sn, z = e[2] - lx * sn + lz * c; var sd = addSolid(x, z, e[3] + (ry || 0), w, d, e[1] + a0, e[1] + a1, "hgri"); if (sd) { L.solids.push(sd); if (seat) { sd.seat = true; sd.face = e[3] + seat.face; L.seats.push(sd); } } return sd; };
    L.solid = solid;
    // ── floor: epoxy slab, safety markings, the Stellar inlay
    K.quad("epoxy", xR - xL + 0.8, zF - zB + 0.8, (xL + xR) / 2, fy, (zB + zF) / 2, 0, -Math.PI / 2, [6, 6]);
    K.box("epoxy", x1 - x0 + 0.1, 0.06, zF + 0.42 - dz + 0.35, (x0 + x1) / 2, fy - 0.03, (zF + dz) / 2 + 0.2);   // the slab runs out to the door line
    solid((xL + xR) / 2, (zB + zF) / 2, xR - xL + 0.6, zF - zB + 0.6, -0.4, fy);
    solid((x0 + x1) / 2, (zF + dz) / 2 + 0.3, x1 - x0, dz - zF + 1.0, -0.4, fy);
    var jk = jetFor(h), jm = jk && MODELS[jk]; var jx = (Math.max(colX + 0.1, x0) + Math.min(xR, x1)) / 2, jLen = jm ? jm.sz : 14, jSpan = jm ? jm.sx : 14; var jz = zF - 3.3 - jLen / 2; if (jk === "biplane") jz = zF - 7.5;
    L.jet = { kind: jk, x: jx, z: jz, len: jLen, span: jSpan };
    var ln = function (mat, w, d, x, z, ry) { K.quad(mat, w, d, x, fy + 0.006, z, ry || 0, -Math.PI / 2); };
    var bx0 = jx - jSpan / 2 - 0.45, bx1 = jx + jSpan / 2 + 0.45, bz0 = jz - jLen / 2 - 0.5, bz1 = jz + jLen / 2 + 0.3;
    ln("lineY", 0.12, bz1 - bz0, bx0, (bz0 + bz1) / 2); ln("lineY", 0.12, bz1 - bz0, bx1, (bz0 + bz1) / 2); ln("lineY", bx1 - bx0, 0.12, (bx0 + bx1) / 2, bz0); ln("lineY", bx1 - bx0, 0.12, (bx0 + bx1) / 2, bz1);
    ln("lineW", 0.1, zF - zB - 7.2, xL + 1.05, (zB + 6.8 + zF - 5.4) / 2); ln("lineW", 0.1, zF - zB - 7.2, colX - 0.35, (zB + 6.8 + zF - 5.4) / 2);   // the walkway along the workshop
    var iz = (bz1 + dz) / 2, idm = cl(dz - bz1 - 0.4, 1.8, 3.2); K.quad("inlay", idm, idm, jx, fy + 0.012, iz, 0, -Math.PI / 2);
    h.Lb = L; yield;
    // ── walls: insulated liner panels with a grey dado; the front wall round the opening
    var wallH = Hc + 0.6; var WT = [1.2, 1.0];
    K.quad("liner", zF - zB, wallH - 1.2, xL, 1.2 + (wallH - 1.2) / 2, (zB + zF) / 2, Math.PI / 2, 0, WT); K.quad("dado", zF - zB, 1.2, xL + 0.01, 0.6, (zB + zF) / 2, Math.PI / 2);
    K.quad("liner", zF - zB, wallH - 1.2, xR, 1.2 + (wallH - 1.2) / 2, (zB + zF) / 2, -Math.PI / 2, 0, WT); K.quad("dado", zF - zB, 1.2, xR - 0.01, 0.6, (zB + zF) / 2, -Math.PI / 2);
    K.quad("liner", xR - xL, wallH - 1.2, (xL + xR) / 2, 1.2 + (wallH - 1.2) / 2, zB, 0, 0, WT); K.quad("dado", xR - xL, 1.2, (xL + xR) / 2, 0.6, zB + 0.01, 0);
    K.quad("liner", x0 - xL, wallH, (xL + x0) / 2, wallH / 2, zF, Math.PI, 0, WT); K.quad("liner", xR - x1, wallH, (x1 + xR) / 2, wallH / 2, zF, Math.PI, 0, WT);
    K.quad("liner", x1 - x0, wallH - dTop, (x0 + x1) / 2, dTop + (wallH - dTop) / 2, zF, Math.PI, 0, WT);
    K.box("steel", 0.3, dTop, zF - dz + 0.9, x0 - 0.15, dTop / 2, (zF + dz) / 2); K.box("steel", 0.3, dTop, zF - dz + 0.9, x1 + 0.15, dTop / 2, (zF + dz) / 2); K.box("steel", x1 - x0 + 0.6, 0.5, zF - dz + 0.9, (x0 + x1) / 2, dTop + 0.25, (zF + dz) / 2);
    // clerestory glazing high on the side walls (daylight by day)
    K.quad("clere", zF - zB - 2, 0.7, xL + 0.02, Hc - 0.55, (zB + zF) / 2, Math.PI / 2); K.quad("clere", zF - zB - 2, 0.7, xR - 0.02, Hc - 0.55, (zB + zF) / 2, -Math.PI / 2);
    // ── ceiling: steel deck, trusses, LED high-bays
    K.quad("deck", xR - xL + 0.8, zF - zB + 0.8, (xL + xR) / 2, Hc + 0.5, (zB + zF) / 2, 0, Math.PI / 2, [4, 4]);
    for (var tz = zB + 2.2; tz < zF - 1; tz += 4.2) { K.box("truss", xR - xL, 0.16, 0.2, (xL + xR) / 2, Hc + 0.35, tz); K.box("truss", xR - xL, 0.14, 0.18, (xL + xR) / 2, Hc - 0.55, tz); for (var dx = xL + 0.6; dx < xR - 0.6; dx += 1.2) K.box("truss", 0.08, 1.05, 0.08, dx + 0.3, Hc - 0.1, tz, 0); }
    for (var pz = 0; pz < 4; pz++) K.box("truss", 0.12, 0.2, zF - zB, xL + 1 + pz * (xR - xL - 2) / 3, Hc + 0.42, (zB + zF) / 2);
    var hbx = [jx - jSpan * 0.33, jx, jx + jSpan * 0.33], hbz = [jz - jLen * 0.33, jz, jz + jLen * 0.33];
    hbx.forEach(function (lx) { hbz.forEach(function (lz) { if (lx < colX + 0.8) return; K.cyl("housing", 0.34, 0.26, 0.28, lx, Hc - 0.95, lz, 16); K.cyl("lamp", 0.3, 0.3, 0.03, lx, Hc - 1.1, lz, 16); K.cyl("steel", 0.012, 0.012, 0.9, lx, Hc - 0.4, lz, 4); }); });
    // pooled lights (the client copies the nearest eight into its fixed light pool)
    var PL = function (col, k, dist, lx, ly, lz) { var l = new THREE.PointLight(col, k, dist, 1.3); l.position.set(lx, ly, lz); g.add(l); L.lights.push(l); };
    PL(0xf2f6ff, 1.8, 18 * s, jx - jSpan * 0.25, Hc - 1.4, jz + jLen * 0.2); PL(0xf2f6ff, 1.8, 18 * s, jx + jSpan * 0.25, Hc - 1.4, jz + jLen * 0.2); PL(0xf2f6ff, 1.6, 17 * s, jx, Hc - 1.4, jz - jLen * 0.3);
    PL(0xfff0dc, 1.2, 10, (xL + colX) / 2, 2.6, (zMb + zF) / 2 - 2); PL(0xffdcb0, 1.3, 10, (xL + colX) / 2, MZ + 2.6, zMb + 5.5); PL(0xffe2bd, 1.2, 8, (xL + xT) / 2, MZ + 2.4, zF - 2.5);
    // ── the brand wall (back wall, over the parts racks)
    var bw = Math.min(8.5 * s, (xR - colX) * 0.62), bh = bw * 576 / 2048; K.box("stellar", bw + 0.3, bh + 0.3, 0.12, jx, 4.2 * s, zB + 0.07); K.quad("brand", bw, bh, jx, 4.2 * s, zB + 0.14, 0);
    // ── mezzanine: crew lounge, coffee bar and the flight planning office over the workshop, reached by a stair at the back
    yield; buildMezzanine(K, L, M);
    // ── workshop under the mezzanine, parts racks, fire stations
    yield; buildWorkshop(K, L, M);
    // ── the tower lobby: reception and the glass wall to the bay
    yield; buildLobby(K, L, M);
    // ── ground equipment: tug, GPU, chocks, cones
    yield; buildGSE(K, L, M);
    // ── merge
    yield; K.build(g, M); yield;
    // ── models: the aircraft, the office desk and chairs, the lobby planter
    if (jk) { var jet = makeModel(jk); jet.position.set(jx, fy, jz); jet.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.noSolid = true; } }); g.add(jet); L.jetG = jet;
      occBoxes(jk, 0.7, 2.05).forEach(function (b) { solid(jx + b[0], jz + b[1], b[2] + 0.1, b[3] + 0.1, fy - 0.2, fy + 2.1); }); }
    yield; placeModels(L, M);
    g.traverse(function (o) { if (o.isMesh) { o.receiveShadow = true; } });
    scene.add(g); h.Lb = null; try { renderer.shadowMap.needsUpdate = true; } catch (err) {}
    h.L = L; H.n.lastBuildMs = Math.round(performance.now() - t0); H.n.builds = (H.n.builds || 0) + 1; H.n.solids = L.solids.length;
    return L;
  }
  function buildMezzanine(K, L, M) {
    var xL = L.xL, xT = L.xT, MZ = L.MZ, zMb = L.zMb, zF = L.zF, zB = L.zB, fy = L.fy, S = L.solid; var colX = xT - 0.2; var y = fy + MZ;
    // slab (0.28 thick), its edge fascia, columns
    K.box("deck", colX + 0.25 - xL, 0.28, zF - zMb, (xL + colX + 0.25) / 2, y - 0.14, (zMb + zF) / 2); K.box("white", colX + 0.25 - xL, 0.02, zF - zMb, (xL + colX + 0.25) / 2, y + 0.005, (zMb + zF) / 2);
    K.quad("walnut", zF - zMb, colX + 0.25 - xL, (xL + colX + 0.25) / 2, y + 0.012, (zMb + zF) / 2, Math.PI / 2, -Math.PI / 2, [1.2, 1.2]);
    S((xL + colX + 0.25) / 2, (zMb + zF) / 2, colX + 0.25 - xL, zF - zMb, y - 0.3, y);
    for (var cz = zMb + 0.3; cz <= zF - 0.2; cz += (zF - zMb - 0.5) / 3) { K.box("steel", 0.22, MZ - 0.28, 0.22, colX, fy + (MZ - 0.28) / 2, cz); S(colX, cz, 0.3, 0.3, fy, y - 0.3); }
    // glass balustrade with a brushed steel cap rail along the bay edge and across the back end (the stair lands at the back)
    var bx = colX + 0.2; K.quad("glass", zF - zMb - 0.2, 1.05, bx, y + 0.55, (zMb + zF) / 2, Math.PI / 2); K.box("brushed", 0.07, 0.05, zF - zMb - 0.2, bx, y + 1.1, (zMb + zF) / 2);
    for (var pz = zMb + 0.1; pz < zF; pz += 1.4) K.box("brushed", 0.05, 1.1, 0.05, bx, y + 0.55, pz);
    S(bx, (zMb + zF) / 2, 0.2, zF - zMb, y + 0.02, y + 1.15);
    var sx0 = xL, sx1 = xL + 1.25; K.quad("glass", colX - sx1, 1.05, (sx1 + colX) / 2 + 0.1, y + 0.55, zMb + 0.05, 0); K.box("brushed", colX - sx1 + 0.2, 0.05, 0.07, (sx1 + colX) / 2 + 0.1, y + 1.1, zMb + 0.05); S((sx1 + colX) / 2 + 0.1, zMb + 0.05, colX - sx1 + 0.2, 0.2, y + 0.02, y + 1.15);
    // the stair: along the left wall from the back of the hangar up to the mezzanine
    var z0 = zB + 1.6, n = 16, rise = MZ / n, run = (zMb - z0) / n; L.stair = { x: (sx0 + sx1) / 2, z0: z0, z1: zMb };
    for (var i = 0; i < n; i++) { var tz = z0 + (i + 0.5) * run, ty = fy + rise * (i + 1); K.box("steel", sx1 - sx0 - 0.1, 0.05, run + 0.03, (sx0 + sx1) / 2, ty - 0.025, tz); K.box("steel", sx1 - sx0 - 0.1, rise, 0.02, (sx0 + sx1) / 2, ty - rise / 2, tz - run / 2 + 0.01); S((sx0 + sx1) / 2, tz, sx1 - sx0, run + 0.02, fy, ty); }
    var sl = Math.hypot(zMb - z0, MZ), ang = Math.atan2(MZ, zMb - z0);
    var str = new THREE.BoxGeometry(0.08, 0.3, sl); str.rotateX(-ang); str.translate(sx1 - 0.02, fy + MZ / 2 - 0.1, (z0 + zMb) / 2); K.put("steel", str);
    var hr = new THREE.BoxGeometry(0.05, 0.05, sl); hr.rotateX(-ang); hr.translate(sx1 + 0.02, fy + MZ / 2 + 0.95, (z0 + zMb) / 2); K.put("brushed", hr);
    var gl = new THREE.PlaneGeometry(sl, 0.9); gl.rotateY(Math.PI / 2); var mx = new THREE.Matrix4().makeRotationX(-ang); gl.applyMatrix4(mx); gl.translate(sx1 + 0.02, fy + MZ / 2 + 0.5, (z0 + zMb) / 2); K.put("glass", gl);
    K.box("steel", 0.06, 1.0, 0.06, sx1 + 0.02, fy + 0.5, z0); K.box("steel", 0.06, 1.0, 0.06, sx1 + 0.02, fy + MZ + 0.55, zMb);
    S(sx1 + 0.08, (z0 + 1.2 + zMb) / 2, 0.12, zMb - z0 - 1.2, fy + 0.9, fy + MZ + 1.1);
    // upstairs: coffee bar at the back, the crew lounge, the flight planning office over the tower (glass partition)
    var ly = y; var cxw = (xL + colX) / 2;
    var zb = zMb + 3.0;   // the coffee bar: a walnut and stone counter along the wall, espresso machine, cups, shelves, three stools
    K.box("walnut", 0.6, 1.02, 3.0, xL + 0.32, ly + 0.51, zb); K.box("stone", 0.66, 0.04, 3.05, xL + 0.34, ly + 1.04, zb); S(xL + 0.32, zb, 0.7, 3.0, ly, ly + 1.05);
    K.box("chrome", 0.45, 0.42, 0.38, xL + 0.28, ly + 1.27, zb - 0.7); K.box("black", 0.18, 0.3, 0.2, xL + 0.28, ly + 1.21, zb - 0.1); for (var k = 0; k < 4; k++) K.cyl("white", 0.04, 0.035, 0.09, xL + 0.4, ly + 1.1, zb + 0.4 + k * 0.12, 8);
    K.box("walnut", 0.03, 0.9, 3.0, xL + 0.02, ly + 1.9, zb); for (var sh = 0; sh < 2; sh++) K.box("walnut", 0.28, 0.03, 2.8, xL + 0.16, ly + 1.7 + sh * 0.45, zb);
    for (var st = 0; st < 3; st++) { var sz = zb - 0.85 + st * 0.85; K.cyl("chrome", 0.025, 0.025, 0.72, xL + 0.95, ly + 0.36, sz, 8); K.cyl("leather", 0.19, 0.19, 0.06, xL + 0.95, ly + 0.75, sz, 14); K.cyl("chrome", 0.18, 0.18, 0.02, xL + 0.95, ly + 0.01, sz, 12); S(xL + 0.95, sz, 0.4, 0.4, ly, ly + 0.78, 0, { face: -Math.PI / 2 }); }
    // crew lounge: a sofa along the wall looking out over the bay, two club chairs across a low table, a second sofa facing the screen
    var zP = L.zF - 5.0; L.zP = zP; var z1 = zb + 3.0;
    L.divans = [[xL + 0.42, z1, Math.PI / 2], [cxw + 0.05, zP - 2.4, 0]]; if (!has("cab_divan")) sofa(K, S, xL + 0.5, z1, 2.4, Math.PI / 2, ly);
    K.quad("rug", 2.3, 2.9, xL + 1.55, ly + 0.015, z1, 0, -Math.PI / 2, [1.2, 1.2]); K.box("walnut", 0.62, 0.04, 1.2, xL + 1.55, ly + 0.4, z1); K.box("black", 0.5, 0.38, 1.0, xL + 1.55, ly + 0.19, z1); S(xL + 1.55, z1, 0.62, 1.2, ly, ly + 0.42);
    if (!has("cab_divan")) sofa(K, S, cxw + 0.05, zP - 2.4, 2.2, 0, ly);
    K.box("black", 1.9, 1.1, 0.06, cxw + 0.3, ly + 1.75, zP - 0.12); K.quad("screen", 1.8, 1.0, cxw + 0.3, ly + 1.75, zP - 0.16, Math.PI);
    // office partition: walnut frame and glass with a door opening next to the balustrade
    K.quad("glass", colX - xL - 1.1, 2.6, (xL + colX - 1.1) / 2, ly + 1.3, zP, 0); K.box("steel", colX - xL + 0.2, 0.12, 0.12, (xL + colX) / 2 + 0.1, ly + 2.62, zP); K.box("steel", 0.08, 2.6, 0.1, colX - 1.1, ly + 1.3, zP);
    S((xL + colX - 1.1) / 2, zP, colX - xL - 1.1, 0.15, ly + 0.02, ly + 2.6);
    // flight planning office: desk (exec_desk model placed later), the planning screen on the wall, the tall window to the apron
    K.box("black", 0.06, 1.2, 2.0, xL + 0.04, ly + 1.7, zP + 2.4); K.quad("wx", 1.9, 1.15, xL + 0.08, ly + 1.7, zP + 2.4, Math.PI / 2);
    K.quad("window", 1.6, 3.2, (xL + xT) / 2 - 0.3, ly + 1.9, L.zF - 0.02, Math.PI);
    L.office = { x: (xL + colX) / 2 + 0.1, z: zP + 2.8, y: ly }; L.lounge = { x: xL + 2.5, z: z1, y: ly }; L.bar = { x: xL + 0.95, z: zb, y: ly };
  }
  function sofa(K, S, x, z, w, ry, y) {   // a low modern sofa: plinth, seat cushions, back, arms; faces +z at ry 0
    var c = Math.cos(ry), s = Math.sin(ry); var P = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; };
    var b = function (mat, bw, bh, bd, lx, ly, lz) { var p = P(lx, lz); K.box(mat, bw, bh, bd, p[0], y + ly, p[1], ry); };
    b("black", w - 0.1, 0.1, 0.8, 0, 0.05, 0); b("leather", w - 0.3, 0.2, 0.62, 0, 0.3, 0.05); b("leather", w, 0.45, 0.2, 0, 0.55, -0.32); b("leather", 0.16, 0.38, 0.86, -w / 2 + 0.08, 0.36, 0); b("leather", 0.16, 0.38, 0.86, w / 2 - 0.08, 0.36, 0);
    var n = Math.max(2, Math.round((w - 0.3) / 0.8)); for (var i = 0; i < n; i++) { var px = -w / 2 + 0.45 + i * (w - 0.9) / Math.max(1, n - 1); b(i % 2 ? "fabric2" : "fabric", 0.42, 0.3, 0.12, px, 0.6, -0.17); }
    var p = P(0, 0.05); var sd = S(p[0], p[1], w - 0.3, 0.55, y, y + 0.42, ry, { face: ry }); var pb = P(0, -0.32); S(pb[0], pb[1], w, 0.22, y, y + 0.8, ry);
  }
  function buildWorkshop(K, L, M) {
    var xL = L.xL, xR = L.xR, zB = L.zB, zF = L.zF, fy = L.fy, S = L.solid, zMb = L.zMb, colX = L.xT - 0.2;
    // under the mezzanine: workbenches with pegboards and tool chests along the left wall
    for (var i = 0; i < 2; i++) { var z = zMb + 1.8 + i * 3.4; if (z > L.zP - 1.2) break; K.box("bench", 0.8, 0.06, 2.6, xL + 0.45, fy + 0.93, z); K.box("steel", 0.75, 0.88, 0.06, xL + 0.45, fy + 0.45, z - 1.25); K.box("steel", 0.75, 0.88, 0.06, xL + 0.45, fy + 0.45, z + 1.25); K.box("steel", 0.7, 0.04, 2.5, xL + 0.45, fy + 0.2, z); K.quad("peg", 2.6, 1.2, xL + 0.03, fy + 1.75, z, Math.PI / 2); S(xL + 0.45, z, 0.85, 2.6, fy, fy + 0.96);
      K.box("black", 0.35, 0.22, 0.25, xL + 0.4, fy + 1.07, z - 0.6); K.cyl("red", 0.08, 0.08, 0.25, xL + 0.5, fy + 1.08, z + 0.7, 10); }
    // tool chests in Stellar blue along the right wall, with a workbench between them
    var zc = L.jet.z - 1.5; var chest = function (x, z, w, h2) { K.box("chest", 0.65, h2, w, x, fy + 0.1 + h2 / 2, z); K.box("brushed", 0.7, 0.03, w + 0.04, x, fy + 0.12 + h2, z); K.box("rubber", 0.6, 0.1, w - 0.1, x, fy + 0.05, z); S(x, z, 0.7, w, fy, fy + 0.15 + h2); };
    chest(xR - 0.4, zc - 2.2, 1.4, 1.05); chest(xR - 0.4, zc - 0.6, 1.2, 1.05); chest(xR - 0.4, zc + 0.8, 1.4, 1.05); K.box("chest", 0.62, 0.7, 1.3, xR - 0.4, fy + 1.58, zc - 2.2); K.box("chest", 0.62, 0.7, 1.4, xR - 0.4, fy + 1.58, zc + 0.8);
    K.box("bench", 0.8, 0.06, 2.4, xR - 0.45, fy + 0.93, zc + 3.1); K.box("steel", 0.75, 0.88, 2.3, xR - 0.45, fy + 0.46, zc + 3.1); K.quad("peg", 2.4, 1.2, xR - 0.03, fy + 1.75, zc + 3.1, -Math.PI / 2); S(xR - 0.45, zc + 3.1, 0.85, 2.4, fy, fy + 0.96);
    // parts racks against the back wall, right of the stair
    var rack = function (x, z, w) { for (var k = 0; k < 5; k++) K.box("steel", w, 0.04, 0.6, x, fy + 0.15 + k * 0.62, z); [-w / 2, w / 2].forEach(function (dx) { K.box("orange", 0.07, 2.75, 0.07, x + dx, fy + 1.37, z - 0.27); K.box("orange", 0.07, 2.75, 0.07, x + dx, fy + 1.37, z + 0.27); });
      for (var r = 0; r < 4; r++) for (var c = 0; c < Math.floor(w / 0.55); c++) { var hh = 0.22 + ((r * 7 + c * 3) % 4) * 0.06; K.box(((r + c) % 3 === 0) ? "bin" : ((r + c) % 3 === 1) ? "box" : "bin2", 0.46, hh, 0.44, x - w / 2 + 0.3 + c * 0.55, fy + 0.17 + r * 0.62 + hh / 2, z); } S(x, z, w + 0.1, 0.65, fy, fy + 2.8); };
    var rx0 = colX + 1.5, rspan = xR - rx0 - 0.6; var nr = Math.max(1, Math.floor(rspan / 3.0)); var rw = rspan / nr - 0.3;
    for (var ri = 0; ri < nr; ri++) { var rxx = rx0 + (ri + 0.5) * (rspan / nr); if (Math.abs(rxx - L.jet.x) < rw / 2 + 0.3 && false) continue; rack(rxx, zB + 0.4, rw); }
    // fire extinguisher stations: red cabinet, extinguisher, sign, a red keep-clear box on the floor
    var fire = function (x, z, ry) { var c = Math.cos(ry), s = Math.sin(ry); var P = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; }; var p0 = P(0, 0.1), p1 = P(0, 0.2), p2 = P(0, 0.09), p3 = P(0, 0.8);
      K.box("red", 0.6, 0.9, 0.2, p0[0], fy + 1.25, p0[1], ry); K.cyl("red", 0.09, 0.09, 0.55, p1[0], fy + 0.38, p1[1], 12); K.cyl("black", 0.03, 0.05, 0.12, p1[0], fy + 0.72, p1[1], 8); K.quad("white", 0.36, 0.14, p2[0], fy + 2.0, p2[1] + 0.0, ry); K.quad("lineR", 0.9, 0.9, p3[0], fy + 0.008, p3[1], ry, -Math.PI / 2); S(p0[0], p0[1], 0.6, 0.4, fy, fy + 1.7, ry); };
    fire(xR - 0.02, zF - 3.2, -Math.PI / 2); fire(xR - 0.02, zB + 3.4, -Math.PI / 2); fire(xL + 0.02, L.zP - 1.9, Math.PI / 2); fire(colX + 1.2, zB + 0.02, 0);
  }
  function buildLobby(K, L, M) {
    var xL = L.xL, xT = L.xT, zF = L.zF, zP = L.zP, fy = L.fy, S = L.solid;
    // the tower's glass wall to the bay with a door gap at its front end, the stone reception desk with the brand
    K.quad("glass", zF - zP - 1.6, 3.0, xT + 0.02, fy + 1.5, (zP + zF - 1.6) / 2, Math.PI / 2); K.box("steel", 0.12, 0.12, zF - zP, xT + 0.02, fy + 3.02, (zP + zF) / 2); K.box("steel", 0.1, 3.0, 0.1, xT + 0.02, fy + 1.5, zF - 1.6);
    S(xT + 0.02, (zP + zF - 1.6) / 2, 0.15, zF - zP - 1.6, fy, fy + 3.0);
    var dx = (xL + xT) / 2; K.box("stone", 0.7, 1.08, 2.2, dx + 0.1, fy + 0.54, zP + 1.8); K.box("walnut", 0.8, 0.05, 2.3, dx + 0.1, fy + 1.1, zP + 1.8); K.box("stellar", 0.02, 0.36, 1.2, dx + 0.46, fy + 0.62, zP + 1.8); S(dx + 0.1, zP + 1.8, 0.8, 2.3, fy, fy + 1.12);
    K.box("black", 0.05, 0.32, 0.5, dx - 0.12, fy + 1.33, zP + 1.6);
    L.lobby = { x: dx, z: zP + 3.6 };
  }
  function exhibitTex() { return panel("exhibit", 1024, 1400, function (x, W, Hh) { x.fillStyle = "#1a1510"; x.fillRect(0, 0, W, Hh); x.strokeStyle = "#c9a24d"; x.lineWidth = 6; x.strokeRect(24, 24, W - 48, Hh - 48);
      txt(x, "1928", W / 2, 170, "700 150px " + FT.cond, "#c9a24d", 10); txt(x, "WHEELS DOWN", W / 2, 300, "700 70px " + FT.cond, "#f5f1e6", 12);
      var g = x.createLinearGradient(0, 380, 0, 820); g.addColorStop(0, "#d8c7a4"); g.addColorStop(1, "#8a6d48"); x.fillStyle = g; x.fillRect(90, 380, W - 180, 440); x.fillStyle = "rgba(40,28,16,0.8)"; x.fillRect(90, 700, W - 180, 120);
      x.fillStyle = "rgba(40,28,16,0.85)"; x.save(); x.translate(W / 2, 600); x.fillRect(-230, -6, 460, 12); x.fillRect(-190, -60, 380, 10); x.fillRect(-40, -30, 150, 44); x.beginPath(); x.moveTo(110, -20); x.lineTo(190, -40); x.lineTo(190, 10); x.closePath(); x.fill(); x.restore();
      var lines = ["In the early days of the old airfield,", "open-cockpit biplanes like this one", "flew in over the border country: wood,", "wire and fabric, a radial engine up", "front and a pilot in goggles behind."];
      lines.forEach(function (l, i) { txt(x, l, W / 2, 920 + i * 70, "500 40px " + FT.ui, "#e9e1cf", 1); }); txt(x, "SUNFIELD · 1928 AIRFIELD MUSEUM", W / 2, Hh - 90, "600 32px " + FT.ui, "#c9a24d", 8); }); }
  function buildGSE(K, L, M) {
    var fy = L.fy, S = L.solid, J = L.jet; if (!J.kind) return; var nose = J.z + J.len / 2;
    if (J.kind === "biplane") {   // museum: a roped exhibit with two panels
      var ex0 = J.x - J.span / 2 - 1.0, ex1 = J.x + J.span / 2 + 1.0, ez0 = J.z - J.len / 2 - 1.0, ez1 = nose + 1.0; var posts = [];
      for (var i = 0; i <= 4; i++) { posts.push([ex0 + (ex1 - ex0) * i / 4, ez0]); posts.push([ex0 + (ex1 - ex0) * i / 4, ez1]); } for (var j = 1; j < 3; j++) { posts.push([ex0, ez0 + (ez1 - ez0) * j / 3]); posts.push([ex1, ez0 + (ez1 - ez0) * j / 3]); }
      posts.forEach(function (p) { K.cyl("brushed", 0.03, 0.03, 0.95, p[0], fy + 0.48, p[1], 8); K.cyl("brushed", 0.16, 0.18, 0.04, p[0], fy + 0.02, p[1], 14); K.cyl("brushed", 0.05, 0.05, 0.06, p[0], fy + 0.97, p[1], 10); });
      var rope = function (a, b) { var d = Math.hypot(b[0] - a[0], b[1] - a[1]); var g = new THREE.CylinderGeometry(0.018, 0.018, d, 6); g.rotateZ(Math.PI / 2); g.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0])); g.translate((a[0] + b[0]) / 2, fy + 0.86, (a[1] + b[1]) / 2); K.put("red", g); };
      for (var r = 0; r < 4; r++) { rope([ex0 + (ex1 - ex0) * r / 4, ez0], [ex0 + (ex1 - ex0) * (r + 1) / 4, ez0]); rope([ex0 + (ex1 - ex0) * r / 4, ez1], [ex0 + (ex1 - ex0) * (r + 1) / 4, ez1]); } for (var q = 0; q < 3; q++) { rope([ex0, ez0 + (ez1 - ez0) * q / 3], [ex0, ez0 + (ez1 - ez0) * (q + 1) / 3]); rope([ex1, ez0 + (ez1 - ez0) * q / 3], [ex1, ez0 + (ez1 - ez0) * (q + 1) / 3]); }
      S((ex0 + ex1) / 2, ez0, ex1 - ex0, 0.12, fy, fy + 0.95); S((ex0 + ex1) / 2, ez1, ex1 - ex0, 0.12, fy, fy + 0.95); S(ex0, (ez0 + ez1) / 2, 0.12, ez1 - ez0, fy, fy + 0.95); S(ex1, (ez0 + ez1) / 2, 0.12, ez1 - ez0, fy, fy + 0.95);
      if (!MT.exhibit) MT.exhibit = new THREE.MeshBasicMaterial({ map: exhibitTex() }); [ex0 - 1.6, ex1 + 1.6].forEach(function (px, k) { K.box("black", 1.1, 1.55, 0.08, px, fy + 1.05, ez1 + 0.6, k ? -0.3 : 0.3); K.quad("exhibit", 1.0, 1.37, px + (k ? -0.012 : 0.012), fy + 1.08, ez1 + 0.65, k ? -0.3 : 0.3); K.box("black", 0.08, 0.3, 0.3, px, fy + 0.15, ez1 + 0.6); S(px, ez1 + 0.6, 1.1, 0.3, fy, fy + 1.8, k ? -0.3 : 0.3); });
      L.tug = null; L.gpu = null; return;
    }
    // a towbarless tug parked right of the nose, in Stellar blue with a yellow chevron band and an amber beacon
    var tx = J.x + Math.min(4.2, J.span * 0.28), tz = nose + 0.8; if (J.kind === "biplane") { tx = J.x + 5.5; tz = nose + 1.2; }
    K.box("stellar", 1.9, 0.5, 3.6, tx, fy + 0.5, tz); K.box("yellow", 1.94, 0.1, 3.64, tx, fy + 0.8, tz); K.box("stellar", 1.7, 0.12, 3.3, tx, fy + 0.91, tz); K.box("black", 1.94, 0.18, 3.64, tx, fy + 0.28, tz);
    K.box("steel", 1.2, 0.12, 1.3, tx, fy + 0.26, tz + 2.3); K.box("steel", 0.12, 0.34, 1.3, tx - 0.55, fy + 0.4, tz + 2.3); K.box("steel", 0.12, 0.34, 1.3, tx + 0.55, fy + 0.4, tz + 2.3); K.box("yellow", 1.3, 0.06, 0.08, tx, fy + 0.6, tz + 2.95);
    K.box("black", 0.62, 0.7, 0.22, tx - 0.35, fy + 1.3, tz - 1.35); K.box("black", 0.66, 0.1, 0.62, tx - 0.35, fy + 1.0, tz - 1.1); K.box("leather", 0.52, 0.12, 0.5, tx - 0.35, fy + 1.1, tz - 1.1); K.cyl("black", 0.03, 0.03, 0.55, tx + 0.35, fy + 1.25, tz - 1.25, 8); K.cyl("black", 0.16, 0.16, 0.03, tx + 0.35, fy + 1.52, tz - 1.2, 16, 0.5);
    K.cyl("orange", 0.08, 0.08, 0.12, tx + 0.7, fy + 1.03, tz - 1.55, 10); K.box("lampW", 0.22, 0.1, 0.03, tx - 0.6, fy + 0.62, tz + 1.81); K.box("lampW", 0.22, 0.1, 0.03, tx + 0.6, fy + 0.62, tz + 1.81);
    [[-0.9, -1.15], [0.9, -1.15], [-0.9, 1.15], [0.9, 1.15]].forEach(function (w) { K.cyl("rubber", 0.33, 0.33, 0.28, tx + w[0], fy + 0.33, tz + w[1], 18, 0, Math.PI / 2); K.cyl("steel", 0.18, 0.18, 0.3, tx + w[0], fy + 0.33, tz + w[1], 12, 0, Math.PI / 2); });
    S(tx, tz + 0.3, 2.0, 4.4, fy, fy + 1.3);
    // ground power unit left of the nose with its cable to the aircraft
    var gx = J.x - Math.min(3.0, J.span * 0.2), gz = nose - 0.2; K.box("white", 1.0, 0.9, 1.5, gx, fy + 0.62, gz); K.box("stellar", 1.02, 0.12, 1.52, gx, fy + 0.84, gz); K.box("steel", 1.04, 0.06, 1.54, gx, fy + 1.1, gz); K.box("steel", 1.0, 0.1, 1.6, gx, fy + 0.2, gz);
    for (var vv = 0; vv < 5; vv++) K.box("black", 0.02, 0.04, 1.0, gx - 0.51, fy + 0.45 + vv * 0.07, gz); K.box("black", 0.02, 0.38, 0.46, gx + 0.51, fy + 0.72, gz - 0.2); K.box("lineY", 0.01, 0.06, 0.06, gx + 0.52, fy + 0.84, gz + 0.1); K.box("lampW", 0.01, 0.05, 0.05, gx + 0.52, fy + 0.84, gz + 0.22);
    K.cyl("black", 0.22, 0.22, 0.16, gx, fy + 1.22, gz + 0.35, 16, Math.PI / 2); K.cyl("steel", 0.03, 0.03, 0.9, gx, fy + 0.62, gz + 0.85, 6, Math.PI / 2); K.box("steel", 0.5, 0.04, 0.04, gx, fy + 1.05, gz + 1.25);
    [[-0.4, -0.6], [0.4, -0.6], [-0.4, 0.6], [0.4, 0.6]].forEach(function (w) { K.cyl("rubber", 0.1, 0.1, 0.07, gx + w[0], fy + 0.1, gz + w[1], 10, 0, Math.PI / 2); });
    S(gx, gz, 1.1, 1.6, fy, fy + 1.1);
    var c0 = new THREE.Vector3(gx + 0.5, fy + 0.5, gz + 0.2), c1 = new THREE.Vector3((gx + J.x) / 2 + 0.3, fy + 0.06, nose - 1.4), c2 = new THREE.Vector3(J.x - 0.9, fy + 1.3, nose - 2.4); var curve = new THREE.CatmullRomCurve3([c0, c1, c2]); var tube = new THREE.TubeGeometry(curve, 20, 0.035, 6, false); K.put("black", tube);
    // wheel chocks at the main gear and the nose gear, cones at the wingtips
    var jm = MODELS[J.kind]; var gzM = J.z - J.len * 0.06, gzN = nose - J.len * 0.13; [[J.x - J.span * 0.09, gzM], [J.x + J.span * 0.09, gzM], [J.x, gzN]].forEach(function (c) { K.box("yellow", 0.5, 0.16, 0.18, c[0], fy + 0.08, c[1] + 0.45); K.box("yellow", 0.5, 0.16, 0.18, c[0], fy + 0.08, c[1] - 0.45); });
    [J.x - J.span / 2 - 0.1, J.x + J.span / 2 + 0.1].forEach(function (cx) { K.cyl("orange", 0.04, 0.17, 0.62, cx, fy + 0.33, J.z - J.len * 0.08, 12); K.box("orange", 0.36, 0.03, 0.36, cx, fy + 0.015, J.z - J.len * 0.08); });
    L.tug = { x: tx, z: tz }; L.gpu = { x: gx, z: gz };
  }
  function placeModels(L, M) {
    var g = L.g, fy = L.fy, S = L.solid;
    var addModel = function (kind, x, y, z, ry, sc) { if (!has(kind)) return null; var o = makeModel(kind); o.position.set(x, y, z); o.rotation.y = ry || 0; if (sc) o.scale.setScalar(sc); o.traverse(function (q) { if (q.isMesh) { q.castShadow = true; q.receiveShadow = true; q.userData.noSolid = true; } }); g.add(o); return o; };
    // the flight planning desk facing the window, its chair; lounge chairs at the balustrade facing the screen
    if (L.office) { var o = L.office; if (addModel("exec_desk", o.x, o.y, o.z + 0.2, Math.PI, 0.9)) S(o.x, o.z + 0.2, 1.85, 0.95, o.y, o.y + 0.75); var ch = addModel("lounge_chair", o.x, o.y, o.z + 1.25, Math.PI, 0.9); if (ch) S(o.x, o.z + 1.25, 0.6, 0.6, o.y, o.y + 0.44, 0, { face: Math.PI }); }
    if (L.divans && has("cab_divan")) L.divans.forEach(function (d) { var c = Math.cos(d[2]), s = Math.sin(d[2]); var P = function (lx, lz) { return [d[0] + lx * c + lz * s, d[1] - lx * s + lz * c]; }; if (addModel("cab_divan", d[0], L.MZ + fy, d[1], d[2], 1.0)) { var p0 = P(0, 0.08), p1 = P(0, -0.24); S(p0[0], p0[1], 1.9, 0.46, L.MZ + fy, L.MZ + fy + 0.43, d[2], { face: d[2] }); S(p1[0], p1[1], 2.1, 0.2, L.MZ + fy, L.MZ + fy + 0.72, d[2]); } });
    if (L.lounge) { var l = L.lounge; [-0.7, 0.7].forEach(function (dz, i) { var cx = l.x, cz = l.z + dz, ry = -Math.PI / 2 + (i ? -0.25 : 0.25); if (addModel("lounge_chair", cx, l.y, cz, ry, 1.0)) S(cx, cz, 0.62, 0.62, l.y, l.y + 0.46, 0, { face: ry }); }); }
    if (L.lobby && has("term_planter")) { var pl = addModel("term_planter", L.lobby.x - 0.3, fy, L.lobby.z + 0.6, 0.3, 0.75); if (pl) S(L.lobby.x - 0.3, L.lobby.z + 0.6, 0.9, 0.9, fy, fy + 0.8); }
    if (L.lobby) { var bench = addModel("lounge_chair", L.lobby.x + 0.3, fy, L.lobby.z - 0.4, Math.PI / 2 + 0.3, 1.0); if (bench) S(L.lobby.x + 0.3, L.lobby.z - 0.4, 0.62, 0.62, fy, fy + 0.46, 0, { face: Math.PI / 2 + 0.3 }); }
  }
  function disposeInterior(h) {
    var L = h && h.L; if (!L) return; try { if (inside && inside.hgr === h) myLeave(); } catch (e) {}
    L.solids.forEach(function (sd) { var i = SOLIDS.indexOf(sd); if (i >= 0) SOLIDS.splice(i, 1); });
    if (L.g.parent) L.g.parent.remove(L.g);
    L.g.traverse(function (o) { if (o.isMesh && o.userData.hgrKey && o.geometry) o.geometry.dispose(); });
    h.L = null; H.n.disposes = (H.n.disposes || 0) + 1; chiefAt(null); try { LIGHTS.dirty = true; } catch (e) {}
  }

  // ───────────────────────── the Stellar crew chief (one character, moved to the active hangar) ─────────────────────────
  var CH = H.chief = H.chief || { g: null, hs: null, cool: 0 };
  function refreshTalk() { var c = C().chief || DEF.chief; var T = window.PLAN_TALK.hgr_chief; if (T) { T.name = c.name; T.role = c.role; T.talk = c.talk; T.greet = c.greet || []; } if (CH.hs) { CH.hs.t = c.name; CH.hs.k = c.role + " · press E to talk"; CH.hs.p = (c.talk && c.talk[0] && c.talk[0].t) || ""; } }
  function ensureChief() {
    if (CH.g) return CH.g; var c = C().chief || DEF.chief;
    try { var g = avatar("hgr_chief", c.name, { body: "m", skin: "c98e62", shirt: "0f2745", pants: "1c2733", hair: 1, hairc: "231a14" }, null, null); try { g.userData.label.scale.set(1.9, 0.48, 1); } catch (x) {} g.visible = false; scene.add(g); CH.g = g; }
    catch (e) { note("chief", e); return null; }
    window.PLAN_TALK.hgr_chief = { id: "hgr_chief", name: c.name, role: c.role, talk: c.talk, kw: [], greet: c.greet || [], get g() { return CH.g; } };
    CH.hs = { x: 1e9, z: 1e9, r: 3.2, t: c.name, k: c.role + " · press E to talk", p: (c.talk && c.talk[0] && c.talk[0].t) || "", play: "npc:hgr_chief" }; hotspots.push(CH.hs);
    return CH.g;
  }
  function chiefAt(L) {
    var g = ensureChief(); if (!g) return; if (!L || !L.jet) { g.visible = false; CH.hs.x = CH.hs.z = 1e9; CH.L = null; return; }
    var J = L.jet, e = L.e; var lx = J.x - Math.min(5.2, J.span * 0.36), lz = J.z + J.len / 2 + 0.6; if (J.kind === "biplane") { lx = J.x - J.span / 2 - 2.3; lz = J.z + J.len / 2 + 2.0; }
    var w = l2w(e, lx, lz); g.position.set(w[0], e[1] + L.fy, w[1]); g.rotation.y = e[3]; g.visible = true; CH.yaw0 = e[3]; CH.L = L;
    var hv = l2w(e, lx + 0.6, lz + 1.4); CH.hs.x = hv[0]; CH.hs.z = hv[1];
    var sd = addSolid(w[0], w[1], e[3], 0.5, 0.5, e[1] + L.fy, e[1] + L.fy + 1.8, "hgri"); if (sd) L.solids.push(sd);
  }
  function chiefFrame(dt) {
    var g = CH.g; if (!g || !CH.L) return; var hL = H.active; var show = !!(hL && hL.L === CH.L && (hL.open > 0.3 || (inside && inside.hgr === hL))); if (g.visible !== show) g.visible = show; if (!show) return; try { var dx = player.position.x - g.position.x, dz = player.position.z - g.position.z, d = Math.hypot(dx, dz); var want = d < 8 ? Math.atan2(dx, dz) : CH.yaw0; var a = g.rotation.y, df = Math.atan2(Math.sin(want - a), Math.cos(want - a)); g.rotation.y = a + df * Math.min(1, dt * 2.5); animateWalk(g, 0, dt);
      CH.cool -= dt; if (d < 6 && CH.cool <= 0 && typeof npcSay === "function") { var c = C().chief || DEF.chief; var gr = c.greet || []; if (gr.length) { npcSay(window.PLAN_TALK.hgr_chief, gr[Math.floor(Math.random() * gr.length)]); } CH.cool = 40 + Math.random() * 30; } } catch (e) { note("chief frame", e); } }

  // ───────────────────────── entering and leaving (the client's `inside`, without a fade or teleport) ─────────────────────────
  function localOf(h) { var w = w2l(h.e, player.position.x, player.position.z); return w; }
  function myEnter(h) {
    if (inside || (typeof riding !== "undefined" && riding) || (typeof golf !== "undefined" && golf.playing) || !h.L) return false; try { if (cartMode) toggleCart(); } catch (e) {}
    var I = INFO(), s = h.s, e = h.e; var half = Math.max(I.size[0], I.size[2]) / 2 * s + 0.4;
    var door = { kind: KIND, i: h.i, e: e, r: MODELS[KIND].radius * s };
    var atDoor = function () { var p = localOf(h); return p[1] > I.door.z * s - 2.2 && p[0] > I.door.x0 * s && p[0] < I.door.x1 * s; };
    inside = { door: door, g: h.L.g, half: half, atDoor: atDoor, hiddenWorld: [], saved: [], hgr: h };
    try { lastSent.at = 0; pushMove(true); } catch (e2) {} H.n.enters = (H.n.enters || 0) + 1; return true;
  }
  function myLeave() {
    if (!inside || !inside.hgr) return; try { if (SIT.on) { SIT.on = false; player.userData.sit = false; } } catch (e) {}
    inside_left_at = performance.now(); try { player.userData.walk.visible = true; } catch (e) {} inside = null; try { lastSent.at = 0; pushMove(true); } catch (e) {} H.n.leaves = (H.n.leaves || 0) + 1;
  }

  // ───────────────────────── frame: which hangar is active, doors, entering, lights, sound ─────────────────────────
  var R_BUILD = 46, R_DROP = 100, R_OPEN = 20, R_SHUT = 27, R_STAGE = 80, R_NOW = 12;   // R5: inside R_BUILD the staged build gets 10 ms a frame; only within R_NOW (a warp to the door) is it finished at once   // R_STAGE: the staged build starts (plan_perf.js budget); R_BUILD: finished at once
  var AU = { hum: null, motor: null, t: 6 };
  function frame(dt) {
    if (H.off || !H.list.length || !player) return; var px = player.position.x, pz = player.position.z; var I = INFO();
    var flying = false; try { flying = !!(FLY && FLY.on); } catch (e) {}
    // nearest hangar
    var best = null, bd = 1e9; for (var i = 0; i < H.list.length; i++) { var h = H.list[i]; var d = Math.hypot(h.e[0] - px, h.e[2] - pz) - 12 * h.s; if (d < bd) { bd = d; best = h; } }
    if (H.active && best && best !== H.active && !(inside && inside.hgr)) { var dA = Math.hypot(H.active.e[0] - px, H.active.e[2] - pz) - 12 * H.active.s; if (dA < bd * 1.15 + 3) { best = H.active; bd = dA; } }   // R5: hysteresis, the built one stays until another is clearly nearer (no rebuild at every midpoint of a row)
    H.near = best; H.nearD = bd;
    // interior: one at a time, built on approach (the open door shows it), dropped when you walk away
    var act = H.active; if (act && (Math.hypot(act.e[0] - px, act.e[2] - pz) - 12 * act.s > R_DROP || flying) && !(inside && inside.hgr === act)) { disposeInterior(act); H.active = act = null; }
    var SB = H.sb; if (SB && (SB.h !== best || flying || (inside && inside.hgr) || bd > R_STAGE + 12)) { try { abortBuild(SB.h); } catch (e) {} H.sb = SB = null; }
    if (best && !flying && bd >= R_NOW && bd < R_STAGE && act !== best && !(inside && inside.hgr) && window.PLAN_PERF && PLAN_PERF.step) { try { if (!SB) { if (act) { disposeInterior(act); H.active = act = null; } SB = H.sb = { h: best, it: buildSteps(best) }; } if (PLAN_PERF.step(SB.it, bd < R_BUILD ? 10 : undefined).done) { H.sb = null; H.active = act = best; chiefAt(best.L); H.n.staged = (H.n.staged || 0) + 1; PLAN_PERF.warmGroup(best.L.g, { name: "hangar " + best.id }); } } catch (e) { note("stage " + best.id, e); H.sb = null; try { abortBuild(best); } catch (x) {} } }
    if (best && !flying && (bd < R_NOW || (bd < R_BUILD && !(window.PLAN_PERF && PLAN_PERF.step))) && act !== best && !(inside && inside.hgr)) { if (act) disposeInterior(act); try { if (SB && SB.h === best) { H.sb = null; while (!SB.it.next().done); } else buildInterior(best); H.active = best; chiefAt(best.L); } catch (e) { note("build " + best.id, e); try { disposeInterior(best); } catch (x) {} H.active = null; } }
    // doors: open when you walk up to the front, shut when you leave; E overrides until you walk away
    for (var j = 0; j < H.list.length; j++) { var hh = H.list[j]; if (H.hold && H.hold[hh.id] !== undefined) { hh.open = hh.target = H.hold[hh.id]; setDoor(hh, hh.open); doorSolidOn(hh, hh.open < 0.62); continue; }   // tests: hold a door at an opening
      var near = hh === best && bd < R_SHUT + 10;
      if (near) { var p = w2l(hh.e, px, pz), s = hh.s; var inFront = p[1] > I.door.z * s - 1 && p[1] < I.door.z * s + R_OPEN && p[0] > I.door.x0 * s - 6 && p[0] < I.door.x1 * s + 6; var dist = Math.hypot(p[0] - (I.door.x0 + I.door.x1) / 2 * s, p[1] - I.wall_z * s);
        var auto = (inFront && dist < R_OPEN) || (inside && inside.hgr === hh) || (p[1] < I.door.z * s && Math.abs(p[0]) < I.size[0] / 2 * s && Math.abs(p[1]) < I.size[2] / 2 * s);
        if (hh.manual !== null && dist > R_SHUT + 6) hh.manual = null; hh.target = hh.manual !== null ? (hh.manual ? 1 : 0) : auto ? 1 : (dist > R_SHUT ? 0 : hh.target); if (!hh.L) hh.target = 0; }
      else { hh.target = 0; hh.manual = null; }
      if (hh.open !== hh.target) { var sp = dt / 4.5; hh.open = hh.target > hh.open ? Math.min(hh.target, hh.open + sp) : Math.max(hh.target, hh.open - sp); setDoor(hh, hh.open); hh.moving = true; } else hh.moving = false;
      doorSolidOn(hh, hh.open < 0.62);
    }
    // walking in and out through the door
    if (best && best.L) { var q = w2l(best.e, px, pz), S2 = best.s, Lb = best.L; var inBox = q[0] > Lb.xL - 0.3 && q[0] < Lb.xR + 0.3 && q[1] > Lb.zB - 0.3 && q[1] < I.wall_z * S2 + 0.1;
      if (!inside && inBox && performance.now() - (inside_left_at || 0) > 600) myEnter(best);
      else if (inside && inside.hgr === best && (q[1] > I.wall_z * S2 + 0.35 || q[0] < Lb.xL - 1 || q[0] > Lb.xR + 1 || q[1] < Lb.zB - 1)) myLeave(); }
    if (inside && inside.hgr && inside.hgr !== best) myLeave();
    // a built interior is drawn (and its pooled lights shine) only while its door is open or you are inside: behind a shut door
    // it would cost about 48 draws in every view that has the hangar in frame, and its lights would spill onto the apron
    try { var ai = H.active; if (ai && ai.L) { var vis = !!(inside && inside.hgr === ai) || ai.open > 0.02; if (ai.L.g.visible !== vis) { ai.L.g.visible = vis; ai.L.lights.forEach(function (l) { if (l.userData.k0 === undefined) l.userData.k0 = l.intensity; l.intensity = vis ? l.userData.k0 : 0; }); } } } catch (e) { note("interior vis", e); }
    chiefFrame(dt);
    try { var ah = H.active; if (ah && ah.L) { var cq = w2l(ah.e, camera.position.x, camera.position.z); if (cq[0] > ah.L.xL - 0.2 && cq[0] < ah.L.xR + 0.2 && cq[1] > ah.L.zB - 0.2 && cq[1] < ah.L.zF + 0.3 && camera.position.y < ah.e[1] + ah.L.Hc) hemi.intensity = Math.max(hemi.intensity, 0.46); } } catch (e) { note("hemi", e); }
    // night: signs, number plates and the door glass glow; the wall lights pool on the apron
    try { var M = EX.m; if (M) { var n = typeof night === "number" ? night : 0; M.sign.emissiveIntensity = 0.05 + 1.1 * n; M.numbers.emissiveIntensity = 0.9 * n; M.plates.emissiveIntensity = 0.8 * n; M.doorGlass.emissiveIntensity = 0.1 + 0.9 * n; M.lightF.emissiveIntensity = 2.2 * n; M.pool.opacity = 0.55 * n; for (var k in M.textSigns) M.textSigns[k].emissiveIntensity = 0.05 + 0.9 * n; }
      if (MT) { MT.clere.color.setScalar(0.25 + 0.7 * (1 - n)); MT.brand.emissiveIntensity = 0.45 + 0.35 * n; } } catch (e) { note("night", e); }
    audio(dt, best);
  }
  function audio(dt, best) {
    try { if (typeof audioReady === "undefined" || !audioReady) return; var on = soundOn ? 1 : 0; var inH = inside && inside.hgr ? 1 : 0; var moving = best && best.moving && H.nearD < 30 ? 1 : 0;
      if (!AU.hum && on && (inH || moving)) { AU.hum = ambLoop("lowpass", 130, 0.8); AU.motor = ambLoop("bandpass", 95, 2.5); }
      if (AU.hum) { var v = (VOL.amb || 1) * (VOL.master || 1) * on; AU.hum.gain.value += (0.06 * inH * v - AU.hum.gain.value) * Math.min(1, dt * 2); AU.motor.gain.value += (0.14 * moving * v - AU.motor.gain.value) * Math.min(1, dt * 3); }
      if (inH && on) { AU.t -= dt; if (AU.t <= 0) { AU.t = 7 + Math.random() * 14; var r = Math.random(); if (r < 0.4) { for (var i = 0; i < 5; i++) setTimeout(function () { noise(0.05, 0.035, 2600); }, i * 70); } else if (r < 0.7) tone(210 + Math.random() * 60, 0.12, "triangle", 0.018); else noise(0.3, 0.02, 900); } } } catch (e) { note("audio", e); }
  }
  // the camera inside a hangar: the client's interior camera, bounded by the hangar's walls (a rectangle) instead of a square
  function camHook(dt) {
    if (!inside || !inside.hgr || window.__cam) return false; var h = inside.hgr, L = h.L; if (!L) return false;
    try { var fwd = [-Math.sin(yaw), -Math.cos(yaw)]; var px = player.position.x, pz = player.position.z; var dist = 0;
      for (var d = 0; d <= 3.4; d += 0.2) { var cx = px - fwd[0] * d, cz = pz - fwd[1] * d; var p = w2l(h.e, cx, cz); if (p[0] < L.xL + 0.35 || p[0] > L.xR - 0.35 || p[1] < L.zB + 0.35 || p[1] > L.zF + 3) break; dist = d; }
      if (inside.fp === undefined) inside.fp = dist < 1.4; else if (inside.fp && dist > 2.2) inside.fp = false; else if (!inside.fp && dist < 1.2) inside.fp = true;
      CAM.dist += (dist - CAM.dist) * smoothK(dt, 10); var sd = Math.min(dist, CAM.dist);
      if (inside.fp) { camera.position.set(px, player.position.y - bobY + 1.62, pz); CAM.init = false; camera.lookAt(px + fwd[0] * 10, player.position.y - bobY + 1.62 - pitch * 6, pz + fwd[1] * 10); player.userData.walk.visible = false; }
      else { var cy = Math.min(player.position.y - bobY + 1.9 + pitch * 1.2, h.e[1] + L.Hc - 0.6); camera.position.lerp(camTarget.set(px - fwd[0] * sd, cy, pz - fwd[1] * sd), smoothK(dt, 24)); camLook(px, player.position.y - bobY + 1.3, pz, dt, 30); player.userData.walk.visible = true; }
      return true; } catch (e) { note("cam", e); return false; }
  }

  // ───────────────────────── E and the prompt ─────────────────────────
  function nearJet() { var L = H.active && H.active.L; if (!L || !L.jet || !L.jet.kind || !inside || inside.hgr !== H.active) return false; var p = w2l(L.e, player.position.x, player.position.z); var J = L.jet; var ax = Math.abs(p[0] - J.x), az = p[1] - J.z; return (ax < 2.6 && Math.abs(az) < J.len / 2 + 2.2) || (ax < J.span / 2 + 1.2 && Math.abs(az + J.len * 0.05) < 3.2); }
  function nearDoorOutside() { var h = H.near; if (!h || inside || !h.L || H.nearD > 30) return null; var I = INFO(), s = h.s; var p = w2l(h.e, player.position.x, player.position.z); if (p[1] < I.wall_z * s - 0.2 || p[1] > I.wall_z * s + 9 || p[0] < I.door.x0 * s - 2 || p[0] > I.door.x1 * s + 2) return null; return h; }
  function jetCard() { var L = H.active.L, J = L.jet; var A = (C().aircraft || {})[J.kind] || DEF.aircraft[J.kind] || { t: "Aircraft", k: "", p: "" }; var lab = H.active.lab || label(H.active); var nm = lab.num ? "hangar " + lab.num : "this hangar";
    $("#info-h").textContent = A.t; $("#info-k").textContent = String(A.k || "").replace("{hangar}", nm); $("#info-p").textContent = A.p; var go = $("#info-go"); if (go) go.style.display = "none"; var nv = $("#info-nav"); if (nv) nv.style.display = "none"; $("#info").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock(); try { sfx("ui"); } catch (e) {} }
  function handleE() {
    try { if (H.off) return false;
      if (inside && inside.hgr) { if (SIT.on) return false; if (nearestSeat()) return false; var nh = nearestHotspot(); if (nh && nh.play && nh.play.indexOf("npc:") === 0) return false; if (inside.atDoor()) return false; if (inside.door.e && inside.door.e.shop) return false; if (nearJet()) { jetCard(); return true; } return false; }
      if (!inside && !riding) { var h = nearDoorOutside(); if (h) { var open = h.target > 0.5; h.manual = !open; h.target = h.manual ? 1 : 0; try { sfx("board"); } catch (e) {} return true; } }
    } catch (e) { note("E", e); } return false;
  }
  function prompt() {
    try { if (H.off) return; var el = $("#prompt"), t = $("#prompt-t"); if (!el || !t) return;
      if (inside && inside.hgr) { if (SIT.on || nearestSeat()) return; var nh = nearestHotspot(); if (nh && nh.play && nh.play.indexOf("npc:") === 0) return; if (inside.atDoor()) { t.innerHTML = "<b>E</b> &nbsp;step outside · or just walk out"; return; } if (inside.door.e && inside.door.e.shop) return; if (nearJet()) { t.innerHTML = "<b>E</b> &nbsp;about this aircraft"; el.classList.add("on"); return; } t.innerHTML = "<b>E</b> &nbsp;look around · the stair to the crew lounge is at the back on the left"; return; }
      if (!inside && !riding) { var h = nearDoorOutside(); if (h) { var open = h.target > 0.5; t.innerHTML = open ? (h.open >= 0.62 ? "<b>E</b> &nbsp;close the hangar door · or walk in" : "<b>E</b> &nbsp;close the hangar door") : "<b>E</b> &nbsp;open the hangar door"; el.classList.add("on"); } } } catch (e) { note("prompt", e); }
  }

  // ───────────────────────── install ─────────────────────────
  // every override and hook dispatches through H.impl, so a new copy of this file evaluated in a running page takes over (hot
  // reload in tests: the hooks are re-pointed by name, the exterior dressing and the active interior are rebuilt with the new code)
  function install(force) {
    if (H.installed && !force) return; if (!H.orig) H.orig = { enterInterior: enterInterior, leaveInterior: leaveInterior, openNearest: openNearest, updateZone: updateZone }; H.installed = true; var orig = H.orig;
    enterInterior = function (door) { if (door && door.kind === KIND) { var h = H.list[door.i]; if (h && h.L) return H.impl.myEnter(h); return; } return orig.enterInterior.apply(this, arguments); };
    leaveInterior = function () { if (inside && inside.hgr) return H.impl.myLeave(); return orig.leaveInterior.apply(this, arguments); };
    openNearest = function () { if (H.impl.handleE()) return; return orig.openNearest.apply(this, arguments); };
    updateZone = function () { var r = orig.updateZone.apply(this, arguments); H.impl.prompt(); return r; };
  }
  function rebuildAll() {
    try { if (H.active) { var a = H.active; if (inside && inside.hgr) { inside = null; } if (a.L) { a.L.solids.forEach(function (sd) { var i = SOLIDS.indexOf(sd); if (i >= 0) SOLIDS.splice(i, 1); }); if (a.L.g.parent) a.L.g.parent.remove(a.L.g); a.L = null; } H.active = null; }
      (EX.meshes || []).forEach(function (m) { scene.remove(m); m.geometry.dispose(); }); [EX.frames, EX.glass].forEach(function (m) { if (m) { scene.remove(m); } }); EX.meshes = []; EX.built = false; EX.m = null; EX.frames = EX.glass = null; for (var k in TX) delete TX[k]; H.occ = {};
      buildExterior(); H.list.forEach(function (h) { setDoor(h, h.open); }); refreshTalk(); } catch (e) { note("rebuild", e); }
  }
  H.impl = { frame: frame, camHook: camHook, handleE: handleE, prompt: prompt, myEnter: myEnter, myLeave: myLeave, rekind: rekind, buildExterior: buildExterior, ensureChief: ensureChief, mats: mats, clearDoors: clearDoors };
  H.api = { frame: frame, buildInterior: buildInterior, disposeInterior: disposeInterior, setDoor: setDoor, rekind: rekind, myEnter: myEnter, myLeave: myLeave, INFO: INFO, l2w: l2w, w2l: w2l, occBoxes: occBoxes, jetCard: jetCard, rebuildAll: rebuildAll };
  (function hookAll() {
    var set = function (phase, name, fn) { var list = window.PLAN_HOOKS[phase]; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name: name, fn: fn }); };
    set("world", "hangarsWorld", function () { if (H.off) return; if (!MODELS[KIND]) { note("model", new Error("hangar_exec not loaded; the old hangars stay")); return; } install(); H.impl.rekind("world"); });
    set("terrain", "hangarsTerrain", function () { if (H.off || !MODELS[KIND] || !H.installed) return; H.impl.rekind("terrain"); try { H.impl.clearDoors(); } catch (e) { note("clear doors", e); } });
    set("defer", "hangarsDefer", function () { if (H.off || !H.list.length) return; try { H.impl.buildExterior(); } catch (e) { note("exterior", e); } try { H.impl.ensureChief(); } catch (e) { note("chief", e); } try { if (window.requestIdleCallback) requestIdleCallback(function () { try { H.impl.mats(); } catch (x) { note("warm", x); } }); } catch (e) {} });
    set("frame", "hangarsFrame", function (dt) { try { H.impl.frame(dt); } catch (e) { note("frame", e); } });
    set("interior", "hangarsCam", function (dt) { return H.impl.camHook(dt); });
  })();
  if (H.installed && H.list.length) rebuildAll();   // the wrappers already dispatch through H.impl (and other modules may have wrapped them since)
})();
