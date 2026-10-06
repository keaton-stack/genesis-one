// R17 (5 Oct 2026): THE COPPER CHUTE SALOON & ARENA, the rodeo grounds in the North Yard (S3_NORTHYARD, beside the Frontier Ranch).
//   An Old West saloon and steakhouse joined to a working rodeo arena, after the classic Arizona saloon-with-an-arena (original name;
//   Douglas was a copper smelter town). Local frame: u along the North Yard corridor (north-east, parallel to the runway), v across it
//   toward Night Field Road (south-east), y up from the arena pad. The grounds sit between the Runway Wash Trail and Night Field Road.
//   - the arena: 48 x 26 m of deep raked dirt inside a painted pipe fence, four bucking chutes with swinging gates on the saloon side,
//     a catwalk and lead-up alley, the return alley to the stock pens (bulls, broncs, saddle horses), the announcer's stand with a
//     scoreboard, six light towers for night events, a covered seven-row grandstand you can sit in, an entry gate and the concourse
//   - the saloon and steakhouse: a 36 x 17 m barnwood hall with a false front and its painted sign on Night Field Road, the long bar
//     with the back bar and a brass rail, steakhouse tables, the dance floor and the band stage under a painted mural, a mechanical
//     bull in a padded ring, wagon-wheel chandeliers, neon signs; the covered patio deck along the arena with a rail bar, wrapping
//     round to the BBQ terrace (an offset smoker, picnic tables under a ramada, string lights)
//   - events: bull riding and saddle bronc on a schedule (an afternoon slack, Rodeo Night every evening): an animated rider on an
//     animated bull or bronc out of the chute, eight seconds or thrown, two bullfighters, the pickup, the score on the board, the
//     announcer and the crowd; the mechanical bull ride inside (E); talk cards; roaming cowboys and cowgirls (PLAN_ROAM)
//   - horses: the remuda corral beside the pens (horses from the Frontier Ranch), two saddled horses at the hitching rail
//   - golf-cart parking across the road (a few pickups), joined to the paths with R15 edging (planRibbon walks)
// Classic script, loaded before plan_fill_a.js and client.js; hooks into window.PLAN_HOOKS { terrain, world, defer, frame, interior }
// and wraps a few client functions by bare name at run time (openNearest). No new real lights (lamp sources for the client's pool),
// merged geometry per shared material, instancing for engine kinds. ?rodeo=0 turns the module off. window.PLAN_RODEO: n, errs, site,
// api, debug. Copy: plan/rodeo.json.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  const R = window.PLAN_RODEO = window.PLAN_RODEO || {};
  R.v = "r17"; R.errs = R.errs || []; R.n = R.n || {}; R.t = R.t || {};
  if (/[?&]rodeo=0\b/.test(location.search)) { R.off = true; return; }
  const PI = Math.PI, TAU = PI * 2;
  function note(tag, e) { try { if (R.errs.length < 50) R.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (R.errs.length <= 6) console.warn("plan_rodeo " + tag, e); } catch (x) {} }
  const cnt = (k, n) => { R.n[k] = (R.n[k] || 0) + (n === undefined ? 1 : n); };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function rng(seed) { let s = seed | 0; return function () { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const nowMs = () => performance.now();
  function nightK() { try { return typeof night === "number" ? night : 0; } catch (e) { return 0; } }
  function has(k) { try { return !!(MODELS[k] && (MODELS[k].parts || MODELS[k]._pp)); } catch (e) { return false; } }
  function canPut(k) { try { return has(k) && !!MODEL_SPECS[k]; } catch (e) { return false; } }
  function lowTier() { try { return ASSET.tier === "m"; } catch (e) { return false; } }
  function qual() { try { return localStorage.getItem("g1:quality") || "high"; } catch (e) { return "high"; } }
  const Q = qual(), ULTRA = Q === "ultra", HIGHQ = Q === "ultra" || Q === "high";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function au(u) { try { if (window.AV) return window.AV(u); } catch (e) {} return u; }
  function hourNow() { try { return dayT() * 24; } catch (e) { return 12; } }
  function busy() { try { return (typeof riding !== "undefined" && riding) || (typeof SIT !== "undefined" && SIT.on) || (typeof inside !== "undefined" && inside) || (typeof DANCE !== "undefined" && DANCE.on) || (typeof FLY !== "undefined" && FLY.on) || (typeof golf !== "undefined" && golf.playing) || (typeof RIDE !== "undefined" && RIDE.on && !MB.on); } catch (e) { return false; } }
  function stamp(id) { try { const PP = window.PLAN_PROGRESS; if (PP && PP.award && id) PP.award("stamp", { id }); cnt("stamp_" + id); } catch (e) {} }
  // the venue people cast no real shadows (the contact blob grounds them, as the R10 roamers): every mesh of the rig, hair and hat included
  function noShadow(g) { try { g.traverse((o) => { if (o.isMesh) o.castShadow = false; }); if (g.userData.blob) g.userData.blob.visible = true; } catch (e) {} return g; }
  function status(t, err) { try { setStatus(t, !!err); } catch (e) {} }

  // ───────────────────────── config: plan/rodeo.json (built-in fallbacks everywhere) ─────────────────────────
  let CFG = R.cfg || null;
  const cfgUrl = () => au("/plan/rodeo.json?v=" + (window.BUILD || "dev"));
  if (!CFG) { try { fetch(cfgUrl()).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && !CFG) CFG = R.cfg = d; }).catch((e) => note("cfg fetch", e)); } catch (e) { note("cfg", e); } }
  function cfg() { if (CFG) return CFG; try { const x = new XMLHttpRequest(); x.open("GET", cfgUrl(), false); x.send(null); if (x.status >= 200 && x.status < 300) CFG = R.cfg = JSON.parse(x.responseText); } catch (e) { note("cfg sync", e); } return CFG || {}; }
  function C(path, dflt) { let o = cfg(); const p = path.split("."); for (let i = 0; i < p.length; i++) { if (o == null) return dflt; o = o[p[i]]; } return o === undefined ? dflt : o; }

  // ───────────────────────── the venue frame: u north-east along the corridor, v south-east toward Night Field Road ─────────────────────────
  const S = R.site = R.site || {};
  S.O = [919, -387]; S.U = [0.6540, -0.7566]; S.V = [0.7566, 0.6540]; S.th = Math.atan2(S.V[0], S.V[1]);   // a mesh with rotation.y = th has local x along u, local z along v
  if (S.YA === undefined) { S.YA = 25; S.YS = 26.4; }                                                                                 // arena pad and saloon floor (set in the terrain hook)
  function l2w(u, v) { return [S.O[0] + u * S.U[0] + v * S.V[0], S.O[1] + u * S.U[1] + v * S.V[1]]; }
  function w2l(x, z) { const dx = x - S.O[0], dz = z - S.O[1]; return [dx * S.U[0] + dz * S.U[1], dx * S.V[0] + dz * S.V[1]]; }
  const yawL = (a) => S.th + (a || 0);                                                                       // world yaw of a local yaw
  const fwdYaw = (du, dv) => Math.atan2(du * S.U[0] + dv * S.V[0], du * S.U[1] + dv * S.V[1]);              // world yaw that faces local direction (du, dv)

  // ───────────────────────── geometry kit (as plan_bodyshop): parts collected per base material with a vertex colour, merged once ─────────────────────────
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
  // a box with world-scale uv (t: metres per texture repeat); ry turns it about y
  Kit.prototype.box = function (b, col, w, h, d, x, y, z, ry, t, rx, rz) { const g = new THREE.BoxGeometry(w, h, d); if (t) uvBox(g, w, h, d, t); return this.place(b, g, col, x, y, z, ry, rx, rz); };
  Kit.prototype.cyl = function (b, col, r0, r1, h, x, y, z, seg, open, ry, rx, rz) { return this.place(b, new THREE.CylinderGeometry(r0, r1, h, seg || 10, 1, !!open), col, x, y, z, ry, rx, rz); };
  Kit.prototype.sph = function (b, col, r, x, y, z, seg, sx, sy, sz) { return this.place(b, new THREE.SphereGeometry(r, seg || 10, Math.max(5, (seg || 10) >> 1)), col, x, y, z, 0, 0, 0, sx, sy, sz); };
  // a pipe between two points (local), radius r
  Kit.prototype.tube = function (b, col, A, B, r, seg) { const d = _v3.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]), L = d.length(); if (L < 1e-4) return null; const g = new THREE.CylinderGeometry(r, r, L, seg || 8, 1, true); _q.setFromUnitVectors(_v1.set(0, 1, 0), d.normalize()); _m4.compose(_v2.set((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2), _q, _s1); return this.add(b, g, col, _m4); };
  // a plank or beam between two points (local), w wide (horizontal), h tall
  Kit.prototype.beam = function (b, col, A, B, w, h, t) { const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L = Math.hypot(dx, dy, dz); if (L < 1e-4) return null; const g = new THREE.BoxGeometry(L, h, w); if (t) uvBox(g, L, h, w, t); const ry = Math.atan2(-dz, dx), rz = Math.atan2(dy, Math.hypot(dx, dz)); _e.set(0, ry, rz, "YZX"); _q.setFromEuler(_e); _m4.compose(_v1.set((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2), _q, _s1); return this.add(b, g, col, _m4); };
  Kit.prototype.plane = function (b, col, w, h, x, y, z, ry, rx, uv, rz) { const g = new THREE.PlaneGeometry(w, h); if (uv) { const U = g.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, uv[0] + U.getX(i) * (uv[2] - uv[0]), uv[1] + U.getY(i) * (uv[3] - uv[1])); } return this.place(b, g, col, x, y, z, ry, rx, rz); };
  // a flat quad lying on y with world-scale uv (t metres per repeat)
  Kit.prototype.slab = function (b, col, x0, z0, x1, z1, y, t, rot, seg) { const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, seg || 1, seg || 1); g.rotateX(-PI / 2); const U = g.attributes.uv, P = g.attributes.position; for (let i = 0; i < U.count; i++) { const px = P.getX(i) + cx, pz = P.getZ(i) + cz; U.setXY(i, rot ? pz / t : px / t, rot ? px / t : -pz / t); } return this.place(b, g, col, cx, y, cz); };
  Kit.prototype.merge = function () { const out = {}; for (const k in this.m) { const g = mergeAll(this.m[k]); if (g) out[k] = g; } return out; };
  Kit.prototype.build = function (grp, bases, opts) { opts = opts || {}; const out = [], geos = this.merge(); for (const b in geos) { const mt = bases[b]; if (!mt) { note("base", b); continue; } const me = new THREE.Mesh(geos[b], mt); me.name = "ro " + (opts.tag || "") + " " + b; me.castShadow = opts.cast !== false && !mt.transparent && !(opts.noCast && opts.noCast.indexOf(b) >= 0); me.receiveShadow = opts.receive !== false && !mt.transparent; me.userData.shSet = true; me.userData.noSolid = true; if (mt.transparent) me.renderOrder = 2; if (mt.userData && mt.userData.ro) me.renderOrder = mt.userData.ro; grp.add(me); out.push(me); } this.m = {}; return out; };
  function mergeAll(list) {
    if (!list || !list.length) return null; let n = 0; list.forEach((g) => { n += g.attributes.position.count; }); if (!n) return null;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), Uu = new Float32Array(n * 2), Cc = new Float32Array(n * 3); let o = 0;
    list.forEach((g) => { const c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); Uu.set(g.attributes.uv.array, o * 2); if (g.attributes.color) Cc.set(g.attributes.color.array, o * 3); else Cc.fill(1, o * 3, (o + c) * 3); o += c; g.dispose(); });
    const r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(P, 3)); r.setAttribute("normal", new THREE.BufferAttribute(N, 3)); r.setAttribute("uv", new THREE.BufferAttribute(Uu, 2)); r.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
    r.computeBoundingBox(); r.computeBoundingSphere(); r.userData.avShared = true; return r; }
  function uvBox(g, w, h, d, t) { const uv = g.attributes.uv; const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } }
  // vertical boards: rotate a box's side uv by 90 degrees (planks run up the wall)
  function uvRot(g) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const a = uv.getX(i), b = uv.getY(i); uv.setXY(i, b, a); } return g; }
  // a darkening multiplier on the vertex colours below a height (contact grime) and toward the floor of a room
  function grime(g, y0, y1, k) { const P = g.attributes.position, Cc = g.attributes.color; if (!Cc) return g; for (let i = 0; i < P.count; i++) { const y = P.getY(i); const f = 1 - k * (1 - sstep(y0, y1, y)); Cc.setXYZ(i, Cc.getX(i) * f, Cc.getY(i) * f, Cc.getZ(i) * f); } return g; }
  // the venue's groups: one root per zone, placed at the local origin on the arena pad and turned into the local frame
  function zoneGroup(name) { const g = new THREE.Group(); g.name = "ro_" + name; g.position.set(S.O[0], S.YA, S.O[1]); g.rotation.y = S.th; g.userData.noCull = true; g.userData.landSkip = true; g.userData.noBatch = true; scene.add(g); g.updateMatrixWorld(true); return g; }
  // a local box as a client solid (local centre, local yaw a, size w along u x d along v, heights relative to the arena pad)
  function solidL(u, v, a, w, d, y0, y1, tag, extra) { const p = l2w(u, v); const sd = addSolid(p[0], p[1], yawL(a), w, d, S.YA + y0, S.YA + y1, tag || "rodeo"); if (sd && extra) Object.assign(sd, extra); if (sd) cnt("solids"); return sd; }
  function seatL(u, v, a, w, d, y, faceDu, faceDv, tag) { const sd = solidL(u, v, a, w, d, y - 0.4, y, tag || "rodeo"); if (sd) { sd.seat = true; sd.face = fwdYaw(faceDu, faceDv); sd.ro = 1; cnt("seats"); } return sd; }

  // ───────────────────────── textures: tex/ro_* (KTX2 on the desktop tier, JPEG/PNG fallback, _m copies on the low tier) ─────────────────────────
  const TX = R.tx = R.tx || {}; const PEND = [];
  let ANISO_ = 0; function aniso() { if (!ANISO_) { try { ANISO_ = Math.min(ULTRA ? 16 : HIGHQ ? 8 : 4, renderer.capabilities.getMaxAnisotropy()); } catch (e) { return 4; } } return ANISO_; }
  function dataTex(rgba) { const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; t.userData.avShared = true; return t; }
  const PH = R.ph = R.ph || {};
  function ph(kind) { if (!PH[kind]) { PH[kind] = dataTex(kind === "n" ? [128, 128, 255, 255] : kind === "r" ? [235, 235, 235, 255] : kind === "ao" || kind === "w" ? [255, 255, 255, 255] : [200, 200, 200, 255]); if (kind === "c" || kind === "w") PH[kind].colorSpace = THREE.SRGBColorSpace; } return PH[kind]; }
  function setup(t, srgb, wrap) { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = wrap === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping; t.anisotropy = aniso(); t.userData.avShared = true; return t; }
  // load tex/<name> into material slots: on arrival every waiting material gets the texture (same program: a placeholder held the slot)
  function texInto(name, srgb, wrap, ext, slots) {
    let T = TX[name];
    if (!T) { T = TX[name] = { tex: null, users: [] };
      const low = lowTier(), k2 = !low && !/[?&]roktx=0\b/.test(location.search) && typeof ktx2Loader === "function" ? ktx2Loader() : null;
      const done = (t) => { setup(t, srgb, wrap); t.name = "ro_" + name; T.tex = t; T.users.forEach((u) => { u[0][u[1]] = t; }); cnt("texLoaded"); };
      const plain = () => { try { new THREE.TextureLoader().load(au("/tex/" + name + (low ? "_m" : "") + "." + (ext || "jpg") + "?v=" + (window.BUILD || "dev")), done, undefined, (e) => note("tex " + name, e)); } catch (e) { note("tex " + name, e); } };
      if (k2) { try { k2.load(au("/tex/" + name + ".ktx2?v=" + (window.BUILD || "dev")), done, undefined, () => { cnt("ktxFail"); plain(); }); } catch (e) { plain(); } } else plain(); }
    slots.forEach((s) => { if (T.tex) s[0][s[1]] = T.tex; else T.users.push(s); });
  }
  // ───────────────────────── canvas textures (signs drawn as neon tubes, the scoreboard, glows, bunting) ─────────────────────────
  // canvases at half size on the low tier (the drawing code works in the full-size space through a scale)
  function canvasTex(w, h, fn, srgb, wrap) { const k = lowTier() && w >= 512 ? 0.5 : 1; const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k); const x = c.getContext("2d"); if (k !== 1) x.scale(k, k); fn(x, w, h); const t = new THREE.CanvasTexture(c); setup(t, srgb !== false, wrap === true); t.userData.cv = c; return t; }
  const FONT_S = "'Space Grotesk', system-ui, sans-serif";
  function neonText(x, txt, cx, cy, size, col, font, track) {
    x.save(); x.font = (font || "700 ") + size + "px " + (track ? FONT_S : "Georgia, 'Times New Roman', serif"); x.textAlign = "center"; x.textBaseline = "middle";
    x.lineJoin = "round"; x.shadowColor = col; x.shadowBlur = size * 0.45; x.strokeStyle = col; x.lineWidth = Math.max(3, size * 0.13); x.strokeText(txt, cx, cy); x.shadowBlur = size * 0.22; x.strokeText(txt, cx, cy);
    x.shadowBlur = 0; x.lineWidth = Math.max(1.5, size * 0.05); x.strokeStyle = "rgba(255,248,235,0.92)"; x.strokeText(txt, cx, cy); x.restore(); }
  function neonPath(x, pts, col, w) { x.save(); x.lineJoin = x.lineCap = "round"; x.shadowColor = col; x.strokeStyle = col; for (const [blur, lw, c] of [[w * 3.2, w, col], [w * 1.4, w, col], [0, w * 0.4, "rgba(255,248,235,0.9)"]]) { x.shadowBlur = blur; x.lineWidth = lw; x.strokeStyle = c; x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.stroke(); } x.restore(); }
  // the neon atlas (1024 x 1024): every glowing sign of the venue; uv rectangles in NEON.r
  const NEON = R.neon = R.neon || { r: {} };
  function neonAtlas() {
    if (NEON.tex) return NEON.tex; const W = 1024; const r = NEON.r;
    const reg = (k, x0, y0, w, h) => { r[k] = [x0 / W, 1 - (y0 + h) / W, (x0 + w) / W, 1 - y0 / W]; };
    NEON.tex = canvasTex(W, W, (x) => {
      x.fillStyle = "#0d0907"; x.fillRect(0, 0, W, W);
      const board = (x0, y0, w, h) => { const g = x.createLinearGradient(0, y0, 0, y0 + h); g.addColorStop(0, "#1a120d"); g.addColorStop(1, "#0b0705"); x.fillStyle = g; x.fillRect(x0 + 4, y0 + 4, w - 8, h - 8); };
      // the hero sign: a neon bull rider over THE COPPER CHUTE
      board(0, 0, 1024, 340); reg("hero", 0, 0, 1024, 340);
      const bull = [[300, 210], [330, 175], [390, 160], [470, 160], [520, 150], [545, 165], [560, 190], [585, 196], [590, 214], [560, 216], [545, 240], [520, 250], [500, 300], [482, 300], [490, 255], [420, 250], [380, 300], [362, 300], [372, 250], [330, 236], [300, 210]];
      neonPath(x, bull, "#ff6a1e", 7); neonPath(x, [[548, 168], [575, 142], [600, 150]], "#ffe2b0", 5); neonPath(x, [[300, 210], [262, 190], [250, 220]], "#ff6a1e", 6);
      neonPath(x, [[430, 158], [440, 118], [452, 92], [470, 86], [478, 104], [466, 118], [446, 120]], "#ffd34a", 6); neonPath(x, [[452, 92], [430, 60], [420, 40]], "#ffd34a", 6); neonPath(x, [[456, 110], [490, 128], [506, 154]], "#ffd34a", 5); neonPath(x, [[444, 74], [474, 74]], "#ffd34a", 6); neonPath(x, [[438, 80], [480, 80]], "#ffd34a", 4);
      neonText(x, "THE COPPER CHUTE", 512, 296, 74, "#ff5a28"); neonText(x, "SALOON  ★  STEAKHOUSE", 230, 60, 30, "#5fd8ff", null, true); neonText(x, "RODEO ARENA", 800, 60, 34, "#5fd8ff", null, true);
      const sm = [["steaks", 0, 340, 512, 128, "STEAKS", "#ff3b2e"], ["music", 512, 340, 512, 128, "LIVE MUSIC", "#ffd34a"], ["bull", 0, 468, 512, 128, "RIDE THE BULL", "#45b8ff"], ["dance", 512, 468, 512, 128, "DANCE HALL", "#ff5fb0"], ["open", 0, 596, 256, 128, "OPEN", "#ff3b2e"], ["bbq", 256, 596, 256, 128, "BBQ", "#ff8a1e"], ["arena", 512, 596, 512, 128, "THE ARENA", "#ffe08a"]];
      sm.forEach(([k, x0, y0, w, h, t, c]) => { board(x0, y0, w, h); reg(k, x0, y0, w, h); neonText(x, t, x0 + w / 2, y0 + h / 2 + 4, Math.min(76, Math.floor(w * 1.55 / t.length)), c, null, true); });
      for (let i = 0; i < 4; i++) { const x0 = i * 128, y0 = 724; board(x0, y0, 128, 128); reg("n" + (i + 1), x0, y0, 128, 128); neonText(x, String(i + 1), x0 + 64, y0 + 68, 84, "#ffd34a"); }
      board(512, 724, 512, 128); reg("logo", 512, 724, 512, 128);
      board(0, 852, 1024, 172); reg("archtext", 0, 852, 1024, 172); neonText(x, "THE COPPER CHUTE ARENA", 512, 940, 58, "#ffcf6a");
    }, true);
    // the GIVEBACK mark (branding transparent.png as tex/ar_logo.png, 2:1, drawn by height) into its board when it arrives
    try { const im = new Image(); im.onload = () => { try { const c = NEON.tex.userData.cv, x = c.getContext("2d"); const h = 104, w = h * 2; x.save(); x.shadowColor = "#7dff9a"; x.shadowBlur = 14; x.drawImage(im, 768 - w / 2, 788 - h / 2, w, h); x.restore(); NEON.tex.needsUpdate = true; } catch (e) { note("logo draw", e); } }; im.src = au("/tex/ar_logo.png"); } catch (e) { note("logo", e); }
    return NEON.tex; }
  // the scoreboard (512 x 256): redrawn when the show changes it
  const BOARD = R.board = R.board || { last: "" };
  function boardTex() { if (BOARD.tex) return BOARD.tex; BOARD.tex = canvasTex(512, 256, (x) => drawBoard(x, null), true); return BOARD.tex; }
  function drawBoard(x, d) { const W = 512, H = 256; x.fillStyle = "#070605"; x.fillRect(0, 0, W, H); x.strokeStyle = "#3a2a1a"; x.lineWidth = 6; x.strokeRect(3, 3, W - 6, H - 6);
    const led = (t, cx, cy, s, col, al) => { x.save(); x.font = "700 " + s + "px " + FONT_S; x.textAlign = al || "center"; x.textBaseline = "middle"; x.shadowColor = col; x.shadowBlur = 10; x.fillStyle = col; x.fillText(t, cx, cy); x.restore(); };
    led("THE COPPER CHUTE", 256, 30, 30, "#ff9a3a");
    if (!d) { led("RODEO NIGHT", 256, 100, 46, "#ffd34a"); led("EVERY EVENING", 256, 150, 30, "#ffb060"); led("SLACK AT 2 PM", 256, 200, 26, "#c8a070"); return; }
    led(d.ev || "BULL RIDING", 256, 70, 28, "#5fd8ff"); led(d.l1 || "", 24, 112, 30, "#ffd34a", "left"); led(d.l2 || "", 24, 152, 26, "#ffb060", "left");
    led(d.big || "", 256, 210, 54, d.col || "#ff5a28"); }
  function setBoard(d) { const key = d ? [d.ev, d.l1, d.l2, d.big, d.col].join("|") : ""; if (key === BOARD.last || !BOARD.tex) return; BOARD.last = key; drawBoard(BOARD.tex.userData.cv.getContext("2d"), d); BOARD.tex.needsUpdate = true; }
  function glowTex() { if (TX._glow) return TX._glow; TX._glow = canvasTex(128, 128, (x) => { const g = x.createRadialGradient(64, 64, 2, 64, 64, 62); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.18, "rgba(255,255,255,0.55)"); g.addColorStop(0.5, "rgba(255,255,255,0.12)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 128, 128); }, true); return TX._glow; }
  function puffTex() { if (TX._puff) return TX._puff; TX._puff = canvasTex(128, 128, (x) => { const R0 = rng(77); for (let i = 0; i < 26; i++) { const px = 64 + (R0() - 0.5) * 50, py = 64 + (R0() - 0.5) * 50, r = 18 + R0() * 26; const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, "rgba(255,255,255,0.22)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 128, 128); } }, true); return TX._puff; }
  // pennant bunting (alpha): six coloured triangles in a strip
  function buntTex() { if (TX._bunt) return TX._bunt; TX._bunt = canvasTex(512, 64, (x) => { const cols = ["#b5332a", "#f1e3c4", "#2f6aa8", "#d9a441", "#b5332a", "#f1e3c4", "#2f6aa8", "#d9a441"]; for (let i = 0; i < 8; i++) { x.fillStyle = cols[i]; x.beginPath(); x.moveTo(i * 64 + 2, 0); x.lineTo(i * 64 + 62, 0); x.lineTo(i * 64 + 32, 60); x.closePath(); x.fill(); x.fillStyle = "rgba(0,0,0,0.12)"; x.fillRect(i * 64 + 2, 0, 60, 5); } }, true, true); return TX._bunt; }

  // ───────────────────────── materials: a few shared families (one program each) ─────────────────────────
  const MT = R.mats = R.mats || {};
  function bm(m, opt) { try { if (window.PLAN_BMAT && PLAN_BMAT.patchMat && !/[?&]robm=0\b/.test(location.search)) PLAN_BMAT.patchMat(m, opt || {}); } catch (e) { note("bmat", e); } return m; }
  // exterior PBR: map + normal + roughness + vertex colour (tints), the R16 building pass on top (detail, grime, dust) where it runs
  function ext(name, map, nrm, rgh, o) { const m = new THREE.MeshStandardMaterial(Object.assign({ name: "ro " + name, vertexColors: true, roughness: 1, metalness: 0, map: ph("c"), normalMap: ph("n"), roughnessMap: ph("r"), normalScale: new THREE.Vector2(0.9, 0.9) }, o || {}));
    const slot = (s, v, srgb) => { if (!v) { if (s === "map") m.map = ph("w"); return; } if (v.isTexture) m[s] = v; else texInto(v[0], srgb, v[1] !== false, v[2], [[m, s]]); }; slot("map", map, true); slot("normalMap", nrm, false); slot("roughnessMap", rgh, false);
    m.userData.avShared = true; return m; }
  // interior PBR: the same plus a one-texel ao map, so the sky's ambient and environment are cut inside the walls (the sun only through the openings)
  function int(name, map, nrm, rgh, o, ao) { const m = ext(name, map, nrm, rgh, Object.assign({ aoMap: ph("ao"), aoMapIntensity: ao === undefined ? 0.62 : ao, envMapIntensity: 0.55 }, o || {})); m.name = "ro in " + name; return m; }
  function mats() {
    if (MT.ready) return MT; const T = TEX;
    MT.wood = bm(ext("wood barnwood", T.wood, T.woodN, T.woodR, { color: 0xffffff }), { det: 1 });                 // weathered barnwood: siding, decks, rails, benches
    MT.corr = bm(ext("metal corrugated", T.corrugated, T.corrugatedN, T.corrugatedR, { metalness: 0.55, roughness: 0.9 }));   // roofs (vertex colour: rust or galvanized)
    MT.steel = bm(ext("steel pipe", null, null, T.woodR, { metalness: 0.62, roughness: 0.62 }));                      // painted pipe fence, frames (vertex colour paint)
    MT.dirt = ext("arena dirt", ["ro_dirt"], ["ro_dirt_n"], ["ro_dirt_r"], { normalScale: new THREE.Vector2(1.6, 1.6), envMapIntensity: 0.35 });   // the arena floor (not patched: its own detail)
    MT.ground = ext("ground caliche", T.dirt, T.dirtN, T.dirtR, { normalScale: new THREE.Vector2(1.0, 1.0) });          // pen floors, aprons
    MT.adobe = bm(ext("adobe stucco", T.adobe, T.adobeN, T.adobeR, {}));                                               // the smoker pit, chimney base, piers
    MT.sign = bm(ext("wood sign", ["ro_sign", false], ["ro_sign_n", false], T.woodR, {}), { det: 0.6 });               // the painted sign boards
    MT.glass = new THREE.MeshStandardMaterial({ name: "ro window glass", color: 0x2a2620, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.38, depthWrite: false }); bm(MT.glass); MT.glass.userData.avShared = true;
    // emissive family: signs, lamp heads, bulbs, lit windows (map + emissive map, vertex colour)
    const nt = neonAtlas(); MT.neon = new THREE.MeshStandardMaterial({ name: "ro neon emit", vertexColors: true, map: nt, emissiveMap: nt, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.55, metalness: 0.1 }); MT.neon.userData.avShared = true;
    MT.lamp = new THREE.MeshStandardMaterial({ name: "ro lamp emit", vertexColors: true, map: ph("w"), emissiveMap: ph("w"), emissive: 0xfff1d6, emissiveIntensity: 0.0, roughness: 0.4, metalness: 0.2 }); MT.lamp.userData.avShared = true;
    MT.bulb = new THREE.MeshStandardMaterial({ name: "ro bulb emit", vertexColors: true, map: ph("w"), emissiveMap: ph("w"), emissive: 0xffc77a, emissiveIntensity: 0.3, roughness: 0.4 }); MT.bulb.userData.avShared = true;
    MT.win = new THREE.MeshStandardMaterial({ name: "ro window light emit", vertexColors: true, map: ph("w"), emissiveMap: ph("w"), emissive: 0xffa453, emissiveIntensity: 0.0, roughness: 0.3 }); MT.win.userData.avShared = true;
    const bt = boardTex(); MT.board = new THREE.MeshStandardMaterial({ name: "ro score screen emit", vertexColors: true, map: bt, emissiveMap: bt, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.5 }); MT.board.userData.avShared = true;
    // cut-outs: bunting, the skull, the rug (alpha test, both sides)
    MT.bunt = new THREE.MeshStandardMaterial({ name: "ro cloth bunting", map: buntTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, vertexColors: true }); MT.bunt.userData.avShared = true;
    MT.skull = new THREE.MeshStandardMaterial({ name: "ro cut skull", map: ph("c"), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, vertexColors: true }); texInto("ro_skull", true, false, "png", [[MT.skull, "map"]]); MT.skull.userData.avShared = true;
    MT.hide = new THREE.MeshStandardMaterial({ name: "ro cut cowhide", map: ph("c"), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, vertexColors: true }); texInto("ro_cowhide", true, false, "png", [[MT.hide, "map"]]); MT.hide.userData.avShared = true;
    // additive glow (halos, beams, fire): one basic material; and the puff for smoke and dust (sprites)
    MT.glow = new THREE.MeshBasicMaterial({ name: "ro glow add", map: glowTex(), color: 0xffd9a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide, vertexColors: true, opacity: 0.0 }); MT.glow.userData.avShared = true;
    MT.beam = new THREE.MeshBasicMaterial({ name: "ro beam add", map: glowTex(), color: 0xfff0d0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide, vertexColors: true, opacity: 0.0 }); MT.beam.userData.avShared = true;
    MT.smoke = new THREE.SpriteMaterial({ name: "ro smoke", map: puffTex(), color: 0xb8b0a6, transparent: true, depthWrite: false, opacity: 0.55 }); MT.smoke.userData.avShared = true;
    MT.dust = new THREE.SpriteMaterial({ name: "ro dust", map: puffTex(), color: 0x8a6e52, transparent: true, depthWrite: false, opacity: 0.3 }); MT.dust.userData.avShared = true;
    // interior family (the saloon): barnwood walls and floor, corrugated ceiling, pictures and the bar front
    MT.iwood = int("wood barnwood", T.wood, T.woodN, T.woodR, {});
    MT.icorr = int("metal corrugated", T.corrugated, T.corrugatedN, T.corrugatedR, { metalness: 0.5, roughness: 0.85 }, 0.75);
    MT.isteel = int("steel brass", null, null, T.woodR, { metalness: 0.85, roughness: 0.32 });
    MT.mural = int("mural", ["ro_mural", false], ["ro_mural_n", false], T.woodR, {});
    MT.brands = int("bar front", ["ro_brands", false], ["ro_brands_n", false], T.woodR, {});
    MT.posters = int("posters", ["ro_posters", false], null, T.woodR, {});
    MT.menu = int("menu", ["ro_menu", false], null, T.woodR, {});
    MT.bottles = int("back bar", ["ro_rvbottles", false], null, T.woodR, { roughness: 0.55 });
    MT.wanted = int("wanted", ["ro_rvwanted", false], null, T.woodR, {});
    MT.tack = int("tack wall", ["ro_rvtack", false], null, T.woodR, {});
    MT.ready = true; return MT; }

  // ───────────────────────── the layout (local u, v in metres; y from the arena pad) ─────────────────────────
  const L = R.L = {
    arena: { u0: -26, u1: 22, v0: -19.6, v1: 6.6, r: 5, h: 1.95 },               // the pipe fence line; deep dirt inside
    gateSW: { u: -26, v0: -9.2, v1: -3.8 },                                       // the entry gate at the south-west end (open between shows)
    gateOut: { u: 22, v0: -13.2, v1: -9.6 },                                      // the out gate to the return alley (north-east end)
    chutes: { u0: 11.0, w: 1.8, n: 4, v0: 6.6, v1: 9.4 },                         // four bucking chutes on the saloon side
    catwalk: { u0: 10.6, u1: 18.6, v0: 9.4, v1: 10.6, y: 1.3 },
    lead: { u0: 10.6, u1: 24.6, v0: 10.6, v1: 12.8 },                              // the lead-up alley from the pens to the chutes
    alley: { u0: 22.0, u1: 24.6, v0: -14.6, v1: 33.5 },                            // the return alley along the north-east end
    pens: { u0: 24.6, u1: 42.0, v0: 12.8, v1: 33.5, um: 33.0, vm: 23.0 },
    booth: { u0: 11.5, u1: 17.5, v0: 13.4, v1: 17.2, y: 3.1, top: 6.0 },          // the announcer's stand (and the scoreboard on it)
    remuda: { u0: 9.0, u1: 21.4, v0: 19.2, v1: 34.0 },                              // the horse corral beside the pens
    stand: { u0: -22, u1: 16, v0: -21.0, rows: 7, dep: 0.8, rise: 0.42, back: -27.4 }, // the covered grandstand (rows step back toward -v)
    saloon: { u0: -30, u1: 6, v0: 16, v1: 33, eave: 5.2, ridge: 7.8 },
    porch: { v0: 33, v1: 36.4, roof: 3.6 },
    deck: { u0: -30, u1: 6, v0: 10.5, v1: 16, roof0: 4.5, roof1: 3.5 },
    terrace: { u0: -45, u1: -30, v0: 10.5, v1: 34.6 },
    towers: [[-28.0, -21.8], [-28.4, 9.0], [26.6, -22.4], [20.6, 10.0], [-2, -28.6], [-2, 10.2]],
    lot: { u0: -29.5, u1: -5, v0: 54.5, v1: 69.8 },
    geo: [950.4, -461.7], geoR: 50,                                                 // the Ring geoglyph (kept clear)
    stars: [878, -352], starsR: 22                                                  // the Launch Field Star Benches (kept clear)
  };
  R.L = L;
  function inRect(u, v, r, m) { m = m || 0; return u > r.u0 - m && u < r.u1 + m && v > r.v0 - m && v < r.v1 + m; }
  // the arena's rounded rectangle: signed distance (negative inside)
  function arenaSD(u, v, inset) { const A = L.arena, cu = (A.u0 + A.u1) / 2, cv = (A.v0 + A.v1) / 2, hu = (A.u1 - A.u0) / 2 - A.r - (inset || 0), hv = (A.v1 - A.v0) / 2 - A.r - (inset || 0); const qx = Math.abs(u - cu) - hu, qz = Math.abs(v - cv) - hv; return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - A.r; }
  // the fence outline as a polyline of posts (closed), every ~2.4 m, with the gates as gaps
  function arenaLoop(step, inset) { const A = L.arena, cu = (A.u0 + A.u1) / 2, cv = (A.v0 + A.v1) / 2, r = A.r - (inset || 0), hu = (A.u1 - A.u0) / 2 - A.r, hv = (A.v1 - A.v0) / 2 - A.r; const pts = [];
    const seg = (a, b) => { const L0 = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L0 / step)); for (let i = 0; i < n; i++) pts.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); };
    const arc = (c0, c1, a0) => { const n = Math.max(2, Math.round(r * PI / 2 / step)); for (let i = 0; i < n; i++) { const a = a0 + i / n * PI / 2; pts.push([c0 + Math.cos(a) * r, c1 + Math.sin(a) * r]); } };
    const e = (inset || 0);
    seg([cu - hu, cv - hv - r + e], [cu + hu, cv - hv - r + e]); arc(cu + hu, cv - hv, -PI / 2); seg([cu + hu + r - e, cv - hv], [cu + hu + r - e, cv + hv]); arc(cu + hu, cv + hv, 0);
    seg([cu + hu, cv + hv + r - e], [cu - hu, cv + hv + r - e]); arc(cu - hu, cv + hv, PI / 2); seg([cu - hu - r + e, cv + hv], [cu - hu - r + e, cv - hv]); arc(cu - hu, cv - hv, PI); return pts; }
  // Night Field Road in the local frame (centre line v at u) from plan.json
  let ROADL = null;
  function roadV(u) { if (!ROADL) { ROADL = []; try { const r = PLAN_IDX.road.get("night_field_rd"); if (r) ROADL = r.pts.map((p) => w2l(p[0], p[1])); } catch (e) {} if (!ROADL.length) ROADL = [[-170, 32.7], [-13, 47], [127, 37]]; ROADL.sort((a, b) => a[0] - b[0]); }
    for (let i = 0; i < ROADL.length - 1; i++) { const a = ROADL[i], b = ROADL[i + 1]; if (u >= a[0] && u <= b[0]) return a[1] + (b[1] - a[1]) * (u - a[0]) / Math.max(1e-6, b[0] - a[0]); } return u < ROADL[0][0] ? ROADL[0][1] : ROADL[ROADL.length - 1][1]; }
  // the footprint we keep (polygon, local): the corridor between the wash trail and the road, clear of the geoglyph and the star benches
  const FOOT = [[-50, -37.6], [27.5, -37.6], [28.6, -16], [33.5, -2], [41, 8.5], [44.5, 13], [44.5, 35.5], [-44.5, 35.5], [-46.5, 12.5], [-40, 8.2], [-36.2, 2], [-35.2, -8], [-36.4, -16], [-39.6, -22.5], [-46, -27.5], [-50, -30]];
  const FOOT_LOT = [[-30.2, 53.8], [-4, 53.8], [-4, 70.6], [-30.2, 70.6]];
  function inPoly(poly, u, v) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > v) !== (b[1] > v) && u < (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  function inFoot(x, z, m) { const q = w2l(x, z); if (inPoly(FOOT, q[0], q[1]) || inPoly(FOOT_LOT, q[0], q[1])) return true; if (!m) return false; for (const [du, dv] of [[m, 0], [-m, 0], [0, m], [0, -m]]) if (inPoly(FOOT, q[0] + du, q[1] + dv) || inPoly(FOOT_LOT, q[0] + du, q[1] + dv)) return true; return false; }
  R.inFoot = inFoot;
  const VEG = /^(bush\d|mesquite|ocotillo|saguaro.*|paloverde|ironwood|desertwillow|barrel_cactus|prickly_pear|cholla|organ_pipe|agave_cluster|yucca_cluster|boulder|ph_(rock|boulder|shrub|succulent|stones|sandrocks|moonrock|quiver)_?\d*|e1_(canarypalm|datepalm|fanpalm2?|paloverde|mesquite|ironwood|desertwillow|agave|yucca|bush)\w*|canarypalm|datepalm|fanpalm2?|creek_rock)$/;
  function clearFoot() { let removed = 0; const keys = new Set();
    for (const k in PLACE) { if (!VEG.test(k)) continue; const Lk = PLACE[k], out = []; for (const e of Lk) { if (!e.ro && inFoot(e[0], e[2], 1.5)) { keys.add(Math.round(e[0] * 100) + ":" + Math.round(e[2] * 100)); removed++; } else out.push(e); } if (out.length !== Lk.length) { Lk.length = 0; Array.prototype.push.apply(Lk, out); } }
    if (keys.size) for (let j = COLLIDERS.length - 1; j >= 0; j--) { const c = COLLIDERS[j]; if (keys.has(Math.round(c[0] * 100) + ":" + Math.round(c[1] * 100))) COLLIDERS.splice(j, 1); }
    cnt("cleared", removed); return removed; }
  function putL(kind, u, v, a, sc) { if (!canPut(kind)) return null; const p = l2w(u, v); put(kind, p[0], p[1], yawL(a), sc); const Lk = PLACE[kind]; const e = Lk && Lk[Lk.length - 1]; if (e) e.ro = 1; cnt("put_" + kind); return e; }

  // ───────────────────────── terrain hook: keep-outs first, then the grading (lower terrace for the arena, a ramp up to the road) ─────────────────────────
  function terrainHook() {
    if (R.off || !window.PLAN) return; const t0 = nowMs();
    try { if (!R.kept) { R.kept = true; planKeepout(FOOT.map((q) => l2w(q[0], q[1]))); planKeepout(FOOT_LOT.map((q) => l2w(q[0], q[1]))); } } catch (e) { note("keepout", e); }
    try { clearFoot(); } catch (e) { note("clear", e); }
    try { if (typeof H !== "undefined" && H && T) grade(); } catch (e) { note("grade", e); }
    try { let Rr = 0; for (const k in PLACE) { for (const e of PLACE[k]) { if (!inFoot(e[0], e[2], 12)) continue; const g = getH(e[0], e[2]); if (Math.abs(g - e[1]) > 0.02 && Math.abs(g - e[1]) < 6) { e[1] = g; Rr++; } } } cnt("reseated", Rr); } catch (e) { note("reseat", e); }
    R.t.terrain = Math.round(nowMs() - t0); }
  function grade() {
    const cw = (T.xmax - T.xmin) / (T.cols - 1), ch = (T.zmax - T.zmin) / (T.rows - 1);
    const hAt = (u, v) => { const p = l2w(u, v); return getH(p[0], p[1]); };
    // the arena pad: the mean of the natural ground over the arena, a little under the road side
    let s = 0, n = 0; for (let u = L.arena.u0; u <= L.arena.u1; u += 4) for (let v = L.arena.v0; v <= L.arena.v1; v += 4) { s += hAt(u, v); n++; }
    const YA = s / Math.max(1, n);
    // the saloon floor and decks: level with the road shoulder in front of the saloon (walk in off Night Field Road), 1.1 to 1.9 m over the arena
    let sr = 0, nr = 0; for (let u = L.saloon.u0; u <= L.saloon.u1; u += 4) { const rv = roadV(u); sr += hAt(u, rv - 7.5) + 0.12; nr++; }
    const YS = clamp(sr / Math.max(1, nr), YA + 1.1, YA + 1.9);
    S.YA = +YA.toFixed(3); S.YS = +YS.toFixed(3); S.dS = +(YS - YA).toFixed(3);
    const edgeH = {}; const edgeAt = (u) => { const k = Math.round(u); if (edgeH[k] === undefined) edgeH[k] = hAt(k, roadV(k) - 7.2); return edgeH[k]; };
    const G = L.geo, ST = L.stars; let cells = 0;
    // the lot across the road: one level pad at its mean
    let sl = 0, nl = 0; for (let u = L.lot.u0; u <= L.lot.u1; u += 4) for (let v = L.lot.v0; v <= L.lot.v1; v += 4) { sl += hAt(u, v); nl++; } const YL = sl / Math.max(1, nl); S.YL = +YL.toFixed(3);
    const box = [[-62, -44], [56, -44], [56, 82], [-62, 82]].map((q) => l2w(q[0], q[1])); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; box.forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); });
    for (let r = Math.max(0, Math.floor((z0 - T.zmin) / ch)); r <= Math.min(T.rows - 1, Math.ceil((z1 - T.zmin) / ch)); r++) for (let c = Math.max(0, Math.floor((x0 - T.xmin) / cw)); c <= Math.min(T.cols - 1, Math.ceil((x1 - T.xmin) / cw)); c++) {
      const x = T.xmin + c * cw, z = T.zmin + r * ch, q = w2l(x, z), u = q[0], v = q[1], vi = r * T.cols + c, h0 = H[vi];
      let tgt = null, w = 0;
      const rv = roadV(u), edge = rv - 7.2;
      if (v < edge + 0.5) {
        const vFlat = lerp(9.6, 18.5, sstep(5, 9, u));
        if (v <= vFlat) tgt = YA; else { const k = sstep(vFlat, edge, v); tgt = lerp(YA, edgeAt(u), k); }
        w = 1;
        w *= sstep(-62, -50, u) * (1 - sstep(46, 56, u)) * sstep(-44, -38.5, v);
        const dg = Math.hypot(x - G[0], z - G[1]); w *= sstep(G[2] || L.geoR, (L.geoR) + 5, dg);
        const ds = Math.hypot(x - ST[0], z - ST[1]); w *= sstep(L.starsR, L.starsR + 6, ds);
      }
      // the lot (beyond the road: never under the road's far edge)
      if (u > L.lot.u0 - 8 && u < L.lot.u1 + 8 && v > rv + 6.6 && v < L.lot.v1 + 8) { const du = Math.max(L.lot.u0 - u, 0, u - L.lot.u1), dv = Math.max(L.lot.v0 - v, 0, v - L.lot.v1); const wl = (1 - sstep(0, 7, Math.hypot(du, dv))) * sstep(rv + 6.6, rv + 8.5, v); if (wl > w) { w = wl; tgt = YL; } }
      if (tgt === null || w <= 0.001) continue; H[vi] = h0 + (tgt - h0) * w; cells++; }
    cnt("graded", cells); }

  // ───────────────────────── world hook: the hub, the zone, info points, walks (R15 edging), engine placements ─────────────────────────
  function worldHook() {
    if (R.off || !window.PLAN) return; const t0 = nowMs();
    try { if (!R.kept) { R.kept = true; planKeepout(FOOT.map((q) => l2w(q[0], q[1]))); planKeepout(FOOT_LOT.map((q) => l2w(q[0], q[1]))); } } catch (e) { note("keepout", e); }
    try { for (let u = -44; u <= 40; u += 10) for (let v = -34; v <= 32; v += 10) { if (!inPoly(FOOT, u, v)) continue; const p = l2w(u, v); KEEPOUT.push([p[0], p[1], 7]); } for (let u = L.lot.u0 + 4; u <= L.lot.u1; u += 8) for (let v = L.lot.v0 + 4; v <= L.lot.v1; v += 8) { const p = l2w(u, v); KEEPOUT.push([p[0], p[1], 6]); } } catch (e) { note("keep circles", e); }
    try { clearFoot(); } catch (e) { note("clear", e); }
    try { const h = l2w(-11, roadV(-11) - 8.2); planAddHub(C("names.venue", "The Copper Chute"), h[0], h[1]); planNavCats(); } catch (e) { note("hub", e); }
    try { const poly = FOOT.map((q) => l2w(q[0], q[1])); const c = l2w(-4, 0); zoneRings.push({ name: C("names.venue", "The Copper Chute"), label: C("names.short", "The Copper Chute"), center: c, r: 58, k: C("names.kicker", "Saloon, steakhouse and rodeo arena"), poly, col: "#c8643a55", plan: "rodeo" }); } catch (e) { note("zone", e); }
    try { infoSpots(); } catch (e) { note("hotspots", e); }
    try { walks(); } catch (e) { note("walks", e); }
    try { plants(); } catch (e) { note("plants", e); }
    try { lotCarts(); } catch (e) { note("lot", e); }
    R.t.world = Math.round(nowMs() - t0); }
  function infoSpots() { const I = C("info", {}); const hs = (key, u, v, r, extra) => { const d = I[key]; if (!d) return null; const w = l2w(u, v); const h = Object.assign({ x: w[0], z: w[1], r, t: d.t, k: d.k, p: d.p, ro: key }, extra || {}); hotspots.push(h); (R.hs = R.hs || []).push(h); return h; };
    hs("venue", -11, 37.2, 3.5); hs("arena", -28.6, -6.5, 3.2); hs("chutes", 19.8, 11.0, 2.6); hs("stand", -3, -20.3, 2.8); hs("pens", 23.3, 30.6, 2.6); hs("remuda", 8.0, 31.0, 2.8); hs("smoker", -41.2, 24.6, 2.6); hs("deck", -12, 11.4, 2.6); hs("stage", 0.6, 24.5, 2.6); hs("bar", -20, 27.2, 2.2); hs("lot", -18, 56.0, 4.0); hs("booth", 17.2, 18.4, 2.2); }
  // DG walks joined to the path network (plan_paths dresses them: corten edging, the gravel band)
  function walks() { const dg = { mat: planMats().dg, lift: 0.14, tile: 3 }; const rib = (pts, w, id) => { try { const rec = planRibbon(pts.map((q) => l2w(q[0], q[1])), w, dg, id); if (rec) { rec.ro = true; cnt("walks"); } return rec; } catch (e) { note("ribbon " + id, e); return null; } };
    rib([[-31.5, -31.6], [19.5, -31.6]], 4.0, "ro_concourse");
    rib([[-24, -33.4], [-24, -39.3]], 2.4, "ro_trail_link");
    rib([[-31.5, -29.6], [-31.5, -6.5], [-27.6, -6.5]], 2.6, "ro_gate_walk");
    rib([[-38.2, 34.9], [-38.2, roadV(-38.2) - 5.3]], 3.0, "ro_terrace_walk"); }
  // the desert garden that ties the grounds to the walks: saguaros at the corners, agave and barrel cactus drifts along the edges
  function plants() { const Rn = rng(17171); const p1 = (k, u, v, sc) => putL(k, u, v, Rn() * TAU, sc);
    [[-48, -34, "saguaro", 1.05], [24.5, -35.5, "saguaro_mid", 1.0], [-47.5, 33, "saguaro", 0.95], [43, 34, "saguaro_young", 1.0], [-41.5, 36.2, "saguaro_mid", 0.9], [7.8, 37.0, "saguaro_young", 0.9], [-2, -36.6, "saguaro_young", 0.85]].forEach((q) => p1(q[2], q[0], q[1], q[3]));
    const low = ["agave_cluster", "barrel_cactus", "yucca_cluster", "prickly_pear"].filter(canPut);
    for (let i = 0; i < 22; i++) { const u = lerp(-44, 22, i / 21) + (Rn() - 0.5) * 2; p1(low[i % low.length], u, -36.4 + (Rn() - 0.5) * 0.8, 0.7 + Rn() * 0.4); }
    for (let i = 0; i < 9; i++) { const u = lerp(-29.4, 5.4, i / 8); if (Math.abs(u + 11) < 2.5) continue; p1(low[(i + 1) % low.length], u, 37.1 + Rn() * 0.4, 0.6 + Rn() * 0.3); }
    for (let i = 0; i < 6; i++) p1(low[i % low.length], -45.6 - Rn() * 1.5, lerp(14, 32, i / 5), 0.7 + Rn() * 0.4);
    for (let i = 0; i < 10; i++) { const t = i / 9; p1(low[(i + 2) % low.length], lerp(L.lot.u0 - 1.4, L.lot.u1 + 1.4, i % 2 ? 1 : 0), lerp(L.lot.v0 + 1, L.lot.v1 - 1, t), 0.7 + Rn() * 0.3); } }
  // golf carts in the lot (nose in, two rows), a couple of pickups at the far end
  function lotCarts() { const Lt = L.lot, Rn = rng(4242); let n = 0;
    for (let row = 0; row < 2; row++) for (let i = 0; i < 8; i++) { if (Rn() < 0.22) continue; const u = Lt.u0 + 2.0 + i * 2.35, v = row ? Lt.v1 - 2.6 : Lt.v0 + 3.8; const e = putL("cart", u, v, row ? PI : 0, 1); if (e) n++; }
    const car = ["sp_car_pickup", "pickup", "car_pickup"].find((k) => canPut(k)); if (car) { putL(car, Lt.u1 - 2.4, Lt.v0 + 4.2, PI / 2, 1); putL(car, Lt.u1 - 2.4, Lt.v0 + 9.4, PI / 2, 1); }
    cnt("lotCarts", n); }

  // ───────────────────────── the arena: dirt, the pipe fence, chutes, alleys, pens, the grandstand, the booth, light towers, the arch ─────────────────────────
  const gy = (u, v) => { const p = l2w(u, v); return getH(p[0], p[1]) - S.YA; };   // the ground under a local point (after grading)
  const RED = 0x7a2b21, RED2 = 0x8c3324, CREAM = 0xd9cdb4, DARK = 0x2b2a28, GALV = 0xa3a49e, RUST = 0x8a5236, WOOD = 0xc9b8a0, WOODD = 0x8a7660;
  const EX = R.ex = R.ex || { anim: {} };
  // a run of pipe panels between points (local [u, v]); posts every step; rails at heights hs; ground-following
  function pipeRun(K, pts, hs, opt) { opt = opt || {}; const step = opt.step || 2.4, col = opt.col || RED, pr = opt.post || 0.055, rr = opt.rail || 0.034, top = hs[hs.length - 1] + 0.08;
    const P = []; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], Ls = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(Ls / step)); for (let k = 0; k < n; k++) P.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } P.push(pts[pts.length - 1].slice());
    const G0 = P.map((p) => (opt.flat ? 0 : gy(p[0], p[1])));
    P.forEach((p, i) => { K.cyl("steel", col, pr, pr, top + 0.12, p[0], G0[i] + (top + 0.12) / 2 - 0.06, p[1], 8); K.cyl("steel", col, pr * 1.25, pr * 1.25, 0.04, p[0], G0[i] + top + 0.06, p[1], 8); });
    for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1]; hs.forEach((h, j) => K.tube("steel", j === hs.length - 1 && opt.topCol ? opt.topCol : col, [a[0], G0[i] + h, a[1]], [b[0], G0[i + 1] + h, b[1]], rr, 6));
      if (opt.kick) K.beam("wood", WOODD, [a[0], G0[i] + 0.2, a[1]], [b[0], G0[i + 1] + 0.2, b[1]], 0.05, 0.3, 1.2);
      if (opt.solid !== false) { const mu = (a[0] + b[0]) / 2, mv = (a[1] + b[1]) / 2, Ls = Math.hypot(b[0] - a[0], b[1] - a[1]); solidL(mu, mv, -Math.atan2(b[1] - a[1], b[0] - a[0]), Ls + 0.1, 0.26, (G0[i] + G0[i + 1]) / 2 - 0.2, (G0[i] + G0[i + 1]) / 2 + top, "rodeo", { noStep: true }); } }
    return P; }
  // a pipe gate leaf (its own little mesh so it can swing): width w along +x from the hinge, rails, verticals, a diagonal brace
  function gateLeaf(w, h, col) { const K = new Kit(); const M = mats(); K.cyl("steel", col, 0.05, 0.05, h, 0, h / 2, 0, 8); K.cyl("steel", col, 0.045, 0.045, h, w, h / 2, 0, 8);
    [0.25, 0.65, 1.05, 1.45, h - 0.06].forEach((y) => { if (y < h + 0.01) K.tube("steel", col, [0, y, 0], [w, y, 0], 0.033, 6); }); for (let x = w / 3; x < w - 0.1; x += w / 3) K.tube("steel", col, [x, 0.25, 0], [x, h - 0.06, 0], 0.022, 6); K.tube("steel", col, [0.05, 0.3, 0], [w - 0.05, h - 0.1, 0], 0.025, 6);
    const g = new THREE.Group(); g.userData.noBatch = true; K.build(g, { steel: M.steel }, { tag: "gate" }).forEach((m) => { m.userData.anim = true; }); return g; }
  function buildArena() {
    const M = mats(), G = zoneGroup("arena"), K = new Kit(), A = L.arena; EX.arena = G; const t0 = nowMs();
    // ── the dirt: a gridded rounded rectangle, a berm of loose dirt at the fence, churned in front of the chutes, damp patches ──
    { const cu = (A.u0 + A.u1) / 2, cv = (A.v0 + A.v1) / 2, hu = (A.u1 - A.u0) / 2 - 0.12, hv = (A.v1 - A.v0) / 2 - 0.12, rr = A.r - 0.12, nu = 72, nv = 40;
      const pos = [], uv = [], col = [], idx = []; const N1 = rng(901);
      const noise = (u, v) => 0.5 + 0.5 * Math.sin(u * 0.31 + Math.sin(v * 0.23) * 1.7) * Math.cos(v * 0.27 - u * 0.11);
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { let u = cu - hu + 2 * hu * i / nu, v = cv - hv + 2 * hv * j / nv; const ix = hu - rr, iz = hv - rr, dx = u - cu, dz = v - cv;
        if (Math.abs(dx) > ix && Math.abs(dz) > iz) { const ccx = cu + Math.sign(dx) * ix, ccz = cv + Math.sign(dz) * iz, ox = u - ccx, oz = v - ccz, L0 = Math.hypot(ox, oz); if (L0 > rr) { u = ccx + ox / L0 * rr; v = ccz + oz / L0 * rr; } }
        const sd = arenaSD(u, v, 0.12); const edge = sstep(-1.8, 0, sd);
        const hump = 0.035 * noise(u * 1.7, v * 1.9) + 0.02 * N1(); const churn = (u > 8 && u < 21 && v > -4 && v < 6.4) ? 0.05 * Math.sin(u * 3.1) * Math.cos(v * 2.7) : 0;
        const y = 0.03 + hump + churn + 0.1 * edge;
        pos.push(u, y, v); uv.push(u / 4.6, -v / 4.6);
        let k = 0.92 + 0.14 * noise(u * 0.45 + 3, v * 0.5 - 1); k *= 1 - 0.16 * edge; if (u > 8 && u < 21 && v > -2 && v < 6.6) k *= 0.88; if (Math.hypot(u - 13, v + 4) < 5) k *= 0.92; col.push(k, k * 0.98, k * 0.95); }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere(); g.userData.avShared = true;
      const me = new THREE.Mesh(g, M.dirt); me.name = "ro arena dirt"; me.receiveShadow = true; me.castShadow = false; me.userData.noSolid = true; G.add(me); EX.dirt = me; }
    // ── the fence: pipe panels round the rounded rectangle, a kickboard at the foot; gaps for the entry gate, the out gate and the chutes ──
    { const loop = arenaLoop(2.4); const gap = (p) => (Math.abs(p[0] - L.gateSW.u) < 0.4 && p[1] > L.gateSW.v0 - 0.1 && p[1] < L.gateSW.v1 + 0.1) || (Math.abs(p[0] - L.gateOut.u) < 0.4 && p[1] > L.gateOut.v0 - 0.1 && p[1] < L.gateOut.v1 + 0.1) || (Math.abs(p[1] - A.v1) < 0.4 && p[0] > L.chutes.u0 - 0.2 && p[0] < L.chutes.u0 + L.chutes.n * L.chutes.w + 0.2);
      // split the loop into runs that skip the gaps; the gate posts land exactly on the openings
      const runs = []; let cur = []; for (let i = 0; i < loop.length; i++) { const p = loop[i]; if (gap(p)) { if (cur.length > 1) runs.push(cur); cur = []; } else cur.push(p); } if (cur.length) { if (runs.length && !gap(loop[0])) runs[0] = cur.concat(runs[0]); else runs.push(cur); }
      const snap = (r) => { const f = r[0], l = r[r.length - 1]; const fix = (p) => { if (Math.abs(p[0] - L.gateSW.u) < 1.6 && p[1] > L.gateSW.v0 - 1.6 && p[1] < L.gateSW.v1 + 1.6) return [L.gateSW.u, p[1] < (L.gateSW.v0 + L.gateSW.v1) / 2 ? L.gateSW.v0 : L.gateSW.v1]; if (Math.abs(p[0] - L.gateOut.u) < 1.6 && p[1] > L.gateOut.v0 - 1.6 && p[1] < L.gateOut.v1 + 1.6) return [L.gateOut.u, p[1] < (L.gateOut.v0 + L.gateOut.v1) / 2 ? L.gateOut.v0 : L.gateOut.v1]; if (Math.abs(p[1] - A.v1) < 1.6 && p[0] > L.chutes.u0 - 2 && p[0] < L.chutes.u0 + L.chutes.n * L.chutes.w + 2) return [p[0] < L.chutes.u0 + 3 ? L.chutes.u0 : L.chutes.u0 + L.chutes.n * L.chutes.w, A.v1]; return p; }; r[0] = fix(f); r[r.length - 1] = fix(l); return r; };
      runs.forEach((r) => { if (r.length < 2) return; pipeRun(K, snap(r), [0.36, 0.74, 1.12, 1.5, 1.88], { flat: true, kick: true, step: 2.6, topCol: RED2 }); });
      EX.fenceRuns = runs.length; }
    // ── the entry gate (south-west end, two leaves standing open) and the out gate (swings open after a ride) ──
    { const gw = (L.gateSW.v1 - L.gateSW.v0) / 2; [[L.gateSW.v0, 1], [L.gateSW.v1, -1]].forEach(([v, s]) => { const lf = gateLeaf(gw - 0.06, 1.9, RED); lf.position.set(L.gateSW.u, 0.06, v); lf.rotation.y = s > 0 ? -PI / 2 - 1.75 : PI / 2 + 1.75; G.add(lf); });
      const og = gateLeaf(L.gateOut.v1 - L.gateOut.v0 - 0.08, 1.9, RED); og.position.set(L.gateOut.u, 0.06, L.gateOut.v0); og.rotation.y = -PI / 2; G.add(og); EX.anim.outGate = og; solidL(L.gateOut.u, (L.gateOut.v0 + L.gateOut.v1) / 2, PI / 2, L.gateOut.v1 - L.gateOut.v0, 0.25, 0, 1.95, "rodeo", { noStep: true }); }
    // ── the bucking chutes: four bays of pipe and plate, numbered, swinging front gates, a catwalk behind ──
    { const C0 = L.chutes, v0 = C0.v0, v1 = C0.v1, top = 2.25; EX.chuteGates = [];
      for (let i = 0; i <= C0.n; i++) { const u = C0.u0 + i * C0.w; [v0, v1].forEach((v) => K.cyl("steel", RED, 0.07, 0.07, top + 0.1, u, (top + 0.1) / 2, v, 8)); [0.45, 0.95, 1.45, 1.95, top].forEach((y) => K.tube("steel", RED, [u, y, v0], [u, y, v1], 0.035, 6)); K.box("steel", 0x5a221b, 0.04, 1.2, v1 - v0 - 0.14, u, 0.72, (v0 + v1) / 2, 0, 1); solidL(u, (v0 + v1) / 2, 0, 0.2, v1 - v0, 0, top, "rodeo", { noStep: true }); }
      for (let i = 0; i < C0.n; i++) { const u0 = C0.u0 + i * C0.w; [0.5, 1.0, 1.5, 2.0].forEach((y) => K.tube("steel", RED, [u0, y, v1], [u0 + C0.w, y, v1], 0.03, 6)); solidL(u0 + C0.w / 2, v1, 0, C0.w, 0.2, 0, 2.1, "rodeo", { noStep: true });
        const lf = gateLeaf(C0.w - 0.16, 2.1, RED2); lf.position.set(u0 + C0.w - 0.08, 0.06, v0); lf.rotation.y = PI; G.add(lf); EX.chuteGates.push(lf); solidL(u0 + C0.w / 2, v0, 0, C0.w, 0.2, 0, 2.1, "rodeo", { noStep: true }); }
      // the header beam with the chute numbers (neon atlas n1..n4)
      K.box("steel", DARK, C0.n * C0.w + 0.3, 0.22, 0.22, C0.u0 + C0.n * C0.w / 2, top + 0.32, v0, 0, 1);
      for (let i = 0; i < C0.n; i++) { const r = NEON.r["n" + (i + 1)]; if (r) K.plane("neon", 0xffffff, 0.56, 0.56, C0.u0 + (i + 0.5) * C0.w, top + 0.78, v0 - 0.02, PI, 0, r); K.box("wood", WOODD, 0.64, 0.64, 0.05, C0.u0 + (i + 0.5) * C0.w, top + 0.78, v0 + 0.02, 0, 0.64); }
      // the catwalk (plank deck on posts, back rail, steps down at the north-east end)
      const W = L.catwalk; K.box("wood", WOOD, W.u1 - W.u0, 0.08, W.v1 - W.v0, (W.u0 + W.u1) / 2, W.y - 0.04, (W.v0 + W.v1) / 2, 0, 1.6); for (let u = W.u0 + 0.1; u <= W.u1; u += 2) [W.v0 + 0.08, W.v1 - 0.08].forEach((v) => K.box("wood", WOODD, 0.14, W.y, 0.14, u, W.y / 2, v, 0, 1));
      K.tube("steel", DARK, [W.u0, W.y + 1.0, W.v1 - 0.05], [W.u1, W.y + 1.0, W.v1 - 0.05], 0.03, 6); for (let u = W.u0; u <= W.u1 + 0.01; u += 1.6) K.tube("steel", DARK, [u, W.y, W.v1 - 0.05], [u, W.y + 1.0, W.v1 - 0.05], 0.025, 6);
      solidL((W.u0 + W.u1) / 2, (W.v0 + W.v1) / 2, 0, W.u1 - W.u0, W.v1 - W.v0, W.y - 0.12, W.y, "rodeo"); solidL((W.u0 + W.u1) / 2, W.v1 - 0.05, 0, W.u1 - W.u0, 0.1, W.y, W.y + 1.0, "rodeo", { noStep: true });
      for (let s = 0; s < 4; s++) { const u = W.u1 + 0.3 + s * 0.3, y = W.y - (s + 1) * W.y / 5; K.box("wood", WOOD, 0.3, 0.06, W.v1 - W.v0, u, y, (W.v0 + W.v1) / 2, 0, 1); solidL(u, (W.v0 + W.v1) / 2, 0, 0.3, W.v1 - W.v0, y - 0.15, y + 0.03, "rodeo"); } }
    // ── the lead-up alley (pens to chutes) and the return alley (out gate to the pens) ──
    pipeRun(K, [[L.lead.u0, L.lead.v1], [L.lead.u1, L.lead.v1]], [0.5, 1.0, 1.55], { col: GALV, step: 2.4 });
    pipeRun(K, [[L.lead.u0, L.lead.v0 + 0.05], [L.lead.u0, L.lead.v1]], [0.5, 1.0, 1.55], { col: GALV });
    pipeRun(K, [[L.alley.u1, L.alley.v0], [L.alley.u1, L.lead.v0]], [0.5, 1.0, 1.55, 1.9], { col: GALV });
    pipeRun(K, [[L.alley.u0, L.alley.v0], [L.alley.u1, L.alley.v0]], [0.5, 1.0, 1.55], { col: GALV });
    pipeRun(K, [[L.alley.u0, A.v1 - A.r + 0.3], [L.alley.u0, L.lead.v0]], [0.5, 1.0, 1.55], { col: GALV });
    pipeRun(K, [[L.alley.u0, L.lead.v1], [L.alley.u0, L.alley.v1]], [0.5, 1.0, 1.55], { col: GALV });
    // ── the stock pens: four pens on the slope, gates to the alley, troughs and hay feeders ──
    { const P0 = L.pens; const hs = [0.45, 0.9, 1.35, 1.75];
      pipeRun(K, [[P0.u0, L.lead.v1], [P0.u0, P0.v1]], hs, { col: GALV }); pipeRun(K, [[P0.u1, P0.v0], [P0.u1, P0.v1]], hs, { col: GALV });
      pipeRun(K, [[L.alley.u1, P0.v0], [P0.u1, P0.v0]], hs, { col: GALV }); pipeRun(K, [[L.alley.u0, P0.v1], [P0.u1, P0.v1]], hs, { col: GALV });
      pipeRun(K, [[P0.um, P0.v0], [P0.um, P0.v1]], hs, { col: GALV }); pipeRun(K, [[P0.u0, P0.vm], [P0.u1, P0.vm]], hs, { col: GALV });
      EX.pens = [[P0.u0, P0.v0, P0.um, P0.vm, "bull"], [P0.um, P0.v0, P0.u1, P0.vm, "bull"], [P0.u0, P0.vm, P0.um, P0.v1, "horse"], [P0.um, P0.vm, P0.u1, P0.v1, "horse"]];
      EX.pens.forEach((p, i) => { const tu = p[2] - 1.6, tv = p[1] + 1.4 + (i % 2) * 0.4, g0 = gy(tu, tv); K.cyl("steel", GALV, 0.8, 0.8, 0.62, tu, g0 + 0.31, tv, 18, false, 0, 0, 0); K.cyl("glass", 0xffffff, 0.74, 0.74, 0.02, tu, g0 + 0.55, tv, 18);
        const fu = p[0] + 2.2, fv = p[3] - 1.6, g1 = gy(fu, fv); K.box("steel", GALV, 1.6, 0.06, 0.9, fu, g1 + 1.05, fv, 0, 1); for (let k = 0; k < 6; k++) K.tube("steel", GALV, [fu - 0.75 + k * 0.3, g1 + 0.35, fv - 0.42], [fu - 0.75 + k * 0.3, g1 + 1.05, fv + 0.42], 0.015, 5); K.box("wood", 0xd8c48a, 1.4, 0.45, 0.75, fu, g1 + 1.32, fv, 0.05, 0.5);
        solidL(tu, tv, 0, 1.6, 1.6, g0, g0 + 0.62, "rodeo", { noStep: true }); solidL(fu, fv, 0, 1.6, 0.9, g1, g1 + 1.4, "rodeo", { noStep: true }); }); }
    // ── the remuda: a timber post-and-rail corral beside the pens with a loafing shed (horses from the Frontier Ranch) ──
    { const Rm = L.remuda; const rail = (a, b) => { const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2.6)); for (let k = 0; k <= n; k++) { const u = a[0] + (b[0] - a[0]) * k / n, v = a[1] + (b[1] - a[1]) * k / n, g0 = gy(u, v); K.box("wood", WOODD, 0.16, 1.6, 0.16, u, g0 + 0.8, v, 0, 1); }
        for (let k = 0; k < n; k++) { const u0 = a[0] + (b[0] - a[0]) * k / n, v0 = a[1] + (b[1] - a[1]) * k / n, u1 = a[0] + (b[0] - a[0]) * (k + 1) / n, v1 = a[1] + (b[1] - a[1]) * (k + 1) / n, g0 = gy(u0, v0), g1 = gy(u1, v1); [0.5, 0.95, 1.4].forEach((h) => K.beam("wood", WOOD, [u0, g0 + h, v0], [u1, g1 + h, v1], 0.06, 0.14, 1.4)); solidL((u0 + u1) / 2, (v0 + v1) / 2, -Math.atan2(v1 - v0, u1 - u0), Math.hypot(u1 - u0, v1 - v0) + 0.1, 0.22, (g0 + g1) / 2 - 0.2, (g0 + g1) / 2 + 1.5, "rodeo", { noStep: true }); } };
      rail([Rm.u0, Rm.v0], [Rm.u1 - 0.2, Rm.v0]); rail([Rm.u0, Rm.v0], [Rm.u0, Rm.v1 - 6.0]); rail([Rm.u0, Rm.v1 - 3.4], [Rm.u0, Rm.v1]); rail([Rm.u0, Rm.v1], [Rm.u1 - 0.2, Rm.v1]);
      // the loafing shed along the south-east side
      const su0 = Rm.u0 + 3.5, su1 = Rm.u1 - 1, sv0 = Rm.v1 - 4.2, sv1 = Rm.v1 - 0.25, sg = gy((su0 + su1) / 2, (sv0 + sv1) / 2);
      for (let u = su0; u <= su1 + 0.01; u += (su1 - su0) / 3) { K.box("wood", WOODD, 0.2, 3.0, 0.2, u, sg + 1.5, sv0 + 0.1, 0, 1); K.box("wood", WOODD, 0.2, 2.6, 0.2, u, sg + 1.3, sv1 - 0.1, 0, 1); }
      K.box("wood", WOOD, su1 - su0 + 0.2, 2.5, 0.08, (su0 + su1) / 2, sg + 1.25, sv1, 0, 1.4); K.box("wood", WOOD, 0.08, 2.5, sv1 - sv0, su0, sg + 1.25, (sv0 + sv1) / 2, 0, 1.4);
      K.box("corr", RUST, su1 - su0 + 1.2, 0.06, sv1 - sv0 + 1.2, (su0 + su1) / 2, sg + 3.0, (sv0 + sv1) / 2, 0, 1.8, 0.1);
      solidL((su0 + su1) / 2, sv1, 0, su1 - su0, 0.2, sg, sg + 2.6, "rodeo", { noStep: true }); solidL(su0, (sv0 + sv1) / 2, 0, 0.2, sv1 - sv0, sg, sg + 2.6, "rodeo", { noStep: true });
      for (let k = 0; k < 4; k++) K.box("wood", 0xd8c48a, 1.1, 0.45, 0.55, su0 + 0.9 + (k % 2) * 1.2, sg + 0.23 + (k >> 1) * 0.46, sv1 - 0.6, 0.1 * k, 0.5);
      const tu = Rm.u0 + 2.2, tv = Rm.v0 + 2.0, tg = gy(tu, tv); K.box("wood", WOODD, 2.4, 0.55, 0.7, tu, tg + 0.28, tv, 0, 1); K.box("glass", 0xffffff, 2.2, 0.02, 0.5, tu, tg + 0.5, tv, 0, 1); solidL(tu, tv, 0, 2.4, 0.7, tg, tg + 0.56, "rodeo", { noStep: true });
      EX.remuda = [Rm.u0 + 1.2, Rm.v0 + 1.2, Rm.u1 - 1.4, Rm.v1 - 5.0]; }
    R.t.arenaA = Math.round(nowMs() - t0);
    // ── the grandstand: seven rows of plank seats on a steel frame under a corrugated roof, slatted end screens, a back wall ──
    { const Sd = L.stand, u0 = Sd.u0, u1 = Sd.u1, len = u1 - u0;
      for (let i = 0; i < Sd.rows; i++) { const vf = Sd.v0 - Sd.dep * i, yf = Sd.rise * i + 0.03, ys = 0.45 + Sd.rise * i, vs = vf - Sd.dep + 0.2;
        K.box("wood", WOOD, len, 0.06, 0.42, (u0 + u1) / 2, yf, vf - 0.21, 0, 1.4); K.box("wood", 0xb9a68c, len, 0.06, 0.36, (u0 + u1) / 2, ys - 0.03, vs, 0, 1.4); K.box("wood", WOODD, len, 0.36, 0.04, (u0 + u1) / 2, ys - 0.24, vs + 0.2, 0, 1.4);
        solidL((u0 + u1) / 2, vf - 0.21, 0, len, 0.42, yf - 0.16, yf, "rodeo");
        for (let u = u0 + 0.5; u < u1 - 0.3; u += 1.0) seatL(u, vs, 0, 0.96, 0.36, ys, 0, 1);
      }
      // the frame: stringers every 3.2 m, posts to the ground
      for (let u = u0 + 0.2; u <= u1; u += (len - 0.4) / 12) { const vb = Sd.v0 - Sd.dep * Sd.rows; K.beam("steel", DARK, [u, 0.0, Sd.v0 + 0.05], [u, Sd.rise * (Sd.rows - 1) + 0.4, vb + 0.4], 0.09, 0.18); for (let i = 1; i < Sd.rows; i += 2) { const vv = Sd.v0 - Sd.dep * i - 0.4, yy = Sd.rise * i; K.box("steel", DARK, 0.09, yy, 0.09, u, yy / 2, vv, 0, 1); } }
      // top walk and the back wall
      const yTop = 0.45 + Sd.rise * (Sd.rows - 1), vTop = Sd.v0 - Sd.dep * Sd.rows; K.box("wood", WOOD, len, 0.06, 0.8, (u0 + u1) / 2, yTop - 0.02, vTop - 0.1, 0, 1.4); solidL((u0 + u1) / 2, vTop - 0.1, 0, len, 0.8, yTop - 0.2, yTop, "rodeo");
      K.box("corr", GALV, len + 0.3, 3.4, 0.06, (u0 + u1) / 2, 1.7, Sd.back + 0.05, 0, 1.6); K.tube("steel", DARK, [u0, yTop + 1.05, Sd.back + 0.12], [u1, yTop + 1.05, Sd.back + 0.12], 0.035, 6); solidL((u0 + u1) / 2, Sd.back + 0.05, 0, len + 0.3, 0.2, 0, yTop + 1.1, "rodeo", { noStep: true });
      // the front rail with openings at both ends
      K.tube("steel", RED, [u0 + 1.2, 1.0, Sd.v0 + 0.12], [u1 - 1.2, 1.0, Sd.v0 + 0.12], 0.035, 6); for (let u = u0 + 1.2; u <= u1 - 1.19; u += 3.2) K.tube("steel", RED, [u, 0, Sd.v0 + 0.12], [u, 1.0, Sd.v0 + 0.12], 0.035, 6); solidL((u0 + u1) / 2, Sd.v0 + 0.12, 0, len - 2.4, 0.12, 0, 1.0, "rodeo", { noStep: true });
      // the roof: columns along the back, cantilevered rafters rising toward the arena, galvanized sheets, a fascia
      const rf = 6.9, rb = 6.1, vF = Sd.v0 + 0.8; for (let u = u0; u <= u1 + 0.01; u += len / 6) { K.box("steel", DARK, 0.3, rb, 0.3, u, rb / 2, Sd.back - 0.2, 0, 1); K.beam("steel", DARK, [u, rb, Sd.back - 0.5], [u, rf, vF], 0.18, 0.38); K.beam("steel", DARK, [u, 3.4, Sd.back - 0.2], [u, rb - 0.1, Sd.back + 2.6], 0.1, 0.16); solidL(u, Sd.back - 0.2, 0, 0.32, 0.32, 0, rb, "rodeo", { noStep: true }); }
      for (let k = 0; k <= 4; k++) { const t = k / 4, v = lerp(Sd.back - 0.5, vF, t), y = lerp(rb, rf, t) + 0.2; K.box("steel", DARK, len + 0.8, 0.12, 0.1, (u0 + u1) / 2, y, v, 0, 1); }
      { const ang = Math.atan2(rf - rb, vF - (Sd.back - 0.5)), Lr = Math.hypot(rf - rb, vF - (Sd.back - 0.5)) + 0.9; K.box("corr", GALV, len + 1.2, 0.05, Lr, (u0 + u1) / 2, (rf + rb) / 2 + 0.32, (vF + Sd.back - 0.5) / 2 + 0.2, 0, 1.6, -ang); }
      K.box("wood", 0x5c4636, len + 1.2, 0.9, 0.08, (u0 + u1) / 2, rf - 0.1, vF + 0.18, 0, 1.2);
      { const r = NEON.r.arena; if (r) { K.box("wood", DARK, 4.6, 1.05, 0.06, (u0 + u1) / 2, rf - 0.12, vF + 0.25, 0, 1); K.plane("neon", 0xffffff, 4.4, 1.0, (u0 + u1) / 2, rf - 0.12, vF + 0.29, 0, 0, r); } }
      // slatted end screens (the low afternoon sun from the south-west, the wind)
      [u0 - 0.2, u1 + 0.2].forEach((u) => { for (let y = 0.5; y < rb - 0.4; y += 0.34) { const vb2 = lerp(Sd.v0 - 0.5, Sd.back, sstep(0, rb, y + 1.5)); K.box("wood", WOODD, 0.06, 0.2, Math.abs(Sd.back - vb2) + 0.1, u, y + 0.3, (Sd.back + vb2) / 2, 0, 1.2); } K.box("steel", DARK, 0.14, rb, 0.14, u, rb / 2, Sd.v0 - 0.6, 0, 1); });
      solidL(u0 - 0.2, (Sd.back + Sd.v0 - 1.4) / 2, 0, 0.25, Math.abs(Sd.back - Sd.v0) - 1.2, 0, 3.5, "rodeo", { noStep: true }); solidL(u1 + 0.2, (Sd.back + Sd.v0 - 1.4) / 2, 0, 0.25, Math.abs(Sd.back - Sd.v0) - 1.2, 0, 3.5, "rodeo", { noStep: true });
      // under-roof floodlights (lit at night)
      for (let u = u0 + 3; u < u1 - 2; u += 6.3) { K.box("steel", DARK, 0.5, 0.18, 0.3, u, rf - 0.55, vF - 1.0, 0, 1); K.plane("lamp", 0xffffff, 0.42, 0.24, u, rf - 0.65, vF - 0.98, 0, PI / 2 + 0.5); } }
    // ── the announcer's stand over the chutes and the scoreboard on its roof ──
    { const B = L.booth, bu = (B.u0 + B.u1) / 2, bv = (B.v0 + B.v1) / 2, w = B.u1 - B.u0, d = B.v1 - B.v0;
      [[B.u0, B.v0], [B.u1, B.v0], [B.u0, B.v1], [B.u1, B.v1]].forEach(([u, v]) => { K.box("wood", WOODD, 0.24, B.y, 0.24, u, B.y / 2, v, 0, 1); solidL(u, v, 0, 0.26, 0.26, 0, B.y, "rodeo", { noStep: true }); });
      K.box("wood", WOOD, w + 0.3, 0.2, d + 0.3, bu, B.y - 0.1, bv, 0, 1.5); solidL(bu, bv, 0, w + 0.3, d + 0.3, B.y - 0.25, B.y, "rodeo");
      K.box("wood", WOOD, w, 1.0, 0.1, bu, B.y + 0.5, B.v0, 0, 1.4); K.box("wood", WOOD, 0.1, 1.0, d, B.u0, B.y + 0.5, bv, 0, 1.4); K.box("wood", WOOD, w, 2.6, 0.1, bu, B.y + 1.3, B.v1, 0, 1.4); K.box("wood", WOOD, 0.1, 2.6, d - 1.1, B.u1, B.y + 1.3, bv - 0.55, 0, 1.4);
      K.box("glass", 0xffffff, w - 0.2, 1.3, 0.03, bu, B.y + 1.7, B.v0 + 0.02, 0, 1); K.box("glass", 0xffffff, 0.03, 1.3, d - 0.2, B.u0 + 0.02, B.y + 1.7, bv, 0, 1);
      K.plane("win", 0xffffff, w - 0.3, 1.2, bu, B.y + 1.7, B.v1 - 0.06, PI); K.box("wood", WOODD, w + 0.2, 0.12, 0.12, bu, B.y + 2.4, B.v0, 0, 1);
      K.box("corr", RUST, w + 1.4, 0.06, d + 1.6, bu, B.top - 0.15, bv, 0, 1.8, -0.06);
      solidL(bu, B.v0, 0, w, 0.12, B.y, B.y + 1.0, "rodeo", { noStep: true }); solidL(B.u0, bv, 0, 0.12, d, B.y, B.y + 1.0, "rodeo", { noStep: true }); solidL(bu, B.v1, 0, w, 0.12, B.y, B.y + 2.6, "rodeo", { noStep: true }); solidL(B.u1, bv - 0.55, 0, 0.12, d - 1.1, B.y, B.y + 2.6, "rodeo", { noStep: true });
      // the stair up the north-east side
      const n = 9; for (let s = 0; s < n; s++) { const u = B.u1 + 0.35 + (n - 1 - s) * 0.32, y = (s + 1) * B.y / n; K.box("wood", WOOD, 0.32, 0.06, 1.0, u, y - 0.03, B.v1 - 0.55, 0, 1); solidL(u, B.v1 - 0.55, 0, 0.32, 1.0, y - 0.2, y, "rodeo"); }
      K.tube("steel", DARK, [B.u1 + 0.3, B.y + 0.9, B.v1 - 0.04], [B.u1 + 0.35 + n * 0.32, 0.9, B.v1 - 0.04], 0.025, 6);
      // the scoreboard
      const sw = 5.4, sh = 2.2, sy = B.top + 0.25; K.box("steel", DARK, sw + 0.3, sh + 0.3, 0.3, bu, sy + sh / 2, B.v0 + 0.3, 0, 1); K.box("steel", DARK, 0.16, 0.6, 0.16, bu - sw / 3, sy - 0.2, B.v0 + 0.3, 0, 1); K.box("steel", DARK, 0.16, 0.6, 0.16, bu + sw / 3, sy - 0.2, B.v0 + 0.3, 0, 1);
      K.plane("board", 0xffffff, sw, sh, bu, sy + sh / 2, B.v0 + 0.13, PI);
      // the PA horns
      [[B.u0 + 0.4, B.v0 + 0.3], [B.u1 - 0.4, B.v0 + 0.3]].forEach(([u, v]) => { K.cyl("steel", GALV, 0.08, 0.32, 0.6, u, B.top + 0.25, v - 0.2, 10, true, 0, PI / 2 - 0.15); }); }
    // ── light towers: tapered steel poles, a head frame with eight floods aimed at the arena centre, a ladder ──
    { const ac = [(A.u0 + A.u1) / 2, (A.v0 + A.v1) / 2]; EX.heads = [];
      L.towers.forEach(([u, v], ti) => { const g0 = gy(u, v), H0 = 17.5; K.cyl("steel", GALV, 0.15, 0.24, H0, u, g0 + H0 / 2, v, 12); K.cyl("adobe", 0xb9ad9a, 0.5, 0.55, 0.5, u, g0 + 0.2, v, 12); solidL(u, v, 0, 0.6, 0.6, g0, g0 + H0, "rodeo", { noStep: true });
        const yaw = Math.atan2(ac[0] - u, ac[1] - v); const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = fz, rz = -fx;
        for (let row = 0; row < 2; row++) K.beam("steel", GALV, [u - rx * 1.7, g0 + H0 + row * 0.9, v - rz * 1.7], [u + rx * 1.7, g0 + H0 + row * 0.9, v + rz * 1.7], 0.1, 0.1);
        for (let k = 0; k < 8; k++) { const col = (k % 4) - 1.5, row = k >> 2; const hx = u + rx * col * 0.95 + fx * 0.35, hz = v + rz * col * 0.95 + fz * 0.35, hy = g0 + H0 + 0.35 + row * 0.9; const pitch = 0.62 + (row ? 0.08 : 0), cp = Math.cos(pitch), sp = Math.sin(pitch);
          K.box("steel", DARK, 0.62, 0.62, 0.3, hx, hy, hz, yaw, 1, pitch); K.place("lamp", new THREE.PlaneGeometry(0.52, 0.52), 0xffffff, hx + fx * cp * 0.16, hy - sp * 0.16, hz + fz * cp * 0.16, yaw, pitch); }
        for (let y = 1.0; y < H0 - 0.5; y += 0.42) K.tube("steel", GALV, [u - fx * 0.26 - rx * 0.18, g0 + y, v - fz * 0.26 - rz * 0.18], [u - fx * 0.26 + rx * 0.18, g0 + y, v - fz * 0.26 + rz * 0.18], 0.012, 4);
        EX.heads.push({ u: u + fx * 0.6, v: v + fz * 0.6, y: g0 + H0 + 0.8, yaw, ti }); }); }
    // ── the arena entry arch over the gate walk: timber posts, a dark board with the lettering, a longhorn skull ──
    { const au0 = L.gateSW.u - 4.3, av0 = L.gateSW.v0 - 0.5, av1 = L.gateSW.v1 + 0.5, h = 5.2; [av0, av1].forEach((v) => { K.box("wood", WOODD, 0.42, h, 0.42, au0, h / 2, v, 0, 1); K.box("adobe", 0xb9ad9a, 0.8, 0.5, 0.8, au0, 0.25, v, 0, 1); solidL(au0, v, 0, 0.6, 0.6, 0, h, "rodeo", { noStep: true }); });
      K.box("wood", WOODD, 0.36, 0.42, av1 - av0 + 1.2, au0, h - 0.3, (av0 + av1) / 2, 0, 1); const r = NEON.r.archtext; if (r) { K.box("wood", DARK, 0.1, 0.95, 5.8, au0, h + 0.4, (av0 + av1) / 2, 0, 1); K.plane("neon", 0xffffff, 5.6, 0.94, au0 - 0.06, h + 0.4, (av0 + av1) / 2, -PI / 2, 0, [r[0], r[1] + (r[3] - r[1]) * 0.18, r[2], r[3] - (r[3] - r[1]) * 0.18]); }
      K.plane("skull", 0xf4ecdc, 1.7, 0.93, au0 - 0.08, h + 1.25, (av0 + av1) / 2, -PI / 2); }
    // ── the banners on the fence facing the stands and the deck (canvas, no marks but GIVEBACK) ──
    { const bt = bannerTex(); MT.banner = MT.banner || bm(ext("vinyl banner", bt, null, TEX.woodR, { roughness: 0.75 })); const nB = BAN.list.length;
      const spots = [[-15, A.v0 + 0.12, 0], [-3, A.v0 + 0.12, 0], [9, A.v0 + 0.12, 0], [-18, A.v1 - 0.12, PI], [-6, A.v1 - 0.12, PI], [3.5, A.v1 - 0.12, PI]];
      spots.forEach(([u, v, a], i) => { const r = BAN.r[i % nB]; K.plane("banner", 0xffffff, 3.6, 0.9, u, 1.25, v + (a ? -0.06 : 0.06), a, 0, r); }); }
    // ── bunting along the grandstand fascia and over the deck walk ──
    { const Sd = L.stand; for (let k = 0; k < 8; k++) { const ua = lerp(Sd.u0, Sd.u1, k / 8), ub = lerp(Sd.u0, Sd.u1, (k + 1) / 8); bunt(K, [ua, 6.1, Sd.v0 + 0.9], [ub, 6.1, Sd.v0 + 0.9], 0.4); } }
    K.build(G, { steel: M.steel, wood: M.wood, corr: M.corr, adobe: M.adobe, glass: M.glass, neon: M.neon, lamp: M.lamp, win: M.win, board: M.board, skull: M.skull, banner: MT.banner, bunt: M.bunt, ground: M.ground }, { tag: "arena", noCast: ["neon", "lamp", "win", "board", "bunt"] });
    R.t.arena = Math.round(nowMs() - t0); return G; }
  // a sagging pennant string between two points (cut-out triangles)
  function bunt(K, A, B, sag) { const n = 6, L0 = Math.hypot(B[0] - A[0], B[2] - A[2]); for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n; const y0 = lerp(A[1], B[1], t0) - sag * Math.sin(t0 * PI), y1 = lerp(A[1], B[1], t1) - sag * Math.sin(t1 * PI); const a = [lerp(A[0], B[0], t0), y0, lerp(A[2], B[2], t0)], b = [lerp(A[0], B[0], t1), y1, lerp(A[2], B[2], t1)];
      const g = new THREE.BufferGeometry(); const u0 = t0 * L0 / 4, u1 = t1 * L0 / 4; g.setAttribute("position", new THREE.Float32BufferAttribute([a[0], a[1], a[2], b[0], b[1], b[2], a[0], a[1] - 0.42, a[2], b[0], b[1], b[2], b[0], b[1] - 0.42, b[2], a[0], a[1] - 0.42, a[2]], 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute([u0, 1, u1, 1, u0, 0, u1, 1, u1, 0, u0, 0], 2)); g.computeVertexNormals(); K.add("bunt", g, 0xffffff); }
    K.tube("steel", DARK, A, B, 0.006, 3); }
  // the fence banners: six vinyl banners drawn on one canvas (GIVEBACK is the only mark)
  const BAN = R.ban = R.ban || { r: [], list: [] };
  function bannerTex() { if (BAN.tex) return BAN.tex; const W = 1024, Hh = 768, rows = 6, bh = Hh / rows; BAN.list = C("banners", ["GIVEBACK", "THE COPPER CHUTE", "RODEO NIGHT EVERY EVENING", "THE HIGH DESERT", "BBQ ON THE TERRACE", "BUCKLE UP, COWBOYS"]);
    BAN.tex = canvasTex(W, Hh, (x) => { const pal = [["#1c3d2a", "#f5f1e6"], ["#7a2b21", "#f4e2b8"], ["#13283e", "#f4cd5a"], ["#e8dcc0", "#7a2b21"], ["#2a2420", "#ffb060"], ["#f1e3c4", "#13283e"]];
      BAN.list.forEach((t, i) => { const y0 = i * bh, [bg, fg] = pal[i % pal.length]; x.fillStyle = bg; x.fillRect(0, y0, W, bh); x.strokeStyle = fg; x.lineWidth = 6; x.strokeRect(10, y0 + 10, W - 20, bh - 20); for (const gx of [30, W - 30]) { x.fillStyle = "#c9c4b8"; x.beginPath(); x.arc(gx, y0 + 26, 7, 0, TAU); x.fill(); x.beginPath(); x.arc(gx, y0 + bh - 26, 7, 0, TAU); x.fill(); }
        x.fillStyle = fg; x.textAlign = "center"; x.textBaseline = "middle"; x.font = "800 " + Math.min(74, Math.floor(1700 / Math.max(8, t.length))) + "px " + FONT_S; if (t !== "GIVEBACK") x.fillText(t, W / 2, y0 + bh / 2 + 3); BAN.r.push([0, 1 - (y0 + bh) / Hh, 1, 1 - y0 / Hh]); });
      }, true);
    // the GIVEBACK logo (2:1, drawn by height) on the first banner
    try { const im = new Image(); im.onload = () => { try { const c = BAN.tex.userData.cv, x = c.getContext("2d"); const h = 96, w = h * 2; x.drawImage(im, W / 2 - w / 2, bh / 2 - h / 2, w, h); BAN.tex.needsUpdate = true; } catch (e) { note("banner logo", e); } }; im.src = au("/tex/ar_logo.png"); } catch (e) { note("banner logo", e); }
    return BAN.tex; }

  // ───────────────────────── the saloon and steakhouse: shell, false front, porch, interior, the patio deck, the BBQ terrace ─────────────────────────
  const SIDING = 0xb58660, OAK = 0x6b4630, OAKD = 0x3e2a1e, TRIM = 0x4a3526, BRASS = 0xc9a24a, LEATH = 0x7a2e22;
  // a wall along u at constant v (out: +1 when the outside is +v), with openings [u0, u1, y0, y1]; two skins (outside barnwood, inside the room family)
  function wallU(K, v, u0, u1, y0, y1, ops, out, opt) { opt = opt || {}; if (!opt.col) opt.col = SIDING; const T0 = 0.12, gap = 0.06, segs = []; ops = (ops || []).slice().sort((a, b) => a[0] - b[0]); let s = u0;
    for (const o of ops) { if (o[0] > s) segs.push([s, o[0], y0, y1]); if (o[2] > y0) segs.push([o[0], o[1], y0, o[2]]); if (o[3] < y1) segs.push([o[0], o[1], o[3], y1]); s = o[1]; } if (s < u1) segs.push([s, u1, y0, y1]);
    for (const q of segs) { const w = q[1] - q[0], h = q[3] - q[2], cu = (q[0] + q[1]) / 2, cy = (q[2] + q[3]) / 2; if (w < 0.01 || h < 0.01) continue;
      uvRot(K.box(opt.ext || "wood", opt.col || WOOD, w, h, T0, cu, cy, v + out * (gap / 2 + T0 / 2), 0, 3.0)); if (!opt.noInt) uvRot(K.box("iwood", opt.icol || 0x8e6440, w, h, T0, cu, cy, v - out * (gap / 2 + T0 / 2), 0, 3.0));
      if (!opt.noSolid && q[2] < S.dS + 1.9 && q[3] > S.dS + 0.3) solidL(cu, v, 0, w, T0 * 2 + gap, q[2], q[3], "rodeo", { noStep: true }); }
    for (const o of ops) { const w = o[1] - o[0], h = o[3] - o[2], cu = (o[0] + o[1]) / 2; [[o[0] - 0.07, o[2], o[0] - 0.07, o[3]], [o[1] + 0.07, o[2], o[1] + 0.07, o[3]]].forEach((f) => K.box("wood", TRIM, 0.14, h + 0.14, 0.34, f[0], (o[2] + o[3]) / 2, v, 0, 1)); K.box("wood", TRIM, w + 0.28, 0.16, 0.36, cu, o[3] + 0.08, v, 0, 1); if (o[2] > y0 + 0.05) K.box("wood", TRIM, w + 0.3, 0.08, 0.42, cu, o[2] - 0.02, v + out * 0.04, 0, 1); } }
  function wallV(K, u, v0, v1, y0, y1, ops, out, opt) { opt = opt || {}; if (!opt.col) opt.col = SIDING; const T0 = 0.12, gap = 0.06, segs = []; ops = (ops || []).slice().sort((a, b) => a[0] - b[0]); let s = v0;
    for (const o of ops) { if (o[0] > s) segs.push([s, o[0], y0, y1]); if (o[2] > y0) segs.push([o[0], o[1], y0, o[2]]); if (o[3] < y1) segs.push([o[0], o[1], o[3], y1]); s = o[1]; } if (s < v1) segs.push([s, v1, y0, y1]);
    for (const q of segs) { const w = q[1] - q[0], h = q[3] - q[2], cv = (q[0] + q[1]) / 2, cy = (q[2] + q[3]) / 2; if (w < 0.01 || h < 0.01) continue;
      uvRot(K.box(opt.ext || "wood", opt.col || WOOD, T0, h, w, u + out * (gap / 2 + T0 / 2), cy, cv, 0, 3.0)); if (!opt.noInt) uvRot(K.box("iwood", opt.icol || 0x8e6440, T0, h, w, u - out * (gap / 2 + T0 / 2), cy, cv, 0, 3.0));
      if (!opt.noSolid && q[2] < S.dS + 1.9 && q[3] > S.dS + 0.3) solidL(u, cv, 0, T0 * 2 + gap, w, q[2], q[3], "rodeo", { noStep: true }); }
    for (const o of ops) { const w = o[1] - o[0], h = o[3] - o[2], cv = (o[0] + o[1]) / 2; [[o[0] - 0.07], [o[1] + 0.07]].forEach((f) => K.box("wood", TRIM, 0.34, h + 0.14, 0.14, u, (o[2] + o[3]) / 2, f[0], 0, 1)); K.box("wood", TRIM, 0.36, 0.16, w + 0.28, u, o[3] + 0.08, cv, 0, 1); if (o[2] > y0 + 0.05) K.box("wood", TRIM, 0.42, 0.08, w + 0.3, u + out * 0.04, o[2] - 0.02, cv, 0, 1); } }
  // a gable triangle (extruded) in the u = const plane, from v0 to v1 rising to the ridge at vm
  function gable(K, b, col, u, v0, v1, yE, yR, th) { const sh = new THREE.Shape(); sh.moveTo(v0, yE); sh.lineTo(v1, yE); sh.lineTo((v0 + v1) / 2, yR); sh.lineTo(v0, yE); const g = new THREE.ExtrudeGeometry(sh, { depth: th, bevelEnabled: false }); const P = g.attributes.position, U = g.attributes.uv; for (let i = 0; i < P.count; i++) U.setXY(i, P.getY(i) / 3.0, P.getX(i) / 3.0);
    g.rotateY(-PI / 2); g.translate(u + th / 2, 0, 0); return K.add(b, g, col); }
  // a chair (seat, back, four legs) facing local direction (fu, fv); returns the seat solid
  function chair(K, u, v, y, fu, fv, col, sit) { const a = Math.atan2(-fv, fu) + PI / 2; const cs = Math.cos(a), sn = Math.sin(a); const P = (lx, lz) => [u + lx * cs + lz * sn, v - lx * sn + lz * cs];
    K.box("iwood", col, 0.46, 0.06, 0.46, u, y + 0.46, v, a, 0.6); const bk = P(0, -0.21); K.box("iwood", col, 0.44, 0.5, 0.05, bk[0], y + 0.75, bk[1], a, 0.6);
    [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].forEach(([lx, lz]) => { const p = P(lx, lz); K.box("iwood", OAKD, 0.05, 0.46, 0.05, p[0], y + 0.23, p[1], a, 0.5); });
    return sit === false ? null : seatL(u, v, a, 0.5, 0.5, y + 0.49, fu, fv); }
  function stool(K, u, v, y, fu, fv, h) { h = h || 0.78; K.cyl("iwood", LEATH, 0.22, 0.2, 0.09, u, y + h, v, 14); K.cyl("isteel", BRASS, 0.035, 0.035, h, u, y + h / 2, v, 6); K.cyl("isteel", BRASS, 0.2, 0.22, 0.03, u, y + 0.015, v, 12); K.place("isteel", new THREE.TorusGeometry(0.17, 0.014, 5, 16), BRASS, u, y + h * 0.38, v, 0, PI / 2); return seatL(u, v, 0, 0.42, 0.42, y + h + 0.05, fu, fv); }
  function wagonWheel(K, u, v, y, r) { K.place("iwood", new THREE.TorusGeometry(r, 0.06, 6, 28), OAKD, u, y, v, 0, PI / 2); K.cyl("iwood", OAKD, 0.14, 0.14, 0.16, u, y, v, 10); for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; K.tube("iwood", OAKD, [u, y, v], [u + Math.cos(a) * r, y, v + Math.sin(a) * r], 0.025, 5); }
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + 0.2; K.cyl("isteel", BRASS, 0.04, 0.05, 0.1, u + Math.cos(a) * r, y + 0.08, v + Math.sin(a) * r, 8); K.sph("bulb", 0xffffff, 0.07, u + Math.cos(a) * r, y + 0.2, v + Math.sin(a) * r, 8); }
    for (let k = 0; k < 3; k++) { const a = k / 3 * TAU; K.tube("isteel", 0x2a2622, [u + Math.cos(a) * r * 0.9, y, v + Math.sin(a) * r * 0.9], [u, y + 1.6, v], 0.008, 4); } K.tube("isteel", 0x2a2622, [u, y + 1.6, v], [u, y + 2.6, v], 0.012, 4); }
  function fan(u, v, y) { const K = new Kit(); K.cyl("isteel", 0x2a2622, 0.13, 0.15, 0.22, 0, 0, 0, 12); K.cyl("isteel", 0x2a2622, 0.02, 0.02, 0.6, 0, 0.4, 0, 6); for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; K.box("iwood", OAK, 0.62, 0.015, 0.14, Math.cos(a) * 0.42, -0.06, Math.sin(a) * 0.42, -a, 0.6); }
    const g = new THREE.Group(); g.position.set(u, y, v); g.userData.noBatch = true; K.build(g, { isteel: MT.isteel, iwood: MT.iwood }, { tag: "fan", cast: false }).forEach((m) => { m.userData.spin = true; }); return g; }
  function buildSaloon() {
    const M = mats(), G = zoneGroup("saloon"), K = new Kit(), Sa = L.saloon, F = S.dS, E = F + Sa.eave, Rg = F + Sa.ridge, vm = (Sa.v0 + Sa.v1) / 2; EX.saloon = G; const t0 = nowMs(); EX.lights = EX.lights || []; EX.glows = EX.glows || [];
    // ── foundation skirt (fieldstone look), the floor slab ──
    K.box("adobe", 0x9c8a74, Sa.u1 - Sa.u0 + 0.4, F + 0.6, 0.3, (Sa.u0 + Sa.u1) / 2, (F - 0.6) / 2, Sa.v0 - 0.05, 0, 1.6); K.box("adobe", 0x9c8a74, Sa.u1 - Sa.u0 + 0.4, F + 0.6, 0.3, (Sa.u0 + Sa.u1) / 2, (F - 0.6) / 2, Sa.v1 + 0.05, 0, 1.6);
    K.box("adobe", 0x9c8a74, 0.3, F + 0.6, Sa.v1 - Sa.v0, Sa.u0 - 0.05, (F - 0.6) / 2, vm, 0, 1.6); K.box("adobe", 0x9c8a74, 0.3, F + 0.6, Sa.v1 - Sa.v0, Sa.u1 + 0.05, (F - 0.6) / 2, vm, 0, 1.6);
    solidL((Sa.u0 + Sa.u1) / 2, vm, 0, Sa.u1 - Sa.u0, Sa.v1 - Sa.v0, F - 0.5, F, "rodeo");
    // ── the walls: lap-sided barnwood outside, darker boards inside; doors to the porch, the deck and the terrace; windows ──
    const DH = F + 3.0, WIN0 = F + 1.0, WIN1 = F + 2.6;
    const frontOps = [[-12.3, -9.7, F, F + 2.9], [-24.2, -21.8, WIN0, WIN1], [-18.2, -15.8, WIN0, WIN1], [-7.0, -4.6, WIN0, WIN1], [-0.8, 1.6, WIN0, WIN1]];
    const backOps = [[-22.6, -18.4, F, DH + 0.2], [-10.2, -5.8, F, DH + 0.2], [-2.6, 1.6, F, DH + 0.2], [-28.6, -26.4, WIN0, WIN1], [-15.6, -13.2, WIN0, WIN1], [3.0, 5.0, WIN0, WIN1]];
    wallU(K, Sa.v1, Sa.u0, Sa.u1, F, E, frontOps, 1); wallU(K, Sa.v0, Sa.u0, Sa.u1, F, E, backOps, -1);
    wallV(K, Sa.u0, Sa.v0, Sa.v1, F, E, [[16.9, 18.7, F, F + 2.7], [30.6, 32.0, WIN0, WIN1]], -1); wallV(K, Sa.u1, Sa.v0, Sa.v1, F, E, [[30.8, 31.9, F, F + 2.5]], 1);
    gable(K, "wood", SIDING, Sa.u0 - 0.15, Sa.v0, Sa.v1, E, Rg, 0.14); gable(K, "wood", SIDING, Sa.u1 + 0.01, Sa.v0, Sa.v1, E, Rg, 0.14); gable(K, "iwood", 0x8e6a48, Sa.u0 + 0.02, Sa.v0, Sa.v1, E, Rg - 0.1, 0.06); gable(K, "iwood", 0x8e6a48, Sa.u1 - 0.08, Sa.v0, Sa.v1, E, Rg - 0.1, 0.06);
    // glass in every window, a warm glow behind it at night
    const winGlass = (u, v, w, h, alongU) => { if (alongU) K.box("glass", 0xffffff, w, h, 0.03, u, (WIN0 + WIN1) / 2, v, 0, 1); else K.box("glass", 0xffffff, 0.03, h, w, u, (WIN0 + WIN1) / 2, v, 0, 1); };
    frontOps.slice(1).forEach((o) => winGlass((o[0] + o[1]) / 2, Sa.v1, o[1] - o[0], o[3] - o[2], true)); backOps.slice(3).forEach((o) => winGlass((o[0] + o[1]) / 2, Sa.v0, o[1] - o[0], o[3] - o[2], true)); winGlass(Sa.u0, 31.3, 1.4, WIN1 - WIN0, false);
    // mullions
    frontOps.slice(1).concat(backOps.slice(3)).forEach((o) => { const v = o === frontOps[1] || frontOps.indexOf(o) > 0 ? Sa.v1 : Sa.v0; K.box("wood", TRIM, 0.05, o[3] - o[2], 0.06, (o[0] + o[1]) / 2, (o[2] + o[3]) / 2, v, 0, 1); K.box("wood", TRIM, o[1] - o[0], 0.05, 0.06, (o[0] + o[1]) / 2, (o[2] + o[3]) / 2 + 0.25, v, 0, 1); });
    // ── the roof: corrugated (rust) on both slopes, ridge cap, the dark underside inside, king-post trusses ──
    { const run = (Sa.v1 - Sa.v0) / 2 + 0.5, rise = Rg - E + 0.08, ang = Math.atan2(rise, run), Ls = Math.hypot(run, rise) + 0.05, len = Sa.u1 - Sa.u0 + 1.0;
      K.box("corr", RUST, len, 0.06, Ls, (Sa.u0 + Sa.u1) / 2, (E + Rg) / 2 + 0.1, Sa.v0 - 0.5 + run / 2, 0, 1.6, -ang); K.box("corr", RUST, len, 0.06, Ls, (Sa.u0 + Sa.u1) / 2, (E + Rg) / 2 + 0.1, Sa.v1 + 0.5 - run / 2, 0, 1.6, ang);
      K.box("icorr", 0x5e5248, len - 1.0, 0.03, Ls - 0.5, (Sa.u0 + Sa.u1) / 2, (E + Rg) / 2 - 0.08, Sa.v0 - 0.25 + run / 2, 0, 1.6, -ang); K.box("icorr", 0x5e5248, len - 1.0, 0.03, Ls - 0.5, (Sa.u0 + Sa.u1) / 2, (E + Rg) / 2 - 0.08, Sa.v1 + 0.25 - run / 2, 0, 1.6, ang);
      K.box("steel", GALV, len, 0.12, 0.5, (Sa.u0 + Sa.u1) / 2, Rg + 0.2, vm, 0, 1);
      for (let u = Sa.u0 + 4; u < Sa.u1 - 0.5; u += 4.5) { K.beam("iwood", OAKD, [u, E - 0.1, Sa.v0 + 0.2], [u, E - 0.1, Sa.v1 - 0.2], 0.2, 0.26); K.beam("iwood", OAKD, [u, E - 0.05, Sa.v0 + 0.2], [u, Rg - 0.2, vm], 0.18, 0.22); K.beam("iwood", OAKD, [u, E - 0.05, Sa.v1 - 0.2], [u, Rg - 0.2, vm], 0.18, 0.22); K.box("iwood", OAKD, 0.18, Rg - E - 0.3, 0.18, u, (E + Rg) / 2 - 0.15, vm, 0, 1); K.tube("isteel", 0x2a2622, [u, E - 0.2, vm - 3.5], [u, Rg - 0.9, vm], 0.015, 4); K.tube("isteel", 0x2a2622, [u, E - 0.2, vm + 3.5], [u, Rg - 0.9, vm], 0.015, 4); }
      for (const t of [0.33, 0.66]) [Sa.v0, Sa.v1].forEach((vv) => K.box("iwood", OAKD, Sa.u1 - Sa.u0 - 0.3, 0.14, 0.14, (Sa.u0 + Sa.u1) / 2, lerp(E, Rg, t) - 0.25, lerp(vv, vm, t), 0, 1)); }
    // ── the false front on Night Field Road: a stepped parapet, cornice, the painted sign, neon wings ──
    { const v = Sa.v1 + 0.05, P1 = F + 7.0, P2 = F + 9.7; K.box("wood", SIDING, Sa.u1 - Sa.u0 + 0.3, P1 - E + 0.05, 0.22, (Sa.u0 + Sa.u1) / 2, (E + P1) / 2, v, 0, 2.4); K.box("wood", SIDING, 21, P2 - P1, 0.22, -11, (P1 + P2) / 2, v, 0, 2.4); [[-22.3, -21.5], [-0.5, 0.3]].forEach(([a, b]) => K.box("wood", SIDING, b - a, 1.2, 0.22, (a + b) / 2, P1 + 0.6, v, 0, 2.4));
      K.box("wood", TRIM, Sa.u1 - Sa.u0 + 0.6, 0.22, 0.42, (Sa.u0 + Sa.u1) / 2, P1 + 0.08, v + 0.1, 0, 1); K.box("wood", TRIM, 21.6, 0.28, 0.46, -11, P2 + 0.1, v + 0.1, 0, 1); for (let u = -21; u <= -1; u += 1.25) K.box("wood", TRIM, 0.14, 0.24, 0.12, u, P2 - 0.16, v + 0.25, 0, 1);
      // its back: braces seen from the deck side
      for (let u = -20; u <= -2; u += 4.5) K.beam("wood", WOODD, [u, P2 - 0.3, v - 0.15], [u, Rg - 0.4, v - 3.6], 0.12, 0.16);
      K.box("wood", OAKD, 9.7, 4.25, 0.1, -11, F + 7.42, v + 0.14, 0, 1); K.plane("sign", 0xffffff, 9.5, 4.08, -11, F + 7.42, v + 0.2, 0);
      // gooseneck lamps over the painted sign (lit at night, a lamp source for the pool)
      for (const du of [-3.4, 0, 3.4]) { const u = -11 + du; K.tube("steel", 0x2a2826, [u, F + 9.62, v + 0.2], [u, F + 9.95, v + 0.55], 0.025, 6); K.tube("steel", 0x2a2826, [u, F + 9.95, v + 0.55], [u, F + 9.85, v + 0.95], 0.025, 6); K.cyl("steel", 0x2a2826, 0.08, 0.2, 0.18, u, F + 9.78, v + 1.0, 12, true); K.sph("lamp", 0xfff1d6, 0.07, u, F + 9.72, v + 1.0, 8); }
      lampSource(-11, F + 9.2, v + 1.6, 0xffe0b0, 7, 9, "sign");
      const rh = NEON.r.hero, rs = NEON.r.steaks; if (rh) { K.box("steel", DARK, 6.0, 2.1, 0.12, 2.6, F + 6.0, v + 0.18, 0, 1); K.plane("neon", 0xffffff, 5.8, 1.93, 2.6, F + 6.0, v + 0.25, 0, 0, rh); } if (rs) { K.box("steel", DARK, 3.4, 0.92, 0.12, -26.4, F + 6.0, v + 0.18, 0, 1); K.plane("neon", 0xffffff, 3.2, 0.8, -26.4, F + 6.0, v + 0.25, 0, 0, rs); } }
    // ── the porch on the road: plank deck, posts with brackets, a shed roof, steps, benches, barrels, the hitching rail ──
    { const P = L.porch, pu0 = Sa.u0 - 0.2, pu1 = Sa.u1 + 0.2; K.slab("wood", 0xb9a68c, pu0, P.v0, pu1, P.v1, F + 0.04, 2.4, true); K.box("wood", WOODD, pu1 - pu0, F + 0.3, 0.16, (pu0 + pu1) / 2, (F - 0.3) / 2, P.v1 - 0.08, 0, 1.2);
      solidL((pu0 + pu1) / 2, (P.v0 + P.v1) / 2, 0, pu1 - pu0, P.v1 - P.v0, F - 0.5, F + 0.04, "rodeo");
      for (let u = pu0 + 0.2; u <= pu1; u += (pu1 - pu0 - 0.4) / 8) { K.box("wood", WOODD, 0.22, P.roof, 0.22, u, F + P.roof / 2, P.v1 - 0.25, 0, 1); K.beam("wood", WOODD, [u, F + P.roof - 0.6, P.v1 - 0.25], [u, F + P.roof - 0.1, P.v1 - 0.9], 0.1, 0.12); if (Math.abs(u + 11) > 1.6) solidL(u, P.v1 - 0.25, 0, 0.24, 0.24, F, F + P.roof, "rodeo", { noStep: true }); }
      K.box("wood", WOODD, pu1 - pu0, 0.26, 0.2, (pu0 + pu1) / 2, F + P.roof, P.v1 - 0.25, 0, 1); { const run = P.v1 - P.v0 + 0.5, ang = Math.atan2(0.45, run); K.box("corr", RUST, pu1 - pu0 + 0.4, 0.05, run + 0.05, (pu0 + pu1) / 2, F + P.roof + 0.32, (P.v0 + P.v1) / 2 + 0.25, 0, 1.6, ang); }
      for (let s = 0; s < 4; s++) { const vv = P.v1 + 0.18 + s * 0.34, yy = F - (s + 1) * F / 5; K.box("wood", WOOD, 4.0, 0.08, 0.36, -11, yy, vv, 0, 1); solidL(-11, vv, 0, 4.0, 0.36, yy - 0.3, yy + 0.04, "rodeo"); }
      for (const [u0b, u1b] of [[-28.5, -25.5], [3.6, 5.6]]) { K.box("wood", OAK, u1b - u0b, 0.06, 0.42, (u0b + u1b) / 2, F + 0.48, P.v0 + 0.45, 0, 1); K.box("wood", OAK, u1b - u0b, 0.42, 0.05, (u0b + u1b) / 2, F + 0.76, P.v0 + 0.25, 0, 1); seatL((u0b + u1b) / 2 - 0.7, P.v0 + 0.45, 0, 1.2, 0.42, F + 0.5, 0, 1); seatL((u0b + u1b) / 2 + 0.7, P.v0 + 0.45, 0, 1.2, 0.42, F + 0.5, 0, 1); }
      [[-6.5, 35.6], [-5.9, 35.1], [-15.8, 35.7]].forEach(([u, v]) => { K.cyl("wood", OAK, 0.32, 0.32, 0.9, u, F + 0.45, v, 12); K.place("steel", new THREE.TorusGeometry(0.33, 0.02, 4, 16), DARK, u, F + 0.2, v, 0, PI / 2); K.place("steel", new THREE.TorusGeometry(0.33, 0.02, 4, 16), DARK, u, F + 0.7, v, 0, PI / 2); solidL(u, v, 0, 0.6, 0.6, F, F + 0.9, "rodeo", { noStep: true }); });
      // the hitching rail and a trough in front, on the ground
      const hv = 37.4; for (const u of [-28.0, -22.5, -17.0]) { const g0 = gy(u, hv); K.box("wood", WOODD, 0.2, 1.3, 0.2, u, g0 + 0.55, hv, 0, 1); solidL(u, hv, 0, 0.24, 0.24, g0, g0 + 1.2, "rodeo", { noStep: true }); } { const g0 = gy(-22.5, hv); K.beam("wood", WOOD, [-28.0, gy(-28, hv) + 1.12, hv], [-17.0, gy(-17, hv) + 1.12, hv], 0.14, 0.14); solidL(-22.5, hv, 0, 11, 0.2, g0 + 0.8, g0 + 1.2, "rodeo", { noStep: true }); }
      { const tu = -25.2, tv = 38.6, g0 = gy(tu, tv); K.box("wood", WOODD, 2.0, 0.55, 0.65, tu, g0 + 0.28, tv, 0, 1); K.box("glass", 0xffffff, 1.84, 0.02, 0.5, tu, g0 + 0.5, tv, 0, 1); solidL(tu, tv, 0, 2.0, 0.65, g0, g0 + 0.56, "rodeo", { noStep: true }); }
      // the porch lamps (lanterns) and a light source for the pool
      for (const u of [-20, -11, -2]) { K.box("steel", DARK, 0.22, 0.32, 0.22, u, F + P.roof - 0.42, P.v0 + 0.9, 0, 1); K.box("lamp", 0xffd9a0, 0.14, 0.2, 0.14, u, F + P.roof - 0.44, P.v0 + 0.9, 0, 1); }
      lampSource(-11, F + 3.1, 34.6, 0xffc58a, 5.0, 18, "porch"); }
    // ── the patio deck along the arena and the terrace round the south-west end ──
    deckBuild(K, F);
    // ── the interior ──
    interior(K, F, E, Rg);
    K.build(G, { wood: M.wood, iwood: M.iwood, corr: M.corr, icorr: M.icorr, steel: M.steel, isteel: M.isteel, adobe: M.adobe, glass: M.glass, neon: M.neon, lamp: M.lamp, bulb: M.bulb, sign: M.sign, mural: M.mural, brands: M.brands, posters: M.posters, menu: M.menu, bottles: M.bottles, wanted: M.wanted, tack: M.tack, skull: M.skull, hide: M.hide, bunt: M.bunt, glow: M.glow }, { tag: "saloon", noCast: ["neon", "lamp", "bulb", "glow", "bunt", "glass", "hide", "posters", "menu", "wanted", "tack", "bottles", "mural", "iwood", "isteel", "icorr", "brands"] });
    // ceiling fans (they turn) and the window glows (night)
    EX.fans = []; [[-20, 24.5], [-8, 21.5], [-1, 26.5]].forEach(([u, v]) => { const f = fan(u, v, E - 0.6); G.add(f); EX.fans.push(f); });
    R.t.saloon = Math.round(nowMs() - t0); return G; }
  // a light source for the client's pool (hidden by the pool, which copies the nearest ones): local u, y (from the arena pad), v
  function lampSource(u, y, v, col, k, dist, tag) { const l = new THREE.PointLight(col, 0, dist, 1.6); const g = EX.saloon || EX.arena; l.position.set(u, y, v); l.userData.k0 = k; l.userData.tag = tag; (g || scene).add(l); EX.lights.push(l); return l; }
  function spotSource(u, y, v, tu, ty, tv, col, k, dist, ang, tag) { const l = new THREE.SpotLight(col, 0, dist, ang, 0.55, 1.2); const g = EX.arena; l.position.set(u, y, v); const t = new THREE.Object3D(); t.position.set(tu, ty, tv); g.add(t); l.target = t; l.userData.k0 = k; l.userData.tag = tag; g.add(l); EX.lights.push(l); return l; }
  function deckBuild(K, F) {
    const D = L.deck, Tt = L.terrace, rail = (a, b) => { K.beam("wood", OAK, [a[0], F + 1.08, a[1]], [b[0], F + 1.08, b[1]], 0.3, 0.06, 1.4); K.beam("wood", WOODD, [a[0], F + 0.55, a[1]], [b[0], F + 0.55, b[1]], 0.06, 0.12, 1.4); const Ls = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.round(Ls / 0.45); for (let k = 0; k <= n; k++) { const u = lerp(a[0], b[0], k / n), v = lerp(a[1], b[1], k / n); K.box("steel", DARK, 0.025, 1.04, 0.025, u, F + 0.55, v, 0, 1); } solidL((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -Math.atan2(b[1] - a[1], b[0] - a[0]), Ls, 0.2, F, F + 1.1, "rodeo", { noStep: true }); };
    // floors (planks across), the skirt down to the ground, the solids
    K.slab("wood", 0xb9a68c, D.u0, D.v0, D.u1 + 0.2, D.v1, F + 0.04, 2.4, true); K.slab("wood", 0xb9a68c, Tt.u0, Tt.v0, Tt.u1, Tt.v1, F + 0.04, 2.4, true);
    solidL((D.u0 + D.u1) / 2, (D.v0 + D.v1) / 2, 0, D.u1 - D.u0, D.v1 - D.v0, F - 0.5, F + 0.04, "rodeo"); solidL((Tt.u0 + Tt.u1) / 2, (Tt.v0 + Tt.v1) / 2, 0, Tt.u1 - Tt.u0, Tt.v1 - Tt.v0, F - 0.5, F + 0.04, "rodeo");
    const skirt = (a, b) => { const Ls = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(Ls / 2.4)); for (let k = 0; k < n; k++) { const u0 = lerp(a[0], b[0], k / n), v0 = lerp(a[1], b[1], k / n), u1 = lerp(a[0], b[0], (k + 1) / n), v1 = lerp(a[1], b[1], (k + 1) / n); const g0 = Math.min(gy(u0, v0), gy(u1, v1)) - 0.2; const h = F - g0; for (let y = g0 + 0.1; y < F - 0.05; y += 0.28) K.beam("wood", WOODD, [u0, y, v0], [u1, y, v1], 0.05, 0.18, 1.2); } };
    skirt([Tt.u0, Tt.v0], [D.u1 + 0.2, D.v0]); skirt([Tt.u0, Tt.v0], [Tt.u0, Tt.v1]); skirt([D.u1 + 0.2, D.v0], [D.u1 + 0.2, D.v1]);
    // posts and the shed roof over the patio deck (rail bar along the arena side)
    for (let u = D.u0; u <= D.u1 + 0.01; u += (D.u1 - D.u0) / 8) { K.box("wood", WOODD, 0.24, D.roof1 + 0.05, 0.24, u, F + D.roof1 / 2, D.v0 + 0.15, 0, 1); K.beam("wood", WOODD, [u, F + D.roof1 - 0.6, D.v0 + 0.15], [u, F + D.roof1 - 0.05, D.v0 + 0.8], 0.1, 0.12); solidL(u, D.v0 + 0.15, 0, 0.26, 0.26, F, F + D.roof1, "rodeo", { noStep: true }); }
    K.box("wood", WOODD, D.u1 - D.u0 + 0.3, 0.28, 0.22, (D.u0 + D.u1) / 2, F + D.roof1, D.v0 + 0.15, 0, 1); { const run = D.v1 - D.v0 + 0.4, ang = Math.atan2(D.roof0 - D.roof1, run); K.box("corr", RUST, D.u1 - D.u0 + 0.8, 0.05, run + 0.1, (D.u0 + D.u1) / 2, F + (D.roof0 + D.roof1) / 2 + 0.18, (D.v0 + D.v1) / 2 - 0.2, 0, 1.6, -ang); K.box("icorr", 0x5e5248, D.u1 - D.u0 + 0.4, 0.03, run - 0.3, (D.u0 + D.u1) / 2, F + (D.roof0 + D.roof1) / 2 + 0.08, (D.v0 + D.v1) / 2 - 0.2, 0, 1.6, -ang); }
    rail([D.u0 + 0.2, D.v0 + 0.15], [D.u1 - 0.3, D.v0 + 0.15]);
    for (let u = D.u0 + 1.6; u < D.u1 - 0.8; u += 2.15) stool(K, u, D.v0 + 0.85, F, 0, -1, 0.74);
    for (let k = 0; k < 6; k++) { const u = D.u0 + 3.2 + k * 5.6, v = D.v1 - 1.9; K.cyl("wood", OAK, 0.5, 0.5, 0.05, u, F + 0.76, v, 16); K.cyl("steel", DARK, 0.05, 0.05, 0.74, u, F + 0.38, v, 6); solidL(u, v, 0, 0.9, 0.9, F, F + 0.78, "rodeo", { noStep: true }); chair(K, u - 0.8, v, F, 1, 0, OAK); chair(K, u + 0.8, v, F, -1, 0, OAK); chair(K, u, v - 0.8, F, 0, 1, OAK); }
    // string lights along the deck eave
    for (let k = 0; k < 8; k++) { const ua = lerp(D.u0, D.u1, k / 8), ub = lerp(D.u0, D.u1, (k + 1) / 8); bulbs(K, [ua, F + D.roof1 - 0.1, D.v0 + 0.5], [ub, F + D.roof1 - 0.1, D.v0 + 0.5], 0.28, 5); }
    lampSource(-12, F + 3.0, 13.4, 0xffc890, 5.0, 20, "deck"); lampSource(1, F + 3.0, 13.4, 0xffc890, 4.0, 18, "deck");
    // stairs: deck to the arena walk at the north-east end; terrace to the arena level at its north-west edge
    const nst = Math.max(3, Math.ceil(F / 0.32)), rz = F / nst;
    for (let s = 0; s < nst; s++) { const u = D.u1 + 0.45 + s * 0.32, y = F - (s + 1) * rz; K.box("wood", WOOD, 0.32, 0.07, 1.6, u, y + 0.035, 12.0, 0, 1); solidL(u, 12.0, 0, 0.32, 1.6, y - 0.25, y + 0.07, "rodeo"); }
    for (let s = 0; s < nst; s++) { const v = Tt.v0 - 0.2 - s * 0.32, y = F - (s + 1) * rz; K.box("wood", WOOD, 2.2, 0.07, 0.32, -38.0, y + 0.035, v, 0, 1); solidL(-38.0, v, 0, 2.2, 0.32, y - 0.25, y + 0.07, "rodeo"); }
    rail([Tt.u0 + 0.2, Tt.v0 + 0.15], [-39.2, Tt.v0 + 0.15]); rail([-36.8, Tt.v0 + 0.15], [Tt.u1 + 0.2, Tt.v0 + 0.15]); rail([Tt.u0 + 0.15, Tt.v0 + 0.2], [Tt.u0 + 0.15, Tt.v1 - 0.3]);
    // the ramada over the picnic tables
    { const ru0 = Tt.u0 + 0.8, ru1 = Tt.u1 - 0.8, rv0 = Tt.v0 + 1.4, rv1 = Tt.v0 + 14.8, rh = 3.4; for (const u of [ru0, (ru0 + ru1) / 2, ru1]) for (const v of [rv0, rv1]) { K.box("wood", WOODD, 0.26, rh, 0.26, u, F + rh / 2, v, 0, 1); solidL(u, v, 0, 0.28, 0.28, F, F + rh, "rodeo", { noStep: true }); }
      for (const v of [rv0, rv1]) K.box("wood", WOODD, ru1 - ru0 + 0.6, 0.3, 0.2, (ru0 + ru1) / 2, F + rh, v, 0, 1); for (let u = ru0; u <= ru1 + 0.01; u += (ru1 - ru0) / 6) K.box("wood", WOOD, 0.12, 0.2, rv1 - rv0 + 0.8, u, F + rh + 0.24, (rv0 + rv1) / 2, 0, 1);
      K.box("corr", RUST, ru1 - ru0 + 1.2, 0.05, rv1 - rv0 + 1.4, (ru0 + ru1) / 2, F + rh + 0.42, (rv0 + rv1) / 2, 0, 1.6, 0.06);
      for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) { const u = lerp(ru0 + 3.0, ru1 - 3.0, col), v = rv0 + 2.4 + row * 4.4; K.box("wood", OAK, 2.3, 0.07, 0.8, u, F + 0.76, v, 0, 1); [-0.95, 0.95].forEach((du) => K.box("wood", OAKD, 0.07, 0.72, 1.7, u + du, F + 0.38, v, 0, 1)); solidL(u, v, 0, 2.3, 0.8, F, F + 0.8, "rodeo", { noStep: true });
        [-0.72, 0.72].forEach((dv) => { K.box("wood", OAK, 2.3, 0.06, 0.32, u, F + 0.46, v + dv, 0, 1); seatL(u - 0.55, v + dv, 0, 1.0, 0.32, F + 0.48, 0, -Math.sign(dv)); seatL(u + 0.55, v + dv, 0, 1.0, 0.32, F + 0.48, 0, -Math.sign(dv)); }); }
      for (let k = 0; k < 4; k++) { const v = lerp(rv0 + 0.6, rv1 - 0.6, k / 3); bulbs(K, [ru0, F + rh - 0.15, v], [ru1, F + rh - 0.15, v], 0.35, 9); }
      lampSource((ru0 + ru1) / 2, F + 2.9, (rv0 + rv1) / 2, 0xffc890, 5.0, 20, "ramada"); }
    // the smoker: an offset barrel smoker on its trailer, the firebox glowing, the stack; a prep table, mesquite, the menu easel, the BBQ neon
    { const su = -39.2, sv = 29.6, y = F; const sk = new THREE.Group(); EX.smoke = { u: su + 1.55, v: sv, y: y + 3.15, puffs: [] };
      K.box("steel", DARK, 3.6, 0.1, 1.2, su, y + 0.62, sv, 0, 1); [-1, 1].forEach((s) => { K.place("steel", new THREE.CylinderGeometry(0.34, 0.34, 0.16, 16), 0x1a1918, su - 0.2, y + 0.34, sv + s * 0.66, 0, PI / 2); }); K.tube("steel", DARK, [su + 1.8, y + 0.62, sv], [su + 2.6, y + 0.45, sv], 0.04, 6);
      K.place("steel", new THREE.CylinderGeometry(0.55, 0.55, 2.4, 22), 0x1c1b1a, su + 0.3, y + 1.26, sv, 0, 0, PI / 2); K.box("steel", 0x1c1b1a, 0.9, 0.9, 0.9, su - 1.35, y + 1.1, sv, 0, 1); K.cyl("steel", 0x1c1b1a, 0.13, 0.13, 2.1, su + 1.55, y + 2.3, sv, 12); K.cyl("steel", 0x1c1b1a, 0.2, 0.16, 0.12, su + 1.55, y + 3.38, sv, 12);
      K.tube("isteel", 0xd0c8b8, [su - 0.5, y + 1.86, sv - 0.25], [su + 1.0, y + 1.86, sv - 0.25], 0.025, 6); K.cyl("isteel", 0xd8d2c6, 0.07, 0.07, 0.03, su + 0.3, y + 1.8, sv - 0.56, 12, false, 0, PI / 2);
      K.plane("lamp", 0xff7a2a, 0.5, 0.36, su - 1.35, y + 0.95, sv - 0.455, PI); EX.fireL = lampSource(su - 1.4, y + 1.2, sv - 1.0, 0xff8a3a, 3.0, 9, "fire");
      K.box("wood", OAK, 1.8, 0.07, 0.75, su + 3.6, y + 0.92, sv - 0.4, 0, 1); [[-0.8, -0.3], [0.8, -0.3], [-0.8, 0.3], [0.8, 0.3]].forEach(([a, b]) => K.box("wood", OAKD, 0.07, 0.9, 0.07, su + 3.6 + a, y + 0.45, sv - 0.4 + b, 0, 1)); K.box("wood", 0x9a6a3a, 0.6, 0.05, 0.4, su + 3.4, y + 0.98, sv - 0.4, 0, 1); solidL(su + 3.6, sv - 0.4, 0, 1.8, 0.75, y, y + 0.95, "rodeo", { noStep: true });
      for (let k = 0; k < 9; k++) { const lu = su - 2.9 + (k % 3) * 0.05, lv = sv + 0.9 - (k % 3) * 0.3, ly = y + 0.14 + Math.floor(k / 3) * 0.24; K.place("wood", new THREE.CylinderGeometry(0.11, 0.12, 1.1, 9), 0x6a4a32, lu, ly, lv, 0.1 * k, 0, PI / 2); }
      solidL(su, sv, 0, 4.6, 1.4, y, y + 1.9, "rodeo", { noStep: true });
      K.box("wood", OAKD, 0.06, 1.25, 0.95, -31.4, y + 1.45, 31.0, 0, 1); K.plane("menu", 0xffffff, 0.86, 1.15, -31.36, y + 1.45, 31.0, -PI / 2); [[-0.4], [0.4]].forEach(([dv]) => K.beam("wood", OAKD, [-31.3, y, 31.0 + dv], [-31.38, y + 2.0, 31.0 + dv * 0.6], 0.05, 0.05));
      const rb = NEON.r.bbq; if (rb) { K.box("wood", WOODD, 0.16, 2.6, 0.16, su + 2.8, y + 1.3, sv + 1.25, 0, 1); K.box("steel", DARK, 1.42, 0.74, 0.08, su + 2.8, y + 2.85, sv + 1.25, 0, 1); K.plane("neon", 0xffffff, 1.3, 0.65, su + 2.8, y + 2.85, sv + 1.2, PI, 0, rb); }
      // the gable sign on the south-west end (golden hour faces it)
      K.box("wood", OAKD, 0.1, 2.95, 6.6, Sa_u0(), F + 5.65, 24.5, 0, 1); K.plane("sign", 0xffffff, 6.4, 2.75, Sa_u0() - 0.07, F + 5.65, 24.5, -PI / 2);
      for (const dv of [-2.2, 2.2]) { const u0 = Sa_u0(); K.tube("steel", 0x2a2826, [u0 - 0.05, F + 7.2, 24.5 + dv], [u0 - 0.85, F + 7.35, 24.5 + dv], 0.025, 6); K.cyl("steel", 0x2a2826, 0.08, 0.2, 0.18, u0 - 0.9, F + 7.28, 24.5 + dv, 12, true); K.sph("lamp", 0xfff1d6, 0.07, u0 - 0.9, F + 7.22, 24.5 + dv, 8); } lampSource(Sa_u0() - 1.6, F + 6.6, 24.5, 0xffe0b0, 6, 8, "sign"); } }
  const Sa_u0 = () => L.saloon.u0 - 0.24;
  // a string of bulbs between two points with a sag (emissive bulbs on a thin wire)
  function bulbs(K, A, B, sag, n) { const P = []; for (let i = 0; i <= 10; i++) { const t = i / 10; P.push([lerp(A[0], B[0], t), lerp(A[1], B[1], t) - sag * Math.sin(t * PI), lerp(A[2], B[2], t)]); } for (let i = 0; i < 10; i++) K.tube("steel", 0x1a1918, P[i], P[i + 1], 0.006, 3);
    for (let i = 1; i <= n; i++) { const t = i / (n + 1); const p = [lerp(A[0], B[0], t), lerp(A[1], B[1], t) - sag * Math.sin(t * PI) - 0.07, lerp(A[2], B[2], t)]; K.sph("bulb", 0xffe6b8, 0.042, p[0], p[1], p[2], 10); (EX.bulbPts = EX.bulbPts || []).push(p); } }

  // ───────────────────────── the saloon inside: the long bar, the steakhouse, the dance floor and stage, the mechanical bull ring ─────────────────────────
  const BULL_C = [-8.2, 21.4];                       // the mechanical bull ring (local u, v)
  function interior(K, F, E, Rg) {
    const Sa = L.saloon, iu0 = Sa.u0 + 0.21, iu1 = Sa.u1 - 0.21, iv0 = Sa.v0 + 0.21, iv1 = Sa.v1 - 0.21;
    // floor: wide planks, a honey dance floor with a dark border, the stage
    K.slab("iwood", 0x6e4a30, iu0, iv0, iu1, iv1, F + 0.05, 2.2, false, 1);
    K.slab("iwood", 0xc89058, -3.6, 17.4, 1.5, 31.4, F + 0.065, 1.6, true); [[-3.75, 17.25, 1.65, 17.4], [-3.75, 31.4, 1.65, 31.55], [-3.75, 17.25, -3.6, 31.55], [1.5, 17.25, 1.65, 31.55]].forEach((b) => K.slab("isteel", BRASS, b[0], b[1], b[2], b[3], F + 0.068, 1, false));
    // wainscot and chair rail on the long walls, darker boards
    for (const [v, s] of [[iv0, 1], [iv1, -1]]) { K.box("iwood", 0x5e4532, iu1 - iu0, 1.1, 0.05, (iu0 + iu1) / 2, F + 0.6, v + s * 0.03, 0, 1.2); K.box("iwood", OAKD, iu1 - iu0, 0.08, 0.09, (iu0 + iu1) / 2, F + 1.17, v + s * 0.05, 0, 1); }
    // ── the long bar along the south-west wall: counter with the branded front, brass rail, stools; the back bar with bottles, mirror, the longhorn ──
    const bu = -26.0, bv0 = 19.2, bv1 = 31.0, bl = bv1 - bv0, bm2 = (bv0 + bv1) / 2;
    K.box("iwood", 0x3a2418, 0.78, 0.1, bl + 0.2, bu - 0.12, F + 1.12, bm2, 0, 1.6); K.box("iwood", 0x4a2e1e, 0.62, 1.02, bl, bu - 0.16, F + 0.56, bm2, 0, 1.2);
    K.plane("brands", 0xffffff, bl, 1.0, bu + 0.155, F + 0.56, bm2, PI / 2, 0, [0, 0.02, 1, 0.98]); K.plane("brands", 0xffffff, 0.62, 1.0, bu - 0.16, F + 0.56, bv1 + 0.005, 0, 0, [0.4, 0.02, 0.62, 0.98]);
    K.tube("isteel", BRASS, [bu + 0.42, F + 0.22, bv0], [bu + 0.42, F + 0.22, bv1], 0.03, 8); for (let v = bv0 + 0.3; v < bv1; v += 1.5) K.tube("isteel", BRASS, [bu + 0.42, F + 0.22, v], [bu + 0.17, F + 0.32, v], 0.012, 4);
    solidL(bu - 0.12, bm2, 0, 0.8, bl, F, F + 1.15, "rodeo", { noStep: true });
    for (let v = bv0 + 0.55; v < bv1 - 0.2; v += 1.32) stool(K, bu + 0.95, v, F, -1, 0, 0.8);
    // taps, glasses, a register
    for (let k = 0; k < 6; k++) { const v = 23.4 + k * 0.32; K.cyl("isteel", BRASS, 0.025, 0.025, 0.4, bu - 0.32, F + 1.37, v, 6); K.box("iwood", 0x1a1210, 0.04, 0.14, 0.04, bu - 0.32, F + 1.62, v, 0, 1); }
    for (let k = 0; k < 10; k++) K.cyl("glass", 0xffffff, 0.04, 0.035, 0.14, bu - 0.05, F + 1.24, 20.0 + k * 0.6, 8);
    K.box("isteel", BRASS, 0.42, 0.34, 0.42, bu - 0.2, F + 1.34, 29.6, 0, 1); K.box("iwood", 0x1a1210, 0.38, 0.12, 0.2, bu - 0.2, F + 1.54, 29.5, 0, 1);
    // the back bar
    const wu = iu0 + 0.05; K.box("iwood", 0x3a2418, 0.55, 1.0, bl, wu + 0.28, F + 0.5, bm2, 0, 1.2); K.box("iwood", 0x2a1a12, 0.62, 0.06, bl, wu + 0.31, F + 1.02, bm2, 0, 1);
    for (let k = 0; k < 3; k++) { const v = bv0 + bl * (k + 0.5) / 3; K.plane("bottles", 0xffffff, bl / 3 - 0.24, 2.0, wu + 0.06, F + 2.1, v, PI / 2, 0, [0.02, 0.06, 0.98, 0.94]); }
    for (let k = 0; k <= 3; k++) K.box("iwood", 0x2a1a12, 0.2, 2.4, 0.2, wu + 0.1, F + 2.15, bv0 + bl * k / 3, 0, 1); K.box("iwood", 0x2a1a12, 0.3, 0.3, bl + 0.3, wu + 0.15, F + 3.25, bm2, 0, 1);
    K.plane("skull", 0xf4ecdc, 2.4, 1.32, wu + 0.12, F + 4.1, bm2, PI / 2); const rh = NEON.r.hero; if (rh) { K.box("iwood", 0x1a1210, 0.06, 1.5, 4.6, wu + 0.06, F + 4.15, bv0 + 1.9, 0, 1); K.plane("neon", 0xffffff, 4.4, 1.46, wu + 0.1, F + 4.15, bv0 + 1.9, PI / 2, 0, rh); }
    solidL(wu + 0.28, bm2, 0, 0.6, bl, F, F + 2.6, "rodeo", { noStep: true });
    // the wanted posters and the menu by the door, the tack wall, saddles on a rail
    K.box("iwood", 0x2a1a12, 2.6, 1.8, 0.04, -14.05, F + 2.0, iv1 - 0.03, 0, 1); K.plane("wanted", 0xffffff, 2.5, 1.66, -14.05, F + 2.0, iv1 - 0.06, PI);
    K.plane("menu", 0xffffff, 0.9, 1.2, -27.6, F + 2.0, iv1 - 0.06, PI); K.box("iwood", 0x2a1a12, 1.0, 1.3, 0.04, -27.6, F + 2.0, iv1 - 0.03, 0, 1);
    K.plane("tack", 0xffffff, 3.3, 1.87, -20.0, F + 2.1, iv1 - 0.06, PI); K.box("iwood", 0x2a1a12, 3.4, 1.97, 0.03, -20.0, F + 2.1, iv1 - 0.03, 0, 1);
    for (let k = 0; k < 3; k++) { const u = 2.5 + k * 1.05; saddle(K, u, F + 1.6, iv1 - 0.32); } K.beam("iwood", OAKD, [1.9, F + 1.5, iv1 - 0.3], [5.5, F + 1.5, iv1 - 0.3], 0.1, 0.08);
    // the rodeo posters (eight, from one sheet) on the back wall between the barn doors
    { const pw = 0.62, ph2 = 0.84, spots = [[-25.7, 0], [-24.6, 1], [-23.5, 2], [-17.5, 3], [-16.4, 4], [-12.6, 5], [-11.1, 6], [-4.2, 7]]; spots.forEach(([u, k]) => { const c = k % 4, r = k >> 2; const uv = [c * 0.25 + 0.012, 1 - (r + 1) * 0.5 + 0.02, (c + 1) * 0.25 - 0.012, 1 - r * 0.5 - 0.02]; K.plane("posters", 0xffffff, pw, ph2, u, F + 1.8, iv0 + 0.03, 0, 0, uv); }); }
    // neon on the walls
    const neonOn = (key, w, h, u, y, v, ry) => { const r = NEON.r[key]; if (!r) return; K.box("iwood", 0x1a1210, w + 0.14, h + 0.14, 0.04, u, y, v + (ry === 0 ? -0.02 : 0.02), ry, 1); K.plane("neon", 0xffffff, w, h, u, y, v + (ry === 0 ? 0.01 : -0.01), ry, 0, r); };
    neonOn("steaks", 2.4, 0.6, -19.0, F + 4.0, iv1 - 0.04, PI); neonOn("dance", 2.6, 0.65, -1.0, F + 3.9, iv1 - 0.04, PI); neonOn("bull", 2.8, 0.7, -8.0, F + 3.85, iv0 + 0.04, 0); neonOn("open", 0.9, 0.45, -16.9, F + 1.85, iv1 - 0.1, 0);
    { const r = NEON.r.logo; if (r) { K.box("iwood", 0x1a1210, 2.0, 0.55, 0.04, -9.3 + 2.4, F + 3.4, iv1 - 0.03, 0, 1); K.plane("neon", 0xffffff, 1.9, 0.48, -9.3 + 2.4, F + 3.4, iv1 - 0.06, PI, 0, r); } }
    // the cowhide in the entry
    K.place("hide", new THREE.PlaneGeometry(2.4, 1.92), 0xffffff, -11, F + 0.075, 29.6, 0.3, -PI / 2);
    // ── the steakhouse: six tables with four chairs, candle jars, a wagon-wheel chandelier over each pair ──
    for (const [u, v] of [[-21.4, 19.6], [-16.6, 19.6], [-21.4, 24.0], [-16.6, 24.0], [-21.4, 28.4], [-16.6, 28.4]]) { K.box("iwood", OAK, 1.3, 0.07, 0.95, u, F + 0.77, v, 0, 1); [[-0.55, -0.38], [0.55, -0.38], [-0.55, 0.38], [0.55, 0.38]].forEach(([a, b]) => K.box("iwood", OAKD, 0.07, 0.74, 0.07, u + a, F + 0.37, v + b, 0, 1)); solidL(u, v, 0, 1.3, 0.95, F, F + 0.8, "rodeo", { noStep: true });
      chair(K, u - 0.95, v, F, 1, 0, OAK); chair(K, u + 0.95, v, F, -1, 0, OAK); chair(K, u, v - 0.8, F, 0, 1, OAK); chair(K, u, v + 0.8, F, 0, -1, OAK); K.cyl("glass", 0xffffff, 0.05, 0.05, 0.1, u, F + 0.86, v, 8); K.sph("bulb", 0xffd9a0, 0.025, u, F + 0.86, v, 6); }
    [[-19, 21.8], [-19, 26.6]].forEach(([u, v]) => wagonWheel(K, u, v, E - 1.9, 0.85)); wagonWheel(K, -26.6, bm2, E - 1.6, 0.75); wagonWheel(K, BULL_C[0], BULL_C[1], E - 1.5, 0.8);
    // ── the mechanical bull ring: a padded mat in red and blue, a padded rail with an opening toward the room, the operator's podium ──
    { const [cu, cv] = BULL_C, Rr = 3.1; for (let k = 0; k < 12; k++) { const a0 = k / 12 * TAU, a1 = (k + 1) / 12 * TAU; const g = new THREE.CylinderGeometry(Rr, Rr, 0.26, 4, 1, false, a0, a1 - a0); K.place("iwood", g, k % 2 ? 0x2f5aa0 : 0xa8322a, cu, F + 0.18, cv); }
      solidL(cu, cv, 0, Rr * 1.6, Rr * 1.6, F, F + 0.31, "rodeo");
      for (let k = 0; k < 18; k++) { const a = k / 18 * TAU; if (Math.abs(Math.atan2(Math.sin(a - PI / 2), Math.cos(a - PI / 2))) < 0.42) continue; const a1 = a + TAU / 18; const p0 = [cu + Math.cos(a) * (Rr + 0.15), cv + Math.sin(a) * (Rr + 0.15)], p1 = [cu + Math.cos(a1) * (Rr + 0.15), cv + Math.sin(a1) * (Rr + 0.15)]; K.cyl("isteel", 0x222, 0.04, 0.04, 0.85, p0[0], F + 0.42, p0[1], 6); if (Math.abs(Math.atan2(Math.sin(a1 - PI / 2), Math.cos(a1 - PI / 2))) >= 0.42) { K.beam("iwood", 0x1d1d22, [p0[0], F + 0.82, p0[1]], [p1[0], F + 0.82, p1[1]], 0.22, 0.2); solidL((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, -Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), 0.24, F, F + 0.92, "rodeo", { noStep: true }); } }
      K.box("iwood", OAKD, 0.8, 1.05, 0.55, cu + 3.9, F + 0.52, cv + 2.6, 0.5, 1); K.box("isteel", 0x222222, 0.7, 0.06, 0.45, cu + 3.9, F + 1.06, cv + 2.6, 0.5, 1); K.box("lamp", 0xff3b2e, 0.08, 0.05, 0.08, cu + 3.8, F + 1.1, cv + 2.5, 0, 1); K.box("lamp", 0x45d06a, 0.08, 0.05, 0.08, cu + 4.0, F + 1.1, cv + 2.7, 0, 1); solidL(cu + 3.9, cv + 2.6, 0.5, 0.8, 0.55, F, F + 1.06, "rodeo", { noStep: true }); }
    // ── the stage at the north-east end: a skirted platform with two steps, the painted mural behind, band gear, a light truss ──
    { const su0 = 1.9, su1 = iu1, sv0 = 17.6, sv1 = 31.4, sh = 0.62; K.box("iwood", 0x3a2418, su1 - su0, sh, sv1 - sv0, (su0 + su1) / 2, F + sh / 2, (sv0 + sv1) / 2, 0, 1.4); K.slab("iwood", 0x6a4a32, su0, sv0, su1, sv1, F + sh + 0.005, 1.8, true);
      for (const t of [0.15, 0.85]) K.box("iwood", 0x2a1a12, 0.04, sh, 0.05, su0, F + sh / 2, lerp(sv0, sv1, t), 0, 1);
      solidL((su0 + su1) / 2, (sv0 + sv1) / 2, 0, su1 - su0, sv1 - sv0, F, F + sh, "rodeo"); K.box("iwood", 0x4a2e1e, 0.4, sh / 2, 3.2, su0 - 0.2, F + sh / 4, 24.5, 0, 1); solidL(su0 - 0.2, 24.5, 0, 0.4, 3.2, F, F + sh / 2, "rodeo");
      K.plane("mural", 0xffffff, 12.6, 5.4, iu1 - 0.05, F + sh + 3.0, 24.5, -PI / 2); K.box("iwood", 0x2a1a12, 0.04, 5.6, 12.8, iu1 + 0.0, F + sh + 3.0, 24.5, 0, 1);
      const rm = NEON.r.music; if (rm) { K.plane("neon", 0xffffff, 3.0, 0.75, iu1 - 0.08, F + 6.15, 24.5, -PI / 2, 0, rm); }
      // the band gear: drum kit, two amps, mic stands, a fiddle chair
      const sy = F + sh; K.cyl("iwood", 0xd8d0c0, 0.32, 0.32, 0.45, 4.6, sy + 0.32, 24.5, 18, false, 0, 0, PI / 2); K.cyl("iwood", 0xb8322a, 0.33, 0.33, 0.06, 4.36, sy + 0.32, 24.5, 18, false, 0, 0, PI / 2); [[4.2, 23.7, 0.18], [4.2, 25.3, 0.2], [4.6, 23.4, 0.22]].forEach(([u, v, r]) => { K.cyl("iwood", 0xb8322a, r, r, 0.22, u, sy + 0.62, v, 14); K.cyl("isteel", 0xcfcfcf, 0.015, 0.015, 0.6, u, sy + 0.3, v, 5); }); [[4.3, 22.8], [4.4, 26.3]].forEach(([u, v]) => { K.cyl("isteel", BRASS, 0.24, 0.24, 0.01, u, sy + 1.15, v, 16); K.cyl("isteel", 0xcfcfcf, 0.012, 0.012, 1.15, u, sy + 0.57, v, 5); });
      [[5.0, 20.2], [5.0, 28.8]].forEach(([u, v]) => { K.box("iwood", 0x1c1a18, 0.5, 0.75, 0.75, u, sy + 0.38, v, 0, 1); K.plane("isteel", 0x2a2a2a, 0.6, 0.55, u - 0.26, sy + 0.42, v, -PI / 2); }); [21.8, 24.5, 27.2].forEach((v) => { K.cyl("isteel", 0x1a1a1a, 0.012, 0.012, 1.55, 2.9, sy + 0.78, v, 5); K.cyl("isteel", 0x1a1a1a, 0.13, 0.15, 0.02, 2.9, sy + 0.01, v, 10); K.sph("isteel", 0x3a3a3a, 0.035, 2.9, sy + 1.58, v, 6); });
      solidL(4.6, 24.5, 0, 1.2, 3.4, sy, sy + 1.0, "rodeo", { noStep: true });
      K.box("isteel", 0x1a1a1a, 0.12, 0.12, sv1 - sv0, 2.2, F + 4.75, (sv0 + sv1) / 2, 0, 1); for (let k = 0; k < 6; k++) { const v = lerp(sv0 + 1.4, sv1 - 1.4, k / 5); K.cyl("isteel", 0x141414, 0.11, 0.13, 0.26, 2.2, F + 4.55, v, 10, false, 0, 0, 0.6); K.sph("lamp", [0xffc070, 0xff6a50, 0x6ab0ff][k % 3], 0.09, 2.3, F + 4.42, v, 8); } }
    // string lights over the dance floor (zig-zag)
    for (let k = 0; k < 5; k++) { const v = lerp(17.8, 31.0, k / 4); bulbs(K, [-3.6, E - 0.4, v], [1.6, E - 0.4, lerp(17.8, 31.0, (k + 0.5) / 4.5)], 0.45, 7); }
    // jukebox by the front wall
    { const ju = -3.0, jv = iv1 - 0.45; K.box("iwood", 0x5a2a18, 0.9, 1.35, 0.6, ju, F + 0.68, jv, 0, 1); K.cyl("iwood", 0x5a2a18, 0.45, 0.45, 0.6, ju, F + 1.36, jv, 16, false, 0, PI / 2); K.plane("bulb", 0xffb060, 0.66, 0.5, ju, F + 1.05, jv - 0.31, PI); solidL(ju, jv, 0, 0.9, 0.6, F, F + 1.6, "rodeo", { noStep: true }); EX.jukebox = [ju, jv - 0.9]; }
    // the room's light: lamp sources for the pool over the bar, the tables, the bull, the dance floor and the stage
    [lampSource(-26.6, F + 3.6, bm2, 0xffb070, 11, 18, "in"), lampSource(-19.0, F + 3.4, 24.2, 0xffbf80, 10, 17, "in"), lampSource(BULL_C[0], F + 3.6, BULL_C[1], 0xffc890, 10, 15, "in"), lampSource(-1.0, F + 3.8, 24.5, 0xffb68a, 10, 17, "in"), lampSource(4.0, F + 4.0, 24.5, 0xffa070, 8, 13, "in")].forEach((l) => { l.decay = 1.3; });
    // window glow at night (additive, inside the glass)
    const gl = (u, v, w, h, ry) => K.plane("glow", 0xffb070, w, h, u, F + 1.8, v, ry);
    [[-23, iv1 + 0.08], [-17, iv1 + 0.08], [-5.8, iv1 + 0.08], [0.4, iv1 + 0.08]].forEach(([u, v]) => gl(u, v, 3.2, 2.3, 0)); [[-27.5, iv0 - 0.08], [-14.4, iv0 - 0.08], [4, iv0 - 0.08]].forEach(([u, v]) => gl(u, v, 3.0, 2.2, PI)); gl(iu0 - 0.08, 31.3, 2.0, 2.2, -PI / 2);
  }
  function saddle(K, u, y, v) { K.box("iwood", 0x6a3a1e, 0.55, 0.16, 0.7, u, y + 0.12, v, 0, 0.6); K.box("iwood", 0x5a301a, 0.2, 0.22, 0.22, u, y + 0.3, v - 0.25, 0, 0.6); K.box("iwood", 0x4a2a16, 0.6, 0.5, 0.05, u, y - 0.12, v + 0.33, 0, 0.6); K.box("iwood", 0x4a2a16, 0.6, 0.5, 0.05, u, y - 0.12, v - 0.33, 0, 0.6); K.box("iwood", 0x7a5a3a, 0.05, 0.4, 0.05, u - 0.25, y - 0.3, v + 0.3, 0, 0.5); }

  // ───────────────────────── the stock: bulls, broncs and saddle horses from the game's models, legs animated in the vertex shader ─────────────────────────
  // one patched copy of the model's material per animal (same program for all): uLeg = the four leg angles (FL, FR, HL, HR, positive swings the
  // hoof back), uLegK = (front pivot z, hind pivot z, belly height, front / hind split z) in model space
  const AK = { bull: { sc: 0.86, zf: 0.3, zh: -1.12, belly: 0.62, split: -0.42, seat: [0, 1.82, -0.36], step: 1.25 }, horse: { sc: 0.76, zf: 0.31, zh: -1.52, belly: 1.18, split: -0.62, seat: [0, 2.14, -0.5], step: 1.55 } };
  const LEG_V = [
    "#include <begin_vertex>",
    "{ float bY = uLegK.z; float w = 1.0 - smoothstep(bY * 0.45, bY * 1.06, transformed.y);",
    "  if (w > 0.001) { float fr = step(uLegK.w, transformed.z); float sd = step(0.0, transformed.x);",
    "    float a = mix(mix(uLeg.w, uLeg.z, sd), mix(uLeg.y, uLeg.x, sd), fr) * w; float pz = mix(uLegK.y, uLegK.x, fr); float py = bY * 1.06;",
    "    float dy = transformed.y - py, dz = transformed.z - pz; float c = cos(a), s = sin(a); transformed.y = py + dy * c - dz * s; transformed.z = pz + dy * s + dz * c; } }"].join("\n");
  function legMat(kind, src) { const m = src.clone(); const K0 = AK[kind]; const U = { uLeg: { value: new THREE.Vector4() }, uLegK: { value: new THREE.Vector4(K0.zf, K0.zh, K0.belly, K0.split) } };
    m.onBeforeCompile = function (sh) { sh.uniforms.uLeg = U.uLeg; sh.uniforms.uLegK = U.uLegK; sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform vec4 uLeg; uniform vec4 uLegK;").replace("#include <begin_vertex>", LEG_V); };
    m.customProgramCacheKey = function () { return "roLeg1"; }; m.userData.roLeg = U; m.name = "ro animal " + kind; return m; }
  const STOCK = R.stock = R.stock || { list: [] };
  function makeAnimal(kind, tint) { const md = MODELS[kind]; if (!md || !md.parts) return null; const K0 = AK[kind]; const root = new THREE.Group(), piv = new THREE.Group(), body = new THREE.Group(); root.name = "ro " + kind; root.userData.noBatch = true; root.add(piv); piv.add(body); body.scale.setScalar(K0.sc);
    let U = null; for (const part of md.parts) { const mat = legMat(kind, part.material); if (tint) { mat.color = new THREE.Color(tint); } const me = new THREE.Mesh(part.geometry, mat); me.castShadow = true; me.receiveShadow = true; me.userData.noSolid = true; me.frustumCulled = true; body.add(me); U = U || mat.userData.roLeg; }
    const seat = new THREE.Object3D(); seat.position.set(K0.seat[0], K0.seat[1], K0.seat[2]); body.add(seat);
    const a = { kind, root, piv, body, seat, U, K: K0, st: "idle", ph: Math.random() * 10, t: Math.random() * 5, spd: 0, yaw: 0, u: 0, v: 0, y: 0, pitch: 0, roll: 0, hop: 0, legs: [0, 0, 0, 0], tgt: null, wait: 0 };
    scene.add(root); STOCK.list.push(a); return a; }
  function placeAnimal(a, u, v, yawLocal, yOff) { a.u = u; a.v = v; a.yawL = yawLocal; const p = l2w(u, v); a.y = (yOff !== undefined ? yOff : gy(u, v)) + S.YA; a.root.position.set(p[0], a.y, p[1]); a.root.rotation.y = yawL(yawLocal); }
  // the pose: pitch (+ nose down, about the front hooves; - nose up, about the hind ones), roll, a hop, the four legs
  function poseAnimal(a) { const K0 = a.K, k = a.pitch, sc = K0.sc; const zp = (k >= 0 ? K0.zf : K0.zh) * sc; a.piv.position.set(0, a.hop, zp); a.body.position.set(0, 0, -zp); a.piv.rotation.set(k, 0, a.roll); if (a.U) a.U.uLeg.value.set(a.legs[0], a.legs[1], a.legs[2], a.legs[3]); }
  // gaits: walk (four beat), trot (diagonal pairs), lope; amp in radians
  function gait(a, dt, speed, style) { const K0 = a.K; const f = speed / (K0.step * (style === "lope" ? 1.6 : style === "trot" ? 1.25 : 1)); a.ph += dt * f * TAU; const p = a.ph; const amp = style === "lope" ? 0.62 : style === "trot" ? 0.46 : 0.3;
    if (style === "trot") { const s = Math.sin(p) * amp; a.legs = [s, -s, -s, s]; a.hop = Math.abs(Math.sin(p)) * 0.035; a.pitch = Math.sin(p * 2) * 0.012; }
    else if (style === "lope") { a.legs = [Math.sin(p) * amp, Math.sin(p + 0.5) * amp, Math.sin(p + 2.6) * amp, Math.sin(p + 3.1) * amp]; a.hop = Math.max(0, Math.sin(p - 1.2)) * 0.12; a.pitch = Math.sin(p - 0.6) * 0.06; }
    else { a.legs = [Math.sin(p) * amp, Math.sin(p + PI) * amp, Math.sin(p + PI * 1.5) * amp, Math.sin(p + PI * 0.5) * amp]; a.hop = 0; a.pitch = Math.sin(p * 2) * 0.006; }
    a.roll = Math.sin(p) * (style === "walk" ? 0.012 : 0.02); }
  function idlePose(a, dt) { a.t += dt; a.legs[0] *= 0.9; a.legs[1] *= 0.9; a.legs[2] *= 0.9; a.legs[3] *= 0.9; a.pitch *= 0.9; a.hop *= 0.8; a.roll = Math.sin(a.t * 0.7) * 0.008; if (Math.sin(a.t * 0.37 + a.ph) > 0.985) a.legs[2] = 0.18; }
  // wander inside a box (local u0, v0, u1, v1): walk to a spot, stand a while, turn, sometimes trot
  function wander(a, dt, box) { if (a.wait > 0) { a.wait -= dt; idlePose(a, dt); poseAnimal(a); return; }
    if (!a.tgt) { a.tgt = [lerp(box[0], box[2], Math.random()), lerp(box[1], box[3], Math.random())]; a.trot = Math.random() < 0.12; }
    const du = a.tgt[0] - a.u, dv = a.tgt[1] - a.v, d = Math.hypot(du, dv); if (d < 0.35) { a.tgt = null; a.wait = 3 + Math.random() * 9; return; }
    const want = Math.atan2(du, dv) - PI / 2 + PI / 2, cur = a.yawL; let dy = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)); const turn = clamp(dy, -dt * 1.1, dt * 1.1); a.yawL += turn;
    const spd = (a.trot ? 2.4 : 0.95) * (Math.abs(dy) > 0.9 ? 0.25 : 1); const fu = Math.sin(a.yawL), fv = Math.cos(a.yawL); a.u += fu * spd * dt; a.v += fv * spd * dt; a.u = clamp(a.u, box[0], box[2]); a.v = clamp(a.v, box[1], box[3]);
    gait(a, dt, spd, a.trot ? "trot" : "walk"); const p = l2w(a.u, a.v); a.root.position.set(p[0], gy(a.u, a.v) + S.YA, p[1]); a.root.rotation.y = localYawToWorld(a.yawL); poseAnimal(a); }
  // local yaw convention for animals: yawL = 0 faces +v; the model faces +z, so the world yaw is th + yawL (+z of the group maps to (sin, cos) of the world yaw)
  function localYawToWorld(yl) { return fwdYaw(Math.sin(yl), Math.cos(yl)); }
  // a saddle and blanket on a horse (its own little mesh on the body)
  function saddleOn(a, col) { const K = new Kit(), s = a.K.seat; K.box("iwood", 0x6a3a1e, 0.5, 0.14, 0.62, 0, s[1] + 0.02, s[2], 0, 0.5); K.box("iwood", 0x5a301a, 0.16, 0.18, 0.16, 0, s[1] + 0.14, s[2] + 0.28, 0, 0.5); K.box("iwood", col || 0x8a2e22, 0.95, 0.04, 0.85, 0, s[1] - 0.05, s[2], 0, 0.5); K.box("iwood", 0x4a2a16, 0.04, 0.6, 0.3, 0.27, s[1] - 0.35, s[2], 0, 0.5); K.box("iwood", 0x4a2a16, 0.04, 0.6, 0.3, -0.27, s[1] - 0.35, s[2], 0, 0.5); K.build(a.body, { iwood: MT.iwood }, { tag: "saddle" }); }
  function buildStock() {
    if (STOCK.built) return; STOCK.built = true; if (!has("bull") || !has("horse")) { note("stock", "no bull or horse model"); return; }
    STOCK.pen = []; const Rn = rng(31337);
    (EX.pens || []).forEach((p, i) => { const box = [p[0] + 1.6, p[1] + 1.6, p[2] - 1.6, p[3] - 1.6]; const kind = p[4]; for (let k = 0; k < 2; k++) { const tint = kind === "bull" ? [0xffffff, 0xd8c8b8, 0x9a8a80, 0xffffff][(i * 2 + k) % 4] : [0xffffff, 0x8a6a50, 0xc8b098, 0x5a4a40][(i * 2 + k) % 4]; const a = makeAnimal(kind, tint); if (!a) continue; placeAnimal(a, lerp(box[0], box[2], Rn()), lerp(box[1], box[3], Rn()), Rn() * TAU); a.box = box; a.role = "pen"; STOCK.pen.push(a); } });
    // the remuda (three saddle horses) and two at the hitching rail, saddled
    if (EX.remuda) for (let k = 0; k < 3; k++) { const a = makeAnimal("horse", [0xc8a888, 0x6a4a38, 0xe8e0d0][k]); if (!a) continue; const b = EX.remuda; placeAnimal(a, lerp(b[0], b[2], Rn()), lerp(b[1], b[3], Rn()), Rn() * TAU); a.box = b; a.role = "pen"; STOCK.pen.push(a); if (k === 1) saddleOn(a, 0x2f5aa0); }
    STOCK.hitch = []; [[-26.6, 38.9, 0x8a2e22, 0x9a7a60], [-19.2, 38.9, 0x2f6a4a, 0x4a3a30]].forEach(([u, v, c, tint]) => { const a = makeAnimal("horse", tint); if (!a) return; placeAnimal(a, u, v, PI); a.role = "hitch"; saddleOn(a, c); STOCK.hitch.push(a); });
    // the show animals: a bull and a bronc, in the chutes until their ride
    STOCK.showBull = makeAnimal("bull", 0xffffff); STOCK.showBronc = makeAnimal("horse", 0x6a4a3a); [STOCK.showBull, STOCK.showBronc].forEach((a) => { if (a) { a.role = "show"; a.root.visible = false; } });
    cnt("stock", STOCK.list.length); }
  function stockFrame(dt, near) { for (const a of STOCK.list) { const vis = near && a.root.userData.show !== false; if (a.role === "show") continue; a.root.visible = vis; if (!vis) continue; if (a.role === "pen") wander(a, dt, a.box); else if (a.role === "hitch") { idlePose(a, dt); a.pitch = Math.sin(a.t * 0.4) * 0.01; poseAnimal(a); } } }

  // ───────────────────────── people: the staff with talk cards, the show crew, a few roaming cowboys and cowgirls (PLAN_ROAM) ─────────────────────────
  const ST = R.staff = R.staff || { list: [], built: false };
  const STAFF0 = {
    della: { name: "Della McCrae", role: "Owner and bartender, The Copper Chute", at: [-28.0, 25.0], face: [1, 0], floor: true, look: { skin: "e8c19a", shirt: "8a2e22", pants: "2b3a4a", hair: 5, body: "f", hairc: "6a3a1e" }, hat: "hat_cowboy", shop: "saloon", shopLabel: "Order at the bar", walk: [[-28.2, 20.4], [-28.2, 30.2]] },
    lou: { name: "Big Lou Ortega", role: "Pit master, the BBQ terrace", at: [-37.9, 27.9], face: [0, 1], floor: true, look: { skin: "a86f46", shirt: "f1ece0", pants: "1c1f24", hair: 2, body: "m" }, hat: null, shop: "saloon", shopLabel: "Get a plate of brisket" },
    tuck: { name: "Tuck Sandoval", role: "Arena director, The Copper Chute", at: [20.4, 11.7], face: [0, -1], look: { skin: "d9a877", shirt: "3a7bd5", pants: "2b3a4a", hair: 1, body: "m" }, hat: "hat_cowboy" },
    junie: { name: "Junie Pike", role: "Runs the mechanical bull", at: [-3.75, 24.35], face: [-1, -0.6], floor: true, look: { skin: "f3d9c0", shirt: "f4cd5a", pants: "2b3a4a", hair: 3, body: "f", hairc: "c8a060" }, hat: "hat_cowboy" },
    abel: { name: "Abel Quintero", role: "Wrangler, horses from the Frontier Ranch", at: [7.9, 27.4], face: [1, 0], look: { skin: "c98f63", shirt: "6d5a3e", pants: "1c1f24", hair: 0, body: "m" }, hat: "hat_cowboy" },
    hollis: { name: "Hollis Grant", role: "The voice of the arena", at: [14.6, 15.4], face: [0, -1], booth: true, look: { skin: "e8c19a", shirt: "f5f1e6", pants: "6d5a3e", hair: 4, body: "m" }, hat: "hat_cowboy" } };
  function staffY(A) { return A.booth ? L.booth.y : A.floor ? S.dS : gy(A.at[0], A.at[1]); }
  function buildStaff() { if (ST.built || typeof avatar !== "function") return; const cfgS = C("staff", {}); const ids = Object.keys(STAFF0).filter((id) => !ST.list.some((c) => c.id === "ro_" + id)); if (!ids.length) { ST.built = true; return; }
    ids.slice(0, 1).forEach((id) => { const ta = nowMs(); try { const A = Object.assign({}, STAFF0[id], cfgS[id] || {}); const w = l2w(A.at[0], A.at[1]); const g = noShadow(avatar("ro_" + id, A.name, A.look, A.hat || null, A.outfit || null)); g.position.set(w[0], S.YA + staffY(A) + 0.02, w[1]); g.rotation.y = fwdYaw(A.face[0], A.face[1]); try { g.userData.label.scale.set(1.7, 0.43, 1); } catch (e) {} scene.add(g);
      const talk = (A.talk || [{ t: A.name + ".", o: [["Thanks", null]] }]).map((q) => ({ t: q.t, o: q.o })); const c = { id: "ro_" + id, name: A.name, role: A.role, pos: [w[0], w[1]], look: A.look, hat: A.hat, outfit: null, greet: A.greet || ["Howdy."], talk, kw: [], g, rot: g.rotation.y, ro: A };
      if (!CAST.some((q) => q.id === c.id)) CAST.push(c); const hs = { x: w[0], z: w[1], r: A.booth ? 2.4 : 2.8, t: c.name, k: c.role + " · press E to talk", p: talk[0] ? talk[0].t : "", play: "npc:" + c.id, ro: "staff" }; hotspots.push(hs); (R.hs = R.hs || []).push(hs); c.hs = hs; ST.list.push(c); } catch (e) { note("staff " + id, e); } R.t.avatarMax = Math.max(R.t.avatarMax || 0, Math.round(nowMs() - ta)); });
    cnt("staff", ST.list.length); }
  function staffFrame(dt, near) { const cam = camera.position; for (const c of ST.list) { const g = c.g; const d = Math.hypot(g.position.x - cam.x, g.position.z - cam.z); g.visible = near && d < 110; if (!g.visible) continue;
      const A = c.ro; if (A.walk && d < 60) { c.wt = (c.wt || 0) - dt; if (c.wt <= 0 && !c.wto) { c.wto = A.walk[(c.wi = ((c.wi || 0) + 1) % A.walk.length)]; } if (c.wto) { const q = w2l(g.position.x, g.position.z); const du = c.wto[0] - q[0], dv = c.wto[1] - q[1], dd = Math.hypot(du, dv); if (dd < 0.15) { c.wto = null; c.wt = 4 + Math.random() * 8; g.rotation.y = fwdYaw(A.face[0], A.face[1]); try { animateWalk(g, 0, dt); } catch (e) {} } else { const sp = 1.0; const nu = q[0] + du / dd * sp * dt, nv = q[1] + dv / dd * sp * dt; const w = l2w(nu, nv); g.position.x = w[0]; g.position.z = w[1]; g.rotation.y = fwdYaw(du, dv); c.pos[0] = w[0]; c.pos[1] = w[1]; if (c.hs) { c.hs.x = w[0]; c.hs.z = w[1]; } try { animateWalk(g, sp, dt); } catch (e) {} } continue; } }
      // face a player who walks up
      const pd = Math.hypot(player.position.x - g.position.x, player.position.z - g.position.z); if (pd < 3.2 && Math.abs(player.position.y - g.position.y) < 1.4) { const want = Math.atan2(player.position.x - g.position.x, player.position.z - g.position.z); let df = Math.atan2(Math.sin(want - g.rotation.y), Math.cos(want - g.rotation.y)); g.rotation.y += clamp(df, -dt * 3, dt * 3); } else if (!c.wto) { const f0 = fwdYaw(A.face[0], A.face[1]); let df = Math.atan2(Math.sin(f0 - g.rotation.y), Math.cos(f0 - g.rotation.y)); g.rotation.y += clamp(df, -dt * 1.5, dt * 1.5); }
      if ((FRAME_N & 1) === 0 || d < 20) try { animateWalk(g, 0, (FRAME_N & 1) === 0 && d >= 20 ? dt * 2 : dt); } catch (e) {} } }
  // the order button on the bartender's and the pit master's cards (the game's own shop and coins)
  function talkHook() { try { if (typeof showTalk !== "function" || showTalk.ro) return; const s0 = showTalk; const f = function (c, idx) { const r = s0.apply(this, arguments); try { const A = c && c.ro; if (A && A.shop && typeof openShop === "function") { const box = document.getElementById("talk-o"); if (box && !box.querySelector(".ro-order")) { const b = document.createElement("button"); b.className = "btn ro-order"; b.textContent = A.shopLabel || "Order something"; b.onclick = () => { try { sfx("ui"); closeTalk(); openShop(A.shop); if (c.id === "ro_lou") stamp(C("stamps.bbq", "p_ro_bbq")); } catch (e) { note("order", e); } }; box.insertBefore(b, box.firstChild); } }
            if (c && c.id === "ro_lou" && idx === 0) stamp(C("stamps.bbq", "p_ro_bbq")); } catch (e) { note("talk hook", e); } return r; }; f.ro = true; showTalk = f; } catch (e) { note("talk wrap", e); } }
  // ───────────────────────── roaming: a PLAN_ROAM area over the grounds, the saloon and the decks ─────────────────────────
  function inSaloonL(u, v, y) { const Sa = L.saloon; return u > Sa.u0 + 0.2 && u < Sa.u1 - 0.2 && v > Sa.v0 + 0.2 && v < Sa.v1 - 0.2 && y > S.dS - 0.6 && y < S.dS + 7.5; }
  function inSaloonW(x, y, z) { const q = w2l(x, z); return inSaloonL(q[0], q[1], y - S.YA); }
  R.inSaloonW = inSaloonW;
  function roamArea() {
    const RO = window.PLAN_ROAM; if (!RO || !RO.area || RO.off || R.roamArea) return; const RC = C("roam", {});
    const Pw = (u, v, kind, line, fu, fv, tag, dur, extra) => { const w = l2w(u, v); return Object.assign({ kind, line, x: w[0], z: w[1], face: fwdYaw(fu, fv), tag, dur }, extra || {}); };
    const corners = [[-50, -40], [46, -40], [46, 40], [-50, 40]].map((q) => l2w(q[0], q[1])); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; corners.forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); });
    const def = { id: "rodeo", max: 6, box: [x0, z0, x1, z1], perCat: true, pull: 3, people: (RC.people || ["Cody", "Rae", "Dalton", "Lupita", "Jessa", "Boone", "Tilly", "Rico"]).map((n) => (typeof n === "string" ? { name: n } : n)), lines: RC.lines || {},
      ready: () => !!R.ready,
      levels: [{ base: (x, z) => planGroundAt(x, z), exact: false, block: (x, z) => { const q = w2l(x, z), u = q[0], v = q[1]; if (!inPoly(FOOT, u, v)) return true; if (arenaSD(u, v, 0) < 0.5) return true; if (inRect(u, v, L.pens, 0.4) || inRect(u, v, L.remuda, 0.3) || inRect(u, v, L.alley, 0.2) || inRect(u, v, L.lead, 0.2)) return true;
        if (u > L.chutes.u0 - 0.4 && u < L.chutes.u0 + L.chutes.n * L.chutes.w + 0.4 && v > L.chutes.v0 - 0.2 && v < L.catwalk.v1 + 0.2) return true; if (u > -29.8 && u < -25.4 && v > 18.8 && v < 31.4) return true; if (u > 1.7 && u < 6 && v > 17.4 && v < 31.6) return true; if (Math.hypot(u - BULL_C[0], v - BULL_C[1]) < 3.4) return true; return false; } }],
      entries: () => [Pw(-11, 39.4, "door"), Pw(-38.2, 39.6, "door"), Pw(-31.5, -33.5, "door"), Pw(-24, -38.6, "door")],
      seeds: () => def.entries().concat([Pw(-11, 30, "seed"), Pw(-12, 13, "seed"), Pw(-31, -10, "seed"), Pw(-38, 20, "seed"), Pw(-5, -31.6, "seed")]),
      pois: () => { const out = [];
        // the rail of the arena (lean and watch), the pens, the remuda, the smoker line, the stage, the posters, the porch, the concourse
        [[-14, -21.6, 0, 1], [-4, -21.6, 0, 1], [8, -21.6, 0, 1], [-27.6, -12, 1, 0], [-27.6, 0, 1, 0], [-20, 8.0, 0, -1], [-8, 8.0, 0, -1], [3, 8.0, 0, -1]].forEach(([u, v, fu, fv], i) => out.push(Pw(u, v, "look", "arena", fu, fv, "rail" + i, [14, 30])));
        [[23.3, 18, 1, 0], [23.3, 28, 1, 0], [33, 35.0, 0, -1], [8.0, 23, 1, 0]].forEach(([u, v, fu, fv], i) => out.push(Pw(u, v, "look", "stock", fu, fv, "pen" + i, [10, 20])));
        out.push(Pw(-38.0, 26.4, "look", "bbq", 0, 1, "smoker", [10, 18])); out.push(Pw(-36.6, 25.9, "look", "bbq", 0.3, 1, "smoker", [10, 18]));
        out.push(Pw(-0.5, 24.5, "look", "stage", 1, 0, "stage", [16, 30])); out.push(Pw(-1.8, 21.0, "look", "stage", 1, 0.2, "stage", [16, 30]));
        out.push(Pw(-24.6, 17.2, "look", "saloon", 0, -1, "posters", [8, 14])); out.push(Pw(-14.05, 31.9, "look", "saloon", 0, 1, "wanted", [8, 14])); out.push(Pw(-3.0, 31.4, "look", "saloon", 0, 1, "jukebox", [8, 14]));
        out.push(Pw(-6.0, 26.2, "look", "bull", -0.6, -1, "bullring", [12, 24])); out.push(Pw(-11.4, 25.6, "look", "bull", 0.5, -1, "bullring", [12, 24]));
        [[-15, 35.0, 1, 0], [-7, 35.0, -1, 0]].forEach(([u, v, fu, fv], i) => out.push(Pw(u, v, "chat", "porch", fu, fv, "porch" + i, [14, 28])));
        [[-12, -31.6, 1, 0], [6, -31.6, -1, 0]].forEach(([u, v, fu, fv], i) => out.push(Pw(u, v, "chat", "concourse", fu, fv, "conc" + i, [14, 28])));
        for (let k = 0; k < 6; k++) out.push(Pw(-2.6 + (k % 3) * 1.7, 20.5 + Math.floor(k / 3) * 5.5, "dance", "dance", 1, 0, "dance" + k, [20, 40]));
        return out; },
      seatInfo: (s) => { if (s.tag !== "rodeo" || !s.seat) return null; const q = w2l(s.x, s.z), u = q[0], v = q[1]; if (v < -20) return { kind: "sit", line: "stands", tag: "stands" }; if (v < 16 && v > 10) return { kind: "sit", line: "deck", tag: "deck" }; if (u < -30) return { kind: "sit", line: "bbq", tag: "picnic" }; if (u > -26 && u < -24.5) return { kind: "sit", line: "bar", tag: "bar" }; if (v > 33) return { kind: "sit", line: "porch", tag: "porch" }; return { kind: "sit", line: "saloon", tag: "dining" }; },
      weight: (p, h) => { const t = p.tag || "", show = SHOW.live, eve = h >= 17.5 && h < 23.5, late = h >= 21 || h < 2; if (t === "stands") return show ? 3.0 : eve ? 0.8 : 0.25; if (t === "deck") return show ? 2.2 : 1.0; if (t.indexOf("rail") === 0) return show ? 1.6 : 0.6; if (t.indexOf("dance") === 0) return late ? 2.2 : eve ? 0.8 : 0.05; if (t === "bar") return late ? 2.0 : 1.0; if (t === "picnic" || t === "smoker") return h > 11 && h < 20 ? 1.6 : 0.3; if (t.indexOf("pen") === 0) return h > 8 && h < 18 ? 1.2 : 0.3; if (t === "stage") return late ? 1.4 : 0.3; return 0.8; },
      count: (h) => (h < 7 ? 2 : h < 11 ? 3 : h < 17 ? 5 : h < 23 ? 6 : 4),
      dur: { sit: [30, 70], chat: [14, 30], look: [10, 24], dance: [20, 40] },
      visible: () => !R.abOff,
      sameZone: (c) => { const p = c.g.position, cp = camera.position; return inSaloonW(p.x, p.y + 1, p.z) === inSaloonW(cp.x, cp.y, cp.z); } };
    R.roamArea = RO.area(def); cnt("roam"); }

  // ───────────────────────── the show: bull riding and saddle bronc on a schedule (an afternoon slack, Rodeo Night every evening) ─────────────────────────
  const SHOW = R.show = R.show || { live: false, ph: "off", t: 0, idx: 0, rides: 0, crew: null, gap: 0 };
  function sched(h) { if (SHOW.force) return { on: true, kind: "night", gap: 5 }; const S0 = C("schedule", { slack: [14, 16], night: [18.5, 22.5] }); if (h >= S0.night[0] && h < S0.night[1]) return { on: true, kind: "night", gap: 6 }; if (h >= S0.slack[0] && h < S0.slack[1]) return { on: true, kind: "slack", gap: 14 }; return { on: false }; }
  const RIDERS0 = { bull: [["Wade Calloway", "Copper Kettle"], ["Jace Romero", "Smelter"], ["Kenzie Dawes", "Dust Devil"], ["Colt Begay", "Haboob"], ["Rafael Soto", "Mesquite Thunder"], ["Ty Harlan", "Slag Heap"]], bronc: [["Lane Archer", "Sundown"], ["Sadie Holt", "Border Ghost"], ["Eli Whitfield", "Prickly Pete"], ["Mara Quinn", "Ridge Runner"]] };
  // the riders' and bullfighters' rigs (the client's people), made once near the arena
  // the riders and bullfighters: made one at a time (a rig a third of a second apart), after the staff
  const CREW0 = [["rider1", { skin: "d9a877", shirt: "c8402a", pants: "2b3a4a", hair: 1, body: "m" }, "hat_cowboy"], ["rider2", { skin: "f3d9c0", shirt: "f5f1e6", pants: "1c1f24", hair: 6, body: "f", hairc: "6a3a1e" }, "hat_cowboy"], ["bf1", { skin: "a86f46", shirt: "f2b134", pants: "c8402a", hair: 2, body: "m" }, "hat_cap"], ["bf2", { skin: "e8c19a", shirt: "3a7bd5", pants: "f4cd5a", hair: 4, body: "m" }, "hat_cap"]];
  function crew() { if (SHOW.crew) return SHOW.crew; if (typeof avatar !== "function" || !ST.built) return null; if (nowMs() < (SHOW.cwAt || 0)) return null; SHOW.cwAt = nowMs() + 330; SHOW.cw = SHOW.cw || [];
    if (SHOW.cw.length < CREW0.length) { const q = CREW0[SHOW.cw.length]; const g = noShadow(avatar("ro_" + q[0], "", q[1], q[2], null)); try { g.userData.label.visible = false; } catch (e) {} g.visible = false; scene.add(g); SHOW.cw.push(g); return null; }
    SHOW.crew = { rider: [SHOW.cw[0], SHOW.cw[1]], fight: [SHOW.cw[2], SHOW.cw[3]] }; SHOW.crew.rider.forEach((g) => { try { if (g.userData.blob) g.userData.blob.visible = false; } catch (e) {} }); cnt("crew"); return SHOW.crew; }
  // announcer lines (the voice in the booth, heard within 130 m) and the sound of the arena
  function announce(text) { try { const c = ST.list.find((q) => q.id === "ro_hollis"); if (!c || !text) return; const d = Math.hypot(camera.position.x - c.g.position.x, camera.position.z - c.g.position.z); if (d > 130) return; npcSay(c, text); } catch (e) { note("announce", e); } }
  function arenaVol(u, v) { try { if (!soundOn || !audioReady) return 0; const p = l2w(u, v), d = Math.hypot(camera.position.x - p[0], camera.position.z - p[1]); if (d > 160) return 0; return Math.pow(1 - d / 160, 1.4) * VOL.sfx * VOL.master; } catch (e) { return 0; } }
  function shaped(dur, vol, type, f0, q, att, dec) { try { const c = actx(), n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0); let p = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; p = p * 0.86 + w * 0.14; d[i] = type === "pink" ? p * 3 : w; }
      const src = c.createBufferSource(); src.buffer = b; const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = f0; f.Q.value = q; const g = c.createGain(); const t = c.currentTime; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * (dec || 1)); src.connect(f).connect(g).connect(c.destination); src.start(); } catch (e) {} }
  function osc(f, dur, type, vol, f2) { try { const c = actx(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime; o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.linearRampToValueAtTime(f2, t + dur); g.gain.setValueAtTime(Math.max(0.0001, vol), t); g.gain.setValueAtTime(Math.max(0.0001, vol), t + dur * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g).connect(c.destination); o.start(); o.stop(t + dur + 0.05); } catch (e) {} }
  function cue(kind, u, v) { const k = arenaVol(u, v); if (k <= 0.002) return;
    if (kind === "gate") { shaped(0.35, 0.5 * k, "white", 1400, 0.8, 0.005, 1); osc(110, 0.22, "square", 0.08 * k); setTimeout(() => shaped(0.25, 0.25 * k, "white", 2200, 2, 0.004, 1), 90); }
    else if (kind === "buzzer") { osc(196, 1.1, "sawtooth", 0.11 * k); osc(247, 1.1, "square", 0.05 * k); }
    else if (kind === "cheer") { shaped(3.2, 0.42 * k, "pink", 950, 0.6, 0.35, 1); setTimeout(() => shaped(2.4, 0.3 * k, "pink", 1600, 0.9, 0.3, 1), 220); for (let i = 0; i < 5; i++) setTimeout(() => osc(1800 + Math.random() * 900, 0.18, "sine", 0.03 * k, 2600 + Math.random() * 600), 300 + i * 260 + Math.random() * 200); }
    else if (kind === "ooh") { shaped(1.6, 0.32 * k, "pink", 520, 0.7, 0.12, 1); }
    else if (kind === "hoof") { shaped(0.12, 0.25 * k, "white", 180, 1.2, 0.004, 1); } }
  // the rider's pose on the animal: the client's sit clip with the free arm up, legs out round the barrel (offsets on the bones after the mixer)
  R.rp = R.rp || { arm: [0, 0, -2.2], fore: [0, 0, -0.4], tl: [0, 0, 0.55], tr: [0, 0, -0.55], sl: [0.5, 0, 0], sr: [0.5, 0, 0], sp: [0, 0, 0], hold: [0, 0, 0.6], holdF: [0, 0, 0] };
  const _qa = new THREE.Quaternion(), _ea = new THREE.Euler();
  function boneOff(b, e, k) { if (!b || !e) return; _ea.set(e[0] * k, e[1] * k, e[2] * k, "XYZ"); _qa.setFromEuler(_ea); b.quaternion.multiply(_qa); }
  function riderPose(g, k, wave) { const b = g.userData.legBones; if (!b) return; const P = R.rp; boneOff(b.ra, P.arm, 1); boneOff(b.ra, [0, 0, Math.sin(wave) * 0.35], 1); boneOff(b.rf, P.fore, 1); boneOff(b.la, P.hold, 1); boneOff(b.lf, P.holdF, 1); boneOff(b.lt, P.tl, 1); boneOff(b.rt, P.tr, 1); boneOff(b.ls, P.sl, 1); boneOff(b.rs, P.sr, 1); boneOff(b.sp, [k * 0.5, 0, 0], 1); }
  function mixerTick(g, dt) { const u = g.userData; const t0 = u.mixer ? u.mixer.time : 0; try { animateWalk(g, u.spd || 0, dt); } catch (e) {} return u.mixer && u.mixer.time !== t0; }
  // where things are in the arena (local)
  const chuteMid = (i) => [L.chutes.u0 + (i + 0.5) * L.chutes.w, (L.chutes.v0 + L.chutes.v1) / 2];
  function newRide() { const nb = SHOW.idx % 3 === 2 ? "bronc" : "bull"; const list = C("riders." + nb, RIDERS0[nb]); const pick = list[(SHOW.idx * 5 + (Math.floor(Date.now() / 86400000) % 7)) % list.length]; const q = Math.random() < 0.55;
    return { kind: nb, chute: SHOW.idx % L.chutes.n, rider: pick[0], animal: pick[1], qualify: q, throwAt: q ? 99 : 2.2 + Math.random() * 4.6, score: q ? (78 + Math.round(Math.random() * 40) / 4) : 0, spin: (Math.random() < 0.5 ? 1 : -1) * (nb === "bull" ? 2.0 + Math.random() * 0.8 : 0.3), seed: Math.random() * 10 }; }
  function showFrame(dt, h, near) {
    const sc = sched(h); if (!near && !SHOW.live && SHOW.ph === "off") return; const C0 = crew(); if (!C0 || !STOCK.showBull) return;
    const wasLive = SHOW.live; SHOW.live = sc.on && near; if (!SHOW.live) { if (wasLive || SHOW.ph !== "off") resetShow(); SHOW.ph = "off"; setBoard(null); return; }
    SHOW.t += dt; const Rd = SHOW.ride;
    if (SHOW.ph === "off" || SHOW.ph === "wait") { if (SHOW.ph === "off") { SHOW.ph = "wait"; SHOW.t = sc.gap - 2; } if (SHOW.t >= sc.gap) startRide(); idleCrew(dt); return; }
    const a = Rd.kind === "bull" ? STOCK.showBull : STOCK.showBronc, rg = C0.rider[Rd.kind === "bull" ? 0 : 1];
    if (SHOW.ph === "prep") { inChute(a, Rd, dt); seatRider(rg, a, 0, dt, false); crewTo(dt, Rd, a); const T = SHOW.t;
      if (T > 0.8 && !Rd.said1) { Rd.said1 = true; announce(fill(C("lines.out", ["Out of chute {n}, {rider} on {animal}!", "Chute {n}: {rider}, and {animal} is not in a good mood tonight!", "{rider} nods for {animal} in chute {n}. Here we go!"]), Rd)); setBoard({ ev: Rd.kind === "bull" ? "BULL RIDING" : "SADDLE BRONC", l1: Rd.rider.toUpperCase(), l2: (Rd.kind === "bull" ? "ON " : "ON ") + Rd.animal.toUpperCase(), big: "CHUTE " + (Rd.chute + 1), col: "#ffd34a" }); }
      if (T > 6.0) { SHOW.ph = "ride"; SHOW.t = 0; Rd.rt = 0; cue("gate", chuteMid(Rd.chute)[0], 5); cue("cheer", 0, -6); Rd.gate = 0; } return; }
    if (SHOW.ph === "ride") { Rd.rt += dt; gateAnim(Rd, dt, 1); buck(a, Rd, dt); const kick = a.pitch;
      if (Rd.rt < Rd.throwAt && Rd.rt < 8) { seatRider(rg, a, kick, dt, true); setBoard({ ev: Rd.kind === "bull" ? "BULL RIDING" : "SADDLE BRONC", l1: Rd.rider.toUpperCase(), l2: "ON " + Rd.animal.toUpperCase(), big: Rd.rt.toFixed(1), col: "#ff5a28" }); }
      else if (!Rd.off) { Rd.off = true; launchRider(rg, a, Rd.rt >= 8); if (Rd.rt >= 8) { cue("buzzer", chuteMid(Rd.chute)[0], -2); setTimeout(() => cue("cheer", 0, -6), 300); } else { cue("ooh", 0, -6); } }
      if (Rd.off) freeRider(rg, dt); crewTo(dt, Rd, a);
      if (Rd.off && Rd.rt > Math.min(Rd.throwAt, 8) + 2.6 && Rd.rt > 4) { SHOW.ph = "after"; SHOW.t = 0; Rd.done = Rd.rt; setBoard({ ev: Rd.kind === "bull" ? "BULL RIDING" : "SADDLE BRONC", l1: Rd.rider.toUpperCase(), l2: Rd.qualify ? "EIGHT SECONDS" : "BUCKED OFF AT " + Math.min(Rd.throwAt, 8).toFixed(1), big: Rd.qualify ? Rd.score.toFixed(1) + " POINTS" : "NO SCORE", col: Rd.qualify ? "#5fff8a" : "#ff5a28" });
        announce(fill(Rd.qualify ? C("lines.score", ["That's the whistle! {score} points for {rider}!", "{rider} rides {animal} to the horn: {score}!", "Eight seconds! The judges give {rider} {score}!"]) : C("lines.thrown", ["{animal} wins that round. Give {rider} a hand, folks, that's all she gets.", "Down goes {rider}! The bullfighters earn their pay tonight.", "{animal} sends {rider} into the dirt. No time!"]), Rd)); stampShow(); } return; }
    if (SHOW.ph === "after") { gateAnim(Rd, dt, 0); freeRider(rg, dt); const out = exitAnimal(a, Rd, dt); crewTo(dt, Rd, a); if (out && SHOW.t > 9) { endRide(); } return; } }
  function fill(list, Rd) { const s = Array.isArray(list) ? list[Math.floor(Math.random() * list.length)] : String(list || ""); return s.replace(/\{n\}/g, String(Rd.chute + 1)).replace(/\{rider\}/g, Rd.rider).replace(/\{animal\}/g, Rd.animal).replace(/\{score\}/g, Rd.score.toFixed(1)); }
  function startRide() { SHOW.ride = newRide(); SHOW.idx++; SHOW.ph = "prep"; SHOW.t = 0; const Rd = SHOW.ride; const a = Rd.kind === "bull" ? STOCK.showBull : STOCK.showBronc; const m = chuteMid(Rd.chute); placeAnimal(a, m[0], m[1] - 0.2, PI, 0.03); a.root.visible = true; a.st = "chute"; a.pitch = 0; a.hop = 0; a.roll = 0; a.legs = [0, 0, 0, 0]; poseAnimal(a);
    const rg = SHOW.crew.rider[Rd.kind === "bull" ? 0 : 1]; rg.visible = true; rg.userData.sit = true; rg.userData.spd = 0; try { sitOffset(rg, 0.05); } catch (e) {} Rd.rs = "on"; cnt("rides"); }
  function endRide() { const Rd = SHOW.ride; if (Rd) { const a = Rd.kind === "bull" ? STOCK.showBull : STOCK.showBronc; a.root.visible = false; const rg = SHOW.crew.rider[Rd.kind === "bull" ? 0 : 1]; rg.visible = false; rg.rotation.set(0, 0, 0); rg.userData.sit = false; try { sitClear(rg); } catch (e) {} } SHOW.ride = null; SHOW.ph = "wait"; SHOW.t = 0; EX.chuteGates.forEach((g) => { g.rotation.y = PI; }); if (EX.anim.outGate) EX.anim.outGate.rotation.y = -PI / 2; }
  function resetShow() { try { endRide(); } catch (e) {} if (SHOW.crew) { SHOW.crew.fight.forEach((g) => { g.visible = false; }); } SHOW.live = false; SHOW.ph = "off"; }
  function gateAnim(Rd, dt, open) { const g = EX.chuteGates[Rd.chute]; if (!g) return; const want = open ? PI / 2 - 0.15 : PI; g.rotation.y += clamp(want - g.rotation.y, -dt * 5, dt * 5); }
  function inChute(a, Rd, dt) { a.t += dt; a.pitch = Math.sin(a.t * 3.1) * 0.025; a.roll = Math.sin(a.t * 2.3) * 0.02; a.legs = [Math.sin(a.t * 5) * 0.05, 0, 0, Math.sin(a.t * 4) * 0.06]; const m = chuteMid(Rd.chute); placeAnimal(a, m[0] + Math.sin(a.t * 1.7) * 0.05, m[1] - 0.2, PI + Math.sin(a.t * 0.9) * 0.05, 0.03); poseAnimal(a); }
  const bump = (x, a, b) => (x > a && x < b ? Math.sin(PI * (x - a) / (b - a)) : 0);
  function buck(a, Rd, dt) { const bull = a.kind === "bull", T = bull ? 0.82 : 0.72, t = Rd.rt; if (t < 0.85) { const m = chuteMid(Rd.chute); a.u = m[0] + (Rd.seed % 1 - 0.5) * 2 * t; a.v = lerp(m[1] - 0.2, m[1] - 5.6, t / 0.85); a.yawL = PI; gait(a, dt, 6.5, "lope"); }
    else { const ph = ((t - 0.85) / T) % 1; const Ar = bull ? 0.3 : 0.46, Ak = bull ? 0.42 : 0.52; a.pitch = -Ar * bump(ph, 0, 0.32) + Ak * bump(ph, 0.4, 0.84); a.hop = (bull ? 0.42 : 0.62) * bump(ph, 0.22, 0.62); a.roll = Math.sin(TAU * ph + Rd.seed) * (bull ? 0.14 : 0.08);
      a.legs = [-0.7 * bump(ph, 0, 0.34) + 0.2 * bump(ph, 0.5, 0.9), -0.62 * bump(ph, 0.02, 0.36) + 0.2 * bump(ph, 0.5, 0.9), 0.95 * bump(ph, 0.42, 0.86) - 0.2 * bump(ph, 0, 0.3), 0.9 * bump(ph, 0.44, 0.88) - 0.2 * bump(ph, 0, 0.3)];
      const spin = Rd.spin * (Math.floor((t - 0.85) / (T * 3)) % 2 ? -1 : 1) * (bull ? 1 : 0.4); a.yawL += spin * dt * (0.4 + bump(ph, 0.2, 0.7)); const step = (bull ? 0.9 : 1.5) / T;
      a.u += Math.sin(a.yawL) * step * dt * bump(ph, 0.2, 0.7) * 1.6; a.v += Math.cos(a.yawL) * step * dt * bump(ph, 0.2, 0.7) * 1.6;
      const sd = arenaSD(a.u, a.v, 0); if (sd > -6.5) { const cu = (L.arena.u0 + L.arena.u1) / 2 + 4, cv = (L.arena.v0 + L.arena.v1) / 2; const want = Math.atan2(cu - a.u, cv - a.v); let df = Math.atan2(Math.sin(want - a.yawL), Math.cos(want - a.yawL)); a.yawL += clamp(df, -dt * 3, dt * 3); }
      if (bump(ph, 0.6, 0.66) > 0.9 && !a.thud) { a.thud = true; cue("hoof", a.u, a.v); dustAt(a.u, a.v, 2); } if (ph < 0.5) a.thud = false; }
    const sd2 = arenaSD(a.u, a.v, 0); if (sd2 > -1.2) { const cu = (L.arena.u0 + L.arena.u1) / 2, cv = (L.arena.v0 + L.arena.v1) / 2, d = Math.hypot(a.u - cu, a.v - cv) || 1; a.u -= (a.u - cu) / d * (sd2 + 1.2); a.v -= (a.v - cv) / d * (sd2 + 1.2); }
    const p = l2w(a.u, a.v); a.root.position.set(p[0], S.YA + 0.06, p[1]); a.root.rotation.y = localYawToWorld(a.yawL); poseAnimal(a); }
  // after the ride: a few more bucks, then a trot to the out gate, through it into the return alley, up the alley to the pens
  function exitAnimal(a, Rd, dt) { const T = SHOW.t; if (T < 2.2) { Rd.rt += dt; buck(a, Rd, dt); return false; }
    if (!Rd.path) Rd.path = [[L.gateOut.u - 2.4, (L.gateOut.v0 + L.gateOut.v1) / 2], [L.gateOut.u + 1.3, (L.gateOut.v0 + L.gateOut.v1) / 2], [(L.alley.u0 + L.alley.u1) / 2, (L.gateOut.v0 + L.gateOut.v1) / 2 + 1.5], [(L.alley.u0 + L.alley.u1) / 2, 14]];
    const og = EX.anim.outGate; if (og) og.rotation.y += clamp(0 - og.rotation.y, -dt * 2.5, dt * 2.5);
    const tg = Rd.path[0]; if (!tg) { a.root.visible = false; return true; } const du = tg[0] - a.u, dv = tg[1] - a.v, d = Math.hypot(du, dv); if (d < 0.6) { Rd.path.shift(); return false; }
    const want = Math.atan2(du, dv); let df = Math.atan2(Math.sin(want - a.yawL), Math.cos(want - a.yawL)); a.yawL += clamp(df, -dt * 2.5, dt * 2.5); const sp = Math.abs(df) > 1 ? 1.2 : 3.4; a.u += Math.sin(a.yawL) * sp * dt; a.v += Math.cos(a.yawL) * sp * dt;
    gait(a, dt, sp, "trot"); const p = l2w(a.u, a.v); a.root.position.set(p[0], S.YA + gy(a.u, a.v) + 0.04, p[1]); a.root.rotation.y = localYawToWorld(a.yawL); poseAnimal(a); return false; }
  // the rider: on the animal (seat), thrown or off, then up and walking back to the chutes
  const _sp = new THREE.Vector3(), _sq = new THREE.Quaternion(), _lq = new THREE.Quaternion(), _le = new THREE.Euler();
  function seatRider(g, a, kick, dt, riding) { a.root.updateMatrixWorld(true); a.seat.getWorldPosition(_sp); a.seat.getWorldQuaternion(_sq); _le.set(-kick * 0.55 + (riding ? -0.08 : 0), 0, -a.roll * 0.4, "XYZ"); _lq.setFromEuler(_le); g.position.copy(_sp); g.quaternion.copy(_sq).multiply(_lq); g.userData.sit = true; g.userData.spd = 0;
    const up = mixerTick(g, dt); if (up) riderPose(g, kick, (SHOW.ride ? SHOW.ride.rt || 0 : 0) * 7); }
  function launchRider(g, a, clean) { const Rd = SHOW.ride; const side = Math.random() < 0.5 ? -1 : 1, yw = a.yawL; const fu = Math.sin(yw), fv = Math.cos(yw), ru = fv * side, rv = -fu * side;
    Rd.fr = { u: a.u, v: a.v, y: g.position.y - S.YA, vu: ru * (clean ? 2.4 : 3.4) + fu * 1.2, vv: rv * (clean ? 2.4 : 3.4) + fv * 1.2, vy: clean ? 3.0 : 4.6, rx: 0, rz: 0, wx: clean ? 0 : 3.6, wz: clean ? 0 : 5.0 * side, st: "air", t: 0, yaw: g.rotation.y }; g.userData.sit = false; try { sitClear(g); } catch (e) {} }
  function freeRider(g, dt) { const Rd = SHOW.ride, F0 = Rd && Rd.fr; if (!F0) return; F0.t += dt; const ground = 0.08;
    if (F0.st === "air") { F0.vy -= 9.8 * dt; F0.u += F0.vu * dt; F0.v += F0.vv * dt; F0.y += F0.vy * dt; F0.rx += F0.wx * dt; F0.rz += F0.wz * dt; if (F0.y <= ground && F0.vy < 0) { F0.y = ground; F0.st = Rd.qualify ? "up" : "down"; F0.t = 0; dustAt(F0.u, F0.v, 3); cue("hoof", F0.u, F0.v); } }
    else if (F0.st === "down") { F0.rx = lerp(F0.rx, -PI / 2, Math.min(1, dt * 8)); F0.rz = lerp(F0.rz, 0, Math.min(1, dt * 8)); if (F0.t > 1.5) { F0.st = "up"; F0.t = 0; } }
    else if (F0.st === "up") { F0.rx = lerp(F0.rx, 0, Math.min(1, dt * 6)); F0.rz = lerp(F0.rz, 0, Math.min(1, dt * 6)); const tg = [chuteMid(0)[0] - 1.2, L.arena.v1 - 1.0]; const du = tg[0] - F0.u, dv = tg[1] - F0.v, d = Math.hypot(du, dv); if (F0.t > 0.6 && d > 0.4) { const sp = F0.t < 3 ? 3.6 : 2.2; F0.u += du / d * sp * dt; F0.v += dv / d * sp * dt; F0.yaw = fwdYaw(du, dv); g.userData.spd = sp; } else g.userData.spd = 0; if (d <= 0.4 && F0.t > 2) g.visible = false; }
    const p = l2w(F0.u, F0.v); g.position.set(p[0], S.YA + F0.y, p[1]); _le.set(F0.rx, F0.yaw, F0.rz, "YXZ"); g.quaternion.setFromEuler(_le); mixerTick(g, dt); }
  // the bullfighters: by the chute gates before a ride, then working the animal (always a few metres off it), back after
  function crewTo(dt, Rd, a) { const C0 = SHOW.crew; C0.fight.forEach((g, i) => { g.visible = true; const q = w2l(g.position.x, g.position.z); let tu, tv; const m = chuteMid(Rd.chute);
      if (SHOW.ph === "prep" || !a.root.visible) { tu = m[0] + (i ? 3.4 : -3.4); tv = L.arena.v1 - 3.2; }
      else { const side = i ? 1 : -1; const ang = (Rd.seed + SHOW.t * 0.6) * (i ? 1 : -1); tu = a.u + Math.cos(ang) * 5.5 * side; tv = a.v + Math.sin(ang) * 4.5; const sd = arenaSD(tu, tv, 0); if (sd > -2) { tu = lerp(tu, -2, 0.4); tv = lerp(tv, -6.5, 0.4); } if (SHOW.ph === "after" && SHOW.t > 2.5) { tu = m[0] + (i ? 4 : -4); tv = L.arena.v1 - 3.5; } }
      const du = tu - q[0], dv = tv - q[1], d = Math.hypot(du, dv); const sp = d > 0.5 ? Math.min(4.8, d * 2) : 0; if (sp > 0) { q[0] += du / d * sp * dt; q[1] += dv / d * sp * dt; g.rotation.y = fwdYaw(du, dv); } else if (a.root.visible) g.rotation.y = fwdYaw(a.u - q[0], a.v - q[1]);
      const p = l2w(q[0], q[1]); g.position.set(p[0], S.YA + 0.08, p[1]); g.userData.spd = sp; mixerTick(g, dt); }); }
  function idleCrew(dt) { const C0 = SHOW.crew; if (!C0) return; C0.fight.forEach((g, i) => { if (!g.visible) { const m = chuteMid(1 + i); const p = l2w(m[0] + (i ? 2 : -2), L.arena.v1 - 3); g.position.set(p[0], S.YA + 0.08, p[1]); g.visible = true; } g.userData.spd = 0; g.rotation.y = fwdYaw(0, -1); mixerTick(g, dt); }); }
  // dust: a few soft puffs kicked up where hooves land (sprites, recycled)
  const DUST = R.dust = R.dust || { list: [], i: 0 };
  function dustAt(u, v, n) { if (!MT.dust) return; for (let k = 0; k < n; k++) { let s = DUST.list[DUST.i % 10]; if (!s) { s = new THREE.Sprite(MT.dust); s.userData.noSolid = true; scene.add(s); DUST.list.push(s); } DUST.i++; const p = l2w(u + (Math.random() - 0.5) * 1.2, v + (Math.random() - 0.5) * 1.2); s.position.set(p[0], S.YA + 0.3, p[1]); s.userData.t = 0; s.userData.vy = 0.3 + Math.random() * 0.3; s.scale.setScalar(0.8); s.visible = true; } }
  function dustFrame(dt) { for (const s of DUST.list) { if (!s.visible) continue; s.userData.t += dt; const t = s.userData.t; s.position.y += s.userData.vy * dt; s.scale.setScalar(0.8 + t * 1.3); if (t > 1.4) s.visible = false; } }
  function stampShow() { try { const p = player.position, q = w2l(p.x, p.z), u = q[0], v = q[1]; const seated = typeof SIT !== "undefined" && SIT.on; const inStands = v < -20 && v > -28 && u > L.stand.u0 - 1 && u < L.stand.u1 + 1; const onDeck = v > 10 && v < 16.5 && u > -46 && u < 7; const onCat = u > L.catwalk.u0 - 0.5 && u < L.catwalk.u1 + 1.5 && v > L.catwalk.v0 - 0.3 && v < L.catwalk.v1 + 1.5;
      if ((inStands || onDeck) && seated) stamp(C("stamps.stands", "p_ro_stands")); if (onCat) stamp(C("stamps.chutes", "p_ro_chutes")); } catch (e) {} }

  // ───────────────────────── the mechanical bull: a padded bull on a hydraulic head in its ring; E to ride, A and D (or the arrows) and SPACE to stay on ─────────────────────────
  const MB = R.mb = R.mb || { on: false, best: 0 };
  try { MB.best = +(localStorage.getItem("g1:ro_mbull") || 0) || 0; } catch (e) {}
  function buildMBull(G) { const [cu, cv] = BULL_C, F = S.dS; const root = new THREE.Group(); root.name = "ro mech bull"; root.userData.noBatch = true; root.position.set(cu, F + 0.31, cv); G.add(root);
    const K = new Kit(); K.cyl("isteel", 0x262626, 0.72, 0.78, 0.14, 0, 0.07, 0, 22); K.cyl("isteel", 0xa8a8a8, 0.15, 0.17, 0.62, 0, 0.45, 0, 14); for (let k = 0; k < 5; k++) K.place("isteel", new THREE.TorusGeometry(0.2, 0.035, 6, 16), 0x1a1a1a, 0, 0.22 + k * 0.1, 0, 0, PI / 2); K.build(root, { isteel: MT.isteel }, { tag: "mbull base" });
    const spin = new THREE.Group(); spin.position.y = 0.82; root.add(spin); const tilt = new THREE.Group(); spin.add(tilt);
    const KB = new Kit(); KB.sph("iwood", 0x3e2418, 0.5, 0, 0.36, -0.12, 18, 0.86, 0.74, 1.5); KB.sph("iwood", 0x34200f, 0.27, 0, 0.5, 0.72, 14, 0.92, 0.86, 1.3); KB.sph("iwood", 0x2a1a10, 0.12, 0, 0.42, 1.02, 10, 1.1, 0.8, 0.8);
    [-1, 1].forEach((s) => { KB.cyl("isteel", 0xe9e1cc, 0.0, 0.055, 0.46, s * 0.33, 0.7, 0.78, 8, false, 0, 0, s * 1.25); KB.sph("iwood", 0x3e2418, 0.1, s * 0.27, 0.06, -0.62, 8, 1, 1.6, 1); KB.sph("iwood", 0x3e2418, 0.1, s * 0.27, 0.06, 0.3, 8, 1, 1.6, 1); });
    KB.box("iwood", 0x8a2e22, 0.66, 0.05, 0.62, 0, 0.73, -0.2, 0, 0.6); KB.place("isteel", new THREE.TorusGeometry(0.1, 0.022, 6, 14), 0xd9c9a0, 0, 0.82, 0.18, 0, 0); KB.tube("isteel", 0xd9c9a0, [-0.3, 0.72, 0.16], [0.3, 0.72, 0.16], 0.02, 6);
    KB.build(tilt, { iwood: MT.iwood, isteel: MT.isteel }, { tag: "mbull" }).forEach((m) => { m.userData.anim = true; }); const seat = new THREE.Object3D(); seat.position.set(0, 0.74, -0.22); tilt.add(seat);
    Object.assign(MB, { root, spin, tilt, seat, yaw: 0 }); }
  function inRing() { if (!player || !MB.root) return false; const p = player.position, q = w2l(p.x, p.z); return Math.hypot(q[0] - BULL_C[0], q[1] - BULL_C[1]) < 2.9 && Math.abs(p.y - (S.YA + S.dS + 0.31)) < 0.9; }
  const keyDown = (k) => { try { return !!keys[k]; } catch (e) { return false; } };
  function mbStart() { if (MB.on || !MB.root) return false; try { if (typeof cartMode !== "undefined" && cartMode) toggleCart(); } catch (e) {} if (typeof RIDE === "undefined") return false; MB.saved = SITES.bull; SITES.bull = null; RIDE.on = true;
    Object.assign(MB, { on: true, t: 0, grip: 1, next: 1.1, want: null, wt: 0, dir: 1, dirT: 1.6, prev: {}, hits: 0, misses: 0, lean: 0, kick: 0, thrown: null }); player.userData.sit = true; try { sitOffset(player, 0.02); } catch (e) {}
    try { $("#game").classList.add("on"); $("#game-big").textContent = ""; $("#game-s").textContent = ""; } catch (e) {} status(C("prompts.ride", "Hold on! Lean with A and D (or the arrows) when it turns, SPACE when it bucks."), false); try { sfx("board"); } catch (e) {} cnt("mbRides"); return true; }
  function mbEnd(won, thrown) { if (!MB.on) return; MB.on = false; RIDE.on = false; SITES.bull = MB.saved || SITES.bull; player.userData.sit = false; try { sitClear(player); } catch (e) {}
    const secs = Math.min(8, MB.t); if (secs > MB.best) { MB.best = +secs.toFixed(2); try { localStorage.setItem("g1:ro_mbull", String(MB.best)); } catch (e) {} }
    try { $("#game").classList.remove("on"); const gm = $("#game-n"); if (gm) gm.innerHTML = ""; } catch (e) {}
    // off the bull onto the mat: thrown in an arc, or a clean hop off
    const q = w2l(player.position.x, player.position.z), side = MB.dir > 0 ? 1 : -1, a = MB.yaw + PI / 2 * side, du = Math.sin(a), dv = Math.cos(a); const tu = BULL_C[0] + du * 1.9, tv = BULL_C[1] + dv * 1.9; MB.land = { u0: q[0], v0: q[1], u1: tu, v1: tv, t: 0, T: thrown ? 0.55 : 0.35, y0: player.position.y, y1: S.YA + S.dS + 0.31, thrown };
    if (won) { status(fill2(C("prompts.won", "EIGHT SECONDS! You rode the iron bull. Best {best} s"))); try { sfx("rank"); } catch (e) {} stamp(C("stamps.ride", "p_ro_ride")); } else status(fill2(thrown ? C("prompts.thrown", "Thrown at {t} s. Best {best} s. Junie says: lean into the turn.") : C("prompts.off", "Off at {t} s. Best {best} s")), false); }
  const fill2 = (s) => String(s).replace("{t}", Math.min(8, MB.t).toFixed(1)).replace("{best}", MB.best.toFixed(1));
  function mbFrame(dt) { if (!MB.root) return; const live = MB.on;
    // the bull moves on its own while nobody rides (a slow demo), harder the longer you stay on
    const t = (MB.tt = (MB.tt || 0) + dt); if (!live) { MB.yaw += dt * 0.35 * Math.sin(t * 0.21); MB.spin.rotation.y = MB.yaw; MB.tilt.rotation.set(Math.sin(t * 1.3) * 0.06, 0, Math.sin(t * 0.9) * 0.05); landFrame(dt); return; }
    MB.t += dt; const k = Math.min(1, MB.t / 8); MB.dirT -= dt; if (MB.dirT <= 0) { MB.dir = -MB.dir; MB.dirT = 1.2 + Math.random() * 1.4 - k * 0.5; }
    const sp = (0.9 + 2.3 * k) * MB.dir; MB.yaw += sp * dt; MB.kick = Math.max(0, MB.kick - dt * 3); const pitch = Math.sin(MB.t * (6 + 3 * k)) * (0.07 + 0.08 * k) + MB.kick * 0.45; const roll = -MB.dir * (0.1 + 0.12 * k) + Math.sin(MB.t * 4.3) * 0.04;
    MB.spin.rotation.y = MB.yaw; MB.tilt.rotation.set(pitch, 0, roll);
    // the prompts: lean left, lean right, or a buck (SPACE); hit it inside the window to keep your grip
    const edge = (code) => { const d = keyDown(code); const was = MB.prev[code]; MB.prev[code] = d; return d && !was; }; const L1 = edge("KeyA") || edge("ArrowLeft"), R1 = edge("KeyD") || edge("ArrowRight"), B1 = edge("Space");
    MB.next -= dt; if (!MB.want && MB.next <= 0) { const r = Math.random(); MB.want = r < 0.36 ? "L" : r < 0.72 ? "R" : "B"; MB.wt = 0.85 - 0.3 * k; if (MB.want === "B") MB.kick = 1; try { sfx("ui"); } catch (e) {} }
    if (MB.want) { MB.wt -= dt; const ok = (MB.want === "L" && L1) || (MB.want === "R" && R1) || (MB.want === "B" && B1), bad = (L1 || R1 || B1) && !ok; if (ok) { MB.grip = Math.min(1, MB.grip + 0.22); MB.hits++; MB.want = null; MB.next = 0.75 + Math.random() * 0.8 - 0.3 * k; try { sfx("coin"); } catch (e) {} } else if (bad || MB.wt <= 0) { MB.grip -= 0.36; MB.misses++; MB.want = null; MB.next = 0.6 + Math.random() * 0.7; MB.kick = Math.max(MB.kick, 0.6); } }
    MB.grip -= dt * 0.045;
    // the rider on the seat, leaning with the bull
    MB.root.updateMatrixWorld(true); MB.seat.getWorldPosition(_sp); MB.seat.getWorldQuaternion(_sq); player.position.copy(_sp); const e2 = new THREE.Euler().setFromQuaternion(_sq, "YXZ"); player.rotation.set(0, e2.y, 0); try { if (player.userData.walk) { player.userData.walk.rotation.x = pitch * 0.7; player.userData.walk.rotation.z = roll * 0.8; } } catch (e) {}
    try { mv.x = 0; mv.z = 0; airborne = false; vy = 0; player.userData.sit = true; animateWalk(player, 0, dt); pushMove(false); } catch (e) {}
    const gm = $("#game-n"); if (gm) { const g10 = Math.max(0, Math.round(MB.grip * 10)); const pr = MB.want === "L" ? "LEAN ← (A)" : MB.want === "R" ? "LEAN → (D)" : MB.want === "B" ? "BUCK! SPACE" : ""; gm.innerHTML = "<b>" + esc(C("names.mbull", "THE IRON BULL")) + "</b> &nbsp; " + MB.t.toFixed(1) + " s &nbsp;·&nbsp; grip " + "█".repeat(g10) + "░".repeat(10 - g10) + (pr ? " &nbsp; <span style=\"color:#4DDE6F\">" + pr + "</span>" : "") + " &nbsp;·&nbsp; best " + MB.best.toFixed(1) + " s"; }
    if (MB.grip <= 0) mbEnd(false, true); else if (MB.t >= 8) mbEnd(true, false); }
  function landFrame(dt) { const Lw = MB.land; if (!Lw || !player) return; Lw.t += dt; const k = Math.min(1, Lw.t / Lw.T); const u = lerp(Lw.u0, Lw.u1, k), v = lerp(Lw.v0, Lw.v1, k); const p = l2w(u, v); player.position.set(p[0], lerp(Lw.y0, Lw.y1, k) + Math.sin(k * PI) * (Lw.thrown ? 0.9 : 0.35), p[1]); try { if (player.userData.walk) { player.userData.walk.rotation.x = 0; player.userData.walk.rotation.z = Lw.thrown ? Math.sin(k * PI) * 1.2 : 0; } } catch (e) {} if (k >= 1) { MB.land = null; try { player.userData.walk.rotation.set(0, 0, 0); } catch (e) {} } }

  // ───────────────────────── defer hook: build everything (behind the loading screen), the lamp sources, the warm-up ─────────────────────────
  function deferHook() {
    if (R.off || !window.PLAN) return; const t0 = nowMs(); const step = (name, fn) => { const t = nowMs(); try { fn(); } catch (e) { note(name, e); } R.t["ms_" + name] = Math.round(nowMs() - t); };
    step("mats", () => mats());
    step("arena", () => buildArena());
    step("saloon", () => buildSaloon());
    step("mbull", () => buildMBull(EX.saloon));
    step("lights", () => arenaLights());
    step("stock", () => buildStock());
    step("smoke", () => smokeInit());
    step("warm", () => { const W = window.PLAN_PERF; if (W && W.warmGroup) { [EX.arena, EX.saloon].forEach((g) => { if (g) W.warmGroup(g, { name: g.name }); }); const seen = new Set(); STOCK.list.forEach((a) => { const k = a.kind + (a.role === "show" ? "s" : ""); if (seen.has(k)) return; seen.add(k); W.warmGroup(a.root, { name: "ro " + k, detached: true }); }); } });
    talkHook(); installOverrides(); R.ready = true; R.t.defer = Math.round(nowMs() - t0); }
  // the arena's lamp sources for the pool: four spots from the corner towers on the dirt, two high fills
  function arenaLights() { const A = L.arena, cu = (A.u0 + A.u1) / 2, cv = (A.v0 + A.v1) / 2; (EX.heads || []).forEach((h, i) => { if (i > 3) return; spotSource(h.u, h.y, h.v, lerp(h.u, cu, 0.75), 0, lerp(h.v, cv, 0.75), 0xfff0dc, 70, 80, 0.62, "arena"); });
    lampSource(cu - 9, 13, cv, 0xfff2e2, 26, 44, "arena"); lampSource(cu + 9, 13, cv, 0xfff2e2, 26, 44, "arena"); EX.lights.slice(-2).forEach((l) => { l.decay = 1.2; });
    // the glows over each tower head at night (sprites), and a soft beam from each head down to the dirt
    EX.halos = []; const hm = new THREE.SpriteMaterial({ map: glowTex(), color: 0xfff1d8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }); hm.userData.avShared = true; MT.halo = hm;
    (EX.heads || []).forEach((h) => { const s = new THREE.Sprite(hm); const p = l2w(h.u, h.v); s.position.set(p[0], S.YA + h.y + 0.2, p[1]); s.scale.set(7, 7, 1); s.userData.noSolid = true; s.visible = false; scene.add(s); EX.halos.push(s); });
    const K = new Kit(); (EX.heads || []).forEach((h) => { const tu = lerp(h.u, cu, 0.62), tv = lerp(h.v, cv, 0.62); const Lb = Math.hypot(tu - h.u, tv - h.v, h.y); const g = new THREE.CylinderGeometry(1.2, 4.5, Lb, 14, 1, true); g.translate(0, -Lb / 2, 0); const dir = new THREE.Vector3(tu - h.u, -h.y, tv - h.v).normalize(); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir); const m4 = new THREE.Matrix4().compose(new THREE.Vector3(h.u, h.y, h.v), q, new THREE.Vector3(1, 1, 1));
      const P = g.attributes.position, Cc = new Float32Array(P.count * 3); for (let i = 0; i < P.count; i++) { const f = clamp(1 + P.getY(i) / Lb * 1.1, 0, 1) * 0.5 + 0.08; Cc[i * 3] = Cc[i * 3 + 1] = Cc[i * 3 + 2] = f; } g.setAttribute("color", new THREE.BufferAttribute(Cc, 3)); K.add("beam", g, null, m4); });
    const ms = K.build(EX.arena, { beam: MT.beam }, { tag: "beams", cast: false, receive: false }); EX.beams = ms; ms.forEach((m) => { m.renderOrder = 3; }); }
  // smoke from the smoker's stack (a few soft sprites, recycled)
  function smokeInit() { const Sm = EX.smoke; if (!Sm || !MT.smoke) return; for (let i = 0; i < 9; i++) { const s = new THREE.Sprite(MT.smoke); s.userData.noSolid = true; s.userData.t = i * 0.55; s.visible = false; scene.add(s); Sm.puffs.push(s); } }
  function smokeFrame(dt, on) { const Sm = EX.smoke; if (!Sm) return; const p0 = l2w(Sm.u, Sm.v); for (const s of Sm.puffs) { s.visible = on; if (!on) continue; s.userData.t += dt; let t = s.userData.t % 5; const k = t / 5; s.position.set(p0[0] + k * 2.2 + Math.sin(t * 1.3 + s.id) * 0.25, S.YA + Sm.y + k * 4.5, p0[1] + k * 1.1); s.scale.setScalar(0.5 + k * 2.6); } if (on) MT.smoke.opacity = 0.32 + 0.12 * Math.sin(performance.now() / 900); }
  // ───────────────────────── E: the mechanical bull, the jukebox; the prompt ─────────────────────────
  function installOverrides() { if (R.ov) return; R.ov = true;
    try { const on0 = openNearest; const f = function () { try { if (!R.off && R.ready && handleE()) return; } catch (e) { note("E", e); } return on0.apply(this, arguments); }; f.ro = true; openNearest = f; } catch (e) { note("openNearest wrap", e); } }
  function nearJuke() { if (!EX.jukebox || !player) return false; const q = w2l(player.position.x, player.position.z); return Math.hypot(q[0] - EX.jukebox[0], q[1] - EX.jukebox[1]) < 1.4 && Math.abs(player.position.y - (S.YA + S.dS)) < 1; }
  function handleE() { if (MB.on) { mbEnd(false, false); return true; } if (MB.land) return true; if (busy()) return false;
    if (inRing()) { return mbStart(); }
    if (nearJuke()) { AUDIO.juke = performance.now() + 90000; status(C("prompts.juke", "A two-step comes on. The floor fills up.")); try { sfx("coin"); } catch (e) {} return true; }
    return false; }
  function promptFrame() { try { if (MB.on || busy()) return; let t = null; if (inRing()) t = C("prompts.mbull", "ride the mechanical bull"); else if (nearJuke()) t = C("prompts.jukebox", "play the jukebox"); if (!t) return; const el = document.getElementById("prompt"), tt = document.getElementById("prompt-t"); if (!el || !tt) return; tt.innerHTML = "<b>E</b> &nbsp;" + esc(t); el.classList.add("on"); } catch (e) { note("prompt", e); } }
  // ───────────────────────── sound: country music in the saloon (louder inside, the jukebox lifts it), the arena's cues come from the show ─────────────────────────
  const AUDIO = R.audio = R.audio || { a: null, juke: 0 };
  function audioFrame(dt, dIn, inside) { try { const want0 = typeof soundOn !== "undefined" && soundOn && audioReady && dIn < 70; const h = hourNow(), open = h >= 10 || h < 2; const want = want0 && open ? (inside ? 0.5 : 0.22 * (1 - dIn / 70)) * (performance.now() < AUDIO.juke ? 1.5 : 1) * VOL.music * VOL.master : 0;
      if (want > 0.003 && !AUDIO.a) { AUDIO.a = new Audio(au("/audio/radio_country.m4a")); AUDIO.a.loop = true; AUDIO.a.volume = 0; }
      const a = AUDIO.a; if (!a) return; if (want > 0.003) { if (a.paused) a.play().catch(() => {}); a.volume = clamp(a.volume + (want - a.volume) * Math.min(1, dt * 2), 0, 1); } else if (!a.paused) { a.volume = Math.max(0, a.volume - dt * 0.8); if (a.volume < 0.01) a.pause(); } } catch (e) {} }
  // ───────────────────────── the camera in the saloon and under the deck roof (kept inside the walls), the mechanical bull's camera ─────────────────────────
  const FR = R.fr = R.fr || { inCam: false, k: 0 };
  function camBox(x, y, z) { const q = w2l(x, z), u = q[0], v = q[1], h = y - S.YA, Sa = L.saloon, D = L.deck; if (u > Sa.u0 + 0.35 && u < Sa.u1 - 0.35 && v > Sa.v0 + 0.35 && v < Sa.v1 - 0.35 && h > S.dS - 0.2) { const roofY = S.dS + Sa.eave + (Sa.ridge - Sa.eave) * Math.max(0, 1 - Math.abs(v - (Sa.v0 + Sa.v1) / 2) / ((Sa.v1 - Sa.v0) / 2)) - 0.5; return h < roofY ? 1 : 0; }
    return 0; }
  function camHook(dt) { if (R.off || !R.ready || window.__cam || !player) return false;
    try { if (MB.on) { const p = MB.root.getWorldPosition(new THREE.Vector3()); const a = Math.atan2(1, 0.4) + Math.sin(MB.t * 0.3) * 0.25; const q = w2l(p.x, p.z); const cw = l2w(q[0] + Math.sin(a + S.th) * 0 + 3.4, q[1] + 2.6); camera.position.lerp(new THREE.Vector3(cw[0], p.y + 1.9, cw[1]), Math.min(1, dt * 4)); camera.lookAt(p.x, p.y + 1.25, p.z); return true; }
      if (busy()) { FR.inCam = false; return false; }
      const px = player.position.x, py = player.position.y, pz = player.position.z; if (!camBox(px, py + 1, pz)) { if (FR.inCam) { FR.inCam = false; try { player.userData.walk.visible = true; } catch (e) {} } return false; }
      FR.inCam = true; const fwd = [-Math.sin(yaw), -Math.cos(yaw)], by = typeof bobY === "number" ? bobY : 0, cy0 = py - by + 1.9, maxD = 6.0; let dist = 0;
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
      const cam = camera.position, c0 = l2w(-4, 2), dC = Math.hypot(cam.x - c0[0], cam.z - c0[1]), pp = player.position, dP = Math.hypot(pp.x - c0[0], pp.z - c0[1]);
      const sal = l2w(-12, 24.5), dIn = Math.hypot(cam.x - sal[0], cam.z - sal[1]), inside = !!inSaloonW(cam.x, cam.y, cam.z); const near = dC < 240, h = hourNow();
      // what is drawn: the venue within 1.2 km, the interior within 90 m, the people and the stock within 230 m
      if (FR.k % 10 === 1) { const far = dC > 1200; [EX.arena, EX.saloon].forEach((g) => { if (g) g.visible = !far; }); if (EX.saloon) EX.saloon.children.forEach((m) => { if (m.isMesh && /^ro saloon (iwood|icorr|isteel|mural|brands|posters|menu|bottles|wanted|tack|hide)$/.test(m.name)) m.visible = dIn < 90; }); (EX.fans || []).forEach((f) => { f.visible = dIn < 60; }); if (MB.root) MB.root.visible = dIn < 90; }
      // night: the lamp levels, the neon, the bulbs, the window glow, the arena lights for events
      if (FR.k % 8 === 2) { const n = clamp((nightK() - 0.04) * 2.6, 0, 1), sc = sched(h), event = sc.on || (h >= 17.6 && h < 23.3), arenaOn = n > 0.18 && event; FR.n = n; FR.arenaOn = arenaOn;
        MT.lamp.emissiveIntensity = arenaOn ? 2.8 * Math.max(0.5, n) : 0.6 * n; MT.neon.emissiveIntensity = 0.32 + 1.9 * n; MT.bulb.emissiveIntensity = 0.06 + 2.6 * n; MT.win.emissiveIntensity = 1.4 * n; MT.board.emissiveIntensity = 0.9 + 0.6 * n; MT.glow.opacity = 0.32 * n; MT.beam.opacity = arenaOn ? 0.075 * n : 0; if (MT.halo) MT.halo.opacity = arenaOn ? 0.85 * n : 0; (EX.halos || []).forEach((s) => { s.visible = arenaOn && dC < 1500; });
        for (const l of EX.lights) { const tg = l.userData.tag; let k = 0; if (tg === "arena") k = arenaOn ? 1 : 0; else if (tg === "in") k = 0.35 + 0.85 * n; else if (tg === "fire") k = 0.7 + 0.3 * n; else k = n; l.intensity = dC < 260 ? l.userData.k0 * k : 0; } }
      if (EX.fireL && dC < 120) EX.fireL.intensity = EX.fireL.userData.k0 * (0.7 + 0.3 * (FR.n || 0)) * (0.8 + 0.25 * Math.sin(now / 90) + 0.12 * Math.sin(now / 37));
      if (EX.fans && dIn < 60) EX.fans.forEach((f, i) => { f.rotation.y += dt * (2.2 + i * 0.3); });
      // people, stock, the show, the iron bull, dust, smoke, sound
      if (dP < 300 && nowMs() > (FR.staffAt || 0)) { FR.staffAt = nowMs() + (ST.built ? 2500 : 350); try { buildStaff(); } catch (e) { note("staff", e); } try { roamArea(); } catch (e) { note("roam", e); } }
      if (FR.k % 30 === 11) { const cp = camera.position; for (const a of STOCK.list) { const d = Math.hypot(a.root.position.x - cp.x, a.root.position.z - cp.z), cs = d < 28; if (a.cs !== cs) { a.cs = cs; a.root.traverse((o) => { if (o.isMesh) o.castShadow = cs; }); } } }
      staffFrame(dt, near); stockFrame(dt, dC < 230); showFrame(dt, h, dC < 230 && dP < 260); dustFrame(dt); smokeFrame(dt, dC < 180 && (h > 9 && h < 22.5)); mbFrame(dt); promptFrame(); audioFrame(dt, dIn, inside);
      // the passport
      if (FR.k % 15 === 7) stampsFrame();
    } catch (e) { note("frame", e); }
    const tf = nowMs() - tf0; R.n.fAvg = +(((R.n.fAvg || 0) * 0.98 + tf * 0.02)).toFixed(3); if (tf > (R.n.fMax || 0)) { R.n.fMax = +tf.toFixed(1); R.n.fMaxAt = SHOW.ph + "/" + (ST.built ? "s" : "b") + (SHOW.crew ? "c" : ""); } }
  function stampsFrame() { try { const p = player.position, q = w2l(p.x, p.z), u = q[0], v = q[1], y = p.y - S.YA;
      if (inSaloonL(u, v, y)) stamp(C("stamps.saloon", "p_ro_saloon"));
      if (player.userData.dance && u > -3.7 && u < 1.6 && v > 17.3 && v < 31.5 && Math.abs(y - S.dS) < 0.6) stamp(C("stamps.dance", "p_ro_dance"));
      const Rm = L.remuda; if ((u > Rm.u0 - 3 && u < Rm.u1 && v > Rm.v0 - 2 && v < Rm.v1 + 2 && !inRect(u, v, Rm, -0.5)) || (u > -29 && u < -16 && v > 36.6 && v < 40.5)) stamp(C("stamps.remuda", "p_ro_remuda"));
      if (SHOW.ph === "ride") stampShow(); } catch (e) {} }
  // ───────────────────────── API, debug, hooks ─────────────────────────
  R.api = { l2w, w2l, gy, roadV, inFoot, inSaloonW, sched, startRide: () => { SHOW.t = 99; }, setBoard };
  R.debug = {
    cam: (u, y, v, tu, ty, tv, fov) => { const a = l2w(u, v), b = l2w(tu, tv); window.__cam = [a[0], S.YA + y, a[1], b[0], S.YA + ty, b[1], fov || 0]; try { updateCulling(true); } catch (e) {} return window.__cam; },
    at: (u, v, y, yawW) => { const w = l2w(u, v); player.position.set(w[0], S.YA + (y === undefined ? gy(u, v) : y) + 0.03, w[1]); if (yawW !== undefined) yaw = yawW; return [w[0], w[1]]; },
    counts: () => { const o = {}; [["arena", EX.arena], ["saloon", EX.saloon]].forEach(([k, g]) => { if (!g) return; let m = 0, tr = 0; g.traverse((x) => { if (x.isMesh) { m++; const gi = x.geometry; tr += (gi.index ? gi.index.count : gi.attributes.position.count) / 3; } }); o[k] = { meshes: m, tris: Math.round(tr) }; }); o.stock = STOCK.list.length; o.staff = ST.list.length; o.lights = (EX.lights || []).length; o.solids = SOLIDS.filter((s) => s.tag === "rodeo").length; o.seats = SOLIDS.filter((s) => s.tag === "rodeo" && s.seat).length; return o; },
    show: (on) => { SHOW.force = on; return SHOW.ph; },
    // development: rebuild the venue in place after evaluating a new copy of the module (solids, groups, lamp sources, halos)
    rebuild: () => { const t0 = nowMs(); try { clearSolids("rodeo"); } catch (e) {} [EX.arena, EX.saloon].forEach((g) => { if (g) scene.remove(g); }); (EX.halos || []).forEach((s) => scene.remove(s)); EX.lights = []; EX.halos = []; EX.bulbPts = []; MT.ready = false; mats(); buildArena(); buildSaloon(); buildMBull(EX.saloon); arenaLights(); return Math.round(nowMs() - t0); }, rp: R.rp, mbStart, mbEnd,
    // in-session A/B: everything of this module hidden (and the frame hook paused) or shown again
    ab: (on) => { R.abOff = !on; const vis = (o) => { if (o) o.visible = on; }; [EX.arena, EX.saloon].forEach(vis); STOCK.list.forEach((a) => vis(a.root)); ST.list.forEach((c) => vis(c.g)); if (SHOW.crew) SHOW.crew.rider.concat(SHOW.crew.fight).forEach((g) => { if (!on) g.visible = false; }); (EX.halos || []).forEach((s) => { if (!on) s.visible = false; }); DUST.list.forEach((s) => { if (!on) s.visible = false; }); if (EX.smoke) EX.smoke.puffs.forEach((s) => { if (!on) s.visible = false; }); try { const A = R.roamArea; if (A && A.npcs) A.npcs.forEach((c) => { if (c.g && !on) c.g.visible = false; }); } catch (e) {} return on; } };
  (function hookAll() { const set = (phase, name, fn) => { const list = window.PLAN_HOOKS[phase]; for (let i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { list[i].fn = fn; return; } list.push({ name, fn }); };
    set("world", "roWorld", () => worldHook()); set("terrain", "roTerrain", () => terrainHook()); set("defer", "roDefer", () => deferHook()); set("frame", "roFrame", (dt, now) => frameHook(dt, now)); set("interior", "roCam", (dt) => camHook(dt)); })();
})();
