// R4 DOMES (1 Oct 2026): the Dome Suites (geodesic glamping domes with a glass front, remade from the old "dome" model at the
// Club Lodges, the Commons glamping loop and South Ridge) and the Grand Vault Domes (R5: flattened domes of soft white panels
// over a near square floor, both ends cut into great glazed arches under a white rim, arched window bands down the sides: a
// dining room, an event and wedding hall and a wellness studio at Pavilion Green). R5 also: furniture built from rounded,
// cushioned, turned and draped pieces (and the game's own lounge_chair and cab_divan), warm fresh decking, warm venue light
// after dark, name labels and chat bubbles hidden behind walls, CM8 back in the Commons loop. Classic script, loaded
// before client.js; hooks into window.PLAN_HOOKS { terrain, world, defer, frame, interior }. All names, copy, sizes and positions:
// plan/domes.json (the user can rename, move or resize anything there).
//   - every suite: a procedural 4V geodesic dome (white membrane panels, crisp struts, a glass front of triangular panes with a
//     framed door portal, a stargazing skylight, a wood stove flue), a raised timber deck with steps and a cable railing, a cedar
//     barrel hot tub with steps and animated water and steam, a plunge pool on some, a fire pit with chairs, an outdoor dining
//     set, string lights and low path lights, desert planting; a furnished interior seen through the glass (warm after dark).
//     Every repeated part is one InstancedMesh per cluster, size and material; far away a single cheap dome per suite.
//   - the model suite of each cluster is a seamless walk-in interior built when you come near (grand living with sofas and
//     armchairs on a rug, a wood stove with a live fire, a king bed, a sofa bed, a daybed or a sleeping loft, a kitchenette,
//     a bathroom pod, curtains, plants, warm lamps); lie on the bed (E) to stargaze through the skylight (plan_stargaze.js API).
//   - the Grand Vault Domes: procedural vaults on timber decks with cable railings and string lights, glazed arched ends with
//     glass doors, walk-in interiors fitted to their use, a staff member with a talk card in each.
// ?domes=0 turns the module off. window.PLAN_DOMES: n (counters), errs, cfg, site, api, debug.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var DM = window.PLAN_DOMES = window.PLAN_DOMES || {};
  DM.errs = DM.errs || []; DM.n = DM.n || { builds: 0, disposes: 0, vbuilds: 0, vdisposes: 0 }; DM.ver = "r5";
  if (/[?&]domes=0\b/.test(location.search)) { DM.off = true; return; }
  var PI = Math.PI, TAU = PI * 2;
  function note(tag, e) { try { if (DM.errs.length < 50) DM.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (DM.errs.length <= 6) console.warn("plan_domes " + tag, e); } catch (x) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function ease(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function rng(seed) { var s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function nowMs() { return performance.now(); }
  function has(k) { try { return !!(MODELS[k] && (MODELS[k].parts || MODELS[k]._pp)); } catch (e) { return false; } }
  function canPut(k) { try { return has(k) && !!MODEL_SPECS[k]; } catch (e) { return false; } }
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function $id(id) { return document.getElementById(id); }

  // ───────────────────────── config: plan/domes.json ─────────────────────────
  var CFG = DM.cfg || null;
  function cfgUrl() { var u = "/plan/domes.json?v=" + (window.BUILD || "dev"); try { if (window.AV) u = window.AV(u); } catch (e) {} return u; }
  if (!CFG) { try { fetch(cfgUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && !CFG) { CFG = DM.cfg = d; } }).catch(function (e) { note("cfg fetch", e); }); } catch (e) { note("cfg", e); } }
  // the plan build needs the list of replaced buildings before it places anything: if the fetch has not landed, read it at once
  function cfg() {
    if (CFG) return CFG;
    try { var x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = DM.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); }
    return CFG;
  }
  function C(path, dflt) { var o = cfg(); if (!o) return dflt; var p = path.split("."); for (var i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }
  function hex(s, d) { try { return new THREE.Color(s || d); } catch (e) { return new THREE.Color(d); } }

  // ───────────────────────── the old dome placements this module replaces (PLAN_SKIP, read lazily from the JSON) ─────────────────────────
  // window.PLAN_SKIP is a Set shared by every module; its has() is extended so the ids listed in domes.json (every suite's "from"
  // and each cluster's "replace") are skipped by the client's plan build. Nothing is fetched until the client asks.
  var SKIPSET = null;
  function skipIds() { if (SKIPSET) return SKIPSET; var c = cfg(); if (!c) return null; SKIPSET = new Set(); (c.clusters || []).forEach(function (cl) { (cl.replace || []).forEach(function (id) { SKIPSET.add(id); }); (cl.suites || []).forEach(function (s) { if (s.from) SKIPSET.add(s.from); }); }); DM.skipped = Array.from(SKIPSET); return SKIPSET; }
  (function installSkip() {
    var S = window.PLAN_SKIP; if (!S) S = window.PLAN_SKIP = new Set(); if (S.__domes) return; S.__domes = true;
    if (typeof S.has === "function") { var h0 = S.has; S.has = function (id) { if (h0.call(S, id)) return true; if (typeof id === "string" && /^b\d/.test(id)) { var K = skipIds(); return !!(K && K.has(id)); } return false; }; }
  })();

  // ───────────────────────── geometry kit: primitives in a frame, merged per material (the stargaze module's kit) ─────────────────────────
  var _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _e = new THREE.Euler();
  function toNonIndexed(g) { return g.index ? g.toNonIndexed() : g; }
  function mergeGeos(list, extra) {
    var n = 0; list.forEach(function (g) { n += g.attributes.position.count; }); if (!n) return null;
    var P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), X = extra ? new Float32Array(n * extra.size) : null, o = 0;
    list.forEach(function (g) { var c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); if (g.attributes.normal) N.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2); if (X && g.attributes[extra.name]) X.set(g.attributes[extra.name].array, o * extra.size); o += c; });
    var r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(U, 2)); if (X) r.setAttribute(extra.name, new THREE.BufferAttribute(X, extra.size));
    r.computeBoundingBox(); r.computeBoundingSphere(); return r;
  }
  function Kit() { this.m = {}; }
  Kit.prototype.add = function (key, g) { g = toNonIndexed(g); if (!g.attributes.normal) g.computeVertexNormals(); if (!g.attributes.uv) { var n = g.attributes.position.count; g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2)); } (this.m[key] || (this.m[key] = [])).push(g); return g; };
  Kit.prototype.place = function (key, g, x, y, z, ry, rx, rz, sx, sy, sz) { _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(x, y, z), _q, _v2.set(sx || 1, sy || 1, sz || 1)); g.applyMatrix4(_m4); return this.add(key, g); };
  Kit.prototype.box = function (key, w, h, d, x, y, z, ry, t, rx, rz) { var g = new THREE.BoxGeometry(w, h, d); if (t) uvBox(g, w, h, d, t); return this.place(key, g, x, y, z, ry, rx, rz); };
  Kit.prototype.cyl = function (key, r0, r1, h, x, y, z, seg, open, ry, rx, rz) { var g = new THREE.CylinderGeometry(r0, r1, h, seg || 16, 1, !!open); return this.place(key, g, x, y, z, ry, rx, rz); };
  Kit.prototype.sph = function (key, r, x, y, z, sy, seg, sx, sz) { var g = new THREE.SphereGeometry(r, seg || 12, Math.max(6, (seg || 12) >> 1)); return this.place(key, g, x, y, z, 0, 0, 0, sx || 1, sy || 1, sz || 1); };
  Kit.prototype.geo = function (key, g, x, y, z, ry, rx, rz) { return this.place(key, g, x || 0, y || 0, z || 0, ry, rx, rz); };
  Kit.prototype.flat = function (key, x0, z0, x1, z1, y, up, t) { var g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); var uv = g.attributes.uv; t = t || 1; for (var i = 0; i < uv.count; i++) uv.setXY(i, (x0 + uv.getX(i) * (x1 - x0)) / t, (z0 + uv.getY(i) * (z1 - z0)) / t); g.rotateX(up === false ? PI / 2 : -PI / 2); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2); return this.add(key, g); };
  Kit.prototype.quad = function (key, w, h, x, y, z, ry, rx) { var g = new THREE.PlaneGeometry(w, h); return this.place(key, g, x, y, z, ry, rx || 0, 0); };
  Kit.prototype.disc = function (key, r, x, y, z, seg, t) { var g = new THREE.CircleGeometry(r, seg || 32); g.rotateX(-PI / 2); if (t) { var uv = g.attributes.uv, pa = g.attributes.position; for (var i = 0; i < uv.count; i++) uv.setXY(i, pa.getX(i) / t, pa.getZ(i) / t); } return this.place(key, g, x, y, z); };
  // a beam (box) from A to B with cross-section w (across, in the plane normal to nrm) and d (along nrm)
  Kit.prototype.beam = function (key, A, B, w, d, nrm) {
    var dir = _v1.subVectors(B, A); var L = dir.length(); if (L < 1e-4) return null; dir.multiplyScalar(1 / L);
    var e2 = _v2.copy(nrm).addScaledVector(dir, -nrm.dot(dir)); if (e2.lengthSq() < 1e-8) e2.set(dir.y, -dir.x, 0); e2.normalize(); var e1 = _v3.crossVectors(e2, dir).normalize();
    var g = new THREE.BoxGeometry(w, L, d); _m4.makeBasis(e1, dir, e2); _m4.setPosition((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2); g.applyMatrix4(_m4); return this.add(key, g);
  };
  // a round tube from A to B (radius r, seg sides)
  Kit.prototype.tube = function (key, A, B, r, seg) { var d = new THREE.Vector3().subVectors(B, A), L = d.length(); if (L < 1e-4) return null; var g = new THREE.CylinderGeometry(r, r, L, seg || 6, 1, true); var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); _m4.compose(new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5), q, _v2.set(1, 1, 1)); g.applyMatrix4(_m4); return this.add(key, g); };
  // a triangle list (flat arrays of Vector3 triples) as one geometry with flat normals and planar uvs (t metres per repeat)
  Kit.prototype.tris = function (key, list, t, nrmFn) { if (!list.length) return null; var P = [], N = [], U = []; t = t || 1; list.forEach(function (tr) { var a = tr[0], b = tr[1], c = tr[2]; var n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize(); var ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      [a, b, c].forEach(function (v) { P.push(v.x, v.y, v.z); var nn = nrmFn ? nrmFn(v, n) : n; N.push(nn.x, nn.y, nn.z); if (ay >= ax && ay >= az) U.push(v.x / t, v.z / t); else if (ax >= az) U.push(v.z / t, v.y / t); else U.push(v.x / t, v.y / t); }); });
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); return this.add(key, g); };
  Kit.prototype.build = function (g, mats, opts) { opts = opts || {}; var out = []; for (var k in this.m) { var geo = mergeGeos(this.m[k]); if (!geo) continue; var mt = mats[k]; if (!mt) { note("kit mat", k); continue; } var me = new THREE.Mesh(geo, mt); me.name = "dm " + k; me.castShadow = opts.cast !== false && !mt.transparent && !opts.noCast; me.receiveShadow = !mt.transparent; me.userData.shSet = true; g.add(me); out.push(me); } return out; };
  Kit.prototype.geos = function () { var r = {}; for (var k in this.m) { var geo = mergeGeos(this.m[k]); if (geo) r[k] = geo; } return r; };
  Kit.prototype.count = function () { var n = 0; for (var k in this.m) this.m[k].forEach(function (g) { n += g.attributes.position.count / 3; }); return n; };
  // ── fewer draws: parts are merged by a base material and keep their own colour as a vertex colour (tints: key -> [base, hex, flip]).
  // A part with no tint keeps its own material. aSeed (one value per part) lets the flames flicker apart without instancing.
  var _tc = {};
  function tintColor(hexv) { if (_tc[hexv]) return _tc[hexv]; var c = new THREE.Color(hexv); return (_tc[hexv] = [c.r, c.g, c.b]); }
  function flipGeo(g) { var p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv; for (var i = 0; i < p.count; i += 3) { [p, n, u].forEach(function (a) { if (!a) return; for (var k = 0; k < a.itemSize; k++) { var t = a.array[(i + 1) * a.itemSize + k]; a.array[(i + 1) * a.itemSize + k] = a.array[(i + 2) * a.itemSize + k]; a.array[(i + 2) * a.itemSize + k] = t; } }); } if (n) for (var j = 0; j < n.array.length; j++) n.array[j] = -n.array[j]; return g; }
  function mergeAll(list) {
    var n = 0; list.forEach(function (g) { n += g.attributes.position.count; }); if (!n) return null; var hasC = list.some(function (g) { return g.attributes.color; }), hasS = list.some(function (g) { return g.attributes.aSeed; });
    var P = new Float32Array(n * 3), N = new Float32Array(n * 3), Uu = new Float32Array(n * 2), Cc = hasC ? new Float32Array(n * 3) : null, Sd = hasS ? new Float32Array(n) : null, o = 0;
    list.forEach(function (g) { var c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); if (g.attributes.normal) N.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) Uu.set(g.attributes.uv.array, o * 2); if (Cc) { if (g.attributes.color) Cc.set(g.attributes.color.array, o * 3); else Cc.fill(1, o * 3, (o + c) * 3); } if (Sd && g.attributes.aSeed) Sd.set(g.attributes.aSeed.array, o); o += c; });
    var r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(Uu, 2)); if (Cc) r.setAttribute("color", new THREE.BufferAttribute(Cc, 3)); if (Sd) r.setAttribute("aSeed", new THREE.BufferAttribute(Sd, 1)); r.computeBoundingBox(); r.computeBoundingSphere(); return r;
  }
  // the kit's parts grouped by base (each geometry coloured by its tint), transformed by m4 when given (merging into world space)
  Kit.prototype.based = function (tints, m4, into) { var out = into || {}; for (var k in this.m) { var T0 = tints[k]; var base = T0 ? T0[0] : k; var col = T0 ? tintColor(T0[1]) : null; var arr = out[base] || (out[base] = []);
      this.m[k].forEach(function (g0) { var g = m4 ? g0.clone().applyMatrix4(m4) : g0.clone(); if (T0 && T0[2]) flipGeo(g); if (col) { var cnt = g.attributes.position.count, ca = new Float32Array(cnt * 3); for (var i = 0; i < cnt; i++) { ca[i * 3] = col[0]; ca[i * 3 + 1] = col[1]; ca[i * 3 + 2] = col[2]; } g.setAttribute("color", new THREE.BufferAttribute(ca, 3)); } arr.push(g); }); } return out; };
  function mergeBased(groups) { var r = {}; for (var b in groups) { var g = mergeAll(groups[b]); if (g) r[b] = g; } return r; }
  // build merged meshes per base into a group (bases: base name -> material)
  function* buildBasedSteps(K, grp, tints, bases, out) { var groups = K.based(tints); yield 1; for (var b in groups) { var geo = mergeAll(groups[b]); var mt = bases[b]; if (!geo) continue; if (!mt) { note("base mat", b); continue; } var me = new THREE.Mesh(geo, mt); me.name = "dm " + b; me.castShadow = false; me.receiveShadow = !mt.transparent; me.userData.shSet = true; if (mt.transparent) me.renderOrder = mt.blending === THREE.AdditiveBlending ? 2 : 3; grp.add(me); out.push(me); yield 1; } }
  function buildBased(K, grp, tints, bases, opts) { opts = opts || {}; var geos = mergeBased(K.based(tints)); var out = []; for (var b in geos) { var mt = bases[b]; if (!mt) { note("base mat", b); continue; } var me = new THREE.Mesh(geos[b], mt); me.name = "dm " + b; me.castShadow = !!opts.cast && !mt.transparent; me.receiveShadow = !mt.transparent; me.userData.shSet = true; if (mt.transparent) me.renderOrder = mt.blending === THREE.AdditiveBlending ? 2 : 3; grp.add(me); out.push(me); } return out; }
  function uvBox(g, w, h, d, t) { var uv = g.attributes.uv; var dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (var f = 0; f < 6; f++) for (var k = 0; k < 4; k++) { var i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } }
  function V3(x, y, z) { return new THREE.Vector3(x, y, z); }

  // ───────────────────────── canvas textures (drawn at run time: no image bytes) ─────────────────────────
  DM.old = DM.ready ? { g: DM.groups, sol: DM.sol, hs: DM.hsList, cast: DM.castList, rooms: true } : null;   // a hot reload (dev) rebuilds the visuals
  var TX = DM.tx = DM.old ? {} : (DM.tx || {});
  function cv(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function mkTex(c, rep, lin) { var t = new THREE.CanvasTexture(c); if (!lin) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; try { if (typeof MAX_ANISO !== "undefined") t.anisotropy = Math.min(8, MAX_ANISO); } catch (e) {} t.needsUpdate = true; return t; }
  function panel(key, W, H, fn, rep, lin) { if (TX[key]) return TX[key]; var c = cv(W, H), x = c.getContext("2d"); try { fn(x, W, H); } catch (e) { note("panel " + key, e); } return (TX[key] = mkTex(c, rep, lin)); }
  function noise(x, W, H, n, a, s0, s1, seed) { var R = rng(seed || (W * 7 + H + n)); for (var i = 0; i < n; i++) { x.fillStyle = R() < 0.5 ? "rgba(255,255,255," + a + ")" : "rgba(0,0,0," + a + ")"; var r = s0 + R() * (s1 - s0); x.fillRect(R() * W, R() * H, r, r); } }
  var FONT = { ui: "'Space Grotesk', 'Segoe UI', system-ui, sans-serif", cond: "'Anton', 'Oswald', 'Arial Narrow', Impact, sans-serif", serif: "'Fraunces', Georgia, serif", mono: "'JetBrains Mono', Consolas, monospace" };
  function txt(x, t, px, py, font, color, ls, align, maxW) { x.font = font; x.fillStyle = color; x.textAlign = align || "center"; x.textBaseline = "middle"; try { x.letterSpacing = (ls || 0) + "px"; } catch (e) {} if (maxW) { var w = x.measureText(t).width; if (w > maxW) { x.save(); x.translate(px, py); x.scale(maxW / w, 1); x.fillText(t, 0, 0); x.restore(); try { x.letterSpacing = "0px"; } catch (e) {} return; } } x.fillText(t, px, py); try { x.letterSpacing = "0px"; } catch (e) {} }
  function glowTex() { return panel("glow", 128, 128, function (x, W, H) { var g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.55)"); g.addColorStop(0.6, "rgba(255,255,255,0.14)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, W, H); }); }
  // the PVC membrane: a fine woven white, a whisper of soiling low down is left to the light
  function membraneTex() { return panel("membrane", 512, 512, function (x, W, H) { x.fillStyle = "#f1efe9"; x.fillRect(0, 0, W, H); for (var i = 0; i < W; i += 2) { x.fillStyle = "rgba(0,0,0,0.018)"; x.fillRect(i, 0, 1, H); x.fillRect(0, i, W, 1); } noise(x, W, H, 6000, 0.025, 1, 2, 41); }, true); }
  // the inner liner: a cream quilted canvas (a diamond stitch), the warm inside of a glamping dome
  function linerTex() { return panel("liner", 512, 512, function (x, W, H) { x.fillStyle = "#efe6d6"; x.fillRect(0, 0, W, H); noise(x, W, H, 5000, 0.03, 1, 2, 43); x.strokeStyle = "rgba(120,96,64,0.16)"; x.lineWidth = 2; var s = 64; for (var k = -W; k < W * 2; k += s) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + H, H); x.stroke(); x.beginPath(); x.moveTo(k, H); x.lineTo(k + H, 0); x.stroke(); }
      x.strokeStyle = "rgba(255,255,255,0.35)"; x.lineWidth = 1; for (var k2 = -W; k2 < W * 2; k2 += s) { x.beginPath(); x.moveTo(k2 + 2, 0); x.lineTo(k2 + H + 2, H); x.stroke(); } }, true); }
  // a vault panel (uv 0..1 per panel): white with a soft welded seam round the edge and a little pillow shading
  function vaultTex() { return panel("vault", 256, 256, function (x, W, H) { var g = x.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.72); g.addColorStop(0, "#ffffff"); g.addColorStop(0.75, "#f3f1ec"); g.addColorStop(1, "#dedad2"); x.fillStyle = g; x.fillRect(0, 0, W, H); noise(x, W, H, 2500, 0.02, 1, 2, 47);
      x.strokeStyle = "rgba(150,145,135,0.36)"; x.lineWidth = 2.5; x.strokeRect(1.25, 1.25, W - 2.5, H - 2.5); x.strokeStyle = "rgba(255,255,255,0.6)"; x.lineWidth = 1; x.strokeRect(4.5, 4.5, W - 9, H - 9); }, false); }
  function fabricTex() { return panel("fabric", 256, 256, function (x, W, H) { x.fillStyle = "#c9b79a"; x.fillRect(0, 0, W, H); for (var i = 0; i < W; i += 3) { x.fillStyle = "rgba(0,0,0,0.05)"; x.fillRect(i, 0, 1, H); x.fillRect(0, i, W, 1); } noise(x, W, H, 2500, 0.04, 1, 2, 7); }, true); }
  // a near white woven fabric (cushions, linen, tablecloths take their colour as a tint)
  function fabricTexW() { return panel("fabricW", 256, 256, function (x, W, H) { x.fillStyle = "#f4f1ea"; x.fillRect(0, 0, W, H); for (var i = 0; i < W; i += 3) { x.fillStyle = "rgba(0,0,0,0.035)"; x.fillRect(i, 0, 1, H); x.fillRect(0, i, W, 1); } noise(x, W, H, 2500, 0.03, 1, 2, 9); }, true); }
  function stoneTex() { return panel("stone", 512, 512, function (x, W, H) { var R = rng(31); x.fillStyle = "#8f8478"; x.fillRect(0, 0, W, H); var y = 0; while (y < H) { var h = 40 + Math.floor(R() * 50); var xx = -Math.floor(R() * 90); while (xx < W) { var w = 70 + Math.floor(R() * 150); var k = 0.82 + R() * 0.3; var b = [[188, 160, 128], [170, 142, 112], [204, 178, 146], [156, 130, 102]][Math.floor(R() * 4)]; x.fillStyle = "rgb(" + Math.round(b[0] * k) + "," + Math.round(b[1] * k) + "," + Math.round(b[2] * k) + ")"; x.fillRect(xx + 2, y + 2, w - 4, h - 4); xx += w; } y += h; } noise(x, W, H, 6000, 0.05, 1, 3, 17); }, true); }
  function grainTex(key, base, light, dark, seed, planks) { return panel("grain:" + key, 512, 1024, function (x, W, H) { var R = rng(seed); x.fillStyle = base; x.fillRect(0, 0, W, H); var n = planks || 1, pw = W / n;
      for (var p = 0; p < n; p++) { var k = R(); x.fillStyle = k < 0.5 ? "rgba(255,240,220," + (0.03 + k * 0.08) + ")" : "rgba(30,18,8," + ((k - 0.5) * 0.14) + ")"; x.fillRect(p * pw, 0, pw, H); }
      for (var i = 0; i < 340; i++) { var lt = R() < 0.5; x.strokeStyle = (lt ? light : dark).replace("A", (0.04 + R() * 0.12).toFixed(3)); x.lineWidth = 0.5 + R() * 1.6; x.beginPath(); var px = R() * W, ph = R() * 6; x.moveTo(px, 0); for (var y = 0; y <= H; y += 24) x.lineTo(px + Math.sin(y * 0.008 + ph) * 5 + Math.sin(y * 0.031 + ph * 2) * 1.5, y); x.stroke(); }
      for (var k2 = 0; k2 < 14; k2++) { var kx = R() * W, ky = R() * H; var gk = x.createRadialGradient(kx, ky, 0, kx, ky, 10 + R() * 12); gk.addColorStop(0, dark.replace("A", "0.35")); gk.addColorStop(1, dark.replace("A", "0")); x.fillStyle = gk; x.beginPath(); x.ellipse(kx, ky, 8, 18, 0, 0, TAU); x.fill(); }
      if (n > 1) { for (var q = 0; q < n; q++) { x.fillStyle = "rgba(20,12,6,0.45)"; x.fillRect(q * pw, 0, 2, H); var jy = R() * H; x.fillRect(q * pw, jy, pw, 2); x.fillRect(q * pw, (jy + H * 0.5) % H, pw, 2); } } }, true); }
  // fresh decking (R5): warm ipe and cedar boards, tight grain, staggered end joints and dark gaps (the game's own wood is weathered
  // grey); eight boards across the width of the image, the boards running along v. Its normal map rounds the board edges.
  function deckTex() { return panel("deckW", 512, 1024, function (x, W, H) { var R = rng(91), n = 8, bw = W / n; x.fillStyle = "#2a1d14"; x.fillRect(0, 0, W, H);
      var tones = [[152, 122, 96], [142, 113, 89], [160, 128, 100], [134, 106, 84], [154, 124, 97], [146, 117, 92], [128, 101, 81]];
      for (var b = 0; b < n; b++) { var y0 = -Math.floor(R() * H * 0.7); while (y0 < H) { var L = H * (0.42 + R() * 0.5), tn = tones[Math.floor(R() * tones.length)], k = 0.92 + R() * 0.16;
          x.fillStyle = "rgb(" + Math.round(tn[0] * k) + "," + Math.round(tn[1] * k) + "," + Math.round(tn[2] * k) + ")"; x.fillRect(b * bw + 2, y0 + 2, bw - 4, L - 3);
          var gr = x.createLinearGradient(b * bw, 0, b * bw + bw, 0); gr.addColorStop(0, "rgba(40,18,8,0.18)"); gr.addColorStop(0.15, "rgba(255,220,180,0.06)"); gr.addColorStop(0.85, "rgba(255,220,180,0.04)"); gr.addColorStop(1, "rgba(40,18,8,0.2)"); x.fillStyle = gr; x.fillRect(b * bw + 2, y0 + 2, bw - 4, L - 3);
          for (var i = 0; i < 24; i++) { var lt = R() < 0.45; x.strokeStyle = lt ? "rgba(255,206,160," + (0.05 + R() * 0.09).toFixed(3) + ")" : "rgba(70,30,12," + (0.06 + R() * 0.12).toFixed(3) + ")"; x.lineWidth = 0.6 + R() * 1.5; x.beginPath(); var px = b * bw + 5 + R() * (bw - 10), ph = R() * 6; x.moveTo(px, y0 + 3); for (var y = y0 + 3; y <= y0 + L - 3; y += 18) x.lineTo(px + Math.sin(y * 0.012 + ph) * 2.5, y); x.stroke(); }
          y0 += L; } }
      noise(x, W, H, 5000, 0.025, 1, 2, 93); }, true); }
  function deckNTex() { return panel("deckN", 256, 512, function (x, W, H) { x.fillStyle = "rgb(128,128,255)"; x.fillRect(0, 0, W, H); var bw = W / 8; for (var b = 0; b < 8; b++) { x.fillStyle = "rgb(60,128,215)"; x.fillRect(b * bw, 0, 2, H); x.fillStyle = "rgb(96,128,245)"; x.fillRect(b * bw + 2, 0, 2, H); x.fillStyle = "rgb(196,128,215)"; x.fillRect(b * bw + bw - 2, 0, 2, H); x.fillStyle = "rgb(160,128,245)"; x.fillRect(b * bw + bw - 4, 0, 2, H); } }, true, true); }
  function marbleTex() { return panel("marble", 1024, 1024, function (x, W, H) { var R = rng(5); x.fillStyle = "#efece6"; x.fillRect(0, 0, W, H); for (var v = 0; v < 26; v++) { x.strokeStyle = "rgba(" + (105 + R() * 40 | 0) + "," + (108 + R() * 40 | 0) + "," + (114 + R() * 40 | 0) + "," + (0.1 + R() * 0.3) + ")"; x.lineWidth = 0.6 + R() * 2.2; x.beginPath(); var px = R() * W, py = R() * H; x.moveTo(px, py); for (var s2 = 0; s2 < 14; s2++) { px += (R() - 0.3) * 130; py += (R() - 0.5) * 90; x.lineTo(px, py); } x.stroke(); } noise(x, W, H, 4000, 0.02, 1, 3, 9); }, true); }
  function weaveTex(key, a, b, border) { return panel("weave:" + key, 256, 256, function (x, W, H) { x.fillStyle = a; x.fillRect(0, 0, W, H); for (var i = 0; i < W; i += 4) for (var j = 0; j < H; j += 4) { if (((i + j) / 4) % 2) { x.fillStyle = b; x.fillRect(i, j, 4, 2); } } if (border) { x.strokeStyle = border; x.lineWidth = 10; x.strokeRect(14, 14, W - 28, H - 28); x.lineWidth = 3; x.strokeRect(30, 30, W - 60, H - 60); } noise(x, W, H, 1500, 0.04, 1, 2, 3); }, !border); }
  // a kilim style rug for the living room (one image, not repeated)
  function kilimTex() { return panel("kilim", 512, 512, function (x, W, H) { x.fillStyle = "#b8a184"; x.fillRect(0, 0, W, H); var R = rng(77); x.fillStyle = "#8c5a3c"; x.fillRect(18, 18, W - 36, H - 36); x.fillStyle = "#d9c8ad"; x.fillRect(34, 34, W - 68, H - 68);
      for (var r = 0; r < 5; r++) for (var c = 0; c < 4; c++) { var cx = 90 + c * 110, cy = 70 + r * 92; x.fillStyle = (r + c) % 2 ? "#a46a45" : "#6f7f66"; x.beginPath(); x.moveTo(cx, cy - 30); x.lineTo(cx + 34, cy); x.lineTo(cx, cy + 30); x.lineTo(cx - 34, cy); x.closePath(); x.fill(); x.fillStyle = "#e9dcc5"; x.beginPath(); x.moveTo(cx, cy - 12); x.lineTo(cx + 13, cy); x.lineTo(cx, cy + 12); x.lineTo(cx - 13, cy); x.closePath(); x.fill(); }
      for (var i = 0; i < W; i += 3) { x.fillStyle = "rgba(0,0,0,0.04)"; x.fillRect(i, 0, 1, H); } noise(x, W, H, 3000, 0.05, 1, 2, 79); }, false); }
  // the rug atlas (R5, 2 x 2): 0 the kilim, 1 a Persian medallion, 2 a Moroccan lattice on cream, 3 a striped flatweave; quad q is
  // drawn at column q % 2, row q >> 1 counted from the bottom (the texture's uv origin)
  function rugAtlasTex() { return panel("rugs", 1024, 1024, function (x, W, H) { var Q = 512;
      var at = function (q, fn) { x.save(); x.translate((q % 2) * Q, (1 - (q >> 1)) * Q); x.beginPath(); x.rect(0, 0, Q, Q); x.clip(); fn(); x.restore(); };
      at(0, function () { x.fillStyle = "#b8a184"; x.fillRect(0, 0, Q, Q); x.fillStyle = "#8c5a3c"; x.fillRect(16, 16, Q - 32, Q - 32); x.fillStyle = "#d9c8ad"; x.fillRect(30, 30, Q - 60, Q - 60);
        for (var r = 0; r < 5; r++) for (var c = 0; c < 4; c++) { var cx = 88 + c * 112, cy = 66 + r * 95; x.fillStyle = (r + c) % 2 ? "#a46a45" : "#6f7f66"; x.beginPath(); x.moveTo(cx, cy - 32); x.lineTo(cx + 36, cy); x.lineTo(cx, cy + 32); x.lineTo(cx - 36, cy); x.closePath(); x.fill(); x.fillStyle = "#e9dcc5"; x.beginPath(); x.moveTo(cx, cy - 13); x.lineTo(cx + 14, cy); x.lineTo(cx, cy + 13); x.lineTo(cx - 14, cy); x.closePath(); x.fill(); }
        for (var i = 0; i < Q; i += 3) { x.fillStyle = "rgba(0,0,0,0.04)"; x.fillRect(i, 0, 1, Q); } });
      at(1, function () { x.fillStyle = "#7a2b25"; x.fillRect(0, 0, Q, Q); x.fillStyle = "#1f2a44"; x.fillRect(10, 10, Q - 20, Q - 20); x.fillStyle = "#c9a46a"; x.fillRect(34, 34, Q - 68, Q - 68); x.fillStyle = "#8a2f27"; x.fillRect(44, 44, Q - 88, Q - 88);
        var R = rng(12); for (var i2 = 0; i2 < 70; i2++) { x.fillStyle = ["#1f2a44", "#c9a46a", "#e8dcc4", "#4a6a5a"][i2 % 4]; var px = 50 + R() * (Q - 100), py = 50 + R() * (Q - 100); x.beginPath(); x.arc(px, py, 3 + R() * 5, 0, TAU); x.fill(); }
        [[150, "#1f2a44"], [120, "#e8dcc4"], [96, "#7a2b25"], [70, "#c9a46a"], [44, "#1f2a44"], [20, "#e8dcc4"]].forEach(function (m) { x.fillStyle = m[1]; x.beginPath(); for (var k = 0; k < 16; k++) { var a = k / 16 * TAU, rr = m[0] * (k % 2 ? 0.78 : 1); x.lineTo(Q / 2 + Math.cos(a) * rr, Q / 2 + Math.sin(a) * rr * 1.25); } x.closePath(); x.fill(); });
        [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (q) { x.fillStyle = "#1f2a44"; x.beginPath(); x.arc(44 + q[0] * (Q - 88), 44 + q[1] * (Q - 88), 70, 0, TAU); x.fill(); x.fillStyle = "#c9a46a"; x.beginPath(); x.arc(44 + q[0] * (Q - 88), 44 + q[1] * (Q - 88), 46, 0, TAU); x.fill(); });
        noise(x, Q, Q, 6000, 0.06, 1, 2, 13); });
      at(2, function () { x.fillStyle = "#efe7d8"; x.fillRect(0, 0, Q, Q); x.strokeStyle = "rgba(40,36,34,0.85)"; x.lineWidth = 6; var R2 = rng(21), s2 = 74;
        for (var a2 = -Q; a2 < Q * 2; a2 += s2) { x.beginPath(); for (var y = 0; y <= Q; y += 16) x.lineTo(a2 + y * 0.62 + (R2() - 0.5) * 4, y); x.stroke(); x.beginPath(); for (var y2 = 0; y2 <= Q; y2 += 16) x.lineTo(a2 + Q * 0.62 - y2 * 0.62 + (R2() - 0.5) * 4, y2); x.stroke(); }
        noise(x, Q, Q, 9000, 0.05, 1, 3, 23); x.fillStyle = "rgba(255,255,255,0.18)"; for (var t = 0; t < 900; t++) x.fillRect(R2() * Q, R2() * Q, 2, 2); });
      at(3, function () { x.fillStyle = "#cdb48e"; x.fillRect(0, 0, Q, Q); var bands = [[30, 16, "#3a3430"], [60, 34, "#b4643e"], [104, 10, "#3a3430"], [Q - 114, 10, "#3a3430"], [Q - 94, 34, "#b4643e"], [Q - 46, 16, "#3a3430"]]; bands.forEach(function (b) { x.fillStyle = b[2]; x.fillRect(0, b[0], Q, b[1]); });
        for (var i3 = 0; i3 < Q; i3 += 4) { x.fillStyle = "rgba(0,0,0,0.07)"; x.fillRect(0, i3, Q, 1); } noise(x, Q, Q, 7000, 0.05, 1, 2, 31); });
    }, false); }
  // the chalkboard menu, the stage backdrop and the cluster welcome signs (text from the JSON)
  function signTex(key, l1, l2, l3) { return panel("sign:" + key, 2048, 768, function (x, W, H) { x.clearRect(0, 0, W, H);
      // a small geodesic mark over the name
      x.strokeStyle = "rgba(255,232,196,1)"; x.lineWidth = 6; x.beginPath(); x.arc(W / 2, 200, 100, PI, TAU); x.closePath(); x.stroke(); x.lineWidth = 3; [[-1, 0.62], [1, 0.62], [0, 0.0]].forEach(function () {}); x.beginPath(); x.moveTo(W / 2 - 100, 200); x.lineTo(W / 2 - 50, 113); x.lineTo(W / 2 + 50, 113); x.lineTo(W / 2 + 100, 200); x.moveTo(W / 2 - 50, 113); x.lineTo(W / 2, 200); x.lineTo(W / 2 + 50, 113); x.moveTo(W / 2 - 87, 150); x.lineTo(W / 2 + 87, 150); x.stroke();
      txt(x, l1, W / 2, 330, "400 170px " + FONT.cond, "#fff1d8", 16, "center", W - 120); txt(x, l2 || "", W / 2, 500, "500 66px " + FONT.ui, "#ffd8a0", 18, "center", W - 200); txt(x, l3 || "", W / 2, 630, "600 50px " + FONT.mono, "#f1d7ae", 10, "center", W - 160); }); }
  function chalkTex(key, title, lines) { return panel("chalk:" + key, 1024, 1280, function (x, W, H) { x.fillStyle = "#1d211f"; x.fillRect(0, 0, W, H); noise(x, W, H, 9000, 0.03, 1, 3, 51); x.strokeStyle = "#7a5a3a"; x.lineWidth = 28; x.strokeRect(14, 14, W - 28, H - 28);
      txt(x, title, W / 2, 140, "400 92px " + FONT.cond, "#f3ead8", 6, "center", W - 140); x.fillStyle = "rgba(243,234,216,0.5)"; x.fillRect(W / 2 - 180, 210, 360, 3);
      (lines || []).forEach(function (l, i) { txt(x, l, W / 2, 300 + i * 120, "italic 500 56px " + FONT.serif, i % 2 ? "#f4d7a0" : "#f3ead8", 0, "center", W - 160); }); }); }
  function backdropTex(key, l1, l2) { return panel("bd:" + key, 1024, 512, function (x, W, H) { var g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#2a1d16"); g.addColorStop(1, "#120c09"); x.fillStyle = g; x.fillRect(0, 0, W, H); var R = rng(61); for (var i = 0; i < 220; i++) { x.fillStyle = "rgba(255,214,150," + (0.2 + R() * 0.8) + ")"; x.beginPath(); x.arc(R() * W, R() * H * 0.9, 1 + R() * 2.2, 0, TAU); x.fill(); }
      txt(x, l1, W / 2, H / 2 - 20, "italic 500 96px " + FONT.serif, "#f6e3c2", 2, "center", W - 120); txt(x, l2 || "", W / 2, H / 2 + 80, "600 32px " + FONT.mono, "#d7b98c", 10, "center", W - 160); }); }

  // ───────────────────────── materials (made in the defer hook, when the client's textures exist) ─────────────────────────
  var MX = DM.mx = DM.old ? {} : (DM.mx || {});
  var SHV = DM.old ? "_" + Math.random().toString(36).slice(2, 7) : "";   // a hot reload compiles fresh shader programs
  var U = DM.u = DM.u || { uNight: { value: 0 }, uTime: { value: 0 }, uDim: { value: 1 } }; U.uWarm = U.uWarm || { value: 0 };
  function std(o) { return new THREE.MeshStandardMaterial(o); }
  function tex(name) { try { return TEX[name] || null; } catch (e) { return null; } }
  function mats() {
    if (MX.ok) return MX; MX.ok = true; var wm = tex("wood"), wn = tex("woodN");
    var glowC = hex(C("light.glowColor", "#ffc983"), "#ffc983");
    MX.membrane = std({ map: membraneTex(), color: 0xffffff, roughness: 0.6, metalness: 0.0, envMapIntensity: 0.9, vertexColors: true, emissive: 0xffc890, emissiveIntensity: 0 });
    // the liner (inside of the membrane): cream quilting, and after dark the warm light of the lamps inside, brightest low down
    // and toward the glass (aL = lit amount, R); for a suite whose real interior is built the pooled lamps take over
    MX.liner = std({ map: linerTex(), color: 0xffffff, roughness: 0.9, side: THREE.BackSide, emissive: 0xffa04e, emissiveIntensity: 1 });
    MX.liner.onBeforeCompile = function (sh) {
      sh.uniforms.uNight = U.uNight; sh.uniforms.uDim = U.uDim;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec2 aL;\nvarying vec2 vL;\nvarying vec3 vLp;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvL = aL; vLp = position;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight; uniform float uDim;\nvarying vec2 vL;\nvarying vec3 vLp;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n{ float r = max(vL.y, 1.0); float h = clamp(vLp.y / r, 0.0, 1.0); float front = 0.5 + 0.5 * clamp(vLp.z / r, -1.0, 1.0);\n float g = (1.0 - 0.5 * h) * (0.7 + 0.3 * front); totalEmissiveRadiance *= g * vL.x * uNight * uDim * 1.05; diffuseColor.rgb *= 1.0 - 0.6 * uNight * vL.x; }");
    };
    MX.liner.customProgramCacheKey = function () { return "dm_liner" + SHV; };

    // the base materials every merged part draws with (its own colour is a vertex colour): one draw per base per cluster
    MX.wood = std({ map: deckTex(), normalMap: deckNTex(), normalScale: new THREE.Vector2(0.9, 0.9), color: 0xffffff, roughness: 0.62, vertexColors: true });
    MX.dark = std({ color: 0xffffff, roughness: 0.5, metalness: 0.35, vertexColors: true });
    MX.bright = std({ color: 0xffffff, roughness: 0.26, metalness: 0.9, vertexColors: true });
    MX.paint = std({ color: 0xffffff, roughness: 0.42, metalness: 0.25, vertexColors: true });
    MX.stoneV = std({ map: stoneTex(), color: 0xffffff, roughness: 0.88, vertexColors: true });
    MX.soft = std({ map: fabricTexW(), color: 0xffffff, roughness: 0.95, vertexColors: true });
    MX.cedarB = std({ map: grainTex("cedar", "#9b5b36", "rgba(222,160,110,A)", "rgba(70,30,12,A)", 23, 8), color: 0xffffff, roughness: 0.72, vertexColors: true });
    MX.emit = std({ color: 0x1a1410, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.25, vertexColors: true });
    MX.emit.onBeforeCompile = function (sh) { sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb;\n#endif"); };
    MX.emit.customProgramCacheKey = function () { return "dm_emit" + SHV; };
    // the furnished look of the guest suites: lit warm by its lamps after dark (an emissive share that follows the lamps)
    MX.fpaint = std({ color: 0xffffff, roughness: 0.5, metalness: 0.05, vertexColors: true, emissive: 0xffb877, emissiveIntensity: 0 }); MX.fsoft = std({ map: fabricTexW(), color: 0xffffff, roughness: 0.95, vertexColors: true, emissive: 0xffb877, emissiveIntensity: 0 });
    [MX.fpaint, MX.fsoft].forEach(function (m) { m.onBeforeCompile = function (sh) { sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb;\n#endif"); }; m.customProgramCacheKey = function () { return "dm_fake" + SHV; }; });
    MX.glowV = new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xffffff, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: true });
    MX.floorV = std({ map: grainTex("oak", "#b88d5f", "rgba(236,204,160,A)", "rgba(92,60,30,A)", 29, 6), color: 0xffffff, roughness: 0.42, vertexColors: true });
    MX.strutW = std({ color: 0xe4e1da, roughness: 0.42, metalness: 0.35 });
    MX.strutD = std({ color: 0x26282b, roughness: 0.4, metalness: 0.55 });
    MX.hub = std({ color: 0x9ea2a6, roughness: 0.35, metalness: 0.8 });
    // glass: a thin tinted film whose reflection and opacity rise at grazing angles (Fresnel): you see in face on, the sky at a slant
    MX.glass = std({ color: 0x0c1418, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.7, vertexColors: true });
    MX.glass.onBeforeCompile = function (sh) {
      sh.uniforms.uNight = U.uNight;
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight;")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n{ float fr = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 4.0); diffuseColor.a = clamp(opacity + (0.5 - 0.22 * uNight) * fr, 0.0, 0.62); }");
    };
    MX.glass.customProgramCacheKey = function () { return "dm_glass" + SHV; };
    MX.frost = std({ color: 0xdfe3e2, roughness: 0.3, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, emissive: glowC, emissiveIntensity: 0.0 });
    MX.deck = std({ map: deckTex(), normalMap: deckNTex(), color: 0xffffff, roughness: 0.62 });
    MX.timber = std({ map: deckTex(), normalMap: deckNTex(), color: 0xd8b49c, roughness: 0.66 });
    MX.post = std({ map: deckTex(), color: 0x8a6a54, roughness: 0.8 });
    MX.metal = std({ color: 0x0b0b0c, roughness: 0.55, metalness: 0.2 });
    MX.steel = std({ color: 0xa6abb0, roughness: 0.25, metalness: 0.9 });
    MX.cedar = std({ map: grainTex("cedar", "#9b5b36", "rgba(222,160,110,A)", "rgba(70,30,12,A)", 23, 8), color: 0xffffff, roughness: 0.72 });
    MX.band = std({ color: 0x2c2d30, roughness: 0.35, metalness: 0.75 });
    MX.teak = std({ map: grainTex("teak", "#8a6440", "rgba(230,190,140,A)", "rgba(60,36,16,A)", 37, 1), color: 0xffffff, roughness: 0.6 });
    MX.tubIn = std({ color: 0x3b5560, roughness: 0.35, side: THREE.BackSide }); MX.glassB = std({ color: 0xcfe0e6, roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false });
    MX.coping = std({ map: stoneTex(), color: 0xf6ead8, roughness: 0.85 });
    MX.poolIn = std({ color: 0x2f8aa3, roughness: 0.3, side: THREE.BackSide });
    MX.concrete = std({ map: tex("detail"), color: 0xb9b2a7, roughness: 0.92 });
    MX.corten = std({ color: 0x6b3a1f, roughness: 0.78, metalness: 0.25 });
    MX.beads = std({ color: 0x1a1a1c, roughness: 0.25, metalness: 0.3 });
    MX.cushion = std({ map: fabricTex(), color: 0xe9dfcc, roughness: 0.95 });
    MX.fabric = std({ map: fabricTex(), color: 0xf2e6d0, roughness: 0.95 });
    MX.chrome = std({ color: 0xdadde0, roughness: 0.12, metalness: 1 });
    MX.stone = std({ map: stoneTex(), color: 0xf2dcc0, roughness: 0.9 });
    MX.gravel = std({ map: tex("sand"), color: 0xb1a593, roughness: 1 });
    // the string light bulbs and the path light lenses: warm, brightening after dark
    MX.bulb = std({ color: 0x3a2c18, emissive: hex(C("light.bulbColor", "#ffd59a"), "#ffd59a"), emissiveIntensity: 0.2, roughness: 0.3 });
    MX.wire = std({ color: 0x141414, roughness: 0.7 });
    MX.lens = std({ color: 0x3a2a14, emissive: hex(C("light.bollardColor", "#ffb468"), "#ffb468"), emissiveIntensity: 0.1, roughness: 0.3 });
    MX.lampShade = std({ color: 0xf6ead2, emissive: 0xffcf8a, emissiveIntensity: 0.3, roughness: 0.8 });
    MX.doorGlass = std({ color: 0x1b2328, roughness: 0.05, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 });
    // the furnished interior seen through the glass of every guest suite (instanced, simple): floor, rug, bed, sofa, lamps, curtains
    MX.oak = std({ map: grainTex("oak", "#b88d5f", "rgba(236,204,160,A)", "rgba(92,60,30,A)", 29, 6), color: 0xffffff, roughness: 0.5 });
    MX.walnut = std({ map: grainTex("walnut", "#4b3324", "rgba(150,110,75,A)", "rgba(22,12,6,A)", 17, 1), color: 0xffffff, roughness: 0.45 });
    MX.linen = std({ map: fabricTex(), color: 0xf7f3ea, roughness: 0.92 });
    MX.throw = std({ map: fabricTex(), color: 0x8a6f4e, roughness: 0.95 });
    MX.sofa = std({ map: weaveTex("boucle", "#ebe3d4", "#ddd3c1"), color: 0xffffff, roughness: 0.97 });
    MX.rug = std({ map: kilimTex(), color: 0xffffff, roughness: 1 });
    MX.curtain = std({ map: fabricTex(), color: 0xf3ead9, roughness: 0.95, side: THREE.DoubleSide });
    MX.leaf = std({ color: 0x4f6a3a, roughness: 0.8 }); MX.pot = std({ color: 0x9a6a48, roughness: 0.9 });
    MX.stove = std({ color: 0x141416, roughness: 0.55, metalness: 0.45 });
    MX.ember = std({ color: 0x220a02, emissive: 0xff5a14, emissiveIntensity: 1.6 });
    MX.podWall = std({ map: grainTex("oak2", "#c49a6a", "rgba(240,210,170,A)", "rgba(100,66,34,A)", 59, 4), color: 0xffffff, roughness: 0.55 });
    // additive decals: light pools from the string lights, the path lights, the tub and the fire (opacity follows the night)
    var add = function (col) { return new THREE.MeshBasicMaterial({ map: glowTex(), color: hex(col, col), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: true }); };
    MX.glowAmber = add(C("light.bollardColor", "#ffb468")); MX.glowWarm = add(C("light.glowColor", "#ffc983")); MX.glowBlue = add(C("light.tubColor", "#38c8ff")); MX.glowFire = add("#ff8a3a");
    // the far version: one plain dome per suite, its glass front dark by day and warm after dark (vertex colour alpha marks the glass)
    MX.far = std({ color: 0xffffff, roughness: 0.7, vertexColors: true, emissive: glowC, emissiveIntensity: 1 });
    MX.far.onBeforeCompile = function (sh) { sh.uniforms.uNight = U.uNight; sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight;").replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance *= (1.0 - vColor.g) * 1.6 * uNight;"); };
    MX.far.customProgramCacheKey = function () { return "dm_far" + SHV; };
    waterMat(); fireMat(); MX.steam = new THREE.SpriteMaterial({ map: glowTex(), color: 0xdfe8ee, transparent: true, opacity: 0.0, depthWrite: false });
    // the vaults: panelled white skin, its liner, the white ribs inside
    MX.vskin = std({ map: vaultTex(), color: 0xffffff, roughness: 0.6, envMapIntensity: 0.9, emissive: 0xff9a4a, emissiveMap: vaultTex(), emissiveIntensity: 0 });
    MX.vliner = std({ map: vaultTex(), color: 0xf4f1ea, roughness: 0.9, side: THREE.BackSide, emissive: 0xff9644, emissiveMap: vaultTex(), emissiveIntensity: 0 });
    // after dark (R5): the skin and liner lose most of the moonlight and glow amber from the lamps inside, most on the low walls
    [[MX.vskin, 0.55, "dm_vskin"], [MX.vliner, 0.5, "dm_vliner"]].forEach(function (q) { var m = q[0], k = q[1]; m.onBeforeCompile = function (sh) { sh.uniforms.uNight = U.uNight;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vNy;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvNy = normalize(mat3(modelMatrix) * objectNormal).y;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight; varying float vNy;").replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n diffuseColor.rgb *= 1.0 - " + k.toFixed(2) + " * uNight; totalEmissiveRadiance *= 0.45 + 0.9 * (1.0 - clamp(abs(vNy), 0.0, 1.0));"); }; m.customProgramCacheKey = function () { return q[2] + SHV; }; });
    MX.rib = std({ color: 0xf2f0ea, roughness: 0.4, metalness: 0.3 });
    for (var k in MX) { var m = MX[k]; if (m && m.isMaterial) m.name = "dm_" + k; }
    return MX;
  }
  // hot tub and plunge pool water: a deep blue body lit from below by LEDs, slow caustic ripples (one clock for all)
  function waterMat() {
    MX.water = std({ color: 0x0a4a66, roughness: 0.06, metalness: 0.0, emissive: hex(C("light.tubColor", "#38c8ff"), "#38c8ff"), emissiveIntensity: 1 });
    MX.water.onBeforeCompile = function (sh) {
      sh.uniforms.uTime = U.uTime; sh.uniforms.uNight = U.uNight; sh.uniforms.uDim = U.uDim;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vWp;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvWp = position.xz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uNight; uniform float uDim; varying vec2 vWp;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n{ vec2 p = vWp * 3.1; float t = uTime * 0.9; float c = sin(p.x * 2.3 + t) * sin(p.y * 2.1 - t * 0.8) + sin((p.x + p.y) * 3.7 + t * 1.3) * 0.5 + sin(length(p) * 4.0 - t * 1.6) * 0.35;\n float caus = pow(clamp(0.5 + 0.5 * c, 0.0, 1.0), 3.0);\n totalEmissiveRadiance *= (0.22 + 0.78 * uNight * uDim) * (0.75 + 0.9 * caus); }")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n{ float t = uTime; vec2 p = vWp * 4.0; normal = normalize(normal + vec3(sin(p.x * 3.0 + t * 1.7) * 0.05, cos(p.y * 3.3 - t * 1.4) * 0.05, 0.0)); }");
    };
    MX.water.customProgramCacheKey = function () { return "dm_water" + SHV; };
  }
  // flames: crossed cards with an animated noise flame (additive, no light of their own; pooled lights do the lighting)
  function fireMat() {
    MX.fire = new THREE.ShaderMaterial({ uniforms: { uTime: U.uTime, uAmp: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: "varying vec2 vUv; varying float vSeed; attribute float aSeed; void main(){ vUv = uv; vSeed = aSeed;\n #ifdef USE_INSTANCING\n vSeed = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.71;\n gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);\n #else\n vSeed += modelMatrix[3][0] * 0.37;\n gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n #endif\n }",
      fragmentShader: "uniform float uTime; uniform float uAmp; varying vec2 vUv; varying float vSeed;\n float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }\n float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }\n void main(){ vec2 uv = vUv; float t = uTime * 1.6 + vSeed * 10.0; float y = uv.y; float x = (uv.x - 0.5) * 2.0;\n float q = n(vec2(uv.x * 5.0, uv.y * 3.0 - t * 2.2)) * 0.6 + n(vec2(uv.x * 11.0, uv.y * 6.0 - t * 3.5)) * 0.4;\n float w = (1.0 - y) * 0.95 + 0.05; float shape = smoothstep(w, w * 0.25, abs(x + (q - 0.5) * 0.55 * y)) * smoothstep(1.0, 0.25, y + q * 0.45) * smoothstep(0.0, 0.08, y);\n vec3 col = mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.86, 0.48), smoothstep(0.55, 0.0, y) * smoothstep(0.7, 0.0, abs(x)));\n float a = shape * uAmp; if (a < 0.01) discard; gl_FragColor = vec4(col * a * 1.6, a); }" });
    MX.fire.name = "dm_fire";
  }
  // the model interiors: the stargaze module's palette plus a one-texel ao map (the indoor share of the sky, halved after dark)
  var IN = DM.in = DM.old ? { active: null, sb: null } : (DM.in || { active: null, sb: null });
  function intMats() { if (IN.mt) return IN.mt; var Mt = IN.mt = Object.create(mats());
    Mt.leather = std({ color: 0x6b4128, roughness: 0.6 }); Mt.marble = std({ map: marbleTex(), color: 0xffffff, roughness: 0.22 }); Mt.basalt = std({ color: 0x2a2a2c, roughness: 0.55 });
    Mt.frostPane = std({ color: 0xc8d0ce, roughness: 0.35, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }); Mt.inox = std({ color: 0xb9bcbf, roughness: 0.3, metalness: 0.9 });
    Mt.lamp = std({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 1.2 }); Mt.ledStrip = std({ color: 0x2a2015, emissive: 0xffc27a, emissiveIntensity: 1.4 });
    Mt.brass = std({ color: 0xb8913c, roughness: 0.32, metalness: 0.85 });
    Mt.tile = std({ map: weaveTex("tile", "#e8e4dc", "#dcd6cb"), color: 0xffffff, roughness: 0.4 }); Mt.ceramic = std({ color: 0xf4f4f2, roughness: 0.2 });
    Mt.white = std({ color: 0xf2f2ee, roughness: 0.55 }); Mt.black = std({ color: 0x0c0c0d, roughness: 0.62, metalness: 0.2 });
    Mt.cloth = std({ map: fabricTex(), color: 0xfbf8f2, roughness: 0.9 }); Mt.parquet = std({ map: grainTex("parquet", "#a77d52", "rgba(236,204,160,A)", "rgba(70,44,20,A)", 71, 8), color: 0xffffff, roughness: 0.35 });
    Mt.bamboo = std({ map: grainTex("bamboo", "#d4b483", "rgba(250,232,200,A)", "rgba(120,90,50,A)", 83, 10), color: 0xffffff, roughness: 0.5 });
    Mt.mat = std({ color: 0x7d8c6f, roughness: 0.95 }); Mt.mat2 = std({ color: 0xb7856a, roughness: 0.95 }); Mt.green = std({ color: 0x5f7a4a, roughness: 0.85 });
    Mt.bottle = std({ color: 0x3a5a3a, roughness: 0.1, metalness: 0.1, emissive: 0x6a4a1a, emissiveIntensity: 0.25 }); Mt.amber = std({ color: 0x7a4a14, roughness: 0.1, emissive: 0x7a4010, emissiveIntensity: 0.35 });
    Mt.chairW = std({ color: 0xf5f2ec, roughness: 0.5 }); Mt.gold = std({ color: 0xc9a24e, roughness: 0.35, metalness: 0.9 }); Mt.flower = std({ color: 0xf3e9e0, roughness: 0.8 }); Mt.rose = std({ color: 0xd7a1a0, roughness: 0.8 });
    Mt.speaker = std({ color: 0x18181a, roughness: 0.7 }); Mt.towel = std({ color: 0xf2efe8, roughness: 1 });
    IN.ao = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1); IN.ao.needsUpdate = true; IN.aoV = 200;
    ["oak", "walnut", "linen", "throw", "sofa", "leather", "marble", "basalt", "rug", "leaf", "pot", "inox", "podWall", "tile", "white", "cloth", "parquet", "bamboo", "mat", "mat2", "teak", "chairW", "curtain", "stove", "green", "towel"].forEach(function (k) { if (Mt[k]) { Mt[k] = Mt[k].clone(); Mt[k].aoMap = IN.ao; Mt[k].aoMapIntensity = 1; Mt[k].name = "dm_in_" + k; } });
    for (var k in Mt) { var m = Mt[k]; if (m && m.isMaterial && !m.name) m.name = "dm_" + k; } return Mt; }
  // the interiors draw with a few textured bases too (oak grain, linen, boucle, the kilim, marble, leather, metals, paint, glass, light)
  function intBases() { var Mt = intMats(); if (IN.bases) return IN.bases; var ao = IN.ao; var B = IN.bases = {};
    var warm = function (sh) { sh.uniforms.uWarm = U.uWarm; sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uWarm;").replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.6, 0.28) * uWarm;"); };
    var mk = function (o, useAo) { var m = std(Object.assign({ vertexColors: true, color: 0xffffff }, o)); if (useAo && ao) { m.aoMap = ao; m.aoMapIntensity = 1; } if (!o.transparent) { m.onBeforeCompile = warm; m.customProgramCacheKey = function () { return "dm_iwarm" + SHV; }; } return m; };
    B.iwood = mk({ map: grainTex("oak", "#b88d5f", "rgba(236,204,160,A)", "rgba(92,60,30,A)", 29, 6), roughness: 0.5 }, true);
    B.iwalnut = mk({ map: grainTex("walnut", "#4b3324", "rgba(150,110,75,A)", "rgba(22,12,6,A)", 17, 1), roughness: 0.45 }, true);
    B.ifabric = mk({ map: fabricTexW(), roughness: 0.93 }, true); B.isofa = mk({ map: weaveTex("boucle", "#ebe3d4", "#ddd3c1"), roughness: 0.97 }, true); B.irug = mk({ map: rugAtlasTex(), roughness: 1 }, true);
    B.imarble = mk({ map: marbleTex(), roughness: 0.22 }, true); B.ileather = mk({ roughness: 0.58 }, true); B.idark = mk({ roughness: 0.55, metalness: 0.3 }, true); B.ibright = mk({ roughness: 0.3, metalness: 0.62 }, false);
    B.ipaint = mk({ roughness: 0.4, metalness: 0.05 }, true); B.isoft = mk({ roughness: 0.82 }, true); B.ifrost = mk({ roughness: 0.32, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }, false); B.iglass = mk({ roughness: 0.05, transparent: true, opacity: 0.38, depthWrite: false }, false);
    B.iemit = std({ color: 0x1a1410, emissive: 0xffffff, emissiveIntensity: 1.2, vertexColors: true }); B.iemit.onBeforeCompile = MX.emit.onBeforeCompile; B.iemit.customProgramCacheKey = function () { return "dm_iemit" + SHV; };
    B.icurtain = mk({ map: fabricTexW(), roughness: 0.95, side: THREE.DoubleSide }, true); B.chrome = Mt.chrome; B.fire = MX.fire;
    B.ibottle = std({ color: 0xffffff, roughness: 0.1, metalness: 0.05, vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.32 }); B.ibottle.onBeforeCompile = MX.emit.onBeforeCompile; B.ibottle.customProgramCacheKey = function () { return "dm_ibottle" + SHV; };
    B.iglow = new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
    IN.fairy = std({ color: 0x3a2c18, emissive: 0xffa449, emissiveIntensity: 1.5, roughness: 0.3 }); IN.fairy.name = "dm_fairy";
    for (var k in B) { var m = B[k]; if (m && m.isMaterial && !m.name) m.name = "dm_" + k; } return B; }
  function aoFrame(n) { if (!IN.ao) return; var v = Math.round(255 * lerp(0.8, 0.3, n)); if (Math.abs(v - IN.aoV) < 4) return; IN.aoV = v; IN.ao.image.data[0] = IN.ao.image.data[1] = IN.ao.image.data[2] = v; IN.ao.needsUpdate = true; }

  // ───────────────────────── the Dome Suite shell, built once per size (suite frame: dome centre on the deck top, +z the door) ─────────────────────────
  // A 4V geodesic hemisphere (an icosahedron with a vertex up, each face split in sixteen, cut flat at the equator). The faces
  // facing the front (within GLASS_AZ of +z, below GLASS_EL) are glass, the cap (above SKY_EL) is the stargazing skylight, the
  // rest white membrane over a cream liner. A framed door portal is cut exactly out of the front faces: glass cheeks, a white
  // canopy and a glass door in a dark frame. Struts on every edge (white on the membrane, anthracite on the glass), steel hubs.
  var DOOR = { hw: 0.6, top: 2.3 };
  var GLASS_AZ = 60 * PI / 180, GLASS_EL = 47 * PI / 180, SKY_EL = 66 * PI / 180, FLUE_AZ = -84 * PI / 180;
  var SHELL = DM.shell = DM.old ? {} : (DM.shell || {});
  function icoHemi(R) {
    var ico = new THREE.IcosahedronGeometry(1, 3); var phi = (1 + Math.sqrt(5)) / 2; ico.rotateZ(Math.atan(1 / phi)); ico.rotateY(PI / 2);
    var pa = ico.attributes.position, tris = [];
    for (var i = 0; i < pa.count; i += 3) { var t = []; var ok = true; for (var k = 0; k < 3; k++) { var y = pa.getY(i + k); if (y < -1e-4) { ok = false; break; } t.push(new THREE.Vector3(pa.getX(i + k), Math.max(0, y), pa.getZ(i + k)).multiplyScalar(R)); } if (ok) tris.push(t); }
    ico.dispose(); return tris;
  }
  // keep the side of a convex polygon where n·p + d >= 0 (Sutherland-Hodgman)
  function clipPoly(poly, nx, ny, nz, d) { var out = []; for (var i = 0; i < poly.length; i++) { var a = poly[i], b = poly[(i + 1) % poly.length]; var da = nx * a.x + ny * a.y + nz * a.z + d, db = nx * b.x + ny * b.y + nz * b.z + d; if (da >= 0) out.push(a); if ((da >= 0) !== (db >= 0)) out.push(a.clone().lerp(b, da / (da - db))); } return out; }
  function polyArea(p) { if (p.length < 3) return 0; var s = 0; for (var i = 1; i < p.length - 1; i++) s += new THREE.Vector3().subVectors(p[i], p[0]).cross(new THREE.Vector3().subVectors(p[i + 1], p[0])).length() / 2; return s; }
  function fan(p) { var out = []; for (var i = 1; i < p.length - 1; i++) out.push([p[0], p[i], p[i + 1]]); return out; }
  // the triangle minus the portal box {|x| < hw, y < top} (front faces only), as triangles
  function cutPortal(t, hw, top) {
    var inside = clipPoly(clipPoly(clipPoly(t, 1, 0, 0, hw), -1, 0, 0, hw), 0, -1, 0, top); if (polyArea(inside) < 1e-4) return null;
    var out = []; [clipPoly(t, -1, 0, 0, -hw), clipPoly(t, 1, 0, 0, -hw), clipPoly(clipPoly(clipPoly(t, 1, 0, 0, hw), -1, 0, 0, hw), 0, 1, 0, -top)].forEach(function (p) { if (polyArea(p) > 1e-5) out = out.concat(fan(p)); }); return { tris: out, inside: inside };
  }
  // where a plane (n·p + d = 0) crosses a triangle: a segment or null
  function planeSeg(t, nx, ny, nz, d) { var pts = []; for (var i = 0; i < 3; i++) { var a = t[i], b = t[(i + 1) % 3]; var da = nx * a.x + ny * a.y + nz * a.z + d, db = nx * b.x + ny * b.y + nz * b.z + d; if ((da > 0) !== (db > 0) && Math.abs(da - db) > 1e-9) pts.push(a.clone().lerp(b, da / (da - db))); } return pts.length === 2 ? pts : null; }
  function buildShell(key, R) {
    if (SHELL[key]) return SHELL[key];
    var tris = icoHemi(R), K = new Kit(), FK = new Kit(); var hw = DOOR.hw, top = DOOR.top;
    var info = { R: R, key: key, glassTris: 0, faces: 0 };
    // classify faces
    var faces = tris.map(function (t) { var c = new THREE.Vector3().add(t[0]).add(t[1]).add(t[2]).multiplyScalar(1 / 3); var n = c.clone().normalize(); var az = Math.atan2(n.x, n.z), el = Math.asin(clamp(n.y, -1, 1)); var kind = el > SKY_EL ? "sky" : (Math.abs(az) < GLASS_AZ && el < GLASS_EL) ? "glass" : "mem"; return { t: t, c: c, n: new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0])).normalize(), kind: kind }; });
    faces.forEach(function (f) { if (f.n.dot(f.c) < 0) { f.t = [f.t[0], f.t[2], f.t[1]]; f.n.negate(); } });
    // the door plane: just in front of the faces inside the portal box
    var zd = 0; faces.forEach(function (f) { if (f.c.z <= 0) return; var cp = cutPortal(f.t, hw, top); if (cp) { f.cut = cp; cp.inside.forEach(function (p) { zd = Math.max(zd, p.z); }); } }); zd += 0.05; info.zd = zd;
    // faces: glass panes, the skylight, pillowed membrane panels and the liner
    var glassT = [], memT = [], linT = [];
    faces.forEach(function (f) {
      var list = f.cut ? f.cut.tris : [f.t];
      if (f.kind !== "mem") { list.forEach(function (t) { glassT.push(t.map(function (v) { return v.clone().addScaledVector(f.n, 0.004); })); }); info.glassTris += list.length; return; }
      list.forEach(function (t) { linT.push(t.map(function (v) { return v.clone().addScaledVector(f.n, -0.05); })); });
      if (f.cut) { list.forEach(function (t) { memT.push(t); }); return; }
      // a soft pillow: the panel bulges a little between the struts (six triangles round a raised centre)
      var a = f.t[0], b = f.t[1], c = f.t[2], e = a.distanceTo(b); var lift = e * 0.022, mid = e * 0.011;
      var mab = a.clone().add(b).multiplyScalar(0.5).addScaledVector(f.n, mid), mbc = b.clone().add(c).multiplyScalar(0.5).addScaledVector(f.n, mid), mca = c.clone().add(a).multiplyScalar(0.5).addScaledVector(f.n, mid), ce = f.c.clone().addScaledVector(f.n, lift);
      memT.push([a, mab, ce], [mab, b, ce], [b, mbc, ce], [mbc, c, ce], [c, mca, ce], [mca, a, ce]);
    });
    // membrane normals: the panel's own normal blended toward the sphere's (soft, faintly faceted)
    var memN = function (v, n) { return n.clone().multiplyScalar(0.55).add(v.clone().normalize().multiplyScalar(0.45)).normalize(); };
    K.tris("membrane", memT, 1.6, memN); K.tris("liner", linT, 1.1, function (v) { return v.clone().normalize(); }); K.tris("glass", glassT, 2);
    // struts on every edge (clipped by the portal), hubs at the vertices
    var edges = {}, verts = {}; var vk = function (v) { return Math.round(v.x * 200) + ":" + Math.round(v.y * 200) + ":" + Math.round(v.z * 200); };
    faces.forEach(function (f) { for (var i = 0; i < 3; i++) { var a = f.t[i], b = f.t[(i + 1) % 3]; var ka = vk(a), kb = vk(b); verts[ka] = a; verts[kb] = b; var ek = ka < kb ? ka + "|" + kb : kb + "|" + ka; var E = edges[ek] || (edges[ek] = { a: a, b: b, dark: false }); if (f.kind !== "mem") E.dark = true; } });
    var nStrut = 0;
    Object.keys(edges).forEach(function (ek) { var E = edges[ek], a = E.a, b = E.b; var segs = [[0, 1]];
      if ((a.z + b.z) / 2 > 0.3 * R) { var d = new THREE.Vector3().subVectors(b, a); var t0 = 0, t1 = 1; var lo = -1e9, hi = 1e9;
        if (Math.abs(d.x) > 1e-9) { var ta = (-hw - a.x) / d.x, tb = (hw - a.x) / d.x; lo = Math.max(lo, Math.min(ta, tb)); hi = Math.min(hi, Math.max(ta, tb)); } else if (Math.abs(a.x) >= hw) { lo = 1; hi = 0; }
        if (Math.abs(d.y) > 1e-9) { var ty = (top - a.y) / d.y; if (d.y > 0) hi = Math.min(hi, ty); else lo = Math.max(lo, ty); } else if (a.y >= top) { lo = 1; hi = 0; }
        lo = Math.max(lo, t0); hi = Math.min(hi, t1); if (hi - lo > 1e-4) { segs = []; if (lo > 0.002) segs.push([0, lo]); if (hi < 0.998) segs.push([hi, 1]); } }
      segs.forEach(function (s) { var A = a.clone().lerp(b, s[0]), B = a.clone().lerp(b, s[1]); var mid = A.clone().add(B).multiplyScalar(0.5).normalize(); var off = E.dark ? 0.012 : 0.004; A.addScaledVector(mid, off); B.addScaledVector(mid, off); if (E.dark) K.beam("strutD", A, B, 0.055, 0.075, mid); else K.beam("strutW", A, B, 0.04, 0.05, mid); nStrut++; }); });
    Object.keys(verts).forEach(function (k) { var v = verts[k]; if (v.y < 0.01) return; var n = v.clone().normalize(); if (v.z > 0 && Math.abs(v.x) < hw + 0.05 && v.y < top + 0.05) return; var g = new THREE.CylinderGeometry(0.075, 0.075, 0.05, 8); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)); g.translate(v.x + n.x * 0.04, v.y + n.y * 0.04, v.z + n.z * 0.04); K.add("hub", g); });
    // the base ring along the equator
    for (var i = 0; i < 40; i++) { var a0 = i / 40 * TAU, a1 = (i + 1) / 40 * TAU; var p0 = V3(Math.sin(a0) * (R + 0.02), 0.07, Math.cos(a0) * (R + 0.02)), p1 = V3(Math.sin(a1) * (R + 0.02), 0.07, Math.cos(a1) * (R + 0.02)); var mz = (p0.z + p1.z) / 2, mx = (p0.x + p1.x) / 2; if (mz > 0 && Math.abs(mx) < hw + 0.1) continue; K.beam("strutW", p0, p1, 0.14, 0.06, V3(mx, 0, mz).normalize()); }
    // the door portal: glass cheeks from the door plane back to the dome, a white canopy over it, a dark frame all round
    var cheekT = [], roofT = [], roofU = [], frame = [];
    faces.forEach(function (f) { if (f.c.z <= 0) return; [-hw, hw].forEach(function (c) { var s = planeSeg(f.t, 1, 0, 0, -c); if (!s) return; var p = s[0], q = s[1]; if (p.y > q.y) { var tq = p; p = q; q = tq; } if (p.y >= top) return; if (q.y > top) q = p.clone().lerp(q, (top - p.y) / (q.y - p.y)); if (q.y - p.y < 1e-4) return; var P2 = V3(c, p.y, zd), Q2 = V3(c, q.y, zd); cheekT.push([p, q, Q2], [p, Q2, P2]); frame.push([p, q]); });
      var s2 = planeSeg(f.t, 0, 1, 0, -top); if (s2) { var p2 = s2[0], q2 = s2[1]; if (p2.x > q2.x) { var tt = p2; p2 = q2; q2 = tt; } if (q2.x <= -hw || p2.x >= hw) return; if (p2.x < -hw) p2 = p2.clone().lerp(q2, (-hw - p2.x) / (q2.x - p2.x)); if (q2.x > hw) q2 = p2.clone().lerp(q2, (hw - p2.x) / (q2.x - p2.x)); var P3 = V3(p2.x, top, zd), Q3 = V3(q2.x, top, zd); roofT.push([p2, Q3, q2], [p2, P3, Q3]); roofU.push([p2, q2, Q3], [p2, Q3, P3]); frame.push([p2, q2]); } });
    K.tris("glass", cheekT, 2); K.tris("membrane", roofT.map(function (t) { return t.map(function (v) { return v.clone().add(V3(0, 0.03, 0)); }); }), 1.6); K.tris("strutW", roofU, 1);
    frame.forEach(function (s) { K.beam("strutD", s[0], s[1], 0.05, 0.05, V3(0, 0, 1)); });
    K.box("strutD", 0.07, top, 0.08, -hw, top / 2, zd, 0); K.box("strutD", 0.07, top, 0.08, hw, top / 2, zd, 0); K.box("strutD", 2 * hw + 0.07, 0.08, 0.08, 0, top, zd, 0);
    K.box("membrane", 2 * hw + 0.2, 0.06, zd - Math.sqrt(Math.max(0, R * R - top * top)) + 0.32, 0, top + 0.06, (zd + Math.sqrt(Math.max(0, R * R - top * top))) / 2 + 0.1, 0);
    K.box("strutD", 2 * hw + 0.07, 0.03, 0.12, 0, 0.015, zd, 0);
    // the wood stove's flue: through the dome on the left, a flashing collar and a rain cap
    var fr = R - 1.05, fx = Math.sin(FLUE_AZ) * fr, fz = Math.cos(FLUE_AZ) * fr, fy = Math.sqrt(R * R - fr * fr) - 0.04; info.flue = [fx, fz, fy];
    K.cyl("metal", 0.075, 0.075, fy + 0.95 - 1.05, fx, 1.05 + (fy + 0.95 - 1.05) / 2, fz, 14); var col = new THREE.CylinderGeometry(0.09, 0.2, 0.12, 14, 1, true); col.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), V3(fx, fy, fz).normalize())); col.translate(fx, fy + 0.02, fz); K.add("hub", col);
    K.cyl("chrome", 0.16, 0.16, 0.02, fx, fy + 1.02, fz, 14); K.cyl("chrome", 0.0, 0.17, 0.08, fx, fy + 1.08, fz, 14); K.cyl("metal", 0.08, 0.08, 0.06, fx, fy + 0.97, fz, 12);
    info.geos = K.geos(); info.K = K; info.tris = Math.round(K.count()); info.struts = nStrut;
    // the door leaf, hinged at x = 0, toward +x, closed in the plane z = 0 (glass in a slim dark frame, a long pull)
    var LK = new Kit(), W = 2 * hw - 0.08, Hh = top - 0.06; LK.box("doorGlass", W - 0.08, Hh - 0.08, 0.02, W / 2, Hh / 2 + 0.02, 0, 0); LK.box("strutD", 0.05, Hh, 0.05, 0.025, Hh / 2 + 0.02, 0); LK.box("strutD", 0.05, Hh, 0.05, W - 0.025, Hh / 2 + 0.02, 0); LK.box("strutD", W, 0.06, 0.05, W / 2, 0.05, 0); LK.box("strutD", W, 0.05, 0.05, W / 2, Hh, 0);
    LK.box("chrome", 0.03, 0.7, 0.03, W - 0.13, 1.05, 0.05); LK.box("chrome", 0.03, 0.7, 0.03, W - 0.13, 1.05, -0.05); info.leaf = LK.geos(); info.LK = LK; info.leafW = W; info.hinge = [-hw + 0.04, zd - 0.01];
    // the far version: an icosphere hemisphere at 2V, glass front darker (vertex colour), plus a deck slab
    var far = new THREE.IcosahedronGeometry(R, 1); far.rotateZ(Math.atan(1 / phi())); far.rotateY(PI / 2); var fp = far.attributes.position, FP = [], FC = [];
    for (var j = 0; j < fp.count; j += 3) { var ys = [fp.getY(j), fp.getY(j + 1), fp.getY(j + 2)]; if (Math.min.apply(null, ys) < -1e-3) continue; var cx = (fp.getX(j) + fp.getX(j + 1) + fp.getX(j + 2)) / 3, cz = (fp.getZ(j) + fp.getZ(j + 1) + fp.getZ(j + 2)) / 3, cy = (ys[0] + ys[1] + ys[2]) / 3; var gl = Math.abs(Math.atan2(cx, cz)) < GLASS_AZ + 0.1 && cy < R * 0.72;
      for (var q = 0; q < 3; q++) { FP.push(fp.getX(j + q), Math.max(0, fp.getY(j + q)), fp.getZ(j + q)); FC.push(gl ? 0.16 : 0.96, gl ? 0.2 : 0.95, gl ? 0.24 : 0.92); } }
    var fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.Float32BufferAttribute(FP, 3)); fg.setAttribute("color", new THREE.Float32BufferAttribute(FC, 3)); fg.computeVertexNormals(); info.far = fg; far.dispose();
    return (SHELL[key] = info);
  }
  function phi() { return (1 + Math.sqrt(5)) / 2; }

  // ───────────────────────── the suite's floor plan (shared by the furnished look of every suite and the walk-in model) ─────────────────────────
  // Checked in 2D for every size (scratchpad dome/layout.py): nothing overlaps, everything stands under the curve of the dome at
  // its own height, the way in from the door is clear. Bathroom pod back-left (a sleeping loft on it in L), bed back-right, wood
  // stove on the left wall, kitchenette on the right wall, living in front of the pod facing the glass, dining front-right.
  function polar(az, r) { var a = az * PI / 180; return [Math.sin(a) * r, Math.cos(a) * r]; }
  var PLANS = DM.plans = {};
  function suitePlan(size, R) {
    var key = size + R; if (PLANS[key]) return PLANS[key]; var P = { size: size, R: R };
    var pd = { S: [1.75, 1.35, 2.12], M: [2.1, 1.6, 2.15], L: [2.4, 1.8, 2.3] }[size] || [2.1, 1.6, 2.15];
    var azp = -138, rmax = Math.sqrt(R * R - pd[2] * pd[2]) - 0.12, rc = Math.sqrt(rmax * rmax - pd[0] * pd[0] / 4) - pd[1] / 2, pp = polar(azp, rc);
    P.pod = { x: pp[0], z: pp[1], w: pd[0], d: pd[1], h: pd[2], yaw: (azp + 180) * PI / 180 };
    var azb = 132, bw = 1.95, bl = 2.15, rb = R - 0.35 - bl / 2, tx = Math.cos(azb * PI / 180), tz = -Math.sin(azb * PI / 180), lim = Math.sqrt(R * R - 1.21) - 0.08;
    for (var it = 0; it < 40; it++) { var hh = polar(azb, rb + bl / 2); if (Math.hypot(hh[0] + tx * bw / 2, hh[1] + tz * bw / 2) <= lim) break; rb -= 0.03; }
    var bp = polar(azb, rb); P.bed = { x: bp[0], z: bp[1], w: bw, l: bl, yaw: (azb + 180) * PI / 180, tx: tx, tz: tz, rb: rb, az: azb };
    var sp = polar(-84, R - 1.05); P.stove = { x: sp[0], z: sp[1], yaw: 96 * PI / 180 };
    var kl = { S: 1.6, M: 1.9, L: 2.2 }[size] || 1.9, kp = polar(86, R - 0.72); P.kitchen = { x: kp[0], z: kp[1], l: kl, yaw: (86 + 180) * PI / 180 };
    var sfl = { S: 2.0, M: 2.2, L: 2.4 }[size] || 2.2, lx = -0.22 * R + ({ S: 0.28, M: 0.12, L: 0.05 }[size] || 0.1), sz0 = -0.12 * R + 0.36;
    P.sofa = { x: lx, z: sz0, l: sfl, yaw: 0 }; P.table = { x: lx, z: sz0 + 1.12 }; P.rug = { x: lx, z: sz0 + 0.95, w: sfl + 1.0, d: 2.6 };
    P.arms = []; if (size !== "M") P.arms.push({ x: lx - sfl / 2 - 0.12, z: sz0 + 1.55, yaw: 120 * PI / 180 }); if (size !== "S") P.arms.push({ x: lx + sfl / 2 + 0.1, z: sz0 + 1.75, yaw: -140 * PI / 180 });
    P.dining = { x: 0.42 * R + 0.2, z: 0.22 * R + 0.12, chairs: size === "S" ? [0, 180, 270] : [0, 90, 180, 270] };
    if (size === "M") { var dp = polar(-36, R - 0.98); P.daybed = { x: dp[0], z: dp[1], yaw: (-36 + 180) * PI / 180 }; }
    if (size === "L") P.loft = { h: 2.3 };
    P.plants = [[64, R - 1.0], [-67, R - 0.95], [180, R - 0.72]].map(function (q) { var p = polar(q[0], q[1]); return { x: p[0], z: p[1] }; });
    P.lamp = (function () { var p = polar(-112, R - 0.9); return { x: p[0], z: p[1] }; })();
    // the curtains: gathered at both edges of the glass front, on a rail at the glass line
    P.curtains = [-1, 1].map(function (sd) { var p = polar(sd * 57, R - 0.7); return { x: p[0], z: p[1], yaw: sd * 57 * PI / 180, h: Math.min(2.45, Math.sqrt(R * R - (R - 0.7) * (R - 0.7)) - 0.1) }; });
    return (PLANS[key] = P);
  }
  // a point in the pod's frame (lx across, lz toward its door) to the suite frame
  function podW(P, lx, lz) { var c = Math.cos(P.pod.yaw), s = Math.sin(P.pod.yaw); return [P.pod.x + lx * c + lz * s, P.pod.z - lx * s + lz * c]; }
  function bedW(P, lx, lz) { var c = Math.cos(P.bed.yaw), s = Math.sin(P.bed.yaw); return [P.bed.x + lx * c + lz * s, P.bed.z - lx * s + lz * c]; }

  // ───────────────────────── the deck of every suite (per size and pool), the shared outdoor pieces ─────────────────────────
  function deckDims(size, R, pool) { var D = C("deck", {}); var sL = pool ? (D.poolSide || 3.6) : (D.side || 1.3); return { xL: -R - sL, xR: R + (D.diningSide || 2.9), zB: -R - (D.back || 1.0), zF: R + (D.front || 4.4), dH: D.height || 0.6, R: R, pool: pool,
      pool0: pool ? [-R - sL + 0.45, -R - 0.55, -1.9, 1.7] : null, tub: [R + (D.diningSide || 2.9) - 1.3, R + (D.front || 4.4) - 1.3], fire: [-R * 0.55 - 0.1, R + (D.front || 4.4) - 1.75], dine: [R + (D.diningSide || 2.9) / 2 + 0.05, -0.15] }; }
  var DECK = DM.deck = DM.old ? {} : (DM.deck || {});
  function deckKit(key, size, R, pool) {
    if (DECK[key]) return DECK[key]; var d = deckDims(size, R, pool), K = new Kit(); var xL = d.xL, xR = d.xR, zB = d.zB, zF = d.zF, dH = d.dH, W = xR - xL, Dd = zF - zB, xc = (xL + xR) / 2, zc = (zB + zF) / 2;
    // boards (around the pool when there is one), fascia, bearers and posts down to the graded pad
    var rects = [[xL, xR, zB, zF]]; if (d.pool0) { var p = d.pool0, cp = 0.26; rects = [[xL, xR, zB, p[2] - cp], [xL, xR, p[3] + cp, zF], [xL, p[0] - cp, p[2] - cp, p[3] + cp], [p[1] + cp, xR, p[2] - cp, p[3] + cp]]; }
    rects.forEach(function (r) { if (r[1] - r[0] < 0.02 || r[3] - r[2] < 0.02) return; K.box("deck", r[1] - r[0], 0.05, r[3] - r[2], (r[0] + r[1]) / 2, -0.025, (r[2] + r[3]) / 2, 0, 1.6); });
    K.box("timber", W + 0.04, 0.3, 0.05, xc, -0.2, zB - 0.02, 0, 1); K.box("timber", W + 0.04, 0.3, 0.05, xc, -0.2, zF + 0.02, 0, 1); K.box("timber", 0.05, 0.3, Dd, xL - 0.02, -0.2, zc, 0, 1); K.box("timber", 0.05, 0.3, Dd, xR + 0.02, -0.2, zc, 0, 1);
    var nx = Math.ceil(W / 2.3), nz = Math.ceil(Dd / 2.3), ph = dH; for (var j = 0; j <= nz; j++) { var z = zB + 0.15 + (Dd - 0.3) * j / nz; K.box("post", W - 0.2, 0.2, 0.12, xc, -0.45, z, 0, 1); for (var i = 0; i <= nx; i++) { var x = xL + 0.15 + (W - 0.3) * i / nx; K.box("post", 0.14, ph, 0.14, x, -0.35 - ph / 2, z, 0, 1); } }
    // the plunge pool: stone coping flush with the boards, tiled walls, a chrome ladder; the water is its own mesh
    if (d.pool0) { var q = d.pool0, pw = q[1] - q[0], pz = q[3] - q[2], qx = (q[0] + q[1]) / 2, qz = (q[2] + q[3]) / 2, c2 = 0.26;
      K.box("coping", pw + 2 * c2, 0.06, c2, qx, 0.005, q[2] - c2 / 2, 0, 1); K.box("coping", pw + 2 * c2, 0.06, c2, qx, 0.005, q[3] + c2 / 2, 0, 1); K.box("coping", c2, 0.06, pz, q[0] - c2 / 2, 0.005, qz, 0, 1); K.box("coping", c2, 0.06, pz, q[1] + c2 / 2, 0.005, qz, 0, 1);
      K.box("poolIn", pw, 1.15, pz, qx, -0.6, qz, 0); [-0.22, 0.22].forEach(function (o) { K.cyl("chrome", 0.02, 0.02, 0.9, q[1] - 0.18, -0.1, q[3] - 0.25 + o * 0, 8); }); K.tube("chrome", V3(q[1] - 0.18, 0.35, q[3] - 0.47), V3(q[1] - 0.18, 0.35, q[3] - 0.03), 0.02, 8); K.tube("chrome", V3(q[1] - 0.18, -0.55, q[3] - 0.47), V3(q[1] - 0.18, 0.35, q[3] - 0.47), 0.02, 8); K.tube("chrome", V3(q[1] - 0.18, -0.55, q[3] - 0.03), V3(q[1] - 0.18, 0.35, q[3] - 0.03), 0.02, 8);
      // a teak sun lounger behind the pool
      var lz0 = (zB + q[2]) / 2; if (q[2] - zB > 2.3) { var lgx = qx; K.box("teak", 0.7, 0.06, 1.55, lgx, 0.3, lz0 + 0.2, 0, 0.5); var bk = new THREE.BoxGeometry(0.7, 0.06, 0.62); bk.rotateX(0.75); K.geo("teak", bk, lgx, 0.52, lz0 - 0.72); K.box("cushion", 0.64, 0.06, 1.5, lgx, 0.36, lz0 + 0.2, 0, 0.5); [-0.3, 0.3].forEach(function (o) { [-0.5, 0.85].forEach(function (zz) { K.box("teak", 0.05, 0.28, 0.05, lgx + o, 0.14, lz0 + zz, 0); }); }); } }
    // the railing: black posts, a timber cap, two steel cables, round the deck but for the steps
    var rail = function (ax, az, bx, bz) { var L = Math.hypot(bx - ax, bz - az); if (L < 0.05) return; var ry = Math.atan2(bx - ax, bz - az), mx = (ax + bx) / 2, mz = (az + bz) / 2; K.box("timber", 0.1, 0.045, L + 0.06, mx, 0.92, mz, ry, 1); [0.36, 0.64].forEach(function (y) { K.box("steel", 0.012, 0.012, L, mx, y, mz, ry); }); var n = Math.max(1, Math.ceil(L / 1.7)); for (var k = 0; k <= n; k++) { var t = k / n; K.box("metal", 0.055, 0.92, 0.055, ax + (bx - ax) * t, 0.46, az + (bz - az) * t, ry); } };
    var e = 0.03, g0 = -0.9, g1 = 0.9; rail(xL + e, zB + e, xR - e, zB + e); rail(xL + e, zB + e, xL + e, zF - e); rail(xR - e, zB + e, xR - e, zF - e); rail(xL + e, zF - e, g0, zF - e); rail(g1, zF - e, xR - e, zF - e);
    // the steps: three treads down to the pad, stringers and short rails
    var rise = (dH - 0.18) / 4, run = 0.3; for (var s = 1; s <= 3; s++) K.box("timber", 1.76, 0.05, run + 0.02, 0, -rise * s - 0.025, zF + run * (s - 0.5), 0, 1); [-1, 1].forEach(function (sd) { var x = sd * 0.88; K.beam("timber", V3(x, -0.05, zF), V3(x, -dH + 0.05, zF + run * 3.2), 0.05, 0.2, V3(sd, 0, 0)); });
    // the string light posts at the corners (the festoons are built with the bulbs)
    d.posts = [[xL + 0.12, zB + 0.12], [xR - 0.12, zB + 0.12], [xL + 0.12, zF - 0.12], [xR - 0.12, zF - 0.12]]; d.posts.forEach(function (pp) { K.box("metal", 0.08, 2.75, 0.08, pp[0], 1.375, pp[1], 0); K.box("metal", 0.3, 0.04, 0.04, pp[0], 2.62, pp[1], Math.atan2(-pp[0], -pp[1])); });
    // two teak sun loungers on the front terrace with a side table, an outdoor rug under the fire chairs, planters with small olive
    // trees at the back corners, low lights either side of the steps
    [R * 0.0 + 1.9, R * 0.0 + 3.1].forEach(function (lx, i) { var lz = zF - 1.95; K.box("teak", 0.68, 0.06, 1.55, lx, 0.3, lz + 0.2, 0, 0.5); var bk = new THREE.BoxGeometry(0.68, 0.06, 0.62); bk.rotateX(0.75); K.geo("teak", bk, lx, 0.52, lz - 0.72); K.box("cushion", 0.62, 0.06, 1.5, lx, 0.36, lz + 0.2, 0, 0.5); var ck = new THREE.BoxGeometry(0.62, 0.06, 0.55); ck.rotateX(0.75); K.geo("cushion", ck, lx, 0.56, lz - 0.68);
      [-0.29, 0.29].forEach(function (o) { [-0.5, 0.85].forEach(function (zz) { K.box("teak", 0.05, 0.28, 0.05, lx + o, 0.14, lz + zz, 0); }); }); });
    K.cyl("teak", 0.24, 0.24, 0.04, 2.5, 0.46, zF - 2.6, 18); K.cyl("teak", 0.03, 0.03, 0.44, 2.5, 0.23, zF - 2.6, 8); K.cyl("glassB", 0.04, 0.035, 0.12, 2.55, 0.54, zF - 2.6, 8);
    var rf = [-R * 0.55 - 0.1, zF - 1.75]; K.flat("rug", rf[0] - 1.6, rf[1] - 1.3, rf[0] + 1.3, rf[1] + 1.2, 0.012, true, 0.5);
    [[xL + 0.55, zB + 0.55], [xR - 0.55, zB + 0.55]].forEach(function (p, i) { K.box("concrete", 0.7, 0.55, 0.7, p[0], 0.275, p[1], 0, 1); K.cyl("post", 0.04, 0.06, 1.1, p[0], 1.0, p[1], 6); for (var k = 0; k < 7; k++) { var a = k / 7 * TAU; K.sph("leaf", 0.3, p[0] + Math.cos(a) * 0.28, 1.65 + (k % 3) * 0.14, p[1] + Math.sin(a) * 0.28, 0.75, 8); } });
    [-1.15, 1.15].forEach(function (x) { K.cyl("metal", 0.05, 0.06, 0.45, x, -dH + 0.22, zF + 1.15, 10); K.cyl("lens", 0.055, 0.055, 0.05, x, -dH + 0.44, zF + 1.15, 10); K.cyl("metal", 0.08, 0.07, 0.035, x, -dH + 0.48, zF + 1.15, 10); var gq = new THREE.PlaneGeometry(1.6, 1.6); gq.rotateX(-PI / 2); gq.translate(x, -dH + 0.04, zF + 1.15); K.add("glowAmber", gq); });
    // two potted agaves either side of the door
    [-1, 1].forEach(function (sd) { var x = sd * 1.25, z = R + 0.55; K.cyl("concrete", 0.26, 0.21, 0.5, x, 0.25, z, 16); for (var a = 0; a < 9; a++) { var lf = new THREE.ConeGeometry(0.05, 0.62, 5); lf.translate(0, 0.31, 0); lf.rotateZ(0.5 + (a % 3) * 0.18); lf.rotateY(a / 9 * TAU); K.geo("leaf", lf, x, 0.48, z); } });
    var info = { key: key, d: d, kit: K, tris: Math.round(K.count()) }; return (DECK[key] = info);
  }
  // the festoon: bulbs every 0.55 m on a sagging wire between the posts (front, both sides); per size and pool
  function festoon(d) { var pts = [], wires = [], P = d.posts, H = 2.6, sag = 0.38; var run = function (a, b) { var L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.round(L / 0.55)); var prev = null; for (var i = 0; i <= n; i++) { var t = i / n; var x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, y = H - sag * 4 * t * (1 - t); var p = V3(x, y, z); if (prev) wires.push([prev, p]); prev = p; if (i > 0 && i < n) pts.push(V3(x, y - 0.07, z)); } };
    run(P[2], P[3]); run(P[0], P[2]); run(P[1], P[3]); return { bulbs: pts, wires: wires }; }
  // the cedar barrel hot tub (staves, two steel bands, a seat bench inside), its steps; water is its own mesh
  function tubKit(K) { var Rt = 1.0, H = 1.02, n = 28; for (var i = 0; i < n; i++) { var a = i / n * TAU; var sw = 2 * Rt * Math.sin(PI / n) * 1.02; var g = new THREE.BoxGeometry(sw, H, 0.06); uvBox(g, sw, H, 0.06, 1); g.translate(0, H / 2, 0); g.rotateY(a); var x = Math.sin(a) * (Rt - 0.03), z = Math.cos(a) * (Rt - 0.03); K.geo("cedar", g, x, 0, z); }
    [0.2, 0.82].forEach(function (y) { K.cyl("band", Rt + 0.012, Rt + 0.012, 0.05, 0, y, 0, 36, true); }); K.cyl("tubIn", Rt - 0.07, Rt - 0.07, H - 0.06, 0, H / 2, 0, 28, true); var rim = new THREE.RingGeometry(Rt - 0.08, Rt + 0.02, 36, 1); rim.rotateX(-PI / 2); K.geo("cedar", rim, 0, H + 0.002, 0);
    K.cyl("cedar", 0.02, 0.02, 0.01, 0, 0.05, 0, 6); var seat = new THREE.RingGeometry(0.55, Rt - 0.07, 32, 1, PI * 0.15, PI * 1.7); seat.rotateX(-PI / 2); K.geo("cedar", seat, 0, 0.5, 0);
    // steps up the side (toward -x in the tub frame), a stainless handrail
    K.box("cedar", 0.5, 0.36, 0.9, -Rt - 0.28, 0.18, 0, 0, 0.5); K.box("cedar", 0.5, 0.7, 0.9, -Rt - 0.0, 0.35, 0, 0, 0.5);
    K.tube("chrome", V3(-Rt - 0.5, 0.0, 0.48), V3(-Rt - 0.5, 1.0, 0.48), 0.02, 8); K.tube("chrome", V3(-Rt - 0.5, 1.0, 0.48), V3(-Rt + 0.05, 1.25, 0.48), 0.02, 8); K.tube("chrome", V3(-Rt + 0.05, 1.25, 0.48), V3(-Rt + 0.05, 1.02, 0.48), 0.02, 8); }
  // the fire bowl (corten) on a stone base
  function fireKit(K) { var prof = [[0, 0], [0.42, 0], [0.45, 0.06], [0.52, 0.12], [0.55, 0.38], [0.5, 0.4], [0.46, 0.3], [0, 0.3]].map(function (p) { return new THREE.Vector2(p[0], p[1]); }); K.geo("corten", new THREE.LatheGeometry(prof, 28), 0, 0, 0); K.cyl("beads", 0.44, 0.44, 0.02, 0, 0.31, 0, 24); [-0.15, 0.1].forEach(function (o, i) { K.cyl("post", 0.05, 0.05, 0.5, o, 0.36, 0.05 * i, 8, false, 0.6 * i, 0, PI / 2); }); }
  // an Adirondack chair facing +z: slatted teak back fanned and reclined, wide arms, a cushion
  function adirondackKit(K) {
    for (var i = 0; i < 6; i++) K.box("teak", 0.62, 0.025, 0.08, 0, 0.36 - i * 0.012, 0.28 - i * 0.1, 0, 0.5, -0.12);
    for (var j = 0; j < 5; j++) { var g = new THREE.BoxGeometry(0.095, 0.9, 0.025); g.translate(0, 0.45, 0); g.rotateX(-0.5); g.rotateY((j - 2) * 0.07); K.geo("teak", g, (j - 2) * 0.13, 0.3, -0.3); }
    [-1, 1].forEach(function (sd) { K.box("teak", 0.14, 0.03, 0.82, sd * 0.38, 0.6, 0.05, 0, 0.5); K.box("teak", 0.06, 0.6, 0.06, sd * 0.38, 0.3, 0.38, 0); K.box("teak", 0.06, 0.4, 0.06, sd * 0.36, 0.2, -0.2, 0); K.box("teak", 0.06, 0.1, 0.7, sd * 0.32, 0.3, 0.05, 0, 0.5, -0.12); });
    K.box("cushion", 0.55, 0.06, 0.5, 0, 0.38, 0.05, 0, 0.5, -0.12); }
  // the outdoor dining set: a teak table (long axis z) and four chairs
  function diningKit(K) { K.box("teak", 0.9, 0.04, 1.6, 0, 0.74, 0, 0, 0.5); [[-0.38, -0.7], [0.38, -0.7], [-0.38, 0.7], [0.38, 0.7]].forEach(function (p) { K.box("teak", 0.06, 0.72, 0.06, p[0], 0.36, p[1], 0); });
    [[-0.85, -0.42, PI / 2], [-0.85, 0.42, PI / 2], [0.85, -0.42, -PI / 2], [0.85, 0.42, -PI / 2]].forEach(function (c) { var cs = Math.cos(c[2]), sn = Math.sin(c[2]); var W = function (lx, lz) { return [c[0] + lx * cs + lz * sn, c[1] - lx * sn + lz * cs]; };
      var s = W(0, 0); K.box("teak", 0.46, 0.04, 0.44, s[0], 0.45, s[1], c[2], 0.5); var b = W(0, -0.21); var bk = new THREE.BoxGeometry(0.46, 0.42, 0.03); bk.rotateX(0.12); K.geo("teak", bk, b[0], 0.68, b[1], c[2]);
      [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]].forEach(function (l) { var w = W(l[0], l[1]); K.box("teak", 0.04, 0.45, 0.04, w[0], 0.225, w[1], c[2]); }); K.box("cushion", 0.42, 0.04, 0.4, s[0], 0.48, s[1], c[2], 0.5); });
    K.cyl("glassB", 0.05, 0.04, 0.16, 0.1, 0.84, 0.1, 10); K.cyl("lampShade", 0.06, 0.06, 0.1, -0.05, 0.81, -0.15, 10); }
  // a low path light: a dark post with a shielded amber head
  function bollardKit(K) { K.cyl("metal", 0.055, 0.065, 0.5, 0, 0.25, 0, 10); K.cyl("lens", 0.06, 0.06, 0.06, 0, 0.49, 0, 10); K.cyl("metal", 0.09, 0.075, 0.04, 0, 0.54, 0, 10); }

  // ───────────────────────── the site: clusters, suites and vaults resolved from the JSON ─────────────────────────
  var SITE = DM.site = DM.site || null;
  function l2w(P, lx, lz) { var c = Math.cos(P.rot), s = Math.sin(P.rot); return [P.x + lx * c + lz * s, P.z - lx * s + lz * c]; }
  function w2l(P, x, z) { var dx = x - P.x, dz = z - P.z, c = Math.cos(P.rot), s = Math.sin(P.rot); return [dx * c - dz * s, dx * s + dz * c]; }
  // the vault's size from its width (vaults.shape): H = heightK W + heightAdd, the plan radius b = lenK a along, the ends cut at
  // c = cutK b (or nearer the middle, so the arch at the cut stands at least endMin high); the deck round it (vaults.deck)
  function vaultDims(w) { var sh = C("vaults.shape", {}), dk = C("vaults.deck", {}); var W = w, a = W / 2, H = W * (sh.heightK || 0.39) + (sh.heightAdd || 0.5), p = sh.planP || 2.8, m = sh.crownM || 2.6, n = sh.skirtN || 2, b = a * (sh.lenK || 1.18);
    var k = Math.min(sh.cutK || 0.78, Math.pow(Math.max(0.05, 1 - Math.pow(Math.min(0.95, (sh.endMin || 2.9) / H), n)), 1 / m)), c = k * b;
    return { W: W, L: 2 * c, H: H, a: a, b: b, p: p, m: m, n: n, c: c, k: k, recess: sh.recess || 0.6, dH: dk.height || 0.75, xL: -a - (dk.side || 2.2), xR: a + (dk.side || 2.2), zB: -c - (dk.back || 1.8), zF: c + W * (dk.frontK || 0.38) + (dk.frontAdd || 1.0) }; }
  function resolveSite() {
    if (SITE) return SITE; var c = cfg(); if (!c) return null;
    var S = { clusters: [], suites: [], vaults: [], c: c, byId: {} };
    (c.clusters || []).forEach(function (cl, ci) { var CL = { i: ci, id: cl.id, name: cl.name, short: cl.short || cl.name, zone: cl.zone, kicker: cl.kicker, hub: cl.hub, status: cl.status || "guest", suites: [] };
      (cl.suites || []).forEach(function (s) { var sz = C("sizes." + s.size, null) || C("sizes.M", { d: 8.2 }); var R = (sz.d || 8.2) / 2; var P = { id: s.id, from: s.from, cl: CL, size: s.size in { S: 1, M: 1, L: 1 } ? s.size : "M", R: R, pool: !!s.pool, model: !!s.model, garden: !!s.garden, x: s.x, z: s.z, rot: (s.rot || 0) * PI / 180, G: 0, D: 0, door: null, L: null };
        P.dd = deckDims(P.size, R, P.pool); P.key = P.size + (P.pool ? "p" : ""); CL.suites.push(P); S.suites.push(P); S.byId[P.id] = P; });
      S.clusters.push(CL); });
    var vs = C("vaults", {}); (vs.venues || []).forEach(function (v, i) { var V = { i: i, id: v.id, use: v.use, name: v.name, tag: v.tag, w: v.w || 13, x: v.x, z: v.z, rot: (v.rot || 0) * PI / 180, staff: v.staff, wins: (v.sideWin || []).filter(function (k) { return k === 1 || k === -1; }), G: 0, D: 0, L: null, vault: true }; V.vd = vaultDims(V.w); S.vaults.push(V); S.byId[V.id] = V; });
    S.vhub = vs.hub || null; return (SITE = DM.site = S);
  }
  // a deck's footprint (with a margin) in world, for keep-outs, clearing and grading
  function deckPoly(P, m) { m = m || 0; var d = P.vault ? P.vd : P.dd; return [l2w(P, d.xL - m, d.zB - m), l2w(P, d.xR + m, d.zB - m), l2w(P, d.xR + m, d.zF + 1.0 + m), l2w(P, d.xL - m, d.zF + 1.0 + m)]; }
  function inPoly(poly, x, z) { var c = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
  function deckCentre(P) { var d = P.vault ? P.vd : P.dd; return l2w(P, (d.xL + d.xR) / 2, (d.zB + d.zF + 1) / 2); }
  function deckRadius(P) { var d = P.vault ? P.vd : P.dd; return Math.hypot((d.xR - d.xL) / 2, (d.zF + 1 - d.zB) / 2); }
  function stepsFoot(P) { var d = P.vault ? P.vd : P.dd; return l2w(P, 0, d.zF + (P.vault ? 1.45 : 1.15)); }
  function allPlaces() { var S = SITE; return S ? S.suites.concat(S.vaults) : []; }
  // the paths: from every deck's steps to the nearest lane, smoothed, a little wandering
  function nearestRoadPt(x, z, maxD, avoid) { var best = null, bd = maxD; for (var r = 0; r < ROADS.length; r++) { var R0 = ROADS[r]; if (!R0.pts || R0.dm || R0.e1bed || R0.w < 2.5) continue; var p = R0.pts; for (var i = 0; i < p.length - 1; i++) { var ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1]; var vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1; var t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1); var qx = ax + vx * t, qz = az + vz * t; var d = Math.hypot(x - qx, z - qz) - R0.w / 2; if (d < bd) { bd = d; best = { x: qx, z: qz, d: d, w: R0.w, ux: vx / Math.sqrt(L2), uz: vz / Math.sqrt(L2) }; } } } return best; }
  function smoothPath(pts, seed) { var R = rng(seed || 3), out = []; if (pts.length < 2) return pts.slice(); var P = pts.map(function (p, i) { if (i === 0 || i === pts.length - 1) return p.slice(); return [p[0] + (R() - 0.5) * 0.6, p[1] + (R() - 0.5) * 0.6]; });
    for (var i = 0; i < P.length - 1; i++) { var p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)]; var L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]); var n = Math.max(2, Math.ceil(L / 1.2));
      for (var k = 0; k < n; k++) { var t = k / n, t2 = t * t, t3 = t2 * t; var f = function (a, b, c, d) { return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); }; out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]); } }
    out.push(P[P.length - 1].slice()); return out; }
  function resolvePaths(S) {
    if (S.paths) return S.paths; S.paths = [];
    allPlaces().forEach(function (P, i) { var f = stepsFoot(P); var q = nearestRoadPt(f[0], f[1], 40); if (!q) return; var end = [q.x + (f[0] - q.x) / Math.max(0.01, Math.hypot(f[0] - q.x, f[1] - q.z)) * (q.w / 2 - 0.4), q.z + (f[1] - q.z) / Math.max(0.01, Math.hypot(f[0] - q.x, f[1] - q.z)) * (q.w / 2 - 0.4)];
      var L = Math.hypot(end[0] - f[0], end[1] - f[1]); if (L < 0.5) { P.pathPts = null; return; }
      var o = l2w(P, 0, (P.vault ? P.vd : P.dd).zF + 0.6); var a = [f[0] + (f[0] - o[0]) * 0.9, f[1] + (f[1] - o[1]) * 0.9];
      var raw = L > 3.5 ? [[o[0], o[1]], f, a, end] : [[o[0], o[1]], f, end]; var pts = smoothPath(raw, 17 + i * 7); var w = P.vault ? 2.6 : 1.7; S.paths.push({ id: "dm_" + P.id, w: w, pts: pts, P: P }); P.pathPts = pts; });
    return S.paths;
  }
  // every footprint (decks, vault decks, paths): used for clearing, keep-outs and scatter
  function footprints(S) {
    if (S.fp) return S.fp; var F = [];
    allPlaces().forEach(function (P) { F.push({ t: "poly", poly: deckPoly(P, 1.2), c: deckCentre(P), r: deckRadius(P) + 1.2, P: P }); });
    (S.paths || []).forEach(function (p) { for (var i = 0; i < p.pts.length; i++) F.push({ t: "disc", c: p.pts[i], r: p.w / 2 + 0.6, path: true }); });
    (S.signs || []).forEach(function (sg) { F.push({ t: "disc", c: [sg.x, sg.z], r: 2.6 }); });
    return (S.fp = F);
  }
  function inFootprint(S, x, z, pathsToo) { var F = footprints(S); for (var i = 0; i < F.length; i++) { var f = F[i]; if (f.path && !pathsToo) continue; var dx = x - f.c[0], dz = z - f.c[1]; if (dx * dx + dz * dz > f.r * f.r) continue; if (f.t === "disc" || inPoly(f.poly, x, z)) return true; } return false; }
  var VEG = /^(bush\d|mesquite|ocotillo|saguaro.*|paloverde|ironwood|desertwillow|barrel_cactus|prickly_pear|cholla|organ_pipe|agave_cluster|yucca_cluster|boulder|fanpalm.*|datepalm|canarypalm|ph_(rock|boulder|shrub|succulent|stones|sandrocks|moonrock)_?\d*|e1_(?!opost).*)$/;
  function clearSite(S) {
    var removed = 0, keys = new Set();
    for (var k in PLACE) { if (!VEG.test(k)) continue; var L = PLACE[k], out = []; for (var i = 0; i < L.length; i++) { var e = L[i]; if (inFootprint(S, e[0], e[2], true)) { keys.add(Math.round(e[0] * 100) + ":" + Math.round(e[2] * 100)); removed++; } else out.push(e); } if (out.length !== L.length) { L.length = 0; Array.prototype.push.apply(L, out); } }
    if (keys.size) for (var j = COLLIDERS.length - 1; j >= 0; j--) { var c = COLLIDERS[j]; if (keys.has(Math.round(c[0] * 100) + ":" + Math.round(c[1] * 100))) COLLIDERS.splice(j, 1); }
    DM.n.cleared = (DM.n.cleared || 0) + removed;
  }
  function keepouts(S) { footprints(S).forEach(function (f, i) { if (f.path && i % 2) return; KEEPOUT.push([f.c[0], f.c[1], f.r]); }); }
  function hull(pts) { pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }); var cr = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }; var lo = [], up = []; pts.forEach(function (p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }); for (var i = pts.length - 1; i >= 0; i--) { var p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); } up.pop(); lo.pop(); return lo.concat(up); }
  function outlineOf(list, m) { var pts = []; list.forEach(function (P) { deckPoly(P, m || 5).forEach(function (q) { pts.push(q); }); }); return hull(pts); }

  // ───────────────────────── world hook: keep-outs, clearing, paths, hubs, zones, info points ─────────────────────────
  function worldHook() {
    if (DM.off || !window.PLAN) return; var S = resolveSite(); if (!S) { note("site", "no plan/domes.json"); return; } var t0 = nowMs();
    // the welcome signs: one at each cluster's hub side of the lane, one at the vaults
    S.signs = []; S.clusters.forEach(function (CL) { var q = CL.hub ? nearestRoadPt(CL.hub[0], CL.hub[1], 60) : null; if (!q) return; var nx = -q.uz, nz = q.ux; var sd = ((CL.hub[0] - q.x) * nx + (CL.hub[1] - q.z) * nz) >= 0 ? 1 : -1; var x = q.x + nx * sd * (q.w / 2 + 2.4), z = q.z + nz * sd * (q.w / 2 + 2.4); var ok = !S.suites.some(function (P) { return inPoly(deckPoly(P, 1.5), x, z); }); if (ok) S.signs.push({ x: x, z: z, rot: Math.atan2(-nx * sd, -nz * sd), cl: CL }); });
    if (S.vhub && S.vaults.length) { var V0 = S.vaults.reduce(function (a, b) { return Math.abs(b.x - S.vhub[0]) < Math.abs(a.x - S.vhub[0]) ? b : a; }); var f0 = l2w(V0, (V0.vd.xR) + 4.5, V0.vd.zF + 1.5); S.signs.push({ x: f0[0], z: f0[1], rot: V0.rot, vaults: true }); }
    resolvePaths(S); try { clearSite(S); } catch (e) { note("clear", e); } try { keepouts(S); } catch (e) { note("keepouts", e); }
    // the paths: warm decomposed granite, registered as roads (the walk surface, scatter and the minimap know them)
    var pm = M.track; try { var PM = planMats(); if (PM && PM.dg) { pm = PM.dg.clone(); pm.name = "dm_path"; pm.color.multiply(new THREE.Color(0xe2b993)); ROAD_MATS.set(pm, true); } } catch (e) { pm = M.track; }
    S.pathGroups = []; S.paths.forEach(function (p) { try { var n0 = ROADS.length; var rg = ribbon(p.pts, p.w, pm, pm === M.track ? 0.16 : 0.18); scene.add(rg); S.pathGroups.push(rg); if (ROADS.length > n0) ROADS[ROADS.length - 1].dm = true; } catch (e) { note("path " + p.id, e); } });
    // hubs (Places, map pills, fast travel), zone titles, info points (E)
    try { S.clusters.forEach(function (CL) { if (CL.hub) planAddHub(CL.short, CL.hub[0], CL.hub[1]); }); if (S.vhub) planAddHub(C("vaults.short", "Grand Vault Domes"), S.vhub[0], S.vhub[1]); planNavCats(); } catch (e) { note("hub", e); }
    try { S.clusters.forEach(function (CL) { var poly = outlineOf(CL.suites, 6); CL.outline = poly; var cx = 0, cz = 0; CL.suites.forEach(function (P) { cx += P.x; cz += P.z; }); cx /= CL.suites.length; cz /= CL.suites.length; zoneRings.push({ name: CL.name, label: CL.short, center: [cx, cz], r: 60, k: C("info." + CL.id + ".k", CL.kicker || ""), poly: poly, col: "#e9d7b444", plan: "domes", noLabel: true }); });
      if (S.vaults.length) { var vp = outlineOf(S.vaults, 6); var vx = 0, vz = 0; S.vaults.forEach(function (V) { vx += V.x; vz += V.z; }); zoneRings.push({ name: C("vaults.name", "The Grand Vault Domes"), label: C("vaults.short", "Grand Vault Domes"), center: [vx / S.vaults.length, vz / S.vaults.length], r: 45, k: C("vaults.kicker", ""), poly: vp, col: "#f4ecdc44", plan: "domes", noLabel: true }); } } catch (e) { note("zone", e); }
    try { var hs = function (key, x, z, r) { var d = C("info." + key, null); if (!d) return; var h = { x: x, z: z, r: r, t: d.t, k: d.k, p: d.p, dm: key }; hotspots.push(h); (DM.hsList = DM.hsList || []).push(h); return h; };
      S.signs.forEach(function (sg) { hs(sg.vaults ? "vaults" : sg.cl.id, sg.x, sg.z, 4.5); });
      S.suites.forEach(function (P) { if (!P.model) return; var f = stepsFoot(P); hs(P.cl.id, f[0], f[1], 2.6); }); } catch (e) { note("hotspots", e); }
    install(); DM.n.worldMs = Math.round(nowMs() - t0);
  }

  // ───────────────────────── terrain hook: grade the pads, plant the desert round the decks, re-seat what stands in the blend ─────────────────────────
  function gridH(x, z) { try { return sampleGrid(H, T, x, z); } catch (e) { return getH(x, z); } }
  function gradePad(test, bb, level, blend) {
    if (typeof H === "undefined" || !H || !T) return 0; var cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1), n = 0;
    var c0 = Math.max(0, Math.floor((bb[0] - blend - T.xmin) / cw)), c1 = Math.min(T.cols - 1, Math.ceil((bb[1] + blend - T.xmin) / cw)), r0 = Math.max(0, Math.floor((bb[2] - blend - T.zmin) / ch)), r1 = Math.min(T.rows - 1, Math.ceil((bb[3] + blend - T.zmin) / ch));
    for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) { var x = T.xmin + c * cw, z = T.zmin + r * ch; var d = test(x, z); if (d >= blend) continue; var k = 1 - sstep(0, blend, d); var v = r * T.cols + c; H[v] = H[v] + (level - H[v]) * k; n++; }
    return n;
  }
  function polyDist(poly, x, z) { if (inPoly(poly, x, z)) return 0; var best = 1e9; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var a = poly[j], b = poly[i]; var vx = b[0] - a[0], vz = b[1] - a[1]; var t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1), 0, 1); best = Math.min(best, Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t)); } return best; }
  function bbOf(poly) { var b = [1e9, -1e9, 1e9, -1e9]; poly.forEach(function (p) { b[0] = Math.min(b[0], p[0]); b[1] = Math.max(b[1], p[0]); b[2] = Math.min(b[2], p[1]); b[3] = Math.max(b[3], p[1]); }); return b; }
  function avgOver(poly, step) { var b = bbOf(poly), s = 0, n = 0; for (var x = b[0]; x <= b[1]; x += step) for (var z = b[2]; z <= b[3]; z += step) if (inPoly(poly, x, z)) { s += gridH(x, z); n++; } return n ? s / n : gridH((b[0] + b[1]) / 2, (b[2] + b[3]) / 2); }
  function terrainHook() {
    if (DM.off || !window.PLAN || !SITE) return; var S = SITE, t0 = nowMs(), n = 0;
    try { allPlaces().forEach(function (P) { var poly = deckPoly(P, 1.0); var lv = avgOver(poly, 1.5); P.G0 = lv; n += gradePad(function (x, z) { return polyDist(poly, x, z); }, bbOf(poly), lv, 4.5); }); } catch (e) { note("grade", e); }
    allPlaces().forEach(function (P) { var poly = deckPoly(P, 0); var hi = -1e9; poly.forEach(function (q) { hi = Math.max(hi, gridH(q[0], q[1])); }); P.G = Math.max(gridH(P.x, P.z), hi - 0.2); P.D = P.G + (P.vault ? P.vd.dH : P.dd.dH); });
    (S.signs || []).forEach(function (sg) { sg.G = gridH(sg.x, sg.z); }); DM.n.graded = n;
    // re-seat others' placements that stand on the graded ground nearby
    try { var Rr = 0; var bbs = allPlaces().map(function (P) { return bbOf(deckPoly(P, 6)); }); for (var k in PLACE) { var Lk = PLACE[k]; for (var i = 0; i < Lk.length; i++) { var e = Lk[i]; if (e.seated) continue; var inB = false; for (var j = 0; j < bbs.length; j++) { var b = bbs[j]; if (e[0] > b[0] && e[0] < b[1] && e[2] > b[2] && e[2] < b[3]) { inB = true; break; } } if (!inB) continue; var g = getH(e[0], e[2]); if (Math.abs(g - e[1]) > 0.02 && Math.abs(g - e[1]) < 1.5) { e[1] = g; Rr++; } } } DM.n.reseated = Rr; } catch (e) { note("reseat", e); }
    try { plant(S); } catch (e) { note("plant", e); }
    DM.n.terrainMs = Math.round(nowMs() - t0);
  }
  // desert planting round every deck: agave, yucca, barrel cactus, prickly pear, succulents and grasses near, young saguaros,
  // ocotillo and a palo verde standing back; the client's scatter fills the open desert between (it skips our keep-outs)
  function plant(S) {
    var R = rng(C("vegetation.seed", 2026)), n = 0;
    var near = ["barrel_cactus", "prickly_pear", "agave_cluster", "yucca_cluster", "ph_succulent_1", "ph_succulent_2", "ph_shrub_1", "ph_shrub_2", "bush1", "bush2", "ph_rock_1", "ph_rock_3"].filter(canPut);
    var far = ["saguaro_young", "saguaro_mid", "ocotillo", "paloverde", "organ_pipe", "ph_boulder_2", "mesquite"].filter(canPut);
    if (!near.length) return;
    var ok = function (x, z) { if (inFootprint(S, x, z, true)) return false; try { if (typeof nearRoad === "function" && nearRoad(x, z, 1.5)) return false; } catch (e) {} for (var i = 0; i < COLLIDERS.length; i++) { var c = COLLIDERS[i]; if (Math.abs(c[0] - x) < c[2] + 1.2 && Math.abs(c[1] - z) < c[2] + 1.2 && Math.hypot(c[0] - x, c[1] - z) < c[2] + 1.0) return false; } return true; };
    var put1 = function (k, x, z, sc) { if (!ok(x, z)) return false; put(k, x, z, R() * TAU, sc); var L = PLACE[k]; if (L && L.length) L[L.length - 1].dm = 1; n++; return true; };
    allPlaces().forEach(function (P) { var d = P.vault ? P.vd : P.dd, per = P.vault ? 16 : 10; for (var i = 0; i < per; i++) { var side = R(), lx, lz; if (side < 0.34) { lx = (R() < 0.5 ? d.xL - 1.4 - R() * 2.6 : d.xR + 1.4 + R() * 2.6); lz = d.zB + R() * (d.zF - d.zB); } else if (side < 0.62) { lx = d.xL + R() * (d.xR - d.xL); lz = d.zB - 1.4 - R() * 3; } else { lx = (R() < 0.5 ? -1 : 1) * (1.6 + R() * ((d.xR - d.xL) / 2)); lz = d.zF + 1.4 + R() * 2.6; }
        var w = l2w(P, lx, lz); var k = R() < 0.8 ? near[Math.floor(R() * near.length)] : (far[Math.floor(R() * far.length)] || near[0]); put1(k, w[0], w[1], 0.75 + R() * 0.5); } });
    allPlaces().forEach(function (P) { if (!P.garden) return; var d = P.dd; for (var i = 0; i < 34; i++) { var side = R(), lx, lz, o = 1.5 + R() * 3.6; if (side < 0.3) { lx = R() < 0.5 ? d.xL - o : d.xR + o; lz = d.zB + R() * (d.zF - d.zB); } else if (side < 0.55) { lx = d.xL - 2 + R() * (d.xR - d.xL + 4); lz = d.zB - o; } else { lx = (R() < 0.5 ? -1 : 1) * (2.4 + R() * ((d.xR - d.xL) / 2)); lz = d.zF + o; }
        var w = l2w(P, lx, lz); var k = R() < 0.72 ? near[Math.floor(R() * near.length)] : (far[Math.floor(R() * far.length)] || near[0]); put1(k, w[0], w[1], 0.8 + R() * 0.5); } });
    DM.n.planted = n;
  }

  // ───────────────────────── the furnished look of every guest suite through its glass (instanced, simple, warm after dark) ─────────────────────────
  function fakeKit(K, P0) {
    var P = P0, R = P.R;
    K.disc("oak", R - 0.06, 0, 0.015, 0, 40, 1.2);
    K.flat("rug", P.rug.x - P.rug.w / 2, P.rug.z - P.rug.d / 2, P.rug.x + P.rug.w / 2, P.rug.z + P.rug.d / 2, 0.03, true, 99);
    // the bathroom pod (oak clad box), and in L the sleeping loft on it
    var pc = Math.cos(P.pod.yaw), ps = Math.sin(P.pod.yaw); K.box("podWall", P.pod.w, P.pod.h, P.pod.d, P.pod.x, P.pod.h / 2, P.pod.z, P.pod.yaw, 1);
    if (P.loft) { FP(K, P.pod.x - ps * 0.1, P.pod.z - pc * 0.1, P.pod.yaw).rb("linen", 1.5, 0.22, 1.9, 0.06, 0, P.pod.h + 0.18, 0); }
    // the bed (rounded, low detail): platform, mattress, duvet, headboard, nightstands with glowing lamps
    bedK(K, P.bed, { lo: true });
    // the sofa (bed), armchairs, coffee table (rounded, low detail)
    sofaK(K, P.sofa.x, P.sofa.z, 0, { len: P.sofa.l, mat: "sofa", lo: true });
    FP(K, P.table.x, P.table.z, 0).rb("walnut", 1.1, 0.06, 0.6, 0.02, 0, 0.38, 0); K.box("walnut", 0.9, 0.34, 0.45, P.table.x, 0.18, P.table.z, 0, 1);
    P.arms.forEach(function (a) { armK(K, a.x, a.z, a.yaw, { mat: "throw", lo: true }); });
    // the stove (with a glowing window), the kitchenette counter, a round table and chairs, plants, a floor lamp, the curtains
    var st = P.stove; FP(K, st.x, st.z, st.yaw).rb("stove", 0.56, 0.62, 0.45, 0.05, 0, 0.5, 0); var sw = [st.x + Math.sin(st.yaw) * 0.23, st.z + Math.cos(st.yaw) * 0.23]; K.box("ember", 0.3, 0.24, 0.02, sw[0], 0.52, sw[1], st.yaw); K.disc("stone", 0.62, st.x, 0.02, st.z, 20, 1);
    var kt = P.kitchen; K.box("walnut", kt.l, 0.88, 0.6, kt.x, 0.44, kt.z, kt.yaw, 1); K.box("coping", kt.l + 0.04, 0.04, 0.64, kt.x, 0.9, kt.z, kt.yaw, 1);
    var dn = P.dining; K.cyl("walnut", 0.5, 0.5, 0.04, dn.x, 0.74, dn.z, 24); K.cyl("walnut", 0.06, 0.08, 0.72, dn.x, 0.36, dn.z, 8);
    dn.chairs.forEach(function (a) { var r = a * PI / 180, cx = dn.x + Math.sin(r) * 0.75, cz = dn.z + Math.cos(r) * 0.75; var f = FP(K, cx, cz, r + PI); f.rb("walnut", 0.44, 0.04, 0.42, 0.012, 0, 0.46, 0); f.rb("rattan", 0.38, 0.02, 0.36, 0.008, 0, 0.485, 0); f.rb("walnut", 0.44, 0.07, 0.03, 0.012, 0, 0.84, -0.2); f.bar("walnut", [-0.18, 0.5, -0.2], [0.18, 0.8, -0.2], 0.035, 0.02); f.bar("walnut", [0.18, 0.5, -0.195], [-0.18, 0.8, -0.195], 0.035, 0.02); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { f.box("walnut", 0.04, q[1] < 0 ? 0.88 : 0.46, 0.04, q[0] * 0.2, q[1] < 0 ? 0.44 : 0.23, q[1] * 0.19); }); });
    if (P.daybed) { var db = P.daybed; FP(K, db.x, db.z, db.yaw).rb("sofa", 2.0, 0.42, 0.85, 0.08, 0, 0.21, 0); FP(K, db.x, db.z, db.yaw).rb("linen", 1.9, 0.1, 0.78, 0.04, 0, 0.47, 0); }
    P.plants.forEach(function (p, i) { K.cyl("pot", 0.24, 0.19, 0.46, p.x, 0.23, p.z, 12); K.sph(i % 2 ? "olive" : "leaf", 0.42, p.x, 0.95 + (i % 2) * 0.2, p.z, 1.5, 8); });
    K.cyl("metal", 0.015, 0.015, 1.5, P.lamp.x, 0.75, P.lamp.z, 6); K.cyl("lampShade", 0.17, 0.22, 0.28, P.lamp.x, 1.55, P.lamp.z, 14);
    P.curtains.forEach(function (c) { for (var i = 0; i < 5; i++) { var off = (i - 2) * 0.12; var cx = c.x + Math.cos(c.yaw) * off, cz = c.z - Math.sin(c.yaw) * off; var g = new THREE.CylinderGeometry(0.06, 0.08, c.h, 6, 1, true); g.translate(cx, c.h / 2 + 0.03, cz); K.add("curtain", g); } });
  }
  // ───────────────────────── the exterior of every cluster, instanced: one draw per part and material ─────────────────────────
  var EX = DM.ex = DM.old ? { meshes: [], lights: [], cl: [] } : (DM.ex || { meshes: [], lights: [], cl: [] });
  var _M = new THREE.Matrix4(), _M2 = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _P = new THREE.Vector3(), _S1 = new THREE.Vector3(1, 1, 1), _SV = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0), _ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  function sMatrix(P, out) { _Q.setFromAxisAngle(_Y, P.rot); return (out || new THREE.Matrix4()).compose(_P.set(P.x, P.D, P.z), _Q, _S1); }
  function localMatrix(P, lx, ly, lz, ry, out, sc) { sMatrix(P, _M2); _Q.setFromAxisAngle(_Y, ry || 0); _M.compose(_P.set(lx, ly, lz), _Q, sc || _S1); return (out || new THREE.Matrix4()).multiplyMatrices(_M2, _M); }
  function instMesh(geo, mat, n, name, shadow) { var m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.name = "dm " + name; m.castShadow = !!shadow; m.receiveShadow = !mat.transparent; m.userData.shSet = true; m.userData.dm = true; m.count = n; EX.meshes.push(m); return m; }
  function finish(m) { m.instanceMatrix.needsUpdate = true; try { m.computeBoundingSphere(); m.computeBoundingBox(); } catch (e) {} return m; }
  // every exterior part's base material and colour (one draw per base: see Kit.based)
  var EXT = { deck: ["wood", "#ffffff"], timber: ["wood", "#e2c4ae"], post: ["wood", "#8c6c56"], teak: ["wood", "#f4d6b8"], cedar: ["cedarB", "#ffffff"], oak: ["wood", "#f2dcc0"], walnut: ["wood", "#7a5a46"], podWall: ["wood", "#f0d8bc"],
    metal: ["dark", "#0b0b0c"], strutD: ["dark", "#26282b"], band: ["dark", "#2c2d30"], wire: ["dark", "#141414"], stove: ["dark", "#151517"], beads: ["dark", "#1a1a1c"], tubIn: ["dark", "#3b5560", 1], black: ["dark", "#0c0c0d"], speaker: ["dark", "#18181a"],
    steel: ["bright", "#a6abb0"], chrome: ["bright", "#dadde0"], hub: ["bright", "#9ea2a6"], brass: ["bright", "#c9a24e"], inox: ["bright", "#b9bcbf"],
    coping: ["stoneV", "#f6ead8"], concrete: ["stoneV", "#c2bbb0"], corten: ["stoneV", "#7a4022"], stone: ["stoneV", "#f2dcc0"], poolIn: ["stoneV", "#3d9ab4", 1],
    leather: ["soft", "#6b4128"], marble: ["stoneV", "#efece6"], ceramic: ["paint", "#f4f4f2"], white: ["paint", "#f2f2ee"], green: ["soft", "#5f7a4a"], basalt: ["dark", "#2a2a2c"],
    cushion: ["soft", "#e9dfcc"], fabric: ["soft", "#f2e6d0"], leaf: ["soft", "#56703f"], pot: ["soft", "#9a6a48"], linen: ["soft", "#f7f3ea"], throw: ["soft", "#8a6f4e"], sofa: ["soft", "#ebe3d4"], rug: ["soft", "#b89c78"], curtain: ["soft", "#f3ead9"], cloth: ["soft", "#fbf8f2"], flower: ["soft", "#f3e9e0"], rose: ["soft", "#d7a1a0"],
    bulb: ["emit", "#ffd59a"], lens: ["emit", "#ffb468"], lampShade: ["emit", "#ffcf8a"], ember: ["emit", "#ff6a1c"], lamp: ["emit", "#ffd9a0"],
    glowWarm: ["glowV", "#ffc983"], glowBlue: ["glowV", "#38c8ff"], glowFire: ["glowV", "#ff8a3a"], glowAmber: ["glowV", "#ffb468"],
    membrane: ["membrane", "#ffffff"], strutW: ["membrane", "#e2dfd8"], doorGlass: ["glass", "#ffffff"], glassB: ["glass", "#ffffff"], glass: ["glass", "#ffffff"], rib: ["paint", "#f2f0ea"], chairW: ["paint", "#f5f2ec"],
    parquet: ["wood", "#d8a878"], mat: ["soft", "#7d8c6f"], mat2: ["soft", "#b7856a"], cord: ["wood", "#3a2a20"], jute2: ["soft", "#d8c7ac"], drapeF: ["soft", "#f6ecdc"], charcoalF: ["soft", "#4a4744"], rattan: ["soft", "#c9a273"], cork: ["soft", "#b98d5e"], jute: ["soft", "#c8ad84"], ivory: ["soft", "#f5efe3"], blush: ["soft", "#e8c9c0"], napkin: ["soft", "#ece4d6"], drape: ["soft", "#f6ecdc"], velvetS: ["soft", "#7d8c69"], velvetT: ["soft", "#a85f42"], velvetN: ["soft", "#334055"],
    cream: ["soft", "#f4ede1"], oat: ["soft", "#d8c7ac"], charcoal: ["soft", "#5d5955"], terracotta: ["soft", "#b4643e"], olive: ["soft", "#7f8c5c"], olive2: ["soft", "#9aa47a"], leafO: ["soft", "#5e6b45"], leafD: ["soft", "#3f5a32"], soil: ["soft", "#3b2b20"], bark: ["wood", "#7a5e4a"],
    paper: ["paint", "#efe7d6"], mirror: ["dark", "#6e7378"], copper: ["bright", "#c07a46"], gold: ["bright", "#c9a24e"], wine: ["emit", "#5a1420"], gin: ["emit", "#a8ccc4"], glassB2: ["emit", "#c8d6d2"], bottle: ["emit", "#3a5a3a"], amber: ["emit", "#8a4a14"], ledStrip: ["emit", "#ffc27a"], uplight: ["glowV", "#ffb35c"], washW: ["glowV", "#ffd9a8"] };
  var SHADOW = { membrane: 1, wood: 1 };
  // the outdoor set (decks, tubs, furniture, festoons, path lights, the sign body) and the vaults: steel and chrome go dark (one draw fewer)
  var OUT_T = Object.assign({}, EXT, { steel: ["dark", "#8f9499"], chrome: ["dark", "#b8bcc0"], brass: ["dark", "#9a7a3a"], inox: ["dark", "#a0a4a8"], hub: ["dark", "#8c9094"], glassB: ["emit", "#ffd59a"] });
  var VAULT_T = Object.assign({}, OUT_T, { concrete: ["paint", "#c2bbb0"], stone: ["paint", "#e6d8c2"], coping: ["paint", "#efe4d2"], corten: ["paint", "#7a4022"] });
  // the shells draw with four bases (the steel hubs and the chrome go to the dark base, a lighter tint)
  var SHELL_T = Object.assign({}, EXT, { hub: ["dark", "#8c9094"], chrome: ["dark", "#b4b8bc"] });
  // the furnished look through the glass: three plain bases (hard surfaces, soft furnishings, light)
  var FAKE_T = {}; Object.keys(EXT).forEach(function (k) { var t = EXT[k], b = t[0]; FAKE_T[k] = [b === "soft" ? "fsoft" : b === "emit" ? "emit" : b === "glowV" ? "glowV" : "fpaint", t[1]]; }); FAKE_T.oak = ["fpaint", "#c39668"]; FAKE_T.walnut = ["fpaint", "#5a3d2a"]; FAKE_T.podWall = ["fpaint", "#c8a070"];
  function shellSets(SH) { if (SH.gGuest) return SH;
    var lm = new THREE.Matrix4().makeTranslation(SH.hinge[0], 0, SH.hinge[1]); var gg = SH.K.based(SHELL_T); SH.LK.based(SHELL_T, lm, gg); SH.gGuest = mergeBased(gg); SH.gModel = mergeBased(SH.K.based(SHELL_T)); SH.gLeaf = mergeBased(SH.LK.based(SHELL_T)); return SH; }
  function addLinerAttr(geo, list, inst) { var g = geo.clone(); if (inst) { var a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, list.length) * 2), 2); list.forEach(function (P, i) { a.array[i * 2] = 1; a.array[i * 2 + 1] = P.R; }); g.setAttribute("aL", a); return { g: g, a: a }; }
    var n = g.attributes.position.count, b = new THREE.BufferAttribute(new Float32Array(n * 2), 2); for (var i = 0; i < n; i++) { b.array[i * 2] = 0.35; b.array[i * 2 + 1] = list[0].R; } g.setAttribute("aL", b); return { g: g, a: b }; }
  function staticMeshes(groups, grp, castBases) { var Mt = mats(), geos = mergeBased(groups), out = []; for (var b in geos) { var mt = Mt[b]; if (!mt) { note("base", b); continue; } var me = new THREE.Mesh(geos[b], mt); me.name = "dm " + grp.name + " " + b; me.castShadow = !!(castBases && castBases[b]) && !mt.transparent; me.receiveShadow = !mt.transparent; me.userData.shSet = true; if (mt.transparent) me.renderOrder = mt.blending === THREE.AdditiveBlending ? 2 : 3; if (b === "fire") me.renderOrder = 4; grp.add(me); out.push(me); } return out; }
  function flameGeo(seed) { var a = new THREE.PlaneGeometry(0.7, 0.55), b = a.clone(); b.rotateY(PI / 2); var m = mergeGeos([toNonIndexed(a), toNonIndexed(b)]); m.translate(0, 0.32 + 0.27, 0); var s = new Float32Array(m.attributes.position.count).fill(seed); m.setAttribute("aSeed", new THREE.BufferAttribute(s, 1)); return m; }
  function buildCluster(S, CL) {
    var Mt = mats(), list = CL.suites; if (!list.length) return null;
    var g = new THREE.Group(); g.name = "domes_" + CL.id; g.userData.noCull = true; var near = new THREE.Group(); near.name = "domes_near_" + CL.id; var small = new THREE.Group(); small.name = "domes_small_" + CL.id; g.add(near); g.add(small);
    var E = { CL: CL, g: g, near: near, small: small, inst: {}, liner: {}, chairAt: chairAtFn }; CL.E = E; var model = list.filter(function (P) { return P.model; })[0] || null;
    // the shells: instanced per size (door leaf closed, merged in); the Model Suite is one of them until its interior stands
    var sizes = {}; list.forEach(function (P) { (sizes[P.size] || (sizes[P.size] = [])).push(P); });
    Object.keys(sizes).forEach(function (sz) { var L0 = sizes[sz], SH = shellSets(buildShell(sz, L0[0].R)); E.inst[sz] = [];
      for (var b in SH.gGuest) { var geo = SH.gGuest[b]; if (b === "liner") { var la = addLinerAttr(geo, L0, true); geo = la.g; E.liner[sz] = { attr: la.a, list: L0 }; }
        var im = instMesh(geo, Mt[b], L0.length, CL.id + ":" + sz + ":" + b, SHADOW[b]); if (Mt[b].transparent) im.renderOrder = 3; L0.forEach(function (P, i) { P.instI = i; im.setMatrixAt(i, sMatrix(P)); }); near.add(finish(im)); E.inst[sz].push(im); } });
    // the furnished look through the glass: merged for the guest suites, a set of its own for the Model Suite (it goes when the real one stands)
    var fakeG = {}, modelFake = {}; list.forEach(function (P) { var FK = P._fk || (P._fk = new Kit()); if (!FK.m.oak) fakeKit(FK, suitePlan(P.size, P.R)); FK.based(FAKE_T, sMatrix(P), P === model ? modelFake : fakeG); });
    staticMeshes(fakeG, small); if (model) { E.mfake = new THREE.Group(); E.mfake.name = "domes_mfake_" + CL.id; small.add(E.mfake); staticMeshes(modelFake, E.mfake); }
    // the Model Suite's own shell (no leaf) and its door leaf on a hinge, shown while its interior stands
    if (model) { var SHm = shellSets(buildShell(model.size, model.R)); E.mset = new THREE.Group(); E.mset.name = "domes_model_" + CL.id; E.mset.position.set(model.x, model.D, model.z); E.mset.rotation.y = model.rot; E.mset.visible = false; near.add(E.mset);
      for (var b2 in SHm.gModel) { var geo2 = SHm.gModel[b2]; if (b2 === "liner") { var la2 = addLinerAttr(geo2, [model], false); geo2 = la2.g; E.mliner = la2.a; } var me = new THREE.Mesh(geo2, Mt[b2]); me.castShadow = !!SHADOW[b2]; me.receiveShadow = !Mt[b2].transparent; if (Mt[b2].transparent) me.renderOrder = 3; E.mset.add(me); }
      var piv = new THREE.Group(); piv.position.set(SHm.hinge[0], 0, SHm.hinge[1]); E.mset.add(piv); for (var b3 in SHm.gLeaf) { var lm2 = new THREE.Mesh(SHm.gLeaf[b3], Mt[b3]); if (Mt[b3].transparent) lm2.renderOrder = 3; piv.add(lm2); } model.piv = piv; }
    // the decks, tubs, pools and their water: merged per base (shadows from the timber); the small things: chairs, dining, fire, festoons, glows
    var stG = {}, smG = {}, wK = new Kit();
    list.forEach(function (P, pi) { var m4 = sMatrix(P); var DK = deckKit(P.key, P.size, P.R, P.pool); DK.kit.based(EXT, m4, stG);
      var TK = new Kit(); tubKit(TK); TK.based(EXT, localMatrix(P, P.dd.tub[0], 0, P.dd.tub[1], -PI / 2), stG);
      var wg = new THREE.CircleGeometry(0.92, 32); wg.rotateX(-PI / 2); wK.geo("water", wg.applyMatrix4(localMatrix(P, P.dd.tub[0], 0.9, P.dd.tub[1], 0)));
      if (P.pool) { var q = P.dd.pool0, pg = new THREE.PlaneGeometry(q[1] - q[0], q[3] - q[2]); pg.rotateX(-PI / 2); wK.geo("water", pg.applyMatrix4(localMatrix(P, (q[0] + q[1]) / 2, -0.12, (q[2] + q[3]) / 2, 0))); }
      var SK = new Kit(); fireKit(SK); SK.based(EXT, localMatrix(P, P.dd.fire[0], 0, P.dd.fire[1], 0), smG);
      var FL = new Kit(); FL.add("fire", flameGeo(pi * 1.7 + CL.i * 5.3)); FL.based(EXT, localMatrix(P, P.dd.fire[0], 0, P.dd.fire[1], 0), smG);
      [0, 1].forEach(function (k) { var c = E.chairAt(P, k); var AK = new Kit(); adirondackKit(AK); AK.based(EXT, localMatrix(P, c[0], 0, c[1], c[2]), smG); });
      var DN = new Kit(); diningKit(DN); DN.based(EXT, localMatrix(P, P.dd.dine[0], 0, P.dd.dine[1], 0), smG);
      var fe = festoon(DK.d), BK = new Kit(); fe.wires.forEach(function (w) { BK.tube("wire", w[0], w[1], 0.008, 4); }); fe.bulbs.forEach(function (b) { BK.sph("bulb", 0.036, b.x, b.y, b.z, 1.15, 8); }); BK.based(EXT, m4, smG);
      var GK = new Kit(), pl = function (key, s1, s2, lx, ly, lz) { var q2 = new THREE.PlaneGeometry(s1, s2); q2.rotateX(-PI / 2); q2.translate(lx, ly, lz); GK.add(key, q2); }; var d = P.dd;
      pl("glowBlue", 3.4, 3.4, d.tub[0], 0.02, d.tub[1]); pl("glowFire", 3.6, 3.6, d.fire[0], 0.022, d.fire[1]); pl("glowWarm", d.xR - d.xL + 2, d.zF - P.R + 3.5, (d.xL + d.xR) / 2, 0.018, (P.R + d.zF) / 2 + 0.2); GK.based(EXT, m4, smG); });
    wK.based(EXT, null, stG); for (var bk in smG) (stG[bk] || (stG[bk] = [])).push.apply(stG[bk], smG[bk]);
    try { addGardenLights(list, OUT_T, stG); addBollards(S, (S.paths || []).filter(function (p) { return !p.P.vault && p.P.cl === CL; }), OUT_T, stG); addSignBodies((S.signs || []).filter(function (sg) { return sg.cl === CL; }), OUT_T, stG); } catch (e) { note("bollards", e); }
    for (var bk2 in stG) stG[bk2].forEach(function (g0) { if (!g0.attributes.color) return; }); staticMeshes(remap(stG, OUT_T), near, { wood: 1 });
    // the far version: a plain dome and a deck slab per suite
    var fgeo = buildShell("L", 4.7).far; E.far = new THREE.Group(); E.far.name = "domes_far_" + CL.id; E.far.visible = false; g.add(E.far); var n = list.length;
    var fm2 = instMesh(fgeo, Mt.far, n, CL.id + ":far", true); list.forEach(function (P, i) { fm2.setMatrixAt(i, sMatrix(P).multiply(_M.makeScale(P.R / 4.7, P.R / 4.7, P.R / 4.7))); }); E.far.add(finish(fm2));
    var sl = new THREE.BoxGeometry(1, 1, 1); sl.translate(0, -0.5, 0); var fd = instMesh(sl, Mt.timber, n, CL.id + ":fardeck", false); list.forEach(function (P, i) { var d = P.dd; fd.setMatrixAt(i, localMatrix(P, (d.xL + d.xR) / 2, 0, (d.zB + d.zF) / 2, 0, null, _SV.set(d.xR - d.xL, d.dH + 0.2, d.zF - d.zB))); }); E.far.add(finish(fd));
    var cx = 0, cz = 0, rr = 0; list.forEach(function (P) { cx += P.x; cz += P.z; }); cx /= n; cz /= n; list.forEach(function (P) { rr = Math.max(rr, Math.hypot(P.x - cx, P.z - cz) + 14); }); E.cx = cx; E.cz = cz; E.r = rr;
    // pooled lights: a warm spill out of the glass, the tub's LEDs, the fire, the string lights (the client shows the nearest few)
    var LG = new THREE.Group(); LG.name = "domes_lights_" + CL.id; g.add(LG); E.lights = [];
    list.forEach(function (P) { var a = function (col, k, dd, lx, ly, lz, tag) { var w = l2w(P, lx, lz); var l = new THREE.PointLight(col, 0, dd, 1.6); l.position.set(w[0], P.D + ly, w[1]); l.userData.k0 = k; l.userData.tag = tag; l.userData.P = P; LG.add(l); E.lights.push(l); EX.lights.push(l); return l; };
      a(hex(C("light.glowColor", "#ffc983"), "#ffc983"), 1.6, 11, 0, 1.6, P.R + 1.2, "glass"); a(hex(C("light.tubColor", "#38c8ff"), "#38c8ff"), 0.7, 4.5, P.dd.tub[0], 1.2, P.dd.tub[1], "tub"); a(0xff8a3a, 1.2, 6.5, P.dd.fire[0], 0.8, P.dd.fire[1], "fire"); a(hex(C("light.bulbColor", "#ffd59a"), "#ffd59a"), 0.8, 9, (P.dd.xL + P.dd.xR) / 2, 2.4, P.dd.zF - 1.4, "bulbs"); });
    scene.add(g); EX.cl.push(E); return E;
  }
  // the path lights of a set of paths and the welcome sign bodies, added to a merged set (no draws of their own)
  function bollardPts(S, paths) { var sp = C("light.bollardSpacing", 6.5), pts = []; paths.forEach(function (p, pi) { var acc = sp * 0.4, side = pi % 2 ? 1 : -1;
      for (var i = 0; i < p.pts.length - 1; i++) { var a = p.pts[i], b = p.pts[i + 1]; var L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!L) continue; var dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L; var t = 0; while (acc + (L - t) >= sp) { t += sp - acc; acc = 0; var x = a[0] + dx * t - dz * side * (p.w / 2 + 0.35), z = a[1] + dz * t + dx * side * (p.w / 2 + 0.35); side = -side; if (!S.suites.concat(S.vaults).some(function (Q) { return inPoly(deckPoly(Q, 0.2), x, z); })) pts.push([x, z]); } acc += L - t; } }); return pts; }
  function gardenPts(P) { var d = P.dd, m = 1.8, pts = [], rect = [[d.xL - m, d.zB - m], [d.xR + m, d.zB - m], [d.xR + m, d.zF + m], [d.xL - m, d.zF + m]];
    for (var i = 0; i < 4; i++) { var a = rect[i], b = rect[(i + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 4.4)); for (var k = 0; k < n; k++) { var t = k / n, lx = a[0] + (b[0] - a[0]) * t, lz = a[1] + (b[1] - a[1]) * t; if (lz > d.zF - 0.5 && Math.abs(lx) < 2.4) continue; var w = l2w(P, lx, lz); if ((P.pathPts || []).some(function (q) { return Math.hypot(q[0] - w[0], q[1] - w[1]) < 1.6; })) continue; pts.push(w); } } return pts; }
  function addGardenLights(list, tints, G) { list.forEach(function (P) { if (!P.garden) return; gardenPts(P).forEach(function (p) { var y = planGroundAt(p[0], p[1]); var K = new Kit(); bollardKit(K); var q = new THREE.PlaneGeometry(1.8, 1.8); q.rotateX(-PI / 2); q.translate(0, 0.07, 0); K.add("glowAmber", q); K.based(tints, _M.makeTranslation(p[0], y - 0.02, p[1]), G); DM.n.gardenLights = (DM.n.gardenLights || 0) + 1; }); }); }
  function addBollards(S, paths, tints, G) { var pts = bollardPts(S, paths); pts.forEach(function (p) { var y = planGroundAt(p[0], p[1]); var K = new Kit(); bollardKit(K); var q = new THREE.PlaneGeometry(1.8, 1.8); q.rotateX(-PI / 2); q.translate(0, 0.07, 0); K.add("glowAmber", q); K.based(tints, _M.makeTranslation(p[0], y - 0.02, p[1]), G); }); DM.n.bollards = (DM.n.bollards || 0) + pts.length; }
  function addSignBodies(signs, tints, G) { signs.forEach(function (sg) { var y = planGroundAt(sg.x, sg.z); var m4 = new THREE.Matrix4().compose(V3(sg.x, y, sg.z), new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), sg.rot), V3(1, 1, 1)); var K = new Kit(); K.box("stone", 3.4, 0.5, 0.75, 0, 0.25, 0, 0, 1); K.box("corten", 3.0, 1.25, 0.1, 0, 1.12, 0, 0, 1); K.box("metal", 3.1, 0.06, 0.16, 0, 1.78, 0, 0); var gq = new THREE.PlaneGeometry(4, 4); gq.rotateX(-PI / 2); gq.translate(0, 0.04, 0); K.add("glowWarm", gq); K.based(tints, m4, G); }); }
  function remap(G, tints) { var mv = { bright: "dark" }; for (var a in mv) if (G[a]) { (G[mv[a]] || (G[mv[a]] = [])).push.apply(G[mv[a]], G[a]); delete G[a]; } if (tints === OUT_T && G.glass) { (G.emit || (G.emit = [])).push.apply(G.emit, G.glass); delete G.glass; } return G; }
  function chairAtFn(P, k) { var f = P.dd.fire, a = [-2.2, -0.95][k]; var x = f[0] + Math.sin(a) * 1.35, z = f[1] + Math.cos(a) * 1.35; return [x, z, Math.atan2(f[0] - x, f[1] - z)]; }
  // low path lights along every path (alternating sides), with a soft amber pool on the ground; merged into the cluster's small set
  function buildBollards(S) { return;
    var sp = C("light.bollardSpacing", 6.5); var byG = new Map();
    (S.paths || []).forEach(function (p, pi) { var P = p.P, grp = P.vault ? S.vg : (P.cl.E && P.cl.E.small); if (!grp) return; var pts = byG.get(grp) || []; byG.set(grp, pts); var acc = sp * 0.4, side = pi % 2 ? 1 : -1;
      for (var i = 0; i < p.pts.length - 1; i++) { var a = p.pts[i], b = p.pts[i + 1]; var L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!L) continue; var dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L; var t = 0; while (acc + (L - t) >= sp) { t += sp - acc; acc = 0; var x = a[0] + dx * t - dz * side * (p.w / 2 + 0.35), z = a[1] + dz * t + dx * side * (p.w / 2 + 0.35); side = -side; if (!S.suites.concat(S.vaults).some(function (Q) { return inPoly(deckPoly(Q, 0.2), x, z); })) pts.push([x, z]); } acc += L - t; } });
    byG.forEach(function (pts, grp) { if (!pts.length) return; var G = {}; pts.forEach(function (p) { var y = planGroundAt(p[0], p[1]); var K = new Kit(); bollardKit(K); var q = new THREE.PlaneGeometry(1.8, 1.8); q.rotateX(-PI / 2); q.translate(0, 0.07, 0); K.add("glowAmber", q); K.based(EXT, _M.makeTranslation(p[0], y - 0.02, p[1]), G); }); var g2 = new THREE.Group(); g2.name = "domes_bollards"; grp.add(g2); staticMeshes(G, g2); DM.n.bollards = (DM.n.bollards || 0) + pts.length; });
  }
  // a welcome sign at each cluster: a stone plinth and a corten blade, backlit warm after dark
  function buildSigns(S) {
    var Mt = mats(); (S.signs || []).forEach(function (sg, i) { var l1, l2, l3; if (sg.vaults) { l1 = C("vaults.short", "GRAND VAULT DOMES").toUpperCase(); l2 = "PAVILION GREEN"; l3 = S.vaults.map(function (V) { return V.name.replace(/^The /, "").toUpperCase(); }).join(" · "); } else { l1 = sg.cl.short.toUpperCase(); l2 = (C("names.suites", "Dome Suites") + " · " + (sg.cl.zone || "")).toUpperCase(); l3 = sg.cl.status === "home" ? "FUTURE HOMES, SUBJECT TO REZONING" : "GUESTS AND VISITORS WELCOME"; }
      var grp = sg.vaults ? S.vg : sg.cl.E && sg.cl.E.near; if (!grp) return; var G = new THREE.Group(); var y = planGroundAt(sg.x, sg.z); G.position.set(sg.x, y, sg.z); G.rotation.y = sg.rot; grp.add(G); var K = new Kit();
      var tx = signTex("s" + i, l1, l2, l3); var sm = std({ map: tx, emissive: 0xffc888, emissiveMap: tx, emissiveIntensity: 0.1, transparent: true, roughness: 0.4, depthWrite: false }); sm.name = "dm_sign"; (EX.signMats = EX.signMats || []).push(sm);
      var tq = [1, -1].map(function (sd) { var q = toNonIndexed(new THREE.PlaneGeometry(2.8, 1.05)); if (sd < 0) q.rotateY(PI); q.translate(0, 1.12, sd * 0.056); return q; }); var tm = new THREE.Mesh(mergeGeos(tq), sm); tm.renderOrder = 2; G.add(tm);
      var ss = addSolid(sg.x, sg.z, sg.rot, 3.4, 0.75, y - 0.2, y + 1.8, "domes"); if (ss) DM.sol.push(ss); });
  }

  // ───────────────────────── the Grand Vault Dome: a flattened dome over a square floor, both ends glazed in a great arch ─────────────────────────
  // The skin is the superellipsoid S^(m/p) + (y/H)^n = 1 with S = |x/a|^p + |z/b|^p: p squares the plan, m broadens the crown and
  // n = 2 brings the skirt down near vertical to the deck (a squashed half sphere over a near square, about 0.4 of its width high).
  // The planes z = ±c cut its two ends into wide arches with a white rolled rim; the glazing stands under the hood of each arch
  // (vaults.shape.recess): a dark frame, mullions, a transom, glass double doors at the front. The long sides are solid membrane,
  // with a big arched window band on the sides each venue names (vaults.venues[].sideWin). Panels follow an even arc-length grid,
  // each a soft pillow with a welded seam; a cream liner inside on white steel ribs; a low white curb where the skirt meets the deck.
  function vF(V, x, y, z) { var S = Math.pow(Math.abs(x) / V.a, V.p) + Math.pow(Math.abs(z) / V.b, V.p); return Math.pow(S, V.m / V.p) + Math.pow(Math.max(0, y) / V.H, V.n) - 1; }
  function vNrm(V, q) { var ax = Math.abs(q.x) / V.a, az = Math.abs(q.z) / V.b, S = Math.pow(ax, V.p) + Math.pow(az, V.p), k = S > 1e-9 ? V.m * Math.pow(S, V.m / V.p - 1) : 0;
    return V3(k * Math.pow(ax, V.p - 1) / V.a * (q.x < 0 ? -1 : 1), V.n * Math.pow(Math.max(0, q.y) / V.H, V.n - 1) / V.H, k * Math.pow(az, V.p - 1) / V.b * (q.z < 0 ? -1 : 1)).normalize(); }
  // the skin's height over (x, z), and its half width at height y in the section z (0 where the skin is lower)
  function vRoof(V, x, z) { var S = Math.pow(Math.abs(x) / V.a, V.p) + Math.pow(Math.abs(z) / V.b, V.p); return S >= 1 ? 0 : V.H * Math.pow(1 - Math.pow(S, V.m / V.p), 1 / V.n); }
  function vHalf(V, z, y) { var S = Math.pow(Math.max(0, 1 - Math.pow(clamp(y / V.H, 0, 1), V.n)), V.p / V.m) - Math.pow(Math.abs(z) / V.b, V.p); return S > 0 ? V.a * Math.pow(S, 1 / V.p) : 0; }
  // the skin point of the section z seen from the floor centre at angle al (0 = the +x foot, PI / 2 = the crown), by bisection
  function vRay(V, z, al) { var c = Math.cos(al), s = Math.sin(al), lo = 0, hi = Math.max(V.a, V.H) * 1.02; for (var i = 0; i < 22; i++) { var md = (lo + hi) / 2; if (vF(V, md * c, md * s, z) < 0) lo = md; else hi = md; } return V3(lo * c, lo * s, z); }
  // n + 1 points at even arc length across the section z, from the +x foot over the crown to the -x foot
  function vSection(V, z, n) { var N = 96, pts = [], acc = [0]; for (var i = 0; i <= N; i++) { var q = vRay(V, z, i / N * PI); pts.push(q); if (i) acc.push(acc[i - 1] + q.distanceTo(pts[i - 1])); } var tot = acc[N], out = [], j = 0;
    for (var k = 0; k <= n; k++) { var want = tot * k / n; while (j < N - 1 && acc[j + 1] < want) j++; var f = clamp((want - acc[j]) / Math.max(1e-9, acc[j + 1] - acc[j]), 0, 1); out.push(pts[j].clone().lerp(pts[j + 1], f)); } return { pts: out, len: tot }; }
  // an outline in the plane of a glazed end (points from the +x foot over the top): its height over x, its half width at y
  function arcY(arc, x) { for (var i = 0; i < arc.length - 1; i++) { var a = arc[i], b = arc[i + 1]; if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x); } return 0; }
  function arcX(arc, y) { for (var i = 0; i < (arc.length >> 1); i++) { var a = arc[i], b = arc[i + 1]; if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) return a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y); } return 0; }
  // the side window band: a low wide arch on the skin, in (z, y); its outline counter-clockwise (over the top, then the sill)
  function vWinTop(W, z) { var t = Math.abs(z) / W.zw; return t >= 1 ? W.yb : W.yb + W.h * Math.pow(1 - Math.pow(t, 2.4), 1 / 2.4); }
  function vWinPoly(W) { var pts = [], N = 22; for (var i = 0; i <= N; i++) { var t = i / N * PI, c = Math.cos(t), s = Math.sin(t); pts.push([W.zw * (c < 0 ? -1 : 1) * Math.pow(Math.abs(c), 2 / 2.4), W.yb + W.h * Math.pow(s, 2 / 2.4)]); } return pts; }
  function vLerpV(A, B, t) { return { p: A.p.clone().lerp(B.p, t), n: A.n.clone().lerp(B.n, t).normalize(), u: [A.u[0] + (B.u[0] - A.u[0]) * t, A.u[1] + (B.u[1] - A.u[1]) * t] }; }
  // a convex polygon split by the line A -> B in (z, y): [left part (inside), right part]
  function vSplit(poly, A, B) { var ins = [], outs = [], side = function (v) { return (B[0] - A[0]) * (v.p.y - A[1]) - (B[1] - A[1]) * (v.p.z - A[0]); };
    for (var i = 0; i < poly.length; i++) { var P = poly[i], Q = poly[(i + 1) % poly.length], sp = side(P), sq = side(Q); if (sp >= 0) ins.push(P); else outs.push(P); if ((sp >= 0) !== (sq >= 0)) { var X = vLerpV(P, Q, sp / (sp - sq)); ins.push(X); outs.push(X); } } return [ins, outs]; }
  function vClipWin(poly, wp) { var outs = [], cur = poly; for (var i = 0; i < wp.length && cur.length >= 3; i++) { var r = vSplit(cur, wp[i], wp[(i + 1) % wp.length]); if (r[1].length >= 3) outs.push(r[1]); cur = r[0]; } return { inside: cur.length >= 3 ? cur : null, outs: outs }; }
  var VGEO = DM.vgeo = DM.old ? {} : (DM.vgeo || {});
  function buildVaultGeo(w, wins) {
    wins = wins || []; var key = "v" + w + "w" + wins.join("_"); if (VGEO[key]) return VGEO[key]; var d = vaultDims(w); var V = { a: d.a, b: d.b, p: d.p, m: d.m, n: d.n, H: d.H, c: d.c }; var K = new Kit(), c = d.c, zg = c - d.recess;
    // seams across at the cut ends, at both glazing planes (a narrow hood row at each end: the skin lies on the true curve where
    // the glazing frame meets it) and evenly between
    var nu = Math.max(10, Math.round(vSection(V, 0, 8).len / 1.85)), ni = Math.max(2, Math.round(2 * zg / 1.8)), zs = [-c]; for (var j = 0; j <= ni; j++) zs.push(-zg + 2 * zg * j / ni); zs.push(c);
    var nv = zs.length - 1, rows = zs.map(function (z) { return vSection(V, z, nu).pts; });
    var WIN = wins.map(function (sd) { var Wn = { sd: sd, zw: Math.min(c * C("vaults.shape.winLen", 0.72), c - 1.3), yb: 0.34 }; Wn.h = Math.max(1.4, d.H * C("vaults.shape.winTop", 0.6) - Wn.yb); Wn.poly = vWinPoly(Wn); return Wn; });
    // the skin and its liner (pillowed quads, four triangles round a raised centre), the side windows cut out exactly
    var SK = { P: [], N: [], U: [] }, LN = { P: [], N: [], U: [] }, GL = [];
    var emit = function (T, list) { list.forEach(function (v) { T.P.push(v.p.x, v.p.y, v.p.z); T.N.push(v.n.x, v.n.y, v.n.z); T.U.push(v.u[0], v.u[1]); }); };
    var lin = function (v) { return { p: v.p.clone().addScaledVector(v.n, -0.14), n: v.n, u: v.u }; };
    var poly = function (pl, glass) { for (var i = 1; i < pl.length - 1; i++) { var t = [pl[0], pl[i], pl[i + 1]]; if (glass) GL.push(t.map(function (v) { return v.p.clone().addScaledVector(v.n, -0.05); })); else { emit(SK, t); emit(LN, t.map(lin)); } } };
    for (var jj = 0; jj < nv; jj++) for (var ii = 0; ii < nu; ii++) {
      var A = rows[jj][ii], B = rows[jj][ii + 1], Cc = rows[jj + 1][ii + 1], Dd = rows[jj + 1][ii];
      var ctr = A.clone().add(B).add(Cc).add(Dd).multiplyScalar(0.25), cn = vNrm(V, ctr), lift = A.distanceTo(Cc) * 0.022, M0 = ctr.clone().addScaledVector(cn, lift);
      var bl = function (q) { return vNrm(V, q).multiplyScalar(0.6).add(cn.clone().multiplyScalar(0.4)).normalize(); };
      var vA = { p: A, n: bl(A), u: [0, 0] }, vB = { p: B, n: bl(B), u: [1, 0] }, vC = { p: Cc, n: bl(Cc), u: [1, 1] }, vD = { p: Dd, n: bl(Dd), u: [0, 1] }, vM = { p: M0, n: cn, u: [0.5, 0.5] };
      var Wn = null; WIN.forEach(function (W0) { if (ctr.x * W0.sd > 0.4 && Math.abs(ctr.z) < W0.zw + 2.4 && ctr.y < W0.yb + W0.h + 2.4) Wn = W0; });
      [[vA, vB], [vB, vC], [vC, vD], [vD, vA]].forEach(function (e) { var t = [e[0], e[1], vM]; var nn = new THREE.Vector3().subVectors(t[1].p, t[0].p).cross(new THREE.Vector3().subVectors(t[2].p, t[0].p)); if (nn.dot(cn) < 0) t = [e[1], e[0], vM];
        if (!Wn) { poly(t, false); return; } var r = vClipWin(t, Wn.poly); r.outs.forEach(function (o) { poly(o, false); }); if (r.inside) poly(r.inside, true); });
    }
    var mk = function (T) { var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(T.P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(T.N, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(T.U, 2)); return g; };
    K.add("vskin", mk(SK)); K.add("vliner", mk(LN)); if (GL.length) K.tris("glass", GL, 2);
    // the white rolled rim round each arch (over the cut edge of skin and liner), the ribs inside at every seam across, the base curb
    var n2d = function (q) { var n = vNrm(V, q); n.z = 0; return n.normalize(); };
    [-c, c].forEach(function (z) { var arc = []; for (var i = 0; i <= 48; i++) { var q = vRay(V, z, i / 48 * PI); arc.push(q.addScaledVector(n2d(q), -0.065)); } for (var i2 = 0; i2 < 48; i2++) K.tube("rib", arc[i2], arc[i2 + 1], 0.115, 10); });
    var ribs = []; for (var r1 = 2; r1 < nv - 1; r1++) { var row = rows[r1], rp = row.map(function (q) { return q.clone().addScaledVector(vNrm(V, q), -0.23); }); for (var k = 0; k < rp.length - 1; k++) K.beam("rib", rp[k], rp[k + 1], 0.07, 0.13, vNrm(V, row[k])); ribs.push(rp); }
    for (var s = 0; s < 28; s++) { var za = -c + 2 * c * s / 28, zb = -c + 2 * c * (s + 1) / 28; [-1, 1].forEach(function (sd) { K.beam("rib", V3(sd * (vHalf(V, za, 0.09) + 0.035), 0.09, za), V3(sd * (vHalf(V, zb, 0.09) + 0.035), 0.09, zb), 0.18, 0.1, V3(sd, 0, 0)); }); }
    // the side windows: a dark frame round the arch, a sill, mullions, a transom (all on the skin, through to the liner)
    WIN.forEach(function (Wn) { var sd = Wn.sd; var onS = function (z, y) { var q = V3(sd * vHalf(V, z, y), y, z); return q.addScaledVector(vNrm(V, q), -0.03); };
      var seg = function (z0, y0, z1, y1, wd) { var A2 = onS(z0, y0), B2 = onS(z1, y1); K.beam("strutD", A2, B2, wd, 0.2, vNrm(V, A2)); };
      for (var i = 0; i < Wn.poly.length - 1; i++) seg(Wn.poly[i][0], Wn.poly[i][1], Wn.poly[i + 1][0], Wn.poly[i + 1][1], 0.1);
      for (var i3 = 0; i3 < 12; i3++) seg(-Wn.zw + 2 * Wn.zw * i3 / 12, Wn.yb, -Wn.zw + 2 * Wn.zw * (i3 + 1) / 12, Wn.yb, 0.14);
      var nm = Math.max(3, Math.round(2 * Wn.zw / 1.15)); for (var m = 1; m < nm; m++) { var zm = -Wn.zw + 2 * Wn.zw * m / nm, yt = vWinTop(Wn, zm); for (var k2 = 0; k2 < 6; k2++) seg(zm, Wn.yb + (yt - Wn.yb) * k2 / 6, zm, Wn.yb + (yt - Wn.yb) * (k2 + 1) / 6, 0.06); }
      var yT = Wn.yb + Math.min(2.3, Wn.h * 0.66), zT = Wn.zw * Math.pow(Math.max(0, 1 - Math.pow((yT - Wn.yb) / Wn.h, 2.4)), 1 / 2.4); for (var k3 = 0; k3 < 10; k3++) seg(-zT + 2 * zT * k3 / 10, yT, -zT + 2 * zT * (k3 + 1) / 10, yT, 0.06); Wn.yT = yT; });
    // the glazing at both ends, under the hood of the arch: glass, a dark frame round it, mullions, a transom and transom panes,
    // the double doors at the front (their leaves are their own meshes) and a fixed pair at the back
    var info = { key: key, d: d, V: V, zg: zg, c: c, doorHW: 1.05, doorH: 2.62, transom: 2.75, wins: WIN, rows: rows, nu: nu, nv: nv, ribs: ribs };
    [-1, 1].forEach(function (sd) { var z = sd * zg; var arc = []; for (var i = 0; i <= 40; i++) { var q = vRay(V, z, i / 40 * PI); arc.push(q.addScaledVector(n2d(q), -0.21)); } arc[0].y = 0; arc[40].y = 0; info[sd > 0 ? "arcF" : "arcB"] = arc;
      var shape = arc.map(function (q) { return new THREE.Vector2(q.x, q.y); }); var tri = THREE.ShapeUtils.triangulateShape(shape, []); var gl = []; tri.forEach(function (t) { gl.push([V3(shape[t[0]].x, shape[t[0]].y, z), V3(shape[t[1]].x, shape[t[1]].y, z), V3(shape[t[2]].x, shape[t[2]].y, z)]); }); K.tris("glass", gl, 2);
      for (var i4 = 0; i4 < arc.length - 1; i4++) K.beam("strutD", arc[i4].clone().add(V3(0, 0, -sd * 0.01)), arc[i4 + 1].clone().add(V3(0, 0, -sd * 0.01)), 0.13, 0.16, V3(0, 0, sd));
      var aw = arc[0].x, top = arcY(arc, 0); var nm2 = Math.max(4, Math.round((2 * aw) / 1.3)); for (var m2 = 1; m2 < nm2; m2++) { var x = -aw + 2 * aw * m2 / nm2; if (Math.abs(x) < info.doorHW + 0.25) continue; var yt = arcY(arc, x) - 0.03; if (yt < 0.3) continue; K.box("strutD", 0.08, yt, 0.12, x, yt / 2, z, 0); }
      var yT = info.transom, xT = arcX(arc, yT); K.box("strutD", 2 * xT - 0.05, 0.1, 0.12, 0, yT, z, 0); if (top - yT > 1.5) { var yT2 = yT + (top - yT) * 0.48, xT2 = arcX(arc, yT2); K.box("strutD", 2 * xT2 - 0.05, 0.07, 0.11, 0, yT2, z, 0); }
      [-info.doorHW, info.doorHW].forEach(function (x2) { K.box("strutD", 0.1, yT, 0.14, x2, yT / 2, z, 0); }); K.box("strutD", 2 * info.doorHW + 0.1, 0.05, 0.16, 0, 0.025, z, 0);
      if (sd < 0) { [-0.5, 0.5].forEach(function (o) { K.box("strutD", 0.06, info.doorH, 0.06, o * 2 * info.doorHW, info.doorH / 2, z - sd * 0.02, 0); }); } });
    // the deck: boards, fascia, posts, steps, the cable railing round it (a gap for the steps), string light posts
    var dH = d.dH, xL = d.xL, xR = d.xR, zB = d.zB, zF = d.zF, Wd = xR - xL, Dp = zF - zB, xc = (xL + xR) / 2, zc = (zB + zF) / 2;
    K.box("deck", Wd, 0.05, Dp, xc, -0.025, zc, 0, 1.6); K.box("timber", Wd + 0.04, 0.34, 0.05, xc, -0.2, zB - 0.02, 0, 1); K.box("timber", Wd + 0.04, 0.34, 0.05, xc, -0.2, zF + 0.02, 0, 1); K.box("timber", 0.05, 0.34, Dp, xL - 0.02, -0.2, zc, 0, 1); K.box("timber", 0.05, 0.34, Dp, xR + 0.02, -0.2, zc, 0, 1);
    var nx = Math.ceil(Wd / 2.4), nz = Math.ceil(Dp / 2.4); for (var jz = 0; jz <= nz; jz++) { var zz = zB + 0.15 + (Dp - 0.3) * jz / nz; K.box("post", Wd - 0.2, 0.22, 0.12, xc, -0.48, zz, 0, 1); for (var ix = 0; ix <= nx; ix++) { var xx = xL + 0.15 + (Wd - 0.3) * ix / nx; K.box("post", 0.16, dH, 0.16, xx, -0.37 - dH / 2, zz, 0, 1); } }
    var rail = function (ax, az, bx, bz) { var L2 = Math.hypot(bx - ax, bz - az); if (L2 < 0.05) return; var ry = Math.atan2(bx - ax, bz - az), mx = (ax + bx) / 2, mz = (az + bz) / 2; K.box("timber", 0.12, 0.05, L2 + 0.06, mx, 1.0, mz, ry, 1); [0.25, 0.47, 0.69].forEach(function (y) { K.box("steel", 0.012, 0.012, L2, mx, y, mz, ry); }); var n = Math.max(1, Math.ceil(L2 / 1.6)); for (var k = 0; k <= n; k++) { var t = k / n; K.box("metal", 0.06, 1.0, 0.06, ax + (bx - ax) * t, 0.5, az + (bz - az) * t, ry); } };
    var e = 0.03, sg = 1.7; rail(xL + e, zB + e, xR - e, zB + e); rail(xL + e, zB + e, xL + e, zF - e); rail(xR - e, zB + e, xR - e, zF - e); rail(xL + e, zF - e, -sg, zF - e); rail(sg, zF - e, xR - e, zF - e);
    var rise = (dH - 0.18) / 5, run = 0.3; for (var st = 1; st <= 4; st++) K.box("timber", 2 * sg - 0.1, 0.05, run + 0.02, 0, -rise * st - 0.025, zF + run * (st - 0.5), 0, 1); [-1, 1].forEach(function (sd) { K.beam("timber", V3(sd * (sg - 0.06), -0.05, zF), V3(sd * (sg - 0.06), -dH + 0.05, zF + run * 4.2), 0.05, 0.22, V3(sd, 0, 0)); K.tube("metal", V3(sd * (sg - 0.06), 1.0, zF), V3(sd * (sg - 0.06), -dH + 0.95, zF + run * 4), 0.025, 6); K.box("metal", 0.05, 0.95, 0.05, sd * (sg - 0.06), -dH + 0.47, zF + run * 4); });
    var posts = [[xL + 0.12, zF - 0.12], [xR - 0.12, zF - 0.12], [xL + 0.12, (c + zF) / 2 - 0.6], [xR - 0.12, (c + zF) / 2 - 0.6], [-sg - 0.12, zF - 0.12], [sg + 0.12, zF - 0.12]]; posts.forEach(function (pp) { K.box("metal", 0.1, 3.4, 0.1, pp[0], 1.7, pp[1], 0); });
    // the festoons: from the front posts up to the arch rim and across the front, sagging
    var bulbs = [], WK = new Kit(); var clear = function (a, b, sag) { for (var t = 0.05; t < 0.93; t += 0.04) { var p = a.clone().lerp(b, t); p.y -= sag * 4 * t * (1 - t); if (vF(V, p.x, p.y, p.z) < 0.06) return false; } return true; };
    var run2 = function (a, b, sag) { if (!clear(a, b, sag)) return false; var L2 = a.distanceTo(b), n = Math.max(2, Math.round(L2 / 0.6)); var prev = null; for (var i = 0; i <= n; i++) { var t = i / n; var p = a.clone().lerp(b, t); p.y -= sag * 4 * t * (1 - t); if (prev) WK.tube("wire", prev, p, 0.008, 4); prev = p; if (i > 0 && i < n) bulbs.push(p.clone().add(V3(0, -0.07, 0))); } return true; };
    var rimF = function (th) { var q = vRay(V, c, th); return q.addScaledVector(n2d(q), 0.06).add(V3(0, 0, 0.12)); };
    run2(V3(xL + 0.12, 3.3, zF - 0.12), V3(-sg - 0.12, 3.3, zF - 0.12), 0.35); run2(V3(sg + 0.12, 3.3, zF - 0.12), V3(xR - 0.12, 3.3, zF - 0.12), 0.35);
    [[xL + 0.12, zF - 0.12, 0.66 * PI], [xR - 0.12, zF - 0.12, 0.34 * PI], [-sg - 0.12, zF - 0.12, 0.56 * PI], [sg + 0.12, zF - 0.12, 0.44 * PI]].forEach(function (q) { run2(V3(q[0], 3.3, q[1]), rimF(q[2]), 0.45); });
    [[xL + 0.12, (c + zF) / 2 - 0.6, xL + 0.12], [xR - 0.12, (c + zF) / 2 - 0.6, xR - 0.12]].forEach(function (q) { if (!run2(V3(q[0], 3.3, q[1]), rimF(q[0] < 0 ? 0.86 * PI : 0.14 * PI), 0.45)) run2(V3(q[0], 3.3, q[1]), V3(q[2], 3.3, zF - 0.12), 0.32); });
    bulbs.forEach(function (b) { WK.sph("bulb", 0.05, b.x, b.y, b.z, 1, 8); }); info.K = K; info.WK = WK; info.bulbs = bulbs; info.tris = Math.round(K.count() + WK.count());
    // the door leaves (front, a pair, each hinged at its outer post, closed in the plane z = 0, opening outward)
    var LK = new Kit(), lw = info.doorHW - 0.02, lh = info.doorH; info.LK = LK; LK.box("doorGlass", lw - 0.1, lh - 0.1, 0.02, lw / 2, lh / 2, 0, 0); LK.box("strutD", 0.06, lh, 0.06, 0.03, lh / 2, 0); LK.box("strutD", 0.06, lh, 0.06, lw - 0.03, lh / 2, 0); LK.box("strutD", lw, 0.08, 0.06, lw / 2, 0.05, 0); LK.box("strutD", lw, 0.06, 0.06, lw / 2, lh - 0.03, 0); LK.box("chrome", 0.03, 1.1, 0.03, lw - 0.15, 1.15, 0.06); LK.box("chrome", 0.03, 1.1, 0.03, lw - 0.15, 1.15, -0.06); info.leaf = LK.geos(); info.leafW = lw;
    // the floor polygon (the footprint at the floor, between the glazed ends)
    var fl = []; for (var f = 0; f <= 28; f++) { var zf = -zg + 2 * zg * f / 28; fl.push([vHalf(V, zf, 0.01) - 0.06, zf]); } for (var f2 = 28; f2 >= 0; f2--) { var zf2 = -zg + 2 * zg * f2 / 28; fl.push([-vHalf(V, zf2, 0.01) + 0.06, zf2]); } info.floor = fl;
    return (VGEO[key] = info);
  }
  // the decks' outdoor pieces, fitted to each use: teak tables with cross-back chairs under market umbrellas at the dining room,
  // a floral wedding arch and dressed cocktail tables at the hall, stone planters of agave and a teak bench at the studio (merged
  // per venue, with their seats and solids)
  function vaultDeck(Vn, G) {
    var Mt = mats(), VG = Vn.VG, d = VG.d, L2 = d.L / 2, K = new Kit(), use = Vn.use, D = Vn.D;
    var sol = function (lx, lz, w, dd, y0, y1, ry) { return pSolid(Vn, lx, lz, w, dd, D + y0, D + y1, ry); };
    var seat = function (lx, lz, w, dd, y, face) { var sd = pSolid(Vn, lx, lz, w, dd, D + y - 0.4, D + y); if (sd) { sd.seat = true; sd.face = Vn.rot + face; } return sd; };
    var umbrella = function (x, z) { var f = FP(K, x, z, 0); f.rod("teak", [0, 0, 0], [0, 2.55, 0], 0.024, 8); f.lathe("fabric", [[1.5, 2.2], [1.1, 2.38], [0.5, 2.55], [0.04, 2.66]], 10, 0, 0, 0); f.lathe("fabric", [[0.04, 2.655], [0.5, 2.545], [1.1, 2.375], [1.5, 2.195]], 10, 0, 0, 0); f.cyl("teak", 0.03, 0.03, 0.12, 0, 2.7, 0, 8); for (var r = 0; r < 8; r++) { var a = r / 8 * TAU; f.rod("teak", [0, 2.3, 0], [Math.sin(a) * 1.45, 2.21, Math.cos(a) * 1.45], 0.008, 4); } };
    if (use === "restaurant") {
      [[-4.2, L2 + 2.4, 1], [4.2, L2 + 2.4, 1], [-6.9, L2 + 4.6, 0], [6.9, L2 + 4.6, 0], [-4.2, L2 + 5.2, 0], [4.2, L2 + 5.2, 1]].forEach(function (t) { var x = t[0], z = t[1]; if (Math.abs(x) + 1.2 > d.xR || z + 1.1 > d.zF) return; tableK(K, x, z, { s: 0.86, top: "teak", leg: "teak" }); sol(x, z, 0.9, 0.9, 0, 0.76);
        [0, PI / 2, PI, -PI / 2].forEach(function (a) { var cx = x + Math.sin(a) * 0.68, cz = z + Math.cos(a) * 0.68; crossChairP(K, cx, cz, a + PI, { wood: "teak", seat: "rattan" }); seat(cx, cz, 0.44, 0.42, 0.48, a + PI); });
        if (t[2]) umbrella(x, z); else { var f = FP(K, x, z, 0); candleK(f, 0, 0, 0.752); } });
    } else if (use === "hall") {
      // the wedding arch over the aisle in front of the doors: timber posts, a beam, white drapes, flowers
      var az = L2 + 3.4; [-1.25, 1.25].forEach(function (x) { K.box("timber", 0.14, 2.6, 0.14, x, 1.3, az, 0, 1); sol(x, az, 0.2, 0.2, 0, 2.6); }); K.box("timber", 3.0, 0.14, 0.18, 0, 2.62, az, 0, 1);
      [-1, 1].forEach(function (sd) { var pts = []; for (var i = 0; i <= 8; i++) { var t2 = i / 8; pts.push(V3(sd * (1.25 - 0.9 * t2), 2.55 - 0.5 * Math.sin(t2 * PI) * 0.6, az + 0.12)); } for (var j = 0; j < 8; j++) K.tube("ivory", pts[j], pts[j + 1], 0.06, 6); FP(K, sd * 1.3, az + 0.16, 0).geo("ivory", drapeGeo(0.36, 2.45, 0.09, 0.03), 0, 0.02, 0); });
      for (var f2 = 0; f2 < 30; f2++) { var a2 = f2 / 30, fx = -1.4 + 2.8 * a2, fy = 2.72 + Math.sin(a2 * PI * 3) * 0.06; K.sph(f2 % 3 ? "flower" : (f2 % 2 ? "rose" : "blush"), 0.085 + (f2 % 4) * 0.014, fx, fy, az + (f2 % 2) * 0.1, 1, 8); if (f2 % 2) K.sph("leaf", 0.1, fx + 0.05, fy - 0.07, az + 0.08, 0.55, 6); } [-1.25, 1.25].forEach(function (x) { for (var f3 = 0; f3 < 7; f3++) K.sph(f3 % 2 ? "flower" : "leaf", 0.1, x + (f3 % 2 ? 0.08 : -0.06), 0.5 + f3 * 0.3, az + 0.1, 1, 6); });
      [[-5.6, L2 + 2.2], [5.6, L2 + 2.2], [-6.4, L2 + 5.4], [6.4, L2 + 5.4]].forEach(function (t) { if (Math.abs(t[0]) + 0.6 > d.xR || t[1] + 0.6 > d.zF) return; var f = FP(K, t[0], t[1], 0); f.geo("ivory", clothGeo(0.36, 1.08, 7, t[0]), 0, 0, 0); f.lathe("glassB", [[0, 0], [0.035, 0], [0.004, 0.012], [0.004, 0.1], [0.03, 0.12], [0.036, 0.17], [0.03, 0.2]], 10, 0.1, 1.085, 0); candleK(f, -0.08, 0.05, 1.085); sol(t[0], t[1], 0.8, 0.8, 0, 1.1); });
    } else {
      [[-d.W / 2 - 1.2, L2 + 1.2], [d.W / 2 + 1.2, L2 + 1.2], [-d.W / 2 - 1.2, -L2 + 0.5], [d.W / 2 + 1.2, -L2 + 0.5], [-3.2, d.zF - 0.8], [3.2, d.zF - 0.8]].forEach(function (p, i) { var f = FP(K, p[0], p[1], i * 0.9); f.rb("concrete", 0.95, 0.62, 0.95, 0.04, 0, 0.31, 0); f.cyl("soil", 0.4, 0.4, 0.02, 0, 0.6, 0, 12); for (var a = 0; a < 11; a++) { var lf = new THREE.ConeGeometry(0.055, 0.66, 5); lf.scale(1, 1, 0.45); lf.translate(0, 0.33, 0); lf.rotateZ(0.45 + (a % 3) * 0.2); lf.rotateY(a / 11 * TAU); f.geo(a % 2 ? "leaf" : "olive2", lf, 0, 0.6, 0); } [[0.28, 0.2], [-0.25, -0.22]].forEach(function (q) { f.sph("green", 0.09, q[0], 0.68, q[1], 1, 0.9, 1, 8); }); sol(p[0], p[1], 1.0, 1.0, 0, 0.9); });
      var bf = FP(K, 0, L2 + 2.6, 0); for (var sl = 0; sl < 5; sl++) bf.rb("teak", 2.2, 0.05, 0.085, 0.012, 0, 0.45, -0.2 + sl * 0.1); [-0.9, 0.9].forEach(function (o) { bf.rb("concrete", 0.14, 0.43, 0.46, 0.015, o, 0.215, 0); });
      [-0.6, 0, 0.6].forEach(function (o) { seat(o, L2 + 2.6, 0.6, 0.48, 0.48, 0); });
    }
    return K;
  }
  // the furnished look of each vault from outside (simple and merged; it goes while the real interior stands)
  function vaultFakeKit(Vn) { var VG = Vn.VG, V = VG.V, zg = VG.zg, K = new Kit(), use = Vn.use;
    var hw = function (z, y) { return vHalf(V, z, y) - 0.35; }, chair = function (x, z, a, key) { var f = FP(K, x, z, a); f.rb(key, 0.44, 0.05, 0.42, 0.015, 0, 0.47, 0); f.rb(key, 0.44, 0.42, 0.04, 0.015, 0, 0.7, -0.19); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { f.box(key, 0.035, 0.45, 0.035, q[0] * 0.18, 0.225, q[1] * 0.17); }); };
    if (use === "restaurant") { [[-1.2, -1.9, 4], [-1.2, 0.5, 4], [-1.2, 2.9, 2], [1.3, -1.9, 2], [1.3, 0.5, 4], [1.3, 2.9, 4], [3.8, -1.9, 4], [3.8, 0.5, 2], [3.8, 2.9, 4]].forEach(function (t) { var x = t[0], z = t[1]; FP(K, x, z, 0).rb("walnut", t[2] === 4 ? 0.86 : 0.76, 0.05, t[2] === 4 ? 0.86 : 0.76, 0.02, 0, 0.74, 0); K.cyl("black", 0.05, 0.06, 0.72, x, 0.36, z, 6); (t[2] === 4 ? [0, PI / 2, PI, -PI / 2] : [PI / 2, -PI / 2]).forEach(function (a) { chair(x + Math.sin(a) * 0.66, z + Math.cos(a) * 0.66, a + PI, "walnut"); }); K.sph("lamp", 0.11, x, 2.25, z, 1, 8); });
      var bx = -3.9, bz = -0.75; FP(K, bx, bz, PI / 2).rb("walnut", 4.2, 1.05, 0.6, 0.02, 0, 0.53, 0); var bbx = -(vHalf(V, bz, 2.45) - 0.3); FP(K, bbx, bz, PI / 2).rb("walnut", 4.0, 0.9, 0.5, 0.02, 0, 0.45, 0); FP(K, bbx, bz, PI / 2).box("ledStrip", 3.8, 1.2, 0.04, 0, 1.6, -0.2);
      var kz = -zg + 1.6; FP(K, 0.5, kz, 0).rb("inox", 6.2, 1.05, 0.6, 0.02, 0, 0.53, 0); FP(K, -3.75, 3.45, PI / 2).rb("leather", 2.1, 0.75, 0.8, 0.12, 0, 0.38, 0); [[-2.7, 2.8], [-2.7, 4.1]].forEach(function (q) { FP(K, q[0], q[1], -PI / 2).rb("leather", 0.8, 0.8, 0.8, 0.15, 0, 0.4, 0); });
      [[5.15, -3.2], [-3.7, -3.5], [5.3, 3.85]].forEach(function (q) { K.cyl("pot", 0.28, 0.22, 0.5, q[0], 0.25, q[1], 10); K.sph("olive", 0.55, q[0], 1.45, q[1], 1.25, 8); }); }
    else if (use === "hall") { var szc = -zg + 1.3; FP(K, 0, szc, 0).rb("walnut", 7.4, 0.45, 2.1, 0.02, 0, 0.225, 0); FP(K, 0, -zg + 0.23, 0, 0.45).geo("drape", drapeGeo(7.0, Math.min(3.8, arcY(VG.arcB, 3.5) - 0.65), 0.32, 0.07), 0, 0, 0);
      [[-5.2, -2.0], [5.2, -2.0], [-5.2, 1.4], [5.2, 1.4], [-3.3, 4.4], [3.3, 4.4]].forEach(function (t) { K.cyl("ivory", 0.92, 0.96, 0.76, t[0], 0.38, t[1], 18); K.sph("rose", 0.16, t[0], 0.95, t[1], 1, 6); for (var c2 = 0; c2 < 8; c2++) { var a = c2 / 8 * TAU + PI / 8; chair(t[0] + Math.sin(a) * 1.25, t[1] + Math.cos(a) * 1.25, a + PI, "gold"); } }); K.flat("parquet", -2.7, -3.5, 2.7, 1.1, 0.025, true, 0.6); K.sph("lamp", 0.3, 0, 4.4, -1.2, 0.3, 8); }
    else { [[-0.45, 0], [1.55, 1]].forEach(function (rw) { for (var m = 0; m < 4; m++) { var x = (rw[1] ? -1.47 : -2.2) + m * 1.47; FP(K, x, rw[0], 0).rb(["velvetS", "mat2", "oat", "velvetT"][(m + rw[1]) % 4], 0.61, 0.01, 1.83, 0.004, 0, 0.012, 0); K.cyl("linen", 0.1, 0.1, 0.5, x, 0.11, rw[0] + 0.66, 8, false, 0, 0, PI / 2); } });
      var tbx = -(hw(0.2, 1.6) - 0.05); FP(K, tbx, 0.1, PI / 2).rb("oak", 3.0, 0.92, 0.55, 0.02, 0, 0.46, 0); [[3.5, -2.3], [3.65, 0.55], [-3.5, -2.45], [1.9, -zg + 0.45], [3.55, 2.6]].forEach(function (q, i) { K.cyl("pot", 0.24, 0.19, 0.42, q[0], 0.21, q[1], 10); K.sph(i % 2 ? "leafD" : "leaf", 0.4, q[0], 1.05 + (i % 2) * 0.2, q[1], 1.5, 8); }); [[-1.2, 0.6], [1.2, 0.6], [0, -1.6]].forEach(function (q) { K.sph("lamp", 0.2, q[0], 2.4, q[1], 1, 8); }); }
    return K; }
  var LEAF_T = Object.assign({}, EXT, { chrome: ["dark", "#a2a6aa"] });
  function buildVaults(S) {
    var Mt = mats(); if (!S.vaults.length) return; var g = new THREE.Group(); g.name = "domes_vaults"; g.userData.noCull = true; S.vg = g; var small = new THREE.Group(); small.name = "domes_vaults_small"; g.add(small); S.vsmall = small; EX.vlights = [];
    var stG = {}, smG = {}, ft = { restaurant: ["floorV", "#ffffff"], hall: ["floorV", "#d6a676"], studio: ["floorV", "#f2deb4"] };
    S.vaults.forEach(function (Vn) { var VG = buildVaultGeo(Vn.w, Vn.wins); Vn.VG = VG; var m4 = sMatrix(Vn);
      VG.K.based(EXT, m4, stG); VG.WK.based(EXT, m4, smG);
      // the floor (oak, a parquet in the hall, bamboo in the studio), the warm light under the string lights
      var shp = new THREE.Shape(VG.floor.map(function (p) { return new THREE.Vector2(p[0], -p[1]); })); var fg = toNonIndexed(new THREE.ShapeGeometry(shp)); fg.rotateX(-PI / 2); var uv = fg.attributes.uv, pa = fg.attributes.position; for (var i = 0; i < uv.count; i++) uv.setXY(i, pa.getX(i) / 1.4, pa.getZ(i) / 1.4); fg.translate(0, 0.012, 0);
      var FK = new Kit(); FK.add("floor_" + Vn.use, fg); var tt = {}; tt["floor_" + Vn.use] = ft[Vn.use] || ft.restaurant; FK.based(tt, m4, stG);
      var GK = new Kit(), gq = new THREE.PlaneGeometry(VG.d.xR - VG.d.xL, VG.d.zF - VG.zg); gq.rotateX(-PI / 2); gq.translate(0, 0.02, (VG.zg + VG.d.zF) / 2); GK.add("glowWarm", gq); GK.based(EXT, m4, smG);
      try { var DKt = vaultDeck(Vn); if (DKt) DKt.based(EXT, m4, smG); } catch (e) { note("vault deck", e); }
      // the front doors: a pair of glass leaves on pivots (closed, opening outward when you walk up)
      var G = new THREE.Group(); G.name = "vault doors " + Vn.id; G.position.set(Vn.x, Vn.D, Vn.z); G.rotation.y = Vn.rot; g.add(G); Vn.g = G; var lg = mergeBased(VG.LK.based(LEAF_T));
      Vn.leaves = []; [-1, 1].forEach(function (sd) { var piv = new THREE.Group(); piv.position.set(sd * VG.doorHW, 0, VG.zg + 0.02); piv.rotation.y = sd > 0 ? PI : 0; G.add(piv); for (var b in lg) { var lm = new THREE.Mesh(lg[b], Mt[b]); if (Mt[b].transparent) lm.renderOrder = 3; piv.add(lm); } Vn.leaves.push(piv); }); Vn.door = { open: 0, target: 0, manual: false };
      // warm pooled lights: under the vault, the deck under the string lights
      var a = function (col, k, dd, lx, ly, lz, tag) { var w = l2w(Vn, lx, lz); var l = new THREE.PointLight(col, 0, dd, 1.5); l.position.set(w[0], Vn.D + ly, w[1]); l.userData.k0 = k; l.userData.tag = tag; l.userData.P = Vn; g.add(l); EX.vlights.push(l); EX.lights.push(l); return l; };
      a(hex(C("light.glowColor", "#ffc983"), "#ffc983"), 2.4, Vn.w * 1.2, 0, VG.d.H * 0.6, 0, "vault"); a(hex(C("light.bulbColor", "#ffd59a"), "#ffd59a"), 1.6, 12, 0, 2.8, VG.zg + (VG.d.zF - VG.zg) / 2, "bulbs");
      DM.n.vaultTris = (DM.n.vaultTris || 0) + VG.tris; });
    for (var bk in smG) (stG[bk] || (stG[bk] = [])).push.apply(stG[bk], smG[bk]);
    try { addBollards(S, (S.paths || []).filter(function (p) { return p.P.vault; }), VAULT_T, stG); addSignBodies((S.signs || []).filter(function (sg) { return sg.vaults; }), VAULT_T, stG); } catch (e) { note("vault bollards", e); }
    var vg2 = remap(stG, VAULT_T); ["stoneV"].forEach(function (b) { if (vg2[b]) { (vg2.paint || (vg2.paint = [])).push.apply(vg2.paint, vg2[b]); delete vg2[b]; } }); staticMeshes(vg2, g, { vskin: 1, wood: 1 });
    // the furnished look of the vaults: one merged set for all three, and one without each in turn (shown while that one's interior stands)
    S.vfake = {}; [null].concat(S.vaults).forEach(function (X) { var fg = {}; S.vaults.forEach(function (Vn) { if (Vn === X) return; try { vaultFakeKit(Vn).based(FAKE_T, sMatrix(Vn), fg); } catch (e) { note("vault fake", e); } }); var grp = new THREE.Group(); grp.name = "vault fake " + (X ? "no " + X.id : "all"); grp.visible = !X; small.add(grp); staticMeshes(fg, grp); S.vfake[X ? X.id : "all"] = grp; });
    scene.add(g);
  }

  // ───────────────────────── solids and seats: decks, steps, railings, the dome walls, tubs, pools, fires, chairs, tables ─────────────────────────
  DM.sol = DM.old ? [] : (DM.sol || []);
  function pSolid(P, lx, lz, w, d, y0, y1, ry, list) { var p = l2w(P, lx, lz); var sd = addSolid(p[0], p[1], P.rot + (ry || 0), w, d, y0, y1, "domes"); if (sd) { DM.sol.push(sd); if (list) list.push(sd); } return sd; }
  function seatSolid(P, lx, lz, w, d, y, face, list) { var sd = pSolid(P, lx, lz, w, d, y - 0.4, y, 0, list); if (sd) { sd.seat = true; sd.face = P.rot + face; } return sd; }
  function suiteSolids(P) {
    var d = P.dd, D = P.D, R = P.R, dH = d.dH, rh = D + 0.95;
    // the deck top (around the pool when there is one), the steps
    if (d.pool0) { var q = d.pool0, c2 = 0.26; [[d.xL, d.xR, d.zB, q[2] - c2], [d.xL, d.xR, q[3] + c2, d.zF], [d.xL, q[0] - c2, q[2] - c2, q[3] + c2], [q[1] + c2, d.xR, q[2] - c2, q[3] + c2]].forEach(function (r) { if (r[1] - r[0] > 0.05 && r[3] - r[2] > 0.05) pSolid(P, (r[0] + r[1]) / 2, (r[2] + r[3]) / 2, r[1] - r[0], r[3] - r[2], D - 0.5, D); });
      // the pool: walls you cannot walk through (water to the coping), the coping as seats along the long sides
      pSolid(P, (q[0] + q[1]) / 2, (q[2] + q[3]) / 2, q[1] - q[0] + 0.1, q[3] - q[2] + 0.1, D - 1.3, D + 0.9);
      [0.3, -0.3].forEach(function (f, i) { var z = (q[2] + q[3]) / 2 + f * (q[3] - q[2]); var s = seatSolid(P, q[1] + 0.15, z, 0.34, 0.5, D + 0.05, -PI / 2); if (s) { s.pool = true; s.dmSuite = P; } }); }
    else pSolid(P, (d.xL + d.xR) / 2, (d.zB + d.zF) / 2, d.xR - d.xL, d.zF - d.zB, D - 0.5, D);
    for (var s = 1; s <= 3; s++) pSolid(P, 0, d.zF + 0.3 * (s - 0.5), 1.76, 0.32, D - dH - 0.3, D - (dH - 0.18) / 4 * s);
    // the railing (a gap for the steps)
    pSolid(P, (d.xL + d.xR) / 2, d.zB + 0.03, d.xR - d.xL, 0.12, D, rh); pSolid(P, d.xL + 0.03, (d.zB + d.zF) / 2, 0.12, d.zF - d.zB, D, rh); pSolid(P, d.xR - 0.03, (d.zB + d.zF) / 2, 0.12, d.zF - d.zB, D, rh);
    pSolid(P, (d.xL - 0.9) / 2, d.zF - 0.03, -0.9 - d.xL, 0.12, D, rh); pSolid(P, (d.xR + 0.9) / 2, d.zF - 0.03, d.xR - 0.9, 0.12, D, rh);
    // the dome wall: a ring of boxes inside the membrane (head height), open at the door portal; the door itself
    var n = 22, rw = R - 0.32; for (var i = 0; i < n; i++) { var a0 = i / n * TAU, a1 = (i + 1) / n * TAU, am = (a0 + a1) / 2; var x = Math.sin(am) * rw, z = Math.cos(am) * rw; if (z > 0 && Math.abs(x) < DOOR.hw + 0.25) continue; var len = 2 * rw * Math.sin(PI / n) + 0.12; pSolid(P, x, z, len, 0.3, D, D + 2.6, am); }
    var SH = buildShell(P.size, R); [-1, 1].forEach(function (sd) { pSolid(P, sd * (DOOR.hw + 0.12), (SH.zd + rw * Math.cos(Math.asin((DOOR.hw + 0.3) / rw))) / 2, 0.22, Math.max(0.3, SH.zd - rw * Math.cos(Math.asin((DOOR.hw + 0.3) / rw)) + 0.2), D, D + 2.4); });
    P.doorSolid = pSolid(P, 0, SH.zd - 0.04, 2 * DOOR.hw, 0.16, D, D + 2.3);
    // the hot tub (E sits you in the water), the fire bowl, the two chairs by it, the dining table and chairs
    var t = d.tub; pSolid(P, t[0], t[1], 2.0, 2.0, D, D + 1.02); pSolid(P, t[0], t[1] - 1.28, 0.9, 0.5, D, D + 0.36, 0); pSolid(P, t[0], t[1] - 1.0, 0.9, 0.5, D, D + 0.7, 0);
    [0, 1, 2].forEach(function (k) { var a = k / 3 * TAU + 0.6, sx = t[0] + Math.sin(a) * 0.55, sz = t[1] + Math.cos(a) * 0.55; var ts = pSolid(P, sx, sz, 0.5, 0.5, D + 0.1, D + 0.52); if (ts) { ts.seat = true; ts.face = P.rot + a + PI; ts.tub = true; ts.dmSuite = P; } });
    pSolid(P, d.fire[0], d.fire[1], 1.1, 1.1, D, D + 0.4);
    var E = P.cl.E; [0, 1].forEach(function (k) { var c = E.chairAt(P, k); var st = seatSolid(P, c[0], c[1], 0.7, 0.7, D + 0.38, c[2]); });
    var dn = d.dine; pSolid(P, dn[0], dn[1], 0.9, 1.6, D, D + 0.76); [[-0.85, -0.42, PI / 2], [-0.85, 0.42, PI / 2], [0.85, -0.42, -PI / 2], [0.85, 0.42, -PI / 2]].forEach(function (c) { seatSolid(P, dn[0] + c[0], dn[1] + c[1], 0.46, 0.44, D + 0.48, c[2]); });
    // the lounger behind the pool, the two potted agaves by the door
    if (d.pool0) { var lz0 = (d.zB + d.pool0[2]) / 2; seatSolid(P, (d.pool0[0] + d.pool0[1]) / 2, lz0 + 0.2, 0.7, 1.55, D + 0.4, PI); }
    [-1, 1].forEach(function (sd) { pSolid(P, sd * 1.25, R + 0.55, 0.52, 0.52, D, D + 0.5); });
    // the sun loungers, their side table, the planters at the back corners
    [1.9, 3.1].forEach(function (lx) { seatSolid(P, lx, d.zF - 1.75, 0.68, 1.6, D + 0.4, PI); }); pSolid(P, 2.5, d.zF - 2.6, 0.5, 0.5, D, D + 0.48); [[d.xL + 0.55, d.zB + 0.55], [d.xR - 0.55, d.zB + 0.55]].forEach(function (p) { pSolid(P, p[0], p[1], 0.72, 0.72, D, D + 1.6); });
  }
  function doorSolidOn(P, on) { var sd = P.doorSolid; if (!sd) return; var i = SOLIDS.indexOf(sd); if (on && i < 0) SOLIDS.push(sd); else if (!on && i >= 0) SOLIDS.splice(i, 1); }
  function vaultSolids(Vn) {
    var VG = Vn.VG, d = VG.d, V = VG.V, D = Vn.D, rh = D + 1.05, sg = 1.7, zg = VG.zg, c = VG.c;
    pSolid(Vn, (d.xL + d.xR) / 2, (d.zB + d.zF) / 2, d.xR - d.xL, d.zF - d.zB, D - 0.6, D);
    for (var s = 1; s <= 4; s++) pSolid(Vn, 0, d.zF + 0.3 * (s - 0.5), 2 * sg - 0.1, 0.32, D - d.dH - 0.3, D - (d.dH - 0.18) / 5 * s);
    pSolid(Vn, (d.xL + d.xR) / 2, d.zB + 0.03, d.xR - d.xL, 0.12, D, rh); pSolid(Vn, d.xL + 0.03, (d.zB + d.zF) / 2, 0.12, d.zF - d.zB, D, rh); pSolid(Vn, d.xR - 0.03, (d.zB + d.zF) / 2, 0.12, d.zF - d.zB, D, rh);
    pSolid(Vn, (d.xL - sg) / 2, d.zF - 0.03, -sg - d.xL, 0.12, D, rh); pSolid(Vn, (d.xR + sg) / 2, d.zF - 0.03, d.xR - sg, 0.12, D, rh);
    // the dome's sides: a run of boxes from inside the skin at head height out to the skirt (no walking into the membrane from
    // either side); under the hoods, the low corners of each arch; the glazed ends (the front door gap is the door)
    var n = 14; for (var i = 0; i < n; i++) { var za = -c + 2 * c * i / n, zb = -c + 2 * c * (i + 1) / n, zm = (za + zb) / 2, hood = Math.abs(zm) > zg;
      var xi = hood ? vHalf(V, c, 1.25) - 0.15 : Math.min(vHalf(V, za, 2.2), vHalf(V, zb, 2.2)) - 0.3, xo = Math.max(vHalf(V, za, 0), vHalf(V, zb, 0)) + 0.05; if (xo - xi < 0.1) continue;
      [-1, 1].forEach(function (sd) { pSolid(Vn, sd * (xi + xo) / 2, zm, xo - xi, zb - za + 0.06, D, D + 2.6); }); }
    var aw = vHalf(V, zg, 0.3); pSolid(Vn, 0, -zg, 2 * aw, 0.2, D, D + 2.6); [-1, 1].forEach(function (s2) { var x0 = VG.doorHW + 0.05; pSolid(Vn, s2 * (x0 + aw) / 2, zg, aw - x0, 0.2, D, D + 2.6); });
    Vn.doorSolid = pSolid(Vn, 0, zg + 0.02, 2 * VG.doorHW, 0.16, D, D + 2.6);
  }
  // ───────────────────────── furniture (R5): rounded, cushioned, turned and draped pieces, merged by base like everything else ─────────────────────────
  var RBC = DM.rbc = DM.old ? {} : (DM.rbc || {}), LTC = {}, CLT = {};
  // a rounded box (every edge and corner rounded with radius r, seg steps a quarter), uvs projected per face (t metres a repeat);
  // bulge pillows the two largest faces (a cushion: the middle rises, the edges stay tight)
  function rboxGeo(w, h, d, r, seg, bulge, t) {
    seg = seg || 1; r = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)); bulge = bulge || 0; t = t || 0.5;
    var key = [w, h, d, r, bulge].map(function (v) { return v.toFixed(3); }).join(",") + "," + seg + "," + t; var hit = RBC[key]; if (hit) return hit.clone();
    var n = 2 * seg + 1, g = new THREE.BoxGeometry(1, 1, 1, n, n, n), pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
    var co = function (hh) { var a = []; for (var k = 0; k <= seg; k++) a.push(-hh + r - r * Math.cos(k / seg * PI / 2)); for (var k2 = 0; k2 <= seg; k2++) a.push(hh - r + r * Math.sin(k2 / seg * PI / 2)); return a; };
    var CX = co(w / 2), CY = co(h / 2), CZ = co(d / 2), hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
    for (var i = 0; i < pa.count; i++) { var x = CX[Math.round((pa.getX(i) + 0.5) * n)], y = CY[Math.round((pa.getY(i) + 0.5) * n)], z = CZ[Math.round((pa.getZ(i) + 0.5) * n)];
      var qx = clamp(x, -hx, hx), qy = clamp(y, -hy, hy), qz = clamp(z, -hz, hz), vx = x - qx, vy = y - qy, vz = z - qz, L = Math.sqrt(vx * vx + vy * vy + vz * vz), nx = na.getX(i), ny = na.getY(i), nz = na.getZ(i);
      if (L > 1e-6) { nx = vx / L; ny = vy / L; nz = vz / L; x = qx + nx * r; y = qy + ny * r; z = qz + nz * r; }
      if (bulge) { var fx = clamp(x / (w / 2), -1, 1), fz = clamp(z / (d / 2), -1, 1), k3 = (1 - fx * fx) * (1 - fz * fz); y += bulge * k3 * (y / (h / 2)); if (Math.abs(ny) > 0.5) { var sg = ny > 0 ? 1 : -1; nx += sg * 4 * bulge * fx / w * (1 - fz * fz); nz += sg * 4 * bulge * fz / d * (1 - fx * fx); var l2 = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= l2; ny /= l2; nz /= l2; } }
      pa.setXYZ(i, x, y, z); na.setXYZ(i, nx, ny, nz);
      var ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz); if (ay >= ax && ay >= az) ua.setXY(i, x / t, z / t); else if (ax >= az) ua.setXY(i, z / t, y / t); else ua.setXY(i, x / t, y / t); }
    var out = g.toNonIndexed(); g.dispose(); RBC[key] = out; return out.clone();
  }
  // a turned shape from a profile [[r, y], ...] listed bottom to top (faces outward; top to bottom faces inward, a lining)
  function latheGeo(prof, seg) { var key = (seg || 16) + ":" + prof.map(function (q) { return q[0].toFixed(3) + "," + q[1].toFixed(3); }).join(";"); var hit = LTC[key]; if (hit) return hit.clone();
    var g = new THREE.LatheGeometry(prof.map(function (q) { return new THREE.Vector2(Math.max(0, q[0]), q[1]); }), seg || 16); var out = g.toNonIndexed(); g.dispose(); LTC[key] = out; return out.clone(); }
  // floor-length linen on a round table: the top, a soft roll over the edge, folds that deepen toward the floor
  function clothGeo(R, h, folds, seed) { var key = [R, h, folds, seed].join(","); if (CLT[key]) return CLT[key].clone(); var seg = 72, T = [0, 0.03, 0.09, 0.2, 0.36, 0.56, 0.78, 1], P = [], U = [], idx = [];
    for (var r = 0; r < T.length; r++) { var t = T[r], y = r === 0 ? h : h - 0.02 - (h - 0.03) * (t - 0.03) / 0.97; for (var i = 0; i <= seg; i++) { var th = i / seg * TAU, amp = r === 0 ? 0 : Math.pow(t, 1.25) * (0.03 + 0.024 * Math.sin(folds * th + seed) + 0.012 * Math.sin(folds * 2.3 * th + seed * 1.7)), rr = R + (r === 0 ? 0.004 : 0.022 + t * 0.03) + amp;
        P.push(Math.sin(th) * rr, y, Math.cos(th) * rr); U.push(th * R / 0.5, y / 0.5); } }
    for (var r2 = 0; r2 < T.length - 1; r2++) for (var i2 = 0; i2 < seg; i2++) { var a = r2 * (seg + 1) + i2, b = a + 1, cc = a + seg + 1, dd = cc + 1; idx.push(a, cc, b, b, cc, dd); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.setIndex(idx); g.computeVertexNormals();
    var top = new THREE.CircleGeometry(R + 0.004, seg); top.rotateX(-PI / 2); top.translate(0, h + 0.003, 0); var out = mergeGeos([g.toNonIndexed(), top.toNonIndexed()]); g.dispose(); top.dispose(); CLT[key] = out; return out.clone(); }
  // a pleated curtain in the x-y plane (its face +z), w wide and h tall, pleats every p metres
  function drapeGeo(w, h, p, amp) { var nx = Math.max(8, Math.round(w / p * 6)), ny = 5, P = [], U = [], idx = [];
    for (var j = 0; j <= ny; j++) { var y = h * j / ny; for (var i = 0; i <= nx; i++) { var x = -w / 2 + w * i / nx; P.push(x, y, amp * Math.sin(x / p * TAU) * (0.75 + 0.25 * j / ny)); U.push(x / 0.6, y / 0.6); } }
    for (var j2 = 0; j2 < ny; j2++) for (var i2 = 0; i2 < nx; i2++) { var a = j2 * (nx + 1) + i2, b = a + 1, c2 = a + nx + 1, d2 = c2 + 1; idx.push(a, b, c2, b, d2, c2); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.setIndex(idx); g.computeVertexNormals(); var out = g.toNonIndexed(); g.dispose(); return out; }
  // one piece in its own frame (x across, z toward its front, y up from y0), placed into a kit in the room frame
  function FP(K, x, z, yaw, y0) { yaw = yaw || 0; y0 = y0 || 0; var c = Math.cos(yaw), s = Math.sin(yaw); var f = { K: K, x: x, z: z, yaw: yaw, y0: y0 };
    f.w = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; };
    f.geo = function (key, g, lx, ly, lz, ry, rx, rz) { var p = f.w(lx, lz); return K.place(key, g, p[0], y0 + ly, p[1], yaw + (ry || 0), rx || 0, rz || 0); };
    f.box = function (key, w, h, d, lx, ly, lz, ry, rx, rz) { var g = new THREE.BoxGeometry(w, h, d); uvBox(g, w, h, d, 0.5); return f.geo(key, g, lx, ly, lz, ry, rx, rz); };
    f.rb = function (key, w, h, d, r, lx, ly, lz, o) { o = o || {}; return f.geo(key, rboxGeo(w, h, d, r, o.seg || 1, o.bulge || 0, o.t), lx, ly, lz, o.ry, o.rx, o.rz); };
    f.cyl = function (key, r0, r1, h, lx, ly, lz, seg, rx, rz, ry) { return f.geo(key, new THREE.CylinderGeometry(r0, r1, h, seg || 12, 1, false), lx, ly, lz, ry || 0, rx || 0, rz || 0); };
    f.lathe = function (key, prof, seg, lx, ly, lz, rx, rz) { return f.geo(key, latheGeo(prof, seg), lx, ly, lz, 0, rx || 0, rz || 0); };
    f.sph = function (key, r, lx, ly, lz, sx, sy, sz, seg) { var g = new THREE.SphereGeometry(r, seg || 10, Math.max(5, (seg || 10) >> 1)); if (sx || sy || sz) g.scale(sx || 1, sy || 1, sz || 1); return f.geo(key, g, lx, ly, lz); };
    f.rod = function (key, A, B, r, seg) { var a = f.w(A[0], A[2]), b = f.w(B[0], B[2]); return K.tube(key, V3(a[0], y0 + A[1], a[1]), V3(b[0], y0 + B[1], b[1]), r, seg || 6); };
    f.bar = function (key, A, B, wd, dp, nl) { var a = f.w(A[0], A[2]), b = f.w(B[0], B[2]), nn = nl || [0, 0, 1]; return K.beam(key, V3(a[0], y0 + A[1], a[1]), V3(b[0], y0 + B[1], b[1]), wd, dp, V3(nn[0] * c + nn[2] * s, nn[1], -nn[0] * s + nn[2] * c)); };
    return f; }
  // a registered model's parts merged into the kit under its own materials (base "m:kind:i" added to the bases), scaled to height h
  function modelK(K, B, kind, x, z, yaw, h, y0) { var m = null; try { m = MODELS[kind]; } catch (e) {} if (!m || m.proxy || !m.parts || !m.parts.length) return false; var s = h / Math.max(0.05, m.height || 1);
    if (K.inst) { (K.mi[kind] || (K.mi[kind] = [])).push(new THREE.Matrix4().compose(V3(x, y0 || 0, z), new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), yaw || 0), V3(s, s, s))); return s; }
    var M4 = new THREE.Matrix4().compose(V3(x, y0 || 0, z), new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), yaw || 0), V3(s, s, s));
    m.parts.forEach(function (part, i) { var key = "m:" + kind + ":" + i; B[key] = part.material; var g = part.geometry.clone(); for (var a in g.attributes) if (a !== "position" && a !== "normal" && a !== "uv") g.deleteAttribute(a); g.applyMatrix4(M4); K.add(key, g); }); return s; }

  function instKit() { var K = new Kit(); K.inst = true; K.mi = {}; return K; }
  function modelMeshes(K, g) { var n = 0; for (var kind in (K.mi || {})) { var m = MODELS[kind], list = K.mi[kind]; if (!m || !m.parts) continue; m.parts.forEach(function (part) { var im = new THREE.InstancedMesh(part.geometry, part.material, list.length); list.forEach(function (M4, i) { im.setMatrixAt(i, M4); }); im.name = "dm model " + kind; im.castShadow = false; im.receiveShadow = true; im.userData.noDispose = true; g.add(finish(im)); n++; }); } return n; }
  // a sofa (len across) facing +z: a plinth on tapered legs, rolled arms, a back, plump seat and back cushions, throw pillows
  function sofaK(K, x, z, yaw, o) { o = o || {}; var f = FP(K, x, z, yaw, o.y0), L = o.len || 2.2, Dp = o.d || 0.92, m = o.mat || "sofa", sg = o.lo ? 1 : 2, lg = o.leg === undefined ? 0.1 : o.leg, aw = o.arms === false ? 0 : (o.aw || 0.2), ih = L - 2 * aw, b0 = lg;
    f.rb(m, L, 0.2, Dp, 0.05, 0, b0 + 0.1, 0, { seg: sg });
    if (aw) [-1, 1].forEach(function (s) { f.rb(m, aw, 0.4, Dp, 0.085, s * (L / 2 - aw / 2), b0 + 0.36, 0, { seg: sg }); });
    f.rb(m, L - 0.02, 0.44, 0.2, 0.08, 0, b0 + 0.41, -Dp / 2 + 0.1, { seg: sg });
    var n = o.n || (ih > 1.7 ? 3 : ih > 1.0 ? 2 : 1), cw = ih / n; for (var i = 0; i < n; i++) { var cx = -ih / 2 + cw * (i + 0.5);
      f.rb(m, cw - 0.012, 0.15, Dp - 0.25, 0.06, cx, b0 + 0.275, 0.1, { seg: sg, bulge: 0.02 });
      f.rb(m, cw - 0.02, 0.16, 0.44, 0.07, cx, b0 + 0.6, -Dp / 2 + 0.27, { seg: sg, bulge: 0.028, rx: PI / 2 - 0.17 }); }
    if (!o.lo) (o.pil || ["throw", "linen"]).forEach(function (k, j) { var s = j % 2 ? 1 : -1; f.rb(k, 0.42, 0.13, 0.4, 0.06, s * (ih / 2 - 0.25), b0 + 0.56, -Dp / 2 + 0.43, { bulge: 0.035, rx: PI / 2 - 0.38, ry: s * 0.16 }); });
    if (lg > 0) [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { f.cyl(o.legMat || "walnut", 0.024, 0.015, lg, q[0] * (L / 2 - 0.08), lg / 2, q[1] * (Dp / 2 - 0.08), 8); });
    return f; }
  function armK(K, x, z, yaw, o) { o = Object.assign({ len: 0.9, n: 1, aw: 0.17, pil: o && o.pil ? o.pil : ["throw"] }, o || {}); return sofaK(K, x, z, yaw, o); }
  // a dining chair with a cross back (oak or walnut, a woven rattan seat) facing +z
  var PREFAB = DM.prefab = DM.old ? {} : (DM.prefab || {});
  function prefab(name, build) { if (PREFAB[name]) return PREFAB[name]; var K0 = new Kit(); build(K0); var out = {}; for (var k in K0.m) out[k] = mergeGeos(K0.m[k]); return (PREFAB[name] = out); }
  function putPrefab(K, pf, x, z, yaw, y0) { _e.set(0, yaw || 0, 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(x, y0 || 0, z), _q, _v2.set(1, 1, 1)); var M = _m4.clone(); for (var k in pf) K.add(k, pf[k].clone().applyMatrix4(M)); }
  function crossChairP(K, x, z, yaw, o) { o = o || {}; var w = o.wood || "oak", st = o.seat || "rattan"; putPrefab(K, prefab("cross:" + w + ":" + st, function (K0) { crossChairK(K0, 0, 0, 0, { wood: w, seat: st }); }), x, z, yaw); }
  function chiavariP(K, x, z, yaw) { putPrefab(K, prefab("chiavari", function (K0) { chiavariK(K0, 0, 0, 0, {}); }), x, z, yaw); }
  function stoolP(K, x, z, yaw, o) { o = o || {}; var st = o.seat || "leather"; putPrefab(K, prefab("stool:" + (o.back ? 1 : 0) + ":" + st, function (K0) { stoolK(K0, 0, 0, 0, { back: !!o.back, seat: st }); }), x, z, yaw); }
  function crossChairK(K, x, z, yaw, o) { o = o || {}; var f = FP(K, x, z, yaw), w = o.wood || "oak", sw = 0.45, sd = 0.44, sh = 0.46, zb = -sd / 2 + 0.01;
    [-1, 1].forEach(function (s) { f.box(w, 0.04, sh, 0.04, s * (sw / 2 - 0.025), sh / 2, sd / 2 - 0.025); f.box(w, 0.04, 0.9, 0.04, s * (sw / 2 - 0.025), 0.45, -sd / 2 + 0.035, 0, -0.05); f.box(w, 0.02, 0.06, sd - 0.07, s * (sw / 2 - 0.03), sh - 0.055, 0); f.box(w, 0.018, 0.022, sd - 0.07, s * (sw / 2 - 0.025), 0.15, 0); });
    f.rb(w, sw, 0.035, sd, 0.012, 0, sh, 0); f.rb(o.seat || "rattan", sw - 0.08, 0.025, sd - 0.08, 0.01, 0, sh + 0.018, 0.005);
    f.box(w, sw - 0.06, 0.06, 0.02, 0, sh - 0.055, sd / 2 - 0.035); f.box(w, sw - 0.06, 0.06, 0.02, 0, sh - 0.055, -sd / 2 + 0.045); f.box(w, sw - 0.06, 0.022, 0.018, 0, 0.15, 0);
    f.rb(w, sw + 0.01, 0.075, 0.03, 0.012, 0, 0.84, zb - 0.03, { rx: -0.05 }); f.box(w, sw - 0.06, 0.035, 0.022, 0, sh + 0.085, zb);
    f.bar(w, [-sw / 2 + 0.05, sh + 0.1, zb - 0.002], [sw / 2 - 0.05, 0.81, zb - 0.022], 0.034, 0.018); f.bar(w, [sw / 2 - 0.05, sh + 0.1, zb + 0.006], [-sw / 2 + 0.05, 0.81, zb - 0.014], 0.034, 0.018);
    return f; }
  // a Chiavari chair (gilded, slender splayed legs, stretchers, a spindle back) with an ivory seat pad, facing +z
  function chiavariK(K, x, z, yaw, o) { o = o || {}; var f = FP(K, x, z, yaw), m = o.mat || "gold", sh = 0.45, kz = function (y) { return -0.165 - Math.max(0, y - sh) * 0.07; };
    [-1, 1].forEach(function (s) { f.rod(m, [s * 0.185, 0, 0.18], [s * 0.172, sh, 0.165], 0.012, 6); f.rod(m, [s * 0.18, 0, -0.18], [s * 0.168, sh, kz(sh)], 0.012, 6); f.rod(m, [s * 0.168, sh, kz(sh)], [s * 0.16, 0.93, kz(0.93)], 0.011, 6); });
    [0.17, 0.31].forEach(function (y) { f.rod(m, [-0.178, y, 0.172], [0.178, y, 0.172], 0.006, 5); [-1, 1].forEach(function (s) { f.rod(m, [s * 0.178, y, 0.172], [s * 0.175, y, -0.172], 0.006, 5); }); }); f.rod(m, [-0.176, 0.24, -0.174], [0.176, 0.24, -0.174], 0.006, 5);
    f.rb(m, 0.39, 0.024, 0.36, 0.01, 0, sh, 0); f.rb(o.cush || "ivory", 0.37, 0.045, 0.34, 0.018, 0, sh + 0.032, 0.008, { bulge: 0.01 });
    [[0.6, 0.008], [0.72, 0.008], [0.92, 0.012]].forEach(function (q) { f.rod(m, [-0.162, q[0], kz(q[0])], [0.162, q[0], kz(q[0])], q[1], 6); });
    for (var i = -2; i <= 2; i++) { f.rod(m, [i * 0.054, 0.6, kz(0.6)], [i * 0.054, 0.72, kz(0.72)], 0.0055, 4); f.rod(m, [i * 0.054, 0.72, kz(0.72)], [i * 0.054, 0.92, kz(0.92)], 0.0055, 4); }
    return f; }
  // a bar stool: a padded round seat on four splayed legs with a foot ring (and a low back)
  function stoolK(K, x, z, yaw, o) { o = o || {}; var f = FP(K, x, z, yaw), h = o.h || 0.76, m = o.frame || "brass";
    f.lathe(o.seat || "leather", [[0, 0], [0.18, 0], [0.2, 0.015], [0.205, 0.05], [0.185, 0.072], [0.1, 0.082], [0, 0.084]], 20, 0, h - 0.07, 0);
    [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(function (q) { f.rod(m, [q[0] * 0.12, h - 0.07, q[1] * 0.12], [q[0] * 0.19, 0, q[1] * 0.19], 0.013, 6); });
    var tg = new THREE.TorusGeometry(0.225, 0.011, 6, 24); tg.rotateX(PI / 2); f.geo(m, tg, 0, 0.3, 0);
    if (o.back) { f.rb(o.seat || "leather", 0.36, 0.05, 0.2, 0.02, 0, h + 0.2, -0.17, { rx: PI / 2 - 0.12, bulge: 0.01 }); [-1, 1].forEach(function (s) { f.rod(m, [s * 0.12, h - 0.05, -0.14], [s * 0.13, h + 0.14, -0.18], 0.01, 5); }); }
    return f; }
  // a round table (walnut top, pedestal) or a square one on four legs; a setting on it
  function tableK(K, x, z, o) { o = o || {}; var f = FP(K, x, z, o.yaw || 0), h = o.h || 0.75, top = o.top || "walnut";
    if (o.round) { var r = o.r || 0.4; f.lathe(top, [[0, h - 0.04], [r - 0.012, h - 0.04], [r, h - 0.025], [r, h - 0.01], [r - 0.012, h], [0, h]], 32, 0, 0, 0); f.cyl(o.leg || "black", 0.035, 0.05, h - 0.04, 0, (h - 0.04) / 2, 0, 10); f.lathe(o.leg || "black", [[0, 0], [0.24, 0], [0.24, 0.012], [0.2, 0.03], [0, 0.035]], 20, 0, 0, 0); }
    else { var s = o.s || 0.9; f.rb(top, s, 0.045, o.d || s, 0.012, 0, h - 0.022, 0); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { f.box(o.leg || top, 0.05, h - 0.045, 0.05, q[0] * (s / 2 - 0.07), (h - 0.045) / 2, q[1] * ((o.d || s) / 2 - 0.07)); }); f.box(o.leg || top, s - 0.16, 0.07, 0.025, 0, h - 0.08, (o.d || s) / 2 - 0.07); f.box(o.leg || top, s - 0.16, 0.07, 0.025, 0, h - 0.08, -(o.d || s) / 2 + 0.07); }
    return f; }
  function settingK(f, lx, lz, y, face, R, wine) { var sx = Math.sin(face), sz = Math.cos(face); var px = lx + sx * 0.0, pz = lz;
    f.lathe("ceramic", [[0, 0], [0.11, 0], [0.135, 0.012], [0.14, 0.016], [0, 0.008]], 20, px, y, pz); f.box("napkin", 0.05, 0.012, 0.18, px + Math.cos(face) * 0.17, y + 0.008, pz - Math.sin(face) * 0.17, face);
    if (wine) f.lathe("glassB", [[0, 0], [0.035, 0], [0.004, 0.012], [0.004, 0.1], [0.03, 0.12], [0.036, 0.17], [0.03, 0.2]], 10, px - Math.cos(face) * 0.12 - sx * 0.1, y, pz + Math.sin(face) * 0.12 - sz * 0.1); }
  function candleK(f, lx, lz, y) { f.lathe("glassB", [[0, 0], [0.032, 0], [0.034, 0.08], [0.03, 0.085]], 10, lx, y, lz); f.cyl("lamp", 0.02, 0.02, 0.03, lx, y + 0.02, lz, 8); }
  function budVaseK(f, lx, lz, y, R) { f.lathe("glassB", [[0, 0], [0.025, 0], [0.03, 0.04], [0.012, 0.11], [0.014, 0.13]], 10, lx, y, lz); f.rod("leaf", [lx, y + 0.1, lz], [lx + 0.02, y + 0.22, lz], 0.003, 3); f.sph(R() < 0.5 ? "rose" : "flower", 0.03, lx + 0.02, y + 0.23, lz, 1, 0.8, 1, 8); }
  // a floor-length dressed round table (the linen reaches the floor), a centrepiece of flowers and candles, eight settings
  function weddingTableK(K, x, z, R, n, o) { o = o || {}; var f = FP(K, x, z, 0), h = 0.76, rnd = rng(Math.round(x * 31 + z * 97)); f.geo(o.cloth || "ivory", clothGeo(R, h, 9, x + z), 0, 0, 0);
    for (var i = 0; i < n; i++) { var a = i / n * TAU + PI / n; settingK(f, Math.sin(a) * (R - 0.2), Math.cos(a) * (R - 0.2), h + 0.006, a + PI, rnd, true); }
    f.lathe("gold", [[0, 0], [0.09, 0], [0.06, 0.02], [0.03, 0.09], [0.08, 0.12], [0, 0.12]], 14, 0, h, 0);
    for (var k = 0; k < 11; k++) { var a2 = k / 11 * TAU; f.sph(k % 3 ? "flower" : (k % 2 ? "rose" : "blush"), 0.06 + (k % 3) * 0.01, Math.cos(a2) * 0.1, h + 0.2 + (k % 2) * 0.05, Math.sin(a2) * 0.1, 1, 0.85, 1, 8); }
    for (var k2 = 0; k2 < 6; k2++) { var a3 = k2 / 6 * TAU + 0.3, lf = new THREE.SphereGeometry(1, 6, 4); lf.scale(0.03, 0.008, 0.11); lf.rotateX(-0.3); lf.rotateY(a3); f.geo("leaf", lf, Math.sin(a3) * 0.2, h + 0.15, Math.cos(a3) * 0.2); }
    [-1, 1].forEach(function (s) { candleK(f, s * 0.28, 0.14, h + 0.004); candleK(f, s * 0.3, -0.16, h + 0.004); }); return f; }
  // a bar counter (len along x) facing +z: a fluted walnut front, a stone top with an eased edge, a brass foot rail, a lit lip,
  // shelves on the bartender's side
  function barK(K, x, z, yaw, len, o) { o = o || {}; var f = FP(K, x, z, yaw), h = 1.06, dp = 0.6;
    f.box("walnut", len, h - 0.12, 0.05, 0, (h - 0.12) / 2 + 0.07, dp / 2 - 0.09); [-1, 1].forEach(function (s) { f.box("walnut", 0.05, h - 0.06, dp - 0.06, s * (len / 2 - 0.025), (h - 0.06) / 2, -0.03); }); f.box("black", len - 0.02, 0.07, 0.04, 0, 0.035, dp / 2 - 0.11);
    var nf = Math.max(8, Math.floor(len / 0.064)); for (var i = 0; i < nf; i++) f.cyl("walnut", 0.029, 0.029, h - 0.2, -len / 2 + 0.06 + i * (len - 0.12) / (nf - 1), 0.1 + (h - 0.2) / 2, dp / 2 - 0.05, 8);
    f.rb(o.top || "marble", len + 0.12, 0.05, dp + 0.16, 0.02, 0, h, 0.03); f.box("ledStrip", len - 0.12, 0.012, 0.02, 0, h - 0.04, dp / 2 + 0.05);
    f.rod("brass", [-len / 2 + 0.1, 0.2, dp / 2 + 0.17], [len / 2 - 0.1, 0.2, dp / 2 + 0.17], 0.024, 10); var nb = Math.max(1, Math.ceil(len / 1.2)); for (var b = 0; b <= nb; b++) { var bx = -len / 2 + 0.15 + (len - 0.3) * b / nb; f.rod("brass", [bx, 0.2, dp / 2 + 0.17], [bx, 0.2, dp / 2 - 0.04], 0.012, 6); }
    f.box("inox", len - 0.12, 0.03, dp - 0.2, 0, 0.84, -0.06); f.box("walnut", len - 0.12, 0.03, dp - 0.2, 0, 0.32, -0.06); f.box("black", len - 0.12, 0.02, dp - 0.15, 0, 0.02, -0.06);
    var R = rng(len * 100); for (var g2 = 0; g2 < Math.floor(len / 0.35); g2++) { var gx = -len / 2 + 0.25 + g2 * 0.33; f.lathe("glassB", [[0, 0], [0.035, 0], [0.04, 0.09], [0.042, 0.1]], 10, gx, 0.855, -0.12 + (g2 % 2) * 0.1); }
    if (o.dressing !== false) { f.lathe("inox", [[0, 0], [0.04, 0], [0.045, 0.14], [0.03, 0.18], [0.018, 0.2], [0, 0.21]], 12, len / 2 - 0.4, h + 0.025, -0.05); f.lathe("ceramic", [[0, 0], [0.06, 0], [0.12, 0.06], [0.125, 0.065]], 16, -len / 2 + 0.5, h + 0.025, 0.0); for (var l = 0; l < 6; l++) f.sph("green", 0.03, -len / 2 + 0.47 + (l % 3) * 0.03, h + 0.07 + (l >> 2) * 0.02, -0.02 + (l % 2) * 0.04, 1, 1, 1, 6); }
    return f; }
  var BOT = [[[0, 0], [0.037, 0], [0.038, 0.02], [0.038, 0.2], [0.03, 0.24], [0.013, 0.27], [0.012, 0.31], [0, 0.31]], [[0, 0], [0.042, 0], [0.043, 0.02], [0.043, 0.18], [0.036, 0.22], [0.015, 0.24], [0.015, 0.28], [0, 0.28]],
    [[0, 0], [0.032, 0], [0.05, 0.05], [0.05, 0.11], [0.03, 0.16], [0.012, 0.18], [0.012, 0.22], [0, 0.22]], [[0, 0], [0.045, 0], [0.047, 0.02], [0.047, 0.14], [0.03, 0.17], [0.014, 0.19], [0.014, 0.23], [0, 0.23]], [[0, 0], [0.03, 0], [0.031, 0.02], [0.031, 0.25], [0.02, 0.28], [0.01, 0.3], [0.01, 0.34], [0, 0.34]]];
  var BOTK = ["amber", "bottle", "wine", "gin", "amber", "glassB2", "amber", "wine"];
  function bottleK(f, lx, y, lz, R) { var i = Math.floor(R() * BOT.length), pr = BOT[i]; f.lathe(BOTK[Math.floor(R() * BOTK.length)], pr, 10, lx, y, lz); if (R() < 0.75) f.box("paper", pr[3][0] * 1.3, 0.06 + R() * 0.03, 0.004, lx, y + 0.06 + R() * 0.04, lz + pr[3][0] + 0.002); }
  // the back bar (len along x, its face +z): cabinets with brass pulls, a stone top, a lit mirror wall with glass shelves of bottles
  function backBarK(K, x, z, yaw, len, hTop) { var f = FP(K, x, z, yaw), dp = 0.5, H2 = Math.min(hTop || 2.4, 2.5), R = rng(Math.round(len * 77));
    f.rb("walnut", len, 0.86, dp, 0.015, 0, 0.43, 0); var nd = Math.max(2, Math.round(len / 0.6)); for (var i = 0; i < nd; i++) { var dx = -len / 2 + len * (i + 0.5) / nd; f.rb("walnut", len / nd - 0.03, 0.72, 0.024, 0.006, dx, 0.45, dp / 2 + 0.006); f.box("brass", 0.012, 0.16, 0.02, dx + (i % 2 ? -1 : 1) * (len / nd / 2 - 0.08), 0.62, dp / 2 + 0.026); }
    f.rb("marble", len + 0.04, 0.04, dp + 0.04, 0.01, 0, 0.88, 0); f.box("mirror", len - 0.1, H2 - 0.95, 0.02, 0, 0.9 + (H2 - 0.95) / 2, -dp / 2 + 0.03);
    [-1, 0, 1].forEach(function (k) { f.box("walnut", 0.05, H2 - 0.9, 0.3, k * (len / 2 - 0.03), 0.9 + (H2 - 0.9) / 2, -dp / 2 + 0.17); }); f.rb("walnut", len + 0.04, 0.09, 0.34, 0.02, 0, H2, -dp / 2 + 0.17);
    [1.28, 1.66, 2.04].filter(function (y) { return y < H2 - 0.25; }).forEach(function (y) { f.box("glassB", len - 0.12, 0.02, 0.26, 0, y, -dp / 2 + 0.17); f.box("ledStrip", len - 0.14, 0.01, 0.014, 0, y - 0.016, -dp / 2 + 0.29);
      var nb = Math.floor((len - 0.2) / 0.105); for (var b = 0; b < nb; b++) { var bx = -len / 2 + 0.12 + b * (len - 0.24) / Math.max(1, nb - 1); if (Math.abs(bx) < 0.06) continue; bottleK(f, bx, y + 0.012, -dp / 2 + 0.16, R); } });
    for (var b2 = 0; b2 < 9; b2++) bottleK(f, -len / 2 + 0.3 + b2 * 0.12 + (b2 > 4 ? len - 1.4 : 0), 0.9, -0.05, R);
    return f; }
  // pendant lights: a cord from the roof, a brass dome (lit inside), a rattan bell, or a glass globe
  function pendantK2(K, x, z, top, y, o) { o = o || {}; var f = FP(K, x, z, 0), st = o.style || "dome", m = o.mat || "brass"; if (top - y > 0.05) f.rod("cord", [0, top, 0], [0, y + 0.02, 0], 0.005, 4);
    if (st === "dome") { f.cyl(m, 0.025, 0.025, 0.06, 0, y, 0, 10); f.lathe(m, [[0.226, -0.24], [0.216, -0.19], [0.17, -0.1], [0.09, -0.03], [0.02, 0.0]], 20, 0, y, 0); f.lathe("lampShade", [[0.012, -0.012], [0.084, -0.042], [0.162, -0.105], [0.206, -0.19], [0.215, -0.235]], 20, 0, y, 0); f.sph("lamp", 0.045, 0, y - 0.17, 0); }
    else if (st === "globe") { f.cyl(m, 0.03, 0.03, 0.05, 0, y, 0, 10); f.sph("lamp", 0.13, 0, y - 0.15, 0, 1, 1, 1, 14); }
    else { var bell = []; for (var q = 0; q <= 9; q++) { var ph = q / 9 * PI / 2; bell.push([0.03 + 0.235 * Math.cos(ph), -0.34 + 0.34 * Math.sin(ph)]); } f.lathe("rattan", bell, 24, 0, y, 0); f.lathe("lampShade", bell.slice().reverse().map(function (p) { return [p[0] * 0.95, p[1] - 0.006]; }), 24, 0, y, 0); var rim = new THREE.TorusGeometry(0.262, 0.012, 6, 28); rim.rotateX(PI / 2); f.geo("rattan", rim, 0, y - 0.34, 0); f.sph("lamp", 0.05, 0, y - 0.22, 0); }
    return f; }
  function floorLampK(K, x, z, o) { o = o || {}; var f = FP(K, x, z, 0); f.lathe("black", [[0, 0], [0.16, 0], [0.165, 0.02], [0.03, 0.035], [0, 0.04]], 18, 0, 0, 0); f.rod(o.mat || "brass", [0, 0.03, 0], [0, 1.4, 0], 0.012, 6);
    f.lathe("linen", [[0.22, 1.32], [0.18, 1.62]], 22, 0, 0, 0); f.lathe("lampShade", [[0.175, 1.615], [0.214, 1.325]], 22, 0, 0, 0); f.sph("lamp", 0.04, 0, 1.4, 0); return f; }
  function tableLampK(K, x, z, y, o) { o = o || {}; var f = FP(K, x, z, 0, y); f.lathe(o.base || "ceramic", [[0, 0], [0.06, 0], [0.08, 0.06], [0.07, 0.16], [0.03, 0.22], [0.012, 0.24], [0, 0.24]], 16, 0, 0, 0); f.rod("brass", [0, 0.24, 0], [0, 0.32, 0], 0.006, 4);
    f.lathe("linen", [[0.14, 0.27], [0.11, 0.45]], 18, 0, 0, 0); f.lathe("lampShade", [[0.105, 0.445], [0.135, 0.275]], 18, 0, 0, 0); return f; }
  // rugs: one atlas of four designs (0 kilim, 1 a Persian medallion, 2 a Moroccan lattice, 3 a striped flatweave), laid flat
  function rugK(K, quad, w, d, x, z, yaw, y) { var g = new THREE.PlaneGeometry(w, d); g.rotateX(-PI / 2); var uv = g.attributes.uv, u0 = (quad % 2) * 0.5 + 0.006, v0 = (quad >> 1) * 0.5 + 0.006; for (var i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.488, v0 + uv.getY(i) * 0.488); K.place("rug", g, x, y || 0.016, z, yaw || 0); }
  // pots and plants: a turned pot (terracotta, white glaze, a woven basket or stone) with soil; an olive, a fiddle leaf fig, a bird of
  // paradise, a snake plant
  function potK(f, kind, r, h, lx, lz) { var key = kind === "white" ? "ceramic" : kind === "basket" ? "rattan" : kind === "stone" ? "concrete" : kind === "black" ? "black" : "terracotta";
    f.lathe(key, [[0, 0], [r * 0.76, 0], [r * 0.84, h * 0.08], [r, h * 0.9], [r * 1.05, h * 0.92], [r * 1.05, h], [r * 0.95, h], [r * 0.93, h * 0.9], [0, h * 0.9]], 18, lx, 0, lz); f.cyl("soil", r * 0.92, r * 0.92, 0.01, lx, h * 0.905, lz, 14); }
  function oliveK(K, x, z, h, o) { o = o || {}; var f = FP(K, x, z, 0), R = rng(Math.round(x * 131 + z * 17) + 7), pr = o.pr || 0.3, ph = o.ph || 0.55, tt = h * 0.5; potK(f, o.pot || "terra", pr, ph, 0, 0);
    [[0.03, 0.01, 0.1, 0.02], [-0.03, -0.02, -0.12, -0.05]].forEach(function (t, i) { f.rod("bark", [t[0], ph * 0.9, t[1]], [t[2], tt, t[3]], 0.035 - i * 0.01, 6); f.rod("bark", [t[2], tt, t[3]], [t[2] * 1.6, tt + 0.35, t[3] * 2], 0.02, 5); });
    for (var c = 0; c < 9; c++) { var a = c / 9 * TAU + R() * 0.5, rr = 0.18 + R() * 0.26, cy = tt + 0.3 + R() * Math.max(0.1, h - tt - 0.5); f.rod("bark", [Math.cos(a) * 0.05, tt + 0.25, Math.sin(a) * 0.05], [Math.cos(a) * rr, cy, Math.sin(a) * rr], 0.012, 4);
      for (var b = 0; b < 9; b++) { var g2 = new THREE.SphereGeometry(0.055 + R() * 0.05, 6, 4); g2.scale(1.5, 0.55, 1); g2.rotateY(R() * PI); g2.rotateZ((R() - 0.5) * 0.7); f.geo(["olive", "olive2", "leafO"][b % 3], g2, Math.cos(a) * rr + (R() - 0.5) * 0.3, cy + (R() - 0.5) * 0.24, Math.sin(a) * rr + (R() - 0.5) * 0.3); } }
    return f; }
  function figK(K, x, z, h, o) { o = o || {}; var f = FP(K, x, z, 0), R = rng(Math.round(x * 71 + z * 29) + 3), pr = o.pr || 0.24, ph = o.ph || 0.44; potK(f, o.pot || "white", pr, ph, 0, 0); f.rod("bark", [0, ph * 0.9, 0], [0.03, h * 0.92, 0.02], 0.02, 5);
    for (var i = 0; i < 18; i++) { var t = 0.3 + 0.7 * i / 18, a = i * 2.4, y = ph + (h - ph) * t, L = 0.16 + 0.07 * (1 - t) + R() * 0.04, g = new THREE.SphereGeometry(1, 8, 5); g.scale(L * 0.68, 0.012, L); g.rotateX(-0.45 + R() * 0.4); g.rotateY(a); f.geo(i % 3 ? "leaf" : "leafD", g, Math.sin(a) * (0.03 + L * 0.8), y, Math.cos(a) * (0.03 + L * 0.8)); }
    return f; }
  function paradiseK(K, x, z, h, o) { o = o || {}; var f = FP(K, x, z, 0), R = rng(Math.round(x * 53 + z * 41) + 5), pr = o.pr || 0.27, ph = o.ph || 0.48; potK(f, o.pot || "basket", pr, ph, 0, 0);
    for (var i = 0; i < 10; i++) { var a = i * 2.5 + R(), tl = 0.15 + R() * 0.35, sl = (h - ph) * (0.45 + R() * 0.3), top = [Math.sin(a) * Math.sin(tl) * sl, ph + Math.cos(tl) * sl, Math.cos(a) * Math.sin(tl) * sl]; f.rod("leafD", [0, ph * 0.9, 0], top, 0.011, 4);
      var g = new THREE.SphereGeometry(1, 8, 6); g.scale(0.1, 0.008, 0.3); g.rotateX(-PI / 2 + tl + 0.25); g.rotateY(a); f.geo("leaf", g, top[0] + Math.sin(a) * Math.sin(tl) * 0.28, top[1] + 0.27, top[2] + Math.cos(a) * Math.sin(tl) * 0.28); }
    return f; }
  function snakeK(K, x, z, h, o) { o = o || {}; var f = FP(K, x, z, 0), R = rng(Math.round(x * 23 + z * 61) + 9), pr = o.pr || 0.17, ph = o.ph || 0.32; potK(f, o.pot || "black", pr, ph, 0, 0);
    for (var i = 0; i < 11; i++) { var a = R() * TAU, r0 = R() * pr * 0.6, L = (h - ph) * (0.6 + R() * 0.4), g = new THREE.ConeGeometry(0.035, L, 4); g.scale(1, 1, 0.28); g.translate(0, L / 2, 0); g.rotateY(R() * PI); g.rotateZ((R() - 0.5) * 0.25); g.rotateX((R() - 0.5) * 0.25); f.geo(i % 2 ? "leaf" : "leafD", g, Math.cos(a) * r0, ph * 0.9, Math.sin(a) * r0); }
    return f; }
  function plantPick(K, kind, x, z, h, o) { return kind === "olive" ? oliveK(K, x, z, h, o) : kind === "fig" ? figK(K, x, z, h, o) : kind === "paradise" ? paradiseK(K, x, z, h, o) : snakeK(K, x, z, h, o); }
  // books on a table or shelf, a tray, a candle
  function booksK(f, lx, ly, lz, n, R, ry) { var y = ly; for (var i = 0; i < n; i++) { var w = 0.2 + R() * 0.08, d = 0.15 + R() * 0.05, t = 0.025 + R() * 0.02; f.rb(["linen", "throw", "velvetS", "paper", "velvetT"][Math.floor(R() * 5)], w, t, d, 0.004, lx + (R() - 0.5) * 0.03, y + t / 2, lz + (R() - 0.5) * 0.03, { ry: (ry || 0) + (R() - 0.5) * 0.3 }); y += t; } return y; }
  // a coffee table: a round walnut drum or an oval stone top on a plinth, with books, a bowl and a candle
  function coffeeK(K, x, z, yaw, o) { o = o || {}; var f = FP(K, x, z, yaw), R = rng(Math.round(x * 17 + z * 7)), h = o.h || 0.4;
    if (o.round) { var r = o.r || 0.45; f.lathe(o.mat || "walnut", [[0, 0], [r * 0.7, 0], [r * 0.72, h - 0.05], [r, h - 0.04], [r, h - 0.01], [r - 0.01, h], [0, h]], 32, 0, 0, 0); }
    else { var w = o.w || 1.15, d = o.d || 0.6; f.rb(o.mat || "walnut", w, 0.05, d, 0.02, 0, h - 0.025, 0, { seg: 2 }); f.rb(o.mat || "walnut", w - 0.3, h - 0.05, d - 0.25, 0.02, 0, (h - 0.05) / 2, 0); }
    booksK(f, -0.18, h, 0.02, 3, R, 0.2); f.lathe("ceramic", [[0, 0], [0.05, 0], [0.12, 0.05], [0.13, 0.06]], 16, 0.2, h, -0.04); candleK(f, 0.05, 0.14, h); return f; }

  // ───────────────────────── the walk-in Model Suite (built near, disposed far; one layout for every size, from suitePlan) ─────────────────────────
  // the interiors' parts by base (the textured interior bases; the colour is a vertex tint)
  var INT = { oak: ["iwood", "#ffffff"], walnut: ["iwalnut", "#ffffff"], podWall: ["iwood", "#f0d0a8"], bamboo: ["iwood", "#f4e0b8"], parquet: ["iwood", "#d8a878"], teak: ["iwood", "#c89868"],
    linen: ["ifabric", "#f7f3ea"], throw: ["ifabric", "#8a6f4e"], cloth: ["ifabric", "#fbf8f2"], towel: ["ifabric", "#f2efe8"], cushion: ["ifabric", "#e9dfcc"], fabric: ["ifabric", "#f2e6d0"], curtain: ["icurtain", "#f3ead9"],
    sofa: ["isofa", "#ffffff"], mat: ["isoft", "#7d8c6f"], mat2: ["isoft", "#b7856a"], rug: ["irug", "#ffffff"], marble: ["imarble", "#ffffff"], leather: ["ileather", "#6b4128"],
    black: ["idark", "#0c0c0d"], stove: ["idark", "#151517"], basalt: ["idark", "#2a2a2c"], speaker: ["idark", "#18181a"], metal: ["idark", "#0b0b0c"], strutD: ["idark", "#26282b"], wire: ["idark", "#141414"],
    chrome: ["ibright", "#dadde0"], inox: ["ibright", "#b9bcbf"], brass: ["ibright", "#d6a84e"], gold: ["ibright", "#dcb25a"], steel: ["ibright", "#a6abb0"],
    white: ["ipaint", "#f2f2ee"], ceramic: ["ipaint", "#f4f4f2"], chairW: ["ipaint", "#f5f2ec"], rib: ["ipaint", "#f2f0ea"],
    pot: ["isoft", "#9a6a48"], leaf: ["isoft", "#4f6a3a"], green: ["isoft", "#5f7a4a"], flower: ["isoft", "#f3e9e0"], rose: ["isoft", "#d7a1a0"],
    frostPane: ["ifrost", "#c8d0ce"], glassB: ["iglass", "#cfe0e6"], bottle: ["iglass", "#3a5a3a"], amber: ["iglass", "#7a4a14"],
    stone: ["isoft", "#d8ccba"], concrete: ["isoft", "#c2bbb0"], coping: ["isoft", "#efe4d2"], timber: ["iwood", "#8a6a4a"], deck: ["iwood", "#b08860"], post: ["iwood", "#5a4030"], cedar: ["iwood", "#c07a50"], corten: ["isoft", "#7a4022"], hub: ["ibright", "#9ea2a6"], band: ["idark", "#2c2d30"], beads: ["idark", "#1a1a1c"],
    lamp: ["iemit", "#ffc27a"], ledStrip: ["iemit", "#ffb460"], ember: ["iemit", "#ff5a14"], lampShade: ["iemit", "#ffb868"], bulb: ["iemit", "#ffc27a"],
    rattan: ["isoft", "#b08452"], cork: ["isoft", "#b98d5e"], jute: ["ifabric", "#c8ad84"], ivory: ["ifabric", "#f5efe3"], blush: ["ifabric", "#e8c9c0"], napkin: ["ifabric", "#ece4d6"], drape: ["icurtain", "#f6ecdc"], drapeF: ["ifabric", "#f6ecdc"], cord: ["iwalnut", "#3a2a20"], charcoalF: ["ifabric", "#4a4744"], jute2: ["ifabric", "#d8c7ac"],
    velvetS: ["isoft", "#7d8c69"], velvetT: ["isoft", "#a85f42"], velvetN: ["isoft", "#334055"], cream: ["isofa", "#f4ede1"], oat: ["isofa", "#d8c7ac"], charcoal: ["isofa", "#5d5955"],
    terracotta: ["isoft", "#b4643e"], olive: ["isoft", "#7f8c5c"], olive2: ["isoft", "#9aa47a"], leafO: ["isoft", "#5e6b45"], leafD: ["isoft", "#3f5a32"], soil: ["isoft", "#3b2b20"], bark: ["iwalnut", "#9a7a60"],
    paper: ["ipaint", "#efe7d6"], mirror: ["ibright", "#6e7378"], copper: ["ibright", "#c87a46"], wine: ["iemit", "#4a1018"], gin: ["iemit", "#6a8a84"], glassB2: ["iemit", "#8a9a96"], uplight: ["iglow", "#ffb35c"], washW: ["iglow", "#ffd9a8"] };
  INT.bottle = ["iemit", "#24402a"]; INT.amber = ["iemit", "#6a3a10"];
  var R_STAGE = 70, R_BUILD = 38, R_DROP = 95;
  // the wood stove (R5): a rounded black steel body on short legs, a framed glass door onto the fire, a cast top plate and collar, a
  // round stone hearth with an eased edge, a steel hoop of split logs beside it (its frame: the door faces +z)
  function stoveK(K, x, z, yaw) { var f = FP(K, x, z, yaw);
    f.lathe("stone", [[0, 0], [0.66, 0], [0.7, 0.02], [0.7, 0.045], [0.68, 0.06], [0, 0.06]], 36, 0, 0, 0.05);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { f.cyl("stove", 0.025, 0.02, 0.2, q[0] * 0.22, 0.16, q[1] * 0.16, 8); });
    f.rb("stove", 0.56, 0.6, 0.42, 0.05, 0, 0.56, -0.02, { seg: 2 }); f.rb("stove", 0.64, 0.04, 0.5, 0.015, 0, 0.88, -0.02); f.cyl("stove", 0.09, 0.1, 0.18, 0, 0.98, -0.02, 16);
    f.box("black", 0.36, 0.28, 0.005, 0, 0.58, 0.192); f.box("ember", 0.32, 0.06, 0.012, 0, 0.47, 0.196); [[0, 0.745, 0.46, 0.05], [0, 0.415, 0.46, 0.05]].forEach(function (q) { f.box("stove", q[2], q[3], 0.03, q[0], q[1], 0.205); }); [-1, 1].forEach(function (s2) { f.box("stove", 0.05, 0.28, 0.03, s2 * 0.205, 0.58, 0.205); });
    f.box("glassB", 0.36, 0.28, 0.006, 0, 0.58, 0.214); f.rod("chrome", [0.2, 0.5, 0.235], [0.2, 0.66, 0.235], 0.008, 6); f.rb("stove", 0.5, 0.05, 0.05, 0.015, 0, 0.32, 0.17);
    for (var lg = 0; lg < 5; lg++) { var row = lg < 3 ? 0 : 1, k = row ? lg - 3 : lg; f.cyl("bark", 0.045, 0.045, 0.36, 0.62 + (k - (row ? 0.5 : 1)) * 0.095, 0.105 + row * 0.08, 0.02, 8, PI / 2); }
    return f; }
  // the king bed (R5) in the bed frame (head at -z): a walnut platform on a shadow plinth, a deep mattress, a plump duvet folded
  // back, a throw at the foot, pillows and cushions, a channel-tufted headboard; nightstands with turned lamps
  function bedK(K, B, o) { o = o || {}; var f = FP(K, B.x, B.z, B.yaw), w = B.w, l = B.l, lo = !!o.lo;
    f.box("black", w - 0.3, 0.08, l - 0.3, 0, 0.04, 0); f.rb("walnut", w + 0.12, 0.24, l + 0.06, 0.02, 0, 0.2, 0, { seg: lo ? 1 : 2 }); f.rb("linen", w, 0.22, l - 0.12, 0.05, 0, 0.42, -0.02, { seg: lo ? 1 : 2 });
    f.rb("cloth", w + 0.08, 0.1, l - 0.62, 0.05, 0, 0.56, 0.24, { seg: lo ? 1 : 2, bulge: 0.025 }); f.rb("cloth", w + 0.08, 0.08, 0.32, 0.04, 0, 0.6, -l / 2 + 0.78, { seg: 1, bulge: 0.02 });
    f.rb("throw", w + 0.14, 0.035, 0.52, 0.015, 0, 0.625, l / 2 - 0.4, { seg: 1 });
    var hb = lo ? 1 : 6; for (var i = 0; i < hb; i++) { var pw = (w + 0.3) / hb; f.rb(o.head || "oat", pw - 0.01, 1.12, 0.12, lo ? 0.03 : 0.05, -(w + 0.3) / 2 + pw * (i + 0.5), 0.58, -l / 2 - 0.05, { seg: lo ? 1 : 2 }); }
    if (!lo) { [-0.47, 0.47].forEach(function (x) { f.rb("linen", 0.72, 0.16, 0.48, 0.07, x, 0.74, -l / 2 + 0.3, { seg: 2, bulge: 0.05, rx: 0.95 }); f.rb(x < 0 ? "velvetT" : "oat", 0.5, 0.13, 0.34, 0.06, x * 0.85, 0.7, -l / 2 + 0.55, { seg: 1, bulge: 0.04, rx: 0.75 }); }); f.rb("velvetS", 0.42, 0.12, 0.3, 0.05, 0, 0.68, -l / 2 + 0.72, { bulge: 0.035, rx: 0.6 }); }
    [-1, 1].forEach(function (sd) { var nx = sd * (w / 2 + 0.33), nz = -l / 2 + 0.25; f.rb("walnut", 0.46, 0.52, 0.4, 0.02, nx, 0.26, nz); if (!lo) { f.box("black", 0.4, 0.008, 0.005, nx, 0.36, nz + 0.2); f.box("brass", 0.1, 0.015, 0.02, nx, 0.42, nz + 0.205); var lw = f.w(nx, nz); tableLampK(K, lw[0], lw[1], 0.52, {}); } else f.cyl("lampShade", 0.11, 0.14, 0.22, nx, 0.75, nz, 12); });
    return f; }
  function* buildSteps(P) {
    var Mt = intMats(), Bs = intBases(), R = P.R, PL = suitePlan(P.size, R), SH = buildShell(P.size, R); var g = new THREE.Group(); g.name = "domes_interior " + P.id; g.position.set(P.x, P.D, P.z); g.rotation.y = P.rot; g.userData.noCull = true; g.userData.interior = true;
    var L = { P: P, g: g, solids: [], lights: [], hots: [], recl: [], seats: [] }; var K = instKit(), rnd = rng(P.x * 13 + P.z * 7);
    var so = function (lx, lz, w, d, y0, y1, ry) { var sd = pSolid(P, lx, lz, w, d, P.D + y0, P.D + y1, ry, L.solids); return sd; };
    var seat = function (lx, lz, w, d, y, face) { var sd = so(lx, lz, w, d, y - 0.4, y); if (sd) { sd.seat = true; sd.face = P.rot + face; L.seats.push(sd); } return sd; };
    var light = function (col, k, dist, lx, ly, lz, flick) { k *= 4.0; dist *= 1.3; var l = new THREE.PointLight(col, 0, dist, 1.4); l.position.set(lx, ly, lz); l.userData.k0 = k; l.userData.flick = !!flick; g.add(l); L.lights.push(l); return l; };
    var hot = function (lx, ly, lz, r, kind, d) { var w = l2w(P, lx, lz); var o = { x: w[0], y: P.D + ly, z: w[1], r: r, kind: kind, d: d || {} }; L.hots.push(o); return o; };
    var at = function (o, lx, lz) { var c = Math.cos(o.yaw), s = Math.sin(o.yaw); return [o.x + lx * c + lz * s, o.z - lx * s + lz * c]; };
    // ── the floor: wide oak boards, the kilim under the living room, a Moroccan lattice rug at the foot of the bed ──
    K.disc("oak", R - 0.05, 0, 0.02, 0, 48, 1.3); rugK(K, 0, PL.rug.w, PL.rug.d, PL.rug.x, PL.rug.z, 0, 0.026);
    var bf = at(PL.bed, 0, PL.bed.l / 2 + 0.55); rugK(K, 2, 1.7, 1.2, bf[0], bf[1], PL.bed.yaw, 0.026);
    yield 1;
    // ── the bathroom pod: oak-clad walls with a frosted door, a rain shower, a stone basin on a walnut vanity, a WC ──
    var pd = PL.pod, ph = pd.h, pw = pd.w, pdd = pd.d; var pW = function (lx, lz) { return at(pd, lx, lz); };
    [[0, -pdd / 2, pw, 0.08, 0], [-pw / 2, 0, 0.08, pdd, 0], [pw / 2, 0, 0.08, pdd, 0]].forEach(function (w) { var p = pW(w[0], w[1]); K.box("podWall", w[2], ph, w[3], p[0], ph / 2, p[1], pd.yaw, 1); so(p[0], p[1], w[2] + 0.04, w[3] + 0.04, 0, ph, pd.yaw); });
    var dw = 0.8, fx = 0.25; [[-pw / 2, fx - dw / 2], [fx + dw / 2, pw / 2]].forEach(function (s) { var cxw = (s[0] + s[1]) / 2, p = pW(cxw, pdd / 2); K.box("podWall", s[1] - s[0], ph, 0.08, p[0], ph / 2, p[1], pd.yaw, 1); so(p[0], p[1], s[1] - s[0], 0.12, 0, ph, pd.yaw); });
    var dh = pW(fx, pdd / 2); K.box("podWall", dw, ph - 2.05, 0.08, dh[0], 2.05 + (ph - 2.05) / 2, dh[1], pd.yaw, 1); var dg = pW(fx, pdd / 2 + 0.01); K.box("frostPane", dw - 0.06, 2.0, 0.03, dg[0], 1.02, dg[1], pd.yaw); so(dg[0], dg[1], dw, 0.1, 0, 2.05, pd.yaw);
    var rf = pW(0, 0); K.box("white", pw + 0.04, 0.06, pdd + 0.04, rf[0], ph + 0.03, rf[1], pd.yaw, 1);
    var sh = pW(-pw / 2 + 0.5, -0.1); K.box("basalt", 0.85, 0.05, 0.9, sh[0], 0.04, sh[1], pd.yaw, 1); var sr = pW(-pw / 2 + 0.5, 0.3); K.box("frostPane", 0.85, 1.9, 0.02, sr[0], 1.0, sr[1], pd.yaw); K.cyl("black", 0.015, 0.015, 2.05, sh[0], 1.02, sh[1], 8); K.cyl("black", 0.13, 0.13, 0.02, sh[0], 1.98, sh[1], 20);
    var vn = pW(pw / 2 - 0.45, -pdd / 2 + 0.28); FP(K, vn[0], vn[1], pd.yaw).rb("walnut", 0.62, 0.14, 0.42, 0.02, 0, 0.8, 0); FP(K, vn[0], vn[1], pd.yaw).lathe("basalt", [[0, 0], [0.1, 0], [0.16, 0.05], [0.17, 0.12], [0.15, 0.125], [0, 0.03]], 20, 0, 0.87, 0); var mi = pW(pw / 2 - 0.45, -pdd / 2 + 0.05); K.geo("chrome", new THREE.CircleGeometry(0.26, 28), mi[0], 1.45, mi[1], pd.yaw);
    var wc = pW(pw / 2 - 0.4, 0.15); FP(K, wc[0], wc[1], pd.yaw).rb("ceramic", 0.38, 0.4, 0.5, 0.08, 0, 0.2, 0, { seg: 2 }); var tw = pW(0.05, -pdd / 2 + 0.07); FP(K, tw[0], tw[1], pd.yaw).rb("towel", 0.45, 0.6, 0.05, 0.02, 0, 1.15, 0);
    var hp = pW(fx, pdd / 2 + 0.55); hot(hp[0], 1.0, hp[1], 1.3, "note", { key: "bath" }); light(0xfff0d8, 0.3, 3, pW(0, 0)[0], 1.9, pW(0, 0)[1], false);
    // the sleeping loft (L): on the pod, a queen bed under the curve, a black rail, an oak ladder
    if (PL.loft) { var lf = pW(0, -0.15); K.box("walnut", pw + 0.3, 0.12, pdd + 0.7, lf[0], ph + 0.1, lf[1], pd.yaw, 1); var mt = pW(0, -0.3); FP(K, mt[0], mt[1], pd.yaw + PI / 2).rb("linen", 1.55, 0.2, 2.0, 0.05, 0, ph + 0.26, 0, { seg: 2 }); FP(K, mt[0], mt[1], pd.yaw + PI / 2).rb("cloth", 1.6, 0.08, 1.4, 0.04, 0, ph + 0.39, 0.25, { bulge: 0.02 }); var tr = pW(0.5, -0.3); FP(K, tr[0], tr[1], pd.yaw + PI / 2).rb("throw", 0.5, 0.035, 1.66, 0.012, 0, ph + 0.44, 0);
      [-0.4, 0.4].forEach(function (o) { var pl = pW(-0.6, -0.3 + o); FP(K, pl[0], pl[1], pd.yaw).rb("linen", 0.36, 0.13, 0.55, 0.05, 0, ph + 0.42, 0, { bulge: 0.04 }); });
      var fr = pW(0, pdd / 2 + 0.18); K.box("black", pw + 0.3, 0.04, 0.04, fr[0], ph + 0.95, fr[1], pd.yaw); for (var i = 0; i <= 6; i++) { var rp = pW(-pw / 2 - 0.13 + (pw + 0.26) * i / 6, pdd / 2 + 0.18); K.box("black", 0.03, 0.8, 0.03, rp[0], ph + 0.55, rp[1], pd.yaw); }
      var ld = pW(pw / 2 + 0.25, pdd / 2 - 0.2); [-0.22, 0.22].forEach(function (o) { var lp = pW(pw / 2 + 0.25 + o, pdd / 2 - 0.2); K.box("oak", 0.05, ph + 1.0, 0.07, lp[0], (ph + 1.0) / 2, lp[1], pd.yaw, 1); }); for (var r2 = 1; r2 <= 7; r2++) K.box("oak", 0.46, 0.04, 0.05, ld[0], r2 * (ph / 7.4), ld[1], pd.yaw, 1);
      so(lf[0], lf[1], pw + 0.3, pdd + 0.7, ph, ph + 0.16, pd.yaw); so(fr[0], fr[1], pw + 0.3, 0.1, ph + 0.16, ph + 1.0, pd.yaw); so(ld[0], ld[1], 0.55, 0.2, 0, 1.0, pd.yaw);
      L.ladder = { lo: pW(pw / 2 + 0.25, pdd / 2 + 0.45), hi: pW(0.3, pdd / 2 - 0.25), y: ph + 0.16 }; hot(ld[0], 1.0, ld[1], 1.3, "ladder", {}); hot(mt[0], ph + 0.5, mt[1], 1.6, "note", { key: "loft" }); light(0xffd2a0, 0.3, 3.5, mt[0], ph + 1.2, mt[1], false);
      // head on the pillows, on the inner half of the mattress: keeps the eye a metre under the shell (the camera near plane is 0.5 m)
      var me = pW(-0.55, 0.2); L.recl.push({ kind: "bed", x: me[0], z: me[1], y: ph + 0.55, loft: true }); }
    yield 2;
    // ── the bed: platform, mattress, duvet, throw, pillows, a tufted headboard; nightstands with lamps; a leather bench at the foot ──
    var B = PL.bed, bW = function (lx, lz) { return at(B, lx, lz); }; var bc = bW(0, 0); bedK(K, B, {});
    [-1, 1].forEach(function (sd) { var nw = bW(sd * (B.w / 2 + 0.33), -B.l / 2 + 0.25); so(nw[0], nw[1], 0.46, 0.4, 0, 0.56); light(0xffc890, 0.32, 4, nw[0], 1.0, nw[1], false); });
    var bn = bW(0, B.l / 2 + 0.35), bnf = FP(K, bn[0], bn[1], B.yaw); bnf.rb("leather", 1.3, 0.1, 0.42, 0.04, 0, 0.45, 0, { bulge: 0.015, seg: 2 }); [-0.55, 0.55].forEach(function (o) { bnf.box("black", 0.03, 0.4, 0.36, o, 0.2, 0); }); bnf.box("black", 1.1, 0.02, 0.03, 0, 0.12, 0);
    var hb = bW(0, -B.l / 2 - 0.03); so(bc[0], bc[1], B.w + 0.12, B.l + 0.06, 0, 0.58, B.yaw); so(hb[0], hb[1], B.w + 0.3, 0.14, 0, 1.1, B.yaw); seat(bn[0], bn[1], 1.3, 0.4, 0.5, B.yaw + PI);
    // lying on the bed: head on the pillows, looking up through the skylight toward the glass front
    var hd = bW(0, -B.l / 2 + 0.45); L.recl.push({ kind: "bed", x: hd[0], z: hd[1], y: 0.95, foot: bW(0, B.l / 2) }); hot(bc[0], 0.6, bc[1], 1.9, "note", { key: "bed" });
    yield 3;
    // ── the living room: the boucle sofa (bed) facing the glass, cognac swivel chairs (or club chairs), a walnut coffee table, a lamp ──
    sofaK(K, PL.sofa.x, PL.sofa.z, 0, { len: PL.sofa.l, mat: "sofa", pil: ["velvetT", "linen", "velvetS"] });
    PL.arms.forEach(function (a) { if (!modelK(K, Bs, "lounge_chair", a.x, a.z, a.yaw, 0.85)) armK(K, a.x, a.z, a.yaw, { mat: "oat", pil: ["velvetT"] }); seat(a.x, a.z, 0.6, 0.6, 0.44, a.yaw); var bk = at(a, 0, -0.32); so(bk[0], bk[1], 0.8, 0.18, 0, 0.85, a.yaw); });
    for (var s3 = 0; s3 < 3; s3++) { var o3 = -PL.sofa.l / 2 + 0.2 + (PL.sofa.l - 0.4) * (s3 + 0.5) / 3; seat(PL.sofa.x + o3, PL.sofa.z + 0.06, 0.6, 0.62, 0.48, 0); } so(PL.sofa.x, PL.sofa.z - 0.38, PL.sofa.l, 0.22, 0, 0.85);
    var tb = PL.table; coffeeK(K, tb.x, tb.z, 0, { w: 1.15, d: 0.62, h: 0.4 }); so(tb.x, tb.z, 1.15, 0.62, 0, 0.43);
    var lp = PL.lamp; floorLampK(K, lp.x, lp.z, {}); so(lp.x, lp.z, 0.36, 0.36, 0, 1.6); light(0xffc890, 0.4, 4.5, lp.x, 1.5, lp.z, false);
    hot(PL.sofa.x, 0.6, PL.sofa.z + 0.9, 1.5, "note", { key: "living" });
    yield 4;
    // ── the wood stove on its stone hearth with a live fire, a hoop of logs; its flue up through the dome ──
    var stv = PL.stove, sW = function (lx, lz) { return at(stv, lx, lz); }; var sc = sW(0, 0); stoveK(K, stv.x, stv.z, stv.yaw);
    var fl = new THREE.Mesh((function () { var m = toNonIndexed(new THREE.PlaneGeometry(0.3, 0.24)); m.translate(0, 0.57, 0); return m; })(), mats().fire); var fp = sW(0, 0.199); fl.position.set(fp[0], 0, fp[1]); fl.rotation.y = stv.yaw; fl.renderOrder = 4; g.add(fl);
    var lb = sW(0.66, 0.0); so(sc[0], sc[1], 0.66, 0.54, 0, 1.0, stv.yaw); so(lb[0], lb[1], 0.4, 0.4, 0, 0.35); L.fireLight = light(0xff8a3a, 0.8, 6, sW(0, 0.5)[0], 0.8, sW(0, 0.5)[1], true); hot(sW(0, 0.9)[0], 0.6, sW(0, 0.9)[1], 1.3, "note", { key: "stove" });
    yield 5;
    // ── the kitchenette: walnut cabinets with brass pulls, a marble top, a sink and tap, a hob, a coffee machine, a shelf of jars ──
    var kt = PL.kitchen, kf = FP(K, kt.x, kt.z, kt.yaw), kW = function (lx, lz) { return at(kt, lx, lz); };
    kf.rb("walnut", kt.l, 0.84, 0.6, 0.012, 0, 0.44, 0); for (var d2 = 0; d2 < 4; d2++) { var dx = -kt.l / 2 + kt.l * (d2 + 0.5) / 4; kf.rb("walnut", kt.l / 4 - 0.02, 0.7, 0.02, 0.006, dx, 0.46, 0.305); kf.box("brass", 0.12, 0.012, 0.02, dx, 0.74, 0.325); }
    kf.rb("marble", kt.l + 0.04, 0.04, 0.64, 0.01, 0, 0.88, 0.0); kf.box("inox", 0.42, 0.02, 0.36, -kt.l / 2 + 0.45, 0.895, 0); kf.rod("chrome", [-kt.l / 2 + 0.45, 0.9, -0.22], [-kt.l / 2 + 0.45, 1.2, -0.22], 0.012, 8); kf.rod("chrome", [-kt.l / 2 + 0.45, 1.2, -0.22], [-kt.l / 2 + 0.45, 1.17, -0.05], 0.01, 8);
    kf.box("black", 0.5, 0.008, 0.42, kt.l / 2 - 0.45, 0.904, 0.02); kf.rb("inox", 0.26, 0.34, 0.3, 0.03, 0.05, 1.07, -0.12); kf.lathe("ceramic", [[0, 0], [0.035, 0], [0.042, 0.075], [0.044, 0.08]], 12, 0.05, 0.9, 0.08);
    [-1, 1].forEach(function (s2) { kf.rod("brass", [s2 * (kt.l / 2 - 0.08), 0.9, -0.22], [s2 * (kt.l / 2 - 0.08), 1.42, -0.22], 0.01, 6); }); kf.rb("walnut", kt.l - 0.1, 0.03, 0.2, 0.008, 0, 1.38, -0.22); for (var j2 = 0; j2 < 5; j2++) kf.lathe(j2 % 2 ? "glassB" : "ceramic", [[0, 0], [0.045, 0], [0.05, 0.02], [0.05, 0.13], [0.035, 0.145], [0.036, 0.16], [0, 0.16]], 12, -kt.l / 2 + 0.25 + j2 * (kt.l - 0.5) / 4, 1.395, -0.22);
    var kp = kW(kt.l / 2 - 0.15, -0.1); snakeK(K, kp[0], kp[1], 0.55, { pr: 0.1, ph: 0.18 }); kp = null;
    var kc = kW(0, 0); so(kc[0], kc[1], kt.l, 0.62, 0, 0.92, kt.yaw); light(0xffc890, 0.45, 4.5, kW(0, 0.9)[0], 2.1, kW(0, 0.9)[1], false); hot(kW(0, 0.9)[0], 0.9, kW(0, 0.9)[1], 1.4, "note", { key: "kitchen" });
    // ── dining: a round walnut table, cross-back chairs with rattan seats, a vase of flowers, a candle ──
    var dn = PL.dining; tableK(K, dn.x, dn.z, { round: true, r: 0.52, top: "walnut", leg: "walnut" }); var df = FP(K, dn.x, dn.z, 0); budVaseK(df, 0, 0.05, 0.752, rnd); candleK(df, 0.15, -0.1, 0.752);
    dn.chairs.forEach(function (a) { var r = a * PI / 180, cx = dn.x + Math.sin(r) * 0.78, cz = dn.z + Math.cos(r) * 0.78; crossChairP(K, cx, cz, r + PI, { wood: "walnut" }); seat(cx, cz, 0.46, 0.44, 0.49, r + PI); settingK(df, Math.sin(r) * 0.32, Math.cos(r) * 0.32, 0.752, r + PI, rnd, false); });
    so(dn.x, dn.z, 1.0, 1.0, 0, 0.77); hot(dn.x, 0.8, dn.z, 1.2, "note", { key: "dining" });
    if (PL.daybed) { var db = PL.daybed, dbf = FP(K, db.x, db.z, db.yaw); dbf.rb("walnut", 2.05, 0.28, 0.9, 0.02, 0, 0.16, 0); dbf.rb("cream", 1.95, 0.16, 0.82, 0.06, 0, 0.38, 0, { bulge: 0.02, seg: 2 }); dbf.rb("cream", 1.95, 0.16, 0.44, 0.07, 0, 0.62, -0.36, { bulge: 0.03, seg: 2, rx: PI / 2 - 0.15 }); [-0.6, 0.6].forEach(function (o) { dbf.rb(o < 0 ? "velvetT" : "linen", 0.45, 0.12, 0.32, 0.05, o, 0.62, -0.18, { bulge: 0.035, rx: PI / 2 - 0.4 }); });
      seat(db.x, db.z, 1.8, 0.7, 0.48, db.yaw); hot(db.x, 0.6, db.z, 1.4, "note", { key: "daybed" }); }
    yield 6;
    // ── the curtains (heavy linen, gathered at both edges of the glass), plants, a rattan pendant under the skylight, a bench by the door ──
    PL.curtains.forEach(function (c, ci) { var n = 9, P0 = []; for (var i = 0; i <= n; i++) { var off = (i - n / 2) * 0.075, wv = (i % 2 ? 0.06 : -0.06); P0.push([c.x + Math.cos(c.yaw) * off - Math.sin(c.yaw) * wv, c.z - Math.sin(c.yaw) * off - Math.cos(c.yaw) * wv]); }
      var pos = [], uvs = []; for (var i2 = 0; i2 < n; i2++) { var a = P0[i2], b = P0[i2 + 1]; var y0 = 0.03, y1 = c.h; [[a, y0], [b, y0], [b, y1], [a, y0], [b, y1], [a, y1]].forEach(function (v) { pos.push(v[0][0], v[1], v[0][1]); uvs.push(v[0][0] * 0.8, v[1] * 0.8); }); }
      var cg = new THREE.BufferGeometry(); cg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); cg.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2)); cg.computeVertexNormals(); K.add("curtain", cg); });
    PL.plants.forEach(function (p, i) { plantPick(K, ["fig", "olive", "paradise"][i % 3], p.x, p.z, i === 2 ? 1.5 : 1.8, { pot: ["white", "terra", "basket"][i % 3], pr: 0.24 }); so(p.x, p.z, 0.5, 0.5, 0, 1.2); });
    var py = R - 0.95; pendantK2(K, 0, 0, R - 0.05, py + 0.2, { style: "rattan" }); light(0xffc890, 0.55, 6.5, 0, py - 0.4, 0, false);
    var bp = [0.95, R - 0.95], bpf = FP(K, bp[0] + 0.3, bp[1] - 0.3, 0.6); bpf.rb("oak", 0.9, 0.05, 0.38, 0.015, 0, 0.45, 0); [-0.38, 0.38].forEach(function (o) { bpf.box("black", 0.03, 0.43, 0.32, o, 0.215, 0); });
    yield 7;
    var meshes = []; yield* buildBasedSteps(K, g, INT, Bs, meshes); modelMeshes(K, g);
    // the door: the Model Suite's own leaf on its hinge (shown with its shell while the interior stands)
    L.door = { piv: P.piv || new THREE.Group(), open: 0, target: 0, manual: false };
    scene.add(g); g.updateMatrixWorld(true); L.tris = Math.round(K.count());
    try { if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(g, { name: "domes interior" }); } catch (e) {}
    return L;
  }
  function buildInterior(P) { var it = buildSteps(P), r; do { r = it.next(); } while (!r.done); return r.value; }
  // while the real interior stands, the Model Suite leaves the instanced shells for its own set (shell, a moving leaf) and drops the
  // furnished look; when the interior goes, it returns
  function setFake(P, on) { var E = P.cl.E; if (!E) return; (E.inst[P.size] || []).forEach(function (m) { m.setMatrixAt(P.instI, on ? sMatrix(P) : _ZERO); m.instanceMatrix.needsUpdate = true; }); if (E.mset && P.model) E.mset.visible = !on; if (E.mfake && P.model) E.mfake.visible = on; if (on && P.piv) P.piv.rotation.y = 0; }
  function disposeInterior(P) { var L = P.L; if (!L) return; try { scene.remove(L.g); L.solids.forEach(function (sd) { var i = SOLIDS.indexOf(sd); if (i >= 0) SOLIDS.splice(i, 1); var j = DM.sol.indexOf(sd); if (j >= 0) DM.sol.splice(j, 1); }); L.g.traverse(function (o) { if (o.isMesh && o.geometry && !o.userData.noDispose) o.geometry.dispose(); if (o.isInstancedMesh && o.dispose) o.dispose(); }); } catch (e) { note("dispose", e); } P.L = null; setFake(P, true); doorSolidOn(P, true); DM.n.disposes++; }

  // ───────────────────────── the Grand Vault interiors, fitted to each use (built near, disposed far) ─────────────────────────
  // the string lights inside a vault: warm bulbs along every rib (and, in the hall, swags across under the crown), one instanced draw
  function vaultFairyPts(VG, extra) { var pts = []; (VG.ribs || []).forEach(function (rp) { var acc = 0.25; for (var i = 0; i < rp.length - 1; i++) { var a = rp[i], b = rp[i + 1], L = a.distanceTo(b), t = 0; while (acc + (L - t) >= 0.5) { t += 0.5 - acc; acc = 0; var q = a.clone().lerp(b, t / L); if (q.y > 2.2) pts.push(q.add(V3(0, -0.07, 0))); } acc += L - t; } });
    (extra || []).forEach(function (q) { pts.push(q); }); return pts; }
  function* buildVaultSteps(Vn) {
    var Mt = intMats(), B = intBases(), VG = Vn.VG, V = VG.V, d = VG.d, zg = VG.zg, use = Vn.use; var g = new THREE.Group(); g.name = "domes_vault_interior " + Vn.id; g.position.set(Vn.x, Vn.D, Vn.z); g.rotation.y = Vn.rot; g.userData.noCull = true; g.userData.interior = true;
    var L = { P: Vn, g: g, solids: [], lights: [], hots: [], seats: [] }; var K = instKit(), R = rng(Vn.i * 977 + 31);
    var so = function (lx, lz, w, dd, y0, y1, ry) { return pSolid(Vn, lx, lz, w, dd, Vn.D + y0, Vn.D + y1, ry, L.solids); };
    var seat = function (lx, lz, w, dd, y, face) { var sd = so(lx, lz, w, dd, y - 0.4, y); if (sd) { sd.seat = true; sd.face = Vn.rot + face; L.seats.push(sd); } return sd; };
    var light = function (col, k, dist, lx, ly, lz, flick) { k *= 4.0; dist *= 1.3; var l = new THREE.PointLight(col, 0, dist, 1.4); l.position.set(lx, ly, lz); l.userData.k0 = k; l.userData.flick = !!flick; g.add(l); L.lights.push(l); return l; };
    var hot = function (lx, ly, lz, r, kind, dd) { var w = l2w(Vn, lx, lz); var o = { x: w[0], y: Vn.D + ly, z: w[1], r: r, kind: kind, d: dd || {} }; L.hots.push(o); return o; };
    var roofAt = function (x, z) { return vRoof(V, x, z) - 0.3; };
    var halfW = function (z, y) { return vHalf(V, z, y) - 0.35; };
    var AMB = 0xff9a48, WARM = 0xffb066;
    var chairsAround = function (x, z, n, r, fn) { for (var c = 0; c < n; c++) { var a = c / n * TAU + PI / n, cx = x + Math.sin(a) * r, cz = z + Math.cos(a) * r; fn(cx, cz, a + PI); seat(cx, cz, 0.42, 0.42, 0.49, a + PI); } };
    yield 1;
    if (use === "restaurant") {
      // ── the bar along the west side, its fluted front to the room: six stools; the lit back bar against the curve behind ──
      var bz = -0.75, bl = 4.2, bx = -3.9; barK(K, bx, bz, PI / 2, bl, {}); so(bx - 0.03, bz, 0.7, bl + 0.12, 0, 1.1);
      for (var i = 0; i < 6; i++) { var sz = bz - bl / 2 + 0.42 + i * (bl - 0.84) / 5; stoolP(K, bx + 0.86, sz, -PI / 2, { back: true }); seat(bx + 0.86, sz, 0.42, 0.42, 0.8, -PI / 2); }
      var bbx = -(vHalf(V, bz, 2.45) - 0.3), bbTop = Math.min(2.45, vRoof(V, Math.abs(bbx) + 0.25, bz) - 0.12); backBarK(K, bbx, bz, PI / 2, bl - 0.2, bbTop); so(bbx, bz, 0.52, bl - 0.2, 0, bbTop);
      for (var p = 0; p < 3; p++) pendantK2(K, bx + 0.15, bz - bl / 2 + 0.7 + p * (bl - 1.4) / 2, roofAt(bx, bz), 2.25, { style: "dome" });
      light(WARM, 0.85, 7, bx + 0.7, 2.3, bz, false); light(AMB, 0.5, 4, bbx + 0.5, 1.6, bz, false); hot(bx + 1.4, 1.0, bz, 1.9, "note", { key: "bar" });
      yield 2;
      // ── the dining room: walnut four-tops and marble two-tops, cross-back chairs, a setting at every place, a candle and a bud
      // vase, a pendant over each table; the two-tops in the middle row by the window ──
      var tabs = [[-1.2, -1.9, 4], [-1.2, 0.5, 4], [-1.2, 2.9, 2], [1.3, -1.9, 2], [1.3, 0.5, 4], [1.3, 2.9, 4], [3.8, -1.9, 4], [3.8, 0.5, 2], [3.8, 2.9, 4]];
      tabs.forEach(function (t, ti) { var x = t[0], z = t[1], f = FP(K, x, z, 0);
        if (t[2] === 4) { tableK(K, x, z, { s: 0.86, top: "walnut", leg: "walnut" }); [0, PI / 2, PI, -PI / 2].forEach(function (a) { var cx = x + Math.sin(a) * 0.66, cz = z + Math.cos(a) * 0.66; crossChairP(K, cx, cz, a + PI, { wood: "walnut" }); seat(cx, cz, 0.44, 0.42, 0.49, a + PI); settingK(f, Math.sin(a) * 0.26, Math.cos(a) * 0.26, 0.752, a + PI, R, true); }); so(x, z, 0.9, 0.9, 0, 0.77); }
        else { tableK(K, x, z, { round: true, r: 0.38, top: "marble", leg: "brass" }); [PI / 2, -PI / 2].forEach(function (a) { var cx = x + Math.sin(a) * 0.62, cz = z + Math.cos(a) * 0.62; crossChairP(K, cx, cz, a + PI, { wood: "oak" }); seat(cx, cz, 0.44, 0.42, 0.49, a + PI); settingK(f, Math.sin(a) * 0.2, Math.cos(a) * 0.2, 0.752, a + PI, R, true); }); so(x, z, 0.78, 0.78, 0, 0.77); }
        candleK(f, 0.06, -0.05, 0.752); budVaseK(f, -0.07, 0.06, 0.752, R); pendantK2(K, x, z, roofAt(x, z), 2.2, { style: ti % 3 === 1 ? "rattan" : "dome", mat: ti % 2 ? "copper" : "brass" }); });
      light(WARM, 0.9, 9, 1.3, 2.9, 0.5, false); light(WARM, 0.7, 8, 3.8, 2.7, -0.7, false);
      yield 3;
      // ── the open kitchen across the back: the pass (stainless top, heat lamps over plates), the line behind it, a chalkboard menu ──
      var kz = -zg + 1.6, kw = Math.min(6.4, 2 * halfW(kz, 1.5) - 1.6), kx = 0.5; barK(K, kx, kz, 0, kw, { top: "inox", dressing: false }); so(kx, kz, kw, 0.7, 0, 1.1);
      for (var hl = 0; hl < 5; hl++) { var hx = kx - kw / 2 + 0.5 + hl * (kw - 1.0) / 4; pendantK2(K, hx, kz + 0.05, roofAt(hx, kz), 1.62, { style: "globe", mat: "inox" }); var pf = FP(K, hx, kz + 0.1, 0); pf.lathe("ceramic", [[0, 0], [0.12, 0], [0.14, 0.012], [0.145, 0.016], [0, 0.008]], 18, 0, 1.085, 0); }
      var lz = kz - 1.1, lw = kw - 0.6; FP(K, kx, lz, 0).rb("inox", lw, 0.9, 0.5, 0.02, 0, 0.45, 0); FP(K, kx, lz, 0).box("black", lw - 0.2, 0.012, 0.42, 0, 0.906, 0); for (var pt = 0; pt < 4; pt++) { var lf = FP(K, kx - lw / 2 + 0.5 + pt * (lw - 1.0) / 3, lz, 0); lf.lathe(pt % 2 ? "inox" : "copper", [[0, 0], [0.13, 0], [0.135, 0.15], [0.14, 0.16], [0, 0.155]], 16, 0, 0.91, 0); }
      FP(K, kx, lz - 0.15, 0).box("inox", lw, 0.03, 0.3, 0, 1.55, 0); for (var pl = 0; pl < 10; pl++) FP(K, kx - lw / 2 + 0.3 + pl * (lw - 0.6) / 9, lz - 0.15, 0).cyl("ceramic", 0.12, 0.12, 0.02 + (pl % 3) * 0.02, 0, 1.58, 0, 16);
      so(kx, lz, lw, 0.5, 0, 0.95);
      var ck = chalkTex("mesquite", Vn.name, (C("rooms.menu", [])[2] || "").split(" · ").slice(0, 6)); var cm = std({ map: ck, roughness: 0.9 }); var cq = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.15), cm); var ex = 3.6, ez = zg - 0.8; cq.position.set(ex, 1.18, ez + 0.03); g.add(cq); L.extraMats = [cm];
      var ef = FP(K, ex, ez, 0); [-1, 1].forEach(function (s) { ef.box("walnut", 0.04, 1.7, 0.04, s * 0.5, 0.85, 0.05, 0, -0.08); ef.box("walnut", 0.04, 1.6, 0.04, s * 0.5, 0.8, -0.32, 0, 0.18); }); ef.box("walnut", 1.0, 1.25, 0.03, 0, 1.18, 0.0); so(ex, ez, 1.1, 0.5, 0, 1.7);
      light(0xfff0d8, 0.7, 6, kx, 2.4, kz - 0.4, false); hot(kx, 1.0, kz + 1.3, 1.9, "note", { key: "menu" });
      yield 4;
      // ── the host stand by the door; the lounge in the front corner: a leather divan, two cognac swivel chairs, a round walnut
      // table on a Persian rug, a floor lamp; olive trees, a fiddle leaf fig ──
      var hs = FP(K, 2.0, zg - 1.05, 0); hs.rb("walnut", 0.62, 1.08, 0.46, 0.02, 0, 0.54, 0); hs.box("brass", 0.64, 0.02, 0.48, 0, 1.09, 0); tableLampK(K, 1.85, zg - 1.0, 1.1, { base: "brass" }); so(2.0, zg - 1.05, 0.62, 0.46, 0, 1.15);
      var lx = -3.75, lzc = 3.45; rugK(K, 1, 2.0, 2.7, lx, lzc, 0, 0.016);
      if (!modelK(K, B, "cab_divan", lx - 1.0, lzc, PI / 2, 0.71)) sofaK(K, lx - 1.0, lzc, PI / 2, { len: 2.1, mat: "leather", pil: ["oat", "velvetT"] }); so(lx - 1.0, lzc, 0.75, 2.1, 0, 0.75, PI / 2); [-0.6, 0, 0.6].forEach(function (o) { seat(lx - 0.95, lzc + o, 0.6, 0.6, 0.47, PI / 2); });
      [[1.05, -0.65, -PI / 2 - 0.35], [1.05, 0.65, -PI / 2 + 0.35]].forEach(function (q) { var cx = lx + q[0], cz = lzc + q[1]; if (!modelK(K, B, "lounge_chair", cx, cz, q[2], 0.85)) armK(K, cx, cz, q[2], { mat: "leather", pil: ["oat"] }); seat(cx, cz, 0.6, 0.6, 0.46, q[2]); });
      coffeeK(K, lx, lzc, 0, { round: true, r: 0.42, h: 0.4 }); so(lx, lzc, 0.85, 0.85, 0, 0.42); floorLampK(K, lx - 1.15, lzc - 1.35, {}); so(lx - 1.15, lzc - 1.35, 0.36, 0.36, 0, 1.6); light(AMB, 0.55, 5, lx, 2.2, lzc, false);
      [[5.15, -3.2, "olive", 2.3], [-3.7, -3.5, "olive", 2.1], [5.3, 3.85, "fig", 1.9]].forEach(function (q) { plantPick(K, q[2], q[0], q[1], q[3], { pot: q[2] === "olive" ? "terra" : "white", pr: 0.3 }); so(q[0], q[1], 0.6, 0.6, 0, 1.4); });
      hot(lx, 0.8, lzc, 1.6, "note", { key: "bar" });
    } else if (use === "hall") {
      // ── the stage before the back glass: a skirted platform, an ivory drape with side legs, a row of amber uplights washing it,
      // a lighting truss with spots, speakers on stands, a DJ booth, a microphone ──
      var sz0 = -zg + 0.25, sz1 = -zg + 2.35, sw = 7.4, szc = (sz0 + sz1) / 2, st = FP(K, 0, szc, 0);
      st.rb("walnut", sw, 0.45, sz1 - sz0, 0.015, 0, 0.225, 0); st.geo("charcoalF", drapeGeo(sw, 0.43, 0.16, 0.018), 0, 0.0, (sz1 - sz0) / 2 + 0.03); st.box("brass", sw, 0.025, 0.03, 0, 0.44, (sz1 - sz0) / 2 + 0.01);
      for (var s1 = 1; s1 <= 2; s1++) FP(K, -sw / 2 + 1.0, sz1 + 0.3 * (3 - s1), 0).rb("walnut", 1.4, 0.15 * s1, 0.3, 0.01, 0, 0.075 * s1, 0); so(0, szc, sw, sz1 - sz0, 0, 0.45); for (var s2 = 1; s2 <= 2; s2++) so(-sw / 2 + 1.0, sz1 + 0.3 * (3 - s2), 1.4, 0.32, 0, 0.15 * s2);
      var dz = sz0 - 0.02, dw = 7.0, dTop = Math.min(4.3, arcY(VG.arcB, dw / 2) - 0.2), dH2 = dTop - 0.45; FP(K, 0, dz, 0, 0.45).geo("drapeF", drapeGeo(dw, dH2, 0.32, 0.07), 0, 0, 0); [-1, 1].forEach(function (s) { FP(K, s * (dw / 2 - 0.35), dz + 0.14, 0, 0.45).geo("drapeF", drapeGeo(1.0, dH2 + 0.05, 0.14, 0.09), 0, 0, 0); });
      FP(K, 0, dz + 0.06, 0).rod("black", [-dw / 2, dTop + 0.03, 0], [dw / 2, dTop + 0.03, 0], 0.025, 8);
      for (var u = 0; u < 8; u++) { var ux = -3.15 + u * 0.9, uf = FP(K, ux, dz + 0.42, 0, 0.45); uf.cyl("black", 0.07, 0.08, 0.14, 0, 0.07, 0, 12); uf.cyl("lamp", 0.055, 0.055, 0.01, 0, 0.145, 0.0, 12, -0.35); var wq = new THREE.PlaneGeometry(1.15, 3.2); uf.geo("uplight", wq, 0, 1.45, -0.3); }
      yield 1;
      var tz = sz1 + 0.15, tyy = Math.min(4.2, roofAt(0, tz) - 0.4), tf = FP(K, 0, tz, 0); [[0, 0], [0, -0.3], [-0.26, -0.15]].forEach(function (q) { tf.rod("black", [-3.9, tyy + q[0], q[1]], [3.9, tyy + q[0], q[1]], 0.024, 6); }); for (var tq = 0; tq < 16; tq++) { var tx0 = -3.9 + tq * 0.49, tx1 = tx0 + 0.49; tf.rod("black", [tx0, tyy, 0], [tx1, tyy - 0.26, -0.15], 0.009, 4); tf.rod("black", [tx0, tyy, -0.3], [tx1, tyy - 0.26, -0.15], 0.009, 4); }
      [-3.3, -1.1, 1.1, 3.3].forEach(function (x) { var sp = FP(K, x, tz - 0.15, 0); sp.rod("black", [0, tyy - 0.26, 0], [0, tyy - 0.45, 0], 0.012, 4); sp.cyl("black", 0.09, 0.07, 0.24, 0, tyy - 0.58, 0.04, 12, 0.6); sp.cyl("lamp", 0.07, 0.07, 0.012, 0, tyy - 0.67, -0.03, 12, 0.6); [-1, 1].forEach(function (k) { tf.rod("black", [x + k * 0.6, tyy, -0.15], [x + k * 0.6, roofAt(x, tz) + 0.25, -0.15], 0.006, 4); }); });
      [-1, 1].forEach(function (s) { var sp2 = FP(K, s * 3.45, sz1 + 0.45, -s * 0.25); [0, 1, 2].forEach(function (k) { var a = k / 3 * TAU; sp2.rod("black", [0, 1.15, 0], [Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45], 0.012, 5); }); sp2.rod("black", [0, 1.15, 0], [0, 1.45, 0], 0.02, 6); sp2.rb("black", 0.42, 0.68, 0.38, 0.03, 0, 1.8, 0); sp2.cyl("speaker", 0.12, 0.12, 0.02, 0, 1.68, 0.19, 16, PI / 2); so(s * 3.45, sz1 + 0.45, 0.6, 0.6, 0, 2.1); });
      var dj = FP(K, 2.2, szc + 0.1, 0, 0.45); dj.rb("ivory", 1.7, 0.95, 0.62, 0.03, 0, 0.475, 0); dj.rb("black", 1.75, 0.05, 0.66, 0.01, 0, 0.97, 0); dj.box("black", 0.36, 0.02, 0.26, -0.4, 1.0, -0.02, 0, -0.15); dj.box("black", 0.36, 0.02, 0.26, 0.4, 1.0, -0.02, 0, -0.15); dj.box("ledStrip", 1.6, 0.02, 0.02, 0, 0.93, 0.32); so(2.2, szc + 0.1, 1.75, 0.66, 0.45, 1.45);
      var mic = FP(K, -0.5, sz1 - 0.45, 0, 0.45); mic.lathe("black", [[0, 0], [0.14, 0], [0.14, 0.012], [0.02, 0.03], [0, 0.03]], 16, 0, 0, 0); mic.rod("black", [0, 0.03, 0], [0, 1.4, 0], 0.01, 5); mic.rod("black", [0, 1.4, 0], [0, 1.52, 0.12], 0.008, 4); mic.sph("black", 0.035, 0, 1.54, 0.14, 1, 1.3, 1, 8);
      hot(-0.5, 1.0, sz1 + 0.8, 1.7, "note", { key: "stage" }); light(AMB, 1.0, 9, 0, 3.0, szc + 0.5, false); light(0xffa04a, 0.6, 6, 0, 1.4, dz + 1.2, false);
      yield 1;
      // ── the parquet dance floor with a brass inlay under a ring chandelier of candle bulbs ──
      var df = 5.4, dfd = 4.6, dfz = -1.2; K.flat("parquet", -df / 2, dfz - dfd / 2, df / 2, dfz + dfd / 2, 0.025, true, 0.6); [[0, dfz - dfd / 2, df, 0.06], [0, dfz + dfd / 2, df, 0.06], [-df / 2, dfz, 0.06, dfd], [df / 2, dfz, 0.06, dfd]].forEach(function (b) { K.box("brass", b[2], 0.02, b[3], b[0], 0.03, b[1], 0); });
      var chY = Math.min(4.4, roofAt(0, dfz) - 1.3), cf = FP(K, 0, dfz, 0); var tor = new THREE.TorusGeometry(1.25, 0.05, 8, 40); tor.rotateX(PI / 2); cf.geo("walnut", tor, 0, chY, 0); var tor2 = new THREE.TorusGeometry(0.8, 0.035, 8, 32); tor2.rotateX(PI / 2); cf.geo("brass", tor2, 0, chY + 0.35, 0);
      for (var cb = 0; cb < 16; cb++) { var ca = cb / 16 * TAU; cf.cyl("ivory", 0.018, 0.018, 0.12, Math.sin(ca) * 1.25, chY + 0.1, Math.cos(ca) * 1.25, 6); cf.sph("lamp", 0.03, Math.sin(ca) * 1.25, chY + 0.19, Math.cos(ca) * 1.25, 1, 1.5, 1, 6); if (cb % 4 === 0) cf.rod("brass", [Math.sin(ca) * 1.25, chY, Math.cos(ca) * 1.25], [0, roofAt(0, dfz) + 0.2, 0], 0.005, 4); if (cb % 2 === 0) cf.rod("brass", [Math.sin(ca) * 1.25, chY, Math.cos(ca) * 1.25], [Math.sin(ca) * 0.8, chY + 0.35, Math.cos(ca) * 0.8], 0.006, 4); }
      light(WARM, 1.1, 10, 0, chY - 0.3, dfz, false);
      yield 2;
      // ── round tables of eight in floor-length ivory linen, gilded Chiavari chairs, a centrepiece of roses with candles, round the floor ──
      [[-5.2, -2.0], [5.2, -2.0], [-5.2, 1.4], [5.2, 1.4], [-3.3, 4.4], [3.3, 4.4]].forEach(function (t, ti) { var x = t[0], z = t[1]; weddingTableK(K, x, z, 0.9, 8, {}); so(x, z, 1.8, 1.8, 0, 0.77); chairsAround(x, z, 8, 1.25, function (cx, cz, a) { chiavariP(K, cx, cz, a); }); });
      light(WARM, 0.8, 9, -5.0, 3.0, 0.0, false); light(WARM, 0.8, 9, 5.0, 3.0, 0.0, false); light(WARM, 0.7, 8, 0, 3.0, 4.4, false);
      yield 3;
      // ── the drinks bar in the back corner beside the stage, stools; olive trees and plants in the front corners ──
      var hbx = -5.2, hbz = -4.85; barK(K, hbx, hbz, PI / 2, 1.9, {}); so(hbx - 0.03, hbz, 0.7, 2.0, 0, 1.1); var hb2 = FP(K, hbx - 0.95, hbz, PI / 2); hb2.rb("walnut", 1.7, 0.86, 0.42, 0.015, 0, 0.43, 0); for (var gb = 0; gb < 12; gb++) hb2.lathe("glassB", BOT[gb % BOT.length], 10, -0.75 + gb * 0.135, 0.86, -0.05); so(hbx - 0.95, hbz, 0.42, 1.7, 0, 0.9);
      [-0.5, 0.4].forEach(function (o) { stoolP(K, hbx + 0.86, hbz + o, -PI / 2, { seat: "velvetN" }); seat(hbx + 0.86, hbz + o, 0.42, 0.42, 0.8, -PI / 2); }); pendantK2(K, hbx + 0.1, hbz, roofAt(hbx, hbz), 2.3, { style: "dome" }); light(AMB, 0.5, 4, hbx + 0.6, 2.0, hbz, false);
      [[5.6, -4.9, "olive", 2.5, "white"], [-6.25, 4.55, "fig", 2.0, "white"], [6.35, 3.4, "paradise", 2.0, "white"]].forEach(function (q) { plantPick(K, q[2], q[0], q[1], q[3], { pot: q[4], pr: 0.32 }); so(q[0], q[1], 0.66, 0.66, 0, 1.4); });
    } else {
      // ── the studio: the teacher's mat at the back facing the room, singing bowls and candles on a low stand, eight student mats in
      // two rows with bolsters and cork blocks; the tea bar along the west side; floor cushions round a low table; plants everywhere ──
      var mats0 = ["velvetS", "mat2", "jute2", "velvetT"]; var mat = function (x, z, yaw, mk) { var f = FP(K, x, z, yaw); f.rb(mk, 0.61, 0.008, 1.83, 0.003, 0, 0.012, 0); f.cyl(mk, 0.045, 0.045, 0.61, 0, 0.05, -0.93, 14, 0, PI / 2); var bo = new THREE.CapsuleGeometry(0.1, 0.42, 4, 12); bo.rotateZ(PI / 2); f.geo("linen", bo, 0, 0.11, -0.66);
        [-1, 1].forEach(function (s) { f.rb("cork", 0.15, 0.1, 0.23, 0.015, s * 0.42, 0.05, -0.55 + s * 0.03, { ry: s * 0.3 }); }); return f; };
      var tm = mat(0, -zg + 0.95, PI / 2, "mat"); seat(0, -zg + 0.95, 0.5, 0.5, 0.14, 0); var bs = FP(K, 0, -zg + 0.35, 0); bs.rb("walnut", 1.3, 0.3, 0.34, 0.02, 0, 0.15, 0); [-0.42, -0.1, 0.25].forEach(function (x, k) { bs.lathe("brass", [[0, 0], [0.05, 0], [0.11 - k * 0.015, 0.06], [0.12 - k * 0.015, 0.075 - k * 0.008], [0.11 - k * 0.015, 0.072 - k * 0.008]], 18, x, 0.3, 0); }); candleK(bs, 0.5, 0.02, 0.3); candleK(bs, 0.58, -0.06, 0.3);
      so(0, -zg + 0.35, 1.3, 0.34, 0, 0.35); var zf = FP(K, 1.3, -zg + 0.95, 0); zf.lathe("velvetT", [[0, 0], [0.19, 0], [0.22, 0.04], [0.21, 0.1], [0.17, 0.14], [0, 0.15]], 18, 0, 0, 0);
      [[-0.45, 4], [1.55, 4]].forEach(function (rw, ri) { for (var m = 0; m < rw[1]; m++) { var x = (ri ? -1.47 : -2.2) + m * 1.47; if (Math.abs(x) + 0.35 > halfW(rw[0] + 0.9, 0.1)) continue; mat(x, rw[0], PI, mats0[(m + ri) % 4]); seat(x, rw[0] - 0.2, 0.5, 0.6, 0.12, PI); } });
      hot(0, 0.5, 0.5, 2.2, "note", { key: "mats" }); light(0xffe2bc, 0.75, 7, 0, 2.6, 0, false);
      yield 2;
      var tbx = -(halfW(0.2, 1.6) - 0.05), tz0 = -1.4, tz1 = 1.6, tzc = (tz0 + tz1) / 2, tl = tz1 - tz0; var tb = FP(K, tbx, tzc, PI / 2);
      tb.rb("oak", tl, 0.88, 0.55, 0.02, 0, 0.44, 0); for (var sl = 0; sl < Math.floor(tl / 0.09); sl++) tb.box("oak", 0.06, 0.8, 0.012, -tl / 2 + 0.06 + sl * 0.09, 0.44, 0.28); tb.rb("walnut", tl + 0.06, 0.04, 0.6, 0.012, 0, 0.9, 0.0);
      for (var tp = 0; tp < 3; tp++) { var px = -tl / 2 + 0.45 + tp * 0.95; tb.lathe(tp === 1 ? "copper" : "ceramic", [[0, 0], [0.06, 0], [0.095, 0.05], [0.09, 0.1], [0.05, 0.14], [0.025, 0.15], [0.022, 0.165], [0, 0.17]], 16, px, 0.92, 0.05); tb.rod(tp === 1 ? "copper" : "ceramic", [px + 0.08, 0.97, 0.05], [px + 0.16, 1.05, 0.05], 0.012, 6); var hg = new THREE.TorusGeometry(0.05, 0.009, 6, 14, PI); hg.rotateZ(-PI / 2); tb.geo(tp === 1 ? "copper" : "ceramic", hg, px - 0.09, 1.0, 0.05);
        for (var cu = 0; cu < 3; cu++) tb.lathe("ceramic", [[0, 0], [0.028, 0], [0.04, 0.05], [0.042, 0.055]], 12, px + 0.08 + cu * 0.1, 0.92, -0.12); }
      [-1, 1].forEach(function (s) { tb.rod("brass", [s * (tl / 2 - 0.1), 0.92, -0.22], [s * (tl / 2 - 0.1), 1.62, -0.22], 0.012, 6); }); tb.rb("walnut", tl - 0.1, 0.03, 0.22, 0.01, 0, 1.6, -0.17); for (var jr = 0; jr < 9; jr++) tb.lathe("glassB", [[0, 0], [0.045, 0], [0.05, 0.02], [0.05, 0.13], [0.035, 0.145], [0.036, 0.16], [0, 0.16]], 12, -tl / 2 + 0.25 + jr * (tl - 0.5) / 8, 1.615, -0.17); tb.cyl(jr % 3 ? "cork" : "leafO", 0.042, 0.042, 0.08, -tl / 2 + 0.25 + jr * (tl - 0.5) / 8, 1.66, -0.17, 10);
      so(tbx, tzc, 0.6, tl, 0, 0.96); light(0xffd9a8, 0.5, 5, tbx + 0.7, 2.0, tzc, false); hot(tbx + 1.0, 0.9, tzc, 1.6, "note", { key: "tea" });
      var lt = FP(K, -2.55, 2.65, 0); lt.rb("walnut", 0.8, 0.06, 0.5, 0.015, 0, 0.3, 0); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { lt.box("walnut", 0.04, 0.27, 0.04, q[0] * 0.34, 0.135, q[1] * 0.2); }); lt.lathe("ceramic", [[0, 0], [0.05, 0], [0.08, 0.04], [0.075, 0.08], [0.03, 0.11], [0, 0.115]], 14, 0.1, 0.33, 0); so(-2.55, 2.65, 0.8, 0.5, 0, 0.34);
      [[-2.55, 2.05, 0, "velvetT"], [-2.55, 3.25, PI, "jute2"], [-3.25, 2.65, PI / 2, "velvetS"]].forEach(function (q) { FP(K, q[0], q[1], q[2]).rb(q[3], 0.55, 0.12, 0.55, 0.05, 0, 0.06, 0, { bulge: 0.025, seg: 2 }); seat(q[0], q[1], 0.5, 0.5, 0.15, q[2]); });
      yield 3;
      [[3.5, -2.3, "paradise", 2.0], [3.65, 0.55, "snake", 1.1], [-3.5, -2.45, "olive", 1.9], [1.9, -zg + 0.45, "fig", 1.7], [-1.9, -zg + 0.45, "snake", 1.0], [3.55, 2.6, "fig", 1.5], [-1.0, 3.0, "snake", 0.9]].forEach(function (q, i) { plantPick(K, q[2], q[0], q[1], q[3], { pot: ["basket", "white", "terra"][i % 3], pr: q[3] > 1.4 ? 0.27 : 0.18 }); so(q[0], q[1], 0.5, 0.5, 0, 1.2); });
      [[-1.2, 0.6], [1.2, 0.6], [0, -1.6]].forEach(function (q) { pendantK2(K, q[0], q[1], roofAt(q[0], q[1]), 2.6, { style: "rattan" }); }); light(AMB, 0.5, 6, 0, 2.3, 1.5, false);
      rugK(K, 3, 1.6, 2.2, -2.55, 2.65, PI / 2, 0.014);
    }
    yield 4;
    var extra = []; if (use === "hall") { for (var r = 0; r < 4; r++) { var z0 = [-3.0, -0.4, 2.2, 4.6][r], hw0 = halfW(z0, 3.4) - 0.2, n2 = 34; for (var q = 1; q < n2; q++) { var t2 = q / n2, x2 = -hw0 + 2 * hw0 * t2; extra.push(V3(x2, Math.min(roofAt(x2, z0) - 0.25, 4.9) - 0.75 * Math.sin(t2 * PI), z0)); } } }
    vaultFairyPts(VG, extra).forEach(function (q) { K.sph("bulb", 0.032, q.x, q.y, q.z, 1, 6); }); L.fairyN = extra.length;
    var meshes = []; yield* buildBasedSteps(K, g, INT, B, meshes); modelMeshes(K, g);
    scene.add(g); g.updateMatrixWorld(true); L.tris = Math.round(K.count());
    try { if (window.PLAN_PERF && PLAN_PERF.warmGroup) PLAN_PERF.warmGroup(g, { name: "domes vault interior" }); } catch (e) {}
    return L;
  }
  function buildVaultInterior(Vn) { var it = buildVaultSteps(Vn), r; do { r = it.next(); } while (!r.done); return r.value; }
  function disposeVault(Vn) { var L = Vn.L; if (!L) return; try { scene.remove(L.g); L.solids.forEach(function (sd) { var i = SOLIDS.indexOf(sd); if (i >= 0) SOLIDS.splice(i, 1); var j = DM.sol.indexOf(sd); if (j >= 0) DM.sol.splice(j, 1); }); L.g.traverse(function (o) { if (o.isMesh && o.geometry && !o.userData.noDispose) o.geometry.dispose(); if (o.isInstancedMesh && o.dispose) o.dispose(); }); (L.extraMats || []).forEach(function (m) { m.dispose(); }); } catch (e) { note("vdispose", e); } Vn.L = null; vaultFakes(); DM.n.vdisposes++; }

  // ───────────────────────── every frame: the night look, near / far, lights, doors, interiors, steam, staff ─────────────────────────
  var STEAM = { pool: [], t: 0 };
  function steamFrame(dt, n) {
    var cam = camera.position; if (!STEAM.g) { STEAM.g = new THREE.Group(); STEAM.g.name = "domes_steam"; STEAM.g.userData.noCull = true; scene.add(STEAM.g); for (var i = 0; i < 18; i++) { var sp = new THREE.Sprite(MX.steam.clone()); sp.visible = false; sp.userData.t = Math.random(); STEAM.g.add(sp); STEAM.pool.push(sp); } }
    var near = SITE.suites.map(function (P) { var w = l2w(P, P.dd.tub[0], P.dd.tub[1]); return { P: P, x: w[0], z: w[1], d: Math.hypot(w[0] - cam.x, w[1] - cam.z) }; }).filter(function (o) { return o.d < 60; }).sort(function (a, b) { return a.d - b.d; }).slice(0, 3);
    STEAM.pool.forEach(function (sp, i) { var o = near[Math.floor(i / 6)]; if (!o) { sp.visible = false; return; } var u = sp.userData; u.t += dt * (0.15 + (i % 5) * 0.025); if (u.t > 1) { u.t -= 1; u.ox = (Math.random() - 0.5) * 1.2; u.oz = (Math.random() - 0.5) * 1.2; }
      var t = u.t; sp.visible = true; sp.position.set(o.x + (u.ox || 0) + Math.sin(t * 3 + i) * 0.15, o.P.D + 1.0 + t * 1.5, o.z + (u.oz || 0)); var s = 0.45 + t * 1.5; sp.scale.set(s, s, 1); sp.material.opacity = Math.sin(t * PI) * (0.06 + 0.09 * n); });
  }
  function sgMode() { var SG = window.PLAN_STARGAZE; return SG && SG.mode ? SG.mode : null; }
  function nearestModel() { var best = null, bd = 1e9, px = player.position.x, pz = player.position.z; SITE.suites.forEach(function (P) { if (!P.model) return; var d = Math.hypot(P.x - px, P.z - pz); if (d < bd) { bd = d; best = P; } }); return best ? { P: best, d: bd } : null; }
  function nearestVault() { var best = null, bd = 1e9, px = player.position.x, pz = player.position.z; SITE.vaults.forEach(function (V) { var d = Math.hypot(V.x - px, V.z - pz) - V.w / 2; if (d < bd) { bd = d; best = V; } }); return best ? { P: best, d: bd } : null; }
  function interiorFrame() {
    var flying = typeof FLY !== "undefined" && FLY.on; var stepFn = function (it, near) { if (window.PLAN_PERF && PLAN_PERF.step && !near) return PLAN_PERF.step(it); var q; do { q = it.next(); } while (!q.done); return q; };
    // one build at a time (a suite or a vault), the nearest first
    var nm = nearestModel(), nv = nearestVault();
    if (!IN.sb && !flying) { var cand = []; if (nm && !nm.P.L && nm.d < R_STAGE) cand.push(nm); if (nv && !nv.P.L && nv.d < R_STAGE) cand.push(nv); SITE.vaults.forEach(function (V) { if (!V.L && Math.hypot(V.x - player.position.x, V.z - player.position.z) - V.w / 2 < 12 && V !== (nv && nv.P)) cand.push({ P: V, d: 1e3 }); }); cand.sort(function (a, b) { return a.d - b.d; });
      var c0 = cand[0]; if (c0) IN.sb = { P: c0.P, it: c0.P.vault ? buildVaultSteps(c0.P) : buildSteps(c0.P), t0: nowMs() }; }
    if (IN.sb) { var P = IN.sb.P, r; var dn = Math.hypot(P.x - player.position.x, P.z - player.position.z) - (P.vault ? P.w / 2 : P.R) < R_BUILD; try { r = stepFn(IN.sb.it, dn); } catch (e) { note("build", e); IN.sb = null; return; }
      if (r && r.done) { P.L = r.value; if (P.vault) { DM.n.vbuilds++; vaultFakes(); } else { DM.n.builds++; setFake(P, false); } DM.n.lastBuildMs = Math.round(nowMs() - IN.sb.t0); IN.sb = null; } }
    var mode = sgMode();
    SITE.suites.forEach(function (P) { if (!P.L) return; var d = Math.hypot(P.x - player.position.x, P.z - player.position.z); if (d > R_DROP && !(mode && mode.on && mode.spot && mode.spot.dome === P)) disposeInterior(P); });
    SITE.vaults.forEach(function (V) { if (!V.L) return; var d = Math.hypot(V.x - player.position.x, V.z - player.position.z) - V.w / 2; if (d > R_DROP || (V !== (nv && nv.P) && d > 30)) disposeVault(V); });
  }
  function doorFrame(P, dt) {
    var L = P.L; if (!L || !L.door) return; var D = L.door; var SH = buildShell(P.size, P.R); var w = l2w(P, 0, SH.zd + 0.2); var dd = Math.hypot(player.position.x - w[0], player.position.z - w[1]), dy = Math.abs(player.position.y - P.D);
    if (!D.manual) D.target = dd < 2.6 && dy < 1.6 ? 1 : dd > 4.2 ? 0 : D.target; D.open += clamp(D.target - D.open, -dt * 1.6, dt * 1.6); D.piv.rotation.y = -ease(D.open) * 1.5; doorSolidOn(P, D.open < 0.45); if (D.manual && dd > 9) D.manual = false;
  }
  function vaultDoorFrame(V, dt) {
    var D = V.door; if (!D) return; var w = l2w(V, 0, V.VG.zg + 0.4); var dd = Math.hypot(player.position.x - w[0], player.position.z - w[1]), dy = Math.abs(player.position.y - V.D);
    if (!D.manual) D.target = dd < 3.4 && dy < 1.8 ? 1 : dd > 5.5 ? 0 : D.target; var o0 = D.open; D.open += clamp(D.target - D.open, -dt * 1.3, dt * 1.3); if (D.open !== o0 || !D.set) { D.set = true; var e = ease(D.open) * 1.45; V.leaves[0].rotation.y = -e; V.leaves[1].rotation.y = PI + e; } doorSolidOn(V, D.open < 0.5); if (D.manual && dd > 12) D.manual = false;
  }
  // the vaults' furnished look: the merged set without the vault whose real interior stands
  function vaultFakes() { var S = SITE; if (!S || !S.vfake) return; var X = S.vaults.filter(function (V) { return V.L; })[0]; for (var k in S.vfake) S.vfake[k].visible = X ? k === X.id : k === "all"; }
  var FR = DM.fr = { t: 0, staff: false };
  function frameHook(dt, now) {
    if (DM.off || !SITE || !DM.ready) return; dt = Math.min(dt || 0.016, 0.1);
    try {
      // the lamps come on at dusk (full well before full night): every glow below follows this, not the raw night factor
      var n = clamp((nightK() - 0.02) * 3.2, 0, 1), mode = sgMode(), lying = !!(mode && mode.on && mode.spot && mode.spot.dome); U.uNight.value = n; U.uTime.value = (U.uTime.value + dt) % 10000; U.uDim.value = lying ? 0.6 : 1; var dim = U.uDim.value;
      var cam = camera.position, gk = n * dim;
      MX.glowV.opacity = 0.32 * gk; MX.fpaint.emissiveIntensity = MX.fsoft.emissiveIntensity = 0.28 * gk; MX.emit.emissiveIntensity = 0.22 + 2.8 * gk; MX.bulb.emissiveIntensity = 0.25 + 3.0 * gk; MX.water.emissiveIntensity = 0.5 + 1.3 * n; MX.fire.uniforms.uAmp.value = 0.75 + 0.25 * n;
      (EX.signMats || []).forEach(function (m) { m.emissiveIntensity = 0.12 + 0.75 * n; }); var inV = vaultAt(cam.x, cam.z, cam.y - 1.5); if (MX.vliner) MX.vliner.emissiveIntensity = 0.03 + (inV ? 0.3 : 0.75) * gk; if (MX.vskin) MX.vskin.emissiveIntensity = 0.55 * gk; if (IN.fairy) IN.fairy.emissiveIntensity = 0.8 + 2.2 * gk; U.uWarm.value = 0.2 * gk; if (IN.bases) { IN.bases.iglow.opacity = 0.3 + 0.55 * gk; IN.bases.iemit.emissiveIntensity = 1.1 + 0.9 * gk; }MX.membrane.emissiveIntensity = 0.05 * gk;
      var t = U.uTime.value;
      // clusters: near detail, small parts, far stand-ins, pooled lights
      EX.cl.forEach(function (E) { var dc = Math.max(0, Math.hypot(cam.x - E.cx, cam.z - E.cz) - E.r); var nearV = dc < 320; E.near.visible = nearV; E.small.visible = dc < 190; E.far.visible = !nearV;
        E.lights.forEach(function (l, i) { var P = l.userData.P; var far = Math.abs(P.x - cam.x) > 150 || Math.abs(P.z - cam.z) > 150; var k0 = l.userData.k0, v = 0; if (!far) { var tag = l.userData.tag; if (tag === "fire") v = k0 * (0.35 + 0.65 * n) * (0.82 + 0.18 * Math.sin(t * 13 + i) * Math.sin(t * 7.3 + i * 2)); else if (tag === "tub") v = k0 * n; else if (tag === "glass") v = k0 * gk * (P.L ? 0.4 : 1); else v = k0 * gk; } l.intensity = v; }); });
      if (SITE.vg) { var dv = 1e9; SITE.vaults.forEach(function (V) { dv = Math.min(dv, Math.hypot(V.x - cam.x, V.z - cam.z)); }); if (SITE.vsmall) SITE.vsmall.visible = dv < 240; SITE.vaults.forEach(function (V) { if (V.g) V.g.visible = Math.hypot(V.x - cam.x, V.z - cam.z) < 130; }); (EX.vlights || []).forEach(function (l) { l.intensity = dv < 160 ? l.userData.k0 * (l.userData.tag === "vault" ? (0.25 + 0.75 * n) * (l.userData.P.L ? 0.5 : 1) : gk) : 0; }); }
      // interiors, doors, lights inside
      var nm = nearestModel(), nv = nearestVault(); var close = (nm && nm.d < 140) || (nv && nv.d < 140);
      if (close) interiorFrame(); else if (!lying) { if (IN.sb) { try { var q2; do { q2 = IN.sb.it.next(); } while (!q2.done); IN.sb.P.L = q2.value; if (!IN.sb.P.vault) setFake(IN.sb.P, false); else vaultFakes(); } catch (e) { note("finish", e); } IN.sb = null; } SITE.suites.forEach(function (P) { if (P.L) disposeInterior(P); }); SITE.vaults.forEach(function (V) { if (V.L) disposeVault(V); }); }
      SITE.suites.forEach(function (P) { if (!P.L) return; doorFrame(P, dt); var dimIn = lying && mode.spot.dome === P ? 0.15 : 1; P.L.lights.forEach(function (l) { l.intensity = l.userData.k0 * (0.4 + 0.6 * n) * dimIn * (l.userData.flick ? 0.85 + 0.15 * Math.sin(t * 12 + l.id) * Math.sin(t * 6.1) : 1); }); });
      SITE.vaults.forEach(function (V) { if (Math.hypot(V.x - cam.x, V.z - cam.z) < 90) vaultDoorFrame(V, dt); if (V.L) V.L.lights.forEach(function (l) { l.intensity = l.userData.k0 * (0.6 + 0.7 * n); }); });
      aoFrame(n);
      var nearTub = SITE.suites.some(function (P) { return Math.abs(P.x - cam.x) < 60 && Math.abs(P.z - cam.z) < 60; }); if (nearTub) steamFrame(dt, n); else if (STEAM.g) STEAM.pool.forEach(function (sp) { sp.visible = false; });
      // the staff, built when you come near their venue, hidden from afar
      if (nowMs() > (FR.staffAt || 0)) { FR.staffAt = nowMs() + 2000; try { buildStaff(); } catch (e) { note("staff", e); } }
      if (nowMs() > (LBL.at || 0)) { LBL.at = nowMs() + 2500; labelSweep(); }
      (DM.castList || []).forEach(function (c) { var dd = Math.hypot(c.g.position.x - cam.x, c.g.position.z - cam.z); c.g.visible = dd < 55; });
      // the Model Suite stamp: first time inside one
      if (!FR.stamped && nm && nm.P.L && nm.d < nm.P.R - 0.6 && Math.abs(player.position.y - nm.P.D) < 1.2) { FR.stamped = true; try { var PP = window.PLAN_PROGRESS; if (PP && PP.award) PP.award("stamp", { id: C("progress.interiorStamp", "p_model_suite") }); } catch (e) {} }
    } catch (e) { note("frame", e); }
  }

  // ───────────────────────── the camera inside a dome or a vault: kept within the skin, first person when tight ─────────────────────────
  function suiteAt(x, z, y) { var S = SITE; if (!S) return null; for (var i = 0; i < S.suites.length; i++) { var P = S.suites[i]; if (!P.L) continue; if (Math.abs(x - P.x) > P.R || Math.abs(z - P.z) > P.R) continue; var d = Math.hypot(x - P.x, z - P.z); if (d < P.R - 0.25 && y > P.D - 0.4 && y < P.D + 3.2) return P; } return null; }
  function vaultAt(x, z, y) { var S = SITE; if (!S) return null; for (var i = 0; i < S.vaults.length; i++) { var V = S.vaults[i]; if (!V.VG || Math.abs(x - V.x) > V.w || Math.abs(z - V.z) > V.w) continue; var q = w2l(V, x, z); if (Math.abs(q[1]) < V.VG.zg - 0.1 && Math.abs(q[0]) < vHalf(V.VG.V, q[1], 0.3) - 0.2 && y > V.D - 0.4 && y < V.D + 3.0) return V; } return null; }
  function inVolume(P, x, y, z, pad) { if (P.vault) { var q = w2l(P, x, z); var Vv = P.VG.V; if (Math.abs(q[1]) > P.VG.zg - pad) return false; var h = y - P.D; if (h < 0.1) return false; return vF(Vv, q[0], h, q[1]) < -pad * 0.18; } var dx = x - P.x, dy = y - P.D, dz = z - P.z; return dy > 0.1 && Math.sqrt(dx * dx + dy * dy + dz * dz) < P.R - pad; }
  function camHook(dt) {
    if (DM.off || !SITE || !DM.ready || window.__cam) return false; var mode = sgMode(); if (mode && (mode.on || mode.k > 0.001)) return false;
    try { var px = player.position.x, py = player.position.y, pz = player.position.z, fwd = [-Math.sin(yaw), -Math.cos(yaw)]; var P = suiteAt(px, pz, py) || vaultAt(px, pz, py);
      if (!P) { if (FR.inCam) { FR.inCam = false; try { player.userData.walk.visible = true; } catch (e) {} } return false; }
      FR.inCam = true; var cy0 = py - (typeof bobY === "number" ? bobY : 0) + 1.75, dist = 0;
      for (var d = 0.2; d <= 3.8; d += 0.2) { var cx = px - fwd[0] * d, cz = pz - fwd[1] * d; if (!inVolume(P, cx, cy0 + 0.3, cz, 0.35)) break; dist = d; }
      if (FR.fp === undefined) FR.fp = dist < 1.3; else if (FR.fp && dist > 2.1) FR.fp = false; else if (!FR.fp && dist < 1.1) FR.fp = true;
      CAM.dist += (dist - CAM.dist) * smoothK(dt, 10); var sd = Math.min(dist, CAM.dist);
      if (FR.fp) { camera.position.set(px, py - (typeof bobY === "number" ? bobY : 0) + 1.62, pz); CAM.init = false; camera.lookAt(px + fwd[0] * 10, camera.position.y - pitch * 6, pz + fwd[1] * 10); player.userData.walk.visible = false; }
      else { var cy = cy0 + pitch * 1.1; camera.position.lerp(camTarget.set(px - fwd[0] * sd, cy, pz - fwd[1] * sd), smoothK(dt, 24)); camLook(px, py + 1.3, pz, dt, 30); player.userData.walk.visible = true; }
      return true; } catch (e) { note("cam", e); return false; }
  }

  // ───────────────────────── E and the prompt ─────────────────────────
  function allHots() { var out = []; allPlaces().forEach(function (P) { if (P.L) out = out.concat(P.L.hots); }); return out; }
  function nearHot(kinds) { var px = player.position.x, py = player.position.y, pz = player.position.z, best = null, bd = 1e9; allHots().forEach(function (o) { if (kinds && kinds.indexOf(o.kind) < 0) return; if (Math.abs(py - o.y) > 1.8) return; var d = Math.hypot(o.x - px, o.z - pz); if (d < o.r && d < bd) { bd = d; best = o; } }); return best; }
  function nearBed() { var px = player.position.x, pz = player.position.z, py = player.position.y, best = null, bd = 1e9; SITE.suites.forEach(function (P) { if (!P.L) return; P.L.recl.forEach(function (r) { var w = l2w(P, r.x, r.z); var d = Math.hypot(w[0] - px, w[1] - pz); var yy = P.D + (r.loft ? r.y - 0.55 : 0); if (d < (r.loft ? 1.6 : 1.9) && d < bd && Math.abs(py - yy) < 1.0) { bd = d; best = { P: P, r: r }; } }); }); return best; }
  function nearDoor() { var px = player.position.x, pz = player.position.z, py = player.position.y; var S = SITE; for (var i = 0; i < S.suites.length; i++) { var P = S.suites[i]; if (Math.abs(px - P.x) > 14 || Math.abs(pz - P.z) > 14) continue; var q = w2l(P, px, pz); var zd = buildShell(P.size, P.R).zd; if (Math.abs(q[0]) < 1.4 && q[1] > zd - 1.8 && q[1] < zd + 1.8 && Math.abs(py - P.D) < 1.4) return P; }
    for (var j = 0; j < S.vaults.length; j++) { var V = S.vaults[j]; if (Math.abs(px - V.x) > 20 || Math.abs(pz - V.z) > 20) continue; var q2 = w2l(V, px, pz); if (Math.abs(q2[0]) < 2.2 && q2[1] > V.VG.zg - 2.2 && q2[1] < V.VG.zg + 2.4 && Math.abs(py - V.D) < 1.4) return V; } return null; }
  function infoCard(t, k, p) { try { $id("info-h").textContent = t; $id("info-k").textContent = k || ""; $id("info-p").textContent = p || ""; var go = $id("info-go"); if (go) go.style.display = "none"; var nv = $id("info-nav"); if (nv) nv.style.display = "none"; $id("info").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock(); sfx("ui"); } catch (e) {} }
  function status(s) { try { setStatus(s); } catch (e) { try { logLine(C("names.suites", "Dome Suites"), s); } catch (x) {} } }
  function bedSpot(P, r) { var SG = window.PLAN_STARGAZE; var w = l2w(P, r.x, r.z); var y = P.D + r.y; var yawW; if (r.loft) yawW = P.rot + Math.atan2(-r.x, -r.z + 1.2); else { var f = l2w(P, r.foot[0], r.foot[1]); yawW = Math.atan2(f[0] - w[0], f[1] - w[1]); } return { kind: "dome", x: w[0], z: w[1], y: y, yaw: yawW, pitch0: r.loft ? 1.0 : 0.78, dome: P, P: null }; }
  function lieDown(P, r) { var SG = window.PLAN_STARGAZE; if (SG && SG.api && SG.api.enterStargaze) { try { SG.api.enterStargaze(bedSpot(P, r), false); return true; } catch (e) { note("stargaze", e); } } var m = C("rooms.bed", null); if (m) infoCard(m[0], m[1], m[2]); return true; }
  function climb(P) { var L = P.L; if (!L || !L.ladder) return; var lad = L.ladder, up = player.position.y < P.D + 1.2; var p = up ? lad.hi : lad.lo; var w = l2w(P, p[0], p[1]); player.position.set(w[0], P.D + (up ? lad.y : 0.0) + 0.02, w[1]); try { sfx("board"); } catch (e) {} }
  function handleE() {
    if (DM.off || !SITE) return false; var mode = sgMode(); if (mode && mode.on) return false;
    if ((typeof riding !== "undefined" && riding) || (typeof SIT !== "undefined" && SIT.on) || (typeof inside !== "undefined" && inside)) return false;
    var hl = nearHot(["ladder"]); if (hl) { var Pl0 = suiteAt(player.position.x, player.position.z, player.position.y) || (nearestModel() || {}).P; if (Pl0 && Pl0.L && Pl0.L.ladder) { var up0 = player.position.y > Pl0.D + 1.2, sp0 = l2w(Pl0, (up0 ? Pl0.L.ladder.hi : Pl0.L.ladder.lo)[0], (up0 ? Pl0.L.ladder.hi : Pl0.L.ladder.lo)[1]); if (Math.hypot(sp0[0] - player.position.x, sp0[1] - player.position.z) < 0.9) { climb(Pl0); return true; } } }
    var b = nearBed(); if (b) return lieDown(b.P, b.r);
    var h = nearHot(); if (h) { if (h.kind === "ladder") { var Pl = suiteAt(player.position.x, player.position.z, player.position.y) || (nearestModel() || {}).P; if (Pl) climb(Pl); return true; } if (h.kind === "note") { var r = C("rooms." + h.d.key, null); if (r) { infoCard(r[0], r[1], r[2]); return true; } } }
    try { if (nearestSeat()) return false; } catch (e) {}
    var P2 = nearDoor(); if (P2) { if (P2.vault) { var Dv = P2.door; Dv.manual = true; Dv.target = Dv.target > 0.5 ? 0 : 1; try { sfx("board"); } catch (e) {} return true; }
      if (P2.model && P2.L && P2.L.door) { var D = P2.L.door; D.manual = true; D.target = D.target > 0.5 ? 0 : 1; try { sfx("board"); } catch (e) {} return true; } status(C("prompts." + (P2.cl.status === "home" ? "home" : "guest"), "occupied tonight")); return true; }
    return false;
  }
  function promptFrame() {
    try { if (DM.off || !SITE) return; var el = $id("prompt"), t = $id("prompt-t"); if (!el || !t) return; var mode = sgMode(); if (mode && mode.on) return;
      if ((typeof riding !== "undefined" && riding) || (typeof SIT !== "undefined" && SIT.on)) return; var Pm = C("prompts", {}), msg = null;
      var b = nearBed(); if (b) msg = Pm.bed;
      if (!msg) { var h = nearHot(); if (h) { if (h.kind === "ladder") msg = player.position.y < (suiteAt(player.position.x, player.position.z, player.position.y) || { D: 0 }).D + 1.2 ? "climb to the sleeping loft" : "climb down"; else if (h.kind === "note") { var r = C("rooms." + h.d.key, null); var ns = null; try { ns = nearestSeat(); } catch (e) {} if (r && !ns) msg = "about " + r[0].replace(/^The /, "the "); } } }
      if (!msg) { var ns2 = null; try { ns2 = nearestSeat(); } catch (e) {} if (ns2 && ns2.tub && ns2.tag === "domes") msg = Pm.tub; else if (ns2 && ns2.pool) msg = Pm.pool; }
      if (!msg) { var P2 = nearDoor(); if (P2) { if (P2.vault) { if (!vaultAt(player.position.x, player.position.z, player.position.y)) msg = P2.door.target > 0.5 ? Pm.vaultDoorOpen : Pm.vaultDoorShut; } else if (P2.model && P2.L && P2.L.door) { if (!suiteAt(player.position.x, player.position.z, player.position.y)) msg = P2.L.door.target > 0.5 ? Pm.doorOpen : Pm.doorShut; } else { var ns3 = null; try { ns3 = nearestSeat(); } catch (e) {} if (!ns3) msg = P2.cl.status === "home" ? Pm.home : Pm.guest; } } }
      if (msg) { t.innerHTML = "<b>E</b> &nbsp;" + msg; el.classList.add("on"); }
    } catch (e) { note("prompt", e); }
  }
  // ───────────────────────── name labels and chat bubbles hide behind walls (R5) ─────────────────────────
  // The client draws them without a depth test, so a name showed through every dome, vault, pyramid and building wall. Here every
  // label and bubble sprite is depth tested (no depth write) and drawn pulled LABEL_OFF metres toward the camera along its line of
  // sight, its size compensated so it looks exactly as before: a wall between you and the character hides the name, its own head,
  // hat or a chair beside it never does, glass (no depth write) never does. The client's makeLabel and makeBubble are wrapped (no
  // client.js change) and the labels made before that are patched by a light sweep. ?labeldepth=0 turns it off.
  var LABEL_OFF = 0.55, LBL = DM.lbl = DM.lbl || { n: 0, at: 0, on: !/[?&]labeldepth=0\b/.test(location.search) };
  function depthLabel(sp) { try { var m = sp && sp.material; if (!m || !m.isSpriteMaterial || m.userData.dmDepth) return sp; m.userData.dmDepth = true; m.depthTest = true; m.depthWrite = false;
      m.onBeforeCompile = function (sh) { sh.vertexShader = sh.vertexShader.replace("vec4 mvPosition = modelViewMatrix[ 3 ];", "vec4 mvPosition = modelViewMatrix[ 3 ];\n float dmL = length(mvPosition.xyz); float dmK = max(0.2, (dmL - " + LABEL_OFF.toFixed(2) + ") / max(dmL, 0.001)); mvPosition.xyz *= dmK;")
          .replace("vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );", "vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) ) * dmK;"); };
      m.customProgramCacheKey = function () { return "dm_label"; }; m.needsUpdate = true; LBL.n++; } catch (e) { note("label", e); } return sp; }
  function labelSweep() { if (!LBL.on) return; var one = function (g) { if (!g || !g.userData) return; if (g.userData.label) depthLabel(g.userData.label); if (g.userData.bubble) depthLabel(g.userData.bubble); };
    try { one(player); } catch (e) {} try { avatars.forEach(function (a) { one(a && a.g); }); } catch (e) {} try { CAST.forEach(function (c) { one(c.g); }); } catch (e) {}
    try { ["walkers", "hall", "carts"].forEach(function (k) { (SITES[k] || []).forEach(function (w) { one(w.g); if (w.drv) one(w.drv); }); }); } catch (e) {} try { for (var id in VEH) { var V = VEH[id]; if (V && V.label) depthLabel(V.label); } } catch (e) {} }
  function installLabels() { if (!LBL.on || LBL.wrapped) return; LBL.wrapped = true;
    try { if (typeof makeLabel === "function") { var ml = makeLabel; makeLabel = function () { return depthLabel(ml.apply(this, arguments)); }; } } catch (e) { note("label wrap", e); }
    try { if (typeof makeBubble === "function") { var mb = makeBubble; makeBubble = function () { return depthLabel(mb.apply(this, arguments)); }; } } catch (e) { note("bubble wrap", e); }
    labelSweep(); }
  function install() {
    if (DM.installed) return; DM.installed = true; var o = DM.orig = { openNearest: openNearest, updateZone: updateZone }; installLabels();
    openNearest = function () { try { if (DM.impl.handleE()) return; } catch (e) { note("E", e); } return o.openNearest.apply(this, arguments); };
    updateZone = function () { var r = o.updateZone.apply(this, arguments); try { DM.impl.prompt(); } catch (e) {} return r; };
  }

  // ───────────────────────── the staff: client avatars in the CAST (they turn to you and greet; talk cards on E) ─────────────────────────
  function buildStaff() {
    var ST = C("staff", null); if (!ST || typeof avatar !== "function") return; DM.castList = DM.castList || [];
    Object.keys(ST).forEach(function (id) { var A = ST[id]; if (DM.castList.some(function (c) { return c.id === id; }) || CAST.some(function (c) { return c.id === id; })) return; var host = A.venue ? SITE.byId[A.venue] : SITE.byId[A.suite]; if (!host) return;
      var dd = Math.hypot(host.x - player.position.x, host.z - player.position.z); if (dd > 200) return;
      var lx = A.at ? A.at[0] : 0, lz = A.at ? A.at[1] : 0; if (!host.vault && A.at === undefined) { lx = 1.1; lz = host.R + 1.3; } var w = l2w(host, lx, lz); var y = host.D;
      var g = avatar("cast_" + id, A.name, A.look || {}, null, null); g.position.set(w[0], y, w[1]); g.rotation.y = host.rot + (A.face || 0); try { g.userData.label.scale.set(1.7, 0.43, 1); } catch (e) {} scene.add(g);
      var talk = (A.talk || []).map(function (q) { return { t: q.t, o: q.o }; });
      var c = { id: id, name: A.name, role: A.role, pos: [w[0], w[1]], look: A.look, hat: null, outfit: null, greet: A.greet || ["Welcome."], talk: talk, kw: [], g: g, rot: g.rotation.y };
      CAST.push(c); var hs = { x: w[0], z: w[1], r: 4, t: c.name, k: c.role + " · press E to talk", p: talk[0] ? talk[0].t : "", play: "npc:" + c.id }; hotspots.push(hs); (DM.hsList = DM.hsList || []).push(hs); DM.castList.push(c); DM.n.staff = DM.castList.length; });
  }

  // ───────────────────────── defer hook: build everything at its final height ─────────────────────────
  function strays(S) { var n = 0; for (var i = SOLIDS.length - 1; i >= 0; i--) { var sd = SOLIDS[i]; if (sd.tag === "domes" || DM.sol.indexOf(sd) >= 0) continue; if (sd.hw > 3 || sd.hd > 3) continue; if (inFootprint(S, sd.x, sd.z, false)) { SOLIDS.splice(i, 1); n++; } }
    for (var j = COLLIDERS.length - 1; j >= 0; j--) { var c = COLLIDERS[j]; if (c[2] < 3 && inFootprint(S, c[0], c[1], false)) { COLLIDERS.splice(j, 1); n++; } } DM.n.strays = n; }
  function deferHook() {
    if (DM.off || !window.PLAN || !SITE) return; var S = SITE, t0 = nowMs();
    var step = function (name, fn) { var t = nowMs(); try { fn(); } catch (e) { note(name, e); } DM.n["ms_" + name] = Math.round(nowMs() - t); };
    step("strays", function () { strays(S); });
    // the paths: the client drew one ribbon per path (one draw each); merged into a single mesh now that they are built
    step("paths", function () { var geos = [], mat = null; (S.pathGroups || []).forEach(function (rg) { rg.updateMatrixWorld(true); rg.traverse(function (m) { if (!m.isMesh) return; mat = mat || m.material; var g = toNonIndexed(m.geometry).clone(); g.applyMatrix4(m.matrixWorld); if (!g.attributes.normal) g.computeVertexNormals(); geos.push(g); }); }); if (geos.length > 1 && mat) { var mg = mergeAll(geos); var pm2 = new THREE.Mesh(mg, mat); pm2.name = "domes_paths"; pm2.receiveShadow = true; pm2.userData.noCull = true; S.pathGroups.forEach(function (rg) { rg.traverse(function (m) { if (m.isMesh && m.geometry) m.geometry.dispose(); }); scene.remove(rg); }); scene.add(pm2); S.pathMesh = pm2; DM.n.pathsMerged = geos.length; } });
    step("clusters", function () { S.clusters.forEach(function (CL) { buildCluster(S, CL); }); });
    step("vaults", function () { buildVaults(S); });
    step("bollards", function () { buildBollards(S); }); step("signs", function () { buildSigns(S); });
    step("solids", function () { S.suites.forEach(function (P) { suiteSolids(P); }); S.vaults.forEach(function (V) { vaultSolids(V); }); });
    step("prefabs", function () { prefab("chiavari", function (K0) { chiavariK(K0, 0, 0, 0, {}); }); ["walnut", "oak"].forEach(function (w) { prefab("cross:" + w + ":rattan", function (K0) { crossChairK(K0, 0, 0, 0, { wood: w, seat: "rattan" }); }); }); prefab("stool:1:leather", function (K0) { stoolK(K0, 0, 0, 0, { back: true, seat: "leather" }); }); prefab("stool:0:velvetN", function (K0) { stoolK(K0, 0, 0, 0, { seat: "velvetN" }); }); });
    step("perf", function () { perfRooms(S); var W = window.PLAN_PERF; if (W && W.warmGroup) { EX.cl.forEach(function (E) { W.warmGroup(E.g, { name: E.g.name }); }); if (S.vg) W.warmGroup(S.vg, { name: "domes vaults" }); } });
    DM.groups = EX.cl.map(function (E) { return E.g; }).concat(S.vg ? [S.vg] : []);
    DM.n.deferMs = Math.round(nowMs() - t0); DM.n.exteriorMeshes = EX.meshes.length; DM.ready = true;
  }
  // indoor culling (plan_perf): in a suite the glass front (seen from the back of the room) and the skylight look out; in a vault
  // its two glazed ends. plan_perf asks PLAN_PERF.rooms for the room the camera is in.
  function perfRooms(S) {
    var W = window.PLAN_PERF; if (!W) return; W.rooms = W.rooms || []; if (W.rooms.some(function (r) { return r.name === "domes"; })) return;
    S.suites.forEach(function (P) { P.perfSig = function () { return (P.L && P.L.door && P.L.door.open > 0.1 ? 2 : 1); };
      P.perfRoom = function (R) { var Rr = P.R; return { kind: "domes " + P.id, M: sMatrix(P), boxes: [[-Rr, Rr, -0.6, Rr + 0.3, -Rr, 0.14 * Rr]], rects: [R("x", 0.2 * Rr, -Rr, Rr, -0.2, Rr), R("y", 0.86 * Rr, -0.5 * Rr, 0.5 * Rr, -0.5 * Rr, 0.5 * Rr)], roots: P.L ? [P.L.g] : [] }; }; });
    S.vaults.forEach(function (V) { V.perfSig = function () { return V.door && V.door.open > 0.1 ? 2 : 1; };
      V.perfRoom = function (R) { var VG = V.VG, aw = VG.d.a + 0.2, M0 = sMatrix(V); var rects = [R("x", VG.zg, -aw, aw, -0.2, VG.d.H), R("x", -VG.zg, -aw, aw, -0.2, VG.d.H)]; (VG.wins || []).forEach(function (Wn) { rects.push(R("z", Wn.sd * (vHalf(VG.V, 0, Wn.yb) + 0.05), -Wn.zw, Wn.zw, Wn.yb - 0.1, Wn.yb + Wn.h + 0.1)); }); return { kind: "domes " + V.id, M: M0, boxes: [[-aw, aw, -0.6, VG.d.H + 0.3, -VG.c, VG.c]], rects: rects, roots: V.L ? [V.L.g] : [] }; }; });
    W.rooms.push({ name: "domes", key: function () { if (!SITE) return null; var mode = sgMode(); if (mode && mode.on && !(mode.spot && mode.spot.dome)) return null; var c = camera.position;
      var P = suiteAt(c.x, c.z, c.y - 1.4); if (P && inVolume(P, c.x, c.y, c.z, 0.05)) { var q = w2l(P, c.x, c.z); if (q[1] < 0.12 * P.R) return P; return null; }
      var V = vaultAt(c.x, c.z, c.y - 1.4); if (V && inVolume(V, c.x, c.y, c.z, 0.02)) return V; return null; } });
  }

  // ───────────────────────── hooks, API, debug ─────────────────────────
  DM.impl = { handleE: handleE, prompt: promptFrame, frame: frameHook, cam: camHook };
  DM.api = { resolveSite: resolveSite, l2w: l2w, w2l: w2l, suitePlan: suitePlan, buildShell: buildShell, buildInterior: buildInterior, disposeInterior: disposeInterior, buildVaultInterior: buildVaultInterior, disposeVault: disposeVault, suiteAt: suiteAt, vaultAt: vaultAt, bedSpot: bedSpot, lieDown: lieDown };
  DM.debug = {
    // stand the player at a suite's or vault's local spot (lx, lz) facing yawL (local); returns the world point
    at: function (id, lx, lz, yawL, up) { var P = SITE.byId[id]; if (!P) return null; var w = l2w(P, lx, lz); player.position.set(w[0], P.D + (up || 0) + 0.02, w[1]); if (yawL !== undefined) yaw = P.rot + yawL; return [w[0], P.D, w[1]]; },
    build: function (id) { var P = SITE.byId[id]; if (!P) return null; if (P.vault) { if (!P.L) { P.L = buildVaultInterior(P); vaultFakes(); } } else if (!P.L) { P.L = buildInterior(P); setFake(P, false); } return !!P.L; },
    drop: function (id) { var P = SITE.byId[id]; if (!P) return null; if (P.vault) disposeVault(P); else disposeInterior(P); return true; },
    door: function (id, t) { var P = SITE.byId[id]; if (!P) return null; if (P.vault) { P.door.manual = true; P.door.target = P.door.open = t; var e = ease(t) * 1.45; P.leaves[0].rotation.y = -e; P.leaves[1].rotation.y = PI + e; doorSolidOn(P, t < 0.5); return t; } if (!P.L) return null; var D = P.L.door; D.manual = true; D.target = D.open = t; D.piv.rotation.y = -ease(t) * 1.5; doorSolidOn(P, t < 0.45); return t; },
    // rebuild an interior step by step and time each step (ms) and the whole (the time-sliced build's worst frame)
    steps: function (id) { var P = SITE.byId[id]; if (!P) return null; if (P.vault) disposeVault(P); else disposeInterior(P); var it = P.vault ? buildVaultSteps(P) : buildSteps(P), r, t = [], t0; do { t0 = nowMs(); r = it.next(); t.push(+(nowMs() - t0).toFixed(1)); } while (!r.done); P.L = r.value; if (P.vault) vaultFakes(); else setFake(P, false); var nm = 0; P.L.g.traverse(function (o) { if (o.isMesh) nm++; }); return { t: t, tris: P.L.tris, meshes: nm }; },
    lie: function (id, which) { var P = SITE.byId[id]; if (!P) return null; if (!P.L) { P.L = buildInterior(P); setFake(P, false); } var r = P.L.recl[which | 0] || P.L.recl[0]; return lieDown(P, r); },
    // a camera view in a suite's or vault's frame: eye (lx, ly, lz) looking at (tx, ty, tz), heights above the deck top
    cam: function (id, lx, ly, lz, tx, ty, tz, fov) { var P = SITE.byId[id]; if (!P) return null; var a = l2w(P, lx, lz), b = l2w(P, tx, tz); window.__cam = [a[0], P.D + ly, a[1], b[0], P.D + ty, b[1], fov || 0]; try { player.visible = false; } catch (e) {} try { updateCulling(true); } catch (e) {} return window.__cam; }
  };
  (function hookAll() {
    var set = function (phase, name, fn) { var list = window.PLAN_HOOKS[phase]; for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name: name, fn: fn }); };
    set("world", "domesWorld", function () { worldHook(); });
    set("terrain", "domesTerrain", function () { terrainHook(); });
    set("defer", "domesDefer", function () { deferHook(); });
    set("frame", "domesFrame", function (dt, now) { DM.impl.frame(dt, now); });
    set("interior", "domesCam", function (dt) { return DM.impl.cam(dt); });
  })();
  // R15 (plan_roomlight.js, HANDOFF_R15_ROOMLIGHT.md): the Dome Suite or Grand Vault the player is in takes the interior light kit:
  // its own pooled lights only (the deck and path lamps outside drop out of the pool), the look (no capture: these are walked into without a fade)
  (window.PLAN_RLQ = window.PLAN_RLQ || []).push({ walk: true, id: "domes", find: function (RL) {
    if (DM.off || !SITE || !DM.ready || typeof player === "undefined" || !player) return null; var p = player.position, P = suiteAt(p.x, p.z, p.y) || vaultAt(p.x, p.z, p.y); if (!P || !P.L || !P.L.g) return null;
    var R = P.L.rlRoom; if (R) return R; var M = new THREE.Matrix4().makeRotationY(P.rot || 0).setPosition(P.x, P.D || 0, P.z), a = P.vault ? (P.w || 13) / 2 : (P.R || 5), b = P.vault ? a * 1.18 : a, h = P.vault ? (P.w || 13) * 0.39 + 0.5 : (P.R || 5);
    R = P.L.rlRoom = new RL.Room({ id: (P.vault ? "vault:" : "dome:") + (P.id || ""), type: P.vault ? "vault" : "dome", mod: "walk", M: M, box: [-a, a, 0, h, -b, b], capRoot: P.L.g, own: true, env: false }); R.noShaft = true; R.noDoorShaft = true; return R; } });
})();
