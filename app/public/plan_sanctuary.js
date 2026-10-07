// R19 (6 Oct 2026): GENTLE GATE ANIMAL SANCTUARY, a rescue and care ranch in Launch Wash Park, between Gantry Row, the Star Cinema
//   drive-in and the Frontier Ranch barns (S3_NFWASH, beside S3_FRONTIER). Original name; GIVEBACK's giving mission told through care.
//   Local frame: u east, v south (world axes), origin (868, -38); y is world height.
//   - the grounds: the Welcome Barn (visitor centre, walk-in) with the volunteer and adoption corner on its porch, the water trough
//     yard (galvanised stock tanks, no ponds or pools) under mesquites and a ramada, the horse and donkey yard, the goat and sheep
//     yard (climbing spools), the desert tortoise garden (burrows, low stone wall), the small-animal yard (hutches, a coop), the bird
//     aviary (wire flight cage, perches), the feed and care barn with its vet clinic room; split-rail fences, run-in sheds, hay bales,
//     shade trees, DG walks joined to the path network, a few golf carts at the gate
//   - animals: real 3D models (the game's horse, goat, sheep, tortoise, chicken and quail; new sa_donkey, sa_owl and sa_rabbit from
//     image-to-3D), one InstancedMesh per kind and tier, animated in the vertex shader by a baked per-vertex region rig (neck and
//     head bend for grazing and head turns, four legs for walking, tail swish, breathing); idle, graze, wander inside the paddock,
//     look at visitors; a cheap LOD tier past 42 m, nothing past 320 m
//   - people: three staff with talk cards (the director, the vet, the volunteer coordinator), roaming keepers and visitors (PLAN_ROAM)
//   - E: feed or pet an animal at its fence (it walks over, eats from your hand, hearts rise, a little activity XP), the adoption
//     board (talk card about giving through care), five passport stamps (chapter "sanctuary", proposed n 446 to 450)
// Classic script, loaded before plan_fill_a.js and client.js; hooks into window.PLAN_HOOKS { terrain, world, defer, frame, interior }
// and wraps openNearest by bare name. No new real lights (lamp sources for the client's pool). ?sanct=0 turns the module off.
// window.PLAN_SANCTUARY: n, errs, t, site, api, debug, zoo. Copy: plan/sanctuary.json.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
// the new animal kinds (engine specs: size by length, prop, no solid) and every kind the sanctuary instances (loaded in full on approach)
(function () { try { if (/[?&]sanct=0\b/.test(location.search)) return; const PS = window.PLAN_MODEL_SPECS = window.PLAN_MODEL_SPECS || {};
  if (!PS.sa_donkey) PS.sa_donkey = { size: 2.05, prop: true, solid: 0, animal: true, rot: 0 };
  if (!PS.sa_owl) PS.sa_owl = { height: 0.56, prop: true, solid: 0, animal: true, rot: 0 };
  if (!PS.sa_rabbit) PS.sa_rabbit = { size: 0.44, prop: true, solid: 0, animal: true, rot: 0 };
  const N = window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || []; for (const k of ["sa_donkey", "sa_owl", "sa_rabbit", "horse", "goat", "sheep", "tortoise", "chicken", "quail"]) if (N.indexOf(k) < 0) N.push(k); } catch (e) {} })();
(function () {
  "use strict";
  const R = window.PLAN_SANCTUARY = window.PLAN_SANCTUARY || {};
  R.v = "r19"; R.errs = R.errs || []; R.n = R.n || {}; R.t = R.t || {};
  if (/[?&]sanct=0\b/.test(location.search)) { R.off = true; return; }
  const PI = Math.PI, TAU = PI * 2;
  function note(tag, e) { try { if (R.errs.length < 50) R.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (R.errs.length <= 6) console.warn("plan_sanctuary " + tag, e); } catch (x) {} }
  const cnt = (k, n) => { R.n[k] = (R.n[k] || 0) + (n === undefined ? 1 : n); };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const angD = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  function rng(seed) { let s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const nowMs = () => performance.now();
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function has(k) { try { return !!(MODELS[k] && !MODELS[k].proxy); } catch (e) { return false; } }
  function canPut(k) { try { return !!MODELS[k] && !!MODEL_SPECS[k]; } catch (e) { return false; } }
  function lowTier() { try { return ASSET.tier === "m"; } catch (e) { return false; } }
  function qual() { try { return localStorage.getItem("g1:quality") || "high"; } catch (e) { return "high"; } }
  const Q = qual(), ULTRA = Q === "ultra", HIGHQ = Q === "ultra" || Q === "high", LOWQ = Q === "low" || Q === "medium";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function au(u) { try { if (window.AV) return window.AV(u); } catch (e) {} return u; }
  function hourNow() { try { return dayT() * 24; } catch (e) { return 12; } }
  function busy() { try { return (typeof riding !== "undefined" && riding) || (typeof SIT !== "undefined" && SIT.on) || (typeof inside !== "undefined" && inside) || (typeof DANCE !== "undefined" && DANCE.on) || (typeof FLY !== "undefined" && FLY.on) || (typeof golf !== "undefined" && golf.playing) || (typeof RIDE !== "undefined" && RIDE.on); } catch (e) { return false; } }
  function stamp(id) { try { const PP = window.PLAN_PROGRESS; if (PP && PP.award && id) PP.award("stamp", { id }); cnt("stamp_" + id); } catch (e) {} }
  function noShadow(g) { try { g.traverse((o) => { if (o.isMesh) o.castShadow = false; }); if (g.userData.blob) g.userData.blob.visible = true; } catch (e) {} return g; }
  function status(t, err) { try { setStatus(t, !!err); } catch (e) {} }

  // ───────────────────────── config: plan/sanctuary.json (built-in fallbacks everywhere) ─────────────────────────
  let CFG = R.cfg || null;
  const cfgUrl = () => au("/plan/sanctuary.json?v=" + (window.BUILD || "dev"));
  if (!CFG) { try { fetch(cfgUrl()).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && !CFG) CFG = R.cfg = d; }).catch((e) => note("cfg fetch", e)); } catch (e) { note("cfg", e); } }
  function cfg() { if (CFG) return CFG; try { const x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = R.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); } return CFG || {}; }
  function C(path, dflt) { let o = cfg(); const p = path.split("."); for (let i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }

  // ───────────────────────── the frame: u east, v south, origin (868, -38) ─────────────────────────
  const S = R.site = R.site || {};
  S.O = [868, -38];
  function l2w(u, v) { return [S.O[0] + u, S.O[1] + v]; }
  function w2l(x, z) { return [x - S.O[0], z - S.O[1]]; }
  const yawOf = (du, dv) => Math.atan2(du, dv);                 // the world yaw that faces local direction (du, dv) (+z of a mesh)
  const gy = (u, v) => getH(S.O[0] + u, S.O[1] + v);            // the ground under a local point (after grading)

  // ───────────────────────── geometry kit (as plan_rodeo): parts per base material with a vertex colour, merged once ─────────────────────────
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1);
  const _cc = {};
  function rgb(c) { if (Array.isArray(c)) return c; if (typeof c === "number" || typeof c === "string") { const k = String(c); if (_cc[k]) return _cc[k]; const q = new THREE.Color(c); return (_cc[k] = [q.r, q.g, q.b]); } return [1, 1, 1]; }
  function Kit() { this.m = {}; this.tris = 0; }
  Kit.prototype.add = function (b, g, col, m4) {
    if (g.index) g = g.toNonIndexed(); if (m4) g.applyMatrix4(m4); if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count; if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.color) { const c = rgb(col === undefined ? 0xffffff : col), ca = new Float32Array(n * 3); for (let i = 0; i < n; i++) { ca[i * 3] = c[0]; ca[i * 3 + 1] = c[1]; ca[i * 3 + 2] = c[2]; } g.setAttribute("color", new THREE.BufferAttribute(ca, 3)); }
    for (const k in g.attributes) if (k !== "position" && k !== "normal" && k !== "uv" && k !== "color") g.deleteAttribute(k);
    (this.m[b] || (this.m[b] = [])).push(g); this.tris += n / 3; return g; };
  Kit.prototype.place = function (b, g, col, x, y, z, ry, rx, rz, sx, sy, sz) { _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_v1.set(x || 0, y || 0, z || 0), _q, _v2.set(sx || 1, sy || 1, sz || 1)); return this.add(b, g, col, _m4); };
  Kit.prototype.box = function (b, col, w, h, d, x, y, z, ry, t, rx, rz) { const g = new THREE.BoxGeometry(w, h, d); if (t) uvBox(g, w, h, d, t); return this.place(b, g, col, x, y, z, ry, rx, rz); };
  Kit.prototype.cyl = function (b, col, r0, r1, h, x, y, z, seg, open, ry, rx, rz, t) { const g = new THREE.CylinderGeometry(r0, r1, h, seg || 10, 1, !!open); if (t) { const U = g.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, U.getX(i) * TAU * Math.max(r0, r1) / t, U.getY(i) * h / t); } return this.place(b, g, col, x, y, z, ry, rx, rz); };
  Kit.prototype.sph = function (b, col, r, x, y, z, seg, sx, sy, sz) { return this.place(b, new THREE.SphereGeometry(r, seg || 10, Math.max(5, (seg || 10) >> 1)), col, x, y, z, 0, 0, 0, sx, sy, sz); };
  Kit.prototype.tube = function (b, col, A, B, r, seg) { const d = _v3.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]), L = d.length(); if (L < 1e-4) return null; const g = new THREE.CylinderGeometry(r, r, L, seg || 8, 1, true); _q.setFromUnitVectors(_v1.set(0, 1, 0), d.normalize()); _m4.compose(_v2.set((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2), _q, _s1); return this.add(b, g, col, _m4); };
  Kit.prototype.beam = function (b, col, A, B, w, h, t) { const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L = Math.hypot(dx, dy, dz); if (L < 1e-4) return null; const g = new THREE.BoxGeometry(L, h, w); if (t) uvBox(g, L, h, w, t); const ry = Math.atan2(-dz, dx), rz = Math.atan2(dy, Math.hypot(dx, dz)); _e.set(0, ry, rz, "YZX"); _q.setFromEuler(_e); _m4.compose(_v1.set((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2), _q, _s1); return this.add(b, g, col, _m4); };
  // a log rail between two points (a split rail: a slightly flattened, rough round)
  Kit.prototype.rail = function (b, col, A, B, r, t) { const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L = Math.hypot(dx, dy, dz); if (L < 1e-4) return null; const g = new THREE.CylinderGeometry(r, r * 1.05, L, 7, 1, true); g.rotateZ(-PI / 2); g.scale(1, 0.82, 1); if (t) { const U = g.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, U.getY(i) * L / t, U.getX(i) * r * 6 / t); } const ry = Math.atan2(-dz, dx), rz = Math.atan2(dy, Math.hypot(dx, dz)); _e.set(0, ry, rz, "YZX"); _q.setFromEuler(_e); _m4.compose(_v1.set((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2), _q, _s1); return this.add(b, g, col, _m4); };
  Kit.prototype.plane = function (b, col, w, h, x, y, z, ry, rx, uv, rz) { const g = new THREE.PlaneGeometry(w, h); if (uv) { const U = g.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, uv[0] + U.getX(i) * (uv[2] - uv[0]), uv[1] + U.getY(i) * (uv[3] - uv[1])); } return this.place(b, g, col, x, y, z, ry, rx, rz); };
  // a ground sheet draped on the terrain: a grid over (u0, v0)..(u1, v1) in world units, uv world-scale (t metres a repeat), clipped by a test
  Kit.prototype.drape = function (b, col, u0, v0, u1, v1, lift, t, step, test) { const nu = Math.max(1, Math.ceil((u1 - u0) / (step || 2))), nv = Math.max(1, Math.ceil((v1 - v0) / (step || 2))); const P = [], N = [], U = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = [u0 + (u1 - u0) * i / nu, v0 + (v1 - v0) * j / nv], c = [u0 + (u1 - u0) * (i + 1) / nu, v0 + (v1 - v0) * (j + 1) / nv]; if (test && !test((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)) continue;
      const q = [[a[0], a[1]], [c[0], a[1]], [c[0], c[1]], [a[0], c[1]]].map(([u, v]) => [S.O[0] + u, gy(u, v) + (lift || 0.03), S.O[1] + v]);
      for (const k of [0, 2, 1, 0, 3, 2]) { P.push(q[k][0], q[k][1], q[k][2]); N.push(0, 1, 0); U.push(q[k][0] / t, -q[k][2] / t); } }
    if (!P.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.computeVertexNormals(); return this.add(b, g, col); };
  Kit.prototype.slab = function (b, col, x0, z0, x1, z1, y, t, rot, seg) { const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, seg || 1, seg || 1); g.rotateX(-PI / 2); const U = g.attributes.uv, P = g.attributes.position; for (let i = 0; i < U.count; i++) { const px = P.getX(i) + cx, pz = P.getZ(i) + cz; U.setXY(i, rot ? pz / t : px / t, rot ? px / t : -pz / t); } return this.place(b, g, col, cx, y, cz); };
  Kit.prototype.merge = function () { const out = {}; for (const k in this.m) { const g = mergeAll(this.m[k]); if (g) out[k] = g; } return out; };
  Kit.prototype.build = function (grp, bases, opts) { opts = opts || {}; const out = [], geos = this.merge(); for (const b in geos) { const mt = bases[b]; if (!mt) { note("base", b); continue; } const me = new THREE.Mesh(geos[b], mt); me.name = "sa " + (opts.tag || "") + " " + b; me.castShadow = opts.cast !== false && !mt.transparent && !(opts.noCast && opts.noCast.indexOf(b) >= 0); me.receiveShadow = opts.receive !== false && !mt.transparent; me.userData.shSet = true; me.userData.noSolid = true; if (mt.transparent) me.renderOrder = 2; grp.add(me); out.push(me); } this.m = {}; return out; };
  function mergeAll(list) {
    if (!list || !list.length) return null; let n = 0; list.forEach((g) => { n += g.attributes.position.count; }); if (!n) return null;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), Uu = new Float32Array(n * 2), Cc = new Float32Array(n * 3); let o = 0;
    list.forEach((g) => { const c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); Uu.set(g.attributes.uv.array, o * 2); if (g.attributes.color) Cc.set(g.attributes.color.array, o * 3); else Cc.fill(1, o * 3, (o + c) * 3); o += c; g.dispose(); });
    const r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(Uu, 2)); r.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
    r.computeBoundingBox(); r.computeBoundingSphere(); r.userData.avShared = true; return r; }
  function uvBox(g, w, h, d, t) { const uv = g.attributes.uv; const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } }
  function uvRot(g) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const a = uv.getX(i), b = uv.getY(i); uv.setXY(i, b, a); } return g; }
  function grime(g, y0, y1, k) { const P = g.attributes.position, Cc = g.attributes.color; if (!Cc) return g; for (let i = 0; i < P.count; i++) { const y = P.getY(i); const f = 1 - k * (1 - sstep(y0, y1, y)); Cc.setXYZ(i, Cc.getX(i) * f, Cc.getY(i) * f, Cc.getZ(i) * f); } return g; }
  // the venue's groups (world-space geometry: the group stays at the origin)
  function zoneGroup(name) { const g = new THREE.Group(); g.name = "sa_" + name; g.userData.noCull = true; g.userData.landSkip = true; g.userData.noBatch = true; scene.add(g); g.updateMatrixWorld(true); return g; }
  // solids in local coordinates (centre, yaw a, size w along local x of the yaw frame x d), heights absolute
  function solidL(u, v, a, w, d, y0, y1, tag, extra) { const p = l2w(u, v); const sd = addSolid(p[0], p[1], a || 0, w, d, y0, y1, tag || "sanct"); if (sd && extra) Object.assign(sd, extra); if (sd) cnt("solids"); return sd; }
  function seatL(u, v, a, w, d, y, face, tag) { const sd = solidL(u, v, a, w, d, y - 0.4, y, tag || "sanct", { noStep: true }); if (sd) { sd.seat = true; sd.face = face; sd.sa = 1; cnt("seats"); } return sd; }

  // ───────────────────────── textures: tex/sa_* (KTX2 desktop, JPEG fallback, _m on the low tier); the rodeo's raked dirt reused when loaded ─────────────────────────
  const TX = R.tx = R.tx || {};
  let ANISO_ = 0; function aniso() { if (!ANISO_) { try { ANISO_ = Math.min(ULTRA ? 16 : HIGHQ ? 8 : 4, renderer.capabilities.getMaxAnisotropy()); } catch (e) { return 4; } } return ANISO_; }
  function dataTex(rgba) { const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; t.userData.avShared = true; return t; }
  const PH = R.ph = R.ph || {};
  function ph(kind) { if (!PH[kind]) { PH[kind] = dataTex(kind === "n" ? [128, 128, 255, 255] : kind === "r" ? [235, 235, 235, 255] : kind === "ao" || kind === "w" ? [255, 255, 255, 255] : [200, 200, 200, 255]); if (kind === "c" || kind === "w") PH[kind].colorSpace = THREE.SRGBColorSpace; } return PH[kind]; }
  function setup(t, srgb, wrap) { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = wrap === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping; t.anisotropy = aniso(); t.userData.avShared = true; return t; }
  function texInto(name, srgb, wrap, ext, slots, noKtx) {
    let T = TX[name];
    if (!T) { T = TX[name] = { tex: null, users: [] };
      // the rodeo's copy of the same file (same GPU texture, no second upload)
      try { const RT = window.PLAN_RODEO && PLAN_RODEO.tx && PLAN_RODEO.tx[name]; if (RT && (RT.tex || RT.users)) { cnt("texShared"); if (RT.tex) T.tex = RT.tex; else { T.shared = RT; } } } catch (e) {}
      if (T.shared && !T.tex) { slots.forEach((s) => { T.shared.users.push(s); }); return; }
      if (!T.tex) { const low = lowTier(), k2 = !noKtx && !low && !/[?&]saktx=0\b/.test(location.search) && typeof ktx2Loader === "function" ? ktx2Loader() : null;
        const done = (t) => { setup(t, srgb, wrap); t.name = "sa_" + name; T.tex = t; T.users.forEach((u) => { u[0][u[1]] = t; u[0].needsUpdate = true; }); cnt("texLoaded"); };
        const plain = () => { try { new THREE.TextureLoader().load(au("/tex/" + name + (low ? "_m" : "") + "." + (ext || "jpg") + "?v=" + (window.BUILD || "dev")), done, undefined, (e) => note("tex " + name, e)); } catch (e) { note("tex " + name, e); } };
        if (k2) { try { k2.load(au("/tex/" + name + ".ktx2?v=" + (window.BUILD || "dev")), done, undefined, () => { cnt("ktxFail"); plain(); }); } catch (e) { plain(); } } else plain(); } }
    slots.forEach((s) => { if (T.tex) s[0][s[1]] = T.tex; else T.users.push(s); });
  }
  // ───────────────────────── canvas textures (hand-drawn type: the gate sign, the boards; the wire mesh; glows) ─────────────────────────
  function canvasTex(w, h, fn, srgb, wrap) { const k = lowTier() && w >= 512 ? 0.5 : 1; const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k); const x = c.getContext("2d"); if (k !== 1) x.scale(k, k); fn(x, w, h); const t = new THREE.CanvasTexture(c); setup(t, srgb !== false, wrap === true); t.userData.cv = c; return t; }
  const SERIF = "Georgia, 'Times New Roman', serif", SANS = "'Space Grotesk', system-ui, sans-serif";
  function woodBoard(x, x0, y0, w, h, base) { const g = x.createLinearGradient(x0, y0, x0, y0 + h); g.addColorStop(0, base || "#6b4a2e"); g.addColorStop(1, "#4a3220"); x.fillStyle = g; x.fillRect(x0, y0, w, h); const R0 = rng(w * 7 + h); x.globalAlpha = 0.16; for (let i = 0; i < 70; i++) { x.strokeStyle = R0() < 0.5 ? "#2a1a0e" : "#9a7450"; x.lineWidth = 1 + R0() * 2; const yy = y0 + R0() * h; x.beginPath(); x.moveTo(x0, yy); x.bezierCurveTo(x0 + w * 0.3, yy + (R0() - 0.5) * 8, x0 + w * 0.7, yy + (R0() - 0.5) * 8, x0 + w, yy + (R0() - 0.5) * 6); x.stroke(); } x.globalAlpha = 1;
    const pl = Math.max(1, Math.round(h / 90)); x.strokeStyle = "rgba(20,10,4,0.55)"; x.lineWidth = 3; for (let i = 1; i < pl; i++) { x.beginPath(); x.moveTo(x0, y0 + h * i / pl); x.lineTo(x0 + w, y0 + h * i / pl); x.stroke(); } }
  function painted(x, t, cx, cy, size, col, font, al) { x.save(); x.font = font || ("700 " + size + "px " + SERIF); x.textAlign = al || "center"; x.textBaseline = "middle"; x.fillStyle = "rgba(0,0,0,0.35)"; x.fillText(t, cx + size * 0.04, cy + size * 0.05); x.fillStyle = col; x.fillText(t, cx, cy); x.restore(); }
  function wrapText(x, t, cx, cy, maxW, lh, al) { const words = String(t).split(" "); let line = "", yy = cy; x.textAlign = al || "left"; for (const w of words) { const tt = line ? line + " " + w : w; if (x.measureText(tt).width > maxW && line) { x.fillText(line, cx, yy); line = w; yy += lh; } else line = tt; } if (line) x.fillText(line, cx, yy); return yy; }
  // the sign atlas (2048 x 1024): the arch sign, the barn sign, small yard signs; uv rectangles in SG.r
  const SG = R.sg = R.sg || { r: {} };
  function signAtlas() {
    if (SG.tex) return SG.tex; const W = 2048, Hh = 1024, r = SG.r; const reg = (k, x0, y0, w, h) => { r[k] = [x0 / W, 1 - (y0 + h) / Hh, (x0 + w) / W, 1 - y0 / Hh]; };
    SG.tex = canvasTex(W, Hh, (x) => {
      x.fillStyle = "#3a2716"; x.fillRect(0, 0, W, Hh);
      // the gate arch: 2048 x 300
      woodBoard(x, 0, 0, 2048, 300, "#6e4b2c"); reg("arch", 0, 0, 2048, 300);
      { const t = C("names.venue", "Gentle Gate Animal Sanctuary").toUpperCase(); let fs = Math.min(124, Math.floor(1800 / (t.length * 0.74))); while (fs > 60) { x.font = "700 " + fs + "px " + SERIF; if (x.measureText(t).width < 1900) break; fs -= 4; } painted(x, t, 1024, 128, fs, "#f3e6c8", x.font); } painted(x, C("names.arch2", "RESCUE  ·  CARE  ·  A HOME FOR LIFE"), 1024, 236, 54, "#e2b45a", "600 54px " + SANS);
      // the barn sign: 1024 x 260
      woodBoard(x, 0, 300, 1024, 260, "#f1e8d6"); reg("barn", 0, 300, 1024, 260); x.strokeStyle = "#7a2a1e"; x.lineWidth = 10; x.strokeRect(14, 314, 996, 232);
      painted(x, C("names.barn", "WELCOME BARN"), 512, 400, 104, "#7a2a1e"); painted(x, C("names.barn2", "visitors, volunteers and adoptions"), 512, 492, 42, "#3d2a18", "italic 600 42px " + SERIF);
      // the feed barn sign: 1024 x 260
      woodBoard(x, 1024, 300, 1024, 260, "#f1e8d6"); reg("feed", 1024, 300, 1024, 260); x.strokeStyle = "#2f5a3a"; x.lineWidth = 10; x.strokeRect(1038, 314, 996, 232);
      painted(x, C("names.feed", "FEED AND CARE BARN"), 1536, 400, 86, "#2f5a3a"); painted(x, C("names.feed2", "vet clinic at the south door"), 1536, 492, 42, "#3d2a18", "italic 600 42px " + SERIF);
      // yard signs: 8 boards 512 x 116
      const yards = C("yardSigns", ["Horse and Donkey Yard", "Goat and Sheep Yard", "Tortoise Garden", "Small Animal Yard", "The Aviary", "Water Troughs", "Volunteers welcome", "Please walk, the animals are resting"]);
      for (let i = 0; i < 8; i++) { const x0 = (i % 4) * 512, y0 = 560 + Math.floor(i / 4) * 116; woodBoard(x, x0 + 4, y0 + 4, 504, 108, i % 2 ? "#5e4127" : "#6a4a2c"); reg("y" + i, x0, y0, 512, 116); x.font = "700 40px " + SERIF; const s = yards[i] || ""; let fs = 44; while (fs > 22) { x.font = "700 " + fs + "px " + SERIF; if (x.measureText(s).width < 470) break; fs -= 2; } painted(x, s, x0 + 256, y0 + 60, fs, "#f2e4c4", x.font); }
      // the paw and hoof mark (a small round plaque): 256 x 256 at (0, 792)
      reg("mark", 0, 792, 232, 232); x.fillStyle = "#2f5a3a"; x.beginPath(); x.arc(116, 908, 110, 0, TAU); x.fill(); x.fillStyle = "#f3e6c8"; x.beginPath(); x.arc(116, 930, 34, 0, TAU); x.fill(); [[70, 878], [100, 852], [134, 852], [162, 878]].forEach(([px, py]) => { x.beginPath(); x.arc(px, py, 15, 0, TAU); x.fill(); });
      // the GIVEBACK board (the mark is drawn in when it loads): 512 x 232 at (256, 792)
      woodBoard(x, 256, 792, 512, 232, "#1b2a1e"); reg("logo", 256, 792, 512, 232);
      // the feeding times board: 512 x 232 at (768, 792) (chalk)
      x.fillStyle = "#1f2a24"; x.fillRect(772, 796, 504, 224); reg("chalk", 768, 792, 512, 232); x.fillStyle = "#e9efe6"; x.font = "700 36px " + SERIF; x.textAlign = "center"; x.fillText(C("chalk.title", "Feeding times"), 1024, 834); x.font = "28px " + SANS; x.textAlign = "left"; (C("chalk.lines", ["7:00  hay and water rounds", "10:00  greens for the tortoises", "13:00  goats and sheep", "16:00  horses and donkeys", "18:00  barn check"])).forEach((t, i) => x.fillText(t, 800, 880 + i * 30));
      // the clinic poster: 512 x 232 at (1280, 792)
      x.fillStyle = "#f4f2ec"; x.fillRect(1284, 796, 504, 224); reg("clinic", 1280, 792, 512, 232); x.fillStyle = "#2b5d8a"; x.font = "700 34px " + SANS; x.textAlign = "center"; x.fillText(C("clinic.title", "Daily care rounds"), 1536, 836); x.fillStyle = "#333"; x.font = "24px " + SANS; x.textAlign = "left"; (C("clinic.lines", ["Hooves and teeth checked", "Weights logged every week", "Medicines by the chart", "Gentle hands, quiet voices"])).forEach((t, i) => x.fillText("+  " + t, 1310, 884 + i * 32));
      // small white for lamp glass and trims: 256 x 232 at (1792, 792)
      x.fillStyle = "#fff4dc"; x.fillRect(1792, 792, 256, 232); reg("white", 1800, 800, 240, 216);
    }, true);
    try { const im = new Image(); im.onload = () => { try { const c = SG.tex.userData.cv, x = c.getContext("2d"), k = c.width / 2048; const h = 150, w = h * 2; x.save(); x.scale(k, k); x.drawImage(im, 512 - w / 2, 908 - h / 2, w, h); x.restore(); SG.tex.needsUpdate = true; } catch (e) { note("logo draw", e); } }; im.src = au("/tex/ar_logo.png"); } catch (e) { note("logo", e); }
    return SG.tex; }
  // the adoption board (1024 x 768): six resident cards, three with photographs (tex/sa_photos.jpg), all with name and story lines
  const AB = R.ab = R.ab || {};
  function adoptTex() {
    if (AB.tex) return AB.tex; const res = C("residents", []);
    const draw = (x, img) => { const W = 1024, Hh = 768; x.fillStyle = "#6a4a2c"; x.fillRect(0, 0, W, Hh); woodBoard(x, 0, 0, W, Hh, "#7a5634"); x.fillStyle = "#c9a878"; x.fillRect(24, 24, W - 48, Hh - 48);
      // cork texture
      const R0 = rng(99); for (let i = 0; i < 2600; i++) { x.fillStyle = R0() < 0.5 ? "rgba(120,80,40,0.25)" : "rgba(240,210,160,0.25)"; x.fillRect(24 + R0() * (W - 48), 24 + R0() * (Hh - 48), 2, 2); }
      x.fillStyle = "#2f5a3a"; x.font = "700 52px " + SERIF; x.textAlign = "center"; x.fillText(C("adopt.title", "Sponsor a resident"), W / 2, 84); x.fillStyle = "#3a2716"; x.font = "italic 26px " + SERIF; x.fillText(C("adopt.sub", "Every name here was given a second chance by someone who cared"), W / 2, 122);
      for (let i = 0; i < 6; i++) { const cx = 60 + (i % 3) * 320, cy = 150 + Math.floor(i / 3) * 300, a = (i % 2 ? 1 : -1) * 0.02 * (1 + (i % 3)); const q = res[i] || {}; x.save(); x.translate(cx + 140, cy + 135); x.rotate(a); x.translate(-140, -135);
        x.fillStyle = "rgba(0,0,0,0.25)"; x.fillRect(6, 8, 280, 270); x.fillStyle = "#fbf8f0"; x.fillRect(0, 0, 280, 270);
        if (img && i < 3) x.drawImage(img, i * 512, 0, 512, 512, 14, 14, 252, 168); else { const g = x.createLinearGradient(0, 14, 0, 182); g.addColorStop(0, "#e9dcc0"); g.addColorStop(1, "#cdb68e"); x.fillStyle = g; x.fillRect(14, 14, 252, 168); x.fillStyle = "#7a5634"; x.font = "700 84px " + SERIF; x.fillText(q.glyph || "♥", 140, 128); }
        x.fillStyle = "#2a1c10"; x.font = "700 30px " + SERIF; x.textAlign = "center"; x.fillText(q.name || "", 140, 214); x.fillStyle = "#5a4630"; x.font = "19px " + SANS; x.fillText(q.kind || "", 140, 240); x.fillStyle = "#b5332a"; x.beginPath(); x.arc(140, 6, 9, 0, TAU); x.fill(); x.restore(); } };
    AB.tex = canvasTex(1024, 768, (x) => draw(x, null), true);
    try { const im = new Image(); im.onload = () => { try { const c = AB.tex.userData.cv, x = c.getContext("2d"), k = c.width / 1024; x.save(); x.scale(k, k); draw(x, im); x.restore(); AB.tex.needsUpdate = true; } catch (e) { note("photos draw", e); } }; im.src = au("/tex/sa_photos" + (lowTier() ? "_m" : "") + ".jpg?v=" + (window.BUILD || "dev")); } catch (e) { note("photos", e); }
    return AB.tex; }
  // welded wire mesh (alpha): 2.5 cm squares, galvanised
  function meshTex() { if (TX._mesh) return TX._mesh; TX._mesh = canvasTex(128, 128, (x) => { x.clearRect(0, 0, 128, 128); x.strokeStyle = "rgba(196,200,198,1)"; x.lineWidth = 3; for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, 128); x.stroke(); x.beginPath(); x.moveTo(0, i * 32); x.lineTo(128, i * 32); x.stroke(); } }, true, true); TX._mesh.anisotropy = aniso(); return TX._mesh; }
  function glowTex() { if (TX._glow) return TX._glow; TX._glow = canvasTex(128, 128, (x) => { const g = x.createRadialGradient(64, 64, 2, 64, 64, 62); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.18, "rgba(255,255,255,0.55)"); g.addColorStop(0.5, "rgba(255,255,255,0.12)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 128, 128); }, true); return TX._glow; }
  function heartTex() { if (TX._heart) return TX._heart; TX._heart = canvasTex(128, 128, (x) => { x.save(); x.translate(64, 70); x.shadowColor = "rgba(255,120,140,0.9)"; x.shadowBlur = 14; x.fillStyle = "#ff6f86"; x.beginPath(); x.moveTo(0, 30); x.bezierCurveTo(-46, 0, -34, -42, 0, -18); x.bezierCurveTo(34, -42, 46, 0, 0, 30); x.fill(); x.shadowBlur = 0; x.fillStyle = "rgba(255,255,255,0.55)"; x.beginPath(); x.ellipse(-14, -14, 8, 5, -0.6, 0, TAU); x.fill(); x.restore(); }, true); return TX._heart; }
  function chaffTex() { if (TX._chaff) return TX._chaff; TX._chaff = canvasTex(64, 64, (x) => { const R0 = rng(5); for (let i = 0; i < 14; i++) { x.strokeStyle = "rgba(230,200,120," + (0.5 + R0() * 0.5) + ")"; x.lineWidth = 2; const a = R0() * TAU, cx = 32 + (R0() - 0.5) * 30, cy = 32 + (R0() - 0.5) * 30; x.beginPath(); x.moveTo(cx - Math.cos(a) * 9, cy - Math.sin(a) * 9); x.lineTo(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9); x.stroke(); } }, true); return TX._chaff; }

  // ───────────────────────── materials: a few shared families (one program each) ─────────────────────────
  const MT = R.mats = R.mats || {};
  function bm(m, opt) { try { if (window.PLAN_BMAT && PLAN_BMAT.patchMat && !/[?&]sabm=0\b/.test(location.search)) PLAN_BMAT.patchMat(m, opt || {}); } catch (e) { note("bmat", e); } return m; }
  function ext(name, map, nrm, rgh, o) { const m = new THREE.MeshStandardMaterial(Object.assign({ name: "sa " + name, vertexColors: true, roughness: 1, metalness: 0, map: ph("c"), normalMap: ph("n"), roughnessMap: ph("r"), normalScale: new THREE.Vector2(0.9, 0.9) }, o || {}));
    const slot = (s, v, srgb) => { if (!v) { if (s === "map") m.map = ph("w"); return; } if (v.isTexture) m[s] = v; else texInto(v[0], srgb, v[1] !== false, v[2], [[m, s]], v[3]); }; slot("map", map, true); slot("normalMap", nrm, false); slot("roughnessMap", rgh, false);
    m.userData.avShared = true; return m; }
  function int(name, map, nrm, rgh, o, ao) { const m = ext(name, map, nrm, rgh, Object.assign({ aoMap: ph("ao"), aoMapIntensity: ao === undefined ? 0.6 : ao, envMapIntensity: 0.55 }, o || {})); m.name = "sa in " + name; return m; }
  function mats() {
    if (MT.ready) return MT; const T = TEX;
    MT.wood = bm(ext("wood boards", T.wood, T.woodN, T.woodR, {}), { det: 1 });                              // board and batten, rails, posts, decks (vertex colour: barn red, white trim, weathered grey)
    MT.roof = bm(ext("metal roof", T.corrugated, T.corrugatedN, T.corrugatedR, { metalness: 0.5, roughness: 0.9 }));
    MT.metal = bm(ext("galvanised", null, null, T.woodR, { metalness: 0.75, roughness: 0.45 }));            // stock tanks, hinges, the aviary frame, buckets
    MT.stone = bm(ext("stone adobe", T.adobe, T.adobeN, T.adobeR, {}));
    MT.rock = bm(ext("fieldstone", T.rock, T.rockN, T.adobeR, {}));                                         // the tortoise wall, basking stones                                      // the tortoise wall, piers, the barn plinth
    MT.dirt = ext("yard dirt", ["ro_dirt"], ["ro_dirt_n"], ["ro_dirt_r"], { normalScale: new THREE.Vector2(1.2, 1.2), envMapIntensity: 0.35 });   // the horse yard (raked, hoof prints, straw: the rodeo's arena dirt)
    MT.yard = ext("yard caliche", T.dirt, T.dirtN, T.dirtR, { normalScale: new THREE.Vector2(1.0, 1.0), envMapIntensity: 0.35 });      // the other yards (packed caliche)
    MT.hay = ext("hay", ["sa_hay"], ["sa_hay_n"], ["sa_hay_r"], { normalScale: new THREE.Vector2(1.3, 1.3), envMapIntensity: 0.3 });              // bales, feeder racks, bedding
    MT.water = ext("stock tank water", null, null, null, { roughness: 0.16, metalness: 0.0, envMapIntensity: 0.45 });   // the troughs (vertex colour: deep blue-green)
    const st = signAtlas(); MT.sign = ext("signs", st, null, T.woodR, {});
    MT.mesh = new THREE.MeshStandardMaterial({ name: "sa wire mesh", map: meshTex(), transparent: true, depthWrite: false, alphaTest: 0.02, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5, vertexColors: true });   // blended: the mesh reads as a faint screen far off instead of vanishing MT.mesh.userData.avShared = true;
    MT.lamp = new THREE.MeshStandardMaterial({ name: "sa lamp emit", vertexColors: true, map: ph("w"), emissiveMap: ph("w"), emissive: 0xffd9a0, emissiveIntensity: 0.0, roughness: 0.4, metalness: 0.1 }); MT.lamp.userData.avShared = true;
    MT.glow = new THREE.MeshBasicMaterial({ name: "sa glow add", map: glowTex(), color: 0xffd9a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide, vertexColors: true, opacity: 0.0 }); MT.glow.userData.avShared = true;
    MT.heart = new THREE.SpriteMaterial({ name: "sa hearts", map: heartTex(), transparent: true, depthWrite: false, opacity: 1 }); MT.heart.userData.avShared = true;
    MT.chaff = new THREE.SpriteMaterial({ name: "sa chaff", map: chaffTex(), transparent: true, depthWrite: false, opacity: 1 }); MT.chaff.userData.avShared = true;
    // the barns inside: the same boards with a one-texel ao map (the sky's ambient is cut under the roof), the adoption board
    MT.iwood = int("wood boards", T.wood, T.woodN, T.woodR, {});
    MT.ihay = int("hay", ["sa_hay"], ["sa_hay_n"], ["sa_hay_r"], { normalScale: new THREE.Vector2(1.3, 1.3) });
    MT.imetal = int("metal", null, null, T.woodR, { metalness: 0.7, roughness: 0.4 }, 0.5);
    MT.board = int("adoption board", adoptTex(), null, T.woodR, {}, 0.3);
    MT.ready = true; return MT; }

  // ───────────────────────── the layout (local u east, v south; metres from (868, -38)) ─────────────────────────
  const L = R.L = {
    gate: { u: 0, v: 41.4, w: 4.4 },                                                 // the arch over the main gate (south, toward Ranch Drive)
    court: { u0: -13, u1: 13, v0: 28, v1: 41 },                                      // the arrival court (DG)
    barn: { u0: -38, u1: -18, v0: 6, v1: 20, eave: 4.2, ridge: 7.6 },                // the Welcome Barn (visitor centre), ridge east-west
    porch: { u0: -18, u1: -13.6, v0: 6, v1: 20 },                                    // the volunteer and adoption corner (east porch)
    yard: { u0: -11, u1: 20, v0: 3, v1: 27 },                                        // the water trough yard
    ramada: { u0: 5, u1: 15, v0: 17, v1: 25 },
    tanks: [[-2.5, 9.5, 1.25], [1.2, 12.4, 1.0], [-4.6, 13.6, 0.9]],                 // the stock tanks (u, v, radius)
    horses: { u0: -66, u1: -24, v0: -39, v1: 0 },                                     // the horse and donkey yard
    shed: { u0: -66, u1: -55, v0: -39, v1: -31 },                                    // its run-in shed
    goats: { u0: -20, u1: 14, v0: -39, v1: -5 },                                      // the goat and sheep yard
    gshed: { u0: -20, u1: -12, v0: -39, v1: -33 },
    tort: { u0: 18, u1: 37, v0: -37, v1: -20 },                                       // the desert tortoise garden
    hutch: { u0: 18, u1: 38, v0: -16, v1: 1 },                                        // the small-animal yard (rabbits, hens)
    aviary: { u0: 42, u1: 64, v0: -33, v1: -14, h: 4.8 },                             // the bird aviary
    feed: { u0: 46, u1: 70, v0: -6, v1: 8, eave: 4.0, ridge: 6.8, clinic: 61 },       // the feed and care barn; the vet clinic east of u 61
    lot: { u0: 5, u1: 17, v0: 47, v1: 55 },                                           // golf carts by the gate walk
    eastGate: [80.6, -9.5], westGate: [-68, 8]
  };
  function inRect(u, v, r, m) { m = m || 0; return u > r.u0 - m && u < r.u1 + m && v > r.v0 - m && v < r.v1 + m; }
  // the footprint we keep (polygon, local): the open scrub between Gantry Row, the drive-in, the ranch trail and the livery barns
  const FOOT = [[-68, -41], [16, -41], [33, -35], [68, -34], [80, -12], [82, 10], [76, 24], [54, 26], [32, 34], [12, 42.6], [-12, 42.6], [-22, 32], [-42, 20], [-68, 14]];
  const FOOT_LOT = [[2, 43], [20, 43], [20, 57], [2, 57]];
  function inPoly(poly, u, v) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > v) !== (b[1] > v) && u < (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  function inFoot(x, z, m) { const q = w2l(x, z); if (inPoly(FOOT, q[0], q[1]) || inPoly(FOOT_LOT, q[0], q[1])) return true; if (!m) return false; for (const [du, dv] of [[m, 0], [-m, 0], [0, m], [0, -m]]) if (inPoly(FOOT, q[0] + du, q[1] + dv)) return true; return false; }
  R.inFoot = inFoot;
  const VEG = /^(bush\d|mesquite|ocotillo|saguaro.*|paloverde|ironwood|desertwillow|barrel_cactus|prickly_pear|cholla|organ_pipe|agave_cluster|yucca_cluster|boulder|ph_(rock|boulder|shrub|succulent|stones|sandrocks|moonrock|quiver)_?\d*|e1_(canarypalm|datepalm|fanpalm2?|paloverde|mesquite|ironwood|desertwillow|agave|yucca|bush)\w*|canarypalm|datepalm|fanpalm2?|creek_rock|xr_\w+)$/;
  function clearFoot() { let removed = 0; const keys = new Set();
    for (const k in PLACE) { if (!VEG.test(k)) continue; const Lk = PLACE[k], out = []; for (const e of Lk) { if (!e.sa && inFoot(e[0], e[2], 1.5)) { keys.add(Math.round(e[0] * 100) + ":" + Math.round(e[2] * 100)); removed++; } else out.push(e); } if (out.length !== Lk.length) { Lk.length = 0; Array.prototype.push.apply(Lk, out); } }
    if (keys.size) for (let j = COLLIDERS.length - 1; j >= 0; j--) { const c = COLLIDERS[j]; if (keys.has(Math.round(c[0] * 100) + ":" + Math.round(c[1] * 100))) COLLIDERS.splice(j, 1); }
    // loose solids of scattered rocks inside (the engine's and the fill's, tag "world", small): gone with their meshes
    try { for (let j = SOLIDS.length - 1; j >= 0; j--) { const sd = SOLIDS[j]; if (sd.tag === "world" && sd.hw < 1.6 && sd.hd < 1.6 && sd.y1 - sd.y0 < 2.8 && !sd.seat && inFoot(sd.x, sd.z, 0.5)) { const q = w2l(sd.x, sd.z); if (keys.has(Math.round(sd.x * 100) + ":" + Math.round(sd.z * 100)) || inPoly(FOOT, q[0], q[1])) { SOLIDS.splice(j, 1); removed++; } } } } catch (e) {}
    cnt("cleared", removed); return removed; }
  function putL(kind, u, v, a, sc) { if (!canPut(kind)) return null; const p = l2w(u, v); put(kind, p[0], p[1], a || 0, sc); const Lk = PLACE[kind]; const e = Lk && Lk[Lk.length - 1]; if (e) e.sa = 1; cnt("put_" + kind); return e; }
  function keepOnce() { if (R.kept) return; R.kept = true; try { planKeepout(FOOT.map((q) => l2w(q[0], q[1]))); planKeepout(FOOT_LOT.map((q) => l2w(q[0], q[1]))); } catch (e) { note("keepout", e); }
    try { for (let u = -64; u <= 80; u += 9) for (let v = -38; v <= 40; v += 9) { if (!inPoly(FOOT, u, v)) continue; const p = l2w(u, v); KEEPOUT.push([p[0], p[1], 6.5]); } const lc = l2w(11, 50); KEEPOUT.push([lc[0], lc[1], 8]); } catch (e) { note("keep circles", e); } }
  // the world hook runs before the terrain hook: register the keep-outs at the very front of the world phase (R17 spa), so plan_enrich,
  // plan_land, fill A / B, plan_flora's rebuild and the engine scatter all read them
  try { const W = window.PLAN_HOOKS.world; if (!W.some((h) => h && h.name === "saKeep")) W.unshift({ name: "saKeep", fn: () => { if (!R.off && window.PLAN) keepOnce(); } }); } catch (e) {}

  // ───────────────────────── terrain hook: the pads (the barns, the aviary, the ramada level, eased out over 6 m) ─────────────────────────
  function terrainHook() {
    if (R.off || !window.PLAN) return; const t0 = nowMs(); keepOnce();
    try { clearFoot(); } catch (e) { note("clear", e); }
    try { if (typeof H !== "undefined" && H && T) grade(); } catch (e) { note("grade", e); }
    try { let Rr = 0; for (const k in PLACE) { for (const e of PLACE[k]) { if (!inFoot(e[0], e[2], 10)) continue; const g = getH(e[0], e[2]); if (Math.abs(g - e[1]) > 0.02 && Math.abs(g - e[1]) < 4) { e[1] = g; Rr++; } } } cnt("reseated", Rr); } catch (e) { note("reseat", e); }
    R.t.terrain = Math.round(nowMs() - t0); }
  const PADS = R.pads = R.pads || {};
  function grade() {
    const cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1);
    const mean = (r) => { let s = 0, n = 0; for (let u = r.u0; u <= r.u1; u += 2) for (let v = r.v0; v <= r.v1; v += 2) { s += gy(u, v); n++; } return s / Math.max(1, n); };
    const pads = [["barn", { u0: L.barn.u0 - 1, u1: L.porch.u1 + 0.6, v0: L.barn.v0 - 1, v1: L.barn.v1 + 1 }], ["feed", { u0: L.feed.u0 - 1, u1: L.feed.u1 + 1, v0: L.feed.v0 - 1, v1: L.feed.v1 + 3.6 }], ["aviary", { u0: L.aviary.u0 - 0.6, u1: L.aviary.u1 + 0.6, v0: L.aviary.v0 - 0.6, v1: L.aviary.v1 + 0.6 }], ["ramada", { u0: L.ramada.u0 - 1, u1: L.ramada.u1 + 1, v0: L.ramada.v0 - 1, v1: L.ramada.v1 + 1 }], ["court", L.court]];
    pads.forEach(([k, r]) => { PADS[k] = { r, y: +mean(r).toFixed(3) }; });
    const box = [[-75, -48], [90, -48], [90, 60], [-75, 60]].map((q) => l2w(q[0], q[1])); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; box.forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }); let cells = 0;
    for (let r = Math.max(0, Math.floor((z0 - T.zmin) / ch)); r <= Math.min(T.rows - 1, Math.ceil((z1 - T.zmin) / ch)); r++) for (let c = Math.max(0, Math.floor((x0 - T.xmin) / cw)); c <= Math.min(T.cols - 1, Math.ceil((x1 - T.xmin) / cw)); c++) {
      const x = T.xmin + c * cw, z = T.zmin + r * ch, q = w2l(x, z), u = q[0], v = q[1], vi = r * T.cols + c, h0 = H[vi]; let best = 0, tgt = h0;
      for (const k in PADS) { const P = PADS[k], rr = P.r; const du = Math.max(rr.u0 - u, 0, u - rr.u1), dv = Math.max(rr.v0 - v, 0, v - rr.v1); const w = 1 - sstep(0, k === "court" ? 4 : 7, Math.hypot(du, dv)); if (w > best) { best = w; tgt = P.y; } }
      if (best <= 0.001) continue; H[vi] = h0 + (tgt - h0) * best; cells++; }
    cnt("graded", cells); }
  function padY(k) { return PADS[k] ? PADS[k].y : 23.5; }

  // ───────────────────────── world hook: the hub, the zone, info points, walks (R15 edging), engine placements ─────────────────────────
  function worldHook() {
    if (R.off || !window.PLAN) return; const t0 = nowMs(); keepOnce();
    try { clearFoot(); } catch (e) { note("clear", e); }
    try { const h = l2w(0, 46); planAddHub(C("names.venue", "Gentle Gate Animal Sanctuary"), h[0], h[1]); planNavCats(); } catch (e) { note("hub", e); }
    try { const poly = FOOT.map((q) => l2w(q[0], q[1])); const c = l2w(6, 0); zoneRings.push({ name: C("names.venue", "Gentle Gate Animal Sanctuary"), label: C("names.short", "Gentle Gate"), center: c, r: 70, k: C("names.kicker", "Animal rescue and care sanctuary"), poly, col: "#7fbf6a55", plan: "sanctuary" }); } catch (e) { note("zone", e); }
    try { infoSpots(); } catch (e) { note("hotspots", e); }
    try { walks(); } catch (e) { note("walks", e); }
    try { plants(); } catch (e) { note("plants", e); }
    try { lotCarts(); } catch (e) { note("lot", e); }
    R.t.world = Math.round(nowMs() - t0); }
  function infoSpots() { const I = C("info", {}); const hs = (key, u, v, r) => { const d = I[key]; if (!d) return null; const w = l2w(u, v); const h = { x: w[0], z: w[1], r, t: d.t, k: d.k, p: d.p, sa: key }; hotspots.push(h); (R.hs = R.hs || []).push(h); return h; };
    hs("venue", 0, 44.5, 3.5); hs("troughs", 3.2, 9.4, 2.6); hs("horses", -23.2, -10, 2.4); hs("goats", 15.4, -20, 2.4); hs("tortoise", 17.2, -28, 2.2); hs("hutch", 26, 2.4, 2.2); hs("aviary", 53, -12.6, 2.4); hs("feed", 52, 10.4, 2.4); hs("hay", 9.5, 26.2, 2.2); }
  // DG walks joined to the path network (plan_paths dresses them: corten edging, the gravel band)
  function walks() { const dg = { mat: planMats().dg, lift: 0.12, tile: 3 }; const rib = (pts, w, id) => { try { const rec = planRibbon(pts.map((q) => l2w(q[0], q[1])), w, dg, id); if (rec) { rec.sa = true; cnt("walks"); } return rec; } catch (e) { note("ribbon " + id, e); return null; } };
    rib([[0, 76.5], [0, 41.5]], 3.4, "sa_gate_walk");
    rib([[0, 40], [0, 30], [4, 27.5]], 3.0, "sa_court_walk");
    rib([[-13, 22.5], [-6, 28], [10, 28], [16, 26], [17, 13], [24, 13], [44, 13], [58, 12.6], [72, 13], [79, 6], [80.6, -9.5]], 3.0, "sa_loop_s");
    rib([[16, 26], [16, 4], [16, -18], [16, -39]], 3.0, "sa_lane_mid");
    rib([[16, -18], [40, -18]], 2.8, "sa_lane_hx");
    rib([[40, 13], [40, -10], [40, -37]], 2.8, "sa_lane_av");
    rib([[40, -10], [70, -10], [80.6, -9.5]], 3.0, "sa_lane_e");
    rib([[-22, 4], [-22, -12], [-22, -39]], 3.0, "sa_lane_w");
    rib([[-12, 4], [-22, 4], [-22, 3]], 3.0, "sa_lane_wl");
    rib([[-12, 4], [-12, 22.5], [-13, 22.5]], 2.8, "sa_porch_walk");
    rib([[-22, 3], [-46, 2.6], [-68, 7]], 2.8, "sa_lane_nw");
    rib([[80.6, -9.5], [96, -9.5]], 2.8, "sa_east_link");
    // the west gate to the nearest road or walk (Gantry Row)
    try { const g = l2w(L.westGate[0], L.westGate[1]); let best = null, bd = 70; for (const r of ROADS) { if (r.sa || !r.pts || r.w < 2) continue; for (let i = 0; i < r.pts.length - 1; i++) { const a = r.pts[i], b = r.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1; const t = clamp(((g[0] - a[0]) * dx + (g[1] - a[1]) * dz) / L2, 0, 1); const px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(px - g[0], pz - g[1]) - r.w / 2; if (d < bd && !inFoot(px, pz, 2)) { bd = d; best = [px, pz, r.w]; } } }
      if (best) { const d = Math.hypot(best[0] - g[0], best[1] - g[1]), k = (d - best[2] / 2 + 0.6) / d; const e = [g[0] + (best[0] - g[0]) * k, g[1] + (best[1] - g[1]) * k]; const q = w2l(e[0], e[1]); rib([[L.westGate[0], L.westGate[1]], [q[0], q[1]]], 2.8, "sa_west_link"); R.westLink = [Math.round(best[0]), Math.round(best[1]), +bd.toFixed(1)]; } } catch (e) { note("west link", e); } }
  // shade trees and the desert garden that ties the grounds to the walks (engine kinds: instanced, LOD'd)
  const TREES = R.trees = [];
  function plants() { const Rn = rng(19191); const p1 = (k, u, v, sc, a) => putL(k, u, v, a === undefined ? Rn() * TAU : a, sc);
    // shade trees inside the yards (the animals' shade: kept, with a guard ring) and along the walks
    [["mesquite", -40, -20, 1.15], ["mesquite", -52, -8, 1.05], ["paloverde", -32, -32, 1.0], ["mesquite", -2, -24, 1.1], ["paloverde", 6, -12, 0.95], ["mesquite", -8, 24, 1.1], ["mesquite", 18.5, 6, 1.0], ["paloverde", -9, 7, 0.95], ["desertwillow", 30, -30, 0.85], ["mesquite", 70, -24, 1.0], ["paloverde", 74, 18, 0.95], ["mesquite", 36, 20, 1.05], ["desertwillow", -30, 26, 0.9], ["paloverde", 40, 30, 0.9], ["mesquite", -60, 10, 1.0]]
      .forEach(([k, u, v, sc]) => { if (p1(k, u, v, sc)) TREES.push([u, v, k]); });
    const low = ["agave_cluster", "barrel_cactus", "yucca_cluster", "prickly_pear", "ocotillo"].filter(canPut);
    const bed = (u0, v0, u1, v1, n, sc) => { for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; p1(low[i % low.length], lerp(u0, u1, t) + (Rn() - 0.5) * 1.2, lerp(v0, v1, t) + (Rn() - 0.5) * 1.2, (sc || 0.7) + Rn() * 0.3); } };
    bed(-11, 39.5, -4, 33, 4); bed(4, 33, 11, 39.5, 4); bed(-47, 16.5, -60, 12.5, 4); bed(54, 24, 74, 22, 5); bed(20, 32, 30, 30, 3); bed(70, -30, 77, -16, 4);
    ["saguaro", "saguaro_mid", "saguaro_young"].filter(canPut).forEach((k, i) => { p1(k, [-9, 9.5, 77][i], [44.5, 44.5, 20][i], 0.95); });
    // the tortoise garden's own plants: globemallow-like low shrubs, prickly pear, a small agave (the tortoises' shade and forage)
    if (canPut("prickly_pear")) { p1("prickly_pear", 21.5, -34, 0.55); p1("prickly_pear", 34.5, -23, 0.5); } if (canPut("agave_cluster")) { p1("agave_cluster", 33.5, -34.2, 0.45); p1("agave_cluster", 21, -22.5, 0.4); }
    if (canPut("ph_shrub_3")) { p1("ph_shrub_3", 28, -35, 0.6); p1("ph_shrub_3", 24.5, -21.5, 0.55); } }
  function lotCarts() { const Lt = L.lot, Rn = rng(4243); let n = 0; for (let i = 0; i < 5; i++) { if (i === 3 && Rn() < 0.5) continue; const e = putL("cart", Lt.u0 + 1.6 + i * 2.3, Lt.v0 + 3.2, PI, 1); if (e) n++; } cnt("lotCarts", n); }

  // ───────────────────────── the build: fences, yards, the barns, the aviary, the troughs, hay, lamps (merged per material) ─────────────────────────
  const EX = R.ex = R.ex || { lights: [], lampHeads: [] };
  const COL = { red: 0x9c3b2c, redD: 0x7c2c22, white: 0xf1ece0, grey: 0xb9b2a6, rail: 0xc9b9a0, railD: 0xa08c70, post: 0x8a7458, green: 0xb4bca8, roofG: 0x8f9a92, roofR: 0x7a5248, dark: 0x3a2e24, steel: 0xb8bcbc, glass: 0x2b3338, water: 0x2c4a52 };
  // a straight wall with openings: A, B local (u, v); y0 base, h height, d thickness; ops [[s0, s1, top, sill]] in metres along the wall
  function wall(K, b, col, A, B, y0, h, d, ops, t) { const L0 = Math.hypot(B[0] - A[0], B[1] - A[1]), du = (B[0] - A[0]) / L0, dv = (B[1] - A[1]) / L0, a = Math.atan2(-dv, du);
    const seg = (s0, s1, ya, yb) => { if (s1 - s0 < 0.02 || yb - ya < 0.02) return; const m = (s0 + s1) / 2, p = l2w(A[0] + du * m, A[1] + dv * m); const g = new THREE.BoxGeometry(s1 - s0, yb - ya, d); uvBox(g, s1 - s0, yb - ya, d, t || 2.4); uvRot(g); K.place(b, g, col, p[0], (ya + yb) / 2, p[1], a); };
    const os = (ops || []).slice().sort((p, q) => p[0] - q[0]); let s = 0; for (const o of os) { seg(s, o[0], y0, y0 + h); if (o[3] > 0) seg(o[0], o[1], y0, y0 + o[3]); seg(o[0], o[1], y0 + o[2], y0 + h); s = o[1]; } seg(s, L0, y0, y0 + h);
    if (R._noSol) return;
    // solids (between openings, full height; window sills as walls)
    const sol = (s0, s1) => { if (s1 - s0 < 0.1) return; const m = (s0 + s1) / 2; solidL(A[0] + du * m, A[1] + dv * m, a, s1 - s0, d + 0.1, y0, y0 + h); }; s = 0; for (const o of os) { sol(s, o[0]); if (o[3] > 0.6) sol(o[0], o[1]); s = o[1]; } sol(s, L0); }
  function wallNS(K, b, col, A, B, y0, h, d, ops, t) { const S0 = R._noSol; R._noSol = true; try { wall(K, b, col, A, B, y0, h, d, ops, t); } finally { R._noSol = S0; } }
  // a gable triangle (prism) over an end wall: across from A to B at height y0, apex rise up
  function gable(K, b, col, A, B, y0, rise, d) { const p0 = l2w(A[0], A[1]), p1 = l2w(B[0], B[1]); const nx = -(p1[1] - p0[1]), nz = p1[0] - p0[0], nl = Math.hypot(nx, nz), ox = nx / nl * d / 2, oz = nz / nl * d / 2; const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
    const F = [[p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [mx, y0 + rise, mz]]; const P = [], U = []; const Lw = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const tri = (a, b2, c, s) => { for (const q of [a, b2, c]) { P.push(q[0] + ox * s, q[1], q[2] + oz * s); } };
    tri(F[0], F[1], F[2], 1); tri(F[1], F[0], F[2], -1); for (let i = 0; i < 6; i++) { const k = i % 3; U.push(k === 0 ? 0 : k === 1 ? Lw / 2.4 : Lw / 4.8, k === 2 ? rise / 2.4 : 0); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.computeVertexNormals(); uvRot(g); K.add(b, g, col); }
  // a gable roof over a rectangle, ridge along u (rx about u) or along v
  function roofU(K, b, col, r, eave, ridge, ov, along) { const t = 0.09; if ((along || "u") === "u") { const vc = (r.v0 + r.v1) / 2, half = (r.v1 - r.v0) / 2, rise = ridge - eave, a = Math.atan2(rise, half), Ls = (half + ov) / Math.cos(a), Lu = r.u1 - r.u0 + ov * 2, cu = (r.u0 + r.u1) / 2;
      for (const sg of [-1, 1]) { const mv = vc + sg * (half + ov) / 2, my = ridge - (half + ov) / 2 * Math.tan(a) + t; const p = l2w(cu, mv); const g = new THREE.BoxGeometry(Lu, t, Ls); uvBox(g, Lu, t, Ls, 1.8); K.place(b, g, col, p[0], my, p[1], 0, sg < 0 ? -a : a); }
      const p = l2w(cu, vc); K.box(b, COL.grey, Lu, 0.12, 0.4, p[0], ridge + 0.14, p[1], 0, 1); }
    else { const uc = (r.u0 + r.u1) / 2, half = (r.u1 - r.u0) / 2, rise = ridge - eave, a = Math.atan2(rise, half), Ls = (half + ov) / Math.cos(a), Lv = r.v1 - r.v0 + ov * 2, cv = (r.v0 + r.v1) / 2;
      for (const sg of [-1, 1]) { const mu = uc + sg * (half + ov) / 2, my = ridge - (half + ov) / 2 * Math.tan(a) + t; const p = l2w(mu, cv); const g = new THREE.BoxGeometry(Ls, t, Lv); uvBox(g, Ls, t, Lv, 1.8); K.place(b, g, col, p[0], my, p[1], 0, 0, sg < 0 ? a : -a); } } }
  // a split-rail fence along local points (posts every ~2.5 m, rails between, solids per span); gaps: [[u, v, w]] gate openings skipped
  function fence(K, pts, o) { o = o || {}; const h = o.h || 1.3, rails = o.rails || [0.5, 1.05], gap = o.gaps || [], step = o.step || 2.5, col = o.col || COL.rail;
    const inGap = (u, v) => gap.some((g) => Math.hypot(u - g[0], v - g[1]) < g[2] / 2);
    for (let i = 0; i < pts.length - 1; i++) { const A = pts[i], B = pts[i + 1], L0 = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.max(1, Math.round(L0 / step));
      for (let k = 0; k <= n; k++) { if (k === n && i < pts.length - 2) continue; const u = lerp(A[0], B[0], k / n), v = lerp(A[1], B[1], k / n); if (inGap(u, v) && !gap.some((g) => Math.abs(Math.hypot(u - g[0], v - g[1]) - g[2] / 2) < 0.3)) continue; const p = l2w(u, v), g0 = gy(u, v);
        if (o.wire) K.box("wood", COL.post, 0.12, h + 0.08, 0.12, p[0], g0 + (h + 0.08) / 2, p[1], 0, 1); else K.cyl("wood", COL.post, 0.09, 0.11, h + 0.12, p[0], g0 + (h + 0.12) / 2 - 0.04, p[1], 7, false, k * 1.3, 0, 0, 1.2); }
      for (let k = 0; k < n; k++) { const ua = lerp(A[0], B[0], k / n), va = lerp(A[1], B[1], k / n), ub = lerp(A[0], B[0], (k + 1) / n), vb = lerp(A[1], B[1], (k + 1) / n); if (inGap((ua + ub) / 2, (va + vb) / 2)) continue;
        const pa = l2w(ua, va), pb = l2w(ub, vb), ga = gy(ua, va), gb = gy(ub, vb), ar = Math.atan2(-(vb - va), ub - ua);
        if (o.wire) { const g = new THREE.PlaneGeometry(Math.hypot(ub - ua, vb - va), h - 0.08); const U = g.attributes.uv; const Lw = Math.hypot(ub - ua, vb - va); for (let q = 0; q < U.count; q++) U.setXY(q, U.getX(q) * Lw / 0.1, U.getY(q) * (h - 0.08) / 0.1); K.place("mesh", g, 0xffffff, (pa[0] + pb[0]) / 2, (ga + gb) / 2 + h / 2 + 0.02, (pa[1] + pb[1]) / 2, ar); K.beam("wood", COL.post, [pa[0], ga + h, pa[1]], [pb[0], gb + h, pb[1]], 0.07, 0.09, 1.2); }
        else rails.forEach((y, ri) => K.rail("wood", ri % 2 ? col : COL.railD, [pa[0], ga + y * h / 1.3, pa[1]], [pb[0], gb + y * h / 1.3, pb[1]], 0.065, 1.4));
        solidL((ua + ub) / 2, (va + vb) / 2, ar, Math.hypot(ub - ua, vb - va), 0.22, Math.min(ga, gb) - 0.1, Math.max(ga, gb) + h, "sanct", { noStep: true }); } } }
  function rectPts(r, m) { m = m || 0; return [[r.u0 - m, r.v0 - m], [r.u1 + m, r.v0 - m], [r.u1 + m, r.v1 + m], [r.u0 - m, r.v1 + m], [r.u0 - m, r.v0 - m]]; }
  // a swing gate panel (closed, in a fence gap): five boards and a brace
  function gatePanel(K, A, B, h, col) { const pa = l2w(A[0], A[1]), pb = l2w(B[0], B[1]), ga = gy(A[0], A[1]); for (const y of [0.3, 0.65, 1.0]) K.beam("wood", col || COL.white, [pa[0], ga + y * h / 1.2, pa[1]], [pb[0], ga + y * h / 1.2, pb[1]], 0.05, 0.12, 1.2); K.beam("wood", col || COL.white, [pa[0], ga + 0.3 * h / 1.2, pa[1]], [pb[0], ga + 1.0 * h / 1.2, pb[1]], 0.05, 0.1, 1.2);
    const ar = Math.atan2(-(B[1] - A[1]), B[0] - A[0]); solidL((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, ar, Math.hypot(B[0] - A[0], B[1] - A[1]), 0.2, ga - 0.1, ga + h, "sanct", { noStep: true }); }
  // hay: a small square bale (1.0 x 0.46 x 0.38 m) with two twines; a round bale; stacks
  function bale(K, u, v, y, a, b) { const p = l2w(u, v), base = b || "hay"; const g = new THREE.BoxGeometry(1.0, 0.38, 0.46, 2, 1, 1); uvBox(g, 1.0, 0.38, 0.46, 0.9); const P = g.attributes.position; for (let i = 0; i < P.count; i++) { P.setY(i, P.getY(i) * (1 - 0.06 * Math.abs(P.getX(i)))); } K.place(base, g, [1, 0.97, 0.9], p[0], y + 0.19, p[1], a);
    for (const s of [-0.26, 0.26]) { const q = l2w(u + Math.cos(-a) * s, v + Math.sin(-a) * s); K.box(base === "ihay" ? "iwood" : "wood", 0x8a6a3a, 0.025, 0.395, 0.475, q[0], y + 0.19, q[1], a); } }
  function roundBale(K, u, v, r, a) { const p = l2w(u, v), y = gy(u, v); const g = new THREE.CylinderGeometry(r, r, 1.2, 16, 1, false); const U = g.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, U.getX(i) * TAU * r / 0.9, U.getY(i) * 1.2 / 0.9); g.rotateZ(PI / 2); K.place("hay", g, [0.95, 0.92, 0.84], p[0], y + r - 0.04, p[1], a); }
  function baleStack(K, u, v, y, a, nx, ny, nz, b) { for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) { if (j === ny - 1 && (i + k) % 3 === 2) continue; const du = (i - (nx - 1) / 2) * 1.02, dv = (k - (nz - 1) / 2) * 0.48 + (j % 2 ? 0.05 : 0); const ca = Math.cos(a), sa = Math.sin(a); bale(K, u + du * ca + dv * sa, v - du * sa + dv * ca, y + j * 0.38, a + (j % 2 ? 0.03 : -0.02), b); } }
  // a galvanised stock tank with water (round); a long trough
  function stockTank(K, u, v, r) { const p = l2w(u, v), y = gy(u, v); K.cyl("metal", COL.steel, r, r, 0.62, p[0], y + 0.31, p[1], 24, true); K.cyl("metal", 0x9ea3a2, r + 0.03, r + 0.03, 0.05, p[0], y + 0.6, p[1], 24, true);
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; K.box("metal", 0x8e9392, 0.02, 0.6, 0.12, p[0] + Math.cos(a) * (r + 0.01), y + 0.3, p[1] + Math.sin(a) * (r + 0.01), -a); }
    const w = new THREE.CircleGeometry(r - 0.02, 24); w.rotateX(-PI / 2); K.place("water", w, COL.water, p[0], y + 0.52, p[1]); K.cyl("metal", 0x7d8282, r - 0.02, r - 0.02, 0.02, p[0], y + 0.02, p[1], 24);
    solidL(u, v, 0, r * 1.7, r * 1.7, y - 0.1, y + 0.62, "sanct", { noStep: true }); EX.tanks.push([u, v, r]); }
  function trough(K, u, v, a, len) { const p = l2w(u, v), y = gy(u, v); K.box("metal", COL.steel, len, 0.5, 0.62, p[0], y + 0.25, p[1], a, 1); const g = new THREE.PlaneGeometry(len - 0.08, 0.54); g.rotateX(-PI / 2); K.place("water", g, COL.water, p[0], y + 0.44, p[1], a); solidL(u, v, a, len, 0.62, y - 0.1, y + 0.5, "sanct", { noStep: true }); EX.troughs.push([u, v, a, len]); }
  // a post lamp (lantern on a timber post); a pool lamp source beside it
  function postLamp(K, u, v, hgt, src) { const p = l2w(u, v), y = gy(u, v); K.box("wood", COL.post, 0.14, hgt, 0.14, p[0], y + hgt / 2, p[1], 0, 1); K.box("wood", COL.post, 0.5, 0.08, 0.08, p[0] + 0.2, y + hgt - 0.1, p[1], 0, 1); K.box("metal", COL.dark, 0.02, 0.1, 0.02, p[0] + 0.42, y + hgt - 0.17, p[1]); K.cyl("metal", COL.dark, 0.02, 0.13, 0.08, p[0] + 0.42, y + hgt - 0.26, p[1], 8); K.cyl("lamp", 0xffe4b0, 0.07, 0.07, 0.2, p[0] + 0.42, y + hgt - 0.4, p[1], 8); for (let q = 0; q < 4; q++) { const aa = q / 4 * TAU + PI / 4; K.box("metal", COL.dark, 0.015, 0.22, 0.015, p[0] + 0.42 + Math.cos(aa) * 0.08, y + hgt - 0.4, p[1] + Math.sin(aa) * 0.08); } K.cyl("metal", COL.dark, 0.09, 0.09, 0.03, p[0] + 0.42, y + hgt - 0.51, p[1], 8); EX.lampHeads.push([p[0] + 0.42, y + hgt - 0.42, p[1]]); if (src) lampSource(p[0] + 0.42, y + hgt - 0.5, p[1], 0xffd6a0, 9, 16, "out"); }
  function lampSource(x, y, z, col, k, dist, tag) { const l = new THREE.PointLight(col, 0, dist, 1.7); l.position.set(x, y, z); l.userData.k0 = k; l.userData.tag = tag; (EX.ext || scene).add(l); EX.lights.push(l); return l; }
  // the sign atlas region onto a board
  function signBoard(K, key, u, v, y, a, w, h, mat) { const rr = SG.r[key]; if (!rr) return; const p = l2w(u, v); K.plane(mat || "sign", 0xffffff, w, h, p[0], y, p[1], a, 0, rr); K.box("wood", COL.dark, w + 0.08, h + 0.08, 0.05, p[0] - Math.sin(a) * 0.03, y, p[1] - Math.cos(a) * 0.03, a, 1); }
  function yardSign(K, i, u, v, a) { const y = gy(u, v); const p = l2w(u, v); K.box("wood", COL.post, 0.1, 1.5, 0.1, p[0] - Math.cos(a) * 0.62, y + 0.75, p[1] + Math.sin(a) * 0.62, a, 1); K.box("wood", COL.post, 0.1, 1.5, 0.1, p[0] + Math.cos(a) * 0.62, y + 0.75, p[1] - Math.sin(a) * 0.62, a, 1); signBoard(K, "y" + i, u + Math.sin(a) * 0.06, v + Math.cos(a) * 0.06, y + 1.2, a, 1.5, 0.34); }
  function bench(K, u, v, a, len, b) { b = b || "wood"; const p = l2w(u, v), y = gy(u, v); K.box(b, 0x8a6a48, len, 0.06, 0.4, p[0], y + 0.45, p[1], a, 1); for (const s of [-0.42, 0.42]) { const q = l2w(u + Math.cos(-a) * s * len, v + Math.sin(-a) * s * len); K.box(b, 0x6a5038, 0.08, 0.45, 0.36, q[0], y + 0.22, q[1], a, 1); } K.box(b, 0x8a6a48, len, 0.3, 0.05, p[0] - Math.sin(a) * 0.2, y + 0.72, p[1] - Math.cos(a) * 0.2, a, 1); seatL(u, v, a, len, 0.42, y + 0.48, a); }
  function picnic(K, u, v, a) { const p = l2w(u, v), y = gy(u, v); K.box("wood", 0x9a7a56, 1.9, 0.06, 0.78, p[0], y + 0.76, p[1], a, 1); for (const s of [-1, 1]) { const q = l2w(u + Math.sin(a) * s * 0.66, v + Math.cos(a) * s * 0.66); K.box("wood", 0x8a6a48, 1.9, 0.05, 0.3, q[0], y + 0.45, q[1], a, 1); seatL(u + Math.sin(a) * s * 0.66, v + Math.cos(a) * s * 0.66, a, 1.8, 0.3, y + 0.47, a + (s > 0 ? PI : 0)); }
    for (const s of [-0.75, 0.75]) { const q = l2w(u + Math.cos(-a) * s, v + Math.sin(-a) * s); K.box("wood", 0x6a5038, 0.08, 0.76, 1.5, q[0], y + 0.38, q[1], a, 1); } solidL(u, v, a, 1.9, 0.78, y + 0.5, y + 0.79, "sanct", { noStep: true }); }

  function buildAll() {
    if (EX.built) return; EX.built = true; EX.tanks = []; EX.troughs = []; EX.obst = []; EX.perch = []; EX.feeders = {};
    const KE = new Kit(), KI = new Kit(); EX.ext = zoneGroup("ext"); EX.int = zoneGroup("int");
    const yB = padY("barn"), yF = padY("feed"), yA = padY("aviary"), yR = padY("ramada");
    // ── the perimeter: a two-rail ranch fence on the footprint, skipped where a yard's own fence runs beside it; three gates ──
    { const yards = [L.horses, L.goats, L.tort, L.aviary]; const nearYard = (u, v) => yards.some((r) => { const du = Math.max(r.u0 - u, 0, u - r.u1), dv = Math.max(r.v0 - v, 0, v - r.v1); return Math.hypot(du, dv) < 2.4; });
      const ring = FOOT.concat([FOOT[0]]); const runs = []; let cur = [];
      for (let i = 0; i < ring.length - 1; i++) { const A = ring[i], B = ring[i + 1], Ln = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.max(1, Math.round(Ln / 2.5)); for (let k = 0; k <= n; k++) { if (k === 0 && i > 0) continue; const u = lerp(A[0], B[0], k / n), v = lerp(A[1], B[1], k / n); if (nearYard(u, v)) { if (cur.length > 1) runs.push(cur); cur = []; } else cur.push([u, v]); } }
      if (cur.length > 1) runs.push(cur);
      const gaps = [[L.gate.u, 42.6, L.gate.w], [L.eastGate[0], L.eastGate[1], 3.6], [L.westGate[0], L.westGate[1], 3.4]];
      runs.forEach((pts) => fence(KE, pts, { h: 1.15, rails: [0.45, 0.95], gaps, step: 2.6, col: COL.rail })); }
    // ── the gate arch: two log posts, the crossbeam, the painted sign, lanterns; the gate leaves standing open ──
    { const g = L.gate, y = padY("court"); const pl = l2w(g.u - g.w / 2 - 0.3, 42.6), pr = l2w(g.u + g.w / 2 + 0.3, 42.6);
      for (const p of [pl, pr]) { KE.cyl("wood", 0x7a6248, 0.2, 0.24, 5.6, p[0], y + 2.75, p[1], 10, false, 0, 0, 0, 1.4); KE.box("stone", 0xc8b8a0, 0.9, 0.5, 0.9, p[0], y + 0.25, p[1], 0, 1.2); solidL(w2l(p[0], p[1])[0], 42.6, 0, 0.6, 0.6, y, y + 5.6); }
      KE.rail("wood", 0x6a5038, [pl[0] - 0.6, y + 5.2, pl[1]], [pr[0] + 0.6, y + 5.2, pr[1]], 0.16, 1.6); KE.rail("wood", 0x6a5038, [pl[0] - 0.3, y + 4.7, pl[1]], [pr[0] + 0.3, y + 4.7, pr[1]], 0.1, 1.6);
      signBoard(KE, "arch", g.u, 42.42, y + 4.05, PI, 5.8, 0.85); signBoard(KE, "arch", g.u, 42.78, y + 4.05, 0, 5.8, 0.85);
      for (const s of [-1, 1]) { const q = l2w(g.u + s * (g.w / 2 + 0.3), 42.6); KE.box("metal", COL.dark, 0.06, 0.4, 0.06, q[0], y + 4.55, q[1] + 0.3); KE.box("lamp", 0xffe0a8, 0.2, 0.3, 0.2, q[0], y + 4.25, q[1] + 0.32); EX.lampHeads.push([q[0], y + 4.25, q[1] + 0.32]); }
      lampSource(l2w(0, 43.6)[0], y + 4.2, l2w(0, 43.6)[1], 0xffd6a0, 10, 18, "out");
      gatePanel(KE, [g.u - g.w / 2, 42.6], [g.u - g.w / 2 - 0.3, 42.6 - 2.1], 1.2); gatePanel(KE, [g.u + g.w / 2, 42.6], [g.u + g.w / 2 + 0.3, 42.6 - 2.1], 1.2);
      // the GIVEBACK board and the mark on the court's welcome post
      { const u = -9.5, v = 36.4, yy = gy(u, v); const p = l2w(u, v); KE.box("wood", COL.post, 0.14, 2.3, 0.14, p[0] - 0.9, yy + 1.15, p[1], 0, 1); KE.box("wood", COL.post, 0.14, 2.3, 0.14, p[0] + 0.9, yy + 1.15, p[1], 0, 1); signBoard(KE, "logo", u, v + 0.08, yy + 1.62, 0, 1.8, 0.82); signBoard(KE, "logo", u, v - 0.08, yy + 1.62, PI, 1.8, 0.82); } }
    // ── the arrival court: benches, hay bale seats, a planter of grasses ──
    { bench(KE, -6.5, 33.2, PI / 2, 1.8); bench(KE, 6.5, 33.2, -PI / 2, 1.8); const yc = padY("court"); baleStack(KE, 9.8, 37.6, yc, 0.3, 2, 2, 1); bale(KE, 8.2, 35.6, yc, 1.2); seatL(8.2, 35.6, 1.2, 0.9, 0.42, yc + 0.39, 0); baleStack(KE, -10, 31.2, yc, -0.4, 1, 1, 2); }
    // ── the Welcome Barn: red board and batten, white trim, a corrugated roof; doors open to the court and the porch ──
    { const B = L.barn, y = yB, h = B.eave; EX.barnY = y;
      // floor (planks, inside) and the plinth
      KI.slab("iwood", 0xb89874, B.u0 + 0.2 + S.O[0], B.v0 + 0.2 + S.O[1], B.u1 - 0.2 + S.O[0], B.v1 - 0.2 + S.O[1], y + 0.12, 2.4); KE.box("stone", 0xb8a890, B.u1 - B.u0 + 0.3, 0.36, B.v1 - B.v0 + 0.3, l2w((B.u0 + B.u1) / 2, 0)[0], y - 0.16, l2w(0, (B.v0 + B.v1) / 2)[1], 0, 1.2);
      // walls: north (windows), south (the big door at the middle, a window each side), west gable (windows), east gable (the wide opening to the porch)
      const W = (A, Bp, ops) => wall(KE, "wood", COL.red, A, Bp, y + 0.12, h, 0.16, ops, 2.4);
      W([B.u0, B.v0], [B.u1, B.v0], [[3.0, 4.4, 2.6, 1.1], [8.8, 10.2, 2.6, 1.1], [15.0, 16.4, 2.6, 1.1]]);
      W([B.u0, B.v1], [B.u1, B.v1], [[2.6, 4.0, 2.6, 1.1], [7.6, 12.0, 3.4, 0], [15.8, 17.2, 2.6, 1.1]]);
      W([B.u0, B.v0], [B.u0, B.v1], [[3.2, 4.6, 2.6, 1.1], [9.4, 10.8, 2.6, 1.1]]);
      W([B.u1, B.v0], [B.u1, B.v1], [[3.4, 10.6, 3.2, 0]]);
      // inside lining (the interior family: walls seen from inside)
      const WI = (A, Bp, ops) => { const mu = (A[0] + Bp[0]) / 2, mv = (A[1] + Bp[1]) / 2, cu0 = (B.u0 + B.u1) / 2, cv0 = (B.v0 + B.v1) / 2; const L0 = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]); let nu = -(Bp[1] - A[1]) / L0, nv = (Bp[0] - A[0]) / L0; if (nu * (cu0 - mu) + nv * (cv0 - mv) < 0) { nu = -nu; nv = -nv; } wallNS(KI, "iwood", 0xd8c8b0, [A[0] + nu * 0.11, A[1] + nv * 0.11], [Bp[0] + nu * 0.11, Bp[1] + nv * 0.11], y + 0.12, h - 0.02, 0.03, ops, 2.4); };
      WI([B.u0, B.v0], [B.u1, B.v0], [[3.0, 4.4, 2.6, 1.1], [8.8, 10.2, 2.6, 1.1], [15.0, 16.4, 2.6, 1.1]]); WI([B.u0, B.v1], [B.u1, B.v1], [[2.6, 4.0, 2.6, 1.1], [7.6, 12.0, 3.4, 0], [15.8, 17.2, 2.6, 1.1]]);
      WI([B.u0, B.v0], [B.u0, B.v1], [[3.2, 4.6, 2.6, 1.1], [9.4, 10.8, 2.6, 1.1]]); WI([B.u1, B.v0], [B.u1, B.v1], [[3.4, 10.6, 3.2, 0]]);
      gable(KE, "wood", COL.red, [B.u0, B.v0], [B.u0, B.v1], y + 0.12 + h, B.ridge - B.eave, 0.16); gable(KE, "wood", COL.red, [B.u1, B.v1], [B.u1, B.v0], y + 0.12 + h, B.ridge - B.eave, 0.16);
      roofU(KE, "roof", COL.roofG, B, y + 0.12 + h, y + 0.12 + B.ridge, 0.6, "u");
      // the ceiling under the roof (inside): two sloped boards following the rafters, and the tie beams
      roofU(KI, "iwood", 0xc8b496, { u0: B.u0 + 0.15, u1: B.u1 - 0.15, v0: B.v0 + 0.15, v1: B.v1 - 0.15 }, y + 0.0 + h, y + B.ridge - 0.12, 0, "u");
      for (let u = B.u0 + 2.5; u < B.u1 - 1; u += 3.2) { const p = l2w(u, (B.v0 + B.v1) / 2); KI.box("iwood", 0x8a6a48, 0.16, 0.22, B.v1 - B.v0 - 0.3, p[0], y + h - 0.1, p[1], 0, 1.2); }
      // white trim: corners, door and window frames, the barn's X braces on the big door leaves (standing open)
      for (const [u, v] of [[B.u0, B.v0], [B.u1, B.v0], [B.u0, B.v1], [B.u1, B.v1]]) { const p = l2w(u, v); KE.box("wood", COL.white, 0.24, h + 0.1, 0.24, p[0], y + 0.12 + h / 2, p[1], 0, 1); }
      const frame = (u0, v0, u1, v1, y0, y1) => { const pa = l2w(u0, v0), pb = l2w(u1, v1); const a = Math.atan2(-(v1 - v0), u1 - u0); const len = Math.hypot(u1 - u0, v1 - v0); const pm = l2w((u0 + u1) / 2, (v0 + v1) / 2);
        KE.box("wood", COL.white, len + 0.24, 0.12, 0.22, pm[0], y1 + 0.06, pm[1], a, 1); if (y0 > y + 0.2) KE.box("wood", COL.white, len + 0.24, 0.1, 0.24, pm[0], y0 - 0.05, pm[1], a, 1); for (const q of [pa, pb]) KE.box("wood", COL.white, 0.12, y1 - y0, 0.22, q[0], (y0 + y1) / 2, q[1], a, 1);
        if (y0 > y + 0.2) { const g = new THREE.PlaneGeometry(len, y1 - y0); for (const s of [-1, 1]) KE.place("lamp", g.clone(), COL.glass, pm[0], (y0 + y1) / 2, pm[1], a + (s < 0 ? PI : 0)); KE.box("wood", COL.white, 0.05, y1 - y0, 0.06, pm[0], (y0 + y1) / 2, pm[1], a); KE.box("wood", COL.white, len, 0.05, 0.06, pm[0], (y0 + y1) / 2, pm[1], a); } };
      const yy = y + 0.12; [[3.0, 4.4], [8.8, 10.2], [15.0, 16.4]].forEach(([a0, a1]) => frame(B.u0 + a0, B.v0, B.u0 + a1, B.v0, yy + 1.1, yy + 2.6)); [[2.6, 4.0], [15.8, 17.2]].forEach(([a0, a1]) => frame(B.u0 + a0, B.v1, B.u0 + a1, B.v1, yy + 1.1, yy + 2.6)); frame(B.u0 + 7.6, B.v1, B.u0 + 12.0, B.v1, yy, yy + 3.4);
      [[3.2, 4.6], [9.4, 10.8]].forEach(([a0, a1]) => frame(B.u0, B.v0 + a0, B.u0, B.v0 + a1, yy + 1.1, yy + 2.6)); frame(B.u1, B.v0 + 3.4, B.u1, B.v0 + 10.6, yy, yy + 3.2);
      // the sliding door leaves pushed aside on their rail (south door), with the white X
      { const rail = l2w(B.u0 + 9.8, B.v1 + 0.2); KE.box("metal", COL.dark, 9.6, 0.08, 0.08, rail[0], yy + 3.55, rail[1] + 0.05, 0); for (const s of [-1, 1]) { const c = l2w(B.u0 + 9.8 + s * 3.35, B.v1 + 0.24); KE.box("wood", COL.redD, 2.2, 3.4, 0.08, c[0], yy + 1.7, c[1], 0, 2.4); KE.beam("wood", COL.white, [c[0] - 1.0, yy + 0.1, c[1] + 0.06], [c[0] + 1.0, yy + 3.3, c[1] + 0.06], 0.04, 0.14, 1); KE.beam("wood", COL.white, [c[0] + 1.0, yy + 0.1, c[1] + 0.06], [c[0] - 1.0, yy + 3.3, c[1] + 0.06], 0.04, 0.14, 1); KE.box("wood", COL.white, 2.2, 0.14, 0.04, c[0], yy + 1.7, c[1] + 0.06, 0); } }
      // the hay loft door in the west gable (closed, white X) and a lantern over the south door
      { const c = l2w(B.u0 - 0.1, (B.v0 + B.v1) / 2); KE.box("wood", COL.redD, 0.08, 1.6, 1.6, c[0], yy + h + 1.0, c[1], 0); KE.box("wood", COL.white, 0.1, 1.7, 0.12, c[0], yy + h + 1.0, c[1], 0); KE.box("wood", COL.white, 0.1, 0.12, 1.7, c[0], yy + h + 1.0, c[1], 0); }
      signBoard(KE, "barn", B.u0 + 9.8, B.v1 + 0.12, yy + 3.95, 0, 3.0, 0.76);
      { const q = l2w(B.u0 + 9.8, B.v1 + 0.5); KE.box("lamp", 0xffe0a8, 0.26, 0.2, 0.26, q[0], yy + 3.62, q[1]); EX.lampHeads.push([q[0], yy + 3.62, q[1]]); lampSource(q[0], yy + 3.4, q[1] + 0.6, 0xffd6a0, 8, 14, "out"); }
      // inside: the welcome desk (an L of boards), shelves of feed sacks and books, benches, hay bale seats, a photo wall, pendant lamps
      { const yi = y + 0.12; const desk = l2w(B.u0 + 13.6, B.v0 + 4.0); KI.box("iwood", 0x8a6a48, 3.2, 1.0, 0.7, desk[0], yi + 0.5, desk[1], 0, 1.2); KI.box("iwood", 0xa88a62, 3.4, 0.06, 0.86, desk[0], yi + 1.03, desk[1], 0, 1.2); KI.box("iwood", 0x8a6a48, 0.7, 1.0, 1.8, desk[0] + 1.25, yi + 0.5, desk[1] + 1.25, 0, 1.2); solidL(B.u0 + 13.6, B.v0 + 4.0, 0, 3.2, 0.7, yi, yi + 1.06, "sanct", { noStep: true }); solidL(B.u0 + 14.85, B.v0 + 5.25, 0, 0.7, 1.8, yi, yi + 1.06, "sanct", { noStep: true });
        EX.desk = [B.u0 + 13.6, B.v0 + 3.1];   // the director stands behind it
        // the guest book and a lamp on the desk
        KI.box("iwood", 0xf1ece0, 0.5, 0.04, 0.36, desk[0] - 0.6, yi + 1.08, desk[1] + 0.1, 0.2); KI.box("imetal", 0x2f5a3a, 0.14, 0.32, 0.14, desk[0] + 0.9, yi + 1.22, desk[1], 0);
        // shelving on the north wall: three bays of feed sacks and boxes
        for (let i = 0; i < 3; i++) { const sh = l2w(B.u0 + 2.2 + i * 2.2, B.v0 + 0.55); for (let j = 0; j < 4; j++) KI.box("iwood", 0x7a5a3c, 2.0, 0.05, 0.5, sh[0], yi + 0.3 + j * 0.55, sh[1], 0, 1.2); KI.box("iwood", 0x6a4a30, 0.06, 2.0, 0.5, sh[0] - 1.0, yi + 1.0, sh[1], 0); const Rn = rng(31 + i); for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) { if (Rn() < 0.3) continue; KI.box("iwood", [0xd8c8a0, 0xb8a078, 0x8aa070, 0xc8a87a][(j + k + i) % 4], 0.36, 0.3 + Rn() * 0.15, 0.36, sh[0] - 0.7 + k * 0.46, yi + 0.47 + j * 0.55, sh[1], Rn() * 0.2); } solidL(B.u0 + 2.2 + i * 2.2, B.v0 + 0.55, 0, 2.0, 0.55, yi, yi + 2.0, "sanct", { noStep: true }); }
        // benches and hay seats in the middle (a talk circle for school visits)
        bench(KI, B.u0 + 6.2, B.v0 + 8.8, 0, 2.2, "iwood"); bench(KI, B.u0 + 6.2, B.v0 + 11.6, PI, 2.2, "iwood"); for (const [du, dv, a] of [[3.6, 10.2, PI / 2], [8.8, 10.2, -PI / 2]]) { bale(KI, B.u0 + du, B.v0 + dv, yi, a, "ihay"); seatL(B.u0 + du, B.v0 + dv, a, 0.46, 1.0, yi + 0.39, a + PI / 2); }
        // a rug of straw matting and the photo wall (the west gable): the residents' portraits as a row of frames (the adoption atlas)
        KI.slab("ihay", 0xe8dcc0, B.u0 + 4.0 + S.O[0], B.v0 + 8.0 + S.O[1], B.u0 + 8.4 + S.O[0], B.v0 + 12.4 + S.O[1], yi + 0.13, 1.2);
        { const p = l2w(B.u0 + 0.21, B.v0 + 7.0), pb = l2w(B.u0 + 0.16, B.v0 + 7.0); KI.plane("board", 0xffffff, 3.4, 2.55, p[0], yi + 1.9, p[1], PI / 2, 0, null); KI.box("iwood", 0x4a3220, 0.06, 2.7, 3.55, pb[0], yi + 1.9, pb[1], 0); }
        // pendant lamps
        for (const du of [4.5, 10, 15.5]) { const p = l2w(B.u0 + du, (B.v0 + B.v1) / 2); KI.box("imetal", COL.dark, 0.02, 1.2, 0.02, p[0], yi + h - 0.8, p[1]); KI.cyl("imetal", 0x2f4a3a, 0.08, 0.32, 0.24, p[0], yi + h - 1.45, p[1], 12, true); KI.box("lamp", 0xffe8c0, 0.14, 0.1, 0.14, p[0], yi + h - 1.56, p[1]); EX.lampHeads.push([p[0], yi + h - 1.56, p[1]]); }
        lampSource(l2w(B.u0 + 5, 0)[0], yi + 2.6, l2w(0, (B.v0 + B.v1) / 2)[1], 0xffd8b0, 6, 13, "in"); lampSource(l2w(B.u0 + 14, 0)[0], yi + 2.6, l2w(0, (B.v0 + B.v1) / 2)[1], 0xffd8b0, 6, 13, "in"); } }
    // ── the volunteer and adoption corner: the east porch (deck, posts, a lean-to roof), the adoption board, the sign-up table ──
    { const P = L.porch, y = yB + 0.12; const pc = l2w((P.u0 + P.u1) / 2, (P.v0 + P.v1) / 2); KE.box("wood", 0xa08664, P.u1 - P.u0, 0.12, P.v1 - P.v0, pc[0], y - 0.04, pc[1], 0, 1.4); solidL((P.u0 + P.u1) / 2, (P.v0 + P.v1) / 2, 0, P.u1 - P.u0, P.v1 - P.v0, yB - 0.4, y + 0.02);
      for (const v of [P.v0 + 0.3, (P.v0 + P.v1) / 2, P.v1 - 0.3]) { const p = l2w(P.u1 - 0.25, v); KE.box("wood", COL.white, 0.18, 3.3, 0.18, p[0], y + 1.65, p[1], 0, 1); solidL(P.u1 - 0.25, v, 0, 0.2, 0.2, y, y + 3.3); }
      { const a = Math.atan2(0.8, P.u1 - P.u0 + 0.6); const g = new THREE.BoxGeometry(P.u1 - P.u0 + 0.8, 0.08, P.v1 - P.v0 + 0.6); uvBox(g, P.u1 - P.u0 + 0.8, 0.08, P.v1 - P.v0 + 0.6, 1.8); KE.place("roof", g, COL.roofG, pc[0] + 0.2, y + 3.75, pc[1], 0, 0, -a); }
      KE.box("wood", COL.white, 0.16, 0.2, P.v1 - P.v0, l2w(P.u1 - 0.25, 0)[0], y + 3.38, pc[1], 0, 1);
      // the adoption board on the barn's east wall, under the porch roof (the talk card's anchor)
      { const p = l2w(P.u0 + 0.17, P.v0 + 4.2), pb = l2w(P.u0 + 0.12, P.v0 + 4.2); KI.plane("board", 0xffffff, 3.2, 2.4, p[0], y + 1.75, p[1], PI / 2, 0, null); KE.box("wood", 0x4a3220, 0.06, 2.56, 3.36, pb[0], y + 1.75, pb[1], 0); KE.box("wood", 0x6a4a30, 0.14, 0.08, 3.4, pb[0] + 0.06, y + 3.0, pb[1], 0); EX.board = [P.u0 + 0.17, P.v0 + 4.2]; }
      // the sign-up table: clipboards, a jar of pencils, a stack of leaflets; a bench; the feeding-times chalk board
      { const t = l2w(P.u0 + 2.2, P.v0 + 9.4); KE.box("wood", 0x9a7a56, 1.6, 0.06, 0.8, t[0], y + 0.76, t[1], PI / 2, 1); for (const s of [-0.65, 0.65]) KE.box("wood", 0x6a5038, 0.7, 0.74, 0.06, t[0], y + 0.37, t[1] + s, 0, 1); KE.box("wood", 0xf1ece0, 0.3, 0.02, 0.4, t[0], y + 0.8, t[1] - 0.3, 0.1); KE.box("wood", 0xb08850, 0.24, 0.02, 0.34, t[0] + 0.05, y + 0.8, t[1] + 0.3, -0.2); KE.cyl("metal", 0x8fb6c0, 0.05, 0.05, 0.12, t[0] - 0.2, y + 0.85, t[1] + 0.05, 8); solidL(P.u0 + 2.2, P.v0 + 9.4, PI / 2, 1.6, 0.8, y, y + 0.8, "sanct", { noStep: true }); EX.signup = [P.u0 + 2.2, P.v0 + 9.4]; }
      bench(KE, P.u0 + 0.6, P.v0 + 12.4, PI / 2, 1.6); { const p = l2w(P.u0 + 0.14, P.v0 + 1.7); KE.plane("sign", 0xffffff, 1.4, 0.64, p[0] + 0.03, y + 1.6, p[1], PI / 2, 0, SG.r.chalk); }
      lampSource(pc[0] + 1, y + 3.0, pc[1], 0xffd6a0, 7, 12, "out"); { const p = l2w(P.u1 - 0.9, (P.v0 + P.v1) / 2); KE.box("lamp", 0xffe0a8, 0.24, 0.16, 0.24, p[0], y + 3.25, p[1]); EX.lampHeads.push([p[0], y + 3.25, p[1]]); } }
    // ── the water trough yard: three stock tanks, a hand pump, a hay rack, the ramada with picnic tables, lanterns ──
    { L.tanks.forEach(([u, v, r]) => stockTank(KE, u, v, r)); { const p = l2w(-0.6, 14.4), y = gy(-0.6, 14.4); KE.box("metal", 0x4a6a5a, 0.16, 1.3, 0.16, p[0], y + 0.65, p[1], 0); KE.box("metal", 0x4a6a5a, 0.5, 0.1, 0.1, p[0] + 0.25, y + 1.1, p[1], 0.3); KE.beam("metal", 0x3a3a3a, [p[0] - 0.05, y + 1.35, p[1]], [p[0] - 0.55, y + 1.65, p[1]], 0.04, 0.04, 1); solidL(-0.6, 14.4, 0, 0.3, 0.3, y, y + 1.3); }
      const Rm = L.ramada; for (const [u, v] of [[Rm.u0, Rm.v0], [Rm.u1, Rm.v0], [Rm.u0, Rm.v1], [Rm.u1, Rm.v1], [(Rm.u0 + Rm.u1) / 2, Rm.v0], [(Rm.u0 + Rm.u1) / 2, Rm.v1]]) { const p = l2w(u, v); KE.box("wood", 0x7a6248, 0.22, 3.2, 0.22, p[0], yR + 1.6, p[1], 0, 1); solidL(u, v, 0, 0.24, 0.24, yR, yR + 3.2); }
      for (const v of [Rm.v0, Rm.v1]) { const a = l2w(Rm.u0 - 0.4, v), b = l2w(Rm.u1 + 0.4, v); KE.beam("wood", 0x6a5038, [a[0], yR + 3.25, a[1]], [b[0], yR + 3.25, b[1]], 0.16, 0.26, 1.4); }
      for (let u = Rm.u0 - 0.2; u <= Rm.u1 + 0.2; u += 0.5) { const a = l2w(u, Rm.v0 - 0.5), b = l2w(u, Rm.v1 + 0.5); KE.beam("wood", 0x8a7050, [a[0], yR + 3.46, a[1]], [b[0], yR + 3.46, b[1]], 0.1, 0.14, 1.4); }
      picnic(KE, 7.6, 21, 0); picnic(KE, 12.4, 21, 0); for (let i = 0; i < 9; i++) { const u = lerp(Rm.u0, Rm.u1, i / 8); const p = l2w(u, (Rm.v0 + Rm.v1) / 2 + Math.sin(i * 1.7) * 0.2); KE.sph("lamp", 0xffe2b0, 0.06, p[0], yR + 3.05 - Math.sin(i / 8 * PI) * 0.25, p[1], 6); EX.lampHeads.push([p[0], yR + 3.0, p[1]]); }
      lampSource(l2w(10, 21)[0], yR + 2.8, l2w(10, 21)[1], 0xffd6a0, 7, 13, "out");
      baleStack(KE, 2.0, 24.6, gy(2, 24.6), 0.1, 3, 3, 2); baleStack(KE, -6.8, 18.2, gy(-6.8, 18.2), 1.5, 2, 2, 1); bench(KE, -4, 4.6, 0, 1.8);
      [[-12, 27], [17.8, 2.5], [-21.5, 1.2], [40, 14.8], [62, 13.6], [28, 14.6], [-30, 2.6], [78.2, -6], [0.8, 38.8]].forEach(([u, v], i) => postLamp(KE, u, v, 2.6, i % 2 === 0));
      yardSign(KE, 5, -6.5, 15.5, 0); yardSign(KE, 6, -12.6, 25.2, PI / 2 + 0.3); yardSign(KE, 7, 2.5, 40.0, PI); }
    // ── the horse and donkey yard: three-rail fence, a run-in shed, a long trough, a round bale feeder, a scratching post ──
    { const r = L.horses; fence(KE, rectPts(r), { h: 1.5, rails: [0.4, 0.82, 1.25], gaps: [[r.u1, -14, 3.2]], col: COL.rail }); gatePanel(KE, [r.u1, -15.6], [r.u1, -12.4], 1.45);
      const Sd = L.shed; const y0 = gy((Sd.u0 + Sd.u1) / 2, (Sd.v0 + Sd.v1) / 2);
      wall(KE, "wood", COL.grey, [Sd.u0, Sd.v0 + 0.1], [Sd.u1, Sd.v0 + 0.1], y0, 2.8, 0.14, [], 2.4); wall(KE, "wood", COL.grey, [Sd.u0 + 0.1, Sd.v0], [Sd.u0 + 0.1, Sd.v1], y0, 2.6, 0.14, [], 2.4); wall(KE, "wood", COL.grey, [Sd.u1 - 0.1, Sd.v0], [Sd.u1 - 0.1, Sd.v0 + 3.6], y0, 2.8, 0.14, [], 2.4);
      for (const u of [Sd.u0 + 0.2, (Sd.u0 + Sd.u1) / 2, Sd.u1 - 0.2]) { const p = l2w(u, Sd.v1); KE.box("wood", COL.post, 0.2, 2.4, 0.2, p[0], y0 + 1.2, p[1], 0, 1); }
      { const a = Math.atan2(0.5, Sd.v1 - Sd.v0); const g = new THREE.BoxGeometry(Sd.u1 - Sd.u0 + 0.8, 0.08, Sd.v1 - Sd.v0 + 1.0); uvBox(g, Sd.u1 - Sd.u0 + 0.8, 0.08, Sd.v1 - Sd.v0 + 1.0, 1.8); const p = l2w((Sd.u0 + Sd.u1) / 2, (Sd.v0 + Sd.v1) / 2 + 0.3); KE.place("roof", g, COL.roofR, p[0], y0 + 2.65, p[1], 0, a); }
      KE.drape("hay", 0xd8c8a0, Sd.u0 + 0.3, Sd.v0 + 0.3, Sd.u1 - 0.3, Sd.v1 - 0.6, 0.05, 1.1, 2); EX.obst.push([Sd.u0 - 0.6, Sd.v0 - 0.6, Sd.u1 + 0.6, Sd.v0 + 2.2]);
      trough(KE, -34, -3.0, 0, 3.0); EX.obst.push([-36, -4.2, -32, -1.8]); roundBale(KE, -46, -26, 0.75, 0.4); EX.obst.push([-47.6, -27.6, -44.4, -24.4]); { const p = l2w(-46, -26), y = gy(-46, -26); for (let k = 0; k < 10; k++) { const a = k / 10 * TAU; KE.box("metal", 0x6a7a6a, 0.05, 1.1, 0.05, p[0] + Math.cos(a) * 1.05, y + 0.55, p[1] + Math.sin(a) * 1.05); } KE.cyl("metal", 0x6a7a6a, 1.07, 1.07, 0.05, p[0], y + 1.08, p[1], 20, true); KE.cyl("metal", 0x6a7a6a, 1.07, 1.07, 0.05, p[0], y + 0.4, p[1], 20, true); }
      EX.feeders.horses = [[-46, -26], [-34, -3.0]]; yardSign(KE, 0, r.u1 + 1.8, -9.6, -PI / 2); KE.drape("dirt", 0xece0d0, r.u0 + 0.4, r.v0 + 0.4, r.u1 - 0.4, r.v1 - 0.4, 0.035, 4.6, 3, (u, v) => !inRect(u, v, Sd, 0.2)); }
    // ── the goat and sheep yard: post and wire mesh, a shelter, climbing spools and a plank deck, a hay rack, a trough ──
    { const r = L.goats; fence(KE, rectPts(r), { h: 1.25, wire: true, gaps: [[r.u1, -24, 2.4]] }); gatePanel(KE, [r.u1, -25.2], [r.u1, -22.8], 1.2);
      const Sd = L.gshed, y0 = gy((Sd.u0 + Sd.u1) / 2, (Sd.v0 + Sd.v1) / 2);
      wall(KE, "wood", 0xc8b49a, [Sd.u0, Sd.v0 + 0.1], [Sd.u1, Sd.v0 + 0.1], y0, 2.2, 0.12, [], 2.4); wall(KE, "wood", 0xc8b49a, [Sd.u0 + 0.1, Sd.v0], [Sd.u0 + 0.1, Sd.v1], y0, 2.0, 0.12, [], 2.4); for (const u of [Sd.u0 + 0.2, Sd.u1 - 0.2]) { const p = l2w(u, Sd.v1); KE.box("wood", COL.post, 0.16, 1.9, 0.16, p[0], y0 + 0.95, p[1], 0, 1); }
      { const a = Math.atan2(0.4, Sd.v1 - Sd.v0); const g = new THREE.BoxGeometry(Sd.u1 - Sd.u0 + 0.6, 0.07, Sd.v1 - Sd.v0 + 0.8); uvBox(g, 9, 0.07, 7, 1.8); const p = l2w((Sd.u0 + Sd.u1) / 2, (Sd.v0 + Sd.v1) / 2 + 0.2); KE.place("roof", g, COL.roofR, p[0], y0 + 2.08, p[1], 0, a); }
      KE.drape("hay", 0xd8c8a0, Sd.u0 + 0.3, Sd.v0 + 0.3, Sd.u1 - 0.3, Sd.v1 - 0.5, 0.05, 1.1, 2); EX.obst.push([Sd.u0 - 0.5, Sd.v0 - 0.5, Sd.u1 + 0.5, Sd.v0 + 2.0]);
      // cable spools (big wooden reels) and the plank deck the goats climb: the goats' "perches"
      EX.spools = []; [[-4, -30, 0.75, 0.62], [0.5, -32.5, 0.55, 0.5], [6, -28, 0.85, 0.7]].forEach(([u, v, rr, hh]) => { const p = l2w(u, v), y = gy(u, v); KE.cyl("wood", 0xa88a62, rr, rr, 0.08, p[0], y + hh, p[1], 18, false, 0, 0, 0, 1.2); KE.cyl("wood", 0xa88a62, rr, rr, 0.08, p[0], y + 0.04, p[1], 18, false, 0, 0, 0, 1.2); KE.cyl("wood", 0x8a6a48, rr * 0.45, rr * 0.45, hh, p[0], y + hh / 2, p[1], 12, false, 0, 0, 0, 1.2); EX.spools.push([u, v, hh + 0.04, rr]); EX.obst.push([u - rr - 0.3, v - rr - 0.3, u + rr + 0.3, v + rr + 0.3]); });
      { const u = -10, v = -22, y = gy(u, v); const p = l2w(u, v); KE.box("wood", 0xa08664, 3.2, 0.08, 1.6, p[0], y + 0.85, p[1], 0, 1.4); for (const [a, b] of [[-1.5, -0.7], [1.5, -0.7], [-1.5, 0.7], [1.5, 0.7]]) KE.box("wood", COL.post, 0.12, 0.85, 0.12, p[0] + a, y + 0.42, p[1] + b, 0, 1); KE.beam("wood", 0xa08664, [p[0] + 1.6, y + 0.85, p[1]], [p[0] + 3.6, y + 0.05, p[1]], 0.9, 0.06, 1.2); EX.deck = [u, v, 0.89]; EX.obst.push([u - 1.9, v - 1.1, u + 3.8, v + 1.1]); }
      trough(KE, 4, -6.4, 0, 2.4); EX.obst.push([2.4, -7.4, 5.6, -5.4]); { const p = l2w(-15, -14), y = gy(-15, -14); KE.box("wood", COL.post, 2.2, 0.08, 0.5, p[0], y + 0.5, p[1], 0, 1); for (let i = 0; i < 8; i++) KE.box("wood", COL.post, 0.04, 0.7, 0.04, p[0] - 1.0 + i * 0.28, y + 0.9, p[1] + 0.12); baleStack(KE, -15, -14.05, y + 0.54, 0, 2, 1, 1); EX.obst.push([-16.4, -14.6, -13.6, -13.4]); }
      EX.feeders.goats = [[-15, -14], [4, -6.4]]; yardSign(KE, 1, r.u1 + 1.7, -19.2, -PI / 2); KE.drape("yard", 0xd8c8b0, r.u0 + 0.4, r.v0 + 0.4, r.u1 - 0.4, r.v1 - 0.4, 0.035, 4.6, 3, (u, v) => !inRect(u, v, Sd, 0.2)); }
    // ── the desert tortoise garden: a low stone wall, burrows in earth mounds, flat basking stones, shade boards, a water saucer ──
    { const r = L.tort; const pts = rectPts(r); for (let i = 0; i < 4; i++) { const A = pts[i], B = pts[i + 1], Ln = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.round(Ln / 0.62); for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, u = lerp(A[0], B[0], t), v = lerp(A[1], B[1], t), p = l2w(u, v), y = gy(u, v); const Rn = rng(k * 13 + i * 7); KE.box("rock", [0xb4ac9e, 0x9e988c, 0xc4b8a6][k % 3], 0.5 + Rn() * 0.16, 0.36 + Rn() * 0.18, 0.4 + Rn() * 0.08, p[0], y + 0.22, p[1], Math.atan2(-(B[1] - A[1]), B[0] - A[0]) + (Rn() - 0.5) * 0.12, 0.9); }
        const ar = Math.atan2(-(B[1] - A[1]), B[0] - A[0]); solidL((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, ar, Ln, 0.45, gy((A[0] + B[0]) / 2, (A[1] + B[1]) / 2) - 0.1, gy((A[0] + B[0]) / 2, (A[1] + B[1]) / 2) + 0.55, "sanct", { noStep: true }); }
      EX.burrows = []; [[22.5, -33.5, 0.4], [32.5, -31.5, -1.2], [26, -24, 2.6]].forEach(([u, v, a]) => { const p = l2w(u, v), y = gy(u, v); KE.sph("dirt", 0xc8a888, 1.1, p[0], y - 0.35, p[1], 16, 1.25, 0.62, 1.0); const q = l2w(u + Math.sin(a) * 0.95, v + Math.cos(a) * 0.95); KE.sph("stone", 0x241a12, 0.3, q[0], y + 0.05, q[1], 10, 1.2, 0.7, 0.6); EX.burrows.push([u + Math.sin(a) * 1.5, v + Math.cos(a) * 1.5, a + PI]); EX.obst.push([u - 1.3, v - 1.3, u + 1.3, v + 1.3]); });
      [[28.5, -28.5], [23.5, -28.0], [31, -24.5], [34.5, -29.5]].forEach(([u, v], i) => { const p = l2w(u, v), y = gy(u, v); KE.cyl("rock", 0xe0d8c8, 0.55 + i * 0.05, 0.6 + i * 0.05, 0.12, p[0], y + 0.04, p[1], 9, false, i); });
      { const u = 34.5, v = -34.5, y = gy(u, v); const p = l2w(u, v); KE.box("wood", 0x9a8466, 1.6, 0.05, 1.2, p[0], y + 0.42, p[1], 0.3, 1, 0.18); KE.box("wood", COL.post, 0.08, 0.4, 0.08, p[0] - 0.6, y + 0.2, p[1] - 0.4); KE.box("wood", COL.post, 0.08, 0.4, 0.08, p[0] + 0.6, y + 0.2, p[1] + 0.4); }
      { const p = l2w(29.6, -21.6), y = gy(29.6, -21.6); KE.cyl("stone", 0xb8a890, 0.34, 0.3, 0.07, p[0], y + 0.035, p[1], 16); const w = new THREE.CircleGeometry(0.28, 16); w.rotateX(-PI / 2); KE.place("water", w, COL.water, p[0], y + 0.065, p[1]); EX.saucer = [29.6, -21.6]; }
      KE.drape("yard", 0xe0c8a8, r.u0 + 0.3, r.v0 + 0.3, r.u1 - 0.3, r.v1 - 0.3, 0.03, 5.2, 3); yardSign(KE, 2, 16.6 + 1.0, -35.6, -PI / 2 + 0.0); }
    // ── the small-animal yard: a low wire fence, three raised rabbit hutches, a hen coop with its ramp and nest box, feeders, a straw corner ──
    { const r = L.hutch; fence(KE, rectPts(r), { h: 0.95, wire: true, gaps: [[r.u0, -6, 1.4]] }); gatePanel(KE, [r.u0, -6.7], [r.u0, -5.3], 0.9);
      EX.hutches = []; [[22, -14.2], [26.6, -14.2], [31.2, -14.2]].forEach(([u, v], i) => { const p = l2w(u, v), y = gy(u, v); KE.box("wood", 0xc8a878, 1.8, 0.7, 0.9, p[0], y + 0.95, p[1], 0, 1.2); KE.box("roof", COL.roofG, 2.0, 0.06, 1.1, p[0], y + 1.36, p[1] + 0.05, 0, 1.4, -0.12); for (const [a, b] of [[-0.8, -0.35], [0.8, -0.35], [-0.8, 0.35], [0.8, 0.35]]) KE.box("wood", COL.post, 0.07, 0.62, 0.07, p[0] + a, y + 0.3, p[1] + b, 0, 1); const g = new THREE.PlaneGeometry(1.1, 0.55); const U = g.attributes.uv; for (let q = 0; q < U.count; q++) U.setXY(q, U.getX(q) * 11, U.getY(q) * 5.5); KE.place("mesh", g, 0xffffff, p[0] + 0.3, y + 0.95, p[1] + 0.452, 0); KE.beam("wood", 0xa88a62, [p[0] - 0.4, y + 0.62, p[1] + 0.5], [p[0] - 0.4, y + 0.02, p[1] + 1.4], 0.3, 0.04, 1); EX.hutches.push([u - 0.4, v + 1.7]); EX.obst.push([u - 1.0, v - 0.6, u + 1.0, v + 1.6]); solidL(u, v, 0, 1.8, 0.9, y, y + 1.4, "sanct", { noStep: true }); });
      { const u = 33.4, v = -4.0, y = gy(u, v); const p = l2w(u, v); KE.box("wood", 0xb05a3a, 2.6, 1.6, 2.0, p[0], y + 1.1, p[1], 0, 1.2); for (const [a, b] of [[-1.2, -0.9], [1.2, -0.9], [-1.2, 0.9], [1.2, 0.9]]) KE.box("wood", COL.post, 0.1, 0.32, 0.1, p[0] + a, y + 0.16, p[1] + b); gable(KE, "wood", 0xb05a3a, [u - 1.3, v - 1.0], [u - 1.3, v + 1.0], y + 1.9, 0.7, 0.04); gable(KE, "wood", 0xb05a3a, [u + 1.3, v + 1.0], [u + 1.3, v - 1.0], y + 1.9, 0.7, 0.04); roofU(KE, "roof", COL.roofR, { u0: u - 1.3, u1: u + 1.3, v0: v - 1.0, v1: v + 1.0 }, y + 1.9, y + 2.6, 0.2, "u"); KE.box("wood", COL.white, 0.5, 0.6, 0.04, p[0] - 0.6, y + 0.9, p[1] + 1.01); KE.beam("wood", 0xa88a62, [p[0] - 0.6, y + 0.62, p[1] + 1.1], [p[0] - 0.6, y + 0.02, p[1] + 2.4], 0.42, 0.04, 1); KE.box("wood", 0xb05a3a, 0.7, 0.5, 0.7, p[0] + 1.6, y + 0.85, p[1] + 0.2, 0, 1.2); EX.coop = [u - 0.6, v + 2.8]; EX.obst.push([u - 1.6, v - 1.3, u + 2.1, v + 2.6]); solidL(u, v, 0, 2.6, 2.0, y, y + 2.6, "sanct", { noStep: true }); }
      { const u = 22.6, v = -2.6, y = gy(u, v); KE.drape("hay", 0xe8d8b0, u - 1.6, v - 1.4, u + 1.6, v + 1.4, 0.04, 1.0, 1); const p = l2w(26.8, -6), y2 = gy(26.8, -6); KE.cyl("metal", COL.steel, 0.32, 0.36, 0.28, p[0], y2 + 0.14, p[1], 14, false); KE.cyl("metal", COL.steel, 0.12, 0.12, 0.4, p[0], y2 + 0.48, p[1], 10); EX.feeders.hutch = [[26.8, -6], [29.4, -8.6]]; const p3 = l2w(29.4, -8.6); KE.cyl("metal", 0x9aa0a0, 0.28, 0.24, 0.1, p3[0], gy(29.4, -8.6) + 0.05, p3[1], 14); }
      yardSign(KE, 3, r.u0 - 1.8, -9.5, PI / 2); KE.drape("yard", 0xd8c8b0, r.u0 + 0.3, r.v0 + 0.3, r.u1 - 0.3, r.v1 - 0.3, 0.03, 4.6, 3); }
    // ── the aviary: a steel frame, welded mesh walls and roof, a half shade roof, a vestibule with two doors, branch perches, nest boxes ──
    { const r = L.aviary, y = yA, Hh = r.h, du = r.u1 - r.u0, dv = r.v1 - r.v0, door = [52, 54.2];
      KE.drape("yard", 0xd8c4a4, r.u0 + 0.1, r.v0 + 0.1, r.u1 - 0.1, r.v1 - 0.1, 0.04, 4.0, 2);
      for (let i = 0; i <= 6; i++) for (const v of [r.v0, r.v1]) { const u = lerp(r.u0, r.u1, i / 6), p = l2w(u, v); KE.box("metal", 0x3f4a44, 0.12, Hh, 0.12, p[0], y + Hh / 2, p[1]); }
      for (let j = 1; j < 5; j++) for (const u of [r.u0, r.u1]) { const v = lerp(r.v0, r.v1, j / 5), p = l2w(u, v); KE.box("metal", 0x3f4a44, 0.12, Hh, 0.12, p[0], y + Hh / 2, p[1]); }
      for (const v of [r.v0, r.v1]) { const a = l2w(r.u0, v), b = l2w(r.u1, v); KE.beam("metal", 0x3f4a44, [a[0], y + Hh, a[1]], [b[0], y + Hh, b[1]], 0.1, 0.12, 1); }
      for (let i = 0; i <= 6; i++) { const u = lerp(r.u0, r.u1, i / 6), a = l2w(u, r.v0), b = l2w(u, r.v1); KE.beam("metal", 0x3f4a44, [a[0], y + Hh, a[1]], [b[0], y + Hh, b[1]], 0.08, 0.1, 1); }
      const meshPlane = (cx, cz, w, h, yc, ry, rx) => { const g = new THREE.PlaneGeometry(w, h); const U = g.attributes.uv; for (let q = 0; q < U.count; q++) U.setXY(q, U.getX(q) * w / 0.1, U.getY(q) * h / 0.1); KE.place("mesh", g, 0xffffff, cx, yc, cz, ry, rx || 0); };
      { const c = l2w((r.u0 + r.u1) / 2, r.v0); meshPlane(c[0], c[1], du, Hh, y + Hh / 2, 0); } for (const u of [r.u0, r.u1]) { const c = l2w(u, (r.v0 + r.v1) / 2); meshPlane(c[0], c[1], dv, Hh, y + Hh / 2, PI / 2); }
      { const c = l2w((r.u0 + door[0]) / 2, r.v1); meshPlane(c[0], c[1], door[0] - r.u0, Hh, y + Hh / 2, 0); const c2 = l2w((door[1] + r.u1) / 2, r.v1); meshPlane(c2[0], c2[1], r.u1 - door[1], Hh, y + Hh / 2, 0); const c3 = l2w((door[0] + door[1]) / 2, r.v1); meshPlane(c3[0], c3[1], door[1] - door[0], Hh - 2.3, y + 2.3 + (Hh - 2.3) / 2, 0); }
      { const c = l2w((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2); meshPlane(c[0], c[1], du, dv, y + Hh, 0, -PI / 2); }
      // a timber kickboard along the foot of the walls and a mid rail (the cage reads as an enclosure from far off, where the fine mesh fades)
      { const kb = (A, B2) => { const a0 = l2w(A[0], A[1]), b0 = l2w(B2[0], B2[1]); KE.beam("wood", 0x8a7458, [a0[0], y + 0.22, a0[1]], [b0[0], y + 0.22, b0[1]], 0.06, 0.44, 1.2); KE.beam("metal", 0x3f4a44, [a0[0], y + 2.4, a0[1]], [b0[0], y + 2.4, b0[1]], 0.06, 0.06, 1); };
        kb([r.u0, r.v0], [r.u1, r.v0]); kb([r.u0, r.v0], [r.u0, r.v1]); kb([r.u1, r.v0], [r.u1, r.v1]); kb([r.u0, r.v1], [door[0], r.v1]); kb([door[1], r.v1], [r.u1, r.v1]); }
      // the shade roof over the north half (owls roost under it); the vestibule outside the door (a small mesh box, both doors standing open)
      { const g = new THREE.BoxGeometry(du + 0.4, 0.06, dv * 0.5 + 0.3); uvBox(g, du, 0.06, dv * 0.5, 1.8); const p = l2w((r.u0 + r.u1) / 2, r.v0 + dv * 0.25); KE.place("roof", g, COL.roofG, p[0], y + Hh + 0.12, p[1], 0); }
      { const v0 = r.v1, v1 = r.v1 + 2.0; for (const u of door) for (const v of [v1]) { const p = l2w(u, v); KE.box("metal", 0x3f4a44, 0.1, 2.5, 0.1, p[0], y + 1.25, p[1]); } { const a = l2w(door[0], v1), b = l2w(door[1], v1); KE.beam("metal", 0x3f4a44, [a[0], y + 2.5, a[1]], [b[0], y + 2.5, b[1]], 0.08, 0.1, 1); } for (const u of door) { const c = l2w(u, (v0 + v1) / 2); meshPlane(c[0], c[1], 2.0, 2.5, y + 1.25, PI / 2); solidL(u, (v0 + v1) / 2, PI / 2, 2.0, 0.12, y, y + 2.5); } { const c = l2w((door[0] + door[1]) / 2, (v0 + v1) / 2); meshPlane(c[0], c[1], door[1] - door[0], 2.0, y + 2.5, 0, -PI / 2); }
        // the inner door leaf open inward, the outer open outward
        { const p = l2w(door[0] + 0.05, r.v1 - 0.9); meshPlane(p[0], p[1], 1.8, 2.2, y + 1.12, PI / 2); KE.box("metal", 0x3f4a44, 0.06, 2.2, 0.06, p[0], y + 1.1, l2w(0, r.v1 - 1.8)[1]); } }
      // walls are solids except the door gap; the frame posts too
      solidL((r.u0 + r.u1) / 2, r.v0, 0, du, 0.14, y, y + Hh); solidL(r.u0, (r.v0 + r.v1) / 2, PI / 2, dv, 0.14, y, y + Hh); solidL(r.u1, (r.v0 + r.v1) / 2, PI / 2, dv, 0.14, y, y + Hh); solidL((r.u0 + door[0]) / 2, r.v1, 0, door[0] - r.u0, 0.14, y, y + Hh); solidL((door[1] + r.u1) / 2, r.v1, 0, r.u1 - door[1], 0.14, y, y + Hh);
      // perches: a dead tree (trunk and branches), two cross bars, a shelf; the owls take these spots (local u, v, y above the floor, yaw)
      { const tu = 47, tv = -27, p = l2w(tu, tv); KE.cyl("wood", 0x8a7a68, 0.18, 0.28, 3.6, p[0], y + 1.8, p[1], 9, false, 0, 0, 0, 1.4); const br = [[[0, 2.2, 0], [1.4, 2.9, 0.3]], [[0, 2.8, 0], [-1.2, 3.4, -0.5]], [[0, 1.6, 0], [0.4, 2.0, 1.4]], [[0, 3.3, 0], [0.6, 3.9, -0.9]]]; br.forEach(([a, b]) => KE.tube("wood", 0x8a7a68, [p[0] + a[0], y + a[1], p[1] + a[2]], [p[0] + b[0], y + b[1], p[1] + b[2]], 0.07, 7)); EX.obst.push([tu - 0.6, tv - 0.6, tu + 0.6, tv + 0.6]);
        EX.perch.push([tu + 1.15, tv + 0.25, 2.82, -0.6], [tu - 1.0, tv - 0.42, 3.32, 2.4]); }
      for (const [u0, v0, u1, v1, hh] of [[55, -30.5, 61, -30.5, 2.6], [56, -19.5, 62, -21, 1.8]]) { const a = l2w(u0, v0), b = l2w(u1, v1); KE.tube("wood", 0x9a8670, [a[0], y + hh, a[1]], [b[0], y + hh, b[1]], 0.06, 7); for (const q of [a, b]) KE.box("wood", 0x7a6a58, 0.1, hh, 0.1, q[0], y + hh / 2, q[1]); EX.perch.push([lerp(u0, u1, 0.5), lerp(v0, v1, 0.5), hh + 0.04, 0.4]); }
      [[r.u0 + 0.3, -26, PI / 2], [r.u1 - 0.3, -22, -PI / 2]].forEach(([u, v, a]) => { const p = l2w(u, v); KE.box("wood", 0x8a6a48, 0.6, 0.6, 0.5, p[0], y + 3.2, p[1], a, 1); KE.cyl("stone", 0x241a12, 0.1, 0.1, 0.03, p[0] + Math.sin(a) * 0.26, y + 3.25, p[1] + Math.cos(a) * 0.26, 10, false, 0, PI / 2, a); });
      // ground: logs and a water dish for the quail, a few grass tufts (engine kinds placed later)
      [[45.5, -18, 0.9], [60, -26, 1.4]].forEach(([u, v, len]) => { const p = l2w(u, v); KE.rail("wood", 0x8a7a68, [p[0] - len, y + 0.16, p[1]], [p[0] + len, y + 0.16, p[1] + 0.3], 0.16, 1.2); EX.obst.push([u - len - 0.3, v - 0.4, u + len + 0.3, v + 0.6]); });
      { const p = l2w(50, -17); KE.cyl("stone", 0xb8a890, 0.4, 0.35, 0.08, p[0], y + 0.04, p[1], 16); const w = new THREE.CircleGeometry(0.33, 16); w.rotateX(-PI / 2); KE.place("water", w, COL.water, p[0], y + 0.075, p[1]); }
      yardSign(KE, 4, 50.2, -12.0, 0); lampSource(l2w(53, -12.4)[0], y + 2.6, l2w(53, -12.4)[1], 0xffd6a0, 5, 10, "out"); }
    // ── the feed and care barn: grey-green boards, the feed room open to the south porch, the vet clinic behind a wall at the east end ──
    { const F = L.feed, y = yF + 0.1, h = F.eave, cu = F.clinic; EX.feedY = y;
      KE.box("stone", 0xb8a890, F.u1 - F.u0 + 0.3, 0.36, F.v1 - F.v0 + 0.3, l2w((F.u0 + F.u1) / 2, 0)[0], y - 0.2, l2w(0, (F.v0 + F.v1) / 2)[1], 0, 1.2);
      KI.slab("iwood", 0x9a8a78, F.u0 + 0.2 + S.O[0], F.v0 + 0.2 + S.O[1], cu - 0.1 + S.O[0], F.v1 - 0.2 + S.O[1], y + 0.06, 2.4); KI.slab("iwood", 0xd8dcd6, cu + 0.1 + S.O[0], F.v0 + 0.2 + S.O[1], F.u1 - 0.2 + S.O[0], F.v1 - 0.2 + S.O[1], y + 0.06, 1.0);
      const W = (A, Bp, ops, col) => wall(KE, "wood", col || COL.green, A, Bp, y, h, 0.16, ops, 2.4);
      W([F.u0, F.v0], [F.u1, F.v0], [[17, 18.4, 2.5, 1.1], [20.4, 21.8, 2.5, 1.1]]); W([F.u0, F.v1], [F.u1, F.v1], [[1.2, 13.8, 3.3, 0], [16.6, 18.0, 2.3, 0], [20.2, 21.8, 2.5, 1.1]]); W([F.u0, F.v0], [F.u0, F.v1], [[5, 9, 3.0, 0]]); W([F.u1, F.v0], [F.u1, F.v1], [[5.5, 7, 2.5, 1.1]]);
      wall(KI, "iwood", 0xe8e4dc, [cu, F.v0], [cu, F.v1], y, h, 0.12, [[9.6, 11.2, 2.2, 0]], 2.4);   // the clinic partition (a door to the feed room)
      gable(KE, "wood", COL.green, [F.u0, F.v0], [F.u0, F.v1], y + h, F.ridge - F.eave, 0.16); gable(KE, "wood", COL.green, [F.u1, F.v1], [F.u1, F.v0], y + h, F.ridge - F.eave, 0.16);
      roofU(KE, "roof", COL.roofR, F, y + h, y + F.ridge, 0.6, "u"); roofU(KI, "iwood", 0xc0ac90, { u0: F.u0 + 0.15, u1: F.u1 - 0.15, v0: F.v0 + 0.15, v1: F.v1 - 0.15 }, y + h - 0.1, y + F.ridge - 0.14, 0, "u");
      for (const [u, v] of [[F.u0, F.v0], [F.u1, F.v0], [F.u0, F.v1], [F.u1, F.v1]]) { const p = l2w(u, v); KE.box("wood", COL.white, 0.22, h, 0.22, p[0], y + h / 2, p[1], 0, 1); }
      // the south porch (lean-to on posts) and the signs
      { const pc = l2w((F.u0 + F.u1) / 2, F.v1 + 1.8); KE.box("wood", 0xa08664, F.u1 - F.u0, 0.1, 3.4, pc[0], y - 0.02, pc[1], 0, 1.4); for (let u = F.u0 + 0.3; u <= F.u1; u += 4.7) { const p = l2w(u, F.v1 + 3.3); KE.box("wood", COL.white, 0.18, 3.1, 0.18, p[0], y + 1.55, p[1], 0, 1); solidL(u, F.v1 + 3.3, 0, 0.2, 0.2, y, y + 3.1); } const a = Math.atan2(0.5, 3.6); const g = new THREE.BoxGeometry(F.u1 - F.u0 + 0.6, 0.08, 3.9); uvBox(g, 24, 0.08, 3.9, 1.8); KE.place("roof", g, COL.roofR, pc[0], y + 3.5, pc[1] + 0.1, 0, a); }
      signBoard(KE, "feed", (F.u0 + F.u1) / 2 - 4.4, F.v1 + 0.12, y + h - 0.45, 0, 2.6, 0.66);
      { const q = l2w(cu + 4.6, F.v1 + 0.13); KE.plane("sign", 0xffffff, 0.9, 0.42, q[0], y + 2.6, q[1], 0, 0, SG.r.mark); }
      // feed room: hay bales stacked to the eaves, grain bins, buckets and a scale, a wheelbarrow, the chalk board
      baleStack(KI, F.u0 + 2.6, F.v0 + 1.6, y + 0.06, 0, 4, 5, 3, "ihay"); baleStack(KI, F.u0 + 8.0, F.v0 + 1.2, y + 0.06, 0, 3, 3, 2, "ihay"); solidL(F.u0 + 2.6, F.v0 + 1.6, 0, 4.2, 1.6, y, y + 1.9, "sanct", { noStep: true }); solidL(F.u0 + 8.0, F.v0 + 1.2, 0, 3.2, 1.1, y, y + 1.2, "sanct", { noStep: true });
      for (let i = 0; i < 4; i++) { const p = l2w(F.u0 + 11.2 + i * 0.95, F.v0 + 0.7); KI.cyl("imetal", [0xb8bcbc, 0x6a8a6a, 0xb8bcbc, 0x8a6a4a][i], 0.4, 0.4, 0.95, p[0], y + 0.53, p[1], 16); KI.cyl("imetal", 0x8e9392, 0.41, 0.41, 0.06, p[0], y + 1.02, p[1], 16); } solidL(F.u0 + 12.6, F.v0 + 0.7, 0, 3.8, 0.85, y, y + 1.05, "sanct", { noStep: true });
      for (let i = 0; i < 5; i++) { const p = l2w(F.u0 + 9.6 + i * 0.42, F.v0 + 3.6); KI.cyl("imetal", [0x3a6a9a, 0xb5332a, 0x3a6a9a, 0xd9a441, 0x6a8a6a][i], 0.15, 0.13, 0.3, p[0], y + 0.21, p[1], 10, true); }
      { const p = l2w(F.u0 + 6, F.v0 + 5.6); KI.box("imetal", 0x5a7a5a, 0.7, 0.32, 1.2, p[0], y + 0.5, p[1], 0.4); KI.cyl("imetal", 0x222222, 0.2, 0.2, 0.1, p[0] - 0.25, y + 0.22, p[1] + 0.55, 12, false, 0, 0, PI / 2); }
      { const p = l2w(F.u0 + 0.12, F.v0 + 10.4); KI.plane("sign", 0xffffff, 1.4, 0.64, p[0] + 0.03, y + 1.7, p[1], PI / 2, 0, SG.r.chalk); }
      for (const du of [3, 8, 13]) { const p = l2w(F.u0 + du, (F.v0 + F.v1) / 2); KI.box("lamp", 0xfff0d0, 0.5, 0.06, 0.16, p[0], y + h - 0.3, p[1]); EX.lampHeads.push([p[0], y + h - 0.3, p[1]]); }
      // the vet clinic: an exam table, wall cabinets and a counter with a sink, a stool, a lamp on an arm, the care poster, a recovery stall with straw
      { const yy = y + 0.06, tb = l2w(cu + 4.2, F.v0 + 6.2); KI.box("imetal", 0xd0d4d4, 2.0, 0.08, 0.9, tb[0], yy + 0.86, tb[1], 0, 1); KI.box("imetal", 0x8a9090, 0.14, 0.82, 0.14, tb[0], yy + 0.42, tb[1], 0); KI.box("imetal", 0x8a9090, 1.2, 0.06, 0.5, tb[0], yy + 0.12, tb[1], 0); solidL(cu + 4.2, F.v0 + 6.2, 0, 2.0, 0.9, yy, yy + 0.92, "sanct", { noStep: true }); EX.exam = [cu + 4.2, F.v0 + 6.2, yy + 0.9];
        const ct = l2w(cu + 4.5, F.v0 + 0.55); KI.box("iwood", 0xe8e4dc, 4.6, 0.9, 0.6, ct[0], yy + 0.45, ct[1], 0, 1.2); KI.box("imetal", 0x9aa0a0, 4.7, 0.05, 0.66, ct[0], yy + 0.92, ct[1], 0, 1); KI.box("imetal", 0x6a7070, 0.6, 0.12, 0.44, ct[0] + 1.2, yy + 0.88, ct[1], 0); KI.box("iwood", 0xe8e4dc, 4.6, 0.8, 0.36, ct[0], yy + 2.0, ct[1] - 0.1, 0, 1.2); for (let i = 0; i < 6; i++) KI.box("iwood", 0xc8c4bc, 0.7, 0.72, 0.02, ct[0] - 1.9 + i * 0.76, yy + 2.0, ct[1] + 0.09, 0); solidL(cu + 4.5, F.v0 + 0.55, 0, 4.6, 0.6, yy, yy + 0.95, "sanct", { noStep: true });
        const st = l2w(cu + 2.9, F.v0 + 5.2); KI.cyl("imetal", 0x2b5d8a, 0.2, 0.2, 0.06, st[0], yy + 0.62, st[1], 12); KI.cyl("imetal", 0x8a9090, 0.03, 0.03, 0.6, st[0], yy + 0.3, st[1], 6);
        const lm = l2w(cu + 5.2, F.v0 + 6.6); KI.box("imetal", 0x8a9090, 0.06, 2.6, 0.06, lm[0] + 0.9, yy + 1.3, lm[1] - 0.6); KI.beam("imetal", 0x8a9090, [lm[0] + 0.9, yy + 2.5, lm[1] - 0.6], [lm[0], yy + 2.1, lm[1] - 0.2], 0.04, 0.04, 1); KI.cyl("lamp", 0xfff4e0, 0.12, 0.26, 0.16, lm[0], yy + 2.0, lm[1] - 0.2, 14, true); EX.lampHeads.push([lm[0], yy + 2.0, lm[1] - 0.2]);
        const pp = l2w(F.u1 - 0.12, F.v0 + 3.0); KI.plane("sign", 0xffffff, 1.4, 0.64, pp[0] - 0.03, yy + 1.7, pp[1], -PI / 2, 0, SG.r.clinic);
        KI.drape("ihay", 0xe8d8b0, cu + 0.5, F.v0 + 8.4, cu + 3.2, F.v1 - 0.4, 0.07, 1.0, 1); { const a = l2w(cu + 0.4, F.v0 + 8.2), b = l2w(cu + 3.4, F.v0 + 8.2); KI.beam("iwood", 0x8a6a48, [a[0], yy + 1.0, a[1]], [b[0], yy + 1.0, b[1]], 0.06, 0.14, 1); KI.beam("iwood", 0x8a6a48, [a[0], yy + 0.5, a[1]], [b[0], yy + 0.5, b[1]], 0.06, 0.14, 1); } EX.stall = [cu + 1.8, F.v0 + 10.6];
        lampSource(l2w(cu + 4.4, 0)[0], yy + 2.7, l2w(0, F.v0 + 5)[1], 0xfff0e0, 6, 11, "in"); lampSource(l2w(F.u0 + 7, 0)[0], yy + 2.8, l2w(0, (F.v0 + F.v1) / 2)[1], 0xffe0b8, 5, 12, "in"); }
      // bales and a cart of hay on the porch, a hose reel
      baleStack(KE, F.u1 - 2.8, F.v1 + 1.8, y, 0, 2, 2, 2); baleStack(KE, F.u0 + 1.2, F.v1 + 2.2, y, PI / 2, 2, 1, 1); bench(KE, (F.u0 + F.u1) / 2 + 1.6, F.v1 + 2.6, PI, 1.8); }
    // ── hay bales about the grounds (by the yards' gates, the lanes) ──
    { baleStack(KE, -26, -16.5, gy(-26, -16.5), PI / 2, 1, 2, 1); baleStack(KE, 14.2 + 3.4, -28, gy(17.6, -28), PI / 2, 1, 1, 1); bale(KE, 38.6, 6.6, gy(38.6, 6.6), 0.4); seatL(38.6, 6.6, 0.4, 0.95, 0.42, gy(38.6, 6.6) + 0.39, 0); bale(KE, -20, -2.2, gy(-20, -2.2), 0.1); seatL(-20, -2.2, 0.1, 0.95, 0.42, gy(-20, -2.2) + 0.39, PI); baleStack(KE, 66, -12.8, gy(66, -12.8), 0, 2, 1, 1); }
    // build the meshes: the exterior and the interiors (shared materials, one mesh per material and group)
    const bases = { rock: MT.rock, yard: MT.yard, wood: MT.wood, roof: MT.roof, metal: MT.metal, stone: MT.stone, dirt: MT.dirt, hay: MT.hay, sign: MT.sign, mesh: MT.mesh, lamp: MT.lamp, water: MT.water, iwood: MT.iwood, ihay: MT.ihay, imetal: MT.imetal, board: MT.board };
    EX.extMeshes = KE.build(EX.ext, bases, { tag: "ext", noCast: ["dirt", "yard", "mesh", "lamp", "water", "sign"] }); EX.intMeshes = KI.build(EX.int, bases, { tag: "int", noCast: ["lamp", "board", "sign", "ihay"] });
    // the glows over the lamp heads at night (one additive points-like draw: small quads facing up, cheap)
    { const KG = new Kit(); EX.lampHeads.forEach(([x, y, z]) => { const g = new THREE.PlaneGeometry(0.9, 0.9); KG.place("glow", g, 0xffffff, x, y, z, 0, 0); const g2 = new THREE.PlaneGeometry(0.9, 0.9); KG.place("glow", g2, 0xffffff, x, y, z, PI / 2, 0); }); EX.glow = KG.build(EX.ext, { glow: MT.glow }, { tag: "glow", cast: false, receive: false }); EX.glow.forEach((m) => { m.renderOrder = 3; }); }
    cnt("ext", EX.extMeshes.length); cnt("int", EX.intMeshes.length); }

  // ───────────────────────── the residents: real models, a baked region rig, one InstancedMesh per kind and tier ─────────────────────────
  // aSaR (per vertex): x neck-and-head weight (grows along the neck, 1 at the head), y leg weight (1 at the hoof), z leg id (0 FL, 1 FR,
  // 2 HL, 3 HR), w tail weight. Per instance: aSaI0 (leg phase, leg swing, neck pitch + nose down, neck yaw), aSaI1 (tail yaw, chew,
  // breath phase, unused). Per kind uniforms: uSaA (neck pivot y, z, leg pivot y, ear wiggle), uSaB (front leg pivot z, hind z, tail pivot y, z),
  // uSaC (knee lift, chew nod, breath swell, base head yaw). One shader text for every kind (one program; the depth twin for shadows).
  const SA_GLSL = {
    pars: ["uniform vec4 uSaA; uniform vec4 uSaB; uniform vec4 uSaC; attribute vec4 aSaR; attribute vec4 aSaI0; attribute vec4 aSaI1;",
      "vec3 saRX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }",
      "vec3 saRY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }",
      "void saRig(inout vec3 p, inout vec3 n) {",
      "  float wl = aSaR.y;",
      "  if (wl > 0.001 && abs(aSaI0.y) > 0.0001) { float id = aSaR.z; float fr = 1.0 - step(1.5, id);",
      "    float off = id < 0.5 ? 0.0 : (id < 1.5 ? 3.14159 : (id < 2.5 ? 4.71239 : 1.5708)); float ph = aSaI0.x + off;",
      "    float a = sin(ph) * aSaI0.y * wl; vec3 piv = vec3(0.0, uSaA.z, mix(uSaB.y, uSaB.x, fr)); vec3 q = saRX(p - piv, a);",
      "    q.y += max(0.0, cos(ph)) * abs(aSaI0.y) * uSaC.x * wl * wl; p = piv + q; n = saRX(n, a); }",
      "  float wh = aSaR.x;",
      "  if (wh > 0.001) { vec3 piv = vec3(0.0, uSaA.x, uSaA.y); float pa = (aSaI0.z + sin(aSaI1.y * 11.0) * uSaC.y * step(0.001, aSaI1.y) * wh) * wh; float ya = (aSaI0.w + uSaC.w) * wh;",
      "    vec3 q = saRY(saRX(p - piv, pa), ya); p = piv + q; n = saRY(saRX(n, pa), ya); }",
      "  float wt = aSaR.w;",
      "  if (wt > 0.001) { vec3 piv = vec3(0.0, uSaB.z, uSaB.w); vec3 q = saRY(p - piv, aSaI1.x * wt); q = saRX(q, -abs(aSaI1.x) * 0.25 * wt); p = piv + q; n = saRY(n, aSaI1.x * wt); }",
      "  p.x *= 1.0 + sin(aSaI1.z) * uSaC.z * (1.0 - wl) * (1.0 - wh);",
      "}"].join("\n"),
    nrm: "#include <beginnormal_vertex>\nvec3 saP = vec3(position); saRig(saP, objectNormal);\n#define SA_DONE",
    pos: "#include <begin_vertex>\n#ifdef SA_DONE\ntransformed = saP;\n#else\n{ vec3 saN = vec3(0.0, 1.0, 0.0); saRig(transformed, saN); }\n#endif"
  };
  const saHook = function (sh) { const U = this.userData.saU; if (!U) return; sh.uniforms.uSaA = U.A; sh.uniforms.uSaB = U.B; sh.uniforms.uSaC = U.C;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + SA_GLSL.pars).replace("#include <beginnormal_vertex>", SA_GLSL.nrm).replace("#include <begin_vertex>", SA_GLSL.pos); };
  // the kinds: model, length scale (on the engine's normalised model), the rig profile (fractions of length s from the tail and of height),
  // gaits; type quad | bird | hop | shell
  const KINDS = R.kinds = {
    horse:   { m: "horse", sc: 0.7, type: "quad", neck: [0.66, 0.86, 0.42], belly: 0.36, tail: 0.1, tailY: 0.52, graze: 1.05, yawMax: 0.55, spd: 1.1, stride: 1.4, amp: 0.36, knee: 0.16, chew: 0.04, breath: 0.012, sep: 1.6 },
    donkey:  { m: "sa_donkey", sc: 0.62, type: "quad", neck: [0.64, 0.84, 0.44], belly: 0.37, tail: 0.1, tailY: 0.5, graze: 1.0, yawMax: 0.6, spd: 0.9, stride: 1.0, amp: 0.36, knee: 0.14, chew: 0.04, breath: 0.012, sep: 1.3 },
    goat:    { m: "goat", sc: 0.8, type: "quad", neck: [0.66, 0.84, 0.46], belly: 0.4, tail: 0.1, tailY: 0.6, graze: 0.9, yawMax: 0.75, spd: 0.85, stride: 0.6, amp: 0.4, knee: 0.08, chew: 0.05, breath: 0.014, sep: 0.8 },
    sheep:   { m: "sheep", sc: 0.82, type: "quad", neck: [0.7, 0.86, 0.46], belly: 0.34, tail: 0.08, tailY: 0.55, graze: 0.85, yawMax: 0.5, spd: 0.7, stride: 0.6, amp: 0.36, knee: 0.07, chew: 0.05, breath: 0.016, sep: 0.8 },
    tortoise: { m: "tortoise", sc: 0.62, type: "shell", neck: [0.8, 0.92, 0.12], belly: 0.32, tail: 0.0, tailY: 0.3, graze: 0.35, yawMax: 0.5, spd: 0.07, stride: 0.12, amp: 0.3, knee: 0.02, chew: 0.03, breath: 0.006, sep: 0.4 },
    chicken: { m: "chicken", sc: 0.85, type: "bird", headS: 0.5, headY: 0.64, legY: 0.3, graze: 0.95, yawMax: 0.9, spd: 0.55, stride: 0.16, amp: 0.5, knee: 0.04, chew: 0.0, breath: 0.01, sep: 0.35 },
    quail:   { m: "quail", sc: 0.85, type: "bird", headS: 0.5, headY: 0.62, legY: 0.25, graze: 0.8, yawMax: 0.9, spd: 0.5, stride: 0.1, amp: 0.5, knee: 0.03, chew: 0.0, breath: 0.012, sep: 0.3 },
    owl:     { m: "sa_owl", sc: 1.0, type: "bird", headY: 0.66, legY: 0.08, graze: 0.25, yawMax: 1.7, spd: 0, stride: 1, amp: 0, knee: 0, chew: 0.0, breath: 0.008, sep: 0.5, yaw0: -0.42 },
    rabbit:  { m: "sa_rabbit", sc: 1.0, type: "hop", neck: [0.6, 0.78, 0.3], belly: 0.0, tail: 0.06, tailY: 0.3, graze: 0.32, yawMax: 0.45, spd: 0.7, stride: 0.4, amp: 0, knee: 0, chew: 0.06, breath: 0.03, sep: 0.4 }
  };
  // the residents (names and stories in sanctuary.json residents/animals); where each kind lives (local rects, inset from the fences)
  const AREAS = { horses: [-64.6, -37.6, -25.4, -1.4], goats: [-18.6, -37.6, 12.6, -6.4], tort: [19.0, -35.8, 36.0, -21.0], hutch: [19.0, -15.0, 37.0, 0.0], aviary: [43.2, -31.8, 62.8, -15.4] };
  const HERD = R.herd = R.herd || { list: [], built: false, kinds: {} };
  function herdPlan() { const A = C("animals", null); if (Array.isArray(A) && A.length) return A;
    return [["horse", "horses", "Juniper"], ["horse", "horses", "Dusty"], ["horse", "horses", "Ranger"], ["donkey", "horses", "Pepper"], ["donkey", "horses", "Biscuit"], ["donkey", "horses", "Moe"],
      ["goat", "goats", "Clover"], ["goat", "goats", "Pip"], ["goat", "goats", "Hazel"], ["goat", "goats", "Bean"], ["sheep", "goats", "Willow"], ["sheep", "goats", "Woolsey"], ["sheep", "goats", "Daisy"],
      ["tortoise", "tort", "Old Sage"], ["tortoise", "tort", "Pebble"], ["tortoise", "tort", "Mesa"], ["rabbit", "hutch", "Thistle"], ["rabbit", "hutch", "Nutmeg"], ["rabbit", "hutch", "Button"], ["rabbit", "hutch", "Fern"],
      ["chicken", "hutch", "Henrietta"], ["chicken", "hutch", "Goldie"], ["chicken", "hutch", "Pearl"], ["chicken", "hutch", "Ruby"], ["owl", "aviary", "Hoot"], ["owl", "aviary", "Luna"], ["quail", "aviary", "Dot"], ["quail", "aviary", "Dash"], ["quail", "aviary", "Plume"]].map(([k, a, n]) => ({ kind: k, area: a, name: n })); }
  // the rig weights of one geometry (cached per geometry): read once, positions in the engine's normalised model frame
  function rigWeights(geo, K) { if (geo.userData.saRig) return geo.userData.saRig; const P = geo.attributes.position, n = P.count; let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    const X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n); for (let i = 0; i < n; i++) { X[i] = P.getX(i); Y[i] = P.getY(i); Z[i] = P.getZ(i); if (X[i] < mn[0]) mn[0] = X[i]; if (Y[i] < mn[1]) mn[1] = Y[i]; if (Z[i] < mn[2]) mn[2] = Z[i]; if (X[i] > mx[0]) mx[0] = X[i]; if (Y[i] > mx[1]) mx[1] = Y[i]; if (Z[i] > mx[2]) mx[2] = Z[i]; }
    const Ln = mx[2] - mn[2] || 1, Hh = mx[1] - mn[1] || 1, W = mx[0] - mn[0] || 1, sOf = (z) => (z - mn[2]) / Ln; const out = new Float32Array(n * 4); const piv = { nY: 0, nZ: 0, lY: 0, fZ: 0, hZ: 0, tY: 0, tZ: 0 };
    if (K.type === "bird") { const hy = mn[1] + Hh * K.headY, ly = mn[1] + Hh * K.legY; piv.nY = hy - Hh * 0.04; piv.nZ = (mn[2] + mx[2]) / 2 + Ln * 0.08; piv.lY = ly; let fz = 0, fc = 0; for (let i = 0; i < n; i++) { if (Y[i] < ly * 0.6) { fz += Z[i]; fc++; } } piv.fZ = piv.hZ = fc ? fz / fc : 0;
      for (let i = 0; i < n; i++) { out[i * 4] = sstep(hy - Hh * 0.05, hy + Hh * 0.08, Y[i]) * (K.headS ? sstep(K.headS - 0.08, K.headS + 0.08, sOf(Z[i])) : 1); const wl = 1 - sstep(ly * 0.35, ly * 1.05, Y[i]); out[i * 4 + 1] = K.amp > 0 ? wl : 0; out[i * 4 + 2] = X[i] < 0 ? 0 : 1; out[i * 4 + 3] = 0; } }
    else { const nk = K.neck, bY = mn[1] + Hh * K.belly, nY = mn[1] + Hh * nk[2]; piv.nZ = mn[2] + Ln * nk[0]; piv.nY = nY + Hh * 0.12; piv.lY = bY * 1.06; const split = mn[2] + Ln * 0.5; let fz = 0, fc = 0, hz = 0, hc = 0; for (let i = 0; i < n; i++) { if (Y[i] < bY * 0.4) { if (Z[i] > split) { fz += Z[i]; fc++; } else { hz += Z[i]; hc++; } } } piv.fZ = fc ? fz / fc : mn[2] + Ln * 0.75; piv.hZ = hc ? hz / hc : mn[2] + Ln * 0.25; piv.tY = mn[1] + Hh * K.tailY; piv.tZ = mn[2] + Ln * (K.tail + 0.02);
      for (let i = 0; i < n; i++) { const s = sOf(Z[i]); out[i * 4] = sstep(nk[0], nk[1], s) * sstep(nY - Hh * 0.08, nY + Hh * 0.06, Y[i]);
        const wl = K.belly > 0 ? 1 - sstep(bY * 0.42, bY * 1.06, Y[i]) : 0; out[i * 4 + 1] = wl; out[i * 4 + 2] = (Z[i] > split ? 0 : 2) + (X[i] < 0 ? 0 : 1);
        out[i * 4 + 3] = K.tail > 0 ? (1 - sstep(K.tail * 0.4, K.tail + 0.04, s)) * sstep(piv.tY - Hh * 0.1, piv.tY, Y[i]) * (1 - sstep(W * 0.08, W * 0.2, Math.abs(X[i]))) : 0; } }
    const r = { attr: new THREE.BufferAttribute(out, 4), piv, Ln, Hh, W, mn, mx }; geo.userData.saRig = r; return r; }
  // one tier of one kind: an InstancedMesh with the rig attributes, its material (a clone of the model's, the rig hook) and depth twin
  function makeTier(kd, geo, srcMat, max, far) { const K = KINDS[kd], rig = rigWeights(geo, K); const g = new THREE.BufferGeometry(); g.setAttribute("position", geo.attributes.position); if (geo.attributes.normal) g.setAttribute("normal", geo.attributes.normal); if (geo.attributes.uv) g.setAttribute("uv", geo.attributes.uv); if (geo.index) g.setIndex(geo.index); g.setAttribute("aSaR", rig.attr);
    const I0 = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4), I1 = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); I0.setUsage(THREE.DynamicDrawUsage); I1.setUsage(THREE.DynamicDrawUsage); g.setAttribute("aSaI0", I0); g.setAttribute("aSaI1", I1); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); g.userData.avShared = true;
    const p = rig.piv, U = { A: { value: new THREE.Vector4(p.nY, p.nZ, p.lY, 0) }, B: { value: new THREE.Vector4(p.fZ, p.hZ, p.tY, p.tZ) }, C: { value: new THREE.Vector4(K.knee, K.chew, K.breath, K.yaw0 || 0) } };
    const m = srcMat.clone(); m.userData = Object.assign({}, m.userData, { saU: U, avShared: true }); m.onBeforeCompile = saHook; m.name = "sa animal " + kd + (far ? " far" : ""); if (far) { m.normalScale = m.normalScale.clone().multiplyScalar(0.6); }
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); dm.userData.saU = U; dm.onBeforeCompile = saHook; dm.name = "sa animal depth";
    const im = new THREE.InstancedMesh(g, m, max); im.count = 0; im.frustumCulled = false; im.castShadow = !far; im.receiveShadow = true; im.customDepthMaterial = dm; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.userData.noSolid = true; im.userData.noBatch = true; im.userData.noCull = true; im.name = "sa " + kd + (far ? " lod" : ""); im.userData.saI = [I0, I1];
    scene.add(im); return im; }
  // the kinds' meshes: built when the full model is in (PLAN_LOAD_KINDS on approach); rebuilt if the model object changes
  function kindMeshes(kd) { const K = KINDS[kd], md = MODELS[K.m]; if (!md || md.proxy || !md.parts || !md.parts.length) return null; const part = md.parts[0]; let KM = HERD.kinds[kd];
    if (KM && KM.src === part.geometry) return KM; if (KM) { [KM.near, KM.far].forEach((x) => { if (x) { scene.remove(x); } }); }
    const n = HERD.list.filter((a) => a.kind === kd).length || 1; const near = makeTier(kd, part.geometry, part.material, n, false); const lodG = md.lodGeos && md.lodGeos[0]; const far = makeTier(kd, lodG || part.geometry, part.material, n, true);
    const rig = rigWeights(part.geometry, K); KM = HERD.kinds[kd] = { src: part.geometry, near, far, rig, hgt: (rig.mx[1] - rig.mn[1]) * K.sc, len: (rig.mx[2] - rig.mn[2]) * K.sc }; cnt("kindMesh"); return KM; }
  // the residents' state (local u, v; world yaw)
  function spawnHerd() { if (HERD.built) return; HERD.built = true; const Rn = rng(80808); let pi = 0;
    herdPlan().forEach((d, i) => { const K = KINDS[d.kind]; if (!K) return; const ar = AREAS[d.area]; if (!ar) return; const a = { id: i, kind: d.kind, name: d.name, area: d.area, box: ar, K, u: lerp(ar[0], ar[2], Rn()), v: lerp(ar[1], ar[3], Rn()), yaw: Rn() * TAU, st: "idle", t: 1 + Rn() * 6, tgt: null,
      legPh: Rn() * TAU, legAmp: 0, nP: 0, nY: 0, nPT: 0, nYT: 0, tail: 0, tailT: 0, tailPh: Rn() * 10, chew: 0, br: Rn() * TAU, bob: 0, pitch: 0, roll: 0, hop: 0, ph: Rn() * 100, fedAt: -1e9, cfg: d };
      if (d.kind === "owl") { const P = EX.perch[pi++ % Math.max(1, EX.perch.length)]; if (P) { a.u = P[0]; a.v = P[1]; a.perchY = P[2]; a.yaw = P[3] || 0; a.st = "perch"; } }
      for (let k = 0; k < 12 && blocked(a, a.u, a.v); k++) { a.u = lerp(ar[0], ar[2], Rn()); a.v = lerp(ar[1], ar[3], Rn()); }
      HERD.list.push(a); });
    cnt("herd", HERD.list.length); }
  function blocked(a, u, v) { const m = a.K.sep * 0.5; for (const o of EX.obst || []) if (u > o[0] - m && u < o[2] + m && v > o[1] - m && v < o[3] + m) return true; for (const t of TREES) if (Math.hypot(u - t[0], v - t[1]) < 0.9 + m) return true; for (const tk of EX.tanks || []) if (Math.hypot(u - tk[0], v - tk[1]) < tk[2] + 0.4 + m) return true; return false; }
  // ground height for an animal (the goats climb the spools and the deck)
  function groundOf(a, u, v) { let y = gy(u, v); if (a.area === "aviary") y = Math.max(y, padY("aviary")); return y; }
  function pickTarget(a) { const b = a.box; for (let k = 0; k < 14; k++) { const r = k < 6 ? 6 + Math.random() * 10 : 30; const ang = Math.random() * TAU; const u = clamp(a.u + Math.sin(ang) * r * Math.random(), b[0], b[2]), v = clamp(a.v + Math.cos(ang) * r * Math.random(), b[1], b[3]); if (!blocked(a, u, v) && !segBlocked(a, a.u, a.v, u, v)) return [u, v]; } return null; }
  function segBlocked(a, u0, v0, u1, v1) { const n = Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.8); for (let i = 1; i <= n; i++) { const t = i / n; if (blocked(a, lerp(u0, u1, t), lerp(v0, v1, t))) return true; } return false; }
  // feeding spots near a kind's feeder or trough (the herd drifts there at feeding time)
  function feederOf(a) { const F = EX.feeders || {}; const L0 = F[a.area]; if (!L0 || !L0.length) return null; return L0[(a.id) % L0.length]; }
  // ───────────────────────── behaviour (CPU, a few dozen animals; only within 320 m) ─────────────────────────
  function think(a, dt, h, ctx) { const K = a.K; a.t -= dt; a.ph += dt; a.br += dt * (a.st === "walk" ? 2.4 : 1.4) * (K.type === "hop" ? 2.2 : 1);
    const nightRest = h < 6.2 || h > 20.4;
    // the tail: swishes now and then (flies), harder when grazing
    a.tailPh += dt; if (a.tailPh > a.tailNext) { a.tailT = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6); a.tailNext = a.tailPh + 0.35; a.tailBack = a.tailPh + 0.35; } else if (a.tailBack && a.tailPh > a.tailBack) { a.tailT = -a.tailT * 0.6; a.tailBack = 0; a.tailNext = a.tailPh + 2 + Math.random() * 7; } if (!a.tailNext) a.tailNext = a.tailPh + Math.random() * 5;
    // interaction states first (come to the fence, eat, be petted)
    if (a.st === "come") { const dd = Math.hypot(a.tgt[0] - a.u, a.tgt[1] - a.v); if (dd < 0.25 || a.t <= 0) { a.st = a.act === "pet" ? "pet" : "eat"; a.t = a.act === "pet" ? 3.2 : 4.4; a.chew = 0; a.legAmp = 0; } else move(a, dt, K.spd * 1.25); faceTo(a, dt, ctx.pu, ctx.pv, a.st === "come" ? 0 : 1); a.nPT = 0; return; }
    if (a.st === "eat" || a.st === "pet") { a.legAmp *= 0.85; const look = Math.atan2(ctx.pu - a.u, ctx.pv - a.v); turnTo(a, dt, look, 1.6); const dy = angD(a.yaw, look); a.nYT = clamp(dy, -K.yawMax, K.yawMax);
      if (a.st === "eat") { a.nPT = (K.type === "bird" ? 0.6 : 0.32); a.chew += dt; } else { a.nPT = Math.sin(a.ph * 4) * 0.12 - 0.05; a.chew = 0; }
      if (a.t <= 0) { a.st = "idle"; a.t = 3 + Math.random() * 4; a.chew = 0; } return; }
    if (a.st === "perch") { // owls: still body, the head sweeps in steps, follows a visitor inside the aviary; a slow blink of the body (a shift of weight)
      if (a.t <= 0) { a.nYT = (Math.random() - 0.5) * 2 * K.yawMax; a.nPT = (Math.random() - 0.4) * 0.3; a.t = 1.5 + Math.random() * 4.5; }
      if (ctx.dP < 9) { const look = Math.atan2(ctx.pu - a.u, ctx.pv - a.v); a.nYT = clamp(angD(a.yaw, look), -K.yawMax, K.yawMax); a.nPT = -0.15; }
      a.bob = Math.sin(a.ph * 0.6) * 0.004; return; }
    if (nightRest && a.st !== "rest") { a.st = "rest"; a.t = 5; a.legAmp = 0; }
    if (a.st === "rest") { a.nPT = K.type === "bird" ? 0.1 : K.graze * 0.35; a.nYT = Math.sin(a.ph * 0.05) * 0.2; a.legAmp *= 0.9; if (!nightRest) { a.st = "idle"; a.t = 1; } return; }
    if (a.st === "walk") { const dd = a.tgt ? Math.hypot(a.tgt[0] - a.u, a.tgt[1] - a.v) : 0; if (!a.tgt || dd < 0.3 || a.t <= 0) { a.st = Math.random() < 0.55 ? "graze" : "idle"; a.t = a.st === "graze" ? 6 + Math.random() * 12 : 3 + Math.random() * 6; a.tgt = null; } else { move(a, dt, K.spd * (a.trot ? 2.0 : 1)); a.nPT = K.type === "bird" ? Math.max(0, Math.sin(a.legPh * 2)) * 0.25 : 0.12; a.nYT *= 0.95; } }
    else if (a.st === "graze") { a.legAmp *= 0.85; a.nPT = K.graze * (K.type === "bird" ? (Math.sin(a.ph * 7) > 0.2 ? 1 : 0.2) : 1); a.nYT = Math.sin(a.ph * 0.3) * 0.2; a.chew = K.chew > 0 ? a.chew + dt : 0;
      // a step forward now and then while grazing
      if (K.type === "quad" && Math.sin(a.ph * 0.23 + a.id) > 0.97 && !blocked(a, a.u + Math.sin(a.yaw) * 0.4, a.v + Math.cos(a.yaw) * 0.4)) move(a, dt, 0.25);
      if (a.t <= 0) { a.st = "idle"; a.t = 2 + Math.random() * 5; a.chew = 0; } }
    else { // idle: stand, look about (head turns), watch a visitor at the fence
      a.legAmp *= 0.85; if (a.t <= 0) { const r = Math.random(); if (r < 0.5) { a.tgt = pickTarget(a); if (a.tgt) { a.st = "walk"; a.t = 25; a.trot = (a.kind === "goat" || a.kind === "horse") && Math.random() < 0.12; } else a.t = 2; } else if (r < 0.8) { a.st = "graze"; a.t = 6 + Math.random() * 12; } else a.t = 2 + Math.random() * 4; }
      if (Math.sin(a.ph * 0.5 + a.id * 1.7) > 0.6) a.nYT = Math.sin(a.ph * 0.17 + a.id) * K.yawMax; else a.nYT *= 0.98; a.nPT = K.type === "bird" ? Math.max(0, Math.sin(a.ph * 3.1 + a.id)) * 0.3 * (Math.sin(a.ph * 0.4) > 0.3 ? 1 : 0) : -0.05 + Math.sin(a.ph * 0.6 + a.id) * 0.04;
      if (ctx.dP < 7 && ctx.out) { const look = Math.atan2(ctx.pu - a.u, ctx.pv - a.v); const dy = angD(a.yaw, look); if (Math.abs(dy) < K.yawMax * 1.6) { a.nYT = clamp(dy, -K.yawMax, K.yawMax); a.nPT = -0.08; } else if (K.spd > 0) turnTo(a, dt, look, 0.5); } } }
  function turnTo(a, dt, want, rate) { const d = angD(a.yaw, want); a.yaw += clamp(d, -dt * rate, dt * rate); }
  function faceTo(a, dt, pu, pv) { turnTo(a, dt, Math.atan2(pu - a.u, pv - a.v), 1.4); }
  function move(a, dt, spd) { const K = a.K; if (a.tgt) { const want = Math.atan2(a.tgt[0] - a.u, a.tgt[1] - a.v); turnTo(a, dt, want, K.type === "bird" ? 4 : 1.3); const dy = Math.abs(angD(a.yaw, want)); spd *= dy > 1.0 ? 0.25 : 1; }
    if (K.type === "hop") { // rabbits: short hops (the body leaves the ground in an arc), pauses between them
      a.hopT = (a.hopT || 0) + dt * 2.6; const k = a.hopT % 1; const air = k < 0.42; if (air) { const step = spd * 2.6 * dt; const nu = a.u + Math.sin(a.yaw) * step, nv = a.v + Math.cos(a.yaw) * step; if (!blocked(a, nu, nv)) { a.u = clamp(nu, a.box[0], a.box[2]); a.v = clamp(nv, a.box[1], a.box[3]); } } a.hop = air ? Math.sin(k / 0.42 * PI) * 0.09 : 0; a.pitch = air ? -Math.cos(k / 0.42 * PI) * 0.22 : 0; return; }
    const step = spd * dt, nu = a.u + Math.sin(a.yaw) * step, nv = a.v + Math.cos(a.yaw) * step; if (!blocked(a, nu, nv)) { a.u = clamp(nu, a.box[0], a.box[2]); a.v = clamp(nv, a.box[1], a.box[3]); } else { a.tgt = null; a.t = 0; }
    a.legPh += dt * spd / Math.max(0.05, K.stride) * PI; a.legAmp += (K.amp * clamp(spd / Math.max(0.05, K.spd), 0.3, 1.6) - a.legAmp) * Math.min(1, dt * 5); a.bobK = spd; }
  // keep the herd apart (a soft push)
  function separate(list) { for (let i = 0; i < list.length; i++) { const a = list[i]; if (a.st === "perch") continue; for (let j = i + 1; j < list.length; j++) { const b = list[j]; if (b.area !== a.area || b.st === "perch") continue; const du = b.u - a.u, dv = b.v - a.v, d = Math.hypot(du, dv), m = (a.K.sep + b.K.sep) * 0.6; if (d < m && d > 1e-4) { const k = (m - d) * 0.5 / d; if (a.st !== "eat" && a.st !== "pet" && !blocked(a, a.u - du * k, a.v - dv * k)) { a.u -= du * k; a.v -= dv * k; } if (b.st !== "eat" && b.st !== "pet" && !blocked(b, b.u + du * k, b.v + dv * k)) { b.u += du * k; b.v += dv * k; } } } } }
  // ───────────────────────── per frame: behaviour, then the instance data for the visible tiers ─────────────────────────
  const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _E = new THREE.Euler(), _P = new THREE.Vector3(), _Sc = new THREE.Vector3();
  function herdFrame(dt, near, h) { if (!HERD.built) return; const cam = camera.position, pp = player.position, pl = w2l(pp.x, pp.z);
    const ks = Object.keys(KINDS); for (const kd of ks) { const KM = HERD.kinds[kd]; if (!near) { if (KM) { KM.near.visible = KM.far.visible = false; } continue; } }
    if (!near) return;
    if ((FR.k & 31) === 3) for (const kd of ks) { if (HERD.list.some((a) => a.kind === kd)) kindMeshes(kd); }
    const ctxBase = { pu: pl[0], pv: pl[1] };
    for (const a of HERD.list) { const KM = HERD.kinds[a.kind]; if (!KM) continue; const dP = Math.hypot(pl[0] - a.u, pl[1] - a.v); const ctx = { pu: ctxBase.pu, pv: ctxBase.pv, dP, out: !inRect(pl[0], pl[1], { u0: a.box[0], u1: a.box[2], v0: a.box[1], v1: a.box[3] }, 0.2) }; const dC = Math.hypot(cam.x - (S.O[0] + a.u), cam.z - (S.O[1] + a.v)); a.dC = dC;
      // far animals think at a quarter rate
      if (dC < 90 || ((FR.k + a.id) & 3) === 0) think(a, dC < 90 ? dt : dt * 4, h, ctx);
      const kN = Math.min(1, dt * (a.st === "eat" || a.st === "pet" || a.st === "perch" ? 6 : 2.4)); a.nP += (a.nPT - a.nP) * kN; a.nY += (a.nYT - a.nY) * Math.min(1, dt * (a.st === "perch" ? 5 : 2)); a.tail += (a.tailT - a.tail) * Math.min(1, dt * 7); if (a.st !== "walk" && a.K.type !== "hop") a.legAmp *= 0.92; }
    separate(HERD.list);
    // write the tiers
    const counts = {}; for (const kd of ks) { const KM = HERD.kinds[kd]; if (KM) { counts[kd] = [0, 0]; KM.near.visible = true; KM.far.visible = true; } }
    for (const a of HERD.list) { const KM = HERD.kinds[a.kind]; if (!KM || a.dC > 320 || a.hidden) continue; const K = a.K, farT = a.dC > (K.type === "quad" ? 46 : 26); const im = farT ? KM.far : KM.near, c = counts[a.kind], idx = farT ? c[1]++ : c[0]++;
      let y = a.st === "perch" ? padY("aviary") + a.perchY : groundOf(a, a.u, a.v); const bob = K.type === "quad" && a.legAmp > 0.05 ? Math.abs(Math.sin(a.legPh)) * 0.025 * K.sc : 0;
      _P.set(S.O[0] + a.u, y + bob + (a.hop || 0) + (a.bob || 0) - 0.02, S.O[1] + a.v); _E.set(a.pitch || 0, a.yaw, 0, "YXZ"); _Q.setFromEuler(_E); _Sc.setScalar(K.sc * (a.cfg.scale || 1)); _M.compose(_P, _Q, _Sc); im.setMatrixAt(idx, _M);
      const I = im.userData.saI; I[0].setXYZW(idx, a.legPh, a.legAmp, a.nP, a.nY); I[1].setXYZW(idx, a.tail, a.chew, a.br, 0); }
    for (const kd in counts) { const KM = HERD.kinds[kd], c = counts[kd]; KM.near.count = c[0]; KM.far.count = c[1]; for (const [im, n] of [[KM.near, c[0]], [KM.far, c[1]]]) { if (!n) { im.visible = false; continue; } im.instanceMatrix.needsUpdate = true; im.instanceMatrix.clearUpdateRanges && im.instanceMatrix.clearUpdateRanges(); const I = im.userData.saI; I[0].needsUpdate = true; I[1].needsUpdate = true; } KM.near.castShadow = c[0] > 0; } }
  // ask the stream for the full models once the player is near (the far tier needs the main model's materials)
  function herdLoad() { if (HERD.req) return; HERD.req = true; const ks = [...new Set(Object.values(KINDS).map((k) => k.m))]; try { if (typeof window.PLAN_LOAD_KINDS === "function") window.PLAN_LOAD_KINDS(ks).then(() => { HERD.loaded = true; cnt("herdLoaded"); }).catch((e) => note("load kinds", e)); } catch (e) { note("load kinds", e); } }
  function animalAt(u, v, r, pred) { let best = null, bd = r; for (const a of HERD.list) { if (!HERD.kinds[a.kind] || a.hidden) continue; if (pred && !pred(a)) continue; const d = Math.hypot(a.u - u, a.v - v); if (d < bd) { bd = d; best = a; } } return best; }

  // ───────────────────────── people: three staff with talk cards, roaming keepers and visitors (PLAN_ROAM) ─────────────────────────
  const ST = R.staff = R.staff || { list: [], built: false };
  function staffDefs() { const B = L.barn, F = L.feed, P = L.porch;
    return {
      marisol: { name: "Marisol Vega", role: "Director, Gentle Gate Animal Sanctuary", at: [EX.desk ? EX.desk[0] : B.u0 + 13.6, EX.desk ? EX.desk[1] : B.v0 + 3.1], face: [0, 1], floor: "barn", look: { skin: "c98f63", shirt: "2f5a3a", pants: "3a3a40", hair: 5, body: "f", hairc: "2b1d14" }, hat: null },
      amara: { name: "Dr. Amara Okafor", role: "Veterinarian, the sanctuary clinic", at: [F.clinic + 4.2, F.v0 + 7.5], face: [0, -1], floor: "feed", look: { skin: "6a4630", shirt: "e8eef2", pants: "2b3a4a", hair: 3, body: "f", hairc: "1a1410" }, hat: null },
      teo: { name: "Teo Ramirez", role: "Volunteer and adoption coordinator", at: [P.u0 + 2.4, P.v0 + 7.6], face: [1, 0.3], floor: "porch", look: { skin: "d9a877", shirt: "c9733a", pants: "2b3a4a", hair: 1, body: "m" }, hat: "hat_cowboy",
        walk: [[P.u0 + 2.4, P.v0 + 7.6], [P.u0 + 1.4, P.v0 + 3.4]] } }; }
  function staffY(A) { return A.floor === "barn" ? (EX.barnY || padY("barn")) + 0.12 : A.floor === "feed" ? (EX.feedY || padY("feed")) + 0.06 : A.floor === "porch" ? (EX.barnY || padY("barn")) + 0.12 : gy(A.at[0], A.at[1]); }
  function buildStaff() { if (ST.built || typeof avatar !== "function") return; const D = staffDefs(), cfgS = C("staff", {}); const ids = Object.keys(D).filter((id) => !ST.list.some((c) => c.id === "sa_" + id)); if (!ids.length) { ST.built = true; return; }
    ids.slice(0, 1).forEach((id) => { const ta = nowMs(); try { const A = Object.assign({}, D[id], cfgS[id] || {}); const w = l2w(A.at[0], A.at[1]); const g = noShadow(avatar("sa_" + id, A.name, A.look, A.hat || null, A.outfit || null)); g.position.set(w[0], staffY(A) + 0.02, w[1]); g.rotation.y = yawOf(A.face[0], A.face[1]); try { g.userData.label.scale.set(1.7, 0.43, 1); } catch (e) {} scene.add(g);
      const talk = (A.talk || [{ t: A.name + ".", o: [["Thanks", null]] }]).map((q) => ({ t: q.t, o: q.o })); const c = { id: "sa_" + id, name: A.name, role: A.role, pos: [w[0], w[1]], look: A.look, hat: A.hat, outfit: null, greet: A.greet || ["Welcome."], talk, kw: [], g, rot: g.rotation.y, sa: A };
      if (!CAST.some((q) => q.id === c.id)) CAST.push(c); const hs = { x: w[0], z: w[1], r: 2.6, t: c.name, k: c.role + " · press E to talk", p: talk[0] ? talk[0].t : "", play: "npc:" + c.id, sa: "staff" }; hotspots.push(hs); (R.hs = R.hs || []).push(hs); c.hs = hs; ST.list.push(c); } catch (e) { note("staff " + id, e); } R.t.avatarMax = Math.max(R.t.avatarMax || 0, Math.round(nowMs() - ta)); });
    cnt("staff", ST.list.length); }
  function staffFrame(dt, near) { const cam = camera.position; for (const c of ST.list) { const g = c.g; const d = Math.hypot(g.position.x - cam.x, g.position.z - cam.z); g.visible = near && d < 55; if (!g.visible) continue; const A = c.sa;
      if (A.walk && d < 60) { c.wt = (c.wt || 0) - dt; if (c.wt <= 0 && !c.wto) { c.wto = A.walk[(c.wi = ((c.wi || 0) + 1) % A.walk.length)]; } if (c.wto) { const q = w2l(g.position.x, g.position.z); const du = c.wto[0] - q[0], dv = c.wto[1] - q[1], dd = Math.hypot(du, dv); if (dd < 0.15) { c.wto = null; c.wt = 5 + Math.random() * 9; try { animateWalk(g, 0, dt); } catch (e) {} } else { const sp = 0.9, nu = q[0] + du / dd * sp * dt, nv = q[1] + dv / dd * sp * dt, w = l2w(nu, nv); g.position.x = w[0]; g.position.z = w[1]; g.rotation.y = yawOf(du, dv); c.pos[0] = w[0]; c.pos[1] = w[1]; if (c.hs) { c.hs.x = w[0]; c.hs.z = w[1]; } try { animateWalk(g, sp, dt); } catch (e) {} continue; } } }
      const pd = Math.hypot(player.position.x - g.position.x, player.position.z - g.position.z); if (pd < 3.4 && Math.abs(player.position.y - g.position.y) < 1.4) { const want = Math.atan2(player.position.x - g.position.x, player.position.z - g.position.z); g.rotation.y += clamp(angD(g.rotation.y, want), -dt * 3, dt * 3); } else if (!c.wto) { const f0 = yawOf(A.face[0], A.face[1]); g.rotation.y += clamp(angD(g.rotation.y, f0), -dt * 1.5, dt * 1.5); }
      if ((FRAME_N & 1) === 0 || d < 20) try { animateWalk(g, 0, (FRAME_N & 1) === 0 && d >= 20 ? dt * 2 : dt); } catch (e) {} } }
  // ───────────────────────── the adoption board as a talk card (window.PLAN_TALK), the stamp on its last page ─────────────────────────
  function boardTalk() { if (!EX.board) return; const w = l2w(EX.board[0] + 1.2, EX.board[1]); const g = new THREE.Object3D(); g.position.set(w[0], (EX.barnY || 23.5) + 1.2, w[1]); const T0 = C("adopt.talk", [{ t: "Sponsor a resident.", o: [["Thanks", null]] }]);
    const c = { id: "sa_board", name: C("adopt.name", "The adoption board"), role: C("adopt.role", "Gentle Gate Animal Sanctuary · sponsor a resident"), talk: T0.map((q) => ({ t: q.t, o: q.o })), g, pos: [w[0], w[1]], kw: [] };
    window.PLAN_TALK = window.PLAN_TALK || {}; window.PLAN_TALK.sa_board = c; const hs = { x: w[0], z: w[1], r: 2.3, t: c.name, k: C("adopt.kicker", "press E to read the board"), p: T0[0].t, play: "npc:sa_board", sa: "board" }; hotspots.push(hs); (R.hs = R.hs || []).push(hs); R.boardTalk = c; }
  function talkHook() { try { if (typeof showTalk !== "function" || showTalk.sa) return; const s0 = showTalk; const f = function (c, idx) { const r = s0.apply(this, arguments); try { if (c && c.id === "sa_board") { const node = c.talk[idx]; if (node && node.stamp) stamp(C("stamps.adopt", "p_sa_adopt")); cnt("boardPage"); }
          if (c && c.id && /^sa_/.test(c.id) && c.id !== "sa_board") { cnt("talk_" + c.id); if (idx === 0) stamp(C("stamps.welcome", "p_sa_welcome")); } } catch (e) { note("talk hook", e); } return r; }; f.sa = true; showTalk = f; } catch (e) { note("talk wrap", e); } }
  // ───────────────────────── roaming: a PLAN_ROAM area over the grounds (lanes, the court, the barn, the porches) ─────────────────────────
  function inBarnL(u, v) { const B = L.barn; return u > B.u0 + 0.2 && u < B.u1 - 0.2 && v > B.v0 + 0.2 && v < B.v1 - 0.2; }
  function inFeedL(u, v) { const F = L.feed; return u > F.u0 + 0.2 && u < F.u1 - 0.2 && v > F.v0 + 0.2 && v < F.v1 - 0.2; }
  function roamArea() {
    const RO = window.PLAN_ROAM; if (!RO || !RO.area || RO.off || R.roamArea) return; const RC = C("roam", {});
    const Pw = (u, v, kind, line, fu, fv, tag, dur, extra) => { const w = l2w(u, v); return Object.assign({ kind, line, x: w[0], z: w[1], face: yawOf(fu, fv), tag, dur }, extra || {}); };
    const c0 = l2w(-72, -45), c1 = l2w(86, 60);
    const def = { id: "sanctuary", max: 4, box: [c0[0], c0[1], c1[0], c1[1]], perCat: true, pull: 3, people: (RC.people || ["Rosa", "Kai", "Hannah", "Mateo", "Imani", "Gus"]).map((n) => (typeof n === "string" ? { name: n } : n)), lines: RC.lines || {},
      ready: () => !!R.ready,
      levels: [{ base: (x, z) => planGroundAt(x, z), exact: false, block: (x, z) => { const q = w2l(x, z), u = q[0], v = q[1]; if (!inPoly(FOOT, u, v) && !inPoly(FOOT_LOT, u, v)) return true;
        for (const r of [L.horses, L.goats, L.tort, L.hutch, L.aviary]) if (inRect(u, v, r, 0.5)) return true; if (inRect(u, v, L.feed, 0.3) && !inFeedL(u, v)) return true; if (inRect(u, v, L.barn, 0.3) && !inBarnL(u, v)) return true; if (inRect(u, v, L.ramada, -0.6)) return true;
        for (const tk of EX.tanks || []) if (Math.hypot(u - tk[0], v - tk[1]) < tk[2] + 0.4) return true; return false; } }],
      entries: () => [Pw(0, 44, "door"), Pw(80.6, -9.5, "door"), Pw(-68, 8, "door")],
      seeds: () => def.entries().concat([Pw(0, 30, "seed"), Pw(16, 0, "seed"), Pw(-22, -14, "seed"), Pw(40, -12, "seed"), Pw(55, 12, "seed")]),
      pois: () => { const out = [];
        // along the fences: watch the horses and donkeys, the goats on their spools, the tortoises, the rabbits and hens; at the troughs; the aviary door
        [[-22.6, -6, -1, 0, "horses"], [-22.6, -26, -1, 0, "horses"], [-35, 1.6, 0, -1, "horses"], [15.4, -12, -1, 0, "goats"], [15.4, -30, -1, 0, "goats"], [0, -3.6, 0, -1, "goats"], [16.8, -24, 1, 0, "tortoise"], [27, -18.4, 0, -1, "tortoise"], [16.8, -9, 1, 0, "hutch"], [26, 2.6, 0, -1, "hutch"], [53, -12.2, 0, -1, "aviary"], [41.2, -24, 1, 0, "aviary"]]
          .forEach(([u, v, fu, fv, ln], i) => out.push(Pw(u, v, "look", ln, fu, fv, "rail" + i, [14, 30])));
        out.push(Pw(-1.4, 7.6, "look", "troughs", 0, 1, "tank", [10, 18])); out.push(Pw(3.6, 11.6, "look", "troughs", -1, 0, "tank", [10, 18]));
        out.push(Pw(-16.4, 10.6, "look", "adopt", -1, 0, "board", [12, 22])); out.push(Pw(-15.0, 15.2, "look", "volunteer", -1, 0, "signup", [10, 18]));
        out.push(Pw(-28, 13, "look", "barn", 0, -1, "photos", [10, 18])); out.push(Pw(52, 9.6, "look", "feed", 0, -1, "feed", [10, 18]));
        [[-4, 31, 1, 0], [4, 31, -1, 0]].forEach(([u, v, fu, fv], i) => out.push(Pw(u, v, "chat", "court", fu, fv, "court" + i, [14, 26])));
        return out; },
      seatInfo: (s) => { if (s.tag !== "sanct" || !s.seat) return null; const q = w2l(s.x, s.z); if (inRect(q[0], q[1], L.ramada, 1)) return { kind: "sit", line: "ramada", tag: "picnic" }; if (inBarnL(q[0], q[1])) return { kind: "sit", line: "barn", tag: "barn" }; return { kind: "sit", line: "rest", tag: "bench" }; },
      weight: (p, h) => { const t = p.tag || ""; const open = h > 7 && h < 19.5; if (!open) return t.indexOf("court") === 0 ? 0.6 : 0.05; if (t.indexOf("rail") === 0) return 1.5; if (t === "picnic") return h > 11 && h < 15 ? 1.6 : 0.6; if (t === "board" || t === "signup") return 1.0; return 0.8; },
      count: (h) => (h < 7 || h > 20 ? 1 : h < 10 ? 2 : h < 17 ? 4 : 3),
      dur: { sit: [30, 70], chat: [14, 30], look: [12, 26] },
      visible: () => !R.abOff };
    R.roamArea = RO.area(def); cnt("roam"); }

  // ───────────────────────── care: E at a fence feeds or pets the nearest resident (it walks over), hearts rise, a little XP ─────────────────────────
  const CARE = R.care = R.care || { kinds: {}, n: 0, xpAt: -1e9, fx: [] };
  const CAREABLE = { horses: 1, goats: 1, tort: 1, hutch: 1 };
  // the resident a visitor can reach from where they stand: outside its yard, at most 2.4 m from the fence, the animal within 7 m
  function careTarget() { if (!HERD.built || busy()) return null; const p = player.position, q = w2l(p.x, p.z), u = q[0], v = q[1]; if (!inFoot(p.x, p.z, 0)) return null;
    let best = null, bd = 1e9; for (const ar in CAREABLE) { const b = AREAS[ar], r = { u0: b[0] - 1.2, u1: b[2] + 1.2, v0: b[1] - 1.2, v1: b[3] + 1.2 }; if (inRect(u, v, r, 0)) continue; const du = Math.max(r.u0 - u, 0, u - r.u1), dv = Math.max(r.v0 - v, 0, v - r.v1), dF = Math.hypot(du, dv); if (dF > 2.4) continue;
      for (const a of HERD.list) { if (a.area !== ar || !HERD.kinds[a.kind] || a.st === "perch") continue; const d = Math.hypot(a.u - u, a.v - v); if (d < 7.5 && d < bd) { bd = d; best = a; } } }
    return best; }
  function careStart(a) { const p = player.position, q = w2l(p.x, p.z), b = a.box; const K = a.K, KM = HERD.kinds[a.kind]; const reach = (KM ? KM.len : 1) * 0.5 + (a.area === "tort" || a.area === "hutch" ? 0.15 : 0.35);
    // the point just inside the fence in front of the visitor, the animal's nose toward them
    let tu = clamp(q[0], b[0], b[2]), tv = clamp(q[1], b[1], b[3]); const du = q[0] - tu, dv = q[1] - tv, dd = Math.hypot(du, dv) || 1; tu -= du / dd * Math.max(0, reach - 0.9); tv -= dv / dd * Math.max(0, reach - 0.9); tu = clamp(tu, b[0], b[2]); tv = clamp(tv, b[1], b[3]);
    const now = nowMs() / 1000, feed = now - a.fedAt > C("care.feedEvery", 75); a.act = feed ? "feed" : "pet"; if (feed) a.fedAt = now; a.st = "come"; a.tgt = [tu, tv]; a.t = 9; a.careAt = now;
    try { yaw = Math.atan2(-(S.O[0] + a.u - p.x), -(S.O[1] + a.v - p.z)); } catch (e) {}
    const kindName = C("names.kind." + a.kind, a.kind); const lines = C(feed ? "care.feedLines" : "care.petLines", feed ? ["{name} the {kind} comes over for a handful of hay."] : ["{name} the {kind} leans into a scratch."]);
    status(String(lines[(CARE.n + a.id) % lines.length]).replace("{name}", a.name).replace("{kind}", kindName)); try { sfx("ui"); } catch (e) {}
    CARE.n++; CARE.kinds[a.kind] = 1; cnt(feed ? "fed" : "petted");
    if (feed) stamp(C("stamps.feed", "p_sa_feed")); if (a.kind === "tortoise" && feed) stamp(C("stamps.tortoise", "p_sa_tortoise")); if (Object.keys(CARE.kinds).length >= C("care.friendsKinds", 4)) stamp(C("stamps.friends", "p_sa_friends"));
    // a small reward: the game's activity XP (capped by the game per day), not more often than every 30 s
    if (now - CARE.xpAt > 30) { CARE.xpAt = now; try { const PP = window.PLAN_PROGRESS; if (PP && PP.award) PP.award("activity", { game: C("care.activity", "sanctuary_care") }); } catch (e) {} }
    return true; }
  // hearts and hay chaff (a few recycled sprites)
  function fxInit() { if (CARE.fxReady) return; CARE.fxReady = true; for (let i = 0; i < 10; i++) { const s = new THREE.Sprite(i < 6 ? MT.heart : MT.chaff); s.visible = false; s.userData.noSolid = true; s.renderOrder = 4; scene.add(s); CARE.fx.push({ s, t: 9, life: 1, heart: i < 6 }); } }
  function burst(a, heart) { const KM = HERD.kinds[a.kind]; if (!KM) return; const hx = S.O[0] + a.u + Math.sin(a.yaw) * KM.len * 0.42, hz = S.O[1] + a.v + Math.cos(a.yaw) * KM.len * 0.42, hy = groundOf(a, a.u, a.v) + KM.hgt * 0.78; let n = 0;
    for (const f of CARE.fx) { if (f.t < f.life || f.heart !== heart) continue; f.t = -n * 0.22; f.life = heart ? 1.7 : 1.1; f.o = [hx + (Math.random() - 0.5) * 0.3, hy, hz + (Math.random() - 0.5) * 0.3]; f.dx = (Math.random() - 0.5) * 0.3; f.dz = (Math.random() - 0.5) * 0.3; if (++n >= (heart ? 3 : 4)) break; } }
  function fxFrame(dt) { for (const f of CARE.fx) { if (f.t >= f.life) { if (f.s.visible) f.s.visible = false; continue; } f.t += dt; if (f.t < 0) { f.s.visible = false; continue; } const k = f.t / f.life; f.s.visible = true; if (f.heart) { f.s.position.set(f.o[0] + f.dx * k, f.o[1] + 0.2 + k * 0.9, f.o[2] + f.dz * k); f.s.scale.setScalar(0.22 + Math.sin(Math.min(1, k * 3) * PI / 2) * 0.12); f.s.material.opacity = 1; } else { f.s.position.set(f.o[0] + f.dx * k * 2, f.o[1] - k * 0.5, f.o[2] + f.dz * k * 2); f.s.scale.setScalar(0.16); } }
    let fade = 0; for (const f of CARE.fx) if (f.heart && f.t < f.life && f.t > 0) fade = Math.max(fade, f.t / f.life); MT.heart.opacity = 1 - Math.max(0, fade - 0.7) / 0.3; }
  // the hearts appear when the animal arrives (come -> eat / pet), chaff while it eats
  function careFrame() { for (const a of HERD.list) { if (a.lastSt !== a.st) { if ((a.st === "eat" || a.st === "pet") && a.lastSt === "come") { burst(a, true); if (a.st === "eat") burst(a, false); try { sfx("coin"); } catch (e) {} } a.lastSt = a.st; } } }
  // ───────────────────────── E and the prompt ─────────────────────────
  function installOverrides() { if (R.ov) return; R.ov = true;
    try { const on0 = openNearest; const f = function () { try { if (!R.off && R.ready && handleE()) return; } catch (e) { note("E", e); } return on0.apply(this, arguments); }; f.sa = true; openNearest = f; } catch (e) { note("openNearest wrap", e); } }
  function handleE() { if (busy()) return false; const a = careTarget(); if (!a) return false; if (a.st === "come" || a.st === "eat" || a.st === "pet") return true; return careStart(a); }
  function promptFrame() { try { if (busy()) { FR.tgt = null; return; } const a = (FR.k % 6 === 0 || !FR.tgt) ? careTarget() : FR.tgt; FR.tgt = a; if (!a) return; const el = document.getElementById("prompt"), tt = document.getElementById("prompt-t"); if (!el || !tt) return;
      const feed = nowMs() / 1000 - a.fedAt > C("care.feedEvery", 75); const kindName = C("names.kind." + a.kind, a.kind); tt.innerHTML = "<b>E</b> &nbsp;" + esc((feed ? C("prompts.feed", "feed") : C("prompts.pet", "pet")) + " " + a.name + " the " + kindName); el.classList.add("on"); } catch (e) { note("prompt", e); } }

  // ───────────────────────── defer hook: build everything behind the loading screen, the floors, the warm-up ─────────────────────────
  const FR = R.fr = R.fr || { k: 0, inCam: false };
  function deferHook() {
    if (R.off || !window.PLAN) return; const t0 = nowMs(); const step = (name, fn) => { const t = nowMs(); try { fn(); } catch (e) { note(name, e); } R.t["ms_" + name] = Math.round(nowMs() - t); };
    step("mats", () => mats());
    step("build", () => buildAll());
    step("floors", () => { const B = L.barn, F = L.feed, yb = EX.barnY, yf = EX.feedY; solidL((B.u0 + B.u1) / 2, (B.v0 + B.v1) / 2, 0, B.u1 - B.u0 - 0.3, B.v1 - B.v0 - 0.3, yb - 0.4, yb + 0.12, "sanct"); solidL((F.u0 + F.u1) / 2, (F.v0 + F.v1) / 2, 0, F.u1 - F.u0 - 0.3, F.v1 - F.v0 - 0.3, yf - 0.4, yf + 0.06, "sanct"); solidL((F.u0 + F.u1) / 2, F.v1 + 1.8, 0, F.u1 - F.u0, 3.3, yf - 0.4, yf + 0.03, "sanct"); });
    step("herd", () => spawnHerd());
    step("fx", () => fxInit());
    step("board", () => boardTalk());
    step("herdWarm", () => { for (const kd in KINDS) { if (HERD.list.some((a) => a.kind === kd)) kindMeshes(kd); } warmKinds(); });
    step("warm", () => { const W = window.PLAN_PERF; if (W && W.warmGroup) { [EX.ext, EX.int].forEach((g) => { if (g) W.warmGroup(g, { name: g.name }); }); } });
    talkHook(); installOverrides(); R.ready = true; R.t.defer = Math.round(nowMs() - t0); }
  // the herd's meshes compile the first time they are drawn: warm each new kind's program once (behind a frame, near the sanctuary only)
  function warmKinds() { for (const kd in HERD.kinds) { const KM = HERD.kinds[kd]; if (KM.warm) continue; KM.warm = true; try { if (renderer.compile) { const vn = KM.near.visible, vf = KM.far.visible, cn = KM.near.count, cf = KM.far.count; KM.near.visible = KM.far.visible = true; KM.near.count = Math.max(1, cn); KM.far.count = Math.max(1, cf); renderer.compile(KM.near, camera, scene); renderer.compile(KM.far, camera, scene); KM.near.visible = vn; KM.far.visible = vf; KM.near.count = cn; KM.far.count = cf; cnt("warmKind"); } } catch (e) { note("warm " + kd, e); } } }
  // ───────────────────────── the camera inside the barns (kept under the roof, as the rodeo's saloon) ─────────────────────────
  function camBox(x, y, z) { const q = w2l(x, z), u = q[0], v = q[1]; for (const [r, yb] of [[L.barn, EX.barnY], [L.feed, EX.feedY]]) { if (u > r.u0 + 0.35 && u < r.u1 - 0.35 && v > r.v0 + 0.35 && v < r.v1 - 0.35 && y > yb - 0.2) { const vc = (r.v0 + r.v1) / 2, roofY = yb + r.eave + (r.ridge - r.eave) * Math.max(0, 1 - Math.abs(v - vc) / ((r.v1 - r.v0) / 2)) - 0.5; return y < roofY ? 1 : 0; } } return 0; }
  function camHook(dt) { if (R.off || !R.ready || window.__cam || !player || !EX.barnY) return false;
    try { if (busy()) { FR.inCam = false; return false; } const px = player.position.x, py = player.position.y, pz = player.position.z; if (!camBox(px, py + 1, pz)) { if (FR.inCam) { FR.inCam = false; try { player.userData.walk.visible = true; } catch (e) {} } return false; }
      FR.inCam = true; const fwd = [-Math.sin(yaw), -Math.cos(yaw)], by = typeof bobY === "number" ? bobY : 0, cy0 = py - by + 1.9, maxD = 5.5; let dist = 0;
      for (let d = 0.2; d <= maxD; d += 0.2) { const cx = px - fwd[0] * d, cz = pz - fwd[1] * d; if (!camBox(cx, cy0 + d * 0.15 - 0.6, cz)) break; dist = d; }
      if (FR.fp === undefined) FR.fp = dist < 1.3; else if (FR.fp && dist > 2.1) FR.fp = false; else if (!FR.fp && dist < 1.1) FR.fp = true;
      CAM.dist += (dist - CAM.dist) * smoothK(dt, 10); const sd = Math.min(dist, CAM.dist);
      if (FR.fp) { camera.position.set(px, py - by + 1.62, pz); CAM.init = false; camera.lookAt(px + fwd[0] * 10, camera.position.y - pitch * 6, pz + fwd[1] * 10); player.userData.walk.visible = false; }
      else { const cy = cy0 + pitch * 1.4 + sd * 0.15; camera.position.lerp(camTarget.set(px - fwd[0] * sd, cy, pz - fwd[1] * sd), smoothK(dt, 24)); camLook(px, py + 1.3, pz, dt, 30); player.userData.walk.visible = true; }
      return true; } catch (e) { note("cam", e); return false; } }
  // ───────────────────────── every frame ─────────────────────────
  function frameHook(dt, now) {
    if (R.off || !R.ready || R.abOff) return; dt = Math.min(dt || 0.016, 0.1); FR.k++; const tf0 = nowMs();
    try {
      const cam = camera.position, c0 = l2w(6, 0), dC = Math.hypot(cam.x - c0[0], cam.z - c0[1]), pp = player.position, dP = Math.hypot(pp.x - c0[0], pp.z - c0[1]); const h = hourNow();
      // drawn: the grounds within 1.3 km, the interiors within 70 m, the residents within 330 m (their own tiers)
      if (FR.k % 10 === 1) { const far = dC > 1300; if (EX.ext) EX.ext.visible = !far; if (EX.int) { const bi = l2w((L.barn.u0 + L.barn.u1) / 2, (L.barn.v0 + L.barn.v1) / 2), fi = l2w((L.feed.u0 + L.feed.u1) / 2, (L.feed.v0 + L.feed.v1) / 2); EX.int.visible = Math.min(Math.hypot(cam.x - bi[0], cam.z - bi[1]), Math.hypot(cam.x - fi[0], cam.z - fi[1])) < 58; } }
      // night: the lanterns, the windows, the glows and the pool's lamp sources
      if (FR.k % 8 === 2) { const n = clamp((nightK() - 0.04) * 2.6, 0, 1); FR.n = n; MT.lamp.emissiveIntensity = 0.05 + 2.2 * n; MT.glow.opacity = 0.34 * n; for (const l of EX.lights) { const tg = l.userData.tag; const k = tg === "in" ? 0.3 + 0.8 * n : n; l.intensity = dC < 220 ? l.userData.k0 * k : 0; } }
      // the residents load in full on approach; the herd, the staff, the roamers
      if (dP < 520 || dC < 420) herdLoad();
      if (dP < 300 && nowMs() > (FR.staffAt || 0)) { FR.staffAt = nowMs() + (ST.built ? 2500 : 350); try { buildStaff(); } catch (e) { note("staff", e); } try { roamArea(); } catch (e) { note("roam", e); } }
      herdFrame(dt, dC < 340, h); if (FR.k % 40 === 5) warmKinds(); careFrame(); fxFrame(dt); staffFrame(dt, dC < 260); promptFrame();
      if (FR.k % 15 === 7) stampsFrame();
    } catch (e) { note("frame", e); }
    const tf = nowMs() - tf0; R.n.fAvg = +(((R.n.fAvg || 0) * 0.98 + tf * 0.02)).toFixed(3); if (tf > (R.n.fMax || 0) && FR.k > 60) R.n.fMax = +tf.toFixed(1); }
  function stampsFrame() { try { const p = player.position, q = w2l(p.x, p.z); if (inBarnL(q[0], q[1]) && Math.abs(p.y - EX.barnY) < 2) stamp(C("stamps.welcome", "p_sa_welcome")); } catch (e) {} }
  // ───────────────────────── API, debug, hooks ─────────────────────────
  R.api = { l2w, w2l, gy, inFoot, padY, careTarget, animalAt };
  R.zoo = HERD;
  R.debug = {
    cam: (u, y, v, tu, ty, tv, fov) => { const a = l2w(u, v), b = l2w(tu, tv); window.__cam = [a[0], y, a[1], b[0], ty, b[1], fov || 0]; try { updateCulling(true); } catch (e) {} return window.__cam; },
    camG: (u, dy, v, tu, tdy, tv, fov) => R.debug.cam(u, gy(u, v) + dy, v, tu, gy(tu, tv) + tdy, tv, fov),
    at: (u, v, y, yawW) => { const w = l2w(u, v); player.position.set(w[0], (y === undefined ? planGroundAt(w[0], w[1]) : y) + 0.03, w[1]); if (yawW !== undefined) yaw = yawW; return [w[0], w[1]]; },
    counts: () => { const o = {}; [["ext", EX.ext], ["int", EX.int]].forEach(([k, g]) => { if (!g) return; let m = 0, tr = 0; g.traverse((x) => { if (x.isMesh) { m++; const gi = x.geometry; tr += (gi.index ? gi.index.count : gi.attributes.position.count) / 3; } }); o[k] = { meshes: m, tris: Math.round(tr) }; }); o.herd = HERD.list.length; o.kinds = Object.keys(HERD.kinds).map((k) => k + ":" + HERD.kinds[k].near.count + "/" + HERD.kinds[k].far.count); o.staff = ST.list.length; o.lights = (EX.lights || []).length; o.solids = SOLIDS.filter((s) => s.tag === "sanct").length; o.seats = SOLIDS.filter((s) => s.tag === "sanct" && s.seat).length; return o; },
    animal: (name) => HERD.list.find((a) => a.name === name),
    pose: (name, st, nP, nY) => { const a = HERD.list.find((q) => q.name === name); if (!a) return null; a.st = st || a.st; if (nP !== undefined) a.nPT = a.nP = nP; if (nY !== undefined) a.nYT = a.nY = nY; a.t = 30; return a.st; },
    place: (name, u, v, yawW) => { const a = HERD.list.find((q) => q.name === name); if (!a) return null; a.u = u; a.v = v; if (yawW !== undefined) a.yaw = yawW; a.tgt = null; return [u, v]; },
    care: () => { const a = careTarget(); return a ? (careStart(a), a.name) : null; },
    ab: (on) => { R.abOff = !on; [EX.ext, EX.int].forEach((g) => { if (g) g.visible = on; }); for (const kd in HERD.kinds) { const KM = HERD.kinds[kd]; KM.near.visible = KM.far.visible = on && KM.near.count > 0; } ST.list.forEach((c) => { c.g.visible = on; }); try { const A = R.roamArea; if (A && A.npcs) A.npcs.forEach((c) => { if (c.g && !on) c.g.visible = false; }); } catch (e) {} return on; }
  };
  (function hookAll() { const set = (phase, name, fn) => { const list = window.PLAN_HOOKS[phase]; for (let i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name, fn }); };
    set("world", "saWorld", () => worldHook()); set("terrain", "saTerrain", () => terrainHook()); set("defer", "saDefer", () => deferHook()); set("frame", "saFrame", (dt, now) => frameHook(dt, now)); set("interior", "saCam", (dt) => camHook(dt)); })();
})();
